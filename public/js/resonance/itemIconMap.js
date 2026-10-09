import { itemIconUrl, profIconUrl } from '../ui/assetUrls.js';

const NATIVE_BY_PART = Object.freeze({
  blade: 'chess_item_1_01_e_a', staff: 'chess_item_3_08_e_a', bow: 'chess_item_3_02_e_a',
  plate: 'chess_item_1_02_e_a', cloak: 'chess_item_4_04_e_a', belt: 'chess_item_3_06_e_a',
  tear: 'chess_item_3_05_e_a', crest: 'chess_item_1_04_e_a',
});
const SEMANTIC_NATIVE = [
  [/coin|gold|econom|income|fund|利息|金币|经济|资金/, 'chess_item_1_03_e_a'],
  [/shield|armor|armour|health|surviv|defen|生命|护盾|防御|生存/, 'chess_item_1_02_e_a'],
  [/spell|magic|arts|mana|energy|skill|法术|术|技力|能量/, 'chess_item_3_08_e_a'],
  [/bow|range|bullet|snip|射程|子弹|狙击|弓/, 'chess_item_3_02_e_a'],
  [/cloak|stealth|evasion|隐匿|伪装/, 'chess_item_4_04_e_a'],
  [/crest|bond|pact|emblem|盟约|徽章|纹章/, 'chess_item_1_04_e_a'],
  [/belt|speed|haste|attack.?speed|攻速|速度/, 'chess_item_3_10_e_a'],
  [/blade|sword|attack|damage|strike|剑|刀|攻击|伤害/, 'chess_item_1_01_e_a'],
];
const FALLBACK_PROF = Object.freeze({ staff: 'CASTER', tear: 'MEDIC', crest: 'SUPPORT', plate: 'TANK', cloak: 'SPECIAL', bow: 'SNIPER', belt: 'PIONEER', blade: 'WARRIOR' });

export function resonanceNativeItem(catalog, id, itemRecords = []) {
  const record = catalog?.equipment?.[id];
  if (!record || !Array.isArray(itemRecords)) return null;
  const direct = record.nativeId || record.nativeItemId || record.itemId || record.trapId || record.iconId;
  if (direct) {
    const found = itemRecords.find(item => item.id === direct) || itemRecords.find(item => item.trapId === direct || item.iconId === direct);
    if (found) return found;
  }
  const byName = itemRecords.find(item => item.name && item.name === record.name);
  if (byName) return byName;
  // Completed items use their actual recipe component as the icon source. This keeps component identity
  // visible across the whole catalog instead of collapsing every damage or health effect to one glyph.
  const parts = Array.isArray(record.parts) ? record.parts : [];
  const part = parts.find(value => NATIVE_BY_PART[value]) || (NATIVE_BY_PART[id] ? id : null);
  if (part) return itemRecords.find(item => item.id === NATIVE_BY_PART[part]) || null;
  const meaning = `${id} ${record.name || ''} ${record.description || ''} ${JSON.stringify(record.effects || {})}`.toLowerCase();
  const nativeId = SEMANTIC_NATIVE.find(([pattern]) => pattern.test(meaning))?.[1];
  if (nativeId) return itemRecords.find(item => item.id === nativeId) || null;
  const fallbackPart = Object.keys(NATIVE_BY_PART).find(key => meaning.includes(key));
  return fallbackPart ? itemRecords.find(item => item.id === NATIVE_BY_PART[fallbackPart]) || null : null;
}

export function resolveResonanceItemIconUrl(catalog, id, itemRecords, manifest) {
  const record = catalog?.equipment?.[id];
  if (!record) return null;
  const native = resonanceNativeItem(catalog, id, itemRecords);
  const nativeUrl = native ? itemIconUrl(manifest, native) : null;
  if (nativeUrl) return nativeUrl;
  const part = (record.parts || []).find(value => FALLBACK_PROF[value]) || id;
  return profIconUrl(manifest, FALLBACK_PROF[part] || FALLBACK_PROF[id] || 'SUPPORT');
}
