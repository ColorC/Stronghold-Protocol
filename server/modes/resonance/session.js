const SCHEMA_VERSION = 1;
const BENCH_CAPACITY = 9;
const INVENTORY_CAPACITY = 20;
const SHOP_SIZE = 5;
const COPIES_BY_TIER = Object.freeze({ 1: 30, 2: 25, 3: 18, 4: 10, 5: 9 });
const XP_TO_LEVEL = Object.freeze({ 3: 6, 4: 10, 5: 20, 6: 36, 7: 56, 8: 68, 9: 68 });
const ODDS_BY_LEVEL = Object.freeze({
  3: [0.75,0.25,0,0,0], 4: [0.55,0.30,0.15,0,0], 5: [0.45,0.33,0.20,0.02,0],
  6: [0.30,0.40,0.25,0.05,0], 7: [0.16,0.30,0.43,0.10,0.01],
  8: [0.15,0.20,0.32,0.30,0.03], 9: [0.10,0.17,0.25,0.33,0.15], 10: [0.05,0.10,0.20,0.40,0.25],
});
const DEFAULT_ROUND_LIMIT = Object.freeze({ FUNNY: 28, NORMAL: 28, HARD: 28, ABYSS: 30 });
const own = (object, key) => !!object && Object.hasOwn(object, key);
const clone = (value) => structuredClone(value);
const opTable = (catalog) => catalog?.operators ?? {};
const itemTable = (catalog) => catalog?.equipment ?? {};
function activeOperatorIds(catalog) {
  const all = opTable(catalog);
  const configured = catalog?.config?.activeOperatorIds;
  if (configured === undefined) return Object.keys(all);
  if (!Array.isArray(configured) || new Set(configured).size !== configured.length
    || configured.some((id) => typeof id !== 'string' || !own(all, id))) throw new Error('BAD_ACTIVE_OPERATOR_IDS');
  return [...configured];
}
const fail = (state, error, events = []) => ({ ok: false, state: clone(state), events, error });
const isInt = (value) => Number.isInteger(value);

function seedNumber(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const text = String(seed ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  return hash >>> 0;
}

function random(state) {
  // Counter-based Mulberry32 step. The seed and counter are save data, so a resumed state repeats the exact stream.
  let value = (state.seed + Math.imul(state.rngCounter + 1, 0x6d2b79f5)) >>> 0;
  state.rngCounter++;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}
function weightedPick(state, entries, weight) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, weight(entry)), 0);
  if (!(total > 0)) return null;
  let roll = random(state) * total;
  for (const entry of entries) {
    roll -= Math.max(0, weight(entry));
    if (roll < 0) return entry;
  }
  return entries.at(-1) ?? null;
}
function uid(state, prefix) { return `${prefix}${state.nextUid++}`; }
function costOf(catalog, operatorId) { return Number(opTable(catalog)[operatorId]?.cost); }
function copiesForStar(star) { return star === 1 ? 1 : star === 2 ? 3 : 9; }
function availableIds(state, catalog, tier, excluded = new Set()) {
  return activeOperatorIds(catalog).filter((id) => Number(opTable(catalog)[id]?.cost) === tier && (state.poolRemaining[id] ?? 0) > 0 && !excluded.has(id))
    .map((id) => [id, opTable(catalog)[id]]);
}
function poolWeightedPick(state, catalog, tier, excluded = new Set()) {
  return weightedPick(state, availableIds(state, catalog, tier, excluded), ([id]) => state.poolRemaining[id] ?? 0);
}
function returnShop(state) {
  for (const offer of state.shop.offers) if (offer.operatorId) state.poolRemaining[offer.operatorId]++;
  state.shop.offers = [];
}
function drawShopOffer(state, catalog) {
  const tierOdds = ODDS_BY_LEVEL[state.level] ?? ODDS_BY_LEVEL[10];
  const tier = weightedPick(state, tierOdds.map((chance, index) => ({ tier: index + 1, chance })), (entry) => entry.chance)?.tier;
  const selected = tier ? poolWeightedPick(state, catalog, tier) : null;
  const offer = { uid: uid(state, 'o'), operatorId: selected?.[0] ?? null, cost: selected ? costOf(catalog, selected[0]) : null };
  if (selected) state.poolRemaining[selected[0]]--;
  return offer;
}
function fillShop(state, catalog) {
  state.shop.offers = Array.from({ length: SHOP_SIZE }, () => drawShopOffer(state, catalog));
}
function selectInitialStarterIds(state, catalog) {
  const configured = catalog.config?.starterIds;
  if (configured !== undefined) {
    if (!Array.isArray(configured) || configured.length !== 3 || new Set(configured).size !== 3) throw new Error('BAD_STARTER_IDS');
    if (configured.some((id) => !own(opTable(catalog), id) || !activeOperatorIds(catalog).includes(id) || Number(opTable(catalog)[id].cost) !== 1 || (state.poolRemaining[id] ?? 0) < 1)) throw new Error('STARTER_IDS_UNAVAILABLE');
    return [...configured];
  }
  const excluded = new Set();
  const all = activeOperatorIds(catalog).map((id) => [id, opTable(catalog)[id]])
    .filter(([id, operator]) => Number(operator?.cost) === 1 && state.poolRemaining[id] > 0);
  const melee = all.filter(([, operator]) => operator.position === 'MELEE');
  const ranged = all.filter(([, operator]) => operator.position === 'RANGED');
  const selected = [];
  if (melee.length >= 2 && ranged.length >= 1) {
    for (let count = 0; count < 2; count++) {
      const entry = weightedPick(state, melee.filter(([id]) => !excluded.has(id)), ([id]) => state.poolRemaining[id]);
      if (entry) { selected.push(entry[0]); excluded.add(entry[0]); }
    }
    const entry = weightedPick(state, ranged.filter(([id]) => !excluded.has(id)), ([id]) => state.poolRemaining[id]);
    if (entry) { selected.push(entry[0]); excluded.add(entry[0]); }
  }
  while (selected.length < 3) {
    const entry = poolWeightedPick(state, catalog, 1, excluded);
    if (!entry) throw new Error('STARTER_POOL_INSUFFICIENT');
    selected.push(entry[0]); excluded.add(entry[0]);
  }
  return selected;
}
function selectedStarterItems(state, catalog) {
  const configured = catalog.config?.starterEquipmentIds;
  if (configured !== undefined && (!Array.isArray(configured) || configured.length !== 2 || configured.some((id) => !own(itemTable(catalog), id) || itemTable(catalog)[id].kind !== 'component'))) throw new Error('BAD_STARTER_EQUIPMENT_IDS');
  const candidates = configured ?? Object.entries(itemTable(catalog)).filter(([, item]) => item.kind === 'component').map(([id]) => id);
  if (!candidates.length) throw new Error('STARTER_COMPONENTS_UNAVAILABLE');
  return configured ? [...configured] : Array.from({ length: 2 }, () => candidates[Math.floor(random(state) * candidates.length)]);
}
function makePiece(state, operatorId) {
  return { uid: uid(state, 'p'), operatorId, star: 1, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT' };
}
function createStarterState({ seed, difficulty, catalog, environmentId }) {
  if (!catalog || !opTable(catalog) || !itemTable(catalog) || !Array.isArray(catalog.recipes)) throw new Error('BAD_CATALOG');
  const selectedDifficulty = String(difficulty || 'NORMAL').toUpperCase();
  const roundLimit = DEFAULT_ROUND_LIMIT[selectedDifficulty];
  if (!roundLimit) throw new Error('BAD_DIFFICULTY');
  const state = {
    schemaVersion: SCHEMA_VERSION, revision: 0, seed: seedNumber(seed), rngCounter: 0,
    round: 1, roundLimit, difficulty: selectedDifficulty, phase: 'prep', level: 3, xp: 0, gold: 5, hp: 100,
    winStreak: 0, lossStreak: 0, shop: { offers: [], locked: false }, pieces: [], inventory: [],
    strategies: [], environmentId: environmentId ?? null,
    poolRemaining: Object.fromEntries(activeOperatorIds(catalog).map((id) => {
      const operator = opTable(catalog)[id];
      const cap = COPIES_BY_TIER[Number(operator.cost)];
      if (!cap) throw new Error(`BAD_OPERATOR_COST:${id}`);
      return [id, cap];
    })),
    nextUid: 1, history: [],
  };
  for (const id of selectInitialStarterIds(state, catalog)) {
    state.poolRemaining[id]--;
    state.pieces.push(makePiece(state, id));
  }
  for (const itemId of selectedStarterItems(state, catalog)) state.inventory.push({ uid: uid(state, 'i'), itemId });
  fillShop(state, catalog);
  return state;
}

export function createSession({ seed, difficulty = 'NORMAL', catalog, environmentId } = {}) {
  try {
    const state = createStarterState({ seed, difficulty, catalog, environmentId });
    const validation = validateSession(state, { catalog });
    if (!validation.ok) return { ok: false, state: null, events: [], error: validation.errors[0]?.code ?? 'INVALID_CREATED_SESSION' };
    return { ok: true, state, events: [{ type: 'session-created', difficulty: state.difficulty, roundLimit: state.roundLimit }] };
  } catch (error) {
    return { ok: false, state: null, events: [], error: error.message || 'CREATE_SESSION_FAILED' };
  }
}

export function validateSession(state, { catalog } = {}) {
  const errors = [];
  const add = (code, detail = null) => errors.push({ code, detail });
  if (!state || typeof state !== 'object' || Array.isArray(state)) return { ok: false, errors: [{ code: 'BAD_STATE', detail: null }] };
  if (!catalog || !opTable(catalog) || typeof opTable(catalog) !== 'object' || Array.isArray(opTable(catalog))
    || !itemTable(catalog) || typeof itemTable(catalog) !== 'object' || Array.isArray(itemTable(catalog))) return { ok: false, errors: [{ code: 'BAD_CATALOG', detail: null }] };
  let activeIds;
  try { activeIds = activeOperatorIds(catalog); }
  catch (error) { add(error.message || 'BAD_ACTIVE_OPERATOR_IDS'); activeIds = []; }
  const activeSet = new Set(activeIds);
  if (state.schemaVersion !== SCHEMA_VERSION) add('BAD_SCHEMA_VERSION');
  if (!isInt(state.revision) || state.revision < 0 || !isInt(state.seed) || !isInt(state.rngCounter) || state.rngCounter < 0) add('BAD_REVISION_OR_RNG');
  if (!isInt(state.round) || !isInt(state.roundLimit) || state.round < 1 || state.round > state.roundLimit) add('BAD_ROUND');
  if (!['prep','choice','complete'].includes(state.phase)) add('BAD_PHASE');
  else if (state.phase === 'complete' && state.hp > 0 && state.round < state.roundLimit) add('BAD_PHASE_TERMINAL');
  else if (state.phase === 'prep' && state.hp === 0) add('BAD_PHASE_TERMINAL');
  if (!isInt(state.nextUid) || state.nextUid < 1) add('BAD_NEXT_UID');
  if (!isInt(state.level) || state.level < 3 || state.level > 10 || !isInt(state.xp) || state.xp < 0) add('BAD_LEVEL_XP');
  else if ((state.level === 10 && state.xp !== 0) || (state.level < 10 && state.xp >= XP_TO_LEVEL[state.level])) add('XP_NOT_NORMALIZED');
  for (const field of ['gold','hp','winStreak','lossStreak']) if (!isInt(state[field]) || state[field] < 0) add('BAD_ECONOMY_FIELD', field);
  if (!state.shop || !Array.isArray(state.shop.offers) || state.shop.offers.length !== SHOP_SIZE || typeof state.shop.locked !== 'boolean') add('BAD_SHOP');
  const collectionsValid = Array.isArray(state.pieces) && Array.isArray(state.inventory) && Array.isArray(state.history) && Array.isArray(state.strategies);
  if (!collectionsValid) add('BAD_COLLECTION');
  if (Array.isArray(state.inventory) && state.inventory.length > INVENTORY_CAPACITY) add('INVENTORY_OVER_CAPACITY');
  if (!state.poolRemaining || typeof state.poolRemaining !== 'object' || Array.isArray(state.poolRemaining)) add('BAD_POOL');
  const uidSet = new Set();
  const trackUid = (id, context) => {
    if (typeof id !== 'string' || !id) add('BAD_UID', context);
    else if (uidSet.has(id)) add('DUPLICATE_UID', id);
    else uidSet.add(id);
  };
  for (const piece of Array.isArray(state.pieces) ? state.pieces : []) {
    if (!piece || typeof piece !== 'object' || Array.isArray(piece)) { add('BAD_PIECE'); continue; }
    trackUid(piece.uid, 'piece');
    if (!own(opTable(catalog), piece.operatorId)) add('UNKNOWN_OPERATOR', piece.operatorId);
    else if (!activeSet.has(piece.operatorId)) add('INACTIVE_OPERATOR', piece.operatorId);
    if (![1,2,3].includes(piece.star)) add('BAD_STAR', piece.uid);
    if (!Array.isArray(piece.equipment) || piece.equipment.length > 3) add('BAD_PIECE_EQUIPMENT', piece.uid);
    else for (const item of piece.equipment) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { add('BAD_EQUIPPED_ITEM', piece.uid); continue; }
      trackUid(item.uid, 'piece equipment');
      if (!own(itemTable(catalog), item.itemId)) add('UNKNOWN_EQUIPMENT', item.itemId);
    }
    if (!piece.growth || typeof piece.growth !== 'object' || Array.isArray(piece.growth)) add('BAD_GROWTH', piece.uid);
    if ((piece.row === null) !== (piece.col === null)) add('BAD_POSITION', piece.uid);
    if (piece.row !== null && (!isInt(piece.row) || !isInt(piece.col))) add('BAD_POSITION', piece.uid);
    if (!['UP','RIGHT','DOWN','LEFT'].includes(piece.dir)) add('BAD_DIRECTION', piece.uid);
  }
  for (const item of Array.isArray(state.inventory) ? state.inventory : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { add('BAD_INVENTORY_ITEM'); continue; }
    trackUid(item.uid, 'inventory');
    if (!own(itemTable(catalog), item.itemId)) add('UNKNOWN_EQUIPMENT', item.itemId);
  }
  const offers = Array.isArray(state.shop?.offers) ? state.shop.offers : [];
  for (const offer of offers) {
    if (!offer || typeof offer !== 'object' || Array.isArray(offer)) { add('BAD_OFFER'); continue; }
    trackUid(offer.uid, 'offer');
    if (offer.operatorId !== null && !own(opTable(catalog), offer.operatorId)) add('UNKNOWN_OFFER_OPERATOR', offer.operatorId);
    else if (offer.operatorId !== null && !activeSet.has(offer.operatorId)) add('INACTIVE_OFFER_OPERATOR', offer.operatorId);
    else if (offer.operatorId !== null && offer.cost !== costOf(catalog, offer.operatorId)) add('OFFER_COST_MISMATCH', offer.uid);
  }
  const pieces = Array.isArray(state.pieces) ? state.pieces.filter((piece) => piece && typeof piece === 'object') : [];
  if (pieces.filter((piece) => piece.row === null && piece.col === null).length > BENCH_CAPACITY) add('BENCH_OVER_CAPACITY');
  const deployed = pieces.filter((piece) => piece.row !== null);
  if (deployed.length > state.level) add('POPULATION_OVER_CAPACITY');
  const cells = new Set();
  for (const piece of deployed) {
    const key = `${piece.row},${piece.col}`;
    if (cells.has(key)) add('DUPLICATE_DEPLOYMENT_CELL', key);
    cells.add(key);
  }
  for (const id of activeIds) {
    const operator = opTable(catalog)[id];
    const cap = COPIES_BY_TIER[Number(operator.cost)];
    const remaining = state.poolRemaining?.[id];
    if (!isInt(remaining) || remaining < 0 || remaining > cap) add('BAD_POOL_REMAINING', id);
    const heldOffers = offers.filter((offer) => offer && typeof offer === 'object' && offer.operatorId === id).length;
    const heldPieces = pieces.filter((piece) => piece.operatorId === id).reduce((sum, piece) => sum + (copiesForStar(piece.star) || 0), 0);
    if (Number.isInteger(remaining) && remaining + heldOffers + heldPieces !== cap) add('POOL_CONSERVATION', { id, cap, remaining, heldOffers, heldPieces });
  }
  for (const id of Object.keys(state.poolRemaining ?? {})) if (!activeSet.has(id)) add('INACTIVE_POOL_ID', id);
  for (const id of activeIds) if (!own(state.poolRemaining, id)) add('MISSING_POOL_ID', id);
  return { ok: errors.length === 0, errors };
}

function getFieldCells(fieldResolver, state, catalog) {
  if (typeof fieldResolver !== 'function') return { known: false, cells: null };
  const result = fieldResolver(clone(state), { catalog });
  if (result instanceof Map) return { known: true, cells: result };
  if (result?.deployMap instanceof Map) return { known: true, cells: result.deployMap };
  if (Array.isArray(result?.legalCells)) return { known: true, cells: result.legalCells };
  return { known: true, cells: [] };
}
function cellClass(value) {
  const raw = typeof value === 'string' ? value : value?.class ?? value?.type ?? value?.position ?? value?.kind;
  if (typeof raw !== 'string') return null;
  const normalized = raw.toLowerCase();
  return normalized === 'melee' ? 'MELEE' : normalized === 'ranged' ? 'RANGED' : null;
}
function findCell(cells, row, col) {
  if (cells instanceof Map) {
    for (const key of [`${row},${col}`, `${row}:${col}`, JSON.stringify([row,col])]) {
      if (cells.has(key)) return { found: true, value: cells.get(key), fromMap: true };
    }
    return { found: false, value: null, fromMap: true };
  }
  const cell = cells.find((entry) => Array.isArray(entry)
    ? entry[0] === row && entry[1] === col
    : entry?.row === row && entry?.col === col);
  return { found: cell !== undefined, value: Array.isArray(cell) ? cell[2] ?? cell[3] : cell, fromMap: false };
}
function cellIsLegal(fieldResolver, state, catalog, row, col) {
  const field = getFieldCells(fieldResolver, state, catalog);
  const cell = field.known ? findCell(field.cells, row, col) : { found: false };
  return { ...field, ...cell, legal: field.known && cell.found && cell.value !== false && cell.value !== null };
}
function canDeployAt(cells, row, col, operator) {
  const cell = findCell(cells, row, col);
  if (!cell.found || cell.value === false || cell.value === null) return false;
  const type = cellClass(cell.value);
  if (cell.fromMap && !type) return false;
  if (operator?.position === 'RANGED') return true;
  if (operator?.position !== 'MELEE') return false;
  return type === 'MELEE' || (type === 'RANGED' && operator.canDeployHighGround === true);
}

export function viewSession(state, { catalog, fieldResolver } = {}) {
  const validation = validateSession(state, { catalog });
  if (!validation.ok) return { ok: false, errors: validation.errors };
  let fieldStatus = 'unknown';
  let legalCells = null;
  if (typeof fieldResolver === 'function') {
    try {
      const resolved = getFieldCells(fieldResolver, state, catalog);
      fieldStatus = resolved.known ? 'resolved' : 'unknown';
      legalCells = resolved.cells instanceof Map ? [...resolved.cells.keys()] : resolved.cells;
    } catch (error) { fieldStatus = 'error'; }
  }
  return {
    ok: true,
    revision: state.revision, round: state.round, roundLimit: state.roundLimit, difficulty: state.difficulty,
    phase: state.phase, level: state.level, xp: state.xp, gold: state.gold, hp: state.hp,
    winStreak: state.winStreak, lossStreak: state.lossStreak, shop: clone(state.shop),
    pieces: clone(state.pieces), inventory: clone(state.inventory), poolRemaining: clone(state.poolRemaining),
    benchCount: state.pieces.filter((piece) => piece.row === null).length,
    deployedCount: state.pieces.filter((piece) => piece.row !== null).length,
    legalFieldStatus: fieldStatus, legalCells,
  };
}

function requirePrep(state) { if (state.phase !== 'prep') throw new Error('WRONG_PHASE'); }
function pieceByUid(state, id) { return state.pieces.find((piece) => piece.uid === id) ?? null; }
function benchCount(state) { return state.pieces.filter((piece) => piece.row === null).length; }
function streakBonus(count) { return count >= 6 ? 3 : count >= 5 ? 2 : count >= 2 ? 1 : 0; }
export function calculateRoundIncome({ gold, round, won, winStreak, lossStreak }) {
  const winBonus = won ? 1 : 0;
  const streak = streakBonus(won ? winStreak : lossStreak);
  const interest = Math.min(5, Math.floor((gold + winBonus) / 10));
  const income = round === 1 ? 4 : 5;
  return { income, winBonus, streakBonus: streak, interest, goldAfter: gold + income + winBonus + streak + interest };
}
function applyXp(state, amount) {
  state.xp += amount;
  while (state.level < 10) {
    const cost = XP_TO_LEVEL[state.level];
    if (state.xp < cost) break;
    state.xp -= cost;
    state.level++;
  }
  if (state.level === 10) state.xp = 0;
}
function mergeAvailable(state, operatorId, star, incoming = false) {
  const count = state.pieces.filter((piece) => piece.operatorId === operatorId && piece.star === star).length + Number(incoming);
  return star < 3 && count >= 3;
}
function mergeOperatorCopies(state, catalog, preferredUid = null) {
  const events = [];
  let merged = true;
  while (merged) {
    merged = false;
    const candidates = [...new Set(state.pieces.filter((piece) => piece.star < 3).map((piece) => `${piece.operatorId}|${piece.star}`))];
    for (const key of candidates) {
      const [operatorId, starText] = key.split('|');
      const star = Number(starText);
      const all = state.pieces.filter((piece) => piece.operatorId === operatorId && piece.star === star);
      if (all.length < 3) continue;
      const keep = all.find((piece) => piece.uid === preferredUid)
        ?? all.find((piece) => piece.row !== null)
        ?? all[0];
      const group = [keep, ...all.filter((piece) => piece !== keep)].slice(0,3);
      const removed = group.filter((piece) => piece !== keep);
      const allEquipment = [
        ...keep.equipment,
        ...removed.flatMap((piece) => piece.equipment),
      ];
      const retainedEquipment = allEquipment.slice(0,3);
      const overflow = allEquipment.slice(3);
      if (state.inventory.length + overflow.length > INVENTORY_CAPACITY) throw new Error('INVENTORY_CAPACITY');
      state.inventory.push(...overflow);
      keep.equipment = retainedEquipment;
      keep.star++;
      state.pieces = state.pieces.filter((piece) => !removed.includes(piece));
      events.push({ type: 'operator-merged', operatorId, uid: keep.uid, star: keep.star, consumedUids: removed.map((piece) => piece.uid), equipmentReturned: overflow.length });
      merged = true;
      break;
    }
  }
  return events;
}
function drawOffer(state, catalog) {
  const odds = ODDS_BY_LEVEL[state.level] ?? ODDS_BY_LEVEL[10];
  const tier = weightedPick(state, odds.map((chance,index)=>({tier:index+1,chance})), (entry)=>entry.chance)?.tier ?? null;
  const chosen = tier ? poolWeightedPick(state,catalog,tier) : null;
  const offer = { uid: uid(state,'o'), operatorId: chosen?.[0] ?? null, cost: chosen ? costOf(catalog,chosen[0]) : null };
  if (chosen) state.poolRemaining[chosen[0]]--;
  return offer;
}
function refreshShop(state, catalog) {
  returnShop(state);
  fillShop(state,catalog);
}
function findEquipment(state, itemUid) {
  const inventoryIndex = state.inventory.findIndex((item) => item.uid === itemUid);
  if (inventoryIndex >= 0) return { kind:'inventory', index:inventoryIndex, item:state.inventory[inventoryIndex], owner:null };
  for (const piece of state.pieces) {
    const index = piece.equipment.findIndex((item) => item.uid === itemUid);
    if (index >= 0) return { kind:'piece', index, item:piece.equipment[index], owner:piece };
  }
  return null;
}
function consumeEquipmentLocation(state, found) {
  if (found.kind === 'inventory') state.inventory.splice(found.index,1);
  else found.owner.equipment.splice(found.index,1);
}
function fixedRecipe(catalog, firstId, secondId) {
  return catalog.recipes.find((recipe) => recipe.parts?.length === 2
    && ((recipe.parts[0] === firstId && recipe.parts[1] === secondId)
      || (recipe.parts[0] === secondId && recipe.parts[1] === firstId)));
}
function resolveDeployedField(state, catalog, fieldResolver) {
  if (typeof fieldResolver !== 'function') throw new Error('FIELD_RESOLVER_REQUIRED');
  const resolved = getFieldCells(fieldResolver,state,catalog);
  if (!resolved.known) throw new Error('FIELD_RESOLVER_INVALID');
  return resolved.cells;
}
function settleFight(state, catalog, action, { battleRunner, fieldResolver, recording }) {
  requirePrep(state);
  const deployed = state.pieces.filter((piece) => piece.row !== null);
  if (!deployed.length) throw new Error('NO_DEPLOYED_PIECES');
  if (deployed.length > state.level) throw new Error('POPULATION_OVER_CAPACITY');
  const cells = resolveDeployedField(state,catalog,fieldResolver);
  for (const piece of deployed) if (!canDeployAt(cells,piece.row,piece.col,opTable(catalog)[piece.operatorId])) throw new Error('ILLEGAL_DEPLOYMENT');
  if (typeof battleRunner !== 'function') throw new Error('BATTLE_RUNNER_REQUIRED');
  const battleInput = clone(state);
  let result;
  try { result = battleRunner(battleInput,{catalog,recording}); }
  catch (error) { throw new Error(`BATTLE_RUNNER_FAILED:${error?.message ?? 'unknown'}`); }
  if (!result || typeof result.won !== 'boolean' || !Number.isFinite(result.hpLoss) || result.hpLoss < 0) throw new Error('BAD_BATTLE_RESULT');
  if (Number(result.diagnostics?.errorCount ?? 0) !== 0) throw new Error('BATTLE_DIAGNOSTICS');
  const events = [];
  const previousGold = state.gold;
  state.hp = Math.max(0,state.hp-Math.floor(result.hpLoss));
  if (result.growth?.length) {
    for (const growth of result.growth) {
      const piece = pieceByUid(state,growth.pieceUid);
      if (!piece || !Number.isFinite(growth.amount) || typeof growth.key !== 'string') continue;
      piece.growth[growth.key] = Number(piece.growth[growth.key] ?? 0)+growth.amount;
    }
  }
  if (result.won) { state.winStreak++; state.lossStreak=0; }
  else { state.winStreak=0; state.lossStreak++; }
  const incomeDetails = calculateRoundIncome({ gold: previousGold, round: state.round, won: result.won, winStreak: state.winStreak, lossStreak: state.lossStreak });
  state.gold = incomeDetails.goldAfter;
  const { income, winBonus, streakBonus: streak, interest } = incomeDetails;
  applyXp(state,2);
  const terminalReason = state.hp <= 0 ? 'hp-depleted'
    : state.round >= state.roundLimit ? (result.won ? 'victory' : 'round-limit-loss') : null;
  const event = { type:'fight-settled', round:state.round, won:result.won, hpLoss:Math.floor(result.hpLoss), income,
    winBonus, streakBonus:streak, interest, goldBefore:previousGold, goldAfter:state.gold, xpAfter:state.xp, levelAfter:state.level,
    terminalReason, result:result.result ?? null, diagnostics:result.diagnostics ?? null };
  const compactHistoryEvent = { ...event };
  delete compactHistoryEvent.result;
  delete compactHistoryEvent.diagnostics;
  state.history.push(compactHistoryEvent);
  events.push({ ...event });
  if (terminalReason) state.phase='complete';
  else {
    state.round++;
    if (state.shop.locked) state.shop.locked=false;
    else refreshShop(state,catalog);
  }
  return { events, replay: result.replay ?? null };
}

export function applyAction(state, action, { catalog, battleRunner, fieldResolver, recording = true } = {}) {
  if (!state || !action || typeof action !== 'object') return fail(state ?? {},'BAD_ACTION');
  const valid = validateSession(state,{catalog});
  if (!valid.ok) return fail(state,'INVALID_STATE',valid.errors);
  if (action.expectedRevision !== undefined && action.expectedRevision !== state.revision) return fail(state,'STALE_REVISION');
  const draft = clone(state);
  const events = [];
  let replay;
  try {
    switch (action.type) {
      case 'refresh': {
        requirePrep(draft); if (draft.gold < 2) throw new Error('NOT_ENOUGH_GOLD'); draft.gold-=2; refreshShop(draft,catalog); events.push({type:'shop-refreshed',cost:2}); break;
      }
      case 'lockShop': {
        requirePrep(draft); if (typeof action.locked !== 'boolean') throw new Error('BAD_LOCK_VALUE'); draft.shop.locked=action.locked; events.push({type:'shop-lock-changed',locked:action.locked}); break;
      }
      case 'buyXp': {
        requirePrep(draft); if (draft.level>=10) throw new Error('MAX_LEVEL'); if (draft.gold<4) throw new Error('NOT_ENOUGH_GOLD'); draft.gold-=4; applyXp(draft,4); events.push({type:'xp-purchased',gold:4,xp:4,level:draft.level,remainingXp:draft.xp}); break;
      }
      case 'buy': {
        requirePrep(draft); const offerIndex=draft.shop.offers.findIndex((offer)=>offer.uid===action.offerUid);
        if (offerIndex<0) throw new Error('OFFER_NOT_FOUND'); const offer=draft.shop.offers[offerIndex];
        if (!offer.operatorId) throw new Error('EMPTY_OFFER'); if (draft.gold<offer.cost) throw new Error('NOT_ENOUGH_GOLD');
        if (action.mergeTargetUid) {
          const target=pieceByUid(draft,action.mergeTargetUid);
          if (!target||target.operatorId!==offer.operatorId||target.star>=3) throw new Error('BAD_MERGE_TARGET');
        }
        const willMerge=mergeAvailable(draft,offer.operatorId,1,true);
        if (!willMerge&&benchCount(draft)>=BENCH_CAPACITY) throw new Error('BENCH_FULL');
        draft.gold-=offer.cost; draft.shop.offers.splice(offerIndex,1,{uid:uid(draft,'o'),operatorId:null,cost:null});
        const piece=makePiece(draft,offer.operatorId); draft.pieces.push(piece);
        events.push({type:'operator-bought',operatorId:offer.operatorId,uid:piece.uid,cost:offer.cost});
        events.push(...mergeOperatorCopies(draft,catalog,action.mergeTargetUid??null));
        break;
      }
      case 'sell': {
        requirePrep(draft); const piece=pieceByUid(draft,action.pieceUid); if(!piece) throw new Error('PIECE_NOT_FOUND');
        const unitCost=costOf(catalog,piece.operatorId), refund=piece.star===1?unitCost:unitCost===1?copiesForStar(piece.star):copiesForStar(piece.star)*unitCost-1;
        if (draft.inventory.length+piece.equipment.length>INVENTORY_CAPACITY) throw new Error('INVENTORY_CAPACITY');
        draft.inventory.push(...piece.equipment); draft.pieces=draft.pieces.filter((entry)=>entry!==piece);
        draft.poolRemaining[piece.operatorId]+=copiesForStar(piece.star); draft.gold+=refund;
        events.push({type:'operator-sold',operatorId:piece.operatorId,uid:piece.uid,star:piece.star,refund,copiesReturned:copiesForStar(piece.star)}); break;
      }
      case 'deploy': {
        requirePrep(draft); const piece=pieceByUid(draft,action.pieceUid); if(!piece) throw new Error('PIECE_NOT_FOUND');
        if (piece.row!==null) throw new Error('PIECE_ALREADY_DEPLOYED'); if (draft.pieces.filter((entry)=>entry.row!==null).length>=draft.level) throw new Error('POPULATION_OVER_CAPACITY');
        if (!isInt(action.row)||!isInt(action.col)||!['UP','RIGHT','DOWN','LEFT'].includes(action.dir)) throw new Error('BAD_POSITION');
        const check=cellIsLegal(fieldResolver,draft,catalog,action.row,action.col); if(!check.known)throw new Error('FIELD_RESOLVER_REQUIRED');if(!check.legal||!canDeployAt(check.cells,action.row,action.col,opTable(catalog)[piece.operatorId]))throw new Error('ILLEGAL_DEPLOYMENT');
        if(draft.pieces.some((entry)=>entry.row===action.row&&entry.col===action.col))throw new Error('CELL_OCCUPIED');
        piece.row=action.row;piece.col=action.col;piece.dir=action.dir;events.push({type:'piece-deployed',uid:piece.uid,row:piece.row,col:piece.col,dir:piece.dir});break;
      }
      case 'bench': {
        requirePrep(draft);const piece=pieceByUid(draft,action.pieceUid);if(!piece)throw new Error('PIECE_NOT_FOUND');if(piece.row===null)throw new Error('PIECE_ALREADY_BENCHED');piece.row=null;piece.col=null;events.push({type:'piece-benched',uid:piece.uid});break;
      }
      case 'turn': {
        requirePrep(draft);const piece=pieceByUid(draft,action.pieceUid);if(!piece)throw new Error('PIECE_NOT_FOUND');if(!['UP','RIGHT','DOWN','LEFT'].includes(action.dir))throw new Error('BAD_DIRECTION');piece.dir=action.dir;events.push({type:'piece-turned',uid:piece.uid,dir:piece.dir});break;
      }
      case 'equip': {
        requirePrep(draft);const piece=pieceByUid(draft,action.pieceUid);if(!piece)throw new Error('PIECE_NOT_FOUND');const index=draft.inventory.findIndex((item)=>item.uid===action.itemUid);if(index<0)throw new Error('ITEM_NOT_IN_INVENTORY');if(piece.equipment.length>=3)throw new Error('EQUIPMENT_CAPACITY');const item=draft.inventory.splice(index,1)[0];piece.equipment.push(item);events.push({type:'item-equipped',uid:item.uid,pieceUid:piece.uid,itemId:item.itemId});break;
      }
      case 'unequip': {
        requirePrep(draft);const found=findEquipment(draft,action.itemUid);if(!found||found.kind!=='piece')throw new Error('EQUIPPED_ITEM_NOT_FOUND');if(draft.inventory.length>=INVENTORY_CAPACITY)throw new Error('INVENTORY_CAPACITY');consumeEquipmentLocation(draft,found);draft.inventory.push(found.item);events.push({type:'item-unequipped',uid:found.item.uid,pieceUid:found.owner.uid,itemId:found.item.itemId});break;
      }
      case 'recycleEquipment': {
        requirePrep(draft);const found=findEquipment(draft,action.itemUid);if(!found)throw new Error('ITEM_NOT_FOUND');consumeEquipmentLocation(draft,found);events.push({type:'equipment-recycled',uid:found.item.uid,itemId:found.item.itemId,pieceUid:found.owner?.uid??null});break;
      }
      case 'combine': {
        requirePrep(draft);if(!Array.isArray(action.itemUids)||action.itemUids.length!==2||new Set(action.itemUids).size!==2)throw new Error('BAD_RECIPE_INPUTS');
        const found=action.itemUids.map((id)=>findEquipment(draft,id));if(found.some((entry)=>!entry))throw new Error('RECIPE_ITEM_NOT_FOUND');
        const owners=new Set(found.filter((entry)=>entry.owner).map((entry)=>entry.owner.uid));if(owners.size>1)throw new Error('CROSS_OPERATOR_COMBINE');
        const recipe=fixedRecipe(catalog,found[0].item.itemId,found[1].item.itemId);if(!recipe)throw new Error('RECIPE_NOT_FOUND');if(!own(itemTable(catalog),recipe.resultId))throw new Error('RECIPE_RESULT_UNKNOWN');
        const equippedOwner=found.find((entry)=>entry.owner)?.owner??null;
        for(const entry of [...found].sort((a,b)=>b.index-a.index))consumeEquipmentLocation(draft,entry);
        const resultItem={uid:uid(draft,'i'),itemId:recipe.resultId};if(equippedOwner)equippedOwner.equipment.push(resultItem);else draft.inventory.push(resultItem);
        events.push({type:'equipment-combined',itemIds:found.map((entry)=>entry.item.itemId),resultId:recipe.resultId,uid:resultItem.uid,pieceUid:equippedOwner?.uid??null});break;
      }
      case 'fight': {
        const result=settleFight(draft,catalog,action,{battleRunner,fieldResolver,recording});events.push(...result.events);replay=result.replay;break;
      }
      default: throw new Error('UNKNOWN_ACTION');
    }
    draft.revision++;
    draft.history.push(...events.filter((event)=>event.type!=='fight-settled').map((event)=>({round:draft.round,...event})));
    const after=validateSession(draft,{catalog});if(!after.ok)throw new Error(`INVALID_RESULT:${after.errors[0]?.code}`);
    return {ok:true,state:draft,events,...(action.type==='fight'?{replay:recording?replay:null}:{})};
  } catch(error) {
    return fail(state,error.message||'ACTION_FAILED');
  }
}

export const resonanceRules = Object.freeze({ benchCapacity: BENCH_CAPACITY, inventoryCapacity: INVENTORY_CAPACITY, shopSize: SHOP_SIZE, copiesByTier: COPIES_BY_TIER, xpToLevel: XP_TO_LEVEL, oddsByLevel: ODDS_BY_LEVEL, roundLimits: DEFAULT_ROUND_LIMIT });
