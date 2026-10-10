import {
  resonanceLegacySeason,
  resonanceLegacySeasonOperatorIds,
  resonanceLegacySeasonTraitOverrides,
} from './legacy-season-roster.js';

/** The current default season is fixed across seed, opening, difficulty, and faction. */
export const resonanceSeason = Object.freeze({ id: 'resonance-season-2', displayName: '共鸣' });
export const resonanceSeasonQuotas = Object.freeze({ 1:14, 2:13, 3:14, 4:14, 5:10 });
export const resonanceSeasonTraitOverrides = Object.freeze({
  chess_char_6_03_a: Object.freeze(['sui']),
});
export const resonanceSeasonOperatorIds = Object.freeze([
  // 1费
  'chess_char_1_02_a', 'chess_char_1_07_a', 'chess_char_1_10_a', 'chess_char_1_12_a',
  'chess_char_2_14_a', 'chess_char_1_18_a', 'chess_char_2_12_a', 'chess_char_2_01_a',
  'chess_char_1_09_a', 'chess_char_1_14_a', 'chess_char_1_17_a', 'chess_char_2_15_a',
  'chess_char_1_05_a', 'chess_native_char_385_finlpp_a',
  // 2费
  'chess_char_1_01_a', 'chess_char_4_01_a', 'chess_char_1_11_a', 'chess_char_1_03_a',
  'chess_char_1_04_a', 'chess_char_1_08_a', 'chess_char_1_19_a', 'chess_char_2_13_a',
  'chess_char_2_06_a', 'chess_char_3_04_a', 'chess_char_4_08_a', 'chess_native_char_220_grani_a',
  'chess_char_2_04_a',
  // 3费
  'chess_char_3_05_a', 'chess_char_4_12_a', 'chess_char_3_01_a', 'chess_char_3_11_a',
  'chess_char_4_14_a', 'chess_char_3_02_a', 'chess_char_3_03_a', 'chess_char_2_17_a',
  'chess_char_4_04_a', 'chess_char_2_11_a', 'chess_native_char_4119_wanqin_a', 'chess_char_4_21_a',
  'chess_char_3_06_a', 'chess_char_3_19_a',
  // 4费
  'chess_char_3_12_a', 'chess_char_3_14_a', 'chess_char_4_16_a', 'chess_char_4_24_a',
  'chess_char_4_07_a', 'chess_char_5_11_a', 'chess_char_5_13_a', 'chess_char_5_17_a',
  'chess_char_5_21_a', 'chess_char_5_22_a', 'chess_char_6_08_a', 'chess_char_5_15_a',
  'chess_char_6_19_a', 'chess_char_2_16_a',
  // 5费
  'chess_char_4_25_a', 'chess_char_5_05_a', 'chess_char_6_02_a', 'chess_char_6_03_a',
  'chess_native_char_2023_ling_a', 'chess_native_char_2025_shu_a', 'chess_char_6_13_a',
  'chess_char_6_09_a', 'chess_char_6_07_a', 'chess_char_5_03_a',
]);

export const resonanceSeasons = Object.freeze({
  [resonanceLegacySeason.id]: Object.freeze({
    ...resonanceLegacySeason,
    operatorIds: resonanceLegacySeasonOperatorIds,
    traitOverrides: resonanceLegacySeasonTraitOverrides,
    quotas: resonanceSeasonQuotas,
  }),
  [resonanceSeason.id]: Object.freeze({
    ...resonanceSeason,
    operatorIds: resonanceSeasonOperatorIds,
    traitOverrides: resonanceSeasonTraitOverrides,
    quotas: resonanceSeasonQuotas,
  }),
});

export function getResonanceSeason(seasonId) {
  return resonanceSeasons[seasonId] ?? null;
}

export function validateResonanceSeasonRoster(operators, ids = resonanceSeasonOperatorIds, quotas = resonanceSeasonQuotas) {
  if (!Array.isArray(ids) || ids.length !== 65 || new Set(ids).size !== ids.length) throw new Error('RESONANCE_BAD_SEASON_ROSTER');
  const members = ids.map(id => {
    const operator = Object.hasOwn(operators ?? {}, id) ? operators[id] : null;
    if (!operator) throw new Error('RESONANCE_UNKNOWN_SEASON_OPERATOR:' + id);
    return operator;
  });
  if (new Set(members.map(operator => operator.charId)).size !== members.length) throw new Error('RESONANCE_DUPLICATE_SEASON_IDENTITY');
  if (members.some(operator => !Array.isArray(operator.pacts) || operator.pacts.length > 3)) throw new Error('RESONANCE_SEASON_TRAIT_LIMIT');
  for (const [cost, count] of Object.entries(quotas))
    if (members.filter(operator => operator.cost === Number(cost)).length !== count) throw new Error('RESONANCE_BAD_SEASON_QUOTA:' + cost);
  const starters = members.filter(operator => operator.cost === 1);
  if (starters.filter(operator => operator.role === 'frontline').length < 2 || starters.filter(operator => operator.position === 'RANGED').length < 1 || !starters.some(operator => operator.role === 'healer'))
    throw new Error('RESONANCE_SEASON_STARTERS_UNAVAILABLE');
  return [...ids];
}
