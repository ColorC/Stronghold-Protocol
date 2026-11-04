import { uid } from './primitives.js';

const count = (value, label) => {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`assault ammo ${label} must be a nonnegative integer`);
  return value;
};

// Card kits keep ownership of their actual counter. This adapter shares that
// counter with other cards and collectibles; it never creates a second pool.
export function registerAssaultAmmo(battle, unit, { get, set, max } = {}) {
  if (!battle?.assaultStrict || !unit || ![get, set, max].every((fn) => typeof fn === 'function')) {
    throw new TypeError('assault ammo requires its battle, unit and actual counter accessors');
  }
  count(get(), 'current'); count(max(), 'capacity');
  const controller = { battle, get, set, max };
  // Like Unit.def/ownerUnit, this reference must not expose the full battle
  // graph to serialization or assertion diagnostics.
  Object.defineProperty(unit, '_assaultAmmoController', { value: controller, writable: true, configurable: true });
  return controller;
}

export function unregisterAssaultAmmo(unit, controller = unit?._assaultAmmoController) {
  if (unit?._assaultAmmoController !== controller) return false;
  delete unit._assaultAmmoController;
  return true;
}

export function assaultAmmoCapacityBonus(unit) {
  return Object.values(unit?.mem?.assaultAmmoCapacityBonuses ?? {}).reduce((sum, amount) => sum + count(amount, 'capacity bonus'), 0);
}

export function setAssaultAmmoCapacityBonus(unit, sourceKey, amount) {
  if (!unit || typeof sourceKey !== 'string' || !sourceKey) throw new TypeError('assault ammo capacity bonus requires its owner and source key');
  count(amount, 'capacity bonus');
  unit.mem ??= {};
  unit.mem.assaultAmmoCapacityBonuses ??= {};
  const previous = unit.mem.assaultAmmoCapacityBonuses[sourceKey] ?? 0;
  unit.mem.assaultAmmoCapacityBonuses[sourceKey] = amount;
  return amount - previous;
}

export function assaultAmmoState(unit) {
  const controller = unit?._assaultAmmoController;
  if (!controller) return null;
  return { current: count(controller.get(), 'current'),
    capacity: count(controller.max(), 'capacity') + assaultAmmoCapacityBonus(unit) };
}

export function reloadAssaultAmmo(battle, source, target, amount, sourceKey) {
  count(amount, 'reload');
  const state = assaultAmmoState(target);
  if (!state) return 0;
  // New D-type cards count casts for the whole battle. An authored reload
  // restores that pool fully; legacy native clips retain their numeric grant
  // only until their own card is migrated.
  if (target.mem?.assaultCastAmmo && amount > 0) amount = state.capacity;
  const net = Math.max(0, Math.min(state.capacity - state.current, amount));
  if (!net) return 0;
  target._assaultAmmoController.set(state.current + net);
  battle.emit('reloaded', { source, sourceUid: uid(source), target, targetUid: uid(target), unit: target,
    amount: net, left: state.current + net, ammoMax: state.capacity, assaultAmmo: true, sourceKey, skill: target.skill });
  return net;
}

export function consumeAssaultAmmo(battle, unit, amount, sourceKey, { partial = false, isSkill = false } = {}) {
  count(amount, 'consume');
  const state = assaultAmmoState(unit);
  if (!state || !amount || (!partial && state.current < amount)) return 0;
  const net = Math.min(state.current, amount);
  if (!net) return 0;
  unit._assaultAmmoController.set(state.current - net);
  battle.emit('ammoUsed', { source: unit, sourceUid: uid(unit), target: unit, targetUid: uid(unit), unit,
    amount: net, quantity: net, left: state.current - net, ammoMax: state.capacity, assaultAmmo: true, sourceKey, isSkill, skill: unit.skill });
  return net;
}
