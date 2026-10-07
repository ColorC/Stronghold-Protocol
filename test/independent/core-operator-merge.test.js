import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';

const quiet = { warn() {}, error() {}, info() {} };
const data = getData({ log: quiet });
const catalog = getCatalog(data);
const byName = (name) => Object.values(catalog.operators).find((x) => x.name === name && !x.elite);
function purchaseCopies(name, count, setup = () => {}) {
  let state = createSession({ seed: 83, data, catalog, openFactions: null });
  const op = byName(name);
  assert.ok(op?.eliteChessId, `expected upgradeable ${name}`);
  state.funds = 100;
  for (let i = 0; i < count; i++) {
    const slot = state.shop.slots.findIndex((x) => x.kind === 'chess');
    state.shop.slots[slot] = { kind: 'chess', id: op.chessId, elite: false, price: 3, sold: false, equipment: [] };
    const result = applyAction(state, { type: 'buy', slot }, { data, catalog });
    assert.equal(result.ok, true, result.error?.message);
    state = result.state;
    setup(state, i);
  }
  return { state, op };
}

test('three ordinary purchases merge to same-base elite; copies and gain hooks resolve once per purchase', () => {
  const { state, op } = purchaseCopies('角峰', 3);
  assert.equal(state.pieces.length, 1);
  assert.equal(state.pieces[0].elite, true);
  assert.equal(state.pieces[0].chessId, op.eliteChessId);
  assert.equal(state.counters.gained, 3);
  assert.equal(state.pool[op.chessId].left, state.pool[op.chessId].cap - 3);
  // each 角峰 wore the 生命徽章 it made (徽章落点); the elite keeps what its copies wore
  assert.equal(state.pieces[0].equipment.filter((x) => x.id === 'vitality').reduce((n, x) => n + x.quantity, 0), 3);
  assert.equal(state.inventory.filter((x) => x.id === 'vitality').length, 0);
});

test('Windflit two-copy rule upgrades after two copies through public buys', () => {
  const { state, op } = purchaseCopies('风丸', 2);
  assert.equal(state.pieces.length, 1);
  assert.equal(state.pieces[0].chessId, op.eliteChessId);
  assert.equal(state.pool[op.chessId].left, state.pool[op.chessId].cap - 2);
});

test('unique equipment conflict becomes an explicit merge choice and reports the destroyed item', () => {
  const gear = Object.values(catalog.equipment).find((x) => x.unique && x.available && x.kind === '战斗装备');
  assert.ok(gear);
  const { state } = purchaseCopies('角峰', 3, (s, i) => {
    if (i < 2) s.pieces[i].equipment.push({ uid: `e${900 + i}`, id: gear.id, sourceId: gear.sourceId, quantity: 1, elite: false, state: { counter: 7 + i } });
  });
  const offer = state.offers.find((x) => x.type === 'operatorMerge');
  assert.ok(offer);
  assert.equal(offer.conflicts.equipment[0].choices.length, 2);
  assert.equal(state.pieces.length, 3);
  const result = applyAction(state, { type: 'choose', offerId: offer.id, uniqueSelections: { [gear.uniqueKey || gear.canonicalId || gear.id]: 'e900' } }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.state.pieces.length, 1);
  assert.equal(result.state.pieces[0].elite, true);
  assert.equal(result.state.pieces[0].equipment.find((x) => x.id === gear.id).state.counter, 7);
  // the three copies' own 交接凭证 fold into one without a choice
  assert.equal(offer.conflicts.equipment.length, 1);
  assert.equal(result.state.pieces[0].equipment.filter((x) => x.id === byName('角峰').permitGearId).length, 1);
  assert.deepEqual(result.events.find((x) => x.type === 'operator-merge').destroyedEquipment.map((x) => x.state.counter), [8]);
});

test('duplicate unique attachments require a source-body choice and preserve selected state', () => {
  const attachment = Object.values(catalog.attachments).find((x) => x.unique);
  assert.ok(attachment);
  const { state } = purchaseCopies('角峰', 3, (s, i) => { if (i < 2) s.pieces[i].attachments.push({ id: attachment.id, state: { counter: 30 + i } }); });
  const offer = state.offers.find((x) => x.type === 'operatorMerge');
  assert.ok(offer);
  assert.deepEqual(offer.conflicts.attachments[0].choices.map((x) => x.ownerUid), offer.pieceUids.slice(0, 2));
  const bad = applyAction(state, { type: 'choose', offerId: offer.id, uniqueSelections: {} }, { data, catalog });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'NEED_UNIQUE_SELECTION');
  const good = applyAction(state, { type: 'choose', offerId: offer.id, uniqueSelections: { [`attachment:${attachment.id}`]: offer.pieceUids[0] } }, { data, catalog });
  assert.equal(good.ok, true, good.error?.message);
  assert.deepEqual(good.state.pieces[0].attachments[0].state, { counter: 30 });
  assert.equal(good.events[0].destroyedAttachments[0].ownerUid, offer.pieceUids[1]);
});

test('999 worn items merge, 1000 rejects atomically and leaves every normal body and item intact', () => {
  const make = (perPiece) => {
    // 送葬人 has no 交接凭证 (it would take one of the 999 places)
    const op = byName('送葬人'); let state = createSession({ seed: 83, data, catalog, openFactions: null }); state.funds = 100;
    for (let i = 0; i < 3; i++) {
      const slot = state.shop.slots.findIndex((x) => x.kind === 'chess');
      state.shop.slots[slot] = { kind: 'chess', id: op.chessId, elite: false, price: 3, sold: false, equipment: i === 2 ? [{ id: 'precision', quantity: perPiece }] : [] };
      const result = applyAction(state, { type: 'buy', slot }, { data, catalog }); assert.equal(result.ok, true, result.error?.message); state = result.state;
      if (i < 2) state.pieces[i].equipment.push({ uid: `e${950 + i}`, id: 'precision', quantity: perPiece, elite: false, state: { count: i } });
    }
    return state;
  };
  const success = make(333);
  assert.equal(success.pieces.length, 1);
  assert.equal(success.pieces[0].equipment.reduce((n, x) => n + x.quantity, 0), 999);
  const rejected = make(334);
  const offer = rejected.offers.find((x) => x.type === 'operatorMerge');
  assert.ok(offer);
  const before = JSON.stringify(rejected);
  const result = applyAction(rejected, { type: 'choose', offerId: offer.id }, { data, catalog });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CAPACITY');
  assert.equal(JSON.stringify(rejected), before);
  assert.equal(rejected.pieces.length, 3);
  assert.equal(viewSession(rejected, { data, catalog }).pieces.every((x) => !x.elite), true);
});
