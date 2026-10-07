// Source-backed native kits that do not replace the existing pool's hand-authored tier kits.
// Values are read only from normalized native operator/skill blackboards; descriptions are never parsed.
import { COLS } from '../constants.js';
import { DIR_VEC } from '../dir.js';
import { applyDamageIncrease } from '../../../shared/damageIncrease.js';
import { absoluteRangeKeys } from '../targeting.js';

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const NATIVE_SKILL_SUPPORT = Object.freeze({
  char_240_wyvern: Object.freeze(['skchr_wyvern_1']),
  char_235_jesica: Object.freeze(['skchr_jesica_1', 'skchr_jesica_2']),
  char_366_acdrop: Object.freeze(['skchr_acdrop_1']),
  char_385_finlpp: Object.freeze(['skchr_finlpp_1']),
  char_4119_wanqin: Object.freeze(['skcom_assist_cost[3]']),
  char_4019_ncdeer: Object.freeze(['skchr_ncdeer_1']),
  char_2025_shu: Object.freeze(['skchr_shu_1']),
  char_2024_chyue: Object.freeze(['skchr_chyue_1']),
  char_484_robrta: Object.freeze(['skchr_robrta_1']),
  char_4222_taraxa: Object.freeze(['skchr_taraxa_1']),
  char_242_otter: Object.freeze(['skchr_otter_1']),
  char_451_robin: Object.freeze(['skchr_robin_1']),
  char_4048_doroth: Object.freeze(['skchr_doroth_1']),
  char_1034_jesca2: Object.freeze(['skchr_jesca2_1']),
  char_2023_ling: Object.freeze(['skchr_ling_1']),
});
export const NATIVE_DEFAULT_SKILL_IDS = Object.freeze({
  char_240_wyvern: 'skchr_wyvern_1',
  char_235_jesica: 'skchr_jesica_1',
  char_366_acdrop: 'skchr_acdrop_1',
  char_385_finlpp: 'skchr_finlpp_1',
  char_4119_wanqin: 'skcom_assist_cost[3]',
  char_4019_ncdeer: 'skchr_ncdeer_1',
  char_2025_shu: 'skchr_shu_1',
  char_2024_chyue: 'skchr_chyue_1',
  char_484_robrta: 'skchr_robrta_1',
  char_4222_taraxa: 'skchr_taraxa_1',
  char_242_otter: 'skchr_otter_1',
  char_451_robin: 'skchr_robin_1',
  char_4048_doroth: 'skchr_doroth_1',
  char_1034_jesca2: 'skchr_jesca2_1',
  char_2023_ling: 'skchr_ling_1',
});

// Only candidates with a complete default loadout, source talent and required token behavior are workshop-playable.
// Remaining raw skills stay attached for research and are filtered out by supportedSkillIds.
export const NATIVE_KIT_READY = Object.freeze([
  'char_240_wyvern', 'char_235_jesica', 'char_366_acdrop',
  'char_385_finlpp', 'char_4119_wanqin', 'char_4019_ncdeer',
  'char_2025_shu', 'char_2024_chyue', 'char_4222_taraxa', 'char_242_otter',
  'char_484_robrta', 'char_451_robin', 'char_4048_doroth', 'char_1034_jesca2', 'char_2023_ling',
]);

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

function installLandmine(owner, battle, tokenId, skillId, resolve) {
  battle.on('deploy', ({ unit: token }) => {
    if (token?.kind !== 'token' || token.defId !== tokenId || token.ownerUnit !== owner) return;
    const effect = resolve(token.def?.skill?.bb ?? {});
    if (!effect) return;
    battle.every(0.1, () => {
      if (!token.alive || !token.deployed) return;
      const target = battle.enemies.find((enemy) => enemy.alive && !enemy.hidden && !enemy.isFlying && Math.round(enemy.x) === token.tileC && Math.round(enemy.y) === token.tileR);
      if (!target) return;
      const scale = number(effect.scale), damage = (owner.s?.atk ?? owner.base?.atk ?? 0) * scale;
      if (damage > 0) battle.dealDamage(token, target, { amount: damage, type: 'phys', isSkill: true, tags: ['summon', 'trap', 'skill'] });
      if (effect.bind > 0 && target.alive) battle.applyStatus(target, 'bind', { duration: effect.bind, source: token });
      if (effect.defPct < 0 && effect.duration > 0 && target.alive) battle.addBuff(target, { key: `native:${skillId}:def:${token.id}`, duration: effect.duration, source: token, mods: { defPct: effect.defPct }, tags: ['summon', 'trap', 'skill'] });
      battle.fx('nativeTrap', { x: token.x, y: token.y, id: token.id, target: target.id, skillId });
      battle.retreat(token, { reason: 'expired', permanent: true });
    }, { owner: token, immediate: true });
  }, { owner });
}

function robin(bb, chess) {
  const x = sourceSkill(chess, 'skchr_robin_1');
  const scale = number(x?.s.bb?.atk_scale), bind = number(x?.s.bb?.constraint);
  if (!x || !(scale > 0) || !(bind > 0)) return null;
  return {
    skills: { skchr_robin_1: { id: 'skchr_robin_1', kind: 'passive' } },
    talents: [{ install(battle, unit) {
      installLandmine(unit, battle, 'token_10013_robin_mine', 'skchr_robin_1', (tokenBb) => {
        const nativeScale = number(tokenBb.atk_scale), nativeBind = number(tokenBb.constraint);
        return nativeScale > 0 && nativeBind > 0 ? { scale: nativeScale, bind: nativeBind } : null;
      });
    } }],
  };
}

function dorothy(bb, chess) {
  const x = sourceSkill(chess, 'skchr_doroth_1');
  const scale = number(x?.s.bb?.atk_scale), defPct = number(x?.s.bb?.def), duration = number(x?.s.bb?.duration);
  if (!x || !(scale > 0) || !(defPct < 0) || !(duration > 0)) return null;
  return {
    skills: { skchr_doroth_1: { id: 'skchr_doroth_1', kind: 'passive' } },
    talents: [{ install(battle, unit) {
      installLandmine(unit, battle, 'token_10025_doroth_recttp', 'skchr_doroth_1', (tokenBb) => {
        const nativeScale = number(tokenBb.atk_scale), nativeDef = number(tokenBb.def), nativeDuration = number(tokenBb.duration);
        return nativeScale > 0 && nativeDef < 0 && nativeDuration > 0 ? { scale: nativeScale, defPct: nativeDef, duration: nativeDuration } : null;
      });
    } }],
  };
}

function fireJessica(bb, chess) {
  const x = sourceSkill(chess, 'skchr_jesca2_1');
  const atkPct = number(x?.s.bb?.atk), defPct = number(x?.s.bb?.def), duration = number(x?.s.bb?.duration);
  if (!x || atkPct == null || defPct == null || !(duration > 0)) return null;
  const talent = chess?.talents?.find((item) => item.index === 0)?.bb ?? {};
  const shieldDef = number(talent.def), shieldDuration = number(chess?.tokens?.includes('token_10032_jesca2_jckshd') ? 35 : null);
  const secondTalent = chess?.talents?.find((item) => item.index === 1)?.bb ?? {};
  const spOnHit = number(secondTalent.sp), prob = number(secondTalent.prob);
  return {
    skills: { skchr_jesca2_1: { id: 'skchr_jesca2_1', kind: 'duration', duration, spCost: x.spCost, initSp: number(x.s.initSp) ?? 0, spType: x.spType, trigger: 'DEFAULT', mods: { atkPct, defPct } } },
    talents: [{ install(battle, unit) {
      battle.on('deploy', ({ unit: token }) => {
        if (token?.kind !== 'token' || token.defId !== 'token_10032_jesca2_jckshd' || token.ownerUnit !== unit) return;
        const nativeTalent = token.def?.talents?.[0]?.bb ?? {};
        const nativeDef = number(nativeTalent.def) ?? shieldDef, nativeDuration = number(nativeTalent.duration) ?? shieldDuration;
        if (!(nativeDef > 0 && nativeDuration > 0)) return;
        battle.after(nativeDuration, () => { if (token.alive) battle.retreat(token, { reason: 'expired', permanent: true }); }, { owner: token });
        const dr = token.tileR - unit.tileR, dc = token.tileC - unit.tileC;
        const facing = Object.entries(DIR_VEC).find(([, [r, c]]) => dr === r && dc === c)?.[0];
        if (facing) unit.dir = facing;
        const [forwardR, forwardC] = DIR_VEC[facing] ?? [0, 1];
        const back = [-forwardR, -forwardC];
        const behindKey = (unit.tileR + back[0]) * COLS + unit.tileC + back[1];
        for (const ally of battle.alliesFor(unit)) if (ally === unit || (ally.kind === 'op' && ally.tileR * COLS + ally.tileC === behindKey)) {
          battle.addBuff(ally, { key: `native:jesca2:shield:${token.id}`, duration: nativeDuration, source: unit, mods: { defPct: nativeDef }, tags: ['talent'] });
        }
        if (spOnHit > 0 && prob > 0) battle.on('damaged', (ctx) => {
          if (ctx.target !== token || !unit.alive || battle.rng() >= prob) return;
          unit.skill?.gainSp?.(spOnHit, 'talent');
        }, { owner: token });
      }, { owner: unit });
    } }],
  };
}

function ling(bb, chess) {
  const x = sourceSkill(chess, 'skchr_ling_1');
  const atkPct = number(x?.s.bb?.atk), aspd = number(x?.s.bb?.attack_speed), duration = number(x?.s.duration);
  if (!x || atkPct == null || aspd == null || !(duration > 0)) return null;
  const talent = chess?.talents?.find((item) => item.index === 1)?.bb ?? {};
  const spOnSummonLoss = number(talent.sp), atkPerSummonLoss = number(talent.atk), maxStacks = number(talent.max_stack_cnt);
  return {
    skills: { skchr_ling_1: { id: 'skchr_ling_1', kind: 'duration', duration, spCost: x.spCost, initSp: number(x.s.initSp) ?? 0, spType: x.spType, trigger: 'DEFAULT', mods: { atkPct, aspd } } },
    talents: spOnSummonLoss > 0 && atkPerSummonLoss > 0 && maxStacks > 0 ? [{ install(battle, unit) {
      let stacks = 0;
      const counted = new Set();
      const consume = (token) => {
        if (token?.kind !== 'token' || token.ownerUnit !== unit || counted.has(token.id) || stacks >= maxStacks) return;
        counted.add(token.id);
        stacks++;
        unit.skill?.gainSp?.(spOnSummonLoss, 'talent');
        battle.addBuff(unit, { key: `native:ling:summon:${unit.id}`, persist: true, source: unit, mods: { atkPct: atkPerSummonLoss * stacks }, tags: ['talent'] });
      };
      battle.on('death', (ctx) => consume(ctx.unit), { owner: unit });
      battle.on('retreating', (ctx) => consume(ctx.unit), { owner: unit });
    } }] : [],
  };
}

function aciddrop(bb, chess) {
  const x = sourceSkill(chess, 'skchr_acdrop_1');
  const aspd = number(x?.s.bb?.attack_speed), duration = number(x?.s.duration);
  if (!x || aspd == null || !(duration > 0)) return null;
  const talent = chess?.talents?.find((item) => item.index === 0)?.bb ?? {};
  const minScale = number(talent.atk_scale), forwardMinScale = number(talent.atk_scale_2);
  return {
    skills: { skchr_acdrop_1: { id: 'skchr_acdrop_1', kind: 'duration', duration, spCost: x.spCost, initSp: number(x.s.initSp) ?? 0, spType: x.spType, trigger: 'DEFAULT', mods: { aspd } } },
    talents: [{ install(battle, unit) {
      if (!(minScale > 0 && forwardMinScale >= minScale)) return;
      const forwardTiles = [[0, 0], [0, 1], [0, 2]];
      battle.on('hit', ({ source, target, dmg }) => {
        if (source !== unit || !target || !dmg?.isAttack || dmg.type !== 'phys') return;
        const targetTile = target.tileR * COLS + target.tileC;
        const forward = new Set(absoluteRangeKeys(forwardTiles, unit.tileR, unit.tileC, unit.dir, 0)).has(targetTile);
        const floor = unit.s.atk * (forward ? forwardMinScale : minScale);
        const def = target.s.def;
        const ignorePct = Math.min(1, Math.max(0, dmg.defIgnorePct + unit.s.defIgnorePct));
        const ignoreFlat = Math.max(0, dmg.defIgnoreFlat + unit.s.defIgnoreFlat);
        const effectiveDef = Math.max(0, def * (1 - ignorePct) - ignoreFlat);
        // Aciddrop's source talent floors physical output after DEF but before later dealt/taken damage multipliers.
        const minimumPreMitigation = Math.max(floor + effectiveDef, floor / 0.05);
        if (dmg.amount < minimumPreMitigation) dmg.amount = minimumPreMitigation;
      }, { owner: unit });
    } }],
  };
}

function qingliu(bb, chess) {
  const x = sourceSkill(chess, 'skchr_finlpp_1');
  const healScale = number(x?.s.bb?.heal_scale);
  if (!x || !(healScale > 0)) return null;
  const talent = chess?.talents?.find((item) => item.index === 0)?.bb ?? {};
  const resistDuration = number(talent['status_resistance[limit]']);
  const resistValue = Math.min(0.95, Math.max(0, -number(talent.one_minus_status_resistance)));
  return {
    skills: { skchr_finlpp_1: { id: 'skchr_finlpp_1', kind: 'instant', spCost: x.spCost, initSp: number(x.s.initSp) ?? 0, spType: x.spType, trigger: 'DEFAULT', heal: true, attack: { healScale } } },
    talents: [
      { install(battle, unit) {
        if (!(resistDuration > 0 && resistValue > 0)) return;
        battle.on('heal', ({ source, target }) => {
          if (source !== unit || target?.side !== 'ally' || target.kind !== 'op') return;
          battle.applyStatus(target, 'resist', { duration: resistDuration, value: resistValue, source: unit });
        }, { owner: unit });
      } },
    ],
  };
}

function wanqing(bb, chess) {
  const x = sourceSkill(chess, 'skcom_assist_cost[3]');
  const total = number(x?.s.bb?.value), interval = number(x?.s.bb?.interval), perTick = number(x?.s.bb?.cost), duration = number(x?.s.duration);
  if (!x || !(total > 0) || !(interval > 0) || !(perTick > 0) || !(duration > 0)) return null;
  const ticks = Math.floor(total / perTick);
  const talent = chess?.talents?.find((item) => item.index === 0)?.bb ?? {};
  const hpCommon = number(talent['wanqin_t_1[hp_common].max_hp']);
  const hpAligned = number(talent['wanqin_t_1[hp_common].wanqin_t_1[hp_extra].max_hp']);
  const talentGrid = chess?.talents?.find((item) => item.index === 0)?.rangeGrid;
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
  } }, talents: [{ install(battle, unit) {
    if (!(hpCommon > 0) || !Array.isArray(talentGrid) || !talentGrid.length) return;
    const key = `native:wanqing:${unit.id}`;
    battle.every(0.5, () => {
      const up = unit.alive && unit.deployed;
      const range = up ? new Set(absoluteRangeKeys(talentGrid, unit.tileR, unit.tileC, unit.dir, 0)) : null;
      for (const ally of battle.alliesFor(unit)) {
        const inside = range?.has(ally.tileR * COLS + ally.tileC);
        if (ally.kind === 'op' && inside) {
          battle.addBuff(ally, { key, duration: 0.6, source: unit, mods: { hpPct: hpCommon + (ally.dir === unit.dir ? (hpAligned ?? 0) : 0) }, tags: ['aura', 'talent'] });
        } else if (ally.findBuff(key)) battle.removeBuff(ally, key);
      }
    }, { owner: unit, immediate: true });
  } }] };
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

function shu(bb, chess, def) {
  const x = sourceSkill(chess, 'skchr_shu_1');
  const healScale = number(x?.s.bb?.heal_scale);
  if (!x || !(healScale > 0)) return null;
  const talent = chess?.talents?.find((item) => item.index === 0)?.bb ?? {};
  const regen = number(talent.hp_recovery_per_sec), resistance = number(talent.damage_resistance);
  return {
    trait: { attack: 'ranged', dmgType: 'heal', projectile: 'none', heal: { mode: 'single', hpAtMost: 0.5 } },
    skills: { skchr_shu_1: {
      id: 'skchr_shu_1', kind: 'instant', spCost: x.spCost, initSp: number(x.s.initSp) ?? 0, spType: x.spType, charges: Math.max(1, Math.floor(number(x.s.maxCharges) ?? 1)),
      trigger: { rule: 'DEFAULT', grid: def?.skill?.rangeGrid, allies: true, hpAtMost: 0.5 }, targeting: { rangeGrid: def?.skill?.rangeGrid },
      heal: true, attack: { dmgType: 'heal', heal: { mode: 'single', hpAtMost: 0.5 }, healScale, projectile: 'none' },
    } },
    talents: [{ install(battle, unit) {
      if (!(regen > 0 && resistance >= 0)) return;
      if (def?.skill?.rangeGrid) { unit.rangeGrid = def.skill.rangeGrid; battle.refreshRange(unit); }
      const planted = new Set();
      const effectKey = 'native:shu:seed';
      const clear = () => {
        planted.clear();
        for (const ally of battle.alliesFor(unit)) if (ally.findBuff(effectKey)) battle.removeBuff(ally, effectKey);
      };
      const plant = (target) => {
        const row = target.tileR, col = target.tileC;
        for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const r = row + dr, c = col + dc;
          if (r >= 0 && c >= 0) planted.add(r * COLS + c);
        }
      };
      battle.on('heal', ({ source, target, opts }) => {
        if (source === unit && target?.kind === 'op' && !opts?.tags?.includes(effectKey)) plant(target);
      }, { owner: unit });
      battle.on('retreating', ({ unit: leaving }) => { if (leaving === unit) clear(); }, { owner: unit });
      battle.on('death', ({ unit: fallen }) => { if (fallen === unit) clear(); }, { owner: unit });
      battle.every(1, () => {
        if (!unit.alive || !unit.deployed || !planted.size) return;
        for (const ally of battle.alliesFor(unit)) {
          if (ally.kind === 'op' && planted.has(ally.tileR * COLS + ally.tileC)) {
            battle.applyStrongest(ally, effectKey, { duration: 1.1, value: resistance, source: unit, mods: () => ({ hpRegen: regen, dmgTakenMul: 1 - resistance }) });
          } else if (ally.findBuff(effectKey)) battle.removeBuff(ally, effectKey);
        }
      }, { owner: unit });
    } }],
  };
}

function chongyue(bb, chess) {
  const x = sourceSkill(chess, 'skchr_chyue_1');
  const atkScale = number(x?.s.bb?.atk_scale), hits = Math.max(1, Math.floor(number(x?.s.bb?.times) ?? 1));
  if (!x || !(atkScale > 1)) return null;
  const firstTalent = chess?.talents?.find((item) => item.index === 0)?.bb ?? {};
  const secondTalent = chess?.talents?.find((item) => item.index === 1)?.bb ?? {};
  const proc = number(firstTalent.prob), damageScale = number(firstTalent.damage_scale), markDuration = number(firstTalent.up_duration);
  const skillSp = number(secondTalent.sp) ?? 0;
  return {
    skills: { skchr_chyue_1: { id: 'skchr_chyue_1', kind: 'charges', spCost: x.spCost, initSp: number(x.s.initSp) ?? 0, spType: x.spType, charges: Math.max(1, Math.floor(number(x.s.maxCharges) ?? 1)), trigger: 'DEFAULT', attack: { atkScale, hits } } },
    talents: [{ install(battle, unit) {
      const marks = new Map();
      battle.on('hit', (ctx) => {
        if (ctx.source !== unit || !ctx.target || ctx.target.side !== 'enemy' || !ctx.dmg?.isAttack || ctx.dmg.isSkill) return;
        const until = marks.get(ctx.target.id) ?? 0;
        if (until > battle.time) applyDamageIncrease(battle, unit, ctx.dmg, damageScale);
        else if (proc > 0 && battle.rng() < proc) marks.set(ctx.target.id, battle.time + markDuration);
      }, { owner: unit });
      if (skillSp > 0) {
        battle.on('skillStart', (ctx) => { if (ctx.unit === unit && ctx.skill?.id === 'skchr_chyue_1') unit.mem.nativeChyueSkillReadyForKill = true; }, { owner: unit });
        battle.on('skillEnd', (ctx) => { if (ctx.unit === unit && ctx.skill?.id === 'skchr_chyue_1') unit.mem.nativeChyueSkillReadyForKill = false; }, { owner: unit });
        battle.on('kill', (ctx) => {
          if (ctx.killer !== unit || !unit.mem.nativeChyueSkillReadyForKill) return;
          unit.mem.nativeChyueSkillReadyForKill = false;
          unit.skill?.gainSp?.(skillSp, 'talent');
        }, { owner: unit });
      }
    } }],
  };
}

function roberta(bb, chess) {
  const x = sourceSkill(chess, 'skchr_robrta_1');
  const atkPct = number(x?.s.bb?.atk), defPct = number(x?.s.bb?.def), duration = number(x?.s.duration);
  if (!x || atkPct == null || defPct == null || !(duration > 0)) return null;
  return {
    skills: { skchr_robrta_1: { id: 'skchr_robrta_1', kind: 'duration', duration, spCost: x.spCost, initSp: number(x.s.initSp) ?? 0, spType: x.spType, trigger: 'DEFAULT', mods: { atkPct, defPct } } },
    talents: [{ install(battle, unit) {
      const tokenId = 'token_10018_robrta_mach';
      battle.every(0.25, () => {
        for (const token of battle.alliesFor(unit)) {
          if (token.kind !== 'token' || token.defId !== tokenId || token.ownerUnit !== unit || token.mem.nativeRobertaApplied) continue;
          const targetKeys = new Set(absoluteRangeKeys(token.def?.rangeGrid || [[0, 0]], token.tileR, token.tileC, token.dir, 0));
          const target = battle.alliesFor(unit).find((ally) => ally.kind === 'op' && ally !== unit && ally.def?.position === 'MELEE' && targetKeys.has(ally.tileR * COLS + ally.tileC) && !ally.buffs.some((buff) => buff.key.startsWith('native:robrta:def:')));
          if (!target) continue;
          const effect = token.def?.talents?.[0]?.bb ?? {};
          const defPct = number(effect.def), effectDuration = number(effect.duration);
          if (!(defPct > 0 && effectDuration > 0)) continue;
          token.mem.nativeRobertaApplied = target.id;
          battle.addBuff(target, { key: `native:robrta:def:${token.id}`, duration: effectDuration, source: unit, mods: { defPct }, tags: ['talent'] });
          battle.addBuff(target, { key: `native:robrta:shield:${token.id}`, duration: effectDuration, source: unit, shieldHits: unit.def?.phase >= 2 ? 2 : 1, visible: true, tags: ['talent'] });
        }
      }, { owner: unit, immediate: true });
    } }],
  };
}

function taraxacum(bb, chess) {
  const x = sourceSkill(chess, 'skchr_taraxa_1');
  const healScale = number(x?.s.bb?.['attack@heal_scale']);
  const attackIntervalFactor = number(x?.s.bb?.['attack@base_attack_time']);
  const duration = number(x?.s.duration);
  if (!x || !(healScale > 0) || !(attackIntervalFactor > 0 && attackIntervalFactor < 1) || !(duration > 0)) return null;
  const talent = chess?.talents?.find((item) => item.index === 0)?.bb ?? {};
  const damageResistance = number(talent.damage_resistance);
  const blockCnt = number(talent.block_cnt);
  return {
    skills: { skchr_taraxa_1: {
      id: 'skchr_taraxa_1', kind: 'duration', duration, spCost: x.spCost,
      initSp: number(x.s.initSp) ?? 0, spType: x.spType, trigger: 'DEFAULT', heal: true,
      mods: { batPct: attackIntervalFactor - 1 },
      attack: { healScale },
      flags: { liftoff: true, blockFly: true },
    } },
    talents: [{ install(battle, unit) {
      if (!(damageResistance > 0 && blockCnt > 0)) return;
      const key = `native:taraxa:${unit.id}`;
      battle.every(0.5, () => {
        const up = unit.alive && unit.deployed;
        const range = up ? unit.rangeKeySet : null;
        for (const ally of battle.alliesFor(unit)) {
          const inRange = ally.kind === 'op' && range?.has(ally.tileR * COLS + ally.tileC);
          const canBlockFly = !!(ally.profile?.blockFly || ally.s.flags?.blockFly);
          if (inRange && canBlockFly) {
            battle.addBuff(ally, { key, duration: 0.6, source: unit, mods: { blockCnt }, tags: ['aura', 'talent'] });
            battle.addBuff(ally, { key: `${key}:resist`, duration: 0.6, source: unit, mods: { dmgTakenMul: 1 - damageResistance }, tags: ['aura', 'talent'] });
          } else {
            if (ally.findBuff(key)) battle.removeBuff(ally, key);
            if (ally.findBuff(`${key}:resist`)) battle.removeBuff(ally, `${key}:resist`);
          }
        }
      }, { owner: unit, immediate: true });
    } }],
  };
}

function mel(bb, chess) {
  const skill = chess?.skill;
  if ((skill?.id ?? skill?.skillId) !== 'skchr_otter_1') return null;
  const dodge = number(skill.bb?.prob);
  const tokenId = 'token_10004_otter_motter';
  if (!(dodge > 0 && dodge <= 1)) return null;
  return {
    skills: { skchr_otter_1: { id: 'skchr_otter_1', kind: 'passive' } },
    talents: [{ install(battle, unit) {
      battle.every(0.25, () => {
        for (const token of battle.alliesFor(unit)) {
          if (token.kind !== 'token' || token.defId !== tokenId || token.ownerUnit !== unit) continue;
          battle.addBuff(token, { key: `native:mibo:dodge:${unit.id}`, duration: 0.35, source: unit, mods: { dodgePhys: dodge, dodgeArts: dodge }, tags: ['talent', 'skill'] });
          const slow = number(token.def?.talents?.[0]?.bb?.attack_speed);
          if (slow) for (const enemy of token.blocking || []) {
            battle.addBuff(enemy, { key: `native:mibo:slow:${token.id}`, duration: 0.35, source: token, mods: { aspd: slow }, tags: ['talent'] });
          }
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
  chess_native_char_2025_shu: shu,
  chess_native_char_2024_chyue: chongyue,
  chess_native_char_484_robrta: roberta,
  chess_native_char_4222_taraxa: taraxacum,
  chess_native_char_242_otter: mel,
  chess_native_char_451_robin: robin,
  chess_native_char_4048_doroth: dorothy,
  chess_native_char_1034_jesca2: fireJessica,
  chess_native_char_2023_ling: ling,
});
