/** Build prep-only recording-clock spans from public state traces. Battle intervals always take priority. */
export function buildPrepClips({ events, recordingId, sessionId, recordingStartedAt, duration, battleClips, fps = 30 }) {
  const recordingOrigin = Date.parse(recordingStartedAt);
  if (!Number.isFinite(recordingOrigin) || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(fps) || fps <= 0) {
    throw new TypeError('prep trace mapping requires recording start, duration, and frame rate');
  }
  const snapshots = [];
  for (const event of events || []) {
    if (event?.sid !== recordingId || !['initial-state', 'server-action'].includes(event.kind)) continue;
    const payload = event.p;
    const state = payload?.state;
    const occurredAt = Number(payload?.occurredAt);
    if (!state || state.phase !== 'prep' || !Number.isFinite(occurredAt)) continue;
    if (event.kind === 'initial-state' && payload.sessionId !== sessionId) continue;
    snapshots.push({
      at: (occurredAt - recordingOrigin) / 1000,
      seq: Number(event.seq) || 0,
      revision: payload.revision ?? state.revision ?? null,
      kind: event.kind,
      state,
    });
  }
  snapshots.sort((a, b) => a.at - b.at || a.seq - b.seq);
  const battles = [...(battleClips || [])].sort((a, b) => a.startSecond - b.startSecond);
  const gaps = [];
  let cursor = 0, priorBattle = null;
  for (const battle of battles) {
    if (battle.startSecond > cursor) gaps.push({ startSecond: cursor, endSecond: battle.startSecond, afterBattleEnd: cursor > 0, priorBattle });
    cursor = Math.max(cursor, battle.endSecond);
    priorBattle = battle;
  }
  if (duration > cursor) gaps.push({ startSecond: cursor, endSecond: duration, afterBattleEnd: cursor > 0,
    priorBattle });
  const clips = []; const uncoveredGaps = [];
  for (const gap of gaps) {
    const { priorBattle, ...gapInfo } = gap;
    const eligible = snapshots.filter((snapshot) => snapshot.at < gap.endSecond
      && (gap.afterBattleEnd
        ? snapshot.at >= gap.startSecond || (snapshot.kind === 'server-action' && priorBattle
          && snapshot.at >= priorBattle.startSecond && snapshot.at < gap.startSecond)
        : snapshot.at <= gap.startSecond || snapshot.at >= 0));
    let active = null;
    for (const snapshot of eligible) if (snapshot.at <= gap.startSecond) active = snapshot;
    const changes = [];
    if (active) changes.push({ ...active, at: gap.startSecond });
    for (const snapshot of eligible) {
      if (snapshot.at > gap.startSecond && (!changes.length || snapshot.at > changes.at(-1).at)) changes.push(snapshot);
      else if (snapshot.at === gap.startSecond && changes.length) changes[changes.length - 1] = snapshot;
    }
    if (!changes.length) { uncoveredGaps.push({ ...gapInfo, reason: 'legacy-no-prep-state-snapshot' }); continue; }
    const startSecond = Math.max(gap.startSecond, changes[0]?.at ?? gap.startSecond);
    const states = changes.map((snapshot, index) => ({
      at: snapshot.at,
      endSecond: Math.min(gap.endSecond, changes[index + 1]?.at ?? gap.endSecond),
      frameIndex: Math.max(0, Math.ceil((snapshot.at - startSecond) * fps - 1e-8)),
      sourceSeq: snapshot.seq,
      sourceKind: snapshot.kind,
      revision: snapshot.revision,
      state: snapshot.state,
    })).filter((snapshot) => snapshot.endSecond > snapshot.at);
    const endSecond = states.at(-1)?.endSecond ?? startSecond;
    if (startSecond > gap.startSecond) uncoveredGaps.push({ startSecond: gap.startSecond, endSecond: startSecond, afterBattleEnd: gap.afterBattleEnd, reason: 'legacy-no-prep-state-snapshot' });
    if (endSecond > startSecond) clips.push({ kind: 'prep', startSecond, endSecond, states });
  }
  return { clips, uncoveredGaps, sourceSnapshotCount: snapshots.length };
}

/** Build prep clips from legacy RRWeb visual snapshots. Non-prep DOM modes are hard cut points. */
export function buildLegacyPrepClips({ visualStates, duration, battleClips, fps = 30 }) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(fps) || fps <= 0) {
    throw new TypeError('legacy prep visual mapping requires duration and frame rate');
  }
  const timeline = [...(visualStates || [])].filter((s) => Number.isFinite(s.at) && s.at >= 0 && s.at < duration)
    .sort((a, b) => a.at - b.at || (a.sourceSeq || 0) - (b.sourceSeq || 0));
  const battles = [...(battleClips || [])].sort((a, b) => a.startSecond - b.startSecond);
  const boundaries = [...new Set([0, duration, ...timeline.map((s) => s.at),
    ...battles.flatMap((b) => [b.startSecond, b.endSecond]).filter((n) => Number.isFinite(n) && n >= 0 && n <= duration)])]
    .sort((a, b) => a - b);
  const clips = [], uncoveredGaps = [];
  let current = null, timelineIndex = -1, activeClip = null;
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const startSecond = boundaries[i], endSecond = boundaries[i + 1];
    while (timelineIndex + 1 < timeline.length && timeline[timelineIndex + 1].at <= startSecond) timelineIndex++;
    current = timeline[timelineIndex] || null;
    const mid = (startSecond + endSecond) / 2;
    const inBattle = battles.some((battle) => mid >= battle.startSecond && mid < battle.endSecond);
    if (current?.screenMode !== 'prep' || !current.state) {
      if (endSecond > startSecond) uncoveredGaps.push({ startSecond, endSecond,
        reason: current?.screenMode === 'result' ? 'legacy-result-screen-visible' : 'legacy-prep-visual-state-unavailable',
        screenMode: current?.screenMode || 'before-first-snapshot' });
      activeClip = null;
      continue;
    }
    if (inBattle) {
      activeClip = null;
      continue;
    }
    if (activeClip && Math.abs(activeClip.endSecond - startSecond) < 1e-8) {
      activeClip.endSecond = endSecond;
      if (activeClip.states.at(-1)?.sourceSeq !== current.sourceSeq) activeClip.states.push({ at: startSecond,
        endSecond, frameIndex: Math.max(0, Math.ceil((startSecond - activeClip.startSecond) * fps - 1e-8)),
        sourceSeq: current.sourceSeq, sourceKind: 'legacy-rrweb-visual', revision: null, state: current.state,
        visualPoses: current.visualPoses || [] });
      continue;
    }
    const snapshot = { at: startSecond, endSecond, frameIndex: 0, sourceSeq: current.sourceSeq,
      sourceKind: 'legacy-rrweb-visual', revision: null, state: current.state, visualPoses: current.visualPoses || [] };
    activeClip = { kind: 'prep', startSecond, endSecond, states: [snapshot] };
    clips.push(activeClip);
  }
  // Add pose changes inside each contiguous prep clip. A new clip begins after combat/result and never inherits state.
  for (const clip of clips) clip.states.forEach((state, index) => { state.endSecond = Math.min(clip.endSecond, clip.states[index + 1]?.at ?? clip.endSecond); });
  return { clips, uncoveredGaps, sourceSnapshotCount: timeline.filter((s) => s.screenMode === 'prep' && s.state).length };
}
