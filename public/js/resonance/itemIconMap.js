import { itemIconUrl } from '../ui/assetUrls.js';

// The eight Resonance components and 28 completed items are native 卫戍协议 items: each id shows that item's own
// art (tools/resonance/build-content.mjs records the same iconId). Asset URLs are resolved only through the
// caller-provided frozen manifest.
export const RESONANCE_ITEM_ICON_IDS = Object.freeze({
  blade: 'trap_1041_acarm041', staff: 'trap_1050_acarm050', bow: 'trap_1121_acarm121', plate: 'trap_1047_acarm047',
  cloak: 'trap_1102_acarm102', belt: 'trap_1049_acarm049', tear: 'trap_1051_acarm051', crest: 'trap_1124_acarm124',
  giantSlayer: 'trap_1076_acarm076', spellblade: 'trap_1040_acarm040', rapidBlade: 'trap_1044_acarm044', armorAxe: 'trap_1043_acarm043',
  vampBlade: 'trap_1065_acarm065', titanArmor: 'trap_1117_acarm117', duelistCrest: 'trap_1042_acarm042', resonanceStaff: 'trap_1122_acarm122',
  thunderRing: 'trap_1052_acarm052', counterMirror: 'trap_1045_acarm045', arcaneMantle: 'trap_1048_acarm048', lifeSpring: 'trap_1077_acarm077',
  archangelStaff: 'trap_1125_acarm125', berserkBow: 'trap_1079_acarm079', ironWing: 'trap_1060_acarm060', lightCloak: 'trap_1059_acarm059',
  hurricane: 'trap_1119_acarm119', quickCharger: 'trap_1063_acarm063', thornArmor: 'trap_1078_acarm078', golemArmor: 'trap_1054_acarm054',
  guardianPlate: 'trap_1118_acarm118', shockShield: 'trap_1064_acarm064', holyCloak: 'trap_1062_acarm062', redemptionCloak: 'trap_1055_acarm055',
  quietCape: 'trap_1053_acarm053', deepSeaBelt: 'trap_1068_acarm068', vitalEngine: 'trap_1061_acarm061', azureTear: 'trap_1103_acarm103',
});

// Old Set 13 source-item ids survive only as hidden aliases of native completed items
// (shared/resonance/prototype-source-gear.js): they show the art of the item they now are.
export const SOURCE_GEAR_ICON_IDS = Object.freeze({
  prototype_source_gear_hand_of_justice: RESONANCE_ITEM_ICON_IDS.vampBlade,
  prototype_source_gear_morellonomicon: RESONANCE_ITEM_ICON_IDS.duelistCrest,
  prototype_source_gear_last_whisper: RESONANCE_ITEM_ICON_IDS.quietCape,
  prototype_source_gear_protectors_vow: RESONANCE_ITEM_ICON_IDS.armorAxe,
  prototype_source_gear_guinsoos_rageblade: RESONANCE_ITEM_ICON_IDS.thunderRing,
  prototype_source_gear_jeweled_gauntlet: RESONANCE_ITEM_ICON_IDS.spellblade,
  prototype_source_gear_crownguard: RESONANCE_ITEM_ICON_IDS.vitalEngine,
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
