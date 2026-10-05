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
  '源石促效溶剂': { mechanism: 'statsAndDrain', params: { normal: { attackPercent: 0.2, hpLossPerSecond: 20 }, elite: { attackPercent: 0.3, hpLossPerSecond: 30, eliteLevel: 2 } } },
  '不屈部署支架': { mechanism: 'statsAndRedeploy', params: { normal: { redeployTimeReduction: 0.2, maxHpPercent: -0.15 }, elite: { redeployTimeReduction: 0.3, maxHpPercent: -0.2 } } },
  '医疗部蓄能电容': { mechanism: 'healingCapacitor', params: { thresholdMaxHpRatio: 0.2, damageRatio: 1, cooldownSeconds: 3, damageType: 'arts', range: 'adjacentFour', includeNativeHealing: true, ignoreSelf: true, ignoreOverheal: true, ignoreEquipmentHeal: true } },
  '近战训练记录仪': { mechanism: 'attackEventProduction', params: { counterEvent: 'attack', counterEvery: 15, outputs: [{ id: 'precision', quantity: 1 }], maxPerBattle: 4, filter: { actor: 'self', nativeOnly: true } } },
  '应急屏障组件': { mechanism: 'equipmentShield', params: { charges: 2 } },
  '精英干员战备箱': { mechanism: 'equipmentShield', params: { charges: 1 }, stats: { attackFlat: 50, maxHpFlat: 400, attackSpeedFlat: 10 } },
  '人事部增援许可': { mechanism: 'deployCap', params: { amount: 1, max: 9, perRunLimit: 1 } },
  '调和识别牌': { mechanism: 'identityTag', params: { chooseOnEquip: true } },
  '罗德岛便携锻炉': { mechanism: 'prepEndForge', params: { outputs: [{ id: 'precision', quantity: 1 }, { id: 'vitality', quantity: 1 }], requiresOnField: true } },
  '罗德岛采购券': { mechanism: 'fundsOnUse', params: { normalFunds: 1, eliteFunds: 2 } },
  '紧急征调凭证': { mechanism: 'shopRecruitOnUse', params: { normalCount: 1, eliteCount: 2, ordinaryOnly: true, removeShopSlot: true } },
  '后勤储蓄盒': { mechanism: 'facilityIncome', params: { normalIncome: 1, eliteIncome: 2, unique: true } },
  '阵营联络终端': { mechanism: 'factionRecruitOnUse', params: { normalOffers: 1, eliteOffers: 2, choices: 3, maxTier: 'shopLevel' } },
  '延期采购回执': { mechanism: 'deferredFundsOnUse', params: { normalFunds: 2, eliteFunds: 4 } },
  '骑士采购储金罐': { mechanism: 'conditionalFundsOnUse', params: { normalFunds: 2, eliteFunds: 4, condition: 'tierAtLeast4' } },
  '阵营征调模块': { mechanism: 'factionRecruitOnUse', params: { normalOffers: 1, eliteOffers: 2, choices: 3, maxTier: 'shopLevel' } },
  '拟态招募样本': { mechanism: 'recruitOnUse', params: { normalOffers: 1, eliteOffers: 2, choices: 3, preserveEliteSelection: true } },
  '博士晋升授权': { mechanism: 'promoteOnUse', params: { choices: 1, eliteOnly: true } },
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
    equipment[item.sourceId] = {
      ...clone(item), id: item.sourceId, sourceId: item.sourceId, canonicalId, uniqueKey: canonicalId,
      eliteId: item.eliteLevel == null ? null : upstreamEliteId,
      available: item.kind !== '停用', kind: item.kind,
      badgeId: BADGE_IDS[item.newName] || null,
      mechanism: EQUIPMENT_RULES[item.newName]?.mechanism || (item.kind === '徽章' ? 'badge' : item.kind === '停用' ? 'disabled' : 'equipmentEffect'),
      params: clone(EQUIPMENT_RULES[item.newName]?.params || (BADGE_IDS[item.newName] ? { stat: DESIGN.badges.find((x) => x.name === item.newName)?.stat, value: DESIGN.badges.find((x) => x.name === item.newName)?.value } : {})),
      stats: clone(EQUIPMENT_RULES[item.newName]?.stats || null),
    };
  }
  for (const item of DESIGN.extraGear || []) {
    const id = `independent:${item.name}`;
    equipment[id] = { ...clone(item), id, sourceId: id, canonicalId: id, uniqueKey: id, eliteId: null, available: true, kind: 'equipment', mechanism: EQUIPMENT_RULES[item.name]?.mechanism || 'equipmentEffect', params: clone(EQUIPMENT_RULES[item.name]?.params || {}), stats: clone(EQUIPMENT_RULES[item.name]?.stats || null) };
  }
  const identity = DESIGN.identityGear;
  if (identity) {
    const id = 'chess_item_identity_gear';
    equipment[id] = { ...clone(identity), id, sourceId: id, canonicalId: IDENTITY_CANONICAL, uniqueKey: IDENTITY_CANONICAL, eliteId: null, available: true, kind: 'equipment', mechanism: 'identityTag', params: clone(EQUIPMENT_RULES[identity.name].params) };
  }
  for (const item of DESIGN.prizeGear || []) {
    const id = PRIZE_GEAR_IDS[item.name];
    equipment[id] = { ...clone(item), id, sourceId: item.source || id, canonicalId: id, uniqueKey: id, eliteId: null, available: true, kind: 'prizeGear', mechanism: EQUIPMENT_RULES[item.name]?.mechanism || 'equipmentEffect', params: clone(EQUIPMENT_RULES[item.name]?.params || {}), stats: clone(EQUIPMENT_RULES[item.name]?.stats || null) };
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
      equipmentCapacity: 99, basicBadgeCount: 15, regularProductionBadgeCount: 6,
      rareInheritanceOperators: 12, bodyPenalty: clone(DESIGN.rules?.bodyPenalty),
      badgeRecipes: clone(DESIGN.badgeRecipes || DESIGN.recipes || {}),
      factionRecipes: {
        炎: ['precision'], 维多利亚: ['precision', 'vitality'], 拉特兰: ['agility'], 阿戈尔: ['vitality'],
        谢拉格: ['assault'], 萨尔贡: ['recovery'], 叙拉古: ['precision', 'assault'], 卡西米尔: ['defense', 'agility'],
      },
      professionRecipes: { PIONEER: ['precision'], WARRIOR: ['precision'], SNIPER: ['precision'], SPECIAL: ['precision'], TANK: ['defense'], MEDIC: ['vitality'], CASTER: ['assault'], SUPPORT: ['recovery'] },
    },
    operators, permissions, badges, equipment, attachments, prizes,
    nativeRegistry: {
      prepBehaviors: [...new Set(Object.values(operators).flatMap((op) => op.nativeTrait.effect.prep.map((x) => x.behavior)))].sort(),
      combatBehaviors: [...new Set(Object.values(operators).flatMap((op) => op.nativeTrait.effect.combat.map((x) => x.behavior)))].sort(),
      unsupported: [...new Set(Object.values(operators).flatMap((op) => op.nativeTrait.effect.unsupported || []))].sort(),
    },
    pools: Object.fromEntries(['pool_equip_rockr','pool_equip_pepe','pool_char_pinus','pool_equip_normal'].filter((id) => own(data?.choices?.pools,id)).map((id) => [id, clone(data.choices.pools[id])])),
    source: clone(DESIGN.source),
  };
}

export { BADGE_IDS };
