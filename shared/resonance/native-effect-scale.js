// The native PvE health budget is about four times the pinned TFT unit budget.
// Convert only absolute health/damage quantities; percentages, rating points,
// durations, mana, counts and economic resources retain their source meaning.
export const NATIVE_FLAT_SCALE = 4;
const traitFields = Object.freeze({
  Automata:['MagicDamage'], Scrap:['HPShieldAmount'], Emissary:['BonusHealth'],
  'High Roller':['Bonus1RocketDamage','Bonus2ShieldAmount'],
  'Chem-Baron':['HealthPerSkip'], Dominator:['ShieldAmount'],
  Experiment:['MaxHealth'], Bruiser:['TeamFlatHealth'], Quickstriker:['ShieldAmount'],
});
export function nativeTraitVariables(sourceName, variables) {
  const result = structuredClone(variables);
  for (const key of traitFields[sourceName] ?? [])
    if (Number.isFinite(result[key])) result[key] = Math.round(result[key] * NATIVE_FLAT_SCALE);
  return result;
}
export function nativeFlatAmount(season, value) {
  return Number(value) * (season?.powerModel === 'native-pve' ? NATIVE_FLAT_SCALE : 1);
}
