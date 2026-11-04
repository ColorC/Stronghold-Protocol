// Ranged bazaar card lines (2026-10-20 bazaar-style rewrite).
//
// Each handler implements one public card line of
// data/assault-design/bazaar-cards-ranged.json.  Numbers come from the compiled
// `body.bazaar` (lines[i].params / modules[id].params), so the card text and the
// runtime read one source.  Old passives that these lines replace are removed in
// ranged.js / ranged-mid.js / ranged-elite.js (see the `bazaar:` comments there).

import { active, allies, buff, damage, haste, heal, recast, sp, unitTag, uid, v, watch, gainDP } from '../primitives.js';
import { COLS } from '../../../constants.js';

const bodyOfUnit = (unit) => unit.def?.raw?.assaultBody ?? unit.def?.assaultBody;
/** Current-star value of a card-line parameter (percent params stay integer percent). */
export function rangedLine(unit, index, name, fallback = 0) {
  const values = bodyOfUnit(unit)?.bazaar?.lines?.[index]?.params?.[name];
  return values == null ? fallback : Number(v(unit, values));
}
/** Current-star module parameter, or the fallback when that module is not equipped at 3★+. */
export function rangedModule(unit, moduleId, name, fallback = 0) {
  const piece = unit.def?.raw?.assaultPiece ?? unit.input_piece ?? unit.inputPiece;
  const chosen = piece?.moduleId ?? piece?.moduleChoices?.[bodyOfUnit(unit)?.charId];
  if ((piece?.star ?? 0) < 3 || chosen !== moduleId) return fallback;
  const values = bodyOfUnit(unit)?.bazaar?.modules?.[moduleId]?.params?.[name];
  return values == null ? fallback : Number(v(unit, values));
}

const mine = (unit, other) => !!other && other.side === 'ally' && other.kind === 'op' && other.ownerId === unit.ownerId;
const ownedBy = (unit, other) => !!other && other.side === 'ally' && other.ownerId === unit.ownerId;
const tile = (x) => [Number.isFinite(x?.tileR) ? x.tileR : Math.round(x?.y), Number.isFinite(x?.tileC) ? x.tileC : Math.round(x?.x)];
const adjacent4 = (a, b) => { const [ar, ac] = tile(a), [br, bc] = tile(b); return a !== b && Math.abs(ar - br) + Math.abs(ac - bc) === 1; };
const inRange = (unit, other) => { const [r, c] = tile(other); return new Set(unit.rangeKeys ?? []).has(r * COLS + c); };
/** 卡面「停顿」: the native sluggish status and this mode's slow-based 停顿 both count. */
const STOP = Object.freeze(['sluggish', 'slow']);
const profession = (x) => bodyOfUnit(x)?.profession ?? x?.profession;

/** 「每场战斗前 N 次」: one counter per unit and line, reset with the battle unit. */
function takeCharge(unit, name, cap) {
  const counts = unit.mem.rangedBazaarCounts ??= {};
  if ((counts[name] ?? 0) >= cap) return false;
  counts[name] = (counts[name] ?? 0) + 1;
  return true;
}
const charge = (battle, from, to, amount, name, cause) => { if (amount > 0 && active(to)) sp(battle, from, to, amount, 'bazaarLine', `bazaar:${name}`, cause); };
const capped = (unit, name, cap, run) => (...args) => { if (cap == null || takeCharge(unit, name, cap)) run(...args); };

function onAllySkill(battle, unit, name, accept, run) {
  watch(battle, unit, 'skillStart', `bazaar:${name}`, ({ payload }) => mine(unit, payload?.source) && accept(payload.source),
    ({ payload, cause }) => run(payload.source, cause));
}
const onOwnSkill = (battle, unit, name, run) => onAllySkill(battle, unit, name, (src) => src === unit, (src, cause) => run(cause));
function onAllyKill(battle, unit, name, accept, run) {
  watch(battle, unit, 'kill', `bazaar:${name}`, ({ payload }) => payload?.target?.side === 'enemy' && ownedBy(unit, payload.source) && accept(payload.source),
    ({ payload, cause }) => run(payload, cause));
}
function onAllyDeploy(battle, unit, name, accept, run) {
  watch(battle, unit, 'deployed', `bazaar:${name}`, ({ payload }) => mine(unit, payload?.target) && accept(payload.target),
    ({ payload, cause }) => run(payload.target, cause));
}
/** 「当敌人获得 X 时」 (any source) or 「当你施加 X 时」 (yourSide). */
function onEnemyStatus(battle, unit, name, statuses, run, { yourSide = false } = {}) {
  watch(battle, unit, 'statusApplied', `bazaar:${name}`,
    ({ payload }) => payload?.target?.side === 'enemy' && statuses.includes(payload.status) && (!yourSide || ownedBy(unit, payload.source)),
    ({ payload, cause }) => run(payload, cause));
}
function stackAtk(battle, unit, name, pct, maxStacks, cause, target = unit) {
  buff(battle, unit, target, { key: `bazaar:${name}`, mods: { atkPct: pct / 100 }, stacking: 'stack', maxStacks, persist: true, cause });
}
/** Position/type aura refreshed every tick (removed when the recipient leaves). */
function aura(battle, unit, name, select, mods, { tokens = false } = {}) {
  const buffKey = `bazaar:${name}:${uid(unit)}`;
  const eligible = (x) => tokens ? ownedBy(unit, x) && x.kind === 'token' : mine(unit, x);
  const sync = () => {
    const on = new Set(active(unit) ? battle.allyUnits.filter((x) => eligible(x) && active(x) && select(x)) : []);
    for (const x of battle.allyUnits) {
      if (on.has(x)) { if (!x.findBuff?.(buffKey)) buff(battle, unit, x, { key: buffKey, mods: mods(), persist: true }); }
      else if (x.findBuff?.(buffKey)) battle.removeBuff(x, buffKey);
    }
  };
  battle.on('tick', sync, { owner: unit });
  sync();
}
const others = (battle, unit, accept) => battle.allyUnits.filter((x) => mine(unit, x) && x !== unit && active(x) && accept(x));

// --- reusable line shapes -----------------------------------------------------
const tagSkillCharge = (tag, index, name, { cap = null, param = 'c' } = {}) => (battle, unit) => onAllySkill(battle, unit, name, (src) => unitTag(src, tag),
  capped(unit, name, cap, (src, cause) => charge(battle, unit, unit, rangedLine(unit, index, param), name, cause)));
const tagKillCharge = (tag, index, name, { cap = null, param = 'c' } = {}) => (battle, unit) => onAllyKill(battle, unit, name, (src) => unitTag(src, tag),
  capped(unit, name, cap, (payload, cause) => charge(battle, unit, unit, rangedLine(unit, index, param), name, cause)));
const tagDeployCharge = (tag, index, name) => (battle, unit) => onAllyDeploy(battle, unit, name, (x) => unitTag(x, tag),
  (x, cause) => charge(battle, unit, unit, rangedLine(unit, index, 'c'), name, cause));
const adjacentSkillCharge = (index, name, cap) => (battle, unit) => onAllySkill(battle, unit, name, (src) => src !== unit && adjacent4(src, unit),
  capped(unit, name, cap, (src, cause) => charge(battle, unit, unit, rangedLine(unit, index, 'c'), name, cause)));
const statusCharge = (statuses, index, name, cap, { param = 'c', yourSide = false, fixed = null } = {}) => (battle, unit) =>
  onEnemyStatus(battle, unit, name, statuses, capped(unit, name, cap, (payload, cause) => charge(battle, unit, unit, fixed ?? rangedLine(unit, index, param), name, cause)), { yourSide });
const ownSkillHaste = (index, name, accept, param = 't') => (battle, unit) => onOwnSkill(battle, unit, name, (cause) => {
  for (const ally of others(battle, unit, accept)) haste(battle, unit, ally, rangedLine(unit, index, param), name, { cause });
});
const ownSkillChargeOthers = (index, name, accept, param = 'c') => (battle, unit) => onOwnSkill(battle, unit, name, (cause) => {
  for (const ally of others(battle, unit, accept)) charge(battle, unit, ally, rangedLine(unit, index, param), name, cause);
});
const join = (...parts) => (battle, unit, body) => { for (const part of parts) part(battle, unit, body); };

// --- per-card lines -------------------------------------------------------------
const LINES = {
  // ranged.js
  // 当你的卡西米尔干员部署时，获得 g 费用。
  char_4000_jnight: (battle, unit) => onAllyDeploy(battle, unit, 'jnight-kazimierz', (x) => unitTag(x, 'kazimierz'),
    (x, cause) => gainDP(battle, unit, rangedLine(unit, 1, 'g'), 'bazaar:jnight-kazimierz', cause)),
  // 当敌人获得停顿时，为此干员充能 c（每场战斗前 15 次）。
  char_253_greyy: statusCharge(STOP, 1, 'greyy-sluggish', 15),
  // 当攻击范围内友军施放技能时，为此干员充能 c（每场战斗前 10 次）。
  char_4051_akkord: (battle, unit) => onAllySkill(battle, unit, 'akkord-range', (src) => src !== unit && inRange(unit, src),
    capped(unit, 'akkord-range', 10, (src, cause) => charge(battle, unit, unit, rangedLine(unit, 2, 'c'), 'akkord-range', cause))),
  // 当你的干员施加束缚时，为此干员充能 c（每场战斗前 12 次）。
  char_469_indigo: statusCharge(['bind'], 2, 'indigo-bind', 12, { yourSide: true }),
  // 当你的黑钢国际干员获得护盾时，为此干员充能 1（每场战斗前 5 次）。
  char_235_jesica: (battle, unit) => watch(battle, unit, 'shieldGained', 'bazaar:jesica-blacksteel',
    ({ payload }) => mine(unit, payload?.target) && unitTag(payload.target, 'blacksteel'),
    ({ cause }) => { if (takeCharge(unit, 'jesica-blacksteel', 5)) charge(battle, unit, unit, 1, 'jesica-blacksteel', cause); }),
  // 当此干员降低敌人防御时，为相邻干员充能 c。
  char_126_shotst: (battle, unit) => onEnemyStatus(battle, unit, 'shotst-defdown', ['defDown'], (payload, cause) => {
    if (payload.source !== unit) return;
    for (const ally of others(battle, unit, (x) => adjacent4(x, unit))) charge(battle, unit, ally, rangedLine(unit, 1, 'c'), 'shotst-defdown', cause);
  }),
  // 当你的叙拉古干员击倒敌人时，加速此干员，持续 t 秒。
  char_190_clour: (battle, unit) => onAllyKill(battle, unit, 'clour-siracusa', (src) => mine(unit, src) && unitTag(src, 'siracusa'),
    (payload, cause) => haste(battle, unit, unit, rangedLine(unit, 1, 't'), 'clour-siracusa', { cause })),
  // 部署时，加速此干员与相邻干员，持续 t 秒。／当你的哥伦比亚干员部署时，为此干员充能 c。
  char_440_pinecn: join(
    (battle, unit) => onAllyDeploy(battle, unit, 'pinecn-deploy', (x) => x === unit, (x, cause) => {
      for (const ally of [unit, ...others(battle, unit, (o) => adjacent4(o, unit))]) haste(battle, unit, ally, rangedLine(unit, 1, 't'), 'pinecn-deploy', { cause });
    }),
    tagDeployCharge('columbia', 2, 'pinecn-columbia')),
  // 当相邻干员施放技能时，为此干员充能 c（每场战斗前 10 次）。
  char_366_acdrop: adjacentSkillCharge(2, 'acdrop-adjacent', 10),
  // 当你施加停顿时，为此干员充能 a（每场战斗前 20 次）。
  char_183_skgoat: statusCharge(STOP, 1, 'skgoat-sluggish', 20, { param: 'a', yourSide: true }),
  // 当你的哥伦比亚干员部署时，为此干员充能 c。
  char_484_robrta: tagDeployCharge('columbia', 2, 'robrta-columbia'),
  // 当你的卡西米尔干员被攻击时，为此干员充能 c（每场战斗前 10 次）。
  char_204_platnm: (battle, unit) => watch(battle, unit, 'damageTaken', 'bazaar:platnm-kazimierz',
    ({ payload }) => payload?.sourceClass === 'attack' && payload.source?.side === 'enemy' && mine(unit, payload.target) && unitTag(payload.target, 'kazimierz'),
    ({ cause }) => { if (takeCharge(unit, 'platnm-kazimierz', 10)) charge(battle, unit, unit, rangedLine(unit, 2, 'c'), 'platnm-kazimierz', cause); }),
  // 当你的罗德岛干员施放技能时，为此干员充能 c（每场战斗前 10 次）。
  char_1021_kroos2: tagSkillCharge('rhodes', 2, 'kroos2-rhodes', { cap: 10 }),
  // 当你的拉特兰干员装填时，为此干员充能 c（每场战斗前 10 次）。
  char_279_excu: (battle, unit) => watch(battle, unit, 'reloaded', 'bazaar:excu-laterano',
    ({ payload }) => mine(unit, payload?.target) && unitTag(payload.target, 'laterano'),
    ({ cause }) => { if (takeCharge(unit, 'excu-laterano', 10)) charge(battle, unit, unit, rangedLine(unit, 1, 'c'), 'excu-laterano', cause); }),

  // ranged-mid.js
  // 当敌人获得束缚时，为此干员充能 1（每场战斗前 n 次）。
  char_346_aosta: (battle, unit) => onEnemyStatus(battle, unit, 'aosta-bind', ['bind'],
    capped(unit, 'aosta-bind', Math.max(0, Math.round(rangedLine(unit, 2, 'n'))), (payload, cause) => charge(battle, unit, unit, 1, 'aosta-bind', cause))),
  // 当你的罗德岛干员施放技能时，为此干员充能 c（每场战斗前 10 次）。
  char_002_amiya: tagSkillCharge('rhodes', 2, 'amiya-rhodes', { cap: 10 }),
  // 当你的炎干员施放技能时，加速此干员，持续 t 秒（每场战斗前 10 次）。
  char_306_leizi: (battle, unit) => onAllySkill(battle, unit, 'leizi-yan', (src) => unitTag(src, 'yan'),
    capped(unit, 'leizi-yan', 10, (src, cause) => haste(battle, unit, unit, rangedLine(unit, 1, 't'), 'leizi-yan', { cause }))),
  // 当此干员施放技能时，萨尔贡干员每秒治疗最大生命 r%，持续 5 秒。
  char_344_beewax: (battle, unit) => onOwnSkill(battle, unit, 'beewax-sargon', (cause) => {
    const ratio = rangedLine(unit, 2, 'r') / 100;
    for (const ally of [unit, ...others(battle, unit, () => true)].filter((x) => unitTag(x, 'sargon'))) {
      battle.addBuff(ally, { key: `bazaar:beewax-sargon:${uid(unit)}`, duration: 5, refresh: 'replace', source: unit, interval: 1,
        onTick: ({ battle: b }) => { if (active(ally) && ally.hp < ally.s.maxHp) heal(b, unit, ally, { maxHpRatio: ratio, sourceKey: 'char_344_beewax:bazaar-sargon', regen: true }); } });
    }
  }),
  // 当此干员施放技能时，为相邻的术师干员充能 c。
  char_373_lionhd: ownSkillChargeOthersAround(2, 'lionhd-caster', (unit, x) => adjacent4(x, unit) && profession(x) === 'CASTER'),
  // 当此干员施放技能时，加速相邻干员，持续 t 秒。
  char_341_sntlla: ownSkillHasteAround(2, 'sntlla-adjacent', (unit, x) => adjacent4(x, unit)),
  // 当你的叙拉古干员击倒敌人时，为此干员充能 c（每场战斗前 10 次）。
  char_4031_liesel: tagKillCharge('siracusa', 2, 'liesel-siracusa', { cap: 10 }),
  // 当你的维多利亚干员部署时，为此干员充能 c。
  char_388_mint: tagDeployCharge('victoria', 2, 'mint-victoria'),
  // 当敌人获得浮空时，为此干员充能 c（每场战斗前 10 次）。
  char_446_aroma: statusCharge(['levitate'], 2, 'aroma-levitate', 10),
  // 当敌人获得寒冷或冻结时，为此干员充能 c（每场战斗前 12 次）。
  char_4013_kjera: statusCharge(['cold', 'frozen'], 1, 'kjera-cold', 12),
  // 当你的维多利亚干员部署时，为此干员充能 c。
  char_4040_rockr: tagDeployCharge('victoria', 2, 'rockr-victoria'),
  // 当相邻干员施放技能时，为此干员充能 c（每场战斗前 10 次）。
  char_4054_malist: adjacentSkillCharge(2, 'malist-adjacent', 10),
  // 当你的召唤物被回收时，为此干员充能 b。／你的召唤物 +c% 攻击力。
  char_242_otter: join(
    (battle, unit) => watch(battle, unit, 'summonReturned', 'bazaar:otter-return', ({ payload }) => ownedBy(unit, payload?.target),
      ({ cause }) => charge(battle, unit, unit, rangedLine(unit, 1, 'b'), 'otter-return', cause)),
    (battle, unit) => aura(battle, unit, 'otter-summons', () => true, () => ({ atkPct: rangedLine(unit, 2, 'c') / 100 }), { tokens: true })),
  // 当你的叙拉古干员击倒敌人时，为此干员充能 c（每场战斗前 8 次）。
  char_145_prove: tagKillCharge('siracusa', 1, 'prove-siracusa', { cap: 8 }),
  // 当敌人获得寒冷或冻结时，为此干员充能 c（每场战斗前 12 次）。
  char_4211_snhunt: statusCharge(['cold', 'frozen'], 1, 'snhunt-cold', 12),
  // 当你的叙拉古干员击倒敌人时，为此干员充能 b（每场战斗前 10 次）。
  char_254_vodfox: tagKillCharge('siracusa', 1, 'vodfox-siracusa', { cap: 10, param: 'b' }),
  // 攻击范围内的阿戈尔干员 +c% 攻击力。
  char_4079_haini: (battle, unit) => aura(battle, unit, 'haini-egir', (x) => inRange(unit, x) && unitTag(x, 'egir'), () => ({ atkPct: rangedLine(unit, 2, 'c') / 100 })),
  // 当你施加停顿或沉默时，为此干员充能 b（每场战斗前 15 次）。
  char_4032_provs: statusCharge([...STOP, 'silence'], 1, 'provs-status', 15, { param: 'b', yourSide: true }),
  // 当此干员施放技能时，加速相邻的炎干员，持续 t 秒。
  char_4122_grabds: ownSkillHasteAround(1, 'grabds-yan', (unit, x) => adjacent4(x, unit) && unitTag(x, 'yan')),
  // 当你的维多利亚干员部署时，其获得最大生命 c% 的护盾。
  char_4162_cathy: (battle, unit) => onAllyDeploy(battle, unit, 'cathy-victoria', (x) => unitTag(x, 'victoria'), (x, cause) => {
    const amount = x.s.maxHp * rangedLine(unit, 2, 'c') / 100;
    if (amount > 0) battle.addBuff(x, { key: `bazaar:cathy-victoria:${uid(unit)}`, duration: Infinity, refresh: 'replace', source: unit, shield: amount });
  }),
  // 当此干员施放技能时，加速攻击范围内的干员，持续 t 秒。
  char_4045_heidi: ownSkillHasteAround(1, 'heidi-range', (unit, x) => inRange(unit, x)),
  // 当你的炎干员施放技能时，为此干员充能 d（每场战斗前 10 次）。
  char_4019_ncdeer: tagSkillCharge('yan', 2, 'ncdeer-yan', { cap: 10, param: 'd' }),
  // 当你的企鹅物流干员部署时，获得 g 费用。
  char_103_angel: (battle, unit) => onAllyDeploy(battle, unit, 'angel-penguin', (x) => unitTag(x, 'penguin'),
    (x, cause) => gainDP(battle, unit, rangedLine(unit, 1, 'g'), 'bazaar:angel-penguin', cause)),
  // 当此干员施放技能时，加速你的狙击干员，持续 t 秒。
  // 「旧日重现」：持续时间改为模组 t 秒。
  char_332_archet: (battle, unit) => onOwnSkill(battle, unit, 'archet-sniper', (cause) => {
    const seconds = rangedModule(unit, 'uniequip_003_archet', 't', rangedLine(unit, 1, 't'));
    for (const ally of others(battle, unit, (x) => profession(x) === 'SNIPER')) haste(battle, unit, ally, seconds, 'archet-sniper', { cause });
  }),

  // ranged-elite.js
  // 当你的红松骑士团干员闪避时，为此干员充能 1（每场战斗前 10 次）。
  char_430_fartth: (battle, unit) => battle.on('dodge', ({ target }) => {
    if (!active(unit) || !mine(unit, target) || !unitTag(target, 'pinus') || !takeCharge(unit, 'fartth-pinus', 10)) return;
    battle.assaultRuntime.enqueue(() => charge(battle, unit, unit, 1, 'fartth-pinus', battle.assaultRuntime.currentCause), { key: `bazaar:fartth-pinus:${uid(unit)}`, targetUid: uid(unit), sourceUid: uid(unit) });
  }, { owner: unit }),
  // 当相邻术师干员施放技能时，此干员额外施放技能（每场战斗前 10 次）。
  char_391_rosmon: (battle, unit) => onAllySkill(battle, unit, 'rosmon-caster', (src) => src !== unit && adjacent4(src, unit) && profession(src) === 'CASTER',
    capped(unit, 'rosmon-caster', 10, (src, cause) => recast(battle, unit, { cause }))),
  // 当攻击范围内的敌人获得晕眩时，对其造成 b% 物理伤害。
  char_1035_wisdel: (battle, unit) => onEnemyStatus(battle, unit, 'wisdel-stun', ['stun'], (payload, cause) => {
    const target = payload.target;
    if (target?.alive && inRange(unit, target)) damage(battle, unit, target, { scale: rangedLine(unit, 1, 'b') / 100, type: 'phys', sourceKey: 'char_1035_wisdel:bazaar-stun', cause });
  }),
  // 攻击范围内的敌人受到你的狙击干员的物理伤害 +a%。
  char_4117_ray: (battle, unit) => battle.on('hit', ({ source, target, dmg }) => {
    if (!active(unit) || !dmg || dmg.type !== 'phys' || target?.side !== 'enemy' || !mine(unit, source) || profession(source) !== 'SNIPER' || !inRange(unit, target)) return;
    dmg.mul = (dmg.mul ?? 1) * (1 + rangedLine(unit, 1, 'a') / 100);
  }, { owner: unit }),
  // 当此干员施放技能时，加速你的术师干员，持续 t 秒。
  char_213_mostma: (battle, unit) => onOwnSkill(battle, unit, 'mostma-caster', (cause) => {
    const seconds = rangedModule(unit, 'uniequip_003_mostma', 't', rangedLine(unit, 1, 't'));
    for (const ally of others(battle, unit, (x) => profession(x) === 'CASTER')) haste(battle, unit, ally, seconds, 'mostma-caster', { cause });
  }),
  // 当此干员使敌人浮空时，加速相邻干员，持续 t 秒。
  char_4027_heyak: (battle, unit) => onEnemyStatus(battle, unit, 'heyak-levitate', ['levitate'], (payload, cause) => {
    if (payload.source !== unit) return;
    for (const ally of others(battle, unit, (x) => adjacent4(x, unit))) haste(battle, unit, ally, rangedLine(unit, 2, 't'), 'heyak-levitate', { cause });
  }),
  // 当你的罗德岛干员施放技能时，为此干员充能 c（每场战斗前 10 次）。
  char_4133_logos: tagSkillCharge('rhodes', 2, 'logos-rhodes', { cap: 10 }),
  // 当此干员施放技能时，为你的其他岁干员充能 c。
  char_2015_dusk: join(ownSkillChargeOthers(2, 'dusk-sui', (x) => unitTag(x, 'sui')),
    // 夕特限证章：你的召唤物 +a% 攻击力。
    (battle, unit) => { if (rangedModule(unit, 'uniequip_004_dusk', 'a', 0) > 0) aura(battle, unit, 'dusk-summons', () => true, () => ({ atkPct: rangedModule(unit, 'uniequip_004_dusk', 'a', 0) / 100 }), { tokens: true }); }),

  // 当你的萨尔贡干员施放技能时，为此干员充能 c（每场战斗前 10 次）。
  char_472_pasngr: tagSkillCharge('sargon', 2, 'pasngr-sargon', { cap: 10 }),
  // 当你的干员获得护盾时，为此干员充能 c（每场战斗前 10 次）。
  char_426_billro: (battle, unit) => watch(battle, unit, 'shieldGained', 'bazaar:billro-shield', ({ payload }) => mine(unit, payload?.target),
    ({ cause }) => { if (takeCharge(unit, 'billro-shield', 10)) charge(battle, unit, unit, rangedLine(unit, 1, 'c'), 'billro-shield', cause); }),
  // 当此干员施放技能时，加速你的谢拉格干员，持续 t 秒。
  char_1046_sbell2: ownSkillHaste(2, 'sbell2-kjerag', (x) => unitTag(x, 'kjerag')),
  // 当你的罗德岛干员施放技能时，为此干员充能 c（每场战斗前 10 次）。
  char_1040_blaze2: join(tagSkillCharge('rhodes', 2, 'blaze2-rhodes', { cap: 10 }),
    (battle, unit) => watch(battle, unit, 'redeploy', 'bazaar:blaze2-module', ({ payload }) => payload?.target === unit && rangedModule(unit, 'uniequip_003_blaze2', 'a', 0) > 0,
      ({ cause }) => buff(battle, unit, unit, { key: 'bazaar:blaze2-module', mods: { atkPct: rangedModule(unit, 'uniequip_003_blaze2', 'a', 0) / 100 }, duration: 10, stacking: 'replace', cause }))),
  // 当敌人获得寒冷时，前方干员本场战斗中 +c% 攻击力（最多 10 层）；证章：每层再 +a%。
  char_206_gnosis: (battle, unit) => onEnemyStatus(battle, unit, 'gnosis-front', ['cold'], (payload, cause) => {
    const pct = rangedLine(unit, 2, 'c') + rangedModule(unit, 'uniequip_004_gnosis', 'a', 0);
    for (const ally of allies(battle, unit, { scope: 'front', count: 1, selection: 'uid', operatorsOnly: true, predicate: (x) => mine(unit, x) && x !== unit }))
      stackAtk(battle, unit, `gnosis-front:${uid(unit)}`, pct, 10, cause, ally);
  }),
  // 攻击范围内的干员 +b 攻速。
  char_291_aglina: (battle, unit) => aura(battle, unit, 'aglina-aspd', (x) => inRange(unit, x), () => ({ aspd: rangedLine(unit, 1, 'b') + rangedModule(unit, 'uniequip_003_aglina', 'a', 0) })),
  // 当此干员施放技能时，加速你的辅助干员，持续 s 秒。
  char_358_lisa: ownSkillHaste(1, 'lisa-support', (x) => profession(x) === 'SUPPORT', 's'),
  // 当你施加停顿时，此干员本场战斗中 +1 攻速（最多 m 层）；「探索者的收藏」：最多再 +a 层。
  char_1047_halo2: (battle, unit) => onEnemyStatus(battle, unit, 'halo2-sluggish', STOP, (payload, cause) => {
    const maxStacks = Math.max(1, Math.round(rangedLine(unit, 1, 'm') + rangedModule(unit, 'uniequip_002_halo2', 'a', 0)));
    buff(battle, unit, unit, { key: 'bazaar:halo2-sluggish', mods: { aspd: 1 }, stacking: 'stack', maxStacks, persist: true, cause });
  }, { yourSide: true }),
  // 攻击范围内的深海猎人干员 +c% 攻击力；「新生代」：再 +a%。
  char_1012_skadi2: (battle, unit) => aura(battle, unit, 'skadi2-abyssal', (x) => inRange(unit, x) && unitTag(x, 'abyssal'),
    () => ({ atkPct: (rangedLine(unit, 1, 'c') + rangedModule(unit, 'uniequip_003_skadi2', 'a', 0)) / 100 })),
  // 当你的罗德岛干员施放技能时，为此干员充能 b（每场战斗前 10 次）。
  char_4134_cetsyr: tagSkillCharge('rhodes', 1, 'cetsyr-rhodes', { cap: 10, param: 'b' }),
  // 当此干员施放技能时，为你的其他岁干员充能 c。
  char_2023_ling: ownSkillChargeOthers(2, 'ling-sui', (x) => unitTag(x, 'sui')),
  // 当你引发元素爆发时，为此干员充能 d（每场战斗前 10 次）。
  char_245_cello: (battle, unit) => watch(battle, unit, 'elementBurst', 'bazaar:cello-burst',
    ({ payload }) => ownedBy(unit, payload?.source),
    ({ cause }) => { if (takeCharge(unit, 'cello-burst', 10)) charge(battle, unit, unit, rangedLine(unit, 2, 'd'), 'cello-burst', cause); }),
};

// Selectors that need the caster itself (adjacency / range of this unit).
function ownSkillHasteAround(index, name, accept, param = 't') {
  return (battle, unit) => onOwnSkill(battle, unit, name, (cause) => {
    for (const ally of others(battle, unit, (x) => accept(unit, x))) haste(battle, unit, ally, rangedLine(unit, index, param), name, { cause });
  });
}
function ownSkillChargeOthersAround(index, name, accept, param = 'c') {
  return (battle, unit) => onOwnSkill(battle, unit, name, (cause) => {
    for (const ally of others(battle, unit, (x) => accept(unit, x))) charge(battle, unit, ally, rangedLine(unit, index, param), name, cause);
  });
}

export function installRangedBazaar(battle, unit, body) {
  const install = LINES[body.charId];
  if (!install || unit.mem.rangedBazaarInstalled) return;
  unit.mem.rangedBazaarInstalled = true;
  install(battle, unit, body);
}

export const RANGED_BAZAAR_LINE_CARDS = Object.freeze(Object.keys(LINES));
