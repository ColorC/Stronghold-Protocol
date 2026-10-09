// Independent mode uses authored, structured native effects. The original game text is metadata only.
import { tavernFactions as sharedTavernFactions, nativeFactions, nativeBodyStats, nativeRecord } from '../../../shared/independentRules.js';
import { validateWarbandRule, WARBAND_BEHAVIORS } from '../../../shared/warbandSchema.js';
import { runFactionReaction } from './warbandPrep.js';
import { darkmoonPrepRulesFor } from './darkmoonPrep.js';
import { addDarkmoonShopGrowth, darkmoonGrowthBadges } from './darkmoonShop.js';
import { darkmoonCombatMetadata, hasDarkmoonDeploymentPayload } from '../../sim/content/independent/darkmoonCombat.js';
const BADGE = Object.freeze({ precision: 'precision', agility: 'agility', vitality: 'vitality', defense: 'defense', assault: 'assault', recovery: 'recovery' });
const ALL_BADGES = Object.freeze(['precision','agility','damage','vitality','defense','assault','recovery','arcane','foresight','miracle','investor','unyielding','harmony','coordination','solitary','mastery']);
const BASE_BADGE_IDS = new Set(ALL_BADGES);
const REPEATABLE_BADGE_FORGES = new Set(['grantEquipment','grantEquipmentByTier','conditionalGrant','forgePerGainedChess','forgePerFundsSpent','forgeBenchCount','forgeBenchPairs','forgeDominantFaction','forgeFactionTierCount','forgeDominantFactionTierCount','forgeFactionTierPair','forgeAdjacent','forgeRowCount']);
const rule = (trigger, behavior, params) => ({ trigger, behavior, params });
const PREP_TRIGGERS = new Set(['aura','gain','bought','selling','sold','roundStart','prepEnd','refresh','spend','merge']);
const COMBAT_TRIGGERS = new Set(['ammoUsed','attack','battleEnd','battleStart','damaged','death','deploy','dodge','dollSwap','elementBurst','heal','hit','kill','nativeProduction','passive','prepEnd','roundStart','skillStart','statusApplied','shieldLayersGained','shieldLayersBroken','shieldLayersThreshold']);
const COUNTER_EVENTS = new Set([...COMBAT_TRIGGERS, 'shieldLayersGained','shieldLayersBroken','shieldLayersThreshold']);
const PREP_BEHAVIORS = new Set(['attachShopBadgeFirstRefresh','attachShopByRefreshCount','badgeBoost','buyGear','conditionalGrant','conditionalRecruit','copyFrontNative','deferredFunds','deferredFundsIf','devourShop','darkmoonAddTribeShopOffer','darkmoonAdjacentGrowth','darkmoonBattlecryFactionGrowth','darkmoonBattlecryTargetGrowth','darkmoonBeastSummonGrowth','darkmoonBoughtTribeTargetGrowth','darkmoonBoughtSelfGrowth','darkmoonElementalTokenOffer','darkmoonEndTurnGrowth','darkmoonLastWarbandRecruit','darkmoonMagneticMerge','darkmoonPlayedFactionCountSelfGrowth','darkmoonPlayedTagSelfGrowth','darkmoonPlayedTribeGrowth','darkmoonPreviousWinSelfGrowth','darkmoonRecruitTribeToHand','darkmoonRosterTribePurchaseFunds','darkmoonShopGrowth','darkmoonSummonSupport','darkmoonTaggedGrowth','darkmoonTransformFromShop','diversityGrant','dominantFactionRecruit','doubleWorn','escalatingGrant','forgeAdjacent','forgeBenchCount','forgeBenchPairs','forgeDominantFaction','forgeDominantFactionTierCount','forgeFactionTierCount','forgeFactionTierPair','forgePerFundsSpent','forgePerGainedChess','forgePerRefresh','forgeRowCount','freeRefresh','freeRefreshOnce','grantByTotal','grantEquipment','grantEquipmentByTier','perEliteGrant','randomChessOffer','randomEquipment','randomSupply','randomUnlockedEquipment','recruitOffer','replayAdjacentNative','sellTransfer','shopCarry','triggerMultiplier','twoCopyElite']);
const COMBAT_BEHAVIORS = new Set(['aura','badgeThresholdStat','battleStartBuff','blockRetaliate','deployBuff','eventProduction','healedBuff','markSpread','onDown','onKillSp','rangeDebuff','shieldAllies','skillStartBuff','staticStats','statusOnHit']);
PREP_BEHAVIORS.add('teamForge');
COMBAT_BEHAVIORS.add('allyConditionStats');
COMBAT_BEHAVIORS.add('badgeAmplifier');
COMBAT_BEHAVIORS.add('firstWaveStrike');
PREP_TRIGGERS.add('allyGain'); PREP_BEHAVIORS.add('factionReaction');
for (const behavior of WARBAND_BEHAVIORS.filter(x => x !== 'factionReaction')) COMBAT_BEHAVIORS.add(behavior);
const PROFESSIONS = new Set(['PIONEER','WARRIOR','TANK','SNIPER','CASTER','MEDIC','SUPPORT','SPECIAL']);
const CONDITION_STATS = new Set(['attackPercent','maxHpPercent','defensePercent','attackSpeedFlat']);
function exactKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((k) => allowed.includes(k));
}
const nonempty = (v) => typeof v === 'string' && v.trim().length > 0;
const positiveInt = (v) => Number.isInteger(v) && v > 0;
/** Shared schema validation also protects synthetic/direct battle catalog consumers. */
export function validateAllyConditionStats(p) {
  const m = p?.match;
  if (!exactKeys(p, ['match','countBy','maxCount','stats']) || !exactKeys(m, ['faction','professions','profession','keywordGear','baseStat','minBaseStatRatioToSelf','minBaseStat'])
      || !['operators','professions','factions'].includes(p.countBy) || !positiveInt(p.maxCount)
      || !exactKeys(p.stats, [...CONDITION_STATS]) || !Object.keys(p.stats).length
      || !Object.values(p.stats).every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
      || (m.faction !== undefined && !nonempty(m.faction)) || (m.keywordGear !== undefined && !nonempty(m.keywordGear))
      || (m.profession !== undefined && !PROFESSIONS.has(m.profession))
      || (m.professions !== undefined && (!Array.isArray(m.professions) || !m.professions.length || !m.professions.every((v) => PROFESSIONS.has(v))))
      || (m.baseStat !== undefined && !['atk','def','maxHp'].includes(m.baseStat))
      || ['minBaseStatRatioToSelf','minBaseStat'].some((k) => m[k] !== undefined && (!m.baseStat || typeof m[k] !== 'number' || !Number.isFinite(m[k]) || m[k] < 0))) {
    throw new Error('BAD_ALLY_CONDITION_STATS');
  }
}
function validateTeamForge(p) {
  const t = p?.targets;
  const validTarget = ['all','adjacent','row'].includes(t) || (typeof t === 'string' && ((t.startsWith('faction:') && nonempty(t.slice(8))) || (t.startsWith('profession:') && PROFESSIONS.has(t.slice(11)))));
  if (!exactKeys(p, ['targets','excludeSelf','count','sort','outputs']) || !validTarget || typeof p.excludeSelf !== 'boolean'
      || !positiveInt(p.count) || !['leastEquipment','highestBaseAttack','highestBaseHp'].includes(p.sort)
      || !Array.isArray(p.outputs) || !p.outputs.length || !p.outputs.every((o) => exactKeys(o, ['id','normal','elite']) && nonempty(o.id) && positiveInt(o.normal) && positiveInt(o.elite))) {
    throw new Error('BAD_TEAM_FORGE');
  }
}
function finiteJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const ok = Array.isArray(value)
    ? value.every((item) => finiteJson(item, seen))
    : Object.getPrototypeOf(value) === Object.prototype && Object.entries(value).every(([key, item]) => !['__proto__','prototype','constructor'].includes(key) && finiteJson(item, seen));
  seen.delete(value);
  return ok;
}
function authoredModeEffects(source, isElite) {
  const all = source?.modeEffects;
  if (!all || typeof all !== 'object' || Array.isArray(all)) throw new Error(`BAD_MODE_EFFECTS:${source?.chessId}`);
  if (source?.sourceRefs?.darkmoon19_2?.id) return { prep:darkmoonPrepRulesFor(source,isElite), combat:[], unsupported:[] };
  const variant = all[isElite ? 'elite' : 'normal'];
  if (!variant || typeof variant !== 'object' || Array.isArray(variant) || !Array.isArray(variant.prep) || !Array.isArray(variant.combat)) throw new Error(`BAD_MODE_EFFECTS_VARIANT:${source?.chessId}:${isElite ? 'elite' : 'normal'}`);
  for (const [kind, rules, triggers, behaviors] of [['prep', variant.prep, PREP_TRIGGERS, PREP_BEHAVIORS], ['combat', variant.combat, COMBAT_TRIGGERS, COMBAT_BEHAVIORS]]) {
    for (const r of rules) {
      if (!r || typeof r !== 'object' || Array.isArray(r) || !triggers.has(r.trigger) || typeof r.behavior !== 'string' || !r.behavior || !finiteJson(r.params) || !r.params || typeof r.params !== 'object' || Array.isArray(r.params)) throw new Error(`BAD_MODE_EFFECT_RULE:${source?.chessId}:${kind}`);
      if (!behaviors.has(r.behavior)) throw new Error(`UNSUPPORTED_MODE_EFFECT_BEHAVIOR:${source?.chessId}:${kind}:${r.behavior}`);
      if (r.trigger === 'allyGain' && r.behavior !== 'factionReaction') throw new Error('BAD_ALLY_GAIN_BEHAVIOR');
      if (WARBAND_BEHAVIORS.includes(r.behavior)) validateWarbandRule(r);
      if (r.behavior==='firstWaveStrike' && (r.trigger!=='battleStart' || !exactKeys(r.params,['atSecond','afterSpawns','atkPct','type']) || !(Number.isFinite(r.params.atkPct)&&r.params.atkPct>0) || !['arts','phys','true'].includes(r.params.type) || !(Number.isFinite(r.params.atSecond)&&r.params.atSecond>=0 || positiveInt(r.params.afterSpawns)))) throw new Error('BAD_FIRST_WAVE_STRIKE');
      if (r.behavior === 'allyConditionStats') {
        if (r.trigger !== 'passive') throw new Error('BAD_ALLY_CONDITION_STATS_TRIGGER');
        validateAllyConditionStats(r.params);
      }
      if (r.behavior === 'teamForge') {
        if (r.trigger !== 'prepEnd') throw new Error('BAD_TEAM_FORGE_TRIGGER');
        validateTeamForge(r.params);
      }
      if (r.behavior === 'eventProduction' && !COUNTER_EVENTS.has(r.params.counterEvent)) throw new Error(`BAD_MODE_EFFECT_COUNTER_EVENT:${source?.chessId}:${kind}:${r.params.counterEvent}`);
    }
  }
  return { prep: [...structuredClone(variant.prep), ...darkmoonPrepRulesFor(source,isElite)], combat: structuredClone(variant.combat), unsupported: [] };
}
// what 铃兰 replays of a 获得时 trait and 泥岩 of a 售出时 one (gear, funds, refreshes, recruits; never another copier)
const GAIN_COPYABLE = Object.freeze(['grantEquipment', 'grantEquipmentByTier', 'randomEquipment', 'randomSupply', 'deferredFunds', 'freeRefresh', 'randomChessOffer']);
const SOLD_COPYABLE = Object.freeze(['deferredFunds', 'freeRefresh', 'recruitOffer']);
// what 白面鸮 / 塞雷娅 never take over from the operator in front: other copiers (no chains)
const COPIERS = new Set(['replayAdjacentNative', 'copyFrontNative']);

// Ordinary/elite quantities are intentionally explicit. This registry is keyed by operator name from
// the approved design input; no description or bb string is interpreted at runtime.
const PREP = Object.freeze({
  角峰: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:谢拉格冰爪', normal: 1, elite: 2 }] }), rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.vitality, normal: 1, elite: 2 }] })],
  惊蛰: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:炎国缚锁', normal: 1, elite: 2 }] }), rule('gain', 'grantEquipmentByTier', { id: BADGE.precision, normalDivisor: 2, eliteDivisor: 1, rounding: 'ceil' })],
  德克萨斯: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:叙拉古狼嚎哨', normal: 1, elite: 2 }] }), rule('sold', 'freeRefresh', { normal: 1, elite: 2 })],
  格雷伊: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_1_05_e_a', normal: 1, elite: 2 }] }), rule('sold', 'deferredFunds', { normal: 1, elite: 2 })],
  琳琅诗怀雅: [rule('prepEnd', 'deferredFundsIf', { normal: 1, elite: 2, requiresFactionOnField: '炎' })],
  薄绿: [rule('prepEnd', 'forgeFactionTierCount', { faction: '维多利亚', id: BADGE.precision, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  松果: [rule('sold', 'recruitOffer', { normalTier: 1, eliteTier: 5 })],
  至简: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_03_e_a', normal: 1, elite: 2 }] }), rule('gain', 'freeRefreshOnce', { normal: 2, elite: 2, paidOnly: true, expires: 'prepEnd' })],
  耶拉: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_5_02_e_a', normal: 1, elite: 2 }] })],
  凯瑟琳: [rule('roundStart', 'randomUnlockedEquipment', { normal: 1, elite: 2, oddRoundsOnly: true })],
  歌蕾蒂娅: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:阿戈尔深潜锚钩', normal: 1, elite: 2 }] }), rule('roundStart', 'conditionalRecruit', { condition: 'sameRowCount>=3', choices: ['chess_char_5_04_a', 'chess_char_2_07_a', 'chess_char_1_04_a'], normal: 1, elite: 2 })],
  缄默德克萨斯: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_04_e_a', normal: 1, elite: 2 }] }), rule('roundStart', 'freeRefresh', { normal: 1, elite: 2 })],
  星熊: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.defense, normal: 3, elite: 6 }, { id: 'chess_item_4_05_e_a', normal: 1, elite: 2 }] })],
  泥岩: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_5_07_e_a', normal: 1, elite: 2 }] }), rule('sold', 'deferredFunds', { normal: 2, elite: 4 }), rule('sold', 'replayAdjacentNative', { sourceTrigger: 'sold', allow: SOLD_COPYABLE, neverReenter: true, normalRange: 1, eliteRange: 2 })],
  // 干员特质 v4 (2026-10-07): the original's 身前一格 copies (白面鸮 进入休整期时, 塞雷娅 休整期结束时, 铃兰 获得时, 泥岩 售出时)
  白面鸮: [rule('roundStart', 'copyFrontNative', { hook: 'roundStart', eliteValues: { normal: false, elite: true } })],
  卡涅利安: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:萨尔贡链雷护符', normal: 1, elite: 2 }] })],
  铃兰: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_01_e_a', normal: 1, elite: 2 }] }), rule('roundStart', 'replayAdjacentNative', { sourceTrigger: 'gain', allow: GAIN_COPYABLE, neverReenter: true, normalRange: 1, eliteRange: 2 })],
  塞雷娅: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_5_03_e_a', normal: 1, elite: 2 }] }), rule('prepEnd', 'copyFrontNative', { hook: 'prepEnd', eliteValues: { normal: false, elite: true } })],
  引星棘刺: [rule('prepEnd', 'forgeAdjacent', { id: BADGE.agility, normal: 1, elite: 2, direction: 'front', each: true })],
  安洁莉娜: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_5_01_e_a', normal: 1, elite: 2 }] }), rule('prepEnd', 'forgePerRefresh', { id: BADGE.agility, normal: 1, elite: 2, capNormal: 3, capElite: 6, landOn: 'front' })],
  余: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_08_e_a', normal: 1, elite: 2 }] }), rule('roundStart', 'dominantFactionRecruit', { normalRequires: 'sameRowCount>=3', eliteRequires: null })],
  维娜·维多利亚: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:熔铸模具', normal: 1, elite: 2 }] }), rule('prepEnd', 'forgeFactionTierPair', { faction: '维多利亚', ids: [BADGE.precision, BADGE.vitality], normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  缪尔赛思: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:莱茵生命浮空发生器', normal: 1, elite: 2 }] }), rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_identity_gear', normal: 1, elite: 2 }] })],
  新约能天使: [rule('gain', 'randomEquipment', { ids: ['chess_item_2_02_e_a', 'chess_item_2_05_e_a', 'chess_item_2_06_e_a', 'chess_item_2_07_e_a', 'chess_item_3_12_e_a', 'chess_item_4_01_e_a', 'chess_item_5_05_e_a', 'chess_item_5_06_e_a'], normal: 1, elite: 2 }), rule('gain', 'deferredFunds', { normal: 2, elite: 4 })],
  溯光星源: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:工程部节拍校准器', normal: 1, elite: 2 }] }), rule('prepEnd', 'forgePerFundsSpent', { id: BADGE.recovery, spendPer: 3, normal: 1, elite: 2, capNormal: 6, capElite: 12 }), rule('prepEnd', 'forgePerFundsSpent', { id: 'investor', spendPer: 3, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  风丸: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_2_01_e_a', normal: 1, elite: 2 }] }), rule('merge', 'twoCopyElite', { copiesRequired: 2, retainsNativeTrait: true })],
  // 2026-10-06 gear lines: operators whose original trait is combat-only, and who now also bring a piece of gear
  乌尔比安: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_04_e_a', normal: 1, elite: 2 }] })],
  蕾缪安: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_02_e_a', normal: 1, elite: 2 }] })],
  风笛: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:维多利亚校准砧', normal: 1, elite: 2 }] })],
  圣聆初雪: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_06_e_a', normal: 1, elite: 2 }] })],
  异客: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_07_e_a', normal: 1, elite: 2 }] })],
  // 干员表 v3 (2026-10-07): rewritten operators (pure fighters have no rule at all)
  刺玫: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:维多利亚荆棘纹章', normal: 1, elite: 2 }] })],
  送葬人: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:拉特兰跳弹模块', normal: 1, elite: 2 }] })],
  小满: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_04_e_a', normal: 1, elite: 2 }] }), rule('prepEnd', 'forgePerGainedChess', { id: BADGE.precision, normal: 1, elite: 2, capNormal: 6, capElite: 12, landOn: 'front' })],
  莎草: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_2_04_e_a', normal: 1, elite: 2 }] })],
  幽灵鲨: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:阿戈尔裂潮重刃', normal: 1, elite: 2 }] })],
  洛洛: [rule('gain', 'randomEquipment', { ids: ['chess_item_2_03_e_a', 'chess_item_3_09_e_a', 'chess_item_4_09_e_a', 'chess_item_3_10_e_a'], normal: 1, elite: 2 })],
  砾: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_11_e_a', normal: 1, elite: 2 }] })],
  调香师: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:莱塔尼亚共鸣音叉', normal: 1, elite: 2 }] }), rule('prepEnd', 'forgeDominantFaction', { normal: 2, elite: 4, fallback: 'professionRecipe', worksFromBench: true, landOn: 'dominantFactionLowest' })],
  折桠: [rule('prepEnd', 'grantEquipment', { outputs: [{ id: BADGE.assault, normal: 1, elite: 2 }] })],
  雪猎: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:谢拉格雪境猎印', normal: 1, elite: 2 }] })],
  瑕光: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_5_09_e_a', normal: 1, elite: 2 }] })],
  流星: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_07_e_a', normal: 1, elite: 2 }] })],
  信仰搅拌机: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_02_e_a', normal: 1, elite: 2 }] })],
  莫斯提马: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_08_e_a', normal: 1, elite: 2 }] })],
  灵知: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_08_e_a', normal: 1, elite: 2 }] })],
  焰尾: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_10_e_a', normal: 1, elite: 2 }] }), rule('gain', 'randomChessOffer', { normal: 1, elite: 2, poolId: 'pool_char_pinus' })],
  华法琳: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:医疗部共生血囊', normal: 1, elite: 2 }] })],
  烛煌: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_05_e_a', normal: 1, elite: 2 }] })],
  归溟幽灵鲨: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_12_e_a', normal: 1, elite: 2 }] })],
  山: [rule('prepEnd', 'forgePerGainedChess', { id: 'mastery', normal: 1, elite: 2, capNormal: 4, capElite: 8, landOn: 'self' })],
  录武官: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_03_e_a', normal: 1, elite: 2 }, { id: 'chess_item_3_04_e_a', normal: 1, elite: 2 }] })],
  佩佩: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:增压臂铠', normal: 1, elite: 2 }] })],
  流明: [rule('prepEnd', 'forgeBenchCount', { id: BADGE.precision, normal: 1, elite: 2, capNormal: 6, capElite: 12, landOn: 'lowest' })],
  耀骑士临光: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_01_e_a', normal: 1, elite: 2 }] })],
  荒芜拉普兰德: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_6_11_e_a', normal: 1, elite: 2 }] })],
  纯烬艾雅法拉: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:医疗部蓄能电容', normal: 1, elite: 2 }] })],
  泡泡: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:萨尔贡流沙符', normal: 1, elite: 2 }] })],
  圣约送葬人: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:拉特兰速射扳机', normal: 1, elite: 2 }] })],
  海霓: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:阿戈尔神经毒棘', normal: 1, elite: 2 }] })],
  灰毫: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:卡西米尔破甲箭簇', normal: 1, elite: 2 }] })],
  阿罗玛: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:叙拉古处决令', normal: 1, elite: 2 }] })],
  夕: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:炎国点睛笔', normal: 1, elite: 2 }] })],
  寒芒克洛丝: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_02_e_a', normal: 1, elite: 2 }] })],
  波登可: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:工程部标定信标', normal: 1, elite: 2 }] })],
  雷蛇: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:黑钢双联弹匣', normal: 1, elite: 2 }] })],
  寒檀: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:萨米凋亡枝', normal: 1, elite: 2 }] })],
  隐德来希: [rule('gain', 'grantEquipment', { outputs: [{ id: 'independent:罗德岛处置预案', normal: 1, elite: 2 }] })],
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
    case '哈洛德': return [staticScale({attackPercent:[0.2,0.4],maxHpPercent:[0.2,0.4]}),badgeScale(ALL_BADGES,5,{attackPercent:[0.01,0.02],maxHpPercent:[0.01,0.02]})];
    case '泡泡': return [badgeScale(['vitality','defense'],5,{defensePercent:[0.02,0.04]})];
    case '水月': return [badgeScale(['precision','assault'],5,{attackPercent:[0.01,0.02]})];
    case '乌尔比安': return [badgeScale(['precision','assault'],4,{attackPercent:[0.01,0.02]})];
    case '圣聆初雪': return [badgeScale(['precision','assault','recovery'],5,{attackPercent:[0.01,0.02]})];
    case '异客': return [badgeScale(['precision','assault','agility'],5,{attackPercent:[0.02,0.04]})];
    case '锡人': return [staticScale({attackPercent:[0.2,0.4],maxHpPercent:[0.2,0.4]}),rule('passive','staticStats',{factions:['炎','萨尔贡','维多利亚','谢拉格','拉特兰','阿戈尔','叙拉古','卡西米尔'],excludeNativeInheritance:true})];
    case '菲莱': return [eventScale('skillStart','recovery',1,2,3,6,{actor:'self'})];
    case '初雪': return [eventScale('statusApplied','assault',1,2,4,8,{targetSide:'enemy',status:'frozen',entered:true,range:'attacker'},1,{probability:0.5})];
    case '风笛': return [eventScale('kill','agility',1,2,3,6,{actor:'self',targetSide:'enemy'},1,{firstN:3})];
    case '圣约送葬人': return [rule('ammoUsed','eventProduction',{counterEvent:'ammoUsed',counterEvery:7,outputs:[{id:'agility',quantity:q(1,2)},{id:'recovery',quantity:q(1,2)}],maxPerBattle:q(7,14),filter:{actor:'self',ammoOnly:true},capPerOutput:q(7,14)})];
    case '魔王': return [rule('nativeProduction','eventProduction',{counterEvent:'nativeProduction',counterEvery:1,outputs:[{idFromEvent:true,quantity:q(1,2)}],copyOutputFromEvent:true,quantity:q(1,2),maxPerBattle:q(4,8),filter:{actor:'adjacentAllies',direction:'front',nativeTraitProduction:true,baseBadgeOnly:true,excludeCopy:true},fallbackPreference:'productionBadge',fallback:'firstStableOutput',copied:true})];
    case '蕾缪安': return [eventScale('ammoUsed','precision',2,4,8,16,{actor:'self',ammoOnly:true,sameRowCount:3},10)];
    // 干员特质 v4 (2026-10-07, 方舟化): a battle event counted, the badge after the battle
    case '雷蛇': return [eventScale('damaged','defense',1,2,3,6,{actor:'target',targetSide:'ally',sourceSide:'enemy'},20)];
    case '折桠': return [eventScale('battleEnd','assault',1,2,null,null,{selfSurvived:true})];
    case '蒂比': return [eventScale('dodge','agility',1,2,3,6,{actor:'target'})];
    case '伊内丝': return [eventScale('statusApplied','precision',1,2,4,8,{actor:'self',status:'bind',targetSide:'enemy'})];
    case '烛煌': return [eventScale('elementBurst','precision',1,2,4,8,{element:'burn',targetSide:'enemy'})];
    case '夕': return [eventScale('kill','assault',1,2,5,10,{actor:'selfOrSummon',targetSide:'enemy'},2)];
    // 自身开启技能时，同一行友方下一次通过特质获得的徽章+1: a skill start arms one extra badge for the row's next trait production
    case '塑心': return [rule('nativeProduction','eventProduction',{counterEvent:'nativeProduction',counterEvery:1,outputs:[],copyOutputFromEvent:true,quantity:1,armedBy:'skillStart',maxPerBattle:q(3,6),filter:{actor:'sameRowAllies',nativeTraitProduction:true,baseBadgeOnly:true,excludeCopy:true}})];
    // 干员表 v3 / 干员特质 v4 (2026-10-07): temporary combat traits (battle.js installTemporaryNativeRules)
    case '星熊': return [rule('hit','blockRetaliate',{condition:'blocking',defPct:q(0.2,0.4),type:'phys'})];
    case '刺玫': return [rule('skillStart','skillStartBuff',{targets:'inRange',only:{faction:'维多利亚'},stats:{damageTakenPct:q(-0.15,-0.3)},duration:'skill'})];
    case '古米': return [rule('deploy','aura',{targets:['self','adjacent'],stats:{spRegen:q(0.15,0.3)}})];
    case '波登可': return [rule('deploy','aura',{targets:'adjacent',stats:{atkPct:q(0.08,0.16)}})];
    case '宴': return [rule('battleStart','battleStartBuff',{targets:q(['self','adjacent'],['self','row']),stats:{},weakDamage:true})];
    case '野鬃': return [rule('deploy','deployBuff',{firstDeployOnly:true,targets:'profession:WARRIOR',stats:{atkPct:q(0.12,0.24)},duration:15})];
    case '赫默': return [rule('heal','healedBuff',{stats:{aspd:q(10,20)},duration:5})];
    case '莎草': return [rule('skillStart','skillStartBuff',{targets:'adjacent',stats:{},spGain:q(1,2)})];
    case '幽灵鲨': return [combatStatic({redeployTimeReduction:q(0.3,0.5)}),rule('deploy','deployBuff',{redeployOnly:true,targets:'self',stats:{atkPct:q(0.2,0.4)},duration:15})];
    case '砾': return [rule('deploy','shieldAllies',{on:'deploy',targets:q('adjacent','row'),count:99,layers:1,excludeSelf:true})];
    case '灰毫': return [rule('hit','statusOnHit',{status:'physFragile',value:q(0.1,0.2),duration:3})];
    case '诗怀雅': return [rule('deploy','aura',{targets:'around8',only:{melee:true},stats:{aspd:q(8,16)}})];
    case '海霓': return [rule('deploy','rangeDebuff',{status:'fragile',value:q(0.08,0.16),only:{eliteOrLeader:true}})];
    case '雪猎': return [rule('skillStart','rangeDebuff',{on:'skillStart',status:'cold',duration:q(2,4)})];
    case '瑕光': return [rule('deploy','deployBuff',{targets:['self','adjacent'],stats:{damageTakenPct:q(-0.15,-0.3)},duration:15})];
    case '蛇屠箱': return [rule('deploy','aura',{targets:'row',stats:{damageTakenPct:q(-0.08,-0.16)}})];
    case '流星': return [rule('hit','statusOnHit',{duringSkill:true,status:'physFragile',value:q(0.15,0.25),duration:5})];
    case '信仰搅拌机': return [rule('deploy','aura',{targets:'inRange',only:{faction:'拉特兰'},stats:{aspd:q(10,20)}})];
    case '莫斯提马': return [rule('deploy','rangeDebuff',{duringSkill:true,status:'artsFragile',value:q(0.1,0.2)})];
    case '寒芒克洛丝': return [rule('statusApplied','statusOnHit',{afterOwnStun:true,status:'physFragile',value:q(0.15,0.3),duration:3})];
    case '阿罗玛': return [rule('deploy','rangeDebuff',{only:{levitate:true},status:'artsFragile',value:q(0.15,0.3)})];
    case '灵知': return [rule('deploy','deployBuff',{firstDeployOnly:true,delay:10,targets:'faction:谢拉格',stats:{atkPct:q(0.15,0.3)},duration:'battle'})];
    case '华法琳': return [rule('skillStart','skillStartBuff',{targets:'front',stats:{atkPct:q(0.2,0.4)},duration:10})];
    case '缇缇': return [rule('deploy','aura',{targets:'inRange',only:{hpAbove:0.5},stats:{aspd:q(10,20)}})];
    case '隐德来希': return [rule('hit','statusOnHit',{status:'artsFragile',value:q(0.1,0.2),duration:5})];
    // 与军事要塞不叠加: 号角's own talent already lifts every 重装 (TANK) operator, so the trait passes them over
    case '号角': return [rule('deploy','aura',{targets:'faction:维多利亚',only:{notProfession:'TANK'},stats:{atkPct:q(0.1,0.2)}})];
    case '归溟幽灵鲨': return [rule('dollSwap','onDown',{on:'dollSwap',blast:{atkPct:q(2.5,5),radius:1.5,type:'phys'},perBattle:2})];
    case '凛御银灰': return [rule('battleStart','battleStartBuff',{targets:'all',stats:{},spGain:q(1,2),perBench:true,maxBench:5})];
    case '寒檀': return [rule('deploy','rangeDebuff',{delay:20,status:'artsFragile',value:q(0.1,0.2)})];
    case '浊心斯卡蒂': return [rule('deploy','aura',{targets:'inRange',only:{faction:'阿戈尔'},stats:{atkPct:q(0.15,0.3)}})];
    case '佩佩': return [rule('kill','onKillSp',{actor:'self',duringSkill:true,targets:'adjacent',sp:q(1,2)})];
    case '焰影苇草': return [rule('death','markSpread',{mark:'reed2:scorch',radius:q(1,1.5)})];
    case '耀骑士临光': return [rule('battleStart','battleStartBuff',{targets:['self','front'],stats:{aspd:q(15,30)}})];
    case '荒芜拉普兰德': return [rule('kill','onKillSp',{actor:'faction:叙拉古',targets:'killer',sp:q(1,2)})];
    case '纯烬艾雅法拉': return [rule('skillStart','skillStartBuff',{targets:'inRange',stats:{atkPct:q(0.12,0.24)},duration:'skill'})];
    default: return [];
  }
}

export function nativeEffectFor(_chessId, source, isElite = false) {
  if (source?.sourceRefs?.darkmoon19_2?.id) return { prep:darkmoonPrepRulesFor(source,isElite), combat:[], unsupported:[] };
  if (Object.hasOwn(source || {}, 'modeEffects')) return authoredModeEffects(source, isElite);
  const rules = PREP[source?.name] || [];
  const prep = [...rules.map((r) => ({ trigger: r.trigger, behavior: r.behavior, params: structuredClone(r.params) })), ...darkmoonPrepRulesFor(source,isElite)];
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
function darkmoonGrowth(state,source,target,attackUnits,secondaryUnits,services) {
  if(!target)return;
  const [attackId,secondaryId]=darkmoonGrowthBadges(target,services.catalog);
  const landing=target.uid===source.uid?'self':`uid:${target.uid}`;
  for(const [id,quantity] of [[attackId,attackUnits],[secondaryId,secondaryUnits]]) {
    const n=Math.max(0,Math.floor(Number(quantity)||0));
    if(n)services.grantEquipment(state,id,n,{origin:'native',sourceUid:source.uid,targetUid:target.uid,landOn:landing});
  }
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
function extraRuns(state, hook, services, event = {}) {
  let extra = 0;
  for (const p of roster(state)) {
    if (!isPresent(p)) continue;
    for (const r of traitFor(p, services)?.effect?.prep || []) {
      if (r.trigger === 'aura' && r.behavior === 'triggerMultiplier' && r.params?.hook === hook) {
        if (r.params.filter === 'darkmoonBattlecry' && !services.catalog?.operators?.[chessIdOf(event.piece)]?.sourceRefs?.darkmoon19_2?.battlecry) continue;
        extra = Math.max(extra, pick(r.params.extra, isEliteForm(p)));
      }
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
    // where this rule's badges land (equipment.js landingPiece); the field's largest faction is the one this rule's recipe reads
    ruleServices.__landOn = p.landOn === 'dominantFactionLowest' ? `faction:${dominantFaction(state, services, piece) || ''}` : (p.landOn || null);
    const runs = 1 + (!replay && !event.replay && r.trigger === hook && DOUBLED_HOOKS.has(hook) ? extraRuns(state, hook, services, event) : 0);
    for (let run = 0; run < runs; run++) {
    switch (r.behavior) {
      case 'factionReaction': runFactionReaction(state,piece,event,r,ruleServices); break;
      case 'darkmoonRosterTribePurchaseFunds': {
        const buyer=event.piece;
        const ref=services.catalog?.operators?.[chessIdOf(buyer)]?.sourceRefs?.darkmoon19_2;
        if(buyer && (buyer.playerId??buyer.ownerId)===(piece.playerId??piece.ownerId) && nativeFactions(buyer,services.catalog).includes(p.faction)) state.funds=Number(state.funds||0)+Number(p.count||0);
        break;
      }
      case 'darkmoonShopGrowth': {
        if(r.trigger==='bought') {
          const buyer=event.piece;
          if(!buyer||(buyer.playerId??buyer.ownerId)!==(piece.playerId??piece.ownerId)||!nativeFactions(buyer,services.catalog).includes(p.faction))break;
        }
        addDarkmoonShopGrowth(state,services.catalog,{sourceId:services.catalog?.operators?.[chessIdOf(piece)]?.sourceRefs?.darkmoon19_2?.id, ...p},Boolean(p.persistent));
        break;
      }
      case 'darkmoonEndTurnGrowth': {
        const owner=piece.playerId??piece.ownerId,allies=roster(state).filter(x=>isPresent(x)&&(x.playerId??x.ownerId)===owner);
        if(p.mode==='selfIfGolden') {
          if(allies.some(x=>x.elite||/_b$/.test(chessIdOf(x))))darkmoonGrowth(state,piece,piece,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
        } else if(p.mode==='selfPerFaction') {
          const n=allies.filter(x=>nativeFactions(x,services.catalog).includes(p.faction)).length;
          darkmoonGrowth(state,piece,piece,n*pick(p.attackPer,elite),n*pick(p.secondaryPer,elite),services);
        } else if(p.mode==='selfPerDistinctFaction') {
          const n=new Set(allies.flatMap(x=>nativeFactions(x,services.catalog))).size;
          darkmoonGrowth(state,piece,piece,n*pick(p.attackPer,elite),n*pick(p.secondaryPer,elite),services);
        } else if(p.mode==='randomEachFaction') {
          const factions=[...new Set(allies.flatMap(x=>nativeFactions(x,services.catalog)))],used=new Set();
          for(const faction of factions) {
            const candidates=allies.filter(x=>!used.has(x.uid)&&nativeFactions(x,services.catalog).includes(faction));
            const target=choose(candidates,services);if(!target)continue;used.add(target.uid);
            darkmoonGrowth(state,piece,target,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
          }
        } else if(p.mode==='randomDistinctFaction') {
          const factions=[...new Set(allies.flatMap(x=>nativeFactions(x,services.catalog)))],used=new Set();
          for(let i=0;i<pick(p.targets,elite);i++) {
            const eligible=factions.filter(f=>!used.has(f)),faction=choose(eligible,services);if(!faction)break;used.add(faction);
            const target=choose(allies.filter(x=>nativeFactions(x,services.catalog).includes(faction)),services);if(target)darkmoonGrowth(state,piece,target,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
          }
        } else if(p.mode==='leftmostPerPurchase') {
          const target=allies.slice().sort((a,b)=>a.col-b.col||a.row-b.row||String(a.uid).localeCompare(String(b.uid)))[0];
          const times=Number(state.counters?.factionBought?.[p.faction]||0);
          if(target&&times)darkmoonGrowth(state,piece,target,times*pick(p.attackPer,elite),times*pick(p.secondaryPer,elite),services);
        } else if(p.mode==='randomOtherFaction') {
          const target=choose(allies.filter(x=>x.uid!==piece.uid&&nativeFactions(x,services.catalog).includes(p.faction)),services);
          if(target)darkmoonGrowth(state,piece,target,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
        } else if(p.mode==='randomOtherFriendly') {
          const target=choose(allies.filter(x=>x.uid!==piece.uid),services);
          if(target)darkmoonGrowth(state,piece,target,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
        }
        break;
      }
      case 'darkmoonBoughtSelfGrowth': {
        const buyer=event.piece;
        if(buyer&&(buyer.playerId??buyer.ownerId)===(piece.playerId??piece.ownerId)&&nativeFactions(buyer,services.catalog).includes(p.faction))
          darkmoonGrowth(state,piece,piece,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
        break;
      }
      case 'darkmoonPlayedTagSelfGrowth': {
        const played=event.piece,source=services.catalog?.operators?.[chessIdOf(played)],ref=source?.sourceRefs?.darkmoon19_2;
        const matches=p.tag==='deploymentPayload'?hasDarkmoonDeploymentPayload(ref?.id):!!ref?.[p.tag];
        if(played&&(played.playerId??played.ownerId)===(piece.playerId??piece.ownerId)&&matches)
          darkmoonGrowth(state,piece,piece,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
        break;
      }
      case 'darkmoonPreviousWinSelfGrowth':
        if(state.lastCombatWon)darkmoonGrowth(state,piece,piece,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
        break;
      case 'darkmoonPlayedTribeGrowth': {
        const played=event.piece,owner=piece.playerId??piece.ownerId;
        if(!played||(played.playerId??played.ownerId)!==owner||!nativeFactions(played,services.catalog).includes(p.faction))break;
        const target=choose(roster(state).filter(x=>isPresent(x)&&(x.playerId??x.ownerId)===owner&&x.uid!==played.uid&&nativeFactions(x,services.catalog).includes(p.faction)),services);
        if(target)darkmoonGrowth(state,piece,target,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
        break;
      }
      case 'darkmoonBeastSummonGrowth': {
        const gained=event.piece,owner=piece.playerId??piece.ownerId;
        if(!gained || gained.uid===piece.uid || (gained.playerId??gained.ownerId)!==owner || !isPresent(gained) || !nativeFactions(gained,services.catalog).includes(p.faction))break;
        darkmoonGrowth(state,piece,gained,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
        break;
      }
      case 'darkmoonMagneticMerge': {
        if(!event.magneticTargetUid || event.source!=='buy')break;
        const target=roster(state).find(x=>x.uid===event.magneticTargetUid),owner=piece.playerId??piece.ownerId;
        if(!target || !isPresent(target) || (target.playerId??target.ownerId)!==owner || !nativeFactions(target,services.catalog).includes(p.faction))throw new Error('DARKMOON_MAGNETIC_TARGET_INVALID');
        if(p.sourceId==='BOT_312') {
          darkmoonGrowth(state,piece,target,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
          target.attachments||=[];
          const sourceOp=services.catalog?.operators?.[chessIdOf(piece)];
          const name=sourceOp?.name||'回收机器人', combat=darkmoonCombatMetadata(p.sourceId,isEliteForm(piece));
          target.attachments.push({id:'darkmoon-magnetic',state:{sourceId:p.sourceId,elite:isEliteForm(piece),sourceName:name,sourceEffect:combat?.text||'退场时召唤作战支援单位。'}});
        } else if(p.sourceId==='BOT_911') {
          for(const id of ['independent:坚守盟约','independent:护盾发生器']) services.grantEquipment(state,id,1,{origin:'native',sourceUid:piece.uid,targetUid:target.uid,landOn:`uid:${target.uid}`});
          darkmoonGrowth(state,piece,target,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
        } else throw new Error('DARKMOON_MAGNETIC_SOURCE_UNSUPPORTED');
        break;
      }
      case 'darkmoonPlayedFactionCountSelfGrowth': {
        const played=event.piece,owner=piece.playerId??piece.ownerId;
        if(!played||(played.playerId??played.ownerId)!==owner||!nativeFactions(played,services.catalog).includes(p.faction))break;
        const count=roster(state).filter(x=>isPresent(x)&&(x.playerId??x.ownerId)===owner&&nativeFactions(x,services.catalog).includes(p.faction)).length;
        const secondary=pick(p.secondaryUnitsPerTarget,elite)*count;
        darkmoonGrowth(state,piece,piece,pick(p.attackUnits,elite)*count,secondary,services);
        break;
      }
      case 'darkmoonSummonSupport': {
        const id=p[elite?'eliteId':'normalId'];
        if(id&&typeof services.grantChess==='function')services.grantChess(state,id,{origin:'native',sourceUid:piece.uid,poolTaken:true,poolCopies:0,noMerge:true,source:'darkmoon-support-summon'});
        break;
      }
      case 'darkmoonElementalTokenOffer': {
        const count=Math.max(0,Math.floor(Number(p.count||0)));
        state.offers||=[];
        for(let i=0;i<count;i++)state.offers.push({id:`o${state.nextUid++}`,type:'recruit',choices:[p.supportId],source:'darkmoon-elemental-token',poolTaken:true,poolCopies:0,noMerge:true,deferNativeGain:true});
        break;
      }
      case 'darkmoonTransformFromShop': {
        const slotIndex=event.shopSlots?.[run] ?? (run===0?event.shopSlot:undefined);
        const slot=Number.isInteger(slotIndex)?state.shop?.slots?.[slotIndex]:null;
        const eligibleSlots=(state.shop?.slots||[]).filter((x,index)=>!x.sold&&x.id&&index!==event.buySlot);
        if(!eligibleSlots.length)break;
        if(!slot||slot.sold||!slot.id||slotIndex===event.buySlot) throw new Error('NATIVE_SHOP_TARGET_REQUIRED');
        if(typeof services.transformPiece!=='function') throw new Error('NATIVE_TRANSFORM_UNAVAILABLE');
        services.transformPiece(state,piece,slot,Boolean(p.eliteCopy));
        break;
      }
      case 'darkmoonBattlecryFactionGrowth': {
        const gained=event.piece, ref=services.catalog?.operators?.[chessIdOf(gained)]?.sourceRefs?.darkmoon19_2;
        if(!gained || (gained.playerId??gained.ownerId)!==(piece.playerId??piece.ownerId) || !ref?.battlecry || !isPresent(piece)) break;
        const count=pick(p.count,elite);
        const hasAttack=p.outputs?.includes('precision')??true,hasSecondary=p.outputs?.some(id=>id!=='precision')??true;
        for(const target of roster(state).filter(x=>isPresent(x) && (x.playerId??x.ownerId)===(piece.playerId??piece.ownerId) && (!p.excludeSelf || x.uid!==piece.uid) && nativeFactions(x,services.catalog).includes(p.faction))) {
          darkmoonGrowth(state,piece,target,hasAttack?count:0,hasSecondary?count:0,services);
        }
        break;
      }
      case 'darkmoonAddTribeShopOffer': {
        const amount=Math.max(0,Math.floor(Number(p.count||0)));
        const excluded=String(piece.chessId).replace(/_b$/,'_a');
        const eligible=Object.entries(state.pool||{}).filter(([id,pool])=>id!==excluded&&pool.left>0 && nativeFactions({chessId:id},services.catalog).includes(p.faction)).map(([id])=>id).sort();
        for(let i=0;i<amount&&eligible.length;i++) {
          const id=eligible[Math.floor(services.rng()*eligible.length)];
          state.shop.slots.push({kind:'chess',id,elite:false,price:3,sold:false,equipment:[],frozen:true});
        }
        break;
      }
      case 'darkmoonRecruitTribeToHand': {
        const amount=Math.max(0,Math.floor(Number(p.count||0)));
        const excluded=String(piece.chessId).replace(/_b$/,'_a');
        const eligible=Object.entries(state.pool||{}).filter(([id,pool])=>id!==excluded&&pool.left>0 && nativeFactions({chessId:id},services.catalog).includes(p.faction)).map(([id])=>id).sort();
        for(let i=0;i<amount&&eligible.length;i++) {
          const id=eligible[Math.floor(services.rng()*eligible.length)];
          state.offers.push({id:`o${state.nextUid++}`,type:'recruit',choices:[id],source:'darkmoon-hand-reward',deferNativeGain:true});
        }
        break;
      }
      case 'darkmoonLastWarbandRecruit': {
        const candidates=(state.previousRoundWarband||[]).map(x=>String(x.chessId||'').replace(/_b$/,'_a')).filter(id=>services.catalog?.operators?.[id]?.recruitable!==false&&services.catalog?.operators?.[id]&&!services.catalog?.operators?.[id]?.elite&&(!elite||services.catalog.operators[id].eliteChessId));
        const selected=choose(candidates,services);
        if(selected) {
          const recruited=services.grantChess(state,selected,{origin:'native',sourceUid:piece.uid,poolTaken:true,poolCopies:1,deferNativeGain:true,source:'darkmoon-last-warband'});
          if(elite&&recruited) {
            const definition=services.catalog.operators[selected],goldenId=definition?.eliteChessId;
            if(goldenId&&services.catalog.operators[goldenId]) { recruited.chessId=goldenId; recruited.elite=true; }
          }
        }
        break;
      }
      case 'darkmoonBattlecryTargetGrowth': {
        const target=state.pieces?.find(x=>x.uid===event.targetUid);
        const eligible=roster(state).filter(x=>isPresent(x)&&(x.playerId??x.ownerId)===(piece.playerId??piece.ownerId)&&(!p.faction||nativeFactions(x,services.catalog).includes(p.faction)));
        if(!eligible.length)break;
        if(!target||!eligible.some(x=>x.uid===target.uid))throw new Error('DARKMOON_TARGET_REQUIRED');
        const count=p.fixedCount!==undefined?Number(p.fixedCount):Number(state.counters?.factionBought?.[p.faction]||0)*Number(p.perTribeBought||1);
        const hasAttack=p.outputs?.includes('precision')??true,hasSecondary=p.outputs?.some(id=>id!=='precision')??true;
        darkmoonGrowth(state,piece,target,p.attackUnits!==undefined?pick(p.attackUnits,elite):(hasAttack?count:0),p.secondaryUnits!==undefined?pick(p.secondaryUnits,elite):(hasSecondary?count:0),services);
        for(const id of p.extraGear||[])services.grantEquipment(state,id,1,{origin:'native',sourceUid:piece.uid,targetUid:target.uid,landOn:`uid:${target.uid}`});
        break;
      }
      case 'darkmoonAdjacentGrowth': {
        const owner=piece.playerId??piece.ownerId,targets=roster(state).filter(x=>isPresent(x)&&(x.playerId??x.ownerId)===owner&&x.uid!==piece.uid&&Math.abs(x.row-piece.row)+Math.abs(x.col-piece.col)===1);
        for(const target of targets){darkmoonGrowth(state,piece,target,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);for(const id of p.extraGear||[])services.grantEquipment(state,id,1,{origin:'native',sourceUid:piece.uid,targetUid:target.uid,landOn:`uid:${target.uid}`});}
        break;
      }
      case 'darkmoonTaggedGrowth': {
        const owner=piece.playerId??piece.ownerId;
        const targets=roster(state).filter(x=>isPresent(x)&&(x.playerId??x.ownerId)===owner&&(x.equipment||[]).some(item=>services.catalog?.equipment?.[item.id]?.params?.gearId===p.gearId));
        for(const target of targets)darkmoonGrowth(state,piece,target,pick(p.attackUnits,elite),pick(p.secondaryUnits,elite),services);
        break;
      }
      case 'darkmoonBoughtTribeTargetGrowth': {
        const buyer=event.piece;
        if(!nativeFactions(buyer,services.catalog).includes(p.triggerFaction) || (buyer.playerId??buyer.ownerId)!==(piece.playerId??piece.ownerId)) break;
        const target=state.pieces?.find(x=>x.uid===event.targetUid);
        if(!target || (target.playerId??target.ownerId)!==(piece.playerId??piece.ownerId)) throw new Error('DARKMOON_TARGET_REQUIRED');
        const count=Number(services.catalog?.operators?.[chessIdOf(buyer)]?.tier||1);
        const hasAttack=p.outputs?.includes('precision')??true,hasSecondary=p.outputs?.some(id=>id!=='precision')??true;
        const repeats=Math.max(1,Math.floor(pick(p.repeatCount,elite)));
        for(let i=0;i<repeats;i++)darkmoonGrowth(state,piece,target,hasAttack?count:0,hasSecondary?count:0,services);
        break;
      }
      case 'grantEquipment':
        if(event.magneticTargetUid && p.landOn==='self')break;
        for (const x of p.outputs || []) output(ruleServices, state, x.id, value(x, elite) + bonus(p, piece, state, elite), piece);
        break;
      case 'teamForge': {
        validateTeamForge(p);
        if (r.trigger !== 'prepEnd') throw new Error('BAD_TEAM_FORGE_TRIGGER');
        if (!p.outputs.every((x) => isBadge(services, x.id))) throw new Error('TEAM_FORGE_REQUIRES_BADGES');
        const owner = piece.playerId ?? piece.ownerId;
        const profession = (x) => nativeRecord(x, services.catalog)?.profession;
        const candidates = roster(state).filter((x) => isPresent(x) && !x.removed && !x.deleted && (!x.kind || x.kind === 'op') && services.catalog?.operators?.[chessIdOf(x)] && (x.playerId ?? x.ownerId) === owner
          && (!p.excludeSelf || x.uid !== piece.uid)
          && (p.targets !== 'adjacent' || Math.abs(x.row - piece.row) + Math.abs(x.col - piece.col) === 1)
          && (p.targets !== 'row' || x.row === piece.row)
          && (!p.targets.startsWith('faction:') || sharedTavernFactions(x, services.catalog).includes(p.targets.slice(8)))
          && (!p.targets.startsWith('profession:') || profession(x) === p.targets.slice(11)));
        const score = (x) => p.sort === 'leastEquipment' ? wornCount(x) : -Number(nativeBodyStats(x, services.catalog)[p.sort === 'highestBaseAttack' ? 'atk' : 'maxHp'] || 0);
        const targets = [...new Map(candidates.map((x) => [x.uid, x])).values()].sort((a,b) => score(a) - score(b) || String(a.uid).localeCompare(String(b.uid))).slice(0, p.count);
        for (const target of targets) for (const x of p.outputs) output(ruleServices, state, x.id, value(x, elite), piece, { targetUid: target.uid, landOn: `uid:${target.uid}` });
        break;
      }
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
        const count = r.behavior === 'forgeFactionTierPair' && p.countBy === 'operators' ? ranks.length : new Set(ranks).size;
        const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, count * value(p, elite));
        if (r.behavior === 'forgeFactionTierPair') for (const id of p.ids) output(ruleServices, state, id, amount, piece);
        else output(ruleServices, state, p.id, amount, piece);
        break;
      }
      case 'forgeAdjacent': {
        const targets = adjacent(state, piece, p.direction).filter((x) => x === piece || isPresent(x));
        if (p.each) {
          // 自身与身前一格友方各获得: each of them wears its own
          for (const t of targets) {
            const each = Object.create(ruleServices); each.__landOn = t === piece ? 'self' : (p.direction || 'front');
            output(each, state, p.id, value(p, elite), piece);
          }
          break;
        }
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
      case 'forgePerRefresh': {
        // 本次休整期每主动刷新1次 (安洁莉娜): badges for the refreshes of this prep phase, landing where the rule says
        const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, refreshCount(state) * value(p, elite));
        output(ruleServices, state, p.id, amount, piece); break;
      }
      case 'copyFrontNative': {
        // 身前一格友方若有<时点>特质，自身拥有相同特质: the front operator's rules of that moment run as this operator's
        // (精锐 copier: elite numbers; otherwise normal ones). Copiers are never copied.
        if (event.replay) break;
        const front = neighborAt(state, piece, 'front', 1);
        if (!front || !isPresent(front)) break;
        const copied = (traitFor(front, services)?.effect?.prep || []).filter((other) => other.trigger === p.hook && !COPIERS.has(other.behavior));
        if (!copied.length) break;
        const useElite = Boolean(pick(p.eliteValues, elite));
        fire(state, p.hook, piece, { ...event, replay: true, replayTarget: piece, sourceUid: piece.uid, copyRuleElite: useElite }, services, true, null, copied);
        break;
      }
      case 'attachShopByRefreshCount': {
        const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, refreshCount(state) * value(p, elite));
        attachShopEquipment(state, p.id, amount, piece, true); break;
      }
      case 'randomEquipment': {
        const pool = p.poolId ? services.catalog.pools?.[p.poolId] : null;
        for (let i = 0; i < value(p, elite); i++) output(ruleServices, state, pool ? choosePool(pool, services, elite) : choose(p.ids, services), 1, piece); break;
      }
      case 'randomUnlockedEquipment': {
        // gear nobody brings any more (design retired) or nobody brings yet (design unassigned) stays out of the random pool too
        const pool = Object.values(services.catalog.equipment).filter((x) => x.available && !x.retired && !x.unassigned && x.kind !== 'prizeGear' && x.kind !== 'permit' && (x.shopTier || x.oldTier || x.level || 1) <= (state.shop?.level || 1)).map((x) => x.id);
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
            const candidate = choose((p.choices || []).filter((id) => recruitable(services, id) && hasPoolStock(state, id)), services);
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
            const pool = Object.values(services.catalog?.operators || {}).filter((x) => x.chessId?.endsWith('_a') && x.recruitable !== false && hasPoolStock(state, x.chessId) && sharedTavernFactions({ chessId: x.chessId }, services.catalog).includes(faction));
            const pick = choose(pool, services);
            if (pick) services.grantChess(state, pick.chessId, { origin: 'native', sourceUid: piece.uid, ordinary: true });
          }
        }
        break;
      }
      case 'replayAdjacentNative': {
        if (event.replay) break;
        const limit = elite ? p.eliteRange || p.normalRange || 1 : p.normalRange || 1;
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
          const stack = to.equipment.find((x) => x.id === item.id);
          if (stack) stack.quantity = Number(stack.quantity || 1) + n;
          else to.equipment.push({ uid: `i${state.nextUid++}`, id: item.id, quantity: n, state: {}, ...(item.sourceId ? { sourceId: item.sourceId } : {}) });
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
        for (const c of slot.equipment || []) output(ruleServices, state, c.id, Number(c.quantity || 1), piece);
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
          const stack = (target.equipment ||= []).find((x) => x.id === p.id);
          if (stack) stack.quantity = Number(stack.quantity || 1) + add;
          else target.equipment.push({ uid: `i${state.nextUid++}`, id: p.id, quantity: add, state: {} });
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
  // a session's pool is { [chessId]: { cap, left, tier } } (session.js operatorPool; closed factions are not in it);
  // older fixtures nest it under `left`
  const entry = state.pool?.[chessId]?.left != null && typeof state.pool[chessId] === 'object' ? state.pool[chessId] : state.pool?.left?.[chessId];
  return Number(entry?.left || 0) > 0;
}
function recruitable(services, chessId) {
  const op = services.catalog?.operators?.[chessId];
  return Boolean(op && !op.elite && !op.isElite && op.recruitable !== false);
}
function chooseAvailablePool(pool, state, services, elite = false) {
  if (!pool) throw new Error('Missing upstream SharedPool definition for native effect');
  const original = pool.weighted;
  if (original) {
    let entries = original;
    if (elite && Array.isArray(pool.goldenWeights)) entries = original.map(([id], i) => [id, pool.goldenWeights[i]]);
    entries = entries.filter(([id]) => recruitable(services, id) && hasPoolStock(state, id));
    return entries.length ? choosePool({ ...pool, weighted: entries, goldenWeights: undefined }, services, false) : null;
  }
  const items = (pool.items || []).filter((id) => recruitable(services, id) && hasPoolStock(state, id));
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
  const all = Object.values(services.catalog?.operators || {}).filter((x) => x.chessId?.endsWith('_a') && x.recruitable !== false && x.tier != null && hasPoolStock(state, x.chessId) && (!opts.tiers || opts.tiers.includes(x.tier)) && (!opts.tierMax || x.tier <= opts.tierMax) && (!opts.faction || sharedTavernFactions({ chessId: x.chessId }, services.catalog).includes(opts.faction)));
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
      const n = Math.min(pick(p.max, false), pick(p.start, false) * 2 ** k);
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
    if (hook === 'gain' && piece && !event.replay) for (const holder of roster(state)) {
      if (isPresent(holder)) fire(state,'allyGain',holder,event,services,false,null,(traitFor(holder,services)?.effect?.prep||[]).filter(r=>r.trigger==='allyGain'&&r.behavior==='factionReaction'));
      if (hook==='gain' && holder.uid!==piece.uid && isPresent(holder)) fire(state,'gain',holder,event,services,false,null,(traitFor(holder,services)?.effect?.prep||[]).filter(r=>r.trigger==='gain'&&['darkmoonBattlecryFactionGrowth','darkmoonBeastSummonGrowth','darkmoonPlayedFactionCountSelfGrowth','darkmoonPlayedTagSelfGrowth','darkmoonPlayedTribeGrowth'].includes(r.behavior)));
    }
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
