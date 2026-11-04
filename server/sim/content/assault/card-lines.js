// Assault synergy cards (design of 2026-10-21): the card's lines are data — compiled from
// data/assault-design/bazaar-cards-<family>.json into body.bazaar (format 'synergy'): kind, four-star params, the
// structured trigger { event, subject, condition }, limit, target and effect of each line. This module wires each line
// from that data: who sets it off (event + subject → the runtime stream), how often (limit), and the numbers (params).
// A card file only writes what each line DOES, one handler per line, so the text, the numbers and the trigger all read
// one source. Every line of a card must have its handler (or be implemented by the skill cast): a missing one throws.

import { active, makeKit, rank, uid, v, watch } from './primitives.js';
import { relates, matchesClass, limiter, statusName, knownStatus, hasStatus, withinAdjacent4, deployEffect, TRIGGER_FRAME_LIMIT, CONTROL_STATUSES } from './synergy.js';
import * as synergy from './synergy.js';
import * as primitives from './primitives.js';
import { canResolveSkill, resolveSkill } from './skill-resolution.js';

const INVALID = (label) => { throw new TypeError(`assault card line ${label} is missing or invalid`); };
const bodyOf = (unit) => unit?.def?.raw?.assaultBody ?? null;
const enemy = (x) => x?.side === 'enemy';
const op = (x) => x?.side === 'ally' && x.kind === 'op';
/** The piece's star (1–4); 4 for a unit without a piece (fixtures, summons). */
const starOf = (unit) => (unit?.def?.raw?.assaultPiece ? rank(unit) : 4);
const tile = (x) => [Number.isFinite(x?.tileR) && x.side === 'ally' ? x.tileR : Math.round(x?.y), Number.isFinite(x?.tileC) && x.side === 'ally' ? x.tileC : Math.round(x?.x)];
export const around8 = (a, b) => { const [ar, ac] = tile(a), [br, bc] = tile(b); return Math.max(Math.abs(ar - br), Math.abs(ac - bc)) <= 1; };
/** 在此干员攻击范围内 (its current range tiles hold `x`'s tile) — subject adjacentAllies with options { around: 'range' }. */
export const inRangeOf = (unit, x) => x !== unit && [...(unit?.rangeKeys ?? [])].includes(tile(x)[0] * 21 + tile(x)[1]);
/** 精英或领袖敌人 (rank ELITE / BOSS, or a boss of the field). */
export const isElite = (x) => enemy(x) && (x.isBoss === true || x.def?.rank === 'ELITE' || x.def?.rank === 'BOSS');
export const isFlyer = (x) => enemy(x) && x.motion === 'FLY';

// ------------------------------------------------------------------ subjects ---

/**
 * design-spec subject → who must have done the event, relative to the card's unit:
 *   self · otherAllies · adjacentAllies (周围四格) · allAllies (光环 only) · allies:<类>[|<类>] (其他干员 of that class, by the
 *   card's own class words: 职业 / 分支 / 阵营 / 小队) · enemyByOthers (an event on an enemy done by your other units) ·
 *   enemy (the enemy's own action).
 */
export function subjectOf(subject) {
  if (subject == null || subject === 'self') return { by: 'self' };
  if (subject === 'otherAllies') return { by: 'other' };
  if (subject === 'adjacentAllies') return { by: 'adjacent' };
  if (subject === 'allAllies') return { by: 'yours' };
  if (subject === 'enemyByOthers') return { by: 'other' };
  if (subject === 'enemy') return { by: 'enemy' };
  const m = /^allies:(.+)$/.exec(String(subject));
  if (m) return { by: 'other', filter: { label: m[1].replace(/[（(].*$/, '').split(/[|、/]/).map((x) => x.trim()).filter(Boolean) } };
  throw new TypeError(`unknown assault card subject ${subject}`);
}

// --------------------------------------------------------------------- limits ---

/**
 * Card limit text → { cooldown, perActor, perBattle, perDeployment, perCast }: 「每 n 秒最多一次」 (n may be a/b/c/d by
 * star) · 「每名干员每 n 秒最多一次」 (the cooldown per unit that set it off) · 「每场战斗前 n 次」 / 「每场战斗一次」 ·
 * 「每次部署一次 / 每次部署后首次」 · 「每次施放 1 次」. Anything else throws (a limit the runtime cannot read is a design
 * issue, never silently ignored).
 */
export function limitOf(text, star = 4) {
  if (text == null || text === '') return null;
  const out = {};
  const n = (raw) => { const tiers = String(raw).split('/').map(Number); return tiers.length === 4 ? tiers[star - 1] : tiers[0]; };
  for (const part of String(text).split(/[；;，,]/).map((x) => x.trim()).filter(Boolean)) {
    let m;
    if ((m = /^(每名干员)?每\s*([\d./]+)\s*秒(?:最多|至多)?\s*(?:一|1)\s*次$/.exec(part))) { out.cooldown = n(m[2]); if (m[1]) out.perActor = true; }
    else if ((m = /^每场战斗(?:前|最多|至多)\s*(\d+)\s*次$/.exec(part))) out.perBattle = Number(m[1]);
    else if (/^每场战斗(?:首次|一次|1\s*次)$/.test(part)) out.perBattle = 1;
    else if (/^每次(?:部署|再部署)(?:后首次|(?:最多|至多)?\s*(?:一|1)\s*次)$/.test(part)) out.perDeployment = 1;
    else if (/^每次(?:施放|技能|发动)(?:最多|至多)?\s*(?:一|1)\s*次$/.test(part)) out.perCast = 1;
    else throw new TypeError(`unreadable assault card limit 「${text}」`);
  }
  return out;
}

function gate(battle, unit, limit) {
  if (!limit) return () => true;
  const shared = limit.perBattle != null || (limit.cooldown != null && !limit.perActor)
    ? limiter(battle, { cooldown: limit.perActor ? null : limit.cooldown ?? null, perBattle: limit.perBattle ?? null }) : null;
  const perActor = new Map();
  let deployment = null, cast = null;
  return (actor = null) => {
    if (limit.perDeployment) {
      const id = `${unit.deploySeq}:${unit.assaultCycle?.count ?? 0}`;
      if (deployment === id) return false;
      deployment = id;
    }
    if (limit.perCast) {
      const id = unit.skill?.activations ?? 0;
      if (cast === id) return false;
      cast = id;
    }
    if (limit.perActor && limit.cooldown != null) {
      const at = perActor.get(uid(actor));
      if (at != null && battle.time + 1e-9 < at + limit.cooldown) return false;
      perActor.set(uid(actor), battle.time);
    }
    return shared ? shared() : true;
  };
}

// --------------------------------------------------------------------- events ---

const statusesOf = (sub) => (sub ? sub.split('|').map((s) => statusName(s)) : null);
// the design table writes 凋亡 as necrosis; the engine's 凋亡 is apoptosis (the old necrosis never bursts on an enemy)
const ELEMENT_OF = { burn: 'burn', necrosis: 'apoptosis', nerve: 'neural', neural: 'neural', erosion: 'erosion', apoptosis: 'apoptosis', any: null };

/**
 * design-spec trigger.event → { type: the runtime event, actor: whose event it is (checked against the subject),
 * accept: what else must hold }. `<event>:<sub>` passes the sub type (statuses joined with |, an element).
 */
export const EVENTS = Object.freeze({
  skillStart: { type: 'skillStart', actor: (p) => p.source },
  skillResolved: { type: 'skillResolved', actor: (p) => p.source },
  kill: { type: 'kill', actor: (p) => p.source, accept: (p) => enemy(p.target) },
  eliteKill: { type: 'kill', actor: (p) => p.source, accept: (p) => isElite(p.target) },
  death: { type: 'death', actor: (p) => p.target, accept: (p) => op(p.target) },
  // statusApplied:<status> = your units put X on an enemy; statusApplied:anyOnAlly = an enemy puts any control status on
  // one of your operators (「干员受到异常状态时」, subject enemy; options.accept narrows whom, e.g. in range)
  statusApplied: { type: 'statusApplied', actor: (p) => p.source, accept: (p, sub) => (sub === 'anyOnAlly'
    ? op(p.target) && enemy(p.source) && CONTROL_STATUSES.includes(knownStatus(p.status))
    : enemy(p.target) && (!sub || statusesOf(sub).includes(knownStatus(p.status)))) },
  elementBurst: { type: 'elementBurst', actor: (p) => p.source, accept: (p, sub) => enemy(p.target) && (!sub || sub === 'any' || ELEMENT_OF[sub] === (p.element === 'nerve' ? 'neural' : p.element)) },
  elementHit: { type: 'elementDamage', actor: (p) => p.source, accept: (p, sub) => enemy(p.target) && (!sub || sub === 'any' || ELEMENT_OF[sub] === p.element) },
  blocked: { type: 'blocked', actor: (p) => p.source, accept: (p) => enemy(p.target) },
  blockedAir: { type: 'blocked', actor: (p) => p.source, accept: (p) => isFlyer(p.target) },
  heal: { type: 'heal', actor: (p) => p.source, accept: (p) => op(p.target) },
  healed: { type: 'heal', actor: (p) => p.target, accept: (p) => op(p.target) },
  shieldGained: { type: 'shieldGained', actor: (p) => p.target },
  shieldBroken: { type: 'shieldBroken', actor: (p) => p.target },
  deployed: { type: 'deployed', actor: (p) => p.target, accept: (p) => op(p.target) },
  redeploy: { type: 'redeploy', actor: (p) => p.target, accept: (p) => op(p.target) },
  redeployTimerFull: { type: 'redeploy', actor: (p) => p.target, accept: (p) => op(p.target) && p.inPlace === true && p.reason === 'cycle' },
  summonSpawned: { type: 'summonSpawned', actor: (p) => p.source ?? p.target?.ownerUnit },
  summonDied: { type: 'summonDied', actor: (p) => p.target?.ownerUnit },
  summonExited: { type: 'summonExited', actor: (p) => p.source ?? p.target?.ownerUnit },
  summonReturned: { type: 'summonReturned', actor: (p) => p.source },
  damageTaken: { type: 'damageTaken', actor: (p) => p.target, accept: (p) => op(p.target) },
  hit: { type: 'hit', actor: (p) => p.source, accept: (p) => enemy(p.target) },
  attack: { type: 'attack', actor: (p) => p.source },
  dodge: { type: 'dodge', actor: (p) => p.target },
  dpSpent: { type: 'dpSpent', actor: (p) => p.source },
  // 你获得费用时 (any source); with a subject naming who gave it (self / otherAllies / allies:<类>) it binds dpGranted
  dpReceived: { type: 'dpReceived', actor: () => null },
  dpGranted: { type: 'dpGranted', actor: (p) => p.source },
  spReceived: { type: 'spReceived', actor: (p) => p.target },
  ammoUsed: { type: 'ammoUsed', actor: (p) => p.source },
  reloaded: { type: 'reloaded', actor: (p) => p.target },
  teleported: { type: 'teleported', actor: (p) => p.source },
  pullCollision: { type: 'pullCollision', actor: (p) => p.source },
  pushCollision: { type: 'pushCollision', actor: (p) => p.source },
  hpLost: { type: 'hpLost', actor: (p) => p.target },
  loseHp: { type: 'hpLost', actor: (p) => p.target },
  // 装置 / 共振装置触发 (the device event of every owner's device) and 金币消耗 — the coin of 琳琅诗怀雅 is her card's own
  // resource: her kit publishes `coinSpent` { source, amount } when it spends coins
  summonTriggered: { type: 'deviceTrigger', actor: (p) => p.source },
  deviceTrigger: { type: 'deviceTrigger', actor: (p) => p.source },
  coinSpent: { type: 'coinSpent', actor: (p) => p.source },
});
/** Not bound to an event: the skill line (the cast implements it), 静态 / 光环 (installed once), 部署时 (deployEffect). */
export const INSTALL_EVENTS = Object.freeze(['skillReady', 'static', 'aura']);

const frames = new WeakMap();
function underFrameLimit(battle, key) {
  let f = frames.get(battle);
  if (!f || f.time !== battle.time) { f = { time: battle.time, counts: new Map() }; frames.set(battle, f); }
  const n = f.counts.get(key) ?? 0;
  if (n >= TRIGGER_FRAME_LIMIT) {
    const d = battle.assaultRuntime.diagnostics;
    d.triggerFrameRefused = (d.triggerFrameRefused ?? 0) + 1;
    return false;
  }
  f.counts.set(key, n + 1);
  return true;
}

/**
 * Wire one trigger to `handler(ctx)`. `trigger` = { event, subject } of the design table; `limit` its text or an object;
 * `options` may widen what the text adds in prose: { statuses: [...] } (「含停顿、寒冷」), { around: 8 } (周围 8 格 instead of
 * 四格) or { around: 'range' } (「攻击范围内的其他干员」), { accept(payload, ctx) } (any further condition). ctx = { battle, unit, payload, source, target, actor, cause }.
 */
// subject 'enemy' (「敌人自身的行为」): the event's enemy party is who did it — the attacker of a hit on this operator, the
// enemy that bursts or falls (by anyone). Events not listed keep their actor (statusApplied:anyOnAlly names the enemy already).
const FOE_EVENTS = Object.freeze({
  damageTaken: { actor: (p) => p.source, accept: (p, sub, unit) => p.target === unit },
  hit: { actor: (p) => p.source, accept: (p, sub, unit) => p.target === unit },
  elementBurst: { actor: (p) => p.target },
  elementHit: { actor: (p) => p.target },
  death: { actor: (p) => p.target, accept: (p) => enemy(p.target) },
});

export function bindTrigger(battle, unit, { event, subject }, { key, limit = null, statuses = null, around = 4, accept = null } = {}, handler) {
  if (typeof key !== 'string' || !key || typeof handler !== 'function') INVALID('trigger binding');
  let [name, sub0] = String(event).split(':');
  // 「部署或再部署时」 (redeploy|deployed): every deployment, knocked-out comebacks and in-place 再部署 included, publishes
  // `deployed` once — binding both would fire twice
  if (name.includes('|')) {
    const names = name.split('|');
    if (!names.includes('deployed') || !names.every((n) => ['deployed', 'redeploy'].includes(n))) throw new TypeError(`unsupported assault card event alternation ${event}`);
    name = 'deployed';
  }
  const sub = statuses ? statuses.join('|') : sub0;
  const { by, filter } = subjectOf(subject);
  if (name === 'dpReceived' && by !== 'yours' && by !== 'any') name = 'dpGranted';
  const known = EVENTS[name];
  if (!known) throw new TypeError(`unknown assault card event ${event}`);
  const foe = by === 'enemy' ? FOE_EVENTS[name] : null;
  const spec = foe ? { type: known.type, actor: foe.actor, accept: foe.accept ? (p, s) => foe.accept(p, s, unit) : known.accept } : known;
  const take = gate(battle, unit, typeof limit === 'string' || limit == null ? limitOf(limit, starOf(unit)) : limit);
  const near = (x) => (around === 'range' ? inRangeOf(unit, x) : around === 8 ? around8(unit, x) && x !== unit : withinAdjacent4(unit, x));
  const who = (x) => (x == null ? by === 'any' || by === 'yours' : relates(unit, x, by === 'adjacent' ? 'other' : by)
    && (by !== 'adjacent' || near(x)) && (filter == null || matchesClass(x, filter)));
  return watch(battle, unit, spec.type, `card:${key}`,
    ({ payload }) => !!payload && (!spec.accept || spec.accept(payload, sub)) && who(spec.actor(payload)),
    ({ payload, cause }) => {
      const ctx = { battle, unit, payload, source: payload.source ?? null, target: payload.target ?? null, actor: spec.actor(payload), cause };
      if (accept && !accept(payload, ctx)) return;
      if (!underFrameLimit(battle, `${uid(unit)}:${key}`) || !take(ctx.actor)) return;
      handler(ctx);
    });
}

// ------------------------------------------------------------------ targets ---

/**
 * Your units a line names: 'self' · 'otherAllies' · 'allAllies' · 'adjacentAllies' · 'allies:<类>' (其他干员 of that
 * class) — operators on the field, in deployment order.
 */
export function alliesOf(battle, unit, spec, { around = 4, includeSelf = false } = {}) {
  if (spec === 'self') return active(unit) ? [unit] : [];
  const { by, filter } = subjectOf(spec);
  return battle.assaultDeploymentOrder().filter((x) => x.kind === 'op' && active(x)
    && (by === 'yours' || (includeSelf && x === unit) ? relates(unit, x, 'yours') : relates(unit, x, 'other'))
    && (by !== 'adjacent' || (around === 'range' ? inRangeOf(unit, x) : around === 8 ? around8(unit, x) : withinAdjacent4(unit, x)))
    && (filter == null || matchesClass(x, filter)));
}

// ---------------------------------------------------------------- the card kit ---

/** The four-star value of a line's param at the unit's star (throws when the line has no such param at that star). */
export function paramOf(unit, line, key) {
  const values = line?.params?.[key];
  if (!Array.isArray(values)) throw new TypeError(`${bodyOf(unit)?.charId}: card line has no param ${key}`);
  const value = values[rank(unit) - 1];
  if (value == null) throw new TypeError(`${bodyOf(unit)?.charId}: card param ${key} has no value at star ${rank(unit)}`);
  return Number(value);
}

/** Line `index` of the unit's synergy card, and one of its params at the unit's star (what a skill cast reads). */
export function cardLine(unit, index) {
  const line = bodyOf(unit)?.bazaar?.lines?.[index];
  if (!line) throw new TypeError(`${bodyOf(unit)?.charId}: synergy card has no line ${index}`);
  return line;
}
export const cardParam = (unit, index, key) => paramOf(unit, cardLine(unit, index), key);
/** A module line's param at the unit's star when that module is chosen (stars 3–4), else `fallback`. */
export function moduleParam(unit, moduleId, key, fallback = null) {
  const line = bodyOf(unit)?.bazaar?.modules?.[moduleId];
  if (moduleOf(unit) !== moduleId || !line) return fallback;
  return paramOf(unit, line, key);
}

/** The selected advanced module of the piece (stars 3–4), else null. */
export function moduleOf(unit) {
  const piece = unit.def.raw.assaultPiece;
  const moduleId = piece?.moduleId ?? piece?.moduleChoices?.[unit.def.charId];
  return piece?.star >= 3 ? moduleId ?? null : null;
}

/**
 * Bound helpers for line handlers: the synergy and native primitives with `battle`, `unit` and the event's cause filled
 * in. fx.charge(target, n) · fx.accelerate(target, s) · fx.stack(target, { key, stat, amount, mode }) · fx.growth(target,
 * { key, stat, flat, percent }) · fx.cutRedeploy({ seconds, percent, filter, includeSelf }) · fx.redeployNow(target) ·
 * fx.castSkill(target) · fx.loseHp(target, {...}) · fx.damage / heal / status / buff / sustain(target, {...}) ·
 * fx.airAura(filter, { after, until, when, where }) · fx.counter(target, { key, label, amount, suffix }) (卡内本场叠加,
 * shown on the detail card) · fx.counterValue(target, key) · fx.growthCounter(target, { key, label, amount, suffix })
 * (卡内本局永久成长, kept on the piece) · fx.growthValue(target, key) (earlier battles + this one) · fx.redeployTime(target, { seconds, percent }) (此干员再部署
 * 时间 -x) · fx.dp(n) · fx.allies(spec) · fx.raw = { synergy, primitives }.
 */
export function effects(battle, unit, line, cause = null) {
  const key = (name) => `${bodyOf(unit)?.charId}:${line?.index ?? 'x'}:${name}`;
  const grows=bodyOf(unit)?.bazaar?.format!=='synergy'||bodyOf(unit)?.bazaar?.growthIdentity!=null;
  const authored=bodyOf(unit)?.bazaar?.lines?.[line?.index];
  const growthRow=authored&&(['growth','stack'].includes(authored.kind)||authored.growthSuppressed);
  return {
    charge: (target, amount) => amount > 0 && synergy.charge(battle, unit, target, amount, key('charge'), cause),
    accelerate: (target, seconds) => synergy.accelerate(battle, unit, target, seconds, key('haste'), cause),
    spAura: (target, perSecond, opts) => synergy.spAura(battle, unit, target, perSecond, key('spAura'), { ...opts, cause }),
    stack: (target, spec) => growthRow&&!grows?0:synergy.battleStack(battle, unit, target, { ...spec, accumulate:grows&&growthRow!==false, key: key(spec.key ?? 'stack'), cause }),
    counter: (target, spec) => grows||spec.key==='svash2-ready'?synergy.battleCounter(battle, unit, target, { ...spec, key: spec.key, cause }):0,
    counterValue: (target, counterKey) => synergy.counterValue(battle, target, counterKey),
    growthCounter: (target, spec) => grows?synergy.runCounter(battle, unit, target, { ...spec, cause }):0,
    growthValue: (target, counterKey) => synergy.runCounterValue(battle, target, counterKey),
    redeployTime: (target, spec) => synergy.shortenRedeploy(battle, unit, target, spec),
    dp: (amount) => primitives.gainDP(battle, unit, amount, key('dp'), cause),
    growth: (target, spec) => grows?synergy.runGrowth(battle, unit, target, { ...spec, key: spec.key ?? key('growth'), cause }):0,
    cutRedeploy: (spec) => synergy.cutRedeploy(battle, unit, spec),
    redeployNow: (target) => synergy.redeployNow(battle, unit, target, { cause }),
    redeployDelay: (target, percent) => synergy.redeployDelay(battle, unit, target, { percent }),
    castSkill: (target) => synergy.castSkill(battle, unit, target, { cause }),
    loseHp: (target, spec) => synergy.loseHp(battle, unit, target, { ...spec, cause }),
    elementDamage: (target, spec) => synergy.elementDamage(battle, unit, target, { ...spec, cause }),
    damage: (target, spec) => primitives.damage(battle, unit, target, { sourceKey: key('damage'), ...spec, cause }),
    heal: (target, spec) => primitives.heal(battle, unit, target, { sourceKey: key('heal'), ...spec, cause }),
    status: (target, spec) => primitives.applyStatus(battle, unit, target, { key: key(`status:${spec.status}`), ...spec, cause }),
    buff: (target, spec) => primitives.buff(battle, unit, target, { ...spec, key: key(spec.key ?? 'buff'), cause }),
    sustain: (target, spec) => synergy.sustain(battle, unit, target, { ...spec, key: key(spec.key ?? 'sustain'), cause }),
    grantAir: (target, spec = {}) => synergy.grantAirBlock(battle, unit, target, { ...spec, key: key(spec.key ?? 'air'), cause }),
    airAura: (filter, conditions = {}) => synergy.airBlockAura(battle, unit, { key: key('airAura'), filter, ...conditions }),
    reload: (target, amount) => synergy.reloadAmmo(battle, unit, target, amount, key('reload')),
    allies: (spec, opts) => alliesOf(battle, unit, spec, opts),
    raw: { synergy, primitives },
  };
}

/**
 * Install a synergy card's lines on `unit`. `handlers[i]` implements body.bazaar.lines[i] (by index, the order of the
 * card) as `(ctx) => …` with ctx = { battle, unit, line, p(key), fx, payload, source, target, actor, cause, deployment,
 * inPlace }:
 *   kind 'skill'   → the string 'cast' (the skill cast implements it; the kit's cast reads the same params)
 *   kind 'deploy'  → run at every deployment and every in-place 再部署 (deployEffect)
 *   event static / aura → run at every real deployment (光环 helpers register once and keep themselves in sync)
 *   any other      → bound to its trigger { event, subject } and limit; `handlers[i]` may also be { run, options }
 *                    with bindTrigger options ({ statuses, around, accept }) for what the text adds in prose, and
 *                    { install(ctx) } run once at install for what the line keeps up besides its trigger.
 * `modules[id]` likewise implements the module line (installed only when that module is chosen, stars 3–4).
 */
export function installLines(battle, unit, handlers = {}, modules = {}) {
  const card = bodyOf(unit)?.bazaar;
  if (card?.format !== 'synergy') throw new TypeError(`${bodyOf(unit)?.charId}: not a synergy card`);
  const install = (line, index, handler, tag) => {
    const where = `${bodyOf(unit).charId}:${tag}`;
    // 'cast': the skill cast implements the line — a skill line, or the 「部署时：立即发动 X」 line of a card whose skill is cast
    // at every deployment (castOnDeploy, and every deploy-cast passive)
    if (handler === 'cast') {
      if (line.kind !== 'skill' && !(line.kind === 'deploy' && card.castOnDeploy)) throw new TypeError(`${where}: only a skill line (or the deploy line of a castOnDeploy card) is implemented by the cast`);
      return;
    }
    const run = typeof handler === 'function' ? handler : handler?.run;
    if (typeof run !== 'function') throw new TypeError(`${where}: card line ${line.kind} 「${line.template}」 has no handler`);
    const lineWithIndex = { ...line, index: tag };
    const ctxOf = (extra) => ({ battle, unit, line: lineWithIndex, p: (k) => paramOf(unit, line, k), fx: effects(battle, unit, lineWithIndex, extra.cause ?? null), ...extra });
    // { install } runs once when the card is installed (what a triggered line also keeps up: a damage hook, an aura)
    if (typeof handler?.install === 'function') handler.install(ctxOf({ cause: null }));
    // Some old growth rows also installed the operator's native fixed aura.
    // Keep that installation; retire only the extra growth trigger.
    if(line.suppressed)return;
    const event = String(line.trigger?.event ?? '');
    if (line.kind === 'deploy' || (event === 'deployed' && (line.trigger?.subject ?? 'self') === 'self')) {
      deployEffect(battle, unit, { key: `line:${tag}`, limit: limitOf(line.limit, starOf(unit)),
        effect: (ctx) => run(ctxOf({ cause: ctx.cause, deployment: ctx.deployment, inPlace: ctx.inPlace, target: ctx.target })) });
      return;
    }
    // 静态 / 光环: at every real deployment (the first one, a knocked-out comeback) — what the knock-out cleared comes back;
    // the aura helpers (allyAura / enemyAura / airBlockAura) register once per key and keep themselves in sync
    if (INSTALL_EVENTS.includes(event) || !event) {
      deployEffect(battle, unit, { key: `line:${tag}`, arm: (ctx) => run(ctxOf({ cause: ctx.cause, deployment: ctx.deployment })) });
      return;
    }
    bindTrigger(battle, unit, line.trigger, { key: `line:${tag}`, limit: line.limit, ...(handler.options ?? {}) }, (ctx) => run(ctxOf(ctx)));
  };
  card.lines.forEach((line, index) => install(line, index, handlers[index], index));
  for (const [id, entry] of Object.entries(card.modules ?? {})) {
    if (moduleOf(unit) !== id || !entry.kind) continue;
    install(entry, `module:${id}`, modules[id], `module:${id}`);
  }
}

/**
 * A synergy card's kit: the fixed skill (cast / canCast as makeKit) and every card line installed from data.
 * spec = { cast, canCast, lines: handlers by index, modules: handlers by module id, install(battle, unit) extra }.
 */
export function synergyKit(def, { cast, canCast, lines = {}, modules = {}, install = null } = {}) {
  const body = def.raw?.assaultBody ?? def.assaultBody;
  if (body?.bazaar?.format !== 'synergy') throw new TypeError(`${body?.charId}: synergyKit needs a synergy card (body.bazaar.format)`);
  if (typeof cast !== 'function') throw new TypeError(`${body.charId}: synergyKit needs the skill cast`);
  const resolution = body.bazaar.skillResolution;
  const effectiveCast = resolution ? (ctx) => resolveSkill(ctx, resolution, effects(ctx.battle, ctx.unit, { index: 'skill' }, ctx.cause)) : cast;
  const effectiveCanCast = resolution ? ({battle,unit}) => canResolveSkill(battle,unit,resolution) : canCast;
  // 部署即发的被动 (all SP 0 in the design): no SP, no natural cast — the skill is cast at every deployment and every
  // in-place 再部署 (its 「部署时：立即发动 X」 line is 'cast'); nothing else can cast it
  const passive = body.fixedSkill?.kind === 'passive';
  const installAll = (battle, unit, ...args) => {
    installLines(battle, unit, lines, modules);
    if (passive) deployEffect(battle, unit, { key: 'passive-skill', effect: (ctx) => effectiveCast({ battle, unit, cause: ctx.cause, inPlace: ctx.inPlace, deployment: ctx.deployment }) });
    if (typeof install === 'function') install(battle, unit, ...args);
  };
  return passive
    ? makeKit(def, { passive: true, trait: () => true, install: installAll })
    : makeKit(def, { cast:effectiveCast, canCast:effectiveCanCast, castOnDeploy: body.bazaar.castOnDeploy === true, install: installAll });
}

export { hasStatus, v };
