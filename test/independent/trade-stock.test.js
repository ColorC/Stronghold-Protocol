import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventoryStackKey, inventoryStackGroups, INVENTORY_STACK_LIMIT, quantityEquippable } from '../../shared/independentInventory.js';
import { inheritanceQualification } from '../../shared/independentRules.js';
import { grantEquipment, equipItem, inventoryTiles, inventoryRoomFor, hasTileFor, normalizeGearForms } from '../../server/modes/independent/equipment.js';
import { previewInheritance, applyInheritance } from '../../server/modes/independent/inheritance.js';
import { createSession, applyAction, viewSession, validateSession } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';

const gear = (id, extra = {}) => ({ id, kind: 'equipment', mechanism: 'stats', unique: false, available: true, ...extra });
const catalog = { equipment: { a: gear('a'), single: gear('single', { unique: true }), event: gear('event', { mechanism: 'combatEquipment' }) }, badges: {}, config: { bodyPenalty: { baseAttackRatio: .8, baseLifeRatio: .8 } }, attachments: {}, operators: {
  carrier: { tier: 1, source: { normalChess: { profession: 'GUARD', bonds: [], stats: { atk: 100, maxHp: 1000 } } } },
  partner: { tier: 2, nativeFactionTags: ['炎'], source: { normalChess: { profession: 'SNIPER', bonds: [], stats: { atk: 100, maxHp: 1000 } } } },
} };
const fresh = () => ({ nextUid: 1, round: 1, revision: 0, inventory: [], pieces: [{ uid: 'p1', equipment: [], attachments: [] }] });

test('999 per configuration-compatible stock tile; overflow keeps every stored/lost unit traceable', () => {
  const s = fresh();
  assert.deepEqual(grantEquipment(s, catalog, 'a', 1000), { id: 'a', quantity: 1000 });
  assert.deepEqual(s.inventory.map(x => x.quantity), [999, 1]);
  assert.equal(inventoryTiles(s, catalog), 2);
  grantEquipment(s, catalog, 'a', 999 * 18 - 1);
  assert.equal(inventoryTiles(s, catalog), 19);
  assert.equal(inventoryRoomFor(s, catalog, 'a'), 999);
  assert.deepEqual(grantEquipment(s, catalog, 'a', 1000), { id: 'a', quantity: 999, lost: 1 });
  assert.equal(inventoryTiles(s, catalog), 20);
  assert.equal(s.inventory.reduce((n, x) => n + x.quantity, 0), 999 * 20);
  assert.ok(s.inventory.every(x => x.quantity <= 999));
  assert.equal(hasTileFor(s, catalog, 'a'), false);
  assert.deepEqual(s.production.slice(-2).map(x => [x.quantity, !!x.lost]), [[999, false], [1, true]]);
  equipItem(s, catalog, s.inventory[0].uid, 'p1', 2);
  assert.equal(hasTileFor(s, catalog, 'a'), true);
  assert.equal(inventoryRoomFor(s, catalog, 'a'), 2);
  assert.deepEqual(grantEquipment(s, catalog, 'a', 3), { id: 'a', quantity: 2, lost: 1 });
});

test('unique stock stacks but wearer uniqueness and event-mechanism single selection remain enforced', () => {
  const s = fresh();
  grantEquipment(s, catalog, 'single', 1000);
  assert.deepEqual(s.inventory.map(x => x.quantity), [999, 1]);
  const uid = s.inventory[0].uid;
  assert.throws(() => equipItem(s, catalog, uid, 'p1', 2), /UNIQUE_QUANTITY/);
  equipItem(s, catalog, uid, 'p1');
  assert.throws(() => equipItem(s, catalog, uid, 'p1'), /UNIQUE/);
  grantEquipment(s, catalog, 'event', 2);
  assert.throws(() => equipItem(s, catalog, s.inventory.at(-1).uid, 'p1', 2), /SINGLE_EQUIP_ONLY/);
  assert.equal(quantityEquippable(catalog.equipment.event), false);
});

test('configuration state survives granting and legacy normalisation; order of object keys is compatible', () => {
  const s = fresh();
  grantEquipment(s, catalog, 'a', 3, { state: { faction: '炎', picks: ['x'], counter: { n: 2, round: 1 } } });
  grantEquipment(s, catalog, 'a', 4, { state: { counter: { round: 1, n: 2 }, picks: ['x'], faction: '炎' } });
  grantEquipment(s, catalog, 'a', 5, { state: { faction: '炎', picks: ['y'], counter: { n: 2, round: 1 } } });
  assert.deepEqual(s.inventory.map(x => x.quantity), [7, 5]);
  assert.equal(inventoryTiles(s, catalog), 2);
  s.inventory[1].elite = true;
  normalizeGearForms(s, catalog);
  assert.deepEqual(s.inventory.map(x => x.quantity), [7, 5]);
  assert.deepEqual(s.inventory[1].state.picks, ['y']);
  s.inventory[0].quantity = 1999;
  const uid = s.inventory[0].uid;
  assert.equal(inventoryTiles(s, catalog), 4);
  equipItem(s, catalog, uid, 'p1', 10);
  assert.equal(s.inventory.find(x => x.uid === uid).quantity, 1989);
  assert.equal(s.pieces[0].equipment[0].quantity, 10);
});

test('qualification is symmetric for new partner limits and both legacy directions; native identity only', () => {
  for (const params of [
    { partnerTiers: [2], partnerMaxTier: 2, partnerProfession: 'SNIPER', partnerFaction: '炎' },
    { direction: '给予', receiverTiers: [2], receiverProfession: 'SNIPER', receiverFaction: '炎' },
    { direction: '接收', donorTiers: [2], donorProfession: 'SNIPER', donorFaction: '炎' },
  ]) {
    const c = structuredClone(catalog);
    c.equipment.permit = gear('permit', { mechanism: 'inheritancePermit', inheritable: false, params });
    const carrier = { uid: 'c', chessId: 'carrier', row: 0, col: 0, equipment: [{ uid: 'permit', id: 'permit', quantity: 1 }], attachments: [] };
    const partner = { uid: 'p', chessId: 'partner', row: 0, col: 1, equipment: [{ uid: 'payload', id: 'a', quantity: 2 }], attachments: [] };
    assert.equal(inheritanceQualification(carrier, partner, c).allowed, true);
    assert.equal(inheritanceQualification(partner, carrier, c).allowed, true);
    c.operators.partner.tier = 3;
    assert.equal(inheritanceQualification(carrier, partner, c).allowed, false, 'out-of-scope technology is rejected');
    c.operators.partner.tier = 2;
    c.operators.partner.source.normalChess.profession = 'GUARD';
    assert.equal(inheritanceQualification(partner, carrier, c).allowed, false, 'out-of-scope profession is rejected in reverse direction');
    c.operators.partner.source.normalChess.profession = 'SNIPER';
    for (const [donor, receiver] of [[carrier, partner], [partner, carrier]]) {
      const s = { pieces: structuredClone([carrier, partner]), pool: { [donor.chessId]: { cap: 5, left: 4 } } };
      assert.equal(previewInheritance(s, c, donor.uid, receiver.uid).ok, true);
      const result = applyInheritance(s, c, donor.uid, receiver.uid);
      assert.equal(s.pieces.length, 1);
      assert.equal(result.receiver.uid, receiver.uid);
      assert.equal(s.pool[donor.chessId].left, 5);
      assert.equal(result.receiver.bodyPenaltyApplied, true);
      assert.equal(result.receiver.equipment.some(x => x.id === 'a'), true);
    }
    c.operators.partner.nativeFactionTags = ['阿戈尔'];
    c.equipment.identity = gear('identity', { mechanism: 'identityTag' });
    partner.equipment.push({ id: 'identity', state: { faction: '炎' }, quantity: 1 });
    assert.equal(inheritanceQualification(carrier, partner, c).allowed, false);
    assert.equal(inheritanceQualification(partner, carrier, c).allowed, false);
  }
  const c = structuredClone(catalog);
  c.equipment.permit = gear('permit', { mechanism: 'inheritancePermit', params: { partnerMaxTier: 1 } });
  assert.equal(inheritanceQualification({ chessId: 'carrier', equipment: [{ id: 'permit' }] }, { chessId: 'partner', equipment: [] }, c).allowed, false);
});

test('old oversized save, purchase, equip, use-item and symmetric view aliases use the native transaction', () => {
  const real = getCatalog();
  let state = createSession({ seed: 20261007, openFactions: null });
  state.inventory = [{ uid: 'old-stock', id: 'precision', quantity: 1999, state: {} }];
  state.funds = 99;
  state.shop.slots[0] = { kind: 'equipment', id: 'precision', price: 1, sold: false };
  let result = applyAction(state, { type: 'buy', slot: 0 });
  assert.equal(result.ok, true, result.error?.message);
  state = result.state;
  assert.equal(state.inventory.find(x => x.uid === 'old-stock').quantity, 1999);
  assert.equal(state.inventory.reduce((n, x) => n + x.quantity, 0), 2000);
  assert.equal(inventoryTiles(state, real), 3);
  assert.deepEqual(validateSession(state), []);
  const names = ['斯卡蒂', '幽灵鲨']; // current automatic permit; retired IDs remain covered by synthetic legacy fixtures
  for (const name of names) {
    const op = Object.values(real.operators).find(x => !x.elite && x.name === name);
    state.shop.slots[0] = { kind: 'chess', id: op.chessId, price: 3, sold: false, equipment: [] };
    result = applyAction(state, { type: 'buy', slot: 0 });
    assert.equal(result.ok, true, result.error?.message); state = result.state;
  }
  const [first, second] = state.pieces.slice(-2);
  result = applyAction(state, { type: 'equip', itemUid: 'old-stock', targetUid: first.uid, quantity: 2 });
  assert.equal(result.ok, true, result.error?.message); state = result.state;
  assert.equal(state.inventory.find(x => x.uid === 'old-stock').quantity, 1997);
  const view = viewSession(state);
  assert.deepEqual(view.pieces.find(x => x.uid === first.uid).handover, { give: [second.uid], take: [second.uid] });
  const supply = Object.values(real.equipment).find(x => x.available !== false && ['immediateFundsOnUse', 'fundsOnUse', 'deferredFundsOnUse'].includes(x.mechanism));
  assert.ok(supply, 'the catalog has a usable funds supply');
  grantEquipment(state, real, supply.id, 1, { origin: 'test' });
  const item = state.inventory.find(x => x.id === supply.id);
  const used = applyAction(state, { type: 'use-item', itemUid: item.uid });
  assert.equal(used.ok, true, used.error?.message);
  assert.ok(!used.state.inventory.some(x => x.uid === item.uid));
});

test('the same pure inventory module imports in a browser module context', async () => {
  const source = readFileSync(new URL('../../shared/independentInventory.js', import.meta.url), 'utf8');
  const browserModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const items = [{ uid: 'a', id: 'x', quantity: 1000, state: { picks: ['x'], faction: '炎' } }, { uid: 'b', id: 'x', quantity: 5, state: { faction: '炎', picks: ['y'] } }];
  assert.equal(browserModule.INVENTORY_STACK_LIMIT, INVENTORY_STACK_LIMIT);
  assert.deepEqual(browserModule.inventoryStackGroups(items), inventoryStackGroups(items));
  assert.equal(browserModule.inventoryStackKey(items[0]), inventoryStackKey(items[0]));
});

test('wolf whistle uniqueness survives real equip, three-copy merge and handover transactions', () => {
  const real = getCatalog(); const id = 'independent:叙拉古狼嚎哨';
  assert.equal(real.equipment[id].unique, true);
  assert.equal(real.equipment[id].inheritable, false);
  const op = Object.values(real.operators).find(x => !x.elite && x.name === '角峰');
  let state = createSession({ seed: 20261007, openFactions: null }); state.funds = 99;
  const chosen = [];
  for (let i = 0; i < 3; i++) {
    state.shop.slots[0] = { kind: 'chess', id: op.chessId, price: 3, sold: false, equipment: [] };
    let result = applyAction(state, { type: 'buy', slot: 0 });
    assert.equal(result.ok, true, result.error?.message); state = result.state;
    if (i < 2) {
      grantEquipment(state, real, id, 2);
      const itemUid = state.inventory.find(x => x.id === id).uid;
      const targetUid = state.pieces[i].uid;
      result = applyAction(state, { type: 'equip', itemUid, targetUid });
      assert.equal(result.ok, true, result.error?.message); state = result.state;
      chosen.push(state.pieces[i].equipment.find(x => x.id === id).uid);
      const duplicate = applyAction(state, { type: 'equip', itemUid, targetUid });
      assert.equal(duplicate.ok, false); assert.equal(duplicate.error.code, 'UNIQUE');
    }
  }
  const offer = state.offers.find(x => x.type === 'operatorMerge');
  assert.ok(offer?.conflicts.equipment.some(x => x.key === id || x.id === id || x.choices.some(y => y.id === id)), JSON.stringify(offer?.conflicts));
  const invalid = applyAction(state, { type: 'choose', offerId: offer.id, uniqueSelections: {} });
  assert.equal(invalid.ok, false); assert.equal(invalid.error.code, 'NEED_UNIQUE_SELECTION');
  const merged = applyAction(state, { type: 'choose', offerId: offer.id, uniqueSelections: { [id]: chosen[0] } });
  assert.equal(merged.ok, true, merged.error?.message);
  assert.equal(merged.state.pieces[0].equipment.filter(x => x.id === id).length, 1);

  const c = structuredClone(catalog); c.equipment[id] = real.equipment[id];
  c.equipment.permit = gear('permit', { mechanism: 'inheritancePermit', inheritable: false, params: { partnerTiers: [2] } });
  const donor = { uid: 'd', chessId: 'carrier', row: 0, col: 0, equipment: [{ id: 'permit', quantity: 1 }, { uid: 'wd', id, quantity: 1 }], attachments: [] };
  const receiver = { uid: 'r', chessId: 'partner', row: null, col: null, equipment: [{ uid: 'wr', id, quantity: 1 }], attachments: [] };
  const s = { pieces: [donor, receiver], pool: {} };
  const handover = previewInheritance(s, c, 'd', 'r');
  assert.ok(handover.destroyedEquipment.some(x => x.uid === 'wd'));
  assert.ok(!handover.transferredEquipment.some(x => x.id === id));
  applyInheritance(s, c, 'd', 'r');
  assert.deepEqual(s.pieces[0].equipment.filter(x => x.id === id).map(x => x.uid), ['wr']);
});
