import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { getResonanceField, runResonanceBattle } from '../../server/modes/resonance/battle.js';
import { applyAction, createSession, validateSession, viewSession } from '../../server/modes/resonance/session.js';
import { canPlace, fieldTile, ownerRangeKeys, positionClass } from '../../server/match/board.js';
import { Grid } from '../../server/sim/grid.js';
import { GEO } from '../../shared/constants.js';
import { normalizeChess, toDataSource } from '../../server/sim/simdata.js';
import { setupUnitKit } from '../../server/sim/content/index.js';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { resonanceOpenings, selectResonanceOpening, openingEventView } from '../../shared/resonance/openings.js';
import { resonanceSeason, resonanceSeasonOperatorIds } from '../../shared/resonance/season-roster.js';

export const CANONICAL_DATA_DIR='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const REPORT='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/resonance/balance-campaign.json';
export const NATURAL_V3_REPORT='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/resonance/native-natural-campaign.json';
export const DIFFICULTIES=['FUNNY','NORMAL','HARD','ABYSS'];
export const ENVIRONMENTS=['aegir','laterano','kjerag','yan','victoria','columbia','kazimierz','siracusa','rhodes','lungmen','sargon','leithania','iberia','higashi','ursus','bolivar','rim','babel','sami'].map(id=>`origin_${id}`);
const DEFAULT_TIMEOUT=8*60*1000;
export const SEASON_REPORT='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/resonance/season-campaign.json';
const dataDir=CANONICAL_DATA_DIR;
const data=loadData(dataDir,{log:{warn(){},error(){},info(){}}});
const nativeDataSource=toDataSource(data);
const catalogCache=new Map();
const poolLedgers=new WeakMap();
const routeAssignmentsByState=new WeakMap();
const carryPowerBaselines=new WeakMap();
const campaignCombatProfiles=new WeakMap();
let activeMetrics=null;
let activeProgress=null;
let activePolicy={id:'legacy',coreOperatorId:null,rushReleased:false};
const goalLevel=(round)=>round>=26?10:round>=22?9:round>=17?8:round>=9?6:3;
const bankFloor=(round)=>round>=24?0:round>=18?10:round>=9?20:round>=4?10:0;
export const CAMPAIGN_POLICIES=Object.freeze(['tempo','reroll','rush']);
export const ECON_PACT_POLICY='econ-pact';
export const ADAPTIVE_STANDARD_POLICY='adaptive-standard';
export const CARRY_ADAPTIVE_POLICY='carry-adaptive';
const isEconomyCampaignPolicy=policy=>policy===ECON_PACT_POLICY||policy===ADAPTIVE_STANDARD_POLICY||policy===CARRY_ADAPTIVE_POLICY;
export function policyLevelTarget(policy,round){
  if(policy==='tempo')return round>=24?9:round>=18?8:round>=13?7:round>=9?6:round>=5?5:round>=3?4:3;
  if(policy==='reroll')return round>=24?9:round>=18?8:round>=13?7:round>=9?6:round>=6?5:round>=3?4:3;
  if(policy==='rush')return round>=18?9:round>=9?6:3;
  if(policy===ECON_PACT_POLICY)return round>=18?9:round>=15?8:round>=13?7:round>=9?6:round>=6?5:round>=3?4:3;
  return goalLevel(round);
}
export function econPactPlan(round,level){
  const bankTarget=round<5?0:round<9?10:round<13?30:round<18?50:round<24?(level<9?40:30):0;
  const xpReserve=round>=24?0:round>=18&&level<9?40:round>=13?30:bankTarget;
  return {levelTarget:policyLevelTarget(ECON_PACT_POLICY,round),bankTarget,xpReserve,refreshEnabled:level>=9};
}
export function adaptiveStandardPlan(round,level,hp){
  const base=econPactPlan(round,level),lowHp=hp<70,critical=hp<40;
  const bankTarget=critical?0:lowHp?Math.min(base.bankTarget,10):base.bankTarget;
  const xpReserve=critical?0:lowHp?Math.min(base.xpReserve,10):base.xpReserve;
  const lowHpRefresh=lowHp&&level>=5;
  const refreshEnabled=base.refreshEnabled||lowHpRefresh;
  const refreshLimit=critical&&level>=5?5:lowHpRefresh?3:base.refreshEnabled?(round>=24?5:3):0;
  const refreshReserve=lowHpRefresh?bankTarget:level<9?40:round>=24?0:30;
  return {levelTarget:base.levelTarget,bankTarget,xpReserve,refreshEnabled,refreshLimit,refreshReserve,initialBuyLimit:lowHp?4:null,lowHp,critical,xpGateRule:'legal-unique-roster-over-current-level-or-level8-to9-when-hp-at-least-40'};
}
export function adaptiveStandardAllowsXp({level,hp,legalUniqueOwned}){
  if(level===8)return hp>=40;
  return legalUniqueOwned>level;
}
export function seasonCampaignFieldableCapacity(state,catalog,field){
  const unique=hasActiveStrategyEffect(state,catalog,'unique_nation_core'),seen=new Set(),matched=new Map();
  const units=state.pieces.filter(piece=>{const op=opById(catalog,piece.operatorId);if(!op)return false;if(unique&&seen.has(op.charId))return false;seen.add(op.charId);return true;});
  const cells=piece=>[...field.deployMap.keys()].filter(key=>{const [r,c]=key.split(',').map(Number),op=opById(catalog,piece.operatorId);return canOperatorUseTile(op,field.deployMap,r,c)&&(op.role!=='frontline'||canBlockGround(field,r,c));});
  const visit=(piece,visited)=>{for(const key of cells(piece)){if(visited.has(key))continue;visited.add(key);if(!matched.has(key)||visit(matched.get(key),visited)){matched.set(key,piece);return true;}}return false;};
  for(const piece of units)visit(piece,new Set());return Math.min(10,matched.size);
}
export function seasonCampaignXpDecision(state,catalog,field){
  const capacity=seasonCampaignFieldableCapacity(state,catalog,field),late=state.round>=24;
  return {capacity,allowed:state.level<capacity,target:Math.min(capacity,late?10:adaptiveStandardPlan(state.round,state.level,state.hp).levelTarget),reserve:late?0:Math.max(30,adaptiveStandardPlan(state.round,state.level,state.hp).xpReserve),purchaseLimit:late?Math.floor(state.gold/4):4};
}
export function estimateOperatorPower(operator,star=1){
  const stats=operator?.stars?.[star]?.stats??{};
  const atk=Math.max(0,Number(stats.atk)||0),bat=Math.max(.2,Number(stats.bat)||1),aspd=Number(stats.aspd)||100;
  const dps=atk*(100+aspd)/100/bat;
  const hp=Math.max(0,Number(stats.maxHp)||0),def=Math.max(0,Number(stats.def)||0),block=Math.max(0,Number(stats.blockCnt)||0);
  const role=operator?.role;
  return dps+(hp+def*2+block*220)*.018+(role==='healer'?dps*.2:0)+(role==='frontline'?block*32:0);
}
const canAttackAir=(op)=>op?.stars?.[1]?.record?.canHitFly===true&&['damage','control'].includes(op?.role);
function campaignRoleTargets(state,catalog,field=activeBattleFields(state,catalog)){
  const blockerPlan=blockerCoveragePlan(field),groundRoutes=groundRouteEntries(field).length;
  const capacity=Math.min(state.level,field.deployMap?.size??state.level);
  const frontlines=Math.min(blockerPlan.tiles.length,groundRoutes,Math.max(1,capacity-3));
  const antiAir=Math.min(2,Math.max(1,capacity-frontlines-1));
  const combatOutput=Math.max(antiAir,capacity-frontlines-1);
  return {frontlines,healers:1,antiAir,combatOutput,capacity,unblockableGroundRoutes:blockerPlan.uncovered.length};
}
function roleCountsForPieces(pieces,catalog){
  const ops=pieces.map(piece=>opById(catalog,piece.operatorId)).filter(Boolean);
  return {frontline:ops.filter(op=>op.role==='frontline').length,healer:ops.filter(op=>op.role==='healer').length,antiAir:ops.filter(canAttackAir).length,combatOutput:ops.filter(op=>op.role==='damage'||op.role==='control').length};
}
export function campaignRolePlan(state,catalog,field){
  const target=campaignRoleTargets(state,catalog,field),count=roleCountsForPieces(state.pieces,catalog);
  return {targets:target,owned:count,missing:{frontline:Math.max(0,target.frontlines-count.frontline),healer:Math.max(0,target.healers-count.healer),antiAir:Math.max(0,target.antiAir-count.antiAir),combatOutput:Math.max(0,target.combatOutput-count.combatOutput)}};
}
function eligibleRosterCapacity(state,catalog,field){
  if(isEconomyCampaignPolicy(activePolicy.id)){
    const chars=new Set();
    for(const piece of state.pieces){const op=opById(catalog,piece.operatorId);if(op&&legalCandidateCell(op,field,new Set()))chars.add(op.charId);}
    return Math.min(chars.size,field.deployMap?.size??chars.size,10);
  }
  const targets=campaignRoleTargets(state,catalog,field),counts=roleCountsForPieces(state.pieces,catalog);
  return Math.max(0,state.pieces.length-Math.max(0,counts.frontline-targets.frontlines)-Math.max(0,counts.healer-2));
}
function benchSaleReason(piece,state,catalog){
  if(piece.star!==1)return null;
  if(piece.operatorId===activePolicy.coreOperatorId)return null;
  const same=state.pieces.filter(other=>other.operatorId===piece.operatorId);
  if(same.length>1)return null;
  const op=opById(catalog,piece.operatorId);if(!op)return null;
  const counts=roleCountsForPieces(state.pieces,catalog),targets=campaignRoleTargets(state,catalog);
  let reason=null;
  if(op.role==='frontline')reason=counts.frontline>targets.frontlines?'excess-frontline-over-route-need':null;
  else if(op.role==='healer')reason=counts.healer>targets.healers?'excess-healer-over-lineup-need':null;
  else if(canAttackAir(op)&&counts.antiAir>targets.antiAir)reason='excess-native-anti-air-over-lineup-need';
  else if(['damage','control'].includes(op.role))reason=counts.combatOutput>targets.combatOutput?'excess-combat-output-over-lineup-need':null;
  else {const roleCount=state.pieces.filter(other=>opById(catalog,other.operatorId)?.role===op.role).length;reason=roleCount>1?`excess-${op.role}-reserve`:null;}
  if(!reason)return null;
  const current=pactLineup(state),after=pactLineup({...state,pieces:state.pieces.filter(entry=>entry.uid!==piece.uid)}),beforeTiers=activePactTiers(current,catalog),afterTiers=activePactTiers(after,catalog);
  if([...beforeTiers].some(([id,tier])=>(afterTiers.get(id)??0)<tier))return null;
  return reason;
}
function hasActiveStrategyEffect(state,catalog,kind){
  const entries=Object.entries(state.strategyState??{}).filter(([,entry])=>entry&&typeof entry==='object'&&!entry.fallbackApplied);
  if(state.strategyState&&Object.keys(state.strategyState).length)return entries.some(([id])=>catalog.strategies?.[id]?.effects?.some(effect=>effect.kind===kind));
  return (state.strategies??[]).some(strategy=>catalog.strategies?.[typeof strategy==='string'?strategy:strategy.id]?.effects?.some(effect=>effect.kind===kind));
}
function legacyBenchSaleAllowed(piece,state,catalog){
  if(piece.star!==1||piece.operatorId===activePolicy.coreOperatorId)return false;
  const role=opById(catalog,piece.operatorId)?.role,total=state.pieces.filter(entry=>opById(catalog,entry.operatorId)?.role===role).length,need=campaignRoleTargets(state,catalog).frontlines;
  return (role!=='healer'||total>1)&&(role!=='frontline'||total>need);
}
function logSellReview(state,catalog,chosen,context){
  if(!activeMetrics||activePolicy.id==='legacy')return;
  const blockerNeed=campaignRoleTargets(state,catalog).frontlines;
  activeMetrics.sellDecisions.push({round:state.round,context,chosen:chosen?.uid??null,pieces:state.pieces.filter(p=>p.row===null).map(piece=>{
    const role=opById(catalog,piece.operatorId)?.role,total=state.pieces.filter(x=>opById(catalog,x.operatorId)?.role===role).length;
    const reason=piece.star>1?'protect-merged-star':piece.operatorId===activePolicy.coreOperatorId?'protect-designated-core':state.pieces.filter(x=>x.operatorId===piece.operatorId).length>1?'protect-synthesis-branch':benchSaleReason(piece,state,catalog)??(role==='healer'&&total<=1?'retain-required-healer':role==='frontline'&&total<=blockerNeed?'retain-required-route-blocker':piece.uid===chosen?.uid?'not-a-surplus-role':'retain-role-capacity');
    return {uid:piece.uid,operatorId:piece.operatorId,role,star:piece.star,reason};})});
}
const opById=(catalog,id)=>catalog.operators[id];
const hasPact=(op,id)=>op?.pacts?.includes(id);
const pieceCount=(state,id)=>state.pieces.filter(p=>p.operatorId===id).length;
const activeBattleFields=(state,catalog)=>getResonanceField(state,{data,catalog});

function cacheKey(env,seed){return `${env}:${seed>>>0}`;}
function getCatalog(env,seed){const key=cacheKey(env,seed);if(!catalogCache.has(key))catalogCache.set(key,getResonanceCatalog(data,{environmentId:env,seed}));return catalogCache.get(key);}
export function getSeasonCampaignCatalog(seed) {
  const key=`season:${seed>>>0}`;
  if(!catalogCache.has(key))catalogCache.set(key,getResonanceCatalog(data,{rulesVersion:2,seed}));
  return catalogCache.get(key);
}
export function getPrototypeCampaignCatalog(seed) {
  const key=`prototype:${seed>>>0}`;
  if(!catalogCache.has(key))catalogCache.set(key,getResonanceCatalog(data,{rulesVersion:3,seed}));
  return catalogCache.get(key);
}
export function selectSeasonCampaignSeeds({openings=Object.keys(resonanceOpenings),seedStart=0,searchLimit=10000}={}) {
  if(!Array.isArray(openings)||!openings.length||new Set(openings).size!==openings.length||openings.some(id=>!Object.hasOwn(resonanceOpenings,id)))throw new Error('unknown-or-duplicate-opening');
  if(!Number.isSafeInteger(seedStart)||seedStart<0||seedStart>0xffffffff||!Number.isSafeInteger(searchLimit)||searchLimit<1||searchLimit>100000)throw new Error('bad-opening-seed-search');
  const found=new Map();
  for(let offset=0;offset<searchLimit&&seedStart+offset<=0xffffffff&&found.size<openings.length;offset++){
    const seed=seedStart+offset,id=selectResonanceOpening(seed);
    if(openings.includes(id)&&!found.has(id))found.set(id,seed);
  }
  if(found.size!==openings.length)throw new Error('opening-seed-search-exhausted');
  return openings.map(openingId=>({openingId,seed:found.get(openingId)}));
}
export function catalogForBalanceProfile(sourceCatalog,profile='formal',difficulty='NORMAL'){
  if(!['formal','looser','refined-standard','accessible-standard'].includes(profile))throw new Error(`unknown-enemy-balance-profile:${profile}`);
  if(profile==='formal'||difficulty!=='NORMAL')return sourceCatalog;
  const catalog=structuredClone(sourceCatalog);
  catalog.campaign.enemyBalance.byDifficulty.NORMAL=profile==='looser'?{
    regular:{hpMultiplier:.65,atkMultiplier:.85,defMultiplier:.35},
    terminal:{hpMultiplier:.75,atkMultiplier:.85,defMultiplier:.35,bossPoolMultiplier:.6},
  }:profile==='accessible-standard'?{
    regular:{hpMultiplier:.65,atkMultiplier:.85,defMultiplier:.35},
    terminal:{hpMultiplier:.75,atkMultiplier:.85,defMultiplier:.35,bossPoolMultiplier:.5},
  }:{
    regular:{hpMultiplier:.75,atkMultiplier:.90,defMultiplier:.45},
    terminal:{hpMultiplier:.80,atkMultiplier:.90,defMultiplier:.45,bossPoolMultiplier:.65},
  };
  return catalog;
}
function seedFor(env,difficulty,salt=0){let h=2166136261;for(const c of `${env}:${difficulty}:${salt}`)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h||1;}
function assertInvariants(state,catalog){
  const result=validateSession(state,{catalog});
  if(!result.ok)throw new Error(`session-invariant:${JSON.stringify(result.errors.slice(0,5))}`);
  if(!Number.isInteger(state.gold)||state.gold<0||!Number.isInteger(state.hp)||state.hp<0)throw new Error('economy-invariant');
  const ids=[...state.inventory,...state.pieces.flatMap(piece=>piece.equipment)].map(item=>item.uid);
  if(new Set(ids).size!==ids.length)throw new Error('equipment-uid-conservation');
  const expected=poolLedgers.get(catalog);
  if(expected){
    for(const id of catalog.config.activeOperatorIds){
      const physical=Number(state.poolRemaining[id]??0)
        +state.pieces.filter(piece=>piece.operatorId===id).reduce((sum,piece)=>sum+3**(piece.star-1),0)
        +state.shop.offers.filter(offer=>offer.operatorId===id).length;
      if(physical!==expected.get(id))throw new Error(`pool-conservation:${id}:${physical}:${expected.get(id)}`);
    }
  }
  if(activeMetrics)activeMetrics.invariantChecks=(activeMetrics.invariantChecks??0)+1;
}
function runAction(state,action,catalog){
  activeProgress?.({round:state.round,phase:state.phase,hp:state.hp,gold:state.gold,level:state.level,action:action.type});
  if(activeMetrics){activeMetrics.actions[action.type]=(activeMetrics.actions[action.type]??0)+1;if(action.type==='refresh')activeMetrics.refreshes[state.round]=(activeMetrics.refreshes[state.round]??0)+1;
    activeMetrics.nodeEconomy??={};const node=activeMetrics.nodeEconomy[state.round]??(activeMetrics.nodeEconomy[state.round]={round:state.round,actions:{},goldStart:state.gold});node.actions[action.type]=(node.actions[action.type]??0)+1;node.goldStart??=state.gold;
    if(action.type==='buy'){const offer=state.shop.offers.find(entry=>entry.uid===action.offerUid),id=offer?.operatorId;if(id){activeMetrics.operatorBuys[id]=(activeMetrics.operatorBuys[id]??0)+1;if(id===activePolicy.coreOperatorId){activeMetrics.corePurchases++;activeMetrics.coreOfferPurchases.push({round:state.round,offerUid:offer.uid,operatorId:id,cost:offer.cost});const prior=activeMetrics.coreOfferDecisions.findLast(entry=>entry.round===state.round&&entry.offerUid===offer.uid);if(prior)prior.outcome='bought';}}}
  }
  const result=applyAction(state,{...action,expectedRevision:state.revision},{catalog,
    fieldResolver:(current)=>activeBattleFields(current,catalog),
    battleRunner:(battleState,opts)=>runResonanceBattle(battleState,{...opts,data,catalog,recording:false}),
    recording:false});
  if(!result.ok)throw new Error(`action:${action.type}:${result.error}`);
  if(activeMetrics&&['buy','buyXp','refresh','sell','equip','combine','chooseStrategy','claimReward','deploy','move','bench','fight','advanceSupply'].includes(action.type)){
    activeMetrics.ledger??=[];
    activeMetrics.ledger.push({round:state.round,phase:state.phase,action:action.type,goldBefore:state.gold,goldAfter:result.state.gold,
      details:(result.events??[]).map((event)=>structuredClone(event))});
  }
  if(activeMetrics)for(const event of result.events??[])if(event.type==='operator-merged'){
    activeMetrics.starMilestones??=[];activeMetrics.starMilestones.push({round:state.round,operatorId:event.operatorId,star:event.star});
  }
  const node=activeMetrics?.nodeEconomy?.[state.round];if(node){node.goldEnd=result.state.gold;node.goldDelta=(node.goldDelta??0)+(result.state.gold-state.gold);for(const event of result.events??[]){if(event.type==='fight-settled'){node.settlement={income:event.income,winBonus:event.winBonus,streakBonus:event.streakBonus,interest:event.interest,delayedBonus:event.delayedBonus,strategyGold:event.strategyGold,battleGold:event.battleGold,goldBefore:event.goldBefore,goldAfter:event.goldAfter};}else if(event.type==='operator-bought')node.buyGold=(node.buyGold??0)+Number(event.cost||0);else if(event.type==='operator-sold')node.sellRefund=(node.sellRefund??0)+Number(event.refund||0)+Number(event.bonus||0);else if(event.type==='xp-purchased')node.xpGold=(node.xpGold??0)+Number(event.gold||0);else if(event.type==='shop-refreshed')node.refreshGold=(node.refreshGold??0)+Number(event.cost||0);}}
  assertInvariants(result.state,catalog);
  return result;
}

function chooseStrategy(state,catalog,choice){
  const candidateIds=choice.options;
  const deployed=state.pieces.filter(piece=>piece.row!==null);
  const hasAdjacent=deployed.some((a,i)=>deployed.slice(i+1).some(b=>Math.abs(a.row-b.row)+Math.abs(a.col-b.col)===1));
  const scored=candidateIds.map(id=>{
    const strategy=catalog.strategies[id], effect=strategy?.effects?.[0], kind=effect?.kind;
    let score=0;
    if(['gold','xp','choose_components','choose_pool_operators','sell_bonus'].includes(kind))score=1;
    if(kind==='interest_cap')score=state.round<18?8:4;
    if(kind==='xp_discount')score=state.round<24?7:2;
    if(kind==='refresh_discount')score=state.round<20?6:2;
    if(kind==='pact_set_reward')score=state.round<16?5:2;
    if(kind==='target_copy')score=state.round<20?4:3;
    if(kind==='delayed_operator')score=state.round<20?4:2;
    if(kind==='delayed_income')score=state.round<17?3:1;
    const eligibleBattle=activePolicy.id!=='legacy';
    if(kind==='crossfire'&&deployed.filter(p=>catalog.operators[p.operatorId]?.position==='MELEE').length>=2&&deployed.filter(p=>catalog.operators[p.operatorId]?.position==='RANGED').length>=2)score=eligibleBattle?10:5;
    if(kind==='pair_guard'&&hasAdjacent)score=eligibleBattle?10:5;
    if(kind==='firstConstructRebuild'&&deployed.some(p=>(catalog.operators[p.operatorId]?.role==='summoner'||catalog.operators[p.operatorId]?.pacts?.includes('creation'))))score=eligibleBattle?9:4;
    if(kind==='lastAmmo'&&deployed.some(p=>catalog.operators[p.operatorId]?.pacts?.includes('ammo')))score=eligibleBattle?9:4;
    if(kind==='firstFreezeSplash'&&deployed.some(p=>catalog.operators[p.operatorId]?.role==='control'))score=eligibleBattle?9:4;
    if(kind==='executeBonus'||kind==='victory_tradeoff')score=state.round>14?(eligibleBattle?9:3):1;
    if(kind==='risk_exchange')score=state.hp>45&&state.gold<20?4:0;
    if(kind==='late_game')score=state.round<=1&&state.gold>=8?3:0;
    if(strategy?.group==='risk'&&kind!=='risk_exchange')score-=1;
    return {id,score};
  }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const chosen=scored[0]?.id;
  if(!chosen)throw new Error('empty-strategy-choice');
  const chosenEffect=catalog.strategies[chosen]?.effects?.[0]?.kind;
  let targets={};
  if(chosenEffect==='pair_guard'){
    const pair=deployed.flatMap((a,i)=>deployed.slice(i+1).filter(b=>Math.abs(a.row-b.row)+Math.abs(a.col-b.col)===1).map(b=>[a.uid,b.uid]))[0];
    if(pair)targets={pieceUids:pair};
  }
  return runAction(state,{type:'chooseStrategy',choiceUid:choice.uid,strategyId:chosen,targets},catalog).state;
}

function itemUtility(item,operator){
  const role=operator?.role??'damage';let value=0;
  for(const effect of item?.effects??[]){const p=effect.params??{};
    if(effect.kind==='component_stat')value+=Number(p.atk??0)*(role==='damage'?0.08:0.035)+Number(p.aspd??0)*(role==='damage'?0.07:0.025)+Number(p.def??0)*(role==='frontline'?0.04:0.01)+Number(p.hp??0)*(role==='frontline'||role==='healer'?0.018:0.006)+Number(p.res??0)*0.015+Number(p.sp??0)*5+Number(p.initialSp??0)*0.2;
    else if(['transfer_pact','pact_transfer'].includes(effect.kind))continue;
    else value+=3;
  }
  return value;
}
export function carryOperatorPowerFactor(operator,star,catalog){
  if(!operator||!catalog?.operators)return 1;
  const key=`${operator.role??'damage'}:${star}`;
  let baselines=carryPowerBaselines.get(catalog);
  if(!baselines){baselines=new Map();carryPowerBaselines.set(catalog,baselines);}
  let baseline=baselines.get(key);
  if(!baseline){
    const values=Object.values(catalog.operators).filter(candidate=>candidate.role===(operator.role??'damage'))
      .map(candidate=>estimateOperatorPower(candidate,1)).filter(value=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b);
    baseline=values.length?values[Math.floor(values.length/2)]:estimateOperatorPower(operator,star)||1;
    baselines.set(key,baseline);
  }
  const power=estimateOperatorPower(operator,star);
  return Math.max(.5,Math.min(2.5,(power>0?power:baseline)/baseline));
}
function equipmentTransferBonus(item,piece,state,catalog){
  const op=opById(catalog,piece.operatorId);if(!op)return 0;
  let bonus=0;for(const effect of item?.effects??[]){if(!['transfer_pact','pact_transfer'].includes(effect.kind))continue;const id=effect.params?.pactId;if(!id||piecePactIds(piece,catalog).has(id))continue;
    const members=new Set(state.pieces.filter(other=>other.row!==null&&piecePactIds(other,catalog).has(id)).map(other=>opById(catalog,other.operatorId)?.charId).filter(Boolean));
    if(!members.has(op.charId)){const thresholds=catalog.pacts?.[id]?.thresholds??[];bonus+=id===catalog.environments?.[state.environmentId]?.identityPactId?100:Math.max(5,thresholds.length*3);}
  }
  return bonus;
}
function equipmentOwnerUtility(item,piece,state,catalog){
  return itemUtility(item,opById(catalog,piece.operatorId))+equipmentTransferBonus(item,piece,state,catalog);
}
function carryEquipmentOwnerUtility(item,piece,state,catalog){
  const op=opById(catalog,piece.operatorId);
  return (state.rulesVersion===2?carryItemScore(item,op,piece.star):itemUtility(item,op))*carryOperatorPowerFactor(op,piece.star??1,catalog)+equipmentTransferBonus(item,piece,state,catalog);
}
function policyEquipmentOwnerUtility(item,piece,state,catalog){
  return activePolicy.id===CARRY_ADAPTIVE_POLICY?carryEquipmentOwnerUtility(item,piece,state,catalog):equipmentOwnerUtility(item,piece,state,catalog);
}
export function campaignCombatProfile(operator,star=1){
  const cached=operator&&campaignCombatProfiles.get(operator);if(cached?.has(star))return cached.get(star);
  const record=operator?.stars?.[star]?.record??{},skill=record.skills?.find(s=>s.index===operator.fixedSkillIndex)??record.skill??{},bb=skill.bb??{};
  const def=normalizeChess({...record,skill}),kit=setupUnitKit({opts:{},data:nativeDataSource},{kind:'op',def},'independent');
  const type=bb['attack@damage_type']??bb.damage_type??bb.dmg_type;
  const damageType=type===2||type==='arts'?'arts':type===1||type==='phys'?'phys':record.dmgType;
  const profile={role:operator?.role,damageType,skill,ammo:kit.skill?.kind==='ammo',melee:operator?.position==='MELEE',healer:record.dmgType==='heal'||operator?.role==='healer'};
  if(operator){const profiles=cached??new Map();profiles.set(star,profile);campaignCombatProfiles.set(operator,profiles);}return profile;
}
export function carryItemScore(item,operator,star=1,legacy=false){
  const profile=campaignCombatProfile(operator,star);
  // Backline output cannot use healing or being-hit triggers as a normal carry item.
  if(!legacy&&!profile.melee&&!profile.healer&&(item?.effects??[]).some(e=>['periodic_heal','hit_sp','counter_magic','thorns','block_stack'].includes(e.kind)))return 0;
  const role=operator?.role??'damage',attacker=role==='damage'||role==='control';let value=0;
  for(const effect of item?.effects??[]){const p=effect.params??{};
    if(effect.kind==='component_stat')value+=Number(p.atk??0)*(attacker ? .08 : .035)+Number(p.aspd??0)*(attacker ? .07 : .025)+Number(p.def??0)*(role==='frontline' ? .05 : .01)+Number(p.hp??0)*(role==='frontline' ? .025 : role==='healer'||role==='support' ? .018 : .006)+Number(p.res??0)*.015+Number(p.sp??0)*5+Number(p.initialSp??0)*.2;
    else if(['transfer_pact','pact_transfer'].includes(effect.kind))continue;
    else if(legacy)value+=3;
    else if(effect.kind==='cast_stack')value+=profile.damageType==='arts'||profile.healer?7:.3;
    else if(['armor_pierce','fifth_strike'].includes(effect.kind))value+=profile.damageType==='phys'?8:1;
    else if(['resistance_shred','spell_vulnerability'].includes(effect.kind))value+=profile.damageType==='arts'?8:1;
    else if(['attack_stack','splash_strike','chain_lightning','giant_slayer'].includes(effect.kind))value+=attacker?8:1;
    else if(effect.kind==='periodic_heal')value+=profile.healer?10:profile.melee?5:0;
    else if(['hit_sp','counter_magic','thorns','block_stack','hit_stack','regeneration','death_barrier'].includes(effect.kind))value+=profile.melee?7:1;
    else if(['attack_sp','cast_sp','skill_sp','skill_damage','first_cast_haste','cast_stun'].includes(effect.kind))value+=profile.ammo?0:profile.skill.spCost?5:0;
    else value+=1;
  }
  return value;
}
export function claimOptions(choice,state,catalog){
  const count=Math.min(choice.remaining,choice.options.length);
  const score=(item,op)=>state.rulesVersion===2?carryItemScore(item,op):itemUtility(item,op);
  if(choice.type==='pair'){
    const placed=state.pieces.filter(p=>p.row!==null);
    const pair=placed.flatMap((a,i)=>placed.slice(i+1).filter(b=>Math.abs(a.row-b.row)+Math.abs(a.col-b.col)===1).map(b=>[a.uid,b.uid]))[0];
    if(pair)return pair;
    return choice.options.slice(0,2);
  }
  if(choice.type==='dual_pact')return [ [...choice.options].sort((a,b)=>{
    const pa=state.pieces.find(p=>p.uid===a),pb=state.pieces.find(p=>p.uid===b);
    return (pb?.star??1)-(pa?.star??1)||(opById(catalog,pb?.operatorId)?.cost??0)-(opById(catalog,pa?.operatorId)?.cost??0)||a.localeCompare(b);
  })[0] ];
  if(choice.type==='pact_tag'){
    const piece=state.pieces.find(p=>p.uid===choice.pieceUid),op=piece&&opById(catalog,piece.operatorId);
    const preferred=op?.pacts?.[1];return [choice.options.includes(preferred)?preferred:[...choice.options].sort()[0]];
  }
  if(choice.type==='components'){
    const target=state.pieces.filter(p=>p.row!==null).sort((a,b)=>Number(opById(catalog,b.operatorId)?.role==='frontline')-Number(opById(catalog,a.operatorId)?.role==='frontline'))[0];
    return [...choice.options].sort((a,b)=>score(catalog.equipment[b],opById(catalog,target?.operatorId))-score(catalog.equipment[a],opById(catalog,target?.operatorId))||a.localeCompare(b)).slice(0,count);
  }
  if(choice.type==='transfer')return [...choice.options].sort((a,b)=>Number(b.includes('aegir')||b.includes('arts')||b.includes('breaker'))-Number(a.includes('aegir')||a.includes('arts')||a.includes('breaker'))||a.localeCompare(b)).slice(0,count);
  if(choice.type==='operators')return [...choice.options].sort((a,b)=>buyScore(b,state,catalog)-buyScore(a,state,catalog)||a.localeCompare(b)).slice(0,count);
  if(choice.type==='target_piece')return [...choice.options].sort((a,b)=>buyScore(state.pieces.find(p=>p.uid===b)?.operatorId,state,catalog)-buyScore(state.pieces.find(p=>p.uid===a)?.operatorId,state,catalog)||a.localeCompare(b)).slice(0,count);
  if(choice.type==='target_operator')return [...choice.options].sort((a,b)=>buyScore(b,state,catalog)-buyScore(a,state,catalog)||a.localeCompare(b)).slice(0,count);
  if(choice.type==='disassemble')return [choice.options[0]];
  if(choice.type==='prototype_economy'){
    const details=choice.metadata?.optionDetails??[];
    const options=details.filter(entry=>choice.options.includes(entry.id)).map(entry=>{
      const cost=entry.cost??{},amount=Number(cost.amount??0);
      const affordable=entry.action==='skip'||entry.action==='skip-armory'||entry.action==='skip-market'
        ||cost.currency==='gold'&&state.gold>=amount
        ||cost.currency==='shimmer'&&Number(state.prototypeMeta?.economy?.chemBaron?.shimmer??0)>=amount
        ||!cost.currency;
      const value=(entry.grant??[]).reduce((sum,grant)=>sum+(grant.kind==='operator'?Number(grant.targetCost??1)*3
        :grant.kind==='item'?itemUtility(catalog.equipment?.[grant.id],null)
        :grant.kind==='component'?1:grant.kind==='rumble_upgrade'?4:0),0);
      return {id:entry.id,affordable,value};
    }).filter(entry=>entry.affordable).sort((a,b)=>b.value-a.value||a.id.localeCompare(b.id));
    return options.length?[options[0].id]:[];
  }
  if(choice.type==='recipe'){
    const pieces=state.pieces.filter(p=>p.row!==null),target=pieces.slice().sort((a,b)=>candidatePower(b,catalog)-candidatePower(a,catalog))[0],operator=target&&opById(catalog,target.operatorId);
    const recipes=(catalog.recipes??[]).filter(recipe=>choice.options.includes(recipe.resultId));
    const best=recipes.map(recipe=>({id:recipe.resultId,score:score(catalog.equipment[recipe.resultId],operator)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))[0];
    return best?[best.id]:[choice.options[0]];
  }
  if(choice.type==='identity_transfer'){
    const envPact=catalog.environments?.[state.environmentId]?.identityPactId;
    const scores=choice.options.map(id=>{const count=new Set(state.pieces.filter(p=>p.row!==null&&opById(catalog,p.operatorId)?.pacts?.includes(id)).map(p=>opById(catalog,p.operatorId).charId)).size;const thresholds=catalog.pacts?.[id]?.thresholds??[];return {id,score:(id===envPact?4:0)+Math.max(0,...thresholds.filter(t=>t>count).map(t=>count+1===t?5:0))};}).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
    return scores[0]?[scores[0].id]:[choice.options[0]];
  }
  throw new Error(`unsupported-choice:${choice.type}`);
}

function resolveChoices(initial,catalog){
  let state=initial,guard=0;
  while(state.pendingChoices?.length){if(++guard>120)throw new Error('choice-loop-guard');
    const choice=state.pendingChoices[0];
    if(choice.type==='strategy'){state=chooseStrategy(state,catalog,choice);continue;}
    const ids=claimOptions(choice,state,catalog);
    if(!ids.length)throw new Error(`empty-choice-options:${choice.type}`);
    const economyOperators=choice.type==='prototype_economy'?(choice.metadata?.optionDetails??[]).filter(entry=>ids.includes(entry.id)).flatMap(entry=>entry.grant??[]).filter(grant=>grant.kind==='operator').length:0;
    if(choice.type==='operators'||economyOperators){
      const reduced=hasActiveStrategyEffect(state,catalog,'bench_capacity_and_gold');
      const capacity=reduced?7:9;
      const pieceCount=choice.type==='operators'?ids.length:economyOperators;
      if(state.pieces.filter(p=>p.row===null).length+pieceCount>capacity)state=deployTeam(state,catalog);
      while(state.pieces.filter(p=>p.row===null).length+pieceCount>capacity){
        const candidate=state.pieces.filter(p=>p.row===null&&state.inventory.length+p.equipment.length<=20&&(activePolicy.id==='legacy'?legacyBenchSaleAllowed(p,state,catalog):benchSaleReason(p,state,catalog)))
          .sort((a,b)=>buyScore(a.operatorId,state,catalog)-buyScore(b.operatorId,state,catalog)||a.uid.localeCompare(b.uid))[0];
        if(!candidate)throw new Error(`policy-cannot-make-bench-space:${state.pieces.filter(p=>p.row===null).length}:${pieceCount}`);
        logSellReview(state,catalog,candidate,'claim-capacity');
        state=runAction(state,{type:'sell',pieceUid:candidate.uid},catalog).state;
      }
    }
    const needed=choice.type==='components'||choice.type==='transfer'?ids.length:0;
    while(needed&&state.inventory.length+needed>20){
      const item=state.inventory[0];if(!item)throw new Error('reward-capacity-unresolvable');
      state=runAction(state,{type:'recycleEquipment',itemUid:item.uid},catalog).state;
    }
    state=runAction(state,{type:'claimReward',choiceUid:choice.uid,optionIds:ids},catalog).state;
  }
  return state;
}

function buyScore(id,state,catalog){
  const op=opById(catalog,id);if(!op)return -100;
  const owned=state.pieces.filter(p=>p.operatorId===id), ownChars=state.pieces.filter(p=>catalog.operators[p.operatorId]?.charId===op.charId);
  const ownedOps=state.pieces.map(p=>opById(catalog,p.operatorId));
  if(activePolicy.id!=='legacy'){
    const plan=campaignRolePlan(state,catalog),missing=plan.missing;
    const duplicate=owned.find(piece=>piece.star<3);
    const coreTwoStar=id===activePolicy.coreOperatorId&&owned.some(piece=>piece.star===2);
    const frontlineBranches=new Set(ownedOps.filter(other=>other?.role==='frontline').map(other=>other.charId)).size;
    if(op.role==='frontline'&&frontlineBranches>=2&&!duplicate)return -100;
    if(op.role==='frontline'&&!missing.frontline)return -100;
    const air=canAttackAir(op);
    const roleValue=(op.role==='healer'&&missing.healer?18:0)
      +(op.role==='frontline'&&missing.frontline?16:0)
      +(air&&missing.antiAir?17:0)
      +(['damage','control'].includes(op.role)&&missing.combatOutput?14:0);
    const power=estimateOperatorPower(op,1);
    const deployed=state.pieces.filter(p=>p.row!==null).map(p=>estimateOperatorPower(opById(catalog,p.operatorId),p.star));
    const weakest=deployed.length?Math.min(...deployed):0;
    const marginal=Math.max(0,power-weakest*.65);
    const mergeValue=duplicate?Math.max(0,estimateOperatorPower(op,Math.min(3,duplicate.star+1))-estimateOperatorPower(op,duplicate.star))*.18:0;
    const envPact=catalog.environments?.[state.environmentId]?.identityPactId;
    const pactValue=(op.pacts??[]).includes(envPact)?1.2:0;
    const coreValue=id===activePolicy.coreOperatorId?(coreTwoStar?22:activePolicy.id==='reroll'&&duplicate?10:2):0;
    const rushValue=activePolicy.id==='rush'&&op.cost>=4?1:0;
    return roleValue+Math.max(0,marginal)/Math.max(100,(op.cost??1)*130)+mergeValue/300+pactValue+coreValue+rushValue;
  }
  let score=1.6+op.cost*0.72+(op.cost>=4?3.5:0);
  if(owned.length)score+=5+owned.reduce((n,p)=>n+(p.star===1?2:0),0);
  if(ownChars.length)score+=2;
  if(op.pacts?.[0]===catalog.environments[catalog.config.environmentId]?.identityPactId)score+=2;
  if(op.role==='frontline'&&ownedOps.filter(x=>x.role==='frontline').length<2)score+=6;
  if(op.role==='healer'&&!ownedOps.some(x=>x.role==='healer'))score+=14;
  if(op.position==='RANGED'&&!ownedOps.some(x=>x.position==='RANGED'))score+=2;
  const samePactCount=ownedOps.filter(x=>x.pacts?.some(p=>op.pacts?.includes(p))).length;
  score+=Math.min(3,samePactCount)*0.35;
  if(op.role==='damage'&&!ownedOps.some(x=>x.role==='damage'))score+=1.5;
  return score;
}
function piecePactIds(piece,catalog){
  const op=opById(catalog,piece.operatorId),ids=new Set([...(op?.pacts??[]),...(piece.extraPacts??[])]);
  for(const item of piece.equipment??[])for(const effect of catalog.equipment?.[item.itemId]?.effects??[])if(['transfer_pact','pact_transfer'].includes(effect.kind)&&effect.params?.pactId)ids.add(effect.params.pactId);
  return ids;
}
function pactTierIndex(pact,count){
  const levels=pact?.levels??[];
  if(levels.length){
    const exact=levels.map((level,index)=>({level,index})).filter(({level})=>Array.isArray(level.exactCounts)&&level.exactCounts.length)
      .filter(({level})=>level.exactCounts.includes(count));
    if(exact.length)return exact.at(-1).index;
    const active=levels.map((level,index)=>({level,index})).filter(({level})=>{
      const min=Number(level.minUnits??level.threshold??Infinity),max=Number(level.maxUnits??Number.MAX_SAFE_INTEGER);
      return count>=min&&count<=max&&!(Array.isArray(level.exactCounts)&&level.exactCounts.length);
    });
    if(active.length)return active.at(-1).index;
    if(levels.some(level=>Array.isArray(level.exactCounts)&&level.exactCounts.length))return -1;
  }
  const thresholds=pact?.thresholds??levels.map(level=>level.threshold).filter(Number.isFinite);
  return thresholds.reduce((tier,value)=>count>=value?tier+1:tier,-1);
}
function activePactTiers(pieces,catalog){
  const members=new Map();for(const piece of pieces){const op=opById(catalog,piece.operatorId);if(!op)continue;for(const id of piecePactIds(piece,catalog)){const ids=members.get(id)??new Set();ids.add(op.charId);members.set(id,ids);}}
  return new Map([...members].map(([id,ids])=>[id,pactTierIndex(catalog.pacts?.[id],ids.size)+1]));
}
function pactMemberCounts(pieces,catalog){
  const members=new Map();for(const piece of pieces){const op=opById(catalog,piece.operatorId);if(!op)continue;for(const id of piecePactIds(piece,catalog)){const ids=members.get(id)??new Set();ids.add(op.charId);members.set(id,ids);}}
  return new Map([...members].map(([id,ids])=>[id,ids.size]));
}
function primaryPactId(state,pieces,catalog){
  const identity=catalog.environments?.[state.environmentId]?.identityPactId;if(identity&&catalog.pacts?.[identity])return identity;
  const counts=pactMemberCounts(pieces,catalog);
  return [...counts].map(([id,count])=>({id,count,tier:pactTierIndex(catalog.pacts?.[id],count)+1,next:(catalog.pacts?.[id]?.levels??[]).map(level=>Number(level.minUnits??level.threshold)).find(value=>value>count)??Infinity}))
    .sort((a,b)=>b.tier-a.tier||(a.next-a.count)-(b.next-b.count)||b.count-a.count||a.id.localeCompare(b.id))[0]?.id??null;
}
function pactLineup(state){const placed=state.pieces.filter(piece=>piece.row!==null);return placed.length?placed:state.pieces;}
function legalCandidateCell(operator,field,occupied,route=null){
  return [...(field.deployMap??new Map())].some(([key])=>{if(occupied.has(key))return false;const [row,col]=key.split(',').map(Number);if(!canOperatorUseTile(operator,field.deployMap,row,col))return false;
    if(operator.role==='frontline'&&(!canBlockGround(field,row,col)||route&&routeDistance(row,col,route)!==0))return false;return true;});
}
function roleNeedForOffer(operator,state,catalog,field){
  const target=campaignRoleTargets(state,catalog,field),counts=roleCountsForPieces(state.pieces,catalog),op=operator;
  if(op.role==='frontline'&&counts.frontline<target.frontlines)return 'missing-route-blocker';
  if(op.role==='healer'&&counts.healer<target.healers)return 'missing-healer';
  if(canAttackAir(op)&&counts.antiAir<target.antiAir)return 'missing-native-anti-air';
  if(['damage','control'].includes(op.role)&&counts.combatOutput<target.combatOutput)return 'missing-combat-output';
  return null;
}
function mergeProgress(state,id,coreId){
  const pieces=state.pieces.filter(piece=>piece.operatorId===id),star1=pieces.filter(piece=>piece.star===1).length,star2=pieces.filter(piece=>piece.star===2).length;
  if(id!==coreId&&star2>=1)return {ready:false,reason:'auxiliary-already-2-star'};
  if(star1>=2)return {ready:true,reason:'next-copy-completes-2-star-merge'};
  if(id===coreId&&star2>=2)return {ready:true,reason:'next-copy-completes-3-star-merge'};
  if(id!==coreId&&star1===1)return {ready:true,reason:'advance-auxiliary-branch-to-2-copies'};
  if(id===coreId){
    if(!pieces.length)return {ready:true,reason:'acquire-reroll-core'};
    if(star2===1)return {ready:true,reason:'advance-core-toward-3-star'};
    if(star1===1)return {ready:true,reason:'advance-core-toward-2-star'};
  }
  return {ready:false,reason:'no-near-term-merge'};
}
function branchCount(state,coreId){
  const grouped=new Map();for(const piece of state.pieces){const list=grouped.get(piece.operatorId)??[];list.push(piece);grouped.set(piece.operatorId,list);}
  return [...grouped].filter(([id,pieces])=>id!==coreId&&!pieces.some(piece=>piece.star>1)&&pieces.filter(piece=>piece.star===1).length>=2).length;
}
function lineupDoesNotWorsen(pieces,beforePieces,state,catalog,field){
  const before=campaignRolePlan({...state,pieces:beforePieces},catalog,field).missing,after=campaignRolePlan({...state,pieces},catalog,field).missing;
  return Object.keys(before).every(role=>(after[role]??0)<=(before[role]??0));
}
function replacementFor(operator,state,catalog,field,roleNeeded,coreOperatorId=activePolicy.coreOperatorId){
  const deployed=state.pieces.filter(piece=>piece.row!==null),capacity=Math.min(state.level,field.deployMap?.size??state.level);
  if(deployed.length<capacity){const occupied=new Set(deployed.map(piece=>`${piece.row},${piece.col}`)),route=operator.role==='frontline'?groundRouteEntries(field)[0]?.route:null;if(legalCandidateCell(operator,field,occupied,route))return {freeSlot:true,replace:null};}
  const candidates=deployed.filter(piece=>piece.operatorId!==coreOperatorId&&(!roleNeeded?opById(catalog,piece.operatorId)?.role===operator.role:true))
    .sort((a,b)=>estimateOperatorPower(opById(catalog,a.operatorId),a.star)-estimateOperatorPower(opById(catalog,b.operatorId),b.star)||a.uid.localeCompare(b.uid));
  for(const piece of candidates){
    const old=opById(catalog,piece.operatorId);if(!old)continue;
    const target=campaignRoleTargets(state,catalog,field),counts=roleCountsForPieces(deployed,catalog),oldCounts=roleCountsForPieces([piece],catalog),newCounts=roleCountsForPieces([{...piece,operatorId:operator.id}],catalog);
    if(!roleNeeded&&estimateOperatorPower(operator,1)<estimateOperatorPower(old,piece.star)*1.25)continue;
    const simulated=deployed.filter(entry=>entry.uid!==piece.uid).concat([{...piece,operatorId:operator.id,extraPacts:[],equipment:[]}]);
    const after=roleCountsForPieces(simulated,catalog);
    if(after.frontline<Math.min(target.frontlines,counts.frontline)||after.healer<Math.min(target.healers,counts.healer)||after.antiAir<Math.min(target.antiAir,counts.antiAir)||after.combatOutput<Math.min(target.combatOutput,counts.combatOutput))continue;
    const main=primaryPactId(state,pactLineup(state),catalog),beforeTiers=activePactTiers(pactLineup(state),catalog),afterTiers=activePactTiers(pactLineup({...state,pieces:simulated}),catalog);
    if(main&&(afterTiers.get(main)??0)<(beforeTiers.get(main)??0))continue;
    const occupied=new Set(deployed.filter(entry=>entry.uid!==piece.uid).map(entry=>`${entry.row},${entry.col}`));
    const route=old.role==='frontline'?groundRouteEntries(field).find(x=>routeDistance(piece.row,piece.col,x.route)===0)?.route:null;
    if(!legalCandidateCell(operator,field,occupied,operator.role==='frontline'?route:null))continue;
    return {freeSlot:false,replace:piece,reason:roleNeeded??'same-role-net-upgrade-25'};
  }
  return null;
}
export function evaluateCampaignOffer(operatorId,state,catalog,field,coreOperatorId=null,policy=activePolicy.id){
  const operator=opById(catalog,operatorId);if(!operator)return {ok:false,reason:'unknown-operator',priority:0};
  const legalCell=legalCandidateCell(operator,field,new Set());if(!legalCell)return {ok:false,reason:'no-legal-deployment-tile',priority:0};
  const owned=state.pieces.filter(piece=>piece.operatorId===operatorId);
  const designatedCore=operatorId===coreOperatorId;
  if(designatedCore&&owned.some(piece=>piece.star>=3))return {ok:false,reason:'designated-core-already-3-star',priority:0};
  // Tempo/rush may hold one explicit five-cost identity core as an investment
  // branch. It still passes legal-tile, gold, bench-capacity and native action
  // checks in chooseOffer/runAction; this only exempts the first copy from
  // generic role/frontline-branch and 25% immediate-board-value gates.
  if(designatedCoreInvestment(operatorId,operator,owned,coreOperatorId)){
    return {ok:true,reason:'designated-core-investment',priority:4,netGain:0,heldOnBench:true};
  }
  if(econPactIdentityInvestment(operator,state,catalog,policy)){
    return {ok:true,reason:'build-next-main-pact-tier',priority:3,netGain:estimateOperatorPower(operator,1),heldOnBench:true};
  }
  if(operatorId!==coreOperatorId&&owned.some(piece=>piece.star>=2))return {ok:false,reason:'auxiliary-already-2-star',priority:0};
  const roleNeed=roleNeedForOffer(operator,state,catalog,field);
  const roleCounts=roleCountsForPieces(state.pieces,catalog),targets=campaignRoleTargets(state,catalog,field);
  const roleFits=roleNeed&&((operator.role==='frontline'&&roleCounts.frontline<targets.frontlines)||(operator.role==='healer'&&roleCounts.healer<targets.healers)||(canAttackAir(operator)&&roleCounts.antiAir<targets.antiAir)||(['damage','control'].includes(operator.role)&&roleCounts.combatOutput<targets.combatOutput));
  if(roleFits){const slot=replacementFor(operator,state,catalog,field,roleNeed,coreOperatorId);if(slot)return {ok:true,reason:roleNeed,priority:5,netGain:estimateOperatorPower(operator,1)-(slot.replace?estimateOperatorPower(opById(catalog,slot.replace.operatorId),slot.replace.star):0),replaceUid:slot.replace?.uid??null};}
  const merge=mergeProgress(state,operatorId,coreOperatorId);
  if(merge.ready&&owned.length){
    const auxiliary=operatorId!==coreOperatorId&&owned.length===1&&branchCount(state,coreOperatorId)>=2&&!econPactIdentityInvestment(operator,state,catalog);
    if(!auxiliary){const targetStar=merge.reason.includes('3-star')?3:2;return {ok:true,reason:merge.reason,priority:operatorId===coreOperatorId?4:3,netGain:estimateOperatorPower(operator,targetStar)-estimateOperatorPower(operator,Math.max(1,Math.min(2,owned[0]?.star??1)))};}
  } else if(merge.ready&&!owned.length&&operatorId===coreOperatorId){
    const slot=replacementFor(operator,state,catalog,field,roleNeed,coreOperatorId);if(slot?.freeSlot)return {ok:true,reason:merge.reason,priority:4,netGain:estimateOperatorPower(operator,1)};
  }
  const auxiliary=operatorId!==coreOperatorId&&owned.length===1&&branchCount(state,coreOperatorId)>=2&&!econPactIdentityInvestment(operator,state,catalog);
  if(auxiliary)return {ok:false,reason:'auxiliary-merge-branch-cap-2',priority:0};
  const deployed=state.pieces.filter(piece=>piece.row!==null),pactBase=pactLineup(state),capacity=Math.min(state.level,field.deployMap?.size??state.level);
  const freeSlot=deployed.length<capacity;
  const occupied=new Set(deployed.map(piece=>`${piece.row},${piece.col}`)),route=operator.role==='frontline'?groundRouteEntries(field)[0]?.route:null,addSlot=freeSlot&&legalCandidateCell(operator,field,occupied,route);
  const candidates=addSlot?[null]:deployed.filter(piece=>piece.operatorId!==coreOperatorId&&opById(catalog,piece.operatorId)?.role===operator.role)
    .sort((a,b)=>estimateOperatorPower(opById(catalog,a.operatorId),a.star)-estimateOperatorPower(opById(catalog,b.operatorId),b.star)||a.uid.localeCompare(b.uid));
  for(const piece of candidates){
    const simulated=piece?deployed.filter(entry=>entry.uid!==piece.uid).concat([{...piece,operatorId:operator.id,extraPacts:[],equipment:[]}]):pactBase.concat([{uid:`offer:${operatorId}`,operatorId,row:null,col:null,extraPacts:[],equipment:[]}]);
    if(!lineupDoesNotWorsen(simulated,pactBase,state,catalog,field))continue;
    const main=primaryPactId(state,pactBase,catalog),before=activePactTiers(pactBase,catalog),after=activePactTiers(simulated,catalog);
    if(main&&(after.get(main)??0)<(before.get(main)??0))continue;
    const beforeCount=pactMemberCounts(pactBase,catalog).get(main)??0,afterCount=pactMemberCounts(simulated,catalog).get(main)??0;
    const thresholds=catalog.pacts?.[main]?.thresholds??catalog.pacts?.[main]?.levels?.map(x=>x.threshold)??[],nextThreshold=thresholds.find(value=>value>beforeCount);
    if(nextThreshold&&beforeCount<nextThreshold&&afterCount>beforeCount&&(operator.pacts??[]).includes(main))return {ok:true,reason:afterCount>=nextThreshold?'cross-next-main-pact-threshold':'build-next-main-pact-tier',priority:2,netGain:estimateOperatorPower(operator,1)-(piece?estimateOperatorPower(opById(catalog,piece.operatorId),piece.star):0),replaceUid:piece?.uid??null};
    if(piece&&estimateOperatorPower(operator,1)<estimateOperatorPower(opById(catalog,piece.operatorId),piece.star)*1.25)continue;
  }
  if(!freeSlot){const upgrade=replacementFor(operator,state,catalog,field,null,coreOperatorId);if(upgrade)return {ok:true,reason:'same-role-net-upgrade-25',priority:1,netGain:upgrade.replace?estimateOperatorPower(operator,1)-estimateOperatorPower(opById(catalog,upgrade.replace.operatorId),upgrade.replace.star):0,replaceUid:upgrade.replace?.uid??null};}
  const sameRole=deployed.some(piece=>opById(catalog,piece.operatorId)?.role===operator.role);
  return {ok:false,reason:sameRole?'no-25-percent-net-improvement-or-pact-loss':'no-role-merge-or-pact-upgrade',priority:0};
}
export function designatedCoreInvestment(operatorId,operator,owned,coreOperatorId){
  // Only tempo/rush select a cost-4+ designated core; reroll's selector is
  // deliberately restricted to cost 2-3. The explicit core id is therefore
  // the policy boundary, independent of caller context.
  return operatorId===coreOperatorId&&!owned.length&&operator?.cost>=5;
}
export function econPactIdentityInvestment(operator,state,catalog,policy=activePolicy.id){
  if(!isEconomyCampaignPolicy(policy))return false;
  const pactId=catalog.environments?.[state.environmentId]?.identityPactId;
  if(!pactId||!(operator?.pacts??[]).includes(pactId))return false;
  const alreadyOwnedChars=new Set(state.pieces.map(piece=>opById(catalog,piece.operatorId)?.charId).filter(Boolean));
  if(!operator.charId||alreadyOwnedChars.has(operator.charId))return false;
  const count=pactMemberCounts(state.pieces,catalog).get(pactId)??0;
  const thresholds=catalog.pacts?.[pactId]?.thresholds??catalog.pacts?.[pactId]?.levels?.map(level=>level.threshold)??[];
  return thresholds.some(value=>value>count);
}
export function exceedsFrontlineBranchCap(operatorId,operator,state,catalog,duplicate,coreOperatorId,policy=activePolicy.id){
  if(designatedCoreInvestment(operatorId,operator,state.pieces.filter(piece=>piece.operatorId===operatorId),coreOperatorId))return false;
  if(econPactIdentityInvestment(operator,state,catalog,policy))return false;
  return operator?.role==='frontline'&&new Set(state.pieces.map(piece=>opById(catalog,piece.operatorId)).filter(entry=>entry?.role==='frontline').map(entry=>entry.charId)).size>=2&&!duplicate;
}
function rejectCoreOffer(candidate,state,reason,context='purchase'){
  if(!candidate||candidate.offer.operatorId!==activePolicy.coreOperatorId)return;
  const prior=activeMetrics?.coreOfferDecisions.findLast(entry=>entry.round===state.round&&entry.offerUid===candidate.offer.uid);
  if(prior){prior.outcome='rejected';prior.rejectionReason=reason;}
  else activeMetrics?.coreOfferDecisions.push({round:state.round,context,offerUid:candidate.offer.uid,operatorId:candidate.offer.operatorId,cost:candidate.offer.cost,gold:state.gold,eligible:true,selected:true,outcome:'rejected',rejectionReason:reason});
}
export function chooseOffer(state,catalog,{context='purchase',isActionable=null}={}){
  const reduced=hasActiveStrategyEffect(state,catalog,'bench_capacity_and_gold');
  const capacity=reduced?7:9,bench=state.pieces.filter(p=>p.row===null).length,benchCanRelease=state.pieces.some(piece=>piece.row===null&&benchSaleReason(piece,state,catalog));
  const reviewed=state.shop.offers.filter(o=>o.operatorId)
    .map(o=>{const op=opById(catalog,o.operatorId),duplicate=state.pieces.some(p=>p.operatorId===o.operatorId&&p.star<3);let reason='incremental-combat-value';
      const benchCanMerge=state.pieces.filter(p=>p.operatorId===o.operatorId&&p.star===1).length>=2;
      let policy=activePolicy.id==='legacy'?{ok:buyScore(o.operatorId,state,catalog)>=2.25,reason:'legacy-score'}:evaluateCampaignOffer(o.operatorId,state,catalog,activeBattleFields(state,catalog),activePolicy.coreOperatorId);
      if(isEconomyCampaignPolicy(activePolicy.id)&&o.operatorId===activePolicy.coreOperatorId&&!campaignCorePurchaseAvailable(state,op))policy={ok:false,reason:'core-held-until-level-9',priority:0,netGain:0};
      const score=activePolicy.id==='legacy'?buyScore(o.operatorId,state,catalog):Number(policy.netGain??0);
      reason=policy.reason;
      const hardReason=o.cost>state.gold?'insufficient-gold':bench>=capacity&&!benchCanMerge&&!(activePolicy.id!=='legacy'&&benchCanRelease)?'bench-capacity-protect-2-star-and-role-core':exceedsFrontlineBranchCap(o.operatorId,op,state,catalog,duplicate,activePolicy.coreOperatorId)?'frontline-branch-cap-2':isActionable&&!isActionable(o,op,policy)?'not-actionable-with-current-reserve-or-capacity':null;
      if(hardReason)reason=hardReason;
      return {offer:o,score,reason,priority:policy.priority??0,eligible:policy.ok&&!hardReason&&(activePolicy.id!=='legacy'||score>=2.25)};})
    .sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.priority-a.priority||b.score-a.score||a.offer.uid.localeCompare(b.offer.uid));
  const chosen=reviewed.find(item=>item.eligible)??null;
  if(activeMetrics&&activePolicy.coreOperatorId){for(const entry of reviewed.filter(item=>item.offer.operatorId===activePolicy.coreOperatorId)){
    const selected=entry===chosen,rejectionReason=!entry.eligible?entry.reason:!selected?'eligible-but-another-offer-ranked-higher':null;
    const prior=activeMetrics.coreOfferDecisions.find(item=>item.round===state.round&&item.offerUid===entry.offer.uid);
    if(prior){prior.evaluations++;if(!prior.contexts.includes(context))prior.contexts.push(context);prior.eligible=entry.eligible;prior.selected=selected;prior.reason=entry.reason;if(rejectionReason){prior.outcome='rejected';prior.rejectionReason=rejectionReason;}else{prior.outcome='pending';delete prior.rejectionReason;}}
    else{activeMetrics.coreOfferDecisions.push({round:state.round,context,contexts:[context],evaluations:1,offerUid:entry.offer.uid,operatorId:entry.offer.operatorId,cost:entry.offer.cost,gold:state.gold,eligible:entry.eligible,selected,outcome:entry.eligible&&selected?'pending':'rejected',reason:entry.reason,...(rejectionReason?{rejectionReason}:{})});activeMetrics.coreOffersSeen++;}
  }}
  if(activeMetrics&&activePolicy.id!=='legacy')activeMetrics.roleDecisions.push({round:state.round,offers:reviewed.map(({offer,score,reason,eligible})=>({operatorId:offer.operatorId,name:opById(catalog,offer.operatorId)?.name,role:opById(catalog,offer.operatorId)?.role,score:Number(score.toFixed(2)),eligible,reason})),chosen:chosen?.offer.operatorId??null});
  return chosen;
}
function purchaseBenchCandidate(state,catalog,operatorId){
  const reduced=hasActiveStrategyEffect(state,catalog,'bench_capacity_and_gold');
  const capacity=reduced?7:9;if(state.pieces.filter(piece=>piece.row===null).length<capacity)return null;
  const candidates=state.pieces.filter(piece=>piece.row===null&&benchSaleReason(piece,state,catalog)).sort((a,b)=>candidatePower(a,catalog)-candidatePower(b,catalog)||a.uid.localeCompare(b.uid));
  return candidates.find(piece=>evaluateCampaignOffer(operatorId,{...state,pieces:state.pieces.filter(entry=>entry.uid!==piece.uid)},catalog,activeBattleFields(state,catalog),activePolicy.coreOperatorId).ok)??null;
}
function makePurchaseBenchSpace(state,catalog,operatorId){
  const reduced=hasActiveStrategyEffect(state,catalog,'bench_capacity_and_gold'),capacity=reduced?7:9;
  if(state.pieces.filter(piece=>piece.row===null).length<capacity)return state;
  const weak=purchaseBenchCandidate(state,catalog,operatorId);if(!weak)return null;
  logSellReview(state,catalog,weak,'qualified-offer-bench-space');return runAction(state,{type:'sell',pieceUid:weak.uid},catalog).state;
}

export function copyTargetsForCampaign(state,catalog,coreOperatorId=null,capacityOverride=null){
  const reduced=hasActiveStrategyEffect(state,catalog,'bench_capacity_and_gold');
  const capacity=capacityOverride??(reduced?7:9),bench=state.pieces.filter(piece=>piece.row===null).length;
  const coreMaxed=coreOperatorId&&state.pieces.some(piece=>piece.operatorId===coreOperatorId&&piece.star>=3);
  const targets=state.pieces.filter(piece=>{
    if(piece.operatorId===coreOperatorId&&coreMaxed)return false;
    const cost=catalog.operators[piece.operatorId]?.cost??99;
    const eligibleStar=piece.star===1||piece.operatorId===coreOperatorId&&piece.star===2;
    const eligibleCost=cost<=3||piece.operatorId===coreOperatorId;
    return eligibleStar&&eligibleCost&&(state.poolRemaining[piece.operatorId]??0)>0&&
      (bench<capacity||state.pieces.filter(other=>other.operatorId===piece.operatorId&&other.star===1).length>=2);
  }).sort((a,b)=>{
    const score=piece=>piece.operatorId===coreOperatorId?1000+(piece.star===2?100:0):piecePactIds(piece,catalog).has(catalog.environments?.[state.environmentId]?.identityPactId)?200:state.pieces.filter(other=>other.operatorId===piece.operatorId&&other.star===1).length>=2?150:0;
    return score(b)-score(a)||candidatePower(b,catalog)-candidatePower(a,catalog)||a.uid.localeCompare(b.uid);
  });
  return targets;
}

export function chooseRerollCore(catalog,state){
  const identity=catalog.environments?.[catalog.config.environmentId]?.identityPactId;
  const dpsOf=op=>{const stats=op?.stars?.[1]?.stats??{},bat=Math.max(.2,Number(stats.bat)||1),aspd=Number(stats.aspd)||0;return Math.max(0,Number(stats.atk)||0)*(100+aspd)/100/bat;};
  const eligible=Object.values(catalog.operators??{}).filter(op=>op&&op.cost>=2&&op.cost<=3&&canAttackAir(op)).map(op=>dpsOf(op)).sort((a,b)=>b-a);
  const cutoff=eligible.length?eligible[Math.floor((eligible.length-1)*.25)]*.85:Infinity;
  const offered=new Map((state?.shop?.offers??[]).filter(offer=>offer.operatorId&&offer.cost>=2&&offer.cost<=3).map(offer=>[offer.operatorId,offer]));
  return [...offered.keys()].map(id=>opById(catalog,id)).filter(op=>op&&canAttackAir(op)&&dpsOf(op)>=cutoff)
    .map(op=>{const dps=dpsOf(op);return {op,score:dps+(op.pacts?.includes(identity)?Math.min(24,dps*.05):0)+(op.role==='damage'?12:0)};})
    .sort((a,b)=>b.score-a.score||a.op.id.localeCompare(b.op.id))[0]?.op?.id??null;
}
function chooseEnvironmentCore(catalog){
  const pactId=catalog.environments?.[catalog.config?.environmentId]?.identityPactId;
  return Object.values(catalog.operators??{}).filter(op=>op?.pacts?.includes(pactId)&&['damage','control','frontline','summoner'].includes(op.role))
    .sort((a,b)=>(b.cost??0)-(a.cost??0)||estimateOperatorPower(b,3)-estimateOperatorPower(a,3)||a.id.localeCompare(b.id))[0]?.id??null;
}

export function campaignCorePurchaseAvailable(state,operator){
  return state.level>=9 || state.rulesVersion===2 && Number(operator?.cost)<5;
}

/** A season has no environment leader: choose an actual held output branch and retain it. */
export function selectSeasonCampaignCore(state,catalog,previousId=null){
  const active=new Set(catalog.config?.activeOperatorIds??[]);
  const held=state.pieces.filter(piece=>{
    const operator=opById(catalog,piece.operatorId);
    return active.has(piece.operatorId)&&operator&&[3,4].includes(Number(operator.cost))&&['damage','control'].includes(operator.role)
      &&!String(operator.charId??'').includes('4119_wanqin');
  });
  if(previousId&&held.some(piece=>piece.operatorId===previousId))return previousId;
  const copies=id=>held.filter(piece=>piece.operatorId===id).reduce((sum,piece)=>sum+3**(piece.star-1),0);
  const fit=piece=>{
    const operator=opById(catalog,piece.operatorId);
    const items=[...(piece.equipment??[]),...(state.inventory??[])];
    return items.reduce((sum,item)=>sum+carryItemScore(catalog.equipment?.[item.itemId],operator),0)*carryOperatorPowerFactor(operator,piece.star,catalog);
  };
  return held.sort((a,b)=>b.star-a.star||copies(b.operatorId)-copies(a.operatorId)||fit(b)-fit(a)
    ||estimateOperatorPower(opById(catalog,b.operatorId),b.star)-estimateOperatorPower(opById(catalog,a.operatorId),a.star)||a.uid.localeCompare(b.uid))[0]?.operatorId??null;
}

export function directionToward(row,col,target){
  const dr=target[0]-row,dc=target[1]-col;
  if(Math.abs(dc)>=Math.abs(dr))return dc<0?'LEFT':'RIGHT';
  return dr<0?'UP':'DOWN';
}
export function canOperatorUseTile(operator,deployMap,row,col){
  const placementClass=operator?.canDeployHighGround?'ranged':operator?.position==='MELEE'?'melee':'ranged';
  return canPlace(deployMap,placementClass,row,col);
}
export function canBlockGround(field,row,col){
  const [sr,sc]=fieldTile(field.field,row,col),glyph=field.stage?.rows?.[sr]?.[sc],tile=field.stage?.tiles?.[glyph];
  return !!tile&&tile.groundPassable!==false&&tile.height==='LOW'&&(tile.buildable==='ALL'||tile.buildable==='MELEE');
}

export function canFillFallbackRole(role,roleCounts,{frontlineLimit=2,healerLimit=2}={}){
  if(role==='frontline')return (roleCounts.frontline??0)<frontlineLimit;
  if(role==='healer')return (roleCounts.healer??0)<healerLimit;
  return true;
}
export function routeProfiles(field){
  const unique=new Map();
  const sourceRoutes=[...(field.wave?.routes??[]),...(field.wave?.extraRoutes??[])];
  const activeRouteIndices=new Set((field.wave?.spawns??[]).map(spawn=>spawn.routeIndex).filter(Number.isInteger));
  const grid=field.stage?new Grid(field.stage,String(field.field??'normal').startsWith('boss')?GEO.BOSS_RECT:GEO.NORMAL_RECT):null;
  const checkpointPoint=checkpoint=>Array.isArray(checkpoint)?checkpoint:Array.isArray(checkpoint?.pos)?checkpoint.pos:Array.isArray(checkpoint?.p)?checkpoint.p:null;
  for(const [originalIndex,route] of sourceRoutes.entries()){
    if(activeRouteIndices.size&&!activeRouteIndices.has(originalIndex))continue;
    const checkpoints=(route.checkpoints??[]).map(checkpointPoint).filter(Boolean),stepPoints=(route.steps??[]).filter(step=>['move','patrol','appear'].includes(String(step.t??'').toLowerCase())).map(checkpointPoint).filter(Boolean);
    const anchors=[route.start,...(checkpoints.length?checkpoints:stepPoints),route.end].filter(p=>Array.isArray(p)&&p.length===2);
    if(anchors.length<2)continue;let points=[],source='wave-route-waypoints';
    if(route.motion==='WALK'){
      const key=`${anchors[0].join(',')}->${anchors.at(-1).join(',')}`;
      const path=checkpoints.length===0&&stepPoints.length===0?(field.stage?.groundPathsWithDevices?.[key]??field.stage?.groundPaths?.[key]??[]):[];
      if(path.length){points=path;source=field.stage?.groundPathsWithDevices?.[key]?'groundPathsWithDevices':'groundPaths';}
      else if(grid){const legs=[];for(let i=1;i<anchors.length;i++){const leg=grid.findPath(anchors[i-1][0],anchors[i-1][1],anchors[i][0],anchors[i][1])??grid.findPath(anchors[i-1][0],anchors[i-1][1],anchors[i][0],anchors[i][1],{ignoreObstacles:true});if(!leg?.length){legs.length=0;break;}legs.push(...(i===1?leg:leg.slice(1)));}if(legs.length){points=legs;source='native-grid-route';}else points=[...new Map(anchors.map(p=>[p.join(','),p])).values()];}
      else points=[...new Map(anchors.map(p=>[p.join(','),p])).values()];
    } else points=[...new Map(anchors.map(p=>[p.join(','),p])).values()];
    if(field.field==='bossL'||field.field==='bossR')points=points.map(([r,c])=>[r+7,field.field==='bossR'?19-c:c]);
    const signature=JSON.stringify([route.motion??'WALK',points]);
    if(points.length>1){const profile=unique.get(signature)??{motion:route.motion??'WALK',points,source,originalIndices:[]};profile.originalIndices.push(originalIndex);unique.set(signature,profile);}
  }
  if(!unique.size)for(const spawn of field.wave?.spawns??[]){const start=spawn.preview?.start;if(Array.isArray(start))unique.set(`fallback:${start.join(',')}`,{motion:'WALK',points:[start],source:'spawn-preview'});}
  return [...unique.values()];
}
function bossRouteIndices(field){return new Set((field.wave?.spawns??[]).filter(spawn=>['boss','leader'].includes(String(spawn.tag??'').toLowerCase())).map(spawn=>spawn.routeIndex).filter(Number.isInteger));}
function groundRouteEntries(field,profiles=routeProfiles(field)){
  const bosses=bossRouteIndices(field);return profiles.map((route,index)=>({route,index})).filter(entry=>entry.route.motion==='WALK'&&!entry.route.originalIndices?.some(index=>bosses.has(index)));
}
function blockerCoveragePlan(field){
  const routes=groundRouteEntries(field).map(entry=>entry.route),remaining=new Set(routes.map((_,index)=>index)),tiles=[];
  const legal=[...(field.deployMap??new Map())].filter(([key])=>{const [row,col]=key.split(',').map(Number);return canPlace(field.deployMap,'melee',row,col)&&canBlockGround(field,row,col);}).map(([key])=>key);
  while(remaining.size){let best=null;
    for(const key of legal){const [row,col]=key.split(',').map(Number),covers=[...remaining].filter(index=>routeDistance(row,col,routes[index])===0);if(covers.length&&(!best||covers.length>best.covers.length||covers.length===best.covers.length&&key<best.key))best={key,covers};}
    if(!best)break;tiles.push(best.key);for(const index of best.covers)remaining.delete(index);
  }
  return {tiles,uncovered:[...remaining]};
}
function routeTargets(field){return routeProfiles(field).map(route=>route.points[0]);}
function routeDistance(row,col,route){return Math.min(...route.points.map(([r,c])=>Math.abs(row-r)+Math.abs(col-c)));}
function operatorRouteCoverage(op,star,row,col,dir,routes){const record=op?.stars?.[star]?.record??{},grid=record.rangeGrid?.length?record.rangeGrid:op?.source?.normalChess?.rangeGrid??[[0,0]],keys=ownerRangeKeys(grid,row,col,dir);return routes.map((route,index)=>route.points.some(([r,c])=>keys.has(`${r},${c}`))?index:null).filter(index=>index!==null);}
export function campaignBossCoverage(piece,catalog,profiles,bossIndices){
  const covered=piece?operatorRouteCoverage(opById(catalog,piece.operatorId),piece.star,piece.row,piece.col,piece.dir,profiles):[];
  const indices=covered.flatMap(index=>profiles[index]?.originalIndices??[]).filter(index=>bossIndices.includes(index));
  return {deployed:Boolean(piece),coveredBossRouteIndices:[...new Set(indices)],coversBossRoute:indices.length>0};
}
function deploymentCell(state,catalog,field,operator,occupied,loadByRoute,reserved=new Set(),summon=null,opts={}){
  const display=viewSession(state,{catalog,fieldResolver:(s)=>getResonanceField(s,{data,catalog})});
  if(!display.ok||display.legalFieldStatus!=='resolved')throw new Error(`field-view:${display.error??display.legalFieldStatus}`);
  const legalSet=new Set(display.legalCells??[]), routes=routeProfiles(field),targets=routes.map(x=>x.points[0]),routeIndex=opts.routeIndex;
  const blockedFronts=opts.frontlines??[];
  const record=operator?.stars?.[opts.star??2]?.record??{};
  const range=record.rangeGrid?.length?record.rangeGrid:operator?.source?.normalChess?.rangeGrid??[[0,0]];
  const options=[...field.deployMap].filter(([key])=>legalSet.has(key)&&!occupied.has(key)&&!reserved.has(key)
    &&(()=>{const [r,c]=key.split(',').map(Number);return canOperatorUseTile(operator,field.deployMap,r,c)&&(operator.role!=='frontline'||canBlockGround(field,r,c));})())
    .map(([key,klass])=>{
      const [row,col]=key.split(',').map(Number);
      let best={score:999,target:targets[0]??[row,col],routeIndex:0};
      const candidateRoutes=routes.map((route,index)=>({route,index})).filter(x=>routeIndex==null||x.index===routeIndex);
      for(const {route,index} of candidateRoutes){
        const distance=routeDistance(row,col,route),pathIndex=route.points.reduce((bestIndex,p,i)=>Math.abs(row-p[0])+Math.abs(col-p[1])<Math.abs(row-route.points[bestIndex][0])+Math.abs(col-route.points[bestIndex][1])?i:bestIndex,0);
        const intercept=Math.max(0,route.points.length-3),target=route.points[Math.max(0,pathIndex-1)]??route.points[0];
        let dir=directionToward(row,col,target);
        if(state.rulesVersion===2){dir=['UP','RIGHT','DOWN','LEFT'].map(direction=>{const keys=ownerRangeKeys(range,row,col,direction);return {direction,hits:operator.role==='healer'?blockedFronts.filter(front=>keys.has(`${front.row},${front.col}`)).length:route.points.filter(([r,c])=>keys.has(`${r},${c}`)).length};}).sort((a,b)=>b.hits-a.hits||Number(b.direction===dir)-Number(a.direction===dir))[0].direction;}
        const coverage=new Set(ownerRangeKeys(range,row,col,dir));
        const covered=route.points.filter(([r,c])=>coverage.has(`${r},${c}`)).length;
        if(state.rulesVersion===2&&routeIndex!=null&&operator.role!=='healer'&&!covered)continue;
        let score;
        if(operator.role==='frontline'){const sharedBlockerCoverage=routes.filter(candidate=>candidate.motion==='WALK'&&routeDistance(row,col,candidate)===0).length;score=(distance>0?10000:0)+distance*100+Math.abs(pathIndex-intercept)*0.35+(loadByRoute[index]??0)*2-sharedBlockerCoverage*1000;}
        else if(operator.role==='healer')score=blockedFronts.filter(front=>coverage.has(`${front.row},${front.col}`)).length===blockedFronts.length?0:500+blockedFronts.filter(front=>coverage.has(`${front.row},${front.col}`)).length*-25;
        else score=-covered*15+distance*0.4+(loadByRoute[index]??0)*0.2;
        score+=(klass==='ranged'&&operator.position==='MELEE'?-0.1:0);
        if(score<best.score)best={score,target,routeIndex:index,dir};
      }
      if(state.rulesVersion===2&&routeIndex!=null&&best.score===999)return null;
      const dir=best.dir??directionToward(row,col,best.target);
      if(operator.role==='frontline'&&routes[best.routeIndex]&&routeDistance(row,col,routes[best.routeIndex])!==0)return null;
      if(operator.role==='healer'&&blockedFronts.length&&!blockedFronts.some(front=>ownerRangeKeys(range,row,col,dir).has(`${front.row},${front.col}`)))return null;
      if(summon?.length){const local=new Set();for(const tokenSpec of summon){const anchors=[...ownerRangeKeys(tokenSpec.rangeGrid,row,col,dir)].filter(anchor=>anchor!==key&&!occupied.has(anchor)&&!reserved.has(anchor)&&!local.has(anchor));const anchor=anchors.find(candidate=>{const [ar,ac]=candidate.split(',').map(Number);return canPlace(field.deployMap,positionClass(tokenSpec.token),ar,ac);});if(!anchor)return null;local.add(anchor);}}
      return {key,row,col,dir,score:best.score,routeIndex:best.routeIndex};
    }).filter(Boolean).sort((a,b)=>a.score-b.score||a.key.localeCompare(b.key));
  if(!options.length&&activeMetrics&&activePolicy.id!=='legacy')activeMetrics.placementDecisions.push({round:state.round,operatorId:operator?.id,role:operator?.role,position:operator?.position,legalCells:legalSet.size,deployCells:field.deployMap?.size??0,occupied:occupied.size,reserved:reserved.size,hasBlockableTile:operator?.role==='frontline'?[...field.deployMap].some(([key])=>{const [r,c]=key.split(',').map(Number);return canOperatorUseTile(operator,field.deployMap,r,c)&&canBlockGround(field,r,c);}):undefined,routeIndex});
  return options[0]??null;
}

function candidatePower(piece,catalog){
  const op=opById(catalog,piece.operatorId);if(!op)return -100;
  const stats=op.stars?.[piece.star]?.stats??{};
  const pactGain=(op.pacts??[]).reduce((n,id)=>n+(catalog.pacts[id]?.thresholds??[]).filter(t=>t<=1).length*0.45,0);
  if(activePolicy.id==='legacy')return piece.star*5+(op.cost??0)*1.35+Math.log1p(Number(stats.maxHp??stats.hp??0))*0.25+Math.log1p(Number(stats.atk??0))*0.3+(op.role==='frontline'?3.6:0)+(op.role==='healer'?1.6:0)+(op.role==='control'?1.1:0)+pactGain+(op.cost>=4?3.5:0)+(piece.operatorId===activePolicy.coreOperatorId?14:0);
  return piece.star*5+Math.log1p(Number(stats.atk??0))*1.15-Math.log1p(Number(stats.maxHp??stats.hp??0))*.08
    +(canAttackAir(op)?5:0)+(op.role==='frontline'?3.6:0)+(op.role==='healer'?1.6:0)+(op.role==='control'?2:0)+pactGain
    +(piece.operatorId===activePolicy.coreOperatorId?18:0);
}

function pactThresholdGain(selected,op,catalog){
  if(!op?.charId||selected.some(p=>opById(catalog,p.operatorId)?.charId===op.charId))return 0;
  let gain=0;for(const id of new Set(op.pacts??[])){const thresholds=catalog.pacts[id]?.thresholds??[];const count=new Set(selected.filter(p=>opById(catalog,p.operatorId)?.pacts?.includes(id)).map(p=>opById(catalog,p.operatorId)?.charId)).size;if(thresholds.some(t=>t>count&&t<=count+1))gain+=5;}
  return gain;
}

function summonAnchors(record,tokenSpecs,field,row,col,dir,occupied,reserved){
  const grid=Array.isArray(record?.rangeGrid)&&record.rangeGrid.length?record.rangeGrid:[];const local=new Set(),result=[];
  for(const spec of tokenSpecs){const candidates=[...ownerRangeKeys(grid,row,col,dir)].filter(key=>!occupied.has(key)&&!reserved.has(key)&&!local.has(key)).sort();const tile=candidates.find(key=>{const [r,c]=key.split(',').map(Number);return canPlace(field.deployMap,positionClass(spec.token),r,c);});if(!tile)return [];local.add(tile);result.push(tile);}
  return result;
}

function summonSpecs(piece,catalog){
  const op=opById(catalog,piece?.operatorId),record=op?.stars?.[piece?.star]?.record;if(!op||!record)return [];
  const ids=[...new Set((record.tokens??[]).map(token=>typeof token==='string'?token:token?.tokenId).filter(Boolean))];
  const skillIndex=Number.isInteger(op.fixedSkillIndex)?op.fixedSkillIndex:0,rangeGrid=Array.isArray(record.rangeGrid)&&record.rangeGrid.length?record.rangeGrid:op.source?.normalChess?.rangeGrid??[];
  return ids.filter(id=>!record.skill?.overrideTokenKey||id===record.skill.overrideTokenKey).map(tokenId=>({tokenId,token:data.tokens?.[tokenId],rangeGrid}))
    .filter(spec=>spec.token?.placeable===true&&(!Array.isArray(spec.token.owners)||!spec.token.owners.length||spec.token.owners.includes(piece.operatorId))&&nativeDataSource.getToken(spec.tokenId,piece.operatorId,{skillIndex,moduleId:'none'})?.sources?.includes('skill'));
}

function campaignDuplicatePlacementAllowed(piece,picked,state,catalog){
  const op=opById(catalog,piece.operatorId),same=picked.filter(p=>opById(catalog,p.operatorId)?.charId===op?.charId);
  if(state.rulesVersion===2)return !hasActiveStrategyEffect(state,catalog,'unique_nation_core')||!same.length;
  return !same.length||piece.star>Math.max(...same.map(p=>p.star));
}
function campaignDeployCapacity(state){
  const extra=state?.rulesVersion===3?Math.max(0,Math.min(2,Number(state.prototypeMeta?.economy?.rosterExtraCapacity)||0)):0;
  return Math.min(12,(Number(state?.level)||1)+extra);
}
export function deployCampaignTeamForVerification(state,catalog,{coreOperatorId=null}={}){
  const priorPolicy=activePolicy,priorMetrics=activeMetrics;activePolicy={id:CARRY_ADAPTIVE_POLICY,coreOperatorId};activeMetrics=null;
  try{return deployTeam(state,catalog);}finally{activePolicy=priorPolicy;activeMetrics=priorMetrics;}
}
function deployTeam(state,catalog){
  const deployCap=campaignDeployCapacity(state);
  const field=activeBattleFields(state,catalog);const legal=new Set(viewSession(state,{catalog,fieldResolver:(s)=>getResonanceField(s,{data,catalog})}).legalCells??[]);
  const occupied=new Set();
  const selected=[];
  const candidates=state.pieces.slice().sort((a,b)=>candidatePower(b,catalog)-candidatePower(a,catalog)||a.uid.localeCompare(b.uid));
  const picked=[];const profiles=routeProfiles(field),groundRoutes=groundRouteEntries(field,profiles);const targets=activePolicy.id==='legacy'?{frontlines:Math.min(2,groundRoutes.length,Math.max(1,deployCap-2)),antiAir:0}:campaignRoleTargets(state,catalog,field),routeSlots=isEconomyCampaignPolicy(activePolicy.id)?Math.min(2,targets.frontlines):targets.frontlines;
  const bossIndices=bossRouteIndices(field),bossRoute=profiles.find(route=>route.originalIndices?.some(index=>bossIndices.has(index))),bossProfileIndex=bossRoute?profiles.indexOf(bossRoute):null;
  const addBest=(predicate,limit)=>{while(picked.length<deployCap&&picked.filter(p=>predicate(opById(catalog,p.operatorId))).length<limit){
    const candidate=candidates.filter(p=>!picked.includes(p)&&predicate(opById(catalog,p.operatorId))).map(piece=>({piece,op:opById(catalog,piece.operatorId)}))
      .filter(({piece})=>campaignDuplicatePlacementAllowed(piece,picked,state,catalog))
      .sort((a,b)=>(candidatePower(b.piece,catalog)+pactThresholdGain(picked,b.op,catalog))-(candidatePower(a.piece,catalog)+pactThresholdGain(picked,a.op,catalog))||a.piece.uid.localeCompare(b.piece.uid))[0];
    if(!candidate)break;picked.push(candidate.piece);
  }};
  const hasBlockableTile=op=>[...field.deployMap].some(([key])=>{const [r,c]=key.split(',').map(Number);return canOperatorUseTile(op,field.deployMap,r,c)&&canBlockGround(field,r,c);});
  addBest(op=>op?.role==='frontline'&&hasBlockableTile(op),routeSlots);
  addBest(op=>op?.role==='healer',1);
  if(activePolicy.id!=='legacy')addBest(op=>canAttackAir(op),targets.antiAir);
  let pactTargetOperatorIds=new Set(),pactTargetLimit=0;
  const identityPactId=catalog.environments?.[state.environmentId]?.identityPactId;
  if(isEconomyCampaignPolicy(activePolicy.id)&&identityPactId){
    const identityCount=pactMemberCounts(picked,catalog).get(identityPactId)??0;
    const thresholds=catalog.pacts?.[identityPactId]?.thresholds??catalog.pacts?.[identityPactId]?.levels?.map(level=>level.threshold)??[];
    const nextThreshold=thresholds.find(value=>value>identityCount);
    const alreadyPickedChars=new Set(picked.map(piece=>opById(catalog,piece.operatorId)?.charId).filter(Boolean));
    const candidatesByIdentity=state.pieces.filter(piece=>!alreadyPickedChars.has(opById(catalog,piece.operatorId)?.charId)&&(opById(catalog,piece.operatorId)?.pacts??[]).includes(identityPactId))
      .sort((a,b)=>candidatePower(b,catalog)-candidatePower(a,catalog)||a.uid.localeCompare(b.uid));
    pactTargetLimit=nextThreshold?Math.min(nextThreshold-identityCount,candidatesByIdentity.length):0;
    pactTargetOperatorIds=new Set(candidatesByIdentity.slice(0,pactTargetLimit).map(piece=>piece.operatorId));
  }
  const mandatorySlots=routeSlots+1+targets.antiAir;
  const reservedIdentitySlots=isEconomyCampaignPolicy(activePolicy.id)?Math.min(pactTargetLimit,Math.max(0,deployCap-mandatorySlots-2)):0;
  const outputLimit=isEconomyCampaignPolicy(activePolicy.id)?Math.min(targets.combatOutput??2,Math.max(2,deployCap-mandatorySlots-reservedIdentitySlots)):targets.combatOutput??2;
  addBest(op=>(op?.role==='damage'||op?.role==='control')&&!(isEconomyCampaignPolicy(activePolicy.id)&&op.id===activePolicy.coreOperatorId&&outputLimit<=2),outputLimit);
  if(isEconomyCampaignPolicy(activePolicy.id)&&activePolicy.coreOperatorId)addBest(op=>op?.id===activePolicy.coreOperatorId,1);
  if(isEconomyCampaignPolicy(activePolicy.id)&&pactTargetOperatorIds.size)addBest(op=>pactTargetOperatorIds.has(op?.id),pactTargetLimit);
  addBest(op=>op&&op.role!=='healer'&&op.role!=='frontline',deployCap);
  if(picked.length<deployCap)for(const piece of candidates){if(picked.length>=deployCap)break;const op=opById(catalog,piece.operatorId);if(!op||op.role==='healer'||op.role==='frontline'&&picked.filter(p=>opById(catalog,p.operatorId)?.role==='frontline').length>=routeSlots)continue;if(campaignDuplicatePlacementAllowed(piece,picked,state,catalog))picked.push(piece);}
  const reduced=hasActiveStrategyEffect(state,catalog,'bench_capacity_and_gold');
  const capacity=reduced?7:9;
  const pickedUids=new Set(picked.map(piece=>piece.uid));
  const isPriorityTarget=piece=>isEconomyCampaignPolicy(activePolicy.id)&&(piece.operatorId===activePolicy.coreOperatorId||pactTargetOperatorIds.has(piece.operatorId));
  const frontlinePicks=picked.filter(piece=>opById(catalog,piece.operatorId)?.role==='frontline').sort((a,b)=>Number(isPriorityTarget(a))-Number(isPriorityTarget(b))||candidatePower(b,catalog)-candidatePower(a,catalog));
  const requiredFrontlinePicks=frontlinePicks.slice(0,routeSlots),extraFrontlinePicks=frontlinePicks.slice(routeSlots),requiredFrontlineUids=new Set(requiredFrontlinePicks.map(piece=>piece.uid));
  const deploymentSaleCandidate=(exceptUid=null)=>state.pieces.filter(piece=>piece.uid!==exceptUid&&piece.row===null&&!pickedUids.has(piece.uid)&&piece.operatorId!==activePolicy.coreOperatorId&&!pactTargetOperatorIds.has(piece.operatorId)&&state.inventory.length+piece.equipment.length<=20)
    .sort((a,b)=>candidatePower(a,catalog)-candidatePower(b,catalog)||a.uid.localeCompare(b.uid))[0]??null;
  const makeBenchRoom=(exceptUid=null)=>{
    if(state.pieces.filter(p=>p.row===null).length<capacity)return true;
    const weak=state.rulesVersion>=3?deploymentSaleCandidate(exceptUid):isEconomyCampaignPolicy(activePolicy.id)?deploymentSaleCandidate(exceptUid):state.pieces.filter(p=>p.uid!==exceptUid&&p.row===null&&(activePolicy.id==='legacy'?legacyBenchSaleAllowed(p,state,catalog):benchSaleReason(p,state,catalog))).sort((a,b)=>candidatePower(a,catalog)-candidatePower(b,catalog)||a.uid.localeCompare(b.uid))[0];
    if(!weak)return false;logSellReview(state,catalog,weak,'deployment-bench-capacity');state=runAction(state,{type:'sell',pieceUid:weak.uid},catalog).state;return state.pieces.filter(p=>p.row===null).length<capacity;
  };
  for(const piece of state.pieces.filter(p=>p.row!==null&&!pickedUids.has(p.uid))){
    if(!makeBenchRoom(piece.uid)){
      if(state.rulesVersion>=3&&state.inventory.length+piece.equipment.length<=20){logSellReview(state,catalog,piece,'deployment-bench-capacity');state=runAction(state,{type:'sell',pieceUid:piece.uid},catalog).state;continue;}
      throw new Error(`policy-cannot-make-bench-room:${JSON.stringify({pieceUid:piece.uid,benchCapacity:capacity,benchCount:state.pieces.filter(row=>row.row===null).length,inventoryCount:state.inventory.length,failedPieceEquipment:piece.equipment.map(row=>row.itemId),benchCandidates:state.pieces.filter(row=>row.row===null).map(row=>({uid:row.uid,operatorId:row.operatorId,equipment:row.equipment.map(item=>item.itemId),selected:pickedUids.has(row.uid),priority:isPriorityTarget(row),core:row.operatorId===activePolicy.coreOperatorId,pactTarget:pactTargetOperatorIds.has(row.operatorId),inventoryFits:state.inventory.length+row.equipment.length<=20}))})}`);
    }
    state=runAction(state,{type:'bench',pieceUid:piece.uid},catalog).state;
  }
  if(isEconomyCampaignPolicy(activePolicy.id)&&bossProfileIndex!==null){
    const routeLoad=Array(profiles.length).fill(0);
    for(const piece of picked){const live=state.pieces.find(p=>p.uid===piece.uid);if(!live||live.row===null||!isPriorityTarget(live)||opById(catalog,live.operatorId)?.role==='frontline'&&requiredFrontlineUids.has(live.uid))continue;
      const op=opById(catalog,live.operatorId),covers=operatorRouteCoverage(op,live.star,live.row,live.col,live.dir,profiles).includes(bossProfileIndex);if(covers)continue;
      const occupiedNow=new Set(state.pieces.filter(other=>other.row!==null&&other.uid!==live.uid).map(other=>`${other.row},${other.col}`));
      const frontlinesNow=state.pieces.filter(other=>other.row!==null&&other.uid!==live.uid&&opById(catalog,other.operatorId)?.role==='frontline').map(other=>({row:other.row,col:other.col,uid:other.uid,routeIndex:groundRoutes.find(entry=>routeDistance(other.row,other.col,entry.route)===0)?.index??null}));
      const tile=deploymentCell(state,catalog,field,op,occupiedNow,routeLoad,new Set(),summonSpecs(live,catalog),{star:live.star,routeIndex:bossProfileIndex,frontlines:frontlinesNow});if(!tile)continue;
      const action=tile.row===live.row&&tile.col===live.col?{type:'turn',pieceUid:live.uid,dir:tile.dir}:{type:'move',pieceUid:live.uid,row:tile.row,col:tile.col,dir:tile.dir};
      state=runAction(state,action,catalog).state;
    }
  }
    const routeCount=profiles.length,load=Array(routeCount).fill(0);
  const reserved=new Set(),assignedRoutes=new Map(),frontlines=[];
  for(const piece of picked){const live=state.pieces.find(p=>p.uid===piece.uid);if(!live||live.row===null)continue;const key=`${live.row},${live.col}`;occupied.add(key);selected.push(live);const op=opById(catalog,live.operatorId);if(op?.role==='frontline'){const exact=groundRoutes.find(({route})=>routeDistance(live.row,live.col,route)===0);if(exact){assignedRoutes.set(live.uid,exact.index);frontlines.push({row:live.row,col:live.col,routeIndex:exact.index,uid:live.uid});}}}
  const healerPicks=picked.filter(p=>opById(catalog,p.operatorId)?.role==='healer');
  const otherPicks=picked.filter(p=>!frontlinePicks.some(x=>x.uid===p.uid)&&!healerPicks.some(x=>x.uid===p.uid)).sort((a,b)=>candidatePower(b,catalog)-candidatePower(a,catalog));
  const isPriorityExtra=piece=>isPriorityTarget(piece)&&!requiredFrontlineUids.has(piece.uid);
  const ordered=[...requiredFrontlinePicks.slice(0,1),...healerPicks,...requiredFrontlinePicks.slice(1),...otherPicks,...extraFrontlinePicks];
  let frontCursor=0;
  for(const piece of ordered){const live=state.pieces.find(p=>p.uid===piece.uid);if(!live||live.row!==null)continue;
    const op=opById(catalog,live.operatorId);if(!op)continue;const summon=summonSpecs(live,catalog);
    let routeIndex=null;
    if(bossProfileIndex!==null&&live.operatorId===activePolicy.coreOperatorId&&(isEconomyCampaignPolicy(activePolicy.id)||['damage','control','summoner'].includes(op.role)))routeIndex=bossProfileIndex;
    if(bossProfileIndex!==null&&isEconomyCampaignPolicy(activePolicy.id)&&pactTargetOperatorIds.has(live.operatorId))routeIndex=bossProfileIndex;
    if(op.role==='frontline'){
      if(!isPriorityExtra(live)){const route=groundRoutes[frontCursor%Math.max(1,groundRoutes.length)];routeIndex=route?.index??null;frontCursor++;}
    }
    const tile=deploymentCell(state,catalog,field,op,occupied,load,reserved,summon,{star:live.star,routeIndex,frontlines});if(!tile)continue;
    const action=runAction(state,{type:'deploy',pieceUid:live.uid,row:tile.row,col:tile.col,dir:tile.dir},catalog);state=action.state;
    const key=`${tile.row},${tile.col}`;occupied.add(key);load[tile.routeIndex]=(load[tile.routeIndex]??0)+1;selected.push(live);
    if(op.role==='frontline'){assignedRoutes.set(live.uid,tile.routeIndex);frontlines.push({row:tile.row,col:tile.col,routeIndex:tile.routeIndex,uid:live.uid});}
    if(summon.length){const anchors=summonAnchors(op.stars[live.star].record,summon,field,tile.row,tile.col,tile.dir,occupied,reserved);for(const anchor of anchors)reserved.add(anchor);}
  }
  const deployedUids=new Set(selected.map(p=>p.uid));
  while(state.pieces.filter(p=>p.row!==null).length<deployCap){
    const deployed=state.pieces.filter(p=>p.row!==null),roleCounts=roleCountsForPieces(deployed,catalog);
    const orderedFallback=candidates.filter(piece=>!deployedUids.has(piece.uid)).map(piece=>({piece,op:opById(catalog,piece.operatorId)}))
      .filter(({piece,op})=>op&&(state.rulesVersion!==2||campaignDuplicatePlacementAllowed(piece,deployed,state,catalog))&&(canFillFallbackRole(op.role,roleCounts,{frontlineLimit:routeSlots,healerLimit:2})||(isEconomyCampaignPolicy(activePolicy.id)&&op.role==='frontline'&&isPriorityExtra(piece)))&&state.pieces.find(p=>p.uid===piece.uid)?.row===null)
      .sort((a,b)=>{
        const priority=op=>op.role==='healer'&&roleCounts.healer===0?0:op.role==='frontline'&&roleCounts.frontline<routeSlots?1:canAttackAir(op)&&roleCounts.antiAir<targets.antiAir?2:['damage','control'].includes(op.role)&&roleCounts.combatOutput<targets.combatOutput?3:op.role==='healer'?5:4;
        return priority(a.op)-priority(b.op)||candidatePower(b.piece,catalog)-candidatePower(a.piece,catalog)||a.piece.uid.localeCompare(b.piece.uid);
      });
    let placed=false;
    for(const {piece,op} of orderedFallback){
      const live=state.pieces.find(p=>p.uid===piece.uid);if(!live||live.row!==null)continue;const summon=summonSpecs(live,catalog);
      const routeIndex=bossProfileIndex!==null&&isEconomyCampaignPolicy(activePolicy.id)&&(live.operatorId===activePolicy.coreOperatorId||pactTargetOperatorIds.has(live.operatorId))?bossProfileIndex:null;
      const tile=deploymentCell(state,catalog,field,op,occupied,load,reserved,summon,{star:live.star,routeIndex,frontlines});if(!tile)continue;
      state=runAction(state,{type:'deploy',pieceUid:live.uid,row:tile.row,col:tile.col,dir:tile.dir},catalog).state;const key=`${tile.row},${tile.col}`;occupied.add(key);load[tile.routeIndex]=(load[tile.routeIndex]??0)+1;selected.push(live);deployedUids.add(live.uid);if(op.role==='frontline'){assignedRoutes.set(live.uid,tile.routeIndex);frontlines.push({row:tile.row,col:tile.col,routeIndex:tile.routeIndex,uid:live.uid});}
      if(summon.length){const anchors=summonAnchors(op.stars[live.star].record,summon,field,tile.row,tile.col,tile.dir,occupied,reserved);for(const anchor of anchors)reserved.add(anchor);}
      placed=true;break;
    }
    if(!placed)break;
  }
  if(!selected.length)throw new Error('policy-no-deployed-units');
  routeAssignmentsByState.set(state,assignedRoutes);
  return state;
}

function equipAndCombine(state,catalog){
  let guard=0;
  while(state.inventory.length>=2&&guard++<8){
    let best=null;
    for(let i=0;i<state.inventory.length;i++)for(let j=i+1;j<state.inventory.length;j++){
      const a=state.inventory[i],b=state.inventory[j],recipe=catalog.recipes.find(r=>r.parts?.length===2&&((r.parts[0]===a.itemId&&r.parts[1]===b.itemId)||(r.parts[0]===b.itemId&&r.parts[1]===a.itemId)));
      if(!recipe)continue;
      const owner=state.pieces.filter(piece=>piece.row!==null).sort((x,y)=>policyEquipmentOwnerUtility(catalog.equipment[recipe.resultId],y,state,catalog)-policyEquipmentOwnerUtility(catalog.equipment[recipe.resultId],x,state,catalog))[0];
      const score=item=>state.rulesVersion===2?carryItemScore(item,opById(catalog,owner?.operatorId),owner?.star):itemUtility(item,opById(catalog,owner?.operatorId));
      const base=score(catalog.equipment[a.itemId])+score(catalog.equipment[b.itemId]);
      const delta=score(catalog.equipment[recipe.resultId])-base;
      if(delta>0&&(!best||delta>best.delta))best={a,b,delta};
    }
    if(!best)break;
    state=runAction(state,{type:'combine',itemUids:[best.a.uid,best.b.uid]},catalog).state;
  }
  const ordered=[...state.inventory].sort((a,b)=>{
    const deployed=state.pieces.filter(p=>p.row!==null);
    const sa=Math.max(0,...deployed.map(p=>policyEquipmentOwnerUtility(catalog.equipment[a.itemId],p,state,catalog)*(1+p.star*.35)));
    const sb=Math.max(0,...deployed.map(p=>policyEquipmentOwnerUtility(catalog.equipment[b.itemId],p,state,catalog)*(1+p.star*.35)));return sb-sa||a.uid.localeCompare(b.uid);
  });
  for(const item of ordered){
    const owners=state.pieces.filter(p=>p.row!==null&&p.equipment.length<3&&!p.equipment.some(owned=>owned.itemId===item.itemId)&&policyEquipmentOwnerUtility(catalog.equipment[item.itemId],p,state,catalog)>0).sort((a,b)=>policyEquipmentOwnerUtility(catalog.equipment[item.itemId],b,state,catalog)*(1+b.star*.35)-policyEquipmentOwnerUtility(catalog.equipment[item.itemId],a,state,catalog)*(1+a.star*.35)||a.uid.localeCompare(b.uid));
    const owner=owners[0];if(!owner)continue;
    state=runAction(state,{type:'equip',pieceUid:owner.uid,itemUid:item.uid},catalog).state;
  }
  return state;
}

export function selectAdaptiveCarry(state,catalog,coreOperatorId=null){
  const deployed=state.pieces.filter(piece=>piece.row!==null),core=deployed.filter(piece=>piece.operatorId===coreOperatorId&&piece.star>=2)
    .sort((a,b)=>b.star-a.star||estimateOperatorPower(opById(catalog,b.operatorId),b.star)-estimateOperatorPower(opById(catalog,a.operatorId),a.star)||a.uid.localeCompare(b.uid))[0];
  if(core)return {piece:core,kind:'designated-core'};
  const season=state.rulesVersion===2,active=new Set(catalog.config?.activeOperatorIds??[]);
  const pactId=catalog.environments?.[state.environmentId]?.identityPactId;
  const eligible=deployed.filter(piece=>{
    const op=opById(catalog,piece.operatorId);
    return op&&[3,4].includes(Number(op.cost))&&['damage','control'].includes(op.role)&&(season?active.has(piece.operatorId):piecePactIds(piece,catalog).has(pactId))&&!String(op.charId??'').includes('4119_wanqin')&&!String(op.sourceChessId??'').includes('4119_wanqin');
  }).sort((a,b)=>b.star-a.star||estimateOperatorPower(opById(catalog,b.operatorId),b.star)-estimateOperatorPower(opById(catalog,a.operatorId),a.star)||(opById(catalog,b.operatorId)?.cost??0)-(opById(catalog,a.operatorId)?.cost??0)||a.uid.localeCompare(b.uid))[0];
  return eligible?{piece:eligible,kind:season?'held-season-carry':'main-pact-carry'}:null;
}

export function carryTransferPreservesPacts(state,catalog,source,target,item){
  const deployed=state.pieces.filter(piece=>piece.row!==null),before=pactMemberCounts(deployed,catalog);
  const simulated=deployed.map(piece=>piece.uid===source.uid?{...piece,equipment:piece.equipment.filter(entry=>entry.uid!==item.uid)}:piece.uid===target.uid?{...piece,equipment:[...piece.equipment,item]}:piece);
  const after=pactMemberCounts(simulated,catalog);
  for(const [id,count] of before){
    const thresholds=catalog.pacts?.[id]?.thresholds??catalog.pacts?.[id]?.levels?.map(level=>level.threshold)??[];
    if(thresholds.some(threshold=>count>=threshold&&(after.get(id)??0)<threshold))return false;
  }
  return true;
}

export function transferCarryEquipment(state,catalog,{coreOperatorId=null}={}){
  const selected=selectAdaptiveCarry(state,catalog,coreOperatorId),moves=[];
  if(!selected){const plan={round:state.round,kind:null,uid:null,operatorId:null,name:null,cost:null,star:null,gear:[],moves,reposition:activeMetrics?.carryRepositionPlans?.[state.round]??null};if(activeMetrics)activeMetrics.carryPlans[state.round]=plan;return {state,carry:plan,moves};}
  const targetUid=selected.piece.uid;
  if(state.rulesVersion===2&&state.round>=18){
    const target=state.pieces.find(p=>p.uid===targetUid),op=opById(catalog,target.operatorId);
    for(const item of [...target.equipment]){if(carryItemScore(catalog.equipment[item.itemId],op,target.star)>0||state.inventory.length>=20)continue;
      if(!carryTransferPreservesPacts(state,catalog,target,{uid:'inventory',equipment:[]},item))continue;
      state=runAction(state,{type:'unequip',itemUid:item.uid},catalog).state;
    }
  }
  for(let pass=0;pass<3;pass++){
    const target=state.pieces.find(piece=>piece.uid===targetUid);if(!target||target.equipment.length>=3)break;
    const already=new Set(target.equipment.map(item=>item.itemId));
    const candidates=[];
    for(const source of state.pieces){
      if(source.uid===target.uid||source.row===null)continue;
      const sourceOp=opById(catalog,source.operatorId),sourceItems=source.equipment??[];
      for(const item of sourceItems){
        if(already.has(item.itemId)||catalog.recipes.some(recipe=>recipe.parts?.includes(item.itemId)))continue;
        const itemDef=catalog.equipment?.[item.itemId];if(!itemDef)continue;
        const donorFactor=carryOperatorPowerFactor(sourceOp,source.star??1,catalog),targetOp=opById(catalog,target.operatorId),targetFactor=carryOperatorPowerFactor(targetOp,target.star??1,catalog);
        const donorScore=carryItemScore(itemDef,sourceOp,source.star,state.rulesVersion!==2)*donorFactor+equipmentTransferBonus(itemDef,source,state,catalog);
        const targetScore=carryItemScore(itemDef,targetOp,target.star,state.rulesVersion!==2)*targetFactor+equipmentTransferBonus(itemDef,target,state,catalog),gain=targetScore-donorScore;
        if(gain<1||targetScore<donorScore*1.05||!carryTransferPreservesPacts(state,catalog,source,target,item))continue;
        candidates.push({source,item,sourceOp,donorScore,targetScore,gain});
      }
    }
    candidates.sort((a,b)=>b.gain-a.gain||a.source.uid.localeCompare(b.source.uid)||a.item.uid.localeCompare(b.item.uid));
    const best=candidates[0];
    if(!best||state.inventory.length>=20)break;
    const sourceBefore=best.source.equipment.map(item=>item.itemId),targetBefore=target.equipment.map(item=>item.itemId);
    state=runAction(state,{type:'unequip',itemUid:best.item.uid},catalog).state;
    state=runAction(state,{type:'equip',pieceUid:target.uid,itemUid:best.item.uid},catalog).state;
    const liveTarget=state.pieces.find(piece=>piece.uid===target.uid),liveSource=state.pieces.find(piece=>piece.uid===best.source.uid);
    const move={round:state.round,sourceUid:best.source.uid,sourceOperatorId:best.source.operatorId,sourceCost:best.sourceOp?.cost??null,sourcePower:estimateOperatorPower(best.sourceOp,best.source.star),sourcePowerFactor:carryOperatorPowerFactor(best.sourceOp,best.source.star,catalog),targetUid:target.uid,targetOperatorId:target.operatorId,targetCost:opById(catalog,target.operatorId)?.cost??null,targetPower:estimateOperatorPower(opById(catalog,target.operatorId),target.star),targetPowerFactor:carryOperatorPowerFactor(opById(catalog,target.operatorId),target.star,catalog),itemUid:best.item.uid,itemId:best.item.itemId,scoreBefore:best.donorScore,scoreAfter:best.targetScore,scoreGain:best.gain,sourceGearBefore:sourceBefore,sourceGearAfter:liveSource?.equipment.map(item=>item.itemId)??[],targetGearBefore:targetBefore,targetGearAfter:liveTarget?.equipment.map(item=>item.itemId)??[]};
    moves.push(move);
    if(activeMetrics){activeMetrics.carryTransfers.push(move);const record=activeMetrics.carryPlans[state.round];if(record)record.moves.push(move);}
  }
  const carry=state.pieces.find(piece=>piece.uid===targetUid),operator=carry&&opById(catalog,carry.operatorId);
  const plan={round:state.round,kind:selected.kind,uid:carry?.uid??null,operatorId:carry?.operatorId??null,name:operator?.name??null,cost:operator?.cost??null,star:carry?.star??null,gear:carry?.equipment.map(item=>item.itemId)??[],moves,reposition:activeMetrics?.carryRepositionPlans?.[state.round]??null};
  if(activeMetrics)activeMetrics.carryPlans[state.round]=plan;
  return {state,carry:plan,moves};
}

export function planCarryAdaptiveDeployment(state,catalog,{coreOperatorId=null}={}){
  const field=activeBattleFields(state,catalog),profiles=routeProfiles(field),ground=groundRouteEntries(field,profiles),bossIds=bossRouteIndices(field);
  const bossIndex=profiles.findIndex(route=>route.originalIndices?.some(index=>bossIds.has(index))),units=state.pieces.filter(piece=>piece.row!==null),carry=selectAdaptiveCarry(state,catalog,coreOperatorId)?.piece??null;
  const roleOrder=units.slice().sort((a,b)=>{
    const ao=opById(catalog,a.operatorId),bo=opById(catalog,b.operatorId),priority=piece=>{
      const op=opById(catalog,piece.operatorId);if(state.rulesVersion===2&&bossIndex>=0&&piece.uid===carry?.uid)return -1;if(op?.role==='frontline')return 0;if(op?.role==='healer')return 1;if(piece.uid===carry?.uid)return 2;if(canAttackAir(op))return 3;if(['damage','control','summoner'].includes(op?.role))return 4;return 5;
    };return priority(a)-priority(b)||candidatePower(b,catalog)-candidatePower(a,catalog)||a.uid.localeCompare(b.uid);
  });
  const occupied=new Set(),load=Array(profiles.length).fill(0),reserved=new Set(),frontlines=[],desired=[],assignedFrontRoutes=new Set();let frontCursor=0;
  for(const piece of roleOrder){
    const live=state.pieces.find(entry=>entry.uid===piece.uid),op=opById(catalog,live.operatorId);if(!op)continue;
    let routeIndex=null;
    if(op.role==='frontline'&&ground.length){
      routeIndex=live.uid===carry?.uid&&bossIndex>=0?bossIndex:ground.find(entry=>!assignedFrontRoutes.has(entry.index))?.index??ground[frontCursor%ground.length].index;assignedFrontRoutes.add(routeIndex);frontCursor++;
    }else if(bossIndex>=0&&live.uid===carry?.uid)routeIndex=bossIndex;
    const tile=deploymentCell(state,catalog,field,op,occupied,load,reserved,summonSpecs(live,catalog),{star:live.star,routeIndex,frontlines});
    if(!tile){desired.push({uid:live.uid,operatorId:live.operatorId,role:op.role,from:[live.row,live.col,live.dir],to:null,reason:'no-legal-target'});continue;}
    const entry={uid:live.uid,operatorId:live.operatorId,role:op.role,from:[live.row,live.col,live.dir],to:[tile.row,tile.col,tile.dir],routeIndex:tile.routeIndex};desired.push(entry);occupied.add(tile.key);load[tile.routeIndex]=(load[tile.routeIndex]??0)+1;
    if(op.role==='frontline')frontlines.push({row:tile.row,col:tile.col,routeIndex:tile.routeIndex,uid:live.uid});
    const specs=summonSpecs(live,catalog);if(specs.length){const anchors=summonAnchors(op.stars[live.star].record,specs,field,tile.row,tile.col,tile.dir,occupied,reserved);for(const anchor of anchors)reserved.add(anchor);}
  }
  return {field,profiles,ground,bossIndex,carry,desired,reserved:[...reserved]};
}

export function repositionCarryAdaptiveTeam(state,catalog,{coreOperatorId=null}={}){
  const plan=planCarryAdaptiveDeployment(state,catalog,{coreOperatorId}),pending=new Set(plan.desired.filter(entry=>entry.to).map(entry=>entry.uid)),moves=[],reasons=[];
  const destination=new Map(plan.desired.filter(entry=>entry.to).map(entry=>[entry.uid,entry.to]));
  const planKeys=new Set([...destination.values()].map(([row,col])=>`${row},${col}`)),reserved=new Set(plan.reserved);
  let guard=0;
  while(pending.size&&guard++<100){
    const ready=[...pending].find(uid=>{const piece=state.pieces.find(entry=>entry.uid===uid),to=destination.get(uid);return piece&&(piece.row===to[0]&&piece.col===to[1]||!state.pieces.some(other=>other.uid!==uid&&other.row===to[0]&&other.col===to[1]));});
    if(ready){
      const piece=state.pieces.find(entry=>entry.uid===ready),to=destination.get(ready),from=[piece.row,piece.col,piece.dir];
      if(piece.row!==to[0]||piece.col!==to[1])state=runAction(state,{type:'move',pieceUid:piece.uid,row:to[0],col:to[1],dir:to[2]},catalog).state;
      else if(piece.dir!==to[2])state=runAction(state,{type:'turn',pieceUid:piece.uid,dir:to[2]},catalog).state;
      moves.push({uid:piece.uid,operatorId:piece.operatorId,action:from[0]===to[0]&&from[1]===to[1]?'turn':'move',from,to});pending.delete(ready);continue;
    }
    const uid=[...pending][0],piece=state.pieces.find(entry=>entry.uid===uid),op=opById(catalog,piece?.operatorId),target=destination.get(uid),blocker=target&&state.pieces.find(other=>other.uid!==uid&&other.row===target[0]&&other.col===target[1]);
    if(blocker&&!pending.has(blocker.uid)){reasons.push({kind:'desired-cell-held-by-fixed-unit',uid,blockerUid:blocker.uid,target});break;}
    const buffer=[...plan.field.deployMap.keys()].filter(key=>{
      if(planKeys.has(key)||reserved.has(key)||state.pieces.some(other=>other.row!==null&&`${other.row},${other.col}`===key))return false;
      const [row,col]=key.split(',').map(Number);return canOperatorUseTile(op,plan.field.deployMap,row,col)&&(op?.role!=='frontline'||canBlockGround(plan.field,row,col));
    }).sort()[0];
    if(!piece||!buffer){reasons.push({kind:'no-legal-buffer-for-move-cycle',uids:[...pending]});break;}
    const [row,col]=buffer.split(',').map(Number),from=[piece.row,piece.col,piece.dir],toward=destination.get(uid),dir=toward?.[2]??piece.dir;
    state=runAction(state,{type:'move',pieceUid:uid,row,col,dir},catalog).state;
    moves.push({uid,operatorId:piece.operatorId,action:'buffer',from,to:[row,col,dir]});
  }
  if(guard>=100&&pending.size)reasons.push({kind:'move-loop-guard',uids:[...pending]});
  const actual=plan.desired.map(entry=>{const piece=state.pieces.find(item=>item.uid===entry.uid);return {uid:entry.uid,operatorId:entry.operatorId,role:entry.role,desired:entry.to,actual:piece?[piece.row,piece.col,piece.dir]:null,routeIndex:entry.routeIndex,reason:entry.reason??null};});
  const carry=state.pieces.find(piece=>piece.uid===plan.carry?.uid),carryOp=carry&&opById(catalog,carry.operatorId),carryRoutes=carry?operatorRouteCoverage(carryOp,carry.star,carry.row,carry.col,carry.dir,plan.profiles):[],bossRouteOriginalIndices=plan.bossIndex>=0?plan.profiles[plan.bossIndex]?.originalIndices??[]:[];
  const frontPieces=state.pieces.filter(piece=>piece.row!==null&&opById(catalog,piece.operatorId)?.role==='frontline');
  const routeCoverage={frontlines:frontPieces.map(piece=>({uid:piece.uid,position:[piece.row,piece.col],blocksGround:canBlockGround(plan.field,piece.row,piece.col),nativeGroundRoutes:plan.ground.filter(entry=>routeDistance(piece.row,piece.col,entry.route)===0).map(entry=>entry.index)})),healers:state.pieces.filter(piece=>piece.row!==null&&opById(catalog,piece.operatorId)?.role==='healer').map(piece=>({uid:piece.uid,coveredFrontlines:frontPieces.filter(front=>operatorRouteCoverage(opById(catalog,piece.operatorId),piece.star,piece.row,piece.col,piece.dir,[{points:[[front.row,front.col]]}]).length>0).map(front=>front.uid)})),carryBossCoverage:{uid:carry?.uid??null,coveredRoutes:carryRoutes,bossRouteOriginalIndices,coveredBossRoute:bossRouteOriginalIndices.some(index=>plan.profiles.some((route,routeIndex)=>route.originalIndices?.includes(index)&&carryRoutes.includes(routeIndex)))}};
  const result={round:state.round,carryUid:plan.carry?.uid??null,carryOperatorId:plan.carry?.operatorId??null,bossRouteIndex:plan.bossIndex>=0?plan.bossIndex:null,desired:plan.desired.map(({uid,operatorId,role,to,routeIndex,reason})=>({uid,operatorId,role,to,routeIndex,reason:reason??null})),actual,moves,reasons,routeCoverage};
  routeAssignmentsByState.set(state,new Map(result.routeCoverage.frontlines.flatMap(unit=>{const assigned=result.actual.find(entry=>entry.uid===unit.uid)?.routeIndex;return assigned==null?[]:[[unit.uid,assigned]];})));
  if(activeMetrics)activeMetrics.carryRepositionPlans[state.round]=result;
  return {state,plan:result};
}

function improveEconomy(state,catalog){
  if(activePolicy.id===ECON_PACT_POLICY)return improveEconomyPact(state,catalog);
  if(activePolicy.id===ADAPTIVE_STANDARD_POLICY||activePolicy.id===CARRY_ADAPTIVE_POLICY)return improveEconomyPact(state,catalog,true);
  if(activePolicy.id==='rush'&&!activePolicy.rushReleased&&state.gold>=50){activePolicy.rushReleased=true;activePolicy.rushReleasedRound=state.round;}
  const lacksBoardPower=state.pieces.length<state.level;
  const needsHealer=!state.pieces.some(p=>opById(catalog,p.operatorId)?.role==='healer'),refreshCost=viewSession(state,{catalog}).actionCosts?.refreshGold??2;
  const minimumHealerCost=Math.min(...Object.values(catalog.operators).filter(op=>op.role==='healer').map(op=>op.cost??Infinity));
  const initialRolePlan=activePolicy.id==='legacy'?null:campaignRolePlan(state,catalog),lacksTeamRoles=initialRolePlan&&Object.values(initialRolePlan.missing).some(value=>value>0);
  let reserve=bankFloor(state.round);if(state.hp<50||state.round>=12)reserve=0;
  if(activePolicy.id!=='legacy'){
    reserve=activePolicy.id==='rush'?(activePolicy.rushReleased?0:Math.max(50,reserve)):bankFloor(state.round);
    if(activePolicy.id==='reroll')reserve=3;
  }
  if(needsHealer&&activePolicy.id!=='reroll')reserve=Math.max(reserve,refreshCost*2+(Number.isFinite(minimumHealerCost)?minimumHealerCost:0));
  if(activePolicy.id!=='legacy'&&(state.hp<40||lacksBoardPower||lacksTeamRoles))reserve=0;
  const makeCoreRoom=()=>{
    const reduced=hasActiveStrategyEffect(state,catalog,'bench_capacity_and_gold');
    const capacity=reduced?7:9;
    if(activePolicy.id!=='reroll'||!activePolicy.coreOperatorId||state.pieces.filter(p=>p.row===null).length<capacity)return true;
    const weak=state.pieces.filter(p=>p.row===null&&state.inventory.length+p.equipment.length<=20&&benchSaleReason(p,state,catalog))
      .sort((a,b)=>candidatePower(a,catalog)-candidatePower(b,catalog)||a.uid.localeCompare(b.uid))[0];
    if(!weak)return false;
    logSellReview(state,catalog,weak,'reroll-bench-capacity');
    state=runAction(state,{type:'sell',pieceUid:weak.uid},catalog).state;return true;
  };
  let buys=0;
  while(buys<(activePolicy.id==='legacy'&&needsHealer?1:activePolicy.id==='rush'&&activePolicy.rushReleased?1:4)){
    makeCoreRoom();
    if(activePolicy.id==='reroll'&&!activePolicy.coreOperatorId)activePolicy.coreOperatorId=chooseRerollCore(catalog,state);
    const candidate=chooseOffer(state,catalog,{context:'purchase'});if(!candidate)break;
    if(activePolicy.id!=='legacy'){
      const room=makePurchaseBenchSpace(state,catalog,candidate.offer.operatorId);if(!room){activeMetrics.roleDecisions.push({round:state.round,action:'buy',operatorId:candidate.offer.operatorId,reason:'bench-full-no-unrequired-piece-to-sell'});rejectCoreOffer(candidate,state,'bench-full-no-unrequired-piece-to-sell');break;}state=room;
      const current=evaluateCampaignOffer(candidate.offer.operatorId,state,catalog,activeBattleFields(state,catalog),activePolicy.coreOperatorId);if(!current.ok){activeMetrics.roleDecisions.push({round:state.round,action:'buy',operatorId:candidate.offer.operatorId,reason:`qualification-changed-after-bench-release:${current.reason}`});rejectCoreOffer(candidate,state,`qualification-changed-after-bench-release:${current.reason}`);break;}
    }
    const cost=Number(candidate.offer.cost),purchaseFloor=activePolicy.id==='reroll'&&candidate.offer.operatorId===activePolicy.coreOperatorId?0:reserve;if(state.gold-cost<purchaseFloor){if(activeMetrics&&activePolicy.id!=='legacy')activeMetrics.roleDecisions.push({round:state.round,action:'buy',operatorId:candidate.offer.operatorId,reason:'reserve-floor',gold:state.gold,cost,reserve:purchaseFloor});rejectCoreOffer(candidate,state,'reserve-floor');break;}
    const duplicate=state.pieces.find(p=>p.operatorId===candidate.offer.operatorId&&p.star===1);
    state=runAction(state,{type:'buy',offerUid:candidate.offer.uid,...(duplicate?{mergeTargetUid:duplicate.uid}:{})},catalog).state;buys++;
  }
  let xpGoal=policyLevelTarget(activePolicy.id,state.round);
  if(activePolicy.id==='reroll'&&state.round>=6&&state.round<14&&!state.pieces.some(p=>p.operatorId===activePolicy.coreOperatorId&&p.star===3))xpGoal=Math.min(5,xpGoal);
  const currentField=activeBattleFields(state,catalog),legalSlotCap=Math.min(10,currentField.deployMap?.size??10),roleFieldableCapacity=eligibleRosterCapacity(state,catalog,currentField),currentPolicyCapacity=isEconomyCampaignPolicy(activePolicy.id)?legalSlotCap:Math.min(legalSlotCap,roleFieldableCapacity);
  if(activePolicy.id!=='legacy'&&activePolicy.id!=='rush'&&!isEconomyCampaignPolicy(activePolicy.id)&&xpGoal>currentPolicyCapacity){activeMetrics.roleDecisions.push({round:state.round,action:'buyXp',reason:roleFieldableCapacity<=state.level?'no-eligible-new-member-for-population':'legal-deployment-capacity',targetLevel:xpGoal,roleFieldableCapacity,legalSlotCap});xpGoal=currentPolicyCapacity;}
  let xpBuys=0;
  while(state.level<xpGoal&&(state.pieces.length>state.level||activePolicy.id==='rush'||isEconomyCampaignPolicy(activePolicy.id))&&xpBuys<4){
    const plan=campaignRolePlan(state,catalog);
    if(activePolicy.id!=='legacy'&&activePolicy.id!=='rush'&&Object.values(plan.missing).some(value=>value>0)){activeMetrics.roleDecisions.push({round:state.round,action:'buyXp',reason:'wait-for-required-team-roles',missing:plan.missing});break;}
    const cost=viewSession(state,{catalog}).actionCosts?.xpGold??4;
    if(state.gold-cost<reserve){if(activeMetrics&&activePolicy.id!=='legacy')activeMetrics.roleDecisions.push({round:state.round,action:'buyXp',reason:'reserve-floor',gold:state.gold,cost,reserve});break;}
    state=runAction(state,{type:'buyXp'},catalog).state;xpBuys++;
  }
  const teamNeeds=!state.pieces.some(p=>opById(catalog,p.operatorId)?.role==='healer')||!state.pieces.some(p=>opById(catalog,p.operatorId)?.role==='frontline');
  const chaseCore=activePolicy.id==='reroll'&&activePolicy.coreOperatorId&&!state.pieces.some(p=>p.operatorId===activePolicy.coreOperatorId&&p.star>=3);
  const rerollSearch=activePolicy.id==='reroll'&&(!activePolicy.coreOperatorId||chaseCore);
  const refreshLimit=rerollSearch?10:state.hp<50?5:teamNeeds||chaseCore?5:state.round>=12?4:1;let refreshes=0;
  while(refreshes<refreshLimit){
    const cost=viewSession(state,{catalog}).actionCosts?.refreshGold??2,refreshFloor=activePolicy.id!=='legacy'?(state.hp<40||lacksBoardPower?0:reserve):state.hp<50||state.round>=12?0:bankFloor(state.round);if(state.gold-cost<refreshFloor)break;
    state=runAction(state,{type:'refresh'},catalog).state;refreshes++;
    makeCoreRoom();if(activePolicy.id==='reroll'&&!activePolicy.coreOperatorId)activePolicy.coreOperatorId=chooseRerollCore(catalog,state);const candidate=chooseOffer(state,catalog,{context:'refresh'}),candidateRole=candidate?opById(catalog,candidate.offer.operatorId)?.role:null;
    const corePurchase=activePolicy.id==='reroll'&&candidate?.offer.operatorId===activePolicy.coreOperatorId;
    if(candidate&&(!needsHealer||state.pieces.some(p=>opById(catalog,p.operatorId)?.role==='healer')||candidateRole==='healer'||corePurchase)&&state.gold-candidate.offer.cost>=(corePurchase?0:refreshFloor)){
      if(activePolicy.id!=='legacy'){const room=makePurchaseBenchSpace(state,catalog,candidate.offer.operatorId);if(!room){rejectCoreOffer(candidate,state,'bench-full-no-unrequired-piece-to-sell','refresh');continue;}state=room;const current=evaluateCampaignOffer(candidate.offer.operatorId,state,catalog,activeBattleFields(state,catalog),activePolicy.coreOperatorId);if(!current.ok){rejectCoreOffer(candidate,state,`qualification-changed-after-bench-release:${current.reason}`,'refresh');continue;}}
      const duplicate=state.pieces.find(p=>p.operatorId===candidate.offer.operatorId&&p.star===1);state=runAction(state,{type:'buy',offerUid:candidate.offer.uid,...(duplicate?{mergeTargetUid:duplicate.uid}:{})},catalog).state;buys++;}
    else if(candidate)rejectCoreOffer(candidate,state,!(!needsHealer||state.pieces.some(p=>opById(catalog,p.operatorId)?.role==='healer')||candidateRole==='healer'||corePurchase)?'required-healer-gate':state.gold-candidate.offer.cost<(corePurchase?0:refreshFloor)?'reserve-floor':'offer-not-purchasable','refresh');
  }
  for(const item of [...state.consumables]){
    const targets=copyTargetsForCampaign(state,catalog,activePolicy.coreOperatorId);
    const target=targets.find(piece=>item.kind!=='smallCopy'||Number(catalog.operators[piece.operatorId]?.cost)<=3)??null;
    if(target){activeMetrics.copyTargets.push({round:state.round,pieceUid:target.uid,operatorId:target.operatorId,star:target.star,core:target.operatorId===activePolicy.coreOperatorId});state=runAction(state,{type:'useCopy',consumableUid:item.uid,pieceUid:target.uid},catalog).state;}
  }
  return state;
}

function improveEconomyPact(state,catalog,adaptive=false){
  if(state.rulesVersion===2&&activePolicy.id===CARRY_ADAPTIVE_POLICY)activePolicy.coreOperatorId=selectSeasonCampaignCore(state,catalog,activePolicy.coreOperatorId);
  const plan=adaptive?adaptiveStandardPlan(state.round,state.level,state.hp):econPactPlan(state.round,state.level),field=activeBattleFields(state,catalog),identity=catalog.environments?.[state.environmentId]?.identityPactId;
  const allowsXp=()=>state.rulesVersion===2?seasonCampaignXpDecision(state,catalog,activeBattleFields(state,catalog)).allowed:adaptiveStandardAllowsXp({level:state.level,hp:state.hp,legalUniqueOwned});
  let legalUniqueOwned=0,xpAllowed=true;
  if(adaptive){const chars=new Set(state.pieces.filter(piece=>legalCandidateCell(opById(catalog,piece.operatorId),field,new Set())).map(piece=>opById(catalog,piece.operatorId)?.charId).filter(Boolean));legalUniqueOwned=chars.size;xpAllowed=allowsXp();activeMetrics.adaptivePlans.push({round:state.round,hp:state.hp,level:state.level,legalUniqueOwned,bankTarget:plan.bankTarget,xpReserve:plan.xpReserve,refreshEnabled:plan.refreshEnabled,refreshLimit:plan.refreshLimit,refreshReserve:plan.refreshReserve,xpAllowed,xpGate:xpAllowed?null:'owned-legal-unique-not-above-level'});}
  const reserve=plan.bankTarget;
  let buys=0;
  const initialMissing=campaignRolePlan(state,catalog,field).missing;
  const roleStable=!initialMissing.frontline&&!initialMissing.healer&&!initialMissing.antiAir;
  const buyLimit=adaptive&&plan.initialBuyLimit!==null?plan.initialBuyLimit:state.round>=24?4:roleStable?2:1;
  const canActOnOffer=(offer,op)=>{
    const roleNeed=roleNeedForOffer(op,state,catalog,field),floor=roleNeed?0:reserve;
    if(state.gold-Number(offer.cost)<floor)return false;
    const owned=state.pieces.filter(piece=>piece.operatorId===op.id),count=pactMemberCounts(state.pieces,catalog).get(identity)??0,thresholds=catalog.pacts?.[identity]?.thresholds??catalog.pacts?.[identity]?.levels?.map(level=>level.threshold)??[];
    const expansion=state.rulesVersion===2&&state.round>=24&&state.level<10&&!owned.length&&['damage','control','healer'].includes(op.role)&&legalCandidateCell(op,field,new Set());
    const targetable=Boolean(expansion||roleNeed||owned.some(piece=>piece.star===1)||econPactIdentityInvestment(op,state,catalog)||op.id===activePolicy.coreOperatorId&&campaignCorePurchaseAvailable(state,op)||thresholds.some(value=>value>count)&&(op.pacts??[]).includes(identity)&&!state.pieces.some(piece=>opById(catalog,piece.operatorId)?.charId===op.charId));
    if(!targetable)return false;
    const reduced=hasActiveStrategyEffect(state,catalog,'bench_capacity_and_gold'),capacity=reduced?7:9;
    return state.pieces.filter(piece=>piece.row===null).length<capacity||Boolean(purchaseBenchCandidate(state,catalog,op.id));
  };
  while(buys<buyLimit){
    const candidate=chooseOffer(state,catalog,{context:'purchase',isActionable:canActOnOffer});if(!candidate)break;
    const op=opById(catalog,candidate.offer.operatorId);if(!op)break;
    const roleNeed=roleNeedForOffer(op,state,catalog,field),owned=state.pieces.filter(piece=>piece.operatorId===op.id);
    const canMerge=owned.some(piece=>piece.star===1);
    const count=pactMemberCounts(state.pieces,catalog).get(identity)??0;
    const thresholds=catalog.pacts?.[identity]?.thresholds??catalog.pacts?.[identity]?.levels?.map(item=>item.threshold)??[];
    const nextThreshold=thresholds.find(value=>value>count);
    const advancesIdentity=Boolean(nextThreshold&&(op.pacts??[]).includes(identity));
    const isCore=op.id===activePolicy.coreOperatorId&&campaignCorePurchaseAvailable(state,op);
    const expansion=state.rulesVersion===2&&state.round>=24&&state.level<10&&!owned.length&&['damage','control','healer'].includes(op.role)&&legalCandidateCell(op,field,new Set());
    if(!roleNeed&&!canMerge&&!advancesIdentity&&!isCore&&!expansion)break;
    const cost=Number(candidate.offer.cost),purchaseReserve=roleNeed?0:reserve;
    if(state.gold-cost<purchaseReserve){activeMetrics.roleDecisions.push({round:state.round,action:'buy',operatorId:op.id,reason:'econ-pact-bank-floor',gold:state.gold,cost,reserve:purchaseReserve});rejectCoreOffer(candidate,state,'econ-pact-bank-floor');break;}
    const room=makePurchaseBenchSpace(state,catalog,op.id);if(!room){activeMetrics.roleDecisions.push({round:state.round,action:'buy',operatorId:op.id,reason:'bench-full-no-unrequired-piece-to-sell'});break;}state=room;
    const duplicate=state.pieces.find(piece=>piece.operatorId===op.id&&piece.star===1);
    state=runAction(state,{type:'buy',offerUid:candidate.offer.uid,...(duplicate?{mergeTargetUid:duplicate.uid}:{})},catalog).state;buys++;
  }
  const xpPlan=adaptive?adaptiveStandardPlan(state.round,state.level,state.hp):econPactPlan(state.round,state.level),fieldNow=activeBattleFields(state,catalog),legalSlotCap=Math.min(10,fieldNow.deployMap?.size??10);
  const seasonXp=state.rulesVersion===2?seasonCampaignXpDecision(state,catalog,fieldNow):null;
  const xpGoal=Math.min(seasonXp?.target??xpPlan.levelTarget,legalSlotCap),xpPurchaseLimit=seasonXp?.purchaseLimit??4,xpReserve=seasonXp?.reserve??xpPlan.xpReserve;
  let xpBuys=0;
  if(adaptive){const chars=new Set(state.pieces.filter(piece=>legalCandidateCell(opById(catalog,piece.operatorId),fieldNow,new Set())).map(piece=>opById(catalog,piece.operatorId)?.charId).filter(Boolean));legalUniqueOwned=chars.size;xpAllowed=allowsXp();const current=activeMetrics.adaptivePlans.at(-1);if(current){current.legalUniqueOwned=legalUniqueOwned;current.xpAllowed=xpAllowed;current.xpGate=xpAllowed?null:'owned-legal-unique-not-above-level';}}
  while(state.level<xpGoal&&xpBuys<xpPurchaseLimit){
    if(adaptive){xpAllowed=allowsXp();const current=activeMetrics.adaptivePlans.at(-1);if(current){current.legalUniqueOwned=legalUniqueOwned;current.xpAllowed=xpAllowed;current.xpGate=xpAllowed?null:'owned-legal-unique-not-above-level';}if(!xpAllowed){activeMetrics.roleDecisions.push({round:state.round,action:'buyXp',reason:'adaptive-legal-roster-capacity',level:state.level,legalUniqueOwned});break;}}
    const missing=campaignRolePlan(state,catalog,fieldNow).missing;
    if((missing.frontline||missing.healer||missing.antiAir)&&!(state.rulesVersion===2&&state.round>=24&&seasonXp.allowed)){activeMetrics.roleDecisions.push({round:state.round,action:'buyXp',reason:'econ-pact-wait-for-block-heal-air',missing});break;}
    const cost=viewSession(state,{catalog}).actionCosts?.xpGold??4;
    if(state.gold-cost<xpReserve){activeMetrics.roleDecisions.push({round:state.round,action:'buyXp',reason:'econ-pact-bank-floor',gold:state.gold,cost,reserve:xpReserve});break;}
    state=runAction(state,{type:'buyXp'},catalog).state;xpBuys++;
  }
  const refreshPlan=adaptive?adaptiveStandardPlan(state.round,state.level,state.hp):econPactPlan(state.round,state.level);
  if(refreshPlan.refreshEnabled){
    const refreshLimit=adaptive?refreshPlan.refreshLimit:state.round>=24?5:3,refreshReserve=adaptive?refreshPlan.refreshReserve:state.round>=24?0:state.level<9?40:30;let refreshed=0;
    while(refreshed<refreshLimit){
      const cost=viewSession(state,{catalog}).actionCosts?.refreshGold??2;if(state.gold-cost<refreshReserve)break;
      state=runAction(state,{type:'refresh'},catalog).state;refreshed++;
      const canActOnRefreshed=(offer,op)=>{
        const currentCount=pactMemberCounts(state.pieces,catalog).get(identity)??0,currentThresholds=catalog.pacts?.[identity]?.thresholds??catalog.pacts?.[identity]?.levels?.map(level=>level.threshold)??[];
        const roleNeed=roleNeedForOffer(op,state,catalog,fieldNow),ownsStar1=state.pieces.some(piece=>piece.operatorId===op.id&&piece.star===1),targetsCore=op.id===activePolicy.coreOperatorId;
        const expansion=state.rulesVersion===2&&state.round>=24&&state.level<10&&!state.pieces.some(p=>p.operatorId===op.id)&&['damage','control','healer'].includes(op.role)&&legalCandidateCell(op,fieldNow,new Set());
        const targetable=expansion||roleNeed||ownsStar1||targetsCore||econPactIdentityInvestment(op,state,catalog)||((op.pacts??[]).includes(identity)&&currentThresholds.some(value=>value>currentCount)&&!state.pieces.some(piece=>opById(catalog,piece.operatorId)?.charId===op.charId));
        const floor=roleNeed?0:refreshReserve,room=state.pieces.filter(piece=>piece.row===null).length<(hasActiveStrategyEffect(state,catalog,'bench_capacity_and_gold')?7:9)||Boolean(purchaseBenchCandidate(state,catalog,op.id));
        return targetable&&state.gold-Number(offer.cost)>=floor&&room;
      };
      const candidate=chooseOffer(state,catalog,{context:'refresh',isActionable:canActOnRefreshed});if(!candidate)continue;
      const op=opById(catalog,candidate.offer.operatorId),owned=state.pieces.filter(piece=>piece.operatorId===op?.id),count=pactMemberCounts(state.pieces,catalog).get(identity)??0;
      const thresholds=catalog.pacts?.[identity]?.thresholds??catalog.pacts?.[identity]?.levels?.map(item=>item.threshold)??[];
      const targetsCore=op?.id===activePolicy.coreOperatorId,targetsPact=Boolean((op?.pacts??[]).includes(identity)&&thresholds.some(value=>value>count)),targetsMerge=owned.some(piece=>piece.star===1);
      const expansion=state.rulesVersion===2&&state.round>=24&&state.level<10&&!owned.length&&['damage','control','healer'].includes(op?.role)&&legalCandidateCell(op,fieldNow,new Set());
      if(!targetsCore&&!targetsPact&&!targetsMerge&&!expansion)continue;
      if(state.gold-Number(candidate.offer.cost)<refreshReserve)continue;
      const room=makePurchaseBenchSpace(state,catalog,candidate.offer.operatorId);if(!room)continue;state=room;
      const duplicate=state.pieces.find(piece=>piece.operatorId===candidate.offer.operatorId&&piece.star===1);
      state=runAction(state,{type:'buy',offerUid:candidate.offer.uid,...(duplicate?{mergeTargetUid:duplicate.uid}:{})},catalog).state;buys++;
    }
  }
  for(const item of [...state.consumables]){
    const targets=copyTargetsForCampaign(state,catalog,activePolicy.coreOperatorId);
    const target=selectEconPactCopyTarget(item,targets,state,activePolicy.coreOperatorId,catalog);if(!target)continue;
    activeMetrics.copyTargets.push({round:state.round,kind:item.kind,pieceUid:target.uid,operatorId:target.operatorId,star:target.star,core:target.operatorId===activePolicy.coreOperatorId});
    state=runAction(state,{type:'useCopy',consumableUid:item.uid,pieceUid:target.uid},catalog).state;
  }
  return state;
}
export function selectEconPactCopyTarget(item,targets,state,coreOperatorId,catalog){
  const core=targets.find(piece=>piece.operatorId===coreOperatorId)??null;
  if(item?.kind==='smallCopy'){
    if(state.rulesVersion===2&&core&&catalog.operators[core.operatorId]?.cost<=3)return core;
    const mergeReady=targets.find(piece=>state.pieces.filter(other=>other.operatorId===piece.operatorId&&other.star===1).length>=1);
    return mergeReady??targets.find(piece=>piece.star===1)??null;
  }
  if(item?.kind==='universalCopy'){
    if(core&&(state.level>=9||state.rulesVersion===2))return core;
    if(state.round<24)return null;
    return targets.find(piece=>piece.operatorId!==coreOperatorId&&piece.star===1)??null;
  }
  throw new Error(`unsupported-econ-pact-copy:${item?.kind}`);
}

export function runCampaign({environmentId='origin_laterano',difficulty='NORMAL',seed=1,maxBattles=Infinity,maxMs=DEFAULT_TIMEOUT,policy='legacy',balanceProfile='formal',rulesVersion=1,onProgress=null,onBeforeFight=null}={}){
  if(![1,2,3].includes(rulesVersion))throw new Error('unknown-campaign-rules-version');
  if(rulesVersion>=2&&balanceProfile!=='formal')throw new Error('season-campaign-requires-formal-balance');
  if(!['legacy',...CAMPAIGN_POLICIES,ECON_PACT_POLICY,ADAPTIVE_STANDARD_POLICY,CARRY_ADAPTIVE_POLICY].includes(policy))throw new Error(`unknown-campaign-policy:${policy}`);
  if(!['formal','looser','refined-standard','accessible-standard'].includes(balanceProfile))throw new Error(`unknown-enemy-balance-profile:${balanceProfile}`);
  const metrics={actions:{},refreshes:{},nodeEconomy:{},operatorBuys:{},corePurchases:0,coreOffersSeen:0,coreOfferDecisions:[],coreOfferPurchases:[],copyTargets:[],roleDecisions:[],sellDecisions:[],placementDecisions:[],adaptivePlans:[],carryPlans:{},carryTransfers:[],carryRepositionPlans:{}};activeMetrics=metrics;
  const started=Date.now(),catalog=catalogForBalanceProfile(rulesVersion===3?getPrototypeCampaignCatalog(seed):rulesVersion===2?getSeasonCampaignCatalog(seed):getCatalog(environmentId,seed),balanceProfile,difficulty),created=createSession({seed,difficulty,catalog,...(rulesVersion===1?{environmentId}:{})});
  if(!created.ok)throw new Error(`session-create:${created.error}`);
  let state=created.state,battles=0,truncated=false;const battleRows=[],policyErrors=[];
  activeProgress=typeof onProgress==='function'?progress=>onProgress({rulesVersion,openingId:state.openingId??null,seed,battles,...progress}):null;
  activeProgress?.({round:state.round,phase:state.phase,hp:state.hp,gold:state.gold,level:state.level,action:'created'});
  const prototypeCore=rulesVersion===3?Object.values(catalog.operators).filter(op=>['damage','control','frontline','summoner'].includes(op.role)).sort((a,b)=>(b.cost??0)-(a.cost??0)||estimateOperatorPower(b,3)-estimateOperatorPower(a,3)||a.id.localeCompare(b.id))[0]?.id??null:null;
  activePolicy={id:policy,coreOperatorId:rulesVersion===2&&policy===CARRY_ADAPTIVE_POLICY?selectSeasonCampaignCore(state,catalog):policy==='reroll'?chooseRerollCore(catalog,state):rulesVersion===3&&['tempo','rush'].includes(policy)?prototypeCore:policy==='tempo'||policy==='rush'||isEconomyCampaignPolicy(policy)?chooseEnvironmentCore(catalog):null,rushReleased:false,rushReleasedRound:null};
  if(!poolLedgers.has(catalog))poolLedgers.set(catalog,new Map(catalog.config.activeOperatorIds.map(id=>[id,
    Number(state.poolRemaining[id]??0)+state.pieces.filter(piece=>piece.operatorId===id).reduce((sum,piece)=>sum+3**(piece.star-1),0)+state.shop.offers.filter(offer=>offer.operatorId===id).length])));
  assertInvariants(state,catalog);
  let actionGuard=0;
  while(state.phase!=='complete'&&battles<maxBattles){
    if(Date.now()-started>maxMs){truncated=true;break;}
    if(++actionGuard>5000)throw new Error('campaign-action-loop-guard');
    if(state.pendingChoices.length){state=resolveChoices(state,catalog);continue;}
    if(difficulty==='FUNNY'&&state.round%2===1){
      // FUNNY logistics rounds still expose the ordinary preparation actions.
      // Spend/position only through the same session actions as combat rounds;
      // advanceSupply then performs the unchanged logistics settlement.
      state=improveEconomy(state,catalog);
      if(state.pendingChoices.length){state=resolveChoices(state,catalog);continue;}
      state=equipAndCombine(state,catalog);
      if(state.pendingChoices.length){state=resolveChoices(state,catalog);continue;}
      state=deployTeam(state,catalog);
      if(state.pendingChoices.length){state=resolveChoices(state,catalog);continue;}
      if(policy===CARRY_ADAPTIVE_POLICY){state=repositionCarryAdaptiveTeam(state,catalog,{coreOperatorId:activePolicy.coreOperatorId}).state;state=transferCarryEquipment(state,catalog,{coreOperatorId:activePolicy.coreOperatorId}).state;}
      if(state.pendingChoices.length){state=resolveChoices(state,catalog);continue;}
      state=runAction(state,{type:'advanceSupply'},catalog).state;
      continue;
    }
    if(!state.nodeStarted){state=runAction(state,{type:'advanceSupply'},catalog).state;if(state.pendingChoices.length)continue;}
    if(state.phase==='complete')break;
    state=improveEconomy(state,catalog);
    if(state.pendingChoices.length){state=resolveChoices(state,catalog);continue;}
    state=equipAndCombine(state,catalog);
    if(state.pendingChoices.length){state=resolveChoices(state,catalog);continue;}
    state=deployTeam(state,catalog);
    if(state.pendingChoices.length){state=resolveChoices(state,catalog);continue;}
    if(policy===CARRY_ADAPTIVE_POLICY){state=repositionCarryAdaptiveTeam(state,catalog,{coreOperatorId:activePolicy.coreOperatorId}).state;state=transferCarryEquipment(state,catalog,{coreOperatorId:activePolicy.coreOperatorId}).state;}
    if(state.pendingChoices.length){state=resolveChoices(state,catalog);continue;}
    const assignedRoutes=routeAssignmentsByState.get(state)??new Map();
    const field=activeBattleFields(state,catalog);
    const deployed=state.pieces.filter(p=>p.row!==null);const pactPeople=new Map();for(const p of deployed){const op=opById(catalog,p.operatorId),ids=new Set(op?.pacts??[]);for(const item of p.equipment??[])for(const effect of catalog.equipment[item.itemId]?.effects??[])if(['transfer_pact','pact_transfer'].includes(effect.kind)&&effect.params?.pactId)ids.add(effect.params.pactId);for(const id of p.extraPacts??[])ids.add(id);if(op)for(const id of ids){const members=pactPeople.get(id)??new Set();members.add(op.charId);pactPeople.set(id,members);}}
    const mainPacts=[...pactPeople].map(([id,members])=>{const pact=catalog.pacts[id],tierIndex=pactTierIndex(pact,members.size);return {id,count:members.size,threshold:tierIndex>=0?(pact.levels?.[tierIndex]?.threshold??pact.levels?.[tierIndex]?.minUnits??pact.thresholds?.[tierIndex]??0):0,tier:tierIndex>=0?tierIndex+1:0,active:tierIndex>=0?{minUnits:pact.levels?.[tierIndex]?.minUnits??pact.levels?.[tierIndex]?.threshold,maxUnits:pact.levels?.[tierIndex]?.maxUnits??null,exactCounts:pact.levels?.[tierIndex]?.exactCounts??[]} :null};}).sort((a,b)=>b.tier-a.tier||b.count-a.count||a.id.localeCompare(b.id)).slice(0,3);
    const battleProfiles=routeProfiles(field),battleRoutes=battleProfiles.map(x=>x.points[0]),battleGroundRoutes=groundRouteEntries(field,battleProfiles);
    const deployedRoleCounts=roleCountsForPieces(deployed,catalog),roleTargets=campaignRoleTargets(state,catalog,field),roleDeficits={frontline:Math.max(0,roleTargets.frontlines-deployedRoleCounts.frontline),healer:Math.max(0,roleTargets.healers-deployedRoleCounts.healer),antiAir:Math.max(0,roleTargets.antiAir-deployedRoleCounts.antiAir)};
    const coreId=activePolicy.coreOperatorId??null;
    const bossOriginalRouteIndices=[...bossRouteIndices(field)],coreUnit=deployed.filter(piece=>piece.operatorId===coreId).sort((a,b)=>b.star-a.star)[0],coreCoverage=campaignBossCoverage(coreUnit,catalog,battleProfiles,bossOriginalRouteIndices);
    const before={round:state.round,gold:state.gold,hp:state.hp,level:state.level,coreStock:{operatorId:coreId,owned:coreId?state.pieces.filter(piece=>piece.operatorId===coreId).length:0,deployed:coreId?deployed.filter(piece=>piece.operatorId===coreId).length:0,shopOffers:coreId?state.shop.offers.filter(offer=>offer.operatorId===coreId).length:0,poolRemaining:coreId?Number(state.poolRemaining[coreId]??0):0},bossOriginalRouteIndices,coreBossCoverage:coreCoverage,routeCount:battleRoutes.length,
      roster:deployed.map(p=>{const op=opById(catalog,p.operatorId),nearest=battleProfiles.map((route,index)=>({index,d:routeDistance(p.row,p.col,route)})).sort((a,b)=>a.d-b.d)[0],nativePacts=new Set(op?.pacts??[]),pacts=new Set([...nativePacts,...(p.extraPacts??[])]),transferPacts=new Set();for(const item of p.equipment??[])for(const effect of catalog.equipment[item.itemId]?.effects??[])if(['transfer_pact','pact_transfer'].includes(effect.kind)&&effect.params?.pactId){pacts.add(effect.params.pactId);if(!nativePacts.has(effect.params.pactId))transferPacts.add(effect.params.pactId);}return {uid:p.uid,operatorId:p.operatorId,name:op?.name,cost:op?.cost,star:p.star,role:op?.role,position:op?.position,canHitFly:canAttackAir(op),row:p.row,col:p.col,dir:p.dir,blocksGround:op?.role==='frontline'?canBlockGround(field,p.row,p.col):null,routeIndex:op?.role==='frontline'?(assignedRoutes.get(p.uid)??nearest?.index??null):null,coveredRoutes:operatorRouteCoverage(op,p.star,p.row,p.col,p.dir,battleProfiles),pacts:[...pacts],transferPacts:[...transferPacts],equipment:p.equipment.map(item=>item.itemId)};}),benchReserve:state.pieces.filter(p=>p.row===null).map(p=>({uid:p.uid,operatorId:p.operatorId,name:opById(catalog,p.operatorId)?.name,cost:opById(catalog,p.operatorId)?.cost,role:opById(catalog,p.operatorId)?.role,star:p.star})),mainPacts,refreshesSpent:metrics.refreshes[state.round]??0,
      roleCounts:Object.fromEntries(['frontline','healer','damage','control','summoner','support'].map(role=>[role,deployed.filter(p=>opById(catalog,p.operatorId)?.role===role).length]).concat([['antiAir',deployedRoleCounts.antiAir],['combatOutput',deployedRoleCounts.combatOutput]])),roleTargets,roleDeficits,vacantSlots:Math.max(0,state.level-deployed.length),deployCellCount:field.deployMap?.size??null,
      routeCoverage:{routes:battleProfiles.map((route,index)=>({index,originalIndices:route.originalIndices,motion:route.motion,source:route.source,points:route.points})),groundFrontlines:deployed.filter(p=>opById(catalog,p.operatorId)?.role==='frontline').map(p=>{const routeIndex=assignedRoutes.get(p.uid),route=routeIndex==null?null:battleProfiles[routeIndex],distanceToPath=route?routeDistance(p.row,p.col,route):null;return {uid:p.uid,routeIndex,originalRouteIndices:route?.originalIndices??[],position:[p.row,p.col],distanceToPath,blocksGround:canBlockGround(field,p.row,p.col),onNativePath:distanceToPath===0,blocksGroundPath:distanceToPath===0&&canBlockGround(field,p.row,p.col)};}),uncoveredGroundRoutes:battleGroundRoutes.map(({index})=>index).filter(index=>!deployed.some(p=>opById(catalog,p.operatorId)?.role==='frontline'&&canBlockGround(field,p.row,p.col)&&routeDistance(p.row,p.col,battleProfiles[index])===0)),healerCoverage:deployed.filter(p=>opById(catalog,p.operatorId)?.role==='healer').map(p=>({uid:p.uid,coveredFrontlines:deployed.filter(x=>opById(catalog,x.operatorId)?.role==='frontline').filter(x=>operatorRouteCoverage(opById(catalog,p.operatorId),p.star,p.row,p.col,p.dir,[{points:[[x.row,x.col]]}]).length>0).map(x=>x.uid)}))}};
    if(typeof onBeforeFight==='function')onBeforeFight({state:structuredClone(state),round:state.round,policy,seed,rulesVersion});
    const action=runAction(state,{type:'fight'},catalog);state=action.state;battles++;
    const event=action.events.find(e=>e.type==='fight-settled');
    if(!event)throw new Error(`fight-result-missing:${before.round}`);
    const sourceResult=event.result??{};
    const perPlayers=sourceResult.perPlayer&&typeof sourceResult.perPlayer==='object'?sourceResult.perPlayer:{};
    const playerResult=perPlayers.resonance??Object.values(perPlayers)[0]??{};
    const leakEntries=Array.isArray(playerResult.leaked)?playerResult.leaked.filter(entry=>entry&&entry.counted!==false):null;
    const leaked=Number.isFinite(Number(event.metrics?.leaked??sourceResult.metrics?.leaked))?Number(event.metrics?.leaked??sourceResult.metrics?.leaked):leakEntries?.length??null;
    const diagnostic=event.diagnostics??{};
    const summonGaps=diagnostic.summonAnchorGaps??[];
    const unitStats=Array.isArray(playerResult.unitStats)?playerResult.unitStats:[];
    const coreUids=new Set(before.roster.filter(unit=>unit.operatorId===activePolicy.coreOperatorId).map(unit=>unit.uid));
    const coreUnits=unitStats.filter(unit=>coreUids.has(unit.uid));
    const coreDamage=coreUnits.reduce((sum,unit)=>sum+(Number(unit.dmg)||0),0),coreAttacks=coreUnits.reduce((sum,unit)=>sum+(Number(unit.attacks)||0),0);
    const row={round:before.round,won:event.won,hpLoss:event.hpLoss,hpAfter:state.hp,goldBefore:event.goldBefore,goldAfter:event.goldAfter,
      level:before.level,coreStock:before.coreStock,bossOriginalRouteIndices:before.bossOriginalRouteIndices,coreBossCoverage:before.coreBossCoverage,roster:before.roster,benchReserve:before.benchReserve,mainPacts:before.mainPacts,roleCounts:before.roleCounts,roleTargets:before.roleTargets,roleDeficits:before.roleDeficits,vacantSlots:before.vacantSlots,deployCellCount:before.deployCellCount,routeCoverage:before.routeCoverage,refreshesSpent:before.refreshesSpent,routeCount:before.routeCount,stageId:diagnostic.stageId,battleTicks:diagnostic.ticks,capped:diagnostic.capped,
      battleTime:sourceResult.time??null,battleReason:sourceResult.reason??null,enemyBalance:diagnostic.enemyBalance??null,totalDamage:unitStats.reduce((sum,unit)=>sum+(Number(unit.dmg)||0),0),totalAttacks:unitStats.reduce((sum,unit)=>sum+(Number(unit.attacks)||0),0),
      coreDamage,coreAttacks,bossDamage:Number(playerResult.bossDamage)||0,bossId:diagnostic.bossId??null,bossHp:sourceResult.bossHpLeft??sourceResult.bossHp??sourceResult.bossHpRemaining??null,leaked,leakPoints:leakEntries?.reduce((n,entry)=>n+Math.max(0,Number(entry.lpr)||1),0)??null,diagnostics:Number(diagnostic.errorCount??0),summonAnchorGaps:summonGaps};
    battleRows.push(row);
    if(row.diagnostics)policyErrors.push({round:row.round,kind:'battle-diagnostics',count:row.diagnostics});
    if(summonGaps.length)policyErrors.push({round:row.round,kind:'summon-anchor-gaps',gaps:summonGaps});
  }
  activeMetrics=null;
  const roleAcquisitions={};for(const [id,count]of Object.entries(metrics.operatorBuys)){const role=opById(catalog,id)?.role??'unknown';roleAcquisitions[role]=(roleAcquisitions[role]??0)+count;}
  const coreOfferRejections=metrics.coreOfferDecisions.filter(entry=>entry.rejectionReason);
  const coreOfferRejectionCounts=Object.fromEntries([...new Set(coreOfferRejections.map(entry=>entry.rejectionReason))].map(reason=>[reason,coreOfferRejections.filter(entry=>entry.rejectionReason===reason).length]));
  const coreOperator=activePolicy.coreOperatorId?catalog.operators[activePolicy.coreOperatorId]:null;
  const coreSelectionRule=rulesVersion===2?'existing adaptive policy uses held roles, stars, equipment and native route coverage without a faction leader':rulesVersion===3?'highest-cost active-season damage/control/frontline/summoner candidate, then estimated star-3 power and stable operator ID':policy==='reroll'?'highest score among offered 2/3-cost native anti-air operators after real-DPS qualification':isEconomyCampaignPolicy(policy)?'highest-cost identity-pact damage/control/frontline/summoner, available after level 9':'highest-cost identity-pact damage/control/frontline/summoner, then estimated star-3 power, then stable operator ID';
  const nodeEconomy=Object.values(metrics.nodeEconomy).sort((a,b)=>a.round-b.round);
  const result={environmentId:rulesVersion>=2?null:environmentId,rulesVersion,seasonId:state.seasonId??null,openingId:state.openingId??null,activeOperatorIds:[...catalog.config.activeOperatorIds],listConsistent:rulesVersion===1||state.activeOperatorIds.length===catalog.config.activeOperatorIds.length&&state.activeOperatorIds.every((id,i)=>id===catalog.config.activeOperatorIds[i]),poolConservation:{ok:true,checks:metrics.invariantChecks??0},starMilestones:metrics.starMilestones??[],difficulty,seed,policy,balanceProfile,enemyBalance:structuredClone(catalog.campaign.enemyBalance),designatedCoreId:activePolicy.coreOperatorId??null,coreSelection:{operatorId:coreOperator?.id??null,name:coreOperator?.name??null,cost:coreOperator?.cost??null,role:coreOperator?.role??null,rule:coreSelectionRule},designatedCorePurchases:metrics.corePurchases,coreOffersSeen:metrics.coreOffersSeen,coreOffersRejected:coreOfferRejections.length,coreOffersBought:metrics.coreOfferPurchases.length,coreOfferDecisions:metrics.coreOfferDecisions,coreOfferPurchases:metrics.coreOfferPurchases,coreOfferRejectionCounts,coreOfferRejections,copyTargets:metrics.copyTargets,runMode:rulesVersion===3?'v3-set13-headless-natural-session':'legacy-campaign',rushReleasedRound:activePolicy.rushReleasedRound??null,operatorBuys:metrics.operatorBuys,roleAcquisitions,roleDecisions:metrics.roleDecisions,sellDecisions:metrics.sellDecisions,placementDecisions:metrics.placementDecisions,nodeEconomy,actionLedger:metrics.ledger??[],roundLimit:state.roundLimit,battles:battleRows.length,rows:battleRows,policyActions:metrics.actions,
    terminalReason:state.terminalReason??null,phase:state.phase,round:state.round,hp:state.hp,gold:state.gold,level:state.level,xp:state.xp,
    roster:state.pieces.map(p=>({operatorId:p.operatorId,name:opById(catalog,p.operatorId)?.name,cost:opById(catalog,p.operatorId)?.cost,star:p.star,role:opById(catalog,p.operatorId)?.role,items:p.equipment.map(i=>catalog.equipment[i.itemId]?.name)})),carryPlans:metrics.carryPlans,carryTransfers:metrics.carryTransfers,
    claimedNodes:[...state.claimedNodes],inventory:state.inventory.map(i=>catalog.equipment[i.itemId]?.name),strategies:state.strategies.map(s=>catalog.strategies[typeof s==='string'?s:s.id]?.name),
    diagnostics:{battleErrors:policyErrors.filter(e=>e.kind==='battle-diagnostics').length,summonAnchorGaps:policyErrors.filter(e=>e.kind==='summon-anchor-gaps').flatMap(e=>e.gaps),policyErrors},adaptivePlans:metrics.adaptivePlans,elapsedMs:Date.now()-started,truncated};
  activePolicy={id:'legacy',coreOperatorId:null,rushReleased:false};
  activeProgress=null;
  return result;
}

function naturalCampaignGitSnapshot(){
  try{
    const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    return {baseCommit:git('rev-parse','HEAD'),dirtyPaths:git('status','--short','--untracked-files=all').split(/\r?\n/).filter(Boolean)};
  }catch(error){return {baseCommit:null,dirtyPaths:[],gitError:error.message};}
}
function validateNaturalCampaignReport(){
  ensureReportPath();
  const parent=path.resolve(path.dirname(NATURAL_V3_REPORT));
  if(path.dirname(path.resolve(NATURAL_V3_REPORT)).toLowerCase()!==parent.toLowerCase())throw new Error('invalid-natural-campaign-report-path');
  if(fs.existsSync(NATURAL_V3_REPORT)){
    const stat=fs.lstatSync(NATURAL_V3_REPORT);
    if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink>1)throw new Error(`unsafe-natural-campaign-report:${NATURAL_V3_REPORT}`);
    const current=JSON.parse(fs.readFileSync(NATURAL_V3_REPORT,'utf8'));
    if(current.schema!=='stronghold.resonance-natural-campaign/v1')throw new Error(`unknown-natural-campaign-report:${NATURAL_V3_REPORT}`);
  }
}
function writeNaturalCampaignReport(document){fs.writeFileSync(NATURAL_V3_REPORT,`${JSON.stringify(document,null,2)}\n`,'utf8');}
export function runPrototypeNaturalCampaignBatch({seed=1,maxMs=10*60*1000}={}){
  validateNaturalCampaignReport();
  const started=Date.now(),git=naturalCampaignGitSnapshot();
  const document=fs.existsSync(NATURAL_V3_REPORT)?JSON.parse(fs.readFileSync(NATURAL_V3_REPORT,'utf8')):{schema:'stronghold.resonance-natural-campaign/v1',historicalAttempts:[{
    runMode:'prior-inline-naive-v3-session',difficulty:'NORMAL',seed:1,status:'failed',battles:23,round:23,hp:0,
    detailAvailability:'Only the terminal summary was retained in the earlier execution; its per-round ledger was not written, so it is not reconstructed here.'
  }],batches:[]};
  const sourceCatalog=getPrototypeCampaignCatalog(seed);
  const batch={startedAt:new Date().toISOString(),seed,difficulty:'NORMAL',rulesVersion:3,runMode:'v3-set13-headless-natural-session',
    timeLimitMs:maxMs,gitBaseCommit:git.baseCommit,dirtyPaths:git.dirtyPaths,gitError:git.gitError??null,
    canonicalDataDirectory:CANONICAL_DATA_DIR,dataSourceCommit:sourceCatalog.source?.commit??null,policies:['tempo','reroll','rush'],runs:[],status:'running'};
  document.batches.push(batch);writeNaturalCampaignReport(document);
  for(const policy of batch.policies){
    const remaining=maxMs-(Date.now()-started);
    if(remaining<=0){batch.status='timeout';break;}
    try{
      const run=runCampaign({rulesVersion:3,difficulty:'NORMAL',seed,policy,balanceProfile:'formal',maxBattles:Infinity,maxMs:remaining});
      batch.runs.push(run);
    }catch(error){batch.runs.push({rulesVersion:3,difficulty:'NORMAL',seed,policy,error:error.message,terminalReason:null,battles:0,rows:[]});}
    writeNaturalCampaignReport(document);
  }
  if(batch.status==='running')batch.status=batch.runs.length===batch.policies.length?'complete':'timeout';
  batch.elapsedMs=Date.now()-started;
  batch.summary={plannedPolicies:batch.policies.length,completedPolicies:batch.runs.length,
    victories:batch.runs.filter((run)=>run.terminalReason==='victory').map((run)=>run.policy),
    failures:batch.runs.filter((run)=>run.terminalReason&&run.terminalReason!=='victory').map((run)=>({policy:run.policy,terminalReason:run.terminalReason,round:run.round,hp:run.hp})),
    errors:batch.runs.filter((run)=>run.error).map((run)=>({policy:run.policy,error:run.error})),
    battleErrors:batch.runs.reduce((sum,run)=>sum+Number(run.diagnostics?.battleErrors??0),0),
    summonAnchorGaps:batch.runs.reduce((sum,run)=>sum+(run.diagnostics?.summonAnchorGaps?.length??0),0),
    policyErrors:batch.runs.reduce((sum,run)=>sum+(run.diagnostics?.policyErrors?.length??0),0)};
  batch.finishedAt=new Date().toISOString();writeNaturalCampaignReport(document);
  return {report:NATURAL_V3_REPORT,batch};
}

/** Run one deterministic natural V3 policy and append its real R28 pre-fight session snapshot for Native Runner replay. */
export function capturePrototypeNativeFinalFixture({seed=1,maxMs=3*60*1000}={}){
  validateNaturalCampaignReport();
  const sourceCatalog=getPrototypeCampaignCatalog(seed),git=naturalCampaignGitSnapshot();
  let beforeFinalFight=null;
  const run=runCampaign({rulesVersion:3,difficulty:'NORMAL',seed,policy:'tempo',balanceProfile:'formal',maxBattles:Infinity,maxMs,
    onBeforeFight:({state,round})=>{if(round===28)beforeFinalFight=state;}});
  const finalRow=run.rows.find((row)=>row.round===28)??null;
  const fixture={createdAt:new Date().toISOString(),status:run.terminalReason==='victory'&&finalRow?.won&&beforeFinalFight?'captured':'failed',
    seed,policy:'tempo',rulesVersion:3,difficulty:'NORMAL',runMode:'v3-set13-headless-natural-session',
    gitBaseCommit:git.baseCommit,dirtyPaths:git.dirtyPaths,dataSourceCommit:sourceCatalog.source?.commit??null,
    enemyBalance:structuredClone(run.enemyBalance),expected:{terminalReason:run.terminalReason,round:run.round,hp:run.hp,
      finalRow:finalRow?{round:finalRow.round,won:finalRow.won,hpLoss:finalRow.hpLoss,hpAfter:finalRow.hpAfter,
        goldBefore:finalRow.goldBefore,goldAfter:finalRow.goldAfter,battleTime:finalRow.battleTime,battleReason:finalRow.battleReason,
        bossId:finalRow.bossId,bossHp:finalRow.bossHp,stageId:finalRow.stageId,diagnostics:finalRow.diagnostics}:null},
    preFightSession:beforeFinalFight};
  const document=fs.existsSync(NATURAL_V3_REPORT)?JSON.parse(fs.readFileSync(NATURAL_V3_REPORT,'utf8')):{schema:'stronghold.resonance-natural-campaign/v1',historicalAttempts:[],batches:[]};
  document.nativeFinalFixtures??=[];document.nativeFinalFixtures.push(fixture);writeNaturalCampaignReport(document);
  return {report:NATURAL_V3_REPORT,fixture:{status:fixture.status,seed,policy:'tempo',round:beforeFinalFight?.round??null,
    terminalReason:run.terminalReason,finalRow:fixture.expected.finalRow,gitBaseCommit:git.baseCommit}};
}

export function runPolicyComparison({environments=['origin_aegir','origin_laterano','origin_kjerag','origin_yan'],difficulty='NORMAL',seedBase=0x504f4c49,maxMs=DEFAULT_TIMEOUT,balanceProfile='formal'}={}){
  const started=Date.now(),runs=[];let truncated=false;
  for(const environmentId of environments){
    const seed=seedFor(environmentId,difficulty,seedBase);
    for(const policy of CAMPAIGN_POLICIES){
      if(Date.now()-started>=maxMs){truncated=true;break;}
      try{const run=runCampaign({environmentId,difficulty,seed,policy,balanceProfile,maxMs:Math.max(1000,maxMs-(Date.now()-started))});
        const starCounts={1:0,2:0,3:0};for(const piece of run.roster)starCounts[piece.star]=(starCounts[piece.star]??0)+1;
        const rows=run.rows.map(row=>({round:row.round,won:row.won,hpLoss:row.hpLoss,hpAfter:row.hpAfter,goldBefore:row.goldBefore,goldAfter:row.goldAfter,level:row.level,battleTime:row.battleTime,battleReason:row.battleReason,enemyBalance:row.enemyBalance,capped:row.capped,totalDamage:row.totalDamage,totalAttacks:row.totalAttacks,coreDamage:row.coreDamage,coreAttacks:row.coreAttacks,bossId:row.bossId,bossHp:row.bossHp,bossDamage:row.bossDamage,coreStock:row.coreStock,roleCounts:row.roleCounts,roleTargets:row.roleTargets,roleDeficits:row.roleDeficits,vacantSlots:row.vacantSlots,deployCellCount:row.deployCellCount,uncoveredGroundRoutes:row.routeCoverage.uncoveredGroundRoutes,benchReserve:row.benchReserve,roster:row.roster.map(piece=>({uid:piece.uid,operatorId:piece.operatorId,name:piece.name,cost:piece.cost,star:piece.star,role:piece.role,canHitFly:piece.canHitFly,pacts:piece.pacts,transferPacts:piece.transferPacts,equipment:piece.equipment})),mainPacts:row.mainPacts,routeCount:row.routeCount,stageId:row.stageId,leaked:row.leaked,leakPoints:row.leakPoints,diagnostics:row.diagnostics,summonAnchorGaps:row.summonAnchorGaps,designatedCore:{operatorId:run.designatedCoreId??null,deployed:row.roster.some(piece=>piece.operatorId===run.designatedCoreId),stock:row.coreStock,inventory:row.roster.find(piece=>piece.operatorId===run.designatedCoreId)??row.benchReserve.find(piece=>piece.operatorId===run.designatedCoreId)??null},gearStars:Object.fromEntries([...new Set(row.roster.flatMap(piece=>piece.equipment))].map(itemId=>[itemId,row.roster.filter(piece=>piece.equipment.includes(itemId)).map(piece=>piece.star)])),failureReason:row.won?'cleared':row.bossId&&Number(row.bossHp)>0?'boss-survived-time-limit':row.leaked>0?'leaked-enemies':row.capped?'battle-time-cap':'failed-without-boss-clear'}));
        const checkpoints=Object.fromEntries([5,10,15,20,26,28].map(target=>{const row=rows.find(item=>item.round===target);return [target,row?{round:row.round,level:row.level,goldBefore:row.goldBefore,goldAfter:row.goldAfter,battleTime:row.battleTime,capped:row.capped,bossHp:row.bossHp,bossDamage:row.bossDamage,coreDamage:row.coreDamage,coreAttacks:row.coreAttacks,roster:row.roster.map(({name,cost,star,role,pacts,transferPacts,equipment})=>({name,cost,star,role,pacts,transferPacts,equipment})),bench:row.benchReserve.map(({name,cost,star,role})=>({name,cost,star,role})),mainPacts:row.mainPacts,core:row.roster.find(piece=>piece.operatorId===run.designatedCoreId)??row.benchReserve.find(piece=>piece.operatorId===run.designatedCoreId)??null}:null];}));
        const starMilestones={};for(const star of [2,3]){starMilestones[star]={};for(const piece of run.roster){const first=rows.find(row=>[...row.roster,...row.benchReserve].some(entry=>entry.operatorId===piece.operatorId&&entry.star>=star));if(first&&!starMilestones[star][piece.operatorId])starMilestones[star][piece.operatorId]={name:piece.name,cost:piece.cost,round:first.round};}}
        const firstFailure=rows.find(row=>!row.won);
        const coreSnapshots=rows.map(row=>({round:row.round,core:row.designatedCore})).filter(item=>item.core?.inventory);
        const firstAtStar=star=>coreSnapshots.find(item=>item.core.inventory.star>=star)?.round??null;
        const coreProgress={firstOwnedRound:coreSnapshots[0]?.round??null,firstDeployedRound:coreSnapshots.find(item=>item.core.deployed)?.round??null,firstTwoStarRound:firstAtStar(2),firstThreeStarRound:firstAtStar(3),maxObservedStar:coreSnapshots.reduce((max,item)=>Math.max(max,item.core.inventory.star??0),0),mainPactProgress:rows.map(row=>({round:row.round,mainPacts:row.mainPacts}))};
        runs.push({environmentId,difficulty,seed,policy,balanceProfile:run.balanceProfile,enemyBalance:run.enemyBalance,designatedCoreId:run.designatedCoreId,coreSelection:run.coreSelection,designatedCoreStars:run.roster.filter(piece=>piece.operatorId===run.designatedCoreId).map(piece=>piece.star),coreProgress,designatedCorePurchases:run.designatedCorePurchases,coreOffersSeen:run.coreOffersSeen,coreOffersRejected:run.coreOffersRejected,coreOffersBought:run.coreOffersBought,coreOfferRejectionCounts:run.coreOfferRejectionCounts,coreOfferDecisions:run.coreOfferDecisions,coreOfferPurchases:run.coreOfferPurchases,coreOfferRejections:run.coreOfferRejections,copyTargets:run.copyTargets,rushReleasedRound:run.rushReleasedRound,operatorBuys:run.operatorBuys,roleAcquisitions:run.roleAcquisitions,roleDecisions:run.roleDecisions,sellDecisions:run.sellDecisions,placementDecisions:run.placementDecisions,battles:run.battles,terminalReason:run.terminalReason,round:run.round,hp:run.hp,gold:run.gold,level:run.level,xp:run.xp,starCounts,roster:run.roster,strategies:run.strategies,policyActions:run.policyActions,checkpoints,starMilestones,firstFailureNode:firstFailure?{round:firstFailure.round,hpLoss:firstFailure.hpLoss,hpAfter:firstFailure.hpAfter,bossId:firstFailure.bossId,bossHp:firstFailure.bossHp,bossDamage:firstFailure.bossDamage,coreDamage:firstFailure.coreDamage,leaked:firstFailure.leaked,failureReason:firstFailure.failureReason}:null,rows,nodeCurve:rows.map(row=>({round:row.round,won:row.won,hpAfter:row.hpAfter,hpLoss:row.hpLoss,level:row.level,goldAfter:row.goldAfter,mainPacts:row.mainPacts,core:row.designatedCore,stars:Object.fromEntries([1,2,3].map(star=>[star,row.roster.filter(piece=>piece.star===star).length])),bossHp:row.bossHp,bossDamage:row.bossDamage,coreDamage:row.coreDamage,leaked:row.leaked,failureReason:row.failureReason})),diagnostics:run.diagnostics,truncated:run.truncated});
      }catch(error){runs.push({environmentId,difficulty,seed,policy,error:error.message});}
    }
    if(truncated)break;
  }
  const nodeBuckets=new Map();for(const run of runs)for(const row of run.rows??[]){const bucket=nodeBuckets.get(row.round)??[];bucket.push(row);nodeBuckets.set(row.round,bucket);}
  const nodeCurve=[...nodeBuckets].sort(([a],[b])=>a-b).map(([round,rows])=>({round,played:rows.length,wins:rows.filter(row=>row.won).length,meanHpAfter:Number((rows.reduce((sum,row)=>sum+(Number(row.hpAfter)||0),0)/rows.length).toFixed(2)),totalHpLoss:rows.reduce((sum,row)=>sum+(Number(row.hpLoss)||0),0),meanGoldAfter:Number((rows.reduce((sum,row)=>sum+(Number(row.goldAfter)||0),0)/rows.length).toFixed(2)),meanBossHpRemaining:Number((rows.reduce((sum,row)=>sum+(Number(row.bossHp)||0),0)/rows.filter(row=>Number.isFinite(Number(row.bossHp))).length||0).toFixed(2)),bossDamage:rows.reduce((sum,row)=>sum+(Number(row.bossDamage)||0),0),coreDamage:rows.reduce((sum,row)=>sum+(Number(row.coreDamage)||0),0),leaderSurvivals:rows.filter(row=>row.bossId&&Number(row.bossHp)>0).length,leakedBattles:rows.filter(row=>(Number(row.leaked)||0)>0).length,failures:Object.fromEntries([...new Set(rows.map(row=>row.failureReason))].map(reason=>[reason,rows.filter(row=>row.failureReason===reason).length]))}));
  return {schemaVersion:1,seedBase,difficulty,environments:[...environments],policies:[...CAMPAIGN_POLICIES],runs,
    nodeCurve,summary:{runs:runs.length,errors:runs.filter(x=>x.error).length,battleDiagnostics:runs.reduce((n,x)=>n+(x.diagnostics?.battleErrors??0),0),summonAnchorGaps:runs.reduce((n,x)=>n+(x.diagnostics?.summonAnchorGaps?.length??0),0),roleDeficitBattles:runs.reduce((n,x)=>n+(x.rows?.filter(row=>Object.values(row.roleDeficits??{}).some(value=>value>0)).length??0),0),vacantBattleSlots:runs.reduce((n,x)=>n+(x.rows?.reduce((sum,row)=>sum+(row.vacantSlots??0),0)??0),0),antiAirShortBattles:runs.reduce((n,x)=>n+(x.rows?.filter(row=>(row.roleDeficits?.antiAir??0)>0).length??0),0),healerShortBattles:runs.reduce((n,x)=>n+(x.rows?.filter(row=>(row.roleDeficits?.healer??0)>0).length??0),0),hpDepleted:runs.filter(x=>x.terminalReason==='hp-depleted').length,roundLimitLoss:runs.filter(x=>x.terminalReason==='round-limit-loss').length,victories:runs.filter(x=>x.terminalReason==='victory').length,winRate:runs.length?Number((runs.filter(x=>x.terminalReason==='victory').length/runs.length).toFixed(4)):0,truncated,elapsedMs:Date.now()-started}};
}

export function runCampaignMatrix({maxMs=DEFAULT_TIMEOUT,seedBase=0x5245534f}={}){
  const started=Date.now(),runs=[],firstBattles=[];
  let truncated=false;
  for(const env of ENVIRONMENTS)for(const difficulty of DIFFICULTIES){
    if(Date.now()-started>maxMs){truncated=true;break;}
    const seed=seedFor(env,difficulty,seedBase);
    try{const run=runCampaign({environmentId:env,difficulty,seed,maxBattles:1,maxMs:Math.max(1000,maxMs-(Date.now()-started))});firstBattles.push({environmentId:env,difficulty,seed,battles:run.battles,first:run.rows[0]??null,terminalReason:run.terminalReason,diagnostics:run.diagnostics});}
    catch(error){firstBattles.push({environmentId:env,difficulty,seed,error:error.message});}
  }
  for(const env of ENVIRONMENTS){
    if(Date.now()-started>maxMs){truncated=true;break;}
    const seed=seedFor(env,'NORMAL',seedBase+1);
    try{runs.push(runCampaign({environmentId:env,difficulty:'NORMAL',seed,maxMs:Math.max(1000,maxMs-(Date.now()-started))}));}
    catch(error){runs.push({environmentId:env,difficulty:'NORMAL',seed,error:error.message});}
  }
  for(const [index,difficulty]of ['FUNNY','HARD','ABYSS'].entries()){
    if(Date.now()-started>maxMs){truncated=true;break;}
    const env=['origin_kjerag','origin_siracusa','origin_aegir'][index],seed=seedFor(env,difficulty,seedBase+2);
    try{runs.push(runCampaign({environmentId:env,difficulty,seed,maxMs:Math.max(1000,maxMs-(Date.now()-started))}));}
    catch(error){runs.push({environmentId:env,difficulty,seed,error:error.message});}
  }
  const nativeHead=(()=>{try{return execFileSync('git',['-C',ROOT,'rev-parse','HEAD'],{encoding:'utf8'}).trim();}catch{return 'unavailable';}})();
  const workingTree=(()=>{try{return execFileSync('git',['-C',ROOT,'status','--short','--untracked-files=no'],{encoding:'utf8'}).trim()?'dirty-at-run':'clean-at-run';}catch{return 'unavailable';}})();
  const placementRecommendations=[...runs.flatMap(run=>(run.diagnostics?.summonAnchorGaps??[]).map(gap=>({environmentId:run.environmentId,difficulty:run.difficulty,ownerUid:gap.ownerUid,tokenId:gap.tokenId,action:'Reserve a free legal tile in this owner’s native summon range before filling remaining deployment slots; move or bench a non-summoner if that tile would otherwise be occupied.'}))),...firstBattles.flatMap(run=>(run.diagnostics?.summonAnchorGaps??[]).map(gap=>({environmentId:run.environmentId,difficulty:run.difficulty,ownerUid:gap.ownerUid,tokenId:gap.tokenId,action:'Reserve a free legal tile in this owner’s native summon range before filling remaining deployment slots; move or bench a non-summoner if that tile would otherwise be occupied.'})))];
  return {schemaVersion:1,source:{dataDirectory:dataDir,gitHead:nativeHead,workingTree,policy:'deterministic heuristic; results are policy-limited, not win-rate claims'},
    matrix:{environments:ENVIRONMENTS,difficulties:DIFFICULTIES,firstBattleCoverage:firstBattles.length},firstBattles,runs,placementRecommendations,
    summary:{firstBattleRows:firstBattles.length,firstBattleErrors:firstBattles.filter(x=>x.error).length,fullCampaigns:runs.length,
      fullCampaignErrors:runs.filter(x=>x.error).length,totalBattles:runs.reduce((n,x)=>n+(x.battles??0),0)+firstBattles.reduce((n,x)=>n+(x.battles??0),0),
      wins:runs.reduce((n,x)=>n+(x.rows?.filter(row=>row.won).length??0),0)+firstBattles.filter(x=>x.first?.won).length,
      deaths:runs.filter(x=>x.terminalReason==='hp-depleted').length,roundLimitTerminals:runs.filter(x=>x.terminalReason==='round-limit-loss'||x.terminalReason==='victory').length,
      battleDiagnostics:runs.reduce((n,x)=>n+(x.diagnostics?.battleErrors??0),0)+firstBattles.reduce((n,x)=>n+(x.diagnostics?.battleErrors??0),0),
      summonAnchorGaps:runs.reduce((n,x)=>n+(x.diagnostics?.summonAnchorGaps?.length??0),0)+firstBattles.reduce((n,x)=>n+(x.diagnostics?.summonAnchorGaps?.length??0),0),elapsedMs:Date.now()-started,truncated}};
}

function gitRead(args){try{return execFileSync('git',['-C',ROOT,...args],{encoding:'utf8'}).trim();}catch{return 'unavailable';}}
export function compactSeasonCampaignRun(run) {
  const compact=compactEconPactRun(run,{includeAdaptiveDetails:true});
  return {openingId:run.openingId,openingEvent:openingEventView(run.openingId),seasonId:run.seasonId,
    rulesVersion:run.rulesVersion,seed:run.seed,difficulty:run.difficulty,policy:run.policy,phase:run.phase,
    terminalReason:run.terminalReason,round:run.round,hp:run.hp,gold:run.gold,level:run.level,xp:run.xp,
    battles:run.battles,wins:run.rows.filter(row=>row.won).length,losses:run.rows.filter(row=>!row.won).length,
    listConsistent:run.listConsistent,poolConservation:run.poolConservation,starMilestones:run.starMilestones,
    finalStars:Object.fromEntries([1,2,3].map(star=>[star,run.roster.filter(piece=>piece.star===star).length])),
    finalRoster:run.roster,strategies:run.strategies,policyActions:run.policyActions,
    coreSelection:run.coreSelection,copyTargets:run.copyTargets,
    diagnostics:run.diagnostics,nodes:compact.nodes,truncated:run.truncated,elapsedMs:run.elapsedMs};
}
export function runSeasonCampaignMatrix({openings=Object.keys(resonanceOpenings),seedStart=0,searchLimit=10000,
  difficulty='NORMAL',policy=CARRY_ADAPTIVE_POLICY,maxMs=DEFAULT_TIMEOUT,dryRun=false,onProgress=null}={}) {
  if(![ADAPTIVE_STANDARD_POLICY,CARRY_ADAPTIVE_POLICY].includes(policy))throw new Error('season-policy-must-be-adaptive');
  if(!DIFFICULTIES.includes(difficulty))throw new Error('unknown-season-difficulty');
  if(!Number.isFinite(maxMs)||maxMs<=0||maxMs>DEFAULT_TIMEOUT)throw new Error('season-timeout-must-be-within-eight-minutes');
  const started=Date.now(),tasks=selectSeasonCampaignSeeds({openings,seedStart,searchLimit}),runs=[];
  const sourceRevision=gitRead(['rev-parse','HEAD']),sourceStatus=gitRead(['status','--short','--untracked-files=no']);
  let lastProgress=null;
  for(const task of tasks){
    if(Date.now()-started>=maxMs)break;
    try {
      const run=runCampaign({...task,difficulty,policy,rulesVersion:2,balanceProfile:'formal',maxBattles:dryRun?0:Infinity,
        maxMs:maxMs-(Date.now()-started),onProgress:progress=>{lastProgress={...progress,completedRuns:runs.length};onProgress?.(lastProgress);}});
      if(run.openingId!==task.openingId||run.seasonId!==resonanceSeason.id||!run.listConsistent
        ||run.activeOperatorIds.length!==resonanceSeasonOperatorIds.length||run.activeOperatorIds.some((id,index)=>id!==resonanceSeasonOperatorIds[index]))throw new Error('season-list-or-opening-mismatch');
      runs.push(compactSeasonCampaignRun(run));
      onProgress?.({...(lastProgress??{}),completedRuns:runs.length,runCompleted:true,lastCompletedRun:runs.at(-1)});
    }catch(error){runs.push({...task,difficulty,policy,error:error.message,lastProgress});}
    finally{activeProgress=null;activeMetrics=null;activePolicy={id:'legacy',coreOperatorId:null,rushReleased:false};}
  }
  const timedOut=Date.now()-started>=maxMs||runs.some(run=>run.truncated),errors=runs.filter(run=>run.error).length;
  const summary={runs:runs.length,expectedRuns:tasks.length,errors,battles:runs.reduce((n,r)=>n+(r.battles??0),0),
    victories:runs.filter(r=>r.terminalReason==='victory').length,defeats:runs.filter(r=>['hp-depleted','round-limit-loss'].includes(r.terminalReason)).length,
    battleDiagnostics:runs.reduce((n,r)=>n+(r.diagnostics?.battleErrors??0),0),policyErrors:runs.reduce((n,r)=>n+(r.diagnostics?.policyErrors?.length??0),0),
    summonAnchorGaps:runs.reduce((n,r)=>n+(r.diagnostics?.summonAnchorGaps?.length??0),0),
    allListsConsistent:runs.every(r=>r.listConsistent),allPoolsConserved:runs.every(r=>r.poolConservation?.ok),
    allReachedTerminal:!dryRun&&runs.length===tasks.length&&runs.every(r=>r.phase==='complete'&&r.terminalReason),timedOut,elapsedMs:Date.now()-started};
  return {schema:'stronghold.resonance-season-campaign/v1',status:timedOut?'timeout':errors?'failed':dryRun?'dry-run':summary.allReachedTerminal?'complete':'incomplete',
    sourceRevision,sourceWorkingTreeStatus:sourceStatus,pinnedNativeRevision:getSeasonCampaignCatalog(tasks[0].seed).source?.commit??null,
    sourceDirectory:ROOT,dataDirectory:CANONICAL_DATA_DIR,recording:false,difficulty,policy,season:resonanceSeason,
    activeOperatorIds:[...resonanceSeasonOperatorIds],tasks,runs,lastProgress,summary};
}
export function parseSeasonCampaignArguments(args) {
  const options={};const seen=new Set();
  const names={'--opening':'opening','--policy':'policy','--difficulty':'difficulty','--seed-start':'seedStart','--timeout-ms':'maxMs','--output':'output'};
  for(let index=0;index<args.length;index++){
    const arg=args[index];if(seen.has(arg))throw new Error('duplicate-season-option:'+arg);seen.add(arg);
    if(arg==='--season')continue;if(arg==='--dry-run'){options.dryRun=true;continue;}
    if(!names[arg]||!args[index+1]||args[index+1].startsWith('--'))throw new Error('invalid-season-option:'+arg);
    options[names[arg]]=args[++index];
  }
  if(options.opening){options.openings=options.opening==='all'?Object.keys(resonanceOpenings):options.opening.split(',');delete options.opening;}
  if(options.seedStart!==undefined)options.seedStart=Number(options.seedStart);
  if(options.maxMs!==undefined)options.maxMs=Number(options.maxMs);
  options.output??=options.dryRun?SEASON_REPORT.replace(/\.json$/, '-dry-run.json'):SEASON_REPORT;
  return options;
}
function validateSeasonReportPath(output) {
  ensureReportPath();const parent=path.resolve(path.dirname(SEASON_REPORT));
  if(!path.isAbsolute(output)||path.dirname(path.resolve(output)).toLowerCase()!==parent.toLowerCase()||!output.endsWith('.json'))throw new Error('season-report-must-use-fixed-canonical-batch');
  if(fs.existsSync(output)){
    const stat=fs.lstatSync(output);if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink>1)throw new Error('unsafe-season-report:'+output);
    if(JSON.parse(fs.readFileSync(output,'utf8')).schema!=='stronghold.resonance-season-campaign/v1')throw new Error('unknown-existing-season-report:'+output);
  }
}
function seasonReportWrite(result,output) {
  validateSeasonReportPath(output);fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
}
async function boundedSeasonCampaign(options) {
  const maxMs=options.maxMs??DEFAULT_TIMEOUT;
  if(!Number.isFinite(maxMs)||maxMs<=0||maxMs>DEFAULT_TIMEOUT)throw new Error('season-timeout-must-be-within-eight-minutes');
  if(options.dryRun)return runSeasonCampaignMatrix(options);
  return new Promise(resolve=>{
    const started=Date.now();let lastProgress=null,settled=false;const completedRuns=[];
    const worker=new Worker(fileURLToPath(import.meta.url),{workerData:{seasonCampaignOptions:{...options,maxMs}}});
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};
    const timer=setTimeout(async()=>{if(settled)return;settled=true;await worker.terminate();resolve({schema:'stronghold.resonance-season-campaign/v1',status:'timeout',sourceRevision:gitRead(['rev-parse','HEAD']),sourceDirectory:ROOT,dataDirectory:CANONICAL_DATA_DIR,recording:false,runs:completedRuns,lastProgress,summary:{runs:completedRuns.length,timedOut:true,elapsedMs:Date.now()-started,allReachedTerminal:false}});},maxMs);
    worker.on('message',message=>{if(message.type==='progress'){lastProgress=message.progress;if(message.progress.runCompleted)completedRuns.push(message.progress.lastCompletedRun);}else if(message.type==='result')finish(message.result);});
    worker.on('error',error=>finish({schema:'stronghold.resonance-season-campaign/v1',status:'failed',sourceRevision:gitRead(['rev-parse','HEAD']),lastProgress,error:error.message,summary:{errors:1,allReachedTerminal:false,elapsedMs:Date.now()-started}}));
    worker.on('exit',code=>{if(!settled)finish({schema:'stronghold.resonance-season-campaign/v1',status:'failed',lastProgress,error:'season-worker-exit:'+code,summary:{errors:1,allReachedTerminal:false}});});
  });
}
export function compactEconPactRun(run,{includeAdaptiveDetails=false}={}){
  const ledgers=new Map((run.nodeEconomy??[]).map(entry=>[entry.round,entry]));
  const plans=new Map((run.adaptivePlans??[]).map(entry=>[entry.round,entry])),carryPlans=run.carryPlans??{};
  const nodes=run.rows.map(row=>{const money=ledgers.get(row.round)??{},core=row.roster.find(piece=>piece.operatorId===run.designatedCoreId)??null;
    const node={round:row.round,level:row.level,gold:{start:money.goldStart??row.goldBefore,end:money.goldAfter,delta:money.goldDelta??row.goldAfter-row.goldBefore,income:money.settlement?{base:money.settlement.income,win:money.settlement.winBonus,streak:money.settlement.streakBonus,interest:money.settlement.interest,delayed:money.settlement.delayedBonus,strategy:money.settlement.strategyGold,battle:money.settlement.battleGold}:null},actions:money.actions??{},spend:{buy:money.buyGold??0,sellRefund:money.sellRefund??0,xp:money.xpGold??0,refresh:money.refreshGold??0},mainPacts:row.mainPacts,stars:{1:row.roster.filter(piece=>piece.star===1).length,2:row.roster.filter(piece=>piece.star===2).length,3:row.roster.filter(piece=>piece.star===3).length},equipment:row.roster.flatMap(piece=>piece.equipment.map(item=>({unit:piece.name,star:piece.star,item}))),coreStock:row.coreStock??null,deployCellCount:row.deployCellCount??null,core:core?{name:core.name,star:core.star,position:[core.row,core.col],equipment:core.equipment,coveredRoutes:core.coveredRoutes,bossCoverage:row.coreBossCoverage}:null,boss:{id:row.bossId,hpLeft:row.bossHp,damage:row.bossDamage,coreDamage:row.coreDamage,coreAttacks:row.coreAttacks,covered:row.coreBossCoverage},won:row.won,hpLoss:row.hpLoss,hpAfter:row.hpAfter,leaked:row.leaked,capped:row.capped,diagnostics:row.diagnostics,summonAnchorGaps:row.summonAnchorGaps};
    if(includeAdaptiveDetails||run.policy===CARRY_ADAPTIVE_POLICY){node.deployed=row.roster.map(piece=>({uid:piece.uid,operatorId:piece.operatorId,star:piece.star,row:piece.row,col:piece.col,dir:piece.dir,gearIds:piece.equipment}));node.hpPlan=plans.get(row.round)??null;}
    if(run.policy===CARRY_ADAPTIVE_POLICY)node.carry=carryPlans[row.round]??null;
    return node;});
  const coreStarMilestones={2:nodes.find(node=>node.core?.star>=2)?.round??null,3:nodes.find(node=>node.core?.star>=3)?.round??null};
  return {environmentId:run.environmentId,difficulty:run.difficulty,seed:run.seed,policy:run.policy,balanceProfile:run.balanceProfile,designatedCoreId:run.designatedCoreId,coreSelection:run.coreSelection,terminalReason:run.terminalReason,round:run.round,hp:run.hp,gold:run.gold,level:run.level,xp:run.xp,battles:run.battles,policyActions:run.policyActions,coreOffersSeen:run.coreOffersSeen,coreOffersBought:run.coreOffersBought,coreOfferDecisions:run.coreOfferDecisions,coreStarMilestones,carryTransfers:run.carryTransfers??[],diagnostics:run.diagnostics,nodes};
}
export function runEconomyPactValidation({seedBase=0x45434f4e,maxMs=12*60*1000,balanceProfile='formal'}={}){
  const started=Date.now(),environments=['origin_aegir','origin_laterano','origin_kjerag','origin_yan'],sourceBefore={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no']),dataSourceCommit:null};
  const runs=[];for(const environmentId of environments){if(Date.now()-started>=maxMs)break;const seed=seedFor(environmentId,'NORMAL',seedBase);try{const nativeCatalog=getCatalog(environmentId,seed);sourceBefore.dataSourceCommit??=nativeCatalog.source?.commit??null;const run=runCampaign({environmentId,difficulty:'NORMAL',seed,maxMs:Math.max(1000,maxMs-(Date.now()-started)),policy:ECON_PACT_POLICY,balanceProfile});runs.push(compactEconPactRun(run));}catch(error){runs.push({environmentId,difficulty:'NORMAL',seed,policy:ECON_PACT_POLICY,error:error.message});}}
  const sourceAfter={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no'])};
  return {schemaVersion:1,policy:ECON_PACT_POLICY,source:{...sourceBefore,runnerHeadAfter:sourceAfter.runnerHead,runnerStatusAfter:sourceAfter.runnerStatus},seedBase,difficulty:'NORMAL',balanceProfile,environments,runs,summary:{runs:runs.length,expectedRuns:environments.length,errors:runs.filter(run=>run.error).length,battles:runs.reduce((n,run)=>n+run.battles,0),wins:runs.filter(run=>run.terminalReason==='victory').length,hpDepleted:runs.filter(run=>run.terminalReason==='hp-depleted').length,roundLimitLoss:runs.filter(run=>run.terminalReason==='round-limit-loss').length,battleDiagnostics:runs.reduce((n,run)=>n+(run.diagnostics?.battleErrors??0),0),summonAnchorGaps:runs.reduce((n,run)=>n+(run.diagnostics?.summonAnchorGaps?.length??0),0),illegalOrRejectedActions:runs.reduce((n,run)=>n+(run.diagnostics?.policyErrors?.length??0),0),truncated:runs.length!==environments.length||runs.some(run=>run.truncated),elapsedMs:Date.now()-started}};
}
export function runAdaptiveStandardValidation({seedBase=0x45434f4e,maxMs=12*60*1000}={}){
  const started=Date.now(),environments=['origin_aegir','origin_laterano','origin_kjerag','origin_yan'],profiles=['formal','refined-standard'];
  const sourceBefore={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no']),dataSourceCommit:null},runs=[];
  for(const environmentId of environments){
    const seed=seedFor(environmentId,'NORMAL',seedBase);
    for(const balanceProfile of profiles){
      if(Date.now()-started>=maxMs)break;
      try{const nativeCatalog=getCatalog(environmentId,seed);sourceBefore.dataSourceCommit??=nativeCatalog.source?.commit??null;const run=runCampaign({environmentId,difficulty:'NORMAL',seed,maxMs:Math.max(1000,maxMs-(Date.now()-started)),policy:ADAPTIVE_STANDARD_POLICY,balanceProfile});runs.push(compactEconPactRun(run,{includeAdaptiveDetails:true}));}
      catch(error){runs.push({environmentId,difficulty:'NORMAL',seed,policy:ADAPTIVE_STANDARD_POLICY,balanceProfile,error:error.message});}
    }
    if(Date.now()-started>=maxMs)break;
  }
  const sourceAfter={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no'])};
  const profileSummary=Object.fromEntries(profiles.map(profile=>{const subset=runs.filter(run=>run.balanceProfile===profile);return [profile,{runs:subset.length,expectedRuns:environments.length,errors:subset.filter(run=>run.error).length,battles:subset.reduce((n,run)=>n+(run.battles??0),0),wins:subset.filter(run=>run.terminalReason==='victory').length,hpDepleted:subset.filter(run=>run.terminalReason==='hp-depleted').length,roundLimitLoss:subset.filter(run=>run.terminalReason==='round-limit-loss').length,battleDiagnostics:subset.reduce((n,run)=>n+(run.diagnostics?.battleErrors??0),0),summonAnchorGaps:subset.reduce((n,run)=>n+(run.diagnostics?.summonAnchorGaps?.length??0),0),illegalOrRejectedActions:subset.reduce((n,run)=>n+(run.diagnostics?.policyErrors?.length??0),0),truncated:subset.some(run=>run.truncated)}];}));
  return {schemaVersion:1,policy:ADAPTIVE_STANDARD_POLICY,source:{...sourceBefore,runnerHeadAfter:sourceAfter.runnerHead,runnerStatusAfter:sourceAfter.runnerStatus},seedBase,difficulty:'NORMAL',environments,profiles,runs,summary:{runs:runs.length,expectedRuns:environments.length*profiles.length,errors:runs.filter(run=>run.error).length,battles:runs.reduce((n,run)=>n+(run.battles??0),0),wins:runs.filter(run=>run.terminalReason==='victory').length,hpDepleted:runs.filter(run=>run.terminalReason==='hp-depleted').length,roundLimitLoss:runs.filter(run=>run.terminalReason==='round-limit-loss').length,battleDiagnostics:runs.reduce((n,run)=>n+(run.diagnostics?.battleErrors??0),0),summonAnchorGaps:runs.reduce((n,run)=>n+(run.diagnostics?.summonAnchorGaps?.length??0),0),illegalOrRejectedActions:runs.reduce((n,run)=>n+(run.diagnostics?.policyErrors?.length??0),0),truncated:runs.length!==environments.length*profiles.length||runs.some(run=>run.truncated),byProfile:profileSummary,elapsedMs:Date.now()-started}};
}
export function runCarryAdaptiveValidation({seedBase=0x45434f4e,maxMs=12*60*1000}={}){
  const started=Date.now(),environments=['origin_aegir','origin_laterano','origin_kjerag','origin_yan'],profiles=['formal','refined-standard'];
  const sourceBefore={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no']),dataSourceCommit:null},runs=[];
  for(const environmentId of environments){
    const seed=seedFor(environmentId,'NORMAL',seedBase);
    for(const balanceProfile of profiles){
      if(Date.now()-started>=maxMs)break;
      try{const nativeCatalog=getCatalog(environmentId,seed);sourceBefore.dataSourceCommit??=nativeCatalog.source?.commit??null;const run=runCampaign({environmentId,difficulty:'NORMAL',seed,maxMs:Math.max(1000,maxMs-(Date.now()-started)),policy:CARRY_ADAPTIVE_POLICY,balanceProfile});runs.push(compactEconPactRun(run));}
      catch(error){runs.push({environmentId,difficulty:'NORMAL',seed,policy:CARRY_ADAPTIVE_POLICY,balanceProfile,error:error.message});}
    }
    if(Date.now()-started>=maxMs)break;
  }
  const sourceAfter={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no'])};
  const byProfile=Object.fromEntries(profiles.map(profile=>{const subset=runs.filter(run=>run.balanceProfile===profile);return [profile,{runs:subset.length,expectedRuns:environments.length,errors:subset.filter(run=>run.error).length,battles:subset.reduce((n,run)=>n+(run.battles??0),0),wins:subset.filter(run=>run.terminalReason==='victory').length,hpDepleted:subset.filter(run=>run.terminalReason==='hp-depleted').length,roundLimitLoss:subset.filter(run=>run.terminalReason==='round-limit-loss').length,battleDiagnostics:subset.reduce((n,run)=>n+(run.diagnostics?.battleErrors??0),0),summonAnchorGaps:subset.reduce((n,run)=>n+(run.diagnostics?.summonAnchorGaps?.length??0),0),illegalOrRejectedActions:subset.reduce((n,run)=>n+(run.diagnostics?.policyErrors?.length??0),0),truncated:subset.some(run=>run.truncated)}];}));
  return {schemaVersion:1,policy:CARRY_ADAPTIVE_POLICY,source:{...sourceBefore,runnerHeadAfter:sourceAfter.runnerHead,runnerStatusAfter:sourceAfter.runnerStatus},seedBase,difficulty:'NORMAL',environments,profiles,runs,summary:{runs:runs.length,expectedRuns:environments.length*profiles.length,errors:runs.filter(run=>run.error).length,battles:runs.reduce((n,run)=>n+(run.battles??0),0),wins:runs.filter(run=>run.terminalReason==='victory').length,hpDepleted:runs.filter(run=>run.terminalReason==='hp-depleted').length,roundLimitLoss:runs.filter(run=>run.terminalReason==='round-limit-loss').length,battleDiagnostics:runs.reduce((n,run)=>n+(run.diagnostics?.battleErrors??0),0),summonAnchorGaps:runs.reduce((n,run)=>n+(run.diagnostics?.summonAnchorGaps?.length??0),0),illegalOrRejectedActions:runs.reduce((n,run)=>n+(run.diagnostics?.policyErrors?.length??0),0),truncated:runs.length!==environments.length*profiles.length||runs.some(run=>run.truncated),byProfile,elapsedMs:Date.now()-started}};
}
export function runAccessibleStandardValidation({seedBase=0x45434f4e,maxMs=12*60*1000}={}){
  const started=Date.now(),environments=['origin_aegir','origin_laterano','origin_kjerag','origin_yan'];
  const balanceProfile='accessible-standard',sourceBefore={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no']),dataSourceCommit:null},runs=[];
  for(const environmentId of environments){
    if(Date.now()-started>=maxMs)break;
    const seed=seedFor(environmentId,'NORMAL',seedBase);
    try{const nativeCatalog=getCatalog(environmentId,seed);sourceBefore.dataSourceCommit??=nativeCatalog.source?.commit??null;const run=runCampaign({environmentId,difficulty:'NORMAL',seed,maxMs:Math.max(1000,maxMs-(Date.now()-started)),policy:CARRY_ADAPTIVE_POLICY,balanceProfile});runs.push(compactEconPactRun(run));}
    catch(error){runs.push({environmentId,difficulty:'NORMAL',seed,policy:CARRY_ADAPTIVE_POLICY,balanceProfile,error:error.message});}
  }
  const sourceAfter={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no'])};
  return {schemaVersion:1,policy:CARRY_ADAPTIVE_POLICY,source:{...sourceBefore,runnerHeadAfter:sourceAfter.runnerHead,runnerStatusAfter:sourceAfter.runnerStatus},seedBase,difficulty:'NORMAL',balanceProfile,environments,runs,summary:{runs:runs.length,expectedRuns:environments.length,errors:runs.filter(run=>run.error).length,battles:runs.reduce((n,run)=>n+(run.battles??0),0),wins:runs.filter(run=>run.terminalReason==='victory').length,hpDepleted:runs.filter(run=>run.terminalReason==='hp-depleted').length,roundLimitLoss:runs.filter(run=>run.terminalReason==='round-limit-loss').length,battleDiagnostics:runs.reduce((n,run)=>n+(run.diagnostics?.battleErrors??0),0),summonAnchorGaps:runs.reduce((n,run)=>n+(run.diagnostics?.summonAnchorGaps?.length??0),0),illegalOrRejectedActions:runs.reduce((n,run)=>n+(run.diagnostics?.policyErrors?.length??0),0),truncated:runs.length!==environments.length||runs.some(run=>run.truncated),elapsedMs:Date.now()-started}};
}
export function finalFormalValidationTasks(){
  const normalEnvironments=[...ENVIRONMENTS],funnyEnvironments=['origin_aegir','origin_laterano','origin_kjerag','origin_yan'];
  return [...normalEnvironments.map(environmentId=>({environmentId,difficulty:'NORMAL'})),...funnyEnvironments.map(environmentId=>({environmentId,difficulty:'FUNNY'}))];
}
export function finalFunnyValidationTasks(){
  return finalFormalValidationTasks().filter(task=>task.difficulty==='FUNNY');
}
export function runFinalFunnyValidation({seedBase=0x45434f4e,maxMs=8*60*1000}={}){
  const started=Date.now(),tasks=finalFunnyValidationTasks(),environments=tasks.map(task=>task.environmentId);
  const sourceBefore={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no']),dataSourceCommit:null},runs=[];
  for(const {environmentId,difficulty} of tasks){
    if(Date.now()-started>=maxMs)break;
    const seed=seedFor(environmentId,difficulty,seedBase);
    try{
      const nativeCatalog=getCatalog(environmentId,seed);sourceBefore.dataSourceCommit??=nativeCatalog.source?.commit??null;
      const run=runCampaign({environmentId,difficulty,seed,maxMs:Math.max(1000,maxMs-(Date.now()-started)),policy:CARRY_ADAPTIVE_POLICY,balanceProfile:'formal'});
      runs.push({...compactEconPactRun(run),phase:run.phase,roundLimit:run.roundLimit});
    }catch(error){runs.push({environmentId,difficulty,seed,policy:CARRY_ADAPTIVE_POLICY,balanceProfile:'formal',error:error.message});}
  }
  const sourceAfter={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no'])};
  const nodes=runs.flatMap(run=>run.nodes??[]);
  const summary={runs:runs.length,expectedRuns:tasks.length,errors:runs.filter(run=>run.error).length,battles:runs.reduce((n,run)=>n+(run.battles??0),0),victories:runs.filter(run=>run.terminalReason==='victory').length,hpDepleted:runs.filter(run=>run.terminalReason==='hp-depleted').length,roundLimitLoss:runs.filter(run=>run.terminalReason==='round-limit-loss').length,battleDiagnostics:nodes.reduce((n,node)=>n+(node.diagnostics??0),0),summonAnchorGaps:nodes.reduce((n,node)=>n+(node.summonAnchorGaps?.length??0),0),policyErrors:runs.reduce((n,run)=>n+(run.diagnostics?.policyErrors?.length??0),0),cappedBattles:nodes.filter(node=>node.capped).length,truncated:runs.length!==tasks.length||runs.some(run=>run.truncated),elapsedMs:Date.now()-started};
  return {schemaVersion:1,policy:CARRY_ADAPTIVE_POLICY,validation:'final-funny-natural',source:{...sourceBefore,runnerHeadAfter:sourceAfter.runnerHead,runnerStatusAfter:sourceAfter.runnerStatus},normalBaselineReference:{field:'finalFormalNaturalValidation',sourceHead:'0f6716c4357eaa46296b0c92af240a1b6b609a5a',difficulty:'NORMAL',runs:19},seedBase,difficulty:'FUNNY',balanceProfile:'formal',environments,runs,summary};
}
export function runFinalFormalValidation({seedBase=0x45434f4e,maxMs=8*60*1000}={}){
  const started=Date.now(),tasks=finalFormalValidationTasks(),normalEnvironments=tasks.filter(task=>task.difficulty==='NORMAL').map(task=>task.environmentId),funnyEnvironments=tasks.filter(task=>task.difficulty==='FUNNY').map(task=>task.environmentId);
  const sourceBefore={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no']),dataSourceCommit:null},runs=[];
  for(const {environmentId,difficulty} of tasks){
    if(Date.now()-started>=maxMs)break;
    const seed=seedFor(environmentId,difficulty,seedBase);
    try{
      const nativeCatalog=getCatalog(environmentId,seed);sourceBefore.dataSourceCommit??=nativeCatalog.source?.commit??null;
      const run=runCampaign({environmentId,difficulty,seed,maxMs:Math.max(1000,maxMs-(Date.now()-started)),policy:CARRY_ADAPTIVE_POLICY,balanceProfile:'formal'});
      runs.push({...compactEconPactRun(run),phase:run.phase,roundLimit:run.roundLimit});
    }catch(error){runs.push({environmentId,difficulty,seed,policy:CARRY_ADAPTIVE_POLICY,balanceProfile:'formal',error:error.message});}
  }
  const sourceAfter={runnerHead:gitRead(['rev-parse','HEAD']),runnerStatus:gitRead(['status','--short','--untracked-files=no'])};
  const byDifficulty=Object.fromEntries(['NORMAL','FUNNY'].map(difficulty=>{
    const subset=runs.filter(run=>run.difficulty===difficulty),nodes=subset.flatMap(run=>run.nodes??[]);
    return [difficulty,{runs:subset.length,expectedRuns:difficulty==='NORMAL'?normalEnvironments.length:funnyEnvironments.length,errors:subset.filter(run=>run.error).length,battles:subset.reduce((n,run)=>n+(run.battles??0),0),victories:subset.filter(run=>run.terminalReason==='victory').length,hpDepleted:subset.filter(run=>run.terminalReason==='hp-depleted').length,roundLimitLoss:subset.filter(run=>run.terminalReason==='round-limit-loss').length,battleDiagnostics:nodes.reduce((n,node)=>n+(node.diagnostics??0),0),summonAnchorGaps:nodes.reduce((n,node)=>n+(node.summonAnchorGaps?.length??0),0),policyErrors:subset.reduce((n,run)=>n+(run.diagnostics?.policyErrors?.length??0),0),cappedBattles:nodes.filter(node=>node.capped).length,hpCapViolations:nodes.filter(node=>node.hpAfter>100||node.hpAfter<0).length,tileCapViolations:nodes.filter(node=>node.deployed?.length>node.level||node.deployed?.length>node.deployCellCount||new Set((node.deployed??[]).map(piece=>`${piece.row},${piece.col}`)).size!==(node.deployed??[]).length).length,coreStockViolations:nodes.filter(node=>node.coreStock&&(!Number.isInteger(node.coreStock.owned)||!Number.isInteger(node.coreStock.deployed)||!Number.isInteger(node.coreStock.poolRemaining)||node.coreStock.owned<0||node.coreStock.deployed<0||node.coreStock.poolRemaining<0||node.coreStock.deployed>node.coreStock.owned)).length,phaseCounts:Object.fromEntries([...new Set(subset.map(run=>run.phase??'unknown'))].map(phase=>[phase,subset.filter(run=>(run.phase??'unknown')===phase).length])),truncated:subset.length!==(difficulty==='NORMAL'?normalEnvironments.length:funnyEnvironments.length)||subset.some(run=>run.truncated)}];
  }));
  const summary={runs:runs.length,expectedRuns:tasks.length,errors:runs.filter(run=>run.error).length,battles:runs.reduce((n,run)=>n+(run.battles??0),0),victories:runs.filter(run=>run.terminalReason==='victory').length,hpDepleted:runs.filter(run=>run.terminalReason==='hp-depleted').length,roundLimitLoss:runs.filter(run=>run.terminalReason==='round-limit-loss').length,battleDiagnostics:Object.values(byDifficulty).reduce((n,entry)=>n+entry.battleDiagnostics,0),summonAnchorGaps:Object.values(byDifficulty).reduce((n,entry)=>n+entry.summonAnchorGaps,0),policyErrors:Object.values(byDifficulty).reduce((n,entry)=>n+entry.policyErrors,0),cappedBattles:Object.values(byDifficulty).reduce((n,entry)=>n+entry.cappedBattles,0),hpCapViolations:Object.values(byDifficulty).reduce((n,entry)=>n+entry.hpCapViolations,0),tileCapViolations:Object.values(byDifficulty).reduce((n,entry)=>n+entry.tileCapViolations,0),coreStockViolations:Object.values(byDifficulty).reduce((n,entry)=>n+entry.coreStockViolations,0),truncated:runs.length!==tasks.length||runs.some(run=>run.truncated),byDifficulty,elapsedMs:Date.now()-started};
  return {schemaVersion:1,policy:CARRY_ADAPTIVE_POLICY,validation:'final-formal-natural',source:{...sourceBefore,runnerHeadAfter:sourceAfter.runnerHead,runnerStatusAfter:sourceAfter.runnerStatus},seedBase,balanceProfile:'formal',normalEnvironments,funnyEnvironments,difficultyCoverage:{NORMAL:normalEnvironments.length,FUNNY:funnyEnvironments.length},runs,summary};
}
export function appendAdaptiveStandardValidation(result){
  ensureReportPath();const document=fs.existsSync(REPORT)?JSON.parse(fs.readFileSync(REPORT,'utf8')):{};
  const priorAttempts=[...(document.adaptiveStandardNaturalComparison?.priorAttempts??[])];
  if(document.adaptiveStandardNaturalComparison){const {priorAttempts:old,...attempt}=document.adaptiveStandardNaturalComparison;priorAttempts.push(attempt);}
  const formal=document.economyPactNaturalValidation,refined=document.refinedStandardNaturalComparison;
  if(!formal||formal.seedBase!==result.seedBase||formal.runs?.length!==result.environments.length)throw new Error('adaptive-standard-formal-baseline-missing-or-incompatible');
  if(!refined||refined.seedBase!==result.seedBase||refined.runs?.length!==result.environments.length)throw new Error('adaptive-standard-refined-baseline-missing-or-incompatible');
  const summarize=run=>{const last=run?.nodes?.at(-1),nodes=run?.nodes??[];return {terminalReason:run?.terminalReason??null,round:run?.round??null,hp:run?.hp??null,gold:run?.gold??null,level:run?.level??null,battles:run?.battles??null,wins:nodes.filter(node=>node.won).length,firstFailure:nodes.find(node=>!node.won)?.round??null,finalStars:last?.stars??null,mainPacts:last?.mainPacts??[],hpLost:nodes.reduce((sum,node)=>sum+(Number(node.hpLoss)||0),0),leaks:nodes.reduce((sum,node)=>sum+(Number(node.leaked)||0),0),boss:last?.boss??null,core:run?.designatedCoreId?{operatorId:run.designatedCoreId,selection:run.coreSelection,milestones:run.coreStarMilestones,last:last?.core??null}:null};};
  const byPair=new Map(pairAdaptiveStandardRuns(result.runs));
  result.comparison={baselineSources:{econPact:{balanceProfile:formal.balanceProfile,source:formal.source},refinedStandard:{balanceProfile:refined.balanceProfile,source:refined.source}},pairs:result.environments.map(environmentId=>{const adaptiveFormal=byPair.get(`${environmentId}:formal`),adaptiveRefined=byPair.get(`${environmentId}:refined-standard`);const baseFormal=formal.runs.find(run=>run.environmentId===environmentId),baseRefined=refined.runs.find(run=>run.environmentId===environmentId);return {environmentId,seed:adaptiveFormal?.seed??adaptiveRefined?.seed??null,econPactFormal:summarize(baseFormal),econPactRefined:summarize(baseRefined),adaptiveFormal:summarize(adaptiveFormal),adaptiveRefined:summarize(adaptiveRefined)};})};
  document.adaptiveStandardNaturalComparison={...result,priorAttempts};fs.writeFileSync(REPORT,`${JSON.stringify(document,null,2)}\n`,'utf8');return REPORT;
}
export function appendCarryAdaptiveValidation(result){
  ensureReportPath();const document=fs.existsSync(REPORT)?JSON.parse(fs.readFileSync(REPORT,'utf8')):{};
  const previous=document.carryAdaptiveNaturalComparison,priorAttempts=[...(previous?.priorAttempts??[])];
  if(previous){const {priorAttempts:old,...attempt}=previous;priorAttempts.push(attempt);}
  document.carryAdaptiveNaturalComparison={...result,priorAttempts};
  fs.writeFileSync(REPORT,`${JSON.stringify(document,null,2)}\n`,'utf8');return REPORT;
}
export function appendAccessibleStandardValidation(result){
  ensureReportPath();const document=fs.existsSync(REPORT)?JSON.parse(fs.readFileSync(REPORT,'utf8')):{};
  const baseline=document.carryAdaptiveNaturalComparison;
  if(!baseline||baseline.policy!==CARRY_ADAPTIVE_POLICY||baseline.source?.runnerHead!=='b164845f79d2ecfc8064dcdaa664ea79ddc30f08')throw new Error('accessible-standard-carry-formal-baseline-missing-or-wrong-checkpoint');
  const baselineRuns=(baseline.runs??[]).filter(run=>run.balanceProfile==='formal');
  if(baselineRuns.length!==result.environments.length)throw new Error('accessible-standard-formal-baseline-run-count-mismatch');
  const byEnvironment=new Map(baselineRuns.map(run=>[run.environmentId,run]));
  const pairs=result.environments.map(environmentId=>{
    const candidate=result.runs.find(run=>run.environmentId===environmentId),formal=byEnvironment.get(environmentId);
    if(!formal||!candidate||formal.seed!==candidate.seed)throw new Error(`accessible-standard-baseline-pair-missing:${environmentId}`);
    return {environmentId,seed:candidate.seed,baselineSource:{runnerHead:baseline.source.runnerHead,dataSourceCommit:baseline.source.dataSourceCommit},formal:{terminalReason:formal.terminalReason,round:formal.round,hp:formal.hp,gold:formal.gold,level:formal.level,coreStarMilestones:formal.coreStarMilestones,lastNode:formal.nodes?.at(-1)},candidate:{terminalReason:candidate.terminalReason,round:candidate.round,hp:candidate.hp,gold:candidate.gold,level:candidate.level,coreStarMilestones:candidate.coreStarMilestones,lastNode:candidate.nodes?.at(-1),carryTransfers:candidate.carryTransfers,diagnostics:candidate.diagnostics}};
  });
  const previous=document.accessibleStandardNaturalValidation,priorAttempts=[...(previous?.priorAttempts??[])];
  if(previous){const {priorAttempts:old,...attempt}=previous;priorAttempts.push(attempt);}
  document.accessibleStandardNaturalValidation={...result,pairedFormalBaseline:{runnerHead:baseline.source.runnerHead,dataSourceCommit:baseline.source.dataSourceCommit,seedBase:baseline.seedBase},pairs,priorAttempts};
  fs.writeFileSync(REPORT,`${JSON.stringify(document,null,2)}\n`,'utf8');return REPORT;
}
export function appendFinalFormalValidation(result){
  ensureReportPath();const document=fs.existsSync(REPORT)?JSON.parse(fs.readFileSync(REPORT,'utf8')):{};
  const previous=document.finalFormalNaturalValidation,priorAttempts=[...(previous?.priorAttempts??[])];
  if(previous){const {priorAttempts:old,...attempt}=previous;priorAttempts.push(attempt);}
  document.finalFormalNaturalValidation={...result,priorAttempts};
  fs.writeFileSync(REPORT,`${JSON.stringify(document,null,2)}\n`,'utf8');return REPORT;
}
export function appendFinalFunnyValidation(result){
  ensureReportPath();const document=fs.existsSync(REPORT)?JSON.parse(fs.readFileSync(REPORT,'utf8')):{};
  const baseline=document.finalFormalNaturalValidation;
  if(!baseline||baseline.source?.runnerHead!=='0f6716c4357eaa46296b0c92af240a1b6b609a5a'||baseline.runs?.filter(run=>run.difficulty==='NORMAL').length!==19)throw new Error('final-funny-normal-baseline-missing-or-incompatible');
  const previous=document.finalFunnyNaturalValidation,priorAttempts=[...(previous?.priorAttempts??[])];
  if(previous){const {priorAttempts:old,...attempt}=previous;priorAttempts.push(attempt);}
  document.finalFunnyNaturalValidation={...result,priorAttempts};
  fs.writeFileSync(REPORT,`${JSON.stringify(document,null,2)}\n`,'utf8');return REPORT;
}
export function pairAdaptiveStandardRuns(runs){
  const allowed=new Set(['formal','refined-standard']),pairs=new Map();
  for(const run of runs??[]){
    if(!run?.environmentId||!allowed.has(run.balanceProfile))continue;
    pairs.set(`${run.environmentId}:${run.balanceProfile}`,run);
  }
  return [...pairs.entries()];
}
export function appendEconomyPactValidation(result){
  ensureReportPath();const document=fs.existsSync(REPORT)?JSON.parse(fs.readFileSync(REPORT,'utf8')):{};
  const field=result.balanceProfile==='refined-standard'?'refinedStandardNaturalComparison':'economyPactNaturalValidation';
  if(field==='refinedStandardNaturalComparison'){
    const baseline=document.economyPactNaturalValidation;
    if(!baseline||baseline.seedBase!==result.seedBase||baseline.policy!==result.policy||baseline.runs?.length!==result.environments.length)throw new Error('refined-standard-baseline-missing-or-incompatible');
    const baselineByEnv=new Map(baseline.runs.map(run=>[run.environmentId,run]));
    const summarize=run=>{
      const nodes=run?.nodes??[];
      const last=nodes.at(-1);
      const incomeKeys=['base','win','streak','interest','delayed','strategy','battle'];
      const income=Object.fromEntries(incomeKeys.map(key=>[key,nodes.reduce((sum,node)=>sum+(Number(node.gold?.income?.[key])||0),0)]));
      const spend={buy:nodes.reduce((sum,node)=>sum+(Number(node.spend?.buy)||0),0),xp:nodes.reduce((sum,node)=>sum+(Number(node.spend?.xp)||0),0),refresh:nodes.reduce((sum,node)=>sum+(Number(node.spend?.refresh)||0),0)};
      const stars=last?.stars??null;
      return {terminalReason:run?.terminalReason??null,round:run?.round??null,hp:run?.hp??null,level:run?.level??null,gold:run?.gold??null,battles:run?.battles??null,wins:nodes.filter(node=>node.won).length,income,spend,finalStars:stars,finalMainPacts:last?.mainPacts??null,core:run?.designatedCoreId?{id:run.designatedCoreId,selection:run.coreSelection??null,milestones:run.coreStarMilestones??null,last:last?.core??null}:null,defense:{hpLost:nodes.reduce((sum,node)=>sum+(Number(node.hpLoss)||0),0),leaks:nodes.reduce((sum,node)=>sum+(Number(node.leaked)||0),0)},boss:last?.boss??null};};
    result.comparison={baseline:{field:'economyPactNaturalValidation',balanceProfile:baseline.balanceProfile,seedBase:baseline.seedBase,source:baseline.source},runs:result.runs.map(candidate=>{const prior=baselineByEnv.get(candidate.environmentId);return {environmentId:candidate.environmentId,seed:candidate.seed,baseline:summarize(prior),candidate:summarize(candidate)};})};
  }
  const previous=document.economyPactNaturalValidation,priorAttempts=[...(previous?.priorAttempts??[])];
  if(previous){const {priorAttempts:prior,...attempt}=previous;priorAttempts.push(attempt);}
  if(field==='economyPactNaturalValidation')document[field]={...result,priorAttempts};
  else {const prior=document[field]?.priorAttempts??[];if(document[field]){const {priorAttempts:old,...attempt}=document[field];prior.push(attempt);}document[field]={...result,priorAttempts:prior};}
  fs.writeFileSync(REPORT,`${JSON.stringify(document,null,2)}\n`,'utf8');return REPORT;
}

function ensureReportPath(){
  let current='E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
  for(const part of ['.omni','tmp','resonance']){current=path.join(current,part);if(fs.existsSync(current)){const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error(`unsafe-report-ancestor:${current}`);}else fs.mkdirSync(current);}
}
if(!isMainThread&&workerData?.seasonCampaignOptions){
  let lastNotice=0;
  const result=runSeasonCampaignMatrix({...workerData.seasonCampaignOptions,onProgress:progress=>{
    if(progress.runCompleted||progress.action==='fight'||Date.now()-lastNotice>=250){lastNotice=Date.now();parentPort.postMessage({type:'progress',progress});}
  }});
  parentPort.postMessage({type:'result',result});
}
const isMain=isMainThread&&process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
  if(process.argv.includes('--prototype-native-final-fixture')){
    try{
      const seedArg=process.argv.indexOf('--seed'),timeoutArg=process.argv.indexOf('--timeout-ms');
      const seed=seedArg>=0?Number(process.argv[seedArg+1]):1,maxMs=timeoutArg>=0?Number(process.argv[timeoutArg+1]):3*60*1000;
      if(!Number.isSafeInteger(seed)||seed<0||!Number.isFinite(maxMs)||maxMs<=0)throw new Error('invalid-prototype-native-fixture-options');
      const result=capturePrototypeNativeFinalFixture({seed,maxMs});
      console.log(JSON.stringify({report:result.report,...result.fixture},null,2));
      if(result.fixture.status!=='captured')process.exitCode=1;
    }catch(error){console.error(JSON.stringify({status:'failed',error:error.message,report:NATURAL_V3_REPORT}));process.exitCode=1;}
  }else if(process.argv.includes('--prototype-natural-validation')){
    try{
      const seedArg=process.argv.indexOf('--seed'),timeoutArg=process.argv.indexOf('--timeout-ms');
      const seed=seedArg>=0?Number(process.argv[seedArg+1]):1,maxMs=timeoutArg>=0?Number(process.argv[timeoutArg+1]):10*60*1000;
      if(!Number.isSafeInteger(seed)||seed<0||!Number.isFinite(maxMs)||maxMs<=0)throw new Error('invalid-prototype-natural-validation-options');
      const result=runPrototypeNaturalCampaignBatch({seed,maxMs});
      console.log(JSON.stringify({report:result.report,status:result.batch.status,elapsedMs:result.batch.elapsedMs,summary:result.batch.summary},null,2));
      if(result.batch.status!=='complete'||result.batch.summary.errors.length||result.batch.summary.battleErrors||result.batch.summary.summonAnchorGaps||result.batch.summary.policyErrors||!result.batch.summary.victories.length)process.exitCode=1;
    }catch(error){console.error(JSON.stringify({status:'failed',error:error.message,report:NATURAL_V3_REPORT}));process.exitCode=1;}
  }else if(process.argv.includes('--season')){
    let options;
    try {
      options=parseSeasonCampaignArguments(process.argv.slice(2));
      validateSeasonReportPath(options.output);
      const result=await boundedSeasonCampaign(options);seasonReportWrite(result,options.output);
      console.log(JSON.stringify({report:options.output,status:result.status,...result.summary,sourceRevision:result.sourceRevision,dataDirectory:CANONICAL_DATA_DIR}));
      if(result.status==='failed'||result.status==='timeout'||!options.dryRun&&(!result.summary.allReachedTerminal||result.summary.battleDiagnostics||result.summary.policyErrors||result.summary.summonAnchorGaps||!result.summary.allPoolsConserved||!result.summary.allListsConsistent))process.exitCode=1;
    }catch(error){console.error(JSON.stringify({status:'failed',error:error.message,report:options?.output??null}));process.exitCode=1;}
  }else if(process.argv.includes('--final-funny-validation')){
    const result=runFinalFunnyValidation();const report=appendFinalFunnyValidation(result);console.log(JSON.stringify({report,...result.summary,source:result.source},null,2));
    if(result.summary.runs!==result.summary.expectedRuns||result.summary.errors||result.summary.battleDiagnostics||result.summary.summonAnchorGaps||result.summary.policyErrors||result.summary.cappedBattles||result.summary.truncated)process.exitCode=1;
  }else if(process.argv.includes('--final-formal-validation')){
    const result=runFinalFormalValidation();const report=appendFinalFormalValidation(result);console.log(JSON.stringify({report,...result.summary,source:result.source},null,2));
    if(result.summary.runs!==result.summary.expectedRuns||result.summary.errors||result.summary.battleDiagnostics||result.summary.summonAnchorGaps||result.summary.policyErrors||result.summary.cappedBattles||result.summary.hpCapViolations||result.summary.tileCapViolations||result.summary.coreStockViolations||result.summary.truncated)process.exitCode=1;
  }else if(process.argv.includes('--accessible-standard-validation')){
    const result=runAccessibleStandardValidation();const report=appendAccessibleStandardValidation(result);console.log(JSON.stringify({report,...result.summary,source:result.source},null,2));
    if(result.summary.runs!==result.summary.expectedRuns||result.summary.errors||result.summary.battleDiagnostics||result.summary.summonAnchorGaps||result.summary.illegalOrRejectedActions||result.summary.truncated)process.exitCode=1;
  }else if(process.argv.includes('--carry-adaptive-validation')){
    const result=runCarryAdaptiveValidation();const report=appendCarryAdaptiveValidation(result);console.log(JSON.stringify({report,...result.summary,source:result.source},null,2));
    if(result.summary.runs!==result.summary.expectedRuns||result.summary.errors||result.summary.battleDiagnostics||result.summary.summonAnchorGaps||result.summary.illegalOrRejectedActions||result.summary.truncated)process.exitCode=1;
  }else if(process.argv.includes('--adaptive-standard-validation')){
    const result=runAdaptiveStandardValidation();const report=appendAdaptiveStandardValidation(result);console.log(JSON.stringify({report,...result.summary,source:result.source},null,2));
    if(result.summary.runs!==result.summary.expectedRuns||result.summary.errors||result.summary.battleDiagnostics||result.summary.summonAnchorGaps||result.summary.illegalOrRejectedActions||result.summary.truncated)process.exitCode=1;
  }else if(process.argv.includes('--econ-pact-validation')||process.argv.includes('--refined-standard-validation')){
    const balanceProfile=process.argv.includes('--refined-standard-validation')?'refined-standard':'formal';
    const result=runEconomyPactValidation({balanceProfile});const report=appendEconomyPactValidation(result);console.log(JSON.stringify({report,...result.summary,source:result.source},null,2));
    if(result.summary.runs!==result.summary.expectedRuns||result.summary.errors||result.summary.battleDiagnostics||result.summary.summonAnchorGaps)process.exitCode=1;
  }else{
    const maxMs=Number(process.env.SP_RESONANCE_BALANCE_TIMEOUT_MS??DEFAULT_TIMEOUT);
    const result=runCampaignMatrix({maxMs:Number.isFinite(maxMs)&&maxMs>0?maxMs:DEFAULT_TIMEOUT});
    ensureReportPath();fs.writeFileSync(REPORT,`${JSON.stringify(result,null,2)}\n`,'utf8');
    console.log(JSON.stringify({report:REPORT,...result.summary},null,2));
    if(result.summary.firstBattleErrors||result.summary.fullCampaignErrors||result.summary.battleDiagnostics)process.exitCode=1;
  }
}
