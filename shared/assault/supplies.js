import { codedError, nextUint32 } from './rng.js';

const invalid = (message) => { throw codedError('INVALID_SUPPLY', message); };
const definitionsError = (message) => { throw codedError('INVALID_SUPPLY_DEFINITIONS', message); };
const supplyItems = (ctx) => {
  const rawEntries = ctx?.design?.system?.supplyItems;
  const entries = rawEntries === undefined ? [] : rawEntries;
  if (!Array.isArray(entries)) definitionsError('supplyItems must be an array');
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id)
      || !Array.isArray(entry.allowedStars) || !entry.allowedStars.length || entry.allowedStars.some((star) => !Number.isInteger(star) || star < 1 || star > 4)
      || new Set(entry.allowedStars).size !== entry.allowedStars.length || ![1, 2].includes(entry.sizeSlots)
      || !['machine', 'beverage'].includes(entry.kind)
      || (entry.generationPool !== undefined && (!Array.isArray(entry.generationPool) || new Set(entry.generationPool).size !== entry.generationPool.length
        || entry.generationPool.some((id) => typeof id !== 'string' || !id.trim())))) definitionsError('Invalid supply item definition');
    ids.add(entry.id);
  }
  for (const entry of entries) if (entry.generationPool !== undefined
    && (entry.kind !== 'machine' || entry.generationPool.some((id) => !entries.some((candidate) => candidate.id === id && candidate.kind === 'beverage' && candidate.sizeSlots === 1)))) {
    definitionsError('Machine generationPool must reference registered beverages');
  }
  const capacity = ctx?.design?.system?.supplyCapacity ?? 8;
  if (!Number.isSafeInteger(capacity) || capacity < 0) definitionsError('Invalid supplyCapacity');
  return entries;
};

export function supplyDefinitions(ctx) { return supplyItems(ctx); }
export function supplyFor(ctx, id) { return supplyItems(ctx).find((entry) => entry.id === id) ?? null; }

function supplySlots(state, ctx) {
  return (state.supplies ?? []).reduce((sum, supply) => sum + supplyFor(ctx, supply.itemId).sizeSlots, 0);
}

export function validateSupplies(state, ctx) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) invalid('Invalid supply state');
  const hasSupplies = Object.hasOwn(state, 'supplies');
  const hasNext = Object.hasOwn(state, 'nextSupplyId');
  if (!hasSupplies && !hasNext) return state;
  if (!hasSupplies || !hasNext || !Array.isArray(state.supplies) || !Number.isSafeInteger(state.nextSupplyId) || state.nextSupplyId < 1) invalid('Supply inventory fields must be initialized together');
  const defs = supplyItems(ctx), ids = new Set(), uids = new Set((state.pieces ?? []).map((piece) => piece?.uid).filter((uid) => typeof uid === 'string'));
  let maxId = 0;
  for (const supply of state.supplies) {
    if (!supply || typeof supply !== 'object' || Array.isArray(supply) || Object.keys(supply).some((key) => !['uid', 'itemId', 'star'].includes(key))
      || typeof supply.uid !== 'string' || !/^s[1-9]\d*$/.test(supply.uid) || uids.has(supply.uid)
      || typeof supply.itemId !== 'string' || !Number.isInteger(supply.star) || !defs.some((entry) => entry.id === supply.itemId && entry.allowedStars.includes(supply.star))) invalid('Invalid supply record');
    const numericId = Number(supply.uid.slice(1));
    if (!Number.isSafeInteger(numericId) || ids.has(supply.uid)) invalid('Invalid or duplicate supply uid');
    ids.add(supply.uid); uids.add(supply.uid); maxId = Math.max(maxId, numericId);
  }
  if (state.nextSupplyId <= maxId) invalid('nextSupplyId must exceed all stored supply IDs');
  if (supplySlots(state, ctx) > (ctx.design.system.supplyCapacity ?? 8)) throw codedError('SUPPLY_CAPACITY', 'Supply storage is full');
  return state;
}

export function addSupply(state, ctx, itemId, star) {
  validateSupplies(state, ctx);
  const definition = supplyFor(ctx, itemId);
  if (!definition) throw codedError('UNKNOWN_SUPPLY_ITEM', `Unknown supply item: ${itemId}`);
  if (!Number.isInteger(star) || !definition.allowedStars.includes(star)) invalid('Supply star is not allowed');
  const initialized = Object.hasOwn(state, 'supplies');
  const supplies = initialized ? state.supplies : [];
  const nextId = initialized ? state.nextSupplyId : 1;
  const uid = `s${nextId}`;
  const record = { uid, itemId, star };
  const candidate = { ...state, supplies: [...supplies, record], nextSupplyId: nextId + 1 };
  if (!Number.isSafeInteger(candidate.nextSupplyId)) invalid('nextSupplyId exceeds safe integer range');
  validateSupplies(candidate, ctx);
  state.supplies = candidate.supplies;
  state.nextSupplyId = candidate.nextSupplyId;
  return record;
}

export function generateHourlySupplies(state, ctx, eventKey) {
  if (typeof eventKey !== 'string' || !eventKey.trim()) invalid('eventKey must be non-empty');
  validateSupplies(state, ctx);
  if (state.claimed !== undefined && !Array.isArray(state.claimed)) invalid('claimed must be an array');
  if (state.history !== undefined && !Array.isArray(state.history)) invalid('history must be an array');
  const defs = supplyItems(ctx);
  const machines = (state.supplies ?? []).map((supply) => ({ supply, definition: defs.find((entry) => entry.id === supply.itemId) }))
    .filter(({ definition }) => definition?.kind === 'machine');
  for (const { supply: machine, definition } of machines) {
    const claim = `supply-hour:${eventKey}:${machine.uid}`;
    if (state.claimed?.includes(claim)) continue;
    const pool = (definition.generationPool ?? []).map((id) => defs.find((entry) => entry.id === id))
      .filter((entry) => entry?.kind === 'beverage' && entry.allowedStars.includes(machine.star));
    const capacity = ctx.design.system.supplyCapacity ?? 8;
    if (supplySlots(state, ctx) >= capacity || !pool.length) {
      state.claimed ??= []; state.history ??= [];
      state.claimed.push(claim);
      state.history.push({ kind: 'supplyGenerationSkipped', eventKey, sourceUid: machine.uid, reason: supplySlots(state, ctx) >= capacity ? 'capacity' : 'no-eligible-quality' });
      continue;
    }
    const next = nextUint32(state.rngState >>> 0);
    const item = pool[next.value % pool.length];
    const record = addSupply(state, ctx, item.id, machine.star);
    state.rngState = next.state >>> 0;
    state.claimed ??= []; state.history ??= [];
    state.claimed.push(claim);
    state.history.push({ kind: 'supplyGenerated', eventKey, sourceUid: machine.uid, itemId: record.itemId, star: record.star, uid: record.uid });
  }
  return state;
}
