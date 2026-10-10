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
