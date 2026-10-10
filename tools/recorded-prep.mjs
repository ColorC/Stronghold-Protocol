/** Build prep-only wall-clock spans from public state traces. Battle intervals always take priority. */
export function buildPrepClips({ events, recordingId, sessionId, mediaStartedAt, duration, battleClips, fps = 30 }) {
  const mediaOrigin = Date.parse(mediaStartedAt);
  if (!Number.isFinite(mediaOrigin) || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(fps) || fps <= 0) {
    throw new TypeError('prep trace mapping requires media start, duration, and frame rate');
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
      at: (occurredAt - mediaOrigin) / 1000,
      seq: Number(event.seq) || 0,
      revision: payload.revision ?? state.revision ?? null,
      kind: event.kind,
      state,
    });
  }
  snapshots.sort((a, b) => a.at - b.at || a.seq - b.seq);
  const battles = [...(battleClips || [])].sort((a, b) => a.startSecond - b.startSecond);
  const gaps = [];
  let cursor = 0;
  for (const battle of battles) {
    if (battle.startSecond > cursor) gaps.push({ startSecond: cursor, endSecond: battle.startSecond, afterBattleEnd: cursor > 0 });
    cursor = Math.max(cursor, battle.endSecond);
  }
  if (duration > cursor) gaps.push({ startSecond: cursor, endSecond: duration, afterBattleEnd: cursor > 0 });
  const clips = []; const uncoveredGaps = [];
  for (const gap of gaps) {
    const eligible = snapshots.filter((snapshot) => snapshot.at < gap.endSecond
      && (gap.afterBattleEnd ? snapshot.at >= gap.startSecond : snapshot.at <= gap.startSecond || snapshot.at >= 0));
    let active = null;
    for (const snapshot of eligible) if (snapshot.at <= gap.startSecond) active = snapshot;
    const changes = [];
    if (active) changes.push({ ...active, at: gap.startSecond });
    for (const snapshot of eligible) {
      if (snapshot.at > gap.startSecond && (!changes.length || snapshot.at > changes.at(-1).at)) changes.push(snapshot);
      else if (snapshot.at === gap.startSecond && changes.length) changes[changes.length - 1] = snapshot;
    }
    if (!changes.length) { uncoveredGaps.push({ ...gap, reason: 'legacy-no-prep-state-snapshot' }); continue; }
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
