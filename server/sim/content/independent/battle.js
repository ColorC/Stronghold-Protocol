import { hypot } from '../../detmath.js';
import { weaknessType, WEAKNESS_PRIORITY } from '../garrisons/battle.js';
import { frontOf } from '../../dir.js';
import { nativeBodyStats, nativeRecord, tavernFactions } from '../../../../shared/independentRules.js';
import { loadoutRecord } from '../../../../shared/loadoutRecord.js';
import { levelBodyStats } from '../../../../shared/independentGrowth.js';
import { mitigate } from '../../damage.js';
import { installKeywordGear } from './keywordGear.js';
import { validateAllyConditionStats } from '../../../modes/independent/native.js';
import { INDEPENDENT_BADGE_STATS, independentBadgeMod } from '../../../../shared/independentBadgeStats.js';
import { applyDamageIncrease } from '../../../../shared/damageIncrease.js';
import { installWarband } from './warband.js';
import { WARBAND_BEHAVIORS } from '../../../../shared/warbandSchema.js';
import { installDarkmoonCombat } from './darkmoonCombat.js';
import { findSummonTile, tokenCanEngageAt } from '../tokens.js';

// temporary combat traits (2026-10-07, installTemporaryNativeRules)
// 干员特质 v4 (2026-10-07, 方舟化) adds: aura 在场光环 · rangeDebuff 攻击范围内敌人状态 · statusOnHit 命中上状态 · healedBuff 被治疗者
// 加成 · onKillSp 击倒回技力 · markSpread 灼痕蔓延 · blockRetaliate 阻挡时按防御力反击 (照抄身前一格 is a prep rule: native.js)
const TEMPORARY_BEHAVIORS = new Set(['battleStartBuff', 'deployBuff', 'skillStartBuff', 'allyDownStacks', 'onDown', 'firstWaveStrike', 'shieldAllies', 'summonBoost', 'everyNthAttack', 'overkillSpill',
  'aura', 'rangeDebuff', 'statusOnHit', 'healedBuff', 'onKillSp', 'markSpread', 'blockRetaliate', 'allyConditionStats']);
const BEHAVIORS = new Set([
  'badgeThresholdStat', 'staticStats', 'conditionalDamage', 'weakDamage', 'eventProduction',
  'deployWindowStats', 'startDerivedStats',
, 'badgeAmplifier', 'productionMultiplier', ...TEMPORARY_BEHAVIORS,...WARBAND_BEHAVIORS.filter(x=>x!=='factionReaction')]);
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
  attackSpeedFlat: 'aspd', defenceFlat: 'defFlat', defenseFlat: 'defFlat', artsDamageReduction: 'artsReduction',
  skillCostInitialPercent: 'initialSkillPointsPercent',
  // short names the temporary combat traits use
  atkPct: 'atkPct', aspd: 'aspd', defPct: 'defPct', spRegen: 'spRecoveryFlat', damageTakenPercent: 'dmgTakenMul', damageTakenPct: 'dmgTakenMul',
  // 阻挡数 (防暴塔盾, gear v4)
  blockCnt: 'blockCnt', blockCount: 'blockCnt',
});
// 2026-10-07 (user: 「装备不再有精锐形态」): gear has one form. An `elite` flag an old save still carries changes nothing in
// battle; a {normal, elite} pair in a retired item's rule reads its normal value.
const GEAR_ELITE = false;
const GEAR_TAGS = Object.freeze(['independentEquipment']);
const GEAR_ELEMENTS = new Set(['burn', 'neural', 'necrosis', 'apoptosis', 'erosion']);

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

function effectiveEquipmentParams(entry) { return selectVariant(entry.rec.params ?? {}, GEAR_ELITE); }

function equipmentFor(piece, catalog) {
  const out = [];
  const wornUnique = new Set();
  for (const item of entryArray(piece.equipment)) {
    const id = itemId(item);
    const badge = recordLookup(catalog.badges, id);
    const gear = badge ? null : recordLookup(catalog.equipment, id);
    if (!badge && (!gear || gear.available === false)) throw new Error(`unknown independent equipment ${id} on piece ${piece.uid}`);
    const legacyBadge = gear?.mechanism === 'badge' ? recordLookup(catalog.badges, gear.badgeId) : null;
    if (gear?.mechanism === 'badge' && !legacyBadge) throw new Error(`legacy badge equipment ${id} lacks a resolvable badgeId`);
    // Legacy duplicate unique gear stays in the save. Only its first copy may affect this wearer's battle.
    if (gear?.unique) {
      const key = gear.uniqueKey || gear.canonicalId || gear.id || id;
      if (wornUnique.has(key)) continue;
      wornUnique.add(key);
    }
    out.push({ item: gear?.unique ? { ...item, quantity: 1 } : item, id: badge?.id ?? legacyBadge?.id ?? gear?.sourceId ?? gear?.id ?? id, rec: badge ?? legacyBadge ?? gear, kind: badge || legacyBadge ? 'badge' : 'equipment', sourceId: gear?.sourceId ?? id });
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

/**
 * `boost(badgeId)`: the extra factor a badge has this battle on top of worn amplifiers — the team's game-long badge
 * boosts (state.playerEffects badgeBoost, native badgeBoost) and the operator's own in-battle amplifier (native
 * badgeAmplifier rule).
 */
function sumBadgeMods(catalog, entries, baseStats = {}, boost = () => 1, preserveInheritedBase = false) {
  const mods = {};
  const mergeEquipmentStat = (stat, value, quantity) => {
    const nativeBase = stat === 'attackPercent' ? baseStats.atk : stat === 'maxLifePercent' || stat === 'maxHpPercent' ? baseStats.maxHp : null;
    const flat = stat === 'attackPercent' ? 'attackFlat' : 'maxLifeFlat';
    if (preserveInheritedBase && nativeBase != null && Number.isFinite(Number(nativeBase)) && Number.isFinite(Number(value))) {
      mergeMods(mods, modFromStat(flat, Number(nativeBase) * Number(value)), quantity);
    } else mergeMods(mods, modFromStat(stat, value), quantity);
  };
  const counts = countBadges(entries);
  for (const [id, n] of counts) {
    const rec = recordLookup(catalog.badges, id);
    if (!rec?.stat) throw new Error(`badge ${id} lacks stat metadata`);
    const definition = INDEPENDENT_BADGE_STATS[id];
    const badgeStat = definition?.stat ?? rec.stat;
    const badgeValue = definition?.value ?? rec.value;
    const factors = entries.filter((e) => e.kind === 'equipment' && e.rec.mechanism === 'badgeAmplifier')
      .map((e) => {
      const p = e.rec.params ?? {};
      const legacyStats = definition?.legacy ?? [];
      const allowedStats = [badgeStat, rec.stat, ...legacyStats].filter(Boolean);
      const applicable = Array.isArray(p.badgeIds) && p.badgeIds.includes(id)
          && (!p.stats || allowedStats.some((stat) => Array.isArray(p.stats) ? p.stats.includes(stat) : Object.hasOwn(p.stats, stat)));
        if (!applicable) return 1;
        const scale = Number(p.multiplier);
        if (!(scale > 0)) throw new Error(`badge amplifier ${e.id} lacks a positive multiplier`);
        return scale;
      });
    const scale = factors.reduce((a, b) => a * b, 1) * boost(id);
    if (definition) {
      const dynamic = independentBadgeMod({ ...definition, value: badgeValue }, baseStats, n * scale);
      if (dynamic) {
        const [stat, value] = Object.entries(dynamic)[0];
        mergeMods(mods, modFromStat(stat, value));
      } else mergeMods(mods, modFromStat(definition.stat, badgeValue), n * scale);
    }
    else mergeMods(mods, modFromStat(rec.stat, rec.value), n * scale);
  }
  for (const e of entries) {
    if (e.kind !== 'equipment') continue;
    if (e.rec.stat && e.rec.value != null) mergeEquipmentStat(e.rec.stat, selectVariant(e.rec.value, GEAR_ELITE), Math.max(1, Number(e.item.quantity) || 1));
    const itemStats = e.rec.stats ?? {};
    if (!Array.isArray(itemStats)) for (const [stat, rawValue] of Object.entries(itemStats)) {
      const quantity = Math.max(1, Number(e.item.quantity) || 1);
      const value = rawValue && typeof rawValue === 'object' && (Object.hasOwn(rawValue, 'normal') || Object.hasOwn(rawValue, 'elite'))
        ? rawValue.normal ?? rawValue.elite
        : rawValue;
      if (!Array.isArray(rawValue) && value != null) mergeEquipmentStat(stat, value, quantity);
    }
  }
  return { mods, counts };
}

function splitBattleMods(mods, unit) {
  const buffs = { ...mods };
  const initialSp = Number(buffs.initialSkillPoints || 0);
  const initialSpPercent = Number(buffs.initialSkillPointsPercent || 0);
  const normalAttackDamageBonus = Number(buffs.normalAttackDamageBonus || 0);
  const redeployReduction = Number(buffs.redeployReduction || 0);
  delete buffs.initialSkillPoints;
  delete buffs.initialSkillPointsPercent;
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
  const cost = Number(unit?.skill?.spCost) || 0;
  return { buffs, initialSp: Math.min(cost, initialSp + cost * initialSpPercent), normalAttackDamageBonus };
}

function installSpecialStatHooks(battle, unit, { initialSp = 0, normalAttackDamageBonus = 0 } = {}) {
  if (initialSp > 0) battle.on('deploy', ({ unit: deployed }) => {
    if (deployed === unit) unit.skill?.gainSp(initialSp, 'independentBadge');
  }, { owner: unit });
  if (normalAttackDamageBonus > 0) battle.on('hit', ({ source, dmg }) => {
    if (source === unit && dmg?.isAttack && !dmg.isSkill && dmg.type !== 'element') applyDamageIncrease(battle, source, dmg, 1 + normalAttackDamageBonus);
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

// ---- temporary combat traits (user 2026-10-07: 「不是所有随从，或者说很多随从都不是针对于长期buff的，很多都是战斗时临时buff」) ----
// An operator's trait that changes this battle only: buffs at battle start / on deploy / on its skill, stacks as allies
// fall, an effect when it falls, a strike once the first enemies are in, shields handed out, summons made stronger,
// something every Nth attack. Nothing here outlives the battle.

/**
 * The allies a temporary trait reaches: self | front | adjacent (周围四格) | around8 (周围八格) | row | inRange (攻击范围内)
 * | all | faction:<阵营> | faction:same | profession:<PROFESSION>. `only` narrows them: { faction, melee, hpAbove,
 * notProfession }.
 */
function traitTargets(battle, unit, targets = 'self', only = null) {
  // a list reaches the union, each operator once
  if (Array.isArray(targets)) return [...new Set(targets.flatMap((t) => traitTargets(battle, unit, t, only)))];
  const found = traitTargetsOf(battle, unit, targets);
  return only ? found.filter((u) => matchesOnly(battle, u, only)) : found;
}
function matchesOnly(battle, u, only) {
  const catalog = battle.opts?.flags?.independent?.catalog;
  if (only.faction && !tavernFactions(piecesByUid(battle, u.uid), catalog).includes(only.faction)) return false;
  if (only.melee && u.def?.position !== 'MELEE') return false;
  if (only.notProfession && u.def?.profession === only.notProfession) return false;
  if (only.hpAbove != null && !(u.hp / Math.max(1, u.s.maxHp) > Number(only.hpAbove))) return false;
  return true;
}
function traitTargetsOf(battle, unit, targets) {
  const ops = battle.allyUnits.filter((u) => u.kind === 'op' && u.ownerId === unit.ownerId && u.alive && u.deployed && !u.removed);
  if (targets === 'self') return unit.alive ? [unit] : [];
  if (targets === 'front') { const [r, c] = frontOf(unit.homeR, unit.homeC, unit.dir); return ops.filter((u) => u !== unit && u.homeR === r && u.homeC === c); }
  if (targets === 'adjacent') return ops.filter((u) => u !== unit && Math.abs(u.homeR - unit.homeR) + Math.abs(u.homeC - unit.homeC) === 1);
  if (targets === 'around8') return ops.filter((u) => u !== unit && Math.max(Math.abs(u.homeR - unit.homeR), Math.abs(u.homeC - unit.homeC)) === 1);
  if (targets === 'inRange') return ops.filter((u) => u !== unit && withinRange(battle, unit, u));
  if (targets === 'row') return ops.filter((u) => u.homeR === unit.homeR);
  if (targets === 'all') return ops;
  const catalog = battle.opts?.flags?.independent?.catalog;
  const factions = (u) => tavernFactions(piecesByUid(battle, u.uid), catalog);
  if (targets === 'faction:same') { const mine = new Set(factions(unit)); return ops.filter((u) => factions(u).some((f) => mine.has(f))); }
  if (String(targets).startsWith('faction:')) { const f = String(targets).slice(8); return ops.filter((u) => factions(u).includes(f)); }
  if (String(targets).startsWith('profession:')) { const prof = String(targets).slice(11); return ops.filter((u) => u.def?.profession === prof); }
  throw new Error(`unknown temporary trait targets ${targets}`);
}
function statMods(stats = {}, times = 1) {
  const mods = {};
  for (const [stat, value] of Object.entries(stats)) mergeMods(mods, modFromStat(stat, value), times);
  return mods;
}
/** A buff from a trait: `duration` seconds, or the whole battle when it is 'battle' / missing. */
function traitBuff(battle, target, key, mods, duration) {
  const timed = Number.isFinite(Number(duration)) && Number(duration) > 0;
  if (!Object.keys(mods).length) return;
  battle.addBuff(target, timed ? { key, duration: Number(duration), refresh: 'replace', mods } : { key, mods, persist: true, refresh: 'replace' });
}
function grantShieldLayers(battle, target, layers, cap = 2) {
  const key = `independent:equipmentShield:${target.uid}`;
  const have = Number(target.findBuff(key)?.shieldHits ?? 0);
  const total = Math.min(cap, have + layers);
  if (total > have) battle.addBuff(target, { key, shieldHits: total, duration: Infinity, persist: true, allowDead: true, refresh: 'replace' });
}
// 弱点伤害 handed out by a trait (宴): the operators marked here deal weakness damage for the rest of the battle
const WEAK_MARKED = new WeakMap();
function markWeakDamage(battle, target) {
  let marked = WEAK_MARKED.get(battle);
  if (!marked) {
    marked = new WeakSet(); WEAK_MARKED.set(battle, marked);
    battle.on('hit', ({ source, target: hit, dmg }) => {
      if (marked.has(source) && hit?.side === 'enemy' && dmg && (dmg.type === 'phys' || dmg.type === 'arts')) dmg.type = weaknessType(source, hit, dmg);
    }, { priority: WEAKNESS_PRIORITY });
  }
  marked.add(target);
}
/** Operators of ours waiting on the bench this battle (no tile). */
const benchCount = (battle) => (battle.opts?.flags?.independent?.pieces || []).filter((p) => p.row == null || p.col == null).length;

// 脆弱 / 法术脆弱 / 受到的物理伤害提升 given by a trait (user 2026-10-07: 「原版的脆弱什么的都不管」): their own effect. They are
// buffs under their own keys, never the catalogue status, so an operator's original talent or skill (同名效果取最高 among
// themselves) neither overrides nor absorbs them; they multiply with it.
const TRAIT_STATUS_MODS = Object.freeze({
  fragile: (v) => ({ dmgTakenMul: 1 + v }), artsFragile: (v) => ({ artsTakenMul: 1 + v }), physFragile: (v) => ({ physTakenMul: 1 + v }),
});
const TRAIT_STATUS_TYPES = Object.freeze({ fragile: ['phys', 'arts', 'true'], artsFragile: ['arts'], physFragile: ['phys'] });
function traitStatus(battle, source, target, status, value, duration) {
  const mods = TRAIT_STATUS_MODS[status];
  if (!mods) throw new Error(`unknown trait status ${status}`);
  if (!target?.alive || !(Number(value) > 0) || !(Number(duration) > 0)) return;
  battle.addBuff(target, { key: `independent:traitStatus:${status}:${source.uid}`, duration: Number(duration), refresh: 'replace', mods: mods(Number(value)), source });
}
const isEliteOrLeader = (e) => e?.isBoss || e?.def?.rank === 'ELITE' || e?.def?.rank === 'BOSS';
/** An enemy a rangeDebuff `only` lets through: { eliteOrLeader, levitate }. */
function enemyMatches(e, only) {
  if (!only) return true;
  if (only.eliteOrLeader && !isEliteOrLeader(e)) return false;
  if (only.levitate && !e.s?.flags?.levitate) return false;
  return true;
}
// 攻击范围内的敌人受到…: one hit hook per battle reads every source standing now (after the damage type is settled)
const RANGE_DEBUFFS = new WeakMap();
function rangeDebuffs(battle) {
  let list = RANGE_DEBUFFS.get(battle);
  if (list) return list;
  list = [];
  RANGE_DEBUFFS.set(battle, list);
  battle.on('hit', ({ target, dmg }) => {
    if (!dmg || target?.side !== 'enemy' || !list.length) return;
    for (const d of list) {
      if (!d.active() || !(TRAIT_STATUS_TYPES[d.status] || []).includes(dmg.type)) continue;
      if (!withinRange(battle, d.unit, target) || !enemyMatches(target, d.only)) continue;
      dmg.mul *= 1 + d.value;
    }
  }, { priority: WEAKNESS_PRIORITY - 10 });
  return list;
}
/** How many times `unit` was put on the field this battle (a tile move is not a deployment). */
function deployCounter(battle, unit) {
  const s = { count: 0, at: -Infinity };
  battle.on('deploy', ({ unit: who, move }) => { if (who === unit && !move) { s.count++; s.at = battle.time; } }, { owner: unit, priority: 100 });
  return s;
}
const onField = (unit) => unit.alive && unit.deployed && !unit.removed;
/**
 * `fn(event)` on every deployment of `unit` (a tile move aside). The opening deployment runs at battle start, once the
 * whole field is in (operators come in one after another, and a neighbour deployed after it would miss out).
 */
function onDeployOf(battle, unit, fn) {
  let opening = null;
  battle.on('deploy', (ev) => {
    if (ev.unit !== unit || ev.move) return;
    if (ev.initial) opening = ev; else fn(ev);
  }, { owner: unit });
  battle.on('battleStart', () => { if (opening && onField(unit)) fn(opening); opening = null; }, { owner: unit });
}

function installTemporaryNativeRules(battle, unit, piece, catalog, rules) {
  rules.forEach((rule, index) => {
    const p = rule.params ?? {};
    const key = `independent:trait:${unit.uid}:${index}`;
    // perBench: the stats count once for every operator on the bench, up to maxBench
    const times = () => (p.perBench ? Math.min(benchCount(battle), Number(p.maxBench ?? Infinity)) : 1);
    const give = (targets, stats, duration, spGain) => {
      const n = times();
      if (n <= 0) return [];
      const reached = traitTargets(battle, unit, targets, p.only);
      for (const t of reached) {
        traitBuff(battle, t, `${key}:${t.uid}`, statMods(stats, n), duration);
        if (Number(spGain) > 0) t.skill?.gainSp(Number(spGain) * n, 'independentTrait');
        if (p.weakDamage) markWeakDamage(battle, t);
      }
      return reached;
    };
    switch (rule.behavior) {
      case 'allyConditionStats': {
        validateAllyConditionStats(p);
        if (rule.trigger !== 'passive') throw new Error('BAD_ALLY_CONDITION_STATS_TRIGGER');
        let next = -Infinity;
        let lastCount = -1;
        const base = nativeBodyStats(piece, catalog);
        const m = p.match;
        const refresh = () => {
          next = battle.time + 0.2;
          if (!onField(unit)) { battle.removeBuff(unit, key); lastCount = -1; return; }
          const matched = battle.allyUnits.filter((u) => {
            if (u === unit || u.uid === unit.uid || u.kind !== 'op' || u.ownerId !== unit.ownerId || !onField(u)) return false;
            const other = piecesByUid(battle, u.uid);
            if (!other || other.row == null || other.col == null || other.removed || other.deleted) return false;
            const prof = nativeRecord(other, catalog)?.profession;
            if (m.faction && !tavernFactions(other, catalog).includes(m.faction)) return false;
            if (m.profession && prof !== m.profession) return false;
            if (m.professions && !m.professions.includes(prof)) return false;
            if (m.keywordGear && !(other.equipment || []).some((item) => {
              const def = recordLookup(catalog.equipment, itemId(item));
              return def?.mechanism === 'keywordGear' && def.name === m.keywordGear && Number(item.quantity ?? 1) > 0;
            })) return false;
            if (m.baseStat) {
              const stat = Number(nativeBodyStats(other, catalog)[m.baseStat]);
              if (!Number.isFinite(stat) || (m.minBaseStat != null && stat < m.minBaseStat)
                  || (m.minBaseStatRatioToSelf != null && stat < Number(base[m.baseStat]) * m.minBaseStatRatioToSelf)) return false;
            }
            return true;
          });
          const unique = [...new Map(matched.map((u) => [u.uid, u])).values()];
          const count = p.countBy === 'factions' ? new Set(unique.flatMap((u) => tavernFactions(piecesByUid(battle, u.uid), catalog))).size
            : p.countBy === 'professions' ? new Set(unique.map((u) => nativeRecord(piecesByUid(battle, u.uid), catalog)?.profession).filter(Boolean)).size : unique.length;
          if (count === lastCount) return;
          lastCount = count;
          if (count) traitBuff(battle, unit, key, statMods(p.stats, count), 'battle');
          else battle.removeBuff(unit, key);
        };
        battle.on('battleStart', refresh, { owner: unit });
        battle.on('deploy', ({ initial }) => { if (!initial) refresh(); }, { owner: unit });
        battle.on('death', refresh, { owner: unit });
        battle.on('tick', () => { if (battle.time + 1e-9 >= next) refresh(); }, { owner: unit });
        break;
      }
      case 'battleStartBuff':
        battle.on('battleStart', () => give(p.targets, p.stats, p.duration, p.spGain), { owner: unit });
        break;
      case 'deployBuff': {
        // firstDeployOnly: 首次部署; redeployOnly: 每次再部署; delay: 部署后经过N秒时 (still on the field then)
        const deploys = deployCounter(battle, unit);
        let pendingAt = null;
        onDeployOf(battle, unit, () => {
          if (p.firstDeployOnly && deploys.count !== 1) return;
          if (p.redeployOnly && deploys.count < 2) return;
          if (Number(p.delay) > 0) pendingAt = deploys.at + Number(p.delay);
          else give(p.targets, p.stats, p.duration, p.spGain);
        });
        if (Number(p.delay) > 0) battle.on('tick', () => {
          if (pendingAt == null || battle.time + 1e-9 < pendingAt) return;
          pendingAt = null;
          if (onField(unit)) give(p.targets, p.stats, p.duration, p.spGain);
        }, { owner: unit });
        break;
      }
      case 'skillStartBuff': {
        // duration 'skill': 技能持续期间 — the buffs leave when the skill ends (or the operator falls)
        let held = [];
        const drop = () => { for (const t of held) battle.removeBuff(t, `${key}:${t.uid}`); held = []; };
        battle.on('skillStart', ({ unit: who }) => {
          if (who !== unit) return;
          if (p.duration === 'skill') { drop(); held = give(p.targets, p.stats, 'battle', p.spGain); } else give(p.targets, p.stats, p.duration, p.spGain);
        }, { owner: unit });
        if (p.duration === 'skill') {
          battle.on('skillEnd', ({ unit: who }) => { if (who === unit) drop(); }, { owner: unit });
          battle.on('death', ({ unit: who }) => { if (who === unit) drop(); }, { owner: unit });
        }
        break;
      }
      case 'aura': {
        // 在场时: while it stands, the targets (re-read every 0.2 s: who stands where, whose HP is above the line) carry the
        // buff; it lapses within half a second of the operator falling and comes back when it is deployed again
        let next = -Infinity;
        const pulse = () => {
          if (!onField(unit) || battle.time < next) return;
          next = battle.time + 0.2;
          for (const t of traitTargets(battle, unit, p.targets, p.only)) traitBuff(battle, t, `${key}:${t.uid}`, statMods(p.stats), 0.5);
        };
        battle.on('battleStart', pulse, { owner: unit });
        battle.on('deploy', ({ unit: who }) => { if (who === unit) { next = -Infinity; pulse(); } }, { owner: unit });
        battle.on('tick', pulse, { owner: unit });
        break;
      }
      case 'rangeDebuff': {
        // on 'skillStart': the enemies in range at that moment get the status (寒冷) once. Otherwise lasting: while it stands
        // (delay: N seconds after it was deployed; duringSkill: while its skill runs) the enemies in range take more damage
        if (p.on === 'skillStart') {
          battle.on('skillStart', ({ unit: who }) => {
            if (who !== unit) return;
            for (const e of battle.enemies) if (e.alive && e.deployed !== false && withinRange(battle, unit, e) && enemyMatches(e, p.only)) battle.applyStatus(e, p.status, { duration: Number(p.duration), source: unit });
          }, { owner: unit });
          break;
        }
        const deploys = deployCounter(battle, unit);
        rangeDebuffs(battle).push({ unit, status: p.status, value: Number(p.value), only: p.only,
          active: () => onField(unit) && (!(Number(p.delay) > 0) || battle.time - deploys.at + 1e-9 >= Number(p.delay)) && (!p.duringSkill || !!unit.skill?.active) });
        break;
      }
      case 'statusOnHit': {
        // 攻击使目标受到…: every damage it deals (its trait's and gear's own damage aside); afterOwnStun: an enemy it stuns
        if (p.afterOwnStun) {
          battle.on('statusApplied', ({ source, target, status }) => {
            if (source === unit && status === 'stun' && target?.side === 'enemy') traitStatus(battle, unit, target, p.status, p.value, p.duration);
          }, { owner: unit });
          break;
        }
        battle.on('damaged', ({ source, target, amount, dmg }) => {
          if (source !== unit || target?.side !== 'enemy' || !(amount > 0) || !target.alive) return;
          if (dmg?.type === 'element' || dmg?.tags?.includes('independentTrait') || dmg?.tags?.includes('independentEquipment')) return;
          if (p.duringSkill && !unit.skill?.active) return;
          traitStatus(battle, unit, target, p.status, p.value, p.duration);
        }, { owner: unit });
        break;
      }
      case 'healedBuff':
        // 被自身治疗的友方: every ally it heals (itself aside) carries the buff for its seconds
        battle.on('heal', ({ source, target, amount, opts }) => {
          if (source !== unit || !target || target === unit || target.side !== 'ally' || !target.alive) return;
          if(p.effectiveOnly&&!(Math.min(Number(amount)||0,Math.max(0,target.s.maxHp-target.hp))>0))return;
          if(p.nativeOnly&&(opts?.independentOrigin||opts?.tags?.includes('independentEquipment')||source.mem?.independentOrigin))return;
          traitBuff(battle, target, `${key}:${target.uid ?? target.id}`, statMods(p.stats), p.duration);
        }, { owner: unit });
        break;
      case 'onKillSp':
        // 击倒敌人时回技力: actor self (duringSkill: while its skill runs) or faction:<阵营> (any of ours of it, while this
        // operator stands); targets: its 周围四格 / the killer
        battle.on('kill', ({ killer, victim }) => {
          if (!killer || victim?.side !== 'enemy' || !onField(unit)) return;
          if (p.actor === 'self') { if (killer !== unit || (p.duringSkill && !unit.skill?.active)) return; }
          else if (String(p.actor).startsWith('faction:')) {
            if (killer.kind !== 'op' || killer.ownerId !== unit.ownerId || !matchesOnly(battle, killer, { faction: String(p.actor).slice(8) })) return;
          } else return;
          const to = p.targets === 'killer' ? [killer] : traitTargets(battle, unit, p.targets ?? 'self');
          for (const t of to) if (t.alive) t.skill?.gainSp(Number(p.sp ?? 0), 'independentTrait');
        }, { owner: unit });
        break;
      case 'markSpread':
        // 带有灼痕的敌人被击倒时，其周围的敌人也被施加灼痕: the mark (its own buff, its seconds left) and the 法术脆弱 it carries
        battle.on('kill', ({ victim }) => {
          if (victim?.side !== 'enemy' || !unit.alive) return;
          const mark = victim.findBuff(p.mark);
          if (!mark) return;
          const left = Number.isFinite(mark.until) ? Math.max(0.1, mark.until - battle.time) : Number(mark.duration) > 0 && Number.isFinite(Number(mark.duration)) ? Number(mark.duration) : 6;
          const fragile = victim.findBuff('artsFragile');
          for (const e of battle.enemies) {
            if (e === victim || !e.alive || e.deployed === false || tileDistance(e, victim) > Number(p.radius ?? 1) + 1e-9) continue;
            battle.addBuff(e, { key: p.mark, duration: left, refresh: 'extend', mods: mark.mods || null, visible: true, source: mark.source ?? unit });
            if (fragile) battle.applyStatus(e, 'artsFragile', { duration: left, value: fragile.value ?? fragile.statusValue, source: mark.source ?? unit });
          }
        }, { owner: unit });
        break;
      case 'blockRetaliate':
        // 阻挡敌人时，受到攻击会对攻击者造成相当于自身防御力N%的伤害
        battle.on('hit', ({ source, target, dmg }) => {
          if (target !== unit || source?.side !== 'enemy' || !source.alive || !dmg || dmg.type === 'element' || !onField(unit)) return;
          if (p.condition === 'blocking' && !unit.blocking?.length) return;
          battle.dealDamage(unit, source, { amount: unit.s.def * Number(p.defPct ?? 0), type: p.type ?? 'phys', tags: ['independentTrait'] });
        }, { owner: unit });
        break;
      case 'allyDownStacks': {
        // every `every` other operators of ours that fall this battle add a stack, up to maxStacks
        let fallen = 0;
        const every = Math.max(1, Number(p.every ?? 1));
        battle.on('death', ({ unit: who }) => {
          if (!who || who === unit || who.side !== 'ally' || who.kind !== 'op' || who.ownerId !== unit.ownerId || !unit.alive) return;
          fallen++;
          const stacks = Math.floor(fallen / every);
          // the stacks go to the trait's targets (itself unless it names others), counted again for whoever stands now
          if (stacks > 0) for (const t of traitTargets(battle, unit, p.targets ?? 'self')) traitBuff(battle, t, `${key}:${t.uid}`, statMods(p.stats, stacks), 'battle');
        }, { owner: unit });
        break;
      }
      case 'onDown': {
        // on 'dollSwap': 替身与本体切换时 (either way) instead of 被击倒时
        battle.on(p.on === 'dollSwap' ? 'dollSwap' : 'death', ({ unit: who }) => {
          if (who !== unit) return;
          if (p.blast) {
            const radius = Number(p.blast.radius ?? 1); const type = p.blast.type ?? 'arts';
            for (const e of battle.enemies) if (e.alive && e.deployed !== false && tileDistance(e, unit) <= radius) battle.dealDamage(unit, e, { amount: unit.s.atk * Number(p.blast.atkPct ?? 0), type, tags: ['independentTrait'] });
          }
          if (p.buff) for (const t of traitTargets(battle, unit, p.buff.targets ?? 'all').filter((t) => t !== unit)) traitBuff(battle, t, `${key}:${t.uid}`, statMods(p.buff.stats), p.buff.duration);
          if (p.shield) for (const t of traitTargets(battle, unit, p.shield.targets ?? 'adjacent').filter((t) => t !== unit)) grantShieldLayers(battle, t, Number(p.shield.layers ?? 1));
        }, { owner: unit });
        break;
      }
      case 'firstWaveStrike': {
        // once per battle: at second `atSecond`, or when `afterSpawns` enemies have appeared, every enemy on the field
        let done = false; let spawned = 0;
        const strike = () => {
          if (done || !unit.alive || !unit.deployed) return;
          done = true;
          for (const e of battle.enemies) if (e.alive && e.deployed !== false) battle.dealDamage(unit, e, { amount: unit.s.atk * Number(p.atkPct ?? 0), type: p.type ?? 'arts', tags: ['independentTrait'] });
        };
        if (p.afterSpawns) battle.on('enemySpawn', () => { if (++spawned >= Number(p.afterSpawns)) strike(); }, { owner: unit });
        else battle.on('tick', () => { if (battle.time >= Number(p.atSecond ?? 10)) strike(); }, { owner: unit });
        break;
      }
      case 'shieldAllies':
        // battle start (on 'deploy': every time it is deployed, redeploys too): `count` of the targets (wearing the fewest
        // layers first, then left to right) get `layers`, 2 at most
        (p.on === 'deploy' ? (fn) => onDeployOf(battle, unit, fn) : (fn) => battle.on('battleStart', fn, { owner: unit }))(() => {
          const list = traitTargets(battle, unit, p.targets ?? 'all').filter((t) => !p.excludeSelf || t !== unit)
            .sort((a, b) => Number(a.findBuff(`independent:equipmentShield:${a.uid}`)?.shieldHits ?? 0) - Number(b.findBuff(`independent:equipmentShield:${b.uid}`)?.shieldHits ?? 0) || a.homeC - b.homeC || a.homeR - b.homeR);
          for (const t of list.slice(0, Math.max(1, Number(p.count ?? 1)))) grantShieldLayers(battle, t, Number(p.layers ?? 1));
        }, { owner: unit });
        break;
      case 'summonBoost':
        // our summons this battle (tokens, not operators)
        battle.on('deploy', ({ unit: who }) => {
          if (!who || who.side !== 'ally' || who.kind === 'op' || who.kind === 'device' || who.ownerId !== unit.ownerId) return;
          traitBuff(battle, who, `${key}:${who.id}`, statMods({ attackPercent: Number(p.atkMul ?? 1) - 1, ...(p.stats || {}) }), 'battle');
        }, { owner: unit });
        break;
      case 'everyNthAttack': {
        let count = 0;
        const n = Math.max(1, Number(p.n ?? 3));
        battle.on('attack', ({ attacker, targets }) => {
          if (attacker !== unit || ++count < n) return;
          count = 0;
          const main = (targets || []).find((t) => t?.alive && t.side === 'enemy');
          if (!main) return;
          const [effect, arg] = String(p.effect ?? 'extraHit').split(':');
          if (effect === 'extraHit') battle.dealDamage(unit, main, { amount: unit.s.atk * Number(p.atkPct ?? 1), type: p.type ?? (unit.def?.dmgType === 'arts' ? 'arts' : 'phys'), tags: ['independentTrait'] });
          else if (effect === 'stun') applyEquipmentStatus(battle, unit, main, 'stun', { duration: Number(arg ?? p.duration ?? 1) });
          else if (effect === 'splash') { for (const e of battle.enemies) if (e.alive && e.deployed !== false && tileDistance(e, main) <= Number(p.radius ?? 1)) battle.dealDamage(unit, e, { amount: unit.s.atk * Number(p.atkPct ?? 0.5), type: p.type ?? 'phys', tags: ['independentTrait'] }); }
          else throw new Error(`everyNthAttack ${piece.chessId}: unknown effect ${p.effect}`);
        }, { owner: unit });
        break;
      }
      case 'overkillSpill': {
        // a kill's excess damage goes on to the nearest other enemy within the radius (as true damage: it was mitigated once)
        const before = new WeakMap();
        battle.on('hit', ({ source, target }) => { if (source === unit && target?.side === 'enemy') before.set(target, target.hp); }, { owner: unit });
        battle.on('damaged', ({ source, target, amount, dmg }) => {
          if (source !== unit || target?.side !== 'enemy' || target.hp > 0 || dmg?.tags?.includes('independentTrait')) return;
          const spill = amount - Number(before.get(target) ?? amount);
          if (!(spill > 0)) return;
          let next = null;
          for (const e of battle.enemies) if (e !== target && e.alive && e.deployed !== false && tileDistance(e, target) <= Number(p.radius ?? 1) && (!next || tileDistance(e, target) < tileDistance(next, target))) next = e;
          if (next) battle.dealDamage(unit, next, { amount: spill, type: 'true', tags: ['independentTrait'] });
        }, { owner: unit });
        break;
      }
      default: break;
    }
  });
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
        const ownCount = badgeCountFor(entries, p.badgeIds);
        const frontPiece = front && piecesByUid(battle, front.uid);
        const frontEntries = frontPiece ? equipmentFor(frontPiece, catalog) : [];
        const frontCount = frontPiece ? badgeCountFor(frontEntries, p.badgeIds) : 0;
        const stacks = Math.floor((ownCount + frontCount) / each);
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

const tileDistance = (a, b) => hypot(a.x - b.x, a.y - b.y);
/**
 * The keys an ally answers to for 盟约脆弱 / 盟约庇护: its 酒馆阵营 (identity tags and 锡人's all-faction tag included) and
 * `self:<uid>`, so gear on an operator without a faction works for that operator alone.
 */
function factionKeys(battle, unit) {
  const piece = unit?.uid != null ? piecesByUid(battle, unit.uid) : null;
  const tags = piece ? tavernFactions(piece, battle.opts?.flags?.independent?.catalog) : [];
  return [...tags, ...(unit?.uid != null ? [`self:${unit.uid}`] : [])];
}
/** The wearer's own marks: its factions, or itself when it has none. */
function wearerKeys(battle, unit) {
  const keys = factionKeys(battle, unit);
  return keys.length > 1 ? keys.slice(0, -1) : keys;
}
// one hit hook per battle reads every wearer's marks and auras (several wearers of one faction never stack: the largest counts)
const FACTION_GEAR = new WeakMap();
function factionGear(battle) {
  let reg = FACTION_GEAR.get(battle);
  if (reg) return reg;
  reg = { vulnerable: new Map(), guards: [] };
  FACTION_GEAR.set(battle, reg);
  battle.on('hit', ({ source, target, dmg }) => {
    if (!dmg || !source || !target) return;
    if (target.side === 'enemy' && source.side === 'ally' && reg.vulnerable.size) {
      let bonus = 0;
      for (const key of factionKeys(battle, source)) {
        const pct = reg.vulnerable.get(key);
        if (pct && target.findBuff(`independent:factionVulnerable:${key}`)) bonus = Math.max(bonus, pct);
      }
      if (bonus > 0) dmg.mul *= 1 + bonus;
    } else if (target.side === 'ally' && source.side === 'enemy' && reg.guards.length) {
      const keys = new Set(factionKeys(battle, target));
      let cut = 0;
      for (const g of reg.guards) if (g.unit.alive && g.unit.deployed && g.keys.some((k) => keys.has(k))) cut = Math.max(cut, g.pct);
      if (cut > 0) dmg.mul *= Math.max(0, 1 - cut);
    }
  });
  return reg;
}
/**
 * The main target of each of `unit`'s attacks (normal and skill attacks alike): `take(dmg, target)` is true once, for the
 * first damage that attack does to its first target. Damage the gear itself deals has no attack id and never counts.
 */
function mainTargetTracker(battle, unit) {
  const mains = new Map();
  battle.on('beforeAttack', ({ attacker, targets }) => {
    if (attacker === unit && targets?.[0]) mains.set(battle._attackSeq + 1, targets[0].id);
  }, { owner: unit });
  return {
    take(dmg, target) {
      const id = dmg?.attackId;
      if (!id || mains.get(id) !== target?.id) return false;
      mains.delete(id);
      return true;
    },
  };
}

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
  if (trigger === 'dodge' || trigger === 'damaged') return event.target ?? null;
  if (trigger === 'skillStart' || trigger === 'skillEnd' || trigger === 'deploy' || trigger === 'dollSwap' || trigger === 'ammoUsed' || trigger === 'heal') return event.unit ?? event.source ?? null;
  if (trigger === 'shieldLayersGained' || trigger === 'shieldLayersBroken') return event.unit ?? null;
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

// ---- gear v4 helpers (特殊战斗装备 第四版, 2026-10-07) ----
const liveEnemy = (e) => !!e && e.side === 'enemy' && e.alive && e.deployed !== false && !e.removed;
const isGearDamage = (dmg) => !!dmg?.tags?.includes('independentEquipment');
/**
 * 脆弱 / 法术脆弱 / 防御力降低 from gear are their own effects (user 2026-10-07: 「原版的脆弱什么的都不管」): a buff keyed by
 * the piece, shown as the status, that stacks apart from the same status of operators' talents and skills (they keep
 * the official 同名取最高 among themselves and never override or absorb it). Two hits of the same piece refresh it.
 */
const OWN_VALUED = Object.freeze({
  fragile: (v) => ({ dmgTakenMul: 1 + v }),
  artsFragile: (v) => ({ artsTakenMul: 1 + v }),
  defDown: (v) => ({ defMul: Math.max(0, 1 - v) }),
});
function gearStatus(battle, source, target, status, duration, value, itemIdValue) {
  if (!target?.alive || !(duration > 0)) return false;
  if (OWN_VALUED[status]) {
    const v = Number(value);
    if (!(v > 0)) throw new Error(`gear ${itemIdValue}: ${status} needs a positive value`);
    battle.addBuff(target, { key: `independent:gear:${status}:${itemIdValue}`, status, duration, refresh: 'replace', mods: OWN_VALUED[status](v), source });
    return true;
  }
  return applyEquipmentStatus(battle, source, target, status, { duration, ...(value != null ? { value: Number(value) } : {}) });
}
/** An extra attack a piece of gear makes (速射扳机's second shot): it counts for nothing. */
const extraAttack = (unit) => !!unit.mem.independentExtraAttack;
/**
 * A 「每发动N次普通攻击」 counter: each normal attack adds the wearer's count step (工程部节拍校准器: 2) and the counter
 * fires when it reaches N, keeping what is left over.
 */
function attackCounter(unit, every) {
  const n = Math.max(1, Number(every ?? 1));
  let count = 0;
  return () => {
    count += Math.max(1, Number(unit.mem.independentCountStep) || 1);
    if (count < n) return false;
    count -= n;
    if (count >= n) count %= n;
    return true;
  };
}
/** `onHit(target, dmg, amount)` once per normal attack, for the first damage it does to its main target. */
function normalHits(battle, unit, onHit, { skip = null } = {}) {
  const mains = new Map();
  battle.on('beforeAttack', ({ attacker, targets, isSkill }) => {
    if (attacker !== unit || isSkill || !targets?.[0] || (skip && skip())) return;
    mains.set(battle._attackSeq + 1, targets[0].id);
  }, { owner: unit });
  battle.on('damaged', ({ source, target, amount, dmg }) => {
    const id = dmg?.attackId;
    if (source !== unit || target?.side !== 'enemy' || !(amount > 0) || !id || mains.get(id) !== target.id) return;
    mains.delete(id);
    onHit(target, dmg, amount);
  }, { owner: unit });
}
/** The enemies in `unit`'s attack range now. */
const enemiesInRange = (battle, unit) => battle.enemies.filter((e) => liveEnemy(e) && withinRange(battle, unit, e));
// 炎国天师古鼎: the other 炎 operators whose next normal attack hits every enemy in their range (one hook per battle)
const TEAM_STRIKE = new WeakMap();
function teamStrike(battle) {
  let reg = TEAM_STRIKE.get(battle);
  if (reg) return reg;
  reg = { pending: new Map(), attacks: new Map() };
  TEAM_STRIKE.set(battle, reg);
  battle.on('beforeAttack', (ctx) => {
    const ratio = reg.pending.get(ctx.attacker);
    if (ratio == null || ctx.isSkill || ctx.attacker.side !== 'ally') return;
    const all = enemiesInRange(battle, ctx.attacker);
    if (!all.length) return;
    reg.pending.delete(ctx.attacker);
    ctx.targets = all;
    reg.attacks.set(battle._attackSeq + 1, ratio);
  }, { priority: 90 });
  battle.on('hit', ({ source, dmg }) => {
    const ratio = dmg?.attackId ? reg.attacks.get(dmg.attackId) : null;
    if (ratio == null || isGearDamage(dmg)) return;
    dmg.amount = source.s.atk * ratio; dmg.atkScale = 1; dmg.type = 'phys';
  }, { priority: 90 });
  return reg;
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
  if (f.actor === 'selfOrSummon' && actor !== owner && actor?.ownerUnit !== owner) return false;
  if (f.sourceSide && event.source?.side !== f.sourceSide) return false;
  if (f.element && event.element !== f.element) return false;
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
  if (f.baseBadgeOnly) {
    const outputs = Array.isArray(event.outputs) ? event.outputs : [{ id: event.id }];
    if (!outputs.some((output) => recordLookup(battle.opts?.flags?.independent?.catalog?.badges, output.id))) return false;
  }
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
  const emit = ({ id, quantity, origin, sourceUid, copied = false }) => {
    if (!id || !Number.isFinite(Number(quantity))) throw new Error(`invalid independent battle reward ${id}`);
    if (Number(quantity) <= 0) return 0;
    const allowed = Number(quantity);
    const given = allowed * Math.max(1, Number(battle.independentProductionFactor) || 1);
    const merged = rewards.find((r) => r.id === id && r.origin === origin && r.sourceUid === sourceUid && !!r.copied === !!copied);
    if (merged) merged.quantity += given;
    else rewards.push({ id, quantity: given, origin, sourceUid, ...(copied ? { copied: true } : {}) });
    return allowed;
  };
  battle.independentRewards = rewards;
  return emit;
}

function installProductionRule(battle, owner, rule, origin, sourceId, emit) {
  const p = selectVariant(rule.params ?? {}, !!owner.def?.isGolden);
  const trigger = p.counterEvent ?? rule.trigger;
  const every = Number(p.counterEvery ?? 1);
  if (!(every > 0) || !Array.isArray(p.outputs) || (p.outputs.length === 0 && !p.copyOutputFromEvent)) throw new Error(`eventProduction ${owner.defId}:${sourceId} has invalid threshold/outputs`);
  const countKey = `independentCounter:${origin}:${sourceId}:${rule.trigger}`;
  owner.mem.independentState.counters[countKey] = Number(owner.mem.independentState.counters[countKey]) || 0;
  let lastHealGroup = null;
  // selfSurvived (战斗结束时未被击倒): a fall at any time of the battle voids it
  let downed = false;
  if (p.filter?.selfSurvived) battle.on('death', ({ unit }) => { if (unit === owner) downed = true; }, { owner });
  // armedBy (塑心): each of the owner's own `armedBy` events arms one production
  let armed = 0;
  if (p.armedBy) battle.on(p.armedBy, (event) => { if (getActor(event, p.armedBy) === owner) armed++; }, { owner });
  const listener = (event) => {
    const actor = getActor(event, trigger);
    const lifecycleEvent = trigger === 'death' || trigger === 'deploy';
    if ((!owner.alive || !owner.deployed) && !lifecycleEvent) return;
    if (actor && (!actor.alive || !actor.deployed) && !lifecycleEvent) return;
    if (p.filter?.selfSurvived && downed) return;
    if (p.armedBy && armed <= 0) return;
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
    if (Number(p.probability) > 0 && battle.rng() >= Number(p.probability)) return;
    // Hit-negating shields expose layer counts, not just callback counts. This lets
    // independent eventProduction express e.g. one badge per five native or gear
    // shield layers gained/broken, while HP shields remain outside this event path.
    const delta = trigger === 'ammoUsed'
      ? Number(event.amount ?? event.consumed ?? 1)
      : (trigger === 'shieldLayersGained' || trigger === 'shieldLayersBroken')
        ? Number(event.layers ?? 1)
        : 1;
    if (!(delta > 0)) return;
    owner.mem.independentState.counters[`${countKey}:events`] = eventCount + 1;
    owner.mem.independentState.counters[countKey] += delta;
    const batches = Math.floor(owner.mem.independentState.counters[countKey] / every);
    if (!batches) return;
    owner.mem.independentState.counters[countKey] -= batches * every;
    const eventOutputs = Array.isArray(event.outputs) ? event.outputs : (event.id ? [{ id: event.id, quantity: event.quantity }] : []);
    let outputs;
    if (p.copyOutputFromEvent) {
      const badgeOutputs = eventOutputs.filter((output) => recordLookup(battle.opts?.flags?.independent?.catalog?.badges, output.id));
      const selectedId = owner.mem.independentState.preferences?.[p.fallbackPreference] ?? owner.mem.independentState.preferences?.productionBadge;
      const selected = badgeOutputs.find((output) => output.id === selectedId) ?? badgeOutputs[0];
      outputs = selected ? [{ id: selected.id, quantity: Number(p.quantity ?? 1) }] : [];
    } else {
      outputs = p.outputs.map((output) => output.idFromEvent ? { ...output, id: event.id } : output);
    }
    const producedOutputs = [];
    for (const output of outputs) {
      let quantity = Number(output.quantity ?? output.perEvent ?? 1) * batches;
      if (p.requiresPlayerChoice) {
        const ids = [...new Set(outputs.map((x) => x.id).filter((id) => recordLookup(battle.opts?.flags?.independent?.catalog?.badges, id)))];
        const chosen = owner.mem.independentState.preferences?.productionBadge;
        const selected = ids.includes(chosen) ? chosen : ids[0];
        if (output.id !== selected) continue;
      }
      const allowed = emit({ id: output.id, quantity, origin, sourceUid: owner.uid, copied: !!p.copyOutputFromEvent || !!p.requiresPlayerChoice });
      if (allowed > 0) producedOutputs.push({ id: output.id, quantity: allowed });
    }
    if (p.armedBy && producedOutputs.length) armed--;
    if (origin === 'native' && !p.copyOutputFromEvent && producedOutputs.length) {
      battle.emit('nativeProduction', { actor: owner, sourceUid: owner.uid, outputs: producedOutputs, origin, copied: false, replay: false });
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
    // Unit.base already reflects the selected native skill/module loadout. Preserve it before
    // applying a handover penalty so badge percentages never shrink with the inherited body.
    const nativeRecordForStats = nativeRecord(piece, catalog);
    if (piece.growthMode === 'levels') {
      const original = loadoutRecord(nativeRecordForStats, piece)?.stats ?? nativeRecordForStats?.stats;
      const grown = levelBodyStats(piece, catalog);
      for (const field of ['atk', 'maxHp', 'def', 'res']) {
        unit.base[field] += Number(grown[field] || 0) - Number(original?.[field] || 0);
      }
    }
    const nativeBaseStats = { ...unit.base };
    const rawNativeStats = loadoutRecord(nativeRecordForStats, piece)?.stats ?? nativeRecordForStats?.stats ?? {};
    for (const [field, aliases] of Object.entries({
      atk: ['atk', 'attack'], maxHp: ['maxHp', 'maxHP'], def: ['def', 'defense'], aspd: ['aspd', 'attackSpeed'], spRecovery: ['spRecovery', 'spRecoveryPerSec'],
    })) {
      const rawValue = aliases.map((key) => rawNativeStats[key]).find((value) => value != null);
      if (Number(rawValue) === 0) nativeBaseStats[field] = 0;
    }
    unit.mem.independentState = { counters: {}, active: true, preferences: structuredClone(piece.nativeState?.preferences ?? {}) };
    if (piece.bodyPenaltyApplied) {
      const record = nativeRecord(piece, catalog);
      const before = levelBodyStats(piece, catalog, record);
      const after = nativeBodyStats(piece, catalog);
      if (!before || !after) throw new Error(`bodyPenaltyApplied piece ${piece.uid} lacks native base stats`);
      for (const [field, statKey] of [['atk', 'atk'], ['maxHp', 'maxHp']]) {
        const loss = Number(before[field]) - Number(after[field]);
        if (Number.isFinite(loss) && loss > 0) unit.base[statKey] = Math.max(field === 'atk' ? 0 : 1, Number(unit.base[statKey]) - loss);
      }
    }
    const entries = equipmentFor(piece, catalog);
    const own = rules.filter((r) => r.behavior === 'badgeAmplifier');
    const stats = sumBadgeMods(catalog, entries, nativeBaseStats, (id) => (battle.independentBadgeBoost?.(id) ?? 1)
      * own.reduce((m, r) => m * ((r.params?.badgeIds || []).includes(id) ? Number(r.params.multiplier) || 1 : 1), 1), !!piece.bodyPenaltyApplied);
    const startMods = traitsOnBattleStart(unit, catalog, piece, entries);
    // a trait's own static stats go through the same split as the gear's (再部署时间, 初始技力 …: 幽灵鲨)
    const merged = { ...stats.mods };
    mergeMods(merged, startMods);
    const special = splitBattleMods(merged, unit);
    const baseMods = { ...special.buffs };
    if (Object.keys(baseMods).length) battle.addBuff(unit, { key: `independent:equipment:${unit.uid}`, mods: baseMods, persist: true, allowDead: true });
    installSpecialStatHooks(battle, unit, special);
    installDerivedNativeRules(battle, unit, piece, catalog, entries);
    installTemporaryNativeRules(battle, unit, piece, catalog, rules);
    const productionOnTrigger = new Map();
    for (const rule of rules) {
      const p = rule.params ?? {};
    if (rule.behavior === 'eventProduction') {
      // a second production rule on the same trigger counts on its own (the first keeps the key it always had)
      const nth = productionOnTrigger.get(rule.trigger) || 0; productionOnTrigger.set(rule.trigger, nth + 1);
      installProductionRule(battle, unit, rule, 'native', nth ? `${rule.behavior}#${nth}` : rule.behavior, emit);
    }
      else if (rule.behavior === 'conditionalDamage') {
        if (!['attack', 'hit'].includes(rule.trigger)) throw new Error(`conditionalDamage ${piece.chessId} has unsupported trigger ${rule.trigger}`);
        battle.on('hit', ({ source, target, dmg }) => {
          if (source !== unit || target?.side !== 'enemy' || !dmg || dmg.type === 'element') return;
          const tag = p.targetTag;
          if (tag && !target.def?.tags?.includes(tag)) return;
          if (p.condition === 'boundOrSluggish' && !target.s.flags.bind && !target.findBuff('sluggish')) return;
          if (p.multiplier != null) dmg.amount *= Number(p.multiplier);
          else if (p.bonusPercent != null) applyDamageIncrease(battle, source, dmg, 1 + Number(p.bonusPercent));
        }, { owner: unit });
      } else if (rule.behavior === 'weakDamage') {
        if (!['attack', 'hit'].includes(rule.trigger)) throw new Error(`weakDamage ${piece.chessId} has unsupported trigger ${rule.trigger}`);
        battle.on('hit', ({ source, target, dmg }) => {
          if (source === unit && target?.side === 'enemy' && dmg && (dmg.type === 'phys' || dmg.type === 'arts')) dmg.type = weaknessType(source, target, dmg);
        }, { priority: WEAKNESS_PRIORITY, owner: unit });
      } else if (!['badgeThresholdStat', 'staticStats', 'deployWindowStats', 'startDerivedStats', 'badgeAmplifier', 'productionMultiplier','retiringEffect','deathrattleEcho','retirementMultiplier','warbandEvent'].includes(rule.behavior) && !TEMPORARY_BEHAVIORS.has(rule.behavior)) {
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
      // 叙拉古处决令: 攻击生命值低于40%的敌人时 (the target's HP when the hit lands)
      if (p.condition === 'targetHpBelow' && !(target.hp < Number(target.s.maxHp) * Number(p.hpRatio))) return;
      const multiplier = Number(p.multiplier);
      if (Number.isFinite(multiplier) && multiplier > 0) applyDamageIncrease(battle, source, dmg, multiplier);
      else if (p.bonusPercent != null) applyDamageIncrease(battle, source, dmg, 1 + Number(p.bonusPercent));
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
  if (behavior === 'disarmOnHit' || behavior === 'silenceOnHit' || behavior === 'slowOnHit') {
    const duration = Number(p.durationSeconds ?? 0);
    if (!(duration > 0)) throw new Error(`combatEquipment ${itemIdValue}:${behavior} has invalid duration`);
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
      // 战栗维式重锤 (gear v4): the same path with 战栗 instead of 无法普通攻击
      if (behavior === 'disarmOnHit') applyEquipmentStatus(battle, unit, target, p.status ?? 'disarm', { duration });
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
    let stacks = 0;
    const trigger = behavior === 'gainBattleStats' ? null : rule.trigger;
    let lastActivation = null;
    if (behavior === 'gainBattleStats') {
      const gained = Number(stateCounter(battle, piece, 'gainedThisPrep') ?? stateCounter(battle, piece, 'gained') ?? 0);
      const amount = gained * Number(p.attackSpeedPerGain ?? 0);
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
      stacks++;
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
      const amount = Number(p.base ?? 0) + shared * Number(p.perSharedFactionAlly ?? 0);
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
      if (source === unit && dmg && battle.time < until) applyDamageIncrease(battle, source, dmg, Number(p.multiplier ?? 1));
    }, { owner: unit });
    return;
  }
  if (behavior === 'lethalGuard') {
    battle.on('fatal', (ctx) => {
      if (ctx.unit !== unit) return;
      ctx.prevented = true;
      ctx.unit.hp = Math.max(Number(p.minimumHp ?? 1), ctx.unit.hp);
      if (Number(p.durationSeconds) > 0) battle.addBuff(unit, { key: `independent:lethalGuard:${itemIdValue}`, duration: Number(p.durationSeconds), flags: { invulnerable: true }, allowDead: true });
    }, { owner: unit });
    return;
  }
  if (behavior === 'deployFirstHitStatus') {
    // perDeploy (谢拉格冰爪, gear v4): how many of the first normal attacks after each deployment carry the status
    const perDeploy = Math.max(1, Math.floor(Number(p.perDeploy ?? 1)));
    let armed = 0;
    const pendingTargets = new Map();
    if (p.resetOnDeploy) battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) armed = perDeploy; }, { owner: unit });
    battle.on('beforeAttack', ({ attacker, targets: attackTargets, isSkill }) => {
      if (attacker !== unit || isSkill) return;
      pendingTargets.set(battle._attackSeq + 1, attackTargets?.[0]?.id ?? null);
    }, { owner: unit });
    battle.on('damaged', ({ source, target, amount, dmg }) => {
      const attackId = dmg?.attackId;
      if (source !== unit || !(amount > 0) || !target || !pendingTargets.has(attackId)) return;
      const mainTargetId = pendingTargets.get(attackId);
      pendingTargets.delete(attackId);
      if (armed <= 0 || target.id !== mainTargetId) return;
      applyEquipmentStatus(battle, unit, target, p.status, { duration: Number(p.durationSeconds ?? 0) });
      armed--;
    }, { owner: unit });
    return;
  }
  if (behavior === 'firstDamageStatus') {
    battle.on('damaged', ({ target, amount }) => {
      if (target !== unit || !(amount > 0)) return;
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
    battle.on('ammoUsed', ({ unit: actor, skill }) => {
      if (actor !== unit || !skill) return;
      const threshold = Number(p.thresholdRemaining ?? 1);
      if (Number(skill.ammoLeft ?? 0) > threshold) return;
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
      if (count < Number(p.counterEvery ?? 1)) return;
      count = 0;
      const shieldKey = `independent:countedHealShield:${unit.uid}:${itemIdValue}`;
      const current = target?.findBuff(shieldKey)?.shieldHits ?? 0;
      const charges = Math.max(0, Number(p.shieldCharges ?? 1));
      if (charges > 0) battle.addBuff(target, { key: shieldKey, shieldHits: current + charges, duration: Infinity, persist: true });
    }, { owner: unit });
    return;
  }
  if (behavior === 'singleRevive') {
    let restoring = false;
    battle.on('death', ({ unit: dead, reason }) => {
      if (dead !== unit || reason !== 'killed' || restoring) return;
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
    // gear v4 params: value (脆弱 / 法术脆弱 / 防御力降低 strength), radius (the main target and the enemies around it),
    // damageType (造成法术伤害时: every hit of that type, no counting)
    const duration = Number(p.durationSeconds ?? 0);
    const radius = Number(p.radius ?? 0);
    const apply = (target) => {
      const list = radius > 0 ? battle.enemies.filter((e) => liveEnemy(e) && tileDistance(e, target) <= radius) : [target];
      for (const t of list) gearStatus(battle, unit, t, p.status, duration, p.value, itemIdValue);
    };
    if (p.damageType) {
      battle.on('damaged', ({ source, target, amount, dmg }) => {
        if (source !== unit || target?.side !== 'enemy' || !(amount > 0) || !target.alive || dmg?.type !== p.damageType || isGearDamage(dmg)) return;
        apply(target);
      }, { owner: unit });
      return;
    }
    const tick = attackCounter(unit, p.counterEvery);
    const procTargets = new Map();
    battle.on('beforeAttack', ({ attacker, targets: attackTargets, isSkill }) => {
      if (attacker !== unit || isSkill || extraAttack(unit) || !tick()) return;
      if (attackTargets?.[0]) procTargets.set(battle._attackSeq + 1, attackTargets[0].id);
    }, { owner: unit });
    battle.on('damaged', ({ source, target, amount, dmg }) => {
      const attackId = dmg?.attackId;
      if (source !== unit || !(amount > 0) || dmg?.isSkill || isGearDamage(dmg) || !procTargets.has(attackId) || target?.id !== procTargets.get(attackId)) return;
      procTargets.delete(attackId);
      apply(target);
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
    // gear v4 (天马骑士长枪): works alone; worn with its partner the ratio becomes pairedRatio. Old rules (no
    // singleWorks) still need the partner.
    const paired = ownPair(p.partnerSourceId);
    if (!paired && !p.singleWorks) return;
    let ratio = Number(p.trueDamageAttackRatio ?? 0);
    if (paired && p.pairedRatio != null) ratio = Number(p.pairedRatio);
    else if (paired && p.pairedMultiplier != null) ratio *= Number(p.pairedMultiplier);
    if (p.singleWorks) {
      normalHits(battle, unit, (target) => { if (target.alive) battle.dealDamage(unit, target, { amount: unit.s.atk * ratio, type: 'true', tags: GEAR_TAGS }); });
      return;
    }
    battle.on('attack', ({ attacker, targets, isSkill }) => {
      if (attacker !== unit || isSkill) return;
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
      if (source === unit && dmg && multiplier !== 1) applyDamageIncrease(battle, source, dmg, multiplier);
    }, { owner: unit });
    return;
  }
  if (behavior === 'damageReductionAndRetaliation') {
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
      if (hasTag(p.requiresTag)) {
          let ratio = Number(p.retaliationAttackPercent ?? 0);
          const paired = p.pairedSourceId && ownPair(p.pairedSourceId);
          if (paired && p.pairedMultiplier != null) ratio *= Number(p.pairedMultiplier);
          if (ratio > 0) {
            // gear v4 pairing (裂潮重刃): the counter also splashes the enemies around the source
            const splash = paired && Number(p.pairedSplashRadius) > 0
              ? battle.enemies.filter((e) => e !== source && liveEnemy(e) && tileDistance(e, source) <= Number(p.pairedSplashRadius)) : [];
            for (const e of [source, ...splash]) battle.dealDamage(unit, e, { amount: unit.s.atk * ratio, type: 'arts', tags: ['independentEquipment'] });
          }
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
    battle.on('skillEnd', ({ unit: actor }) => {
      if (actor !== unit) return;
      if (Number(p.sp) > 0) unit.skill?.gainSp(Number(p.sp), 'independentEquipment');
    }, { owner: unit });
    if (ownPair(p.pairedSourceId) && Number(p.teamSpPerSkillStart) > 0) {
      battle.on('skillStart', ({ unit: actor }) => {
        if (actor.ownerId !== unit.ownerId) return;
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
      // gear v4: the enemies in the wearer's attack range (inRangeOnly), else every enemy (old rule)
      for (const enemy of battle.enemies) if (enemy.alive && enemy.deployed && (!p.inRangeOnly || withinRange(battle, unit, enemy))) battle.addBuff(enemy, { key: `independent:skillWindowSlow:${unit.uid}`, duration, refresh: 'replace', mods: { moveMul: Math.max(0, 1 - Number(p.slowPercent ?? 0)) } });
      if (paired && Number(p.pairedAttackPercent) > 0) battle.addBuff(unit, { key: `independent:pairedSkillAttack:${unit.uid}:${itemIdValue}`, duration, refresh: 'replace', mods: { atkPct: Number(p.pairedAttackPercent) }, allowDead: true });
    }, { owner: unit });
    // skillEndRedeploy (gear v4, worn with 卡西米尔竞技旗): when the skill ends the wearer withdraws and is at once deployed
    // again on its tile (【移动】: a new deployment, so 部署时 effects — the 竞技旗 charge — fire again)
    if (paired && p.pairedRedeployOnSkillEnd) {
      battle.on('skillEnd', ({ unit: actor, reason }) => {
        if (actor !== unit || reason === 'death' || !unit.alive || !unit.deployed) return;
        battle.after(0, () => { if (unit.alive && unit.deployed) battle.moveRedeploy(unit, unit.tileR, unit.tileC); }, { owner: unit });
      }, { owner: unit });
    }
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
      if (source !== unit || !unit.alive || !unit.deployed || !armed || !dmg || dmg.isSkill || isGearDamage(dmg)) return;
      if (p.damageBonus != null) applyDamageIncrease(battle, source, dmg, 1 + Number(p.damageBonus));
      // gear v4: the attack stuns its target instead of hitting harder
      if (Number(p.stunSeconds) > 0 && target?.side === 'enemy') applyEquipmentStatus(battle, unit, target, 'stun', { duration: Number(p.stunSeconds) });
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
  // ---- 特殊战斗装备 (user 2026-10-07: 「特殊战斗装备应该和数值区别开……把一些比较特别的做进去，例如对主目标进行弹射伤害或者
  // 溅射伤害，造成伤害时治疗周围随机友军，对敌人造成盟约脆弱效果，对友军造成盟约庇护效果」). They never pass in a 交接
  // (design extraGear inheritable: false). Damage they deal is tagged independentEquipment and starts nothing again.
  if (behavior === 'ricochet' || behavior === 'splash') {
    const ratio = Number(p.atkPercent ?? 0); const radius = Number(p.radius ?? 0);
    if (!(ratio > 0 && radius > 0)) throw new Error(`combatEquipment ${itemIdValue}:${behavior} needs atkPercent and radius`);
    const mains = mainTargetTracker(battle, unit);
    battle.on('damaged', ({ source, target, amount, dmg }) => {
      if (source !== unit || target?.side !== 'enemy' || !(amount > 0) || !mains.take(dmg, target)) return;
      // gear v4 (萨尔贡链雷护符): 法术普通攻击 only
      if (p.normalOnly && dmg.isSkill) return;
      if (p.damageType && dmg.type !== p.damageType) return;
      const type = dmg.type === 'arts' ? 'arts' : dmg.type === 'true' ? 'true' : 'phys';
      const live = (e) => e.alive && e.deployed !== false && !e.removed;
      if (behavior === 'splash') {
        for (const e of battle.enemies) if (e !== target && live(e) && tileDistance(e, target) <= radius) battle.dealDamage(unit, e, { amount: unit.s.atk * ratio, type, tags: ['independentEquipment'] });
        return;
      }
      // 弹射: to the nearest enemy not yet hit by this attack, within the radius of the one before
      const hit = new Set([target]); let from = target;
      while (true) {
        let next = null;
        for (const e of battle.enemies) if (!hit.has(e) && live(e) && tileDistance(e, from) <= radius && (!next || tileDistance(e, from) < tileDistance(next, from))) next = e;
        if (!next) break;
        battle.dealDamage(unit, next, { amount: unit.s.atk * ratio, type, tags: ['independentEquipment'] });
        hit.add(next); from = next;
      }
    }, { owner: unit });
    return;
  }
  if (behavior === 'healAllyOnDamage') {
    const ratio = Number(p.damagePercent ?? 0); const radius = Number(p.radius ?? 0);
    if (!(ratio > 0 && radius > 0)) throw new Error(`combatEquipment ${itemIdValue}:healAllyOnDamage needs damagePercent and radius`);
    battle.on('damaged', ({ source, target, amount, dmg }) => {
      if (source !== unit || target?.side !== 'enemy' || !(amount > 0) || dmg?.tags?.includes('independentEquipment')) return;
      // a random hurt ally around the wearer (not the wearer itself)
      const hurt = battle.allyUnits.filter((a) => a !== unit && a.alive && a.deployed && a.kind !== 'device' && a.hp < a.s.maxHp && tileDistance(a, unit) <= radius);
      if (!hurt.length) return;
      // targets (gear v4 param): that many different hurt allies, each healed the share
      for (let n = Math.max(1, Math.floor(Number(p.targets ?? 1))); n > 0 && hurt.length; n--) {
        const pick = hurt.splice(Math.floor(battle.rng() * hurt.length), 1)[0];
        battle.heal(unit, pick, amount * ratio, { tags: ['independentEquipment'] });
      }
    }, { owner: unit });
    return;
  }
  if (behavior === 'factionVulnerable') {
    const pct = Number(p.damagePercent ?? 0); const duration = Number(p.durationSeconds ?? 0);
    if (!(pct > 0 && duration > 0)) throw new Error(`combatEquipment ${itemIdValue}:factionVulnerable needs damagePercent and durationSeconds`);
    const reg = factionGear(battle);
    const keys = wearerKeys(battle, unit);
    for (const key of keys) reg.vulnerable.set(key, Math.max(reg.vulnerable.get(key) ?? 0, pct));
    battle.on('damaged', ({ source, target, amount }) => {
      if (source !== unit || target?.side !== 'enemy' || !(amount > 0) || !target.alive) return;
      for (const key of keys) battle.addBuff(target, { key: `independent:factionVulnerable:${key}`, source: unit, duration, refresh: 'replace' });
    }, { owner: unit });
    return;
  }
  if (behavior === 'factionGuard') {
    const pct = Number(p.damageReduction ?? 0);
    if (!(pct > 0 && pct < 1)) throw new Error(`combatEquipment ${itemIdValue}:factionGuard needs 0 < damageReduction < 1`);
    factionGear(battle).guards.push({ unit, pct, keys: wearerKeys(battle, unit) });
    return;
  }
  if (installGearV4Rule(battle, catalog, unit, piece, behavior, p, entries, itemIdValue, { ownPair, hasTag })) return;
  throw new Error(`unimplemented independent combatEquipment behavior ${behavior} (${itemIdValue})`);
}

/**
 * 特殊战斗装备 第四版 (2026-10-07; user: 「做就做呗」): the new behaviors. Returns false for a behavior it does not know.
 * Damage they deal is tagged independentEquipment, so no other piece starts again from it.
 */
function installGearV4Rule(battle, catalog, unit, piece, behavior, p, entries, itemIdValue, { ownPair, hasTag }) {
  const gearHit = (target, amount, type) => battle.dealDamage(unit, target, { amount, type, tags: GEAR_TAGS });
  const sameType = (dmg) => (dmg?.type === 'arts' ? 'arts' : dmg?.type === 'true' ? 'true' : 'phys');
  // the damage a normal attack's hit carried before the target's own defences: what 穿透 / 处置预案 deal again
  const rawOf = (dmg) => Number(dmg?.amount ?? 0) * Number(dmg?.atkScale ?? 1) * Number(dmg?.mul ?? 1);
  switch (behavior) {
    case 'elementOnHit': {
      // 元素损伤 on the main target of each normal attack (atkPercent of ATK), or on every hit of damageType
      // (damagePercent of that hit: 灼燃维式重锤 — 造成法术伤害时); gear damage never starts it again
      if (!GEAR_ELEMENTS.has(p.element)) throw new Error(`combatEquipment ${itemIdValue}: elementOnHit has unknown element ${p.element}`);
      if (p.damageType) {
        const share = Number(p.damagePercent);
        if (!(share > 0)) throw new Error(`combatEquipment ${itemIdValue}: elementOnHit needs damagePercent`);
        battle.on('damaged', ({ source, target, amount, dmg }) => {
          if (source !== unit || target?.side !== 'enemy' || !(amount > 0) || !target.alive || dmg?.type !== p.damageType || isGearDamage(dmg)) return;
          battle.dealDamage(unit, target, { type: 'element', element: p.element, amount: amount * share, tags: GEAR_TAGS });
        }, { owner: unit });
        return true;
      }
      const ratio = Number(p.atkPercent);
      if (!(ratio > 0)) throw new Error(`combatEquipment ${itemIdValue}: elementOnHit needs atkPercent`);
      normalHits(battle, unit, (target) => { if (target.alive) battle.dealDamage(unit, target, { type: 'element', element: p.element, amount: unit.s.atk * ratio, tags: GEAR_TAGS }); });
      return true;
    }
    case 'knockbackOnHit': {
      // 击退 the main target of every normal attack with 力度 `force` (0 小力, 1 中力).
      normalHits(battle, unit, (target) => {
        if (!target.alive) return;
        battle.push(target, Number(p.force ?? 1), { from: unit });
      });
      return true;
    }
    case 'pullOnHit': {
      // every Nth normal attack pulls its main target to the wearer (拉向携带者, 力度 `force`)
      const tick = attackCounter(unit, p.counterEvery);
      const marked = new Set();
      battle.on('beforeAttack', ({ attacker, isSkill }) => {
        if (attacker === unit && !isSkill && !extraAttack(unit) && tick()) marked.add(battle._attackSeq + 1);
      }, { owner: unit });
      normalHits(battle, unit, (target, dmg) => {
        if (!marked.delete(dmg.attackId) || !target.alive) return;
        battle.pullToFront(target, unit, Number(p.force ?? 0));
      });
      return true;
    }
    case 'pierce': {
      // 穿透: the enemies behind the main target on the line from the wearer through it, up to `depth` tiles further
      const depth = Number(p.depth ?? 1);
      normalHits(battle, unit, (target, dmg) => {
        const dx = target.x - unit.x, dy = target.y - unit.y, len = hypot(dx, dy);
        if (!(len > 1e-6)) return;
        const ux = dx / len, uy = dy / len;
        const amount = rawOf(dmg);
        for (const e of battle.enemies) {
          if (e === target || !liveEnemy(e)) continue;
          const along = (e.x - target.x) * ux + (e.y - target.y) * uy;
          const side = Math.abs((e.x - target.x) * uy - (e.y - target.y) * ux);
          if (along > 1e-6 && along <= depth + 0.5 && side <= 0.5) gearHit(e, amount, sameType(dmg));
        }
      });
      return true;
    }
    case 'doubleStrike': {
      // 连射: every Nth normal attack is made twice at once (the second counts for nothing)
      const tick = attackCounter(unit, p.counterEvery);
      battle.on('attack', ({ attacker, targets, isSkill }) => {
        if (attacker !== unit || isSkill || extraAttack(unit) || !tick()) return;
        const again = (targets || []).filter((t) => t?.alive && t.side === 'enemy');
        if (!again.length || !unit.alive) return;
        unit.mem.independentExtraAttack = true;
        try { battle.forceAttack(unit, again, { noAmmo: true }); } finally { unit.mem.independentExtraAttack = false; }
      }, { owner: unit });
      return true;
    }
    case 'extraTargets': {
      // 普通攻击同时攻击范围内N名敌人: a single-target normal attack takes the next enemies in range too
      const n = Math.max(1, Math.floor(Number(p.targets ?? 2)));
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit || ctx.isSkill || !ctx.targets?.length || ctx.targets.length >= n || ctx.targets.some((t) => t.side !== 'enemy')) return;
        const more = enemiesInRange(battle, unit).filter((e) => !ctx.targets.includes(e))
          .sort((a, b) => tileDistance(a, unit) - tileDistance(b, unit) || a.id - b.id);
        ctx.targets = [...ctx.targets, ...more.slice(0, n - ctx.targets.length)];
      }, { owner: unit, priority: 100 });
      return true;
    }
    case 'targetPriority': {
      // 普通攻击优先攻击范围内生命值最低的敌人 (the blocked enemies count as in range, as for any attack)
      if (p.priority !== 'lowestHp') throw new Error(`combatEquipment ${itemIdValue}: unknown targetPriority ${p.priority}`);
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit || ctx.isSkill || ctx.targets?.length !== 1 || ctx.targets[0].side !== 'enemy') return;
        const pool = [...new Set([...enemiesInRange(battle, unit), ...battle.blockedTargets(unit, ctx.profile)])];
        const lowest = pool.sort((a, b) => a.hp - b.hp || a.id - b.id)[0];
        if (lowest && lowest !== ctx.targets[0]) ctx.targets = [lowest];
      }, { owner: unit, priority: 110 });
      return true;
    }
    case 'skillStartStrike': {
      // 每次开启技能时，对攻击范围内所有敌人造成伤害
      const ratio = Number(p.atkPercent);
      battle.on('skillStart', ({ unit: who }) => {
        if (who !== unit) return;
        for (const e of enemiesInRange(battle, unit)) gearHit(e, unit.s.atk * ratio, p.type ?? 'phys');
      }, { owner: unit });
      return true;
    }
    case 'skillStartTeamStrike': {
      // 炎国天师古鼎: each skill of the wearer makes the next normal attack of every other operator of the faction on the
      // field hit every enemy in its range for ratio × its own ATK (paired with 炎国制式短刀: pairedAtkPercent)
      if (!hasTag(p.requiresTag)) return true;
      const ratio = Number(ownPair(p.pairedSourceId) ? p.pairedAtkPercent ?? p.atkPercent : p.atkPercent);
      const reg = teamStrike(battle);
      battle.on('skillStart', ({ unit: who }) => {
        if (who !== unit) return;
        for (const ally of battle.allyUnits) {
          if (ally === unit || ally.kind !== 'op' || ally.ownerId !== unit.ownerId || !ally.alive || !ally.deployed) continue;
          if (!tavernFactions(piecesFor(battle, ally.uid), catalog).includes(p.requiresTag)) continue;
          reg.pending.set(ally, Math.max(reg.pending.get(ally) ?? 0, ratio));
        }
      }, { owner: unit });
      return true;
    }
    case 'stealthOnDeploy': {
      // 每次部署时获得隐匿，首次普通攻击后解除 (its own buff: a talent's 隐匿 stays)
      const key = `independent:gearStealth:${itemIdValue}`;
      battle.on('deploy', ({ unit: who }) => {
        if (who === unit) battle.addBuff(unit, { key, status: 'stealth', flags: { stealth: true }, duration: Infinity, refresh: 'replace', source: unit });
      }, { owner: unit });
      battle.on('attack', ({ attacker, isSkill }) => {
        if (attacker === unit && !isSkill && unit.findBuff(key)) battle.removeBuff(unit, key);
      }, { owner: unit, priority: -10 });
      return true;
    }
    case 'attractOnDeploy': {
      // 每次部署时，诱导攻击范围内的敌人向携带者靠拢
      const duration = Number(p.durationSeconds ?? 2);
      battle.on('deploy', ({ unit: who }) => {
        if (who !== unit) return;
        for (const e of enemiesInRange(battle, unit)) applyEquipmentStatus(battle, unit, e, 'attract', { duration, point: { x: unit.x, y: unit.y } });
      }, { owner: unit });
      return true;
    }
    case 'deployStrike': {
      // 每次部署时冲锋：对攻击范围内所有敌人造成伤害
      const ratio = Number(p.atkPercent);
      battle.on('deploy', ({ unit: who }) => {
        if (who !== unit) return;
        battle.refreshRange?.(unit);
        for (const e of enemiesInRange(battle, unit)) gearHit(e, unit.s.atk * ratio, p.type ?? 'phys');
      }, { owner: unit });
      return true;
    }
    case 'deviceOnDown': {
      // 被击倒时，在原位置放下一个装置（阻挡1名敌人，生命值为携带者最大生命值的一定比例），直到携带者再部署
      let device = null;
      const clear = () => { if (device?.alive) battle.retreat(device, { reason: 'expired', permanent: true }); device = null; };
      battle.on('death', ({ unit: who, reason }) => {
        if (who !== unit || reason !== 'killed' || !battle.isDown(unit)) return;
        const [r, c] = unit.body ?? [unit.tileR, unit.tileC];
        device = battle.spawnDevice('independent_gear_device', r, c, {
          hp: Math.max(1, unit.s.maxHp * Number(p.maxHpPercent ?? 0.5)), blockCnt: Number(p.blockCnt ?? 1), name: '装置', overBody: unit, dir: unit.dir,
        });
        if (device) device.ownerId = unit.ownerId;
      }, { owner: unit });
      // gone before the wearer comes back, so its own redeploy is never held up by it
      battle.on('tick', () => { if (device && (unit.alive || !battle.isDown(unit) || battle.time + 1e-9 >= unit.respawnAt)) clear(); }, { owner: unit });
      return true;
    }
    case 'summonOnDeploy': {
      // 每次实际部署均提出召唤请求；没有可接敌位置时保留请求，直到敌人进入合法目标范围。
      battle.on('deploy', ({ unit: who }) => {
        if (who !== unit) return;
        const seq = unit.deploySeq;
        let made = 0;
        const id=p.tokenId ?? 'token_10015_dusk_drgn';
        const def=battle.tokenDef(id,unit)||{id,name:'召唤物',position:'MELEE',rangeGrid:[[0,0]],stats:{atk:unit.s.atk,maxHp:unit.s.maxHp,blockCnt:Number(p.blockCnt??1)}};
        const ratio = Number(p.statRatio ?? 0.5);
        def.stats={...def.stats,atk:unit.s.atk*ratio,maxHp:Math.max(1,unit.s.maxHp*ratio),blockCnt:Number(p.blockCnt??1)};
        const deploy = () => {
          if (!unit.alive || !unit.deployed || unit.deploySeq !== seq) return true;
          while(made<Number(p.count??1)) {
          const cell=findSummonTile(battle,unit,'near',{allBoard:true,melee:def.position!=='RANGED',canUseTile:(r,c)=>tokenCanEngageAt(battle,unit,def,r,c)});
          if(!cell)break;
          const token = battle.spawnToken(unit, id, cell[0], cell[1], {
            anySource: true, kit: { skill: null },
            def,
          });
          if (token) made++; else break;
          }
          return made >= Number(p.count ?? 1);
        };
        if(!deploy())battle.every(0.1,deploy,{owner:unit});
      }, { owner: unit });
      return true;
    }
    case 'spChargeMode': {
      // 技能也能靠攻击回复技力：每次普通攻击额外回复技力
      const sp = Number(p.onAttack ?? 1);
      battle.on('attack', ({ attacker, isSkill }) => {
        if (attacker !== unit || isSkill || extraAttack(unit)) return;
        const sk = unit.skill;
        if (!sk || sk.noSkill || sk.kind === 'passive' || (sk.active && sk.isTimed)) return;
        sk.gainSp(sp, 'independentEquipment');
      }, { owner: unit });
      return true;
    }
    case 'skillRecast': {
      // 萨尔贡黄沙罗盘: the declared skill recast remains source-bound; each started skill also gives paired allies SP.
      if (!hasTag(p.requiresTag)) return true;
      let left = Number(p.recasts ?? 1);
      battle.on('skillEnd', ({ unit: who, reason }) => {
        if (who !== unit || left <= 0 || reason === 'death' || !unit.alive || !unit.deployed) return;
        left--;
        battle.after(0, () => { if (unit.alive && unit.deployed && !unit.skill?.active) unit.skill?.activate('independentEquipment', { free: true }); }, { owner: unit });
      }, { owner: unit });
      if (ownPair(p.pairedSourceId) && Number(p.teamSpPerSkillStart) > 0) {
        battle.on('skillStart', ({ unit: who }) => {
          if (who !== unit) return;
          for (const ally of battle.allyUnits) {
            if (ally === unit || ally.kind !== 'op' || ally.ownerId !== unit.ownerId || !ally.alive || !ally.deployed) continue;
            if (tavernFactions(piecesFor(battle, ally.uid), catalog).includes(p.requiresTag)) ally.skill?.gainSp(Number(p.teamSpPerSkillStart), 'independentEquipment');
          }
        }, { owner: unit });
      }
      return true;
    }
    case 'skillStartShield': {
      // 每次开启技能时获得护盾（装备护盾，至多2层）; paired with 天马骑士长枪: when the shield is broken, true damage to
      // the enemies around the wearer
      const key = `independent:equipmentShield:${unit.uid}`;
      let last = 0;
      battle.on('skillStart', ({ unit: who }) => {
        if (who !== unit) return;
        grantShieldLayers(battle, unit, Number(p.charges ?? 1));
        last = Number(unit.findBuff(key)?.shieldHits ?? 0);
      }, { owner: unit });
      if (ownPair(p.pairedSourceId)) {
        battle.on('tick', () => {
          const now = unit.alive && unit.deployed ? Number(unit.findBuff(key)?.shieldHits ?? 0) : 0;
          if (last > 0 && now === 0 && unit.alive && unit.deployed) {
            const radius = Number(p.radius ?? 1) + 0.5;
            for (const e of battle.enemies) if (liveEnemy(e) && tileDistance(e, unit) <= radius) gearHit(e, unit.s.atk * Number(p.breakBurstAtkPercent ?? 1), 'true');
          }
          last = now;
        }, { owner: unit });
      }
      return true;
    }
    case 'countedExtraShot': {
      // 拉特兰铳骑组件: every Nth normal attack fires one more shot at another enemy in range (the main target when it is
      // alone) for ratio × ATK; worn with 拉特兰跳弹模块 that shot bounces like the 跳弹模块's
      if (!hasTag(p.requiresTag)) return true;
      const tick = attackCounter(unit, p.counterEvery);
      const bounce = ownPair(p.pairedSourceId)
        ? entries.find((e) => e.sourceId === p.pairedSourceId)?.rec?.params?.effects?.find((x) => x.behavior === 'ricochet')?.params ?? null : null;
      battle.on('attack', ({ attacker, targets, isSkill }) => {
        if (attacker !== unit || isSkill || extraAttack(unit) || !tick()) return;
        const main = (targets || [])[0];
        const others = enemiesInRange(battle, unit).filter((e) => e !== main).sort((a, b) => tileDistance(a, unit) - tileDistance(b, unit) || a.id - b.id);
        const shot = others[0] ?? (main && liveEnemy(main) ? main : null);
        if (!shot) return;
        const type = p.type ?? 'phys';
        gearHit(shot, unit.s.atk * Number(p.atkPercent ?? 1), type);
        if (bounce) {
          const hit = new Set([shot]); let from = shot;
          while (true) {
            let next = null;
            for (const e of battle.enemies) if (!hit.has(e) && liveEnemy(e) && tileDistance(e, from) <= Number(bounce.radius ?? 2) && (!next || tileDistance(e, from) < tileDistance(next, from))) next = e;
            if (!next) break;
            gearHit(next, unit.s.atk * Number(bounce.atkPercent ?? 0.5), type);
            hit.add(next); from = next;
          }
        }
      }, { owner: unit });
      return true;
    }
    case 'counterAccelerator':
      // 工程部节拍校准器: read by every counter of the wearer (installEquipmentMechanisms sets the step first)
      return true;
    case 'controlledSplash': {
      // 罗德岛处置预案: a normal attack on a 晕眩 / 束缚 / 冻结 / 浮空 enemy hits the other enemies around it the same
      const radius = Number(p.radius ?? 1.5);
      const controlled = (e) => { const f = e.s.flags; return !!(f.stun || f.bind || f.freeze || f.levitate); };
      normalHits(battle, unit, (target, dmg) => {
        if (!controlled(target)) return;
        const amount = rawOf(dmg);
        for (const e of battle.enemies) if (e !== target && liveEnemy(e) && tileDistance(e, target) <= radius) gearHit(e, amount, sameType(dmg));
      });
      return true;
    }
    case 'blockedAttackerStatus': {
      // 罗德岛重装防护套件: an enemy the wearer blocks that hits it may be stunned
      const chance = Number(p.chance ?? 0);
      battle.on('damaged', ({ source, target, amount }) => {
        if (target !== unit || source?.side !== 'enemy' || !(amount > 0) || source.blockedBy !== unit || !source.alive) return;
        if (battle.rng() < chance) applyEquipmentStatus(battle, unit, source, p.status ?? 'stun', { duration: Number(p.durationSeconds ?? 1) });
      }, { owner: unit });
      return true;
    }
    case 'killSpGain': {
      // 精英干员战备箱: 击倒敌人时回复技力
      battle.on('kill', ({ killer, victim }) => {
        if (killer === unit && victim?.side === 'enemy' && unit.alive) unit.skill?.gainSp(Number(p.sp ?? 1), 'independentEquipment');
      }, { owner: unit });
      return true;
    }
    default:
      return false;
  }
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
      // gear v4: one form — the chosen hammer is 强化 (its params' `steam` overrides); an old save that chose more keeps
      // the first ones it may
      const maxSelected = Number(steamEffect.params?.choose ?? steamEffect.params?.chooseVariantsOnEquip?.normal ?? 0);
      if (!Array.isArray(selected)) throw new Error(`steamGearUpgrade ${steam.id} has invalid hammerSourceIds selection`);
      for (const sourceId of selected.slice(0, maxSelected)) {
        const target = ownedEntries.find((e) => e.sourceId === sourceId);
        if (!target || !(steamEffect.params.sourceIds ?? []).includes(sourceId)) throw new Error(`steamGearUpgrade ${steam.id} selects an unavailable hammer ${sourceId}`);
        target.steamBoost = true;
      }
    }
    // 工程部节拍校准器: every 「每发动N次普通攻击」 counter of the wearer advances this much per normal attack
    unit.mem.independentCountStep = Math.max(1, ...ownedEntries.filter((e) => e.kind === 'equipment' && e.rec.mechanism === 'combatEquipment')
      .flatMap((e) => (e.rec.params?.effects ?? []).filter((x) => x.behavior === 'counterAccelerator').map((x) => Number(x.params?.countPerAttack) || 1)));
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
        case 'inheritancePermit':
        case 'prepEndForge':
        case 'escalatingForge':
        case 'saleThresholdRecruit':
        case 'stats':
        case 'keywordGear':
          break;
        case 'equipmentShield': {
          break;
        }
        case 'healingCapacitor': {
          const ratio = Number(p.thresholdMaxHpRatio);
          const damageRatio = Number(p.damageRatio);
          if (!(ratio > 0 && damageRatio > 0) || p.damageType !== 'arts') throw new Error(`healingCapacitor ${e.id} has invalid params`);
          const key = `independentCapacitor:${unit.uid}`;
          unit.mem[key] = { stored: 0 };
          battle.on('heal', (ctx) => {
            if (ctx.target !== unit || !ctx.source || ctx.source === unit || ctx.source.side !== 'ally') return;
            if (ctx.opts?.self || ctx.opts?.independentOrigin) return;
            const effective = Math.max(0, Math.min(Number(ctx.amount) || 0, unit.s.maxHp - unit.hp));
            if (!effective) return;
            const s = unit.mem[key];
            s.stored += effective;
            const threshold = unit.s.maxHp * ratio;
            if (s.stored < threshold) return;
            s.stored -= threshold;
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
          for (const raw of p.effects) {
            let effect = selectVariant(raw, GEAR_ELITE);
            // 维多利亚蒸汽之心 强化: the chosen hammer's `steam` params replace its own
            if (effect.params?.steam) {
              const { steam, ...own } = effect.params;
              effect = { ...effect, params: e.steamBoost ? { ...own, ...steam } : own };
            }
            installEquipmentCombatRule(battle, catalog, unit, piece, effect, ownedEntries, emit, e.sourceId ?? e.id);
          }
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
  installKeywordGear(battle, { catalog, pieces });
}

function installEvents(battle, catalog, pieces, emit, state) {
  installNativeCombat(battle, catalog, pieces, emit);
  installEquipmentMechanisms(battle, catalog, pieces, emit);
  installWarband(battle,{catalog,pieces});
  installDarkmoonCombat(battle,{catalog,pieces,state});
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
  // the team's game-long badge boosts (native badgeBoost → state.playerEffects): +percent per listed badge
  const boosts = entryArray(state?.playerEffects).filter((fx) => fx?.type === 'badgeBoost' && Number(fx.percent) > 0);
  battle.independentBadgeBoost = (id) => 1 + boosts.reduce((n, fx) => n + ((fx.badgeIds || []).includes(id) ? Number(fx.percent) : 0), 0);
  // a production doubler that fights this battle: the strongest one counts (they do not stack)
  const fielded = new Set(battle.allyUnits.filter((u) => u.kind === 'op').map((u) => u.uid));
  battle.independentProductionFactor = 1 + Math.max(0, ...pieces.filter((p) => fielded.has(p.uid))
    .flatMap((p) => rulesOf(catalog, p.chessId).filter((r) => r.behavior === 'productionMultiplier').map((r) => Number(r.params?.extra) || 0)));
  const emit = createRewardEmitter(battle);
  installEvents(battle, catalog, pieces, emit, state);
}
