import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getData } from '../../data.js';
import { nativeEffectFor } from './native.js';
import { EQUIPMENT_CAPACITY, INVENTORY_CAPACITY } from './equipment.js';
import { KEYWORD_GEAR_BY_NAME } from './keywordGear.js';

const DESIGN_PATH = process.env.SP_INDEPENDENT_DESIGN_PATH
  ? path.resolve(process.env.SP_INDEPENDENT_DESIGN_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/independent-design.json');
const DESIGN = JSON.parse(readFileSync(DESIGN_PATH, 'utf8'));
const DARKMOON_ADDON_PATH=process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH
  ? path.resolve(process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../data/independent-darkmoon-design-addon.json');
let DARKMOON_SUPPORT_SPECS=[];
try { DARKMOON_SUPPORT_SPECS=JSON.parse(readFileSync(DARKMOON_ADDON_PATH,'utf8')).supportOperators||[]; } catch { /* Darkmoon support definitions are an optional compiler add-on. */ }

const BADGE_IDS = Object.freeze({
  伤害徽章: 'damage',
  攻击徽章: 'precision', 攻速徽章: 'agility', 生命徽章: 'vitality', 防御徽章: 'defense',
  攻击加成徽章: 'assault', 技力徽章: 'recovery', 法抗徽章: 'arcane', 初始技力徽章: 'foresight',
  闪避徽章: 'miracle', 回复徽章: 'investor', 生命加成徽章: 'unyielding', 治疗徽章: 'harmony',
  减伤徽章: 'coordination', 再部署徽章: 'solitary', 普通攻击徽章: 'mastery',
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
// 交接凭证: the twelve inheritance permissions, worn as gear by the operator that brings it (design operators[].inheritance)
const PERMIT_GEAR_IDS = Object.freeze({
  北境战备交接令: 'permit-north-handover-order', 天师器械封签: 'permit-tianshi-seal', 乌萨斯后勤交接单: 'permit-ursus-logistics-slip',
  锻锤师交工凭证: 'permit-smith-receipt', 深海遗物托付书: 'permit-deepsea-entrustment', 乡野器械移交单: 'permit-rural-transfer-slip',
  骑士装备托管证: 'permit-knight-custody', 独行者借装许可: 'permit-loner-loan', 重装器械适配单: 'permit-heavy-adapter',
  海嗣遗物容器: 'permit-seaborn-vessel', 猎人旧装承接书: 'permit-hunter-succession', 耀骑士接装敕令: 'permit-radiant-edict',
  医疗装置交接单: 'permit-medical-device-handover',
});
const PERMIT_LIMIT_KEYS = ['partnerTiers', 'partnerMaxTier', 'partnerProfession', 'partnerFaction', 'direction', 'receiverTiers', 'receiverMaxTier', 'receiverProfession', 'receiverFaction', 'donorTiers', 'donorMaxTier', 'donorProfession', 'donorFaction'];
const IDENTITY_CANONICAL = 'harmony-identity-card';
const STOPPED_LEGACY_NAMES = new Set(['随身身份牌', '变形同构体']);
// 2026-10-07 特殊战斗装备 第四版 (user: 「装备不再有精锐形态」「做就做呗」): one form per piece; special pieces only change how
// the wearer fights (numbers belong to badges). `ce(trigger, behavior, params)` is a single-effect combat piece.
const ce = (trigger, behavior, params, stats = undefined) => ({ mechanism: 'combatEquipment', params: { effects: [{ trigger, behavior, params }] }, ...(stats ? { stats } : {}) });
const EQUIPMENT_RULES = Object.freeze({
  // ---- special combat gear (gear v4) ----
  '谢拉格冰爪': ce('hit', 'deployFirstHitStatus', { status: 'cold', durationSeconds: 3, perDeploy: 1, resetOnDeploy: true }),
  '炎国缚锁': ce('attack', 'countedStatus', { status: 'bind', counterEvery: 6, durationSeconds: 1.5, target: 'primary' }),
  '萨尔贡流沙符': ce('attack', 'countedStatus', { status: 'sluggish', counterEvery: 4, durationSeconds: 2, target: 'primary' }),
  '源石促效溶剂': ce('hit', 'elementOnHit', { element: 'erosion', atkPercent: 0.1 }),
  '工程部标定信标': ce('attack', 'countedStatus', { status: 'fragile', value: 0.15, counterEvery: 5, durationSeconds: 3, target: 'primary' }),
  '精准狙击镜': ce('attack', 'targetPriority', { priority: 'lowestHp' }),
  '拉特兰速射扳机': ce('attack', 'doubleStrike', { counterEvery: 5 }),
  '阿戈尔神经毒棘': ce('hit', 'elementOnHit', { element: 'neural', atkPercent: 0.12 }),
  '战栗维式重锤': ce('attack', 'disarmOnHit', { status: 'tremble', durationSeconds: 4, steam: {} }),
  '叙拉古狼嚎哨': ce('attack', 'countedStatus', { status: 'fear', counterEvery: 12, durationSeconds: .75, target: 'primary' }),
  '萨尔贡行军浓茶': ce('attack', 'spChargeMode', { onAttack: 1 }),
  '卡西米尔破甲箭簇': ce('attack', 'countedStatus', { status: 'defDown', value: 0.2, counterEvery: 1, durationSeconds: 3, target: 'primary' }),
  '不屈部署支架': ce('death', 'deviceOnDown', { maxHpPercent: 0.5, blockCnt: 1 }),
  '莱塔尼亚共鸣音叉': ce('hit', 'countedStatus', { status: 'artsFragile', value: 0.15, durationSeconds: 3, damageType: 'arts' }),
  '阿戈尔深潜锚钩': ce('attack', 'pullOnHit', { counterEvery: 4, force: 0 }),
  '炎国制式短刀': ce('skillStart', 'skillStartStrike', { atkPercent: 0.8, type: 'phys' }),
  '坚固维式重锤': ce('lethalDamage', 'lethalGuard', { durationSeconds: 4, minimumHp: 1, reviveDoesNotReset: true, steam: { durationSeconds: 6 } }),
  '冲击维式重锤': ce('attack', 'knockbackOnHit', { force: 1, steam: {} }),
  '叙拉古仪仗正装': ce('deploy', 'stealthOnDeploy', { until: 'firstAttack' }),
  '突袭破片榴弹': ce('hit', 'deployFirstHitStatus', { status: 'stun', durationSeconds: 1, resetOnDeploy: true }),
  '源石激光组件': ce('attack', 'pierce', { depth: 1 }),
  '奥术抑制器': ce('attack', 'silenceOnHit', { durationSeconds: 3, immuneTargetsIgnored: true }),
  '莱茵生命浮空发生器': ce('attack', 'countedStatus', { status: 'levitate', counterEvery: 6, durationSeconds: 1.5, target: 'primary' }),
  '拉特兰跳弹模块': ce('hit', 'ricochet', { atkPercent: 0.5, radius: 2 }),
  '拉特兰备用桥夹': ce('ammoUsed', 'lastBulletRefund', { thresholdRemaining: 1, initialAmmoRatio: 0.2, rounding: 'floor', minimum: 1 }),
  '阿戈尔裂潮重刃': ce('hit', 'splash', { atkPercent: 0.4, radius: 1.5 }),
  '灼燃维式重锤': ce('hit', 'elementOnHit', { element: 'burn', damagePercent: 0.15, damageType: 'arts', steam: { damagePercent: 0.25 } }),
  '叙拉古处决令': ce('hit', 'conditionalDamage', { condition: 'targetHpBelow', hpRatio: 0.4, bonusPercent: 0.3 }),
  '卡西米尔竞技旗': ce('deploy', 'deployStrike', { atkPercent: 1.5, type: 'phys' }),
  '诱敌蜂鸣器': ce('deploy', 'attractOnDeploy', { durationSeconds: 2 }, { tauntLevel: 1 }),
  '应急伪装服': ce('damageTaken', 'firstDamageStatus', { status: 'stealth', durationSeconds: 6, preserveBlocking: true }),
  '防暴塔盾': ce('passive', 'staticStats', { stats: { blockCnt: 1 } }),
  'M3应急茧甲': ce('death', 'singleRevive', { delaySeconds: 1, maxHpRatio: 0.5, sameCell: true, counterPersists: true }),
  '医疗部共生血囊': ce('damage', 'healAllyOnDamage', { damagePercent: 0.1, radius: 2, targets: 1 }),
  '谢拉格不融冰': ce('attack', 'countedStatus', { counterEvery: 8, status: 'cold', durationSeconds: 1.5, target: 'primary' }),
  '谢拉格雪境猎印': ce('damage', 'factionVulnerable', { damagePercent: 0.1, durationSeconds: 5 }),
  '炎国点睛笔': ce('deploy', 'summonOnDeploy', { count: 1, statRatio: 0.5, blockCnt: 1, tokenId: 'token_10015_dusk_drgn' }),
  '萨尔贡链雷护符': ce('hit', 'ricochet', { atkPercent: 0.3, radius: 1, damageType: 'arts', normalOnly: true }),
  '维多利亚荆棘纹章': ce('passive', 'factionGuard', { damageReduction: 0.06 }),
  '天马骑士战盔': ce('skillStart', 'skillStartShield', { charges: 1, pairedSourceId: 'chess_item_6_01_e_a', breakBurstAtkPercent: 1, radius: 1 }),
  '催泪瓦斯组件': ce('attack', 'slowOnHit', { durationSeconds: 3, attackSpeedFlat: -5, moveSpeedPercent: -0.05, sameNameDoesNotStack: true, controlImmuneIgnored: true }),
  '双模机械臂': ce('hit', 'damageConversion', { from: ['nativePhysical', 'nativeArts'], to: 'weak', exclude: ['equipmentDamage', 'trueDamage'] }),
  '黑钢双联弹匣': ce('attack', 'extraTargets', { targets: 2 }),
  '萨米凋亡枝': ce('hit', 'elementOnHit', { element: 'apoptosis', atkPercent: 0.15 }),
  '拉特兰铳骑组件': ce('attack', 'countedExtraShot', { requiresTag: '拉特兰', counterEvery: 8, atkPercent: 1, type: 'phys', pairedSourceId: 'independent:拉特兰跳弹模块' }),
  '耶拉冈德之泪': ce('tick', 'coldAuraDamage', { requiresTag: '谢拉格', damageRatio: 0.15, condition: 'inRangeColdOrFrozen', pairedSourceId: 'chess_item_5_02_e_a', pairedDamageRatio: 0.25 }),
  '炎国天师古鼎': ce('skillStart', 'skillStartTeamStrike', { requiresTag: '炎', atkPercent: 0.6, pairedSourceId: 'chess_item_3_04_e_a', pairedAtkPercent: 1 }),
  '阿戈尔海沟实验体': ce('damageTaken', 'damageReductionAndRetaliation', { flatReduction: 0, minimumDamage: 1, requiresTag: '阿戈尔', retaliationAttackPercent: 0.4, pairedSourceId: 'independent:阿戈尔裂潮重刃', pairedSplashRadius: 1.5 }),
  '维多利亚蒸汽之心': ce('passive', 'steamGearUpgrade', { requiresTag: '维多利亚', sourceIds: ['chess_item_2_03_e_a', 'chess_item_3_09_e_a', 'chess_item_3_10_e_a', 'chess_item_4_09_e_a'], choose: 1 }),
  '萨尔贡黄沙罗盘': ce('skillEnd', 'skillRecast', { requiresTag: '萨尔贡', recasts: 1, pairedSourceId: 'chess_item_2_04_e_a', teamSpPerSkillStart: 2 }),
  '叙拉古家族印记': ce('stealthLost', 'stealthBreakDamage', { requiresTag: '叙拉古', stunSeconds: 1.5, pairedSourceId: 'chess_item_3_01_e_a', trueDamageAttackRatio: 1 }),
  '天马骑士长枪': ce('attack', 'pairedEquipmentHitDamage', { partnerSourceId: 'chess_item_5_09_e_a', trueDamageAttackRatio: 0.15, pairedRatio: 0.3, singleWorks: true }),
  '卡西米尔骑士戒律': ce('skillStart', 'redeployAndSkillWindow', { requiresTag: '卡西米尔', slowWindowSeconds: 10, slowPercent: 0.3, inRangeOnly: true, pairedSourceId: 'chess_item_4_07_e_a', pairedRedeployOnSkillEnd: true }),
  '工程部节拍校准器': ce('passive', 'counterAccelerator', { countPerAttack: 2 }),
  '罗德岛处置预案': ce('hit', 'controlledSplash', { statuses: ['stun', 'bind', 'freeze', 'levitate'], radius: 1.5 }),
  '医疗部蓄能电容': { mechanism: 'healingCapacitor', params: { thresholdMaxHpRatio: 0.2, damageRatio: 1, damageType: 'arts', range: 'adjacentFour', includeNativeHealing: true, ignoreSelf: true, ignoreOverheal: true, ignoreEquipmentHeal: true } },
  // ---- 工程部特供 that became mechanisms (user 10-07 「要改」) ----
  '罗德岛重装防护套件': ce('damageTaken', 'blockedAttackerStatus', { chance: 0.2, status: 'stun', durationSeconds: 1 }, { tauntLevel: 1 }),
  '精英干员战备箱': ce('kill', 'killSpGain', { sp: 2 }),
  '应急屏障组件': { mechanism: 'equipmentShield', params: { charges: 2 } },
  // ---- functional, production and number gear (not special) ----
  '后勤回收协议': { mechanism: 'saleThresholdRecruit', params: { normalSaleThreshold: 6, eliteSaleThreshold: 4, requiresSharedFaction: true, ordinaryOnly: true, maxTier: 'currentShop', choices: 3 } },
  '维多利亚校准砧': { mechanism: 'badgeAmplifier', params: { badgeIds: ['assault'], multiplier: 1.5, stats: ['attackPercent'] } },
  '熔铸模具': { mechanism: 'badgeAmplifier', params: { badgeIds: ['precision', 'agility', 'vitality', 'defense', 'assault', 'recovery', 'arcane', 'foresight', 'miracle', 'investor', 'unyielding', 'harmony', 'coordination', 'solitary', 'mastery'], multiplier: 1.25 } },
  // 10-07 干员表 v3: 精准 instead of 坚守 (「生命值是够用就行，伤害却是多多益善」), capped lower to match
  '增压臂铠': { mechanism: 'escalatingForge', params: { id: 'precision', start: 1, max: 16 } },
  '重型武装校准章': { mechanism: 'badgeAmplifier', params: { badgeIds: ['precision', 'assault'], multiplier: 2, stats: ['attackFlat', 'attackPercent'] } },
  '调和识别牌': { mechanism: 'identityTag', params: { chooseOnEquip: true } },
  '罗德岛便携锻炉': { mechanism: 'prepEndForge', params: { outputs: [{ id: 'precision', quantity: 1 }, { id: 'damage', quantity: 1 }], requiresOnField: true } },
  // ---- retired (design `retired`): nobody brings them; old saves keep them working, read with their normal values ----
  '迅捷作战口粮': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'deploy', behavior: 'deploySpRecovery', params: { base: 3, perSharedFactionAlly: 1 } }] } },
  '歌利亚防护盔': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'deploy', behavior: 'deployWindowStats', params: { noFrontAllyBonus: 0.1, duration: 'deployment' } }] }, stats: { maxHpPercent: 0.15 } },
  '阿戈尔沉海重刃': { mechanism: 'combatEquipment', params: { effects: [] }, stats: { attackPercent: 0.2, attackSpeedFlat: -5 } },
  '有限加速器': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'attack', behavior: 'eventStats', params: { attackSpeedFlat: 1, duration: 'battle' } }, { trigger: 'heal', behavior: 'eventStats', params: { attackSpeedFlat: 1, duration: 'battle', effectiveOnly: true } }] } },
  '休眠子裔': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'attack', behavior: 'healOnHit', params: { maxHpPercent: 0.01, oncePerAttack: true, excludedFromHealingTriggers: true } }] } },
  '应急浓缩嗅盐': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'statusApplied', behavior: 'statusImmunityAtHp', params: { statuses: ['stun', 'frozen'], minHpRatio: 0.8, doesNotCleanse: true } }] } },
  '医疗护盾无人机': { mechanism: 'combatEquipment', params: { effects: [{ trigger: 'heal', behavior: 'countedHealShield', params: { counterEvery: 6, shieldCharges: 1, mainTargetOnly: true, groupHealCountsOnce: true, skipTargetWithEquipmentShield: true } }] } },
  '近战训练记录仪': { mechanism: 'attackEventProduction', params: { counterEvent: 'attack', counterEvery: 15, outputs: [{ id: 'precision', quantity: 1 }], filter: { actor: 'self', nativeOnly: true } } },
  '拉特兰调速器': { mechanism: 'badgeAmplifier', params: { badgeIds: ['agility'], multiplier: 1.5, stats: ['attackSpeedFlat'] } },
  '医疗部稳态仪': { mechanism: 'badgeAmplifier', params: { badgeIds: ['vitality'], multiplier: 1.5, stats: ['maxHpFlat'] } },
  // ---- used items (补给, 玩家设施): one form now (no item is elite); the elite amounts below are never read ----
  '人事部增援许可': { mechanism: 'deployCap', params: { amount: 1, max: 9, perRunLimit: 1 } },
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
  弹药回收: { mechanism: 'eventProduction', params: { counterEvent: 'ammoUsed', counterEvery: 12, outputs: [{ id: 'agility', quantity: 1 }], filter: { actor: 'self', selectedAmmoSkill: true } } },
  寒区记录: { mechanism: 'eventProduction', params: { counterEvent: 'statusApplied', counterEvery: 1, outputs: [{ id: 'assault', quantity: 2 }], filter: { actor: 'self', targetSide: 'enemy', status: 'frozen', entered: true, nativeSource: true } } },
  医疗整备: { mechanism: 'eventProduction', params: { counterEvent: 'heal', counterEvery: 20, outputs: [{ id: 'vitality', quantity: 1 }], filter: { actor: 'self', nativeOnly: true, effective: true, excludeOverheal: true, excludeEquipment: true, groupHealCountsOnce: true } } },
});
const PRIZE_MECHANISMS = Object.freeze({
  应急营养补给: ['grantItems', { outputs: [{ id: 'precision', quantity: 3 }, { id: 'vitality', quantity: 3 }] }],
  额外采购配额: ['grantItems', { outputs: [{ id: 'chess_item_1_03_e_a', quantity: 2 }] }],
  新人征调令: ['recruitOffer', { tier: 1, elite: false, choices: 3, applyGainTrait: true }],
  全队战备支援: ['grantAllOperators', { outputs: [{ id: 'precision', quantity: 1 }, { id: 'damage', quantity: 1 }], cap: 8 }],
  标准战备升级: ['futureShopEquipment', { id: 'damage', quantity: 1, shopChessOnly: true, currentUnclaimed: true, noDuplicateOnFreeze: true }],
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
  const raw = EQUIPMENT_RULES[name] ?? KEYWORD_GEAR_BY_NAME[name];
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
    tier: Number(source.tier ?? normal.techLevel ?? normal.tier ?? 1),
    ...(source.nativeFactionTags === undefined ? {} : { nativeFactionTags: [...source.nativeFactionTags] }),
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

export function makeDarkmoonSupport(spec, data = getData()) {
  const id = String(spec.id); const faction = spec.faction || null;
  const prototypeTokenId = String(spec.prototypeTokenId || '');
  const token = data?.tokens?.[prototypeTokenId] || Object.values(data?.tokens || {}).find((x) => x?.tokenId === prototypeTokenId);
  const prototypeOwnerChessId = String(spec.prototypeOwnerChessId || token?.owners?.find((x) => x.endsWith('_a')) || '');
  const variant = token?.variants?.[prototypeOwnerChessId] || token;
  const prototypeStats = variant?.stats || token?.stats;
  if (!token || !prototypeStats || !prototypeOwnerChessId) throw new Error(`BAD_DARKMOON_SUPPORT_PROTOTYPE:${id}`);
  const pointScale = { attack: Number(spec.prototypeScale?.attack ?? 0.4), health: Number(spec.prototypeScale?.health ?? 0.4), defense: Number(spec.prototypeScale?.defense ?? 0.4) };
  const scale = { attack: pointScale.attack * Math.max(1, Number(spec.attack) || 1), health: pointScale.health * Math.max(1, Number(spec.health) || 1), defense: pointScale.defense };
  const attack = Math.round(Number(prototypeStats.atk || 0) * scale.attack);
  const health = Math.round(Number(prototypeStats.maxHp || 0) * scale.health);
  const defense = Math.round(Number(prototypeStats.def || 0) * scale.defense);
  const variantSkill = variant?.skill || token.skill || null;
  const normalChess = { ...clone(token), chessId: id, baseId: id, goldenId: null, isGolden: false, tier: 1, techLevel: 1, identifier: -1, isHidden: true, isDiy: false, visible: false,
    tokenId: prototypeTokenId, darkmoonPrototypeTokenId: prototypeTokenId, darkmoonPrototypeOwnerChessId: prototypeOwnerChessId,
    darkmoonPrototypeName: token.name || prototypeTokenId,
    darkmoonPrototypeScale: scale, darkmoonNativeChessId: prototypeOwnerChessId, darkmoonSupport: true,
    nativeGrowth: clone(token.nativeGrowth || null),
    name: spec.name, profession: 'TOKEN', position: token.position || 'MELEE', nationId: null, bonds: [], garrisonIds: [],
    stats: { ...clone(prototypeStats), maxHp: health, atk: attack, def: defense, blockCnt: 1 },
    rangeGrid: clone(variant?.rangeGrid || token.rangeGrid || [[0, 0], [0, 1]]),
    dmgType: variant?.dmgType || token.dmgType || 'phys', attackKind: variant?.attackKind || token.attackKind || 'melee',
    projectile: variant?.projectile || token.projectile || null, canHitFly: variant?.canHitFly ?? token.canHitFly ?? false,
    trait: clone(variant?.trait || token.trait || null), skill: clone(variantSkill), skills: variantSkill ? [clone(variantSkill)] : [],
    talents: clone(variant?.talents || token.talents || []), tokens: [], modules: [],
    assets: { avatar: prototypeTokenId, spine: prototypeTokenId }, status: { phase: Number(variant?.phase ?? 1), level: Number(variant?.level ?? 1), skillLevel: 1, equipLevel: 0 } };
  return { chessId: id, name: spec.name, tier: 1, profession: 'TOKEN', nativeFactionTags: faction ? [faction] : [], eliteChessId: null, elite: false, recruitable: false, mergeable: false, darkmoonSupport: true,
    darkmoonPrototypeTokenId: prototypeTokenId, darkmoonPrototypeOwnerChessId: prototypeOwnerChessId, darkmoonPrototypeName: token.name || prototypeTokenId, darkmoonPrototypeScale: scale,
    nativeTrait:{normalText:'支援单位',eliteText:'支援单位',text:'支援单位',sources:{normal:[],elite:[]},origin:'Darkmoon support prototype',effect:{prep:[],combat:[],unsupported:[]}},
    source:{charId:null,normalChess,eliteChess:null,skills:[],talents:[]}};
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
export function getCatalog(data = getData(), design = DESIGN) {
  const activeRosterIds = design.rules?.activeRosterIds;
  if (activeRosterIds !== undefined) {
    const ids = design.operators.map((x) => x.chessId);
    if (!Array.isArray(activeRosterIds) || activeRosterIds.some((x) => typeof x !== 'string' || !ids.includes(x) || !x.endsWith('_a')) || new Set(activeRosterIds).size !== activeRosterIds.length) {
      throw new Error('BAD_ACTIVE_ROSTER_IDS');
    }
  }
  for (const source of design.operators) {
    if (source.nativeFactionTags !== undefined && (!Array.isArray(source.nativeFactionTags) || source.nativeFactionTags.some((f) => typeof f !== 'string' || !f.trim()) || new Set(source.nativeFactionTags).size !== source.nativeFactionTags.length)) throw new Error(`BAD_NATIVE_FACTION_TAGS:${source.chessId}`);
    const tier = Number(source.tier ?? recordById(data?.chess, source.chessId)?.techLevel ?? recordById(data?.chess, source.chessId)?.tier ?? 1);
    if (!Number.isInteger(tier) || tier < 1 || tier > 6) throw new Error(`BAD_OPERATOR_TIER:${source.chessId}`);
  }
  const configuredTavernFactions = design.rules?.tavernFactions;
  if (configuredTavernFactions !== undefined && (!Array.isArray(configuredTavernFactions) || configuredTavernFactions.some((f) => typeof f !== 'string' || !f.trim()) || new Set(configuredTavernFactions).size !== configuredTavernFactions.length)) throw new Error('BAD_TAVERN_FACTIONS');
  const activeSet = activeRosterIds === undefined ? null : new Set(activeRosterIds);
  const operators = Object.create(null);
  for (const source of design.operators) {
    const op = makeOperator(source, recordById(data?.chess, source.chessId), data || {});
    op.recruitable = activeSet === null || activeSet.has(source.chessId);
    operators[op.chessId] = op;
    if (op.eliteChessId) operators[op.eliteChessId] = {
      ...clone(op), chessId: op.eliteChessId, baseChessId: op.chessId, elite: true,
      nativeTrait: { ...clone(op.nativeTrait), text: op.nativeTrait.eliteText, sourceRecords: clone(op.nativeTrait.sources.elite), effect: nativeEffectFor(source.chessId, source, true) },
    };
    operators[op.chessId].elite = false;
    operators[op.chessId].nativeTrait.text = op.nativeTrait.normalText;
    operators[op.chessId].nativeTrait.sourceRecords = clone(op.nativeTrait.sources.normal);
  }
  for(const spec of DARKMOON_SUPPORT_SPECS) {
    if(!spec?.id||!spec?.name||operators[spec.id])throw new Error(`BAD_DARKMOON_SUPPORT_PROTOTYPE:${spec?.id}`);
    operators[spec.id]=makeDarkmoonSupport(spec, data);
  }

  const badges = keyed(design.badges, (x) => BADGE_IDS[x.name], (x, id) => ({ ...clone(x), id, kind: 'badge', sourceId: null }));
  const equipment = Object.create(null);
  equipment['growth-training-record'] = { id: 'growth-training-record', sourceId: 'growth-training-record',
    name: '训练记录', level: 1, kind: 'equipment', mechanism: 'growthTraining', params: { levels: 1 },
    effect: '使用后，目标干员的原生成长等级提升一级；属性按该干员的成长曲线计算。',
    available: true, inheritable: false, unique: false, availableModes: ['levels'] };
  for (const item of design.legacy || []) {
    const canonicalId = STOPPED_LEGACY_NAMES.has(item.oldName) ? IDENTITY_CANONICAL : item.sourceId;
    const upstreamEliteId = item.sourceId.endsWith('_a') ? `${item.sourceId.slice(0, -2)}_b` : null;
    const rule = item.kind === '徽章' || item.kind === '停用' ? null : resolvedEquipmentRule(item.newName, item.kind === '停用');
    equipment[item.sourceId] = {
      ...clone(item), id: item.sourceId, sourceId: item.sourceId, canonicalId, uniqueKey: canonicalId,
      eliteId: item.eliteLevel == null ? null : upstreamEliteId,
      available: item.kind !== '停用', kind: item.kind,
      badgeId: BADGE_IDS[item.newName] || null,
      mechanism: item.kind === '徽章' ? 'badge' : item.kind === '停用' ? 'disabled' : rule.mechanism,
      params: clone(rule?.params || (BADGE_IDS[item.newName] ? { stat: design.badges.find((x) => x.name === item.newName)?.stat, value: design.badges.find((x) => x.name === item.newName)?.value } : {})),
      stats: clone(rule?.stats || null),
      upstream: clone(recordById(data?.chess, item.sourceId)),
      upstreamGarrisons: clone((recordById(data?.chess, item.sourceId)?.garrisonIds || []).map((gid) => recordById(data?.garrisons, gid)).filter(Boolean)),
    };
  }
  for (const item of design.extraGear || []) {
    const id = `independent:${item.name}`;
    const rule = resolvedEquipmentRule(item.name);
    const params = rule.mechanism === 'keywordGear'
      ? { ...clone(rule.params), ...clone(item.keywordParams ?? {}), gearId: rule.params.gearId }
      : rule.params;
    equipment[id] = { ...clone(item), id, sourceId: id, canonicalId: id, uniqueKey: id, eliteId: null, available: true, kind: 'equipment', mechanism: rule.mechanism, params, stats: rule.stats };
  }
  const identity = design.identityGear;
  if (identity) {
    const id = 'chess_item_identity_gear';
    const rule = resolvedEquipmentRule(identity.name);
    equipment[id] = { ...clone(identity), id, sourceId: id, canonicalId: IDENTITY_CANONICAL, uniqueKey: IDENTITY_CANONICAL, eliteId: null, available: true, kind: 'equipment', mechanism: rule.mechanism, params: rule.params, stats: rule.stats };
  }
  for (const item of design.prizeGear || []) {
    const id = PRIZE_GEAR_IDS[item.name];
    const rule = resolvedEquipmentRule(item.name);
    equipment[id] = { ...clone(item), id, sourceId: item.source || id, canonicalId: id, uniqueKey: id, eliteId: null, available: true, kind: 'prizeGear', mechanism: rule.mechanism, params: rule.params, stats: rule.stats };
  }

  // a permission is gear the operator brings when gained (session.js gainChess); it never moves in a handover
  for (const source of design.operators) {
    const permission = source.inheritance; if (!permission) continue;
    const id = PERMIT_GEAR_IDS[permission.gear];
    if (!id || Object.hasOwn(equipment, id)) throw new Error(`Independent permit gear has a missing or duplicate id: ${permission.gear}`);
    const op = operators[source.chessId];
    const autoGrant = permission.autoGrant !== false;
    equipment[id] = { id, sourceId: id, canonicalId: id, uniqueKey: id, name: permission.gear, kind: 'permit', mechanism: 'inheritancePermit',
      params: Object.fromEntries(PERMIT_LIMIT_KEYS.filter((k) => permission[k] !== undefined).map((k) => [k, clone(permission[k])])), stats: null,
      level: null, eliteLevel: null, eliteId: null, unique: true, inheritable: false, available: true, shopEligible: false,
      effect: String(permission.limit || '').replaceAll('被继承','接收').replaceAll('继承','交接'), ownerChessId: source.chessId, ownerName: source.name,
      ...(!autoGrant ? { legacyOnly:true, retired:true } : {}),
      ...(permission.sourceRefs ? {sourceRefs:{cards:clone(Array.isArray(permission.sourceRefs) ? permission.sourceRefs : permission.sourceRefs.cards || [])}} : {}) };
    if(autoGrant) {
      op.permitGearId = id;
      if (op.eliteChessId) operators[op.eliteChessId].permitGearId = id;
    } else {
      delete op.permitGearId;
      if (op.eliteChessId) delete operators[op.eliteChessId].permitGearId;
    }
  }
  // Retain stable legacy IDs so existing saves keep their equipment and permissions.
  for(const old of design.legacyPermissions||[]){
    const id=PERMIT_GEAR_IDS[old.wording||old.gear];if(!id||equipment[id])continue;
    const owner=design.operators.find(op=>op.name===old.name);
    equipment[id]={id,sourceId:id,canonicalId:id,uniqueKey:id,name:old.wording||old.gear,kind:'permit',mechanism:'inheritancePermit',
      params:Object.fromEntries(PERMIT_LIMIT_KEYS.filter(k=>old[k]!==undefined).map(k=>[k,clone(old[k])])),stats:null,
      level:null,eliteLevel:null,eliteId:null,unique:true,inheritable:false,available:true,shopEligible:false,legacyOnly:true,retired:true,
      effect:String(old.limit||'').replaceAll('被继承','接收').replaceAll('继承','交接'),ownerChessId:owner?.chessId,ownerName:old.name};
  }
  for (const op of Object.values(operators)) delete op.inheritance;
  const attachments = keyed(design.attachments, (x) => ATTACHMENT_IDS[x.name], (x, id) => ({ ...clone(x), id, mechanism: ATTACHMENT_RULES[x.name].mechanism, params: clone(ATTACHMENT_RULES[x.name].params) }));
  attachments['darkmoon-magnetic'] = { id:'darkmoon-magnetic', name:'机械合体组件', effect:'附加来源干员的本局战斗部署效果；不同来源可以分别触发。', mechanism:'darkmoonSourceAttachment', params:{ sourceIdRequired:true }, unique:false, inheritable:true, available:true };
  const prizes = keyed(design.prizes, (x) => PRIZE_IDS[x.name], (x, id) => ({
    ...clone(x), id,
    mechanism: PRIZE_MECHANISMS[x.name][0], params: clone(PRIZE_MECHANISMS[x.name][1]),
    gearIds: Object.keys(PRIZE_GEAR_IDS).filter((name) => x.effect?.includes(name)).map((name) => PRIZE_GEAR_IDS[name]),
  }));

  return {
    id: 'independent', name: '卫戍协议：工坊',
    config: {
      ...clone(design.rules || {}), purchasePrice: 3, sellPrice: 1, refreshPrice: 1,
      balance: { naturalIncomeStart: 3, naturalIncomeCap: 12 },
      equipmentCapacity: EQUIPMENT_CAPACITY, inventoryCapacity: INVENTORY_CAPACITY, basicBadgeCount: Object.values(badges).filter(b => b.available !== false && !b.retired && !b.unassigned).length, regularProductionBadgeCount: Object.values(badges).filter(b => b.regularProduction && b.available !== false && !b.retired && !b.unassigned).length,
      rareInheritanceOperators: Object.values(operators).filter(op => !op.elite && op.recruitable && op.permitGearId).length, bodyPenalty: clone(design.rules?.bodyPenalty),
      badgeRecipes: clone(design.badgeRecipes || design.recipes || {}),
      factionRecipes: {
        炎: ['precision'], 维多利亚: ['precision', 'vitality'], 拉特兰: ['agility'], 阿戈尔: ['vitality'],
        谢拉格: ['assault'], 萨尔贡: ['recovery'], 叙拉古: ['precision', 'assault'], 卡西米尔: ['defense', 'agility'],
      },
      tavernFactions: clone(design.rules?.tavernFactions || ['炎', '维多利亚', '拉特兰', '阿戈尔', '谢拉格', '萨尔贡', '叙拉古', '卡西米尔']),
      ...(activeRosterIds === undefined ? {} : { activeRosterIds: [...activeRosterIds] }),
      professionRecipes: { PIONEER: ['precision'], WARRIOR: ['precision'], SNIPER: ['precision'], SPECIAL: ['precision'], TANK: ['defense'], MEDIC: ['vitality'], CASTER: ['assault'], SUPPORT: ['recovery'] },
    },
    operators, badges, equipment, attachments, prizes,
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
    source: clone(design.source),
  };
}

export { BADGE_IDS };
