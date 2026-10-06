import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { independentDisplayCatalog } from '../../server/modes/independent/http.js';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';
import { playSeed } from '../../tools/independent-balance.mjs';
import { prepView, canDrop, legalTilesOf, benchLayout, groupEquipment, inventoryStacks, forecastRows, formEntry, renderChessId,
  inheritedLevel, itemLevel, pendingOffer, frameAt, HAND_SLOTS, BADGE_BOND } from '../../public/js/independent/model.js';

const data = getData({ log: { info() {}, warn() {}, error() {} } });
const catalog = getCatalog(data);
const display = independentDisplayCatalog(data, catalog);
const view = (state) => viewSession(state, { data, catalog });

test('the renderer gets integer uids, golden elites and only the first 10 bench pieces; the rest are listed', () => {
  const game = playSeed({ seed: 2, route: 'assault', difficulty: 'NORMAL', roundLimit: 14 });
  const v = view(game.state);
  const prep = prepView(v, display);
  const bench = v.pieces.filter((p) => p.row === null);
  assert.equal(prep.hand.length, HAND_SLOTS);
  assert.ok(prep.temp.every((x) => x === null), 'the temp row (临时整备区) stays empty');
  assert.equal(prep.hand.filter(Boolean).length, Math.min(HAND_SLOTS, bench.length));
  assert.equal(benchLayout(v).overflow.length, Math.max(0, bench.length - HAND_SLOTS));
  assert.equal(prep.board.length, v.pieces.filter((p) => p.row !== null).length);
  for (const piece of prep.board) {
    assert.ok(Number.isInteger(piece.uid));
    const source = v.pieces.find((p) => Number(p.uid.slice(1)) === piece.uid);
    assert.equal(piece.golden, !!source.elite);
    assert.equal(piece.id, renderChessId(display, source));
    assert.ok(data.chess[piece.id] || Object.values(data.chess).some((c) => c.chessId === piece.id), `${piece.id} is drawable`);
  }
});

test('drops follow the server legal tiles and never land on another piece', () => {
  let state = createSession({ seed: 1, difficulty: 'FUNNY', roundLimit: 9 });
  const slot = state.shop.slots.findIndex((x) => x.kind === 'chess');
  state = applyAction(state, { type: 'buy', slot }).state;
  const v = view(state);
  const piece = v.pieces[0]; const n = Number(piece.uid.slice(1));
  const [r, c] = piece.legalTiles[0].split(',').map(Number);
  assert.equal(canDrop(v, n, { area: 'board', row: r, col: c }), true);
  assert.equal(canDrop(v, n, { area: 'board', row: 0, col: 0 }), false);
  assert.equal(canDrop(v, n, { area: 'hand', idx: 3 }), false, 'a bench piece is already on the bench');
  assert.equal(legalTilesOf(v, n).length, piece.legalTiles.length);
  const moved = view(applyAction(state, { type: 'move', uid: piece.uid, row: r, col: c, dir: 'RIGHT' }).state);
  assert.equal(canDrop(moved, n, { area: 'hand', idx: 0 }), true);
  assert.ok(legalTilesOf(moved, n).some(([a, b]) => a === r && b === c), 'its own tile stays a legal drop');
});

test('badges merge per kind, functional gear stays one row per item, levels add up', () => {
  const items = [{ uid: 'i1', id: 'precision', quantity: 4 }, { uid: 'i2', id: 'precision', quantity: 6 }, { uid: 'i3', id: 'agility', quantity: 2 },
    { uid: 'i4', id: 'chess_item_3_02_e_a', quantity: 1 }];
  const rows = groupEquipment(items, display);
  assert.equal(rows[0].badge, false, 'functional gear first');
  const precision = rows.find((r) => r.id === 'precision');
  assert.equal(precision.count, 10);
  assert.equal(rows.length, 3);
  assert.equal(itemLevel({ id: 'precision', quantity: 10 }, display), 10);
  for (const id of Object.keys(BADGE_BOND)) assert.ok(display.gear[id], `badge ${id} is in the catalog`);
});

test('inventory stacks name prizes kept for later and mark what is used rather than worn', () => {
  const stacks = inventoryStacks([{ uid: 'i9', id: 'additional-procurement-budget', quantity: 1 }, { uid: 'i8', id: 'chess_item_1_03_e_a', quantity: 2 },
    { uid: 'i7', id: 'vitality', quantity: 3 }], display);
  const prize = stacks.find((s) => s.id === 'additional-procurement-budget');
  assert.equal(prize.name, '追加采购预算');
  assert.equal(prize.used, true);
  assert.equal(stacks.find((s) => s.id === 'chess_item_1_03_e_a').used, true);
  assert.equal(stacks.find((s) => s.id === 'vitality').used, false);
  assert.ok(!stacks.some((s) => /^[a-z-]+$/.test(s.name)), 'no internal id reaches the player');
});

test('the forecast rows name their sources; idle prep-end producers are listed apart', () => {
  const game = playSeed({ seed: 2, route: 'assault', difficulty: 'NORMAL', roundLimit: 14 });
  let state = createSession({ seed: 2, difficulty: 'NORMAL', roundLimit: 14 });
  let checked = 0;
  for (const action of game.actionLog) {
    if (action.type === 'ready') {
      const v = view(state);
      const f = forecastRows(v, display);
      for (const row of f.rows) assert.ok(v.pieces.some((p) => p.uid === row.sourceUid));
      for (const p of f.idle) assert.ok(!f.rows.some((r) => r.sourceUid === p.uid));
      checked += f.rows.length;
    }
    state = applyAction(state, action).state;
  }
  assert.ok(checked > 5);
});

test('inheritance level after = own + transferable donor gear − the dropped side of each unique conflict', () => {
  const receiver = { equipmentLevel: 4, equipment: [{ uid: 'r1', id: 'precision', quantity: 4 }] };
  const donor = { equipment: [{ uid: 'd1', id: 'agility', quantity: 3 }, { uid: 'd2', id: 'vitality', quantity: 2 }] };
  assert.equal(inheritedLevel(receiver, donor, { ok: true, destroyedEquipment: [{ uid: 'd2' }] }, {}, display), 7);
  const conflict = { ok: true, destroyedEquipment: [], equipmentConflicts: [{ id: 'x', donorUid: 'd1', receiverUid: 'r1' }] };
  assert.equal(inheritedLevel(receiver, donor, conflict, {}, display), null, 'open conflict');
  assert.equal(inheritedLevel(receiver, donor, conflict, { x: 'donor' }, display), 4 + 5 - 4);
  assert.equal(inheritedLevel(receiver, donor, conflict, { x: 'receiver' }, display), 4 + 5 - 3);
});

test('offers: a merge first; replay frames are found by time', () => {
  assert.equal(pendingOffer({ offers: [{ type: 'prize', id: 'a' }, { type: 'operatorMerge', id: 'b' }] }).id, 'b');
  assert.equal(pendingOffer({ offers: [] }), null);
  const frames = [0, 0.1, 0.2, 0.3].map((t) => ({ snap: { t } }));
  assert.equal(frameAt(frames, 0.15), 1);
  assert.equal(frameAt(frames, -1), -1);
  assert.equal(frameAt(frames, 9), 3);
  assert.equal(formEntry(display, { chessId: Object.keys(display.operators).find((id) => display.operators[id].eliteChessId), elite: true }).elite, true);
});
