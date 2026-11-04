import {
  active, allies, applyStatus, buff, damage, enemies, heal, makeKit, onTimer, rank, sp, uid, v, watch,
} from '../primitives.js';
import { installRangedBazaar, rangedLine, rangedModule } from './ranged-bazaar.js';
import { grantSummon, returnSummon } from '../summons.js';
import { COLS } from '../../../constants.js';

// This file is the explicitly translated middle ranged cluster.  It intentionally
// does not import ranged.js: the two registries are independent until the root
// registry performs its final merge.

export const rangedMidCharIds = Object.freeze([
  'char_346_aosta', 'char_002_amiya', 'char_306_leizi', 'char_344_beewax', 'char_373_lionhd',
  'char_341_sntlla', 'char_4031_liesel', 'char_388_mint', 'char_446_aroma', 'char_4013_kjera',
  'char_4040_rockr', 'char_4054_malist', 'char_242_otter', 'char_145_prove', 'char_4211_snhunt',
  'char_174_slbell', 'char_254_vodfox', 'char_4079_haini', 'char_4032_provs', 'char_4122_grabds',
  'char_4162_cathy', 'char_4045_heidi', 'char_4019_ncdeer', 'char_103_angel', 'char_332_archet',
]);

const TOKEN_IDS = Object.freeze({
  char_344_beewax: 'token_10011_beewax_oblisk',
  char_242_otter: 'token_10004_otter_motter',
  char_254_vodfox: 'token_10006_vodfox_doll',
  char_4162_cathy: 'token_10041_cathy_catsld',
});

const ADVANCED = Object.freeze({
  char_346_aosta: 'uniequip_002_aosta', char_002_amiya: 'uniequip_002_amiya', char_306_leizi: 'uniequip_002_leizi',
  char_344_beewax: 'uniequip_002_beewax', char_373_lionhd: 'uniequip_002_lionhd', char_341_sntlla: 'uniequip_002_sntlla',
  char_4031_liesel: 'uniequip_002_liesel', char_388_mint: 'uniequip_002_mint', char_446_aroma: 'uniequip_002_aroma',
  char_4013_kjera: 'uniequip_002_kjera', char_4040_rockr: 'uniequip_002_rockr', char_4054_malist: 'uniequip_002_malist',
  char_242_otter: 'uniequip_002_otter', char_145_prove: 'uniequip_002_prove', char_4211_snhunt: 'uniequip_002_snhunt',
  char_174_slbell: 'uniequip_002_slbell', char_254_vodfox: 'uniequip_002_vodfox', char_4079_haini: 'uniequip_002_haini',
  char_4032_provs: 'uniequip_002_provs', char_4122_grabds: 'uniequip_002_grabds', char_4162_cathy: 'uniequip_002_cathy',
  char_4045_heidi: 'uniequip_002_heidi', char_4019_ncdeer: 'uniequip_002_ncdeer',
});

const moduleOf = (unit) => {
  const body = unit.def?.raw?.assaultBody ?? unit.def?.assaultBody;
  const piece = unit.input_piece ?? unit.inputPiece ?? unit.def?.raw?.assaultPiece;
  const id = piece?.moduleId ?? piece?.moduleChoices?.[body?.charId];
  if (Array.isArray(piece?.moduleChoices)) throw new TypeError(`${body?.charId} moduleChoices must be a bodyId map`);
  if (!id || !body?.modulePlans?.some((m) => m.id === id && m.type === 'ADVANCED')) return null;
  if ((piece?.star ?? 0) < 3) return null;
  return { id, star: piece.star };
};

const rv = (unit, x) => Number(v(unit, x));
function nativeSkillValues(body) {
  const source = body.source?.skills?.find((entry) => entry.skillId === body.fixedSkill?.sourceSkillId);
  return Object.fromEntries((source?.blackboard ?? []).map(({ key: name, value }) => [name, value]));
}
const key = (id, suffix) => `assault:${id}:${suffix}`;
const liveEnemies = (battle, unit, count = battle.enemies.length, priority = 'exit') =>
  enemies(battle, unit, { scope: 'range', count, priority });
const liveAllies = (battle, unit, count = battle.allyUnits.length, selection = 'lowestHp') =>
  allies(battle, unit, { scope: 'range', count, selection });
const adjacentAllies = (battle, unit, scope = 'adjacent4') => allies(battle, unit, { scope, count: battle.allyUnits.length, selection: 'uid' });
const around = (battle, centre, radius = 1) => battle.enemiesInRadius(centre.x, centre.y, radius, true).filter(active);
const tokenIdOf = (unit) => unit?.tokenId ?? unit?.def?.tokenId ?? unit?.defId;
const enemyHasTag = (target, tag) => {
  const rawTags = target?.tags instanceof Set && target.tags.size === 0 ? (target.raw?.tags ?? target.def?.tags) : target?.tags;
  return Array.isArray(rawTags) ? rawTags.includes(tag)
    : rawTags instanceof Set ? rawTags.has(tag)
      : typeof rawTags?.has === 'function' ? rawTags.has(tag)
        : (target?.isElite === true || target?.raw?.isElite === true) && tag === 'elite'
          || (target?.isLeader === true || target?.raw?.isLeader === true) && tag === 'leader'
            || String(target?.rank ?? target?.raw?.rank ?? '').toLowerCase() === tag;
};

function applyDot(battle, source, target, { dotKey, duration, scale, type, cause }) {
  if (!active(target)) return false;
  const dot = battle.addBuff(target, {
    key: dotKey, status: 'assaultDot', duration, refresh: 'replace', source,
    interval: 1, onTick: ({ battle: b }) => { if (active(target)) damage(b, source, target, { scale, type, isSkill: true, sourceKey: dotKey, cause }); },
  });
  return !!dot;
}

function addShield(battle, source, target, amount, shieldKey) {
  if (!active(target) || !(amount > 0)) return null;
  return battle.addBuff(target, { key: shieldKey, duration: Infinity, refresh: 'replace', shield: amount, source });
}

// Kit installation happens before an operator/token is deployed.  The shared timer
// primitive intentionally rejects inactive owners, so defer installation until the
// real deploy event and let the timer owner be cleaned up by the battle lifecycle.
function deferTimer(battle, unit, seconds, handler, options = {}) {
  if (active(unit)) return onTimer(battle, unit, seconds, handler, options);
  let armed = true; let scheduled = null; let hook = null;
  const cancel = () => { armed = false; if (hook) battle.off(hook); hook = null; scheduled?.(); };
  hook = battle.on('deploy', ({ unit: deployed }) => {
    if (!armed || deployed !== unit) return;
    battle.off(hook); hook = null;
    scheduled = onTimer(battle, unit, seconds, handler, options);
  }, { owner: unit });
  return cancel;
}

function targetFromEvent(battle, payload) {
  if (payload?.target && typeof payload.target === 'object') return payload.target;
  const targetUid = payload?.targetUid;
  return [...battle.enemies, ...battle.allyUnits].find((x) => uid(x) === String(targetUid));
}

function isUnblocked(target) { return !!target && !target.blockedBy; }
function countInRange(battle, unit) { return liveEnemies(battle, unit, battle.enemies.length).length; }

function skillAosta({ battle, unit, body, star, cause }) {
  unit.mem.aostaSkillBinds = 0;
  const mod = moduleOf(unit); const targets = liveEnemies(battle, unit, battle.enemies.length);
  const hit = body.fixedSkill.effects[0].values, bindEffect = body.fixedSkill.effects[1].values, bleedEffect = body.fixedSkill.effects[2].values;
  const scale = rv(unit, hit.atkScale);
  void mod; const bind = rv(unit, bindEffect.duration) + rangedModule(unit, 'uniequip_002_aosta', 'r', 0);
  const bleed = rv(unit, bleedEffect.atkScalePerSec) + (mod ? 0.06 : 0);
  const bleedingDuration = Number(bleedEffect.duration) + (mod?.star >= 4 ? 1 : 0);
  let did = false; let bound = 0;
  for (const target of targets) {
    did = damage(battle, unit, target, { scale, type: hit.dmgType, isSkill: true, sourceKey: key(unit.def.charId, 'skill:hit'), cause }) > 0 || did;
    if (!target.alive || !isUnblocked(target)) continue;
    if (applyStatus(battle, unit, target, { status: 'bind', duration: bind, key: key(unit.def.charId, 'skill:bind'), cause })) bound++;
    void bleed; void bleedingDuration; // bazaar: 技能附带的流血已删去，流血只由普攻施加。
  }
  unit.mem.aostaSkillBinds = bound;
  return did || bound > 0;
}

function skillAmiya({ battle, unit, body, star, cause }) {
  const mod = moduleOf(unit); const targets = liveEnemies(battle, unit, battle.enemies.length);
  if (!targets.length) return false;
  const hit = body.fixedSkill.effects[0].values, selfStun = body.fixedSkill.effects[1].values.duration;
  const hits = rv(unit, hit.times) + rangedModule(unit, 'uniequip_002_amiya', 'n', 0);
  const scale = rv(unit, hit.atkScale);
  for (let i = 0; i < hits; i++) {
    const target = targets[Math.floor(battle.rng() * targets.length)];
    if (target?.alive) damage(battle, unit, target, { scale, type: hit.dmgType, isSkill: true, sourceKey: key(unit.def.charId, `skill:burst:${i}`), cause });
  }
  void mod; const stun = Number(selfStun); // bazaar: 卡面「然后自身晕眩 3 秒」，模组不再缩短
  applyStatus(battle, unit, unit, { status: 'stun', duration: stun, key: key(unit.def.charId, 'skill:selfStun'), cause });
  return true;
}

function skillLeizi({ battle, unit, body, cause }) {
  unit.mem.leiziSp = 0;
  const mod = moduleOf(unit); const hit = body.fixedSkill.effects[0].values;
  if (hit.damageDecay !== 0) throw new TypeError('Leizi source damageDecay is unsupported and must remain zero');
  const max = Number(v(unit, hit.maxTarget)) + (mod ? 1 : 0);
  const scale = rv(unit, hit.atkScale) + (mod ? 0.1 : 0);
  const status = body.fixedSkill.effects[1].values;
  const targets = liveEnemies(battle, unit, max, 'nearest');
  let hits = 0;
  for (const target of targets) {
    if (damage(battle, unit, target, { scale, type: 'arts', isSkill: true, sourceKey: key(unit.def.charId, `skill:chain:${uid(target)}`), cause }) > 0) hits++;
    if (target.alive) applyStatus(battle, unit, target, { status: 'slow', duration: rv(unit, status.duration) + (mod?.star >= 4 ? 0.3 : 0), value: status.slow, key: key(unit.def.charId, 'skill:slow'), cause });
  }
  unit.mem.leiziChainUnblocked = targets.filter(isUnblocked).length;
  return hits > 0;
}

function skillBeewax({ battle, unit, body, star, cause }) {
  const old = battle.allyUnits.find((x) => x.kind === 'token' && x.ownerUnit === unit && tokenIdOf(x) === TOKEN_IDS.char_344_beewax && active(x));
  if (old) returnSummon(battle, unit, old, 'replace');
  const device = body.fixedSkill.effects[0].values, impact=body.fixedSkill.effects[1].values, stun=body.fixedSkill.effects[2].values;
  const result = grantSummon(battle, unit, { tokenId: device.tokenKey, count: Number(device.count[star-1]), stockCap: Number(device.maxCount[star-1]), fieldCap: Number(device.maxCount[star-1]), ruleKey: key(unit.def.charId, 'oblisk') });
  const token = battle.allyUnits.find((x) => x.kind === 'token' && x.ownerUnit === unit && tokenIdOf(x) === TOKEN_IDS.char_344_beewax && active(x));
  if (!token) return result.granted > 0;
  const mod = moduleOf(unit); const radius = Number(impact.radius) + (mod ? 1 : 0);
  for (const target of around(battle, token, radius)) {
    damage(battle, unit, target, { scale: rv(unit, impact.atkScale), type: impact.dmgType, isSkill: true, sourceKey: key(unit.def.charId, 'oblisk:impact'), cause });
    if (target.alive) applyStatus(battle, unit, target, { status: 'stun', duration: rv(unit, stun.duration), key: key(unit.def.charId, 'oblisk:stun'), cause });
  }
  return true;
}

function skillLionhead({ battle, unit, body, cause }) {
  const mod = moduleOf(unit); const targets = liveEnemies(battle, unit, battle.enemies.length), hit=body.fixedSkill.effects[0].values, debuff=body.fixedSkill.effects[1].values;
  const scale = rv(unit, hit.atkScale); const res = rv(unit, debuff.magicResDown) + (mod ? 0.05 : 0);
  for (const target of targets) {
    damage(battle, unit, target, { scale, type: hit.dmgType, isSkill: true, sourceKey: key(unit.def.charId, 'skill:blast'), cause });
    if (target.alive) buff(battle, unit, target, { key: key(unit.def.charId, 'skill:resDown'), mods: { resMul: 1 - res }, duration: Number(debuff.duration) + (mod?.star >= 4 ? 2 : 0), cause });
  }
  return targets.length > 0;
}

function skillSntlla({ battle, unit, body, cause }) {
  const mod = moduleOf(unit); const effect = body.fixedSkill.effects[0].values;
  const count = rv(unit, effect.count) + rangedModule(unit, 'uniequip_002_sntlla', 'n', 0);
  const scale = rv(unit, effect.atkScale);
  const duration = rv(unit, effect.cold) + (mod ? 0.5 : 0);
  const pool = (unit.rangeKeys ?? []).slice(); const cells = [];
  while (cells.length < count && pool.length) cells.push(pool.splice(Math.floor(battle.rng() * pool.length), 1)[0]);
  let hit = false;
  for (const cell of cells) {
    const row = Math.floor(cell / COLS); const col = cell % COLS;
    for (const target of battle.enemiesInRadius(col, row, rv(unit, effect.radius), true).filter(active)) {
      damage(battle, unit, target, { scale, type: effect.dmgType, isSkill: true, isSplash: true, sourceKey: key(unit.def.charId, `icicle:${cell}`), cause });
      if (target.alive) applyStatus(battle, unit, target, { status: 'cold', duration, key: key(unit.def.charId, `icicle:cold:${cell}`), cause });
      hit = true;
    }
  }
  return hit || cells.length > 0;
}

function skillLiesel({ battle, unit, body, cause }) {
  const mod = moduleOf(unit); const hit = body.fixedSkill.effects[0].values, burn = body.fixedSkill.effects[1].values;
  const targets = liveEnemies(battle, unit, Number(v(unit, hit.maxTarget))); if (!targets.length) return false;
  const scale = rv(unit, hit.atkScale) * (mod ? 1.1 : 1);
  const dot = rv(unit, burn.atkScalePerSec) + (mod ? 0.05 : 0);
  for (const target of targets) {
    damage(battle, unit, target, { scale, type: hit.dmgType, isSkill: true, sourceKey: key(unit.def.charId, 'skill:hit'), cause });
    if (target.alive) applyDot(battle, unit, target, { dotKey: key(unit.def.charId, 'skill:burn'), duration: Number(v(unit, burn.duration)) + (mod?.star >= 4 ? 2 : 0), scale: dot, type: burn.dmgType, cause });
  }
  return true;
}

function skillMint({ battle, unit, body, cause }) {
  const mod = moduleOf(unit); const effect = body.fixedSkill.effects[0].values;
  if (effect.pullDirection !== 'towardSelf') throw new TypeError(`${body.charId} has unsupported pull direction ${effect.pullDirection}`);
  const distance = rv(unit, effect.pullDistance) + (mod ? 1 : 0);
  const count = Number(v(unit, effect.maxTarget)) + (mod?.star >= 4 ? 1 : 0);
  const targets = liveEnemies(battle, unit, count, 'nearest');
  for (const target of targets) {
    if (typeof battle.pull === 'function') battle.pull(target, distance, { to: unit, stop: true });
    damage(battle, unit, target, { scale: rv(unit, body.fixedSkill.effects[1].values.atkScale), type: body.fixedSkill.effects[1].values.dmgType, isSkill: true, sourceKey: key(unit.def.charId, 'skill:pull'), cause });
  }
  return targets.length > 0;
}

function skillAroma({ battle, unit, body, cause }) {
  const mod = moduleOf(unit), hit = body.fixedSkill.effects[0].values;
  const targets = liveEnemies(battle, unit, 1);
  for (const target of targets) {
    const scale = rv(unit, hit.atkScale) + (target.isFlying ? rv(unit, hit.flyingBonus) : 0) + (mod ? 0.15 : 0);
    damage(battle, unit, target, { scale, type: 'arts', isSkill: true, sourceKey: key(unit.def.charId, `skill:instant:${uid(target)}`), cause });
    if (target.alive && mod) applyStatus(battle, unit, target, { status: 'levitate', duration: 0.5, key: key(unit.def.charId, `skill:levitate:${uid(target)}`), cause });
  }
  return targets.length > 0;
}

function skillKjera({ battle, unit, body, cause }) {
  const mod = moduleOf(unit); const hit = body.fixedSkill.effects[0].values; const status = body.fixedSkill.effects[1].values;
  const units = Number(v(unit, hit.units)) + (mod ? 1 : 0); const targets = liveEnemies(battle, unit, battle.enemies.length);
  const scale = rv(unit, hit.atkScale); const probability = rv(unit, status.prob) + (mod ? 0.05 : 0);
  for (const target of targets) {
    for (let i = 0; i < units && target.alive; i++) damage(battle, unit, target, { scale, type: hit.dmgType, isSkill: true, sourceKey: key(unit.def.charId, `skill:funnel:${uid(target)}:${i}`), cause });
    if (target.alive && (probability >= 1 || battle.rng() < probability)) applyStatus(battle, unit, target, { status: 'cold', duration: rv(unit, status.duration) + (mod?.star >= 4 ? 0.5 : 0), key: key(unit.def.charId, 'skill:cold'), cause });
  }
  return targets.length > 0;
}

function skillRockr({ battle, unit, body, cause }) {
  const values = body.fixedSkill.effects[0].values, mod = moduleOf(unit), scale = rv(unit, values.atkScale);
  const target = liveEnemies(battle, unit, 1)[0];
  if (!target) return false;
  unit.mem.rockDrone = { lock: target, cd: 0, target: uid(target), scale };
  battle.fx('drone', { x: target.x, y: target.y, id: unit.id });
  battle.assaultRuntime.withCause(cause, () => battle.dealDamage(unit, target, {
    amount: unit.s.atk * (scale + (mod ? 0.2 : 0)), type: values.damageType ?? 'arts', isSkill: true,
    attackId: key(unit.def.charId, `skill:drone:${uid(target)}`), tags: ['skill', 'drone', 'rockr:drone'],
  }));
  // The source S2 dispatches one drone attack. It returns immediately after this hit.
  unit.mem.rockDrone = null;
  applyStatus(battle, unit, unit, { status: 'stun', duration: rv(unit, values.stunSelfDuration ?? 2) - (mod?.star >= 4 ? 1 : 0), key: key(unit.def.charId, 'skill:afterStun'), cause });
  return true;
}

function skillMalist({ battle, unit, body, cause }) {
  const target = liveEnemies(battle, unit, 1)[0]; if (!target) return false;
  const effect = body.fixedSkill.effects[0].values, mod = moduleOf(unit); const scale = rv(unit, effect.atkScale) + (mod ? 0.15 : 0);
  damage(battle, unit, target, { scale, hits: Number(v(unit, effect.times)), type: effect.dmgType, isSkill: true, sourceKey: key(unit.def.charId, 'skill:double'), cause });
  return true;
}

function skillOtter({ battle, unit, body, cause }) {
  const mod = moduleOf(unit); const tokens = battle.allyUnits.filter((x) => x.kind === 'token' && x.ownerUnit === unit && tokenIdOf(x) === TOKEN_IDS.char_242_otter && active(x));
  const effects = body.fixedSkill.effects; const hitValues = effects[0].values, stun = effects[1].values.duration;
  let hit = false;
  for (const token of tokens) {
    for (const target of around(battle, token, 1)) {
      damage(battle, unit, target, { scale: rv(unit, hitValues.atkScale) * (1 + rangedModule(unit, 'uniequip_002_otter', 'a', 0) / 100), type: hitValues.dmgType, isSkill: true, sourceKey: key(unit.def.charId, `skill:blast:${uid(token)}`), cause });
      if (target.alive) applyStatus(battle, unit, target, { status: 'stun', duration: rv(unit, stun), key: key(unit.def.charId, `skill:stun:${uid(token)}`), cause });
      hit = true;
    }
    returnSummon(battle, unit, token, 'skillRecycle');
  }
  return hit || tokens.length > 0;
}

function skillProve({ battle, unit, body, cause }) {
  // bazaar: 对生命最低敌人造成 a% 物理伤害，目标每少 20% 生命 +b%（不再要求低于 80%）。
  const effect = body.fixedSkill.effects[0].values;
  const target = liveEnemies(battle, unit, battle.enemies.length).sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp || uid(a).localeCompare(uid(b)))[0];
  if (!target) return false;
  const deficitSteps = Math.max(0, Math.floor((1 - target.hp / target.s.maxHp) / 0.2 + 1e-9));
  // 「尾巴养护套装」：技能每档加成 +a%。
  const scale = rangedLine(unit, 0, 'a') / 100 + deficitSteps * (rangedLine(unit, 0, 'b') + rangedModule(unit, 'uniequip_002_prove', 'a', 0)) / 100;
  return damage(battle, unit, target, { scale, type: effect.dmgType, isSkill: true, sourceKey: key(unit.def.charId, 'skill:execute'), cause }) > 0;
}
function skillSnhunt({ battle, unit, body, cause }) {
  const mod = moduleOf(unit); const strike = body.fixedSkill.effects[0].values, beast = body.fixedSkill.effects[1].values;
  const target = liveEnemies(battle, unit, 1)[0]; if (!target) return false;
  // bazaar: 对非移动敌人的更高倍率已删去。
  const scale = rv(unit, strike.atkScale) + rangedModule(unit, 'uniequip_002_snhunt', 'a', 0) / 100;
  damage(battle, unit, target, { scale, hits: Number(v(unit, strike.times)), type: strike.dmgType, isSkill: true, sourceKey: key(unit.def.charId, 'skill:double'), cause });
  for (const enemy of liveEnemies(battle, unit, battle.enemies.length)) {
    damage(battle, unit, enemy, { scale: rv(unit, beast.atkScale), type: beast.dmgType, isSkill: true, sourceKey: key(unit.def.charId, `skill:beast:${uid(enemy)}`), cause });
    if (enemy.alive) applyStatus(battle, unit, enemy, { status: 'cold', duration: rv(unit, beast.cold) + (mod ? 0.5 : 0), key: key(unit.def.charId, 'skill:beastCold'), cause });
  }
  return true;
}

function skillSlbell({ battle, unit, body, cause }) {
  const effect = body.fixedSkill.effects[0].values; const targets = liveEnemies(battle, unit, battle.enemies.length); const duration = rangedModule(unit, 'uniequip_002_slbell', 'a', rangedLine(unit, 0, 't', rv(unit, effect.duration))); // bazaar: 「续针」主动改为施加 a 秒寒冷
  for (const target of targets) applyStatus(battle, unit, target, { status: 'cold', duration, value: rv(unit, effect.slow), key: key(unit.def.charId, 'skill:cold'), cause });
  return targets.length > 0;
}

function skillVodfox({ battle, unit, body, star, cause }) {
  const mod = moduleOf(unit); const device = body.fixedSkill.effects[0].values, debuff = body.fixedSkill.effects[1].values;
  const result = grantSummon(battle, unit, { tokenId: device.tokenKey, count: Number(device.gain[star - 1]), stockCap: Number(device.maxCount[star - 1]), fieldCap: Number(device.maxCount[star - 1]), duration: Number(device.lifeTime) + (mod ? 5 : 0), ruleKey: key(unit.def.charId, 'doll') });
  const doll = battle.allyUnits.find((x) => x.kind === 'token' && x.ownerUnit === unit && tokenIdOf(x) === TOKEN_IDS.char_254_vodfox && active(x));
  if (doll) for (const target of around(battle, doll, mod ? 2 : 1)) {
    const atkRatio = rv(unit, debuff.atkDown), defRatio = rv(unit, debuff.defDown);
    buff(battle, unit, target, { key: key(unit.def.charId, `doll:debuff:${uid(target)}`), mods: { atkMul: 1 - atkRatio, defMul: 1 - defRatio }, duration: Number(device.lifeTime) + (mod ? 5 : 0), cause });
  }
  return result.granted > 0;
}

function skillHaini({ battle, unit, body, cause }) {
  unit.mem.hainiSkillHits = 0;
  const mod = moduleOf(unit); const effect=body.fixedSkill.effects[0].values; const max = Number(v(unit, effect.maxTarget)) + (mod ? 1 : 0); const targets = liveEnemies(battle, unit, max); let did = false;
  for (const target of targets) if (!enemyHasTag(target, 'elite') && !enemyHasTag(target, 'leader')) did = damage(battle, unit, target, { scale: rv(unit, effect.atkScale), type: effect.dmgType, isSkill: true, sourceKey: key(unit.def.charId, 'skill:shot'), cause }) > 0 || did;
  unit.mem.hainiSkillHits = 0;
  return did;
}

function skillProvs({ battle, unit, body, cause }) {
  const mod = moduleOf(unit), hit = body.fixedSkill.effects[0].values, status = body.fixedSkill.effects[1].values, targets = liveEnemies(battle, unit, 1);
  for (const target of targets) {
    damage(battle, unit, target, { scale: rv(unit, hit.atkScale) + (mod ? 0.1 : 0), type: 'arts', isSkill: true, sourceKey: key(unit.def.charId, 'skill:blast'), cause });
    if (target.alive && mod) applyStatus(battle, unit, target, { status: 'silence', duration: Number(status.moduleSilenceDuration ?? 2), key: key(unit.def.charId, 'skill:silence'), cause });
    if (target.alive && rv(unit, status.duration) > 0) applyStatus(battle, unit, target, { status: 'slow', duration: rv(unit, status.duration), value: Number((status.slowValue ?? [0.8, 0.8, 0.8, 0.8])[rank(unit) - 1]) + (mod?.star >= 4 ? 0.1 : 0), key: key(unit.def.charId, 'skill:slow'), cause });
  }
  return targets.length > 0;
}

function skillGrabds({ battle, unit, body, cause }) {
  const mod = moduleOf(unit), hit = body.fixedSkill.effects[0].values, targets = liveEnemies(battle, unit, 2 + (mod ? 1 : 0));
  for (const target of targets) {
    damage(battle, unit, target, { scale: rv(unit, hit.atkScale), type: 'arts', isSkill: true, sourceKey: key(unit.def.charId, `skill:note:${uid(target)}`), cause });
    if (target.alive && mod) applyStatus(battle, unit, target, { status: 'sleep', duration: Number(hit.moduleSleepDuration ?? 2), key: key(unit.def.charId, `skill:sleep:${uid(target)}`), cause });
  }
  return targets.length > 0;
}

function skillCathy({ battle, unit, body, cause }) {
  const device = body.fixedSkill.effects[0].values, stats = body.fixedSkill.effects[1].values;
  const target = liveAllies(battle, unit, 1)[0] ?? unit, maxDeploy = Number(device.maxDeploy) + (moduleOf(unit)?.star >= 4 ? 1 : 0);
  unit.mem.cathyDeviceTarget = uid(target); unit.mem.cathyDeviceTargets ??= new Set(); unit.mem.cathyDeviceTargets.add(uid(target)); unit.mem.cathyDeviceMax = maxDeploy;
  grantSummon(battle, unit, { tokenId: TOKEN_IDS.char_4162_cathy, count: 1, stockCap: maxDeploy, fieldCap: maxDeploy, ruleKey: key(unit.def.charId, 'supportDevice') });
  battle.addBuff(unit, { key: key(unit.def.charId, 'skill:shield'), shield: unit.s.maxHp * rv(unit, stats.selfShieldRatio), source: unit, visible: true, data: { cause } });
  return true;
}

function skillHeidi({ battle, unit, body, cause }) {
  const targets = liveAllies(battle, unit, battle.allyUnits.length), effect = body.fixedSkill.effects[0].values;
  for (const target of targets) {
    heal(battle, unit, target, { scale: rv(unit, effect.healAtkScale), cause });
    const shieldRatio = rangedModule(unit, 'uniequip_002_heidi', 'a', null) != null ? rangedModule(unit, 'uniequip_002_heidi', 'a', 0) / 100 : rv(unit, effect.shieldRatio);
    battle.addBuff(target, { key: key(unit.def.charId, `skill:shield:${uid(target)}`), shield: target.s.maxHp * shieldRatio, source: unit, visible: true });
  }
  return targets.length > 0;
}

function skillNcdeer({ battle, unit, body, cause }) {
  const mod = moduleOf(unit); const targets = liveAllies(battle, unit, battle.allyUnits.length), healEffect=body.fixedSkill.effects[0].values, protectEffect=body.fixedSkill.effects[1].values, dodgeEffect=body.fixedSkill.effects[2].values; const healScale = rv(unit, healEffect.atkScale) * (mod ? 1.15 : 1); const protect = rv(unit, protectEffect.damageResistance) + (mod ? 0.03 : 0);
  for (const target of targets) {
    heal(battle, unit, target, { scale: healScale, cause });
    buff(battle, unit, target, {
      key: key(unit.def.charId, `skill:protect:${uid(target)}`),
      mods: { dmgTakenMul: 1 - protect },
      duration: rv(unit, protectEffect.duration) + (mod?.star >= 4 ? 2 : 0),
      cause,
    });
  }
  void dodgeEffect; // bazaar: 施放后自身远程物理抵挡已删去。
  return targets.length > 0;
}

function skillAngel({ battle, unit, body, cause }) {
  const module = moduleOf(unit), target = liveEnemies(battle, unit, 1)[0]; if (!target) return false;
  const hit = body.fixedSkill.effects[0].values, hits = Number(v(unit, hit.times ?? 3)) + (module?.id === 'uniequip_003_angel' ? 1 : 0);
  const scale = rv(unit, hit.atkScale) + (module?.id === 'uniequip_002_angel' ? 0.1 : 0) + (module?.id === 'uniequip_002_angel' && module.star >= 4 && target.isFlying ? 0.05 : 0);
  let successfulHits = 0;
  const stopHitObserver = battle.assaultRuntime.observe('hit', key(unit.def.charId, 'skill:airReturn:hitObserver'), ({ payload }) => {
    if (payload?.source === unit && payload.target === target && String(payload.attackId ?? '').includes('skill:arrow:')) successfulHits++;
  });
  try {
    for (let i = 0; i < hits && target.alive; i++) {
      damage(battle, unit, target, { scale, type: 'phys', isSkill: true, sourceKey: key(unit.def.charId, `skill:arrow:${i}`), cause });
    }
  } finally { stopHitObserver(); }
  if (module?.id === 'uniequip_002_angel' && target.isFlying && successfulHits === hits) sp(battle, unit, unit, 1, 'skill:airReturn', key(unit.def.charId, 'skill:airReturn'), cause);
  return true;
}

function skillArchet({ battle, unit, body, cause }) {
  const mod = moduleOf(unit), hit = body.fixedSkill.effects[0].values, targetCount = mod?.id === 'uniequip_004_archet' ? 6 : 5;
  let remaining = Number(v(unit, hit.times ?? 5)) + (mod?.id === 'uniequip_004_archet' && mod.star >= 4 ? 1 : 0);
  let scale = rv(unit, hit.atkScale) + (mod?.id === 'uniequip_002_archet' ? 0.1 : 0);
  if (mod?.id === 'uniequip_002_archet' && mod.star >= 4) scale *= 1.05;
  const rangeKey = key(unit.def.charId, 'skill:range');
  battle.addBuff(unit, { key: rangeKey, mods: { rangeExtend: 1 + (mod?.id === 'uniequip_002_archet' ? 1 : 0) }, duration: 0.1, source: unit });
  battle.refreshRange(unit);
  let targets;
  try { targets = liveEnemies(battle, unit, 1); }
  finally { battle.removeBuff(unit, rangeKey); battle.refreshRange(unit); }
  let previous = unit;
  for (const target of targets) {
    const count = Math.max(1, remaining);
    for (let i = 0; i < count && target.alive; i++) damage(battle, unit, target, { scale, type: 'phys', isSkill: true, sourceKey: key(unit.def.charId, `skill:arrow:${uid(target)}:${i}`), cause });
    remaining = Math.max(0, remaining - 1);
    previous = target;
    const next = liveEnemies(battle, unit, battle.enemies.length).filter((candidate) => !targets.includes(candidate))
      .sort((a, b) => Math.hypot(a.x - previous.x, a.y - previous.y) - Math.hypot(b.x - previous.x, b.y - previous.y) || uid(a).localeCompare(uid(b)))[0];
    if (!next || targets.length >= targetCount) break;
    targets.push(next);
  }
  return targets.length > 0;
}

const SKILLS = Object.freeze({
  char_346_aosta: skillAosta, char_002_amiya: skillAmiya, char_306_leizi: skillLeizi, char_344_beewax: skillBeewax,
  char_373_lionhd: skillLionhead, char_341_sntlla: skillSntlla, char_4031_liesel: skillLiesel, char_388_mint: skillMint,
  char_446_aroma: skillAroma, char_4013_kjera: skillKjera, char_4040_rockr: skillRockr, char_4054_malist: skillMalist,
  char_242_otter: skillOtter, char_145_prove: skillProve, char_4211_snhunt: skillSnhunt, char_174_slbell: skillSlbell,
  char_254_vodfox: skillVodfox, char_4079_haini: skillHaini, char_4032_provs: skillProvs, char_4122_grabds: skillGrabds,
  char_4162_cathy: skillCathy, char_4045_heidi: skillHeidi, char_4019_ncdeer: skillNcdeer, char_103_angel: skillAngel,
  char_332_archet: skillArchet,
});

function installAosta(battle, unit, body) {
  const bleed = body.modePassives?.[0]?.values ?? {}, bindSp = body.modePassives?.[1]?.values?.sp;
  watch(battle, unit, 'attack', key(unit.def.charId, 'talent:bleed'), ({ payload }) => payload?.source === unit && payload.sourceClass === 'attack' && payload.targets?.some(isUnblocked), ({ payload, cause }) => {
    for (const target of payload.targets.filter(isUnblocked)) applyDot(battle, unit, target, { dotKey: key(unit.def.charId, `talent:bleed:${uid(target)}`), duration: Number(bleed.duration), scale: Number(bleed.atkScalePerSec?.[rank(unit) - 1]) + rangedModule(unit, 'uniequip_002_aosta', 'a', 0) / 100, type: bleed.dmgType, cause });
  });
  // bazaar: the self-only bind refund is replaced by 「当敌人获得束缚时，为此干员充能 1」 (ranged-bazaar.js).
  void bindSp;
}

function installAmiya(battle, unit, body) {
  const attackSp = body.modePassives?.[0]?.values?.sp, killSp = body.modePassives?.[1]?.values?.sp;
  watch(battle, unit, 'attack', key(unit.def.charId, 'mode:attackSp'), ({ payload }) => payload?.source === unit, ({ cause }) => sp(battle, unit, unit, Number(attackSp?.[rank(unit) - 1]), 'mode:attackSp', key(unit.def.charId, 'mode:attackSp'), cause));
  // bazaar: 击倒回技改为「当你的罗德岛干员施放技能时」 (ranged-bazaar.js).
}

function installLeizi(battle, unit, body) {
  const spByHit = body.modePassives?.[0]?.values?.sp;
  battle.on('beforeAttack', ({ attacker, targets, isSkill, profile }) => { if (attacker !== unit || isSkill) return; if (targets.some(isUnblocked)) profile.atkScale = (profile.atkScale ?? 1) * (moduleOf(unit) ? 1.26 : 1.2); }, { owner: unit });
  watch(battle, unit, 'hit', key(unit.def.charId, 'mode:jumpSp'), ({ payload }) => payload?.source === unit && payload.sourceClass === 'skill' && isUnblocked(payload.target), ({ cause }) => { unit.mem.leiziSp = (unit.mem.leiziSp ?? 0) + 1; if (unit.mem.leiziSp <= 3) sp(battle, unit, unit, Number(spByHit?.[rank(unit) - 1]), 'mode:jumpSp', key(unit.def.charId, 'mode:jumpSp'), cause); });
}

function installBeewax(battle, unit, body) {
  const regen = body.modePassives?.[0]?.values?.maxHpRatioPerSec;
  const healGap = () => { if (active(unit) && !(unit.skill?.sp >= unit.skill?.spCost)) heal(battle, unit, unit, { maxHpRatio: Number(regen?.[rank(unit) - 1]) + (moduleOf(unit) ? 0.01 : 0) }); };
  deferTimer(battle, unit, 1, healGap, { every: true });
}

function installLionhead(battle, unit, body) {
  const values = body.modePassives?.[0]?.values ?? {};
  const refresh = () => { if (!active(unit)) return; const n = Math.min(Number(values.maxStacks?.[rank(unit) - 1]), countInRange(battle, unit)); buff(battle, unit, unit, { key: key(unit.def.charId, 'mode:fragments'), mods: { atkMul: 1 + n * Number(values.atkPerEnemy?.[rank(unit) - 1]) }, duration: 0.5, cause: battle.assaultRuntime.currentCause }); };
  deferTimer(battle, unit, 0.5, refresh, { every: true, immediate: true });
}

function installSntlla(battle, unit, body) {
  const values = body.modePassives?.[0]?.values ?? {};
  const atk = values.atk;
  const resist = values.statusResist;
  if (!Array.isArray(atk) || !Array.isArray(resist) || atk.length !== 4 || resist.length !== 4) throw new TypeError('Sntlla compiled mode passive is incomplete');
  const delay = Number(body.talentBindings?.find((entry) => entry.nativeTalentIndex === 0)?.translation?.parameters?.delay);
  if (!Number.isFinite(delay) || delay <= 0) throw new TypeError('Sntlla compiled passive delay is missing');
  const atkKey = key(unit.def.charId, 'mode:bornIce'); const resistKey = key(unit.def.charId, 'mode:bornIceResist');
  let cancelTimer = null;
  const clear = () => {
    cancelTimer?.(); cancelTimer = null;
    battle.removeBuff(unit, atkKey); battle.removeBuff(unit, resistKey);
  };
  const arm = () => {
    cancelTimer?.();
    cancelTimer = onTimer(battle, unit, delay, () => {
      buff(battle, unit, unit, { key: atkKey, mods: { atkMul: 1 + Number(atk[rank(unit) - 1]) }, duration: Infinity, cause: null });
      // The compiled plan stores resistance as a negative duration modifier; the
      // typed runtime's `resist` status stores the positive resisted fraction.
      // bazaar: 状态抵抗变化已删去（卡面只写攻击力）。
      cancelTimer = null;
    });
  };
  battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) arm(); }, { owner: unit });
  battle.on('retreating', ({ unit: retreating }) => { if (retreating === unit) clear(); }, { owner: unit });
  battle.on('death', ({ unit: dead }) => { if (dead === unit) clear(); }, { owner: unit });
  if (active(unit)) arm();
}
function installLiesel(battle, unit, body) { const v = body.modePassives?.[0]?.values ?? {}; const scale = v.damageScale; const min = Number(v.minTarget); if (!Array.isArray(scale) || scale.length !== 4 || !Number.isInteger(min)) throw new TypeError('Liesel compiled mode passive is incomplete'); battle.on('beforeAttack', ({ attacker, targets, profile }) => { if (attacker !== unit || targets.length < min) return; profile.atkScale = (profile.atkScale ?? 1) * Number(scale[rank(unit) - 1]); }, { owner: unit }); }
function installMint(battle, unit, body) { const base = body.modePassives?.[0]?.values?.def; const refresh = () => { for (const ally of adjacentAllies(battle, unit)) buff(battle, unit, ally, { key: key(unit.def.charId, `mode:def:${uid(ally)}`), mods: { defMul: 1 + Number(base?.[rank(unit) - 1]) + (moduleOf(unit) ? 0.03 : 0) }, duration: 0.6 }); }; deferTimer(battle, unit, 0.5, refresh, { every: true, immediate: true }); }
function installAroma(battle, unit, body) { const v = body.modePassives?.[0]?.values ?? {}; const scale = v.firstHitDamageScale; const duration = v.duration; if (!Array.isArray(scale) || !Array.isArray(duration) || scale.length !== 4 || duration.length !== 4) throw new TypeError('Aroma compiled mode passive is incomplete'); const seen = new Set(); battle.on('beforeAttack', ({ attacker, targets, isSkill, profile }) => { if (attacker !== unit || isSkill) return; for (const target of targets) if (!seen.has(uid(target))) { seen.add(uid(target)); profile.atkScale = (profile.atkScale ?? 1) * (Number(scale[rank(unit) - 1]) + (moduleOf(unit)?.star >= 4 ? 0.05 : 0)); applyStatus(battle, unit, target, { status: 'levitate', duration: Number(duration[rank(unit) - 1]) + (moduleOf(unit) ? 0.5 : 0), key: key(unit.def.charId, `mode:first:${uid(target)}`) }); } }, { owner: unit }); }
function installKjera(battle, unit, body) { const v = body.modePassives?.[0]?.values ?? {}; const base = v.atk; const high = v.highAtk; const need = Number(v.groundTilesRequired); if (!Array.isArray(base) || !Array.isArray(high) || base.length !== 4 || high.length !== 4 || !Number.isInteger(need)) throw new TypeError('Kjera compiled mode passive is incomplete'); const apply = () => { const ground = (unit.rangeKeys ?? []).filter((k) => battle.grid.isLow(Math.floor(k / COLS), k % COLS)).length; if (ground < 2) buff(battle, unit, unit, { key: key(unit.def.charId, 'mode:terrain'), mods: { atkMul: 1 + rangedLine(unit, 2, 'a') / 100 }, duration: 0.6 }); else battle.removeBuff(unit, key(unit.def.charId, 'mode:terrain')); void need; void high; void base; /* bazaar: 攻击范围内地面不足 2 格时，+a% 攻击力 */ }; apply(); deferTimer(battle, unit, 0.5, apply, { every: true }); }
function installRockr(battle, unit, body) {
  const values = body.modePassives?.[0]?.values ?? {}; const caps = values.maxStacks; const per = values.atkPerStack; const interval = Number(values.interval);
  if (!Array.isArray(caps) || !Array.isArray(per) || caps.length !== 4 || per.length !== 4 || !Number.isFinite(interval) || interval <= 0) throw new TypeError('Rockr compiled mode passive is incomplete');
  const clearFunnel = () => unit.mem.rockrFunnelRestore?.();
  battle.on('retreating', ({ unit: leaving }) => { if (leaving === unit) clearFunnel(); }, { owner: unit });
  battle.on('death', ({ unit: dead }) => { if (dead === unit) clearFunnel(); }, { owner: unit });
  deferTimer(battle, unit, interval, () => { unit.mem.rockrStacks = Math.min(Number(caps[rank(unit) - 1]) + (moduleOf(unit) ? 1 : 0), (unit.mem.rockrStacks ?? 0) + 1); buff(battle, unit, unit, { key: key(unit.def.charId, 'mode:stacks'), mods: { atkMul: 1 + unit.mem.rockrStacks * Number(per[rank(unit) - 1]) }, duration: Infinity }); }, { every: true });
}
function installMalist(battle, unit, body) {
  const spByCrit = body.modePassives?.[0]?.values?.sp;
  const talent = body.talentBindings?.find((entry) => entry.nativeTalentIndex === 0)?.translation?.parameters ?? {};
  if (!Number.isFinite(Number(talent.prob)) || !Number.isFinite(Number(talent.atkScale))) throw new TypeError('Malist compiled retained talent is incomplete');
  battle.on('beforeAttack', ({ attacker, targets, isSkill, profile }) => {
    if (attacker !== unit || isSkill || !targets.length) return;
    unit.mem.malistCrit = battle.rng() < Number(talent.prob) + (moduleOf(unit) ? 0.05 : 0);
    if (unit.mem.malistCrit) profile.atkScale = (profile.atkScale ?? 1) * Number(talent.atkScale);
  }, { owner: unit });
  watch(battle, unit, 'attack', key(unit.def.charId, 'mode:sp'), ({ payload }) => payload?.source === unit && payload.sourceClass === 'attack' && unit.mem.malistCrit, ({ cause }) => {
    unit.mem.malistCrit = false;
    sp(battle, unit, unit, Number(spByCrit?.[rank(unit) - 1]), 'mode:sp', key(unit.def.charId, 'mode:sp'), cause);
  });
}
function installOtter(battle, unit, body, piece) {
  // bazaar: 回收充能改为「当你的召唤物被回收时」 (ranged-bazaar.js).
  const talent = body.talentBindings.find((entry) => entry.nativeTalentIndex === 0)?.translation?.parameters ?? {};
  const nativeCount = Number(talent.count);
  const tokenDef = battle.tokenDef(TOKEN_IDS.char_242_otter, unit);
  const nativeFieldCap = Number(tokenDef?.talents?.[0]?.bb?.max_deploy_count ?? tokenDef?.talents?.[0]?.blackboard?.max_deploy_count ?? nativeCount);
  const preset = piece.summonPresets?.find((entry) => entry.tokenId === TOKEN_IDS.char_242_otter);
  if (!Number.isInteger(nativeCount) || nativeCount < 1 || !Number.isInteger(nativeFieldCap) || nativeFieldCap < 1) throw new TypeError('mechanical otter source count or native field cap is missing');
  battle.on('deploy', ({ unit: deployed }) => {
    if (deployed !== unit || unit.mem.otterInitialStockGranted) return;
    unit.mem.otterInitialStockGranted = true;
    const stockCap = nativeCount + (moduleOf(unit) ? 1 : 0);
    grantSummon(battle, unit, {
      tokenId: TOKEN_IDS.char_242_otter, count: stockCap, stockCap, fieldCap: nativeFieldCap,
      cost: Number(tokenDef?.stats?.cost ?? 0), ruleKey: key(unit.def.charId, 'nativeOtterStock'),
      ...(preset && Number.isInteger(preset.row) && Number.isInteger(preset.col) ? { preparedSlot: [preset.row, preset.col] } : null),
    });
  }, { owner: unit });
}
function installProve(battle, unit, body) {
  const passiveBonus = body.modePassives?.[0]?.values?.atkBonus;
  const killSp = body.fixedSkill.effects.find((effect) => effect.action === 'spGain')?.values?.sp;
  const crit = body.talentBindings?.find((entry) => entry.nativeTalentIndex === 0)?.translation?.parameters ?? {};
  if (!Array.isArray(passiveBonus) || !Number.isFinite(Number(crit.prob)) || !Number.isFinite(Number(crit.frontProb)) || !Number.isFinite(Number(crit.atkScale))) throw new TypeError('Prove compiled talent/passive is incomplete');
  battle.on('beforeAttack', ({ attacker, targets, isSkill, profile }) => {
    if (attacker !== unit || isSkill || !targets.length) return;
    const target = targets[0]; const dr = target.y - unit.tileR; const dc = target.x - unit.tileC;
    const facing = { UP: [-1, 0], RIGHT: [0, 1], DOWN: [1, 0], LEFT: [0, -1] }[unit.dir] ?? [0, 1];
    const front = dr === facing[0] && dc === facing[1];
    if (battle.rng() < Number(front ? crit.frontProb : crit.prob)) profile.atkScale = (profile.atkScale ?? 1) * Number(crit.atkScale);
    if (targets.some((t) => t.hp / t.s.maxHp < 0.5)) profile.atkScale = (profile.atkScale ?? 1) * (1 + Number(passiveBonus[rank(unit) - 1]));
  }, { owner: unit });
  if (!Array.isArray(killSp)) throw new TypeError('Prove compiled kill SP effect is missing');
  // bazaar: 技能击倒回技改为「当你的叙拉古干员击倒敌人时」 (ranged-bazaar.js).
}
// bazaar: 「当敌人获得寒冷或冻结时，为此干员充能」 replaces the self-only cold refund (ranged-bazaar.js).
function installSnhunt() {}
function installSlbell(battle, unit, body) {
  // bazaar: 当敌人获得寒冷或冻结时，为此干员充能 a（每场战斗前 30 次）。
  let charges = 0;
  watch(battle, unit, 'statusApplied', key(unit.def.charId, 'mode:coldSp'), ({ payload }) => payload?.target?.side === 'enemy' && (payload.status === 'cold' || payload.status === 'frozen'),
    ({ cause }) => { if (charges >= 30) return; charges++; sp(battle, unit, unit, rangedLine(unit, 1, 'a'), 'mode:coldSp', key(unit.def.charId, 'mode:coldSp'), cause); });
  // bazaar: 当敌人获得寒冷时，其 -b% 法术抗性，持续 5 秒（任意你的单位施加的寒冷）。
  watch(battle, unit, 'statusApplied', key(unit.def.charId, 'mode:res'), ({ payload }) => payload?.status === 'cold' && payload.target?.side === 'enemy' && payload.source?.side === 'ally' && payload.source.ownerId === unit.ownerId,
    ({ payload }) => { const target = targetFromEvent(battle, payload); if (target?.alive) buff(battle, unit, target, { key: key(unit.def.charId, 'mode:res'), mods: { resMul: 1 - rangedLine(unit, 2, 'b') / 100 }, duration: 5 }); });
}
function installVodfox(battle, unit) {
  const body = unit.def?.raw?.assaultBody ?? unit.def?.assaultBody;
  const fragileValues = body.modePassives?.[0]?.values ?? {}, spValues = body.modePassives?.[1]?.values?.sp;
  battle.on('tick', () => {
    if (!active(unit)) return;
    const ratio = Number(fragileValues.fragile?.[rank(unit) - 1]) + (moduleOf(unit) ? 0.05 : 0);
    for (const target of liveEnemies(battle, unit, battle.enemies.length)) if (target.hp / target.s.maxHp < Number(fragileValues.hpRatio)) applyStatus(battle, unit, target, { status: 'fragile', duration: 0.6, value: ratio, key: key(unit.def.charId, `mode:fragile:${uid(target)}`), cause: battle.assaultRuntime.currentCause });
  }, { owner: unit });
  // bazaar: 娃娃周围击倒回技改为「当你的叙拉古干员击倒敌人时」 (ranged-bazaar.js).
}
function installHaini(battle, unit) {
  const body = unit.def?.raw?.assaultBody ?? unit.def?.assaultBody;
  const fragileValues = body.modePassives?.[0]?.values?.fragile, spValues = body.modePassives?.[1]?.values?.sp;
  battle.on('tick', () => {
    if (!active(unit)) return;
    const value = rangedLine(unit, 1, 'b', Number(fragileValues?.[rank(unit) - 1]) * 100) / 100 + rangedModule(unit, 'uniequip_002_haini', 'a', 0) / 100;
    for (const target of liveEnemies(battle, unit, battle.enemies.length)) if (!enemyHasTag(target, 'elite') && !enemyHasTag(target, 'leader')) applyStatus(battle, unit, target, { status: 'fragile', duration: 0.6, value, key: key(unit.def.charId, `mode:fragile:${uid(target)}`), cause: battle.assaultRuntime.currentCause });
  }, { owner: unit });
  // bazaar: 齐射命中回技改为「攻击范围内的阿戈尔干员 +c% 攻击力」 (ranged-bazaar.js).
  void spValues;
}
function installProvs(battle, unit, body) {
  const spValues = body.modePassives?.[0]?.values?.sp;
  const talent = body.talentBindings?.find((entry) => entry.nativeTalentIndex === 0)?.translation?.parameters ?? {};
  if (!Number.isFinite(Number(talent.attackSpeed)) || !Number.isInteger(Number(talent.allyCount)) || typeof talent.allyNation !== 'string') throw new TypeError('Provs compiled retained talent is incomplete');
  const selfNation = unit.def?.nationId ?? unit.def?.raw?.assaultBody?.nationId;
  battle.on('deploy', ({ unit: deployed }) => {
    if (deployed !== unit) return;
    buff(battle, unit, unit, { key: key(unit.def.charId, 'talent:aspd'), mods: { aspd: Number(talent.attackSpeed) }, duration: Infinity, persist: true });
    const candidates = battle.allyUnits.filter((ally) => active(ally) && ally !== unit && (ally.def?.nationId ?? ally.def?.raw?.assaultBody?.nationId) === selfNation).slice(0, Number(talent.allyCount));
    if (candidates.length) buff(battle, unit, candidates[Math.floor(battle.rng() * candidates.length)], { key: key(unit.def.charId, 'talent:allyAspd'), mods: { aspd: Number(talent.attackSpeed) }, duration: Infinity, persist: true });
  }, { owner: unit });
  // bazaar: 自身施加回技改为「当你施加停顿或沉默时」 (ranged-bazaar.js).
}
function installGrabds(battle, unit) {
  // bazaar: 此干员 +c 攻速（对野生动物的停顿加成已删去）。
  const apply = () => buff(battle, unit, unit, { key: key(unit.def.charId, 'mode:aspd'), mods: { aspd: rangedLine(unit, 2, 'c') }, duration: Infinity, persist: true });
  battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) apply(); }, { owner: unit });
  if (active(unit)) apply();
}
function installCathy(battle, unit) {
  unit.mem.cathyDeviceTargets ??= new Set();
  watch(battle, unit, 'summonReturned', key(unit.def.charId, 'mode:deviceReturned'), ({ payload }) => payload?.source === unit && tokenIdOf(payload.target) === TOKEN_IDS.char_4162_cathy, () => {
    unit.mem.cathyDeviceTargets.clear();
    unit.mem.cathyDeviceTarget = null;
  });
}
function installHeidi(battle, unit, body) {
  const defValues = body.modePassives?.[0]?.values?.def;
  const apply = () => {
    const mode = body.modePassives?.[1]?.values?.spPerSec;
    const baseRate = Array.isArray(mode) ? Number(mode[rank(unit) - 1]) : 0;
    if (!Number.isFinite(baseRate) || baseRate < 0) throw new TypeError('Heidi compiled SP aura rate is missing');
    const mod = moduleOf(unit);
    const extraRate = mod?.id === 'uniequip_002_heidi' && mod.star >= 4 ? 0.1 : 0;
    for (const target of liveAllies(battle, unit, battle.allyUnits.length)) {
      buff(battle, unit, target, { key: key(unit.def.charId, `mode:def:${uid(target)}`), mods: { defMul: 1 + Number(defValues?.[rank(unit) - 1]) }, duration: 1 });
      void baseRate; void extraRate; // bazaar: 技力光环改为「当此干员施放技能时，加速攻击范围内的干员」 (ranged-bazaar.js).
    }
  };
  deferTimer(battle, unit, 1, apply, { every: true, immediate: true });
}
function installNcdeer(battle, unit, body) {
  const values = body.modePassives?.[0]?.values ?? {};
  const apply = (target, cause = null) => {
    if (!active(unit) || !active(target) || target.side !== 'ally' || target.hp / target.s.maxHp >= Number(values.hpRatio)) return;
    if (target !== unit && !liveAllies(battle, unit, battle.allyUnits.length).includes(target)) return;
    buff(battle, unit, target, { key: key(unit.def.charId, `mode:protect:${uid(target)}`), mods: { dmgTakenMul: 1 - (Number(values.damageResistance?.[rank(unit) - 1]) + (moduleOf(unit) ? 0.03 : 0)) }, duration: 1, cause });
  };
  battle.on('hpDamage', (payload) => apply(payload.target, battle.assaultRuntime.currentCause), { owner: unit });
  watch(battle, unit, 'deployed', key(unit.def.charId, 'mode:lowHp'), ({ payload, cause }) => payload?.target?.side === 'ally', ({ payload, cause }) => apply(payload.target, cause));
  battle.on('tick', () => {
    if (!active(unit)) return;
    const inRange = new Set([...liveAllies(battle, unit, battle.allyUnits.length), unit]);
    for (const target of battle.allyUnits) {
      if (target.kind !== 'device' && target.side === 'ally') {
        if (inRange.has(target)) apply(target, battle.assaultRuntime.currentCause);
        else battle.removeBuff(target, key(unit.def.charId, `mode:protect:${uid(target)}`));
      }
    }
  }, { owner: unit });
}
function installAngel(battle, unit, body) {
  const retained = body.talentBindings?.find((entry) => entry.nativeTalentIndex === 0)?.translation?.parameters ?? {};
  const blessing = body.modePassives?.[0]?.values ?? {};
  if (!Number.isFinite(Number(retained.attackSpeed)) || !Array.isArray(blessing.atk) || !Array.isArray(blessing.maxHp) || !Array.isArray(blessing.allyCount)) throw new TypeError('Angel compiled talent/passive is incomplete');
  buff(battle, unit, unit, { key: key(unit.def.charId, 'talent:aspd'), mods: { aspd: Number(retained.attackSpeed) }, duration: Infinity, persist: true });
  battle.on('beforeAttack', ({ attacker, profile, isSkill, targets }) => { if (attacker !== unit || isSkill) return; if (targets.some((t) => t.isFlying)) profile.atkScale = (profile.atkScale ?? 1) * 1.12; }, { owner: unit });
  const apply = () => {
    const mod = moduleOf(unit); const self = Number(blessing.atk[rank(unit) - 1]) + (mod?.id === 'uniequip_003_angel' && mod.star >= 4 ? 0.02 : 0); const hp = Number(blessing.maxHp[rank(unit) - 1]);
    // bazaar: 部署时，此干员和 n 名随机干员本场战斗中 +a% 攻击力（只保留攻击力）。
    void hp; void self;
    const pct = rangedLine(unit, 2, 'a') / 100 + (mod?.id === 'uniequip_003_angel' && mod.star >= 4 ? 0.02 : 0);
    buff(battle, unit, unit, { key: key(unit.def.charId, `mode:blessing:${uid(unit)}`), mods: { atkMul: 1 + pct }, duration: Infinity, persist: true });
    const pool = battle.allyUnits.filter((x) => x !== unit && active(x) && x.kind === 'op' && x.ownerId === unit.ownerId).sort((a, b) => uid(a).localeCompare(uid(b)));
    const count = Math.round(rangedLine(unit, 2, 'n')) + (mod?.id === 'uniequip_003_angel' ? 1 : 0);
    const targets = [];
    while (pool.length && targets.length < count) targets.push(...pool.splice(Math.floor(battle.rng() * pool.length), 1));
    for (const target of targets) buff(battle, unit, target, { key: key(unit.def.charId, `mode:blessing:${uid(target)}`), mods: { atkMul: 1 + pct }, duration: Infinity, persist: true });
  };
  battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) apply(); }, { owner: unit });
}
function installArchet(battle, unit, body) {
  const retained = body.talentBindings?.find((entry) => entry.nativeTalentIndex === 1)?.translation?.parameters ?? {};
  const passive = body.modePassives?.[0]?.values ?? {};
  battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) addShield(battle, unit, unit, Number(retained.shield), key(unit.def.charId, 'talent:shield')); }, { owner: unit });
  watch(battle, unit, 'shieldBroken', key(unit.def.charId, 'talent:shieldSp'), ({ payload }) => payload?.target === unit, ({ cause }) => sp(battle, unit, unit, Number(retained.spOnBreak), 'talent:shieldSp', key(unit.def.charId, 'talent:shieldSp'), cause));
  const interval = Math.max(0.1, Number(passive.interval?.[rank(unit) - 1]) - (moduleOf(unit)?.id === 'uniequip_003_archet' ? 0.3 : 0));
  // bazaar: 定时为狙击充能改为「当此干员施放技能时，加速你的狙击干员」 (ranged-bazaar.js).
}

const INSTALLERS = Object.freeze({ char_346_aosta: installAosta, char_002_amiya: installAmiya, char_306_leizi: installLeizi, char_344_beewax: installBeewax, char_373_lionhd: installLionhead, char_341_sntlla: installSntlla, char_4031_liesel: installLiesel, char_388_mint: installMint, char_446_aroma: installAroma, char_4013_kjera: installKjera, char_4040_rockr: installRockr, char_4054_malist: installMalist, char_242_otter: installOtter, char_145_prove: installProve, char_4211_snhunt: installSnhunt, char_174_slbell: installSlbell, char_254_vodfox: installVodfox, char_4079_haini: installHaini, char_4032_provs: installProvs, char_4122_grabds: installGrabds, char_4162_cathy: installCathy, char_4045_heidi: installHeidi, char_4019_ncdeer: installNcdeer, char_103_angel: installAngel, char_332_archet: installArchet });

function operatorBuilder(charId) {
  return (_bb, raw, def) => {
    if (def.charId !== charId || raw?.assaultBody?.charId !== charId || !raw.assaultPiece) throw new TypeError(`ranged-mid ${charId} requires its compiled assaultBody and assaultPiece`);
    const body = raw.assaultBody; const piece = raw.assaultPiece; const skill = SKILLS[charId]; const install = INSTALLERS[charId];
    if (typeof skill !== 'function' || typeof install !== 'function') throw new TypeError(`ranged-mid ${charId} is not explicitly bound`);
    const kit = makeKit(def, {
      cast: (ctx) => skill({ ...ctx, body, star: rank(ctx.unit) }),
      canCast: ({ battle, unit }) => charId === 'char_344_beewax' || charId === 'char_242_otter' || charId === 'char_254_vodfox' || liveEnemies(battle, unit, battle.enemies.length).length > 0 || charId === 'char_4045_heidi' || charId === 'char_4019_ncdeer',
      install: (battle, unit) => { install(battle, unit, body, piece); installRangedBazaar(battle, unit, body); },
    });
    // These fixed skills explicitly accumulate multiple natural-SP casts.  SkillRuntime
    // owns the charge counter; a private mem counter cannot preserve ready casts.
    if (charId === 'char_373_lionhd') {
      const moduleId = piece.moduleId ?? piece.moduleChoices?.[charId];
      const hasAdvanced = body.modulePlans.some((plan) => plan.id === moduleId && plan.type === 'ADVANCED') && piece.star >= 3;
      kit.skill.charges = [2, 2, 3, 3][piece.star - 1] + (hasAdvanced ? 1 : 0);
    }
    if (charId === 'char_4054_malist') {
      const moduleId = piece.moduleId ?? piece.moduleChoices?.[charId];
      const hasAdvancedFour = piece.star >= 4 && body.modulePlans.some((plan) => plan.id === moduleId && plan.type === 'ADVANCED');
      kit.skill.charges = 3 + (hasAdvancedFour ? 1 : 0);
    }
    if (charId === 'char_4211_snhunt') kit.skill.charges = 2;
    return kit;
  };
}

function tokenBuilder(tokenId) {
  return (_bb, raw, def) => {
    const owner = (unit) => unit.ownerUnit ?? null;
    const install = (battle, unit) => {
      const owning = owner(unit); if (!owning) throw new TypeError(`${tokenId} requires a runtime ownerUnit`);
      if (tokenId === TOKEN_IDS.char_344_beewax) { unit.profile.noAttack = true; unit.base.blockCnt = 2 + (moduleOf(owning)?.star >= 4 ? 1 : 0); unit.markDirty(); }
      if (tokenId === TOKEN_IDS.char_242_otter) {
        battle.on('blocked', ({ blocker, enemy }) => { if (blocker !== unit || !active(enemy)) return; applyStatus(battle, owning, enemy, { status: 'aspdDown', duration: 0.5, value: -25, key: `${tokenId}:slow:${uid(enemy)}` }); }, { owner: unit });
      }
      if (tokenId === TOKEN_IDS.char_254_vodfox) {
        unit.profile.noAttack = true;
        deferTimer(battle, unit, 0.5, () => { for (const target of around(battle, unit, 1)) { const ratio = rv(owning, [0.3, 0.35, 0.45, 0.5]) + (moduleOf(owning) ? 0.05 : 0); buff(battle, owning, target, { key: `${tokenId}:debuff:${uid(target)}`, mods: { atkMul: 1 - ratio, defMul: 1 - ratio }, duration: 0.6 }); } }, { every: true, immediate: true });
      }
      if (tokenId === TOKEN_IDS.char_4162_cathy) {
        unit.profile.noAttack = true;
        const target = battle.allyUnits.find((x) => uid(x) === owning.mem.cathyDeviceTarget && active(x)) ?? liveAllies(battle, owning, 1)[0] ?? owning; const ratio = rv(owning, [0.15, 0.17, 0.19, 0.22]) + (moduleOf(owning) ? 0.03 : 0); const rawShieldBonus = owning.def?.raw?.assaultPiece?.abilityBonuses?.shield ?? owning.inputPiece?.abilityBonuses?.shield; const shieldBonus = Number.isFinite(rawShieldBonus) && rawShieldBonus > 0 ? rawShieldBonus : 0; const cap = owning.s.maxHp * ratio + shieldBonus;
        addShield(battle, owning, target, owning.s.maxHp * ratio, `${tokenId}:shield:${uid(target)}`);
        deferTimer(battle, unit, 1, () => { if (active(target) && battle.time - (target.lastHitAt ?? -Infinity) >= 5) { const b = target.findBuff(`${tokenId}:shield:${uid(target)}`); if (b) b.shield = Math.min(cap, b.shield + owning.s.maxHp * (0.06 + (moduleOf(owning) ? 0.01 : 0)) + shieldBonus); } }, { every: true });
      }
    };
    return { skill: { id: tokenId, kind: 'passive', trigger: 'NEVER', spCost: 0, assaultCast: () => false, onStart: () => false }, install };
  };
}

export const rangedMidCards = Object.freeze(Object.fromEntries(rangedMidCharIds.map((id) => [id, operatorBuilder(id)])));
export const rangedMidTokenKits = Object.freeze(Object.fromEntries(Object.values(TOKEN_IDS).map((id) => [id, tokenBuilder(id)])));
