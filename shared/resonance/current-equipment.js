// v2 removes emblems for unique pacts; the imported legacy catalogue is preserved unchanged.
export const DISABLED_CURRENT_TRANSFER_IDS = Object.freeze([
  'transfer_holyGun', 'transfer_yela', 'transfer_crown',
  'transfer_breaker', 'transfer_arts', 'transfer_ammo', 'transfer_control', 'transfer_symbiosis', 'transfer_aegir', 'transfer_yan',
]);

export function applyCurrentEquipment(catalog) {
  const equipment = { ...catalog.equipment };
  for (const id of DISABLED_CURRENT_TRANSFER_IDS) delete equipment[id];
  return { ...catalog, equipment };
}
