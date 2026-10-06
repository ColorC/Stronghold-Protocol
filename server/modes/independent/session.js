import { getData } from '../../data.js';
import { GameData } from '../../match/gamedata.js';
import { SharedPool } from '../../match/pool.js';
import { canPlace, inField, positionClass } from '../../match/board.js';
import { modeIdFor } from '../../../shared/constants.js';
import { createRng } from '../../sim/rng.js';
import { getCatalog } from './catalog.js';
import { runNativeHook } from './native.js';
import { runIndependentBattle, getIndependentField } from './battle.js';
import { grantEquipment, makeItem, equipItem, mergeItems, equipmentRecord, capacityUsed, totalEquipmentLevel, discardPieceAssets } from './equipment.js';
import { makePrizeOffer, choosePrize, useInventoryItem } from './prizes.js';
import { previewInheritance, applyInheritance } from './inheritance.js';
import { TAVERN_FACTIONS } from '../../../shared/independentRules.js';
import { nativeFactions, tavernFactions, attachmentAccepted } from '../../../shared/independentRules.js';

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
function operatorPool(state, catalog, gd) {
  const out = {};
  for (const [id, op] of Object.entries(ops(catalog))) {
    if (!safeId(id) || op.elite || op.isElite || id.endsWith('_b')) continue;
    const cap = Math.max(0, Number(gd.poolCopies(id) || catalog.config?.poolCopies?.[op.tier] || 0));
    if (cap) out[id] = { cap, left: cap, tier: Number(op.tier || 1) };
  }
  return out;
}
function drawChess(state, catalog, rng, maxTier) {
  const eligible = Object.entries(state.pool).filter(([id, p]) => p.left > 0 && p.tier <= maxTier && opFor(catalog, id));
  const total = eligible.reduce((n, [, p]) => n + p.left, 0);
  if (!total) return null;
  let roll = rng() * total;
  for (const [id, p] of eligible) { roll -= p.left; if (roll < 0) return id; }
  return eligible.at(-1)?.[0] || null;
}
export function drawEquipment(state, gd, catalog, rng, level) {
  const all = [ ...Object.values(catalog.badges || {}), ...Object.values(catalog.equipment || {}) ]
    .filter((x) => x && x.available !== false && !x.disabled && x.kind !== 'prizeGear' && x.kind !== '停用' && x.shopEligible !== false && x.oldShop !== false && Number(x.shopTier ?? x.tier ?? 1) <= level && x.id)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!all.length) return null;
  const pool = new SharedPool(gd);
  pool.entries = new Map(Object.entries(state.pool || {}).map(([id, value]) => [id, { ...value }]));
  const grouped = {};
  for (const item of all) (grouped[Number(item.shopTier ?? item.tier ?? 1)] ||= []).push(item.id);
  pool.gd = Object.create(gd); pool.gd.shopItemsByTier = grouped;
  return pool.rollItem(rng, level);
}
function slotsFor(state, gd, catalog, rng) {
  const counts = gd.shopSlots(state.shop.level); const slots = [];
  for (let i = 0; i < counts.chess; i++) slots.push({ kind: 'chess', id: drawChess(state, catalog, rng, state.shop.level), elite: false, price: 3, sold: false, equipment: [] });
  for (let i = 0; i < counts.item; i++) slots.push({ kind: 'equipment', id: drawEquipment(state, gd, catalog, rng, state.shop.level), elite: false, price: 3, sold: false, equipment: [] });
  return slots;
}
function advanceShop(state, gd, catalog, rng) {
  const next = slotsFor(state, gd, catalog, rng);
  if (!state.shop.frozen) return next;
  const current = state.shop.slots || [];
  return next.map((slot, i) => current[i] && !current[i].sold ? current[i] : slot);
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
    grantChess: (draft, chessId, extra = {}) => { const piece = gainChess(draft, catalog, chessId, extra); invokeHook(draft, 'gain', { piece, source: extra.source || 'nativeRecruit', paid: false }, servicesFor(draft, data, catalog, rng)); maybeMergeOperator(draft, catalog, chessId); return piece; },
    addOffer: (draft, offer) => draft.offers.push(offer),
    record: (draft, event) => pushEvent(draft, event),
  };
  return services;
}
function gainChess(state, catalog, chessId, extra = {}) {
  const def = opFor(catalog, chessId); if (!def || def.elite || def.isElite) throw new Error('UNKNOWN_CHESS');
  const stock = poolFor(state, chessId);
  if (!extra.poolTaken) { if (!stock?.left) throw new Error('SOLD_OUT'); stock.left--; }
  const uid = `p${state.nextUid++}`; const sourceChess = def.source?.normalChess || {};
  const piece = { uid, chessId, elite: false, row: null, col: null, dir: 'RIGHT', skillIndex: Number(sourceChess.skill?.index ?? def.defaultSkillIndex ?? 0), moduleId: 'none', equipment: [], attachments: [], nativeState: { preferences: { productionBadge: 'precision', factionPriority: Object.values(TAVERN_FACTIONS) } }, bodyPenaltyApplied: false, poolCopies: extra.poolCopies ?? 1 };
  state.pieces.push(piece); state.counters.gained = (state.counters.gained || 0) + 1;
  return piece;
}
function handleGainEquipment(state, catalog) {
  for (const piece of state.pieces) {
  if (!tavernFactions(piece, catalog).includes('炎')) continue;
  for (const item of piece.equipment || []) {
    const def = equipmentRecord(catalog, item.id);
    const effect = def?.params?.effects?.find((x) => x.behavior === 'gainBattleStats' && x.params?.deferredFunds);
    if (!effect || !piece.equipment.some((x) => (x.sourceId || equipmentRecord(catalog, x.id)?.sourceId) === effect.params.pairedSourceId)) continue;
    if (item.state?.deferredFundsRound === state.round) continue;
    const amount = Number(item.elite ? effect.params.deferredFunds.elite : effect.params.deferredFunds.normal);
    if (amount > 0) { state.pendingFunds += amount; item.state = { ...(item.state || {}), deferredFundsRound: state.round }; }
  }
  }
}
function mergeCopiesRequired(op) {
  const custom = op?.nativeTrait?.effect?.prep?.find((x) => x.trigger === 'merge' && x.behavior === 'twoCopyElite');
  return Math.max(2, Number(custom?.params?.copiesRequired || 3));
}
function mergeKey(item, catalog) {
  const d = equipmentRecord(catalog, item.id);
  return d?.unique ? (d.uniqueKey || d.canonicalId || item.id) : null;
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
    } else worn.push(x);
  }
  if (worn.reduce((n, x) => n + Number(x.quantity || 1), 0) > 99) throw new Error('CAPACITY');
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
  survivor.chessId = op.eliteChessId; survivor.elite = true; survivor.equipment = worn; survivor.attachments = keptAttachments;
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
      const threshold = Number(item.elite ? def.params.eliteSaleThreshold : def.params.normalSaleThreshold);
      if (state.counters.sold < threshold) continue;
      const tier = state.shop.level; const candidates = Object.values(catalog.operators).filter((op) => !op.elite && op.tier <= tier && tavernFactions({ chessId: op.chessId }, catalog).some((f) => factions.has(f)) && state.pool?.[op.chessId]?.left > 0).map((op) => op.chessId).sort();
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
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed) >>> 0 : 1;
  const rng = createRng(seed); const gd = new GameData(data, modeIdFor('solo', difficulty.toLowerCase()));
  const income = baseIncomeFor(1, gd, catalog);
  const state = { schemaVersion: 1, modeId: 'independent', seed, rngState: rng.state(), nextUid: 1, revision: 0, round: 1, roundLimit,
    difficulty, phase: 'prep', funds: income, pendingFunds: 0, lp: gd.startLp(null), deployCap: 8,
    shop: { level: 1, upgradePrice: gd.upgradeBase(1) ?? 0, slots: [], frozen: false, freeRefreshes: 0 }, pieces: [], inventory: [], offers: [],
    incomeThisRound: income, pendingRoundStart: false, playerEffects: [], counters: { gained: 0, bought: 0, refreshes: 0, paidRefreshes: 0, spent: 0, sold: 0 }, pool: operatorPool({ pool: {} }, catalog, gd), history: [], battleSummary: null, outcome: null };
  state.shop.slots = slotsFor(state, gd, catalog, rng); state.rngState = rng.state();
  const errs = validateSession(state);
  if (errs.length) throw new Error(`INVALID_INITIAL_STATE:${errs.join(',')}`);
  return state;
}

export function validateSession(state) {
  const e = [];
  if (!isRecord(state) || state.schemaVersion !== 1 || state.modeId !== 'independent') return ['BAD_SCHEMA'];
  for (const k of ['seed', 'rngState', 'nextUid', 'revision', 'round', 'roundLimit', 'funds', 'pendingFunds', 'lp', 'deployCap']) if (!Number.isFinite(state[k])) e.push(`BAD_${k.toUpperCase()}`);
  if (!['prep', 'prize', 'finished'].includes(state.phase)) e.push('BAD_PHASE');
  if (![9, 14, 15].includes(state.roundLimit) || state.round < 1 || state.round > state.roundLimit + 1) e.push('BAD_ROUND');
  for (const key of ['pieces', 'inventory', 'offers', 'playerEffects', 'history']) if (!Array.isArray(state[key])) e.push(`BAD_${key.toUpperCase()}`);
  if (!isRecord(state.shop) || !Array.isArray(state.shop.slots) || !Number.isInteger(state.shop.level)) e.push('BAD_SHOP');
  if (!isRecord(state.pool)) e.push('BAD_POOL');
  else for (const [id, p] of Object.entries(state.pool)) if (!safeId(id) || !Number.isInteger(p.left) || !Number.isInteger(p.cap) || p.left < 0 || p.left > p.cap) e.push('BAD_POOL_ENTRY');
  const uids = new Set();
  for (const item of [...(state.inventory || []), ...(state.pieces || []).flatMap((p) => p.equipment || [])]) {
    if (!safeId(item.uid) || uids.has(item.uid)) e.push('BAD_UID'); else uids.add(item.uid);
  }
  for (const p of state.pieces || []) {
    if (!safeId(p.uid) || !safeId(p.chessId) || !Array.isArray(p.equipment) || !Array.isArray(p.attachments) || !isRecord(p.nativeState)) e.push('BAD_PIECE');
    if ((p.row === null) !== (p.col === null) || (p.row !== null && (!inField(p.row, p.col) || !inField(p.row, p.col)))) e.push('BAD_POSITION');
    for (const attachment of p.attachments || []) if (!safeId(attachment.id) || (attachment.state !== undefined && !isRecord(attachment.state))) e.push('BAD_ATTACHMENT');
  }
  for (const item of state.inventory || []) if (!safeId(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1) e.push('BAD_ITEM');
  for (const p of state.pieces || []) if (p.equipment?.reduce((n, x) => n + Number(x.quantity || 0), 0) > 99) e.push('PIECE_CAPACITY');
  return e;
}

export function viewSession(state, options = {}) {
  const data = sessionData(options); const catalog = sessionCatalog(data, options);
  let field = null;
  try { field = getIndependentField(state, { data, catalog }); } catch { /* keep the raw state visible when content lookup is unavailable */ }
  const pieces = state.pieces.map((p) => {
    const op = opFor(catalog, p.chessId) || {};
    const raw = p.elite ? (op.source?.eliteChess || op.source?.normalChess) : op.source?.normalChess;
    const modules = (raw?.modules || []).map((x) => ({ ...clone(x), id: x.uniEquipId || x.id })).filter((x) => x.id);
    const steamOptions = ['chess_item_2_03_e_a', 'chess_item_3_09_e_a', 'chess_item_3_10_e_a', 'chess_item_4_09_e_a'];
    return { ...clone(p), name: op.name, skill: op.skill, skills: clone(raw?.skills || {}), modules: clone(modules), nativeTrait: op.nativeTrait?.[p.elite ? 'eliteText' : 'normalText'], permission: clone(op.inheritance || (op.name && catalog.permissions?.[op.name]) || null), preferences: clone(p.nativeState?.preferences || {}), equipmentLevel: totalEquipmentLevel(p, catalog), equipmentDetails: p.equipment.map((x) => ({ ...clone(x), record: clone(equipmentRecord(catalog, x.id)), steamOptions: equipmentRecord(catalog, x.id)?.mechanism === 'combatEquipment' && equipmentRecord(catalog, x.id)?.params?.effects?.some((e) => e.behavior === 'steamGearUpgrade') ? steamOptions : undefined })), attachmentDetails: p.attachments.map((x) => ({ ...clone(x), record: clone(catalog.attachments?.[x.id]) })), legalActions: ['move', 'bench', 'loadout', 'configure', 'configure-equipment', 'equip', 'sell', 'inherit-preview'] };
  });
    return { ...clone(state), pieces, catalog: { badges: catalog.badges, equipment: catalog.equipment, attachments: catalog.attachments }, legalActions: state.phase === 'prep' ? ['buy', 'refresh', 'freeze', 'upgrade', 'sell', 'move', 'bench', 'loadout', 'configure', 'configure-equipment', 'equip', 'merge-item', 'use-item', 'inherit-preview', 'inherit', 'ready'] : state.phase === 'prize' ? ['choose'] : [],
    board: field ? { stageId: field.stageId, map: [...(field.deployMap || new Map()).entries()] } : null, battleSummary: state.battleSummary,
    forecast: state.phase === 'prep' ? forecastPrepEnd(state, data, catalog) : null };
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
  const rng = createRng(work.rngState); const events = [];
  const services = servicesFor(work, data, catalog, rng);
  const act = action.type; let readOnly = false;
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
          const piece = gainChess(work, catalog, op.chessId, {}); invokeHook(work, 'gain', { piece, source: offer.source || 'choice' }, services);
          for (const carried of offer.carriedEquipment || []) { const item = makeItem(work, carried.id, carried.quantity || 1, { elite: !!carried.elite, sourceId: carried.sourceId }); work.inventory.push(item); equipItem(work, catalog, item.uid, piece.uid, carried.quantity || 1); }
          handleGainEquipment(work, catalog, piece);
          work.offers.splice(work.offers.indexOf(offer), 1);
          for (const merged of maybeMergeOperator(work, catalog, op.chessId)) events.push({ type: 'operator-merge', uid: merged.piece.uid, chessId: merged.piece.chessId });
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
        work.funds -= slot.price; work.counters.spent += slot.price; work.counters.bought += 1; invokeHook(work, 'spend', { amount: slot.price, source: 'buy' }, services);
        pool.left -= 1; const piece = gainChess(work, catalog, slot.id, { poolCopies: 1, poolTaken: true });
        invokeHook(work, 'gain', { piece, source: 'buy', paid: true }, services); events.push({ type: 'buy', uid: piece.uid, chessId: piece.chessId });
        for (const carried of slot.equipment || []) {
          const item = makeItem(work, carried.id, carried.quantity || 1, { elite: !!carried.elite, sourceId: carried.sourceId }); work.inventory.push(item);
          equipItem(work, catalog, item.uid, piece.uid, carried.quantity || 1);
        }
        handleGainEquipment(work, catalog, piece);
        for (const merged of maybeMergeOperator(work, catalog, piece.chessId)) events.push({ type: 'operator-merge', uid: merged.piece.uid, chessId: merged.piece.chessId });
      } else {
        work.funds -= slot.price; work.counters.spent += slot.price; invokeHook(work, 'spend', { amount: slot.price, source: 'buy-equipment' }, services);
        grantEquipment(work, catalog, slot.id, 1, { elite: !!slot.elite, origin: 'shop', phase: 'shop' }); events.push({ type: 'buy-equipment', id: slot.id });
      }
      slot.sold = true;
    } else if (act === 'refresh') {
      ensurePrep(work);
      const free = work.shop.freeRefreshes > 0;
      if (free) work.shop.freeRefreshes--;
      else { if (work.funds < 1) throw new Error('NO_FUNDS'); work.funds--; work.counters.spent++; work.counters.paidRefreshes++; invokeHook(work, 'spend', { amount: 1, source: 'refresh' }, services); }
      work.counters.refreshes = (work.counters.refreshes || 0) + 1;
      work.shop.slots = slotsFor(work, gd, catalog, rng); invokeHook(work, 'refresh', { free }, services);
      events.push({ type: 'refresh' });
    } else if (act === 'freeze') {
      ensurePrep(work); work.shop.frozen = !work.shop.frozen; events.push({ type: 'freeze', value: work.shop.frozen });
    } else if (act === 'upgrade') {
      ensurePrep(work); if (work.shop.level >= gd.maxShopLevel) throw new Error('MAX_LEVEL');
      const price = work.shop.upgradePrice; if (work.funds < price) throw new Error('NO_FUNDS');
      work.funds -= price; work.counters.spent += price; invokeHook(work, 'spend', { amount: price, source: 'upgrade' }, services); work.shop.level++;
      work.shop.upgradePrice = gd.upgradeBase(work.shop.level) ?? 0; events.push({ type: 'upgrade', level: work.shop.level });
    } else if (act === 'sell') {
      ensurePrep(work); const p = work.pieces.find((x) => x.uid === action.uid); if (!p) throw new Error('BAD_TARGET');
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
      p.row = action.row; p.col = action.col; p.dir = action.dir || p.dir || 'RIGHT'; events.push({ type: 'move', uid: p.uid, row: p.row, col: p.col });
    } else if (act === 'bench') {
      ensurePrep(work); const p = work.pieces.find((x) => x.uid === action.uid); if (!p) throw new Error('BAD_TARGET'); p.row = null; p.col = null; events.push({ type: 'bench', uid: p.uid });
    } else if (act === 'loadout') {
      ensurePrep(work); const p = work.pieces.find((x) => x.uid === action.uid); const op = p && opFor(catalog, p.chessId); if (!p || !op) throw new Error('BAD_TARGET');
      const raw = p.elite ? (op.source?.eliteChess || op.source?.normalChess) : op.source?.normalChess;
      if (!Number.isInteger(action.skillIndex) || action.skillIndex < 0 || action.skillIndex >= (raw?.skills || []).length) throw new Error('BAD_SKILL');
      const moduleId = action.moduleId ?? p.moduleId; const moduleIds = (raw?.modules || []).map((x) => x.uniEquipId || x.id).filter(Boolean);
      if (moduleId !== 'none' && !moduleIds.includes(moduleId)) throw new Error('BAD_MODULE');
      p.skillIndex = action.skillIndex; p.moduleId = moduleId; events.push({ type: 'loadout', uid: p.uid });
    } else if (act === 'configure') {
      ensurePrep(work); const piece = work.pieces.find((x) => x.uid === action.uid); if (!piece) throw new Error('BAD_TARGET');
      const preference = { ...(piece.nativeState.preferences || {}) };
      if (action.productionBadge !== undefined) {
        if (!['precision', 'agility', 'vitality', 'defense', 'assault', 'recovery'].includes(action.productionBadge)) throw new Error('BAD_PRODUCTION_BADGE');
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
      const limit = Number(item.elite ? limits?.elite : limits?.normal);
      if (!Number.isInteger(limit) || limit < 1) throw new Error('BAD_EQUIPMENT_RULE');
      if (!Array.isArray(selected) || selected.length > limit || new Set(selected).size !== selected.length || selected.some((id) => !allowed.includes(id) || !piece.equipment.some((x) => (x.sourceId || equipmentRecord(catalog, x.id)?.sourceId) === id))) throw new Error('BAD_HAMMER_SELECTION');
      item.state = { ...(item.state || {}), hammerSourceIds: [...selected] };
      events.push({ type: 'configure-equipment', targetUid: piece.uid, itemUid: item.uid, hammerSourceIds: [...selected] });
    } else if (act === 'merge-item') {
      ensurePrep(work); const item = mergeItems(work, catalog, action.firstUid, action.secondUid); invokeHook(work, 'merge', { item, copiesConsumed: 2 }, services); events.push({ type: 'merge-item', itemId: item.id });
    } else if (act === 'use-item') {
      ensurePrep(work); events.push(useInventoryItem(work, catalog, action.itemUid, action, data));
    } else if (act === 'inherit-preview') {
      readOnly = true; events.push({ type: 'inherit-preview', preview: previewInheritance(work, catalog, action.donorUid, action.receiverUid, data) });
    } else if (act === 'inherit') {
      ensurePrep(work); const result = applyInheritance(work, catalog, action.donorUid, action.receiverUid, action.uniqueSelections || {}, data); work.funds += 1; work.counters.sold++; handleSaleEquipment(work, catalog); events.push({ type: 'inherit', receiverUid: result.receiver.uid, preview: result.preview });
    } else if (act === 'ready') {
      ensurePrep(work);
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
      const battle = runIndependentBattle(work, { data, catalog });
      if (!battle || !battle.result) throw new Error('BATTLE_FAILED');
      const gd = gdFor(work, data); const playerResult = battle.result.perPlayer?.independent || Object.values(battle.result.perPlayer || {})[0] || {};
      const leaked = Array.isArray(playerResult.leaked) ? playerResult.leaked.filter((x) => x && x.counted !== false).reduce((n, x) => n + Math.max(0, Number(x.lpr) || 1), 0) : 0;
      const lpLost = Math.min(gd.lpCapPerRound, Math.max(0, leaked));
      work.battleSummary = { result: battle.result, samples: battle.samples || [], diagnostics: battle.diagnostics || {}, pieceStates: battle.pieceStates || {} };
      work.lp = Math.max(0, work.lp - lpLost);
      for (const [uid, ps] of Object.entries(battle.pieceStates || {})) { const piece = work.pieces.find((x) => x.uid === uid); if (piece) { piece.nativeState = clone(ps.nativeState || {}); piece.equipment = clone(ps.equipment || []); piece.attachments = clone(ps.attachments || []); } }
      for (const reward of battle.rewards || []) grantEquipment(work, catalog, reward.id, reward.quantity || 1, { origin: reward.origin, phase: 'battle', sourceUid: reward.sourceUid, copied: reward.copied });
      const fieldKind = getIndependentField(work, { data, catalog }).field;
      const bossRound = fieldKind === 'bossL';
      const bossCleared = bossRound && Number(battle.result.bossHpLeft) <= 0 && !battle.diagnostics?.capped;
      const lastRound = work.round >= work.roundLimit;
      const failedBoss = bossRound && !bossCleared;
      const terminalRound = lastRound || failedBoss || work.lp <= 0;
      work.history.push({ round: work.round, type: 'battle', result: battle.result, lpLost, bossCleared });
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
      work.counters.spent = 0; work.counters.bought = 0; work.counters.refreshes = 0; work.counters.paidRefreshes = 0; work.counters.gained = 0;
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
    if (!readOnly) { work.rngState = rng.state(); work.revision++; }
    const errors = validateSession(work); if (errors.length) throw new Error(`INVALID_RESULT:${errors.join(',')}`);
    return { ok: true, state: work, events };
  } catch (error) {
    const code = typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : 'ACTION_FAILED';
    return { ok: false, error: { code, message: error?.message || 'Action failed.' }, state };
  }
}
