#!/usr/bin/env node
// Rebuild Darkmoon-facing Chinese text from executable source rules and delivery parameters.
// This edits only descriptive fields; behavior IDs and params remain the mechanic source of truth.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { darkmoonPrepRulesFor } from '../server/modes/independent/darkmoonPrep.js';
import { DARKMOON_COMBAT_RULES, darkmoonCombatMetadata } from '../server/sim/content/independent/darkmoonCombat.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const addonPath = path.join(root, 'data/independent-darkmoon-game-text-addon.json');
const designAddonPath = path.join(root, 'data/independent-darkmoon-design-addon.json');
const blueprintPath = path.join(root, 'data/independent-darkmoon-blueprints.json');
const gameTextPath = path.join(root, 'data/independent-game-text.json');
const designPath = path.join(root, 'data/independent-design.json');
const gears = new Map([
  ['坚守盟约', '坚守盟约'], ['护盾发生器', '护盾发生器'], ['不屈盟约', '不屈盟约'],
  ['精准盟约', '精准盟约'], ['巨锤盟约', '巨锤盟约'], ['突袭盟约', '突袭盟约'], ['oath-cover', '坚守盟约'],
]);
const badgeNames = Object.freeze({ precision: '攻击徽章', agility: '攻速徽章', damage: '伤害徽章', vitality: '生命徽章', defense: '防御徽章', assault: '攻击加成徽章', recovery: '技力徽章', arcane: '法抗徽章', foresight: '初始技力徽章', miracle: '闪避徽章', investor: '回复徽章', unyielding: '生命加成徽章', harmony: '治疗徽章', coordination: '减伤徽章', solitary: '再部署徽章', mastery: '普通攻击徽章' });
const legacyPlusPlusGrowthSources = new Set(['BGS_041', 'BGS_048', 'BGS_100', 'BGS_128']);
const recipientNames = Object.freeze({
  randomFriendlyOperator: '一名随机场上友方干员', self: '自身', hand: '整备区手牌', inventory: '装备栏', shop: '酒馆', playerResource: '玩家资源', shopUpgradeCost: '酒馆升级费用',
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
const triggerNames = Object.freeze({ played: '干员上阵时', gain: '招募获得或首次上阵时', bought: '购买时', sold: '出售时', prepEnd: '每回合休整结束时', roundStart: '每回合休整开始时', combatStart: '战斗开始时', battlecryMultiplier: '获得时效果触发时' });
const durationNames = Object.freeze({
  currentShopOnly: '仅当前商店有效', frozenUntilPurchase: '购买前保持冻结', immediateOnSale: '出售时立即结算', nextRefreshes: '后续刷新期间生效',
  nextUpgrade: '下次酒馆升级前生效', permanent: '本局商店效果', permanentAttachment: '附加', permanentTransformation: '转化',
  permanentWornGear: '穿戴', permanentWornGrowth: '成长', thisTurnOnly: '仅本回合生效', untilFirstPlay: '首次上阵前保留',
  untilPlayedOrSold: '上阵或出售前保留', untilRecruited: '招募前保留', untilSoldOrRetired: '出售或退场前保留', whileOwnerOnField: '持有干员在场时生效',
  整备区: '整备区', 本场战斗: '本场战斗', 本局永久: '本局成长',
});
const pick = (x, variant) => Number(x && typeof x === 'object' ? (x[variant] ?? x.normal ?? 0) : (x ?? 0));
function normalizeLegacyGrowthOutputs(sourceId, value) {
  if (!legacyPlusPlusGrowthSources.has(sourceId) || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) normalizeLegacyGrowthOutputs(sourceId, item);
    return;
  }
  if (value.params && Array.isArray(value.params.outputs)
      && JSON.stringify(value.params.outputs) === JSON.stringify(['precision', 'vitality'])) {
    value.params.outputs = ['precision', 'damage'];
  }
  for (const item of Object.values(value)) normalizeLegacyGrowthOutputs(sourceId, item);
}
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
  if (attack) bits.push(`攻击徽章${qty(attack)}`);
  if (secondary) bits.push(`伤害徽章${qty(secondary)}`);
  return bits.length ? bits.join('与') : '';
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
    case 'grantEquipment': return items.length ? `${when}，自身装备${items.map(x => `${x.name}${qty(x.n)}`).join('、')}。` : '';
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
      if (p.outputs?.includes('precision')) parts.push(`攻击徽章${qty(amount)}`);
      if (p.outputs?.some(x => x !== 'precision')) parts.push(`${badgeNames[p.outputs.find(x => x !== 'precision')] || '伤害徽章'}${qty(amount)}`);
      return `具有获得时效果的友方干员入队时，${who}各获得${parts.join('与')}。`;
    }
    case 'darkmoonBattlecryTargetGrowth': {
      if (p.perTribeBought) {
        const each = pick(p.perTribeBought, variant);
        const secondaryName = badgeNames[p.outputs?.find(x => x !== 'precision')] || '伤害徽章';
        return `每购买一名维多利亚阵营干员，你选择的一名友方维多利亚干员获得攻击徽章${qty(each)}与${secondaryName}${qty(each)}；按本局已购买的维多利亚干员数量累加。`;
      }
      const count = p.fixedCount !== undefined ? pick(p.fixedCount, variant) : p.perTribeBought ? `${pick(p.perTribeBought, variant)}枚每名已购买${factionText(p.faction)}干员` : null;
      const n = (p.attackUnits !== undefined || p.secondaryUnits !== undefined) ? growth(attack, secondary, variant) : `${p.outputs?.includes('precision') ? `攻击徽章${qty(count)}` : ''}${p.outputs?.some(x => x !== 'precision') ? `与${badgeNames[p.outputs.find(x => x !== 'precision')] || '伤害徽章'}${qty(count)}` : ''}`;
      const bonus = p.extraGear?.length ? `，并装备${p.extraGear.map(x => gears.get(String(x).replace(/^independent:/, '')) || '装备').join('、')}` : '';
      return `${when}，${selected(p.faction)}获得${n}${bonus}。`;
    }
    case 'darkmoonPlayedRandomTribeGrowth': return `每次炎阵营干员上阵时，随机使一名场上友方干员获得等同于该元素科技等级的攻击徽章和伤害徽章${variant === 'elite' ? '；该效果结算两次' : ''}。`;
    case 'darkmoonBoughtTribeTargetGrowth': return `每次购买炎阵营干员时，选择一名友方干员；效果触发${pick(p.repeatCount, variant)}次，每次使其获得与所购干员科技等级等量的攻击徽章和${badgeNames[p.outputs?.find(x => x !== 'precision')] || '伤害徽章'}。`;
    case 'darkmoonBoughtSelfGrowth': return `${p.faction ? `购买${factionText(p.faction)}干员时` : when}，自身获得${growth(attack, secondary, variant)}。`;
    case 'darkmoonBeastSummonGrowth': return `每当其他友方叙拉古干员新获得或首次上阵时，该干员获得${growth(attack, secondary, variant)}。`;
    case 'darkmoonPlayedTribeGrowth': return `每有一名炎阵营干员新获得或首次上阵，选择一名其他友方炎阵营干员，使其获得${growth(attack, secondary, variant)}。`;
    case 'darkmoonPlayedFactionCountSelfGrowth': return `每有一名炎阵营干员新获得或首次上阵，自身获得攻击徽章${qty(pick(p.attackUnits, variant))}及伤害徽章${qty(pick(p.secondaryUnitsPerTarget, variant))}；按在场炎阵营干员数累加。`;
    case 'darkmoonPlayedTagSelfGrowth': return `每有一名具有战斗部署效果的友方干员新获得或首次上阵时，自身获得${growth(attack, secondary, variant)}。`;
    case 'darkmoonAdjacentGrowth': return `招募获得或首次上阵时，相邻友方干员各获得${growth(attack, secondary, variant)}${p.extraGear?.length ? `，并装备${p.extraGear.map(x => gears.get(String(x).replace(/^independent:/, '')) || '装备').join('、')}` : ''}。`;
    case 'darkmoonTaggedGrowth': return `招募获得或首次上阵时，所有已装备坚守盟约的友方干员各获得${growth(attack, secondary, variant)}。`;
    case 'darkmoonMagneticMerge': return sourceId === 'BOT_911'
      ? `招募获得或首次上阵时，可直接招募；也可消耗此干员，为你选择的一名友方哥伦比亚干员装备坚守盟约和护盾发生器，并使其获得攻击徽章${qty(attack)}及伤害徽章${qty(secondary)}；本体不进入阵容。`
      : `招募获得或首次上阵时，可直接招募；也可消耗此干员，将其战斗部署效果附加给你选择的一名友方哥伦比亚干员，并使其获得攻击徽章${qty(attack)}及伤害徽章${qty(secondary)}；本体不进入阵容。`;
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
    case 'factionReaction': return p.mode === 'funds' ? `出售时获得${amount}枚金币。` : `招募获得或首次上阵时，下次酒馆升级费用减少${amount}金币。`;
    case 'freeRefresh': return `招募获得或首次上阵时，立即免费刷新酒馆${pick(p, variant)}次。`;
    case 'triggerMultiplier': return `在场时，你的获得时效果共触发${1 + pick(p.extra, variant)}次；不重复其他整备效果。`;
    case 'darkmoonSummonSupport': return '招募获得或首次上阵时，召唤猫形支援单位加入整备区。';
    default: return '';
  }
}

function cleanCombat(id, variant) {
  const meta = darkmoonCombatMetadata(id, variant === 'elite');
  if (!meta?.text) return '';
  const rule = DARKMOON_COMBAT_RULES[id] || {};
  let text = meta.text;
  text = text.replace(/攻击徽章×(\d+)，伤害徽章×(\d+)/g, (_, a, b) => `攻击徽章${qty(a)}与伤害徽章${qty(b)}`)
    .replace(/职业副属性装备|职业副属性徽章/g, '伤害徽章')
    .replace(/攻击徽章×(\d+)及五层护盾/g, (_, a) => `攻击徽章${qty(a)}及护盾层数+5`)
    .replaceAll('原型', '干员的作战投影')
    .replaceAll('作战支援单位', '作战支援单位')
    .replace(/；?获得时装备1件突袭盟约[。]?/g, '')
    .replace(/按当前攻击成长计算，最多七个个/g, '按当前攻击成长计算，最多7个');
  if (['EX1_531', 'GVG_106'].includes(id)) {
    const faction = rule.faction === 'BEAST' ? '叙拉古'
      : rule.faction === 'MECHANICAL' ? '哥伦比亚' : null;
    if (faction && rule.excludeSelf) {
      text = text.replace(`${faction}友方战斗部署时`, `其他${faction}友方单位战斗部署时`);
    }
  }
  const token = rule.retire?.token;
  const tokenName = ({ mechanical: '机械水獭投影', beast: '狼群投影', pirate: '黄金盟誓投影' })[token];
  const stats = rule.retire?.stats;
  const percent = value => value * 40 * (variant === 'elite' ? 2 : 1);
  const bodyText = prototype => stats
    ? `每个投影的攻击为${prototype}基础攻击的${percent(stats[0])}%，生命为其基础生命的${percent(stats[1])}%。`
    : '';
  if (id === 'BGS_061') text = `战斗中每次实际部署时召唤${rule.retire.count[variant === 'elite' ? 1 : 0]}个${tokenName}；${bodyText('黄金盟誓')}`;
  else if (id === 'BOT_312') text = `携带此效果的干员实际部署时，召唤3个${tokenName}；${bodyText('机械水獭')}`;
  else if (id === 'BOT_537') text = `战斗中每次实际部署时召唤1个${tokenName}；${bodyText('机械水獭')}`;
  else if (id === 'CFM_316') text = `战斗中每次实际部署时，按自身当前攻击与基础攻击之比×2召唤${tokenName}（至少1个）；${bodyText('狼群')}`;
  else if (tokenName) text = `战斗中每次实际部署时召唤${rule.retire.attackCount ? '按自身当前攻击与基础攻击之比×2计算、至少1个' : `${rule.retire.count[variant === 'elite' ? 1 : 0]}个`}${tokenName}；${bodyText(token === 'beast' ? '狼群' : token === 'pirate' ? '黄金盟誓' : '机械水獭')}`;
  return text;
}

export function compactWording(text) {
  return text
    .replace(/；成长永久保留，并/g, '，并')
    .replace(/；成长永久保留，/g, '，')
    .replace(/([；，])(?:成长)?永久保留(?=。|$)/g, '。')
    .replace(/永久装备|永久获得|永久生效/g, value => value === '永久装备' ? '装备' : value === '永久获得' ? '获得' : '本局商店效果')
    .replace(/临时获得/g, '获得')
    .replace(/(?:攻击成长徽章|攻击徽章|训练等级)×0及/g, '')
    .replace(/购买符合条件的干员时，购买(?=[^，。；]*阵营干员时)/g, '购买')
    .replace(/[，；]仅本场战斗生效[。]?/g, '。')
    .replace(/[；，]\s*$/g, '。')
    .replace(/。{2,}/g, '。');
}

export function toLevels(text) {
  return text.replace(/攻击徽章×(\d+)(?:与|及)(?:伤害|生命)徽章×(\d+)/g, (_, a, b) => `训练等级${qty(Number(a) + Number(b))}`)
    .replace(/职业副属性成长徽章×(\d+)/g, (_, n) => `训练等级${qty(n)}`)
    .replace(/职业副属性徽章×(\d+)/g, (_, n) => `训练等级${qty(n)}`)
    .replace(/(?:精准|敏捷|攻击|活力|防护|强袭|恢复|术法|洞察|奇迹|投资|坚毅|协同|协调|孤勇|精通)徽章×(\d+)/g, (_, n) => `训练等级${qty(n)}`)
    .replace(/攻击成长徽章×(\d+)/g, (_, n) => `训练等级${qty(n)}`)
    .replace(/(?:攻击|伤害|生命|攻速|攻击加成|技力|法抗|防御|初始技力|闪避|回复|生命加成|治疗|减伤|再部署|普通攻击)徽章×(\d+)/g, (_, n) => `训练等级${qty(n)}`)
    .replace(/(?:伤害|生命)徽章×(\d+)/g, (_, n) => `训练等级${qty(n)}`)
    .replace(/训练等级×0及/g, '');
}
export function renderedPrepRows(entry, variant) {
  const id = entry.sourceId;
  return darkmoonPrepRulesFor({ darkmoonSourceId: id }, variant === 'elite')
    .map(rule => ({ behavior: rule.behavior, trigger: rule.trigger, text: prepText(id, rule, variant) }))
    .filter(row => row.text);
}
export function textsFor(entry, variant) {
  const prep = renderedPrepRows(entry, variant).map(row => row.text);
  const combatMetadata = darkmoonCombatMetadata(entry.sourceId, variant === 'elite');
  const combat = combatMetadata?.adapter?.includes('darkmoonCombat') ? cleanCombat(entry.sourceId, variant) : '';
  return [...prep, ...(combat ? [combat] : [])].map(compactWording);
}
function main() {
  const addon = JSON.parse(fs.readFileSync(addonPath, 'utf8'));
  const designAddon = JSON.parse(fs.readFileSync(designAddonPath, 'utf8'));
  const blueprints = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
  const gameText = JSON.parse(fs.readFileSync(gameTextPath, 'utf8'));
  const design = JSON.parse(fs.readFileSync(designPath, 'utf8'));
  const byId = new Map(blueprints.entries.map(x => [x.sourceId, x]));
  const rewritten = new Map();
  for (const item of Object.values(addon.operators)) {
    const entry = byId.get(item.sourceId);
    if (!entry) throw new Error(`DARKMOON_BLUEPRINT_MISSING:${item.sourceId}`);
    const normal = textsFor(entry, 'normal');
    const elite = textsFor(entry, 'elite');
    const normalText = normal.join('\n') || cleanCombat(item.sourceId, 'normal') || '战斗中执行对应的干员效果。';
    const eliteText = elite.join('\n') || cleanCombat(item.sourceId, 'elite') || normalText;
    const levelText = (variantText, variant) => item.sourceId === 'BGS_100'
      ? `每次炎阵营干员上阵时，随机使一名场上友方干员获得等同于该元素科技等级两倍的训练等级${variant === 'elite' ? '；该效果结算两次' : ''}。`
      : toLevels(variantText);
    const next = { ...item, normal: normalText, elite: eliteText, normalLevels: levelText(normalText, 'normal'), eliteLevels: levelText(eliteText, 'elite') };
    item.normal = next.normal; item.elite = next.elite; item.normalLevels = next.normalLevels; item.eliteLevels = next.eliteLevels;
    rewritten.set(item.sourceId, { normal, elite });
  }
  const renderedBySource = new Map(Object.values(addon.operators).map(item => [item.sourceId, item]));
  const designBySource = new Map((design.operators || []).map(operator => [operator.sourceRefs?.darkmoon19_2?.id, operator]).filter(([id]) => id));
  for (const [sourceId, rendered] of renderedBySource) {
    const designOperator = designBySource.get(sourceId), operator = gameText.operators?.[designOperator?.chessId];
    if (!operator) continue;
    for (const field of ['normal','elite','normalLevels','eliteLevels']) if (rendered[field]) operator[field] = rendered[field];
  }
  for (const entry of blueprints.entries) {
    normalizeLegacyGrowthOutputs(entry.sourceId, entry);
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
            return `${whenText(grantRules[r].trigger)}，自身${badge ? '获得' : '装备'}${name}${qty(amount)}。`;
          }
        }
        return '';
      };
      for (const row of delivery[variant] || []) {
        if (row.kind === 'sourceSpecificCombat') {
          const meta = darkmoonCombatMetadata(entry.sourceId, variant === 'elite');
          row.text = cleanCombat(entry.sourceId, variant) || row.text;
          row.triggerLabel = meta?.trigger || row.triggerLabel;
        }
        else if (row.kind === 'keywordGear') row.text = takeGrant('gear') || row.text;
        else if (row.kind === 'badgeGrowth' && row.params?.outputs?.some(x => badgeNames[x] || badgeNames[String(x).replace(/^independent:/, '')])) row.text = takeGrant('badge') || take(['darkmoonEndTurnGrowth','darkmoonPreviousWinSelfGrowth','darkmoonBattlecryFactionGrowth','darkmoonBattlecryTargetGrowth','darkmoonBoughtTribeTargetGrowth','darkmoonPlayedRandomTribeGrowth','darkmoonBoughtSelfGrowth','darkmoonBeastSummonGrowth','darkmoonPlayedTribeGrowth','darkmoonPlayedFactionCountSelfGrowth','darkmoonPlayedTagSelfGrowth','darkmoonAdjacentGrowth','darkmoonTaggedGrowth']) || row.text;
        else if (row.kind === 'magneticAttachment') row.text = take(['darkmoonMagneticMerge']) || row.text;
        else if (row.kind === 'badgeGrowth' || row.kind === 'badgeGrowthAndGear') row.text = take(['darkmoonEndTurnGrowth','darkmoonPreviousWinSelfGrowth','darkmoonBattlecryFactionGrowth','darkmoonBattlecryTargetGrowth','darkmoonBoughtTribeTargetGrowth','darkmoonPlayedRandomTribeGrowth','darkmoonBoughtSelfGrowth','darkmoonBeastSummonGrowth','darkmoonPlayedTribeGrowth','darkmoonPlayedFactionCountSelfGrowth','darkmoonPlayedTagSelfGrowth','darkmoonAdjacentGrowth','darkmoonTaggedGrowth']) || row.text;
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
        if (row.adaptation !== undefined) row.adaptation = row.text;
        row.recipientLabel = recipientNames[row.recipient] || row.recipientLabel || row.recipient;
        if (row.kind !== 'sourceSpecificCombat') row.triggerLabel = triggerNames[row.trigger] || row.trigger;
        row.durationLabel = durationNames[row.duration] || row.duration;
      }
    }
  }
  for (const entry of blueprints.entries) {
    const prepByVariant = { normal: renderedPrepRows(entry, 'normal'), elite: renderedPrepRows(entry, 'elite') };
    for (const variant of ['normal','elite']) {
      let prepIndex = 0;
      for (const row of entry.sourceEffect?.[variant] || []) {
        if (row.sourceTrigger === 'darkmoonCombat') {
          row.text = cleanCombat(entry.sourceId, variant) || row.text;
        } else {
          const prepared = prepByVariant[variant][prepIndex++];
          if (prepared && row.text !== undefined) row.text = prepared.text;
        }
        if (row.adaptation !== undefined) row.adaptation = row.text;
      }
      const authored = entry.authoredRule?.[variant];
      if (authored?.text !== undefined) authored.text = entry.authoredRule.mechanic === 'darkmoonCombat'
        ? cleanCombat(entry.sourceId, variant) || authored.text
        : prepByVariant[variant][0]?.text || authored.text;
    }
  }
  const addonBySource = new Map(Object.values(addon.operators).map(item => [item.sourceId, item]));
  const blueprintBySource = new Map(blueprints.entries.map(item => [item.sourceId, item]));
  for (const operator of designAddon.operators || []) {
    const sourceId = operator.sourceId;
    const blueprint = blueprintBySource.get(sourceId);
    if (!blueprint) continue;
    normalizeLegacyGrowthOutputs(sourceId, operator);
    for (const variant of ['normal','elite']) {
      const authoredText = blueprint.authoredRule?.[variant]?.text;
      if (typeof authoredText === 'string' && operator.authoredRule?.[variant]) operator.authoredRule[variant].text = authoredText;
      const sourceRows = blueprint.metadata?.op?.effectDelivery?.[variant] || [];
      for (const rows of [operator.effectDelivery?.[variant] || [], operator.metadata?.op?.effectDelivery?.[variant] || []]) {
        for (let i = 0; i < rows.length; i++) {
          const target = rows[i], source = sourceRows[i];
          if (!source || source.kind !== target.kind) continue;
          for (const field of ['text','adaptation','triggerLabel','recipientLabel','durationLabel']) if (source[field] !== undefined) target[field] = source[field];
          if (source.params?.outputs && target.params?.outputs) target.params.outputs = structuredClone(source.params.outputs);
        }
      }
    }
  }
  for (const operator of design.operators || []) {
    const sourceId = operator.sourceRefs?.darkmoon19_2?.id;
    if (!sourceId) continue;
    normalizeLegacyGrowthOutputs(sourceId, operator);
    const rendered = addonBySource.get(sourceId), blueprint = blueprintBySource.get(sourceId);
    if (!rendered || !blueprint) continue;
    if (operator.nativeTrait) for (const variant of ['normal','elite']) if (rendered[variant]) operator.nativeTrait[variant] = rendered[variant];
    for (const variant of ['normal','elite']) {
      const targetRows = operator.effectDelivery?.[variant] || [];
      const sourceRows = blueprint.metadata?.op?.effectDelivery?.[variant] || [];
      for (let i = 0; i < targetRows.length; i++) {
        const target = targetRows[i], source = sourceRows[i];
        if (!source || source.kind !== target.kind) continue;
        for (const field of ['text','adaptation','triggerLabel','recipientLabel','durationLabel']) if (source[field] !== undefined) target[field] = source[field];
      }
      const workshopRows = operator.allocationEvidence?.workshop?.[variant] || [];
      for (let i = 0; i < workshopRows.length; i++) if (targetRows[i]?.text && workshopRows[i].rule !== undefined) workshopRows[i].rule = targetRows[i].text;
    }
  }
  fs.writeFileSync(addonPath, `${JSON.stringify(addon, null, 2)}\n`);
  fs.writeFileSync(designAddonPath, `${JSON.stringify(designAddon, null, 2)}\n`);
  fs.writeFileSync(blueprintPath, `${JSON.stringify(blueprints, null, 2)}\n`);
  fs.writeFileSync(gameTextPath, `${JSON.stringify(gameText, null, 2)}\n`);
  fs.writeFileSync(designPath, `${JSON.stringify(design, null, 2)}\n`);
  process.stdout.write(`formatted ${rewritten.size} source cards; ordinary/elite and level-mode variants refreshed\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
