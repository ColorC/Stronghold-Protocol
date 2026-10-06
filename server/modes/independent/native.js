// Independent mode uses authored, structured native effects. The original game text is metadata only.
import { tavernFactions as sharedTavernFactions } from '../../../shared/independentRules.js';
const BADGE = Object.freeze({ precision: 'precision', agility: 'agility', vitality: 'vitality', defense: 'defense', assault: 'assault', recovery: 'recovery' });
const ALL_BADGES = Object.freeze(['precision','agility','vitality','defense','assault','recovery','arcane','foresight','miracle','investor','unyielding','harmony','coordination','solitary','mastery']);
const BASE_BADGE_IDS = new Set(ALL_BADGES);
const REPEATABLE_BADGE_FORGES = new Set(['grantEquipment','grantEquipmentByTier','conditionalGrant','forgePerGainedChess','forgePerFundsSpent','forgeBenchCount','forgeBenchPairs','forgeDominantFaction','forgeFactionTierCount','forgeDominantFactionTierCount','forgeFactionTierPair','forgeAdjacent','forgeRowCount']);
const rule = (trigger, behavior, params) => ({ trigger, behavior, params });

// Ordinary/elite quantities are intentionally explicit. This registry is keyed by operator name from
// the approved design input; no description or bb string is interpreted at runtime.
const PREP = Object.freeze({
  角峰: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.vitality, normal: 1, elite: 2 }] })],
  惊蛰: [rule('gain', 'grantEquipmentByTier', { id: BADGE.precision, normalDivisor: 2, eliteDivisor: 1, rounding: 'ceil' })],
  刺玫: [rule('prepEnd', 'conditionalGrant', { outputs: [{ id: BADGE.vitality, normal: 1, elite: 2 }], requiresFactionOnField: '维多利亚' })],
  普罗旺斯: [rule('gain', 'freeRefresh', { normal: 1, elite: 2 })],
  德克萨斯: [rule('sold', 'freeRefresh', { normal: 1, elite: 2 })],
  艾丝黛尔: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.precision, normal: 1, elite: 2 }, { id: 'independent:近战训练记录仪', normal: 1, elite: 2 }] })],
  波登可: [rule('prepEnd', 'forgeDominantFaction', { normal: 1, elite: 2, fallback: 'professionRecipe', worksFromBench: true })],
  格雷伊: [rule('sold', 'deferredFunds', { normal: 1, elite: 2, growth: { step: 1, cap: 3 } })],
  深靛: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.assault, normal: 1, elite: 2 }, { id: 'chess_item_1_05_e_a', normal: 1, elite: 2 }] })],
  野鬃: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.agility, normal: 1, elite: 2 }] })],
  雷蛇: [rule('prepEnd', 'grantEquipment', { outputs: [{ id: BADGE.defense, normal: 1, elite: 2 }], growth: { step: { normal: 1, elite: 2 }, cap: 4 } })],
  赫默: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_11_e_a', normal: 1, elite: 2 }] }), rule('roundStart', 'diversityGrant', { by: 'profession', id: BADGE.vitality, normal: 1, elite: 2 })],
  小满: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_04_e_a', normal: 1, elite: 2 }] }), rule('prepEnd', 'forgePerGainedChess', { id: BADGE.precision, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  洛洛: [rule('gain', 'randomEquipment', { poolId: 'pool_equip_rockr', normal: 1, elite: 2 })],
  蒂比: [rule('gain', 'shopCarry', { id: BADGE.agility, normal: 1, elite: 2, max: { normal: 3, elite: 6 } })],
  调香师: [rule('prepEnd', 'forgeDominantFaction', { normal: 2, elite: 4, fallback: 'professionRecipe', worksFromBench: true }), rule('prepEnd', 'grantEquipment', { outputs: [{ id: 'harmony', normal: 2, elite: 4 }], worksFromBench: true })],
  拉普兰德: [rule('refresh', 'attachShopBadgeFirstRefresh', { id: BADGE.assault, normal: 1, elite: 2, firstOnly: true, worksFromBench: true })],
  折桠: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_06_e_a', normal: 1, elite: 2 }] }), rule('prepEnd', 'grantEquipment', { outputs: [{ id: BADGE.defense, normal: 2, elite: 4 }] }), rule('selling', 'sellTransfer', {})],
  灰毫: [rule('gain', 'forgeDominantFaction', { normal: 1, elite: 2 })],
  能天使: [rule('gain', 'deferredFunds', { normal: 1, elite: 2, totalBonus: { counter: 'refreshes', per: 8, step: 1 } })],
  断崖: [rule('prepEnd', 'forgeAdjacent', { id: BADGE.recovery, normal: 1, elite: 2, direction: 'behind', targets: ['self', 'ally'], capNormal: 2, capElite: 4 })],
  诗怀雅: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_1_03_e_a', normal: 1, elite: 2 }] }), rule('prepEnd', 'diversityGrant', { by: 'faction', id: BADGE.precision, normal: 1, elite: 2 })],
  琳琅诗怀雅: [rule('prepEnd', 'deferredFundsIf', { normal: 1, elite: 2, requiresFactionOnField: '炎' })],
  薄绿: [rule('prepEnd', 'forgeFactionTierCount', { faction: '维多利亚', id: BADGE.precision, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  松果: [rule('sold', 'recruitOffer', { normalTier: 1, eliteTier: 5 })],
  雪猎: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.agility, normal: 2, elite: 4 }, { id: 'chess_item_3_02_e_a', normal: 1, elite: 2 }] })],
  至简: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_03_e_a', normal: 1, elite: 2 }] }), rule('gain', 'freeRefreshOnce', { normal: 2, elite: 2, paidOnly: true, expires: 'prepEnd' })],
  蛇屠箱: [rule('prepEnd', 'forgeRowCount', { id: BADGE.defense, normal: 1, elite: 2, capNormal: 4, capElite: 8 }), rule('prepEnd', 'forgeRowCount', { id: 'coordination', normal: 1, elite: 2, capNormal: 4, capElite: 8 })],
  忍冬: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.precision, normal: 2, elite: 4 }, { id: BADGE.agility, normal: 1, elite: 2 }, { id: 'chess_item_3_01_e_a', normal: 1, elite: 2 }] })],
  耶拉: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_5_02_e_a', normal: 1, elite: 2 }] })],
  // the original rule stays first: 白面鸮 copies the first 休整期开始 rule
  空弦: [rule('roundStart', 'forgeAdjacent', { id: BADGE.agility, normal: 1, elite: 2, direction: 'front', targets: ['self', 'ally'], capNormal: 2, capElite: 4 }), rule('roundStart', 'grantEquipment', { outputs: [{ id: 'miracle', normal: 1, elite: 2 }] })],
  伊内丝: [rule('prepEnd', 'badgeBoost', { badgeIds: [BADGE.precision], percent: { normal: 0.05, elite: 0.1 }, max: { normal: 0.6, elite: 1.2 } }), rule('prepEnd', 'grantEquipment', { outputs: [{ id: 'foresight', normal: 2, elite: 4 }] })],
  阿罗玛: [rule('prepEnd', 'shopCarry', { id: BADGE.assault, normal: 1, elite: 2, max: { normal: 4, elite: 8 } })],
  凯瑟琳: [rule('roundStart', 'randomUnlockedEquipment', { normal: 1, elite: 2, oddRoundsOnly: true })],
  歌蕾蒂娅: [rule('roundStart', 'conditionalRecruit', { condition: 'sameRowCount>=3', choices: ['chess_char_5_04_a', 'chess_char_2_07_a', 'chess_char_1_04_a'], normal: 1, elite: 2 })],
  灵知: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.assault, normal: 2, elite: 4 }, { id: 'chess_item_3_08_e_a', normal: 1, elite: 2 }] })],
  莱恩哈特: [rule('prepEnd', 'grantEquipment', { outputs: [{ id: BADGE.precision, normal: 2, elite: 4 }, { id: 'arcane', normal: 2, elite: 4 }] })],
  缄默德克萨斯: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_04_e_a', normal: 1, elite: 2 }] }), rule('roundStart', 'freeRefresh', { normal: 1, elite: 2 })],
  星熊: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.defense, normal: 3, elite: 6 }, { id: 'chess_item_4_05_e_a', normal: 1, elite: 2 }] })],
  泥岩: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_5_07_e_a', normal: 1, elite: 2 }] }), rule('sold', 'deferredFunds', { normal: 2, elite: 4 }), rule('aura', 'triggerMultiplier', { hook: 'sold', extra: { normal: 1, elite: 2 } })],
  焰尾: [rule('gain', 'randomChessOffer', { normal: 1, elite: 2, poolId: 'pool_char_pinus' })],
  白面鸮: [rule('prepEnd', 'replayAdjacentNative', { sourceTrigger: 'gain', allow: ['grantEquipment', 'grantEquipmentByTier', 'randomEquipment', 'randomSupply', 'deferredFunds', 'freeRefresh'], neverReenter: true, normalRange: 1, eliteRange: 2 })],
  卡涅利安: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_05_e_a', normal: 1, elite: 2 }] })],
  烛煌: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.precision, normal: 2, elite: 4 }, { id: BADGE.vitality, normal: 2, elite: 4 }, { id: 'chess_item_6_05_e_a', normal: 1, elite: 2 }] }), rule('prepEnd', 'perEliteGrant', { id: BADGE.precision, normal: 2, elite: 4 })],
  号角: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_10_e_a', normal: 1, elite: 2 }] }), rule('prepEnd', 'forgeDominantFactionTierCount', { id: BADGE.defense, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  铃兰: [rule('aura', 'triggerMultiplier', { hook: 'gain', extra: { normal: 1, elite: 2 } })],
  塞雷娅: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_5_03_e_a', normal: 1, elite: 2 }] }), rule('aura', 'triggerMultiplier', { hook: 'prepEnd', extra: { normal: 1, elite: 2 } })],
  夕: [rule('prepEnd', 'grantByTotal', { counter: 'gained', per: 3, outputs: [{ id: BADGE.assault, normal: 1, elite: 2 }], cap: { normal: 10, elite: 20 } })],
  引星棘刺: [rule('prepEnd', 'doubleWorn', { target: 'front', cap: { normal: 6, elite: 12 }, perGame: { normal: 3, elite: 4 } })],
  山: [rule('prepEnd', 'devourShop', { id: BADGE.vitality, normal: 1, elite: 2 })],
  安洁莉娜: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_5_01_e_a', normal: 1, elite: 2 }] }), rule('prepEnd', 'attachShopByRefreshCount', { id: BADGE.assault, normal: 2, elite: 4, capNormal: 6, capElite: 12 })],
  寒檀: [rule('roundStart', 'escalatingGrant', { id: BADGE.recovery, start: { normal: 1, elite: 2 }, max: { normal: 16, elite: 32 } })],
  妮芙: [rule('prepEnd', 'forgeBenchPairs', { id: BADGE.agility, normal: 1, elite: 2, pairSize: 2, capNormal: 4, capElite: 8 })],
  录武官: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.precision, normal: 3, elite: 6 }, { id: BADGE.vitality, normal: 1, elite: 2 }, { id: 'chess_item_6_03_e_a', normal: 1, elite: 2 }] })],
  余: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_08_e_a', normal: 1, elite: 2 }] }), rule('roundStart', 'dominantFactionRecruit', { normalRequires: 'sameRowCount>=3', eliteRequires: null })],
  佩佩: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:增压臂铠', normal: 1, elite: 2 }] }), rule('roundStart', 'randomSupply', { normal: 1, elite: 2, poolId: 'pool_equip_pepe' })],
  维娜·维多利亚: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:熔铸模具', normal: 1, elite: 2 }] }), rule('prepEnd', 'forgeFactionTierPair', { faction: '维多利亚', ids: [BADGE.precision, BADGE.vitality], normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  缪尔赛思: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_identity_gear', normal: 1, elite: 2 }] })],
  新约能天使: [rule('gain', 'randomEquipment', { ids: ['chess_item_2_02_e_a', 'chess_item_2_05_e_a', 'chess_item_2_06_e_a', 'chess_item_2_07_e_a', 'chess_item_3_12_e_a', 'chess_item_4_01_e_a', 'chess_item_5_05_e_a', 'chess_item_5_06_e_a'], normal: 1, elite: 2 }), rule('gain', 'deferredFunds', { normal: 2, elite: 4 })],
  流明: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:医疗部稳态仪', normal: 1, elite: 2 }] }), rule('prepEnd', 'forgeBenchCount', { id: BADGE.vitality, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  溯光星源: [rule('prepEnd', 'forgePerFundsSpent', { id: BADGE.recovery, spendPer: 3, normal: 1, elite: 2, capNormal: 6, capElite: 12 }), rule('prepEnd', 'forgePerFundsSpent', { id: 'investor', spendPer: 3, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  锏: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.agility, normal: 3, elite: 6 }] }), rule('bought', 'buyGear', { id: BADGE.agility, start: { normal: 1, elite: 2 }, step: { normal: 1, elite: 2 }, max: { normal: 5, elite: 10 } })],
  风丸: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_2_01_e_a', normal: 1, elite: 2 }] }), rule('merge', 'twoCopyElite', { copiesRequired: 2, retainsNativeTrait: true })],
  // 2026-10-06 gear lines: operators whose original trait is combat-only, and who now also bring a piece of gear
  斯卡蒂: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_07_e_a', normal: 1, elite: 2 }] })],
  乌尔比安: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_04_e_a', normal: 1, elite: 2 }] })],
  伺夜: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_11_e_a', normal: 1, elite: 2 }] })],
  荒芜拉普兰德: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_11_e_a', normal: 1, elite: 2 }] })],
  信仰搅拌机: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_02_e_a', normal: 1, elite: 2 }] })],
  银灰: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_03_e_a', normal: 1, elite: 2 }] })],
  华法琳: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_06_e_a', normal: 1, elite: 2 }] })],
  远牙: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_07_e_a', normal: 1, elite: 2 }] })],
  玛恩纳: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_10_e_a', normal: 1, elite: 2 }] })],
  瑕光: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_5_09_e_a', normal: 1, elite: 2 }] })],
  耀骑士临光: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_01_e_a', normal: 1, elite: 2 }] })],
  送葬人: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:拉特兰调速器', normal: 1, elite: 2 }] })],
  莫斯提马: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_08_e_a', normal: 1, elite: 2 }] })],
  蕾缪安: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_02_e_a', normal: 1, elite: 2 }] })],
  风笛: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:维多利亚校准砧', normal: 1, elite: 2 }] })],
  圣聆初雪: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_06_e_a', normal: 1, elite: 2 }] })],
  莎草: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_2_04_e_a', normal: 1, elite: 2 }] })],
  异客: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_07_e_a', normal: 1, elite: 2 }] })],
  史尔特尔: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_12_e_a', normal: 1, elite: 2 }] })],
  纯烬艾雅法拉: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:医疗部蓄能电容', normal: 1, elite: 2 }] })],
});

const combatBadge = (ids, every, stats, extra = {}) => rule('passive', 'badgeThresholdStat', { badgeIds: ids, every, stats, ...extra });
const combatStatic = (stats) => rule('passive', 'staticStats', { stats });
const combatEvent = (trigger, id, quantity, cap, filter = { actor: 'self' }, every = 1, extra = {}) => rule(trigger, 'eventProduction', {
  counterEvent: trigger, counterEvery: every, outputs: [{ id, quantity }], maxPerBattle: cap, filter, ...extra,
});
function combatRules(name, elite) {
  const q = (n, e) => elite ? e : n;
  const flat = (...r) => r;
  const badgeScale = (ids, every, stats) => combatBadge(ids, every, Object.fromEntries(Object.entries(stats).map(([k, [n, e]]) => [k, q(n, e)])));
  const staticScale = (stats) => combatStatic(Object.fromEntries(Object.entries(stats).map(([k, [n, e]]) => [k, q(n, e)])));
  const eventScale = (trigger, id, normalQ, eliteQ, normalCap, eliteCap, filter, every = 1, extra = {}) => combatEvent(trigger, id, q(normalQ, eliteQ), q(normalCap, eliteCap), filter, every, extra);
  switch (name) {
    case '隐现': case '焰影苇草': return [badgeScale(['agility'],5,{attackSpeedFlat:[1,2]})];
    case '哈洛德': case '迷迭香': return [staticScale({attackPercent:[0.2,0.4],maxHpPercent:[0.2,0.4]}),badgeScale(ALL_BADGES,5,{attackPercent:[0.01,0.02],maxHpPercent:[0.01,0.02]})];
    case '泡泡': case '信仰搅拌机': return [badgeScale(['vitality','defense'],5,{defensePercent:[0.02,0.04]})];
    case '水月': return [badgeScale(['precision','assault'],5,{attackPercent:[0.01,0.02]})];
    case '乌尔比安': return [badgeScale(['precision','assault'],4,{attackPercent:[0.01,0.02]})];
    case '隐德来希': return [badgeScale(ALL_BADGES,5,{attackPercent:[0.01,0.02],maxHpPercent:[0.01,0.02]})];
    case '圣聆初雪': return [badgeScale(['precision','assault','recovery'],5,{attackPercent:[0.01,0.02]})];
    case '浊心斯卡蒂': return [badgeScale(ALL_BADGES,10,{hpRecoveryPerSecond:[50,100],spRecoveryPerSecond:[0.15,0.3]})];
    case '异客': return [badgeScale(['precision','assault','agility'],5,{attackPercent:[0.02,0.04]})];
    case '深巡': return [rule('hit','conditionalDamage',{targetTag:'seaMonster',multiplier:q(1.5,2),condition:'targetHasTag'})];
    case '跃跃': return [rule('hit','conditionalDamage',{targetTag:'drone',multiplier:q(1.5,2),condition:'targetHasTag'})];
    case '仇白': return [rule('hit','conditionalDamage',{targetTag:null,multiplier:1,condition:'boundOrSluggish',badgeIds:['precision','assault'],every:5,bonusPercent:q(0.01,0.02)})];
    case '宴': return [rule('hit','weakDamage',{enabled:true})];
    case '流星': return [staticScale({attackPercent:[0.25,0.5],maxHpPercent:[0.25,0.5]}),rule('hit','weakDamage',{enabled:true})];
    case '古米': return [staticScale({spRecoveryPerSecond:[0.15,0.3]})];
    case '锡人': return [staticScale({attackPercent:[0.2,0.4],maxHpPercent:[0.2,0.4]}),rule('passive','staticStats',{factions:['炎','萨尔贡','维多利亚','谢拉格','拉特兰','阿戈尔','叙拉古','卡西米尔'],excludeNativeInheritance:true})];
    case '送葬人': return [eventScale('kill','agility',1,2,1,1,{actor:'self',targetSide:'enemy'},1,{firstOnly:true})];
    case '莎草': return [eventScale('skillStart','recovery',1,2,1,1,{actor:'self'},1,{firstOnly:true})];
    case '幽灵鲨': return [eventScale('death','vitality',1,2,1,1,{actor:'self'},1,{firstOnly:true}),eventScale('death','unyielding',1,2,1,1,{actor:'self'},1,{firstOnly:true})];
    case '休谟斯': return [eventScale('kill','precision',1,2,null,null,{actor:'self',targetSide:'enemy'},2)];
    case '砾': return [eventScale('death','defense',1,2,null,null,{actor:'team'}),eventScale('death','solitary',1,2,null,null,{actor:'team'})];
    case '斯卡蒂': return [eventScale('kill','vitality',1,2,4,8,{actor:'self',targetSide:'enemy'},2),eventScale('kill','mastery',1,2,4,8,{actor:'self',targetSide:'enemy'},2)];
    case '菲莱': return [eventScale('skillStart','recovery',1,2,null,null,{actor:'team'},3)];
    case '海霓': return [eventScale('kill','assault',1,2,1,1,{actor:'self',targetSide:'any'},1,{firstOnly:true})];
    case '瑕光': return [eventScale('deploy','vitality',1,2,3,6,{actor:'self'})];
    case '初雪': case '银灰': return [eventScale('statusApplied','assault',1,2,4,8,{targetSide:'enemy',status:'frozen',entered:true,range:'attacker'},1,{probability:0.5})];
    case '伺夜': return [eventScale('kill','assault',1,2,null,null,{actor:'team',targetSide:'enemy'},6)];
    case '莫斯提马': return [eventScale('ammoUsed','recovery',1,2,6,12,{actor:'adjacentAllies',ammoOnly:true},6)];
    case '寒芒克洛丝': return [eventScale('skillStart','precision',1,2,4,8,{actor:'adjacentAllies',excludeSelf:true,direction:'front'})];
    case '风笛': return [eventScale('kill','agility',1,2,3,6,{actor:'self',targetSide:'enemy'},1,{firstN:3})];
    case '史尔特尔': return [eventScale('deploy','precision',2,4,6,12,{actor:'self'})];
    case '远牙': return [eventScale('deploy','agility',1,2,6,12,{actor:'sameRowRightmost'})];
    case '百炼嘉维尔': return [eventScale('skillStart','vitality',2,4,6,12,{actor:'self'})];
    case '华法琳': return [eventScale('skillStart','vitality',1,2,4,8,{actor:'adjacentAllies',direction:'front'})];
    case '圣约送葬人': return [rule('ammoUsed','eventProduction',{counterEvent:'ammoUsed',counterEvery:7,outputs:[{id:'agility',quantity:q(1,2)},{id:'recovery',quantity:q(1,2)}],maxPerBattle:q(7,14),filter:{actor:'self',ammoOnly:true},capPerOutput:q(7,14)})];
    case '缇缇': return [eventScale('statusApplied','recovery',1,2,6,12,{targetSide:'any',status:['sleep','stun'],entered:true,range:'attacker'})];
    case '归溟幽灵鲨': return [eventScale('death','vitality',1,2,4,8,{actor:'self'},1,{firstOnly:true}),eventScale('dollSwap','vitality',1,2,4,8,{actor:'self'})];
    case '凛御银灰': return [eventScale('statusApplied','assault',1,2,6,12,{observer:'frontAlly',observerTag:'谢拉格',targetSide:'enemy',status:'frozen',entered:true,range:'observer'},1,{probability:0.6})];
    case '魔王': return [rule('nativeProduction','eventProduction',{counterEvent:'nativeProduction',counterEvery:1,outputs:[{idFromEvent:true,quantity:q(1,2)}],copyOutputFromEvent:true,quantity:q(1,2),maxPerBattle:q(4,8),filter:{actor:'adjacentAllies',direction:'front',nativeTraitProduction:true,baseBadgeOnly:true,excludeCopy:true},fallbackPreference:'productionBadge',fallback:'firstStableOutput',copied:true})];
    case '蕾缪安': return [eventScale('ammoUsed','precision',2,4,8,16,{actor:'self',ammoOnly:true,sameRowCount:3},10)];
    case '塑心': return [rule('passive','productionMultiplier',{extra:q(1,2)})];
    case '荒芜拉普兰德': return [eventScale('kill','assault',1,1,6,12,{actor:elite?'team':'self',targetSide:'enemy',tag:elite?'叙拉古':undefined},1,{perEnemyOnce:elite})];
    case '纯烬艾雅法拉': return [eventScale('skillStart','vitality',1,2,4,8,{actor:'self'})];
    case '锏': return [eventScale('deploy','agility',2,4,6,12,{actor:'self'})];
    case '玛恩纳': return [rule('deploy','deployWindowStats',{badgeIds:ALL_BADGES,every:5,stats:{attackFlat:q(10,20),maxHpFlat:q(50,100)},durationSeconds:100})];
    case '耀骑士临光': return [rule('battleStart','startDerivedStats',{badgeIds:['agility'],every:5,actors:['self','frontAlly'],attackSpeedFlat:q(1,2),redeployTimeReduction:elite?0.03:0.015,maxRedeployTimeReduction:0.3})];
    case '星熊': return [rule('passive','badgeAmplifier',{badgeIds:['defense'],multiplier:q(2,3)})];
    default: return [];
  }
}

export function nativeEffectFor(_chessId, source, isElite = false) {
  const rules = PREP[source?.name] || [];
  const prep = rules.map((r) => ({ trigger: r.trigger, behavior: r.behavior, params: structuredClone(r.params) }));
  for (const r of prep) {
    for (const key of ['normal', 'elite']) if (Object.hasOwn(r.params, key)) {
      r.params.quantity = r.params[isElite ? 'elite' : 'normal'];
      break;
    }
  }
  return { prep, combat: combatRules(source?.name, isElite), unsupported: [] };
}

export function nativeTraitFor(chessId, catalog) {
  const op = catalog?.operators?.[chessId];
  return op?.nativeTrait || null;
}

function suppressed(event) {
  return event?.origin === 'native' || event?.origin === 'equipment' || event?.origin === 'attachment' || event?.replay === true;
}
function countBy(items, field) {
  const result = new Map();
  for (const item of items || []) result.set(item?.[field], (result.get(item?.[field]) || 0) + (item?.quantity || 1));
  return result;
}
function roster(state) { return [...(state?.pieces || [])]; }
function chessIdOf(piece) { return piece?.chessId || piece?.id; }
function isPresent(piece) { return piece && piece.row != null && piece.col != null; }
function output(services, state, id, quantity, piece, extra = {}) {
  const n = Math.max(0, Math.floor(Number(quantity) || 0));
  if (!n || !id) return;
  services.__nativeOutputCapture?.push({ id, quantity: n });
  services.grantEquipment(state, id, n, { origin: 'native', sourceUid: piece?.uid, ...(services.__nativeCopied ? { copied: true } : {}), ...(services.__landOn ? { landOn: services.__landOn } : {}), ...extra });
}
function value(p, isElite) { return Number(p[isElite ? 'elite' : 'normal'] ?? 0); }
// a number that may differ between the normal and the elite form: { normal, elite } or a plain number
function pick(v, isElite) { return v && typeof v === 'object' ? Number(v[isElite ? 'elite' : 'normal'] ?? v.normal ?? 0) : Number(v ?? 0); }
const isEliteForm = (piece) => Boolean(piece?.elite || /_b$/.test(chessIdOf(piece)));
// game-long totals (session.js keeps them in state.totals; a session saved before them reads 0)
function total(state, key) { return Number(state.totals?.[key] || 0); }
/**
 * What a rule adds on top of its listed amount: `growth` (+step for every prep phase the operator began on the field,
 * up to `cap` times; runNativeHook counts them) and `totalBonus` (+step for every `per` of a game-long total).
 */
function bonus(p, piece, state, isElite) {
  let n = 0;
  if (p.growth) n += pick(p.growth.step, isElite) * Math.min(Number(piece?.nativeState?.growth || 0), pick(p.growth.cap, isElite));
  if (p.totalBonus) n += pick(p.totalBonus.step, isElite) * Math.floor(total(state, p.totalBonus.counter) / Number(p.totalBonus.per || 1));
  return n;
}
// the hooks a doubler (an 'aura' rule, behavior triggerMultiplier) repeats: 获得时 / 休整结束时 / 出售时
const DOUBLED_HOOKS = new Set(['gain', 'prepEnd', 'sold']);
/** Extra runs of a hook's effects: the strongest doubler on the field for it (doublers do not stack). */
function extraRuns(state, hook, services) {
  let extra = 0;
  for (const p of roster(state)) {
    if (!isPresent(p)) continue;
    for (const r of traitFor(p, services)?.effect?.prep || []) {
      if (r.trigger === 'aura' && r.behavior === 'triggerMultiplier' && r.params?.hook === hook) extra = Math.max(extra, pick(r.params.extra, isEliteForm(p)));
    }
  }
  return extra;
}
// badges live in catalog.badges (a legacy badge item also in catalog.equipment with mechanism badge)
function isBadge(services, id) { return Boolean(services.catalog?.badges?.[id]) || services.catalog?.equipment?.[id]?.mechanism === 'badge'; }
function wornCount(piece) { return (piece?.equipment || []).reduce((n, x) => n + Number(x.quantity || 1), 0); }
function capacityOf(services) { return Number(services.catalog?.rules?.equipmentCapacity ?? 999); }
function refreshCount(state) { return Number(state.counters?.refreshes ?? state.counters?.activeRefreshes ?? state.counters?.roundRefreshes ?? state.counters?.paidRefreshes ?? 0); }
function traitFor(piece, services) { return nativeTraitFor(chessIdOf(piece), services.catalog); }
function hasRepeatNativeForging(state) {
  return (state.playerEffects || []).some((effect) => effect?.type === 'repeatNativeForging' && (effect.expiresRound == null || effect.expiresRound === state.round));
}
function fire(state, hook, piece, event, services, replay = false, selectedRule = null, sourceRules = null) {
  const trait = traitFor(piece, services);
  const effect = sourceRules || trait?.effect?.prep || [];
  for (const r of effect) {
    if (selectedRule && r !== selectedRule) continue;
    if ((r.trigger !== hook && r.params?.alsoAt !== hook) || (replay && r.behavior === 'replayAdjacentNative')) continue;
    const p = r.params || {}, elite = event.copyRuleElite ?? Boolean(piece.elite || /_b$/.test(chessIdOf(piece)));
    const memo = (piece.nativeState ||= {});
    const ruleKey = `${hook}:${r.behavior}:${JSON.stringify(p)}`;
    const mark = () => (memo[ruleKey] ||= {});
    if (!replay && ['roundStart', 'prepEnd'].includes(hook) && mark().lastRound === state.round) continue;
    if (!replay && ['roundStart', 'prepEnd'].includes(hook)) mark().lastRound = state.round;
    const capturedOutputs = [];
    const ruleServices = Object.create(services);
    ruleServices.__nativeOutputCapture = capturedOutputs;
    ruleServices.__nativeCopied = Boolean(replay || event.replay);
    ruleServices.__landOn = p.landOn || null; // where this rule's badges land (equipment.js landingPiece)
    const runs = 1 + (!replay && !event.replay && r.trigger === hook && DOUBLED_HOOKS.has(hook) ? extraRuns(state, hook, services) : 0);
    for (let run = 0; run < runs; run++) {
    switch (r.behavior) {
      case 'grantEquipment':
        for (const x of p.outputs || []) output(ruleServices, state, x.id, value(x, elite) + bonus(p, piece, state, elite), piece);
        break;
      case 'twoCopyElite':
        if (hook === 'merge' && (event.copiesConsumed || 2) >= p.copiesRequired) event.mergeRequirement = p.copiesRequired;
        break;
      case 'grantEquipmentByTier':
        output(ruleServices, state, p.id, Math.ceil((state.shop?.level || 1) / (elite ? p.eliteDivisor : p.normalDivisor)), piece);
        break;
      case 'conditionalGrant':
        if (roster(state).some((x) => isPresent(x) && hasFaction(x, p.requiresFactionOnField, services))) for (const x of p.outputs || []) output(ruleServices, state, x.id, value(x, elite), piece);
        break;
      case 'freeRefresh':
        state.shop.freeRefreshes = (state.shop.freeRefreshes || 0) + value(p, elite) + bonus(p, piece, state, elite); break;
      case 'freeRefreshOnce':
        if (!p.paidOnly || event.paid === true) {
          piece.nativeState ||= {}; if (!piece.nativeState.freeRefreshGranted) { piece.nativeState.freeRefreshGranted = true; state.shop.freeRefreshes = (state.shop.freeRefreshes || 0) + value(p, elite); }
        }
        break;
      case 'deferredFunds': state.pendingFunds = (state.pendingFunds || 0) + value(p, elite) + bonus(p, piece, state, elite); break;
      case 'deferredFundsIf':
        if (roster(state).some((x) => isPresent(x) && hasFaction(x, p.requiresFactionOnField, services))) state.pendingFunds = (state.pendingFunds || 0) + value(p, elite); break;
      case 'forgePerGainedChess': {
        const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, (state.counters?.gained || 0) * value(p, elite)); output(ruleServices, state, p.id, amount, piece); break;
      }
      case 'forgePerFundsSpent': {
        const spent = state.counters?.spent || 0; const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, Math.floor(spent / p.spendPer) * value(p, elite)); output(ruleServices, state, p.id, amount, piece); break;
      }
      case 'forgeBenchCount': {
        const n = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, (state.pieces || []).filter((x) => !isPresent(x)).length * value(p, elite)); output(ruleServices, state, p.id, n, piece); break;
      }
      case 'forgeBenchPairs': {
        const n = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, Math.floor((state.pieces || []).filter((x) => !isPresent(x)).length / p.pairSize) * value(p, elite)); output(ruleServices, state, p.id, n, piece); break;
      }
      case 'forgeDominantFaction':
        for (const [id, quantity] of dominantRecipe(state, piece, services, p, elite)) output(ruleServices, state, id, quantity, piece);
        break;
      case 'forgeFactionTierCount':
      case 'forgeDominantFactionTierCount':
      case 'forgeFactionTierPair': {
          const faction = r.behavior === 'forgeDominantFactionTierCount' ? dominantFaction(state, services, piece) : p.faction;
        if (r.behavior === 'forgeDominantFactionTierCount' && !faction && hasAnyFaction(state, services)) throw new Error('Dominant faction could not be resolved from the catalog faction order');
        const ranks = roster(state).filter((x) => isPresent(x) && hasFaction(x, faction, services)).map((x) => services.catalog.operators[chessIdOf(x)]?.tier || 0);
        const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, new Set(ranks).size * value(p, elite));
        if (r.behavior === 'forgeFactionTierPair') for (const id of p.ids) output(ruleServices, state, id, amount, piece);
        else output(ruleServices, state, p.id, amount, piece);
        break;
      }
      case 'forgeAdjacent': {
        const targets = adjacent(state, piece, p.direction).filter((x) => x === piece || isPresent(x));
        const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, targets.length * value(p, elite));
        output(ruleServices, state, p.id, amount, piece); break;
      }
      case 'forgeRowCount': {
        const n = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, roster(state).filter((x) => isPresent(x) && x.row === piece.row).length * value(p, elite));
        output(ruleServices, state, p.id, n, piece); break;
      }
      case 'attachShopBadgeFirstRefresh':
        if (refreshCount(state) > 0 && !mark().done) { mark().done = true; attachShopEquipment(state, p.id, value(p, elite), piece); }
        break;
      case 'attachShopByRefreshCount': {
        const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, refreshCount(state) * value(p, elite));
        attachShopEquipment(state, p.id, amount, piece, true); break;
      }
      case 'randomEquipment': {
        const pool = p.poolId ? services.catalog.pools?.[p.poolId] : null;
        for (let i = 0; i < value(p, elite); i++) output(ruleServices, state, pool ? choosePool(pool, services, elite) : choose(p.ids, services), 1, piece); break;
      }
      case 'randomUnlockedEquipment': {
        const pool = Object.values(services.catalog.equipment).filter((x) => x.available && x.kind !== 'prizeGear' && x.kind !== 'permit' && (x.shopTier || x.oldTier || x.level || 1) <= (state.shop?.level || 1)).map((x) => x.id);
        for (let i = 0; i < value(p, elite); i++) output(ruleServices, state, choose(pool, services), 1, piece); break;
      }
      case 'recruitOffer':
        {
          const tier = elite ? p.eliteTier || p.normalTier : p.normalTier;
          addRecruitOffer(state, services, { tiers: Number.isInteger(tier) ? [tier] : undefined, tierMax: tier === 'currentShopLevel' ? state.shop?.level : undefined, choices: p.choices || 3, sourceUid: piece.uid, hook });
          break;
        }
      case 'conditionalRecruit':
        if (p.condition !== 'sameRowCount>=3' || roster(state).filter((x) => isPresent(x) && x.row === piece.row).length >= 3) {
          for (let i = 0; i < value(p, elite); i++) {
            const candidate = choose((p.choices || []).filter((id) => hasPoolStock(state, id)), services);
            if (candidate) services.grantChess(state, candidate, { origin: 'native', sourceUid: piece.uid });
          }
        }
        break;
      case 'randomChessOffer': {
        const pool = services.catalog.pools?.[p.poolId];
        for (let i = 0; i < value(p, elite); i++) {
          const candidate = chooseAvailablePool(pool, state, services, elite);
          if (candidate) services.grantChess(state, candidate, { origin: 'native', sourceUid: piece.uid });
        }
        break;
      }
      case 'randomSupply': {
        const pool = services.catalog.pools?.[p.poolId];
        for (let i = 0; i < value(p, elite); i++) output(ruleServices, state, choosePool(pool, services, elite), 1, piece); break;
      }
      case 'dominantFactionRecruit': {
        const needsRow = elite ? p.eliteRequires : p.normalRequires;
        if (!needsRow || roster(state).filter((x) => isPresent(x) && x.row === piece.row).length >= 3) {
          const faction = dominantFaction(state, services, piece);
          if (faction) {
            const pool = Object.values(services.data?.chess || {}).filter((x) => x.chessId?.endsWith('_a') && x.visible !== false && hasPoolStock(state, x.chessId) && (x.bonds || []).some((b) => (services.data?.bonds?.[b]?.name || b) === faction));
            const pick = choose(pool, services);
            if (pick) services.grantChess(state, pick.chessId, { origin: 'native', sourceUid: piece.uid, ordinary: true });
          }
        }
        break;
      }
      case 'replayAdjacentNative': {
        if (event.replay) break;
        const limit = p.sourceTrigger === 'gain' ? (elite ? p.eliteRange || 2 : p.normalRange || 1) : 1;
        const directions = Array.from({ length: limit }, (_, i) => i + 1).map((distance) => neighborAt(state, piece, 'front', distance)).filter(Boolean);
        for (const source of directions) {
          const sourceRulesForCopy = (traitFor(source, services)?.effect?.prep || []).filter((other) => other.trigger === p.sourceTrigger && p.allow.includes(other.behavior));
          const target = sourceRulesForCopy[0];
          if (!target) continue;
          // The copied effect executes as the copier; copied dispatch/replay rules are excluded.
          const sourceElite = Boolean(source.elite || /_b$/.test(chessIdOf(source)));
          fire(state, p.sourceTrigger, piece, { ...event, replay: true, replayTarget: piece, sourceUid: piece.uid, copyRuleElite: sourceElite }, services, true, target, [target]);
        }
        break;
      }
      break;
      // ---- second wave (2026-10-07): growth, doublers, totals, shop buffs, badge boosts, moving and doubling badges ----
      case 'triggerMultiplier': break; // an aura: extraRuns reads it
      case 'grantByTotal': {
        const times = Math.floor(total(state, p.counter) / Number(p.per || 1));
        for (const x of p.outputs || []) output(ruleServices, state, x.id, Math.min(pick(p.cap, elite) || Infinity, times * value(x, elite)), piece);
        break;
      }
      case 'shopCarry': {
        // every operator the shop offers from now on carries this many more (the current offers too)
        const effects = (state.playerEffects ||= []);
        let fx = effects.find((x) => x.type === 'shopCarry' && x.id === p.id);
        if (!fx) { fx = { type: 'shopCarry', id: p.id, quantity: 0, max: 0 }; effects.push(fx); }
        fx.max = Math.max(Number(fx.max || 0), pick(p.max, elite));
        const add = Math.max(0, Math.min(value(p, elite), fx.max - fx.quantity));
        if (!add) break;
        fx.quantity += add;
        for (const slot of state.shop?.slots || []) if (slot.kind === 'chess' && !slot.sold) (slot.equipment ||= []).push({ id: p.id, quantity: add, origin: 'shopCarry', sourceUid: piece.uid });
        break;
      }
      case 'badgeBoost': {
        // every listed badge of the team is worth percent more for the rest of the game (sim battle.js reads it)
        const key = (p.badgeIds || []).join(',');
        const effects = (state.playerEffects ||= []);
        let fx = effects.find((x) => x.type === 'badgeBoost' && x.key === key);
        if (!fx) { fx = { type: 'badgeBoost', key, badgeIds: [...(p.badgeIds || [])], percent: 0, max: 0, source: chessIdOf(piece) }; effects.push(fx); }
        fx.max = Math.max(Number(fx.max || 0), pick(p.max, elite));
        fx.percent = Math.min(fx.max, Math.round((Number(fx.percent || 0) + pick(p.percent, elite)) * 1000) / 1000);
        break;
      }
      case 'sellTransfer': {
        // when sold (run before its gear is discarded): its badges go to the operator on the field that wears the most
        const to = roster(state).filter((x) => x !== piece && isPresent(x)).sort((a, b) => wornCount(b) - wornCount(a) || String(a.uid).localeCompare(String(b.uid)))[0];
        if (!to) break;
        let moved = 0;
        for (const item of [...(piece.equipment || [])]) {
          if (!isBadge(services, item.id)) continue;
          const n = Math.min(Number(item.quantity || 1), capacityOf(services) - wornCount(to));
          if (n <= 0) break;
          const stack = to.equipment.find((x) => x.id === item.id && !!x.elite === !!item.elite);
          if (stack) stack.quantity = Number(stack.quantity || 1) + n;
          else to.equipment.push({ uid: `i${state.nextUid++}`, id: item.id, elite: !!item.elite, quantity: n, state: {}, ...(item.sourceId ? { sourceId: item.sourceId } : {}) });
          item.quantity = Number(item.quantity || 1) - n;
          if (item.quantity <= 0) piece.equipment.splice(piece.equipment.indexOf(item), 1);
          moved += n;
        }
        if (moved) services.recordProduction?.(state, { id: 'badges', quantity: moved, origin: 'native', sourceUid: piece.uid, targetUid: to.uid, worn: true });
        break;
      }
      case 'devourShop': {
        // the right-most operator on offer leaves the shop; its carried gear and tier x N of a badge come to the stock
        const slots = state.shop?.slots || [];
        const index = slots.map((x, i) => (x.kind === 'chess' && !x.sold && x.id ? i : -1)).filter((i) => i >= 0).pop();
        if (index == null) break;
        const slot = slots[index];
        for (const c of slot.equipment || []) output(ruleServices, state, c.id, Number(c.quantity || 1), piece, c.elite ? { elite: true } : {});
        output(ruleServices, state, p.id, Number(services.catalog.operators?.[slot.id]?.tier || 1) * value(p, elite), piece);
        slot.sold = true; slot.devoured = true; slot.equipment = [];
        break;
      }
      case 'doubleWorn': {
        // the badge a target wears most of doubles (up to cap more), a limited number of times a game
        const used = Number(memo.doubleUses || 0);
        if (used >= pick(p.perGame, elite)) break;
        const target = p.target === 'front' ? neighborAt(state, piece, 'front', 1) : piece;
        if (!target || !isPresent(target)) break;
        const top = (target.equipment || []).filter((x) => isBadge(services, x.id)).sort((a, b) => Number(b.quantity || 1) - Number(a.quantity || 1) || String(a.id).localeCompare(String(b.id)))[0];
        if (!top) break;
        const add = Math.min(Number(top.quantity || 1), pick(p.cap, elite), capacityOf(services) - wornCount(target));
        if (add <= 0) break;
        top.quantity = Number(top.quantity || 1) + add;
        memo.doubleUses = used + 1;
        services.recordProduction?.(state, { id: top.id, quantity: add, origin: 'native', sourceUid: piece.uid, targetUid: target.uid, worn: true });
        break;
      }
      case 'escalatingGrant': {
        // start, then twice as many each time it fires, up to max
        const k = Number(memo.escalation || 0);
        output(ruleServices, state, p.id, Math.min(pick(p.max, elite), pick(p.start, elite) * 2 ** k), piece);
        memo.escalation = k + 1;
        break;
      }
      case 'perEliteGrant':
        // for every elite operator on the field (掘金者: +3/+3 for each friendly Golden minion)
        output(ruleServices, state, p.id, roster(state).filter((x) => isPresent(x) && isEliteForm(x)).length * value(p, elite), piece); break;
      case 'buyGear': {
        // after you buy an operator: badges straight onto it, one step more every time (煮熟的书: +2/+2 and improve this)
        const target = event.piece;
        if (!target || target === piece) break;
        const k = Number(memo.boughtGear || 0);
        const add = Math.min(pick(p.max, elite), pick(p.start, elite) + pick(p.step, elite) * k, capacityOf(services) - wornCount(target));
        if (add > 0) {
          const stack = (target.equipment ||= []).find((x) => x.id === p.id && !x.elite);
          if (stack) stack.quantity = Number(stack.quantity || 1) + add;
          else target.equipment.push({ uid: `i${state.nextUid++}`, id: p.id, elite: false, quantity: add, state: {} });
          services.recordProduction?.(state, { id: p.id, quantity: add, origin: 'native', sourceUid: piece.uid, targetUid: target.uid, worn: true });
        }
        memo.boughtGear = k + 1;
        break;
      }
      case 'diversityGrant': {
        const present = roster(state).filter(isPresent);
        const kinds = new Set(p.by === 'faction' ? present.flatMap((x) => sharedTavernFactions(x, services.catalog))
          : present.map((x) => { const op = services.catalog.operators?.[chessIdOf(x)]; return op?.profession ?? op?.source?.normalChess?.profession ?? op?.source?.eliteChess?.profession; }).filter(Boolean));
        output(ruleServices, state, p.id, kinds.size * value(p, elite), piece); break;
      }
      default: throw new Error(`Unregistered native behavior: ${r.behavior}`);
    }
    }
    if (hook === 'gain' && r.trigger === 'gain' && REPEATABLE_BADGE_FORGES.has(r.behavior) && hasRepeatNativeForging(state)) {
      for (const item of capturedOutputs) {
        if (!BASE_BADGE_IDS.has(item.id)) continue;
        services.grantEquipment(state, item.id, item.quantity, { origin: 'native', sourceUid: piece?.uid, repeated: true, copied: Boolean(event.replay), repeatSource: 'repeat-inspection-license' });
      }
    }
    services.record?.(state, { type: 'nativeHook', hook, sourceUid: piece?.uid, chessId: chessIdOf(piece), behavior: r.behavior });
  }
}

function hasFaction(piece, faction, services) {
  return sharedTavernFactions(piece, services.catalog).includes(faction);
}

function roll(services) {
  const rng = services.rng;
  if (typeof rng === 'function') return rng();
  if (typeof rng?.next === 'function') return rng.next();
  if (typeof rng?.float === 'function') return rng.float();
  throw new TypeError('Random native effects require services.rng');
}
function choose(items, services) {
  if (!items?.length) return null;
  return items[Math.min(items.length - 1, Math.floor(roll(services) * items.length))];
}
function choosePool(pool, services, elite = false) {
  if (!pool) throw new Error('Missing upstream SharedPool definition for native effect');
  let entries = pool.weighted;
  if (entries && elite && Array.isArray(pool.goldenWeights)) entries = entries.map(([id], i) => [id, pool.goldenWeights[i]]);
  if (!entries) return choose(pool.items, services);
  const total = entries.reduce((n, pair) => n + Number(pair[1] || 0), 0);
  if (total <= 0) throw new Error('SharedPool has no positive weights');
  let pick = roll(services) * total;
  for (const [id, weight] of entries) { pick -= Number(weight || 0); if (pick < 0) return id; }
  return entries.at(-1)[0];
}
function hasPoolStock(state, chessId) {
  return Number(state.pool?.left?.[chessId]?.left || 0) > 0;
}
function chooseAvailablePool(pool, state, services, elite = false) {
  if (!pool) throw new Error('Missing upstream SharedPool definition for native effect');
  const original = pool.weighted;
  if (original) {
    let entries = original;
    if (elite && Array.isArray(pool.goldenWeights)) entries = original.map(([id], i) => [id, pool.goldenWeights[i]]);
    entries = entries.filter(([id]) => hasPoolStock(state, id));
    return entries.length ? choosePool({ ...pool, weighted: entries, goldenWeights: undefined }, services, false) : null;
  }
  const items = (pool.items || []).filter((id) => hasPoolStock(state, id));
  return choose(items, services);
}
function dominantFaction(state, services, piece = null) {
  const counts = new Map();
  for (const p of roster(state).filter(isPresent)) {
    for (const faction of sharedTavernFactions(p, services.catalog)) counts.set(faction, (counts.get(faction) || 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const ties = ranked.filter((x) => x[1] === ranked[0][1]).map(([name]) => name);
  if (ties.length === 1) return ties[0];
  const stableOrder = services.catalog?.config?.tavernFactions || Object.keys(services.catalog?.config?.factionRecipes || {});
  const preference = piece?.nativeState?.preferences?.factionPriority || state.preferences?.factionPriority || state.factionPriority;
  const priority = preference?.length ? preference : stableOrder;
  return priority.find((name) => ties.includes(name)) || stableOrder.find((name) => ties.includes(name)) || null;
}
function hasAnyFaction(state, services) {
  for (const p of roster(state).filter(isPresent)) {
    if (sharedTavernFactions(p, services.catalog).length) return true;
  }
  return false;
}
function dominantRecipe(state, piece, services, params, elite) {
  const faction = dominantFaction(state, services, piece);
  const recipe = services.catalog.config.badgeRecipes?.[faction] || services.catalog.config.factionRecipes?.[faction] || services.catalog.config.badgeRecipes?.default;
  if (Array.isArray(recipe) && recipe.length) {
    piece.nativeState ||= {}; const stateKey = `recipe:${faction}`; const cursor = piece.nativeState[stateKey] || 0;
    const produced = Array.from({ length: value(params, elite) }, (_, i) => recipe[(cursor + i) % recipe.length]);
    piece.nativeState[stateKey] = cursor + produced.length;
    return produced.map((id) => [id, 1]);
  }
  if (recipe && !Array.isArray(recipe)) return Object.entries(recipe).map(([id, n]) => [id, n * value(params, elite)]);
  const profession = services.data?.chess?.[chessIdOf(piece)]?.profession || services.catalog.operators[chessIdOf(piece)]?.source?.normalChess?.profession;
  const fallback = services.catalog.config.professionRecipes?.[profession];
  if (Array.isArray(fallback) && fallback.length) {
    piece.nativeState ||= {}; const stateKey = `professionRecipe:${profession}`; const cursor = piece.nativeState[stateKey] || 0;
    const produced = Array.from({ length: value(params, elite) }, (_, i) => fallback[(cursor + i) % fallback.length]);
    piece.nativeState[stateKey] = cursor + produced.length;
    return produced.map((id) => [id, 1]);
  }
  return Object.entries(fallback || {}).map(([id, n]) => [id, n * value(params, elite)]);
}
function neighborAt(state, piece, direction, distance = 1) {
  if (!piece || piece.row == null || piece.col == null) return null;
  const facing = piece.dir || 'RIGHT';
  const actual = direction === 'behind' ? ({ RIGHT:'LEFT', LEFT:'RIGHT', UP:'DOWN', DOWN:'UP' }[facing] || facing) : direction === 'front' ? facing : direction;
  const offset = ({ RIGHT:[0,1], LEFT:[0,-1], UP:[-1,0], DOWN:[1,0] })[actual] || [0,0];
  const row = piece.row + offset[0] * distance, col = piece.col + offset[1] * distance;
  return roster(state).find((x) => x.row === row && x.col === col) || null;
}
function adjacent(state, piece, direction, distance = 1) {
  return [piece, neighborAt(state, piece, direction, distance)].filter(Boolean);
}
function attachShopEquipment(state, id, quantity, sourcePiece, spread = false) {
  const targets = (state.shop?.slots || []).filter((slot) => slot.kind === 'chess' && !slot.sold);
  const n = Math.max(0, Math.floor(Number(quantity) || 0));
  if (!spread) {
    const slot = targets[0];
    if (slot && n) {
      slot.equipment ||= [];
      slot.equipment.push({ id, quantity: n, origin: 'native', sourceUid: sourcePiece?.uid });
    }
    return;
  }
  for (let i = 0; i < n && targets.length; i++) {
    const slot = targets[i % targets.length];
    slot.equipment ||= [];
    slot.equipment.push({ id, quantity: 1, origin: 'native', sourceUid: sourcePiece?.uid });
  }
}
function addRecruitOffer(state, services, opts) {
  const all = Object.values(services.data?.chess || {}).filter((x) => x.chessId?.endsWith('_a') && x.visible !== false && x.tier != null && hasPoolStock(state, x.chessId) && (!opts.tiers || opts.tiers.includes(x.tier)) && (!opts.tierMax || x.tier <= opts.tierMax) && (!opts.faction || (x.bonds || []).some((b) => (services.data?.bonds?.[b]?.name || b) === opts.faction)));
  const choices = [];
  const pool = [...all];
  for (let i = 0; i < (opts.choices || 3) && pool.length; i++) { const selected = choose(pool, services); choices.push(selected.chessId); pool.splice(pool.indexOf(selected), 1); }
  if (choices.length) services.addOffer(state, { id: `native:${opts.sourceUid}:${state.round}:${state.nextUid++}`, type: 'recruit', choices, source: 'native', sourceUid: opts.sourceUid });
}

/**
 * Gear that acts when the prep phase ends (session.js calls it after the operators' own 休整结束时 effects): an
 * escalatingForge item on an operator on the field gives `start` of its badge, then twice as many each prep phase,
 * up to `max` (the count lives on the item, so it follows the item).
 */
export function runEquipmentPrepEnd(state, services = {}) {
  for (const piece of roster(state)) {
    if (!isPresent(piece)) continue;
    for (const item of piece.equipment || []) {
      const def = services.catalog?.equipment?.[item.id];
      if (def?.mechanism !== 'escalatingForge') continue;
      const p = def.params || {};
      const k = Number(item.state?.escalation || 0);
      const n = Math.min(pick(p.max, !!item.elite), pick(p.start, !!item.elite) * 2 ** k);
      output(services, state, p.id, n, piece, { origin: 'equipment' });
      item.state = { ...(item.state || {}), escalation: k + 1 };
    }
  }
  return state;
}

export function runNativeHook(state, hook, event = {}, services = {}) {
  if (!state || !services.catalog) throw new TypeError('runNativeHook requires state and services.catalog');
  if (suppressed(event)) return state;
  if (!['gain', 'bought', 'selling', 'sold', 'roundStart', 'prepEnd', 'refresh', 'spend', 'merge'].includes(hook)) throw new TypeError(`Unknown native hook: ${hook}`);
  const piece = event.piece || (event.uid && roster(state).find((x) => x.uid === event.uid));
  if (['gain', 'selling', 'sold', 'merge'].includes(hook)) {
    if (piece) fire(state, hook, piece, event, services, Boolean(event.replay));
  } else {
    // a rule that grows (params.growth) counts the prep phases its operator began on the field
    if (hook === 'roundStart') for (const p of roster(state)) {
      if (isPresent(p) && (traitFor(p, services)?.effect?.prep || []).some((r) => r.params?.growth)) { p.nativeState ||= {}; p.nativeState.growth = Number(p.nativeState.growth || 0) + 1; }
    }
    for (const p of roster(state)) {
      const trait = traitFor(p, services);
      const benchAllowed = (trait?.effect?.prep || []).some((r) => r.trigger === hook && r.params?.worksFromBench);
      if (['roundStart', 'prepEnd', 'refresh', 'bought'].includes(hook) && !isPresent(p) && !benchAllowed) continue;
      fire(state, hook, p, event, services);
    }
  }
  return state;
}
