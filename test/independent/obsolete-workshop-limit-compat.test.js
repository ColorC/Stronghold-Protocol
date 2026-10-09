import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeEffectFor } from '../../server/modes/independent/native.js';
import { validateWarbandRule, withoutObsoleteWorkshopLimits } from '../../shared/warbandSchema.js';

test('retired Workshop limit keys are recursively removed without mutating input or stripping real durations', () => {
  const source = {
    maxCount: 2,
    nested: [{ perBattle: 1, cooldownSeconds: 2, maxStacks: 4, durationSeconds: 8, deployLimit: 3, cooldown: 6 }],
  };
  const original = structuredClone(source);
  assert.deepEqual(withoutObsoleteWorkshopLimits(source), {
    nested: [{ durationSeconds: 8, deployLimit: 3, cooldown: 6 }],
  });
  assert.deepEqual(source, original);
});

test('authored variants ignore retired caps but still reject unknown fields and non-finite values', () => {
  const productionSource = {
    chessId: 'legacy-authored',
    modeEffects: {
      normal: { prep: [], combat: [{ trigger: 'attack', behavior: 'eventProduction', params: {
        counterEvent: 'attack', counterEvery: 1, outputs: [], maxPerBattle: 1,
      } }] },
      elite: { prep: [], combat: [] },
    },
  };
  const result = nativeEffectFor('legacy-authored', productionSource);
  assert.equal(result.combat[0].params.maxPerBattle, undefined);
  assert.equal(productionSource.modeEffects.normal.combat[0].params.maxPerBattle, 1, 'saved input remains unchanged');

  const conditionSource = { chessId: 'legacy-condition', modeEffects: {
    normal: { prep: [], combat: [{ trigger: 'passive', behavior: 'allyConditionStats', params: {
      match: { faction: '炎' }, countBy: 'operators', maxCount: 1, stats: { attackPercent: 0.1 },
    } }] },
    elite: { prep: [], combat: [] },
  } };
  const unknown = structuredClone(conditionSource);
  unknown.modeEffects.normal.combat[0].params.typo = true;
  assert.throws(() => nativeEffectFor('legacy-authored', unknown), /BAD_ALLY_CONDITION_STATS/);
  const nonFinite = structuredClone(conditionSource);
  nonFinite.modeEffects.normal.combat[0].params.stats.attackPercent = Number.NaN;
  assert.throws(() => nativeEffectFor('legacy-authored', nonFinite), /BAD_MODE_EFFECT_RULE/);
});

test('legacy warband caps normalize while unknown params and invalid stats still fail validation', () => {
  assert.equal(validateWarbandRule({ trigger: 'attack', behavior: 'deathrattleEcho', params: {
    every: 8, faction: '叙拉古', perBattle: 6,
  } }), true);
  assert.equal(validateWarbandRule({ trigger: 'death', behavior: 'retiringEffect', params: {
    perBattle: 2,
    buff: { faction: '炎', stats: { attackPercent: 0.1, maxCount: 1 }, duration: 'battle' },
  } }), true);
  assert.equal(validateWarbandRule({ trigger: 'damaged', behavior: 'warbandEvent', params: {
    event: 'damaged', faction: '罗德岛', targets: 'actor', stats: { attackPercent: 0.1 },
    cooldownSeconds: 2, maxStacks: 4,
  } }), true);
  assert.equal(validateWarbandRule({ trigger: 'gain', behavior: 'factionReaction', params: {
    faction: '炎', mode: 'badge', targets: 'all', count: 1,
    outputs: [{ id: 'precision', quantity: 1 }], maxEventsPerPrep: 2,
  } }), true);
  assert.throws(() => validateWarbandRule({ trigger: 'attack', behavior: 'deathrattleEcho', params: {
    every: 8, faction: '叙拉古', mysteryLimit: 6,
  } }), /BAD_WARBAND_RULE:deathrattleEcho/);
  assert.throws(() => validateWarbandRule({ trigger: 'damaged', behavior: 'warbandEvent', params: {
    event: 'damaged', faction: '罗德岛', targets: 'actor', stats: { attackPercent: Number.NaN },
    cooldownSeconds: 2, maxStacks: 4,
  } }), /BAD_WARBAND_RULE:warbandEvent/);
});
