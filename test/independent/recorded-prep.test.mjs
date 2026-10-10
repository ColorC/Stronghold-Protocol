import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrepClips } from '../../tools/recorded-prep.mjs';

const recordingId = 'c3c3f89e-eae2-46ac-a118-a6deda3aa3b6';
const sessionId = '8e9c96d2-576e-4f8d-8e9b-f7668e093d09';
const origin = Date.parse('2026-10-11T10:00:00.000Z');
const state = (phase, pieces) => ({ phase, revision: pieces.length, pieces, summons: [], nextEnemies: [] });
const event = (seq, kind, at, value) => ({ sid: recordingId, seq, kind, p: { occurredAt: origin + at * 1000, ...(kind === 'initial-state' ? { sessionId } : {}), state: value } });

test('prep clips follow each timestamped public state and never import battle state into a prep gap', () => {
  const result = buildPrepClips({ recordingId, sessionId, recordingStartedAt: new Date(origin).toISOString(), duration: 40, fps: 30,
    battleClips: [{ round: 1, startSecond: 12, endSecond: 20 }, { round: 2, startSecond: 30, endSecond: 35 }], events: [
      event(1, 'initial-state', -1, state('prep', [])),
      event(2, 'server-action', 2, state('prep', [{ uid: 'p1', chessId: 'op', row: null, col: null }])),
      event(3, 'server-action', 5, state('prep', [{ uid: 'p1', chessId: 'op', row: 4, col: 2 }])),
      event(4, 'server-action', 8, state('prep', [{ uid: 'p1', chessId: 'op', row: null, col: null }])),
      event(5, 'server-action', 12, state('battle', [{ uid: 'p1', chessId: 'op', row: 4, col: 2 }])),
      event(6, 'server-action', 21, state('prep', [{ uid: 'p1', chessId: 'op', row: null, col: null }])),
    ] });
  assert.equal(result.sourceSnapshotCount, 5, 'battle phase is excluded from prep snapshots');
  assert.deepEqual(result.clips.map(({ startSecond, endSecond }) => [startSecond, endSecond]), [[0, 12], [21, 30]]);
  assert.deepEqual(result.clips[0].states.map(({ at, state: snapshot }) => [at, snapshot.pieces[0]?.row ?? null]), [
    [0, null], [2, null], [5, 4], [8, null],
  ]);
  assert.equal(result.clips[0].states[2].frameIndex, 150, 'snapshot starts at its corresponding 30fps frame');
  assert.deepEqual(result.uncoveredGaps, [
    { startSecond: 20, endSecond: 21, afterBattleEnd: true, reason: 'legacy-no-prep-state-snapshot' },
    { startSecond: 35, endSecond: 40, afterBattleEnd: true, reason: 'legacy-no-prep-state-snapshot' },
  ]);
});

test('legacy event streams expose prep gaps as uncovered instead of synthesizing final layouts', () => {
  const result = buildPrepClips({ recordingId, sessionId, recordingStartedAt: new Date(origin).toISOString(), duration: 30, fps: 30,
    battleClips: [{ startSecond: 10, endSecond: 20 }], events: [] });
  assert.deepEqual(result.clips, []);
  assert.deepEqual(result.uncoveredGaps, [
    { startSecond: 0, endSecond: 10, afterBattleEnd: false, reason: 'legacy-no-prep-state-snapshot' },
    { startSecond: 20, endSecond: 30, afterBattleEnd: true, reason: 'legacy-no-prep-state-snapshot' },
  ]);
});

test('nonzero media start offset does not shift recording-clock prep events', () => {
  const recordingStart = Date.parse('2026-10-10T10:27:41.608Z');
  const mediaStart = Date.parse('2026-10-10T10:27:44.205Z');
  const eventAt = (seq, kind, at, value) => ({ sid: recordingId, seq, kind,
    p: { occurredAt: recordingStart + at * 1000, ...(kind === 'initial-state' ? { sessionId } : {}), state: value } });
  const result = buildPrepClips({ recordingId, sessionId, recordingStartedAt: new Date(recordingStart).toISOString(), duration: 40, fps: 30,
    battleClips: [{ startSecond: 22, endSecond: 30 }], events: [
      eventAt(1, 'initial-state', 0, state('prep', [])),
      eventAt(2, 'server-action', 21.102, state('prep', [{ uid: 'p1', chessId: 'op', row: 10, col: 6 }])),
    ] });
  assert.equal(mediaStart - recordingStart, 2597, 'fixture matches the source recording media offset');
  assert.equal(result.clips[0].states[0].at, 0);
  assert.equal(result.clips[0].states[1].at, 21.102, 'action remains at recording second 21.102 instead of 18.505');
  assert.equal(result.clips[0].states[1].frameIndex, 634, 'recording-clock action maps to frame 634 at 30fps');
});

test('next prep server state recorded at ready can seed the post-battle interval without backdating it', () => {
  const result = buildPrepClips({ recordingId, sessionId, recordingStartedAt: new Date(origin).toISOString(), duration: 30, fps: 30,
    battleClips: [{ startSecond: 10, endSecond: 20 }], events: [
      event(0, 'initial-state', 0, state('prep', [])),
      event(1, 'server-action', 10, state('prep', [{ uid: 'next', chessId: 'op', row: null, col: null }])),
    ] });
  assert.deepEqual(result.clips.map((clip) => [clip.startSecond, clip.endSecond]), [[0, 10], [20, 30]]);
  assert.deepEqual(result.clips[1].states.map(({ at, sourceSeq }) => [at, sourceSeq]), [[20, 1]],
    'the ready response seeds only the actual post-battle presentation interval');
  const legacy = buildPrepClips({ recordingId, sessionId, recordingStartedAt: new Date(origin).toISOString(), duration: 30, fps: 30,
    battleClips: [{ startSecond: 10, endSecond: 20 }], events: [
      { ...event(2, 'server-action', 10, state('prep', [{ uid: 'old', chessId: 'op', row: 10, col: 6 }])), kind: 'visual-state' },
    ] });
  assert.equal(legacy.clips.some((clip) => clip.startSecond === 20), false,
    'legacy observed poses before combat are not reused as future prep state');
});
