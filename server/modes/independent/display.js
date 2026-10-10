// Pure workshop catalog and session view projection. Kept shared by the HTTP and client-compute paths.
import { traitSummary, TRAIT_WHEN } from './summary.js';
import { INDEPENDENT_NEW_MODES } from '../../../shared/independentEconomy.js';
import { chessAvatarUrl } from '../../../public/js/ui/assetUrls.js';
import { quantityEquippable } from '../../../shared/independentInventory.js';
import { darkmoonCombatEligibilityRules, darkmoonCombatMetadata } from '../../sim/content/independent/darkmoonCombat.js';

/** The hand-written player texts are the same source used by the HTTP catalog. */
export function independentDisplayCatalog(data, catalog, gameText = data['independent-game-text'] || {}) {
  const baseChessId = (id) => String(id).replace(/_b$/, '_a');
  const BADGE_STATS = { attackFlat: '基础攻击力', attackBasePercent: '基础攻击力', attackPercent: '攻击力', attackSpeedPercent: '基础攻击速度', maxLifeFlat: '基础最大生命值', maxLifeBasePercent: '基础最大生命值', maxLifePercent: '最大生命值', defenceFlat: '基础防御力', defenseBasePercent: '基础防御力', attackSpeedFlat: '攻击速度', naturalSkillRecoveryFlat: '每秒自然技力恢复', naturalSkillRecoveryPercent: '自然技力回复', artsResistanceFlat: '法术抗性', artsDamageReduction: '法术伤害减免', initialSkillPointsFlat: '初始技力', skillCostInitialPercent: '初始技力', physicalAndArtsDodge: '物理与法术闪避率', lifeRecoveryFlat: '每秒生命恢复', maxLifeRecoveryPercent: '最大生命值回复', healingDealtPercent: '治疗量', physicalAndArtsDamageReduction: '物理与法术伤害减免', redeployTimeReduction: '再部署时间缩减', normalAttackDamagePercent: '普通攻击伤害' };
  const BADGE_RATIOS = new Set(['attackBasePercent', 'attackPercent', 'attackSpeedPercent', 'maxLifeBasePercent', 'maxLifePercent', 'defenseBasePercent', 'naturalSkillRecoveryPercent', 'artsDamageReduction', 'skillCostInitialPercent', 'physicalAndArtsDodge', 'maxLifeRecoveryPercent', 'healingDealtPercent', 'physicalAndArtsDamageReduction', 'redeployTimeReduction', 'normalAttackDamagePercent']);
  const gearDescription = (record) => {
    if (record.normal || record.effect) return record.normal || record.effect;
    const stat = BADGE_STATS[record.stat];
    if (stat && typeof record.value === 'number') return `${stat}增加${BADGE_RATIOS.has(record.stat) ? `${Number((record.value * 100).toFixed(4))}%` : record.value}。${record.note || ''}`;
    return record.note || '';
  };
  BADGE_STATS.damageDealtPercent = '造成伤害';
  BADGE_RATIOS.add('damageDealtPercent');
  const operators = Object.fromEntries(Object.entries(catalog.operators).map(([id, op]) => {
    const raw = op.elite ? op.source.eliteChess || op.source.normalChess : op.source.normalChess;
    const rules = [...(op.nativeTrait.effect?.prep || []), ...(op.nativeTrait.effect?.combat || [])];
    const eliteOp = op.eliteChessId ? catalog.operators[op.eliteChessId] : null;
    const eliteRules = [...(eliteOp?.nativeTrait.effect?.prep || []), ...(eliteOp?.nativeTrait.effect?.combat || [])];
    const deliveryAt = (form, index, trigger) => {
      const list = form?.effectDelivery?.normal || form?.nativeTrait?.effectDelivery?.normal || [];
      const entry = list[index]?.trigger === trigger ? list[index] : list.find((x) => x.trigger === trigger);
      return entry || rules[index]?.effectDelivery || null;
    };
    const deliveryAtElite = (index, trigger) => {
      const list = op?.effectDelivery?.elite || op?.nativeTrait?.effectDelivery?.elite
        || eliteOp?.effectDelivery?.elite || eliteOp?.nativeTrait?.effectDelivery?.elite || eliteOp?.effectDelivery?.normal || [];
      const entry = list[index]?.trigger === trigger ? list[index] : list.find((x) => x.trigger === trigger);
      return entry || eliteRules[index]?.effectDelivery || null;
    };
    return [id, { name: op.name, tier: op.tier, elite: op.elite, position: raw.position, profession: raw.profession,
      eliteChessId: op.eliteChessId || null, baseChessId: op.chessId || id,
      avatar: chessAvatarUrl(data.assets, raw), nativeTrait: op.nativeTrait.text, permitGear: op.permitGearId || null,
      sourceRefs: op.sourceRefs || null,
      effectDelivery: op.effectDelivery || op.nativeTrait.effectDelivery || null,
      effectDeliveryElite: eliteOp?.effectDelivery || eliteOp?.nativeTrait.effectDelivery || null,
      darkmoonDeploymentPayload: darkmoonCombatMetadata(op.sourceRefs?.darkmoon19_2?.id,!!op.elite),
      nativeStats: raw.stats || {}, nativeFactions: op.nativeFactionTags || (raw.bonds || []).map((bond) => ({ yanShip: '炎', victoriaShip: '维多利亚', lateranoShip: '拉特兰', egirShip: '阿戈尔', kjeragShip: '谢拉格', sargonShip: '萨尔贡', siracusaShip: '叙拉古', kazimierzShip: '卡西米尔' })[bond]).filter(Boolean),
      effectRules: { prep: op.nativeTrait.effect?.prep || [], combat: op.nativeTrait.effect?.combat || [] },
      effectRulesElite: { prep: eliteOp?.nativeTrait.effect?.prep || [], combat: eliteOp?.nativeTrait.effect?.combat || [] },
      traitTexts: gameText.operators?.[baseChessId(id)] ? { ...gameText.operators[baseChessId(id)] }
        : { normal: op.nativeTrait.normalText, elite: op.nativeTrait.eliteText },
      summary: [...traitSummary(op.nativeTrait.effect).map((entry, index) => ({ ...entry,
        ...(rules[index] ? { rule: { behavior: rules[index].behavior, params: rules[index].params || {} } } : {}),
        ...(deliveryAt(op, index, rules[index]?.trigger) ? { effectDelivery: deliveryAt(op, index, rules[index]?.trigger) } : {}),
      })), ...darkmoonCombatEligibilityRules(op.sourceRefs?.darkmoon19_2?.id).map(rule=>({kind:'conditional',rule,effectDelivery:darkmoonCombatMetadata(op.sourceRefs?.darkmoon19_2?.id,!!op.elite)}))],
      summaryElite: eliteOp ? [...traitSummary(eliteOp.nativeTrait.effect).map((entry, index) => ({ ...entry,
        ...(eliteRules[index] ? { rule: { behavior: eliteRules[index].behavior, params: eliteRules[index].params || {} } } : {}),
        ...(deliveryAtElite(index, eliteRules[index]?.trigger) ? { effectDelivery: deliveryAtElite(index, eliteRules[index]?.trigger) } : {})
      })), ...darkmoonCombatEligibilityRules(op.sourceRefs?.darkmoon19_2?.id).map(rule=>({kind:'conditional',rule,effectDelivery:darkmoonCombatMetadata(op.sourceRefs?.darkmoon19_2?.id,true)}))] : null,
      skills: (raw.skills || []).filter(s=>!raw.nativeImport||raw.nativeImport.supportedSkillIds?.includes(s.skillId)), modules: (raw.modules || []).map((x) => ({ ...x, id: x.uniEquipId || x.id })) }];
  }));
  const gear = Object.fromEntries([...Object.entries(catalog.badges), ...Object.entries(catalog.equipment)].map(([id, d]) => {
    const steam = d.params?.effects?.find((x) => x.behavior === 'steamGearUpgrade');
    const text = gameText.gear?.[id];
    const steamLimit = steam ? steam.params.chooseVariantsOnEquip : undefined;
    return [id, { name: d.newName || d.name, level: d.level,
      normal: text ? text.normal : gearDescription(d), normalLevels:d.normalLevels, kind: d.kind, unique: !!d.unique, inheritable: d.inheritable !== false, mechanism: d.mechanism,
      ...(d.mechanism !== 'badge' && d.params ? { params: d.params } : {}), ...(d.condition ? { condition: d.condition } : {}), ...(d.effectDelivery ? { effectDelivery: d.effectDelivery } : {}), quantityEquippable: quantityEquippable(d),
      sourceId: d.sourceId, iconItemId:d.iconItemId, available: d.available !== false, steamOptions: steam?.params.sourceIds,
      steamLimit: steamLimit && typeof steamLimit === 'object' ? steamLimit.normal : (steamLimit ?? (steam ? steam.params.choose ?? 1 : undefined)),
      identityFactions: d.mechanism === 'identityTag' ? catalog.config.tavernFactions : undefined,
      ...(d.kind === 'badge' ? { stat: d.stat, value: d.value, statName: BADGE_STATS[d.stat] || null, ratio: BADGE_RATIOS.has(d.stat) } : {}),
      ...(d.params?.normalCount != null ? { useCount: Number(d.params.normalCount) } : {}) }];
  }));
  const PRIZE_STAGE = { 起步: '起步', 成型: '成型', 兑现: '决胜', 终极:'终极' };
  const prizes = Object.fromEntries(Object.entries(catalog.prizes).map(([id, d]) => [id, { name: d.name, effect: gameText.prizes?.[id]?.text ?? d.effect, mechanism: d.mechanism, normalEffect:d.normalEffect, levelsEffect:d.levelsEffect, params:d.params, sourceRefs:d.sourceRefs, iconItemId:d.iconItemId, stage: PRIZE_STAGE[d.stage] || null }]));
  for (const [id, t] of Object.entries(gameText.prizes || {})) if (!prizes[id]) prizes[id] = { name: t.name, effect: t.text, mechanism: 'fallback', stage: null };
  const attachments = Object.fromEntries(Object.entries(catalog.attachments).map(([id, d]) => [id, { name: d.name, effect: gameText.attachments?.[id]?.text ?? d.effect, mechanism: d.mechanism }]));
  return { name: catalog.name, operators, gear, prizes, attachments, terms: gameText.terms,
    factions: catalog.config.tavernFactions, factionDetails: catalog.factionDetails || catalog.config.factionDetails || {},
    rules: { purchasePrice: catalog.config.purchasePrice, sellPrice: catalog.config.sellPrice, refreshPrice: catalog.config.refreshPrice,
      equipmentCapacity: catalog.config.equipmentCapacity, inventoryCapacity: catalog.config.inventoryCapacity, factionIdentityEquipment:catalog.config.factionIdentityEquipment, bodyPenalty: { baseAttackRatio: catalog.config.bodyPenalty?.baseAttackRatio ?? 0.8, baseLifeRatio: catalog.config.bodyPenalty?.baseLifeRatio ?? 0.8 } },
    traitWhen: TRAIT_WHEN,
    modes: INDEPENDENT_NEW_MODES };
}

/** Project a validated native session to the same renderer packet used by the HTTP transport. */
export function independentSessionView(state, { data, catalog, display, viewSession }) {
  const view = viewSession(state, { data, catalog });
  const { pool, history, catalog: ignoredCatalog, ...thin } = view;
  thin.lastBattle = history.findLast((x) => x.type === 'battle') || null;
  thin.pieces = thin.pieces.map((piece) => ({ ...piece,
    equipmentDetails: (piece.equipmentDetails || []).map((item) => ({ ...item, record: display.gear[item.id] })),
    attachmentDetails: (piece.attachmentDetails || []).map((item) => ({ ...item, record: display.attachments[item.id] })) }));
  return thin;
}
