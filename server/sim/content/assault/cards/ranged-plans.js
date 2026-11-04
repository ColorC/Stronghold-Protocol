// Offline translation of roster-ranged.json.  The simulation consumes these
// bindings; it never reads or interprets the Chinese design text.
const IDS = [
  'char_4000_jnight','char_253_greyy','char_4051_akkord','char_469_indigo','char_235_jesica','char_126_shotst','char_190_clour','char_440_pinecn','char_366_acdrop','char_4100_caper','char_183_skgoat','char_258_podego','char_484_robrta','char_204_platnm','char_1021_kroos2','char_498_inside','char_279_excu','char_346_aosta','char_002_amiya','char_306_leizi','char_344_beewax','char_373_lionhd','char_341_sntlla','char_4031_liesel','char_388_mint','char_446_aroma','char_4013_kjera','char_4040_rockr','char_4054_malist','char_242_otter','char_145_prove','char_4211_snhunt','char_174_slbell','char_254_vodfox','char_4079_haini','char_4032_provs','char_4122_grabds','char_4162_cathy','char_4045_heidi','char_4019_ncdeer','char_103_angel','char_332_archet','char_430_fartth','char_4193_lemuen','char_391_rosmon','char_1035_wisdel','char_4117_ray','char_213_mostma','char_4027_heyak','char_4133_logos','char_2015_dusk','char_472_pasngr','char_426_billro','char_1046_sbell2','char_1038_whitw2','char_4146_nymph','char_1040_blaze2','char_206_gnosis','char_291_aglina','char_358_lisa','char_1047_halo2','char_1012_skadi2','char_4134_cetsyr','char_4202_haruka','char_2023_ling','char_4072_ironmn','char_245_cello',
];

const TOKEN_IDS = Object.freeze({
  char_484_robrta: 'token_10018_robrta_mach',
  char_344_beewax: 'token_10011_beewax_oblisk',
  char_242_otter: 'token_10004_otter_motter',
  char_254_vodfox: 'token_10006_vodfox_doll',
  char_4162_cathy: 'token_10041_cathy_catsld',
  char_391_rosmon: 'token_10012_rosmon_shield',
  char_1035_wisdel: 'token_10035_wisdel_wward',
  char_4117_ray: 'token_10034_ray_sndbst',
  char_2015_dusk: 'token_10015_dusk_drgn',
  char_1012_skadi2: 'token_10017_skadi2_dedant',
  char_2023_ling: 'token_10020_ling_soul3',
  char_4072_ironmn: 'token_10027_ironmn_pile2',
});

export const rangedPlans = Object.freeze(Object.fromEntries(IDS.map((charId) => [charId, Object.freeze({
  charId,
  tokenId: TOKEN_IDS[charId] ?? null,
  moduleMode: 'advancedEffects',
})])));

// These entries are deliberately indexed by source effect position.  New
// cards must add every effect and every retained talent binding here before
// their kit may execute; an absent entry is a development error, not an
// invitation to guess from localized design text at runtime.
export const rangedEffectPlans = Object.freeze({
  char_4000_jnight: Object.freeze({
    skill: Object.freeze([{ target: 'airEnemies', status: 'fragile', valueKey: 'fragile' }, { target: 'rangedAllies' }]),
    modePassives: Object.freeze([{ event: 'statusApplied', source: 'self', status: 'fragile', target: 'self', oncePerDeployment: true }]),
    talents: Object.freeze({ 'assaultTalent:native_talent_0': Object.freeze({ delegatedPassive: true }) }),
    modules: Object.freeze({}),
  }),
  char_4051_akkord: Object.freeze({
    skill: Object.freeze([
      Object.freeze({ target: 'allyCenters', damageType: 'arts', centerRadius: 1 }),
      Object.freeze({ target: 'self' }),
    ]),
    modePassives: Object.freeze([Object.freeze({ event: 'tick', source: 'self', target: 'self', dynamicAllyAura: true })]),
    talents: Object.freeze({ 'modePassive:0': Object.freeze({ delegatedModePassive: true }) }),
    modules: Object.freeze({ uniequip_002_akkord: Object.freeze({
      star3: Object.freeze({ centerRadius: 2 }),
      star4: Object.freeze({ centerRadius: 2 }),
    }) }),
  }),
  char_469_indigo: Object.freeze({
    skill: Object.freeze([
      Object.freeze({ target: 'rangeEnemies', damageType: 'arts' }),
      Object.freeze({ target: 'rangeEnemies', status: 'bind', probabilityKey: 'prob' }),
      Object.freeze({ target: 'rangeEnemies', status: 'bind', fieldTick: true }),
    ]),
    modePassives: Object.freeze([
      Object.freeze({ event: 'statusApplied', source: 'self', status: 'bind', target: 'self' }),
      Object.freeze({ event: 'attack', source: 'self', target: 'eventTarget', status: 'bind', probabilityKey: 'prob', duration: 4 }),
    ]),
    talents: Object.freeze({ 'assaultTalent:native_talent_0': Object.freeze({ delegatedModePassive: true }) }),
    modules: Object.freeze({ uniequip_002_indigo: Object.freeze({
      star3: Object.freeze({ bindProbabilityMultiplier: 1.3, storedAttackCap: 4 }),
      star4: Object.freeze({ bindProbabilityMultiplier: 1.3, storedAttackCap: 4, fieldInterval: 0.4 }),
    }) }),
  }),
  char_190_clour: Object.freeze({
    skill: Object.freeze([
      Object.freeze({ target: 'rangeEnemies', count: 2, damageType: 'phys' }),
      Object.freeze({ target: 'self' }),
    ]),
    modePassives: Object.freeze([
      Object.freeze({ event: 'tick', source: 'self', target: 'self', timedSp: true }),
      Object.freeze({ event: 'tick', source: 'self', target: 'self', staticAspd: true }),
    ]),
    talents: Object.freeze({ 'modePassive:0': Object.freeze({ delegatedModePassive: true }) }),
    modules: Object.freeze({ uniequip_002_clour: Object.freeze({
      star3: Object.freeze({ maxTargets: 3, spRateMultiplier: 1 }),
      star4: Object.freeze({ maxTargets: 3, spRateMultiplier: 1.3 }),
    }) }),
  }),
  char_440_pinecn: Object.freeze({
    skill: Object.freeze([
      Object.freeze({ target: 'currentEnemy', damageType: 'phys', defIgnore: true }),
      Object.freeze({ target: 'currentEnemy', damageType: 'phys', frontRowBonus: true }),
    ]),
    modePassives: Object.freeze([
      Object.freeze({ event: 'tick', source: 'self', target: 'self', timedSp: true }),
      Object.freeze({ event: 'hit', source: 'self', target: 'self', condition: 'skillHitSameRow' }),
    ]),
    talents: Object.freeze({ 'modePassive:0': Object.freeze({ delegatedModePassive: true }) }),
    modules: Object.freeze({ uniequip_002_pinecn: Object.freeze({
      star3: Object.freeze({ defIgnoreBonus: 80 }),
      star4: Object.freeze({ defIgnoreBonus: 160 }),
    }) }),
  }),
  char_484_robrta: Object.freeze({
    skill: Object.freeze([
      Object.freeze({ target: 'self', tokenId: 'token_10018_robrta_mach', stockCap: 3, fieldCap: 3 }),
      Object.freeze({ target: 'self' }),
    ]),
    modePassives: Object.freeze([Object.freeze({ event: 'deployed', source: 'self', target: 'meleeAlly', shieldOnDeploy: true })]),
    talents: Object.freeze({ 'assaultTalent:native_talent_0': Object.freeze({ delegatedToken: true }) }),
    modules: Object.freeze({ uniequip_002_robrta: Object.freeze({
      star3: Object.freeze({ shieldLayers: 3 }),
      star4: Object.freeze({ shieldLayers: 3, skillDurationBonus: 3 }),
    }) }),
  }),
  char_366_acdrop: Object.freeze({
    skill: Object.freeze([{ target: 'currentEnemy', damageType: 'phys' }, { target: 'self' }]),
    modePassives: Object.freeze([
      Object.freeze({ event: 'hit', source: 'self', target: 'eventTarget', damageFloor: true }),
      Object.freeze({ event: 'hit', source: 'self', target: 'self', condition: 'frontTwo' }),
    ]),
    talents: Object.freeze({ 'modePassive:0': Object.freeze({ delegatedModePassive: true }) }),
    modules: Object.freeze({ uniequip_002_acdrop: Object.freeze({
      star3: Object.freeze({ skillScaleBonus: 0.15 }),
      star4: Object.freeze({ skillScaleBonus: 0.3 }),
    }) }),
  }),
  char_4100_caper: Object.freeze({
    skill: Object.freeze([
      Object.freeze({ target: 'rangeEnemies', count: 1, excludeCurrent: true, damageType: 'phys' }),
      Object.freeze({ target: 'self' }),
    ]),
    modePassives: Object.freeze([Object.freeze({ event: 'attack', source: 'self', target: 'eventTarget', critChance: 0.25, critScale: 1.5 })]),
    talents: Object.freeze({ 'assaultTalent:native_talent_0': Object.freeze({ delegatedPassive: true }) }),
    modules: Object.freeze({ uniequip_002_caper: Object.freeze({
      star3: Object.freeze({ skillScaleBonus: 0.2 }),
      star4: Object.freeze({ skillScaleBonus: 0.3 }),
    }) }),
  }),
  char_183_skgoat: Object.freeze({
    skill: Object.freeze([Object.freeze({ target: 'rangeEnemies', deviceField: 'sand' })]),
    modePassives: Object.freeze([
      Object.freeze({ event: 'hit', source: 'self', target: 'eventTarget', status: 'slow', valueKey: 'slow' }),
      Object.freeze({ event: 'statusApplied', source: 'self', target: 'self', status: 'slow', successfulSlow: true }),
    ]),
    talents: Object.freeze({ 'modePassive:0': Object.freeze({ delegatedModePassive: true }) }),
    modules: Object.freeze({ uniequip_002_skgoat: Object.freeze({
      star3: Object.freeze({ intervalBonus: 0.2, slowBonus: 0.1 }),
      star4: Object.freeze({ intervalBonus: 0.2, slowBonus: 0.1, durationBonus: 3 }),
    }) }),
  }),
  char_258_podego: Object.freeze({
    skill: Object.freeze([Object.freeze({ target: 'rangeEnemies', deviceField: 'spores' })]),
    modePassives: Object.freeze([
      Object.freeze({ event: 'tick', source: 'self', target: 'supportAllies', supportAura: true }),
      Object.freeze({ event: 'attack', source: 'self', target: 'rangeAllies', everyThird: true }),
    ]),
    talents: Object.freeze({ 'modePassive:0': Object.freeze({ delegatedModePassive: true }) }),
    modules: Object.freeze({ uniequip_002_podego: Object.freeze({
      star3: Object.freeze({ auraBonus: 0.03 }),
      star4: Object.freeze({ auraBonus: 0.06 }),
    }) }),
  }),
  char_204_platnm: Object.freeze({
    skill: Object.freeze([Object.freeze({ target: 'currentEnemy', damageType: 'phys' }), Object.freeze({ target: 'self' })]),
    modePassives: Object.freeze([Object.freeze({ event: 'hit', source: 'self', target: 'eventTarget', chargeShot: true })]),
    talents: Object.freeze({ 'modePassive:0': Object.freeze({ delegatedModePassive: true }) }),
    modules: Object.freeze({ uniequip_002_platnm: Object.freeze({ star3: Object.freeze({ chargeCapBonus: 0.15 }), star4: Object.freeze({ chargeCapBonus: 0.2 }) }) }),
  }),
  char_1021_kroos2: Object.freeze({
    skill: Object.freeze([Object.freeze({ target: 'currentEnemy', damageType: 'phys' }), Object.freeze({ target: 'self', nativeCounter: true })]),
    modePassives: Object.freeze([Object.freeze({ event: 'hit', source: 'self', target: 'eventTarget', critChance: 0.2, critScale: 1.5 })]),
    talents: Object.freeze({ 'assaultTalent:native_talent_0': Object.freeze({ delegatedPassive: true }) }),
    modules: Object.freeze({ uniequip_002_kroos2: Object.freeze({ star3: Object.freeze({ thresholdMultiplier: 0.8 }), star4: Object.freeze({ thresholdMultiplier: 0.7 }) }) }),
  }),
  char_498_inside: Object.freeze({
    skill: Object.freeze([Object.freeze({ target: 'currentEnemy', damageType: 'phys' }), Object.freeze({ target: 'self', ammoCost: true })]),
    modePassives: Object.freeze([Object.freeze({ event: 'death', source: 'self', target: 'eventTarget', ammoReload: true }), Object.freeze({ event: 'tick', source: 'self', target: 'self', delayedAmmoCap: true })]),
    talents: Object.freeze({ 'modePassive:1': Object.freeze({ delegatedModePassive: true }) }),
    modules: Object.freeze({ uniequip_002_inside: Object.freeze({ star3: Object.freeze({ ammoCapBonus: 2 }), star4: Object.freeze({ ammoCapBonus: 3 }) }) }),
  }),
  char_235_jesica: Object.freeze({
    skill: Object.freeze([{ target: 'currentEnemy', damageType: 'phys' }]),
    modePassives: Object.freeze([{ target: 'skillTargetAirFollowup' }, { target: 'selfPostSkillBuff' }]),
    talents: Object.freeze({ 'assaultTalent:native_talent_0': Object.freeze({ staticBuff: Object.freeze({ attackSpeed: 12 }) }) }),
    modules: Object.freeze({ uniequip_002_jesica: Object.freeze({
      star3: Object.freeze({ skillScaleBonus: 0.3, airBonus: 0.2, airFollowupMultiplier: 1 }),
      star4: Object.freeze({ skillScaleBonus: 0.3, airBonus: 0.2, airFollowupMultiplier: 1.5 }),
    }) }),
  }),
  char_126_shotst: Object.freeze({
    skill: Object.freeze([{ target: 'currentEnemy', damageType: 'phys' }, { target: 'currentEnemy', status: 'defDown', valueKey: 'defDown' }]),
    modePassives: Object.freeze([{ event: 'statusApplied', source: 'self', status: 'defDown', target: 'self' }]),
    talents: Object.freeze({ 'assaultTalent:native_talent_0': Object.freeze({ airDamageMultiplier: Object.freeze([1.2, 1.2, 1.35, 1.35]) }) }),
    modules: Object.freeze({ uniequip_002_shotst: Object.freeze({
      star3: Object.freeze({ skillScaleBonus: 0.25, defDownBonus: 0.05 }),
      star4: Object.freeze({ skillScaleBonus: 0.25, defDownBonus: 0.05, airDurationBonus: 2 }),
    }) }),
  }),
  char_279_excu: Object.freeze({
    skill: Object.freeze([{ target: 'rangeEnemies', count: 'all', damageType: 'phys' }]),
    modePassives: Object.freeze([{ event: 'hit', source: 'self', target: 'self', condition: 'skillHitSameRow' }]),
    talents: Object.freeze({ 'assaultTalent:native_talent_0': Object.freeze({ defIgnoreFlat: 160 }) }),
    modules: Object.freeze({ uniequip_002_excu: Object.freeze({
      star3: Object.freeze({ hitScaleBonus: 0.15, defIgnoreBonus: 40 }),
      star4: Object.freeze({ hitScaleBonus: 0.25, defIgnoreBonus: 40 }),
    }) }),
  }),
  char_253_greyy: Object.freeze({
    skill: Object.freeze([
      Object.freeze({ target: 'rangeEnemies', count: 'all', damageType: 'arts' }),
      Object.freeze({ target: 'rangeEnemies', count: 'all', status: 'slow', valueKey: 'slow' }),
    ]),
    modePassives: Object.freeze([
      Object.freeze({ event: 'statusApplied', source: 'self', status: 'slow', target: 'self' }),
    ]),
    talents: Object.freeze({
      'assaultTalent:native_talent_0': Object.freeze({ event: 'attack', source: 'self', target: 'eventTarget', status: 'slow', duration: 0.6, moduleDurationKey: 'attackSlowDuration' }),
    }),
    modules: Object.freeze({
      uniequip_002_greyy: Object.freeze({
        star3: Object.freeze({ attackSlowDuration: 0.56, rangeRadius: 1 }),
        star4: Object.freeze({ attackSlowDuration: 0.68, rangeRadius: 1 }),
      }),
    }),
  }),
});

export const rangedCharIds = Object.freeze(IDS.slice(0, 17));
export const rangedTokenIds = Object.freeze(Object.entries(TOKEN_IDS).filter(([owner]) => rangedCharIds.includes(owner)).map(([, tokenId]) => tokenId));
