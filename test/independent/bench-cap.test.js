// 整备区上限 (user 2026-10-07 chose the original's 10 + 5): the bench holds 10, rewards overflow into a 5-place 临时整备区
// that keeps the battle from starting, and with both full a gained operator goes back to the pool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, BENCH_SIZE, TEMP_SIZE, benchCount, tempCount } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';

const catalog = getCatalog();
const ordinary = Object.values(catalog.operators).filter((x) => !x.elite);
const piece = (uid, chessId, extra = {}) => ({ uid, chessId, elite: false, row: null, col: null, dir: 'RIGHT', skillIndex: 0, moduleId: 'none', equipment: [], attachments: [], nativeState: {}, bodyPenaltyApplied: false, poolCopies: 1, ...extra });
/** A session whose bench holds `n` operators, all different (no merge can happen). */
function withBench(n, extra = 0) {
  const state = createSession({ seed: 11, difficulty: 'NORMAL' });
  state.funds = 50;
  for (let i = 0; i < n; i++) state.pieces.push(piece(`b${i}`, ordinary[i].chessId));
  for (let i = 0; i < extra; i++) state.pieces.push(piece(`t${i}`, ordinary[n + i].chessId, { temp: true }));
  return state;
}
const fresh = (state) => ordinary.find((op) => !state.pieces.some((p) => p.chessId === op.chessId) && state.pool[op.chessId]?.left > 0).chessId;

test('a full bench refuses a purchase, unless it completes an elite', () => {
  const state = withBench(BENCH_SIZE);
  state.shop.slots[0] = { kind: 'chess', id: fresh(state), price: 3, sold: false, equipment: [] };
  assert.equal(applyAction(state, { type: 'buy', slot: 0 }).error?.code, 'BENCH_FULL');
  // two copies of one in this game's pool already there → the third completes the elite
  const pair = fresh(state);
  state.pieces[0] = piece('b0', pair); state.pieces[1] = piece('b1', pair);
  state.shop.slots[0] = { kind: 'chess', id: pair, price: 3, sold: false, equipment: [] };
  const r = applyAction(state, { type: 'buy', slot: 0 });
  assert.equal(r.ok, true, r.error?.message);
  const eliteId = catalog.operators[state.pieces[0].chessId].eliteChessId;
  assert.ok(r.state.pieces.some((p) => p.elite && p.chessId === eliteId), 'the three copies became the elite');
  assert.equal(benchCount(r.state), BENCH_SIZE - 1);
});

test('a reward overflows into the 临时整备区, which keeps the battle from starting and empties when a place frees up', () => {
  const state = withBench(BENCH_SIZE);
  const id = fresh(state);
  state.offers.push({ id: 'o-test', type: 'recruit', choices: [id], source: 'prize' });
  let r = applyAction(state, { type: 'choose', offerId: 'o-test', index: 0 });
  assert.equal(r.ok, true, r.error?.message);
  assert.equal(tempCount(r.state), 1);
  const gained = r.state.pieces.find((p) => p.chessId === id);
  assert.equal(gained.temp, true);
  assert.equal(applyAction(r.state, { type: 'ready' }).error?.code, 'TEMP_NOT_EMPTY');
  r = applyAction(r.state, { type: 'sell', uid: 'b0' });
  assert.equal(r.ok, true, r.error?.message);
  assert.equal(tempCount(r.state), 0, 'moved onto the freed bench place');
  assert.equal(benchCount(r.state), BENCH_SIZE);
});

test('with the bench and the 临时整备区 both full, a gained operator goes back to the pool', () => {
  const state = withBench(BENCH_SIZE, TEMP_SIZE);
  const id = fresh(state);
  const left = state.pool[id].left;
  state.offers.push({ id: 'o-test', type: 'recruit', choices: [id], source: 'prize' });
  const r = applyAction(state, { type: 'choose', offerId: 'o-test', index: 0 });
  assert.equal(r.ok, true, r.error?.message);
  assert.ok(!r.state.pieces.some((p) => p.chessId === id));
  assert.equal(r.state.pool[id].left, left);
  assert.ok(r.events.some((e) => e.type === 'no-room' && e.chessId === id));
  assert.equal(r.state.offers.length, 0);
});

test('a full bench refuses a withdrawal from the field', () => {
  const state = withBench(BENCH_SIZE);
  state.pieces.push(piece('field', fresh(state), { row: 10, col: 3 }));
  assert.equal(applyAction(state, { type: 'bench', uid: 'field' }).error?.code, 'BENCH_FULL');
});
