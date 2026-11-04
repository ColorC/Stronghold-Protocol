import { active, bodyOf, pieceOf, haste } from './primitives.js';
import { installTemporaryAbilities } from './temporary-abilities.js';
import { installLinkedSkills } from './linked-skills.js';

const installed = new WeakSet();
const ENCHANTS = new Set(['golden', 'heavy', 'icy', 'turbo', 'shielded', 'restorative', 'toxic', 'fiery',
  'deadly', 'obsidian', 'mossy', 'shiny', 'radiant']);
const SKILLS = new Set(['strategy_waters', 'strategy_defender', 'strategy_frozen', 'strategy_burn']);

function rankValue(definition, rank, field = 'values') {
  const values = definition?.battle?.[field] ?? definition?.[field] ?? definition?.battle?.valuesByStar ?? definition?.valuesByStar;
  if (!Array.isArray(values) || values.length !== 4) throw new TypeError(`Assault upgrade ${definition?.id} requires four ${field}`);
  const value = Number(values[rank - 1]);
  if (!Number.isFinite(value)) throw new TypeError(`Assault upgrade ${definition?.id} has an invalid ${field} value`);
  return value;
}

function activeOperator(unit) { return active(unit) && unit.kind === 'op' && unit.side === 'ally'; }
function hostPiece(unit) { try { return pieceOf(unit); } catch { return null; } }
function hostBody(unit) { try { return bodyOf(unit); } catch { return null; } }
function skillKind(unit) { return hostPiece(unit)?.fixedSkill?.kind ?? hostBody(unit)?.fixedSkill?.kind ?? 'instant'; }
function enchantKind(unit, definitions) {
  const id = hostPiece(unit)?.enchantmentId;
  return definitions.get(id)?.battle?.kind ?? null;
}
function hostsByEnchantment(battle, kind, definitions) {
  return battle.allyUnits.filter((unit) => unit.kind === 'op' && unit.side === 'ally' && enchantKind(unit, definitions) === kind);
}
function enemies(battle) { return battle.enemies.filter((unit) => unit?.alive && !unit.removed); }
function clearHostEffects(battle, unit) {
  for (const ally of battle.allyUnits) for (const buff of [...(ally.buffs ?? [])]) {
    if (String(buff.key).startsWith('assault:upgrade:') && buff.source === unit) battle.removeBuff(ally, buff);
  }
  for (const enemy of battle.enemies) for (const buff of [...(enemy.buffs ?? [])]) {
    if (buff.data?.assaultUpgradeHost === unit.uid) battle.removeBuff(enemy, buff);
  }
}

function onActivation(battle, unit, fn, owner) {
  if (skillKind(unit) === 'passive') {
    battle.on('attack', (event) => {
      if (event.attacker !== unit || event.isSkill || !(event.targets?.length) || !activeOperator(unit)) return;
      fn();
    }, { owner });
  } else {
    battle.on('skillStart', (event) => {
      if (event.unit !== unit || event.extra || !activeOperator(unit)) return;
      fn();
    }, { owner });
  }
}

function rolledTarget(battle) { return battle.rng.pick(enemies(battle)); }
function addTimedBuff(battle, unit, key, mods, duration, extra = {}) {
  if (!(duration > 0)) return null;
  return battle.addBuff(unit, { key, mods, duration, refresh: 'replace', source: unit, ...extra });
}
function applyDot(battle, host, target, { type, amount, duration, key, bonus = () => 0 }) {
  const deploySeq = host.deploySeq;
  battle.addBuff(target, { key, source: host, duration, refresh: 'replace', interval: 1,
    data: { assaultUpgradeHost: host.uid, deploySeq },
    onTick: ({ battle: current, unit: victim, buff }) => {
      if (!activeOperator(host) || host.deploySeq !== buff.data.deploySeq || !victim.alive) {
        current.removeBuff(victim, buff);
        return;
      }
      const value = amount + bonus();
      if (!(value > 0)) return;
      current.dealDamage(host, victim, { amount: value, type, isSkill: true, canDodge: false,
        sourceless: type === 'true', tags: ['dot', 'periodic', 'assaultUpgrade', key] });
    } });
}

function installEnchantments(battle, prepared, definitions, skillDefinitions, owner) {
  const defById = new Map(definitions.map((entry) => [entry.id, entry]));
  const strategyById = new Map(skillDefinitions.map((entry) => [entry.id, entry]));
  const pieceIds = new Set((prepared.input?.pieces ?? []).map((piece) => piece.uid));
  const hostByUid = new Map(battle.allyUnits.filter((unit) => pieceIds.has(unit.uid) && unit.kind === 'op').map((unit) => [unit.uid, unit]));
  for (const unit of hostByUid.values()) {
    const piece = hostPiece(unit);
    const enchantId = piece?.enchantmentId;
    if (!enchantId) continue;
    const definition = defById.get(enchantId);
    if (!definition) throw new Error(`unknown Assault enchantment ${enchantId}`);
    const id = definition.battle?.kind;
    if (!ENCHANTS.has(id)) throw new Error(`unsupported Assault enchantment kind ${id ?? '<missing>'}`);
    const star = piece.star;
    const values = definition.battle;
    const current = (fn) => onActivation(battle, unit, fn, owner);
    if (id === 'heavy' || id === 'icy') {
      current(() => {
        const target = rolledTarget(battle);
        if (!target) return;
        const status = id === 'heavy' ? 'slow' : 'freeze';
        const duration = Number(values.duration ?? (id === 'heavy' ? 2 : 0.5));
        const applied = battle.applyStatus(target, status, { duration,
          ...(id === 'heavy' ? { value: 1 - Number(values.moveMul ?? 0.5) } : null), source: unit });
        if (applied) battle.emit('assaultUpgradeEffect', { kind: id, source: unit, target, status, duration });
      });
    } else if (id === 'turbo') {
      current(() => {
        const target = battle.rng.pick(battle.allyUnits.filter((candidate) => activeOperator(candidate) && candidate.skill?.kind !== 'passive'
          && (candidate.skill?.spType === 'time' || candidate.skill?.spec?.spType === 'INCREASE_WITH_TIME'
            || hostBody(candidate)?.fixedSkill?.runtime?.spType === 'INCREASE_WITH_TIME')));
        if (!target) return;
        if (!(Number(target.base?.spRecovery) > 0)) return;
        haste(battle, unit, target, Number(values.duration ?? 2), `assault:upgrade:turbo:${unit.uid}`);
        battle.emit('assaultUpgradeEffect', { kind: id, source: unit, target, duration: 2 });
      });
    } else if (id === 'shielded') {
      current(() => {
        const amount = rankValue(definition, star);
        battle.addBuff(unit, { key: `assault:upgrade:shielded:${unit.uid}:${unit.deploySeq}:${++battle._assaultUpgradeShieldSeq}`,
          shield: amount, duration: Infinity, source: unit, tags: ['assaultUpgrade'] });
        battle.emit('assaultUpgradeEffect', { kind: id, source: unit, target: unit, amount });
      });
    } else if (id === 'restorative') {
      current(() => {
        const amount = rankValue(definition, star);
        const healed = battle.heal(unit, unit, amount, { self: true });
        if (healed > 0) battle.emit('assaultUpgradeEffect', { kind: id, source: unit, target: unit, amount: healed });
      });
    } else if (id === 'toxic' || id === 'fiery') {
      current(() => {
        const target = rolledTarget(battle);
        if (!target) return;
        const amount = rankValue(definition, star);
        applyDot(battle, unit, target, { type: id === 'toxic' ? 'true' : 'arts', amount,
          duration: Number(values.duration ?? (id === 'toxic' ? 5 : 4)), key: `${id}:${unit.uid}:${target.uid}`,
          bonus: () => id === 'fiery' ? battle._assaultUpgradeBurnBonus : 0 });
        battle.emit('assaultUpgradeEffect', { kind: id, source: unit, target, amount, duration: Number(values.duration ?? (id === 'toxic' ? 5 : 4)) });
      });
    } else if (id === 'mossy') {
      current(() => {
        const amount = rankValue(definition, star);
        addTimedBuff(battle, unit, `assault:upgrade:mossy:${unit.uid}`, { hpRegen: amount }, Number(values.duration ?? 4));
        battle.emit('assaultUpgradeEffect', { kind: id, source: unit, target: unit, amount, duration: Number(values.duration ?? 4) });
      });
    } else if (id === 'shiny') {
      battle.assaultRuntime.observe('skillStart', `upgrade:shiny:${unit.uid}`, (event, runtime) => {
        if (event.payload?.source !== unit || event.payload?.extra || !activeOperator(unit)) return;
        runtime.enqueue(() => runtime.cast(unit, { extra: true, suppressRedeploy: true, force: true }), {
          key: 'upgrade:shiny-extra', targetUid: unit.uid, cause: event.cause, sourceUid: unit.uid,
        });
      }, { owner });
    } else if (id === 'radiant') {
      battle.on('beforeStatus', (event) => {
        if (event.target !== unit || event.source?.side !== 'enemy' || !activeOperator(unit)) return;
        if (!(values.statuses ?? ['slow', 'freeze', 'disarm']).includes(event.status)) return;
        event.cancel = true;
        battle.emit('assaultUpgradeEffect', { kind: id, source: unit, target: unit, status: event.status, immune: true });
      }, { owner });
    }
  }

  const deadly = new Set(hostsByEnchantment(battle, 'deadly', defById));
  const obsidian = new Set(hostsByEnchantment(battle, 'obsidian', defById));
  const fiery = hostsByEnchantment(battle, 'fiery', defById);
  battle._assaultUpgradeBurnBonus = 0;
  battle._assaultUpgradeShieldSeq = 0;
  battle.on('hit', (event) => {
    const { source, target, dmg } = event;
    if (!activeOperator(source) || !target?.alive || target.side !== 'enemy' || !dmg || !(dmg.amount > 0)) return;
    const tags = dmg.tags ?? [];
    const dot = tags.includes('dot') || tags.includes('periodic');
    const deadlyDef = defById.get(hostPiece(source)?.enchantmentId)?.battle;
    const obsidianDef = defById.get(hostPiece(source)?.enchantmentId)?.battle;
    if (obsidian.has(source)) dmg.mul = (Number(dmg.mul) || 1) * Number(obsidianDef?.multiplier ?? 2);
    if (!deadly.has(source) || dot || !(dmg.isAttack || dmg.isSkill) || !battle.rng.chance(Number(deadlyDef?.chance ?? 0.5))) return;
    dmg.mul = (Number(dmg.mul) || 1) * Number(deadlyDef?.multiplier ?? 2);
    battle.emit('upgradeCritical', { source, target, dmg, multiplier: 2, enchantmentId: 'deadly' });
  }, { owner });
  battle.on('upgradeCritical', ({ source }) => {
    const skill = (prepared.input?.skillRanks ?? {}).strategy_burn ?? 0;
    if (skill < 3 || !fiery.length) return;
    const bonus = rankValue(strategyById.get('strategy_burn'), skill, 'valuesByStar');
    if (bonus > 0) battle._assaultUpgradeBurnBonus += bonus;
  }, { owner });
  battle.on('battleEnd', () => {
    for (const unit of hostByUid.values()) clearHostEffects(battle, unit);
    for (const enemy of battle.enemies) for (const buff of [...(enemy.buffs ?? [])]) {
      if (buff.tags?.includes('assaultUpgrade') || buff.data?.assaultUpgradeHost) battle.removeBuff(enemy, buff);
    }
    battle._assaultUpgradeBurnBonus = 0;
  }, { owner });
}

function installStrategySkills(battle, prepared, definitions, enchantmentDefinitions, owner) {
  const ranks = prepared.input?.skillRanks ?? {};
  const skillById = new Map(definitions.map((entry) => [entry.id, entry]));
  for (const id of Object.keys(ranks)) if (!skillById.has(id)) throw new Error(`unknown Assault strategy skill ${id}`);
  for (const id of SKILLS) {
    const star = Number(ranks[id] ?? 0);
    if (star === 0) continue;
    if (!Number.isInteger(star) || star < 1 || star > 4) throw new RangeError(`invalid rank for ${id}`);
    const definition = skillById.get(id);
    if (!definition) throw new Error(`missing Assault strategy skill definition ${id}`);
    if (star < definition.startingStar) throw new RangeError(`rank for ${id} is below its starting rank`);
    const amount = rankValue(definition, star, 'valuesByStar');
    if (id === 'strategy_waters') {
      const apply = (unit) => {
        const body = hostBody(unit);
        const piece = hostPiece(unit);
        if (!activeOperator(unit) || !(['SNIPER', 'CASTER'].includes(unit.profession) || ['SNIPER', 'CASTER'].includes(body?.profession)
          || body?.position === 'RANGED' || piece?.position === 'RANGED')) return;
        battle.addBuff(unit, { key: `assault:upgrade:strategy_waters:${unit.uid}`, mods: { atkFlat: amount }, duration: Infinity, source: null });
      };
      for (const unit of battle.allyUnits) apply(unit);
      battle.on('deploy', ({ unit }) => apply(unit), { owner });
    } else if (id === 'strategy_defender') {
      const enchantDefs = new Map(enchantmentDefinitions.map((entry) => [entry.id, entry]));
      const candidates = hostsByEnchantment(battle, 'shielded', enchantDefs);
      const valueOf = (unit) => {
        const body = hostBody(unit); const piece = hostPiece(unit); const fixed = piece?.fixedSkill ?? body?.fixedSkill;
        const starIndex = (piece?.star ?? 1) - 1;
        const cost = fixed?.kind === 'passive' ? Number(unit.base?.bat ?? fixed.bat)
          : (Array.isArray(fixed?.spCosts) ? fixed.spCosts[starIndex] : fixed?.spCost);
        return Number.isFinite(Number(cost)) ? Number(cost) : 0;
      };
      const max = Math.max(0, ...candidates.map(valueOf));
      const selected = new Set(candidates.filter((unit) => valueOf(unit) === max));
      for (const unit of selected) onActivation(battle, unit, () => {
        if (!activeOperator(unit)) return;
        battle.addBuff(unit, { key: `assault:upgrade:strategy_defender:${unit.uid}:${unit.deploySeq}:${battle.time}`,
          shield: amount, duration: Infinity, source: unit, tags: ['assaultUpgrade'] });
      }, owner);
    } else if (id === 'strategy_frozen') {
      const cap = rankValue(definition, star, 'limitsByStar'); let spent = 0;
      if (!Number.isInteger(cap) || cap < 0) throw new TypeError('strategy_frozen has invalid limit');
      battle.on('skillStart', (event) => {
        const source = event.unit;
        if (event.extra || spent >= cap || !activeOperator(source) || !['SUPPORT', 'MEDIC'].includes(source.profession)
          && !['SUPPORT', 'MEDIC'].includes(hostBody(source)?.profession)) return;
        const enchantDefs = new Map(enchantmentDefinitions.map((entry) => [entry.id, entry]));
        const candidates = hostsByEnchantment(battle, 'icy', enchantDefs).filter((unit) => unit.skill?.kind !== 'passive'
          && unit.skill?.sp < unit.skill?.spCost && activeOperator(unit));
        const target = battle.rng.pick(candidates);
        if (!target || !(amount > 0)) return;
        const gained = target.skill.gainSp(amount, `assault:${id}`);
        if (gained > 0) { spent += 1; battle.emit('assaultUpgradeEffect', { kind: id, source, target, amount: gained, used: spent, limit: cap }); }
      }, { owner });
    }
  }
}

export function installUpgrades(battle, prepared, { design = null } = {}) {
  if (!battle || !battle.assaultRuntime) throw new TypeError('installUpgrades requires an Assault battle runtime');
  if (installed.has(battle)) return battle._assaultUpgradeState;
  installed.add(battle);
  const input = prepared?.input ?? prepared;
  if (!Array.isArray(input?.pieces)) throw new TypeError('prepared Assault input requires pieces');
  const skills = design?.system?.strategySkills ?? [];
  const enchantments = design?.system?.enchantments ?? [];
  if (!Array.isArray(skills) || !Array.isArray(enchantments)) throw new TypeError('Assault upgrades require strategySkills and enchantments definitions');
  const owner = { type: 'assault-upgrades', battle };
  const state = battle._assaultUpgradeState = { owner, hostCount: 0 };
  installTemporaryAbilities(battle, prepared);
  installStrategySkills(battle, prepared, skills, enchantments, owner);
  installLinkedSkills(battle, prepared, skills);
  installEnchantments(battle, prepared, enchantments, skills, owner);
  battle.on('death', ({ unit }) => { if (unit && hostPiece(unit)) clearHostEffects(battle, unit); }, { owner });
  battle.on('retreating', ({ unit }) => { if (unit && hostPiece(unit)) clearHostEffects(battle, unit); }, { owner });
  battle.on('removed', ({ unit }) => { if (unit && hostPiece(unit)) clearHostEffects(battle, unit); }, { owner });
  state.hostCount = hostsByEnchantment(battle, 'golden', new Map(enchantments.map((entry) => [entry.id, entry]))).length;
  return state;
}
