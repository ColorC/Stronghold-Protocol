import { weaknessType, WEAKNESS_PRIORITY } from '../garrisons/battle.js';
import { frontOf } from '../../dir.js';

const BEHAVIORS = new Set([
  'badgeThresholdStat', 'staticStats', 'conditionalDamage', 'weakDamage', 'eventProduction',
  'deployWindowStats', 'startDerivedStats',
]);
const ATTACHMENT_IDS = new Set(['quartermasterStock', 'ammoRecovery', 'coldRecord', 'medicalReadiness']);
const STAT_MODS = Object.freeze({
  attackFlat: 'atkFlat', attackPercent: 'atkPct', attackSpeedFlat: 'aspd',
  maxHpFlat: 'hpFlat', maxHpPercent: 'hpPct', defenseFlat: 'defFlat', defensePercent: 'defPct',
  resistanceFlat: 'resFlat', spRecoveryPerSec: 'spRecoveryFlat', hpRegenPerSec: 'hpRegen',
  redeployPercent: 'redeployMul', damageDealtPercent: 'dmgDealtMul',
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
    if ([rec?.id, rec?.sourceId, rec?.canonicalId, rec?.chessId].includes(key)) return { ...rec, id: rec.id ?? rec.canonicalId ?? rec.sourceId ?? key };
  }
  return null;
}

function itemId(entry) {
  return entry && typeof entry === 'object' ? entry.id ?? entry.sourceId ?? entry.canonicalId : entry;
}

function entryArray(value) { return Array.isArray(value) ? value : []; }

function equipmentFor(piece, catalog) {
  const out = [];
  for (const item of entryArray(piece.equipment)) {
    const id = itemId(item);
    const badge = recordLookup(catalog.badges, id);
    const gear = badge ? null : recordLookup(catalog.equipment, id);
    if (!badge && (!gear || gear.available === false)) throw new Error(`unknown independent equipment ${id} on piece ${piece.uid}`);
    out.push({ item, id: badge?.id ?? gear?.id ?? id, rec: badge ?? gear, kind: badge ? 'badge' : 'equipment' });
  }
  return out;
}

function countBadges(entries) {
  const out = new Map();
  for (const e of entries) if (e.kind === 'badge') out.set(e.rec.id, (out.get(e.rec.id) || 0) + Math.max(1, Number(e.item.quantity) || 1));
  return out;
}

function modFromStat(stat, value) {
  const key = STAT_MODS[stat];
  if (!key || !Number.isFinite(Number(value))) throw new Error(`unsupported independent battle stat ${stat}`);
  const n = Number(value);
  return key.endsWith('Mul') ? { [key]: Math.max(0, 1 + n) } : { [key]: n };
}

function mergeMods(into, mods, multiplier = 1) {
  for (const [k, v] of Object.entries(mods)) {
    if (k.endsWith('Mul')) into[k] = (into[k] ?? 1) * Math.pow(v, multiplier);
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
          && (!Array.isArray(p.stats) || p.stats.includes(rec.stat));
        if (!applicable) return 1;
        const scale = Number(p.multiplier);
        if (!(scale > 0)) throw new Error(`badge amplifier ${e.id} lacks a positive multiplier`);
        return scale;
      });
    const scale = factors.reduce((a, b) => a * b, 1);
    mergeMods(mods, stat, n * scale);
  }
  for (const e of entries) {
    if (e.kind !== 'equipment' || e.rec.mechanism) continue;
    if (e.rec.stat && e.rec.value != null) mergeMods(mods, modFromStat(e.rec.stat, e.rec.value), Math.max(1, Number(e.item.quantity) || 1));
    for (const [stat, value] of Object.entries(e.rec.stats ?? {})) mergeMods(mods, modFromStat(stat, value), Math.max(1, Number(e.item.quantity) || 1));
  }
  return { mods, counts };
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
        if (Number.isFinite(Number(p.attackSpeedFlatPerStack))) mods.aspd = stacks * Number(p.attackSpeedFlatPerStack);
        if (Number.isFinite(Number(p.redeployReductionPercentPerStack))) {
          const reduction = Math.min(Number(p.maxRedeployReduction ?? 0.3), stacks * Number(p.redeployReductionPercentPerStack));
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

function ownerUnit(battle, uid) { return battle.allyUnits.find((u) => u.kind === 'op' && u.uid === uid) ?? null; }

function withinRange(battle, from, target) {
  if (!from || !target) return false;
  const key = Math.round(target.y) * 21 + Math.round(target.x);
  return from.rangeKeySet?.has(key) ?? (from.rangeKeys || []).includes(key);
}

function getActor(event, trigger) {
  if (trigger === 'skillStart' || trigger === 'deploy' || trigger === 'ammoUsed') return event.unit ?? null;
  if (trigger === 'kill') return event.killer ?? null;
  if (trigger === 'death') return event.unit ?? null;
  if (trigger === 'statusApplied') return event.source ?? null;
  if (trigger === 'attack') return event.attacker ?? null;
  return null;
}

function filterMatches(battle, rule, event, actor, owner) {
  const f = rule.params?.filter ?? {};
  if (f.actor === 'self' && actor !== owner) return false;
  if (f.actor === 'team' && actor?.ownerId !== owner.ownerId) return false;
  if (f.actor === 'adjacentAllies' && (actor?.ownerId !== owner.ownerId || actor === owner || Math.abs(actor.tileR - owner.tileR) + Math.abs(actor.tileC - owner.tileC) !== 1)) return false;
  if (f.actor === 'target' && event.target !== owner) return false;
  const target = event.victim ?? event.target ?? null;
  if (f.targetSide && target?.side !== f.targetSide) return false;
  if (f.targetKind && target?.kind !== f.targetKind) return false;
  if (f.targetTag && !(target?.def?.tags || []).includes(f.targetTag)) return false;
  if (f.status && event.status !== f.status) return false;
  if (f.entered && !event.entered) return false;
  if ((f.nativeSource || f.nativeOnly) && (event.source?.mem?.independentOrigin || event.opts?.independentOrigin) != null) return false;
  if (f.range === 'attacker' && !withinRange(battle, owner, target)) return false;
  if (Number(f.sameRowCount) > 0) {
    const n = battle.allyUnits.filter((u) => u.kind === 'op' && u.ownerId === owner.ownerId && u.homeR === owner.homeR && !u.removed).length;
    if (n < Number(f.sameRowCount)) return false;
  }
  return true;
}

function createRewardEmitter(battle) {
  const rewards = [];
  const used = new Map();
  const emit = ({ id, quantity, origin, sourceUid, cap = null }) => {
    if (!id || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0) throw new Error(`invalid independent battle reward ${id}`);
    const key = `${origin}:${sourceUid}:${id}`;
    const current = used.get(key) ?? 0;
    const allowed = cap == null ? Number(quantity) : Math.max(0, Math.min(Number(quantity), Number(cap) - current));
    if (allowed <= 0) return 0;
    const merged = rewards.find((r) => r.id === id && r.origin === origin && r.sourceUid === sourceUid);
    if (merged) merged.quantity += allowed;
    else rewards.push({ id, quantity: allowed, origin, sourceUid });
    used.set(key, current + allowed);
    return allowed;
  };
  battle.independentRewards = rewards;
  return emit;
}

function installProductionRule(battle, owner, rule, origin, sourceId, emit) {
  const p = rule.params ?? {};
  const trigger = p.counterEvent ?? rule.trigger;
  const every = Number(p.counterEvery ?? 1);
  if (!(every > 0) || !Array.isArray(p.outputs) || p.outputs.length === 0) throw new Error(`eventProduction ${owner.defId}:${sourceId} has invalid threshold/outputs`);
  const countKey = `independentCounter:${origin}:${sourceId}:${rule.trigger}`;
  owner.mem.independentState.counters[countKey] = Number(owner.mem.independentState.counters[countKey]) || 0;
  const listener = (event) => {
    const actor = getActor(event, trigger);
    if (!filterMatches(battle, { ...rule, params: p }, event, actor, owner)) return;
    if (trigger === 'attack' && event.isSkill) return;
    const delta = trigger === 'ammoUsed' ? Number(event.amount ?? event.consumed ?? 1) : 1;
    if (!(delta > 0)) return;
    owner.mem.independentState.counters[countKey] += delta;
    const batches = Math.floor(owner.mem.independentState.counters[countKey] / every);
    if (!batches) return;
    owner.mem.independentState.counters[countKey] -= batches * every;
    for (const output of p.outputs) {
      const quantity = Number(output.quantity ?? output.perEvent ?? 1) * batches;
      emit({ id: output.id, quantity, origin, sourceUid: owner.uid, cap: p.maxPerBattle });
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
    unit.mem.independentState = { counters: {}, active: true };
    const entries = equipmentFor(piece, catalog);
    const stats = sumBadgeMods(catalog, entries);
    const startMods = traitsOnBattleStart(unit, catalog, piece, entries);
    const baseMods = { ...stats.mods };
    mergeMods(baseMods, startMods);
    if (Object.keys(baseMods).length) battle.addBuff(unit, { key: `independent:equipment:${unit.uid}`, mods: baseMods, persist: true, allowDead: true });
    installDerivedNativeRules(battle, unit, piece, catalog, entries);
    for (const rule of rules) {
      const p = rule.params ?? {};
      if (rule.behavior === 'eventProduction') installProductionRule(battle, unit, rule, 'native', rule.behavior, emit);
      else if (rule.behavior === 'conditionalDamage') {
        if (rule.trigger !== 'hit') throw new Error(`conditionalDamage ${piece.chessId} requires hit trigger`);
        battle.on('hit', ({ source, target, dmg }) => {
          if (source !== unit || target?.side !== 'enemy' || !dmg || dmg.type === 'element') return;
          const tag = p.targetTag;
          if (tag && !target.def?.tags?.includes(tag)) return;
          if (p.condition === 'boundOrSluggish' && !target.s.flags.bind && !target.findBuff('sluggish')) return;
          if (p.multiplier != null) dmg.amount *= Number(p.multiplier);
          else if (p.bonusPercent != null) dmg.mul *= 1 + Number(p.bonusPercent);
        }, { owner: unit });
      } else if (rule.behavior === 'weakDamage') {
        if (rule.trigger !== 'hit') throw new Error(`weakDamage ${piece.chessId} requires hit trigger`);
        battle.on('hit', ({ source, target, dmg }) => {
          if (source === unit && target?.side === 'enemy' && dmg && (dmg.type === 'phys' || dmg.type === 'arts')) dmg.type = weaknessType(source, target, dmg);
        }, { priority: WEAKNESS_PRIORITY, owner: unit });
      } else if (!['badgeThresholdStat', 'staticStats', 'deployWindowStats', 'startDerivedStats'].includes(rule.behavior)) {
        throw new Error(`unimplemented independent native rule ${piece.chessId}:${rule.behavior}`);
      }
    }
  }
}

function installEquipmentMechanisms(battle, catalog, pieces, emit) {
  for (const unit of battle.allyUnits) {
    if (unit.kind !== 'op') continue;
    const piece = pieces.find((p) => p.uid === unit.uid);
    if (!piece) continue;
    const ownedEntries = equipmentFor(piece, catalog);
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
      const p = e.rec.params ?? {};
      switch (e.rec.mechanism) {
        case undefined:
        case null:
        case 'badgeAmplifier':
        case 'identityTag':
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
        case 'attackEventProduction': {
          const rule = { trigger: p.counterEvent ?? 'attack', behavior: 'eventProduction', params: p };
          installProductionRule(battle, unit, rule, 'equipment', e.id, emit);
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
      if (!ATTACHMENT_IDS.has(rec.mechanism)) throw new Error(`unimplemented independent attachment mechanism ${rec.mechanism ?? id}`);
      const p = rec.params ?? {};
      if (rec.mechanism === 'ammoRecovery') installProductionRule(battle, unit, { trigger: 'ammoUsed', behavior: 'eventProduction', params: { counterEvent: 'ammoUsed', counterEvery: 12, outputs: [{ id: 'agility', quantity: 1 }], maxPerBattle: 3, filter: { actor: 'self' } } }, 'attachment', rec.id, emit);
      else if (rec.mechanism === 'coldRecord') {
        let fired = false;
        battle.on('statusApplied', (ctx) => {
          if (fired || ctx.source !== unit || ctx.target?.side !== 'enemy' || ctx.status !== 'freeze' || !ctx.entered) return;
          if (ctx.source?.mem?.independentOrigin) return;
          fired = true;
          emit({ id: 'assault', quantity: 2, origin: 'attachment', sourceUid: unit.uid, cap: 2 });
        }, { owner: unit });
      } else if (rec.mechanism === 'medicalReadiness') {
        const key = `independentMedical:${unit.uid}`;
        unit.mem[key] = 0;
        battle.on('heal', (ctx) => {
          if (ctx.source !== unit || ctx.target === unit || ctx.source?.mem?.independentOrigin || ctx.opts?.self) return;
          if (ctx.target?.side !== 'ally') return;
          const effective = Math.max(0, Math.min(Number(ctx.amount) || 0, ctx.target.s.maxHp - ctx.target.hp));
          if (!effective) return;
          const heals = unit.mem[key] + 1;
          if (heals >= 20) { unit.mem[key] = heals - 20; emit({ id: 'fortitude', quantity: 1, origin: 'attachment', sourceUid: unit.uid, cap: 3 }); }
          else unit.mem[key] = heals;
        }, { owner: unit });
      } else if (rec.mechanism === 'quartermasterStock') {
        // Rest-phase production is represented here as a deferred battle-end event for the next state transaction.
        unit.mem.independentRestEffects ??= [];
        unit.mem.independentRestEffects.push({ trigger: 'roundEnd', output: { id: 'precision', quantity: 1 }, origin: 'attachment' });
      }
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
  battle.on('battleEnd', () => {
    for (const unit of battle.allyUnits) {
      const p = pieces.find((x) => x.uid === unit.uid);
      if (!p) continue;
      const deferred = unit.mem.independentRestEffects ?? [];
      for (const x of deferred) emit({ ...x.output, sourceUid: unit.uid, origin: x.origin });
      unit.mem.independentRestEffects = [];
    }
  });
}
