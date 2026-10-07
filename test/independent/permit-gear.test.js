// 交接凭证: the twelve inheritance permissions are gear the operator brings when gained. It is worn from the gain on,
// never sold in the shop or drawn at random, folds into one copy when three copies merge, and never moves in a
// handover (the donor's is lost with it). Only worn 交接凭证 decide who may hand over to whom.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, validateSession, viewSession } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { getData } from '../../server/data.js';
import { independentDisplayCatalog } from '../../server/modes/independent/http.js';
import { getIndependentField } from '../../server/modes/independent/battle.js';
import { nativeRecord } from '../../shared/independentRules.js';

const data = getData({ log: { info() {}, warn() {}, error() {} } });
const catalog = getCatalog(data);
const opNamed = (name) => Object.values(catalog.operators).find((x) => !x.elite && x.name === name);
const permits = Object.values(catalog.equipment).filter((x) => x.kind === 'permit');

/** Puts an operator in shop slot 0 and buys it. */
function buy(state, name) {
  const s = structuredClone(state);
  s.funds = 99; s.shop.slots[0] = { kind: 'chess', id: opNamed(name).chessId, elite: false, price: 3, sold: false, equipment: [] };
  const r = applyAction(s, { type: 'buy', slot: 0 });
  assert.equal(r.ok, true, r.error?.message);
  return r.state;
}

test('the twelve permissions are gear: one per operator, on both forms, never in the shop', () => {
  assert.equal(permits.length, 12);
  for (const p of permits) {
    assert.equal(p.inheritable, false); assert.equal(p.unique, true); assert.equal(p.shopEligible, false); assert.equal(p.level, null);
    const op = catalog.operators[p.ownerChessId];
    assert.equal(op.permitGearId, p.id); assert.equal(catalog.operators[op.eliteChessId].permitGearId, p.id);
    assert.ok(['给予', '接收'].includes(p.params.direction));
  }
  assert.equal(Object.values(catalog.operators).filter((x) => x.permitGearId).length, 24);
  assert.ok(!Object.values(catalog.operators).some((x) => x.inheritance));
  assert.equal(catalog.permissions, undefined);
  const display = independentDisplayCatalog(data, catalog);
  const order = display.gear['permit-north-handover-order'];
  assert.equal(order.kind, 'permit'); assert.equal(order.inheritable, false); assert.equal(order.level, null);
  assert.match(order.normal, /科技等级2/);
  assert.equal(display.operators[opNamed('角峰').chessId].permitGear, 'permit-north-handover-order');
  assert.equal(display.terms['handover-permit'].name, '交接凭证');
});

test('the operator wears its 交接凭证 from the gain on, without drawing a uid', () => {
  const start = createSession({ seed: 7, difficulty: 'FUNNY', openFactions: null }); // named operators: every faction open
  const after = buy(start, '角峰');
  const piece = after.pieces.at(-1);
  assert.deepEqual(piece.equipment.filter((x) => x.id.startsWith('permit-')), [{ uid: `permit-${piece.uid}`, id: 'permit-north-handover-order', quantity: 1, state: {}, sourceId: 'permit-north-handover-order' }]);
  const plain = buy(start, '波登可'); // its trait forges later, not on acquisition
  assert.equal(after.nextUid - start.nextUid, plain.nextUid - start.nextUid + 1, '角峰 receives its permit and one gear reward; the maker badge is no longer part of its trait');
  assert.ok(!plain.pieces.at(-1).equipment.length);
  assert.deepEqual(validateSession(after), []);
});

test('three copies merge into one elite that keeps a single 交接凭证 without asking', () => {
  let state = createSession({ seed: 7, difficulty: 'FUNNY', openFactions: null });
  for (let i = 0; i < 3; i++) state = buy(state, '角峰');
  const elites = state.pieces.filter((p) => p.elite);
  assert.equal(elites.length, 1);
  assert.equal(elites[0].equipment.filter((x) => x.id === 'permit-north-handover-order').length, 1);
  assert.ok(!state.offers.some((x) => x.type === 'operatorMerge'));
});

function pair(donorName, receiverName) {
  let state = createSession({ seed: 91, difficulty: 'FUNNY', openFactions: null }); // named operators: every faction open
  state = buy(state, donorName); state = buy(state, receiverName);
  const [donor, receiver] = state.pieces.slice(-2);
  const map = getIndependentField(state).deployMap;
  const tile = [...map].find(([, cls]) => nativeRecord(donor, catalog).position !== 'MELEE' || cls === 'melee');
  [donor.row, donor.col] = tile[0].split(',').map(Number);
  return { state, donor, receiver };
}

test('a donor\'s 交接凭证 is lost with it; the receiver keeps its own', () => {
  const { state, donor, receiver } = pair('角峰', '送葬人');
  const preview = applyAction(state, { type: 'inherit-preview', donorUid: donor.uid, receiverUid: receiver.uid }).events[0].preview;
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.permit, { give: 'permit-north-handover-order', receive: null });
  assert.ok(preview.destroyedEquipment.some((x) => x.id === 'permit-north-handover-order'));
  assert.ok(!preview.transferredEquipment.some((x) => x.id.startsWith('permit-')));
  const done = applyAction(state, { type: 'inherit', donorUid: donor.uid, receiverUid: receiver.uid });
  assert.equal(done.ok, true, done.error?.message);
  assert.ok(!done.state.pieces.some((p) => p.equipment.some((x) => x.id === 'permit-north-handover-order')));

  const other = pair('送葬人', '崖心');
  const r = applyAction(other.state, { type: 'inherit', donorUid: other.donor.uid, receiverUid: other.receiver.uid });
  assert.equal(r.ok, true, r.error?.message);
  assert.deepEqual(r.events[0].preview.permit, { give: null, receive: 'permit-loner-loan' });
  assert.equal(r.state.pieces.find((p) => p.uid === other.receiver.uid).equipment.filter((x) => x.id === 'permit-loner-loan').length, 1);
});

test('the view lists whom each piece may hand over to and take over from', () => {
  const { state, donor, receiver } = pair('角峰', '送葬人');
  const view = viewSession(state, { data, catalog });
  const d = view.pieces.find((p) => p.uid === donor.uid); const r = view.pieces.find((p) => p.uid === receiver.uid);
  assert.deepEqual(d.handover, { give: [receiver.uid], take: [receiver.uid] });
  assert.deepEqual(r.handover, { give: [donor.uid], take: [donor.uid] });
  assert.equal(d.permission, undefined);
});

test('a save from before 交接凭证 were gear gets them on view and on the next action', () => {
  const { state, donor } = pair('角峰', '送葬人');
  donor.equipment = donor.equipment.filter((x) => !x.id.startsWith('permit-'));
  const view = viewSession(state, { data, catalog });
  assert.ok(view.pieces.find((p) => p.uid === donor.uid).equipment.some((x) => x.uid === `permit-${donor.uid}`));
  assert.ok(!donor.equipment.some((x) => x.id.startsWith('permit-')), 'the view does not touch the saved state');
  const moved = applyAction(state, { type: 'freeze' });
  assert.equal(moved.ok, true);
  assert.ok(moved.state.pieces.find((p) => p.uid === donor.uid).equipment.some((x) => x.id === 'permit-north-handover-order'));
  assert.deepEqual(validateSession(moved.state), []);
});

test('a 交接凭证 is equipment: it takes one of the 999 places', () => {
  const state = buy(createSession({ seed: 7, difficulty: 'FUNNY', openFactions: null }), '角峰');
  const piece = state.pieces.at(-1);
  state.inventory.push({ uid: `i${state.nextUid++}`, id: 'precision', quantity: 999, elite: false, state: {} });
  const item = state.inventory.at(-1).uid;
  // 角峰 wears its permit; its named gear reward remains in the stock.
  const worn = piece.equipment.reduce((n, x) => n + Number(x.quantity || 1), 0);
  assert.equal(applyAction(state, { type: 'equip', itemUid: item, targetUid: piece.uid, quantity: 999 - worn + 1 }).error?.code, 'CAPACITY');
  assert.equal(applyAction(state, { type: 'equip', itemUid: item, targetUid: piece.uid, quantity: 999 - worn }).ok, true);
});
