// Source-backed native kits that do not replace the existing pool's hand-authored tier kits.
// Values are read only from normalized native operator/skill blackboards; descriptions are never parsed.

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const NATIVE_SKILL_SUPPORT = Object.freeze({
  char_240_wyvern: Object.freeze(['skchr_wyvern_1']),
  char_235_jesica: Object.freeze(['skchr_jesica_1', 'skchr_jesica_2']),
});
export const NATIVE_DEFAULT_SKILL_IDS = Object.freeze({
  char_240_wyvern: 'skchr_wyvern_1',
  char_235_jesica: 'skchr_jesica_1',
});

const spTypeOf = (value) => ({ INCREASE_WITH_TIME: 'time', INCREASE_WHEN_ATTACK: 'attack', INCREASE_WHEN_TAKEN: 'hurt', NOT_RECOVER: 'none', time: 'time', attack: 'attack', hurt: 'hurt', none: 'none' })[value] ?? null;
const talentMods = (chess, fields) => {
  const source = chess?.talents?.find((talent) => talent.index === 0)?.bb ?? {};
  const mods = Object.fromEntries(fields.map(([sourceKey, targetKey]) => [targetKey, number(source[sourceKey])]).filter(([, value]) => value != null && value !== 0));
  if (!Object.keys(mods).length) return [];
  return [{ install(battle, unit) { battle.addBuff(unit, { key: `native:talent:${unit.def.charId}`, mods, persist: true, allowDead: true }); } }];
};

function vanilla(bb, chess, def) {
  const skill = def?.skill ?? chess?.skill;
  if ((skill?.id ?? skill?.skillId) !== 'skchr_wyvern_1') return null;
  const atkPct = number(skill.bb?.atk);
  const duration = number(skill.duration);
  const dp = number(skill.bb?.cost);
  const spCost = number(skill.spCost);
  const spType = spTypeOf(skill.spType);
  if (atkPct == null || !(duration > 0) || dp == null || !(spCost > 0) || !spType) return null;
  return {
    skills: { skchr_wyvern_1: {
      id: 'skchr_wyvern_1', kind: 'duration', duration, spCost, initSp: number(skill.initSp) ?? 0,
      spType, trigger: skill.trigger?.rule ?? 'DEFAULT', mods: { atkPct },
      onStart({ battle, unit }) { if (dp > 0) { battle.addDp(unit.ownerId, dp); battle.fx('dp', { x: unit.x, y: unit.y, id: unit.id, n: dp }); } },
    } },
    talents: talentMods(chess, [['atk', 'atkPct']]),
  };
}

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
    talents: talentAspd == null ? [] : talentMods(chess, [['attack_speed', 'aspd']]),
  };
}


export default Object.freeze({
  chess_native_char_240_wyvern: vanilla,
  chess_native_char_235_jesica: jessica,
});
