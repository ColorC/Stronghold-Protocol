const own = (o, k) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k);
const rec = (map, id) => typeof id === 'string' && own(map, id) ? map[id] : null;
const number = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;

export const itemCount = (state) => (state.inventory || []).reduce((n, x) => n + Math.max(0, Math.floor(number(x.quantity, 1))), 0);
export const equippedCount = (state) => (state.pieces || []).reduce((n, p) => n + (p.equipment || []).reduce((m, x) => m + Math.max(0, Math.floor(number(x.quantity, 1))), 0), 0);
export const capacityUsed = (state) => itemCount(state);
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
  if (!def) throw new Error('UNKNOWN_EQUIPMENT');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('BAD_QUANTITY');
  const stack = !def.unique && (state.inventory || []).find((x) => x.id === id && !!x.elite === !!extra.elite && !x.state?.uniqueState);
  if (stack) stack.quantity += quantity;
  else state.inventory.push(makeItem(state, id, quantity, { ...extra, sourceId: def.sourceId }));
  return { id, quantity };
}

export function equipItem(state, catalog, itemUid, targetUid, quantity = 1) {
  const pi = state.inventory.findIndex((x) => x.uid === itemUid);
  const target = state.pieces.find((x) => x.uid === targetUid);
  if (pi < 0 || !target || !Number.isInteger(quantity) || quantity < 1) throw new Error('BAD_TARGET');
  const item = state.inventory[pi]; const def = equipmentRecord(catalog, item.id);
  if (!def || quantity > item.quantity) throw new Error('BAD_QUANTITY');
  const usedByPieces = pieceEquipmentCount(target);
  if (usedByPieces + quantity > 99) throw new Error('CAPACITY');
  if (def.unique && target.equipment.some((x) => {
    const other = equipmentRecord(catalog, x.id);
    return (other?.uniqueKey || other?.canonicalId || x.id) === (def.uniqueKey || def.canonicalId || item.id);
  })) throw new Error('UNIQUE');
  const moved = { uid: `e${state.nextUid++}`, id: item.id, elite: !!item.elite, quantity, state: structuredClone(item.state || {}) };
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
  if (!def || !(def.eliteId || def.eliteLevel)) throw new Error('NOT_MERGEABLE');
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
