import { makeKit, v, active, enemies, allies, damage, heal, buff, applyStatus, haste, sp, queue, watch, persistGrowth, onTimer, unitTag, uid } from '../primitives.js';
import { grantSummon } from '../summons.js';
import { COLS } from '../../../constants.js';
import { aggroCmp, canTargetEnemy, tileKeyOf, absoluteRangeKeys } from '../../../targeting.js';
import { assaultTokenKits } from './assault-tokens.js';
import { applyForcerHighlandModuleHit, installAssaultModule } from './assault-modules.js';
import { BAZAAR_MODULES, BAZAAR_REPLACED_PASSIVES, bazaarKeepsEffect, installAssaultBazaar, lineParam, moduleParam } from './assault-bazaar.js';
import { assaultAmmoState, consumeAssaultAmmo, registerAssaultAmmo, setAssaultAmmoCapacityBonus, unregisterAssaultAmmo } from '../ammo.js';
import { hypot, roundHalfEven } from '../../../detmath.js';
import { bodyDist, bodyInKeys } from '../../../body.js';
import { AURA, enemyHasTag, whileDeployed, pulse } from '../../kits/shared/tier4.js';
import { applyDamageIncrease } from '../../../../../shared/damageIncrease.js';

const IDS = [
  'char_127_estell','char_337_utage','char_491_humus','char_237_gravel','char_308_swire','char_265_sophia','char_154_morgan','char_155_tiger','char_140_whitew','char_294_ayer','char_143_ghost','char_356_broca','char_4155_talr','char_173_slchan','char_4036_forcer','char_451_robin','char_4016_kazema','char_4151_tinman','char_4191_tippi','char_1028_texas2','char_1033_swire2','char_1041_angel2','char_474_glady','char_437_mizuki','char_1023_ghost2','char_4048_doroth','char_1039_thorn2','char_264_f12yin','char_2024_chyue','char_4037_demetr','char_172_svrash','char_4082_qiubai','char_4145_ulpia','char_4058_pepe','char_4116_blkkgt','char_1026_gvial2','char_350_surtr','char_1019_siege2','char_188_helage','char_1014_nearl2','char_1032_excu2','char_4010_etlchi','char_4064_mlynar','char_263_skadi','char_1001_amiya2','char_1037_amiya3',
];
const num = (unit, values, fallback = null) => values == null ? fallback : Number(v(unit, values));
const list = (battle, unit, effect, { count = null, scope = 'range', priority = 'exit', anchor = unit } = {}) => {
  const texasLanding = unit.def.charId === 'char_1028_texas2' && effect.action === 'damage'
    && effect.values?.atkScalePerHit != null;
  const limit = texasLanding ? battle.enemies.length : count ?? num(unit, effect.values?.maxTarget, 1);
  if (unit.def.charId === 'char_173_slchan' && scope === 'range') {
    const grid = unit.def.raw.assaultBody.fixedSkill.runtime.sourceRangeGrid;
    if (!Array.isArray(grid) || !grid.length) throw new TypeError('Cliffheart requires her compiled native skill range');
    anchor = { ...unit, rangeKeys: absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, Number(unit.s.rangeExtend) || 0) };
  }
  if (unit.def.charId === 'char_491_humus' && effect.action === 'damage')
    return (unit.blocking ?? []).filter(target => target.alive && target.blockedBy === unit).slice(0, limit);
  if (unit.def.charId === 'char_1023_ghost2' && effect.action === 'damage') {
    const candidates = effect.values?.extraAtkScale != null
      ? (unit.mem.assaultLastSkillTargets ?? []).filter(target => target.alive &&
        target.hp / target.s.maxHp + 1e-9 >= unit.hp / unit.s.maxHp)
      : battle.blockedTargets(unit, unit.profile);
    return candidates.slice(0, limit);
  }
  const selected = enemies(battle, unit, { scope, anchor, count: unit.def.charId === 'char_294_ayer' ? 99 : limit, priority });
  return unit.def.charId === 'char_294_ayer' ? selected.filter(target => target.blockedBy?.side === 'ally').slice(0, limit) : selected;
};
const targetsFor = (battle, unit, effect) => {
  if (unit.def.charId === 'char_474_glady' && effect.values?.rootDuration != null)
    return enemies(battle, unit, { scope: 'range', count: 99 }).sort((a, b) =>
      bodyDist(b, unit.x, unit.y) - bodyDist(a, unit.x, unit.y) || a.id - b.id)
      .slice(0, num(unit, effect.values.maxTarget));
  if (unit.def.charId === 'char_173_slchan' && ['damage', 'applyStatus'].includes(effect.action)
    && Array.isArray(unit.mem.assaultSlchanPullTargets))
    return unit.mem.assaultSlchanPullTargets.filter(target => target.alive);
  if (['char_140_whitew', 'char_437_mizuki'].includes(unit.def.charId) && effect.action === 'applyStatus')
    return (unit.mem.assaultLastSkillHitTargets ?? []).filter(target => target.alive);
  if (unit.def.charId === 'char_294_ayer' && effect.action === 'applyStatus')
    return (unit.mem.assaultLastSkillTargets ?? []).filter(target => target.alive);
  if (unit.def.charId === 'char_1028_texas2' && effect.action === 'applyStatus' && effect.values?.stunDuration != null)
    return (unit.mem.assaultLastSkillTargets ?? []).filter(target => target.alive);
  const values = effect.values ?? {};
  const max = num(unit, values.maxTarget ?? values.extraTargets ?? values.times, 1);
  const scope = values.radius ? 'adjacent8' : 'range';
  if (['char_188_helage', 'char_172_svrash', 'char_4064_mlynar', 'char_437_mizuki'].includes(unit.def.charId) && effect.action === 'damage' && num(unit, values.rangeExtend, 0) > 0) {
    const grid = unit.skill?.spec?.targeting?.rangeGrid || unit.rangeGrid || [];
    const extension = Number(unit.s?.rangeExtend ?? 0) + num(unit, values.rangeExtend, 0);
    const extend = unit.def.charId === 'char_437_mizuki' ? Math.max(0, Math.round(extension)) : extension;
    const keys = absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, extend);
    for (const key of unit.extraRangeKeys ?? []) if (!keys.includes(key)) keys.push(key);
    const anchor = { ...unit, rangeKeys: keys };
    return list(battle, unit, effect, { count: Math.max(1, max), scope, anchor });
  }
  return list(battle, unit, effect, { count: Math.max(1, max), scope });
};
const physical = (values) => ({ phys: 'phys', arts: 'arts', magic: 'arts', true: 'true', elemental: 'element', '物理': 'phys', '法术': 'arts', '真实': 'true' }[values.damageType ?? values.dmgType] ?? 'phys');
const physicalFor = (unit, values) => physical({ damageType: values.damageType == null && values.dmgType == null ? undefined : v(unit, values.damageType ?? values.dmgType) });
function deviceTile(battle, unit) {
  const enemiesNow = battle.enemies.filter((e) => e.alive);
  const keys = unit.rangeKeys ?? [];
  const tiles = keys.map((key) => [Math.floor(key / COLS), key % COLS]).filter(([r, c]) => battle.grid.inRect(r, c) && battle.grid.isLow(r, c) &&
    !battle._occ[r * COLS + c]?.alive && !battle.downOn(r, c));
  tiles.sort((a, b) => {
    const da = enemiesNow.length ? Math.min(...enemiesNow.map((e) => hypot(e.y - a[0], e.x - a[1]))) : 0;
    const db = enemiesNow.length ? Math.min(...enemiesNow.map((e) => hypot(e.y - b[0], e.x - b[1]))) : 0;
    return da - db;
  });
  return tiles[0] ?? null;
}
// tileR/tileC retain the deployment cell; moving enemies use their native current position.
const nearTile = (unit, tile, radius) => hypot(unit.y - tile[0], unit.x - tile[1]) <= radius;
function executeDevice({ battle, unit, effect, cause }) {
  const id = unit.def.charId, body = unit.def.raw.assaultBody, values = effect.values ?? {}, piece = unit.def.raw.assaultPiece;
  const star = piece.star, moduleId = piece.moduleId ?? piece.moduleChoices?.[id];
  const tile = deviceTile(battle, unit);
  if (!tile) return false;
  const player = id === 'char_1033_swire2' ? battle._pp?.(unit.ownerId) : null;
  const goldCost = id === 'char_1033_swire2' ? num(unit, values.goldCost, 1) : 0;
  if (id === 'char_1033_swire2' && (!player || player.coins < goldCost)) return false;
  const name = Array.isArray(values.deviceName) ? v(unit, values.deviceName) : ({ char_451_robin: '弹射夹子', char_1033_swire2: '香槟炸弹', char_4151_tinman: '大拉里', char_1039_thorn2: '我的海疆' })[id];
  const device = battle.spawnDevice(`assault:${id}:${uid(unit)}:${Math.floor(battle.time * 10)}:${(unit.mem.assaultDeviceSeq = (unit.mem.assaultDeviceSeq ?? 0) + 1)}`, tile[0], tile[1], { name, hp: 1 });
  if (!device) return false;
  device.ownerId = unit.ownerId;
  device.ownerUnit = unit;
  device.sourceOwnerUid = uid(unit);
  if (id === 'char_451_robin') {
    const advanced = star >= 3 && moduleId === 'uniequip_002_robin';
    const damagePlan = body.fixedSkill.effects.find((x) => x.action === 'damage').values;
    const force = num(unit, values.pushForce, 1), scale = num(unit, values.triggerDamageScale, 1) * (1 + moduleParam(unit, 'uniequip_002_robin', 'x', 0) / 100);
    onTimer(battle, unit, 0.1, (b, timer) => {
      const victim = b.enemies.find((e) => e.alive && nearTile(e, tile, 0.65));
      if (!victim) return;
      damage(b, unit, victim, { scale, type: 'phys', isSkill: true, sourceKey: `${id}:trap`, cause });
      b.push(victim, force, { from: unit });
      if (b._hooks.deviceTrigger) b.emit('deviceTrigger', { source: unit, sourceUid: uid(unit), target: victim, targetUid: uid(victim), device });
      if (advanced) sp(b, unit, unit, 0.5, 'robinTrap', `${id}:trap-sp`, cause);
      if (device?.alive) b.retreat(device, { reason: 'expired', permanent: true });
      timer.cancel?.();
    }, { every: true });
    return device;
  }
  if (id === 'char_1033_swire2') {
    player.coins -= goldCost;
    if (battle._hooks.goldSpent) battle.emit('goldSpent', { source: unit, sourceUid: uid(unit), target: unit, targetUid: uid(unit), amount: goldCost, reason: 'assaultDevice' });
    unit.mem.assaultGoldCap = num(unit, values.goldCap, 4);
    const delayed = body.fixedSkill.effects.find((x) => x.action === 'damage' && x.trigger !== effect.trigger);
    onTimer(battle, unit, 0.1, (b, timer) => {
      const victim = b.enemies.find((e) => e.alive && nearTile(e, tile, 0.65));
      if (!victim) return;
      // 大巴扎：金币辉煌 / 龙门美食指南的炸弹伤害加成读卡面数值。
      const moduleTwoBonus = 1 + (moduleParam(unit, 'uniequip_002_swire2', 'x', 0) + moduleParam(unit, 'uniequip_003_swire2', 'x', 0)) / 100;
      damage(b, unit, victim, { scale: num(unit, values.triggerDamageScale) * moduleTwoBonus, type: 'phys', isSkill: true, sourceKey: `${id}:contact`, cause });
      applyStatus(b, unit, victim, { status: 'sluggish', duration: num(unit, values.sluggish, 2), key: `${id}:contact`, cause });
      if (b._hooks.deviceTrigger) b.emit('deviceTrigger', { source: unit, sourceUid: uid(unit), target: victim, targetUid: uid(victim), device });
      timer.cancel?.();
      // 大巴扎：香槟炸弹只结算触碰伤害与停顿，删去 3 秒后的第二段伤害。
      if (device?.alive) b.retreat(device, { reason: 'expired', permanent: true });
    }, { every: true });
    return device;
  }
  if (id === 'char_4151_tinman') {
    const damageEffect = body.fixedSkill.effects.find((x) => x.action === 'damage'), healEffect = body.fixedSkill.effects.find((x) => x.action === 'heal');
    const advanced = star >= 3 && moduleId === 'uniequip_002_tinman';
    const duration = num(unit, values.duration, 12) + (advanced ? 3 : 0), radius = num(unit, values.radius, 2);
    onTimer(battle, unit, 1, (b, timer) => {
      if (b.time > device.deployedAt + duration) { if (device.alive) b.retreat(device, { reason: 'expired', permanent: true }); timer.cancel?.(); return; }
      for (const enemy of b.enemies.filter((e) => e.alive && !e.isFlying && nearTile(e, tile, radius))) {
        const dotPassive = num(unit, unit.mem.assaultFieldDotAmp, 0);
        damage(b, unit, enemy, { scale: num(unit, damageEffect.values.atkScalePerSec) * (1 + dotPassive), type: 'arts', isSkill: true, sourceKey: `${id}:field-dot`, cause });
        if (advanced) buff(b, unit, enemy, { key: `${id}:field-atk:${uid(enemy)}`, mods: { atkPct: -0.1 }, duration: 1.5, cause });
      }
      for (const ally of b.allyUnits.filter((a) => a.alive && a.deployed && a.kind !== 'device' && nearTile(a, tile, radius))) heal(b, unit, ally, { scale: num(unit, healEffect.values.healScalePerSec), sourceKey: `${id}:field-heal`, cause });
    }, { every: true });
    return device;
  }
  if (id === 'char_1039_thorn2') {
    const targets = [...battle.allyUnits].filter((a) => a.alive && a.deployed && a.kind === 'op').sort((a,b) => a.blocking.length-b.blocking.length || String(a.uid).localeCompare(String(b.uid))).slice(0, num(unit, values.maxTarget, 3));
    const zones = targets.map((a) => ({ center: [a.tileR, a.tileC], start: battle.time }));
    const damageEffect = body.fixedSkill.effects.find((x) => x.action === 'damage'), statusEffect = body.fixedSkill.effects.find((x) => x.action === 'applyStatus');
    const duration = num(unit, values.duration, 20), radius = num(unit, values.radius, 1.1) + (star >= 3 && moduleId === 'uniequip_002_thorn2' ? 0.5 : 0);
    onTimer(battle, unit, 1, (b, timer) => {
      if (b.time > zones[0]?.start + duration) { if (device?.alive) b.retreat(device, { reason: 'expired', permanent: true }); timer.cancel?.(); return; }
      for (const zone of zones) for (const enemy of b.enemies.filter((e) => e.alive && nearTile(e, zone.center, radius))) {
        // 大巴扎：每秒 a% 法术伤害（不再爬升）；周围敌人 -x% 防御力和法术抗性（不再减攻）。
        const scale = lineParam(unit, 0, 'a', 100 * num(unit, damageEffect.values.dotScale)) / 100;
        const dotPassive = num(unit, unit.mem.assaultFieldDotAmp, 0);
        damage(b, unit, enemy, { scale: scale * (1 + dotPassive), type: 'arts', isSkill: true, sourceKey: `${id}:field-dot`, cause });
        const shred = lineParam(unit, 2, 'x', -100 * num(unit, statusEffect.values.defDebuff, 0)) / 100;
        buff(b, unit, enemy, { key: `${id}:field-debuff:${uid(enemy)}`, mods: { defPct: -shred - (star >= 3 && moduleId === 'uniequip_002_thorn2' ? 0.1 : 0),
          resFlat: -100 * shred }, duration: 1.5, cause });
      }
    }, { every: true });
    return zones.length;
  }
  if (id === 'char_4048_doroth') {
    const damageEffect = body.fixedSkill.effects.find((x) => x.action === 'damage');
    const statusEffect = body.fixedSkill.effects.find((x) => x.action === 'applyStatus');
    const count = Math.max(1, Math.floor(num(unit, values.deviceCount, 1)));
    unit.mem.assaultResonanceCharges = Math.max(0, (unit.mem.assaultResonanceCharges ?? 0) + count - 1);
    onTimer(battle, unit, 0.1, (b, timer) => {
      const victim = b.enemies.find((e) => e.alive && nearTile(e, tile, 0.65));
      if (!victim) return;
      const targets = b.enemies.filter((e) => e.alive && nearTile(e, tile, 1));
      execute({ battle: b, unit, effect: damageEffect, targets, cause });
      if (b._hooks.deviceTrigger) b.emit('deviceTrigger', { source: unit, sourceUid: uid(unit), target: victim, targetUid: uid(victim), device });
      const statusParams = { ...(statusEffect.values ?? {}) };
      const hooks = unit.mem.assaultModuleHooks;
      const moduleCtx = { battle: b, unit, body, piece: unit.def.raw.assaultPiece, rank: unit.def.raw.assaultPiece.star,
        cause, effect: { ...statusEffect, values: statusParams }, params: statusParams, targets, hitCount: targets.length };
      if (hooks?.active) {
        const overrides = hooks.beforeEffect(moduleCtx);
        if (overrides && typeof overrides === 'object') Object.assign(moduleCtx, overrides);
        Object.assign(statusParams, moduleCtx.params ?? moduleCtx.effect?.values ?? statusParams);
      }
      b.after(num(unit, statusParams.delaySec, 2), () => {
        const delayedTargets = b.enemies.filter((e) => e.alive && nearTile(e, tile, 1));
        const immediateStatus = { ...statusParams, delaySec: 0 };
        execute({ battle: b, unit, effect: { ...statusEffect, values: immediateStatus }, targets: delayedTargets, cause, moduleHooksApplied: true });
        hooks?.afterEffect?.({ ...moduleCtx, result: delayedTargets.length });
        if (device.alive) b.retreat(device, { reason: 'expired', permanent: true });
      }, { owner: unit });
      timer.cancel?.();
    }, { every: true });
    return device;
  }
  if (device?.alive) battle.retreat(device, { reason: 'expired', permanent: true });
  throw new TypeError(`missing explicit typed device plan ${id}`);
}

function summonGhostDecoy({ battle, unit, cause, nativeDoll = false }) {
  const passive = unit.def.raw.assaultBody.modePassives[0], values = passive.values;
  unit.mem.assaultGhostDecoyStop?.();
  const seq = (unit.mem.assaultGhostDecoySeq = (unit.mem.assaultGhostDecoySeq ?? 0) + 1);
  // A native doll still occupies the operator's tile. Its native form carries
  // the passive field; only a real knockout leaves a separate legal device.
  const device = nativeDoll ? { id: `${uid(unit)}:doll-field:${seq}`, name: '替身', nativeDoll: true,
    alive: true, deployedAt: battle.time, x: unit.x, y: unit.y }
    : battle.spawnDevice(`assault:${unit.def.charId}:decoy:${uid(unit)}:${seq}`, unit.tileR, unit.tileC,
      { name: '替身', hp: 1, overBody: unit, ownerUnit: unit,
        spine: unit.def.spine ?? unit.def.charId, avatar: unit.def.avatar ?? unit.def.charId });
  if (!device) return false;
  unit.mem.assaultGhostDecoy = device;
  const piece = unit.def.raw.assaultPiece, moduleId = piece.moduleId ?? piece.moduleChoices?.[unit.def.charId];
  const duration = num(unit, values.duration, 15) + moduleParam(unit, 'uniequip_002_ghost2', 't', 0), scale = num(unit, values.dotScale, 0);
  // 大巴扎：替身本身只造成 d% 法术伤害；减速只来自模组 003（-y% 移速）。
  const slow = moduleParam(unit, 'uniequip_003_ghost2', 'y', 0) / 100;
  const timers = [], timerOwner = nativeDoll ? unit : device;
  const stop = () => {
    for (const timer of timers) timer.cancel();
    if (device.alive) { if (nativeDoll) device.alive = false; else battle.kill(device, null); }
  };
  unit.mem.assaultGhostDecoyStop = stop;
  const alive = () => device.alive && (!nativeDoll || active(unit) && unit.form === 'doll');
  timers.push(battle.every(1, (b) => {
    if (!alive() || b.time >= device.deployedAt + duration) { stop(); return; }
    if (nativeDoll) { device.x = unit.x; device.y = unit.y; }
    for (const enemy of b.enemies.filter((target) => target.alive && hypot(target.x - device.x, target.y - device.y) <= 1)) {
      if (slow > 0) applyStatus(b, unit, enemy, { status: 'slow', value: slow, duration: 1.1, key: `${unit.def.charId}:decoy-slow`, cause });
      if (scale > 0) damage(b, unit, enemy, { scale, type: 'arts', isSkill: true, sourceKey: `${unit.def.charId}:decoy-dot`, cause });
    }
  }, { owner: timerOwner }));
  if (false && moduleId === 'uniequip_004_ghost2' && piece.star >= 4) timers.push(battle.every(2, (b) => { // 大巴扎：004 只加相邻深海猎人生命，删去替身灼烧
    if (!alive()) { stop(); return; }
    for (const enemy of b.enemies.filter((target) => target.alive && hypot(target.x - device.x, target.y - device.y) <= 1)) {
      queue(b, `assault:module:${unit.def.charId}:uniequip_004_ghost2:burn:${uid(device)}:${uid(enemy)}:${b.tickCount}`, enemy,
        (rt, task) => damage(b, unit, enemy, { scale, type: 'arts', isSkill: true,
          sourceKey: `assault:module:${unit.def.charId}:uniequip_004_ghost2:shadow-burn`, cause: task.cause }), b.assaultRuntime?.currentCause ?? cause);
    }
  }, { owner: timerOwner }));
  timers.push(battle.after(duration, stop, { owner: timerOwner }));
  return device;
}

function startUlpiaAnchor({ battle, unit, effects }) {
  const moveEffect = effects.find((entry) => entry.action === 'move' && entry.values?.dashToAnchor != null);
  if (!moveEffect || unit.mem.assaultUlpiaAnchor) return false;
  const strike = effects.find((entry) => entry.action === 'damage');
  const target = strike && targetsFor(battle, unit, strike)[0];
  if (!target) return false;
  const home = [unit.tileR, unit.tileC];
  const originDistance = (r, c) => hypot(r - home[0], c - home[1]);
  const candidates = [];
  const targetKey = tileKeyOf(target), targetRow = Math.floor(targetKey / COLS), targetCol = targetKey % COLS;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const r = targetRow + dr, c = targetCol + dc;
    if (!battle.grid.inRect(r, c) || !battle.grid.isLow(r, c) || originDistance(r, c) > 1.8) continue;
    if (battle._occ[r * COLS + c]?.alive || battle.downOn(r, c, unit) || battle.enemies.some((enemy) => enemy.alive && bodyInKeys(enemy, new Set([r * COLS + c])))) continue;
    candidates.push([r, c]);
  }
  candidates.sort((a, b) => originDistance(a[0], a[1]) - originDistance(b[0], b[1]) || a[0] - b[0] || a[1] - b[1]);
  const landing = candidates[0];
  if (!landing || !battle.relocate(unit, landing[0], landing[1])) return false;
  const marker = battle.spawnDevice(`token_10039_ulpia_block:${unit.uid}`, home[0], home[1], { name: '从不混淆的方向', hp: 1e9 });
  if (!marker) { battle.relocate(unit, home[0], home[1]); return false; }
  const state = { home, landing, marker, closing: false };
  unit.mem.assaultUlpiaAnchor = state;
  const finish = () => {
    if (state.closing) return;
    state.closing = true;
    if (state.marker.alive) battle.retreat(state.marker, { reason: 'expired', permanent: true });
    if (unit.alive && unit.deployed && (unit.tileR !== home[0] || unit.tileC !== home[1])) battle.relocate(unit, home[0], home[1]);
    if (unit.mem.assaultUlpiaAnchor === state) unit.mem.assaultUlpiaAnchor = null;
  };
  const durationEffect = effects.find((entry) => entry.action === 'addBuff' && entry.values?.duration != null);
  const duration = durationEffect ? num(unit, durationEffect.values.duration, 25) : 25;
  battle.after(duration, finish, { owner: unit });
  battle.on('skillEnd', ({ unit: ended }) => { if (ended === unit) finish(); }, { owner: unit });
  battle.on('death', ({ unit: dead }) => { if (dead === unit || dead === marker) finish(); }, { owner: unit, priority: 100 });
  return true;
}

function demetrLandingAllowed(battle, unit, r, c) {
  if (!battle.grid.inRect(r, c) || !battle.grid.groundPassable(r, c) || !battle.grid.canStand(r, c, { ranged: false })) return false;
  const k = r * COLS + c;
  const occupant = battle._occ[k];
  if (occupant?.alive && occupant !== unit) return false;
  if (battle.downOn(r, c, unit)) return false;
  if ((unit.tileR !== r || unit.tileC !== c) && battle.isReservedTile(r, c)) return false;
  return !battle.allyUnits.some((other) => other !== unit && other.alive && other.kind === 'device' && other.tileR === r && other.tileC === c);
}

function demetrRadiusTargets(battle, unit, maxDistance) {
  return battle.enemies.filter((target) => {
    if (!target.alive || !(target.hp > 0) || target.isFlying || target.hidden) return false;
    const key = tileKeyOf(target);
    if (key < 0) return false;
    const r = Math.floor(key / COLS), c = key % COLS;
    return hypot(r - unit.tileR, c - unit.tileC) <= maxDistance;
  }).sort((a, b) => {
    const ka = tileKeyOf(a), kb = tileKeyOf(b);
    return hypot(Math.floor(ka / COLS) - unit.tileR, ka % COLS - unit.tileC)
      - hypot(Math.floor(kb / COLS) - unit.tileR, kb % COLS - unit.tileC) || uid(a).localeCompare(uid(b));
  });
}

function startDemetrHunt({ battle, unit, effect }) {
  const values = effect.values ?? {};
  let state = unit.mem.assaultDemetrHunt;
  if (!state?.active) {
    state = { active: true, origin: [unit.tileR, unit.tileC], previousDownAtHome: !!unit.downAtHome,
      expiresAt: battle.time + num(unit, values.duration, 30), lastAttackAt: battle.time, lastRetargetAt: battle.time,
      targetUid: null, timerCancel: null, returnCancel: null };
    unit.mem.assaultDemetrHunt = state;
  } else state.expiresAt = battle.time + num(unit, values.duration, 30);
  // Death during the hunt returns the native knocked-out body to the pre-hunt home tile;
  // ordinary completion still uses relocate and never runs deploy/redeploy effects.
  unit.downAtHome = true;

  const targetAt = (target) => {
    if (!target?.alive || !(target.hp > 0) || target.isFlying || target.hidden) return null;
    const k = tileKeyOf(target);
    if (k < 0) return null;
    return [Math.floor(k / COLS), k % COLS];
  };
  const candidates = () => demetrRadiusTargets(battle, unit, num(unit, values.maxDistance, 4));
  const land = (target) => {
    const tile = targetAt(target);
    if (!tile || hypot(tile[0] - unit.tileR, tile[1] - unit.tileC) > num(unit, values.maxDistance, 4)) return false;
    if (tile[0] === unit.tileR && tile[1] === unit.tileC) return true;
    if (!demetrLandingAllowed(battle, unit, tile[0], tile[1])) return false;
    return battle.relocate(unit, tile[0], tile[1]);
  };
  const retarget = () => {
    const target = candidates()[0] ?? null;
    state.targetUid = target ? uid(target) : null;
    state.lastRetargetAt = battle.time;
    if (target) land(target);
  };
  const returnToOrigin = () => {
    if (!unit.alive || !unit.deployed) return false;
    const [r, c] = state.origin;
    if ((unit.tileR !== r || unit.tileC !== c) && !demetrLandingAllowed(battle, unit, r, c)) return false;
    if (unit.tileR !== r || unit.tileC !== c) battle.relocate(unit, r, c);
    unit.downAtHome = state.previousDownAtHome;
    if (unit.mem.assaultDemetrHunt === state) unit.mem.assaultDemetrHunt = null;
    return true;
  };
  const endHunt = () => {
    if (!state.active) return;
    state.active = false;
    state.timerCancel?.();
    if (returnToOrigin()) return;
    // A blocked original tile remains the pending return destination; retry without moving another unit.
    state.returnCancel = onTimer(battle, unit, 0.1, (b, timer) => {
      if (!unit.alive || !unit.deployed || returnToOrigin()) { timer.cancel?.(); return; }
    }, { every: true });
  };
  if (!state.listenersInstalled) {
    state.listenersInstalled = true;
    battle.on('attack', (payload) => {
      const source = payload?.source ?? payload?.attacker ?? payload?.unit;
      const current = unit.mem.assaultDemetrHunt;
      if (source === unit && current?.active) current.lastAttackAt = battle.time;
    }, { owner: unit });
    battle.on('kill', () => {
      const current = unit.mem.assaultDemetrHunt;
      const selected = current?.active && current.targetUid
        ? battle.enemies.find((candidate) => uid(candidate) === current.targetUid) : null;
      if (current?.active && (!selected || !(selected.hp > 0))) retarget();
    }, { owner: unit });
    battle.on('death', ({ unit: dead }) => {
      const current = unit.mem.assaultDemetrHunt;
      if (dead === unit && current?.active) {
        current.active = false;
        current.timerCancel?.();
        current.returnCancel?.();
        // Keep downAtHome set so the native _layBody / redeploy lifecycle uses the original tile.
      }
    }, { owner: unit, priority: 100 });
  }
  if (!state.timerCancel) {
    state.timerCancel = onTimer(battle, unit, 0.1, (b, timer) => {
      if (!unit.alive || !unit.deployed) { timer.cancel?.(); state.active = false; return; }
      if (b.time + 1e-9 >= state.expiresAt) { endHunt(); return; }
      const target = state.targetUid && battle.enemies.find((candidate) => uid(candidate) === state.targetUid && candidate.alive && candidate.hp > 0);
      if (!target) retarget();
      else if (b.time - state.lastAttackAt >= num(unit, values.reTargetNoAttackSec, 1)
        && b.time - state.lastRetargetAt >= num(unit, values.reTargetNoAttackSec, 1)) retarget();
      const selected = state.targetUid && battle.enemies.find((candidate) => uid(candidate) === state.targetUid && candidate.alive && candidate.hp > 0);
      if (selected) land(selected); // retry when a tile was temporarily occupied.
    }, { every: true });
  }
  if (!state.targetUid) retarget();
}

const ETLCHI_CANDLE_KEY = 'enemy_5601_entlec';
function summonEtlchiCandles({ battle, unit, effect, cause }) {
  const candleDef = battle.data?.getEnemy?.(ETLCHI_CANDLE_KEY);
  if (!candleDef) throw new Error(`compiled native enemy ${ETLCHI_CANDLE_KEY} is unavailable`);
  for (const previous of unit.mem.assaultEtlchiCandles ?? []) if (previous.alive) battle.kill(previous, null);
  unit.mem.assaultEtlchiCandles = [];
  const values = effect.values ?? {};
  const count = Math.max(1, Math.floor(num(unit, values.maxTarget, 3)));
  const piece = unit.def.raw.assaultPiece;
  const moduleId = piece.moduleId ?? piece.moduleChoices?.[unit.def.charId];
  const hpScale = num(unit, values.hpScale, 0.6) + (piece.star >= 3 && moduleId === 'uniequip_002_etlchi' ? 0.1 : 0);
  const duration = num(unit, values.duration, 20) + (piece.star >= 3 && moduleId === 'uniequip_003_etlchi' ? 5 : 0);
  const inRange = new Set(unit.rangeKeys ?? []);
  const targets = battle.enemies.filter((target) => inRange.has(tileKeyOf(target)) &&
      canTargetEnemy(unit, target, { groundOnly: true }) && !target.mem?.candleOwner)
    .sort((a, b) => b.hp - a.hp || a.spawnSeq - b.spawnSeq).slice(0, count);
  for (const host of targets) {
    const raw = { ...candleDef, name: '心烛', maxHp: Math.max(1, host.hp * hpScale), atk: 0,
      def: host.s.def, res: host.s.res, moveSpeed: 0, dmgType: 'none', lpr: 0, notCountInTotal: true };
    const candle = battle.spawnEnemy(ETLCHI_CANDLE_KEY, { def: raw, pos: [host.y, host.x], countInTotal: false, ownerPlayerId: host.ownerId,
      route: { motion: 'WALK', start: [roundHalfEven(host.y), roundHalfEven(host.x)], end: [roundHalfEven(host.y), roundHalfEven(host.x)], steps: [{ t: 'wait', s: 99999 }] } });
    if (!candle) continue;
    Object.assign(candle.base, { maxHp: Math.max(1, host.hp * hpScale), atk: 0, def: host.s.def, res: host.s.res, moveSpeed: 0 });
    candle.profile = { ...candle.profile, noAttack: true };
    candle.lpr = 0;
    candle.mem.candleOwner = unit;
    candle.mem.candleHost = host;
    candle.mem.noLeak = true;
    candle.markDirty();
    candle.hp = candle.s.maxHp;
    battle.addBuff(candle, { key: `${unit.def.charId}:candle`, flags: { unblockable: true, noMove: true } });
    unit.mem.assaultEtlchiCandles.push(candle);
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || target !== candle || dmg.type !== 'phys' || dmg.sourceless || !active(unit) ||
          !unit.findBuff('char_4010_etlchi:addBuff:灵与欲的惜别结算后')) return;
      const minimumPlan = unit.def.raw.assaultBody.fixedSkill.effects.find((plan) => plan.action === 'damage' && plan.values?.minAtkScale != null);
      if (!minimumPlan) throw new TypeError('Etlchi requires its native candle minimum-damage plan');
      const minimum = unit.s.atk * num(unit, minimumPlan.values.minAtkScale);
      const pct = Math.max(0, Math.min(1, (Number(dmg.defIgnorePct) || 0) + (Number(unit.s.defIgnorePct) || 0)));
      const flat = (Number(dmg.defIgnoreFlat) || 0) + (Number(unit.s.defIgnoreFlat) || 0);
      const effectiveDef = Math.max(0, candle.s.def * (1 - pct) - flat);
      const extraFlat = Math.max(0, effectiveDef - (dmg.amount - minimum));
      dmg.defIgnoreFlat = (Number(dmg.defIgnoreFlat) || 0) + extraFlat;
    }, { owner: unit, priority: 100 });
    battle.on('hpDamage', (damageCtx) => {
      if (damageCtx.target === candle && damageCtx.source !== unit) damageCtx.amount = 0;
    }, { owner: unit });
    battle.on('damaged', ({ source, target, amount }) => {
      if (source === unit && target === candle && amount > 0 && host.alive)
        queue(battle, `assault:${unit.def.charId}:candle-transfer:${uid(candle)}`, host,
          (rt, task) => battle.loseHp(host, amount, { source: unit, tags: ['assaultEtlchiCandle'], cause: task.cause }), battle.assaultRuntime.currentCause);
    }, { owner: unit });
    battle.on('death', ({ unit: dead }) => {
      if (dead === host && candle.alive) battle.kill(candle, null);
    }, { owner: unit });
    onTimer(battle, unit, duration, (b) => { if (candle.alive) b.kill(candle, null); }, { owner: unit });
  }
  return targets.length;
}

function startGladiaCyclone(battle, unit, effect, cause) {
  const center = unit.mem.assaultGladiaCycloneCenter;
  if (!center) return;
  const values = effect.values, duration = num(unit, values.duration), interval = num(unit, values.interval);
  const radius = num(unit, values.radius);
  if (!(duration > 0 && interval > 0 && radius > 0)) throw new TypeError('Gladiia requires an authored cyclone duration, interval and radius');
  unit.mem.assaultGladiaCyclone?.cancel?.();
  const state = { center, started: battle.time, expires: battle.time + duration, duration, radius, pulses: 0 };
  unit.mem.assaultGladiaCyclone = state;
  const inside = b => b.foesInRadius(center.x, center.y, radius).filter(target => active(target) && canTargetEnemy(unit, target));
  const slow = b => {
    for (const target of inside(b)) applyStatus(b, unit, target, { status: 'slow', value: num(unit, values.slowRatio),
      duration: Math.min(0.2, Math.max(0, state.expires - b.time)), key: `${unit.def.charId}:cyclone-slow:${uid(unit)}`, cause });
  };
  state.pulse = b => {
    const count = Math.min(Math.floor((b.time - state.started + 1e-9) / interval), Math.floor((duration + 1e-9) / interval));
    while (state.pulses < count) {
      state.pulses++;
      runDamage({ battle: b, unit, effect, cause: b.assaultRuntime.currentCause ?? cause, selectedTargets: inside(b), periodic: true });
      b.fx('tornadoPulse', { x: center.x, y: center.y, id: unit.id, r: radius });
    }
  };
  const stopSlow = onTimer(battle, unit, 0.1, b => {
    if (unit.mem.assaultGladiaCyclone !== state || b.time >= state.expires) { stopSlow(); return; }
    slow(b);
  }, { every: true });
  const stopPulse = onTimer(battle, unit, interval, b => {
    if (unit.mem.assaultGladiaCyclone !== state || b.time > state.expires + 1e-9) { stopPulse(); return; }
    state.pulse(b);
  }, { every: true });
  state.cancel = () => { stopSlow(); stopPulse(); };
  slow(battle);
  battle.fx('tornado', { x: center.x, y: center.y, id: unit.id, r: radius, duration });
}

function runDamage({ battle, unit, effect, cause, selectedTargets = null, periodic = false, invocation = null }) {
  const values = effect.values ?? {};
  const bodyId = unit.def.charId;
  if (bodyId === 'char_474_glady' && !periodic && values.interval != null && values.duration != null)
    return startGladiaCyclone(battle, unit, effect, cause);
  if (bodyId === 'char_173_slchan' && Array.isArray(unit.mem.assaultSlchanPullTargets))
    selectedTargets = unit.mem.assaultSlchanPullTargets;
  if (selectedTargets && !selectedTargets.some(target => target.alive)) return;
  if (bodyId === 'char_4155_talr' && values.atkScalePerSec != null && values.interval != null && values.duration == null && !periodic) return;
  if (!periodic && Number.isFinite(num(unit, values.interval, 0)) && num(unit, values.interval, 0) > 0 && Number.isFinite(num(unit, values.duration, 0)) && num(unit, values.duration, 0) > 0) {
    const expires = battle.time + num(unit, values.duration);
    if (bodyId === 'char_474_glady' && values.slowRatio != null) {
      for (const target of enemies(battle, unit, { scope: 'range', count: 99 }))
        applyStatus(battle, unit, target, { status: 'slow', value: num(unit, values.slowRatio), duration: num(unit, values.duration), key: `${bodyId}:cyclone-slow`, cause });
    }
    const rain = bodyId === 'char_1028_texas2' ? (unit.mem.assaultTexasRain = { expires, effect, cause }) : null;
    const cancel = onTimer(battle, unit, num(unit, values.interval), (b) => {
      if (b.time + 1e-9 >= (rain?.expires ?? expires)) { cancel(); if (rain && unit.mem.assaultTexasRain === rain) unit.mem.assaultTexasRain = null; return; }
      runDamage({ battle: b, unit, effect, cause: b.assaultRuntime.currentCause, periodic: true });
    }, { every: true });
    return;
  }
  let rangeBuffKey = null;
  if ((bodyId === 'char_172_svrash' || bodyId === 'char_4064_mlynar' || bodyId === 'char_437_mizuki') && Number(v(unit, values.rangeExtend ?? 0)) > 0) {
    rangeBuffKey = `${bodyId}:cast-range`;
    buff(battle, unit, unit, { key: rangeBuffKey, mods: { rangeExtend: Number(v(unit, values.rangeExtend)) }, duration: 0.2 });
    battle._refreshRange(unit);
  }
  if (bodyId === 'char_4082_qiubai' && Number(v(unit, values.rangeExtend ?? 0)) > 0) {
    rangeBuffKey = `${bodyId}:cast-range`;
    buff(battle, unit, unit, { key: rangeBuffKey, mods: { rangeExtend: Number(v(unit, values.rangeExtend)) }, duration: 0.2 });
    battle._refreshRange(unit);
  }
  if (bodyId === 'char_188_helage' && Number(v(unit, values.rangeExtend ?? 0)) > 0) {
    rangeBuffKey = `${bodyId}:cast-range`;
    buff(battle, unit, unit, { key: rangeBuffKey, mods: { rangeExtend: Number(v(unit, values.rangeExtend)) }, duration: 0.2 });
    battle._refreshRange(unit);
  }
  let targetCount = Number(v(unit, values.maxTarget ?? values.extraTargets ?? values.times ?? 1));
  if (bodyId === 'char_4082_qiubai' && values.maxTarget == null && values.extraTargets != null) targetCount += 1;
  if (values.radius != null) targetCount = Math.max(targetCount, battle.enemies.length);
  if (bodyId === 'char_172_svrash' && unit.mem.assaultSilverAshModule) targetCount += 1;
  const angelLanding = bodyId === 'char_1041_angel2' && num(unit, values.splashRadius, 0) > 0;
  if (angelLanding && !unit.mem.assaultAngelDropTile) return 0;
  const landing = angelLanding && unit.mem.assaultAngelDropTile;
  const selectedAlive = selectedTargets?.filter((target) => target?.alive) ?? null;
  const excuFinal = bodyId === 'char_1032_excu2' && values.finalAtkScale != null;
  const cycloneCenter = bodyId === 'char_474_glady' && periodic ? unit.mem.assaultGladiaCycloneCenter : null;
  const cycloneTargets = cycloneCenter && values.radius != null ? battle.foesInRadius(cycloneCenter.x, cycloneCenter.y, num(unit, values.radius))
    .filter(target => active(target) && canTargetEnemy(unit, target)) : null;
  const chyuePrimary = bodyId === 'char_2024_chyue' && !periodic
    ? selectedAlive?.[0] ?? list(battle, unit, effect, { count: 1, scope: 'range' })[0] : null;
  const chyueSplashTargets = chyuePrimary && num(unit, values.splashRadius, 0) > 0
    ? battle.enemies.filter((target) => target.alive && canTargetEnemy(unit, target, unit.profile) &&
      hypot(target.x - chyuePrimary.x, target.y - chyuePrimary.y) <= num(unit, values.splashRadius)) : null;
  let targets = landing ? battle.enemies.filter((target) => target.alive && hypot(target.y - landing[0], target.x - landing[1]) <= num(unit, values.splashRadius))
    : excuFinal && selectedAlive ? selectedAlive.slice(0, Math.max(1, Math.floor(num(unit, values.maxTarget, 1))))
      : cycloneTargets ? cycloneTargets
      : chyueSplashTargets ? chyueSplashTargets
      : values.blockedOnly ? unit.blocking.filter((target) => target?.alive && canTargetEnemy(unit, target))
      : values.nativeArea === 'adjacent8' ? battle.enemies.filter((target) => target.alive && !target.isFlying &&
        Math.max(Math.abs(target.tileR - unit.tileR), Math.abs(target.tileC - unit.tileC)) <= 1 && canTargetEnemy(unit, target))
      : selectedAlive?.length ? selectedAlive : bodyId === 'char_1001_amiya2' ? enemies(battle, unit, { scope: 'range', priority: 'hp', count: 1 })
      : list(battle, unit, effect, { count: Math.max(1, targetCount), scope: values.radius ? 'adjacent8' : 'range' });
  if (bodyId === 'char_4145_ulpia' && values.anchorPullForce != null) {
    const primary = selectedAlive?.[0] ?? list(battle, unit, effect, { count: 1, scope: 'range' })[0];
    targets = primary ? battle.enemies.filter((target) => target.alive && canTargetEnemy(unit, target) &&
      Math.max(Math.abs(target.tileR - primary.tileR), Math.abs(target.tileC - primary.tileC)) <= 1)
      .slice(0, Math.max(1, Math.floor(num(unit, values.maxTarget, 2)))) : [];
  }
  if (values.blockedOnly) targets = targets.filter((target) => target.blockedBy === unit || unit.blocking.includes(target));
  const ghost2BaseSnapshot = bodyId === 'char_1023_ghost2' && values.atkScale != null ? { ownerHpRatio: unit.hp / unit.s.maxHp, targets: new Map() } : null;
  if (ghost2BaseSnapshot) {
    ghost2BaseSnapshot.targets = new Map(targets.map((target) => [target, {
      target, hpRatio: target.hp / target.s.maxHp, landed: false,
    }]));
    unit.mem.assaultGhost2Cast = ghost2BaseSnapshot;
  }
  const ghost2ExtraSnapshot = bodyId === 'char_1023_ghost2' && values.extraAtkScale != null ? unit.mem.assaultGhost2Cast ?? null : null;
  if (ghost2ExtraSnapshot) {
    unit.mem.assaultGhost2Cast = null;
    const eligible = [];
    for (const snapshot of ghost2ExtraSnapshot.targets.values()) {
      if (!snapshot.landed) continue;
      if (snapshot.hpRatio + 1e-9 >= ghost2ExtraSnapshot.ownerHpRatio) {
        if (snapshot.target.alive) eligible.push(snapshot.target);
      } else if (unit.alive) battle.loseHp(unit, unit.s.maxHp * num(unit, values.selfMaxHpLossRatio, 0), { source: unit });
    }
    targets.splice(0, targets.length, ...eligible);
  }
  unit.mem.assaultLastSkillTargets = [...targets];
  unit.mem.assaultLastSkillTargetCount = targets.length;
  const brocaHitTargets = ['char_356_broca', 'char_140_whitew', 'char_437_mizuki'].includes(bodyId) ? [] : null;
  if (brocaHitTargets) unit.mem.assaultLastSkillHitTargets = [];
  const chyueGrowth = bodyId === 'char_2024_chyue' && unit.mem.assaultChyueAwakened
    ? unit.def.raw.assaultBody.fixedSkill.effects.find((candidate) => candidate.action === 'growth' && candidate.values?.extraHit != null)?.values?.extraHit : 0;
  const hits = num(unit, values.hits ?? values.times, 1) + num(unit, chyueGrowth, 0);
  const scale = num(unit, values.atkScale ?? values.atkScalePerHit ?? values.atkScalePerSec ?? values.extraAtkScale ?? values.extraTrueAtkScale ?? values.talentAtkScale ?? values.finalAtkScale ?? values.reflectAtkScale, 0)
    * (bodyId === 'char_4064_mlynar' && values.traitMultiplier != null ? num(unit, values.traitMultiplier, 1) : 1)
    * (periodic && values.atkScalePerSec != null ? num(unit, values.interval, 1) : 1);
  const damageType = bodyId === 'char_294_ayer' || bodyId === 'char_1028_texas2' && values.atkScalePerSec != null ? 'arts' : physicalFor(unit, values);
  if (bodyId === 'char_1019_siege2' && damageType === 'true') unit.mem.assaultSiegeSkillUntil = battle.time + 0.01;
  if (values.clearDebuffs) {
    for (const entry of [...(unit.buffs ?? [])]) {
      if (entry.status != null || entry.tags?.includes('debuff') || entry.data?.debuff) battle.removeBuff(unit, entry.key);
    }
  }
  if (values.delayedAreaDamage && bodyId === 'char_4082_qiubai') {
    const duration = num(unit, values.bindDuration, 0);
    for (const target of targets) {
      // 大巴扎：「对 1 名敌人造成 a% 法术伤害，束缚 s 秒」——删去随后的延迟范围伤害。
      damage(battle, unit, target, { scale, type: 'arts', isSkill: true, sourceKey: `${bodyId}:instant-hit`, cause });
      if (target.alive) applyStatus(battle, unit, target, { status: 'bind', duration, key: `${bodyId}:instant-root`, cause });
    }
    return targets.length;
  }
  if (bodyId === 'char_4145_ulpia' && values.anchorPullForce != null)
    for (const target of targets) battle.pullToFront(target, unit, num(unit, values.anchorPullForce));
  if (bodyId === 'char_1001_amiya2' && targets[0]) {
    const target = targets[0]; let killed = false;
    for (let i = 0; i < hits && target.alive; i++) {
      const final = i === hits - 1;
      const before = target.alive;
      damage(battle, unit, target, { scale, type: 'arts', isSkill: true, sourceKey: `${bodyId}:slash:${i}`, cause }); // 大巴扎：每次都是 a% 法术伤害
      if (before && !target.alive) killed = true;
    }
    return;
  }
  if (['char_127_estell', 'char_491_humus'].includes(bodyId)) unit.mem.assaultSkillLifestealHits = [];
  if (values.selfHpCostRatio != null) battle.loseHp(unit, unit.hp * num(unit, values.selfHpCostRatio), { source: unit, tags: ['assaultSkillCost'] });
  const silverAshHitTargets = bodyId === 'char_172_svrash' ? new Set() : null;
  for (const target of targets) {
    const sourceKey = values.sourceKey ?? `${unit.def.charId}:${effect.action}`;
    const ghostSnapshot = ghost2BaseSnapshot?.targets.get(target);
    const ghostHitHandle = ghostSnapshot ? battle.on('damaged', (event) => {
      if (event.source === unit && event.target === target && event.dmg?.isSkill && event.dmg.attackId === sourceKey)
        ghostSnapshot.landed = true;
    }, { owner: unit }) : null;
    const blockedBy = target.blockedBy;
    const hitHandle = brocaHitTargets || silverAshHitTargets ? battle.on('damaged', (event) => {
      if (event.source === unit && event.target === target && event.dmg?.isSkill && event.dmg.attackId === sourceKey) {
        if (brocaHitTargets && !brocaHitTargets.includes(target)) brocaHitTargets.push(target);
        silverAshHitTargets?.add(target);
      }
    }, { owner: unit }) : null;
    let dealt;
    try {
      dealt = bodyId === 'char_4064_mlynar' && values.extraTrueAtkScale != null && invocation?.mlynarMark
        ? battle.assaultRuntime.withCause(cause, () => battle.dealDamage(unit, target, {
          amount: invocation.mlynarMark.atk * scale, type: damageType, isSkill: true, canDodge: false,
          tags: invocation.mlynarMark.own ? ['assaultMlynarMark', 'assaultMlynarOwn'] : ['assaultMlynarMark'],
        }))
        : num(unit, values.asMelee, 0) > 0
        ? assaultMeleeDamage(battle, unit, target, { scale, hits, type: damageType, sourceKey, cause })
        : damage(battle, unit, target, { scale, hits, type: damageType, isSkill: true, sourceKey, cause,
          defIgnorePct: num(unit, values.ignoreDefRatio, undefined), defIgnoreFlat: num(unit, values.ignoreDefFixed, undefined), resIgnorePct: num(unit, values.ignoreResRatio, undefined) });
    } finally {
      if (ghostHitHandle) battle.off(ghostHitHandle);
      if (hitHandle) battle.off(hitHandle);
    }
    if (['char_127_estell', 'char_491_humus'].includes(bodyId) && dealt > 0)
      unit.mem.assaultSkillLifestealHits.push({ target, blockedBy, dealt });
    if (bodyId === 'char_155_tiger' && invocation?.tigerCast) invocation.tigerCast.actualDamage += Math.max(0, dealt);
    if (bodyId === 'char_350_surtr' && !target.alive && values.resetSpOnKill)
      sp(battle, unit, unit, Math.max(0, Number(unit.skill?.spCost ?? 0) - Number(unit.skill?.sp ?? 0)), 'nativeSkillKill', `${bodyId}:skill-kill:${uid(target)}`, cause);
    if (bodyId === 'char_491_humus' && values.healFlat != null && dealt > 0)
      heal(battle, unit, unit, { amount: num(unit, values.healFlat), sourceKey: `${bodyId}:native-skill-heal`, cause });
    // 大巴扎：宴的低生命追加伤害移到模组「翻盖手机」（施放时技能伤害 +x%）。
    if (bodyId === 'char_337_utage' && values.lowHpExtraArts != null && false)
      damage(battle, unit, target, { scale: num(unit, values.lowHpExtraArts), type: 'arts', isSkill: true, sourceKey: `${bodyId}:low-hp-extra`, cause });
    // 大巴扎：水月主动不再附带一次强化天赋。
    if (bodyId === 'char_437_mizuki' && values.firstTalentBonusOnce && dealt > 0 && false)
      damage(battle, unit, target, { scale: num(unit, values.talentAtkScale), type: 'phys', isSkill: true, sourceKey: `${bodyId}:native-talent-once`, cause });
    if (dealt > 0 && values.stunPerHit != null && num(unit, values.stunPerHit, 0) > 0)
      applyStatus(battle, unit, target, { status: 'stun', duration: num(unit, values.stunPerHit), key: `${unit.def.charId}:periodic-stun`, cause });
    if (bodyId === 'char_474_glady' && target.alive && values.dragForce != null) {
      const moved = battle.pullToFront(target, unit, num(unit, values.dragForce));
      if (moved > 1e-6) awardGladiaDragSp(battle, unit, target, cause);
    } else if (bodyId === 'char_474_glady' && target.alive) {
      const pullEffect = unit.def.raw.assaultBody.fixedSkill.effects.find((entry) => entry.action === 'move' && entry.values?.pullToSelf != null);
      const pullForce = pullEffect ? num(unit, pullEffect.values.force) : num(unit, values.dragForce);
      const center = unit.mem.assaultGladiaCycloneCenter;
      const moved = center ? battle.pull(target, num(unit, values.dragForce ?? values.force, pullForce), { to: center, stop: 0.05 }) : 0;
      if (moved > 1e-6) {
        awardGladiaDragSp(battle, unit, target, cause);
        battle.assaultRuntime.publish('gladiaCenterDrag', { source: unit, target, moved, cause });
      }
    }
  }
  if (brocaHitTargets) {
    unit.mem.assaultLastSkillHitTargets = [...brocaHitTargets];
    unit.mem.assaultLastSkillHitTargetCount = brocaHitTargets.length;
  }
  if (bodyId === 'char_1019_siege2') unit.mem.assaultSiegeSkillUntil = -Infinity;
  if (bodyId === 'char_437_mizuki' && !periodic && targets.length >= 2) triggerMizukiMultiHit(battle, unit, targets, cause);
  if (silverAshHitTargets) unit.mem.assaultSilverAshHits = silverAshHitTargets.size;
  if (rangeBuffKey) { battle.removeBuff(unit, rangeBuffKey); battle._refreshRange(unit); }
}

function attachTalrRootDamage(battle, unit, target, instanceKey, cause) {
  const effect = unit.def.raw.assaultBody?.fixedSkill?.effects?.find((entry) => entry.action === 'damage'
    && entry.values?.atkScalePerSec != null && entry.values?.interval != null);
  if (!effect) return;
  const root = target.buffs.find((entry) => entry.key === instanceKey && entry.status === 'bind' && entry.source === unit);
  if (!root) return;
  root.data.assaultTalrPeriodicCause = cause ?? null;
  if (root.data.assaultTalrPeriodicInstalled) return;
  const values = effect.values ?? {};
  const priorOnTick = root.onTick;
  root.onTick = (ctx) => {
    if (priorOnTick) priorOnTick(ctx);
    if (!ctx.unit.alive || !ctx.unit.buffs.includes(root) || !active(unit)) return;
    damage(ctx.battle, unit, ctx.unit, {
      scale: num(unit, values.atkScalePerSec), hits: 1, type: physicalFor(unit, values), isSkill: true,
      sourceKey: values.sourceKey ?? unit.def.charId + ':damage', cause: root.data.assaultTalrPeriodicCause,
    });
  };
  root.interval = 1;
  root.data.assaultTalrPeriodicInstalled = true;
}

function assaultMeleeDamage(battle, unit, target, { scale, hits, type, sourceKey, cause }) {
  if (!['phys', 'arts', 'true'].includes(type) || !Number.isFinite(scale) || !Number.isInteger(hits) || hits < 1 || hits > 100)
    throw new TypeError(`invalid melee skill damage for ${unit.def.charId}`);
  let total = 0;
  for (let index = 0; index < hits && target.alive; index++) {
    const dealt = battle.assaultRuntime.withCause(cause, () => battle.dealDamage(unit, target, {
      amount: unit.s.atk * scale, type, isAttack: true, isSkill: true, isProjectile: false, attackId: sourceKey,
    }));
    if (Number.isFinite(dealt)) total += dealt;
  }
  return total;
}

function triggerMizukiMultiHit(battle, unit, targets, cause = battle.assaultRuntime.currentCause) {
  const plan = unit.def.raw.assaultBody.modePassives[0];
  const target = targets.filter((candidate) => candidate?.alive && candidate.side === 'enemy').sort((a, b) => a.hp - b.hp || a.spawnSeq - b.spawnSeq)[0];
  if (!target) return false;
  return queue(battle, `assault:${unit.def.charId}:multi-hit:${uid(target)}`, target, (rt, task) => {
    const previousTargets = unit.mem.assaultLastSkillTargets;
    const previousCount = unit.mem.assaultLastSkillTargetCount;
    try {
      execute({ battle, unit, effect: { ...plan, values: { ...plan.values, damageType: '法术', sourceKey: `${unit.def.charId}:multi-hit-passive` } }, targets: [target], cause: task.cause });
    } finally {
      unit.mem.assaultLastSkillTargets = previousTargets;
      unit.mem.assaultLastSkillTargetCount = previousCount;
    }
  }, cause);
}

function triggerQiuBaiRoot(battle, unit, target, cause = battle.assaultRuntime.currentCause) {
  if (!target?.alive || target.side !== 'enemy' || target.s.flags.bind || target.findBuff('bind') || target.findBuff('sluggish')) return false;
  const passive = unit.def.raw.assaultBody.modePassives[0];
  if (battle.rng() >= num(unit, passive.values.prob, 0)) return false;
  return queue(battle, `assault:${unit.def.charId}:root:${uid(target)}`, target, (rt, task) =>
    execute({ battle, unit, effect: { action: 'applyStatus', trigger: passive.trigger, values: { ...passive.values, statusKey: `${unit.def.charId}:root` } },
      targets: [target], cause: task.cause }), cause);
}

function triggerBlitzTremble(battle, unit, target, cause = battle.assaultRuntime.currentCause) {
  if (!target?.alive || target.side !== 'enemy') return false;
  const passive = unit.def.raw.assaultBody.modePassives[0];
  if (battle.rng() >= num(unit, passive.values.prob, 0)) return false;
  return queue(battle, `assault:${unit.def.charId}:tremble:${uid(target)}`, target, (rt, task) =>
    applyStatus(battle, unit, target, { status: 'tremble', duration: num(unit, passive.values.trembleDuration), key: `${unit.def.charId}:tremble`, cause: task.cause }), cause);
}

function triggerSiegeFirstHit(battle, unit, target, cause = battle.assaultRuntime.currentCause) {
  if (!target?.alive || target.side !== 'enemy') return false;
  const seen = unit.mem.assaultSiegeFirstHit ??= new Set();
  const key = uid(target);
  if (seen.has(key)) return false;
  seen.add(key);
  const passive = unit.def.raw.assaultBody.modePassives[0];
  return queue(battle, `assault:${unit.def.charId}:first-hit:${key}`, target, (rt, task) =>
    applyStatus(battle, unit, target, { status: 'tremble', duration: num(unit, passive.values.trembleDuration), key: `${unit.def.charId}:first-hit-tremble`, cause: task.cause }), cause);
}

function awardGladiaDragSp(battle, unit, displaced, cause = battle.assaultRuntime.currentCause) {
  const passive = unit.def.raw.assaultBody.modePassives[0];
  const values = { ...(passive.values ?? {}) };
  const moduleHooks = unit.mem.assaultModuleHooks;
  if (moduleHooks?.active) {
    const piece = unit.def.raw.assaultPiece;
    const effect = { ...passive, values };
    const moduleCtx = { battle, unit, body: unit.def.raw.assaultBody, piece, rank: piece.star, cause, effect, params: values, targets: [displaced], hitCount: 1 };
    const overrides = moduleHooks.beforeEffect(moduleCtx);
    if (overrides && typeof overrides === 'object') Object.assign(moduleCtx, overrides);
    Object.assign(values, moduleCtx.params ?? moduleCtx.effect?.values ?? values);
  }
  // 执政官手镜：被拉拽的敌人受到 a% 法术伤害。
  const mirror = moduleParam(unit, 'uniequip_002_glady', 'a', 0) / 100;
  if (mirror > 0 && displaced?.alive) queue(battle, `assault:${unit.def.charId}:mirror:${uid(displaced)}:${battle.time}`, displaced,
    (rt, task) => damage(battle, unit, displaced, { scale: mirror, type: 'arts', isSkill: true, sourceKey: `${unit.def.charId}:module-mirror`, cause: task.cause }), cause);
  // 大巴扎：「当此干员拉拽敌人时，为此干员充能 c（每场战斗前 10 次）」；淡金坠饰改为每场战斗前 m 次。
  const cap = moduleParam(unit, 'uniequip_003_glady', 'm', 10);
  if ((unit.mem.assaultGladiaDragSpCount ?? 0) >= cap) return false;
  const count = unit.mem.assaultGladiaDragSpCount = (unit.mem.assaultGladiaDragSpCount ?? 0) + 1;
  return queue(battle, `assault:${unit.def.charId}:drag-sp:${count}:${uid(displaced)}`, unit,
    (rt, task) => sp(battle, unit, unit, lineParam(unit, 2, 'c', num(unit, values.sp, 0)), 'gladiaDrag', `${unit.def.charId}:drag-sp`, task.cause), cause);
}

function castAmiyaGuard({ battle, unit, body, rank: star, cause }) {
  const effect = body.fixedSkill.effects[0];
  const values = effect.values;
  const hits = Number(v(unit, values.times));
  const scale = Number(v(unit, values.atkScale));
  const followup = body.fixedSkill.effects.find((candidate) => candidate.action === 'nativeMechanism')?.values ?? {};
  const killPassive = body.modePassives.find((candidate) => candidate.values?.trueAfterKill != null)?.values ?? {};
  // 大巴扎：卡面「对生命最低的敌人造成 n 次 a% 法术伤害」——删去末击翻倍/真实伤害、击杀后转真伤、击杀叠攻与技能后光环翻倍。
  const afterKillTrue = false && Number(v(unit, followup.trueDamageAfterKill)) > 0 && Number(v(unit, killPassive.trueAfterKill)) > 0;
  const finalAlwaysTrue = false && Number(v(unit, followup.finalHitAlwaysTrue)) > 0;
  const piece = unit.def.raw.assaultPiece;
  const module = star >= 3 && (piece.moduleId ?? piece.moduleChoices?.[body.charId]) === 'uniequip_002_amiya2';
  const finalScale = 1;
  unit.mem.assaultAmiyaKills = 0;
  let hasKill = false;
  const killBuffs = [];
  for (let i = 0; i < hits; i++) {
    const target = enemies(battle, unit, { scope: 'range', priority: 'hp', count: 1 })[0];
    if (!target) break;
    const wasAlive = target.alive;
    const final = i === hits - 1;
    const type = (final && finalAlwaysTrue) || (hasKill && afterKillTrue)
      ? (final ? String(v(unit, values.finalHitDmgType) ?? 'true') : 'true')
      : String(v(unit, values.dmgType) ?? 'arts');
    damage(battle, unit, target, { scale: scale * (final ? finalScale : 1),
      type, hits: 1, isSkill: true, sourceKey: `${body.charId}:slash:${i}`, cause });
    if (wasAlive && !target.alive) hasKill = true;
    if (wasAlive && !target.alive) {
      const passive = body.modePassives.find((plan) => plan.values?.killAtk);
      const previousKills = unit.mem.assaultAmiyaKills ?? 0;
      const cap = passive ? Math.max(0, Math.floor(num(unit, passive.values.maxStacks, 3))) : 0;
      unit.mem.assaultAmiyaKills = Math.min(cap, previousKills + 1);
      if (false && passive && previousKills < cap) {
        const key = `${body.charId}:slaughter:${i}`;
        buff(battle, unit, unit, { key, mods: { atkPct: Number(v(unit, passive.values.killAtk)), resFlat: Number(v(unit, passive.values.killMres)) }, duration: 10, cause });
        killBuffs.push(key);
      }
    }
  }
  for (const key of killBuffs) battle.removeBuff(unit, key);
  unit.mem.assaultAmiyaRank = star;
  const aura = null;
  if (aura) {
    const moduleId = piece.moduleId ?? piece.moduleChoices?.[body.charId];
    const moduleActive = module && star >= 3 && moduleId === 'uniequip_002_amiya2';
    const auraBonus = moduleActive ? (star >= 4 ? 0.09 : 0.08) : Number(v(unit, aura.values.atk));
    const extra = auraBonus * Math.max(0, Number(v(unit, aura.values.doubleMultiplier, 2)) - 1);
    const duration = Number(v(unit, aura.values.doubleWindow));
    for (const ally of battle.allyUnits) if (ally.kind === 'op') buff(battle, unit, ally, {
      key: `${body.charId}:double-window`, mods: { atkPct: extra, defPct: extra }, duration, stacking: 'replace', cause,
    });
  }
}

function castAmiyaMedic({ battle, unit, body, cause }) {
  const [strike, debuff, recovery] = body.fixedSkill.effects;
  const values = strike.values;
  const targets = enemies(battle, unit, { scope: 'range', priority: 'exit', count: 100 });
  let hits = 0;
  const stackPlan = body.modePassives.find((passive) => passive.values?.atkPerHit);
  const hitBuffs = [];
  const piece = unit.def.raw.assaultPiece;
  const module = piece.star >= 3 && (piece.moduleId ?? piece.moduleChoices?.[body.charId]) === 'uniequip_002_amiya3';
  for (const target of targets) {
    const trueAfterStack = false; // 大巴扎：卡面只写法术伤害，不再在首击后转真实伤害
    let landed = false;
    const hitHandle = battle.on('damaged', (event) => {
      if (event.source === unit && event.target === target && event.dmg?.isSkill) landed = true;
    }, { owner: unit });
    try {
    damage(battle, unit, target, { scale: Number(v(unit, values.atkScale)), type: hits > 0 && trueAfterStack ? 'true' : String(v(unit, values.dmgType) ?? 'arts'), isSkill: true, sourceKey: `${body.charId}:strike:${hits}`, cause });
    } finally { battle.off(hitHandle); }
    if (!landed) continue;
    buff(battle, unit, target, { key: `${body.charId}:attack-move-slow`, mods: { aspd: Number(v(unit, debuff.values.attackSpeed)), moveMul: 1 + Number(v(unit, debuff.values.moveSpeed)) },
      duration: Number(v(unit, debuff.values.duration)), cause });
    hits++;
    // 大巴扎：删去逐命中叠攻（卡面没有）。
    if (false && stackPlan && hits <= Number(v(unit, stackPlan.values.maxStacks))) {
      const key = `${body.charId}:cast-stack:${hits}`;
      buff(battle, unit, unit, { key, mods: { atkPct: Number(v(unit, stackPlan.values.atkPerHit)), maxTargets: hits === 1 ? Number(v(unit, values.maxTargetsAfterStack ?? stackPlan.values.multiTargetAfterStack)) : 0 }, duration: 10, cause });
      hitBuffs.push(key);
    }
  }
  // 大巴扎：治疗由第三行「当你的罗德岛干员施放技能时，治疗生命最低的干员」负责（含自身施放），这里不再重复治疗。
  const patient = null;
  if (patient) {
    const healScale = module ? 0.6 : Number(v(unit, recovery.values.healRatio));
    heal(battle, unit, patient, { scale: healScale, sourceKey: `${body.charId}:skillHeal`, cause });
  }
  unit.mem.assaultAmiyaHits = Math.min(5, hits);
  const aura = null; // 大巴扎：删去技能后的全队再生（卡面没有）。
  if (aura) {
    const moduleRate = module ? (piece.star >= 4 ? 0.035 : 0.03) : Number(v(unit, aura.values.hpRecoveryPerSecByMaxHp));
    const duration = Number(v(unit, aura.values.regenDuration)) + (module && piece.star >= 4 ? 0 : 0);
    for (const ally of battle.allyUnits) if (ally.kind === 'op' && ally.alive && ally.deployed) {
      battle.addBuff(ally, { key: `${body.charId}:skill-regen`, mods: { hpRegenRatio: moduleRate }, duration, refresh: 'replace', source: unit, visible: true });
    }
  }
  for (const key of hitBuffs) battle.removeBuff(unit, key);
  return hits;
}

const BUFF_MAP = {
  atkBonus: (n) => ({ atkPct: n }), atk: (n) => ({ atkPct: n }), defBonus: (n) => ({ defPct: n }),
  defRatio: (n) => ({ defPct: n }), maxHpBonus: (n) => ({ hpPct: n }), maxHp: (n) => ({ hpPct: n }),
  attackSpeedBonus: (n) => ({ aspd: n }), atkDefRatio: (n) => ({ atkPct: n, defPct: n }),
  blockBonus: (n) => ({ blockCnt: n }), extraTargets: (n) => ({ maxTargets: n }), rangeExtend: (n) => ({ rangeExtend: n }), ignoreDefRatio: (n) => ({ defIgnorePct: n }),
  defPenalty: (n) => ({ defPct: n }), baseAtkDef: (n) => ({ atkPct: n, defPct: n }), maxHpFixed: (n) => ({ hpFlat: n }),
  targetedMoreLikely: (n) => ({ taunt: n }),
};
function runBuff({ battle, unit, effect, targets = null }) {
  const values = effect.values ?? {};
  if (unit.def.charId === 'char_308_swire' && values.radius != null && values.atkBonus != null)
    targets = battle.allyUnits.filter(ally => active(ally) && ally.ownerId === unit.ownerId && ally !== unit && ally.kind !== 'device' && ally.profile?.attack === 'melee' && Math.abs(ally.tileR - unit.tileR) <= 1 && Math.abs(ally.tileC - unit.tileC) <= 1);
  if (unit.def.charId === 'char_265_sophia' && values.barrierRatio != null) {
    // 大巴扎：护盾对象为此干员与周围全部干员（不再限近战）。
    targets = battle.allyUnits.filter(ally => active(ally) && ally.ownerId === unit.ownerId && ally.kind === 'op' &&
      (ally === unit || Math.abs(ally.tileR - unit.tileR) <= num(unit, values.radius, 1) &&
      Math.abs(ally.tileC - unit.tileC) <= num(unit, values.radius, 1)));
  }
  if (['char_308_swire', 'char_265_sophia'].includes(unit.def.charId) && (values.radius != null || values.barrierRatio != null) && targets?.length === 0) return;
  if (unit.def.charId === 'char_127_estell' && effect.trigger === '舍身突击结算后')
    battle.addBuff(unit, { key: 'char_127_estell:heal-lock', flags: { noHeal: true }, duration: num(unit, values.duration, 8), refresh: 'replace', source: unit });
  if (unit.def.charId === 'char_264_f12yin' && values.talentProbBonus != null) {
    const duration = Math.max(0, num(unit, values.duration, 0));
    const generation = unit.mem.assaultF12yinSkillBuffGeneration = (unit.mem.assaultF12yinSkillBuffGeneration ?? 0) + 1;
    unit.mem.assaultF12yinPunchBonus = num(unit, values.talentProbBonus, 0);
    if (duration > 0) battle.after(duration, () => {
      if (unit.mem.assaultF12yinSkillBuffGeneration === generation) unit.mem.assaultF12yinPunchBonus = 0;
    }, { owner: unit });
    return true;
  }
  if (unit.def.charId === 'char_143_ghost' && values.undeathDuration != null) {
    const duration = num(unit, values.undeathDuration, 0);
    if (duration > 0) {
      unit.mem.assaultGhostUndeathGeneration = (unit.mem.assaultGhostUndeathGeneration ?? 0) + 1;
      unit.mem.assaultGhostUndeathUntil = battle.time + duration;
      if (!unit.mem.assaultGhostFatalGuardInstalled) {
        unit.mem.assaultGhostFatalGuardInstalled = true;
        battle.on('fatal', (ctx) => {
          if (ctx.unit === unit && battle.time < Number(unit.mem.assaultGhostUndeathUntil ?? 0)) ctx.prevented = true;
        }, { owner: unit });
      }
    }
  }
  if (unit.def.charId === 'char_1019_siege2' && String(v(unit, values.damageTypeOverride)) === '真实') {
    unit.mem.assaultSiegeSkillUntil = battle.time + num(unit, values.duration, 25);
  }
  const mods = {};
  for (const [field, convert] of Object.entries(BUFF_MAP)) if (values[field] != null) {
    let n = num(unit, values[field]);
    if (unit.def.charId === 'char_172_svrash' && field === 'defPenalty' && unit.mem.assaultSilverAshModule && unit.mem.assaultSilverAshHits >= 3) n = -0.5;
    Object.assign(mods, convert(n));
  }
  if (unit.def.charId === 'char_1019_siege2' && values.attackIntervalDelta != null) {
    const baseBat = Number(unit.base?.bat ?? unit.s?.bat);
    if (!(baseBat > 0)) throw new RangeError('Siege Alter requires a positive base attack interval');
    mods.batPct = num(unit, values.attackIntervalDelta) / baseBat;
  }
  if (unit.def.charId === 'char_4064_mlynar' && values.traitMultiplier != null) {
    mods.atkPct = (mods.atkPct ?? 0) + Math.max(0, Number(unit.trait.ramp) || 0) * (num(unit, values.traitMultiplier, 1) - 1);
  }
  if (unit.def.charId === 'char_1014_nearl2' && values.blockedTrueDamage != null)
    unit.mem.assaultNearl2BlockedTrueUntil = battle.time + num(unit, values.duration, 0);
  if (values.barrierRatio != null) {
    const piece = unit.def.raw.assaultPiece;
    const moduleId = piece.moduleId ?? piece.moduleChoices?.[unit.def.charId];
    const humusModule = unit.def.charId === 'char_491_humus' && piece.star >= 3 && moduleId === 'uniequip_002_humus';
    const amount = unit.s.maxHp * num(unit, values.barrierRatio) * (1 + moduleParam(unit, 'uniequip_002_sophia', 'x', 0) / 100);
    // 大巴扎：恶地奇异工具套组改为「拥有护盾时 +x% 防御力」（assault-bazaar.js）。
    for (const target of targets?.length ? targets : [unit]) {
      const duration = num(unit, values.duration ?? values.shieldDuration ?? values.undeathDuration, 8);
      const spec = { key: `${unit.def.charId}:barrier`, shield: amount, duration, visible: true, source: unit };
      if (['char_237_gravel', 'char_154_morgan'].includes(unit.def.charId)) {
        let step = 0;
        Object.assign(spec, { interval: 1, onTick: ({ unit: owner, buff: barrier }) => {
          const previous = Math.max(0, duration - step) / duration;
          const next = Math.max(0, duration - ++step) / duration;
          if (previous > 0 && barrier.shield > 0) { barrier.shield *= next / previous; owner.markDirty(); }
        } });
      }
      // 大巴扎：隐秘行动工具包只延长再部署后的防御力加成，删去护盾结束治疗。
      battle.addBuff(target, spec);
    }
  }
  if (unit.def.charId === 'char_143_ghost' && values.fatalGuard) {
    const guardKey = `${unit.def.charId}:fatal-guard`;
    unit.mem.assaultGhostFatalGuardRemaining = Math.max(1, Math.floor(num(unit, values.fatalGuard, 1)));
    if (!unit.mem.assaultGhostFatalGuardInstalled) {
      unit.mem.assaultGhostFatalGuardInstalled = true;
      battle.on('fatal', (ctx) => {
        if (ctx.unit !== unit || !(unit.mem.assaultGhostFatalGuardRemaining > 0)) return;
        unit.mem.assaultGhostFatalGuardRemaining -= 1;
        ctx.prevented = true;
        if (unit.mem.assaultGhostFatalGuardRemaining === 0) {
          battle.removeBuff(unit, guardKey);
          const stun = unit.def.raw.assaultBody.fixedSkill.effects.find((entry) => entry.values?.stunDuration != null);
          if (stun) execute({ battle, unit, effect: stun, targets: [unit], cause: battle.assaultRuntime.currentCause });
        }
      }, { owner: unit });
    }
    battle.addBuff(unit, { key: guardKey, flags: { fatalGuard: true }, duration: Infinity, source: unit, visible: true });
  }
  if (Object.keys(mods).length) for (const target of targets?.length ? targets : [unit]) {
    const duration = num(unit, values.duration ?? values.undeathDuration, Infinity) <= 0 ? Infinity : num(unit, values.duration ?? values.undeathDuration, Infinity);
    const key = `${unit.def.charId}:${effect.action}:${effect.trigger}`;
    if (unit.def.charId === 'char_4064_mlynar' && values.traitMultiplier != null && target === unit) {
      const finish = beginMlynarWindow(battle, unit, values, duration);
      battle.addBuff(unit, { key, mods, duration, refresh: 'replace', visible: true, source: unit, onExpire: finish, onRemove: finish });
    } else buff(battle, unit, target, { key, mods, duration, stacking: 'replace' });
  }
}
function runHeal({ battle, unit, effect, targets, periodic = false, invocation = null }) {
  const values = effect.values ?? {};
  if (['char_127_estell', 'char_491_humus'].includes(unit.def.charId) && values.healScale != null) {
    const hits = unit.mem.assaultSkillLifestealHits ?? [];
    unit.mem.assaultSkillLifestealHits = [];
    for (const hit of hits) if (hit.blockedBy === unit)
      heal(battle, unit, unit, { amount: hit.dealt * num(unit, values.healScale), sourceKey: effect.action });
    return;
  }
  if (unit.def.charId === 'char_155_tiger') {
    const actualDamage = Number(invocation?.tigerCast?.actualDamage ?? 0);
    const ratio = num(unit, values.healScale, 0);
    if (actualDamage > 0 && ratio > 0) {
      for (const target of targets?.length ? targets : [unit])
        heal(battle, unit, target, { amount: actualDamage * ratio, sourceKey: effect.action });
    }
    return;
  }
  if (!periodic && Number(values.interval) > 0 && Number(values.duration) > 0) {
    const expires = battle.time + num(unit, values.duration);
    const cancel = onTimer(battle, unit, num(unit, values.interval), (b) => {
      if (b.time + 1e-9 >= expires) { cancel(); return; }
      runHeal({ battle: b, unit, effect, targets, periodic: true });
    }, { every: true });
    return;
  }
  for (const target of targets?.length ? targets : [unit]) {
    if (values.healRatio != null && values.healType === 'atkScale') heal(battle, unit, target, { scale: num(unit, values.healRatio), sourceKey: effect.action });
    else if (values.healRatio != null) heal(battle, unit, target, { maxHpRatio: num(unit, values.healRatio), sourceKey: effect.action });
    else if (values.maxHpRatio != null) heal(battle, unit, target, { maxHpRatio: num(unit, values.maxHpRatio), sourceKey: effect.action });
    else if (values.healScale != null) heal(battle, unit, target, { scale: num(unit, values.healScale), sourceKey: effect.action });
    else if (values.healScalePerSec != null) heal(battle, unit, target, { scale: num(unit, values.healScalePerSec) * (periodic ? num(unit, values.interval, 1) : 1), sourceKey: effect.action });
    else if (values.healPerSec != null) heal(battle, unit, target, { amount: num(unit, values.healPerSec) * 5 * (periodic ? num(unit, values.interval, 1) : 1), sourceKey: effect.action });
    else if (values.healPerHit != null || values.lowHpHeal != null) {
      const threshold = num(unit, values.hpThreshold, 0.5);
      const amount = unit.hp / unit.s.maxHp <= threshold ? num(unit, values.lowHpHeal, values.healPerHit) : num(unit, values.healPerHit, values.lowHpHeal);
      heal(battle, unit, target, { amount, sourceKey: effect.action });
    }
    else if (values.healFull === true || num(unit, values.healFull, 0) === 1) heal(battle, unit, target, { maxHpRatio: 1, sourceKey: effect.action,
      ignoreHealFree: unit.def.charId === 'char_350_surtr' && target === unit });
    else throw new TypeError(`unsupported heal plan ${unit.def.charId}:${JSON.stringify(Object.keys(values))}`);
  }
}
function executeInstantAmmo({ battle, unit, effect, cause }) {
  const values = effect.values ?? {}, id = unit.def.charId, star = unit.def.raw.assaultPiece.star;
  const piece = unit.def.raw.assaultPiece, moduleId = piece.moduleId ?? piece.moduleChoices?.[id];
  const bonus = id === 'char_1041_angel2' && star >= 3 && moduleId === 'uniequip_002_angel2' ? 1 : 0;
  const count = Math.max(1, Math.floor(num(unit, values.ammoCount, 1) + bonus));
  let target = id === 'char_1041_angel2' && unit.mem.assaultAngelTarget?.alive
    ? unit.mem.assaultAngelTarget : enemies(battle, unit, { scope: 'range', count: 1 })[0];
  if (!target?.alive) return false;
  const ammo = { left: count, capacity: count, instant: true };
  unit.mem.assaultAmmo = ammo;
  const scale = num(unit, values.atkScalePerHit ?? values.atkScale, 0);
  const legalTargets = enemies(battle, unit, { scope: 'range', count: 99 });
  let finalTarget = target;
  for (let shot = 0; shot < count; shot++) {
    if (!finalTarget?.alive) finalTarget = legalTargets.find((candidate) => candidate.alive) ?? null;
    if (finalTarget) damage(battle, unit, finalTarget, { scale, type: physicalFor(unit, values), isSkill: true,
      sourceKey: `${id}:instant-shot:${shot + 1}`, cause });
    ammo.left = count - shot - 1;
    battle.emit('ammoUsed', { source: unit, sourceUid: uid(unit), target: unit, targetUid: uid(unit), quantity: 1,
      remaining: ammo.left, capacity: count, isSkill: true, instant: true });
  }
  if (id === 'char_1032_excu2' && finalTarget?.alive) {
    const finalEffect = unit.def.raw.assaultBody.fixedSkill.effects.find((entry) => entry.action === 'damage' && entry.values?.finalAtkScale != null);
    if (finalEffect) {
      const finalTargets = [finalTarget, ...legalTargets.filter((candidate) => candidate !== finalTarget && candidate.alive)]
        .slice(0, 1 + Math.max(0, Number(unit.mem.assaultExcuFinalTargetBonus) || 0));
      execute({ battle, unit, effect: finalEffect, targets: finalTargets, cause });
    }
  }
  unregisterAssaultAmmo(unit);
  unit.mem.assaultAmmo = null;
  if (id === 'char_1032_excu2') {
    unit.mem.assaultExcu2AmmoStacks = 0;
    battle.removeBuff(unit, `${id}:ammo-growth`);
    battle.removeBuff(unit, `${id}:ammo-attack-interval`);
  }
  return count;
}
function execute({ battle, unit, effect, cause, targets = null, moduleHooksApplied = false, invocation = null }) {
  const hooks = unit.mem.assaultModuleHooks;
  if (hooks?.active && !moduleHooksApplied) {
    const cloned = { ...effect, values: { ...(effect.values ?? {}) } };
    const moduleTargets = targets ?? (['damage','applyStatus','move'].includes(effect.action) ? targetsFor(battle, unit, cloned) : null);
    const originalTargets = moduleTargets ? [...moduleTargets] : null;
    const moduleCtx = { battle, unit, body: unit.def.raw.assaultBody, piece: unit.def.raw.assaultPiece, rank: unit.def.raw.assaultPiece.star,
      cause, effect: cloned, params: cloned.values, targets: moduleTargets, hitCount: moduleTargets?.length ?? 0,
      ...(cloned.values?.atkScale != null ? { damageScale: num(unit, cloned.values.atkScale) } : null) };
    const overrides = hooks.beforeEffect(moduleCtx);
    if (overrides && typeof overrides === 'object') Object.assign(moduleCtx, overrides);
    const effectiveEffect = moduleCtx.effect && moduleCtx.effect !== cloned ? moduleCtx.effect : { ...cloned, values: moduleCtx.params ?? cloned.values };
    if (moduleCtx.params && effectiveEffect.values !== moduleCtx.params) effectiveEffect.values = moduleCtx.params;
    if (Number.isFinite(moduleCtx.damageScale) && effectiveEffect.values?.atkScale != null) effectiveEffect.values.atkScale = moduleCtx.damageScale;
    const changedTargets = moduleCtx.targets && (!originalTargets || moduleCtx.targets.length !== originalTargets.length || moduleCtx.targets.some((target, index) => target !== originalTargets[index]));
    const result = execute({ battle, unit, effect: effectiveEffect, cause, targets: changedTargets ? moduleCtx.targets : targets, moduleHooksApplied: true, invocation });
    moduleCtx.effect = effectiveEffect;
    moduleCtx.params = effectiveEffect.values;
    moduleCtx.result = result;
    moduleCtx.hitCount = Number(unit.mem.assaultLastSkillTargetCount ?? moduleCtx.targets?.length ?? 0);
    const forcerModuleId = unit.def.charId === 'char_4036_forcer' &&
      (unit.def.raw.assaultPiece.moduleId ?? unit.def.raw.assaultPiece.moduleChoices?.[unit.def.charId]) === 'uniequip_002_forcer';
    hooks.afterEffect(moduleCtx);
    if (forcerModuleId && effectiveEffect.action === 'move') {
      for (const [targetUid, pushed] of unit.mem.assaultForcerPushResults ?? []) {
        const target = battle.enemies.find((candidate) => uid(candidate) === targetUid);
        if (target) applyForcerHighlandModuleHit({ battle, unit, target, pushResult: pushed, rank: unit.def.raw.assaultPiece.star,
          moduleId: 'uniequip_002_forcer', cause });
      }
    }
    return result;
  }
  const values = effect.values ?? {};
  switch (effect.action) {
    case 'damage': return runDamage({ battle, unit, effect, cause, selectedTargets: targets, invocation });
    case 'heal': return runHeal({ battle, unit, effect, targets, invocation });
    case 'addBuff': {
      if (unit.def.charId === 'char_4037_demetr' && effect.values?.attackSpeedBonus != null)
        unit.mem.assaultDemetrSkillUntil = battle.time + num(unit, effect.values.duration, 30);
      return runBuff({ battle, unit, effect, targets });
    }
    case 'applyStatus': {
      if (values.trembleDuration != null && values.trembleChance != null) {
        const chance = Math.max(0, Math.min(1, num(unit, values.trembleChance, 1)));
        if (chance <= 0 || (chance < 1 && battle.rng() >= chance)) return false;
      }
      if (unit.def.charId === 'char_350_surtr' && values.hpLossPerSecRatio != null) {
        const piece = unit.def.raw.assaultPiece;
        const moduleId = piece.moduleId ?? piece.moduleChoices?.[unit.def.charId];
        const moduleTwo = moduleId === 'uniequip_002_surtr' && piece.star >= 4;
        const startedAt = battle.time, ramp = moduleTwo ? 90 : num(unit, values.rampSec, 60), rate = num(unit, values.hpLossPerSecRatio, 0.2);
        unit.mem.assaultSurtrDrainCancel?.();
        const generation = unit.mem.assaultSurtrDrainGeneration = (unit.mem.assaultSurtrDrainGeneration ?? 0) + 1;
        const deployment = unit.deploySeq;
        unit.mem.assaultSurtrDrainCancel = onTimer(battle, unit, 0.1, (b, schedule) => {
          if (unit.deploySeq !== deployment || unit.mem.assaultSurtrDrainGeneration !== generation) {
            schedule.cancel?.(); unit._assaultTimers?.delete(schedule); return;
          }
          const progress = Math.min(1, (b.time - startedAt) / ramp);
          b.loseHp(unit, unit.s.maxHp * rate * progress * 0.1, { source: unit, tags: ['assaultSurtrDrain'] });
        }, { every: true });
        return true;
      }
      if (values.selfMaxHpCostRatio != null || values.selfHpCostRatio != null) {
        if (unit.def.charId === 'char_437_mizuki' && (unit.mem.assaultLastSkillTargetCount ?? 0) >= 3) return;
        const ratio = values.selfMaxHpCostRatio != null ? num(unit, values.selfMaxHpCostRatio) : num(unit, values.selfHpCostRatio);
        const basis = values.selfMaxHpCostRatio != null ? unit.s.maxHp : unit.hp;
        const cost = Math.min(Math.max(0, unit.hp - 1), basis * ratio);
        if (cost > 0) battle.loseHp(unit, cost, { source: unit, tags: ['assaultSkillCost'] });
        return cost;
      }
      const status = values.status === '攻速移速削减' ? 'sluggish' : values.status ?? (values.trembleDuration != null ? 'tremble' : values.stunDuration != null || values.stunDirect != null ? 'stun' : values.silenceDuration != null ? 'silence' : values.sluggishDuration != null ? 'sluggish' : values.rootDuration != null ? 'bind' : null);
      if (!status) throw new TypeError(`unsupported status plan ${unit.def.charId}`);
      const durationValue = values.duration ?? values.silenceDuration ?? values.stunDuration ?? values.stunDirect ?? values.trembleDuration ?? values.sluggishDuration ?? values.rootDuration;
      const apply = () => {
        const selected = unit.def.charId === 'char_356_broca' ? (targets ?? [])
          : targets?.length ? targets : unit.def.charId === 'char_4058_pepe'
          ? (unit.mem.assaultLastSkillTargets ?? []).filter((target) => target?.alive)
          : targetsFor(battle, unit, effect);
        if (unit.def.charId === 'char_474_glady' && values.rootDuration != null)
          unit.mem.assaultGladiaCycloneCenter = selected[0] ? { x: selected[0].x, y: selected[0].y } : null;
        const piece = unit.def.raw.assaultPiece;
        const slchanModule = unit.def.charId === 'char_173_slchan'
          && (piece.moduleId ?? piece.moduleChoices?.[unit.def.charId]) === 'uniequip_002_slchan';
        const contacts = unit.mem.assaultSlchanPullContacts ?? new Set();
        for (const [index, target] of selected.entries()) {
          const instanceKey = unit.def.charId === 'char_4155_talr' && status === 'bind'
            ? `${unit.def.charId}:bind:${uid(unit)}` : values.statusKey ?? `${unit.def.charId}:${status}`;
          const applied = applyStatus(battle, unit, target, { status,
            duration: num(unit, unit.def.charId === 'char_4058_pepe' && index === 0 ? values.stunMain : durationValue, 1) + (slchanModule && contacts.has(uid(target)) ? 1 : 0),
            value: num(unit, values.value, 1), key: instanceKey, cause });
          if (applied && unit.def.charId === 'char_4155_talr' && status === 'bind')
            attachTalrRootDamage(battle, unit, target, instanceKey, cause);
        }
        if (slchanModule) unit.mem.assaultSlchanPullContacts = new Set();
      };
      const applyForcerStatus = () => { for (const target of [...(unit.mem.assaultForcerPushResults?.keys() ?? [])].map((key) => battle.enemies.find((candidate) => uid(candidate) === key)).filter(Boolean)) {
        const push = unit.mem.assaultForcerPushResults?.get(uid(target));
        if (!push?.moved) continue;
        const result = push.collision;
        const selectedDuration = result?.kind === 'highland' ? values.stunWall : result?.kind === 'enemy' ? values.stunCollision : values.stunDirect;
        const applied = applyStatus(battle, unit, target, { status: 'stun', duration: num(unit, selectedDuration, 1), key: `${unit.def.charId}:stun`, cause });
        (unit.mem.assaultForcerStuns ??= new Map()).set(uid(target), !!applied);
      } };
      if (unit.def.charId === 'char_4036_forcer' && values.stunDirect != null) {
        if (Number(values.delaySec) > 0) battle.after(num(unit, values.delaySec), applyForcerStatus, { owner: unit }); else applyForcerStatus();
        return;
      }
      if (Number(values.delaySec) > 0) battle.after(num(unit, values.delaySec), apply, { owner: unit }); else apply();
      return;
    }
    case 'spGain': return sp(battle, unit, unit, num(unit, values.sp ?? values.spGain ?? values.spPerKill, 1), effect.action, `${unit.def.charId}:sp`, cause);
    case 'haste': {
      if (unit.def.charId === 'char_337_utage' && unit.hp / unit.s.maxHp >= 0.5) return;
      if (values.attackSpeedBonus != null) {
        return buff(battle, unit, unit, { key: `${unit.def.charId}:attack-speed-bonus`, mods: { aspd: num(unit, values.attackSpeedBonus, 0) }, duration: num(unit, values.duration, 1) });
      }
      return haste(battle, unit, unit, num(unit, values.duration, 1), `${unit.def.charId}:haste`);
    }
    case 'growth': {
      if (unit.def.charId === 'char_2024_chyue') {
        unit.mem.assaultChyueCasts = (unit.mem.assaultChyueCasts ?? 0) + 1;
        const threshold = Math.floor(num(unit, values.threshold, 5));
        if (!unit.mem.assaultChyueAwakened && unit.mem.assaultChyueCasts >= threshold) {
          unit.mem.assaultChyueAwakened = true;
          buff(battle, unit, unit, { key: `${unit.def.charId}:awakened`, mods: { rangeExtend: num(unit, values.rangeExtend, 1) }, persist: true });
          battle._refreshRange(unit);
        }
        return unit.mem.assaultChyueAwakened;
      }
      if (unit.def.charId === 'char_4082_qiubai') {
        unit.mem.assaultQiuBaiUntil = battle.time + num(unit, values.duration, 30);
        unit.mem.assaultQiuBaiStacks = 0;
        return true;
      }
      if (unit.def.charId === 'char_4048_doroth') {
        const used = unit.mem.assaultDorothyTriggerStacks ?? 0;
        const max = Math.floor(num(unit, values.maxStacks, 10));
        if (used >= max) return false;
        unit.mem.assaultDorothyTriggerStacks = used + 1;
        return persistGrowth(battle, unit, unit, { stat: 'atk', percent: num(unit, values.atkPerTrigger, 0.02), counterKey: `${unit.def.charId}:resonance-trigger` });
      }
      const flat = num(unit, values.atkPerDeployPoint ?? values.atkPerGold ?? values.atkPerTrigger ?? values.atkPerAmmo ?? values.atkPerStack, 0);
      return persistGrowth(battle, unit, unit, { stat: 'atk', flat, counterKey: `${unit.def.charId}:${effect.trigger}` });
    }
    case 'targeting': {
      if (unit.def.charId === 'char_237_gravel') {
        unit.mem.assaultGravelRedirect = { until: battle.time + num(unit, values.tauntDuration), radius: num(unit, values.radius) };
        return true;
      }
      if (unit.def.charId !== 'char_1041_angel2') return buff(battle, unit, unit, { key: `${unit.def.charId}:taunt`, mods: { taunt: 1 }, duration: num(unit, values.tauntDuration, 2) });
      unit.mem.assaultAngelDropTile = null;
      const candidates = battle.allyUnits.filter((ally) => ally.kind === 'op' && ally !== unit && ally.ownerId === unit.ownerId && !ally.alive && !ally.removed)
        .sort((a, b) => (b.respawnAt ?? Infinity) - (a.respawnAt ?? Infinity) || battle.allyUnits.indexOf(a) - battle.allyUnits.indexOf(b));
      const target = candidates[0];
      if (!target) { unit.mem.assaultAngelTarget = null; return false; }
      const tile = battle.restTile(target);
      if (!Array.isArray(tile) || !battle.grid.inRect(tile[0], tile[1])) { unit.mem.assaultAngelTarget = null; return false; }
      unit.mem.assaultAngelTarget = target;
      unit.mem.assaultAngelDropTile = tile;
      return true;
    }
    case 'move': {
      if (unit.def.charId === 'char_474_glady' && values.pullToSelf != null) {
        const cyclone = unit.def.raw.assaultBody.fixedSkill.effects.find((entry) => entry.action === 'damage' && entry.values?.interval != null);
        const state = unit.mem.assaultGladiaCyclone;
        const duration = state?.duration ?? (cyclone ? num(unit, cyclone.values.duration, 0) : 0);
        const activation = unit.skill.activations;
        const center = unit.mem.assaultGladiaCycloneCenter;
        if (duration > 0 && center) battle.after(duration, (b) => {
          queue(b, `assault:${unit.def.charId}:cyclone-end:${uid(unit)}:${activation}`, unit, (rt, task) => {
            if (!active(unit) || unit.mem.assaultGladiaCyclone !== state) return;
            state.pulse(b);
            state.cancel();
            const radius = num(unit, values.radius);
            const targets = b.foesInRadius(center.x, center.y, radius).filter(target => active(target) && canTargetEnemy(unit, target))
              .slice(0, Math.max(1, Math.floor(num(unit, values.maxTarget, 99))));
            const force = num(unit, values.force, 1);
            for (const target of targets) if (target.alive) {
              const moved = b.pullToFront(target, unit, force);
              if (moved > 1e-6) awardGladiaDragSp(b, unit, target, task.cause);
            }
            b.fx('pull', { x: center.x, y: center.y, id: unit.id });
            unit.mem.assaultGladiaCyclone = null;
          }, cause);
        }, { owner: unit });
        return true;
      }
      if (unit.def.charId === 'char_4037_demetr' && values.maxDistance != null && values.reTargetOnEliteKill != null)
        return startDemetrHunt({ battle, unit, effect });
      const targets = targetsFor(battle, unit, effect);
      if (unit.def.charId === 'char_173_slchan') unit.mem.assaultSlchanPullTargets = [...targets];
      const force = num(unit, values.force ?? values.pushForce ?? values.pullToCenterForce ?? values.endForce, 0);
      if (unit.def.charId === 'char_4036_forcer') unit.mem.assaultForcerPushResults = new Map();
      for (const target of targets) {
        if (values.pullToSelf || values.pullToCenterForce != null) {
          const pullResult = unit.def.charId === 'char_173_slchan' && typeof battle.assaultPullEnemy === 'function'
            ? battle.assaultPullEnemy(target, unit, force) : null;
          const moved = pullResult ? pullResult.moved : battle.pullToFront(target, unit, force);
          if (pullResult?.collision?.kind === 'enemy') (unit.mem.assaultSlchanPullContacts ??= new Set()).add(uid(target));
          if (unit.def.charId === 'char_474_glady' && moved > 1e-6) awardGladiaDragSp(battle, unit, target, cause);
        }
        else if (values.pushDir === 'RIGHT' || values.pushForce != null || values.force != null) {
          if (unit.def.charId === 'char_4036_forcer') {
            if (typeof battle.assaultPushEnemy !== 'function') throw new TypeError('Forcer requires Assault push-collision support');
            const pushed = battle.assaultPushEnemy(target, unit, force, { from: unit });
            (unit.mem.assaultForcerPushResults ??= new Map()).set(uid(target), pushed);
          } else battle.push(target, force, { from: unit });
        }
      }
      return;
    }
    case 'summon': {
      if (unit.def.charId === 'char_4010_etlchi') return summonEtlchiCandles({ battle, unit, effect, cause });
      const tokenId = ({
        'char_4016_kazema': 'token_10022_kazema_shadow', 'char_1019_siege2': 'token_10040_siege2_vlion',
        'char_1014_nearl2': 'token_10019_nearl2_sword',
      })[unit.def.charId];
      if (!tokenId) throw new TypeError(`missing explicit summon token mapping for ${unit.def.charId}`);
      const count = num(unit, values.summonCount ?? values.maxTarget, 1);
      const body = unit.def.raw.assaultBody;
      const compiled = battle.data?.getToken?.(tokenId, unit.def.charId) ?? battle.data?.rawToken?.(tokenId);
      if (!compiled) throw new Error(`native token ${tokenId} is unavailable`);
      const inheritOwner = unit.def.charId === 'char_4016_kazema';
      return grantSummon(battle, unit, { tokenId, count, stockCap: Math.max(1, count), fieldCap: Math.max(1, count), cost: 0,
        ...(inheritOwner ? { replaceExisting: true, def: { ...compiled, name: v(unit, values.summonName) } } : {}),
        duration: num(unit, values.duration, Infinity), anySource: true, kit: assaultTokenKits[tokenId], stats: {
          maxHp: (inheritOwner ? unit.s.maxHp : compiled.stats.maxHp) * num(unit, values.summonHpRatio ?? values.hpScale, 1),
          atk: (inheritOwner ? unit.s.atk : compiled.stats.atk) * num(unit, values.summonAtkScale, 1), def: compiled.stats.def, res: compiled.stats.res,
        }, sourceBody: body });
    }
    case 'spCost': {
      const cost = num(unit, values.deployPointCost, 0);
      if (cost < 1) throw new RangeError(`invalid deploy-point cost for ${unit.def.charId}`);
      const player = battle.getPlayer(unit.ownerId);
      if (!player || player.dp < cost) return false;
      battle.addDp(unit.ownerId, -cost, 'assaultSkillCost');
      return cost;
    }
    case 'ammo': {
      if (values.instantCast) return executeInstantAmmo({ battle, unit, effect, cause });
      const piece = unit.def.raw.assaultPiece;
      const moduleId = piece.moduleId ?? piece.moduleChoices?.[unit.def.charId];
      const moduleBonus = unit.def.charId === 'char_1041_angel2' && piece.star >= 3 && moduleId === 'uniequip_002_angel2' ? 10 : 0;
      const count = Math.max(1, Math.floor(num(unit, values.ammoCount, 1) + moduleBonus));
      unregisterAssaultAmmo(unit);
      const finalEffect = unit.def.charId === 'char_1032_excu2'
        ? unit.def.raw.assaultBody.fixedSkill.effects.find((entry) => entry.action === 'damage' && entry.values?.finalAtkScale != null) ?? null : null;
      unit.mem.assaultExcu2FinalEffect = finalEffect;
      const ammo = { left: count, effect, cause, attacks: 0, finalEffect, attackedTargets: new Map(), hitsPerAttack: Math.max(1, Math.floor(num(unit, values.hitsPerAttack, 1))),
        capacity: count, ammoPerAttack: Math.max(1, Math.floor(num(unit, values.ammoPerAttack, 1))) };
      if (unit.def.charId === 'char_1041_angel2') ammo.ammoPerAttack = ammo.hitsPerAttack;
      unit.mem.assaultAmmo = ammo;
      if (unit.def.charId === 'char_1032_excu2') {
        unit.mem.assaultExcu2AmmoStacks = 0;
        battle.removeBuff(unit, `${unit.def.charId}:ammo-growth`);
        const baseSelfHeal = Number(unit.mem.assaultExcu2BaseSelfHeal ?? unit.profile?.selfHeal ?? 50);
        unit.profile.selfHeal = baseSelfHeal * num(unit, values.traitHealMultiplier, 1);
      }
      registerAssaultAmmo(battle, unit, { get: () => ammo.left, set: (next) => { ammo.left = next; }, max: () => ammo.capacity });
      if (unit.def.charId === 'char_1032_excu2' && values.baseAttackTimeDelta != null) {
        const baseBat = Number(unit.base?.bat ?? unit.s?.bat);
        if (!(baseBat > 0)) throw new RangeError('Exusiai Alter requires a positive base attack interval');
        buff(battle, unit, unit, { key: `${unit.def.charId}:ammo-attack-interval`, mods: { batPct: num(unit, values.baseAttackTimeDelta) / baseBat }, duration: Infinity });
      }
      return count;
    }
    case 'nativeMechanism': {
      if (unit.def.charId === 'char_308_swire' && values.allyImmediateAttackCount != null) {
        const allies = battle.allyUnits.filter((ally) => ally !== unit && active(ally) && ally.ownerId === unit.ownerId &&
          ally.kind === 'op' && ally.profile?.attack === 'melee' && Math.abs(ally.tileR - unit.tileR) <= 1 &&
          Math.abs(ally.tileC - unit.tileC) <= 1).slice(0, Math.floor(num(unit, values.allyImmediateAttackCount, 3)));
        let attacks = 0;
        for (const ally of allies) {
          const target = enemies(battle, ally, { scope: 'range', count: 1 })[0];
          if (target && battle.forceAttack(ally, [target])) attacks++;
        }
        return attacks;
      }
      if (unit.def.charId !== 'char_1026_gvial2') throw new TypeError(`unsupported native mechanism ${unit.def.charId}`);
      const buffEffect = unit.def.raw.assaultBody.fixedSkill.effects.find((entry) => entry.action === 'addBuff');
      unit.mem.assaultDelayActiveUntil = battle.time + num(unit, buffEffect?.values?.duration, 25);
      unit.mem.assaultDelayRatio = num(unit, values.deferredRatio, 0.5);
      const piece = unit.def.raw.assaultPiece;
      const moduleId = piece.moduleId ?? piece.moduleChoices?.[unit.def.charId];
      if (piece.star >= 3 && moduleId === 'uniequip_002_gvial2' && piece.star >= 4) unit.mem.assaultDelayRatio += 0.1;
      return true;
    }
    case 'device': return executeDevice({ battle, unit, effect, cause });
    case 'redeploy': {
      if (unit.def.charId !== 'char_1041_angel2') throw new TypeError(`unsupported redeploy plan ${unit.def.charId}`);
      if (invocation?.suppressRedeploy === true) {
        unit.mem.assaultAngelTarget = null;
        unit.mem.assaultAngelDropTile = null;
        return false;
      }
      const target = unit.mem.assaultAngelTarget;
      if (!target) return false;
      const tile = unit.mem.assaultAngelDropTile;
      unit.mem.assaultAngelDeliveryPendingUid = uid(target);
      const ok = battle.redeploy(target, { free: true, tile, keepSp: true });
      if (!ok) unit.mem.assaultAngelDeliveryPendingUid = null;
      // 卡面「再部署 1 名干员并为其充能 6」：技力给被再部署的干员，不再给自己。
      if (ok) sp(battle, unit, target, num(unit, values.spGain, 6), 'angelicaDrop', `${unit.def.charId}:redeploy`, cause);
      unit.mem.assaultAngelTarget = null;
      unit.mem.assaultAngelDropTile = null;
      return ok;
    }
    default: throw new TypeError(`unimplemented assault effect ${unit.def.charId}:${effect.action}`);
  }
}

const PASSIVE_BINDINGS = {
  char_127_estell: ['death'], char_337_utage: ['death'], char_491_humus: ['attack'], char_237_gravel: ['deployed'], char_308_swire: ['deployed'],
  char_265_sophia: ['blockedAllyAttacked'], char_154_morgan: ['damageTaken'], char_155_tiger: ['dodge'], char_140_whitew: ['attack'], char_294_ayer: ['blockedAllyAttacked'],
  char_143_ghost: ['damageTaken'], char_356_broca: ['blocked'], char_4155_talr: ['dpSpent'], char_173_slchan: ['tick'], char_4036_forcer: [],
  char_451_robin: ['deviceTrigger'], char_4016_kazema: ['summonSpawned'], char_4151_tinman: ['tick'], char_4191_tippi: ['damageTaken'],
  char_1028_texas2: [], char_1033_swire2: ['goldSpent'], char_1041_angel2: ['ammoUsed','skillEnd','deployed'],
  char_437_mizuki: [], char_1023_ghost2: [], char_4048_doroth: ['deviceTrigger'], char_1039_thorn2: ['tick'], char_264_f12yin: ['attack'],
  char_2024_chyue: ['kill'], char_4037_demetr: ['attack'], char_172_svrash: ['battleStart'], char_4082_qiubai: ['attack'], char_4145_ulpia: ['damageTaken'],
  char_4058_pepe: ['kill'], char_4116_blkkgt: ['damageDealt'], char_1026_gvial2: ['blocked'], char_350_surtr: ['damageTaken'], char_1019_siege2: ['attack'],
  char_188_helage: ['tick'], char_1014_nearl2: ['deployed'], char_1032_excu2: ['ammoUsed'], char_4010_etlchi: ['attack'], char_4064_mlynar: ['damageTaken'], char_263_skadi: ['battleStart'],
  char_1001_amiya2: ['kill'], char_1037_amiya3: ['attack'],
};
const DEVICE_ONLY_CAST_BODIES = new Set(['char_451_robin','char_4151_tinman','char_1033_swire2','char_4048_doroth','char_1039_thorn2']);
const belongs = (type, payload, unit) => {
  if (type === 'death') return (payload?.unit ?? payload?.target)?.side === 'enemy';
  if (type === 'kill') return payload?.victim?.side === 'enemy' && (payload?.killer?.uid ?? payload?.killer?.id) === uid(unit);
  if (type === 'attack') return (payload?.sourceUid ?? uid(payload?.attacker ?? payload?.source)) === uid(unit);
  if (type === 'damageTaken') return payload?.targetUid === uid(unit);
  if (type === 'deployed' || type === 'summonSpawned') return payload?.sourceUid === uid(unit) || payload?.targetUid === uid(unit);
  if (type === 'blocked') return payload?.blocker === unit;
  if (type === 'dpReceived' || type === 'dpSpent') return payload?.targetUid === unit.ownerId;
  if (type === 'ammoUsed') return payload?.sourceUid === uid(unit);
  // 多萝西「当你的装置被触发时」: every device owned by the same player counts (traps, bombs, resonance devices).
  if (type === 'deviceTrigger' && unit?.def?.charId === 'char_4048_doroth') return (payload?.source?.ownerId ?? payload?.device?.ownerId) === unit.ownerId;
  if (type === 'deviceTrigger' || type === 'goldSpent') return (payload?.sourceUid ?? payload?.source?.uid ?? payload?.source?.id) === uid(unit);
  return true;
};
function beginMlynarWindow(battle, unit, values, duration) {
  const generation = (unit.mem.assaultMlynarWindowGeneration ?? 0) + 1;
  unit.mem.assaultMlynarWindowGeneration = generation;
  unit.mem.assaultMlynarWindowOpen = true;
  unit.mem.assaultMlynarSkillUntil = battle.time + duration;
  unit.mem.assaultMlynarKills = 0;
  unit.mem.assaultMlynarPendingKills = 0;
  unit.mem.assaultMlynarOwnVictims?.clear();
  unit.mem.assaultMlynarRamp = Math.max(0, Number(unit.trait.ramp) || 0);
  unit.mem.assaultMlynarMultiplier = num(unit, values.traitMultiplier, 1);
  const sourceLoss = unit.def.raw.assaultBody.fixedSkill.source.native.blackboard.find(entry => entry.key === 'per_kill_reduce')?.value;
  unit.mem.assaultMlynarLossPerKill = num(unit, values.traitBonusLossPerKill, Math.abs(Number(sourceLoss) || 0));
  unit.mem.assaultMlynarMinimumMultiplier = num(unit, values.minimumTraitMultiplier, 1);
  unit.mem.assaultMlynarNoAttackUnlessSkill ??= unit.profile.noAttackUnlessSkill;
  unit.profile.noAttackUnlessSkill = false;
  battle.removeBuff(unit, 'trait:libratorBlock');
  battle.removeBuff(unit, 'char_4064_mlynar:trait-kill-decline');
  const finish = () => {
    if (generation !== unit.mem.assaultMlynarWindowGeneration || !unit.mem.assaultMlynarWindowOpen) return;
    unit.mem.assaultMlynarWindowOpen = false;
    unit.mem.assaultMlynarSkillUntil = 0;
    unit.mem.assaultMlynarPendingKills = 0;
    unit.mem.assaultMlynarOwnVictims?.clear();
    unit.profile.noAttackUnlessSkill = unit.mem.assaultMlynarNoAttackUnlessSkill;
    unit.trait.ramp = 0;
    battle.removeBuff(unit, 'trait:libratorRamp');
    battle.removeBuff(unit, 'char_4064_mlynar:trait-kill-decline');
    unit.mem.assaultMlynarFinish = null;
    if (active(unit) && battle._hooks.skillEnd) battle.emit('skillEnd', { unit, reason: 'assault-window' });
  };
  unit.mem.assaultMlynarFinish = finish;
  return finish;
}

function settleMlynarKills(battle, unit, generation) {
  if (!active(unit) || !unit.mem.assaultMlynarWindowOpen || generation !== unit.mem.assaultMlynarWindowGeneration) return;
  unit.mem.assaultMlynarKills += unit.mem.assaultMlynarPendingKills;
  unit.mem.assaultMlynarPendingKills = 0;
  unit.mem.assaultMlynarOwnVictims?.clear();
  const ramp = unit.mem.assaultMlynarRamp;
  const initial = ramp * unit.mem.assaultMlynarMultiplier;
  const remaining = Math.max(ramp * unit.mem.assaultMlynarMinimumMultiplier, initial - unit.mem.assaultMlynarLossPerKill * unit.mem.assaultMlynarKills);
  const adjustment = remaining - initial;
  if (adjustment) battle.addBuff(unit, { key: 'char_4064_mlynar:trait-kill-decline', mods: { atkPct: adjustment },
    duration: Math.max(1e-6, unit.mem.assaultMlynarSkillUntil - battle.time), source: unit });
  else battle.removeBuff(unit, 'char_4064_mlynar:trait-kill-decline');
}

function installMlynarSkillTrueDamage({ battle, unit, body, effect }) {
  const durationEffect = body.fixedSkill.effects.find((entry) => entry.action === 'addBuff' && entry.values?.duration != null);
  unit.mem.assaultMlynarSkillUntil = battle.time + num(unit, durationEffect?.values?.duration, 28);
  if (unit.mem.assaultMlynarSkillDamageListener) return;
  unit.mem.assaultMlynarSkillDamageListener = true;
  battle.on('damaged', (payload) => {
    const target = payload?.target;
    const source = payload?.source;
    if (!active(unit) || battle.time > Number(unit.mem.assaultMlynarSkillUntil ?? -Infinity) ||
        !source || source.side !== 'ally' || !unitTag(source, 'kazimierz') || target?.side !== 'enemy' ||
        !payload.dmg?.isAttack ||
        !bodyInKeys(target, unit.rangeKeySet)) return;
    const cause = battle.assaultRuntime?.currentCause ?? null;
    const mark = { own: source === unit, atk: unit.s.atk };
    const sequence = unit.mem.assaultMlynarMarkSequence = (unit.mem.assaultMlynarMarkSequence ?? 0) + 1;
    const generation = unit.mem.assaultMlynarWindowGeneration;
    queue(battle, `assault:char_4064_mlynar:skill-true:${uid(unit)}:${uid(target)}:${sequence}`, unit,
      (rt, task) => {
        if (!active(unit) || !target.alive || !unit.mem.assaultMlynarWindowOpen || battle.time >= unit.mem.assaultMlynarSkillUntil || generation !== unit.mem.assaultMlynarWindowGeneration) return;
        execute({ battle, unit, effect, targets: [target], cause: task.cause, invocation: { mlynarMark: mark } });
      }, cause);
  }, { owner: unit });
}

function installPassives(battle, unit, body) {
  installAssaultBazaar(battle, unit, body);
  if (body.charId === 'char_4064_mlynar') {
    battle.on('death', ({ unit: removed }) => { if (removed === unit) unit.mem.assaultMlynarFinish?.(); }, { owner: unit });
    const ownVictims = unit.mem.assaultMlynarOwnVictims = new Set();
    battle.on('damaged', ({ source, target, dmg }) => {
      if (source !== unit || target?.side !== 'enemy') return;
      if (unit.mem.assaultMlynarWindowOpen && (dmg?.isAttack && !dmg.isSkill || dmg?.tags?.includes('assaultMlynarOwn'))) ownVictims.add(target);
      else ownVictims.delete(target);
    }, { owner: unit, priority: 1000 });
    battle.on('kill', ({ killer, victim }) => {
      if (killer === unit && unit.mem.assaultMlynarWindowOpen && ownVictims.has(victim) && victim.side === 'enemy') unit.mem.assaultMlynarPendingKills += 1;
    }, { owner: unit });
    battle.on('attack', ({ attacker }) => {
      if (attacker !== unit || !unit.mem.assaultMlynarWindowOpen) return;
      ownVictims.clear();
      const generation = unit.mem.assaultMlynarWindowGeneration;
      const sequence = unit.mem.assaultMlynarAttackSequence = (unit.mem.assaultMlynarAttackSequence ?? 0) + 1;
      queue(battle, `assault:char_4064_mlynar:kill-settle:${uid(unit)}:${sequence}`, unit,
        () => settleMlynarKills(battle, unit, generation), battle.assaultRuntime.currentCause);
    }, { owner: unit });
    const reduction = body.fixedSkill.effects.find(effect => effect.action === 'addBuff' && effect.values?.damageReduction != null);
    if (reduction) battle.on('hit', ({ source, target, dmg }) => {
        if (target !== unit || !active(unit) || source?.side !== 'enemy' ||
            !unit.findBuff('char_4064_mlynar:addBuff:未照耀的荣光结算后') ||
            !bodyInKeys(source, unit.rangeKeySet)) return;
        dmg.mul *= 1 - num(unit, reduction.values.damageReduction, 0);
      }, { owner: unit });
  }
  if (body.charId === 'char_237_gravel') battle.on('enemyAttackStart', ({ enemy, targets }) => {
    const eligible = new Set(targets.filter(candidate => candidate.def?.charId === 'char_237_gravel' && active(candidate) &&
      battle.time < Number(candidate.mem.assaultGravelRedirect?.until ?? -Infinity) &&
      Math.max(Math.abs(enemy.y - candidate.tileR), Math.abs(enemy.x - candidate.tileC)) <= candidate.mem.assaultGravelRedirect.radius));
    if (!eligible.size) return;
    const blocker = enemy.profile?.blockFree ? null : enemy.blockedBy;
    const previous = new Map(targets.map((candidate, index) => [candidate, index]));
    targets.sort((a, b) => Number(b === blocker) - Number(a === blocker) ||
      Number(eligible.has(b)) - Number(eligible.has(a)) ||
      (eligible.has(a) && eligible.has(b) ? aggroCmp(a, b) : previous.get(a) - previous.get(b)));
  }, { owner: unit });
  if (body.charId === 'char_140_whitew') {
    const nativeDamageMul = unit.profile.dmgMul;
    unit.profile.dmgMul = (b, source, target) => source.findBuff('char_140_whitew:addBuff:狼魂结算后')
      ? 1 : typeof nativeDamageMul === 'function' ? nativeDamageMul(b, source, target) : nativeDamageMul ?? 1;
    battle.on('damaged', ({ source, target, dmg }) => {
    if (source !== unit || !active(unit) || !target?.alive || target.side !== 'enemy' || !dmg?.isAttack || dmg.isSkill) return;
    const passive = body.modePassives[0];
    applyStatus(battle, unit, target, { status: 'silence', duration: num(unit, passive.values.silenceDuration),
      key: 'char_140_whitew:silence', cause: battle.assaultRuntime.currentCause });
    }, { owner: unit });
  }
  if (body.charId === 'char_337_utage') {
    const talent = body.talentBindings.find(binding => binding.nativeTalentIndex === 0)?.translation?.parameters;
    if (!talent) throw new TypeError('Utage requires its serious-mode talent parameters');
    battle.on('tick', () => {
      if (!active(unit) || 1 - unit.hp / unit.s.maxHp + 1e-9 < num(unit, talent.lostHpThreshold) ||
          battle.time + 1e-9 < Number(unit.mem.assaultUtageSeriousNextAt ?? -Infinity)) return;
      unit.mem.assaultUtageSeriousNextAt = battle.time + num(unit, talent.cooldown);
      buff(battle, unit, unit, { key: 'char_337_utage:serious-mode', mods: { aspd: num(unit, talent.attackSpeedBonus) },
        duration: num(unit, talent.duration) });
    }, { owner: unit });
  }
  if (body.charId === 'char_4037_demetr') {
    const shredEffect = body.fixedSkill.effects.find((effect) => effect.values?.defShredPerHit != null);
    const talent = body.talentBindings.find((binding) => binding.nativeTalentIndex === 0)?.translation?.parameters ?? {};
    battle.assaultRuntime.observe('hit', `demetr-attack:${uid(unit)}`, ({ payload, cause }) => {
      if (payload?.sourceUid !== uid(unit) || payload.target?.side !== 'enemy' || typeof payload.attackId !== 'number') return;
      const skillActive = battle.time <= Number(unit.mem.assaultDemetrSkillUntil ?? -Infinity);
      const values = skillActive && shredEffect ? shredEffect.values : null;
      const perHit = values ? num(unit, values.defShredPerHit, 0) : num(unit, talent.defShred, 0);
      const maxStacks = values ? num(unit, values.defShredMaxStacks, 0) : 5;
      const duration = values ? num(unit, values.defShredDuration, 10) : 10;
      if (perHit > 0 && maxStacks > 0) buff(battle, unit, payload.target, { key: `${body.charId}:def-shred:${uid(payload.target)}`,
        mods: { defPct: -perHit }, duration, stacking: 'stack', maxStacks, cause });
      if (!skillActive || !values) return;
      const attackId = payload.attackId;
      const chance = num(unit, values.prob, 0), scale = num(unit, values.extraAtkScale, 0);
      if (!(chance > 0 && scale > 0) || battle.rng() >= chance) return;
      queue(battle, `assault:${body.charId}:prob-hit:${attackId}:${uid(payload.target)}`, payload.target,
        (rt, task) => damage(battle, unit, payload.target, { scale, type: 'phys', isSkill: true,
          sourceKey: `${body.charId}:prob:${attackId}:${uid(payload.target)}`, cause: task.cause }), cause);
    }, { owner: unit });
  }
  unit.mem.assaultModuleHooks = installAssaultModule({ battle, unit, body, piece: unit.def.raw.assaultPiece, rank: unit.def.raw.assaultPiece.star });
  if (body.charId === 'char_188_helage') {
    const talent = body.talentBindings.find((binding) => binding.nativeTalentIndex === 0)?.translation?.parameters ?? {};
    const moduleId = unit.def.raw.assaultPiece.moduleId ?? unit.def.raw.assaultPiece.moduleChoices?.[body.charId];
    battle.on('tick', () => {
      if (!active(unit)) { battle.removeBuff(unit, `${body.charId}:fortitude-talent`); return; }
      const rank = unit.def.raw.assaultPiece.star;
      const lossThreshold = Number(talent.lossThreshold?.[rank - 1] ?? 0.5) -
        (moduleId === 'uniequip_003_helage' && rank >= 4 ? Number(unit.mem.assaultHelageMaxLossReduction ?? 0) : 0);
      const lostRatio = 1 - unit.hp / unit.s.maxHp;
      const maxAttackSpeed = Number(talent.maxAttackSpeed?.[rank - 1] ?? 0);
      const attackSpeed = maxAttackSpeed * Math.max(0, Math.min(1, lostRatio / Math.max(0.01, lossThreshold)));
      buff(battle, unit, unit, { key: `${body.charId}:fortitude-talent`, mods: { aspd: attackSpeed }, persist: true });
    }, { owner: unit });
  }
  if (body.charId === 'char_2024_chyue' && false) { // 大巴扎：卡面没有「止戈」标记，删去普攻标记与对标记目标增伤
    const piece = unit.def.raw.assaultPiece;
    const binding = body.talentBindings.find((entry) => entry.nativeTalentIndex === 0)?.translation?.parameters ?? {};
    const multiplierEffect = body.fixedSkill.effects.find((entry) => entry.values?.talentAtkScale != null);
    if (!multiplierEffect) throw new TypeError('Chyue requires its compiled marked-target multiplier');
    const markerKey = `assault:${body.charId}:zhige:${uid(unit)}`;
    const markedMultiplier = () => num(unit, multiplierEffect.values.talentAtkScale, 1) +
      ((piece?.moduleId ?? piece?.moduleChoices?.[body.charId]) === 'uniequip_002_chyue' && piece.star >= 4 && !BAZAAR_MODULES.has('uniequip_002_chyue') ? 0.15 : 0);
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !active(unit) || target?.side !== 'enemy' || !dmg || !(dmg.amount > 0)) return;
      const marker = target.buffs?.find((entry) => entry.key === markerKey && entry.source === unit && entry.timeLeft > 0);
      if (marker) dmg.mul *= markedMultiplier();
    }, { owner: unit, priority: 100 });
    battle.on('damaged', ({ source, target, dmg }) => {
      if (source !== unit || !active(unit) || target?.side !== 'enemy' || !dmg?.isAttack || dmg.isSkill) return;
      const moduleId = piece.moduleId ?? piece.moduleChoices?.[body.charId];
      const procChance = num(unit, binding.prob, 0) + (moduleId === 'uniequip_003_chyue' && piece.star >= 3 && !BAZAAR_MODULES.has('uniequip_003_chyue') ? 0.03 : 0);
      if (!target.alive || !(target.hp > 0) || battle.rng() >= procChance) return;
      battle.addBuff(target, { key: markerKey, source: unit, tags: ["talent"], mods: {}, duration: num(unit, binding.duration, 2.5),
        refresh: "replace" });
    }, { owner: unit });
  }
  if (body.charId === 'char_2024_chyue' || body.charId === 'char_4058_pepe') {
    battle.on('kill', ({ killer, victim }) => {
      const cast = unit.mem.assaultModeSkillCast;
      if (killer === unit && victim?.side === 'enemy' && cast) cast.kills++;
    }, { owner: unit });
  }
  if (body.charId === 'char_4058_pepe') {
    const growth = body.fixedSkill.effects.find((effect) => effect.action === 'growth' && effect.values?.rangeExtendPerStack != null);
    if (growth) {
    const buffKey = `${body.charId}:per-hit-growth`;
    const clear = () => {
      unit.mem.assaultPepeGrowthStacks = 0;
      unit.mem.assaultPepeStackedAttacks?.clear?.();
      if (unit.findBuff(buffKey)) battle.removeBuff(unit, buffKey);
      battle._refreshRange(unit);
    };
    battle.assaultRuntime.observe('hit', `pepe-growth:${uid(unit)}`, ({ payload, cause }) => {
      if (payload?.sourceUid !== uid(unit) || payload.target?.side !== 'enemy' || payload.attackId == null || payload.skillId != null || !(payload.amount > 0)) return;
      unit.mem.assaultPepeStackedAttacks ??= new Set();
      const attackId = payload.attackId;
      if (attackId != null && unit.mem.assaultPepeStackedAttacks.has(attackId)) return;
      if (attackId != null) unit.mem.assaultPepeStackedAttacks.add(attackId);
      queue(battle, `assault:${body.charId}:growth:${attackId ?? (unit.mem.assaultPepeGrowthSeq = (unit.mem.assaultPepeGrowthSeq ?? 0) + 1)}`, unit, () => {
        const stacks = Number(unit.mem.assaultPepeGrowthStacks ?? 0);
        const cap = Math.max(0, Math.floor(num(unit, growth.values.maxStacks, 0)));
        if (stacks >= cap || !active(unit)) return;
        unit.mem.assaultPepeGrowthStacks = stacks + 1;
        buff(battle, unit, unit, { key: buffKey, mods: {
          atkPct: num(unit, growth.values.atkPerStack, 0),
          rangeExtend: num(unit, growth.values.rangeExtendPerStack, 0),
        }, maxStacks: cap, stacking: 'stack', persist: true, cause });
        battle._refreshRange(unit);
      }, cause);
    }, { owner: unit });
    battle.on('death', ({ unit: dead }) => { if (dead === unit) clear(); }, { owner: unit });
    battle.on('retreating', ({ unit: leaving }) => { if (leaving === unit) clear(); }, { owner: unit });
    }
  }
  // 耀骑士临光的部署爆发由大巴扎行「当你的卡西米尔干员部署时」取代（assault-bazaar.js）。
  if (body.charId === 'char_1014_nearl2' && !BAZAAR_REPLACED_PASSIVES.has('char_1014_nearl2:0')) {
    const lastOps = new Map();
    for (const ally of battle.allyUnits.filter((candidate) => candidate.kind === 'op' && candidate.side === 'ally' && active(candidate))
      .sort((a, b) => (a.deploySeq ?? 0) - (b.deploySeq ?? 0))) lastOps.set(ally.ownerId, ally);
    const passive = body.modePassives[0];
    const talent = body.talentBindings.find((binding) => binding.nativeTalentIndex === 0)?.translation?.parameters ?? {};
    const burst = (cause) => {
      const radius = num(unit, passive.values.radius, 1), scale = num(unit, passive.values.atkScale, 0), stun = num(unit, talent.stun, 0);
      const kazimierzBonus = unit.mem.assaultNearl2PreviousDeployWasKazimierz;
      const hits = 1 + (kazimierzBonus ? Math.floor(num(unit, passive.values.kazimierzExtra, 0)) : 0);
      const piece = unit.def.raw.assaultPiece, moduleId = piece.moduleId ?? piece.moduleChoices?.[body.charId];
      const bonusHitScale = kazimierzBonus && moduleId === 'uniequip_003_nearl2' ? (piece.star >= 4 ? 2 : 1.1) : 1;
      unit.mem.assaultNearl2TriggeredDeploySeq = unit.deploySeq;
      unit.mem.assaultNearl2PreviousDeployWasKazimierz = false;
      const victims = battle.enemies.filter((enemy) => enemy.alive && !enemy.hidden &&
        Math.abs(enemy.y - unit.tileR) + Math.abs(enemy.x - unit.tileC) <= radius);
      const deployment = unit.deploySeq;
      queue(battle, `assault:${body.charId}:landing-burst:${deployment}`, unit, (rt, task) => {
        for (const target of victims) {
          if (!target.alive) continue;
          for (let hit = 0; hit < hits; hit++) damage(battle, unit, target, { scale: scale * (hit === 0 ? 1 : bonusHitScale), type: 'true', isSkill: true,
            sourceKey: `${body.charId}:landing:${deployment}:${hit}`, cause: task.cause });
          if (target.alive) applyStatus(battle, unit, target, { status: 'stun', duration: stun,
            key: `${body.charId}:landing-stun:${deployment}`, cause: task.cause });
        }
      }, cause);
    };
    battle.on('deploy', ({ unit: deployed }) => {
      if (deployed?.kind !== 'op' || deployed.side !== 'ally') return;
      if (deployed === unit) {
        const previous = battle.allyUnits.filter((candidate) => candidate !== unit && candidate.kind === 'op' && candidate.side === 'ally' &&
          candidate.ownerId === unit.ownerId && active(candidate) && (candidate.deploySeq ?? 0) < (unit.deploySeq ?? 0))
          .sort((a, b) => (a.deploySeq ?? 0) - (b.deploySeq ?? 0)).at(-1);
        unit.mem.assaultNearl2PreviousDeployWasKazimierz = !!previous && unitTag(previous, 'kazimierz');
        burst(battle.assaultRuntime.currentCause);
      }
      lastOps.set(deployed.ownerId, deployed);
    }, { owner: unit, priority: -200 });
    battle.on('battleStart', () => {
      if (!active(unit) || unit.mem.assaultNearl2TriggeredDeploySeq === unit.deploySeq) return;
      const previous = battle.allyUnits.filter((candidate) => candidate !== unit && candidate.kind === 'op' && candidate.side === 'ally' &&
        candidate.ownerId === unit.ownerId && active(candidate) && (candidate.deploySeq ?? 0) < (unit.deploySeq ?? 0))
        .sort((a, b) => (a.deploySeq ?? 0) - (b.deploySeq ?? 0)).at(-1);
      unit.mem.assaultNearl2PreviousDeployWasKazimierz = !!previous && unitTag(previous, 'kazimierz');
      burst(battle.assaultRuntime.currentCause);
    }, { owner: unit, priority: -200 });
  }
  if (body.charId === 'char_1032_excu2') {
    const passive = body.modePassives[0];
    const ammoGrowth = body.fixedSkill.effects.find((effect) => effect.action === 'growth' && effect.values?.atkPerAmmo != null);
    if (!ammoGrowth) throw new TypeError('Excu2 requires its per-ammunition growth plan');
    const talent = body.talentBindings.find((binding) => binding.nativeTalentIndex === 0)?.translation?.parameters ?? {};
    const capacityTalent = body.talentBindings.find((binding) => binding.nativeTalentIndex === 1)?.translation?.parameters ?? {};
    const syncLateranoCapacity = () => {
      const amount = Math.min(Math.floor(num(unit, capacityTalent.maxStacks, 4)), battle.allyUnits.filter((ally) => ally.kind === 'op' && active(ally) && unitTag(ally, 'laterano')).length *
        Math.floor(num(unit, capacityTalent.perLaterano, 1)));
      setAssaultAmmoCapacityBonus(unit, `${body.charId}:laterano-talent`, amount);
    };
    syncLateranoCapacity();
    battle.on('battleStart', syncLateranoCapacity, { owner: unit });
    battle.on('deploy', syncLateranoCapacity, { owner: unit });
    battle.on('retreating', syncLateranoCapacity, { owner: unit });
    battle.on('death', syncLateranoCapacity, { owner: unit });
    unit.mem.assaultExcu2BaseSelfHeal = Number(unit.profile?.selfHeal ?? 50);
    battle.on('skillEnd', ({ unit: ended }) => {
      if (ended !== unit) return;
      unit.profile.selfHeal = unit.mem.assaultExcu2BaseSelfHeal;
    }, { owner: unit, priority: -1000 });
    unit.mem.assaultExcu2AmmoStacks = 0;
    battle.on('ammoUsed', (event) => {
      if (event.source !== unit || !unit.mem.assaultAmmo || !(event.quantity > 0)) return;
      const piece = unit.def.raw.assaultPiece;
      const moduleId = piece.moduleId ?? piece.moduleChoices?.[body.charId];
      const cap = Math.floor(num(unit, passive.values.maxStacks, 30) + (piece.star >= 3 && moduleId === 'uniequip_003_excu2' && !BAZAAR_MODULES.has('uniequip_003_excu2') ? 5 : 0));
      unit.mem.assaultExcu2AmmoStacks = Math.min(cap,
        unit.mem.assaultExcu2AmmoStacks + Math.floor(event.quantity));
      // 大巴扎：圣约送葬人删去逐发增攻（层数只用于原追加攻击概率）。
    }, { owner: unit });
    battle.on('skillEnd', ({ unit: ended }) => {
      if (ended !== unit) return;
      unit.mem.assaultExcu2AmmoStacks = 0;
      battle.removeBuff(unit, `${body.charId}:ammo-growth`);
    }, { owner: unit });
    battle.on('attack', ({ attacker, targets }) => {
      if (attacker !== unit || unit.mem.assaultExcu2ExtraAttack || !unit.mem.assaultAmmo || !active(unit) || !targets?.length) return;
      const attackSeq = battle._attackSeq;
      if (unit.mem.assaultExcu2CheckedAttackSeq === attackSeq) return;
      unit.mem.assaultExcu2CheckedAttackSeq = attackSeq;
      const base = num(unit, talent.baseProb, 0), increment = num(unit, passive.values.extraAttackProb, 0);
      const chance = Math.min(1, base + unit.mem.assaultExcu2AmmoStacks * increment);
      unit.mem.assaultExcu2Chance = chance;
      if (battle.rng() >= chance) return;
      const cause = battle.assaultRuntime.currentCause;
      queue(battle, `assault:${body.charId}:extra-attack:${attackSeq}`, unit, () => {
        if (!active(unit) || !targets.some((target) => target?.alive)) return;
        unit.mem.assaultExcu2ExtraAttack = true;
        try { battle.forceAttack(unit, targets.filter((target) => target?.alive), { noAmmo: true }); }
        finally { unit.mem.assaultExcu2ExtraAttack = false; }
      }, cause);
    }, { owner: unit });
  }
  if (body.charId === 'char_1028_texas2') {
    const passive = body.modePassives[0];
    const firstKill = passive.values ?? {};
    const rainPlan = passive.components.find((part) => part.action === 'nativeMechanism');
    const nativeTalent = body.talentBindings.find((binding) => binding.nativeTalentIndex === 1)?.translation?.parameters ?? {};
    const applyPreKillTalent = () => {
      // 大巴扎：卡面没有「首次击倒前 +攻速/减伤」，不再施加。
      if (true || !unit.alive || !unit.deployed || unit.mem.assaultTexasNativeTalentActive) return;
      unit.mem.assaultTexasNativeTalentActive = true;
      buff(battle, unit, unit, { key: `${body.charId}:pre-first-kill-talent`, mods: {
        aspd: Number(nativeTalent.attackSpeedBonus ?? 8), dmgTakenMul: 1 - Number(nativeTalent.damageReduction ?? 0.25),
      }, persist: true });
    };
    const onFirstKill = (cause) => {
      if (!unit.alive || (num(unit, firstKill.firstKillPerDeploy, 0) > 0 && !unit.mem.assaultTexasFirstKillReady)) return;
      if (num(unit, firstKill.firstKillPerDeploy, 0) > 0) unit.mem.assaultTexasFirstKillReady = false;
      if (unit.mem.assaultTexasNativeTalentActive) {
        battle.removeBuff(unit, `${body.charId}:pre-first-kill-talent`);
        unit.mem.assaultTexasNativeTalentActive = false;
      }
      if (num(unit, firstKill.firstKillHealFull, 0) > 0)
        heal(battle, unit, unit, { amount: Math.max(0, unit.s.maxHp - unit.hp), sourceKey: `${body.charId}:first-kill-full-heal`, cause });
      // 大巴扎：首次击倒只回满生命，删去补剑雨。
    };
    unit.mem.assaultTexasFirstKillReady = true;
    battle.on('kill', ({ killer, victim }) => {
      if (killer === unit && victim?.side === 'enemy') queue(battle, `${body.charId}:first-kill`, unit, (rt, task) => onFirstKill(task.cause), battle.assaultRuntime.currentCause);
    }, { owner: unit });
    battle.on('death', ({ unit: dead }) => { if (dead === unit) unit.mem.assaultTexasDead = true; }, { owner: unit });
    battle.on('deploy', ({ unit: deployed }) => {
      if (deployed === unit) applyPreKillTalent();
      const resetOnEntry = num(unit, firstKill.resetOnRealEntry, 0) > 0;
      const preserveAlive = num(unit, firstKill.noResetOnSurvivingRedeploy, 0) > 0;
      if (deployed === unit && ((unit.mem.assaultTexasDead && resetOnEntry) || (!unit.mem.assaultTexasDead && !preserveAlive))) {
        unit.mem.assaultTexasDead = false;
        unit.mem.assaultTexasFirstKillReady = true;
        applyPreKillTalent();
      }
    }, { owner: unit });
    battle.on('battleStart', applyPreKillTalent, { owner: unit });
    applyPreKillTalent();
  }
  if (body.charId === 'char_154_morgan') {
    const strike = body.fixedSkill.effects.find(effect => effect.values?.extraAtkScale != null);
    // The compiled skill has no shielded extra strike (card face: 失去生命、护盾、一次伤害); without it the
    // listener used to throw on the first shielded normal attack in a real run.
    if (strike) battle.on('damaged', ({ source, target, amount, dmg }) => {
      if (source !== unit || !active(unit) || !target?.alive || target.side !== 'enemy' || !(amount > 0) || !dmg?.isAttack || dmg.isSkill || !(unit.findBuff('char_154_morgan:barrier')?.shield > 0)) return;
      queue(battle, 'char_154_morgan:shield-attack:' + uid(target), target, (rt, task) =>
        damage(battle, unit, target, { scale: num(unit, strike.values.extraAtkScale), type: physicalFor(unit, strike.values), isSkill: true, sourceKey: 'char_154_morgan:shield-extra', cause: task.cause }), battle.assaultRuntime.currentCause);
    }, { owner: unit });
    const passive = body.modePassives[0];
    const key = `${body.charId}:low-hp-passive`;
    const sync = (hp = unit.hp) => {
      const enabled = unit.alive && unit.deployed && hp / unit.s.maxHp < 0.4;
      if (enabled && !unit.findBuff(key)) buff(battle, unit, unit, { key, mods: { atkPct: num(unit, passive.values.atkBonus) }, persist: true });
      else if (!enabled && unit.findBuff(key)) battle.removeBuff(unit, key);
    };
    sync();
    battle.on('hpDamage', (ctx) => { if (ctx.target === unit) sync(unit.hp - ctx.amount); }, { owner: unit, priority: 100 });
    battle.on('heal', (ctx) => { if (ctx.target === unit) sync(unit.hp + ctx.amount); }, { owner: unit, priority: 100 });
    battle.on('hit', ({ source, dmg }) => {
      if (source !== unit || !active(unit) || unit.hp / unit.s.maxHp >= 0.4) return;
      dmg.defIgnorePct = Math.max(dmg.defIgnorePct ?? 0, num(unit, passive.values.ignoreDefRatio));
    }, { owner: unit, priority: 100 });
  }
  if (body.charId === 'char_356_broca') {
    const passive = body.modePassives[0], key = `${body.charId}:two-block-passive`;
    const sync = () => {
      if (active(unit) && unit.blocking.length >= 2) buff(battle, unit, unit, { key, mods: { atkPct: num(unit, passive.values.atkDefRatio), defPct: num(unit, passive.values.atkDefRatio) }, persist: true });
      else if (unit.findBuff(key)) battle.removeBuff(unit, key);
    };
    battle.on('tick', sync, { owner: unit });
    sync();
  }
  if (body.charId === 'char_308_swire') {
    const passive = body.modePassives[0], key = `${body.charId}:nearby-melee-aura`;
    const sync = () => {
      const recipients = new Set(active(unit) ? battle.allyUnits.filter((ally) => ally !== unit && ally.kind === 'op' && active(ally) &&
        ally.ownerId === unit.ownerId && ally.profile?.attack === 'melee' &&
        Math.abs(ally.tileR - unit.tileR) <= 1 && Math.abs(ally.tileC - unit.tileC) <= 1) : []);
      for (const ally of battle.allyUnits.filter((candidate) => candidate.kind === 'op' && candidate !== unit)) {
        if (recipients.has(ally)) buff(battle, unit, ally, { key, mods: { atkPct: num(unit, passive.values.atkBonus) }, persist: true });
        else if (ally.findBuff(key)) battle.removeBuff(ally, key);
      }
    };
    battle.on('tick', sync, { owner: unit });
    battle.on('deploy', sync, { owner: unit });
    battle.on('retreating', sync, { owner: unit });
    sync();
  }
  if (body.charId === 'char_437_mizuki') battle.on('attack', ({ attacker, targets }) => {
    if (attacker === unit && active(unit) && Array.isArray(targets) && targets.length >= 2) triggerMizukiMultiHit(battle, unit, targets, battle.assaultRuntime.currentCause);
  }, { owner: unit });
  if (body.charId === 'char_437_mizuki') {
    const talent = body.talentBindings.find((binding) => binding.nativeTalentIndex === 1)?.translation?.parameters ?? {};
    const piece = unit.def.raw.assaultPiece;
    const moduleId = piece.moduleId ?? piece.moduleChoices?.[body.charId];
    const threshold = num(unit, talent.hpThreshold, 0.5); // 大巴扎：深蓝之籽只加对生命最低者的法术伤害
    const key = `${body.charId}:low-health-talent`;
    const sync = () => {
      const qualifies = active(unit) && enemies(battle, unit, { scope: 'range' }).some((enemy) => enemy.alive && enemy.hp / enemy.s.maxHp < threshold);
      if (qualifies) buff(battle, unit, unit, { key, mods: { atkPct: num(unit, talent.atkBonus, 0.1) }, persist: true });
      else if (unit.findBuff(key)) battle.removeBuff(unit, key);
    };
    battle.on('tick', sync, { owner: unit });
    battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) sync(); }, { owner: unit });
    sync();
  }
  if (body.charId === 'char_4082_qiubai') battle.on('attack', ({ attacker, targets }) => {
    if (attacker !== unit || !active(unit) || !Array.isArray(targets)) return;
    for (const target of targets) triggerQiuBaiRoot(battle, unit, target, battle.assaultRuntime.currentCause);
  }, { owner: unit });
  if (body.charId === 'char_4116_blkkgt') battle.on('damaged', ({ source, target, amount }) => {
    if (source === unit && amount > 0 && active(unit)) triggerBlitzTremble(battle, unit, target, battle.assaultRuntime.currentCause);
  }, { owner: unit });
  if (body.charId === 'char_4036_forcer') watch(battle, unit, 'pushCollision', `assault:${body.charId}:extra-collision-stun`, ({ payload, cause }) =>
    payload.sourceUid === uid(unit) && payload.target?.side === 'enemy' && ['highland','enemy'].includes(payload.kind) && payload.moved > 0,
    ({ payload, cause }) => {
      const key = uid(payload.target), prior = unit.mem.assaultForcerCollisionAt ??= new Map();
      if (battle.time - (prior.get(key) ?? -Infinity) < 1) return;
      const stun = payload.target.findBuff(`${body.charId}:stun`);
      const extra = num(unit, body.modePassives[0].values.extraStun, 0);
      const applied = applyStatus(battle, unit, payload.target, { status: 'stun', duration: (stun?.timeLeft ?? 0) + extra,
        key: `${body.charId}:stun`, cause });
      if (applied) prior.set(key, battle.time);
      return applied;
    });
  if (body.charId === 'char_264_f12yin') {
    const bodyTalent = body.talentBindings.find((binding) => binding.nativeTalentIndex === 1)?.translation?.parameters ?? {};
    const native = body.talentBindings.find((binding) => binding.nativeTalentIndex === 0)?.translation?.parameters ?? {};
    const strongBodyKey = `${body.charId}:strong-body`;
    const installStrongBody = () => {
      if (!active(unit) || unit.findBuff(strongBodyKey)) return;
      buff(battle, unit, unit, { key: strongBodyKey, mods: {
        defPct: num(unit, bodyTalent.defRatio, 0), dodgePhys: num(unit, bodyTalent.physDodge, 0),
      }, persist: true });
    };
    battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) installStrongBody(); }, { owner: unit });
    installStrongBody();
    battle.on('beforeAttack', (ctx) => {
      if (ctx.attacker !== unit || !ctx.targets?.length) return;
      const probability = Math.max(0, Math.min(1, num(unit, native.prob, 0) + (unit.mem.assaultF12yinPunchBonus ?? 0)));
      const attackId = battle._attackSeq + 1;
      unit.mem.assaultF12yinPunchAttackId = probability > 0 && battle.rng() < probability ? attackId : null;
    }, { owner: unit });
    battle.on('hit', ({ source, dmg }) => {
      if (source !== unit || !dmg?.isAttack || dmg.attackId !== unit.mem.assaultF12yinPunchAttackId) return;
      dmg.amount *= num(unit, native.atkScale, 1);
    }, { owner: unit, priority: 100 });
    // 大巴扎：减攻改由「当相邻干员受到攻击时」触发（assault-bazaar.js），巨力重拳不再附带减攻。
    if (!BAZAAR_REPLACED_PASSIVES.has('char_264_f12yin:punch-weaken')) battle.on('damaged', ({ source, target, amount, dmg }) => {
      if (source !== unit || !target || target.side !== 'enemy' || !(amount > 0) || !dmg?.isAttack || dmg.attackId !== unit.mem.assaultF12yinPunchAttackId) return;
      const piece = unit.def.raw.assaultPiece;
      const f12yinModule = (piece?.moduleId ?? piece?.moduleChoices?.[body.charId]) === 'uniequip_002_f12yin';
      const f12yinRank = Number(unit.def.raw.assaultPiece?.star ?? 0);
      const debuffDuration = 3 + (f12yinModule && f12yinRank >= 4 ? 2 : 0);
      battle.addBuff(target, { key: `${body.charId}:punch-weaken:${uid(target)}`, duration: debuffDuration,
        mods: { atkPct: -num(unit, native.targetAtkDown, 0.15) }, source: unit, visible: true });
    }, { owner: unit });
    battle.on('attack', ({ attacker }) => { if (attacker === unit) unit.mem.assaultF12yinPunchAttackId = null; }, { owner: unit });
    return;
  }
  if (body.charId === 'char_1019_siege2') {
    battle.on('hit', ({ source, dmg }) => {
      if (source === unit && dmg?.isAttack && battle.time < Number(unit.mem.assaultSiegeSkillUntil ?? 0)) dmg.type = 'true';
    }, { owner: unit, priority: 100 });
    battle.on('damaged', ({ source, target, amount }) => {
      if (source === unit && amount > 0 && active(unit)) triggerSiegeFirstHit(battle, unit, target, battle.assaultRuntime.currentCause);
    }, { owner: unit });
  }
  if (body.charId === 'char_1014_nearl2') battle.on('hit', ({ source, target, dmg }) => {
    if (source !== unit || !active(unit) || battle.time >= Number(unit.mem.assaultNearl2BlockedTrueUntil ?? -Infinity) ||
        !dmg?.isAttack || !target || (target.blockedBy !== unit && target.blockedBy?.ownerUnit !== unit)) return;
    dmg.type = 'true';
  }, { owner: unit, priority: 100 });
  if (body.charId === 'char_1032_excu2') battle.on('skillEnd', ({ unit: ended }) => {
    if (ended === unit) battle.removeBuff(unit, `${body.charId}:ammo-attack-interval`);
  }, { owner: unit });
  if (body.charId === 'char_1023_ghost2') {
    const leaveDecoy = (nativeDoll) => queue(battle, `assault:${body.charId}:knockdown-decoy`, unit,
      (rt, task) => summonGhostDecoy({ battle, unit, cause: task.cause, nativeDoll }), battle.assaultRuntime.currentCause);
    battle.on('dollSwap', ({ unit: swapped, form }) => {
      if (swapped !== unit) return;
      if (form === 'doll') leaveDecoy(true);
      else if (unit.mem.assaultGhostDecoy?.nativeDoll) unit.mem.assaultGhostDecoyStop?.();
    }, { owner: unit });
    battle.on('death', ({ unit: dead }) => { if (dead === unit) leaveDecoy(false); }, { owner: unit });
    battle.on('retreating', ({ unit: leaving }) => {
      if (leaving === unit && unit.mem.assaultGhostDecoy?.nativeDoll) unit.mem.assaultGhostDecoyStop?.();
    }, { owner: unit });
  }
  if (body.charId === 'char_4010_etlchi') {
    const passive = body.modePassives[0];
    const piece = unit.def.raw.assaultPiece;
    const moduleId = piece.moduleId ?? piece.moduleChoices?.[body.charId];
    // 大巴扎：易枯萎的航船（偷取 +s）与玫瑰色故事集（法术伤害 +x%）读卡面数值。
    const cap = num(unit, passive.values.stealCap, 0);
    const dot = num(unit, passive.values.dotPerSec, 0) * (1 + moduleParam(unit, 'uniequip_003_etlchi', 'x', 0) / 100);
    const dotDuration = num(unit, passive.values.dotDuration, 0);
    unit.mem.assaultEtlchiStolen = 0;
    battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) unit.mem.assaultEtlchiStolen = 0; }, { owner: unit });
    battle.on('damaged', ({ source, target, type, dmg }) => {
      if (source !== unit || !dmg?.isAttack || type === 'element' || !target?.alive || target.side !== 'enemy' || !active(unit)) return;
      const candleHost = target.mem?.candleOwner === unit ? target.mem.candleHost : null;
      if (target.mem?.candleOwner) return;
      const victim = candleHost ?? target;
      if (dot > 0 && dotDuration > 0 && !target.mem?.candleOwner) {
        battle.addBuff(victim, { key: `${body.charId}:dot:${unit.uid}`, duration: dotDuration, interval: 1, refresh: 'extend',
          onTick: ({ unit: current }) => battle.dealDamage(unit, current, { amount: dot, type: 'arts', tags: ['assaultEtlchiTalentDot'] }) });
      }
      if (victim.bossPool || !Number.isFinite(victim.s?.maxHp)) return;
      const previous = unit.mem.assaultEtlchiStolen ?? 0;
      const perHit = (num(unit, passive.values.stealHp, 0) + moduleParam(unit, 'uniequip_002_etlchi', 's', 0)) * (candleHost ? 2 : 1);
      const stolen = Math.min(perHit, cap - previous, Math.floor(victim.s.maxHp - 1));
      if (!(stolen > 0)) return;
      unit.mem.assaultEtlchiStolen = previous + stolen;
      const key = `${body.charId}:stolen:${unit.uid}`;
      const total = Number(victim.findBuff(key)?.data?.total ?? 0) + stolen;
      const hp = victim.hp;
      battle.addBuff(victim, { key, mods: { hpFlat: -total }, data: { total } });
      if (victim.alive) victim.hp = Math.min(hp, victim.s.maxHp);
      battle.addBuff(unit, { key: `${body.charId}:stolen-hp`, mods: { hpFlat: unit.mem.assaultEtlchiStolen }, persist: true });
    }, { owner: unit });
    return;
  }
  if (body.charId === 'char_474_glady') {
    const tide = body.talentBindings.find(binding => binding.nativeTalentIndex === 0)?.translation?.parameters;
    const hunger = body.talentBindings.find(binding => binding.nativeTalentIndex === 1)?.translation?.parameters;
    if (!tide?.regenPerSec || !tide.seaMonsterReduction || !hunger?.atkScale || !Number.isFinite(hunger.weightThreshold))
      throw new TypeError('Gladiia requires both compiled retained-talent parameter sets');
    const regen = num(unit, tide.regenPerSec), reduction = num(unit, tide.seaMonsterReduction);
    if (regen > 0) whileDeployed(battle, unit, AURA, () => {
      for (const ally of battle.allies(unit.ownerId)) if (ally.kind === 'op' && unitTag(ally, 'abyssal'))
        pulse(battle, ally, 'glady:tide', { hpRegenRatio: regen }, { source: unit });
    });
    if (reduction > 0) battle.on('hit', ({ source, target, dmg }) => {
      if (!active(unit) || target?.ownerId !== unit.ownerId || !target.findBuff?.('glady:tide') ||
          !enemyHasTag(source, 'seamonster') || !['phys', 'arts'].includes(dmg?.type)) return;
      dmg.mul *= 1 - reduction;
    }, { owner: unit });
    battle.on('hit', ({ source, target, dmg }) => {
      if (source === unit && active(unit) && dmg?.isAttack && target?.side === 'enemy' && target.s.massLevel <= hunger.weightThreshold)
        applyDamageIncrease(battle, unit, dmg, num(unit, hunger.atkScale));
    }, { owner: unit });
  }
  if (body.charId === 'char_263_skadi') {
    const piece = unit.def.raw.assaultPiece;
    const moduleId = piece.moduleId ?? piece.moduleChoices?.[body.charId];
    const swift = body.talentBindings.find((entry) => entry.nativeTalentIndex === 1);
    unit.base.respawnTime = Math.max(0, unit.base.respawnTime + num(unit, swift?.translation?.parameters?.redeployReduceSec, 0));
    // 大巴扎：往日残梦只加深海猎人攻击力光环，删去再部署 -5 秒。
    const passive = body.modePassives[0];
    const installAbyssalAura = () => {
      if (unit.mem.assaultSkadiAuraInstalled) return;
      const atkPct = num(unit, passive.values.atkBonus, 0) + moduleParam(unit, 'uniequip_003_skadi', 'x', 0) / 100;
      for (const ally of battle.allyUnits) if (ally.kind === 'op' && unitTag(ally, 'abyssal'))
        buff(battle, unit, ally, { key: `${body.charId}:abyssal-aura`, mods: { atkPct }, persist: true, allowDead: true });
      unit.mem.assaultSkadiAuraInstalled = true;
    };
    battle.on('battleStart', installAbyssalAura, { owner: unit });
    installAbyssalAura();
  }
  if (body.charId === 'char_350_surtr') {
    const passive = body.modePassives.find((entry) => entry.action === 'nativeMechanism');
    const values = passive?.values ?? {};
    const piece = unit.def.raw.assaultPiece;
    const moduleId = piece.moduleId ?? piece.moduleChoices?.[body.charId];
    const magma = body.talentBindings.find((entry) => entry.nativeTalentIndex === 0);
    const penetration = num(unit, magma?.translation?.parameters?.ignoreRes, 0);
    if (penetration > 0)
      buff(battle, unit, unit, { key: `${body.charId}:source-magma`, mods: { resIgnoreFlat: penetration }, persist: true, allowDead: true });
    if (piece.star >= 3 && moduleId === 'uniequip_002_surtr' && !BAZAAR_MODULES.has('uniequip_002_surtr')) {
      const installResPen = () => {
        if (!active(unit) || unit.mem.assaultSurtrResPenInstalled) return;
        buff(battle, unit, unit, { key: `${body.charId}:module-res-penetration`, mods: { resIgnoreFlat: 5 }, persist: true });
        unit.mem.assaultSurtrResPenInstalled = true;
      };
      battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) installResPen(); }, { owner: unit });
      battle.on('battleStart', installResPen, { owner: unit });
      installResPen();
    }
    unit.mem.assaultSurtrEmberUsed = false;
    unit.mem.assaultSurtrEmberUntil = -Infinity;
    const clearSurtrTimers = () => {
      unit.mem.assaultSurtrDrainCancel?.(); unit.mem.assaultSurtrDrainCancel = null;
      unit.mem.assaultSurtrEmberCancel?.(); unit.mem.assaultSurtrEmberCancel = null;
      unit.mem.assaultSurtrEmberGeneration = (unit.mem.assaultSurtrEmberGeneration ?? 0) + 1;
      unit.mem.assaultSurtrEmberUntil = -Infinity;
    };
    battle.on('death', ({ unit: dead }) => { if (dead === unit) clearSurtrTimers(); }, { owner: unit });
    battle.on('deploy', ({ unit: deployed }) => {
      if (deployed !== unit) return;
      clearSurtrTimers(); // Formal Assault contract: Ember can trigger only once per battle.
    }, { owner: unit });
    // The native fatal hook covers both mitigated enemy damage and own HP loss.
    battle.on('fatal', (damageCtx) => {
      if (damageCtx.unit !== unit || damageCtx.prevented || !active(unit)) return;
      if (unit.mem.assaultSurtrEmberUsed) {
        if (battle.time < unit.mem.assaultSurtrEmberUntil) damageCtx.prevented = true;
        return;
      }
      unit.mem.assaultSurtrEmberUsed = true;
      const minHp = num(unit, values.minHp, 1);
      const moduleThree = moduleId === 'uniequip_003_surtr' && piece.star >= 4;
      const surviveSec = num(unit, values.surviveSec, 4);
      const generation = unit.mem.assaultSurtrEmberGeneration = (unit.mem.assaultSurtrEmberGeneration ?? 0) + 1;
      const deployment = unit.deploySeq;
      unit.mem.assaultSurtrEmberUntil = battle.time + surviveSec;
      damageCtx.prevented = true;
      unit.hp = Math.max(unit.hp, Math.min(minHp, unit.s.maxHp));
      battle.addBuff(unit, { key: `${body.charId}:ember`, status: 'healFree', flags: { noHeal: true, healFree: true }, duration: surviveSec });
      battle.fx('ember', { x: unit.x, y: unit.y, id: unit.id });
      if (piece.star >= 3 && moduleId === 'uniequip_003_surtr')
        buff(battle, unit, unit, { key: `${body.charId}:ember-module`, mods: { atkPct: moduleParam(unit, 'uniequip_003_surtr', 'x', 20) / 100 }, duration: surviveSec });
      unit.mem.assaultSurtrEmberCancel = onTimer(battle, unit, surviveSec, (b) => {
        if (unit.deploySeq === deployment && unit.mem.assaultSurtrEmberGeneration === generation) {
          b.retreat(unit, { reason: 'assaultSurtrEmber', permanent: false, dying: true });
          // 大巴扎：旅游必需品删去撤退后返还技力。
        }
      });
    }, { owner: unit, priority: -60 });
  }
  if (body.charId === 'char_4082_qiubai') {
    const effect = body.fixedSkill.effects.find((entry) => entry.action === 'growth');
    battle.on('attack', ({ attacker }) => {
      if (attacker !== unit || !active(unit) || battle.time > (unit.mem.assaultQiuBaiUntil ?? -Infinity)) return;
      const max = Math.floor(num(unit, effect.values.maxStacks, 6));
      if (unit.mem.assaultQiuBaiStacks >= max) return;
      unit.mem.assaultQiuBaiStacks++;
      buff(battle, unit, unit, { key: `${body.charId}:attack-stack`, mods: { aspd: num(unit, effect.values.attackSpeedPerHit, 13) }, duration: num(unit, effect.values.duration, 30), stacking: 'stack', maxStacks: max });
    }, { owner: unit });
  }
  if (body.charId === 'char_1026_gvial2') {
    unit.mem.assaultDeferredPackets ??= [];
    const blockPassive = body.modePassives[0];
    const blockBuffKey = `${body.charId}:current-block-count`;
    const syncBlockBuff = () => {
      const count = unit.blocking.filter((enemy) => enemy?.alive && enemy.blockedBy === unit)
        .reduce((sum, enemy) => sum + (enemy.blockWeight ?? 1), 0);
      if (!active(unit) || count <= 0) { if (unit.findBuff(blockBuffKey)) battle.removeBuff(unit, blockBuffKey); return; }
      const params = { ...(blockPassive.values ?? {}) }, hooks = unit.mem.assaultModuleHooks;
      if (hooks?.active) {
        const moduleCtx = { battle, unit, body, piece: unit.def.raw.assaultPiece, rank: unit.def.raw.assaultPiece.star,
          cause: battle.assaultRuntime.currentCause, effect: { ...blockPassive, values: params }, params, targets: [unit], hitCount: count };
        const overrides = hooks.beforeEffect(moduleCtx);
        if (overrides && typeof overrides === 'object') Object.assign(moduleCtx, overrides);
        Object.assign(params, moduleCtx.params ?? moduleCtx.effect?.values ?? params);
        hooks.afterEffect({ ...moduleCtx, result: count });
      }
      // 大巴扎：「此干员每阻挡 1 名敌人 +x% 攻击力和防御力」（好锯多磨：每名再 +x%）。
      const ratio = count * (lineParam(unit, 2, 'x', 100 * num(unit, params.baseAtkDef, 0)) + moduleParam(unit, 'uniequip_003_gvial2', 'x', 0)) / 100;
      buff(battle, unit, unit, { key: blockBuffKey, mods: { atkPct: ratio, defPct: ratio }, persist: true });
    };
    battle.on('blocked', ({ blocker }) => { if (blocker === unit) syncBlockBuff(); }, { owner: unit });
    battle.on('tick', syncBlockBuff, { owner: unit });
    battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) syncBlockBuff(); }, { owner: unit });
    battle.on('retreating', ({ unit: retreating }) => { if (retreating === unit) syncBlockBuff(); }, { owner: unit });
    syncBlockBuff();
    const mechanism = body.fixedSkill.effects.find((entry) => entry.action === 'nativeMechanism');
    if (mechanism) {
      battle.on('hpDamage', (damageCtx) => {
        const until = unit.mem.assaultDelayActiveUntil ?? -Infinity;
        if (damageCtx.target !== unit || !active(unit) || battle.time > until || !(damageCtx.amount > 0)) return;
        const ratio = Math.max(0, Math.min(0.95, unit.mem.assaultDelayRatio ?? 0.5));
        const deferred = damageCtx.amount * ratio;
        if (!(deferred > 0) || deferred >= unit.hp) return;
        damageCtx.amount -= deferred;
        unit.mem.assaultDeferredPackets.push({ amount: deferred, ticksLeft: Math.ceil(num(unit, mechanism.values.finalDuration, 20) /
          num(unit, mechanism.values.interval, 0.1)) });
      }, { owner: unit });
      const interval = num(unit, mechanism.values.interval, 0.1);
      const startDrain = () => {
        if (unit.mem.assaultDeferredTimerStarted) return;
        unit.mem.assaultDeferredTimerStarted = true;
        onTimer(battle, unit, interval, (b) => {
          for (const packet of [...unit.mem.assaultDeferredPackets]) {
            if (!unit.alive) { unit.mem.assaultDeferredPackets.length = 0; break; }
            const tick = packet.amount / packet.ticksLeft;
            packet.amount -= tick; packet.ticksLeft--;
            b.loseHp(unit, Math.min(tick, Math.max(0, unit.hp - 1)), { source: unit, tags: ['assaultDeferredDamage'] });
            if (packet.ticksLeft <= 0 || packet.amount <= 1e-6) unit.mem.assaultDeferredPackets.splice(unit.mem.assaultDeferredPackets.indexOf(packet), 1);
          }
        }, { every: true });
      };
      if (active(unit)) startDrain();
    }
    else if (mechanism) battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) startDrain(); }, { owner: unit });
  }
  if (body.charId === 'char_1041_angel2' || body.charId === 'char_1032_excu2') {
    battle.on('attack', ({ attacker, targets, isSkill, noAmmo = false }) => {
      const ammo = unit.mem.assaultAmmo;
      if (attacker !== unit || !ammo || !active(unit) || !Array.isArray(targets) || !targets.length) return;
      if (body.charId === 'char_1032_excu2') for (const target of targets) if (target?.side === 'enemy') ammo.attackedTargets.set(uid(target), target);
      if (noAmmo) return;
      if (body.charId === 'char_1032_excu2' && unit.mem.assaultExcu2ExtraAttack) return;
      const values = ammo.effect.values ?? {};
      const state = assaultAmmoState(unit);
      if (!state?.current) return;
      const bullets = Math.min(state.current, ammo.ammoPerAttack);
      const attackSeq = ++ammo.attacks;
      const attackCause = battle.assaultRuntime.currentCause ?? ammo.cause;
      for (let bullet = 0; bullet < bullets; bullet++) {
        if (consumeAssaultAmmo(battle, unit, 1, `${body.charId}:ammo-attack:${attackSeq}:${bullet}`, { isSkill: !!isSkill }) !== 1) break;
      }
      const scale = body.charId === 'char_1041_angel2' ? num(unit, values.atkScalePerHit) : num(unit, values.atkScale);
      for (let bullet = 0; bullet < bullets; bullet++) {
        if (bullet >= state.current) break;
        for (const target of targets) if (target?.alive) {
          battle.assaultRuntime.withCause(attackCause, () => battle.dealDamage(unit, target, {
            amount: unit.s.atk * scale, type: physicalFor(unit, values), isAttack: true, isSkill: true,
            canDodge: true, attackId: `${body.charId}:ammo:${attackSeq}:${bullet}:${uid(target)}` }));
        }
      }
      if (ammo.left <= 0) {
        if (body.charId === 'char_1032_excu2' && ammo.finalEffect && ammo.attackedTargets.size) {
          const finalTargets = [...ammo.attackedTargets.values()].filter((target) => target?.alive);
          if (finalTargets.length) queue(battle, `assault:${body.charId}:ammo-final:${attackSeq}`, unit,
            (rt, task) => execute({ battle, unit, effect: ammo.finalEffect, cause: task.cause, targets: finalTargets }), attackCause);
        }
        unregisterAssaultAmmo(unit);
        unit.mem.assaultAmmo = null;
        if (battle._hooks.skillEnd) battle.emit('skillEnd', { unit, reason: 'ammo', assaultAmmo: true });
      }
    }, { owner: unit });
  }
  if (body.charId === 'char_172_svrash') {
    const passive = body.modePassives[0];
    const piece = unit.def.raw.assaultPiece;
    const star = piece.star;
    const moduleId = piece.moduleId ?? piece.moduleChoices?.[body.charId];
    const hasAdvanced = star >= 3 && moduleId === 'uniequip_002_svrash';
    const atk = Number(v(unit, passive.values.atkBonusSelf));
    const redeploy = Number(v(unit, passive.values.redeployReduceTeam));
    const installAura = () => {
      if (unit.mem.assaultSilverAshAuraInstalled) return;
      buff(battle, unit, unit, { key: `${body.charId}:leader-atk`, mods: { atkPct: atk }, persist: true, allowDead: true });
      for (const ally of battle.getPlayer(unit.ownerId)?.units ?? []) if (ally.kind === 'op')
        buff(battle, unit, ally, { key: `${body.charId}:leader-redeploy`, mods: { redeployMul: 1 - redeploy }, persist: true, allowDead: true });
      unit.mem.assaultSilverAshAuraInstalled = true;
    };
    battle.on('battleStart', installAura, { owner: unit });
    const reveal = () => {
      for (const enemy of battle.enemies) if (enemy.alive && enemy.hidden && bodyInKeys(enemy, unit.rangeKeySet))
        buff(battle, unit, enemy, { key: `${body.charId}:reveal`, flags: { stealthOff: true }, duration: 0.2 });
    };
    battle.on('tick', reveal, { owner: unit });
    if (hasAdvanced) unit.mem.assaultSilverAshModule = true;
    return;
  }
  if (body.charId === 'char_1001_amiya2' || body.charId === 'char_1037_amiya3') {
    const passive = body.modePassives[0];
    const piece = unit.def.raw.assaultPiece;
    const moduleId = piece.moduleId ?? piece.moduleChoices?.[body.charId];
    const module = piece.star >= 3 && moduleId === (body.charId === 'char_1001_amiya2' ? 'uniequip_002_amiya2' : 'uniequip_002_amiya3');
    const applyAura = () => {
      if (!active(unit)) return;
      for (const ally of battle.allyUnits.filter((candidate) => candidate.kind === 'op')) {
        const atk = Number(v(unit, passive.values.atk ?? 0));
        const def = Number(v(unit, passive.values.def ?? 0));
        const hp = Number(v(unit, passive.values.maxHp ?? 0));
        const bonus = module ? (piece.star >= 4 ? 0.09 : 0.08) : atk;
        const regen = Number(v(unit, passive.values.hpRecoveryPerSecByMaxHp ?? 0));
        const mods = { ...(atk ? { atkPct: bonus } : null), ...(def ? { defPct: module ? bonus : def } : null), ...(hp ? { hpPct: module && body.charId === 'char_1037_amiya3' ? moduleParam(unit, 'uniequip_002_amiya3', 'a', 9) / 100 : module ? (piece.star >= 4 ? 0.1 : 0.09) : hp } : null), ...(regen && body.charId !== 'char_1037_amiya3' ? { hpRegenRatio: regen } : null) };
        if (Object.keys(mods).length) buff(battle, unit, ally, { key: `${body.charId}:team-aura`, mods, persist: true });
      }
    };
    const clearAura = () => {
      for (const ally of battle.allyUnits) for (const suffix of ['team-aura', 'double-window', 'skill-regen']) {
        const key = `${body.charId}:${suffix}`, entry = ally.findBuff(key);
        if (entry?.source === unit) battle.removeBuff(ally, key);
      }
    };
    battle.on('deploy', applyAura, { owner: unit });
    battle.on('death', ({ unit: dead }) => { if (dead === unit) clearAura(); }, { owner: unit });
    battle.on('retreating', ({ unit: leaving }) => { if (leaving === unit) clearAura(); }, { owner: unit });
    applyAura();
    // 大巴扎：待调弦的怒火删去未阻挡攻速。
    if (body.charId === 'char_1001_amiya2' && module && false) battle.on('tick', () => {
      if (!active(unit)) return;
      const key = `${body.charId}:module-unblocked-aspd`;
      if (!unit.blocking.length) buff(battle, unit, unit, { key, mods: { aspd: 8 }, persist: true });
      else battle.removeBuff(unit, key);
    }, { owner: unit });
    return;
  }
  if (body.charId === 'char_4191_tippi') battle.on('hpDamage', (damageCtx) => {
    if (damageCtx.target !== unit || !unit.alive || !(unit.mem.assaultTippiDodgeCharges > 0) || !damageCtx.dmg?.isAttack || damageCtx.source?.side !== 'enemy') return;
    unit.mem.assaultTippiDodgeCharges--;
    damageCtx.amount = 0;
    const attacker = damageCtx.source, scale = unit.mem.assaultTippiCounterScale ?? 0;
    if (attacker.alive && scale > 0) queue(battle, `assault:${body.charId}:counter`, attacker,
      () => damage(battle, unit, attacker, { scale, type: 'phys', isSkill: false, sourceKey: `${body.charId}:counter` }), battle.assaultRuntime.currentCause);
  }, { owner: unit, priority: 100 });
  if (body.charId === 'char_4037_demetr') {
    const effect = body.modePassives[0];
    const talent = body.talentBindings.find((binding) => binding.nativeTalentIndex === 0)?.translation?.parameters ?? {};
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !dmg?.isAttack || target.side !== 'enemy') return;
      const hpRatio = target.hp / target.s.maxHp;
      if (hpRatio < num(unit, effect.values.hpThreshold, 0.2))
        dmg.defIgnorePct = (dmg.defIgnorePct ?? 0) + num(unit, effect.values.ignoreDefRatio, 0);
      const threshold = num(unit, talent.executionHp, 0.2);
      const maxBonus = num(unit, talent.executionMax, 1);
      const progress = Math.max(0, Math.min(1, (1 - hpRatio) / Math.max(0.001, 1 - threshold)));
      if (progress > 0 && Number.isFinite(dmg.amount)) dmg.amount *= 1 + (maxBonus - 1) * progress;
    }, { owner: unit, priority: 100 });
  }
  if (body.charId === 'char_155_tiger') battle.on('hit', ({ source, dmg }) => {
    const bonus = unit.mem.assaultTigerNextAttackBonus ?? 0;
    if (source !== unit || !dmg?.isAttack || !(bonus > 0)) return;
    dmg.amount *= 1 + bonus;
    unit.mem.assaultTigerNextAttackBonus = 0;
  }, { owner: unit, priority: 100 });
  if (body.charId === 'char_4151_tinman' || body.charId === 'char_1039_thorn2') {
    const fieldPassive = body.modePassives[0];
    if (fieldPassive?.action !== 'addBuff' || fieldPassive.values?.dotAmp == null) throw new TypeError(`missing typed field-damage passive for ${body.charId}`);
    // 大巴扎：锡人卡面写了「持续伤害 +20%」；引星棘刺卡面只写每秒 a% 法术伤害，不再有隐藏的 +20%。
    unit.mem.assaultFieldDotAmp = body.charId === 'char_1039_thorn2' ? 0 : num(unit, fieldPassive.values.dotAmp, 0);
    return;
  }
  for (const [index, effect] of (body.modePassives ?? []).entries()) {
    if (BAZAAR_REPLACED_PASSIVES.has(`${body.charId}:${index}`)) continue;
    if (body.charId === 'char_1028_texas2' || body.charId === 'char_2024_chyue' || body.charId === 'char_4058_pepe' || body.charId === 'char_1014_nearl2' || body.charId === 'char_1032_excu2' || body.charId === 'char_263_skadi') continue;
    if ((body.charId === 'char_474_glady' || body.charId === 'char_4037_demetr' || body.charId === 'char_356_broca' || body.charId === 'char_308_swire' || body.charId === 'char_140_whitew' || body.charId === 'char_4036_forcer' || body.charId === 'char_437_mizuki' || body.charId === 'char_1023_ghost2' || body.charId === 'char_4082_qiubai' || body.charId === 'char_4116_blkkgt' || body.charId === 'char_1019_siege2' || body.charId === 'char_264_f12yin' || body.charId === 'char_1026_gvial2') && index === 0) continue;
    const event = PASSIVE_BINDINGS[body.charId]?.[index];
    if (!event) throw new TypeError(`no explicit modePassive binding for ${body.charId}:${index}`);
    const fire = (payload = {}, cause = null) => {
      const linked = body.charId === 'char_1041_angel2' && event === 'ammoUsed' && index === 0
        ? payload.source?.side === 'ally'
        : body.charId === 'char_155_tiger' && event === 'dodge' ? payload.target === unit && payload.source?.side === 'enemy' && payload.dmg?.type === 'phys' && payload.dmg?.isAttack
        : event === 'damageDealt' ? payload.sourceUid === uid(unit)
        : event === 'blockedAllyAttacked' ? body.charId === 'char_294_ayer'
          ? payload.target?.side === 'enemy' && payload.target.blockedBy?.side === 'ally' && Math.abs(payload.target.blockedBy.tileR - unit.tileR) <= 1 && Math.abs(payload.target.blockedBy.tileC - unit.tileC) <= 1
          : body.charId === 'char_265_sophia' && payload.target?.side === 'ally' && payload.target.kind === 'op' && payload.target.s.blockCnt >= 3 && payload.source?.side === 'enemy' && payload.dmg?.isAttack
        : body.charId === 'char_4064_mlynar' && event === 'damageTaken' ? payload.target?.side === 'ally' && payload.target.kind === 'op' && unitTag(payload.target, 'kazimierz') && payload.source?.side === 'enemy' && payload.amount > 0
        : event === 'dpSpent' ? Number(payload.amount) > 0 && payload.targetUid === unit.ownerId
        : body.charId === 'char_308_swire' && event === 'deployed'
        ? payload.target?.side === 'ally' && payload.target !== unit
        : body.charId === 'char_1041_angel2' && index === 2 && event === 'deployed'
          ? uid(payload.target) === unit.mem.assaultAngelDeliveryPendingUid
        : ['deviceTrigger','goldSpent'].includes(event) ? belongs(event, payload, unit)
        : belongs(event, payload, unit);
      if (!linked) return;
      if (body.charId === 'char_155_tiger' && event === 'dodge') {
        return queue(battle, `assault:${body.charId}:dodge-next-attack`, unit,
          () => { unit.mem.assaultTigerNextAttackBonus = num(unit, effect.values.nextAtkBonus, 0); }, cause);
      }
      if (body.charId === 'char_350_surtr') return; // lethal prevention uses the native fatal hook, including own HP loss.
      if (body.charId === 'char_337_utage' && unit.hp / unit.s.maxHp >= 0.5) return;
      if (body.charId === 'char_337_utage' && (payload.killer?.uid ?? payload.killer?.id) !== uid(unit)) return;
      if (body.charId === 'char_1028_texas2' && (payload.killer?.uid ?? payload.killer?.id) !== uid(unit)) return;
      if (body.charId === 'char_1041_angel2' && index === 0 && payload.source?.side !== 'ally') return;
      if (body.charId === 'char_1041_angel2' && index === 1 && (payload.unit !== unit || payload.reason !== 'ammo')) return;
      if (body.charId === 'char_1041_angel2' && index === 2 && payload.target?.side !== 'ally') return;
      if (body.charId === 'char_1041_angel2' && index === 1) {
        const used = unit.mem.assaultAngelEmptyAmmoTriggers ?? 0;
        const cap = Math.max(0, Math.floor(num(unit, effect.values.perBattle, 0)));
        if (used >= cap) return;
        unit.mem.assaultAngelEmptyAmmoTriggers = used + 1;
        return queue(battle, `assault:${body.charId}:empty-ammo:${used + 1}`, unit,
          (rt, task) => execute({ battle, unit, effect, cause: task.cause, targets: [unit] }), cause);
      }
      if (body.charId === 'char_1041_angel2' && index === 2) {
        unit.mem.assaultAngelNextSplashBonus = Math.max(Number(unit.mem.assaultAngelNextSplashBonus) || 0, num(unit, effect.values.splashBonus, 0));
        unit.mem.assaultAngelDeliveryPendingUid = null;
        return;
      }
      if (body.charId === 'char_1041_angel2' && index === 0) {
        const consumer = payload.source;
        const quantity = Math.max(0, Math.floor(Number(payload.quantity ?? payload.amount) || 0));
        for (let bullet = 0; bullet < quantity; bullet++) {
          const serial = unit.mem.assaultAngelAmmoPassiveSeq = (unit.mem.assaultAngelAmmoPassiveSeq ?? 0) + 1;
          queue(battle, `assault:${body.charId}:ammo-passive:${uid(consumer)}:${serial}`, unit, (rt, task) => {
            if (!consumer?.alive || battle.rng() >= num(unit, effect.values.bombChance, 0)) return;
            const candidates = enemies(battle, unit, { scope: 'range', anchor: consumer, priority: 'exit', count: 99 });
            if (!candidates.length) return;
            const center = candidates[Math.min(candidates.length - 1, Math.floor(battle.rng() * candidates.length))];
            const radius = num(unit, effect.values.splashRadius, 1), scale = num(unit, effect.values.bombAtkScale, 0);
            for (const target of battle.enemies.filter((enemy) => enemy.alive && hypot(enemy.y - center.y, enemy.x - center.x) <= radius)) {
              damage(battle, unit, target, { scale, type: 'phys', isSkill: true, sourceKey: `${body.charId}:ammo-bomb:${serial}`, cause: task.cause });
            }
          }, cause);
        }
        return;
      }
      if (body.charId === 'char_4016_kazema' && event === 'summonSpawned') {
        const shadow = payload.target;
        if (!shadow?.alive || shadow.ownerUnit !== unit || shadow.mem.assaultKazemaSpawnDamageResolved) return;
        shadow.mem.assaultKazemaSpawnDamageResolved = true;
        const radius = num(unit, effect.values.radius, 1);
        const moduleScale = unit.mem.assaultModuleHooks?.active &&
          unit.mem.assaultModuleHooks.moduleId === 'uniequip_002_kazema' ? 1 + moduleParam(unit, 'uniequip_002_kazema', 'x', 15) / 100 : 1;
        const scale = num(unit, effect.values.atkScale ?? effect.values.extraAtkScale, 0) * moduleScale;
        const victims = battle.enemies.filter((enemy) => enemy.alive && hypot(enemy.y - shadow.y, enemy.x - shadow.x) <= radius);
        if (!victims.length) return;
        return queue(battle, `assault:${body.charId}:shadow-spawn-damage`, shadow, (rt, task) => {
          for (const target of victims) if (target.alive) damage(battle, unit, target, { scale, type: physicalFor(unit, effect.values), isSkill: true,
            sourceKey: `${body.charId}:shadow-spawn:${uid(shadow)}`, cause: task.cause });
        }, cause);
      }
      if (body.charId === 'char_237_gravel' && payload.initial) return;
      if (body.charId === 'char_491_humus' && (payload.targets?.length ?? 0) < 2) return;
      if (body.charId === 'char_308_swire') {
        const target = payload.target;
        if (!target || target === unit || target.kind !== 'op' || Math.abs(target.tileR - unit.tileR) > 1 || Math.abs(target.tileC - unit.tileC) > 1) return;
      }
      if (body.charId === 'char_154_morgan' && unit.hp / unit.s.maxHp >= 0.4) return;
      if (body.charId === 'char_143_ghost') {
        if (unit.hp / unit.s.maxHp >= 0.15 || unit.mem.assaultGhostThresholdProc) return;
        unit.mem.assaultGhostThresholdProc = true;
      }
      if (body.charId === 'char_127_estell') {
        const victim = payload.unit ?? payload.target;
        if (!victim || victim.kind === 'token' || Math.abs(victim.tileR - unit.tileR) > 1 || Math.abs(victim.tileC - unit.tileC) > 1) return;
      }
      if (body.charId === 'char_356_broca' && unit.blocking.length < 2) return;
      if (body.charId === 'char_294_ayer' || body.charId === 'char_265_sophia') {
        const now = battle.time;
        const victims = body.charId === 'char_294_ayer' ? [payload.target] : [payload.source];
        if (!victims[0]?.alive) return;
        // 大巴扎：断崖不再有同一敌人每秒一次的门槛，倍率读卡面 a。
        const ayerEffect = { ...effect, values: { ...(effect.values ?? {}) } };
        const ayerScale = lineParam(unit, 1, 'a', null);
        for (const field of ['atkScale', 'extraAtkScale']) if (ayerScale != null && ayerEffect.values[field] != null) ayerEffect.values[field] = ayerScale / 100;
        return queue(battle, `assault:${body.charId}:modePassive:${index}`, victims[0],
          (rt, task) => execute({ battle, unit, effect: ayerEffect, cause: task.cause, targets: victims }), cause);
      }
      if (body.charId === 'char_4145_ulpia' && event === 'damageTaken') {
        return queue(battle, `assault:${body.charId}:modePassive:${index}`, unit, (rt, task) =>
          execute({ battle, unit, effect, cause: task.cause, targets: [unit] }), cause);
      }
      if (body.charId === 'char_4191_tippi' && event === 'damageTaken') {
        return queue(battle, `assault:${body.charId}:modePassive:${index}`, unit, () => {
          unit.mem.assaultTippiDodgeCharges = Math.max(unit.mem.assaultTippiDodgeCharges ?? 0, num(unit, effect.values.dodgeCharges, 1));
          unit.mem.assaultTippiCounterScale = num(unit, effect.values.counterAtkScale, 0);
        }, cause);
      }
      if (body.charId === 'char_1033_swire2' && event === 'goldSpent') {
        return queue(battle, `assault:${body.charId}:modePassive:${index}`, unit, () => {
          const values = effect.values ?? {}, previous = unit.mem.assaultSwireGoldStacks ?? 0;
          const cap = Math.floor(num(unit, values.maxStacks, 0) + Number(unit.mem.assaultSwireGoldCapBonus || 0));
          const next = Math.min(cap, previous + Math.max(1, Math.floor(Number(payload.amount) || 1)));
          const gain = next - previous;
          if (gain > 0) {
            unit.mem.assaultSwireGoldStacks = next;
            const total = next * num(unit, values.atkPerGold, 0);
            buff(battle, unit, unit, { key: `${body.charId}:gold-growth`, mods: { atkPct: total }, persist: true });
          }
        }, cause);
      }
      if (body.charId === 'char_4155_talr' && event === 'dpSpent') {
        return queue(battle, `assault:${body.charId}:modePassive:${index}`, unit, () => {
          const values = effect.values ?? {}, previous = unit.mem.assaultTalrDpGrowth ?? 0;
          const cap = num(unit, values.cap, 0), requested = Math.max(0, Number(payload.amount) || 0) * num(unit, values.atkPerDeployPoint, 0);
          const gain = Math.min(requested, Math.max(0, cap - previous));
          if (gain > 0) {
            unit.mem.assaultTalrDpGrowth = previous + gain;
            buff(battle, unit, unit, { key: `${body.charId}:dp-growth`, mods: { atkPct: unit.mem.assaultTalrDpGrowth }, persist: true });
          }
        }, cause);
      }
      if (body.charId === 'char_4064_mlynar' && event === 'damageTaken')
        return queue(battle, `assault:${body.charId}:modePassive:${index}:${uid(payload.target)}`, payload.source, (rt, task) => execute({ battle, unit,
          // 鞘中人：卡西米尔干员受击时的真实伤害 +x%（加到倍率上）。
          effect: { ...effect, values: { ...effect.values, reflectAtkScale: (effect.values.reflectAtkScale ?? []).map((value) => value == null ? value : Number(value) + moduleParam(unit, 'uniequip_002_mlynar', 'x', 0) / 100) } },
          cause: task.cause, targets: [payload.source] }), cause);
      if (body.charId === 'char_4155_talr' && !(Number(payload.amount) > 0)) return;
      if (body.charId === 'char_172_svrash' || body.charId === 'char_263_skadi') return execute({ battle, unit, effect });
      const eventTargets = event === 'attack' ? (payload.targets ?? [])
        : event === 'damageTaken' || event === 'kazimierzDamageTaken' ? [payload.source].filter(Boolean)
          : event === 'damageDealt' || event === 'blockedAllyAttacked' ? [payload.target].filter(Boolean)
          : event === 'kill' ? [payload.victim].filter(Boolean)
          : event === 'death' ? [payload.unit ?? payload.target].filter(Boolean)
        : event === 'deployed' || event === 'summonSpawned' || event === 'deviceTrigger' ? [payload.target].filter(Boolean) : [];
      const recipients = ['heal', 'spGain'].includes(effect.action) || (effect.action === 'addBuff' && body.charId !== 'char_308_swire')
        ? null : (eventTargets.length ? eventTargets : null);
      queue(battle, `assault:${body.charId}:modePassive:${index}`, recipients?.[0] ?? unit, (rt, task) => execute({ battle, unit, effect, cause: task.cause, targets: recipients }), cause);
    };
    if (event === 'damageTaken') watch(battle, unit, event, `assault:${body.charId}:modePassive:${index}`, ({ payload }) => body.charId === 'char_4064_mlynar'
      ? payload.target?.side === 'ally' && payload.target.kind === 'op' && unitTag(payload.target, 'kazimierz') && payload.source?.side === 'enemy' && payload.amount > 0
      : belongs(event, payload, unit),
      ({ payload, cause }) => fire(payload, cause));
    else if (['damageDealt','blockedAllyAttacked','kazimierzDamageTaken'].includes(event)) battle.on('damaged', (damageCtx) => {
      if (!(damageCtx.amount > 0)) return;
      if (body.charId === 'char_4191_tippi' && !damageCtx.dmg?.isAttack) return;
      // These three observer bindings need an actual attacker/target Unit. Environmental damage is
      // deliberately sourceless; it must not fabricate a UID or prevent other owner damage hooks.
      if (damageCtx.source == null) return;
      if (!battle.units.includes(damageCtx.source)) throw new TypeError(`damage observer source is not a battle Unit for ${body.charId}:${event}`);
      if (!battle.units.includes(damageCtx.target)) throw new TypeError(`damage observer target is not a battle Unit for ${body.charId}:${event}`);
      const payload = { ...damageCtx, sourceUid: uid(damageCtx.source), targetUid: uid(damageCtx.target) };
      fire(payload, battle.assaultRuntime.currentCause);
    }, { owner: unit });
    else if (['attack','deployed','summonSpawned','dpReceived','dpSpent','ammoUsed'].includes(event)) watch(battle, unit, event, `assault:${body.charId}:modePassive:${index}`,
      ({ payload }) => (body.charId === 'char_294_ayer' && event === 'attack' ? (payload.targets ?? []).some((target) => target?.alive && target.blockedBy?.side === 'ally' && Math.abs(target.blockedBy.tileR - unit.tileR) <= 1 && Math.abs(target.blockedBy.tileC - unit.tileC) <= 1)
        : body.charId === 'char_308_swire' && event === 'deployed' ? payload.target?.side === 'ally' && payload.target !== unit
        : body.charId === 'char_1041_angel2' && event === 'deployed' ? payload.target?.side === 'ally'
          : body.charId === 'char_1041_angel2' && event === 'ammoUsed' && index === 0 ? payload.source?.side === 'ally' : belongs(event, payload, unit)),
      ({ payload, cause }) => fire(payload, cause));
    else if (event === 'deployPaid') battle.on('deploy', ({ unit: deployed, actualPaid = 0 }) => fire({ source: deployed, sourceUid: uid(deployed), target: deployed, targetUid: uid(deployed), amount: actualPaid }, battle.assaultRuntime.currentCause), { owner: unit });
    else if (event === 'battleStart') battle.on('battleStart', () => fire());
    else if (event === 'skillEnd') battle.on('skillEnd', (payload) => fire(payload, battle.assaultRuntime.currentCause), { owner: unit });
    else if (event === 'tick' && body.charId === 'char_173_slchan') battle.on('tick', () => {
      if (!active(unit)) return;
      const key = `${body.charId}:unblocked`; const passive = body.modePassives[index];
      if (!unit.blocking.length) buff(battle, unit, unit, { key, mods: { atkPct: Number(v(unit, passive.values.atkDefRatio)), defPct: Number(v(unit, passive.values.atkDefRatio)) }, persist: true });
      else battle.removeBuff(unit, key);
    }, { owner: unit });
    else if (event === 'tick' && body.charId === 'char_188_helage') battle.on('tick', ({ dt }) => {
      if (!active(unit) || unit.blocking.length) return;
      const params = { ...(effect.values ?? {}) };
      const hooks = unit.mem.assaultModuleHooks;
      if (hooks?.active) {
        const moduleCtx = { battle, unit, body, piece: unit.def.raw.assaultPiece, rank: unit.def.raw.assaultPiece.star,
          cause: battle.assaultRuntime.currentCause, effect: { ...effect, values: params }, params, targets: [unit], hitCount: 0 };
        const overrides = hooks.beforeEffect(moduleCtx);
        if (overrides && typeof overrides === 'object') Object.assign(moduleCtx, overrides);
        Object.assign(params, moduleCtx.params ?? moduleCtx.effect?.values ?? params);
        hooks.afterEffect({ ...moduleCtx, result: params.healPerSec });
      }
      battle.heal(unit, unit, Number(v(unit, params.healPerSec)) * 5 * dt, { self: true, regen: true, regenSeconds: dt });
    }, { owner: unit });
    else if (event === 'tick') throw new Error(`missing periodic modePassive implementation for ${body.charId}:${index}`);
    else if (event === 'death' || event === 'kill' || event === 'blocked' || event === 'deviceTrigger' || event === 'goldSpent' || event === 'displaced' || event === 'skillEnd' || event === 'dodge')
      battle.on(event, (payload) => fire(payload, battle.assaultRuntime.currentCause), { owner: unit });
  }
}

function previewModuleEffect(battle, unit, source) {
  const effect = { ...source, values: { ...(source.values ?? {}) } };
  const body = unit.def.raw.assaultBody;
  const piece = unit.def.raw.assaultPiece;
  const ctx = { battle, unit, body, piece, rank: piece.star, effect, params: effect.values, targets: null, hitCount: 0 };
  const hooks = unit.mem.assaultModuleHooks;
  if (hooks?.active) Object.assign(ctx, hooks.beforeEffect(ctx) ?? {});
  return { ...ctx.effect, values: ctx.params ?? ctx.effect.values };
}

function effectiveSkillDPCost(battle, unit) {
  const body = unit.def.raw.assaultBody;
  return (body.fixedSkill.effects ?? []).filter((effect) => effect.action === 'spCost').reduce((sum, source) => {
    const cost = num(unit, previewModuleEffect(battle, unit, source).values.deployPointCost, 0);
    if (!(cost >= 1)) throw new RangeError(`invalid deploy-point cost for ${unit.def.charId}`);
    return sum + cost;
  }, 0);
}

function builder(charId) {
  return (battle, raw, def) => {
    if (def.charId !== charId || def.raw?.assaultBody?.charId !== charId) throw new Error(`assault KIT/body mismatch: ${charId}`);
    const kit = makeKit(def, {
      cast: (ctx) => {
        const dpCost = effectiveSkillDPCost(ctx.battle, ctx.unit);
        if (dpCost > 0 && (ctx.battle.getPlayer(ctx.unit.ownerId)?.dp ?? 0) < dpCost) return false;
        const moduleHooks = ctx.unit.mem.assaultModuleHooks;
        const effects = (ctx.body.fixedSkill.effects ?? []).filter((effect) => bazaarKeepsEffect(charId, effect));
        const moduleCtx = { ...ctx, params: Object.assign({}, ...effects.map((effect) => effect.values ?? {})),
          undeathDuration: effects.map((effect) => effect.values?.undeathDuration ?? effect.values?.duration).find((value) => value != null) };
        if (Array.isArray(moduleCtx.undeathDuration)) moduleCtx.undeathDuration = Number(v(ctx.unit, moduleCtx.undeathDuration));
        moduleHooks?.beforeCast(moduleCtx);
        try {
        if (charId === 'char_1001_amiya2') return castAmiyaGuard(ctx);
        if (charId === 'char_1037_amiya3') return castAmiyaMedic(ctx);
        const piece = ctx.unit.def.raw.assaultPiece;
        const moduleId = piece.moduleId ?? piece.moduleChoices?.[charId];
        if (charId === 'char_4145_ulpia' && effects.some((effect) => effect.action === 'move' && effect.values?.dashToAnchor != null)) {
          ctx.unit.mem.assaultLastSkillTargets = [];
          startUlpiaAnchor({ battle: ctx.battle, unit: ctx.unit, effects });
        }
        if (charId === 'char_127_estell' && piece.star >= 3 && moduleId === 'uniequip_002_estell') {
          const strike = effects.find((effect) => effect.action === 'damage');
          const hitCount = strike ? targetsFor(ctx.battle, ctx.unit, strike).length : 0;
          for (const source of effects) {
            const effect = { ...source, values: { ...(source.values ?? {}) } };
            if (effect.action === 'addBuff') effect.values.duration = num(ctx.unit, source.values.duration) + 2;
            execute({ battle: ctx.battle, unit: ctx.unit, effect, cause: ctx.cause, invocation: ctx });
          }
          if (hitCount >= 2) heal(ctx.battle, ctx.unit, ctx.unit, { maxHpRatio: moduleParam(ctx.unit, 'uniequip_002_estell', 'h', 5) / 100, sourceKey: `${charId}:module-hit-heal` });
          return;
        }
        if (charId === 'char_337_utage' && piece.star >= 3 && moduleId === 'uniequip_002_utage') {
          const lowHp = ctx.unit.hp / ctx.unit.s.maxHp < 0.5;
          for (const source of effects) {
            const effect = { ...source, values: { ...(source.values ?? {}) } };
            if (lowHp && effect.action === 'damage') effect.values.atkScale = num(ctx.unit, source.values.atkScale) * (1 + moduleParam(ctx.unit, 'uniequip_002_utage', 'x', 10) / 100);
            execute({ battle: ctx.battle, unit: ctx.unit, effect, cause: ctx.cause, invocation: ctx });
          }
          return;
        }
        if (charId === 'char_1033_swire2' && piece.star >= 3 && moduleId === 'uniequip_002_swire2') {
          const player = ctx.battle._pp?.(ctx.unit.ownerId);
          if (player) player.coins += 1;
        }
        if (charId === 'char_263_skadi' && moduleId === 'uniequip_002_skadi' && piece.star >= 3) {
          for (const source of effects) {
            const effect = { ...source, values: { ...(source.values ?? {}) } };
            const multiplier = 1 + moduleParam(ctx.unit, 'uniequip_002_skadi', 'x', 20) / 100; // 潮湿的剑袋：技能伤害与护盾 +x%
            if (effect.action === 'damage' && effect.values.atkScale != null)
              effect.values.atkScale = num(ctx.unit, source.values.atkScale) * multiplier;
            if (effect.action === 'heal' && effect.values.maxHpRatio != null)
              effect.values.maxHpRatio = num(ctx.unit, source.values.maxHpRatio) * multiplier;
            if (effect.action === 'addBuff' && effect.values.barrierRatio != null)
              effect.values.barrierRatio = num(ctx.unit, source.values.barrierRatio) * multiplier;
            execute({ battle: ctx.battle, unit: ctx.unit, effect, cause: ctx.cause, invocation: ctx });
          }
          return;
        }
        // Surtr's max-HP increase is part of the same instant skill as her full heal.
        // Apply it first so the heal fills the new maximum instead of leaving her
        // exactly one max-HP increment short.
      const orderedEffects = charId === 'char_1041_angel2'
          ? [...effects.filter((effect) => effect.action === 'targeting'), ...effects.filter((effect) => effect.action !== 'targeting')]
          : charId === 'char_4155_talr'
          ? [...effects.filter((effect) => effect.action === 'spCost'), ...effects.filter((effect) => effect.action !== 'spCost')]
          : charId === 'char_350_surtr'
          ? [...effects.filter((effect) => effect.action === 'addBuff'), ...effects.filter((effect) => effect.action !== 'addBuff')]
          : effects;
        const modeCastId = charId === 'char_2024_chyue' || charId === 'char_4058_pepe'
          ? (ctx.unit.mem.assaultModeSkillCastSeq = (ctx.unit.mem.assaultModeSkillCastSeq ?? 0) + 1) : null;
        if (modeCastId != null) ctx.unit.mem.assaultModeSkillCast = { id: modeCastId, kills: 0 };
        const angelSplashBonus = charId === 'char_1041_angel2' ? Math.max(0, Number(ctx.unit.mem.assaultAngelNextSplashBonus) || 0) : 0;
        let angelSplashBonusConsumed = false;
        const effectInvocation = charId === 'char_155_tiger' ? { ...ctx, tigerCast: { actualDamage: 0 } } : ctx;
        for (const effect of orderedEffects) {
          if (DEVICE_ONLY_CAST_BODIES.has(charId) && effect.action !== 'device') continue;
          if (charId === 'char_4145_ulpia' && effect.action === 'applyStatus') {
            const anchorHits = (ctx.unit.mem.assaultLastSkillTargets ?? []).filter(target => target?.alive);
            if (anchorHits.length) execute({ battle: ctx.battle, unit: ctx.unit, effect, targets: anchorHits,
              cause: ctx.cause, invocation: effectInvocation });
            continue;
          }
          if (charId === 'char_2024_chyue' && effect.values?.talentAtkScale != null) continue;
          if (charId === 'char_4082_qiubai' && effect.trigger === '命中处于停顿或束缚的敌人') {
            const controlledTargets = (ctx.unit.mem.assaultLastSkillTargets ?? []).filter((target) => target?.alive &&
              (target.findBuff?.('sluggish') || target.findBuff?.('bind') || target.s.flags.bind));
            if (controlledTargets.length) execute({ battle: ctx.battle, unit: ctx.unit, effect, targets: controlledTargets, cause: ctx.cause, invocation: ctx });
            continue;
          }
          if (charId === 'char_143_ghost' && effect.action === 'applyStatus' && effect.trigger === '不死状态结束') {
            const undeath = effects.find((candidate) => candidate.values?.undeathDuration != null);
            const duration = undeath ? num(ctx.unit, undeath.values.undeathDuration, 0) : 0;
            const generation = Number(ctx.unit.mem.assaultGhostUndeathGeneration ?? 0);
            if (duration > 0) ctx.battle.after(duration, () => {
              if (Number(ctx.unit.mem.assaultGhostUndeathGeneration ?? 0) !== generation) return;
              queue(ctx.battle, `assault:${charId}:undeath-finished:${uid(ctx.unit)}:${generation}`, ctx.unit,
                (rt, task) => execute({ battle: ctx.battle, unit: ctx.unit, effect, targets: [ctx.unit], cause: task.cause, invocation: ctx }), ctx.cause);
            }, { owner: ctx.unit });
            continue;
          }
          if (charId === 'char_1032_excu2' && (effect.action === 'growth' && effect.values?.atkPerAmmo != null || effect.action === 'damage' && effect.values?.finalAtkScale != null)) continue;
          if (charId === 'char_4037_demetr' && effect.action === 'damage' && effect.values?.prob != null) continue;
          if (charId === 'char_154_morgan' && effect.values?.extraAtkScale != null) continue;
          let typedEffect = charId === 'char_1028_texas2' && effect.action === 'damage' && effect.values?.atkScalePerSec != null
            ? { ...effect, values: { ...effect.values, interval: effect.values.interval ?? 1 } } : effect;
          if (angelSplashBonus > 0 && effect.action === 'damage' && effect.values?.splashRadius != null) {
            typedEffect = { ...effect, values: { ...effect.values, atkScale: num(ctx.unit, effect.values.atkScale) * (1 + angelSplashBonus) } };
            angelSplashBonusConsumed = Boolean(ctx.unit.mem.assaultAngelDropTile);
          }
          execute({ battle: ctx.battle, unit: ctx.unit, effect: typedEffect,
            targets: ['char_356_broca','char_140_whitew','char_294_ayer'].includes(charId) && effect.action === 'applyStatus' ? (ctx.unit.mem.assaultLastSkillTargets ?? [])
              : charId === 'char_1023_ghost2' && effect.values?.extraAtkScale != null ? (ctx.unit.mem.assaultLastSkillTargets ?? [])
              : charId === 'char_4064_mlynar' && effect.values?.extraTrueAtkScale != null ? (ctx.unit.mem.assaultLastSkillTargets ?? [])
              : charId === 'char_4058_pepe' && effect.action === 'applyStatus' ? ctx.unit.mem.assaultLastSkillTargets : null,
            cause: ctx.cause, invocation: effectInvocation });
        }
        if (modeCastId != null) {
          const modeCast = ctx.unit.mem.assaultModeSkillCast;
          ctx.unit.mem.assaultModeSkillCast = null;
          const passive = ctx.body.modePassives[0], kills = Math.max(0, Math.floor(modeCast?.kills ?? 0));
          // 佩佩: the bazaar line gives skill kills to adjacent operators (assault-bazaar.js); no self refund.
          const grant = charId === 'char_2024_chyue'
            ? (kills > 0 ? moduleParam(ctx.unit, 'uniequip_003_chyue', 'c', num(ctx.unit, passive.values.sp, 0)) : 0)
            : 0;
          if (grant > 0) queue(ctx.battle, `assault:${charId}:cast-kill-sp:${modeCastId}`, ctx.unit,
            (rt, task) => sp(ctx.battle, ctx.unit, ctx.unit, grant, `${charId}:cast-kill`, `${charId}:cast-kill:${modeCastId}`, task.cause), ctx.cause);
        }
        if (angelSplashBonusConsumed) ctx.unit.mem.assaultAngelNextSplashBonus = 0;
        if (charId === 'char_1028_texas2' && false) { // 大巴扎：施放后攻击力增益只来自模组 003（assault-bazaar.js）
          const passive = ctx.body.modePassives[0].components.find((part) => part.name === '施放后攻击力增益');
          const params = { ...passive.values }, postCastEffect = { action: 'addBuff', values: params };
          const postCastCtx = { battle: ctx.battle, unit: ctx.unit, body: ctx.body, piece, rank: piece.star, cause: ctx.cause,
            effect: postCastEffect, params, targets: [ctx.unit], hitCount: 0 };
          const overrides = moduleHooks?.beforeEffect(postCastCtx);
          if (overrides && typeof overrides === 'object') Object.assign(postCastCtx, overrides);
          const values = postCastCtx.params ?? postCastCtx.effect?.values ?? params;
          buff(ctx.battle, ctx.unit, ctx.unit, { key: `${charId}:post-skill-atk`, mods: { atkPct: num(ctx.unit, values.atkBonus) },
            duration: num(ctx.unit, values.duration), stacking: 'replace', cause: ctx.cause });
        }
        } finally {
          if (charId === 'char_173_slchan') ctx.unit.mem.assaultSlchanPullTargets = null;
          moduleCtx.hitCount = Number(ctx.unit.mem.assaultLastSkillTargetCount ?? 0);
          moduleHooks?.afterCast(moduleCtx);
          // Bazaar module lines that react to a resolved cast (e.g. "技能命中至少 N 名敌人时充能").
          for (const line of ctx.unit.mem.assaultAfterCastLines ?? []) line(moduleCtx);
        }
      },
      canCast: ({ battle: b, unit }) => {
        if (charId === 'char_474_glady') {
          const strike = unit.def.raw.assaultBody.fixedSkill.effects.find(effect => effect.action === 'damage');
          return strike ? targetsFor(b, unit, strike).length > 0 : false;
        }
        if (charId === 'char_173_slchan') {
          const pull = unit.def.raw.assaultBody.fixedSkill.effects.find(effect => effect.action === 'move');
          return targetsFor(b, unit, pull).length > 0;
        }
        const dpCost = effectiveSkillDPCost(b, unit);
        if (dpCost > 0 && (b.getPlayer(unit.ownerId)?.dp ?? 0) < dpCost) return false;
        // Mission Accomplished starts its ammo even without a delivery coordinate or in-range enemy.
        if (charId === 'char_1041_angel2') {
          const deliverable = b.allyUnits.some((ally) => ally !== unit && ally.ownerId === unit.ownerId &&
            (ally.alive && (ally.kind === 'op' || ally.kind === 'summon') || ally.downedWaiting));
          return deliverable || enemies(b, unit, { scope: 'range', count: 1 }).length > 0;
        }
        if (charId === 'char_1033_swire2' && (b._pp?.(unit.ownerId)?.coins ?? 0) < 1) return false;
        if (DEVICE_ONLY_CAST_BODIES.has(charId) && !deviceTile(b, unit) && charId !== 'char_1039_thorn2') return false;
        if (DEVICE_ONLY_CAST_BODIES.has(charId) && charId !== 'char_1039_thorn2') return true;
        if (charId === 'char_1037_amiya3') return enemies(b, unit, { scope: 'range', count: 1 }).length > 0 ||
          allies(b, unit, { scope: 'range', count: 99, operatorsOnly: true }).some((ally) => ally.hp < ally.s.maxHp);
        // A skill without damage that displaces enemies (push / pull) needs an enemy to move, like a damage effect.
        const skillEffects = unit.def.raw.assaultBody.fixedSkill.effects ?? [];
        const displaces = skillEffects.filter((effect) => effect.action === 'move');
        if (!skillEffects.some((effect) => effect.action === 'damage') && displaces.length
          && !displaces.some((effect) => targetsFor(b, unit, effect).length > 0)) return false;
        const demetrHunt = unit.def.raw.assaultBody.fixedSkill.effects?.find((effect) => effect.action === 'move' && effect.values?.maxDistance != null);
        return (unit.def.raw.assaultBody.fixedSkill.effects ?? []).every((effect) => effect.action !== 'damage'
          || (charId === 'char_4064_mlynar' && effect.values?.extraTrueAtkScale != null)
          || (charId === 'char_1023_ghost2' && effect.values?.extraAtkScale != null)
          || (charId === 'char_4037_demetr' && effect.values?.prob != null && demetrHunt
            && demetrRadiusTargets(b, unit, num(unit, demetrHunt.values.maxDistance, 4)).length > 0)
          || targetsFor(b, unit, charId === 'char_437_mizuki' ? previewModuleEffect(b, unit, effect) : effect).length > 0
          || ['heal','summon','device','growth','ammo'].includes(effect.action));
      },
      install: (b, unit) => installPassives(b, unit, unit.def.raw.assaultBody),
    });
    if (charId === 'char_4151_tinman') {
      const chargeEffect = def.raw.assaultBody.fixedSkill.effects?.find((effect) => effect.action === 'device' && effect.values?.charges != null);
      if (!chargeEffect) throw new TypeError('Tinman device skill requires compiled charge capacity');
      kit.skill.charges = Math.max(1, Math.floor(Number(v(def, chargeEffect.values.charges))));
    }
    return kit;
  };
}

export const assaultKits = Object.freeze(Object.fromEntries(IDS.map((id) => [id, builder(id)])));
