import { dirVec } from '../../../dir.js';
import {
  makeKit, v, rank, enemies, allies, damage, heal, buff, applyStatus, sp, haste, active, uid,
  queue, watch, onTimer as scheduleTimer, cooldowncost,
} from '../primitives.js';
import { installRangedBazaar, rangedLine, rangedModule } from './ranged-bazaar.js';
import { COLS } from '../../../constants.js';
import { grantSummon, fuseSummons, returnSummon, ledgerFor } from '../summons.js';
import { moduleHas, moduleLevel, selectedAdvancedModule, validateAllAdvancedModules } from './ranged-elite/modules.js';
import { rangedEliteTokenKits } from './ranged-elite/tokens.js';
import { assaultAmmoState, consumeAssaultAmmo, registerAssaultAmmo, reloadAssaultAmmo } from '../ammo.js';
import { slowShots, endShots } from '../../kits/ops/op-logos.js';
import { bodyInRadius } from '../../../body.js';
import { tileKeyOf } from '../../../targeting.js';
import { DUSK_SPLASH_RADIUS } from '../../kits/ops/chess_char_5_12-dusk.js';

const CHAR_IDS = Object.freeze([
  'char_430_fartth', 'char_4193_lemuen', 'char_391_rosmon', 'char_1035_wisdel', 'char_4117_ray',
  'char_213_mostma', 'char_4027_heyak', 'char_4133_logos', 'char_2015_dusk', 'char_472_pasngr',
  'char_426_billro', 'char_1046_sbell2', 'char_1038_whitw2', 'char_4146_nymph', 'char_1040_blaze2',
  'char_206_gnosis', 'char_291_aglina', 'char_358_lisa', 'char_1047_halo2', 'char_1012_skadi2',
  'char_4134_cetsyr', 'char_4202_haruka', 'char_2023_ling', 'char_4072_ironmn', 'char_245_cello',
]);

const TOKEN = Object.freeze({
  rosmon: 'token_10012_rosmon_shield', wisdel: 'token_10035_wisdel_wward', ray: 'token_10034_ray_sndbst',
  dusk: 'token_10015_dusk_drgn', skadi: 'token_10017_skadi2_dedant', ling1: 'token_10020_ling_soul1',
  ling2: 'token_10020_ling_soul2', ling3: 'token_10020_ling_soul3', pile1: 'token_10027_ironmn_pile1',
  pile2: 'token_10027_ironmn_pile2', pile3: 'token_10027_ironmn_pile3',
});

const BODY_TARGET = Object.freeze({
  char_430_fartth: 'lineFirst', char_4193_lemuen: 'rangeBomb', char_391_rosmon: 'range',
  char_1035_wisdel: 'groundRange', char_4117_ray: 'current', char_213_mostma: 'range',
  char_4027_heyak: 'lineFirst', char_4133_logos: 'rangeLimited', char_2015_dusk: 'range',
  char_472_pasngr: 'highestHp', char_426_billro: 'range', char_1046_sbell2: 'range',
  char_1038_whitw2: 'nearest', char_4146_nymph: 'currentAdjacent', char_1040_blaze2: 'range',
  char_206_gnosis: 'range', char_291_aglina: 'rangeLimited', char_358_lisa: 'range',
  char_1047_halo2: 'rangeLimited', char_1012_skadi2: 'range', char_4134_cetsyr: 'none',
  char_4202_haruka: 'allAllies', char_2023_ling: 'range', char_4072_ironmn: 'range',
  char_245_cello: 'nonBurst',
});

function onTimer(battle, unit, seconds, handler, options = {}) {
  if (active(unit)) return scheduleTimer(battle, unit, seconds, handler, options);
  let scheduled = null;
  let armed = true;
  const deferred = { cancel() { armed = false; scheduled?.(); } };
  battle.on('deploy', ({ unit: deployed }) => {
    if (!armed || deployed !== unit) return;
    scheduled = scheduleTimer(battle, unit, seconds, handler, options);
  });
  return deferred;
}

function bodyOf(raw, def, charId) {
  const body = raw?.assaultBody ?? def?.raw?.assaultBody;
  const piece = raw?.assaultPiece ?? def?.raw?.assaultPiece;
  if (!body || body.charId !== charId || !piece || piece.charId !== charId) throw new TypeError(`ranged-elite KIT/body mismatch: ${charId}`);
  validateAllAdvancedModules(body);
  return { body, piece };
}

function effect(body, index) {
  const value = body.fixedSkill?.effects?.[index];
  if (!value) throw new TypeError(`${body.charId} missing fixed effect ${index}`);
  return value;
}

function value(unit, values, key, fallback) {
  const source = values?.[key];
  if (source == null) throw new TypeError(`${unit?.def?.charId ?? 'ranged-elite'} compiled source parameter ${key} is missing`);
  return v(unit, source);
}

function talentParameters(body, nativeTalentIndex) {
  return body.talentBindings.find((entry) => entry.nativeTalentIndex === nativeTalentIndex)?.translation?.parameters ?? {};
}
function nativeSkillValues(body) {
  const source = body.source?.skills?.find((entry) => entry.skillId === body.fixedSkill?.sourceSkillId);
  return Object.fromEntries((source?.blackboard ?? []).map(({ key: name, value }) => [name, value]));
}

function key(charId, part) { return `assault:${charId}:${part}`; }

function payloadOf(event) { return event?.payload ?? event ?? {}; }

function listen(battle, unit, type, part, handler, priority = 0) {
  return battle.on(type, (event) => {
    if (!active(unit)) return;
    handler(payloadOf(event), event?.cause ?? battle.assaultRuntime?.currentCause ?? null);
  }, { owner: unit, priority });
}

function listenRuntime(battle, unit, type, part, handler, priority = 0) {
  const runtime = battle.assaultRuntime;
  if (!runtime) throw new Error(`assault runtime is required for ${type}`);
  const ownerKey = `${key(unit.def?.charId ?? unit.defId ?? 'assault', part)}:${uid(unit)}`;
  return runtime.observe(type, ownerKey, (event) => {
    if (!active(unit)) return;
    const payload = payloadOf(event);
    const target = payload.targetUid ?? payload.target ?? unit;
    runtime.enqueue(() => handler(payload, event?.cause ?? runtime.currentCause ?? null), {
      key: ownerKey,
      targetUid: target == null ? uid(unit) : (typeof target === 'string' || typeof target === 'number' ? String(target) : uid(target)),
      cause: event?.cause ?? runtime.currentCause ?? null,
      sourceUid: uid(unit),
    });
  }, { owner: unit, priority });
}

function rangeEnemies(battle, unit, count = 99, priority = 'exit') {
  return enemies(battle, unit, { scope: 'range', count, priority });
}

function ownerBlockedEnemies(battle, owner) {
  return battle.enemies.filter((target) => active(target)
    && target.blockedBy?.ownerUnit === owner && active(target.blockedBy));
}

function lineFirst(battle, unit, maxDistance = Infinity) {
  const [dr, dc] = dirVec(unit.dir);
  return rangeEnemies(battle, unit, 99, 'exit')
    .filter((target) => {
      const rr = target.y - unit.tileR, cc = target.x - unit.tileC;
      return rr * dc === cc * dr && rr * dr + cc * dc > 0 && rr * dr + cc * dc <= maxDistance;
    })[0] ?? null;
}

function currentTarget(battle, unit) { return rangeEnemies(battle, unit, 1)[0] ?? null; }

function adjacentEnemies(battle, unit, center) {
  return enemies(battle, center ?? unit, { scope: 'adjacent8', anchor: center ?? unit, count: 99 });
}

function applySlow(battle, unit, target, amount, duration, sourceKey, cause) {
  return applyStatus(battle, unit, target, { status: 'slow', duration, value: amount, key: sourceKey, cause });
}

function applyStun(battle, unit, target, duration, sourceKey, cause) {
  return applyStatus(battle, unit, target, { status: 'stun', duration, key: sourceKey, cause });
}

function applyLevitate(battle, unit, target, duration, sourceKey, cause) {
  return applyStatus(battle, unit, target, { status: 'levitate', duration, key: sourceKey, cause });
}

function skillTargets(battle, unit, targetMode) {
  switch (targetMode) {
    case 'lineFirst': return lineFirst(battle, unit) ? [lineFirst(battle, unit)] : [];
    case 'rangeBomb': return rangeEnemies(battle, unit, 99, 'exit');
    case 'blocked': return ownerBlockedEnemies(battle, unit);
    case 'groundRange': return rangeEnemies(battle, unit, 99).filter((target) => target.isFlying !== true);
    case 'current': return currentTarget(battle, unit) ? [currentTarget(battle, unit)] : [];
    case 'range': return rangeEnemies(battle, unit);
    case 'highestHp': return rangeEnemies(battle, unit, 99, 'hp').slice(-1);
    case 'nearest': return rangeEnemies(battle, unit, 1, 'nearest');
    case 'currentAdjacent': { const target = currentTarget(battle, unit); return target ? [target, ...adjacentEnemies(battle, unit, target)] : []; }
    case 'rangeLimited': return rangeEnemies(battle, unit);
    case 'nonBurst': return rangeEnemies(battle, unit).filter((target) => !target.s?.flags?.burstLock);
    case 'allAllies': return allies(battle, unit, { scope: 'range', count: 99 });
    case 'none': return [];
    default: throw new TypeError(`untyped ranged-elite target ${targetMode}`);
  }
}

function skillHasTarget(battle, unit, charId) {
  if (['char_2023_ling', 'char_4072_ironmn', 'char_4134_cetsyr'].includes(charId)) return rangeEnemies(battle, unit, 1).length > 0;
  if (charId === 'char_426_billro') return unit.hp < unit.s.maxHp || rangeEnemies(battle, unit).length > 0;
  if (charId === 'char_4202_haruka') return allies(battle, unit, { scope: 'range', count: 99 }).some((ally) => !ally.buffs?.some((entry) => entry.data?.harukaSkillBubble));
  return skillTargets(battle, unit, BODY_TARGET[charId]).length > 0;
}

function summon(battle, unit, tokenId, count, stockCap, fieldCap, ruleKey, extra = {}) {
  return grantSummon(battle, unit, { tokenId, count, stockCap, fieldCap, ruleKey, kit: rangedEliteTokenKits[tokenId], ...extra });
}


function trimSummons(battle, unit, tokenId, cap) {
  const live = battle.allyUnits.filter((candidate) => candidate.kind === 'token' && candidate.ownerUnit === unit && candidate.defId === tokenId && active(candidate));
  for (const old of live.slice(0, Math.max(0, live.length - cap + 1))) returnSummon(battle, unit, old, 'replaceOldest');
}

function addRangeField(battle, unit, { duration, interval = 1, key: fieldKey, tick, cause }) {
  unit.mem ??= {};
  unit.mem.rangedEliteFields ??= new Map();
  unit.mem.rangedEliteFields.get(fieldKey)?.cancel();
  let left = duration;
  const timer = battle.every(interval, () => {
    if (!active(unit) || left <= 0) { timer.cancel(); unit.mem.rangedEliteFields.delete(fieldKey); return; }
    tick();
    left -= interval;
  }, { owner: unit });
  unit.mem.rangedEliteFields.set(fieldKey, timer);
  battle.after(duration, () => { timer.cancel(); unit.mem.rangedEliteFields.delete(fieldKey); }, { owner: unit });
  return true;
}

function installStackBuff(battle, unit, name, maxStacks, perStack, stat = 'atkMul') {
  unit.mem ??= {};
  const next = Math.min(maxStacks, (unit.mem[name] ?? 0) + 1);
  unit.mem[name] = next;
  buff(battle, unit, unit, { key: key(unit.def.charId, name), mods: { [stat]: stat.endsWith('Mul') ? 1 + perStack * next : perStack * next }, duration: Infinity, stacking: 'replace' });
  return next;
}

function applyModuleState(unit, module) {
  unit.mem ??= {};
  unit.mem.rangedEliteModule = module?.id ?? null;
  unit.mem.rangedEliteModuleStar4 = !!module?.fourStar;
}

function moduleValue(module, rank3, rank4 = rank3) { return moduleLevel(module, rank3, rank4); }
function moduleParameter(module, name) {
  if (!module) return 0;
  const parameter = module?.plan?.translation?.parameters?.[name];
  if (parameter == null) throw new TypeError(`${module.id} module parameter ${name} is missing from the compiled plan`);
  if (!Number.isFinite(parameter)) throw new TypeError(`${module.id} module parameter ${name} must be finite`);
  return parameter;
}

function fixedDamage(battle, unit, target, scale, type, sourceKey, cause, options = {}) {
  if (!target || !active(target)) return 0;
  return damage(battle, unit, target, { scale, type, isSkill: true, sourceKey, cause, ...options });
}

function fixedElementDamage(battle, unit, target, scale, element, sourceKey, cause) {
  if (!target || !active(target) || !(scale > 0)) return 0;
  return battle.assaultRuntime.withCause(cause, () => battle.dealDamage(unit, target, {
    amount: unit.s.atk * scale, type: 'element', element, isSkill: true, attackId: sourceKey, canDodge: false,
  }));
}

function fixedElementalDamage(battle, unit, target, scale, element, sourceKey, cause) {
  if (!target || !active(target) || !(scale > 0)) return 0;
  return battle.assaultRuntime.withCause(cause, () => battle.dealDamage(unit, target, {
    amount: unit.s.atk * scale, type: 'elemental', element, isSkill: true, attackId: sourceKey, canDodge: false,
  }));
}

function castFartth({ battle, unit, body, module, cause }) {
  const [dr, dc] = dirVec(unit.dir);
  const target = battle.enemies.filter(active).filter((enemy) => {
    const rr = enemy.y - unit.tileR, cc = enemy.x - unit.tileC;
    return rr * dc === cc * dr && rr * dr + cc * dc > 0;
  }).sort((a, b) => ((a.y - unit.tileR) * dr + (a.x - unit.tileC) * dc) - ((b.y - unit.tileR) * dr + (b.x - unit.tileC) * dc))[0] ?? null;
  if (!target) return false;
  // bazaar: 对前方直线首个敌人造成 a% 物理伤害（攻击范围外的倍率已删去）；「首战支援套组」：光羽箭伤害 +a%。
  const scale = rangedLine(unit, 0, 'a') / 100 * (1 + rangedModule(unit, 'uniequip_002_fartth', 'a', 0) / 100);
  return fixedDamage(battle, unit, target, scale, 'phys', key(body.charId, 'skill:0'), cause, { canDodge: false }) > 0;
}

function castLemuen({ battle, unit, body, module, cause }) {
  const e = effect(body, 0).values;
  // 「弹匣与花窗」：轰炸伤害 +a%，目标 +1。
  const moduleBonus = rangedModule(unit, 'uniequip_002_lemuen', 'a', null);
  const max = value(unit, e, 'maxTarget', 1) + (moduleBonus == null ? 0 : 1);
  const mul = 1 + (moduleBonus ?? 0) / 100;
  const targets = rangeEnemies(battle, unit, max);
  let did = false;
  for (const center of targets) {
    for (const target of [center, ...adjacentEnemies(battle, unit, center)]) {
      if (!active(target)) continue;
      const scale = (target === center ? value(unit, e, 'centerAtkScale', 1) : value(unit, e, 'aoeAtkScale', 1)) * mul;
      did = fixedDamage(battle, unit, target, scale, 'phys', key(body.charId, 'skill:0'), cause) > 0 || did;
    }
  }
  return did;
}

function castRosmon({ battle, unit, body, module, cause }) {
  const values = effect(body, 0).values, target = rangeEnemies(battle, unit, 1)[0];
  if (!target) return false;
  const radius = Math.max(0, Number(unit.profile?.splashRadius ?? 0));
  const targets = new Set([target, ...(radius > 0 ? battle.foesInRadius(target.x, target.y, radius)
    .filter((victim) => bodyInRadius(victim, target.x, target.y, radius) && !victim.isFlying) : [])]);
  // bazaar: 对目标及周围敌人造成 a% 法术伤害和 150% 物理伤害（主击与余震合并，余震晕眩已删去）。
  // 「记事」：技能伤害 +a%；「迷迭香特限证章」：技能无视 p 防御（卡面未写的天赋穿透已不再叠加）。
  const defIgnoreFlat = rangedModule(unit, 'uniequip_003_rosmon', 'p', 0);
  const mul = 1 + rangedModule(unit, 'uniequip_002_rosmon', 'a', 0) / 100;
  void values;
  let did = false;
  for (const victim of targets) {
    if (!active(victim)) continue;
    did = fixedDamage(battle, unit, victim, 1.5 * mul, 'phys', key(body.charId, 'skill:baseAttack'), cause, { defIgnoreFlat }) > 0 || did;
    if (!victim.alive) continue;
    did = fixedDamage(battle, unit, victim, rangedLine(unit, 0, 'a') / 100 * mul, 'arts', key(body.charId, 'skill:extraArts'), cause, { defIgnoreFlat }) > 0 || did;
  }
  return did;
}

function castWisdel({ battle, unit, body, cause }) {
  // bazaar: 对攻击范围内地面敌人造成 3 次 a% 物理伤害，晕眩 s 秒（「祖宗发射器」：多 1 次，伤害 +a%）。
  const targets = rangeEnemies(battle, unit).filter((target) => !target.isFlying);
  if (!targets.length) return false;
  const moduleBonus = rangedModule(unit, 'uniequip_002_wisdel', 'a', null);
  const hits = 3 + (moduleBonus == null ? 0 : 1);
  const scale = rangedLine(unit, 0, 'a') / 100 * (1 + (moduleBonus ?? 0) / 100);
  for (const target of targets) {
    for (let i = 0; i < hits && target.alive; i++) fixedDamage(battle, unit, target, scale, 'phys', key(body.charId, `skill:aftershock:${i}`), cause);
    if (target.alive) applyStun(battle, unit, target, rangedLine(unit, 0, 's', 1), key(body.charId, 'skill:stun'), cause);
  }
  return true;
}

function detonateWisdel(battle, unit, target, body, cause, procBonus = 0) {
  unit.mem ??= {};
  const marked = unit.mem.wisdelRemnants?.has(uid(target));
  const probability = Math.min(1, value(unit, body.modePassives[0]?.values ?? {}, 'prob', 0.15) + procBonus);
  if (!marked || battle.rng() >= probability) return false;
  const e = body.modePassives[0].values;
  for (const victim of [target, ...adjacentEnemies(battle, unit, target)]) {
    fixedDamage(battle, unit, victim, value(unit, e, 'atkScale', 1.2), 'phys', key(body.charId, 'mode:remnantDetonation'), cause);
    applyStun(battle, unit, victim, value(unit, e, 'stun', 0.5), key(body.charId, 'mode:remnantStun'), cause);
  }
  return true;
}

function castRay({ battle, unit, body, module, cause }) {
  const values = effect(body, 0).values, ammo = assaultAmmoState(unit);
  const target = currentTarget(battle, unit);
  if (!target || !ammo || ammo.current < 1) return false;
  // 《跳舞的月光》：技能命中束缚 r 秒（不再召唤沙兽）。
  const bindSeconds = rangedModule(unit, 'uniequip_002_ray', 'r', 0);
  if (consumeAssaultAmmo(battle, unit, 1, key(body.charId, 'skill:ammo'), { isSkill: true }) !== 1) return false;
  const before = target.alive;
  const did = fixedDamage(battle, unit, target, value(unit, values, 'atkScale', 4.5), 'phys', key(body.charId, 'skill:specialShot'), cause) > 0;
  if (did && target.alive) battle.push(target, value(unit, values, 'force', 2), { from: unit, effect: true });
  if (did && bindSeconds > 0 && target.alive) {
    applyStatus(battle, unit, target, { status: 'bind', duration: bindSeconds, key: key(body.charId, 'skill:moduleBind'), cause });
  }
  void before; void ammo; // bazaar: 击倒装填改为任意击倒（installRay）。
  return did;
}

function castMostma({ battle, unit, body, module, cause }) {
  const e0 = effect(body, 0).values, e1 = effect(body, 1).values;
  const i = rank(unit) - 1, targets = rangeEnemies(battle, unit);
  if (!targets.length) return false;
  for (const target of targets) {
    // 「锁与匙之家」：晕眩 +1 秒，伤害 +a%。
    const moduleBonus = rangedModule(unit, 'uniequip_002_mostma', 'a', null);
    fixedDamage(battle, unit, target, value(unit, e0, 'atkScale', [3.6, 3.9, 4.2, 4.65][i]) * (1 + (moduleBonus ?? 0) / 100), 'arts', key(body.charId, 'skill:instantDamage'), cause);
    applyStun(battle, unit, target, value(unit, e1, 'duration', [6, 6.5, 7, 7.5][i]) + (moduleBonus == null ? 0 : 1), key(body.charId, 'skill:stun'), cause);
  }
  return true;
}

function castHeyak({ battle, unit, body, module, cause }) {
  const values = effect(body, 0).values, control = effect(body, 1).values;
  // 「图书馆」：技能伤害 +a%，浮空 +0.3 秒（「特限证章」的对空增伤在 installHeyak，对全部伤害生效）。
  const moduleBonus = rangedModule(unit, 'uniequip_002_heyak', 'a', null);
  const targets = rangeEnemies(battle, unit, value(unit, values, 'maxTarget', 2));
  if (!targets.length) return false;
  for (const target of targets) {
    const scale = value(unit, values, 'atkScale', 3) * (1 + (moduleBonus ?? 0) / 100);
    fixedDamage(battle, unit, target, scale, 'arts', key(body.charId, 'skill:twoTarget'), cause);
  }
  if (targets.length === 1) applyLevitate(battle, unit, targets[0], value(unit, control, 'duration', 4) + (moduleBonus == null ? 0 : 0.3), key(body.charId, 'skill:levitate'), cause);
  return true;
}

function castLogos({ battle, unit, body, module, cause }) {
  const e = effect(body, 0).values;
  // 「来自河谷的笔盒」：技能目标 +1，压制 +1 秒。
  const module2 = moduleHas(module, 'uniequip_002_logos') ? 1 : 0;
  const targets = rangeEnemies(battle, unit, value(unit, e, 'maxTarget', 3) + module2);
  let did = false;
  for (const target of targets) did = fixedDamage(battle, unit, target, value(unit, e, 'atkScale', 2.2), 'arts', key(body.charId, 'skill:damage'), cause) > 0 || did;
  const duration = value(unit, body.fixedSkill.effects[1]?.values ?? {}, 'duration', 6) + module2;
  unit.mem.logosFieldDuration = duration;
  startLogosField(battle, unit,
    value(unit, body.fixedSkill.effects[1]?.values ?? {}, 'projectileMoveScale', 0.05), duration,
    value(unit, body.fixedSkill.effects[1]?.values ?? {}, 'clearOnEnd', true));
  return did;
}

function startLogosField(battle, unit, moveScale, duration, clearOnEnd) {
  unit.mem ??= {};
  let field = unit.mem.logosField;
  if (!field) {
    field = { timer: null, expiry: null, finish: null, endAt: 0 };
    field.finish = (clear) => {
      if (unit.mem.logosField !== field) return;
      unit.mem.logosField = null;
      field.timer?.cancel();
      field.expiry?.cancel();
      endShots(battle, unit, clear);
    };
    field.timer = battle.every(0.1, () => {
      if (!active(unit)) { field.finish(false); return; }
      slowShots(battle, unit, moveScale);
    }, { owner: unit });
    unit.mem.logosField = field;
  }
  field.expiry?.cancel();
  field.endAt = battle.time + duration;
  slowShots(battle, unit, moveScale);
  field.expiry = battle.after(duration, () => field.finish(clearOnEnd && unit.s.flags.disarm !== true), { owner: unit });
}

function stopLogosField(unit) {
  unit.mem?.logosField?.finish(false);
}

function castDusk({ battle, unit, body, module, cause }) {
  const target = currentTarget(battle, unit);
  if (!target) return false;
  const victims = new Set([target, ...battle.foesInRadius(target.x, target.y, DUSK_SPLASH_RADIUS).filter((victim) => bodyInRadius(victim, target.x, target.y, DUSK_SPLASH_RADIUS))]);
  // 「无题长卷」：技能伤害 +a%（满层增伤已删去）。
  const mul = 1 + rangedModule(unit, 'uniequip_002_dusk', 'a', 0) / 100;
  for (const victim of victims) fixedDamage(battle, unit, victim, value(unit, effect(body, 0).values, 'atkScale', 2.5) * mul, 'arts', key(body.charId, 'skill:splashAttack'), cause);
  return true;
}

function castPasngr({ battle, unit, body, module, cause }) {
  const e = effect(body, 0).values, target = rangeEnemies(battle, unit, 99, 'hp').at(-1);
  if (!target) return false;
  const duration = value(unit, e, 'duration', 4);
  // 「电磁调节器」：雷暴伤害 +a%，连锁 +1 名；「异客特限证章」：连锁目标 +n（不再延长雷暴、不再改连锁衰减）。
  const stormBonus = rangedModule(unit, 'uniequip_002_pasngr', 'a', null);
  addRangeField(battle, unit, { duration, interval: value(unit, e, 'interval', 0.5), key: key(body.charId, 'skill:storm'), cause, tick: () => {
    const victims = rangeEnemies(battle, unit, value(unit, e, 'chainMaxTarget', 4) + (stormBonus == null ? 0 : 1) + rangedModule(unit, 'uniequip_004_pasngr', 'n', 0), 'uid');
    let scale = value(unit, e, 'atkScale', 1.3) * (1 + (stormBonus ?? 0) / 100);
    for (const victim of victims) { fixedDamage(battle, unit, victim, scale, 'arts', key(body.charId, 'skill:storm:hit'), cause); applySlow(battle, unit, victim, value(unit, e, 'sluggish', 0.5), 0.6, key(body.charId, 'skill:storm:slow'), cause); scale *= 0.85; }
  }});
  return true;
}

function castBillro({ battle, unit, body, module, cause }) {
  const values = effect(body, 0).values;
  // 「风信子与匕首」：技能治疗最大生命再 +h%（不再加深减速、不再加护盾）。
  const ratio = value(unit, values, 'healMaxHpRatio', [0.4, 0.45, 0.5, 0.6][rank(unit) - 1]) + rangedModule(unit, 'uniequip_002_billro', 'h', 0) / 100;
  const didHeal = heal(battle, unit, unit, { maxHpRatio: ratio, cause }) > 0;
  let did = didHeal;
  for (const target of rangeEnemies(battle, unit)) {
    did = fixedDamage(battle, unit, target, value(unit, values, 'atkScale', [1.5, 1.7, 1.9, 2.2][rank(unit) - 1]), 'arts', key(body.charId, 'skill:damage'), cause) > 0 || did;
    applySlow(battle, unit, target, value(unit, values, 'slow', 0.4), value(unit, values, 'slowDuration', 0.3), key(body.charId, 'skill:slow'), cause);
  }
  const shieldRatio = value(unit, values, 'selfShieldRatio', [0.2, 0.25, 0.3, 0.35][rank(unit) - 1])
    + rangedModule(unit, 'uniequip_003_billro', 's', 0) / 100; // bazaar: 「乡音」：技能护盾再 +最大生命 s%
  battle.addBuff(unit, { key: key(body.charId, 'skill:shield'), shield: unit.s.maxHp * shieldRatio, source: unit, visible: true, data: { cause } });
  return did || shieldRatio > 0;
}

function castSbell({ battle, unit, body, module, cause }) {
  const values = effect(body, 0).values, cold = effect(body, 1).values, push = effect(body, 2).values, targets = rangeEnemies(battle, unit);
  if (!targets.length) return false;
  const [dr, dc] = dirVec(unit.dir), snow = value(unit, push, 'snowForwardTiles', 5), snowTiles = new Set();
  const module2 = moduleHas(module, 'uniequip_002_sbell2');
  for (const target of targets) {
    fixedDamage(battle, unit, target, value(unit, values, 'atkScale', 5.2), 'arts', key(body.charId, 'skill:instantDamage'), cause);
    applyStatus(battle, unit, target, { status: 'cold', duration: value(unit, cold, 'duration', 3.5)
      + moduleValue(module2 ? module : null, 0.5, 0.5), key: key(body.charId, 'skill:instantCold'), cause });
    battle.push(target, value(unit, push, 'force', 1), { from: unit, effect: true });
    for (let n = 1; n <= snow; n++) snowTiles.add((unit.tileR + dr * n) * COLS + unit.tileC + dc * n);
  }
  unit.mem.sbellSnowTiles = [...snowTiles];
  return true;
}

function castWhitw({ battle, unit, body, module, cause }) {
  const values = effect(body, 0).values, i = rank(unit) - 1, targets = rangeEnemies(battle, unit, 4, 'nearest');
  if (!targets.length) return false;
  // 「狼时」：狼影 +1 道，恐惧再 +f 秒（不再加法术倍率）。
  const fearBonus = rangedModule(unit, 'uniequip_002_whitw2', 'f', null);
  const wolfCount = 2 + (fearBonus == null ? 0 : 1);
  const availableTargets = rangeEnemies(battle, unit, wolfCount * 2, 'nearest');
  const scale = value(unit, values, 'artsScale', [1, 1.1, 1.15, 1.2][i]);
  for (let wolf = 0; wolf < wolfCount; wolf++) for (const target of availableTargets.slice(wolf * 2, wolf * 2 + 2)) {
    fixedDamage(battle, unit, target, scale, 'arts', key(body.charId, `skill:wolf:${wolf}:hit`), cause);
    applyStatus(battle, unit, target, { status: 'fear', duration: value(unit, values, 'fear', [2, 2, 2.5, 3][i]) + (fearBonus ?? 0), key: key(body.charId, 'skill:wolf:fear'), cause });
    // bazaar: 狼影周围八邻减速已删去；在场 t 秒后，狼影命中时沉默敌人 s 秒。
    if (unit.mem.whitwSilence && target.alive) applyStatus(battle, unit, target, { status: 'silence', duration: rangedLine(unit, 2, 's'), key: key(body.charId, 'skill:wolf:silence'), cause });
  }
  return true;
}

function castNymph({ battle, unit, body, module, cause }) {
  const e0 = effect(body, 0).values, e1 = effect(body, 1).values, e2 = effect(body, 2).values;
  const target = currentTarget(battle, unit); if (!target) return false;
  let did = false;
  for (const victim of [target, ...adjacentEnemies(battle, unit, target)]) {
    // 「心声」：技能伤害 +a%，凋亡损伤 +3%。
    const moduleBonus = rangedModule(unit, 'uniequip_002_nymph', 'a', null);
    did = fixedDamage(battle, unit, victim, value(unit, e0, 'atkScale', 3) * (1 + (moduleBonus ?? 0) / 100), 'arts', key(body.charId, 'skill:damage'), cause) > 0 || did;
    fixedElementDamage(battle, unit, victim, value(unit, e1, 'epDamageRatio', 0.22) + (moduleBonus == null ? 0 : 0.03), 'apoptosis', key(body.charId, 'skill:decay'), cause);
    applyStatus(battle, unit, victim, { status: 'cold', duration: 1, key: key(body.charId, 'skill:ep'), cause });
  }
  void e2; // bazaar: 主目标恐惧已删去。
  return did;
}

function castBlaze({ battle, unit, body, module, cause }) {
  const ally = allies(battle, unit, { scope: 'range', count: 99 }).sort((a, b) => b.s.maxHp - a.s.maxHp || uid(a).localeCompare(uid(b)))[0];
  if (!ally) return false;
  const values = effect(body, 0).values, i = rank(unit) - 1;
  const blazeModule = moduleHas(module, 'uniequip_002_blaze2') ? module : null;
  // 「热切的期盼」：附火持续 +3 秒，灼燃损伤 +a%（不再加法术倍率）。
  const duration = value(unit, values, 'duration', 20) + (blazeModule ? 3 : 0), interval = value(unit, values, 'interval', 1);
  const scale = value(unit, values, 'atkScale', 0.7);
  const elementRatio = value(unit, values, 'elementMultiplier', 0.3) + rangedModule(unit, 'uniequip_002_blaze2', 'a', 0) / 100, radius = value(unit, values, 'radius', 1.5);
  let elapsed = 0, timer;
  timer = battle.every(interval, () => {
    if (!active(ally) || elapsed >= duration) { timer.cancel(); return; }
    elapsed += interval;
    for (const target of battle.enemiesInRadius(ally.x, ally.y, radius, true).filter(active)) {
      const dealt = fixedDamage(battle, unit, target, scale, 'arts', key(body.charId, 'skill:supportBurn'), cause);
      if (dealt > 0 && elementRatio > 0) battle.assaultRuntime.withCause(cause, () => battle.dealDamage(unit, target, { amount: dealt * elementRatio, type: 'element', element: 'burn', isSkill: true, sourceKey: key(body.charId, 'skill:supportBurn:element') }));
    }
  }, { owner: ally });
  return true;
}

function castGnosis({ battle, unit, body, module, cause }) {
  // bazaar: 对攻击范围内的敌人造成 a% 法术伤害，并施加 t 秒寒冷（「誓言」：改为 a 秒）。
  const e1 = effect(body, 1).values;
  const coldDuration = rangedModule(unit, 'uniequip_002_gnosis', 'a', rangedLine(unit, 0, 't'));
  let did = false;
  for (const target of rangeEnemies(battle, unit)) {
    did = fixedDamage(battle, unit, target, rangedLine(unit, 0, 'a') / 100, 'arts', key(body.charId, 'skill:damage'), cause) > 0 || did;
    applyStatus(battle, unit, target, { status: 'cold', duration: coldDuration, value: value(unit, e1, 'slow', 0.4), key: key(body.charId, 'skill:cold'), cause });
  }
  return did;
}

function castAglina({ battle, unit, body, module, cause }) {
  const e0 = effect(body, 0).values, e1 = effect(body, 1).values;
  // 「重力校准模块」：失重 +a 秒，主动伤害 +15%（不再加目标）；「特限证章」的对失重增伤在 installAglina。
  const gravity = rangedModule(unit, 'uniequip_002_aglina', 'a', null);
  for (const target of battle.enemies.filter(active)) applyLevitate(battle, unit, target, value(unit, e0, 'duration', 6) + (gravity ?? 0), key(body.charId, 'skill:levitate'), cause);
  let did = false;
  for (const target of rangeEnemies(battle, unit, value(unit, e1, 'maxTarget', 5))) {
    const scale = value(unit, e1, 'atkScale', 1.05) * (gravity == null ? 1 : 1.15);
    did = fixedDamage(battle, unit, target, scale, 'arts', key(body.charId, 'skill:damage'), cause) > 0 || did;
  }
  unit.mem.aglinaSkillActiveUntil = battle.time;
  return did || battle.enemies.some(active);
}

function castLisa({ battle, unit, body, module, cause }) {
  const values = effect(body, 0).values, i = rank(unit) - 1, targets = rangeEnemies(battle, unit);
  if (!targets.length) return false;
  // 「怀中御守」：主动停顿 +a 秒（不再加治疗、不再扩治疗范围）。
  const duration = value(unit, values, 'statusDuration', [6, 7, 8, 9][i]) + rangedModule(unit, 'uniequip_002_lisa', 'a', 0);
  const scale = value(unit, values, 'allyHealAtkScale', [0.66, 0.78, 0.96, 1.2][i]);
  for (const target of targets) applyStatus(battle, unit, target, { status: 'sluggish', duration, key: key(body.charId, 'skill:instantStop'), cause });
  const healTargets = allies(battle, unit, { scope: 'range', count: 99 });
  for (const ally of healTargets) heal(battle, unit, ally, { scale, cause });
  return true;
}

function castHalo({ battle, unit, body, module, cause }) {
  const hit = effect(body, 0).values, link = effect(body, 1).values;
  const targets = rangeEnemies(battle, unit, 99).sort((a, b) =>
    Math.hypot(b.x - unit.x, b.y - unit.y) - Math.hypot(a.x - unit.x, a.y - unit.y) || uid(a).localeCompare(uid(b)))
    .slice(0, value(unit, hit, 'maxTarget', 2));
  if (!targets.length) return false;
  // 「探索者的收藏」只加攻速层数上限（ranged-bazaar.js），不再改联动目标与倍率。
  for (const anchor of targets) {
    fixedDamage(battle, unit, anchor, value(unit, hit, 'atkScale', 1.45), 'arts', key(body.charId, 'skill:anchor'), cause);
    const radius = value(unit, link, 'radius', 2);
    const splash = enemies(battle, unit, { scope: 'field', count: 99, priority: 'uid' })
      .filter((target) => target !== anchor && bodyInRadius(target, anchor.x, anchor.y, radius))
      .slice(0, value(unit, link, 'maxTarget', 3));
    for (const target of splash) {
      fixedDamage(battle, unit, target, value(unit, link, 'atkScale', 1.45), 'arts', key(body.charId, 'skill:linkDamage'), cause);
      battle.pull(target, value(unit, link, 'force', 1), { to: anchor, source: unit });
    }
  }
  return true;
}

function castSkadi({ battle, unit, body, module, cause }) {
  const values = effect(body, 0).values, i = rank(unit) - 1, targets = rangeEnemies(battle, unit);
  if (!targets.length) return false;
  let did = false;
  // 「蜕化的残迹」：主动真实伤害 +a%（不再加治疗）。
  const mul = 1 + rangedModule(unit, 'uniequip_002_skadi2', 'a', 0) / 100;
  for (const target of targets) did = fixedDamage(battle, unit, target, value(unit, values, 'enemyTrueScale', [1.65, 1.8, 1.95, 2.1][i]) * mul, 'true', key(body.charId, 'skill:instantDamage'), cause) > 0 || did;
  // bazaar: 自身失去当前生命 10% 已删去。
  for (const ally of allies(battle, unit, { scope: 'range', count: 99 })) heal(battle, unit, ally, { scale: value(unit, values, 'allyHealAtkScale', [0.8, 0.9, 1, 1.1][i]), cause });
  return did || targets.length > 0;
}

function castCetsyr({ battle, unit, body, module, cause }) {
  // 「故事的结局」：主动改为 n 名敌人，伤害 +a%（不再加束缚）。
  const values = effect(body, 0).values;
  const moduleTargets = rangedModule(unit, 'uniequip_002_cetsyr', 'n', null);
  const extra = moduleTargets == null ? 0 : Math.max(0, moduleTargets - value(unit, values, 'consumeCap', 6));
  const targets = rangeEnemies(battle, unit, value(unit, values, 'consumeCap', 6) + extra, 'nearest');
  if (!targets.length) return false;
  const cap = value(unit, values, 'stockCap', 6) + extra;
  unit.mem.cetsyrDust = Math.min(cap, (unit.mem.cetsyrDust ?? 0) + value(unit, values, 'gain', 6) + extra);
  const count = Math.min(value(unit, values, 'consumeCap', 6) + extra, unit.mem.cetsyrDust, targets.length);
  const mul = 1 + rangedModule(unit, 'uniequip_002_cetsyr', 'a', 0) / 100;
  for (const target of targets.slice(0, count)) {
    unit.mem.cetsyrDust--;
    fixedDamage(battle, unit, target, value(unit, values, 'damageScale', 3) * mul, 'true', key(body.charId, 'skill:dust:hit'), cause);
    applyStatus(battle, unit, target, { status: 'bind', duration: value(unit, values, 'bind', 3), key: key(body.charId, 'skill:dust:root'), cause });
  }
  return count > 0;
}

function castHaruka({ battle, unit, body, module, cause }) {
  const ally = allies(battle, unit, { scope: 'range', count: 99 }).find((candidate) => !candidate.buffs?.some((entry) => entry.data?.harukaSkillBubble));
  if (!ally) return false;
  for (const bubble of [...(ally.buffs ?? [])]) if (bubble.data?.rangedEliteBubble && bubble.data?.ownerUid === uid(unit)) battle.removeBuff(ally, bubble);
  const ratio = value(unit, effect(body, 0).values, 'shieldRatio', 0.3); // 「迟来的纪念」只加庇护（installHaruka）
  battle.addBuff(ally, { key: key(body.charId, `skill:bubble:${uid(ally)}`), shield: Math.max(1, ally.s.maxHp * ratio), mods: { dmgTakenMul: Math.max(0, 1 - ratio) }, visible: true, source: unit, data: { rangedEliteBubble: true, harukaSkillBubble: true, breakOnDamage: true, ownerUid: uid(unit), counterUses: 1 } });
  return true;
}

function castLing({ battle, unit, body, module, cause }) {
  const nativeSkill = body.source?.skills?.find((entry) => entry.skillId === body.fixedSkill?.sourceSkillId);
  const tokenId = nativeSkill?.overrideTokenKey;
  if (!tokenId || !rangedEliteTokenKits[tokenId]) throw new TypeError(`${body.charId} selected S2 but has no native ranged summon template`);
  const summonValues = effect(body, 2).values;
  const lingModule = moduleHas(module, 'uniequip_002_ling') ? module : null;
  // bazaar: 补充 1 只召唤物；召唤物各对 2 名敌人造成 a% 法术伤害，束缚 t 秒（本体不再单独出手）。
  // 「诗短梦长」：召唤物上限 +1，主动伤害 +a%。
  const cap = value(unit, summonValues, 'stockCap', [2, 2, 3, 3][rank(unit) - 1]) + moduleValue(lingModule, 1, 1);
  const scale = rangedLine(unit, 0, 'a') / 100 * (1 + rangedModule(unit, 'uniequip_002_ling', 'a', 0) / 100);
  const granted = summon(battle, unit, tokenId, 1, cap, 2, key(body.charId, 'skill:s2Summon')).granted > 0;
  const summons = battle.allyUnits.filter((candidate) => candidate.kind === 'token' && candidate.ownerUnit === unit && candidate.defId === tokenId && active(candidate));
  for (const actor of summons) for (const target of enemies(battle, actor, { scope: 'range', count: 2 })) {
    fixedDamage(battle, unit, target, scale, 'arts', key(body.charId, 'skill:s2Strike'), cause);
    applyStatus(battle, unit, target, { status: 'bind', duration: rangedLine(unit, 0, 't', 3), key: key(body.charId, 'skill:s2Bind'), cause });
  }
  for (const token of summons) if (token.hp / token.s.maxHp < 0.5) returnSummon(battle, unit, token, 'lingS2HalfHealth');
  return granted || summons.length > 0;
}

function castIronmn({ battle, unit, body, module, cause }) {
  const values = effect(body, 0).values;
  const module2 = moduleHas(module, 'uniequip_002_ironmn') ? module : null;
  const module3 = moduleHas(module, 'uniequip_003_ironmn') ? module : null;
  const fieldCap = value(unit, values, 'fieldCap', 2) + moduleParameter(module3, 'fieldCapBonus');
  const devices = battle.allyUnits.filter((candidate) => candidate.kind === 'token' && candidate.ownerUnit === unit && candidate.defId === TOKEN.pile2 && active(candidate));
  const result = summon(battle, unit, TOKEN.pile2, 1, value(unit, values, 'stockCap', 3), fieldCap, key(body.charId, 'skill:summon'), { ranged: false });
  let did = result.granted > 0;
  // bazaar: 对攻击范围内的敌人造成 a% 物理伤害（「铁钳号·爬行者」：+a%），并获得 1 个支援装置。
  const scale = rangedLine(unit, 0, 'a') / 100 * (1 + rangedModule(unit, 'uniequip_002_ironmn', 'a', 0) / 100);
  for (const target of rangeEnemies(battle, unit)) did = fixedDamage(battle, unit, target, scale, 'phys', key(body.charId, 'skill:damage'), cause) > 0 || did;
  void devices; void module2;
  // bazaar: 当此干员施放技能时，你的装置为周围干员充能 b（装置周围八格的干员，各一次）。
  const yourDevices = battle.allyUnits.filter((candidate) => candidate.kind === 'token' && candidate.defId === TOKEN.pile2 && candidate.ownerId === unit.ownerId && active(candidate));
  const charged = new Set();
  for (const device of yourDevices) for (const ally of battle.allyUnits) {
    if (charged.has(ally) || ally.kind !== 'op' || ally.ownerId !== unit.ownerId || !active(ally)) continue;
    if (Math.max(Math.abs(ally.tileR - device.tileR), Math.abs(ally.tileC - device.tileC)) > 1) continue;
    charged.add(ally);
    sp(battle, unit, ally, rangedLine(unit, 1, 'b'), key(body.charId, 'skill:charge'), key(body.charId, 'skill:charge'), cause);
    did = true;
  }
  return did;
}

function ironmnChargeGap(skill) {
  if (!skill || skill.spType !== 'time' || !Number.isFinite(skill.maxCharges) || !Number.isFinite(skill.spCost)) return 0;
  const capacity = skill.maxCharges * skill.spCost, total = skill.spTotal;
  return Number.isFinite(capacity) && Number.isFinite(total) ? Math.max(0, capacity - total) : 0;
}

function ironmnSpRecipient(battle, unit, device) {
  if (!device) return null;
  const [dr, dc] = dirVec(unit.dir);
  const preferred = battle.allyUnits.find((ally) => ally.kind === 'op' && ally.tileR === device.tileR + dr && ally.tileC === device.tileC + dc);
  const candidates = allies(battle, unit, { scope: 'field', count: 99 }).filter((ally) => ally !== unit && ally.kind === 'op'
    && Math.max(Math.abs(ally.tileR - device.tileR), Math.abs(ally.tileC - device.tileC)) <= 1 && ironmnChargeGap(ally.skill) > 0);
  const formationOrder = (ally) => battle.allyUnits.indexOf(ally);
  return ironmnChargeGap(preferred?.skill) > 0 ? preferred
    : candidates.sort((a, b) => ironmnChargeGap(b.skill) - ironmnChargeGap(a.skill) || formationOrder(a) - formationOrder(b))[0] ?? null;
}

function canCastIronmn(battle, unit, body) {
  if (rangeEnemies(battle, unit, 1).length) return true;
  const ledger = ledgerFor(battle, unit), ruleKey = key(body.charId, 'skill:summon');
  const source = ledger.sources.get(`${TOKEN.pile2}:${ruleKey}`);
  const stockCap = source?.stockCap ?? value(unit, effect(body, 0).values, 'stockCap', 3);
  if ((ledger.stock.get(TOKEN.pile2) ?? 0) < stockCap) return true;
  const device = battle.allyUnits.find((candidate) => candidate.kind === 'token' && candidate.ownerUnit === unit
    && candidate.defId === TOKEN.pile2 && active(candidate));
  if (!device) return false;
  return device.hp < device.s.maxHp || !!ironmnSpRecipient(battle, unit, device);
}

function castCello({ battle, unit, body, module, cause }) {
  const e0 = effect(body, 0).values, e1 = effect(body, 1).values;
  const target = skillTargets(battle, unit, 'nonBurst')[0];
  if (!target) return false;
  const did = fixedDamage(battle, unit, target, value(unit, e0, 'atkScale', 2.4), 'arts', key(body.charId, 'skill:damage'), cause) > 0;
  // 「强弱法」：主动改为施加 a% 凋亡损伤（不再多 1 次充能、不再加场地凋亡）。
  const moduleDecay = rangedModule(unit, 'uniequip_002_cello', 'a', null);
  unit.mem.celloDecayScale = moduleDecay == null ? value(unit, e1, 'epDamageRatio', 0.95) : moduleDecay / 100;
  fixedElementDamage(battle, unit, target, unit.mem.celloDecayScale, 'apoptosis', key(body.charId, 'skill:decay'), cause);
  return did;
}

function castCard(charId, ctx, module) {
  switch (charId) {
    case 'char_430_fartth': return castFartth({ ...ctx, module });
    case 'char_4193_lemuen': return castLemuen({ ...ctx, module });
    case 'char_391_rosmon': return castRosmon({ ...ctx, module });
    case 'char_1035_wisdel': return castWisdel({ ...ctx, module });
    case 'char_4117_ray': return castRay({ ...ctx, module });
    case 'char_213_mostma': return castMostma({ ...ctx, module });
    case 'char_4027_heyak': return castHeyak({ ...ctx, module });
    case 'char_4133_logos': return castLogos({ ...ctx, module });
    case 'char_2015_dusk': return castDusk({ ...ctx, module });
    case 'char_472_pasngr': return castPasngr({ ...ctx, module });
    case 'char_426_billro': return castBillro({ ...ctx, module });
    case 'char_1046_sbell2': return castSbell({ ...ctx, module });
    case 'char_1038_whitw2': return castWhitw({ ...ctx, module });
    case 'char_4146_nymph': return castNymph({ ...ctx, module });
    case 'char_1040_blaze2': return castBlaze({ ...ctx, module });
    case 'char_206_gnosis': return castGnosis({ ...ctx, module });
    case 'char_291_aglina': return castAglina({ ...ctx, module });
    case 'char_358_lisa': return castLisa({ ...ctx, module });
    case 'char_1047_halo2': return castHalo({ ...ctx, module });
    case 'char_1012_skadi2': return castSkadi({ ...ctx, module });
    case 'char_4134_cetsyr': return castCetsyr({ ...ctx, module });
    case 'char_4202_haruka': return castHaruka({ ...ctx, module });
    case 'char_2023_ling': return castLing({ ...ctx, module });
    case 'char_4072_ironmn': return castIronmn({ ...ctx, module });
    case 'char_245_cello': return castCello({ ...ctx, module });
    default: throw new TypeError(`unhandled ranged-elite charId ${charId}`);
  }
}

function installFartth(battle, unit, body, module) {
  unit.mem ??= {};
  unit.mem.fartthLastDamageAt = battle.time;
  listen(battle, unit, 'damaged', 'fartth-hit-reset', (payload) => { if (payload.target === unit && payload.amount > 0) unit.mem.fartthLastDamageAt = battle.time; });
  onTimer(battle, unit, 0.25, () => {
    // bazaar: 10 秒内未受伤时，+a% 攻击力；「支持者来信」：再 +a%（不再缩短等待、不再无视防御）。
    const delay = 10;
    const bonus = (rangedLine(unit, 1, 'a') + rangedModule(unit, 'uniequip_003_fartth', 'a', 0)) / 100;
    if (battle.time - unit.mem.fartthLastDamageAt >= delay) buff(battle, unit, unit, { key: key(body.charId, 'mode:focus'), mods: { atkMul: 1 + bonus }, duration: 0.4, stacking: 'replace' });
    else battle.removeBuff(unit, key(body.charId, 'mode:focus'));
  }, { every: true, immediate: true });
  buff(battle, unit, unit, { key: key(body.charId, 'talent:taunt'), mods: { taunt: -1 }, duration: Infinity, stacking: 'replace' });
  listen(battle, unit, 'hit', 'fartth-dodge', (payload) => { if (payload.source === unit && payload.dmg) payload.dmg.canDodge = false; }, 100);
}

function installLemuen(battle, unit) {
  // bazaar: 你的拉特兰干员对精英与首领敌人的伤害 +a%（去掉停留 N 秒后通缉，在场即生效）。
  listen(battle, unit, 'hit', 'lemuen-elite', (payload) => {
    const source = payload.source, target = payload.target;
    if (!payload.dmg || !target || target.side !== 'enemy' || source?.side !== 'ally' || source.kind !== 'op' || source.ownerId !== unit.ownerId) return;
    if ((source.def?.raw?.assaultBody ?? source.def?.assaultBody)?.nationId !== 'laterano') return;
    const eligible = target.elite === true || target.isElite === true || target.rank === 'elite' || target.isBoss === true || target.isLeader === true;
    if (eligible) payload.dmg.amount *= 1 + rangedLine(unit, 1, 'a') / 100;
  }, 100);
}

function installRosmon(battle, unit, body, module) {
  unit.mem ??= {};
  const retarget = () => {
    const casters = battle.allyUnits.filter((candidate) => candidate.kind === 'op' && candidate !== unit && active(candidate) && candidate.def?.profession === 'CASTER')
      .sort((a, b) => (a.deploySeq ?? 0) - (b.deploySeq ?? 0));
    const selected = casters.length ? casters[Math.floor(battle.rng() * casters.length)] : null;
    if (unit.mem.rosmonCaster && unit.mem.rosmonCaster !== selected) battle.removeBuff(unit.mem.rosmonCaster, key(body.charId, 'mode:caster'));
    unit.mem.rosmonCaster = selected;
    if (selected) {
      const bonus = value(unit, body.modePassives[0]?.values ?? {}, 'atk', 0.08);
      buff(battle, unit, unit, { key: key(body.charId, 'mode:self'), mods: { atkMul: 1 + bonus }, duration: 0.6, stacking: 'replace' });
      buff(battle, unit, selected, { key: key(body.charId, 'mode:caster'), mods: { atkMul: 1 + bonus }, duration: 0.6, stacking: 'replace' });
    }
  };
  onTimer(battle, unit, 0.5, retarget, { every: true, immediate: true });
  listen(battle, unit, 'hit', 'rosmon-physical-dodge', (payload) => { if (payload.source === unit && payload.dmg?.type === 'phys') payload.dmg.canDodge = false; }, 100);
}

function installWisdel() {
  // bazaar: 残影标记与余震引爆改为「当攻击范围内的敌人获得晕眩时，对其造成 b% 物理伤害」 (ranged-bazaar.js).
}

function installRay(battle, unit, body, module) {
  unit.mem ??= {};
  unit.trait ??= {};
  unit.trait.ammo = 8;
  // bazaar: 巡哨伙伴的增伤改为「攻击范围内的敌人受到你的狙击干员的物理伤害 +a%」 (ranged-bazaar.js).
  unit.mem.rayDamageScale = 0;
  registerAssaultAmmo(battle, unit, { get: () => unit.trait.ammo, set: (next) => { unit.trait.ammo = next; }, max: () => 8 });
  const profile = unit.profile;
  const originalCanAttack = profile?.canAttack;
  const originalAfterAttack = profile?.afterAttack;
  let noAmmoAttack = false;
  battle.on('attack', ({ attacker, noAmmo = false }) => { if (attacker === unit) noAmmoAttack = noAmmo; }, { owner: unit, priority: 1000 });
  if (profile) {
    profile.canAttack = (b, actor) => {
      if ((assaultAmmoState(actor)?.current ?? 0) <= 0) {
        if (!actor.mem.rayReloading) {
          actor.mem.rayReloading = true;
          const interval = Math.max(0.05, Number(actor.base?.bat) || 1.6);
          actor.atkCd = interval;
          b.after(interval, () => {
            if (!active(actor) || !actor.mem.rayReloading) return;
            reloadAssaultAmmo(b, actor, actor, 1, key(body.charId, 'trait:reload'));
            actor.mem.rayReloading = false;
          }, { owner: actor });
        }
        return false;
      }
      return originalCanAttack ? originalCanAttack(b, actor) : true;
    };
    profile.afterAttack = (b, actor, targets) => {
      originalAfterAttack?.(b, actor, targets);
      if (!noAmmoAttack) consumeAssaultAmmo(b, actor, 1, key(body.charId, 'trait:attack'));
      noAmmoAttack = false;
    };
  }
  battle.on('deploy', ({ unit: deployed }) => {
    if (deployed === unit) unit.trait.ammo = assaultAmmoState(unit)?.capacity ?? 8;
  }, { owner: unit });
  // bazaar: 当此干员击倒敌人时，装填 r 发弹药。
  listenRuntime(battle, unit, 'kill', 'ray-kill-reload', (payload) => {
    if (payload.source !== unit || payload.target?.side !== 'enemy') return;
    reloadAssaultAmmo(battle, unit, unit, rangedLine(unit, 2, 'r'), key(body.charId, 'mode:killReload'));
  });
  unit.mem.rayLastTarget = null;
  unit.mem.rayStacks = 0;
  listen(battle, unit, 'attack', 'ray-same-target', (payload) => {
    const target = (payload.targets ?? [])[0];
    if (!target || target.side !== 'enemy') return;
    const maxStacks = value(unit, talentParameters(body, 1), 'maxStacks', 3);
    unit.mem.rayStacks = target === unit.mem.rayLastTarget ? Math.min(maxStacks, unit.mem.rayStacks + 1) : 1;
    unit.mem.rayLastTarget = target;
    const per = value(unit, talentParameters(body, 1), 'atkPerStack', 0.08);
    buff(battle, unit, unit, { key: key(body.charId, 'talent:focus'), mods: { atkMul: 1 + per * unit.mem.rayStacks, aspd: 0 }, duration: Infinity, stacking: 'replace' });
  });
  // 「证明什么？」：+a% 攻击力（不再改专注层数与满层攻速）。
  const moduleAtk = rangedModule(unit, 'uniequip_003_ray', 'a', 0);
  if (moduleAtk > 0) {
    const applyModuleAtk = () => buff(battle, unit, unit, { key: key(body.charId, 'module:atk'), mods: { atkMul: 1 + moduleAtk / 100 }, duration: Infinity, persist: true, stacking: 'replace' });
    if (active(unit)) applyModuleAtk();
    listen(battle, unit, 'deploy', 'module:atk', (payload) => { if (payload.unit === unit) applyModuleAtk(); });
  }
}

function installMostma(battle, unit, body, module) {
  // bazaar: 术师技力光环改为「当此干员施放技能时，加速你的术师干员」 (ranged-bazaar.js)；
  // 「资深万国信使定制斗篷」只改加速秒数，不再扩范围、不再加深减速。
  listen(battle, unit, 'hit', 'mostma-slow', (payload) => {
    if (payload.source !== unit || payload.target?.side !== 'enemy') return;
    applySlow(battle, unit, payload.target, 0.15, 1.1, key(body.charId, 'mode:slow'), battle.assaultRuntime.currentCause);
  });
}

function installHeyak(battle, unit, body, module) {
  unit.mem ??= {};
  unit.mem.heyakWeightless = new Set();
  // 「羽蛇的时间博物馆」：失重改为生命高于 h% 的敌人（不再延长失重、不再增伤）。
  const moduleThreshold = rangedModule(unit, 'uniequip_003_heyak', 'h', null);
  onTimer(battle, unit, 0.25, () => {
    const threshold = moduleThreshold == null ? value(unit, body.modePassives[0]?.values ?? {}, 'hpRatio', 0.8) : moduleThreshold / 100;
    for (const target of rangeEnemies(battle, unit)) {
      if (target.hp / target.s.maxHp > threshold) {
        unit.mem.heyakWeightless.add(uid(target));
      } else unit.mem.heyakWeightless.delete(uid(target));
    }
  }, { every: true, immediate: true });
  listen(battle, unit, 'hit', 'heyak-weightless', (payload) => {
    if (payload.source !== unit || !unit.mem.heyakWeightless?.has(uid(payload.target)) || !payload.dmg) return;
    const duration = value(unit, body.modePassives[0]?.values ?? {}, 'levitateDuration', 1);
    applyLevitate(battle, unit, payload.target, duration, key(body.charId, 'mode:weightless'), battle.assaultRuntime.currentCause);
  }, 100);
  // 「霍尔海雅特限证章」：对空中敌人伤害 +a%。
  const antiAir = rangedModule(unit, 'uniequip_004_heyak', 'a', 0);
  if (antiAir > 0) listen(battle, unit, 'hit', 'heyak-anti-air', (payload) => {
    const target = payload.target;
    if (payload.source !== unit || target?.side !== 'enemy' || !payload.dmg || !(target.isFlying || target.s?.flags?.levitate)) return;
    payload.dmg.mul = (payload.dmg.mul ?? 1) * (1 + antiAir / 100);
  }, 90);
}

function installLogos(battle, unit, body, module) {
  unit.mem ??= {};
  battle.on('retreating', ({ unit: exiting }) => { if (exiting === unit) stopLogosField(unit); }, { owner: unit });
  battle.on('death', ({ unit: exiting }) => { if (exiting === unit) stopLogosField(unit); }, { owner: unit });
  battle.on('battleEnd', () => stopLogosField(unit), { owner: unit });
  listen(battle, unit, 'attack', 'logos-soul-rend', (payload) => {
    if (payload.attacker !== unit) return;
    for (const target of payload.targets ?? []) if (target.side === 'enemy') {
      const vals = body.modePassives[0]?.values ?? {};
      const resDown = value(unit, vals, 'magicResDown', 10);
      const add = value(unit, vals, 'atkAddition', 150) + rangedModule(unit, 'uniequip_003_logos', 'f', 0);
      buff(battle, unit, target, { key: `${key(body.charId, 'mode:soulRend')}:${uid(target)}`, mods: { resFlat: -resDown }, duration: value(unit, vals, 'duration', 5), stacking: 'replace' });
      battle.addBuff(target, { key: `${key(body.charId, 'mode:soulRend:arts')}:${uid(target)}`, mods: { artsTakenMul: 1.01 }, duration: value(unit, vals, 'duration', 5), source: unit, data: { rangedEliteArtsAdd: add } });
    }
  });
  listen(battle, unit, 'hit', 'logos-soul-rend-add', (payload) => {
    const marker = payload.target?.buffs?.find((entry) => String(entry.key).startsWith(key(body.charId, 'mode:soulRend:arts')));
    if (payload.source?.side === 'ally' && payload.dmg?.type === 'arts' && marker?.data?.rangedEliteArtsAdd) payload.dmg.amount += marker.data.rangedEliteArtsAdd;
  }, 100);
  listen(battle, unit, 'hit', 'logos-lexicon', (payload) => {
    const talent = talentParameters(body, 0);
    const chance = value(unit, talent, 'prob', 0.4); // bazaar: 《语义范式百科》不再提高语汇概率/伤害
    if (payload.source !== unit || payload.target?.side !== 'enemy' || !payload.dmg || !Number.isInteger(payload.dmg.attackId) || battle.rng() >= chance) return;
    const attackId = payload.dmg.attackId;
    const cause = battle.assaultRuntime.currentCause;
    queue(battle, `${key(body.charId, 'talent:lexicon')}:${attackId}`, payload.target, () => {
      if (!active(unit)) return;
      const candidates = rangeEnemies(battle, unit);
      if (!candidates.length) return;
      const primary = candidates[Math.floor(battle.rng() * candidates.length)];
      const targets = [primary];
      if (false) targets.push(...rangeEnemies(battle, unit, 99, 'uid').filter((target) => target !== primary).slice(0, 1));
      for (const target of targets) {
        fixedDamage(battle, unit, target, value(unit, talent, 'atkScale', 0.6), 'arts', key(body.charId, 'talent:lexicon'), cause);
        applySlow(battle, unit, target, value(unit, talent, 'sluggish', 0.8), value(unit, body.fixedSkill.effects[1]?.values ?? {}, 'duration', 6), key(body.charId, 'talent:lexicon:slow'), cause);
      }
    }, cause);
  }, 100);
}

function installDusk(battle, unit, body, module) {
  unit.mem ??= {};
  unit.mem.duskStacks = 0;
  unit.mem.duskFullArts = false;
  const module2 = moduleHas(module, 'uniequip_002_dusk');
  const module3 = moduleHas(module, 'uniequip_003_dusk');
  const module4 = moduleHas(module, 'uniequip_004_dusk');
  unit.mem.duskTokenAtk = 0; // bazaar: 「夕特限证章」改为「你的召唤物 +a% 攻击力」 (ranged-bazaar.js).
  unit.mem.duskModuleDeathBurst = 0; // bazaar: 证章的召唤物死亡爆炸已删去。
  void module3; void module4;
  let firstAttackSummonGranted = false;
  listen(battle, unit, 'attack', 'dusk-first-attack-summon', (payload) => {
    if (payload.attacker !== unit || firstAttackSummonGranted || !(payload.targets ?? []).some((target) => target?.side === 'enemy')) return;
    firstAttackSummonGranted = true;
    // 「无题长卷」：小自在持续 +5 秒（不再多召唤 1 只）。
    const count = 1;
    const duration = 15 + (module2 ? 5 : 0);
    summon(battle, unit, TOKEN.dusk, count, count, count, key(body.charId, 'talent:firstAttackSummon'), { duration });
  });
  listen(battle, unit, 'kill', 'dusk-growth', (payload) => {
    const killer = payload.killer;
    // bazaar: 当此干员或召唤物击倒敌人时，本场战斗中 +a% 攻击力（最多 n 层）；「终夜无寐」：上限 +n 层。
    if (killer !== unit && !(killer?.kind === 'token' && killer.side === 'ally' && killer.ownerId === unit.ownerId)) return;
    const max = rangedLine(unit, 1, 'n') + rangedModule(unit, 'uniequip_003_dusk', 'n', 0);
    unit.mem.duskStacks = Math.min(max, unit.mem.duskStacks + 1);
    const per = rangedLine(unit, 1, 'a') / 100;
    buff(battle, unit, unit, { key: key(body.charId, 'mode:growth'), mods: { atkMul: 1 + unit.mem.duskStacks * per }, duration: Infinity, stacking: 'replace' });
    unit.mem.duskFullArts = false;
  });
}

function installPasngr(battle, unit, body, module) {
  unit.mem ??= {};
  unit.mem.pasngrAnalysisTargets = new Map();
  unit.mem.pasngrAnalysisScale = value(unit, body.modePassives[0]?.values ?? {}, 'damageScale', 1.1) + moduleValue(moduleHas(module, 'uniequip_003_pasngr') ? module : null, 0.05, 0.05);
  unit.mem.pasngrAnalysisDuration = value(unit, body.modePassives[0]?.values ?? {}, 'duration', 3) + moduleValue(moduleHas(module, 'uniequip_003_pasngr') ? module : null, 1, 1);
  const highHpThreshold = value(unit, talentParameters(body, 0), 'hpRatio');
  onTimer(battle, unit, 0.25, () => {
    const empty = enemies(battle, unit, { scope: 'adjacent4', count: 1 }).length === 0;
    const bonus = (rangedLine(unit, 1, 'a') + rangedModule(unit, 'uniequip_003_pasngr', 'a', 0)) / 100;
    if (empty) buff(battle, unit, unit, { key: key(body.charId, 'mode:empty'), mods: { atkMul: 1 + bonus }, duration: 0.4, stacking: 'replace' });
    else battle.removeBuff(unit, key(body.charId, 'mode:empty'));
  }, { every: true, immediate: true });
  void highHpThreshold; // bazaar: 命中高生命敌人后的增伤已删去。
}

function installBillro() {
  // bazaar: 技力溢出回技改为「当你的干员获得护盾时，为此干员充能 c」 (ranged-bazaar.js).
}

function installSbell(battle, unit, body, module) {
  unit.mem ??= {};
  unit.mem.sbellSnow = { interval: value(unit, body.modePassives[0]?.values ?? {}, 'interval', 10), layers: 0, max: value(unit, body.modePassives[0]?.values ?? {}, 'maxLayers', 5) + rangedModule(unit, 'uniequip_002_sbell2', 'n', 0), scale: value(unit, body.modePassives[0]?.values ?? {}, 'atkScale', 0.2), moveSpeed: value(unit, body.modePassives[0]?.values ?? {}, 'moveSpeedPerLayer', 0.1) };
  onTimer(battle, unit, unit.mem.sbellSnow.interval, () => {
    unit.mem.sbellSnow.layers = Math.min(unit.mem.sbellSnow.max, unit.mem.sbellSnow.layers + 1);
    for (const target of rangeEnemies(battle, unit)) if (target.isFlying !== true && unit.mem.sbellSnow.layers > 0) {
      fixedDamage(battle, unit, target, unit.mem.sbellSnow.scale * unit.mem.sbellSnow.layers, 'arts', key(body.charId, 'mode:snow:damage'), battle.assaultRuntime.currentCause);
      applySlow(battle, unit, target, unit.mem.sbellSnow.moveSpeed * unit.mem.sbellSnow.layers, 1.1, key(body.charId, 'mode:snow:slow'), battle.assaultRuntime.currentCause);
    }
  }, { every: true });
}

function installWhitw(battle, unit, body) {
  // bazaar: 开战时，为你的叙拉古干员充能 c。
  battle.on('battleStart', () => {
    for (const ally of battle.allyUnits.filter((candidate) => candidate.kind === 'op' && candidate.ownerId === unit.ownerId && candidate.skill
      && (candidate.def?.raw?.assaultBody ?? candidate.def?.assaultBody)?.nationId === 'siracusa')) sp(battle, unit, ally, rangedLine(unit, 1, 'c'), 'whitw2Initial', key(body.charId, 'talent:initialSp'));
  }, { owner: unit });
  // bazaar: 在场 t 秒后，狼影命中时沉默敌人 s 秒（头狼三段升级只保留命中沉默）。
  unit.mem.whitwSilence = false;
  battle.on('deploy', ({ unit: deployed }) => {
    if (deployed !== unit) return;
    unit.mem.whitwSilence = false;
    battle.after(rangedLine(unit, 2, 't', 30), () => { if (active(unit)) unit.mem.whitwSilence = true; }, { owner: unit });
  }, { owner: unit });
}

function installNymph(battle, unit, body, module) {
  unit.mem ??= {};
  unit.mem.nymphBurstTargets = new Map();
  listen(battle, unit, 'elementBurst', 'nymph-burst-damage', (payload, cause) => {
    const target = payload.target;
    if (!target || target.side !== 'enemy' || !rangeEnemies(battle, unit).includes(target)) return;
    const durationCap = 1;
    const end = battle.time + durationCap;
    unit.mem.nymphBurstTargets.set(uid(target), end);
    const timer = battle.every(1, () => {
      if (!active(unit) || !active(target) || !target.s?.flags?.burstLock || battle.time > end + 1e-9) { timer.cancel(); unit.mem.nymphBurstTargets.delete(uid(target)); return; }
      // 攻击凋亡爆发中的敌人时，每秒额外造成 b% 元素伤害；「烦恼问诊匣」：该元素伤害 +a%。
      fixedElementalDamage(battle, unit, target, rangedLine(unit, 2, 'b') / 100 * (1 + rangedModule(unit, 'uniequip_003_nymph', 'a', 0) / 100), 'apoptosis', key(body.charId, 'mode:burst'), cause);
    }, { owner: unit });
    unit.mem.nymphBurstTargets.set(uid(target), { end, timer });
  });
  listen(battle, unit, 'elementBurst', 'nymph-growth', (payload) => {
    // bazaar: 当敌人发生凋亡爆发时，本场战斗中 +a% 攻击力（最多 n 层）（全场任意爆发）。
    if (!payload.target || payload.target.side !== 'enemy') return;
    installStackBuff(battle, unit, 'nymphBurstStacks', rangedLine(unit, 1, 'n'), rangedLine(unit, 1, 'a') / 100);
  });
}

function installBlaze(battle, unit, body, module) {
  const talent = talentParameters(body, 1);
  let reviveTimer = null;
  listen(battle, unit, 'elementBurst', 'blaze-melting-point', (payload, cause) => {
    if (payload.target?.side !== 'enemy') return;
    fixedElementalDamage(battle, unit, payload.target, value(unit, body.modePassives[0]?.values ?? {}, 'epDamageScale', 2.5), 'burn', key(body.charId, 'mode:burst'), cause);
    heal(battle, unit, unit, { maxHpRatio: value(unit, body.modePassives[0]?.values ?? {}, 'hpRatio', 0.06), cause });
  });
  listen(battle, unit, 'kill', 'blaze-revive', () => {
    if (unit.hp > 0 || unit.mem.blazeDowned) return;
    unit.mem.blazeDowned = true;
    unit.hp = 1;
    battle.addBuff(unit, { key: key(body.charId, 'talent:barrier'), shield: value(unit, talent, 'barrier', 6000), duration: Infinity, source: unit, flags: { disarm: true, noHeal: true }, persist: true });
    reviveTimer = onTimer(battle, unit, 1, () => {
      if (!unit.mem.blazeDowned || !active(unit)) { reviveTimer?.cancel?.(); return; }
      const recovery = value(unit, talent, 'hpRecoveryRatio', 0.03);
      unit.hp = Math.min(unit.s.maxHp, unit.hp + unit.s.maxHp * recovery);
      if (unit.hp < unit.s.maxHp) return;
      unit.mem.blazeDowned = false;
      battle.removeBuff(unit, key(body.charId, 'talent:barrier'));
      // 「沟通小助手」改为再部署加攻（ranged-bazaar.js），不再改复苏回复、晕眩与复苏后加攻。
      const stun = value(unit, talent, 'stun', 5);
      for (const target of adjacentEnemies(battle, unit)) applyStun(battle, unit, target, stun, key(body.charId, 'talent:reviveStun'));
      reviveTimer?.cancel?.();
    }, { every: true });
  });
}

function installGnosis(battle, unit, body, module) {
  // bazaar: 攻击范围内寒冷的敌人受到的伤害 +b%，冻结的敌人翻倍（「一号项目模型」：再 +a%）。
  // 「当敌人获得寒冷时，前方干员……」在 ranged-bazaar.js。
  onTimer(battle, unit, 0.25, () => {
    for (const target of battle.enemies.filter(active)) {
      if (!unit.rangeKeySet?.has(tileKeyOf(target)) || !(target.s?.flags?.cold || target.s?.flags?.freeze)) continue;
      const pct = (rangedLine(unit, 1, 'b') + rangedModule(unit, 'uniequip_003_gnosis', 'a', 0)) / 100;
      buff(battle, unit, target, { key: `${key(body.charId, 'mode:fragile')}:${uid(target)}`, mods: { dmgTakenMul: 1 + pct * (target.s?.flags?.freeze ? 2 : 1) }, duration: 0.4, stacking: 'replace' });
    }
  }, { every: true, immediate: true });
}

function installAglina(battle, unit, body, module) {
  onTimer(battle, unit, 0.5, () => {
    // bazaar: 攻速光环改为「攻击范围内的干员 +b 攻速」 (ranged-bazaar.js)；再生在场常驻。
    for (const ally of battle.allyUnits.filter(active)) heal(battle, unit, ally, { amount: value(unit, body.modePassives[1]?.values ?? {}, 'hpPerSec', 20), regen: true });
  }, { every: true, immediate: true });
  // 「安洁莉娜特限证章」：对失重的敌人 +a% 伤害（此干员的全部伤害）。
  const vsLevitate = rangedModule(unit, 'uniequip_004_aglina', 'a', 0);
  if (vsLevitate > 0) listen(battle, unit, 'hit', 'aglina-levitate-bonus', (payload) => {
    if (payload.source !== unit || payload.target?.side !== 'enemy' || !payload.dmg || !payload.target.s?.flags?.levitate) return;
    payload.dmg.mul = (payload.dmg.mul ?? 1) * (1 + vsLevitate / 100);
  }, 90);
}

function installLisa(battle, unit, body, module) {
  // bazaar: 辅助技力光环改为「当此干员施放技能时，加速你的辅助干员」 (ranged-bazaar.js).
  // bazaar: 攻击范围内停顿的敌人受到的伤害 +c%（停顿期间生效）；「孩子们」：再 +a%。
  const stopped = (target) => target.buffs?.some((entry) => entry.status === 'sluggish' || entry.status === 'slow');
  onTimer(battle, unit, 0.25, () => {
    for (const target of rangeEnemies(battle, unit)) {
      if (!stopped(target)) continue;
      const pct = (rangedLine(unit, 2, 'c') + rangedModule(unit, 'uniequip_003_lisa', 'a', 0)) / 100;
      buff(battle, unit, target, { key: `${key(body.charId, 'mode:fragile')}:${uid(target)}`, mods: { dmgTakenMul: 1 + pct }, duration: 0.4, stacking: 'replace' });
    }
  }, { every: true, immediate: true });
}

function installHalo(battle, unit, body, module) {
  unit.mem ??= {};
  const linkKey = key(body.charId, 'skill:linkPropagation');
  listen(battle, unit, 'hit', 'halo-link-propagation', (payload, cause) => {
    const source = payload.target, dmg = payload.dmg;
    if (!source || !dmg || dmg.type !== 'arts' || cause?.visited?.some((entry) => entry.key === linkKey)) return;
    const links = [...(unit.mem.haloLinks?.values() ?? [])].filter((entry) => entry.until > battle.time && active(entry.target));
    const from = links.find((entry) => entry.target === source);
    if (!from || !(dmg.amount > 0)) return;
    const recipients = links.filter((entry) => entry.target !== source);
    if (!recipients.length) return;
    const amount = dmg.amount * (dmg.mul ?? 1) * from.share;
    battle.assaultRuntime.enqueue((runtime, task) => {
      for (const entry of recipients) runtime.withCause(task.cause, () => battle.dealDamage(unit, entry.target, {
        amount, type: 'arts', isSkill: true, attackId: linkKey, canDodge: false,
      }));
    }, { key: linkKey, targetUid: uid(source), sourceUid: uid(unit), cause });
    battle.assaultRuntime.flush();
  });
  // bazaar: 「当你施加停顿时，此干员 +1 攻速」在 ranged-bazaar.js；攻击范围内的敌人受到的伤害 +c%（不再随时间增长）。
  onTimer(battle, unit, 0.5, () => {
    for (const target of rangeEnemies(battle, unit)) buff(battle, unit, target, { key: `${key(body.charId, 'mode:fragile')}:${uid(target)}`, mods: { dmgTakenMul: 1 + rangedLine(unit, 2, 'c') / 100 }, duration: 0.6, stacking: 'replace' });
  }, { every: true, immediate: true });
}

function installSkadi(battle, unit, body, module) {
  const talent = body.talentBindings.find((entry) => entry.nativeTalentIndex === 0);
  // 「新生代」只加两条攻击力加成（不再延长海嗣、不再给范围内敌人易伤）。
  unit.mem.skadiSeabornModule = false;
  summon(battle, unit, TOKEN.skadi, 1, 1, 1, key(body.charId, 'talent:seaborn'), { duration: value(unit, talent?.translation?.parameters ?? {}, 'lifeTime', 25) });
  onTimer(battle, unit, 0.5, () => {
    // bazaar: 攻击范围内有干员时，此干员 +d% 攻击力（「新生代」再 +a%）。
    const anyAlly = battle.allyUnits.some((candidate) => candidate !== unit && candidate.kind === 'op' && active(candidate) && unit.rangeKeySet?.has(tileKeyOf(candidate)));
    if (anyAlly) buff(battle, unit, unit, { key: key(body.charId, 'mode:abyssal'), mods: { atkMul: 1 + (rangedLine(unit, 2, 'd') + rangedModule(unit, 'uniequip_003_skadi2', 'a', 0)) / 100 }, duration: 0.6, stacking: 'replace' });
    else battle.removeBuff(unit, key(body.charId, 'mode:abyssal'));
  }, { every: true, immediate: true });
}

function installCetsyr(battle, unit, body) {
  // bazaar: 攻击范围内的干员受到的治疗 +c%（在场常驻，取代微尘碰撞后 6 秒）。
  onTimer(battle, unit, 0.5, () => {
    for (const ally of battle.allyUnits.filter((candidate) => candidate.kind === 'op' && candidate.ownerId === unit.ownerId && active(candidate) && unit.rangeKeySet?.has(tileKeyOf(candidate))))
      buff(battle, unit, ally, { key: key(body.charId, 'mode:healingTaken'), mods: { healingTakenMul: 1 + rangedLine(unit, 2, 'c') / 100 }, duration: 0.6, stacking: 'replace' });
  }, { every: true, immediate: true });
}

function installHaruka(battle, unit, body, module) {
  const grantBubble = () => {
    const ally = allies(battle, unit, { scope: 'range', count: 99 }).find((candidate) => !candidate.buffs?.some((entry) => entry.data?.rangedEliteBubble));
    if (!ally) return;
    // 每 0.5 秒给予 b% 庇护；「迟来的纪念」：庇护再 +a%。
    const ratio = (rangedLine(unit, 1, 'b') + rangedModule(unit, 'uniequip_002_haruka', 'a', 0)) / 100;
    battle.addBuff(ally, { key: `${key(body.charId, 'mode:bubble')}:${uid(ally)}`, shield: Math.max(1, ally.s.maxHp * ratio), mods: { dmgTakenMul: Math.max(0, 1 - ratio) }, visible: true, source: unit, data: { rangedEliteBubble: true, breakOnDamage: true, ownerUid: uid(unit) } });
  };
  onTimer(battle, unit, 0.5, grantBubble, { every: true, immediate: true });
  listen(battle, unit, 'damaged', 'haruka-bubble-break', (payload, cause) => {
    const target = payload.target, bubble = target?.buffs?.find((entry) => entry.data?.rangedEliteBubble && entry.data.ownerUid === uid(unit) && (entry.shield ?? 0) > 0);
    if (!bubble || payload.source?.side !== 'enemy') return;
    const attacker = payload.source;
    battle.removeBuff(target, bubble);
    if (bubble.data?.harukaSkillBubble && attacker?.side === 'enemy') {
      applyLevitate(battle, unit, attacker, 4, key(body.charId, 'skill:counter'), cause); // bazaar: 破裂反击的法术伤害已删去
    }
    if (bubble.data?.harukaSkillBubble) heal(battle, unit, target, { scale: 0.25 });
  }, 100);
}

function installLing(battle, unit, body) {
  // bazaar: 当你的召唤物被回收时，为此干员充能 b（只认回收，不再叠攻）。
  listenRuntime(battle, unit, 'summonReturned', 'ling-return', (payload, cause) => {
    if (payload.target?.side !== 'ally' || payload.target.ownerId !== unit.ownerId) return;
    sp(battle, unit, unit, rangedLine(unit, 1, 'b'), 'lingRecycle', key(body.charId, 'mode:recycle'), cause);
  });
}

function installIronmn(battle, unit, body, module) {
  unit.mem ??= {};
  const values = effect(body, 0).values;
  const passive = body.modePassives[0]?.values ?? {};
  const recycle = talentParameters(body, 1);
  const module3 = moduleHas(module, 'uniequip_003_ironmn') ? module : null;
  unit.mem.ironmnStockCap = value(unit, values, 'stockCap', 3);
  unit.mem.ironmnFieldCap = value(unit, values, 'fieldCap', 2) + moduleParameter(module3, 'fieldCapBonus');
  unit.mem.ironmnRuleKey = key(body.charId, 'skill:summon');
  // 「海布里印记」：支援装置上限 +1（不再加回收概率、不再回收回技力）。
  unit.mem.ironmnRecycleChance = value(unit, recycle, 'prob', 0.7);
  unit.mem.ironmnRecycleSp = 0;
  unit.mem.ironmnRepairRatio = value(unit, passive, 'repairRatio', 0.4);
  // bazaar: 你的装置受到的治疗 +c%（取代按净治疗量比例修复）。
  onTimer(battle, unit, 0.5, () => {
    for (const device of battle.allyUnits.filter((candidate) => candidate.kind === 'token' && candidate.defId === TOKEN.pile2 && candidate.ownerId === unit.ownerId && active(candidate)))
      buff(battle, unit, device, { key: key(body.charId, 'mode:deviceHealing'), mods: { healingTakenMul: 1 + rangedLine(unit, 2, 'c') / 100 }, duration: 0.6, stacking: 'replace' });
  }, { every: true, immediate: true });
}

function installCello(battle, unit, body, module) {
  onTimer(battle, unit, 1, () => {
    for (const target of rangeEnemies(battle, unit)) {
      fixedElementDamage(battle, unit, target, value(unit, body.modePassives[0]?.values ?? {}, 'epDamageRatioPerSec', 0.06), 'apoptosis', key(body.charId, 'mode:decay'), battle.assaultRuntime.currentCause);
      applyStatus(battle, unit, target, { status: 'sluggish', duration: value(unit, body.modePassives[0]?.values ?? {}, 'sluggish', 0.2), key: key(body.charId, 'mode:sluggish'), cause: battle.assaultRuntime.currentCause });
      // bazaar: 凋亡增幅移到「音乐家的旅程」：攻击范围内的敌人受到的凋亡损伤 +a%。
      const amp = rangedModule(unit, 'uniequip_003_cello', 'a', 0);
      if (amp > 0) buff(battle, unit, target, { key: `${key(body.charId, 'mode:decayAmp')}:${uid(target)}`, mods: { elementalTakenMul: 1 + amp / 100 }, duration: 1.1, stacking: 'replace' });
    }
  }, { every: true });
}

function installPassives(battle, unit, body, piece, module) {
  switch (body.charId) {
    case 'char_430_fartth': installFartth(battle, unit, body, module); break;
    case 'char_4193_lemuen': installLemuen(battle, unit, body, module); break;
    case 'char_391_rosmon': installRosmon(battle, unit, body, module); break;
    case 'char_1035_wisdel': installWisdel(battle, unit, body, module); break;
    case 'char_4117_ray': installRay(battle, unit, body, module); break;
    case 'char_213_mostma': installMostma(battle, unit, body, module); break;
    case 'char_4027_heyak': installHeyak(battle, unit, body, module); break;
    case 'char_4133_logos': installLogos(battle, unit, body, module); break;
    case 'char_2015_dusk': installDusk(battle, unit, body, module); break;
    case 'char_472_pasngr': installPasngr(battle, unit, body, module); break;
    case 'char_426_billro': installBillro(battle, unit, body, module); break;
    case 'char_1046_sbell2': installSbell(battle, unit, body, module); break;
    case 'char_1038_whitw2': installWhitw(battle, unit, body); break;
    case 'char_4146_nymph': installNymph(battle, unit, body, module); break;
    case 'char_1040_blaze2': installBlaze(battle, unit, body, module); break;
    case 'char_206_gnosis': installGnosis(battle, unit, body, module); break;
    case 'char_291_aglina': installAglina(battle, unit, body, module); break;
    case 'char_358_lisa': installLisa(battle, unit, body, module); break;
    case 'char_1047_halo2': installHalo(battle, unit, body, module); break;
    case 'char_1012_skadi2': installSkadi(battle, unit, body, module); break;
    case 'char_4134_cetsyr': installCetsyr(battle, unit, body); break;
    case 'char_4202_haruka': installHaruka(battle, unit, body, module); break;
    case 'char_2023_ling': installLing(battle, unit, body); break;
    case 'char_4072_ironmn': installIronmn(battle, unit, body, module); break;
    case 'char_245_cello': installCello(battle, unit, body, module); break;
    default: throw new TypeError(`unhandled ranged-elite passive ${body.charId}`);
  }
}

function build(charId, _battle, raw, def) {
  const { body, piece } = bodyOf(raw, def, charId);
  const star = rank({ input_piece: piece, def: { raw: { assaultPiece: piece } } });
  const module = selectedAdvancedModule(body, piece, star);
  return makeKit(def, {
    canCast: ({ battle, unit }) => charId === 'char_4072_ironmn'
      ? canCastIronmn(battle, unit, body)
      : charId === 'char_4134_cetsyr'
      ? rangeEnemies(battle, unit, 1).length > 0
      : charId === 'char_4117_ray'
        ? (assaultAmmoState(unit)?.current ?? 0) > 0 && rangeEnemies(battle, unit, 1).length > 0
        : skillHasTarget(battle, unit, charId),
    cast: (ctx) => castCard(charId, ctx, module),
    install: (battle, unit) => { applyModuleState(unit, module); installPassives(battle, unit, body, piece, module); installRangedBazaar(battle, unit, body); },
  });
}

export const rangedEliteCards = Object.freeze(Object.fromEntries(CHAR_IDS.map((charId) => [charId, (battle, raw, def) => build(charId, battle, raw, def)])));
export { rangedEliteTokenKits };
