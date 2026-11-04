// Synergy cards of the assault family (design of 2026-10-21, design-172.json via tools/assault/import-synergy-design.mjs).
// One kit per card: the skill cast, plus one handler per card line in the card's order (server/sim/content/assault/
// card-lines.js wires each line from its compiled trigger / limit / params). Numbers come from the card params
// (p('a') / cardParam) — the text the player reads; a constant written in the card text is a constant here and the
// card test checks the text says the same.

import { synergyKit, cardParam, moduleParam, moduleOf, effects, isElite, around8 } from '../card-lines.js';
import { allyAura, enemyAura, hasStatus, counterValue, runCounterValue, relates, withinAdjacent4, hasOwnBarrier, matchesClass, ammoSkill, maxAmmo } from '../synergy.js';
import { active, enemies, uid, payDP } from '../primitives.js';
import { grantSummon, summonPlacementLegal } from '../summons.js';
import { assaultAmmoState, consumeAssaultAmmo } from '../ammo.js';
import { assaultTokenKits } from './assault-tokens.js';
import { COLS } from '../../../constants.js';
import { resolveSkill } from '../skill-resolution.js';
import { hypot } from '../../../detmath.js';

const rangeEnemies = (battle, unit, count = 99) => enemies(battle, unit, { scope: 'range', count });
/** Enemies on the 8 tiles around `unit` (and its own), nearest the exit first — lifted ones included (浮空 makes an
 * enemy untargetable for attacks, not for this). */
const aroundEnemies = (battle, unit, count = 99) => battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden && around8(unit, e))
  .sort((a, b) => battle.remainingDistance(a) - battle.remainingDistance(b) || uid(a).localeCompare(uid(b))).slice(0, count);
/** Enemies on the unit's own tile and the four around it (周围四格). */
const adjacentEnemies = (battle, unit, count = 99) => battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden && withinAdjacent4(unit, e))
  .sort((a, b) => battle.remainingDistance(a) - battle.remainingDistance(b) || uid(a).localeCompare(uid(b))).slice(0, count);
/** 身前的敌人: the first enemy it blocks, else the first one in its attack range. */
const frontEnemy = (battle, unit) => (unit.blocking ?? []).find((e) => e.alive && e.blockedBy === unit) ?? rangeEnemies(battle, unit, 1)[0] ?? null;
const isMelee = (x) => (x?.def?.raw?.assaultBody?.position ?? x?.def?.position) === 'MELEE';
/** Your operators on the field (the card's unit included) that `pick` accepts. */
const yourOps = (battle, unit, pick = () => true) => battle.allyUnits.filter((x) => x.kind === 'op' && active(x) && relates(unit, x, 'yours') && pick(x));
/** Is the card's timed skill effect `name` (fx.sustain from the cast) running on `unit`? */
const sustained = (unit, name) => (unit.buffs ?? []).some((b) => String(b.key).startsWith('assault:sustain:') && String(b.key).endsWith(`:skill:${name}`));
/** A normal attack's hit (not a skill, not a card effect's damage). */
const normalAttack = (payload) => payload?.skillId == null && typeof payload?.attackId === 'number';
const lostRatio = (unit) => Math.max(0, Math.min(1, 1 - unit.hp / unit.s.maxHp));
/** 坚忍: the bonus grows with the HP lost and is full at 70% lost. */
const BERSERK_FULL = 0.7;
const berserk = (unit) => Math.min(1, lostRatio(unit) / BERSERK_FULL);

/** Once per unit: guards hooks and timers that a line installs at every real deployment. */
const once = (unit, key) => { const k = `assaultOnce:${key}`; if (unit.mem[k]) return false; unit.mem[k] = true; return true; };

/**
 * A live buff on the card's unit while `mods()` returns mods (re-read every 0.25 s and kept in step with them), gone
 * when it returns null. For what the card text ties to a changing state (生命低于 50% 时 / 坚忍 / 拥有屏障时).
 */
function liveSelf(battle, unit, key, mods) {
  if (!once(unit, `liveSelf:${key}`)) return;
  const buffKey = `assault:live:${uid(unit)}:${key}`;
  const sync = () => {
    const m = active(unit) ? mods() : null;
    if (m) battle.addBuff(unit, { key: buffKey, mods: m, duration: Infinity, refresh: 'replace', persist: true, source: unit });
    else if (unit.buffs?.some((b) => b.key === buffKey)) battle.removeBuff(unit, buffKey);
  };
  battle.every(0.25, sync, { owner: unit, immediate: true });
  sync();
}

/**
 * 光环 with a changing size: your operators `pick` accepts get `mods(x)` (re-read every 0.25 s), a short buff that
 * lapses soon after one stops matching or the source leaves.
 */
function liveAura(battle, unit, key, { pick, mods }) {
  if (!once(unit, `liveAura:${key}`)) return;
  const buffKey = `assault:liveAura:${uid(unit)}:${key}`;
  const sync = () => {
    if (!active(unit)) return;
    for (const x of yourOps(battle, unit, pick)) {
      const m = mods(x);
      if (m) battle.addBuff(x, { key: buffKey, mods: m, duration: 0.6, refresh: 'replace', source: unit });
    }
  };
  battle.every(0.25, sync, { owner: unit, immediate: true });
  sync();
}

/** A native hit hook of the card's unit, installed once: fn({ target, dmg }) may change the damage before it lands. */
function onOwnHit(battle, unit, key, fn, priority = 90) {
  if (!once(unit, `hit:${key}`)) return;
  battle.on('hit', ({ source, target, dmg }) => { if (source === unit && active(unit) && dmg) fn({ target, dmg }); }, { owner: unit, priority });
}

/** A barrier (shield HP) of `amount` from `unit` on `target`; `decay` seconds: it shrinks evenly to 0 over that time. */
function barrier(battle, unit, target, key, amount, decay = null) {
  if (!(amount > 0) || !active(target)) return null;
  const spec = { key: `assault:barrier:${uid(unit)}:${key}`, shield: amount, duration: decay ?? Infinity, visible: true, source: unit };
  if (decay) {
    let step = 0;
    Object.assign(spec, { interval: 1, onTick: ({ unit: owner, buff }) => {
      const before = Math.max(0, decay - step) / decay, after = Math.max(0, decay - ++step) / decay;
      if (before > 0 && buff.shield > 0) { buff.shield *= after / before; owner.markDirty(); }
    } });
  }
  return battle.addBuff(target, spec);
}

/** 拖拽到身前 an enemy already next to the unit: onto its front tile (pullToFront stops at contact, which it already is). */
const DRAG_FORCE = 2;
function dragToFront(battle, unit, e) {
  const f = Array.isArray(unit.fwd) ? unit.fwd : [0, 1];
  return battle.pull(e, DRAG_FORCE, { to: { x: unit.x + f[1], y: unit.y + f[0] }, stop: 0.1 });
}


/** The unit's attack range tiles inside the field. */
const rangeTiles = (battle, unit) => [...(unit.rangeKeys ?? [])].map((k) => [Math.floor(k / COLS), k % COLS]).filter(([r, c]) => battle.grid.inRect(r, c));
const onTile = (x, [r, c], radius = 0.65) => hypot(x.y - r, x.x - c) <= radius;
/** A free ground tile of the range for a device, nearest the enemies (the old kits' device placement). */
function deviceTile(battle, unit) {
  const live = battle.enemies.filter((e) => e.alive && !e.removed);
  const tiles = rangeTiles(battle, unit).filter(([r, c]) => battle.grid.isLow(r, c) && !battle._occ[r * COLS + c]?.alive && !battle.downOn(r, c));
  const gap = ([r, c]) => (live.length ? Math.min(...live.map((e) => hypot(e.y - r, e.x - c))) : 0);
  tiles.sort((a, b) => gap(a) - gap(b) || a[0] - b[0] || a[1] - b[1]);
  return tiles[0] ?? null;
}
/** The range tile with the most enemies on it and around it (「攻击范围内敌人最多处」). */
function crowdTile(battle, unit) {
  const live = battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden);
  let best = null, most = 0;
  for (const tile of rangeTiles(battle, unit)) {
    const n = live.filter((e) => Math.max(Math.abs(Math.round(e.y) - tile[0]), Math.abs(Math.round(e.x) - tile[1])) <= 1).length;
    if (n > most) { most = n; best = tile; }
  }
  return best;
}
/**
 * A device of the card on `tile` that the first enemy stepping on sets off: `trigger(victim, device)` runs once, the
 * `deviceTrigger` event goes out (多萝西 / 罗宾 extras listen to it) and the device is gone.
 */
function trapDevice(battle, unit, tile, name, trigger) {
  const seq = (unit.mem.assaultTrapSeq = (unit.mem.assaultTrapSeq ?? 0) + 1);
  const device = battle.spawnDevice(`assault:${unit.def.charId}:${uid(unit)}:trap:${seq}`, tile[0], tile[1], { name, hp: 1, ownerUnit: unit });
  if (!device) return null;
  device.ownerId = unit.ownerId;
  device.sourceOwnerUid = uid(unit);
  const timer = battle.every(0.1, (b) => {
    if (!device.alive) { timer.cancel(); return; }
    const victim = b.enemies.find((e) => e.alive && !e.removed && !e.isFlying && onTile(e, tile));
    if (!victim) return;
    timer.cancel();
    trigger(victim, device);
    if (b._hooks.deviceTrigger) b.emit('deviceTrigger', { source: unit, sourceUid: uid(unit), target: victim, targetUid: uid(victim), device });
    if (device.alive) b.retreat(device, { reason: 'expired', permanent: true });
  }, { owner: device });
  return device;
}

/** 此干员当前再部署时间 -x 秒: the unit's own running loop (or its knocked-out timer). */
function cutOwnRedeploy(battle, unit, seconds) {
  if (unit.alive && unit.deployed && unit.assaultCycle) { unit.assaultCycle.at = battle.time + Math.max(0, unit.assaultCycle.at - battle.time - seconds); return true; }
  if (!unit.alive && !unit.removed && Number.isFinite(unit.respawnAt) && unit.respawnAt > battle.time) { unit.respawnAt = Math.max(battle.time, unit.respawnAt - seconds); return true; }
  return false;
}

// ------------------------------------------------------------------ 银灰 ---
// Two 银灰 feed each other: each cast cuts the other operators' running 再部署 timer; every other operator's 再部署
// charges him. 领袖 makes the whole loop shorter.

const svrash = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    // 雪境姿态: 防御力 +100%, 每秒回复 6% 最大生命 (constants of the card text); a recast refreshes the time
    fx.sustain(unit, { key: 'snow-stance', mods: { defPct: 1, hpRegenRatio: 0.06 }, duration: cardParam(unit, 1, 'a') });
    fx.cutRedeploy({ seconds: cardParam(unit, 2, 'a'), includeSelf: false });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => {
      for (const e of rangeEnemies(battle, unit)) {
        fx.status(e, { status: 'cold', duration: p('a') });
        fx.buff(e, { key: 'reveal', mods: {}, flags: { reveal: true }, duration: p('a') });
      }
    },
    1: 'cast',
    2: 'cast',
    3: ({ battle, unit, p, fx }) => {
      fx.buff(unit, { key: 'leader-atk', mods: { atkPct: p('a') / 100 }, persist: true });
      allyAura(battle, unit, { key: 'leader-redeploy', mods: { redeployMul: 1 - p('b') / 100 } });
    },
    4: ({ unit, fx }) => fx.charge(unit, 1),
    5: ({ battle, unit }) => {
      const inRange = (e) => rangeEnemies(battle, unit).includes(e);
      enemyAura(battle, unit, { key: 'hawk-eye', flags: { reveal: true }, select: inRange });
    },
  },
  modules: {
    // 雪境羽兽护理套组：周围 8 格内其他干员的再部署时间额外 -10%；攻击精英与领袖敌人时攻击力提升至 115%
    uniequip_002_svrash: ({ battle, unit }) => {
      allyAura(battle, unit, { key: 'module-redeploy', mods: { redeployMul: 0.9 }, select: (x) => x !== unit && around8(unit, x) });
      battle.on('hit', ({ source, target, dmg }) => {
        if (source === unit && active(unit) && isElite(target) && dmg && dmg.amount > 0) dmg.mul *= 1.15;
      }, { owner: unit, priority: 90 });
    },
  },
});

// ------------------------------------------------------------------ 重岳 ---
// 止戈 marks a target for 2.5 s: his damage to it rises. 拂尘 lifts the marked ones and slams every lifted enemy
// around him (止戈 always procs on them). 万象为宾 lets your 近卫 block flyers; their air blocks charge him; every
// lift or 失重 by your other operators adds 3% to 止戈 for the battle (a card counter: shown on the detail card).
// 模组「朔」 raises the 止戈 bonus to its own value.

const ZHIGE_SECONDS = 2.5, ZHIGE_STACK = 3, CHYUE_LIFT = 1, ZHIGE_COUNTER = 'chyue-zhige';
const zhigeKey = (unit) => `assault:chyue:zhige:${uid(unit)}`;
const marked = (unit, e) => e?.buffs?.some((b) => b.key === zhigeKey(unit) && b.timeLeft > 0);
function markZhige(battle, unit, e) {
  battle.addBuff(e, { key: zhigeKey(unit), mods: {}, duration: ZHIGE_SECONDS, refresh: 'replace', source: unit, visible: true });
}
function lift(battle, unit, e, cause) {
  battle.assaultRuntime.withCause(cause, () => battle.applyStatus(e, 'levitate', { duration: CHYUE_LIFT, source: unit, instanceKey: `chyue:${uid(unit)}:lift` }));
}

const chyue = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const first = aroundEnemies(battle, unit, 4);
    let kills = 0;
    for (const e of first) {
      fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
      if (!e.alive) kills++;
      else if (marked(unit, e)) lift(battle, unit, e, cause);
    }
    // 落地：every lifted enemy around him, 止戈 procs for sure
    for (const e of aroundEnemies(battle, unit, 99).filter((x) => hasStatus(x, 'levitate'))) {
      for (const b of [...e.buffs].filter((x) => x.status === 'levitate')) battle.removeBuff(e, b);
      markZhige(battle, unit, e);
      fx.damage(e, { scale: cardParam(unit, 1, 'b') / 100, type: 'phys', isSkill: true });
      if (!e.alive) kills++;
    }
    unit.mem.chyueCastKills = kills;
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx, cause }) => {
      for (const e of aroundEnemies(battle, unit, 4)) {
        fx.damage(e, { scale: p('a') / 100, type: 'phys' });
        if (e.alive) lift(battle, unit, e, cause);
      }
    },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => {
        // the bonus of 止戈 on its marked targets (+3% more per 本场 stack of line 6)
        battle.on('hit', ({ source, target, dmg }) => {
          if (source !== unit || !active(unit) || !marked(unit, target) || !dmg || !(dmg.amount > 0)) return;
          const bonus = moduleParam(unit, 'uniequip_003_chyue', 'a', p('b'));
          dmg.mul *= 1 + (bonus + counterValue(battle, unit, ZHIGE_COUNTER)) / 100;
        }, { owner: unit, priority: 100 });
      },
      options: { accept: (payload) => payload.skillId == null },
      run: ({ battle, unit, p, target }) => { if (target?.alive && battle.rng() < p('a') / 100) markZhige(battle, unit, target); },
    },
    3: { options: { accept: (payload, ctx) => (ctx.unit.mem.chyueCastKills ?? 0) >= 1 }, run: ({ unit, fx }) => fx.charge(unit, 3) },
    4: ({ fx }) => fx.airAura({ label: '近卫' }),
    5: ({ unit, fx }) => fx.charge(unit, 1),
    6: ({ unit, fx }) => fx.counter(unit, { key: ZHIGE_COUNTER, label: '止戈伤害加成', amount: ZHIGE_STACK, suffix: '%' }),
  },
  modules: {
    // “朔”：止戈的伤害加成提升至 75/80% — read by the 止戈 hook of line 2
    uniequip_003_chyue: () => {},
  },
});

// ---------------------------------------------------------------- 乌尔比安 ---
// The anchor drags two enemies to him. Every kill of your other 深海猎人 grows him for the run; his own kills charge
// them (rewardsOthers: his trigger, their reward).

const ULPIA_MODULE = 'uniequip_002_ulpia', ULPIA_MODULE_LOW = 0.6;
function anchorTargets(battle, unit) {
  const primary = rangeEnemies(battle, unit, 1)[0];
  if (!primary) return [];
  return battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden && around8(primary, e)).slice(0, 2);
}
function dragAll(battle, unit, targets) { for (const e of targets) if (e.alive) battle.pullToFront(e, unit, 1); }

const ulpia = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => anchorTargets(battle, unit).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = anchorTargets(battle, unit);
    dragAll(battle, unit, targets);
    for (const e of targets) if (e.alive) fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
    return targets.length > 0;
  },
  lines: {
    0: ({ battle, unit }) => dragAll(battle, unit, anchorTargets(battle, unit)),
    1: 'cast',
    // 本性的坚守 (模组「乌尔比安的衣橱」：回复提升、低血线 60%)
    2: ({ unit, p, fx }) => {
      const module = moduleParam(unit, ULPIA_MODULE, 'a', null) != null;
      const low = unit.hp < unit.s.maxHp * (module ? ULPIA_MODULE_LOW : 0.5);
      fx.heal(unit, { amount: module ? moduleParam(unit, ULPIA_MODULE, low ? 'b' : 'a') : low ? p('b') : p('a') });
    },
    3: ({ unit, p, fx }) => {
      fx.growth(unit, { key: 'abyssal-hp', stat: 'maxHp', flat: p('a') });
      fx.growth(unit, { key: 'abyssal-atk', stat: 'atk', flat: p('b') });
    },
    4: ({ unit, fx }) => { for (const x of fx.allies('allies:深海猎人')) fx.charge(x, 1); },
  },
  modules: {
    // 乌尔比安的衣橱：回复提升至 130；生命低于 60% 时提升至 175 — read by line 2
    [ULPIA_MODULE]: () => {},
  },
});

// ---------------------------------------------------------------- 艾丝黛尔 ---
// Drags the loose ones to her; 舍身突击 is a refreshable self-buff that stacks attack from every hit she takes; every
// enemy your other operators fell next to her heals her and grows her HP for the run.

const ESTELL_MODULE = 'uniequip_002_estell';

const estell = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.sustain(unit, { key: 'assault', mods: { atkPct: cardParam(unit, 1, 'b') / 100 }, flags: { noHeal: true }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  lines: {
    0: ({ battle, unit }) => { for (const e of adjacentEnemies(battle, unit)) if (!e.blockedBy && !e.isFlying) dragToFront(battle, unit, e); },
    1: 'cast',
    2: {
      options: { accept: (payload, ctx) => around8(ctx.unit, payload.target) },
      run: ({ unit, p, fx }) => {
        fx.heal(unit, { maxHpRatio: moduleParam(unit, ESTELL_MODULE, 'a', p('a')) / 100 });
        fx.growth(unit, { key: 'regrowth', stat: 'maxHp', flat: p('b') });
      },
    },
    3: {
      options: { accept: (payload, ctx) => payload.source?.side === 'enemy' && sustained(ctx.unit, 'assault') },
      run: ({ unit, p, fx }) => fx.stack(unit, { key: 'assault-atk', stat: 'atk', amount: p('a') / 100, mode: 'percent' }),
    },
  },
  modules: {
    // 荒野地的饯别礼：自愈能力的回复提升至 16/18% — read by line 2
    [ESTELL_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 宴 ---
// A deploy-cast passive: every deployment and in-place 再部署 she drops to half HP and strikes in arts; 坚忍 turns the
// lost HP into attack speed, and every other operator's 再部署 costs her HP and stacks more speed for the battle.

const UTAGE_DROP = 0.5, UTAGE_REDEPLOY_DROP = 0.1, UTAGE_MODULE = 'uniequip_002_utage', UTAGE_MODULE_LOW = 0.5;

const utage = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.loseHp(unit, { currentPct: UTAGE_DROP });
    fx.sustain(unit, { key: 'gate', mods: { atkPct: cardParam(unit, 1, 'b') / 100 }, duration: cardParam(unit, 1, 'a') });
    // 伤害类型变为法术 while it lasts
    onOwnHit(battle, unit, 'utage-arts', ({ dmg }) => { if (dmg.isAttack && dmg.type === 'phys' && sustained(unit, 'gate')) dmg.type = 'arts'; });
    return true;
  },
  lines: {
    0: 'cast',
    1: 'cast',
    2: ({ battle, unit, p }) => liveSelf(battle, unit, 'berserk', () => ({ aspd: p('a') * berserk(unit) })),
    3: ({ unit, p, fx }) => {
      fx.loseHp(unit, { currentPct: UTAGE_REDEPLOY_DROP });
      fx.stack(unit, { key: 'serious', stat: 'aspd', amount: p('a'), mode: 'flat' });
    },
  },
  modules: {
    // 翻盖手机：生命低于 50% 时，攻击力与防御力 +6/8%
    [UTAGE_MODULE]: ({ battle, unit }) => liveSelf(battle, unit, 'module', () => {
      const x = moduleParam(unit, UTAGE_MODULE, 'a') / 100;
      return unit.hp < unit.s.maxHp * UTAGE_MODULE_LOW ? { atkPct: x, defPct: x } : null;
    }),
  },
});

// ---------------------------------------------------------------- 休谟斯 ---
// Every heal your other operators give (to anyone: her 收割者 trait keeps her out of their heals) turns half of it into her
// barrier (a share to her neighbours) and stacks her defence for the battle.

const HUMUS_RECYCLE = 0.5, HUMUS_SHARE = 0.3, HUMUS_MODULE = 'uniequip_002_humus';

const humus = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => !!frontEnemy(battle, unit),
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = frontEnemy(battle, unit);
    if (!target) return false;
    fx.damage(target, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
    fx.heal(unit, { amount: cardParam(unit, 1, 'b') });
    return true;
  },
  lines: {
    0: ({ battle, unit, p }) => barrier(battle, unit, unit, 'deploy', unit.s.maxHp * p('a') / 100),
    1: 'cast',
    2: ({ battle, unit, p, payload }) => {
      const key = `assault:barrier:${uid(unit)}:recycle`;
      const current = unit.buffs.find((b) => b.key === key)?.shield ?? 0;
      const next = Math.min(unit.s.maxHp * p('a') / 100, current + (Number(payload?.amount) || 0) * HUMUS_RECYCLE);
      if (!(next > current)) return;
      battle.addBuff(unit, { key, shield: next, duration: Infinity, visible: true, source: unit });
      for (const x of yourOps(battle, unit, (y) => y !== unit && withinAdjacent4(unit, y))) barrier(battle, unit, x, `recycle-share:${uid(x)}`, (next - current) * HUMUS_SHARE);
    },
    3: ({ unit, p, fx }) => fx.stack(unit, { key: 'recycle-def', stat: 'def', amount: p('a') / 100, mode: 'percent' }),
  },
  modules: {
    // 恶地奇异工具套组：拥有来源于自身的屏障时，防御力 +8%
    [HUMUS_MODULE]: ({ battle, unit }) => liveSelf(battle, unit, 'module', () => (hasOwnBarrier(unit) ? { defPct: moduleParam(unit, HUMUS_MODULE, 'a') / 100 } : null)),
  },
});

// -------------------------------------------------------------------- 砾 ---
// A deploy-cast passive: a decaying barrier at every deployment. Cheap operators get her defence aura; every other
// 卡西米尔 再部署 brings her own loop closer, and her module pushes theirs.

const GRAVEL_DECAY = 10, GRAVEL_COST = -1, GRAVEL_CHEAP = 10;

const gravel = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit }) => { const seq=unit.mem.gravelBarrier=(unit.mem.gravelBarrier??0)+1;barrier(battle, unit, unit, `rats:${seq}`, unit.s.maxHp * cardParam(unit, 1, 'a') / 100, GRAVEL_DECAY); return true; },
  lines: {
    0: 'cast',
    1: 'cast',
    2: ({ battle, unit, p }) => allyAura(battle, unit, { key: 'small-support', mods: { defPct: p('a') / 100 },
      select: (x) => x !== unit && battle.assaultDeploymentCost(x) <= GRAVEL_CHEAP }),
    3: ({ battle, unit, p }) => cutOwnRedeploy(battle, unit, p('a')),
  },
  modules: {
    // 隐秘行动工具包：部署时，你的其他卡西米尔干员当前再部署时间 -4/5 秒
    uniequip_002_gravel: ({ unit, fx }) => fx.cutRedeploy({ seconds: moduleParam(unit, 'uniequip_002_gravel', 'a'), filter: { label: '卡西米尔' }, includeSelf: false }),
  },
  // 此干员部署费用 -1 (every deployment of the battle, the first one included)
  install: (battle, unit) => { unit.mem.assaultCostDelta = (unit.mem.assaultCostDelta ?? 0) + GRAVEL_COST; },
});

// ---------------------------------------------------------------- 诗怀雅 ---
// 近距离作战指导 lifts the melee operators around her; every fall next to her grows it for the battle, 协同作战 triples it.

const SWIRE_COUNTER = 'swire-guidance', SWIRE_SKILL_MUL = 3, SWIRE_STACK = 1;

const swire = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'together', mods: { atkPct: cardParam(unit, 1, 'b') / 100 }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  lines: {
    0: ({ unit, p, fx }) => { for (const x of fx.allies('otherAllies')) if (isMelee(x) && around8(unit, x)) fx.charge(x, p('a')); },
    1: 'cast',
    2: ({ battle, unit, p }) => liveAura(battle, unit, 'guidance', {
      pick: (x) => x !== unit && isMelee(x) && around8(unit, x),
      mods: () => ({ atkPct: (p('a') + counterValue(battle, unit, SWIRE_COUNTER)) * (sustained(unit, 'together') ? SWIRE_SKILL_MUL : 1) / 100 }),
    }),
    3: {
      options: { accept: (payload, ctx) => around8(ctx.unit, payload.target) },
      run: ({ unit, fx }) => fx.counter(unit, { key: SWIRE_COUNTER, label: '近距离作战指导', amount: SWIRE_STACK, suffix: '%' }),
    },
  },
  modules: {
    // 防身口红：周围 8 格内的其他干员施放技能时，此干员充能 1（每 2 秒最多一次）
    uniequip_002_swire: { options: { around: 8 }, run: ({ unit, fx }) => fx.charge(unit, 1) },
  },
});

// ------------------------------------------------------------------ 鞭刃 ---
// 责骂 speeds up your sturdy melee line (阻挡数 ≥ 3) and grows with every new block of your other operators; their broken
// shields charge her, and each of her deployments shields them.

const SOPHIA_BLOCK = 3, SOPHIA_SKILL_MUL = 2, SOPHIA_STACK = 1, SOPHIA_COUNTER = 'sophia-scold', SOPHIA_MODULE = 'uniequip_002_sophia';
const sophiaLine = (unit) => (x) => x !== unit && isMelee(x) && (x.s.blockCnt ?? 0) >= SOPHIA_BLOCK;
const shieldKey = (unit) => `assault:layers:${uid(unit)}:sophia`;

const sophia = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    // 同时攻击阻挡的所有敌人: one target more for each enemy she can block besides the first (the extra block counted)
    const all = unit.s.blockCnt ?? 1;
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'whip',
      mods: { atkPct: cardParam(unit, 1, 'b') / 100, rangeExtend: 1, blockCnt: 1, maxTargets: all }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  lines: {
    0: ({ battle, unit }) => {
      for (const x of yourOps(battle, unit, sophiaLine(unit))) battle.addBuff(x, { key: shieldKey(unit), shieldHits: 1, duration: Infinity, visible: true, source: unit });
    },
    1: 'cast',
    2: ({ battle, unit, p }) => liveAura(battle, unit, 'scold', {
      pick: sophiaLine(unit),
      mods: () => {
        const mul = sustained(unit, 'whip') ? SOPHIA_SKILL_MUL : 1;
        return { aspd: (p('a') + counterValue(battle, unit, SOPHIA_COUNTER)) * mul, defPct: p('b') * mul / 100 };
      },
    }),
    3: ({ unit, p, fx }) => fx.charge(unit, p('a')),
    4: ({ unit, fx }) => fx.counter(unit, { key: SOPHIA_COUNTER, label: '责骂攻击速度加成', amount: SOPHIA_STACK }),
  },
  modules: {
    // 加长鞭刃丝线：部署时，获得护盾的卡西米尔干员再获得 1 层 (after line 0 of the same deployment)
    [SOPHIA_MODULE]: ({ battle, unit }) => {
      for (const x of yourOps(battle, unit, (y) => sophiaLine(unit)(y) && matchesClass(y, { label: '卡西米尔' }))) {
        const held = x.buffs.find((b) => b.key === shieldKey(unit));
        if (held) battle.addBuff(x, { key: shieldKey(unit), shieldHits: held.shieldHits + moduleParam(unit, SOPHIA_MODULE, 'a'), duration: Infinity, visible: true, source: unit });
      }
    },
  },
});

// ------------------------------------------------------------------ 摩根 ---
// A deploy-cast passive: she trades 70% of her HP for a big decaying barrier and a harder strike; when the barrier
// breaks it stuns everything around her, 坚忍 pays her lost HP back in attack, falls next to her stack more.

const MORGAN_DROP = 0.7, MORGAN_DECAY = 6, MORGAN_STUN = 1, MORGAN_MODULE = 'uniequip_002_morgan';

const morgan = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.loseHp(unit, { maxPct: MORGAN_DROP });
    barrier(battle, unit, unit, 'parry', unit.s.maxHp * cardParam(unit, 1, 'a') / 100, MORGAN_DECAY);
    fx.sustain(unit, { key: 'parry', mods: { atkScaleMul: cardParam(unit, 1, 'c') / 100 }, duration: cardParam(unit, 1, 'b') });
    return true;
  },
  lines: {
    0: 'cast',
    1: 'cast',
    2: ({ battle, unit, p }) => liveSelf(battle, unit, 'berserk', () => ({ atkPct: moduleParam(unit, MORGAN_MODULE, 'a', p('a')) * berserk(unit) / 100 })),
    3: {
      options: { accept: (payload) => String(payload.shieldKind ?? 'hp') === 'hp' },
      run: ({ battle, unit, p, fx }) => {
        for (const e of aroundEnemies(battle, unit)) {
          fx.damage(e, { scale: p('a') / 100, type: 'phys' });
          if (e.alive) fx.status(e, { status: 'stun', duration: MORGAN_STUN });
        }
      },
    },
    4: {
      options: { accept: (payload, ctx) => withinAdjacent4(ctx.unit, payload.target) },
      run: ({ unit, p, fx }) => fx.stack(unit, { key: 'vanguard-atk', stat: 'atk', amount: p('a') / 100, mode: 'percent' }),
    },
  },
  modules: {
    // “钢铁之心”：沸血先锋的攻击力上限提升至 58/60% — read by line 2
    [MORGAN_MODULE]: () => {},
  },
});

// ---------------------------------------------------------------- 因陀罗 ---
// 碎甲拳 at every deployment and cast; she dodges and hits back twice as hard. The stuns / 战栗 / sleeps of your other
// operators charge her and her 碎甲拳 ignores all their defence; the elite kills of your 维多利亚 grow her counter-punch.

const TIGER_DODGE_BONUS = 100, TIGER_MODULE = 'uniequip_002_tiger', TIGER_GROWTH = 'tiger-counter';
const TIGER_OPEN = ['stun', 'tremble', 'sleep'];
function armourBreaker(battle, unit, fx, scaleIndex) {
  const target = frontEnemy(battle, unit);
  if (!target) return false;
  const open = TIGER_OPEN.some((s) => hasStatus(target, s));
  fx.damage(target, { scale: 1 + cardParam(unit, scaleIndex, 'a') / 100, type: 'phys', isSkill: true,
    defIgnorePct: open ? 1 : cardParam(unit, scaleIndex, 'b') / 100 });
  return true;
}

const tiger = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => !!frontEnemy(battle, unit),
  cast: ({ battle, unit, cause }) => armourBreaker(battle, unit, effects(battle, unit, { index: 'skill' }, cause), 1),
  lines: {
    0: ({ battle, unit, fx }) => armourBreaker(battle, unit, fx, 1),
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => {
        // [ASSUMED] 近战物理攻击 → every physical attack (the engine's dodge has no melee / ranged split)
        liveSelf(battle, unit, 'tiger-dodge', () => ({ dodgePhys: p('a') / 100 }));
        onOwnHit(battle, unit, 'tiger-counter', ({ dmg }) => {
          if (!dmg.isAttack || !unit.mem.tigerCounter) return;
          unit.mem.tigerCounter = false;
          const bonus = moduleParam(unit, TIGER_MODULE, 'a', TIGER_DODGE_BONUS) + runCounterValue(battle, unit, TIGER_GROWTH);
          dmg.mul *= 1 + bonus / 100;
        });
      },
      run: ({ unit }) => { unit.mem.tigerCounter = true; },
    },
    3: ({ unit, fx }) => fx.charge(unit, 1),
    4: ({ unit, p, fx }) => fx.growthCounter(unit, { key: TIGER_GROWTH, label: '闪避后攻击力加成', amount: p('a'), suffix: '%' }),
  },
  modules: {
    // “汉娜的脱臼复位套装”：闪避后下次攻击的攻击力加成提升至 120% — read by line 2
    [TIGER_MODULE]: () => {},
  },
});

// -------------------------------------------------------------- 拉普兰德 ---
// Silences what she hits; every kill of your other 叙拉古 stacks her attack, every elite kill of your other operators grows
// it for the run.

const WHITEW_FRAGILE = 0.08, WHITEW_MODULE = 'uniequip_002_whitew';

const whitew = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'wolf', mods: { atkPct: cardParam(unit, 1, 'b') / 100, maxTargets: 1 }, duration: cardParam(unit, 1, 'a') });
    onOwnHit(battle, unit, 'whitew-arts', ({ dmg }) => { if (dmg.isAttack && dmg.type === 'phys' && sustained(unit, 'wolf')) dmg.type = 'arts'; });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => {
      for (const e of rangeEnemies(battle, unit)) {
        fx.status(e, { status: 'silence', duration: p('a') });
        fx.status(e, { status: 'fragile', value: WHITEW_FRAGILE, duration: p('a') });
      }
    },
    1: 'cast',
    2: { options: { accept: normalAttack }, run: ({ p, fx, target }) => { if (target?.alive) fx.status(target, { status: 'silence', duration: p('a') }); } },
    3: ({ unit, p, fx }) => fx.stack(unit, { key: 'mind-atk', stat: 'atk', amount: p('a') / 100, mode: 'percent' }),
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'wolf-soul', stat: 'atk', percent: p('a') / 100 }),
  },
  modules: {
    // “幼狼的牙齿”：精神摧毁同时使目标受到 8% 脆弱，持续 6/7 秒
    [WHITEW_MODULE]: {
      options: { accept: normalAttack },
      run: ({ unit, fx, target }) => { if (target?.alive) fx.status(target, { status: 'fragile', value: WHITEW_FRAGILE, duration: moduleParam(unit, WHITEW_MODULE, 'a') }); },
    },
  },
});

// ------------------------------------------------------------------ 断崖 ---
// 索敌援助 speeds up him and everyone around him (more for the blockers); every 停顿 / 束缚 of your other operators grows it
// for the battle.

const AYER_TARGETS = 3, AYER_PAUSE = 1, AYER_BLOCKER = 5, AYER_STACK = 1, AYER_COUNTER = 'ayer-support';

const ayer = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = rangeEnemies(battle, unit, AYER_TARGETS);
    for (const e of targets) {
      fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
      if (e.alive) fx.status(e, { status: 'sluggish', duration: AYER_PAUSE });
    }
    return targets.length > 0;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of rangeEnemies(battle, unit, AYER_TARGETS)) fx.status(e, { status: 'sluggish', duration: p('a') }); },
    1: 'cast',
    2: ({ battle, unit, p }) => liveAura(battle, unit, 'support', {
      pick: (x) => x === unit || around8(unit, x),
      mods: (x) => ({ aspd: p('a') + counterValue(battle, unit, AYER_COUNTER) + ((x.blocking ?? []).some((e) => e.alive) ? AYER_BLOCKER : 0) }),
    }),
    3: ({ unit, fx }) => fx.counter(unit, { key: AYER_COUNTER, label: '索敌援助攻击速度', amount: AYER_STACK }),
  },
  modules: {
    // 荒野便携提神剂：周围 8 格内的其他干员阻挡新敌人时，此干员充能 1（每 2 秒最多一次）
    uniequip_002_ayer: { options: { around: 8 }, run: ({ unit, fx }) => fx.charge(unit, 1) },
  },
});

// ---------------------------------------------------------------- 幽灵鲨 ---
// 肉斩骨断: a refreshable undying rage that stuns her when it ends; every kill of your other 深海猎人 grows her HP.

const GHOST_DEPLOY_SECONDS = 5, GHOST_STUN = 4, GHOST_MODULE = 'uniequip_002_ghost';

const ghost = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const seconds = cardParam(unit, 1, 'a');
    fx.sustain(unit, { key: 'cleave', mods: { atkPct: cardParam(unit, 1, 'b') / 100 }, duration: seconds });
    if (once(unit, 'ghost-undying')) battle.on('fatal', (ctx) => { if (ctx.unit === unit && sustained(unit, 'cleave')) ctx.prevented = true; }, { owner: unit });
    // 结束后此干员晕眩 4 秒: after the last recast's time runs out
    const generation = unit.mem.ghostCleave = (unit.mem.ghostCleave ?? 0) + 1;
    battle.after(seconds, () => { if (unit.mem.ghostCleave === generation && active(unit)) fx.status(unit, { status: 'stun', duration: GHOST_STUN }); }, { owner: unit });
    return true;
  },
  lines: {
    0: ({ unit, p, fx }) => fx.buff(unit, { key: 'deploy-atk', mods: { atkPct: p('a') / 100 }, duration: GHOST_DEPLOY_SECONDS }),
    1: 'cast',
    2: ({ unit, p, fx }) => fx.buff(unit, { key: 'resilience', mods: { hpPct: p('a') / 100, hpRegenRatio: p('b') / 100 }, persist: true }),
    3: ({ unit, p, fx }) => fx.growth(unit, { key: 'abyssal-hp', stat: 'maxHp', flat: p('a') }),
  },
  modules: {
    // 幽明烛光：你的其他深海猎人干员造成的伤害 +9/12%
    [GHOST_MODULE]: ({ battle, unit }) => allyAura(battle, unit, { key: 'candle', mods: { dmgDealtMul: 1 + moduleParam(unit, GHOST_MODULE, 'a') / 100 },
      select: (x) => x !== unit && matchesClass(x, { label: '深海猎人' }) }),
  },
});

// ---------------------------------------------------------------- 布洛卡 ---
// 高压电流 turns his attacks into 停顿 arts; the stuns / 停顿 of your other operators grow his drill for the run, the blocks of
// your other 叙拉古 stack his attack.

const BROCA_INTERVAL = 0.5, BROCA_RANGE = 1, BROCA_PAUSE = 1, BROCA_STUN = 3, BROCA_CROWD = 2, BROCA_STACK = 2, BROCA_MODULE = 'uniequip_002_broca';

const broca = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const seconds = cardParam(unit, 1, 'a');
    // [ASSUMED] 攻击间隔增大 / 攻击距离加长 (no number on the card): interval +50%, range +1
    fx.sustain(unit, { key: 'current', mods: { atkPct: cardParam(unit, 1, 'b') / 100, batPct: BROCA_INTERVAL, rangeExtend: BROCA_RANGE }, duration: seconds });
    onOwnHit(battle, unit, 'broca-current', ({ target, dmg }) => {
      if (!dmg.isAttack || !sustained(unit, 'current')) return;
      if (dmg.type === 'phys') dmg.type = 'arts';
      if (target?.alive) battle.applyStatus(target, 'sluggish', { duration: BROCA_PAUSE, source: unit, instanceKey: `broca:${uid(unit)}:pause` });
    });
    const generation = unit.mem.brocaCurrent = (unit.mem.brocaCurrent ?? 0) + 1;
    battle.after(seconds, () => { if (unit.mem.brocaCurrent === generation && active(unit)) fx.status(unit, { status: 'stun', duration: BROCA_STUN }); }, { owner: unit });
    return true;
  },
  lines: {
    0: ({ unit, p, fx }) => {
      for (const e of [...(unit.blocking ?? [])].filter((x) => x.alive && x.blockedBy === unit)) {
        fx.damage(e, { scale: p('a') / 100, type: 'arts' });
        if (e.alive) fx.status(e, { status: 'sluggish', duration: BROCA_PAUSE });
      }
    },
    1: 'cast',
    2: ({ battle, unit, p }) => liveSelf(battle, unit, 'drill', () => {
      if ((unit.blocking ?? []).filter((e) => e.alive).length < BROCA_CROWD) return null;
      const x = moduleParam(unit, BROCA_MODULE, 'a', p('a')) / 100;
      return { atkPct: x, defPct: x };
    }),
    3: ({ unit, p, fx }) => {
      fx.growth(unit, { key: 'drill-atk', stat: 'atk', percent: p('a') / 100 });
      fx.growth(unit, { key: 'drill-def', stat: 'def', percent: p('a') / 100 });
    },
    4: ({ unit, fx }) => fx.stack(unit, { key: 'gang-atk', stat: 'atk', amount: BROCA_STACK / 100, mode: 'percent' }),
  },
  modules: {
    // “兄弟”：钻头强化提升至 17/19% — read by line 2
    [BROCA_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 裁度 ---
// 缝线缠身 binds the crowd around her and bleeds your DP; her 谨慎择客 hurts what she does not block, the new blocks of your
// other operators charge her and the skills of your other 叙拉古 grow it for the battle.

const TALR_DEPLOY_TARGETS = 2, TALR_SKILL_TARGETS = 4, TALR_STACK = 3, TALR_COUNTER = 'talr-choosy', TALR_MODULE = 'uniequip_002_talr';

const talr = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const seconds = cardParam(unit, 1, 'a'), scale = cardParam(unit, 1, 'b') / 100, dpPerSecond = cardParam(unit, 1, 'c') / seconds;
    const targets = aroundEnemies(battle, unit, TALR_SKILL_TARGETS);
    if (!targets.length) return false;
    fx.sustain(unit, { key: 'stitch', mods: {}, flags: { disarm: true }, duration: seconds });
    for (const e of targets) fx.status(e, { status: 'bind', duration: seconds });
    let ticks = 0;
    const timer = battle.every(1, () => {
      ticks++;
      if (!active(unit) || !payDP(battle, unit, dpPerSecond, 'talr-stitch')) { timer.cancel(); return; }
      for (const e of targets) if (e.alive && !e.removed) fx.damage(e, { scale, type: 'phys', isSkill: true });
      if (ticks >= Math.round(seconds)) timer.cancel();
    }, { owner: unit });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of aroundEnemies(battle, unit, TALR_DEPLOY_TARGETS)) fx.status(e, { status: 'bind', duration: p('a') }); },
    1: 'cast',
    2: ({ battle, unit, p }) => onOwnHit(battle, unit, 'talr-choosy', ({ target, dmg }) => {
      if (target?.side !== 'enemy' || target.blockedBy === unit) return;
      dmg.mul *= 1 + (moduleParam(unit, TALR_MODULE, 'a', p('a')) + counterValue(battle, unit, TALR_COUNTER)) / 100;
    }),
    3: ({ unit, fx }) => fx.charge(unit, 1),
    4: ({ unit, fx }) => fx.counter(unit, { key: TALR_COUNTER, label: '谨慎择客', amount: TALR_STACK, suffix: '%' }),
  },
  modules: {
    // “头面人物”：谨慎择客提升至 30/35% — read by line 2
    [TALR_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 崖心 ---
// Hooks enemies in and chills what she hits; the skills of your other 谢拉格 charge her, the freezes of your other operators
// stack her attack.

const SLCHAN_DEPLOY_COLD = 2, SLCHAN_HIT_COLD = 1, SLCHAN_TARGETS = 3, SLCHAN_STACK = 3, SLCHAN_FORCE = 3, SLCHAN_MODULE = 'uniequip_002_slchan';
const farthestFirst = (battle, unit, count) => rangeEnemies(battle, unit).sort((a, b) => hypot(b.x - unit.x, b.y - unit.y) - hypot(a.x - unit.x, a.y - unit.y)).slice(0, count);

const slchan = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = farthestFirst(battle, unit, SLCHAN_TARGETS);
    for (const e of targets) {
      battle.pullToFront(e, unit, SLCHAN_FORCE);
      fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'true', isSkill: true });
      if (e.alive) fx.status(e, { status: 'stun', duration: cardParam(unit, 1, 'b') });
    }
    return targets.length > 0;
  },
  lines: {
    0: ({ battle, unit, fx }) => {
      for (const e of farthestFirst(battle, unit, 1)) { battle.pullToFront(e, unit, SLCHAN_FORCE); if (e.alive) fx.status(e, { status: 'cold', duration: SLCHAN_DEPLOY_COLD }); }
    },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => liveSelf(battle, unit, 'hunter', () => {
        if ((unit.blocking ?? []).some((e) => e.alive)) return null;
        const x = moduleParam(unit, SLCHAN_MODULE, 'a', p('a')) / 100;
        return { atkPct: x, defPct: x };
      }),
      options: { accept: normalAttack },
      run: ({ fx, target }) => { if (target?.alive) fx.status(target, { status: 'cold', duration: SLCHAN_HIT_COLD }); },
    },
    3: ({ unit, p, fx }) => fx.charge(unit, p('a')),
    4: ({ unit, fx }) => fx.stack(unit, { key: 'freeze-atk', stat: 'atk', amount: SLCHAN_STACK / 100, mode: 'percent' }),
  },
  modules: {
    // “凌绝顶”：雪境猎手的攻击力与防御力加成提升至 20/22% — read by line 2
    [SLCHAN_MODULE]: () => {},
  },
});

// ---------------------------------------------------------------- 见行者 ---
// 惊爆射击 blows the whole range back and stuns what it hits on the way; the lifts / 失重 / pushes of your other operators
// charge him, and his shots go through heavy armour.

const FORCER_DEPLOY_FORCE = 2, FORCER_SKILL_FORCE = 3, FORCER_HEAVY = 3, FORCER_MODULE = 'uniequip_002_forcer';

const forcer = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const f = Array.isArray(unit.fwd) ? unit.fwd : [0, 1];
    const targets = rangeEnemies(battle, unit);
    for (const e of targets) {
      const { collision } = battle.assaultPushEnemy(e, unit, FORCER_SKILL_FORCE, { from: unit, dir: { x: f[1], y: f[0] } });
      if (e.alive) fx.status(e, { status: 'stun', duration: cardParam(unit, 1, 'a') });
      const other = collision?.other;
      if (other?.side === 'enemy' && other.alive) fx.status(other, { status: 'stun', duration: cardParam(unit, 1, 'b') });
    }
    return targets.length > 0;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => {
      for (const e of aroundEnemies(battle, unit)) {
        battle.push(e, FORCER_DEPLOY_FORCE, { from: unit });
        if (e.alive) fx.status(e, { status: 'levitate', duration: p('a') });
      }
    },
    1: 'cast',
    2: ({ battle, unit, p }) => onOwnHit(battle, unit, 'forcer-heavy', ({ target, dmg }) => {
      if (target?.side === 'enemy' && (target.s?.massLevel ?? 0) >= FORCER_HEAVY) dmg.defIgnoreFlat = (dmg.defIgnoreFlat ?? 0) + moduleParam(unit, FORCER_MODULE, 'a', p('a'));
    }),
    3: ({ unit, fx }) => fx.charge(unit, 1),
  },
  modules: {
    // 可执行的幻想：技巧射击无视的防御力提升至 280/300 — read by line 2
    [FORCER_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 罗宾 ---
// Traps in her range: the summons of your other operators give her more, the binds of your other operators sharpen them
// for the battle.

const ROBIN_COUNTER = 'robin-trap', ROBIN_STACK = 10, ROBIN_CAMOU = 6, ROBIN_MODULE = 'uniequip_002_robin';
function placeTrap(battle, unit, cause) {
  const traps = unit.mem.robinTraps ??= new Set();
  for (const t of [...traps]) if (!t.alive) traps.delete(t);
  if (traps.size >= cardParam(unit, 2, 'a')) return null;
  const tile = deviceTile(battle, unit);
  if (!tile) return null;
  const fx = effects(battle, unit, { index: 'skill' }, cause);
  const trap = trapDevice(battle, unit, tile, '夹子', (victim) => {
    fx.damage(victim, { scale: cardParam(unit, 1, 'a') / 100 * (1 + counterValue(battle, unit, ROBIN_COUNTER) / 100), type: 'phys', isSkill: true });
    if (victim.alive) fx.status(victim, { status: 'bind', duration: cardParam(unit, 1, 'b') });
  });
  if (trap) traps.add(trap);
  return trap;
}

const robin = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => !!placeTrap(battle, unit, cause),
  lines: {
    0: ({ battle, unit, p, cause }) => { for (let i = 0; i < p('a'); i++) placeTrap(battle, unit, cause); },
    1: 'cast',
    // “夹子”专家：最多拥有 a 个夹子，踩上去的第一个敌人触发 — read by placeTrap
    2: () => {},
    3: ({ battle, unit, cause }) => placeTrap(battle, unit, cause),
    4: ({ unit, fx }) => fx.counter(unit, { key: ROBIN_COUNTER, label: '夹子伤害', amount: ROBIN_STACK, suffix: '%' }),
  },
  modules: {
    // 限量版年历：受到攻击后获得迷彩 6 秒
    [ROBIN_MODULE]: {
      options: { accept: (payload) => payload.source?.side === 'enemy' },
      run: ({ unit, fx }) => fx.status(unit, { status: 'camou', duration: ROBIN_CAMOU }),
    },
  },
});

// ------------------------------------------------------------------ 风丸 ---
// Her 替身 bursts paper on arrival; every summon of your other operators bursts too, and the falls around her grow it.

const KAZEMA_TOKEN = 'token_10022_kazema_shadow', KAZEMA_DROP = 0.1, KAZEMA_STACK = 10, KAZEMA_COUNTER = 'kazema-paper', KAZEMA_MODULE = 'uniequip_002_kazema';
function paperBurst(battle, unit, fx, at, percent) {
  const scale = percent / 100 * (1 + counterValue(battle, unit, KAZEMA_COUNTER) / 100);
  for (const e of battle.enemies.filter((x) => x.alive && !x.removed && !x.hidden && around8(at, x))) fx.damage(e, { scale, type: 'arts' });
}

const kazema = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => !!frontEnemy(battle, unit),
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = frontEnemy(battle, unit);
    if (!target) return false;
    fx.damage(target, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
    fx.loseHp(unit, { maxPct: KAZEMA_DROP });
    return true;
  },
  lines: {
    // [ASSUMED] the 替身 has her max HP and attack (the native shadow copies its owner)
    0: ({ battle, unit }) => {
      const compiled = battle.data?.getToken?.(KAZEMA_TOKEN, unit.def.charId) ?? battle.data?.rawToken?.(KAZEMA_TOKEN);
      if (!compiled) throw new Error(`native token ${KAZEMA_TOKEN} is unavailable`);
      grantSummon(battle, unit, { tokenId: KAZEMA_TOKEN, count: 1, stockCap: 1, fieldCap: 1, cost: 0, replaceExisting: true, anySource: true,
        def: { ...compiled, name: '替身' }, kit: assaultTokenKits[KAZEMA_TOKEN], sourceBody: unit.def.raw.assaultBody,
        stats: { maxHp: unit.s.maxHp, atk: unit.s.atk, def: compiled.stats.def, res: compiled.stats.res } });
    },
    1: 'cast',
    2: ({ battle, unit, p, fx, target }) => { if (target) paperBurst(battle, unit, fx, target, moduleParam(unit, KAZEMA_MODULE, 'a', p('a'))); },
    3: ({ battle, unit, p, fx, target }) => { if (target) paperBurst(battle, unit, fx, target, p('a')); },
    4: {
      options: { accept: (payload, ctx) => around8(ctx.unit, payload.target) },
      run: ({ unit, fx }) => fx.counter(unit, { key: KAZEMA_COUNTER, label: '折纸生花伤害', amount: KAZEMA_STACK, suffix: '%' }),
    },
  },
  modules: {
    // 旧物：折纸生花的伤害提升至 285/290% — read by line 2
    [KAZEMA_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 锡人 ---
// Alchemy fields on the thickest crowd: damage, 凋亡 and healing every second. Bursts and kills of your other operators
// inside them charge her and grow the field's damage.

const TINMAN_DEPLOY_SECONDS = 5, TINMAN_STACK = 2, TINMAN_COUNTER = 'tinman-wither', TINMAN_MODULE = 'uniequip_002_tinman';
const inTinmanField = (battle, unit, x) => !!x && (unit.mem.tinmanFields ?? []).some((f) => battle.time < f.until
  && Math.max(Math.abs(Math.round(x.y) - f.tile[0]), Math.abs(Math.round(x.x) - f.tile[1])) <= 1);
function alchemyField(battle, unit, tile, seconds, cause) {
  const fields = unit.mem.tinmanFields ??= [];
  const field = { tile, until: battle.time + seconds };
  fields.push(field);
  const fx = effects(battle, unit, { index: 'skill' }, cause);
  const within = (x) => Math.max(Math.abs(Math.round(x.y) - tile[0]), Math.abs(Math.round(x.x) - tile[1])) <= 1;
  let ticks = 0;
  const timer = battle.every(1, () => {
    ticks++;
    if (!active(unit) || battle.time > field.until + 1e-9) { timer.cancel(); return; }
    const boost = 1 + (moduleParam(unit, TINMAN_MODULE, 'a', cardParam(unit, 2, 'a')) + counterValue(battle, unit, TINMAN_COUNTER)) / 100;
    for (const e of battle.enemies.filter((x) => x.alive && !x.removed && !x.isFlying && within(x))) {
      fx.damage(e, { scale: cardParam(unit, 1, 'b') / 100 * boost, type: 'arts', isSkill: true });
      if (e.alive) fx.elementDamage(e, { element: 'apoptosis', amount: unit.s.atk * cardParam(unit, 1, 'c') / 100 * boost });
    }
    for (const x of yourOps(battle, unit, within)) fx.heal(x, { scale: cardParam(unit, 1, 'd') / 100 });
    if (ticks >= Math.round(seconds)) timer.cancel();
  }, { owner: unit });
  return field;
}

const tinman = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => !!crowdTile(battle, unit),
  cast: ({ battle, unit, cause }) => {
    const tile = crowdTile(battle, unit);
    return !!(tile && alchemyField(battle, unit, tile, cardParam(unit, 1, 'a'), cause));
  },
  lines: {
    0: ({ battle, unit, cause }) => { const tile = crowdTile(battle, unit); if (tile) alchemyField(battle, unit, tile, TINMAN_DEPLOY_SECONDS, cause); },
    1: 'cast',
    // 凋敝魂灵：炼金单元范围内地面敌人受到的持续伤害 +a% — read by every field tick
    2: () => {},
    3: { options: { accept: (payload, ctx) => inTinmanField(ctx.battle, ctx.unit, payload.target) }, run: ({ unit, fx }) => fx.charge(unit, 2) },
    4: {
      options: { accept: (payload, ctx) => inTinmanField(ctx.battle, ctx.unit, payload.target) },
      run: ({ unit, fx }) => fx.counter(unit, { key: TINMAN_COUNTER, label: '凋敝魂灵', amount: TINMAN_STACK, suffix: '%' }),
    },
  },
  modules: {
    // “颅相学”：凋敝魂灵提升至 25/27% — read by the field ticks
    [TINMAN_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 蒂比 ---
// 紧急赶场通知 answers the first hit at full SP: she dodges it and takes off. Off the ground she blocks flyers; the air blocks
// of your other operators charge her, every dodge in the air stacks her attack.

const TIPPI_SKILL_ATK = 0.5, TIPPI_RANGE = 1, TIPPI_BURST = 3, TIPPI_STACK = 4;
const liftoff = (fx, unit, seconds, mods = {}) => fx.buff(unit, { key: 'liftoff', mods, flags: { liftoff: true }, duration: seconds });
const airborne = (unit) => !!unit.s?.flags?.liftoff;
function dodgeHit(battle, unit, source, dmg) {
  dmg.cancel = true;
  if (battle._hooks.dodge) battle.emit('dodge', { source, target: unit, dmg });
}

const tippi = (bb, raw, def) => synergyKit(def, {
  // the skill fires only on a hit at full SP (the hit hook below), never by itself
  canCast: ({ unit }) => unit.mem.tippiOnCall === true,
  cast: ({ battle, unit, cause }) => {
    // [ASSUMED] 攻击变为 3 连射: three times the attack's damage (攻击倍率 ×3)
    liftoff(effects(battle, unit, { index: 'skill' }, cause), unit, cardParam(unit, 1, 'a'),
      { rangeExtend: TIPPI_RANGE, atkPct: TIPPI_SKILL_ATK, atkScaleMul: TIPPI_BURST });
    return true;
  },
  lines: {
    0: ({ unit, p, fx }) => liftoff(fx, unit, p('a')),
    1: 'cast',
    2: 'cast',
    // 片场工作指南：a 秒内未受攻击时，闪避下一次物理或法术攻击 — the hit hook below
    3: () => {},
    4: ({ unit, fx }) => fx.charge(unit, 2),
    5: {
      options: { accept: (payload, ctx) => airborne(ctx.unit) },
      run: ({ unit, fx }) => fx.stack(unit, { key: 'airborne-atk', stat: 'atk', amount: TIPPI_STACK / 100, mode: 'percent' }),
    },
  },
  install: (battle, unit) => {
    unit.mem.tippiQuietSince = 0;
    battle.on('hit', ({ source, target, dmg }) => {
      if (target !== unit || !active(unit) || source?.side !== 'enemy' || !dmg || !['phys', 'arts'].includes(dmg.type) || dmg.cancel) return;
      const quiet = battle.time - (unit.mem.tippiQuietSince ?? 0) + 1e-9 >= cardParam(unit, 3, 'a');
      unit.mem.tippiQuietSince = battle.time;
      if (unit.skill?.ready) {
        unit.mem.tippiOnCall = true;
        const cast = battle.assaultRuntime.cast(unit, {});
        unit.mem.tippiOnCall = false;
        if (cast) { dodgeHit(battle, unit, source, dmg); return; }
      }
      if (quiet) dodgeHit(battle, unit, source, dmg);
    }, { owner: unit, priority: 80 });
  },
});

// ------------------------------------------------------------ 缄默德克萨斯 ---
// A deploy-cast passive: 剑雨滂沱 at every deployment, and once more each deployment when your other operators score a kill
// (full HP again). Before her first kill of a deployment she is fast and hard to hurt; every other operator's 再部署 grows
// the rain for the battle.

const TEXAS2_HITS = 2, TEXAS2_STUN = 2, TEXAS2_RAIN_TARGETS = 4, TEXAS2_RAIN_STUN = 0.2, TEXAS2_STACK = 5, TEXAS2_COUNTER = 'texas2-rain', TEXAS2_MODULE = 'uniequip_003_texas2';
const deploymentOf = (unit) => `${unit.deploySeq}:${unit.assaultCycle?.count ?? 0}`;
function swordRain(battle, unit, cause) {
  const fx = effects(battle, unit, { index: 'skill' }, cause);
  const resolution = unit.def.raw.assaultBody?.bazaar?.skillResolution;
  if (resolution) return resolveSkill({ battle, unit, cause }, resolution, fx);
  const more = () => 1 + counterValue(battle, unit, TEXAS2_COUNTER) / 100;
  for (const e of aroundEnemies(battle, unit)) {
    fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100 * more(), type: 'arts', isSkill: true, hits: TEXAS2_HITS });
    if (e.alive) fx.status(e, { status: 'stun', duration: TEXAS2_STUN });
  }
  const seconds = cardParam(unit, 1, 'b');
  fx.sustain(unit, { key: 'rain', mods: { atkPct: cardParam(unit, 2, 'a') / 100 }, duration: seconds });
  let ticks = 0;
  const timer = battle.every(1, () => {
    ticks++;
    if (!active(unit)) { timer.cancel(); return; }
    for (const e of rangeEnemies(battle, unit, TEXAS2_RAIN_TARGETS)) {
      fx.damage(e, { scale: cardParam(unit, 1, 'c') / 100 * more(), type: 'arts', isSkill: true });
      if (e.alive) fx.status(e, { status: 'stun', duration: TEXAS2_RAIN_STUN });
    }
    if (ticks >= Math.round(seconds)) timer.cancel();
  }, { owner: unit });
  return true;
}

const texas2 = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => swordRain(battle, unit, cause),
  lines: {
    0: 'cast',
    1: 'cast',
    // 本次部署内首次: once per deployment (an in-place 再部署 opens a new one)
    2: ({ battle, unit, cause }) => {
      if (unit.mem.texas2Again === deploymentOf(unit)) return;
      unit.mem.texas2Again = deploymentOf(unit);
      unit.hp = unit.s.maxHp;
      swordRain(battle, unit, cause);
    },
    3: ({ battle, unit, p }) => {
      if (once(unit, 'texas2-first-kill')) battle.assaultRuntime.observe('kill', `texas2-first-kill:${uid(unit)}`, (event) => {
        if (event.payload?.source === unit) unit.mem.texas2Killed = deploymentOf(unit);
      }, { owner: unit });
      liveSelf(battle, unit, 'swordplay', () => (unit.mem.texas2Killed === deploymentOf(unit) ? null : { aspd: p('a'), dmgTakenMul: 1 - p('b') / 100 }));
    },
    4: ({ unit, fx }) => fx.counter(unit, { key: TEXAS2_COUNTER, label: '剑雨滂沱伤害', amount: TEXAS2_STACK, suffix: '%' }),
  },
  modules: {
    // “新车和新生活”：此干员每次部署后首次击倒敌人时，你的其他干员当前再部署时间 -2 秒
    [TEXAS2_MODULE]: ({ unit, fx }) => {
      if (unit.mem.texas2ModuleKill === deploymentOf(unit)) return;
      unit.mem.texas2ModuleKill = deploymentOf(unit);
      fx.cutRedeploy({ seconds: moduleParam(unit, TEXAS2_MODULE, 'a'), includeSelf: false });
    },
  },
});

const enemyTag = (e, tag) => !!e && e.side === 'enemy' && Array.isArray(e.def?.tags) && e.def.tags.includes(tag);

// ------------------------------------------------------------ 琳琅诗怀雅 ---
// A deploy-cast passive: her coins become 香槟炸弹 in her range at every deployment. The DP your other operators spend
// grows her attack for the run, the DP they bring in buys her coins; a fatal hit is paid off in DP (doubling each time).

const SWIRE2_COIN_CAP = 5, SWIRE2_PAUSE = 2, SWIRE2_SECOND_BLAST = 3, SWIRE2_SAVE_COST = 5, SWIRE2_MODULE = 'uniequip_004_swire2', SWIRE2_MODULE_CUT = 2;
const playerOf = (battle, unit) => battle._pp?.(unit.ownerId) ?? null;
const coinsOf = (battle, unit) => playerOf(battle, unit)?.coins ?? 0;
function gainCoins(battle, unit, n) {
  const player = playerOf(battle, unit);
  if (player) player.coins = Math.min(SWIRE2_COIN_CAP, (player.coins ?? 0) + n);
}
function champagne(battle, unit, cause) {
  const fx = effects(battle, unit, { index: 'skill' }, cause);
  const player = playerOf(battle, unit);
  let placed = 0;
  while (player && player.coins >= 1) {
    const tile = deviceTile(battle, unit);
    if (!tile) break;
    const scale = cardParam(unit, 1, 'a') / 100;
    const bomb = trapDevice(battle, unit, tile, '香槟炸弹', (victim) => {
      fx.damage(victim, { scale, type: 'phys', isSkill: true });
      if (victim.alive) fx.status(victim, { status: 'sluggish', duration: SWIRE2_PAUSE });
    });
    if (!bomb) break;
    player.coins -= 1;
    placed++;
    // 炸弹在场 3 秒后再炸一次: the enemies on and around its tile, whether it was set off or not
    battle.after(SWIRE2_SECOND_BLAST, () => {
      for (const e of battle.enemies.filter((x) => x.alive && !x.removed && Math.max(Math.abs(Math.round(x.y) - tile[0]), Math.abs(Math.round(x.x) - tile[1])) <= 1))
        fx.damage(e, { scale, type: 'phys', isSkill: true });
      if (bomb.alive) battle.retreat(bomb, { reason: 'expired', permanent: true });
    }, { owner: unit });
    battle.assaultRuntime.publish('coinSpent', { source: unit, sourceUid: uid(unit), target: unit, targetUid: uid(unit), amount: 1 }, { cause });
  }
  return placed > 0;
}

const swire2 = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => champagne(battle, unit, cause),
  lines: {
    // the coins first (this line runs before the deploy-time cast), then 见面礼 spends them
    0: ({ battle, unit, p }) => gainCoins(battle, unit, p('a')),
    1: 'cast',
    2: ({ unit, p, fx, payload }) => fx.growth(unit, { key: 'big-buyer', stat: 'atk', percent: p('a') / 100 * (Number(payload?.amount) || 0) }),
    3: ({ battle, unit }) => gainCoins(battle, unit, 1),
    4: {
      // 破财消灾: the fatal hit itself (before the damage is taken); its cost doubles with every use
      install: ({ battle, unit, p }) => battle.on('fatal', (ctx) => {
        if (ctx.unit !== unit || ctx.prevented || !active(unit)) return;
        const cost = unit.mem.swire2SaveCost ?? SWIRE2_SAVE_COST;
        const player = battle.getPlayer(unit.ownerId);
        if (!player || player.dp + 1e-9 < cost) return;
        battle.addDp(unit.ownerId, -cost, 'assault');
        unit.mem.swire2SaveCost = cost * 2;
        ctx.prevented = true;
        battle.after(0, () => { if (unit.alive) unit.hp = Math.max(unit.hp, unit.s.maxHp * p('a') / 100); }, { owner: unit });
      }, { owner: unit, priority: 50 }),
      run: () => {},
    },
  },
  modules: {
    // 琳琅诗怀雅特限证章：此干员每消耗 1 枚金币，你的其他干员中当前再部署时间剩余最短的一名 -2 秒
    [SWIRE2_MODULE]: ({ battle, unit, fx, payload }) => {
      for (let i = 0; i < (Number(payload?.amount) || 1); i++) {
        const next = fx.allies('otherAllies').filter((x) => x.assaultCycle).sort((a, b) => (a.assaultCycle.at - b.assaultCycle.at) || uid(a).localeCompare(uid(b)))[0];
        if (next) next.assaultCycle.at = battle.time + Math.max(0, next.assaultCycle.at - battle.time - SWIRE2_MODULE_CUT);
      }
    },
  },
});

// ------------------------------------------------------------ 新约能天使 ---
// 使命必达！ shells her delivery point and drops your other operators whose 再部署 is furthest off right back in, charged;
// every round your other operators fire heals her and may call a bombardment, and grows it for the battle.

const ANGEL2_SPLASH = 250, ANGEL2_SPLASH_RADIUS = 1, ANGEL2_RELOAD = 2, ANGEL2_SKILL_ATK = 0.3, ANGEL2_HITS = 5, ANGEL2_HEAL = 0.06,
  ANGEL2_STACK = 2, ANGEL2_COUNTER = 'angel2-bombard', ANGEL2_MODULE = 'uniequip_002_angel2';
const aroundTile = (battle, [r, c], radius = 1) => battle.enemies.filter((e) => e.alive && !e.removed && !e.hidden
  && Math.max(Math.abs(Math.round(e.y) - r), Math.abs(Math.round(e.x) - c)) <= radius);
const deliveryPoint = (battle, unit) => unit.mem.angel2Point ?? crowdTile(battle, unit) ?? [unit.tileR, unit.tileC];
const waitLeft = (battle, x) => (x.alive && x.deployed && x.assaultCycle ? x.assaultCycle.at - battle.time : Number.isFinite(x.respawnAt) ? x.respawnAt - battle.time : -Infinity);

const angel2 = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const point = deliveryPoint(battle, unit);
    for (const e of aroundTile(battle, point, ANGEL2_SPLASH_RADIUS)) fx.damage(e, { scale: ANGEL2_SPLASH / 100, type: 'phys', isSkill: true });
    // 立即再部署: the operators furthest from their next 再部署 (on the field: in place; knocked out: the native comeback)
    // [ASSUMED] 「到该处」 is not a move: they come back on their own tiles
    const ground = battle.allyUnits.filter((x) => x.kind === 'op' && !x.removed && x !== unit && relates(unit, x, 'other') && isMelee(x) && waitLeft(battle, x) > 0)
      .sort((a, b) => waitLeft(battle, b) - waitLeft(battle, a) || uid(a).localeCompare(uid(b))).slice(0, cardParam(unit, 1, 'a'));
    for (const x of ground) {
      if (active(x)) fx.redeployNow(x);
      else battle.skillRedeploy(x, { cause });
      if (active(x)) fx.charge(x, cardParam(unit, 1, 'b'));
    }
    const target = rangeEnemies(battle, unit, 1)[0];
    if (target) fx.damage(target, { scale: (1 + ANGEL2_SKILL_ATK) * cardParam(unit, 2, 'b') / 100,
      hits: ANGEL2_HITS, type: 'phys', isSkill: true });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => {
      unit.mem.angel2Point = crowdTile(battle, unit) ?? rangeTiles(battle, unit)[0] ?? [unit.tileR, unit.tileC];
      for (const x of fx.allies('otherAllies')) if ((unit.rangeKeys ?? []).includes(x.tileR * COLS + x.tileC)) fx.reload(x, ANGEL2_RELOAD);
    },
    1: 'cast',
    2: 'cast',
    3: ({ battle, unit, p, fx, actor }) => {
      fx.heal(unit, { maxHpRatio: ANGEL2_HEAL });
      if (battle.rng() >= moduleParam(unit, ANGEL2_MODULE, 'a', p('a')) / 100 || !actor) return;
      const scale = moduleParam(unit, ANGEL2_MODULE, 'b', p('b')) / 100 * (1 + counterValue(battle, unit, ANGEL2_COUNTER) / 100);
      const target = enemies(battle, actor, { scope: 'range', count: 1 })[0];
      if (target) for (const e of aroundTile(battle, [Math.round(target.y), Math.round(target.x)], 1)) fx.damage(e, { scale, type: 'phys' });
    },
    4: ({ battle, unit, p }) => liveAura(battle, unit, 'covenant', {
      pick: (x) => x !== unit && !!assaultAmmoState(x),
      mods: (x) => ({ atkPct: p('a') / 100 * (matchesClass(x, { label: '拉特兰' }) ? 2 : 1) }),
    }),
    5: ({ unit, fx, payload }) => fx.counter(unit, { key: ANGEL2_COUNTER, label: '轰炸伤害', amount: ANGEL2_STACK * (Number(payload?.amount) || 1), suffix: '%' }),
  },
  modules: {
    // 新朋友圣城生活套组：火力电台的轰炸几率提升至 35%，伤害提升至 185/200% — read by line 3
    [ANGEL2_MODULE]: () => {},
  },
});

// -------------------------------------------------------------- 歌蕾蒂娅 ---
// Drags the far ones in; her tide keeps your other 深海猎人 healing and shielded from sea monsters and grows with their
// skills, every elite they fell sharpens her hunger for the run.

const GLADY_LIFTED = 150, GLADY_LIGHT = 3, GLADY_FORCE = 3, GLADY_STACK = 0.5, GLADY_TIDE = 'glady-tide', GLADY_PREY = 'glady-prey', GLADY_MODULE = 'uniequip_002_glady';
const gladyTargets = (battle, unit, count) => farthestFirst(battle, unit, count);

const glady = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = frontEnemy(battle, unit);
    if (!target) return false;
    battle.pullToFront(target, unit, GLADY_FORCE);
    fx.damage(target, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
    return true;
  },
  lines: {
    0: ({ battle, unit }) => { for (const e of gladyTargets(battle, unit, 2)) battle.pullToFront(e, unit, GLADY_FORCE); },
    1: 'cast',
    2: ({ battle, unit, p }) => {
      liveAura(battle, unit, 'tide', {
        pick: (x) => x !== unit && matchesClass(x, { label: '深海猎人' }),
        mods: () => ({ hpRegenRatio: (moduleParam(unit, GLADY_MODULE, 'a', p('a')) + counterValue(battle, unit, GLADY_TIDE)) / 100 }),
      });
      if (once(unit, 'glady-tide-guard')) battle.on('hit', ({ source, target, dmg }) => {
        if (!active(unit) || !dmg || target?.side !== 'ally' || target === unit || !matchesClass(target, { label: '深海猎人' }) || !relates(unit, target, 'other')) return;
        const module = moduleOf(unit) === GLADY_MODULE;
        if (!module && !enemyTag(source, 'seamonster')) return;
        dmg.mul *= 1 - moduleParam(unit, GLADY_MODULE, 'b', p('b')) / 100;
      }, { owner: unit, priority: 60 });
    },
    3: ({ battle, unit, p }) => onOwnHit(battle, unit, 'glady-hunger', ({ target, dmg }) => {
      if (target?.side !== 'enemy') return;
      const prey = runCounterValue(battle, unit, GLADY_PREY);
      if (hasStatus(target, 'levitate') || hasStatus(target, 'weightless')) dmg.mul *= (GLADY_LIFTED + prey) / 100;
      else if ((target.s?.massLevel ?? 0) <= GLADY_LIGHT) dmg.mul *= (p('a') + prey) / 100;
    }),
    4: ({ unit, fx }) => fx.counter(unit, { key: GLADY_TIDE, label: '阿戈尔的波涛每秒回复', amount: GLADY_STACK, suffix: '%' }),
    5: ({ unit, p, fx }) => fx.growthCounter(unit, { key: GLADY_PREY, label: '弱肉强食攻击力', amount: p('a'), suffix: '%' }),
  },
  modules: {
    // 执政官手镜：阿戈尔的波涛改为每秒回复 3.5% 最大生命，并且受到所有敌人的伤害 -30% — read by line 2
    [GLADY_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 水月 ---
// 创伤性癔症 strikes the weakest of her targets and puts it to sleep; your other operators' binds and stuns call it on their
// target, the falls around her heal her and stack her attack.

const MIZUKI_SKILL_SECONDS = 30, MIZUKI_SKILL_TARGETS = 2, MIZUKI_SKILL_STUN = 1, MIZUKI_SLEEP = 1, MIZUKI_FEW = 3, MIZUKI_DROP = 0.12,
  MIZUKI_HEAL = 0.1, MIZUKI_STACK = 2, MIZUKI_MODULE = 'uniequip_002_mizuki';
function hysteria(battle, unit, fx, candidates) {
  const live = candidates.filter((e) => e?.alive && !e.removed).sort((a, b) => a.hp - b.hp || uid(a).localeCompare(uid(b)));
  const skill = sustained(unit, 'mirror');
  const count = (moduleOf(unit) === MIZUKI_MODULE ? 2 : 1) + (skill ? MIZUKI_SKILL_TARGETS : 0);
  const percent = moduleParam(unit, MIZUKI_MODULE, 'a', cardParam(unit, 2, 'a'));
  for (const e of live.slice(0, count)) {
    fx.damage(e, { scale: percent / 100, type: 'arts' });
    if (!e.alive) continue;
    fx.status(e, { status: 'sleep', duration: MIZUKI_SLEEP });
    if (skill) fx.status(e, { status: 'stun', duration: MIZUKI_SKILL_STUN });
  }
}

const mizuki = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'mirror', mods: { atkPct: cardParam(unit, 1, 'a') / 100, rangeExtend: 1 }, duration: MIZUKI_SKILL_SECONDS });
    // 每次攻击命中少于 3 名敌人时，此干员流失 12% 最大生命
    if (once(unit, 'mizuki-few')) battle.on('attack', ({ attacker, targets }) => {
      if (attacker !== unit || !sustained(unit, 'mirror') || (targets ?? []).length >= MIZUKI_FEW) return;
      effects(battle, unit, { index: 'skill' }).loseHp(unit, { maxPct: MIZUKI_DROP });
    }, { owner: unit });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => {
      for (const e of rangeEnemies(battle, unit).sort((a, b) => a.hp - b.hp || uid(a).localeCompare(uid(b))).slice(0, 2)) fx.status(e, { status: 'sleep', duration: p('a') });
    },
    1: 'cast',
    2: {
      // the attack's targets (the native attack hook): 癔症 picks the weakest of them
      install: ({ battle, unit }) => battle.on('attack', ({ attacker, targets, attackId }) => {
        if (attacker === unit) unit.mem.mizukiTargets = { attackId, targets: [...(targets ?? [])] };
      }, { owner: unit }),
      // one attack, one 癔症 (an attack on several targets hits each: the first hit of the attack runs it)
      options: { accept: (payload, ctx) => normalAttack(payload) && ctx.unit.mem.mizukiAttack !== payload.attackId },
      run: ({ battle, unit, fx, payload }) => {
        unit.mem.mizukiAttack = payload.attackId;
        const seen = unit.mem.mizukiTargets;
        hysteria(battle, unit, fx, seen?.attackId === payload.attackId ? seen.targets : [payload.target]);
      },
    },
    3: ({ battle, unit, fx, target }) => hysteria(battle, unit, fx, [target]),
    4: {
      options: { accept: (payload, ctx) => around8(ctx.unit, payload.target) },
      run: ({ unit, fx }) => {
        fx.heal(unit, { maxHpRatio: MIZUKI_HEAL });
        fx.stack(unit, { key: 'seed-atk', stat: 'atk', amount: MIZUKI_STACK / 100, mode: 'percent' });
      },
    },
  },
  modules: {
    // 使者之约：创伤性癔症改为对生命最少的 2 名敌人各造成 60% 攻击力的法术伤害 — read by hysteria
    [MIZUKI_MODULE]: () => {},
  },
});

// ------------------------------------------------------------ 归溟幽灵鲨 ---
// 生存的重压 hits everything he blocks; at zero HP his 替身 takes over (and covers your other operators' fatal hits once a
// battle); his aura grows your other 深海猎人, their kills feed the skill.

const GHOST2_SLOW = 0.4, GHOST2_DEPLOY_SLOW = 5, GHOST2_INTERVAL = 0.5, GHOST2_EXTRA = 70, GHOST2_DRAIN = 0.03, GHOST2_DOLL_BURN = 40,
  GHOST2_GUARD = 8, GHOST2_STACK = 3, GHOST2_COUNTER = 'ghost2-weight', GHOST2_MODULE = 'uniequip_003_ghost2';
const inDoll = (unit) => (unit.buffs ?? []).some((b) => String(b.key).endsWith(':doll'));
function becomeDoll(battle, unit, cause) {
  if (inDoll(unit)) return;
  // [ASSUMED] the 替身 holds his tile until his next 再部署 (HP full again): it is not hit and does not attack
  effects(battle, unit, { index: 2 }, cause).buff(unit, { key: 'doll', mods: {}, flags: { invulnerable: true, disarm: true }, duration: Infinity });
  unit.mem.ghost2Doll = deploymentOf(unit);
}

const ghost2 = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => !inDoll(unit) && rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const atk = cardParam(unit, 1, 'b') + counterValue(battle, unit, GHOST2_COUNTER);
    // [ASSUMED] 攻击间隔延长 (no number): +50%; 攻击所有阻挡的敌人: as many targets as he blocks
    fx.sustain(unit, { key: 'weight', mods: { atkPct: atk / 100, hpPct: cardParam(unit, 1, 'c') / 100, batPct: GHOST2_INTERVAL, maxTargets: Math.max(0, (unit.s.blockCnt ?? 1) - 1) }, duration: cardParam(unit, 1, 'a') });
    if (once(unit, 'ghost2-weight')) battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !dmg?.isAttack || !sustained(unit, 'weight') || target?.side !== 'enemy') return;
      if (target.hp / target.s.maxHp + 1e-9 >= unit.hp / unit.s.maxHp) {
        const e = target;
        battle.assaultRuntime.enqueue(() => { if (e.alive) effects(battle, unit, { index: 'skill' }).damage(e, { scale: GHOST2_EXTRA / 100, type: 'phys', isSkill: true }); },
          { key: `ghost2-extra:${uid(unit)}:${uid(e)}:${dmg.attackId}`, targetUid: uid(e) });
      } else effects(battle, unit, { index: 'skill' }).loseHp(unit, { currentPct: GHOST2_DRAIN });
    }, { owner: unit, priority: 40 });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const e of aroundEnemies(battle, unit)) fx.buff(e, { key: 'deploy-slow', mods: { moveMul: 1 - GHOST2_SLOW }, duration: GHOST2_DEPLOY_SLOW }); },
    1: 'cast',
    2: {
      install: ({ battle, unit }) => {
        battle.on('fatal', (ctx) => {
          if (ctx.unit !== unit || ctx.prevented || !active(unit)) return;
          ctx.prevented = true;
          becomeDoll(battle, unit, battle.assaultRuntime.currentCause);
        }, { owner: unit, priority: 40 });
        // the 替身: enemies around it slowed, and 40% of his attack as arts damage every second
        battle.every(1, () => {
          if (!active(unit) || !inDoll(unit)) return;
          const fx = effects(battle, unit, { index: 2 });
          for (const e of aroundEnemies(battle, unit)) {
            fx.buff(e, { key: 'doll-slow', mods: { moveMul: 1 - GHOST2_SLOW }, duration: 1.2 });
            fx.damage(e, { scale: GHOST2_DOLL_BURN / 100, type: 'arts' });
          }
        }, { owner: unit });
        // his next 再部署 ends it
        battle.assaultRuntime.observe('deployed', `ghost2-doll-end:${uid(unit)}`, (event) => {
          if (event.payload?.target === unit && inDoll(unit) && unit.mem.ghost2Doll !== deploymentOf(unit)) battle.removeBuff(unit, unit.buffs.find((b) => String(b.key).endsWith(':doll')));
        }, { owner: unit });
      },
      run: () => {},
    },
    3: {
      options: { around: 8 },
      install: ({ battle, unit, p }) => {
        allyAura(battle, unit, { key: 'abyss', mods: { hpPct: p('a') / 100 }, select: (x) => x !== unit && matchesClass(x, { label: '深海猎人' }) });
        battle.on('fatal', (ctx) => {
          const x = ctx.unit;
          if (ctx.prevented || !active(unit) || x === unit || x?.kind !== 'op' || !relates(unit, x, 'other') || !around8(unit, x) || unit.mem.ghost2Guarded) return;
          unit.mem.ghost2Guarded = true;
          ctx.prevented = true;
          effects(battle, unit, { index: 3 }).buff(x, { key: 'abyss-guard', mods: {}, duration: GHOST2_GUARD });
          if (once(unit, 'ghost2-guard-hook')) battle.on('fatal', (c) => { if (c.unit?.buffs?.some((b) => String(b.key).includes('abyss-guard'))) c.prevented = true; }, { owner: unit, priority: 30 });
          becomeDoll(battle, unit, battle.assaultRuntime.currentCause);
        }, { owner: unit, priority: 35 });
      },
      run: () => {},
    },
    4: ({ unit, fx }) => fx.counter(unit, { key: GHOST2_COUNTER, label: '生存的重压攻击力', amount: GHOST2_STACK, suffix: '%' }),
  },
  modules: {
    // 未竟之美：你的其他深海猎人干员技力自然回复速度 +0.5/秒
    [GHOST2_MODULE]: ({ battle, unit }) => allyAura(battle, unit, { key: 'unfinished', mods: { spRecoveryFlat: moduleParam(unit, GHOST2_MODULE, 'a') },
      select: (x) => x !== unit && matchesClass(x, { label: '深海猎人' }) }),
  },
});

// ---------------------------------------------------------------- 多萝西 ---
// 共振装置 in her range: a trigger stuns everything around it and sets off the other devices nearby. Your other operators'
// summons grow her attack for the run; each of her triggers charges your other operators.

const DOROTH_CHAIN_DELAY = 0.5, DOROTH_RADIUS = 1, DOROTH_MODULE = 'uniequip_003_doroth', DOROTH_MODULE_EXTRA = 0.5;
function resonance(battle, unit, cause) {
  const devices = unit.mem.dorothDevices ??= new Set();
  for (const d of [...devices]) if (!d.alive) devices.delete(d);
  if (devices.size >= cardParam(unit, 2, 'a')) return null;
  const tile = deviceTile(battle, unit);
  if (!tile) return null;
  const fx = effects(battle, unit, { index: 'skill' }, cause);
  const blast = (at) => {
    for (const e of aroundTile(battle, at, DOROTH_RADIUS)) {
      fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
      if (e.alive) fx.status(e, { status: 'sluggish', duration: cardParam(unit, 1, 'b') });
    }
  };
  const device = trapDevice(battle, unit, tile, '共振装置', () => {
    blast(tile);
    // 延迟触发范围内的其他共振装置
    for (const other of [...devices]) if (other.alive && other !== device && Math.max(Math.abs(other.tileR - tile[0]), Math.abs(other.tileC - tile[1])) <= DOROTH_RADIUS) {
      devices.delete(other);
      battle.after(DOROTH_CHAIN_DELAY, () => {
        if (!other.alive) return;
        blast([other.tileR, other.tileC]);
        if (battle._hooks.deviceTrigger) battle.emit('deviceTrigger', { source: unit, sourceUid: uid(unit), target: null, targetUid: null, device: other });
        battle.retreat(other, { reason: 'expired', permanent: true });
      }, { owner: unit });
    }
  });
  if (device) devices.add(device);
  return device;
}
const placeResonance = (battle, unit, cause) => {
  const device = resonance(battle, unit, cause);
  // 梦中人：部署共振装置时有 50% 几率额外召唤 1 个
  if (device && moduleOf(unit) === DOROTH_MODULE && battle.rng() < DOROTH_MODULE_EXTRA) resonance(battle, unit, cause);
  return device;
};

const doroth = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => !!placeResonance(battle, unit, cause),
  lines: {
    0: ({ battle, unit, p, cause }) => { for (let i = 0; i < p('a'); i++) placeResonance(battle, unit, cause); },
    1: 'cast',
    // 共振装置：最多拥有 a 个，踩上去的第一个敌人触发 — read by resonance
    2: () => {},
    3: ({ unit, p, fx }) => fx.growth(unit, { key: 'dreamer', stat: 'atk', percent: p('a') / 100 }),
    4: ({ fx }) => { for (const x of fx.allies('otherAllies')) fx.charge(x, 1); },
  },
  modules: {
    // 梦中人：共振装置触发时，范围内的敌人沉睡 3 秒
    [DOROTH_MODULE]: ({ battle, unit, fx, payload }) => {
      const device = payload?.device;
      if (!device) return;
      for (const e of aroundTile(battle, [device.tileR, device.tileC], DOROTH_RADIUS)) fx.status(e, { status: 'sleep', duration: moduleParam(unit, DOROTH_MODULE, 'a') });
    },
  },
});

// -------------------------------------------------------------- 引星棘刺 ---
// Alchemy flasks on your least-blocking operators weaken everything around them and keep getting worse; 视界 speeds your
// other operators up and slows the enemies, every kill inside the flasks grows it, and your other operators' bursts
// charge him.

const THORN2_DEPLOY_SECONDS = 6, THORN2_DEPLOY_DOWN = 0.2, THORN2_SKILL_TARGETS = 4, THORN2_STACK = 1, THORN2_STRAIGHT = 6,
  THORN2_COUNTER = 'thorn2-horizon', THORN2_MODULE = 'uniequip_002_thorn2';
// 逐渐提升: from the first numbers to the last over the field's time
const THORN2_FROM = { atk: 0.15, def: 0.35, res: 0.35 }, THORN2_TO = { atk: 0.3, def: 0.5, res: 0.5 };
const leastBlocking = (battle, unit, count, includeSelf) => battle.assaultDeploymentOrder().filter((x) => x.kind === 'op' && active(x)
  && (includeSelf ? relates(unit, x, 'yours') : relates(unit, x, 'other'))).sort((a, b) => (a.s.blockCnt ?? 0) - (b.s.blockCnt ?? 0) || uid(a).localeCompare(uid(b))).slice(0, count);
const inThorn2Field = (battle, unit, x) => !!x && (unit.mem.thorn2Fields ?? []).some((f) => battle.time < f.until && around8(f.host, x));
const fieldExtra = (battle, unit) => {
  const someone = yourOps(battle, unit, (x) => x !== unit && (unit.rangeKeys ?? []).includes(x.tileR * COLS + x.tileC)).length > 0;
  return someone ? moduleParam(unit, THORN2_MODULE, 'b', cardParam(unit, 2, 'b')) : 0;
};
function thornField(battle, unit, host, seconds, tick, cause) {
  const field = { host, until: battle.time + seconds, start: battle.time, seconds };
  (unit.mem.thorn2Fields ??= []).push(field);
  const timer = battle.every(1, () => {
    if (battle.time > field.until + 1e-9 || !active(unit)) { timer.cancel(); return; }
    for (const e of battle.enemies.filter((x) => x.alive && !x.removed && around8(host, x))) tick(e, Math.min(1, (battle.time - field.start) / field.seconds));
  }, { owner: unit, immediate: true });
  return field;
}
/** 连续 6 格以上直线道路: the unit's tile is on a run of at least 6 ground-path tiles in its row or column. */
function onLongRoad(battle, x) {
  const r = Math.round(x.y), c = Math.round(x.x), g = battle.grid;
  if (!g.inRect(r, c) || !g.groundPassable(r, c)) return false;
  const run = (dr, dc) => { let n = 0; for (let i = 1; g.inRect(r + dr * i, c + dc * i) && g.groundPassable(r + dr * i, c + dc * i); i++) n++; return n; };
  return 1 + run(0, 1) + run(0, -1) >= THORN2_STRAIGHT || 1 + run(1, 0) + run(-1, 0) >= THORN2_STRAIGHT;
}

const thorn2 = (bb, raw, def) => synergyKit(def, {
  // an enemy next to one of the operators the flasks land on, or in her own range
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0
    || leastBlocking(battle, unit, THORN2_SKILL_TARGETS, true).some((host) => battle.enemies.some((e) => e.alive && !e.removed && !e.hidden && around8(host, e))),
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const seconds = cardParam(unit, 1, 'a') + fieldExtra(battle, unit);
    fx.sustain(unit, { key: 'my-seas', mods: { rangeExtend: 1 }, duration: seconds });
    for (const host of leastBlocking(battle, unit, THORN2_SKILL_TARGETS, true)) thornField(battle, unit, host, seconds, (e, ramp) => {
      const down = (k) => THORN2_FROM[k] + (THORN2_TO[k] - THORN2_FROM[k]) * ramp;
      fx.buff(e, { key: `my-seas:${uid(host)}`, mods: { atkMul: 1 - down('atk'), defMul: 1 - down('def'), resMul: 1 - down('res') }, duration: 1.2 });
      fx.damage(e, { scale: cardParam(unit, 1, 'b') / 100, type: 'arts', isSkill: true });
      if (e.alive) fx.elementDamage(e, { element: 'erosion', amount: unit.s.atk * cardParam(unit, 1, 'c') / 100 });
    }, cause);
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx, cause }) => {
      const seconds = THORN2_DEPLOY_SECONDS + fieldExtra(battle, unit);
      for (const host of leastBlocking(battle, unit, p('a'), false)) thornField(battle, unit, host, seconds,
        (e) => fx.buff(e, { key: `flask:${uid(host)}`, mods: { defMul: 1 - THORN2_DEPLOY_DOWN, resMul: 1 - THORN2_DEPLOY_DOWN }, duration: 1.2 }), cause);
    },
    1: 'cast',
    // 心相：攻击力 +a%（模组 a）; the flask time +b s is read where the fields are thrown
    2: ({ unit, p, fx }) => fx.buff(unit, { key: 'mind', mods: { atkPct: moduleParam(unit, THORN2_MODULE, 'a', p('a')) / 100 }, persist: true }),
    3: ({ battle, unit, p }) => {
      const twice = (x) => (onLongRoad(battle, x) ? 2 : 1);
      liveAura(battle, unit, 'horizon', { pick: (x) => x !== unit, mods: (x) => ({ aspd: (p('a') + counterValue(battle, unit, THORN2_COUNTER)) * twice(x) }) });
      if (once(unit, 'thorn2-enemy-slow')) battle.every(0.25, () => {
        if (!active(unit)) return;
        for (const e of battle.enemies) if (e.alive && !e.removed) battle.addBuff(e, { key: `assault:thorn2:horizon:${uid(unit)}`, mods: { aspd: -p('b') * twice(e) }, duration: 0.6, refresh: 'replace', source: unit });
      }, { owner: unit, immediate: true });
    },
    4: ({ unit, fx }) => fx.charge(unit, 2),
    5: {
      options: { accept: (payload, ctx) => inThorn2Field(ctx.battle, ctx.unit, payload.target) },
      run: ({ unit, fx }) => fx.counter(unit, { key: THORN2_COUNTER, label: '视界攻击速度', amount: THORN2_STACK }),
    },
  },
  modules: {
    // 三面的金币：心相的攻击力加成提升至 15/19%，炼金单元延长提升至 4/5 秒 — read by line 2 and fieldExtra
    [THORN2_MODULE]: () => {},
  },
});

// -------------------------------------------------------------------- 山 ---
// 巨力重拳 lands hard and weakens; the heals of your other operators charge him, every dodge makes the punch likelier.

const F12YIN_DEPLOY_WEAKEN = 0.15, F12YIN_DEPLOY_SECONDS = 5, F12YIN_STANCE_DEF = -0.2, F12YIN_STANCE_REGEN = 0.07, F12YIN_WEAKEN = 0.15,
  F12YIN_WEAKEN_SECONDS = 3, F12YIN_STACK = 2, F12YIN_COUNTER = 'f12yin-punch', F12YIN_MODULE = 'uniequip_003_f12yin', F12YIN_TREMBLE = 3;

const f12yin = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    // [ASSUMED] 攻击距离缩短: not done (the engine has no range shrink, as 银灰's 姿态)
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'sweep', duration: cardParam(unit, 1, 'a'),
      mods: { defPct: F12YIN_STANCE_DEF, atkPct: cardParam(unit, 1, 'b') / 100, blockCnt: 1, maxTargets: unit.s.blockCnt ?? 1, hpRegenRatio: F12YIN_STANCE_REGEN } });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const e of adjacentEnemies(battle, unit)) fx.buff(e, { key: 'deploy-weaken', mods: { atkMul: 1 - F12YIN_DEPLOY_WEAKEN }, duration: F12YIN_DEPLOY_SECONDS }); },
    1: 'cast',
    2: {
      // the punch changes the attack it lands with (the native hit hook): its chance, its attack, the target's weakening
      install: ({ battle, unit, p }) => onOwnHit(battle, unit, 'f12yin-punch', ({ target, dmg }) => {
        if (!dmg.isAttack || target?.side !== 'enemy') return;
        if (battle.rng() >= (p('a') + counterValue(battle, unit, F12YIN_COUNTER)) / 100) return;
        dmg.mul *= p('b') / 100;
        battle.addBuff(target, { key: `assault:f12yin:weaken:${uid(unit)}`, mods: { atkMul: 1 - F12YIN_WEAKEN }, duration: F12YIN_WEAKEN_SECONDS, refresh: 'replace', source: unit });
      }),
      run: () => {},
    },
    3: { options: { accept: (payload, ctx) => relates(ctx.unit, payload.source, 'other') }, run: ({ unit, fx }) => fx.charge(unit, 1) },
    4: ({ unit, fx }) => fx.counter(unit, { key: F12YIN_COUNTER, label: '巨力重拳几率', amount: F12YIN_STACK, suffix: '%' }),
  },
  modules: {
    // “夜深人静”：防御力 +18/20%，获得 25% 物理闪避；闪避后下次攻击使目标战栗 3 秒
    [F12YIN_MODULE]: {
      install: ({ battle, unit }) => {
        liveSelf(battle, unit, 'night', () => ({ defPct: moduleParam(unit, F12YIN_MODULE, 'a') / 100, dodgePhys: moduleParam(unit, F12YIN_MODULE, 'b') / 100 }));
        onOwnHit(battle, unit, 'f12yin-night', ({ target, dmg }) => {
          if (!dmg.isAttack || !unit.mem.f12yinNight || target?.side !== 'enemy') return;
          unit.mem.f12yinNight = false;
          battle.applyStatus(target, 'tremble', { duration: F12YIN_TREMBLE, source: unit, instanceKey: `f12yin:${uid(unit)}:night` });
        });
      },
      run: ({ unit }) => { unit.mem.f12yinNight = true; },
    },
  },
});

// ---------------------------------------------------------------- 贝洛内 ---
// 家族手段 shreds a target's defence stack by stack (and finishes the weak); your other operators' defence cuts add a stack,
// the skills of your other 叙拉古 stack her attack speed.

const DEMETR_DODGE = 0.4, DEMETR_DEPLOY_DODGE = 0.8, DEMETR_SKILL_SECONDS = 22, DEMETR_SKILL_ASPD = 80, DEMETR_SKILL_TARGETS = 3,
  DEMETR_SHRED = 7, DEMETR_SHRED_SECONDS = 10, DEMETR_MAX = 5, DEMETR_SKILL_MAX = 8, DEMETR_LOW = 0.2, DEMETR_STACK = 3, DEMETR_MODULE = 'uniequip_002_demetr', DEMETR_MODULE_SHRED = 8;
const familyKey = (unit) => `demetr:${uid(unit)}:family`;
function familyStack(battle, unit, target, n = 1) {
  if (!target?.alive || target.side !== 'enemy') return 0;
  const max = sustained(unit, 'trick') ? DEMETR_SKILL_MAX : DEMETR_MAX;
  const state = target.mem[familyKey(unit)] = target.mem[familyKey(unit)] && battle.time < target.mem[familyKey(unit)].until
    ? target.mem[familyKey(unit)] : { stacks: 0, until: 0 };
  state.stacks = Math.min(max, state.stacks + n);
  state.until = battle.time + DEMETR_SHRED_SECONDS;
  const per = (moduleOf(unit) === DEMETR_MODULE ? DEMETR_MODULE_SHRED : DEMETR_SHRED) / 100;
  // the native 防御力降低 (同名取最高): one status holding every stack, so the other cards' 防御力降低 triggers see it
  battle.applyStatus(target, 'defDown', { duration: DEMETR_SHRED_SECONDS, value: per * state.stacks, source: unit, instanceKey: familyKey(unit) });
  if (state.stacks >= DEMETR_SKILL_MAX && sustained(unit, 'trick')) battle.applyStatus(target, 'sluggish', { duration: DEMETR_SHRED_SECONDS, source: unit, instanceKey: `${familyKey(unit)}:full` });
  return state.stacks;
}

/**
 * 街头直觉 40% and the deploy-time 80% fading back to 40%: one dodge source (the engine rolls separate sources one after
 * the other, so two buffs would add up to more than the card says).
 */
const demetrDodge = (battle, unit) => liveSelf(battle, unit, 'dodge', () => {
  const d = unit.mem.demetrDeployDodge;
  const left = d ? Math.max(0, 1 - (battle.time - d.from) / d.seconds) : 0;
  const p = DEMETR_DODGE + (DEMETR_DEPLOY_DODGE - DEMETR_DODGE) * left;
  return { dodgePhys: p, dodgeArts: p };
});

const demetr = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'trick', duration: DEMETR_SKILL_SECONDS,
      mods: { rangeExtend: 1, aspd: DEMETR_SKILL_ASPD, maxTargets: DEMETR_SKILL_TARGETS - 1, atkScaleMul: cardParam(unit, 1, 'a') / 100 } });
    return true;
  },
  lines: {
    0: ({ battle, unit, p }) => {
      unit.mem.demetrDeployDodge = { from: battle.time, seconds: p('a') };
      demetrDodge(battle, unit);
    },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => onOwnHit(battle, unit, 'demetr-low', ({ target, dmg }) => {
        if (target?.side !== 'enemy') return;
        const lost = Math.max(0, Math.min(1, (1 - target.hp / target.s.maxHp) / (1 - DEMETR_LOW)));
        dmg.mul *= 1 + (moduleParam(unit, DEMETR_MODULE, 'a', p('a')) / 100 - 1) * lost;
      }),
      options: { accept: normalAttack },
      run: ({ battle, unit, target }) => familyStack(battle, unit, target),
    },
    3: ({ battle, unit }) => demetrDodge(battle, unit),
    4: ({ battle, unit, target }) => familyStack(battle, unit, target),
    5: ({ unit, fx }) => fx.stack(unit, { key: 'family-aspd', stat: 'aspd', amount: DEMETR_STACK, mode: 'flat' }),
  },
  modules: {
    // 实用的工具：家族手段每层防御力降低提升至 8%，低血时伤害上限提升至 142/150% — read by familyStack and line 2
    [DEMETR_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 仇白 ---
// 入隙 punishes the 停顿 and bound; the 停顿 of your other operators charge her, their binds sharpen it for the battle.

const QIUBAI_BIND = 3, QIUBAI_PROC_BIND = 1.5, QIUBAI_BOTH = 1.2, QIUBAI_STACK = 5, QIUBAI_COUNTER = 'qiubai-gap', QIUBAI_MODULE = 'uniequip_002_qiubai';

const qiubai = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => !!frontEnemy(battle, unit),
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const target = frontEnemy(battle, unit);
    if (!target) return false;
    fx.status(target, { status: 'bind', duration: QIUBAI_BIND });
    // 束缚结束时对目标和附近所有敌人造成 a% 法术伤害
    battle.after(QIUBAI_BIND, () => {
      if (!active(unit)) return;
      const at = target.alive ? target : null;
      for (const e of battle.enemies.filter((x) => x.alive && !x.removed && (x === target || (at && around8(at, x))))) fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
    }, { owner: unit });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => { const e = rangeEnemies(battle, unit, 1)[0]; if (e) fx.status(e, { status: 'bind', duration: QIUBAI_BIND }); },
    1: 'cast',
    2: ({ battle, unit, p }) => onOwnHit(battle, unit, 'qiubai-gap', ({ target, dmg }) => {
      if (!dmg.isAttack || target?.side !== 'enemy') return;
      const paused = hasStatus(target, 'sluggish'), bound = hasStatus(target, 'bind');
      if (!paused && !bound) return;
      const scale = (moduleParam(unit, QIUBAI_MODULE, 'a', p('a')) + counterValue(battle, unit, QIUBAI_COUNTER)) / 100 * (paused && bound ? QIUBAI_BOTH : 1);
      battle.assaultRuntime.enqueue(() => { if (target.alive) effects(battle, unit, { index: 2 }).damage(target, { scale, type: 'arts' }); },
        { key: `qiubai-gap:${uid(unit)}:${uid(target)}:${dmg.attackId}`, targetUid: uid(target) });
    }),
    3: { options: { accept: normalAttack }, run: ({ battle, unit, p, fx, target }) => { if (target?.alive && battle.rng() < p('a') / 100) fx.status(target, { status: 'bind', duration: QIUBAI_PROC_BIND }); } },
    4: ({ unit, fx }) => fx.charge(unit, 1),
    5: ({ unit, fx }) => fx.counter(unit, { key: QIUBAI_COUNTER, label: '入隙伤害', amount: QIUBAI_STACK, suffix: '%' }),
  },
  modules: {
    // 雪浸过的斗笠：入隙的额外伤害提升至 45/48% 攻击力 — read by line 2
    [QIUBAI_MODULE]: () => {},
  },
});

// ------------------------------------------------------------------ 佩佩 ---
// 盖戳！ hits and shrugs off what holds her (castable stunned); her lotus scent lifts your other 近卫 and grows with their
// skills for the run, their kills inside a skill charge her.

const PEPE_SCENT = 'pepe-scent', PEPE_MODULE = 'uniequip_002_pepe';
const CONTROLS = ['stun', 'freeze', 'sleep', 'bind', 'cold', 'silence', 'fear', 'tremble', 'levitate', 'sluggish', 'slow', 'disarm'];
function cleanse(battle, unit) {
  for (const b of [...(unit.buffs ?? [])].filter((x) => CONTROLS.includes(x.status))) battle.removeBuff(unit, b);
}
/** 技能持续中: a running native timed skill, or a timed effect of an instant synergy skill on the unit. */
const inSkill = (x) => !!x?.skill?.active || (x?.buffs ?? []).some((b) => String(b.key).startsWith('assault:sustain:') && String(b.key).includes(':skill:'));
function stamp(battle, unit, fx) {
  cleanse(battle, unit);
  const target = frontEnemy(battle, unit);
  if (target) fx.damage(target, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
  return !!target;
}

const pepe = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => !!frontEnemy(battle, unit),
  cast: ({ battle, unit, cause }) => stamp(battle, unit, effects(battle, unit, { index: 'skill' }, cause)),
  lines: {
    0: ({ battle, unit, fx }) => stamp(battle, unit, fx),
    1: 'cast',
    2: { options: { accept: (payload) => payload.skillId != null || inSkill(payload.source) }, run: ({ unit, fx }) => fx.charge(unit, 1) },
    3: ({ battle, unit, p }) => liveAura(battle, unit, 'scent', {
      pick: (x) => x !== unit && matchesClass(x, { label: '近卫' }),
      mods: () => ({ atkPct: (p('a') + runCounterValue(battle, unit, PEPE_SCENT)) / 100 }),
    }),
    4: ({ unit, p, fx }) => fx.growthCounter(unit, { key: PEPE_SCENT, label: '弥漫莲香', amount: p('a'), suffix: '%' }),
  },
  modules: {
    // 晴雨：此干员技能持续中击倒敌人时，你的其他近卫干员充能 1/2（每 2 秒最多一次） — her skill is instant: a kill by its damage
    [PEPE_MODULE]: {
      options: { accept: (payload) => payload.skillId != null || inSkill(payload.source) },
      run: ({ unit, fx }) => { for (const x of fx.allies('allies:近卫')) fx.charge(x, moduleParam(unit, PEPE_MODULE, 'a')); },
    },
  },
  // 处于异常状态时也可以发动: a ready skill fires through a stun / freeze too (the natural cast waits for her to act)
  install: (battle, unit) => battle.every(0.25, () => {
    if (!active(unit) || unit.canAct || !unit.skill?.ready || !frontEnemy(battle, unit)) return;
    battle.assaultRuntime.cast(unit, { force: true });
  }, { owner: unit }),
});

// -------------------------------------------------------------------- 锏 ---
// Everything trembles around her; your operators ignore the trembling ones' defence, the 战栗 of your other operators
// charge her and their blocks of trembling enemies stack her attack.

const BLKKGT_SLASHES = 2, BLKKGT_BLOCKED_SLASHES = 3, BLKKGT_TARGETS = 6, BLKKGT_TREMBLE = 5, BLKKGT_PROC = 0.1, BLKKGT_STACK = 2, BLKKGT_MODULE = 'uniequip_002_blkkgt';

const blkkgt = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = rangeEnemies(battle, unit).filter((e) => !e.isFlying).slice(0, BLKKGT_TARGETS);
    for (const e of targets) {
      fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true, hits: e.blockedBy ? BLKKGT_BLOCKED_SLASHES : BLKKGT_SLASHES });
      if (e.alive) fx.status(e, { status: 'tremble', duration: BLKKGT_TREMBLE });
    }
    return targets.length > 0;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of rangeEnemies(battle, unit).filter((x) => !x.isFlying)) fx.status(e, { status: 'tremble', duration: p('a') }); },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => onOwnHit(battle, unit, 'blkkgt-born', ({ target, dmg }) => {
        if (target?.side !== 'enemy') return;
        if (dmg.isSkill && moduleOf(unit) === BLKKGT_MODULE) dmg.mul *= 1 + moduleParam(unit, BLKKGT_MODULE, 'a') / 100;
        if (battle.rng() >= BLKKGT_PROC) return;
        dmg.mul *= moduleParam(unit, BLKKGT_MODULE, 'b', p('a')) / 100;
        battle.applyStatus(target, 'tremble', { duration: BLKKGT_TREMBLE, source: unit, instanceKey: `blkkgt:${uid(unit)}:born` });
      }),
      run: () => {},
    },
    3: ({ battle, unit, p }) => {
      if (once(unit, 'blkkgt-legend')) battle.on('hit', ({ source, target, dmg }) => {
        if (!active(unit) || !dmg || target?.side !== 'enemy' || source?.kind !== 'op' || !relates(unit, source, 'yours') || !hasStatus(target, 'tremble')) return;
        dmg.defIgnorePct = Math.min(1, (dmg.defIgnorePct ?? 0) + p('a') / 100);
      }, { owner: unit, priority: 70 });
    },
    4: ({ unit, fx }) => fx.charge(unit, 1),
    5: { options: { accept: (payload) => hasStatus(payload.target, 'tremble') }, run: ({ unit, fx }) => fx.stack(unit, { key: 'legend-atk', stat: 'atk', amount: BLKKGT_STACK / 100, mode: 'percent' }) },
  },
  modules: {
    // “过往的注脚”：技能造成的伤害 +10%；“天生的武者”的攻击力提升至 170/175% — read by line 2
    [BLKKGT_MODULE]: () => {},
  },
});

// ------------------------------------------------------------ 百炼嘉维尔 ---
// The block wall: every enemy she holds lifts her, each new block of hers stacks her neighbours' attack, your other
// operators' blocks grow her for the run; heals of your other operators land harder and charge her.

const GVIAL2_SKILL_ASPD = 100, GVIAL2_SKILL_BLOCK = 2, GVIAL2_SHARE = 0.5, GVIAL2_DELAY = 20, GVIAL2_PER_BLOCK = 5, GVIAL2_STACK = 1, GVIAL2_MODULE = 'uniequip_003_gvial2';
const blockingCount = (unit) => (unit.blocking ?? []).filter((e) => e.alive && e.blockedBy === unit).length;

const gvial2 = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.sustain(unit, { key: 'jungle', mods: { atkPct: cardParam(unit, 1, 'b') / 100, aspd: GVIAL2_SKILL_ASPD, blockCnt: GVIAL2_SKILL_BLOCK }, duration: cardParam(unit, 1, 'a') });
    if (once(unit, 'gvial2-jungle')) {
      // 持续中只受到 50% 伤害，其余在结束后 20 秒内以生命流失补上
      battle.on('hpDamage', (ctx) => {
        if (ctx.target !== unit || !sustained(unit, 'jungle') || !(ctx.amount > 0)) return;
        const held = ctx.amount * GVIAL2_SHARE;
        ctx.amount -= held;
        unit.mem.gvial2Owed = (unit.mem.gvial2Owed ?? 0) + held;
      }, { owner: unit });
      battle.every(1, () => {
        if (!active(unit) || sustained(unit, 'jungle') || !(unit.mem.gvial2Owed > 0)) return;
        unit.mem.gvial2Rate ??= unit.mem.gvial2Owed / GVIAL2_DELAY;
        const part = Math.min(unit.mem.gvial2Owed, unit.mem.gvial2Rate);
        unit.mem.gvial2Owed -= part;
        if (!(unit.mem.gvial2Owed > 1e-9)) { unit.mem.gvial2Owed = 0; unit.mem.gvial2Rate = null; }
        battle.loseHp(unit, part, { source: unit, tags: ['assaultGvial2Delay'] });
      }, { owner: unit });
    }
    unit.mem.gvial2Rate = null;
    return true;
  },
  lines: {
    0: ({ unit, p, fx }) => fx.buff(unit, { key: 'deploy-block', mods: { blockCnt: GVIAL2_SKILL_BLOCK }, duration: p('a') }),
    1: 'cast',
    2: ({ battle, unit, p }) => liveSelf(battle, unit, 'axe', () => {
      const x = (p('a') + GVIAL2_PER_BLOCK * blockingCount(unit)) / 100;
      return { atkPct: x, defPct: x };
    }),
    3: ({ battle, unit, fx }) => { for (const x of yourOps(battle, unit, (y) => y !== unit && withinAdjacent4(unit, y))) fx.stack(x, { key: 'axe-atk', stat: 'atk', amount: GVIAL2_STACK / 100, mode: 'percent' }); },
    4: ({ unit, p, fx }) => {
      fx.growth(unit, { key: 'axe-atk', stat: 'atk', percent: p('a') / 100 });
      fx.growth(unit, { key: 'axe-def', stat: 'def', percent: p('a') / 100 });
    },
    5: {
      install: ({ battle, unit, p }) => liveSelf(battle, unit, 'medic', () => ({ healingTakenMul: 1 + (unit.hp < unit.s.maxHp * 0.5 ? p('b') : p('a')) / 100 })),
      options: { accept: (payload, ctx) => relates(ctx.unit, payload.source, 'other') },
      run: ({ unit, fx }) => fx.charge(unit, 1),
    },
  },
  modules: {
    // 好锯多磨：被此干员阻挡的敌人受到 10% 物理脆弱
    [GVIAL2_MODULE]: ({ battle, unit }) => enemyAura(battle, unit, { key: 'saw', mods: { physTakenMul: 1 + moduleParam(unit, GVIAL2_MODULE, 'a') / 100 }, select: (e) => e.blockedBy === unit }),
  },
});

// ---------------------------------------------------------------- 史尔特尔 ---
// 黄昏 burns her life for a huge attack; at a fatal hit 余烬 holds her at 1 HP and redeploys her in place. Elite kills of
// your other operators grow her for the run, their 再部署 grow 黄昏 for the battle.

const SURTR_RANGE = 2, SURTR_TARGETS = 3, SURTR_DRAIN_MAX = 0.2, SURTR_DRAIN_RAMP = 20, SURTR_STACK = 5, SURTR_COUNTER = 'surtr-dusk', SURTR_MODULE = 'uniequip_003_surtr';
const surtrDusk = (unit) => (unit.buffs ?? []).some((b) => String(b.key).endsWith(':dusk'));

const surtr = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const first = !surtrDusk(unit);
    if (first) unit.mem.surtrDuskAt = battle.time;
    else for (const enemy of rangeEnemies(battle, unit, SURTR_TARGETS))
      fx.damage(enemy, { scale: cardParam(unit, 1, 'a') / 100, type: 'arts', isSkill: true });
    fx.buff(unit, { key: 'dusk', mods: { atkPct: (cardParam(unit, 1, 'a') + counterValue(battle, unit, SURTR_COUNTER)) / 100, rangeExtend: SURTR_RANGE,
      maxTargets: SURTR_TARGETS, hpFlat: cardParam(unit, 1, 'b') }, duration: Infinity });
    if (first) unit.hp = unit.s.maxHp;
    if (once(unit, 'surtr-drain')) battle.every(1, () => {
      if (!active(unit) || !surtrDusk(unit) || unit.mem.surtrEmber) return;
      const rate = SURTR_DRAIN_MAX * Math.min(1, (battle.time - unit.mem.surtrDuskAt) / SURTR_DRAIN_RAMP);
      if (rate > 0) battle.loseHp(unit, unit.s.maxHp * rate, { source: unit, tags: ['assaultSurtrDusk'] });
    }, { owner: unit });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of rangeEnemies(battle, unit)) fx.damage(e, { scale: p('a') / 100, type: 'arts' }); },
    1: 'cast',
    2: ({ battle, unit, p, fx }) => {
      fx.buff(unit, { key: 'molten', mods: { resIgnoreFlat: p('a') }, persist: true });
      onOwnHit(battle, unit, 'surtr-frozen', ({ target, dmg }) => { if (hasStatus(target, 'frozen')) dmg.resIgnorePct = 1; });
    },
    3: {
      // 余烬: the fatal hit leaves her at 1 HP; a seconds later she is redeployed in place (HP full) — no death meanwhile
      install: ({ battle, unit, p }) => battle.on('fatal', (ctx) => {
        if (ctx.unit !== unit || !active(unit)) return;
        ctx.prevented = true;
        if (unit.mem.surtrEmber) return;
        unit.mem.surtrEmber = true;
        const fx = effects(battle, unit, { index: 3 });
        if (moduleOf(unit) === SURTR_MODULE) fx.buff(unit, { key: 'ember-aspd', mods: { aspd: moduleParam(unit, SURTR_MODULE, 'a') }, duration: p('a') });
        battle.after(p('a'), () => {
          unit.mem.surtrEmber = false;
          if (active(unit)) { battle.assaultRedeployChain = null; fx.redeployNow(unit); }
        }, { owner: unit });
      }, { owner: unit, priority: 30 }),
      run: () => {},
    },
    4: ({ unit, p, fx }) => fx.growth(unit, { key: 'molten-atk', stat: 'atk', percent: p('a') / 100 }),
    5: ({ battle, unit, fx }) => {
      fx.counter(unit, { key: SURTR_COUNTER, label: '黄昏攻击力加成', amount: SURTR_STACK, suffix: '%' });
      // the running 黄昏 takes the new bonus at once
      const dusk = unit.buffs.find((b) => String(b.key).endsWith(':dusk'));
      if (dusk) { dusk.mods = { ...dusk.mods, atkPct: (cardParam(unit, 1, 'a') + counterValue(battle, unit, SURTR_COUNTER)) / 100 }; unit.markDirty(); }
    },
  },
  modules: {
    // 旅游必需品：余烬期间攻击速度 +30 — read by line 3
    [SURTR_MODULE]: () => {},
  },
});

// ------------------------------------------------------------ 维娜·维多利亚 ---
// 诸王的叹息 shields everyone around her and grows with the company; each first hit makes an enemy tremble, and every
// deployment of your other operators next to her grows her for the run.

const SIEGE2_TOKEN = 'token_10040_siege2_vlion', SIEGE2_SKILL_SECONDS = 25, SIEGE2_TARGETS = 3, SIEGE2_INTERVAL = -0.3, SIEGE2_ELITE_TREMBLE = 12,
  SIEGE2_MODULE = 'uniequip_003_siege2', SIEGE2_MODULE_BONUS = 1.15;

const siege2 = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const compiled = battle.data?.getToken?.(SIEGE2_TOKEN, unit.def.charId) ?? battle.data?.rawToken?.(SIEGE2_TOKEN);
    if (compiled) grantSummon(battle, unit, { tokenId: SIEGE2_TOKEN, count: 1, stockCap: 1, fieldCap: 1, cost: 0, replaceExisting: true, anySource: true,
      kit: assaultTokenKits[SIEGE2_TOKEN], sourceBody: unit.def.raw.assaultBody, duration: SIEGE2_SKILL_SECONDS });
    // [ASSUMED] 「可以攻击被周围 8 格干员阻挡的敌人」: range +1; 攻击间隔缩短 (no number): −30%
    fx.sustain(unit, { key: 'oath', mods: { atkPct: cardParam(unit, 1, 'a') / 100, maxTargets: SIEGE2_TARGETS, batPct: SIEGE2_INTERVAL, rangeExtend: 1 }, duration: SIEGE2_SKILL_SECONDS });
    onOwnHit(battle, unit, 'siege2-true', ({ dmg }) => { if (dmg.isAttack && sustained(unit, 'oath')) dmg.type = 'true'; });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of aroundEnemies(battle, unit).filter((x) => !x.isFlying)) fx.damage(e, { scale: p('a') / 100, type: 'true' }); },
    1: 'cast',
    2: ({ battle, unit, p }) => {
      liveAura(battle, unit, 'sigh', { pick: (x) => x === unit || around8(unit, x), mods: () => ({ physTakenMul: 1 - p('a') / 100 }) });
      liveSelf(battle, unit, 'sigh-atk', () => {
        const n = yourOps(battle, unit, (x) => x !== unit && around8(unit, x)).length;
        return n ? { atkPct: p('b') * n / 100 } : null;
      });
    },
    3: {
      options: { accept: (payload, ctx) => payload.target?.side === 'enemy' && !(ctx.unit.mem.siege2Hit ??= new WeakSet()).has(payload.target) },
      run: ({ unit, p, fx, target }) => {
        unit.mem.siege2Hit.add(target);
        if (target?.alive) fx.status(target, { status: 'tremble', duration: isElite(target) ? SIEGE2_ELITE_TREMBLE : p('a') });
      },
    },
    4: { options: { around: 8 }, run: ({ unit, p, fx }) => fx.growth(unit, { key: 'sigh-growth', stat: 'atk', percent: p('a') / 100 }) },
  },
  modules: {
    // 秩序圣“球”：此干员及其召唤物对战栗的敌人造成的伤害 +15%
    [SIEGE2_MODULE]: ({ battle, unit }) => {
      if (once(unit, 'siege2-ball')) battle.on('hit', ({ source, target, dmg }) => {
        if (!dmg || !active(unit) || (source !== unit && source?.ownerUnit !== unit) || !hasStatus(target, 'tremble')) return;
        dmg.mul *= SIEGE2_MODULE_BONUS;
      }, { owner: unit, priority: 70 });
    },
  },
});

// ---------------------------------------------------------------- 赫拉格 ---
// He pays 40% of his HP at every deployment; 坚忍 turns it into speed, and every heal your other operators give (to
// anyone: his 武者 trait keeps him out of their heals) raises its ceiling for the run.

const HELAGE_DROP = 0.4, HELAGE_HITS = 2, HELAGE_CEILING = 'helage-ceiling', HELAGE_MODULE = 'uniequip_003_helage';

const helage = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => !!frontEnemy(battle, unit),
  cast: ({ battle, unit, cause }) => {
    const target = frontEnemy(battle, unit);
    if (!target) return false;
    effects(battle, unit, { index: 'skill' }, cause).damage(target, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true, hits: HELAGE_HITS });
    return true;
  },
  lines: {
    0: ({ unit, fx }) => fx.loseHp(unit, { currentPct: HELAGE_DROP }),
    1: 'cast',
    2: ({ battle, unit, p }) => liveSelf(battle, unit, 'berserk', () => ({ aspd: (p('a') + runCounterValue(battle, unit, HELAGE_CEILING)) * berserk(unit) })),
    3: ({ battle, unit, p }) => liveSelf(battle, unit, 'tactics', () => ((unit.blocking ?? []).some((e) => e.alive) ? null : { hpRegen: p('a') })),
    4: ({ unit, fx }) => fx.growthCounter(unit, { key: HELAGE_CEILING, label: '月盈星亏攻击速度上限', amount: 1 }),
  },
  modules: {
    // “热的雪”：你的其他干员使敌人寒冷或冻结时，此干员充能 1（每 2 秒最多一次）
    [HELAGE_MODULE]: ({ unit, fx }) => fx.charge(unit, 1),
  },
});

// ------------------------------------------------------------ 耀骑士临光 ---
// A deploy-cast passive: 逐夜烁光 and a stunning flash at every deployment (twice after a 卡西米尔), her 卡西米尔 block flyers
// for a while after, their deployments bring her own loop closer, their air blocks grow the flash for the battle.

const NEARL2_STUN = 3, NEARL2_LAYERS = 4, NEARL2_DELAY = 0.25, NEARL2_CUT = 2, NEARL2_STACK = 20, NEARL2_COUNTER = 'nearl2-dark', NEARL2_MODULE = 'uniequip_003_nearl2';
const lastDeployed = new WeakMap();
const afterKazimierz = (unit) => matchesClass(unit.mem.nearl2Previous, { label: '卡西米尔' }) && unit.mem.nearl2Previous !== unit;
function flash(battle, unit, fx, stun) {
  const scale = cardParam(unit, 1, 'a') / 100 * (1 + counterValue(battle, unit, NEARL2_COUNTER) / 100);
  for (let i = 0; i < (afterKazimierz(unit) ? 2 : 1); i++) for (const e of adjacentEnemies(battle, unit)) {
    fx.damage(e, { scale, type: 'true' });
    if (e.alive) fx.status(e, { status: 'stun', duration: stun });
  }
}

const nearl2 = (bb, raw, def) => synergyKit(def, {
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const seconds = cardParam(unit, 2, 'a');
    fx.sustain(unit, { key: 'night', mods: { atkPct: cardParam(unit, 2, 'b') / 100 }, duration: seconds });
    battle.addBuff(unit, { key: `assault:layers:${uid(unit)}:nearl2`, shieldHits: NEARL2_LAYERS, duration: seconds, visible: true, source: unit });
    // 结束时本次再部署时间 +25%（上一名部署的干员是卡西米尔时不延长）
    const kazimierz = afterKazimierz(unit), deployment = deploymentOf(unit);
    battle.after(seconds, () => { if (!kazimierz && active(unit) && deploymentOf(unit) === deployment) fx.redeployDelay(unit, NEARL2_DELAY); }, { owner: unit });
    return true;
  },
  lines: {
    0: 'cast',
    1: ({ battle, unit, fx }) => flash(battle, unit, fx, NEARL2_STUN),
    2: 'cast',
    3: ({ unit, p, fx }) => fx.buff(unit, { key: 'dawn', mods: { defIgnorePct: p('a') / 100 }, persist: true }),
    4: ({ battle, unit }) => cutOwnRedeploy(battle, unit, NEARL2_CUT),
    5: ({ battle, unit, p, fx }) => fx.airAura({ label: '卡西米尔' }, { until: battle.time + p('a') }),
    6: ({ unit, fx }) => fx.counter(unit, { key: NEARL2_COUNTER, label: '不畏苦暗伤害', amount: NEARL2_STACK, suffix: '%' }),
  },
  modules: {
    // “骑士家族”：每场战斗首次受到致命伤害时也触发不畏苦暗，晕眩提升至 4 秒
    [NEARL2_MODULE]: {
      install: ({ battle, unit }) => battle.on('fatal', (ctx) => {
        if (ctx.unit !== unit || unit.mem.nearl2Family || !active(unit)) return;
        unit.mem.nearl2Family = true;
        flash(battle, unit, effects(battle, unit, { index: 1 }), moduleParam(unit, NEARL2_MODULE, 'a'));
      }, { owner: unit, priority: 20 }),
      run: () => {},
    },
  },
  // 上一名部署的干员: who was deployed (or redeployed) last before each of her deployments
  install: (battle, unit) => battle.assaultRuntime.observe('deployed', `nearl2-previous:${uid(unit)}`, (event) => {
    const target = event.payload?.target;
    if (target?.kind !== 'op' || !relates(unit, target, 'yours')) return;
    if (target === unit) unit.mem.nearl2Previous = lastDeployed.get(battle) ?? null;
    lastDeployed.set(battle, target);
  }, { owner: unit, priority: 100 }),
});

// ------------------------------------------------------------ 圣约送葬人 ---
// 圣约决裁 loads a magazine that grows each round and ends in a volley on everything it shot; every 拉特兰 on the field and
// every elite kill of your other operators (for the run) add a round, their skills reload him.

const EXCU2_PER_ROUND = 0.06, EXCU2_ROUND_CAP = 30, EXCU2_FINAL = 250, EXCU2_EXTRA_PER_ROUND = 5, EXCU2_GROWTH = 'excu2-capacity', EXCU2_MODULE = 'uniequip_003_excu2';

const excu2 = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    unit.mem.excu2Rounds = 0;
    unit.mem.excu2Shot = new Set();
    maxAmmo(unit, 'growth', runCounterValue(battle, unit, EXCU2_GROWTH));
    const moduleAtk = moduleOf(unit) === EXCU2_MODULE ? moduleParam(unit, EXCU2_MODULE, 'a') / 100 : 0;
    ammoSkill(battle, unit, { key: 'verdict', count: cardParam(unit, 1, 'a'), cause,
      mods: { rangeExtend: 1, atkPct: cardParam(unit, 1, 'b') / 100 + moduleAtk },
      onAttack: ({ targets }) => {
        unit.mem.excu2Rounds = Math.min(EXCU2_ROUND_CAP, (unit.mem.excu2Rounds ?? 0) + 1);
        for (const t of targets ?? []) unit.mem.excu2Shot.add(t);
        fx.buff(unit, { key: 'verdict-rounds', mods: { atkPct: EXCU2_PER_ROUND * unit.mem.excu2Rounds }, duration: Infinity });
      },
      onEmpty: () => {
        battle.removeBuff(unit, unit.buffs.find((b) => String(b.key).endsWith(':verdict-rounds')));
        for (const e of unit.mem.excu2Shot ?? []) if (e.alive) fx.damage(e, { scale: EXCU2_FINAL / 100, type: 'phys', isSkill: true });
        unit.mem.excu2Shot = new Set();
        unit.mem.excu2Rounds = 0;
      } });
    return true;
  },
  lines: {
    0: ({ unit, fx }) => fx.reload(unit, 'full'),
    1: 'cast',
    2: {
      options: { accept: (payload, ctx) => normalAttack(payload) && !ctx.unit.mem.excu2Extra },
      run: ({ battle, unit, p, target }) => {
        const chance = (p('a') + EXCU2_EXTRA_PER_ROUND * (unit.mem.excu2Rounds ?? 0)) / 100;
        if (!target?.alive || battle.rng() >= chance) return;
        unit.mem.excu2Extra = true;
        try { battle.forceAttack(unit, [target], { noAmmo: true }); } finally { unit.mem.excu2Extra = false; }
      },
    },
    3: ({ battle, unit }) => liveSelf(battle, unit, 'lateran-rounds', () => {
      maxAmmo(unit, 'lateran', yourOps(battle, unit, (x) => x !== unit && matchesClass(x, { label: '拉特兰' })).length);
      return null;
    }),
    4: ({ unit, fx }) => fx.reload(unit, 1),
    5: ({ unit, fx }) => {
      const total = fx.growthCounter(unit, { key: EXCU2_GROWTH, label: '弹药上限', amount: 1 });
      maxAmmo(unit, 'growth', total);
    },
  },
  modules: {
    // 已知悉：弹药类技能期间攻击力 +12%（read by the cast）；弹药不少于一半时获得 30% 物理与法术闪避
    [EXCU2_MODULE]: ({ battle, unit }) => liveSelf(battle, unit, 'known', () => {
      const ammo = assaultAmmoState(unit);
      if (!ammo || !(ammo.current > 0) || ammo.current * 2 < ammo.capacity) return null;
      const p = moduleParam(unit, EXCU2_MODULE, 'b') / 100;
      return { dodgePhys: p, dodgeArts: p };
    }),
  },
});

// ---------------------------------------------------------------- 隐德来希 ---
// 萃血 steals max HP from what she hits and bleeds it; every 萃血 victim your other operators fell grows her for the run.

const ETLCHI_HITS = 2, ETLCHI_SKILL_SECONDS = 12, ETLCHI_TICK = 0.5, ETLCHI_STEAL_CAP = 1350, ETLCHI_DOT = 5, ETLCHI_LOW = 0.25, ETLCHI_MODULE = 'uniequip_003_etlchi';
const bledBy = (unit, e) => (e?.buffs ?? []).some((b) => b.key === `assault:etlchi:blood:${uid(unit)}` && b.timeLeft > 0);

const etlchi = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => aroundEnemies(battle, unit, 1).length > 0 || rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    fx.sustain(unit, { key: 'scythe', mods: {}, flags: { disarm: true }, duration: ETLCHI_SKILL_SECONDS });
    // 血镰 on her and on one other ground operator (the nearest)
    const other = yourOps(battle, unit, (x) => x !== unit && isMelee(x)).sort((a, b) => hypot(a.x - unit.x, a.y - unit.y) - hypot(b.x - unit.x, b.y - unit.y))[0];
    const hosts = [unit, ...(other ? [other] : [])];
    unit.mem.etlchiScythes = hosts;
    let ticks = 0;
    const timer = battle.every(ETLCHI_TICK, () => {
      ticks++;
      if (!active(unit)) { timer.cancel(); return; }
      for (const host of hosts) if (active(host)) for (const e of aroundEnemies(battle, host)) fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100, type: 'phys', isSkill: true });
      if (ticks * ETLCHI_TICK >= ETLCHI_SKILL_SECONDS - 1e-9) timer.cancel();
    }, { owner: unit });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const e of aroundEnemies(battle, unit)) fx.damage(e, { scale: p('a') / 100, type: 'phys', hits: ETLCHI_HITS }); },
    1: 'cast',
    2: {
      options: { accept: normalAttack },
      run: ({ battle, unit, p, fx, target }) => {
        if (!target?.alive) return;
        const doubled = hasStatus(target, 'sleep') || hasStatus(target, 'stun');
        const room = Math.max(0, ETLCHI_STEAL_CAP - (unit.mem.etlchiStolen ?? 0));
        const steal = Math.min(room, p('a') * (doubled ? 2 : 1));
        if (steal > 0) {
          unit.mem.etlchiStolen = (unit.mem.etlchiStolen ?? 0) + steal;
          battle.addBuff(target, { key: `assault:etlchi:drained:${uid(unit)}`, mods: { hpFlat: -(target.mem.etlchiDrained = (target.mem.etlchiDrained ?? 0) + steal) }, duration: Infinity, refresh: 'replace', source: unit });
          fx.buff(unit, { key: 'stolen', mods: { hpFlat: unit.mem.etlchiStolen }, persist: true });
        }
        // 每秒受到 b 法术伤害，持续 5 秒 (a new bite refreshes it)
        battle.addBuff(target, { key: `assault:etlchi:blood:${uid(unit)}`, mods: {}, duration: ETLCHI_DOT, refresh: 'replace', source: unit, interval: 1,
          onTick: ({ unit: victim }) => { if (victim.alive && active(unit)) effects(battle, unit, { index: 2 }).damage(victim, { amount: p('b'), type: 'arts' }); } });
      },
    },
    3: { options: { accept: (payload, ctx) => bledBy(ctx.unit, payload.target) }, run: ({ unit, p, fx }) => fx.growth(unit, { key: 'blood-hp', stat: 'maxHp', flat: p('a') }) },
    4: {
      options: { accept: (payload, ctx) => !ctx.unit.mem.etlchiFull && ctx.unit.hp < ctx.unit.s.maxHp * ETLCHI_LOW },
      run: ({ unit, p, fx }) => {
        unit.mem.etlchiFull = true;
        fx.heal(unit, { maxHpRatio: p('a') / 100 });
        fx.buff(unit, { key: 'full', mods: { physTakenMul: 1 - p('b') / 100 }, persist: true });
      },
    },
  },
  modules: {
    // 玫瑰色故事集：场上存在萃血的法术伤害效果时，此干员每秒回复 3.5% 最大生命
    [ETLCHI_MODULE]: ({ battle, unit }) => liveSelf(battle, unit, 'rose', () => (battle.enemies.some((e) => e.alive && bledBy(unit, e)) ? { hpRegenRatio: moduleParam(unit, ETLCHI_MODULE, 'a') / 100 } : null)),
  },
  // 萃血 lives on her bites: the 收割者 heal-lock stays (her lines never need a heal from others)
});

// ---------------------------------------------------------------- 玛恩纳 ---
// He draws the attacks; your other 卡西米尔 hit back with his strength when struck, his skill makes their hits burn true,
// and every enemy your other operators fell while he holds back grows him for the run.

const MLYNAR_TAUNT_SECONDS = 5, MLYNAR_SKILL_TARGETS = 5, MLYNAR_MARK = 0.12, MLYNAR_CROWD = 3, MLYNAR_CROWD_TAKEN = 0.15, MLYNAR_MODULE = 'uniequip_002_mlynar', MLYNAR_MODULE_TAKEN = 0.25;
// 特性提升至 2 倍（每击倒一名敌人 -10%）: native S3 trait_up 2, per_kill_reduce 0.1 — the multiplier of the trait's ramp,
// never below 1
const MLYNAR_TRAIT_UP = 2, MLYNAR_PER_KILL = 0.1;

/**
 * 未照耀的荣光 opens the 解放者 window (professions.js installLibrator reads mem.assaultMlynarWindowOpen / SkillUntil as the
 * skill being active): he attacks and blocks, the ramp stops growing and counts ×2 (minus 0.1 per kill of his), and when
 * the window closes the trait resets as at a native skill end. A recast inside the window keeps it open longer.
 */
function mlynarWindow(battle, unit, seconds) {
  const mem = unit.mem;
  const open = mem.assaultMlynarWindowOpen && battle.time < mem.assaultMlynarSkillUntil;
  if (!open) {
    mem.assaultMlynarWindowOpen = true;
    mem.mlynarRamp = Math.max(0, Number(unit.trait?.ramp) || 0);
    mem.mlynarKills = 0;
    mem.assaultMlynarNoAttackUnlessSkill ??= unit.profile.noAttackUnlessSkill;
    unit.profile.noAttackUnlessSkill = false;
    battle.removeBuff(unit, 'trait:libratorBlock');
  }
  mem.assaultMlynarSkillUntil = battle.time + seconds;
  const generation = mem.mlynarWindow = (mem.mlynarWindow ?? 0) + 1;
  mlynarTrait(battle, unit);
  battle.after(seconds, () => {
    if (mem.mlynarWindow !== generation || !mem.assaultMlynarWindowOpen) return;
    mem.assaultMlynarWindowOpen = false;
    mem.assaultMlynarSkillUntil = 0;
    unit.profile.noAttackUnlessSkill = mem.assaultMlynarNoAttackUnlessSkill;
    battle.removeBuff(unit, `assault:mlynar:trait-up:${uid(unit)}`);
    if (battle._hooks.skillEnd) battle.emit('skillEnd', { unit, reason: 'assault-window' });
  }, { owner: unit });
}
function mlynarTrait(battle, unit) {
  const mem = unit.mem;
  const multiplier = Math.max(1, MLYNAR_TRAIT_UP - MLYNAR_PER_KILL * (mem.mlynarKills ?? 0));
  const extra = (mem.mlynarRamp ?? 0) * (multiplier - 1);
  const key = `assault:mlynar:trait-up:${uid(unit)}`;
  if (extra > 0) battle.addBuff(unit, { key, mods: { atkPct: extra }, duration: Infinity, refresh: 'replace', source: unit });
  else battle.removeBuff(unit, key);
}
const mlynarOpen = (battle, unit) => !!unit.mem.assaultMlynarWindowOpen && battle.time < unit.mem.assaultMlynarSkillUntil;

const mlynar = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const seconds = cardParam(unit, 1, 'a');
    fx.sustain(unit, { key: 'glory', mods: { rangeExtend: 1, maxTargets: MLYNAR_SKILL_TARGETS - 1, atkScaleMul: cardParam(unit, 1, 'b') / 100 }, duration: seconds });
    mlynarWindow(battle, unit, seconds);
    if (once(unit, 'mlynar-kills')) battle.assaultRuntime.observe('kill', `mlynar-kills:${uid(unit)}`, (event) => {
      if (event.payload?.source !== unit || !mlynarOpen(battle, unit)) return;
      unit.mem.mlynarKills = (unit.mem.mlynarKills ?? 0) + 1;
      mlynarTrait(battle, unit);
    }, { owner: unit });
    if (once(unit, 'mlynar-glory')) battle.on('hit', ({ source, target, dmg }) => {
      if (!dmg || !active(unit) || !sustained(unit, 'glory') || source === unit || source?.kind !== 'op' || !relates(unit, source, 'yours')
        || !matchesClass(source, { label: '卡西米尔' }) || target?.side !== 'enemy' || !rangeEnemies(battle, unit).includes(target)) return;
      battle.assaultRuntime.enqueue(() => { if (target.alive) effects(battle, unit, { index: 'skill' }).damage(target, { scale: MLYNAR_MARK, type: 'true', isSkill: true }); },
        { key: `mlynar-glory:${uid(unit)}:${uid(target)}:${dmg.attackId}`, targetUid: uid(target) });
    }, { owner: unit, priority: 30 });
    return true;
  },
  lines: {
    0: ({ unit, fx }) => fx.buff(unit, { key: 'draw', mods: { taunt: 1 }, duration: MLYNAR_TAUNT_SECONDS }),
    1: 'cast',
    2: ({ battle, unit, p }) => {
      const crowd = () => aroundEnemies(battle, unit).length >= MLYNAR_CROWD;
      onOwnHit(battle, unit, 'mlynar-ranger', ({ dmg }) => {
        if (!dmg.isAttack) return;
        dmg.mul *= moduleParam(unit, MLYNAR_MODULE, crowd() ? 'b' : 'a', p(crowd() ? 'b' : 'a')) / 100;
      });
      liveSelf(battle, unit, 'ranger-guard', () => (crowd() ? { dmgTakenMul: 1 - (moduleOf(unit) === MLYNAR_MODULE ? MLYNAR_MODULE_TAKEN : MLYNAR_CROWD_TAKEN) } : null));
    },
    3: {
      install: ({ battle, unit }) => liveSelf(battle, unit, 'unmoved', () => ({ taunt: 1 })),
      options: { accept: (payload) => payload.source?.side === 'enemy' },
      run: ({ unit, p, fx, payload }) => { if (payload.source?.alive) fx.damage(payload.source, { amount: unit.s.atk * p('a') / 100, type: 'true' }); },
    },
    // 未攻击期间: outside his skill window (the 解放者 does not attack then)
    4: { options: { accept: (payload, ctx) => !mlynarOpen(ctx.battle, ctx.unit) }, run: ({ unit, p, fx }) => fx.growth(unit, { key: 'ranger-atk', stat: 'atk', percent: p('a') / 100 }) },
  },
  modules: {
    // “鞘中人”：游侠提升至 120/123%、125/128%，受到的伤害 -25% — read by line 2
    [MLYNAR_MODULE]: () => {},
  },
});

// ---------------------------------------------------------------- 斯卡蒂 ---
// She lifts your other 深海猎人 (more with every elite they fell, for the run); their 再部署 stack her attack.

const SKADI_DEPLOY_ATK = 1.7, SKADI_QUICK = 6, SKADI_STACK = 3, SKADI_PREDATOR = 'skadi-predator', SKADI_MODULE = 'uniequip_003_skadi', SKADI_MODULE_BLOCKED = 1.15;

const skadi = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const x = cardParam(unit, 1, 'b') / 100;
    effects(battle, unit, { index: 'skill' }, cause).sustain(unit, { key: 'tide', mods: { atkPct: x, defPct: x, hpPct: x }, duration: cardParam(unit, 1, 'a') });
    return true;
  },
  lines: {
    0: ({ unit, p, fx }) => fx.buff(unit, { key: 'deploy-atk', mods: { atkPct: SKADI_DEPLOY_ATK }, duration: p('a') }),
    1: 'cast',
    2: ({ battle, unit, p }) => liveAura(battle, unit, 'predator', {
      pick: (x) => x !== unit && matchesClass(x, { label: '深海猎人' }),
      mods: () => ({ atkPct: (p('a') + runCounterValue(battle, unit, SKADI_PREDATOR)) / 100 }),
    }),
    // 迅捷出击：此干员再部署时间 -6 秒 (every later loop of the battle; once per battle)
    3: ({ unit, fx }) => { if (!unit.mem.skadiQuick) { unit.mem.skadiQuick = true; fx.redeployTime(unit, { seconds: SKADI_QUICK }); } },
    4: ({ unit, p, fx }) => fx.growthCounter(unit, { key: SKADI_PREDATOR, label: '深海掠食者', amount: p('a'), suffix: '%' }),
    5: ({ unit, fx }) => fx.stack(unit, { key: 'tide-atk', stat: 'atk', amount: SKADI_STACK / 100, mode: 'percent' }),
  },
  modules: {
    // 往日残梦：攻击被阻挡的敌人时，攻击力提升至 115%
    [SKADI_MODULE]: ({ battle, unit }) => onOwnHit(battle, unit, 'skadi-dream', ({ target, dmg }) => { if (dmg.isAttack && target?.blockedBy) dmg.mul *= SKADI_MODULE_BLOCKED; }),
  },
});

// ------------------------------------------------------------------ 旅骨 ---
// Alchemy fields that slow, bleed and make the enemies miss; an erosion burst inside speeds your other 伊比利亚 up, kills
// inside grow the fields for the battle.

const HBOUND_DEPLOY_SECONDS = 5, HBOUND_DEPLOY_SLOW = 0.3, HBOUND_SKILL_SECONDS = 10, HBOUND_SKILL_SLOW = 0.5, HBOUND_HEAVY = 3,
  HBOUND_HASTE = 2, HBOUND_STACK = 5, HBOUND_COUNTER = 'hbound-reef', HBOUND_MODULE = 'uniequip_002_hbound';
const inHboundField = (battle, unit, x) => !!x && (unit.mem.hboundFields ?? []).some((f) => battle.time < f.until
  && Math.max(Math.abs(Math.round(x.y) - f.tile[0]), Math.abs(Math.round(x.x) - f.tile[1])) <= 1);
function hboundField(battle, unit, tile, seconds, slow, damaging, cause) {
  const field = { tile, until: battle.time + seconds };
  (unit.mem.hboundFields ??= []).push(field);
  const fx = effects(battle, unit, { index: 'skill' }, cause);
  const within = (x) => Math.max(Math.abs(Math.round(x.y) - tile[0]), Math.abs(Math.round(x.x) - tile[1])) <= 1;
  let ticks = 0;
  const timer = battle.every(1, () => {
    if (!active(unit) || battle.time > field.until + 1e-9) { timer.cancel(); return; }
    for (const e of battle.enemies.filter((x) => x.alive && !x.removed && !x.isFlying && within(x))) {
      fx.buff(e, { key: `reef-slow:${tile.join(',')}`, mods: { moveMul: 1 - slow }, duration: 1.2 });
      if (!damaging) continue;
      const more = 1 + counterValue(battle, unit, HBOUND_COUNTER) / 100;
      fx.damage(e, { scale: cardParam(unit, 1, 'a') / 100 * more, type: 'arts', isSkill: true });
      if (e.alive) fx.elementDamage(e, { element: 'erosion', amount: unit.s.atk * cardParam(unit, 1, 'b') / 100 * more });
    }
    if (++ticks >= Math.round(seconds)) timer.cancel();
  }, { owner: unit, immediate: true });
  return field;
}

const hbound = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => !!crowdTile(battle, unit),
  cast: ({ battle, unit, cause }) => {
    const tile = crowdTile(battle, unit);
    return !!(tile && hboundField(battle, unit, tile, HBOUND_SKILL_SECONDS, HBOUND_SKILL_SLOW, true, cause));
  },
  lines: {
    0: ({ battle, unit, cause }) => { const tile = crowdTile(battle, unit); if (tile) hboundField(battle, unit, tile, HBOUND_DEPLOY_SECONDS, HBOUND_DEPLOY_SLOW, false, cause); },
    1: 'cast',
    // 潜水作业：炼金单元范围内地面敌人的物理和法术命中率 -a%（重量不低于 3 的 -b%）: their hits on your units miss that often
    2: ({ battle, unit, p }) => {
      if (once(unit, 'hbound-miss')) battle.on('hit', ({ source, target, dmg }) => {
        if (!dmg || dmg.cancel || source?.side !== 'enemy' || target?.side !== 'ally' || !['phys', 'arts'].includes(dmg.type) || !active(unit) || !inHboundField(battle, unit, source) || source.isFlying) return;
        const heavy = (source.s?.massLevel ?? 0) >= HBOUND_HEAVY;
        const miss = moduleParam(unit, HBOUND_MODULE, heavy ? 'b' : 'a', p(heavy ? 'b' : 'a')) / 100;
        if (battle.rng() < miss) dmg.cancel = true;
      }, { owner: unit, priority: 85 });
    },
    3: {
      // 任一敌人在炼金单元内侵蚀损伤爆发时 (whoever caused it): the burst event itself
      install: ({ battle, unit }) => battle.assaultRuntime.observe('elementBurst', `hbound-burst:${uid(unit)}`, (event) => {
        const p = event.payload;
        if (!active(unit) || p?.target?.side !== 'enemy' || p.element !== 'erosion' || !inHboundField(battle, unit, p.target)) return;
        const fx = effects(battle, unit, { index: 3 }, event.cause);
        for (const x of fx.allies('allies:伊比利亚')) fx.accelerate(x, HBOUND_HASTE);
      }, { owner: unit }),
      run: () => {},
    },
    4: {
      options: { accept: (payload, ctx) => inHboundField(ctx.battle, ctx.unit, payload.target) },
      run: ({ unit, fx }) => fx.counter(unit, { key: HBOUND_COUNTER, label: '触礁伤害', amount: HBOUND_STACK, suffix: '%' }),
    },
  },
  modules: {
    // 看不见的大海：潜水作业提升至 14/15%，重量不低于 3 的敌人 18/20% — read by line 2
    [HBOUND_MODULE]: () => {},
  },
});

// -------------------------------------------------------------- 克莱门莎 ---
// 与海为敌 loads erosion rounds; every erosion burst spends one on a cross of blows. The defence cuts of your other
// operators charge her, their element bursts grow her for the run.

const CLEMNT_DEPLOY_EROSION = 0.35, CLEMNT_ROUNDS = 10, CLEMNT_TARGETS = 2, CLEMNT_EROSION = 0.2, CLEMNT_CROSS_HITS = 3, CLEMNT_ELEMENTAL = 2.5,
  CLEMNT_CHANCE = 0.25, CLEMNT_LOW_DEF_CHANCE = 0.5;
const clemntFront = (unit, x) => {
  const f = Array.isArray(unit.fwd) ? unit.fwd : [0, 1];
  return (x.x - unit.x) * f[1] + (x.y - unit.y) * f[0] > 0;
};

const clemnt = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    ammoSkill(battle, unit, { key: 'enemy-of-sea', count: CLEMNT_ROUNDS, cause,
      mods: { rangeExtend: 1, maxTargets: CLEMNT_TARGETS, atkScaleMul: cardParam(unit, 1, 'a') / 100 },
      onAttack: ({ targets }) => { for (const e of targets ?? []) if (e?.alive) fx.elementDamage(e, { element: 'erosion', amount: unit.s.atk * CLEMNT_EROSION }); } });
    if (once(unit, 'clemnt-cross')) battle.assaultRuntime.observe('elementBurst', `clemnt-cross:${uid(unit)}`, (event) => {
      const p = event.payload, ammo = assaultAmmoState(unit);
      if (!active(unit) || p?.target?.side !== 'enemy' || p.element !== 'erosion' || !(ammo?.current > 0)) return;
      const at = p.target;
      battle.assaultRuntime.enqueue(() => {
        if (!(assaultAmmoState(unit)?.current > 0)) return;
        consumeAssaultAmmo(battle, unit, 1, 'clemnt-cross');
        const blow = effects(battle, unit, { index: 'skill' }, event.cause);
        for (const e of battle.enemies.filter((x) => x.alive && !x.removed && !x.isFlying && withinAdjacent4(at, x))) {
          blow.damage(e, { scale: cardParam(unit, 1, 'b') / 100, type: 'phys', isSkill: true, hits: CLEMNT_CROSS_HITS });
          if (e.alive) blow.damage(e, { scale: CLEMNT_ELEMENTAL, type: 'elemental', isSkill: true });
        }
      }, { key: `clemnt-cross:${uid(unit)}:${uid(at)}`, targetUid: uid(at), cause: event.cause });
    }, { owner: unit });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => {
      const e = frontEnemy(battle, unit);
      if (!e) return;
      fx.damage(e, { scale: p('a') / 100, type: 'phys' });
      if (e.alive) fx.elementDamage(e, { element: 'erosion', amount: unit.s.atk * CLEMNT_DEPLOY_EROSION });
    },
    1: 'cast',
    2: {
      install: ({ battle, unit, p }) => onOwnHit(battle, unit, 'clemnt-verdict', ({ target, dmg }) => {
        if (dmg.type !== 'phys' || target?.side !== 'enemy') return;
        const lowered = (target.s?.def ?? 0) < (target.base?.def ?? 0) - 1e-9;
        if (battle.rng() < (lowered ? CLEMNT_LOW_DEF_CHANCE : CLEMNT_CHANCE)) dmg.mul *= p('a') / 100;
      }),
      run: () => {},
    },
    3: ({ unit, fx }) => fx.charge(unit, 1),
    4: ({ battle, unit, p }) => {
      if (once(unit, 'clemnt-guard')) battle.on('hit', ({ source, target, dmg }) => {
        if (target !== unit || !active(unit) || !dmg || !source || !clemntFront(unit, source)) return;
        dmg.mul *= 1 - (enemyTag(source, 'seamonster') ? p('b') : p('a')) / 100;
      }, { owner: unit, priority: 60 });
    },
    5: ({ unit, p, fx }) => fx.growth(unit, { key: 'enemy-of-sea', stat: 'atk', percent: p('a') / 100 }),
  },
});

// ---------------------------------------------------------------- 德·托莱多 ---
// 贵族血统 makes what is blocked in his range fragile and grows with every new block of your other operators; his
// 征服者传说 and your other operators' summons set the enemies around them trembling.

const TOLEDO_TOKEN = 'token_10067_toledo_tldptm', TOLEDO_DEPLOY_TREMBLE = 3, TOLEDO_TREMBLE = 7, TOLEDO_SUMMON_TREMBLE = 2, TOLEDO_STACK = 1,
  TOLEDO_COUNTER = 'toledo-blood', TOLEDO_MODULE = 'uniequip_002_toledo';
const toledoCells = (battle, unit) => rangeTiles(battle, unit).filter(([r, c]) => summonPlacementLegal(battle, unit, TOLEDO_TOKEN, r, c, { occupiesTile: true }));
const inOwnRange = (unit, x) => (unit.rangeKeys ?? []).includes(Math.round(x.y) * COLS + Math.round(x.x));

const toledo = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => rangeEnemies(battle, unit, 1).length > 0 && toledoCells(battle, unit).length > 0,
  cast: ({ battle, unit, cause }) => {
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const cell = toledoCells(battle, unit)[0];
    if (!cell) return false;
    const seconds = cardParam(unit, 1, 'a');
    // [ASSUMED] the 征服者传说 stays as long as 贵族血统 is doubled
    const receipt = grantSummon(battle, unit, { tokenId: TOLEDO_TOKEN, count: 1, stockCap: 1, fieldCap: 1, occupiesTile: true, replaceExisting: true,
      ruleKey: 'toledo-legend', preparedSlot: cell, preparedOnly: true, duration: seconds });
    if (!receipt.spawned) return false;
    const legend = battle.allyUnits.find((t) => t.kind === 'token' && t.ownerUnit === unit && t.defId === TOLEDO_TOKEN && active(t));
    if (legend) for (const e of battle.enemies.filter((x) => x.alive && !x.removed && around8(legend, x))) fx.status(e, { status: 'tremble', duration: TOLEDO_TREMBLE });
    fx.sustain(unit, { key: 'alarm', mods: {}, duration: seconds });
    return true;
  },
  lines: {
    0: ({ battle, unit, fx }) => { for (const e of battle.enemies.filter((x) => x.alive && !x.removed && x.blockedBy && inOwnRange(unit, x))) fx.status(e, { status: 'tremble', duration: TOLEDO_DEPLOY_TREMBLE }); },
    1: 'cast',
    2: ({ battle, unit, p }) => {
      if (!once(unit, 'toledo-blood')) return;
      battle.every(0.25, () => {
        if (!active(unit)) return;
        const x = (moduleParam(unit, TOLEDO_MODULE, 'a', p('a')) + counterValue(battle, unit, TOLEDO_COUNTER)) * (sustained(unit, 'alarm') ? 2 : 1) / 100;
        for (const e of battle.enemies) if (e.alive && !e.removed && e.blockedBy && inOwnRange(unit, e))
          battle.addBuff(e, { key: `assault:toledo:blood:${uid(unit)}`, mods: { dmgTakenMul: 1 + x }, duration: 0.6, refresh: 'replace', source: unit });
      }, { owner: unit, immediate: true });
    },
    3: ({ battle, fx, target }) => {
      if (!target) return;
      for (const e of battle.enemies.filter((x) => x.alive && !x.removed && around8(target, x))) fx.status(e, { status: 'tremble', duration: TOLEDO_SUMMON_TREMBLE });
    },
    4: ({ unit, fx }) => fx.counter(unit, { key: TOLEDO_COUNTER, label: '贵族血统脆弱', amount: TOLEDO_STACK, suffix: '%' }),
  },
  modules: {
    // 贵族义务：贵族血统的脆弱提升至 19/21% — read by line 2
    [TOLEDO_MODULE]: () => {},
  },
});

// ------------------------------------------------------------ 阿米娅（近卫）---
// 青色怒火 lifts your other operators, doubled after each deployment, after the skills of your other 罗德岛, and for good once
// her one 影霄 has fallen; the elite kills of your other operators grow it for the run.

const AMIYA2_SLASHES = 10, AMIYA2_KILL_ATK = 0.4, AMIYA2_KILL_RES = 20, AMIYA2_KILL_MAX = 3, AMIYA2_DOUBLE = 3, AMIYA2_RAGE = 'amiya2-rage', AMIYA2_MODULE = 'uniequip_002_amiya2';
const amiya2Doubled = (battle, unit) => battle.time < (unit.mem.amiya2DoubleUntil ?? -1) || !!unit.mem.amiya2Cast;
const doubleRage = (battle, unit, seconds) => { unit.mem.amiya2DoubleUntil = Math.max(unit.mem.amiya2DoubleUntil ?? -1, battle.time + seconds); };

const amiya2 = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => !unit.mem.amiya2Cast && rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    if (unit.mem.amiya2Cast) return false;
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    let kills = 0;
    for (let i = 0; i < AMIYA2_SLASHES; i++) {
      const target = rangeEnemies(battle, unit).sort((a, b) => a.hp - b.hp || uid(a).localeCompare(uid(b)))[0];
      if (!target) break;
      const last = i === AMIYA2_SLASHES - 1;
      fx.damage(target, { scale: cardParam(unit, 1, 'a') / 100 * (last ? 2 : 1), type: last || kills ? 'true' : 'arts', isSkill: true });
      if (!target.alive && kills < AMIYA2_KILL_MAX) kills++;
    }
    unit.mem.amiya2Cast = true; // 每场战斗只能施放一次
    if (kills) fx.buff(unit, { key: 'shadow', mods: { atkPct: AMIYA2_KILL_ATK * kills, resFlat: AMIYA2_KILL_RES * kills }, persist: true });
    // 之后伤害类型变为真实
    onOwnHit(battle, unit, 'amiya2-true', ({ dmg }) => { if (dmg.isAttack && unit.mem.amiya2Cast) dmg.type = 'true'; });
    return true;
  },
  lines: {
    0: ({ battle, unit, p }) => doubleRage(battle, unit, p('a')),
    1: 'cast',
    2: ({ battle, unit, p }) => liveAura(battle, unit, 'rage', {
      pick: (x) => x !== unit,
      mods: () => {
        const x = (p('a') + moduleParam(unit, AMIYA2_MODULE, 'a', 0) + runCounterValue(battle, unit, AMIYA2_RAGE)) * (amiya2Doubled(battle, unit) ? 2 : 1) / 100;
        return { atkPct: x, defPct: x };
      },
    }),
    3: ({ battle, unit }) => doubleRage(battle, unit, AMIYA2_DOUBLE),
    4: ({ unit, p, fx }) => fx.growthCounter(unit, { key: AMIYA2_RAGE, label: '青色怒火', amount: p('a'), suffix: '%' }),
  },
  modules: {
    // 待调弦的怒火：青色怒火再 +1/2% — read by line 2
    [AMIYA2_MODULE]: () => {},
  },
});

// ------------------------------------------------------------ 阿米娅（医疗）---
// 诚挚期许 grows your other operators' HP (more with every other operator's 再部署); her one 慈悲愿景 turns her into a true
// damage striker and the hope into healing.

const AMIYA3_SCALE = 2, AMIYA3_SLOW_SECONDS = 10, AMIYA3_SLOW_ASPD = -60, AMIYA3_SLOW_MOVE = 0.6, AMIYA3_HIT_ATK = 0.3, AMIYA3_HIT_MAX = 5,
  AMIYA3_TARGETS = 2, AMIYA3_STACK = 1, AMIYA3_COUNTER = 'amiya3-hope', AMIYA3_MODULE = 'uniequip_002_amiya3';

const amiya3 = (bb, raw, def) => synergyKit(def, {
  canCast: ({ battle, unit }) => !unit.mem.amiya3Cast && rangeEnemies(battle, unit, 1).length > 0,
  cast: ({ battle, unit, cause }) => {
    if (unit.mem.amiya3Cast) return false;
    const fx = effects(battle, unit, { index: 'skill' }, cause);
    const targets = rangeEnemies(battle, unit);
    for (const e of targets) {
      fx.damage(e, { scale: AMIYA3_SCALE, type: 'arts', isSkill: true });
      if (e.alive) fx.buff(e, { key: 'vision-slow', mods: { aspd: AMIYA3_SLOW_ASPD, moveMul: 1 - AMIYA3_SLOW_MOVE }, duration: AMIYA3_SLOW_SECONDS });
    }
    unit.mem.amiya3Cast = true; // 每场战斗只能施放一次
    // 之后伤害类型变为真实，可同时攻击 2 名敌人
    fx.buff(unit, { key: 'vision', mods: { atkPct: AMIYA3_HIT_ATK * Math.min(AMIYA3_HIT_MAX, targets.length), maxTargets: AMIYA3_TARGETS - 1 }, persist: true });
    onOwnHit(battle, unit, 'amiya3-true', ({ dmg }) => { if (dmg.isAttack && unit.mem.amiya3Cast) dmg.type = 'true'; });
    return true;
  },
  lines: {
    0: ({ battle, unit, p, fx }) => { for (const x of yourOps(battle, unit, (y) => around8(unit, y))) fx.heal(x, { maxHpRatio: p('a') / 100 }); },
    1: 'cast',
    2: ({ battle, unit, p }) => liveAura(battle, unit, 'hope', {
      pick: (x) => x !== unit,
      mods: () => {
        const hp = (p('a') + moduleParam(unit, AMIYA3_MODULE, 'a', 0) + counterValue(battle, unit, AMIYA3_COUNTER)) / 100;
        // [ASSUMED] 技能期间: after her one cast, for the rest of the battle
        return unit.mem.amiya3Cast ? { hpPct: hp, hpRegenRatio: (p('b') + moduleParam(unit, AMIYA3_MODULE, 'b', 0)) / 100 } : { hpPct: hp };
      },
    }),
    3: ({ p, fx, actor }) => { if (actor) fx.heal(actor, { maxHpRatio: p('a') / 100 }); },
    4: ({ unit, fx }) => fx.counter(unit, { key: AMIYA3_COUNTER, label: '诚挚期许生命上限加成', amount: AMIYA3_STACK, suffix: '%' }),
  },
  modules: {
    // 带有灼痕的裙子：诚挚期许的生命上限加成再 +1/2%，技能期间每秒回复再 +0.5/1% — read by line 2
    [AMIYA3_MODULE]: () => {},
  },
});

export const synergyAssaultKits = Object.freeze({
  char_263_skadi: skadi,
  char_4232_hbound: hbound,
  char_4231_clemnt: clemnt,
  char_393_toledo: toledo,
  char_1001_amiya2: amiya2,
  char_1037_amiya3: amiya3,
  char_4058_pepe: pepe,
  char_4116_blkkgt: blkkgt,
  char_1026_gvial2: gvial2,
  char_350_surtr: surtr,
  char_1019_siege2: siege2,
  char_188_helage: helage,
  char_1014_nearl2: nearl2,
  char_1032_excu2: excu2,
  char_4010_etlchi: etlchi,
  char_4064_mlynar: mlynar,
  char_1033_swire2: swire2,
  char_1041_angel2: angel2,
  char_474_glady: glady,
  char_437_mizuki: mizuki,
  char_1023_ghost2: ghost2,
  char_4048_doroth: doroth,
  char_1039_thorn2: thorn2,
  char_264_f12yin: f12yin,
  char_4037_demetr: demetr,
  char_4082_qiubai: qiubai,
  char_143_ghost: ghost,
  char_356_broca: broca,
  char_4155_talr: talr,
  char_173_slchan: slchan,
  char_4036_forcer: forcer,
  char_451_robin: robin,
  char_4016_kazema: kazema,
  char_4151_tinman: tinman,
  char_4191_tippi: tippi,
  char_1028_texas2: texas2,
  char_127_estell: estell,
  char_337_utage: utage,
  char_491_humus: humus,
  char_237_gravel: gravel,
  char_308_swire: swire,
  char_265_sophia: sophia,
  char_154_morgan: morgan,
  char_155_tiger: tiger,
  char_140_whitew: whitew,
  char_294_ayer: ayer,
  char_172_svrash: svrash,
  char_2024_chyue: chyue,
  char_4145_ulpia: ulpia,
});

