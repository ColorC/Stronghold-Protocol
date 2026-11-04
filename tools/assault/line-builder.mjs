// P4.2: deterministic test-player decisions only. No game data or battle rules.
import fs from 'node:fs';
import {activePieceLimit,piecePopulationCost} from '../../shared/assault/inventory.js';
import {ownerRangeKeys} from '../../server/match/board.js';
import {assaultNativeDirection} from '../../shared/assault/battle-input.js';

export const lineBuilds=JSON.parse(fs.readFileSync(new URL('./line-builds.json',import.meta.url),'utf8'));
const system=JSON.parse(fs.readFileSync(new URL('../../data/assault-design/system.json',import.meta.url),'utf8'));
for(const director of system.directors)lineBuilds.lines[director.id].core=[...director.coreCharIds];
export function lineFor(state,ctx,reports){
 const id=reports?.get(state.runId)?.directorId??state.directorId;
 const director=ctx.design.system.directors.find(d=>d.id===id);
 if(!director||!lineBuilds.lines[id])throw Error(`Missing line for ${id}`);
 return {...lineBuilds.lines[id],core:director.coreCharIds,leaderCharId:director.leaderCharId};
}
export function ownThemeShopScore(state,node,ctx){
 if(node?.kind!=='shop')return 0;
 const director=ctx.design.system.directors.find(d=>d.id===state.directorId);
 const definition=ctx.design.system.shopDefinitions.find(s=>s.id===node.shopId);
 return director&&definition?.filter?.type==='faction'&&definition.filter.value===director.themeFaction?100:0;
}
const members=line=>new Set(line.members??[...line.core,...line.producers,...line.consumers,...line.finishers]);
export function isLineMember(body,line){return members(line).has(body.charId)||(body.tags??[]).includes(line.faction);}
export function eventPairs(body,held,runtime){
 const a=body.adaptation;return held.reduce((sum,p)=>{
  const b=runtime.bodies[p.charId].adaptation;
  return sum+(a.produces??[]).filter(e=>(b.consumes??[]).includes(e)).length
   +(a.consumes??[]).filter(e=>(b.produces??[]).includes(e)).length;
 },0);
}
export function linePurchaseScore(state,slot,ctx,line){
 if(slot.price>state.gold)return null;
 const body=ctx.runtime.bodies[slot.purchaseCharId];if(!body)return null;
 const leader=slot.purchaseCharId===line.leaderCharId?5:0;
 const merge=state.pieces.some(p=>p.purchaseCharId===slot.purchaseCharId&&p.star===slot.star&&p.star<4)?4:0;
 const member=isLineMember(body,line)?3:0;
 const pairs=eventPairs(body,state.pieces,ctx.runtime)*2;
 return {score:leader+merge+member+pairs+slot.star,leader,merge,member,pairs,star:slot.star};
}
export function buyOperatorV3(state,previewOnly,{ctx,act,previewAction,reportByRun,recordBuyerDecision}){
 if(state.shop.kind&&state.shop.kind!=='operator'&&!state.shop.slots.some(slot=>slot.purchaseCharId))return state;
 const line=lineFor(state,ctx,reportByRun),candidates=[];
 for(const slot of state.shop.slots){
  const score=linePurchaseScore(state,slot,ctx,line);if(!score)continue;
  try{const next=previewAction(state,'buy',{slotId:slot.slotId}).state;candidates.push({slot,...score,next});}
  catch(e){if(!['BENCH_FULL','POPULATION_FULL','SOURCE_CAP'].includes(e.code))throw e;}
 }
 candidates.sort((a,b)=>b.score-a.score||a.slot.price-b.slot.price||a.slot.slotId.localeCompare(b.slot.slotId));
 const best=candidates[0];if(!best)return state;
 if(!previewOnly)recordBuyerDecision(state,{slotId:best.slot.slotId,reason:'line-builder/v3',score:best.score,terms:{leader:best.leader,merge:best.merge,member:best.member,pairs:best.pairs,star:best.star}});
 return previewOnly?best.next:act(state,'buy',{slotId:best.slot.slotId});
}
export function chooseUpgradeV3(state,{ctx,act,viewRun,reportByRun}){
 const reward=viewRun(state,ctx).upgradeRewards,choices=reward?.choices??[];
 if(!choices.length)return act(state,'skipUpgradeReward');
 const line=lineFor(state,ctx,reportByRun);
 const score=p=>(p.purchaseCharId===line.leaderCharId?100:0)+(line.core.includes(p.charId)?30:0)
  +(isLineMember(ctx.runtime.bodies[p.charId],line)?10:0)+eventPairs(ctx.runtime.bodies[p.charId],state.pieces.filter(x=>x.uid!==p.uid),ctx.runtime)-p.star;
 choices.sort((a,b)=>score(state.pieces.find(p=>p.uid===b))-score(state.pieces.find(p=>p.uid===a))||a.localeCompare(b));
 reportByRun.get(state.runId)?.upgradeObservations?.push({day:state.day,hour:state.hour,chosenUid:choices[0],policy:'line-builder/v3'});
 return act(state,'chooseUpgrade',{uid:choices[0]});
}
export function chooseLineupV3(state,encounter,{ctx,roleSet,routeSamplesFor,reportByRun}){
 const line=lineFor(state,ctx,reportByRun),popLimit=activePieceLimit(state,ctx),dpLimit=encounter.wave.dp.init+encounter.wave.dp.perSec*120;
 const lineup=[];let pop=0,dp=0;
 const fits=p=>!lineup.some(x=>x.uid===p.uid)&&pop+piecePopulationCost(p,ctx)<=popLimit&&dp+ctx.runtime.bodies[p.charId].baseStats.cost<=dpLimit;
 const add=p=>{lineup.push(p);pop+=piecePopulationCost(p,ctx);dp+=ctx.runtime.bodies[p.charId].baseStats.cost;};
 for(const id of line.core){const p=state.pieces.filter(p=>p.charId===id&&fits(p)).sort((a,b)=>b.star-a.star||a.uid.localeCompare(b.uid))[0];if(p)add(p);}
 while(true){
  const choices=state.pieces.filter(fits);if(!choices.length)break;
  const covered={healer:lineup.some(p=>roleSet(p,state,encounter).healer),blocker:lineup.some(p=>roleSet(p,state,encounter).blocker)};
  const score=p=>{const b=ctx.runtime.bodies[p.charId],role=roleSet(p,state,encounter);return eventPairs(b,lineup,ctx.runtime)*2
   +(isLineMember(b,line)?3:0)+p.star+(!covered.healer&&role.healer?8:0)+(!covered.blocker&&role.blocker?4:0);};
  choices.sort((a,b)=>score(b)-score(a)||a.uid.localeCompare(b.uid));add(choices[0]);
 }
 const route=routeSamplesFor(state,encounter);
 return{lineup,popLimit,dpLimit,flightThreat:route.routeThreats.some(r=>r.flight),unblockableThreat:route.routeThreats.some(r=>r.unblockable)};
}
export function moduleForLine(state,piece,ctx,reports){
 const line=lineFor(state,ctx,reports),body=ctx.runtime.bodies[piece.charId];
 const keys=line.moduleKeywords;
 return body.modulePlans.map((module,index)=>({module,index,score:keys.includes(module.keyword)?100-keys.indexOf(module.keyword):module.source?.table==='character_table.json'?2:0}))
  .sort((a,b)=>b.score-a.score||a.index-b.index)[0].module;
}
export function adjacencyBonus(piece,{row,col,placements,ctx}){
 const accepts=(actor,target)=>{
  const rule=lineBuilds.adjacencyLinks[actor.charId],body=ctx.runtime.bodies[target.charId];
  return rule&&actor.uid!==target.uid&&(!rule.profession||body.profession===rule.profession)
   &&(!rule.ammo||body.adaptation.type==='D')&&(rule.resource||body.fixedSkill.kind!=='passive');
 };
 const here={...piece,row,col};let score=0;
 for(const other of placements){
  if(Math.abs(row-other.row)+Math.abs(col-other.col)!==1)continue;
  if(accepts(here,other))score+=100;
  if(accepts(other,here))score+=100;
 }
 return score;
}
export function placementBonus(state,piece,{row,col,range,placements,ctx,paired=false}){
 const bonus=paired?adjacencyBonus(piece,{row,col,placements,ctx}):0;
 const svash=placements.find(p=>p.charId==='char_1045_svash2');
 if(!svash||piece.charId===svash.charId)return bonus;
 const plan=ctx.runtime.bodies[piece.charId].adaptation;if(!plan.nativeDeploy&&!plan.produces.includes('deployment'))return bonus;
 const owner=ctx.runtime.bodies[svash.charId],echo=ownerRangeKeys(owner.adaptation.rangeGrid,svash.row,svash.col,assaultNativeDirection(svash.dir));
 return bonus+(echo.has(`${row},${col}`)?500:0);
}
export function manualSummonScore(state,piece,option,tile,samples,ctx){
 if(piece.charId==='char_1041_angel2'){
  const front=samples.filter(s=>s.boss).slice(0,4);const pool=front.length?front:samples.slice(0,4);
  return -Math.min(...pool.map(s=>Math.abs(s.row-tile[0])+Math.abs(s.col-tile[1])))*1000;
 }
 if(option.tokenId==='token_10027_ironmn_pile2'){
  const core=state.pieces.filter(p=>p.row!=null&&p.uid!==piece.uid&&ctx.runtime.bodies[p.charId].fixedSkill.kind!=='passive');
  return Math.max(0,...core.map(p=>Math.abs(p.row-tile[0])+Math.abs(p.col-tile[1])===1?1000+p.star*10:0));
 }
 return 0;
}
