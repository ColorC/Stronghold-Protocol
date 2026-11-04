import { bodyInKeys } from '../../body.js';
import { ADD_KEYS, FLAG_KEYS, MUL_KEYS } from '../../buffs.js';
import { COLS } from '../../constants.js';
import { DIR_VEC, normDir } from '../../dir.js';
import { canTargetEnemy } from '../../targeting.js';
import { roundHalfEven } from '../../detmath.js';

const INVALID = (label) => { throw new TypeError(`assault ${label} is missing or invalid`); };
const object = (x) => x && typeof x === 'object' && !Array.isArray(x);
const idOf = (x) => x?.uid ?? x?.id ?? null;

export function pieceOf(unitOrDef) {
  const candidates = [unitOrDef?.input_piece, unitOrDef?.inputPiece, unitOrDef?.def?.raw?.assaultPiece,
    unitOrDef?.def?.assaultPiece, unitOrDef?.raw?.assaultPiece, unitOrDef?.assaultPiece];
  return candidates.find(object) ?? INVALID('assaultPiece');
}

export function bodyOf(unitOrDef) {
  const candidates = [unitOrDef?.def?.raw?.assaultBody, unitOrDef?.def?.assaultBody,
    unitOrDef?.raw?.assaultBody, unitOrDef?.assaultBody];
  return candidates.find(object) ?? INVALID('assaultBody');
}

export function rank(unitOrDef) {
  const piece = pieceOf(unitOrDef);
  const value = unitOrDef?.input_piece?.star ?? unitOrDef?.inputPiece?.star ?? piece.star ?? piece.rank;
  if (!Number.isInteger(value) || value < 1 || value > 4) return INVALID('rank 1..4');
  return value;
}

export function v(unitOrDef, value) {
  if (Array.isArray(value)) {
    if (value.length !== 4) return INVALID('four-rank value');
    const selected = value[rank(unitOrDef) - 1];
    if (selected === undefined || selected === null) return INVALID('rank value');
    return selected;
  }
  if (value === undefined || value === null) return INVALID('value');
  return value;
}

export function active(unit) {
  return !!unit?.alive && !!unit?.deployed && !unit?.hidden && !unit?.removed;
}

export function uid(unit) {
  const value = idOf(unit);
  if (value == null || value === '') return INVALID('unit uid');
  return String(value);
}

export function makeKit(def, { cast, install, canCast, trait, passive = false, castOnDeploy = false } = {}) {
  const piece = pieceOf(def);
  const body = bodyOf(def);
  const fixed = piece.fixedSkill ?? body.fixedSkill ?? piece.skill;
  if (!passive && !object(fixed)) return INVALID('fixedSkill');
  const star = rank(def);
  const costs = fixed?.spCosts ?? fixed?.spCost;
  if (!passive && !(Number.isFinite(costs) || Array.isArray(costs) && costs.length === 4 && Number.isFinite(costs[star - 1]))) return INVALID('fixedSkill spCosts');
  const id = fixed?.sourceSkillId ?? fixed?.id;
  if (!passive && (typeof id !== 'string' || !id)) return INVALID('fixedSkill path/id');
  const handler = typeof cast === 'function' ? cast : trait;
  if (typeof handler !== 'function') return INVALID('assault cast handler');
  const kind = passive ? 'passive' : (fixed.kind ?? 'instant');
  if (!['instant', 'passive'].includes(kind)) throw new TypeError(`unsupported assault kit kind ${kind}`);
  const installed = new WeakSet();
  const skill = {
    id: id ?? `${piece.charId ?? body.charId ?? 'assault'}:passive`,
    kind,
    spCost: passive ? 0 : (Array.isArray(costs) ? costs[star - 1] : costs),
    initSp: passive ? 0 : v(def, fixed.initSp ?? 0),
    charges: passive ? 1 : v(def, fixed.maxCharges ?? 1),
    trigger: passive ? 'NEVER' : 'SP_FULL',
    // Assault changes every operator to natural recovery, including native
    // attack-/hurt-recovery S1 skills. Never inherit the original trigger.
    spType: passive ? 'none' : 'time',
    assaultCast: (ctx) => handler({ ...ctx, battle: ctx.battle, unit: ctx.unit, piece, body, rank: star }),
    canCast: typeof canCast === 'function' ? (ctx) => canCast({ ...ctx, battle: ctx.battle, unit: ctx.unit, piece, body, rank: star }) : undefined,
  };
  if (passive) skill.onStart = skill.assaultCast;
  // 部署时发动技能: cast for free at every deployment and in-place 再部署 (Battle._assaultCastOnDeploy)
  if (castOnDeploy && !passive) skill.castOnDeploy = true;
  const installOnce = typeof install === 'function' ? (battle, unit, ...args) => {
    if (unit && installed.has(unit)) return false;
    if (unit) installed.add(unit);
    install(battle, unit, ...args);
    return true;
  } : undefined;
  return { skill, install: installOnce };
}

function runtimeOf(battle) {
  if (!battle?.assaultRuntime) throw new Error('assaultRuntime is required');
  return battle.assaultRuntime;
}

export function queue(battle, key, target, fn, cause = runtimeOf(battle).currentCause) {
  return runtimeOf(battle).enqueue(fn, { key, targetUid: target == null ? null : (typeof target === 'string' ? target : uid(target)), cause,
    sourceUid: null });
}

export function watch(battle, unit, type, key, predicate, handler, { priority = 0, allowInactive = false } = {}) {
  if (!unit || typeof type !== 'string' || !type || typeof key !== 'string' || !key || typeof predicate !== 'function' || typeof handler !== 'function') INVALID('watch arguments');
  const rt = runtimeOf(battle);
  const ownerKey = `${unit.def?.charId ?? unit.defId ?? unit.charId ?? 'unit'}:${uid(unit)}:${key}`;
  return rt.observe(type, ownerKey, (event) => {
    if (!allowInactive && !active(unit)) return;
    const payload = event.payload;
    if (!predicate({ battle, unit, event, payload })) return;
    const target = payload?.targetUid ?? payload?.target ?? unit;
    rt.enqueue(() => handler({ battle, unit, event, payload, cause: event.cause }), {
      key: ownerKey, targetUid: idOf(target) == null ? uid(unit) : idOf(target), cause: event.cause,
      sourceUid: uid(unit),
    });
  }, { owner: unit, priority });
}

export function tagsOf(unit) {
  const piece = unit?.input_piece ?? unit?.inputPiece ?? unit?.def?.raw?.assaultPiece ?? unit?.def?.assaultPiece ?? {};
  const body = unit?.def?.raw?.assaultBody ?? unit?.def?.assaultBody ?? {};
  const tags = new Set([...(body.tags ?? []), ...(piece.tags ?? []), ...(unit?.def?.tags ?? []),
    body.nationId, body.groupId, body.teamId, body.raceId, body.profession, body.archetype,
    body.subProfession, unit?.nationId, unit?.profession].filter((x) => typeof x === 'string' && x));
  for (const t of piece.tagEdits?.remove ?? []) tags.delete(t);
  for (const t of piece.tagEdits?.add ?? []) tags.add(t);
  return [...tags];
}

export function unitTag(unit, tag) { return tagsOf(unit).includes(tag); }

export function matchesTags(unit, required) {
  if (typeof required === 'string') required = [required];
  if (!Array.isArray(required) || required.some((x) => typeof x !== 'string' || !x)) INVALID('explicit tag strings');
  const tags = new Set(tagsOf(unit));
  return required.every((tag) => tags.has(tag));
}

export function tileOf(unit) {
  // Enemy tileR/tileC are spawn metadata. Native movement updates x/y only.
  return unit?.side==='enemy'?[roundHalfEven(unit.y),roundHalfEven(unit.x)]
    :[Number.isFinite(unit?.tileR)?unit.tileR:roundHalfEven(unit?.y),Number.isFinite(unit?.tileC)?unit.tileC:roundHalfEven(unit?.x)];
}
function rangeKeys(battle, anchor, scope) {
  if (scope === 'range') return anchor.rangeKeys ?? [];
  const [r, c] = tileOf(anchor);
  if (scope === 'self') return [r * COLS + c];
  // Card-relative positions: the deployed facing decides which tile is in
  // front (1 tile) and which two tiles are its left/right hand.
  if (scope === 'front' || scope === 'sides') {
    const [fr, fc] = anchor?.fwd ?? DIR_VEC[normDir(anchor?.dir)];
    const offsets = scope === 'front' ? [[fr, fc]] : [[fc, -fr], [-fc, fr]];
    return offsets.map(([dr, dc]) => [r + dr, c + dc]).filter(([rr, cc]) => rr >= 0 && cc >= 0 && cc < COLS).map(([rr, cc]) => rr * COLS + cc);
  }
  if (!['adjacent4', 'adjacent8'].includes(scope)) return null;
  const offsets = scope === 'adjacent4' ? [[-1,0],[0,-1],[0,1],[1,0]] : [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  return offsets.map(([dr, dc]) => (r + dr) * COLS + c + dc).filter((k) => k >= 0);
}
function fieldList(battle, side) { return side === 'enemy' ? battle.enemies : battle.allyUnits; }
function within(battle, unit, anchor, scope, keys) {
  if (scope === 'field') return true;
  if (!keys) return false;
  if (scope === 'self') return unit === anchor;
  return bodyInKeys(unit, new Set(keys));
}
function untargetable(unit) { return !!(unit?.s?.flags?.untargetable || unit?.s?.flags?.invulnerable); }
function exitDistance(unit) { return unit?.exitDistance ?? unit?.pathDistance ?? unit?.pathDist ?? unit?.routeDistance ?? Infinity; }

export function enemies(battle, unit, { scope = 'range', anchor = unit, priority = 'exit', count = 1, groundOnly = false, allowUntargetable = false, excludeIds = [] } = {}) {
  if (!['range','field','adjacent4','adjacent8','self','front','sides'].includes(scope)) throw new TypeError(`unknown enemy scope ${scope}`);
  if (!Number.isInteger(count) || count < 0) INVALID('enemy selector count');
  const keys = rangeKeys(battle, anchor, scope);
  const excluded = new Set(excludeIds.map(String));
  let list = fieldList(battle, 'enemy').filter((x) => active(x) && !x.hidden && !excluded.has(uid(x))
    && within(battle, x, anchor, scope, keys)
    && (!groundOnly || !x.isFlying)
    && (allowUntargetable || (!untargetable(x) && canTargetEnemy(anchor, x, anchor.profile ?? {}))));
  if (scope === 'range' && !allowUntargetable) list = battle.enemiesInKeys(keys, anchor, anchor.profile ?? {}).filter((x) => list.includes(x));
  // Native attack skills retain the blocker's own contact targets (Skills
  // _defaultCondition / AI acquireTargets), even when contact lies across the
  // painted tile boundary. A remote anchor or another operator's block grants
  // no such exception; range, profile exclusions and the original cap remain.
  if(scope==='range'&&unit?.blocking?.length&&anchor.tileR===unit.tileR&&anchor.tileC===unit.tileC){
    for(const target of battle.blockedTargets(unit,anchor.profile??unit.profile??{})){
      if(!excluded.has(uid(target))&&(!groundOnly||!target.isFlying)&&!list.includes(target))list.push(target);
    }
  }
  const sort = priority === 'exit' ? (a, b) => battle.remainingDistance(a) - battle.remainingDistance(b) || uid(a).localeCompare(uid(b))
    : priority === 'hp' ? (a, b) => a.hp - b.hp || uid(a).localeCompare(uid(b))
      : priority === 'nearest' ? (a, b) => { const [ar,ac]=tileOf(a),[br,bc]=tileOf(b),[ur,uc]=tileOf(anchor); return Math.abs(ar-ur)+Math.abs(ac-uc)-Math.abs(br-ur)-Math.abs(bc-uc) || uid(a).localeCompare(uid(b)); }
        : priority === 'uid' ? (a,b) => uid(a).localeCompare(uid(b)) : null;
  if (!sort) throw new TypeError(`unknown enemy priority ${priority}`);
  return list.sort(sort).slice(0, count);
}

export function allies(battle, unit, { scope = 'range', anchor = unit, selection = 'lowestHp', count = 1, operatorsOnly = false, excludeSelf = false, tags = null, predicate = null } = {}) {
  if (!['range','field','adjacent4','adjacent8','self','front','sides'].includes(scope)) throw new TypeError(`unknown ally scope ${scope}`);
  if (!['lowestHp','highestHp','uid','nearest'].includes(selection)) throw new TypeError(`unknown ally selection ${selection}`);
  if (!Number.isInteger(count) || count < 0) INVALID('ally selector count');
  const keys = rangeKeys(battle, anchor, scope);
  let list = fieldList(battle, 'ally').filter((x) => active(x) && x.kind !== 'device' && (!operatorsOnly || x.kind === 'op')
    && (!excludeSelf || x !== unit) && within(battle, x, anchor, scope, keys)
    && !(x.s?.flags?.noHeal || x.profile?.noHeal)
    && (!tags || matchesTags(x, tags)) && (!predicate || predicate(x)));
  // A skill anchor may replace rangeKeys while copying a Unit's cached normal
  // rangeKeySet. The selected skill range is authoritative in this selector.
  if (scope === 'range') { const selectedKeys=new Set(keys); list = list.filter((x) => selectedKeys.has(x.tileR * COLS + x.tileC)); }
  const order = { lowestHp: (a,b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp, highestHp: (a,b) => b.hp / b.s.maxHp - a.hp / a.s.maxHp,
    uid: (a,b) => uid(a).localeCompare(uid(b)), nearest: (a,b) => { const [ar,ac]=tileOf(a),[br,bc]=tileOf(b),[ur,uc]=tileOf(anchor); return Math.abs(ar-ur)+Math.abs(ac-uc)-Math.abs(br-ur)-Math.abs(bc-uc); } };
  return list.sort((a,b) => order[selection](a,b) || uid(a).localeCompare(uid(b))).slice(0, count);
}

export function damage(battle, unit, target, { scale, amount, type = 'phys', hits = 1, defIgnoreFlat, defIgnorePct, resIgnoreFlat, resIgnorePct, crit, isSkill = false, sourceKey, cause, element, canDodge, traitAlly } = {}) {
  if (!Number.isInteger(hits) || hits < 1 || hits > 100) INVALID('damage hit count');
  if ((scale == null) === (amount == null)) INVALID('damage scale or amount');
  if (!['phys','arts','true','element','elemental'].includes(type)) throw new TypeError(`unknown damage type ${type}`);
  if (scale != null && !Number.isFinite(scale) || amount != null && (!Number.isFinite(amount) || amount < 0)) INVALID('damage amount');
  if (traitAlly != null && (!['op','token'].includes(traitAlly.kind) || traitAlly.side !== 'ally'
    || traitAlly.ownerId !== unit.ownerId || !battle.allyUnits.includes(traitAlly))) INVALID('damage trait ally');
  const total = [];
  for (let i = 0; i < hits && target.alive; i++) {
    const hitAmount = amount ?? unit.s.atk * scale;
    const critMul = typeof crit === 'function' ? crit({ battle, unit, target, index: i }) : (Number.isFinite(crit) ? crit : 1);
    const result = runtimeOf(battle).withCause(cause, () => battle.dealDamage(unit, target, { amount: hitAmount * critMul, type, isSkill, attackId: sourceKey,
      defIgnoreFlat, defIgnorePct, resIgnoreFlat, resIgnorePct, element, canDodge, traitAlly }));
    total.push(Number.isFinite(result) ? result : 0);
  }
  return total.reduce((a,b) => a+b, 0);
}

export function heal(battle, unit, target, { scale, amount, maxHpRatio, sourceKey, regen = false, ignoreHealFree = false, cause } = {}) {
  const fields = [scale, amount, maxHpRatio].filter((x) => x != null);
  if (fields.length !== 1 || fields.some((x) => !Number.isFinite(x) || x < 0)) INVALID('heal scalar');
  const raw = scale != null ? unit.s.atk * scale : amount ?? target.s.maxHp * maxHpRatio;
  return runtimeOf(battle).withCause(cause, () => battle.heal(unit, target, raw, { self: regen || unit === target, regen, ...(ignoreHealFree ? { ignoreHealFree: true } : {}) }));
}

const MOD_KEYS = new Set([...ADD_KEYS, ...MUL_KEYS]);
export function buff(battle, unit, target, { key, mods, flags = null, duration = Infinity, stacking = 'replace', maxStacks = 1, persist = false, allowDead = false, notify = true, cause } = {}) {
  if (typeof key !== 'string' || !key || !object(mods) || !Number.isFinite(duration) && duration !== Infinity || duration <= 0) INVALID('buff spec');
  for (const k of Object.keys(mods)) if (!MOD_KEYS.has(k)) throw new TypeError(`unknown buff stat ${k}`);
  if (flags && !object(flags)) INVALID('buff flags');
  if (flags) for (const k of Object.keys(flags)) if (!FLAG_KEYS.includes(k)) throw new TypeError(`unknown buff flag ${k}`);
  const refresh = stacking === 'replace' ? 'replace' : stacking;
  if (!['replace','extend','stack','independent','keep'].includes(refresh)) throw new TypeError(`unknown buff stacking ${stacking}`);
  const entry = battle.addBuff(target, { key, mods, flags, duration, refresh, maxStacks, persist, allowDead, visible: !!notify, source: unit });
  if (cause && entry) entry.data = { ...(entry.data ?? {}), assaultCause: cause };
  return entry;
}

export function applyStatus(battle, unit, target, { status, duration, value = 1, key, cause } = {}) {
  if (typeof status !== 'string' || !status || !Number.isFinite(duration) && duration !== Infinity || duration <= 0) INVALID('status');
  const nativeStatus = status === 'frozen' ? 'freeze' : status;
  return runtimeOf(battle).withCause(cause, () => battle.applyStatus(target, nativeStatus, { duration, value, instanceKey: key, source: unit }));
}

export function haste(battle, unit, target, seconds, key, { cause } = {}) {
  if (!Number.isFinite(seconds) || seconds <= 0 || typeof key !== 'string' || !key) INVALID('haste');
  const sharedKey = 'assault:haste:shared';
  let entry = target.buffs?.find(existing => existing.key === sharedKey && existing.timeLeft > 0);
  if (entry) { entry.timeLeft += seconds; entry.duration += seconds; }
  else entry = buff(battle, target, target, { key: sharedKey, mods: { spRecoveryMul: 2 }, duration: seconds, cause, notify: false });
  if (entry) {
    const data = entry.data ??= {};
    const sources = data.hasteSources ??= [];
    if (!sources.includes(key)) sources.push(key);
  }
  if (entry) runtimeOf(battle).publish('hasteApplied', { source: unit, sourceUid: uid(unit), target,
    targetUid: uid(target), amount: seconds, remaining: entry.timeLeft, sourceKey: key }, { cause });
  return entry;
}

export function sp(battle, unit, target, amount, reason, key, cause) {
  if (!Number.isFinite(amount) || amount <= 0 || typeof reason !== 'string' || !reason || typeof key !== 'string' || !key) INVALID('SP gain');
  if (!target.skill || typeof target.skill.gainSp !== 'function') return 0;
  return runtimeOf(battle).withCause(cause, () => {
    const gained = target.skill.gainSp(amount, reason);
    if (gained > 0) runtimeOf(battle).publish('chargeGranted', { source: unit, sourceUid: uid(unit),
      target, targetUid: uid(target), amount: gained, sourceKey: key, reason });
    return gained;
  });
}

const costLedger = new WeakMap();
export function cooldowncost(battle, target, multiplier, key) {
  if (!target?.skill || !Number.isFinite(multiplier) || multiplier <= 0 || typeof key !== 'string' || !key) INVALID('cooldown cost');
  const bySource = costLedger.get(target.skill) ?? new Map();
  bySource.set(key, multiplier);
  costLedger.set(target.skill, bySource);
  // Skill.spCost applies the mode's absolute 0.5 SP floor after all modifiers.
  target.skill.spCostMul = [...bySource.values()].reduce((a,b) => a*b, 1);
  return target.skill.spCost;
}

export function recast(battle, target, { cause = runtimeOf(battle).currentCause, suppressRedeploy = true, force = true } = {}) {
  return runtimeOf(battle).cast(target, { extra: true, suppressRedeploy, force, cause });
}

export function redeploy(battle, unit, target = unit, ctx = {}) {
  if (ctx.suppressRedeploy) return false;
  return battle.skillRedeploy(target, { cause: ctx.cause ?? runtimeOf(battle).currentCause });
}

export function payDP(battle, target, amount, key, cause) {
  if (!Number.isFinite(amount) || amount <= 0) INVALID('DP payment');
  const pid = target?.ownerId ?? target?.playerId ?? target;
  const player = battle.getPlayer(pid);
  if (!player) return 0;
  if (player.dp + 1e-9 < amount) return 0;
  const before = player.dp;
  battle.addDp(pid, -amount, 'assault');
  return before - player.dp;
}

export function gainDP(battle, target, amount, key, cause) {
  if (!Number.isFinite(amount) || amount <= 0) INVALID('DP gain');
  const pid = target?.ownerId ?? target?.playerId ?? target;
  const player = battle.getPlayer(pid);
  if (!player) return 0;
  const before = player.dp;
  battle.addDp(pid, amount, 'assault');
  const gained = player.dp - before;
  // 「由你的干员获得费用时」: the native dpReceived names the player only; this names the unit that gave the DP
  if (gained > 0 && target?.side === 'ally' && battle.assaultRuntime) battle.assaultRuntime.publish('dpGranted', { source: target,
    sourceUid: uid(target), target: player, targetUid: pid, amount: gained, sourceClass: 'dp' }, { cause: cause ?? battle.assaultRuntime.currentCause });
  return gained;
}

export function persistGrowth(battle, unit, target, { stat, flat = 0, percent = 0, counterKey, oncePerRun = false, claimKey } = {}) {
  if (typeof stat !== 'string' || !stat || !Number.isFinite(flat) || !Number.isFinite(percent) || (flat === 0 && percent === 0)) INVALID('permanent growth');
  if (!target || !uid(target)) INVALID('permanent growth target');
  const effectKey = claimKey ?? counterKey;
  if (oncePerRun && (typeof effectKey !== 'string' || !effectKey)) INVALID('permanent claim key');
  const key = `${effectKey ?? `${stat}:${flat}:${percent}`}`;
  const list = battle.assaultPermanentEffects ??= [];
  if (oncePerRun && list.some((x) => x.claimKey === effectKey && x.uid === uid(target))) return false;
  for (const [mode, amount] of [['flat', flat], ['percent', percent]]) {
    if (!amount) continue;
    const itemKey = `${stat}:${key}:${mode}`;
    const found = list.find((x) => x.uid === uid(target) && x.effectKey === itemKey);
    if (found) found.amount += amount;
    else list.push({ uid: uid(target), sourceUid: uid(unit), effectKey: itemKey, stat, amount, mode,
      ...(oncePerRun ? { oncePerRun: true, claimKey: effectKey, claimed: true } : null) });
  }
  return true;
}

export function onTimer(battle, unit, seconds, handler, { every = false, immediate = false } = {}) {
  if (!unit || typeof unit !== 'object') INVALID('timer owner');
  if (!Number.isFinite(seconds) || seconds <= 0 || typeof handler !== 'function') INVALID('timer');
  if (!active(unit)) {
    const diagnostics = battle.assaultRuntime?.diagnostics;
    if (diagnostics) {
      diagnostics.inactiveTimerSkipCount = (diagnostics.inactiveTimerSkipCount ?? 0) + 1;
      const samples = diagnostics.inactiveTimerSkips ??= [];
      if (samples.length < 128) samples.push({
      uid: uid(unit), charId: unit.def?.charId ?? unit.def?.raw?.charId ?? unit.charId ?? null,
      time: battle.time, seconds, every, alive: !!unit.alive, deployed: !!unit.deployed,
      hidden: !!unit.hidden, removed: !!unit.removed,
      });
    }
    return () => false;
  }
  let timer;
  const invoke = (b, schedule) => {
    if (!active(unit)) { schedule.cancel?.(); unit._assaultTimers?.delete(schedule); return; }
    return handler(b, schedule);
  };
  timer = every ? battle.every(seconds, invoke, { owner: unit, immediate }) : battle.after(seconds, invoke, { owner: unit });
  (unit._assaultTimers ??= new Set()).add(timer);
  return () => { timer.cancel?.(); unit._assaultTimers?.delete(timer); };
}
