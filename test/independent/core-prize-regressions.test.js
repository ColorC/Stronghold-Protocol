import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction } from '../../server/modes/independent/session.js';
import { makePrizeOffer } from '../../server/modes/independent/prizes.js';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';

const quiet = { warn() {}, error() {}, info() {} };
const data = getData({ log: quiet });
const baseCatalog = getCatalog(data);
const onlyPrize = (predicate) => ({ ...baseCatalog, prizes: Object.fromEntries(Object.entries(baseCatalog.prizes).filter(([, p]) => predicate(p))) });

test('empty conditional reward set returns three actionable fallback procurement choices', () => {
  const catalog = onlyPrize((p) => p.mechanism === 'promoteOperator');
  const state = createSession({ seed: 3, data, catalog });
  const offer = makePrizeOffer(state, catalog, 'start', 'test');
  assert.equal(offer.choices.length, 3);
  assert.equal(offer.choices.includes('promoteOperator'), false);
  assert.ok(offer.choices.includes('fallback-procurement-three'));
  const picked = applyAction(state, { type: 'choose', offerId: offer.id, index: offer.choices.indexOf('fallback-procurement-three') }, { data, catalog });
  assert.equal(picked.ok, true, picked.error?.message);
  assert.equal(picked.state.inventory.find((x) => x.id === 'chess_item_1_03_e_a')?.quantity, 3);
});

test('conditional badge prize recognizes inventory ownership; empty pool excludes recruit offers', () => {
  const conditional = onlyPrize((p) => p.mechanism === 'conditionalGrantGear');
  const state = createSession({ seed: 5, data, catalog: conditional });
  const id = Object.keys(conditional.prizes)[0];
  state.inventory.push({ uid: 'i900', id: 'precision', quantity: 1, state: {} });
  assert.equal(makePrizeOffer(state, conditional, 'cashout', 'test').choices.includes(id), true);

  const recruits = onlyPrize((p) => p.mechanism === 'recruitOffer');
  const empty = createSession({ seed: 9, data, catalog: recruits });
  for (const pool of Object.values(empty.pool)) pool.left = 0;
  const offer = makePrizeOffer(empty, recruits, 'start', 'test');
  assert.equal(offer.choices.some((x) => Object.hasOwn(recruits.prizes, x)), false);
  assert.equal(offer.choices.length, 3);
});

test('deployment cap item raises 8 to 9 once and repeated use is atomic', () => {
  const catalog = baseCatalog;
  const record = Object.values(catalog.equipment).find((x) => x.mechanism === 'deployCap');
  assert.ok(record);
  const state = createSession({ seed: 22, data, catalog });
  state.inventory.push({ uid: 'i900', id: record.id, sourceId: record.sourceId, quantity: 1, state: {} });
  const used = applyAction(state, { type: 'use-item', itemUid: 'i900' }, { data, catalog });
  assert.equal(used.ok, true, used.error?.message);
  assert.equal(used.state.deployCap, 9);
  used.state.inventory.push({ uid: 'i901', id: record.id, sourceId: record.sourceId, quantity: 1, state: {} });
  const before = JSON.stringify(used.state);
  const again = applyAction(used.state, { type: 'use-item', itemUid: 'i901' }, { data, catalog });
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'LIMIT_REACHED');
  assert.equal(JSON.stringify(used.state), before);
});

test('initial base income is available to current-round procurement top-up', () => {
  const state = createSession({ seed: 30, data, catalog: baseCatalog });
  const item = Object.entries(baseCatalog.prizes).find(([, p]) => p.mechanism === 'activeFundTopUp')?.[0];
  assert.ok(item);
  state.funds = 0; state.inventory.push({ uid: 'i910', id: item, quantity: 1, state: {} });
  const result = applyAction(state, { type: 'use-item', itemUid: 'i910' }, { data, catalog: baseCatalog });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.state.funds, state.incomeThisRound);
});

test('player facility is use-only, normal duplicates reject, and elite replaces normal', () => {
  const facility = Object.values(baseCatalog.equipment).find((x) => x.kind === '玩家设施' && x.mechanism === 'facilityIncome');
  assert.ok(facility);
  const state = createSession({ seed: 31, data, catalog: baseCatalog });
  state.inventory.push({ uid: 'i911', id: facility.id, sourceId: facility.sourceId, elite: false, quantity: 1, state: {} });
  const normal = applyAction(state, { type: 'use-item', itemUid: 'i911' }, { data, catalog: baseCatalog });
  assert.equal(normal.ok, true, normal.error?.message);
  assert.equal(normal.state.playerEffects.find((x) => x.type === 'facilityIncome').amount, 1);
  normal.state.inventory.push({ uid: 'i912', id: facility.id, sourceId: facility.sourceId, elite: false, quantity: 1, state: {} });
  const duplicate = applyAction(normal.state, { type: 'use-item', itemUid: 'i912' }, { data, catalog: baseCatalog });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'LIMIT_REACHED');
  normal.state.inventory.push({ uid: 'i913', id: facility.id, sourceId: facility.sourceId, elite: true, quantity: 1, state: {} });
  const elite = applyAction(normal.state, { type: 'use-item', itemUid: 'i913' }, { data, catalog: baseCatalog });
  assert.equal(elite.ok, true, elite.error?.message);
  assert.equal(elite.state.playerEffects.find((x) => x.type === 'facilityIncome').amount, 2);
  assert.equal(elite.state.playerEffects.find((x) => x.type === 'facilityIncome').elite, true);
  const body = applyAction(state, { type: 'buy', slot: state.shop.slots.findIndex((x) => x.kind === 'chess' && x.id) }, { data, catalog: baseCatalog });
  assert.equal(body.ok, true);
  body.state.inventory.push({ uid: 'i914', id: facility.id, sourceId: facility.sourceId, quantity: 1, state: {} });
  const equip = applyAction(body.state, { type: 'equip', itemUid: 'i914', targetUid: body.state.pieces[0].uid }, { data, catalog: baseCatalog });
  assert.equal(equip.ok, false);
  assert.equal(equip.error.code, 'NOT_EQUIPPABLE');
});
