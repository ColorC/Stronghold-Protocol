// Assault advanced modules.
//
// This file deliberately contains only the translated module delta.  The fixed
// skill, talents and mode passives remain owned by the Assault card builders.
// The builder calls these hooks around every real effect execution.

import { active, buff, damage, heal, onTimer, sp, uid, unitTag } from '../primitives.js';
import { assaultTokenKits } from './assault-tokens.js';
import { BAZAAR_MODULES, moduleParam } from './assault-bazaar.js';
import { COLS } from '../../../constants.js';
import { bodyInKeys } from '../../../body.js';

const DELEGATED_TO_MAIN = new Set([
  'uniequip_002_amiya2', 'uniequip_002_amiya3', 'uniequip_002_angel2',
  'uniequip_002_estell', 'uniequip_002_etlchi', 'uniequip_002_gvial2',
  'uniequip_002_humus', 'uniequip_002_robin', 'uniequip_002_skadi',
  'uniequip_002_surtr', 'uniequip_002_svrash', 'uniequip_002_swire2',
  'uniequip_002_thorn2', 'uniequip_002_tinman', 'uniequip_002_utage',
  'uniequip_003_etlchi', 'uniequip_003_skadi', 'uniequip_003_surtr',
]);

const MODULES = Object.freeze({
  char_237_gravel: ['uniequip_002_gravel'],
  char_308_swire: ['uniequip_002_swire'],
  char_265_sophia: ['uniequip_002_sophia'],
  char_154_morgan: ['uniequip_002_morgan'],
  char_155_tiger: ['uniequip_002_tiger'],
  char_140_whitew: ['uniequip_002_whitew'],
  char_294_ayer: ['uniequip_002_ayer'],
  char_143_ghost: ['uniequip_002_ghost'],
  char_356_broca: ['uniequip_002_broca'],
  char_4155_talr: ['uniequip_002_talr'],
  char_173_slchan: ['uniequip_002_slchan'],
  char_4036_forcer: ['uniequip_002_forcer'],
  char_4016_kazema: ['uniequip_002_kazema'],
  char_1028_texas2: ['uniequip_002_texas2', 'uniequip_003_texas2'],
  char_1033_swire2: ['uniequip_003_swire2', 'uniequip_004_swire2'],
  char_474_glady: ['uniequip_002_glady', 'uniequip_003_glady'],
  char_437_mizuki: ['uniequip_002_mizuki', 'uniequip_003_mizuki', 'uniequip_004_mizuki'],
  char_1023_ghost2: ['uniequip_002_ghost2', 'uniequip_003_ghost2', 'uniequip_004_ghost2'],
  char_4048_doroth: ['uniequip_002_doroth', 'uniequip_003_doroth'],
  char_264_f12yin: ['uniequip_002_f12yin', 'uniequip_003_f12yin'],
  char_2024_chyue: ['uniequip_002_chyue', 'uniequip_003_chyue'],
  char_4037_demetr: ['uniequip_002_demetr'],
  char_4082_qiubai: ['uniequip_002_qiubai', 'uniequip_003_qiubai'],
  char_4145_ulpia: ['uniequip_002_ulpia', 'uniequip_003_ulpia'],
  char_393_toledo: ['uniequip_002_toledo'],
  char_4232_hbound: ['uniequip_002_hbound'],
  char_4058_pepe: ['uniequip_002_pepe', 'uniequip_003_pepe'],
  char_4116_blkkgt: ['uniequip_002_blkkgt', 'uniequip_003_blkkgt'],
  char_1026_gvial2: ['uniequip_003_gvial2', 'uniequip_004_gvial2'],
  char_1019_siege2: ['uniequip_002_siege2', 'uniequip_003_siege2'],
  char_188_helage: ['uniequip_002_helage', 'uniequip_003_helage'],
  char_1014_nearl2: ['uniequip_002_nearl2', 'uniequip_003_nearl2'],
  char_1032_excu2: ['uniequip_002_excu2', 'uniequip_003_excu2'],
  char_4064_mlynar: ['uniequip_002_mlynar'],
});

const ALL_HANDLED = Object.freeze(Object.values(MODULES).flat());
const ALL_MODULE_IDS = new Set([...ALL_HANDLED, ...DELEGATED_TO_MAIN]);
const SUMMON_MODULES = new Set(['uniequip_002_kazema', 'uniequip_002_siege2', 'uniequip_003_siege2',
  'uniequip_002_nearl2', 'uniequip_003_nearl2']);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function inactiveHooks(meta = {}) {
  return {
    ...meta,
    beforeCast() {},
    beforeEffect() {},
    afterEffect() {},
    afterCast() {},
  };
}

function selectedModule(piece, charId) {
  if (!object(piece)) throw new TypeError('assault module piece must be an object');
  if (piece.moduleChoices != null && (!object(piece.moduleChoices) || Array.isArray(piece.moduleChoices))) {
    throw new TypeError(`${charId} moduleChoices must be a bodyId-to-moduleId map`);
  }
  const id = piece.moduleId ?? piece.moduleChoices?.[charId] ?? null;
  if (id != null && (typeof id !== 'string' || !id)) throw new TypeError(`${charId} moduleId must be a string`);
  return id;
}

function validateInput({ battle, unit, body, piece, rank }) {
  if (!battle || typeof battle.on !== 'function') throw new TypeError('assault module battle is invalid');
  if (!unit || !object(body) || !object(piece)) throw new TypeError('assault module unit/body/piece is invalid');
  if (typeof body.charId !== 'string' || !body.charId) throw new TypeError('assault module body.charId is required');
  if (!Number.isInteger(rank) || rank < 1 || rank > 4) throw new TypeError('assault module rank must be 1..4');
  const id = selectedModule(piece, body.charId);
  const plan = id == null ? null : (body.modulePlans ?? []).find((entry) => entry?.id === id);
  if (id != null && (!plan || plan.type !== 'ADVANCED')) throw new TypeError(`unknown ADVANCED module ${body.charId}/${id}`);
  if (id != null && !ALL_MODULE_IDS.has(id)) throw new TypeError(`unhandled ADVANCED module ${body.charId}/${id}`);
  return { id, plan };
}

function values(ctx) {
  if (!ctx || !object(ctx)) throw new TypeError('assault module effect context is invalid');
  const source = object(ctx.effect?.values) ? ctx.effect.values : {};
  if (!object(ctx.params)) ctx.params = { ...source };
  if (ctx.effect && ctx.effect.values !== ctx.params) ctx.effect = { ...ctx.effect, values: ctx.params };
  return ctx.params;
}

function value(ctx, key, fallback = undefined) {
  const v = values(ctx)[key];
  return v == null ? fallback : v;
}

function rankValue(ctx, raw, fallback = undefined) {
  if (Array.isArray(raw)) {
    if (raw.length !== 4) throw new TypeError('assault module value must have four ranks');
    return raw[ctx.rank - 1];
  }
  return raw == null ? fallback : raw;
}

function numberValue(ctx, key, fallback = 0) {
  const n = Number(rankValue(ctx, value(ctx, key), fallback));
  if (!Number.isFinite(n)) throw new TypeError(`invalid module value ${key}`);
  return n;
}

function addValue(ctx, key, amount) {
  const p = values(ctx);
  p[key] = numberValue(ctx, key, 0) + amount;
  if (key === 'atkScale' && Number.isFinite(ctx.damageScale)) ctx.damageScale = p[key];
  return p[key];
}

function multiplyValue(ctx, key, multiplier) {
  const p = values(ctx);
  p[key] = numberValue(ctx, key, 0) * multiplier;
  if (key === 'atkScale' && Number.isFinite(ctx.damageScale)) ctx.damageScale = p[key];
  return p[key];
}

function overrides(ctx, extra = {}) {
  return { params: ctx.params, effect: ctx.effect, targets: ctx.targets, damageScale: ctx.damageScale, ...extra };
}

function effectHas(ctx, key) { return Object.prototype.hasOwnProperty.call(values(ctx), key); }
function hitCount(ctx) { return Number.isFinite(ctx?.hitCount) ? ctx.hitCount : Array.isArray(ctx?.targets) ? ctx.targets.length : 0; }
function moduleKey(charId, moduleId, suffix) { return `assault:module:${charId}:${moduleId}:${suffix}`; }
function targetList(ctx) { return Array.isArray(ctx?.targets) ? ctx.targets.filter(Boolean) : []; }
function sideTargets(targets, side) { return targets.filter((target) => target?.side === side && target.alive); }
function controlled(target) {
  const flags = target?.s?.flags ?? {};
  const statuses = ['stun', 'freeze', 'sleep', 'root', 'bind', 'tremble', 'noMove'];
  return statuses.some((status) => flags[status] || target?.findBuff?.(status));
}
function silenced(target) { return !!target?.s?.flags?.silence; }
function near(a, b, radius) {
  if (!a || !b) return false;
  const ar = a.side === 'enemy' ? a.y : a.tileR ?? a.y, ac = a.side === 'enemy' ? a.x : a.tileC ?? a.x;
  const br = b.side === 'enemy' ? b.y : b.tileR ?? b.y, bc = b.side === 'enemy' ? b.x : b.tileC ?? b.x;
  return Math.abs(ar - br) <= radius && Math.abs(ac - bc) <= radius;
}
function alliesNear(battle, unit, radius = 1) {
  return battle.allyUnits.filter((candidate) => candidate !== unit && active(candidate) && near(candidate, unit, radius));
}
function applyNativeWhiteStats({ battle, unit, body, star, moduleId }) {
  const plan = (body.modulePlans ?? []).find(entry => entry.id === moduleId), equipLevel = star === 3 ? 2 : star === 4 ? 3 : null;
  const source = plan?.source?.nativeWhiteStatsByLevel?.find(entry => entry.equipLevel === equipLevel)
    ?? plan?.source?.nativeLevels?.find(entry => entry.equipLevel === equipLevel);
  if (!source) throw new TypeError(`${body.charId}/${moduleId} missing native white stats at equipLevel ${equipLevel}`);
  const mods = {};
  for (const attr of source.attributes ?? []) {
    if (attr.key === 'max_hp') mods.hpFlat = Number(attr.value) * 5;
    else if (attr.key === 'atk') mods.atkFlat = Number(attr.value);
    else if (attr.key === 'def') mods.defFlat = Number(attr.value);
  }
  if (!Object.keys(mods).length) throw new TypeError(`${body.charId}/${moduleId} native white stats are empty`);
  buff(battle, unit, unit, { key: `assault:module:${body.charId}:${moduleId}:native-white`, mods, persist: true, allowDead: true });
  return plan;
}
function installUlpia003({ battle, unit, body, star }) {
  const plan = (body.modulePlans ?? []).find((entry) => entry.id === 'uniequip_003_ulpia');
  const equipLevel = star === 3 ? 2 : star === 4 ? 3 : null;
  const native = plan?.source?.nativeLevels?.find((entry) => entry.equipLevel === equipLevel);
  if (!native) throw new TypeError(`Ulpia CRU-Y missing native equipLevel ${equipLevel} source`);
  const attribute = Object.fromEntries((native.attributes ?? []).map(entry => [entry.key, Number(entry.value)]));
  const candidate = native.parts.find(part => part.target === 'TALENT_DATA_ONLY')?.talentCandidates?.[0];
  const talent = Object.fromEntries((candidate?.blackboard ?? []).map(entry => [entry.key, Number(entry.value)]));
  const blockedTrait = native.parts.find(part => part.target === 'TRAIT')?.traitCandidates?.[0];
  const damageScale = Number(blockedTrait?.blackboard?.find(entry => entry.key === 'damage_scale')?.value);
  const maxStacks = talent.max_stack_cnt, hpPerKill = talent.max_hp, atkPerKill = talent.atk;
  const shareHp = talent['ulpia_t_1[abyssal].max_hp'], shareAtk = talent['ulpia_t_1[abyssal].atk'];
  const shareStacks = talent['ulpia_t_1[abyssal].max_stack_cnt'], blockBonus = talent.block_cnt, blockAt = talent.add_block_cnt_stack_cnt;
  if (![attribute.max_hp, attribute.atk, damageScale, maxStacks, hpPerKill, atkPerKill, shareHp, shareAtk, shareStacks, blockBonus, blockAt].every(Number.isFinite)
    || !(maxStacks > 0) || shareStacks !== maxStacks || blockAt !== maxStacks || !(damageScale >= 1))
    throw new TypeError('Ulpia CRU-Y native module parameters are incomplete or inconsistent');
  const key = 'assault:module:char_4145_ulpia:uniequip_003_ulpia';
  const shareKey = `${key}:abyssal-share`;
  const priorAllies = new Set();
  unit.mem.assaultUlpiaYStacks = Math.min(maxStacks, Number(unit.mem.assaultUlpiaYStacks) || 0);
  applyNativeWhiteStats({ battle, unit, body, star, moduleId: 'uniequip_003_ulpia' });
  const clearShares = () => { for (const ally of priorAllies) battle.removeBuff(ally, shareKey); priorAllies.clear(); };
  const refresh = () => {
    const stacks = unit.mem.assaultUlpiaYStacks ?? 0;
    buff(battle, unit, unit, { key: `${key}:owner-growth`, mods: { hpFlat: hpPerKill * 5 * stacks, atkFlat: atkPerKill * stacks,
      blockCnt: stacks >= blockAt ? blockBonus : 0 }, persist: true, allowDead: true });
    if (!active(unit)) { clearShares(); return; }
    const next = new Set(battle.allyUnits.filter(ally => ally !== unit && ally.ownerId === unit.ownerId && ally.kind === 'op' && unitTag(ally, 'abyssal')));
    for (const ally of priorAllies) if (!next.has(ally)) battle.removeBuff(ally, shareKey);
    priorAllies.clear();
    for (const ally of next) {
      priorAllies.add(ally);
      buff(battle, unit, ally, { key: shareKey, mods: { hpFlat: shareHp * 5 * stacks, atkFlat: shareAtk * stacks }, persist: true, allowDead: true });
    }
  };
  const listen = (name, fn) => battle.on(name, fn, { owner: unit });
  listen('hit', ({ source, target, dmg }) => {
    if (source === unit && active(unit) && target?.side === 'enemy' && target.blockedBy?.side === 'ally' && dmg) dmg.amount *= damageScale;
  });
  listen('death', ({ unit: dead, killer }) => {
    if (dead?.side !== 'enemy' || killer !== unit || !active(unit)) return;
    unit.mem.assaultUlpiaYStacks = Math.min(maxStacks, (unit.mem.assaultUlpiaYStacks ?? 0) + 1);
    refresh();
  });
  listen('deploy', ({ unit: deployed }) => { if (deployed === unit || deployed?.ownerId === unit.ownerId) refresh(); });
  listen('retreating', ({ unit: leaving }) => {
    if (leaving === unit) clearShares();
    else if (leaving?.ownerId === unit.ownerId) { battle.removeBuff(leaving, shareKey); priorAllies.delete(leaving); }
  });
  listen('death', ({ unit: dead }) => { if (dead === unit) clearShares(); });
  refresh();
}
function moduleHitScale(ctx, multiplier) {
  if (Number.isFinite(ctx.damageScale)) ctx.damageScale *= multiplier;
  else ctx.damageScale = multiplier;
  return overrides(ctx, { damageScale: ctx.damageScale });
}
function scaleHit(ctx, multiplier) {
  if (ctx.dmg && Number.isFinite(ctx.dmg.amount)) ctx.dmg.amount *= multiplier;
  if (Number.isFinite(ctx.amount)) ctx.amount *= multiplier;
}
function hitDamage(ctx, multiplier) {
  if (ctx.dmg && Number.isFinite(ctx.dmg.amount)) ctx.dmg.amount *= multiplier;
  else if (Number.isFinite(ctx.amount)) ctx.amount *= multiplier;
  else if (Number.isFinite(ctx.damageScale)) ctx.damageScale *= multiplier;
}

export function applyForcerHighlandModuleHit({ battle, unit, target, pushResult, rank, moduleId, cause = null }) {
  if (unit?.def?.charId !== 'char_4036_forcer' || moduleId !== 'uniequip_002_forcer' || rank < 3 ||
      !(pushResult?.moved > 0) || pushResult.collision?.kind !== 'highland' || !target?.alive) return false;
  return damage(battle, unit, target, { scale: 0.5, type: 'phys', isSkill: true,
    sourceKey: moduleKey(unit.def.charId, moduleId, `highland-hit:${uid(target)}`), cause });
}

function observe(battle, unit, type, key, handler) {
  if (battle.assaultRuntime?.observe) {
    return battle.assaultRuntime.observe(type, `${unit.def?.charId ?? unit.defId}:${uid(unit)}:${key}`,
      (event) => handler(event.payload, event.cause), { owner: unit });
  }
  return battle.on(type, (payload) => handler(payload, battle.assaultRuntime?.currentCause ?? null), { owner: unit });
}

function installOnce(unit, id) {
  const set = unit.mem ?? (unit.mem = {});
  const key = '__assaultModuleInstall';
  set[key] ??= new Set();
  if (set[key].has(id)) return false;
  set[key].add(id);
  return true;
}

function ensureNativeTokenKits(battle) {
  const assault = battle.opts?.assault;
  const registry = assault?.kits;
  if (!assault || !object(registry)) throw new TypeError('assault module requires an assault kit registry');
  const missing = Object.entries(assaultTokenKits).filter(([id]) => !Object.prototype.hasOwnProperty.call(registry, id));
  if (!missing.length) return;
  const target = Object.isExtensible(registry) ? registry : { ...registry };
  for (const [id, kit] of missing) target[id] = kit;
  if (target !== registry) assault.kits = target;
}

function baseHooks(charId, moduleId, battle, unit, body, piece, star) {
  const state = `${charId}:${moduleId}`;
  const hook = inactiveHooks({ active: true, charId, moduleId, delegatedToMain: false,
    consume: ['effect.values', 'params', 'targets', 'damageScale', 'hitCount'] });
  hook.beforeCast = (ctx = {}) => {
    unit.mem.assaultModuleState ??= {};
    unit.mem.assaultModuleState[state] = { castAt: battle.time, hitCount: 0, targets: [], cause: ctx.cause ?? null };
  };
  hook.afterEffect = (ctx = {}) => {
    const current = unit.mem.assaultModuleState?.[state];
    if (current && Number.isFinite(ctx.hitCount)) current.hitCount = Math.max(current.hitCount, ctx.hitCount);
    if (current && ctx.effect?.action === 'move') current.targets = targetList(ctx);
  };
  hook.afterCast = (ctx = {}) => {
    const current = unit.mem.assaultModuleState?.[state];
    if (current) current.lastHitCount = Math.max(current.hitCount, hitCount(ctx));
  };
  hook.install = () => {};
  return hook;
}

function installModuleEvents(moduleId, { battle, unit, body, piece, star }, hook) {
  if (!installOnce(unit, moduleId)) return;
  const id = body.charId;
  const listen = (name, fn) => battle.on(name, fn, { owner: unit });
  const observeOwned = (type, key, fn) => observe(battle, unit, type, key, fn);

  if (moduleId === 'uniequip_003_ulpia') {
    installUlpia003({ battle, unit, body, piece, star });
  } else if (moduleId === 'uniequip_002_toledo' || moduleId === 'uniequip_002_hbound') {
    applyNativeWhiteStats({ battle, unit, body, star, moduleId });
    if (moduleId === 'uniequip_002_toledo' && typeof battle.every === 'function' && false) { // 大巴扎：删去精英在场每秒技力
      onTimer(battle, unit, 1, (b) => {
        if (star < 3 || !active(unit) || !unit.skill) return;
        const targets = b.enemies.filter(enemy => active(enemy) && (enemy.isElite || enemy.isLeader) &&
          bodyInKeys(enemy, unit.rangeKeySet));
        if (targets.length) unit.skill.gainSp?.(0.25, 'toledo-module-elite', true);
      }, { every: true });
    }
  } else if (moduleId === 'uniequip_002_swire') {
    hook.afterCast = (ctx = {}) => {
      sp(battle, unit, unit, 1, 'moduleCast', moduleKey(id, moduleId, 'cast-sp'), ctx.cause);
    };
  } else if (moduleId === 'uniequip_002_tiger') {
    listen('dodge', (payload) => {
      if (payload?.target === unit && payload?.source?.side === 'enemy' && payload.dmg?.type === 'phys') unit.mem.assaultTigerNextSkillBonus = true;
    });
  } else if (moduleId === 'uniequip_002_whitew') {
    listen('hit', (payload) => {
      if (payload?.source !== unit || !silenced(payload.target)) return;
      hitDamage(payload, 1.15);
    });
  } else if (moduleId === 'uniequip_002_ayer') {
    listen('hit', (payload) => {
      if (payload?.source !== unit || payload?.dmg?.type !== 'arts') return;
      if (payload.target?.blockedBy?.side === 'ally') hitDamage(payload, 1.15);
    });
  } else if (moduleId === 'uniequip_002_ghost') {
    hook.afterCast = (ctx = {}) => {
      const duration = Number(ctx.undeathDuration ?? ctx.params?.undeathDuration ?? 0);
      if (!(duration > 0)) return;
      const generation = Number(unit.mem.assaultGhostUndeathGeneration ?? 0);
      const end = battle.time + duration;
      unit.mem.assaultGhostUndeathUntil = end;
      onTimer(battle, unit, 1, (b, timer) => {
        if (Number(unit.mem.assaultGhostUndeathGeneration ?? 0) !== generation || b.time >= end || !active(unit)) { timer.cancel?.(); return; }
        heal(b, unit, unit, { maxHpRatio: 0.1, sourceKey: moduleKey(id, moduleId, 'undeath-regen') });
      }, { every: true });
    };
  } else if (moduleId === 'uniequip_002_broca') {
    listen('hit', (payload) => {
      if (payload?.source === unit && payload?.dmg?.type === 'arts' && payload.target?.findBuff?.('sluggish')) hitDamage(payload, 1.1);
    });
  } else if (moduleId === 'uniequip_002_talr') {
    listen('statusApplied', (payload) => {
      if (payload?.source !== unit || payload?.target?.side !== 'enemy' || payload.status !== 'root') return;
      buff(battle, unit, payload.target, { key: moduleKey(id, moduleId, `root-speed:${uid(payload.target)}`), mods: { moveMul: 0.7 }, duration: Number(payload.duration) || 1 });
    });
  } else if (moduleId === 'uniequip_002_forcer') {
    hook.afterEffect = (ctx = {}) => {
      if (ctx.effect?.action !== 'move') return;
      const state = unit.mem.assaultModuleState?.[`${id}:${moduleId}`];
      if (state) state.targets = targetList(ctx);
    };
  } else if (moduleId === 'uniequip_002_kazema') {
    observeOwned('summonSpawned', 'kazema-shadow', (payload) => {
      if (payload?.source !== unit && payload?.sourceUid !== uid(unit)) return;
      const duration = Number(body.fixedSkill?.effects?.find((effect) => effect.action === 'summon')?.values?.duration?.[star - 1] ?? 20);
      buff(battle, unit, unit, { key: moduleKey(id, moduleId, 'shadow-aspd'), mods: { aspd: 10 }, duration });
    });
  } else if (moduleId === 'uniequip_002_texas2') {
    listen('hit', (payload) => {
      if (star < 4 || payload?.source !== unit || !payload?.dmg?.isSkill || !controlled(payload.target)) return;
      if (unit.mem.assaultTexasLandingUntil >= battle.time) hitDamage(payload, 1.2);
    });
  } else if (moduleId === 'uniequip_003_texas2') {
    // The old delayed sword-rain module effect is folded into the cast's hit.
  } else if (moduleId === 'uniequip_003_swire2') {
    listen('hit', (payload) => {
      if (payload?.source === unit && payload.dmg?.attackId === `${id}:delay`) hitDamage(payload, 1.15);
    });
  } else if (moduleId === 'uniequip_004_swire2') {
    listen('goldSpent', (payload) => {
      if (payload?.source !== unit) return;
      buff(battle, unit, unit, { key: moduleKey(id, moduleId, 'gold-attack'), mods: { atkPct: 0.005 }, duration: Infinity, stacking: 'stack', maxStacks: Number(body.modePassives?.[0]?.values?.maxStacks?.[star - 1] ?? 8) });
    });
  } else if (moduleId === 'uniequip_002_glady') {
    battle.assaultRuntime.observe('gladiaCenterDrag', moduleKey(id, moduleId, `center-drag:${uid(unit)}`), ({ payload, cause }) => {
      const { source, target, moved } = payload;
      if (star >= 4 && source === unit && moved > 0 && target?.alive) {
        damage(battle, unit, target, { scale: 0.5, type: 'arts', isSkill: true, sourceKey: moduleKey(id, moduleId, 'center-hit'), cause });
      }
    }, { owner: unit });
  } else if (moduleId === 'uniequip_002_mizuki') {
    hook.afterCast = (ctx = {}) => {
      if (star < 4 || (unit.mem.assaultLastSkillTargetCount ?? 0) >= 3) return;
      const ratio = Number(body.fixedSkill.effects.find((effect) => effect.values?.selfMaxHpCostRatio != null)?.values?.selfMaxHpCostRatio?.[star - 1] ?? 0);
      heal(battle, unit, unit, { amount: unit.s.maxHp * ratio, sourceKey: moduleKey(id, moduleId, 'low-hit-heal') });
    };
  } else if (moduleId === 'uniequip_002_ghost2') {
    listen('hit', (payload) => {
      if (payload?.source === unit && payload.dmg?.isSkill && unit.mem.assaultGhost2ActiveUntil > battle.time) heal(battle, unit, unit, { maxHpRatio: 0.02, sourceKey: moduleKey(id, moduleId, 'skill-hit-heal') });
    });
  } else if (moduleId === 'uniequip_004_ghost2') {
    observeOwned('summonSpawned', 'ghost2-burn', (payload) => {
      if (payload?.source !== unit && payload?.sourceUid !== uid(unit)) return;
      const token = payload.target;
      if (!token) return;
      onTimer(battle, unit, 2, (b, timer) => {
        if (!token.alive || !active(unit)) { timer.cancel?.(); return; }
        for (const target of b.enemies.filter((enemy) => enemy.alive && near(enemy, token, 1))) damage(b, unit, target, { scale: Number(body.modePassives?.[0]?.values?.dotScale?.[star - 1] ?? 0), type: 'arts', isSkill: true, sourceKey: moduleKey(id, moduleId, 'shadow-burn') });
      }, { every: true });
    });
  } else if (moduleId === 'uniequip_002_doroth') {
    // 童话书（大巴扎）：装置伤害 +x%，只在 beforeEffect 乘一次；不再改成长上限。
  } else if (moduleId === 'uniequip_002_f12yin') {
    hook.afterCast = (ctx = {}) => { if (hitCount(ctx) >= 3) sp(battle, unit, unit, 1, 'moduleHit', moduleKey(id, moduleId, 'three-hit-sp'), ctx.cause); };
  } else if (moduleId === 'uniequip_003_f12yin') {
    const key = moduleKey(id, moduleId, 'physical-dodge');
    const syncDodge = () => {
      if (!active(unit) || unit.findBuff?.(key)) return;
      buff(battle, unit, unit, { key, mods: { dodgePhys: 0.05 }, duration: Infinity, persist: true });
    };
    listen('battleStart', syncDodge);
    listen('deploy', ({ unit: deployed }) => { if (deployed === unit) syncDodge(); });
    syncDodge();
  } else if (moduleId === 'uniequip_003_chyue') {
    listen('kill', (payload) => {
      if (star >= 4 && payload?.killer === unit && unit.mem.assaultChyueSkillActive) sp(battle, unit, unit, 1, 'skillKill', moduleKey(id, moduleId, 'kill-sp'));
    });
  } else if (moduleId === 'uniequip_002_demetr') {
    observeOwned('hit', 'full-shred-hit', (payload, cause) => {
      if (payload?.sourceUid !== uid(unit) || typeof payload.attackId !== 'number' || !payload.target?.alive || !payload.target.buffs) return;
      const shred = payload.target.buffs.find((entry) => entry.key?.includes(`${id}:`));
      if (shred && shred.stacks >= shred.maxStacks && !unit.mem.assaultDemetrFullShred?.has(uid(payload.target))) {
        unit.mem.assaultDemetrFullShred ??= new Set();
        unit.mem.assaultDemetrFullShred.add(uid(payload.target));
        const key = moduleKey(id, moduleId, 'full-shred-hit');
        battle.assaultRuntime.enqueue((task) => damage(battle, unit, payload.target, { scale: 0.6, type: 'phys', isSkill: true,
          sourceKey: key, cause: task.cause }), { key, targetUid: uid(payload.target), sourceUid: uid(unit), cause });
      }
    });
  } else if (moduleId === 'uniequip_003_qiubai') {
    // 欲雪时（大巴扎）：只延长此干员攻击的束缚时间（beforeEffect），不再对受控敌人增伤。
  } else if (moduleId === 'uniequip_002_ulpia') {
    // The base Assault passive already owns the real damaged -> heal path.  The
    // module only changes its compiled values in beforeEffect below.
  } else if (moduleId === 'uniequip_003_pepe') {
    listen('kill', (payload) => { if (star >= 4 && payload?.killer === unit && unit.mem.assaultPepeSkillActive) sp(battle, unit, unit, 1, 'skillKill', moduleKey(id, moduleId, 'kill-sp')); });
  } else if (moduleId === 'uniequip_002_blkkgt') {
    listen('hit', (payload) => {
      if (payload?.source !== unit || !payload.target?.findBuff?.('tremble') || !payload.dmg) return;
      payload.dmg.defIgnorePct = (payload.dmg.defIgnorePct ?? 0) + moduleParam(unit, moduleId, 'd', 5) / 100;
    });
  } else if (moduleId === 'uniequip_004_gvial2') {
    // Assault represents the translated S3 as an instant cast plus a timed
    // damage-delay window; the generic Skill emits skillEnd at the instant
    // cast boundary, before that window has expired. The module's native
    // post-skill remainder reduction belongs at the window boundary instead.
  } else if (moduleId === 'uniequip_002_siege2') {
    listen('hit', (payload) => {
      if (star >= 4 && payload?.source === unit && payload.dmg?.type === 'true' && unit.mem.assaultSiegeSkillUntil > battle.time) hitDamage(payload, 1.1);
    });
  } else if (moduleId === 'uniequip_003_siege2') {
    hook.afterEffect = (ctx = {}) => {
      if (!effectHas(ctx, 'damageTypeOverride')) return;
      const targets = targetList(ctx).length ? targetList(ctx) : [unit, ...alliesNear(battle, unit, 1)];
      for (const target of targets) if (target?.side === 'ally') buff(battle, unit, target, { key: moduleKey(id, moduleId, `guard:${uid(target)}`), mods: { dmgTakenMul: 0.95 }, duration: numberValue(ctx, 'duration', 25) });
      const extra = Math.min(5, alliesNear(battle, unit, 2).length);
      if (extra) buff(battle, unit, unit, { key: moduleKey(id, moduleId, 'ally-attack'), mods: { atkPct: extra * 0.01 }, duration: numberValue(ctx, 'duration', 25) });
    };
  } else if (moduleId === 'uniequip_002_excu2') {
    unit.mem.assaultExcuFinalTargetBonus = star >= 4 ? 2 : 0;
  } else if (moduleId === 'uniequip_003_excu2') {
    unit.mem.assaultExcuTraitHealBonus = star >= 4 ? 1 : 0;
  }
}

function makeModuleHooks({ battle, unit, body, piece, star, moduleId }) {
  const hook = baseHooks(body.charId, moduleId, battle, unit, body, piece, star);
  const id = body.charId;
  hook.install = () => installModuleEvents(moduleId, { battle, unit, body, piece, star }, hook);

  hook.beforeCast = (ctx = {}) => {
    baseHooks(id, moduleId, battle, unit, body, piece, star).beforeCast(ctx);
    if (moduleId === 'uniequip_002_texas2') unit.mem.assaultTexasLandingUntil = battle.time + 0.25;
    if (moduleId === 'uniequip_003_chyue') unit.mem.assaultChyueSkillActive = true;
    if (moduleId === 'uniequip_003_pepe') unit.mem.assaultPepeSkillActive = true;
    if (moduleId === 'uniequip_002_whitew') unit.mem.assaultWhitewSkillHits = 0;
    if (moduleId === 'uniequip_002_ghost2') unit.mem.assaultGhost2ActiveUntil = battle.time + 0.01;
  };

  hook.beforeEffect = (ctx = {}) => {
    const p = values(ctx);
    if (moduleId === 'uniequip_002_gravel') {
      if (effectHas(ctx, 'defRatio')) p.duration = 15;
    } else if (moduleId === 'uniequip_002_swire') {
      if (effectHas(ctx, 'atkBonus')) { p.radius = 1; addValue(ctx, 'atkBonus', 0.05); }
      if (effectHas(ctx, 'atkBonus') && Array.isArray(ctx.targets)) ctx.targets = [...ctx.targets, ...alliesNear(battle, unit, 1)];
    } else if (moduleId === 'uniequip_002_sophia') {
      if (effectHas(ctx, 'blockBonus')) addValue(ctx, 'blockBonus', 1);
      if (effectHas(ctx, 'perSecondCap')) multiplyValue(ctx, 'atkScale', 1.1);
    } else if (moduleId === 'uniequip_002_morgan') {
      if (effectHas(ctx, 'selfMaxHpCostRatio')) p.selfMaxHpCostRatio = 0.6;
      if (effectHas(ctx, 'barrierRatio')) addValue(ctx, 'barrierRatio', 0.1);
    } else if (moduleId === 'uniequip_002_tiger') {
      if (effectHas(ctx, 'atkScale') && unit.mem.assaultTigerNextSkillBonus) { multiplyValue(ctx, 'atkScale', 1.15); unit.mem.assaultTigerNextSkillBonus = false; }
      if (effectHas(ctx, 'healScale')) p.healScale = 0.35;
    } else if (moduleId === 'uniequip_002_whitew') {
      if (effectHas(ctx, 'maxTarget')) p.maxTarget = numberValue(ctx, 'maxTarget');
    } else if (moduleId === 'uniequip_002_ayer') {
      if (effectHas(ctx, 'perSecondCap')) {
        const n = Math.min(5, alliesNear(battle, unit, 1).length);
        multiplyValue(ctx, 'atkScale', 1 + n * 0.03);
      }
    } else if (moduleId === 'uniequip_002_ghost') {
      if (effectHas(ctx, 'stunDuration')) addValue(ctx, 'stunDuration', -1);
    } else if (moduleId === 'uniequip_002_broca') {
      const realSkillHits = Math.max(0, Number(unit.mem.assaultLastSkillHitTargetCount ?? 0) || 0);
      if (effectHas(ctx, 'atkBonus')) addValue(ctx, 'atkBonus', 0.03 * realSkillHits);
      if (effectHas(ctx, 'defBonus')) addValue(ctx, 'defBonus', 0.03 * realSkillHits);
    } else if (moduleId === 'uniequip_002_talr') {
      if (effectHas(ctx, 'deployPointCost')) p.deployPointCost = Math.max(1, numberValue(ctx, 'deployPointCost') - 1);
    } else if (moduleId === 'uniequip_002_slchan') {
      if (effectHas(ctx, 'maxTarget')) addValue(ctx, 'maxTarget', 1);
      // The bonus stun is conditional on a real enemy-to-enemy pull collision.
      // It is applied by the collision result handler, never to every pulled target.
    } else if (moduleId === 'uniequip_002_forcer') {
      if (effectHas(ctx, 'pushForce')) addValue(ctx, 'pushForce', 1);
      // The mode passive is an applyStatus effect whose translated field is
      // `extraStun`. Battle's typed status executor consumes stunDuration;
      // leave the source object untouched and provide the consumed override.
      if (effectHas(ctx, 'extraStun')) p.stunDuration = numberValue(ctx, 'extraStun');
      if (effectHas(ctx, 'stunDirect') || effectHas(ctx, 'stunCollision') || effectHas(ctx, 'stunWall')) {
        const state = unit.mem.assaultModuleState?.[`${body.charId}:${moduleId}`];
        if (state?.targets?.length) ctx.targets = [...state.targets];
        p.stunDuration = numberValue(ctx, 'stunDirect', numberValue(ctx, 'stunCollision', numberValue(ctx, 'stunWall', 1)));
      }
    } else if (moduleId === 'uniequip_002_kazema') {
      if (effectHas(ctx, 'atkScale')) multiplyValue(ctx, 'atkScale', 1.15);
      if (effectHas(ctx, 'summonAtkScale')) p.summonAtkScale = numberValue(ctx, 'summonAtkScale');
    } else if (moduleId === 'uniequip_002_texas2') {
      if (effectHas(ctx, 'maxTarget')) addValue(ctx, 'maxTarget', 1);
    } else if (moduleId === 'uniequip_003_texas2') {
      if (id === 'char_1028_texas2' && effectHas(ctx, 'atkScale')) multiplyValue(ctx, 'atkScale', 1.05);
      else if (effectHas(ctx, 'atkBonus')) addValue(ctx, 'atkBonus', 0.05);
    } else if (moduleId === 'uniequip_003_swire2') {
      if (effectHas(ctx, 'atkScale')) multiplyValue(ctx, 'atkScale', 1.15);
      if (effectHas(ctx, 'goldCost') && star >= 4) p.goldCost = Math.min(numberValue(ctx, 'goldCost'), 4);
    } else if (moduleId === 'uniequip_004_swire2') {
      if (effectHas(ctx, 'goldCap')) addValue(ctx, 'goldCap', 1);
    } else if (moduleId === 'uniequip_002_glady') {
      if (effectHas(ctx, 'duration')) addValue(ctx, 'duration', 2);
    } else if (moduleId === 'uniequip_003_glady') {
      if (ctx.effect?.action === 'damage' && numberValue(ctx, 'interval', 0) > 0) addValue(ctx, 'radius', 0.3);
      if (effectHas(ctx, 'perSecondCap') && star >= 4) p.perSecondCap = 2;
    } else if (moduleId === 'uniequip_002_mizuki') {
      if (effectHas(ctx, 'maxTarget')) addValue(ctx, 'maxTarget', 1);
      if (effectHas(ctx, 'selfMaxHpCostRatio') && star >= 4) p.selfMaxHpCostRatio = 0;
    } else if (moduleId === 'uniequip_003_mizuki') {
      if (effectHas(ctx, 'extraAtkScale')) addValue(ctx, 'extraAtkScale', 0.05);
    } else if (moduleId === 'uniequip_004_mizuki') {
      if (effectHas(ctx, 'rangeExtend')) addValue(ctx, 'rangeExtend', 0.5);
      if (effectHas(ctx, 'stunDuration')) addValue(ctx, 'stunDuration', 0.3);
    } else if (moduleId === 'uniequip_002_ghost2') {
      if (effectHas(ctx, 'duration') && effectHas(ctx, 'summonName')) addValue(ctx, 'duration', 5);
    } else if (moduleId === 'uniequip_003_ghost2') {
      if (effectHas(ctx, 'atkScale')) multiplyValue(ctx, 'atkScale', 1.1);
      if (effectHas(ctx, 'slow')) addValue(ctx, 'slow', 0.1);
    } else if (moduleId === 'uniequip_004_ghost2') {
      if (effectHas(ctx, 'maxHpBonus')) addValue(ctx, 'maxHpBonus', 0.05);
      if (effectHas(ctx, 'barrierRatio')) addValue(ctx, 'barrierRatio', 0.05);
    } else if (moduleId === 'uniequip_002_doroth') {
      if (effectHas(ctx, 'atkScale') && ctx.effect?.trigger === '共振装置被踩中') multiplyValue(ctx, 'atkScale', 1 + moduleParam(unit, moduleId, 'x', 10) / 100);
    } else if (moduleId === 'uniequip_003_doroth') {
      if (effectHas(ctx, 'sluggishDuration')) addValue(ctx, 'sluggishDuration', moduleParam(unit, moduleId, 't', 1));
    } else if (moduleId === 'uniequip_002_f12yin') {
      if (effectHas(ctx, 'duration') && effectHas(ctx, 'targetAtkDown') && star >= 4) addValue(ctx, 'duration', 2);
    } else if (moduleId === 'uniequip_003_f12yin') {
      if (effectHas(ctx, 'talentProbBonus')) addValue(ctx, 'talentProbBonus', 0.05);
    } else if (moduleId === 'uniequip_002_chyue') {
      if (effectHas(ctx, 'threshold')) p.threshold = 4;
      if (effectHas(ctx, 'talentAtkScale') && star >= 4) addValue(ctx, 'talentAtkScale', 0.15);
    } else if (moduleId === 'uniequip_003_chyue') {
      if (effectHas(ctx, 'prob')) addValue(ctx, 'prob', 0.03);
    } else if (moduleId === 'uniequip_002_demetr') {
      unit.mem.assaultDemetrNoDeploySlot = true;
    } else if (moduleId === 'uniequip_002_qiubai') {
      if (effectHas(ctx, 'extraTargets')) addValue(ctx, 'extraTargets', 1);
    } else if (moduleId === 'uniequip_003_qiubai') {
      if (effectHas(ctx, 'rootDuration') && ctx.effect?.values?.prob != null) addValue(ctx, 'rootDuration', moduleParam(unit, moduleId, 't', 0.5));
    } else if (moduleId === 'uniequip_002_ulpia') {
      if (effectHas(ctx, 'healPerHit')) addValue(ctx, 'healPerHit', 20);
      if (effectHas(ctx, 'lowHpHeal') && star >= 4) p.lowHpHeal = numberValue(ctx, 'healPerHit') * 1.6;
    } else if (moduleId === 'uniequip_002_pepe') {
      if (effectHas(ctx, 'maxStacks')) addValue(ctx, 'maxStacks', 1);
      if (effectHas(ctx, 'stunMain') && star >= 4) addValue(ctx, 'stunMain', 0.3);
    } else if (moduleId === 'uniequip_003_pepe') {
      if (effectHas(ctx, 'atkPerStack')) addValue(ctx, 'atkPerStack', 0.03);
    } else if (moduleId === 'uniequip_002_blkkgt') {
      // 卡面只写对战栗的敌人无视 d% 防御（hit 监听），不再有 4★ 额外段数。
    } else if (moduleId === 'uniequip_003_blkkgt') {
      if (effectHas(ctx, 'endForce') && star >= 4) addValue(ctx, 'endForce', 1);
    } else if (moduleId === 'uniequip_003_gvial2') {
      if (effectHas(ctx, 'blockBonus')) addValue(ctx, 'blockBonus', 1);
      if (effectHas(ctx, 'perExtraBlock') && star >= 4) addValue(ctx, 'perExtraBlock', 0.01);
    } else if (moduleId === 'uniequip_004_gvial2') {
      if (effectHas(ctx, 'atkBonus') && star >= 3) addValue(ctx, 'atkBonus', 0.03);
      if (effectHas(ctx, 'barrierRatio') && star >= 3) multiplyValue(ctx, 'barrierRatio', 1.03);
    } else if (moduleId === 'uniequip_002_siege2') {
      if (effectHas(ctx, 'duration') && effectHas(ctx, 'summonCount')) addValue(ctx, 'duration', 5);
      if (effectHas(ctx, 'damageTypeOverride')) unit.mem.assaultSiegeSkillUntil = battle.time + numberValue(ctx, 'duration', 25);
    } else if (moduleId === 'uniequip_003_siege2') {
      if (effectHas(ctx, 'damageReduction')) addValue(ctx, 'damageReduction', 0.05);
    } else if (moduleId === 'uniequip_002_helage') {
      if (effectHas(ctx, 'maxTarget')) addValue(ctx, 'maxTarget', 1);
      if (effectHas(ctx, 'attackSpeedBonus') && star >= 4) addValue(ctx, 'attackSpeedBonus', 10);
    } else if (moduleId === 'uniequip_003_helage') {
      if (effectHas(ctx, 'healPerSec')) addValue(ctx, 'healPerSec', moduleParam(unit, moduleId, 'r', 20));
      unit.mem.assaultHelageMaxLossReduction = 0; // 卡面无 4★ 附带减伤
    } else if (moduleId === 'uniequip_002_nearl2') {
      if (star >= 4 && effectHas(ctx, 'duration') && effectHas(ctx, 'summonCount')) addValue(ctx, 'duration', 5);
      if (effectHas(ctx, 'atkScale') && effectHas(ctx, 'radius') && !effectHas(ctx, 'kazimierzExtra')) multiplyValue(ctx, 'atkScale', 1.1);
    } else if (moduleId === 'uniequip_003_nearl2') {
      if (effectHas(ctx, 'kazimierzExtra') && !unit.mem.assaultNearlExtraUsed) {
        multiplyValue(ctx, 'atkScale', star >= 4 ? 2 : 1.1);
        unit.mem.assaultNearlExtraUsed = true;
      } else if (effectHas(ctx, 'atkScale') && effectHas(ctx, 'radius') && !unit.mem.assaultNearlExtraUsed) {
        multiplyValue(ctx, 'atkScale', star >= 4 ? 2 : 1.1);
        unit.mem.assaultNearlExtraUsed = true;
      }
    } else if (moduleId === 'uniequip_002_excu2') {
      if (effectHas(ctx, 'ammoCount') && !effectHas(ctx, 'instantCast')) addValue(ctx, 'ammoCount', 2);
      if (star >= 4 && effectHas(ctx, 'finalAtkScale')) p.maxTarget = numberValue(ctx, 'maxTarget', 1) + 2;
    } else if (moduleId === 'uniequip_003_excu2') {
      if (effectHas(ctx, 'maxStacks')) addValue(ctx, 'maxStacks', 5);
      if (star >= 4 && effectHas(ctx, 'traitHealMultiplier')) addValue(ctx, 'traitHealMultiplier', 1);
    } else if (moduleId === 'uniequip_002_mlynar') {
      if (effectHas(ctx, 'extraTrueAtkScale')) addValue(ctx, 'extraTrueAtkScale', 0.03);
      if (star >= 4 && effectHas(ctx, 'traitMultiplier')) ctx.params.traitBonusLossPerKill = 0;
    }
    return overrides(ctx);
  };

  hook.afterCast = (ctx = {}) => {
    if (moduleId === 'uniequip_003_blkkgt' && hitCount(ctx) >= 3)
      sp(battle, unit, unit, 1, 'multiHit', moduleKey(id, moduleId, 'three-target-sp'), ctx.cause);
    if (moduleId === 'uniequip_002_whitew' && (unit.mem.assaultLastSkillHitTargetCount ?? 0) >= 2)
      sp(battle, unit, unit, 1, 'moduleHit', moduleKey(id, moduleId, 'two-hit-sp'), ctx.cause);
    if (moduleId === 'uniequip_003_chyue') unit.mem.assaultChyueSkillActive = false;
    if (moduleId === 'uniequip_003_pepe') unit.mem.assaultPepeSkillActive = false;
    if (moduleId === 'uniequip_002_ghost2') unit.mem.assaultGhost2ActiveUntil = -Infinity;
    if (moduleId === 'uniequip_002_demetr') unit.mem.assaultDemetrNoDeploySlot = true;
    if (moduleId === 'uniequip_003_swire2' && star >= 4) unit.mem.assaultSwireGoldSequence = [4, 8];
    if (moduleId === 'uniequip_004_swire2') unit.mem.assaultSwireGoldCapBonus = 1;
  };
  return hook;
}

export function installAssaultModule({ battle, unit, body, piece, rank }) {
  const { id } = validateInput({ battle, unit, body, piece, rank });
  if (id == null || rank < 3) return inactiveHooks({ charId: body.charId, moduleId: id, active: false });
  if (DELEGATED_TO_MAIN.has(id)) return inactiveHooks({ charId: body.charId, moduleId: id, active: true, delegatedToMain: true });
  // 大巴扎模组行：由 assault-bazaar.js 按卡面实现，旧的模组增量不再安装。
  if (BAZAAR_MODULES.has(id)) return inactiveHooks({ charId: body.charId, moduleId: id, active: true, bazaar: true });
  if (SUMMON_MODULES.has(id)) ensureNativeTokenKits(battle);
  const hook = makeModuleHooks({ battle, unit, body, piece, star: rank, moduleId: id });
  hook.install();
  return hook;
}

export const assaultAdvancedModuleIds = Object.freeze({
  delegatedToMain: Object.freeze([...DELEGATED_TO_MAIN]),
  handledHere: Object.freeze([...ALL_HANDLED]),
});

export const assaultAdvancedModuleCount = ALL_MODULE_IDS.size;
