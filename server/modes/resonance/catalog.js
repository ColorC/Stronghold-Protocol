import { getData } from '../../data.js';
import { resonanceContent, buildRecruitmentPool, resonanceSourceSkillGaps } from '../../../shared/resonance/catalog.js';
import { selectResonanceOpening, selectPrototypeOpening, resonanceRulesVersion } from '../../../shared/resonance/openings.js';
import { resonanceSeason, getResonanceSeason, validateResonanceSeasonRoster } from '../../../shared/resonance/season-roster.js';
import { applyCurrentStrategies } from '../../../shared/resonance/current-strategies.js';
import { applyCurrentPacts } from '../../../shared/resonance/current-pacts.js';
import { applyCurrentOperators } from '../../../shared/resonance/current-operators.js';
import { applyCurrentEquipment } from '../../../shared/resonance/current-equipment.js';
import { getActivePrototypeSeason, getPrototypeSeason, retiredEconomyTraitIds } from '../../../shared/resonance/season-registry.js';
import { buildNativePowerStars, buildNativePowerReference } from '../../../shared/resonance/native-power.js';
import { tftArmorToNativeDefense, tftMrToNativeResistance } from '../../../shared/resonance/prototype-resistance.js';
import { applyPrototypePacts } from '../../sim/content/resonance/prototype-pacts.js';
import { applyPrototypeStrategies } from '../../../shared/resonance/prototype-strategies.js';
import { applyPrototypeEconomy, prototypeEconomyRules } from '../../../shared/resonance/prototype-economy.js';
import { applyPrototypeSourceGear } from '../../../shared/resonance/prototype-source-gear.js';
import { applyOperatorAdaptations } from '../../../shared/resonance/operator-adaptations.js';
import { enemyNodeCurve } from '../../../shared/resonance/enemy-curve.js';

const clone = (value) => structuredClone(value);
const operatorCache = new WeakMap();
/**
 * An operator whose native 特性 reads 「不受部署数量限制」 (正义骑士号) is marked `ignoresDeployLimit`: the session counts one such
 * operator on the field as free of the deploy cap (session.js countedDeployed), and this mode gives it no 盟约.
 */
const DEPLOY_FREE_TRAIT = /不受部署数量限制/;

function skillFor(data, sourceChess, skillId, fallback) {
  if (!skillId) return null;
  return (sourceChess.skills ?? []).find((skill) => skill.skillId === skillId)
    ?? (sourceChess.skill?.skillId === skillId ? sourceChess.skill : null)
    ?? fallback
    ?? null;
}

function chooseStarterIds(activeOperatorIds, operators) {
  const active = activeOperatorIds.map((id) => operators[id]);
  const frontline = active.filter((op) => op.cost === 1 && op.role === 'frontline');
  const ranged = active.filter((op) => op.cost === 1 && op.position === 'RANGED');
  const starters = [...frontline.slice(0, 2).map((op) => op.id)];
  const range = ranged.find((op) => !starters.includes(op.id)) ?? ranged[0];
  if (range) starters.push(range.id);
  if (starters.length !== 3) throw new Error('RESONANCE_STARTERS_UNAVAILABLE');
  return starters;
}

/**
 * Merge the published, deterministic resonance configuration with canonical native chess data.
 * The environment pool contains 65 IDs; the operator map always retains all 154 entries.
 */
export function getResonanceCatalog(data = getData(), options = {}) {
  const { environmentId = 'origin_laterano', seed = 1 } = options;
  // Explicit environment-only calls are the legacy configuration API. New entry points always request v2.
  const rulesVersion = options.rulesVersion ?? (Object.hasOwn(options, 'environmentId') ? 1 : 2);
  resonanceRulesVersion({ rulesVersion });
  const nativeChess = data?.chess;
  if (!nativeChess || typeof nativeChess !== 'object') throw new Error('RESONANCE_NATIVE_CHESS_UNAVAILABLE');
  let operators=operatorCache.get(nativeChess);
  if (!operators) {
   operators = {};
   for (const [sourceChessId, configured] of Object.entries(resonanceContent.operators)) {
    const normalChess = nativeChess[sourceChessId];
    if (!normalChess) throw new Error(`RESONANCE_SOURCE_CHESS_MISSING:${sourceChessId}`);
    const selectedSkill = configured.fixedSkillIndex === null
      ? null
      : skillFor(data, normalChess, configured.fixedSkillId, configured.stars[1].record.skill);
    const normalChessView = clone(normalChess);
    if (selectedSkill) {
      normalChessView.skill = { ...clone(selectedSkill), skillId: configured.fixedSkillId, index: configured.fixedSkillIndex ?? 0 };
      normalChessView.assets = { ...(normalChessView.assets??{}), skillIcon: selectedSkill.iconId ?? configured.fixedSkillId };
    }
    const stars = {};
    for (const star of [1, 2, 3]) {
      const spec = configured.stars[star];
      const record = clone(normalChess);
      record.tier = configured.cost;
      record.resonanceStar = star;
      record.stats = { ...normalChess.stats, ...spec.stats };
      record.skill = selectedSkill ? { ...clone(selectedSkill), ...spec.skillOverrides, skillId: configured.fixedSkillId, index: configured.fixedSkillIndex ?? 0 } : null;
      if(record.skill)record.assets={...(record.assets??{}),skillIcon:record.skill.iconId??configured.fixedSkillId};
      record.skills = record.skill
        ? (normalChess.skills ?? []).map((skill) => skill.skillId === record.skill.skillId ? record.skill : clone(skill))
        : [];
      if (Array.isArray(normalChess.talents)) record.talents = normalChess.talents.map((talent, index) => ({
        ...clone(talent), bb: { ...(talent.bb ?? {}), ...(spec.talentOverrides[index]?.bb ?? {}) },
      }));
      stars[star] = { ...clone(spec), record, normalized: { ...spec.stats } };
    }
    operators[sourceChessId] = {
      ...configured,
      ...(DEPLOY_FREE_TRAIT.test(normalChess.trait?.desc ?? '') ? { ignoresDeployLimit: true } : {}),
      source: { ...configured.source, normalChess: normalChessView },
      stars,
    };
   }
   operatorCache.set(nativeChess,operators);
  }
  const catalog = { ...resonanceContent, operators };
  if (rulesVersion === 3) {
    const registered = options.seasonId == null ? getActivePrototypeSeason() : getPrototypeSeason(options.seasonId);
    // an operator free of the deploy cap belongs to no 盟约 here: the season's trait member lists leave it out, so the pacts, their member
    // lists, the cards' tags and every count that reads them agree
    const unaffiliated = new Set(Object.values(operators).filter((operator) => operator.ignoresDeployLimit).map((operator) => operator.charId));
    const season = unaffiliated.size
      ? { ...registered, traits: registered.traits.map((trait) => ({ ...trait, members: trait.members.filter((charId) => !unaffiliated.has(charId)) })) }
      : registered;
    const seasonId = season.id;
    const seasonOperators = { ...operators };
    const traitIdsByCharId = new Map();
    const effectiveHeroes=[];
    for (const trait of season.traits) for (const charId of trait.members) {
      const ids=traitIdsByCharId.get(charId)??[]; ids.push(trait.id); traitIdsByCharId.set(charId,ids);
    }
    const activeOperatorIds = [];
    for (const hero of season.heroes) {
      const original = operators[hero.sourceChessId];
      if (!original || original.charId !== hero.charId) throw new Error(`RESONANCE_PROTOTYPE_OPERATOR_MISMATCH:${hero.sourceChessId}`);
      let stars,powerReference=hero.powerReference??{};
      if(season.powerModel==='native-pve'){
        stars=buildNativePowerStars(original,hero,season);
        powerReference=buildNativePowerReference(original,hero,season);
      }else{
        const roleMultipliers=season.powerBudget.roleMultipliers[hero.role]??{hp:1,dps:1};
        const targetHp=season.powerBudget.oneStarBaseHp[hero.cost-1]*roleMultipliers.hp;
        const budgetScale=hero.currentFeeAdjustment?.budgetScale??1;
        if(!Number.isFinite(budgetScale)||budgetScale<=0)throw new Error(`RESONANCE_INVALID_FEE_ADJUSTMENT:${hero.apiName}`);
        const targetDps=season.powerBudget.oneStarBaseDps[hero.cost-1]*roleMultipliers.dps*budgetScale;
        const normalBat=Number(original.source.normalChess.stats?.bat??1);
        const sourceAttackSpeed=Number(hero.powerReference?.attackSpeed);
        const sourceBat=Number.isFinite(sourceAttackSpeed)&&sourceAttackSpeed>0?1/sourceAttackSpeed:normalBat;
        stars={};
        for (const star of [1,2,3]) {
          const sourceStar=original.stars[star];
          const hpMult=season.powerBudget.starMultipliers.hp[star-1];
          const atkMult=season.powerBudget.starMultipliers.atk[star-1];
          const armor=hero.powerReference?.armor,resistance=hero.powerReference?.magicResist;
          const nativeArmor=typeof armor==='number'&&Number.isFinite(armor)?tftArmorToNativeDefense(armor,hero.powerReference?.attackDamage):null;
          const nativeMr=typeof resistance==='number'&&Number.isFinite(resistance)?tftMrToNativeResistance(resistance):null;
          const stats={...sourceStar.stats,maxHp:Math.round(targetHp*hpMult),atk:Math.round(targetDps*sourceBat*atkMult),def:nativeArmor==null?sourceStar.stats.def:nativeArmor,res:nativeMr==null?sourceStar.stats.res:nativeMr,bat:sourceBat};
          const record={...clone(sourceStar.record),tier:hero.cost,resonanceStar:star,stats:{...sourceStar.record.stats,maxHp:stats.maxHp,atk:stats.atk,def:stats.def,res:stats.res,bat:stats.bat}};
          stars[star]={...clone(sourceStar),stats,normalized:stats,record};
        }
      }
      effectiveHeroes.push(season.powerModel==='native-pve'
        ?{...hero,sourcePowerReference:clone(hero.powerReference??{}),powerReference:clone(powerReference),nativePowerReference:clone(powerReference)}
        :hero);
      seasonOperators[hero.sourceChessId]={...original,cost:hero.cost,role:hero.role,pacts:[...new Set(unaffiliated.has(hero.charId)?[]:traitIdsByCharId.get(hero.charId)??[])],currentFeeAdjustment:hero.currentFeeAdjustment?clone(hero.currentFeeAdjustment):null,stars,nativePowerReference:clone(powerReference),source:{...original.source,normalChess:{...original.source.normalChess,tier:hero.cost}}};
      activeOperatorIds.push(hero.sourceChessId);
    }
    const seasonForConsumers=season.powerModel==='native-pve'?{...season,heroes:effectiveHeroes}:season;
    const currentCatalog=applyPrototypeEconomy(applyPrototypePacts(applyPrototypeSourceGear(applyCurrentEquipment({
      ...catalog,
      operators:seasonOperators,
      prototypeSeason:seasonForConsumers,
    }))));
    if(currentCatalog.pacts.conqueror)currentCatalog.pacts.conqueror={...currentCatalog.pacts.conqueror,
      rewardThresholds:[...prototypeEconomyRules.conqueror.chestThresholds]};
    // a season that retired the 叙拉古 market (season 2) never hands out its tiered passive items: they stay readable
    // and leave the codex like every other never-granted item
    if(retiredEconomyTraitIds(season).has('risk'))for(const [id,item] of Object.entries(currentCatalog.equipment))
      if(item.kind==='passive'&&item.prototypeEconomyTier)currentCatalog.equipment[id]={...item,grantAllowed:false};
    const prototypeEmblemIds=new Set(currentCatalog.prototypeEmblemItems);
    const legacyEmblemIds=new Set(Object.values(currentCatalog.equipment).filter((item)=>item.kind==='emblem'&&!prototypeEmblemIds.has(item.id)).map((item)=>item.id));
    currentCatalog.equipment=Object.fromEntries(Object.entries(currentCatalog.equipment).filter(([,item])=>item.kind!=='emblem'||prototypeEmblemIds.has(item.id)));
    currentCatalog.recipes=currentCatalog.recipes.filter((recipe)=>!legacyEmblemIds.has(recipe.resultId));
    Object.assign(currentCatalog,applyPrototypeStrategies(currentCatalog));
    // a season may rewrite operators' own effects for the mode (season 2: shared/resonance/operator-adaptations.js)
    if(season.operatorAdaptations)Object.assign(currentCatalog,applyOperatorAdaptations(currentCatalog,season.operatorAdaptations));
    const campaign=clone(currentCatalog.campaign);
    campaign.strategyNodes=[5,13,20];
    campaign.shopOdds=clone(prototypeEconomyRules.shopOddsByLevel);
    campaign.economy={...campaign.economy,xpToLevel:clone(prototypeEconomyRules.xpToLevel),xpCurveSource:clone(prototypeEconomyRules.sourceVersions)};
    delete campaign.supply.acceleratedStrategy;
    // a season may name its own pact-transfer supply nodes (season 2: one, so a run gains one to three transfers)
    campaign.supply.transfers=(season.supplyTransfers??campaign.supply.transfers??[]).map((entry)=>({...entry,selection:'viable-pact'}));
    campaign.poolByCost=Object.fromEntries([1,2,3,4,5].map((cost)=>[cost,activeOperatorIds.filter((id)=>seasonOperators[id].cost===cost).length]));
    // regular-wave HP and ATK rise along each difficulty's node curve (shared/resonance/enemy-curve.js)
    campaign.enemyBalance={...campaign.enemyBalance,nodeCurve:clone(enemyNodeCurve)};
    currentCatalog.campaign=campaign;
    currentCatalog.season={id:seasonForConsumers.id,displayName:seasonForConsumers.displayName};
    currentCatalog.prototypeMeta={seasonId:seasonForConsumers.id,rulesVersion:3,exactCounts:Object.values(currentCatalog.pacts).flatMap((pact)=>pact.exactCounts.map((count)=>({traitId:pact.id,count}))),traits:seasonForConsumers.traits,currentFeeAdjustments:seasonForConsumers.heroes.filter((hero)=>hero.currentFeeAdjustment).map((hero)=>({apiName:hero.apiName,operatorId:hero.sourceChessId,operatorName:hero.operatorName,cost:hero.cost,...clone(hero.currentFeeAdjustment)})),hooks:['onPrototypePrep','onPrototypeBattleResult']};
    currentCatalog.specialEntities=clone(seasonForConsumers.specialEntities??{});
    currentCatalog.config={rulesVersion,seasonId,environmentId:null,openingId:selectPrototypeOpening(seed),seed,activeOperatorIds,starterIds:chooseStarterIds(activeOperatorIds,seasonOperators)};
    currentCatalog.diagnostics={sourceSkillGaps:clone(resonanceSourceSkillGaps)};
    return currentCatalog;
  }
  if (rulesVersion === 2) {
    const selectedSeason = getResonanceSeason(options.seasonId ?? resonanceSeason.id);
    if (!selectedSeason) throw new Error(`RESONANCE_UNKNOWN_SEASON:${options.seasonId}`);
    const seasonOperators = { ...operators };
    for (const [id, additions] of Object.entries(selectedSeason.traitOverrides)) {
      if (!Object.hasOwn(operators, id)) throw new Error(`RESONANCE_UNKNOWN_SEASON_OPERATOR:${id}`);
      seasonOperators[id] = { ...operators[id], pacts: [...new Set([...operators[id].pacts, ...additions])] };
    }
    catalog.operators = seasonOperators;
    const activeOperatorIds = validateResonanceSeasonRoster(seasonOperators, selectedSeason.operatorIds, selectedSeason.quotas);
    const currentCatalog = applyCurrentOperators(applyCurrentPacts(applyCurrentStrategies(applyCurrentEquipment(catalog))));
    const campaign = clone(currentCatalog.campaign);
    campaign.strategyNodes = [5, 13, 20];
    delete campaign.supply.acceleratedStrategy;
    campaign.supply.transfers = campaign.supply.transfers.map((entry) => ({ ...entry, selection: 'viable-pact' }));
    campaign.poolByCost = Object.fromEntries([1,2,3,4,5].map((cost) => [cost, activeOperatorIds.filter((id) => operators[id].cost === cost).length]));
    currentCatalog.campaign = campaign;
    currentCatalog.season = { id: selectedSeason.id, displayName: selectedSeason.displayName };
    currentCatalog.config = { rulesVersion, seasonId: selectedSeason.id, environmentId: null, openingId: selectResonanceOpening(seed), seed, activeOperatorIds, starterIds: chooseStarterIds(activeOperatorIds, seasonOperators) };
    currentCatalog.diagnostics = { sourceSkillGaps: clone(resonanceSourceSkillGaps) };
    return currentCatalog;
  }
  const resolvedEnvironmentId = catalog.environments[environmentId]
    ? environmentId
    : catalog.environments[`origin_${environmentId}`]
      ? `origin_${environmentId}`
      : null;
  if (!resolvedEnvironmentId) throw new Error(`RESONANCE_UNKNOWN_ENVIRONMENT:${environmentId}`);
  const activeOperatorIds = buildRecruitmentPool(catalog, { environmentId: resolvedEnvironmentId, seed });
  const starterIds = chooseStarterIds(activeOperatorIds, operators);
  catalog.config = { rulesVersion: 1, environmentId: resolvedEnvironmentId, seed, activeOperatorIds, starterIds };
  catalog.diagnostics = { sourceSkillGaps: clone(resonanceSourceSkillGaps) };
  return catalog;
}

export function getLegacyResonanceCatalog(data = getData(), { environmentId = 'origin_laterano', seed = 1 } = {}) {
  return getResonanceCatalog(data, { rulesVersion: 1, environmentId, seed });
}

export function getResonanceCatalogForState(data, state) {
  const rulesVersion = resonanceRulesVersion(state);
  if (rulesVersion === 1) return getLegacyResonanceCatalog(data, state);
  if (rulesVersion === 3) return getResonanceCatalog(data, { rulesVersion, seed: state.seed, seasonId: state.seasonId });
  if (!getResonanceSeason(state?.seasonId)) throw new Error(`RESONANCE_UNKNOWN_SEASON:${state?.seasonId}`);
  return getResonanceCatalog(data, { rulesVersion, seed: state.seed, seasonId: state.seasonId });
}

export { buildRecruitmentPool, resonanceContent, resonanceSourceSkillGaps };
