#!/usr/bin/env node
// tools/assault/check-system-design.mjs — validator for data/assault-design/system.json
// (schema assault-system-design/v1). Reads real source/roster/collectible/event data and either
// verifies a rule or reports an open item; it never invents or deletes a mode.
//
// Usage: node tools/assault/check-system-design.mjs [--strict]
//   default: structural failures exit 1, unresolved-but-expected items print REPORT and exit 0
//   --strict: unresolved REPORT items also exit 1

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDatabase, readPointer, buildTierView, normalizeDataEntities } from './bazaar-native.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const P = (...p) => path.join(ROOT, ...p);
const SYSTEM = P('data', 'assault-design', 'system.json');
const ROSTER = P('data', 'assault-roster-selection.json');
const COLLECTIBLES = P('data', 'assault-design', 'collectibles.json');
const EVENTS = P('data', 'assault-design', 'events.json');
const INDEX = P('data', 'assault-operator-index.json');
const BAZAAR_DB = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/bazaar/official-GameData.db';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const isStr = (v) => typeof v === 'string' && v.length > 0;

export const hasFourFiniteAmounts = (effect) => Array.isArray(effect?.amountByStar)
  && effect.amountByStar.length === 4 && Array.from(effect.amountByStar).every(Number.isFinite);

// Shared with in-memory fixtures; the ordinary CLI uses these same checks.
export function validateSkillLevelRewards(sys) {
  const issues = [];
  const rewards = sys.skillLevelRewards;
  if (!Array.isArray(rewards) || !rewards.length) return ['skillLevelRewards must be a non-empty array'];
  const ids = new Set();
  const maxTech = Array.isArray(sys.run?.xpThresholds) ? sys.run.xpThresholds.length : 0;
  for (const reward of rewards) {
    const id = reward?.id;
    if (!isStr(id) || !id.trim() || ids.has(id)) issues.push(`skill level reward id invalid/duplicate: ${JSON.stringify(id)}`);
    ids.add(id);
    if (!Number.isInteger(reward?.tech) || reward.tech < 1 || reward.tech > maxTech) issues.push(`${id}: skill level reward tech must be 1..${maxTech}`);
    if (!Number.isInteger(reward?.star) || reward.star < 1 || reward.star > 4) issues.push(`${id}: skill level reward star must be 1..4`);
    if (!Number.isInteger(reward?.count) || reward.count < 1) issues.push(`${id}: skill level reward count must be a positive integer`);
    if (!isStr(reward?.conversion) || !reward.conversion.trim()) issues.push(`${id}: skill level reward conversion required`);
  }
  return issues;
}

export function validateOperatorUpgradeRewards(sys, cardRows, levelUpRows) {
  const issues = [];
  const rewards = sys.operatorUpgradeRewards;
  const expected = [{ tech: 3, maxStar: 1 }, { tech: 5, maxStar: 2 }, { tech: 7, maxStar: 3 }];
  if (!Array.isArray(rewards) || rewards.length !== expected.length) return ['operatorUpgradeRewards must contain tech 3, 5, and 7 rewards'];
  const ids = new Set();
  for (let index = 0; index < rewards.length; index += 1) {
    const reward = rewards[index];
    const id = reward?.id;
    if (!isStr(id) || !id.trim() || ids.has(id)) issues.push(`operator upgrade reward id invalid/duplicate: ${JSON.stringify(id)}`);
    ids.add(id);
    if (reward?.tech !== expected[index].tech || reward?.maxStar !== expected[index].maxStar) issues.push(`${id}: expected tech ${expected[index].tech}, maxStar ${expected[index].maxStar}`);
    if (!Number.isInteger(reward?.count) || reward.count !== 4) issues.push(`${id}: candidate count must be four`);
    if (!isStr(reward?.conversion) || !reward.conversion.trim()) issues.push(`${id}: conversion required`);
    if (!Array.isArray(reward?.parentRefs) || !reward.parentRefs.length) {
      issues.push(`${id}: parentRefs must identify official level_ups reward links`);
      continue;
    }
    for (const ref of reward.parentRefs) {
      if (!ref || ref.database !== BAZAAR_DB || ref.table !== 'level_ups' || !Number.isInteger(ref.rowId)
        || !isStr(ref.pointer) || !ref.pointer.startsWith('/') || ref.cardId !== reward.sourceRef?.rowId) {
        issues.push(`${id}: invalid level_ups parent reference`);
        continue;
      }
      const raw = levelUpRows.get(ref.rowId);
      if (!raw) { issues.push(`${id}: level_ups row ${ref.rowId} does not exist`); continue; }
      let data;
      try { data = JSON.parse(raw); } catch { issues.push(`${id}: level_ups row ${ref.rowId} Data is invalid JSON`); continue; }
      const pointer = readPointer(data, ref.pointer);
      if (!pointer.found || pointer.value !== ref.cardId) issues.push(`${id}: level_ups parent pointer does not resolve to sourceRef card`);
    }
  }
  issues.push(...validateSourceReferences(rewards, cardRows));
  return issues;
}

export function validateSourceReferences(entries, cardRows) {
  const issues = [];
  for (const entry of entries) {
    const id = entry?.id;
    const ref = entry?.sourceRef;
    if (!ref || ref.table !== 'cards' || !isStr(ref.rowId) || !ref.rowId.trim()
      || !isStr(ref.pointer) || !ref.pointer.startsWith('/')) {
      issues.push(`${id}: sourceRef must identify a cards row and pointer`);
      continue;
    }
    if (!isStr(ref.database) || !path.isAbsolute(ref.database)
      || path.resolve(ref.database).toLowerCase() !== path.resolve(BAZAAR_DB).toLowerCase()) {
      issues.push(`${id}: sourceRef database is not the official cards DB`);
      continue;
    }
    const raw = cardRows.get(String(ref.rowId));
    if (!raw) { issues.push(`${id}: sourceRef rowId does not exist in official cards`); continue; }
    let data;
    try { data = JSON.parse(raw); } catch { issues.push(`${id}: sourceRef row Data is invalid JSON`); continue; }
    if (!readPointer(data, ref.pointer).found) issues.push(`${id}: sourceRef pointer does not resolve in its official cards row`);
  }
  return issues;
}

export function supplyStandardPrices(rows) {
  for(const row of rows || [])for(const {entity} of normalizeDataEntities(row.rowId,JSON.parse(row.dataText)))if(entity?.StandardPrices)return entity.StandardPrices;
  return {};
}
export function validateSupplyItems(sys,cardRows,standardPrices) {
  const issues=[],items=sys.supplyItems,tiers=['Bronze','Silver','Gold','Diamond'];
  const spec={supply_soda_machine:['16005305-bce3-4cae-8c90-8b6560def112',null],supply_yetarian_cooler:['099cccf9-2372-4ebe-ac78-eee68f510979','cooldown'],supply_wishful_drinking:['4c8ea629-990e-4bdf-a7ef-a8520608e47b','maxLife'],supply_roughtown:['411d0927-857b-468a-afa0-9d525a232922','poison'],supply_smoothie:['199c5f39-cc7a-4ef1-ae55-b19d531e5e66','smoothie'],supply_punch:['740c7183-d8aa-4bd5-b455-62c05309c60a','damage'],supply_scovyle:['44ffc3d6-b696-4753-936b-6d590821de93','burn'],supply_courage:['93857582-f36e-4833-82e3-c79d0fd19890','shield'],supply_mystery:['78eb19fd-4da4-45d5-b4cb-d669b50b6ed6','randomEnchant']};
  const allowed=new Set(['id','name','description','kind','sizeSlots','allowedStars','buyPrices','sellPrices','icon','sourceRef','sourceRules','saleEffect','generationPool']);
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),check=(ok,message)=>{if(!ok)issues.push(message);};
  check(sys.supplyCapacity===8,'supplyCapacity must be eight');
  if(!Array.isArray(items)||items.length!==9)return [...issues,'supplyItems must contain the nine defined supplies'];
  const seen=new Set();let count=0;
  issues.push(...validateSourceReferences(items,cardRows));
  for(const item of items){
    const id=item?.id,expected=spec[id];check(Boolean(expected)&&!seen.has(id),String(id)+': unknown/duplicate supply');seen.add(id);if(!expected)continue;
    check(Object.keys(item).every(key=>allowed.has(key)),id+': unknown supply field');
    check(isStr(item.name)&&isStr(item.description)&&isStr(item.icon?.kind)&&isStr(item.icon?.name),id+': name/description/icon required');
    check(item.sourceRef?.rowId===expected[0],id+': official source identity mismatch');
    const raw=cardRows.get(expected[0]);if(!raw){issues.push(id+': official source missing');continue;}
    const card=JSON.parse(raw),view=buildTierView(card,standardPrices),stars=view.present.map(tier=>tiers.indexOf(tier)+1);
    check(card.$type==='TCardItem'&&card.Type==='Item',id+': source must be an item');
    check(same(item.allowedStars,stars)&&stars.every(star=>star>=1&&star<=4),id+': allowed stars differ from native tiers');count+=stars.length;
    check(item.kind===(expected[1]===null?'machine':'beverage'),id+': kind mismatch');
    check(item.sizeSlots==={Small:1,Medium:2,Large:3}[card.Size],id+': size differs from native source');
    const abilities=card.Abilities || {},abilityKeys=Object.keys(abilities);
    check(item.sourceRef?.pointer==='/Abilities'||(abilityKeys.length===1&&item.sourceRef?.pointer==='/Abilities/'+abilityKeys[0]),id+': source pointer must identify its actual abilities');
    for(const field of ['buyPrices','sellPrices'])check(Array.isArray(item[field])&&item[field].length===4&&Array.from(item[field]).every(value=>Number.isInteger(value)&&value>=0),id+': '+field+' needs four nonnegative integers');
    for(const star of stars){const entry=view.entries[tiers[star-1]];check(item.buyPrices?.[star-1]===entry.buy.v,id+': native buy price mismatch at star '+star);check(item.sellPrices?.[star-1]===entry.sell.v,id+': native sell price mismatch at star '+star);}
    const rules=item.sourceRules || {},first=abilities[abilityKeys[0]],action=first?.Action || {};
    const ruleFields=['abilityPointer','trigger','activeIn','worksIn','spawnedCardIds','selectionMethod','limit','allowDuplicates','inheritTier','durationType','targetSection','excludeSelf','requiresTargetAttribute','targetAttributeType','valueAttributePointer','valueAttribute','modifier','round','tierValues','abilities','unusedAuraId','targetHiddenTag','targetTag','targetMode','condition','conditionIsNot','preventOverride','targetCount','tierAttribute','enchantments'];
    check(Object.keys(rules).every(key=>ruleFields.includes(key)),id+': unknown sourceRules field');
    const requiredRules=expected[1]===null?['abilityPointer','trigger','activeIn','worksIn','spawnedCardIds','selectionMethod','limit','allowDuplicates','inheritTier']:expected[1]==='maxLife'?['abilities','tierValues','unusedAuraId']:expected[1]==='smoothie'?['abilities','modifier','round','tierValues']:expected[1]==='randomEnchant'?['abilityPointer','trigger','activeIn','durationType','targetSection','targetMode','excludeSelf','condition','conditionIsNot','preventOverride','targetCount','tierAttribute','enchantments']:['abilityPointer','trigger','activeIn','durationType','targetSection','targetAttributeType','valueAttribute','modifier','round','tierValues'];
    check(requiredRules.every(key=>Object.hasOwn(rules,key)),id+': missing required sourceRules field');
    if(['cooldown','poison','damage'].includes(expected[1]))check(Object.hasOwn(rules,'valueAttributePointer'),id+': required value attribute pointer missing');
    if(expected[1]==='cooldown')check(Object.hasOwn(rules,'requiresTargetAttribute'),id+': required cooldown target condition missing');
    if(['poison','burn','shield'].includes(expected[1]))check(Object.hasOwn(rules,'targetHiddenTag'),id+': required hidden tag missing');
    if(expected[1]==='damage')check(Object.hasOwn(rules,'targetTag'),id+': required weapon tag missing');
    if(['maxLife','smoothie'].includes(expected[1]))check(Array.isArray(rules.abilities)&&rules.abilities.length===abilityKeys.length&&same(rules.abilities.map(ref=>ref.pointer),abilityKeys.map(key=>'/Abilities/'+key)),id+': all native abilities need source claims');
    if(rules.abilityPointer){const ref=readPointer(card,rules.abilityPointer);check(ref.found&&ref.value===first,id+': abilityPointer mismatch');}
    if(rules.trigger!==undefined)check(rules.trigger===first?.Trigger?.$type,id+': source trigger mismatch');
    if(rules.activeIn!==undefined)check(rules.activeIn===first?.ActiveIn,id+': active-in mismatch');
    if(rules.worksIn!==undefined)check(rules.worksIn===first?.WorksIn,id+': works-in mismatch');
    if(rules.requiresTargetAttribute!==undefined){const c=action.Target?.Conditions;check(same(Object.keys(rules.requiresTargetAttribute).sort(),['attribute','comparison','value'])&&rules.requiresTargetAttribute.attribute===c?.Attribute&&rules.requiresTargetAttribute.comparison===c?.ComparisonOperator&&rules.requiresTargetAttribute.value===c?.ComparisonValue?.Value,id+': target attribute condition mismatch');}
    if(rules.unusedAuraId!==undefined)check(Boolean(card.Auras?.[rules.unusedAuraId])&&stars.every(star=>!view.entries[tiers[star-1]].auras.includes(rules.unusedAuraId)),id+': unused aura reference mismatch');
    for(const [field,native]of [['targetAttributeType',action.AttributeType],['valueAttribute',action.Value?.AttributeType],['targetSection',action.Target?.TargetSection],['targetMode',action.Target?.TargetMode],['excludeSelf',action.Target?.ExcludeSelf],['modifier',action.Value?.Modifier?.ModifyMode],['round',action.Value?.Modifier?.ShouldRound],['preventOverride',action.PreventOverride]])if(rules[field]!==undefined)check(same(rules[field],native),id+': source '+field+' mismatch');
    if(rules.targetHiddenTag!==undefined)check(action.Target?.Conditions?.Tags?.includes(rules.targetHiddenTag),id+': native hidden tag mismatch');
    if(rules.targetTag!==undefined)check(action.Target?.Conditions?.Tags?.includes(rules.targetTag),id+': native target tag mismatch');
    if(rules.valueAttributePointer!==undefined){const ref=readPointer(card,rules.valueAttributePointer);check(ref.found&&ref.value===rules.valueAttribute,id+': source valueAttributePointer mismatch');}
    for(const ref of rules.abilities || []){const resolved=readPointer(card,ref.pointer),a=resolved.value;check(Object.keys(ref).every(key=>['pointer','trigger','activeIn','durationType','attributeType','value','valuePointer','target','reference','targetSection','targetHiddenTag','targetAttributeType','valueAttribute'].includes(key)),id+': unknown ability source field');check(resolved.found&&a?.Trigger?.$type===ref.trigger&&a?.ActiveIn===ref.activeIn,id+': referenced ability mismatch');if(ref.valuePointer){const v=readPointer(card,ref.valuePointer);check(v.found&&v.value===ref.value,id+': native scalar value pointer mismatch');}check(a?.Action?.Duration?.DurationType===ref.durationType,id+': multi-ability duration mismatch');for(const[field,native]of [['attributeType',a?.Action?.AttributeType],['targetAttributeType',a?.Action?.AttributeType],['targetSection',a?.Action?.Target?.TargetSection],['valueAttribute',a?.Action?.Value?.AttributeType],['target',a?.Action?.Target?.TargetMode]])if(ref[field]!==undefined)check(ref[field]===native,id+': referenced '+field+' mismatch');if(ref.targetHiddenTag!==undefined)check(a?.Action?.Target?.Conditions?.Tags?.includes(ref.targetHiddenTag),id+': referenced hidden tag mismatch');if(ref.reference!==undefined)check(ref.reference==='HealthMaxUnscaled'&&a?.Action?.Value?.$type==='TReferenceValuePlayerAttributeUnscaled'&&a?.Action?.Value?.AttributeType==='HealthMax',id+': unscaled life reference mismatch');}
    if(expected[1]===null){
      check(item.saleEffect===null,id+': machine must not have sale effects');const spawn=action.SpawnContext;
      check(first.Trigger?.$type==='TTriggerOnHourStarted'&&first.ActiveIn==='HandAndStash'&&action.$type==='TActionGameSpawnCards',id+': native hourly generation mismatch');
      const ids=spawn?.Groups?.[0]?.Filters?.[0]?.Ids || [];
      check(same(rules.spawnedCardIds,ids)&&same(item.generationPool?.map(key=>spec[key]?.[0]),ids),id+': drink pool differs from native SpawnContext');
      check(spawn?.Limit?.Value===1&&rules.limit===1&&spawn?.Groups?.[0]?.SelectionMethod==='Random'&&rules.selectionMethod==='Random',id+': random single generation mismatch');
      check(spawn?.Behaviors?.some(b=>b.AllowDuplicates===true)&&rules.allowDuplicates===true&&spawn?.Behaviors?.some(b=>b.Inherits===true)&&rules.inheritTier===true,id+': native inherit/duplicate policy mismatch');
      continue;
    }
    check(item.saleEffect?.kind===expected[1],id+': sale effect kind mismatch');
    const saleFields=expected[1]==='maxLife'?['kind','mode','values']:expected[1]==='smoothie'?['kind','secondaryValues','values']:expected[1]==='randomEnchant'?['enchantments','kind','values']:['kind','values'];
    check(same(Object.keys(item.saleEffect || {}).sort(),saleFields.slice().sort()),id+': unknown or missing sale effect field');
    for(const [key,a]of Object.entries(abilities)){check(a.Trigger?.$type==='TTriggerOnCardSold'&&a.ActiveIn==='HandAndStash'&&a.Action?.Duration?.DurationType==='UntilEndOfDay',id+': native sold/day-duration mismatch at ability '+key);}
    if(rules.durationType!==undefined)check(rules.durationType===action.Duration?.DurationType,id+': source duration mismatch');
    const values=[0,0,0,0],secondary=[0,0,0,0],nativeTierValues={};
    for(const star of stars){const attrs=view.entries[tiers[star-1]].attrs;values[star-1]=expected[1]==='randomEnchant'?attrs.EnchantTargets:attrs.Custom_0;secondary[star-1]=attrs.Custom_1??0;nativeTierValues[tiers[star-1]]=expected[1]==='smoothie'?[attrs.Custom_0,attrs.Custom_1]:attrs.Custom_0;}
    check(same(item.saleEffect.values,values),id+': sale values differ from native tier attributes');
    if(rules.tierValues!==undefined)check(same(rules.tierValues,nativeTierValues),id+': claimed native tier values mismatch');
    if(expected[1]==='smoothie')check(same(item.saleEffect.secondaryValues,secondary)&&abilities['0']?.Action?.AttributeType==='HealAmount'&&abilities['1']?.Action?.AttributeType==='RegenApplyAmount',id+': two native healing values mismatch');
    if(expected[1]==='maxLife'){check(item.saleEffect.mode==='percent',id+': life change must be percentage');for(const star of stars){const a=abilities[view.entries[tiers[star-1]].abilities[0]],amount=a?.Action?.Value?.Modifier?.Value?.Value;check(a?.Action?.AttributeType==='HealthMax'&&Math.abs(amount*100-values[star-1])<1e-9,id+': native player life multiplier mismatch');}}
    const attributes={cooldown:'PercentCooldownReduction',poison:'PoisonApplyAmount',damage:'DamageAmount',burn:'BurnApplyAmount',shield:'ShieldApplyAmount'};
    if(attributes[expected[1]])check(action.AttributeType===attributes[expected[1]],id+': native affected attribute mismatch');
    if(expected[1]==='randomEnchant'){
      const weights=(action.Enchantments || []).map(e=>({id:'enchant_'+e.Enchantment.toLowerCase(),weight:e.Weight}));
      check(action.$type==='TActionCardEnchantRandom'&&weights.length===11&&weights.every(e=>Number.isFinite(e.weight)&&e.weight>0),id+': native eleven-weight enchantment list required');
      check(same(item.saleEffect.enchantments,weights)&&same(rules.enchantments,weights),id+': enchantments/weights differ from native source');
      check(weights.every(e=>sys.enchantments?.some(def=>def.id===e.id)),id+': undefined enchantment reference');
      check(rules.conditionIsNot===action.Target?.Conditions?.IsNot&&rules.targetCount===values[3],id+': native selection condition/count mismatch');
      check(rules.condition==='HasEnchantment'&&action.Target?.Conditions?.$type==='TCardConditionalHasEnchantment'&&rules.tierAttribute==='EnchantTargets'&&action.TargetCount===null,id+': native condition/tier count reference mismatch');
    }
  }
  check(count===29,'supplies must cover exactly 29 native available item tiers');
  return issues;
}

const errors = [];
const reports = [];
const notes = [];
const fail = (m) => errors.push(m);
const report = (m) => reports.push(m);

function main() {
  const strict = process.argv.includes('--strict');
  if (!fs.existsSync(SYSTEM)) { console.log(`FAIL system.json missing: ${SYSTEM}`); process.exit(1); }
  const sys = readJson(SYSTEM);

  if (sys.schema !== 'assault-system-design/v1') fail(`schema must be 'assault-system-design/v1', got ${JSON.stringify(sys.schema)}`);

  // ---- directors
  const directors = Array.isArray(sys.directors) ? sys.directors : [];
  if (directors.length !== 3) fail(`directors must be 3, got ${directors.length}`);
  const directorIds = new Set();
  for (const d of directors) {
    if (!isStr(d.id) || directorIds.has(d.id)) fail(`director id invalid/duplicate: ${JSON.stringify(d.id)}`);
    directorIds.add(d.id);
    if (!isStr(d.leaderCharId)) fail(`director ${d.id}: leaderCharId required`);
    if (!isStr(d.themeFaction)) fail(`director ${d.id}: themeFaction required`);
    if (!Array.isArray(d.startTeam) || d.startTeam.length !== 3) fail(`director ${d.id}: startTeam must be 3`);
    if (!isStr(d.starterRelicId)) fail(`director ${d.id}: starterRelicId required`);
  }

  // ---- run economy / rules
  const run = sys.run || {};
  const runExpect = { days: 10, hoursPerDay: 6, startGold: 12, dailyIncome: 8, life: 20, battleSeconds: 120, benchSize: 12, mergeCopies: 2, maxStar: 4, sourceCapPerBody: 8 };
  for (const [k, v] of Object.entries(runExpect)) if (run[k] !== v) fail(`run.${k} must be ${v}, got ${JSON.stringify(run[k])}`);
  if (run.noInterest !== true) fail('run.noInterest must be true');
  if (!Array.isArray(run.mandatoryHours) || run.mandatoryHours.join(',') !== '3,6') fail('run.mandatoryHours must be [3,6]');
  if (!Array.isArray(run.xpThresholds) || run.xpThresholds.length !== 8) fail('run.xpThresholds must have 8 levels');
  if (!run.dp || run.dp.init !== 80 || run.dp.perSec !== 2 || run.dp.max !== 160) fail('run.dp must match the active wave budget {init:80,perSec:2,max:160}');
  if (!run.sp || run.sp.fractional !== true || run.sp.minCost !== 0.5 || run.sp.initFrom !== 'perCardDesign') fail('run.sp must keep fractional costs (min 0.5) and INIT from per-card design');
  if (!Array.isArray(run.starAttackMultipliers) || run.starAttackMultipliers.join(',') !== '1,1.55,2.2,3') fail('run.starAttackMultipliers must be [1,1.55,2.2,3]');
  if (!Array.isArray(run.starHealthMultipliers) || run.starHealthMultipliers.join(',') !== '1,1.65,2.6,4') fail('run.starHealthMultipliers must be [1,1.65,2.6,4]');
  if (run.baseHealthScale !== 5) fail('run.baseHealthScale must be 5');
  if (run.modulePolicy?.nativeModuleWhiteStats !== false || run.modulePolicy?.applyPerCardAssaultTranslationOnly !== true || run.modulePolicy?.lifeScaleFactor !== 5 || run.modulePolicy?.lifeScaleApplyOnce !== true) fail('run.modulePolicy must use translated effects only and apply life ×5 once');

  // ---- price tiers
  const pt = sys.priceTierWeights || {};
  const bands = Array.isArray(pt.bands) ? pt.bands : [];
  if (bands.length !== 5) fail(`priceTierWeights.bands must be 5, got ${bands.length}`);
  const configuredPrices = new Set((pt.tiers || []).map(Number));
  for (const [i, b] of bands.entries()) {
    const entries = Object.entries(b.weights || {});
    if (entries.some(([price, weight]) => !configuredPrices.has(Number(price)) || !Number.isFinite(Number(weight)) || Number(weight) < 0)) fail(`priceTierWeights band ${i + 1}: keys must be configured gold prices with nonnegative weights`);
    if (entries.reduce((sum, [, weight]) => sum + Number(weight), 0) !== 100) fail(`priceTierWeights band ${i + 1}: weights must sum to 100`);
  }
  const covered = new Set();
  for (const b of bands) for (const [t, w] of Object.entries(b.weights || {})) if (Number(w) > 0) covered.add(Number(t));
  if (pt.weightKey !== 'price') fail('priceTierWeights.weightKey must state that weight keys are prices, not tier IDs');
  const tiersExpected = (pt.tiers || []).slice().sort((a, b) => a - b);
  const coveredSorted = [...covered].sort((a, b) => a - b);
  if (JSON.stringify(coveredSorted) !== JSON.stringify(tiersExpected)) fail(`base price tier coverage ${JSON.stringify(coveredSorted)} != ${JSON.stringify(tiersExpected)}`);
  if (pt.legacyOnly !== true) fail('price weights are legacy metadata; current shop quality must use star weights');
  const quality = sys.shopQualityWeights?.days;
  for (let day = 1; day <= run.days; day++) {
    const weights = quality?.[String(day)];
    if (!weights || Object.keys(weights).sort().join(',') !== '1,2,3,4'
      || Object.values(weights).some(weight => !Number.isFinite(weight) || weight < 0)
      || Math.abs(Object.values(weights).reduce((sum, weight) => sum + weight, 0) - 1) > 1e-9) fail(`day ${day}: complete normalized star quality weights required`);
  }

  // ---- shops
  const shops = Array.isArray(sys.shopDefinitions) ? sys.shopDefinitions : [];
  if (shops.length !== 29) fail(`shopDefinitions must be 29, got ${shops.length}`);
  const shopIds = new Set();
  const groupCount = {};
  for (const s of shops) {
    if (!isStr(s.id) || shopIds.has(s.id)) fail(`shop id invalid/duplicate: ${JSON.stringify(s.id)}`);
    shopIds.add(s.id);
    groupCount[s.group] = (groupCount[s.group] || 0) + 1;
    if (!isStr(s.name)) fail(`shop ${s.id}: name required`);
    if (!Number.isInteger(s.unlockDay) || s.unlockDay < 1 || s.unlockDay > 10) fail(`shop ${s.id}: unlockDay 1..10`);
    if (!Number.isInteger(s.slots) || s.slots < 1) fail(`shop ${s.id}: slots`);
    if (!Number.isInteger(s.refreshCost) || s.refreshCost < 0) fail(`shop ${s.id}: refreshCost`);
    if (!['dayWeights', 1, 2, 3, 4].includes(s.offeredStar)) fail(`shop ${s.id}: offeredStar dayWeights or 1..4`);
    if (!Number.isInteger(s.maxRefreshes) || s.maxRefreshes < 0) fail(`shop ${s.id}: finite maxRefreshes required`);
    if (s.supplyPolicy !== 'distinctPurchaseIdentities') fail(`shop ${s.id}: distinct supply identities required`);
    if (!s.filter || !['none', 'profession', 'faction', 'archetype'].includes(s.filter.type)) fail(`shop ${s.id}: filter type`);
    if (!s.priceRule || !['priceTierWeights', 'discount', 'starPrice', 'definitionPrices'].includes(s.priceRule.type)) fail(`shop ${s.id}: priceRule type`);
    if (s.kind !== undefined && !['operator', 'skill', 'enchantment', 'supply'].includes(s.kind)) fail(`shop ${s.id}: kind`);
    if (['skill', 'enchantment', 'supply'].includes(s.kind) && (s.filter.type !== 'none' || s.priceRule.type !== 'definitionPrices')) fail(`shop ${s.id}: upgrade shop requires filter none and definitionPrices`);
  }
  const groupExpect = { base: 1, discount: 1, elite: 1, profession: 8, faction: 3, archetype: 10, star: 2, skill: 1, enchantment: 1, supply: 1 };
  for (const [g, n] of Object.entries(groupExpect)) if ((groupCount[g] || 0) !== n) fail(`shop group ${g} must be ${n}, got ${groupCount[g] || 0}`);

  // ---- collectibles / state machine / machineCheck presence
  if (!sys.collectibleRewards || sys.collectibleRewards.poolSize !== 72) fail('collectibleRewards.poolSize must be 72');
  if (!sys.stateMachine || sys.stateMachine.idempotentStep !== true || sys.stateMachine.seededRandomStored !== true) fail('stateMachine must be idempotent and store seeded random results');
  if (!Array.isArray(sys.machineCheck) || sys.machineCheck.length < 10) fail('machineCheck must list the required checks');

  // ================= real-data cross checks =================
  const roster = readJson(ROSTER);
  const selected = (roster.candidates || []).filter((c) => c.selected === true);
  if (selected.length !== 170) fail(`active roster selected must be 170, got ${selected.length}`);
  const selectedIds = new Set(selected.map((c) => c.charId));

  const skills = Array.isArray(sys.strategySkills) ? sys.strategySkills : [];
  const enchantments = Array.isArray(sys.enchantments) ? sys.enchantments : [];
  const enchantmentPools = Array.isArray(sys.enchantmentPools) ? sys.enchantmentPools : [];
  const skillLevelRewards = Array.isArray(sys.skillLevelRewards) ? sys.skillLevelRewards : [];
  const operatorUpgradeRewards = Array.isArray(sys.operatorUpgradeRewards) ? sys.operatorUpgradeRewards : [];
  errors.push(...validateSkillLevelRewards(sys));
  const skillIds = new Set();
  const enchantmentIds = new Set();
  for (const skill of skills) {
    if (!isStr(skill.id) || skillIds.has(skill.id) || !isStr(skill.name) || !isStr(skill.description)) fail(`strategy skill id/name/description invalid: ${skill?.id}`);
    skillIds.add(skill.id);
    if (!Number.isInteger(skill.startingStar) || skill.startingStar < 1 || skill.startingStar > 4) fail(`${skill.id}: startingStar must be 1..4`);
    if (!Array.isArray(skill.prices) || skill.prices.length !== 4 || skill.prices.some((v) => !Number.isInteger(v) || v < 0)) fail(`${skill.id}: prices must be four nonnegative integers`);
    if (!skill.icon || !isStr(skill.icon.kind) || !isStr(skill.icon.name)) fail(`${skill.id}: icon kind/name required`);
    if (!skill.sourceRef || skill.sourceRef.table !== 'cards' || !isStr(skill.sourceRef.rowId) || !isStr(skill.sourceRef.pointer)) fail(`${skill.id}: sourceRef must identify a cards row and pointer`);
  }
  for (const enchant of enchantments) {
    if (!isStr(enchant.id) || enchantmentIds.has(enchant.id) || !isStr(enchant.name) || !isStr(enchant.description)) fail(`enchantment id/name/description invalid: ${enchant?.id}`);
    enchantmentIds.add(enchant.id);
    if (!Number.isInteger(enchant.price) || enchant.price < 0 || !['any', 'instant'].includes(enchant.eligibility)) fail(`${enchant.id}: price/eligibility invalid`);
    if (!enchant.icon || !isStr(enchant.icon.kind) || !isStr(enchant.icon.name) || !enchant.battle || !isStr(enchant.battle.kind)) fail(`${enchant.id}: icon and battle kind required`);
    if (!enchant.sourceRef || enchant.sourceRef.table !== 'cards' || !isStr(enchant.sourceRef.rowId) || !isStr(enchant.sourceRef.pointer)) fail(`${enchant.id}: sourceRef must identify a cards row and pointer`);
  }
  const expectedPoolWeights = new Map([
    ['enchant_heavy', 50], ['enchant_icy', 10], ['enchant_turbo', 50], ['enchant_shielded', 50],
    ['enchant_restorative', 50], ['enchant_toxic', 50], ['enchant_mossy', 50], ['enchant_fiery', 50],
    ['enchant_shiny', 10], ['enchant_deadly', 20], ['enchant_radiant', 10], ['enchant_obsidian', 10],
  ]);
  if (enchantmentPools.length !== 1 || enchantmentPools[0]?.id !== 'pool_bazaar_random') fail('enchantmentPools must contain pool_bazaar_random exactly once');
  const poolIds = new Set();
  for (const pool of enchantmentPools) {
    if (!isStr(pool.id) || poolIds.has(pool.id)) fail(`enchantment pool id invalid/duplicate: ${pool?.id}`);
    poolIds.add(pool.id);
    const seenEntries = new Set();
    if (!Array.isArray(pool.entries) || pool.entries.length !== 12) fail(`${pool.id}: entries must contain 12 enchantments`);
    for (const entry of pool.entries ?? []) {
      if (!enchantmentIds.has(entry.enchantmentId) || seenEntries.has(entry.enchantmentId)) fail(`${pool.id}: invalid/duplicate enchantment ${entry.enchantmentId}`);
      seenEntries.add(entry.enchantmentId);
      if (entry.enchantmentId === 'enchant_golden') fail(`${pool.id}: Golden must not be in the random pool`);
      if (!Number.isFinite(entry.weight) || entry.weight <= 0 || expectedPoolWeights.get(entry.enchantmentId) !== entry.weight) fail(`${pool.id}: invalid source weight for ${entry.enchantmentId}`);
    }
    for (const id of expectedPoolWeights.keys()) if (!seenEntries.has(id)) fail(`${pool.id}: missing source enchantment ${id}`);
    if (!isStr(pool.conversion) || !pool.sourceRef) fail(`${pool.id}: conversion and sourceRef are required`);
    if (pool.sourceRef?.rowId !== 'a1a898d3-4e07-41bb-a293-bb41fa39a6df'
      || pool.sourceRef?.pointer !== '/Abilities/0/Action/Enchantments') fail(`${pool.id}: sourceRef must point to the official shared random enchantment list`);
  }
  if (skills.length !== 10) fail(`strategySkills must be 10, got ${skills.length}`);
  if (enchantments.length !== 13) fail(`enchantments must be 13, got ${enchantments.length}`);
  const skillShop = shops.find((shop) => shop.id === 'shop_strategy');
  const enchantShop = shops.find((shop) => shop.id === 'shop_enchant');
  if (skillShop?.kind !== 'skill' || skillShop.group !== 'skill') fail('shop_strategy must be the skill group shop');
  if (enchantShop?.kind !== 'enchantment' || enchantShop.group !== 'enchantment') fail('shop_enchant must be the enchantment group shop');
  const supplyShop=shops.find(shop=>shop.id==='shop_supply');
  if(supplyShop?.kind!=='supply'||supplyShop.group!=='supply')fail('shop_supply must be the supply group shop');

  const lifecycle = Array.isArray(sys.runLifecycleRules) ? sys.runLifecycleRules : [];
  const lifecycleIds = new Set();
  for (const rule of lifecycle) {
    if (!isStr(rule.id) || lifecycleIds.has(rule.id)) fail(`runLifecycleRules duplicate/invalid id: ${rule?.id}`);
    lifecycleIds.add(rule.id);
    const ownerValid = rule.owner?.kind === 'skill' ? skillIds.has(rule.owner.id)
      : rule.owner?.kind === 'enchantment' ? enchantmentIds.has(rule.owner.id)
        : rule.owner?.kind === 'operator' ? selectedIds.has(rule.owner.id) : false;
    if (!ownerValid) fail(`${rule.id}: owner must point to a defined skill, enchantment, or selected operator`);
    if (!['buy', 'sell', 'upgrade', 'dayStarted', 'hourStarted', 'shopEntered', 'skillBought', 'skillUpgraded', 'shopCardsDealt'].includes(rule.event)) fail(`${rule.id}: unsupported lifecycle event`);
    if (!Array.isArray(rule.effects) || !rule.effects.length) fail(`${rule.id}: effects required`);
    for (const effect of rule.effects ?? []) {
      if (!hasFourFiniteAmounts(effect)) fail(`${rule.id}: ${effect.kind} must have four finite amountByStar values`);
      if (effect.kind === 'enhance' && (!['self', 'transaction', 'team', 'leftmost'].includes(effect.target) || !isStr(effect.stat) || !['flat', 'percent'].includes(effect.mode))) fail(`${rule.id}: invalid enhance target/stat/mode`);
      if (effect.kind === 'currency' && !['gold', 'xp', 'life'].includes(effect.currency)) fail(`${rule.id}: invalid currency effect`);
      if (effect.kind === 'shopDiscount' && (!hasFourFiniteAmounts(effect) || effect.amountByStar.some((v) => v < 0) || !['randomOne', undefined].includes(effect.target))) fail(`${rule.id}: invalid shop discount`);
      if (effect.kind === 'teamGrowth' && !isStr(effect.stat)) fail(`${rule.id}: teamGrowth stat required`);
      if (!['enhance', 'currency', 'shopDiscount', 'teamGrowth'].includes(effect.kind)) fail(`${rule.id}: unknown lifecycle effect ${effect.kind}`);
    }
    const filter = rule.transactionFilter;
    if (filter && ((filter.professions !== undefined && (!Array.isArray(filter.professions) || filter.professions.some((v) => !isStr(v)))
      || (filter.maxSourceCopies !== undefined && (!Number.isInteger(filter.maxSourceCopies) || filter.maxSourceCopies < 1))))) fail(`${rule.id}: invalid transactionFilter`);
  }
  if (lifecycle.length !== 7) fail(`runLifecycleRules must be 7, got ${lifecycle.length}`);

  if (skills.length || enchantments.length || skillLevelRewards.length || operatorUpgradeRewards.length || sys.supplyItems?.length) {
    if (!fs.existsSync(BAZAAR_DB)) fail(`Official bazaar DB missing for upgrade provenance: ${BAZAAR_DB}`);
    else {
      const sourceRows = readDatabase(BAZAAR_DB, ['cards', 'level_ups', 'game_modes']);
      const cardRows = new Map(sourceRows.cards.map((row) => [String(row.rowId), row.dataText]));
      const levelUpRows = new Map(sourceRows.level_ups.map((row) => [Number(row.rowId), row.dataText]));
      errors.push(...validateSourceReferences([...skills, ...enchantments, ...skillLevelRewards, ...enchantmentPools], cardRows));
      errors.push(...validateOperatorUpgradeRewards(sys, cardRows, levelUpRows));
      errors.push(...validateSupplyItems(sys,cardRows,supplyStandardPrices(sourceRows.game_modes)));
    }
  }

  const idx = readJson(INDEX);
  const byId = new Map((idx.operators || []).map((o) => [o.charId, o]));
  const professionCount = {};
  const nationCount = {};
  for (const id of selectedIds) {
    const o = byId.get(id);
    if (!o) { report(`active roster ${id} missing from operator index`); continue; }
    professionCount[o.profession] = (professionCount[o.profession] || 0) + 1;
    const nat = (o.affiliation && o.affiliation.nationId) || 'none';
    nationCount[nat] = (nationCount[nat] || 0) + 1;
  }

  // starters real & selected
  for (const d of directors) {
    for (const id of d.startTeam || []) {
      if (!byId.has(id)) fail(`director ${d.id}: start member ${id} not a real operator`);
      if (!selectedIds.has(id)) fail(`director ${d.id}: start member ${id} not in active roster`);
    }
  }

  // starter relics
  const col = fs.existsSync(COLLECTIBLES) ? readJson(COLLECTIBLES) : { items: [] };
  const items = Array.isArray(col.items) ? col.items : [];
  if (items.length !== 72) report(`collectibles.json holds ${items.length}/72 items (other group still writing)`);
  const starterItems = items.filter((x) => x.rarity === 'starter');
  if (starterItems.length !== 3) fail(`starter collectibles must be 3, got ${starterItems.length}`);
  for (const d of directors) {
    const relic = starterItems.find((x) => x.id === d.starterRelicId);
    if (!relic) { fail(`director ${d.id}: starter relic ${d.starterRelicId} not found`); continue; }
    if (relic.leaderCharId !== d.leaderCharId) fail(`director ${d.id}: starter relic leader mismatch`);
  }

  // events coverage
  const ev = fs.existsSync(EVENTS) ? readJson(EVENTS) : { events: [] };
  const events = Array.isArray(ev.events) ? ev.events : [];
  if (events.length !== 26) fail(`events must be 26, got ${events.length}`);
  for (const eventId of ['evt_bazaar_hat', 'evt_bazaar_botul']) {
    const entry = events.find((candidate) => candidate.id === eventId);
    if (!entry || entry.topicId !== 'bazaar' || entry.repeatable !== false || entry.unlockDay !== 6
      || entry.conditions?.minDay !== 6 || entry.conditions?.maxDay !== 9 || entry.conditions?.oncePerRun !== true
      || entry.choices?.length !== 2 || entry.choices.some((choice) => choice.targeting?.mode !== 'none')) fail(`${eventId}: Bazaar event contract invalid`);
    const effects = entry?.choices?.flatMap((choice) => choice.outcomes?.flatMap((outcome) => outcome.effects ?? []) ?? []) ?? [];
    const random = effects.find((effect) => effect.kind === 'randomEnchant');
    const expectedRule = eventId === 'evt_bazaar_hat' ? 'oldestUnenchanted' : 'oldestToxic';
    if (!random || random.poolId !== 'pool_bazaar_random' || random.targetRule !== expectedRule) fail(`${eventId}: random enchant pool/target rule invalid`);
    if (eventId === 'evt_bazaar_botul') {
      const choice = entry.choices.find((candidate) => candidate.id === 'botul_recast');
      if (!choice || choice.costs?.length !== 1 || choice.costs[0].currency !== 'gold' || choice.costs[0].amount !== 20) fail('evt_bazaar_botul: expected 20 gold choice cost');
    }
  }
  const topicCount = {};
  for (const e of events) topicCount[e.topicId] = (topicCount[e.topicId] || 0) + 1;
  for (let i = 1; i <= 6; i++) if ((topicCount[`rogue_${i}`] || 0) !== 4) fail(`events rogue_${i} must be 4, got ${topicCount[`rogue_${i}`] || 0}`);

  // Resolve every selected identity against its finished per-card group design.
  const cardById = new Map();
  for (const group of ['support', 'assault', 'ranged']) {
    const file = P('data', 'assault-design', `roster-${group}.json`);
    const doc = readJson(file);
    for (const op of doc.operators || []) {
      if (cardById.has(op.charId)) fail(`per-card roster duplicate ${op.charId}`);
      cardById.set(op.charId, op);
    }
  }
  if (cardById.size !== 170) fail(`per-card designs must cover 170, got ${cardById.size}`);
  const tierToPrice = [0, 2, 3, 4, 6, 8, 12];
  const archetypes = ['cold','redeploy','ammo','element','summon','healShield','blockCounter','pierceCrit','skillCycle','economyGrowth'];
  const archetypeCount = Object.fromEntries(archetypes.map(a => [a, 0]));
  const positiveBasePrices = new Set((pt.bands || []).flatMap(b => Object.entries(b.weights || {}).filter(([,w]) => Number(w) > 0).map(([price]) => Number(price))));
  const latePositivePrices = new Set((pt.bands || []).filter(b => b.days?.[0] >= 5).flatMap(b => Object.entries(b.weights || {}).filter(([,w]) => Number(w) > 0).map(([price]) => Number(price))));
  for (const id of selectedIds) {
    const op = cardById.get(id);
    if (!op) { fail(`selected operator ${id} missing per-card design`); continue; }
    if (!Number.isInteger(op.priceTier) || op.priceTier < 1 || op.priceTier > 6 || op.price !== tierToPrice[op.priceTier]) fail(`${id}: per-card priceTier/price mismatch`);
    if (!positiveBasePrices.has(op.price)) fail(`${id}: no base shop positive weight for designed price ${op.price}`);
    if (!archetypes.includes(op.archetype)) fail(`${id}: missing/invalid per-card archetype`); else archetypeCount[op.archetype]++;
    const im = (op.modulePlans || []).find(m => m.id === op.defaultModuleId);
    if (op.defaultModuleId && (!im || im.mode === 'disabled' || !['INITIAL','ADVANCED'].includes(im.type))) fail(`${id}: default module must resolve to an enabled native module plan`);
    if (op.defaultModuleId && !byId.get(id)?.modules?.some(m => m.moduleId === op.defaultModuleId)) fail(`${id}: default module id absent from operator index`);
    if (op.fixedSkill?.kind === 'instant') {
      if (!Array.isArray(op.fixedSkill.spCosts) || op.fixedSkill.spCosts.length !== 4 || op.fixedSkill.spCosts.some(x => !Number.isFinite(x) || x < 0.5)) fail(`${id}: instant SP costs must come from per-card four-star design`);
      if (!(Number.isFinite(op.fixedSkill.initSp) || (Array.isArray(op.fixedSkill.initSp) && [1,4].includes(op.fixedSkill.initSp.length) && op.fixedSkill.initSp.every(Number.isFinite)))) fail(`${id}: instant INIT must come from per-card scalar/four-star design`);
      if (op.fixedSkill.sourceSkillId && !byId.get(id)?.skillIds?.includes(op.fixedSkill.sourceSkillId)) fail(`${id}: fixed skill source id is not native`);
    } else if (op.fixedSkill?.kind !== 'passive') fail(`${id}: fixed skill must be instant or passive`);
  }
  for (const [a, n] of Object.entries(archetypeCount)) if (n === 0) fail(`archetype shop ${a} has no active per-card candidates`);

  // shop candidate resolution against the active roster
  for (const s of shops) {
    if (s.filter.type === 'profession') {
      const n = professionCount[s.filter.value] || 0;
      if (n === 0) report(`shop ${s.id}: no active candidate for profession ${s.filter.value}`);
    } else if (s.filter.type === 'faction') {
      const n = nationCount[s.filter.value] || 0;
      if (n === 0) report(`shop ${s.id}: no active candidate for faction ${s.filter.value}`);
    } else if (s.filter.type === 'archetype') {
      if (!(archetypeCount[s.filter.value] > 0)) fail(`shop ${s.id}: no active per-card candidate for archetype ${s.filter.value}`);
    }
    if (s.group === 'elite') {
      const eligible=(s.priceRule?.tiers||[]).filter(price=>latePositivePrices.has(price));
      if (!eligible.length || (s.unlockDay||99) > 5) fail(`shop ${s.id}: elite price tiers need positive post-day-5 weight and day-5 unlock`);
    }
  }

  // modules default + active skill cost/init rule evidence
  let withModules = 0;
  let withSkills = 0;
  for (const id of selectedIds) {
    const o = byId.get(id);
    if (!o) continue;
    if (Array.isArray(o.modules) && o.modules.length) withModules++;
    if (Array.isArray(o.skills) && o.skills.length) withSkills++;
  }
  notes.push(`active roster ${selectedIds.size}; professions ${JSON.stringify(professionCount)}; factions kjerag/victoria/laterano = ${nationCount.kjerag || 0}/${nationCount.victoria || 0}/${nationCount.laterano || 0}`);
  notes.push(`operators with modules ${withModules}, with skills ${withSkills}; active per-card design price/archetype/module/skill checked against source`);

  // report
  for (const e of errors) console.log(`FAIL ${e}`);
  for (const r of reports) console.log(`REPORT ${r}`);
  for (const n of notes) console.log(`NOTE ${n}`);
  const ok = errors.length === 0 && (!strict || reports.length === 0);
  if (ok) {
    console.log(`OK check-system-design: directors=${directors.length} shops=${shops.length} events=${events.length} roster=${selectedIds.size} collectibles=${items.length}${strict ? ' (strict)' : ''}`);
    process.exit(0);
  }
  console.log(`FAILED check-system-design: ${errors.length} error(s), ${reports.length} report(s)`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
