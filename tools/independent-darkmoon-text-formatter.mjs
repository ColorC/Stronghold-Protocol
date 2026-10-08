#!/usr/bin/env node
// Rebuild Darkmoon-facing Chinese text from executable source rules and delivery parameters.
// This edits only descriptive fields; behavior IDs and params remain the mechanic source of truth.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { darkmoonPrepRulesFor } from '../server/modes/independent/darkmoonPrep.js';
import { darkmoonCombatMetadata } from '../server/sim/content/independent/darkmoonCombat.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const addonPath = path.join(root, 'data/independent-darkmoon-game-text-addon.json');
const blueprintPath = path.join(root, 'data/independent-darkmoon-blueprints.json');
const gears = new Map([
  ['坚守盟约', '坚守盟约'], ['护盾发生器', '护盾发生器'], ['不屈盟约', '不屈盟约'],
  ['精准盟约', '精准盟约'], ['巨锤盟约', '巨锤盟约'], ['oath-cover', '坚守盟约'],
]);
const badgeNames = Object.freeze({ precision: '精准徽章', agility: '敏捷徽章', damage: '攻击徽章', vitality: '活力徽章', defense: '防护徽章', assault: '强袭徽章', recovery: '恢复徽章', arcane: '术法徽章', foresight: '洞察徽章', miracle: '奇迹徽章', investor: '投资徽章', unyielding: '坚毅徽章', harmony: '协同徽章', coordination: '协调徽章', solitary: '孤勇徽章', mastery: '精通徽章' });
const recipientNames = Object.freeze({
  self: '自身', hand: '整备区手牌', inventory: '装备栏', shop: '酒馆', playerResource: '玩家资源', shopUpgradeCost: '酒馆升级费用',
  selectedFriendlyDragon: '你选择的一名友方卡西米尔干员', selectedFriendlyBeast: '你选择的一名友方叙拉古干员',
  selectedFriendlyMechanical: '你选择的一名友方哥伦比亚干员', selectedFriendlyPirate: '你选择的一名友方维多利亚干员',
  selectedFriendlyOperator: '你选择的一名友方干员', selectedColumbiaFriendly: '你选择的一名友方哥伦比亚干员',
  selectedShopMinion: '你选择的一名未售出酒馆干员', currentShopOffers: '当前酒馆在售干员', matchingTribeShopOffers: '符合阵营条件的酒馆在售干员',
  newSiracusaRecruit: '新获得或首次上阵的叙拉古干员', oneRandomFriendlyPerFaction: '每个阵营各一名随机友方干员',
  oneRandomOtherFriendly: '一名随机的其他友方干员', oneRandomOtherFriendlyMappedFaction: '一名随机的其他友方炎阵营干员',
  threeFriendlyDifferentFactions: '三名不同阵营的友方干员', leftmostFriendly: '最左侧友方干员',
  randomOtherFriendly: '一名随机的其他友方干员', randomOtherFriendlyMechanical: '一名随机的其他友方哥伦比亚干员',
  allFriendlyWithTaunt: '所有装备坚守盟约的友方干员', allFriendlyDragonOperators: '所有友方卡西米尔干员',
  allOtherFriendlyMappedFaction: '所有其他友方哥伦比亚干员', otherFriendlyElementals: '其他友方炎阵营干员',
  otherFriendlyPirates: '其他友方维多利亚干员', adjacentFriendlyOperators: '相邻友方干员', friendlyWarbandSupport: '友方阵容中的整备区',
  combatSummonAndHand: '战斗召唤单位与整备区手牌', originalBattlecryOutputs: '获得时效果的目标',
  oneRandomOtherFriendly: '一名随机的其他友方干员', '卡西米尔友方': '卡西米尔友方干员', '叙拉古友方': '叙拉古友方干员',
  '战场': '战场单位', '所有友方': '所有友方干员', '自身': '自身', '自身附近的友方': '自身附近的友方干员',
  '触发效果的友方': '触发效果的友方干员', '退场干员附近的友方': '退场干员附近的友方干员', '随机友方': '随机一名友方干员',
});
const triggerNames = Object.freeze({ gain: '招募获得或首次上阵时', bought: '购买时', sold: '出售时', prepEnd: '每回合休整结束时', roundStart: '每回合休整开始时', combatStart: '战斗开始时', battlecryMultiplier: '获得时效果触发时' });
const durationNames = Object.freeze({
  currentShopOnly: '仅当前商店有效', frozenUntilPurchase: '购买前保持冻结', immediateOnSale: '出售时立即结算', nextRefreshes: '后续刷新期间生效',
  nextUpgrade: '下次酒馆升级前生效', permanent: '永久生效', permanentAttachment: '本局永久附加', permanentTransformation: '本局永久转化',
  permanentWornGear: '本局永久穿戴', permanentWornGrowth: '本局永久成长', thisTurnOnly: '仅本回合生效', untilFirstPlay: '首次上阵前保留',
  untilPlayedOrSold: '上阵或出售前保留', untilRecruited: '招募前保留', untilSoldOrRetired: '出售或退场前保留', whileOwnerOnField: '持有干员在场时生效',
  整备区: '整备区', 本场战斗: '本场战斗', 本局永久: '本局永久',
});
const pick = (x, variant) => Number(x && typeof x === 'object' ? (x[variant] ?? x.normal ?? 0) : (x ?? 0));
const qty = n => `×${Number(n)}`;
const factionText = f => f ? `${f}阵营` : '友方';
const whenText = trigger => ({
  gain: '招募获得或首次上阵时', bought: '购买符合条件的干员时', sold: '出售时',
  prepEnd: '每回合休整结束时', roundStart: '每回合休整开始时',
  combatStart: '战斗开始时', aura: '在场期间',
})[trigger] || `${trigger}时`;
function units(p, variant) {
  const attack = pick(p.attackUnits ?? p.attackPer, variant);
  const secondary = pick(p.secondaryUnits ?? p.secondaryPer, variant);
  return { attack, secondary };
}
function growth(attack, secondary, variant) {
  const bits = [];
  if (attack) bits.push(`攻击成长徽章${qty(attack)}`);
  if (secondary) bits.push(`职业副属性成长徽章${qty(secondary)}`);
  return bits.length ? `${bits.join('与')}；成长永久保留` : '';
}
function prepText(sourceId, rule, variant) {
  const p = rule.params || {}, when = whenText(rule.trigger), amount = pick(p.count, variant);
  const { attack, secondary } = units(p, variant);
  const items = (p.outputs || []).map(x => {
    const id = String(x.id).replace(/^independent:/, '');
    const name = gears.get(id) || badgeNames[id] || '装备';
    return { name, n: pick(x, variant) };
  }).filter(x => x.n);
  const selected = faction => `你选择的一名友方${factionText(faction)}干员`;
  switch (rule.behavior) {
    case 'grantEquipment': return items.length ? `${when}，自身永久装备${items.map(x => `${x.name}${qty(x.n)}`).join('、')}。` : '';
    case 'darkmoonEndTurnGrowth': {
      const mode = p.mode;
      let target = '自身';
      if (mode === 'randomEachFaction') target = '每个阵营各一名随机友方干员';
      else if (mode === 'randomDistinctFaction') target = `${pick(p.targets, variant)}名不同阵营的随机友方干员`;
      else if (mode === 'randomOtherFaction') target = `一名随机的其他友方${factionText(p.faction)}干员`;
      else if (mode === 'randomOtherFriendly') target = '一名随机的其他友方干员';
      else if (mode === 'leftmostPerPurchase') target = '最左侧友方干员';
      const multiplier = mode === 'selfPerFaction' ? '每名在场友方同阵营干员各结算一次' : mode === 'selfPerDistinctFaction' ? '每个不同友方阵营各结算一次' : mode === 'selfIfGolden' ? '仅当阵容中有进阶干员时' : '';
      const n = mode === 'selfPerFaction' || mode === 'selfPerDistinctFaction' || mode === 'leftmostPerPurchase'
        ? growth(pick(p.attackPer, variant), pick(p.secondaryPer, variant), variant)
        : growth(attack, secondary, variant);
      return `${when}，${multiplier ? `${multiplier}，` : ''}${target}获得${n || '训练成长'}。`;
    }
    case 'darkmoonPreviousWinSelfGrowth': return `${when}，若上一场战斗获胜，自身获得${growth(attack, secondary, variant)}。`;
    case 'darkmoonBattlecryFactionGrowth': {
      const who = p.excludeSelf ? `除自身外的所有友方${factionText(p.faction)}干员` : `所有友方${factionText(p.faction)}干员`;
      const parts = [];
      if (p.outputs?.includes('precision')) parts.push(`攻击成长徽章${qty(amount)}`);
      if (p.outputs?.some(x => x !== 'precision')) parts.push(`职业副属性成长徽章${qty(amount)}`);
      return `具有获得时效果的友方干员入队时，${who}各获得${parts.join('与')}；成长永久保留。`;
    }
    case 'darkmoonBattlecryTargetGrowth': {
      if (p.perTribeBought) {
        const each = pick(p.perTribeBought, variant);
        return `每购买一名维多利亚阵营干员，你选择的一名友方维多利亚干员获得攻击成长徽章${qty(each)}与职业副属性成长徽章${qty(each)}；按本局已购买的维多利亚干员数量累加，永久保留。`;
      }
      const count = p.fixedCount !== undefined ? pick(p.fixedCount, variant) : p.perTribeBought ? `${pick(p.perTribeBought, variant)}枚每名已购买${factionText(p.faction)}干员` : null;
      const n = (p.attackUnits !== undefined || p.secondaryUnits !== undefined) ? growth(attack, secondary, variant) : `${p.outputs?.includes('precision') ? `攻击成长徽章${qty(count)}` : ''}${p.outputs?.some(x => x !== 'precision') ? `与职业副属性成长徽章${qty(count)}` : ''}`;
      const bonus = p.extraGear?.length ? `，并永久装备${p.extraGear.map(x => gears.get(String(x).replace(/^independent:/, '')) || '装备').join('、')}` : '';
      return `${when}，${selected(p.faction)}获得${n}${n.includes('成长永久保留')?'':'；成长永久保留'}${bonus}。`;
    }
    case 'darkmoonBoughtTribeTargetGrowth': return `每次购买炎阵营干员时，选择一名友方干员；效果触发${pick(p.repeatCount, variant)}次，每次使其获得与所购干员星级等量的攻击成长徽章和职业副属性成长徽章，永久保留。`;
    case 'darkmoonBoughtSelfGrowth': return `${when}，购买${factionText(p.faction)}干员时，自身获得${growth(attack, secondary, variant)}。`;
    case 'darkmoonBeastSummonGrowth': return `每当其他友方叙拉古干员新获得或首次上阵时，该干员获得${growth(attack, secondary, variant)}。`;
    case 'darkmoonPlayedTribeGrowth': return `每有一名炎阵营干员新获得或首次上阵，选择一名其他友方炎阵营干员，使其获得${growth(attack, secondary, variant)}。`;
    case 'darkmoonPlayedFactionCountSelfGrowth': return `每有一名炎阵营干员新获得或首次上阵，自身获得攻击成长徽章${qty(pick(p.attackUnits, variant))}及职业副属性成长徽章${qty(pick(p.secondaryUnitsPerTarget, variant))}；按在场炎阵营干员数累加，永久保留。`;
    case 'darkmoonPlayedTagSelfGrowth': return `每有一名带有退场效果的友方干员新获得或首次上阵，自身获得${growth(attack, secondary, variant)}。`;
    case 'darkmoonAdjacentGrowth': return `招募获得或首次上阵时，相邻友方干员各获得${growth(attack, secondary, variant)}${p.extraGear?.length ? `，并永久装备${p.extraGear.map(x => gears.get(String(x).replace(/^independent:/, '')) || '装备').join('、')}` : ''}。`;
    case 'darkmoonTaggedGrowth': return `招募获得或首次上阵时，所有已装备坚守盟约的友方干员各获得${growth(attack, secondary, variant)}。`;
    case 'darkmoonMagneticMerge': return sourceId === 'BOT_911'
      ? `招募获得或首次上阵时，可直接招募；也可消耗此干员，为你选择的一名友方哥伦比亚干员永久装备坚守盟约和护盾发生器，并使其获得攻击成长徽章${qty(attack)}及职业副属性成长徽章${qty(secondary)}；本体不进入阵容。`
      : `招募获得或首次上阵时，可直接招募；也可消耗此干员，将其亡语附加给你选择的一名友方哥伦比亚干员，并使其获得攻击成长徽章${qty(attack)}及职业副属性成长徽章${qty(secondary)}；本体不进入阵容。`;
    case 'darkmoonSummonSupport': return `招募获得或首次上阵时，免费将一个猫形支援单位（攻击${variant === 'elite' ? 240 : 120}、生命${variant === 'elite' ? 700 : 350}）放入整备区；可部署，本体不可商店招募。`;
    case 'darkmoonTransformFromShop': return `招募获得或首次上阵时，选择一名未售出的酒馆干员；将该格干员转化为${variant === 'elite' ? '进阶' : '普通'}形态并招募。`;
    case 'darkmoonRosterTribePurchaseFunds': return `购买维多利亚阵营干员时，获得${amount}枚金币。`;
    case 'darkmoonShopGrowth': {
      const reward = `购买后直接获得${growth(pick(p.attack, variant), pick(p.health, variant), variant)}。`;
      return p.persistent
        ? `在场时，每购买一名${factionText(p.faction)}干员，使当前及本局后续酒馆中的${factionText(p.faction)}干员累加以下成长：${reward}`
        : `出售自身时，使当前酒馆所有未售出的干员累加以下成长：${reward}只影响当前商店。`;
    }
    case 'darkmoonAddTribeShopOffer': return `招募获得或首次上阵时，将${amount}名随机炎阵营干员加入酒馆并冻结。`;
    case 'darkmoonRecruitTribeToHand': return `招募获得或首次上阵时，生成${amount}次随机炎阵营干员的招募选择，供整备时选择。`;
    case 'darkmoonElementalTokenOffer': return `出售时，将${amount}个炎阵营元素支援单位（每个攻击240、生命700）加入整备区手牌；可部署，本体不可商店招募。`;
    case 'darkmoonLastWarbandRecruit': return `招募获得或首次上阵时，从上一回合友方阵容中随机招募一名干员；${variant === 'elite' ? '以进阶形态' : '以普通形态'}加入，保留其原生效果。`;
    case 'factionReaction': return p.mode === 'funds' ? `出售时获得${amount}枚金币。` : `招募获得或首次上阵时，下次酒馆升级费用减少${amount}金币；每回合最多触发3次。`;
    case 'freeRefresh': return `招募获得或首次上阵时，立即免费刷新酒馆${pick(p, variant)}次。`;
    case 'triggerMultiplier': return `在场时，你的获得时效果共触发${1 + pick(p.extra, variant)}次；不重复其他整备效果。`;
    case 'darkmoonSummonSupport': return '招募获得或首次上阵时，召唤猫形支援单位加入整备区。';
    default: return '';
  }
}

function cleanCombat(id, variant) {
  const meta = darkmoonCombatMetadata(id, variant === 'elite');
  if (!meta?.text) return '';
  let text = meta.text;
  text = text.replace(/攻击徽章×(\d+)，依职业配置的副属性装备×(\d+)/g, (_, a, b) => `攻击徽章${qty(a)}与职业副属性徽章${qty(b)}`)
    .replace(/攻击徽章×(\d+)及五层护盾/g, (_, a) => `攻击徽章${qty(a)}及护盾层数+5`)
    .replaceAll('本场最多二十五次', '每3秒最多触发一次，每场最多25次')
    .replaceAll('每三秒触发一次', '每3秒最多触发一次')
    .replaceAll('每三秒一轮', '每3秒最多触发一轮')
    .replaceAll('原型', '干员的作战投影')
    .replaceAll('作战支援单位', '作战支援单位')
    .replace(/按当前攻击成长计算，最多七个个/g, '按当前攻击成长计算，最多7个');
  return text;
}

export function toLevels(text) {
  return text.replace(/攻击成长徽章×(\d+)与职业副属性成长徽章×(\d+)/g, (_, a, b) => `训练等级${qty(Number(a) + Number(b))}`)
    .replace(/攻击徽章×(\d+)与职业副属性徽章×(\d+)/g, (_, a, b) => `训练等级${qty(Number(a) + Number(b))}`)
    .replace(/(?:精准|敏捷|攻击|活力|防护|强袭|恢复|术法|洞察|奇迹|投资|坚毅|协同|协调|孤勇|精通)徽章×(\d+)/g, (_, n) => `训练等级${qty(n)}`)
    .replace(/攻击成长徽章×(\d+)/g, (_, n) => `训练等级${qty(n)}`)
    .replace(/职业副属性成长徽章×(\d+)/g, (_, n) => `训练等级${qty(n)}`)
    .replace(/攻击徽章×(\d+)/g, (_, n) => `训练等级${qty(n)}`)
    .replace(/职业副属性徽章×(\d+)/g, (_, n) => `训练等级${qty(n)}`);
}
export function renderedPrepRows(entry, variant) {
  const id = entry.sourceId;
  return darkmoonPrepRulesFor({ darkmoonSourceId: id }, variant === 'elite')
    .map(rule => ({ behavior: rule.behavior, trigger: rule.trigger, text: prepText(id, rule, variant) }))
    .filter(row => row.text);
}
export function textsFor(entry, variant) {
  const prep = renderedPrepRows(entry, variant).map(row => row.text);
  const combat = cleanCombat(entry.sourceId, variant);
  return [...prep, ...(combat ? [combat] : [])];
}
function main() {
  const addon = JSON.parse(fs.readFileSync(addonPath, 'utf8'));
  const blueprints = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
  const byId = new Map(blueprints.entries.map(x => [x.sourceId, x]));
  const rewritten = new Map();
  for (const item of Object.values(addon.operators)) {
    const entry = byId.get(item.sourceId);
    if (!entry) throw new Error(`DARKMOON_BLUEPRINT_MISSING:${item.sourceId}`);
    const normal = textsFor(entry, 'normal');
    const elite = textsFor(entry, 'elite');
    const normalText = normal.join('\n') || cleanCombat(item.sourceId, 'normal') || '战斗中执行对应的干员效果。';
    const eliteText = elite.join('\n') || cleanCombat(item.sourceId, 'elite') || normalText;
    const next = { ...item, normal: normalText, elite: eliteText, normalLevels: toLevels(normalText), eliteLevels: toLevels(eliteText) };
    item.normal = next.normal; item.elite = next.elite; item.normalLevels = next.normalLevels; item.eliteLevels = next.eliteLevels;
    rewritten.set(item.sourceId, { normal, elite });
  }
  for (const entry of blueprints.entries) {
    const pair = rewritten.get(entry.sourceId);
    const delivery = entry.metadata?.op?.effectDelivery;
    if (!pair || !delivery) continue;
    for (const variant of ['normal', 'elite']) {
      const prepRows = renderedPrepRows(entry, variant);
      const used = new Set();
      const grantRules = darkmoonPrepRulesFor({ darkmoonSourceId: entry.sourceId }, variant === 'elite').filter(x => x.behavior === 'grantEquipment');
      const usedGrantOutputs = new Set();
      const take = behaviors => {
        const index = prepRows.findIndex((x, i) => !used.has(i) && behaviors.includes(x.behavior));
        if (index < 0) return '';
        used.add(index);
        return prepRows[index].text;
      };
      const takeGrant = kind => {
        for (let r = 0; r < grantRules.length; r++) {
          const outputs = grantRules[r].params?.outputs || [];
          for (let i = 0; i < outputs.length; i++) {
            const output = outputs[i], id = String(output.id).replace(/^independent:/, ''), badge = Boolean(badgeNames[id]);
            if (usedGrantOutputs.has(`${r}:${i}`) || (kind === 'gear' ? badge || !gears.has(id) : !badge)) continue;
            usedGrantOutputs.add(`${r}:${i}`);
            const amount = pick(output, variant), name = gears.get(id) || badgeNames[id] || '装备';
            return `${whenText(grantRules[r].trigger)}，自身${badge ? '获得' : '永久装备'}${name}${qty(amount)}。`;
          }
        }
        return '';
      };
      for (const row of delivery[variant] || []) {
        if (row.kind === 'sourceSpecificCombat') row.text = cleanCombat(entry.sourceId, variant) || row.text;
        else if (row.kind === 'keywordGear') row.text = takeGrant('gear') || row.text;
        else if (row.kind === 'badgeGrowth' && row.params?.outputs?.some(x => badgeNames[x] || badgeNames[String(x).replace(/^independent:/, '')])) row.text = takeGrant('badge') || row.text;
        else if (row.kind === 'magneticAttachment') row.text = take(['darkmoonMagneticMerge']) || row.text;
        else if (row.kind === 'badgeGrowth' || row.kind === 'badgeGrowthAndGear') row.text = take(['darkmoonEndTurnGrowth','darkmoonPreviousWinSelfGrowth','darkmoonBattlecryFactionGrowth','darkmoonBattlecryTargetGrowth','darkmoonBoughtTribeTargetGrowth','darkmoonBoughtSelfGrowth','darkmoonBeastSummonGrowth','darkmoonPlayedTribeGrowth','darkmoonPlayedFactionCountSelfGrowth','darkmoonPlayedTagSelfGrowth','darkmoonAdjacentGrowth','darkmoonTaggedGrowth']) || row.text;
        else if (row.kind === 'gold') row.text = take(['darkmoonRosterTribePurchaseFunds','factionReaction']) || row.text;
        else if (row.kind === 'shopGrowth') row.text = take(['darkmoonShopGrowth']) || row.text;
        else if (row.kind === 'upgradeDiscount') row.text = take(['factionReaction']) || row.text;
        else if (row.kind === 'recruitOffer') row.text = take(['darkmoonLastWarbandRecruit','darkmoonRecruitTribeToHand']) || row.text;
        else if (row.kind === 'supportRecruitOffer') row.text = take(['darkmoonElementalTokenOffer']) || row.text;
        else if (row.kind === 'supportSummon') row.text = take(['darkmoonSummonSupport']) || row.text;
        else if (row.kind === 'freeRefresh') row.text = take(['freeRefresh']) || row.text;
        else if (row.kind === 'shopOffer') row.text = take(['darkmoonAddTribeShopOffer']) || row.text;
        else if (row.kind === 'transform') row.text = take(['darkmoonTransformFromShop']) || row.text;
        else if (row.kind === 'triggerMultiplier') row.text = take(['triggerMultiplier']) || row.text;
        row.text = (row.text || '').replace(/\b(?:newSiracusaRecruit|allFriendlyDragonOperators|selectedFriendly\w*|otherFriendly\w*|randomOtherFriendly|originalBattlecryOutputs|battlecryMultiplier|oneRandomOtherFriendly)\b/g, '友方干员');
        row.recipientLabel = recipientNames[row.recipient] || row.recipient;
        row.triggerLabel = triggerNames[row.trigger] || row.trigger;
        row.durationLabel = durationNames[row.duration] || row.duration;
      }
    }
  }
  fs.writeFileSync(addonPath, `${JSON.stringify(addon, null, 2)}\n`);
  fs.writeFileSync(blueprintPath, `${JSON.stringify(blueprints, null, 2)}\n`);
  process.stdout.write(`formatted ${rewritten.size} source cards; ordinary/elite and level-mode variants refreshed\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
