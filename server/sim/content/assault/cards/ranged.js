import { makeKit, v, enemies, allies, damage, heal, buff, applyStatus, sp, haste, active, uid, queue, watch, cooldowncost, onTimer } from '../primitives.js';
import { installRangedBazaar, rangedLine, rangedModule } from './ranged-bazaar.js';
import { grantSummon } from '../summons.js';
import { COLS } from '../../../constants.js';
import { rangedPlans, rangedCharIds, rangedEffectPlans } from './ranged-plans.js';
import { assaultAmmoState, consumeAssaultAmmo, registerAssaultAmmo, reloadAssaultAmmo, setAssaultAmmoCapacityBonus } from '../ammo.js';

const statMap = Object.freeze({ atk: 'atkMul', def: 'defMul', attackSpeed: 'aspd', maxHp: 'hpMul', res: 'resFlat', blockCnt: 'blockCnt' });
function number(unit, value, label) {
  if (value == null) throw new TypeError(`${unit.def?.charId ?? 'ranged'} is missing ${label}`);
  const result = Number(v(unit, value));
  if (!Number.isFinite(result)) throw new TypeError(`${unit.def?.charId ?? 'ranged'} has invalid ${label}`);
  return result;
}
function effectPlan(body, phase, index, binding = null) {
  const plan = rangedEffectPlans[body.charId];
  const entry = binding == null ? plan?.[phase]?.[index] : plan?.talents?.[binding];
  if (!entry) throw new TypeError(`missing typed ranged plan for ${body.charId}:${phase}:${binding ?? index}`);
  return entry;
}
function select(battle, unit, binding, event = null) {
  const mode = binding.target;
  if (mode === 'self') return [unit];
  if (mode === 'airEnemies' || mode === 'rangedAllies') {
    const offsets = unit.def?.raw?.assaultBody?.range ?? [];
    const inRange = (target) => offsets.some(([dr, dc]) => unit.tileR + dr === target.tileR && unit.tileC + dc === target.tileC);
    if (mode === 'airEnemies') return battle.enemies.filter((x) => active(x) && !x.hidden && x.isFlying && inRange(x));
    return battle.allyUnits.filter((x) => active(x) && x.kind === 'op'
      && (x === unit || (x.def?.raw?.assaultBody ?? x.def?.assaultBody)?.position === 'RANGED') && inRange(x));
  }
  if (mode === 'allyCenters') {
    const offsets = unit.def?.raw?.assaultBody?.range ?? [];
    return battle.allyUnits.filter((x) => active(x) && x.kind === 'op' && x !== unit
      && offsets.some(([dr, dc]) => unit.tileR + dr === x.tileR && unit.tileC + dc === x.tileC));
  }
  if (mode === 'currentEnemy') return enemies(battle, unit, { scope: 'range', count: 1, priority: 'exit' });
  if (mode === 'rangeEnemies') return enemies(battle, unit, { scope: 'range', count: binding.count === 'all' ? 99 : binding.count, priority: binding.priority ?? 'exit' });
  if (mode === 'rangeAllies') return allies(battle, unit, { scope: 'range', count: binding.count, selection: binding.selection ?? 'lowestHp' });
  if (mode === 'eventTarget') {
    const direct = event?.payload?.target ?? event?.payload?.targets?.[0];
    if (direct) return [direct];
    const targetUid = event?.payload?.targetUid;
    const target = [...battle.enemies, ...battle.allyUnits].find((candidate) => uid(candidate) === String(targetUid));
    if (target) return [target];
    return [];
  }
  throw new TypeError(`unsupported typed target ${mode}`);
}
function selectedModule(body, piece) {
  const moduleId = piece.moduleId ?? piece.moduleChoices?.[body.charId];
  if (moduleId == null) return null;
  if (Array.isArray(piece.moduleChoices)) throw new TypeError(`${body.charId} moduleChoices must be a bodyId-to-moduleId map`);
  const module = (body.modulePlans ?? []).find((entry) => entry.id === moduleId);
  if (!module || module.type !== 'ADVANCED' || piece.star < 3) return null;
  const modulePlan = rangedEffectPlans[body.charId]?.modules?.[moduleId];
  if (!modulePlan) throw new TypeError(`missing typed module plan for ${body.charId}:${moduleId}`);
  return piece.star >= 4 ? modulePlan.star4 : modulePlan.star3;
}
function perform(battle, unit, body, piece, plan, effect, index, cause, phase = 'skill', event = null) {
  const values = effect.values ?? effect.params ?? {};
  const typed = effectPlan(body, phase, index);
  let chosen = select(battle, unit, typed, event);
  const module = selectedModule(body, piece);
  if (body.charId === 'char_253_greyy' && phase === 'skill' && typed.target === 'rangeEnemies' && module?.rangeRadius) {
    const expanded = new Set(unit.rangeKeys ?? []);
    for (const key of [...expanded]) {
      const row = Math.floor(key / COLS); const col = key % COLS;
      for (let dr = -module.rangeRadius; dr <= module.rangeRadius; dr++) for (let dc = -module.rangeRadius; dc <= module.rangeRadius; dc++) {
        const r = row + dr; const c = col + dc;
        if (r >= 0 && c >= 0 && c < COLS) expanded.add(r * COLS + c);
      }
    }
    chosen = battle.enemiesInKeys([...expanded], unit, unit.profile ?? {});
  }
  const key = `assault:${body.charId}:effect:${index}`;
  switch (effect.action) {
    case 'damage': {
      let scale = number(unit, values.atkScale ?? values.scale ?? values.magicAtkScale ?? values.atkScaleBonus, 'damage scale');
      let hits = values.times != null || values.hits != null ? number(unit, values.times ?? values.hits, 'hit count') : 1;
      const type = typed.damageType ?? 'phys';
      let did = false;
      if (body.charId === 'char_1021_kroos2' && phase === 'skill' && index === 0) {
        const module = selectedModule(body, piece);
        const threshold = rangedLine(unit, 1, 'n', number(unit, body.fixedSkill.effects[1].values.threshold, 'Kroos2 upgrade threshold')) * (module?.thresholdMultiplier ?? 1);
        const upgraded = (unit.mem.kroosHitCount ?? 0) >= threshold;
        hits = upgraded ? number(unit, body.fixedSkill.effects[1].values.upgradedShots, 'Kroos2 upgraded shot count') : hits;
        if (upgraded && module?.upgradedScaleBonus) scale += module.upgradedScaleBonus;
      }
      if (body.charId === 'char_204_platnm' && phase === 'skill' && index === 0) {
        const module = selectedModule(body, piece);
        scale += module?.chargeCapBonus ?? 0;
      }
      if (body.charId === 'char_190_clour' && phase === 'skill' && index === 0) {
        const module = selectedModule(body, piece);
        const targetCount = module?.maxTargets ?? values.maxTarget;
        const targets = enemies(battle, unit, { scope: 'range', count: targetCount, priority: 'exit' });
        for (const target of targets) did = damage(battle, unit, target, { scale, hits, type, isSkill: true, sourceKey: key, cause }) > 0 || did;
        return did;
      }
      if (body.charId === 'char_469_indigo' && typed.fieldTick) return true; // The timed field is scheduled by the owning cast below.
      if (body.charId === 'char_4051_akkord' && typed.target === 'allyCenters') {
        const module = selectedModule(body, piece);
        const radius = module?.centerRadius ?? typed.centerRadius;
        for (const center of chosen) for (const target of battle.enemies) {
          if (!active(target) || target.hidden || Math.max(Math.abs(target.tileR - center.tileR), Math.abs(target.tileC - center.tileC)) > radius) continue;
          did = damage(battle, unit, target, { scale, hits, type: 'arts', isSkill: true, sourceKey: `${key}:${uid(center)}`, cause }) > 0 || did;
        }
        return did;
      }
      for (const target of chosen) {
        const module = selectedModule(body, piece);
        let shotScale = scale;
        let actualHits = hits;
        if (body.charId === 'char_498_inside' && phase === 'skill' && index === 0) {
          actualHits = Math.min(hits, Math.max(0, assaultAmmoState(unit)?.current ?? 0));
          consumeAssaultAmmo(battle, unit, actualHits, `assault:${body.charId}:skill:shots`, { partial: true, isSkill: true });
          const module = selectedModule(body, piece);
          if (module?.skillScaleBonus) shotScale += module.skillScaleBonus;
        }
        if (body.charId === 'char_366_acdrop' && phase === 'skill' && index === 0) shotScale += module?.skillScaleBonus ?? 0;
        let defIgnoreFlat = values.defPenetrateFixed == null ? undefined : number(unit, values.defPenetrateFixed, 'defPenetrateFixed');
        if (body.charId === 'char_440_pinecn' && phase === 'skill' && index === 0) defIgnoreFlat = (defIgnoreFlat ?? 0) + (module?.defIgnoreBonus ?? 0);
        // bazaar: 「目标在正前方横排额外 50%」已删去。
        if (body.charId === 'char_440_pinecn' && phase === 'skill' && index === 1) continue;
        if (body.charId === 'char_279_excu' && phase === 'skill') {
          if (values.inheritTalentPierce === true) {
            const talentIndex = number(unit, values.pierceSourceTalentIndex, 'Executor penetration talent index');
            const binding = body.talentBindings?.find((entry) => entry.nativeTalentIndex === talentIndex);
            if (!binding) throw new TypeError(`Executor skill references missing native talent index ${talentIndex}`);
            const talent = effectPlan(body, 'talents', talentIndex, binding.binding);
            defIgnoreFlat = (defIgnoreFlat ?? 0) + number(unit, talent.defIgnoreFlat, 'Executor inherited talent penetration');
          }
          defIgnoreFlat = (defIgnoreFlat ?? 0) + (module?.defIgnoreBonus ?? 0);
          shotScale += module?.hitScaleBonus ?? 0;
        }
        if (body.charId === 'char_235_jesica' && phase === 'skill' && index === 0 && module) {
          shotScale += module.skillScaleBonus;
          if (target.isFlying) shotScale += module.airBonus;
        }
        if (body.charId === 'char_126_shotst' && phase === 'skill' && module) shotScale += module.skillScaleBonus;
        if (body.charId === 'char_126_shotst' && target.isFlying) {
          const airTalent = Object.values(rangedEffectPlans[body.charId].talents).find((entry) => entry.airDamageMultiplier);
          if (airTalent) shotScale *= number(unit, airTalent.airDamageMultiplier, 'anti-air talent multiplier');
        }
        if (actualHits > 0) did = damage(battle, unit, target, { scale: shotScale, hits: actualHits, type, isSkill: true, defIgnoreFlat, sourceKey: key, cause }) > 0 || did;
        if (body.charId === 'char_235_jesica' && phase === 'skill' && index === 0 && target.isFlying) {
          const followup = body.modePassives[0].values;
          did = damage(battle, unit, target, { scale: number(unit, followup.atkScale, 'anti-air followup scale') * (module?.airFollowupMultiplier ?? 1), type: followup.dmgType, isSkill: true, sourceKey: `${key}:air-followup`, cause }) > 0 || did;
        }
      }
      return did;
    }
    case 'heal': {
      let did = false;
      for (const target of chosen) {
        const scale = number(unit, values.healScale ?? values.atkScalePerSec ?? values.scale, 'heal scale');
        if (scale > 0 && target.hp < target.s.maxHp) did = heal(battle, unit, target, { scale, cause }) > 0 || did;
      }
      return did;
    }
    case 'applyStatus': {
      const status = typed.status;
      if (!status) throw new TypeError(`missing typed status for ${body.charId}:${phase}:${index}`);
      const baseDuration = number(unit, values.duration, 'status duration');
      let value = typed.valueKey == null ? 1 : number(unit, values[typed.valueKey], `${typed.valueKey} status value`);
      const module = selectedModule(body, piece);
      if (body.charId === 'char_126_shotst' && phase === 'skill' && module) value += module.defDownBonus;
      for (const target of chosen) {
        if (body.charId === 'char_469_indigo' && typed.status === 'bind' && target.buffs?.some((entry) => entry.status === 'bind')) continue;
        if (typed.probabilityKey) {
          let probability = number(unit, values[typed.probabilityKey], `${typed.probabilityKey} chance`);
          const module = selectedModule(body, piece);
          if (body.charId === 'char_469_indigo' && module?.bindProbabilityMultiplier) probability *= module.bindProbabilityMultiplier;
          if (!battle.rng.chance(Math.min(1, probability))) continue;
        }
        const duration = baseDuration + (body.charId === 'char_126_shotst' && phase === 'skill' && module && target.isFlying ? module.airDurationBonus ?? 0 : 0);
        applyStatus(battle, unit, target, { status, duration, value, key, cause });
      }
      return chosen.length > 0;
    }
    case 'addBuff': {
      const mods = {};
      for (const [from, to] of Object.entries(statMap)) if (values[from] != null || values[`${from}PerAlly`] != null) mods[to] = 1 + number(unit, values[from] ?? values[`${from}PerAlly`], from);
      if (values.attackSpeed != null) mods.aspd = number(unit, values.attackSpeed, 'attackSpeed');
      if (values.blockCnt != null) mods.blockCnt = number(unit, values.blockCnt, 'blockCnt');
      if (!Object.keys(mods).length) return false;
      let duration = values.duration == null ? Infinity : number(unit, values.duration, 'buff duration');
      const module = selectedModule(body, piece);
      if (body.charId === 'char_484_robrta' && phase === 'skill' && index === 1 && module?.skillDurationBonus) duration += module.skillDurationBonus;
      if (body.charId === 'char_279_excu' && module?.frontBonusMul) mods.atkMul = 1 + number(unit, values.atk, 'front-row attack bonus') * module.frontBonusMul;
      if (body.charId === 'char_204_platnm' && phase === 'skill' && index === 1) mods.aspd = module?.aspdPenalty ?? -20;
      for (const target of chosen) buff(battle, unit, target, { key, mods, duration, persist: duration === Infinity, cause });
      if (body.charId === 'char_4051_akkord' && phase === 'skill' && index === 1 && module?.postSkillAspd) {
        buff(battle, unit, unit, { key: `${key}:module-aspd`, mods: { aspd: module.postSkillAspd }, duration: module.postSkillDuration, cause });
      }
      return chosen.length > 0;
    }
    case 'modifyTag': {
      if (values.tag !== 'taunt') throw new TypeError(`${body.charId} has unsupported tag mutation ${values.tag}`);
      const delta = number(unit, values.delta, 'taunt delta');
      const duration = number(unit, values.duration, 'taunt duration');
      for (const target of chosen) buff(battle, unit, target, { key, mods: { taunt: delta }, duration, cause });
      return chosen.length > 0;
    }
    case 'spGain': {
      const amount = number(unit, values.sp ?? values.spGain, 'sp gain');
      if (amount <= 0) return false;
      return sp(battle, unit, unit, amount, key, key, cause) > 0;
    }
    case 'haste': {
      const amount = number(unit, values.spPerSec, 'sp rate');
      if (amount <= 0) return false;
      for (const target of chosen) haste(battle, unit, target, values.duration == null ? Infinity : number(unit, values.duration, 'haste duration'), key, { cause });
      return true;
    }
    case 'spCost': {
      const skill = unit.skill;
      if (!skill) return false;
      cooldowncost(battle, unit, Math.max(0.5 / skill.spCost, (skill.spCost - number(unit, values.spReduce, 'sp reduction')) / skill.spCost), key);
      return true;
    }
    case 'ammo':
      if (body.charId === 'char_498_inside' && phase === 'skill') return true;
      throw new TypeError(`${body.charId} needs a typed attack-bound ammunition implementation`);
    case 'economy': {
      const player = battle.getPlayer(unit.ownerId ?? unit.playerId);
      if (!player) return false;
      battle.addDp(player.playerId, number(unit, values.costGain, 'dp gain'), 'assault-ranged');
      return true;
    }
    case 'summon': {
      const tokenId = values.tokenKey ?? plan.tokenId;
      if (!tokenId) throw new Error(`${body.charId} summon has no explicit token id`);
      const count = number(unit, values.count ?? values.gain, 'summon count');
      return grantSummon(battle, unit, { tokenId, count, stockCap: values.stockCap == null ? count : number(unit, values.stockCap, 'summon stockCap'), fieldCap: values.deployMax == null ? count : number(unit, values.deployMax, 'summon deployMax'), ruleKey: key }).granted > 0;
    }
    case 'move': throw new TypeError(`${body.charId} needs a typed displacement implementation`);
    case 'device': {
      if (body.charId !== 'char_484_robrta' || typed.tokenId !== 'token_10018_robrta_mach') throw new TypeError(`${body.charId} needs a typed device implementation`);
      const count = number(unit, values.gain, 'robrta device gain');
      const cap = number(unit, values.maxCount, 'robrta device cap');
      return grantSummon(battle, unit, { tokenId: typed.tokenId, count, stockCap: cap, fieldCap: cap, ruleKey: key }).granted > 0;
    }
    case 'nativeMechanism':
      if (body.charId === 'char_1021_kroos2' && phase === 'skill') return true;
      throw new TypeError(`${body.charId} needs a typed native mechanism implementation`);
    default: throw new Error(`${body.charId} has unsupported ranged action ${effect.action}`);
  }
}
function eventBelongs(binding, unit, payload) {
  if (binding.source === 'self') return (payload?.sourceUid ?? payload?.source?.uid ?? payload?.source?.id ?? payload?.attacker?.uid) === uid(unit);
  return true;
}
const RANGED_BAZAAR_REPLACED_PASSIVES = new Set([
  'char_4000_jnight:0', 'char_253_greyy:0', 'char_469_indigo:0', 'char_126_shotst:0', 'char_440_pinecn:1', 'char_279_excu:0',
]);

function installPassives(battle, unit, body, piece, plan) {
  const typedPlan = rangedEffectPlans[body.charId];
  if (!typedPlan) throw new TypeError(`missing ranged typed plan for ${body.charId}`);
  // MSC-X raises the native Mystic's idle-energy ceiling; it does not add
  // skill charges. The profession trait consumes this profile value directly.
  if (body.charId === 'char_469_indigo') {
    const cap = selectedModule(body, piece)?.storedAttackCap;
    if (cap != null) {
      if (!Number.isInteger(cap) || cap < 0 || unit.def?.subProf !== 'mystic' || !unit.profile?.storeEnergy) {
        throw new TypeError('Indigo storedAttackCap requires the native Mystic profile');
      }
      unit.profile.storeMax = cap;
    }
  }
  if (body.charId === 'char_235_jesica') {
    const binding = body.talentBindings?.find((entry) => entry.binding === 'assaultTalent:native_talent_0');
    const typed = effectPlan(body, 'talents', 0, binding?.binding);
    if (typed.staticBuff) {
      const applyTalent = () => buff(battle, unit, unit, { key: `assault:${body.charId}:talent:${binding.binding}`, mods: { aspd: number(unit, typed.staticBuff.attackSpeed, 'talent attack speed') }, duration: Infinity, persist: true });
      applyTalent();
      watch(battle, unit, 'deployed', `assault:${body.charId}:talent:deploy`, ({ payload }) => payload?.targetUid === uid(unit), applyTalent, { allowInactive: true });
    }
  }
  if (body.charId === 'char_4051_akkord') {
    const perAlly = body.modePassives[0].values.atkPerAlly;
    battle.on('tick', () => {
      const offsets = body.range ?? [];
      const count = battle.allyUnits.filter((x) => active(x) && x.kind === 'op' && x !== unit
        && offsets.some(([dr, dc]) => unit.tileR + dr === x.tileR && unit.tileC + dc === x.tileC)).length;
      const cap = number(unit, body.modePassives[0].values.maxStacks, 'Akkord allied aura stack cap');
      const amount = Math.min(cap, count) * number(unit, perAlly, 'Akkord per-ally attack bonus');
      buff(battle, unit, unit, { key: `assault:${body.charId}:ally-aura`, mods: { atkMul: 1 + amount }, duration: Infinity, persist: true });
    }, { owner: unit });
  }
  if (body.charId === 'char_190_clour') {
    const spPerSec = body.modePassives[0].values.spPerSec;
    const aspd = body.modePassives[1].values.attackSpeed;
    const module = selectedModule(body, piece);
    battle.on('tick', ({ dt }) => {
      if (!active(unit)) return;
      // bazaar: the permanent natural-SP bonus is replaced by 「当你的叙拉古干员击倒敌人时，加速此干员」.
      void spPerSec; void module; void dt;
      const enemyCount = enemies(battle, unit, { scope: 'range', count: 99, priority: 'exit' }).length;
      if (enemyCount >= 2) buff(battle, unit, unit, { key: `assault:${body.charId}:passive-aspd`, mods: { aspd: number(unit, aspd, 'passive aspd') }, duration: Infinity, persist: true });
      else battle.removeBuff(unit, `assault:${body.charId}:passive-aspd`);
    }, { owner: unit });
  }
  if (body.charId === 'char_440_pinecn') {
    const rate = body.modePassives[0].values.spPerSec;
    const duration = selectedModule(body, piece)?.spDuration ?? number(unit, body.modePassives[0].values.duration, 'talent SP duration');
    const spRate = selectedModule(body, piece)?.spRate ?? number(unit, rate, 'talent SP rate');
    // bazaar: replaced by 「部署时，加速此干员与相邻干员」 (ranged-bazaar.js).
    void rate; void duration; void spRate;
  }
  if (body.charId === 'char_258_podego') {
    const module = selectedModule(body, piece);
    const key = `assault:${body.charId}:support-aura`;
    battle.on('tick', () => {
      const supports = battle.allyUnits.filter((x) => active(x) && x.kind === 'op'
        && (x.def?.raw?.assaultBody ?? x.def?.assaultBody)?.profession === 'SUPPORT');
      if (!active(unit)) {
        for (const ally of battle.allyUnits) battle.removeBuff(ally, key);
        return;
      }
      const amount = number(unit, body.modePassives[0].values.atk, 'Podego support aura') + (module?.auraBonus ?? 0);
      for (const ally of supports) buff(battle, unit, ally, { key, mods: { atkMul: 1 + amount }, duration: Infinity, persist: true });
      for (const ally of battle.allyUnits) if (!supports.includes(ally)) battle.removeBuff(ally, key);
    }, { owner: unit });
    let attackCount = 0;
    battle.on('attack', ({ attacker }) => {
      if (attacker !== unit) return;
      attackCount++;
      if (attackCount % 3 !== 0) return;
      const target = allies(battle, unit, { scope: 'range', count: 1, selection: 'lowestHp' })[0];
      if (target) heal(battle, unit, target, { scale: number(unit, body.modePassives[1].values.healScale, 'Podego third-shot heal') });
    }, { owner: unit });
  }
  if (body.charId === 'char_4100_caper') {
    // bazaar: 当此干员暴击时，为此干员和相邻干员充能 c（取代「下次瞬发所需技力降低」）。
    const critPlan = effectPlan(body, 'modePassives', 0);
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !dmg?.isAttack || dmg.isSkill || target?.side !== 'enemy' || !(dmg.amount > 0)) return;
      if (!battle.rng.chance(number(unit, critPlan.critChance, 'Caper compiled crit chance'))) return;
      dmg.mul *= number(unit, critPlan.critScale, 'Caper compiled crit multiplier');
      const amount = rangedLine(unit, 1, 'c');
      const recipients = [unit, ...allies(battle, unit, { scope: 'adjacent4', count: 4, selection: 'uid', operatorsOnly: true, excludeSelf: true })];
      queue(battle, `assault:${body.charId}:crit-charge`, unit, () => {
        for (const ally of recipients) if (active(ally) && ally.ownerId === unit.ownerId) sp(battle, unit, ally, amount, `assault:${body.charId}:crit-charge`, `assault:${body.charId}:crit-charge`);
      });
    }, { owner: unit });
  }
  if (body.charId === 'char_366_acdrop') {
    const front = (target) => {
      const [dr, dc] = unit.fwd ?? [0, unit.facing ?? 1];
      const r = target.tileR - unit.tileR; const c = target.tileC - unit.tileC;
      return r === dr && c === dc || r === dr * 2 && c === dc * 2;
    };
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || (!dmg?.isAttack && !dmg?.isSkill) || dmg.type !== 'phys' || target?.side !== 'enemy') return;
      const module = selectedModule(body, piece);
      // bazaar: 每次攻击至少造成 f% 攻击力的伤害（正前方的更高下限与近距攻速已删去）。
      void module; void front;
      if (dmg.isAttack) {
        const floor = rangedLine(unit, 1, 'f', number(unit, body.modePassives[0].values.atkFloor, 'Aciddrop damage floor') * 100) / 100;
        dmg.amount = Math.max(dmg.amount, unit.s.atk * floor + Math.max(0, target.s.def ?? 0));
      }
    }, { owner: unit });
  }
  if (body.charId === 'char_1021_kroos2') {
    const crits = new WeakSet(); const module = selectedModule(body, piece); const critPlan = effectPlan(body, 'modePassives', 0);
    const counter = body.fixedSkill.effects[1].values;
    const baseHits = number(unit, body.fixedSkill.effects[0].values.times, 'Kroos2 base skill hit count');
    const counterPerHit = number(unit, counter.addPerSkill, 'Kroos2 source counter increment') / baseHits;
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !dmg?.isAttack || dmg.isSkill || target?.side !== 'enemy') return;
      if (battle.rng.chance(number(unit, critPlan.critChance, 'Kroos2 compiled crit chance'))) {
        dmg.mul *= number(unit, critPlan.critScale, 'Kroos2 compiled crit multiplier'); crits.add(dmg);
      }
    }, { owner: unit });
    // bazaar: 本场战斗中命中 n 次后，技能改为 4 次（攻击与技能每次命中各计 1 次）。
    void counterPerHit;
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !(dmg?.isSkill || dmg?.isAttack) || target?.side !== 'enemy') return;
      unit.mem.kroosHitCount = (unit.mem.kroosHitCount ?? 0) + 1;
    }, { owner: unit, priority: -100 });
    battle.on('damaged', ({ source, target, dmg }) => {
      if (source !== unit || !dmg || !crits.has(dmg)) return;
      crits.delete(dmg);
      // bazaar: the crit stun + SP refund is replaced by 「当你的罗德岛干员施放技能时，为此干员充能」.
    }, { owner: unit });
  }
  if (body.charId === 'char_204_platnm') {
    const charge = body.modePassives[0].values;
    if (charge.chargeScale !== true) throw new TypeError('Platinum passive requires source-declared charge scaling');
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !dmg?.isAttack || dmg.isSkill || target?.side !== 'enemy') return;
      const attackId = dmg.attackId ?? null;
      if (attackId != null && unit.mem.platnmAttackId === attackId) {
        dmg.mul *= unit.mem.platnmChargeMul ?? 1;
        return;
      }
      const previous = unit.mem.platnmLastAttackTime ?? unit.deployedAt ?? battle.time;
      const delta = Math.max(0, battle.time - previous);
      const module = selectedModule(body, piece);
      const minimumDelta = number(unit, charge.minDelta, 'Platinum minimum charge delay');
      const maximumDelta = number(unit, charge.maxDelta, 'Platinum maximum charge delay');
      const maximum = number(unit, charge.maxAtkScale, 'Platinum charge cap') + (module?.chargeCapBonus ?? 0);
      const fraction = Math.max(0, Math.min(1, (delta - minimumDelta) / (maximumDelta - minimumDelta)));
      const multiplier = 1 + (maximum - 1) * fraction;
      unit.mem.platnmLastAttackTime = battle.time;
      unit.mem.platnmAttackId = attackId;
      unit.mem.platnmChargeMul = multiplier;
      dmg.mul *= multiplier;
    }, { owner: unit });
    battle.on('tick', () => {
      if (unit.mem.platnmViewUntil == null || battle.time < unit.mem.platnmViewUntil) return;
      const base = unit.mem.platnmBaseRange ?? unit.baseRangeKeys ?? [];
      unit.rangeKeys = base.slice(); unit.rangeKeySet = new Set(base);
      delete unit.mem.platnmViewUntil; delete unit.mem.platnmBaseRange;
    }, { owner: unit });
  }
  if (body.charId === 'char_498_inside') {
    const module = selectedModule(body, piece);
    const delayedValues = body.modePassives[1].values;
    if (delayedValues.once !== true) throw new TypeError('Insider delayed ammo-cap grant must be source-declared once per battle');
    const capBonus = number(unit, body.fixedSkill.effects[1].values.capBonus, 'Insider base ammo capacity') + (module?.ammoCapBonus ?? 0);
    unit.mem.assaultAmmo ??= { current: capBonus, cap: capBonus };
    registerAssaultAmmo(battle, unit, { get: () => unit.mem.assaultAmmo.current, set: (next) => { unit.mem.assaultAmmo.current = next; }, max: () => capBonus });
    const reloaded = new Set();
    battle.on('death', ({ unit: dead, killer }) => {
      if (killer !== unit || dead?.side !== 'enemy' || reloaded.has(uid(dead))) return;
      reloaded.add(uid(dead));
      const reload = rangedLine(unit, 1, 'r', number(unit, body.modePassives[0].values.reload, 'Insider kill reload'));
      reloadAssaultAmmo(battle, unit, unit, reload, `assault:${body.charId}:kill-reload`);
    }, { owner: unit });
    battle.on('deploy', ({ unit: deployed }) => {
      if (deployed !== unit) return;
      const preserveClock = delayedValues.fullHpRedeployNoReset === true && delayedValues.clockContinues === true;
      if (unit.mem.insideClockStart == null || !preserveClock) unit.mem.insideClockStart = battle.time;
    }, { owner: unit });
    battle.on('tick', () => {
      if (unit.mem.insideClockStart == null || (delayedValues.once && unit.mem.insideGrantDone) || battle.time < unit.mem.insideClockStart + 20) return;
      unit.mem.insideGrantDone = true;
      setAssaultAmmoCapacityBonus(unit, `assault:${body.charId}:delayed-self`, 1); // bazaar: 此干员也是拉特兰干员，同样 +1
      unit.mem.assaultAmmo.cap = assaultAmmoState(unit).capacity;
      const candidates = battle.allyUnits.filter((ally) => active(ally) && ally.kind === 'op'
        && (ally.def?.raw?.assaultBody ?? ally.def?.assaultBody)?.nationId === 'laterano');
      // bazaar: 在场 20 秒后，你的拉特兰干员弹药上限 +1（全体，原为随机 1 名）。
      for (const chosen of candidates.filter((ally) => ally !== unit && ally.ownerId === unit.ownerId)) {
        setAssaultAmmoCapacityBonus(chosen, `assault:${body.charId}:laterano`, 1);
        if (chosen.mem.assaultAmmo) chosen.mem.assaultAmmo.cap = assaultAmmoState(chosen).capacity;
      }
    }, { owner: unit });
  }
  for (const [index, effect] of (body.modePassives ?? []).entries()) {
    // bazaar: these passives are replaced by card lines in ranged-bazaar.js.
    if (RANGED_BAZAAR_REPLACED_PASSIVES.has(`${body.charId}:${index}`)) continue;
    if (body.charId === 'char_4051_akkord') continue;
    if (body.charId === 'char_190_clour') continue;
    if (body.charId === 'char_440_pinecn' && index === 0) continue;
    if (body.charId === 'char_484_robrta') continue;
    if (body.charId === 'char_235_jesica') continue; // Both are explicitly attached to her one-shot skill cast below.
    if (body.charId === 'char_258_podego') continue; // Dynamic profession aura and every-third-shot heal have dedicated handlers.
    if (body.charId === 'char_4100_caper') continue; // Mutable hit hook owns both the crit and its one-shot cost mark.
    if (body.charId === 'char_366_acdrop' || body.charId === 'char_1021_kroos2') continue;
    if (body.charId === 'char_183_skgoat' && index === 1) continue; // Field tick owns the bounded successful-slow SP refund.
    if (body.charId === 'char_498_inside') continue; // Ammo pool, kill reload and deploy clock have dedicated owner-bound handlers.
    const binding = effectPlan(body, 'modePassives', index);
    if (!binding.event || binding.event === 'tick') throw new TypeError(`modePassive requires a discrete typed event: ${body.charId}:${index}`);
    let lastDeployment = null;
    const seenAttackIds = new Set();
    watch(battle, unit, binding.event, `assault:${body.charId}:modePassive:${index}`,
      ({ payload }) => {
        if (!eventBelongs(binding, unit, payload) || binding.status && payload?.status !== binding.status) return false;
        if (binding.oncePerDeployment) {
          const deployment = unit.deploySeq ?? 0;
          if (lastDeployment === deployment) return false;
          lastDeployment = deployment;
        }
        if (binding.condition !== 'skillHitSameRow') return true;
        const attackId = payload?.attackId;
        if (binding.condition === 'skillHitSameRow' && (!payload?.skillId || !attackId || !payload.target || payload.target.tileR !== unit.tileR || seenAttackIds.has(attackId))) return false;
        if (attackId) seenAttackIds.add(attackId);
        return true;
      },
      ({ cause, event }) => perform(battle, unit, body, piece, plan, effect, index, cause, 'modePassives', event));
  }
  for (const binding of body.talentBindings ?? []) {
    if (body.charId === 'char_235_jesica' && binding.binding === 'assaultTalent:native_talent_0') continue;
    if (binding.binding === 'none') continue;
    if (String(binding.binding).startsWith('modePassive:')) continue;
    if (body.charId === 'char_484_robrta' && binding.binding === 'assaultTalent:native_talent_0') continue;
    const typed = effectPlan(body, 'talents', 0, binding.binding);
    if (typed.staticBuff) {
      buff(battle, unit, unit, { key: `assault:${body.charId}:talent:${binding.binding}`, mods: { aspd: number(unit, typed.staticBuff.attackSpeed, 'talent attack speed') }, duration: Infinity });
      continue;
    }
    if (typed.delegatedPassive) continue;
    if (typed.airDamageMultiplier) continue;
    if (typed.delegatedModePassive) continue;
    if (typed.defIgnoreFlat) continue;
    if (!typed.event || typed.event === 'tick') throw new TypeError(`talent requires a discrete typed event: ${body.charId}:${binding.binding}`);
    watch(battle, unit, typed.event, `assault:${body.charId}:talent:${binding.binding}`,
      ({ payload }) => eventBelongs(typed, unit, payload),
      ({ cause, event }) => {
        if (typed.status) {
          const module = selectedModule(body, piece);
          const duration = typed.moduleDurationKey == null ? typed.duration : (module?.[typed.moduleDurationKey] ?? typed.duration);
          if (!(Number.isFinite(duration) && duration > 0)) throw new TypeError(`invalid typed talent duration: ${body.charId}:${binding.binding}`);
          for (const target of select(battle, unit, typed, event)) applyStatus(battle, unit, target, {
            status: typed.status, duration, key: `assault:${body.charId}:talent:${binding.binding}`, cause,
          });
        }
        else throw new TypeError(`unimplemented typed talent effect: ${body.charId}:${binding.binding}`);
      });
  }
}
function builder(charId) {
  const plan = rangedPlans[charId];
  const indigoFields = new WeakMap();
  const timedFields = new WeakMap();
  return (_battle, raw, def) => {
    if (!plan || def.charId !== charId || raw?.assaultBody?.charId !== charId) throw new Error(`ranged KIT/body mismatch: ${charId}`);
    const body = raw.assaultBody; const piece = raw.assaultPiece;
    const kit = makeKit(def, {
      passive: body.fixedSkill.kind === 'passive',
      canCast: ({ battle, unit }) => {
        if (['char_4051_akkord', 'char_4100_caper'].includes(charId)) return enemies(battle, unit, { scope: 'range', count: 1, priority: 'exit' }).length > 0;
        if (charId === 'char_484_robrta') return true;
        if (charId === 'char_258_podego') return enemies(battle, unit, { scope: 'range', count: 1, priority: 'exit' }).length > 0;
        // A skill that deals damage fires only when one of its damage effects has a target: its self-only
        // mechanism / ammo lines never cast it into an empty range on their own (assault.js family rule).
        const strikes = (body.fixedSkill.effects ?? []).map((effect, index) => [effect, index]).filter(([effect]) => effect.action === 'damage');
        if (strikes.length && !strikes.some(([, index]) => select(battle, unit, effectPlan(body, 'skill', index)).length > 0)) return false;
        return (body.fixedSkill.effects ?? []).some((effect, index) => {
        const typed = effectPlan(body, 'skill', index);
        if (charId === 'char_498_inside' && index === 0 && (unit.mem.assaultAmmo?.current ?? 0) <= 0) return false;
        return select(battle, unit, typed).length > 0 || effect.action === 'summon';
      });
      },
      cast: ({ battle, unit, cause }) => {
        if (charId === 'char_4051_akkord' || charId === 'char_4100_caper') {
          const target = enemies(battle, unit, { scope: 'range', count: 1, priority: 'exit' })[0];
          if (!target) return false;
          const scale = number(unit, body.fixedSkill.effects[0].values.atkScale, `${charId} authored immediate scale`);
          const type = charId === 'char_4051_akkord' ? 'arts' : 'phys';
          const did = damage(battle, unit, target, { scale, type, isSkill: true, sourceKey: `assault:${charId}:native-instant`, cause }) > 0;
          const module = selectedModule(body, piece);
          if (did && charId === 'char_4051_akkord' && module?.postSkillAspd) {
            buff(battle, unit, unit, { key: `assault:${charId}:module-aspd`, mods: { aspd: module.postSkillAspd }, duration: module.postSkillDuration, cause });
          }
          return did;
        }
        if (charId === 'char_183_skgoat') {
          const values = body.fixedSkill.effects[0].values, targets = enemies(battle, unit, { scope: 'range', count: 99, priority: 'exit' });
          // bazaar: 「待确认的申请表」：主动停顿 +a 秒。
          const stop = number(unit, values.duration, 'Skgoat instant stop duration') + rangedModule(unit, 'uniequip_002_skgoat', 'a', 0);
          for (const target of targets) applyStatus(battle, unit, target, { status: values.status, duration: stop, key: `assault:${charId}:instant-sand`, cause });
          return targets.length > 0;
        }
        if (charId === 'char_258_podego') {
          const values = body.fixedSkill.effects[0].values, module = selectedModule(body, piece);
          const target = enemies(battle, unit, { scope: 'range', count: 1, priority: 'exit' })[0];
          if (!target) return false;
          const anchor = { x: target.x, y: target.y };
          const duration = number(unit, values.duration, 'Podego spore duration') + (module?.durationBonus ?? 0);
          const interval = number(unit, values.interval, 'Podego spore interval');
          const scale = number(unit, values.dotAtkScale, 'Podego spore damage') * (module?.dotMultiplier ?? 1);
          const slow = number(unit, values.slow, 'Podego spore slow');
          let elapsed = 0, timer;
          timer = battle.every(interval, () => {
            if (elapsed >= duration) { timer.cancel(); return; }
            elapsed += interval;
            for (const target of battle.enemiesInRadius(anchor.x, anchor.y, 1, true).filter(active)) {
              damage(battle, unit, target, { scale, type: 'arts', isSkill: true, sourceKey: `assault:${charId}:spore:${elapsed}`, cause });
              applyStatus(battle, unit, target, { status: 'silence', duration: interval, key: `assault:${charId}:spore-silence`, cause });
              applyStatus(battle, unit, target, { status: 'sluggish', duration: interval, value: slow, key: `assault:${charId}:spore-stop`, cause });
            }
          });
          return true;
        }
        if (charId === 'char_190_clour') {
          const values = body.fixedSkill.effects[0].values, i = piece.star - 1, module = selectedModule(body, piece);
          const targets = enemies(battle, unit, { scope: 'range', count: module?.maxTargets ?? values.maxTarget, priority: 'exit' });
          for (const target of targets) damage(battle, unit, target, { scale: number(unit, values.atkScale, 'Clour native attack scale') * [1.2, 1.3, 1.4, 1.5][i], type: 'phys', isSkill: true, sourceKey: `assault:${charId}:instant-double`, cause });
          return targets.length > 0;
        }
        if (charId === 'char_204_platnm') {
          const [hit, view] = body.fixedSkill.effects.map((effect) => effect.values), rangeKey = `assault:${charId}:single-cast-range`;
          battle.addBuff(unit, { key: rangeKey, mods: { rangeExtend: 1 }, duration: 0.1, source: unit }); battle.refreshRange(unit);
          let targets;
          try { targets = enemies(battle, unit, { scope: 'range', count: 99, priority: 'exit' }); }
          finally { battle.removeBuff(unit, rangeKey); battle.refreshRange(unit); }
          for (const target of targets) damage(battle, unit, target, { scale: number(unit, hit.atkScale, 'Platinum native attack scale') * (1 + number(unit, view.atk, 'Platinum attack bonus')), type: 'phys', isSkill: true, sourceKey: `assault:${charId}:single-cast`, cause });
          return targets.length > 0;
        }
        if (charId === 'char_253_greyy') {
          const [hit, stop] = body.fixedSkill.effects, i = piece.star - 1, module = selectedModule(body, piece);
          let targets;
          if (module?.rangeRadius) {
            const expanded = new Set(unit.rangeKeys ?? []);
            for (const key of [...expanded]) {
              const row = Math.floor(key / COLS), col = key % COLS;
              for (let dr = -module.rangeRadius; dr <= module.rangeRadius; dr++) for (let dc = -module.rangeRadius; dc <= module.rangeRadius; dc++) {
                const r = row + dr, c = col + dc;
                if (r >= 0 && c >= 0 && c < COLS) expanded.add(r * COLS + c);
              }
            }
            targets = battle.enemiesInKeys([...expanded], unit, unit.profile ?? {});
          } else targets = enemies(battle, unit, { scope: 'range', count: 99, priority: 'exit' });
          for (const target of targets) {
            damage(battle, unit, target, { scale: number(unit, hit.values.atkScale, 'Greyy authored scale'), type: 'arts', isSkill: true, sourceKey: `assault:${charId}:instant-aoe`, cause });
            applyStatus(battle, unit, target, { status: 'slow', value: number(unit, stop.values.slow, 'Greyy slow value'), duration: Array.isArray(stop.values.duration) ? stop.values.duration[i] : stop.values.duration, key: `assault:${charId}:instant-stop`, cause });
          }
          return targets.length > 0;
        }
        if (charId === 'char_366_acdrop') {
          const hit = body.fixedSkill.effects[0].values, target = enemies(battle, unit, { scope: 'range', count: 1, priority: 'exit' })[0], module = selectedModule(body, piece);
          if (!target) return false;
          const scale = number(unit, hit.atkScale, 'Aciddrop authored scale') + (module?.skillScaleBonus ?? 0);
          return damage(battle, unit, target, { scale, hits: Number(v(unit, hit.times ?? 2)), type: 'phys', isSkill: true, sourceKey: `assault:${charId}:instant-double`, cause }) > 0;
        }
        if (charId === 'char_469_indigo') {
          const [hit, status] = body.fixedSkill.effects, i = piece.star - 1, module = selectedModule(body, piece), targets = enemies(battle, unit, { scope: 'range', count: 99, priority: 'exit' });
          for (const target of targets) {
            damage(battle, unit, target, { scale: [1.4, 1.8, 2.2, 2.6][i], type: 'arts', isSkill: true, sourceKey: `assault:${charId}:instant-burst`, cause });
            const probability = Math.min(1, number(unit, status.values.prob, 'Indigo bind probability') * (module?.bindProbabilityMultiplier ?? 1));
            if (battle.rng() < probability) applyStatus(battle, unit, target, { status: 'bind', duration: number(unit, status.values.duration, 'Indigo bind duration'), key: `assault:${charId}:instant-bind`, cause });
          }
          return targets.length > 0;
        }
        if (charId === 'char_484_robrta') {
          const device = body.fixedSkill.effects[0].values, shield = body.fixedSkill.effects[1].values;
          const capacity = Number(v(unit, device.maxCount ?? 3));
          const result = grantSummon(battle, unit, { tokenId: device.tokenKey ?? 'token_10018_robrta_mach', count: Number(v(unit, device.gain ?? 1)), stockCap: capacity, fieldCap: capacity, ruleKey: `assault:${charId}:device` });
          battle.addBuff(unit, { key: `assault:${charId}:instant-shield`, shield: unit.s.maxHp * number(unit, shield.selfShieldRatio, 'Robrta instant shield'), source: unit, visible: true });
          return result.granted > 0 || ratio > 0;
        }
        if (charId === 'char_183_skgoat' || charId === 'char_258_podego') {
          timedFields.get(unit)?.();
          const module = selectedModule(body, piece);
          const values = body.fixedSkill.effects[0].values;
          const duration = number(unit, values.duration, 'field duration') + (module?.durationBonus ?? 0);
          const interval = charId === 'char_183_skgoat'
            ? Math.max(0.1, number(unit, values.interval, 'sand interval') - (module?.intervalBonus ?? 0))
            : number(unit, values.interval, 'spore interval');
          const until = battle.time + duration;
          const fieldKey = `assault:${charId}:field`;
          const timer = onTimer(battle, unit, interval, (b, handle) => {
            if (!active(unit) || b.time >= until) { handle.cancel?.(); return; }
            const targets = enemies(b, unit, { scope: 'range', count: 99, priority: 'exit' });
            let spPaid = 0;
            for (const target of targets) {
              if (charId === 'char_183_skgoat') {
                const slow = Math.min(0.95, number(unit, values.slow, 'sand slow') + (module?.slowBonus ?? 0));
                // bazaar: the per-slow SP refund is replaced by 「当你施加停顿时，为此干员充能」 (ranged-bazaar.js).
                applyStatus(b, unit, target, { status: 'slow', duration: number(unit, values.slowDuration, 'sand duration'), value: slow, key: fieldKey, cause });
                void spPaid;
              } else {
                const slow = number(unit, values.slow, 'spore slow');
                applyStatus(b, unit, target, { status: 'slow', duration: interval + 0.05, value: slow, key: fieldKey, cause });
                applyStatus(b, unit, target, { status: 'silence', duration: interval + 0.05, key: `${fieldKey}:silence`, cause });
                damage(b, unit, target, { scale: number(unit, values.dotAtkScale, 'spore damage') * (module?.dotMultiplier ?? 1), type: 'arts', isSkill: true, sourceKey: fieldKey, cause });
              }
            }
          }, { every: true });
          timedFields.set(unit, timer);
          return true;
        }
        const did = (body.fixedSkill.effects ?? []).map((effect, index) => {
          if (charId === 'char_469_indigo' && rangedEffectPlans[charId].skill[index]?.fieldTick) {
            indigoFields.get(unit)?.cancel?.();
            const values = effect.values;
            const module = selectedModule(body, piece);
            const interval = module?.fieldInterval ?? number(unit, values.interval, 'bind field interval');
            const duration = number(unit, values.duration, 'bind field duration');
            const scale = number(unit, values.atkScale, 'bind field damage scale');
            const until = battle.time + duration;
            const cancel = onTimer(battle, unit, interval, (b, timer) => {
              if (b.time >= until || !active(unit)) { timer.cancel?.(); return; }
              for (const target of enemies(b, unit, { scope: 'range', count: 99, priority: 'exit' })) {
                if (target.buffs?.some((entry) => entry.status === 'bind')) damage(b, unit, target, { scale, type: 'arts', isSkill: true, sourceKey: `assault:${charId}:bind-field`, cause });
              }
            }, { every: true });
            indigoFields.set(unit, { cancel });
            return true;
          }
          return perform(battle, unit, body, piece, plan, effect, index, cause);
        }).some(Boolean);
        if (did && charId === 'char_235_jesica') {
          const values = body.modePassives[1].values;
          buff(battle, unit, unit, { key: `assault:${charId}:post-skill-aspd`, mods: { aspd: number(unit, values.attackSpeed, 'post-skill attack speed') }, duration: number(unit, values.duration, 'post-skill attack speed duration'), cause });
        }
        if (did && charId === 'char_204_platnm') {
          const view = body.fixedSkill.effects[1].values;
          if (view.rangeExpand !== true) throw new TypeError('Platinum view requires source-declared range expansion');
          const duration = number(unit, view.duration, 'Platinum view duration');
          const base = (unit.baseRangeKeys ?? unit.rangeKeys ?? []).slice();
          unit.mem.platnmBaseRange = base;
          unit.mem.platnmViewUntil = battle.time + duration;
          const [dr, dc] = unit.fwd ?? [0, 1];
          const expanded = new Set(base);
          for (const cell of base) {
            const row = Math.floor(cell / COLS); const col = cell % COLS;
            const r = row + dr; const c = col + dc;
            if (r >= 0 && r < 11 && c >= 0 && c < COLS) expanded.add(r * COLS + c);
          }
          unit.rangeKeys = [...expanded]; unit.rangeKeySet = expanded;
        }
        return did;
      },
      install: (battle, unit) => { installPassives(battle, unit, body, piece, plan); installRangedBazaar(battle, unit, body); },
    });
    if (charId === 'char_440_pinecn') {
      const module = selectedModule(body, piece);
      kit.skill.charges = [2, 2, 3, 3][piece.star - 1] + (module ? 1 : 0);
    }
    return kit;
  };
}
export const rangedKits = Object.freeze(Object.fromEntries(rangedCharIds.map((id) => [id, builder(id)])));
