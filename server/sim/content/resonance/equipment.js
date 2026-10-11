import { ADD_KEYS, MUL_KEYS } from '../../buffs.js';
import { hasHp, isHpLoss, mitigate, periodicDamage } from '../../damage.js';

// Resonance equipment = the native 卫戍协议 items (tools/resonance/build-content.mjs): component/item stats at native
// scale plus one native item effect per completed item. Every hook below mirrors the native item behaviour in
// server/sim/content/items/battle.js with the Resonance numbers; proc damage carries the 'equipment' tag and never
// re-triggers equipment procs.
const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const contentOf = (catalog) => catalog?.resonanceContent ?? catalog ?? {};
const SUPPORTED = new Set(['component_stat','item_stat','cast_stack','undying','attack_heal','pegasus_lance','pegasus_helm','attack_element',
  'attack_stack','attack_status','skill_silence','self_drain','riot_shield','status_immunity','opening_damage','far_damage','flat_reduction','taunt_guard',
  'opening_stun','first_hit_stealth','revive','skill_barrier','pact_transfer','transfer_pact','choose_identity_transfer']);
const STAT_KINDS = new Set(['component_stat','item_stat']);
const TRANSFER_KINDS = new Set(['pact_transfer','transfer_pact','choose_identity_transfer']);
const TAGS = ['resonance','equipment'];
// 'fatal' priorities as the native items: a skill's / talent's own undying runs first, then 坚固's 不死, then M3's 复活
const PRIO_UNDYING = -100, PRIO_REVIVE = -101;
const inputOf = (unit) => unit?.player?.input?.units?.find((entry) => String(entry?.uid) === String(unit.uid) && entry.kind !== 'token') ?? null;
const itemId = (item) => typeof item === 'string' ? item : item?.itemId ?? item?.id ?? null;
const gearOf = (unit) => (inputOf(unit)?.items ?? unit.items ?? []).map(itemId).filter(Boolean);
const effectList = (unit) => unit?.mem?.resonanceEquipmentEffects ?? [];
const effectsFor = (unit, kind) => effectList(unit).filter((row) => row.kind === kind);
const effectFor = (unit, kind) => effectList(unit).find((row) => row.kind === kind) ?? null;
const isOp = (unit) => unit?.side === 'ally' && unit.kind === 'op';
const isProc = (dmg) => Array.isArray(dmg?.tags) && dmg.tags.includes('equipment');
/** Does the unit carry item `id` (own equipment, a battle-local Scrap item, or a legacy alias resolved to it)? */
const carries = (unit, id) => gearOf(unit).includes(id) || effectList(unit).some((row) => row.itemId === id || row.itemId === `scrap:${id}`);

/**
 * Battle mods of one equipment row: component_stat / item_stat at native scale (atkPct/defPct/hpPct/resIgnorePct in
 * percent, aspd and res in points, sp = natural SP recovery per second; the flat atk/def/hp keys are read only for
 * pre-rework rows) and taunt_guard's aggro level and damage-taken factor. Adds into `mods`.
 */
export function equipmentRowMods(row, mods = {}) {
  const p = row?.params ?? {};
  const add = (key, value) => { if (value) mods[key] = (mods[key] ?? 0) + value; };
  if (STAT_KINDS.has(row?.kind)) {
    add('atkPct', n(p.atkPct) / 100); add('defPct', n(p.defPct) / 100); add('hpPct', n(p.hpPct) / 100);
    add('aspd', n(p.aspd)); add('resFlat', n(p.res)); add('spRecoveryFlat', n(p.sp)); add('resIgnorePct', n(p.resIgnorePct) / 100);
    add('atkFlat', n(p.atk)); add('defFlat', n(p.def)); add('hpFlat', n(p.hp));
  } else if (row?.kind === 'taunt_guard') {
    add('taunt', n(p.taunt, 1));
    mods.dmgTakenMul = (mods.dmgTakenMul ?? 1) * Math.max(0, 1 - n(p.damageReduction) / 100);
  }
  return mods;
}
/** Initial SP of one stat row (每件迅捷作战粮 / 黄沙罗盘 adds its own). */
export const equipmentRowInitialSp = (row) => STAT_KINDS.has(row?.kind) ? n(row.params?.initialSp ?? row.params?.initSp) : 0;

function actualItemEffects(content, unit) {
  const rows = [];
  for (const id of gearOf(unit)) {
    const item = content.equipment?.[id];
    if (!item) throw new Error(`UNKNOWN_RESONANCE_EQUIPMENT:${id}`);
    for (const effect of item.effects ?? []) {
      if (!SUPPORTED.has(effect.kind)) throw new Error(`UNKNOWN_RESONANCE_EQUIPMENT_EFFECT:${id}:${effect.kind}`);
      // a legacy reward alias (prototype source gear) acts as the native item it now is
      rows.push({ ...effect, itemId: item.legacyAliasOf ?? id, itemKind: item.kind });
    }
  }
  return rows;
}
function uniqueNonComponent(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (row.kind === 'component_stat' || TRANSFER_KINDS.has(row.kind)) return true;
    // Component stats count per carried item; the item's own stat bonus and effect apply once per named item.
    const key = `${row.itemId}:${row.kind}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function statMods(rows, unit) {
  const mods = {};
  for (const row of rows) {
    equipmentRowMods(row, mods);
    const initial = equipmentRowInitialSp(row);
    if (initial) unit.mem.resonanceEquipmentInitialSp = (unit.mem.resonanceEquipmentInitialSp ?? 0) + initial;
    if (row.kind === 'transfer_pact' || row.kind === 'pact_transfer') {
      const pactId = row.params?.pactId ?? row.params?.pact;
      if (pactId) { unit.mem.resonancePacts ??= new Set(); unit.mem.resonancePacts.add(pactId); }
    }
    if (row.kind === 'choose_identity_transfer') unit.mem.resonanceIdentityChoicePending = true;
  }
  for (const key of Object.keys(mods)) if (!ADD_KEYS.includes(key) && !MUL_KEYS.includes(key)) throw new Error(`UNKNOWN_RESONANCE_EQUIPMENT_STAT:${key}`);
  return mods;
}
function assertCoverage(content) {
  for (const [id, item] of Object.entries(content.equipment ?? {})) for (const row of item.effects ?? []) {
    if (!SUPPORTED.has(row.kind)) throw new Error(`UNKNOWN_RESONANCE_EQUIPMENT_EFFECT:${id}:${row.kind}`);
  }
}
/** Per-target cooldown kept on the target: true while `unit`'s effect `key` may not hit `target` again. */
function targetCooling(battle, unit, target, key, seconds) {
  const id = `resonanceEquipment:${key}:${unit.id}`;
  if (battle.time < n(target.mem[id], -Infinity)) return true;
  target.mem[id] = battle.time + seconds;
  return false;
}
/** Damage after the target's DEF/RES (the native flat-reduction estimate, damage.js mitigate). */
function mitigated(amount, type, target, source, dmg) {
  const ss = source?.s ?? null;
  return mitigate(amount, type, target.s, {
    defIgnorePct: (dmg.defIgnorePct || 0) + (ss ? ss.defIgnorePct : 0), defIgnoreFlat: (dmg.defIgnoreFlat || 0) + (ss ? ss.defIgnoreFlat : 0),
    resIgnorePct: (dmg.resIgnorePct || 0) + (ss ? ss.resIgnorePct : 0), resIgnoreFlat: (dmg.resIgnoreFlat || 0) + (ss ? ss.resIgnoreFlat : 0),
  });
}
/** 护盾无人机: a 生命上限 barrier that refreshes to the larger of the remaining and the new amount (never stacks). */
function grantBarrier(battle, unit) {
  const row = effectFor(unit, 'skill_barrier');
  if (!row || !unit.alive || !unit.deployed) return;
  const key = `resonance:equipment:barrier:${unit.id}`;
  const amount = unit.s.maxHp * n(row.params?.maxHpPercent, 12) / 100;
  const current = n(unit.findBuff?.(key)?.shield);
  battle.addBuff(unit, { key, shield: Math.max(current, amount), duration: Infinity, visible: true, tags: TAGS });
}
/** 卡西米尔竞技旗: damage factor `seconds` after the carrier's deployment — full for `duration`, then back to 100% over `decay`. */
export function openingDamageFactor(params, seconds) {
  const peak = n(params?.damagePercent, 135) / 100, duration = n(params?.duration, 15), decay = Math.max(0, n(params?.decay, 15));
  if (seconds <= duration + 1e-9) return peak;
  if (decay <= 0 || seconds >= duration + decay) return 1;
  return peak - (peak - 1) * (seconds - duration) / decay;
}

/** Apply equipment stats, pact transfers and all completed-item effects to the real Battle units. */
export function installResonanceEquipment(battle, { catalog, state } = {}) {
  const content = contentOf(catalog);
  assertCoverage(content);
  const units = (battle.allyUnits ?? []).filter((unit) => unit.kind === 'op');
  for (const unit of units) {
    const rows = uniqueNonComponent(actualItemEffects(content, unit));
    unit.mem.resonanceEquipmentEffects = rows;
    const mods = statMods(rows, unit);
    if (Object.keys(mods).length) battle.addBuff(unit, { key:`resonance:equipment:stats:${unit.id}`, persist:true, allowDead:true, mods, tags:TAGS });
  }
  battle.on('battleStart', () => {
    for (const unit of units) {
      const amount = unit.mem.resonanceEquipmentInitialSp ?? 0;
      if (amount > 0) { unit.mem.resonanceEquipmentInitialSp = 0; unit.skill?.gainSp?.(amount, 'resonanceGearInit'); }
      grantBarrier(battle, unit);
    }
  }, { owner: battle });
  battle.on('deploy', (event) => { if (battle.started && isOp(event?.unit)) grantBarrier(battle, event.unit); }, { owner: battle });

  battle.on('attack', (event) => {
    const unit = event?.attacker;
    if (!isOp(unit) || !effectList(unit).length) return;
    const foes = (event.targets ?? []).filter((row) => row?.side === 'enemy' && row.alive);
    // 有限加速器: every attack or heal of the carrier, battle-long, capped
    for (const row of effectsFor(unit, 'attack_stack')) {
      if (!foes.length && !row.params?.countsHeals) continue;
      const p = row.params ?? {}, key = `resonance:equipment:attack-stack:${row.itemId}:${unit.id}`;
      unit.mem[key] = Math.min(n(p.maxAspd, 40), n(unit.mem[key]) + n(p.aspdPerAttack, 2));
      battle.addBuff(unit, { key, persist:true, allowDead:true, mods:{ aspd:unit.mem[key] }, tags:TAGS });
    }
    if (!foes.length) return;
    // 休眠子裔: each attacked target heals the carrier
    for (const row of effectsFor(unit, 'attack_heal')) for (let i = 0; i < foes.length; i++)
      battle.heal(unit, unit, unit.s.maxHp * n(row.params?.maxHpPercent, 2) / 100, { self:true, tags:TAGS });
    // 战栗维式重锤 / 谢拉格不融冰: chance per attacked target
    for (const row of effectsFor(unit, 'attack_status')) {
      const p = row.params ?? {}, chance = n(p.chance) / 100;
      for (const target of foes) if (chance > 0 && target.alive && battle.rng() < chance) battle.applyStatus(target, p.status, { duration:n(p.duration, 1), source:unit });
    }
    // 突袭手雷: within the window after the carrier's deployment, attacks stun (per-target cooldown)
    for (const row of effectsFor(unit, 'opening_stun')) {
      const p = row.params ?? {};
      if (battle.time - n(unit.deployedAt) > n(p.window, 10) + 1e-9) continue;
      for (const target of foes) if (target.alive && !targetCooling(battle, unit, target, `stun:${row.itemId}`, n(p.targetCooldown, 4)))
        battle.applyStatus(target, 'stun', { duration:n(p.duration, 1), source:unit });
    }
  }, { owner: battle });

  battle.on('hit', (event) => {
    const source = event?.source, target = event?.target, dmg = event?.dmg;
    if (!dmg || dmg.type === 'element') return;
    if (isOp(source) && target?.side === 'enemy') {
      // 卡西米尔竞技旗: damage boost after deployment, decaying back to normal
      for (const row of effectsFor(source, 'opening_damage')) dmg.mul = (dmg.mul ?? 1) * openingDamageFactor(row.params, battle.time - n(source.deployedAt));
      // 精准狙击镜: targets at least `distance` tiles away
      for (const row of effectsFor(source, 'far_damage'))
        if (Math.hypot(target.x - source.x, target.y - source.y) >= n(row.params?.distance, 3) - 1e-6) dmg.mul = (dmg.mul ?? 1) * (1 + n(row.params?.damageBonus, 30) / 100);
    }
    // 防暴盾: while blocking, damage from units the carrier does not block
    if (isOp(target) && source && source !== target && target.blocking?.length && !target.blocking.includes(source))
      for (const row of effectsFor(target, 'riot_shield')) dmg.mul = (dmg.mul ?? 1) * Math.max(0, 1 - n(row.params?.damageReduction, 40) / 100);
  }, { owner: battle });
  // 海沟实验体: 伤害减免 per damage instance after DEF/RES, after the other damage modifiers
  battle.on('hit', (event) => {
    const target = event?.target, dmg = event?.dmg;
    if (!isOp(target) || !dmg || dmg.type === 'element') return;
    for (const row of effectsFor(target, 'flat_reduction')) {
      const base = mitigated(dmg.amount * (dmg.mul ?? 1), dmg.type, target, event.source, dmg);
      if (base > 0) dmg.mul = (dmg.mul ?? 1) * Math.max(0, base - n(row.params?.amount, 120)) / base;
    }
  }, { owner: battle, priority: -10 });

  battle.on('damaged', (event) => {
    const source = event?.source, target = event?.target, dmg = event?.dmg;
    if (isOp(source) && target?.side === 'enemy' && event.type !== 'element' && !isProc(dmg) && event.amount > 0) {
      // 天马之枪 + 天马之盔: every damage instance adds ATK-scaled true damage
      for (const row of effectsFor(source, 'pegasus_lance')) if (target.alive && carries(source, row.params?.partnerId))
        battle.dealDamage(source, target, { amount:source.s.atk * n(row.params?.trueDamageAtk, 30) / 100, type:'true', canDodge:false, tags:[...TAGS,'pegasus'] });
      // 灼燃维式重锤: attacks add ATK-scaled 灼燃损伤 (not on the killing blow: no burst on the corpse)
      if (dmg?.isAttack) for (const row of effectsFor(source, 'attack_element')) if (hasHp(target))
        battle.dealDamage(source, target, { type:'element', element:row.params?.element ?? 'burn', amount:source.s.atk * n(row.params?.atkPercent, 10) / 100, tags:[...TAGS,'element'] });
      // 奥术法阵: skill hits silence (失去特殊能力), per-target cooldown
      if (dmg?.isSkill) for (const row of effectsFor(source, 'skill_silence')) if (target.alive && !targetCooling(battle, source, target, `silence:${row.itemId}`, n(row.params?.targetCooldown, 8)))
        battle.applyStatus(target, 'silence', { duration:n(row.params?.duration, 3), source });
    }
    // 伪装服: the first damage taken (a 流失 is not 受到伤害) ⇒ 隐匿
    if (isOp(target) && event.amount > 0 && target.alive && !isHpLoss(dmg)) for (const row of effectsFor(target, 'first_hit_stealth')) {
      const key = `resonanceEquipmentStealth:${row.itemId}`;
      if (target.mem[key]) continue;
      target.mem[key] = true;
      battle.applyStatus(target, 'stealth', { duration:n(row.params?.duration, 5), source:target });
    }
  }, { owner: battle });

  // 浓缩嗅盐: above the HP threshold, control states are cancelled
  battle.on('beforeStatus', (event) => {
    const target = event?.target;
    if (!isOp(target)) return;
    for (const row of effectsFor(target, 'status_immunity'))
      if ((row.params?.statuses ?? []).includes(event.status) && target.hpRatio > n(row.params?.hpAbove, 70) / 100) event.cancel = true;
  }, { owner: battle });

  battle.on('skillStart', (event) => {
    const unit = event?.unit;
    if (!isOp(unit)) return;
    // 炎国短刀: each skill activation +ATK%, capped
    for (const row of effectsFor(unit, 'cast_stack')) {
      const p = row.params ?? {}, key = `resonance:equipment:cast-stack:${row.itemId}:${unit.id}`;
      unit.mem[key] = Math.min(n(p.maxPercent, 50), n(unit.mem[key]) + n(p.atkPercentPerCast, 5));
      battle.addBuff(unit, { key, persist:true, allowDead:true, mods:{ atkPct:unit.mem[key] / 100 }, tags:TAGS });
    }
    grantBarrier(battle, unit);
  }, { owner: battle });

  battle.every(1, () => {
    for (const unit of units) {
      if (!unit.alive || !unit.deployed) continue;
      // 源石溶剂: the native periodic true damage (no source, may knock the carrier out)
      for (const row of effectsFor(unit, 'self_drain')) battle.dealDamage(unit, unit, periodicDamage(unit.s.maxHp * n(row.params?.maxHpPercentPerSecond, 1) / 100));
      // 天马之盔 + 天马之枪: regeneration
      for (const row of effectsFor(unit, 'pegasus_helm')) if (unit.alive && carries(unit, row.params?.partnerId))
        battle.heal(unit, unit, unit.s.maxHp * n(row.params?.healMaxHpPercentPerSecond, 3) / 100, { self:true, tags:TAGS });
    }
  }, { owner: battle });

  // 坚固维式重锤: the first lethal hit opens a window in which HP never drops below 1
  battle.on('fatal', (event) => {
    const unit = event?.unit;
    if (!isOp(unit) || event.prevented) return;
    const row = effectFor(unit, 'undying');
    if (!row) return;
    if (battle.time < n(unit.mem.resonanceEquipmentUndyingUntil, -Infinity)) { event.prevented = true; return; }
    if (n(unit.mem.resonanceEquipmentUndyingUses) >= n(row.params?.uses, 1)) return;
    unit.mem.resonanceEquipmentUndyingUses = n(unit.mem.resonanceEquipmentUndyingUses) + 1;
    unit.mem.resonanceEquipmentUndyingUntil = battle.time + n(row.params?.duration, 8);
    event.prevented = true;
  }, { owner: battle, priority: PRIO_UNDYING });
  // M3茧甲: knocked out ⇒ stands up at once with part of its HP (once per battle)
  battle.on('fatal', (event) => {
    const unit = event?.unit;
    if (!isOp(unit) || event.prevented) return;
    const row = effectFor(unit, 'revive');
    if (!row || n(unit.mem.resonanceEquipmentRevives) >= n(row.params?.uses, 1)) return;
    unit.mem.resonanceEquipmentRevives = n(unit.mem.resonanceEquipmentRevives) + 1;
    event.prevented = true;
    unit.hp = Math.max(1, unit.s.maxHp * n(row.params?.hpPercent, 30) / 100);
  }, { owner: battle, priority: PRIO_REVIVE });
  return { units: units.length, effects: units.reduce((sum, unit) => sum + effectList(unit).length, 0) };
}
