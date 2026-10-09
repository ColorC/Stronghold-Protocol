/** The published season roster is explicit and never depends on opening, seed, difficulty or faction. */
export const resonanceSeason = Object.freeze({ id: 'resonance-season-1', displayName: '共鸣' });
export const resonanceSeasonQuotas = Object.freeze({ 1:14, 2:13, 3:14, 4:14, 5:10 });
// New-season design classification: Yu's dialogue calls Nian, Ling and Shu siblings.
// https://wiki.biligame.com/arknights/%E4%BD%99 (reporting-in / New Year voice lines).
// https://ak.hypergryph.com/archive/dynamicCompile/202501414.html establishes Yu's identity;
// it is not evidence that the official page explicitly assigns the Sui family trait.
// Native bonds and the legacy generated catalog do not contain this Sui tag.
export const resonanceSeasonTraitOverrides = Object.freeze({
  chess_char_6_03_a: Object.freeze(['sui']),
});
export const resonanceSeasonOperatorIds = Object.freeze([
  "chess_char_1_02_a",
  "chess_char_1_05_a",
  "chess_char_1_06_a",
  "chess_char_1_07_a",
  "chess_char_1_10_a",
  "chess_char_1_12_a",
  "chess_char_1_13_a",
  "chess_char_1_18_a",
  "chess_char_2_01_a",
  "chess_char_2_12_a",
  "chess_char_4_11_a",
  "chess_native_char_190_clour_a",
  "chess_native_char_385_finlpp_a",
  "chess_native_char_4019_ncdeer_a",
  "chess_char_1_01_a",
  "chess_char_1_04_a",
  "chess_char_1_19_a",
  "chess_char_2_04_a",
  "chess_char_2_08_a",
  "chess_char_2_13_a",
  "chess_char_3_07_a",
  "chess_char_4_05_a",
  "chess_char_4_08_a",
  "chess_native_char_155_tiger_a",
  "chess_native_char_346_aosta_a",
  "chess_native_char_4032_provs_a",
  "chess_native_char_4222_taraxa_a",
  "chess_char_3_01_a",
  "chess_char_3_05_a",
  "chess_char_3_06_a",
  "chess_char_3_08_a",
  "chess_char_3_19_a",
  "chess_char_3_21_a",
  "chess_char_4_04_a",
  "chess_char_4_12_a",
  "chess_char_4_13_a",
  "chess_char_4_14_a",
  "chess_char_4_21_a",
  "chess_char_6_15_a",
  "chess_native_char_154_morgan_a",
  "chess_native_char_4119_wanqin_a",
  "chess_char_3_12_a",
  "chess_char_3_14_a",
  "chess_char_4_20_a",
  "chess_char_5_10_a",
  "chess_char_5_11_a",
  "chess_char_5_13_a",
  "chess_char_5_17_a",
  "chess_char_5_21_a",
  "chess_char_5_22_a",
  "chess_char_6_04_a",
  "chess_char_6_16_a",
  "chess_char_6_19_a",
  "chess_char_6_20_a",
  "chess_native_char_4065_judge_a",
  "chess_char_4_25_a",
  "chess_char_5_03_a",
  "chess_char_5_05_a",
  "chess_char_6_02_a",
  "chess_char_6_03_a",
  "chess_char_6_07_a",
  "chess_char_6_09_a",
  "chess_char_6_11_a",
  "chess_char_6_13_a",
  "chess_char_6_17_a",
]);

export function validateResonanceSeasonRoster(operators, ids = resonanceSeasonOperatorIds) {
  if (!Array.isArray(ids) || ids.length !== 65 || new Set(ids).size !== ids.length) throw new Error('RESONANCE_BAD_SEASON_ROSTER');
  const members = ids.map(id => {
    const operator = Object.hasOwn(operators ?? {}, id) ? operators[id] : null;
    if (!operator) throw new Error('RESONANCE_UNKNOWN_SEASON_OPERATOR:' + id);
    return operator;
  });
  if (new Set(members.map(operator => operator.charId)).size !== members.length) throw new Error('RESONANCE_DUPLICATE_SEASON_IDENTITY');
  if (members.some(operator => !Array.isArray(operator.pacts) || operator.pacts.length > 3)) throw new Error('RESONANCE_SEASON_TRAIT_LIMIT');
  for (const [cost, count] of Object.entries(resonanceSeasonQuotas))
    if (members.filter(operator => operator.cost === Number(cost)).length !== count) throw new Error('RESONANCE_BAD_SEASON_QUOTA:' + cost);
  const starters = members.filter(operator => operator.cost === 1);
  if (starters.filter(operator => operator.role === 'frontline').length < 2 || starters.filter(operator => operator.position === 'RANGED').length < 1 || !starters.some(operator => operator.role === 'healer'))
    throw new Error('RESONANCE_SEASON_STARTERS_UNAVAILABLE');
  return [...ids];
}
