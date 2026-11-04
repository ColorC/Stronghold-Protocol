const clone = value => structuredClone(value);
const CARRY_LIMIT = 3;
const PREP_PHASES = new Set(['prep', 'choice']);
const QUALITY = new Set(['artifact', 'support', 'radiant', 'radiant_conversion']);
const REMOVER = 'prototype_item_remover';
const REFORGER = 'prototype_reforger';
const THIEFS = 'prototype_thiefs_gloves';
const CROWN = 'prototype_roster_crown';
const RADIANT_CONVERSION = 'prototype_radiant_conversion';
const ANVILS = Object.freeze({
  prototype_chem_market_anvil: { pool: 'chemBaron', quality: null },
  prototype_chem_silver_anvil: { pool: 'chemBaronSilver', quality: null, tier: 'Silver' },
  prototype_chem_gold_anvil: { pool: 'chemBaronGold', quality: null, tier: 'Gold' },
  prototype_chem_prismatic_anvil: { pool: 'chemBaronPrismatic', quality: null, tier: 'Prismatic' },
  prototype_chem_omega_anvil: { pool: 'chemBaronOmegaPrismatic', quality: null, tier: 'OmegaPrismatic' },
  prototype_completed_anvil: { pool: 'completed', quality: null },
  prototype_artifact_anvil: { pool: 'artifact', quality: 'artifact' },
  prototype_support_anvil: { pool: 'support', quality: 'support' },
  prototype_radiant_anvil: { pool: 'radiant', quality: 'radiant' },
});
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function inventoryCapacity(catalog) {
  return Math.max(0, Math.floor(finite(catalog?.campaign?.economy?.inventoryCapacity, 10)));
}
function consumableIndex(state, uid) {
  return (state.consumables ?? []).findIndex(row => String(row.uid) === String(uid));
}
function equipmentLocation(state, itemUid) {
  for (const piece of state.pieces ?? []) {
    const index = (piece.equipment ?? []).findIndex(item => String(item.uid) === String(itemUid));
    if (index >= 0) return { kind: 'piece', piece, index, item: piece.equipment[index] };
  }
  const index = (state.inventory ?? []).findIndex(item => String(item.uid) === String(itemUid));
  return index >= 0 ? { kind: 'inventory', index, item: state.inventory[index] } : null;
}
function deterministicIndex(seed, size) {
  let hash = 2166136261;
  for (const ch of String(seed)) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return size ? (hash >>> 0) % size : -1;
}
function gearPool(catalog, quality) {
  const pool = catalog?.prototypeEconomy?.gearPools?.[quality];
  return Array.isArray(pool) ? pool.filter(id => catalog?.equipment?.[id]?.grantAllowed !== false) : [];
}
function createAnvilDraft(state, catalog, consumable, kind) {
  const definition = ANVILS[kind], quality = definition.quality, tier = definition.tier ?? null;
  const eligibleIds = gearPool(catalog, definition.pool).filter(id => {
    const item = catalog.equipment?.[id];
    return item && item.kind !== 'emblem' && item.kind !== 'component';
  }).sort();
  if (!eligibleIds.length) throw new Error(`PROTOTYPE_GEAR_POOL_EMPTY:${quality}`);
  const options = eligibleIds.map(id => {
    const item = catalog.equipment[id];
    return { id: `gear-${quality}-${id}`, label: item.name ?? '装备', description: item.description ?? '',
      cost: { currency: 'gold', amount: 0 }, grant: [{ kind: 'item', id, ...(quality ? { quality } : {}) }] };
  });
  return { type: 'prototype_economy', source: tier ? 'risk' : 'conqueror', economyKind: 'gear_anvil', remaining: 1,
    options:options.map((row)=>({...row,description:tier?`${tier}险境装备。${row.description}`:row.description})), metadata: { key: `gear-anvil:${consumable.uid}`, consumableUid: consumable.uid, pool: definition.pool, quality, tier, eligibleIds } };
}

/** Pure gear-consumable transition. Session assigns IDs for returned grant events and choice UIDs. */
export function applyPrototypeGearAction(state, catalog = {}, action = {}) {
  if (action?.type !== 'useConsumable') throw new Error('PROTOTYPE_GEAR_ACTION_REQUIRED');
  const next = clone(state), events = [], choiceDrafts = [];
  if (!PREP_PHASES.has(next.phase)) throw new Error('PROTOTYPE_GEAR_ACTION_WRONG_PHASE');
  const index = consumableIndex(next, action.consumableUid);
  if (index < 0) throw new Error('PROTOTYPE_GEAR_CONSUMABLE_NOT_FOUND');
  const consumable = next.consumables[index], kind = consumable.kind;
  if (!catalog?.prototypeEconomy?.gearConsumables?.[kind]) throw new Error('PROTOTYPE_GEAR_CONSUMABLE_NOT_ALLOWED');

  if (action.choiceUid != null) {
    const choice = (next.pendingChoices ?? []).find(row => String(row.uid) === String(action.choiceUid));
    if (!choice || choice.type !== 'prototype_economy' || choice.economyKind !== 'gear_anvil'
      || String(choice.metadata?.consumableUid) !== String(consumable.uid)) throw new Error('PROTOTYPE_GEAR_CHOICE_NOT_FOUND');
    const ids = Array.isArray(action.optionIds) ? action.optionIds : [];
    if (ids.length !== 1) throw new Error('PROTOTYPE_GEAR_CHOICE_REQUIRES_ONE_ITEM');
    const option = (choice.options ?? []).find(row => row.id === ids[0]);
    const grant = option?.grant?.[0];
    const allowed = new Set(choice.metadata?.eligibleIds ?? []);
    if (!grant || grant.kind !== 'item' || !allowed.has(grant.id)
      || (grant.quality ?? null) !== (choice.metadata?.quality ?? null)
      || (grant.quality != null && !QUALITY.has(grant.quality)) || catalog.equipment?.[grant.id]?.grantAllowed === false) {
      throw new Error('PROTOTYPE_GEAR_CHOICE_INVALID');
    }
    if ((next.inventory ?? []).length >= inventoryCapacity(catalog)) throw new Error('INVENTORY_CAPACITY');
    next.consumables.splice(index, 1);
    events.push({ type: 'prototype_gear_grant', grant: clone(grant), sourceConsumableUid: consumable.uid });
    return { state: next, events, choiceDrafts };
  }

  if (kind === REMOVER) {
    const location = equipmentLocation(next, action.itemUid);
    if (!location || location.kind !== 'piece') throw new Error('PROTOTYPE_REMOVER_REQUIRES_EQUIPPED_ITEM');
    if ((next.inventory ?? []).length >= inventoryCapacity(catalog)) throw new Error('INVENTORY_CAPACITY');
    location.piece.equipment.splice(location.index, 1);
    next.inventory.push(location.item);
    next.consumables.splice(index, 1);
    events.push({ type: 'prototype_item_removed', itemUid: location.item.uid, pieceUid: location.piece.uid });
  } else if (kind === REFORGER) {
    const location = equipmentLocation(next, action.itemUid);
    if (!location) throw new Error('PROTOTYPE_REFORGER_ITEM_NOT_FOUND');
    const item = catalog.equipment?.[location.item.itemId];
    const peers = Object.values(catalog.equipment ?? {}).filter(row => row.kind === item?.kind && row.id !== item?.id
      && row.grantAllowed !== false && row.kind !== 'emblem' && row.kind !== 'component'
      && !(row.unique === true && location.kind === 'piece'
        && location.piece.equipment.some((held,index) => index !== location.index && held.itemId === row.id))).map(row => row.id).sort();
    if (!peers.length) throw new Error('PROTOTYPE_REFORGER_POOL_EMPTY');
    const selectedId = peers[deterministicIndex(`${next.seed}:${consumable.uid}:${location.item.uid}`, peers.length)];
    location.item.itemId = selectedId;
    delete location.item.quality;
    next.consumables.splice(index, 1);
    events.push({ type: 'prototype_item_reforged', itemUid: location.item.uid, from: item.id, to: selectedId });
  } else if (kind === THIEFS) {
    // `unique` constrains one holder; the two gloves may still roll distinct
    // copies for different operators.
    const eligible = gearPool(catalog, 'completed').sort();
    if (eligible.length < 2) throw new Error('PROTOTYPE_THIEFS_GLOVES_POOL_EMPTY');
    if ((next.inventory ?? []).length + 2 > inventoryCapacity(catalog)) throw new Error('INVENTORY_CAPACITY');
    const first = deterministicIndex(`${next.seed}:${consumable.uid}:1`, eligible.length);
    let second = deterministicIndex(`${next.seed}:${consumable.uid}:2`, eligible.length - 1);
    if (second >= first) second++;
    next.consumables.splice(index, 1);
    events.push({ type: 'prototype_gear_grants', grants: [eligible[first], eligible[second]].map(id => ({ kind: 'item', id })), sourceConsumableUid: consumable.uid });
  } else if (kind === CROWN) {
    const meta = next.prototypeMeta ??= {};
    const economy = meta.economy ??= {};
    economy.rosterExtraCapacity = Math.min(2, finite(economy.rosterExtraCapacity) + 1);
    next.consumables.splice(index, 1);
    events.push({ type: 'prototype_roster_capacity_increased', amount: economy.rosterExtraCapacity });
  } else if (kind === RADIANT_CONVERSION) {
    const location = equipmentLocation(next, action.itemUid);
    if (!location || location.item.quality) throw new Error('PROTOTYPE_RADIANT_CONVERSION_REQUIRES_UNMARKED_ITEM');
    location.item.quality = 'radiant_conversion';
    next.consumables.splice(index, 1);
    events.push({ type: 'prototype_radiant_conversion', itemUid: location.item.uid, itemId: location.item.itemId });
  } else if (ANVILS[kind]) {
    if ((next.pendingChoices ?? []).some(row => row.type === 'prototype_economy' && row.economyKind === 'gear_anvil'
      && String(row.metadata?.consumableUid) === String(consumable.uid))) throw new Error('PROTOTYPE_GEAR_CHOICE_ALREADY_PENDING');
    const choice = createAnvilDraft(next, catalog, consumable, kind);
    choiceDrafts.push(choice);
  } else throw new Error(`PROTOTYPE_GEAR_CONSUMABLE_UNSUPPORTED:${kind}`);

  return { state: next, events, choiceDrafts };
}

export { installPrototypeGearActions } from '../../sim/content/resonance/prototype-gear.js';
