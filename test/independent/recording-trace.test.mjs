import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialStateTrace, createServerActionTrace, notifyRecordingServerAction } from '../../public/js/independent/recordingTrace.js';

test('initial snapshot keeps the complete public state and is detached from later mutations', () => {
  const state = { revision: 4, round: 2, bench: [{ uid: 'u1' }], field: [{ uid: 'u2', x: 3, y: 1 }] };
  const trace = createInitialStateTrace('session-a', { ok: true, state }, 123);
  state.field[0].x = 9;
  assert.deepEqual(trace, { sessionId: 'session-a', revision: 4, state: { revision: 4, round: 2, bench: [{ uid: 'u1' }], field: [{ uid: 'u2', x: 3, y: 1 }] }, occurredAt: 123 });
  assert.equal(createInitialStateTrace('session-a', { ok: false, state }), null);
});

test('successful action trace preserves the command and full public response state with the legacy summary', () => {
  const command = { type: 'deploy', uid: 'u7', x: 4, y: 2 };
  const state = { revision: 12, field: [{ uid: 'u7', x: 4, y: 2 }], bench: [] };
  const trace = createServerActionTrace(command, { ok: true, state, events: [{ type: 'deployed' }] }, 456);
  command.x = 99; state.field[0].x = 99;
  assert.deepEqual(trace, { action: 'deploy', command: { type: 'deploy', uid: 'u7', x: 4, y: 2 }, state: { revision: 12, field: [{ uid: 'u7', x: 4, y: 2 }], bench: [] }, revision: 12, eventTypes: ['deployed'], occurredAt: 456 });
  assert.equal(createServerActionTrace(command, { ok: false, state }), null);
});

test('a recording hook failure does not escape into successful game action handling', () => {
  assert.doesNotThrow(() => notifyRecordingServerAction(() => { throw new Error('recording offline'); }, { type: 'deploy' }, { ok: true }));
  let received = false;
  notifyRecordingServerAction((_action, _result) => { received = true; }, { type: 'deploy' }, { ok: true });
  assert.equal(received, true);
});
