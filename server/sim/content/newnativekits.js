// Source-backed native kits that do not replace the existing pool's hand-authored tier kits.
// Values are read only from normalized native operator/skill blackboards; descriptions are never parsed.
import { COLS } from '../constants.js';

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const NATIVE_SKILL_SUPPORT = Object.freeze({
  char_240_wyvern: Object.freeze(['skchr_wyvern_1']),
  char_235_jesica: Object.freeze(['skchr_jesica_1', 'skchr_jesica_2']),
  char_366_acdrop: Object.freeze(['skchr_acdrop_1']),
  char_385_finlpp: Object.freeze(['skchr_finlpp_1']),
  char_4119_wanqin: Object.freeze(['skcom_assist_cost[3]']),
  char_4019_ncdeer: Object.freeze(['skchr_ncdeer_1']),
});
export const NATIVE_DEFAULT_SKILL_IDS = Object.freeze({
  char_240_wyvern: 'skchr_wyvern_1',
  char_235_jesica: 'skchr_jesica_1',
  char_366_acdrop: 'skchr_acdrop_1',
  char_385_finlpp: 'skchr_finlpp_1',
  char_4119_wanqin: 'skcom_assist_cost[3]',
  char_4019_ncdeer: 'skchr_ncdeer_1',
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

function sourceSkill(chess, expectedId) {
  const s = chess?.skill;
  if ((s?.id ?? s?.skillId) !== expectedId) return null;
  const spCost = number(s.spCost), spType = spTypeOf(s.spType);
  if (!(spCost > 0) || !spType || !s.bb) return null;
  return { s, spCost, spType };
}

function aciddrop(bb, chess) {
  const x = sourceSkill(chess, 'skchr_acdrop_1');
  const aspd = number(x?.s.bb?.attack_speed), duration = number(x?.s.duration);
  if (!x || aspd == null || !(duration > 0)) return null;
  return { skills: { skchr_acdrop_1: { id: 'skchr_acdrop_1', kind: 'duration', duration, spCost: x.spCost, initSp: number(x.s.initSp) ?? 0, spType: x.spType, trigger: 'DEFAULT', mods: { aspd } } } };
}

function qingliu(bb, chess) {
  const x = sourceSkill(chess, 'skchr_finlpp_1');
  const healScale = number(x?.s.bb?.heal_scale);
  if (!x || !(healScale > 0)) return null;
  return { skills: { skchr_finlpp_1: { id: 'skchr_finlpp_1', kind: 'instant', spCost: x.spCost, initSp: number(x.s.initSp) ?? 0, spType: x.spType, trigger: 'DEFAULT', heal: true, attack: { healScale } } } };
}

function wanqing(bb, chess) {
  const x = sourceSkill(chess, 'skcom_assist_cost[3]');
  const total = number(x?.s.bb?.value), interval = number(x?.s.bb?.interval), perTick = number(x?.s.bb?.cost), duration = number(x?.s.duration);
  if (!x || !(total > 0) || !(interval > 0) || !(perTick > 0) || !(duration > 0)) return null;
  const ticks = Math.floor(total / perTick);
  return { skills: { 'skcom_assist_cost[3]': {
    id: 'skcom_assist_cost[3]', kind: 'duration', duration, spCost: x.spCost, initSp: number(x.s.initSp) ?? 0, spType: x.spType, trigger: 'DEFAULT', attack: { noAttack: true },
    onStart({ unit }) { unit.mem.nativeWanqingDp = { elapsed: 0, gained: 0 }; },
    onTick({ battle, unit, dt }) {
      const state = unit.mem.nativeWanqingDp;
      if (!state) return;
      state.elapsed += dt;
      while (state.elapsed + 1e-9 >= interval && state.gained < ticks) { state.elapsed -= interval; state.gained++; battle.addDp(unit.ownerId, perTick); }
    },
    onEnd({ battle, unit, reason }) {
      const state = unit.mem.nativeWanqingDp;
      unit.mem.nativeWanqingDp = null;
      if (state && reason === 'duration' && state.gained < ticks) battle.addDp(unit.ownerId, (ticks - state.gained) * perTick);
    },
  } } };
}

function nineColoredDeer(bb, chess) {
  const x = sourceSkill(chess, 'skchr_ncdeer_1');
  const atkPct = number(x?.s.bb?.atk), duration = number(x?.s.duration);
  if (!x || atkPct == null || !(duration > 0)) return null;
  const talent = chess?.talents?.find((item) => item.index === 0)?.bb ?? {};
  const hpRatio = number(talent.hp_ratio), damageResistance = number(talent.damage_resistance);
  return {
    skills: { skchr_ncdeer_1: { id: 'skchr_ncdeer_1', kind: 'duration', duration, spCost: x.spCost, initSp: number(x.s.initSp) ?? 0, spType: x.spType, trigger: 'DEFAULT', mods: { atkPct } } },
    talents: [{ install(battle, unit) {
      if (!(hpRatio > 0 && damageResistance > 0)) return;
      battle.every(0.5, () => {
        if (!unit.alive || !unit.deployed || !unit.rangeKeySet) return;
        for (const ally of battle.alliesFor(unit)) {
          const tileKey = ally.tileR * COLS + ally.tileC;
          const key = `native:ncdeer:${unit.id}`;
          const current = ally.findBuff(key);
          if (ally.kind === 'op' && unit.rangeKeySet.has(tileKey) && ally.hpRatio < hpRatio) {
            battle.addBuff(ally, { key, duration: 0.6, source: unit, mods: { dmgTakenMul: 1 - damageResistance }, tags: ['aura', 'talent'] });
          } else if (current) battle.removeBuff(ally, key);
        }
      }, { owner: unit, immediate: true });
    } }],
  };
}


export default Object.freeze({
  chess_native_char_240_wyvern: vanilla,
  chess_native_char_235_jesica: jessica,
  chess_native_char_366_acdrop: aciddrop,
  chess_native_char_385_finlpp: qingliu,
  chess_native_char_4119_wanqin: wanqing,
  chess_native_char_4019_ncdeer: nineColoredDeer,
});
