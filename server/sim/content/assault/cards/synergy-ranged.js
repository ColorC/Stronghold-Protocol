// Synergy cards of the ranged family (design of 2026-10-21, design-172.json via tools/assault/import-synergy-design.mjs).
// See synergy-assault.js for the conventions: one kit per card, one handler per card line, numbers from the card params.

import { synergyKit, cardParam, effects, moduleOf, around8, bindTrigger, isFlyer, isElite } from '../card-lines.js';
import { allyAura, enemyAura, matchesClass, hasStatus, withinAdjacent4, counterValue, isWanted, slowEnemyProjectiles, endEnemyProjectileSlow, clearEnemyProjectiles } from '../synergy.js';
import { active, enemies, uid, watch } from '../primitives.js';
import { grantSummon, returnSummon, ledgerFor } from '../summons.js';
import { rangedEliteTokenKits } from './ranged-elite/tokens.js';
import { COLS } from '../../../constants.js';
import { DIR_VEC, normDir } from '../../../dir.js';
import { powi } from '../../../detmath.js';

const rangeEnemies = (battle, unit, count = 99, anchor = unit) => enemies(battle, unit, { scope: 'range', count, anchor });

// ------------------------------------------------------------------ shared shapes of the family ---
// 攻击间隔 words of the card text → the attack-interval change they mean (batPct; −0.5 = half the interval)
const INTERVAL = Object.freeze({ slight: -0.15, shorter: -0.3, much: -0.45, large: -0.55, huge: -0.7, longer: 0.5 });

const tileOf = (x) => [x?.side === 'ally' && Number.isFinite(x.tileR) ? x.tileR : Math.round(x?.y), x?.side === 'ally' && Number.isFinite(x.tileC) ? x.tileC : Math.round(x?.x)];
/** Is `x` (an enemy or an operator) on a tile of `unit`'s attack range now? */
function inRangeOf(unit, x) {
  const [r, c] = tileOf(x);
  return new Set(unit.rangeKeys ?? []).has(r * COLS + c);
}
const positionOf = (x) => x?.def?.raw?.assaultBody?.position ?? null;
const isOp = (x) => x?.side === 'ally' && x.kind === 'op';
/** Your operators on the field in `unit`'s attack range (the unit itself too when it stands in it). */
const rangeAllies = (battle, unit, { others = false } = {}) => battle.assaultDeploymentOrder()
  .filter((x) => isOp(x) && active(x) && x.ownerId === unit.ownerId && (!others || x !== unit) && inRangeOf(unit, x));
/** Is a buff whose key contains `part` on `unit` now? */
const hasBuff = (unit, part) => !!unit?.buffs?.some((b) => String(b.key).includes(part) && !(b.timeLeft <= 0));
/** The tiles `n` ahead of the unit (its facing), nearest first. */
function aheadTiles(unit, n) {
  const [dr, dc] = unit.fwd ?? DIR_VEC[normDir(unit.dir)];
  return Array.from({ length: n }, (_, i) => [unit.tileR + dr * (i + 1), unit.tileC + dc * (i + 1)]);
}
const enemiesOn = (battle, tiles) => battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden
  && tiles.some(([r, c]) => Math.round(e.y) === r && Math.round(e.x) === c));
/** Enemies around `center` (its tile and the 8 around), nearest the exit first. */
const enemiesAround = (battle, center, count = 99) => battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden && around8(center, e))
  .sort((a, b) => battle.remainingDistance(a) - battle.remainingDistance(b) || uid(a).localeCompare(uid(b))).slice(0, count);

/**
 * The unit's own damage as it lands (the native `hit` hook, before mitigation): `fn({ target, dmg })` may scale
 * `dmg.amount` (攻击力提升至 x%), `dmg.mul` (伤害提升), add penetration. `attacksOnly`: its attacks (a skill's「下次攻击」
 * included), not the damage of its other effects.
 */
function onOwnDamage(battle, unit, fn, { attacksOnly = true, priority = 100 } = {}) {
  battle.on('hit', ({ source, target, dmg }) => {
    if (source !== unit || !active(unit) || !dmg || dmg.type === 'element' || target?.side !== 'enemy') return;
    if (attacksOnly && !dmg.isAttack && !dmg.isSkill) return;
    fn({ target, dmg });
  }, { owner: unit, priority });
}
/** The unit's normal attacks as they happen (the native `attack` hook): `fn({ targets, attackId })`. */
function onOwnAttack(battle, unit, fn) {
  battle.on('attack', ({ attacker, targets, isSkill, attackId }) => {
    if (attacker !== unit || isSkill || !active(unit)) return;
    fn({ targets: (targets ?? []).filter((t) => t?.side === 'enemy'), attackId });
  }, { owner: unit });
}
/** A self buff that holds while `cond()` does (checked every 0.25 s and at each deployment). */
function selfWhile(battle, unit, key, mods, cond, flags = null) {
  const buffKey = `assault:while:${uid(unit)}:${key}`;
  const sync = () => {
    const on = active(unit) && cond();
    const has = unit.buffs.some((b) => b.key === buffKey);
    if (on && !has) battle.addBuff(unit, { key: buffKey, mods, flags, duration: Infinity, refresh: 'replace', source: unit });
    else if (!on && has) battle.removeBuff(unit, buffKey);
  };
  battle.every(0.25, sync, { owner: unit, immediate: true });
  return sync;
}
/** One more hit of the unit's normal attack on `target` (连射 / 二连击): an attack instance of the same attack. */
function extraHit(battle, unit, target, { attackId = 0, scale = 1, cause = null } = {}) {
  if (!target?.alive) return 0;
  const type = unit.profile?.dmgType === 'arts' ? 'arts' : unit.profile?.dmgType === 'true' ? 'true' : 'phys';
  return battle.assaultRuntime.withCause(cause, () => battle.dealDamage(unit, target, { amount: unit.s.atk * (unit.profile?.atkScale ?? 1) * scale, type, isAttack: true, attackId }));
}
/**
 * `onEnd()` once the unit's timed skill buff (key part `part`) has run out — checked every 0.25 s; a recast that refreshes
 * the buff moves the end, and one watcher serves every cast.
 */
function whenSkillEnds(battle, unit, part, onEnd) {
  const flag = `assaultSkillEnd:${part}`;
  if (unit.mem[flag]) return;
  unit.mem[flag] = true;
  const timer = battle.every(0.25, () => {
    if (hasBuff(unit, part)) return;
    timer.cancel();
    unit.mem[flag] = false;
    onEnd();
  }, { owner: unit });
}
/** Up to `count` enemies chained from `first`: each next one the nearest unvisited within `radius` tiles. */
function chainFrom(battle, first, count, radius = 1.75) {
  const out = first ? [first] : [];
  while (out.length && out.length < count) {
    const last = out.at(-1);
    const d2 = (e) => (e.x - last.x) * (e.x - last.x) + (e.y - last.y) * (e.y - last.y);
    const next = battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden && !out.includes(e) && d2(e) <= radius * radius)
      .sort((a, b) => d2(a) - d2(b) || uid(a).localeCompare(uid(b)))[0];
    if (!next) break;
    out.push(next);
  }
  return out;
}
const isNormalAttack = (payload) => payload.skillId == null && typeof payload.attackId === 'number' && payload.attackId > 0;
/** A skill that only pays off on enemies waits for one in range (cast-needs-enemy). */
const enemyInRange = ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0;
/** The 「下次攻击」 of a skill, cast now on the first enemy in range: one hit of `scale` × ATK. */
function nextAttack(battle, unit, fx, { scale, type, ...rest }) {
  const target = rangeEnemies(battle, unit, 1)[0];
  if (!target) return null;
  fx.damage(target, { scale, type, isSkill: true, ...rest });
  return target;
}

// ---------------------------------------------------------------- 莫斯提马 ---
// 荒时之锁 stuns the whole range and pushes every other operator's 再部署 timer on; her aura speeds the 术师 up and
// your other operators' stuns / 停顿 / 寒冷 charge her.

const MOSTMA_MODULE = 'uniequip_002_mostma', MOSTMA_MODULE_STUN = 1, MOSTMA_MODULE_DAMAGE = 15;

const mostma = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const module = moduleOf(unit) === MOSTMA_MODULE;
    const seconds = cardParam(unit, 1, 'b') + (module ? MOSTMA_MODULE_STUN : 0);
    const scale = (cardParam(unit, 1, 'c') + (module ? MOSTMA_MODULE_DAMAGE : 0)) / 100;
    const targets = rangeEnemies(battle, unit);
    for (const e of targets) fx.status(e, { status: 'stun', duration: seconds });
    // 期间每秒受到法术伤害: one tick a second for the whole stun
    let ticks = 0;
    const timer = battle.every(1, () => {
      ticks++;
      for (const e of targets) if (e.alive && !e.removed) fx.damage(e, { scale, type: 'arts', isSkill: true });
      if (ticks >= Math.round(seconds)) timer.cancel();
    }, { owner: unit });
    fx.cutRedeploy({ seconds: cardParam(unit, 2, 'd'), includeSelf: false });
    return targets.length > 0;
  },
  lines: {
    0: ({ p, fx }) => { for (const x of fx.allies('allies:术师')) fx.accelerate(x, p('a')); },
    1: 'cast',
    2: 'cast',
    3: ({ battle, unit, p }) => allyAura(battle, unit, { key: 'caster-sp', mods: { spRecoveryFlat: p('e') },
      select: (x) => x !== unit && matchesClass(x, { label: '术师' }) }),
    4: {
      install: ({ battle, unit, p }) => enemyAura(battle, unit, { key: 'slow', mods: { moveMul: 1 - p('f') / 100 },
        select: (e) => rangeEnemies(battle, unit).includes(e) }),
      options: { statuses: ['stun', 'sluggish', 'cold'] },
      run: ({ unit, fx }) => fx.charge(unit, 1),
    },
  },
  modules: {
    // 锁与匙之家：荒时之锁晕眩 +1 秒，每秒伤害再 +15% — read by the cast above
    [MOSTMA_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 令 ---
// Her summons come at every deployment (and every in-place 再部署); 笑鸣瑟 recalls the hurt ones, each recall puts the
// enemies around it to sleep and charges your lowest-SP operator. Other operators' summons falling or being recalled
// grow her for the run.

const LING_MODULE = 'uniequip_002_ling';
const LING_POOL = 5, LING_FIELD = 3, LING_MODULE_POOL = 3, LING_MODULE_FIELD = 1, LING_STRIKE_TARGETS = 2, LING_BIND = 3;
const lingPool = (unit) => {
  const module = moduleOf(unit) === LING_MODULE;
  return { stockCap: LING_POOL + (module ? LING_MODULE_POOL : 0), fieldCap: LING_FIELD + (module ? LING_MODULE_FIELD : 0) };
};
function lingToken(unit) {
  const body = unit.def.raw.assaultBody;
  const tokenId = body.source?.skills?.find((s) => s.skillId === body.fixedSkill.sourceSkillId)?.overrideTokenKey;
  if (!tokenId || !rangedEliteTokenKits[tokenId]) throw new TypeError(`${body.charId}: no native summon template for its skill`);
  return tokenId;
}
const lingSummons = (battle, unit) => battle.allyUnits.filter((x) => x.kind === 'token' && x.ownerUnit === unit && x.defId === lingToken(unit) && active(x));
const spTotal = (x) => (x.skill?.sp ?? 0) + (x.skill?.charges ?? 0) * (x.skill?.spCost ?? 0);

const ling = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const scale = cardParam(unit, 1, 'a') / 100;
    let hit = 0;
    for (const actor of [unit, ...lingSummons(battle, unit)]) for (const e of rangeEnemies(battle, unit, LING_STRIKE_TARGETS, actor)) {
      fx.damage(e, { scale, type: 'arts', isSkill: true });
      if (e.alive) fx.status(e, { status: 'bind', duration: LING_BIND });
      hit++;
    }
    // 结束时回收生命低于一半的召唤物; each recall: 其周围敌人沉睡, your other operator lowest in SP 充能
    for (const token of lingSummons(battle, unit).filter((x) => x.hp < x.s.maxHp * 0.5)) {
      const around = battle.enemies.filter((e) => e.alive && !e.removed && around8(token, e));
      if (!returnSummon(battle, unit, token, 'lingRecall')) continue;
      for (const e of around) fx.status(e, { status: 'sleep', duration: cardParam(unit, 2, 'b') });
      const lowest = fx.allies('otherAllies').filter((x) => x.skill && !x.skill.noSkill && x.skill.kind !== 'passive')
        .sort((a, b) => spTotal(a) - spTotal(b) || uid(a).localeCompare(uid(b)))[0];
      if (lowest) fx.charge(lowest, cardParam(unit, 2, 'c'));
    }
    return hit > 0 || lingSummons(battle, unit).length > 0;
  },
  lines: {
    0: ({ battle, unit }) => grantSummon(battle, unit, { tokenId: lingToken(unit), count: 1, ...lingPool(unit), ruleKey: `ling:${uid(unit)}:deploy`,
      kit: rangedEliteTokenKits[lingToken(unit)] }),
    1: 'cast',
    2: 'cast',
    // 挑灯问梦：5 个召唤物、同时 3 个 — the pool every summon of hers reads (lingPool); the summons' attack is the native
    // arts attack of her S2 template
    3: () => {},
    4: ({ unit, p, fx }) => fx.charge(unit, p('d')),
    5: {
      // 「被击倒或回收」: the recall (summonReturned) counts as well as the fall the line is bound to
      install: ({ battle, unit, p }) => bindTrigger(battle, unit, { event: 'summonReturned', subject: 'otherAllies' }, { key: 'ling-growth-return' },
        ({ cause }) => effects(battle, unit, { index: 5 }, cause).growth(unit, { key: 'summon-fall', stat: 'atk', percent: p('e') / 100 })),
      run: ({ unit, p, fx }) => fx.growth(unit, { key: 'summon-fall', stat: 'atk', percent: p('e') / 100 }),
    },
  },
  modules: {
    // 诗短梦长：召唤物持有上限 +3，同时部署上限 +1 — read by lingPool
    [LING_MODULE]: () => {},
  },
});

// ------------------------------------------------------------- 正义骑士号 ---
// A deploy-cast passive: 正义助威 covers the 远程 operators in range and makes the flyers there 脆弱; every deployment
// of your other 卡西米尔 brings DP and the cheer again, and stacks her attack.

function jnightCheer(battle, unit, cause) {
  const fx = effects(battle, unit, { index: 'skill' }, cause);
  const seconds = cardParam(unit, 1, 'a');
  for (const x of rangeAllies(battle, unit)) if (positionOf(x) === 'RANGED') fx.sustain(x, { key: 'cheer', mods: { taunt: -1 }, duration: seconds });
  for (const e of rangeEnemies(battle, unit)) if (isFlyer(e)) fx.status(e, { status: 'fragile', duration: seconds, value: cardParam(unit, 2, 'b') / 100 });
  return true;
}

const jnight = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => jnightCheer(battle, unit, cause),
  lines: {
    0: 'cast',
    1: 'cast',
    2: 'cast',
    3: ({ battle, unit, p, fx, cause }) => { fx.dp(p('c')); jnightCheer(battle, unit, cause); },
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'chivalry', stat: 'atk', amount: p('d') / 100, mode: 'percent' }),
  },
});

// ------------------------------------------------------------------- 格雷伊 ---
// 静电场: every attack 停顿 its target (doubled while 静电释放 runs); your other operators' 停顿 charge him and stack his
// attack speed.

const GREYY_FIELD = 0.6, GREYY_MODULE = 'uniequip_002_greyy', GREYY_MODULE_FIELD = 1, GREYY_DEPLOY_STOP = 1;

const greyy = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'static', mods: { aspd: cardParam(unit, 1, 'c') }, duration: cardParam(unit, 1, 'b') });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => {
      for (const e of rangeEnemies(battle, unit)) {
        fx.damage(e, { scale: p('a') / 100, type: 'arts' });
        if (e.alive) fx.status(e, { status: 'sluggish', duration: GREYY_DEPLOY_STOP });
      }
    },
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit }) => onOwnAttack(battle, unit, ({ targets }) => {
        const fx = effects(battle, unit, { index: 3 });
        const seconds = (moduleOf(unit) === GREYY_MODULE ? GREYY_MODULE_FIELD : GREYY_FIELD) * (hasBuff(unit, ':skill:static') ? 2 : 1);
        for (const e of targets) if (e.alive) fx.status(e, { status: 'sluggish', duration: seconds });
      }),
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.charge(unit, p('d')),
    5: ({ unit, p, fx }) => fx.stack(unit, { key: 'static-field', stat: 'aspd', amount: p('e') }),
  },
  modules: {
    // 新的开始：静电场的停顿改为 1 秒 — read by line 3
    [GREYY_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 协律 ---
// 反拍重音 (cast at every deployment, stored twice) answers the skills of the operators in his range: each charges him
// and stacks his attack.

const AKKORD_MODULE = 'uniequip_002_akkord', AKKORD_MODULE_FAR = 1.1, AKKORD_MODULE_SPLASH = 0.5;

const akkord = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => !!nextAttack(battle, unit, effects(battle, unit, { index: 'skill' }, cause), { scale: cardParam(unit, 1, 'a') / 100, type: 'arts' }),
  lines: {
    0: 'cast',
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => selfWhile(battle, unit, 'pulse', { atkPct: p('b') / 100 }, () => rangeAllies(battle, unit, { others: true }).length > 0),
      run: () => {},
    },
    3: { options: { around: 'range' }, run: ({ unit, p, fx }) => fx.charge(unit, p('c')) },
    4: { options: { around: 'range' }, run: ({ unit, p, fx }) => fx.stack(unit, { key: 'pulse', stat: 'atk', amount: p('d') / 100, mode: 'percent' }) },
  },
  modules: {
    // 移动八音盒：攻击造成超远距离的群体法术伤害（[ASSUMED] 主目标周围 8 格的敌人受到一半伤害），距离越远伤害越高（最高 110%）
    [AKKORD_MODULE]: ({ battle, unit }) => {
      if (unit.mem.akkordModule) return;
      unit.mem.akkordModule = true;
      const reach = Math.max(1, ...[...unit.rangeKeys].map((k) => Math.abs(Math.floor(k / COLS) - unit.tileR) + Math.abs((k % COLS) - unit.tileC)));
      onOwnDamage(battle, unit, ({ target, dmg }) => {
        if (!dmg.isAttack) return;
        const [r, c] = tileOf(target);
        dmg.mul *= 1 + (AKKORD_MODULE_FAR - 1) * Math.min(1, (Math.abs(r - unit.tileR) + Math.abs(c - unit.tileC)) / reach);
      });
      onOwnAttack(battle, unit, ({ targets, attackId }) => {
        const main = targets[0];
        if (!main) return;
        for (const e of enemiesAround(battle, main)) if (e !== main) extraHit(battle, unit, e, { attackId, scale: AKKORD_MODULE_SPLASH });
      });
    },
  },
});

// -------------------------------------------------------------------- 深靛 ---
// 柔光缚目 binds what she hits and looks past the bound; 光影迷宫 triples it and burns every bound enemy in range. Your
// other operators' binds charge her; their kills of bound enemies grow her for the run.

const INDIGO_BIND = 4, INDIGO_DEPLOY_BIND = 3, INDIGO_DEPLOY_TARGETS = 2, INDIGO_MAZE_TICK = 0.5, INDIGO_MAZE_SCALE = 0.2, INDIGO_MAZE_CHANCE = 3;
const INDIGO_MODULE = 'uniequip_002_indigo', INDIGO_MODULE_CHANCE = 5;

const indigo = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const seconds = cardParam(unit, 1, 'a');
    fx.sustain(unit, { key: 'maze', mods: { batPct: INTERVAL.shorter }, duration: seconds });
    // one burning tick a 0.5 s for the bound enemies in range while the maze runs (a recast keeps the one ticker)
    if (!unit.mem.indigoMaze || unit.mem.indigoMaze.cancelled) {
      unit.mem.indigoMaze = battle.every(INDIGO_MAZE_TICK, () => {
        if (!hasBuff(unit, ':skill:maze')) { unit.mem.indigoMaze.cancel(); return; }
        const tick = effects(battle, unit, { index: 'skill' });
        for (const e of rangeEnemies(battle, unit)) if (hasStatus(e, 'bind')) tick.damage(e, { scale: INDIGO_MAZE_SCALE, type: 'arts', isSkill: true });
      }, { owner: unit });
    }
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const e of rangeEnemies(battle, unit, INDIGO_DEPLOY_TARGETS)) fx.status(e, { status: 'bind', duration: INDIGO_DEPLOY_BIND }); },
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit, p }) => {
        // 不以束缚的敌人为攻击目标: a bound pick gives way to an unbound enemy in range
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || ctx.isSkill || !ctx.targets?.length || !ctx.targets.every((t) => hasStatus(t, 'bind'))) return;
          const free = rangeEnemies(battle, unit).find((e) => !hasStatus(e, 'bind'));
          if (free) ctx.targets = [free];
        }, { owner: unit });
        onOwnAttack(battle, unit, ({ targets }) => {
          const chance = (p('b') + (moduleOf(unit) === INDIGO_MODULE ? INDIGO_MODULE_CHANCE : 0)) / 100 * (hasBuff(unit, ':skill:maze') ? INDIGO_MAZE_CHANCE : 1);
          const fx = effects(battle, unit, { index: 3 });
          for (const e of targets) if (e.alive && battle.rng() < chance) fx.status(e, { status: 'bind', duration: INDIGO_BIND });
        });
      },
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.charge(unit, p('c')),
    5: {
      options: { accept: (payload) => hasStatus(payload.target, 'bind') },
      run: ({ unit, p, fx }) => fx.growth(unit, { key: 'lighthouse', stat: 'atk', percent: p('d') / 100 }),
    },
  },
  modules: {
    // 法杖保养套装：柔光缚目几率再 +5% — read by line 3
    [INDIGO_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------- 杰西卡 ---
// A fast shooter that the team feeds: barriers given to the others charge her, every other skill stacks her speed.

const JESICA_DEPLOY_SECONDS = 8, JESICA_MODULE = 'uniequip_002_jesica', JESICA_MODULE_ASPD = 16, JESICA_MODULE_ATK = 0.06;

const jesica = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => !!nextAttack(battle, unit, effects(battle, unit, { index: 'skill' }, cause), { scale: cardParam(unit, 1, 'b') / 100, type: 'phys' }),
  lines: {
    0: ({ unit, p, fx }) => fx.sustain(unit, { key: 'deploy-aspd', mods: { aspd: p('a') }, duration: JESICA_DEPLOY_SECONDS }),
    1: 'cast',
    2: ({ unit, p, fx }) => fx.buff(unit, { key: 'magazine', mods: { aspd: p('c') }, persist: true }),
    3: ({ unit, fx }) => fx.charge(unit, 1),
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'magazine', stat: 'aspd', amount: p('d') }),
  },
  modules: {
    [JESICA_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'order', mods: { aspd: JESICA_MODULE_ASPD, atkPct: JESICA_MODULE_ATK }, persist: true }),
  },
});

// -------------------------------------------------------------------- 流星 ---
// 碎甲击 at every deployment; 空射专精 hits flyers and lifted enemies harder, and every lift by your other operators
// stacks her attack.

const SHOTST_DEF_SECONDS = 5, SHOTST_MODULE = 'uniequip_002_shotst', SHOTST_MODULE_AIR = 155, SHOTST_MODULE_COOLDOWN = 2;
const airborne = (e) => isFlyer(e) || hasStatus(e, 'levitate') || hasStatus(e, 'weightless');

const shotst = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = nextAttack(battle, unit, fx, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys' });
    if (!target) return false;
    if (target.alive) fx.status(target, { status: 'defDown', duration: SHOTST_DEF_SECONDS, value: cardParam(unit, 1, 'b') / 100 });
    // 猎刀：碎甲击命中时，为相邻干员充能 1（每 2 秒最多一次）
    if (moduleOf(unit) === SHOTST_MODULE && !(battle.time + 1e-9 < (unit.mem.shotstModuleAt ?? -Infinity) + SHOTST_MODULE_COOLDOWN)) {
      unit.mem.shotstModuleAt = battle.time;
      for (const x of fx.allies('adjacentAllies')) fx.charge(x, 1);
    }
    return true;
  },
  lines: {
    0: 'cast',
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => onOwnDamage(battle, unit, ({ target, dmg }) => {
        if (!airborne(target)) return;
        const pct = moduleOf(unit) === SHOTST_MODULE && isFlyer(target) ? SHOTST_MODULE_AIR : p('c');
        dmg.amount *= pct / 100;
      }),
      run: () => {},
    },
    3: { options: { statuses: ['levitate', 'weightless'] }, run: ({ unit, p, fx }) => fx.stack(unit, { key: 'air-shot', stat: 'atk', amount: p('d') / 100, mode: 'percent' }) },
  },
  modules: {
    // 猎刀 — read by line 2 and the cast
    [SHOTST_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 红云 ---
// Every kill of your other operators hastes her; the 叙拉古 kills stack her attack.

const CLOUR_DEPLOY_TARGETS = 2, CLOUR_SP = 0.3, CLOUR_MODULE = 'uniequip_002_clour', CLOUR_MODULE_SP = 0.4;

const clour = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'twin-string', mods: { atkPct: cardParam(unit, 1, 'c') / 100, maxTargets: 1 },
      duration: cardParam(unit, 1, 'b') });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of rangeEnemies(battle, unit, CLOUR_DEPLOY_TARGETS)) fx.damage(e, { scale: p('a') / 100, type: 'phys' }); },
    1: 'cast',
    2: ({ unit, fx }) => fx.buff(unit, { key: 'hunter-sp', mods: { spRecoveryFlat: CLOUR_SP }, persist: true }),
    3: ({ unit, p, fx }) => fx.accelerate(unit, p('d')),
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'hunter', stat: 'atk', amount: p('e') / 100, mode: 'percent' }),
  },
  modules: {
    [CLOUR_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'module-sp', mods: { spRecoveryFlat: CLOUR_MODULE_SP }, persist: true }),
  },
});

// -------------------------------------------------------------------- 松果 ---
// A battery: every deployment of your other operators charges her, the 哥伦比亚 ones stack her attack; her own
// deployment speeds up the SP of everyone around her.

const PINECN_DEPLOY_SECONDS = 20, PINECN_MODULE = 'uniequip_002_pinecn', PINECN_MODULE_DEF = 160;

const pinecn = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => !!nextAttack(battle, unit, effects(battle, unit, { index: 'skill' }, cause), { scale: cardParam(unit, 1, 'b') / 100, type: 'phys',
    defIgnoreFlat: cardParam(unit, 1, 'c') + (moduleOf(unit) === PINECN_MODULE ? PINECN_MODULE_DEF : 0) }),
  lines: {
    0: ({ battle, unit, p, fx }) => {
      for (const x of battle.assaultDeploymentOrder()) if (isOp(x) && active(x) && x.ownerId === unit.ownerId && withinAdjacent4(unit, x))
        fx.spAura(x, p('a'), { duration: PINECN_DEPLOY_SECONDS });
    },
    1: 'cast',
    2: ({ unit, p, fx }) => fx.charge(unit, p('d')),
    3: ({ unit, p, fx }) => fx.stack(unit, { key: 'battery', stat: 'atk', amount: p('e') / 100, mode: 'percent' }),
  },
  modules: {
    // 移动电箱：RMA长钉额外无视 160 防御 — read by the cast
    [PINECN_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 酸糖 ---
// 滑射技巧: no attack of hers lands for less than a floor of her attack; the skills of her neighbours charge her and
// stack her attack.

const ACDROP_FLOOR_ID = 'acdrop-floor', ACDROP_AHEAD = 2, ACDROP_DEPLOY_HITS = 2, ACDROP_FRONT_FLOOR = 15, ACDROP_MODULE = 'uniequip_002_acdrop', ACDROP_MODULE_REDEPLOY = 2, ACDROP_MODULE_FLOOR = 10;

const acdrop = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'trigger-time', mods: { atkPct: cardParam(unit, 1, 'c') / 100 }, duration: cardParam(unit, 1, 'b') });
    return true;
  },
  install: (battle, unit) => onOwnAttack(battle, unit, ({ targets, attackId }) => {
    // 扳机时刻：攻击变为 2 连射 — the second shot of each attack while the skill runs
    if (hasBuff(unit, ':skill:trigger-time')) for (const e of targets) extraHit(battle, unit, e, { attackId });
  }),
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of enemiesOn(battle, aheadTiles(unit, ACDROP_AHEAD))) fx.damage(e, { scale: p('a') / 100, type: 'phys', hits: ACDROP_DEPLOY_HITS }); },
    1: 'cast',
    2: {
      // the floor: an attack of hers that removed less than d% of her ATK (+15% on the two tiles ahead, +10% with the
      // module) is topped up with true damage to that floor
      install: ({ battle, unit, p }) => bindTrigger(battle, unit, { event: 'hit', subject: 'self' },
        // her attacks only: an attack's instances carry the numeric attack id (effects carry their own key)
        { key: ACDROP_FLOOR_ID, accept: (payload) => payload.skillId == null && typeof payload.attackId === 'number' && payload.attackId > 0 },
        ({ payload, cause }) => {
          const e = payload.target;
          const ahead = enemiesOn(battle, aheadTiles(unit, ACDROP_AHEAD)).includes(e);
          const floor = unit.s.atk * (p('d') + (ahead ? ACDROP_FRONT_FLOOR : 0) + (moduleOf(unit) === ACDROP_MODULE ? ACDROP_MODULE_FLOOR : 0)) / 100;
          const missing = floor - (payload.amount ?? 0);
          if (missing > 1e-6 && e?.alive) battle.assaultRuntime.withCause(cause, () => battle.dealDamage(unit, e, { amount: missing, type: 'true', attackId: ACDROP_FLOOR_ID }));
        }),
      run: () => {},
    },
    3: ({ unit, p, fx }) => fx.charge(unit, p('e')),
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'slide', stat: 'atk', amount: p('f') / 100, mode: 'percent' }),
  },
  modules: {
    // “自由、洋葱圈和我”：再部署时间 -2 秒（之后每轮）；保底伤害再 +10%（read by line 2）
    [ACDROP_MODULE]: ({ unit, fx }) => {
      if (unit.mem.acdropModuleShortened) return;
      unit.mem.acdropModuleShortened = true;
      fx.redeployTime(unit, { seconds: ACDROP_MODULE_REDEPLOY });
    },
  },
});

// -------------------------------------------------------------------- 跃跃 ---
// 戏耍随心 procs charge her neighbours; their skills make her next attack a sure proc, their 再部署 stack her attack.

const CAPER_CHANCE = 25, CAPER_DEPLOY_PROCS = 3, CAPER_MODULE = 'uniequip_002_caper', CAPER_MODULE_CHANCE = 30, CAPER_MODULE_SCALE = 170;

const caper = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => !!nextAttack(battle, unit, effects(battle, unit, { index: 'skill' }, cause), { scale: cardParam(unit, 1, 'a') / 100, type: 'phys' }),
  lines: {
    0: ({ unit }) => { unit.mem.caperSure = (unit.mem.caperSure ?? 0) + CAPER_DEPLOY_PROCS; },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => {
        const procs = unit.mem.caperProcs ??= new Set();
        const rolled = new Map();
        onOwnDamage(battle, unit, ({ dmg }) => {
          if (!dmg.isAttack || dmg.isSkill) return;
          // one roll per attack (a boomerang may land on more than one enemy)
          if (!rolled.has(dmg.attackId)) {
            const module = moduleOf(unit) === CAPER_MODULE;
            let proc;
            if ((unit.mem.caperSure ?? 0) > 0) { unit.mem.caperSure--; proc = true; } else proc = battle.rng() < (module ? CAPER_MODULE_CHANCE : CAPER_CHANCE) / 100;
            rolled.clear();
            rolled.set(dmg.attackId, proc);
            if (proc) procs.add(dmg.attackId);
          }
          if (rolled.get(dmg.attackId)) dmg.amount *= (moduleOf(unit) === CAPER_MODULE ? CAPER_MODULE_SCALE : p('b')) / 100;
        });
      },
      options: { accept: (payload, ctx) => ctx.unit.mem.caperProcs?.delete(payload.attackId) === true },
      run: ({ p, fx }) => { for (const x of fx.allies('adjacentAllies')) fx.charge(x, p('c')); },
    },
    3: ({ unit }) => { unit.mem.caperSure = (unit.mem.caperSure ?? 0) + 1; },
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'playful', stat: 'atk', amount: p('d') / 100, mode: 'percent' }),
  },
  modules: {
    // 暖意的归宿：戏耍随心几率 30%、攻击力 170% — read by line 2
    [CAPER_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 地灵 ---
// 凝滞师: every attack 停顿 its target (0.8 s natively, +0.3 by 地质勘探); 流沙化 keeps her whole range pausing. Your
// other operators' 停顿 charge her; each kill of a paused enemy lengthens every 停顿 she gives for the battle.

const SKGOAT_TRAIT_PLUS = 0.3, SKGOAT_SANDS_EVERY = 1.4, SKGOAT_STACK = 0.1, SKGOAT_COUNTER = 'skgoat-stop';
const SKGOAT_MODULE = 'uniequip_002_skgoat', SKGOAT_MODULE_PLUS = 0.5;

const skgoat = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.sustain(unit, { key: 'quicksand', mods: {}, flags: { disarm: true }, duration: cardParam(unit, 1, 'b') });
    // 每 1.4 秒停顿一次: one pulse now and every 1.4 s while it runs (a recast keeps the one pulse)
    const pulse = () => { for (const e of rangeEnemies(battle, unit)) effects(battle, unit, { index: 'skill' }).status(e, { status: 'sluggish', duration: SKGOAT_SANDS_EVERY }); };
    pulse();
    if (!unit.mem.skgoatSands || unit.mem.skgoatSands.cancelled) {
      unit.mem.skgoatSands = battle.every(SKGOAT_SANDS_EVERY, () => { if (!hasBuff(unit, ':skill:quicksand')) unit.mem.skgoatSands.cancel(); else pulse(); }, { owner: unit });
    }
    return true;
  },
  install: (battle, unit) => {
    // the trait's 停顿 (applied right after an attack instance of hers lands) +0.3 s (+0.5 s more with the module); every
    // 停顿 of hers + the battle counter of line 3
    let traitTarget = null;
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !dmg?.isAttack) return;
      traitTarget = target;
      if (moduleOf(unit) === SKGOAT_MODULE && dmg.type === 'phys') dmg.type = 'arts'; // 待确认的申请表：攻击造成法术伤害
    }, { owner: unit, priority: 100 });
    battle.on('beforeStatus', (c) => {
      if (c.source !== unit || c.status !== 'sluggish' || !(c.duration > 0)) return;
      const trait = c.target === traitTarget;
      traitTarget = null;
      c.duration += (trait ? SKGOAT_TRAIT_PLUS + (moduleOf(unit) === SKGOAT_MODULE ? SKGOAT_MODULE_PLUS : 0) : 0) + counterValue(battle, unit, SKGOAT_COUNTER);
    }, { owner: unit });
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of rangeEnemies(battle, unit)) fx.status(e, { status: 'sluggish', duration: p('a') }); },
    1: 'cast',
    2: ({ unit, p, fx }) => fx.charge(unit, p('c')),
    3: { options: { accept: (payload) => hasStatus(payload.target, 'sluggish') },
      run: ({ unit, fx }) => fx.counter(unit, { key: SKGOAT_COUNTER, label: '停顿时间', amount: SKGOAT_STACK, suffix: '秒' }) },
  },
  modules: {
    // 待确认的申请表 — read by the kit's hooks
    [SKGOAT_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------- 波登可 ---
// The gardener: her aura raises your other 辅助; their skills charge her and stack all of them.

const PODEGO_DEPLOY_TARGETS = 2, PODEGO_SPORE_SECONDS = 6, PODEGO_MODULE = 'uniequip_002_podego', PODEGO_MODULE_ATK = 3, PODEGO_MODULE_ASPD = 5;

const podego = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const first = rangeEnemies(battle, unit, 1)[0];
    if (!first) return false;
    // 孢子群: the 3×3 around where the vial lands, for 6 s; once a second the enemies on it 停顿, lose their abilities and burn
    const [r, c] = tileOf(first);
    const tiles = new Set([-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dc) => `${r + dr},${c + dc}`)));
    const scale = cardParam(unit, 1, 'b') / 100;
    let ticks = 0;
    const tick = () => {
      const fx = effects(battle, unit, { index: 'skill' });
      for (const e of battle.enemies) if (e.alive && !e.removed && tiles.has(tileOf(e).join(','))) {
        fx.status(e, { status: 'sluggish', duration: 1 });
        fx.status(e, { status: 'silence', duration: 1 });
        fx.damage(e, { scale, type: 'arts', isSkill: true });
      }
    };
    battle.assaultRuntime.withCause(cause, tick);
    const timer = battle.every(1, () => { if (++ticks >= PODEGO_SPORE_SECONDS) timer.cancel(); else tick(); }, { owner: unit });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => {
      const hurt = battle.assaultDeploymentOrder().filter((x) => isOp(x) && active(x) && x.ownerId === unit.ownerId)
        .sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp || uid(a).localeCompare(uid(b))).slice(0, PODEGO_DEPLOY_TARGETS);
      for (const x of hurt) fx.heal(x, { scale: p('a') / 100 });
    },
    1: 'cast',
    2: ({ battle, unit, p }) => {
      const module = moduleOf(unit) === PODEGO_MODULE;
      allyAura(battle, unit, { key: 'gardener', mods: { atkPct: (p('c') + (module ? PODEGO_MODULE_ATK : 0)) / 100, ...(module ? { aspd: PODEGO_MODULE_ASPD } : null) },
        select: (x) => x !== unit && matchesClass(x, { label: '辅助' }) });
    },
    3: ({ unit, p, fx }) => fx.charge(unit, p('d')),
    4: ({ p, fx }) => { for (const x of fx.allies('allies:辅助')) fx.stack(x, { key: 'gardener', stat: 'atk', amount: p('e') / 100, mode: 'percent' }); },
  },
  modules: {
    // “不谢的苗圃”：园丁再 +3% 攻击力，并 +5 攻击速度 — read by line 2
    [PODEGO_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 罗比菈塔 ---
// 造型仪 ([ASSUMED] a 25 s buff on the operator it is placed on: 防御力 +x%, 2 层护盾): her deployment places one on a melee
// operator around her, each deployment of your other 哥伦比亚 places one on it for free, her skill's end gives one more.
// Every shield layer your other operators lose stacks her defence.

const ROBRTA_STYLIST_SECONDS = 25, ROBRTA_STYLIST_LAYERS = 2, ROBRTA_MODULE = 'uniequip_002_robrta', ROBRTA_MODULE_DEF = 10;
const meleeOp = (x) => positionOf(x) === 'MELEE' || x?.profile?.attack === 'melee';

function placeStylist(battle, unit, target, cause) {
  if (!target || !active(target)) return false;
  const def = (cardParam(unit, 0, 'a') + (moduleOf(unit) === ROBRTA_MODULE ? ROBRTA_MODULE_DEF : 0)) / 100;
  battle.assaultRuntime.withCause(cause, () => battle.addBuff(target, { key: `assault:robrta:stylist:${uid(unit)}`, mods: { defPct: def },
    shieldHits: ROBRTA_STYLIST_LAYERS+(target.buffs.find(b=>b.key===`assault:robrta:stylist:${uid(unit)}`)?.shieldHits??0), duration: ROBRTA_STYLIST_SECONDS, refresh: 'replace', visible: true, source: unit }));
  return true;
}
/** The melee operator around her (her tile and the four around) to take a stylist: one without it first, then the most hurt. */
const stylistTarget = (battle, unit) => battle.assaultDeploymentOrder().filter((x) => isOp(x) && active(x) && x.ownerId === unit.ownerId && meleeOp(x) && withinAdjacent4(unit, x))
  .sort((a, b) => Number(hasBuff(a, 'robrta:stylist')) - Number(hasBuff(b, 'robrta:stylist')) || a.hp / a.s.maxHp - b.hp / b.s.maxHp || uid(a).localeCompare(uid(b)))[0] ?? null;

const robrta = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.sustain(unit, { key: 'stylist-auto', mods: { blockCnt: 1, defPct: cardParam(unit, 1, 'c') / 100 }, flags: { disarm: true }, duration: cardParam(unit, 1, 'b') });
    // 结束时获得 1 个造型仪: placed at once on the melee operator around her (kept for her next deployment when there is none)
    if (!placeStylist(battle, unit, stylistTarget(battle, unit), cause)) unit.mem.robrtaStock = (unit.mem.robrtaStock ?? 0) + 1;
    return true;
  },
  lines: {
    0: ({ battle, unit, cause }) => {
      placeStylist(battle, unit, stylistTarget(battle, unit), cause);
      while ((unit.mem.robrtaStock ?? 0) > 0 && placeStylist(battle, unit, stylistTarget(battle, unit), cause)) unit.mem.robrtaStock--;
    },
    1: 'cast',
    2: 'cast',
    3: ({ battle, unit, actor, cause }) => placeStylist(battle, unit, actor, cause),
    // 每失去一层护盾: each shield layer your other operators lose (the native per-layer hook; the line's own event counts a
    // broken barrier of HP)
    4: {
      install: ({ battle, unit, p }) => battle.on('shieldLayersBroken', ({ unit: holder, layers }) => {
        if (!active(unit) || !isOp(holder) || holder === unit || holder.ownerId !== unit.ownerId) return;
        const fx = effects(battle, unit, { index: 4 });
        for (let i = 0; i < (layers ?? 1); i++) fx.stack(unit, { key: 'stylist-tuning', stat: 'def', amount: p('d') / 100, mode: 'percent' });
      }, { owner: unit }),
      options: { accept: (payload) => payload.shieldKind === 'hp' },
      run: ({ unit, p, fx }) => fx.stack(unit, { key: 'stylist-tuning', stat: 'def', amount: p('d') / 100, mode: 'percent' }),
    },
  },
  modules: {
    // 半自动造型工具套组：造型仪的防御力加成再 +10% — read by placeStylist
    [ROBRTA_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 白金 ---
// 蓄力攻击: the longer since her last attack, the harder the next one (full at 2.5 s, and at once on a held enemy); every
// hit taken by your other 卡西米尔 stacks her attack.

const PLATNM_CHARGE_SECONDS = 2.5, PLATNM_VIEW_ASPD = -20, PLATNM_MODULE = 'uniequip_002_platnm', PLATNM_MODULE_MAX = 20;
const HELD = ['sleep', 'bind', 'frozen', 'stun'];
const platnmMax = (unit) => cardParam(unit, 2, 'c') + (moduleOf(unit) === PLATNM_MODULE ? PLATNM_MODULE_MAX : 0);

const platnm = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'pegasus', mods: { aspd: PLATNM_VIEW_ASPD, atkPct: cardParam(unit, 1, 'b') / 100, rangeExtend: 1 },
      duration: cardParam(unit, 1, 'a') });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => {
      const target = rangeEnemies(battle, unit).sort((a, b) => b.hp - a.hp || uid(a).localeCompare(uid(b)))[0];
      if (target) fx.damage(target, { scale: platnmMax(unit) / 100, type: 'phys' });
    },
    1: 'cast',
    2: {
      install: ({ battle, unit }) => {
        const charge = new Map();
        onOwnAttack(battle, unit, ({ attackId }) => {
          const since = battle.time - (unit.mem.platnmLast ?? unit.deployedAt ?? 0);
          unit.mem.platnmLast = battle.time;
          charge.clear();
          charge.set(attackId, Math.min(1, Math.max(0, since) / PLATNM_CHARGE_SECONDS));
        });
        onOwnDamage(battle, unit, ({ target, dmg }) => {
          if (!dmg.isAttack || !charge.has(dmg.attackId)) return;
          // line 3: on a sleeping / bound / frozen / stunned enemy the charge is full
          const ratio = HELD.some((s) => hasStatus(target, s)) ? 1 : charge.get(dmg.attackId);
          dmg.amount *= 1 + (platnmMax(unit) / 100 - 1) * ratio;
        });
      },
      run: () => {},
    },
    3: () => {}, // read by line 2's hook
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'charge', stat: 'atk', amount: p('d') / 100, mode: 'percent' }),
  },
  modules: {
    // 独自旅行套装：蓄力攻击的最高倍率再 +20% — read by platnmMax
    [PLATNM_MODULE]: () => {},
  },
});

// ---------------------------------------------------------------- 寒芒克洛丝 ---
// 中的 procs stun for a blink; your other operators' stuns charge her and their kills of stunned enemies grow her.
// 封喉 shoots twice, four times once the skill's hits of this battle reach the card's count.

const KROOS2_DEPLOY_HITS = 4, KROOS2_CHANCE = 20, KROOS2_STUN = 0.2, KROOS2_MODULE = 'uniequip_002_kroos2', KROOS2_MODULE_SCALE = 175;

const kroos2 = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'throat', mods: { batPct: INTERVAL.much }, duration: cardParam(unit, 1, 'b') });
    return true;
  },
  install: (battle, unit) => onOwnAttack(battle, unit, ({ targets, attackId }) => {
    if (!hasBuff(unit, ':skill:throat')) return;
    const shots = (unit.mem.kroos2Hits ?? 0) >= cardParam(unit, 2, 'c') ? 4 : 2;
    for (const e of targets) {
      unit.mem.kroos2Hits = (unit.mem.kroos2Hits ?? 0) + 1;
      for (let i = 1; i < shots && e.alive; i++) { extraHit(battle, unit, e, { attackId }); unit.mem.kroos2Hits++; }
    }
  }),
  lines: {
    0: ({ battle, unit, p, fx }) => { const e = rangeEnemies(battle, unit, 1)[0]; if (e) fx.damage(e, { scale: p('a') / 100, type: 'phys', hits: KROOS2_DEPLOY_HITS }); },
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit, p }) => {
        const procs = new Map();
        onOwnDamage(battle, unit, ({ target, dmg }) => {
          if (!dmg.isAttack) return;
          if (!procs.has(dmg.attackId)) { procs.clear(); procs.set(dmg.attackId, battle.rng() < KROOS2_CHANCE / 100); }
          if (!procs.get(dmg.attackId)) return;
          dmg.amount *= (moduleOf(unit) === KROOS2_MODULE ? KROOS2_MODULE_SCALE : p('d')) / 100;
          if (target.alive) effects(battle, unit, { index: 3 }).status(target, { status: 'stun', duration: KROOS2_STUN });
        });
      },
      run: () => {},
    },
    4: ({ unit, fx }) => fx.charge(unit, 1),
    5: { options: { accept: (payload) => hasStatus(payload.target, 'stun') }, run: ({ unit, p, fx }) => fx.growth(unit, { key: 'bullseye', stat: 'atk', percent: p('e') / 100 }) },
  },
  modules: {
    // 真心的话和想冒的险：中的的攻击力再提升至 175% — read by line 3
    [KROOS2_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 隐现 ---
// The ammunition shooter of 拉特兰: her deployment raises her own and the other 拉特兰's 弹药上限; every ammo skill of
// another 拉特兰 adds one more round for the battle, their kills charge her.

const INSIDE_DEPLOY_CAP = 3, INSIDE_OTHER_CAP = 1, INSIDE_MODULE = 'uniequip_002_inside', INSIDE_MODULE_CAP = 5, INSIDE_COUNTER = 'inside-cap';
const ammoCard = (x) => (x?.def?.raw?.assaultBody?.bazaar?.lines ?? []).some((l) => l.kind === 'skill' && /ammoSkill/.test(String(l.effect)));

const inside = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const { ammoSkill } = effects(battle, unit, { index: 'skill' }, cause).raw.synergy;
    // 优先攻击远程敌人 while a round is left: her own profile with the ranged-first priority, put back when the last is spent
    if (!unit.profile.insidePrev) unit.profile = { ...unit.profile, priority: 'ranged', insidePrev: unit.profile };
    ammoSkill(battle, unit, { key: 'trouble', count: cardParam(unit, 1, 'a'), mods: { atkPct: cardParam(unit, 1, 'b') / 100, batPct: INTERVAL.slight, taunt: -1 }, cause,
      onEmpty: () => { if (unit.profile?.insidePrev) unit.profile = unit.profile.insidePrev; } });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => {
      const { maxAmmo } = fx.raw.synergy;
      maxAmmo(unit, 'inside-deploy', moduleOf(unit) === INSIDE_MODULE ? INSIDE_MODULE_CAP : INSIDE_DEPLOY_CAP);
      for (const x of fx.allies('allies:拉特兰')) maxAmmo(x, `inside-deploy:${uid(unit)}`, INSIDE_OTHER_CAP);
    },
    1: 'cast',
    2: 'cast',
    3: ({ unit, p, fx }) => fx.charge(unit, p('c')),
    4: {
      options: { accept: (payload) => ammoCard(payload.source) },
      run: ({ unit, fx }) => fx.raw.synergy.maxAmmo(unit, 'inside-support', fx.counter(unit, { key: INSIDE_COUNTER, label: '弹药上限', amount: 1 })),
    },
  },
  modules: {
    // “最初的惊喜”：部署时的弹药上限加成改为 +5 — read by line 0
    [INSIDE_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 送葬人 ---
// 终结改装 pierces defence (more on a trembling enemy); every elite kill of your other operators grows him for the run.

const EXCU_TREMBLE_PIERCE = 100, EXCU_MODULE = 'uniequip_002_excu', EXCU_MODULE_PIERCE = 50;

const excu = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'final-journey', mods: { batPct: INTERVAL.much }, duration: cardParam(unit, 1, 'b') });
    return true;
  },
  install: (battle, unit) => onOwnAttack(battle, unit, ({ targets, attackId }) => {
    // 最终旅程：普通攻击变为二连击
    if (hasBuff(unit, ':skill:final-journey')) for (const e of targets) extraHit(battle, unit, e, { attackId });
  }),
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of rangeEnemies(battle, unit)) fx.damage(e, { scale: p('a') / 100, type: 'phys' }); },
    1: 'cast',
    2: ({ unit, p, fx }) => fx.buff(unit, { key: 'pierce', mods: { defIgnoreFlat: p('c') + (moduleOf(unit) === EXCU_MODULE ? EXCU_MODULE_PIERCE : 0) }, persist: true }),
    3: {
      install: ({ battle, unit }) => onOwnDamage(battle, unit, ({ target, dmg }) => { if (hasStatus(target, 'tremble')) dmg.defIgnoreFlat += EXCU_TREMBLE_PIERCE; }),
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'requiem', stat: 'atk', percent: p('d') / 100 }),
  },
  modules: {
    // 执行者随身包：无视防御再 +50 — read by line 2
    [EXCU_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 奥斯塔 ---
// 尖钉 bleeds what is not blocked; every bind of your other operators charges him and stacks the bleed for the battle.

const AOSTA_BLEED_SECONDS = 3, AOSTA_SKILL_BIND = 1.5, AOSTA_MODULE = 'uniequip_002_aosta', AOSTA_MODULE_BLEED = 27, AOSTA_MODULE_SECONDS = 5;
const AOSTA_COUNTER = 'aosta-spike';

function aostaBleed(battle, unit, target) {
  const module = moduleOf(unit) === AOSTA_MODULE;
  const bleeding = unit.mem.aostaBleeding ??= new Map();
  bleeding.set(target, battle.time + (module ? AOSTA_MODULE_SECONDS : AOSTA_BLEED_SECONDS));
  if (unit.mem.aostaTicker && !unit.mem.aostaTicker.cancelled) return;
  unit.mem.aostaTicker = battle.every(1, () => {
    const fx = effects(battle, unit, { index: 2 });
    const scale = (moduleOf(unit) === AOSTA_MODULE ? AOSTA_MODULE_BLEED : cardParam(unit, 2, 'e')) / 100
      * (hasBuff(unit, ':skill:shadow-spike') ? 2 : 1) * (1 + counterValue(battle, unit, AOSTA_COUNTER) / 100);
    for (const [e, until] of [...bleeding]) {
      if (!e.alive || battle.time > until + 1e-9) { bleeding.delete(e); continue; }
      fx.damage(e, { scale, type: 'arts' });
    }
    if (!bleeding.size) unit.mem.aostaTicker.cancel();
  }, { owner: unit });
}

const aosta = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'shadow-spike', mods: { batPct: INTERVAL.longer, atkPct: cardParam(unit, 1, 'd') / 100 }, duration: cardParam(unit, 1, 'c') });
    return true;
  },
  install: (battle, unit) => onOwnAttack(battle, unit, ({ targets }) => {
    const fx = effects(battle, unit, { index: 'skill' });
    for (const e of targets) {
      if (!e.alive) continue;
      if (hasBuff(unit, ':skill:shadow-spike')) fx.status(e, { status: 'bind', duration: AOSTA_SKILL_BIND });
      if (!e.blockedBy) aostaBleed(battle, unit, e); // 尖钉：攻击使未被阻挡的敌人流血
    }
  }),
  lines: {
    0: ({ battle, unit, p, fx }) => {
      for (const e of rangeEnemies(battle, unit)) {
        fx.damage(e, { scale: p('a') / 100, type: 'phys' });
        if (e.alive) fx.status(e, { status: 'bind', duration: p('b') });
      }
    },
    1: 'cast',
    2: () => {}, // 尖钉: the bleed of the kit's attack hook
    3: ({ unit, fx }) => fx.charge(unit, 1),
    4: ({ unit, p, fx }) => fx.counter(unit, { key: AOSTA_COUNTER, label: '尖钉伤害', amount: p('f'), suffix: '%' }),
  },
  modules: {
    // 逃亡路上的应急小包：流血改为每秒 27% 攻击力，持续 5 秒 — read by the bleed
    [AOSTA_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 阿米娅 ---
// 奇美拉: true damage for a while, then a 3 s stun. Her attacks feed her SP, and so do the kills your other operators make
// in her range; their elite kills grow her for the run.

const AMIYA_DEPLOY_TARGETS = 3, AMIYA_STUN = 3, AMIYA_HP_GROWTH = 0.03, AMIYA_MODULE = 'uniequip_002_amiya', AMIYA_MODULE_SP = 1;

const amiya = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.sustain(unit, { key: 'chimera', mods: { atkPct: cardParam(unit, 1, 'c') / 100, hpPct: 1, rangeExtend: 1 }, duration: cardParam(unit, 1, 'b') });
    whenSkillEnds(battle, unit, ':skill:chimera', () => { if (active(unit)) effects(battle, unit, { index: 'skill' }).status(unit, { status: 'stun', duration: AMIYA_STUN }); });
    return true;
  },
  install: (battle, unit) => onOwnDamage(battle, unit, ({ dmg }) => { if (hasBuff(unit, ':skill:chimera') && (dmg.type === 'arts' || dmg.type === 'phys')) dmg.type = 'true'; }),
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of rangeEnemies(battle, unit, AMIYA_DEPLOY_TARGETS)) fx.damage(e, { scale: p('a') / 100, type: 'true' }); },
    1: 'cast',
    2: 'cast',
    3: { options: { accept: isNormalAttack }, run: ({ unit, p, fx }) => fx.charge(unit, p('d')) },
    4: { options: { accept: (payload, ctx) => inRangeOf(ctx.unit, payload.target) }, run: ({ unit, p, fx }) => fx.charge(unit, p('e')) },
    5: ({ unit, p, fx }) => {
      fx.growth(unit, { key: 'emotion-atk', stat: 'atk', percent: p('f') / 100 });
      fx.growth(unit, { key: 'emotion-hp', stat: 'maxHp', percent: AMIYA_HP_GROWTH });
    },
  },
  modules: {
    // DWDB-221E：普通攻击命中精英或领袖敌人时，额外获得 1 技力
    [AMIYA_MODULE]: { options: { accept: (payload) => isNormalAttack(payload) && isElite(payload.target) }, run: ({ unit, fx }) => fx.charge(unit, AMIYA_MODULE_SP) },
  },
});

// -------------------------------------------------------------------- 惊蛰 ---
// 通流无阻 hits the unblocked harder; every skill of your other operators hastes her (twice for 炎), every 停顿 they give
// stacks her attack.

const LEIZI_DEPLOY_CHAIN = 4, LEIZI_DEPLOY_STOP = 0.5, LEIZI_YAN = 2, LEIZI_MODULE = 'uniequip_002_leizi', LEIZI_MODULE_SCALE = 129, LEIZI_MODULE_SP = 1;

const leizi = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'first-thunder', mods: { atkPct: cardParam(unit, 1, 'c') / 100 }, duration: cardParam(unit, 1, 'b') });
    // 连锁跳跃时不再降低伤害: her chain loses its falloff while the skill runs (a copy: the profession table stays as it is)
    if (unit.profile?.chain && !unit.mem.leiziChain) {
      unit.mem.leiziChain = unit.profile.chain;
      unit.profile.chain = { ...unit.profile.chain, falloff: 0 };
      whenSkillEnds(battle, unit, ':skill:first-thunder', () => { unit.profile.chain = unit.mem.leiziChain; unit.mem.leiziChain = null; });
    }
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => {
      for (const e of chainFrom(battle, rangeEnemies(battle, unit, 1)[0], LEIZI_DEPLOY_CHAIN)) {
        fx.damage(e, { scale: p('a') / 100, type: 'arts' });
        if (e.alive) fx.status(e, { status: 'sluggish', duration: LEIZI_DEPLOY_STOP });
      }
    },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => onOwnDamage(battle, unit, ({ target, dmg }) => {
        if (!target.blockedBy) dmg.amount *= (moduleOf(unit) === LEIZI_MODULE ? LEIZI_MODULE_SCALE : p('d')) / 100;
      }),
      run: () => {},
    },
    3: ({ unit, p, fx, actor }) => fx.accelerate(unit, p('e') * (matchesClass(actor, { label: '炎' }) ? LEIZI_YAN : 1)),
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'flow', stat: 'atk', amount: p('f') / 100, mode: 'percent' }),
  },
  modules: {
    // “天地通明”：通流无阻提升至 129%（line 2），命中未被阻挡的敌人时获得 1 技力
    [LEIZI_MODULE]: { options: { accept: (payload) => isNormalAttack(payload) && !payload.target?.blockedBy }, run: ({ unit, fx }) => fx.charge(unit, LEIZI_MODULE_SP) },
  },
});

/** A summon's kit for a synergy card (it replaces the old token kit of that id): no skill, `install(battle, token, owner)`. */
const synergyToken = (tokenId, install) => () => ({
  skill: { id: tokenId, kind: 'passive', trigger: 'NEVER', spCost: 0, assaultCast: () => false, onStart: () => false },
  install: (battle, token) => {
    const owner = token.ownerUnit;
    if (!owner) throw new TypeError(`${tokenId} requires its ownerUnit`);
    install(battle, token, owner);
  },
});
const ownSummons = (battle, unit, tokenId) => battle.allyUnits.filter((x) => x.kind === 'token' && x.ownerUnit === unit && x.defId === tokenId && active(x));
/** 回收 `tokens` (summonReturned for each) and take the recalled ones out of the stock again: the card deploys them anew itself. */
function recall(battle, unit, tokens, reason) {
  let n = 0;
  for (const token of tokens) if (returnSummon(battle, unit, token, reason)) n++;
  if (n) { const ledger = ledgerFor(battle, unit); ledger.stock.set(tokens[0].defId, Math.max(0, (ledger.stock.get(tokens[0].defId) ?? 0) - n)); }
  return n;
}

// -------------------------------------------------------------------- 蜜蜡 ---
// 守卫尖碑 at every deployment: an obelisk that blocks, its landing stuns the enemies around it. The blocks of your other
// units charge her; every summon of your other operators stacks her attack.

const BEEWAX_OBELISK = 'token_10011_beewax_oblisk', BEEWAX_OBELISK_BLOCK = 2, BEEWAX_RADIUS = 1, BEEWAX_MODULE = 'uniequip_002_beewax';

const beewax = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    recall(battle, unit, ownSummons(battle, unit, BEEWAX_OBELISK), 'replace');
    grantSummon(battle, unit, { tokenId: BEEWAX_OBELISK, count: 1, stockCap: 1, fieldCap: 1, ruleKey: `beewax:${uid(unit)}` });
    const obelisk = ownSummons(battle, unit, BEEWAX_OBELISK)[0];
    if (!obelisk) return false;
    const radius = BEEWAX_RADIUS + (moduleOf(unit) === BEEWAX_MODULE ? 1 : 0);
    for (const e of battle.enemies.filter((x) => x.alive && !x.removed && !x.hidden && Math.max(Math.abs(Math.round(x.y) - obelisk.tileR), Math.abs(Math.round(x.x) - obelisk.tileC)) <= radius)) {
      fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
      if (e.alive) fx.status(e, { status: 'stun', duration: cardParam(unit, 1, 'b') });
    }
    return true;
  },
  lines: {
    0: 'cast',
    1: 'cast',
    // 沙原的庇护 ([ASSUMED] her skill is instant, so 「技能未开启时」 is always): 每秒回复 c% 最大生命
    2: ({ unit, p, fx }) => fx.buff(unit, { key: 'sand-shelter', mods: { hpRegenRatio: p('c') / 100 }, persist: true }),
    3: ({ unit, fx }) => fx.charge(unit, 1),
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'sand', stat: 'atk', amount: p('d') / 100, mode: 'percent' }),
  },
  modules: {
    // “司祭的祝福”：方尖碑落地伤害范围 +1 格 — read by the cast
    [BEEWAX_MODULE]: () => {},
  },
});
const beewaxObelisk = synergyToken(BEEWAX_OBELISK, (battle, token) => {
  token.profile.noAttack = true;
  token.base.blockCnt = BEEWAX_OBELISK_BLOCK;
  token.markDirty();
});

// ----------------------------------------------------------------- 莱恩哈特 ---
// 解构与爆破 at every deployment, stored three times, charging the 术师 beside him; the kills your other operators make
// in his range charge him and grow him for the run.

const LIONHD_RES_SECONDS = 6, LIONHD_PER_ENEMY = 0.04, LIONHD_MAX = 6, LIONHD_MODULE = 'uniequip_002_lionhd', LIONHD_MODULE_MAX = 8;

const lionhd = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = rangeEnemies(battle, unit);
    for (const e of targets) {
      fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
      if (e.alive) fx.buff(e, { key: 'demolish', mods: { resMul: 1 - cardParam(unit, 1, 'b') / 100 }, duration: LIONHD_RES_SECONDS });
    }
    for (const x of fx.allies('adjacentAllies')) if (matchesClass(x, { label: '术师' })) fx.charge(x, cardParam(unit, 2, 'c'));
    return targets.length > 0;
  },
  lines: {
    0: 'cast',
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit }) => {
        const buffKey = `assault:lionhd:fragment:${uid(unit)}`;
        battle.every(0.25, () => {
          if (!active(unit)) return;
          const n = Math.min(moduleOf(unit) === LIONHD_MODULE ? LIONHD_MODULE_MAX : LIONHD_MAX, rangeEnemies(battle, unit).length);
          const has = unit.buffs.find((b) => b.key === buffKey);
          if (!n) { if (has) battle.removeBuff(unit, buffKey); return; }
          if (!has || has.mods.atkPct !== LIONHD_PER_ENEMY * n) battle.addBuff(unit, { key: buffKey, mods: { atkPct: LIONHD_PER_ENEMY * n }, duration: Infinity, refresh: 'replace', source: unit });
        }, { owner: unit, immediate: true });
      },
      run: () => {},
    },
    4: { options: { accept: (payload, ctx) => inRangeOf(ctx.unit, payload.target) }, run: ({ unit, p, fx }) => fx.charge(unit, p('d')) },
    5: { options: { accept: (payload, ctx) => inRangeOf(ctx.unit, payload.target) }, run: ({ unit, p, fx }) => fx.growth(unit, { key: 'fragment', stat: 'atk', percent: p('e') / 100 }) },
  },
  modules: {
    // 传承与开拓：攻击范围扩大；破片杀伤最多 8 层（line 3）
    [LIONHD_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'heritage', mods: { rangeExtend: 1 }, persist: true }),
  },
});

// -------------------------------------------------------------------- 寒檀 ---
// Icicles: her deployment drops four, “女巫之泪” turns every attack into one. Your other operators' 寒冷 charge her, their
// 冻结 grow her for the run; twenty seconds on the field make her stronger.

const SNTLLA_DEPLOY_ICICLES = 4, SNTLLA_COLD = 1, SNTLLA_AFTER = 20, SNTLLA_MODULE = 'uniequip_002_sntlla', SNTLLA_MODULE_AFTER = 15, SNTLLA_MODULE_COLD = 0.5;

function icicle(battle, unit, fx, at, scale) {
  const cold = SNTLLA_COLD + (moduleOf(unit) === SNTLLA_MODULE ? SNTLLA_MODULE_COLD : 0);
  for (const e of enemiesAround(battle, at)) {
    fx.damage(e, { scale, type: 'arts', isSkill: true });
    if (e.alive) fx.status(e, { status: 'cold', duration: cold });
  }
}

const sntlla = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'witch-tears', mods: { rangeExtend: 1, batPct: INTERVAL.huge }, duration: cardParam(unit, 1, 'b') });
    return true;
  },
  install: (battle, unit) => {
    // 攻击改为召唤冰凌: while the skill runs her attack lands as an icicle on its target (the attack's own hit gives way)
    battle.on('hit', ({ source, dmg }) => { if (source === unit && dmg?.isAttack && hasBuff(unit, ':skill:witch-tears')) dmg.cancel = true; }, { owner: unit, priority: 200 });
    onOwnAttack(battle, unit, ({ targets }) => {
      if (!hasBuff(unit, ':skill:witch-tears')) return;
      const fx = effects(battle, unit, { index: 'skill' });
      for (const e of targets) icicle(battle, unit, fx, e, cardParam(unit, 1, 'c') / 100);
    });
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of rangeEnemies(battle, unit, SNTLLA_DEPLOY_ICICLES)) if (e.alive) icicle(battle, unit, fx, e, p('a') / 100); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => {
        const ready = () => battle.time + 1e-9 >= (unit.deployedAt ?? 0) + (moduleOf(unit) === SNTLLA_MODULE ? SNTLLA_MODULE_AFTER : SNTLLA_AFTER);
        selfWhile(battle, unit, 'born-of-cold', { atkPct: p('d') / 100 }, ready);
        // 并获得抵抗 (the native 抵抗 status, for as long as the condition holds)
        battle.every(0.25, () => { if (active(unit) && ready() && !unit.buffs.some((b) => b.status === 'resist')) battle.applyStatus(unit, 'resist', { duration: Infinity, source: unit }); }, { owner: unit });
      },
      run: () => {},
    },
    3: ({ unit, fx }) => fx.charge(unit, 1),
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'born-of-cold', stat: 'atk', percent: p('e') / 100 }),
  },
  modules: {
    // “冰焰”：生于冰寒在场 15 秒即生效；冰凌多施加 0.5 秒寒冷 — read by line 2 and the icicles
    [SNTLLA_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 复奏 ---
// 直到终曲 at every deployment; a crowd around her target makes her harder; the 叙拉古 kills charge her, every skill of
// your other operators stacks her attack.

const LIESEL_TARGETS = 3, LIESEL_DOT_SECONDS = 6, LIESEL_CROWD = 3, LIESEL_MODULE = 'uniequip_002_liesel', LIESEL_MODULE_SCALE = 135;

const liesel = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = rangeEnemies(battle, unit, LIESEL_TARGETS);
    for (const e of targets) fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
    const dot = cardParam(unit, 1, 'b') / 100;
    let ticks = 0;
    const timer = battle.every(1, () => {
      const tick = effects(battle, unit, { index: 'skill' });
      for (const e of targets) if (e.alive && !e.removed) tick.damage(e, { scale: dot, type: 'arts', isSkill: true });
      if (++ticks >= LIESEL_DOT_SECONDS) timer.cancel();
    }, { owner: unit });
    return targets.length > 0;
  },
  lines: {
    0: 'cast',
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => onOwnDamage(battle, unit, ({ target, dmg }) => {
        if (!dmg.isAttack || enemiesAround(battle, target).length < LIESEL_CROWD) return;
        dmg.mul *= (moduleOf(unit) === LIESEL_MODULE ? LIESEL_MODULE_SCALE : p('c')) / 100;
      }),
      run: () => {},
    },
    3: ({ unit, p, fx }) => fx.charge(unit, p('d')),
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'baton', stat: 'atk', amount: p('e') / 100, mode: 'percent' }),
  },
  modules: {
    // “暮约”：执棒素养提升至 135% — read by line 2
    [LIESEL_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 薄绿 ---
// 聚能涡旋 drags every target to her and bursts on its end; out of the skill her neighbours stand firmer, and every hit
// they take hardens them for the battle. Your other 维多利亚 charge her.

const MINT_DEPLOY_TARGETS = 2, MINT_DEPLOY_FORCE = 2, MINT_VORTEX_FORCE = 2, MINT_MODULE = 'uniequip_002_mint', MINT_MODULE_DEF = 9;

const mint = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'vortex', mods: { taunt: -1 }, duration: cardParam(unit, 1, 'a') });
    // 阵法术师 attack only while their skill is active: her timed skill (instant in this mode) opens that window
    if (unit.profile?.noAttackUnlessSkill) { unit.profile.noAttackUnlessSkill = false; unit.mem.mintPhalanx = true; }
    // 结束时对攻击范围内所有敌人造成 c% 法术伤害（持续中重复发起：结算延后）
    whenSkillEnds(battle, unit, ':skill:vortex', () => {
      if (unit.mem.mintPhalanx) { unit.profile.noAttackUnlessSkill = true; unit.mem.mintPhalanx = false; }
      if (!active(unit)) return;
      const fx = effects(battle, unit, { index: 'skill' });
      for (const e of rangeEnemies(battle, unit)) fx.damage(e, { scale: cardParam(unit, 2, 'c') / 100, type: 'arts', isSkill: true });
    });
    return true;
  },
  install: (battle, unit) => {
    // 每次攻击把目标中等力度拖拽到面前，造成 b% 法术伤害 (the attack's own hit gives way to it)
    battle.on('hit', ({ source, dmg }) => { if (source === unit && dmg?.isAttack && hasBuff(unit, ':skill:vortex')) dmg.cancel = true; }, { owner: unit, priority: 200 });
    onOwnAttack(battle, unit, ({ targets }) => {
      if (!hasBuff(unit, ':skill:vortex')) return;
      const fx = effects(battle, unit, { index: 'skill' });
      for (const e of targets) {
        if (!e.alive) continue;
        battle.pullToFront(e, unit, MINT_VORTEX_FORCE);
        fx.damage(e, { scale: cardParam(unit, 1, 'b') / 100, type: 'arts', isSkill: true });
      }
    });
  },
  lines: {
    0: ({ battle, unit }) => { for (const e of rangeEnemies(battle, unit, MINT_DEPLOY_TARGETS)) battle.pullToFront(e, unit, MINT_DEPLOY_FORCE); },
    1: 'cast',
    2: 'cast',
    // 地质学者：技能未开启时，周围四格干员防御力 +d%（技能开启时自身不容易受到攻击：the skill's taunt −1）
    3: ({ battle, unit, p }) => allyAura(battle, unit, { key: 'geologist', mods: { defPct: (p('d') + (moduleOf(unit) === MINT_MODULE ? MINT_MODULE_DEF : 0)) / 100 },
      select: (x) => withinAdjacent4(unit, x) && !hasBuff(unit, ':skill:vortex') }),
    4: ({ unit, p, fx }) => fx.charge(unit, p('e')),
    5: ({ actor, p, fx }) => fx.stack(actor, { key: 'geologist', stat: 'def', amount: p('f') / 100, mode: 'percent' }),
  },
  modules: {
    // 注意力保持装置：地质学者的防御加成再 +9% — read by line 3
    [MINT_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 耶拉 ---
// A 驭械术师 of 谢拉格: 心随意动 adds a drone and makes her attacks chill; your other operators' 寒冷 / 冻结 charge her, the
// skills of your other 谢拉格 stack her attack.

const KJERA_DEPLOY_TARGETS = 2, KJERA_COLD = 2.5, KJERA_CHANCE = 22, KJERA_GROUND = 2;
const KJERA_MODULE = 'uniequip_002_kjera', KJERA_MODULE_CHANCE = 27, KJERA_MODULE_COLD = 3;

const kjera = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'heart', mods: { atkPct: cardParam(unit, 1, 'b') / 100 }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  install: (battle, unit) => {
    // 浮游单元 +1: one more drone hit beside each of her drone's hits while the skill runs
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !hasBuff(unit, ':skill:heart') || !dmg?.tags?.includes('funnel') || dmg.tags.includes('kjera-extra') || !target?.alive) return;
      battle.dealDamage(unit, target, { amount: dmg.amount, type: dmg.type, isSkill: dmg.isSkill, attackId: dmg.attackId, tags: [...dmg.tags, 'kjera-extra'] });
    }, { owner: unit, priority: -50 });
    onOwnAttack(battle, unit, ({ targets }) => {
      if (!hasBuff(unit, ':skill:heart')) return;
      const module = moduleOf(unit) === KJERA_MODULE;
      const fx = effects(battle, unit, { index: 'skill' });
      for (const e of targets) if (e.alive && battle.rng() < (module ? KJERA_MODULE_CHANCE : KJERA_CHANCE) / 100) fx.status(e, { status: 'cold', duration: module ? KJERA_MODULE_COLD : KJERA_COLD });
    });
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const e of rangeEnemies(battle, unit, KJERA_DEPLOY_TARGETS)) fx.status(e, { status: 'cold', duration: KJERA_COLD }); },
    1: 'cast',
    // 低眉：攻击力 +c%；攻击范围内有 2 格以上地面时，改为 +d%
    2: ({ battle, unit, p, fx }) => {
      const ground = [...unit.rangeKeys].filter((k) => { const r = Math.floor(k / COLS), c = k % COLS; return battle.grid.inRect(r, c) && battle.grid.tile(r, c)?.height !== 'HIGH'; }).length;
      fx.buff(unit, { key: 'lowered-gaze', mods: { atkPct: (ground >= KJERA_GROUND ? p('d') : p('c')) / 100 }, persist: true });
    },
    3: { options: { statuses: ['cold', 'frozen'] }, run: ({ unit, p, fx }) => fx.charge(unit, p('e')) },
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'lowered-gaze', stat: 'atk', amount: p('f') / 100, mode: 'percent' }),
  },
  modules: {
    // 以雪为线：心随意动的寒冷几率提升至 27%，持续 3 秒 — read by the kit
    [KJERA_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 洛洛 ---
// 自负此轭 speeds her drones; cast again while it runs and she overloads (atk +50%, the drones' cap doubled) and pays with
// a stun as long as the overload. Every deployment of your other operators grows her for the run; the 维多利亚 ones charge her.

const ROCKR_EVERY = 15, ROCKR_STACK = 0.05, ROCKR_MAX = 4, ROCKR_OVERLOAD_ATK = 0.5;
const ROCKR_MODULE = 'uniequip_002_rockr', ROCKR_MODULE_EVERY = 10, ROCKR_MODULE_ASPD = 5;

const rockr = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const running = hasBuff(unit, ':skill:yoke');
    fx.sustain(unit, { key: 'yoke', mods: { aspd: cardParam(unit, 1, 'c') }, duration: cardParam(unit, 1, 'b') });
    if (running && unit.mem.rockrOverloadAt == null) {
      // 过载 until the skill ends: atk +50%, the drone ramp's cap doubled (a copy of her profile's funnel)
      unit.mem.rockrOverloadAt = battle.time;
      fx.buff(unit, { key: 'overload', mods: { atkPct: ROCKR_OVERLOAD_ATK } });
      if (unit.profile?.funnel) { unit.mem.rockrFunnel = unit.profile.funnel; unit.profile.funnel = { ...unit.profile.funnel, max: unit.profile.funnel.max * 2 }; }
    }
    whenSkillEnds(battle, unit, ':skill:yoke', () => {
      if (unit.mem.rockrOverloadAt == null) return;
      const overload = battle.time - unit.mem.rockrOverloadAt;
      unit.mem.rockrOverloadAt = null;
      for (const b of unit.buffs.filter((x) => String(x.key).includes(':skill:overload'))) battle.removeBuff(unit, b.key);
      if (unit.mem.rockrFunnel) { unit.profile.funnel = unit.mem.rockrFunnel; unit.mem.rockrFunnel = null; }
      if (active(unit) && overload > 0) effects(battle, unit, { index: 'skill' }).status(unit, { status: 'stun', duration: overload });
    });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { const e = rangeEnemies(battle, unit, 1)[0]; if (e) fx.damage(e, { scale: p('a') / 100, type: 'arts' }); },
    1: 'cast',
    2: 'cast',
    3: {
      // 立于磐石：每在场 15 秒（模组 10 秒）攻击力 +5%，最多 4 层（模组：叠满后攻击速度 +5）
      install: ({ battle, unit }) => {
        const buffKey = `assault:rockr:rock:${uid(unit)}`;
        battle.every(0.25, () => {
          if (!active(unit)) return;
          const module = moduleOf(unit) === ROCKR_MODULE;
          const n = Math.min(ROCKR_MAX, Math.floor((battle.time + 1e-9 - (unit.deployedAt ?? 0)) / (module ? ROCKR_MODULE_EVERY : ROCKR_EVERY)));
          const mods = { atkPct: ROCKR_STACK * n, ...(module && n >= ROCKR_MAX ? { aspd: ROCKR_MODULE_ASPD } : null) };
          const has = unit.buffs.find((b) => b.key === buffKey);
          if (!n) { if (has) battle.removeBuff(unit, buffKey); return; }
          if (!has || has.mods.atkPct !== mods.atkPct || has.mods.aspd !== mods.aspd) battle.addBuff(unit, { key: buffKey, mods, duration: Infinity, refresh: 'replace', source: unit });
        }, { owner: unit, immediate: true });
      },
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.charge(unit, p('d')),
    5: ({ unit, p, fx }) => fx.growth(unit, { key: 'rock', stat: 'atk', percent: p('e') / 100 }),
  },
  modules: {
    // 未命名的无人机 — read by line 3
    [ROCKR_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 至简 ---
// 神工意匠 at every deployment, stored three times; 忽有所悟 procs charge her (a self-trigger with its design benchmark);
// her neighbours' skills charge her and their kills grow her for the run.

const MALIST_HITS = 2, MALIST_PROC_SCALE = 150, MALIST_MODULE = 'uniequip_002_malist', MALIST_MODULE_CHANCE = 5, MALIST_MODULE_SCALE = 160;

const malist = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => !!nextAttack(battle, unit, effects(battle, unit, { index: 'skill' }, cause), { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', hits: MALIST_HITS }),
  lines: {
    0: 'cast',
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => {
        const procs = unit.mem.malistProcs ??= new Set();
        const rolled = new Map();
        onOwnDamage(battle, unit, ({ dmg }) => {
          if (!dmg.isAttack || dmg.isSkill) return;
          const module = moduleOf(unit) === MALIST_MODULE;
          if (!rolled.has(dmg.attackId)) {
            rolled.clear();
            const proc = battle.rng() < (p('b') + (module ? MALIST_MODULE_CHANCE : 0)) / 100;
            rolled.set(dmg.attackId, proc);
            if (proc) procs.add(dmg.attackId);
          }
          if (rolled.get(dmg.attackId)) dmg.amount *= (module ? MALIST_MODULE_SCALE : MALIST_PROC_SCALE) / 100;
        });
      },
      options: { accept: (payload, ctx) => ctx.unit.mem.malistProcs?.delete(payload.attackId) === true },
      run: ({ unit, p, fx }) => fx.charge(unit, p('c')),
    },
    3: ({ unit, p, fx }) => fx.charge(unit, p('d')),
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'insight', stat: 'atk', percent: p('e') / 100 }),
  },
  modules: {
    // “新家园”：忽有所悟几率再 +5%，攻击力提升至 160% — read by line 2
    [MALIST_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 梅尔 ---
// Mechanical otters at every deployment; 爆破回收 blows them all up and they come back 5 s later. Your other operators'
// summons falling or recalled charge her; every summon of theirs makes her otters stronger for the battle.

const OTTER = 'token_10004_otter_motter', OTTER_STUN = 2, OTTER_BACK = 5, OTTER_TOKEN_TICK = 0.25;
const OTTER_MODULE = 'uniequip_002_otter', OTTER_MODULE_COUNT = 1, OTTER_MODULE_SLOW = 5, OTTER_COUNTER = 'otter-boost';
const otterCap = (unit) => cardParam(unit, 0, 'a') + (moduleOf(unit) === OTTER_MODULE ? OTTER_MODULE_COUNT : 0);
const otterSpec = (unit, count) => ({ tokenId: OTTER, count, stockCap: otterCap(unit), fieldCap: otterCap(unit), ruleKey: `otter:${uid(unit)}` });
function otterBoost(battle, owner, token) {
  const pct = counterValue(battle, owner, OTTER_COUNTER) / 100;
  if (pct > 0) battle.addBuff(token, { key: `assault:otter:boost:${uid(owner)}`, mods: { hpPct: pct, atkPct: pct }, duration: Infinity, refresh: 'replace', source: owner });
}

const otter = (bb, raw, def) => synergyKit(def, {
  // the blast needs an enemy beside an otter
  canCast: ({ battle, unit }) => ownSummons(battle, unit, OTTER).some((token) => enemiesAround(battle, token, 1).length > 0),
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const otters = ownSummons(battle, unit, OTTER);
    for (const token of otters) for (const e of enemiesAround(battle, token)) {
      fx.damage(e, { scale: cardParam(unit, 1, 'b') / 100, type: 'arts', isSkill: true });
      if (e.alive) fx.status(e, { status: 'stun', duration: OTTER_STUN });
    }
    recall(battle, unit, otters, 'otterRecycle');
    // 被回收的机械水獭 5 秒后重新部署
    if (otters.length) battle.after(OTTER_BACK, () => { if (active(unit)) battle.assaultRuntime.withCause(cause, () => grantSummon(battle, unit, otterSpec(unit, otters.length))); }, { owner: unit });
    return otters.length > 0;
  },
  lines: {
    0: ({ battle, unit }) => grantSummon(battle, unit, otterSpec(unit, otterCap(unit))),
    1: 'cast',
    2: 'cast',
    3: () => {}, // 机械水獭：被机械水獭阻挡的敌人攻击速度 -c — the otter's own kit
    4: {
      // 「被击倒或回收」: the recall (summonReturned) counts as well as the fall the line is bound to
      install: ({ battle, unit, p }) => bindTrigger(battle, unit, { event: 'summonReturned', subject: 'otherAllies' }, { key: 'otter-return' },
        ({ cause }) => effects(battle, unit, { index: 4 }, cause).charge(unit, p('d'))),
      run: ({ unit, p, fx }) => fx.charge(unit, p('d')),
    },
    5: ({ battle, unit, p, fx }) => {
      fx.counter(unit, { key: OTTER_COUNTER, label: '机械水獭强化', amount: p('e'), suffix: '%' });
      for (const token of ownSummons(battle, unit, OTTER)) otterBoost(battle, unit, token);
    },
  },
  modules: {
    // 咪波控制终端XP：机械水獭 +1 只（otterCap）；被机械水獭阻挡的敌人攻击速度再 -5（the otter's kit）
    [OTTER_MODULE]: () => {},
  },
});
const otterToken = synergyToken(OTTER, (battle, token, owner) => {
  otterBoost(battle, owner, token);
  battle.every(OTTER_TOKEN_TICK, () => {
    if (!active(token)) return;
    const slow = cardParam(owner, 3, 'c') + (moduleOf(owner) === OTTER_MODULE ? OTTER_MODULE_SLOW : 0);
    for (const e of token.blocking ?? []) if (e.alive) battle.applyStatus(e, 'aspdDown', { duration: OTTER_TOKEN_TICK * 2, value: -slow, source: owner, instanceKey: `assault:otter:slow:${uid(token)}` });
  }, { owner: token, immediate: true });
});

/** A 「下次攻击」-style proc of the unit's normal attacks: one roll per attack (`chance(target)` → 0..1), `scale` (× ATK)
 * on a proc; `procs` collects the attack ids that procced (a line's runtime hit handler reads them). */
function attackProc(battle, unit, { chance, scale, procs = null }) {
  const rolled = new Map();
  onOwnDamage(battle, unit, ({ target, dmg }) => {
    if (!dmg.isAttack || dmg.isSkill) return;
    if (!rolled.has(dmg.attackId)) {
      rolled.clear();
      const proc = battle.rng() < chance(target);
      rolled.set(dmg.attackId, proc);
      if (proc) procs?.add(dmg.attackId);
    }
    if (rolled.get(dmg.attackId)) dmg.amount *= scale(target) / 100;
  });
}
/** 「攻击范围内（生命低于 x% 的）敌人受到 y% 脆弱」: an enemy aura whose value `pct()` may grow (read at each refresh). */
function fragileAura(battle, unit, key, pct, select) {
  const mods = { dmgTakenMul: 1 };
  enemyAura(battle, unit, { key, mods, select: (e) => { mods.dmgTakenMul = 1 + pct() / 100; return select(e); } });
}
const SURE_HELD = ['sleep', 'bind', 'frozen', 'stun'];
const isHeld = (e) => SURE_HELD.some((s) => hasStatus(e, s));
const nonElite = (e) => !isElite(e);
const randomOf = (battle, list) => (list.length ? list[Math.floor(battle.rng() * list.length) % list.length] : null);

// ------------------------------------------------------------------ 普罗旺斯 ---
// 狩猎箭头 procs more on a trembling enemy or the one right in front; the 叙拉古 kills charge her, and every kill of a bigger
// enemy by your other operators grows her for the run.

const PROVE_CHANCE = 20, PROVE_SURE = 50, PROVE_GATE = 0.8, PROVE_MODULE = 'uniequip_002_prove', PROVE_MODULE_REDEPLOY = 2, PROVE_MODULE_SCALE = 200;

const prove = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'scent', mods: { atkPct: cardParam(unit, 1, 'c') / 100 }, duration: cardParam(unit, 1, 'b') });
    return true;
  },
  install: (battle, unit) => battle.on('beforeAttack', (ctx) => {
    // 杀戮嗅觉：普通攻击不再以生命高于 80% 的敌人为目标
    if (ctx.attacker !== unit || ctx.isSkill || !hasBuff(unit, ':skill:scent')) return;
    const low = (e) => e.hp <= e.s.maxHp * PROVE_GATE + 1e-9;
    if (ctx.targets.every(low)) return;
    const others = rangeEnemies(battle, unit).filter(low);
    ctx.targets = ctx.targets.filter(low);
    for (const e of others) if (ctx.targets.length < (ctx.profile?.maxTargets || 1) && !ctx.targets.includes(e)) ctx.targets.push(e);
  }, { owner: unit }),
  lines: {
    0: ({ battle, unit, p, fx }) => {
      const target = rangeEnemies(battle, unit).sort((a, b) => a.hp - b.hp || uid(a).localeCompare(uid(b)))[0];
      if (target) fx.damage(target, { scale: p('a') / 100, type: 'phys' });
    },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => attackProc(battle, unit, {
        chance: (e) => (hasStatus(e, 'tremble') || enemiesOn(battle, aheadTiles(unit, 1)).includes(e) ? PROVE_SURE : PROVE_CHANCE) / 100,
        scale: () => (moduleOf(unit) === PROVE_MODULE ? PROVE_MODULE_SCALE : p('d')),
      }),
      run: () => {},
    },
    3: ({ unit, p, fx }) => fx.charge(unit, p('e')),
    4: { options: { accept: (payload, ctx) => (payload.target?.s?.maxHp ?? 0) > ctx.unit.s.maxHp },
      run: ({ unit, p, fx }) => fx.growth(unit, { key: 'hunting', stat: 'atk', percent: p('f') / 100 }) },
  },
  modules: {
    // 尾巴养护套装：再部署时间 -2 秒（之后每轮）；狩猎箭头攻击力提升至 200%（line 2）
    [PROVE_MODULE]: ({ unit, fx }) => {
      if (unit.mem.proveModuleShortened) return;
      unit.mem.proveModuleShortened = true;
      fx.redeployTime(unit, { seconds: PROVE_MODULE_REDEPLOY });
    },
  },
});

// -------------------------------------------------------------------- 雪猎 ---
// 风雪连弩 (stored twice) hits the immobile harder and sends 裂云兽 along; your other operators' 冻结 / 束缚 charge her, the
// skills of your other 谢拉格 make 裂云兽 hit harder for the battle.

const SNHUNT_HITS = 2, SNHUNT_HELD_SCALE = 260, SNHUNT_COLD = 3, SNHUNT_MODULE = 'uniequip_002_snhunt', SNHUNT_COUNTER = 'snhunt-beast';

function cloudBeast(battle, unit, fx, target, scale) {
  if (!target?.alive) return;
  fx.damage(target, { scale: scale * (1 + counterValue(battle, unit, SNHUNT_COUNTER) / 100), type: 'phys', isSkill: true });
  if (target.alive) fx.status(target, { status: 'cold', duration: SNHUNT_COLD });
}

const snhunt = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = rangeEnemies(battle, unit, 1)[0];
    if (!target) return false;
    const scale = (isHeld(target) ? SNHUNT_HELD_SCALE : cardParam(unit, 1, 'b')) / 100;
    fx.damage(target, { scale, type: 'phys', isSkill: true, hits: SNHUNT_HITS });
    cloudBeast(battle, unit, fx, target, cardParam(unit, 2, 'c') / 100); // 裂云一击：每次发动技能，同时派出裂云兽
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => cloudBeast(battle, unit, fx, rangeEnemies(battle, unit, 1)[0], p('a') / 100),
    1: 'cast',
    2: () => {}, // 裂云一击 rides the cast
    3: { options: { statuses: ['frozen', 'bind'] }, run: ({ unit, fx }) => fx.charge(unit, 1) },
    4: ({ unit, p, fx }) => fx.counter(unit, { key: SNHUNT_COUNTER, label: '裂云兽伤害', amount: p('d'), suffix: '%' }),
  },
  modules: {
    // 过去的狩猎：风雪连弩可储存次数 +1
    [SNHUNT_MODULE]: ({ unit }) => {
      if (unit.mem.snhuntModuleCharge) return;
      unit.mem.snhuntModuleCharge = true;
      unit.skill.maxCharges += 1;
    },
  },
});

// -------------------------------------------------------------------- 初雪 ---
// 自然震慑 strips defence and resistance; 虚弱化 makes the weakened ones in her range fragile, more with every 冻结 your other
// operators make. 双响: two targets an attack; your other operators' 寒冷 / 冻结 charge her.

const SLBELL_DEPLOY_DEF = 20, SLBELL_DEPLOY_RES = 10, SLBELL_DEPLOY_SECONDS = 5, SLBELL_LOW = 0.4, SLBELL_COUNTER = 'slbell-weaken';
const SLBELL_MODULE = 'uniequip_002_slbell', SLBELL_MODULE_CHANCE = 25, SLBELL_MODULE_COLD = 1;

const slbell = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = rangeEnemies(battle, unit);
    for (const e of targets) fx.buff(e, { key: 'awe', mods: { defMul: 1 - cardParam(unit, 1, 'a') / 100, resMul: 1 - cardParam(unit, 1, 'b') / 100 }, duration: cardParam(unit, 1, 'c') });
    return targets.length > 0;
  },
  install: (battle, unit) => onOwnAttack(battle, unit, ({ targets }) => {
    // “续针”：攻击有 25% 几率使目标寒冷 1 秒
    if (moduleOf(unit) !== SLBELL_MODULE) return;
    const fx = effects(battle, unit, { index: `module:${SLBELL_MODULE}` });
    for (const e of targets) if (e.alive && battle.rng() < SLBELL_MODULE_CHANCE / 100) fx.status(e, { status: 'cold', duration: SLBELL_MODULE_COLD });
  }),
  lines: {
    0: ({ battle, unit, fx }) => {
      for (const e of rangeEnemies(battle, unit)) fx.buff(e, { key: 'deploy-awe', mods: { defMul: 1 - SLBELL_DEPLOY_DEF / 100, resMul: 1 - SLBELL_DEPLOY_RES / 100 }, duration: SLBELL_DEPLOY_SECONDS });
    },
    1: 'cast',
    2: 'cast',
    3: ({ battle, unit, p, fx }) => {
      fragileAura(battle, unit, 'weaken', () => p('d') + counterValue(battle, unit, SLBELL_COUNTER), (e) => inRangeOf(unit, e) && e.hp < e.s.maxHp * SLBELL_LOW);
      // 双响（line 4's words）：攻击同时攻击 2 个目标 — kept up at every real deployment with her other standing effects
      fx.buff(unit, { key: 'double-ring', mods: { maxTargets: 1 }, persist: true });
    },
    4: {
      options: { statuses: ['cold', 'frozen'] },
      run: ({ unit, p, fx }) => fx.charge(unit, p('e')),
    },
    5: ({ unit, p, fx }) => fx.counter(unit, { key: SLBELL_COUNTER, label: '虚弱化脆弱', amount: p('f'), suffix: '%' }),
  },
  modules: {
    [SLBELL_MODULE]: () => {}, // “续针” — the kit's attack hook
  },
});

// -------------------------------------------------------------------- 巫恋 ---
// 诅咒娃娃 at every deployment: the enemies around the doll are weakened and tremble. Her 溃败暗示 grows with every
// trembling enemy your other operators kill; the 叙拉古 kills charge her.

const VODFOX_DOLL = 'token_10006_vodfox_doll', VODFOX_DOLL_SECONDS = 15, VODFOX_DOLL_TICK = 0.5, VODFOX_LOW = 0.4, VODFOX_COUNTER = 'vodfox-rout';
const VODFOX_MODULE = 'uniequip_002_vodfox', VODFOX_MODULE_AFTER = 10;

const vodfox = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    recall(battle, unit, ownSummons(battle, unit, VODFOX_DOLL), 'replace');
    battle.assaultRuntime.withCause(cause, () => grantSummon(battle, unit, { tokenId: VODFOX_DOLL, count: 1, stockCap: 1, fieldCap: 1, duration: VODFOX_DOLL_SECONDS, ruleKey: `vodfox:${uid(unit)}` }));
    return ownSummons(battle, unit, VODFOX_DOLL).length > 0;
  },
  lines: {
    0: 'cast',
    1: 'cast',
    2: ({ battle, unit, p }) => fragileAura(battle, unit, 'rout', () => p('b') + counterValue(battle, unit, VODFOX_COUNTER),
      (e) => inRangeOf(unit, e) && e.hp < e.s.maxHp * VODFOX_LOW),
    3: ({ unit, p, fx }) => fx.charge(unit, p('c')),
    4: { options: { accept: (payload) => hasStatus(payload.target, 'tremble') },
      run: ({ unit, p, fx }) => fx.counter(unit, { key: VODFOX_COUNTER, label: '溃败暗示脆弱', amount: p('d'), suffix: '%' }) },
  },
  modules: {
    // 布艺苹果：在场 10 秒后不容易成为敌人的攻击目标
    [VODFOX_MODULE]: ({ battle, unit }) => selfWhile(battle, unit, 'apple', { taunt: -1 }, () => battle.time + 1e-9 >= (unit.deployedAt ?? 0) + VODFOX_MODULE_AFTER),
  },
});
const vodfoxDoll = synergyToken(VODFOX_DOLL, (battle, token, owner) => {
  token.profile.noAttack = true;
  // the enemies around the doll: weakened while they stay (refreshed each tick), 战栗 once as they come in (one status a
  // stay, so the cards that answer a 战栗 see it once) and freed of it when they leave
  const cursed = new Set();
  const tremble = (e) => `assault:vodfox:tremble:${uid(token)}`;
  battle.every(VODFOX_DOLL_TICK, () => {
    if (!active(token)) return;
    const cut = 1 - cardParam(owner, 1, 'a') / 100;
    const around = enemiesAround(battle, token);
    for (const e of [...cursed]) if (!around.includes(e)) { cursed.delete(e); if (e.alive) battle.removeBuff(e, tremble(e)); }
    for (const e of around) {
      battle.addBuff(e, { key: `assault:vodfox:curse:${uid(token)}`, mods: { atkMul: cut, defMul: cut }, duration: VODFOX_DOLL_TICK + 0.1, refresh: 'replace', source: owner });
      if (cursed.has(e)) continue;
      cursed.add(e);
      const left = Math.max(VODFOX_DOLL_TICK, VODFOX_DOLL_SECONDS - (battle.time - (token.deployedAt ?? battle.time)));
      effects(battle, owner, { index: 'skill' }).status(e, { status: 'tremble', duration: left, key: tremble(e) });
    }
  }, { owner: token, immediate: true });
});

// -------------------------------------------------------------------- 海霓 ---
// 测绘器材的奇用 makes the non-elite enemies in her range fragile, more for every one of them your other operators kill;
// the skills of your other 阿戈尔 charge her.

const HAINI_DEPLOY_SLOW = 40, HAINI_DEPLOY_SECONDS = 5, HAINI_TARGETS = 4, HAINI_MODULE = 'uniequip_002_haini', HAINI_MODULE_FRAGILE = 25, HAINI_COUNTER = 'haini-survey';

const haini = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = rangeEnemies(battle, unit, HAINI_TARGETS);
    for (const e of targets) fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
    return targets.length > 0;
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const e of rangeEnemies(battle, unit)) if (nonElite(e)) fx.buff(e, { key: 'current', mods: { moveMul: 1 - HAINI_DEPLOY_SLOW / 100 }, duration: HAINI_DEPLOY_SECONDS }); },
    1: 'cast',
    2: ({ battle, unit, p }) => fragileAura(battle, unit, 'survey',
      () => (moduleOf(unit) === HAINI_MODULE ? HAINI_MODULE_FRAGILE : p('b')) + counterValue(battle, unit, HAINI_COUNTER), (e) => inRangeOf(unit, e) && nonElite(e)),
    3: ({ unit, fx }) => fx.charge(unit, 1),
    4: { options: { accept: (payload, ctx) => nonElite(payload.target) && inRangeOf(ctx.unit, payload.target) },
      run: ({ unit, p, fx }) => fx.counter(unit, { key: HAINI_COUNTER, label: '测绘器材脆弱', amount: p('c'), suffix: '%' }) },
  },
  modules: {
    // 多功能测绘仪-改良版：脆弱提升至 25% — read by line 2
    [HAINI_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 但书 ---
// The lawyer of 卡西米尔: her attack speed is shared with one 卡西米尔 at random; every deployment of your other operators
// grows the two of them for the run; your other operators' 停顿 charge her.

const PROVS_STOP = 0.8 + 0.5, PROVS_GROWTH = 1, PROVS_MODULE = 'uniequip_002_provs', PROVS_MODULE_ATK = 0.08;
const kazimierzOthers = (fx) => fx.allies('allies:卡西米尔');

const provs = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = nextAttack(battle, unit, fx, { scale: cardParam(unit, 1, 'b') / 100, type: 'arts' });
    // 稍微延长特性的停顿 ([ASSUMED] the 凝滞师 0.8 s + 0.5 s on this hit)
    if (target?.alive) fx.status(target, { status: 'sluggish', duration: PROVS_STOP });
    return !!target;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => {
      const partner = randomOf(battle, kazimierzOthers(fx));
      if (!partner) return;
      unit.mem.provsPartner = partner;
      fx.buff(partner, { key: 'law', mods: { aspd: p('a') }, persist: true });
      if (moduleOf(unit) === PROVS_MODULE) fx.buff(partner, { key: 'graduation', mods: { atkPct: PROVS_MODULE_ATK }, persist: true });
    },
    1: 'cast',
    2: ({ unit, p, fx }) => fx.buff(unit, { key: 'law', mods: { aspd: p('c') }, persist: true }),
    3: ({ unit, p, fx }) => fx.charge(unit, p('d')),
    4: ({ battle, unit, fx }) => {
      fx.growth(unit, { key: 'law', stat: 'aspd', flat: PROVS_GROWTH });
      const partner = randomOf(battle, kazimierzOthers(fx));
      if (partner) fx.growth(partner, { key: `law:${uid(unit)}`, stat: 'aspd', flat: PROVS_GROWTH });
    },
  },
  modules: {
    // 黛丝特的毕业礼：攻击力 +8%，同样赋予那名卡西米尔干员（line 0）
    [PROVS_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'graduation', mods: { atkPct: PROVS_MODULE_ATK }, persist: true }),
  },
});

// -------------------------------------------------------------------- 小满 ---
// 乡音沉沉 puts three to sleep and lets her hit three at once; your other 炎's skills charge her, the 停顿 of your other
// operators stacks her attack speed.

const GRABDS_DEPLOY_SHOTS = 3, GRABDS_DEPLOY_SCALE = 210, GRABDS_SLEEP_TARGETS = 3, GRABDS_SKILL_TARGETS = 2, GRABDS_TRAIT_PLUS = 0.3;
const GRABDS_MODULE = 'uniequip_002_grabds';

const grabds = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    for (const e of rangeEnemies(battle, unit, GRABDS_SLEEP_TARGETS + (moduleOf(unit) === GRABDS_MODULE ? 1 : 0))) fx.status(e, { status: 'sleep', duration: cardParam(unit, 1, 'a') });
    fx.sustain(unit, { key: 'lullaby', mods: { aspd: cardParam(unit, 2, 'c'), maxTargets: GRABDS_SKILL_TARGETS }, duration: cardParam(unit, 2, 'b') });
    return true;
  },
  install: (battle, unit) => {
    // the 凝滞师 停顿 of her attacks +0.3 s (line 3)
    let traitTarget = null;
    battle.on('hit', ({ source, target, dmg }) => { if (source === unit && dmg?.isAttack) traitTarget = target; }, { owner: unit, priority: 100 });
    battle.on('beforeStatus', (c) => {
      if (c.source !== unit || c.status !== 'sluggish' || c.target !== traitTarget) return;
      traitTarget = null;
      c.duration += GRABDS_TRAIT_PLUS;
    }, { owner: unit });
  },
  lines: {
    // 接下来 3 次攻击各造成 210% 法术伤害，并额外攻击 1 个敌人
    0: {
      install: ({ battle, unit }) => {
        const boosted = new Set();
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || ctx.isSkill || !((unit.mem.grabdsShots ?? 0) > 0)) return;
          const extra = rangeEnemies(battle, unit).find((e) => !ctx.targets.includes(e));
          if (extra) ctx.targets = [...ctx.targets, extra];
        }, { owner: unit });
        onOwnAttack(battle, unit, ({ attackId }) => { if ((unit.mem.grabdsShots ?? 0) > 0) { unit.mem.grabdsShots--; boosted.clear(); boosted.add(attackId); } });
        onOwnDamage(battle, unit, ({ dmg }) => { if (dmg.isAttack && boosted.has(dmg.attackId)) { dmg.amount *= GRABDS_DEPLOY_SCALE / 100; if (dmg.type === 'phys') dmg.type = 'arts'; } });
      },
      run: ({ unit }) => { unit.mem.grabdsShots = GRABDS_DEPLOY_SHOTS; },
    },
    1: 'cast',
    2: 'cast',
    3: ({ unit, p, fx }) => fx.buff(unit, { key: 'obey', mods: { aspd: p('d') }, persist: true }),
    4: ({ unit, p, fx }) => fx.charge(unit, p('e')),
    5: ({ unit, p, fx }) => fx.stack(unit, { key: 'obey', stat: 'aspd', amount: p('f') }),
  },
  modules: {
    // 在田野上：乡音沉沉的沉睡目标 +1 — read by the cast
    [GRABDS_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------- 凯瑟琳 ---
// Her support device keeps one operator in range behind a barrier that refills once it is left alone (every second
// during 战火淬炼); every deployment of your other 维多利亚 gives them a barrier, every broken barrier of your other
// operators makes her tougher for the battle.

const CATHY_DEVICE = 'token_10041_cathy_catsld', CATHY_REFILL = 0.06, CATHY_QUIET = 5, CATHY_SKILL_DEF = 0.3;
const CATHY_MODULE = 'uniequip_002_cathy', CATHY_MODULE_BARRIER = 30;
const cathyBarrierKey = (unit) => `assault:cathy:barrier:${uid(unit)}`;
function cathyBarrier(battle, unit, target, ratio, cause) {
  if (!target || !active(target)) return;
  const amount = unit.s.maxHp * ratio;
  battle.assaultRuntime.withCause(cause, () => battle.addBuff(target, { key: cathyBarrierKey(unit), shield: amount, duration: Infinity, refresh: 'replace', source: unit, data: { cap: amount } }));
}

const cathy = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'forged', mods: { hpPct: cardParam(unit, 1, 'c') / 100, defPct: CATHY_SKILL_DEF }, flags: { disarm: true },
      duration: cardParam(unit, 1, 'b') });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, cause }) => {
      if (!ownSummons(battle, unit, CATHY_DEVICE).length) battle.assaultRuntime.withCause(cause, () => grantSummon(battle, unit, { tokenId: CATHY_DEVICE, count: 1, stockCap: 1, fieldCap: 1, ruleKey: `cathy:${uid(unit)}` }));
      const target = rangeAllies(battle, unit).sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp || uid(a).localeCompare(uid(b)))[0] ?? unit;
      unit.mem.cathyTarget = target;
      cathyBarrier(battle, unit, target, (moduleOf(unit) === CATHY_MODULE ? CATHY_MODULE_BARRIER : p('a')) / 100, cause);
    },
    1: 'cast',
    // 定向支援信号：屏障目标 5 秒内未受攻击时（战火淬炼期间每秒），每秒补充凯瑟琳生命上限 6% 的屏障，不超过初始量
    2: {
      install: ({ battle, unit }) => battle.every(1, () => {
        const target = unit.mem.cathyTarget;
        if (!active(unit) || !active(target) || !ownSummons(battle, unit, CATHY_DEVICE).length) return;
        if (!hasBuff(unit, ':skill:forged') && battle.time - (target.lastHitAt ?? -Infinity) < CATHY_QUIET) return;
        const cap = unit.s.maxHp * (moduleOf(unit) === CATHY_MODULE ? CATHY_MODULE_BARRIER : cardParam(unit, 0, 'a')) / 100;
        const now = target.buffs.find((b) => b.key === cathyBarrierKey(unit))?.shield ?? 0;
        const next = Math.min(cap, now + unit.s.maxHp * CATHY_REFILL);
        if (next > now + 1e-9) battle.addBuff(target, { key: cathyBarrierKey(unit), shield: next, duration: Infinity, refresh: 'replace', source: unit });
      }, { owner: unit }),
      run: () => {},
    },
    3: ({ battle, unit, p, actor, cause }) => {
      battle.assaultRuntime.withCause(cause, () => battle.addBuff(actor, { key: `assault:cathy:signal:${uid(unit)}`, shield: unit.s.maxHp * p('d') / 100, duration: Infinity, refresh: 'replace', source: unit }));
    },
    4: { options: { accept: (payload) => payload.shieldKind === 'hp' }, run: ({ unit, p, fx }) => fx.stack(unit, { key: 'signal', stat: 'maxHp', amount: p('e') / 100, mode: 'percent' }) },
  },
  modules: {
    // 闲暇时分：支援装置的屏障提升至凯瑟琳生命上限 30% — read by lines 0 and 2
    [CATHY_MODULE]: () => {},
  },
});
const cathyDevice = synergyToken(CATHY_DEVICE, (battle, token) => { token.profile.noAttack = true; });

// -------------------------------------------------------------------- 海蒂 ---
// The bard: her range is her stage — defence and SP for everyone on it, 鼓舞 during her story; each new enemy the
// operators in her range block charges that operator.

const HEIDI_INSPIRE_DEF = 0.7, HEIDI_INSPIRE_HP = 0.3, HEIDI_MODULE = 'uniequip_002_heidi', HEIDI_MODULE_DEF = 9;

const heidi = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const mods = { blockCnt: 1, defFlat: unit.s.def * HEIDI_INSPIRE_DEF, hpFlat: unit.s.maxHp * HEIDI_INSPIRE_HP };
    // [ASSUMED] 鼓舞 is for the others in her range (a bard does not inspire herself)
    for (const x of rangeAllies(battle, unit, { others: true })) fx.sustain(x, { key: 'rust-town', mods, duration: cardParam(unit, 1, 'b') });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const x of rangeAllies(battle, unit, { others: true })) fx.accelerate(x, p('a')); },
    1: 'cast',
    2: ({ battle, unit, p }) => allyAura(battle, unit, { key: 'rebel', mods: { defPct: (moduleOf(unit) === HEIDI_MODULE ? HEIDI_MODULE_DEF : p('c')) / 100 },
      select: (x) => inRangeOf(unit, x) }),
    3: ({ battle, unit, p }) => allyAura(battle, unit, { key: 'courier', mods: { spRecoveryFlat: p('d') }, select: (x) => x !== unit && inRangeOf(unit, x) }),
    4: { options: { around: 'range' }, run: ({ actor, fx }) => fx.charge(actor, 1) },
  },
  modules: {
    // 华贵璀璨的死斗：机敏的反抗者提升至 +9% — read by line 2
    [HEIDI_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 九色鹿 ---
// 飘渺彩云 shelters the low in her range (everyone during 仙山去远); every heal your other operators give makes hers bigger
// for the battle, and their heals of the low charge her.

const NCDEER_SANCTUARY_SECONDS = 10, NCDEER_LOW = 0.4, NCDEER_DODGE = 0.7, NCDEER_COUNTER = 'ncdeer-elixir';
const NCDEER_MODULE = 'uniequip_002_ncdeer', NCDEER_MODULE_LOW = 0.6, NCDEER_MODULE_SANCTUARY = 26;
const sanctuary = (pct) => ({ dmgTakenMul: 1 - pct / 100 });

const ncdeer = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'immortal', mods: { aspd: cardParam(unit, 1, 'd') }, duration: cardParam(unit, 1, 'c') });
    return true;
  },
  install: (battle, unit) => {
    // 仙山去远：获得 70% 远程物理抵挡 (a ranged enemy's physical hit on her misses at 70%)
    battle.on('hit', ({ source, target, dmg }) => {
      if (target !== unit || !hasBuff(unit, ':skill:immortal') || dmg?.type !== 'phys' || source?.side !== 'enemy' || source.profile?.attack !== 'ranged') return;
      if (battle.rng() < NCDEER_DODGE) dmg.cancel = true;
    }, { owner: unit, priority: 50 });
    // “仙药”：此干员治疗量 +f%（本场叠加）
    battle.on('heal', (ctx) => { if (ctx.source === unit && Number.isFinite(ctx.amount)) ctx.amount *= 1 + counterValue(battle, unit, NCDEER_COUNTER) / 100; }, { owner: unit, priority: 100 });
  },
  lines: {
    0: ({ battle, unit, p, fx }) => {
      for (const x of rangeAllies(battle, unit)) {
        fx.heal(x, { scale: p('a') / 100 });
        fx.buff(x, { key: 'deploy-cloud', mods: sanctuary(p('b')), duration: NCDEER_SANCTUARY_SECONDS });
      }
    },
    1: 'cast',
    2: ({ battle, unit, p }) => {
      const module = moduleOf(unit) === NCDEER_MODULE;
      allyAura(battle, unit, { key: 'cloud', mods: sanctuary(module ? NCDEER_MODULE_SANCTUARY : p('e')),
        select: (x) => inRangeOf(unit, x) && (hasBuff(unit, ':skill:immortal') || x.hp < x.s.maxHp * (module ? NCDEER_MODULE_LOW : NCDEER_LOW)) });
    },
    3: { options: { accept: (payload) => payload.target && payload.target.hp - (payload.amount ?? 0) < payload.target.s.maxHp * NCDEER_LOW },
      run: ({ unit, fx }) => fx.charge(unit, 1) },
    4: ({ unit, p, fx }) => fx.counter(unit, { key: NCDEER_COUNTER, label: '治疗量', amount: p('f'), suffix: '%' }),
  },
  modules: {
    // “仙药”（模组）：飘渺彩云改为生命低于 60% 时生效，庇护提升至 26% — read by line 2
    [NCDEER_MODULE]: () => {},
  },
});

const airborneOrFlying = (e) => isFlyer(e) || hasStatus(e, 'levitate') || hasStatus(e, 'weightless');
/** 失重 (no native status of its own): a status the cards bind and read (statusApplied 'weightless', hasStatus). */
const weightless = (battle, unit, e, duration, cause) => battle.assaultRuntime.withCause(cause, () => battle.applyStatus(e, 'weightless', { duration, source: unit }));

// -------------------------------------------------------------------- 阿罗玛 ---
// 起泡性能测试 lifts each enemy at her first hit; your other operators' lifts charge her, their kills of lifted or flying
// enemies stack her attack.

const AROMA_DEPLOY_LIFT = 1.5, AROMA_LIFT = 2.5, AROMA_MODULE = 'uniequip_002_aroma', AROMA_MODULE_SCALE = 125;

const aroma = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = rangeEnemies(battle, unit, 1)[0];
    if (!target) return false;
    fx.damage(target, { scale: (cardParam(unit, 1, 'a') + (airborneOrFlying(target) ? cardParam(unit, 1, 'b') : 0)) / 100, type: 'arts', isSkill: true });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const e of rangeEnemies(battle, unit)) if (!isFlyer(e)) fx.status(e, { status: 'levitate', duration: AROMA_DEPLOY_LIFT }); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => {
        const met = new WeakSet();
        onOwnDamage(battle, unit, ({ target, dmg }) => {
          if (!dmg.isAttack || met.has(target)) return;
          met.add(target);
          dmg.amount *= (moduleOf(unit) === AROMA_MODULE ? AROMA_MODULE_SCALE : p('c')) / 100;
          if (target.alive && !isFlyer(target)) effects(battle, unit, { index: 2 }).status(target, { status: 'levitate', duration: AROMA_LIFT });
        });
      },
      run: () => {},
    },
    3: { options: { statuses: ['levitate', 'weightless'] }, run: ({ unit, fx }) => fx.charge(unit, 1) },
    4: { options: { accept: (payload) => airborneOrFlying(payload.target) },
      run: ({ unit, p, fx }) => fx.stack(unit, { key: 'foam', stat: 'atk', amount: p('d') / 100, mode: 'percent' }) },
  },
  modules: {
    // 柠檬味的童年：起泡性能测试的攻击力提升至 125% — read by line 2
    [AROMA_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 能天使 ---
// 天使的祝福: each of her deployments blesses one other operator (two with the module) for the battle; the blessed ones'
// skills charge her. Every deployment of your other 企鹅物流 brings DP.

const ANGEL_SHOTS = 5, ANGEL_SCALE = 110, ANGEL_MODULE = 'uniequip_002_angel', ANGEL_MODULE_AIR = 110;

const angel = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'overload', mods: { batPct: INTERVAL.shorter }, duration: cardParam(unit, 1, 'c') });
    return true;
  },
  install: (battle, unit) => {
    // 过载模式：攻击变为 5 连射，攻击力提升至 110%
    onOwnAttack(battle, unit, ({ targets, attackId }) => {
      if (!hasBuff(unit, ':skill:overload')) return;
      for (const e of targets) for (let i = 1; i < ANGEL_SHOTS && e.alive; i++) extraHit(battle, unit, e, { attackId });
    });
    onOwnDamage(battle, unit, ({ target, dmg }) => {
      if (!dmg.isAttack) return;
      if (hasBuff(unit, ':skill:overload')) dmg.amount *= ANGEL_SCALE / 100; // every shot of the volley
      if (moduleOf(unit) === ANGEL_MODULE && isFlyer(target)) dmg.amount *= ANGEL_MODULE_AIR / 100; // 能天使的杰作
    });
  },
  lines: {
    0: ({ battle, unit, p, fx }) => {
      const blessed = unit.mem.angelBlessed ??= new Set();
      const pool = fx.allies('otherAllies');
      for (let i = 0; i < (moduleOf(unit) === ANGEL_MODULE ? 2 : 1) && pool.length; i++) {
        const x = pool.splice(Math.floor(battle.rng() * pool.length) % pool.length, 1)[0];
        blessed.add(uid(x));
        fx.stack(x, { key: 'blessing-atk', stat: 'atk', amount: p('a') / 100, mode: 'percent' });
        fx.stack(x, { key: 'blessing-hp', stat: 'maxHp', amount: p('b') / 100, mode: 'percent' });
      }
    },
    1: 'cast',
    // 天使的祝福 on herself; 快速弹匣 (line 4's words): 攻击速度 +f
    2: ({ unit, p, fx }) => {
      fx.buff(unit, { key: 'blessing', mods: { atkPct: p('d') / 100, hpPct: p('e') / 100 }, persist: true });
      fx.buff(unit, { key: 'magazine', mods: { aspd: cardParam(unit, 4, 'f') }, persist: true });
    },
    3: { options: { accept: (payload, ctx) => ctx.unit.mem.angelBlessed?.has(uid(payload.source)) === true }, run: ({ unit, fx }) => fx.charge(unit, 1) },
    4: ({ p, fx }) => fx.dp(p('g')),
  },
  modules: {
    // 能天使的杰作：攻击空中敌人时攻击力提升至 110%；祝福对象 +1 名 — read by the kit and line 0
    [ANGEL_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 空弦 ---
// 箭矢·追猎 (stored up to three times) bounces five times and hastes your other 狙击; her SP aura feeds them, her broken
// shield charges them, and every broken shield or barrier of your other operators charges her.

const ARCHET_ARROWS = 5, ARCHET_MODULE = 'uniequip_003_archet', ARCHET_MODULE_AURA = 0.4, ARCHET_MODULE_SELF = 0.5;
const snipers = (fx) => fx.allies('allies:狙击');

const archet = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const first = rangeEnemies(battle, unit, 1)[0];
    if (!first) return false;
    // 依次弹射至其他敌人: the chain from the first target, round again over the same ones when there are fewer than five
    const chain = chainFrom(battle, first, ARCHET_ARROWS, 2.5);
    for (let i = 0; i < ARCHET_ARROWS; i++) { const e = chain[i % chain.length]; if (e?.alive) fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true }); }
    for (const x of snipers(fx)) fx.accelerate(x, cardParam(unit, 2, 'b'));
    return true;
  },
  lines: {
    0: ({ battle, unit, cause }) => battle.assaultRuntime.withCause(cause, () => battle.addBuff(unit, { key: `assault:archet:shield:${uid(unit)}`, shieldHits: 1, duration: Infinity,
      refresh: 'replace', source: unit, visible: true })),
    1: 'cast',
    2: 'cast',
    3: ({ battle, unit, p }) => allyAura(battle, unit, { key: 'landon', mods: { spRecoveryFlat: moduleOf(unit) === ARCHET_MODULE ? ARCHET_MODULE_AURA : p('c') },
      select: (x) => x !== unit && matchesClass(x, { label: '狙击' }) }),
    4: ({ unit, p, fx }) => { for (const x of snipers(fx)) fx.charge(x, p('d')); },
    5: ({ unit, p, fx }) => fx.charge(unit, p('e')),
  },
  modules: {
    // 旧日重现：兰登战术提升至 +0.4/秒（line 3）；场上有其他狙击干员时，此干员技力自然回复速度 +0.5/秒
    [ARCHET_MODULE]: ({ battle, unit, fx }) => selfWhile(battle, unit, 'old-days', { spRecoveryFlat: ARCHET_MODULE_SELF }, () => snipers(fx).length > 0),
  },
});

// -------------------------------------------------------------------- 远牙 ---
// 屏息 hits the enemies your other operators block harder, every new block of theirs stacks her attack; 凝神 holds while
// nothing has hurt her for 10 s.

const FARTTH_QUIET = 10, FARTTH_FAR = 140, FARTTH_SKILL_REACH = 2, FARTTH_MODULE = 'uniequip_002_fartth', FARTTH_MODULE_FAR = 15;

const fartth = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    // 光羽箭 ([ASSUMED] the infinite line ahead as two more tiles of range): 攻击力 +c%，原本范围外的目标伤害提升至 140%；屏息：不容易成为目标
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'feather', mods: { atkPct: cardParam(unit, 1, 'c') / 100, rangeExtend: FARTTH_SKILL_REACH, taunt: -1 },
      duration: cardParam(unit, 1, 'b') });
    return true;
  },
  install: (battle, unit) => onOwnDamage(battle, unit, ({ target, dmg }) => {
    const base = new Set(unit.baseRangeKeys ?? []);
    const [r, c] = tileOf(target);
    if (hasBuff(unit, ':skill:feather')) { dmg.canDodge = false; if (!base.has(r * COLS + c)) dmg.mul *= FARTTH_FAR / 100; }
    if (moduleOf(unit) === FARTTH_MODULE) dmg.mul *= 1 + FARTTH_MODULE_FAR / 100 * Math.min(1, (Math.abs(r - unit.tileR) + Math.abs(c - unit.tileC)) / 4); // 首战支援套组
  }),
  lines: {
    0: ({ battle, unit, p, fx }) => { const e = enemiesOn(battle, aheadTiles(unit, 20))[0] ?? null; if (e) fx.damage(e, { scale: p('a') / 100, type: 'phys' }); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => selfWhile(battle, unit, 'focus', { atkPct: p('d') / 100 }, () => battle.time - (unit.lastHitAt ?? -Infinity) >= FARTTH_QUIET),
      run: () => {},
    },
    3: {
      install: ({ battle, unit, p }) => onOwnDamage(battle, unit, ({ target, dmg }) => {
        if (dmg.isAttack && target.blockedBy && target.blockedBy !== unit) dmg.amount *= p('e') / 100;
      }),
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'focus', stat: 'atk', amount: p('f') / 100, mode: 'percent' }),
  },
  modules: {
    // 首战支援套组：攻击越远的敌人伤害越高（最高 +15%）— the kit's damage hook
    [FARTTH_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------- 蕾缪安 ---
// 通缉: her deployment marks the strongest in range; elites that stay in your 拉特兰's ranges are wanted too and take more
// from them. 礼炮 locks five (seven with the module) and shells them. The ammo skills of your other 拉特兰 charge her;
// their kills of wanted enemies grow her for the run.

const LEMUEN_ROUNDS = 5, LEMUEN_LOCK_EVERY = 0.5, LEMUEN_SPLASH = 300, LEMUEN_MODULE = 'uniequip_002_lemuen', LEMUEN_MODULE_ROUNDS = 2;
const laterano = (battle, unit) => battle.assaultDeploymentOrder().filter((x) => isOp(x) && active(x) && x.ownerId === unit.ownerId && matchesClass(x, { label: '拉特兰' }));

const lemuen = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const rounds = LEMUEN_ROUNDS + (moduleOf(unit) === LEMUEN_MODULE ? LEMUEN_MODULE_ROUNDS : 0);
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'salute', mods: {}, flags: { disarm: true }, duration: rounds * LEMUEN_LOCK_EVERY + 0.1 });
    const locks = [];
    let n = 0;
    const timer = battle.every(LEMUEN_LOCK_EVERY, () => {
      // 依次锁定敌人: the wanted first, then the order of her range
      const pool = [...battle.enemies.filter((e) => e.alive && !e.removed && isWanted(e)), ...rangeEnemies(battle, unit)];
      const pick = pool.find((e) => !locks.includes(e)) ?? pool[0];
      if (pick) locks.push(pick);
      if (++n < rounds) return;
      timer.cancel();
      const fx = effects(battle, unit, { index: 'skill' }, cause);
      for (const e of locks) {
        if (!e.alive) continue;
        fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
        for (const x of enemiesAround(battle, e)) if (x !== e) fx.damage(x, { scale: LEMUEN_SPLASH / 100, type: 'phys', isSkill: true });
      }
    }, { owner: unit });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => {
      const strongest = rangeEnemies(battle, unit).sort((a, b) => b.hp - a.hp || uid(a).localeCompare(uid(b)))[0];
      if (strongest) fx.raw.synergy.markWanted(battle, unit, strongest);
      if (moduleOf(unit) === LEMUEN_MODULE) for (const x of fx.allies('allies:拉特兰')) fx.raw.synergy.maxAmmo(x, `lemuen:${uid(unit)}`, 1); // “弹匣与花窗”
    },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => {
        // 跨境追缉许可: an elite or leader that stays over b s inside your 拉特兰's ranges is wanted; your 拉特兰 deal it +c%
        const dwell = new Map();
        battle.every(0.25, () => {
          if (!active(unit)) return;
          const hunters = laterano(battle, unit);
          for (const e of battle.enemies) {
            if (!e.alive || e.removed || !isElite(e) || isWanted(e)) continue;
            const inside = hunters.some((x) => new Set(x.rangeKeys ?? []).has(tileOf(e)[0] * COLS + tileOf(e)[1]));
            const t = inside ? (dwell.get(e) ?? 0) + 0.25 : 0;
            dwell.set(e, t);
            if (t > p('b') + 1e-9) effects(battle, unit, { index: 2 }).raw.synergy.markWanted(battle, unit, e);
          }
        }, { owner: unit });
        battle.on('hit', ({ source, target, dmg }) => {
          if (!active(unit) || !dmg || !isWanted(target) || !isOp(source) || source.ownerId !== unit.ownerId || !matchesClass(source, { label: '拉特兰' })) return;
          dmg.mul *= 1 + p('c') / 100;
        }, { owner: unit, priority: 90 });
      },
      run: () => {},
    },
    3: { options: { accept: (payload) => ammoCard(payload.source) }, run: ({ unit, fx }) => fx.charge(unit, 2) },
    4: { options: { accept: (payload) => isWanted(payload.target) }, run: ({ unit, p, fx }) => fx.growth(unit, { key: 'extradition', stat: 'atk', percent: p('d') / 100 }) },
  },
  modules: {
    // “弹匣与花窗”：礼炮·强制追思多装填 2 发（多锁定 2 名敌人, read by the cast）；你的其他拉特兰干员弹药上限 +1（line 0）
    [LEMUEN_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------- 迷迭香 ---
// Every skill of your other 术师 makes her cast 思维膨大 at once; her deployment raises one random other 术师 for the battle.

const ROSMON_ATK = 0.08, ROSMON_MODULE = 'uniequip_002_rosmon', ROSMON_MODULE_SHOCKS = 2, ROSMON_MODULE_SHOCK = 0.5;

const rosmon = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => !!nextAttack(battle, unit, effects(battle, unit, { index: 'skill' }, cause), { scale: cardParam(unit, 1, 'b') / 100, type: 'arts' }),
  install: (battle, unit) => onOwnAttack(battle, unit, ({ targets, attackId }) => {
    // “记事”：攻击改为三次物理伤害（后两次为 50% 余震）
    if (moduleOf(unit) !== ROSMON_MODULE) return;
    for (const e of targets) for (let i = 0; i < ROSMON_MODULE_SHOCKS && e.alive; i++) extraHit(battle, unit, e, { attackId, scale: ROSMON_MODULE_SHOCK });
  }),
  lines: {
    0: ({ battle, unit, p, fx }) => {
      const x = randomOf(battle, fx.allies('allies:术师'));
      if (x) fx.stack(x, { key: 'expansion', stat: 'atk', amount: p('a') / 100, mode: 'percent' });
    },
    1: 'cast',
    2: ({ unit, fx }) => fx.castSkill(unit),
    // 歼灭战装备：攻击无视目标 c 防御；感知稳定（line 2's words）：此干员攻击力 +8%
    3: ({ unit, p, fx }) => fx.buff(unit, { key: 'gear', mods: { defIgnoreFlat: p('c'), atkPct: ROSMON_ATK }, persist: true }),
  },
  modules: {
    [ROSMON_MODULE]: () => {}, // “记事” — the kit's attack hook
  },
});

// ------------------------------------------------------------------ 维什戴尔 ---
// 残影: her hits mark their main target; an aftershock on a marked one may blow it up, and a stun by your other operators
// always does. Every summon of your other operators that falls grows her for the run.

const WISDEL_SHADE = 'token_10035_wisdel_wward', WISDEL_MAIN = 115, WISDEL_BURST_CHANCE = 15, WISDEL_BURST_STUN = 1, WISDEL_SHOCKS = 2, WISDEL_SHOCK = 120;
const WISDEL_MODULE = 'uniequip_002_wisdel', WISDEL_MODULE_BURST = 185;
const remnantKey = (unit) => `assault:wisdel:remnant:${uid(unit)}`;
function remnantBurst(battle, unit, e, cause) {
  if (!e?.alive || !e.buffs.some((b) => b.key === remnantKey(unit))) return false;
  battle.removeBuff(e, remnantKey(unit));
  const fx = effects(battle, unit, { index: 2 }, cause);
  const scale = (moduleOf(unit) === WISDEL_MODULE ? WISDEL_MODULE_BURST : cardParam(unit, 2, 'b')) / 100;
  for (const x of enemiesAround(battle, e)) { fx.damage(x, { scale, type: 'phys' }); if (x.alive) fx.status(x, { status: 'stun', duration: WISDEL_BURST_STUN }); }
  return true;
}
function aftershock(battle, unit, fx, e, scale) {
  if (!e?.alive) return;
  fx.damage(e, { scale, type: 'phys', isSkill: true });
  if (battle.rng() < WISDEL_BURST_CHANCE / 100) remnantBurst(battle, unit, e);
}

const wisdel = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const main = rangeEnemies(battle, unit, 1)[0];
    if (!main) return false;
    const hit = enemiesAround(battle, main);
    fx.damage(main, { scale: 1, type: 'phys', isSkill: true });
    for (const e of hit) {
      for (let i = 0; i < WISDEL_SHOCKS; i++) aftershock(battle, unit, fx, e, WISDEL_SHOCK / 100);
      if (e.alive) fx.status(e, { status: 'stun', duration: cardParam(unit, 1, 'a') });
    }
    return true;
  },
  lines: {
    0: ({ battle, unit, cause }) => {
      recall(battle, unit, ownSummons(battle, unit, WISDEL_SHADE), 'replace');
      battle.assaultRuntime.withCause(cause, () => grantSummon(battle, unit, { tokenId: WISDEL_SHADE, count: 1, stockCap: 1, fieldCap: 1, ruleKey: `wisdel:${uid(unit)}` }));
    },
    1: 'cast',
    2: {
      install: ({ battle, unit }) => {
        // 好礼: the main target of her attack takes 115% and a 残影; 迷彩 near her shade (line 0's words)
        onOwnDamage(battle, unit, ({ target, dmg }) => {
          if (!dmg.isAttack || dmg.isSplash) return;
          dmg.amount *= WISDEL_MAIN / 100;
          battle.addBuff(target, { key: remnantKey(unit), mods: {}, duration: Infinity, refresh: 'replace', source: unit, visible: true });
        });
        selfWhile(battle, unit, 'shade-camou', {}, () => ownSummons(battle, unit, WISDEL_SHADE).some((t) => around8(t, unit)), { camou: true });
      },
      run: () => {},
    },
    3: { options: { accept: (payload, ctx) => !!payload.target?.buffs?.some((b) => b.key === remnantKey(ctx.unit)) },
      run: ({ battle, unit, target, cause }) => remnantBurst(battle, unit, target, cause) },
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'last-breath', stat: 'atk', percent: p('c') / 100 }),
  },
  modules: {
    // “祖宗发射器”：残影爆炸伤害提升至 185% — read by remnantBurst
    [WISDEL_MODULE]: () => {},
  },
});
const wisdelShade = synergyToken(WISDEL_SHADE, (battle, token) => { token.profile.noAttack = true; });

// -------------------------------------------------------------------- 莱伊 ---
// Her sand beast scouts a zone for 25 s: she hits harder there, and every kill your other operators make in it grows her
// for the run. 脱身矢 (stored twice) gives its charge back when it kills — a self-trigger with its design benchmark.

const RAY_BEAST = 'token_10034_ray_sndbst', RAY_BEAST_SECONDS = 25, RAY_ZONE_BONUS = 15, RAY_PUSH = 3, RAY_REFUND_COOLDOWN = 3, RAY_STACKS = 3;
const RAY_MODULE = 'uniequip_002_ray', RAY_MODULE_BIND = 1.5;
const inBeastZone = (battle, unit, e) => ownSummons(battle, unit, RAY_BEAST).some((t) => around8(t, e));

const ray = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = rangeEnemies(battle, unit, 1)[0];
    if (!target) return false;
    fx.damage(target, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
    if (target.alive) {
      battle.push(target, RAY_PUSH, { from: unit });
      if (moduleOf(unit) === RAY_MODULE) fx.status(target, { status: 'bind', duration: RAY_MODULE_BIND }); // 《跳舞的月光》
    } else if (!(battle.time + 1e-9 < (unit.mem.rayRefundAt ?? -Infinity) + RAY_REFUND_COOLDOWN)) {
      // 若此击击倒敌人，立即补回 1 次储存（每 3 秒最多一次）
      unit.mem.rayRefundAt = battle.time;
      battle.after(0, () => { if (unit.skill && unit.skill.charges < unit.skill.maxCharges) unit.skill.charges++; }, { owner: unit });
    }
    return true;
  },
  lines: {
    0: ({ battle, unit, cause }) => {
      if (!ownSummons(battle, unit, RAY_BEAST).length) battle.assaultRuntime.withCause(cause, () => grantSummon(battle, unit, { tokenId: RAY_BEAST, count: 1, stockCap: 1, fieldCap: 1,
        duration: RAY_BEAST_SECONDS, ruleKey: `ray:${uid(unit)}` }));
    },
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit, p }) => {
        // 入神：攻击相同目标时，每次攻击攻击力 +b%（最多 3 层）; the sand beast's zone: 物理伤害 +15% (line 0's words)
        let last = null, stacks = 0;
        onOwnAttack(battle, unit, ({ targets }) => { const t = targets[0]; stacks = t && t === last ? Math.min(RAY_STACKS, stacks + 1) : 0; last = t ?? null; });
        onOwnDamage(battle, unit, ({ target, dmg }) => {
          if (dmg.isAttack && target === last) dmg.amount *= 1 + stacks * p('b') / 100;
          if (dmg.type === 'phys' && inBeastZone(battle, unit, target)) dmg.mul *= 1 + RAY_ZONE_BONUS / 100;
        });
      },
      run: () => {},
    },
    4: { options: { accept: (payload, ctx) => inBeastZone(ctx.battle, ctx.unit, payload.target) },
      run: ({ unit, p, fx }) => fx.growth(unit, { key: 'patrol', stat: 'atk', percent: p('c') / 100 }) },
  },
  modules: {
    // 《跳舞的月光》：脱身矢命中时束缚 1.5 秒（the cast）
    [RAY_MODULE]: () => {},
  },
});
const rayBeast = synergyToken(RAY_BEAST, (battle, token) => { token.profile.noAttack = true; });

// ------------------------------------------------------------------ 霍尔海雅 ---
// The full-health enemies in her range are weightless; she hits the airborne harder and silences them. Your other
// operators' lifts charge her, their kills of airborne enemies grow her for the run.

const HEYAK_DEPLOY = 3, HEYAK_GATE = 0.8, HEYAK_SILENCE = 3, HEYAK_TARGETS = 2, HEYAK_MODULE = 'uniequip_002_heyak', HEYAK_MODULE_RES = 10;

const heyak = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = rangeEnemies(battle, unit, HEYAK_TARGETS);
    for (const e of targets) fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
    if (targets.length === 1 && targets[0].alive) fx.status(targets[0], { status: 'levitate', duration: cardParam(unit, 1, 'b') });
    return targets.length > 0;
  },
  lines: {
    0: ({ battle, unit, cause }) => { for (const e of rangeEnemies(battle, unit)) weightless(battle, unit, e, HEYAK_DEPLOY, cause); },
    1: 'cast',
    2: ({ battle, unit }) => enemyAura(battle, unit, { key: 'wings', flags: { float: true }, select: (e) => inRangeOf(unit, e) && e.hp > e.s.maxHp * HEYAK_GATE }),
    3: {
      install: ({ battle, unit, p }) => onOwnDamage(battle, unit, ({ target, dmg }) => {
        if (!airborneOrFlying(target)) return;
        dmg.amount *= p('c') / 100;
        if (target.alive) effects(battle, unit, { index: 3 }).status(target, { status: 'silence', duration: HEYAK_SILENCE });
      }),
      run: () => {},
    },
    4: ({ unit, fx }) => fx.charge(unit, 1),
    5: { options: { accept: (payload) => airborneOrFlying(payload.target) }, run: ({ unit, p, fx }) => fx.growth(unit, { key: 'legacy', stat: 'atk', percent: p('d') / 100 }) },
  },
  modules: {
    [HEYAK_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'library', mods: { resIgnoreFlat: HEYAK_MODULE_RES }, persist: true }),
  },
});

// -------------------------------------------------------------------- 逻各斯 ---
// 剜魂具辞 opens what he hits to arts; every element burst your other operators cause in his range deepens it for the run.
// The skills of your other 罗德岛 charge him. 延异视阈 slows the enemy bullets in his range to 5 % and clears them as it ends.

const LOGOS_DEPLOY_TARGETS = 3, LOGOS_DEPLOY_SCALE = 120, LOGOS_NECROSIS = 0.08, LOGOS_SKILL_TARGETS = 3, LOGOS_PROC = 40, LOGOS_PROC_STOP = 0.8;
const LOGOS_BULLET_SLOW = 0.95; // skchr_logos_3 projectile_move_scale 0.05
const LOGOS_RES = 10, LOGOS_MARK_SECONDS = 5, LOGOS_COUNTER = 'logos-depth', LOGOS_MODULE = 'uniequip_002_logos', LOGOS_MODULE_BURST = 60;
const logosMark = (unit) => `assault:logos:word:${uid(unit)}`;

const logos = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'differance', mods: { rangeExtend: 1, atkPct: cardParam(unit, 1, 'b') / 100, maxTargets: LOGOS_SKILL_TARGETS },
      duration: cardParam(unit, 1, 'a') });
    // 攻击范围内敌方子弹飞行速度 -95%, until the skill (a recast's longer one too) ends: then 清除攻击范围内全部敌方子弹
    slowEnemyProjectiles(battle, unit, { key: 'differance', pct: LOGOS_BULLET_SLOW });
    whenSkillEnds(battle, unit, ':skill:differance', () => {
      clearEnemyProjectiles(battle, unit);
      endEnemyProjectileSlow(battle, unit, 'differance');
    });
    return true;
  },
  install: (battle, unit) => {
    // “来自河谷的笔盒”：造成法术伤害时附带等于 8% 的凋亡损伤
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || moduleOf(unit) !== LOGOS_MODULE || dmg?.type !== 'arts' || !target?.alive || dmg.logosNecrosis) return;
      dmg.logosNecrosis = true;
      battle.after(0, () => { if (target.alive) effects(battle, unit, { index: `module:${LOGOS_MODULE}` }).elementDamage(target, { element: 'apoptosis', amount: unit.s.atk * LOGOS_NECROSIS }); }, { owner: unit });
    }, { owner: unit, priority: -10 });
  },
  lines: {
    0: ({ battle, unit, fx }) => {
      for (const e of rangeEnemies(battle, unit, LOGOS_DEPLOY_TARGETS)) {
        const dealt = fx.damage(e, { scale: LOGOS_DEPLOY_SCALE / 100, type: 'arts' });
        if (e.alive && dealt > 0) fx.elementDamage(e, { element: 'apoptosis', amount: dealt * LOGOS_NECROSIS });
      }
    },
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit, p }) => onOwnAttack(battle, unit, () => {
        if (battle.rng() >= LOGOS_PROC / 100) return;
        const pool = rangeEnemies(battle, unit);
        const e = randomOf(battle, pool);
        if (!e) return;
        const fx = effects(battle, unit, { index: 3 });
        if (moduleOf(unit) === LOGOS_MODULE && inBurst(e, 'apoptosis')) fx.damage(e, { scale: LOGOS_MODULE_BURST / 100, type: 'element', element: 'apoptosis' });
        fx.damage(e, { scale: p('c') / 100, type: 'arts' });
        if (e.alive) fx.status(e, { status: 'sluggish', duration: LOGOS_PROC_STOP });
      }),
      run: () => {},
    },
    4: {
      // 剜魂具辞：攻击使目标 5 秒内法术抗性 -10，受到的法术伤害 +d 点（+ the run's deepening of line 5）
      install: ({ battle, unit, p }) => {
        onOwnDamage(battle, unit, ({ target, dmg }) => {
          if (!dmg.isAttack) return;
          battle.addBuff(target, { key: logosMark(unit), mods: { resFlat: -LOGOS_RES }, duration: LOGOS_MARK_SECONDS, refresh: 'replace', source: unit, visible: true });
        }, { priority: 120 });
        battle.on('hit', ({ target, dmg }) => {
          if (!active(unit) || dmg?.type !== 'arts' || !target?.buffs?.some((b) => b.key === logosMark(unit))) return;
          dmg.amount += p('d') + effects(battle, unit, { index: 4 }).growthValue(unit, LOGOS_COUNTER);
        }, { owner: unit, priority: 110 });
      },
      run: ({ unit, p, fx }) => fx.charge(unit, p('e')),
    },
    5: { options: { accept: (payload, ctx) => inRangeOf(ctx.unit, payload.target) },
      run: ({ unit, p, fx }) => fx.growthCounter(unit, { key: LOGOS_COUNTER, label: '剜魂具辞伤害加深', amount: p('f') }) },
  },
  modules: {
    // 来自河谷的笔盒 — the kit's arts hook and line 3
    [LOGOS_MODULE]: () => {},
  },
});

/** 蓄力 (技力溢出): every stored charge is full — the skill could not hold more SP. */
const overcharged = (unit) => !!unit.skill && unit.skill.maxCharges > 1 && unit.skill.charges >= unit.skill.maxCharges;
/** canCast of a skill that reads 蓄力: it notes the storage as the cast is decided (a natural cast spends its charge
 * before the cast handler runs). */
const notingStorage = (canCast) => (ctx) => { ctx.unit.mem.fullAtCast = overcharged(ctx.unit); return canCast(ctx); };
/** In a 损伤爆发 of `el`: the operators' burst status, or on an enemy the assault burst's lasting effect (凋亡: its 15 s dot). */
const inBurst = (e, el) => hasStatus(e, `${el}Burst`)
  || (el === 'apoptosis' && !!e?.buffs?.some((b) => /^assaultBurst:.*:dot$/.test(String(b.key)) && b.timeLeft > 0));
/** A 阵法术师 attacks only while its skill is active: a timed skill of this mode (an instant cast) opens that window until
 * the skill buff `part` ends. */
function phalanxWindow(battle, unit, part) {
  if (!unit.profile?.noAttackUnlessSkill) return;
  unit.profile.noAttackUnlessSkill = false;
  whenSkillEnds(battle, unit, part, () => { unit.profile.noAttackUnlessSkill = true; });
}
/** Once a battle, a lethal hit on `unit` is turned away (the native hpDamage pass): `onSave()` runs instead. */
function cheatDeath(battle, unit, onSave) {
  let used = false;
  battle.on('hpDamage', (ctx) => {
    if (used || ctx.target !== unit || !active(unit) || !(ctx.amount >= unit.hp)) return;
    used = true;
    ctx.amount = 0;
    onSave();
  }, { owner: unit, priority: 100 });
}
/** Up to `count` 驭械 drone hits more beside each drone hit of the unit while `on()` holds (one per real drone hit). */
function extraDrones(battle, unit, count, on, tag) {
  battle.on('hit', ({ source, target, dmg }) => {
    if (source !== unit || !dmg?.tags?.includes('funnel') || dmg.tags.includes(tag) || !target?.alive || !on()) return;
    for (let i = 0; i < count() && target.alive; i++) battle.dealDamage(unit, target, { amount: dmg.amount, type: dmg.type, isSkill: dmg.isSkill, attackId: dmg.attackId, tags: [...dmg.tags, tag] });
  }, { owner: unit, priority: -50 });
}

// ---------------------------------------------------------------------- 夕 ---
// “小自在” at every deployment and at every skill of your other 岁; its kills charge the other operator lowest in SP,
// every kill of your other operators grows her for the run.

const DUSK_SPIRIT = 'token_10015_dusk_drgn', DUSK_SPIRIT_SECONDS = 25, DUSK_SPIRIT_CAP = 5, DUSK_MODULE = 'uniequip_002_dusk', DUSK_MODULE_SECONDS = 5;
function duskSpirit(battle, unit, at, cause) {
  const seconds = DUSK_SPIRIT_SECONDS + (moduleOf(unit) === DUSK_MODULE ? DUSK_MODULE_SECONDS : 0);
  battle.assaultRuntime.withCause(cause, () => grantSummon(battle, unit, { tokenId: DUSK_SPIRIT, count: 1, stockCap: DUSK_SPIRIT_CAP, fieldCap: DUSK_SPIRIT_CAP, duration: seconds,
    ruleKey: `dusk:${uid(unit)}`, ...(at ? { preparedSlot: at } : null) }));
}

const dusk = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = rangeEnemies(battle, unit, 1)[0];
    if (!target) return false;
    // 工笔入化：下次攻击溅射范围扩大 ([ASSUMED] the 8 tiles around the target)
    for (const e of enemiesAround(battle, target)) fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
    return true;
  },
  lines: {
    0: ({ battle, unit, cause }) => duskSpirit(battle, unit, null, cause),
    1: 'cast',
    // 点睛：在其攻击目标位置召唤 1 个“小自在”
    2: ({ battle, unit, actor, cause }) => { const t = rangeEnemies(battle, actor, 1)[0]; duskSpirit(battle, unit, t ? tileOf(t) : null, cause); },
    3: {
      // 化境：“小自在”击倒敌人时 — the kills of her own summons (the line's self subject reads the operator only)
      install: ({ battle, unit }) => bindTrigger(battle, unit, { event: 'kill', subject: 'otherAllies' },
        { key: 'dusk-spirit-kill', accept: (payload) => payload.source?.kind === 'token' && payload.source.ownerUnit === unit },
        ({ cause }) => {
          const fx = effects(battle, unit, { index: 3 }, cause);
          const lowest = fx.allies('otherAllies').filter((x) => x.skill && !x.skill.noSkill && x.skill.kind !== 'passive')
            .sort((a, b) => spTotal(a) - spTotal(b) || uid(a).localeCompare(uid(b)))[0];
          if (lowest) fx.charge(lowest, 1);
        }),
      run: () => {},
    },
    4: { options: { accept: (payload) => payload.source?.kind === 'op' }, run: ({ unit, p, fx }) => fx.growth(unit, { key: 'ink', stat: 'atk', percent: p('b') / 100 }) },
  },
  modules: {
    // 无题长卷：攻击范围扩大，“小自在”持续 +5 秒
    [DUSK_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'scroll', mods: { rangeExtend: 1 }, persist: true }),
  },
});

// -------------------------------------------------------------------- 异客 ---
// 辉煌裂片 (cast at every deployment, stored twice) drops a 4 s storm on the strongest enemy; every skill of your other
// operators charges him (twice from 萨尔贡).

const PASNGR_STORM = 4, PASNGR_TICK = 0.5, PASNGR_STOP = 0.5, PASNGR_CHAIN = 3, PASNGR_FALLOFF = 0.15, PASNGR_GATE = 0.8, PASNGR_MARK = 3;
const PASNGR_SARGON = 2, PASNGR_MODULE = 'uniequip_003_pasngr';
const pasngrMark = (unit) => `assault:pasngr:analysis:${uid(unit)}`;

const pasngr = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    // 大范围内生命最高的敌人 ([ASSUMED] the enemies of her range)
    const center = rangeEnemies(battle, unit).sort((a, b) => b.hp - a.hp || uid(a).localeCompare(uid(b)))[0];
    if (!center) return false;
    const [r, c] = tileOf(center);
    const zone = (e) => Math.max(Math.abs(Math.round(e.y) - r), Math.abs(Math.round(e.x) - c)) <= 1;
    let ticks = 0;
    const strike = () => {
      const fx = effects(battle, unit, { index: 'skill' }, cause);
      const first = randomOf(battle, battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden && zone(e)));
      const falloff = moduleOf(unit) === PASNGR_MODULE ? 0 : PASNGR_FALLOFF;
      chainFrom(battle, first, PASNGR_CHAIN).forEach((e, k) => {
        fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100 * powi(1 - falloff, k), type: 'arts', isSkill: true });
        if (e.alive) fx.status(e, { status: 'sluggish', duration: PASNGR_STOP });
      });
    };
    strike();
    const timer = battle.every(PASNGR_TICK, () => { if (++ticks * PASNGR_TICK >= PASNGR_STORM - 1e-9) timer.cancel(); else strike(); }, { owner: unit });
    return true;
  },
  install: (battle, unit) => {
    // 王权金币：普通攻击跳跃伤害不再降低
    if (moduleOf(unit) === PASNGR_MODULE && unit.profile?.chain) unit.profile.chain = { ...unit.profile.chain, falloff: 0 };
  },
  lines: {
    0: 'cast',
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => onOwnDamage(battle, unit, ({ target, dmg }) => {
        if (target.buffs.some((b) => b.key === pasngrMark(unit))) dmg.mul *= 1 + p('b') / 100;
        if (dmg.isAttack && target.hp > target.s.maxHp * PASNGR_GATE) battle.addBuff(target, { key: pasngrMark(unit), mods: {}, duration: PASNGR_MARK, refresh: 'replace', source: unit });
      }),
      run: () => {},
    },
    3: {
      install: ({ battle, unit, p }) => selfWhile(battle, unit, 'lone', { atkPct: p('c') / 100 },
        () => !battle.enemies.some((e) => e.alive && !e.removed && withinAdjacent4(unit, e))),
      run: ({ unit, p, fx, actor }) => fx.charge(unit, p('d') * (matchesClass(actor, { label: '萨尔贡' }) ? PASNGR_SARGON : 1)),
    },
  },
  modules: {
    [PASNGR_MODULE]: () => {}, // 王权金币 — the kit's install and the storm's chain
  },
});

// ------------------------------------------------------------------ 卡涅利安 ---
// A 阵法术师 behind her own shield: 沙缚镣锁 opens her attack, binding when she casts at full storage; 生命之餐 heals her at
// every cast. Barriers given to your other operators charge her.

const BILLRO_STOP = 0.3, BILLRO_BIND = 0.6, BILLRO_FULL_ATK = 0.2, BILLRO_FULL_SP = 0.6, BILLRO_MODULE = 'uniequip_003_billro', BILLRO_MODULE_STEP = 3, BILLRO_MODULE_MAX = 15;

const billro = (bb, raw, def) => synergyKit(def, {
  canCast: notingStorage(enemyInRange),
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const full = !!unit.mem.fullAtCast;
    unit.mem.billroFull = full;
    fx.sustain(unit, { key: 'sand-chains', mods: { batPct: INTERVAL.large, ...(full ? { atkPct: BILLRO_FULL_ATK } : null) }, duration: cardParam(unit, 1, 'b') });
    phalanxWindow(battle, unit, ':skill:sand-chains');
    fx.heal(unit, { maxHpRatio: cardParam(unit, 2, 'c') / 100 * (full ? 2 : 1) }); // 生命之餐（line 2）
    return true;
  },
  install: (battle, unit) => onOwnAttack(battle, unit, ({ targets }) => {
    if (!hasBuff(unit, ':skill:sand-chains')) return;
    const fx = effects(battle, unit, { index: 'skill' });
    for (const e of targets) if (e.alive) fx.status(e, unit.mem.billroFull ? { status: 'bind', duration: BILLRO_BIND } : { status: 'sluggish', duration: BILLRO_STOP });
  }),
  lines: {
    0: ({ battle, unit, p, cause }) => battle.assaultRuntime.withCause(cause, () => battle.addBuff(unit, { key: `assault:billro:shield:${uid(unit)}`, shield: unit.s.maxHp * p('a') / 100,
      duration: Infinity, refresh: 'replace', source: unit, visible: true })),
    1: 'cast',
    2: () => {}, // 生命之餐 rides the cast
    3: {
      install: ({ battle, unit }) => selfWhile(battle, unit, 'poised', { spRecoveryFlat: BILLRO_FULL_SP }, () => overcharged(unit)),
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.charge(unit, p('d')),
  },
  modules: {
    // 乡音 ([ASSUMED] +3% for each enemy in her range, at most +15%)
    [BILLRO_MODULE]: ({ battle, unit }) => {
      if (unit.mem.billroModule) return;
      unit.mem.billroModule = true;
      onOwnDamage(battle, unit, ({ dmg }) => { dmg.mul *= 1 + Math.min(BILLRO_MODULE_MAX, BILLRO_MODULE_STEP * rangeEnemies(battle, unit).length) / 100; });
    },
  },
});

// ------------------------------------------------------------------ 圣聆初雪 ---
// Snow builds on the ground of her range (every 5.5 s, up to 5 layers): it hurts and slows the ground enemies on it, more
// for every 冻结 your other operators make in the run. 铃音吹雪 drives the snow forward; she chills whoever hits her and,
// once a battle, a lethal blow freezes everything around her instead.

const SBELL_EVERY = 5.5, SBELL_MAX = 5, SBELL_SLOW = 0.12, SBELL_TICK = 1, SBELL_COLD = 3.5, SBELL_PUSH = 2, SBELL_SPREAD = 5;
const SBELL_SELF_FREEZE = 4, SBELL_FREEZE = 8, SBELL_COUNTER = 'sbell2-snow', SBELL_MODULE = 'uniequip_002_sbell2', SBELL_MODULE_SCALE = 105, SBELL_MODULE_EVERY = 5;
const snowOf = (unit) => (unit.mem.sbellSnowTiles ??= new Map());
function addSnow(battle, unit, tiles) {
  const snow = snowOf(unit);
  for (const [r, c] of tiles) if (battle.grid.inRect(r, c) && battle.grid.tile(r, c)?.height !== 'HIGH') snow.set(`${r},${c}`, Math.min(SBELL_MAX, (snow.get(`${r},${c}`) ?? 0) + 1));
}
const rangeTiles = (unit) => [...(unit.rangeKeys ?? [])].map((k) => [Math.floor(k / COLS), k % COLS]);

const sbell2 = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = rangeEnemies(battle, unit);
    for (const e of targets) {
      fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
      if (!e.alive) continue;
      fx.status(e, { status: 'cold', duration: SBELL_COLD });
      battle.push(e, SBELL_PUSH, { from: unit, effect: true });
    }
    addSnow(battle, unit, aheadTiles(unit, SBELL_SPREAD)); // 之后积雪向前扩散
    for (const x of fx.allies('allies:谢拉格')) fx.accelerate(x, cardParam(unit, 2, 'b'));
    return targets.length > 0;
  },
  lines: {
    0: ({ battle, unit }) => addSnow(battle, unit, rangeTiles(unit)),
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit, p }) => {
        const module = () => moduleOf(unit) === SBELL_MODULE;
        let since = 0;
        battle.every(0.25, () => {
          if (!active(unit)) return;
          since += 0.25;
          if (since + 1e-9 >= (module() ? SBELL_MODULE_EVERY : SBELL_EVERY)) { since = 0; addSnow(battle, unit, rangeTiles(unit)); }
          // the slow of each layer on the ground enemies standing in snow
          for (const e of battle.enemies) {
            const layers = e.alive && !e.removed && !isFlyer(e) ? snowOf(unit).get(tileOf(e).join(',')) ?? 0 : 0;
            if (layers) battle.addBuff(e, { key: `assault:sbell2:snow:${uid(unit)}`, mods: { moveMul: Math.max(0, 1 - SBELL_SLOW * layers) }, duration: 0.6, refresh: 'replace', source: unit });
          }
        }, { owner: unit });
        battle.every(SBELL_TICK, () => {
          if (!active(unit)) return;
          const fx = effects(battle, unit, { index: 3 });
          const scale = (module() ? SBELL_MODULE_SCALE : p('c')) / 100 * (1 + fx.growthValue(unit, SBELL_COUNTER) / 100);
          for (const e of [...battle.enemies]) if (e.alive && !e.removed && !isFlyer(e) && snowOf(unit).get(tileOf(e).join(','))) fx.damage(e, { scale, type: 'arts' });
        }, { owner: unit });
      },
      run: () => {},
    },
    4: {
      // 圣山的祝福：每场战斗首次受到致命伤害时回满生命并自身冻结 4 秒，使攻击范围内所有敌人冻结 8 秒
      // 受到伤害时使攻击者寒冷: the enemy is the hit's source — watched here (the line's subject 'enemy' would read the hit target)
      install: ({ battle, unit, p }) => {
        cheatDeath(battle, unit, () => battle.after(0, () => {
          const fx = effects(battle, unit, { index: 4 });
          fx.heal(unit, { maxHpRatio: 1 });
          battle.applyStatus(unit, 'freeze', { duration: SBELL_SELF_FREEZE, source: unit });
          for (const e of rangeEnemies(battle, unit)) fx.status(e, { status: 'freeze', duration: SBELL_FREEZE });
        }, { owner: unit }));
        watch(battle, unit, 'damageTaken', 'sbell2-blessing', ({ payload }) => payload.target === unit && payload.source?.side === 'enemy',
          ({ payload, cause }) => { if (payload.source.alive) effects(battle, unit, { index: 4 }, cause).status(payload.source, { status: 'cold', duration: p('d') }); });
      },
      options: { accept: () => false },
      run: () => {},
    },
    5: ({ unit, p, fx }) => fx.growthCounter(unit, { key: SBELL_COUNTER, label: '积雪伤害', amount: p('e'), suffix: '%' }),
  },
  modules: {
    // 千分之一的心：积雪伤害提升至 105%，每 5 秒积 1 层 — read by line 3
    [SBELL_MODULE]: () => {},
  },
});

// -------------------------------------------------------------- 荒芜拉普兰德 ---
// Her deployment charges your other 叙拉古; 终幕·浩劫 sends two more drones that frighten and shake what they catch. The
// longer she stays, the stronger her wolves (头狼); every kill of your other 叙拉古 grows her for the run.

const WHITW_DRONES = 2, WHITW_FEAR = 3, WHITW_SLOW = 0.5, WHITW_DOT = 120, WHITW_SILENCE = 2, WHITW_CAP_UP = 1.1;
const WHITW_MODULE = 'uniequip_002_whitw2', WHITW_MODULE_SP = 1, WHITW_MODULE_ASPD = 10;
const whitwStage = (battle, unit) => Math.min(3, Math.floor((battle.time + 1e-9 - (unit.deployedAt ?? 0)) / cardParam(unit, 3, 'd')));

const whitw2 = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.sustain(unit, { key: 'havoc', mods: { atkPct: cardParam(unit, 1, 'c') / 100 }, duration: cardParam(unit, 1, 'b') });
    unit.mem.whitwCast = true;
    // 浮游单元周围的敌人 ([ASSUMED] the enemies in her range) 移速 -50%，每秒受到 120% 法术伤害
    if (!unit.mem.whitwTicker || unit.mem.whitwTicker.cancelled) {
      unit.mem.whitwTicker = battle.every(1, () => {
        if (!hasBuff(unit, ':skill:havoc')) { unit.mem.whitwTicker.cancel(); return; }
        const tick = effects(battle, unit, { index: 'skill' });
        for (const e of rangeEnemies(battle, unit)) {
          tick.buff(e, { key: 'havoc-slow', mods: { moveMul: 1 - WHITW_SLOW }, duration: 1.1 });
          tick.damage(e, { scale: WHITW_DOT / 100, type: 'arts', isSkill: true });
        }
      }, { owner: unit });
    }
    return true;
  },
  install: (battle, unit) => {
    // 终幕·浩劫：浮游单元 +2（头狼 stage 3: +1 more）
    extraDrones(battle, unit, () => (hasBuff(unit, ':skill:havoc') ? WHITW_DRONES : 0) + (whitwStage(battle, unit) >= 3 ? 1 : 0), () => true, 'whitw-extra');
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !dmg?.tags?.includes('funnel') || !target?.alive) return;
      const fx = effects(battle, unit, { index: 'skill' });
      if (hasBuff(unit, ':skill:havoc') && !hasStatus(target, 'fear')) { fx.status(target, { status: 'fear', duration: WHITW_FEAR }); fx.status(target, { status: 'tremble', duration: WHITW_FEAR }); }
      if (whitwStage(battle, unit) >= 2) effects(battle, unit, { index: 3 }).status(target, { status: 'silence', duration: WHITW_SILENCE });
    }, { owner: unit, priority: -60 });
  },
  lines: {
    0: ({ unit, p, fx }) => { for (const x of fx.allies('allies:叙拉古')) fx.charge(x, p('a') + (moduleOf(unit) === WHITW_MODULE ? WHITW_MODULE_SP : 0)); },
    1: 'cast',
    2: 'cast',
    3: {
      // 头狼 stage 1: 伤害上限 +10% (a copy of her profile's drone ramp)
      install: ({ battle, unit }) => battle.every(0.25, () => {
        if (!active(unit) || !unit.profile?.funnel) return;
        const base = unit.mem.whitwFunnel ??= unit.profile.funnel;
        const want = whitwStage(battle, unit) >= 1 ? base.max * WHITW_CAP_UP : base.max;
        if (unit.profile.funnel.max !== want) unit.profile.funnel = { ...base, max: want };
      }, { owner: unit }),
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'alpha', stat: 'atk', percent: p('e') / 100 }),
  },
  modules: {
    // 狼时：部署时的充能再 +1（line 0）；你的叙拉古干员首次施放技能后攻击速度 +10 ([ASSUMED] after her own first cast)
    [WHITW_MODULE]: ({ battle, unit }) => allyAura(battle, unit, { key: 'wolf-hour', mods: { aspd: WHITW_MODULE_ASPD },
      select: (x) => !!unit.mem.whitwCast && matchesClass(x, { label: '叙拉古' }) }),
  },
});

// -------------------------------------------------------------------- 妮芙 ---
// 怵然震爆 (cast at every deployment) frightens and fills 凋亡损伤; 失魂 burns the bursting. Every 凋亡 burst of your other
// operators grows her for the run; a burst of her own hastes the others.

const NYMPH_FEAR = 5, NYMPH_APOPTOSIS = 0.25, NYMPH_SOUL = 100, NYMPH_MODULE = 'uniequip_002_nymph', NYMPH_MODULE_SCALE = 110;
const bursting = (e) => inBurst(e, 'apoptosis');
function lostSoul(battle, unit, e, scale) {
  const souls = unit.mem.nymphSouls ??= new Map();
  souls.set(e, Math.max(souls.get(e) ?? 0, scale));
  if (unit.mem.nymphSoulTicker && !unit.mem.nymphSoulTicker.cancelled) return;
  unit.mem.nymphSoulTicker = battle.every(1, () => {
    const fx = effects(battle, unit, { index: 3 });
    for (const [x, s] of [...souls]) {
      if (!x.alive || !bursting(x)) { souls.delete(x); continue; }
      fx.damage(x, { scale: s, type: 'elemental' });
    }
    if (!souls.size) unit.mem.nymphSoulTicker.cancel();
  }, { owner: unit });
}

const nymph = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = rangeEnemies(battle, unit, 1)[0];
    if (!target) return false;
    let burst = false;
    for (const e of enemiesAround(battle, target)) {
      const before = bursting(e);
      if (before) lostSoul(battle, unit, e, NYMPH_SOUL / 100); // 命中凋亡损伤爆发中的敌人时，失魂提升至 100%
      const dealt = fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
      if (e === target && e.alive) fx.status(e, { status: 'fear', duration: NYMPH_FEAR });
      if (e.alive && dealt > 0) fx.elementDamage(e, { element: 'apoptosis', amount: dealt * NYMPH_APOPTOSIS });
      if (!before && bursting(e)) burst = true;
    }
    if (burst) for (const x of fx.allies('otherAllies')) fx.accelerate(x, cardParam(unit, 2, 'b')); // 若此击引发凋亡损伤爆发
    return true;
  },
  lines: {
    0: 'cast',
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit, p }) => onOwnDamage(battle, unit, ({ target, dmg }) => {
        if (!bursting(target)) return;
        if (moduleOf(unit) === NYMPH_MODULE) dmg.mul *= NYMPH_MODULE_SCALE / 100; // 心声
        if (dmg.isAttack) lostSoul(battle, unit, target, p('c') / 100);
      }),
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'mind-key', stat: 'atk', percent: p('d') / 100 }),
  },
  modules: {
    [NYMPH_MODULE]: () => {}, // 心声 — line 3's hook
  },
});

// -------------------------------------------------------------------- 烛煌 ---
// 炙手之援 sets your toughest operator in her range alight: the enemies around it burn. Every 灼燃 burst blows up for her
// (more for every one your other operators cause, for the run) and heals her; once a battle she rises again.

const BLAZE_BURN = 0.3, BLAZE_REVIVE_BARRIER = 6000, BLAZE_COUNTER = 'blaze2-melt', BLAZE_MODULE = 'uniequip_003_blaze2', BLAZE_MODULE_HASTE = 2;
const igniteKey = (unit) => `assault:blaze2:ignite:${uid(unit)}`;

const blaze2 = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange, // the fire burns enemies: it waits for one
  cast: ({ battle, unit, cause }) => {
    // 可重复发起，附给下一名生命上限最高的干员 (one not burning yet, else the toughest again)
    const pool = rangeAllies(battle, unit).sort((a, b) => b.s.maxHp - a.s.maxHp || uid(a).localeCompare(uid(b)));
    const target = pool.find((x) => !x.buffs.some((b) => b.key === igniteKey(unit))) ?? pool[0];
    if (!target) return false;
    const seconds = cardParam(unit, 1, 'a');
    battle.addBuff(target, { key: igniteKey(unit), mods: {}, duration: seconds, refresh: 'replace', source: unit, visible: true });
    const timer = battle.every(1, () => {
      if (!target.buffs.some((b) => b.key === igniteKey(unit)) || !active(target)) { timer.cancel(); return; }
      const fx = effects(battle, unit, { index: 'skill' }, cause);
      for (const e of enemiesAround(battle, target)) {
        const dealt = fx.damage(e, { scale: cardParam(unit, 1, 'b') / 100, type: 'arts', isSkill: true });
        if (e.alive && dealt > 0) fx.elementDamage(e, { element: 'burn', amount: dealt * BLAZE_BURN });
      }
    }, { owner: unit });
    return true;
  },
  lines: {
    0: 'cast',
    1: 'cast',
    2: 'cast',
    3: {
      // 任一敌人灼燃损伤爆发时: every burn burst on an enemy, whoever caused it — watched here (the line's subject 'enemy'
      // would read the cause)
      install: ({ battle, unit, p }) => watch(battle, unit, 'elementBurst', 'blaze2-melt', ({ payload }) => payload.target?.side === 'enemy' && payload.element === 'burn',
        ({ payload, cause }) => {
          const fx = effects(battle, unit, { index: 3 }, cause);
          if (payload.target.alive) fx.damage(payload.target, { scale: p('c') / 100 * (1 + fx.growthValue(unit, BLAZE_COUNTER) / 100), type: 'elemental' });
          fx.heal(unit, { maxHpRatio: p('d') / 100 });
        }),
      options: { accept: () => false },
      run: () => {},
    },
    4: {
      // 绝处重燃 ([ASSUMED] without the 倒地 state): the first lethal hit of a battle is turned away, she gets her barrier,
      // is back at full HP and stuns the enemies around her
      install: ({ battle, unit, p }) => cheatDeath(battle, unit, () => battle.after(0, () => {
        const fx = effects(battle, unit, { index: 4 });
        battle.addBuff(unit, { key: `assault:blaze2:rekindle:${uid(unit)}`, shield: BLAZE_REVIVE_BARRIER, duration: Infinity, refresh: 'replace', source: unit });
        fx.heal(unit, { maxHpRatio: 1 });
        for (const e of enemiesAround(battle, unit)) fx.status(e, { status: 'stun', duration: p('e') });
      }, { owner: unit })),
      options: { accept: () => false },
      run: () => {},
    },
    5: ({ unit, p, fx }) => fx.growthCounter(unit, { key: BLAZE_COUNTER, label: '熔点引爆伤害', amount: p('f'), suffix: '%' }),
  },
  modules: {
    // 沟通小助手：你的其他干员引发元素损伤爆发时，加速此干员 2 秒（每 3 秒最多一次）
    [BLAZE_MODULE]: ({ unit, fx }) => fx.accelerate(unit, BLAZE_MODULE_HASTE),
  },
});

// -------------------------------------------------------------------- 灵知 ---
// 坚冰: his attacks chill, the chilled in his range are fragile (frozen ones twice) — more for every frozen enemy your
// other operators kill, for the run. Your other operators' 冻结 charge him; his deployment steels your other 谢拉格.

const GNOSIS_COLD = 4, GNOSIS_ATTACK_COLD = 1, GNOSIS_COUNTER = 'gnosis-ice', GNOSIS_MODULE = 'uniequip_002_gnosis', GNOSIS_MODULE_FRAGILE = 32;

const gnosis = (bb, raw, def) => synergyKit(def, {
  canCast: notingStorage(enemyInRange),
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const full = !!unit.mem.fullAtCast;
    const targets = rangeEnemies(battle, unit);
    // the catalogue 寒冷 (no instance key of its own): a second one on the same enemy pairs into 冻结 natively
    const chill = (e) => battle.assaultRuntime.withCause(cause, () => battle.applyStatus(e, 'cold', { duration: GNOSIS_COLD, source: unit }));
    for (const e of targets) {
      fx.damage(e, { scale: cardParam(unit, 1, 'b') / 100, type: 'arts', isSkill: true });
      if (!e.alive) continue;
      chill(e);
      if (full && e.alive) chill(e); // 若发动时已蓄力，额外再施加一层寒冷
    }
    return targets.length > 0;
  },
  install: (battle, unit) => onOwnAttack(battle, unit, ({ targets }) => {
    const fx = effects(battle, unit, { index: 2 });
    for (const e of targets) if (e.alive) fx.status(e, { status: 'cold', duration: GNOSIS_ATTACK_COLD });
  }),
  lines: {
    // 本次部署期间: buffs that a knock-out clears (an in-place 再部署 keeps them, and gives them again)
    0: ({ battle, unit, p, fx }) => {
      for (const x of fx.allies('allies:谢拉格')) {
        fx.buff(x, { key: 'ice-oath', mods: { atkPct: p('a') / 100 } });
        if (!x.buffs.some((b) => b.status === 'resist')) battle.applyStatus(x, 'resist', { duration: Infinity, source: unit });
      }
    },
    1: 'cast',
    2: ({ battle, unit, p, fx }) => {
      const pct = () => (moduleOf(unit) === GNOSIS_MODULE ? GNOSIS_MODULE_FRAGILE : p('c')) + fx.growthValue(unit, GNOSIS_COUNTER);
      fragileAura(battle, unit, 'ice-cold', pct, (e) => inRangeOf(unit, e) && hasStatus(e, 'cold') && !hasStatus(e, 'frozen'));
      fragileAura(battle, unit, 'ice-frozen', () => 2 * pct(), (e) => inRangeOf(unit, e) && hasStatus(e, 'frozen'));
    },
    3: ({ unit, fx }) => fx.charge(unit, 1),
    4: { options: { accept: (payload) => hasStatus(payload.target, 'frozen') },
      run: ({ unit, p, fx }) => fx.growthCounter(unit, { key: GNOSIS_COUNTER, label: '坚冰脆弱', amount: p('d'), suffix: '%' }) },
  },
  modules: {
    // “誓言”：坚冰的脆弱提升至 32% — read by line 2
    [GNOSIS_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 安洁莉娜 ---
// 加速力场 speeds every other operator up and their 再部署 loops; her deployment cuts their current timers; every 再部署 of
// theirs charges her. Out of her skill she heals them every second.

const AGLINA_TARGETS = 4, AGLINA_MODULE = 'uniequip_003_aglina', AGLINA_MODULE_ASPD = 5;

const aglina = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const seconds = cardParam(unit, 1, 'b');
    fx.sustain(unit, { key: 'antigravity', mods: { rangeExtend: 1, atkPct: cardParam(unit, 1, 'c') / 100, maxTargets: AGLINA_TARGETS }, duration: seconds });
    for (const e of battle.enemies) if (e.alive && !e.removed) weightless(battle, unit, e, seconds, cause); // 全场所有敌人失重
    return true;
  },
  lines: {
    0: ({ p, fx }) => fx.cutRedeploy({ seconds: p('a'), includeSelf: false }),
    1: 'cast',
    2: ({ battle, unit, p }) => {
      allyAura(battle, unit, { key: 'field', mods: { aspd: p('d'), redeployMul: 1 - p('e') / 100 } });
      // 实验用反重力模块：加速力场对攻击范围内的干员再 +5 攻击速度
      if (moduleOf(unit) === AGLINA_MODULE) allyAura(battle, unit, { key: 'field-module', mods: { aspd: AGLINA_MODULE_ASPD }, select: (x) => inRangeOf(unit, x) });
    },
    3: ({ battle, unit, p }) => allyAura(battle, unit, { key: 'part-time', mods: { hpRegen: p('f') }, select: (x) => x !== unit && !hasBuff(unit, ':skill:antigravity') }),
    4: ({ unit, p, fx }) => fx.charge(unit, p('g')),
  },
  modules: {
    [AGLINA_MODULE]: () => {}, // read by line 2
  },
});

// -------------------------------------------------------------------- 铃兰 ---
// 画地为牢: what pauses in her range is fragile afterwards (twice during 狐火渺然); the pauses your other operators make
// in her range charge her. Her deployment hastes your other 辅助, her aura feeds their SP.

const LISA_HEAL = 0.2, LISA_MODULE = 'uniequip_003_lisa', LISA_MODULE_WEAKEN = 0.08;

const lisa = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'foxfire', mods: { rangeExtend: 1 }, flags: { disarm: true }, duration: cardParam(unit, 1, 'b') });
    if (!unit.mem.lisaTicker || unit.mem.lisaTicker.cancelled) {
      const tick = () => {
        if (!hasBuff(unit, ':skill:foxfire')) { unit.mem.lisaTicker?.cancel(); return; }
        const fx = effects(battle, unit, { index: 'skill' });
        for (const e of rangeEnemies(battle, unit)) fx.status(e, { status: 'sluggish', duration: 1.1 });
        for (const x of rangeAllies(battle, unit)) fx.heal(x, { scale: LISA_HEAL });
      };
      battle.assaultRuntime.withCause(cause, tick);
      unit.mem.lisaTicker = battle.every(1, tick, { owner: unit });
    }
    return true;
  },
  lines: {
    0: ({ p, fx }) => { for (const x of fx.allies('allies:辅助')) fx.accelerate(x, p('a')); },
    1: 'cast',
    2: ({ battle, unit, p }) => allyAura(battle, unit, { key: 'sp-aura', mods: { spRecoveryFlat: p('c') }, select: (x) => x !== unit && matchesClass(x, { label: '辅助' }) }),
    3: {
      // 画地为牢：攻击范围内被停顿的敌人随后受到等长时间的 d% 脆弱（狐火渺然期间翻倍；模组再附带 8% 虚弱）
      install: ({ battle, unit, p }) => battle.on('statusApplied', ({ target, status, duration }) => {
        if (!active(unit) || status !== 'sluggish' || target?.side !== 'enemy' || !inRangeOf(unit, target) || !(duration > 0) || duration === Infinity) return;
        const pct = p('d') * (hasBuff(unit, ':skill:foxfire') ? 2 : 1) / 100;
        battle.after(duration, () => {
          if (!target.alive) return;
          battle.addBuff(target, { key: `assault:lisa:cage:${uid(unit)}`, mods: { dmgTakenMul: 1 + pct, ...(moduleOf(unit) === LISA_MODULE ? { atkMul: 1 - LISA_MODULE_WEAKEN } : null) },
            duration, refresh: 'replace', source: unit, visible: true });
        }, { owner: unit });
      }, { owner: unit }),
      run: () => {},
    },
    4: { options: { accept: (payload, ctx) => inRangeOf(ctx.unit, payload.target) }, run: ({ unit, fx }) => fx.charge(unit, 1) },
  },
  modules: {
    [LISA_MODULE]: () => {}, // 孩子们 — read by line 3
  },
});

// ------------------------------------------------------------------ 溯光星源 ---
// 星束引力 picks the two farthest enemies in her range and drags their neighbours in; each cast charges the other operator
// lowest in SP. 能源解析 makes the enemies that stay in her range fragile; every 停顿 of your other operators grows her
// attack speed for the run.

const HALO_TARGETS = 2, HALO_PULLED = 3, HALO_STOP = 3, HALO_PULL = 2, HALO_DEPLOY_STOP = 2, HALO_STAY = 7, HALO_CAST_COOLDOWN = 3, HALO_GROWTH = 1;
const HALO_MODULE = 'uniequip_002_halo2', HALO_MODULE_ATK = 0.12;

const halo2 = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const d2 = (e) => (e.x - unit.tileC) * (e.x - unit.tileC) + (e.y - unit.tileR) * (e.y - unit.tileR);
    const far = rangeEnemies(battle, unit).sort((a, b) => d2(b) - d2(a) || uid(a).localeCompare(uid(b))).slice(0, HALO_TARGETS);
    const scale = cardParam(unit, 1, 'a') / 100;
    for (const t of far) {
      fx.damage(t, { scale, type: 'arts', isSkill: true });
      if (t.alive) fx.status(t, { status: 'sluggish', duration: HALO_STOP });
      for (const e of enemiesAround(battle, t).filter((x) => x !== t && !far.includes(x)).slice(0, HALO_PULLED)) {
        battle.pull(e, HALO_PULL, { to: { x: t.x, y: t.y }, center: unit });
        fx.damage(e, { scale, type: 'arts', isSkill: true });
      }
    }
    // 每次发动，为你的其他干员中技力最低的 1 名充能 1（每 3 秒最多一次）
    if (!(battle.time + 1e-9 < (unit.mem.haloChargeAt ?? -Infinity) + HALO_CAST_COOLDOWN)) {
      const lowest = fx.allies('otherAllies').filter((x) => x.skill && !x.skill.noSkill && x.skill.kind !== 'passive')
        .sort((a, b) => spTotal(a) - spTotal(b) || uid(a).localeCompare(uid(b)))[0];
      if (lowest) { unit.mem.haloChargeAt = battle.time; fx.charge(lowest, 1); }
    }
    return far.length > 0;
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const e of rangeEnemies(battle, unit)) fx.status(e, { status: 'sluggish', duration: HALO_DEPLOY_STOP }); },
    1: 'cast',
    2: 'cast',
    3: {
      // 能源解析：攻击范围内的敌人受到 b% 脆弱，停留超过 7 秒后提升至 c% (each enemy's own time in her range)
      install: ({ battle, unit, p }) => {
        const stay = new Map();
        battle.every(0.25, () => {
          if (!active(unit)) return;
          for (const e of battle.enemies) {
            const inside = e.alive && !e.removed && inRangeOf(unit, e);
            stay.set(e, inside ? (stay.get(e) ?? 0) + 0.25 : 0);
            if (inside) battle.addBuff(e, { key: `assault:halo2:analysis:${uid(unit)}`, mods: { dmgTakenMul: 1 + (stay.get(e) > HALO_STAY ? p('c') : p('b')) / 100 },
              duration: 0.6, refresh: 'replace', source: unit });
          }
        }, { owner: unit, immediate: true });
      },
      run: () => {},
    },
    4: ({ unit, fx }) => fx.growth(unit, { key: 'modeling', stat: 'aspd', flat: HALO_GROWTH }),
  },
  modules: {
    [HALO_MODULE]: ({ unit, fx }) => fx.buff(unit, { key: 'collection', mods: { atkPct: HALO_MODULE_ATK }, persist: true }),
  },
});

// ---------------------------------------------------------------- 浊心斯卡蒂 ---
// The seaborn she calls stands with her for 25 s; operators in either range make her stronger (a 深海猎人 more), the
// 深海猎人's kills stack her attack. “潮涌，潮枯” burns her own life to wash her range in true damage and inspires everyone
// in it.

const SKADI_SEABORN = 'token_10017_skadi2_dedant', SKADI_SEABORN_SECONDS = 25, SKADI_SELF_LOSS = 0.05, SKADI_TIDE = 0.7, SKADI_MODULE = 'uniequip_003_skadi2', SKADI_MODULE_SP = 3;
const skadiReach = (battle, unit, x) => inRangeOf(unit, x) || ownSummons(battle, unit, SKADI_SEABORN).some((t) => inRangeOf(t, x));

const skadi2 = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const seconds = cardParam(unit, 1, 'a');
    fx.sustain(unit, { key: 'tide', mods: {}, duration: seconds });
    const inspire = { atkFlat: unit.s.atk * cardParam(unit, 2, 'b') / 100 };
    for (const x of rangeAllies(battle, unit, { others: true })) fx.sustain(x, { key: 'tide-inspire', mods: inspire, duration: seconds });
    if (!unit.mem.skadiTide || unit.mem.skadiTide.cancelled) {
      unit.mem.skadiTide = battle.every(1, () => {
        if (!hasBuff(unit, ':skill:tide')) { unit.mem.skadiTide.cancel(); return; }
        const tick = effects(battle, unit, { index: 'skill' });
        tick.loseHp(unit, { maxPct: SKADI_SELF_LOSS });
        for (const e of rangeEnemies(battle, unit)) tick.damage(e, { scale: SKADI_TIDE, type: 'true', isSkill: true });
      }, { owner: unit });
    }
    return true;
  },
  lines: {
    0: ({ battle, unit, cause }) => {
      if (!ownSummons(battle, unit, SKADI_SEABORN).length) battle.assaultRuntime.withCause(cause, () => grantSummon(battle, unit, { tokenId: SKADI_SEABORN, count: 1, stockCap: 1, fieldCap: 1,
        duration: SKADI_SEABORN_SECONDS, ruleKey: `skadi2:${uid(unit)}` }));
    },
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit, p }) => {
        const others = () => battle.assaultDeploymentOrder().filter((x) => isOp(x) && active(x) && x !== unit && x.ownerId === unit.ownerId && skadiReach(battle, unit, x));
        selfWhile(battle, unit, 'predator', { atkPct: p('c') / 100 }, () => others().length > 0 && !others().some((x) => matchesClass(x, { label: '深海猎人' })));
        selfWhile(battle, unit, 'predator-hunter', { atkPct: p('d') / 100 }, () => others().some((x) => matchesClass(x, { label: '深海猎人' })));
      },
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.stack(unit, { key: 'predator', stat: 'atk', amount: p('e') / 100, mode: 'percent' }),
  },
  modules: {
    // 新生代：你的其他干员部署或再部署在此干员或海嗣的攻击范围内时，此干员获得 3 技力
    [SKADI_MODULE]: { options: { accept: (payload, ctx) => skadiReach(ctx.battle, ctx.unit, payload.target) }, run: ({ unit, fx }) => fx.charge(unit, SKADI_MODULE_SP) },
  },
});

// -------------------------------------------------------------------- 魔王 ---
// 微尘 ([ASSUMED] dust motes kept as a count: one drifts off each second, to an operator in her range out of the skill —
// it takes heals 1.5× for 6 s — or into an enemy there during it, and a spent one is back 6 s later). The heals of the
// operators in her range charge her; every elite your other operators kill makes her range take heals better for the run.

const CETSYR_DUST = 3, CETSYR_SKILL_DUST = 3, CETSYR_BACK = 6, CETSYR_HEAL_MUL = 1.5, CETSYR_HEAL_SECONDS = 6, CETSYR_BIND = 3.5, CETSYR_INSPIRE = 1;
const CETSYR_COUNTER = 'cetsyr-echo', CETSYR_MODULE = 'uniequip_002_cetsyr', CETSYR_MODULE_HEAL = 0.3;
const dustCap = (unit) => CETSYR_DUST + (hasBuff(unit, ':skill:tomorrow') ? CETSYR_SKILL_DUST : 0);

const cetsyr = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const seconds = cardParam(unit, 1, 'a');
    fx.sustain(unit, { key: 'tomorrow', mods: {}, duration: seconds });
    unit.mem.cetsyrDust = dustCap(unit); // 微尘上限 +3 并立刻获得 6 枚
    const inspire = { atkFlat: unit.s.atk * CETSYR_INSPIRE };
    for (const x of rangeAllies(battle, unit, { others: true })) fx.sustain(x, { key: 'tomorrow-inspire', mods: inspire, duration: seconds });
    return true;
  },
  lines: {
    0: ({ unit }) => { unit.mem.cetsyrDust = Math.max(unit.mem.cetsyrDust ?? 0, CETSYR_DUST); },
    1: 'cast',
    2: 'cast',
    3: {
      install: ({ battle, unit }) => battle.every(1, () => {
        if (!active(unit)) return;
        unit.mem.cetsyrDust = Math.min(dustCap(unit), unit.mem.cetsyrDust ?? 0);
        if (!(unit.mem.cetsyrDust > 0)) return;
        const fx = effects(battle, unit, { index: hasBuff(unit, ':skill:tomorrow') ? 'skill' : 3 });
        let spent = false;
        if (hasBuff(unit, ':skill:tomorrow')) {
          const e = rangeEnemies(battle, unit, 1)[0];
          if (e) { fx.damage(e, { scale: cardParam(unit, 2, 'b') / 100, type: 'true', isSkill: true }); if (e.alive) fx.status(e, { status: 'bind', duration: CETSYR_BIND }); spent = true; }
        } else {
          const x = rangeAllies(battle, unit, { others: true }).sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp || uid(a).localeCompare(uid(b)))[0];
          if (x) {
            battle.addBuff(x, { key: `assault:cetsyr:dust:${uid(unit)}`, mods: { healingTakenMul: CETSYR_HEAL_MUL }, duration: CETSYR_HEAL_SECONDS, refresh: 'replace', source: unit, visible: true });
            if (moduleOf(unit) === CETSYR_MODULE) fx.heal(x, { scale: CETSYR_MODULE_HEAL }); // 故事的结局
            spent = true;
          }
        }
        if (!spent) return;
        unit.mem.cetsyrDust--;
        battle.after(CETSYR_BACK, () => { unit.mem.cetsyrDust = Math.min(dustCap(unit), (unit.mem.cetsyrDust ?? 0) + 1); }, { owner: unit });
      }, { owner: unit }),
      run: () => {},
    },
    4: { options: { around: 'range' }, run: ({ unit, fx }) => fx.charge(unit, 0.5) },
    5: {
      // 魔王残响：攻击范围内其他干员受到的治疗 +c%（本局累计）
      install: ({ battle, unit }) => battle.every(0.25, () => {
        const pct = active(unit) ? runCounterValueOf(battle, unit) / 100 : 0;
        if (pct > 0) for (const x of rangeAllies(battle, unit, { others: true }))
          battle.addBuff(x, { key: `assault:cetsyr:echo:${uid(unit)}`, mods: { healingTakenMul: 1 + pct }, duration: 0.6, refresh: 'replace', source: unit });
      }, { owner: unit, immediate: true }),
      run: ({ unit, p, fx }) => fx.growthCounter(unit, { key: CETSYR_COUNTER, label: '受治疗提升', amount: p('c'), suffix: '%' }),
    },
  },
  modules: {
    [CETSYR_MODULE]: () => {}, // 故事的结局 — read by line 3
  },
});
const runCounterValueOf = (battle, unit) => effects(battle, unit, { index: 5 }).growthValue(unit, CETSYR_COUNTER);

// ---------------------------------------------------------------------- 遥 ---
// 浮泡: every attack interval one operator in her range gets a bubble of 庇护 that bursts soon after it is hit and heals its
// holder. A heal on one of your other operators without a bubble gives it one. 夏末游鳞 doubles the bubbles and lifts the
// enemies that hit them.

const HARUKA_DEPLOY = 3, HARUKA_POP_DELAY = 0.3, HARUKA_LIFT = 4, HARUKA_SKILL_ATK = 0.55, HARUKA_MODULE = 'uniequip_002_haruka', HARUKA_MODULE_CHANCE = 20;
const bubbleKey = (unit) => `assault:haruka:bubble:${uid(unit)}`;
const hasBubble = (x) => !!x?.buffs?.some((b) => String(b.key).startsWith('assault:haruka:bubble:'));
function giveBubble(battle, unit, x) {
  if (!x || !active(x) || hasBubble(x)) return false;
  const pct = cardParam(unit, 2, 'c') * (hasBuff(unit, ':skill:summer') ? 2 : 1) / 100;
  battle.addBuff(x, { key: bubbleKey(unit), mods: { dmgTakenMul: Math.max(0, 1 - pct) }, duration: Infinity, refresh: 'replace', source: unit, visible: true });
  return true;
}

const haruka = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'summer', mods: { atkPct: HARUKA_SKILL_ATK, rangeExtend: 1, batPct: INTERVAL.shorter }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  install: (battle, unit) => {
    // a bubble hit by an enemy bursts shortly after: it heals its holder (line 3), the module may charge it; during the skill
    // the attacker is lifted 4 s and takes b% a second while it is
    battle.on('hit', ({ source, target, dmg }) => {
      if (!active(unit) || source?.side !== 'enemy' || !target?.buffs?.some((b) => b.key === bubbleKey(unit)) || !dmg || target.mem?.harukaPopping) return;
      target.mem.harukaPopping = true;
      const skill = hasBuff(unit, ':skill:summer');
      battle.after(HARUKA_POP_DELAY, () => {
        target.mem.harukaPopping = false;
        if (!target.alive) return;
        battle.removeBuff(target, bubbleKey(unit));
        const fx = effects(battle, unit, { index: 3 });
        fx.heal(target, { scale: cardParam(unit, 3, 'd') / 100 });
        if (moduleOf(unit) === HARUKA_MODULE && battle.rng() < HARUKA_MODULE_CHANCE / 100) fx.charge(target, 1); // 迟来的纪念
        if (skill && source.alive) {
          const tick = effects(battle, unit, { index: 'skill' });
          tick.status(source, { status: 'levitate', duration: HARUKA_LIFT });
          let n = 0;
          const timer = battle.every(1, () => { if (++n > HARUKA_LIFT || !source.alive || !hasStatus(source, 'levitate')) { timer.cancel(); return; } tick.damage(source, { scale: cardParam(unit, 1, 'b') / 100, type: 'arts', isSkill: true }); }, { owner: unit });
        }
      }, { owner: unit });
    }, { owner: unit, priority: -20 });
  },
  lines: {
    0: ({ battle, unit }) => { for (const x of rangeAllies(battle, unit).filter((y) => !hasBubble(y)).slice(0, HARUKA_DEPLOY)) giveBubble(battle, unit, x); },
    1: 'cast',
    2: {
      // 浮光泡影：每过一个攻击间隔，使攻击范围内 1 名干员获得浮泡
      install: ({ battle, unit }) => {
        let wait = 0;
        battle.every(0.1, () => {
          if (!active(unit)) return;
          wait += 0.1;
          if (wait + 1e-9 < (unit.s.interval ?? 1.5)) return;
          wait = 0;
          const x = rangeAllies(battle, unit).filter((y) => !hasBubble(y)).sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp || uid(a).localeCompare(uid(b)))[0];
          giveBubble(battle, unit, x);
        }, { owner: unit });
      },
      run: () => {},
    },
    3: () => {}, // 扶摇花火 — the burst of the kit's hook
    4: { options: { accept: (payload) => !hasBubble(payload.target) }, run: ({ battle, unit, target }) => giveBubble(battle, unit, target) },
  },
  modules: {
    [HARUKA_MODULE]: () => {}, // 迟来的纪念 — the burst of the kit's hook
  },
});

// -------------------------------------------------------------------- 白铁 ---
// His support device feeds one operator SP every 3.5 s (every 2 s during 高效补给); devices come back when lost, and a
// summon of your other operators falling gives him one more. He hits the enemies your other operators block harder.

const IRONMN_DEVICE = 'token_10027_ironmn_pile2', IRONMN_EVERY = 3.5, IRONMN_SKILL_EVERY = 2, IRONMN_AROUND = 1, IRONMN_MODULE = 'uniequip_003_ironmn';
const ironCap = (unit) => 1 + (moduleOf(unit) === IRONMN_MODULE ? 1 : 0);
function ironDevice(battle, unit, cause) {
  if (ownSummons(battle, unit, IRONMN_DEVICE).length >= ironCap(unit)) { unit.mem.ironStock = (unit.mem.ironStock ?? 0) + 1; return false; }
  battle.assaultRuntime.withCause(cause, () => grantSummon(battle, unit, { tokenId: IRONMN_DEVICE, count: 1, stockCap: ironCap(unit), fieldCap: ironCap(unit), ruleKey: `ironmn:${uid(unit)}` }));
  return true;
}

const ironmn = (bb, raw, def) => synergyKit(def, {
  canCast: enemyInRange,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const b = cardParam(unit, 1, 'b') / 100;
    fx.sustain(unit, { key: 'supply', mods: { atkPct: b, defPct: b }, duration: cardParam(unit, 1, 'a') });
    if (!unit.mem.ironAllBlocked) {
      unit.mem.ironAllBlocked = { was: unit.profile.hitAllBlocked };
      unit.profile.hitAllBlocked = true; // 攻击所有被阻挡的敌人
      // 结束时获得 1 个支援装置
      whenSkillEnds(battle, unit, ':skill:supply', () => { unit.profile.hitAllBlocked = unit.mem.ironAllBlocked.was; unit.mem.ironAllBlocked = null; });
    }
    ironDevice(battle,unit,cause);
    return true;
  },
  lines: {
    0: ({ battle, unit, cause }) => {
      if (ownSummons(battle, unit, IRONMN_DEVICE).length < ironCap(unit)) ironDevice(battle, unit, cause);
      while ((unit.mem.ironStock ?? 0) > 0 && ownSummons(battle, unit, IRONMN_DEVICE).length < ironCap(unit)) { unit.mem.ironStock--; ironDevice(battle, unit, cause); }
    },
    1: 'cast',
    2: {
      // 节约经费：周围 8 格内此干员的装置损毁时，c% 几率回收并获得 1 个装置
      install: ({ battle, unit, p }) => battle.on('death', ({ unit: gone }) => {
        if (!active(unit) || gone?.defId !== IRONMN_DEVICE || gone.ownerUnit !== unit || !around8(unit, gone)) return;
        if (battle.rng() < p('c') / 100) battle.after(0, () => ironDevice(battle, unit, null), { owner: unit });
      }, { owner: unit }),
      run: () => {},
    },
    3: ({ battle, unit, cause }) => ironDevice(battle, unit, cause),
    4: {
      install: ({ battle, unit, p }) => onOwnDamage(battle, unit, ({ target, dmg }) => { if (dmg.isAttack && target.blockedBy && target.blockedBy !== unit) dmg.amount *= 1 + p('d') / 100; }),
      run: () => {},
    },
  },
  modules: {
    [IRONMN_MODULE]: () => {}, // 海布里印记：支援装置持有上限 +1 — ironCap
  },
});
const ironmnDevice = synergyToken(IRONMN_DEVICE, (battle, token, owner) => {
  token.profile.noAttack = true;
  let wait = 0;
  battle.every(0.25, () => {
    if (!active(token) || !active(owner)) return;
    wait += 0.25;
    if (wait + 1e-9 < (hasBuff(owner, ':skill:supply') ? IRONMN_SKILL_EVERY : IRONMN_EVERY)) return;
    wait = 0;
    // [ASSUMED] the operator around the device lowest in SP (the device's 1 名干员)
    const x = battle.assaultDeploymentOrder().filter((y) => isOp(y) && active(y) && y.ownerId === owner.ownerId && y.skill && !y.skill.noSkill && y.skill.kind !== 'passive'
      && Math.max(Math.abs(y.tileR - token.tileR), Math.abs(y.tileC - token.tileC)) <= IRONMN_AROUND + 1)
      .sort((a, b) => spTotal(a) - spTotal(b) || uid(a).localeCompare(uid(b)))[0];
    if (x) effects(battle, owner, { index: 0 }).charge(x, 1);
  }, { owner: token });
});

// -------------------------------------------------------------------- 塑心 ---
// She casts and nothing else (no normal attack): “黄金的狂喜”, stored three times and cast at every deployment, fills 凋亡损伤;
// 无词哀歌 seeps it into her whole range. Every element burst your other operators cause charges her, every 凋亡 burst
// deepens 精神逆构 for the battle.

const CELLO_SEEP_STOP = 0.2, CELLO_COUNTER = 'cello-reverse', CELLO_MODULE = 'uniequip_003_cello', CELLO_MODULE_TAKEN = 20, CELLO_MODULE_DPS = 150;

const cello = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit).some((e) => !inBurst(e, 'apoptosis')),
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = rangeEnemies(battle, unit).find((e) => !inBurst(e, 'apoptosis'));
    if (!target) return false;
    fx.damage(target, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
    if (target.alive) fx.elementDamage(target, { element: 'apoptosis', amount: unit.s.atk * cardParam(unit, 1, 'b') / 100 });
    return true;
  },
  install: (battle, unit) => { unit.profile.noAttack = true; }, // 技能未开启时无法普通攻击
  lines: {
    0: 'cast',
    1: 'cast',
    2: {
      // 无词哀歌：攻击范围内的敌人每秒受到 c% 攻击力的凋亡损伤，并停顿 0.2 秒（模组：凋亡爆发中的敌人每秒 150 点元素伤害）
      install: ({ battle, unit, p }) => battle.every(1, () => {
        if (!active(unit)) return;
        const fx = effects(battle, unit, { index: 2 });
        for (const e of rangeEnemies(battle, unit)) {
          fx.elementDamage(e, { element: 'apoptosis', amount: unit.s.atk * p('c') / 100 });
          if (e.alive) fx.status(e, { status: 'sluggish', duration: CELLO_SEEP_STOP });
          if (moduleOf(unit) === CELLO_MODULE && e.alive && inBurst(e, 'apoptosis')) fx.damage(e, { amount: CELLO_MODULE_DPS, type: 'elemental' });
        }
      }, { owner: unit }),
      run: () => {},
    },
    3: {
      // 精神逆构：攻击范围内的敌人受到的凋亡损伤 +d%（+ the battle's stacks of line 4; the module: every enemy +20% more）
      install: ({ battle, unit, p }) => battle.every(0.25, () => {
        if (!active(unit)) return;
        const module = moduleOf(unit) === CELLO_MODULE;
        for (const e of battle.enemies) {
          if (!e.alive || e.removed) continue;
          const inside = inRangeOf(unit, e);
          if (!inside && !module) continue;
          const pct = (inside ? p('d') + counterValue(battle, unit, CELLO_COUNTER) : 0) + (module ? CELLO_MODULE_TAKEN : 0);
          battle.addBuff(e, { key: `assault:cello:reverse:${uid(unit)}`, mods: { elemTakenMul: 1 + pct / 100 }, duration: 0.6, refresh: 'replace', source: unit });
        }
      }, { owner: unit, immediate: true }),
      run: ({ unit, p, fx }) => fx.charge(unit, p('e')),
    },
    4: ({ unit, p, fx }) => fx.counter(unit, { key: CELLO_COUNTER, label: '精神逆构', amount: p('f'), suffix: '%' }),
  },
  modules: {
    [CELLO_MODULE]: () => {}, // 音乐家的旅程 — read by lines 2 and 3
  },
});

export const synergyRangedKits = Object.freeze({
  char_213_mostma: mostma,
  char_2023_ling: ling,
  char_4000_jnight: jnight,
  char_253_greyy: greyy,
  char_4051_akkord: akkord,
  char_469_indigo: indigo,
  char_235_jesica: jesica,
  char_126_shotst: shotst,
  char_190_clour: clour,
  char_440_pinecn: pinecn,
  char_366_acdrop: acdrop,
  char_4100_caper: caper,
  char_183_skgoat: skgoat,
  char_258_podego: podego,
  char_484_robrta: robrta,
  char_204_platnm: platnm,
  char_1021_kroos2: kroos2,
  char_498_inside: inside,
  char_279_excu: excu,
  char_346_aosta: aosta,
  char_002_amiya: amiya,
  char_306_leizi: leizi,
  char_344_beewax: beewax,
  [BEEWAX_OBELISK]: beewaxObelisk,
  char_373_lionhd: lionhd,
  char_341_sntlla: sntlla,
  char_4031_liesel: liesel,
  char_388_mint: mint,
  char_4013_kjera: kjera,
  char_4040_rockr: rockr,
  char_4054_malist: malist,
  char_242_otter: otter,
  [OTTER]: otterToken,
  char_145_prove: prove,
  char_4211_snhunt: snhunt,
  char_174_slbell: slbell,
  char_254_vodfox: vodfox,
  [VODFOX_DOLL]: vodfoxDoll,
  char_4079_haini: haini,
  char_4032_provs: provs,
  char_4122_grabds: grabds,
  char_4162_cathy: cathy,
  [CATHY_DEVICE]: cathyDevice,
  char_4045_heidi: heidi,
  char_4019_ncdeer: ncdeer,
  char_446_aroma: aroma,
  char_103_angel: angel,
  char_332_archet: archet,
  char_430_fartth: fartth,
  char_4193_lemuen: lemuen,
  char_391_rosmon: rosmon,
  char_1035_wisdel: wisdel,
  [WISDEL_SHADE]: wisdelShade,
  char_4117_ray: ray,
  [RAY_BEAST]: rayBeast,
  char_4027_heyak: heyak,
  char_4133_logos: logos,
  char_2015_dusk: dusk,
  char_472_pasngr: pasngr,
  char_426_billro: billro,
  char_1046_sbell2: sbell2,
  char_1038_whitw2: whitw2,
  char_4146_nymph: nymph,
  char_1040_blaze2: blaze2,
  char_206_gnosis: gnosis,
  char_291_aglina: aglina,
  char_358_lisa: lisa,
  char_1047_halo2: halo2,
  char_1012_skadi2: skadi2,
  char_4134_cetsyr: cetsyr,
  char_4202_haruka: haruka,
  char_4072_ironmn: ironmn,
  [IRONMN_DEVICE]: ironmnDevice,
  char_245_cello: cello,
});
