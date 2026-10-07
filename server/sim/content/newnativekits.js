// Source-backed native kits that do not replace the existing pool's hand-authored tier kits.
// Values are read only from normalized native operator/skill blackboards; descriptions are never parsed.

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const NATIVE_SKILL_SUPPORT = Object.freeze({
  char_235_jesica: Object.freeze(['skchr_jesica_1', 'skchr_jesica_2']),
});

const spTypeOf = (value) => ({ INCREASE_WITH_TIME: 'time', INCREASE_WHEN_ATTACK: 'attack', INCREASE_WHEN_TAKEN: 'hurt', NOT_RECOVER: 'none', time: 'time', attack: 'attack', hurt: 'hurt', none: 'none' })[value] ?? null;

function jessica(bb, chess, def) {
  const skill = def?.skill ?? chess?.skill;
  const id = skill?.id ?? skill?.skillId;
  const spCost = number(skill.spCost);
  const spType = spTypeOf(skill?.spType);
  if (!(spCost > 0) || !spType) return null;
  let skillSpec = null;
  if (id === 'skchr_jesica_1') {
    const atkScale = number(skill.bb?.atk_scale);
    if (!(atkScale > 1)) return null;
    skillSpec = { id, kind: 'instant', spCost, initSp: number(skill.initSp) ?? 0, spType, trigger: 'DEFAULT', attack: { atkScale } };
  } else if (id === 'skchr_jesica_2') {
    const duration = number(skill.duration);
    const atkPct = number(skill.bb?.atk);
    const dodge = number(skill.bb?.prob);
    if (!(duration > 0) || atkPct == null || !(dodge > 0 && dodge <= 1)) return null;
    skillSpec = {
      id, kind: 'duration', duration, spCost, initSp: number(skill.initSp) ?? 0, spType, trigger: 'DEFAULT',
      mods: { atkPct, dodgePhys: dodge, dodgeArts: dodge },
    };
  } else return null;
  const talentAspd = number(chess?.talents?.find((talent) => talent.index === 0)?.bb?.attack_speed);
  return {
    skills: { [id]: skillSpec },
    ...(talentAspd == null ? {} : { talents: { mods: { aspd: talentAspd } } }),
  };
}

export default Object.freeze({
  chess_native_char_235_jesica: jessica,
});
