import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildShopState, refreshShopState } from '../../shared/assault/shops.js';

const system = JSON.parse(readFileSync(new URL('../../data/assault-design/system.json', import.meta.url), 'utf8'));
const shopDefinition = { id: 'shop_supply_test', kind: 'supply', group: 'supply', unlockDay: 1, slots: 4,
  refreshCost: 2, maxRefreshes: 1, offeredStar: 'dayWeights', filter: { type: 'none' },
  priceRule: { type: 'definitionPrices' }, supplyPolicy: 'distinctPurchaseIdentities' };
const ctx = { design: { system: { ...system, shopDefinitions: [...system.shopDefinitions, shopDefinition] } }, catalog: { operators: {}, bodies: {} } };
function state(day, seed, extra = {}) {
  return { day, rngState: seed >>> 0, gold: 50, nextShopDiscount: 0, relicIds: [], pieces: [], ...extra };
}

test('supply shop day-quality stock is distinct and legal', () => {
  const input = state(1, 0x12345678);
  const beforePieces = structuredClone(input.pieces);
  const shop = buildShopState(input, ctx, shopDefinition.id);
  assert.equal(shop.kind, 'supply');
  assert.equal(shop.slots.length, 4);
  assert.equal(new Set(shop.slots.map((slot) => slot.itemId)).size, 4);
  assert.ok(shop.slots.every((slot) => slot.kind === 'supply' && slot.star <= 2));
  assert.ok(shop.slots.every((slot) => ctx.design.system.supplyItems.find((item) => item.id === slot.itemId).allowedStars.includes(slot.star)));
  assert.deepEqual(input.pieces, beforePieces, 'shop generation does not alter operators or inventory');
  assert.equal(input.nextShopDiscount, 0, 'next discount is consumed once through existing builder');
});

test('late-day offers retain only legal tiers and prices from each definition', () => {
  let sawFourStarMystery = false;
  const seenSeeds = new Set();
  for (let seed = 1; seed <= 256; seed += 1) {
    const input = state(10, seed);
    const offer = buildShopState(input, ctx, shopDefinition.id);
    assert.equal(new Set(offer.slots.map((slot) => slot.itemId)).size, offer.slots.length);
    for (const slot of offer.slots) {
      const item = ctx.design.system.supplyItems.find((entry) => entry.id === slot.itemId);
      assert.ok(item.allowedStars.includes(slot.star));
      assert.equal(slot.price, Math.max(1, item.buyPrices[slot.star - 1]));
      seenSeeds.add(slot.itemId);
      if (slot.itemId === 'supply_mystery' && slot.star === 4) sawFourStarMystery = true;
    }
  }
  assert.ok(seenSeeds.has('supply_soda_machine'));
  assert.ok(sawFourStarMystery, 'day 10 permits the four-star-only mystery flavor when its quality roll selects four stars');
});

test('supply shop is deterministic; discount, refresh fee and previous-round identity exclusion are preserved', () => {
  const a = state(10, 90210, { nextShopDiscount: 99, relicIds: ['cross-lancepro'] });
  const b = state(10, 90210, { nextShopDiscount: 99, relicIds: ['cross-lancepro'] });
  const first = buildShopState(a, ctx, shopDefinition.id);
  const same = buildShopState(b, ctx, shopDefinition.id);
  assert.deepEqual(first, same);
  assert.ok(first.slots.every((slot) => slot.price === 1));
  assert.equal(first.refreshCost, 1);
  first.refreshCount = 0;
  a.shop = first;
  const refreshed = refreshShopState(a, ctx);
  assert.equal(refreshed.shop.refreshCount, 1);
  assert.equal(refreshed.gold, 49);
  assert.deepEqual(refreshed.shop.slots.map((slot) => slot.slotId), first.slots.map((slot) => slot.slotId));
  assert.ok(refreshed.shop.slots.every((slot) => !first.slots.some((old) => old.itemId === slot.itemId)));
  assert.throws(() => refreshShopState(refreshed, ctx), { code: 'SHOP_REFRESH_LIMIT' });
});

test('legacy contexts without supply definitions retain ordinary operator shop behavior', () => {
  const legacy = { ...ctx, catalog: { operators: { legacy: { name: '旧干员', profession: 'PIONEER', price: 2 } }, bodies: { legacy: { charId: 'legacy', purchaseCharId: 'legacy' } } },
    design: { ...ctx.design, system: { ...ctx.design.system, supplyItems: undefined, shopDefinitions: system.shopDefinitions } } };
  const ordinary = buildShopState(state(1, 41), legacy, 'shop_base');
  assert.ok(ordinary.slots.length > 0);
  assert.ok(ordinary.slots.every((slot) => typeof slot.purchaseCharId === 'string' && slot.kind === undefined));
});

