// Keep every legacy emblem definition readable by old v2 saves; grantAllowed only gates new awards.
export const DISABLED_CURRENT_TRANSFER_IDS = Object.freeze([
  'transfer_holyGun', 'transfer_yela', 'transfer_crown',
  'transfer_breaker', 'transfer_arts', 'transfer_ammo', 'transfer_control', 'transfer_symbiosis', 'transfer_aegir', 'transfer_yan',
]);
export const LEGACY_ONLY_CURRENT_TRANSFER_IDS = Object.freeze(['transfer_babel','transfer_flight','transfer_burn','transfer_sami','transfer_sui']);

export function applyCurrentEquipment(catalog) {
  const equipment = { ...catalog.equipment };
  for (const id of DISABLED_CURRENT_TRANSFER_IDS) delete equipment[id];
  for (const id of LEGACY_ONLY_CURRENT_TRANSFER_IDS) if(equipment[id])equipment[id]={...equipment[id],grantAllowed:false};
  return { ...catalog, equipment };
}
