import { legalSummonCells,selectedSummonIds } from './summons.js';
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
function validEnvironmentId(catalog,environmentId) {
  const environments=catalog?.environments;
  if(environmentId==null||!environments||!Object.keys(environments).length)return true;
  return own(environments,environmentId)||own(environments,`origin_${environmentId}`);
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
  const tierOdds = [...(campaignOf(catalog).shopOdds?.[state.level] ?? ODDS_BY_LEVEL[state.level] ?? ODDS_BY_LEVEL[10])].map((value)=>Number(value));
  if(activeStrategyEntries(state).some(([id])=>strategyDefs(catalog)[id]?.effects?.some((effect)=>effect.kind==='low_cost_specialist'&&Number(effect.params?.forbidCost)===5)))tierOdds[4]=0;
  const total=tierOdds.reduce((sum,value)=>sum+value,0);if(total>0&&Math.abs(total-1)>0.01&&total>1.01)for(let i=0;i<tierOdds.length;i++)tierOdds[i]/=100;
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
  if(!validEnvironmentId(catalog,environmentId))throw new Error('UNKNOWN_ENVIRONMENT');
  const selectedDifficulty = String(difficulty || 'NORMAL').toUpperCase();
  const roundLimit = DEFAULT_ROUND_LIMIT[selectedDifficulty];
  if (!roundLimit) throw new Error('BAD_DIFFICULTY');
  const state = {
    schemaVersion: SCHEMA_VERSION, revision: 0, seed: seedNumber(seed), rngCounter: 0,
    round: 1, roundLimit, difficulty: selectedDifficulty, phase: 'prep', level: 3, xp: 0, gold: 5, hp: 100,
    winStreak: 0, lossStreak: 0, shop: { offers: [], locked: false }, pieces: [], inventory: [],
    strategies: [], environmentId: environmentId==null?(catalog.config?.environmentId??null)
      :own(catalog.environments??{},environmentId)?environmentId
        :own(catalog.environments??{},`origin_${environmentId}`)?`origin_${environmentId}`:environmentId,
    activeOperatorIds: activeOperatorIds(catalog), pendingChoices: [], consumables: [], strategyState: {},
    claimedNodes: [1], nodeStarted: true, forgeProgress: {},
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
  if(!validEnvironmentId(catalog,state.environmentId))add('UNKNOWN_ENVIRONMENT');
  if (state.schemaVersion !== SCHEMA_VERSION) add('BAD_SCHEMA_VERSION');
  if (!isInt(state.revision) || state.revision < 0 || !isInt(state.seed) || !isInt(state.rngCounter) || state.rngCounter < 0) add('BAD_REVISION_OR_RNG');
  if (!isInt(state.round) || !isInt(state.roundLimit) || state.round < 1 || state.round > state.roundLimit) add('BAD_ROUND');
  if (DEFAULT_ROUND_LIMIT[state.difficulty] !== state.roundLimit) add('BAD_ROUND_LIMIT');
  if (!Array.isArray(state.activeOperatorIds) || state.activeOperatorIds.length !== activeIds.length
    || state.activeOperatorIds.some((id,index)=>id!==activeIds[index])) add('ACTIVE_POOL_MISMATCH');
  if (typeof state.nodeStarted !== 'boolean') add('BAD_NODE_STATE');
  if (!['prep','choice','complete'].includes(state.phase)) add('BAD_PHASE');
  else if (state.phase==='choice'&&Array.isArray(state.pendingChoices)&&state.pendingChoices.length===0) add('EMPTY_CHOICE_PHASE');
  else if (state.phase==='prep'&&Array.isArray(state.pendingChoices)&&state.pendingChoices.length>0) add('PENDING_CHOICE_PHASE_MISMATCH');
  else if (state.phase === 'complete' && state.hp > 0 && state.round < state.roundLimit) add('BAD_PHASE_TERMINAL');
  else if (state.phase === 'prep' && state.hp === 0) add('BAD_PHASE_TERMINAL');
  if (!isInt(state.nextUid) || state.nextUid < 1) add('BAD_NEXT_UID');
  if (!isInt(state.level) || state.level < 3 || state.level > 10 || !isInt(state.xp) || state.xp < 0) add('BAD_LEVEL_XP');
  else if ((state.level === 10 && state.xp !== 0) || (state.level < 10 && state.xp >= XP_TO_LEVEL[state.level])) add('XP_NOT_NORMALIZED');
  for (const field of ['gold','hp','winStreak','lossStreak']) if (!isInt(state[field]) || state[field] < 0) add('BAD_ECONOMY_FIELD', field);
  if (!state.shop || !Array.isArray(state.shop.offers) || state.shop.offers.length !== SHOP_SIZE || typeof state.shop.locked !== 'boolean') add('BAD_SHOP');
  const collectionsValid = Array.isArray(state.pieces) && Array.isArray(state.inventory) && Array.isArray(state.history) && Array.isArray(state.strategies)
    && Array.isArray(state.pendingChoices) && Array.isArray(state.consumables) && Array.isArray(state.claimedNodes)
    && state.strategyState && typeof state.strategyState === 'object' && !Array.isArray(state.strategyState);
  if (!collectionsValid) add('BAD_COLLECTION');
  if(Array.isArray(state.strategies))for(const strategy of state.strategies){const id=typeof strategy==='string'?strategy:strategy?.id;if(typeof id!=='string'||!id)add('BAD_STRATEGY_RECORD');else if(Object.keys(strategyDefs(catalog)).length&&!own(strategyDefs(catalog),id))add('UNKNOWN_STRATEGY',id);}
  if(state.strategyState&&typeof state.strategyState==='object'&&!Array.isArray(state.strategyState))for(const [id,entry] of Object.entries(state.strategyState)){if(!entry||typeof entry!=='object'||Array.isArray(entry))add('BAD_STRATEGY_STATE',id);else if(Object.keys(strategyDefs(catalog)).length&&!own(strategyDefs(catalog),id))add('UNKNOWN_STRATEGY_STATE',id);}
  if(Array.isArray(state.claimedNodes)&&(state.claimedNodes.some((node)=>!isInt(node)||node<1)||new Set(state.claimedNodes).size!==state.claimedNodes.length))add('BAD_CLAIMED_NODES');
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
    if (!piece.growth || typeof piece.growth !== 'object' || Array.isArray(piece.growth)
      || Object.values(piece.growth).some(value=>!Number.isFinite(value)||value<0)) add('BAD_GROWTH', piece.uid);
    if(piece.summonOrders!==undefined&&(!Array.isArray(piece.summonOrders)||piece.summonOrders.some((order)=>!order||typeof order.tokenId!=='string'||!isInt(order.row)||!isInt(order.col))))add('BAD_SUMMON_ORDERS',piece.uid);
    if(piece.extraPacts!==undefined&&(!Array.isArray(piece.extraPacts)||piece.extraPacts.some((id)=>typeof id!=='string')))add('BAD_EXTRA_PACTS',piece.uid);
    if ((piece.row === null) !== (piece.col === null)) add('BAD_POSITION', piece.uid);
    if (piece.row !== null && (!isInt(piece.row) || !isInt(piece.col))) add('BAD_POSITION', piece.uid);
    if (!['UP','RIGHT','DOWN','LEFT'].includes(piece.dir)) add('BAD_DIRECTION', piece.uid);
  }
  for (const item of Array.isArray(state.inventory) ? state.inventory : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { add('BAD_INVENTORY_ITEM'); continue; }
    trackUid(item.uid, 'inventory');
    if (!own(itemTable(catalog), item.itemId)) add('UNKNOWN_EQUIPMENT', item.itemId);
  }
  for (const choice of Array.isArray(state.pendingChoices) ? state.pendingChoices : []) {
    if (!choice || typeof choice !== 'object' || typeof choice.uid !== 'string' || !Array.isArray(choice.options)||choice.options.length===0||choice.options.some((id)=>typeof id!=='string')||!isInt(choice.remaining)||choice.remaining<1) add('BAD_PENDING_CHOICE');
    else trackUid(choice.uid,'choice');
  }
  for (const item of Array.isArray(state.consumables) ? state.consumables : []) {
    if (!item || typeof item !== 'object' || typeof item.uid !== 'string' || !['smallCopy','universalCopy'].includes(item.kind)) add('BAD_CONSUMABLE');
    else trackUid(item.uid,'consumable');
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
  const restrictedBench=state.strategyState&&typeof state.strategyState==='object'&&activeStrategyEntries(state).some(([id])=>strategyDefs(catalog)[id]?.effects?.some((effect)=>effect.kind==='bench_capacity_and_gold'));
  if (pieces.filter((piece) => piece.row === null && piece.col === null).length > (restrictedBench?7:BENCH_CAPACITY)) add('BENCH_OVER_CAPACITY');
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
  if (!type) return false;
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
    pendingChoices: clone(state.pendingChoices), consumables: clone(state.consumables), strategies: clone(state.strategies),
    strategyState: clone(state.strategyState), environmentId: state.environmentId, nodeStarted: state.nodeStarted,
    forgeProgress: clone(state.forgeProgress??{}), actionCosts: economyActionCosts(state,catalog),
    benchCount: state.pieces.filter((piece) => piece.row === null).length,
    deployedCount: state.pieces.filter((piece) => piece.row !== null).length,
    legalFieldStatus: fieldStatus, legalCells,
  };
}

function requirePrep(state) { if (!['prep','choice'].includes(state.phase)) throw new Error('WRONG_PHASE'); }
function pieceByUid(state, id) { return state.pieces.find((piece) => piece.uid === id) ?? null; }
function benchCount(state) { return state.pieces.filter((piece) => piece.row === null).length; }
function streakBonus(count) { return count >= 6 ? 3 : count >= 5 ? 2 : count >= 2 ? 1 : 0; }
export function calculateRoundIncome({ gold, round, won, winStreak, lossStreak, interestCap = 5 }) {
  const winBonus = won ? 1 : 0;
  const streak = streakBonus(won ? winStreak : lossStreak);
  const interest = Math.min(interestCap, Math.floor((gold + winBonus) / 10));
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
function campaignOf(catalog) { return catalog?.campaign ?? {}; }
function strategyDefs(catalog) { return catalog?.strategies ?? {}; }
function activeStrategyEntries(state) {
  return Object.entries(state.strategyState ?? {}).filter(([, entry]) => entry && typeof entry==='object' && !entry.fallbackApplied);
}
function economyActionCosts(state,catalog) {
  const active=activeStrategyEntries(state);
  const shopRule=active.find(([id])=>strategyDefs(catalog)[id]?.effects?.some(effect=>effect.kind==='shop_rule'))?.[1];
  const refresh=active.find(([id])=>strategyDefs(catalog)[id]?.effects?.some(effect=>effect.kind==='refresh_discount'))?.[1];
  const xp=active.find(([id,entry])=>Number(entry.uses)>0&&strategyDefs(catalog)[id]?.effects?.some(effect=>effect.kind==='xp_discount'))?.[1];
  const baseRefresh=Number(shopRule?.refreshCost??campaignOf(catalog).economy?.paidRefreshGold??2);
  const refreshGold=refresh&&Number(refresh.paidCount??0)+1>=Math.max(1,Number(refresh.paidRefreshEvery??3))?0:baseRefresh;
  const interestCap=5+active.reduce((sum,[id,entry])=>sum+(strategyDefs(catalog)[id]?.effects?.some(effect=>effect.kind==='interest_cap')?Number(entry.amount??0):0),0);
  return {refreshGold,xpGold:4-(xp?Math.min(4,Number(xp.amount??0)):0),canLockShop:!shopRule?.lockDisabled,interestCap};
}
function settleNodeIncome(state, catalog, { won = null, baseIncome = null } = {}) {
  const previousGold = state.gold;
  const interestBonus = activeStrategyEntries(state).reduce((sum,[id,entry]) => sum
    + (strategyDefs(catalog)[id]?.effects?.some(effect => effect.kind === 'interest_cap') ? Math.max(0,Number(entry.amount)||0) : 0), 0);
  const details = calculateRoundIncome({ gold:previousGold, round:state.round, won:won === true,
    winStreak:won === null ? 0 : state.winStreak, lossStreak:won === null ? 0 : state.lossStreak, interestCap:5+interestBonus });
  let income = baseIncome ?? details.income, delayedBonus = 0, strategyGold = 0;
  for (const [id, entry] of activeStrategyEntries(state)) {
    const effects = strategyDefs(catalog)[id]?.effects ?? [];
    const delay = effects.find(effect => effect.kind === 'delayed_income');
    if (delay && !entry.released) {
      const elapsed = Number(entry.elapsedNodes ?? 0) + 1;
      entry.elapsedNodes = elapsed;
      if (elapsed <= Number(delay.params?.holdNodes ?? 2)) { entry.held = Number(entry.held ?? 0) + income; income = 0; }
      if (elapsed >= Number(delay.params?.releaseNode ?? 3)) { delayedBonus += Number(entry.held ?? 0) + Number(delay.params?.bonus ?? 8); entry.held = 0; entry.released = true; }
    }
    const bench = effects.find(effect => effect.kind === 'bench_capacity_and_gold');
    if (bench) strategyGold += Number(bench.params?.postBattleGold ?? 0);
  }
  state.gold = previousGold + income + details.winBonus + details.streakBonus + details.interest + delayedBonus + strategyGold;
  return { ...details, income, delayedBonus, strategyGold, goldBefore:previousGold, goldAfter:state.gold };
}
function settleBattleRewards(state, catalog, result) {
  for (const growth of result.growth ?? []) {
    const piece = pieceByUid(state, growth.pieceUid);
    if (!piece || typeof growth.key !== 'string' || !Number.isFinite(growth.amount) || growth.amount < 0
      || (growth.cap !== undefined && (!Number.isFinite(growth.cap) || growth.cap < 0))) throw new Error('BAD_GROWTH_RESULT');
    piece.growth[growth.key] = Math.min(growth.cap ?? Infinity, Number(piece.growth[growth.key] ?? 0) + growth.amount);
  }
  let battleGold = 0;
  for (const reward of result.coins ?? []) {
    if (!isInt(reward.amount) || reward.amount < 0) throw new Error('BAD_COIN_RESULT');
    battleGold += reward.amount;
  }
  state.gold += battleGold;
  state.forgeProgress ??= {};
  const credited = new Set();
  for (const reward of result.forge ?? []) {
    if (reward.source !== 'rim' || !isInt(reward.progress) || reward.progress < 1 || !isInt(reward.threshold) || reward.threshold < 1) throw new Error('BAD_FORGE_RESULT');
    if (credited.has(reward.source)) continue;
    credited.add(reward.source);
    const next = Number(state.forgeProgress[reward.source] ?? 0) + Math.min(reward.progress, 1);
    state.forgeProgress[reward.source] = next % reward.threshold;
    if (next >= reward.threshold) addPendingChoice(state,'components',reward.source,availableItemOptions(catalog,'component'),1);
  }
  return { battleGold };
}
function addPendingChoice(state, type, source, options, remaining = 1, extra = {}) {
  if(!Array.isArray(options)||options.length<remaining||remaining<1)throw new Error('CHOICE_OPTIONS_INSUFFICIENT');
  const choice = { uid: uid(state,'c'), type, source, options: clone(options), remaining, ...extra };
  state.pendingChoices.push(choice);
  return choice;
}
function updateIdentityTransferChoices(state,catalog) {
  const items=[...state.inventory,...state.pieces.flatMap(piece=>piece.equipment)];
  state.pendingChoices=state.pendingChoices.filter(choice=>choice.type!=='identity_transfer'||items.some(item=>item.uid===choice.itemUid));
  const identities=new Set(Object.values(catalog.environments??{}).map(env=>env.identityPactId).filter(Boolean));
  const options=[...identities].filter(pact=>Object.values(itemTable(catalog)).some(item=>item.effects?.some(effect=>['pact_transfer','transfer_pact'].includes(effect.kind)&&effect.params?.pactId===pact)));
  for(const item of items) {
    if(!itemTable(catalog)[item.itemId]?.effects?.some(effect=>effect.kind==='choose_identity_transfer'))continue;
    if(!options.length)throw new Error('IDENTITY_TRANSFER_OPTIONS_MISSING');
    if(!state.pendingChoices.some(choice=>choice.type==='identity_transfer'&&choice.itemUid===item.uid))
      addPendingChoice(state,'identity_transfer',item.itemId,options,1,{itemUid:item.uid});
  }
}
function conditionHolds(strategy, state, catalog, targets = {}) {
  const condition = strategy.condition ?? {kind:'always'};
  switch (condition.kind) {
    case 'always': case 'metric_threshold': return true;
    case 'current_hp_above': return state.hp > Number(condition.value ?? condition.params?.value ?? 20);
    case 'no_owned_cost': {
      const cost = Number(condition.cost ?? condition.params?.cost);
      return !state.pieces.some((piece) => costOf(catalog,piece.operatorId) === cost);
    }
    case 'start_of_run': case 'gold_min': return state.gold >= Number(condition.value??8);
    case 'formation_count': {
      const minMelee = Number(condition.minMelee ?? condition.params?.minMelee ?? 0);
      const minRanged = Number(condition.minRanged ?? condition.params?.minRanged ?? 0);
      const deployed = state.pieces.filter((piece)=>piece.row!==null);
      return deployed.filter((piece)=>opTable(catalog)[piece.operatorId]?.position==='MELEE').length>=minMelee
        && deployed.filter((piece)=>opTable(catalog)[piece.operatorId]?.position==='RANGED').length>=minRanged;
    }
    case 'choose_adjacent_pair': {
      const [a,b] = targets.pieceUids ?? [];
      if(a===undefined||b===undefined){const deployed=state.pieces.filter((piece)=>piece.row!==null);return deployed.some((first,index)=>deployed.slice(index+1).some((second)=>Math.abs(first.row-second.row)+Math.abs(first.col-second.col)===1));}
      const first=pieceByUid(state,a), second=pieceByUid(state,b);
      return !!first && !!second && first.row!==null && second.row!==null
        && Math.abs(first.row-second.row)+Math.abs(first.col-second.col)===1;
    }
    default: throw new Error(`UNKNOWN_STRATEGY_CONDITION:${condition.kind}`);
  }
}
function strategyEligible(strategy,state,catalog,targets={}) {
  if(!conditionHolds(strategy,state,catalog,targets))return false;
  return (strategy.effects??[]).every((effect)=>{
    if(effect.kind==='disassemble_recipe_item')return [...state.inventory,...state.pieces.flatMap((piece)=>piece.equipment)].some((item)=>catalog.recipes.some((recipe)=>recipe.resultId===item.itemId&&itemTable(catalog)[item.itemId]?.kind!=='emblem'));
    if(effect.kind==='choose_pool_operators')return activeOperatorIds(catalog).filter((id)=>costOf(catalog,id)===Number(effect.params?.cost)&&(state.poolRemaining[id]??0)>0).length>=Number(effect.params?.count??1);
    if(effect.kind==='choose_transfer')return availableItemOptions(catalog,'emblem').length>0;
    if(effect.kind==='choose_components')return availableItemOptions(catalog,'component').length>0;
    if(effect.kind==='late_game')return state.gold>=Math.abs(Number(effect.params?.startGold??-8));
    if(effect.kind==='target_copy')return state.pieces.some((piece)=>piece.row!==null&&costOf(catalog,piece.operatorId)>=Number(effect.params?.costMin??1)&&costOf(catalog,piece.operatorId)<=Number(effect.params?.costMax??3));
    if(effect.kind==='delayed_operator')return activeOperatorIds(catalog).some((id)=>costOf(catalog,id)===Number(effect.params?.cost??4)&&(state.poolRemaining[id]??0)>0);
    if(effect.kind==='bench_capacity_and_gold')return benchCount(state)<=Number(effect.params?.capacity??7);
    if(effect.kind==='unique_nation_core'){const ids=state.pieces.filter(piece=>piece.row!==null).map(piece=>opTable(catalog)[piece.operatorId]?.charId??piece.operatorId);return new Set(ids).size===ids.length;}
    if(effect.kind==='risk_exchange')return state.hp>Number(effect.params?.minHpExclusive??20);
    return true;
  });
}
function drawStrategies(state,catalog) {
  const defs = strategyDefs(catalog);
  const chosen = new Set(state.strategies.map((entry)=>typeof entry==='string'?entry:entry.id));
  for(const choice of state.pendingChoices)if(choice.type==='strategy')for(const id of choice.options)chosen.add(id);
  const candidates = Object.values(defs).filter((strategy)=>!chosen.has(strategy.id)
    && !strategy.mutuallyExclusive?.some((id)=>chosen.has(id))
    && strategyEligible(strategy,state,catalog));
  const picked=[];
  while (candidates.length && picked.length<3) {
    const index=Math.floor(random(state)*candidates.length);
    picked.push(candidates.splice(index,1)[0].id);
  }
  return picked;
}
function addConsumable(state,kind,source) { state.consumables.push({uid:uid(state,'u'),kind,source}); }
function availableItemOptions(catalog,kind) {
  return Object.values(itemTable(catalog)).filter((item)=>!kind || item.kind===kind).map((item)=>item.id);
}
function componentOptions(state,catalog,optionCount) {
  const available=availableItemOptions(catalog,'component'),picked=[];
  const count=Math.min(available.length,Math.max(1,Math.trunc(optionCount)));
  while (picked.length<count) picked.push(available.splice(Math.floor(random(state)*available.length),1)[0]);
  return picked;
}
function executeStrategyEffect(state,catalog,strategy,effect,targets={}) {
  const p=effect.params??{};
  switch(effect.kind) {
    case 'gold': state.gold+=Number(p.amount??0); break;
    case 'xp': applyXp(state,Number(p.amount??0)); break;
    case 'choose_components': addPendingChoice(state,'components',strategy.id,componentOptions(state,catalog,Number(p.optionCount??8)),Number(p.count??1)); break;
    case 'choose_pool_operators': {
      const cost=Number(p.cost), options=activeOperatorIds(catalog).filter((id)=>costOf(catalog,id)===cost&&(state.poolRemaining[id]??0)>0);
      if(!options.length) throw new Error('STRATEGY_POOL_EMPTY');
      addPendingChoice(state,'operators',strategy.id,options,Number(p.count??1),{cost}); break;
    }
    case 'disassemble_recipe_item': {
      const recipeIds=new Set(catalog.recipes.map((recipe)=>recipe.resultId));
      const options=[];
      for(const item of state.inventory) if(recipeIds.has(item.itemId)&&itemTable(catalog)[item.itemId]?.kind!=='emblem') options.push(item.uid);
      for(const piece of state.pieces) for(const item of piece.equipment) if(recipeIds.has(item.itemId)&&itemTable(catalog)[item.itemId]?.kind!=='emblem') options.push(item.uid);
      if(!options.length) throw new Error('NO_DISASSEMBLE_TARGET');
      addPendingChoice(state,'disassemble',strategy.id,options,1); break;
    }
    case 'sell_bonus': state.strategyState[strategy.id]={uses:Number(p.uses??0),amount:Number(p.amount??0),costMin:Number(p.costMin??2),starMin:Number(p.starMin??2),starMax:Number(p.starMax??3)}; break;
    case 'interest_cap': state.strategyState[strategy.id]={amount:Number(p.amount??0)}; break;
    case 'xp_discount': case 'refresh_discount': case 'pact_set_reward': case 'target_copy': case 'delayed_operator':
    case 'metric_reward': case 'bench_capacity_and_gold': case 'shop_rule': case 'unique_nation_core': case 'delayed_income':
    case 'risk_exchange': case 'victory_tradeoff': case 'choose_transfer': case 'dual_pact': case 'low_cost_specialist': case 'late_game':
    case 'flexible_core': case 'free_disassemble_and_recipe': case 'crossfire': case 'pair_guard': case 'lastAmmo':
    case 'firstFreezeSplash': case 'firstConstructRebuild': case 'executeBonus':
      state.strategyState[strategy.id]={...clone(p), selectedRound:state.round, progress:0, ...(Object.keys(targets).length?{targets:clone(targets)}:{})};
      if(effect.kind==='risk_exchange'){if(state.hp<=Number(p.minHpExclusive??20))throw new Error('STRATEGY_INELIGIBLE');state.hp-=Number(p.hpCost??0);state.gold+=Number(p.gold??0);}
      if(effect.kind==='late_game'){if(state.gold<Math.abs(Number(p.startGold??-8)))throw new Error('STRATEGY_INELIGIBLE');state.gold+=Number(p.startGold??-8);}
      if(effect.kind==='shop_rule'&&p.lockDisabled)state.shop.locked=false;
      if(effect.kind==='choose_transfer') addPendingChoice(state,'transfer',strategy.id,availableItemOptions(catalog,'emblem'),1);
      if(effect.kind==='target_copy') {
        state.strategyState[strategy.id].targetWins=Number(p.wins??3);state.strategyState[strategy.id].observedWins=0;delete state.strategyState[strategy.id].wins;
        addPendingChoice(state,'target_piece',strategy.id,state.pieces.filter(piece=>piece.row!==null).map((piece)=>piece.uid).filter((id)=>{const piece=pieceByUid(state,id);return piece&&costOf(catalog,piece.operatorId)>=Number(p.costMin??1)&&costOf(catalog,piece.operatorId)<=Number(p.costMax??3)}),1);
      }
      if(effect.kind==='delayed_operator')addPendingChoice(state,'target_operator',strategy.id,activeOperatorIds(catalog).filter((id)=>costOf(catalog,id)===Number(p.cost??4)&&(state.poolRemaining[id]??0)>0),1);
      if(effect.kind==='pair_guard') addPendingChoice(state,'pair',strategy.id,state.pieces.filter((piece)=>piece.row!==null).map((piece)=>piece.uid),2);
      if(effect.kind==='dual_pact') addPendingChoice(state,'dual_pact',strategy.id,state.pieces.map((piece)=>piece.uid),1);
      if(effect.kind==='delayed_operator') state.strategyState[strategy.id].dueRound=state.round+Number(p.delayNodes??4);
      if(effect.kind==='delayed_income') state.strategyState[strategy.id].held=0;
      break;
    default: throw new Error(`UNKNOWN_STRATEGY_EFFECT:${effect.kind}`);
  }
}
function addStrategy(state,catalog,strategyId,targets={}) {
  const strategy=strategyDefs(catalog)[strategyId];
  if(!strategy) throw new Error('STRATEGY_NOT_FOUND');
  if(state.strategies.some((entry)=>(typeof entry==='string'?entry:entry.id)===strategyId)) throw new Error('STRATEGY_ALREADY_CHOSEN');
  if(strategy.mutuallyExclusive?.some((id)=>state.strategies.some((entry)=>(typeof entry==='string'?entry:entry.id)===id))) throw new Error('STRATEGY_EXCLUSIVE');
  const eligible=strategyEligible(strategy,state,catalog,targets);
  const record={id:strategyId,...(Object.keys(targets).length?{targets:clone(targets)}:{})};
  state.strategies.push(record);
  const effects=eligible?strategy.effects:[strategy.invalidFallback];
  if(!Array.isArray(effects)||!effects[0]?.kind) throw new Error('STRATEGY_INVALID_FALLBACK_MISSING');
  for(const effect of effects) executeStrategyEffect(state,catalog,strategy,effect,targets);
  if(!eligible)state.strategyState[strategyId]={fallbackApplied:true};
  if(eligible&&strategy.effects.some((effect)=>effect.kind==='low_cost_specialist')){
    for(const offer of state.shop.offers)if(offer.operatorId&&costOf(catalog,offer.operatorId)===5){state.poolRemaining[offer.operatorId]++;offer.operatorId=null;offer.cost=null;const fresh=drawShopOffer(state,catalog);offer.operatorId=fresh.operatorId;offer.cost=fresh.cost;offer.uid=fresh.uid;}
  }
  return {strategyId,eligible,fallback:!eligible};
}
function updatePactSetRewards(state,catalog) {
  const awards=[];
  for(const [id,entry] of activeStrategyEntries(state)){
    const strategy=strategyDefs(catalog)[id],reward=strategy?.effects?.find((effect)=>effect.kind==='pact_set_reward');
    if(!reward||entry.rewardedPact)continue;
    const counts=new Map();
    for(const piece of state.pieces){if(piece.row===null)continue;const op=opTable(catalog)[piece.operatorId];if(!op)continue;const pacts=new Set([...(op.pacts??op.tags??[]),...(piece.extraPacts??[])]);
      for(const equipment of piece.equipment??[])for(const effect of itemTable(catalog)[equipment.itemId]?.effects??[])if(['pact_transfer','transfer_pact'].includes(effect.kind))pacts.add(effect.params?.pactId);
      for(const pact of pacts){if(!pact)continue;const members=counts.get(pact)??new Set();members.add(op.charId??piece.operatorId);counts.set(pact,members);}
    }
    if([...counts.values()].some((members)=>members.size>=Number(reward.params?.threshold??4))){entry.rewardedPact=true;state.gold+=Number(reward.params?.gold??8);awards.push({strategyId:id,gold:Number(reward.params?.gold??8)});}
  }
  return awards;
}
function prepareSupply(state,catalog) {
  const campaign=campaignOf(catalog), supply=campaign.supply??{};
  if(state.claimedNodes.includes(state.round)) throw new Error('NODE_ALREADY_CLAIMED');
  state.claimedNodes.push(state.round);
  const node=state.round;
  const component=supply.components;
  const envRule=catalog.environments?.[state.environmentId]?.rule;
  if(component?.nodes?.includes(node)) {
    const count=Number(component.countPerNode??2),extra=envRule?.kind==='environment_component_choice'?Number(envRule.params?.extraOptions??1):0;
    addPendingChoice(state,'components',`node-${node}`,componentOptions(state,catalog,Math.max(count,Number(component.optionCount??3)+extra)),count);
  }
  if(envRule?.kind==='environment_component_supply'&&node%Number(envRule.params?.everyNode??8)===0) {
    const count=Number(envRule.params?.count??1);
    addPendingChoice(state,'components',state.environmentId,componentOptions(state,catalog,Math.max(count,Number(component?.optionCount??3))),count);
  }
  const copy=(supply.copies??[]).find((entry)=>entry.node===node);
  if(copy) for(let i=0;i<Number(copy.count??1);i++) addConsumable(state,copy.kind==='minor'?'smallCopy':'universalCopy',`node-${node}`);
  const transfer=(supply.transfers??[]).find((entry)=>entry.node===node);
  if(transfer) addPendingChoice(state,'transfer',`node-${node}`,availableItemOptions(catalog,'emblem'),Number(transfer.count??1));
  const xp=(supply.xp??[]).find((entry)=>entry.node===node);
  if(xp) applyXp(state,Number(xp.amount??0));
  for(const [id,entry] of activeStrategyEntries(state)){
    const strategy=strategyDefs(catalog)[id];if(!strategy)continue;
    if(strategy.effects?.some((effect)=>effect.kind==='delayed_operator')&&node>=Number(entry.dueRound??Infinity)&&!entry.delivered){
      const target=entry.targetOperatorId;
      if(target&&(state.poolRemaining[target]??0)>0)addPendingChoice(state,'operators',id,[target],1,{cost:Number(entry.cost??4)});else state.gold+=6;
      entry.delivered=true;
    }
    const furnace=strategy.effects?.find((effect)=>effect.kind==='free_disassemble_and_recipe');
    if(furnace&&node%Number(furnace.params?.everyNodes??4)===0&&entry.lastUsedNode!==node){
      const recipeIds=new Set(catalog.recipes.map((recipe)=>recipe.resultId));
      const options=[...state.inventory,...state.pieces.flatMap((piece)=>piece.equipment)].filter((item)=>recipeIds.has(item.itemId)&&itemTable(catalog)[item.itemId]?.kind!=='emblem').map((item)=>item.uid);
      if(options.length)addPendingChoice(state,'disassemble',id,options,1,{free:true,node});
    }
  }
  if(campaign.strategyNodes?.includes(node)){const options=drawStrategies(state,catalog);if(options.length)addPendingChoice(state,'strategy',`node-${node}`,options,1);}
  if(campaign.supply?.acceleratedStrategy?.node===node){for(let count=0;count<Number(campaign.supply.acceleratedStrategy.count??1);count++){const options=drawStrategies(state,catalog);if(options.length)addPendingChoice(state,'strategy',`node-${node}-accelerated`,options,1);}}
  state.nodeStarted=true;
}
function reconcilePhase(state) { state.phase=state.pendingChoices.length?'choice':state.terminalReason?'complete':'prep'; }
function findChoice(state,id) { return state.pendingChoices.find((choice)=>choice.uid===id)??null; }
function claimChoice(state,catalog,choice,optionIds) {
  if(!Array.isArray(optionIds)||!optionIds.length||optionIds.length>choice.remaining) throw new Error('BAD_REWARD_SELECTION');
  if(new Set(optionIds).size!==optionIds.length||optionIds.some((id)=>!choice.options.includes(id))) throw new Error('INVALID_REWARD_OPTION');
  if(choice.type==='components'||choice.type==='transfer') {
    if(state.inventory.length+optionIds.length>INVENTORY_CAPACITY) throw new Error('INVENTORY_CAPACITY');
    for(const itemId of optionIds) {
      const item=itemTable(catalog)[itemId];
      if(!item||choice.type==='components'&&item.kind!=='component'||choice.type==='transfer'&&item.kind!=='emblem') throw new Error('INVALID_REWARD_ITEM');
      state.inventory.push({uid:uid(state,'i'),itemId});
    }
  } else if(choice.type==='operators') {
    for(const operatorId of optionIds) {
      if(!mergeAvailable(state,operatorId,1,true)&&benchCount(state)>=benchCapacity(state,catalog))throw new Error('BENCH_FULL');
      if((state.poolRemaining[operatorId]??0)<1) throw new Error('POOL_EMPTY');
      state.poolRemaining[operatorId]--; const piece=makePiece(state,operatorId);state.pieces.push(piece);mergeOperatorCopies(state,catalog);
    }
  } else if(choice.type==='target_operator') {
    if(optionIds.length!==1)throw new Error('BAD_REWARD_SELECTION');state.strategyState[choice.source].targetOperatorId=optionIds[0];
  } else if(choice.type==='disassemble') {
    if(optionIds.length!==1) throw new Error('BAD_REWARD_SELECTION');
    const found=findEquipment(state,optionIds[0]);if(!found)throw new Error('RECIPE_ITEM_NOT_FOUND');
    const recipe=catalog.recipes.find((entry)=>entry.resultId===found.item.itemId&&entry.parts?.length===2);
    if(!recipe||itemTable(catalog)[found.item.itemId]?.kind==='emblem')throw new Error('NOT_DISASSEMBLABLE');
    const equippedOwner=found.owner;
    const overflow=equippedOwner?Math.max(0,equippedOwner.equipment.length-1+2-3):2;
    if(state.inventory.length-(equippedOwner?0:1)+overflow>INVENTORY_CAPACITY)throw new Error('INVENTORY_CAPACITY');
    consumeEquipmentLocation(state,found);
    for(const itemId of recipe.parts){const item={uid:uid(state,'i'),itemId};if(equippedOwner&&equippedOwner.equipment.length<3)equippedOwner.equipment.push(item);else state.inventory.push(item);}
    if(choice.source&&state.strategyState[choice.source])state.strategyState[choice.source].lastUsedNode=choice.node??state.round;
    if(strategyDefs(catalog)[choice.source]?.effects?.some(effect=>effect.kind==='free_disassemble_and_recipe'))queueRecipeChoice(state,catalog,choice.source);
  } else if(choice.type==='recipe') {
    if(optionIds.length!==1)throw new Error('BAD_REWARD_SELECTION');
    const recipe=catalog.recipes.find(entry=>entry.resultId===optionIds[0]);const materials=recipe&&recipeMaterials(state,recipe);
    if(!materials)throw new Error('RECIPE_ITEM_NOT_FOUND');
    combineEquipment(state,catalog,materials,recipe);
  } else if(choice.type==='identity_transfer') {
    if(optionIds.length!==1)throw new Error('BAD_REWARD_SELECTION');
    const found=findEquipment(state,choice.itemUid);
    if(!found||!itemTable(catalog)[found.item.itemId]?.effects?.some(effect=>effect.kind==='choose_identity_transfer'))throw new Error('IDENTITY_TRANSFER_ITEM_MISSING');
    const replacement=Object.values(itemTable(catalog)).find(item=>item.id===`transfer_${optionIds[0]}`)
      ??Object.values(itemTable(catalog)).find(item=>item.effects?.some(effect=>['pact_transfer','transfer_pact'].includes(effect.kind)&&effect.params?.pactId===optionIds[0]));
    if(!replacement)throw new Error('IDENTITY_TRANSFER_OPTIONS_MISSING');
    found.item.itemId=replacement.id;
  } else if(choice.type==='target_piece') {
    if(optionIds.length!==1)throw new Error('BAD_REWARD_SELECTION');const target=pieceByUid(state,optionIds[0]);state.strategyState[choice.source].targetUid=optionIds[0];state.strategyState[choice.source].targetOperatorId=target?.operatorId??null;
  } else if(choice.type==='pair') {
    if(optionIds.length!==2)throw new Error('BAD_REWARD_SELECTION');
    const strat=strategyDefs(catalog)[choice.source];
    if(!conditionHolds(strat,state,catalog,{pieceUids:optionIds}))throw new Error('STRATEGY_TARGET_INVALID');
    state.strategyState[choice.source].targets={pieceUids:optionIds};
    const selected=state.strategies.find((entry)=>(typeof entry==='string'?entry:entry.id)===choice.source);if(selected&&typeof selected==='object')selected.targets={pieceUids:optionIds};
  } else if(choice.type==='dual_pact') {
    if(optionIds.length!==1)throw new Error('BAD_REWARD_SELECTION');
    const piece=pieceByUid(state,optionIds[0]);if(!piece)throw new Error('PIECE_NOT_FOUND');
    const mechanismIds=new Set(['ammo','combo','control','creation','symbiosis','logistics','redeploy','flight','arts','breaker','burn','necrosis']);
    const available=Object.keys(catalog.pacts??{}).filter(id=>mechanismIds.has(id)&&!(opTable(catalog)[piece.operatorId]?.pacts??[]).includes(id)&&!(piece.extraPacts??[]).includes(id));if(!available.length)throw new Error('PACT_OPTIONS_MISSING');
    addPendingChoice(state,'pact_tag',choice.source,available,1,{pieceUid:piece.uid});
  } else if(choice.type==='pact_tag') {
    if(optionIds.length!==1)throw new Error('BAD_REWARD_SELECTION');
    const piece=pieceByUid(state,choice.pieceUid);if(!piece||!own(catalog.pacts,optionIds[0]))throw new Error('BAD_PACT_OPTION');
    piece.extraPacts??=[];if(!piece.extraPacts.includes(optionIds[0]))piece.extraPacts.push(optionIds[0]);
  } else throw new Error(`UNKNOWN_REWARD_TYPE:${choice.type}`);
  choice.remaining-=optionIds.length;choice.options=choice.options.filter((id)=>!optionIds.includes(id));
  if(choice.remaining<=0)state.pendingChoices=state.pendingChoices.filter((entry)=>entry!==choice);
}
function benchCapacity(state,catalog) {
  const reduced=activeStrategyEntries(state).some(([id])=>strategyDefs(catalog)[id]?.effects?.some((effect)=>effect.kind==='bench_capacity_and_gold'));
  return reduced?7:BENCH_CAPACITY;
}
function uniqueCoreEnabled(state,catalog) {
  return activeStrategyEntries(state).some(([id])=>strategyDefs(catalog)[id]?.effects?.some((effect)=>effect.kind==='unique_nation_core'));
}
function advanceSupply(state,catalog) {
  if(state.phase==='complete'||state.terminalReason)throw new Error('SESSION_COMPLETE');
  if(state.pendingChoices.length)throw new Error('CHOICES_PENDING');
  const wasStarted=state.nodeStarted;
  if (!state.nodeStarted) prepareSupply(state,catalog);
  if (state.pendingChoices.length) { reconcilePhase(state); return {round:state.round,choices:state.pendingChoices.length}; }
  if (!wasStarted && (state.difficulty!=='FUNNY'||state.round%2!==1)) { reconcilePhase(state); return {round:state.round,choices:0}; }
  if(state.nodeStarted) {
    if(state.difficulty!=='FUNNY'||state.round%2!==1)throw new Error('NODE_ALREADY_STARTED');
    const settlement=settleNodeIncome(state,catalog,{baseIncome:Number(campaignOf(catalog).nodeSchedule?.FUNNY?.oddNodeGold??5)});
    applyXp(state,Number(campaignOf(catalog).nodeSchedule?.FUNNY?.oddNodeXp??2));
    state.history.push({round:state.round,type:'logistics-settled',...settlement,xp:Number(campaignOf(catalog).nodeSchedule?.FUNNY?.oddNodeXp??2),streakPreserved:true});
    state.round++;
    if(state.round>state.roundLimit)throw new Error('NO_NEXT_NODE');
    state.nodeStarted=false;
  }
  if(state.claimedNodes.includes(state.round))throw new Error('NODE_ALREADY_CLAIMED');
  prepareSupply(state,catalog);
  reconcilePhase(state);
  return {round:state.round,choices:state.pendingChoices.length};
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
function recipeMaterials(state,recipe) {
  if(recipe.parts?.length!==2)return null;
  const items=[...state.inventory,...state.pieces.flatMap(piece=>piece.equipment)];
  for(const first of items.filter(item=>item.itemId===recipe.parts[0]))for(const second of items.filter(item=>item.itemId===recipe.parts[1]&&item.uid!==first.uid)){
    const found=[findEquipment(state,first.uid),findEquipment(state,second.uid)];
    if(new Set(found.filter(entry=>entry.owner).map(entry=>entry.owner.uid)).size<=1)return found;
  }
  return null;
}
function queueRecipeChoice(state,catalog,source) {
  const options=[...new Set(catalog.recipes.filter(recipe=>recipeMaterials(state,recipe)).map(recipe=>recipe.resultId))];
  if(options.length)addPendingChoice(state,'recipe',source,options,1);
}
function combineEquipment(state,catalog,found,recipe) {
  if(!own(itemTable(catalog),recipe.resultId))throw new Error('RECIPE_RESULT_UNKNOWN');
  const owner=found.find(entry=>entry.owner)?.owner??null;
  for(const entry of [...found].sort((a,b)=>b.index-a.index))consumeEquipmentLocation(state,entry);
  const item={uid:uid(state,'i'),itemId:recipe.resultId};if(owner)owner.equipment.push(item);else state.inventory.push(item);
  return item;
}
function resolveDeployedField(state, catalog, fieldResolver) {
  if (typeof fieldResolver !== 'function') throw new Error('FIELD_RESOLVER_REQUIRED');
  const resolved = getFieldCells(fieldResolver,state,catalog);
  if (!resolved.known) throw new Error('FIELD_RESOLVER_INVALID');
  return resolved.cells;
}
function settleFight(state, catalog, action, { battleRunner, fieldResolver, recording }) {
  requirePrep(state);
  if(state.difficulty==='FUNNY'&&state.round%2===1)throw new Error('FUNNY_LOGISTICS_NODE');
  if(state.terminalReason)throw new Error('SESSION_COMPLETE');
  if (state.pendingChoices.length) throw new Error('CHOICES_PENDING');
  if (!state.nodeStarted) throw new Error('SUPPLY_NOT_ADVANCED');
  const deployed = state.pieces.filter((piece) => piece.row !== null);
  if (!deployed.length) throw new Error('NO_DEPLOYED_PIECES');
  if (deployed.length > state.level) throw new Error('POPULATION_OVER_CAPACITY');
  const cells = resolveDeployedField(state,catalog,fieldResolver);
  for (const piece of deployed) if (!canDeployAt(cells,piece.row,piece.col,opTable(catalog)[piece.operatorId])) throw new Error('ILLEGAL_DEPLOYMENT');
  if (typeof battleRunner !== 'function') throw new Error('BATTLE_RUNNER_REQUIRED');
  const battleInput = clone(state);
  for(const selected of state.strategies){const id=typeof selected==='string'?selected:selected.id;const strategy=strategyDefs(catalog)[id];const entry=state.strategyState[id];
    if(!strategy||!entry||entry.fallbackApplied||!['formation_count','choose_adjacent_pair'].includes(strategy.condition?.kind))continue;
    const targets=selected?.targets??entry.targets??{};
    if(!conditionHolds(strategy,state,catalog,targets)){
      for(const effect of [strategy.invalidFallback])executeStrategyEffect(state,catalog,strategy,effect,{});
      entry.fallbackApplied=true;battleInput.strategies=battleInput.strategies.filter((candidate)=>(typeof candidate==='string'?candidate:candidate.id)!==id);
    }
  }
  let result;
  try { result = battleRunner(battleInput,{catalog,recording}); }
  catch (error) { throw new Error(`BATTLE_RUNNER_FAILED:${error?.message ?? 'unknown'}`); }
  if (!result || typeof result.won !== 'boolean' || !Number.isFinite(result.hpLoss) || result.hpLoss < 0) throw new Error('BAD_BATTLE_RESULT');
  if (Number(result.diagnostics?.errorCount ?? 0) !== 0) throw new Error('BATTLE_DIAGNOSTICS');
  const events = [];
  const previousGold = state.gold;
  state.hp = Math.max(0,state.hp-Math.floor(result.hpLoss));
  if (result.won) { state.winStreak++; state.lossStreak=0; }
  else { state.winStreak=0; state.lossStreak++; }
  const incomeDetails = settleNodeIncome(state,catalog,{won:result.won});
  const {winBonus,streakBonus:streak,interest}=incomeDetails;
  const income=incomeDetails.income;
  const {battleGold}=settleBattleRewards(state,catalog,result);
  applyXp(state,2);
  for(const [id,entry] of activeStrategyEntries(state)) {
    const strategy=strategyDefs(catalog)[id]; if(!strategy) continue;
    if(strategy.effects?.some((effect)=>effect.kind==='target_copy')&&result.won&&deployed.some(piece=>piece.uid===entry.targetUid))entry.observedWins=Number(entry.observedWins??0)+1;
    const metric=strategy.effects?.find((effect)=>effect.kind==='metric_reward');
    if(metric) {
      const key=metric.params?.metric;
      const aliases={controlTriggers:'control',effectiveHealing:'healing',constructAttacks:'constructAttacks',ammoSpent:'ammoSpent',eliteKills:'eliteKills'};
      const metricValue=key==='winNoLeakStreak'
        ? (result.won&&Number(result.metrics?.leaked??0)===0?1:0)
        : Number(result.metrics?.[key]??result.metrics?.[aliases[key]]??0);
      if(key==='winNoLeakStreak'&&metricValue===0)entry.progress=0;
        else entry.progress=key==='winNoLeakStreak'?Number(entry.progress??0)+metricValue:metricValue;
      if(entry.progress>=Number(metric.params?.threshold??Infinity)&&!entry.rewarded){
        entry.rewarded=true;const reward=metric.params.reward;
        if(reward==='minor_copy')addConsumable(state,'smallCopy',id);
        else if(reward==='universal_copy')addConsumable(state,'universalCopy',id);
        else if(reward==='choose_component')addPendingChoice(state,'components',id,componentOptions(state,catalog,Number(metric.params?.optionCount??2)),1);
        else if(reward==='transfer_symbiosis')addPendingChoice(state,'transfer',id,availableItemOptions(catalog,'emblem').filter((itemId)=>itemId.includes('symbiosis')),1);
        else if(reward==='gold')state.gold+=Number(metric.params.amount??0);
        else if(reward==='xp')applyXp(state,Number(metric.params.amount??0));
        else throw new Error(`UNKNOWN_METRIC_REWARD:${reward}`);
      }
    }
    const targetCopy=strategy.effects?.find((effect)=>effect.kind==='target_copy');
    if(targetCopy&&Number(entry.observedWins??0)>=Number(entry.targetWins??targetCopy.params?.wins??3)&&!entry.copyDelivered){
      const target=pieceByUid(state,entry.targetUid);entry.copyDelivered=true;
      if(target&&(state.poolRemaining[target.operatorId]??0)>0)addPendingChoice(state,'operators',id,[target.operatorId],1,{cost:costOf(catalog,target.operatorId)});
      else state.gold+=Math.max(1,costOf(catalog,target?.operatorId??entry.targetOperatorId??'')||1);
    }
    if(result.won&&strategy.effects?.some((effect)=>effect.kind==='victory_tradeoff'))state.hp=Math.max(0,state.hp-Number(strategy.effects.find((effect)=>effect.kind==='victory_tradeoff').params?.hpCost??0));
    if(strategy.effects?.some((effect)=>effect.kind==='flexible_core')){
      const core=[...deployed].sort((a,b)=>b.star-a.star||costOf(catalog,b.operatorId)-costOf(catalog,a.operatorId)||String(a.uid).localeCompare(String(b.uid)))[0];
      if(core){if(!entry.coreUid){entry.coreUid=core.uid;entry.lockBattles=1;}else if(entry.coreUid===core.uid)entry.lockBattles=Number(entry.lockBattles??0)+1;
        else if(Number(entry.lockBattles??0)>=3&&entry.rewardedNode!==state.round){state.gold+=Number(strategy.effects.find((effect)=>effect.kind==='flexible_core').params?.gold??2);entry.coreUid=core.uid;entry.lockBattles=1;entry.rewardedNode=state.round;}}
    }
  }
  const terminalReason = state.hp <= 0 ? 'hp-depleted'
    : state.round >= state.roundLimit ? (result.won ? 'victory' : 'round-limit-loss') : null;
  const event = { type:'fight-settled', round:state.round, won:result.won, hpLoss:Math.floor(result.hpLoss), income,
    winBonus, streakBonus:streak, interest, goldBefore:previousGold, goldAfter:state.gold, xpAfter:state.xp, levelAfter:state.level,
    battleGold, delayedBonus:incomeDetails.delayedBonus, strategyGold:incomeDetails.strategyGold,
    terminalReason, result:result.result ?? null, diagnostics:result.diagnostics ?? null };
  const compactHistoryEvent = { ...event };
  delete compactHistoryEvent.result;
  delete compactHistoryEvent.diagnostics;
  state.history.push(compactHistoryEvent);
  events.push({ ...event });
  if (terminalReason) { state.terminalReason=terminalReason; state.phase=state.pendingChoices.length?'choice':'complete'; }
  else {
    state.round++;
    state.nodeStarted=false;
    if (state.shop.locked) state.shop.locked=false;
    else refreshShop(state,catalog);
    if(state.pendingChoices.length)state.phase='choice';
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
        requirePrep(draft);
        const shopRule=activeStrategyEntries(draft).find(([id])=>strategyDefs(catalog)[id]?.effects?.some((effect)=>effect.kind==='shop_rule'))?.[1];
        const discount=activeStrategyEntries(draft).find(([id])=>strategyDefs(catalog)[id]?.effects?.some((effect)=>effect.kind==='refresh_discount'))?.[1];
        let refreshCost=Number(shopRule?.refreshCost??campaignOf(catalog).economy?.paidRefreshGold??2);
        if(discount){const cadence=Math.max(1,Number(discount.paidRefreshEvery??3));if(Number(discount.paidCount??0)+1>=cadence){refreshCost=0;discount.paidCount=0;}else discount.paidCount=Number(discount.paidCount??0)+1;}
        if (draft.gold < refreshCost) throw new Error('NOT_ENOUGH_GOLD'); draft.gold-=refreshCost; refreshShop(draft,catalog); events.push({type:'shop-refreshed',cost:refreshCost}); break;
      }
      case 'lockShop': {
        requirePrep(draft); if (typeof action.locked !== 'boolean') throw new Error('BAD_LOCK_VALUE');
        if(action.locked&&Object.values(draft.strategyState).some((entry)=>entry.lockDisabled))throw new Error('SHOP_LOCK_DISABLED');
        if(action.locked&&activeStrategyEntries(draft).some(([id])=>strategyDefs(catalog)[id]?.effects?.some((effect)=>effect.kind==='shop_rule'&&effect.params?.lockDisabled)))throw new Error('SHOP_LOCK_DISABLED');
        draft.shop.locked=action.locked; events.push({type:'shop-lock-changed',locked:action.locked}); break;
      }
      case 'buyXp': {
        requirePrep(draft); if (draft.level>=10) throw new Error('MAX_LEVEL');
        const discount=activeStrategyEntries(draft).find(([id,entry])=>Number(entry.uses)>0&&strategyDefs(catalog)[id]?.effects?.some((effect)=>effect.kind==='xp_discount'))?.[1];
        const cost=4-(discount?Math.min(4,Number(discount.amount??0)):0);if (draft.gold<cost) throw new Error('NOT_ENOUGH_GOLD'); draft.gold-=cost;if(discount)discount.uses--;
        applyXp(draft,4); events.push({type:'xp-purchased',gold:cost,xp:4,level:draft.level,remainingXp:draft.xp}); break;
      }
      case 'buy': {
        requirePrep(draft); const offerIndex=draft.shop.offers.findIndex((offer)=>offer.uid===action.offerUid);
        if (offerIndex<0) throw new Error('OFFER_NOT_FOUND'); const offer=draft.shop.offers[offerIndex];
        if (!offer.operatorId) throw new Error('EMPTY_OFFER');
        if(activeStrategyEntries(draft).some(([id])=>strategyDefs(catalog)[id]?.effects?.some((effect)=>effect.kind==='low_cost_specialist'&&effect.params?.forbidCost===offer.cost)))throw new Error('OPERATOR_TIER_FORBIDDEN');
        if (draft.gold<offer.cost) throw new Error('NOT_ENOUGH_GOLD');
        if (action.mergeTargetUid) {
          const target=pieceByUid(draft,action.mergeTargetUid);
          if (!target||target.operatorId!==offer.operatorId||target.star>=3) throw new Error('BAD_MERGE_TARGET');
        }
        const willMerge=mergeAvailable(draft,offer.operatorId,1,true);
        if (!willMerge&&benchCount(draft)>=benchCapacity(draft,catalog)) throw new Error('BENCH_FULL');
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
        draft.poolRemaining[piece.operatorId]+=copiesForStar(piece.star); let bonus=0;
        const sellBonus=activeStrategyEntries(draft).find(([id,entry])=>Number(entry.uses)>0&&strategyDefs(catalog)[id]?.effects?.some((effect)=>effect.kind==='sell_bonus'))?.[1];
        if(sellBonus&&costOf(catalog,piece.operatorId)>=Number(sellBonus.costMin??2)&&piece.star>=Number(sellBonus.starMin??2)&&piece.star<=Number(sellBonus.starMax??3)){bonus=Number(sellBonus.amount??0);sellBonus.uses--;}
        draft.gold+=refund+bonus;
        events.push({type:'operator-sold',operatorId:piece.operatorId,uid:piece.uid,star:piece.star,refund,bonus,copiesReturned:copiesForStar(piece.star)}); break;
      }
      case 'deploy': {
        requirePrep(draft); const piece=pieceByUid(draft,action.pieceUid); if(!piece) throw new Error('PIECE_NOT_FOUND');
        if (piece.row!==null) throw new Error('PIECE_ALREADY_DEPLOYED'); if (draft.pieces.filter((entry)=>entry.row!==null).length>=draft.level) throw new Error('POPULATION_OVER_CAPACITY');
        if(uniqueCoreEnabled(draft,catalog)){const charId=opTable(catalog)[piece.operatorId]?.charId;if(draft.pieces.some((entry)=>entry.row!==null&&opTable(catalog)[entry.operatorId]?.charId===charId))throw new Error('DUPLICATE_CORE_IDENTITY');}
        if (!isInt(action.row)||!isInt(action.col)||!['UP','RIGHT','DOWN','LEFT'].includes(action.dir)) throw new Error('BAD_POSITION');
        const check=cellIsLegal(fieldResolver,draft,catalog,action.row,action.col); if(!check.known)throw new Error('FIELD_RESOLVER_REQUIRED');if(!check.legal||!canDeployAt(check.cells,action.row,action.col,opTable(catalog)[piece.operatorId]))throw new Error('ILLEGAL_DEPLOYMENT');
        if(draft.pieces.some((entry)=>entry.row===action.row&&entry.col===action.col))throw new Error('CELL_OCCUPIED');
        piece.row=action.row;piece.col=action.col;piece.dir=action.dir;events.push({type:'piece-deployed',uid:piece.uid,row:piece.row,col:piece.col,dir:piece.dir});break;
      }
      case 'move': {
        requirePrep(draft);const piece=pieceByUid(draft,action.pieceUid);if(!piece)throw new Error('PIECE_NOT_FOUND');
        if(piece.row===null)throw new Error('PIECE_NOT_DEPLOYED');if(!isInt(action.row)||!isInt(action.col)||!['UP','RIGHT','DOWN','LEFT'].includes(action.dir))throw new Error('BAD_POSITION');
        if(uniqueCoreEnabled(draft,catalog)){const charId=opTable(catalog)[piece.operatorId]?.charId;if(draft.pieces.some((entry)=>entry!==piece&&entry.row!==null&&opTable(catalog)[entry.operatorId]?.charId===charId))throw new Error('DUPLICATE_CORE_IDENTITY');}
        if(draft.pieces.some((entry)=>entry!==piece&&entry.row===action.row&&entry.col===action.col))throw new Error('CELL_OCCUPIED');
        const check=cellIsLegal(fieldResolver,draft,catalog,action.row,action.col);if(!check.known)throw new Error('FIELD_RESOLVER_REQUIRED');if(!check.legal||!canDeployAt(check.cells,action.row,action.col,opTable(catalog)[piece.operatorId]))throw new Error('ILLEGAL_DEPLOYMENT');
        piece.row=action.row;piece.col=action.col;piece.dir=action.dir;events.push({type:'piece-moved',uid:piece.uid,row:piece.row,col:piece.col,dir:piece.dir});break;
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
        const resultItem=combineEquipment(draft,catalog,found,recipe);
        events.push({type:'equipment-combined',itemIds:found.map((entry)=>entry.item.itemId),resultId:recipe.resultId,uid:resultItem.uid,pieceUid:equippedOwner?.uid??null});break;
      }
      case 'advanceSupply': {
        const detail=advanceSupply(draft,catalog);events.push({type:'supply-advanced',...detail});break;
      }
      case 'chooseStrategy': {
        const choice=findChoice(draft,action.choiceUid);if(!choice||choice.type!=='strategy')throw new Error('STRATEGY_CHOICE_NOT_FOUND');
        if(!choice.options.includes(action.strategyId))throw new Error('STRATEGY_NOT_OFFERED');
        const result=addStrategy(draft,catalog,action.strategyId,action.targets??{});choice.remaining--;
        if(choice.remaining<=0)draft.pendingChoices=draft.pendingChoices.filter((entry)=>entry!==choice);
        reconcilePhase(draft);events.push({type:'strategy-chosen',...result});break;
      }
      case 'claimReward': {
        const choice=findChoice(draft,action.choiceUid);if(!choice)throw new Error('REWARD_CHOICE_NOT_FOUND');
        claimChoice(draft,catalog,choice,action.optionIds);reconcilePhase(draft);events.push({type:'reward-claimed',choiceUid:choice.uid,optionIds:[...action.optionIds]});break;
      }
      case 'useCopy': {
        requirePrep(draft);const index=draft.consumables.findIndex((entry)=>entry.uid===action.consumableUid);if(index<0)throw new Error('CONSUMABLE_NOT_FOUND');
        const consumable=draft.consumables[index],target=pieceByUid(draft,action.pieceUid);if(!target)throw new Error('PIECE_NOT_FOUND');
        if(consumable.kind==='smallCopy'&&costOf(catalog,target.operatorId)>3)throw new Error('COPY_COST_LIMIT');if((draft.poolRemaining[target.operatorId]??0)<1)throw new Error('POOL_EMPTY');
        if(!mergeAvailable(draft,target.operatorId,1,true)&&benchCount(draft)>=benchCapacity(draft,catalog))throw new Error('BENCH_FULL');
        draft.poolRemaining[target.operatorId]--;const copy=makePiece(draft,target.operatorId);draft.pieces.push(copy);draft.consumables.splice(index,1);events.push({type:'copy-used',uid:copy.uid,operatorId:copy.operatorId,star:1});events.push(...mergeOperatorCopies(draft,catalog,target.uid));break;
      }
      case 'disassemble': {
        requirePrep(draft);
        const furnace=activeStrategyEntries(draft).find(([id,entry])=>strategyDefs(catalog)[id]?.effects?.some(effect=>effect.kind==='free_disassemble_and_recipe'&&draft.round%Number(effect.params?.everyNodes??4)===0)&&entry.lastUsedNode!==draft.round);
        if(!furnace)throw new Error('DISASSEMBLE_NOT_AVAILABLE');
        const found=findEquipment(draft,action.itemUid);if(!found)throw new Error('ITEM_NOT_FOUND');const recipe=catalog.recipes.find((entry)=>entry.resultId===found.item.itemId&&entry.parts?.length===2);
        if(!recipe||itemTable(catalog)[found.item.itemId]?.kind==='emblem')throw new Error('NOT_DISASSEMBLABLE');const owner=found.owner;
        const overflow=owner?Math.max(0,owner.equipment.length-1+2-3):2;
        if(draft.inventory.length-(owner?0:1)+overflow>INVENTORY_CAPACITY)throw new Error('INVENTORY_CAPACITY');consumeEquipmentLocation(draft,found);
        for(const itemId of recipe.parts){const item={uid:uid(draft,'i'),itemId};if(owner&&owner.equipment.length<3)owner.equipment.push(item);else draft.inventory.push(item);}furnace[1].lastUsedNode=draft.round;queueRecipeChoice(draft,catalog,furnace[0]);events.push({type:'equipment-disassembled',itemUid:action.itemUid,parts:[...recipe.parts]});break;
      }
      case 'clearSummonOrder': {
        requirePrep(draft);const piece=pieceByUid(draft,action.pieceUid);if(!piece)throw new Error('PIECE_NOT_FOUND');
        if(action.tokenId!==undefined&&!selectedSummonIds(opTable(catalog)[piece.operatorId],piece.star).includes(action.tokenId))throw new Error('TOKEN_NOT_OWNED');
        piece.summonOrders=(piece.summonOrders??[]).filter((entry)=>action.tokenId!==undefined&&entry.tokenId!==action.tokenId);
        events.push({type:'summon-order-cleared',pieceUid:piece.uid,tokenId:action.tokenId??null});break;
      }
      case 'setSummonOrder': {
        requirePrep(draft);const piece=pieceByUid(draft,action.pieceUid);if(!piece||piece.row===null)throw new Error('PIECE_NOT_DEPLOYED');
        const op=opTable(catalog)[piece.operatorId],tokenIds=selectedSummonIds(op,piece.star);
        if(!tokenIds.includes(action.tokenId))throw new Error('TOKEN_NOT_OWNED');if(!isInt(action.row)||!isInt(action.col))throw new Error('BAD_POSITION');
        if(draft.pieces.some((entry)=>entry.row===action.row&&entry.col===action.col))throw new Error('CELL_OCCUPIED');const check=cellIsLegal(fieldResolver,draft,catalog,action.row,action.col);if(!check.known)throw new Error('FIELD_RESOLVER_REQUIRED');if(!check.legal)throw new Error('ILLEGAL_DEPLOYMENT');
        const field=fieldResolver?.(draft,{catalog});
        if(!legalSummonCells(field,draft,piece,op,action.tokenId).includes(`${action.row},${action.col}`))throw new Error('ILLEGAL_SUMMON_POSITION');
        piece.summonOrders??=[];piece.summonOrders=piece.summonOrders.filter((entry)=>entry.tokenId!==action.tokenId);piece.summonOrders.push({tokenId:action.tokenId,row:action.row,col:action.col});events.push({type:'summon-order-set',pieceUid:piece.uid,tokenId:action.tokenId,row:action.row,col:action.col});break;
      }
      case 'fight': {
        const result=settleFight(draft,catalog,action,{battleRunner,fieldResolver,recording});events.push(...result.events);replay=result.replay;break;
      }
      default: throw new Error('UNKNOWN_ACTION');
    }
    updateIdentityTransferChoices(draft,catalog);
    reconcilePhase(draft);
    const pactAwards=updatePactSetRewards(draft,catalog);
    if(pactAwards.length){events.push({type:'strategy-reward',awards:pactAwards});reconcilePhase(draft);}
    draft.revision++;
    draft.history.push(...events.filter((event)=>event.type!=='fight-settled').map((event)=>({round:draft.round,...event})));
    const after=validateSession(draft,{catalog});if(!after.ok)throw new Error(`INVALID_RESULT:${after.errors[0]?.code}`);
    return {ok:true,state:draft,events,...(action.type==='fight'?{replay:recording?replay:null}:{})};
  } catch(error) {
    return fail(state,error.message||'ACTION_FAILED');
  }
}

export const resonanceRules = Object.freeze({ benchCapacity: BENCH_CAPACITY, inventoryCapacity: INVENTORY_CAPACITY, shopSize: SHOP_SIZE, copiesByTier: COPIES_BY_TIER, xpToLevel: XP_TO_LEVEL, oddsByLevel: ODDS_BY_LEVEL, roundLimits: DEFAULT_ROUND_LIMIT });
