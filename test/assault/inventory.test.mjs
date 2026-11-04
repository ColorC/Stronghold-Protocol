import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRun, applyAction } from '../../shared/assault/run.js';
import { addBodyToInventory, assertInventory, mergeInventory, pieceFromBody } from '../../shared/assault/inventory.js';
import { buildShopState, calculateSellPrice, refreshShopState, meetsShopFilter } from '../../shared/assault/shops.js';

const json = (name) => JSON.parse(readFileSync(new URL(`../../data/assault-design/${name}.json`, import.meta.url), 'utf8'));
const system = json('system');
const events = json('events');
const collectibles = json('collectibles');
const encounters = json('encounters');
const forms = json('forms');
const roster = ['support', 'assault', 'ranged'].flatMap((group) => json(`roster-${group}`).operators);
const operators = Object.fromEntries(roster.map((entry) => [entry.charId, structuredClone(entry)]));
operators.char_002_amiya.extraForms = forms.forms.map((entry) => entry.charId);
operators.char_1045_svash2.nationId = 'kjerag';
operators.char_4072_ironmn.nationId = 'victoria';
operators.char_1041_angel2.nationId = 'lungmen';
const bodies = Object.fromEntries(roster.map((entry) => [entry.charId, {
  charId: entry.charId, purchaseCharId: entry.charId, name: entry.name, profession: entry.profession,
  price: entry.price, defaultModuleId: entry.defaultModuleId ?? null, modulePlans: entry.modulePlans,
  baseStats: { maxHp: 1000 }, starStats: Array.from({ length: 4 }, (_, i) => ({ star: i + 1, stats: { maxHp: 1000 * (i + 1) } })),
}]));
for (const entry of forms.forms) bodies[entry.charId] = {
  charId: entry.charId, purchaseCharId: forms.family.charId, name: entry.name, profession: entry.profession,
  price: entry.price, defaultModuleId: entry.defaultModuleId ?? null, modulePlans: entry.modulePlans,
  baseStats: { maxHp: 1000 }, starStats: Array.from({ length: 4 }, (_, i) => ({ star: i + 1, stats: { maxHp: 1000 * (i + 1) } })),
};
const ctx = { catalog: { operators, bodies }, design: { system, events, collectibles, encounters } };

test('shop price tier restrictions filter the identity pool', () => {
  const restricted = { ...ctx, design: { ...ctx.design, system: { ...system,
    priceTierWeights: { ...system.priceTierWeights, tiers: [2, 3, 4] } } } };
  const state = { day: 1, rngState: 101, pieces: [], relicIds: [], nextShopDiscount: 0 };
  const useGlobalTiers = { ...restricted, design: { ...restricted.design, system: { ...restricted.design.system,
    shopDefinitions: system.shopDefinitions.map(shop => shop.id !== 'shop_archetype_element' ? shop
      : { ...shop, priceRule: { ...shop.priceRule, tiers: undefined } }) } } };
  assert.equal(buildShopState(state, useGlobalTiers, 'shop_archetype_element').slots.length, 0,
    'the system price tiers constrain shops that do not declare their own allowed tiers');
  const explicitTiers = { ...restricted, design: { ...restricted.design, system: { ...restricted.design.system,
    shopDefinitions: system.shopDefinitions.map(shop => shop.id !== 'shop_archetype_element' ? shop
      : { ...shop, priceRule: { ...shop.priceRule, tiers: [6, 8] } }) } } };
  const filtered = buildShopState(state, explicitTiers, 'shop_archetype_element');
  assert.ok(filtered.slots.length > 0);
  assert.ok(filtered.slots.every((slot) => [6, 8].includes(slot.basePrice)), 'shop-specific tiers override the global list');
});

test('all real shop definitions offer distinct identities over multiple days and seeds', () => {
  const sample = createRun({ runId: 'shops', seed: 41, directorId: system.directors[0].id }, ctx);
  assert.equal(system.shopDefinitions.length, 29);
  for (const definition of system.shopDefinitions) {
    const state = { ...structuredClone(sample), day: Math.max(1, definition.unlockDay), rngState: 0x12345678, pieces: [] };
    const shop = buildShopState(state, ctx, definition.id);
    assert.ok(shop.slots.length <= definition.slots);
    const identityOf = (slot) => slot.purchaseCharId ?? slot.skillId ?? slot.enchantmentId ?? slot.itemId;
    assert.equal(new Set(shop.slots.map(identityOf)).size, shop.slots.length);
    for (const slot of shop.slots) {
      if(slot.purchaseCharId&&definition.kind&&definition.kind!=='operator'){
        assert.ok(system.directors.find(d=>d.id===state.directorId).coreCharIds.includes(slot.purchaseCharId));
        assert.equal(slot.price,4*slot.requiredCopies);continue;
      }
      if (definition.kind === 'skill') {
        const skill = system.strategySkills.find((entry) => entry.id === slot.skillId);
        assert.ok(skill);
        assert.equal(slot.price, skill.prices[slot.star - 1]);
        continue;
      }
      if (definition.kind === 'enchantment') {
        assert.ok(system.enchantments.some((entry) => entry.id === slot.enchantmentId));
        assert.equal(slot.price, 8);
        continue;
      }
      if(definition.kind==='supply'){assert.ok(system.supplyItems.some(item=>item.id===slot.itemId));continue;}
      const operator = operators[slot.purchaseCharId];
      assert.ok(meetsShopFilter(operator,definition.filter)
        || system.directors.find(d=>d.id===state.directorId)?.coreCharIds.includes(slot.purchaseCharId),slot.purchaseCharId);
      const copies = 2 ** (slot.star - 1);
      assert.equal(slot.requiredCopies, copies);
      assert.equal(slot.price, definition.priceRule.type === 'discount'
        ? Math.max(definition.priceRule.minPrice ?? 1, 4 * copies - definition.priceRule.amount)
        : 4 * copies);
    }
    for (let day = 1; day <= 10; day += 1) for (let seed = 1; seed <= 3; seed += 1) {
      const varied = buildShopState({ ...structuredClone(sample), day: Math.max(day, definition.unlockDay), pieces: [], rngState: seed * 7919 }, ctx, definition.id);
      assert.equal(new Set(varied.slots.map(identityOf)).size, varied.slots.length);
    }
  }
  const day3 = { ...structuredClone(sample), day: 3, pieces: [], rngState: 5 };
  const star2 = buildShopState(day3, ctx, 'shop_star2');
  for (const slot of star2.slots) {
    assert.equal(slot.star, 2);
    assert.equal(slot.requiredCopies, 2);
    assert.equal(slot.price, 8);
  }
  const day6 = { ...structuredClone(sample), day: 6, pieces: [], rngState: 7 };
  const star3 = buildShopState(day6, ctx, 'shop_star3');
  for (const slot of star3.slots) {
    assert.equal(slot.star, 3);
    assert.equal(slot.requiredCopies, 4);
    assert.equal(slot.price, 16);
  }
  const redeployDefinition = system.shopDefinitions.find((entry) => entry.id === 'shop_archetype_redeploy');
  const redeployPool = Object.entries(operators).filter(([, operator]) => operator.archetype === redeployDefinition.filter.value
    && redeployDefinition.priceRule.tiers.includes(operator.price));
  assert.ok(redeployPool.length >= redeployDefinition.slots);
  const redeploy = buildShopState({ day: 1, pieces: [], relicIds: [], nextShopDiscount: 0, rngState: 41 }, ctx, redeployDefinition.id);
  assert.equal(redeploy.slots.length, redeployDefinition.slots);
  assert.equal(new Set(redeploy.slots.map((slot) => slot.purchaseCharId)).size, redeploy.slots.length);
  assert.ok(redeploy.slots.every((slot) => slot.star === 1), 'day one weights offer one-star bodies');
  const fiveSlotTestContext = { ...ctx, design: { ...ctx.design, system: { ...system,
    shopDefinitions: system.shopDefinitions.map((entry) => entry.id === redeployDefinition.id ? { ...entry, slots: 5 } : entry) } } };
  const unpadded = buildShopState({ day: 1, pieces: [], relicIds: [], nextShopDiscount: 0, rngState: 41 }, fiveSlotTestContext, redeployDefinition.id);
  assert.equal(unpadded.slots.length, 4, 'a five-slot request stops at the four eligible identities instead of padding repeats');
  const highQuality = new Set();
  for (let seed = 1; seed <= 100; seed += 1) {
    for (const slot of buildShopState({ day: 10, pieces: [], relicIds: [], nextShopDiscount: 0, rngState: seed }, ctx, 'shop_base').slots) highQuality.add(slot.star);
  }
  assert.ok([2, 3, 4].every((star) => highQuality.has(star)), 'day ten quality weights can offer two, three, and four star bodies');
  const discountedHigh = buildShopState({ day: 10, pieces: [], relicIds: [], nextShopDiscount: 1, rngState: 901 }, ctx, 'shop_base');
  assert.ok(discountedHigh.slots.some((slot) => slot.star > 1));
  for (const slot of discountedHigh.slots) assert.equal(slot.price,
    Math.max(1, 4 * slot.requiredCopies - 1),
    'next-shop discounts apply once to the displayed item');
  const ownedId = roster.find((entry) => entry.price && entry.charId)?.charId;
  const matchingPieces = Object.keys(operators).filter((id) => id !== ownedId).map((purchaseCharId) => ({ purchaseCharId, sourceCopies: 8 }));
  matchingPieces.push({ purchaseCharId: ownedId, star: 2, sourceCopies: 2 });
  const matching = buildShopState({ day: 10, pieces: matchingPieces, relicIds: [],
    nextShopDiscount: 0, rngState: 77 }, ctx, 'shop_base').slots.find((slot) => slot.purchaseCharId === ownedId);
  assert.equal(matching.star, 2, 'owned bodies preferentially receive the next matching upgrade star');
  const chainPieces = Object.keys(operators).filter((id) => id !== ownedId).map((purchaseCharId) => ({ purchaseCharId, sourceCopies: 8 }));
  chainPieces.push({ purchaseCharId: ownedId, star: 3, sourceCopies: 4 },
    { purchaseCharId: ownedId, star: 2, sourceCopies: 2 }, { purchaseCharId: ownedId, star: 1, sourceCopies: 1 });
  const chainOffer = buildShopState({ day: 10, pieces: chainPieces, relicIds: [], nextShopDiscount: 0, rngState: 79 }, ctx, 'shop_base').slots[0];
  assert.equal(chainOffer.purchaseCharId, ownedId);
  assert.equal(chainOffer.star, 1, 'the highest existing star is skipped when its copy cost exceeds the cap, allowing a legal chain upgrade');
});

test('element shop stocks distinct allowed identities and respects source caps', () => {
  const elementCandidates = Object.entries(operators).filter(([, operator]) => operator.archetype === 'element');
  assert.equal(elementCandidates.length, 26);
  const generatedByTech = Array.from({ length: system.run.xpLevels }, (_, index) => {
    const state = { day: 1, tech: index + 1, pieces: [], relicIds: [], nextShopDiscount: 0, rngState: 0x12345678 };
    return buildShopState(state, ctx, 'shop_archetype_element');
  });
  for (const shop of generatedByTech) {
    assert.equal(shop.slots.length, system.shopDefinitions.find((entry) => entry.id === 'shop_archetype_element').slots);
    assert.equal(shop.supplyVersion, 2);
    assert.equal(new Set(shop.slots.map((slot) => slot.purchaseCharId)).size, shop.slots.length);
  }

  const day3 = buildShopState({ day: 3, tech: 1, pieces: [], relicIds: [], nextShopDiscount: 0, rngState: 0x12345678 }, ctx, 'shop_archetype_element');
  assert.equal(day3.slots.length, system.shopDefinitions.find((entry) => entry.id === 'shop_archetype_element').slots);
  assert.equal(new Set(day3.slots.map((slot) => slot.purchaseCharId)).size, day3.slots.length);
  const refreshInput = { day: 1, tech: 1, pieces: [], relicIds: [], gold: 12, nextShopDiscount: 0, rngState: 0x12345678,
    shop: generatedByTech[0] };
  const refreshed = refreshShopState(refreshInput, ctx);
  assert.equal(refreshed.shop.slots.length, system.shopDefinitions.find((entry) => entry.id === 'shop_archetype_element').slots);
  assert.equal(new Set(refreshed.shop.slots.map((slot) => slot.purchaseCharId)).size, refreshed.shop.slots.length);
  assert.equal(refreshed.shop.refreshCount, 1);
  assert.equal(refreshed.gold, 10);
  const limitedDefinition = system.shopDefinitions.find((entry) => entry.id === 'shop_archetype_element');
  if (Number.isInteger(limitedDefinition.maxRefreshes)) {
    const twice = refreshShopState(refreshInput, ctx);
    const beforeLimitedRefresh = structuredClone(twice);
    assert.throws(() => refreshShopState(twice, ctx), { code: 'SHOP_REFRESH_LIMIT' });
    assert.deepEqual(twice, beforeLimitedRefresh, 'a rejected extra refresh does not change gold, stock, or RNG');
  }

  const capped = elementCandidates.map(([purchaseCharId]) => ({ purchaseCharId, sourceCopies: system.run.sourceCapPerBody }));
  const unavailable = buildShopState({ day: 1, tech: 1, pieces: capped, relicIds: [], nextShopDiscount: 0, rngState: 0x12345678 }, ctx, 'shop_archetype_element');
  assert.equal(unavailable.slots.length, 0, 'no eligible candidates never invent stock');
});

test('discount stacking is consumed once and cross-lancepro only changes refresh cost', () => {
  const state = createRun({ runId: 'discount', seed: 77, directorId: system.directors[0].id }, ctx);
  state.day = 3;
  state.relicIds.push('cross-lancepro');
  state.nextShopDiscount = 2;
  const shop = buildShopState(state, ctx, 'shop_discount');
  assert.equal(shop.consumedNextShopDiscount, 2);
  assert.equal(shop.refreshCost, 2);
  for (const slot of shop.slots) assert.equal(slot.price, Math.max(1, 4 * slot.requiredCopies - 3));
  assert.equal(state.nextShopDiscount, 0);
  assert.equal(state.gold, 12);
});

test('multi-star merge preserves primary placement, sums additive growth, unions tags and claimed markers', () => {
  const state = createRun({ runId: 'merge', seed: 19, directorId: system.directors[0].id }, ctx);
  const charId = 'char_127_estell';
  const pieces = Array.from({ length: 8 }, (_, index) => {
    const piece = pieceFromBody(state, ctx, charId, 1, { row: index === 0 ? 9 : null, col: index === 0 ? 7 : null, dir: 'N' });
    piece.permanentFlat.atk = index + 1;
    piece.permanentPercent.maxHp = 0.01;
    piece.tagEdits.add = [`tag-${index % 3}`];
    piece.claimed = [`claim-${index % 4}`];
    return piece;
  });
  const merged = mergeInventory([...pieces].reverse(), ctx);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].star, 4);
  assert.equal(merged[0].sourceCopies, 8);
  assert.deepEqual([merged[0].row, merged[0].col, merged[0].dir], [9, 7, 'N']);
  assert.equal(merged[0].permanentFlat.atk, 36);
  assert.equal(merged[0].permanentPercent.maxHp, 0.08);
  assert.deepEqual(merged[0].tagEdits.add.sort(), ['tag-0', 'tag-1', 'tag-2']);
  assert.deepEqual(merged[0].claimed.sort(), ['claim-0', 'claim-1', 'claim-2', 'claim-3']);
  assert.equal(merged[0].moduleChoices[charId], operators[charId].defaultModuleId);
  assertInventory(merged, ctx, 0);
  assert.throws(() => assertInventory([...merged, { ...merged[0], uid: 'extra', sourceCopies: 1 }], ctx, 0), { code: 'SOURCE_CAP' });
});

test('bench overflow and failed purchases leave original run and RNG untouched; merging makes capacity', () => {
  const initial = createRun({ runId: 'capacity', seed: 1234, directorId: system.directors[0].id }, ctx);
  const charIds = roster.map((entry) => entry.charId);
  const occupied = structuredClone(initial);
  occupied.pieces = occupied.pieces.slice(0, 3);
  occupied.nextPieceId = 100;
  for (let i = 0; i < 12; i += 1) {
    const chosen = charIds[i];
    const piece = pieceFromBody(occupied, ctx, chosen, 1, { row: null, col: null });
    occupied.pieces.push(piece);
  }
  assertInventory(occupied.pieces, ctx, occupied.xp);
  const duplicate = charIds[0];
  const sourceCopies = occupied.pieces.filter((piece) => piece.purchaseCharId === duplicate).reduce((sum, piece) => sum + piece.sourceCopies, 0);
  if (sourceCopies === 1) {
    const grown = structuredClone(occupied);
    addBodyToInventory(grown, ctx, duplicate, 1);
    assert.equal(grown.pieces.filter((piece) => piece.row === null).length, 11);
    assert.ok(grown.pieces.some((piece) => piece.purchaseCharId === duplicate && piece.star === 2));

    const buyState = structuredClone(occupied);
    buyState.phase = 'shop';
    buyState.shop = { id: 'shop_base', refreshCost: 2, refreshCount: 0, slots: [{ slotId: 'merge-buy', purchaseCharId: duplicate, charId: duplicate, star: 1, requiredCopies: 1, price: operators[duplicate].price }] };
    const purchaseAction = { type: 'buy', slotId: 'merge-buy', opId: 'merge-on-full-bench', expectedRevision: buyState.revision };
    const bought = applyAction(buyState, purchaseAction, ctx);
    assert.equal(bought.state.pieces.filter((piece) => piece.row === null).length, 11);
    const goldAfterPurchase = bought.state.gold;
    assert.strictEqual(applyAction(bought.state, purchaseAction, ctx).state, bought.state);
    assert.equal(bought.state.gold, goldAfterPurchase);
    assert.throws(() => applyAction(bought.state, { ...purchaseAction, slotId: 'other' }, ctx), { code: 'OP_ID_CONFLICT' });
  }
  const before = structuredClone(initial);
  const unaffordable = structuredClone(initial);
  unaffordable.phase = 'shop';
  unaffordable.shop = { id: 'shop_base', refreshCost: 2, refreshCount: 0, slots: [{ slotId: 'costly', purchaseCharId: charIds[0], charId: charIds[0], star: 1, requiredCopies: 1, price: 99 }] };
  assert.throws(() => applyAction(unaffordable, { type: 'buy', slotId: 'costly', opId: 'buy', expectedRevision: unaffordable.revision }, ctx), { code: 'INSUFFICIENT_GOLD' });
  assert.deepEqual(initial, before);
  assert.equal(unaffordable.rngState, initial.rngState);

  const capped = structuredClone(initial);
  capped.phase = 'shop';
  capped.pieces = [pieceFromBody(capped, ctx, charIds[0], 8, { star: 4, row: null, col: null })];
  capped.shop = { id: 'shop_base', refreshCost: 2, refreshCount: 0, slots: [{ slotId: 'capped', purchaseCharId: charIds[0], charId: charIds[0], star: 1, requiredCopies: 1, price: operators[charIds[0]].price }] };
  const cappedBefore = structuredClone(capped);
  assert.throws(() => applyAction(capped, { type: 'buy', slotId: 'capped', opId: 'cap', expectedRevision: capped.revision }, ctx), { code: 'SOURCE_CAP' });
  assert.deepEqual(capped, cappedBefore);
});

test('Amiya form ownership is shared, module selection is per form, and illegal switch is atomic', () => {
  const state = createRun({ runId: 'forms', seed: 99, directorId: system.directors[0].id }, ctx);
  const piece = pieceFromBody(state, ctx, forms.family.charId, 1, { row: null, col: null });
  assert.equal(piece.moduleChoices[forms.family.charId], null, 'advanced module remains locked below three stars');
  state.pieces.push(piece);
  const uidValue = piece.uid;
  const body = bodies.char_1001_amiya2;
  const advanced = body.modulePlans.find((module) => module.type === 'ADVANCED');
  state.currentNode = { kind: 'battle' };
  const snapshot = structuredClone(state);
  const formCtx = { ...ctx, canPlace: () => false };
  assert.throws(() => applyAction(state, { type: 'changeForm', uid: uidValue, charId: 'char_1001_amiya2', row: 9, col: 8, opId: 'illegal', expectedRevision: 0 }, formCtx), { code: 'INVALID_TILE' });
  assert.deepEqual(state, snapshot);
  let next = applyAction(state, { type: 'changeForm', uid: uidValue, charId: 'char_1001_amiya2', opId: 'form', expectedRevision: 0 }, ctx).state;
  assert.equal(next.pieces.find((entry) => entry.uid === uidValue).charId, 'char_1001_amiya2');
  next.pieces.find((entry) => entry.uid === uidValue).star = 3;
  next = applyAction(next, { type: 'chooseModule', uid: uidValue, moduleId: advanced.id, opId: 'module', expectedRevision: 1 }, ctx).state;
  const updated = next.pieces.find((entry) => entry.uid === uidValue);
  assert.equal(updated.moduleChoices.char_1001_amiya2, advanced.id);
  assert.notEqual(updated.moduleChoices.char_002_amiya, advanced.id);
});

test('sell uses the common star curve and never values permanent growth', () => {
  const state = createRun({ runId: 'sell', seed: 101, directorId: system.directors[0].id }, ctx);
  const piece = pieceFromBody(state, ctx, 'char_127_estell', 4, { row: null, col: null, star: 3 });
  piece.permanentFlat.atk = 999999;
  state.pieces.push(piece);
  state.phase = 'shop';
  const sale = applyAction(state, { type: 'sell', uid: piece.uid, opId: 'sale', expectedRevision: 0 }, ctx);
  assert.equal(sale.result.price, 8);
  assert.equal(sale.state.gold, 12 + sale.result.price);
  assert.ok(!sale.state.pieces.some((entry) => entry.uid === piece.uid));
});

test('profession shops add one matching buyback bonus, once per sale, without changing other refunds', () => {
  const definition = system.shopDefinitions.find((entry) => entry.buybackBonus);
  const matchingOperator = roster.find((entry) => entry.profession === definition.buybackBonus.filter.value);
  const otherOperator = roster.find((entry) => entry.profession !== definition.buybackBonus.filter.value);
  const makeSaleState = (operator, copies, star, phase = 'shop') => {
    const state = createRun({ runId: `buyback-${operator.charId}-${copies}-${phase}`, seed: 83, directorId: system.directors[0].id }, ctx);
    const piece = pieceFromBody(state, ctx, operator.charId, copies, { star, row: null, col: null });
    state.pieces.push(piece);
    state.phase = phase;
    state.shop = { id: definition.id, refreshCost: 2, refreshCount: 0, supplyVersion: 2, slots: [] };
    return { state, piece };
  };

  const { state: matched, piece: matchedPiece } = makeSaleState(matchingOperator, 1, 1);
  const matchedBase = 2;
  assert.equal(calculateSellPrice(matchedPiece, ctx, matched), matchedBase + 1);
  const matchedSale = applyAction(matched, { type: 'sell', uid: matchedPiece.uid, opId: 'buyback-match', expectedRevision: matched.revision }, ctx);
  assert.equal(matchedSale.result.price, matchedBase + 1, 'the actual transaction uses the displayed sell-price helper');

  const { state: mismatch, piece: mismatchPiece } = makeSaleState(otherOperator, 1, 1);
  const mismatchBase = 2;
  assert.equal(applyAction(mismatch, { type: 'sell', uid: mismatchPiece.uid, opId: 'buyback-mismatch', expectedRevision: mismatch.revision }, ctx).result.price, mismatchBase);

  const { state: fourStar, piece: fourStarPiece } = makeSaleState(matchingOperator, 8, 4);
  const fourStarBase = 16;
  assert.equal(applyAction(fourStar, { type: 'sell', uid: fourStarPiece.uid, opId: 'buyback-four-star', expectedRevision: fourStar.revision }, ctx).result.price,
    fourStarBase + 1, 'the bonus is added once to the eight-copy refund, not once per copy');

  const { state: outOfPhase, piece: outOfPhasePiece } = makeSaleState(matchingOperator, 1, 1, 'nodeChoice');
  assert.equal(calculateSellPrice(outOfPhasePiece, ctx, outOfPhase), matchedBase, 'outside shop phase only the base refund applies');

  const { state: invalid, piece: invalidPiece } = makeSaleState(matchingOperator, 1, 1);
  const before = structuredClone(invalid);
  const invalidCtx = { ...ctx, design: { ...ctx.design, system: { ...system,
    shopDefinitions: system.shopDefinitions.map((entry) => entry.id === definition.id
      ? { ...entry, buybackBonus: { ...entry.buybackBonus, amount: 1.5 } } : entry) } } };
  assert.throws(() => applyAction(invalid, { type: 'sell', uid: invalidPiece.uid, opId: 'invalid-buyback', expectedRevision: invalid.revision }, invalidCtx),
    { code: 'INVALID_SHOP_BUYBACK' });
  assert.deepEqual(invalid, before, 'invalid configured buyback values leave the run untouched');
});
