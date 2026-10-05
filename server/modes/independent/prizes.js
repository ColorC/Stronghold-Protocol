import { grantEquipment, equipmentRecord } from './equipment.js';
import { attachmentAccepted, tavernFactions } from '../../../shared/independentRules.js';

const byId = (map, id) => map && typeof id === 'string' && Object.hasOwn(map, id) ? map[id] : null;
const prizeIds = (catalog) => Object.keys(catalog?.prizes || {}).sort();

export function makePrizeOffer(state, catalog, tier = 'start', source = 'round', rng = null) {
  const available = prizeIds(catalog).filter((id) => {
    const p = catalog.prizes[id];
    if (!(p.stage === ({ start: '起步', build: '成型', cashout: '兑现' }[tier]) || p.stage === tier)) return false;
    if (p.mechanism === 'promoteOperator' && !(state.pieces || []).some((piece) => !piece.elite && catalog.operators[piece.chessId]?.eliteChessId)) return false;
    if (p.mechanism === 'recruitOffer') {
      const targetTier = p.params?.tier === 'currentShopLevel' ? state.shop.level : Number(p.params?.tier);
      if (!Object.values(catalog.operators).some((op) => !op.elite && !op.isElite && op.tier === targetTier && state.pool?.[op.chessId]?.left > 0)) return false;
    }
    if (p.mechanism === 'attachmentOffer' && !(state.pieces || []).some((piece) => piece.row !== null && piece.col !== null && Object.values(catalog.attachments || {}).some((x) => x.unique && attachmentAccepted(x, piece, catalog) && !piece.attachments.some((a) => a.id === x.id)))) return false;
    if (p.mechanism === 'conditionalGrantGear') {
      const ids = [...(state.inventory || []).map((x) => x.id), ...(state.pieces || []).flatMap((piece) => (piece.equipment || []).map((x) => x.id))];
      if (!ids.some((itemId) => p.params?.requiresAnyBadge?.includes(equipmentRecord(catalog, itemId)?.badgeId || itemId))) return false;
    }
    if (p.mechanism === 'facilityIncome' && state.playerEffects?.some((x) => x.type === 'facilityIncome' && x.source === id)) return false;
    if (p.mechanism === 'repeatNativeForging' && state.playerEffects?.some((x) => x.type === 'repeatNativeForging' && x.expiresRound === state.round)) return false;
    return true;
  });
  const general = (id) => ['grantItems', 'grantItemsPerPiece', 'grantGear', 'freeRefreshes', 'facilityIncome', 'futureShopEquipment', 'replaceCurrentShop', 'activeFundTopUp'].includes(catalog.prizes[id]?.mechanism);
  const fallbacks = ['fallback-procurement-three', 'fallback-procurement-two', 'fallback-procurement-one'];
  if (!available.some(general)) available.unshift(fallbacks[0]);
  while (available.length < 3) available.push(fallbacks.find((id) => !available.includes(id)));
  const choices = [];
  let fallbackState = state.rngState >>> 0 || 1;
  const generic = available.filter((id) => general(id) || id === fallbacks[0]);
  const requiredGeneric = generic[Math.floor((rng ? rng() : ((fallbackState = (fallbackState ^ (fallbackState << 13) ^ (fallbackState >>> 17) ^ (fallbackState << 5)) >>> 0) / 0x100000000)) * generic.length)];
  choices.push(requiredGeneric);
  while (choices.length < 3) {
    if (!rng) { fallbackState ^= fallbackState << 13; fallbackState ^= fallbackState >>> 17; fallbackState ^= fallbackState << 5; fallbackState >>>= 0; }
    const index = Math.floor((rng ? rng() : fallbackState / 0x100000000) * available.length); const id = available[index];
    if (!choices.includes(id)) choices.push(id);
  }
  if (!rng) state.rngState = fallbackState;
  const offer = { id: `o${state.nextUid++}`, type: 'prize', choices, tier, source };
  state.offers.push(offer); state.phase = 'prize';
  return offer;
}

function prizeById(catalog, id) { return byId(catalog?.prizes, id); }

export function choosePrize(state, catalog, offerId, index, selection = {}) {
  const oi = state.offers.findIndex((x) => x.id === offerId && x.type === 'prize');
  if (oi < 0 || !Number.isInteger(index)) throw new Error('BAD_OFFER');
  const offer = state.offers[oi]; const id = offer.choices[index]; const prize = prizeById(catalog, id);
  if (id === 'fallback-procurement-three' || id === 'fallback-procurement-two' || id === 'fallback-procurement-one') {
    const quantity = id.endsWith('three') ? 3 : id.endsWith('two') ? 2 : 1;
    grantEquipment(state, catalog, 'chess_item_1_03_e_a', quantity);
    state.offers.splice(oi, 1); if (!state.offers.some((x) => x.type === 'prize')) state.phase = 'prep';
    return { prizeId: id, quantity };
  }
  if (!prize) throw new Error('BAD_OFFER');
  const rule = { type: prize.mechanism, ...(prize.params || {}) };
  const grant = (itemId, n = 1, extra = {}) => grantEquipment(state, catalog, itemId, n, extra);
  const outputs = (rule.outputs || []).map((x) => ({ id: x.id, quantity: x.quantity || 1 }));
  if (rule.type === 'grantItems' || rule.type === 'grantItemsPerPiece') {
    const multiplier = rule.type === 'grantItemsPerPiece' ? Math.min(rule.cap || 8, state.pieces.filter((x) => x.row !== null && x.col !== null).length) : 1;
    for (const out of outputs) grant(out.id, out.quantity * multiplier);
  } else if (rule.type === 'grantGear' || rule.type === 'conditionalGrantGear') {
    if (rule.type === 'conditionalGrantGear') {
      const owned = [...(state.inventory || []).map((x) => x.id), ...(state.pieces || []).flatMap((p) => p.equipment.map((x) => x.id))];
      if (!owned.some((itemId) => rule.requiresAnyBadge?.includes(equipmentRecord(catalog, itemId)?.badgeId || itemId))) throw new Error('NO_ELIGIBLE_TARGET');
    }
    grant(rule.gearId);
  } else if (rule.type === 'freeRefreshes') state.shop.freeRefreshes = (state.shop.freeRefreshes || 0) + Number(rule.count || 0);
  else if (rule.type === 'facilityIncome') {
    if (!state.playerEffects.some((x) => x.type === 'facilityIncome' && x.source === id)) { const amount = Number(rule.amount || 0); state.funds += amount; state.playerEffects.push({ type: 'facilityIncome', amount, source: id }); }
  } else if (rule.type === 'recruitOffer') {
    const tier = rule.tier === 'currentShopLevel' ? state.shop.level : Number(rule.tier);
    const candidates = Object.keys(catalog.operators).filter((x) => catalog.operators[x].tier === tier && !catalog.operators[x].elite && !catalog.operators[x].isElite && state.pool?.[x]?.left > 0).sort();
    if (!candidates.length) throw new Error('NO_CANDIDATE');
    state.offers.push({ id: `o${state.nextUid++}`, type: 'recruit', choices: candidates.slice(0, rule.choices || 3), tier, source: 'prize' });
  } else if (rule.type === 'attachmentOffer') {
    const piece = state.pieces.find((x) => x.uid === selection.targetUid);
    if (!piece || piece.row === null || piece.col === null) throw new Error('BAD_TARGET');
    const choices = Object.values(catalog.attachments || {}).filter((x) => x.unique && !piece.attachments.some((a) => a.id === x.id) && attachmentAccepted(x, piece, catalog)).map((x) => x.id);
    if (!choices.length) throw new Error('NO_ELIGIBLE_TARGET');
    state.offers.push({ id: `o${state.nextUid++}`, type: 'attachment', choices: choices.slice(0, rule.choices || 3), targetUid: piece.uid, source: id });
  } else if (rule.type === 'activeFundTopUp') state.inventory.push({ uid: `i${state.nextUid++}`, id, quantity: 1, state: {} });
  else if (rule.type === 'futureShopEquipment') {
    state.playerEffects.push({ type: 'futureShopEquipment', id: rule.id, quantity: rule.quantity, currentUnclaimed: true, source: id });
    for (const slot of state.shop.slots) if (slot.kind === 'chess' && !slot.sold && !slot.equipment.some((x) => x.origin === id)) slot.equipment.push({ id: rule.id, quantity: rule.quantity, origin: id });
  } else if (rule.type === 'replaceCurrentShop') {
    for (const slot of state.shop.slots) {
      if (slot.kind !== 'chess' || slot.sold || !slot.id) continue;
      const old = catalog.operators[slot.id]; const tier = Math.min(Number(rule.maxTier || 6), Number(old?.tier || state.shop.level) + Number(rule.tierDelta || 1));
      const candidates = Object.keys(catalog.operators).filter((x) => catalog.operators[x].tier === tier && !catalog.operators[x].elite && !catalog.operators[x].isElite && state.pool?.[x]?.left > 0).sort();
      if (candidates.length) slot.id = candidates[(state.rngState++ >>> 0) % candidates.length];
      slot.equipment = [];
    }
  } else if (rule.type === 'promoteOperator') {
    const piece = state.pieces.find((x) => x.uid === selection.targetUid);
    const op = piece && catalog.operators[piece.chessId];
    if (!piece || piece.elite || !op?.eliteChessId) throw new Error('BAD_TARGET');
    piece.chessId = op.eliteChessId; piece.elite = true;
  }
  else if (rule.type === 'repeatNativeForging') state.playerEffects.push({ type: 'repeatNativeForging', source: id, extraRepeats: rule.extraRepeats || 1, expiresRound: state.round });
  else throw new Error('UNSUPPORTED_PRIZE');
  state.offers.splice(oi, 1);
  if (!state.offers.some((x) => x.type === 'prize')) state.phase = 'prep';
  return { prizeId: id };
}

export function useInventoryItem(state, catalog, itemUid, action = {}, data = null) {
  const i = state.inventory.findIndex((x) => x.uid === itemUid); if (i < 0) throw new Error('BAD_TARGET');
  const item = state.inventory[i]; const def = equipmentRecord(catalog, item.id) || byId(catalog.prizes, item.id);
  if (!def) throw new Error('UNKNOWN_ITEM');
  const behavior = def.mechanism ? { type: def.mechanism, ...(def.params || {}) } : def.use || def.rule || def.behavior;
  if (behavior?.type === 'immediateFundsOnUse' || behavior?.type === 'fundsOnUse' || behavior?.type === 'conditionalFundsOnUse') {
    if (behavior.type === 'conditionalFundsOnUse' && (state.shop?.level || 1) < (behavior.condition === 'tierAtLeast4' ? 4 : 1)) throw new Error('CONDITION_NOT_MET');
    state.funds += Number(item.elite ? (behavior.eliteFunds ?? behavior.elite) : (behavior.normalFunds ?? behavior.normal));
  } else if (behavior?.type === 'deferredFundsOnUse') state.pendingFunds += Number(item.elite ? behavior.eliteFunds : behavior.normalFunds);
  else if (behavior?.type === 'activeFundTopUp') {
    const target = Number(state.incomeThisRound || 0);
    if (state.funds < target) state.funds = target;
  }
  else if (behavior?.type === 'equipment') {
    for (const out of behavior.outputs || []) grantEquipment(state, catalog, out.id, out.quantity || 1);
  } else if (behavior?.type === 'recruit') {
    const list = Object.keys(catalog.operators).filter((id) => catalog.operators[id].tier === Number(behavior.tier) && !catalog.operators[id].elite).sort();
    if (!list.length) throw new Error('NO_CANDIDATE');
    state.offers.push({ id: `o${state.nextUid++}`, type: 'recruit', choices: list.slice(0, 3), tier: behavior.tier, source: item.id });
  } else if (behavior?.type === 'upgradeChess') {
    const p = state.pieces.find((x) => x.uid === action.targetUid);
    if (!p || p.elite) throw new Error('BAD_TARGET');
    const op = catalog.operators[p.chessId]; if (!op?.eliteChessId) throw new Error('NOT_UPGRADABLE');
    p.chessId = op.eliteChessId; p.elite = true;
  } else if (behavior?.type === 'shopRecruitOnUse') {
    const count = Number(item.elite ? behavior.eliteCount : behavior.normalCount); const slots = action.slots || [action.slot];
    if (!Array.isArray(slots) || slots.length !== count || slots.some((x) => !Number.isInteger(x)) || new Set(slots).size !== slots.length) throw new Error('BAD_SLOT');
    for (const index of slots) {
      const slot = state.shop.slots[index];
      if (!slot || slot.kind !== 'chess' || slot.sold || !slot.id || (behavior.ordinaryOnly && slot.elite)) throw new Error('BAD_SLOT');
      slot.sold = true;
      state.offers.push({ id: `o${state.nextUid++}`, type: 'recruit', choices: [slot.id], source: item.id, carriedEquipment: structuredClone(slot.equipment || []) });
    }
  } else if (behavior?.type === 'factionRecruitOnUse') {
    const factions = new Set((state.pieces || []).filter((p) => p.row !== null).flatMap((p) => tavernFactions(p, catalog)));
    if (!factions.has(action.faction)) throw new Error('BAD_FACTION');
    const count = Number(item.elite ? (behavior.eliteOffers ?? behavior.eliteCount ?? 1) : (behavior.normalOffers ?? behavior.normalCount ?? 1));
    const exactTier = behavior.normalTier === 'currentShop' ? Math.min(6, state.shop.level + (item.elite ? Number(behavior.eliteTierDelta || 0) : 0)) : null;
    const maxTier = behavior.maxTier === 'shopLevel' || behavior.normalTier === 'currentShop' ? (exactTier ?? state.shop.level) : Number(behavior.normalTier || behavior.maxTier || 6);
    for (let i = 0; i < count; i++) {
      const candidates = Object.values(catalog.operators).filter((op) => !op.elite && (exactTier === null ? op.tier <= maxTier : op.tier === exactTier) && tavernFactions({ chessId: op.chessId }, catalog).includes(action.faction) && state.pool?.[op.chessId]?.left > 0).map((op) => op.chessId).sort();
      if (!candidates.length) throw new Error('NO_CANDIDATE');
      const choices = candidates.slice(0, behavior.choices || 3);
      state.offers.push({ id: `o${state.nextUid++}`, type: 'recruit', choices, source: item.id, faction: action.faction });
    }
  } else if (behavior?.type === 'recruitOnUse') {
    const source = state.pieces.find((x) => x.uid === action.sourceUid); if (!source || source.elite) throw new Error('BAD_TARGET');
    const count = Number(item.elite ? (behavior.eliteOffers ?? behavior.eliteCount) : (behavior.normalOffers ?? behavior.normalCount));
    for (let i = 0; i < count; i++) state.offers.push({ id: `o${state.nextUid++}`, type: 'recruit', choices: [source.chessId], source: item.id });
  } else if (behavior?.type === 'copyOperatorOnUse') {
    const source = state.pieces.find((x) => x.uid === action.sourceUid); if (!source || source.elite) throw new Error('BAD_TARGET');
    const count = Number(item.elite ? (behavior.eliteCount || 2) : (behavior.normalCount || 1));
    for (let i = 0; i < count; i++) state.offers.push({ id: `o${state.nextUid++}`, type: 'recruit', choices: [source.chessId], source: item.id, copyNativeOnly: true });
  } else if (behavior?.type === 'promoteOnUse') {
    const count = Number(item.elite ? (behavior.eliteCount || 2) : (behavior.normalCount || 1)); const targets = action.targets || [action.targetUid];
    if (!Array.isArray(targets) || targets.length !== count || new Set(targets).size !== targets.length) throw new Error('BAD_TARGET');
    const pieces = targets.map((uid) => state.pieces.find((p) => p.uid === uid));
    if (pieces.some((p) => !p || p.elite || !catalog.operators[p.chessId]?.eliteChessId)) throw new Error('BAD_TARGET');
    for (const p of pieces) { p.chessId = catalog.operators[p.chessId].eliteChessId; p.elite = true; }
  } else if (behavior?.type === 'saleThresholdRecruit') {
    const threshold = Number(item.elite ? (behavior.eliteSaleThreshold ?? behavior.eliteThreshold ?? behavior.saleThresholdElite) : (behavior.normalSaleThreshold ?? behavior.normalThreshold ?? behavior.saleThresholdNormal));
    const uses = Number(item.state?.uses || 0);
    if (!Number.isFinite(threshold) || (state.counters?.sold || 0) < threshold || uses >= Number(behavior.prepCap || 1)) throw new Error('CONDITION_NOT_MET');
    const factions = new Set((state.pieces || []).flatMap((p) => tavernFactions(p, catalog)));
    const faction = action.faction;
    if (!factions.has(faction)) throw new Error('BAD_FACTION');
    const maxTier = state.shop.level;
    const candidates = Object.values(catalog.operators).filter((op) => !op.elite && op.tier <= maxTier && tavernFactions({ chessId: op.chessId }, catalog).includes(faction) && state.pool?.[op.chessId]?.left > 0).map((op) => op.chessId).sort();
    if (!candidates.length) throw new Error('NO_CANDIDATE');
    item.state = { ...(item.state || {}), uses: uses + 1 };
    state.offers.push({ id: `o${state.nextUid++}`, type: 'recruit', choices: candidates.slice(0, behavior.choices || 3), source: item.id, faction });
  } else if (behavior?.type === 'custom' || behavior?.type === 'passive') {
    throw new Error('NOT_USABLE');
  } else if (behavior?.type === 'facilityIncome') {
    const key = def.canonicalId || item.id;
    const existing = (state.playerEffects || []).find((x) => x.type === 'facilityIncome' && x.source === key);
    const elite = !!item.elite; const amount = Number(elite ? (behavior.eliteIncome ?? behavior.amount ?? 0) : (behavior.normalIncome ?? behavior.amount ?? 0));
    if (existing) {
      if (!elite || existing.elite) throw new Error('LIMIT_REACHED');
      existing.amount = amount; existing.elite = true;
    } else state.playerEffects.push({ type: 'facilityIncome', source: key, amount, elite });
  } else if (behavior?.type === 'deployCap') {
    if ((state.playerEffects || []).some((x) => x.type === 'deployCap' && x.source === item.id)) throw new Error('LIMIT_REACHED');
    const amount = Number(behavior.amount || 1); const max = Number(behavior.max || 9);
    if (state.deployCap + amount > max || (state.playerEffects || []).filter((x) => x.type === 'deployCap').length >= Number(behavior.perRunLimit || 1)) throw new Error('LIMIT_REACHED');
    state.deployCap += amount; state.playerEffects.push({ type: 'deployCap', source: item.id, amount });
  } else throw new Error('NOT_USABLE');
  if (item.quantity > 1) item.quantity -= 1; else state.inventory.splice(i, 1);
  return { itemId: item.id };
}
