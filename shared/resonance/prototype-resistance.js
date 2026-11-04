/**
 * Set 13 armor and magic resistance are ratings. Native uses flat physical
 * defense and percentage spell resistance, so V3 uses explicit local adapters.
 * Physical defense is anchored to the source unit's attack damage; this is a
 * power-budget equivalence, not a claim that the two games share a formula.
 */
export function tftRatingReduction(rating) {
  const value = Number(rating);
  if (!Number.isFinite(value)) return null;
  return value / (100 + Math.max(0, value));
}

export function tftArmorToNativeDefense(rating, sourceAttackDamage) {
  const reduction = tftRatingReduction(rating);
  const attackDamage = Number(sourceAttackDamage);
  if (reduction == null || !Number.isFinite(attackDamage)) return null;
  return Math.max(0, attackDamage) * reduction;
}

export function tftMrToNativeResistance(rating) {
  const reduction = tftRatingReduction(rating);
  return reduction == null ? null : reduction * 100;
}

export function tftRatingBonusToNative({ armor, magicResist, armorBonus = 0, magicResistBonus = 0, attackDamage }) {
  const baseArmor = Number(armor), baseMr = Number(magicResist);
  const nextArmor = tftArmorToNativeDefense(baseArmor + Number(armorBonus), attackDamage);
  const oldArmor = tftArmorToNativeDefense(baseArmor, attackDamage);
  const nextMr = tftMrToNativeResistance(baseMr + Number(magicResistBonus));
  const oldMr = tftMrToNativeResistance(baseMr);
  return {
    defFlat: nextArmor == null || oldArmor == null ? 0 : nextArmor - oldArmor,
    resFlat: nextMr == null || oldMr == null ? 0 : nextMr - oldMr,
  };
}
