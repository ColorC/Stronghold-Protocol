// 2026-10-06: the stock holds 20 tiles, one per item and grade however many it holds. Gear that would need a 21st tile
// is not stored and its production row says lost; more of a kind already there still stacks; a prize kept for later
// takes no tile; merging two normal copies into an elite one needs a tile only when it opens a new one.
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
  const state = createSession({ seed: 5, openFactions: null });
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

test('merging into an elite copy needs a tile only when it opens a new one', () => {
  const state = fullStock();
  const mergeable = Object.values(catalog.equipment).find((d) => d.available !== false && !d.unique && d.eliteLevel && kinds.slice(0, 20).includes(d.id) && !['补给', '玩家设施'].includes(d.kind));
  assert.ok(mergeable, 'a mergeable kind among the twenty');
  grantEquipment(state, catalog, mergeable.id, 2, { origin: 'test' }); // 3 normal copies: one stays, the elite needs a tile
  const item = state.inventory.find((x) => x.id === mergeable.id);
  const full = applyAction(state, { type: 'merge-item', firstUid: item.uid, secondUid: item.uid });
  assert.equal(full.ok, false); assert.equal(full.error.code, 'INVENTORY_FULL');
  item.quantity = 2; // the last two: their tile becomes the elite one
  const swapped = applyAction(state, { type: 'merge-item', firstUid: item.uid, secondUid: item.uid });
  assert.equal(swapped.ok, true, swapped.error?.message);
  assert.equal(inventoryTiles(swapped.state, catalog), 20);
});
