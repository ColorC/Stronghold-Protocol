// 徽章落点 (user 2026-10-06: 「徽章直接落点，装备进库存」): an operator's own badges go straight onto an operator, gear and
// prizes still go to the stock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { grantEquipment, landingPiece } from '../../server/modes/independent/equipment.js';
import { runNativeHook } from '../../server/modes/independent/native.js';

const base = getCatalog();
const landing = (mode) => ({ ...base, rules: { ...base.rules, badgeLanding: mode } });
// 普罗旺斯 / 德克萨斯 are 叙拉古, 刺玫 is 维多利亚
const piece = (uid, chessId, row, col, extra = {}) => ({ uid, chessId, row, col, dir: 'RIGHT', equipment: [], attachments: [], nativeState: {}, ...extra });
const stateWith = (pieces) => ({ round: 1, revision: 0, nextUid: 100, inventory: [], production: [], pieces });

test('with landing on, a badge an operator makes is worn by it; gear and prizes still go to the stock', () => {
  const catalog = landing('self');
  const maker = piece('p1', 'chess_char_1_07_a', 10, 3);
  const state = stateWith([maker]);
  assert.deepEqual(grantEquipment(state, catalog, 'precision', 2, { origin: 'native', sourceUid: 'p1', phase: 'gain' }), { id: 'precision', quantity: 2, worn: 'p1' });
  grantEquipment(state, catalog, 'precision', 1, { origin: 'native', sourceUid: 'p1', phase: 'prepEnd' });
  assert.deepEqual(maker.equipment.map((x) => [x.id, x.quantity]), [['precision', 3]]);
  assert.equal(state.inventory.length, 0);
  assert.deepEqual(state.production.at(-1), { round: 1, revision: 1, id: 'precision', quantity: 1, origin: 'native', phase: 'prepEnd', sourceUid: 'p1', worn: true, targetUid: 'p1' });
  grantEquipment(state, catalog, 'chess_item_1_03_e_a', 1, { origin: 'native', sourceUid: 'p1' });
  grantEquipment(state, catalog, 'vitality', 3, { origin: 'prize', phase: 'prize', prizeId: 'x' });
  assert.deepEqual(state.inventory.map((x) => x.id).sort(), ['chess_item_1_03_e_a', 'vitality']);
});

test('landing off (the default) keeps the stock flow', () => {
  const state = stateWith([piece('p1', 'chess_char_1_07_a', 10, 3)]);
  grantEquipment(state, base, 'precision', 2, { origin: 'native', sourceUid: 'p1' });
  assert.equal(state.pieces[0].equipment.length, 0);
  assert.deepEqual(state.inventory.map((x) => [x.id, x.quantity]), [['precision', 2]]);
});

test('front, adjacent and faction-lowest pick their operator, and fall back to the maker', () => {
  const catalog = landing('self');
  const maker = piece('a', 'chess_char_1_07_a', 10, 3);
  const front = piece('b', 'chess_char_1_06_a', 10, 4, { equipment: [{ uid: 'x', id: 'precision', quantity: 5 }] });
  const below = piece('c', 'chess_char_1_08_a', 11, 3);
  const benched = piece('d', 'chess_char_1_08_a', null, null);
  const state = stateWith([maker, front, below, benched]);
  assert.equal(landingPiece(state, catalog, maker, 'front'), front);
  assert.equal(landingPiece(state, catalog, maker, 'adjacent'), below, 'the neighbour wearing the least');
  assert.equal(landingPiece(state, catalog, maker, 'factionLowest'), maker, 'tie between the two 叙拉古 on the field goes by uid');
  maker.equipment.push({ uid: 'y', id: 'agility', quantity: 1 });
  assert.equal(landingPiece(state, catalog, maker, 'factionLowest'), below);
  assert.equal(landingPiece(state, catalog, below, 'front'), below, 'nobody in front: the maker');
  assert.equal(landingPiece(state, catalog, benched, 'adjacent'), benched, 'off the field: the maker');
});

test('a trait rule names where its badges land (params.landOn)', () => {
  const catalog = landing('self');
  const op = catalog.operators.chess_char_1_02_a; // 角峰: <获得时> 坚守徽章
  const rules = op.nativeTrait.effect.prep.map((r) => ({ ...r, params: { ...r.params, landOn: 'front' } }));
  const custom = { ...catalog, operators: { ...catalog.operators, chess_char_1_02_a: { ...op, nativeTrait: { ...op.nativeTrait, effect: { ...op.nativeTrait.effect, prep: rules } } } } };
  const maker = piece('a', 'chess_char_1_02_a', 10, 3);
  const front = piece('b', 'chess_char_1_06_a', 10, 4);
  const state = stateWith([maker, front]);
  const services = { catalog: custom, data: null, rng: () => 0, grantEquipment: (s, id, n, extra) => grantEquipment(s, custom, id, n, extra), recordProduction: () => {} };
  runNativeHook(state, 'gain', { piece: maker }, services);
  assert.deepEqual(front.equipment.map((x) => x.id), ['vitality']);
  assert.equal(maker.equipment.length, 0);
  assert.equal(state.inventory.length, 0);
});
