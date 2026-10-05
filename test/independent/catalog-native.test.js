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
  const donor = { uid: 'donor', chessId: 'chess_char_1_02_a', row: 1, col: 3, dir: 'RIGHT', nativeState: {} };
  state.pieces.push(owl, donor);
  runNativeHook(state, 'roundStart', { origin: 'player' }, services);
  runNativeHook(state, 'roundStart', { origin: 'player' }, services);
  assert.deepEqual(granted.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'vitality', quantity: 1 }]);
  assert.equal(granted[0].sourceUid, 'donor');
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
