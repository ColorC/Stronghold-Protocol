// Pure inventory grouping, shared by the session engine and the workshop renderer.
export const INVENTORY_STACK_LIMIT = 999;

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
};

/** Configuration is part of an item's identity; key order is not. Stateful singletons keep their uid. */
export function inventoryStackKey(item) {
  return JSON.stringify([String(item.id), stable(item.state || {}), item.state?.uniqueState ? item.uid : null]);
}

export function inventoryStackGroups(items = []) {
  const groups = new Map();
  for (const item of items) {
    if (!item) continue;
    const key = inventoryStackKey(item);
    if (!groups.has(key)) groups.set(key, { key, id: item.id, quantity: 0, items: [] });
    const group = groups.get(key);
    group.quantity += Math.max(0, Math.floor(Number.isFinite(item.quantity) ? item.quantity : 1));
    group.items.push(item);
  }
  return [...groups.values()];
}

/** Only mechanisms that already multiply their effect by quantity permit batch equipping. */
export function quantityEquippable(record) {
  return !!record && !record.unique && (!record.mechanism || ['badge', 'stats', 'growthTraining'].includes(record.mechanism));
}
