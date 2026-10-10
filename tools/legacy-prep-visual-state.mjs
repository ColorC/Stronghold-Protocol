/** Convert RRWeb game badge poses plus the separate facing-wheel DOM trace into a bounded visual-only prep state. */
export function buildLegacyPrepVisualState({ recovered, identities, geometry, facingSamples = [], recordingId, sessionId,
  recordingStartedAt, viewport = { width: 2187, height: 1077 } }) {
  const identityByNum = new Map((identities || []).map((entry) => [Number(String(entry.uid).replace(/^\D+/, '')), entry]));
  const slots = geometry?.coords || [];
  const latestSlots = new Map(), directions = new Map(), unresolved = [];
  const samples = [...facingSamples].filter((s) => Number.isFinite(s.sourceOffset) && s.dir)
    .sort((a, b) => a.sourceOffset - b.sourceOffset || (a.seq || 0) - (b.seq || 0));
  let facingIndex = 0;
  const states = [];
  const stableSlot = (badge) => {
    if (!Number.isFinite(badge.x) || !Number.isFinite(badge.bottom)) return null;
    let closest = null, best = Infinity;
    for (const slot of slots) {
      const d = Math.hypot(badge.x - slot.rect.x, badge.bottom - slot.rect.bottom);
      if (d < best) { best = d; closest = slot; }
    }
    return closest && best <= 10 ? { slot: closest, errorPx: best } : null;
  };
  const applyFacing = (sample, previousBadges) => {
    const candidates = [...identityByNum].filter(([, identity]) => identity.name === sample.operatorName);
    if (!candidates.length) { unresolved.push({ at: sample.sourceOffset, seq: sample.seq, reason: 'facing-name-has-no-identity', name: sample.operatorName }); return; }
    const badgeCandidates = candidates.flatMap(([uid, identity]) => {
      const badge = previousBadges.get(uid);
      return badge && Number.isFinite(badge.x) ? [{ uid, identity, badge,
        distance: Math.hypot(badge.x + 40 - sample.wheel.centerX, badge.bottom - 12 - sample.wheel.centerY) }] : [];
    }).sort((a, b) => a.distance - b.distance);
    if (!badgeCandidates.length || badgeCandidates[0].distance > 125
      || (badgeCandidates[1] && Math.abs(badgeCandidates[1].distance - badgeCandidates[0].distance) < 8)) {
      unresolved.push({ at: sample.sourceOffset, seq: sample.seq, reason: 'facing-target-uid-ambiguous', name: sample.operatorName,
        wheel: { centerX: sample.wheel.centerX, centerY: sample.wheel.centerY } }); return;
    }
    directions.set(badgeCandidates[0].uid, sample.dir);
  };
  for (const source of recovered?.states || []) {
    while (facingIndex < samples.length && samples[facingIndex].sourceOffset < source.at - 1e-6) {
      applyFacing(samples[facingIndex++], latestSlots);
    }
    if (source.screenMode !== 'prep') {
      states.push({ at: source.at, sourceSeq: source.sourceSeq, screenMode: source.screenMode, badges: [] });
      continue;
    }
    const badges = new Map(source.badges.map((badge) => [badge.uid, badge]));
    for (const badge of source.badges) if (stableSlot(badge)) latestSlots.set(badge.uid, badge);
    while (facingIndex < samples.length && samples[facingIndex].sourceOffset <= source.at + 1e-6) {
      applyFacing(samples[facingIndex++], badges);
    }
    const pieces = [], visualPoses = [];
    for (const badge of source.badges) {
      const identity = identityByNum.get(badge.uid);
      if (!identity) {
        unresolved.push({ at: source.at, sourceSeq: source.sourceSeq, reason: 'badge-has-no-identity', uid: badge.uid, x: badge.x, bottom: badge.bottom });
        continue;
      }
      visualPoses.push({ uid: identity.uid, x: badge.x, bottom: badge.bottom });
      const snapped = stableSlot(badge);
      if (snapped) latestSlots.set(badge.uid, badge);
      const slot = snapped?.slot || null;
      const previous = latestSlots.get(badge.uid);
      // While a drag is between tiles, keep the last authoritative slot and render the recorded screen pose separately.
      const previousSlot = !slot && previous ? stableSlot(previous)?.slot : null;
      const location = slot || previousSlot;
      if (!location) unresolved.push({ at: source.at, sourceSeq: source.sourceSeq, reason: 'badge-position-not-near-native-slot',
        uid: badge.uid, x: badge.x, bottom: badge.bottom });
      const piece = { uid: identity.uid, kind: 'op', chessId: identity.chessId, elite: !!identity.golden,
        row: location?.area === 'board' ? location.row : null, col: location?.area === 'board' ? location.col : null };
      if (piece.row != null) {
        const direction = directions.get(badge.uid);
        if (direction) piece.dir = direction;
        else unresolved.push({ at: source.at, sourceSeq: source.sourceSeq, reason: 'board-piece-facing-unobserved', uid: badge.uid,
          row: piece.row, col: piece.col });
      }
      pieces.push(piece);
    }
    // Badge disappearance is a real RRWeb DOM removal; preserve no identity from later fields or session finals.
    for (const uid of latestSlots.keys()) if (!badges.has(uid)) latestSlots.delete(uid);
    states.push({ at: source.at, sourceSeq: source.sourceSeq, screenMode: 'prep', badges: source.badges,
      state: { phase: 'prep', round: null, pieces, summons: [], nextEnemies: [] }, visualPoses });
  }
  const emittedDirs = new Map();
  for (const sample of samples) {
    const base = [...states].reverse().find((state) => state.at <= sample.sourceOffset && state.screenMode === 'prep');
    if (!base || (states.some((state) => state.at > base.at && state.at <= sample.sourceOffset && state.screenMode !== 'prep'))) continue;
    const candidates = [...identityByNum].filter(([, identity]) => identity.name === sample.operatorName)
      .flatMap(([uid, identity]) => {
        const badge = base.badges.find((item) => item.uid === uid);
        if (!badge || !Number.isFinite(badge.x)) return [];
        const position = stableSlot(badge)?.slot;
        const width = position?.rect?.width || 80;
        const scale = width / 0.7;
        const dx = badge.x + width / 2 - sample.wheel.centerX;
        const dy = badge.bottom - scale * 0.1 - sample.wheel.centerY;
        return [{ uid, identity, distance: Math.hypot(dx, dy) }];
      }).sort((a, b) => a.distance - b.distance);
    if (!candidates.length || candidates[0].distance > 125
      || (candidates[1] && Math.abs(candidates[1].distance - candidates[0].distance) < 8)) {
      unresolved.push({ at: sample.sourceOffset, seq: sample.seq, reason: 'facing-target-uid-ambiguous', name: sample.operatorName });
      continue;
    }
    const target = candidates[0], key = target.uid;
    if (emittedDirs.get(key) === sample.dir) continue;
    emittedDirs.set(key, sample.dir);
    const piece = base.state.pieces.find((item) => item.uid === target.identity.uid);
    if (!piece || piece.row == null) continue;
    if (piece.dir === sample.dir) continue;
    const state = { ...base.state, pieces: base.state.pieces.map((item) => item.uid === target.identity.uid ? { ...item, dir: sample.dir } : item) };
    states.push({ at: sample.sourceOffset, sourceSeq: sample.seq, screenMode: 'prep', badges: base.badges,
      state, visualPoses: base.visualPoses, sourceKind: `legacy-facing-${sample.source}` });
  }
  states.sort((a, b) => a.at - b.at || (a.sourceSeq || 0) - (b.sourceSeq || 0));
  return { schemaVersion: 1, sourceKind: 'legacy-rrweb-badge-visual-state', recordingId, sessionId,
    recordingStartedAt, viewport, states, unresolved,
    coverage: { ...recovered.coverage, facingSamples: samples.length, visualPrepStateCount: states.filter((s) => s.screenMode === 'prep').length,
      resolvedBadgeIdentities: [...identityByNum.keys()].length, unresolvedCount: unresolved.length,
      unresolvedReasons: Object.fromEntries([...new Set(unresolved.map((u) => u.reason))].map((reason) => [reason, unresolved.filter((u) => u.reason === reason).length])) } };
}
