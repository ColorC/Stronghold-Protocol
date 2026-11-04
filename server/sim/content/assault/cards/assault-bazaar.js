// Assault bazaar card lines (2026-10-20 bazaar-style rewrite).
//
// Each handler below implements one public card line of
// data/assault-design/bazaar-cards-assault.json.  Numbers come from the
// compiled `body.bazaar` (lines[i].params / modules[id].params), so the card
// text and the runtime read one source.  Old mode passives replaced by these
// lines are listed in BAZAAR_REPLACED_PASSIVES and skipped by assault.js.

import { active, allies, damage, heal, buff, applyStatus, haste, sp, watch, queue, unitTag, uid, v, gainDP } from '../primitives.js';
import { hypot } from '../../../detmath.js';

/** `${charId}:${modePassiveIndex}` entries that the bazaar lines replace. */
export const BAZAAR_REPLACED_PASSIVES = new Set([
  'char_127_estell:0', 'char_265_sophia:0', 'char_4155_talr:0', 'char_4191_tippi:0',
  'char_1014_nearl2:0', 'char_264_f12yin:punch-weaken',
]);

/** Skill effects removed by a bazaar 'simplify' active line (the card no longer lists them). */
const DROPPED_EFFECTS = {
  char_127_estell: (effect) => effect.action === 'heal', // 舍身突击：只保留伤害与自损
  char_263_skadi: (effect) => effect.action === 'heal', // 斯卡蒂：只保留伤害与护盾
  char_2024_chyue: (effect) => effect.action === 'growth', // 重岳：删去增强形态
  char_1023_ghost2: (effect) => effect.action === 'damage' && effect.values?.extraAtkScale != null, // 归溟幽灵鲨：删去条件追加伤害
  char_1041_angel2: (effect) => effect.action === 'damage' && effect.values?.splashRadius != null, // 新约能天使：删去投送落点溅射
  char_1014_nearl2: (effect) => effect.action === 'damage' && effect.trigger === '耀阳出现', // 耀骑士临光：耀阳只晕眩
  char_1028_texas2: (effect) => effect.action === 'damage' && effect.trigger === '落地后当次剑雨', // 缄默德克萨斯：删去施放时剑雨
  char_4064_mlynar: (effect) => effect.action === 'damage' && effect.values?.extraTrueAtkScale != null, // 玛恩纳：删去附带真实伤害
};
export const bazaarKeepsEffect = (charId, effect) => !DROPPED_EFFECTS[charId]?.(effect);

const bodyOfUnit = (unit) => unit.def.raw.assaultBody;
export function lineParam(unit, index, key, fallback = null) {
  const values = bodyOfUnit(unit).bazaar?.lines?.[index]?.params?.[key];
  return values == null ? fallback : Number(v(unit, values));
}
export function moduleOf(unit) {
  const piece = unit.def.raw.assaultPiece;
  const moduleId = piece?.moduleId ?? piece?.moduleChoices?.[unit.def.charId];
  return piece?.star >= 3 ? moduleId ?? null : null;
}
export function moduleParam(unit, moduleId, key, fallback = null) {
  if (moduleOf(unit) !== moduleId) return fallback;
  const values = bodyOfUnit(unit).bazaar?.modules?.[moduleId]?.params?.[key];
  return values == null ? fallback : Number(v(unit, values));
}

export const mine = (unit, other) => !!other && other.side === 'ally' && other.kind === 'op' && other.ownerId === unit.ownerId;
const tile = (x) => [Number.isFinite(x?.tileR) ? x.tileR : Math.round(x?.y), Number.isFinite(x?.tileC) ? x.tileC : Math.round(x?.x)];
export const adjacent4 = (a, b) => { const [ar, ac] = tile(a), [br, bc] = tile(b); return a !== b && Math.abs(ar - br) + Math.abs(ac - bc) === 1; };
export const around8 = (a, b) => { const [ar, ac] = tile(a), [br, bc] = tile(b); return a !== b && Math.max(Math.abs(ar - br), Math.abs(ac - bc)) <= 1; };
const enemyAround8 = (unit, enemy) => Math.max(Math.abs(Math.round(enemy.y) - unit.tileR), Math.abs(Math.round(enemy.x) - unit.tileC)) <= 1;
const enemyAdjacent4 = (unit, enemy) => Math.abs(Math.round(enemy.y) - unit.tileR) + Math.abs(Math.round(enemy.x) - unit.tileC) <= 1;
/** 「每场战斗前 N 次」: one counter per unit and line, reset with the battle unit. */
function takeCharge(unit, key, cap) {
  const counts = unit.mem.assaultBazaarCounts ??= {};
  if ((counts[key] ?? 0) >= cap) return false;
  counts[key] = (counts[key] ?? 0) + 1;
  return true;
}
const meleeHit = (source, target) => !!source && !!target && hypot(source.y - target.y, source.x - target.x) <= 1.6;
const coldOrFrozen = (payload) => payload?.target?.side === 'enemy' && ['cold', 'frozen'].includes(payload.status);

// --- trigger helpers --------------------------------------------------------
function onAllySkill(battle, unit, key, accept, run) {
  watch(battle, unit, 'skillStart', `bazaar:${key}`, ({ payload }) => mine(unit, payload?.source) && accept(payload.source),
    ({ payload, cause }) => run(payload.source, cause));
}
function onAllyKill(battle, unit, key, accept, run) {
  watch(battle, unit, 'kill', `bazaar:${key}`, ({ payload }) => payload?.target?.side === 'enemy' && mine(unit, payload.source) && accept(payload.source),
    ({ payload, cause }) => run(payload, cause));
}
const charge = (battle, unit, amount, key, cause) => { if (amount > 0) sp(battle, unit, unit, amount, 'bazaarLine', `bazaar:${key}`, cause); };
function stackAtk(battle, unit, key, pct, maxStacks, cause) {
  buff(battle, unit, unit, { key: `bazaar:${key}`, mods: { atkPct: pct / 100 }, stacking: 'stack', maxStacks, persist: true, cause });
}
/** Position/type aura refreshed every tick (removed when the recipient leaves). */
function aura(battle, unit, key, select, mods) {
  const buffKey = `bazaar:${key}:${uid(unit)}`;
  const sync = () => {
    const recipients = new Set(active(unit) ? battle.allyUnits.filter((ally) => mine(unit, ally) && active(ally) && select(ally)) : []);
    for (const ally of battle.allyUnits.filter((candidate) => candidate.kind === 'op')) {
      if (recipients.has(ally)) { if (!ally.findBuff(buffKey)) buff(battle, unit, ally, { key: buffKey, mods: mods(), persist: true }); }
      else if (ally.findBuff(buffKey)) battle.removeBuff(ally, buffKey);
    }
  };
  battle.on('tick', sync, { owner: unit });
  battle.on('deploy', sync, { owner: unit });
  battle.on('retreating', sync, { owner: unit });
  sync();
}
const tagSkillCharge = (tag, index, key, fallback) => (battle, unit) => onAllySkill(battle, unit, `${key}`, (src) => unitTag(src, tag),
  (src, cause) => charge(battle, unit, lineParam(unit, index, 'c', fallback), key, cause));
const tagKillCharge = (tag, index, key, fallback) => (battle, unit) => onAllyKill(battle, unit, `${key}`, (src) => unitTag(src, tag),
  (payload, cause) => charge(battle, unit, lineParam(unit, index, 'c', fallback), key, cause));
const adjacentSkillCharge = (amount, key) => (battle, unit) => onAllySkill(battle, unit, key, (src) => adjacent4(src, unit),
  (src, cause) => charge(battle, unit, amount, key, cause));
const coldCharge = (amount, cap, key) => (battle, unit) => watch(battle, unit, 'statusApplied', `bazaar:${key}`,
  ({ payload }) => coldOrFrozen(payload), ({ cause }) => { if (takeCharge(unit, key, cap)) charge(battle, unit, amount, key, cause); });
const burstCharge = (index, key) => (battle, unit) => watch(battle, unit, 'elementBurst', `bazaar:${key}`,
  ({ payload }) => payload?.source?.side === 'ally' && payload.source.ownerId === unit.ownerId,
  ({ cause }) => charge(battle, unit, lineParam(unit, index, 'c', 1), key, cause));

// --- per-card lines ---------------------------------------------------------
const LINES = {
  // 当周围敌人被击倒时，治疗此干员和相邻干员最大生命 h%。
  char_127_estell: (battle, unit) => battle.on('death', ({ unit: dead }) => {
    if (!active(unit) || dead?.side !== 'enemy' || dead.kind === 'token' || !enemyAround8(unit, dead)) return;
    const ratio = lineParam(unit, 1, 'h', 0) / 100;
    queue(battle, 'bazaar:estell:kill-heal', unit, (rt, task) => {
      for (const ally of [unit, ...battle.allyUnits.filter((x) => mine(unit, x) && active(x) && adjacent4(x, unit))])
        heal(battle, unit, ally, { maxHpRatio: ratio, sourceKey: 'char_127_estell:bazaar-kill-heal', cause: task.cause });
    }, battle.assaultRuntime.currentCause);
  }, { owner: unit }),
  // 当你的医疗干员治疗此干员时，为此干员充能 1（每场战斗前 5 次）。
  char_337_utage: (battle, unit) => battle.on('heal', ({ source, target, opts }) => {
    if (target !== unit || !active(unit) || opts?.regen || !mine(unit, source) || !unitTag(source, 'MEDIC')) return;
    if (!takeCharge(unit, 'utage-medic', 5)) return;
    queue(battle, 'bazaar:utage:medic-charge', unit, (rt, task) => charge(battle, unit, 1, 'utage-medic', task.cause), battle.assaultRuntime.currentCause);
  }, { owner: unit }),
  // 当你的罗德岛干员施放技能时，为此干员充能 0.5。
  char_491_humus: tagSkillCharge('rhodes', 2, 'humus-rhodes', 0.5),
  // 当你再部署干员时，为此干员充能 c。
  char_237_gravel: (battle, unit) => watch(battle, unit, 'redeploy', 'bazaar:gravel-redeploy', ({ payload }) => mine(unit, payload?.target),
    ({ cause }) => charge(battle, unit, lineParam(unit, 1, 'c', 1), 'gravel-redeploy', cause)),
  // 当周围干员受到近战攻击时，对攻击者造成 a% 物理伤害。
  char_265_sophia: (battle, unit) => watch(battle, unit, 'damageTaken', 'bazaar:sophia-counter',
    ({ payload }) => payload?.sourceClass === 'attack' && payload.source?.side === 'enemy' && payload.source.alive &&
      mine(unit, payload.target) && around8(payload.target, unit) && meleeHit(payload.source, payload.target),
    ({ payload, cause }) => damage(battle, unit, payload.source, { scale: lineParam(unit, 1, 'a', 0) / 100, type: 'phys',
      sourceKey: 'char_265_sophia:bazaar-counter', cause })),
  // 当你的格拉斯哥帮干员击倒敌人时，为此干员充能 1。
  char_154_morgan: tagKillCharge('glasgow', 2, 'morgan-glasgow', 1),
  // 当你的格拉斯哥帮干员击倒敌人时，加速此干员，持续 t 秒。
  char_155_tiger: (battle, unit) => onAllyKill(battle, unit, 'tiger-glasgow', (src) => unitTag(src, 'glasgow'),
    (payload, cause) => haste(battle, unit, unit, lineParam(unit, 1, 't', 1), 'tiger-glasgow', { cause })),
  // 当你的叙拉古干员击倒敌人时，为此干员充能 c。
  char_140_whitew: tagKillCharge('siracusa', 2, 'whitew-siracusa', 1),
  // 当你的深海猎人干员击倒敌人时，治疗此干员最大生命 h%。
  char_143_ghost: (battle, unit) => onAllyKill(battle, unit, 'ghost-abyssal', (src) => unitTag(src, 'abyssal'),
    (payload, cause) => heal(battle, unit, unit, { maxHpRatio: lineParam(unit, 1, 'h', 0) / 100, sourceKey: 'char_143_ghost:bazaar-kill-heal', cause })),
  // 你的贾维团伙干员对停顿的敌人 +x% 伤害。
  char_356_broca: (battle, unit) => battle.on('hit', ({ source, target, dmg }) => {
    if (!active(unit) || !dmg || !mine(unit, source) || !unitTag(source, 'chiave') || target?.side !== 'enemy') return;
    if (!(target.findBuff?.('sluggish') || target.s?.flags?.sluggish)) return;
    dmg.mul = (dmg.mul ?? 1) * (1 + lineParam(unit, 1, 'x', 0) / 100);
  }, { owner: unit }),
  // 当你部署干员时，此干员本场战斗中 +x% 攻击力（最多 8 层）。
  char_4155_talr: (battle, unit) => watch(battle, unit, 'deployed', 'bazaar:talr-deploy', ({ payload }) => mine(unit, payload?.target),
    ({ cause }) => stackAtk(battle, unit, 'talr-deploy', lineParam(unit, 1, 'x', 0), 8, cause)),
  // 当敌人获得寒冷或冻结时，为此干员充能 1（每场战斗前 5 次）。
  char_173_slchan: coldCharge(1, 5, 'slchan-cold'),
  // 当敌人撞到障碍或其他敌人时，为此干员充能 1（每场战斗前 5 次）。
  char_4036_forcer: (battle, unit) => watch(battle, unit, 'pushCollision', 'bazaar:forcer-collision',
    ({ payload }) => payload?.source?.side === 'ally' && payload.source.ownerId === unit.ownerId,
    ({ cause }) => { if (takeCharge(unit, 'forcer-collision', 5)) charge(battle, unit, 1, 'forcer-collision', cause); }),
  // 当你的装置被触发时，为此干员充能 c。
  char_451_robin: (battle, unit) => watch(battle, unit, 'deviceTrigger', 'bazaar:robin-device',
    ({ payload }) => payload?.ownerId === unit.ownerId,
    ({ cause }) => charge(battle, unit, lineParam(unit, 1, 'c', 1), 'robin-device', cause)),
  // 当相邻干员施放技能时，为此干员充能 0.5。
  char_4016_kazema: adjacentSkillCharge(0.5, 'kazema-adjacent'),
  // 当此干员或相邻干员受到攻击时，对攻击者造成 a% 物理伤害。
  char_4191_tippi: (battle, unit) => watch(battle, unit, 'damageTaken', 'bazaar:tippi-counter',
    ({ payload }) => payload?.sourceClass === 'attack' && payload.source?.side === 'enemy' && payload.source.alive &&
      (payload.target === unit || mine(unit, payload.target) && adjacent4(payload.target, unit)),
    ({ payload, cause }) => damage(battle, unit, payload.source, { scale: lineParam(unit, 1, 'a', 0) / 100, type: 'phys',
      sourceKey: 'char_4191_tippi:bazaar-counter', cause })),
  // 当你的企鹅物流干员部署时，获得 1 费用。
  char_1028_texas2: (battle, unit) => watch(battle, unit, 'deployed', 'bazaar:texas2-penguin',
    ({ payload }) => mine(unit, payload?.target) && unitTag(payload.target, 'penguin'),
    ({ cause }) => gainDP(battle, unit, 1, 'bazaar:texas2-penguin', cause), { allowInactive: false }),
  // 当相邻干员将被击倒时，支付 5 费用，治疗其 70% 生命（每场战斗前 2 次）。
  char_1033_swire2: (battle, unit) => battle.on('fatal', (ctx) => {
    const target = ctx.unit;
    if (ctx.prevented || !active(unit) || !mine(unit, target) || !adjacent4(target, unit)) return;
    const player = battle.getPlayer(unit.ownerId);
    if (!player || player.dp + 1e-9 < 5) return;
    if (!takeCharge(unit, 'swire2-fatal', 2)) return;
    battle.addDp(unit.ownerId, -5, 'assault');
    ctx.prevented = true;
    target.hp = Math.max(target.hp, Math.min(1, target.s.maxHp));
    heal(battle, unit, target, { maxHpRatio: 0.7, sourceKey: 'char_1033_swire2:bazaar-fatal', ignoreHealFree: true });
  }, { owner: unit, priority: -50 }),
  // 当你的深海猎人干员击倒敌人时，为此干员充能 c。
  char_474_glady: tagKillCharge('abyssal', 1, 'glady-abyssal', 0.5),
  // 当相邻干员施放技能时，为此干员充能 1。
  char_437_mizuki: adjacentSkillCharge(1, 'mizuki-adjacent'),
  // 相邻的深海猎人干员 +x% 最大生命（模组：再 +x%）。
  char_1023_ghost2: (battle, unit) => aura(battle, unit, 'ghost2-abyssal', (ally) => adjacent4(ally, unit) && unitTag(ally, 'abyssal'),
    () => ({ hpPct: (lineParam(unit, 1, 'x', 0) + moduleParam(unit, 'uniequip_004_ghost2', 'x', 0)) / 100 })),
  // 当你引发元素爆发时，为此干员充能 c。
  char_1039_thorn2: burstCharge(1, 'thorn2-burst'),
  // 当相邻干员受到攻击时，攻击者 -x% 攻击力，持续 3 秒。
  char_264_f12yin: (battle, unit) => watch(battle, unit, 'damageTaken', 'bazaar:f12yin-weaken',
    ({ payload }) => payload?.sourceClass === 'attack' && payload.source?.side === 'enemy' && payload.source.alive &&
      mine(unit, payload.target) && adjacent4(payload.target, unit),
    ({ payload, cause }) => buff(battle, unit, payload.source, { key: `char_264_f12yin:bazaar-weaken:${uid(unit)}`,
      mods: { atkPct: -lineParam(unit, 1, 'x', 0) / 100 }, duration: 3, stacking: 'replace', cause })),
  // 当此干员施放技能时，为你的其他岁干员充能 c。
  char_2024_chyue: (battle, unit) => onAllySkill(battle, unit, 'chyue-sui', (src) => src === unit, (src, cause) => {
    for (const ally of battle.allyUnits.filter((x) => mine(unit, x) && x !== unit && active(x) && unitTag(x, 'sui')))
      sp(battle, unit, ally, lineParam(unit, 1, 'c', 1), 'bazaarLine', 'bazaar:chyue-sui', cause);
  }),
  // 当你的叙拉古干员击倒敌人时，为此干员充能 c。
  char_4037_demetr: tagKillCharge('siracusa', 1, 'demetr-siracusa', 0.5),
  // 当敌人获得寒冷或冻结时，为此干员充能 0.5（每场战斗前 10 次）。
  char_172_svrash: coldCharge(0.5, 10, 'svrash-cold'),
  // 当你的炎干员施放技能时，加速此干员，持续 1 秒。
  char_4082_qiubai: (battle, unit) => onAllySkill(battle, unit, 'qiubai-yan', (src) => unitTag(src, 'yan'),
    (src, cause) => haste(battle, unit, unit, 1, 'qiubai-yan', { cause })),
  // 当你的深海猎人干员击倒敌人时，本场战斗中 +x% 攻击力（最多 9 层）。
  char_4145_ulpia: (battle, unit) => onAllyKill(battle, unit, 'ulpia-abyssal', (src) => unitTag(src, 'abyssal'),
    (payload, cause) => stackAtk(battle, unit, 'ulpia-abyssal', lineParam(unit, 1, 'x', 0), 9, cause)),
  // 当此干员的技能击倒敌人时，为相邻干员充能 1。
  char_4058_pepe: (battle, unit) => onAllyKill(battle, unit, 'pepe-skill-kill', (src) => src === unit, (payload, cause) => {
    if (payload.sourceClass !== 'skill') return;
    for (const ally of battle.allyUnits.filter((x) => mine(unit, x) && active(x) && adjacent4(x, unit)))
      sp(battle, unit, ally, 1, 'bazaarLine', 'bazaar:pepe-skill-kill', cause);
  }),
  // 当你的喀兰贸易干员施放技能时，为此干员充能 c。
  char_4116_blkkgt: tagSkillCharge('karlan', 1, 'blkkgt-karlan', 1),
  // 当你的罗德岛干员施放技能时，为此干员充能 1。
  char_1026_gvial2: tagSkillCharge('rhodes', 1, 'gvial2-rhodes', 1),
  // 当你的罗德岛干员施放技能时，本场战斗中 +x% 攻击力（最多 10 层）。
  char_350_surtr: (battle, unit) => onAllySkill(battle, unit, 'surtr-rhodes', (src) => unitTag(src, 'rhodes'),
    (src, cause) => stackAtk(battle, unit, 'surtr-rhodes', lineParam(unit, 1, 'x', 0), 10, cause)),
  // 周围的维多利亚干员 +x% 攻击力。
  char_1019_siege2: (battle, unit) => aura(battle, unit, 'siege2-victoria', (ally) => around8(ally, unit) && unitTag(ally, 'victoria'),
    () => ({ atkPct: lineParam(unit, 1, 'x', 0) / 100 })),
  // 当你的乌萨斯干员受到攻击时，为此干员充能 0.5（每场战斗前 10 次）。
  char_188_helage: (battle, unit) => watch(battle, unit, 'damageTaken', 'bazaar:helage-ursus',
    ({ payload }) => payload?.sourceClass === 'attack' && payload.source?.side === 'enemy' && mine(unit, payload.target) && unitTag(payload.target, 'ursus'),
    ({ cause }) => { if (takeCharge(unit, 'helage-ursus', 10)) charge(battle, unit, 0.5, 'helage-ursus', cause); }),
  // 当你的卡西米尔干员部署时，对其相邻敌人造成 a% 真实伤害（模组：伤害 +x%）。
  char_1014_nearl2: (battle, unit) => watch(battle, unit, 'deployed', 'bazaar:nearl2-kazimierz',
    ({ payload }) => mine(unit, payload?.target) && unitTag(payload.target, 'kazimierz'),
    ({ payload, cause }) => {
      const scale = lineParam(unit, 1, 'a', 0) / 100 * (1 + moduleParam(unit, 'uniequip_003_nearl2', 'x', 0) / 100);
      const anchor = payload.target;
      for (const enemy of battle.enemies.filter((e) => e.alive && !e.hidden && enemyAdjacent4(anchor, e)))
        damage(battle, unit, enemy, { scale, type: 'true', isSkill: true, sourceKey: `char_1014_nearl2:bazaar-deploy:${uid(anchor)}`, cause });
    }),
  // 当你的拉特兰干员装填时，为此干员充能 c。
  char_1032_excu2: (battle, unit) => watch(battle, unit, 'reloaded', 'bazaar:excu2-laterano',
    ({ payload }) => mine(unit, payload?.target) && unitTag(payload.target, 'laterano'),
    ({ cause }) => charge(battle, unit, lineParam(unit, 1, 'c', 1), 'excu2-laterano', cause)),
  // 当你的罗德岛干员施放技能时，加速此干员，持续 1 秒。
  char_4010_etlchi: (battle, unit) => onAllySkill(battle, unit, 'etlchi-rhodes', (src) => unitTag(src, 'rhodes'),
    (src, cause) => haste(battle, unit, unit, 1, 'etlchi-rhodes', { cause })),
  // 当你的伊比利亚干员施放技能时，为此干员充能 c。
  char_4232_hbound: tagSkillCharge('iberia', 2, 'hbound-iberia', 3),
  // 当你引发元素爆发时，为此干员充能 c。
  char_4231_clemnt: burstCharge(1, 'clemnt-burst'),
  // 当你的重装干员阻挡敌人时，使其战栗 d 秒。
  char_393_toledo: (battle, unit) => battle.on('blocked', ({ blocker, enemy }) => {
    if (!active(unit) || !mine(unit, blocker) || !unitTag(blocker, 'TANK') || !enemy?.alive) return;
    queue(battle, `bazaar:toledo-tremble:${uid(enemy)}`, enemy, (rt, task) => applyStatus(battle, unit, enemy,
      { status: 'tremble', duration: lineParam(unit, 2, 'd', 2), key: 'char_393_toledo:bazaar-tremble', cause: task.cause }), battle.assaultRuntime.currentCause);
  }, { owner: unit }),
  // 当你的罗德岛干员施放技能时，为此干员充能 c。
  char_1001_amiya2: tagSkillCharge('rhodes', 2, 'amiya2-rhodes', 2),
  // 当你的罗德岛干员施放技能时，治疗生命最低的干员 c% 攻击力。
  char_1037_amiya3: (battle, unit) => onAllySkill(battle, unit, 'amiya3-rhodes', (src) => unitTag(src, 'rhodes'), (src, cause) => {
    const [target] = allies(battle, unit, { scope: 'field', selection: 'lowestHp', count: 1, operatorsOnly: true,
      predicate: (x) => x.ownerId === unit.ownerId });
    if (target) heal(battle, unit, target, { scale: lineParam(unit, 2, 'c', 0) / 100, sourceKey: 'char_1037_amiya3:bazaar-rhodes-heal', cause });
  }),
};

// --- module lines (三星解锁) -------------------------------------------------
// Modules listed here are implemented from the bazaar module line; the old
// translated module delta in assault-modules.js is not installed for them.
const statusOn = (target, status) => !!(target?.findBuff?.(status) || target?.s?.flags?.[status] || target?.statuses?.[status]);
const skillDamage = (moduleId) => (battle, unit) => battle.on('hit', ({ source, dmg }) => {
  if (source !== unit || !dmg?.isSkill || !(dmg.amount > 0)) return;
  dmg.mul = (dmg.mul ?? 1) * (1 + moduleParam(unit, moduleId, 'x', 0) / 100);
}, { owner: unit });
const versusStatus = (moduleId, status, key = 'x') => (battle, unit) => battle.on('hit', ({ source, target, dmg }) => {
  if (source !== unit || !dmg || !(dmg.amount > 0) || target?.side !== 'enemy' || !statusOn(target, status)) return;
  dmg.mul = (dmg.mul ?? 1) * (1 + moduleParam(unit, moduleId, key, 0) / 100);
}, { owner: unit });
// Instant assault casts emit no 'attack' event: the cast itself reports its real
// target count to the after-cast lines (assault.js, fixed-skill cast finally block).
const skillHitsCharge = (moduleId, minHits, key = 'c') => (battle, unit) => {
  (unit.mem.assaultAfterCastLines ??= []).push((ctx) => {
    if (!active(unit) || !(Number(ctx?.hitCount) >= minHits)) return;
    queue(battle, `bazaar:${moduleId}:hits-charge`, unit, (rt, task) => charge(battle, unit, moduleParam(unit, moduleId, key, 0), `${moduleId}:hits`, task.cause),
      ctx.cause ?? battle.assaultRuntime.currentCause);
  });
};
const MODULE_LINES = {
  // 实用的工具：技能伤害 +x%。
  uniequip_002_demetr: skillDamage('uniequip_002_demetr'),
  // 晴雨：技能伤害 +x%。
  uniequip_002_pepe: skillDamage('uniequip_002_pepe'),
  // 佩佩特限证章：技能击倒敌人时，为此干员充能 c。
  uniequip_003_pepe: (battle, unit) => onAllyKill(battle, unit, 'pepe-module-kill', (src) => src === unit, (payload, cause) => {
    if (payload.sourceClass === 'skill') charge(battle, unit, moduleParam(unit, 'uniequip_003_pepe', 'c', 0), 'pepe-module-kill', cause);
  }),
  // 水月特限证章：技能伤害 +x%。
  uniequip_004_mizuki: skillDamage('uniequip_004_mizuki'),
  // 城主的冒险：技能伤害 +x%。
  uniequip_002_siege2: skillDamage('uniequip_002_siege2'),
  // 秩序圣“球”：周围的维多利亚干员受到伤害 -x%。
  uniequip_003_siege2: (battle, unit) => aura(battle, unit, 'siege2-module-guard', (ally) => around8(ally, unit) && unitTag(ally, 'victoria'),
    () => ({ dmgTakenMul: 1 - moduleParam(unit, 'uniequip_003_siege2', 'x', 0) / 100 })),
  // 耀阳锋刃：技能伤害 +x%。
  uniequip_002_nearl2: skillDamage('uniequip_002_nearl2'),
  // 雪浸过的斗笠：对束缚的敌人伤害 +x%。
  uniequip_002_qiubai: versusStatus('uniequip_002_qiubai', 'bind'),
  // 蓝莓与黑巧：对晕眩的敌人伤害 +x%。
  uniequip_002_texas2: versusStatus('uniequip_002_texas2', 'stun'),
  // “新车和新生活”：施放技能后 +x% 攻击力，持续 8 秒。
  uniequip_003_texas2: (battle, unit) => onAllySkill(battle, unit, 'texas2-module-cast', (src) => src === unit, (src, cause) =>
    buff(battle, unit, unit, { key: 'bazaar:texas2-module-cast', mods: { atkPct: moduleParam(unit, 'uniequip_003_texas2', 'x', 0) / 100 }, duration: 8, cause })),
  // “幼狼的牙齿”：对沉默的敌人伤害 +x%。
  uniequip_002_whitew: versusStatus('uniequip_002_whitew', 'silence'),
  // 荒野便携提神剂：对被阻挡的敌人伤害 +x%。
  uniequip_002_ayer: (battle, unit) => battle.on('hit', ({ source, target, dmg }) => {
    if (source !== unit || !dmg || !(dmg.amount > 0) || target?.side !== 'enemy' || target.blockedBy?.side !== 'ally') return;
    dmg.mul = (dmg.mul ?? 1) * (1 + moduleParam(unit, 'uniequip_002_ayer', 'x', 0) / 100);
  }, { owner: unit }),
  // 待解答：技能伤害 +x%（公开文字同步改写）。
  uniequip_002_excu2: skillDamage('uniequip_002_excu2'),
  // 已知悉：本场战斗中每施放 1 次技能 +x% 攻击力（最多 5 层）。
  uniequip_003_excu2: (battle, unit) => onAllySkill(battle, unit, 'excu2-module-cast', (src) => src === unit, (src, cause) =>
    stackAtk(battle, unit, 'excu2-module-cast', moduleParam(unit, 'uniequip_003_excu2', 'x', 0), 5, cause)),
  // “自晦及明”：本场战斗中每施放 1 次技能，技能伤害 +x%（最多 5 层）。
  uniequip_002_chyue: (battle, unit) => {
    onAllySkill(battle, unit, 'chyue-module-cast', (src) => src === unit, () => {
      unit.mem.assaultBazaarChyueCasts = Math.min(5, (unit.mem.assaultBazaarChyueCasts ?? 0) + 1);
    });
    battle.on('hit', ({ source, dmg }) => {
      if (source !== unit || !dmg?.isSkill || !(dmg.amount > 0)) return;
      dmg.mul = (dmg.mul ?? 1) * (1 + (unit.mem.assaultBazaarChyueCasts ?? 0) * moduleParam(unit, 'uniequip_002_chyue', 'x', 0) / 100);
    }, { owner: unit });
  },
  // “自由的代价”：技能命中 2 名敌人时，为此干员充能 c。
  uniequip_002_f12yin: skillHitsCharge('uniequip_002_f12yin', 2),
  // 新合同：技能命中至少 3 名敌人时，为此干员充能 c。
  uniequip_003_blkkgt: skillHitsCharge('uniequip_003_blkkgt', 3),
  // 淡金坠饰：次数上限在 awardGladiaDragSp 读取（每场战斗前 m 次）。
  uniequip_003_glady: () => {},
  // 乌尔比安 003 卡面无战斗效果：不再安装旧的「前路」成长。
  uniequip_003_ulpia: () => {},
  // 嘉维尔的折磨：技能伤害 +x%。
  uniequip_002_gvial2: skillDamage('uniequip_002_gvial2'),
  // 好锯多磨：每阻挡 1 名敌人再 +x%（assault.js 阻挡加成读取）；+1 阻挡。
  uniequip_003_gvial2: (battle, unit) => buff(battle, unit, unit, { key: 'bazaar:gvial2-module-block', mods: { blockCnt: 1 }, persist: true }),
  // 加长鞭刃丝线：技能伤害与护盾 +x%（护盾在 runBuff 读取）。
  uniequip_002_sophia: skillDamage('uniequip_002_sophia'),
  // 萨米的不灭心脏碎片：技能伤害 +x%。
  uniequip_002_surtr: skillDamage('uniequip_002_surtr'),
  // 旧物：替身出现时的伤害 +x%（assault.js 替身伤害读取）。
  uniequip_002_kazema: () => {},
  // 归溟幽灵鲨特限证章：相邻深海猎人干员最大生命加成在光环里读取。
  uniequip_004_ghost2: () => {},
  // 恶地奇异工具套组：拥有护盾时，此干员 +x% 防御力。
  uniequip_002_humus: (battle, unit) => {
    const key = 'bazaar:humus-module-shield-def';
    battle.on('tick', () => {
      const shielded = active(unit) && (unit.buffs ?? []).some((entry) => Number(entry.shield) > 0);
      if (shielded && !unit.findBuff(key)) buff(battle, unit, unit, { key, mods: { defPct: moduleParam(unit, 'uniequip_002_humus', 'x', 0) / 100 }, persist: true });
      else if (!shielded && unit.findBuff(key)) battle.removeBuff(unit, key);
    }, { owner: unit });
  },
  // 百炼嘉维尔特限证章：生命高于 50% 时，此干员 +x% 攻击力。
  uniequip_004_gvial2: (battle, unit) => {
    const key = 'bazaar:gvial2-module-high-hp';
    battle.on('tick', () => {
      const high = active(unit) && unit.hp > unit.s.maxHp * 0.5;
      if (high && !unit.findBuff(key)) buff(battle, unit, unit, { key, mods: { atkPct: moduleParam(unit, 'uniequip_004_gvial2', 'x', 0) / 100 }, persist: true });
      else if (!high && unit.findBuff(key)) battle.removeBuff(unit, key);
    }, { owner: unit });
  },
  // 执政官手镜：被拉拽的敌人受到 a% 法术伤害（awardGladiaDragSp 结算）。
  uniequip_002_glady: () => {},
  // “骑士家族”：卡西米尔干员部署时的伤害 +x%（部署扳机读取），删去首次技能加成。
  uniequip_003_nearl2: () => {},
  // 琳琅诗怀雅特限证章：金币攻击力成长最多层数 +n。
  uniequip_004_swire2: (battle, unit) => { unit.mem.assaultSwireGoldCapBonus = moduleParam(unit, 'uniequip_004_swire2', 'n', 0); },
  // “鞘中人”：卡西米尔干员受击时的真实伤害 +x%（反击倍率读取）。
  uniequip_002_mlynar: () => {},
  // 诗怀雅的龙门美食指南：炸弹伤害 +x%（executeDevice 读取）。
  uniequip_003_swire2: () => {},
  // “唱片”收藏箱：替身持续时间 +t 秒（summonGhostDecoy 读取），删去命中回复。
  uniequip_002_ghost2: () => {},
  // “朔”：技能击倒敌人时改为充能 c（施放结算读取），删去止戈几率。
  uniequip_003_chyue: () => {},
};
export const BAZAAR_MODULES = new Set(Object.keys(MODULE_LINES));

export function installAssaultBazaar(battle, unit, body) {
  if (unit.mem.assaultBazaarInstalled) return;
  unit.mem.assaultBazaarInstalled = true;
  LINES[body.charId]?.(battle, unit, body);
  const moduleId = moduleOf(unit);
  if (moduleId && MODULE_LINES[moduleId]) MODULE_LINES[moduleId](battle, unit, body);
}

export const BAZAAR_LINE_CARDS = Object.freeze(Object.keys(LINES));
