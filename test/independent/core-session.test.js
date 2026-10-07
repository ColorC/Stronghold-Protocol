import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, validateSession, viewSession } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';

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

test('steam equipment selection is explicit, limited, wearer-owned, and survives JSON state', () => {
  const state = createSession({ seed: 17 });
  const bought = applyAction(state, { type: 'buy', slot: state.shop.slots.findIndex((x) => x.kind === 'chess' && x.id) });
  assert.equal(bought.ok, true);
  const work = structuredClone(bought.state); const piece = work.pieces[0];
  const catalog = viewSession(work).catalog;
  const steam = Object.values(catalog.equipment).find((x) => x.params?.effects?.some((e) => e.behavior === 'steamGearUpgrade'));
  assert.ok(steam);
  const sources = ['chess_item_2_03_e_a', 'chess_item_3_09_e_a', 'chess_item_3_10_e_a', 'chess_item_4_09_e_a'];
  piece.equipment.push({ uid: 'e900', id: steam.id, sourceId: steam.sourceId, elite: false, quantity: 1, state: {} });
  piece.equipment.push(...sources.slice(0, 2).map((sourceId, i) => ({ uid: `e${901 + i}`, id: sourceId, sourceId, elite: false, quantity: 1, state: {} })));
  work.nextUid = 1000;
  const rejected = applyAction(work, { type: 'configure-equipment', targetUid: piece.uid, itemUid: 'e900', hammerSourceIds: sources.slice(0, 2) });
  assert.equal(rejected.ok, false);
  const accepted = applyAction(work, { type: 'configure-equipment', targetUid: piece.uid, itemUid: 'e900', hammerSourceIds: [sources[0]] });
  assert.equal(accepted.ok, true, accepted.error?.message);
  assert.deepEqual(accepted.state.pieces[0].equipment[0].state.hammerSourceIds, [sources[0]]);
  assert.deepEqual(JSON.parse(JSON.stringify(accepted.state)).pieces[0].equipment[0].state.hammerSourceIds, [sources[0]]);
});

test('short-run round 4 offers the start-stage prize before the next preparation', () => {
  const first = createSession({ seed: 821, roundLimit: 9 });
  const bought = applyAction(first, { type: 'buy', slot: first.shop.slots.findIndex((x) => x.kind === 'chess' && x.id) });
  assert.equal(bought.ok, true);
  let state = bought.state;
  state.round = 3;
  const moved = applyAction(state, { type: 'move', uid: state.pieces[0].uid, row: 9, col: 3 });
  assert.equal(moved.ok, true, moved.error?.message);
  const ready = applyAction(moved.state, { type: 'ready' });
  assert.equal(ready.ok, true, ready.error?.message);
  assert.equal(ready.state.round, 4);
  assert.equal(ready.state.phase, 'prize');
  assert.equal(ready.state.offers.some((x) => x.type === 'prize' && x.tier === 'start'), true);
});

test('pool copies follow Battlegrounds by tier (15/15/13/11/9/7), by the tier an operator has in this mode', () => {
  const state = createSession({ seed: 5, difficulty: 'NORMAL' });
  const catalog = getCatalog();
  const want = { 1: 15, 2: 15, 3: 13, 4: 11, 5: 9, 6: 7 };
  for (const [id, p] of Object.entries(state.pool)) assert.equal(p.cap, want[catalog.operators[id].tier], id);
  const skadi = Object.values(catalog.operators).find((x) => !x.elite && x.name === '斯卡蒂');
  assert.equal(state.pool[skadi.chessId].cap, 15, 'moved to tier 1');
});
