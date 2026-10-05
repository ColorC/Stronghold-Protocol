import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getData } from '../../data.js';
import { nativeEffectFor } from './native.js';

const DESIGN_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/independent-design.json');
const DESIGN = JSON.parse(readFileSync(DESIGN_PATH, 'utf8'));

const BADGE_IDS = Object.freeze({
  精准徽章: 'precision', 灵巧徽章: 'agility', 坚守徽章: 'vitality', 助力徽章: 'defense',
  突袭徽章: 'assault', 迅捷徽章: 'recovery', 奥术徽章: 'arcane', 远见徽章: 'foresight',
  奇迹徽章: 'miracle', 投资人徽章: 'investor', 不屈徽章: 'unyielding', 调和徽章: 'harmony',
  协防徽章: 'coordination', 独行徽章: 'solitary', 绝技徽章: 'mastery',
});
const ATTACHMENT_IDS = Object.freeze({ 军需备品: 'quartermaster-kit', 弹药回收: 'ammo-recovery', 寒区记录: 'cold-region-log', 医疗整备: 'medical-readiness' });
const PRIZE_IDS = Object.freeze({
  应急营养补给: 'emergency-rations', 额外采购配额: 'extra-procurement-quota', 新人征调令: 'rookie-requisition', 全队战备支援: 'team-readiness-support',
  标准战备升级: 'standard-readiness-upgrade', 紧急情报更新: 'urgent-intelligence-update', 便携锻造站: 'portable-forge', 重复验收许可: 'repeat-inspection-permit',
  长期后勤配额: 'long-term-logistics-quota', 重装补给箱: 'heavy-assault-crate', 特别调度授权: 'special-dispatch-authorization', 定向征调令: 'targeted-requisition',
  应急屏障援助: 'emergency-barrier-aid', 重型武装校准: 'heavy-weapons-calibration', 精英征调令: 'elite-requisition', 重点干员支援: 'key-operator-support',
  追加采购预算: 'additional-procurement-budget', 战备晋升令: 'readiness-promotion-order', 专项战备授训: 'special-readiness-training',
});
const PRIZE_GEAR_IDS = Object.freeze({ 罗德岛便携锻炉: 'rhodes-portable-forge', 罗德岛重装防护套件: 'rhodes-heavy-protection-kit', 应急屏障组件: 'emergency-barrier-module', 重型武装校准章: 'heavy-weapons-calibration-seal', 精英干员战备箱: 'elite-operator-readiness-case' });
const IDENTITY_CANONICAL = 'harmony-identity-card';
const STOPPED_LEGACY_NAMES = new Set(['随身身份牌', '变形同构体']);
const EQUIPMENT_RULES = Object.freeze({
  '源石促效溶剂': { mechanism: 'statsAndDrain', params: { normal: { hpLossPerSecond: 20 }, elite: { hpLossPerSecond: 30 } }, stats: { attackPercent: { normal: 0.2, elite: 0.3 } } },
  '不屈部署支架': { mechanism: 'statsAndRedeploy', params: { normal: { redeployTimeReduction: 0.2 }, elite: { redeployTimeReduction: 0.3 } }, stats: { maxHpPercent: { normal: -0.15, elite: -0.2 } } },
  '诱敌蜂鸣器': { mechanism: 'combatEquipment', params: { effects: [] }, stats: { maxHpPercent: { normal: 0.2, elite: 0.35 }, tauntLevel: 1 } },
  '有限加速器': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'attack', behavior: 'eventStats', params: { attackSpeedFlat: 1, maxStacks: { normal: 20, elite: 35 }, duration: 'battle', countOncePerActivation: true } }, { trigger: 'heal', behavior: 'eventStats', params: { attackSpeedFlat: 1, maxStacks: { normal: 20, elite: 35 }, duration: 'battle', effectiveOnly: true, countOncePerActivation: true } }] } },
  '应急伪装服': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'damageTaken', behavior: 'firstDamageStatus', params: { status: 'stealth', perBattle: 1, durationSeconds: { normal: 6, elite: 10 }, preserveBlocking: true } }] } },
  '后勤回收协议': { mechanism: 'saleThresholdRecruit', params: { normalSaleThreshold: 6, eliteSaleThreshold: 4, maxPerPrep: 1, requiresSharedFaction: true, ordinaryOnly: true, maxTier: 'currentShop', choices: 3 } },
  '精准狙击镜': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'hit', behavior: 'conditionalDamage', params: { condition: 'distanceAtLeast', distance: 3, multiplier: { normal: 1.15, elite: 1.25 } } }] } },
  '源石激光组件': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'hit', behavior: 'resistanceIgnore', params: { damageType: 'arts', ratio: { normal: 0.15, elite: 0.25 }, floor: 0 } }] } },
  '迅捷作战口粮': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'deploy', behavior: 'deploySpRecovery', params: { base: { normal: 3, elite: 6 }, perSharedFactionAlly: { normal: 1, elite: 2 }, maxBonus: { normal: 5, elite: 10 } } }] } },
  '歌利亚防护盔': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'deploy', behavior: 'deployWindowStats', params: { noFrontAllyBonus: { normal: 0.1, elite: 0.15 }, duration: 'deployment' } }] }, stats: { maxHpPercent: { normal: 0.15, elite: 0.25 } } },
  '奥术抑制器': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'attack', behavior: 'silenceOnHit', params: { durationSeconds: { normal: 3, elite: 5 }, immuneTargetsIgnored: true } }], stats: { resistance: { normal: 10, elite: 20 } } } },
  '突袭破片榴弹': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'hit', behavior: 'deployFirstHitStatus', params: { status: 'stun', durationSeconds: { normal: 1, elite: 2 }, maxPerBattle: 3, resetOnDeploy: true } }] } },
  '防暴塔盾': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'damageTaken', behavior: 'blockedDamageReduction', params: { reduction: { normal: 0.2, elite: 0.3 }, condition: 'blocking', attackerNotBlockedByOwner: true } }] } },
  '休眠子裔': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'attack', behavior: 'healOnHit', params: { maxHpPercent: { normal: 0.01, elite: 0.02 }, oncePerAttack: true, excludedFromHealingTriggers: true } }] } },
  '卡西米尔竞技旗': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'deploy', behavior: 'deployWindowDamage', params: { durationSeconds: { normal: 10, elite: 15 }, multiplier: { normal: 1.15, elite: 1.25 }, endsFully: true } }] } },
  '拉特兰备用桥夹': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'ammoUsed', behavior: 'lastBulletRefund', params: { thresholdRemaining: 1, maxPerBattle: 1, initialAmmoRatio: { normal: 0.2, elite: 0.3 }, rounding: 'floor', minimum: 1 } }] } },
  '灼燃维式重锤': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'hit', behavior: 'artsDamageAfterburn', params: { ratio: { normal: 0.05, elite: 0.1 }, cannotReenter: true } }], stats: { attackPercent: { normal: 0.15, elite: 0.25 } } } },
  '应急浓缩嗅盐': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'statusApplied', behavior: 'statusImmunityAtHp', params: { statuses: ['stun', 'frozen'], minHpRatio: { normal: 0.8, elite: 0.6 }, doesNotCleanse: true } }] } },
  '医疗护盾无人机': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'heal', behavior: 'countedHealShield', params: { counterEvery: { normal: 6, elite: 4 }, cooldownSeconds: 4, shieldCharges: 1, mainTargetOnly: true, groupHealCountsOnce: true, skipTargetWithEquipmentShield: true } }] } },
  'M3应急茧甲': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'death', behavior: 'singleRevive', params: { perBattle: 1, delaySeconds: 1, maxHpRatio: { normal: 0.5, elite: 1 }, sameCell: true, counterPersists: true } }] } },
  '天马骑士战盔': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'tick', behavior: 'pairedEquipmentRegen', params: { partnerSourceId: 'chess_item_6_01_e_a', maxHpPercentPerSecond: { normal: 0.01, elite: 0.02 }, countsAsHealing: false } }] }, stats: { maxHpPercent: { normal: 0.2, elite: 0.35 } } },
  '天马骑士长枪': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'attack', behavior: 'pairedEquipmentHitDamage', params: { partnerSourceId: 'chess_item_5_09_e_a', trueDamageAttackRatio: { normal: 0.1, elite: 0.2 }, oncePerAttack: true } }], stats: { attackPercent: { normal: 0.2, elite: 0.35 } } } },
  '战栗维式重锤': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'attack', behavior: 'disarmOnHit', params: { groundOnly: true, cooldownSeconds: 8, durationSeconds: { normal: 1, elite: 1.5 } } }], stats: { attackPercent: { normal: 0.1, elite: 0.2 } } } },
  '萨尔贡行军浓茶': { mechanism: 'combatEquipment', params: { effects: [] }, stats: { spRecovery: { normal: 0.1, elite: 0.2, source: 'naturalOnly' } } },
  '叙拉古仪仗正装': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'deploy', behavior: 'deployWindowStats', params: { adjacentHorizontalAllies: { attackSpeedFlat: { normal: 5, elite: 10 } }, sameNameDoesNotStack: true } }] }, stats: { attackSpeedFlat: { normal: 8, elite: 16 } } },
  '炎国制式短刀': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'skillStart', behavior: 'eventStats', params: { attackPercent: { normal: 0.03, elite: 0.05 }, maxStacks: 5, duration: 'battle' } }] } },
  '阿戈尔沉海重刃': { mechanism: 'combatEquipment', params: { effects: [] }, stats: { attackPercent: { normal: 0.2, elite: 0.35 }, attackSpeedFlat: { normal: -5, elite: -10 } } },
  '坚固维式重锤': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'lethalDamage', behavior: 'lethalGuard', params: { perBattle: 1, durationSeconds: { normal: 4, elite: 6 }, minimumHp: 1, reviveDoesNotReset: true } }], stats: { attackPercent: { normal: 0.1, elite: 0.2 } } } },
  '加速维式重锤': { mechanism: 'combatEquipment', params: { effects: [] }, stats: { attackPercent: { normal: 0.1, elite: 0.2 }, attackSpeedFlat: { normal: 10, elite: 20 } } },
  '催泪瓦斯组件': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'attack', behavior: 'slowOnHit', params: { durationSeconds: 3, attackSpeedFlat: { normal: -5, elite: -10 }, moveSpeedPercent: { normal: -0.05, elite: -0.1 }, sameNameDoesNotStack: true, controlImmuneIgnored: true } }] } },
  '谢拉格不融冰': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'attack', behavior: 'countedStatus', params: { counterEvery: { normal: 8, elite: 6 }, status: 'cold', durationSeconds: { normal: 1.5, elite: 2 }, target: 'primary' } }] } },
  '双模机械臂': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'hit', behavior: 'damageConversion', params: { from: ['nativePhysical', 'nativeArts'], to: 'weak', exclude: ['equipmentDamage', 'trueDamage'] } }], stats: { attackPercent: { normal: 0.15, elite: 0.25 } } } },
  '拉特兰铳骑组件': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'attack', behavior: 'countedAttackDamage', params: { counterEvery: { normal: 8, elite: 6 }, multiplier: { normal: 1, elite: 1.5 }, requiresTag: '拉特兰', requiresInRangeEnemy: true, pairedSourceId: 'chess_item_4_08_e_a', pairedMultiplier: { normal: 1.5, elite: 2 } } }], stats: { attackPercent: { normal: 0.2, elite: 0.35 } } } },
  '炎国天师古鼎': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'gain', behavior: 'gainBattleStats', params: { requiresTag: '炎', attackSpeedPerGain: { normal: 5, elite: 8 }, maxAttackSpeed: { normal: 15, elite: 24 }, duration: 'battle', pairedSourceId: 'chess_item_3_04_e_a', deferredFunds: { normal: 1, elite: 2 }, deferredFundsMaxPerRound: 1 } }] }, stats: { maxHpPercent: { normal: 0.2, elite: 0.35 } } },
  '阿戈尔海沟实验体': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'damageTaken', behavior: 'damageReductionAndRetaliation', params: { flatReduction: { normal: 40, elite: 80 }, minimumDamage: 1, requiresTag: '阿戈尔', retaliationAttackPercent: { normal: 0.2, elite: 0.3 }, retaliationCooldownSeconds: 1, pairedSourceId: 'chess_item_3_07_e_a', pairedMultiplier: 1.5 } }] } },
  '维多利亚蒸汽之心': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'passive', behavior: 'steamGearUpgrade', params: { requiresTag: '维多利亚', sourceIds: ['chess_item_2_03_e_a', 'chess_item_3_09_e_a', 'chess_item_3_10_e_a', 'chess_item_4_09_e_a'], chooseVariantsOnEquip: { normal: 1, elite: 2 }, upgradesSpecialEffectsOnly: true } }] }, stats: { attackSpeedFlat: { normal: 15, elite: 25 } } },
  '耶拉冈德之泪': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'tick', behavior: 'coldAuraDamage', params: { requiresTag: '谢拉格', damageRatio: { normal: 0.15, elite: 0.25 }, condition: 'inRangeColdOrFrozen', pairedSourceId: 'chess_item_5_02_e_a', pairedDamageRatio: { normal: 0.25, elite: 0.4 } } }] }, stats: { resistance: { normal: 15, elite: 25 } } },
  '萨尔贡黄沙罗盘': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'skillEnd', behavior: 'skillRecovery', params: { requiresTag: '萨尔贡', firstOnly: true, sp: { normal: 10, elite: 20 }, pairedSourceId: 'chess_item_2_04_e_a', teamSpPerSkillStart: { normal: 1, elite: 2 }, pairedSkillStartCap: 3 } }] }, stats: { initialSp: { normal: 10, elite: 20 } } },
  '卡西米尔骑士戒律': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'skillStart', behavior: 'redeployAndSkillWindow', params: { requiresTag: '卡西米尔', slowWindowSeconds: { normal: 10, elite: 15 }, slowPercent: { normal: 0.1, elite: 0.15 }, pairedSourceId: 'chess_item_4_07_e_a', pairedAttackPercent: { normal: 0.15, elite: 0.25 }, withdrawOnSkillEndWhenPaired: true } }] }, stats: { redeployTimeReduction: { normal: 0.15, elite: 0.25 } } },
  '叙拉古家族印记': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'stealthLost', behavior: 'stealthBreakDamage', params: { requiresTag: '叙拉古', damageBonus: { normal: 0.3, elite: 0.5 }, pairedSourceId: 'chess_item_3_01_e_a', trueDamageAttackRatio: { normal: 1, elite: 2 }, pairedProcMaxPerBattle: 1 } }] }, stats: { spRecovery: { normal: 0.1, elite: 0.2, source: 'naturalOnly' } } },
  '医疗部蓄能电容': { mechanism: 'healingCapacitor', params: { thresholdMaxHpRatio: 0.2, damageRatio: 1, cooldownSeconds: 3, damageType: 'arts', range: 'adjacentFour', includeNativeHealing: true, ignoreSelf: true, ignoreOverheal: true, ignoreEquipmentHeal: true } },
  '近战训练记录仪': { mechanism: 'attackEventProduction', params: { counterEvent: 'attack', counterEvery: 15, outputs: [{ id: 'precision', quantity: 1 }], maxPerBattle: 4, filter: { actor: 'self', nativeOnly: true } } },
  '拉特兰调速器': { mechanism: 'badgeAmplifier', params: { badgeIds: ['agility'], multiplier: 1.5, stats: ['attackSpeedFlat'] } },
  '维多利亚校准砧': { mechanism: 'badgeAmplifier', params: { badgeIds: ['assault'], multiplier: 1.5, stats: ['attackPercent'] } },
  '医疗部稳态仪': { mechanism: 'badgeAmplifier', params: { badgeIds: ['vitality'], multiplier: 1.5, stats: ['maxHpFlat'] } },
  '应急屏障组件': { mechanism: 'equipmentShield', params: { charges: 2 } },
  '精英干员战备箱': { mechanism: 'equipmentShield', params: { charges: 1 }, stats: { attackFlat: 50, maxHpFlat: 400, attackSpeedFlat: 10 } },
  '罗德岛重装防护套件': { mechanism: 'stats', params: {}, stats: { maxHpFlat: 400, defenseFlat: 40, tauntLevel: 1 } },
  '重型武装校准章': { mechanism: 'badgeAmplifier', params: { badgeIds: ['precision', 'assault'], multiplier: 2, stats: ['attackFlat', 'attackPercent'] } },
  '人事部增援许可': { mechanism: 'deployCap', params: { amount: 1, max: 9, perRunLimit: 1 } },
  '调和识别牌': { mechanism: 'identityTag', params: { chooseOnEquip: true } },
  '罗德岛便携锻炉': { mechanism: 'prepEndForge', params: { outputs: [{ id: 'precision', quantity: 1 }, { id: 'vitality', quantity: 1 }], requiresOnField: true } },
  '罗德岛采购券': { mechanism: 'fundsOnUse', params: { normalFunds: 1, eliteFunds: 2 } },
  '紧急征调凭证': { mechanism: 'shopRecruitOnUse', params: { normalCount: 1, eliteCount: 2, ordinaryOnly: true, removeShopSlot: true } },
  '后勤储蓄盒': { mechanism: 'facilityIncome', params: { normalIncome: 1, eliteIncome: 2, unique: true } },
  '阵营联络终端': { mechanism: 'factionRecruitOnUse', params: { normalOffers: 1, eliteOffers: 2, choices: 3, maxTier: 'shopLevel' } },
  '延期采购回执': { mechanism: 'deferredFundsOnUse', params: { normalFunds: 2, eliteFunds: 4 } },
  '骑士采购储金罐': { mechanism: 'immediateFundsOnUse', params: { normal: 3, elite: 5 } },
  '阵营征调模块': { mechanism: 'factionRecruitOnUse', params: { normalCount: 1, eliteCount: 1, normalTier: 'currentShop', eliteTierDelta: 1, eliteOrdinary: true, requiresExistingFaction: true, choices: 3 } },
  '拟态招募样本': { mechanism: 'copyOperatorOnUse', params: { normalCount: 1, eliteCount: 2, ordinaryOnly: true, copyNativeOnly: true, copyEquipment: false, copyAttachments: false, copyNativeState: false } },
  '博士晋升授权': { mechanism: 'promoteOnUse', params: { normalCount: 1, eliteCount: 2, chooseTargets: true, eliteOnly: false } },
});
const ATTACHMENT_RULES = Object.freeze({
  军需备品: { mechanism: 'prepEndForge', params: { outputs: [{ id: 'precision', quantity: 1 }], requiresOnField: true, requiresNextBattle: true } },
  弹药回收: { mechanism: 'eventProduction', params: { counterEvent: 'ammoUsed', counterEvery: 12, outputs: [{ id: 'agility', quantity: 1 }], maxPerBattle: 3, filter: { actor: 'self', selectedAmmoSkill: true } } },
  寒区记录: { mechanism: 'eventProduction', params: { counterEvent: 'statusApplied', counterEvery: 1, outputs: [{ id: 'assault', quantity: 2 }], maxPerBattle: 2, filter: { actor: 'self', targetSide: 'enemy', status: 'frozen', entered: true, nativeSource: true }, firstOnly: true } },
  医疗整备: { mechanism: 'eventProduction', params: { counterEvent: 'heal', counterEvery: 20, outputs: [{ id: 'vitality', quantity: 1 }], maxPerBattle: 3, filter: { actor: 'self', nativeOnly: true, effective: true, excludeOverheal: true, excludeEquipment: true, groupHealCountsOnce: true } } },
});
const PRIZE_MECHANISMS = Object.freeze({
  应急营养补给: ['grantItems', { outputs: [{ id: 'precision', quantity: 3 }, { id: 'vitality', quantity: 3 }] }],
  额外采购配额: ['grantItems', { outputs: [{ id: 'chess_item_1_03_e_a', quantity: 2 }] }],
  新人征调令: ['recruitOffer', { tier: 1, elite: false, choices: 3, applyGainTrait: true }],
  全队战备支援: ['grantItemsPerPiece', { outputs: [{ id: 'precision', quantity: 1 }, { id: 'vitality', quantity: 1 }], cap: 8 }],
  标准战备升级: ['futureShopEquipment', { id: 'vitality', quantity: 1, shopChessOnly: true, currentUnclaimed: true, noDuplicateOnFreeze: true }],
  紧急情报更新: ['freeRefreshes', { count: 3, expires: 'prepEnd' }],
  便携锻造站: ['grantGear', { gearId: 'rhodes-portable-forge' }],
  重复验收许可: ['repeatNativeForging', { extraRepeats: 1, scope: 'prep', excludeRepeat: true }],
  长期后勤配额: ['facilityIncome', { amount: 1, startsImmediately: true, unique: true }],
  重装补给箱: ['grantGear', { gearId: 'rhodes-heavy-protection-kit' }],
  特别调度授权: ['replaceCurrentShop', { tierDelta: 1, maxTier: 6, retainFreeze: true, regularOnly: true }],
  定向征调令: ['recruitOffer', { tier: 'currentShopLevel', elite: false, choices: 3, applyGainTrait: true }],
  应急屏障援助: ['grantGear', { gearId: 'emergency-barrier-module' }],
  重型武装校准: ['conditionalGrantGear', { gearId: 'heavy-weapons-calibration-seal', requiresAnyBadge: ['precision', 'assault'] }],
  精英征调令: ['recruitOffer', { tier: 6, elite: false, choices: 3, applyGainTrait: true }],
  重点干员支援: ['grantGear', { gearId: 'elite-operator-readiness-case' }],
  追加采购预算: ['activeFundTopUp', { target: 'baseIncome', once: true }],
  战备晋升令: ['promoteOperator', { retainPosition: true, retainEquipment: true, preserveNativeState: true, noGainEvent: true }],
  专项战备授训: ['attachmentOffer', { choices: 3, chooseAvailable: true }],
});

const own = (obj, key) => obj && Object.hasOwn(obj, key) ? obj[key] : undefined;
const clone = (v) => v == null ? v : structuredClone(v);
const eliteId = (id) => id.endsWith('_a') ? `${id.slice(0, -2)}_b` : null;
const recordById = (map, id) => own(map, id) || null;
function resolvedEquipmentRule(name, required = true) {
  const raw = EQUIPMENT_RULES[name];
  if (!raw) {
    if (required) throw new Error(`Independent equipment has no structured rule: ${name}`);
    return { mechanism: 'disabled', params: {}, stats: null };
  }
  const params = clone(raw.params || {});
  const stats = clone(raw.stats ?? params.stats ?? null);
  delete params.stats;
  return { mechanism: raw.mechanism, params, stats };
}

function makeOperator(source, chess, data, eliteVariant = false) {
  const normal = recordById(data.chess, source.chessId) || chess || {};
  const eid = eliteId(source.chessId);
  const elite = eid ? recordById(data.chess, eid) : null;
  return {
    ...clone(source),
    chessId: source.chessId,
    eliteChessId: eid,
    nativeTrait: {
      ...clone(source.nativeTrait),
      normalText: source.nativeTrait?.normal ?? '',
      eliteText: source.nativeTrait?.elite ?? '',
      sources: {
        normal: clone(source.originalNormal || []),
        elite: clone(source.originalElite || []),
      },
      origin: 'operator body',
      effect: nativeEffectFor(source.chessId, source, eliteVariant),
    },
    source: {
      charId: source.charId,
      normalChess: clone(normal),
      eliteChess: clone(elite),
      skills: [...(source.skills || [])],
      talents: clone(source.talents || []),
    },
  };
}

function keyed(list, idFn, mapFn) {
  const out = Object.create(null);
  for (const value of list || []) {
    const id = idFn(value);
    if (!id || Object.hasOwn(out, id)) throw new Error(`Independent catalog has a missing or duplicate id: ${id || value?.name}`);
    out[id] = mapFn(value, id);
  }
  return out;
}

/** Build a stable, queryable catalog. data is the upstream GameData/SharedPool object. */
export function getCatalog(data = getData()) {
  const operators = Object.create(null);
  for (const source of DESIGN.operators) {
    const op = makeOperator(source, recordById(data?.chess, source.chessId), data || {});
    operators[op.chessId] = op;
    if (op.eliteChessId) operators[op.eliteChessId] = {
      ...clone(op), chessId: op.eliteChessId, baseChessId: op.chessId, elite: true,
      nativeTrait: { ...clone(op.nativeTrait), text: op.nativeTrait.eliteText, sourceRecords: clone(op.nativeTrait.sources.elite), effect: nativeEffectFor(source.chessId, source, true) },
    };
    operators[op.chessId].elite = false;
    operators[op.chessId].nativeTrait.text = op.nativeTrait.normalText;
    operators[op.chessId].nativeTrait.sourceRecords = clone(op.nativeTrait.sources.normal);
  }

  const badges = keyed(DESIGN.badges, (x) => BADGE_IDS[x.name], (x, id) => ({ ...clone(x), id, kind: 'badge', sourceId: null }));
  const equipment = Object.create(null);
  for (const item of DESIGN.legacy || []) {
    const canonicalId = STOPPED_LEGACY_NAMES.has(item.oldName) ? IDENTITY_CANONICAL : item.sourceId;
    const upstreamEliteId = item.sourceId.endsWith('_a') ? `${item.sourceId.slice(0, -2)}_b` : null;
    const rule = item.kind === '徽章' || item.kind === '停用' ? null : resolvedEquipmentRule(item.newName, item.kind === '停用');
    equipment[item.sourceId] = {
      ...clone(item), id: item.sourceId, sourceId: item.sourceId, canonicalId, uniqueKey: canonicalId,
      eliteId: item.eliteLevel == null ? null : upstreamEliteId,
      available: item.kind !== '停用', kind: item.kind,
      badgeId: BADGE_IDS[item.newName] || null,
      mechanism: item.kind === '徽章' ? 'badge' : item.kind === '停用' ? 'disabled' : rule.mechanism,
      params: clone(rule?.params || (BADGE_IDS[item.newName] ? { stat: DESIGN.badges.find((x) => x.name === item.newName)?.stat, value: DESIGN.badges.find((x) => x.name === item.newName)?.value } : {})),
      stats: clone(rule?.stats || null),
      upstream: clone(recordById(data?.chess, item.sourceId)),
      upstreamGarrisons: clone((recordById(data?.chess, item.sourceId)?.garrisonIds || []).map((gid) => recordById(data?.garrisons, gid)).filter(Boolean)),
    };
  }
  for (const item of DESIGN.extraGear || []) {
    const id = `independent:${item.name}`;
    const rule = resolvedEquipmentRule(item.name);
    equipment[id] = { ...clone(item), id, sourceId: id, canonicalId: id, uniqueKey: id, eliteId: null, available: true, kind: 'equipment', mechanism: rule.mechanism, params: rule.params, stats: rule.stats };
  }
  const identity = DESIGN.identityGear;
  if (identity) {
    const id = 'chess_item_identity_gear';
    const rule = resolvedEquipmentRule(identity.name);
    equipment[id] = { ...clone(identity), id, sourceId: id, canonicalId: IDENTITY_CANONICAL, uniqueKey: IDENTITY_CANONICAL, eliteId: null, available: true, kind: 'equipment', mechanism: rule.mechanism, params: rule.params, stats: rule.stats };
  }
  for (const item of DESIGN.prizeGear || []) {
    const id = PRIZE_GEAR_IDS[item.name];
    const rule = resolvedEquipmentRule(item.name);
    equipment[id] = { ...clone(item), id, sourceId: item.source || id, canonicalId: id, uniqueKey: id, eliteId: null, available: true, kind: 'prizeGear', mechanism: rule.mechanism, params: rule.params, stats: rule.stats };
  }

  const permissions = keyed(DESIGN.permissions, (x) => x.name, (x) => clone(x));
  const attachments = keyed(DESIGN.attachments, (x) => ATTACHMENT_IDS[x.name], (x, id) => ({ ...clone(x), id, mechanism: ATTACHMENT_RULES[x.name].mechanism, params: clone(ATTACHMENT_RULES[x.name].params) }));
  const prizes = keyed(DESIGN.prizes, (x) => PRIZE_IDS[x.name], (x, id) => ({
    ...clone(x), id,
    mechanism: PRIZE_MECHANISMS[x.name][0], params: clone(PRIZE_MECHANISMS[x.name][1]),
    gearIds: Object.keys(PRIZE_GEAR_IDS).filter((name) => x.effect?.includes(name)).map((name) => PRIZE_GEAR_IDS[name]),
  }));

  return {
    id: 'independent', name: '罗德岛战备演习',
    config: {
      ...clone(DESIGN.rules || {}), purchasePrice: 3, sellPrice: 1, refreshPrice: 1,
      balance: { incomeBonusFromRound: 8, incomeBonus: 1 },
      equipmentCapacity: 99, basicBadgeCount: 15, regularProductionBadgeCount: 6,
      rareInheritanceOperators: 12, bodyPenalty: clone(DESIGN.rules?.bodyPenalty),
      badgeRecipes: clone(DESIGN.badgeRecipes || DESIGN.recipes || {}),
      factionRecipes: {
        炎: ['precision'], 维多利亚: ['precision', 'vitality'], 拉特兰: ['agility'], 阿戈尔: ['vitality'],
        谢拉格: ['assault'], 萨尔贡: ['recovery'], 叙拉古: ['precision', 'assault'], 卡西米尔: ['defense', 'agility'],
      },
      tavernFactions: ['炎', '维多利亚', '拉特兰', '阿戈尔', '谢拉格', '萨尔贡', '叙拉古', '卡西米尔'],
      professionRecipes: { PIONEER: ['precision'], WARRIOR: ['precision'], SNIPER: ['precision'], SPECIAL: ['precision'], TANK: ['defense'], MEDIC: ['vitality'], CASTER: ['assault'], SUPPORT: ['recovery'] },
    },
    operators, permissions, badges, equipment, attachments, prizes,
    nativeRegistry: {
      prepBehaviors: [...new Set(Object.values(operators).flatMap((op) => op.nativeTrait.effect.prep.map((x) => x.behavior)))].sort(),
      combatBehaviors: [...new Set(Object.values(operators).flatMap((op) => op.nativeTrait.effect.combat.map((x) => x.behavior)))].sort(),
      unsupported: [...new Set(Object.values(operators).flatMap((op) => op.nativeTrait.effect.unsupported || []))].sort(),
    },
    equipmentRegistry: {
      mechanisms: [...new Set(Object.values(equipment).map((item) => item.mechanism))].sort(),
      combatBehaviors: [...new Set(Object.values(equipment).flatMap((item) => item.params?.effects || []).map((effect) => effect.behavior))].sort(),
      unsupported: [],
    },
    pools: Object.fromEntries(['pool_equip_rockr','pool_equip_pepe','pool_char_pinus','pool_equip_normal'].filter((id) => own(data?.choices?.pools,id)).map((id) => [id, clone(data.choices.pools[id])])),
    source: clone(DESIGN.source),
  };
}

export { BADGE_IDS };
