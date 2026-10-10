import { itemIconUrl } from '../ui/assetUrls.js';

// Exact native art identities for the eight Resonance components and 28 crafted items.
// Asset URLs are resolved only through the caller-provided frozen manifest.
export const RESONANCE_ITEM_ICON_IDS = Object.freeze({
  blade: 'trap_1040_acarm040', staff: 'trap_1073_acarm073', bow: 'trap_1063_acarm063', plate: 'trap_1047_acarm047',
  cloak: 'trap_1055_acarm055', belt: 'trap_1049_acarm049', tear: 'trap_1102_acarm102', crest: 'trap_1124_acarm124',
  giantSlayer: 'trap_1117_acarm117', spellblade: 'trap_1046_acarm046', rapidBlade: 'trap_1044_acarm044', armorAxe: 'trap_1043_acarm043',
  vampBlade: 'trap_1045_acarm045', titanArmor: 'trap_1068_acarm068', duelistCrest: 'trap_1122_acarm122', resonanceStaff: 'trap_1048_acarm048',
  thunderRing: 'trap_1052_acarm052', counterMirror: 'trap_1061_acarm061', arcaneMantle: 'trap_1121_acarm121', lifeSpring: 'trap_1059_acarm059',
  archangelStaff: 'trap_1077_acarm077', berserkBow: 'trap_1067_acarm067', ironWing: 'trap_1118_acarm118', lightCloak: 'trap_1119_acarm119',
  hurricane: 'trap_1076_acarm076', quickCharger: 'trap_1075_acarm075', thornArmor: 'trap_1060_acarm060', golemArmor: 'trap_1078_acarm078',
  guardianPlate: 'trap_1065_acarm065', shockShield: 'trap_1054_acarm054', holyCloak: 'trap_1116_acarm116', redemptionCloak: 'trap_1050_acarm050',
  quietCape: 'trap_1070_acarm070', deepSeaBelt: 'trap_1072_acarm072', vitalEngine: 'trap_1079_acarm079', azureTear: 'trap_1062_acarm062',
});

// Source Set 13 gear rows not among the 36 Resonance recipes use a nearby existing Native
// completed-item illustration. This is a presentation fallback, not a claimed source-art match.
export const SOURCE_GEAR_ICON_IDS = Object.freeze({
  prototype_source_gear_hand_of_justice: 'trap_1062_acarm062', // tear-based sustain item
  prototype_source_gear_morellonomicon: 'trap_1059_acarm059', // damage-over-time / recovery profile
  prototype_source_gear_last_whisper: 'trap_1044_acarm044', // ranged physical damage profile
  prototype_source_gear_protectors_vow: 'trap_1065_acarm065', // defensive shield profile
  prototype_source_gear_guinsoos_rageblade: 'trap_1076_acarm076', // stacking attack-speed profile
  prototype_source_gear_jeweled_gauntlet: 'trap_1048_acarm048', // spell-damage profile
  prototype_source_gear_crownguard: 'trap_1065_acarm065', // defensive shield profile
});

export const NATIVE_ICON_BY_EQUIPMENT_ID = Object.freeze({ ...RESONANCE_ITEM_ICON_IDS, ...SOURCE_GEAR_ICON_IDS });

function nativeRecord(nativeId, itemRecords) {
  if (!nativeId) return null;
  const found = itemRecords.find(item => item.id === nativeId) || itemRecords.find(item => item.trapId === nativeId || item.iconId === nativeId);
  if (found) return found;
  return { id: nativeId, trapId: nativeId, iconId: nativeId };
}

export function resonanceItemPactId(catalog, id) {
  const record = catalog?.equipment?.[id];
  const transfer = record?.effects?.find(effect => ['pact_transfer', 'transfer_pact'].includes(effect?.kind));
  const pactId = transfer?.params?.pactId;
  return typeof pactId === 'string' && pactId ? pactId : null;
}

export function resonanceNativeItem(catalog, id, itemRecords = []) {
  const record = catalog?.equipment?.[id];
  if (!record || !Array.isArray(itemRecords)) return null;
  const mappedIconId = NATIVE_ICON_BY_EQUIPMENT_ID[id];
  if (mappedIconId) return nativeRecord(mappedIconId, itemRecords);
  if (record.kind === 'emblem' || resonanceItemPactId(catalog, id)) return null;
  const direct = record.nativeId || record.nativeItemId || record.itemId || record.trapId || record.iconId;
  if (direct) {
    const found = nativeRecord(direct, itemRecords);
    if (found) return found;
  }
  const byName = itemRecords.find(item => item.name && item.name === record.name);
  return byName || null;
}

export function resolveResonanceItemIconUrl(catalog, id, itemRecords, manifest) {
  const record = catalog?.equipment?.[id];
  if (!record) return null;
  const native = resonanceNativeItem(catalog, id, itemRecords);
  return native ? itemIconUrl(manifest, native) : null;
}
