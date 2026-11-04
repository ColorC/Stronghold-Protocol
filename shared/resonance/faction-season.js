import {prototypeSeason} from './prototype-season.js';
import {resonanceContent} from './catalog.js';
import {factionRoster,combatRoster,sourceHookAssignments} from './faction-roster.js';
import {nativePowerBudget} from './native-power.js';
import {nativeTraitVariables,NATIVE_FLAT_SCALE} from './native-effect-scale.js';

const clone=value=>structuredClone(value);
const requireValue=(condition,message)=>{if(!condition)throw new Error(message);};
const byName=new Map(Object.values(resonanceContent.operators).map(op=>[op.name,op]));
const entries=factionRoster.flatMap(f=>f.members.map(([name,cost])=>({name,cost,faction:f,operator:byName.get(name)})));
requireValue(new Set(entries.map(row=>row.name)).size===57,'FACTION_ROSTER_NOT_UNIQUE');
const sourceByApi=new Map(prototypeSeason.heroes.map(hero=>[hero.apiName,hero]));
const assignments=new Map(),used=new Set();
for(const [api,name] of Object.entries(sourceHookAssignments)){
  const entry=entries.find(row=>row.name===name),source=sourceByApi.get(api);
  requireValue(entry&&source&&entry.cost===source.cost,`FACTION_HOOK_INVALID:${api}:${name}`);
  assignments.set(name,source);used.add(api);
}
for(const entry of entries){
  requireValue(entry.operator,`FACTION_NATIVE_OPERATOR_MISSING:${entry.name}`);
  if(entry.faction.nationId)requireValue(entry.operator.source.normalChess.nationId===entry.faction.nationId,`FACTION_WRONG_NATION:${entry.name}`);
  if(assignments.has(entry.name))continue;
  const candidates=prototypeSeason.heroes.filter(hero=>hero.cost===entry.cost&&!used.has(hero.apiName));
  const source=candidates.find(hero=>hero.role===entry.operator.role)??candidates[0];
  requireValue(source,`FACTION_BUDGET_REFERENCE_MISSING:${entry.name}`);
  assignments.set(entry.name,source);used.add(source.apiName);
}
const roleOverrides={'砾':'frontline','格拉尼':'frontline','休谟斯':'frontline'};
const heroes=entries.map(({name,cost,operator,faction})=>{
  const source=assignments.get(name);
  return {...clone(source),sourceChessId:operator.sourceChessId,charId:operator.charId,operatorName:name,cost,
    role:roleOverrides[name]??operator.role,currentFeeAdjustment:null,
    traits:[faction,...combatRoster.filter(row=>row.members.includes(name))].map(row=>row.sourceName),
    nativeAffiliation:{nationId:operator.source.normalChess.nationId,groupId:faction.groupId??null,
      source:'frozen-native-character-table',factionId:faction.id},
    ...(source.experimentBonus?{experimentBonus:{...clone(source.experimentBonus),sourceVariables:{...clone(source.experimentBonus.sourceVariables),
      ...Object.fromEntries(['ExperimentHealthGain','BaseExperimentHealthGain'].filter(key=>source.experimentBonus.sourceVariables?.[key]!=null).map(key=>[key,source.experimentBonus.sourceVariables[key]*NATIVE_FLAT_SCALE]))},
      sourceOriginalVariables:clone(source.experimentBonus.sourceVariables)}}:{}),
  };
});
const traits=[...factionRoster,...combatRoster].map(row=>{
  const source=prototypeSeason.traits.find(trait=>trait.sourceName===row.sourceName);
  requireValue(source,`FACTION_TEMPLATE_MISSING:${row.sourceName}`);
  const names=row.members.map(member=>Array.isArray(member)?member[0]:member);
  const members=names.map(name=>heroes.find(hero=>hero.operatorName===name));
  requireValue(members.every(Boolean),`FACTION_TRAIT_MEMBER_MISSING:${row.name}`);
  const costs=Object.fromEntries([1,2,3,4,5].map(cost=>[cost,members.filter(hero=>hero.cost===cost).length]));
  requireValue(Object.entries(costs).every(([cost,count])=>source.costDistribution[cost]===count),`FACTION_TEMPLATE_FEE_MISMATCH:${row.name}`);
  const isFaction=factionRoster.includes(row);
  return {...clone(source),name:row.name,id:row.id,members:members.map(hero=>hero.charId),memberCount:members.length,
    effects:source.effects.map(tier=>({...clone(tier),sourceVariables:clone(tier.variables),variables:nativeTraitVariables(source.sourceName,tier.variables)})),
    maxNaturalMembers:members.length,costDistribution:costs,group:isFaction?'faction':'combat',
    ...(isFaction?{nativeIconPath:`/assets/ui/campLogo/logo_${row.groupId??row.nationId}.png`}:{}),
    designReference:{sourceName:source.sourceName,sourceMemberFees:Object.entries(source.costDistribution).flatMap(([fee,count])=>Array(count).fill(Number(fee))),
      rule:'exact source activation tiers and natural-member fee multiset; native affiliation and combat kits determine the new membership'},
  };
});
for(const hero of heroes)requireValue(traits.some(t=>t.group==='combat'&&t.members.includes(hero.charId)),`FACTION_NO_COMBAT_PACT:${hero.operatorName}`);
const heroByApi=new Map(heroes.map(hero=>[hero.apiName,hero]));
function remapReward(row){
  const next=clone(row),pact=traits.find(trait=>trait.id===row.traitId);
  next.sourceOriginalEffects=clone(row.effects??{});
  for(const key of ['ShieldAmount','HealthPerWin'])if(Number.isFinite(next.effects?.[key]))next.effects[key]*=NATIVE_FLAT_SCALE;
  next.grantedHeroes=(row.grantedHeroes??[]).map(reward=>{
    const source=sourceByApi.get(reward.apiName);
    let target=heroByApi.get(reward.apiName);
    const compatible=hero=>hero&&(!pact||pact.members.includes(hero.charId));
    if(!compatible(target))target=heroes.find(hero=>hero.cost===source?.cost&&compatible(hero));
    // A source augment can deliberately grant a higher/lower-cost trait partner.
    // Keep its grant fee whenever the new trait has a member at that fee.
    if(!target)target=heroes.find(hero=>hero.cost===source?.cost);
    requireValue(target,`FACTION_REWARD_MISSING:${row.apiName}:${reward.apiName}`);
    return {...reward,name:target.operatorName,charId:target.charId,operatorId:target.sourceChessId,
      ...(target.apiName!==reward.apiName?{modeAdaptation:{kind:'same-fee-active-roster-substitution',sourceApiName:reward.apiName,targetApiName:target.apiName}}:{})};
  });
  if(next.traitId){
    const before=prototypeSeason.traits.find(trait=>trait.id===next.traitId)?.name;
    const after=traits.find(trait=>trait.id===next.traitId)?.name;
    if(before&&after)for(const field of ['displayName','adaptation'])if(typeof next[field]==='string')next[field]=next[field].replaceAll(before,after);
  }
  for(const field of ['displayName','adaptation'])if(typeof next[field]==='string'){
    for(const reward of next.grantedHeroes){const prior=(row.grantedHeroes??[]).find(h=>h.apiName===reward.apiName);if(prior?.name)next[field]=next[field].replaceAll(prior.name,reward.name);}
    if(next.mechanic==='dominator_shield_rush')next[field]=next[field].replace(`${row.effects?.ShieldAmount}点`,`${next.effects?.ShieldAmount}点`);
  }
  if(next.mechanic==='bruiser_health_strike')next.adaptation=`每${next.effects.RefreshSeconds}秒，重装干员下一次攻击附加自身最大生命值${Math.round(next.effects.SlamPercentHealth*100)}%的物理伤害。`;
  if(next.mechanic==='sentinel_shield_bash')next.adaptation='坚阵干员防护评分提高5%；每4秒，下一次攻击额外造成自身防御与法抗总和75%的术法伤害。';
  if(next.mechanic==='sorcerer_death_burst')next.adaptation='术式干员倒下时，对相邻单位造成300%攻击力的术法伤害，享受自身术法增幅。';
  if(next.mechanic==='watcher_battle_scars')next.adaptation='守望干员每受到一次普攻，攻击力提高2%；每受到一次技能命中，术法伤害提高4%。';
  return next;
}
export const factionSeason=Object.freeze({...prototypeSeason,
  id:'resonance-factions-1',displayName:'共鸣',rulesVersion:3,powerModel:'native-pve',nativePowerBudget,
  heroes,traits,costDistribution:Object.fromEntries([1,2,3,4,5].map(cost=>[cost,heroes.filter(hero=>hero.cost===cost).length])),
  augmentCandidates:prototypeSeason.augmentCandidates.map(remapReward),
  strategyCandidates:prototypeSeason.strategyCandidates.map(remapReward),
  source:{...prototypeSeason.source,extraction:'Ten distinct native-faction pools plus combat and personal pacts. Every pact retains its pinned Set 13 activation tiers and natural-member fee multiset. The union is 57 distinct operators; it is not the original 60-champion overlap graph.'},
});
