import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { nativeTraitFor, runNativeHook } from '../../server/modes/independent/native.js';

const catalog = getCatalog();
const all = Object.values(catalog.operators);

function fixture() {
  const state = { round: 1, shop: { level: 3, freeRefreshes: 0, slots: [] }, pieces: [], counters: { gained: 0, spent: 0, paidRefreshes: 0 }, pendingFunds: 0, nextUid: 1, inventory: [] };
  const granted = [];
  const offers = [];
  const services = {
    catalog,
    data: {},
    rng: () => 0.25,
    grantEquipment(_state, id, quantity, extra) { granted.push({ id, quantity, ...extra }); },
    grantChess(_state, chessId, extra) { offers.push({ chessId, ...extra }); },
    addOffer(_state, offer) { offers.push(offer); },
    record() {},
  };
  return { state, services, granted, offers };
}

test('catalog resolves every approved operator in ordinary and elite chessId namespaces', () => {
  const ordinary = all.filter((x) => !x.elite);
  const elite = all.filter((x) => x.elite);
  assert.equal(ordinary.length, 112);
  assert.equal(elite.length, 112);
  assert.equal(Object.keys(catalog.operators).length, 224);
  for (const base of ordinary) {
    const promoted = catalog.operators[base.eliteChessId];
    assert.ok(promoted, `${base.name} elite id is queryable`);
    assert.equal(base.nativeTrait.origin, 'operator body');
    assert.ok(base.nativeTrait.normalText);
    assert.ok(base.nativeTrait.eliteText);
    assert.ok(base.nativeTrait.sources.normal.every((x) => x.bb && x.garrisonId));
    assert.ok(promoted.nativeTrait.sources.elite.every((x) => x.bb && x.garrisonId));
    if (base.nativeTrait.text !== promoted.nativeTrait.text) assert.notEqual(base.nativeTrait.text, promoted.nativeTrait.text);
    assert.equal(nativeTraitFor(base.chessId, catalog), base.nativeTrait);
    assert.equal(nativeTraitFor(promoted.chessId, catalog), promoted.nativeTrait);
  }
});

test('stable item catalog covers 15 badges, all 59 legacy destinations, prizes and attachments', () => {
  assert.deepEqual(Object.keys(catalog.badges).sort(), ['agility','arcane','assault','coordination','defense','foresight','harmony','investor','mastery','miracle','precision','recovery','solitary','unyielding','vitality'].sort());
  assert.equal(Object.values(catalog.badges).length, 15);
  assert.equal(Object.values(catalog.badges).filter((x) => x.regularProduction).length, 6);
  const legacy = Object.values(catalog.equipment).filter((x) => x.oldName);
  assert.equal(legacy.length, 59);
  assert.equal(legacy.filter((x) => !x.available).length, 5);
  assert.ok(legacy.every((x) => x.id === x.sourceId && x.canonicalId && x.mechanism && x.params));
  const identity = legacy.filter((x) => ['随身身份牌', '变形同构体'].includes(x.oldName));
  assert.equal(identity.length, 2);
  assert.equal(identity[0].canonicalId, identity[1].canonicalId);
  assert.equal(identity[0].uniqueKey, identity[1].uniqueKey);
  assert.equal(identity[0].level, 2);
  assert.equal(identity[1].eliteLevel, null);
  assert.equal(Object.values(catalog.attachments).length, 4);
  assert.equal(Object.values(catalog.prizes).length, 19);
  assert.ok(Object.values(catalog.attachments).every((x) => x.mechanism && x.params));
  assert.ok(Object.values(catalog.prizes).every((x) => x.mechanism && x.params));
  assert.deepEqual(catalog.equipmentRegistry.unsupported, []);
  assert.ok(Object.values(catalog.equipment).every((x) => !x.available || x.mechanism !== 'equipmentEffect'));
  assert.ok(Object.values(catalog.equipment).filter((x) => x.mechanism === 'combatEquipment').every((x) => Array.isArray(x.params.effects) && x.params.effects.every((e) => e.trigger && e.behavior && e.params)));
  assert.equal(catalog.equipment['chess_item_3_12_e_a'].mechanism, 'immediateFundsOnUse');
  assert.equal(catalog.equipment['chess_item_4_01_e_a'].params.eliteTierDelta, 1);
  assert.equal(catalog.equipment['chess_item_5_05_e_a'].params.eliteCount, 2);
  assert.equal(catalog.equipment['chess_item_5_06_e_a'].params.eliteCount, 2);
  const statCases = [
    ['chess_item_1_05_e_a', 'attackPercent', 0.2, 0.3], ['chess_item_2_01_e_a', 'maxHpPercent', -0.15, -0.2],
    ['chess_item_2_03_e_a', 'attackPercent', 0.1, 0.2], ['chess_item_2_04_e_a', 'spRecovery', 0.1, 0.2],
    ['chess_item_3_01_e_a', 'attackSpeedFlat', 8, 16], ['chess_item_3_06_e_a', 'maxHpPercent', 0.15, 0.25],
    ['chess_item_3_07_e_a', 'attackPercent', 0.2, 0.35], ['chess_item_3_08_e_a', 'resistance', 10, 20],
    ['chess_item_3_10_e_a', 'attackSpeedFlat', 10, 20], ['chess_item_4_02_e_a', 'maxHpPercent', 0.2, 0.35],
    ['chess_item_4_09_e_a', 'attackPercent', 0.15, 0.25], ['chess_item_5_09_e_a', 'maxHpPercent', 0.2, 0.35],
    ['chess_item_6_01_e_a', 'attackPercent', 0.2, 0.35], ['chess_item_6_02_e_a', 'attackPercent', 0.2, 0.35],
    ['chess_item_6_03_e_a', 'maxHpPercent', 0.2, 0.35], ['chess_item_6_05_e_a', 'attackSpeedFlat', 15, 25],
    ['chess_item_6_06_e_a', 'resistance', 15, 25], ['chess_item_6_07_e_a', 'initialSp', 10, 20],
    ['chess_item_6_10_e_a', 'redeployTimeReduction', 0.15, 0.25], ['chess_item_6_11_e_a', 'spRecovery', 0.1, 0.2],
  ];
  for (const [id, stat, normal, elite] of statCases) {
    assert.equal(catalog.equipment[id].stats?.[stat]?.normal, normal, `${id} normal ${stat}`);
    assert.equal(catalog.equipment[id].stats?.[stat]?.elite, elite, `${id} elite ${stat}`);
  }
  assert.equal(catalog.config.purchasePrice, 3);
  assert.equal(catalog.config.sellPrice, 1);
  assert.equal(catalog.config.refreshPrice, 1);
  assert.equal(catalog.config.equipmentCapacity, 99);
  assert.deepEqual(catalog.config.factionRecipes['维多利亚'], ['precision', 'vitality']);
  assert.deepEqual(catalog.config.professionRecipes.TANK, ['defense']);
  assert.ok(catalog.pools.pool_equip_pepe.assumed);
  assert.deepEqual(catalog.pools.pool_equip_pepe.weighted.map((x) => x[1]), [45, 45, 10]);
  assert.equal(catalog.equipment['chess_item_1_03_e_a'].mechanism, 'fundsOnUse');
});

test('native gain handlers emit actual ordinary and elite inventory effects and suppress recursive sources', () => {
  const normal = fixture();
  const normalPiece = { uid: 'a', chessId: 'chess_char_1_02_a', elite: false, nativeState: {} };
  normal.state.pieces.push(normalPiece);
  runNativeHook(normal.state, 'gain', { piece: normalPiece, origin: 'player' }, normal.services);
  assert.deepEqual(normal.granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'vitality', quantity: 1 }]);

  const elite = fixture();
  const elitePiece = { uid: 'b', chessId: 'chess_char_1_02_b', elite: true, nativeState: {} };
  elite.state.pieces.push(elitePiece);
  runNativeHook(elite.state, 'gain', { piece: elitePiece, origin: 'player' }, elite.services);
  assert.deepEqual(elite.granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'vitality', quantity: 2 }]);

  runNativeHook(normal.state, 'gain', { piece: normalPiece, origin: 'native', sourceUid: 'a' }, normal.services);
  assert.equal(normal.granted.length, 1);
});

test('round-start trait replay fires one allowlisted effect once and cannot replay itself', () => {
  const { state, services, granted } = fixture();
  const owl = { uid: 'owl', chessId: 'chess_char_4_21_a', row: 1, col: 2, dir: 'RIGHT', nativeState: {} };
  const donor = { uid: 'donor', chessId: 'chess_char_2_02_a', row: 1, col: 3, dir: 'RIGHT', nativeState: {} };
  state.pieces.push(owl, donor);
  runNativeHook(state, 'roundStart', { origin: 'player' }, services);
  runNativeHook(state, 'roundStart', { origin: 'player' }, services);
  assert.deepEqual(granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'vitality', quantity: 1 }, { id: 'vitality', quantity: 1 }]);
  assert.equal(granted.filter((x) => x.sourceUid === 'owl').length, 1);
});

test('round-end effects require a fielded owner except approved bench-active makers', () => {
  const { state, services, granted } = fixture();
  const benchedMedic = { uid: 'bench-medic', chessId: 'chess_char_2_02_a', row: null, col: null, nativeState: {} };
  const benchProducer = { uid: 'bench-producer', chessId: 'chess_char_1_13_a', row: null, col: null, nativeState: {} };
  state.pieces.push(benchedMedic, benchProducer);
  runNativeHook(state, 'prepEnd', { origin: 'player' }, services);
  assert.deepEqual(granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'recovery', quantity: 1 }]);

  const inField = fixture();
  inField.state.pieces.push({ uid: 'medic', chessId: 'chess_char_2_02_a', row: 0, col: 0, nativeState: {} });
  runNativeHook(inField.state, 'roundStart', { origin: 'player' }, inField.services);
  assert.deepEqual(inField.granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'vitality', quantity: 1 }]);
});

test('no-faction roster uses the approved profession recipe instead of a numeric pseudo-id', () => {
  const { state, services, granted } = fixture();
  const podenco = { uid: 'podenco', chessId: 'chess_char_1_13_a', row: null, col: null, nativeState: {} };
  state.pieces.push(podenco);
  runNativeHook(state, 'prepEnd', { origin: 'player' }, services);
  assert.deepEqual(granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'recovery', quantity: 1 }]);
});

test('native sale, spend and refresh rules mutate the concrete prep state exactly once', () => {
  const sold = fixture();
  const texas = { uid: 'texas', chessId: 'chess_char_1_08_a', nativeState: {} };
  sold.state.pieces.push(texas);
  runNativeHook(sold.state, 'sold', { piece: texas, origin: 'player' }, sold.services);
  assert.equal(sold.state.shop.freeRefreshes, 1);
  const elite = { uid: 'texas-b', chessId: 'chess_char_1_08_b', elite: true, nativeState: {} };
  sold.state.pieces.push(elite);
  runNativeHook(sold.state, 'sold', { piece: elite, origin: 'player' }, sold.services);
  assert.equal(sold.state.shop.freeRefreshes, 3);

  const spent = fixture();
  spent.state.counters.gained = 7;
  const xiaoman = { uid: 'xiaoman', chessId: 'chess_char_2_04_a', row: 0, col: 0, nativeState: {} };
  spent.state.pieces.push(xiaoman);
  runNativeHook(spent.state, 'prepEnd', { origin: 'player' }, spent.services);
  runNativeHook(spent.state, 'prepEnd', { origin: 'player' }, spent.services);
  assert.deepEqual(spent.granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'precision', quantity: 6 }]);

  const refreshed = fixture();
  refreshed.state.counters.refreshes = 1;
  refreshed.state.shop.slots = [{ kind: 'chess', id: 'offer-a', equipment: [], sold: false }];
  refreshed.state.pieces.push({ uid: 'lappland', chessId: 'chess_char_2_16_a', row: 0, col: 0, nativeState: {} });
  runNativeHook(refreshed.state, 'refresh', { origin: 'player' }, refreshed.services);
  assert.deepEqual(refreshed.state.shop.slots[0].equipment.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'assault', quantity: 1 }]);

  const freeRefreshed = fixture();
  freeRefreshed.state.counters.refreshes = 3;
  freeRefreshed.state.shop.slots = [1, 2, 3].map((n) => ({ kind: 'chess', id: `offer-${n}`, equipment: [], sold: false }));
  const aroma = { uid: 'aroma', chessId: 'chess_char_4_10_a', row: 0, col: 0, nativeState: {} };
  freeRefreshed.state.pieces.push(aroma);
  runNativeHook(freeRefreshed.state, 'prepEnd', { origin: 'player' }, freeRefreshed.services);
  assert.deepEqual(freeRefreshed.state.shop.slots.map((slot) => slot.equipment.map(({ id, quantity }) => ({ id, quantity }))), [
    [{ id: 'assault', quantity: 1 }], [{ id: 'assault', quantity: 1 }], [{ id: 'assault', quantity: 1 }],
  ]);
});

test('bench Lappland sees the first free refresh and copy replay uses the source elite variant as the copier', () => {
  const lappland = fixture();
  lappland.state.counters.refreshes = 1;
  lappland.state.shop.slots = [{ kind: 'chess', id: 'offer', equipment: [], sold: false }];
  lappland.state.pieces.push({ uid: 'lp', chessId: 'chess_char_2_16_a', row: null, col: null, nativeState: {} });
  runNativeHook(lappland.state, 'refresh', { paid: false }, lappland.services);
  assert.deepEqual(lappland.state.shop.slots[0].equipment.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'assault', quantity: 1 }]);
  const eliteLappland = fixture();
  eliteLappland.state.counters.refreshes = 1;
  eliteLappland.state.shop.slots = [{ kind: 'chess', id: 'offer', equipment: [], sold: false }];
  eliteLappland.state.pieces.push({ uid: 'lp-b', chessId: 'chess_char_2_16_b', elite: true, row: null, col: null, nativeState: {} });
  runNativeHook(eliteLappland.state, 'refresh', { paid: false }, eliteLappland.services);
  assert.deepEqual(eliteLappland.state.shop.slots[0].equipment.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'assault', quantity: 2 }]);

  const copied = fixture();
  const saria = { uid: 'saria', chessId: 'chess_char_5_11_a', row: 1, col: 1, dir: 'RIGHT', nativeState: {} };
  const eliteThinGreen = { uid: 'thin-b', chessId: 'chess_char_3_08_b', elite: true, row: 1, col: 2, nativeState: {} };
  const allies = [0, 1].map((n) => ({ uid: `a${n}`, chessId: `ally${n}_a`, row: n, col: 2, nativeState: {} }));
  copied.state.pieces.push(saria, eliteThinGreen, ...allies);
  copied.services.data = {
    chess: Object.fromEntries(copied.state.pieces.map((p) => [p.chessId, { bonds: ['v'] }])),
    bonds: { v: { name: '维多利亚' } },
  };
  runNativeHook(copied.state, 'prepEnd', {}, copied.services);
  const sariaGrant = copied.granted.filter((item) => item.sourceUid === 'saria');
  assert.deepEqual(sariaGrant.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'precision', quantity: 2 }]);
});

test('dominant faction recipes use stable tavern order on ties and exclude no-faction profession fallback', () => {
  const { state, services, granted } = fixture();
  const podenco = { uid: 'podenco', chessId: 'chess_char_1_13_a', row: null, col: null, nativeState: {} };
  const a = { uid: 'a', chessId: 'chess_char_1_03_a', row: 0, col: 0, nativeState: {} };
  const b = { uid: 'b', chessId: 'chess_char_1_06_a', row: 0, col: 1, nativeState: {} };
  state.pieces.push(podenco, a, b);
  runNativeHook(state, 'prepEnd', { origin: 'player' }, services);
  assert.deepEqual(granted.filter((x) => x.sourceUid === 'podenco').map(({ id, quantity }) => ({ id, quantity })), [{ id: 'precision', quantity: 1 }]);
});

test('prep faction supply recognizes a selected extra tavern tag', () => {
  const { state, services, granted } = fixture();
  const thorn = { uid: 'thorn', chessId: 'chess_char_1_06_a', row: 0, col: 0, nativeState: {} };
  const identityCarrier = { uid: 'tagged', chessId: 'unknown_a', row: 0, col: 1, nativeState: {}, equipment: [{ id: 'chess_item_identity_gear', state: { faction: '维多利亚' } }] };
  state.pieces.push(thorn, identityCarrier);
  runNativeHook(state, 'prepEnd', {}, services);
  assert.deepEqual(granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'vitality', quantity: 1 }]);
});

test('two-copy native merge qualification is registered as an explicit merge rule', () => {
  const { state, services } = fixture();
  const windflit = { uid: 'windflit', chessId: 'chess_char_2_11_a', nativeState: {} };
  state.pieces.push(windflit);
  const event = { piece: windflit, copiesConsumed: 2, origin: 'player' };
  runNativeHook(state, 'merge', event, services);
  assert.equal(event.mergeRequirement, 2);
  assert.equal(windflit.chessId, 'chess_char_2_11_a');
});

test('native registry reports implementation coverage without silent empty callbacks', () => {
  assert.deepEqual(catalog.nativeRegistry.unsupported, []);
  assert.ok(catalog.nativeRegistry.prepBehaviors.length > 0);
  assert.ok(all.every((x) => Array.isArray(x.nativeTrait.effect.prep) && Array.isArray(x.nativeTrait.effect.combat)));
  const missingCombat = all.filter((x) => !x.elite && x.nativeTrait.sources.normal.some((s) => s.eventType === 'IN_BATTLE') && x.name !== '风丸' && !x.nativeTrait.effect.combat.length);
  assert.deepEqual(missingCombat.map((x) => x.name), []);
  const expectedPrep = new Set(['grantEquipment','grantEquipmentByTier','conditionalGrant','freeRefresh','freeRefreshOnce','deferredFunds','deferredFundsIf','forgePerGainedChess','forgePerFundsSpent','forgeBenchCount','forgeBenchPairs','forgeDominantFaction','forgeFactionTierCount','forgeDominantFactionTierCount','forgeFactionTierPair','forgeAdjacent','forgeRowCount','attachShopBadgeFirstRefresh','attachShopByRefreshCount','randomEquipment','randomUnlockedEquipment','recruitOffer','conditionalRecruit','randomChessOffer','randomSupply','dominantFactionRecruit','replayAdjacentNative','twoCopyElite']);
  for (const behavior of catalog.nativeRegistry.prepBehaviors) assert.ok(expectedPrep.has(behavior), `registered behavior ${behavior}`);
});
