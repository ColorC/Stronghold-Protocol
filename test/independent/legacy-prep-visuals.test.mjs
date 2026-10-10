import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverPrepVisualEvents } from '../../tools/legacy-prep-visuals.mjs';
import { buildLegacyPrepVisualState } from '../../tools/legacy-prep-visual-state.mjs';
import { buildLegacyPrepClips } from '../../tools/recorded-prep.mjs';

const recordingId = 'c3c3f89e-eae2-46ac-a118-a6deda3aa3b6';
const origin = Date.parse('2026-10-10T10:00:00.000Z');
const event = (seq, type, at, data) => ({ sid: recordingId, seq, kind: 'rrweb', p: { type, timestamp: origin + at * 1000,
  data: type === 3 ? { source: 0, ...data } : data } });
const el = (id, tagName, attributes = {}, childNodes = []) => ({ id, type: 2, tagName, attributes, childNodes });

test('legacy visual recovery tracks prep poses and emits combat/result cut points', () => {
  const events = [
    event(1, 2, 1, { node: el(1, 'html', {}, [el(2, 'div', { class: 'screen gm gm--prep' }, [
      el(3, 'div', { class: 'ix-badge', 'data-n': '7', style: 'transform: translate(1145px, 465px) translate(-50%, -30%);' }),
    ])]) }),
    event(2, 3, 2, { attributes: [{ id: 3, attributes: { style: 'transform: translate(1200px, 500px) translate(-50%, -30%);' } }] }),
    event(3, 3, 3, { attributes: [{ id: 2, attributes: { class: 'screen gm gm--combat' } }] }),
    event(4, 3, 4, { attributes: [{ id: 2, attributes: { class: 'screen gm gm--prep' } }] }),
    event(5, 3, 5, { adds: [{ parentId: 2, node: el(4, 'div', { class: 'ix-result', role: 'dialog' }) }] }),
    event(6, 3, 6, { removes: [{ id: 4, parentId: 2 }] }),
  ];
  const result = recoverPrepVisualEvents(events, { recordingId, recordingStartedAt: new Date(origin).toISOString(), includePointerEvents: false });
  assert.deepEqual(result.states.map((state) => [state.at, state.screenMode, state.badges[0]?.x, state.badges[0]?.bottom]), [
    [1, 'prep', 1145, 465], [2, 'prep', 1200, 500], [3, 'combat', undefined, undefined],
    [4, 'prep', 1200, 500], [5, 'result', undefined, undefined], [6, 'prep', 1200, 500],
  ]);
  assert.equal(result.coverage.snapshotCount, 1);
  assert.equal(result.coverage.mutationCount, 5);
});

test('legacy prep clip builder cuts at result/combat and battle intervals without carrying a later formation backward', () => {
  const visualStates = [
    { at: 0, sourceSeq: 1, screenMode: 'prep', state: { phase: 'prep', pieces: [{ uid: 'p1', row: 10, col: 6 }] } },
    { at: 2, sourceSeq: 2, screenMode: 'result', badges: [] },
    { at: 4, sourceSeq: 3, screenMode: 'prep', state: { phase: 'prep', pieces: [{ uid: 'p1', row: 10, col: 7 }] } },
    { at: 6, sourceSeq: 4, screenMode: 'combat', badges: [] },
  ];
  const result = buildLegacyPrepClips({ visualStates, duration: 10,
    battleClips: [{ startSecond: 6, endSecond: 8 }] });
  assert.deepEqual(result.clips.map((clip) => [clip.startSecond, clip.endSecond, clip.states[0].state.pieces[0].col]), [
    [0, 2, 6], [4, 6, 7],
  ]);
  assert.ok(result.uncoveredGaps.some((gap) => gap.reason === 'legacy-result-screen-visible' && gap.startSecond === 2 && gap.endSecond === 4));
  assert.ok(!result.clips.some((clip) => clip.startSecond < 4 && clip.states.some((state) => state.state.pieces[0].col === 7)));
});

test('legacy state conversion maps only observed identities/slots and uses wheel trace for direction', () => {
  const recovered = { coverage: { snapshotCount: 1 }, states: [
    { at: 1, sourceSeq: 10, screenMode: 'prep', badges: [{ uid: 7, x: 1145.1, bottom: 465.2 }] },
    { at: 2, sourceSeq: 11, screenMode: 'combat', badges: [] },
  ] };
  const result = buildLegacyPrepVisualState({ recovered, identities: [{ uid: 'p7', chessId: 'chess_test', kind: 'op', golden: false, name: 'Test' }],
    geometry: { coords: [{ area: 'board', row: 10, col: 6, rect: { x: 1145.1, bottom: 465.2 } }] },
    facingSamples: [{ sourceOffset: 1, seq: 9, operatorName: 'Test', dir: 'LEFT', wheel: { centerX: 1185, centerY: 453 } }],
    recordingId, sessionId: 'fixture-session', recordingStartedAt: new Date(origin).toISOString() });
  assert.deepEqual(result.states[0].state.pieces, [{ uid: 'p7', kind: 'op', chessId: 'chess_test', elite: false, row: 10, col: 6, dir: 'LEFT' }]);
  assert.deepEqual(result.states[0].visualPoses, [{ uid: 'p7', x: 1145.1, bottom: 465.2 }]);
  assert.equal(result.states[1].screenMode, 'combat');
  assert.equal(result.coverage.unresolvedCount, 0);
});

test('legacy badge IDs explicitly mapped to summons become token pieces with owner and observed position', () => {
  const recovered = { coverage: { snapshotCount: 1 }, states: [
    { at: 1, sourceSeq: 10, screenMode: 'prep', badges: [{ uid: 18, x: 1145.1, bottom: 465.2 }] },
    { at: 2, sourceSeq: 11, screenMode: 'combat', badges: [] },
  ] };
  const result = buildLegacyPrepVisualState({ recovered, identities: [],
    tokenIdentities: [{ uid: 't18', tokenId: 'token_10013_robin_mine', ownerUid: 'p17' }],
    geometry: { coords: [{ area: 'board', row: 10, col: 6, rect: { x: 1145.1, bottom: 465.2 } }] },
    recordingId, sessionId: 'fixture-session', recordingStartedAt: new Date(origin).toISOString() });
  assert.deepEqual(result.states[0].state.pieces, [{ uid: 't18', kind: 'token', tokenId: 'token_10013_robin_mine', ownerUid: 'p17', count: 1, row: 10, col: 6 }]);
  assert.deepEqual(result.states[0].visualPoses, [{ uid: 't18', x: 1145.1, bottom: 465.2 }]);
  assert.equal(result.coverage.resolvedTokenBadgeIdentities, 1);
  assert.equal(result.unresolved.length, 0);
});
