import { active, allies, enemies, damage, heal, buff, applyStatus, sp, onTimer, uid, unitTag, tileOf } from '../primitives.js';
import { assaultAmmoState, reloadAssaultAmmo } from '../ammo.js';

export const RELIC_EVENTS = new Set([
  'kill', 'damageTaken', 'statusApplied', 'battleStart', 'redeploy', 'ammoUsed', 'reloaded', 'hit',
  'skillStart', 'skillResolved', 'elementBurst', 'summonSpawned', 'deployed', 'summonDied', 'battleEnd',
  'purchase', 'hourStarted', 'deploymentCost', 'attack',
]);
export const RELIC_ACTIONS = new Set(['applyStatus', 'addBuff', 'damage', 'redeploy', 'ammo', 'spCost', 'spGain', 'heal', 'summon', 'shield', 'growth', 'economy']);
export const RELIC_TARGETS = new Set([
  'killedEnemyAdjacent', 'self', 'statusTarget', 'allAllies', 'allEnemies', 'longestRedeployingAlly',
  'randomEnemyAndAdjacent', 'skillOwner', 'hitTargetAndAdjacent', 'rangedAllies', 'burstTarget', 'burstSourceOwner',
  'spawnedEntity', 'deployingEntity', 'spawnedEntityAdjacent', 'summonOwner', 'ownerOfSummon', 'selfWithinGoalAdjacent8',
  'blockedEnemies', 'hitTarget', 'killerSelf', 'randomAllies', 'runAccount', 'randomEnemy', 'rightmostStandbyAlly',
  'chosenDeployTile', 'owner',
]);

export const idOf = (value) => value?.uid ?? value?.id ?? null;
export const unitOf = (payload) => payload?.unit ?? payload?.source ?? payload?.attacker ?? payload?.killer ?? payload?.target ?? null;
export const sourceOf = (payload) => payload?.source ?? payload?.attacker ?? payload?.killer ?? payload?.unit ?? null;
export const targetOf = (payload) => payload?.target ?? payload?.victim ?? payload?.unit ?? null;
export const keyOf = (unit) => unit == null ? null : String(idOf(unit));

export function bodyOf(unit) {
  return unit?.def?.raw?.assaultBody ?? unit?.def?.assaultBody ?? unit?.raw?.assaultBody ?? {};
}

export function pieceOf(unit) {
  return unit?.input_piece ?? unit?.inputPiece ?? unit?.def?.raw?.assaultPiece ?? unit?.def?.assaultPiece ?? {};
}

export function charIdOf(unit) {
  return unit?.def?.charId ?? bodyOf(unit).charId ?? pieceOf(unit).charId ?? null;
}

export function professionOf(unit) {
  return unit?.def?.profession ?? bodyOf(unit).profession ?? unit?.profession ?? null;
}

export function positionOf(unit) {
  return unit?.def?.position ?? bodyOf(unit).position ?? (unit?.ground === false ? 'RANGED' : null);
}

export function archetypeTags(unit) {
  const body = bodyOf(unit);
  const raw = [body.archetype, body.subProfession, body.subProfessionId, unit?.def?.archetype, unit?.def?.subProfessionId,
    ...(body.tags ?? []), ...(unit?.def?.tags ?? [])].filter(Boolean).map(String);
  const aliases = {
    '速射手': ['marksman', 'fastshot'], '回环射手': ['loopshooter'], '哨戒铁卫': ['sentinel', 'watchman'],
    '铁卫': ['protector'], '驭法铁卫': ['artsprotector'], '决战者': ['duelist'],
    '无畏者': ['dreadnought', 'fearless'], '剑豪': ['swordmaster', 'sword'], '教官': ['instructor'],
    '收割者': ['reaper'], '武者': ['musha'], '斗士': ['fighter'],
    '中坚术师': ['corecaster'], '秘术师': ['mysticcaster', 'mystic'], '召唤师': ['summoner'],
  };
  for (const tag of [...raw]) if (aliases[tag]) raw.push(...aliases[tag]);
  for (const [label, ids] of Object.entries(aliases)) if (ids.some((id) => raw.includes(id))) raw.push(label, ...ids);
  return new Set(raw);
}

export function adjacentUnits(battle, anchor, side, diagonal = true) {
  if (!anchor) return [];
  const [r, c] = tileOf(anchor);
  const list = side === 'enemy' ? battle.enemies : battle.allyUnits;
  return list.filter((unit) => {
    if (!active(unit) || unit === anchor) return false;
    const [ur, uc] = tileOf(unit);
    const dr = Math.abs(ur - r), dc = Math.abs(uc - c);
    return diagonal ? Math.max(dr, dc) <= 1 : dr + dc === 1;
  });
}

export function allField(battle, side) {
  return (side === 'enemy' ? battle.enemies : battle.allyUnits).filter((unit) => active(unit));
}

export function ownerOf(unit) { return unit?.ownerUnit ?? unit?.owner ?? null; }
export function isMelee(unit) { return positionOf(unit) === 'MELEE' || (unit?.ground !== false && positionOf(unit) !== 'RANGED'); }
export function isRanged(unit) { return positionOf(unit) === 'RANGED' || unit?.ground === false; }
export function isSummon(unit) { return unit?.kind === 'token' || unit?.kind === 'device'; }

export function selectedTargets(battle, effect, payload) {
  const selection = effect.target?.selection;
  const actor = sourceOf(payload) ?? targetOf(payload);
  const target = targetOf(payload);
  const owner = ownerOf(target) ?? ownerOf(actor);
  const allA = () => allField(battle, 'ally');
  const allE = () => allField(battle, 'enemy');
  switch (selection) {
    case 'self': return (effect.trigger === 'damageTaken' ? target : actor) ? [(effect.trigger === 'damageTaken' ? target : actor)] : [];
    case 'owner': {
      if (owner) return [owner];
      if (effect.condition?.ownerCharId) return allA().filter((unit) => charIdOf(unit) === effect.condition.ownerCharId);
      return [];
    }
    case 'skillOwner': return actor ? [actor] : [];
    case 'statusTarget': return target ? [target] : [];
    case 'hitTarget': return target ? [target] : [];
    case 'killedEnemyAdjacent': return adjacentUnits(battle, target, 'enemy', true);
    case 'hitTargetAndAdjacent': return target ? [target, ...adjacentUnits(battle, target, 'enemy', false)] : [];
    case 'randomEnemyAndAdjacent': {
      const chosen = allE();
      const picked = chosen.length ? battle.rng.pick(chosen) : null;
      return picked ? [picked, ...adjacentUnits(battle, picked, 'enemy', true)] : [];
    }
    case 'randomEnemy': {
      const chosen = allE();
      const picked = chosen.length ? battle.rng.pick(chosen) : null;
      return picked ? [picked] : [];
    }
    case 'allAllies': return allA();
    case 'allEnemies': return allE();
    case 'rangedAllies': return allA().filter(isRanged);
    case 'burstTarget': return target ? [target] : [];
    case 'burstSourceOwner': return owner ? [owner] : (actor ? [actor] : []);
    case 'spawnedEntity': return target ? [target] : [];
    case 'deployingEntity': return target ? [target] : (actor ? [actor] : []);
    case 'spawnedEntityAdjacent': return adjacentUnits(battle, target, 'ally', false);
    case 'summonOwner': return owner ? [owner] : [];
    case 'ownerOfSummon': return owner ? [owner] : [];
    case 'blockedEnemies': return actor?.blocking?.filter((unit) => active(unit)) ?? [];
    case 'killerSelf': return sourceOf(payload) ? [sourceOf(payload)] : [];
    case 'longestRedeployingAlly': {
      // Waiting operators are intentionally not in allField(): the normal field
      // query only contains active/deployed units.  Use the deployment state
      // owned by the battle instead of manufacturing a standby list.
      const waiting = (battle.allyUnits ?? []).filter((unit) => unit !== actor && unit.kind === 'op'
        && !unit.deployed && !unit.removed && (Number.isFinite(unit.respawnAt) || unit.mem?.assaultPendingEntry));
      waiting.sort((a, b) => (Number(b.respawnAt ?? -Infinity) - Number(a.respawnAt ?? -Infinity)) || keyOf(a).localeCompare(keyOf(b)));
      return waiting.slice(0, 1);
    }
    case 'selfWithinGoalAdjacent8': return actor && nearGoal(battle, actor) ? [actor] : [];
    case 'rightmostStandbyAlly': {
      const standby = (battle.allyUnits ?? []).filter((unit) => unit.kind === 'op' && !unit.alive && !unit.removed);
      standby.sort((a, b) => (b.homeC ?? b.tileC ?? 0) - (a.homeC ?? a.tileC ?? 0) || keyOf(a).localeCompare(keyOf(b)));
      return standby.slice(0, 1);
    }
    case 'randomAllies': {
      const list = allA();
      const count = effect.target?.count === 2 ? 2 : 1;
      return battle.rng.shuffle(list).slice(0, count);
    }
    case 'runAccount': return [];
    case 'chosenDeployTile': {
      if (actor) return [actor];
      if (effect.condition?.ownerCharId) return allA().filter((unit) => charIdOf(unit) === effect.condition.ownerCharId);
      return [];
    }
    default: throw new TypeError(`unknown assault relic target selection ${selection}`);
  }
}

function nearGoal(battle, unit) {
  const [r, c] = tileOf(unit);
  const goals = battle.grid?.specialTiles?.('end') ?? [];
  if (!goals.length) return false;
  return goals.some((goal) => {
    const gr = Array.isArray(goal) ? goal[0] : goal?.r ?? goal?.row;
    const gc = Array.isArray(goal) ? goal[1] : goal?.c ?? goal?.col;
    return Number.isFinite(gr) && Number.isFinite(gc) && Math.max(Math.abs(gr - r), Math.abs(gc - c)) <= 1;
  });
}

export function assaultAmmoOf(unit) {
  return assaultAmmoState(unit);
}

export function isAmmoSkill(unit, payload = {}) {
  // The real adapter marks the event before the card kit unregisters its
  // controller on the final round.  That event is still a valid ammo event.
  return payload?.assaultAmmo === true || !!assaultAmmoState(unit);
}

/**
 * 弹药技能期间. A loading ammo skill (synergy ammoSkill): rounds are loaded, or the hit comes from an attack that spent
 * one (a projectile of the last round lands after the pool is empty). Any other ammo event as before.
 */
export function inAmmoSkill(unit, payload = {}) {
  if(unit?.mem?.assaultCastAmmo)return unit.mem.assaultCastAmmo.current>0||payload.skillId!=null||payload.dmg?.isSkill===true;
  const state = unit?.mem?.assaultAmmoSkill;
  if (!state) return isAmmoSkill(unit, payload);
  return state.left > 0 || (payload?.attackId != null && !!state.rounds?.has(payload.attackId));
}

export function ammoMaxOf(unit, payload = {}) {
  return assaultAmmoState(unit)?.capacity ?? (Number.isFinite(payload?.ammoMax) ? Number(payload.ammoMax) : null);
}

export function ammoLeftOf(unit, payload = {}) {
  return assaultAmmoState(unit)?.current ?? (Number.isFinite(payload?.left) ? Number(payload.left) : 0);
}

export function matchesArchetype(unit, list) {
  if (!Array.isArray(list)) return false;
  const tags = archetypeTags(unit);
  return list.some((value) => tags.has(String(value)) || unit?.def?.archetype === value || bodyOf(unit).archetype === value);
}

export function addShield(battle, source, target, params, key) {
  const layers = Number(params.layers ?? 1);
  if (!Number.isInteger(layers) || layers < 1) throw new TypeError(`invalid shield layers for ${key}`);
  const amount = params.layerAmountRatioMaxHp != null ? target.s.maxHp * Number(params.layerAmountRatioMaxHp)
    : params.amountRatioOfOriginalMaxHp != null ? (target.base?.maxHp ?? target.s.maxHp) * Number(params.amountRatioOfOriginalMaxHp)
      : target.s.maxHp * Number(params.amountRatioMaxHp ?? 0);
  const actual = Math.max(Number(params.minAmount ?? 1), amount);
  if (!(actual > 0) || !Number.isFinite(actual)) return false;
  if (layers > 1) {
    for (let index = 0; index < layers; index += 1) battle.addBuff(target, {
      key: `${key}:layer:${index}`, shield: actual, refresh: 'replace', visible: true, source,
    });
  } else battle.addBuff(target, { key: `${key}:shield`, shield: actual, refresh: 'replace', visible: true, source });
  return true;
}

export function reloadSkill(battle, unit, amount, key) {
  const grant=unit?.mem?.assaultCastAmmo&&Number(amount)>0?1:Math.max(0,Math.floor(Number(amount)));
  return reloadAssaultAmmo(battle, unit, unit, grant, key);
}

export function applyStatBuff(battle, source, target, params, key, { duration = Infinity, persist = false, stacking = 'replace', allowDead = false } = {}) {
  const mods = {};
  if (params.maxHp != null) mods.hpMul = Number(params.maxHp);
  if (params.maxHpMul != null) mods.hpMul = Number(params.maxHpMul);
  if (params.hpMul != null) mods.hpMul = Number(params.hpMul);
  if (params.atk != null) mods.atkMul = 1 + Number(params.atk);
  if (params.atkRatio != null) mods.atkMul = 1 + Number(params.atkRatio);
  if (params.atkRatioPerStack != null) mods.atkPct = Number(params.atkRatioPerStack);
  if (params.def != null) mods.defMul = 1 + Number(params.def);
  if (params.defMul != null) mods.defMul = Number(params.defMul);
  if (params.res != null) mods.resMul = 1 + Number(params.res);
  if (params.attackSpeed != null) mods.aspd = Number(params.attackSpeed);
  if (params.blockCountAdd != null) mods.blockCnt = Number(params.blockCountAdd);
  if (params.elementGaugeTakenMul != null) mods.elemTakenMul = Number(params.elementGaugeTakenMul);
  if (params.dmgDealtMul != null) mods.dmgDealtMul = Number(params.dmgDealtMul);
  if (params.arts != null) mods.artsTakenMul = Number(params.arts);
  if (params.damageTaken != null) mods.dmgTakenMul = Number(params.damageTaken);
  if (params.shelter != null) mods.dmgTakenMul = 1 - Number(params.shelter);
  if (params.shelter === 0.1) mods.dmgTakenMul = 0.9;
  if (params.spRecovery != null) mods.spRecoveryFlat = Number(params.spRecovery);
  if (params.spPerSecond != null) mods.spRecoveryFlat = Number(params.spPerSecond);
  if (params.redeployCooldownMul != null) mods.redeployMul = Number(params.redeployCooldownMul);
  if (params.attackIntervalMultiplier != null) mods.batPct = Number(params.attackIntervalMultiplier) - 1;
  if (params.atkSpeed != null) mods.aspd = Number(params.atkSpeed);
  if (params.defIgnore != null) mods.defIgnorePct = Number(params.defIgnore);
  if (params.defIgnoreRatio != null) mods.defIgnorePct = Number(params.defIgnoreRatio);
  if (params.resIgnore != null) mods.resIgnorePct = Number(params.resIgnore);
  for (const forbidden of ['damage', 'ammo']) if (params[forbidden] != null) throw new TypeError(`unsupported native assault modifier ${forbidden}`);
  if (!Object.keys(mods).length) return false;
  const oldMaxHp = Number(target.s?.maxHp);
  const oldHpRatio = params.currentHpFollow === 'scale' && oldMaxHp > 0 ? Number(target.hp ?? 0) / oldMaxHp : null;
  buff(battle, source, target, { key, mods, duration, persist, stacking, maxStacks: params.maxStacks ?? 1, allowDead: allowDead || params.allowDead === true });
  if (oldHpRatio != null) {
    target.hp = Math.max(0, Math.min(target.s.maxHp, target.s.maxHp * oldHpRatio));
    target.markDirty?.();
  }
  if (params.minHp != null && target.alive && target.hp < Number(params.minHp)) {
    target.hp = Math.min(target.s.maxHp, Number(params.minHp));
    target.markDirty?.();
  }
  return true;
}

export { active, allies, enemies, damage, heal, buff, applyStatus, sp, onTimer, uid, unitTag };
