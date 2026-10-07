import { getData } from '../../data.js';
import { GameData } from '../../match/gamedata.js';
import { canPlace, inField, positionClass } from '../../match/board.js';
import { modeIdFor } from '../../../shared/constants.js';
import { createRng } from '../../sim/rng.js';
import { getCatalog } from './catalog.js';
import { runNativeHook, runEquipmentPrepEnd } from './native.js';
import { runIndependentBattle, getIndependentField, previewUnitStats } from './battle.js';
import { previewOf } from '../../match/waves.js';
import { EQUIPMENT_CAPACITY, grantEquipment, makeItem, equipItem, normalizeGearForms, equipmentRecord, capacityUsed, totalEquipmentLevel, discardPieceAssets, recordProduction } from './equipment.js';
import { makePrizeOffer, choosePrize, useInventoryItem } from './prizes.js';
import { previewInheritance, applyInheritance } from './inheritance.js';
import { shopCarryApplies } from './warbandPrep.js';
import { decorateDarkmoonShopSlots, applyDarkmoonShopGrowth, applyDarkmoonAHGrowth } from './darkmoonShop.js';
import { GROWTH_MODES, operatorGrowthInfo } from '../../../shared/independentGrowth.js';
import { TAVERN_FACTIONS } from '../../../shared/independentRules.js';
import { nativeFactions, tavernFactions, attachmentAccepted, nativeBodyStats, inheritanceQualification } from '../../../shared/independentRules.js';

const quiet = { warn() {}, error() {}, info() {} };
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']);
const isRecord = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const safeId = (x) => typeof x === 'string' && x.length > 0 && !FORBIDDEN.has(x);
const clone = (x) => structuredClone(x);
const own = (x, k) => isRecord(x) && Object.hasOwn(x, k);
const ops = (catalog) => catalog?.operators || {};
const baseId = (id) => String(id).replace(/_b$/, '_a');
const opFor = (catalog, id) => own(ops(catalog), id) ? ops(catalog)[id] : null;
const ensurePrep = (state) => { if (state.phase !== 'prep') throw new Error('WRONG_PHASE'); };
const pushEvent = (state, event) => state.history.push({ round: state.round, ...event });

function sessionData(options = {}) { return options.data || getData({ log: quiet }); }
function sessionCatalog(data, options = {}) { return options.catalog || getCatalog(data); }
function gdFor(state, data) { return new GameData(data, modeIdFor('solo', state.difficulty.toLowerCase())); }
function baseIncomeFor(round, gd, catalog) {
  const balance = catalog.config?.balance || {};
  return gd.income(round) + (round >= Number(balance.incomeBonusFromRound || Infinity) ? Number(balance.incomeBonus || 0) : 0);
}
function poolFor(state, id) { const key = baseId(id); return state.pool[key] || null; }
/**
 * Retained for legacy callers. New sessions no longer roll a faction ban; missing openFactions means every configured faction.
 */
export const OPEN_FACTION_COUNT = 5;
export function pickOpenFactions(seed, count = OPEN_FACTION_COUNT) {
  // its own stream, so the session's main rng (shop draws) is not shifted by the pick
  const rng = createRng(((Number(seed) >>> 0) ^ 0x5f3759df) >>> 0);
  const all = Object.values(TAVERN_FACTIONS);
  const chosen = new Set(rng.shuffle([...all]).slice(0, Math.min(count, all.length)));
  return all.filter((f) => chosen.has(f));
}
const countsAsAllFactions = (op) => op?.name === '锡人'
  || (op?.nativeTrait?.effect?.combat || []).some((r) => r?.behavior === 'staticStats' && Array.isArray(r.params?.factions) && r.params.factions.length >= Object.keys(TAVERN_FACTIONS).length);
export function operatorOpen(chessId, catalog, openFactions) {
  if (!Array.isArray(openFactions)) return true;
  const op = opFor(catalog, baseId(chessId));
  if (countsAsAllFactions(op)) return true;
  const factions = tavernFactions({ chessId: baseId(chessId) }, catalog);
  return !factions.length || factions.some((f) => openFactions.includes(f));
}
function operatorPool(state, catalog, gd, openFactions = null) {
  const out = {};
  for (const [id, op] of Object.entries(ops(catalog))) {
    if (!safeId(id) || op.elite || op.isElite || id.endsWith('_b') || op.recruitable === false) continue;
    if (!operatorOpen(id, catalog, openFactions)) continue;
    // copies by the tier the operator has in this mode: the mode's own table (design rules.poolCopies, Battlegrounds'
    // 15/15/13/11/9/7 since 2026-10-07) wins over the original's per-operator overrides
    const own = catalog.config?.poolCopies?.[op.tier]; const override = gd.economy?.poolCopiesOverrides?.[id]; const perTier = gd.economy?.poolCopies?.[op.tier];
    const cap = Math.max(0, Number(own ?? (Number.isInteger(override) ? override : (Number.isInteger(perTier) ? perTier : gd.poolCopies(id)))) || 0);
    if (cap) out[id] = { cap, left: cap, tier: Number(op.tier || 1) };
  }
  return out;
}
function sanitizeRecruitPool(state, catalog) {
  for (const [id, entry] of Object.entries(state.pool || {})) {
    const op = opFor(catalog, id);
    if (!op || op.elite || op.isElite || op.recruitable === false) entry.left = 0;
  }
  for (const slot of state.shop?.slots || []) {
    const op = slot.kind === 'chess' && slot.id ? opFor(catalog, slot.id) : null;
    if (slot.kind === 'chess' && slot.id && (!op || op.elite || op.isElite || op.recruitable === false)) {
      slot.id = null;
      slot.sold = true;
      slot.equipment = [];
    }
  }
}
/**
 * 晋升奖励 (the original's promotion reward, server/match/PlayerState.js pushRewardOffer): an elite formed queues a free
 * pick of three DIFFERENT operators of tier min(调度中心等级 + 1, 6), copy-weighted from the pool; a tier without one
 * more tops up from the tier below. Restored 2026-10-07 (user: 「怎么没有三连奖励了？？？」).
 */
export const PROMOTION_REWARD = Object.freeze({ count: 3, tierOffset: 1, maxTier: 6 });
function pushPromotionReward(state, catalog, rng) {
  const tier = Math.min((state.shop?.level || 1) + PROMOTION_REWARD.tierOffset, PROMOTION_REWARD.maxTier);
  const choices = [];
  for (let i = 0; i < PROMOTION_REWARD.count; i++) {
    let id = null;
    for (let t = tier; t >= 1 && !id; t--) {
      const eligible = Object.entries(state.pool).filter(([cid, p]) => p.left > 0 && p.tier === t && Boolean(opFor(catalog, cid)) && opFor(catalog, cid)?.recruitable !== false && !choices.includes(cid));
      const total = eligible.reduce((n, [, p]) => n + p.left, 0);
      if (!total) continue;
      let roll = rng() * total;
      for (const [cid, p] of eligible) { roll -= p.left; if (roll < 0) { id = cid; break; } }
      id ||= eligible.at(-1)[0];
    }
    if (id) choices.push(id);
  }
  if (choices.length) state.offers.push({ id: `o${state.nextUid++}`, type: 'recruit', choices, tier, source: 'merge' });
}
function drawChess(state, catalog, rng, maxTier) {
  const eligible = Object.entries(state.pool).filter(([id, p]) => p.left > 0 && p.tier <= maxTier && Boolean(opFor(catalog, id)) && opFor(catalog, id)?.recruitable !== false);
  const total = eligible.reduce((n, [, p]) => n + p.left, 0);
  if (!total) return null;
  let roll = rng() * total;
  for (const [id, p] of eligible) { roll -= p.left; if (roll < 0) return id; }
  return eligible.at(-1)?.[0] || null;
}
/**
 * The shop sells operators only (2026-10-06): every piece of gear comes through operators, so the original's
 * equipment place shows one more operator.
 */
function slotsFor(state, gd, catalog, rng) {
  const counts = gd.shopSlots(state.shop.level); const slots = [];
  for (let i = 0; i < counts.chess + counts.item; i++) slots.push({ kind: 'chess', id: drawChess(state, catalog, rng, state.shop.level), elite: false, price: 3, sold: false, equipment: [] });
  // 商店预增益 (native shopCarry): every new offer carries what the game has built up so far
  for (const fx of state.playerEffects || []) if (fx.type === 'shopCarry' && fx.quantity > 0) for (const slot of slots) if (shopCarryApplies(fx,slot,catalog)) slot.equipment.push({ id: fx.id, quantity: fx.quantity, origin: 'shopCarry' });
  return decorateDarkmoonShopSlots(state,catalog,slots);
}
function advanceShop(state, gd, catalog, rng) {
  const next = slotsFor(state, gd, catalog, rng);
  const current = state.shop.slots || [];
  return [...next.map((slot, i) => current[i] && !current[i].sold && (state.shop.frozen || current[i].frozen) ? current[i] : slot),
    ...current.slice(next.length).filter(slot=>!slot.sold&&(state.shop.frozen||slot.frozen))];
}
function invokeHook(state, hook, event, services) {
  const outer = services.phase; services.phase = hook;
  try {
    const result = runNativeHook(state, hook, event, services);
    if (hook === 'gain' && event.piece) handleGainEquipment(state, services.catalog, event.piece);
    return result;
  } finally { services.phase = outer; }
}
function servicesFor(state, data, catalog, rng) {
  const services = { data, catalog, rng, phase: null,
    // the running hook names the production ledger's phase (equipment.js recordProduction)
    grantEquipment: (draft, id, quantity, extra = {}) => grantEquipment(draft, catalog, id, quantity, { phase: services.phase, ...extra }),
    transformPiece: (draft, piece, slot, makeGolden = false) => transformPieceIntoShopCopy(draft, catalog, piece, slot, makeGolden),
    grantChess: (draft, chessId, extra = {}) => { const room = roomFor(draft, catalog, chessId, { allowTemp: true }); if (!room) { pushEvent(draft, { type: 'no-room', chessId }); return null; } const piece = gainChess(draft, catalog, chessId, extra); if (room === 'temp') piece.temp = true; invokeHook(draft, 'gain', { piece, source: extra.source || 'nativeRecruit', paid: false }, servicesFor(draft, data, catalog, rng)); maybeMergeOperator(draft, catalog, chessId); return piece; },
    addOffer: (draft, offer) => draft.offers.push(offer),
    recordProduction: (draft, entry) => recordProduction(draft, { phase: services.phase, ...entry }),
    record: (draft, event) => pushEvent(draft, event),
  };
  return services;
}
/** Game-long totals the second-wave traits read (native.js grantByTotal / totalBonus). */
function addTotal(state, key, n = 1) { state.totals ||= {}; state.totals[key] = Number(state.totals[key] || 0) + n; }
/**
 * 整备区上限 (user 2026-10-07 chose the original's 10 + 5; server/match/PlayerState.js acquireChess): the bench holds
 * BENCH_SIZE operators. A full bench refuses buys and withdrawals, except a purchase that completes an elite. An operator
 * gained any other way (a reward, a free recruit, a trait's recruit) overflows into the 临时整备区 (TEMP_SIZE); while it
 * holds anyone, the battle cannot start. With both full the operator goes back to the pool (「整备区已满，获得的干员已返还」).
 * A save from before the cap keeps every operator it has.
 */
export const BENCH_SIZE = 10;
export const TEMP_SIZE = 5;
const onBoard = (p) => p.row != null && p.col != null;
export const benchCount = (state) => state.pieces.filter((p) => !onBoard(p) && !p.temp).length;
export const tempCount = (state) => state.pieces.filter((p) => p.temp).length;
function completesMerge(state, catalog, chessId) {
  const op = opFor(catalog, chessId);
  if (!op?.eliteChessId) return false;
  return state.pieces.filter((p) => p.chessId === chessId && !p.elite).length + 1 >= mergeCopiesRequired(op);
}
/** Where an operator about to be gained goes: 'merge' | 'bench' | 'temp' | null (no room). */
function roomFor(state, catalog, chessId, { allowTemp }) {
  if (completesMerge(state, catalog, chessId)) return 'merge';
  if (benchCount(state) < BENCH_SIZE) return 'bench';
  if (allowTemp && tempCount(state) < TEMP_SIZE) return 'temp';
  return null;
}
/** A temp operator moves onto the bench as soon as a place frees up (a sale, a merge, a deployment). */
function settleTemp(state) {
  for (const p of state.pieces) if (p.temp && benchCount(state) < BENCH_SIZE) delete p.temp;
}
function gainChess(state, catalog, chessId, extra = {}) {
  const def = opFor(catalog, chessId); if (!def || def.elite || def.isElite) throw new Error('UNKNOWN_CHESS');
  const stock = poolFor(state, chessId);
  if (!extra.poolTaken) { if (!stock?.left) throw new Error('SOLD_OUT'); stock.left--; }
  const uid = `p${state.nextUid++}`; const sourceChess = def.source?.normalChess || {};
  const piece = { uid, chessId, elite: false, row: null, col: null, dir: 'RIGHT', skillIndex: Number(sourceChess.skill?.index ?? def.defaultSkillIndex ?? 0), moduleId: 'none', equipment: [], attachments: [], nativeState: { preferences: { productionBadge: 'precision', factionPriority: Object.values(TAVERN_FACTIONS) } }, bodyPenaltyApplied: false, poolCopies: extra.poolCopies ?? 1 };
  if (state.growthMode === 'levels') { piece.growthMode = 'levels'; piece.growthLevel = 1; operatorGrowthInfo(piece, catalog); }
  ensurePermit(piece, catalog);
  state.pieces.push(piece); state.counters.gained = (state.counters.gained || 0) + 1; addTotal(state, 'gained');
  return piece;
}
/**
 * The operator's 交接凭证 (catalog permitGearId), worn from the moment it is gained. Its uid follows the piece's,
 * so granting it draws no uid; it never moves in a handover (inheritable: false) and a merge keeps one copy.
 */
function lacksPermit(piece, catalog) {
  const id = opFor(catalog, piece.chessId)?.permitGearId;
  return id && !piece.equipment.some((x) => x.id === id) ? id : null;
}
function ensurePermit(piece, catalog) {
  const id = lacksPermit(piece, catalog);
  if (id) piece.equipment.push({ uid: `permit-${piece.uid}`, id, quantity: 1, state: {}, sourceId: id });
}
function transformPieceIntoShopCopy(state,catalog,piece,slot,makeGolden=false) {
  if(!slot||slot.kind!=='chess'||slot.sold||!slot.id||!opFor(catalog,slot.id)) throw new Error('BAD_SHOP_TARGET');
  const sourceId=piece.chessId,targetBase=baseId(slot.id),target=opFor(catalog,targetBase);
  const chosenId=makeGolden?(target?.eliteChessId||target?.eliteId):targetBase;
  if(!chosenId||!opFor(catalog,chosenId)) throw new Error(makeGolden?'GOLDEN_SHOP_TARGET_UNAVAILABLE':'BAD_SHOP_TARGET');
  const chosenPool=poolFor(state,targetBase);if(!chosenPool?.left)throw new Error('SOLD_OUT');
  safeCopyPool(state,sourceId,piece.poolCopies||1);chosenPool.left--;
  const chosen=opFor(catalog,chosenId);
  piece.chessId=chosenId;piece.elite=Boolean(makeGolden);piece.poolCopies=1;
  piece.skillIndex=Number((chosen.source?.normalChess||{}).skill?.index??chosen.defaultSkillIndex??0);
  piece.moduleId='none';piece.equipment=[];piece.attachments=[];piece.bodyPenaltyApplied=false;
  piece.nativeState={preferences:{productionBadge:'precision',factionPriority:Object.values(TAVERN_FACTIONS)}};
  if(state.growthMode==='levels'){piece.growthMode='levels';piece.growthLevel=1;operatorGrowthInfo(piece,catalog);}else{delete piece.growthMode;delete piece.growthLevel;}
  ensurePermit(piece,catalog);return piece;
}
function applyDarkmoonBattleResults(state,catalog,results,services,events) {
  if(!results)return;
  const outer=services.phase;services.phase='battle';
  try {
    for(const growth of results.growth||[]) {
      const target=state.pieces.find(p=>p.uid===growth.targetUid);
      if(!target) { events.push({type:'darkmoon-growth-lost',sourceUid:growth.sourceUid,targetUid:growth.targetUid,reason:'target-missing'}); continue; }
      const grants=applyDarkmoonAHGrowth(state,catalog,target,growth.attackUnits??growth.attackLevels,growth.secondaryUnits??growth.secondaryLevels,services,
        {sourceUid:growth.sourceUid,landOn:`uid:${target.uid}`,targetUid:target.uid,battleGrowth:true});
      if(grants.length)events.push({type:'darkmoon-growth',sourceUid:growth.sourceUid,targetUid:target.uid,grants});
    }
    for(const recruit of results.recruits||[]) {
      const chessId=recruit.chessId,room=roomFor(state,catalog,chessId,{allowTemp:true});
      if(!room){events.push({type:'darkmoon-recruit-lost',sourceUid:recruit.sourceUid,chessId,reason:'no-room'});continue;}
      const piece=gainChess(state,catalog,chessId,{poolTaken:false,poolCopies:1});
      if(room==='temp')piece.temp=true;
      if(recruit.pristine!==false)piece.darkmoonPendingPlay=true;
      events.push({type:'darkmoon-recruit',sourceUid:recruit.sourceUid,chessId,uid:piece.uid,pendingPlay:Boolean(piece.darkmoonPendingPlay)});
    }
    for(const coin of results.coins||[]) {
      const quantity=Math.max(0,Math.floor(Number(coin.quantity)||0));
      if(quantity)grantEquipment(state,catalog,'chess_item_1_03_e_a',quantity,{origin:'native',phase:'battle',sourceUid:coin.sourceUid});
    }
  } finally { services.phase=outer; }
}
/** A save from before 交接凭证 were gear: give each of the twelve operators the one it brings (no-op otherwise). */
function ensurePermits(state, catalog) { for (const piece of state.pieces || []) ensurePermit(piece, catalog); }
function handleGainEquipment(state, catalog) {
  for (const piece of state.pieces) {
  if (!tavernFactions(piece, catalog).includes('炎')) continue;
  for (const item of piece.equipment || []) {
    const def = equipmentRecord(catalog, item.id);
    const effect = def?.params?.effects?.find((x) => x.behavior === 'gainBattleStats' && x.params?.deferredFunds);
    if (!effect || !piece.equipment.some((x) => (x.sourceId || equipmentRecord(catalog, x.id)?.sourceId) === effect.params.pairedSourceId)) continue;
    if (item.state?.deferredFundsRound === state.round) continue;
    const amount = Number(effect.params.deferredFunds?.normal ?? effect.params.deferredFunds);
    if (amount > 0) { state.pendingFunds += amount; item.state = { ...(item.state || {}), deferredFundsRound: state.round }; }
  }
  }
}
function mergeCopiesRequired(op) {
  const custom = op?.nativeTrait?.effect?.prep?.find((x) => x.trigger === 'merge' && x.behavior === 'twoCopyElite');
  return Math.max(2, Number(custom?.params?.copiesRequired || 3));
}
const isPermit = (item, catalog) => equipmentRecord(catalog, item.id)?.mechanism === 'inheritancePermit';
function mergeKey(item, catalog) {
  const d = equipmentRecord(catalog, item.id);
  // the copies' own 交接凭证 are the same item: they fold into one without asking (mergeOperator)
  return d?.unique && !isPermit(item, catalog) ? (d.uniqueKey || d.canonicalId || item.id) : null;
}
function mergeOperator(state, catalog, pieceUids, uniqueSelections = {}) {
  if (!Array.isArray(pieceUids) || new Set(pieceUids).size !== pieceUids.length) throw new Error('BAD_MERGE_GROUP');
  const group = pieceUids.map((uid) => state.pieces.find((p) => p.uid === uid));
  if (group.some((p) => !p || p.elite) || group.some((p) => p.chessId !== group[0].chessId)) throw new Error('BAD_MERGE_GROUP');
  const op = opFor(catalog, group[0].chessId); const required = mergeCopiesRequired(op);
  if (group.length !== required || !op?.eliteChessId) throw new Error('BAD_MERGE_GROUP');
  const gearGroups = new Map();
  for (const p of group) for (const x of p.equipment) { const key = mergeKey(x, catalog); if (key) gearGroups.set(key, [...(gearGroups.get(key) || []), { item: x, ownerUid: p.uid }]); }
  const selectedGear = new Set();
  for (const [key, items] of gearGroups) if (items.length > 1) {
    const keep = uniqueSelections[`equipment:${key}`] || uniqueSelections[key];
    if (typeof keep !== 'string' || !items.some((x) => x.item.uid === keep)) throw new Error('NEED_UNIQUE_SELECTION');
    selectedGear.add(keep);
  }
  const allGear = group.flatMap((p) => p.equipment.map((x) => ({ ...clone(x), ownerUid: p.uid })));
  const worn = []; const destroyedGear = [];
  for (const x of allGear) {
    const key = mergeKey(x, catalog);
    if (key && gearGroups.get(key).length > 1 && !selectedGear.has(x.uid)) {
      destroyedGear.push(x);
    } else if (!(isPermit(x, catalog) && worn.some((y) => y.id === x.id))) worn.push(x);
  }
  if (worn.reduce((n, x) => n + Number(x.quantity || 1), 0) > EQUIPMENT_CAPACITY) throw new Error('CAPACITY');
  const fielded = group.filter((p) => p.row !== null && p.col !== null).sort((a, b) => a.uid.localeCompare(b.uid));
  const survivor = fielded[0] || [...group].sort((a, b) => a.uid.localeCompare(b.uid))[0];
  const attachments = group.flatMap((p) => (p.attachments || []).map((attachment) => ({ ...clone(attachment), ownerUid: p.uid })));
  const attachGroups = new Map();
  for (const a of attachments) if (catalog.attachments?.[a.id]?.unique) attachGroups.set(a.id, [...(attachGroups.get(a.id) || []), a]);
  const keptAttachments = []; const destroyedAttachments = [];
  for (const [id, items] of attachGroups) {
    if (items.length === 1) { const { ownerUid, ...attachment } = items[0]; keptAttachments.push(attachment); }
    else {
      const keep = uniqueSelections[`attachment:${id}`];
      if (typeof keep !== 'string' || !items.some((x) => x.ownerUid === keep)) throw new Error('NEED_UNIQUE_SELECTION');
      const selected = items.find((x) => x.ownerUid === keep); const { ownerUid, ...attachment } = selected; keptAttachments.push(attachment);
      destroyedAttachments.push(...items.filter((x) => x !== selected).map((x) => ({ id, ownerUid: x.ownerUid, state: clone(x.state || {}) })));
    }
  }
  const uniqueAttachmentIds = new Set([...attachGroups.keys()]);
  keptAttachments.push(...attachments.filter((a) => !uniqueAttachmentIds.has(a.id)).map(({ ownerUid, ...attachment }) => attachment));
  const penaltyApplied = group.some((p) => p.bodyPenaltyApplied);
  const copies = group.reduce((n, p) => n + Number(p.poolCopies || 1), 0);
  const mergeMarkers = (target, source) => {
    for (const [key, value] of Object.entries(source || {})) {
      if (key === 'preferences') continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) { target[key] ||= {}; mergeMarkers(target[key], value); }
      else if (typeof value === 'number') target[key] = Math.max(Number(target[key]) || 0, value);
      else if (typeof value === 'boolean') target[key] = Boolean(target[key] || value);
      else if (!Object.hasOwn(target, key)) target[key] = clone(value);
    }
  };
  for (const p of group) if (p !== survivor) mergeMarkers(survivor.nativeState ||= {}, p.nativeState);
  const combinedGrowth = 1 + group.reduce((sum, p) => sum + Math.max(0, Number(p.growthLevel || 1) - 1), 0);
  survivor.chessId = op.eliteChessId; survivor.elite = true; addTotal(state, 'elites'); survivor.equipment = worn; survivor.attachments = keptAttachments;
  if (state.growthMode === 'levels') {
    survivor.growthMode = 'levels'; survivor.growthLevel = combinedGrowth;
    survivor.growthLevel = operatorGrowthInfo(survivor, catalog).level;
  }
  survivor.bodyPenaltyApplied = penaltyApplied;
  survivor.poolCopies = copies;
  for (const p of group) if (p !== survivor) state.pieces.splice(state.pieces.indexOf(p), 1);
  return { piece: survivor, consumed: group.map((p) => p.uid), required, destroyedGear: destroyedGear.map((x) => ({ id: x.id, uid: x.uid, ownerUid: x.ownerUid, state: clone(x.state || {}) })), destroyedAttachments };
}
function mergeConflictPreview(group, catalog) {
  const gear = new Map(); const attachments = new Map();
  for (const p of group) {
    for (const item of p.equipment || []) { const key = mergeKey(item, catalog); if (key) gear.set(key, [...(gear.get(key) || []), { uid: item.uid, ownerUid: p.uid, id: item.id, state: clone(item.state || {}) }]); }
    for (const item of p.attachments || []) if (catalog.attachments?.[item.id]?.unique) attachments.set(item.id, [...(attachments.get(item.id) || []), { id: item.id, ownerUid: p.uid, state: clone(item.state || {}) }]);
  }
  return { equipment: [...gear].filter(([, xs]) => xs.length > 1).map(([key, items]) => ({ key, choices: items })), attachments: [...attachments].filter(([, xs]) => xs.length > 1).map(([id, items]) => ({ id, choices: items })) };
}
function maybeMergeOperator(state, catalog, chessId) {
  const op = opFor(catalog, chessId); const required = mergeCopiesRequired(op);
  if (state.offers.some((x) => x.type === 'operatorMerge' && x.chessId === chessId)) return [];
  const merged = [];
  while (op?.eliteChessId) {
    const group = state.pieces.filter((p) => p.chessId === chessId && !p.elite).slice(0, required);
    if (group.length < required) break;
    try { merged.push(mergeOperator(state, catalog, group.map((p) => p.uid))); }
    catch (error) {
      if (error.message !== 'NEED_UNIQUE_SELECTION' && error.message !== 'CAPACITY') throw error;
      if (!state.offers.some((x) => x.type === 'operatorMerge' && x.chessId === chessId)) state.offers.push({ id: `o${state.nextUid++}`, type: 'operatorMerge', chessId, pieceUids: group.map((p) => p.uid), required, conflicts: mergeConflictPreview(group, catalog) });
      break;
    }
  }
  return merged;
}
function goodsInShop(state, kind) { return state.shop.slots.filter((x) => x.kind === kind && !x.sold); }
function safeCopyPool(state, id, n) { const p = poolFor(state, id); if (p) p.left = Math.min(p.cap, p.left + n); }
function requireFinitePositive(x) { if (!Number.isFinite(x) || x < 0) throw new Error('BAD_NUMBER'); }
function handleSaleEquipment(state, catalog) {
  for (const piece of state.pieces) {
    const factions = new Set(tavernFactions(piece, catalog)); if (!factions.size) continue;
    for (const item of piece.equipment) {
      const def = equipmentRecord(catalog, item.id);
      if (def?.mechanism !== 'saleThresholdRecruit') continue;
      const used = Number(item.state?.saleTriggersThisPrep || 0);
      if (used >= Number(def.params?.maxPerPrep || 1)) continue;
      const threshold = Number(def.params.normalSaleThreshold);
      if (state.counters.sold < threshold) continue;
      const tier = state.shop.level; const candidates = Object.values(catalog.operators).filter((op) => !op.elite && op.recruitable !== false && op.tier <= tier && tavernFactions({ chessId: op.chessId }, catalog).some((f) => factions.has(f)) && state.pool?.[op.chessId]?.left > 0).map((op) => op.chessId).sort();
      if (!candidates.length) continue;
      item.state = { ...(item.state || {}), saleTriggersThisPrep: used + 1 };
      state.offers.push({ id: `o${state.nextUid++}`, type: 'recruit', choices: candidates.slice(0, Number(def.params.choices || 3)), source: item.id, sourceUid: piece.uid });
    }
  }
}
function roundAward(state) {
  if (state.roundLimit === 9) return state.round === 4 ? 'start' : state.round === 8 ? 'cashout' : null;
  return [4, 8, 12].includes(state.round) ? (state.round === 4 ? 'start' : state.round === 8 ? 'build' : 'cashout') : null;
}

export function createSession(options = {}) {
  const data = sessionData(options); const catalog = sessionCatalog(data, options);
  const difficulty = String(options.difficulty || 'NORMAL').toUpperCase();
  if (!['FUNNY', 'NORMAL', 'HARD', 'ABYSS'].includes(difficulty)) throw new Error('BAD_DIFFICULTY');
  const roundLimit = Number(options.roundLimit || (difficulty === 'FUNNY' ? 9 : 14));
  if (![9, 14, 15].includes(roundLimit)) throw new Error('BAD_ROUND_LIMIT');
  const growthMode = options.growthMode ?? catalog.config?.defaultGrowthMode ?? 'badges';
  if (!GROWTH_MODES.includes(growthMode)) throw new Error('BAD_GROWTH_MODE');
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed) >>> 0 : 1;
  const rng = createRng(seed); const gd = new GameData(data, modeIdFor('solo', difficulty.toLowerCase()));
  const income = baseIncomeFor(1, gd, catalog);
  // New sessions include all real factions. Existing saves may still carry openFactions for legacy decoding.
  const openFactions = null;
  const state = { schemaVersion: 1, modeId: 'independent', seed, ...(openFactions ? { openFactions } : {}), rngState: rng.state(), nextUid: 1, revision: 0, round: 1, roundLimit,
    difficulty, growthMode, phase: 'prep', funds: income, pendingFunds: 0, lp: gd.startLp(null), deployCap: 8,
    shop: { level: 1, upgradePrice: gd.upgradeBase(1) ?? 0, slots: [], frozen: false, freeRefreshes: 0 }, pieces: [], inventory: [], offers: [],
    incomeThisRound: income, pendingRoundStart: false, playerEffects: [], counters: { gained: 0, bought: 0, refreshes: 0, paidRefreshes: 0, spent: 0, sold: 0, factionBought:{} }, pool: operatorPool({ pool: {} }, catalog, gd, openFactions), history: [], battleSummary: null, outcome: null };
  state.shop.slots = slotsFor(state, gd, catalog, rng); state.rngState = rng.state();
  const errs = validateSession(state);
  if (errs.length) throw new Error(`INVALID_INITIAL_STATE:${errs.join(',')}`);
  return state;
}

export function validateSession(state) {
  const e = [];
  if (state?.growthMode !== undefined && !GROWTH_MODES.includes(state.growthMode)) e.push('BAD_GROWTH_MODE');
  if (!isRecord(state) || state.schemaVersion !== 1 || state.modeId !== 'independent') return ['BAD_SCHEMA'];
  for (const k of ['seed', 'rngState', 'nextUid', 'revision', 'round', 'roundLimit', 'funds', 'pendingFunds', 'lp', 'deployCap']) if (!Number.isFinite(state[k])) e.push(`BAD_${k.toUpperCase()}`);
  if (!['prep', 'prize', 'finished'].includes(state.phase)) e.push('BAD_PHASE');
  if (![9, 14, 15].includes(state.roundLimit) || state.round < 1 || state.round > state.roundLimit + 1) e.push('BAD_ROUND');
  for (const key of ['pieces', 'inventory', 'offers', 'playerEffects', 'history']) if (!Array.isArray(state[key])) e.push(`BAD_${key.toUpperCase()}`);
  if (!isRecord(state.shop) || !Array.isArray(state.shop.slots) || !Number.isInteger(state.shop.level)) e.push('BAD_SHOP');
  if (state.openFactions !== undefined) {
    const known = Object.values(TAVERN_FACTIONS);
    if (!Array.isArray(state.openFactions) || new Set(state.openFactions).size !== state.openFactions.length || state.openFactions.some((f) => !known.includes(f))) e.push('BAD_OPEN_FACTIONS');
  }
  if (!isRecord(state.pool)) e.push('BAD_POOL');
  else for (const [id, p] of Object.entries(state.pool)) if (!safeId(id) || !Number.isInteger(p.left) || !Number.isInteger(p.cap) || p.left < 0 || p.left > p.cap) e.push('BAD_POOL_ENTRY');
  const uids = new Set();
  for (const item of [...(state.inventory || []), ...(state.pieces || []).flatMap((p) => p.equipment || [])]) {
    if (!safeId(item.uid) || uids.has(item.uid)) e.push('BAD_UID'); else uids.add(item.uid);
  }
  for (const p of state.pieces || []) {
    if (!safeId(p.uid) || !safeId(p.chessId) || !Array.isArray(p.equipment) || !Array.isArray(p.attachments) || !isRecord(p.nativeState)) e.push('BAD_PIECE');
    if (state.growthMode === 'levels' && (p.growthMode !== 'levels' || !Number.isInteger(p.growthLevel) || p.growthLevel < 1)) e.push('BAD_GROWTH_LEVEL');
    if ((p.row === null) !== (p.col === null) || (p.row !== null && (!inField(p.row, p.col) || !inField(p.row, p.col)))) e.push('BAD_POSITION');
    for (const attachment of p.attachments || []) if (!safeId(attachment.id) || (attachment.state !== undefined && !isRecord(attachment.state))) e.push('BAD_ATTACHMENT');
  }
  for (const item of state.inventory || []) if (!safeId(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1) e.push('BAD_ITEM');
  for (const p of state.pieces || []) if (p.equipment?.reduce((n, x) => n + Number(x.quantity || 0), 0) > EQUIPMENT_CAPACITY) e.push('PIECE_CAPACITY');
  return e;
}

/**
 * The match so far in numbers, for the end screen (the page never receives the history): battles fought, rounds passed
 * (a lost last battle does not count), the operators' damage, the enemies felled and the life lost.
 */
export function matchStats(state) {
  const battles = (state.history || []).filter((h) => h.type === 'battle');
  const mine = (h) => h.result?.perPlayer?.independent || Object.values(h.result?.perPlayer || {})[0] || {};
  const sum = (f) => battles.reduce((n, h) => n + (Number(f(h)) || 0), 0);
  return {
    battles: battles.length,
    passed: Math.max(0, battles.length - (state.phase === 'finished' && state.outcome === 'loss' ? 1 : 0)),
    damage: sum((h) => (mine(h).unitStats || []).filter((u) => u.kind === 'op').reduce((n, u) => n + (Number(u.dmg) || 0), 0)),
    kills: sum((h) => h.result?.killed),
    lpLost: sum((h) => h.lpLost),
  };
}

export function viewSession(state, options = {}) {
  const data = sessionData(options); const catalog = sessionCatalog(data, options);
  if (state.pieces.some((p) => lacksPermit(p, catalog))) { state = clone(state); ensurePermits(state, catalog); }
  // gear has one form only: an old save's elite gear shows as the normal item, same quantity (applyAction saves it so)
  if ([...state.inventory, ...state.pieces.flatMap((p) => p.equipment || [])].some((x) => x?.elite)) { state = clone(state); normalizeGearForms(state, catalog); }
  let field = null;
  try { field = getIndependentField(state, { data, catalog }); } catch { /* keep the raw state visible when content lookup is unavailable */ }
  const deployCells = field && state.phase === 'prep' ? [...(field.deployMap || new Map()).keys()] : [];
  // what each deployed operator starts the next battle with (the detail card's 开战时 stats, the original's m.unitStats)
  const startStats = state.phase === 'prep' ? previewUnitStats(state, { data, catalog }) : {};
  const pieces = state.pieces.map((p) => {
    const op = opFor(catalog, p.chessId) || {};
    const raw = p.elite ? (op.source?.eliteChess || op.source?.normalChess) : op.source?.normalChess;
    // the tiles this piece may stand on (the ready check's rule), so the page never re-implements placement
    let legalTiles = [];
    try { const cls = positionClass(raw, p.moduleId); legalTiles = deployCells.filter((cell) => { const [r, c] = cell.split(',').map(Number); return canPlace(field.deployMap, cls, r, c); }); } catch { legalTiles = []; }
    const modules = (raw?.modules || []).map((x) => ({ ...clone(x), id: x.uniEquipId || x.id })).filter((x) => x.id);
    const steamOptions = ['chess_item_2_03_e_a', 'chess_item_3_09_e_a', 'chess_item_3_10_e_a', 'chess_item_4_09_e_a'];
    return { ...clone(p), name: op.name, skill: op.skill, skills: clone(raw?.skills || {}), modules: clone(modules), nativeTrait: op.nativeTrait?.[p.elite ? 'eliteText' : 'normalText'], preferences: clone(p.nativeState?.preferences || {}), equipmentLevel: totalEquipmentLevel(p, catalog), equipmentDetails: p.equipment.map((x) => ({ ...clone(x), record: clone(equipmentRecord(catalog, x.id)), steamOptions: equipmentRecord(catalog, x.id)?.mechanism === 'combatEquipment' && equipmentRecord(catalog, x.id)?.params?.effects?.some((e) => e.behavior === 'steamGearUpgrade') ? steamOptions : undefined })), attachmentDetails: p.attachments.map((x) => ({ ...clone(x), record: clone(catalog.attachments?.[x.id]) })), legalActions: ['move', 'bench', 'loadout', 'configure', 'configure-equipment', 'equip', 'sell', 'inherit-preview'], legalTiles,
      // the body's own numbers: after the 接装损耗 when it applies, and before it (the detail card shows both)
      bodyStats: nativeBodyStats(p, catalog), rawBodyStats: p.bodyPenaltyApplied ? nativeBodyStats({ ...p, bodyPenaltyApplied: false }, catalog) : undefined,
      factions: tavernFactions(p, catalog), startStats: startStats[p.uid],
      ...(state.growthMode === 'levels' ? { growthMode: 'levels', growthLevel: operatorGrowthInfo(p, catalog).level,
        growthStats: operatorGrowthInfo(p, catalog).stats, growthMaximum: operatorGrowthInfo(p, catalog).maximum } : {}),
      // whom it may hand its gear to (give) and take gear from (take) under the 交接凭证 worn on either side
      handover: state.phase === 'prep' ? handoverPartners(state, p, catalog) : undefined };
  });
    return { ...clone(state), pieces, catalog: { badges: catalog.badges, equipment: catalog.equipment, attachments: catalog.attachments }, legalActions: state.phase === 'prep' ? ['buy', 'refresh', 'freeze', 'upgrade', 'sell', 'move', 'bench', 'loadout', 'configure', 'configure-equipment', 'equip', 'use-item', 'inherit-preview', 'inherit', 'ready'] : state.phase === 'prize' ? ['choose'] : [],
    board: field ? { stageId: field.stageId, field: field.field, map: [...(field.deployMap || new Map()).entries()], bossId: field.bossId, factions: field.factions,
      bossRound: state.roundLimit === 9 ? 9 : 14 } : null, battleSummary: state.battleSummary, matchStats: matchStats(state),
    forecast: state.phase === 'prep' ? forecastPrepEnd(state, data, catalog) : null,
    // the coming round's enemies for the renderer's preview pen (the original m.private.nextEnemies, waves.js previewOf)
    nextEnemies: field && state.phase !== 'finished' ? previewOf(field.wave?.spawns || []) : [] };
}

/** The pieces a piece may hand over to and take over from: only the 交接凭证 decide (inheritance.js previewInheritance). */
function handoverPartners(state, piece, catalog) {
  const others = state.pieces.filter((x) => x !== piece);
  return { give: others.filter((x) => inheritanceQualification(piece, x, catalog).allowed).map((x) => x.uid),
    take: others.filter((x) => inheritanceQualification(x, piece, catalog).allowed).map((x) => x.uid) };
}

/**
 * What the coming 休整期结束 hooks will forge if the player readies now: the hooks run on a copy with a copy of
 * the RNG, so the session, its RNG and its revision stay as they are. Returns the ledger rows the copy gained
 * (equipment.js recordProduction) and the deferred funds it added, or null when the dry run fails.
 */
export function forecastPrepEnd(state, data, catalog) {
  try {
    const work = clone(state); const rng = createRng(work.rngState);
    const services = servicesFor(work, data, catalog, rng);
    const funds = Number(work.pendingFunds || 0); const revision = Number(work.revision || 0) + 1;
    invokeHook(work, 'prepEnd', { round: work.round }, services);
    // rows of earlier actions carry an older revision; the ledger may also drop old rounds while it appends
    return { production: (work.production || []).filter((x) => x.revision === revision), pendingFunds: Number(work.pendingFunds || 0) - funds };
  } catch { return null; }
}

export function applyAction(state, action, options = {}) {
  if (!isRecord(action) || !safeId(action.type)) return { ok: false, error: { code: 'BAD_ACTION', message: 'Action must have a safe type.' }, state };
  const inputErrors = validateSession(state);
  if (inputErrors.length) return { ok: false, error: { code: 'INVALID_STATE', message: inputErrors.join(',') }, state };
  let work;
  try { work = clone(state); } catch { return { ok: false, error: { code: 'INVALID_STATE', message: 'State is not serializable.' }, state }; }
  const data = sessionData(options); const catalog = sessionCatalog(data, options); const gd = gdFor(work, data);
  sanitizeRecruitPool(work, catalog);
  // an old save's elite gear becomes the normal item, same quantity (owner 2026-10-07 「装备不再有精锐形态」)
  normalizeGearForms(work, catalog);
  ensurePermits(work, catalog);
  const rng = createRng(work.rngState); const events = [];
  const elitesBefore = Number(work.totals?.elites || 0); // every elite this action forms earns a 晋升奖励 (below)
  const services = servicesFor(work, data, catalog, rng);
  const act = action.type; let readOnly = false;
  // a ready's battle replay rides beside the result, never inside the saved state (http.js keeps it per round)
  let replay = null;
  try {
    if (act === 'inspect') {
      const piece = work.pieces.find((x) => x.uid === action.uid);
      if (!piece) throw new Error('BAD_TARGET');
      readOnly = true; events.push({ type: 'inspect', piece: { ...clone(piece), operator: clone(opFor(catalog, piece.chessId)), equipment: piece.equipment.map((x) => ({ ...clone(x), record: clone(equipmentRecord(catalog, x.id)) })), attachments: piece.attachments.map((x) => ({ ...clone(x), record: clone(catalog.attachments?.[x.id]) })) } });
    } else if (act === 'choose') {
      if (work.phase !== 'prize' && !work.offers.length) throw new Error('NO_OFFER');
      const offer = work.offers.find((x) => x.id === action.offerId);
      if (!offer) throw new Error('BAD_OFFER');
      if (offer.type === 'prize') events.push(choosePrize(work, catalog, action.offerId, action.index, action));
      else if (offer.type === 'operatorMerge') {
        const sourceChessId = offer.chessId;
        const merged = mergeOperator(work, catalog, offer.pieceUids, action.uniqueSelections || {});
        work.offers.splice(work.offers.indexOf(offer), 1); events.push({ type: 'operator-merge', uid: merged.piece.uid, chessId: merged.piece.chessId, destroyedEquipment: merged.destroyedGear, destroyedAttachments: merged.destroyedAttachments });
        for (const further of maybeMergeOperator(work, catalog, sourceChessId)) events.push({ type: 'operator-merge', uid: further.piece.uid, chessId: further.piece.chessId });
      }
      else {
        if (!Number.isInteger(action.index) || !safeId(offer.choices[action.index])) throw new Error('BAD_CHOICE');
        if (offer.type === 'recruit') {
          const op = opFor(catalog, offer.choices[action.index]); if (!op) throw new Error('BAD_CHOICE');
          const room = roomFor(work, catalog, op.chessId, { allowTemp: true });
          if (!room) { work.offers.splice(work.offers.indexOf(offer), 1); events.push({ type: 'no-room', chessId: op.chessId }); }
          else {
          const piece = gainChess(work, catalog, op.chessId, {}); if (room === 'temp') piece.temp = true;
          if(offer.deferNativeGain) piece.darkmoonPendingPlay=true; else invokeHook(work, 'gain', { piece, source: offer.source || 'choice', targetUid:action.targetUid, shopSlot:action.shopSlot, shopSlots:action.shopSlots }, services);
          for (const carried of offer.carriedEquipment || []) { const item = makeItem(work, carried.id, carried.quantity || 1, { sourceId: carried.sourceId }); work.inventory.push(item); equipItem(work, catalog, item.uid, piece.uid, carried.quantity || 1); }
          if(!offer.deferNativeGain) handleGainEquipment(work, catalog, piece);
          work.offers.splice(work.offers.indexOf(offer), 1);
          for (const merged of maybeMergeOperator(work, catalog, op.chessId)) events.push({ type: 'operator-merge', uid: merged.piece.uid, chessId: merged.piece.chessId });
          }
        } else if (offer.type === 'attachment') {
          const piece = work.pieces.find((x) => x.uid === (action.targetUid || offer.targetUid)); if (!piece) throw new Error('BAD_TARGET');
          const attachmentId = offer.choices[action.index]; const attachment = catalog.attachments?.[attachmentId];
          if (!attachment || !attachmentAccepted(attachment, piece, catalog) || piece.attachments.some((x) => x.id === attachmentId)) throw new Error('UNIQUE_OR_INELIGIBLE');
          piece.attachments.push({ id: attachmentId, state: {} }); work.offers.splice(work.offers.indexOf(offer), 1);
        }
      }
      if (!work.offers.some((x) => x.type === 'prize')) work.phase = 'prep';
      if (offer.type === 'prize' && work.pendingRoundStart && !work.offers.some((x) => x.type === 'prize')) {
        work.pendingRoundStart = false; invokeHook(work, 'roundStart', { round: work.round }, services); events.push({ type: 'round-start', round: work.round });
      }
    } else if (act === 'buy') {
      ensurePrep(work); const slot = work.shop.slots[action.slot];
      if (!Number.isInteger(action.slot) || !slot || slot.sold || !slot.id) throw new Error('BAD_SLOT');
      if (work.funds < slot.price) throw new Error('NO_FUNDS');
      if (slot.kind === 'chess') {
        const pool = poolFor(work, slot.id); if (!pool?.left) throw new Error('SOLD_OUT');
        if (!roomFor(work, catalog, slot.id, { allowTemp: false })) throw new Error('BENCH_FULL');
        work.funds -= slot.price; work.counters.spent += slot.price; work.counters.bought += 1; addTotal(work, 'bought'); addTotal(work, 'spent', slot.price); invokeHook(work, 'spend', { amount: slot.price, source: 'buy' }, services);
        for(const faction of nativeFactions({chessId:slot.id},catalog)) { work.counters.factionBought ||= {}; work.counters.factionBought[faction]=(work.counters.factionBought[faction]||0)+1; }
        pool.left -= 1; const piece = gainChess(work, catalog, slot.id, { poolCopies: 1, poolTaken: true });
        applyDarkmoonShopGrowth(work,slot,piece,services);
        invokeHook(work, 'gain', { piece, source: 'buy', paid: true, targetUid:action.targetUid, shopSlots: action.shopSlots, shopSlot: action.shopSlot, buySlot: action.slot }, services); events.push({ type: 'buy', uid: piece.uid, chessId: piece.chessId });
        for (const carried of slot.equipment || []) {
          const item = makeItem(work, carried.id, carried.quantity || 1, { sourceId: carried.sourceId }); work.inventory.push(item);
          equipItem(work, catalog, item.uid, piece.uid, carried.quantity || 1);
        }
        handleGainEquipment(work, catalog, piece);
        // 购买干员后 (native buyGear): operators on the field react to the one just bought, before it merges
        invokeHook(work, 'bought', { piece, source: 'buy', targetUid:action.targetUid }, services);
        for (const merged of maybeMergeOperator(work, catalog, piece.chessId)) events.push({ type: 'operator-merge', uid: merged.piece.uid, chessId: merged.piece.chessId });
      } else {
        // an equipment place left in a shop saved before the shop stopped selling gear (gone at the next refresh)
        work.funds -= slot.price; work.counters.spent += slot.price; invokeHook(work, 'spend', { amount: slot.price, source: 'buy-equipment' }, services);
        grantEquipment(work, catalog, slot.id, 1, { origin: 'shop', phase: 'shop' }); events.push({ type: 'buy-equipment', id: slot.id });
      }
      slot.sold = true;
    } else if (act === 'refresh') {
      ensurePrep(work);
      const free = work.shop.freeRefreshes > 0;
      if (free) work.shop.freeRefreshes--;
      else { if (work.funds < 1) throw new Error('NO_FUNDS'); work.funds--; work.counters.spent++; work.counters.paidRefreshes++; invokeHook(work, 'spend', { amount: 1, source: 'refresh' }, services); }
      work.counters.refreshes = (work.counters.refreshes || 0) + 1; addTotal(work, 'refreshes'); if (!free) addTotal(work, 'spent');
      work.shop.slots = advanceShop(work, gd, catalog, rng); invokeHook(work, 'refresh', { free }, services);
      events.push({ type: 'refresh' });
    } else if (act === 'freeze') {
      ensurePrep(work); work.shop.frozen = !work.shop.frozen; events.push({ type: 'freeze', value: work.shop.frozen });
    } else if (act === 'upgrade') {
      ensurePrep(work); if (work.shop.level >= gd.maxShopLevel) throw new Error('MAX_LEVEL');
      const price = work.shop.upgradePrice; if (work.funds < price) throw new Error('NO_FUNDS');
      work.funds -= price; work.counters.spent += price; addTotal(work, 'spent', price); addTotal(work, 'upgrades'); invokeHook(work, 'spend', { amount: price, source: 'upgrade' }, services); work.shop.level++;
      work.shop.upgradePrice = gd.upgradeBase(work.shop.level) ?? 0; events.push({ type: 'upgrade', level: work.shop.level });
    } else if (act === 'sell') {
      ensurePrep(work); const p = work.pieces.find((x) => x.uid === action.uid); if (!p) throw new Error('BAD_TARGET');
      invokeHook(work, 'selling', { piece: p }, services); addTotal(work, 'sold');
      discardPieceAssets(work, p); safeCopyPool(work, p.chessId, p.poolCopies || 1); work.pieces.splice(work.pieces.indexOf(p), 1);
      work.funds++; work.counters.sold++; handleSaleEquipment(work, catalog); invokeHook(work, 'sold', { piece: p }, services); events.push({ type: 'sell', uid: p.uid, funds: 1 });
    } else if (act === 'move') {
      ensurePrep(work); const p = work.pieces.find((x) => x.uid === action.uid); if (!p) throw new Error('BAD_TARGET');
      if (!Number.isInteger(action.row) || !Number.isInteger(action.col) || !inField(action.row, action.col)) throw new Error('BAD_POSITION');
      const occupied = work.pieces.some((x) => x !== p && x.row === action.row && x.col === action.col); if (occupied) throw new Error('OCCUPIED');
      const field = getIndependentField(work, { data, catalog }); const op = opFor(catalog, p.chessId); const raw = p.elite ? (op?.source?.eliteChess || op?.source?.normalChess) : op?.source?.normalChess;
      const cls = positionClass(raw, p.moduleId);
      if (!canPlace(field.deployMap, cls, action.row, action.col)) throw new Error('ILLEGAL_TILE');
      if (action.dir && !['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(action.dir)) throw new Error('BAD_DIRECTION');
      p.row = action.row; p.col = action.col; p.dir = action.dir || p.dir || 'RIGHT'; delete p.temp; events.push({ type: 'move', uid: p.uid, row: p.row, col: p.col });
      if(p.darkmoonPendingPlay) {
        delete p.darkmoonPendingPlay;
        invokeHook(work,'gain',{piece:p,source:'darkmoon-hand-play',paid:false,targetUid:action.targetUid,shopSlot:action.shopSlot,shopSlots:action.shopSlots},services);
        handleGainEquipment(work,catalog,p);
      }
    } else if (act === 'bench') {
      ensurePrep(work); const p = work.pieces.find((x) => x.uid === action.uid); if (!p) throw new Error('BAD_TARGET');
      if (onBoard(p) || p.temp) { if (benchCount(work) >= BENCH_SIZE) throw new Error('BENCH_FULL'); }
      p.row = null; p.col = null; delete p.temp; events.push({ type: 'bench', uid: p.uid });
    } else if (act === 'loadout') {
      ensurePrep(work); const p = work.pieces.find((x) => x.uid === action.uid); const op = p && opFor(catalog, p.chessId); if (!p || !op) throw new Error('BAD_TARGET');
      const raw = p.elite ? (op.source?.eliteChess || op.source?.normalChess) : op.source?.normalChess;
      if (!Number.isInteger(action.skillIndex) || action.skillIndex < 0 || action.skillIndex >= (raw?.skills || []).length) throw new Error('BAD_SKILL');
      if(raw.nativeImport&&!raw.nativeImport.supportedSkillIds?.includes(raw.skills[action.skillIndex]?.skillId))throw new Error('UNSUPPORTED_NATIVE_SKILL');
      const moduleId = action.moduleId ?? p.moduleId; const moduleIds = (raw?.modules || []).map((x) => x.uniEquipId || x.id).filter(Boolean);
      if (moduleId !== 'none' && !moduleIds.includes(moduleId)) throw new Error('BAD_MODULE');
      p.skillIndex = action.skillIndex; p.moduleId = moduleId; events.push({ type: 'loadout', uid: p.uid });
    } else if (act === 'configure') {
      ensurePrep(work); const piece = work.pieces.find((x) => x.uid === action.uid); if (!piece) throw new Error('BAD_TARGET');
      const preference = { ...(piece.nativeState.preferences || {}) };
      if (action.productionBadge !== undefined) {
        if (!['precision', 'agility', 'damage', 'recovery', 'vitality', 'defense', 'assault'].includes(action.productionBadge)) throw new Error('BAD_PRODUCTION_BADGE');
        preference.productionBadge = action.productionBadge;
      }
      if (action.factionPriority !== undefined) {
        const factions = Object.values(TAVERN_FACTIONS);
        if (!Array.isArray(action.factionPriority) || action.factionPriority.length !== factions.length || new Set(action.factionPriority).size !== factions.length || factions.some((x) => !action.factionPriority.includes(x))) throw new Error('BAD_FACTION_PRIORITY');
        preference.factionPriority = [...action.factionPriority];
      }
      piece.nativeState.preferences = preference; events.push({ type: 'configure', uid: piece.uid, preferences: clone(preference) });
    } else if (act === 'equip') {
      ensurePrep(work); const item = equipItem(work, catalog, action.itemUid, action.targetUid, action.quantity ?? 1, { faction: action.faction }); events.push({ type: 'equip', itemId: item.id, targetUid: action.targetUid });
    } else if (act === 'configure-equipment') {
      ensurePrep(work);
      const piece = work.pieces.find((x) => x.uid === action.targetUid);
      const item = piece?.equipment.find((x) => x.uid === action.itemUid);
      const def = item && equipmentRecord(catalog, item.id);
      const steam = def?.params?.effects?.find((x) => x.behavior === 'steamGearUpgrade');
      if (!piece || !item || !steam) throw new Error('BAD_TARGET');
      const allowed = steam.params.sourceIds;
      const selected = action.hammerSourceIds;
      const limits = steam.params.chooseVariantsOnEquip;
      const limit = Number(limits && typeof limits === 'object' ? limits.normal : (limits ?? steam.params.choose ?? 1));
      if (!Number.isInteger(limit) || limit < 1) throw new Error('BAD_EQUIPMENT_RULE');
      if (!Array.isArray(selected) || selected.length > limit || new Set(selected).size !== selected.length || selected.some((id) => !allowed.includes(id) || !piece.equipment.some((x) => (x.sourceId || equipmentRecord(catalog, x.id)?.sourceId) === id))) throw new Error('BAD_HAMMER_SELECTION');
      item.state = { ...(item.state || {}), hammerSourceIds: [...selected] };
      events.push({ type: 'configure-equipment', targetUid: piece.uid, itemUid: item.uid, hammerSourceIds: [...selected] });
    } else if (act === 'use-item') {
      ensurePrep(work); events.push(useInventoryItem(work, catalog, action.itemUid, action, data));
    } else if (act === 'inherit-preview') {
      readOnly = true; events.push({ type: 'inherit-preview', preview: previewInheritance(work, catalog, action.donorUid, action.receiverUid, data) });
    } else if (act === 'inherit') {
      ensurePrep(work); const result = applyInheritance(work, catalog, action.donorUid, action.receiverUid, action.uniqueSelections || {}, data); work.funds += 1; work.counters.sold++; handleSaleEquipment(work, catalog); events.push({ type: 'inherit', receiverUid: result.receiver.uid, preview: result.preview });
    } else if (act === 'ready') {
      ensurePrep(work);
      if (tempCount(work) > 0) throw new Error('TEMP_NOT_EMPTY'); // 「直到溢出情况排除才可开始进行作战」
      const deployed = work.pieces.filter((x) => x.row !== null && x.col !== null);
      if (deployed.length < 1) throw new Error('NO_DEPLOYED_PIECES');
      if (deployed.length > work.deployCap) throw new Error('DEPLOY_CAP');
      const field = getIndependentField(work, { data, catalog }); const cells = new Set();
      for (const p of deployed) {
        const op = opFor(catalog, p.chessId); const raw = p.elite ? (op?.source?.eliteChess || op?.source?.normalChess) : op?.source?.normalChess;
        const cell = `${p.row},${p.col}`;
        if (cells.has(cell) || !canPlace(field.deployMap, positionClass(raw, p.moduleId), p.row, p.col)) throw new Error('ILLEGAL_TILE');
        cells.add(cell);
      }
      invokeHook(work, 'prepEnd', { round: work.round }, services);
      { const outer = services.phase; services.phase = 'prepEnd'; try { runEquipmentPrepEnd(work, services); } finally { services.phase = outer; } }
      const battle = (options.battleRunner || runIndependentBattle)(work, { data, catalog });
      if (!battle || !battle.result) throw new Error('BATTLE_FAILED');
      replay = battle.replay || null;
      const gd = gdFor(work, data); const playerResult = battle.result.perPlayer?.independent || Object.values(battle.result.perPlayer || {})[0] || {};
      const leaked = Array.isArray(playerResult.leaked) ? playerResult.leaked.filter((x) => x && x.counted !== false).reduce((n, x) => n + Math.max(0, Number(x.lpr) || 1), 0) : 0;
      const lpLost = Math.min(gd.lpCapPerRound, Math.max(0, leaked));
      work.battleSummary = { result: battle.result, samples: battle.samples || [], diagnostics: battle.diagnostics || {}, pieceStates: battle.pieceStates || {} };
      work.lp = Math.max(0, work.lp - lpLost);
      for (const [uid, ps] of Object.entries(battle.pieceStates || {})) { const piece = work.pieces.find((x) => x.uid === uid); if (piece) { piece.nativeState = clone(ps.nativeState || {}); piece.equipment = clone(ps.equipment || []); piece.attachments = clone(ps.attachments || []); } }
      for (const reward of battle.rewards || []) grantEquipment(work, catalog, reward.id, reward.quantity || 1, { origin: reward.origin, phase: 'battle', sourceUid: reward.sourceUid, copied: reward.copied });
      applyDarkmoonBattleResults(work,catalog,battle.darkmoonResults,services,events);
      const fieldKind = getIndependentField(work, { data, catalog }).field;
      const bossRound = fieldKind === 'bossL';
      const bossCleared = bossRound && Number(battle.result.bossHpLeft) <= 0 && !battle.diagnostics?.capped;
      const lastRound = work.round >= work.roundLimit;
      const failedBoss = bossRound && !bossCleared;
      const terminalRound = lastRound || failedBoss || work.lp <= 0;
      work.history.push({ round: work.round, type: 'battle', result: battle.result, lpLost, bossCleared });
      addTotal(work, 'battles'); addTotal(work, 'kills', Number(battle.result.killed || 0)); addTotal(work, 'lpLostTotal', lpLost);
      events.push({ type: 'battle', round: work.round, lpLost, bossCleared, duration: replay?.duration ?? null });
      if (terminalRound) {
        work.outcome = !work.lp || (bossRound && !bossCleared) ? 'loss' : 'win'; work.phase = 'finished';
        events.push({ type: 'finished', outcome: work.outcome, result: battle.result });
      }
      else {
      if (work.roundLimit === 15 && work.round === 14 && (!bossCleared || work.lp <= 0)) { work.outcome = 'loss'; work.phase = 'finished'; events.push({ type: 'finished', outcome: work.outcome, result: battle.result }); }
      else {
      if (work.roundLimit === 15 && work.round === 14) work.outcome = 'boss-cleared';
      work.round++;
      work.playerEffects = work.playerEffects.filter((x) => x.type !== 'repeatNativeForging' || x.expiresRound >= work.round);
      const baseIncome = baseIncomeFor(work.round, gd, catalog); const facility = work.playerEffects.filter((x) => x.type === 'facilityIncome').reduce((n, x) => n + Number(x.amount || 0), 0);
      work.incomeThisRound = baseIncome; work.funds = baseIncome + Number(work.pendingFunds || 0) + facility; work.pendingFunds = 0;
      work.counters.spent = 0; work.counters.bought = 0; work.counters.refreshes = 0; work.counters.paidRefreshes = 0; work.counters.gained = 0; work.counters.factionBought = {};
      for (const piece of work.pieces) for (const item of piece.equipment) if (equipmentRecord(catalog, item.id)?.mechanism === 'saleThresholdRecruit') item.state = { ...(item.state || {}), saleTriggersThisPrep: 0 };
      work.shop.upgradePrice = Math.max(0, work.shop.upgradePrice - 1); work.shop.freeRefreshes = 0;
      work.shop.slots = advanceShop(work, gd, catalog, rng);
      work.shop.frozen = false;
      const award = roundAward(work);
      if (award) { work.pendingRoundStart = true; makePrizeOffer(work, catalog, award, 'round', rng); }
      else { work.phase = 'prep'; work.pendingRoundStart = false; invokeHook(work, 'roundStart', { round: work.round }, services); events.push({ type: 'round-start', round: work.round }); }
      }
      }
    } else throw new Error('UNKNOWN_ACTION');
    for (let n = Number(work.totals?.elites || 0) - elitesBefore; n > 0; n--) { pushPromotionReward(work, catalog, rng); events.push({ type: 'promotion-reward' }); }
    settleTemp(work);
    if (!readOnly) { work.rngState = rng.state(); work.revision++; }
    const errors = validateSession(work); if (errors.length) throw new Error(`INVALID_RESULT:${errors.join(',')}`);
    return replay ? { ok: true, state: work, events, replay } : { ok: true, state: work, events };
  } catch (error) {
    const code = typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : 'ACTION_FAILED';
    return { ok: false, error: { code, message: error?.message || 'Action failed.' }, state };
  }
}
