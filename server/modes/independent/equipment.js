import { tavernFactions } from '../../../shared/independentRules.js';
import { INVENTORY_STACK_LIMIT, inventoryStackKey, inventoryStackGroups, quantityEquippable } from '../../../shared/independentInventory.js';
export { INVENTORY_STACK_LIMIT } from '../../../shared/independentInventory.js';

const own = (o, k) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k);
const rec = (map, id) => typeof id === 'string' && own(map, id) ? map[id] : null;
const number = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;

export const itemCount = (state) => (state.inventory || []).reduce((n, x) => n + Math.max(0, Math.floor(number(x.quantity, 1))), 0);
export const equippedCount = (state) => (state.pieces || []).reduce((n, p) => n + (p.equipment || []).reduce((m, x) => m + Math.max(0, Math.floor(number(x.quantity, 1))), 0), 0);
export const capacityUsed = (state) => itemCount(state);
/** Pieces of gear one operator may wear (2026-10-06: raised from 99). */
export const EQUIPMENT_CAPACITY = 999;
/**
 * Stock slots: compatible configurations share tiles of at most 999 pieces. A prize kept for later takes no tile.
 * Overflow follows the production ledger's lost contract; old over-capacity saves keep their items and uids.
 */
export const INVENTORY_CAPACITY = 20;
export function inventoryTiles(state, catalog) {
  return inventoryStackGroups((state.inventory || []).filter((x) => !catalog || equipmentRecord(catalog, x.id)))
    .reduce((count, group) => count + Math.ceil(group.quantity / INVENTORY_STACK_LIMIT), 0);
}
export function inventoryRoomFor(state, catalog, id, extra = {}) {
  const key = inventoryStackKey({ id, state: extra.state || {} });
  const group = inventoryStackGroups(state.inventory).find((x) => x.key === key);
  const partial = group ? Math.ceil(group.quantity / INVENTORY_STACK_LIMIT) * INVENTORY_STACK_LIMIT - group.quantity : 0;
  return partial + Math.max(0, INVENTORY_CAPACITY - inventoryTiles(state, catalog)) * INVENTORY_STACK_LIMIT;
}
export function hasTileFor(state, catalog, id, extra = {}) {
  return inventoryRoomFor(state, catalog, id, extra) > 0;
}
export const pieceEquipmentCount = (piece) => (piece?.equipment || []).reduce((n, x) => n + Math.max(0, Math.floor(number(x.quantity, 1))), 0);

export function catalogRecord(catalog, collection, id) { return rec(catalog && catalog[collection], id); }
export function equipmentRecord(catalog, id) {
  return rec(catalog?.equipment, id) || Object.values(catalog?.equipment || {}).find((x) => x?.id === id || x?.sourceId === id) || rec(catalog?.badges, id);
}
export function equipmentForSource(catalog, sourceId) {
  const all = Object.values(catalog?.equipment || {});
  return all.find((x) => x && x.sourceId === sourceId) || null;
}

export function makeItem(state, id, quantity = 1, extra = {}) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('BAD_QUANTITY');
  // gear has one form only (owner 2026-10-07 「装备不再有精锐形态」): an item never carries an elite flag
  const item = { uid: `i${state.nextUid++}`, id, quantity, state: structuredClone(extra.state || {}) };
  if (extra.sourceId) item.sourceId = extra.sourceId;
  return item;
}

/** Where a landing badge may go (catalog.config.badgeLanding, a rule's params.landOn). */
export const LANDING_MODES = Object.freeze(['self', 'front', 'adjacent', 'factionLowest', 'lowest', 'faction:<阵营>']);
const LANDING_ORIGINS = new Set(['native', 'equipment', 'attachment']);
const STEP = { RIGHT: [0, 1], LEFT: [0, -1], UP: [-1, 0], DOWN: [1, 0] };
const onField = (p) => p && p.row != null && p.col != null;
const fewestWorn = (list) => [...list].sort((a, b) => pieceEquipmentCount(a) - pieceEquipmentCount(b) || String(a.uid).localeCompare(String(b.uid)))[0] || null;
/**
 * The operator a badge lands on: the maker itself; the one in front of it; of the four around it, the one wearing the
 * least; of the operators on the field sharing a faction with it, the one wearing the least; of everyone on the field,
 * the one wearing the least; of a named faction on the field (`faction:<阵营>`), the one wearing the least.
 * Nobody there → the maker.
 */
export function landingPiece(state, catalog, source, how = 'self') {
  if (typeof how === 'string' && how.startsWith('uid:')) {
    const uid = how.slice(4);
    const target = (state.pieces || []).find((p) => String(p.uid) === uid);
    if (!source || !onField(source) || source.removed || source.deleted || !target || !onField(target) || target.removed || target.deleted || (target.kind && target.kind !== 'op')
        || (target.playerId ?? target.ownerId) !== (source.playerId ?? source.ownerId)
        || !catalog?.operators?.[target.chessId]) throw new Error('BAD_LANDING_TARGET');
    return target;
  }
  if (!source || how === 'self' || !onField(source)) return source;
  const others = (state.pieces || []).filter((p) => p !== source && onField(p));
  let target = null;
  if (how === 'front') {
    const [dr, dc] = STEP[source.dir || 'RIGHT'] || STEP.RIGHT;
    target = others.find((p) => p.row === source.row + dr && p.col === source.col + dc) || null;
  } else if (how === 'adjacent') {
    target = fewestWorn(others.filter((p) => Math.abs(p.row - source.row) + Math.abs(p.col - source.col) === 1));
  } else if (how === 'factionLowest') {
    const mine = new Set(tavernFactions(source, catalog));
    target = fewestWorn([source, ...others].filter((p) => tavernFactions(p, catalog).some((f) => mine.has(f))));
  } else if (how === 'lowest') {
    target = fewestWorn([source, ...others]);
  } else if (String(how).startsWith('faction:')) {
    const f = String(how).slice(8);
    target = fewestWorn([source, ...others].filter((p) => tavernFactions(p, catalog).includes(f)));
  } else throw new Error(`BAD_LANDING ${how}`);
  return target || source;
}

export function grantEquipment(state, catalog, id, quantity = 1, extra = {}) {
  const def = equipmentRecord(catalog, id);
  if (!def || def.available === false || def.mechanism === 'disabled') throw new Error('UNKNOWN_EQUIPMENT');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('BAD_QUANTITY');
  // 徽章落点 (user 2026-10-06: 「徽章直接落点，装备进库存」): a badge an operator's own effect makes — its trait, its gear,
  // its attachment, a battle reward it earned — goes straight onto an operator instead of the stock. Prizes, supplies and
  // every other item still go to the stock. catalog.config.badgeLanding 'stock' (or unset) keeps the old flow.
  const landing = extra.landOn || catalog?.config?.badgeLanding || 'stock';
  const isBadge = !!rec(catalog?.badges, id) || def.mechanism === 'badge';
  const source = extra.sourceUid ? (state.pieces || []).find((p) => p.uid === extra.sourceUid) : null;
  const explicit = typeof landing === 'string' && landing.startsWith('uid:');
  if (explicit && (!isBadge || extra.origin !== 'native' || String(extra.targetUid) !== landing.slice(4))) throw new Error('BAD_LANDING_TARGET');
  const explicitTarget = explicit ? landingPiece(state, catalog, source, landing) : null;
  if (landing !== 'stock' && isBadge && source && LANDING_ORIGINS.has(extra.origin)) {
    const target = explicitTarget || landingPiece(state, catalog, source, landing);
    const add = Math.min(quantity, EQUIPMENT_CAPACITY - pieceEquipmentCount(target));
    if (add > 0) {
      const stack = (target.equipment ||= []).find((x) => x.id === id);
      if (stack) stack.quantity = Number(stack.quantity || 1) + add;
      else target.equipment.push(makeItem(state, id, add));
      recordProduction(state, { id, quantity: add, origin: extra.origin, phase: extra.phase, sourceUid: extra.sourceUid, copied: extra.copied, repeated: extra.repeated, worn: true, targetUid: target.uid });
    }
    if (add >= quantity) return { id, quantity, worn: target.uid };
    quantity -= add;
  }
  const add = Math.min(quantity, inventoryRoomFor(state, catalog, id, extra));
  const lost = quantity - add;
  let remaining = add;
  const key = inventoryStackKey({ id, state: extra.state || {} });
  for (const stack of state.inventory || []) {
    if (remaining <= 0) break;
    if (inventoryStackKey(stack) !== key || stack.quantity >= INVENTORY_STACK_LIMIT) continue;
    const n = Math.min(remaining, INVENTORY_STACK_LIMIT - stack.quantity);
    stack.quantity += n; remaining -= n;
  }
  while (remaining > 0) {
    const n = Math.min(remaining, INVENTORY_STACK_LIMIT);
    state.inventory.push(makeItem(state, id, n, { ...extra, sourceId: def.sourceId })); remaining -= n;
  }
  const production = { id, origin: extra.origin, phase: extra.phase, sourceUid: extra.sourceUid, targetUid: explicitTarget?.uid, prizeId: extra.prizeId, copied: extra.copied, repeated: extra.repeated };
  if (add) recordProduction(state, { ...production, quantity: add });
  if (lost) recordProduction(state, { ...production, quantity: lost, lost: true });
  return { id, quantity: add, ...(lost ? { lost } : {}) };
}

/**
 * Rounds of the production ledger a session keeps: the whole game (at most 15 rounds, a few hundred short rows), so the
 * production column can trace any round (user 10-07: 「安排一个完整的log可折叠追溯」).
 */
export const PRODUCTION_ROUNDS_KEPT = 16;
const PRODUCTION_FIELDS = ['origin', 'phase', 'sourceUid', 'prizeId', 'copied', 'repeated', 'lost', 'worn', 'targetUid'];

/**
 * Append one entry to `state.production`, the player-facing record of where inventory items came from. An entry
 * carries the revision the running action will commit (`applyAction` bumps it once), so a client can pick the
 * entries one action added. Rounds older than PRODUCTION_ROUNDS_KEPT are dropped; a session saved before the ledger existed
 * starts without one.
 */
export function recordProduction(state, entry) {
  if (!Array.isArray(state.production)) state.production = [];
  const row = { round: state.round, revision: Number(state.revision || 0) + 1, id: entry.id, quantity: entry.quantity };
  for (const key of PRODUCTION_FIELDS) if (entry[key] !== undefined && entry[key] !== null && entry[key] !== false) row[key] = entry[key];
  state.production.push(row);
  const keepFrom = state.round - PRODUCTION_ROUNDS_KEPT + 1;
  while (state.production.length && state.production[0].round < keepFrom) state.production.shift();
}

export function equipItem(state, catalog, itemUid, targetUid, quantity = 1, options = {}) {
  const pi = state.inventory.findIndex((x) => x.uid === itemUid);
  const target = state.pieces.find((x) => x.uid === targetUid);
  if (pi < 0 || !target || !Number.isInteger(quantity) || quantity < 1) throw new Error('BAD_TARGET');
  const item = state.inventory[pi]; const def = equipmentRecord(catalog, item.id);
  if (!def || def.available === false || def.mechanism === 'disabled' || quantity > item.quantity) throw new Error('BAD_QUANTITY');
  if (!['徽章', 'badge', '功能装备', '战斗装备', '生产装备', 'equipment', 'prizeGear'].includes(def.kind)) throw new Error('NOT_EQUIPPABLE');
  if (def.unique && quantity !== 1) throw new Error('UNIQUE_QUANTITY');
  if (quantity > 1 && !quantityEquippable(def)) throw new Error('SINGLE_EQUIP_ONLY');
  const usedByPieces = pieceEquipmentCount(target);
  if (usedByPieces + quantity > EQUIPMENT_CAPACITY) throw new Error('CAPACITY');
  if (def.unique && target.equipment.some((x) => {
    const other = equipmentRecord(catalog, x.id);
    return (other?.uniqueKey || other?.canonicalId || x.id) === (def.uniqueKey || def.canonicalId || item.id);
  })) throw new Error('UNIQUE');
  const movedState = structuredClone(item.state || {});
  if (def.mechanism === 'identityTag') {
    const factions = ['炎', '维多利亚', '拉特兰', '阿戈尔', '谢拉格', '萨尔贡', '叙拉古', '卡西米尔'];
    if (!factions.includes(options.faction)) throw new Error('BAD_FACTION');
    movedState.faction = options.faction;
  }
  const moved = { uid: `e${state.nextUid++}`, id: item.id, quantity, state: movedState };
  if (item.sourceId || def.sourceId) moved.sourceId = item.sourceId || def.sourceId;
  target.equipment.push(moved);
  item.quantity -= quantity;
  if (!item.quantity) state.inventory.splice(pi, 1);
  return moved;
}

/**
 * Gear has one form only (owner 2026-10-07 「装备不再有精锐形态」; the 两件合成精锐 action is gone). An old save's elite
 * item becomes the normal item with the same quantity; the same-id stacks this leaves side by side merge into the first
 * one — in the stock and on each piece. A unique item stays a separate item. Returns true when an elite item was found.
 */
export function normalizeGearForms(state, catalog = null) {
  const all = [...(state.inventory || []), ...(state.pieces || []).flatMap((p) => p.equipment || [])].filter(Boolean);
  // nothing elite: the save is left exactly as it is (an explicit elite: false is harmless)
  if (!all.some((x) => x.elite)) return false;
  const unique = (item) => !!item.state?.uniqueState || !!(catalog && equipmentRecord(catalog, item.id)?.unique);
  const flatten = (list) => {
    const out = []; const firstOf = new Map();
    for (const item of list || []) {
      if (item?.elite) delete item.elite;
      if (!item || unique(item)) { out.push(item); continue; }
      const key = inventoryStackKey(item);
      const first = firstOf.get(key);
      if (first) { first.quantity = Number(first.quantity || 1) + Number(item.quantity || 1); continue; }
      firstOf.set(key, item); out.push(item);
    }
    return out;
  };
  state.inventory = flatten(state.inventory);
  for (const piece of state.pieces || []) piece.equipment = flatten(piece.equipment);
  return true;
}

export function discardPieceAssets(state, piece) {
  const destroyed = [...(piece.equipment || []), ...(piece.attachments || [])];
  piece.equipment = []; piece.attachments = [];
  return destroyed;
}

export function totalEquipmentLevel(piece, catalog) {
  return (piece?.equipment || []).reduce((sum, item) => {
    const def = equipmentRecord(catalog, item.id);
    return sum + Math.max(0, Number((def?.level ?? def?.tier) || 0)) * Math.max(1, Number(item.quantity || 1));
  }, 0);
}
