import { getData } from '../../data.js';
import { GameData } from '../../match/gamedata.js';
import { SharedPool } from '../../match/pool.js';
import { buildDeployMap, canPlace, inField, FIELD } from '../../match/board.js';
import { modeIdFor } from '../../../shared/constants.js';
import { createRng } from '../../sim/rng.js';
import { getCatalog } from './catalog.js';
import { runNativeHook } from './native.js';
import { runIndependentBattle, getIndependentField } from './battle.js';
import { grantEquipment, equipItem, mergeItems, equipmentRecord, capacityUsed, totalEquipmentLevel, discardPieceAssets } from './equipment.js';
import { makePrizeOffer, choosePrize, useInventoryItem } from './prizes.js';
import { previewInheritance, applyInheritance } from './inheritance.js';

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
function drawEquipment(catalog, rng, level) {
  const all = [ ...Object.values(catalog.badges || {}), ...Object.values(catalog.equipment || {}) ]
    .filter((x) => x && x.available !== false && !x.disabled && x.kind !== 'prizeGear' && x.kind !== '停用' && x.shopEligible !== false && x.oldShop !== false && Number(x.shopTier ?? x.tier ?? 1) <= level && x.id)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return all.length ? all[Math.floor(rng() * all.length)].id : null;
}
function slotsFor(state, gd, catalog, rng) {
  const counts = gd.shopSlots(state.shop.level); const slots = [];
  for (let i = 0; i < counts.chess; i++) slots.push({ kind: 'chess', id: drawChess(state, catalog, rng, state.shop.level), elite: false, price: 3, sold: false, equipment: [] });
  for (let i = 0; i < counts.item; i++) slots.push({ kind: 'equipment', id: drawEquipment(catalog, rng, state.shop.level), elite: false, price: 3, sold: false, equipment: [] });
  return slots;
}
function advanceShop(state, gd, catalog, rng) {
  const next = slotsFor(state, gd, catalog, rng);
  if (!state.shop.frozen) return next;
  const current = state.shop.slots || [];
  return next.map((slot, i) => current[i] && !current[i].sold ? current[i] : slot);
}
function invokeHook(state, hook, event, services) {
  return runNativeHook(state, hook, event, services);
}
function servicesFor(state, data, catalog, rng) {
  return { data, catalog, rng,
    grantEquipment: (draft, id, quantity, extra = {}) => grantEquipment(draft, catalog, id, quantity, extra),
    grantChess: (draft, chessId, extra = {}) => gainChess(draft, catalog, chessId, extra),
    addOffer: (draft, offer) => draft.offers.push(offer),
    record: (draft, event) => pushEvent(draft, event),
  };
}
function gainChess(state, catalog, chessId, extra = {}) {
  const def = opFor(catalog, chessId); if (!def || def.elite || def.isElite) throw new Error('UNKNOWN_CHESS');
  const stock = poolFor(state, chessId);
  if (!extra.poolTaken) { if (!stock?.left) throw new Error('SOLD_OUT'); stock.left--; }
  const uid = `p${state.nextUid++}`; const sourceChess = def.source?.normalChess || {};
  const piece = { uid, chessId, elite: false, row: null, col: null, dir: 'RIGHT', skillIndex: Number(def.defaultSkillIndex ?? sourceChess.defaultSkillIndex ?? 0), moduleId: 'none', equipment: [], attachments: [], nativeState: {}, bodyPenaltyApplied: false, poolCopies: extra.poolCopies ?? 1 };
  state.pieces.push(piece); state.counters.gained = (state.counters.gained || 0) + 1;
  return piece;
}
function goodsInShop(state, kind) { return state.shop.slots.filter((x) => x.kind === kind && !x.sold); }
function safeCopyPool(state, id, n) { const p = poolFor(state, id); if (p) p.left = Math.min(p.cap, p.left + n); }
function requireFinitePositive(x) { if (!Number.isFinite(x) || x < 0) throw new Error('BAD_NUMBER'); }
function roundAward(state) {
  if (state.roundLimit === 9) return state.round === 4 || state.round === 8 ? 'cashout' : null;
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
  const state = { schemaVersion: 1, modeId: 'independent', seed, rngState: rng.state(), nextUid: 1, revision: 0, round: 1, roundLimit,
    difficulty, phase: 'prep', funds: gd.income(1), pendingFunds: 0, lp: gd.startLp(null), deployCap: 8,
    shop: { level: 1, upgradePrice: gd.upgradeBase(1) ?? 0, slots: [], frozen: false, freeRefreshes: 0 }, pieces: [], inventory: [], offers: [],
    playerEffects: [], counters: { gained: 0, bought: 0, paidRefreshes: 0, spent: 0, sold: 0 }, pool: operatorPool({ pool: {} }, catalog, gd), history: [], battleSummary: null };
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
  for (const item of [...(state.inventory || []), ...(state.pieces || []).flatMap((p) => [...(p.equipment || []), ...(p.attachments || [])])]) {
    if (!safeId(item.uid) || uids.has(item.uid)) e.push('BAD_UID'); else uids.add(item.uid);
  }
  for (const p of state.pieces || []) {
    if (!safeId(p.uid) || !safeId(p.chessId) || !Array.isArray(p.equipment) || !Array.isArray(p.attachments) || !isRecord(p.nativeState)) e.push('BAD_PIECE');
    if ((p.row === null) !== (p.col === null) || (p.row !== null && (!inField(p.row, p.col) || !inField(p.row, p.col)))) e.push('BAD_POSITION');
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
    return { ...clone(p), name: op.name, skill: op.skill, skills: clone(op.source?.skills || op.skills || []), modules: clone(op.source?.modules || op.modules || []), nativeTrait: op.nativeTrait?.[p.elite ? 'eliteText' : 'normalText'], permission: clone(op.inheritance || (op.name && catalog.permissions?.[op.name]) || null), equipmentLevel: totalEquipmentLevel(p, catalog), equipmentDetails: p.equipment.map((x) => ({ ...clone(x), record: clone(equipmentRecord(catalog, x.id)) })), attachmentDetails: p.attachments.map((x) => ({ ...clone(x), record: clone(catalog.attachments?.[x.id]) })), legalActions: ['move', 'bench', 'loadout', 'equip', 'sell', 'inherit-preview'] };
  });
  return { ...clone(state), pieces, catalog: { badges: catalog.badges, equipment: catalog.equipment, attachments: catalog.attachments }, legalActions: state.phase === 'prep' ? ['buy', 'refresh', 'freeze', 'upgrade', 'sell', 'move', 'bench', 'loadout', 'equip', 'merge-item', 'use-item', 'inherit-preview', 'inherit', 'ready'] : state.phase === 'prize' ? ['choose'] : [],
    board: field ? { stageId: field.stageId, map: [...(field.deployMap || new Map()).entries()] } : null, battleSummary: state.battleSummary };
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
      else {
        if (!Number.isInteger(action.index) || !safeId(offer.choices[action.index])) throw new Error('BAD_CHOICE');
        if (offer.type === 'recruit') {
          const op = opFor(catalog, offer.choices[action.index]); if (!op) throw new Error('BAD_CHOICE');
          const piece = gainChess(work, catalog, op.chessId, {}); invokeHook(work, 'gain', { piece, source: offer.source || 'choice' }, services);
          work.offers.splice(work.offers.indexOf(offer), 1);
        } else if (offer.type === 'attachment') {
          const piece = work.pieces.find((x) => x.uid === (action.targetUid || offer.targetUid)); if (!piece) throw new Error('BAD_TARGET');
          const attachmentId = offer.choices[action.index]; const attachment = catalog.attachments?.[attachmentId];
          if (!attachment || piece.attachments.some((x) => x.id === attachmentId)) throw new Error('UNIQUE');
          piece.attachments.push({ id: attachmentId, state: {} }); work.offers.splice(work.offers.indexOf(offer), 1);
        }
      }
      if (!work.offers.some((x) => x.type === 'prize')) work.phase = 'prep';
    } else if (act === 'buy') {
      ensurePrep(work); const slot = work.shop.slots[action.slot];
      if (!Number.isInteger(action.slot) || !slot || slot.sold || !slot.id) throw new Error('BAD_SLOT');
      if (work.funds < slot.price) throw new Error('NO_FUNDS');
      if (slot.kind === 'chess') {
        const pool = poolFor(work, slot.id); if (!pool?.left) throw new Error('SOLD_OUT');
        work.funds -= slot.price; work.counters.spent += slot.price; work.counters.bought += 1;
        pool.left -= 1; const piece = gainChess(work, catalog, slot.id, { poolCopies: 1, poolTaken: true });
        invokeHook(work, 'gain', { piece, source: 'buy', paid: true }, services); events.push({ type: 'buy', uid: piece.uid, chessId: piece.chessId });
        for (const carried of slot.equipment || []) grantEquipment(work, catalog, carried.id, carried.quantity || 1, { sourceId: carried.sourceUid });
      } else {
        work.funds -= slot.price; work.counters.spent += slot.price;
        grantEquipment(work, catalog, slot.id, 1, { elite: !!slot.elite }); events.push({ type: 'buy-equipment', id: slot.id });
      }
      slot.sold = true;
    } else if (act === 'refresh') {
      ensurePrep(work);
      if (work.shop.frozen) throw new Error('FROZEN');
      if (work.shop.freeRefreshes > 0) work.shop.freeRefreshes--;
      else { if (work.funds < 1) throw new Error('NO_FUNDS'); work.funds--; work.counters.spent++; work.counters.paidRefreshes++; }
      const free = work.shop.freeRefreshes > 0;
      work.shop.slots = slotsFor(work, gd, catalog, rng); invokeHook(work, 'refresh', { free }, services);
      events.push({ type: 'refresh' });
    } else if (act === 'freeze') {
      ensurePrep(work); work.shop.frozen = !work.shop.frozen; events.push({ type: 'freeze', value: work.shop.frozen });
    } else if (act === 'upgrade') {
      ensurePrep(work); if (work.shop.level >= gd.maxShopLevel) throw new Error('MAX_LEVEL');
      const price = work.shop.upgradePrice; if (work.funds < price) throw new Error('NO_FUNDS');
      work.funds -= price; work.counters.spent += price; work.shop.level++;
      work.shop.upgradePrice = gd.upgradeBase(work.shop.level) ?? 0; events.push({ type: 'upgrade', level: work.shop.level });
    } else if (act === 'sell') {
      ensurePrep(work); const p = work.pieces.find((x) => x.uid === action.uid); if (!p) throw new Error('BAD_TARGET');
      discardPieceAssets(work, p); safeCopyPool(work, p.chessId, p.poolCopies || 1); work.pieces.splice(work.pieces.indexOf(p), 1);
      work.funds++; work.counters.sold++; invokeHook(work, 'sold', { piece: p }, services); events.push({ type: 'sell', uid: p.uid, funds: 1 });
    } else if (act === 'move') {
      ensurePrep(work); const p = work.pieces.find((x) => x.uid === action.uid); if (!p) throw new Error('BAD_TARGET');
      if (!Number.isInteger(action.row) || !Number.isInteger(action.col) || !inField(action.row, action.col)) throw new Error('BAD_POSITION');
      const occupied = work.pieces.some((x) => x !== p && x.row === action.row && x.col === action.col); if (occupied) throw new Error('OCCUPIED');
      const field = getIndependentField(work, { data, catalog }); const op = opFor(catalog, p.chessId); const pos = op?.position || op?.placement || 'ALL';
      const cls = String(pos).toUpperCase() === 'MELEE' ? 'melee' : String(pos).toUpperCase() === 'RANGED' ? 'ranged' : 'all';
      if (!canPlace(field.deployMap, cls, action.row, action.col)) throw new Error('ILLEGAL_TILE');
      if (action.dir && !['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(action.dir)) throw new Error('BAD_DIRECTION');
      p.row = action.row; p.col = action.col; p.dir = action.dir || p.dir || 'RIGHT'; events.push({ type: 'move', uid: p.uid, row: p.row, col: p.col });
    } else if (act === 'bench') {
      ensurePrep(work); const p = work.pieces.find((x) => x.uid === action.uid); if (!p) throw new Error('BAD_TARGET'); p.row = null; p.col = null; events.push({ type: 'bench', uid: p.uid });
    } else if (act === 'loadout') {
      ensurePrep(work); const p = work.pieces.find((x) => x.uid === action.uid); const op = p && opFor(catalog, p.chessId); if (!p || !op) throw new Error('BAD_TARGET');
      if (!Number.isInteger(action.skillIndex) || action.skillIndex < 0 || action.skillIndex >= (op.skills || []).length) throw new Error('BAD_SKILL');
      const moduleId = action.moduleId ?? p.moduleId; if (moduleId !== 'none' && !(op.modules || []).some((m) => m.id === moduleId || m.moduleId === moduleId)) throw new Error('BAD_MODULE');
      p.skillIndex = action.skillIndex; p.moduleId = moduleId; events.push({ type: 'loadout', uid: p.uid });
    } else if (act === 'equip') {
      ensurePrep(work); const item = equipItem(work, catalog, action.itemUid, action.targetUid, action.quantity ?? 1); events.push({ type: 'equip', itemId: item.id, targetUid: action.targetUid });
    } else if (act === 'merge-item') {
      ensurePrep(work); const item = mergeItems(work, catalog, action.firstUid, action.secondUid); events.push({ type: 'merge-item', itemId: item.id });
    } else if (act === 'use-item') {
      ensurePrep(work); events.push(useInventoryItem(work, catalog, action.itemUid, action));
    } else if (act === 'inherit-preview') {
      readOnly = true; events.push({ type: 'inherit-preview', preview: previewInheritance(work, catalog, action.donorUid, action.receiverUid) });
    } else if (act === 'inherit') {
      ensurePrep(work); const result = applyInheritance(work, catalog, action.donorUid, action.receiverUid, action.uniqueSelections || {}); work.funds += 1; work.counters.sold++; events.push({ type: 'inherit', receiverUid: result.receiver.uid, preview: result.preview });
    } else if (act === 'ready') {
      ensurePrep(work);
      if (work.pieces.filter((x) => x.row !== null).length < 1) throw new Error('NO_DEPLOYED_PIECES');
      invokeHook(work, 'prepEnd', { round: work.round }, services);
      const battle = runIndependentBattle(work, { data, catalog });
      if (!battle || !battle.result) throw new Error('BATTLE_FAILED');
      const gd = gdFor(work, data); const playerResult = battle.result.perPlayer?.independent || Object.values(battle.result.perPlayer || {})[0] || {};
      const leaked = Array.isArray(playerResult.leaked) ? playerResult.leaked.filter((x) => x && x.counted !== false).length : 0;
      const lpLost = Math.min(gd.lpCapPerRound, Math.max(0, leaked));
      work.battleSummary = { result: battle.result, samples: battle.samples || [], diagnostics: battle.diagnostics || {}, pieceStates: battle.pieceStates || {} };
      work.lp = Math.max(0, work.lp - lpLost);
      for (const [uid, ps] of Object.entries(battle.pieceStates || {})) { const piece = work.pieces.find((x) => x.uid === uid); if (piece) { piece.nativeState = clone(ps.nativeState || {}); piece.equipment = clone(ps.equipment || []); piece.attachments = clone(ps.attachments || []); } }
      for (const reward of battle.rewards || []) grantEquipment(work, catalog, reward.id, reward.quantity || 1, { sourceId: reward.sourceUid });
      work.history.push({ round: work.round, type: 'battle', result: battle.result, lpLost });
      if (work.lp <= 0 || work.round >= work.roundLimit) { work.phase = 'finished'; events.push({ type: 'finished', result: battle.result }); }
      else {
      work.round++;
      const baseIncome = gd.income(work.round); const facility = work.playerEffects.filter((x) => x.type === 'facilityIncome').reduce((n, x) => n + Number(x.amount || 0), 0);
      work.incomeThisRound = baseIncome; work.funds = baseIncome + Number(work.pendingFunds || 0) + facility; work.pendingFunds = 0;
      work.counters.spent = 0; work.counters.bought = 0; work.counters.paidRefreshes = 0; work.counters.gained = 0;
      work.shop.upgradePrice = Math.max(0, work.shop.upgradePrice - 1); work.shop.freeRefreshes = 0;
      work.shop.slots = advanceShop(work, gd, catalog, rng);
      const award = roundAward(work);
      if (award) makePrizeOffer(work, catalog, award, 'round', rng); else work.phase = 'prep';
      invokeHook(work, 'roundStart', { round: work.round }, services);
        events.push({ type: 'round-start', round: work.round });
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
