import { grantEquipment, equipmentRecord } from './equipment.js';

const byId = (map, id) => map && typeof id === 'string' && Object.hasOwn(map, id) ? map[id] : null;
const prizeIds = (catalog) => Object.keys(catalog?.prizes || {}).sort();

export function makePrizeOffer(state, catalog, tier = 'start', source = 'round', rng = null) {
  const available = prizeIds(catalog).filter((id) => {
    const p = catalog.prizes[id];
    return p.stage === ({ start: '起步', build: '成型', cashout: '兑现' }[tier]) || p.stage === tier;
  });
  if (!available.length) return null;
  const choices = [];
  let fallbackState = state.rngState >>> 0 || 1;
  while (choices.length < Math.min(3, available.length)) {
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
  if (!prize) throw new Error('BAD_OFFER');
  const rule = { type: prize.mechanism, ...(prize.params || {}) };
  const grant = (itemId, n = 1, extra = {}) => grantEquipment(state, catalog, itemId, n, extra);
  const outputs = (rule.outputs || []).map((x) => ({ id: x.id, quantity: x.quantity || 1 }));
  if (rule.type === 'grantItems' || rule.type === 'grantItemsPerPiece') {
    const multiplier = rule.type === 'grantItemsPerPiece' ? Math.min(rule.cap || 8, state.pieces.length) : 1;
    for (const out of outputs) grant(out.id, out.quantity * multiplier);
  } else if (rule.type === 'grantGear' || rule.type === 'conditionalGrantGear') {
    if (rule.type === 'conditionalGrantGear' && !state.pieces.some((p) => p.equipment.some((x) => rule.requiresAnyBadge?.includes(x.id)))) throw new Error('NO_ELIGIBLE_TARGET');
    grant(rule.gearId);
  } else if (rule.type === 'freeRefreshes') state.shop.freeRefreshes = (state.shop.freeRefreshes || 0) + Number(rule.count || 0);
  else if (rule.type === 'facilityIncome') {
    if (!state.playerEffects.some((x) => x.type === 'facilityIncome')) state.playerEffects.push({ type: 'facilityIncome', amount: Number(rule.amount || 0), source: id });
  } else if (rule.type === 'recruitOffer') {
    const tier = rule.tier === 'currentShopLevel' ? state.shop.level : Number(rule.tier);
    const candidates = Object.keys(catalog.operators).filter((x) => catalog.operators[x].tier === tier && !catalog.operators[x].elite && !catalog.operators[x].isElite).sort();
    if (!candidates.length) throw new Error('NO_CANDIDATE');
    state.offers.push({ id: `o${state.nextUid++}`, type: 'recruit', choices: candidates.slice(0, rule.choices || 3), tier, source: 'prize' });
  } else if (rule.type === 'attachmentOffer') {
    const piece = state.pieces.find((x) => x.uid === selection.targetUid);
    if (!piece) throw new Error('BAD_TARGET');
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
      const candidates = Object.keys(catalog.operators).filter((x) => catalog.operators[x].tier === tier && !catalog.operators[x].elite && !catalog.operators[x].isElite).sort();
      if (candidates.length) slot.id = candidates[(state.rngState++ >>> 0) % candidates.length];
      slot.equipment = [];
    }
  } else if (rule.type === 'promoteOperator') {
    const piece = state.pieces.find((x) => x.uid === selection.targetUid);
    const op = piece && catalog.operators[piece.chessId];
    if (!piece || piece.elite || !op?.eliteChessId) throw new Error('BAD_TARGET');
    piece.chessId = op.eliteChessId; piece.elite = true;
  }
  else if (rule.type === 'repeatNativeForging') state.playerEffects.push({ type: 'repeatNativeForging', source: id, extraRepeats: rule.extraRepeats || 1 });
  else throw new Error('UNSUPPORTED_PRIZE');
  state.offers.splice(oi, 1);
  if (!state.offers.some((x) => x.type === 'prize')) state.phase = 'prep';
  return { prizeId: id };
}

function attachmentAccepted(def, piece, catalog) {
  const op = catalog.operators[piece.chessId] || {};
  const condition = String(def.condition || 'any');
  if (condition === 'any') return true;
  if (condition === 'native medic profession') return (op.source?.normalChess?.profession || op.profession) === 'MEDIC';
  if (condition === 'selected ammo skill') return /ammo|弹药/i.test(op.skills?.[piece.skillIndex] || '');
  if (condition === 'native freeze') return (op.talents || []).some((x) => /冻结/.test(x.desc || '')) || (op.skills || []).some((x) => /freeze/i.test(x));
  return false;
}

export function useInventoryItem(state, catalog, itemUid, action = {}) {
  const i = state.inventory.findIndex((x) => x.uid === itemUid); if (i < 0) throw new Error('BAD_TARGET');
  const item = state.inventory[i]; const def = equipmentRecord(catalog, item.id) || byId(catalog.prizes, item.id);
  if (!def) throw new Error('UNKNOWN_ITEM');
  const behavior = def.mechanism ? { type: def.mechanism, ...(def.params || {}) } : def.use || def.rule || def.behavior;
  if (behavior?.type === 'funds') state.funds += Number(behavior.quantity || 0);
  else if (behavior?.type === 'topUp') state.funds = Math.max(state.funds, state.incomeThisRound || 0);
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
  } else if (behavior?.type === 'funds') {
    state.funds += Number(behavior.normal ?? 1) + (item.elite ? Number(behavior.eliteBonus ?? 1) : 0);
  } else if (behavior?.type === 'activeFundTopUp') {
    const target = Number(state.incomeThisRound || 0);
    if (state.funds < target) state.funds = target;
  } else if (behavior?.type === 'custom' || behavior?.type === 'passive') {
    throw new Error('NOT_USABLE');
  } else throw new Error('NOT_USABLE');
  if (item.quantity > 1) item.quantity -= 1; else state.inventory.splice(i, 1);
  return { itemId: item.id };
}
