// 2026-10-06: the stock holds 20 tiles, one per item however many it holds. Gear that would need a 21st tile is not
// stored and its production row says lost; more of a kind already there still stacks; a prize kept for later takes no
// tile. Since 2026-10-07 gear has one form only (「装备不再有精锐形态」): no 合成精锐.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { getData } from '../../server/data.js';
import { grantEquipment, inventoryTiles, INVENTORY_CAPACITY } from '../../server/modes/independent/equipment.js';
import { independentDisplayCatalog } from '../../server/modes/independent/http.js';

const data = getData({ log: { info() {}, warn() {}, error() {} } });
const catalog = getCatalog(data);
/** Twenty distinct kinds of wearable gear (badges and non-unique legacy gear first). */
const kinds = Object.values({ ...catalog.badges, ...catalog.equipment })
  .filter((d) => d.available !== false && d.mechanism !== 'disabled' && d.mechanism !== 'badge' && !['停用', 'permit', '补给', '玩家设施'].includes(d.kind))
  .map((d) => d.id);

function fullStock() {
  const state = createSession({ seed: 5 });
  for (const id of kinds.slice(0, INVENTORY_CAPACITY)) grantEquipment(state, catalog, id, 1, { origin: 'test' });
  return state;
}

test('the stock holds 20 kinds; a 21st is not stored and its row says lost', () => {
  assert.equal(INVENTORY_CAPACITY, 20);
  assert.equal(independentDisplayCatalog(data, catalog).rules.inventoryCapacity, 20);
  const state = fullStock();
  assert.equal(inventoryTiles(state, catalog), 20);
  const extra = kinds[INVENTORY_CAPACITY];
  const res = grantEquipment(state, catalog, extra, 2, { origin: 'native', sourceUid: 'p1', phase: 'prepEnd' });
  assert.deepEqual(res, { id: extra, quantity: 0, lost: 2 });
  assert.ok(!state.inventory.some((x) => x.id === extra));
  assert.deepEqual(state.production.at(-1), { round: 1, revision: 1, id: extra, quantity: 2, origin: 'native', phase: 'prepEnd', sourceUid: 'p1', lost: true });
});

test('more of a kind already in the stock still goes in', () => {
  const state = fullStock();
  const precision = state.inventory.find((x) => x.id === 'precision');
  assert.ok(precision, 'precision is one of the twenty');
  grantEquipment(state, catalog, 'precision', 5, { origin: 'test' });
  assert.equal(precision.quantity, 6);
  assert.equal(inventoryTiles(state, catalog), 20);
});

test('a prize kept for later takes no tile', () => {
  const state = fullStock();
  state.inventory.push({ uid: `i${state.nextUid++}`, id: 'additional-procurement-budget', quantity: 1, state: {} });
  assert.equal(inventoryTiles(state, catalog), 20);
});

test('gear has one form only: no 合成精锐, and an old elite copy shares its kind\'s tile (owner 2026-10-07)', () => {
  const state = fullStock();
  const kind = state.inventory.find((x) => x.id !== 'precision' && !catalog.equipment[x.id]?.unique) || state.inventory[0];
  state.inventory.push({ uid: `i${state.nextUid++}`, id: kind.id, elite: true, quantity: 1, state: {} });
  assert.equal(inventoryTiles(state, catalog), 20, 'the elite copy takes no tile of its own');
  const merge = applyAction(state, { type: 'merge-item', firstUid: kind.uid, secondUid: kind.uid });
  assert.equal(merge.ok, false); assert.equal(merge.error.code, 'UNKNOWN_ACTION');
  const after = applyAction(state, { type: 'freeze' });
  assert.equal(after.ok, true, after.error?.message);
  assert.ok(!after.state.inventory.some((x) => x.elite));
  assert.equal(inventoryTiles(after.state, catalog), 20);
});
