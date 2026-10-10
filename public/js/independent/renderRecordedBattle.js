/** Deterministic helpers for rendering a native battle replay without the live simulation ticker. */
export function frameFeedWindow(frames, gameTime, index = 0) {
  const out = [];
  let next = index;
  // Once a future snapshot has already been queued it remains the right-hand
  // interpolation bound. Do not consume more future snapshots until gameTime
  // reaches it, or 30fps output will race through a 10Hz replay feed.
  if (next > 0 && frames[next - 1]?.snap?.t > gameTime) return { frames: out, nextIndex: next };
  while (next < frames.length && frames[next].snap.t <= gameTime) out.push(frames[next++]);
  // Seed the native interpolation buffer with two snapshots, then maintain
  // exactly one right-hand snapshot beyond the current game clock.
  if (index === 0 && next < frames.length && out.length < 2) out.push(frames[next++]);
  else if (next < frames.length && (out.length === 0 || out.at(-1).snap.t <= gameTime)) out.push(frames[next++]);
  return { frames: out, nextIndex: next };
}

export function gameTimeAtWallSeconds(wallSeconds, { originGameTime = 0, rate = 2 } = {}) {
  if (!Number.isFinite(wallSeconds) || wallSeconds < 0 || !Number.isFinite(originGameTime)
    || !Number.isFinite(rate) || rate < 0 || rate > 20) throw new TypeError('invalid replay clock');
  return originGameTime + wallSeconds * rate;
}

export function replayClock(replay) {
  const frames = Array.isArray(replay?.frames) ? replay.frames : [];
  const t0 = Number.isFinite(frames[0]?.snap?.t) ? frames[0].snap.t : 0;
  const end = Number.isFinite(frames.at(-1)?.snap?.t) ? frames.at(-1).snap.t : t0;
  return { t0, duration: Math.max(0, end - t0), end };
}

function nativeRateFromUiText(text) {
  const match = String(text || '').match(/×\s*([124])/);
  return match ? Number(match[1]) * 2 : null;
}

/** Build the native sim clock from observed initial countdown slope and speed-button actions. */
export function createReplayTimeMapper(round, replay) {
  const clock = replayClock(replay);
  const observations = (Array.isArray(round?.observations) ? round.observations : [])
    .filter((o) => Number.isFinite(o.at) && Number.isFinite(o.remaining)).sort((a, b) => a.at - b.at);
  const firstIndex = observations.findIndex((o) => o.remaining > 0);
  if (firstIndex < 0) throw new TypeError('timeline has no positive countdown anchor');
  const positive = observations.slice(firstIndex);
  const origin = positive[0].at;
  const actions = (Array.isArray(round?.uiActions) ? round.uiActions : []).filter((a) => Number.isFinite(a.at) && a.at >= origin)
    .sort((a, b) => a.at - b.at);
  const firstControlAt = actions.find((a) => a.kind === 'speed-select' || a.kind === 'skip-to-end')?.at ?? origin + 2;
  const slopeSamples = positive.filter((o) => o.at < firstControlAt);
  const firstSlope = slopeSamples[0] || positive[0];
  const lastSlope = slopeSamples.at(-1) || positive[1];
  const measuredRate = lastSlope && lastSlope.at > firstSlope.at
    ? (firstSlope.remaining - lastSlope.remaining) / (lastSlope.at - firstSlope.at) : 4;
  const nativeRates = [2, 4, 8];
  const initialRate = nativeRates.reduce((best, rate) => Math.abs(rate - measuredRate) < Math.abs(best - measuredRate) ? rate : best, 4);
  const speedChanges = [];
  let skipAt = null;
  for (const action of actions) {
    if (action.kind === 'skip-to-end') { skipAt = action.at; break; }
    if (action.kind === 'speed-select') {
      const rate = nativeRateFromUiText(action.target?.text);
      if (rate != null) speedChanges.push({ at: action.at, rate });
    }
  }
  const finalZeroAt = positive.find((o) => o.remaining <= 0)?.at ?? round.endSecond;
  const integrated = (wallSecond) => {
    const endAt = Math.max(origin, wallSecond);
    let elapsed = 0, last = origin, rate = initialRate;
    for (const change of speedChanges) {
      if (change.at >= endAt) break;
      elapsed += Math.max(0, change.at - last) * rate;
      last = change.at; rate = change.rate;
    }
    elapsed += Math.max(0, endAt - last) * rate;
    return elapsed;
  };
  const calibrationAt = Math.max(origin, finalZeroAt);
  const rawAtEnd = integrated(calibrationAt);
  const calibration = !skipAt && rawAtEnd > 0 ? clock.duration / rawAtEnd : 1;
  return {
    t0: clock.t0, end: clock.end, duration: clock.duration, origin, initialRate,
    measuredRate, speedChanges, skipAt, finalZeroAt, calibration,
    at(wallSecond) {
      if (!Number.isFinite(wallSecond)) throw new TypeError('wall clock time must be finite');
      if (wallSecond <= origin) return clock.t0;
      if (skipAt && wallSecond >= skipAt) return clock.end;
      if (!skipAt && wallSecond >= finalZeroAt) return clock.end;
      const elapsed = integrated(Math.min(wallSecond, finalZeroAt)) * calibration;
      return clock.t0 + Math.max(0, Math.min(clock.duration, elapsed));
    },
  };
}

/** Map a wall timestamp to the native replay clock using observed countdown anchors, not a guessed speed. */
export function gameTimeFromCountdown(round, wallSecond, duration) {
  const observations = Array.isArray(round?.observations) ? round.observations : [];
  const sorted = observations.filter((o) => Number.isFinite(o.at) && Number.isFinite(o.remaining)).sort((a, b) => a.at - b.at);
  const firstPositive = sorted.findIndex((o) => o.remaining > 0);
  const anchors = firstPositive >= 0 ? sorted.slice(firstPositive) : [];
  if (!anchors.length || !Number.isFinite(wallSecond) || !Number.isFinite(duration)) throw new TypeError('countdown timeline missing anchors');
  const first = anchors[0];
  if (wallSecond <= first.at) return 0;
  let left = first;
  for (let i = 1; i < anchors.length; i++) {
    const right = anchors[i];
    if (wallSecond <= right.at) {
      const span = right.at - left.at;
      const f = span > 0 ? Math.max(0, Math.min(1, (wallSecond - left.at) / span)) : 1;
      const remaining = left.remaining + (right.remaining - left.remaining) * f;
      return Math.max(0, Math.min(duration, first.remaining - remaining));
    }
    left = right;
  }
  return left.remaining === 0 ? duration : Math.max(0, Math.min(duration, first.remaining - left.remaining));
}

export function recordedAnimationRate(previousGameTime, gameTime, fps, fallbackRate = 2) {
  if (![previousGameTime, gameTime, fps, fallbackRate].every(Number.isFinite) || fps <= 0) throw new TypeError('invalid recorded animation clock');
  const delta = gameTime - previousGameTime;
  if (delta <= 0) return 0;
  if (delta > 0.5) return Math.max(0, Math.min(8, fallbackRate)); // seek/skip discontinuity is not animation speed
  return Math.max(0, Math.min(8, delta * fps));
}

export function feedNativeFrames(view, frames, fieldId) {
  for (const frame of frames) {
    const t = frame.snap?.t;
    if (!Number.isFinite(t)) continue;
    if (Array.isArray(frame.ev) && frame.ev.length) view.pushEvents({ fieldId, gt: t, ev: frame.ev });
    if (frame.snap) view.pushSnapshot(frame.snap);
  }
}
