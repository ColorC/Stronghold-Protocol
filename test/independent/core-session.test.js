import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, validateSession, viewSession } from '../../server/modes/independent/session.js';

test('session JSON round-trip keeps deterministic RNG, pool, counters, and action state', () => {
  const first = createSession({ seed: 821 }); const restored = JSON.parse(JSON.stringify(first));
  assert.deepEqual(validateSession(restored), []);
  assert.equal(restored.rngState, first.rngState);
  const slot = first.shop.slots.findIndex((x) => x.kind === 'chess' && x.id);
  const outcome = applyAction(first, { type: 'buy', slot });
  assert.equal(outcome.ok, true, outcome.error?.message);
  assert.equal(first.pieces.length, 0, 'action must not mutate input state');
  assert.equal(outcome.state.pieces.length, 1);
  const repeat = applyAction(createSession({ seed: 821 }), { type: 'buy', slot });
  assert.deepEqual(outcome.state, repeat.state);
});

test('bad action and readonly inspect leave revision and serialized state unchanged', () => {
  const state = createSession({ seed: 92 });
  const before = JSON.stringify(state);
  const failed = applyAction(state, { type: 'move', uid: 'unknown', row: NaN, col: 0 });
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(state), before);
  const purchased = applyAction(state, { type: 'buy', slot: state.shop.slots.findIndex((x) => x.kind === 'chess' && x.id) });
  assert.equal(purchased.ok, true);
  const revision = purchased.state.revision; const rng = purchased.state.rngState;
  const inspected = applyAction(purchased.state, { type: 'inspect', uid: purchased.state.pieces[0].uid });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.state.revision, revision);
  assert.equal(inspected.state.rngState, rng);
});

test('view exposes stage, deployed field map, skills, equipment, and legal actions', () => {
  const state = createSession({ seed: 3 });
  const view = viewSession(state);
  assert.equal(view.modeId, 'independent');
  assert.equal(view.legalActions.includes('ready'), true);
  assert.equal(Array.isArray(view.board.map), true);
  assert.equal(view.shop.slots.length > 0, true);
});
