import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRun, applyAction } from '../../shared/assault/run.js';
import { addSupply, generateHourlySupplies, validateSupplies } from '../../shared/assault/supplies.js';
import { pieceFromBody } from '../../shared/assault/inventory.js';
import { createAssaultStore } from '../../server/modes/assault/store.js';
import { temporaryEnchantmentRecords } from '../../shared/assault/temporary-enchantments.js';
import { temporaryRecords } from '../../shared/assault/temporary-enhancements.js';

const json = (name) => JSON.parse(readFileSync(new URL(`../../data/assault-design/${name}.json`, import.meta.url), 'utf8'));
const system = json('system');
const events = json('events'), collectibles = json('collectibles'), encounters = json('encounters'), forms = json('forms');
const roster = ['support', 'assault', 'ranged'].flatMap((group) => json(`roster-${group}`).operators);
const operators = Object.fromEntries(roster.map((entry) => [entry.charId, structuredClone(entry)]));
const bodies = Object.fromEntries(roster.map((entry) => [entry.charId, {
  charId: entry.charId, purchaseCharId: entry.charId, name: entry.name, profession: entry.profession,
  price: entry.price, defaultModuleId: entry.defaultModuleId ?? null, modulePlans: entry.modulePlans,
  baseStats: { maxHp: 1000 }, starStats: Array.from({ length: 4 }, (_, index) => ({ star: index + 1,
    stats: { maxHp: 1000 * (index + 1), atk: 100, bat: 100, spRecovery: 1 } })),
  ...(entry.fixedSkill ? { fixedSkill: structuredClone(entry.fixedSkill) } : {}),
}]));
for (const entry of forms.forms) bodies[entry.charId] = {
  charId: entry.charId, purchaseCharId: forms.family.charId, name: entry.name, profession: entry.profession,
  price: entry.price, defaultModuleId: entry.defaultModuleId ?? null, modulePlans: entry.modulePlans,
  baseStats: { maxHp: 1000 }, starStats: Array.from({ length: 4 }, (_, index) => ({ star: index + 1,
    stats: { maxHp: 1000 * (index + 1), atk: 100, bat: 100, spRecovery: 1 } })),
  ...(entry.fixedSkill ? { fixedSkill: structuredClone(entry.fixedSkill) } : {}),
};
operators.char_002_amiya.extraForms = forms.forms.map((entry) => entry.charId);
const ctx = { catalog: { operators, bodies }, design: { system, events, collectibles, encounters } };
const shopDef = system.shopDefinitions.find((entry) => entry.kind === 'supply') ?? {
  id: 'shop_supply_test', name: '补给店', kind: 'supply', group: 'supply', unlockDay: 1, slots: 4,
  refreshCost: 2, maxRefreshes: 1, offeredStar: 'dayWeights', filter: { type: 'none' },
  priceRule: { type: 'definitionPrices' }, supplyPolicy: 'distinctPurchaseIdentities',
};
if (!system.shopDefinitions.some((entry) => entry.id === shopDef.id)) system.shopDefinitions.push(shopDef);

function fresh({ day = 1, seed = 7, phase = 'shop', gold = 40 } = {}) {
  const runId = '00000000-0000-4000-8000-' + String(day * 100000 + seed).padStart(12, '0');
  const state = createRun({ runId, seed, directorId: system.directors[0].id }, ctx);
  state.day = day;
  state.phase = phase;
  state.gold = gold;
  state.shop = phase === 'shop' ? { id: shopDef.id, kind: 'supply', slots: [], refreshCost: 2, refreshCount: 0,
    consumedNextShopDiscount: 0, consumedRelicFeeReduction: 0 } : null;
  state.relicIds = [];
  return state;
}
function transact(state, type, payload, opId) {
  const action = { type, ...payload, opId, expectedRevision: state.revision };
  return { action, ...applyAction(state, action, ctx) };
}
function own(state, itemId, star = 1) { return addSupply(state, ctx, itemId, star); }
function addPiece(state, charId = roster[0].charId) { const piece = pieceFromBody(state, ctx, charId, 1); state.pieces.push(piece); return piece; }
function sell(state, itemId, star, opId) {
  const item = own(state, itemId, star);
  state.phase = 'nodeChoice'; state.shop = null;
  return transact(state, 'sellSupply', { uid: item.uid }, opId);
}

const item = (id) => system.supplyItems.find((entry) => entry.id === id);

test('buySupply is an independent transaction: charge once, add one supply, keep operator inventory and source counts unchanged', () => {
  const state = fresh({ gold: 20 });
  const beforePieces = structuredClone(state.pieces), beforePopulation = state.population;
  state.shop.slots = [{ slotId: 'supply:0', kind: 'supply', itemId: 'supply_soda_machine', star: 2, price: 8 }];
  const first = transact(state, 'buySupply', { slotId: 'supply:0' }, 'supply-buy-1');
  assert.equal(first.result.itemId, 'supply_soda_machine');
  assert.equal(first.state.gold, 12);
  assert.equal(first.state.supplies.length, 1);
  assert.equal(first.state.supplies[0].star, 2);
  assert.equal(first.state.supplies[0].uid, 's1');
  assert.deepEqual(first.state.pieces, beforePieces);
  assert.equal(first.state.population, beforePopulation);
  assert.equal(first.state.opJournal.at(-1).result.uid, 's1');
  const replay = applyAction(first.state, first.action, ctx);
  assert.equal(replay.state, first.state);
  assert.deepEqual(replay.result, first.result);
  assert.throws(() => transact(first.state, 'buySupply', { slotId: 'supply:0' }, 'supply-buy-2'), { code: 'UNKNOWN_SHOP_SLOT' });
});

test('buySupply rejects capacity, unknown items, and insufficient gold atomically', () => {
  const previousCapacity = system.supplyCapacity;
  try {
    system.supplyCapacity = 2;
    const state = fresh({ gold: 10 });
    state.shop.slots = [
      { slotId: 'supply:machine', kind: 'supply', itemId: 'supply_soda_machine', star: 1, price: 4 },
      { slotId: 'supply:drink', kind: 'supply', itemId: 'supply_punch', star: 1, price: 2 },
    ];
    const bought = transact(state, 'buySupply', { slotId: 'supply:machine' }, 'capacity-machine');
    const before = structuredClone(bought.state);
    assert.throws(() => transact(bought.state, 'buySupply', { slotId: 'supply:drink' }, 'capacity-drink'), { code: 'SUPPLY_CAPACITY' });
    assert.deepEqual(bought.state, before, 'failed capacity purchase leaves gold, stock, and inventory untouched');
    const unknown = fresh({ gold: 10 });
    unknown.shop.slots = [{ slotId: 'bad', kind: 'supply', itemId: 'not-registered', star: 1, price: 1 }];
    assert.throws(() => transact(unknown, 'buySupply', { slotId: 'bad' }, 'unknown-supply'), { code: 'UNKNOWN_SUPPLY_ITEM' });
    const broke = fresh({ gold: 0 });
    broke.shop.slots = [{ slotId: 'costly', kind: 'supply', itemId: 'supply_punch', star: 1, price: 1 }];
    const beforeBroke = structuredClone(broke);
    assert.throws(() => transact(broke, 'buySupply', { slotId: 'costly' }, 'insufficient-supply'), { code: 'INSUFFICIENT_GOLD' });
    assert.deepEqual(broke, beforeBroke);
  } finally {
    system.supplyCapacity = previousCapacity;
  }
});
test('all 29 registered item-star combinations preserve prices, sale effects, and lifecycle records', () => {
  let covered = 0;
  for (const beverage of system.supplyItems.filter((entry) => entry.kind === 'beverage')) {
    for (const star of beverage.allowedStars) {
      const state = fresh({ phase: 'nodeChoice', gold: 9, seed: star * 31 + covered });
      const owned = own(state, beverage.id, star);
      const result = transact(state, 'sellSupply', { uid: owned.uid }, `sell-${beverage.id}-${star}`);
      assert.equal(result.result.price, 0, `${beverage.id} star ${star}`);
      assert.equal(result.state.gold, 9, `${beverage.id} star ${star}`);
      assert.equal(result.state.supplies.length, 0);
      const expected = beverage.saleEffect.values[star - 1];
      assert.equal(result.state.history.filter((entry) => entry.kind === 'supplySaleEffect' && entry.itemId === beverage.id).length, 1);
      assert.equal(result.state.history.find((entry) => entry.kind === 'supplySaleEffect' && entry.itemId === beverage.id).amount, expected);
      assert.ok(result.state.claimed.includes(`supply-sale:action:sell-${beverage.id}-${star}:sell:s1`));
      assert.equal(result.state.opJournal.at(-1).action.type, 'sellSupply');
      if (beverage.saleEffect.kind === 'smoothie') {
        const abilities = result.state.pieces.flatMap((piece) => piece.temporaryAbilityEnhancements ?? []).map((record) => record.ability);
        assert.ok(abilities.includes('heal') && abilities.includes('regen'));
      } else if (['damage', 'poison', 'burn', 'shield'].includes(beverage.saleEffect.kind)) {
        assert.ok(result.state.pieces.some((piece) => (piece.temporaryAbilityEnhancements ?? []).some((record) => record.ability === beverage.saleEffect.kind)));
      }
      covered += 1;
    }
  }
  assert.equal(covered + 4, 29, '25 beverage tiers plus four machine tiers are represented');
  for (let star = 1; star <= 4; star += 1) {
    const state = fresh({ phase: 'shop', gold: 9 });
    const owned = own(state, 'supply_soda_machine', star);
    const result = transact(state, 'sellSupply', { uid: owned.uid }, `sell-machine-${star}`);
    assert.equal(result.result.price, [2, 4, 8, 16][star - 1]);
  }
  assert.deepEqual(item('supply_soda_machine').buyPrices, [4, 8, 16, 32]);
});

test('hourly machine generation inherits star, claims once, and full capacity skips without consuming RNG', () => {
  const state = fresh({ day: 1, phase: 'nodeChoice', seed: 821 });
  own(state, 'supply_soda_machine', 1);
  const firstRng = state.rngState;
  generateHourlySupplies(state, ctx, 'hour:1:1:started');
  assert.equal(state.supplies.length, 2);
  assert.equal(state.supplies[1].star, 1);
  assert.equal(item(state.supplies[1].itemId).kind, 'beverage');
  assert.equal(state.history.filter((entry) => entry.kind === 'supplyGenerated').length, 1);
  const afterFirst = state.rngState;
  assert.notEqual(afterFirst, firstRng);
  generateHourlySupplies(state, ctx, 'hour:1:1:started');
  assert.equal(state.supplies.length, 2);
  assert.equal(state.rngState, afterFirst);
  ctx.design.system.supplyCapacity = 2;
  const full = fresh({ day: 1, phase: 'nodeChoice', seed: 991 });
  own(full, 'supply_soda_machine', 1);
  const rng = full.rngState;
  generateHourlySupplies(full, ctx, 'hour:1:1:full');
  assert.equal(full.supplies.length, 1);
  assert.equal(full.rngState, rng);
  assert.ok(full.claimed.includes('supply-hour:hour:1:1:full:s1'));
  assert.equal(full.history.at(-1).kind, 'supplyGenerationSkipped');
  ctx.design.system.supplyCapacity = 8;
});

test('Mystery Flavor uses only its 11 registered weighted enchantments and never replaces a permanent enchantment', () => {
  const mystery = item('supply_mystery');
  assert.equal(mystery.allowedStars.join(','), '4');
  assert.deepEqual(mystery.saleEffect.enchantments.map((entry) => [entry.id, entry.weight]), [
    ['enchant_heavy', 50], ['enchant_icy', 10], ['enchant_turbo', 50], ['enchant_shielded', 50],
    ['enchant_restorative', 50], ['enchant_toxic', 50], ['enchant_mossy', 50], ['enchant_fiery', 50],
    ['enchant_deadly', 20], ['enchant_radiant', 10], ['enchant_obsidian', 10],
  ]);
  assert.ok(mystery.saleEffect.enchantments.every((entry) => !['enchant_golden', 'enchant_shiny'].includes(entry.id)));
  for (let seed = 1; seed <= 32; seed += 1) {
    const state = fresh({ phase: 'nodeChoice', seed });
    for (const piece of state.pieces) piece.enchantmentId = 'enchant_golden';
    const first = addPiece(state); first.enchantmentId = 'enchant_golden'; first.row = 3; first.col = 5;
    const target = addPiece(state, roster[1].charId); target.row = 4; target.col = 4;
    const result = sell(state, mystery.id, 4, `mystery-${seed}`);
    assert.equal(result.result.price, 0);
    const soldState = result.state;
    assert.equal(soldState.pieces.find((piece) => piece.uid === first.uid).enchantmentId, 'enchant_golden');
    const record = temporaryEnchantmentRecords(soldState.pieces.find((piece) => piece.uid === target.uid), soldState, ctx).find((entry) => entry.id.includes('supply-sale:'));
    assert.ok(record, `seed ${seed} applies to the next eligible leftmost piece`);
    assert.ok(mystery.saleEffect.enchantments.some((entry) => entry.id === record.enchantmentId));
    assert.ok(!['enchant_golden', 'enchant_shiny'].includes(record.enchantmentId));
    assert.equal(record.expiresAtHour, state.day * 6);
  }
});

test('Wishful max-life effects use permanent base, round, expire by day, and do not heal', () => {
  const state = fresh({ phase: 'nodeChoice', seed: 62 });
  state.maxLifeBase = 21; state.maxLife = 21; state.life = 17; state.temporaryMaxLife = [];
  const start = state.life;
  const first = sell(state, 'supply_wishful_drinking', 3, 'wishful-gold');
  assert.equal(first.result.amount, 5);
  assert.equal(first.state.maxLife, 22);
  assert.equal(first.state.life, start);
  const second = sell(first.state, 'supply_wishful_drinking', 4, 'wishful-diamond');
  assert.equal(second.result.amount, 10);
  assert.equal(second.state.maxLife, 24);
  assert.equal(second.state.life, start);
  assert.equal(second.state.temporaryMaxLife.reduce((sum, record) => sum + record.amount, 0), 3);
  assert.ok(second.state.temporaryMaxLife.every((record) => record.expiresAtHour === first.result.expiresAtHour));
});

test('Cooler sales stack BAT reduction only to cap and update time-based instant SP recovery', () => {
  const state = fresh({ phase: 'nodeChoice', seed: 88 });
  const target = addPiece(state);
  const body = ctx.catalog.bodies[target.charId];
  body.fixedSkill = { kind: 'instant', spType: 'time' };
  let current = state;
  for (let index = 0; index < 8; index += 1) current = sell(current, 'supply_yetarian_cooler', 4, `cooler-${index}`).state;
  const currentTarget = current.pieces.find((piece) => piece.uid === target.uid);
  const records = temporaryRecords(currentTarget, current);
  const bat = records.filter((record) => record.stat === 'bat' && record.mode === 'percent').reduce((sum, record) => sum + record.amount, 0);
  assert.ok(Math.abs(bat + 0.8) < 1e-12);
  const sp = records.filter((record) => record.stat === 'spRecovery').reduce((sum, record) => sum + record.amount, 0);
  assert.ok(sp > 0);
  assert.ok(sp < 5, 'the conversion is finite at the 80% cooldown reduction cap');
});

test('strict store validation rejects malformed supplies, capacity overflow, and sale actions in battle while legacy states remain valid', () => {
  const store = createAssaultStore({ root: 'E:/assault-validation-only', context: ctx });
  const valid = fresh({ phase: 'nodeChoice' });
  assert.equal(store.validate(valid), true);
  const malformed = structuredClone(valid); malformed.supplies = [{ uid: 's1', itemId: 'not-registered', star: 1 }]; malformed.nextSupplyId = 2;
  assert.throws(() => store.validate(malformed));
  const duplicate = structuredClone(valid); duplicate.supplies = [{ uid: 's1', itemId: 'supply_punch', star: 1 }, { uid: 's1', itemId: 'supply_scovyle', star: 1 }]; duplicate.nextSupplyId = 2;
  assert.throws(() => validateSupplies(duplicate, ctx));
  const overflow = structuredClone(valid); overflow.supplies = Array.from({ length: 9 }, (_, index) => ({ uid: `s${index + 1}`, itemId: 'supply_punch', star: 1 })); overflow.nextSupplyId = 10;
  assert.throws(() => store.validate(overflow), { code: 'SUPPLY_CAPACITY' });
  const legacy = structuredClone(valid); delete legacy.supplies; delete legacy.nextSupplyId;
  assert.equal(store.validate(legacy), true);
  const owned = fresh({ phase: 'battle' }); own(owned, 'supply_punch', 1);
  assert.throws(() => transact(owned, 'sellSupply', { uid: 's1' }, 'sell-in-battle'), { code: 'INVALID_PHASE' });
});




