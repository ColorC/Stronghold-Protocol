import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { nativeTraitFor, runNativeHook } from '../../server/modes/independent/native.js';
import { withoutObsoleteWorkshopLimits } from '../../shared/warbandSchema.js';
import { tavernFactions } from '../../shared/independentRules.js';
import { preWarbandCatalog } from './helpers/preWarband.js';
import { preV3Catalog } from './helpers/preV3.js';
import { preV4Catalog } from './helpers/preV4.js';

// rule mechanics through the operators that carried them before 干员表 v3 (helpers/preV3.js) and before 干员特质 v4 (helpers/preV4.js)
const catalog = preV3Catalog(preV4Catalog(preWarbandCatalog()));
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
    grantChess(target, chessId, extra) {
      offers.push({ chessId, ...extra });
      const stock = target.pool?.left?.[chessId];
      if (stock) stock.left = Math.max(0, stock.left - 1);
    },
    addOffer(_state, offer) { offers.push(offer); },
    record() {},
  };
  return { state, services, granted, offers };
}

test('the legacy roster keeps 120 ordinary/elite pairs while native support tokens stay outside the recruitable pool', () => {
  const ordinary = all.filter((x) => !x.elite);
  const elite = all.filter((x) => x.elite);
  const pairedOrdinary = ordinary.filter((x) => x.chessId.startsWith('chess_char_') && catalog.operators[x.eliteChessId]?.elite);
  const support = ordinary.filter((x) => x.chessId.startsWith('darkmoon:support-'));
  assert.equal(ordinary.length, 123);
  assert.equal(elite.length, 120);
  assert.equal(pairedOrdinary.length, 120, 'raw operator bodies retain exactly 120 ordinary/elite pairs');
  assert.deepEqual(support.map((x) => x.chessId).sort(), ['darkmoon:support-cat-1-1','darkmoon:support-cat-2-2','darkmoon:support-elemental-2-2']);
  assert.ok(support.every((x) => !x.recruitable), 'native support-token records do not enter the player pool');
  assert.equal(ordinary.filter((x) => x.recruitable).length, 101);
  assert.equal(elite.filter((x) => x.recruitable).length, 101);
  assert.equal(Object.keys(catalog.operators).length, 243, '120 paired bodies plus three non-recruitable support-token records');
  for (const base of pairedOrdinary) {
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
  assert.equal(Object.values(catalog.attachments).filter((x) => x.id !== 'darkmoon-magnetic').length, 4, 'the explicit pre-v3 snapshot preserves its four source attachments');
  assert.ok(catalog.attachments['darkmoon-magnetic'], 'current magnetic handover helper is outside the historic source attachment pool');
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
  // gear v4 (2026-10-07, user: 「装备不再有精锐形态」): one form, no elite level; special combat gear carries no numbers
  // (those belong to the badges) beyond 诱敌蜂鸣器's 更容易受到敌人攻击; retired pieces keep their normal stats for old saves
  for (const x of Object.values(catalog.equipment).filter((d) => d.mechanism === 'combatEquipment' && !d.retired)) {
    for (const stat of Object.keys(x.stats || {})) assert.equal(stat, 'tauntLevel', `${x.newName || x.name} carries ${stat}`);
  }
  assert.deepEqual(catalog.equipment['chess_item_3_07_e_a'].stats, { attackPercent: 0.2, attackSpeedFlat: -5 });
  assert.ok(Object.values(catalog.equipment).every((x) => x.eliteLevel == null), 'no gear has an elite level');
  assert.equal(catalog.config.purchasePrice, 3);
  assert.equal(catalog.config.sellPrice, 1);
  assert.equal(catalog.config.refreshPrice, 1);
  assert.equal(catalog.config.equipmentCapacity, 999);
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
  assert.deepEqual(normal.granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'independent:坚守盟约', quantity: 1 }]);

  const elite = fixture();
  const elitePiece = { uid: 'b', chessId: 'chess_char_1_02_b', elite: true, nativeState: {} };
  elite.state.pieces.push(elitePiece);
  runNativeHook(elite.state, 'gain', { piece: elitePiece, origin: 'player' }, elite.services);
  assert.deepEqual(elite.granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'independent:坚守盟约', quantity: 2 }]);

  runNativeHook(normal.state, 'gain', { piece: normalPiece, origin: 'native', sourceUid: 'a' }, normal.services);
  assert.equal(normal.granted.length, 1, 'a gain from a native source does not recursively repeat the ordinary gear grant');
});


test('白面鸮 replays the front operator\'s 获得时 effect once at the end of the prep phase, never itself', () => {
  // 2026-10-07: 白面鸮 now re-triggers the 获得时 effect in front of it at 休整期结束时 (it used to copy 休整期开始)
  const { state, services, granted } = fixture();
  const corner = all.find((x) => x.name === '角峰' && !x.elite);
  const owl = { uid: 'owl', chessId: 'chess_char_4_21_a', row: 1, col: 2, dir: 'RIGHT', nativeState: {} };
  const donor = { uid: 'donor', chessId: corner.chessId, row: 1, col: 3, dir: 'RIGHT', nativeState: {} };
  state.pieces.push(owl, donor);
  runNativeHook(state, 'prepEnd', { origin: 'player' }, services);
  runNativeHook(state, 'prepEnd', { origin: 'player' }, services);
  // 角峰's current 获得时 effect grants one ordinary gear item, not a badge.
  assert.deepEqual(granted.map(({ id, quantity, sourceUid }) => ({ id, quantity, sourceUid })), [{ id: 'independent:坚守盟约', quantity: 1, sourceUid: 'owl' }]);
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
  assert.deepEqual(spent.granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'precision', quantity: 7 }], 'all seven qualifying roster gains count; retired caps are ignored');

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

  // 2026-10-07: 塞雷娅 on the field runs every 休整期结束时 effect once more (an elite once more again)
  const raze = all.find((x) => x.name === '雷蛇' && !x.elite);
  const doubled = fixture();
  doubled.state.pieces.push({ uid: 'saria', chessId: 'chess_char_5_11_a', row: 1, col: 1, dir: 'RIGHT', nativeState: {} },
    { uid: 'raze', chessId: raze.chessId, row: 1, col: 3, dir: 'RIGHT', nativeState: {} });
  runNativeHook(doubled.state, 'prepEnd', {}, doubled.services);
  assert.deepEqual(doubled.granted.map(({ id, quantity, sourceUid }) => ({ id, quantity, sourceUid })), [{ id: 'defense', quantity: 1, sourceUid: 'raze' }, { id: 'defense', quantity: 1, sourceUid: 'raze' }]);
  const tripled = fixture();
  tripled.state.pieces.push({ uid: 'saria', chessId: 'chess_char_5_11_b', elite: true, row: 1, col: 1, dir: 'RIGHT', nativeState: {} },
    { uid: 'raze', chessId: raze.chessId, row: 1, col: 3, dir: 'RIGHT', nativeState: {} });
  runNativeHook(tripled.state, 'prepEnd', {}, tripled.services);
  assert.equal(tripled.granted.length, 3);
  const benched = fixture();
  benched.state.pieces.push({ uid: 'saria', chessId: 'chess_char_5_11_a', row: null, col: null, nativeState: {} },
    { uid: 'raze', chessId: raze.chessId, row: 1, col: 3, dir: 'RIGHT', nativeState: {} });
  runNativeHook(benched.state, 'prepEnd', {}, benched.services);
  assert.equal(benched.granted.length, 1, 'a doubler on the bench does nothing');
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
  // Original KITS may include IN_BATTLE triggers while a pure-battle body intentionally has no Workshop mode effect.
  const expectedPrep = new Set(['grantEquipment','grantEquipmentByTier','conditionalGrant','freeRefresh','freeRefreshOnce','deferredFunds','deferredFundsIf','forgePerGainedChess','forgePerFundsSpent','forgeBenchCount','forgeBenchPairs','forgeDominantFaction','forgeFactionTierCount','forgeDominantFactionTierCount','forgeFactionTierPair','forgeAdjacent','forgeRowCount','attachShopBadgeFirstRefresh','attachShopByRefreshCount','randomEquipment','randomUnlockedEquipment','recruitOffer','conditionalRecruit','randomChessOffer','randomSupply','dominantFactionRecruit','replayAdjacentNative','twoCopyElite','triggerMultiplier','grantByTotal','shopCarry','badgeBoost','sellTransfer','devourShop','doubleWorn','escalatingGrant','perEliteGrant','buyGear','diversityGrant','copyFrontNative','forgePerRefresh','teamForge','factionReaction']);
  for (const behavior of catalog.nativeRegistry.prepBehaviors) assert.ok(expectedPrep.has(behavior), `registered behavior ${behavior}`);
});

test('all-badge thresholds use all fifteen stable IDs and Meteor keeps its normal/elite stat bonus', () => {
  const ids = Object.keys(catalog.badges).sort();
  for (const name of ['隐德来希', '浊心斯卡蒂']) {
    const operator = all.find((x) => x.name === name && !x.elite);
    const effect = operator.nativeTrait.effect.combat.find((x) => x.behavior === 'badgeThresholdStat');
    assert.deepEqual([...effect.params.badgeIds].sort(), ids, `${name} counts the full badge catalog`);
  }
  const meteor = all.find((x) => x.name === '流星' && !x.elite);
  const eliteMeteor = catalog.operators[meteor.eliteChessId];
  const normalStats = meteor.nativeTrait.effect.combat.find((x) => x.behavior === 'staticStats').params.stats;
  const eliteStats = eliteMeteor.nativeTrait.effect.combat.find((x) => x.behavior === 'staticStats').params.stats;
  assert.equal(normalStats.attackPercent, 0.25);
  assert.equal(normalStats.maxHpPercent, 0.25);
  assert.equal(eliteStats.attackPercent, 0.5);
  assert.equal(eliteStats.maxHpPercent, 0.5);
  assert.ok(meteor.nativeTrait.effect.combat.some((x) => x.behavior === 'weakDamage'));
  assert.ok(!all.find((x) => x.name === '宴' && !x.elite).nativeTrait.effect.combat.some((x) => x.behavior === 'staticStats' && 'attackPercent' in x.params.stats));
});

test('native recruitment only selects currently stocked ordinary copies across all offer paths', () => {
  const get = (name) => all.find((x) => x.name === name && !x.elite);
  const idFor = (name) => get(name).chessId;
  const stock = (ids, counts) => Object.fromEntries(ids.map((id, i) => [id, { cap: counts[i], left: counts[i], tier: catalog.operators[id]?.tier }]));
  const rowAllies = (piece) => [0, 1].map((n) => ({ uid: `row-${n}`, chessId: idFor('角峰'), row: piece.row, col: n, nativeState: {} }));
  const candidates = ['chess_char_5_04_a','chess_char_2_07_a','chess_char_1_04_a'];

  for (const elite of [false, true]) {
    const { state, services, offers } = fixture();
    const gratia = get('歌蕾蒂娅');
    const piece = { uid: 'gratia', chessId: elite ? gratia.eliteChessId : gratia.chessId, elite, row: 0, col: 4, nativeState: {} };
    state.pool = { left: stock(candidates, [1, 0, 1]) };
    state.pieces.push(piece, ...rowAllies(piece));
    const eligibleCandidates = candidates.filter((id) => catalog.operators[id] && catalog.operators[id].recruitable !== false && state.pool.left[id]?.left > 0);
    runNativeHook(state, 'roundStart', {}, services);
    assert.equal(offers.length, Math.min(elite ? 2 : 1, eligibleCandidates.length));
    assert.ok(offers.every((x) => state.pool.left[x.chessId]?.cap > 0));
    assert.equal(new Set(offers.map((x) => x.chessId)).size, offers.length);
  }
  const oneLeft = fixture();
  const gratia = get('歌蕾蒂娅');
  const eliteGratia = { uid: 'elite-gratia', chessId: gratia.eliteChessId, elite: true, row: 0, col: 4, nativeState: {} };
  const onlyCandidate = candidates.find((id) => catalog.operators[id] && catalog.operators[id].recruitable !== false);
  oneLeft.state.pool = { left: stock(onlyCandidate ? [onlyCandidate] : [], onlyCandidate ? [1] : []) };
  oneLeft.state.pieces.push(eliteGratia, ...rowAllies(eliteGratia));
  runNativeHook(oneLeft.state, 'roundStart', {}, oneLeft.services);
  assert.deepEqual(oneLeft.offers.map((x) => x.chessId), onlyCandidate ? [onlyCandidate] : [], 'only active, currently stocked candidates can be recruited');

  const random = fixture();
  const tail = get('焰尾');
  const randomPiece = { uid: 'tail', chessId: tail.chessId, row: 0, col: 0, nativeState: {} };
  const weighted = catalog.pools.pool_char_pinus.weighted.map(([id]) => id);
  const soleStock = weighted.find((id) => catalog.operators[id]?.recruitable);
  random.state.pool = { left: stock([soleStock], [1]) };
  random.state.pieces.push(randomPiece);
  runNativeHook(random.state, 'gain', { piece: randomPiece }, random.services);
  assert.deepEqual(random.offers.map((x) => x.chessId), [soleStock]);

  const sold = fixture();
  const pinecone = get('松果');
  sold.services.catalog = { ...catalog, operators: { ...catalog.operators, [pinecone.chessId]: {
    ...pinecone,
    nativeTrait: { ...pinecone.nativeTrait, effect: { ...pinecone.nativeTrait.effect, prep: [...pinecone.nativeTrait.effect.prep, { trigger: 'sold', behavior: 'recruitOffer', params: { normalTier: 1, choices: 3 } }] } },
  } } };
  const soldPiece = { uid: 'pinecone', chessId: pinecone.chessId, nativeState: {} };
  const ordinary = all.filter((x) => !x.elite && x.recruitable && x.tier === 1).slice(0, 3).map((x) => x.chessId);
  sold.services.data.chess = Object.fromEntries(ordinary.map((id) => [id, { chessId: id, tier: 1, visible: true, bonds: [] }]));
  sold.state.pool = { left: stock(ordinary, [0, 1, 0]) };
  sold.state.pieces.push(soldPiece);
  runNativeHook(sold.state, 'sold', { piece: soldPiece }, sold.services);
  assert.equal(sold.offers.length, 1);
  assert.deepEqual(sold.offers[0].choices, [ordinary[1]]);

  const dominant = fixture();
  const remaining = get('余');
  const yan = get('角峰');
  const owner = { uid: 'yu', chessId: remaining.chessId, row: 0, col: 0, nativeState: {} };
  const allyA = { uid: 'a', chessId: yan.chessId, row: 0, col: 1, nativeState: {} };
  const allyB = { uid: 'b', chessId: yan.chessId, row: 0, col: 2, nativeState: {} };
  dominant.state.pieces.push(owner, allyA, allyB);
  const faction = tavernFactions(allyA, catalog)[0];
  const sameFaction = all.filter((x) => !x.elite && x.recruitable && tavernFactions({ chessId: x.chessId }, catalog).includes(faction)).slice(0, 3).map((x) => x.chessId);
  dominant.services.data.chess = Object.fromEntries(sameFaction.map((id) => [id, { chessId: id, visible: true, bonds: [faction] }]));
  dominant.services.data.bonds = { [faction]: { name: faction } };
  dominant.state.pool = { left: stock(sameFaction, [0, 1, 0]) };
  runNativeHook(dominant.state, 'roundStart', {}, dominant.services);
  assert.deepEqual(dominant.offers.map((x) => x.chessId), [sameFaction[1]]);
});

test('repeatNativeForging duplicates eligible badge gain and copy output once without replaying supply items', () => {
  const normal = fixture();
  const jingzhe = all.find((x) => x.name === '惊蛰' && !x.elite);
  const piece = { uid: 'jingzhe', chessId: jingzhe.chessId, nativeState: {} };
  normal.state.pieces.push(piece);
  normal.state.playerEffects = [{ type: 'repeatNativeForging', source: 'repeat-inspection-license', extraRepeats: 1, expiresRound: 1 }];
  runNativeHook(normal.state, 'gain', { piece }, normal.services);
  // 惊蛰's authored badge gain repeats; its unrelated gear reward remains once.
  assert.deepEqual(normal.granted.map((x) => [x.id, x.quantity, x.repeated]), [['independent:炎国缚锁', 1, undefined], ['precision', 2, undefined], ['precision', 2, true]]);
  assert.equal(normal.granted[2].sourceUid, 'jingzhe');

  const supply = fixture();
  const swire = all.find((x) => x.name === '诗怀雅' && !x.elite);
  const supplyPiece = { uid: 'swire', chessId: swire.chessId, nativeState: {} };
  supply.state.pieces.push(supplyPiece);
  supply.state.playerEffects = [{ type: 'repeatNativeForging', source: 'repeat-inspection-license', extraRepeats: 1, expiresRound: 1 }];
  runNativeHook(supply.state, 'gain', { piece: supplyPiece }, supply.services);
  assert.equal(supply.granted.length, 1);
  assert.equal(supply.granted[0].id, 'chess_item_1_03_e_a');

  // the copier is 白面鸮 since 2026-10-07 (it replays a 获得时 effect at 休整期结束时)
  const copy = fixture();
  const owl = all.find((x) => x.name === '白面鸮' && !x.elite);
  // a donor whose first 获得时 rule forges a badge (野鬃 under the pre-v3 rules: 攻速徽章)
  const donor = { uid: 'donor', chessId: 'chess_char_1_19_a', row: 0, col: 1, dir: 'RIGHT', nativeState: {} };
  const copier = { uid: 'owl', chessId: owl.chessId, row: 0, col: 0, dir: 'RIGHT', nativeState: {} };
  copy.state.pieces.push(copier, donor);
  copy.state.playerEffects = [{ type: 'repeatNativeForging', source: 'repeat-inspection-license', extraRepeats: 1, expiresRound: 1 }];
  runNativeHook(copy.state, 'prepEnd', {}, copy.services);
  assert.equal(copy.granted.length, 2);
  assert.ok(copy.granted.every((x) => x.id === 'agility' && x.sourceUid === 'owl' && x.copied === true));
  assert.equal(copy.granted.filter((x) => x.repeated === true).length, 1);
});

test('native status production observes targets in range regardless of status source actor', () => {
  const byName = (name) => all.find((x) => x.name === name && !x.elite);
  for (const name of ['初雪', '银灰', '缇缇']) {
    const production = byName(name).nativeTrait.effect.combat.find((x) => x.trigger === 'statusApplied');
    assert.ok(production, `${name} has a status observer`);
    assert.equal(Object.hasOwn(production.params.filter, 'actor'), false, `${name} observes statuses applied by any actor`);
    assert.equal(production.params.filter.range, 'attacker');
    assert.equal(production.params.filter.entered, true);
  }
  const rinyu = byName('凛御银灰').nativeTrait.effect.combat.find((x) => x.trigger === 'statusApplied');
  assert.deepEqual(rinyu.params.filter, {
    observer: 'frontAlly', observerTag: '谢拉格', targetSide: 'enemy', status: 'frozen', entered: true, range: 'observer',
  });
  assert.equal(rinyu.params.probability, 0.6);
});

test('Specter the Unchained keeps death and dollSwap outputs after legacy Workshop limits are normalized', () => {
  const normal = all.find((x) => x.name === '归溟幽灵鲨' && !x.elite);
  const elite = catalog.operators[normal.eliteChessId];
  for (const [operator, expectedQuantity] of [[normal, 1], [elite, 2]]) {
    const rules = operator.nativeTrait.effect.combat.filter((x) => ['death', 'dollSwap'].includes(x.trigger)).map(withoutObsoleteWorkshopLimits);
    assert.deepEqual(rules.map((x) => x.trigger).sort(), ['death', 'dollSwap']);
    const death = rules.find((x) => x.trigger === 'death');
    const swap = rules.find((x) => x.trigger === 'dollSwap');
    for (const rule of [death, swap]) {
      assert.equal(rule.params.outputs[0].id, 'vitality');
      assert.equal(rule.params.outputs[0].quantity, expectedQuantity);
      assert.equal(Object.hasOwn(rule.params, 'maxPerBattle'), false);
      assert.equal(rule.params.filter.actor, 'self');
    }
    assert.equal(Object.hasOwn(death.params, 'firstOnly'), false);
    assert.equal(Object.hasOwn(swap.params, 'firstOnly'), false);
  }
});
