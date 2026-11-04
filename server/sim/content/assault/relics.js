import {
  RELIC_ACTIONS, RELIC_EVENTS, RELIC_TARGETS, active, addShield, adjacentUnits, allField,
  applyStatBuff, applyStatus, archetypeTags, bodyOf, charIdOf, damage, enemies, heal, isMelee, isRanged,
  isSummon, keyOf, matchesArchetype, ownerOf, pieceOf, positionOf, professionOf, reloadSkill, selectedTargets,
  sourceOf, sp, targetOf, uid, unitOf, buff, onTimer, isAmmoSkill, inAmmoSkill, ammoLeftOf, ammoMaxOf,
} from './relics/helpers.js';
import { installWorkshopRelic } from './relics/workshop.js';
import { gainDP, haste } from './primitives.js';
import { installUpgrades } from './upgrades.js';
import { roundHalfEven } from '../../detmath.js';

const CONDITION_KEYS = new Set([
  'acquisition', 'affectsNewEnemies', 'ammoAtLeast', 'applied', 'archetypeIn', 'auraRefresh', 'battleResolved',
  'blockingCountAtLeast', 'buffActive', 'burstOwnerOnField', 'chargeTypeIn', 'counter', 'counterAtLeast',
  'critRoll', 'duringSkillTag', 'elementIn', 'entryKind', 'fieldHasProfession', 'firstDeploy', 'firstGroundDeploy',
  'firstSkillPerUnit', 'hasEnemies', 'hasStandby', 'killedTeam', 'killerArchetypeIn', 'noRemainingSummonOfOwner',
  'oncePerRun', 'oncePerSkill', 'ownerCharId', 'ownerDeployType', 'ownerOnField', 'ownerPosition', 'ownerProfession',
  'ownerProfessionIn', 'periodSec', 'phase', 'professionIn', 'realEntryOnly', 'remainingRatioAtMost',
  'requireOwnerInFormation', 'requiresAnyAllyShield', 'requiresPaidDeployment', 'rewardKind', 'shopAction',
  'skillTag', 'sourceTeam', 'spawnKind', 'spawnKindIn', 'statusIn', 'targetTeam', 'templateIds', 'victory',
  'withinGoalAdjacent8', 'requireRealOwner', 'sourceChargeTypeIn', 'firstRealSummonEntry', 'sourceClass',
]);

const number = (value, label) => {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new TypeError(`assault relic ${label} must be finite`);
  return result;
};
const effectKey = (relicId, index) => `relic:${relicId}:${index}`;
const actorFor = (_battle, payload) => sourceOf(payload) ?? payload?.unit ?? null;
const teamOf = (unit) => unit?.side === 'enemy' ? 'enemy' : unit?.side === 'ally' ? 'ally' : null;

function highGround(battle, unit) {
  if (!unit) return false;
  const r = Number.isFinite(unit.tileR) ? unit.tileR : roundHalfEven(unit.y);
  const c = Number.isFinite(unit.tileC) ? unit.tileC : roundHalfEven(unit.x);
  const tile = battle.grid?.tile?.(r, c);
  return tile?.height === 'HIGH' && tile.build !== 'NONE';
}

function allRelicItems(design) {
  if (!Array.isArray(design?.collectibles?.items)) throw new TypeError('assault relic design requires collectibles.items');
  return design.collectibles.items;
}

function validateDesign(design) {
  const seen = new Set();
  for (const item of allRelicItems(design)) {
    if (!item?.id || seen.has(item.id)) throw new Error(`invalid or duplicate assault relic ${item?.id}`);
    seen.add(item.id);
    for (const [index, effect] of (item.effects ?? []).entries()) {
      if (!RELIC_EVENTS.has(effect.trigger)) throw new TypeError(`unknown assault relic trigger ${effect.trigger} at ${item.id}/${index}`);
      if (!RELIC_ACTIONS.has(effect.action)) throw new TypeError(`unknown assault relic action ${effect.action} at ${item.id}/${index}`);
      if (!RELIC_TARGETS.has(effect.target?.selection)) throw new TypeError(`unknown assault relic target ${effect.target?.selection} at ${item.id}/${index}`);
      for (const key of Object.keys(effect.condition ?? {})) if (!CONDITION_KEYS.has(key)) throw new TypeError(`unknown assault relic condition ${key} at ${item.id}/${index}`);
    }
  }
}

function relicUnit(state, battle, unit) {
  if (unit) return unit;
  return battle.allyUnits?.find((candidate) => candidate.kind === 'op' && state.pieces.has(candidate.uid)) ?? null;
}

function resetKey(state, key) {
  state.counts.set(key, state.counts.get(key) ?? 0);
}

function conditionMatches(state, battle, effect, payload, target, late = false) {
  const c = effect.condition ?? {};
  const actor = sourceOf(payload) ?? unitOf(payload) ?? target;
  const eventTarget = targetOf(payload) ?? target;
  const owner = ownerOf(eventTarget) ?? (eventTarget?.side === 'ally' && sourceOf(payload)?.side === 'enemy' ? eventTarget : ownerOf(actor) ?? actor);
  if (c.phase === 'battleStart' && !state.started) return false;
  if (c.victory != null && Boolean(payload?.victory) !== Boolean(c.victory)) return false;
  if (c.battleResolved === true && payload?.battleResolved !== true) return false;
  if (c.killedTeam && teamOf(eventTarget) !== c.killedTeam) return false;
  if (c.targetTeam && teamOf(eventTarget) !== c.targetTeam) return false;
  if (c.sourceTeam && teamOf(sourceOf(payload)) !== c.sourceTeam) return false;
  if (c.sourceClass && payload?.sourceClass !== c.sourceClass) return false;
  if (c.statusIn && !c.statusIn.includes(payload?.status)) return false;
  if (c.elementIn) {
    const elementAliases = { '凋亡': 'apoptosis', '灼燃': 'burn', '神经': 'neural', '侵蚀': 'erosion' };
    if (!c.elementIn.some((value) => String(value) === String(payload?.element) || elementAliases[value] === payload?.element)) return false;
  }
  if (c.applied === true && (payload?.status == null || payload?.applied === false || payload?.success === false
    || payload?.immune === true || payload?.failed === true || payload?.keepalive === true)) return false;
  if (c.ownerCharId && charIdOf(owner ?? actor) !== c.ownerCharId) return false;
  if (c.ownerProfession && professionOf(owner ?? actor) !== c.ownerProfession) return false;
  if (c.ownerProfessionIn && !c.ownerProfessionIn.some((value) => archetypeTags(owner ?? actor).has(String(value))
    || professionOf(owner ?? actor) === value)) return false;
  if (c.professionIn && !c.professionIn.some((value) => archetypeTags(owner ?? actor).has(String(value)) || professionOf(owner ?? actor) === value)) return false;
  if (c.ownerDeployType === 'melee' && !isMelee(owner ?? actor)) return false;
  if (c.ownerDeployType === 'ranged' && !isRanged(owner ?? actor)) return false;
  if (c.ownerPosition === 'highGround' && !highGround(battle, owner ?? actor)) return false;
  if (c.fieldHasProfession && !battle.allyUnits?.some((unit) => active(unit) && professionOf(unit) === c.fieldHasProfession)) return false;
  if (c.blockingCountAtLeast != null && ((owner ?? actor)?.blocking?.length ?? 0) < c.blockingCountAtLeast) return false;
  if (c.requiresAnyAllyShield && state.openingHadShield !== true) return false;
  if (c.hasEnemies && !battle.enemies?.some((unit) => active(unit))) return false;
  if (c.hasStandby && !battle.allyUnits?.some((unit) => unit.kind === 'op' && !unit.alive && !unit.removed)) return false;
  const spawnKind = eventTarget?.kind === 'token' ? 'summon' : eventTarget?.kind === 'op' ? 'operator' : eventTarget?.kind;
  if (c.spawnKind && c.spawnKind !== spawnKind) return false;
  if (c.spawnKindIn && !c.spawnKindIn.includes(spawnKind)) return false;
  if (c.templateIds && !c.templateIds.includes(eventTarget?.defId ?? eventTarget?.def?.id)) return false;
  if (c.realEntryOnly && (eventTarget?.deployed !== true || eventTarget?.removed || eventTarget?.alive !== true)) return false;
  if (c.requireRealOwner && !eventTarget?.ownerUnit) return false;
  if (c.ownerOnField && !active(owner ?? actor)) return false;
  if (c.requireOwnerInFormation && !active(owner ?? actor)) return false;
  if (c.requiresPaidDeployment && !(Number(payload?.actualPaid) > 0)) return false;
  const skillEntry = payload?.skillEntry === true || payload?.skill === true;
  if (c.entryKind === 'deploy' && skillEntry) return false;
  // The runtime's redeploy event covers both a natural wait completion and a
  // free skill redeploy.  `entryKind: redeploy` means that later-entry path;
  // fee attribution is handled separately by the root deployment API.
  if (c.firstDeploy && payload?.firstNaturalDeploy !== true) return false;
  if (c.firstRealSummonEntry && state.unitClaims.has(`${effect._key}:summon-entry:${keyOf(eventTarget)}`)) return false;
  if (c.firstGroundDeploy && payload?.firstGroundDeploy !== true) return false;
  if (c.withinGoalAdjacent8 && !nearGoal(battle, eventTarget)) return false;
  if (c.firstSkillPerUnit && state.unitClaims.has(`${effect._key}:firstSkill:${keyOf(actor)}`)) return false;
  if (c.skillTag === 'ammo' && !isAmmoSkill(actor, payload)) return false;
  if (c.duringSkillTag === 'ammo' && !inAmmoSkill(actor, payload)) return false;
  if (c.chargeTypeIn && effect.trigger !== 'battleStart' && !c.chargeTypeIn.includes(payload?.type ?? payload?.source?.skill?.spType ?? (effect.trigger === 'attack' ? 'attack' : 'hit'))) return false;
  if (c.sourceChargeTypeIn) {
    const native = String(bodyOf(owner ?? actor).fixedSkill?.source?.native?.spData?.spType ?? '').toUpperCase();
    const kind = native.includes('ATTACK') ? 'attack' : native.includes('DAMAGE') || native.includes('HURT') ? 'hurt' : native.includes('TIME') ? 'time' : 'none';
    if (!c.sourceChargeTypeIn.includes(kind)) return false;
  }
  if (c.ammoAtLeast != null && Math.max(state.relicAmmo.get(keyOf(actor)) ?? 0, ammoLeftOf(actor, payload)) < c.ammoAtLeast) return false;
  if (c.remainingRatioAtMost != null) {
    const max = ammoMaxOf(actor, payload);
    if (!isAmmoSkill(actor, payload) || !(max > 0) || ammoLeftOf(actor, payload) / max > c.remainingRatioAtMost) return false;
  }
  if (c.archetypeIn && !matchesArchetype(actor, c.archetypeIn)) return false;
  if (c.killerArchetypeIn && !matchesArchetype(sourceOf(payload), c.killerArchetypeIn)) return false;
  if (c.burstOwnerOnField && !active(owner ?? actor)) return false;
  if (c.noRemainingSummonOfOwner && battle.allyUnits?.some((unit) => unit.kind === 'token' && active(unit) && ownerOf(unit) === owner)) return false;
  if (c.counterAtLeast != null && (state.counters.get(`${effect._relicId}:${c.counter ?? 'counter'}:${keyOf(eventTarget)}`) ?? 0) < c.counterAtLeast) return false;
  if (c.buffActive && !target?.buffs?.some((entry) => entry.key === c.buffActive || entry.data?.assaultBuff === c.buffActive)) return false;
  if (late && effect.trigger === 'battleStart' && !c.affectsNewEnemies && target?.side === 'enemy') return false;
  return true;
}

function nearGoal(battle, unit) {
  const r = Number.isFinite(unit?.tileR) ? unit.tileR : roundHalfEven(unit?.y);
  const c = Number.isFinite(unit?.tileC) ? unit.tileC : roundHalfEven(unit?.x);
  return (battle.grid?.specialTiles?.('end') ?? []).some((goal) => {
    const gr = Array.isArray(goal) ? goal[0] : goal?.r ?? goal?.row;
    const gc = Array.isArray(goal) ? goal[1] : goal?.c ?? goal?.col;
    return Number.isFinite(gr) && Number.isFinite(gc) && Math.max(Math.abs(gr - r), Math.abs(gc - c)) <= 1;
  });
}

function limitEntries(effect, target, payload) {
  const unit = target ?? unitOf(payload);
  const keys = {
    perDeployment: `${effect._key}:deployment:${keyOf(unit)}:${unit?.deploySeq ?? 0}`,
    perBattle: ['redeploy-spring', 'summon-poeticrelic'].includes(effect._relicId) || effect.params?.buff === 'houndCoffeeMark'
      ? `${effect._key}:battle`
      // Attack and hurt share one per-operator budget (「每场战斗前 25 次」).
      : effect._relicId === 'cycle-royalliqueur' ? `relic:${effect._relicId}:battle:${keyOf(unit) ?? 'run'}`
        : `${effect._key}:battle:${keyOf(unit) ?? 'run'}`,
    perHour: `${effect._key}:hour:${keyOf(unit) ?? 'run'}`,
    perRun: `${effect._key}:run`,
  };
  const entries = Object.entries(effect.limits ?? {}).filter(([scope, limit]) => keys[scope] && limit != null)
    .map(([scope, limit]) => [keys[scope], Number(limit)]);
  if (effect.condition?.oncePerRun && effect.limits?.perRun == null) entries.push([keys.perRun, 1]);
  return entries;
}

function allowed(state, effect, target, payload) {
  return limitEntries(effect, target, payload).every(([key, limit]) => (state.counts.get(key) ?? 0) < limit);
}

function count(state, effect, target, payload) {
  for (const [key] of limitEntries(effect, target, payload)) state.counts.set(key, (state.counts.get(key) ?? 0) + 1);
}

function isAlly(unit) { return unit?.side === 'ally'; }

function applyHoundCoffeeToBossPool(battle, source, target, params, key) {
  const pool = target?.bossPool;
  if (!pool || Object.hasOwn(pool, 'pool')) return false; // CreditPool is a read-only proxy for another mode's shared pool.
  const sharedPool = pool.byPlayer instanceof Map && Object.hasOwn(pool, 'maxHp') && Object.hasOwn(pool, 'hp');
  const localPool = Object.hasOwn(pool, 'maxHp') && Object.hasOwn(pool, 'serverHp')
    && Object.hasOwn(pool, 'cum') && Object.hasOwn(pool, 'acked');
  if (!sharedPool && !localPool) return false;

  const multiplier = Number(params.maxHpMul ?? params.maxHp);
  const maxHp = Number(pool.maxHp);
  const hp = Number(pool.hp);
  if (!Number.isFinite(multiplier) || multiplier <= 0 || !Number.isFinite(maxHp) || maxHp <= 0
      || !Number.isFinite(hp) || hp < 0 || target.findBuff?.(key)) return false;
  const nextMaxHp = maxHp * multiplier;
  const nextHp = params.currentHpFollow === 'scale' ? hp * multiplier : hp;
  if (!Number.isFinite(nextMaxHp) || !Number.isFinite(nextHp)) return false;

  const marker = battle.addBuff(target, { key, duration: params.durationSec == null ? Infinity : Number(params.durationSec),
    refresh: 'replace', visible: true, source, data: { assaultBuff: 'houndCoffeeMark', maxHpMul: multiplier } });
  if (!marker) return false;
  pool.maxHp = nextMaxHp;
  pool.hp = Math.max(0, Math.min(nextMaxHp, nextHp));
  const linked = new Set((battle.enemies ?? []).filter((enemy) => enemy.bossPool === pool));
  linked.add(target);
  for (const enemy of linked) battle._syncBossHp(enemy);
  return true;
}

function applyAddBuff(state, battle, effect, source, target, payload) {
  const p = effect.params ?? {};
  const key = effect._key;
  if (p.buff === 'houndCoffeeMark' && target?.bossPool) return applyHoundCoffeeToBossPool(battle, source, target, p, key);
  if (p.buff === 'invulnerable') {
    battle.addBuff(target, { key, duration: Number(p.durationSec ?? 2), flags: { invulnerable: true }, refresh: 'replace', source });
    return true;
  }
  if (p.buff === 'frostShell') {
    const marker = { key, status: p.onNextAttack?.status, duration: p.onNextAttack?.durationSec ?? 2 };
    battle.addBuff(target, { key, duration: p.durationSec ?? 5, refresh: 'replace', visible: false, source,
      onRemove: () => { if (target._assaultFrostShell === marker) delete target._assaultFrostShell; } });
    target._assaultFrostShell = marker;
    return true;
  }
  if (p.buff === 'coldSurge') {
    const counterKey = `${effect._relicId}:coldSurge:${keyOf(target)}`;
    const stacks = Math.min(Number(p.maxStacks ?? 3), (state.counters.get(counterKey) ?? 0) + Number(p.perApply ?? 1));
    state.counters.set(counterKey, stacks);
    battle.addBuff(target, { key, duration: Infinity, visible: false, source, data: { assaultBuff: 'coldSurge' } });
    return true;
  }
  if (p.buff === 'pierceNext') { target._assaultPierceNext = { key, ratio: p.defIgnoreRatio ?? 0.5 }; return true; }
  if (p.buff === 'frostEdge' || p.buff === 'frostSigil') {
    target._assaultColdOnAttack = { key, duration: p.onAttackStatus?.durationSec ?? 1 };
    return applyStatBuff(battle, source, target, p, key, { persist: p.buff === 'frostEdge' });
  }
  if (p.tag === 'statusDuration') {
    // Applied to the incoming native application below. Multiplying the live
    // buff here would compound on refresh and again during cold conversion.
    return true;
  }
  if (p.tag === 'buffRemove') { return battle.removeBuff(target, p.buff) > 0; }
  if (p.tag === 'bodyStats') return applyStatBuff(battle, source, target, p, key, { persist: false, allowDead: p.allowDead === true });
  if (p.tag === 'damageTakenMul') return applyStatBuff(battle, source, target, { arts: p.arts, elementGaugeTakenMul: p.elementGauge }, key, { persist: true });
  if (p.tag === 'elementGaugeTaken') return applyStatBuff(battle, source, target, { elementGaugeTakenMul: p.value }, key, { persist: true });
  if (p.tag === 'elementDamage' || p.tag === 'burstDamage') {
    if (!Number.isFinite(payload.burstDamageMul)) return false;
    payload.burstDamageMul *= number(p.value, 'burst damage multiplier');
    return true;
  }
  if (p.tag === 'shelter') return applyStatBuff(battle, source, target, { shelter: p.value }, key, { persist: true });
  if (p.tag === 'blockCount') return applyStatBuff(battle, source, target, { blockCountAdd: p.value }, key, { persist: true });
  if (p.buff === 'carveStack') {
    return applyStatBuff(battle, source, target, { atkRatioPerStack: p.atkRatioPerStack, maxStacks: p.maxStacks }, key, { duration: Infinity, stacking: 'stack' });
  }
  if (p.buff === 'threeThousand') return applyStatBuff(battle, source, target, { attackSpeed: p.attackSpeed }, key, { duration: p.durationSec ?? 15 });
  if (p.buff === 'chivalry') {
    const gold = state.goldSnapshot ?? state.prepared.input.gold ?? 0;
    const stacks = Math.min(Number(p.maxStacks ?? 8), Math.floor(Math.min(Number(p.maxGoldCounted ?? 40), gold) / 5));
    return applyStatBuff(battle, source, target, { attackSpeed: stacks * Number(p.attackSpeedPer5Gold ?? 5) }, key, { duration: Infinity });
  }
  if (p.buff === 'everlight') {
    const result = applyStatBuff(battle, source, target, { atkRatio: p.atkRatio, elementGaugeTakenMul: p.elementGaugeTakenMul }, key);
    if (p.statusResist) battle.applyStatus(target, 'resist', { duration: Infinity, value: 0.5, source });
    return result;
  }
  if (p.buff === 'windFeatherOwner') return applyStatBuff(battle, source, target, { atkRatio: p.atkRatio }, 'windFeatherOwner', { duration: Infinity, stacking: 'replace' });
  if (p.buff === 'burstAfterglow') {
    const result = applyStatBuff(battle, source, target, { attackSpeed: p.attackSpeed }, key, { duration: p.durationSec ?? 8 });
    if (result && p.suppressDotFromBurst && payload.suppressDotTargetUids) payload.suppressDotTargetUids.add(keyOf(target));
    return result;
  }
  if (p.buff === 'elementVuln') {
    if (!payload.afterBurstEffects || !payload.element) return false;
    payload.afterBurstEffects.push(() => {
      if (!active(target)) return;
      battle.addBuff(target, { key: `${key}:${payload.element}`, duration: Number(p.durationSec), refresh: 'replace', source,
        data: { assaultElementGaugeBonus: { element: payload.element, mul: Number(p.elementGaugeTakenMul) } } });
    });
    return true;
  }
  if (p.buff === 'houndCoffee' || p.buff === 'houndCoffeeMark' || p.buff === 'iceFire' || p.buff === 'holyCollar'
    || p.buff === 'minorBattle' || p.buff === 'derivativeSuper' || p.buff === 'windFeatherSummon' || p.buff === 'tempFortress'
    || p.buff === 'shadow' || p.buff === 'frostShell') {
    const duration = p.durationSec == null ? Infinity : Number(p.durationSec);
    const params = p.buff === 'iceFire' ? { elementGaugeTakenMul: p.elementGaugeTakenMul } : p;
    const result = applyStatBuff(battle, source, target, params, key, { duration, persist: effect.lifecycle === 'battle' && p.buff === 'shadow', allowDead: p.buff === 'shadow' });
    if (result && p.buff === 'iceFire' && p.elementBurstDamageMul != null) {
      const activeBuff = target.findBuff(key);
      activeBuff.data = { ...(activeBuff.data ?? {}), assaultBurstDamageMul: Number(p.elementBurstDamageMul) };
    }
    if (result && p.buff === 'shadow') target.findBuff(key).data = { ...(target.findBuff(key).data ?? {}), assaultBuff: 'shadowRefund' };
    return result;
  }
  if (p.tag === 'damageTaken') return true;
  if (p.tag === 'defIgnoreRatio' || p.tag === 'resIgnore') return true;
  return applyStatBuff(battle, source, target, p, key, { duration: p.durationSec == null ? Infinity : Number(p.durationSec) });
}

function applyEffect(state, battle, effect, target, payload) {
  const p = effect.params ?? {};
  const source = payload?.source ?? actorFor(battle, payload);
  const owner = ownerOf(target) ?? source;
  switch (effect.action) {
    case 'applyStatus': {
      const duration = number(p.durationSec, `${effect._key}.durationSec`);
      const applied = applyStatus(battle, source ?? target, target, { status: p.status, duration, key: ['cold', 'frozen'].includes(p.status) ? p.status : `${effect._key}:${keyOf(target)}` }) !== false;
      return applied;
    }
    case 'addBuff': {
      if (!target) return false;
      if (effect.id === 'never') return false;
      return applyAddBuff(state, battle, effect, source, target, payload);
    }
    case 'damage': {
      if (!target || !active(target)) return false;
      const type = p.damageType === 'physical' ? 'phys' : p.damageType === 'arts' ? 'arts' : p.damageType === 'elemental' ? 'elemental' : 'phys';
      const scale = p.atkRatio ?? p.defRatio;
      const amount = p.amount ?? (p.defRatio != null ? (source?.s.def ?? 0) * Number(p.defRatio) : null);
      if (p.chance != null && effect.condition?.critRoll == null && !battle.rng.chance(Number(p.chance))) return false;
      const dealt = damage(battle, source ?? target, target, amount != null ? { amount: Number(amount), type, sourceKey: effect._key } : { scale: Number(scale ?? 0), type, sourceKey: effect._key });
      if (dealt > 0 && Number(p.pauseSec) > 0 && target.alive) {
        applyStatus(battle, source ?? target, target, { status: 'stun', duration: Number(p.pauseSec), key: `${effect._key}:pause` });
      }
      return dealt > 0 || (target.alive && amount != null);
    }
    case 'heal': {
      if (!target || !active(target)) return false;
      const summonOwner = ownerOf(targetOf(payload)) ?? ownerOf(source) ?? source;
      const scaleOwner = p.scaleBasis === 'summonOwnerCurrentAtk' ? summonOwner : owner;
      const amount = p.amount ?? (p.ratioMaxHp != null ? target.s.maxHp * Number(p.ratioMaxHp) : p.atkScale != null ? (scaleOwner?.s.atk ?? source?.s.atk ?? 0) * Number(p.atkScale) : 0);
      return heal(battle, source ?? target, target, { amount: Number(amount), sourceKey: effect._key }) > 0;
    }
    case 'spGain': {
      const unit = target ?? source;
      if (!unit) return false;
      // Bazaar haste: natural recovery +100% for a limited window, never a permanent rate.
      if (p.hasteSec != null) return haste(battle, source ?? unit, unit, Number(p.hasteSec), effect._key) != null;
      if (p.perStackPerSecond != null) return applyStatBuff(battle, source, unit, { spPerSecond: Number(p.perStackPerSecond), maxStacks: Number(p.maxStacks ?? 4) }, effect._key, { duration: Infinity, stacking: 'stack', persist: true });
      if (p.perSecond != null) {
        const duration = p.durationSec == null ? Math.max(0, battle.timeLimit ?? 120) : Number(p.durationSec);
        startRelicTimer(state, battle, effect, unit, 1, () => sp(battle, source ?? unit, unit, Number(p.perSecond), effect._key, effect._key), battle.time + duration);
        return true;
      }
      return sp(battle, source ?? unit, unit, Number(p.amount ?? 0), effect._key, effect._key) > 0;
    }
    case 'redeploy': {
      if (!target) return false;
      if (effect.id === 'never') return false;
      if (p.stat === 'redeployCooldown') {
        const mul = Number(p.value);
        if (p.scope === 'nextRedeploy') { target.mem.assaultNextRedeployMul = mul; return true; }
        if (effect._relicId === 'redeploy-spring') return applyStatBuff(battle, source, target, { redeployCooldownMul: mul, maxStacks: p.maxStacks }, effect._key, { stacking: 'stack', persist: false });
        if (effect.trigger === 'battleStart' || p.scope === 'battle') return applyStatBuff(battle, source, target, { redeployCooldownMul: mul }, effect._key, { persist: true });
        if (p.targetScope === 'oneOtherDeployingAlly' || target !== source) {
          if (!target.alive && Number.isFinite(target.respawnAt)) target.respawnAt = battle.time + Math.max(0, target.respawnAt - battle.time) * mul;
          else target.mem.assaultNextRedeployMul = mul;
          return true;
        }
        return applyStatBuff(battle, source, target, { redeployCooldownMul: mul }, effect._key, { persist: p.scope === 'battle' });
      }
      return false;
    }
    case 'ammo': {
      const unit = target ?? source;
      if (!unit) return false;
      if (p.op === 'add' && p.scope === 'self' && effect._relicId === 'leader-angel2-oldmagazine') {
        const uidKey = keyOf(unit);
        state.relicAmmo.set(uidKey, Math.min(6, (state.relicAmmo.get(uidKey) ?? 0) + Number(p.amount ?? 0)));
        return true;
      }
      if (p.op === 'consume' && effect._relicId === 'leader-angel2-oldmagazine') {
        const magazineOwner = source ?? unit;
        const uidKey = keyOf(magazineOwner);
        if ((state.relicAmmo.get(uidKey) ?? 0) < Number(p.amount ?? 1)) return false;
        state.relicAmmo.set(uidKey, (state.relicAmmo.get(uidKey) ?? 0) - Number(p.amount ?? 1));
        const hitTarget = targetOf(payload);
        if (!hitTarget) return true;
        const dealt = damage(battle, magazineOwner, hitTarget, { scale: Number(p.bonusDamageRatio ?? 0), type: 'phys', sourceKey: `${effect._key}:bonus` });
        return dealt > 0;
      }
      if (p.op === 'add') {
        const refill = p.amount != null ? Number(p.amount) : (ammoMaxOf(unit, payload) ?? 0) * Number(p.amountRatioOfMax ?? 0);
        return reloadSkill(battle, unit, refill, effect._key) > 0;
      }
      return false;
    }
    case 'spCost': return false;
    case 'summon': return installWorkshopRelic(battle, target ?? source, effect, state);
    case 'shield': return addShield(battle, source, target, p, effect._key);
    case 'growth': {
      if (effect._relicId === 'pierce-altar') {
        // The permanent source is the run counter, not a per-battle per-UID
        // growth list.  Settlement increments the counter once per battle;
        // battle-input applies its team projection to every future recruit.
        state.altarAppliedThisBattle = true;
        return true;
      }
      if (!state.battleEndGrowth) state.battleEndGrowth = [];
      if (p.atkRatioPerStack != null && p.defRatioPerStack != null) {
        for (const stat of ['atk', 'def']) state.battleEndGrowth.push({
          uid: uid(target), sourceUid: uid(source), effectKey: `${effect._key}:${stat}`, stat, amount: Number(stat === 'atk' ? p.atkRatioPerStack : p.defRatioPerStack), mode: 'percent', oncePerRun: true,
        });
        return true;
      }
      return false;
    }
    case 'economy': {
      if (p.currency === 'dp' && p.amount != null) {
        if (!target?.ownerId || !active(target)) return false;
        return gainDP(battle, target, number(p.amount, `${effect._key}.amount`), effect._key, state.runtime.currentCause) > 0;
      }
      if (p.appliesTo === 'deployRefund' && p.currency === 'dp') {
        const paid = Number(payload?.actualPaid ?? 0);
        if (!(paid > 0) || !target?.ownerId) return false;
        const refund = paid * Number(p.valueRatioOfPaid ?? 0);
        if (!(refund > 0) || !Number.isFinite(refund)) return false;
        battle.addDp(target.ownerId, refund, 'assaultRelicRefund');
        if (p.consumeMark) {
          const marker = target.buffs?.find((entry) => entry.key === p.consumeMark || entry.data?.assaultBuff === p.consumeMark);
          if (marker) battle.removeBuff(target, marker.key);
        }
        return true;
      }
      return false;
    }
    default: throw new TypeError(`unknown assault relic action ${effect.action}`);
  }
}

function process(state, battle, effect, payload, { late = false } = {}) {
  if (effect.trigger === 'battleStart' && effect.params?.periodSec != null) return false;
  const targets = selectedTargets(battle, effect, payload);
  if (!targets.length && effect.target?.selection !== 'runAccount') return false;
  // A proc belongs to the real hit, and all its splash recipients share that
  // one decision. Ineligible events and pre-hit modifier queries spend no RNG.
  if (effect.condition?.critRoll != null) {
    if (!(targets.length ? targets : [null]).some(target => conditionMatches(state, battle, effect, payload, target, late))) return false;
    if (!battle.rng.chance(Number(effect.condition.critRoll))) return false;
  }
  let did = false;
  let countedGlobal = false;
  for (const target of targets.length ? targets : [null]) {
    if (!conditionMatches(state, battle, effect, payload, target, late)) continue;
    if (!allowed(state, effect, target, payload)) continue;
    if (effect.condition?.firstRealSummonEntry) state.unitClaims.add(`${effect._key}:summon-entry:${keyOf(targetOf(payload))}`);
    // "First skill" is spent on that skill ending even when its SP bar is
    // already full. A zero net gain must not move the reward to a later cast.
    if (effect.condition?.firstSkillPerUnit) state.unitClaims.add(`${effect._key}:firstSkill:${keyOf(sourceOf(payload))}`);
    const result = applyEffect(state, battle, effect, target, payload);
    if (!result) continue;
    if (!(effect._relicId === 'redeploy-spring' && effect.limits?.perBattle != null && countedGlobal)) {
      count(state, effect, target, payload);
      countedGlobal = true;
    }
    did = true;
    if (effect.condition?.firstSkillPerUnit) state.unitClaims.add(`${effect._key}:firstSkill:${keyOf(sourceOf(payload))}`);
    if (effect.params?.counterAtLeast != null) state.counters.set(`${effect._relicId}:${effect.params.counterAtLeast}:${keyOf(targetOf(payload) ?? target)}`, 0);
  }
  if (did && effect.params?.resetCounter) state.counters.set(`${effect._relicId}:${effect.params.resetCounter}:${keyOf(targetOf(payload))}`, 0);
  return did;
}

function preHit(state, battle, context) {
  const source = context?.source;
  if (!source || !active(source)) return;
  const dmg = context.dmg;
  if (source._assaultPierceNext) {
    dmg.defIgnorePct = Math.max(Number(dmg.defIgnorePct ?? 0), source._assaultPierceNext.ratio);
    source._assaultPiercePending = true;
  }
  for (const entry of state.effectsByTrigger.get('hit') ?? []) {
    const effect = entry.effect;
    if (!conditionMatches(state, battle, effect, { ...context, target: context.target, source }, context.target)) continue;
    if (effect._relicId === 'pierce-rendhand' || effect._relicId === 'pierce-rockhand') dmg.defIgnorePct = Math.max(Number(dmg.defIgnorePct ?? 0), number(effect.params.value, 'defense ignore ratio'));
    if (effect._relicId === 'pierce-hunterinsight') {
      dmg.defIgnorePct = Math.max(Number(dmg.defIgnorePct ?? 0), number(effect.params.defIgnore, 'defense ignore ratio'));
      dmg.resIgnorePct = Math.max(Number(dmg.resIgnorePct ?? 0), number(effect.params.resIgnore, 'resistance ignore ratio'));
      if (context.target?.alive) applyStatus(battle, source, context.target, { status: 'stun', duration: number(effect.params.pauseSec, 'hit pause duration'), key: `${effect._key}:pause` });
    }
  }
}

function installAttackMarkers(state, battle) {
  state.coldAttackContexts = new Map();
  battle.on('assaultAttackStarted', ({ attacker, targets, isSkill, attackId }) => {
    if (!attacker || isSkill || !active(attacker)) return;
    const marker = attacker._assaultFrostShell ?? attacker._assaultColdOnAttack;
    if (!marker) return;
    const pending = new Set((targets ?? []).filter((target) => active(target) && target.side === 'enemy').map(keyOf));
    if (!pending.size) return;
    state.coldAttackContexts.set(`${keyOf(attacker)}:${attackId}`, { attacker, marker, pending });
    if (attacker._assaultFrostShell) {
      delete attacker._assaultFrostShell;
      battle.removeBuff(attacker, marker.key);
    }
  }, { owner: state, priority: 10 });
  state.runtime.observe('hit', 'relic:successful-cold-attack', ({ payload, cause }) => {
    const attacker = payload.source, target = payload.target;
    const id = `${keyOf(attacker)}:${payload.attackId}`;
    const entry = state.coldAttackContexts.get(id);
    if (!entry || !entry.pending.delete(keyOf(target))) return;
    if (!entry.pending.size) state.coldAttackContexts.delete(id);
    const status = entry.marker.status ?? 'cold';
    state.runtime.enqueue(() => {
      if (!active(attacker) || !active(target) || target.side !== 'enemy') return;
      applyStatus(battle, attacker, target, { status, duration: entry.marker.duration,
        key: ['cold', 'frozen'].includes(status) ? status : `${entry.marker.key}:attack:${keyOf(target)}`, cause });
    }, { key: 'relic:successful-cold-attack', targetUid: keyOf(target), sourceUid: keyOf(attacker), cause });
  }, { owner: state, priority: 10 });
  state.runtime.observe('damageTaken', 'relic:pierce-next-consume', (event) => {
    const source = event.payload?.source;
    if (event.payload?.amount > 0 && source?._assaultPiercePending) { delete source._assaultPiercePending; delete source._assaultPierceNext; }
  }, { owner: state, priority: -100 });
}

function startRelicTimer(state, battle, effect, unit, period, handler, until = Infinity) {
  const key = `${effect._key}:${keyOf(unit)}`;
  let entry = state.periodicTimers.get(key);
  if (!entry) {
    entry = { unit, effect, period, handler, until, cancel: null };
    state.periodicTimers.set(key, entry);
  }
  if (!active(unit) || entry.cancel || battle.time >= entry.until) return;
  entry.cancel = onTimer(battle, unit, entry.period, () => {
    if (battle.time > entry.until + 1e-9) { entry.cancel?.(); entry.cancel = null; return; }
    entry.handler();
  }, { every: true });
}

function installPeriodicEffects(state, battle, onlyUnit = null) {
  for (const { effect } of state.effectsByTrigger.get('battleStart') ?? []) {
    const p = effect.params ?? {};
    if (p.periodSec == null) continue;
    if (effect._relicId === 'block-spikehand') {
      for (const unit of battle.allyUnits ?? []) if ((!onlyUnit || unit === onlyUnit) && active(unit) && conditionMatches(state, battle, effect, { unit, source: unit, target: unit }, unit)) {
        startRelicTimer(state, battle, effect, unit, Number(p.periodSec), () => {
          for (const enemy of unit.blocking?.filter((candidate) => active(candidate)) ?? []) applyEffect(state, battle, effect, enemy, { source: unit, target: enemy });
        });
      }
    } else if (effect._relicId === 'block-loyalty') {
      for (const unit of battle.allyUnits ?? []) if ((!onlyUnit || unit === onlyUnit) && active(unit)) startRelicTimer(state, battle, effect, unit, Number(p.periodSec), () => {
        if ((unit.blocking?.length ?? 0) < Number(effect.condition?.blockingCountAtLeast ?? 3)) return;
        applyEffect(state, battle, effect, unit, { source: unit, target: unit });
      });
    }
  }
}

function installPerEvent(state, battle, effect) {
  const eventType = effect.trigger === 'redeploy' ? (effect.condition?.entryKind === 'deploy' ? 'deployed' : 'redeploy') : effect.trigger;
  if (eventType === 'deploymentCost' || eventType === 'hourStarted' || eventType === 'purchase' || eventType === 'battleEnd') return;
  if (eventType === 'ammoUsed') {
    // Consume/reload is the sole source of truth for Assault ammo.  Observe
    // that native hook directly so the final real round remains marked even
    // after the card unregisters its controller before the queued effect runs.
    battle.on('ammoUsed', (raw) => {
      if (raw?.assaultAmmo !== true) return;
      const payload = raw;
      let skillKey = null;
      if (effect.condition?.oncePerSkill) {
        skillKey = `${effect._key}:skill:${keyOf(payload.source ?? payload.unit)}:${payload.skillId ?? payload.skill?.evSkillId ?? ''}:${payload.source?.skill?.activations ?? payload.skill?.activations ?? 0}`;
        if (state.skillClaims.has(skillKey)) return;
      }
      // The native ammo kit unregisters an exhausted pool immediately after
      // this hook returns.  Run the real event while its controller still
      // exists so a genuine relic reload can use the same pool; no synthetic
      // counter is created if the controller is already absent.
      if (process(state, battle, effect, payload) && skillKey) state.skillClaims.add(skillKey);
    }, { owner: state });
    return;
  }
  state.runtime.observe(eventType, effect._key, (event) => {
    const payload = event.payload ?? {};
    if (effect.trigger === 'hit' && effect.action === 'damage' && effect.condition?.critRoll != null
      && event.cause.visited.some(entry => entry.key === effect._key)) return;
    if (effect.trigger === 'ammoUsed' && effect.condition?.oncePerSkill) {
      const skillKey = `${effect._key}:skill:${keyOf(payload.source)}:${payload.skillId ?? ''}:${payload.source?.skill?.activations ?? 0}`;
      if (state.skillClaims.has(skillKey)) return;
      const run = () => { if (process(state, battle, effect, payload)) state.skillClaims.add(skillKey); };
      state.runtime.enqueue(run, { key: effect._key, targetUid: payload.targetUid, cause: event.cause });
      return;
    }
    const run = () => process(state, battle, effect, payload);
    if(effect._relicId==='ammo-carvedplate'&&sourceOf(payload)?.mem?.assaultCastAmmo)run();
    else if (effect.trigger === 'hit' && ['pierce-newedict', 'pierce-rendhand', 'pierce-rockhand', 'pierce-hunterinsight'].includes(effect._relicId)) {
      state.runtime.enqueue(run, { key: effect._key, targetUid: payload.targetUid, cause: event.cause });
    } else if (effect.trigger === 'elementBurst') run();
    else state.runtime.enqueue(run, { key: effect._key, targetUid: payload.targetUid, cause: event.cause });
  }, { owner: state });
  if (effect.trigger === 'summonDied' && effect.condition?.noRemainingSummonOfOwner) {
    state.runtime.observe('summonExited', `${effect._key}:exit`, event => {
      state.runtime.enqueue(() => process(state, battle, effect, event.payload), { key: effect._key, targetUid: event.payload?.targetUid, cause: event.cause });
    }, { owner: state });
  }
}

export function computeRelicDeploymentCost(battle, unit, baseCost) {
  const base = Number(baseCost);
  if (!Number.isFinite(base) || base < 0) throw new TypeError('base deployment cost must be finite and non-negative');
  let result = base;
  const state = battle?._assaultRelicState;
  for (const effect of state?.costEffects ?? []) {
    const c = effect.condition ?? {};
    const kind = unit?.mem?.assaultSpawnKind ?? (unit?.kind === 'token' ? 'summon' : unit?.kind === 'device' ? 'device' : 'operator');
    if (c.spawnKind && c.spawnKind !== kind) continue;
    if (c.spawnKindIn && !c.spawnKindIn.includes(kind)) continue;
    if (c.ownerDeployType === 'melee' && !isMelee(unit)) continue;
    if (c.ownerDeployType === 'ranged' && !isRanged(unit)) continue;
    const value = Number(effect.params?.value);
    if (!Number.isFinite(value)) throw new TypeError(`invalid deployment modifier ${effect._key}`);
    result += value;
  }
  if (!Number.isFinite(result)) throw new TypeError('computed deployment cost must be finite');
  return Math.max(0, result);
}

export function installRelics(battle, prepared, { runtime: catalog = null, design } = {}) {
  const runtime = battle?.assaultRuntime;
  if (!battle || !runtime) throw new TypeError('installRelics requires battle.assaultRuntime');
  validateDesign(design);
  const input = prepared?.input ?? prepared;
  if (!Array.isArray(input?.relicIds) || !Array.isArray(input?.pieces)) throw new TypeError('prepared assault input requires relicIds and pieces');
  const itemMap = new Map(allRelicItems(design).map((item) => [item.id, item]));
  const selected = [];
  for (const id of input.relicIds) {
    const item = itemMap.get(id);
    if (!item) throw new Error(`unknown assault collectible ${id}`);
    if (selected.some((entry) => entry.id === id)) throw new Error(`duplicate assault collectible ${id}`);
    selected.push(item);
  }
  const starters = selected.filter((item) => item.rarity === 'starter');
  if (starters.length > 1) throw new Error('assault starter collectibles are mutually exclusive');
  if (starters.length === 1 && input.leaderCharId != null && starters[0].leaderCharId !== input.leaderCharId) {
    throw new Error(`starter collectible ${starters[0].id} does not match leader ${input.leaderCharId}`);
  }
  const state = {
    battle, prepared: { input }, runtime, catalog, design, pieces: new Set(input.pieces.map((piece) => piece.uid)),
    selected, counts: new Map(), counters: new Map(), unitClaims: new Set(), skillClaims: new Set(), effectsByTrigger: new Map(),
    costEffects: [], started: false, naturalEntrySeen: new Set(), firstDeploySeen: false, firstGroundDeploySeen: false, goldSnapshot: input.gold ?? 0,
    workshopSpawned: false, battleEndGrowth: [], altarStacks: 0, altarAppliedThisBattle: false, relicAmmo: new Map(), periodicTimers: new Map(),
  };
  battle._assaultRelicState = state;
  const previousCostResolver = battle.assaultCostResolver;
  battle.assaultCostResolver = (currentBattle, unit, baseCost) => computeRelicDeploymentCost(currentBattle, unit,
    previousCostResolver ? previousCostResolver(currentBattle, unit, baseCost) : baseCost);
  for (const item of selected) for (const [index, raw] of (item.effects ?? []).entries()) {
    const effect = { ...raw, _key: effectKey(item.id, index), _relicId: item.id, _index: index };
    const list = state.effectsByTrigger.get(effect.trigger) ?? [];
    list.push({ item, effect });
    state.effectsByTrigger.set(effect.trigger, list);
    if (effect.trigger === 'deploymentCost') state.costEffects.push(effect);
  }
  for (const entries of state.effectsByTrigger.values()) for (const { effect } of entries) installPerEvent(state, battle, effect);
  const durationEffects = selected.flatMap(item => item.effects).filter(effect => effect.params?.tag === 'statusDuration');
  if (durationEffects.length) {
    const originalApplyStatus = battle.applyStatus;
    const statusFrames = [];
    battle.applyStatus = function(target, status, options = {}) {
      const parent = statusFrames.at(-1);
      // Native cold pairs into freeze synchronously and passes the already
      // modified maximum duration. Direct freezes are independent applications.
      const converted = status === 'freeze' && parent?.target === target && parent.status === 'cold';
      let modified = options;
      if (target?.side === 'enemy' && !converted && options.duration != null) {
        const publicStatus = status === 'freeze' ? 'frozen' : status;
        const factor = durationEffects.filter(effect => effect.params.appliesTo.includes(publicStatus))
          .reduce((value, effect) => value * number(effect.params.value, 'status duration multiplier'), 1);
        if (factor !== 1) modified = { ...options, duration: Number(options.duration) * factor };
      }
      statusFrames.push({ target, status });
      try { return originalApplyStatus.call(this, target, status, modified); }
      finally { statusFrames.pop(); }
    };
  }
  runtime.observe('deployed', 'relic:first-deploy-state', (event) => {
    const unit = event.payload?.unit ?? event.payload?.target ?? event.payload?.source;
    if (unit?.kind !== 'op' || event.payload?.skillEntry || state.naturalEntrySeen.has(keyOf(unit))) return;
    state.naturalEntrySeen.add(keyOf(unit));
    event.payload.firstNaturalDeploy = !state.firstDeploySeen;
    event.payload.firstGroundDeploy = !state.firstGroundDeploySeen && isMelee(unit);
    state.firstDeploySeen ||= true;
    if (event.payload.firstGroundDeploy) state.firstGroundDeploySeen = true;
  }, { owner: state, priority: 200 });
  installAttackMarkers(state, battle);
  // Ally element bursts resolve through the native Battle hook directly;
  // enemy bursts additionally publish the Assault runtime event and carry an
  // instanceId.  Cover the former here without double-processing the latter.
  battle.on('elementBurst', (event) => {
    if (event?.instanceId != null) return;
    for (const { effect } of state.effectsByTrigger.get('elementBurst') ?? []) process(state, battle, effect, event ?? {});
  }, { owner: state, priority: 20 });

  battle.on('battleStart', () => {
    state.started = true;
    const opening = state.effectsByTrigger.get('battleStart') ?? [];
    for (const { effect } of opening) if (!effect.condition?.requiresAnyAllyShield) process(state, battle, effect, {});
    // Conditional opening effects see all independent opening shield grants.
    // Keep the decision fixed for late entries; a mid-battle shield is not an
    // opening shield and must never retroactively activate the condition.
    state.openingHadShield = battle.allyUnits.some((unit) => active(unit)
      && unit.buffs?.some((entry) => Number(entry.shield) > 0 || Number(entry.shieldHits) > 0));
    for (const { effect } of opening) if (effect.condition?.requiresAnyAllyShield) process(state, battle, effect, {});
    installPeriodicEffects(state, battle);
  }, { owner: state, priority: 50 });
  // Native waves are spawned after battleStart. Choose one member of the
  // first actual cohort, after its spawn batch, rather than losing the cost
  // merely because the opening hook had no constructed enemy entities yet.
  battle.on('enemySpawn', () => {
    const mark = (state.effectsByTrigger.get('battleStart') ?? []).find(entry => entry.effect.params?.buff === 'houndCoffeeMark')?.effect;
    if (!mark || !state.started || state.coffeeMarkPending || !allowed(state, mark, null, {})) return;
    state.coffeeMarkPending = true;
    battle.after(0, () => {
      state.coffeeMarkPending = false;
      process(state, battle, mark, {});
    });
  }, { owner: state });
  battle.on('deploy', ({ unit }) => {
    if (!state.started || !unit) return;
    for (const { effect } of state.effectsByTrigger.get('battleStart') ?? []) {
      if (['cycle-oldcoin', 'cycle-elysee', 'cycle-fortunecookie'].includes(effect._relicId)) continue;
      if (['frostEdge', 'frostSigil'].includes(effect.params?.buff)
        && unit.buffs?.some((entry) => entry.key === effect._key)) {
        unit._assaultColdOnAttack = { key: effect._key, duration: effect.params.onAttackStatus?.durationSec ?? 1 };
      }
      if (effect.condition?.affectsNewEnemies || unit.side === 'ally') process(state, battle, effect, { unit, target: unit }, { late: true });
    }
    for (const entry of state.periodicTimers.values()) if (entry.unit === unit) startRelicTimer(state, battle, entry.effect, unit, entry.period, entry.handler, entry.until);
    installPeriodicEffects(state, battle, unit);
  }, { owner: state, priority: -20 });
  battle.on('hit', (context) => preHit(state, battle, context), { owner: state, priority: 200 });
  battle.on('hpDamage', (context) => {
    for (const { effect } of state.effectsByTrigger.get('damageTaken') ?? []) {
      if (effect._relicId !== 'block-unyielding' || !context.target) continue;
      if (conditionMatches(state, battle, effect, { target: context.target, source: context.source }, context.target) && context.amount > 0) context.amount *= Number(effect.params?.value ?? 1);
    }
  }, { owner: state, priority: 100 });
  const clearCarvedPlate = (unit) => { if (unit) for (const { effect } of state.effectsByTrigger.get('hit') ?? []) if (effect._relicId === 'ammo-carvedplate') battle.removeBuff(unit, effect._key); };
  runtime.observe('skillStart', 'relic:carvedplate-reset', ({ payload }) => {
    const unit=sourceOf(payload);if(!unit?.mem?.assaultCastAmmo)clearCarvedPlate(unit);
  }, { owner: state });
  // Assault instant skills finish through skillResolved, after their complete
  // causal hit queue. Never carry a burst's stacks into later basic attacks.
  runtime.observe('skillResolved', 'relic:carvedplate-finish', ({ payload }) => runtime.afterFlush(() => {
    const unit=sourceOf(payload);if(!unit?.mem?.assaultCastAmmo||unit.mem.assaultCastAmmo.current===0)clearCarvedPlate(unit);
  }), { owner: state, priority: -100 });
  battle.on('skillEnd', ({ unit, reason }) => {
    // Native instant-skill closure is not the end of a battle cast-ammo pool.
    // Its final spent round is cleared by carvedplate-finish above; a real
    // retreat/death still closes the original lifecycle here.
    if(reason==='assault-settled'&&unit?.mem?.assaultCastAmmo)return;
    runtime.afterFlush(() => clearCarvedPlate(unit));
  }, { owner: state });
  // a loading ammo skill ends when its pool runs dry: the first attack after that starts without the stacks
  battle.on('assaultAttackStarted', ({ attacker }) => {
    if (attacker?.mem?.assaultAmmoSkill && !(attacker.mem.assaultAmmoSkill.left > 0)
      || attacker?.mem?.assaultCastAmmo?.current===0)clearCarvedPlate(attacker);
  }, { owner: state });
  battle.on('death', ({ unit }) => {
    if (!unit) return;
    for (const entry of state.periodicTimers.values()) if (entry.unit === unit) { entry.cancel?.(); entry.cancel = null; }
    delete unit._assaultPierceNext;
    delete unit._assaultPiercePending;
    delete unit._assaultFrostShell;
    delete unit._assaultColdOnAttack;
    for (const [key, entry] of state.coldAttackContexts) if (entry.attacker === unit) state.coldAttackContexts.delete(key);
    if (unit._assaultTimers) for (const timer of unit._assaultTimers) timer.cancel?.();
    if (Number.isFinite(unit.respawnAt) && Number.isFinite(unit.mem?.assaultNextRedeployMul)) {
      unit.respawnAt = battle.time + Math.max(0, unit.respawnAt - battle.time) * unit.mem.assaultNextRedeployMul;
      delete unit.mem.assaultNextRedeployMul;
    }
  }, { owner: state, priority: -50 });
  battle.on('battleEnd', (event) => {
    for (const { effect } of state.effectsByTrigger.get('battleEnd') ?? []) process(state, battle, effect, { ...(event ?? {}), victory: event?.result?.reason === 'cleared' || event?.result?.victory === true, battleResolved: true });
    if (state.battleEndGrowth.length) battle.assaultPermanentEffects = [...(battle.assaultPermanentEffects ?? []), ...state.battleEndGrowth];
  }, { owner: state, priority: 20 });
  installUpgrades(battle, prepared, { runtime: catalog, design });
  return state;
}

export const relicEffectHandlers = Object.freeze(Object.fromEntries(allRelicIds().map((id) => [id, (battle, prepared, options) => installRelics(battle, prepared, options)])));

function allRelicIds() {
  return [
    'cold-frostsignal','cold-frozenhusk','cold-triumphhorn','cold-cabaretsinger','cold-niflheimr','cold-mirrorarchive',
    'redeploy-spring','redeploy-newedict','redeploy-vanguardrally','redeploy-specialstill','redeploy-brokenblade','redeploy-airdrop',
    'ammo-charsetglossary','ammo-holycollar','ammo-carvedplate','ammo-thousandforms','ammo-anthology','ammo-fireworkhand',
    'element-voile','element-wotuncle','element-catastrophe','element-ameng','element-riverblessing','element-houndremedy',
    'summon-minorbattle','summon-ledger','summon-derivative','summon-arcticpack','summon-poeticrelic','summon-windfeather',
    'heal-mercenarypolicy','heal-scaleshell','heal-pharmacon','heal-sanctuary','heal-lakeshield','heal-kingform',
    'block-wallchild','block-pickflower','block-unyielding','block-tempfortress','block-spikehand','block-loyalty',
    'pierce-newedict','pierce-altar','pierce-rendhand','pierce-rockhand','pierce-hunterinsight','pierce-breederseed',
    'cycle-oldcoin','cycle-elysee','cycle-ecaz','cycle-fortunecookie','cycle-everflow','cycle-royalliqueur',
    'econ-oldcoins','econ-scrapmedal','econ-friendship','econ-leithmedal','econ-rings','econ-flawlessjade',
    'cross-bundle','cross-chivalry','cross-artinstall','cross-cloverfossil','cross-icefire','cross-lancepro','cross-houndcoffee',
    'cross-everlight','cross-shadow','leader-svash2-frostsigil','leader-ironmn-workshopkey','leader-angel2-oldmagazine',
  ];
}
