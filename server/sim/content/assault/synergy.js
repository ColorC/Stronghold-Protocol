// Assault synergy primitives: one declarative trigger interface over the
// native event stream, SP tools (充能 / 加速 / 技力光环), refreshable timed
// effects, granted air blocking, per-battle stacks, run-long growth, active
// redeploy and redeploy-time cuts. Only the assault content installs these.

import { active, buff, damage, haste, sp, uid, watch, persistGrowth } from './primitives.js';
import { cycleRedeploy, cycleLength } from './redeploy-cycle.js';
import { assaultAmmoState, consumeAssaultAmmo, registerAssaultAmmo, reloadAssaultAmmo, setAssaultAmmoCapacityBonus } from './ammo.js';
import { grantSummon, ledgerFor } from './summons.js';
import { roundHalfEven } from '../../detmath.js';
import { recordLinkEffect } from './adaptation-primitives.js';

const INVALID = (label) => { throw new TypeError(`assault synergy ${label} is missing or invalid`); };
const object = (x) => x && typeof x === 'object' && !Array.isArray(x);

// Native control statuses (gamedata_const terms) and their engine names.
export const CONTROL_STATUSES = Object.freeze(['tremble', 'stun', 'bind', 'sleep', 'cold', 'frozen', 'levitate', 'weightless', 'fear', 'sluggish']);
export const ELEMENTS = Object.freeze(['burn', 'apoptosis', 'neural', 'erosion', 'necrosis']);
// Statuses of the design table that are no control: 防御力降低 (native defDown), and the moves 推开 / 拖拽 (an event
// the assault content publishes when a push / pull really moves an enemy — events.js; no lasting state)
export const OTHER_STATUSES = Object.freeze(['defDown', 'push', 'pull']);
const STATUS_ALIAS = Object.freeze({
  战栗: 'tremble', 晕眩: 'stun', 束缚: 'bind', 沉睡: 'sleep', 寒冷: 'cold', 冻结: 'frozen', freeze: 'frozen',
  浮空: 'levitate', 失重: 'weightless', 恐惧: 'fear', 停顿: 'sluggish', pause: 'sluggish', 被阻挡: 'blocked', 通缉: 'wanted',
  防御降低: 'defDown', 防御力降低: 'defDown', 推开: 'push', 拖拽: 'pull',
});
const ELEMENT_ALIAS = Object.freeze({ 灼燃: 'burn', 凋亡: 'apoptosis', 神经: 'neural', 侵蚀: 'erosion', 坏死: 'necrosis' });
// statuses whose flag may also come from a non-status buff (content kits set the same flag)
const STATUS_FLAG = Object.freeze({ tremble: 'tremble', bind: 'bind', sleep: 'sleep', cold: 'cold', frozen: 'freeze', levitate: 'levitate', fear: 'fear', weightless: 'float' });

export function statusName(x) {
  const name = STATUS_ALIAS[x] ?? x;
  if (name === 'blocked' || name === 'wanted' || CONTROL_STATUSES.includes(name) || OTHER_STATUSES.includes(name)) return name;
  const element = ELEMENT_ALIAS[x] ?? x;
  if (ELEMENTS.includes(element)) return element;
  const burst = typeof x === 'string' && x.endsWith('Burst') ? x.slice(0, -5) : null;
  if (burst && ELEMENTS.includes(ELEMENT_ALIAS[burst] ?? burst)) return `${ELEMENT_ALIAS[burst] ?? burst}Burst`;
  throw new TypeError(`unknown assault status ${x}`);
}

const nativeStatus = (name) => (name === 'frozen' ? 'freeze' : name);
export const knownStatus = (x) => { try { return statusName(x === 'freeze' ? 'frozen' : x); } catch { return null; } };

/** Does `unit` carry status X now? Elements: 「X 损伤」 = a non-empty gauge; `${el}Burst` = in its burst. */
export function hasStatus(unit, x) {
  if (!unit) return false;
  const name = statusName(x);
  if (name === 'blocked') return !!unit.blockedBy;
  if (name === 'wanted') return isWanted(unit);
  if (name === 'push' || name === 'pull') return false; // a move, not a state
  // 防御力降低: the native defDown status, or any buff that lowers its defence
  if (name === 'defDown') return (unit.buffs ?? []).some((b) => b.status === 'defDown'
    || (b.mods && ((b.mods.defMul != null && b.mods.defMul < 1) || b.mods.defPct < 0 || b.mods.defFlat < 0)));
  if (ELEMENTS.includes(name)) return Number(unit.elem?.[name] ?? 0) > 0;
  const native = nativeStatus(name);
  if ((unit.buffs ?? []).some((b) => b.status === native)) return true;
  const flag = STATUS_FLAG[name];
  return !!(flag && unit.s?.flags?.[flag]);
}

function bodyOrNull(unit) { return unit?.def?.raw?.assaultBody ?? unit?.def?.assaultBody ?? null; }

/** 职业 / 分支 / 阵营 of a unit (operators only: summons and devices have none). */
export function classOf(unit) {
  const body = bodyOrNull(unit);
  return {
    profession: body?.profession ?? unit?.def?.profession ?? null,
    subProfession: body?.subProfessionId ?? unit?.def?.subProfessionId ?? null,
    nation: body?.nationId ?? unit?.def?.nationId ?? null,
    group: body?.groupId ?? null,
    team: body?.teamId ?? null,
    // the card's own words for its classes (职业 · 分支 · 阵营 · 小队 / 势力, 「炎-岁」 also as 「岁」): what 「你的某类干员」 names
    label: body?.bazaar?.labels ?? [],
  };
}

/** Class filter: every given key must match (a list matches any of its entries). */
export function matchesClass(unit, filter) {
  if (filter == null) return true;
  if (!object(filter)) INVALID('class filter');
  const own = classOf(unit);
  for (const [key, want] of Object.entries(filter)) {
    if (!(key in own)) throw new TypeError(`unknown assault class filter ${key}`);
    const list = Array.isArray(want) ? want : [want];
    if (key === 'label' ? !list.some((name) => own.label.includes(name)) : !list.includes(own[key])) return false;
  }
  return true;
}

/**
 * Relation of event subject `x` to watcher `unit` (who may set a trigger off):
 *   other    your other units (default: triggers are set off by the rest of the team)
 *   self     the watcher itself (self-triggers are rare and need a native precedent)
 *   adjacent your other units on the watcher's tile or the four around it
 *   yours    your units, the watcher included
 *   ally / enemy / any
 * Devices never count as operators here.
 */
export const RELATIONS = Object.freeze(['other', 'self', 'adjacent', 'yours', 'ally', 'enemy', 'any']);
export function relates(unit, x, by) {
  if (!RELATIONS.includes(by)) throw new TypeError(`unknown assault trigger relation ${by}`);
  if (!x) return by === 'any';
  const yours = x.side === 'ally' && x.kind !== 'device' && x.ownerId === unit.ownerId;
  switch (by) {
    case 'self': return x === unit;
    case 'other': return yours && x !== unit;
    case 'adjacent': return yours && x !== unit && withinAdjacent4(unit, x);
    case 'yours': return yours;
    case 'ally': return x.side === 'ally' && x.kind !== 'device';
    case 'enemy': return x.side === 'enemy';
    default: return true;
  }
}

/** 光环 targets: your operators on the field, the source included or not, optionally by class / adjacency. */
export function auraTargets(battle, unit, { includeSelf = true, filter = null, adjacentOnly = false } = {}) {
  return battle.allyUnits.filter((x) => x.kind === 'op' && active(x) && relates(unit, x, includeSelf ? 'yours' : 'other')
    && (!adjacentOnly || withinAdjacent4(unit, x)) && matchesClass(x, filter));
}

function tileOf(x) {
  return [Number.isFinite(x?.tileR) && x.side === 'ally' ? x.tileR : roundHalfEven(x?.y), Number.isFinite(x?.tileC) && x.side === 'ally' ? x.tileC : roundHalfEven(x?.x)];
}

/** 周围四格: the own tile and its four neighbours. */
export function withinAdjacent4(anchor, x) {
  const [ar, ac] = tileOf(anchor), [r, c] = tileOf(x);
  return Math.abs(ar - r) + Math.abs(ac - c) <= 1;
}

/**
 * Rate limits for high-frequency triggers: `cooldown` = at most once per n seconds; `perBattle` = only the first n
 * times in this battle. Both may be given. Returns `take()` → true when this firing is allowed (and counts it).
 */
export function limiter(battle, { cooldown = null, perBattle = null } = {}) {
  if (cooldown != null && !(Number.isFinite(cooldown) && cooldown > 0)) INVALID('trigger cooldown');
  if (perBattle != null && !(Number.isInteger(perBattle) && perBattle > 0)) INVALID('trigger perBattle');
  let last = -Infinity, count = 0;
  return () => {
    if (perBattle != null && count >= perBattle) return false;
    if (cooldown != null && battle.time + 1e-9 < last + cooldown) return false;
    last = battle.time;
    count++;
    return true;
  };
}

const statusList = (status) => (status == null ? null : (Array.isArray(status) ? status : [status]).map(statusName));
const elementList = (element) => (element == null ? null : (Array.isArray(element) ? element : [element]).map((e) => {
  const name = ELEMENT_ALIAS[e] ?? e;
  if (!ELEMENTS.includes(name)) throw new TypeError(`unknown assault element ${e}`);
  return name;
}));
const anyStatus = (unit, list) => list.some((s) => hasStatus(unit, s));

/**
 * The trigger kinds (卡面句式 → event):
 *   inflict        你的干员使敌人 X 时（status: 控制状态；element: 造成 X 损伤）   statusApplied / elementDamage
 *   attackStatus   攻击 X 状态的敌人时（含 X = 被阻挡）                         attack
 *   statusDamaged  X 状态的敌人受到伤害时                                       hit
 *   burst          任一敌人 X 损伤爆发时                                         elementBurst
 *   nearbyDeath    周围四格内有敌人倒下时                                       death
 *   block          阻挡敌人时                                                   blocked
 *   deploy         部署或再部署时                                               deployed
 *   summon         召唤物部署时                                                 summonSpawned
 *   skill          施放技能时                                                   skillStart
 *   heal           回复干员生命时                                               heal
 *   barrierGained  获得屏障时                                                   shieldGained
 *   barrierBroken  屏障破裂时                                                   shieldBroken
 *   attacked       受到攻击时                                                   hit
 *   kill           击倒敌人时                                                   kill
 * `by` = whose action counts (relates; default `other`), `filter` = class of that unit, `limit` = { cooldown, perBattle }.
 * Each trigger fires at most TRIGGER_FRAME_LIMIT times in one battle tick (a hard stop for chains, not a balance cap).
 * The handler gets { battle, unit, event, payload, source, target, targets, cause }.
 */
// every kind defaults to `other`: the rest of your team sets it off (user rule 10-21)
const KINDS = Object.freeze(Object.fromEntries(['inflict', 'attackStatus', 'statusDamaged', 'burst', 'nearbyDeath', 'block', 'deploy', 'summon', 'skill', 'heal', 'barrierGained', 'barrierBroken', 'attacked', 'kill'].map((kind) => [kind, { by: 'other' }])));
export const TRIGGER_KINDS = Object.freeze(Object.keys(KINDS));
export const TRIGGER_FRAME_LIMIT = 64;

export function onTrigger(battle, unit, spec, handler) {
  if (!object(spec) || typeof handler !== 'function') INVALID('trigger spec');
  const { on, key, status = null, element = null, filter = null, limit = null } = spec;
  if (!KINDS[on]) throw new TypeError(`unknown assault trigger ${on}`);
  if (typeof key !== 'string' || !key) INVALID('trigger key');
  const by = spec.by ?? KINDS[on].by;
  relates(unit, unit, by); // validates the relation name
  const statuses = statusList(status);
  const elements = elementList(element);
  const take = limit ? limiter(battle, limit) : () => true;
  const mine = (x) => relates(unit, x, by) && (filter == null || matchesClass(x, filter));
  const enemy = (x) => x?.side === 'enemy';
  let frameTime = null, frameCount = 0;
  const fire = (ctx, extra = {}) => {
    if (frameTime !== battle.time) { frameTime = battle.time; frameCount = 0; }
    if (frameCount >= TRIGGER_FRAME_LIMIT) {
      const d = battle.assaultRuntime.diagnostics;
      d.triggerFrameRefused = (d.triggerFrameRefused ?? 0) + 1;
      return;
    }
    if (!take()) return;
    frameCount++;
    handler({ ...ctx, source: ctx.payload?.source ?? null, target: ctx.payload?.target ?? null, ...extra });
  };
  const w = (type, predicate, run = fire) => watch(battle, unit, type, `trigger:${on}:${key}`, predicate, run);
  switch (on) {
    case 'inflict':
      if (elements) return w('elementDamage', ({ payload }) => enemy(payload.target) && mine(payload.source) && elements.includes(payload.element));
      if (!statuses) INVALID('inflict status or element');
      return w('statusApplied', ({ payload }) => enemy(payload.target) && mine(payload.source) && statuses.includes(knownStatus(payload.status)));
    case 'attackStatus':
      if (!statuses && !elements) INVALID('attackStatus status');
      return w('attack', ({ payload }) => mine(payload.source) && (payload.targets ?? []).some((t) => enemy(t) && anyStatus(t, [...(statuses ?? []), ...(elements ?? [])])),
        (ctx) => fire(ctx, { targets: ctx.payload.targets.filter((t) => enemy(t) && anyStatus(t, [...(statuses ?? []), ...(elements ?? [])])) }));
    case 'statusDamaged':
      if (!statuses && !elements) INVALID('statusDamaged status');
      return w('hit', ({ payload }) => enemy(payload.target) && mine(payload.source) && anyStatus(payload.target, [...(statuses ?? []), ...(elements ?? [])]));
    case 'burst':
      return w('elementBurst', ({ payload }) => enemy(payload.target) && mine(payload.source) && (!elements || elements.includes(payload.element)));
    case 'nearbyDeath':
      return w('death', ({ payload }) => enemy(payload.target) && payload.reason === 'killed' && mine(payload.source) && withinAdjacent4(unit, payload.target));
    case 'block':
      return w('blocked', ({ payload }) => mine(payload.source) && enemy(payload.target));
    case 'deploy':
      return w('deployed', ({ payload }) => mine(payload.target) && payload.target?.kind === 'op');
    case 'summon':
      return w('summonSpawned', ({ payload }) => mine(payload.source ?? payload.target?.ownerUnit));
    case 'skill':
      return w('skillStart', ({ payload }) => mine(payload.source));
    case 'heal':
      return w('heal', ({ payload }) => mine(payload.source) && payload.target?.side === 'ally');
    case 'barrierGained':
      return w('shieldGained', ({ payload }) => mine(payload.target));
    case 'barrierBroken':
      return w('shieldBroken', ({ payload }) => mine(payload.target));
    case 'attacked':
      return w('hit', ({ payload }) => mine(payload.target) && enemy(payload.source));
    case 'kill':
      return w('kill', ({ payload }) => mine(payload.source) && enemy(payload.target));
    default:
      throw new TypeError(`unhandled assault trigger ${on}`);
  }
}

// ---------------------------------------------------------------- 技力 ---

/** 充能 n: gain n SP now. */
export function charge(battle, unit, target, amount, key, cause) {
  return sp(battle, unit, target, amount, 'assault-charge', `charge:${key}`, cause);
}

/** 加速 t 秒: natural SP recovery doubled; all applications add duration. */
export function accelerate(battle, unit, target, seconds, key, cause) {
  return haste(battle, unit, target, seconds, key, { cause });
}

/** 技力光环: natural SP recovery +x/s while it lasts (Infinity: for the battle). */
export function spAura(battle, unit, target, perSecond, key, { duration = Infinity, cause } = {}) {
  if (!Number.isFinite(perSecond) || perSecond <= 0 || typeof key !== 'string' || !key) INVALID('SP aura');
  return buff(battle, unit, target, { key: `assault:spAura:${key}`, mods: { spRecoveryFlat: perSecond }, duration, stacking: 'replace', notify: false, cause });
}

// ------------------------------------------------------------- 快发 ---

/**
 * A timed skill effect that a recast refreshes (re-sets its full time) instead of stacking — 「持续中可以重复发起」.
 * `stack: true` (the card says 可叠加) stacks instead, up to `maxStacks`.
 */
export function sustain(battle, unit, target, { key, mods, flags = null, duration, stack = false, maxStacks = 1, cause } = {}) {
  if (!Number.isFinite(duration) || duration <= 0) INVALID('sustain duration');
  return buff(battle, unit, target, { key: `assault:sustain:${key}`, mods: mods ?? {}, flags, duration,
    stacking: stack ? 'stack' : 'replace', maxStacks: stack ? maxStacks : 1, cause });
}

// ----------------------------------------------------------- 阻挡空中 ---

const AIR_BLOCK = 'assault:airBlock:';

/** Give `target` 「可阻挡空中敌人」 for `duration` (Infinity: until it leaves the field). */
export function grantAirBlock(battle, unit, target, { key, duration = Infinity, cause } = {}) {
  if (typeof key !== 'string' || !key) INVALID('air block key');
  const entry = buff(battle, unit, target, { key: `${AIR_BLOCK}${key}`, mods: {}, flags: { blockFly: true }, duration, stacking: 'replace', cause });
  if (entry) entry.data = { ...(entry.data ?? {}), assaultAirBlock: true };
  return entry;
}

/**
 * 光环：「你的某类干员可以阻挡空中敌人」 while `unit` is on the field — `filter` = { profession | subProfession | nation |
 * group | team | label } (lists allowed). Kept in sync every 0.25 s and at every deployment; ends when the source
 * leaves. The conditions of the support cards:
 *   after   seconds the source has been on the field since its last real deployment (凛御银灰「在场 15 秒后」)
 *   until   battle time the grant ends (耀骑士临光「部署或再部署后 t 秒内」: call again at each deployment)
 *   when    (unit) => the source's own state allows it now (斥罪「拥有来自自身的屏障时」: hasOwnBarrier)
 *   where   (x) => the recipient's place allows it now (号角「照明区域内」: (x) => inZone(battle, x, 'flare'))
 * A later call with the same key updates these conditions (it never registers twice).
 */
export function airBlockAura(battle, unit, { key, filter, includeSelf = true, after = 0, until = null, when = null, where = null } = {}) {
  if (typeof key !== 'string' || !key || !object(filter)) INVALID('air block aura');
  const auraKey = `aura:${uid(unit)}:${key}`;
  const buffKey = `${AIR_BLOCK}${auraKey}`;
  const registry = unit.mem.assaultAuras ??= {};
  const known = registry[auraKey];
  if (known) { Object.assign(known.conditions, { after, until, when, where }); known.sync(); return known; }
  const conditions = { after, until, when, where };
  const holders = new Set();
  const eligible = (x) => x?.kind === 'op' && active(x) && relates(unit, x, includeSelf ? 'yours' : 'other') && matchesClass(x, filter)
    && (!conditions.where || conditions.where(x));
  const sync = () => {
    const c = conditions;
    const on = active(unit) && battle.time + 1e-9 >= (unit.deployedAt ?? 0) + (c.after ?? 0)
      && (c.until == null || battle.time < c.until) && (!c.when || c.when(unit));
    const want = new Set(on ? battle.allyUnits.filter(eligible) : []);
    for (const x of [...holders]) if (!want.has(x)) { if (x.buffs?.some((b) => b.key === buffKey)) battle.removeBuff(x, buffKey); holders.delete(x); }
    for (const x of want) if (!x.buffs?.some((b) => b.key === buffKey)) { grantAirBlock(battle, unit, x, { key: auraKey }); holders.add(x); }
  };
  battle.every(AURA_TICK, sync, { owner: unit, immediate: true });
  battle.on('deploy', () => sync(), { owner: unit });
  battle.on('death', ({ unit: gone }) => { if (gone === unit || holders.has(gone)) sync(); }, { owner: unit });
  battle.assaultRuntime.observe('deployed', `airBlockAura:${uid(unit)}:${key}`, () => sync(), { owner: unit });
  const state = { conditions, holders, sync };
  registry[auraKey] = state;
  sync();
  return state;
}

/** 拥有来自自身的屏障 (a barrier — shield buff — this unit gave itself). */
export const hasOwnBarrier = (unit) => !!unit?.buffs?.some((b) => b.source === unit && Number(b.shield) > 0);

// ----------------------------------------------------------------- 光环 ---

const AURA_TICK = 0.25;

/**
 * 光环：「你的（其他 / 某类 / 周围）干员 …」 while `unit` is on the field: `select(x)` picks your operators (default: the
 * other ones), each gets the buff `mods` / `flags`; one that stops matching, or every one when the source leaves, loses
 * it. Kept in sync every 0.25 s and at every deployment (later deployments are covered). Returns { sync, holders }.
 */
export function allyAura(battle, unit, { key, mods = {}, flags = null, select = (x) => relates(unit, x, 'other') } = {}) {
  if (typeof key !== 'string' || !key || typeof select !== 'function') INVALID('ally aura');
  const buffKey = `assault:allyAura:${uid(unit)}:${key}`;
  const known = (unit.mem.assaultAuras ??= {})[buffKey];
  if (known) { known.sync(); return known; }
  const holders = new Set();
  const recordLink=battle.assaultLinkInstaller===unit;
  const sync = () => {
    const want = new Set(active(unit) ? battle.allyUnits.filter((x) => x.kind === 'op' && active(x) && relates(unit, x, 'yours') && select(x)) : []);
    for (const x of [...holders]) if (!want.has(x) || !active(x)) { if (x.buffs?.some((b) => b.key === buffKey)) battle.removeBuff(x, buffKey); holders.delete(x); }
    for (const x of want) if (!x.buffs?.some((b) => b.key === buffKey)) { const applied=buff(battle, unit, x, { key: buffKey, mods, flags, duration: Infinity, stacking: 'replace', notify: false }); holders.add(x); if(recordLink)recordLinkEffect(battle,unit,key,x,!!applied); }
  };
  battle.every(AURA_TICK, sync, { owner: unit, immediate: true });
  battle.on('deploy', () => sync(), { owner: unit });
  battle.assaultRuntime.observe('deployed', `allyAura:${uid(unit)}:${key}`, () => sync(), { owner: unit });
  sync();
  return (unit.mem.assaultAuras[buffKey] = { sync, holders });
}

/**
 * 光环：「攻击范围内（或 select 选中）的敌人 …」 while `unit` is on the field: matching enemies carry a short buff
 * refreshed every 0.25 s, so it falls off soon after an enemy leaves or the source goes.
 */
export function enemyAura(battle, unit, { key, mods = {}, flags = null, select } = {}) {
  if (typeof key !== 'string' || !key || typeof select !== 'function') INVALID('enemy aura');
  const buffKey = `assault:enemyAura:${uid(unit)}:${key}`;
  const known = (unit.mem.assaultAuras ??= {})[buffKey];
  if (known) { known.sync(); return known; }
  const recordLink=battle.assaultLinkInstaller===unit,holders=new Set();
  const sync = () => {
    if (!active(unit)) {holders.clear();return;}
    const wanted=new Set(battle.enemies.filter(e=>e.alive&&!e.removed&&select(e)));
    for(const e of holders)if(!wanted.has(e))holders.delete(e);
    for (const e of wanted){
      const applied=battle.addBuff(e, { key: buffKey, mods, flags, duration: AURA_TICK * 2 + 1e-6, refresh: 'replace', source: unit });
      if(recordLink&&!holders.has(e))recordLinkEffect(battle,unit,key,e,!!applied);holders.add(e);
    }
  };
  battle.every(AURA_TICK, sync, { owner: unit, immediate: true });
  sync();
  return (unit.mem.assaultAuras[buffKey] = { sync });
}

/** Can `unit` block flyers now, and why: 'liftoff' (原作起飞) | 'granted' | 'native' | null. */
export function airBlockSource(unit) {
  if (unit?.s?.flags?.liftoff) return 'liftoff';
  if ((unit?.buffs ?? []).some((b) => String(b.key).startsWith(AIR_BLOCK))) return 'granted';
  if (unit?.s?.flags?.blockFly || unit?.profile?.blockFly) return 'native';
  return null;
}

// ------------------------------------------------------- 本场 / 本局 累加 ---

/**
 * 本场叠加:「每次 X 时，本场内某属性 +x，可无限叠加」 — a persistent (survives retreat / redeploy) battle buff with no
 * stack cap; the battle ledger keeps the total per unit for the card (`battle.assaultBattleStacks`).
 */
// stat × mode → buff mod: flat points; percent = 「+x%」 added to the unit's other percentages (atkPct …), or the
// multiplier where the engine has no additive percentage (法术抗性, 技力回复)
const STACK_MODS = Object.freeze({
  flat: { atk: 'atkFlat', def: 'defFlat', maxHp: 'hpFlat', res: 'resFlat', aspd: 'aspd', blockCnt: 'blockCnt', spRecovery: 'spRecoveryFlat' },
  percent: { atk: 'atkPct', def: 'defPct', maxHp: 'hpPct', res: 'resMul', spRecovery: 'spRecoveryMul' },
});
const MUL_STACK = new Set(['resMul', 'spRecoveryMul']);

export function battleStack(battle, unit, target, { key, stat, amount, mode = 'flat', accumulate = true, cause } = {}) {
  if (typeof key !== 'string' || !key || typeof stat !== 'string' || !Number.isFinite(amount) || amount === 0) INVALID('battle stack');
  const modKey = STACK_MODS[mode]?.[stat];
  if (!modKey) throw new TypeError(`assault battle stack has no ${mode} ${stat}`);
  if(!accumulate)return buff(battle,unit,target,{key:`assault:battleStack:${key}:${stat}:${mode}`,
    mods:{[modKey]:MUL_STACK.has(modKey)?1+amount:amount},duration:Infinity,stacking:'replace',persist:true,cause});
  const ledger = battle.assaultBattleStacks ??= {};
  const entry = (ledger[uid(target)] ??= {})[`${key}:${stat}:${mode}`] ??= { key, stat, mode, amount: 0, stacks: 0 };
  entry.amount += amount;
  entry.stacks += 1;
  const mods = { [modKey]: MUL_STACK.has(modKey) ? 1 + entry.amount : entry.amount };
  return buff(battle, unit, target, { key: `assault:battleStack:${key}:${stat}:${mode}`, mods, duration: Infinity, stacking: 'replace', persist: true, cause });
}

/**
 * 卡内本场叠加 (battleCounter): a card's own 本场 number that is no unit stat — 「本场战斗止戈伤害加成 +3%，不封顶」.
 * Adds `amount` to the counter `key` of `target` and returns the new total (the card reads it with counterValue).
 * The battle ledger shows it on the detail card's 累计增益 as 「本场 · <label>」: `label` is the interface text (a
 * msgid in public/i18n, shown through t()), `suffix` '%' or ''.
 */
export function battleCounter(battle, unit, target, { key, label, amount, suffix = '', cause } = {}) {
  if (typeof key !== 'string' || !key || typeof label !== 'string' || !label || !Number.isFinite(amount) || amount === 0) INVALID('battle counter');
  const ledger = battle.assaultBattleStacks ??= {};
  const entry = (ledger[uid(target)] ??= {})[`counter:${key}`] ??= { key, stat: 'counter', mode: 'counter', label, suffix, amount: 0, stacks: 0 };
  entry.amount += amount;
  entry.stacks += 1;
  battle.assaultRuntime.publish('counterChanged', { source: unit, sourceUid: uid(unit), target, targetUid: uid(target), key, amount: entry.amount },
    { cause: cause ?? battle.assaultRuntime.currentCause });
  return entry.amount;
}
/** The current total of a battleCounter (0 before its first stack). */
export const counterValue = (battle, target, key) => battle.assaultBattleStacks?.[uid(target)]?.[`counter:${key}`]?.amount ?? 0;

/**
 * 卡内本局永久成长 (runCounter): 「本局内永久，没有上限」 for a card's own number that is no unit stat — 「弱肉强食攻击力
 * +3%」. The run keeps it in piece.permanentCounters[key] = { label, suffix, amount } (settled like permanentFlat: summed
 * when stars merge, gone when the piece is sold, 0 for a save without it); the detail card lists it under 本局已成长 as
 * <label> +N (label: an interface msgid shown through t(), registered in public/js/assault/model.js COUNTER_LABELS).
 * Returns runCounterValue after the gain.
 */
export function runCounter(battle, unit, target, { key, label, amount, suffix = '', cause } = {}) {
  if (typeof key !== 'string' || !key || typeof label !== 'string' || !label || !Number.isFinite(amount) || amount === 0) INVALID('run counter');
  const pieceUid = target?.def?.raw?.assaultPiece?.uid ?? uid(target);
  const list = battle.assaultPermanentEffects ??= [];
  const effectKey = `counter:${pieceUid}:${key}`;
  const found = list.find((x) => x.uid === uid(target) && x.effectKey === effectKey);
  if (found) found.amount += amount;
  else list.push({ uid: uid(target), sourceUid: uid(unit), effectKey, stat: 'counter', mode: 'counter', counterKey: key, label, suffix, amount });
  battle.assaultRuntime.publish('counterChanged', { source: unit, sourceUid: uid(unit), target, targetUid: uid(target), key, run: true,
    amount: runCounterValue(battle, target, key) }, { cause: cause ?? battle.assaultRuntime.currentCause });
  return runCounterValue(battle, target, key);
}
/** A runCounter's total: what earlier battles of the run kept on the piece plus this battle's gains. */
export function runCounterValue(battle, target, key) {
  const before = Number(target?.def?.raw?.assaultPiece?.permanentCounters?.[key]?.amount ?? 0) || 0;
  const now = (battle.assaultPermanentEffects ?? []).filter((x) => x.uid === uid(target) && x.mode === 'counter' && x.counterKey === key)
    .reduce((sum, x) => sum + x.amount, 0);
  return before + now;
}

/**
 * 本局永久成长: the run keeps it (piece.permanentFlat / permanentPercentSources), no cap, summed when stars merge,
 * gone when the piece is sold. Each piece keeps its own source key so a merge sums two copies' percent growth.
 */
export function runGrowth(battle, unit, target, { key, stat, flat = 0, percent = 0, now = true, cause } = {}) {
  if (typeof key !== 'string' || !key) INVALID('growth key');
  const pieceUid = target?.input_piece?.uid ?? target?.def?.raw?.assaultPiece?.uid ?? uid(target);
  const recorded = persistGrowth(battle, unit, target, { stat, flat, percent, counterKey: `growth:${pieceUid}:${key}` });
  // 「本局内永久」 starts now: this battle carries the growth as a persistent buff (the piece's permanent maps take
  // over from the next battle on, so nothing is counted twice)
  if (recorded && now) {
    for (const [mode, amount] of [['flat', flat], ['percent', percent]]) {
      if (!amount) continue;
      const modKey = STACK_MODS[mode]?.[stat];
      if (!modKey) throw new TypeError(`assault run growth has no ${mode} ${stat}`);
      const ledger = (battle.assaultRunGrowth ??= {})[uid(target)] ??= {};
      ledger[`${stat}:${mode}`] = (ledger[`${stat}:${mode}`] ?? 0) + amount;
      const total = ledger[`${stat}:${mode}`];
      buff(battle, unit, target, { key: `assault:runGrowth:${stat}:${mode}`, mods: { [modKey]: MUL_STACK.has(modKey) ? 1 + total : total },
        duration: Infinity, stacking: 'replace', persist: true, notify: false, cause });
    }
  }
  return recorded;
}

// ------------------------------------------------------ 技能 / 生命 / 元素 ---

/** 立即发动技能 (castSkill): `target` casts its skill now, free — no SP spent, charges and timers untouched. */
export function castSkill(battle, unit, target, { cause } = {}) {
  if (!target || !active(target) || !target.skill || target.skill.noSkill || target.skill.kind === 'passive') return false;
  const runtime = battle.assaultRuntime;
  return runtime.cast(target, { extra: true, force: true, suppressRedeploy: true, cause: cause ?? runtime.currentCause });
}

/**
 * 流失生命 (loseHp): `currentPct` of the current or `maxPct` of the maximum HP (or a flat `amount`) is lost — not damage:
 * no hit, no damage-taken event, never below 1 HP. Publishes `hpLost` (source = the cause, target = who lost it).
 */
export function loseHp(battle, unit, target, { currentPct = 0, maxPct = 0, amount = 0, cause } = {}) {
  if (![currentPct, maxPct, amount].every((x) => Number.isFinite(x) && x >= 0) || !(currentPct || maxPct || amount)) INVALID('hp loss');
  if (!active(target)) return 0;
  const want = target.hp * currentPct + target.s.maxHp * maxPct + amount;
  const lost = Math.max(0, Math.min(target.hp - 1, want));
  if (!(lost > 0)) return 0;
  target.hp -= lost;
  battle.assaultRuntime.publish('hpLost', { source: unit, sourceUid: uid(unit), target, targetUid: uid(target), amount: lost },
    { cause: cause ?? battle.assaultRuntime.currentCause });
  return lost;
}

/** 附加 X 损伤 (elementDamage): `amount` of an element gauge (灼燃 / 凋亡 / 神经 / 侵蚀) on `target`; a full gauge bursts natively. */
export function elementDamage(battle, unit, target, { element, amount, cause } = {}) {
  const name = ELEMENT_ALIAS[element] ?? element;
  if (!ELEMENTS.includes(name) || !Number.isFinite(amount) || amount <= 0) INVALID('element damage');
  return damage(battle, unit, target, { amount, type: 'element', element: name, cause });
}

// ------------------------------------------------------------------ 通缉 ---

export const WANTED_KEY = 'assault:wanted';
/** 被通缉的敌人 (lasts until it falls). */
export const isWanted = (unit) => !!unit?.buffs?.some((b) => b.key === WANTED_KEY);
/**
 * 通缉 (wanted): `target` is wanted until it falls — a mark other cards read (isWanted / hasStatus(e, '通缉')) and
 * an event: statusApplied with status 'wanted', so 「你的干员使敌人通缉时」 binds like any other status.
 */
export function markWanted(battle, unit, target, { cause } = {}) {
  if (target?.side !== 'enemy' || !target.alive || isWanted(target)) return false;
  battle.addBuff(target, { key: WANTED_KEY, mods: {}, duration: Infinity, source: unit, visible: true, data: { assaultWanted: true, ownerUid: uid(unit) } });
  battle.assaultRuntime.publish('statusApplied', { source: unit, sourceUid: uid(unit), target, targetUid: uid(target), status: 'wanted',
    nativeStatus: null, applied: true, amount: 1, sourceClass: 'status' }, { cause: cause ?? battle.assaultRuntime.currentCause });
  return true;
}

// ------------------------------------------------------------------ 区域 ---
// A zone is a set of tiles for a time: enemies on it get `enemy` buff mods / flags, your operators on it get `ally`
// ones, kept in sync every 0.25 s (a unit that steps off loses them within that). Kinds the design names:
//   flare   照明区域 (号角)：区域内敌人隐匿失效；also a place condition (airBlockAura where: inZone(…, 'flare'))
//   seed    播种 (黍)：站在地块上的干员每秒回复生命、获得庇护
//   sentry  影哨 (伊内丝)：保留放下时攻击范围的隐匿失效与减速；收回 = removeZone (the recall damage is the card's)

const zoneTile = (x) => (x?.side === 'ally' && Number.isFinite(x.tileR) ? `${x.tileR},${x.tileC}` : `${roundHalfEven(x?.y)},${roundHalfEven(x?.x)}`);
const zonesOf = (battle) => (battle.assaultZones ??= new Map());

/**
 * Place (or replace, same key) a zone: { key, kind, tiles: [[r, c], …], duration (s, Infinity), enemy: { mods, flags },
 * ally: { mods, flags }, by: which of your units count as allies on it ('yours' default) }. Returns the zone.
 */
export function placeZone(battle, unit, { key, kind, tiles, duration = Infinity, enemy = null, ally = null, by = 'yours' } = {}) {
  if (typeof key !== 'string' || !key || typeof kind !== 'string' || !Array.isArray(tiles) || !tiles.length) INVALID('zone');
  if (!(duration > 0)) INVALID('zone duration');
  const zones = zonesOf(battle);
  const id = `${uid(unit)}:${key}`;
  const zone = { id, kind, owner: unit, tiles: new Set(tiles.map(([r, c]) => `${r},${c}`)), until: battle.time + duration, enemy, ally, by };
  zones.set(id, zone);
  if (!battle.assaultZoneTimer) {
    const sync = () => {
      for (const [zid, z] of zones) {
        if (battle.time >= z.until) { zones.delete(zid); continue; }
        const life = Math.min(AURA_TICK * 2 + 1e-6, z.until - battle.time);
        if (z.enemy) for (const e of battle.enemies) if (e.alive && !e.removed && z.tiles.has(zoneTile(e)))
          battle.addBuff(e, { key: `assault:zone:${zid}`, mods: z.enemy.mods ?? {}, flags: z.enemy.flags ?? null, duration: life, refresh: 'replace', source: z.owner });
        if (z.ally) for (const x of battle.allyUnits) if (x.kind === 'op' && active(x) && relates(z.owner, x, z.by) && z.tiles.has(zoneTile(x)))
          battle.addBuff(x, { key: `assault:zone:${zid}`, mods: z.ally.mods ?? {}, flags: z.ally.flags ?? null, duration: life, refresh: 'replace', source: z.owner });
      }
    };
    battle.assaultZoneTimer = battle.every(AURA_TICK, sync, { immediate: true });
    battle.assaultZoneSync = sync;
  }
  battle.assaultZoneSync();
  return zone;
}

/** Remove a zone now (影哨 收回); its buffs fall off within 0.5 s. */
export function removeZone(battle, unit, key) {
  return zonesOf(battle).delete(`${uid(unit)}:${key}`);
}

/** Is `x` (an enemy or an operator) on a live zone of `kind` (of `owner`, when given) now? */
export function inZone(battle, x, kind, owner = null) {
  const at = zoneTile(x);
  for (const z of zonesOf(battle).values()) if (z.kind === kind && battle.time < z.until && (!owner || z.owner === owner) && z.tiles.has(at)) return true;
  return false;
}

/** Tiles within `radius` (Chebyshev: 1 = the 3×3 around) of [r, c], inside the field. */
export function tilesAround(battle, [r, c], radius = 1) {
  const out = [];
  for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) if (battle.grid.inRect(r + dr, c + dc)) out.push([r + dr, c + dc]);
  return out;
}

/** 照明区域 (flareZone): around [r, c] for `duration` s — enemies on it lose stealth. */
export function flareZone(battle, unit, { key = 'flare', at, radius = 1, duration } = {}) {
  return placeZone(battle, unit, { key, kind: 'flare', tiles: tilesAround(battle, at, radius), duration, enemy: { flags: { reveal: true } } });
}

/** 播种 (seedTile): the tile `at` heals your operators on it `regen` HP/s and gives `sanctuary` 庇护 (damage taken ×(1 − x)). */
export function seedTile(battle, unit, { at, regen, sanctuary, duration = Infinity } = {}) {
  if (!Number.isFinite(regen) || regen < 0 || !Number.isFinite(sanctuary) || sanctuary < 0 || sanctuary >= 1) INVALID('seed tile');
  return placeZone(battle, unit, { key: `seed:${at[0]},${at[1]}`, kind: 'seed', tiles: [at], duration,
    ally: { mods: { hpRegen: regen, ...(sanctuary ? { dmgTakenMul: 1 - sanctuary } : null) } } });
}

/** 影哨 (sentry): keeps the unit's current attack range tiles revealing and slowing (`slow` = −x move speed) until recalled. */
export function placeSentry(battle, unit, { key = 'sentry', slow = 0, duration = Infinity } = {}) {
  const tiles = [...unit.rangeKeys].map((k) => [Math.floor(k / 21), k % 21]).filter(([r, c]) => battle.grid.inRect(r, c));
  return placeZone(battle, unit, { key, kind: 'sentry', tiles, duration, enemy: { flags: { reveal: true }, mods: slow ? { moveMul: 1 - slow } : {} } });
}

// ------------------------------------------------------------------ 敌方子弹 ---

// Enemy ranged attacks fly as real projectiles (battle.projectiles, source = the enemy). 「攻击范围内敌方子弹」 are those on
// the unit's current range tiles (or `within(projectile)`).
const enemyShot = (p) => p?.source?.side === 'enemy';
const inRangeTiles = (unit) => { const keys = new Set(unit.rangeKeys ?? []); return (p) => keys.has(roundHalfEven(p.y) * 21 + roundHalfEven(p.x)); };

/** The enemy projectiles in flight on `unit`'s range tiles (or matching `within`). */
export function enemyProjectilesIn(battle, unit, within = null) {
  const inside = within ?? inRangeTiles(unit);
  return battle.projectiles.list.filter((p) => enemyShot(p) && inside(p));
}

function projectileSpeed(battle, p) {
  const slows = [...(p.assaultSlows?.values() ?? [])];
  p.speed = p.assaultBaseSpeed * (1 - (slows.length ? Math.max(...slows) : 0));
}

/**
 * 敌方子弹飞行速度降低 (slowEnemyProjectiles): while the effect lasts (and its unit stays on the field), enemy projectiles
 * on its range tiles fly `pct` slower (the strongest slow counts; a projectile that leaves the area recovers). A slowed
 * projectile ages at its slowed pace, so it is not cut short by its life limit. The same key refreshes.
 */
export function slowEnemyProjectiles(battle, unit, { key, pct, duration = Infinity, within = null } = {}) {
  if (typeof key !== 'string' || !key || !(pct > 0 && pct < 1) || !(duration > 0)) INVALID('enemy projectile slow');
  const slows = battle.assaultProjectileSlows ??= new Map();
  const id = `${uid(unit)}:${key}`;
  slows.set(id, { unit, pct, until: battle.time + duration, within });
  if (!battle.assaultProjectileSlowHook) {
    battle.assaultProjectileSlowHook = true;
    battle.on('tick', ({ dt }) => {
      for (const p of battle.projectiles.list) {
        if (!p.assaultSlows) continue;
        // the slow of the last frame: its flight time stretches, so does its age
        if (p.speed < p.assaultBaseSpeed) p.age -= dt * (1 - p.speed / p.assaultBaseSpeed);
      }
      for (const [sid, entry] of slows) {
        const live = battle.time < entry.until && active(entry.unit);
        if (!live) slows.delete(sid);
        const inside = live ? (entry.within ?? inRangeTiles(entry.unit)) : null;
        for (const p of battle.projectiles.list) {
          if (!enemyShot(p)) continue;
          const on = !!inside && inside(p);
          if (on === !!p.assaultSlows?.has(sid)) continue;
          p.assaultBaseSpeed ??= p.speed;
          p.assaultSlows ??= new Map();
          if (on) p.assaultSlows.set(sid, entry.pct); else p.assaultSlows.delete(sid);
          projectileSpeed(battle, p);
        }
      }
    });
  }
  return id;
}

/** Ends a slowEnemyProjectiles effect now (the projectiles recover on the next frame). */
export function endEnemyProjectileSlow(battle, unit, key) {
  const entry = battle.assaultProjectileSlows?.get(`${uid(unit)}:${key}`);
  if (entry) entry.until = battle.time;
}

/** 清除敌方子弹 (clearEnemyProjectiles): the enemy projectiles on `unit`'s range tiles (or `within`) vanish without hitting. */
export function clearEnemyProjectiles(battle, unit, { within = null } = {}) {
  const gone = new Set(enemyProjectilesIn(battle, unit, within));
  if (gone.size) battle.projectiles.list = battle.projectiles.list.filter((p) => !gone.has(p));
  return gone.size;
}

// --------------------------------------------------------------- 传送 / 流形 ---

/** 传送 (teleport): a ground enemy to `unit`'s tile (native assault teleport: refused for flyers, the immune, no path). */
export function teleportToSelf(battle, unit, enemy) {
  return battle.assaultTeleportEnemy(enemy, unit);
}

/**
 * 流形 (replicate): `token` copies `source`'s 生命上限 / 攻击 / 防御 / 法抗 (× factor) and its attack interval, speed and
 * block, and attacks like it (melee / ranged, damage type). Its HP keeps its ratio.
 */
export function replicate(battle, unit, token, source, { factor = 0.9 } = {}) {
  if (!token || token.kind !== 'token' || !source?.base) INVALID('replicate');
  const ratio = token.s?.maxHp ? token.hp / token.s.maxHp : 1;
  for (const stat of ['maxHp', 'atk', 'def', 'res']) if (Number.isFinite(source.base[stat])) token.base[stat] = source.base[stat] * factor;
  for (const stat of ['bat', 'aspd', 'blockCnt']) if (Number.isFinite(source.base[stat])) token.base[stat] = source.base[stat];
  if (source.profile) token.profile = { ...token.profile, attack: source.profile.attack, projectile: source.profile.projectile,
    canHitFly: source.profile.canHitFly, dmgType: source.profile.dmgType, heal: null, noAttack: false, noAttackUnlessSkill: false };
  token.mem.assaultReplicaOf = uid(source);
  token.markDirty();
  token.hp = token.s.maxHp * Math.max(0, Math.min(1, ratio));
  return true;
}

// ------------------------------------------------------------------ 弹药 ---

/**
 * 弹药技能 (ammoSkill): load `count` rounds (+ the unit's 弹药上限 bonuses); every attack of the unit uses one; the
 * `mods` / `flags` hold while any round is left and end with the last one (`onEmpty` then runs). A recast reloads to
 * full (「持续中可重复发起」). The counter is the shared assault ammo counter (ammo.js), so reload and capacity effects of
 * other cards and collectibles reach it.
 */
export function ammoSkill(battle, unit, { key, count, mods = {}, flags = null, onAttack = null, onEmpty = null, cause } = {}) {
  if (typeof key !== 'string' || !key || !Number.isInteger(count) || count < 1) INVALID('ammo skill');
  const state = unit.mem.assaultAmmoSkill ??= { left: 0, max: count, key, loaded: false };
  state.max = count;
  state.mods = mods; state.flags = flags; state.onAttack = onAttack; state.onEmpty = onEmpty;
  const buffKey = `assault:ammoSkill:${key}`;
  const sync = () => {
    if (state.left > 0 && !state.loaded) {
      state.loaded = true;
      buff(battle, unit, unit, { key: buffKey, mods: state.mods, flags: state.flags, duration: Infinity, stacking: 'replace', cause });
    } else if (state.left <= 0 && state.loaded) {
      state.loaded = false;
      battle.removeBuff(unit, buffKey);
      if (typeof state.onEmpty === 'function') state.onEmpty({ battle, unit });
    }
  };
  if (!unit._assaultAmmoController) {
    registerAssaultAmmo(battle, unit, { get: () => state.left, set: (n) => { state.left = n; sync(); }, max: () => state.max });
    battle.on('attack', ({ attacker, targets, isSkill, attackId }) => {
      if (attacker !== unit || isSkill || !(state.left > 0)) return;
      // the attacks that spent a round (their late projectile hits still belong to the ammo window; relics inAmmoSkill)
      if (attackId != null) {
        state.rounds ??= new Set();
        state.rounds.add(attackId);
        if (state.rounds.size > 32) state.rounds.delete(state.rounds.values().next().value);
      }
      consumeAssaultAmmo(battle, unit, 1, `ammoSkill:${key}`);
      if (typeof state.onAttack === 'function') state.onAttack({ battle, unit, targets, left: state.left });
    }, { owner: unit });
  }
  state.left = assaultAmmoState(unit).capacity;
  sync();
  return state.left;
}

/** 装填 n 发 / 补满 (reload): never above the capacity. Returns the rounds added. */
export function reloadAmmo(battle, unit, target, amount = 'full', key = 'reload') {
  const state = assaultAmmoState(target);
  if (!state) return 0;
  const n = amount === 'full' ? state.capacity - state.current : amount;
  return reloadAssaultAmmo(battle, unit, target, Math.max(0, n), `synergy:${key}`);
}

/** 弹药上限 +n (maxAmmo): a named capacity bonus (the same key sets it again, it does not add up). */
export function maxAmmo(target, key, amount) {
  return setAssaultAmmoCapacityBonus(target, `synergy:${key}`, amount);
}

// ------------------------------------------------------------- 治疗 / 屏障 ---

/**
 * 溢出的治疗转为屏障 (overhealToBarrier): while `target` is on the field, the part of a heal from `by` (default: your
 * other units) above its missing HP becomes a barrier, capped at `capRatio` × max HP in total.
 */
export function overhealToBarrier(battle, unit, target, { key, capRatio, by = 'other' } = {}) {
  if (typeof key !== 'string' || !key || !Number.isFinite(capRatio) || capRatio <= 0) INVALID('overheal barrier');
  const buffKey = `assault:overheal:${key}`;
  battle.on('heal', ({ source, target: healed, amount }) => {
    if (healed !== target || !active(target) || !source || !relates(target, source, by)) return;
    const overflow = amount - Math.max(0, target.s.maxHp - target.hp);
    if (!(overflow > 0)) return;
    const current = target.findBuff(buffKey)?.shield ?? 0;
    const shield = Math.min(target.s.maxHp * capRatio, current + overflow);
    if (shield > current) battle.addBuff(target, { key: buffKey, shield, duration: Infinity, source: unit });
  }, { owner: unit });
}

// ------------------------------------------------------------- 召唤物 ---

/**
 * 召唤物 / 装置库存 +n (summonStock): `owner`'s source for the summon holds n more (its stock cap rises with it) and the
 * extra ones deploy as the field cap allows. `spec` is the card's grantSummon profile of that summon.
 */
export function summonStock(battle, owner, spec, count) {
  if (!Number.isInteger(count) || count < 1 || !object(spec) || typeof spec.tokenId !== 'string') INVALID('summon stock');
  const ledger = ledgerFor(battle, owner);
  const current = ledger.stock.get(spec.tokenId) ?? 0;
  for (const record of ledger.sources.values()) if (record.tokenId === spec.tokenId) record.stockCap = Math.max(record.stockCap, current + count);
  return grantSummon(battle, owner, { ...spec, count, stockCap: Math.max(spec.stockCap ?? 0, current + count) });
}


// -------------------------------------------------------------- 再部署 ---
// 再部署 = the loop timer every operator on the field runs from its last deployment (redeploy-cycle.js); at 0 it is
// redeployed in place: HP full, SP / buffs / attack state kept, 部署时 effects again.

/** 立即再部署: finish `target`'s current timer now and redeploy it in place once (also when the rule loop is off). */
export function redeployNow(battle, unit, target, { cause } = {}) {
  if (!target || target.side !== 'ally' || target.kind !== 'op' || !active(target)) return false;
  return cycleRedeploy(battle, target, { cause: cause ?? battle.assaultRuntime.currentCause, reason: 'effect' });
}

/** Remaining time of `unit`'s 再部署 loop (on the field, loop on) or of its respawn (knocked out); null when none runs. */
export function redeployRemaining(battle, unit) {
  if (unit?.alive && unit.deployed) return battle.assaultRedeployCycleOn && unit.assaultCycle ? Math.max(0, unit.assaultCycle.at - battle.time) : null;
  if (!unit?.alive && !unit?.removed && Number.isFinite(unit?.respawnAt)) return Math.max(0, unit.respawnAt - battle.time);
  return null;
}

/**
 * 「你的（某类）干员当前再部署时间 -x 秒 / -x%」: advances the loop timers running now (a timer reaching 0 redeploys at
 * the end of this tick) and the respawn timers of knocked-out operators. `future: true` also shortens every later
 * loop of those operators in this battle (`mem.assaultRedeployCut`). Returns how many timers moved.
 */
export function cutRedeploy(battle, unit, { seconds = 0, percent = 0, filter = null, select = () => true, includeSelf = true, future = false, includeDown = true } = {}) {
  const by = includeSelf ? 'yours' : 'other';
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(percent) || percent < 0 || percent > 1 || (seconds === 0 && percent === 0)) INVALID('redeploy cut');
  const shorten = (left) => Math.max(0, left * (1 - percent) - seconds);
  let count = 0;
  for (const x of battle.allyUnits) {
    if (x.kind !== 'op' || x.removed || !relates(unit, x, by) || !matchesClass(x, filter) || !select(x)) continue;
    if (future) {
      const cut = x.mem.assaultRedeployCut ??= { seconds: 0, keep: 1 };
      cut.seconds += seconds;
      cut.keep *= 1 - percent;
    }
    if (x.alive && x.deployed && x.assaultCycle) {
      const before=x.assaultCycle.at;
      x.assaultCycle.at = battle.time + shorten(x.assaultCycle.at - battle.time);
      if(before>x.assaultCycle.at)battle.assaultRuntime.publish('redeployReduced',{source:unit,target:x,amount:before-x.assaultCycle.at});
      count++;
    } else if (includeDown && !x.alive && Number.isFinite(x.respawnAt) && x.respawnAt > battle.time) {
      const before=x.respawnAt;
      x.respawnAt = battle.time + shorten(x.respawnAt - battle.time);
      if(before>x.respawnAt)battle.assaultRuntime.publish('redeployReduced',{source:unit,target:x,amount:before-x.respawnAt});
      count++;
    }
  }
  return count;
}

/**
 * 此干员再部署时间 -x 秒 / -x% (shortenRedeploy): every later loop of `target` in this battle is shorter (the loop
 * running now keeps its end; cutRedeploy moves that one).
 */
export function shortenRedeploy(battle, unit, target, { seconds = 0, percent = 0 } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(percent) || percent < 0 || percent > 1 || (!seconds && !percent)) INVALID('redeploy shortening');
  const cut = target.mem.assaultRedeployCut ??= { seconds: 0, keep: 1 };
  cut.seconds += seconds;
  cut.keep *= 1 - percent;
  return cut;
}

/**
 * 本次再部署时间延长 x% (redeployDelay): `target`'s running loop (or its knocked-out respawn timer) gets `percent` of its
 * whole length added once. Returns the seconds added.
 */
export function redeployDelay(battle, unit, target, { percent } = {}) {
  if (!Number.isFinite(percent) || percent <= 0) INVALID('redeploy delay');
  if (target?.alive && target.deployed && target.assaultCycle) {
    const add = target.assaultCycle.length * percent;
    target.assaultCycle.at += add;
    return add;
  }
  if (!target?.alive && !target?.removed && Number.isFinite(target?.respawnAt)) {
    const add = cycleLength(target) * percent;
    target.respawnAt += add;
    return add;
  }
  return 0;
}

/** 部署时发动技能: the card's skill is cast for free at every deployment and in-place 再部署. */
export function castOnDeploy(skillSpec) {
  if (!object(skillSpec)) INVALID('castOnDeploy skill');
  skillSpec.castOnDeploy = true;
  return skillSpec;
}

/**
 * 部署时效果 — the one registration for deploy-time work, safe to re-enter. Two parts, either optional:
 *   arm(ctx)     at each real deployment of a watched unit — the first one and a knocked-out operator's comeback (the
 *                native `deploy` hook): rebuild what the knock-out cleared (non-persist buffs, auras, timers, marks of
 *                this deployment). Not at an in-place 再部署, which keeps all of that. Synchronous, like the native hook.
 *   effect(ctx)  at every deployment AND every in-place 再部署 (the runtime `deployed` event): the 部署时 effect proper —
 *                SP, barrier, summon, damage, a one-off reward. Queued through the assault runtime, so an effect that
 *                redeploys its own unit again is cut by the causal guard, and chains stop at the per-tick limit.
 * ctx = { battle, unit, target, inPlace, initial, deployment, cause }: `deployment` is unique per (re)deployment
 * (`<deploySeq>:d` for a real one, `<deploySeq>:c<n>` for the n-th in-place one) — dedupe once-per-deployment work
 * with it, never with deploySeq alone (an in-place 再部署 keeps deploySeq).
 * by / filter: whose deployment counts ('self' by default; 'other' / 'adjacent' / 'yours' + a class filter for
 * 「你的（某类）其他干员部署时」). limit = { cooldown, perBattle } on effect.
 * A unit already on the field when this is registered (a kit installed after the opening deployment) gets arm and
 * effect once now; the event of that same deployment is then skipped.
 */
export function deployEffect(battle, unit, { key, by = 'self', filter = null, arm = null, effect = null, limit = null } = {}) {
  if (typeof key !== 'string' || !key || (arm != null && typeof arm !== 'function') || (effect != null && typeof effect !== 'function') || (!arm && !effect)) INVALID('deploy effect');
  relates(unit, unit, by);
  const watched = (x) => x?.kind === 'op' && relates(unit, x, by) && matchesClass(x, filter);
  const armed = new WeakMap(), done = new WeakMap();
  const take = limit ? limiter(battle, limit) : () => true;
  const real = (x) => `${x.deploySeq}:d`;
  const ctxOf = (target, extra) => ({ battle, unit, target, inPlace: false, initial: false, cause: battle.assaultRuntime.currentCause, ...extra });
  const runArm = (target, extra) => {
    const id = real(target);
    if (!arm || armed.get(target) === id) return;
    armed.set(target, id);
    arm(ctxOf(target, { deployment: id, ...extra }));
  };
  const runEffect = (target, id, extra) => {
    if (!effect || done.get(target) === id) return;
    done.set(target, id);
    if (take()) effect(ctxOf(target, { deployment: id, ...extra }));
  };
  if (arm) battle.on('deploy', ({ unit: target, initial }) => { if (active(unit) && watched(target)) runArm(target, { initial: !!initial }); }, { owner: unit });
  if (effect) watch(battle, unit, 'deployed', `deployEffect:${key}`, ({ payload }) => watched(payload.target),
    ({ payload, cause }) => {
      const target = payload.target;
      if (!active(target)) return;
      const id = payload.inPlace ? `${payload.deploySeq}:c${payload.cycle}` : `${payload.deploySeq}:d`;
      runEffect(target, id, { inPlace: !!payload.inPlace, initial: !!payload.initial, cause });
    });
  for (const target of battle.allyUnits) {
    if (!active(unit) || !active(target) || !watched(target)) continue;
    runArm(target, { initial: battle.time === 0 });
    if (effect) battle.assaultRuntime.enqueue(() => { if (active(target)) runEffect(target, real(target), { initial: battle.time === 0 }); },
      { key: `deployEffect:${uid(unit)}:${key}:now`, targetUid: uid(target) });
  }
}
