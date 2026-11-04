import { bodyFor, operatorFor } from './inventory.js';
import { codedError, pickWeighted } from './rng.js';
import { enchantmentDefinitions, skillDefinitions } from './upgrades.js';

export const SHOP_SUPPLY_VERSION = 2;
// Every operator occupies one population slot: use one common Medium price
// curve, rather than multiplying role valuation by the merge-copy count.
export const OPERATOR_BUY_PRICES = Object.freeze([4, 8, 16, 32]);
export const OPERATOR_SELL_PRICES = Object.freeze([2, 4, 8, 16]);

function ownedCopies(state, purchaseCharId) {
  return state.pieces.filter((piece) => piece.purchaseCharId === purchaseCharId).reduce((sum, piece) => sum + piece.sourceCopies, 0);
}

function offeredStarFor(operator, purchaseCharId, state, ctx, fixedStar, rngState) {
  if (fixedStar > 1) return { star: fixedStar, rngState };
  const owned = state.pieces.filter((piece) => piece.purchaseCharId === purchaseCharId);
  if (owned.length) {
    const totalCopies = owned.reduce((sum, piece) => sum + piece.sourceCopies, 0);
    const cap = ctx.design.system.run.sourceCapPerBody;
    const highestLegal = Math.max(0, ...owned.map((piece) => piece.star)
      .filter((star) => star < 4 && totalCopies + 2 ** (star - 1) <= cap));
    return { star: highestLegal || null, rngState };
  }
  const byDay = ctx.design.system.shopQualityWeights?.days?.[String(state.day)];
  if (!byDay) return { star: 1, rngState };
  const candidates = Object.entries(byDay).map(([star, weight]) => ({ star: Number(star), weight }))
    .filter(({ star, weight }) => weight > 0 && 2 ** (star - 1) <= ctx.design.system.run.sourceCapPerBody);
  const picked = pickWeighted(candidates, rngState);
  return { star: picked.value?.star ?? 1, rngState: picked.state };
}

function offerPrice(definition, star, nextDiscount) {
  const discount = definition.priceRule.type === 'discount' ? definition.priceRule.amount : 0;
  return Math.max(definition.priceRule.minPrice ?? 1, OPERATOR_BUY_PRICES[star - 1] - discount - nextDiscount);
}

function qualityForDay(state, ctx, minimum = 1) {
  const weights = ctx.design.system.shopQualityWeights?.days?.[String(state.day)];
  if (!weights) return { star: minimum, rngState: state.rngState >>> 0 };
  const candidates = Object.entries(weights).map(([star, weight]) => ({ star: Number(star), weight }))
    .filter(({ star, weight }) => star >= minimum && weight > 0 && star <= 4);
  const picked = pickWeighted(candidates, state.rngState >>> 0);
  return { star: picked.value?.star ?? minimum, rngState: picked.state >>> 0 };
}

function operatorShopCandidates(state,ctx,definition,excludePurchaseCharIds=[],coreOnly=false){
  const excluded = new Set(excludePurchaseCharIds);
  const coreIds=ctx.design.system.directors.find(d=>d.id===state.directorId)?.coreCharIds??[];
  const candidates = [];
  for (const [purchaseCharId, operator] of Object.entries(ctx.catalog.operators)) {
    if (excluded.has(purchaseCharId)||coreOnly&&!coreIds.includes(purchaseCharId)) continue;
    if (!operatorInShopPool(purchaseCharId,operator,definition,ctx,state.directorId)) continue;
    const allowedTiers = definition.priceRule.tiers ?? ctx.design.system.priceTierWeights.tiers;
    if (allowedTiers && !allowedTiers.includes(operator.price)) continue;
    const copies = ownedCopies(state, purchaseCharId);
    if (copies >= ctx.design.system.run.sourceCapPerBody) continue;
    if (definition.offeredStar > 1 && copies + 2 ** (definition.offeredStar - 1) > ctx.design.system.run.sourceCapPerBody) continue;
    if (!(definition.offeredStar > 1) && state.pieces.some((piece) => piece.purchaseCharId === purchaseCharId)
      && !offeredStarFor(operator, purchaseCharId, state, ctx, definition.offeredStar, state.rngState >>> 0).star) continue;
    const basePrice = operator.price;
    if (!Number.isFinite(basePrice) || basePrice <= 0) throw codedError('INVALID_OPERATOR_PRICE', `${purchaseCharId} has invalid price`);
    const charId = definition.offeredStar > 1 ? (ctx.catalog.bodies[purchaseCharId] ? purchaseCharId : operator.extraForms?.[0] ?? purchaseCharId) : purchaseCharId;
    if (!ctx.catalog.bodies[charId]) throw codedError('MISSING_OPERATOR_BODY', `${purchaseCharId} has no runtime body`);
    candidates.push({ purchaseCharId, charId, name: operator.name, profession: operator.profession, basePrice });
  }

  return candidates;
}
function coreShopCandidates(state,ctx,definition,options){return operatorShopCandidates(state,ctx,definition,options.excludePurchaseCharIds??[],true).map(entry=>({...entry,kind:'operator'}));}
function resolveOperatorSlot(state,ctx,definition,chosen,rngState,nextDiscount,slotId){
 const operator=ctx.catalog.operators[chosen.purchaseCharId];
 const resolved=offeredStarFor(operator,chosen.purchaseCharId,state,ctx,definition.offeredStar,rngState);
 const star=resolved.star;
 if(!star||ownedCopies(state,chosen.purchaseCharId)+2 ** (star-1)>ctx.design.system.run.sourceCapPerBody)return {slot:null,rngState:resolved.rngState};
 const charId=star>1&&!ctx.catalog.bodies[chosen.purchaseCharId]?operator.extraForms?.[0]??chosen.purchaseCharId:chosen.purchaseCharId;
 return{rngState:resolved.rngState,slot:{slotId,...chosen,charId,price:offerPrice(definition,star,nextDiscount),star,requiredCopies:2 ** (star-1),offered:true}};
}

function buildUpgradeShopState(state, ctx, definition, options, nextDiscount) {
  const kind = definition.kind;
  const isSkill = kind === 'skill';
  const entries = isSkill ? skillDefinitions(ctx) : enchantmentDefinitions(ctx);
  const already = new Set(options.excludeIds ?? []);
  const dailyQualities = ctx.design.system.shopQualityWeights?.days?.[String(state.day)];
  const canOfferSkill = (entry) => {
    const rank = state.skillRanks?.[entry.id] ?? 0;
    if (rank > 0) return rank < 4;
    if (!Number.isInteger(entry.startingStar) || entry.startingStar < 1 || entry.startingStar > 4) {
      throw codedError('INVALID_STRATEGY_SKILL', `Invalid startingStar for strategy skill ${entry.id}`);
    }
    if (!dailyQualities) return true;
    return Object.entries(dailyQualities).some(([star, weight]) => Number(star) >= entry.startingStar && Number(weight) > 0);
  };
  const candidates = [...entries.filter((entry) => !already.has(entry.id) && (isSkill ? canOfferSkill(entry) : true)),...coreShopCandidates(state,ctx,definition,options)];
  let rngState = state.rngState >>> 0;
  const slots = [];
  const requested = options.slotCount == null ? definition.slots : Math.max(0, Math.min(definition.slots, Math.floor(options.slotCount)));
  const remaining = candidates.slice();
  for (let index = 0; index < requested && remaining.length; index += 1) {
    const picked = pickWeighted(remaining.map((entry) => ({ entry, weight: 1 })), rngState);
    rngState = picked.state >>> 0;
    const entry = picked.value.entry;
    if(entry.kind==='operator'){
      const resolved=resolveOperatorSlot(state,ctx,definition,entry,rngState,nextDiscount,options.slotIds?.[index]??`${definition.id}:${index}`);rngState=resolved.rngState;
      remaining.splice(remaining.indexOf(entry),1);if(resolved.slot)slots.push(resolved.slot);else index--;continue;
    }
    const currentRank = state.skillRanks?.[entry.id] ?? 0;
    const resolved = isSkill
      ? currentRank ? { star: currentRank, rngState } : qualityForDay({ ...state, rngState }, ctx, entry.startingStar)
      : { star: 1, rngState };
    rngState = resolved.rngState;
    const star = resolved.star;
    let price;
    if (isSkill) {
      if (!Array.isArray(entry.prices) || entry.prices.length !== 4 || entry.prices.some((value) => !Number.isFinite(value) || value < 0))
        throw codedError('INVALID_STRATEGY_SKILL', `Invalid prices for strategy skill ${entry.id}`);
      price = Math.max(1, entry.prices[star - 1] - nextDiscount);
    } else {
      if (!Number.isInteger(entry.price) || entry.price < 0) throw codedError('INVALID_ENCHANTMENT', `Invalid price for enchantment ${entry.id}`);
      price = Math.max(1, entry.price - nextDiscount);
    }
    slots.push({ slotId: options.slotIds?.[index] ?? `${definition.id}:${index}`, kind,
      [isSkill ? 'skillId' : 'enchantmentId']: entry.id, name: entry.name, star, price,
      ...(isSkill ? {} : { eligibility: entry.eligibility }) });
    remaining.splice(remaining.indexOf(entry), 1);
  }
  state.rngState = rngState >>> 0;
  const fee = Math.max(1, definition.refreshCost - (state.relicIds?.includes('cross-lancepro') ? 1 : 0));
  return { id: definition.id, kind, slots, supplyVersion: SHOP_SUPPLY_VERSION, refreshCost: fee, refreshCount: 0,
    consumedNextShopDiscount: nextDiscount, consumedRelicFeeReduction: state.relicIds?.includes('cross-lancepro') ? 1 : 0 };
}

function buildSupplyShopState(state, ctx, definition, options, nextDiscount) {
  const definitions = ctx.design.system.supplyItems ?? [];
  const daily = ctx.design.system.shopQualityWeights?.days?.[String(state.day)] ?? {};
  const excluded = new Set(options.excludeSupplyItemIds ?? []);
  const candidates = definitions.filter((entry) => ['machine', 'beverage'].includes(entry.kind))
    .filter((entry) => !excluded.has(entry.id)
      && entry.allowedStars?.some((star) => Number.isFinite(daily[String(star)]) && daily[String(star)] > 0));
  candidates.push(...coreShopCandidates(state,ctx,definition,options));
  let rngState = state.rngState >>> 0;
  const slots = [];
  const remaining = candidates.slice();
  const requested = options.slotCount == null ? definition.slots : Math.max(0, Math.min(definition.slots, Math.floor(options.slotCount)));
  for (let index = 0; index < requested && remaining.length; index += 1) {
    const selected = pickWeighted(remaining.map((entry) => ({ entry, weight: 1 })), rngState);
    rngState = selected.state >>> 0;
    const entry = selected.value.entry;
    remaining.splice(remaining.indexOf(entry), 1);
    if(entry.kind==='operator'){
      const resolved=resolveOperatorSlot(state,ctx,definition,entry,rngState,nextDiscount,options.slotIds?.[index]??`${definition.id}:${index}`);rngState=resolved.rngState;
      if(resolved.slot)slots.push(resolved.slot);else index--;continue;
    }
    const qualities = entry.allowedStars.map((star) => ({ star, weight: daily[String(star)] ?? 0 }))
      .filter((quality) => Number.isInteger(quality.star) && quality.star >= 1 && quality.star <= 4 && quality.weight > 0);
    const resolved = pickWeighted(qualities, rngState);
    rngState = resolved.state >>> 0;
    if (!resolved.value) continue;
    if (!Array.isArray(entry.buyPrices) || entry.buyPrices.length !== 4
      || entry.buyPrices.some((price) => !Number.isFinite(price) || price < 0))
      throw codedError('INVALID_SUPPLY_DEFINITION', `Invalid buy prices for supply item ${entry.id}`);
    const star = resolved.value.star;
    slots.push({ slotId: options.slotIds?.[index] ?? `${definition.id}:${index}`, kind: 'supply',
      itemId: entry.id, name: entry.name, star, price: Math.max(1, entry.buyPrices[star - 1] - nextDiscount) });
  }
  state.rngState = rngState >>> 0;
  const relicFeeReduction = hasRelic(state, 'cross-lancepro') ? 1 : 0;
  const refreshCost = Math.max(1, definition.refreshCost - relicFeeReduction);
  return { id: definition.id, kind: 'supply', slots, supplyVersion: SHOP_SUPPLY_VERSION, refreshCost,
    refreshCount: 0, consumedNextShopDiscount: nextDiscount, consumedRelicFeeReduction: relicFeeReduction };
}
function hasRelic(state, relicId) {
  return state.relicIds.includes(relicId);
}

export function meetsShopFilter(operator, filter) {
  if (filter.type === 'none') return true;
  if (filter.type === 'profession') return operator.profession === filter.value;
  if (filter.type === 'faction') return operator.nationId === filter.value || operator.faction === filter.value || operator.tags?.includes(filter.value);
  if (filter.type === 'archetype') return operator.archetype === filter.value;
  throw codedError('UNKNOWN_SHOP_FILTER', `Unknown shop filter: ${filter.type}`);
}

export function operatorInShopPool(purchaseCharId,operator,definition,ctx,directorId){
  if(meetsShopFilter(operator,definition.filter))return true;
  const director=ctx.design.system.directors.find(entry=>entry.id===directorId);
  return director?.coreCharIds?.includes(purchaseCharId)??false;
}

export function eligibleShopDefinitions(state, ctx) {
  return ctx.design.system.shopDefinitions.filter((shop) => shop.unlockDay <= state.day);
}

export function buildShopState(state, ctx, shopId, { excludePurchaseCharIds = [], excludeSupplyItemIds = [], slotCount = null, slotIds = null } = {}) {
  const definition = ctx.design.system.shopDefinitions.find((shop) => shop.id === shopId);
  if (!definition) throw codedError('UNKNOWN_SHOP', `Unknown shop: ${shopId}`);
  if (definition.unlockDay > state.day) throw codedError('SHOP_LOCKED', `Shop ${shopId} unlocks on day ${definition.unlockDay}`);
  const nextDiscount = state.nextShopDiscount;
  state.nextShopDiscount = 0;
  if (['skill', 'enchantment'].includes(definition.kind)) {
    return buildUpgradeShopState(state, ctx, definition, { slotCount, slotIds, excludePurchaseCharIds }, nextDiscount);
  }
  if (definition.kind === 'supply') {
    return buildSupplyShopState(state, ctx, definition, { excludeSupplyItemIds, excludePurchaseCharIds, slotCount, slotIds }, nextDiscount);
  }
  const candidates = operatorShopCandidates(state,ctx,definition,excludePurchaseCharIds);

  const relicFeeReduction = hasRelic(state, 'cross-lancepro') ? 1 : 0;
  const refreshCost = Math.max(1, definition.refreshCost - relicFeeReduction);
  const slots = [];
  const remaining = candidates.slice();
  let rngState = state.rngState >>> 0;
  const requestedSlots = slotCount == null ? definition.slots : Math.max(0, Math.min(definition.slots, Math.floor(slotCount)));
  for (let index = 0; index < requestedSlots && remaining.length; index += 1) {
    if (!['priceTierWeights', 'discount', 'starPrice', 'definitionPrices'].includes(definition.priceRule.type)) {
      throw codedError('UNKNOWN_SHOP_PRICE_RULE', `Unknown shop price rule: ${definition.priceRule.type}`);
    }
    const picked = pickWeighted(remaining.map((item) => ({ item, weight: 1 })), rngState);
    rngState = picked.state;
    const chosen = picked.value.item;
    const operator = ctx.catalog.operators[chosen.purchaseCharId];
    const resolved = offeredStarFor(operator, chosen.purchaseCharId, state, ctx, definition.offeredStar, rngState);
    rngState = resolved.rngState;
    const star = resolved.star;
    if (!star) { remaining.splice(remaining.indexOf(chosen), 1); index -= 1; continue; }
    const requiredCopies = 2 ** (star - 1);
    if (ownedCopies(state, chosen.purchaseCharId) + requiredCopies > ctx.design.system.run.sourceCapPerBody) {
      remaining.splice(remaining.indexOf(chosen), 1); index -= 1; continue;
    }
    const price = offerPrice(definition, star, nextDiscount);
    const charId = star > 1 && !ctx.catalog.bodies[chosen.purchaseCharId]
      ? operator.extraForms?.[0] ?? chosen.purchaseCharId : chosen.purchaseCharId;
    slots.push({ slotId: slotIds?.[index] ?? `${shopId}:${index}`, ...chosen, charId, price, star, requiredCopies, offered: true });
    remaining.splice(remaining.indexOf(chosen), 1);
  }
  state.rngState = rngState >>> 0;
  return {
    id: shopId,
    kind: definition.kind ?? 'operator',
    slots,
    supplyVersion: SHOP_SUPPLY_VERSION, priceVersion: 1,
    refreshCost,
    refreshCount: 0,
    consumedNextShopDiscount: nextDiscount,
    consumedRelicFeeReduction: relicFeeReduction,
  };
}

/** Reconcile one legacy shop round from its recorded buys while preserving the earliest unsold offer per identity. */
export function repairLegacyShopSupply(state, ctx) {
  const shop = state?.shop;
  const node = state?.currentNode;
  if (state?.phase !== 'shop' || !shop || ![undefined, 1].includes(shop.supplyVersion) || !Array.isArray(shop.slots)
    || node?.kind !== 'shop' || node.shopId !== shop.id || !Array.isArray(state.opJournal)
    || !Number.isInteger(shop.consumedNextShopDiscount) || shop.consumedNextShopDiscount < 0) return null;
  const selectedIndex = state.opJournal.findLastIndex((entry) => entry?.action?.type === 'selectNode'
    && entry.result?.selected === node.id);
  if (selectedIndex < 0) return null;
  let latestSupplyIndex = selectedIndex;
  let foundRefresh = shop.refreshCount === 0;
  for (let index = selectedIndex + 1; index < state.opJournal.length; index += 1) {
    if (state.opJournal[index]?.action?.type === 'refreshShop'
      && state.opJournal[index]?.result?.refreshCount === shop.refreshCount) { latestSupplyIndex = index; foundRefresh = true; }
  }
  if (!foundRefresh) return null;
  const roundJournal = state.opJournal.slice(latestSupplyIndex + 1);
  const buys = roundJournal.filter((entry) => entry?.action?.type === 'buy');
  if (buys.some((entry) => typeof entry.result?.purchaseCharId !== 'string')) return null;
  if (shop.slots.length === 0 && buys.length > 0) return null;
  const boughtIds = new Set(buys.map((entry) => entry.result.purchaseCharId));
  const definition = ctx.design.system.shopDefinitions.find((entry) => entry.id === shop.id);
  if (!definition) return null;
  const originalTotal = shop.slots.length + buys.length || definition.slots;
  const remainingTotal = Math.min(definition.slots, Math.max(0, originalTotal - buys.length));
  const kept = [];
  const seen = new Set(boughtIds);
  for (const slot of shop.slots) {
    if (seen.has(slot.purchaseCharId)) continue;
    seen.add(slot.purchaseCharId);
    kept.push(slot);
  }
  const duplicateOffers = shop.slots.some((slot, index, all) => all.findIndex((candidate) => candidate.purchaseCharId === slot.purchaseCharId) !== index);
  const boughtIdentityStillOffered = shop.slots.some((slot) => boughtIds.has(slot.purchaseCharId));
  const hasLegacyEmpty = shop.slots.length === 0;
  if (!duplicateOffers && !boughtIdentityStillOffered && !hasLegacyEmpty) return null;

  const needed = Math.max(0, Math.min(remainingTotal, definition.slots) - kept.length);
  const occupied = new Set(kept.map((slot) => slot.slotId));
  const availableSlotIds = Array.from({ length: definition.slots }, (_, index) => `${shop.id}:${index}`).filter((id) => !occupied.has(id));
  const refillCount = Math.min(needed, availableSlotIds.length);
  let rngState = state.rngState;
  let replenishment = [];
  if (refillCount) {
    const input = { ...state, nextShopDiscount: shop.consumedNextShopDiscount };
    const generated = buildShopState(input, ctx, shop.id, {
      excludePurchaseCharIds: [...seen], slotCount: refillCount, slotIds: availableSlotIds,
    });
    replenishment = generated.slots;
    rngState = input.rngState;
  }
  if (hasLegacyEmpty && kept.length === 0 && replenishment.length === 0) return null;
  return { shop: { ...shop, slots: [...kept, ...replenishment], supplyVersion: SHOP_SUPPLY_VERSION }, rngState,
    migrated: true };
}

/** Update only unbought quotes; keep the offer identities, RNG and past payments. */
export function repriceOperatorShop(state, ctx) {
  const shop=state?.shop;
  if(state?.phase!=='shop'||!shop||shop.priceVersion===1||!shop.slots.length||!shop.slots.every(slot=>slot.purchaseCharId))return null;
  const definition=ctx.design.system.shopDefinitions.find(entry=>entry.id===shop.id);
  if(!definition)return null;
  return {shop:{...shop,priceVersion:1,slots:shop.slots.map(slot=>slot.sold?slot:{...slot,
    price:offerPrice(definition,slot.star,shop.consumedNextShopDiscount??0)})},rngState:state.rngState};
}

export const repairEmptyLegacyShop = repairLegacyShopSupply;

export function refreshShopState(state, ctx) {
  if (!state.shop) throw codedError('NO_SHOP', 'No shop is open');
  const definition = ctx.design?.system?.shopDefinitions?.find((entry) => entry.id === state.shop.id);
  if (Number.isInteger(definition?.maxRefreshes) && state.shop.refreshCount >= definition.maxRefreshes)
    throw codedError('SHOP_REFRESH_LIMIT', 'This shop has reached its refresh limit');
  if (state.gold < state.shop.refreshCost) throw codedError('INSUFFICIENT_GOLD', 'Not enough gold to refresh');
  const draft = { ...state, rngState: state.rngState >>> 0 };
  const refreshOptions = definition?.kind === 'supply' ? {
    excludeSupplyItemIds: state.shop.slots.map((slot) => slot.itemId),
    slotCount: state.shop.slots.length,
    slotIds: state.shop.slots.map((slot) => slot.slotId),
  } : {};
  const nextShop = buildShopState(draft, ctx, state.shop.id, refreshOptions);
  draft.gold -= state.shop.refreshCost;
  nextShop.refreshCount = state.shop.refreshCount + 1;
  return { ...draft, shop: nextShop };
}

export function calculateSellPrice(piece, ctx, state = null) {
  const operator = operatorFor(ctx, piece.purchaseCharId);
  let base = OPERATOR_SELL_PRICES[piece.star - 1];
  if (state?.phase !== 'shop' || !state.shop) return piece.enchantmentId === 'enchant_golden' ? base * 2 : base;
  const definition = ctx.design?.system?.shopDefinitions?.find((entry) => entry.id === state.shop.id);
  const buyback = definition?.buybackBonus;
  if (!buyback) return piece.enchantmentId === 'enchant_golden' ? base * 2 : base;
  if (!Number.isInteger(buyback.amount) || buyback.amount < 0) {
    throw codedError('INVALID_SHOP_BUYBACK', `Invalid buyback amount for shop ${state.shop.id}`);
  }
  base += meetsShopFilter(operator, buyback.filter) ? buyback.amount : 0;
  return piece.enchantmentId === 'enchant_golden' ? base * 2 : base;
}

export function shopContext(state, ctx) {
  return {
    definitions: eligibleShopDefinitions(state, ctx).map(({ id, name, group, kind, unlockDay, slots, refreshCost, maxRefreshes, offeredStar, filter }) => ({ id, name, group, kind: kind ?? 'operator', unlockDay, slots, refreshCost, maxRefreshes, offeredStar, filter })),
    current: state.shop,
  };
}

export function runtimeBodyForOffer(offer, ctx) {
  const body = bodyFor(ctx, offer.charId);
  return body.purchaseCharId === offer.purchaseCharId ? body : null;
}
