// Canonical battle effects for the fifteen independent-mode badges. Keeping this table outside
// the simulator lets the independent battle adapter apply them against the operator's actual base.
export const INDEPENDENT_BADGE_STATS = Object.freeze({
  precision: Object.freeze({ stat: 'attackBasePercent', value: 0.02, base: 'atk', flat: 'attackFlat', legacy: ['attackFlat'] }),
  agility: Object.freeze({ stat: 'attackSpeedPercent', value: 0.02, base: 'aspd', flat: 'attackSpeedFlat', legacy: ['attackSpeedFlat'] }),
  vitality: Object.freeze({ stat: 'maxLifeBasePercent', value: 0.03, base: 'maxHp', flat: 'maxLifeFlat', legacy: ['maxLifeFlat'] }),
  defense: Object.freeze({ stat: 'defenseBasePercent', value: 0.02, base: 'def', flat: 'defenceFlat', legacy: ['defenceFlat', 'defenseFlat'] }),
  assault: Object.freeze({ stat: 'attackPercent', value: 0.02 }),
  recovery: Object.freeze({ stat: 'naturalSkillRecoveryPercent', value: 0.02, base: 'spRecovery', flat: 'naturalSkillRecoveryFlat', legacy: ['naturalSkillRecoveryFlat'] }),
  arcane: Object.freeze({ stat: 'artsDamageReduction', value: 0.005 }),
  foresight: Object.freeze({ stat: 'skillCostInitialPercent', value: 0.02 }),
  miracle: Object.freeze({ stat: 'physicalAndArtsDodge', value: 0.01 }),
  investor: Object.freeze({ stat: 'maxLifeRecoveryPercent', value: 0.001, base: 'maxHp', flat: 'lifeRecoveryFlat', legacy: ['lifeRecoveryFlat'] }),
  unyielding: Object.freeze({ stat: 'maxLifePercent', value: 0.03, base: 'maxHp', flat: 'maxLifeFlat', legacy: ['maxLifePercent'] }),
  harmony: Object.freeze({ stat: 'healingDealtPercent', value: 0.01 }),
  coordination: Object.freeze({ stat: 'physicalAndArtsDamageReduction', value: 0.005 }),
  solitary: Object.freeze({ stat: 'redeployTimeReduction', value: 0.01 }),
  mastery: Object.freeze({ stat: 'normalAttackDamagePercent', value: 0.01 }),
});

export function independentBadgeMod(definition, baseStats, quantity) {
  const value = definition.value * quantity;
  if (!definition.base) return null;
  const base = Number(baseStats?.[definition.base]);
  return { [definition.flat]: Number.isFinite(base) && base > 0 ? base * value : 0 };
}
