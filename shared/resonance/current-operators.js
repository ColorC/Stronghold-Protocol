// Current-season operator star-three overlays. Frozen catalogue entries remain the v1 source.
export const CURRENT_OPERATOR_VERSION = 2;

const GENERIC_CONTROL = new Set(['star3_control']);
const GENERIC_ELEMENT_BURST = new Set(['star3_burn', 'star3_necrosis']);

const signatures = Object.freeze({
  chess_char_2_13_a: () => null,
  chess_char_5_03_a: (passive) => ({
    ...passive,
    additionalEffect: null,
    description: '技能期间在正前方路径形成火墙，每秒造成100%攻击力法术伤害并附加10%攻击力灼燃损伤。',
  }),
  chess_char_6_09_a: () => null,
  chess_char_6_11_a: (passive) => ({
    ...passive.additionalEffect,
    description: '本场首次召唤的造物生命提高20%，攻击提高30%。',
  }),
  chess_char_6_03_a: (passive) => ({
    ...passive.additionalEffect,
    description: '每第6次攻击恢复2技力。',
  }),
  chess_char_5_05_a: (passive) => ({
    ...passive.additionalEffect,
    description: '对生命低于35%的敌人造成的物理与法术伤害提高20%。',
  }),
});

const passiveText = (id, passive) => passive?.description ?? '';

export function applyCurrentOperators(catalog) {
  const operators = { ...catalog.operators };
  const playerText = { ...catalog.playerText, operators: { ...catalog.playerText.operators } };

  for (const [id, original] of Object.entries(catalog.operators)) {
    const basePassive = original.stars?.[3]?.passive;
    const custom = signatures[id];
    const nextPassive = custom
      ? custom(basePassive)
      : GENERIC_CONTROL.has(basePassive?.kind) || GENERIC_ELEMENT_BURST.has(basePassive?.kind)
        ? null
        : basePassive?.additionalEffect && (GENERIC_CONTROL.has(basePassive.additionalEffect.kind) || GENERIC_ELEMENT_BURST.has(basePassive.additionalEffect.kind))
          ? { ...basePassive, additionalEffect: null, description: basePassive.description.replace(/(?:本场首次施加控制后恢复15技力。|本场首次(?:灼燃|凋亡)爆发后恢复10技力。)\s*/g, '').trim() }
          : basePassive;
    if (nextPassive === basePassive) continue;

    const stars = { ...original.stars, 3: { ...original.stars[3], passive: nextPassive } };
    operators[id] = { ...original, stars };
    const operatorText = playerText.operators[id];
    if (operatorText?.stars?.[3]) {
      playerText.operators[id] = {
        ...operatorText,
        stars: { ...operatorText.stars, 3: { ...operatorText.stars[3], passiveDescription: passiveText(id, nextPassive) } },
      };
    }
  }
  return { ...catalog, operators, playerText };
}
