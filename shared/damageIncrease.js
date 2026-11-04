/** Apply one explicitly outgoing damage factor. Independent operator increases share a linear bonus bucket. */
export function applyDamageIncrease(battle, source, dmg, scale) {
  if (!dmg || typeof dmg !== 'object') return;
  const value = Number(scale);
  const independentOperator = (battle?.contentMode === 'independent' || !!battle?.flags?.independent)
    && source?.side === 'ally' && source?.kind === 'op' && dmg.type !== 'element';
  if (independentOperator && Number.isFinite(value) && value > 1) {
    dmg.damageIncreaseBonus = (Number.isFinite(Number(dmg.damageIncreaseBonus)) ? Number(dmg.damageIncreaseBonus) : 0) + value - 1;
    return;
  }
  // Keep reductions, zero, negative and non-finite values on the original multiplier path.
  dmg.mul *= value;
}
