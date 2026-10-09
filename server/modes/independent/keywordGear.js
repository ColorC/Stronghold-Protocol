/** Stable keyword-gear catalog shared with mode design and the battle plugin. */
const gear = (id, name, params, level = null) => Object.freeze({
  id, name, mechanism: 'keywordGear', params: Object.freeze({ gearId: id, ...params }), level,
});

export const KEYWORD_GEAR = Object.freeze([
  gear('oath-cover', '坚守盟约', {
    wearerGuardBase: 0.10, wearerGuardPerPiece: 0.05, wearerGuardCap: 0.95,
    shareBase: 0.20, sharePerPiece: 0.05, shareCap: 0.90,
  }),
  gear('shield-generator', '护盾发生器', { layersBase: 5, layersPerPiece: 3, growthLayerThreshold: 5 }),
  gear('assault-oath', '突袭盟约', {
    idleSeconds: 10, attackSpeedBase: 30, attackSpeedPerPiece: 20,
    durationBase: 10, durationPerPiece: 1, pollSeconds: 0.1,
  }),
  // Provisional root-side balance values; final player clarification may replace them in the design data.
  gear('hammer-oath', '巨锤盟约', { radius: 0.9, baseAtkRatio: 0.5, perPieceAtkRatio: 0.1 }),
  gear('precision-oath', '精准盟约', { ignoreBase: 0.20, ignorePerPiece: 0.03, ignoreCap: 0.80 }),
  gear('unyielding-oath', '不屈盟约', { baseProbability: 0.18, probabilityPerPiece: 0.004, probabilityCap: 1 }),
  gear('blast-deploy-platform', '爆破部署台', { damageBase: 1000, damagePerPiece: 300, radius: 4, damageType: 'true' }),
  gear('recoil-airdrop', '反冲空降仓', { damageBase: 15000, damagePerPiece: 500, damageType: 'arts' }),
  gear('portable-meltdown-trainer', '便携式融毁教学仪', {
    damageBase: 10000, damagePerPiece: 3000, damageType: 'true', hitEnemyMultiplier: 2, redeployTimeMultiplier: 2,
  }),
]);

export const KEYWORD_GEAR_BY_ID = Object.freeze(Object.fromEntries(KEYWORD_GEAR.map((item) => [item.id, item])));
export const KEYWORD_GEAR_BY_NAME = Object.freeze(Object.fromEntries(KEYWORD_GEAR.map((item) => [item.name, item])));
