import test from 'node:test';
import assert from 'node:assert/strict';
import { grantEquipment, equipItem, mergeItems, pieceEquipmentCount, totalEquipmentLevel } from '../../server/modes/independent/equipment.js';

const catalog = {
  badges: { precision: { id: 'precision', kind: '徽章', level: 1, unique: false, slotCost: 1 } },
  equipment: {
    'gear-a': { id: 'gear-a', sourceId: 'gear-a', kind: '战斗装备', level: 2, eliteLevel: 5, eliteId: 'gear-a-b', unique: true, uniqueKey: 'gear-a', inheritable: true },
    'gear-b': { id: 'gear-b', sourceId: 'gear-b', kind: '战斗装备', level: 1, eliteLevel: 3, eliteId: 'gear-b-b', unique: false, inheritable: true },
  },
};
const state = () => ({ nextUid: 1, inventory: [], pieces: [{ uid: 'p1', equipment: [], attachments: [] }, { uid: 'p2', equipment: [], attachments: [] }] });

test('inventory is uncapped, per-operator equipped quantity is capped, and unique equipment is local to its wearer', () => {
  const s = state(); grantEquipment(s, catalog, 'precision', 120);
  assert.equal(s.inventory[0].quantity, 120);
  grantEquipment(s, catalog, 'gear-a'); grantEquipment(s, catalog, 'gear-a');
  const gearUids = s.inventory.filter((x) => x.id === 'gear-a').map((x) => x.uid);
  equipItem(s, catalog, gearUids[0], 'p1');
  assert.throws(() => equipItem(s, catalog, gearUids[1], 'p1'), /UNIQUE/);
  equipItem(s, catalog, gearUids[1], 'p2');
  assert.equal(s.pieces[0].equipment.length, 1);
  assert.equal(s.pieces[1].equipment.length, 1);
});

test('same-stack and two-stack items merge into an elite item without losing leftovers', () => {
  const s = state(); grantEquipment(s, catalog, 'gear-b', 3);
  const stack = s.inventory[0]; const elite = mergeItems(s, catalog, stack.uid, stack.uid);
  assert.equal(stack.quantity, 1);
  assert.equal(elite.id, 'gear-b'); assert.equal(elite.elite, true);
  assert.equal(s.inventory.reduce((n, x) => n + x.quantity, 0), 2);
  assert.equal(totalEquipmentLevel({ equipment: [{ id: elite.id, elite: true, quantity: 1 }] }, catalog), 3);
});

test('wearer equipment capacity counts items rather than slotCost', () => {
  const s = state(); grantEquipment(s, catalog, 'precision', 101);
  s.pieces[0].equipment = [{ uid: 'w', id: 'precision', quantity: 999 }];
  assert.equal(pieceEquipmentCount(s.pieces[0]), 999);
  assert.throws(() => equipItem(s, catalog, s.inventory[0].uid, 'p1', 3), /CAPACITY/);
});
