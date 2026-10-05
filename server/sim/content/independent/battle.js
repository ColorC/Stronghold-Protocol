import { weaknessType, WEAKNESS_PRIORITY } from '../garrisons/battle.js';
import { frontOf } from '../../dir.js';
import { nativeBodyStats, nativeRecord, tavernFactions } from '../../../../shared/independentRules.js';
import { loadoutRecord } from '../../../../shared/loadoutRecord.js';
import { mitigate } from '../../damage.js';

const BEHAVIORS = new Set([
  'badgeThresholdStat', 'staticStats', 'conditionalDamage', 'weakDamage', 'eventProduction',
  'deployWindowStats', 'startDerivedStats',
]);
const STAT_MODS = Object.freeze({
  attackFlat: 'atkFlat', attackPercent: 'atkPct', attackSpeedFlat: 'aspd',
  maxHpFlat: 'hpFlat', maxLifeFlat: 'hpFlat', maxHpPercent: 'hpPct', maxLifePercent: 'hpPct', defenseFlat: 'defFlat', defenceFlat: 'defFlat', defensePercent: 'defPct',
  resistanceFlat: 'resFlat', spRecoveryPerSec: 'spRecoveryFlat', hpRegenPerSec: 'hpRegen',
  redeployPercent: 'redeployMul', damageDealtPercent: 'dmgDealtMul',
  hpRecoveryPerSecond: 'hpRegen', spRecoveryPerSecond: 'spRecoveryFlat', naturalSkillRecoveryFlat: 'spRecoveryFlat',
  artsResistanceFlat: 'resFlat', lifeRecoveryFlat: 'hpRegen', spRecovery: 'spRecoveryFlat',
  initialSkillPointsFlat: 'initialSkillPoints', normalAttackDamagePercent: 'normalAttackDamageBonus',
  healingDealtPercent: 'healingDealtMul', spRecovery: 'spRecoveryFlat', resistance: 'resFlat', tauntLevel: 'taunt',
  taunt: 'taunt', initialSp: 'initialSkillPoints', maxLifePercent: 'hpPct', maxHpPercent: 'hpPct',
});

function rulesOf(catalog, chessId) {
  const op = catalog?.operators?.[chessId];
  if (!op) throw new Error(`independent catalog is missing operator ${chessId}`);
  const rules = op.nativeTrait?.effect?.combat;
  if (!Array.isArray(rules)) throw new Error(`independent catalog operator ${chessId} lacks effect.combat`);
  return rules;
}

function records(map) { return map && typeof map === 'object' ? Object.entries(map) : []; }

function recordLookup(map, id) {
  if (id == null) return null;
  const key = String(id);
  if (map && Object.hasOwn(map, key)) return { ...map[key], id: map[key]?.id ?? key };
  for (const [, rec] of records(map)) {
    if ([rec?.id, rec?.sourceId, rec?.canonicalId, rec?.chessId, rec?.eliteId].includes(key)) return { ...rec, id: rec.id ?? rec.canonicalId ?? rec.sourceId ?? key };
  }
  return null;
}

function itemId(entry) {
  return entry && typeof entry === 'object' ? entry.id ?? entry.sourceId ?? entry.canonicalId : entry;
}

function entryArray(value) { return Array.isArray(value) ? value : []; }

function selectVariant(value, elite) {
  if (Array.isArray(value)) return value.map((x) => selectVariant(x, elite));
  if (!value || typeof value !== 'object') return value;
  if (Object.hasOwn(value, 'normal') || Object.hasOwn(value, 'elite')) {
    const variant = value[elite ? 'elite' : 'normal'] ?? value[elite ? 'normal' : 'elite'];
    if (variant !== undefined && (typeof variant !== 'object' || variant === null)) return variant;
    if (variant !== undefined && Object.keys(value).every((key) => key === 'normal' || key === 'elite')) return selectVariant(variant, elite);
  }
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, selectVariant(nested, elite)]));
}

function effectiveEquipmentParams(entry) { return selectVariant(entry.rec.params ?? {}, !!entry.item.elite || !!entry.specialElite); }
function effectiveEquipmentStats(entry) { return selectVariant(entry.rec.stats ?? {}, !!entry.item.elite); }

function equipmentFor(piece, catalog) {
  const out = [];
  for (const item of entryArray(piece.equipment)) {
    const id = itemId(item);
    const badge = recordLookup(catalog.badges, id);
    const gear = badge ? null : recordLookup(catalog.equipment, id);
    if (!badge && (!gear || gear.available === false)) throw new Error(`unknown independent equipment ${id} on piece ${piece.uid}`);
    const legacyBadge = gear?.mechanism === 'badge' ? recordLookup(catalog.badges, gear.badgeId) : null;
    if (gear?.mechanism === 'badge' && !legacyBadge) throw new Error(`legacy badge equipment ${id} lacks a resolvable badgeId`);
    out.push({ item, id: badge?.id ?? legacyBadge?.id ?? gear?.sourceId ?? gear?.id ?? id, rec: badge ?? legacyBadge ?? gear, kind: badge || legacyBadge ? 'badge' : 'equipment', sourceId: gear?.sourceId ?? id });
  }
  return out;
}

function countBadges(entries) {
  const out = new Map();
  for (const e of entries) if (e.kind === 'badge') out.set(e.rec.id, (out.get(e.rec.id) || 0) + Math.max(1, Number(e.item.quantity) || 1));
  return out;
}

function modFromStat(stat, value) {
  if (!Number.isFinite(Number(value))) throw new Error(`unsupported independent battle stat ${stat}`);
  const n = Number(value);
  if (stat === 'physicalAndArtsDodge') return { dodgePhys: n, dodgeArts: n };
  if (stat === 'physicalAndArtsDamageReduction') return { physReduction: n, artsReduction: n };
  if (stat === 'redeployTimeReduction' || stat === 'redeployPercent') return { redeployReduction: n };
  const key = STAT_MODS[stat];
  if (!key) throw new Error(`unsupported independent battle stat ${stat}`);
  if (key === 'initialSkillPoints' || key === 'normalAttackDamageBonus') return { [key]: n };
  if (key === 'healingDealtMul' || key === 'dmgDealtMul') return { [key]: Math.max(0, 1 + n) };
  return key.endsWith('Mul') ? { [key]: Math.max(0, 1 + n) } : { [key]: n };
}

function mergeMods(into, mods, multiplier = 1) {
  for (const [k, v] of Object.entries(mods)) {
    if (k.endsWith('Mul')) into[k] = (into[k] ?? 1) + (v - 1) * multiplier;
    else into[k] = (into[k] ?? 0) + v * multiplier;
  }
}

function sumBadgeMods(catalog, entries) {
  const mods = {};
  const counts = countBadges(entries);
  for (const [id, n] of counts) {
    const rec = recordLookup(catalog.badges, id);
    if (!rec?.stat) throw new Error(`badge ${id} lacks stat metadata`);
    const stat = modFromStat(rec.stat, rec.value);
    const factors = entries.filter((e) => e.kind === 'equipment' && e.rec.mechanism === 'badgeAmplifier')
      .map((e) => {
      const p = e.rec.params ?? {};
      const applicable = Array.isArray(p.badgeIds) && p.badgeIds.includes(id)
          && (!p.stats || (Array.isArray(p.stats) ? p.stats.includes(rec.stat) : Object.hasOwn(p.stats, rec.stat)));
        if (!applicable) return 1;
        const scale = Number(p.multiplier);
        if (!(scale > 0)) throw new Error(`badge amplifier ${e.id} lacks a positive multiplier`);
        return scale;
      });
    const scale = factors.reduce((a, b) => a * b, 1);
    mergeMods(mods, stat, n * scale);
  }
  for (const e of entries) {
    if (e.kind !== 'equipment') continue;
    if (e.rec.stat && e.rec.value != null) mergeMods(mods, modFromStat(e.rec.stat, selectVariant(e.rec.value, !!e.item.elite)), Math.max(1, Number(e.item.quantity) || 1));
    const itemStats = e.rec.stats ?? {};
    if (!Array.isArray(itemStats)) for (const [stat, rawValue] of Object.entries(itemStats)) {
      const quantity = Math.max(1, Number(e.item.quantity) || 1);
      const value = rawValue && typeof rawValue === 'object' && (Object.hasOwn(rawValue, 'normal') || Object.hasOwn(rawValue, 'elite'))
        ? rawValue[!!e.item.elite ? 'elite' : 'normal'] ?? rawValue[!!e.item.elite ? 'normal' : 'elite']
        : rawValue;
      if (!Array.isArray(rawValue) && value != null) mergeMods(mods, modFromStat(stat, value), quantity);
    }
  }
  return { mods, counts };
}

function splitBattleMods(mods) {
  const buffs = { ...mods };
  const initialSp = Number(buffs.initialSkillPoints || 0);
  const normalAttackDamageBonus = Number(buffs.normalAttackDamageBonus || 0);
  const redeployReduction = Number(buffs.redeployReduction || 0);
  delete buffs.initialSkillPoints;
  delete buffs.normalAttackDamageBonus;
  delete buffs.redeployReduction;
  if (redeployReduction) buffs.redeployMul = Math.max(0.5, 1 - Math.min(0.5, redeployReduction));
  const physReduction = Number(buffs.physReduction || 0);
  const artsReduction = Number(buffs.artsReduction || 0);
  delete buffs.physReduction;
  delete buffs.artsReduction;
  if (physReduction) buffs.physTakenMul = Math.max(0.5, 1 - Math.min(0.5, physReduction));
  if (artsReduction) buffs.artsTakenMul = Math.max(0.5, 1 - Math.min(0.5, artsReduction));
  if (Number.isFinite(Number(buffs.dodgePhys))) buffs.dodgePhys = Math.min(0.6, Number(buffs.dodgePhys));
  if (Number.isFinite(Number(buffs.dodgeArts))) buffs.dodgeArts = Math.min(0.6, Number(buffs.dodgeArts));
  return { buffs, initialSp, normalAttackDamageBonus };
}

function installSpecialStatHooks(battle, unit, { initialSp = 0, normalAttackDamageBonus = 0 } = {}) {
  if (initialSp > 0) battle.on('deploy', ({ unit: deployed }) => {
    if (deployed === unit) unit.skill?.gainSp(initialSp, 'independentBadge');
  }, { owner: unit });
  if (normalAttackDamageBonus > 0) battle.on('hit', ({ source, dmg }) => {
    if (source === unit && dmg && !dmg.isSkill && dmg.type !== 'element') dmg.mul *= 1 + normalAttackDamageBonus;
  }, { owner: unit });
}

function traitsOnBattleStart(unit, catalog, piece, entries) {
  const out = [];
  for (const rule of rulesOf(catalog, piece.chessId)) {
    if (!rule || !BEHAVIORS.has(rule.behavior)) throw new Error(`unimplemented independent combat rule ${piece.chessId}:${rule?.behavior ?? 'missing'}`);
    const p = rule.params ?? {};
      if (rule.behavior === 'badgeThresholdStat') {
      const badgeCounts = countBadges(entries);
      const count = Array.isArray(p.badgeIds) ? p.badgeIds.reduce((n, id) => n + (badgeCounts.get(id) ?? 0), 0) : [...badgeCounts.values()].reduce((a, b) => a + b, 0);
      const every = Number(p.every);
      if (!(every > 0)) throw new Error(`badgeThresholdStat ${piece.chessId} needs params.every`);
      const stacks = Math.floor(count / every);
      if (stacks) for (const [stat, perStack] of Object.entries(p.stats ?? {})) mergeMods(out, modFromStat(stat, perStack), stacks);
      } else if (rule.behavior === 'staticStats') {
        for (const [stat, value] of Object.entries(p.stats ?? {})) mergeMods(out, modFromStat(stat, value));
    }
  }
  return out;
}

function badgeCountFor(entries, badgeIds) {
  const counts = countBadges(entries);
  return Array.isArray(badgeIds) ? badgeIds.reduce((n, id) => n + (counts.get(id) ?? 0), 0) : [...counts.values()].reduce((a, b) => a + b, 0);
}

function installDerivedNativeRules(battle, unit, piece, catalog, entries) {
  for (const rule of rulesOf(catalog, piece.chessId)) {
    const p = rule.params ?? {};
    if (rule.behavior === 'deployWindowStats') {
      if (rule.trigger !== 'deploy') throw new Error(`deployWindowStats ${piece.chessId} requires deploy trigger`);
      const duration = Number(p.durationSeconds);
      const every = Number(p.every);
      if (!(duration > 0 && every > 0)) throw new Error(`deployWindowStats ${piece.chessId} requires durationSeconds/every`);
      battle.on('deploy', ({ unit: deployed }) => {
        if (deployed !== unit) return;
        const stacks = Math.floor(badgeCountFor(entries, p.badgeIds) / every);
        const mods = {};
        for (const [stat, perStack] of Object.entries(p.stats ?? {})) mergeMods(mods, modFromStat(stat, perStack), stacks);
        if (stacks > 0 && Object.keys(mods).length) battle.addBuff(unit, { key: `independent:deployTrait:${unit.uid}:${rule.behavior}`, duration, refresh: 'replace', mods, allowDead: true });
      }, { owner: unit });
    } else if (rule.behavior === 'startDerivedStats') {
      if (rule.trigger !== 'battleStart') throw new Error(`startDerivedStats ${piece.chessId} requires battleStart trigger`);
      battle.on('battleStart', () => {
        const [frontR, frontC] = frontOf(unit.homeR, unit.homeC, unit.dir);
        const front = battle.allyUnits.find((candidate) => candidate.kind === 'op' && candidate.ownerId === unit.ownerId
          && candidate.homeR === frontR && candidate.homeC === frontC && candidate !== unit && !candidate.removed);
        const each = Number(p.every ?? 5);
        if (!(each > 0)) throw new Error(`startDerivedStats ${piece.chessId} requires params.every`);
        const ownStacks = Math.floor(badgeCountFor(entries, p.badgeIds) / each);
        const frontPiece = front && piecesByUid(battle, front.uid);
        const frontEntries = frontPiece ? equipmentFor(frontPiece, catalog) : [];
        const frontStacks = frontPiece ? Math.floor(badgeCountFor(frontEntries, p.badgeIds) / each) : 0;
        const stacks = ownStacks + frontStacks;
        const mods = {};
        if (Number.isFinite(Number(p.attackSpeedFlat ?? p.attackSpeedFlatPerStack))) mods.aspd = stacks * Number(p.attackSpeedFlat ?? p.attackSpeedFlatPerStack);
        if (Number.isFinite(Number(p.redeployTimeReduction ?? p.redeployReductionPercentPerStack))) {
          const reduction = Math.min(Number(p.maxRedeployTimeReduction ?? p.maxRedeployReduction ?? 0.3), stacks * Number(p.redeployTimeReduction ?? p.redeployReductionPercentPerStack));
          mods.redeployMul = Math.max(0, 1 - reduction);
        }
        if (Object.keys(mods).length) battle.addBuff(unit, { key: `independent:startTrait:${unit.uid}`, mods, persist: true, allowDead: true });
      }, { owner: unit });
    }
  }
}

function piecesByUid(battle, uid) {
  return battle.opts?.flags?.independent?.pieces?.find((p) => p.uid === uid) ?? null;
}
function piecesFor(battle, uid) { return piecesByUid(battle, uid); }
function stateCounter(battle, piece, key) { return piece?.nativeState?.counters?.[key] ?? battle.opts?.flags?.independent?.counters?.[key] ?? null; }

function ownerUnit(battle, uid) { return battle.allyUnits.find((u) => u.kind === 'op' && u.uid === uid) ?? null; }

function withinRange(battle, from, target) {
  if (!from || !target) return false;
  const key = Math.round(target.y) * 21 + Math.round(target.x);
  return from.rangeKeySet?.has(key) ?? (from.rangeKeys || []).includes(key);
}

function adjacentInDirection(owner, actor, direction) {
  if (!owner || !actor) return false;
  const [fr, fc] = frontOf(owner.homeR, owner.homeC, owner.dir);
  const isFront = actor.homeR === fr && actor.homeC === fc;
  return direction === 'front' ? isFront : direction === 'behind' ? actor.homeR === owner.homeR * 2 - fr && actor.homeC === owner.homeC * 2 - fc : true;
}

function getActor(event, trigger) {
  if (trigger === 'skillStart' || trigger === 'deploy' || trigger === 'ammoUsed' || trigger === 'heal') return event.unit ?? event.source ?? null;
  if (trigger === 'kill') return event.killer ?? null;
  if (trigger === 'death') return event.unit ?? null;
  if (trigger === 'statusApplied') return event.source ?? null;
  if (trigger === 'attack') return event.attacker ?? null;
  if (trigger === 'nativeProduction') return event.actor ?? null;
  return null;
}

function applyEquipmentStatus(battle, source, target, status, options) {
  const previous = source?.mem?.independentOrigin;
  if (source?.mem) source.mem.independentOrigin = 'equipment';
  try { return battle.applyStatus(target, status, { ...options, source }); }
  finally {
    if (source?.mem) {
      if (previous === undefined) delete source.mem.independentOrigin;
      else source.mem.independentOrigin = previous;
    }
  }
}

function filterMatches(battle, rule, event, actor, owner) {
  const f = rule.params?.filter ?? {};
  let observer = owner;
  if (f.observer === 'frontAlly') {
    const [frontR, frontC] = frontOf(owner.homeR, owner.homeC, owner.dir);
    observer = battle.allyUnits.find((candidate) => candidate.kind === 'op' && candidate.ownerId === owner.ownerId
      && candidate.homeR === frontR && candidate.homeC === frontC && candidate.alive && candidate.deployed && !candidate.removed) ?? null;
    if (!observer) return false;
  }
  if (f.observerTag && !tavernFactions(piecesFor(battle, observer.uid), battle.opts?.flags?.independent?.catalog).includes(f.observerTag)) return false;
  if (f.actor === 'self' && actor !== owner) return false;
  if (f.actor === 'team' && actor?.ownerId !== owner.ownerId) return false;
  if (f.actor === 'adjacentAllies' && (actor?.ownerId !== owner.ownerId || actor === owner || Math.abs(actor.homeR - owner.homeR) + Math.abs(actor.homeC - owner.homeC) !== 1)) return false;
  if (f.actor === 'sameRowAllies' && (actor?.ownerId !== owner.ownerId || actor.homeR !== owner.homeR || (f.includeSelf !== true && actor === owner))) return false;
  if (f.actor === 'sameRowRightmost') {
    const row = battle.allyUnits.filter((u) => u.kind === 'op' && u.ownerId === owner.ownerId && u.homeR === owner.homeR && !u.removed);
    const rightmost = row.sort((a, b) => b.homeC - a.homeC)[0];
    if (actor !== rightmost) return false;
  }
  if (f.actor === 'adjacentAllies' && f.direction && !adjacentInDirection(owner, actor, f.direction)) return false;
  if (f.actor === 'adjacentAllies' && f.excludeSelf && actor === owner) return false;
  if (f.actor === 'target' && event.target !== owner) return false;
  const target = event.victim ?? event.target ?? null;
  if (f.targetSide && f.targetSide !== 'any' && target?.side !== f.targetSide) return false;
  if (f.targetKind && target?.kind !== f.targetKind) return false;
  const targetTags = target?.def?.tags || [];
  const targetTag = f.targetTag;
  if (targetTag && !(Array.isArray(targetTag) ? targetTag.some((x) => targetTags.includes(x)) : targetTags.includes(targetTag))) return false;
  if (f.tag && !tavernFactions(piecesFor(battle, actor?.uid), battle.opts?.flags?.independent?.catalog).includes(f.tag)) return false;
  if (f.status && !(Array.isArray(f.status) ? f.status.includes(event.status) : event.status === f.status || (f.status === 'frozen' && event.status === 'freeze'))) return false;
  if (f.entered && !event.entered) return false;
  if ((f.nativeSource || f.nativeOnly) && (event.source?.mem?.independentOrigin || event.opts?.independentOrigin || event.dmg?.tags?.includes('independentEquipment') || event.opts?.tags?.includes('independentEquipment'))) return false;
  if (f.nativeTraitProduction && event.origin !== 'native') return false;
  if (f.baseBadgeOnly && !recordLookup(battle.opts?.flags?.independent?.catalog?.badges, event.id)) return false;
  const effectiveHeal = event.target ? Math.max(0, Math.min(Number(event.amount) || 0, Number(event.target.s?.maxHp ?? 0) - Number(event.target.hp ?? 0))) : 0;
  if (f.effective && !(effectiveHeal > 0)) return false;
  if (f.excludeOverheal && effectiveHeal < Number(event.amount || 0)) return false;
  if (f.excludeEquipment && (event.opts?.independentOrigin || event.opts?.tags?.includes('independentEquipment'))) return false;
  if (f.selectedAmmoSkill && event.skill?.kind !== 'ammo' && !event.skill?.ammo) return false;
  if (f.ammoOnly && event.skill && event.skill.kind !== 'ammo' && !event.skill.ammo) return false;
  if (f.range === 'attacker' && !withinRange(battle, owner, target)) return false;
  if (f.range === 'observer' && !withinRange(battle, observer, target)) return false;
  if (Number(f.sameRowCount) > 0) {
    const n = battle.allyUnits.filter((u) => u.kind === 'op' && u.ownerId === owner.ownerId && u.homeR === owner.homeR && !u.removed).length;
    if (n < Number(f.sameRowCount)) return false;
  }
  return true;
}

function createRewardEmitter(battle) {
  const rewards = [];
  const used = new Map();
  const emit = ({ id, quantity, origin, sourceUid, cap = null, copied = false }) => {
    if (!id || !Number.isFinite(Number(quantity))) throw new Error(`invalid independent battle reward ${id}`);
    if (Number(quantity) <= 0) return 0;
    const key = `${origin}:${sourceUid}:${id}:${copied ? 'copied' : 'base'}`;
    const current = used.get(key) ?? 0;
    const allowed = cap == null ? Number(quantity) : Math.max(0, Math.min(Number(quantity), Number(cap) - current));
    if (allowed <= 0) return 0;
    const merged = rewards.find((r) => r.id === id && r.origin === origin && r.sourceUid === sourceUid && !!r.copied === !!copied);
    if (merged) merged.quantity += allowed;
    else rewards.push({ id, quantity: allowed, origin, sourceUid, ...(copied ? { copied: true } : {}) });
    used.set(key, current + allowed);
    if (origin === 'native') {
      const actor = battle.allyUnits.find((u) => u.uid === sourceUid && u.kind === 'op');
      if (actor) battle.emit('nativeProduction', { actor, sourceUid, id, quantity: allowed, origin, copied, replay: copied });
    }
    return allowed;
  };
  battle.independentRewards = rewards;
  return emit;
}

function installProductionRule(battle, owner, rule, origin, sourceId, emit) {
  const p = rule.params ?? {};
  const trigger = p.counterEvent ?? rule.trigger;
  const every = Number(p.counterEvery ?? 1);
  if (!(every > 0) || !Array.isArray(p.outputs) || (p.outputs.length === 0 && !p.copyOutputFromEvent)) throw new Error(`eventProduction ${owner.defId}:${sourceId} has invalid threshold/outputs`);
  const countKey = `independentCounter:${origin}:${sourceId}:${rule.trigger}`;
  owner.mem.independentState.counters[countKey] = Number(owner.mem.independentState.counters[countKey]) || 0;
  let lastHealGroup = null;
  const listener = (event) => {
    const actor = getActor(event, trigger);
    const lifecycleEvent = trigger === 'death' || trigger === 'deploy';
    if ((!owner.alive || !owner.deployed) && !lifecycleEvent) return;
    if (actor && (!actor.alive || !actor.deployed) && !lifecycleEvent) return;
    if (!filterMatches(battle, { ...rule, params: p }, event, actor, owner)) return;
    if (trigger === 'heal' && p.filter?.groupHealCountsOnce) {
      const skill = actor?.skill;
      const groupKey = `${actor?.uid ?? ''}:${skill?.activations ?? 'passive'}:${Math.round(battle.time * 1e6)}`;
      if (groupKey === lastHealGroup) return;
      lastHealGroup = groupKey;
    }
    if (trigger === 'attack' && event.isSkill) return;
    if (trigger === 'nativeProduction' && (event.copied || event.replay)) return;
    if (p.excludeCopy && (event.copied || event.replay)) return;
    const eventCount = Number(owner.mem.independentState.counters[`${countKey}:events`] || 0);
    if (p.firstOnly && eventCount > 0) return;
    if (p.firstN != null && eventCount >= Number(p.firstN)) return;
    if (Number(p.probability) > 0 && battle.rng() >= Number(p.probability)) return;
    const delta = trigger === 'ammoUsed' ? Number(event.amount ?? event.consumed ?? 1) : 1;
    if (!(delta > 0)) return;
    owner.mem.independentState.counters[`${countKey}:events`] = eventCount + 1;
    owner.mem.independentState.counters[countKey] += delta;
    const batches = Math.floor(owner.mem.independentState.counters[countKey] / every);
    if (!batches) return;
    owner.mem.independentState.counters[countKey] -= batches * every;
    const outputs = p.copyOutputFromEvent
      ? [{ id: event.id, quantity: Number(event.quantity || 0) * Number(p.quantity ?? 1) }]
      : p.outputs.map((output) => output.idFromEvent ? { ...output, id: event.id } : output);
    for (const output of outputs) {
      let quantity = Number(output.quantity ?? output.perEvent ?? 1) * batches;
      if (p.requiresPlayerChoice) {
        const ids = [...new Set(outputs.map((x) => x.id).filter((id) => recordLookup(battle.opts?.flags?.independent?.catalog?.badges, id)))];
        const chosen = owner.mem.independentState.preferences?.productionBadge;
        const selected = ids.includes(chosen) ? chosen : ids[0];
        if (output.id !== selected) continue;
      }
      if (p.maxPerBattle != null && !p.capPerOutput) {
        const producedKey = `${countKey}:produced`;
        const produced = Number(owner.mem.independentState.counters[producedKey] || 0);
        quantity = Math.max(0, Math.min(quantity, Number(p.maxPerBattle) - produced));
        if (quantity > 0) owner.mem.independentState.counters[producedKey] = produced + quantity;
      }
      const cap = p.capPerOutput ?? p.maxPerBattle;
      emit({ id: output.id, quantity, origin, sourceUid: owner.uid, cap, copied: !!p.copyOutputFromEvent || !!p.requiresPlayerChoice });
    }
  };
  battle.on(trigger, listener, { owner });
}

function installNativeCombat(battle, catalog, pieces, emit) {
  const byUid = new Map(pieces.map((piece) => [piece.uid, piece]));
  for (const unit of battle.allyUnits) {
    if (unit.kind !== 'op') continue;
    const piece = byUid.get(unit.uid);
    if (!piece) continue;
    const rules = rulesOf(catalog, piece.chessId);
    unit.mem.independentState = { counters: {}, active: true, preferences: structuredClone(piece.nativeState?.preferences ?? {}) };
    if (piece.bodyPenaltyApplied) {
      const record = nativeRecord(piece, catalog);
      const before = loadoutRecord(record, piece)?.stats ?? record?.stats;
      const after = nativeBodyStats(piece, catalog);
      if (!before || !after) throw new Error(`bodyPenaltyApplied piece ${piece.uid} lacks native base stats`);
      for (const [field, statKey] of [['atk', 'atk'], ['maxHp', 'maxHp']]) {
        const loss = Number(before[field]) - Number(after[field]);
        if (Number.isFinite(loss) && loss > 0) unit.base[statKey] = Math.max(field === 'atk' ? 0 : 1, Number(unit.base[statKey]) - loss);
      }
    }
    const entries = equipmentFor(piece, catalog);
    const stats = sumBadgeMods(catalog, entries);
    const startMods = traitsOnBattleStart(unit, catalog, piece, entries);
    const special = splitBattleMods(stats.mods);
    const baseMods = { ...special.buffs };
    mergeMods(baseMods, startMods);
    if (Object.keys(baseMods).length) battle.addBuff(unit, { key: `independent:equipment:${unit.uid}`, mods: baseMods, persist: true, allowDead: true });
    installSpecialStatHooks(battle, unit, special);
    installDerivedNativeRules(battle, unit, piece, catalog, entries);
    for (const rule of rules) {
      const p = rule.params ?? {};
    if (rule.behavior === 'eventProduction') installProductionRule(battle, unit, rule, 'native', rule.behavior, emit);
      else if (rule.behavior === 'conditionalDamage') {
        if (!['attack', 'hit'].includes(rule.trigger)) throw new Error(`conditionalDamage ${piece.chessId} has unsupported trigger ${rule.trigger}`);
        battle.on('hit', ({ source, target, dmg }) => {
          if (source !== unit || target?.side !== 'enemy' || !dmg || dmg.type === 'element') return;
          const tag = p.targetTag;
          if (tag && !target.def?.tags?.includes(tag)) return;
          if (p.condition === 'boundOrSluggish' && !target.s.flags.bind && !target.findBuff('sluggish')) return;
          if (p.multiplier != null) dmg.amount *= Number(p.multiplier);
          else if (p.bonusPercent != null) dmg.mul *= 1 + Number(p.bonusPercent);
        }, { owner: unit });
      } else if (rule.behavior === 'weakDamage') {
        if (!['attack', 'hit'].includes(rule.trigger)) throw new Error(`weakDamage ${piece.chessId} has unsupported trigger ${rule.trigger}`);
        battle.on('hit', ({ source, target, dmg }) => {
          if (source === unit && target?.side === 'enemy' && dmg && (dmg.type === 'phys' || dmg.type === 'arts')) dmg.type = weaknessType(source, target, dmg);
        }, { priority: WEAKNESS_PRIORITY, owner: unit });
      } else if (!['badgeThresholdStat', 'staticStats', 'deployWindowStats', 'startDerivedStats'].includes(rule.behavior)) {
        throw new Error(`unimplemented independent native rule ${piece.chessId}:${rule.behavior}`);
      }
    }
  }
}

function installEquipmentCombatRule(battle, catalog, unit, piece, rule, entries, emit, itemIdValue) {
  const behavior = rule?.behavior;
  const p = rule?.params ?? {};
  if (!behavior || !rule.trigger) throw new Error(`combatEquipment ${itemIdValue} has an invalid effect descriptor`);
  if (behavior === 'eventProduction') {
    installProductionRule(battle, unit, rule, 'equipment', itemIdValue, emit);
    return;
  }
  if (behavior === 'conditionalDamage') {
    if (!['hit', 'attack'].includes(rule.trigger)) throw new Error(`combatEquipment ${itemIdValue}: conditionalDamage requires hit/attack trigger`);
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || target?.side !== 'enemy' || !dmg || dmg.type === 'element') return;
      if (p.targetTag && !target.def?.tags?.includes(p.targetTag)) return;
      if (p.condition === 'boundOrSluggish' && !target.s.flags.bind && !target.findBuff('sluggish')) return;
      if (p.condition === 'distanceAtLeast' && Math.abs(Math.round(target.y - unit.y)) + Math.abs(Math.round(target.x - unit.x)) < Number(p.distance)) return;
      const multiplier = Number(p.multiplier);
      if (Number.isFinite(multiplier) && multiplier > 0) dmg.mul *= multiplier;
      else if (p.bonusPercent != null) dmg.mul *= 1 + Number(p.bonusPercent);
    }, { owner: unit });
    return;
  }
  if (behavior === 'weakDamage') {
    if (rule.trigger !== 'hit') throw new Error(`combatEquipment ${itemIdValue}: weakDamage requires hit trigger`);
    battle.on('hit', ({ source, target, dmg }) => {
      if (source === unit && target?.side === 'enemy' && dmg && (dmg.type === 'phys' || dmg.type === 'arts')) dmg.type = weaknessType(source, target, dmg);
    }, { priority: WEAKNESS_PRIORITY, owner: unit });
    return;
  }
  if (behavior === 'staticStats') {
    const stats = p.stats ?? Object.fromEntries(Object.entries(p).filter(([key]) => STAT_MODS[key]));
    const mods = {};
    for (const [stat, value] of Object.entries(stats)) mergeMods(mods, modFromStat(stat, value));
    const special = splitBattleMods(mods);
    if (Object.keys(special.buffs).length) battle.addBuff(unit, { key: `independent:gear:${unit.uid}:${itemIdValue}`, mods: special.buffs, persist: true, allowDead: true });
    installSpecialStatHooks(battle, unit, special);
    return;
  }
  const ownPair = (id) => entries.some((entry) => entry.sourceId === id || entry.id === id || entry.rec.id === id);
  const hasTag = (tag) => !tag || tavernFactions(piece, catalog).includes(tag);
  const scaleStat = (stat, value) => {
    const mods = {};
    if (value != null && Number(value) !== 0) mergeMods(mods, modFromStat(stat, value));
    return mods;
  };
  const cooldownReady = (key, cd = 0) => {
    const prev = Number(unit.mem[key] ?? -Infinity);
    if (battle.time < prev + cd) return false;
    unit.mem[key] = battle.time;
    return true;
  };
  if (behavior === 'disarmOnHit' || behavior === 'silenceOnHit' || behavior === 'slowOnHit') {
    const cooldown = Number(p.cooldownSeconds ?? 0);
    const duration = Number(p.durationSeconds ?? 0);
    if (!(duration > 0 && cooldown >= 0)) throw new Error(`combatEquipment ${itemIdValue}:${behavior} has invalid duration/cooldown`);
    if (p.groundOnly && unit.def?.position !== 'MELEE') return;
    const mainTargets = new Map();
    battle.on('beforeAttack', ({ attacker, targets, isSkill }) => {
      if (attacker !== unit || isSkill) return;
      mainTargets.set(battle._attackSeq + 1, targets?.[0]?.id ?? null);
    }, { owner: unit });
    battle.on('damaged', ({ source, target, amount, dmg }) => {
      const mainTargetId = mainTargets.get(dmg?.attackId);
      if (source !== unit || target?.side !== 'enemy' || !(amount > 0) || target.id !== mainTargetId) return;
      mainTargets.delete(dmg.attackId);
      if (!cooldownReady(`independentGearCd:${itemIdValue}`, cooldown)) return;
      if (behavior === 'disarmOnHit') applyEquipmentStatus(battle, unit, target, 'disarm', { duration });
      else if (behavior === 'silenceOnHit') applyEquipmentStatus(battle, unit, target, 'silence', { duration });
      else battle.addBuff(target, { key: `independent:slow:${itemIdValue}`, duration, refresh: 'replace', mods: { aspd: Number(p.attackSpeedFlat ?? 0), moveMul: Math.max(0, 1 + Number(p.moveSpeedPercent ?? 0)) } });
    }, { owner: unit });
    return;
  }
  if (behavior === 'resistanceIgnore') {
    battle.on('hit', ({ source, dmg }) => {
      if (source !== unit || dmg?.type !== p.damageType) return;
      dmg.resIgnorePct += Math.max(0, Math.min(1, Number(p.ratio ?? 0)));
    }, { owner: unit });
    return;
  }
  if (behavior === 'eventStats' || behavior === 'gainBattleStats') {
    if (!hasTag(p.requiresTag)) return;
    const stats = p.stats ?? (p.attackPercent != null ? { attackPercent: p.attackPercent } : p.attackSpeedFlat != null ? { attackSpeedFlat: p.attackSpeedFlat } : {});
    const maxStacks = Number(p.maxStacks ?? p.maxAttackSpeed ?? Infinity);
    let stacks = 0;
    const trigger = behavior === 'gainBattleStats' ? null : rule.trigger;
    let lastActivation = null;
    if (behavior === 'gainBattleStats') {
      const gained = Number(stateCounter(battle, piece, 'gainedThisPrep') ?? stateCounter(battle, piece, 'gained') ?? 0);
      const amount = Math.min(maxStacks, gained * Number(p.attackSpeedPerGain ?? 0));
      if (amount) battle.addBuff(unit, { key: `independent:gear:${itemIdValue}`, mods: { aspd: amount }, persist: true, allowDead: true });
      return;
    }
    const sourceEvent = trigger === 'damageTaken' ? 'damaged' : trigger;
    if (!['attack', 'skillStart', 'heal', 'damaged', 'deploy'].includes(sourceEvent)) throw new Error(`combatEquipment ${itemIdValue}: unsupported eventStats trigger ${rule.trigger}`);
    battle.on(sourceEvent, (event) => {
      if (sourceEvent === 'attack' && (event.attacker !== unit || event.isSkill)) return;
      if (sourceEvent === 'skillStart' && event.unit !== unit) return;
      if (sourceEvent === 'heal' && (event.source !== unit || (p.effectiveOnly && !(event.amount > 0 && event.target.hp < event.target.s.maxHp)))) return;
      if (sourceEvent === 'heal' && p.countOncePerActivation && unit.skill?.activations != null) {
        if (lastActivation === unit.skill.activations) return;
        lastActivation = unit.skill.activations;
      }
      if (sourceEvent === 'damaged' && event.target !== unit) return;
      if (sourceEvent === 'deploy' && event.unit !== unit) return;
      const key = `independentGearStacks:${itemIdValue}`;
      stacks = Math.min(maxStacks, stacks + 1);
      const resolved = {};
      for (const [stat, value] of Object.entries(stats)) {
        const scalar = Number(value);
        if (Number.isFinite(scalar)) mergeMods(resolved, modFromStat(stat, scalar), stacks);
      }
      const special = splitBattleMods(resolved);
      const duration = p.duration === 'battle' ? Infinity : (Number(p.durationSeconds) || Infinity);
      battle.addBuff(unit, { key, duration, refresh: 'replace', persist: duration === Infinity, mods: special.buffs, allowDead: true });
      installSpecialStatHooks(battle, unit, special);
    }, { owner: unit });
    return;
  }
  if (behavior === 'deploySpRecovery') {
    battle.on('deploy', ({ unit: deployed }) => {
      if (deployed !== unit) return;
      const ownFactions = tavernFactions(piece, catalog);
      const shared = battle.allyUnits.filter((ally) => ally !== unit && ally.kind === 'op' && ally.deployed && tavernFactions(piecesFor(battle, ally.uid), catalog).some((tag) => ownFactions.includes(tag))).length;
      const amount = Number(p.base ?? 0) + Math.min(Number(p.maxBonus ?? Infinity), shared * Number(p.perSharedFactionAlly ?? 0));
      if (amount > 0) unit.skill?.gainSp(amount, 'independentEquipment');
    }, { owner: unit });
    return;
  }
  if (behavior === 'deployWindowDamage') {
    let until = -Infinity;
    battle.on('deploy', ({ unit: deployed }) => {
      if (deployed === unit) until = battle.time + Number(p.durationSeconds ?? 0);
    }, { owner: unit });
    battle.on('hit', ({ source, dmg }) => {
      if (source === unit && dmg && battle.time < until) dmg.mul *= Number(p.multiplier ?? 1);
    }, { owner: unit });
    return;
  }
  if (behavior === 'lethalGuard') {
    let uses = 0;
    battle.on('fatal', (ctx) => {
      if (ctx.unit !== unit || uses >= Number(p.perBattle ?? 1)) return;
      uses++;
      ctx.prevented = true;
      ctx.unit.hp = Math.max(Number(p.minimumHp ?? 1), ctx.unit.hp);
      if (Number(p.durationSeconds) > 0) battle.addBuff(unit, { key: `independent:lethalGuard:${itemIdValue}`, duration: Number(p.durationSeconds), flags: { invulnerable: true }, allowDead: true });
    }, { owner: unit });
    return;
  }
  if (behavior === 'deployFirstHitStatus') {
    let used = 0;
    let armed = false;
    const pendingTargets = new Map();
    if (p.resetOnDeploy) battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) armed = true; }, { owner: unit });
    battle.on('beforeAttack', ({ attacker, targets: attackTargets, isSkill }) => {
      if (attacker !== unit || isSkill || used >= Number(p.maxPerBattle ?? Infinity)) return;
      pendingTargets.set(battle._attackSeq + 1, attackTargets?.[0]?.id ?? null);
    }, { owner: unit });
    battle.on('damaged', ({ source, target, amount, dmg }) => {
      const attackId = dmg?.attackId;
      if (source !== unit || !(amount > 0) || !target || !pendingTargets.has(attackId)) return;
      const mainTargetId = pendingTargets.get(attackId);
      pendingTargets.delete(attackId);
      if (!armed || target.id !== mainTargetId || used >= Number(p.maxPerBattle ?? Infinity)) return;
      if (applyEquipmentStatus(battle, unit, target, p.status, { duration: Number(p.durationSeconds ?? 0) })) used++;
      armed = false;
    }, { owner: unit });
    return;
  }
  if (behavior === 'firstDamageStatus') {
    let used = false;
    battle.on('damaged', ({ target, amount }) => {
      if (target !== unit || !(amount > 0) || used) return;
      used = true;
      battle.applyStatus(unit, p.status, { source: unit, duration: Number(p.durationSeconds ?? 0), force: true });
    }, { owner: unit });
    return;
  }
  if (behavior === 'blockedDamageReduction') {
    battle.on('hit', ({ source, target, dmg }) => {
      if (target !== unit || source?.side !== 'enemy' || !dmg) return;
      if (p.condition === 'blocking' && !unit.blocking?.length) return;
      if (p.attackerNotBlockedByOwner && source.blockedBy === unit) return;
      dmg.mul *= Math.max(0, 1 - Number(p.reduction ?? 0));
    }, { owner: unit });
    return;
  }
  if (behavior === 'healOnHit') {
    const pendingAttacks = new Set();
    const healedAttacks = new Set();
    battle.on('beforeAttack', ({ attacker, targets, isSkill }) => {
      if (attacker !== unit || isSkill) return;
      if (targets?.[0]) pendingAttacks.add(battle._attackSeq + 1);
    }, { owner: unit });
    battle.on('damaged', ({ source, target, amount, dmg }) => {
      const attackId = dmg?.attackId;
      if (source !== unit || !(amount > 0) || !unit.alive || !pendingAttacks.has(attackId) || healedAttacks.has(attackId)) return;
      pendingAttacks.delete(attackId);
      healedAttacks.add(attackId);
      battle.heal(unit, unit, unit.s.maxHp * Number(p.maxHpPercent ?? 0), { self: true, tags: ['independentEquipment'] });
    }, { owner: unit });
    return;
  }
  if (behavior === 'lastBulletRefund') {
    let used = 0;
    battle.on('ammoUsed', ({ unit: actor, skill }) => {
      if (actor !== unit || !skill || used >= Number(p.maxPerBattle ?? Infinity)) return;
      const threshold = Number(p.thresholdRemaining ?? 1);
      if (Number(skill.ammoLeft ?? 0) > threshold) return;
      used++;
      const amount = Math.max(Number(p.minimum ?? 1), Math.floor(Number(skill.ammoMax ?? skill.ammo ?? 0) * Number(p.initialAmmoRatio ?? 0)));
      if (amount > 0) skill.addAmmo(amount);
    }, { owner: unit });
    return;
  }
  if (behavior === 'artsDamageAfterburn') {
    const ratio = Number(p.ratio ?? 0);
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !target?.alive || dmg?.type !== 'arts' || !(ratio > 0)) return;
      const key = `independentAfterburn:${unit.uid}:${itemIdValue}`;
      if (p.cannotReenter && target.findBuff(key)) return;
      battle.addBuff(target, { key, source: unit, duration: 3, interval: 1, refresh: p.cannotReenter ? 'keep' : 'replace',
        onTick: () => { if (target.alive) battle.dealDamage(unit, target, { amount: unit.s.atk * ratio, type: 'arts', tags: ['independentEquipment'] }); } });
    }, { owner: unit });
    return;
  }
  if (behavior === 'statusImmunityAtHp') {
    const minHpRatio = Number(p.minHpRatio ?? 0);
    const statuses = new Set((p.statuses || []).map((status) => status === 'frozen' ? 'freeze' : status));
    battle.on('beforeStatus', (ctx) => {
      if (ctx.target === unit && unit.hp / Math.max(1, unit.s.maxHp) >= minHpRatio && statuses.has(ctx.status)) ctx.cancel = true;
    }, { owner: unit });
    return;
  }
  if (behavior === 'countedHealShield') {
    let count = 0;
    let nextAt = 0;
    let lastHealGroup = null;
    battle.on('heal', (ctx) => {
      const target = ctx.target;
      if (ctx.source !== unit || !(Math.min(Number(ctx.amount) || 0, Math.max(0, target?.s?.maxHp - target?.hp)) > 0)) return;
      const activeEquipmentShield = (target?.buffs ?? []).some((buff) => buff.key?.startsWith('independent:equipmentShield:') && buff.shieldHits > 0);
      if (p.skipTargetWithEquipmentShield && activeEquipmentShield) return;
      const activation = unit.skill?.activations ?? null;
      if (p.groupHealCountsOnce) {
        const group = `${activation ?? 'passive'}:${Math.round(battle.time * 1e6)}`;
        if (group === lastHealGroup) return;
        lastHealGroup = group;
      }
      count++;
      if (count < Number(p.counterEvery ?? 1) || battle.time < nextAt) return;
      count = 0;
      nextAt = battle.time + Number(p.cooldownSeconds ?? 0);
      const shieldTotal = (target?.buffs ?? []).filter((buff) => buff.key?.startsWith('independent:equipmentShield:') || buff.key?.startsWith('independent:countedHealShield:')).reduce((sum, buff) => sum + Math.max(0, Number(buff.shieldHits) || 0), 0);
      const shieldKey = `independent:countedHealShield:${unit.uid}:${itemIdValue}`;
      const current = target?.findBuff(shieldKey)?.shieldHits ?? 0;
      const charges = Math.min(Number(p.shieldCharges ?? 1), Math.max(0, 2 - shieldTotal));
      if (charges > 0) battle.addBuff(target, { key: shieldKey, shieldHits: current + charges, duration: Infinity, persist: true });
    }, { owner: unit });
    return;
  }
  if (behavior === 'singleRevive') {
    let used = false;
    let restoring = false;
    battle.on('death', ({ unit: dead, reason }) => {
      if (dead !== unit || reason !== 'killed' || used) return;
      used = true;
      restoring = true;
      unit.respawnAt = battle.time + Number(p.delaySeconds ?? 0);
    }, { owner: unit });
    battle.on('deploy', ({ unit: deployed }) => {
      if (deployed !== unit || !restoring) return;
      restoring = false;
      unit.hp = Math.max(1, unit.s.maxHp * Number(p.maxHpRatio ?? 1));
    }, { owner: unit });
    return;
  }
  if (behavior === 'countedStatus') {
    let count = 0;
    const procTargets = new Map();
    battle.on('beforeAttack', ({ attacker, targets: attackTargets, isSkill }) => {
      if (attacker !== unit || isSkill) return;
      count++;
      if (count < Number(p.counterEvery ?? 1)) return;
      count = 0;
      if (attackTargets?.[0]) procTargets.set(battle._attackSeq + 1, attackTargets[0].id);
    }, { owner: unit });
    battle.on('damaged', ({ source, target, amount, dmg }) => {
      const attackId = dmg?.attackId;
      if (source !== unit || !(amount > 0) || !procTargets.has(attackId) || target?.id !== procTargets.get(attackId)) return;
      applyEquipmentStatus(battle, unit, target, p.status, { duration: Number(p.durationSeconds ?? 0) });
      procTargets.delete(attackId);
    }, { owner: unit });
    return;
  }
  if (behavior === 'damageConversion') {
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !dmg || !target || dmg.tags?.includes('independentEquipment') || dmg.type === 'true') return;
      const from = new Set(p.from ?? []);
      if (dmg.type === 'phys' && !from.has('nativePhysical')) return;
      if (dmg.type === 'arts' && !from.has('nativeArts')) return;
      if ((p.exclude ?? []).includes('equipmentDamage') && dmg.tags?.includes('independentEquipment')) return;
      if ((p.exclude ?? []).includes('trueDamage') && dmg.type === 'true') return;
      if (p.to === 'weak') dmg.type = weaknessType(unit, target, dmg);
      else if (p.to === 'arts' || p.to === 'phys') dmg.type = p.to;
      else throw new Error(`combatEquipment ${itemIdValue}: unknown damageConversion target ${p.to}`);
    }, { owner: unit });
    return;
  }
  if (behavior === 'pairedEquipmentRegen') {
    if (!ownPair(p.partnerSourceId)) return;
    let carry = 0;
    battle.on('tick', ({ dt }) => {
      if (!unit.alive || !unit.deployed || unit.hp >= unit.s.maxHp) return;
      carry += Number(dt || 0);
      if (carry < 1) return;
      const ticks = Math.floor(carry);
      carry -= ticks;
      const amount = unit.s.maxHp * Number(p.maxHpPercentPerSecond ?? 0) * ticks;
      unit.hp = Math.min(unit.s.maxHp, unit.hp + amount);
    }, { owner: unit });
    return;
  }
  if (behavior === 'pairedEquipmentHitDamage') {
    if (!ownPair(p.partnerSourceId)) return;
    battle.on('attack', ({ attacker, targets, isSkill }) => {
      if (attacker !== unit || isSkill) return;
      let ratio = Number(p.trueDamageAttackRatio ?? 0);
      if (p.pairedMultiplier != null) ratio *= Number(p.pairedMultiplier);
      for (const target of targets || []) if (target?.alive && target.side === 'enemy') battle.dealDamage(unit, target, { amount: unit.s.atk * ratio, type: 'true', tags: ['independentEquipment'] });
    }, { owner: unit });
    return;
  }
  if (behavior === 'countedAttackDamage') {
    let count = 0;
    const multipliers = new Map();
    battle.on('beforeAttack', ({ attacker, targets, isSkill }) => {
      if (attacker !== unit || isSkill || !hasTag(p.requiresTag)) return;
      const eligible = (targets || []).filter((target) => target?.alive && target.side === 'enemy' && (!p.requiresInRangeEnemy || withinRange(battle, unit, target)));
      if (!eligible.length) return;
      count++;
      let multiplier = 1;
      if (count >= Number(p.counterEvery ?? 1)) {
        count = 0;
        multiplier = Number(p.multiplier ?? 1);
        if (p.pairedSourceId && ownPair(p.pairedSourceId)) multiplier *= Number(p.pairedMultiplier ?? 1);
      }
      multipliers.set(battle._attackSeq + 1, multiplier);
    }, { owner: unit });
    battle.on('hit', ({ source, dmg }) => {
      const multiplier = multipliers.get(dmg?.attackId) ?? 1;
      if (source === unit && dmg && multiplier !== 1) dmg.mul *= multiplier;
    }, { owner: unit });
    return;
  }
  if (behavior === 'damageReductionAndRetaliation') {
    let nextRetaliation = 0;
    battle.on('hit', ({ source, target, dmg }) => {
      if (target !== unit || source?.side !== 'enemy' || !dmg) return;
      if (!(dmg.amount > 0)) return;
      const sourceStats = source.s;
      const targetStats = unit.s;
      const defenseResult = mitigate(dmg.amount, dmg.type, targetStats, {
        defIgnorePct: dmg.defIgnorePct + Number(sourceStats?.defIgnorePct ?? 0),
        defIgnoreFlat: dmg.defIgnoreFlat + Number(sourceStats?.defIgnoreFlat ?? 0),
        resIgnorePct: dmg.resIgnorePct + Number(sourceStats?.resIgnorePct ?? 0),
        resIgnoreFlat: dmg.resIgnoreFlat + Number(sourceStats?.resIgnoreFlat ?? 0),
      });
      const currentFinal = defenseResult * dmg.mul * Number(targetStats.dmgTakenMul ?? 1)
        * Number(sourceStats?.dmgDealtMul ?? 1)
        * Number(dmg.type === 'phys' ? sourceStats?.physDealtMul ?? 1 : dmg.type === 'arts' ? sourceStats?.artsDealtMul ?? 1 : 1)
        * Number(dmg.type === 'phys' ? targetStats.physTakenMul ?? 1 : dmg.type === 'arts' ? targetStats.artsTakenMul ?? 1 : targetStats.trueTakenMul ?? 1);
      if (currentFinal > 0) {
        const wanted = Math.max(Math.min(Number(p.minimumDamage ?? 1), currentFinal), currentFinal - Number(p.flatReduction ?? 0));
        dmg.mul *= wanted / currentFinal;
      }
      if (hasTag(p.requiresTag) && battle.time >= nextRetaliation) {
          let ratio = Number(p.retaliationAttackPercent ?? 0);
          if (p.pairedSourceId && ownPair(p.pairedSourceId)) ratio *= Number(p.pairedMultiplier ?? 1);
          if (ratio > 0) battle.dealDamage(unit, source, { amount: unit.s.atk * ratio, type: 'arts', tags: ['independentEquipment'] });
          nextRetaliation = battle.time + Number(p.retaliationCooldownSeconds ?? 0);
      }
    }, { owner: unit });
    return;
  }
  if (behavior === 'steamGearUpgrade') {
    // Selection only upgrades special effects. Base stats on each equipped item remain its own normal/elite value.
    return;
  }
  if (behavior === 'coldAuraDamage') {
    if (!hasTag(p.requiresTag)) return;
    battle.on('tick', ({ dt }) => {
      if (!unit.alive || !unit.deployed) return;
      unit.mem[`independentColdAura:${itemIdValue}`] = (unit.mem[`independentColdAura:${itemIdValue}`] || 0) + Number(dt || 0);
      if (unit.mem[`independentColdAura:${itemIdValue}`] < 1) return;
      unit.mem[`independentColdAura:${itemIdValue}`] -= 1;
      const paired = ownPair(p.pairedSourceId);
      const ratio = Number(paired ? (p.pairedDamageRatio ?? p.damageRatio) : p.damageRatio ?? 0);
      for (const target of battle.enemies) {
        if (!target.alive || !target.deployed || !withinRange(battle, unit, target)) continue;
        if (p.condition === 'inRangeColdOrFrozen' && !target.findBuff('cold') && !target.s.flags.freeze) continue;
        battle.dealDamage(unit, target, { amount: unit.s.atk * ratio, type: 'arts', tags: ['independentEquipment'] });
      }
    }, { owner: unit });
    return;
  }
  if (behavior === 'skillRecovery') {
    if (!hasTag(p.requiresTag)) return;
    let fired = false;
    let pairedStartCount = 0;
    battle.on('skillEnd', ({ unit: actor }) => {
      if (actor !== unit || (p.firstOnly && fired)) return;
      fired = true;
      if (Number(p.sp) > 0) unit.skill?.gainSp(Number(p.sp), 'independentEquipment');
    }, { owner: unit });
    if (ownPair(p.pairedSourceId) && Number(p.teamSpPerSkillStart) > 0) {
      battle.on('skillStart', ({ unit: actor }) => {
        if (actor.ownerId !== unit.ownerId || pairedStartCount >= Number(p.pairedSkillStartCap ?? Infinity)) return;
        pairedStartCount++;
        for (const ally of battle.allyUnits) if (ally.kind === 'op' && ally.ownerId === unit.ownerId) ally.skill?.gainSp(Number(p.teamSpPerSkillStart), 'independentEquipment');
      }, { owner: unit });
    }
    return;
  }
  if (behavior === 'redeployAndSkillWindow') {
    if (!hasTag(p.requiresTag)) return;
    const paired = ownPair(p.pairedSourceId);
    battle.on('skillStart', ({ unit: actor }) => {
      if (actor !== unit) return;
      const duration = Number(p.slowWindowSeconds ?? 0);
      for (const enemy of battle.enemies) if (enemy.alive && enemy.deployed) battle.addBuff(enemy, { key: `independent:skillWindowSlow:${unit.uid}`, duration, refresh: 'replace', mods: { moveMul: Math.max(0, 1 - Number(p.slowPercent ?? 0)) } });
      if (paired && Number(p.pairedAttackPercent) > 0) battle.addBuff(unit, { key: `independent:pairedSkillAttack:${unit.uid}:${itemIdValue}`, duration, refresh: 'replace', mods: { atkPct: Number(p.pairedAttackPercent) }, allowDead: true });
    }, { owner: unit });
    return;
  }
  if (behavior === 'stealthBreakDamage') {
    if (!hasTag(p.requiresTag)) return;
    const paired = ownPair(p.pairedSourceId);
    let hadStealth = false;
    let armed = false;
    let procs = 0;
    const procCap = Number(p.pairedProcMaxPerBattle ?? Infinity);
    battle.on('tick', () => {
      if (!unit.alive || !unit.deployed) { hadStealth = false; return; }
      const hasStealth = !!(unit.s.flags.stealth || unit.findBuff('stealth'));
      if (hasStealth) hadStealth = true;
      else if (hadStealth) { armed = true; hadStealth = false; }
    }, { owner: unit });
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== unit || !unit.alive || !unit.deployed || !armed || !dmg || dmg.isSkill) return;
      dmg.mul *= 1 + Number(p.damageBonus ?? 0);
      if (paired && procs < procCap) {
        battle.dealDamage(unit, target, { amount: unit.s.atk * Number(p.trueDamageAttackRatio ?? 0), type: 'true', tags: ['independentEquipment'] });
        procs++;
      }
      armed = false;
    }, { owner: unit });
    return;
  }
  if (behavior === 'badgeThresholdStat') {
    const badgeCount = badgeCountFor(entries, p.badgeIds);
    const every = Number(p.every ?? p.requiredBadgeCount);
    if (!(every > 0)) throw new Error(`combatEquipment ${itemIdValue}: badgeThresholdStat needs every/requiredBadgeCount`);
    const mods = {};
    for (const [stat, value] of Object.entries(p.stats ?? {})) mergeMods(mods, modFromStat(stat, value), Math.floor(badgeCount / every));
    const special = splitBattleMods(mods);
    if (Object.keys(special.buffs).length) battle.addBuff(unit, { key: `independent:gear:${unit.uid}:${itemIdValue}`, mods: special.buffs, persist: true, allowDead: true });
    installSpecialStatHooks(battle, unit, special);
    return;
  }
  if (behavior === 'deployWindowStats') {
    if (rule.trigger !== 'deploy') throw new Error(`combatEquipment ${itemIdValue}: deployWindowStats requires deploy trigger`);
    const duration = p.duration === 'deployment' ? Infinity : (Number(p.durationSeconds) || Infinity);
    const every = Number(p.every ?? p.requiredBadgeCount ?? 1);
    if (!(duration > 0 && every > 0)) throw new Error(`combatEquipment ${itemIdValue}: deployWindowStats needs a positive duration/every`);
    battle.on('deploy', ({ unit: deployed }) => {
      if (deployed !== unit) return;
      const front = battle.allyUnits.find((candidate) => {
        if (candidate === unit || candidate.kind !== 'op' || candidate.ownerId !== unit.ownerId || !candidate.deployed || candidate.removed) return false;
        const [r, c] = frontOf(unit.homeR, unit.homeC, unit.dir);
        return candidate.homeR === r && candidate.homeC === c;
      });
      const install = (target, stats, suffix) => {
        if (!stats || typeof stats !== 'object') return;
        const mods = {};
        for (const [stat, value] of Object.entries(stats)) mergeMods(mods, modFromStat(stat, value), Math.floor(badgeCountFor(entries, p.badgeIds) / every));
        if (p.maxHpPercent != null) mergeMods(mods, modFromStat('maxHpPercent', p.maxHpPercent));
        if (!front && p.noFrontAllyBonus != null) mergeMods(mods, modFromStat('maxHpPercent', p.noFrontAllyBonus));
        if (!Object.keys(mods).length) return;
        const key = `independent:gearWindow:${itemIdValue}:${target.uid}`;
        const current = target.findBuff(key);
        if (p.sameNameDoesNotStack && current) {
          const newer = Math.max(...Object.values(mods).filter(Number.isFinite));
          const previous = Math.max(...Object.values(current.mods || {}).filter(Number.isFinite));
          if (previous >= newer) return;
        }
        battle.addBuff(target, { key: `${key}:${suffix}`, duration, refresh: 'replace', mods, allowDead: true });
      };
      install(unit, p.self ?? p.stats ?? (p.maxHpPercent != null ? {} : null), 'self');
      if (front && p.adjacentHorizontalAllies) {
        for (const ally of battle.allyUnits.filter((candidate) => candidate.kind === 'op' && candidate.ownerId === unit.ownerId && candidate.deployed && candidate.homeR === unit.homeR && Math.abs(candidate.homeC - unit.homeC) === 1)) {
          install(ally, p.adjacentHorizontalAllies, 'ally');
        }
      }
    }, { owner: unit });
    return;
  }
  if (behavior === 'startDerivedStats') {
    if (rule.trigger !== 'battleStart') throw new Error(`combatEquipment ${itemIdValue}: startDerivedStats requires battleStart trigger`);
    const every = Number(p.every ?? p.requiredBadgeCount ?? 1);
    if (!(every > 0)) throw new Error(`combatEquipment ${itemIdValue}: startDerivedStats needs every`);
    battle.on('battleStart', () => {
      const [frontR, frontC] = frontOf(unit.homeR, unit.homeC, unit.dir);
      const front = battle.allyUnits.find((candidate) => candidate.kind === 'op' && candidate.ownerId === unit.ownerId && candidate.homeR === frontR && candidate.homeC === frontC && candidate !== unit && !candidate.removed);
      const frontPiece = front && pieces.find((x) => x.uid === front.uid);
      const stacks = Math.floor((badgeCountFor(entries, p.badgeIds) + (frontPiece ? badgeCountFor(equipmentFor(frontPiece, catalog), p.badgeIds) : 0)) / every);
      const mods = {};
      if (Number.isFinite(Number(p.attackSpeedFlatPerStack))) mods.aspd = stacks * Number(p.attackSpeedFlatPerStack);
      if (Number.isFinite(Number(p.redeployTimeReductionPercentPerStack))) mods.redeployMul = Math.max(0, 1 - Math.min(Number(p.maxRedeployTimeReduction ?? 0.3), stacks * Number(p.redeployTimeReductionPercentPerStack)));
      if (Object.keys(mods).length) battle.addBuff(unit, { key: `independent:gearStart:${unit.uid}:${itemIdValue}`, mods, persist: true, allowDead: true });
    }, { owner: unit });
    return;
  }
  throw new Error(`unimplemented independent combatEquipment behavior ${behavior} (${itemIdValue})`);
}

function installEquipmentMechanisms(battle, catalog, pieces, emit) {
  for (const unit of battle.allyUnits) {
    if (unit.kind !== 'op') continue;
    const piece = pieces.find((p) => p.uid === unit.uid);
    if (!piece) continue;
    const ownedEntries = equipmentFor(piece, catalog);
    const factionSet = new Set(tavernFactions(piece, catalog));
    for (const steam of ownedEntries.filter((e) => e.kind === 'equipment' && e.rec.mechanism === 'combatEquipment')) {
      const steamEffect = (steam.rec.params?.effects ?? []).find((effect) => effect.behavior === 'steamGearUpgrade');
      if (!steamEffect || !factionSet.has(steamEffect.params?.requiresTag)) continue;
      const selected = steam.item.state?.hammerSourceIds ?? [];
      const maxSelected = Number(steamEffect.params?.chooseVariantsOnEquip?.[steam.item.elite ? 'elite' : 'normal'] ?? 0);
      if (!Array.isArray(selected) || selected.length > maxSelected) throw new Error(`steamGearUpgrade ${steam.id} has invalid hammerSourceIds selection`);
      for (const sourceId of selected) {
        const target = ownedEntries.find((e) => e.sourceId === sourceId);
        if (!target || !(steamEffect.params.sourceIds ?? []).includes(sourceId)) throw new Error(`steamGearUpgrade ${steam.id} selects an unavailable hammer ${sourceId}`);
        target.specialElite = true;
      }
    }
    const shieldCharges = Math.min(2, ownedEntries.filter((e) => e.kind === 'equipment' && e.rec.mechanism === 'equipmentShield')
      .reduce((sum, e) => {
        const n = Number(e.rec.params?.charges);
        if (!(n > 0)) throw new Error(`equipmentShield ${e.id} needs params.charges`);
        return sum + n;
      }, 0));
    if (shieldCharges > 0) {
      unit.mem.independentEquipmentShield = shieldCharges;
      battle.addBuff(unit, { key: `independent:equipmentShield:${unit.uid}`, shieldHits: shieldCharges, duration: Infinity, persist: true, allowDead: true });
    }
    for (const e of ownedEntries) {
      if (e.kind !== 'equipment') continue;
      const p = effectiveEquipmentParams(e);
      switch (e.rec.mechanism) {
        case undefined:
        case null:
        case 'badgeAmplifier':
        case 'identityTag':
        case 'prepEndForge':
        case 'saleThresholdRecruit':
        case 'stats':
          break;
        case 'equipmentShield': {
          break;
        }
        case 'healingCapacitor': {
          const ratio = Number(p.thresholdMaxHpRatio);
          const damageRatio = Number(p.damageRatio);
          const cooldown = Number(p.cooldownSeconds);
          if (!(ratio > 0 && damageRatio > 0 && cooldown >= 0) || p.damageType !== 'arts') throw new Error(`healingCapacitor ${e.id} has invalid params`);
          const key = `independentCapacitor:${unit.uid}`;
          unit.mem[key] = { stored: 0, nextAt: 0 };
          battle.on('heal', (ctx) => {
            if (ctx.target !== unit || !ctx.source || ctx.source === unit || ctx.source.side !== 'ally') return;
            if (ctx.opts?.self || ctx.opts?.independentOrigin) return;
            const effective = Math.max(0, Math.min(Number(ctx.amount) || 0, unit.s.maxHp - unit.hp));
            if (!effective) return;
            const s = unit.mem[key];
            s.stored += effective;
            const threshold = unit.s.maxHp * ratio;
            if (s.stored < threshold || battle.time < s.nextAt) return;
            s.stored -= threshold;
            s.nextAt = battle.time + cooldown;
            for (const enemy of battle.enemies) {
              if (!enemy.alive || !enemy.deployed) continue;
              const dist = Math.abs(Math.round(enemy.y) - Math.round(unit.y)) + Math.abs(Math.round(enemy.x) - Math.round(unit.x));
              if (dist > 1) continue;
              battle.dealDamage(unit, enemy, { amount: unit.s.atk * damageRatio, type: 'arts', tags: ['independentEquipment'] });
            }
          }, { owner: unit });
          break;
        }
        case 'statsAndDrain': {
          const v = p;
          const attackPercent = Number(v.attackPercent ?? 0);
          const hpLoss = Number(v.hpLossPerSecond ?? 0);
          if (attackPercent) battle.addBuff(unit, { key: `independent:statsAndDrain:${unit.uid}:${e.id}`, mods: { atkPct: attackPercent }, persist: true, allowDead: true });
          if (hpLoss > 0) battle.addBuff(unit, {
            key: `independent:statsAndDrainTick:${unit.uid}:${e.id}`, duration: Infinity, interval: 1, persist: true, allowDead: true,
            onTick: () => { if (unit.alive) battle.loseHp(unit, hpLoss, { tags: ['independentEquipment'] }); },
          });
          break;
        }
        case 'statsAndRedeploy': {
          const v = p;
          const mods = {};
          if (Number(v.maxHpPercent)) mods.hpPct = Number(v.maxHpPercent);
          if (Number(v.redeployTimeReduction)) mods.redeployMul = Math.max(0, 1 - Number(v.redeployTimeReduction));
          if (Object.keys(mods).length) battle.addBuff(unit, { key: `independent:statsAndRedeploy:${unit.uid}:${e.id}`, mods, persist: true, allowDead: true });
          break;
        }
        case 'attackEventProduction': {
          const rule = { trigger: p.counterEvent ?? 'attack', behavior: 'eventProduction', params: p };
          installProductionRule(battle, unit, rule, 'equipment', e.id, emit);
          break;
        }
        case 'combatEquipment': {
          if (!Array.isArray(p.effects)) throw new Error(`combatEquipment ${e.id} requires params.effects[]`);
          if (Number(p.initialSp) > 0) battle.on('battleStart', () => unit.skill?.gainSp(Number(p.initialSp), 'independentEquipment'), { owner: unit });
          for (const effect of p.effects) installEquipmentCombatRule(battle, catalog, unit, piece, selectVariant(effect, !!e.item.elite || !!e.specialElite), ownedEntries, emit, e.sourceId ?? e.id);
          break;
        }
        default:
          throw new Error(`unimplemented independent equipment mechanism ${e.rec.mechanism} (${e.id})`);
      }
    }
    for (const attachment of entryArray(piece.attachments)) {
      const id = itemId(attachment);
      const rec = recordLookup(catalog.attachments, id);
      if (!rec) throw new Error(`unknown independent attachment ${id} on piece ${piece.uid}`);
      const p = rec.params ?? {};
      if (rec.mechanism === 'eventProduction') installProductionRule(battle, unit, { trigger: p.counterEvent, behavior: 'eventProduction', params: p }, 'attachment', rec.id, emit);
      else if (rec.mechanism === 'prepEndForge') {
        // Prep-phase forging is deliberately handled by the independent prep transaction.
        if (!Array.isArray(p.outputs)) throw new Error(`prepEndForge attachment ${id} has invalid outputs`);
      } else throw new Error(`unimplemented independent attachment mechanism ${rec.mechanism ?? id}`);
    }
  }
}

function installEvents(battle, catalog, pieces, emit) {
  installNativeCombat(battle, catalog, pieces, emit);
  installEquipmentMechanisms(battle, catalog, pieces, emit);
}

/** Install the isolated battle-only mechanics for a real Battle instance. */
export function installIndependentBattle(battle, { catalog, state } = {}) {
  if (!battle || typeof battle.on !== 'function') throw new TypeError('installIndependentBattle requires a Battle instance');
  if (!catalog) throw new TypeError('installIndependentBattle requires catalog');
  const pieces = entryArray(state?.pieces);
  for (const piece of pieces) {
    if (!piece || piece.uid == null || typeof piece.chessId !== 'string') throw new TypeError('independent battle piece requires uid and chessId');
    rulesOf(catalog, piece.chessId);
  }
  const emit = createRewardEmitter(battle);
  installEvents(battle, catalog, pieces, emit);
}
