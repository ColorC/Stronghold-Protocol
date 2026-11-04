// Synergy cards of the support family (design of 2026-10-21, design-172.json via tools/assault/import-synergy-design.mjs).
// See synergy-assault.js for the conventions: one kit per card, one handler per card line, numbers from the card params.
// A constant written in the card text is a named constant here and the card test checks the text says the same.
//
// 「下次攻击 / 下次治疗……」 skills resolve at once on the current target (every skill of the 10-21 table is instant).
// Lines whose trigger is this operator's own attack on an enemy another operator controls (「攻击被你的其他干员晕眩的
// 敌人时」, event attack by enemyByOthers) change the damage of that hit: they are a hit hook installed once, and the
// bound attack trigger itself does nothing (options.accept refuses it).

import { synergyKit, cardParam, moduleParam, moduleOf, effects, bindTrigger, around8, isElite } from '../card-lines.js';
import { relates, matchesClass, redeployRemaining, counterValue, deployEffect, enemyAura, seedTile, hasOwnBarrier } from '../synergy.js';
import { assaultAmmoState } from '../ammo.js';
import { active, enemies, uid, heal } from '../primitives.js';
import { grantSummon } from '../summons.js';
import { dirVec, rotateOffset } from '../../../dir.js';
import { COLS } from '../../../constants.js';
import { roundHalfEven } from '../../../detmath.js';
import { resolveProfile } from '../../../professions.js';

// ------------------------------------------------------------------ helpers ---

const byExit = (battle) => (a, b) => battle.remainingDistance(a) - battle.remainingDistance(b) || uid(a).localeCompare(uid(b));
const rangeEnemies = (battle, unit, count = 99) => enemies(battle, unit, { scope: 'range', count });
/** 周围: enemies on the unit's tile and the 8 around it, nearest the exit first (ground ones only with { ground }). */
const aroundEnemies = (battle, unit, count = 99, { ground = false } = {}) => battle.enemies
  .filter((e) => e.alive && !e.removed && !e.hidden && around8(unit, e) && (!ground || !e.isFlying)).sort(byExit(battle)).slice(0, count);
/** Your operators on the field in deployment order (the unit included unless { others }). */
const yourOps = (battle, unit, { others = false } = {}) => battle.assaultDeploymentOrder()
  .filter((x) => x.kind === 'op' && active(x) && relates(unit, x, others ? 'other' : 'yours'));
/** Your units on the 8 tiles around the unit (and its own tile): operators and summons, what a heal reaches. */
const aroundAllies = (battle, unit, { others = false, ops = false } = {}) => battle.allyUnits.filter((x) => (ops ? x.kind === 'op' : x.kind !== 'device')
  && active(x) && relates(unit, x, others ? 'other' : 'yours') && around8(unit, x));
const lowestHp = (list, count = 1) => [...list].sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp || uid(a).localeCompare(uid(b))).slice(0, count);
const injured = (list) => list.filter((x) => x.hp < x.s.maxHp - 1e-6);
const fullHp = (e) => e.hp >= e.s.maxHp - 1e-6;
/** 地面干员: an operator deployed on a ground (melee) tile. */
const groundOp = (x) => !x.isFlying && x.def?.position !== 'RANGED';
const hasBuff = (unit, part) => (unit?.buffs ?? []).some((b) => String(b.key).includes(part) && b.timeLeft > 0);
/** Is `e` held by status X that one of your other units put on it (the status buff's source)? */
const byOthers = (unit, e, statuses) => (e?.buffs ?? []).some((b) => statuses.includes(b.status) && b.timeLeft > 0 && b.source && relates(unit, b.source, 'other'));
/** One of the unit's own normal attacks hitting an enemy (not a skill hit, not an effect's damage). */
const ownAttack = (unit, source, target, dmg) => source === unit && active(unit) && target?.side === 'enemy' && !!dmg?.isAttack && !dmg.isSkill && dmg.amount > 0;
/** A number of the native skill the card picked (blackboard key) — what the card text says in words only (略微增大 …). */
function nativeValue(unit, key) {
  const body = unit.def.raw.assaultBody;
  const id = body.fixedSkill?.sourceSkillId ?? body.bazaar?.skillSource;
  const value = body.source?.skills?.find((s) => s.skillId === id)?.blackboard?.find((x) => x.key === key)?.value;
  if (!Number.isFinite(value)) throw new TypeError(`${body.charId}: native skill ${id} has no ${key}`);
  return value;
}
/** 攻击间隔 +x 秒 as the batPct of the unit's base attack interval. */
const batOf = (unit, seconds) => seconds / unit.base.bat;
/** Run `fn` once per unit and key (hooks of a line that runs at every real deployment). */
function once(unit, key, fn) {
  const done = (unit.mem.supportOnce ??= new Set());
  if (done.has(key)) return;
  done.add(key);
  fn();
}

/**
 * 光环 whose numbers move (卡内计数, 条件): every 0.25 s each of your operators that `select` picks gets `mods(x)` (a short
 * replace buff; null = none now), while the source is on the field. Registered once per unit and key.
 */
function liveAura(battle, unit, key, { select, mods, highest = null }) {
  once(unit, `liveAura:${key}`, () => {
    // highest: a key shared by every source of the same effect, and only the strongest one holds (「同类效果取最高」)
    const buffKey = highest ? `assault:liveAura:${highest}` : `assault:liveAura:${uid(unit)}:${key}`;
    const strength = (m) => Object.values(m ?? {}).reduce((a, b) => a + Math.abs(Number(b) || 0), 0);
    const sync = () => {
      if (!active(unit)) return;
      for (const x of battle.allyUnits) {
        if (x.kind !== 'op' || !active(x) || !relates(unit, x, 'yours') || !select(x)) continue;
        const m = mods(x);
        if (!m) continue;
        const held = highest ? x.buffs.find((b) => b.key === buffKey && b.timeLeft > 0) : null;
        if (held && held.source !== unit && strength(held.mods) > strength(m)) continue;
        battle.addBuff(x, { key: buffKey, mods: m, duration: 0.5 + 1e-6, refresh: 'replace', source: unit, visible: false });
      }
    };
    battle.every(0.25, sync, { owner: unit, immediate: true });
    sync();
  });
}

/** 当前再部署时间 -x 秒 / -x% of one operator (the line names units, not a class: cutRedeploy's filter names classes). */
function cutTimer(battle, x, { seconds = 0, percent = 0 }) {
  const shorten = (left) => Math.max(0, left * (1 - percent) - seconds);
  if (x.alive && x.deployed && x.assaultCycle) { x.assaultCycle.at = battle.time + shorten(x.assaultCycle.at - battle.time); return true; }
  if (!x.alive && !x.removed && Number.isFinite(x.respawnAt) && x.respawnAt > battle.time) { x.respawnAt = battle.time + shorten(x.respawnAt - battle.time); return true; }
  return false;
}

const tileKey = (x) => (x.side === 'ally' && Number.isFinite(x.tileR) ? x.tileR * 21 + x.tileC : Math.round(x.y) * 21 + Math.round(x.x));
/** Is `x` on a tile of the unit's attack range (its own tile included when the range has it)? */
const inRange = (unit, x) => [...(unit.rangeKeys ?? [])].includes(tileKey(x));
/** Your units in the unit's attack range: operators and summons (what a heal reaches), or operators only. */
const rangeAllies = (battle, unit, { others = false, ops = false } = {}) => battle.allyUnits.filter((x) => (ops ? x.kind === 'op' : x.kind !== 'device')
  && active(x) && relates(unit, x, others ? 'other' : 'yours') && inRange(unit, x));
const spRatio = (x) => (x.skill?.spCost ? ((x.skill.charges ?? 0) * x.skill.spCost + x.skill.sp) / ((x.skill.maxCharges ?? 1) * x.skill.spCost) : 1);
const chargeable = (x) => x.skill && !x.skill.noSkill && x.skill.kind !== 'passive';
/** The heaviest element gauge of `x` as a share of its gauge (元素损伤累计). */
const elementLoad = (x) => Math.max(0, ...Object.values(x.elem ?? {}).filter(Number.isFinite)) / (x.gaugeMax || 1000);
/**
 * 「治疗量 +x%」 of this unit's heals (and its summons' with { summons }): `factor(ctx)` multiplies the amount of every heal
 * it makes (ctx = the native healingAmount context: source, target, amount). Registered once per unit and key.
 */
function healBoost(battle, unit, key, factor, { summons = false } = {}) {
  once(unit, `healBoost:${key}`, () => battle.on('healingAmount', (ctx) => {
    if (!active(unit) || !(ctx.source === unit || (summons && ctx.source?.ownerUnit === unit))) return;
    ctx.amount *= factor(ctx);
  }, { owner: unit }));
}

// the negative statuses 「解除异常状态」 removes
const ABNORMAL = new Set(['stun', 'freeze', 'cold', 'sleep', 'slow', 'sluggish', 'bind', 'fragile', 'artsFragile', 'physFragile', 'elemFragile',
  'silence', 'fear', 'tremble', 'disarm', 'levitate', 'weaken', 'aspdDown', 'defDown', 'resDown', 'palsy', 'groundbind']);
/** 解除异常状态: removes every negative status on `x`; returns how many. */
function cleanse(battle, x) {
  const gone = (x.buffs ?? []).filter((b) => ABNORMAL.has(b.status));
  for (const b of gone) battle.removeBuff(x, b);
  return gone.length;
}
/**
 * 咒愈师 module 「攻击敌人时为攻击范围内 1 名干员治疗 x% 伤害的生命」: each attack damage of the unit heals the lowest one
 * of your injured units in its range. Registered once.
 */
function spellHeal(battle, unit, moduleId, percent) {
  once(unit, `spellHeal:${moduleId}`, () => battle.on('damaged', ({ source, target, amount, dmg }) => {
    if (source !== unit || !active(unit) || moduleOf(unit) !== moduleId || target?.side !== 'enemy' || !dmg?.isAttack || !(amount > 0)) return;
    const [x] = lowestHp(injured(rangeAllies(battle, unit)));
    if (x) effects(battle, unit, { index: `module:${moduleId}` }).heal(x, { amount: amount * percent / 100 });
  }, { owner: unit }));
}
/** 「在 n 名干员间跳跃」: heals `first`, then up to n − 1 more injured units each next to the last one, ×(1 − falloff) a jump. */
function chainHeal(battle, unit, fx, first, { scale, count, falloff }) {
  const healed = [first];
  fx.heal(first, { scale });
  let prev = first;
  for (let k = 1; k < count; k++) {
    const next = lowestHp(injured(battle.allyUnits.filter((x) => x.kind !== 'device' && active(x) && relates(unit, x, 'yours') && !healed.includes(x)
      && Math.max(Math.abs(x.tileR - prev.tileR), Math.abs(x.tileC - prev.tileC)) <= 2)))[0];
    if (!next) break;
    let mul = 1;
    for (let i = 0; i < k; i++) mul *= 1 - falloff;
    fx.heal(next, { scale: scale * mul });
    healed.push(next);
    prev = next;
  }
  return healed;
}

/**
 * 「t 秒内逐渐获得 x 费用」: one even share a second for `seconds` s. A recast while it runs adds the new amount and starts
 * the time again (持续中可重复发起).
 */
function gradualDp(battle, unit, amount, seconds) {
  const state = unit.mem.supportGradualDp ??= { left: 0, ticks: 0 };
  state.left += amount;
  state.ticks = seconds;
  once(unit, 'gradualDp', () => battle.every(1, () => {
    if (!active(unit) || state.ticks <= 0) return;
    const share = state.left / state.ticks;
    state.left -= share;
    state.ticks--;
    if (share > 0) effects(battle, unit, { index: 'skill' }).dp(share);
  }, { owner: unit }));
}

// -------------------------------------------------------------------- 香草 ---
// Her deployment and skill give DP; each cast pushes your other 先锋's timers on; DP your other operators give stacks her
// attack for the battle and, every 10 of it, grows her for the run.

const WYVERN_ATK = 35, WYVERN_SECONDS = 10, WYVERN_DP_STEP = 10;

const wyvern = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.dp(cardParam(unit, 1, 'b'));
    fx.sustain(unit, { key: 'reinforce', mods: { atkPct: WYVERN_ATK / 100 }, duration: WYVERN_SECONDS });
    return true;
  },
  lines: {
    0: ({ p, fx }) => fx.dp(p('a')),
    1: 'cast',
    2: ({ p, fx }) => fx.cutRedeploy({ seconds: p('c'), filter: { label: '先锋' }, includeSelf: false }),
    3: ({ unit, p, fx }) => fx.stack(unit, { key: 'dp', stat: 'atk', amount: p('d') / 100, mode: 'percent' }),
    4: ({ unit, p, fx, payload }) => {
      unit.mem.wyvernDp = (unit.mem.wyvernDp ?? 0) + payload.amount;
      while (unit.mem.wyvernDp >= WYVERN_DP_STEP - 1e-9) {
        unit.mem.wyvernDp -= WYVERN_DP_STEP;
        fx.growth(unit, { key: 'reinforcements', stat: 'atk', percent: p('e') / 100 });
      }
    },
  },
});

// -------------------------------------------------------------------- 红豆 ---
// 蛮力穿刺 crits her attacks (always the 3 after each deployment, more often against enemies your other operators stunned
// or made tremble); her kills feed her neighbours; other operators' stuns stack her attack; their elite kills grow 蛮力穿刺.

const VIGNA_FORCED = 3, VIGNA_CHANCE = 10, VIGNA_SKILL_CHANCE = 30, VIGNA_CRIT = 110, VIGNA_KILL_DP = 1, VIGNA_KILL_CHARGE = 1;
const VIGNA_MODULE = 'uniequip_002_vigna', VIGNA_MODULE_LOW = 0.4, VIGNA_MODULE_ATK = 1.15, VIGNA_GROWTH = 'vigna-crit';

const vigna = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'gavel',
      mods: { atkPct: cardParam(unit, 1, 'a') / 100, batPct: batOf(unit, nativeValue(unit, 'base_attack_time')) }, duration: cardParam(unit, 1, 'e') });
    return true;
  },
  lines: {
    0: ({ unit }) => { unit.mem.vignaForced = VIGNA_FORCED; },
    1: 'cast',
    2: {
      install: ({ battle, unit, p, fx }) => battle.on('hit', ({ source, target, dmg }) => {
        if (!ownAttack(unit, source, target, dmg)) return;
        const forced = (unit.mem.vignaForced ?? 0) > 0;
        const chance = Math.max(hasBuff(unit, ':gavel') ? VIGNA_SKILL_CHANCE : VIGNA_CHANCE, byOthers(unit, target, ['stun', 'tremble']) ? p('b') : 0);
        if (!forced && !(battle.rng() < chance / 100)) return;
        if (forced) unit.mem.vignaForced--;
        dmg.amount *= 1 + (VIGNA_CRIT + fx.growthValue(unit, VIGNA_GROWTH)) / 100;
      }, { owner: unit, priority: 90 }),
      options: { accept: () => false },
      run: () => {},
    },
    3: ({ fx }) => { fx.dp(VIGNA_KILL_DP); for (const x of fx.allies('adjacentAllies')) fx.charge(x, VIGNA_KILL_CHARGE); },
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'rock', stat: 'atk', amount: p('c') / 100, mode: 'percent' }),
    5: ({ unit, p, fx }) => fx.growthCounter(unit, { key: VIGNA_GROWTH, label: '蛮力穿刺攻击力加成', amount: p('d'), suffix: '%' }),
  },
  modules: {
    // 伟大的摇滚：攻击生命低于 40% 的敌人时，攻击力提升至 115%
    [VIGNA_MODULE]: {
      install: ({ battle, unit }) => battle.on('hit', ({ source, target, dmg }) => {
        if (ownAttack(unit, source, target, dmg) && target.hp < target.s.maxHp * VIGNA_MODULE_LOW) dmg.amount *= VIGNA_MODULE_ATK;
      }, { owner: unit, priority: 80 }),
      run: () => {},
    },
  },
});

// ------------------------------------------------------------------ 桃金娘 ---
// Her skill redeploys the other operator closest to its 再部署; other 先锋's casts get healed and give DP, and stack a
// regeneration for all your 先锋 for the battle.

const MYRTLE_DEPLOY_HEAL = 10, MYRTLE_SECONDS = 8, MYRTLE_HEAL = 50, MYRTLE_VANGUARD_DP = 1;
const MYRTLE_MODULE = 'uniequip_002_myrtle', MYRTLE_MODULE_REGEN = 33, MYRTLE_MODULE_BLOCK = 1;
const vanguard = (x) => matchesClass(x, { label: '先锋' });

const myrtle = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.dp(cardParam(unit, 1, 'b'));
    fx.sustain(unit, { key: 'wing', mods: {}, flags: { disarm: true }, duration: MYRTLE_SECONDS });
    unit.mem.myrtleUntil = battle.time + MYRTLE_SECONDS;
    // “私人收藏”：技能期间阻挡数变为 0，身前 1 名干员阻挡数 +1
    if (moduleOf(unit) === MYRTLE_MODULE) {
      fx.sustain(unit, { key: 'wing-block', mods: { blockCnt: -unit.s.blockCnt }, duration: MYRTLE_SECONDS });
      const [fr, fc] = dirVec(unit.dir);
      const front = yourOps(battle, unit, { others: true }).find((x) => x.tileR === unit.tileR + fr && x.tileC === unit.tileC + fc);
      if (front) fx.sustain(front, { key: 'wing-front', mods: { blockCnt: MYRTLE_MODULE_BLOCK }, duration: MYRTLE_SECONDS });
    }
    return true;
  },
  install: (battle, unit) => battle.every(1, () => {
    if (!active(unit) || !(battle.time <= (unit.mem.myrtleUntil ?? -1) + 1e-9)) return;
    const [target] = lowestHp(injured(aroundAllies(battle, unit)));
    if (target) effects(battle, unit, { index: 'skill' }).heal(target, { scale: MYRTLE_HEAL / 100 });
  }, { owner: unit }),
  lines: {
    0: ({ battle, unit, p, fx }) => {
      fx.dp(p('a'));
      for (const x of yourOps(battle, unit).filter(vanguard)) fx.heal(x, { maxHpRatio: MYRTLE_DEPLOY_HEAL / 100 });
    },
    1: 'cast',
    2: ({ battle, unit, fx }) => {
      const [next] = yourOps(battle, unit, { others: true }).map((x) => [x, redeployRemaining(battle, x)]).filter(([, left]) => left != null)
        .sort((a, b) => a[1] - b[1] || uid(a[0]).localeCompare(uid(b[0])));
      if (next) fx.redeployNow(next[0]);
    },
    3: ({ actor, p, fx }) => { fx.heal(actor, { scale: p('c') / 100 }); fx.dp(MYRTLE_VANGUARD_DP); },
    4: {
      install: ({ battle, unit }) => liveAura(battle, unit, 'vanguard-regen', { select: vanguard,
        // Native 浮光跃金 is a fixed aura; the module replaces 25 with 33.
        mods: () => moduleOf(unit) === MYRTLE_MODULE ? null : { hpRegen: 25 } }),
      run: () => {},
    },
  },
  modules: {
    // “私人收藏”：你的先锋干员每秒回复 33 生命（技能期间的阻挡变化在技能里）
    [MYRTLE_MODULE]: ({ battle, unit }) => liveAura(battle, unit, 'module-regen', { select: vanguard, mods: () => ({ hpRegen: MYRTLE_MODULE_REGEN }) }),
  },
});

// ------------------------------------------------------------------ 德克萨斯 ---
// 剑雨 gives DP and stuns everything around her; every deployment of your other 企鹅物流 gives DP and charges her; other
// operators' stuns make 剑雨 hit harder for the battle.

const TEXAS_DEPLOY_DP = 2, TEXAS_HITS = 2, TEXAS_CHARGE = 2, TEXAS_STACK = 3, TEXAS_COUNTER = 'texas-rain';
const TEXAS_MODULE = 'uniequip_002_texas', TEXAS_MODULE_DAMAGE = 15;

const texas = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.dp(cardParam(unit, 1, 'a'));
    const bonus = counterValue(battle, unit, TEXAS_COUNTER) + (moduleOf(unit) === TEXAS_MODULE ? TEXAS_MODULE_DAMAGE : 0);
    const scale = cardParam(unit, 1, 'b') / 100 * (1 + bonus / 100);
    for (const e of aroundEnemies(battle, unit)) {
      for (let i = 0; i < TEXAS_HITS && e.alive; i++) fx.damage(e, { scale, type: 'arts', isSkill: true });
      if (e.alive) fx.status(e, { status: 'stun', duration: cardParam(unit, 1, 'c') });
    }
    return true;
  },
  lines: {
    0: ({ fx }) => fx.dp(TEXAS_DEPLOY_DP),
    1: 'cast',
    2: ({ unit, p, fx }) => { fx.dp(p('d')); fx.charge(unit, TEXAS_CHARGE); },
    3: ({ unit, fx }) => fx.counter(unit, { key: TEXAS_COUNTER, label: '剑雨伤害', amount: TEXAS_STACK, suffix: '%' }),
  },
  modules: {
    // 外勤私人补给包：技能伤害 +15% — read by the cast
    [TEXAS_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 极境 ---
// 聆听 trickles DP and locks the enemies around him; each cast speeds your 狙击 up, more for every kill they made this
// battle.

const ELYSM_DEPLOY_CUT = 2, ELYSM_DP_SECONDS = 8, ELYSM_SLOW = 60, ELYSM_DEF = 35, ELYSM_SUPPORT_SECONDS = 15, ELYSM_STACK = 1;
const ELYSM_COUNTER = 'elysm-support', ELYSM_MODULE = 'uniequip_002_elysm';

const elysm = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.sustain(unit, { key: 'listen', mods: {}, flags: { disarm: true }, duration: ELYSM_DP_SECONDS });
    fx.dp(cardParam(unit, 1, 'a'));
    const extra = moduleParam(unit, ELYSM_MODULE, 'c', 0);
    for (const e of aroundEnemies(battle, unit, cardParam(unit, 1, 'd'))) {
      fx.buff(e, { key: 'lock', mods: { moveMul: 1 - ELYSM_SLOW / 100, defPct: -ELYSM_DEF / 100, ...(extra ? { dmgTakenMul: 1 + extra / 100 } : null) },
        flags: { reveal: true }, duration: cardParam(unit, 1, 'e') });
    }
    return true;
  },
  lines: {
    0: ({ fx }) => fx.cutRedeploy({ seconds: ELYSM_DEPLOY_CUT, filter: { label: '狙击' }, includeSelf: false }),
    1: 'cast',
    2: ({ battle, unit, p, fx }) => {
      const aspd = p('b') + counterValue(battle, unit, ELYSM_COUNTER);
      for (const x of fx.allies('allies:狙击')) fx.buff(x, { key: 'sniper-support', mods: { aspd }, duration: ELYSM_SUPPORT_SECONDS });
    },
    3: ({ unit, fx }) => fx.counter(unit, { key: ELYSM_COUNTER, label: '狙击支援攻击速度', amount: ELYSM_STACK }),
  },
  modules: {
    // 应急通讯指南：技能锁定的敌人受到的伤害 +c% — read by the cast
    [ELYSM_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 万顷 ---
// Her deployment pushes the timers of the operators around her on; 应东风 trickles DP and tends the ones around her;
// 看天时 raises their HP (more when they face her way), more for every cast of your other 炎 this battle.

const WANQIN_SECONDS = 15, WANQIN_HEAL = 25, WANQIN_ASPD = 25, WANQIN_STACK = 1, WANQIN_COUNTER = 'wanqin-weather', WANQIN_MODULE_DP = 1;

const wanqin = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.sustain(unit, { key: 'east-wind', mods: {}, flags: { disarm: true }, duration: WANQIN_SECONDS });
    gradualDp(battle, unit, cardParam(unit, 1, 'b'), WANQIN_SECONDS);
    unit.mem.wanqinUntil = battle.time + WANQIN_SECONDS;
    return true;
  },
  install: (battle, unit) => {
    const on = () => battle.time <= (unit.mem.wanqinUntil ?? -1) + 1e-9;
    battle.every(1, () => {
      if (!active(unit) || !on()) return;
      const fx = effects(battle, unit, { index: 'skill' });
      for (const x of injured(aroundAllies(battle, unit))) fx.heal(x, { scale: WANQIN_HEAL / 100 });
    }, { owner: unit });
    liveAura(battle, unit, 'east-wind', { select: (x) => around8(unit, x), mods: () => (on() ? { aspd: WANQIN_ASPD } : null) });
  },
  lines: {
    0: ({ battle, unit, p }) => { for (const x of yourOps(battle, unit, { others: true }).filter((x) => around8(unit, x))) cutTimer(battle, x, { seconds: p('a') }); },
    1: 'cast',
    2: ({ battle, unit, p }) => liveAura(battle, unit, 'weather', { select: (x) => around8(unit, x),
      mods: (x) => ({ hpPct: ((x.dir === unit.dir ? p('d') : p('c')) + counterValue(battle, unit, WANQIN_COUNTER)) / 100 }) }),
    3: ({ unit, fx }) => fx.counter(unit, { key: WANQIN_COUNTER, label: '看天时生命加成', amount: WANQIN_STACK, suffix: '%' }),
  },
  modules: {
    // 牵风：周围 8 格的其他干员再部署时，获得 1 费用
    uniequip_002_wanqin: { options: { around: 8 }, run: ({ fx }) => fx.dp(WANQIN_MODULE_DP) },
  },
});

// -------------------------------------------------------------------- 晓歌 ---
// A deploy-cast passive: 观火 at every deployment and in-place 再部署 (each attack meanwhile gives DP); each of her 再部署
// pushes your other 罗德岛 on; every other operator's 再部署 grows her for the run.

const CTABLE_ATTACK_DP = 1, CTABLE_ALL = 14, CTABLE_MODULE = 'uniequip_002_ctable', CTABLE_MODULE_ALL = 20;

const ctable = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'watch-fire', mods: { atkPct: cardParam(unit, 1, 'b') / 100 },
      duration: cardParam(unit, 1, 'a') });
    return true;
  },
  install: (battle, unit) => battle.on('attack', ({ attacker }) => {
    if (attacker === unit && active(unit) && hasBuff(unit, ':watch-fire')) effects(battle, unit, { index: 1 }).dp(CTABLE_ATTACK_DP);
  }, { owner: unit }),
  lines: {
    0: 'cast',
    1: 'cast',
    2: ({ p, fx }) => fx.cutRedeploy({ seconds: p('c'), filter: { label: '罗德岛' }, includeSelf: false }),
    // 万全 (模组「不发声者」 20)：未阻挡敌人时攻击速度 +14，阻挡敌人时攻击力 +14%
    3: ({ battle, unit }) => liveAura(battle, unit, 'all-round', { select: (x) => x === unit, mods: () => {
      const n = moduleOf(unit) === CTABLE_MODULE ? CTABLE_MODULE_ALL : CTABLE_ALL;
      return (unit.blocking ?? []).some((e) => e.alive) ? { atkPct: n / 100 } : { aspd: n };
    } }),
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'watch-fire', stat: 'atk', percent: p('d') / 100 }),
  },
  modules: {
    // “不发声者”：万全改为 20 — read by line 3
    [CTABLE_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 谜图 ---
// 序列 rewards her hits on unhurt enemies (自扳机, benchmark Revolver); each deployment of your other 维多利亚 charges them.

const PUZZLE_SLOW = 50, PUZZLE_SLOW_SECONDS = 3.5, PUZZLE_DP = 3, PUZZLE_CHARGE = 2, PUZZLE_MODULE = 'uniequip_002_puzzle';

const puzzle = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const [target] = rangeEnemies(battle, unit, 1);
    if (!target) return false;
    fx.damage(target, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
    fx.dp(PUZZLE_DP);
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => {
      const target = rangeEnemies(battle, unit).find(fullHp);
      if (target) fx.status(target, { status: 'slow', value: PUZZLE_SLOW / 100, duration: PUZZLE_SLOW_SECONDS });
    },
    1: 'cast',
    2: {
      install: ({ battle, unit, p, fx }) => battle.on('hit', ({ source, target, dmg }) => {
        if (!ownAttack(unit, source, target, dmg) || !fullHp(target)) return;
        dmg.amount *= p('b') / 100;
        fx.charge(unit, PUZZLE_CHARGE);
        // 首要任务 (module)：攻击命中生命为满的敌人时，使其移动速度 -50%，持续 3.5 秒
        if (moduleOf(unit) === PUZZLE_MODULE) fx.status(target, { status: 'slow', value: PUZZLE_SLOW / 100, duration: PUZZLE_SLOW_SECONDS });
      }, { owner: unit, priority: 90 }),
      options: { accept: () => false },
      run: () => {},
    },
    3: ({ actor, p, fx }) => fx.charge(actor, p('c')),
  },
  modules: {
    [PUZZLE_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 风笛 ---
// 军事传统 both ways: her deployment charges your other 先锋, theirs charge her; 精密填弹 procs on her attacks; other
// 维多利亚 casts stack her attack for the battle.

const BPIPE_HITS = 2, BPIPE_PROC_ATK = 130, BPIPE_EXTRA = 1, BPIPE_STACK = 2, BPIPE_MODULE = 'uniequip_002_bpipe', BPIPE_MODULE_DP = 2;

const bpipe = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const [target] = rangeEnemies(battle, unit, 1);
    if (!target) return false;
    for (let i = 0; i < BPIPE_HITS && target.alive; i++) fx.damage(target, { scale: cardParam(unit, 1, 'b') / 100, type: 'phys', isSkill: true });
    return true;
  },
  lines: {
    0: ({ p, fx }) => { for (const x of fx.allies('allies:先锋')) fx.charge(x, p('a')); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p, fx }) => battle.on('hit', ({ source, target, dmg }) => {
        if (!ownAttack(unit, source, target, dmg) || !(battle.rng() < p('c') / 100)) return;
        dmg.amount *= BPIPE_PROC_ATK / 100;
        for (const other of rangeEnemies(battle, unit).filter((e) => e !== target).slice(0, BPIPE_EXTRA)) {
          battle.assaultRuntime.enqueue(() => { if (other.alive) fx.damage(other, { scale: BPIPE_PROC_ATK / 100, type: 'phys' }); }, { targetUid: uid(other) });
        }
      }, { owner: unit, priority: 90 }),
      run: () => {},
    },
    3: ({ unit, p, fx }) => fx.charge(unit, p('a')),
    4: ({ unit, fx }) => fx.stack(unit, { key: 'loading', stat: 'atk', amount: BPIPE_STACK / 100, mode: 'percent' }),
  },
  modules: {
    // 破城矛弹夹：击倒敌人后获得 2 费用
    [BPIPE_MODULE]: {
      install: ({ battle, unit }) => bindTrigger(battle, unit, { event: 'kill', subject: 'self' }, { key: 'bpipe-module-kill' },
        ({ cause }) => effects(battle, unit, { index: `module:${BPIPE_MODULE}` }, cause).dp(BPIPE_MODULE_DP)),
      run: () => {},
    },
  },
});

// ------------------------------------------------------------------ 调香师 ---
// 熏衣香 regenerates your whole team, more for every cast of your other operators this battle; each of their 再部署
// heals the ones around them.

const FLOWER_ASPD = -50, FLOWER_ATK = 250, FLOWER_REDEPLOY_HEAL = 60, FLOWER_STACK = 4, FLOWER_COUNTER = 'flower-lavender';
const FLOWER_MODULE = 'uniequip_002_flower', FLOWER_MODULE_TARGETS = 4;

const flower = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'tuning', mods: { aspd: FLOWER_ASPD, atkPct: FLOWER_ATK / 100 },
      duration: cardParam(unit, 1, 'c') });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const x of yourOps(battle, unit)) fx.heal(x, { scale: p('a') / 100 }); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => liveAura(battle, unit, 'lavender', { select: () => true,
        mods: () => ({ hpRegen: unit.s.atk * p('b') / 100 * (1 + counterValue(battle, unit, FLOWER_COUNTER) / 100) }) }),
      run: ({ battle, unit, actor, fx }) => { for (const x of yourOps(battle, unit).filter((x) => around8(actor, x))) fx.heal(x, { scale: FLOWER_REDEPLOY_HEAL / 100 }); },
    },
    3: ({ unit, fx }) => fx.counter(unit, { key: FLOWER_COUNTER, label: '熏衣香治疗量', amount: FLOWER_STACK, suffix: '%' }),
  },
  modules: {
    // “爱琴之吻”：普通治疗同时恢复 4 名干员
    [FLOWER_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'kiss', mods: { maxTargets: FLOWER_MODULE_TARGETS - (unit.profile?.heal?.count ?? 3) }, persist: true }),
  },
});

// -------------------------------------------------------------------- 清流 ---
// Every heal of hers gives 抵抗 and charges the healed operator (each at most once in 6 s); other operators' casts make
// 治愈水波 heal more for the battle.

const FINLPP_RESIST = 4, FINLPP_CHARGE = 1, FINLPP_CHARGE_COOLDOWN = 6, FINLPP_STACK = 5, FINLPP_COUNTER = 'finlpp-wave';
const FINLPP_MODULE = 'uniequip_002_finlpp', FINLPP_MODULE_HEAL = 20;

const finlpp = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => injured(rangeAllies(battle, unit)).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const bonus = counterValue(battle, unit, FINLPP_COUNTER) + (moduleOf(unit) === FINLPP_MODULE ? FINLPP_MODULE_HEAL : 0);
    for (const x of rangeAllies(battle, unit)) fx.heal(x, { scale: cardParam(unit, 1, 'a') / 100 * (1 + bonus / 100) });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const x of rangeAllies(battle, unit)) fx.status(x, { status: 'resist', duration: FINLPP_RESIST }); },
    1: 'cast',
    2: {
      // 「每名干员每 6 秒最多一次」 is per healed operator (the card's limit keyed on the healer would be one cooldown for all)
      options: { limit: null },
      run: ({ battle, unit, target, fx }) => {
        if (!active(target)) return;
        fx.status(target, { status: 'resist', duration: FINLPP_RESIST });
        if (target === unit || target.kind !== 'op') return;
        const last = (unit.mem.finlppCharged ??= new Map()).get(uid(target));
        if (last != null && battle.time + 1e-9 < last + FINLPP_CHARGE_COOLDOWN) return;
        unit.mem.finlppCharged.set(uid(target), battle.time);
        fx.charge(target, FINLPP_CHARGE);
      },
    },
    3: ({ unit, fx }) => fx.counter(unit, { key: FINLPP_COUNTER, label: '治愈水波治疗量', amount: FINLPP_STACK, suffix: '%' }),
  },
  modules: {
    // “江河之韵”：技能治疗效果 +20% — read by the cast
    [FINLPP_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 白面鸮 ---
// 技力光环 speeds your other operators' SP up (the strongest such aura holds), more for every 再部署 of theirs this battle.

const PLOSIS_RANGE = 1, PLOSIS_STACK = 0.02, PLOSIS_COUNTER = 'plosis-aura', PLOSIS_MODULE = 'uniequip_002_plosis', PLOSIS_MODULE_EXTRA = 0.05;

const plosis = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'enkephalin',
      mods: { rangeExtend: PLOSIS_RANGE, batPct: batOf(unit, nativeValue(unit, 'base_attack_time')) }, duration: cardParam(unit, 1, 'c') });
    return true;
  },
  lines: {
    0: ({ p, fx }) => { for (const x of fx.allies('otherAllies')) fx.charge(x, p('a')); },
    1: 'cast',
    2: ({ battle, unit, p }) => liveAura(battle, unit, 'sp-aura', { highest: 'sp-aura', select: (x) => x !== unit, mods: (x) => ({
      spRecoveryFlat: p('b') + counterValue(battle, unit, PLOSIS_COUNTER) + (moduleOf(unit) === PLOSIS_MODULE && inRange(unit, x) ? PLOSIS_MODULE_EXTRA : 0) }) }),
    3: ({ unit, fx }) => fx.counter(unit, { key: PLOSIS_COUNTER, label: '技力光环', amount: PLOSIS_STACK, suffix: '/秒' }),
  },
  modules: {
    // 医疗环境分析装置：攻击范围扩大（范围内的其他干员光环 +0.05/秒 in line 2）
    [PLOSIS_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'analysis', mods: { rangeExtend: PLOSIS_RANGE }, persist: true }),
  },
});

// -------------------------------------------------------------------- 瑰盐 ---
// Her range takes more healing (more for every cast of your other 伊比利亚 this battle); other healers' heals charge her.

const ROSESA_HEAL_TAKEN = 17, ROSESA_DEPLOY_SECONDS = 10, ROSESA_ATK_DOWN = 5, ROSESA_CHARGE = 1, ROSESA_STACK = 3, ROSESA_COUNTER = 'rosesa-herb';
const ROSESA_MODULE = 'uniequip_002_rosesa', ROSESA_MODULE_HEAL_TAKEN = 22, ROSESA_MODULE_RANGE = 1;

const rosesa = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => injured(rangeAllies(battle, unit)).length > 0,
  cast: ({ battle, unit, cause }) => {
    const [target] = lowestHp(injured(rangeAllies(battle, unit)));
    if (!target) return false;
    effects(battle, unit, { index: 'skill' }, cause).heal(target, { scale: cardParam(unit, 1, 'a') / 100 });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const x of rangeAllies(battle, unit, { ops: true })) fx.buff(x, { key: 'herb-deploy', mods: { healingTakenMul: 1 + ROSESA_HEAL_TAKEN / 100 }, duration: ROSESA_DEPLOY_SECONDS }); },
    1: 'cast',
    2: {
      install: ({ battle, unit, fx }) => {
        deployEffect(battle, unit, { key: 'rosesa-herbalist', arm: () => fx.buff(unit, { key: 'herbalist-atk', mods: { atkPct: -ROSESA_ATK_DOWN / 100 }, persist: true }) });
        liveAura(battle, unit, 'herbalist', { select: (x) => inRange(unit, x), mods: () => ({ healingTakenMul: 1
          + ((moduleOf(unit) === ROSESA_MODULE ? ROSESA_MODULE_HEAL_TAKEN : ROSESA_HEAL_TAKEN) + counterValue(battle, unit, ROSESA_COUNTER)) / 100 }) });
      },
      run: ({ unit, fx }) => fx.charge(unit, ROSESA_CHARGE),
    },
    3: ({ unit, fx }) => fx.counter(unit, { key: ROSESA_COUNTER, label: '受到治疗效果提升', amount: ROSESA_STACK, suffix: '%' }),
  },
  modules: {
    // 多彩盐漠生活：攻击范围扩大（22% in line 2）
    [ROSESA_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'salt', mods: { rangeExtend: ROSESA_MODULE_RANGE }, persist: true }),
  },
});

// -------------------------------------------------------------------- 赫默 ---
// Her medical drone (a summon) heals the ones around it; every summon of your other operators speeds your 医疗 up.

const SILENT_DRONE = 'token_10000_silent_healrb', SILENT_DEPLOY_DRONE = 10, SILENT_DRONE_TICK = 1;
const SILENT_BOOST_SECONDS = 8, SILENT_STACK = 2, SILENT_COUNTER = 'silent-injection';
const SILENT_MODULE = 'uniequip_002_silent', SILENT_MODULE_GROUND = 15, SILENT_MODULE_BLAST = 150;
const medic = (x) => matchesClass(x, { label: '医疗' });

/** The drone's kit (replaces the old one of its token in the registry): heals your units around it every second for its
 * owner's ATK × scale, leaves after its time. */
const droneKit = () => ({ skill: { kind: 'passive', onStart() {} }, install(battle, drone) {
  const owner = drone.ownerUnit;
  const { duration, scale } = owner.mem.silentDrone ?? { duration: SILENT_DEPLOY_DRONE, scale: 1 };
  drone.profile = { ...drone.profile, noAttack: true };
  battle.every(SILENT_DRONE_TICK, () => {
    if (!active(drone) || !active(owner)) return;
    for (const x of injured(aroundAllies(battle, drone))) heal(battle, drone, x, { amount: owner.s.atk * scale });
  }, { owner: drone });
  battle.after(duration, () => { if (drone.alive) battle.retreat(drone, { reason: 'expired', permanent: true }); }, { owner: drone });
  // 紧急防卫程序：无人机消失时对周围敌人造成 150% 攻击力的法术伤害
  battle.on('death', ({ unit: gone, reason }) => {
    if (gone !== drone || moduleOf(owner) !== SILENT_MODULE || !active(owner) || ['ownerRemoved', 'ownerDeath', 'assaultSummonReplacement'].includes(reason)) return;
    const fx = effects(battle, owner, { index: `module:${SILENT_MODULE}` });
    for (const e of aroundEnemies(battle, drone)) fx.damage(e, { scale: SILENT_MODULE_BLAST / 100, type: 'arts' });
  }, { owner: drone });
} });
function launchDrone(battle, unit, { duration, scale }) {
  unit.mem.silentDrone = { duration, scale };
  return grantSummon(battle, unit, { tokenId: SILENT_DRONE, ruleKey: 'synergy-drone', count: 1, stockCap: 1, fieldCap: 1, cost: 0, occupiesTile: false,
    replaceExisting: true });
}

const silent = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit }) => launchDrone(battle, unit, { duration: cardParam(unit, 1, 'a'), scale: cardParam(unit, 1, 'b') / 100 }).granted > 0,
  install: (battle, unit) => healBoost(battle, unit, 'ground', ({ target }) => (moduleOf(unit) === SILENT_MODULE && groundOp(target) ? 1 + SILENT_MODULE_GROUND / 100 : 1), { summons: true }),
  lines: {
    0: ({ battle, unit }) => launchDrone(battle, unit, { duration: SILENT_DEPLOY_DRONE, scale: cardParam(unit, 1, 'b') / 100 }),
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => liveAura(battle, unit, 'injection', { select: medic, mods: () => ({ aspd: p('d') + counterValue(battle, unit, SILENT_COUNTER) }) }),
      run: ({ battle, unit, p, fx }) => { for (const x of yourOps(battle, unit).filter(medic)) fx.buff(x, { key: 'injection-boost', mods: { aspd: p('c') }, duration: SILENT_BOOST_SECONDS }); },
    },
    3: ({ unit, fx }) => fx.counter(unit, { key: SILENT_COUNTER, label: '强化注射攻击速度', amount: SILENT_STACK }),
  },
  modules: {
    // 紧急防卫程序 — the heal hook above and the drone's exit blast
    [SILENT_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 华法琳 ---
// Kills by your other operators in her range charge her and one other operator; every 流失生命 of theirs makes her heal more
// for the battle.

const BLDSK_SECONDS = 15, BLDSK_LOSS = 3, BLDSK_ELITE = 2, BLDSK_STACK = 2, BLDSK_COUNTER = 'bldsk-heal';
const BLDSK_MODULE = 'uniequip_002_bldsk', BLDSK_MODULE_LOW = 0.5, BLDSK_MODULE_HEAL = 15;
const lowestSp = (list) => [...list].filter(chargeable).sort((a, b) => spRatio(a) - spRatio(b) || uid(a).localeCompare(uid(b)))[0] ?? null;

const bldsk = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const [partner] = rangeAllies(battle, unit, { others: true, ops: true }).sort((a, b) => b.s.atk - a.s.atk || uid(a).localeCompare(uid(b)));
    const until = battle.time + BLDSK_SECONDS;
    for (const x of [unit, partner].filter(Boolean)) {
      fx.buff(x, { key: 'plasma', mods: { atkPct: cardParam(unit, 1, 'b') / 100 }, duration: BLDSK_SECONDS });
      (unit.mem.bldskPlasma ??= new Map()).set(uid(x), { unit: x, until });
    }
    return true;
  },
  install: (battle, unit) => {
    // 不稳定血浆：每秒流失 3% 最大生命
    battle.every(1, () => {
      for (const [id, { unit: x, until }] of unit.mem.bldskPlasma ?? []) {
        if (battle.time > until + 1e-9 || !active(x)) { unit.mem.bldskPlasma.delete(id); continue; }
        effects(battle, unit, { index: 'skill' }).loseHp(x, { maxPct: BLDSK_LOSS / 100 });
      }
    }, { owner: unit });
    healBoost(battle, unit, 'sample', ({ target }) => 1 + (counterValue(battle, unit, BLDSK_COUNTER)
      + (moduleOf(unit) === BLDSK_MODULE && target.hp < target.s.maxHp * BLDSK_MODULE_LOW ? BLDSK_MODULE_HEAL : 0)) / 100);
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { const x = lowestSp(rangeAllies(battle, unit, { others: true, ops: true })); if (x) fx.charge(x, p('a')); },
    1: 'cast',
    2: {
      options: { accept: (payload, ctx) => inRange(ctx.unit, payload.target) },
      run: ({ battle, unit, target, p, fx }) => {
        const n = p('c') + (isElite(target) ? BLDSK_ELITE : 0);
        fx.charge(unit, n);
        const x = lowestSp(rangeAllies(battle, unit, { others: true, ops: true }));
        if (x) fx.charge(x, n);
      },
    },
    3: ({ unit, fx }) => fx.counter(unit, { key: BLDSK_COUNTER, label: '治疗量', amount: BLDSK_STACK, suffix: '%' }),
  },
  modules: {
    // 应急储备 — the heal hook above
    [BLDSK_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 录武官 ---
// Every cast of an operator in her range charges her, speeds her up and makes her heal more for the battle.

const RECKPR_DEPLOY_ASPD = 16, RECKPR_DEPLOY_SECONDS = 10, RECKPR_EXTRA = 1, RECKPR_ASPD = 16, RECKPR_COUNTER = 'reckpr-heal';
const RECKPR_MODULE = 'uniequip_002_reckpr';

const reckpr = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => injured(rangeAllies(battle, unit)).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = lowestHp(injured(rangeAllies(battle, unit)), 1 + RECKPR_EXTRA);
    for (const x of targets) fx.heal(x, { scale: cardParam(unit, 1, 'a') / 100 });
    return targets.length > 0;
  },
  install: (battle, unit) => healBoost(battle, unit, 'learning', () => 1 + counterValue(battle, unit, RECKPR_COUNTER) / 100),
  lines: {
    0: ({ battle, unit, fx }) => { for (const x of rangeAllies(battle, unit, { ops: true })) fx.buff(x, { key: 'record', mods: { aspd: RECKPR_DEPLOY_ASPD }, duration: RECKPR_DEPLOY_SECONDS }); },
    1: 'cast',
    2: {
      options: { accept: (payload, ctx) => inRange(ctx.unit, ctx.actor) },
      run: ({ unit, p, fx }) => {
        fx.charge(unit, moduleParam(unit, RECKPR_MODULE, 'e', p('b')));
        fx.buff(unit, { key: 'learning-aspd', mods: { aspd: RECKPR_ASPD }, duration: p('c') });
      },
    },
    3: { options: { accept: (payload, ctx) => inRange(ctx.unit, ctx.actor) },
      run: ({ unit, p, fx }) => fx.counter(unit, { key: RECKPR_COUNTER, label: '治疗量', amount: p('d'), suffix: '%' }) },
  },
  modules: {
    // 未完成的录武簿：学成于聚改为充能 e — read by line 2
    [RECKPR_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 哈洛德 ---
// He clears element damage; the ones in his range with more than half a gauge take less of it; every deployment of your
// other 维多利亚 charges him; their element bursts stack his attack.

const HAROLD_DEPLOY_CLEAR = 50, HAROLD_ASPD = 100, HAROLD_HALF = 0.5, HAROLD_HEAVY = 250, HAROLD_STACK = 3;
const HAROLD_MODULE = 'uniequip_002_harold', HAROLD_MODULE_CLEAR = 60;

const harold = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'triage', mods: { aspd: HAROLD_ASPD }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  install: (battle, unit) => {
    // 重症优先：元素损伤累计超过一半的目标，回复量提升至 250%（the heal target order stays the native one: lowest HP first）
    healBoost(battle, unit, 'triage', ({ target }) => (hasBuff(unit, ':triage') && elementLoad(target) > HAROLD_HALF ? HAROLD_HEAVY / 100 : 1));
    // 腿部护理套装：治疗同时回复 60% 攻击力的元素损伤
    battle.on('heal', ({ source, target }) => {
      if (source === unit && active(unit) && moduleOf(unit) === HAROLD_MODULE && target?.side === 'ally') battle.reduceElement(target, unit.s.atk * HAROLD_MODULE_CLEAR / 100);
    }, { owner: unit });
  },
  lines: {
    0: ({ battle, unit }) => { for (const x of rangeAllies(battle, unit)) battle.reduceElement(x, unit.s.atk * HAROLD_DEPLOY_CLEAR / 100); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => liveAura(battle, unit, 'barracks', { select: (x) => inRange(unit, x),
        mods: (x) => (elementLoad(x) > HAROLD_HALF ? { elemTakenMul: 1 - p('b') / 100 } : null) }),
      run: ({ unit, p, fx }) => fx.charge(unit, p('c')),
    },
    3: ({ unit, fx }) => fx.stack(unit, { key: 'barracks', stat: 'atk', amount: HAROLD_STACK / 100, mode: 'percent' }),
  },
  modules: {
    [HAROLD_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 刺玫 ---
// She guards the sturdiest operator in her range: a shield at deployment, more healing taken (more for every shield or
// barrier your other operators gain this battle), and in her skill it draws attacks and she strikes back.

const VENDLA_ATK = 80, VENDLA_COUNTER_SCALE = 50, VENDLA_STACK = 2, VENDLA_COUNTER = 'vendla-soil';
const VENDLA_MODULE = 'uniequip_002_vendla', VENDLA_MODULE_HEAL = 60;
const sturdiest = (battle, unit) => rangeAllies(battle, unit, { ops: true }).sort((a, b) => b.s.maxHp - a.s.maxHp || uid(a).localeCompare(uid(b)))[0] ?? null;

const vendla = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const duration = cardParam(unit, 1, 'b');
    fx.sustain(unit, { key: 'thorns', mods: { atkPct: VENDLA_ATK / 100 }, duration });
    const guarded = sturdiest(battle, unit);
    if (guarded) fx.sustain(guarded, { key: 'thorns-taunt', mods: { taunt: 1 }, duration });
    unit.mem.vendlaGuarded = guarded;
    return true;
  },
  install: (battle, unit) => {
    // 荆藤庇荫：它受到攻击时，此干员对攻击者造成 50% 攻击力的法术伤害并治疗它
    bindTrigger(battle, unit, { event: 'damageTaken', subject: 'otherAllies' }, { key: 'vendla-thorns',
      accept: (payload, ctx) => ctx.actor === unit.mem.vendlaGuarded && hasBuff(ctx.actor, ':thorns-taunt') && payload.source?.side === 'enemy' && payload.sourceClass === 'attack' },
    ({ payload, actor, cause }) => {
      const fx = effects(battle, unit, { index: 'skill' }, cause);
      if (payload.source.alive) fx.damage(payload.source, { scale: VENDLA_COUNTER_SCALE / 100, type: 'arts', isSkill: true });
      fx.heal(actor, { scale: VENDLA_COUNTER_SCALE / 100 });
    });
    // 碎片：攻击敌人时为攻击范围内 1 名干员治疗 60% 伤害的生命
    spellHeal(battle, unit, VENDLA_MODULE, VENDLA_MODULE_HEAL);
  },
  lines: {
    0: ({ battle, unit, p }) => {
      const x = sturdiest(battle, unit);
      if (x) battle.addBuff(x, { key: `assault:vendla:shield:${uid(unit)}`, shield: x.s.maxHp * p('a') / 100, duration: Infinity, refresh: 'replace', source: unit, visible: true });
    },
    1: 'cast',
    2: ({ battle, unit, p }) => liveAura(battle, unit, 'soil', { select: (x) => x === sturdiest(battle, unit),
      mods: () => ({ healingTakenMul: 1 + (p('c') + counterValue(battle, unit, VENDLA_COUNTER)) / 100 }) }),
    3: ({ unit, fx }) => fx.counter(unit, { key: VENDLA_COUNTER, label: '土壤基肥改良', amount: VENDLA_STACK, suffix: '%' }),
  },
  modules: {
    [VENDLA_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 莎草 ---
// Every heal of hers leaves a barrier (stronger for every cast of your 萨尔贡 this battle); barriers and shields breaking on
// your other operators charge her.

const PAPYRS_DEPLOY_BARRIER = 22, PAPYRS_SECONDS = 8, PAPYRS_SKILL_BARRIER = 2, PAPYRS_CHARGE = 1, PAPYRS_STACK = 2, PAPYRS_COUNTER = 'papyrs-scroll';
const PAPYRS_MODULE = 'uniequip_002_papyrs', PAPYRS_MODULE_JUMPS = 3, PAPYRS_MODULE_FALLOFF = 15;
const barrierKey = (unit) => `assault:papyrs:barrier:${uid(unit)}`;
function papyrsBarrier(battle, unit, target, scale) {
  battle.addBuff(target, { key: barrierKey(unit), shield: unit.s.atk * scale, duration: PAPYRS_SECONDS, refresh: 'replace', source: unit, visible: true });
}

const papyrs = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => injured(rangeAllies(battle, unit)).length > 0,
  cast: ({ battle, unit, cause }) => {
    const [target] = lowestHp(injured(rangeAllies(battle, unit)));
    if (!target) return false;
    unit.mem.papyrsSkill = true; // 博览古卷附加的屏障提升至 200%
    try { effects(battle, unit, { index: 'skill' }, cause).heal(target, { scale: cardParam(unit, 1, 'a') / 100 }); } finally { unit.mem.papyrsSkill = false; }
    return true;
  },
  lines: {
    0: ({ battle, unit }) => { for (const x of rangeAllies(battle, unit, { ops: true })) battle.addBuff(x, { key: `assault:papyrs:deploy:${uid(unit)}`,
      shield: unit.s.atk * PAPYRS_DEPLOY_BARRIER / 100, duration: PAPYRS_SECONDS, refresh: 'replace', source: unit, visible: true }); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => battle.on('heal', ({ source, target }) => {
        if (source !== unit || !active(unit) || target?.side !== 'ally' || !target.alive) return;
        papyrsBarrier(battle, unit, target, (p('b') + counterValue(battle, unit, PAPYRS_COUNTER)) / 100 * (unit.mem.papyrsSkill ? PAPYRS_SKILL_BARRIER : 1));
      }, { owner: unit }),
      run: () => {},
    },
    3: ({ unit, fx }) => fx.charge(unit, PAPYRS_CHARGE),
    4: ({ unit, fx }) => fx.counter(unit, { key: PAPYRS_COUNTER, label: '博览古卷屏障', amount: PAPYRS_STACK, suffix: '%' }),
  },
  modules: {
    // 小小的种子：治疗会在 3 名干员间跳跃，每次跳跃治疗量 -15%
    [PAPYRS_MODULE]: ({ unit }) => {
      unit.profile = { ...unit.profile, heal: { ...unit.profile.heal, mode: 'chain', count: PAPYRS_MODULE_JUMPS, falloff: PAPYRS_MODULE_FALLOFF / 100 } };
    },
  },
});

// -------------------------------------------------------------------- 风絮 ---
// 扶风起 lifts her off (原作起飞: blocks flyers, ground enemies cannot reach her); flying operators in her range are guarded;
// your other operators' air blocks charge her and their lifts stack her attack.

const TARAXA_DEPLOY_TARGETS = 2, TARAXA_DEPLOY_HEAL = 100, TARAXA_ATK = 120, TARAXA_EXTRA = 1, TARAXA_SPLASH = 2, TARAXA_SPLASH_HEAL = 50;
const TARAXA_BLOCK = 1, TARAXA_CHARGE = 2, TARAXA_STACK = 3;
const flying = (x) => !!x?.s?.flags?.liftoff;

const taraxa = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'wind', mods: { atkPct: TARAXA_ATK / 100, maxTargets: TARAXA_EXTRA },
      flags: { liftoff: true }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  install: (battle, unit) => battle.on('heal', ({ source, target, opts }) => {
    // 扶风起：治疗目标时对其周围 2 名干员造成 50% 攻击力的治疗
    if (source !== unit || !active(unit) || !hasBuff(unit, ':wind') || opts?.taraxaSplash || target?.side !== 'ally') return;
    for (const x of lowestHp(injured(aroundAllies(battle, target).filter((x) => x !== target)), TARAXA_SPLASH)) {
      battle.heal(unit, x, unit.s.atk * TARAXA_SPLASH_HEAL / 100, { taraxaSplash: true });
    }
  }, { owner: unit }),
  lines: {
    0: ({ battle, unit, fx }) => { for (const x of lowestHp(injured(rangeAllies(battle, unit)), TARAXA_DEPLOY_TARGETS)) fx.heal(x, { scale: TARAXA_DEPLOY_HEAL / 100 }); },
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit, p }) => liveAura(battle, unit, 'calm-wind', { select: (x) => flying(x) && inRange(unit, x),
        mods: () => ({ dmgTakenMul: 1 - p('b') / 100, blockCnt: TARAXA_BLOCK }) }),
      run: ({ unit, fx }) => fx.charge(unit, TARAXA_CHARGE),
    },
    4: ({ unit, fx }) => fx.stack(unit, { key: 'calm-wind', stat: 'atk', amount: TARAXA_STACK / 100, mode: 'percent' }),
  },
});

// -------------------------------------------------------------------- 流明 ---
// He cures: every heal gives 抵抗, every status an enemy puts on an operator in his range is answered with a heal, and every
// cast of your other 伊比利亚 makes him heal more for the battle.

const LUMEN_DEPLOY_HEAL = 80, LUMEN_RESIST = 4, LUMEN_RESIST_HIGH = 6, LUMEN_HIGH = 0.75, LUMEN_STACK = 3, LUMEN_COUNTER = 'lumen-luck';
const LUMEN_MODULE = 'uniequip_002_lumen', LUMEN_MODULE_CHARGE = 2, LUMEN_MODULE_TIMES = 5;
const abnormal = (x) => (x.buffs ?? []).some((b) => ABNORMAL.has(b.status));

const lumen = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeAllies(battle, unit).some((x) => x.hp < x.s.maxHp - 1e-6 || abnormal(x)),
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = [...rangeAllies(battle, unit)].sort((a, b) => Number(abnormal(b)) - Number(abnormal(a)) || a.hp / a.s.maxHp - b.hp / b.s.maxHp
      || uid(a).localeCompare(uid(b))).slice(0, cardParam(unit, 1, 'c'));
    unit.mem.lumenCleansed = [];
    for (const x of targets) {
      const n = cleanse(battle, x);
      if (n) unit.mem.lumenCleansed.push([x, n]);
      fx.heal(x, { scale: cardParam(unit, 1, 'a') / 100 });
    }
    return targets.length > 0;
  },
  install: (battle, unit) => {
    healBoost(battle, unit, 'luck', () => 1 + counterValue(battle, unit, LUMEN_COUNTER) / 100);
    // 凡人之愿：治疗的目标获得 4 秒抵抗；目标生命高于 75% 时改为 6 秒
    battle.on('heal', ({ source, target }) => {
      if (source !== unit || !active(unit) || target?.side !== 'ally' || !target.alive) return;
      effects(battle, unit, { index: 2 }).status(target, { status: 'resist', duration: target.hp > target.s.maxHp * LUMEN_HIGH ? LUMEN_RESIST_HIGH : LUMEN_RESIST });
    }, { owner: unit });
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const x of rangeAllies(battle, unit)) { cleanse(battle, x); fx.heal(x, { scale: LUMEN_DEPLOY_HEAL / 100 }); } },
    1: 'cast',
    2: () => {},
    3: { options: { accept: (payload, ctx) => inRange(ctx.unit, payload.target) }, run: ({ target, p, fx }) => fx.heal(target, { scale: p('b') / 100 }) },
    4: ({ unit, fx }) => fx.counter(unit, { key: LUMEN_COUNTER, label: '治疗量', amount: LUMEN_STACK, suffix: '%' }),
  },
  modules: {
    // 纯铜单筒望远镜：技能每解除 1 个异常状态，为被解除的干员充能 2（每场战斗前 5 次 — counted per removed status here)
    [LUMEN_MODULE]: {
      options: { limit: null },
      run: ({ unit, fx }) => {
        for (const [x, n] of unit.mem.lumenCleansed ?? []) for (let i = 0; i < n && (unit.mem.lumenModuleCharges ?? 0) < LUMEN_MODULE_TIMES; i++) {
          unit.mem.lumenModuleCharges = (unit.mem.lumenModuleCharges ?? 0) + 1;
          fx.charge(x, LUMEN_MODULE_CHARGE);
        }
        unit.mem.lumenCleansed = [];
      },
    },
  },
});

// ------------------------------------------------------------- 纯烬艾雅法拉 ---
// She clears and soaks element damage; her normal heals keep healing; your other operators' element bursts charge her and
// raise the HP of everyone in her range for the battle.

const AGOAT2_DEPLOY_CLEAR = 100, AGOAT2_BARRIER = 900, AGOAT2_HOT = 10, AGOAT2_HOT_SECONDS = 6, AGOAT2_HOT_STACKS = 3, AGOAT2_ELEMENT_DOWN = 12;
const AGOAT2_STACK = 1, AGOAT2_COUNTER = 'agoat2-ash', AGOAT2_MODULE = 'uniequip_003_agoat2', AGOAT2_MODULE_ASPD = 8, AGOAT2_MODULE_HOT = 13, AGOAT2_MODULE_SECONDS = 8;

const agoat2 = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const until = battle.time + cardParam(unit, 1, 'b');
    unit.mem.agoat2Casting = true; // 氤氲 is for her normal heals only
    try {
      for (const x of rangeAllies(battle, unit)) {
        fx.heal(x, { scale: cardParam(unit, 1, 'a') / 100 });
        (unit.mem.agoat2Barrier ??= new Map()).set(uid(x), { left: unit.s.atk * AGOAT2_BARRIER / 100, until });
      }
    } finally { unit.mem.agoat2Casting = false; }
    return true;
  },
  install: (battle, unit) => {
    // 损伤屏障：吸收元素损伤
    battle.on('elementHit', ({ target, dmg }) => {
      const pool = unit.mem.agoat2Barrier?.get(uid(target));
      if (!pool || battle.time > pool.until || !(pool.left > 0) || target.side !== 'ally') return;
      const take = Math.min(pool.left, dmg.amount);
      pool.left -= take;
      dmg.amount -= take;
      if (!(dmg.amount > 1e-9)) dmg.cancel = true;
    }, { owner: unit });
    // 氤氲：普通治疗使目标每秒额外受到 10% 治疗量的治疗与元素损伤回复，持续 6 秒（最多 3 层；模组 13%、8 秒）
    battle.on('heal', ({ source, target, amount, opts }) => {
      if (source !== unit || !active(unit) || opts?.agoat2Mist || target?.side !== 'ally' || !(amount > 0) || unit.mem.agoat2Casting) return;
      const module = moduleOf(unit) === AGOAT2_MODULE;
      const layers = (unit.mem.agoat2Mist ??= new Map()).get(uid(target)) ?? [];
      layers.push({ per: amount * (module ? AGOAT2_MODULE_HOT : AGOAT2_HOT) / 100, until: battle.time + (module ? AGOAT2_MODULE_SECONDS : AGOAT2_HOT_SECONDS), target });
      unit.mem.agoat2Mist.set(uid(target), layers.slice(-AGOAT2_HOT_STACKS));
    }, { owner: unit });
    battle.every(1, () => {
      for (const [id, layers] of unit.mem.agoat2Mist ?? []) {
        const live = layers.filter((l) => battle.time <= l.until + 1e-9 && active(l.target));
        unit.mem.agoat2Mist.set(id, live);
        for (const l of live) { battle.heal(unit, l.target, l.per, { agoat2Mist: true }); battle.reduceElement(l.target, l.per); }
      }
    }, { owner: unit });
    // 想要留下的生命：攻击范围内有受到元素损伤的干员时，攻击速度 +8
    liveAura(battle, unit, 'stay', { select: (x) => x === unit,
      mods: () => (moduleOf(unit) === AGOAT2_MODULE && rangeAllies(battle, unit).some((x) => elementLoad(x) > 0) ? { aspd: AGOAT2_MODULE_ASPD } : null) });
  },
  lines: {
    0: ({ battle, unit }) => { for (const x of rangeAllies(battle, unit)) battle.reduceElement(x, unit.s.atk * AGOAT2_DEPLOY_CLEAR / 100); },
    1: 'cast',
    2: () => {},
    3: {
      install: ({ battle, unit, p }) => liveAura(battle, unit, 'ash', { select: (x) => inRange(unit, x),
        mods: () => ({ hpPct: (p('d') + counterValue(battle, unit, AGOAT2_COUNTER)) / 100, elemTakenMul: 1 - AGOAT2_ELEMENT_DOWN / 100 }) }),
      run: ({ unit, p, fx }) => fx.charge(unit, p('c')),
    },
    4: ({ unit, fx }) => fx.counter(unit, { key: AGOAT2_COUNTER, label: '火山灰疗愈生命上限加成', amount: AGOAT2_STACK, suffix: '%' }),
  },
  modules: {
    [AGOAT2_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 焰影苇草 ---
// Her fireballs ride two ground operators, burn what is near them and heal them; your other operators' 灼燃 bursts make the
// fireballs hit harder for the battle.

const REED2_SCAR_ATK = 22, REED2_SCAR_ARTS = 32, REED2_SCAR_SECONDS = 6, REED2_CARRIERS = 2, REED2_ORB_SECONDS = 20, REED2_ORB_TICK = 1.5;
const REED2_ORB_BURN = 20, REED2_SCAR_CHANCE = 30, REED2_STACK = 4, REED2_COUNTER = 'reed2-orb', REED2_MODULE = 'uniequip_002_reed2', REED2_MODULE_HEAL = 60;
function burnScar(battle, unit, e, { atk, arts }, cause) {
  effects(battle, unit, { index: 2 }, cause).buff(e, { key: 'scar', mods: { atkPct: -atk / 100, artsTakenMul: 1 + arts / 100 }, duration: REED2_SCAR_SECONDS });
}

const reed2Carriers = (battle, unit) => rangeAllies(battle, unit, { ops: true }).filter(groundOp);

const reed2 = (bb, raw, def) => synergyKit(def, {
  // the fireballs strike enemies near their carriers: no cast while none is near any operator in her range
  canCast: ({ battle, unit }) => rangeAllies(battle, unit, { ops: true }).some((x) => aroundEnemies(battle, x, 1).length > 0),
  cast: ({ battle, unit }) => {
    const carriers = reed2Carriers(battle, unit)
      .sort((a, b) => aroundEnemies(battle, b).length - aroundEnemies(battle, a).length || uid(a).localeCompare(uid(b))).slice(0, REED2_CARRIERS);
    const fallback = carriers.length ? carriers : rangeAllies(battle, unit, { ops: true }).slice(0, REED2_CARRIERS);
    unit.mem.reed2Orbs = [...(unit.mem.reed2Orbs??[]).filter(group=>group.until>battle.time&&active(group.x)),...fallback.map((x) => ({ x, until: battle.time + REED2_ORB_SECONDS }))];
    return fallback.length > 0;
  },
  install: (battle, unit) => {
    battle.every(REED2_ORB_TICK, () => {
      if (!active(unit)) return;
      const fx = effects(battle, unit, { index: 'skill' });
      unit.mem.reed2Orbs=(unit.mem.reed2Orbs??[]).filter(group=>group.until+1e-9>=battle.time&&active(group.x));
      for (const { x, until } of unit.mem.reed2Orbs ?? []) {
        if (battle.time > until + 1e-9 || !active(x)) continue;
        const [e] = aroundEnemies(battle, x, 1);
        if (!e) continue;
        const dealt = fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100 * (1 + counterValue(battle, unit, REED2_COUNTER) / 100), type: 'arts', isSkill: true });
        if (e.alive) fx.elementDamage(e, { element: 'burn', amount: unit.s.atk * REED2_ORB_BURN / 100 });
        if (dealt > 0) fx.heal(x, { amount: dealt });
      }
    }, { owner: unit });
    // 映耀：治疗其他干员时，此干员同时享受 d% 治疗量
    battle.on('heal', ({ source, target, amount, opts }) => {
      if (source !== unit || !active(unit) || target === unit || target?.side !== 'ally' || opts?.reedShare || !(amount > 0)) return;
      battle.heal(unit, unit, amount * cardParam(unit, 3, 'd') / 100, { reedShare: true, self: true });
    }, { owner: unit });
    spellHeal(battle, unit, REED2_MODULE, REED2_MODULE_HEAL);
  },
  lines: {
    0: ({ battle, unit, cause }) => { const [e] = rangeEnemies(battle, unit, 1); if (e) burnScar(battle, unit, e, { atk: REED2_SCAR_ATK, arts: REED2_SCAR_ARTS }, cause); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => battle.on('damaged', ({ source, target, amount, dmg }) => {
        if (source !== unit || !active(unit) || target?.side !== 'enemy' || !target.alive || !(amount > 0) || dmg?.type === 'element') return;
        if (battle.rng() < REED2_SCAR_CHANCE / 100) burnScar(battle, unit, target, { atk: p('b'), arts: p('c') });
      }, { owner: unit }),
      run: () => {},
    },
    3: () => {},
    4: ({ unit, fx }) => fx.counter(unit, { key: REED2_COUNTER, label: '火球伤害', amount: REED2_STACK, suffix: '%' }),
  },
  modules: {
    [REED2_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 缇缇 ---
// She attacks the sleeping; enemies your other operators bound, stunned, froze or slowed take more from her; their sleeps
// charge her; in 旧日绽放 every waking or sleeping death spreads the sleep.

const TITI_DEPLOY_SLEEP = 3, TITI_ATK = 180, TITI_TARGETS = 1, TITI_SLEEP = 5, TITI_STACK = 2;
const TITI_CONTROLS = ['bind', 'stun', 'freeze', 'sluggish'], TITI_MODULE = 'uniequip_002_titi', TITI_MODULE_HEAL = 60;
const asleep = (e) => (e?.buffs ?? []).some((b) => b.status === 'sleep' && b.timeLeft > 0);

const titi = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => battle.enemiesInKeys(unit.rangeKeys, unit, { ...unit.profile, hitSleep: true }).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'bloom', mods: { atkPct: TITI_ATK / 100, maxTargets: TITI_TARGETS }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  install: (battle, unit) => {
    const bloom = () => hasBuff(unit, ':bloom');
    const spread = (e, cause) => {
      const fx = effects(battle, unit, { index: 'skill' }, cause);
      const [next] = battle.enemies.filter((x) => x !== e && x.alive && !x.removed && !asleep(x) && around8(e, x)).sort(byExit(battle));
      if (next) fx.status(next, { status: 'sleep', duration: TITI_SLEEP });
      return fx;
    };
    // 旧日绽放：攻击非沉睡目标时使其沉睡 5 秒
    battle.on('damaged', ({ source, target, dmg }) => {
      if (source !== unit || !active(unit) || !bloom() || !dmg?.isAttack || target?.side !== 'enemy' || !target.alive || asleep(target)) return;
      effects(battle, unit, { index: 'skill' }).status(target, { status: 'sleep', duration: TITI_SLEEP });
    }, { owner: unit });
    // 期间任一敌人醒来或在沉睡中被击倒时，受到 b% 法术伤害，并使周围 1 名其他敌人沉睡 5 秒
    const sleeping = new Set();
    battle.every(0.25, () => {
      for (const e of battle.enemies) {
        if (!e.alive || e.removed) { sleeping.delete(e); continue; }
        if (asleep(e)) { sleeping.add(e); continue; }
        if (!sleeping.delete(e) || !active(unit) || !bloom()) continue;
        spread(e).damage(e, { scale: cardParam(unit, 1, 'b') / 100, type: 'arts', isSkill: true });
      }
    }, { owner: unit });
    battle.on('death', ({ unit: e, reason }) => {
      if (e?.side !== 'enemy' || reason !== 'killed' || !sleeping.has(e) || !active(unit) || !bloom()) return;
      sleeping.delete(e);
      spread(e);
    }, { owner: unit });
    spellHeal(battle, unit, TITI_MODULE, TITI_MODULE_HEAL);
  },
  lines: {
    0: ({ battle, unit, fx }) => { const [e] = rangeEnemies(battle, unit, 1); if (e) fx.status(e, { status: 'sleep', duration: TITI_DEPLOY_SLEEP }); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => {
        // 可以攻击沉睡的敌人
        deployEffect(battle, unit, { key: 'titi-sleepers', arm: () => { unit.profile = { ...unit.profile, hitSleep: true }; } });
        battle.on('damaged', ({ source, target, dmg }) => {
          if (source !== unit || !active(unit) || !dmg?.isAttack || target?.side !== 'enemy' || !target.alive || !byOthers(unit, target, TITI_CONTROLS)) return;
          battle.assaultRuntime.enqueue(() => { if (target.alive) effects(battle, unit, { index: 2 }).damage(target, { scale: p('c') / 100, type: 'arts' }); }, { targetUid: uid(target) });
        }, { owner: unit });
        // 在场时沉睡中的敌人每秒受到 d% 攻击力的法术伤害
        battle.every(1, () => {
          if (!active(unit)) return;
          const fx = effects(battle, unit, { index: 2 });
          for (const e of battle.enemies) if (e.alive && !e.removed && asleep(e)) fx.damage(e, { scale: p('d') / 100, type: 'arts', ignoreSleep: true });
        }, { owner: unit });
      },
      options: { accept: () => false },
      run: () => {},
    },
    3: ({ unit, p, fx }) => fx.charge(unit, p('e')),
    4: ({ unit, fx }) => fx.stack(unit, { key: 'courage', stat: 'aspd', amount: TITI_STACK }),
  },
  modules: {
    [TITI_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ Mon3tr ---
// The reconstruction (a summon only it heals) raises the attack around it, more for every cast of your other operators;
// every heal it makes speeds the healed one up.

const MONSTR_TOKEN = 'token_10050_monstr_prosts', MONSTR_SECONDS = 10, MONSTR_STACK = 1, MONSTR_COUNTER = 'monstr-repair', MONSTR_MODULE = 'uniequip_002_monstr';
const reconstruction = (battle, unit) => battle.allyUnits.find((x) => x.kind === 'token' && x.ownerUnit === unit && x.defId === MONSTR_TOKEN && active(x)) ?? null;
// the reconstruction's own kit (replaces the old one of its token): it only stands there; Mon3tr keeps its aura and heals it
const reconstructionKit = () => ({ skill: { kind: 'passive', onStart() {} }, install(battle, token) {
  const key = 'assault:monstr:healOnlyByOwner';
  const mark = () => { if (token.alive && !token.findBuff(key)) battle.addBuff(token, { key, flags: { noHeal: true }, duration: Infinity, source: token.ownerUnit }); };
  battle.on('deploy', ({ unit }) => { if (unit === token) mark(); }, { owner: token });
  mark();
} });

const monstr = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => injured(rangeAllies(battle, unit)).length > 0,
  cast: ({ battle, unit, cause }) => {
    const [first] = lowestHp(injured(rangeAllies(battle, unit)));
    if (!first) return false;
    chainHeal(battle, unit, effects(battle, unit, { index: 'skill' }, cause), first,
      { scale: cardParam(unit, 1, 'b') / 100, count: cardParam(unit, 1, 'c'), falloff: unit.profile?.heal?.falloff ?? 0.25 });
    return true;
  },
  install: (battle, unit) => {
    unit.profile = { ...unit.profile, healThrough: (healer, x) => x === reconstruction(battle, unit) };
    liveAura(battle, unit, 'reconstruction', { select: (x) => { const r = reconstruction(battle, unit); return !!r && around8(r, x); },
      mods: () => ({ atkPct: (cardParam(unit, 0, 'a') + counterValue(battle, unit, MONSTR_COUNTER)) / 100 }) });
    // 记忆存档：重构体受到此干员治疗时，额外进行一次不衰减的治疗跳跃
    battle.on('heal', ({ source, target, amount, opts }) => {
      if (source !== unit || !active(unit) || moduleOf(unit) !== MONSTR_MODULE || opts?.monstrJump || target !== reconstruction(battle, unit)) return;
      const [next] = lowestHp(injured(rangeAllies(battle, unit).filter((x) => x !== target)));
      if (next) battle.heal(unit, next, amount, { monstrJump: true });
    }, { owner: unit });
  },
  lines: {
    0: ({ battle, unit }) => grantSummon(battle, unit, { tokenId: MONSTR_TOKEN, ruleKey: 'synergy-reconstruction', count: 1, stockCap: 1, fieldCap: 1, cost: 0 }),
    1: 'cast',
    2: ({ unit, target, p, fx }) => { if (target !== unit && target?.kind === 'op') fx.buff(target, { key: 'coordination', mods: { aspd: p('d') }, duration: MONSTR_SECONDS }); },
    3: ({ unit, fx }) => fx.counter(unit, { key: MONSTR_COUNTER, label: '重构体光环攻击力', amount: MONSTR_STACK, suffix: '%' }),
  },
  modules: {
    [MONSTR_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 塞雷娅 ---
// Every heal of hers charges the healed operator; every cast of your other operators grows her for the run.

const DEMKNI_DEPLOY_HEAL = 80, DEMKNI_CHARGE = 1, DEMKNI_MODULE = 'uniequip_002_demkni', DEMKNI_MODULE_CHARGE = 2, DEMKNI_MODULE_RHINE = 3;
const DEMKNI_MODULE_LOW = 0.5, DEMKNI_MODULE_HEAL = 15;

const demkni = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => injured(aroundAllies(battle, unit)).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    for (const x of aroundAllies(battle, unit)) fx.heal(x, { scale: cardParam(unit, 1, 'a') / 100 });
    return true;
  },
  install: (battle, unit) => healBoost(battle, unit, 'gloves', ({ target }) => (moduleOf(unit) === DEMKNI_MODULE && target.hp < target.s.maxHp * DEMKNI_MODULE_LOW
    ? 1 + DEMKNI_MODULE_HEAL / 100 : 1)),
  lines: {
    // 部署时治疗周围所有干员，被治疗的其他干员充能 1 (the 精神回复 line charges every operator she heals: this is that charge)
    0: ({ battle, unit, fx }) => { for (const x of aroundAllies(battle, unit)) fx.heal(x, { scale: DEMKNI_DEPLOY_HEAL / 100 }); },
    1: 'cast',
    2: ({ unit, target, fx }) => {
      if (target === unit || target?.kind !== 'op') return;
      const n = moduleOf(unit) !== DEMKNI_MODULE ? DEMKNI_CHARGE : matchesClass(target, { label: '莱茵生命' }) ? DEMKNI_MODULE_RHINE : DEMKNI_MODULE_CHARGE;
      fx.charge(target, n);
    },
    3: ({ unit, p, fx }) => {
      fx.growth(unit, { key: 'rhine-suit-atk', stat: 'atk', percent: p('b') / 100 });
      fx.growth(unit, { key: 'rhine-suit-def', stat: 'def', percent: p('b') / 100 });
    },
  },
  modules: {
    // 闲置的拳击手套 — read by line 2 and the heal hook
    [DEMKNI_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 角峰 ---
// Colds and freezes of your other operators charge him; every cast of your other 谢拉格 stacks his defence.

const YAK_COLD = 2, YAK_HP = 50, YAK_DEF = 30, YAK_RES = 100, YAK_TALENT_RES = 15, YAK_CHARGE = 1, YAK_STACK = 3, YAK_MODULE_BLOCK = 1;
/** 周围 4 格: enemies on the unit's tile and the four next to it. */
const around4Enemies = (battle, unit) => battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden
  && Math.abs(Math.round(e.y) - unit.tileR) + Math.abs(Math.round(e.x) - unit.tileC) <= 1).sort(byExit(battle));

const yak = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'cold-proof', mods: { hpPct: YAK_HP / 100, defPct: YAK_DEF / 100, resFlat: YAK_RES },
      duration: cardParam(unit, 1, 'a') });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const e of around4Enemies(battle, unit)) fx.status(e, { status: 'cold', duration: YAK_COLD }); },
    1: 'cast',
    2: {
      install: ({ battle, unit, fx }) => deployEffect(battle, unit, { key: 'yak-guard', arm: () => fx.buff(unit, { key: 'snow-guard', mods: { resFlat: YAK_TALENT_RES }, persist: true }) }),
      run: ({ unit, fx }) => fx.charge(unit, YAK_CHARGE),
    },
    3: ({ unit, fx }) => fx.stack(unit, { key: 'snow-guard', stat: 'def', amount: YAK_STACK / 100, mode: 'percent' }),
  },
  modules: {
    // 父亲的袍子：阻挡数 +1
    uniequip_002_yak: ({ unit, fx }) => fx.buff(unit, { key: 'robe', mods: { blockCnt: YAK_MODULE_BLOCK }, persist: true }),
  },
});

// ------------------------------------------------------------------ 蛇屠箱 ---
// His blocks harden the ones next to him; every new block of your other operators hardens him for the run.

const SNAKEK_DEF = 130, SNAKEK_BLOCK = 1, SNAKEK_REGEN = 3, SNAKEK_TALENT_DEF = 12, SNAKEK_NEIGHBOUR_SECONDS = 5;
const SNAKEK_MODULE = 'uniequip_002_snakek', SNAKEK_MODULE_DEF = 20;
const blocking = (unit) => (unit.blocking ?? []).some((e) => e.alive);

const snakek = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'shell', mods: { blockCnt: SNAKEK_BLOCK, defPct: SNAKEK_DEF / 100,
      hpRegenRatio: SNAKEK_REGEN / 100 }, flags: { disarm: true }, duration: cardParam(unit, 1, 'd') });
    return true;
  },
  install: (battle, unit) => liveAura(battle, unit, 'baseball', { select: (x) => x === unit,
    mods: () => (moduleOf(unit) === SNAKEK_MODULE && blocking(unit) ? { defPct: SNAKEK_MODULE_DEF / 100 } : null) }),
  lines: {
    0: ({ battle, unit, p }) => battle.addBuff(unit, { key: `assault:snakek:shield:${uid(unit)}`, shield: unit.s.maxHp * p('a') / 100,
      duration: Infinity, refresh: 'replace', source: unit, visible: true }),
    1: 'cast',
    2: {
      install: ({ battle, unit, fx }) => deployEffect(battle, unit, { key: 'snakek-guard', arm: () => fx.buff(unit, { key: 'guard', mods: { defPct: SNAKEK_TALENT_DEF / 100 }, persist: true }) }),
      run: ({ p, fx }) => { for (const x of fx.allies('adjacentAllies')) fx.buff(x, { key: 'guard-neighbour', mods: { defPct: p('b') / 100 }, duration: SNAKEK_NEIGHBOUR_SECONDS }); },
    },
    3: ({ unit, p, fx }) => fx.growth(unit, { key: 'guard', stat: 'def', percent: p('c') / 100 }),
  },
  modules: {
    [SNAKEK_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 泡泡 ---
// Enemies that hit her are weakened and tremble; every tremble of your other operators stacks her defence.

const BUBBLE_TAUNT = 5, BUBBLE_DEF = 120, BUBBLE_THORNS = 50, BUBBLE_SPIKE_ATK = 8, BUBBLE_SPIKE_TREMBLE = 2, BUBBLE_SPIKE_SECONDS = 5;
const BUBBLE_MODULE = 'uniequip_002_bubble', BUBBLE_MODULE_DEF = 20, BUBBLE_MODULE_SPIKE = 12;

const bubble = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'beaten', mods: { defPct: BUBBLE_DEF / 100, taunt: 1 }, flags: { disarm: true },
      duration: cardParam(unit, 1, 'b') });
    return true;
  },
  install: (battle, unit) => {
    // “挨打”：每次受到攻击对攻击者造成 50% 防御力的物理伤害
    bindTrigger(battle, unit, { event: 'damageTaken', subject: 'self' }, { key: 'bubble-thorns',
      accept: (payload) => hasBuff(unit, ':beaten') && payload.source?.side === 'enemy' && payload.sourceClass === 'attack' },
    ({ payload, cause }) => { if (payload.source.alive) effects(battle, unit, { index: 'skill' }, cause).damage(payload.source, { amount: unit.s.def * BUBBLE_THORNS / 100, type: 'phys', isSkill: true }); });
    liveAura(battle, unit, 'flash', { select: (x) => x === unit,
      mods: () => (moduleOf(unit) === BUBBLE_MODULE && blocking(unit) ? { defPct: BUBBLE_MODULE_DEF / 100 } : null) });
  },
  lines: {
    0: ({ unit, fx }) => fx.buff(unit, { key: 'come-on', mods: { taunt: 1 }, duration: BUBBLE_TAUNT }),
    1: 'cast',
    2: {
      options: { accept: (payload) => payload.source?.side === 'enemy' && payload.sourceClass === 'attack' },
      run: ({ unit, payload, fx }) => {
        const e = payload.source;
        if (!e.alive) return;
        fx.buff(e, { key: 'spiked', mods: { atkPct: -(moduleOf(unit) === BUBBLE_MODULE ? BUBBLE_MODULE_SPIKE : BUBBLE_SPIKE_ATK) / 100 }, duration: BUBBLE_SPIKE_SECONDS });
        fx.status(e, { status: 'tremble', duration: BUBBLE_SPIKE_TREMBLE });
      },
    },
    3: ({ unit, p, fx }) => fx.stack(unit, { key: 'spike', stat: 'def', amount: p('a') / 100, mode: 'percent' }),
  },
  modules: {
    [BUBBLE_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 古米 ---
// Her heals harden the healed; her pan stuns; every stun of your other operators grows her attack for the run.

const SUNBR_DEPLOY_TARGETS = 2, SUNBR_DEPLOY_HEAL = 100, SUNBR_DEF_SECONDS = 5, SUNBR_PAN_CHANCE = 18, SUNBR_PAN_ATK = 200, SUNBR_PAN_STUN = 1;
const SUNBR_MODULE = 'uniequip_002_sunbr', SUNBR_MODULE_LOW = 0.5, SUNBR_MODULE_HEAL = 15;

const sunbr = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => injured(aroundAllies(battle, unit)).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = lowestHp(injured(aroundAllies(battle, unit)), cardParam(unit, 1, 'd'));
    for (const x of targets) fx.heal(x, { scale: cardParam(unit, 1, 'a') / 100 });
    return targets.length > 0;
  },
  install: (battle, unit) => healBoost(battle, unit, 'pie', ({ target }) => (moduleOf(unit) === SUNBR_MODULE && target.hp < target.s.maxHp * SUNBR_MODULE_LOW
    ? 1 + SUNBR_MODULE_HEAL / 100 : 1)),
  lines: {
    0: ({ battle, unit, fx }) => { for (const x of lowestHp(injured(yourOps(battle, unit)), SUNBR_DEPLOY_TARGETS)) fx.heal(x, { scale: SUNBR_DEPLOY_HEAL / 100 }); },
    1: 'cast',
    2: ({ unit, target, p, fx }) => { if (target !== unit && target?.kind === 'op') fx.buff(target, { key: 'ration', mods: { defPct: p('b') / 100 }, duration: SUNBR_DEF_SECONDS }); },
    3: {
      install: ({ battle, unit, fx }) => battle.on('hit', ({ source, target, dmg }) => {
        if (!ownAttack(unit, source, target, dmg) || !(battle.rng() < SUNBR_PAN_CHANCE / 100)) return;
        dmg.amount *= SUNBR_PAN_ATK / 100;
        battle.assaultRuntime.enqueue(() => { if (target.alive) fx.status(target, { status: 'stun', duration: SUNBR_PAN_STUN }); }, { targetUid: uid(target) });
      }, { owner: unit, priority: 90 }),
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'pan', stat: 'atk', percent: p('c') / 100 }),
  },
  modules: {
    [SUNBR_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 雷蛇 ---
// Every hit she takes charges her and one operator next to her; every cast of the operators around her stacks her guard.

const LISKAM_DEF_SECONDS = 8, LISKAM_CHARGE = 1, LISKAM_STACK_DEF = 3, LISKAM_STACK_RES = 1;
const LISKAM_MODULE = 'uniequip_002_liskam', LISKAM_MODULE_CHANCE = 60, LISKAM_MODULE_CHARGE = 1;
const blockNext = (battle, unit) => {const key=`assault:liskam:block:${uid(unit)}`;return battle.addBuff(unit, { key, shieldHits: 1+(unit.buffs.find(b=>b.key===key)?.shieldHits??0), duration: Infinity, refresh: 'replace', source: unit, visible: true });};

const liskam = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    blockNext(battle, unit);
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'charged-defence', mods: { defPct: cardParam(unit, 1, 'a') / 100 }, duration: LISKAM_DEF_SECONDS });
    return true;
  },
  lines: {
    0: ({ battle, unit }) => blockNext(battle, unit),
    1: 'cast',
    2: ({ battle, unit, fx }) => {
      fx.charge(unit, LISKAM_CHARGE);
      if (moduleOf(unit) === LISKAM_MODULE && battle.rng() < LISKAM_MODULE_CHANCE / 100) fx.charge(unit, LISKAM_MODULE_CHARGE);
      const [x] = yourOps(battle, unit, { others: true }).filter((y) => around8(unit, y) && chargeable(y)).sort((a, b) => spRatio(a) - spRatio(b) || uid(a).localeCompare(uid(b)));
      if (x) fx.charge(x, LISKAM_CHARGE);
    },
    3: ({ unit, fx }) => {
      fx.stack(unit, { key: 'thunder', stat: 'def', amount: LISKAM_STACK_DEF / 100, mode: 'percent' });
      fx.stack(unit, { key: 'thunder', stat: 'res', amount: LISKAM_STACK_RES, mode: 'flat' });
    },
  },
  modules: {
    // 震撼存储：攻击范围内敌人隐匿失效（60% 的额外充能在 line 2）
    [LISKAM_MODULE]: ({ battle, unit }) => enemyAura(battle, unit, { key: 'liskam-reveal', flags: { reveal: true }, select: (e) => inRange(unit, e) }),
  },
});

// -------------------------------------------------------------------- 深巡 ---
// Her fins pierce the line in front; every hit leaves a nerve-poisoning wound; kills by your other 阿戈尔 stack her attack.

const UDFLOW_DEPLOY_SLUGGISH = 1, UDFLOW_RANGE = 1, UDFLOW_ATK = 50, UDFLOW_ASPD = 50, UDFLOW_PIERCE = 4, UDFLOW_SLUGGISH = 1;
const UDFLOW_DOT_SECONDS = 3, UDFLOW_NEURAL = 10, UDFLOW_SEA = 2, UDFLOW_MODULE = 'uniequip_002_udflow';
const seaMonster = (e) => (e.def?.tags ?? []).includes('seamonster');
/** The enemies on the line straight in front of the unit (its row or column ahead), nearest first. */
function frontLine(battle, unit) {
  const [dr, dc] = dirVec(unit.dir);
  return battle.enemies.filter((e) => {
    if (!e.alive || e.removed || e.hidden) return false;
    const r = Math.round(e.y) - unit.tileR, c = Math.round(e.x) - unit.tileC;
    return dr ? c === 0 && r * dr > 0 : r === 0 && c * dc > 0;
  }).sort((a, b) => (Math.abs(a.y - unit.tileR) + Math.abs(a.x - unit.tileC)) - (Math.abs(b.y - unit.tileR) + Math.abs(b.x - unit.tileC)) || uid(a).localeCompare(uid(b)));
}

const udflow = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'fins', mods: { rangeExtend: UDFLOW_RANGE, atkPct: UDFLOW_ATK / 100, aspd: UDFLOW_ASPD },
      duration: cardParam(unit, 1, 'a') });
    return true;
  },
  install: (battle, unit) => battle.on('damaged', ({ source, target, amount, dmg }) => {
    // 行动能力剥夺：鳍刺穿过 4 名敌人并停顿 1 秒
    if (source !== unit || !active(unit) || !hasBuff(unit, ':fins') || !dmg?.isAttack || dmg.tags?.includes('udflow-fin') || target?.side !== 'enemy') return;
    const fx = effects(battle, unit, { index: 'skill' });
    const line = frontLine(battle, unit).filter((e) => e !== target).slice(0, UDFLOW_PIERCE - 1);
    battle.assaultRuntime.enqueue(() => {
      for (const e of [target, ...line]) {
        if (!e.alive) continue;
        if (e !== target) battle.dealDamage(unit, e, { amount: dmg.amount, type: dmg.type, isAttack: true, tags: ['udflow-fin'] });
        if (e.alive) fx.status(e, { status: 'sluggish', duration: UDFLOW_SLUGGISH });
      }
    }, { targetUid: uid(target) });
  }, { owner: unit }),
  lines: {
    0: ({ battle, unit, fx }) => { for (const e of frontLine(battle, unit).filter((e) => inRange(unit, e))) fx.status(e, { status: 'sluggish', duration: UDFLOW_DEPLOY_SLUGGISH }); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => {
        const wounds = new Map();
        battle.on('damaged', ({ source, target, dmg }) => {
          if (source !== unit || !active(unit) || !dmg?.isAttack || target?.side !== 'enemy' || !target.alive) return;
          wounds.set(target, battle.time + UDFLOW_DOT_SECONDS);
        }, { owner: unit });
        battle.every(1, () => {
          const fx = effects(battle, unit, { index: 2 });
          for (const [e, until] of wounds) {
            if (!e.alive || battle.time > until + 1e-9) { wounds.delete(e); continue; }
            const sea = seaMonster(e) ? UDFLOW_SEA : 1;
            fx.damage(e, { amount: p('b') * sea, type: 'arts' });
            if (e.alive) fx.elementDamage(e, { element: 'neural', amount: unit.s.atk * UDFLOW_NEURAL / 100 * sea });
          }
        }, { owner: unit });
      },
      run: () => {},
    },
    3: ({ unit, p, fx }) => fx.stack(unit, { key: 'inhibitor', stat: 'atk', amount: p('c') / 100, mode: 'percent' }),
  },
  modules: {
    // 基于咖啡的神经活性剂：攻击范围内敌人隐匿失效
    [UDFLOW_MODULE]: ({ battle, unit }) => enemyAura(battle, unit, { key: 'udflow-reveal', flags: { reveal: true }, select: (e) => inRange(unit, e) }),
  },
});

// -------------------------------------------------------------------- 折桠 ---
// Hits on the operators next to her charge her; every heal your other operators give hardens her (不屈者 still refuse
// their heals); every tremble or stun of your other
// operators grows her HP for the run.

const BRANCH_DEPLOY_TREMBLE = 3, BRANCH_TREMBLE = 5, BRANCH_ATK = 150, BRANCH_DEF = 50, BRANCH_CHARGE = 0.5, BRANCH_STACK = 1;
const BRANCH_MODULE = 'uniequip_002_branch', BRANCH_MODULE_DEF = 18, BRANCH_MODULE_HEAL = 80;

const branch = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1, { ground: true }).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const duration = cardParam(unit, 1, 'a');
    for (const e of aroundEnemies(battle, unit, 99, { ground: true })) fx.status(e, { status: 'tremble', duration: BRANCH_TREMBLE });
    fx.sustain(unit, { key: 'resolve', mods: { atkPct: BRANCH_ATK / 100, defPct: (BRANCH_DEF + (moduleOf(unit) === BRANCH_MODULE ? BRANCH_MODULE_DEF : 0)) / 100,
      maxTargets: Math.max(0, Math.floor(unit.s.blockCnt) - 1) }, duration });
    // 简易包扎：技能结束时恢复 b% 最大生命 (a recast moves the end)
    unit.mem.branchEnds = battle.time + duration;
    return true;
  },
  install: (battle, unit) => {
    battle.every(0.25, () => {
      const end = unit.mem.branchEnds;
      if (end == null || battle.time + 1e-9 < end) return;
      unit.mem.branchEnds = null;
      if (!active(unit)) return;
      const ratio = moduleOf(unit) === BRANCH_MODULE ? BRANCH_MODULE_HEAL : cardParam(unit, 2, 'b');
      effects(battle, unit, { index: 2 }).heal(unit, { maxHpRatio: ratio / 100 });
    }, { owner: unit });
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const e of aroundEnemies(battle, unit, 99, { ground: true })) fx.status(e, { status: 'tremble', duration: BRANCH_DEPLOY_TREMBLE }); },
    1: 'cast',
    2: { options: { accept: (payload) => payload.source?.side === 'enemy' }, run: ({ unit, fx }) => fx.charge(unit, BRANCH_CHARGE) },
    3: ({ unit, fx }) => fx.stack(unit, { key: 'bandage', stat: 'def', amount: BRANCH_STACK / 100, mode: 'percent' }),
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'bandage', stat: 'maxHp', percent: p('c') / 100 }),
  },
  modules: {
    // “时间的痕迹” — read by the cast and the end-of-skill heal
    [BRANCH_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 灰毫 ---
// Her opening shell; every deployment of your other 卡西米尔 grows her attack for the run.

const ASHLOK_DEPLOY_SCALE = 150, ASHLOK_TALENT = 10, ASHLOK_TALENT_GROUND = 18, ASHLOK_MODULE = 'uniequip_002_ashlok', ASHLOK_MODULE_ATK = 110;

const ashlok = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'focus-fire', mods: { blockCnt: -unit.s.blockCnt,
      batPct: batOf(unit, nativeValue(unit, 'base_attack_time')), atkPct: cardParam(unit, 1, 'b') / 100 }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => {
      const [e] = rangeEnemies(battle, unit, 1);
      if (!e) return;
      for (const x of battle.enemies.filter((y) => y.alive && !y.removed && !y.hidden && around8(e, y))) fx.damage(x, { scale: ASHLOK_DEPLOY_SCALE / 100, type: 'phys' });
    },
    1: 'cast',
    // 炮术研习：攻击力 +10%，周身四格都是地面时改为 +18%
    2: ({ battle, unit, fx }) => {
      const ground = [[-1, 0], [1, 0], [0, -1], [0, 1]].every(([dr, dc]) => battle.grid.inRect(unit.tileR + dr, unit.tileC + dc)
        && battle.grid.canStand(unit.tileR + dr, unit.tileC + dc, { ranged: false }) && battle.grid.tile(unit.tileR + dr, unit.tileC + dc)?.height !== 'HIGH');
      fx.buff(unit, { key: 'gunnery', mods: { atkPct: (ground ? ASHLOK_TALENT_GROUND : ASHLOK_TALENT) / 100 }, persist: true });
    },
    3: ({ unit, p, fx }) => fx.growth(unit, { key: 'gunnery', stat: 'atk', percent: p('c') / 100 }),
  },
  modules: {
    // 出门必备套装：攻击被你的其他干员阻挡的敌人时，攻击力提升至 110%
    [ASHLOK_MODULE]: {
      install: ({ battle, unit }) => battle.on('hit', ({ source, target, dmg }) => {
        if (ownAttack(unit, source, target, dmg) && target.blockedBy && relates(unit, target.blockedBy, 'other')) dmg.amount *= ASHLOK_MODULE_ATK / 100;
      }, { owner: unit, priority: 80 }),
      options: { accept: () => false },
      run: () => {},
    },
  },
});

// -------------------------------------------------------------------- 菲莱 ---
// Her curse strikes back around her when she is hit; apoptosis bursts of your other operators charge her.

const PHILAE_BARRIER = 20, PHILAE_HP = 50, PHILAE_STRIKE = 200, PHILAE_APOPTOSIS = 25, PHILAE_STRIKE_COOLDOWN = 2, PHILAE_ELEMENT_ATK = 100;
const PHILAE_CHARGE = 2, PHILAE_MODULE = 'uniequip_002_philae', PHILAE_MODULE_ELEMENT = 15;

const philae = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1, { ground: true }).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'styx', mods: { hpPct: PHILAE_HP / 100 }, flags: { disarm: true }, duration: cardParam(unit, 1, 'a') });
    unit.mem.philaeStyxUntil = battle.time + cardParam(unit, 1, 'a');
    return true;
  },
  install: (battle, unit) => {
    const styx = () => hasBuff(unit, ':styx');
    // 冥河诅咒：受到攻击时对周围地面敌人造成 200% 法术伤害并附带 25% 凋亡损伤（每 2 秒最多一次）
    bindTrigger(battle, unit, { event: 'damageTaken', subject: 'self' }, { key: 'philae-styx', limit: { cooldown: PHILAE_STRIKE_COOLDOWN },
      accept: (payload) => styx() && payload.source?.side === 'enemy' && payload.sourceClass === 'attack' },
    ({ cause }) => {
      const fx = effects(battle, unit, { index: 'skill' }, cause);
      for (const e of aroundEnemies(battle, unit, 99, { ground: true })) {
        fx.damage(e, { scale: PHILAE_STRIKE / 100, type: 'arts', isSkill: true });
        if (e.alive) fx.elementDamage(e, { element: 'apoptosis', amount: unit.s.atk * PHILAE_APOPTOSIS / 100 });
      }
    });
    battle.on('damaged', ({ source, target, type, dmg }) => {
      if (type !== 'element' || !active(unit)) return;
      // 期间受到元素损伤则攻击力 +100%（到技能结束）
      if (target === unit && styx()) effects(battle, unit, { index: 'skill' }).buff(unit, { key: 'styx-fury', mods: { atkPct: PHILAE_ELEMENT_ATK / 100 },
        duration: Math.max(0.1, (unit.mem.philaeStyxUntil ?? battle.time) - battle.time) });
      // 神河谕使：受到凋亡损伤时充能 2
      if (target === unit && dmg?.element === 'apoptosis') effects(battle, unit, { index: 2 }).charge(unit, PHILAE_CHARGE);
    }, { owner: unit });
    // 被摩挲的日子：阻挡敌人时，自身造成的元素损伤 +15%
    battle.on('elementHit', ({ source, dmg }) => { if (source === unit && moduleOf(unit) === PHILAE_MODULE && blocking(unit)) dmg.amount *= 1 + PHILAE_MODULE_ELEMENT / 100; }, { owner: unit });
  },
  lines: {
    0: ({ battle, unit }) => {
      battle.reduceElement(unit, Infinity);
      battle.addBuff(unit, { key: `assault:philae:barrier:${uid(unit)}`, shield: unit.s.maxHp * PHILAE_BARRIER / 100, duration: Infinity, refresh: 'replace', source: unit, visible: true });
    },
    1: 'cast',
    2: {
      install: ({ battle, unit, p, fx }) => deployEffect(battle, unit, { key: 'philae-oracle', arm: () => fx.buff(unit, { key: 'oracle', mods: { elemTakenMul: 1 - p('b') / 100 }, persist: true }) }),
      options: { accept: () => false },
      run: () => {},
    },
    // the line's sub type names necrosis; card-lines maps it to the engine's 凋亡 (apoptosis)
    3: ({ unit, p, fx }) => fx.charge(unit, p('c')),
  },
  modules: {
    [PHILAE_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 星熊 ---
// She lets your 重装 block flyers and hardens the other ones; every air block of theirs grows that bonus for the run.

const HSGUMA_DEPLOY_DEF = 20, HSGUMA_DEPLOY_SECONDS = 10, HSGUMA_ATK = 140, HSGUMA_DEF = 90, HSGUMA_GROWTH = 'hsguma-strategy';
const HSGUMA_MODULE = 'uniequip_002_hsguma', HSGUMA_MODULE_BLOCK = 1, HSGUMA_MODULE_ATK = 35, HSGUMA_MODULE_SECONDS = 5;
const defender = (x) => matchesClass(x, { label: '重装' });
/** The tile in front of the unit. */
const frontTile = (unit) => { const [dr, dc] = dirVec(unit.dir); return [unit.tileR + dr, unit.tileC + dc]; };
const onTile = (e, [r, c]) => Math.round(e.y) === r && Math.round(e.x) === c;

const hsguma = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'saw', mods: { atkPct: HSGUMA_ATK / 100, defPct: HSGUMA_DEF / 100 }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  install: (battle, unit) => battle.on('damaged', ({ source, target, dmg }) => {
    // 力之锯：用盾牌切割前方一格的所有敌人
    if (source !== unit || !active(unit) || !hasBuff(unit, ':saw') || !dmg?.isAttack || dmg.tags?.includes('hsguma-saw') || target?.side !== 'enemy') return;
    const front = frontTile(unit);
    const others = battle.enemies.filter((e) => e !== target && e.alive && !e.removed && !e.hidden && onTile(e, front));
    battle.assaultRuntime.enqueue(() => { for (const e of others) if (e.alive) battle.dealDamage(unit, e, { amount: dmg.amount, type: dmg.type, isAttack: true, tags: ['hsguma-saw'] }); },
      { targetUid: uid(target) });
  }, { owner: unit }),
  lines: {
    0: ({ battle, unit, fx }) => { for (const x of fx.allies('adjacentAllies').filter(defender)) fx.buff(x, { key: 'deploy-guard', mods: { defPct: HSGUMA_DEPLOY_DEF / 100 }, duration: HSGUMA_DEPLOY_SECONDS }); },
    1: 'cast',
    2: {
      // 战术装甲：获得 b% 伤害抵挡（一次伤害整个抵挡）；模组：成功抵挡伤害后 5 秒内攻击力 +35%（不叠加）
      install: ({ battle, unit, p, fx }) => battle.on('hit', ({ source, target, dmg }) => {
        if (target !== unit || !active(unit) || source?.side !== 'enemy' || !(dmg?.amount > 0) || dmg.cancel || !(battle.rng() < p('b') / 100)) return;
        dmg.cancel = true;
        if (moduleOf(unit) === HSGUMA_MODULE) fx.buff(unit, { key: 'gift', mods: { atkPct: HSGUMA_MODULE_ATK / 100 }, duration: HSGUMA_MODULE_SECONDS });
      }, { owner: unit, priority: -10 }),
      run: () => {},
    },
    3: ({ battle, unit, p, fx }) => liveAura(battle, unit, 'strategy', { select: (x) => x !== unit && defender(x),
      mods: () => ({ defPct: (p('c') + fx.growthValue(unit, HSGUMA_GROWTH)) / 100 }) }),
    4: ({ fx }) => fx.airAura({ label: '重装' }),
    5: ({ unit, p, fx }) => fx.growthCounter(unit, { key: HSGUMA_GROWTH, label: '特种作战策略防御力加成', amount: p('d'), suffix: '%' }),
  },
  modules: {
    // 友人们的赠礼：阻挡数 +1（抵挡后的攻击力在 line 2）
    [HSGUMA_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'gift-block', mods: { blockCnt: HSGUMA_MODULE_BLOCK }, persist: true }),
  },
});

// -------------------------------------------------------------------- 瑕光 ---
// She puts her tile to sleep and strikes the sleeping; sleeps of your other operators charge her; the hit-recovery skills of
// your other operators also recover on attack.

const BLEMSH_HIT_SP = 1, BLEMSH_SLEEP_CHARGE = 1, BLEMSH_MODULE = 'uniequip_002_blemsh', BLEMSH_MODULE_CHARGE = 3;
/** Does `x`'s native skill recover SP when hit (受击回复)? */
const hitRecovery = (x) => {
  const body = x.def?.raw?.assaultBody;
  const id = body?.fixedSkill?.sourceSkillId ?? body?.bazaar?.skillSource;
  return body?.source?.skills?.find((s) => s.skillId === id)?.spData?.spType === 'INCREASE_WHEN_TAKEN_DAMAGE';
};

const blemsh = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const [target] = battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile).sort((a, b) => Number(asleep(b)) - Number(asleep(a)) || byExit(battle)(a, b));
    if (!target) return false;
    fx.damage(target, { scale: cardParam(unit, 1, 'b') / 100, type: 'phys', isSkill: true, ignoreSleep: true });
    const [x] = lowestHp(injured(aroundAllies(battle, unit)));
    if (x) fx.heal(x, { scale: cardParam(unit, 1, 'c') / 100 });
    return true;
  },
  install: (battle, unit) => {
    // 剑盾骑士：你的其他干员的受击回复技能，攻击时也回复 1 技力
    battle.on('attack', ({ attacker }) => {
      if (!active(unit) || attacker === unit || attacker?.kind !== 'op' || !relates(unit, attacker, 'other') || !hitRecovery(attacker)) return;
      effects(battle, unit, { index: 3 }).charge(attacker, BLEMSH_HIT_SP);
    }, { owner: unit });
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of battle.enemies.filter((e) => e.alive && !e.removed && !e.isFlying && onTile(e, [unit.tileR, unit.tileC]))) fx.status(e, { status: 'sleep', duration: p('a') }); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => {
        deployEffect(battle, unit, { key: 'blemsh-mercy', arm: () => { unit.profile = { ...unit.profile, hitSleep: true }; } });
        // 仁慈：攻击沉睡的敌人时攻击力提升至 d%
        battle.on('hit', ({ source, target, dmg }) => { if (ownAttack(unit, source, target, dmg) && asleep(target)) dmg.amount *= p('d') / 100; }, { owner: unit, priority: 90 });
      },
      run: ({ unit, fx }) => fx.charge(unit, BLEMSH_SLEEP_CHARGE),
    },
    3: () => {},
  },
  modules: {
    // 工匠团的回响：你的其他卡西米尔干员部署或再部署时，此干员充能 3
    [BLEMSH_MODULE]: ({ unit, fx }) => fx.charge(unit, BLEMSH_MODULE_CHARGE),
  },
});

// ---------------------------------------------------------------------- 黍 ---
// Her heals sow the tiles they land on (regeneration and 庇护, more for every cast of your other 岁 this run); 天有四时
// rewards a team of mixed or matching classes, or four 岁.

const SHU_DEPLOY_REGEN = 60, SHU_DEPLOY_SANCTUARY = 12, SHU_LOW = 0.5, SHU_SEASON = 12, SHU_SEASON_SP = 1, SHU_SEASON_TICK = 4, SHU_SUI = 4;
const SHU_GROWTH = 'shu-seed', SHU_GROWTH_STEP = 2, SHU_MODULE = 'uniequip_003_shu', SHU_MODULE_TAKEN = 15, SHU_MODULE_ATK = 5;
const sui = (x) => matchesClass(x, { label: '岁' });
/** 天有四时: which of the three conditions your operators on the field meet now. */
function seasons(battle, unit) {
  const ops = yourOps(battle, unit);
  const count = new Map();
  for (const x of ops) count.set(x.def?.raw?.assaultBody?.profession, (count.get(x.def?.raw?.assaultBody?.profession) ?? 0) + 1);
  return { mixed: count.size >= 3, same: [...count.values()].some((n) => n >= 3), sui: ops.filter(sui).length >= SHU_SUI };
}

const shu = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundAllies(battle, unit).some((x) => x.hp < x.s.maxHp * SHU_LOW),
  cast: ({ battle, unit, cause }) => {
    const [x] = lowestHp(aroundAllies(battle, unit).filter((y) => y.hp < y.s.maxHp * SHU_LOW));
    if (!x) return false;
    effects(battle, unit, { index: 'skill' }, cause).heal(x, { scale: cardParam(unit, 1, 'a') / 100 });
    return true;
  },
  install: (battle, unit) => {
    const fx = effects(battle, unit, { index: 3 });
    liveAura(battle, unit, 'seasons', { select: () => true, mods: () => {
      const s = seasons(battle, unit), met = [s.mixed, s.same, s.sui].filter(Boolean).length;
      const m = {};
      if (s.mixed) m.hpPct = SHU_SEASON / 100;
      if (s.same) m.aspd = SHU_SEASON;
      if (s.sui) m.atkPct = SHU_SEASON / 100;
      if (moduleOf(unit) === SHU_MODULE && met >= 2) m.atkPct = (m.atkPct ?? 0) + SHU_MODULE_ATK / 100;
      return Object.keys(m).length ? m : null;
    } });
    // 有四名岁干员时……每 4 秒获得 1 技力
    battle.every(SHU_SEASON_TICK, () => { if (active(unit) && seasons(battle, unit).sui) for (const x of yourOps(battle, unit)) fx.charge(x, SHU_SEASON_SP); }, { owner: unit });
  },
  lines: {
    0: ({ battle, unit, fx }) => seedTile(battle, unit, { at: [unit.tileR, unit.tileC], regen: SHU_DEPLOY_REGEN + fx.growthValue(unit, SHU_GROWTH), sanctuary: SHU_DEPLOY_SANCTUARY / 100 }),
    1: 'cast',
    2: {
      install: ({ battle, unit, p, fx }) => battle.on('heal', ({ source, target }) => {
        if (source !== unit || !active(unit) || target?.side !== 'ally' || !target.alive) return;
        for (const [dr, dc] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const at = [target.tileR + dr, target.tileC + dc];
          if (battle.grid.inRect(...at)) seedTile(battle, unit, { at, regen: p('b') + fx.growthValue(unit, SHU_GROWTH), sanctuary: p('c') / 100 });
        }
      }, { owner: unit }),
      run: () => {},
    },
    3: () => {},
    4: ({ unit, p, fx }) => fx.charge(unit, p('d')),
    5: ({ unit, fx }) => fx.growthCounter(unit, { key: SHU_GROWTH, label: '播种每秒回复', amount: SHU_GROWTH_STEP }),
  },
  modules: {
    // 好时节：受到的伤害 -15%（达成两种或以上时的 +5% 在天有四时）
    [SHU_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'good-season', mods: { dmgTakenMul: 1 - SHU_MODULE_TAKEN / 100 }, persist: true }),
  },
});

// -------------------------------------------------------------------- 泥岩 ---
// Her shield layers come back every 9 s and heal her as they break; casts of your other 罗德岛 grow her HP for the run;
// shields breaking on your other operators stack her defence.

const MUDROK_LAYERS = 3, MUDROK_LAYER_SECONDS = 9, MUDROK_SELF_HEAL = 6, MUDROK_STUN_CHANCE = 30, MUDROK_STUN = 1.2, MUDROK_LIFT = 0.5;
const MUDROK_STACK = 2, MUDROK_MODULE = 'uniequip_002_mudrok', MUDROK_MODULE_CHARGE = 2;
const layerKey = (unit, i) => `assault:mudrok:layer:${uid(unit)}:${i}`;
function addLayer(battle, unit) {
  for (let i = 0; i < MUDROK_LAYERS; i++) {
    if (unit.findBuff(layerKey(unit, i))) continue;
    battle.addBuff(unit, { key: layerKey(unit, i), shieldHits: 1, duration: Infinity, refresh: 'replace', source: unit, visible: true });
    return true;
  }
  return false;
}

const mudrok = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1, { ground: true }).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.heal(unit, { maxHpRatio: MUDROK_SELF_HEAL / 100 });
    for (const e of aroundEnemies(battle, unit, 99, { ground: true })) {
      fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
      if (!e.alive) continue;
      if (battle.rng() < MUDROK_STUN_CHANCE / 100) fx.status(e, { status: 'stun', duration: MUDROK_STUN });
      fx.status(e, { status: 'levitate', duration: MUDROK_LIFT });
    }
    return true;
  },
  lines: {
    0: ({ battle, unit }) => addLayer(battle, unit),
    1: 'cast',
    2: {
      install: ({ battle, unit, p, fx }) => {
        battle.every(MUDROK_LAYER_SECONDS, () => { if (active(unit)) addLayer(battle, unit); }, { owner: unit });
        // 每层护盾破裂时恢复自身 b% 最大生命（模组：额外充能 2）
        battle.on('shieldLayersBroken', ({ unit: who, buff }) => {
          if (who !== unit || !active(unit) || !String(buff?.key).startsWith(`assault:mudrok:layer:${uid(unit)}:`)) return;
          battle.assaultRuntime.enqueue(() => {
            fx.heal(unit, { maxHpRatio: p('b') / 100 });
            if (moduleOf(unit) === MUDROK_MODULE) effects(battle, unit, { index: `module:${MUDROK_MODULE}` }).charge(unit, MUDROK_MODULE_CHARGE);
          }, { targetUid: uid(unit) });
        }, { owner: unit });
      },
      run: () => {},
    },
    3: ({ unit, p, fx }) => fx.growth(unit, { key: 'fertile', stat: 'maxHp', percent: p('c') / 100 }),
    4: ({ unit, fx }) => fx.stack(unit, { key: 'brothers', stat: 'def', amount: MUDROK_STACK / 100, mode: 'percent' }),
  },
  modules: {
    // 土石的根系 — every layer (line 2), not only the last one this trigger sees
    [MUDROK_MODULE]: { options: { accept: () => false }, run: () => {} },
  },
});

// -------------------------------------------------------------------- 斥罪 ---
// Kills by your other operators build her own barrier; while she has it she strikes back and your 叙拉古 block flyers;
// kills by your other 叙拉古 grow her HP for the run.

const JUDGE_CHARGED_ATK = 200, JUDGE_CAP = 3, JUDGE_MODULE = 'uniequip_003_judge', JUDGE_MODULE_THORNS = 61;
const judgeKey = (unit) => `assault:judge:barrier:${uid(unit)}`;
function judgeBarrier(battle, unit, ratio) {
  const old = unit.findBuff(judgeKey(unit))?.shield ?? 0;
  battle.addBuff(unit, { key: judgeKey(unit), shield: Math.min(unit.s.maxHp * JUDGE_CAP, old + unit.s.maxHp * ratio), duration: Infinity, refresh: 'replace', source: unit, visible: true });
}

const judge = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const [target] = rangeEnemies(battle, unit, 1);
    if (!target) return false;
    // 蓄满: the skill's charges were full when it fired
    const charged = (unit.skill.charges ?? 0) + 1 >= (unit.skill.maxCharges ?? 1);
    fx.damage(target, { scale: (charged ? JUDGE_CHARGED_ATK : 100) / 100, type: 'phys', isSkill: true });
    if (target.alive) fx.damage(target, { scale: cardParam(unit, 1, 'b') / 100, type: 'arts', isSkill: true });
    if (charged && target.alive) fx.status(target, { status: 'stun', duration: cardParam(unit, 1, 'c') });
    return true;
  },
  lines: {
    0: ({ battle, unit, p }) => judgeBarrier(battle, unit, p('a') / 100),
    1: 'cast',
    2: ({ battle, unit, p }) => judgeBarrier(battle, unit, p('d') / 100),
    3: {
      // 荆棘环身: every attack on her while she has her own barrier — hits the barrier absorbs whole included
      install: ({ battle, unit, p, fx }) => battle.on('hit', ({ source, target, dmg }) => {
        if (target !== unit || !active(unit) || source?.side !== 'enemy' || !dmg?.isAttack || dmg.cancel || !hasOwnBarrier(unit)) return;
        const scale = (moduleOf(unit) === JUDGE_MODULE ? JUDGE_MODULE_THORNS : p('e')) / 100;
        battle.assaultRuntime.enqueue(() => { if (source.alive) fx.damage(source, { scale, type: 'arts' }); }, { targetUid: uid(source) });
      }, { owner: unit }),
      options: { accept: () => false },
      run: () => {},
    },
    4: ({ fx }) => fx.airAura({ label: '叙拉古' }, { when: fx.raw.synergy.hasOwnBarrier }),
    5: ({ unit, p, fx }) => fx.growth(unit, { key: 'law', stat: 'maxHp', percent: p('f') / 100 }),
  },
  modules: {
    // “无罪”：荆棘环身的反击伤害提高到 61% — read by line 3
    [JUDGE_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 森蚺 ---
// Blocking speeds her SP up (自扳机, benchmark Private Hot Springs); her stuns stack the attack of the ones next to her;
// stuns of your other operators grow her attack for the run.

const ZUMAMA_DEPLOY = 25, ZUMAMA_DEPLOY_SECONDS = 15, ZUMAMA_STUN_TICK = 0.25, ZUMAMA_HALF = 0.5, ZUMAMA_STACK = 1;
const ZUMAMA_MODULE = 'uniequip_003_zumama', ZUMAMA_MODULE_DAMAGE = 125, ZUMAMA_MODULE_SANCTUARY = 30;

const zumama = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => blocking(unit) || aroundEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'shock-chop', mods: { atkPct: cardParam(unit, 1, 'b') / 100,
      batPct: batOf(unit, nativeValue(unit, 'base_attack_time')) }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  install: (battle, unit) => {
    // 震慑劈砍：持续使阻挡的敌人晕眩
    battle.every(ZUMAMA_STUN_TICK, () => {
      if (!active(unit) || !hasBuff(unit, ':shock-chop')) return;
      const fx = effects(battle, unit, { index: 'skill' });
      for (const e of unit.blocking ?? []) if (e.alive) fx.status(e, { status: 'stun', duration: ZUMAMA_STUN_TICK * 2 });
    }, { owner: unit });
    // 勇冠三军：生命高于一半时攻击造成 d% 伤害；不高于一半时获得 e% 庇护
    const values = () => (moduleOf(unit) === ZUMAMA_MODULE ? [ZUMAMA_MODULE_DAMAGE, ZUMAMA_MODULE_SANCTUARY] : [cardParam(unit, 3, 'd'), cardParam(unit, 3, 'e')]);
    battle.on('hit', ({ source, target, dmg }) => {
      if (source === unit && active(unit) && target?.side === 'enemy' && dmg && unit.hp > unit.s.maxHp * ZUMAMA_HALF) dmg.mul *= values()[0] / 100;
    }, { owner: unit, priority: 80 });
    liveAura(battle, unit, 'bravery', { select: (x) => x === unit, mods: () => (unit.hp <= unit.s.maxHp * ZUMAMA_HALF ? { dmgTakenMul: 1 - values()[1] / 100 } : null) });
  },
  lines: {
    0: ({ unit, fx }) => fx.buff(unit, { key: 'light-axe', mods: { atkPct: ZUMAMA_DEPLOY / 100, defPct: ZUMAMA_DEPLOY / 100 }, duration: ZUMAMA_DEPLOY_SECONDS }),
    1: 'cast',
    2: ({ unit, p, fx }) => fx.accelerate(unit, p('c')),
    3: () => {},
    4: ({ fx }) => { for (const x of fx.allies('adjacentAllies')) fx.stack(x, { key: 'bravery', stat: 'atk', amount: ZUMAMA_STACK / 100, mode: 'percent' }); },
    5: ({ unit, p, fx }) => fx.growth(unit, { key: 'bravery', stat: 'atk', percent: p('f') / 100 }),
  },
  modules: {
    // “小小的丑东西” — read by the hooks above
    [ZUMAMA_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 号角 ---
// Her flares light a zone where your 维多利亚 block flyers; 军事要塞 raises your other 重装's attack, more for every air
// block of your other 维多利亚 this battle and every elite kill of your other 重装 this run.

const HORN_DEPLOY_SCALE = 150, HORN_FLARE = 8, HORN_SPLASH = 1, HORN_SKILL_SPLASH = 2, HORN_HP_DOWN = 50, HORN_STACK = 1;
const HORN_COUNTER = 'horn-fortress', HORN_GROWTH = 'horn-fortress-run', HORN_MODULE = 'uniequip_002_horn', HORN_MODULE_ATK = 110;
function flare(battle, unit, fx, target, scale, radius, isSkill) {
  const at = [Math.round(target.y), Math.round(target.x)];
  for (const e of battle.enemies.filter((x) => x.alive && !x.removed && !x.hidden && Math.max(Math.abs(Math.round(x.y) - at[0]), Math.abs(Math.round(x.x) - at[1])) <= radius)) {
    fx.damage(e, { scale, type: 'phys', isSkill });
  }
  fx.raw.synergy.flareZone(battle, unit, { at, radius: 1, duration: HORN_FLARE });
}

const horn = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const [target] = rangeEnemies(battle, unit, 1);
    if (!target) return false;
    flare(battle, unit, effects(battle, unit, { index: 'skill' }, cause), target, cardParam(unit, 1, 'a') / 100, HORN_SKILL_SPLASH, true);
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => { const [e] = rangeEnemies(battle, unit, 1); if (e) flare(battle, unit, fx, e, HORN_DEPLOY_SCALE / 100, HORN_SPLASH, false); },
    1: 'cast',
    2: ({ battle, unit, p, fx }) => liveAura(battle, unit, 'fortress', { select: (x) => x !== unit && defender(x),
      mods: () => ({ atkPct: (p('b') + counterValue(battle, unit, HORN_COUNTER) + fx.growthValue(unit, HORN_GROWTH)) / 100 }) }),
    3: {
      // 血战：每次部署后首次受到致命伤害时不撤退（「部署」含原地再部署）
      install: ({ battle, unit, p, fx }) => {
        deployEffect(battle, unit, { key: 'horn-last-stand', effect: () => {
          unit.mem.hornStandUsed = false;
          for (const b of unit.buffs.filter((x) => String(x.key).includes(':last-stand'))) battle.removeBuff(unit, b);
        } });
        battle.on('fatal', (ctx) => {
          if (ctx.unit !== unit || unit.mem.hornStandUsed || ctx.prevented) return;
          unit.mem.hornStandUsed = true;
          ctx.prevented = true;
          fx.buff(unit, { key: 'last-stand', mods: { hpPct: -HORN_HP_DOWN / 100, aspd: p('c'), defPct: p('e') / 100 }, persist: true });
          unit.hp = unit.s.maxHp;
        }, { owner: unit });
      },
      options: { accept: () => false },
      run: () => {},
    },
    4: ({ battle, fx }) => fx.airAura({ label: '维多利亚' }, { where: (x) => fx.raw.synergy.inZone(battle, x, 'flare') }),
    5: ({ unit, fx }) => fx.counter(unit, { key: HORN_COUNTER, label: '军事要塞', amount: HORN_STACK, suffix: '%' }),
    6: ({ unit, p, fx }) => fx.growthCounter(unit, { key: HORN_GROWTH, label: '军事要塞', amount: p('d'), suffix: '%' }),
  },
  modules: {
    // “典范之人”：攻击被你的其他干员阻挡的敌人时，攻击力提升至 110%
    [HORN_MODULE]: {
      install: ({ battle, unit }) => battle.on('hit', ({ source, target, dmg }) => {
        if (ownAttack(unit, source, target, dmg) && target.blockedBy && relates(unit, target.blockedBy, 'other')) dmg.amount *= HORN_MODULE_ATK / 100;
      }, { owner: unit, priority: 80 }),
      options: { accept: () => false },
      run: () => {},
    },
  },
});

// ------------------------------------------------------------------ 涤火杰西卡 ---
// Her mobile shield (a summon) charges her as it takes hits; every round your other operators fire stacks her attack.

const JESCA2_SHIELD = 'token_10032_jesca2_jckshd', JESCA2_DEF = 18, JESCA2_ROUNDS = 20, JESCA2_RANGE = 1, JESCA2_SKILL_DEF = 80;
const JESCA2_SHELL = 250, JESCA2_CHARGE = 1, JESCA2_STACK = 0.5, JESCA2_MODULE = 'uniequip_003_jesca2', JESCA2_MODULE_CUT = 1, JESCA2_MODULE_CAP = 14;
const jesca2Shield = (battle, unit) => battle.allyUnits.find((x) => x.kind === 'token' && x.ownerUnit === unit && x.defId === JESCA2_SHIELD && active(x)) ?? null;
// the mobile shield's own kit (replaces the old one of its token): it stands where it is put and draws attacks
const mobileShieldKit = () => ({ skill: { kind: 'passive', onStart() {} }, install(battle, token) {
  const mark = () => { if (token.alive && !token.findBuff('assault:jesca2:shield-taunt')) battle.addBuff(token, { key: 'assault:jesca2:shield-taunt', mods: { taunt: 1 }, duration: Infinity }); };
  battle.on('deploy', ({ unit }) => { if (unit === token) mark(); }, { owner: token });
  mark();
} });
function placeShield(battle, unit, duration) {
  return grantSummon(battle, unit, { tokenId: JESCA2_SHIELD, ruleKey: 'synergy-mobile-shield', count: 1, stockCap: 1, fieldCap: 1, cost: 0, duration, replaceExisting: true });
}

const jesca2 = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.raw.synergy.ammoSkill(battle, unit, { key: 'saturation', count: JESCA2_ROUNDS,
      mods: { rangeExtend: JESCA2_RANGE, atkPct: cardParam(unit, 1, 'b') / 100, defPct: JESCA2_SKILL_DEF / 100 }, cause });
    // 机动盾牌存在时立即发射炮弹：范围内 250% 物理伤害并晕眩 c 秒
    if (jesca2Shield(battle, unit)) for (const e of rangeEnemies(battle, unit)) {
      fx.damage(e, { scale: JESCA2_SHELL / 100, type: 'phys', isSkill: true });
      if (e.alive) fx.status(e, { status: 'stun', duration: cardParam(unit, 1, 'c') });
    }
    return true;
  },
  install: (battle, unit) => {
    // 此干员与身后的干员防御力 +18%
    liveAura(battle, unit, 'cover', { select: (x) => { const [dr, dc] = dirVec(unit.dir); return x === unit || (x.tileR === unit.tileR - dr && x.tileC === unit.tileC - dc); },
      mods: () => ({ defPct: JESCA2_DEF / 100 }) });
    battle.on('damaged', ({ target, amount }) => {
      const shield = jesca2Shield(battle, unit);
      if (!shield || target !== shield || !(amount > 0) || !active(unit)) return;
      // 蓄能释放：机动盾牌受到伤害时，d% 几率让此干员充能 1
      if (battle.rng() < cardParam(unit, 2, 'd') / 100) effects(battle, unit, { index: 2 }).charge(unit, JESCA2_CHARGE);
      // 未曾风化：机动盾牌受到伤害时，机动盾牌的再部署时间 -1 秒（最多 -14 秒）
      if (moduleOf(unit) === JESCA2_MODULE) unit.mem.jesca2ShieldCut = Math.min(JESCA2_MODULE_CAP, (unit.mem.jesca2ShieldCut ?? 0) + JESCA2_MODULE_CUT);
    }, { owner: unit });
    // a destroyed shield comes back after its 再部署时间 (the token's), less the module's cut
    battle.on('death', ({ unit: gone, reason }) => {
      if (gone?.defId !== JESCA2_SHIELD || gone.ownerUnit !== unit || reason !== 'killed' || moduleOf(unit) !== JESCA2_MODULE) return;
      const wait = Math.max(0, (gone.base?.respawnTime ?? 30) - (unit.mem.jesca2ShieldCut ?? 0));
      battle.after(wait, () => { if (active(unit)) placeShield(battle, unit, cardParam(unit, 0, 'a')); }, { owner: unit });
    }, { owner: unit });
  },
  lines: {
    0: ({ battle, unit, p }) => placeShield(battle, unit, p('a')),
    1: 'cast',
    2: { options: { accept: () => false }, run: () => {} },
    3: ({ unit, fx }) => fx.stack(unit, { key: 'adapt', stat: 'atk', amount: JESCA2_STACK / 100, mode: 'percent' }),
  },
  modules: {
    [JESCA2_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 信仰搅拌机 ---
// She reloads your other 拉特兰; every hit she lands stacks her guard; every round your other 拉特兰 fire grows her
// defence for the run.

const RMIXER_DEPLOY_RELOAD = 2, RMIXER_HITS = 3, RMIXER_SKILL_RELOAD = 1, RMIXER_STACK_SECONDS = 10, RMIXER_STACKS = 3, RMIXER_IDLE = 8;
const RMIXER_MODULE = 'uniequip_002_rmixer';
const laterano = (x) => matchesClass(x, { label: '拉特兰' });

const rmixer = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const [target] = rangeEnemies(battle, unit, 1);
    if (!target) return false;
    for (let i = 0; i < RMIXER_HITS && target.alive; i++) fx.damage(target, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
    const [mate] = yourOps(battle, unit, { others: true }).filter((x) => laterano(x) && around8(unit, x) && (assaultAmmoState(x)?.current ?? 0) > 0);
    if (mate) fx.reload(mate, RMIXER_SKILL_RELOAD);
    return true;
  },
  install: (battle, unit) => {
    // 架盾送客仪礼：8 秒内未主动攻击时获得 d% 生命上限的屏障，失去屏障后重新计时
    const key = `assault:rmixer:idle:${uid(unit)}`;
    unit.mem.rmixerLastAttack = battle.time;
    battle.on('attack', ({ attacker }) => { if (attacker === unit) unit.mem.rmixerLastAttack = battle.time; }, { owner: unit });
    battle.every(0.25, () => {
      if (!active(unit)) return;
      const held = unit.findBuff(key);
      if (held && held.shield > 0) return;
      if (unit.mem.rmixerHadBarrier) { unit.mem.rmixerHadBarrier = false; unit.mem.rmixerLastAttack = battle.time; return; }
      if (battle.time + 1e-9 < unit.mem.rmixerLastAttack + RMIXER_IDLE) return;
      battle.addBuff(unit, { key, shield: unit.s.maxHp * cardParam(unit, 3, 'd') / 100, duration: Infinity, refresh: 'replace', source: unit, visible: true });
      unit.mem.rmixerHadBarrier = true;
    }, { owner: unit });
    // 毛刷套装：扫射迎宾仪礼叠满时，你的其他拉特兰干员攻击速度不会低于战斗开始时
    const start = new Map();
    liveAura(battle, unit, 'brush', { select: (x) => x !== unit && laterano(x), mods: (x) => {
      if (!start.has(uid(x))) start.set(uid(x), x.s.aspd);
      const full = (unit.buffs.find((b) => String(b.key).includes(':welcome'))?.stacks ?? 0) >= RMIXER_STACKS;
      if (moduleOf(unit) !== RMIXER_MODULE || !full) return null;
      const own = x.buffs.find((b) => String(b.key).endsWith(':brush'))?.mods?.aspd ?? 0;
      const lack = start.get(uid(x)) - (x.s.aspd - own);
      return lack > 0 ? { aspd: lack } : null;
    } });
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const x of yourOps(battle, unit, { others: true }).filter(laterano)) fx.reload(x, RMIXER_DEPLOY_RELOAD); },
    1: 'cast',
    2: ({ unit, p, fx }) => fx.sustain(unit, { key: 'welcome', mods: { defFlat: p('b'), aspd: p('c') }, duration: RMIXER_STACK_SECONDS, stack: true, maxStacks: RMIXER_STACKS }),
    3: () => {},
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'welcome', stat: 'def', percent: p('e') / 100 }),
  },
  modules: {
    [RMIXER_MODULE]: () => {},
  },
});

// ---------------------------------------------------------------------- 余 ---
// He pulls the enemies around him in and burns the ones he blocks; casts of your other 岁 charge him; 灼燃 bursts of your
// other operators make 礼尚往来 hit harder for the battle.

const YU_DEPLOY_SCALE = 60, YU_DEPLOY_BURN = 12, YU_PULL_SCALE = 100, YU_BLOCK = 2, YU_MIN_OPS = 4, YU_REGEN = 2, YU_STACK = 3;
const YU_COUNTER = 'yu-courtesy', YU_MODULE = 'uniequip_002_yu', YU_MODULE_ARTS = 14;
const burnBursting = (e) => (e?.buffs ?? []).some((b) => String(b.key).startsWith('assaultBurst:') && String(b.key).endsWith(':res') && b.timeLeft > 0);

const yu = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    for (const e of aroundEnemies(battle, unit)) {
      fx.damage(e, { scale: YU_PULL_SCALE / 100, type: 'arts', isSkill: true });
      if (e.alive && !e.isFlying) fx.raw.synergy.teleportToSelf(battle, unit, e);
    }
    fx.sustain(unit, { key: 'guest', mods: { blockCnt: YU_BLOCK, hpPct: cardParam(unit, 2, 'b') / 100, atkPct: cardParam(unit, 2, 'c') / 100 }, duration: cardParam(unit, 2, 'a') });
    return true;
  },
  install: (battle, unit) => {
    // 厚礼上宾：普通攻击造成法术伤害；人间百味（模组）：对处于灼燃损伤爆发的敌人法术伤害 +14%
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !active(unit) || target?.side !== 'enemy' || !dmg) return;
      if (dmg.isAttack && !dmg.isSkill && hasBuff(unit, ':guest') && dmg.type === 'phys') dmg.type = 'arts';
      if (moduleOf(unit) === YU_MODULE && dmg.type === 'arts' && burnBursting(target)) dmg.mul *= 1 + YU_MODULE_ARTS / 100;
    }, { owner: unit, priority: 95 });
    // 闲云隐市：场上干员不少于 4 名时，每秒回复 2% 最大生命与元素损伤
    battle.every(1, () => {
      if (!active(unit) || yourOps(battle, unit).length < YU_MIN_OPS) return;
      effects(battle, unit, { index: 4 }).heal(unit, { maxHpRatio: YU_REGEN / 100 });
      battle.reduceElement(unit, unit.s.maxHp * YU_REGEN / 100);
    }, { owner: unit });
  },
  lines: {
    0: ({ battle, unit, fx }) => {
      for (const e of aroundEnemies(battle, unit)) {
        fx.damage(e, { scale: YU_DEPLOY_SCALE / 100, type: 'arts' });
        if (e.alive) fx.elementDamage(e, { element: 'burn', amount: unit.s.atk * YU_DEPLOY_BURN / 100 });
      }
    },
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit, p }) => {
        liveAura(battle, unit, 'courtesy', { select: (x) => x === unit, mods: () => (blocking(unit) ? { dmgTakenMul: 1 - p('d') / 100 } : null) });
        battle.every(1, () => {
          if (!active(unit)) return;
          const fx = effects(battle, unit, { index: 3 });
          for (const e of unit.blocking ?? []) {
            if (!e.alive) continue;
            fx.damage(e, { scale: p('e') / 100 * (1 + counterValue(battle, unit, YU_COUNTER) / 100), type: 'arts' });
            if (e.alive) fx.elementDamage(e, { element: 'burn', amount: unit.s.atk * p('f') / 100 });
          }
        }, { owner: unit });
      },
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.charge(unit, p('g')),
    5: ({ unit, fx }) => fx.counter(unit, { key: YU_COUNTER, label: '礼尚往来伤害', amount: YU_STACK, suffix: '%' }),
  },
  modules: {
    [YU_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 贾维 ---
// His claws (devices) at every deployment; every summon of your other operators pushes their owner's timer on and stacks
// his attack and defence.

const CHIAVE_CLAW = 'chiave_mech_claw', CHIAVE_REDEPLOY_CUT = 2, CHIAVE_RES_DOWN = 20, CHIAVE_RES_SECONDS = 8;
const CHIAVE_MODULE = 'uniequip_002_chiave', CHIAVE_MODULE_STATS = 20, CHIAVE_MODULE_BLAST = 100;
const claws = (battle, unit) => battle.allyUnits.filter((x) => x.kind === 'device' && x.ownerUnit === unit && x.mem?.assaultChiaveClaw && x.alive);
function placeClaw(battle, unit, duration) {
  const plan = unit.def.raw.assaultBody.modePassives?.find((x) => x.action === 'summon' && x.values?.deviceId === CHIAVE_CLAW)?.values;
  if (!plan) throw new TypeError('char_349_chiave: the claw plan (modePassives) is missing');
  const [row, col] = frontTile(unit);
  const there = battle.unitAt(row, col);
  if (there?.mem?.assaultChiaveClaw && there.ownerUnit === unit) battle.retreat(there, { reason: 'replaced', permanent: true }); // a new claw takes its place
  if (!battle.grid.inRect(row, col) || battle.unitAt(row, col)) return null;
  while (claws(battle, unit).length >= (plan.fieldCap ?? 2)) battle.retreat(claws(battle, unit)[0], { reason: 'replaced', permanent: true });
  const claw = battle.spawnDevice(`assault:${CHIAVE_CLAW}:${uid(unit)}:${battle.time}`, row, col, { name: '贾维机械爪', ownerUnit: unit, sourceKey: CHIAVE_CLAW,
    spine: plan.sourceTemplateId, avatar: plan.sourceTemplateId, hp: unit.s.maxHp * plan.maxHpRatio, atk: unit.s.atk * plan.atkRatio, def: unit.s.def * plan.defRatio,
    res: unit.s.res * plan.resRatio, bat: plan.bat, aspd: plan.aspd, blockCnt: plan.blockCnt, duration, rangeGrid: plan.rangeGrid, assaultCombat: true, dmgType: 'phys', canHitFly: false });
  if (!claw) return null;
  claw.mem.assaultChiaveClaw = true;
  // 自制千斤顶：机械爪生命与攻击力 +20%，退场时对周围造成 100% 攻击力的法术伤害
  if (moduleOf(unit) === CHIAVE_MODULE) {
    battle.addBuff(claw, { key: 'assault:chiave:jack', mods: { hpMul: 1 + CHIAVE_MODULE_STATS / 100, atkMul: 1 + CHIAVE_MODULE_STATS / 100 }, duration: Infinity });
    battle.on('death', ({ unit: gone, reason }) => {
      if (gone !== claw || ['ownerRemoved', 'replaced'].includes(reason) || !active(unit)) return;
      const fx = effects(battle, unit, { index: `module:${CHIAVE_MODULE}` });
      for (const e of aroundEnemies(battle, claw)) fx.damage(e, { scale: CHIAVE_MODULE_BLAST / 100, type: 'arts' });
    }, { owner: unit });
  }
  return claw;
}

const chiave = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.dp(cardParam(unit, 1, 'b'));
    for (const e of aroundEnemies(battle, unit)) {
      fx.damage(e, { scale: cardParam(unit, 1, 'c') / 100, type: 'arts', isSkill: true });
      if (e.alive) fx.buff(e, { key: 'stripped', mods: { resMul: 1 - CHIAVE_RES_DOWN / 100 }, duration: CHIAVE_RES_SECONDS });
    }
    return true;
  },
  install: (battle, unit) => battle.on('retreating', ({ unit: gone }) => { if (gone === unit) for (const c of claws(battle, unit)) battle.retreat(c, { reason: 'ownerRemoved', permanent: true }); }, { owner: unit }),
  lines: {
    0: ({ battle, unit, p }) => placeClaw(battle, unit, p('a')),
    1: 'cast',
    2: ({ battle, actor }) => cutTimer(battle, actor, { seconds: CHIAVE_REDEPLOY_CUT }),
    3: ({ unit, p, fx }) => {
      fx.stack(unit, { key: 'mechanic', stat: 'atk', amount: p('d') / 100, mode: 'percent' });
      fx.stack(unit, { key: 'mechanic', stat: 'def', amount: p('d') / 100, mode: 'percent' });
    },
  },
  modules: {
    // 自制千斤顶 — in placeClaw
    [CHIAVE_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 推进之王 ---
// Her hammer charges her from every enemy that falls next to her (自扳机, benchmark Critical Core); she lets your 先锋
// block flyers and raises the other ones, more for every elite they knock out this run.

const SIEGE_DEPLOY_SCALE = 150, SIEGE_LIFT = 1, SIEGE_DP = 3, SIEGE_GROWTH = 'siege-king';
const SIEGE_MODULE = 'uniequip_003_siege', SIEGE_MODULE_CHARGE = 3, SIEGE_MODULE_OTHER = 1;

const siege = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    for (const e of aroundEnemies(battle, unit)) fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
    fx.dp(SIEGE_DP);
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => {
      for (const e of aroundEnemies(battle, unit)) {
        fx.damage(e, { scale: SIEGE_DEPLOY_SCALE / 100, type: 'phys' });
        if (e.alive) fx.status(e, { status: 'levitate', duration: SIEGE_LIFT });
      }
    },
    1: 'cast',
    2: {
      // 粉碎：周围四格内有敌人倒下时（含此干员击倒；the card's death-of-an-enemy trigger is this hook）
      install: ({ battle, unit, p, fx }) => battle.on('death', ({ unit: e, reason }) => {
        if (e?.side !== 'enemy' || reason !== 'killed' || !active(unit) || Math.abs(Math.round(e.y) - unit.tileR) + Math.abs(Math.round(e.x) - unit.tileC) > 1) return;
        battle.assaultRuntime.enqueue(() => {
          if (moduleOf(unit) !== SIEGE_MODULE) { fx.charge(unit, p('b')); return; }
          fx.charge(unit, SIEGE_MODULE_CHARGE);
          const [other] = yourOps(battle, unit, { others: true }).filter((x) => vanguard(x) && chargeable(x)).sort((a, b) => spRatio(a) - spRatio(b) || uid(a).localeCompare(uid(b)));
          if (other) fx.charge(other, SIEGE_MODULE_OTHER);
        }, { targetUid: uid(unit) });
      }, { owner: unit }),
      options: { accept: () => false },
      run: () => {},
    },
    3: ({ battle, unit, p, fx }) => liveAura(battle, unit, 'king', { select: (x) => x !== unit && vanguard(x), mods: () => {
      const n = (p('c') + fx.growthValue(unit, SIEGE_GROWTH)) / 100;
      return { atkPct: n, defPct: n };
    } }),
    4: ({ fx }) => fx.airAura({ label: '先锋' }),
    5: ({ unit, p, fx }) => fx.growthCounter(unit, { key: SIEGE_GROWTH, label: '万兽之王加成', amount: p('d'), suffix: '%' }),
  },
  modules: {
    // “初诺” — in line 2 (its own death trigger is the same hook)
    [SIEGE_MODULE]: { options: { accept: () => false }, run: () => {} },
  },
});

// -------------------------------------------------------------------- 忍冬 ---
// 追凶 follows up on every enemy she has hit (more on the ones your other operators control, and for every kill of your
// other 叙拉古 this battle).

const VULPIS_DP = 1, VULPIS_CHASE_SECONDS = 10, VULPIS_CHASE = 30, VULPIS_CHASE_CONTROLLED = 60, VULPIS_CONTROLS = ['stun', 'sluggish', 'bind'];
const VULPIS_DP_REGEN = 10, VULPIS_IDLE = 4, VULPIS_REGEN = 5, VULPIS_STACK = 3, VULPIS_COUNTER = 'vulpis-chase';
const VULPIS_MODULE = 'uniequip_002_vulpis', VULPIS_MODULE_CHASE = 40, VULPIS_MODULE_CONTROLLED = 80;

const vulpis = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const [target] = rangeEnemies(battle, unit, 1);
    if (!target) return false;
    fx.damage(target, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
    fx.dp(VULPIS_DP);
    return true;
  },
  install: (battle, unit) => {
    // 迷彩 ends with her first cast
    battle.assaultRuntime.observe('skillStart', `vulpis-camou:${uid(unit)}`, ({ payload }) => {
      if (payload?.source !== unit) return;
      for (const b of unit.buffs.filter((x) => String(x.key).includes(':camouflage'))) battle.removeBuff(unit, b);
    }, { owner: unit });
    // 蓄势：在场时费用自然回复速度 +10%
    battle.assaultRuntime.observe('dpReceived', `vulpis-dp:${uid(unit)}`, ({ payload }) => {
      if (!active(unit) || payload?.sourceClass !== 'natural' || payload.targetUid !== unit.ownerId || !(payload.amount > 0)) return;
      battle.addDp(unit.ownerId, payload.amount * VULPIS_DP_REGEN / 100, 'assault');
    }, { owner: unit });
    // 蓄势：4 秒内未受到伤害时，每秒回复 5% 最大生命
    battle.every(1, () => {
      if (active(unit) && battle.time - (unit.lastHitAt ?? -Infinity) >= VULPIS_IDLE - 1e-9) effects(battle, unit, { index: 3 }).heal(unit, { maxHpRatio: VULPIS_REGEN / 100 });
    }, { owner: unit });
  },
  lines: {
    0: ({ unit, fx }) => fx.buff(unit, { key: 'camouflage', mods: {}, flags: { camou: true }, persist: true }),
    1: 'cast',
    2: {
      install: ({ battle, unit }) => {
        const first = new Map();
        battle.on('damaged', ({ source, target, amount, dmg }) => {
          if (source !== unit || !active(unit) || target?.side !== 'enemy' || !target.alive || !(amount > 0) || dmg?.tags?.includes('vulpis-chase') || dmg?.type === 'element') return;
          const at = first.get(target);
          if (at == null) { first.set(target, battle.time); return; }
          if (battle.time > at + VULPIS_CHASE_SECONDS + 1e-9) return;
          const module = moduleOf(unit) === VULPIS_MODULE;
          const base = byOthers(unit, target, VULPIS_CONTROLS) ? (module ? VULPIS_MODULE_CONTROLLED : VULPIS_CHASE_CONTROLLED) : (module ? VULPIS_MODULE_CHASE : VULPIS_CHASE);
          const scale = (base + counterValue(battle, unit, VULPIS_COUNTER)) / 100;
          battle.assaultRuntime.enqueue(() => { if (target.alive) battle.dealDamage(unit, target, { amount: unit.s.atk * scale, type: 'arts', tags: ['vulpis-chase'] }); }, { targetUid: uid(target) });
        }, { owner: unit });
      },
      options: { accept: () => false },
      run: () => {},
    },
    3: () => {},
    4: ({ unit, fx }) => fx.counter(unit, { key: VULPIS_COUNTER, label: '追凶伤害', amount: VULPIS_STACK, suffix: '%' }),
  },
  modules: {
    [VULPIS_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 琴柳 ---
// 不退之旗 speeds up the operators around it and slows the enemies, more for every kill next to it this battle; her
// deployments push your other 维多利亚 on.

const SLEACH_THROW_RADIUS = 2, SLEACH_THROW_SCALE = 300, SLEACH_THROW_SECONDS = 10, SLEACH_FRAGILE = 30, SLEACH_STACK = 1, SLEACH_COUNTER = 'sleach-banner';
const SLEACH_MODULE = 'uniequip_003_sleach', SLEACH_MODULE_DISCOUNT = 2, SLEACH_MODULE_DP = 2;
/** The banner's tile: thrown at an enemy for 10 s after the skill, else the tile in front of her. */
function bannerAt(battle, unit) {
  const thrown = unit.mem.sleachThrown;
  if (thrown && battle.time <= thrown.until + 1e-9) return thrown.at;
  return frontTile(unit);
}
const nearBanner = (battle, unit, x) => { const [r, c] = bannerAt(battle, unit); return Math.max(Math.abs(Math.round(x.y ?? x.tileR) - r), Math.abs(Math.round(x.x ?? x.tileC) - c)) <= 1; };
const nearBannerAlly = (battle, unit, x) => { const [r, c] = bannerAt(battle, unit); return Math.max(Math.abs(x.tileR - r), Math.abs(x.tileC - c)) <= 1; };
/** The ground enemies the banner can be thrown at: within 2 tiles of her, nearest the exit first. */
const throwTargets = (battle, unit) => battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden && !e.isFlying
  && Math.max(Math.abs(Math.round(e.y) - unit.tileR), Math.abs(Math.round(e.x) - unit.tileC)) <= SLEACH_THROW_RADIUS).sort(byExit(battle));

const sleach = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => throwTargets(battle, unit).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.dp(cardParam(unit, 1, 'b'));
    const [target] = throwTargets(battle, unit);
    if (!target) return true;
    const at = [Math.round(target.y), Math.round(target.x)];
    unit.mem.sleachThrown = { at, until: battle.time + SLEACH_THROW_SECONDS };
    for (const e of battle.enemies.filter((x) => x.alive && !x.removed && !x.hidden && nearBanner(battle, unit, x))) {
      fx.damage(e, { scale: SLEACH_THROW_SCALE / 100, type: 'phys', isSkill: true });
      if (e.alive) fx.status(e, { status: 'stun', duration: cardParam(unit, 1, 'c') });
    }
    return true;
  },
  install: (battle, unit) => {
    // 之后 10 秒，军旗周围 8 格的敌人停顿并受到 30% 脆弱
    enemyAura(battle, unit, { key: 'sleach-thrown', mods: { moveMul: 0.2, dmgTakenMul: 1 + SLEACH_FRAGILE / 100 },
      select: (e) => !!unit.mem.sleachThrown && battle.time <= unit.mem.sleachThrown.until + 1e-9 && nearBanner(battle, unit, e) });
    // 不退之旗：军旗周围 8 格的其他干员击倒敌人时（around the banner, not around her）
    bindTrigger(battle, unit, { event: 'kill', subject: 'otherAllies' }, { key: 'sleach-banner-kill', accept: (payload, ctx) => nearBannerAlly(battle, unit, ctx.actor) },
      ({ cause }) => effects(battle, unit, { index: 3 }, cause).counter(unit, { key: SLEACH_COUNTER, label: '不退之旗攻击速度', amount: SLEACH_STACK }));
  },
  lines: {
    0: ({ battle, unit, p }) => {
      liveAura(battle, unit, 'banner', { select: (x) => nearBannerAlly(battle, unit, x), mods: () => ({ aspd: p('a') + counterValue(battle, unit, SLEACH_COUNTER) }) });
      enemyAura(battle, unit, { key: 'banner-enemy', mods: { aspd: -p('e') }, select: (e) => nearBanner(battle, unit, e) });
    },
    1: 'cast',
    2: ({ p, fx }) => fx.cutRedeploy({ seconds: p('d'), filter: { label: '维多利亚' }, includeSelf: false }),
    3: { options: { accept: () => false }, run: () => {} },
  },
  modules: {
    // “友谊万岁”：部署后，下一名部署的干员费用 -2；若该干员为地面干员，部署后获得 2 费用
    [SLEACH_MODULE]: {
      install: ({ battle, unit }) => {
        battle.on('assaultDeploymentCost', (quote) => {
          const x = quote.unit;
          if (!unit.mem.sleachDiscount || !active(unit) || x?.kind !== 'op' || x === unit || x.ownerId !== unit.ownerId) return;
          quote.amount = Math.max(0, quote.amount - SLEACH_MODULE_DISCOUNT);
        }, { owner: unit });
        battle.on('deploy', ({ unit: x }) => {
          if (!unit.mem.sleachDiscount || x?.kind !== 'op' || x === unit || x.ownerId !== unit.ownerId) return;
          unit.mem.sleachDiscount = false;
          if (groundOp(x)) effects(battle, unit, { index: `module:${SLEACH_MODULE}` }).dp(SLEACH_MODULE_DP);
        }, { owner: unit });
      },
      run: ({ unit }) => { unit.mem.sleachDiscount = true; },
    },
  },
});

// -------------------------------------------------------------------- 焰尾 ---
// The 红松骑士团 dodges; every deployment of your other 卡西米尔 gives DP and charges her; every dodge of your other operators
// stacks her attack.

const FLAMTL_DEPLOY_DP = 3, FLAMTL_TARGETS = 6, FLAMTL_HITS = 2, FLAMTL_STUN = 0.5, FLAMTL_DODGE = 50, FLAMTL_DODGE_SECONDS = 10;
const FLAMTL_KAZ_DP = 3, FLAMTL_MODULE = 'uniequip_002_flamtl', FLAMTL_MODULE_ATK = 120, FLAMTL_MODULE_HITS = 2;
const kazimierz = (x) => matchesClass(x, { label: '卡西米尔' });

const flamtl = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.dp(cardParam(unit, 1, 'a'));
    for (const e of aroundEnemies(battle, unit, FLAMTL_TARGETS)) {
      for (let i = 0; i < FLAMTL_HITS && e.alive; i++) fx.damage(e, { scale: cardParam(unit, 1, 'b') / 100, type: 'phys', isSkill: true });
      if (e.alive) fx.status(e, { status: 'stun', duration: FLAMTL_STUN });
    }
    for (const x of rangeAllies(battle, unit, { ops: true })) fx.buff(x, { key: 'red-pine', mods: { dodgePhys: FLAMTL_DODGE / 100 }, duration: FLAMTL_DODGE_SECONDS });
    return true;
  },
  install: (battle, unit) => {
    // 迅敏直觉：闪避下一次物理攻击
    battle.on('hit', ({ source, target, dmg }) => {
      if (target !== unit || !unit.mem.flamtlDodgeNext || source?.side !== 'enemy' || !dmg?.isAttack || dmg.type !== 'phys' || dmg.cancel) return;
      unit.mem.flamtlDodgeNext = false;
      dmg.cancel = true;
      if (moduleOf(unit) === FLAMTL_MODULE) unit.mem.flamtlEmpowered = true;
    }, { owner: unit, priority: -5 });
    // 红松的起点：触发闪避后，下次攻击攻击力提升至 120%，变为二连击并攻击所有阻挡的敌人
    battle.on('dodge', ({ target }) => { if (target === unit && moduleOf(unit) === FLAMTL_MODULE) unit.mem.flamtlEmpowered = true; }, { owner: unit });
    battle.on('hit', ({ source, target, dmg }) => {
      if (!ownAttack(unit, source, target, dmg) || !unit.mem.flamtlEmpowered || dmg.tags?.includes('flamtl-pine')) return;
      unit.mem.flamtlEmpowered = false;
      dmg.amount *= FLAMTL_MODULE_ATK / 100;
      const amount = dmg.amount, type = dmg.type;
      const others = (unit.blocking ?? []).filter((e) => e !== target && e.alive);
      battle.assaultRuntime.enqueue(() => {
        if (target.alive) battle.dealDamage(unit, target, { amount, type, isAttack: true, tags: ['flamtl-pine'] });
        for (const e of others) for (let i = 0; i < FLAMTL_MODULE_HITS && e.alive; i++) battle.dealDamage(unit, e, { amount, type, isAttack: true, tags: ['flamtl-pine'] });
      }, { targetUid: uid(target) });
    }, { owner: unit, priority: 85 });
  },
  lines: {
    0: ({ unit, fx }) => { fx.dp(FLAMTL_DEPLOY_DP); unit.mem.flamtlDodgeNext = true; },
    1: 'cast',
    2: ({ battle, unit, p }) => liveAura(battle, unit, 'captain', { select: kazimierz, mods: () => ({ dodgePhys: p('c') / 100 }) }),
    3: ({ unit, p, fx }) => { fx.dp(FLAMTL_KAZ_DP); fx.charge(unit, p('d')); },
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'swordplay', stat: 'atk', amount: p('e') / 100, mode: 'percent' }),
  },
  modules: {
    [FLAMTL_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 伺夜 ---
// Her wolf pack (summons) grows over time; every wolf that falls charges your other 叙拉古; every kill of theirs grows the
// wolves' attack for the run.

const VIGIL_WOLF = 'token_10028_vigil_wolf', VIGIL_PACK = 2, VIGIL_MAX = 3, VIGIL_CHARGE = 1, VIGIL_GROWTH = 'vigil-wolves';
const VIGIL_MODULE = 'uniequip_003_vigil', VIGIL_MODULE_PACK = 2;
const wolves = (battle, unit) => battle.allyUnits.filter((x) => x.kind === 'token' && x.ownerUnit === unit && x.defId === VIGIL_WOLF && active(x));
const syracusa = (x) => matchesClass(x, { label: '叙拉古' });
function addWolves(battle, unit, count) {
  unit.mem.vigilGrants = (unit.mem.vigilGrants ?? 0) + 1;
  return grantSummon(battle, unit, { tokenId: VIGIL_WOLF, ruleKey: `synergy-wolf:${unit.mem.vigilGrants}`, count, stockCap: VIGIL_MAX, fieldCap: VIGIL_MAX, cost: 0 });
}
/** 战术家 援军: the owner's native reinforcement is its latest summon of this token on the field. */
function linkReinforcement(battle, token) {
  const owner = token.ownerUnit;
  if (owner?.profile?.sub !== 'tactician') return;
  const relink = () => { owner.trait.reinforcement = battle.allyUnits.filter((x) => x.kind === 'token' && x.ownerUnit === owner && x.defId === token.defId && active(x))
    .sort((a, b) => b.deploySeq - a.deploySeq)[0] ?? null; };
  battle.on('deploy', ({ unit }) => { if (unit === token && active(owner)) owner.trait.reinforcement = token; }, { owner: token });
  // the token's own hooks still run at its death / retreat (they are dropped after the step)
  for (const hook of ['death', 'retreating']) battle.on(hook, ({ unit }) => { if (unit === token && owner.trait.reinforcement === token) relink(); }, { owner: token });
  if (active(token) && active(owner)) owner.trait.reinforcement = token;
}
// the wolves' own kit (replaces the old one of their token): they fight as summons and are her 援军
const wolfKit = () => ({ skill: { kind: 'passive', onStart() {} }, install(battle, token) { linkReinforcement(battle, token); } });

const vigil = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).dp(cardParam(unit, 1, 'b'));
    addWolves(battle, unit, 1);
    return true;
  },
  install: (battle, unit) => {
    // 此后每 a 秒增加 1 只（至多 3 只）
    battle.every(cardParam(unit, 0, 'a'), () => { if (active(unit) && wolves(battle, unit).length < VIGIL_MAX) addWolves(battle, unit, 1); }, { owner: unit });
    // 狼影攻击力 (本局内永久): the wolves on the field carry the run counter as attack
    battle.every(0.25, () => {
      const n = effects(battle, unit, { index: 4 }).growthValue(unit, VIGIL_GROWTH);
      if (!n) return;
      for (const w of wolves(battle, unit)) battle.addBuff(w, { key: 'assault:vigil:wolf-growth', mods: { atkPct: n / 100 }, duration: 0.5 + 1e-6, refresh: 'replace', source: unit, visible: false });
    }, { owner: unit, immediate: true });
    // 时光不再：狼影全灭时，立即召唤 2 只狼影（每场战斗首次）
    battle.on('death', ({ unit: gone }) => {
      if (gone?.defId !== VIGIL_WOLF || gone.ownerUnit !== unit || moduleOf(unit) !== VIGIL_MODULE || unit.mem.vigilReformed || !active(unit)) return;
      battle.assaultRuntime.enqueue(() => {
        if (wolves(battle, unit).length || unit.mem.vigilReformed) return;
        unit.mem.vigilReformed = true;
        addWolves(battle, unit, VIGIL_MODULE_PACK);
      }, { targetUid: uid(unit) });
    }, { owner: unit });
  },
  lines: {
    0: ({ battle, unit }) => addWolves(battle, unit, VIGIL_PACK),
    1: 'cast',
    // 狼群天性：被狼群阻挡的敌人，此干员与狼群对其攻击无视 c 防御力
    2: {
      install: ({ battle, unit, p }) => battle.on('hit', ({ source, target, dmg }) => {
        if (!active(unit) || !dmg || target?.side !== 'enemy' || !(source === unit || (source?.ownerUnit === unit && source.defId === VIGIL_WOLF))) return;
        if (target.blockedBy?.ownerUnit === unit && target.blockedBy.defId === VIGIL_WOLF) dmg.defIgnoreFlat = (dmg.defIgnoreFlat ?? 0) + p('c');
      }, { owner: unit, priority: 90 }),
      run: () => {},
    },
    3: { options: { accept: (payload) => payload.target?.defId === VIGIL_WOLF }, run: ({ fx }) => { for (const x of fx.allies('allies:叙拉古')) fx.charge(x, VIGIL_CHARGE); } },
    4: ({ unit, p, fx }) => fx.growthCounter(unit, { key: VIGIL_GROWTH, label: '狼影攻击力', amount: p('d'), suffix: '%' }),
  },
  modules: {
    [VIGIL_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 缪尔赛思 ---
// Her 流形 (a summon) copies the strongest operator of the bench, then every other operator that 再部署; casts of your other
// 莱茵生命 raise its attack for the battle.

const MLYSS_FLOW = 'token_10030_mlyss_wtrman', MLYSS_ATK = 50, MLYSS_SECONDS = 15, MLYSS_PULL_EVERY = 2, MLYSS_BIND = 1.5, MLYSS_FACTOR = 0.9;
const MLYSS_DISCOUNT = 2, MLYSS_STACK = 3, MLYSS_COUNTER = 'mlyss-flow', MLYSS_MODULE = 'uniequip_003_mlyss', MLYSS_MODULE_CHARGE = 10;
const rhine = (x) => matchesClass(x, { label: '莱茵生命' });
const flowOf = (battle, unit) => battle.allyUnits.find((x) => x.kind === 'token' && x.ownerUnit === unit && x.defId === MLYSS_FLOW && active(x)) ?? null;
/** The bench's strongest attacker of the owner (owned pieces off the board), as a copy template; null when the bench is empty. */
function benchTemplate(battle, owner) {
  const list = [];
  for (const id of Object.keys(battle.data.raw?.chess ?? {})) {
    const record = battle.data.rawChess(id), piece = record?.assaultPiece;
    if (record?.assaultOwnerId !== owner.ownerId || !piece || piece.uid === uid(owner) || !String(piece.charId).startsWith('char_') || piece.row !== null || piece.col !== null) continue;
    const chess = battle.data.getChess(id), profile = chess && resolveProfile(chess, null);
    if (!chess || !profile || profile.noAttack || profile.noAttackUnlessSkill || !['melee', 'ranged'].includes(profile.attack) || !['phys', 'arts', 'true'].includes(profile.dmgType)) continue;
    list.push({ uid: piece.uid, stats: chess.stats, profile, rangeGrid: chess.rangeGrid, ranged: chess.position === 'RANGED', body: record.assaultBody });
  }
  return list.sort((a, b) => b.stats.atk - a.stats.atk || b.stats.maxHp - a.stats.maxHp || String(a.uid).localeCompare(String(b.uid)))[0] ?? null;
}
/** 流形复制: the flow takes the template's stats (× 0.9), attack and range; `refresh` fills its HP. */
function copyFlow(battle, owner, flow, template, { refresh = false, factor = MLYSS_FACTOR } = {}) {
  const ratio = refresh ? 1 : Math.max(0, Math.min(1, flow.hp / flow.s.maxHp));
  for (const stat of ['maxHp', 'atk', 'def', 'res']) if (Number.isFinite(template.stats[stat])) flow.base[stat] = template.stats[stat] * factor;
  for (const stat of ['bat', 'aspd', 'blockCnt']) if (Number.isFinite(template.stats[stat])) flow.base[stat] = template.stats[stat];
  flow.profile = { ...flow.profile, attack: template.ranged ? 'ranged' : 'melee', projectile: template.ranged ? 'bolt' : 'none',
    canHitFly: template.ranged || template.profile?.canHitFly === true, dmgType: template.profile?.dmgType === 'heal' ? flow.profile.dmgType : template.profile?.dmgType ?? 'phys', heal: null, noAttack: false, noAttackUnlessSkill: false };
  if (template.rangeGrid) flow.rangeGrid = template.rangeGrid;
  flow.markDirty();
  battle.refreshRange(flow);
  flow.hp = flow.s.maxHp * ratio;
  flow.mem.mlyssCopyOf = template.uid;
  flow.mem.mlyssCopyRhine = !!template.rhine;
  battle.fx('manifoldCopy', { x: flow.x, y: flow.y, id: flow.id, from: template.uid });
}
const unitTemplate = (x) => ({ uid: uid(x), stats: x.base, profile: x.profile, rangeGrid: x.rangeGrid, ranged: x.def?.position === 'RANGED', rhine: rhine(x) });
export { benchTemplate, copyFlow, unitTemplate };
// the flow's own kit (replaces the old one of its token): it copies the bench's strongest at its first deployment
const flowKit = () => ({ skill: { kind: 'passive', onStart() {} }, install(battle, flow) {
  const owner = flow.ownerUnit;
  linkReinforcement(battle, flow);
  const template = benchTemplate(battle, owner) ?? unitTemplate(owner);
  copyFlow(battle, owner, flow, template, { refresh: true });
} });

const mlyss = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.dp(cardParam(unit, 1, 'a'));
    fx.sustain(unit, { key: 'entropy', mods: { atkPct: MLYSS_ATK / 100 }, duration: MLYSS_SECONDS });
    const flow = flowOf(battle, unit);
    if (flow) fx.sustain(flow, { key: 'entropy', mods: { atkPct: MLYSS_ATK / 100 }, duration: MLYSS_SECONDS });
    return true;
  },
  install: (battle, unit) => {
    const during = () => hasBuff(unit, ':entropy');
    // 近战流形每 2 秒把周围 8 格敌人小力度拖向自己并晕眩阻挡的敌人
    let elapsed = 0;
    battle.every(0.25, () => {
      const flow = flowOf(battle, unit);
      if (!flow || !during() || flow.profile?.attack === 'ranged') { elapsed = 0; return; }
      elapsed += 0.25;
      if (elapsed + 1e-9 < MLYSS_PULL_EVERY) return;
      elapsed = 0;
      for (const e of aroundEnemies(battle, flow)) battle.pull(e, 0, { to: { x: flow.x, y: flow.y }, center: flow });
      for (const e of flow.blocking ?? []) if (e.alive) effects(battle, unit, { index: 'skill' }).status(e, { status: 'stun', duration: MLYSS_PULL_EVERY });
    }, { owner: unit });
    // 远程流形攻击附带 1.5 秒束缚
    battle.on('damaged', ({ source, target, dmg }) => {
      if (!during() || source !== flowOf(battle, unit) || source.profile?.attack !== 'ranged' || !dmg?.isAttack || target?.side !== 'enemy' || !target.alive) return;
      effects(battle, unit, { index: 'skill' }).status(target, { status: 'bind', duration: MLYSS_BIND });
    }, { owner: unit });
    // 开源节流：你的莱茵生命干员部署费用 -2
    battle.on('assaultDeploymentCost', (quote) => {
      if (active(unit) && quote.unit?.kind === 'op' && quote.unit.ownerId === unit.ownerId && rhine(quote.unit)) quote.amount = Math.max(0, quote.amount - MLYSS_DISCOUNT);
    }, { owner: unit });
    // 净水即生命：流形攻击力 +3% 每层
    battle.every(0.25, () => {
      const flow = flowOf(battle, unit), n = counterValue(battle, unit, MLYSS_COUNTER);
      if (flow && n) battle.addBuff(flow, { key: 'assault:mlyss:flow-stack', mods: { atkPct: n / 100 }, duration: 0.5 + 1e-6, refresh: 'replace', source: unit, visible: false });
    }, { owner: unit, immediate: true });
  },
  lines: {
    0: ({ battle, unit }) => grantSummon(battle, unit, { tokenId: MLYSS_FLOW, ruleKey: 'synergy-flow', count: 1, stockCap: 1, fieldCap: 1, cost: 0 }),
    1: 'cast',
    2: ({ battle, unit, actor }) => { const flow = flowOf(battle, unit); if (flow) copyFlow(battle, unit, flow, unitTemplate(actor), { refresh: true }); },
    3: () => {},
    4: ({ unit, fx }) => fx.counter(unit, { key: MLYSS_COUNTER, label: '流形攻击力', amount: MLYSS_STACK, suffix: '%' }),
  },
  modules: {
    // 落叶四季：流形复制莱茵生命干员时，该干员部署或再部署时充能 10
    [MLYSS_MODULE]: { options: { accept: (payload, ctx) => flowOf(ctx.battle, ctx.unit)?.mem.mlyssCopyOf === uid(ctx.actor) },
      run: ({ actor, fx }) => fx.charge(actor, MLYSS_MODULE_CHARGE) },
  },
});

// -------------------------------------------------------------------- 伊内丝 ---
// A deploy-cast passive: 独影归途 recalls her sentry through the enemies and sets it down again; every recall pushes your
// other operators' timers on; 影织 binds and robs every enemy she first hits, and their deaths by your other operators grow
// her for the run.

const INES_SECONDS = 16, INES_LINE = 6, INES_LINE_SCALE = 200, INES_DP = 1, INES_SLOW = 30;
const INES_MODULE = 'uniequip_002_ines', INES_MODULE_BIND = 5, INES_MODULE_STEAL = 120;

const ines = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.sustain(unit, { key: 'homeward', mods: { atkPct: cardParam(unit, 1, 'a') / 100 }, duration: INES_SECONDS });
    // 先收回场上的影哨（沿线伤害），再在原位放下新影哨
    const old = unit.mem.inesSentry;
    if (old) {
      fx.raw.synergy.removeZone(battle, unit, 'sentry');
      const line = battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden && (old.tiles.has(`${Math.round(e.y)},${Math.round(e.x)}`) || inRange(unit, e)))
        .sort(byExit(battle)).slice(0, INES_LINE);
      for (const e of line) fx.damage(e, { scale: INES_LINE_SCALE / 100, type: 'phys', isSkill: true });
      battle.assaultRuntime.publish('inesRecall', { source: unit, sourceUid: uid(unit) });
    }
    unit.mem.inesSentry = fx.raw.synergy.placeSentry(battle, unit, { slow: INES_SLOW / 100 });
    return true;
  },
  install: (battle, unit) => {
    // 期间每对一名敌人造成伤害获得 1 费用
    battle.on('damaged', ({ source, target, amount }) => {
      if (source === unit && active(unit) && hasBuff(unit, ':homeward') && target?.side === 'enemy' && amount > 0) effects(battle, unit, { index: 1 }).dp(INES_DP);
    }, { owner: unit });
    // 影哨：攻击范围内敌人隐匿失效、移动速度 -30%
    enemyAura(battle, unit, { key: 'ines-range', flags: { reveal: true }, mods: { moveMul: 1 - INES_SLOW / 100 }, select: (e) => inRange(unit, e) });
  },
  lines: {
    0: 'cast',
    1: 'cast',
    // 每次收回影哨（= every 再部署 of hers: 独影归途 recalls it），你的其他干员当前再部署时间 -b 秒（每 6 秒最多一次）
    2: ({ p, fx }) => fx.cutRedeploy({ seconds: p('b'), includeSelf: false }),
    3: {
      install: ({ battle, unit, p }) => {
        const robbed = new Set();
        unit.mem.inesRobbed = robbed;
        battle.on('damaged', ({ source, target, amount }) => {
          if (source !== unit || !active(unit) || target?.side !== 'enemy' || !target.alive || !(amount > 0) || robbed.has(target)) return;
          robbed.add(target);
          const module = moduleOf(unit) === INES_MODULE;
          const steal = module ? INES_MODULE_STEAL : p('d');
          const fx = effects(battle, unit, { index: 3 });
          battle.assaultRuntime.enqueue(() => {
            if (!target.alive) return;
            fx.status(target, { status: 'bind', duration: module ? INES_MODULE_BIND : p('c') });
            battle.addBuff(target, { key: `assault:ines:robbed:${uid(unit)}`, mods: { atkFlat: -steal }, duration: Infinity, source: unit });
            const own = unit.findBuff(`assault:ines:loot:${uid(target)}`);
            if (!own) battle.addBuff(unit, { key: `assault:ines:loot:${uid(target)}`, mods: { atkFlat: steal }, duration: Infinity, source: unit, visible: false });
          }, { targetUid: uid(target) });
        }, { owner: unit });
        // the loot lasts until the target falls or she leaves
        battle.on('death', ({ unit: gone }) => {
          if (gone === unit) { for (const b of unit.buffs.filter((x) => String(x.key).startsWith('assault:ines:loot:'))) battle.removeBuff(unit, b); return; }
          if (gone?.side === 'enemy') battle.removeBuff(unit, `assault:ines:loot:${uid(gone)}`);
        }, { owner: unit });
      },
      run: () => {},
    },
    4: { options: { accept: (payload, ctx) => ctx.unit.mem.inesRobbed?.has(payload.target) }, run: ({ unit, p, fx }) => fx.growth(unit, { key: 'shadow-weave', stat: 'atk', flat: p('e') }) },
  },
  modules: {
    [INES_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 格拉尼 ---
// Your 先锋 dodge; enemies your other operators lifted take more from her; every dodge of your other 先锋 stacks her
// defence.

const GRANI_DEPLOY_DODGE = 20, GRANI_DEPLOY_SECONDS = 10, GRANI_STATS = 80, GRANI_BLOCK = 1, GRANI_STACK = 1;
const GRANI_MODULE = 'uniequip_002_grani', GRANI_MODULE_DP = 2;

const grani = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => blocking(unit) || aroundEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'never-retreat', mods: { atkPct: GRANI_STATS / 100, defPct: GRANI_STATS / 100,
      blockCnt: GRANI_BLOCK, maxTargets: Math.max(0, Math.floor(unit.s.blockCnt + GRANI_BLOCK) - 1) }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  lines: {
    0: ({ fx }) => { for (const x of fx.allies('allies:先锋')) fx.buff(x, { key: 'deploy-dodge', mods: { dodgePhys: GRANI_DEPLOY_DODGE / 100 }, duration: GRANI_DEPLOY_SECONDS }); },
    1: 'cast',
    2: ({ battle, unit, p }) => liveAura(battle, unit, 'police', { select: vanguard, mods: () => ({ dodgePhys: p('b') / 100 }) }),
    3: {
      install: ({ battle, unit, p }) => battle.on('hit', ({ source, target, dmg }) => {
        if (ownAttack(unit, source, target, dmg) && byOthers(unit, target, ['levitate', 'weightless'])) dmg.amount *= p('c') / 100;
      }, { owner: unit, priority: 90 }),
      options: { accept: () => false },
      run: () => {},
    },
    4: ({ unit, fx }) => fx.stack(unit, { key: 'police', stat: 'def', amount: GRANI_STACK / 100, mode: 'percent' }),
  },
  modules: {
    // 骑警套装：击倒敌人后获得 2 费用
    [GRANI_MODULE]: {
      install: ({ battle, unit }) => bindTrigger(battle, unit, { event: 'kill', subject: 'self' }, { key: 'grani-module-kill' },
        ({ cause }) => effects(battle, unit, { index: `module:${GRANI_MODULE}` }, cause).dp(GRANI_MODULE_DP)),
      run: () => {},
    },
  },
});

// ------------------------------------------------------------------ 凛御银灰 ---
// His opening pushes on the other operator furthest from its 再部署; each cast pushes your other 谢拉格 on and arms an
// echo of its strike on the next deployment of your other operators; every other 再部署 speeds his SP up; 雪境先驱
// shields your 谢拉格 (doubled, and air blocking, after 15 s on the field).

const SVASH2_OPEN_CUT = 20, SVASH2_OPEN_CHARGE = 4, SVASH2_TARGETS = 6, SVASH2_COLD = 6, SVASH2_ECHO_MAX = 2, SVASH2_PIONEER = 15;
const kjerag = (x) => matchesClass(x, { label: '谢拉格' });
/** The source skill's 3-7 grid, anchored and rotated at the actual caster. */
const svash2Targets = (battle, unit, from=unit) => {
  const grid=unit.def.raw.assaultBody.fixedSkill.runtime.sourceRangeGrid;
  if(!grid?.length)throw new Error('御敌的锋锐 requires its native skill range');
  const keys=new Set(grid.map(([r,c])=>rotateOffset(r,c,from.dir)).map(([r,c])=>(from.tileR+r)*COLS+from.tileC+c));
  return battle.enemies.filter(enemy=>active(enemy)&&keys.has(roundHalfEven(enemy.y)*COLS+roundHalfEven(enemy.x)))
    .sort(byExit(battle)).slice(0,SVASH2_TARGETS);
};
function svash2Strike(battle, unit, from, fx, scale) {
  const targets = svash2Targets(battle, unit, from);
  if(from!==unit)battle.fx('skillEcho',{id:from.id,x:from.x,y:from.y,nativeUnit:'char_1045_svash2',skillId:'skchr_svash2_2',targets:targets.map(enemy=>enemy.id)});
  for (const e of targets) {
    fx.damage(e, { amount: from.s.atk * scale, type: 'phys', isSkill: true });
    if (!e.alive) continue;
    fx.status(e, { status: 'cold', duration: SVASH2_COLD });
    fx.buff(e, { key: 'edge-reveal', mods: {}, flags: { reveal: true }, duration: SVASH2_COLD });
  }
  return targets.length;
}
const pioneer = (battle, unit) => battle.time + 1e-9 >= (unit.deployedAt ?? 0) + SVASH2_PIONEER;
const svash2Recipients=(battle,unit)=>battle.allyUnits.filter(other=>other.kind==='op'&&other.ownerId===unit.ownerId&&other!==unit&&!other.removed);
const svash2Reserve=(unit,other)=>unit.mem.svash2Echoes?.[uid(other)]??0;

const svash2 = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => svash2Targets(battle, unit).length > 0 || svash2Recipients(battle,unit).some(other=>svash2Reserve(unit,other)<SVASH2_ECHO_MAX),
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    svash2Strike(battle, unit, unit, fx, cardParam(unit, 1, 'a') / 100);
    fx.cutRedeploy({ seconds: cardParam(unit, 2, 'b'), filter: { label: '谢拉格' }, includeSelf: false });
    const reserves=unit.mem.svash2Echoes??={};
    for(const other of svash2Recipients(battle,unit)) {
      const before=svash2Reserve(unit,other);reserves[uid(other)]=Math.min(SVASH2_ECHO_MAX,before+1);
      if(reserves[uid(other)]>before)fx.counter(other,{key:'svash2-ready',label:'待命协击',amount:1});
    }
    return true;
  },
  install: (battle, unit) => {
    // 你的其他干员下次部署或再部署时，以其攻击力施放一次本技能的范围效果（最多叠加 2 次）
    deployEffect(battle, unit, { key: 'svash2-echo', by: 'other', effect: ({ target, cause }) => {
      const count=svash2Reserve(unit,target);
      if(!count)return;
      unit.mem.svash2Echoes[uid(target)]=0;
      const fx=effects(battle, unit, { index: 2 }, cause);
      fx.counter(target,{key:'svash2-ready',label:'待命协击',amount:-count});
      for(let index=0;index<count;index++)battle.after(1.1+index*.5,()=>{
        if(active(target))svash2Strike(battle,unit,target,effects(battle,target,{index:'svash2-echo'},cause),cardParam(unit,1,'a')/100);
      },{owner:target});
    } });
    // 雪境先驱：你的谢拉格干员免疫冻结
    battle.on('beforeStatus', (ctx) => {
      if (ctx.status === 'freeze' && active(unit) && ctx.target?.side === 'ally' && ctx.target.kind === 'op' && relates(unit, ctx.target, 'yours') && kjerag(ctx.target)) ctx.cancel = true;
    }, { owner: unit });
  },
  lines: {
    // 开放性开局：你的其他干员中再部署计时剩余最长的 1 名，当前再部署时间 -20%，并充能 4
    0: ({ battle, unit, fx }) => {
      const [next] = yourOps(battle, unit, { others: true }).map((x) => [x, redeployRemaining(battle, x)]).filter(([, left]) => left != null)
        .sort((a, b) => b[1] - a[1] || uid(a[0]).localeCompare(uid(b[0])));
      if (!next) return;
      cutTimer(battle, next[0], { percent: SVASH2_OPEN_CUT / 100 });
      fx.charge(next[0], SVASH2_OPEN_CHARGE);
    },
    1: 'cast',
    2: 'cast',
    3: ({ unit, p, fx }) => fx.accelerate(unit, p('c')),
    4: ({ battle, unit, p }) => liveAura(battle, unit, 'pioneer', { select: kjerag, mods: () => {
      const n = pioneer(battle, unit) ? 2 : 1;
      return { defFlat: p('d') * n, hpRegenRatio: p('e') / 100 * n };
    } }),
    5: ({ fx }) => fx.airAura({ label: '谢拉格' }, { after: SVASH2_PIONEER }),
  },
});

// -------------------------------------------------------------------- 野鬃 ---
// A deploy-cast passive (ruled 10-21): 骑枪刺击 fires at every deployment and in-place 再部署; each of her deployments
// pushes your 近卫's timers on, every other operator's 再部署 stacks her attack for the battle.

const WILDMN_LANCE_SECONDS = 30, WILDMN_MODULE = 'uniequip_002_wildmn', WILDMN_MODULE_REDEPLOY = 2, WILDMN_MODULE_DP = 2;

const wildmn = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'lance', mods: { aspd: cardParam(unit, 1, 'a') }, duration: WILDMN_LANCE_SECONDS });
    return true;
  },
  lines: {
    0: 'cast',
    1: 'cast',
    2: ({ p, fx }) => fx.cutRedeploy({ seconds: p('b'), filter: { label: '近卫' }, includeSelf: false }),
    3: ({ unit, p, fx }) => fx.stack(unit, { key: 'forward', stat: 'atk', amount: p('c') / 100, mode: 'percent' }),
  },
  modules: {
    // 长枪替补套装：此干员再部署时间 -2 秒；击倒敌人后获得 2 费用
    [WILDMN_MODULE]: ({ battle, unit, fx }) => {
      if (!unit.mem.wildmnModuleShortened) { fx.redeployTime(unit, { seconds: WILDMN_MODULE_REDEPLOY }); unit.mem.wildmnModuleShortened = true; }
      if (!unit.mem.wildmnModuleKill) {
        unit.mem.wildmnModuleKill = true;
        bindTrigger(battle, unit, { event: 'kill', subject: 'self' }, { key: 'wildmn-module-kill' },
          ({ cause }) => effects(battle, unit, { index: `module:${WILDMN_MODULE}` }, cause).dp(WILDMN_MODULE_DP));
      }
    },
  },
});

export const synergySupportKits = Object.freeze({
  char_240_wyvern: wyvern,
  char_290_vigna: vigna,
  char_151_myrtle: myrtle,
  char_102_texas: texas,
  char_401_elysm: elysm,
  char_4119_wanqin: wanqin,
  char_497_ctable: ctable,
  char_4017_puzzle: puzzle,
  char_222_bpipe: bpipe,
  char_181_flower: flower,
  char_385_finlpp: finlpp,
  char_128_plosis: plosis,
  char_4163_rosesa: rosesa,
  char_108_silent: silent,
  char_171_bldsk: bldsk,
  char_4196_reckpr: reckpr,
  char_4114_harold: harold,
  char_494_vendla: vendla,
  char_4139_papyrs: papyrs,
  char_4222_taraxa: taraxa,
  char_4042_lumen: lumen,
  char_1016_agoat2: agoat2,
  char_1020_reed2: reed2,
  char_4056_titi: titi,
  char_4179_monstr: monstr,
  char_202_demkni: demkni,
  char_199_yak: yak,
  char_150_snakek: snakek,
  char_381_bubble: bubble,
  char_196_sunbr: sunbr,
  char_107_liskam: liskam,
  char_4137_udflow: udflow,
  char_4207_branch: branch,
  char_431_ashlok: ashlok,
  char_4148_philae: philae,
  char_136_hsguma: hsguma,
  char_423_blemsh: blemsh,
  char_2025_shu: shu,
  char_311_mudrok: mudrok,
  char_4065_judge: judge,
  char_416_zumama: zumama,
  char_4039_horn: horn,
  char_1034_jesca2: jesca2,
  char_4194_rmixer: rmixer,
  char_2026_yu: yu,
  char_349_chiave: chiave,
  char_112_siege: siege,
  char_4026_vulpis: vulpis,
  char_479_sleach: sleach,
  char_420_flamtl: flamtl,
  char_427_vigil: vigil,
  char_249_mlyss: mlyss,
  char_4087_ines: ines,
  char_220_grani: grani,
  char_1045_svash2: svash2,
  // summons of the cards above (their token kits)
  [SILENT_DRONE]: () => droneKit(),
  [MONSTR_TOKEN]: () => reconstructionKit(),
  [JESCA2_SHIELD]: () => mobileShieldKit(),
  [VIGIL_WOLF]: () => wolfKit(),
  [MLYSS_FLOW]: () => flowKit(),
  char_496_wildmn: wildmn,
});
