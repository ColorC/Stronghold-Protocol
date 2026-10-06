const own = (o, k) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k);
const rec = (map, id) => typeof id === 'string' && own(map, id) ? map[id] : null;
const number = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;

export const itemCount = (state) => (state.inventory || []).reduce((n, x) => n + Math.max(0, Math.floor(number(x.quantity, 1))), 0);
export const equippedCount = (state) => (state.pieces || []).reduce((n, p) => n + (p.equipment || []).reduce((m, x) => m + Math.max(0, Math.floor(number(x.quantity, 1))), 0), 0);
export const capacityUsed = (state) => itemCount(state);
/** Pieces of gear one operator may wear (2026-10-06: raised from 99). Inventory has no limit. */
export const EQUIPMENT_CAPACITY = 999;
/**
 * Kinds of gear the stock holds at once (2026-10-06): one tile per item and grade (normal / elite), however many it
 * holds, so a badge stack is one tile. A prize kept for later is not gear and takes no tile. Gear that would need a
 * new tile while all are taken is not stored (its production row says lost); a save holding more keeps them.
 */
export const INVENTORY_CAPACITY = 20;
const tileKey = (item) => `${item.id}:${item.elite ? 'elite' : 'normal'}`;
export function inventoryTiles(state, catalog) {
  return new Set((state.inventory || []).filter((x) => !catalog || equipmentRecord(catalog, x.id)).map(tileKey)).size;
}
export function hasTileFor(state, catalog, id, elite = false) {
  return (state.inventory || []).some((x) => tileKey(x) === tileKey({ id, elite })) || inventoryTiles(state, catalog) < INVENTORY_CAPACITY;
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
  const item = { uid: `i${state.nextUid++}`, id, elite: !!extra.elite, quantity, state: structuredClone(extra.state || {}) };
  if (extra.sourceId) item.sourceId = extra.sourceId;
  return item;
}

export function grantEquipment(state, catalog, id, quantity = 1, extra = {}) {
  const def = equipmentRecord(catalog, id);
  if (!def || def.available === false || def.mechanism === 'disabled') throw new Error('UNKNOWN_EQUIPMENT');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('BAD_QUANTITY');
  if (!hasTileFor(state, catalog, id, !!extra.elite)) {
    recordProduction(state, { id, quantity, elite: !!extra.elite, origin: extra.origin, phase: extra.phase, sourceUid: extra.sourceUid, prizeId: extra.prizeId, copied: extra.copied, repeated: extra.repeated, lost: true });
    return { id, quantity: 0, lost: quantity };
  }
  const stack = !def.unique && (state.inventory || []).find((x) => x.id === id && !!x.elite === !!extra.elite && !x.state?.uniqueState);
  if (stack) stack.quantity += quantity;
  else state.inventory.push(makeItem(state, id, quantity, { ...extra, sourceId: def.sourceId }));
  recordProduction(state, { id, quantity, elite: !!extra.elite, origin: extra.origin, phase: extra.phase, sourceUid: extra.sourceUid, prizeId: extra.prizeId, copied: extra.copied, repeated: extra.repeated });
  return { id, quantity };
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
  if (entry.elite) row.elite = true;
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
  const moved = { uid: `e${state.nextUid++}`, id: item.id, elite: !!item.elite, quantity, state: movedState };
  if (item.sourceId || def.sourceId) moved.sourceId = item.sourceId || def.sourceId;
  target.equipment.push(moved);
  item.quantity -= quantity;
  if (!item.quantity) state.inventory.splice(pi, 1);
  return moved;
}

export function mergeItems(state, catalog, firstUid, secondUid) {
  const a = state.inventory.find((x) => x.uid === firstUid); const b = state.inventory.find((x) => x.uid === secondUid);
  if (!a || !b || a.id !== b.id || a.elite || b.elite || (a === b && a.quantity < 2)) throw new Error('BAD_MERGE');
  const def = equipmentRecord(catalog, a.id);
  if (!def || def.available === false || def.mechanism === 'disabled' || !(def.eliteId || def.eliteLevel)) throw new Error('NOT_MERGEABLE');
  // the elite copy needs a tile unless one exists or the two normal copies were the last of theirs
  const normalLeft = state.inventory.filter((x) => x.id === a.id && !x.elite).reduce((n, x) => n + x.quantity, 0) - 2;
  if (!state.inventory.some((x) => x.id === a.id && x.elite) && normalLeft > 0 && inventoryTiles(state, catalog) >= INVENTORY_CAPACITY) throw new Error('INVENTORY_FULL');
  const leftA = a.quantity - (a === b ? 2 : 1); const leftB = a === b ? 0 : b.quantity - 1;
  if (leftA === 0) state.inventory.splice(state.inventory.indexOf(a), 1); else a.quantity = leftA;
  if (a !== b) { if (leftB === 0) state.inventory.splice(state.inventory.indexOf(b), 1); else b.quantity = leftB; }
  const result = makeItem(state, a.id, 1, { elite: true, sourceId: a.sourceId || def.sourceId }); state.inventory.push(result);
  return result;
}

export function discardPieceAssets(state, piece) {
  const destroyed = [...(piece.equipment || []), ...(piece.attachments || [])];
  piece.equipment = []; piece.attachments = [];
  return destroyed;
}

export function totalEquipmentLevel(piece, catalog) {
  return (piece?.equipment || []).reduce((sum, item) => {
    const def = equipmentRecord(catalog, item.id);
    return sum + Math.max(0, Number(item.elite ? (def?.eliteLevel ?? def?.level) : (def?.level ?? def?.tier) || 0)) * Math.max(1, Number(item.quantity || 1));
  }, 0);
}
