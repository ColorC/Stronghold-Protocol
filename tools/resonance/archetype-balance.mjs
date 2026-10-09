import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { getResonanceField, resolveEnemyBalance, runResonanceBattle } from '../../server/modes/resonance/battle.js';
import { createSession } from '../../server/modes/resonance/session.js';
import { canPlace, ownerRangeKeys, positionClass } from '../../server/match/board.js';
import { GEO } from '../../shared/constants.js';
import { Grid } from '../../server/sim/grid.js';
import { canBlockGround, canOperatorUseTile, directionToward } from './balance-campaign.mjs';

export const DATA_DIR='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data';
export const REPORT='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/resonance/archetype-balance.json';
export const ARCHETYPES=[
 {id:'low-cost',env:'origin_laterano',core:'隐现',include:['古米','清流','能天使','跃跃','角峰'],optional:['莫斯提马','薄绿','海霓'],pact:'laterano'},
 {id:'ammo',env:'origin_laterano',core:'新约能天使',include:['圣约送葬人','古米'],optional:['能天使','灰毫','送葬人'],pact:'ammo'},
 {id:'snow',env:'origin_kjerag',core:'圣聆初雪',include:['初雪','锏','古米'],optional:['灵知','凛冬'],pact:'yela'},
 {id:'aegir-counter',env:'origin_aegir',core:'乌尔比安',include:['浊心斯卡蒂','归溟幽灵鲨','古米'],optional:['歌蕾蒂娅','幽灵鲨'],pact:'aegir'},
 {id:'yan-skills',env:'origin_yan',core:'令',include:['黍','重岳','古米'],optional:['余','夕','年'],pact:'sui'},
 {id:'columbia-constructs',env:'origin_columbia',core:'多萝西',include:['涤火杰西卡','古米'],optional:['缪尔赛思','山','阿罗玛','罗比菈塔'],pact:'creation'},
 {id:'kazimierz-true-damage',env:'origin_kazimierz',core:'玛恩纳',include:['耀骑士临光','灰毫','古米'],optional:['焰尾','临光'],pact:'kazimierz'},
 {id:'siracusa-execution',env:'origin_siracusa',core:'荒芜拉普兰德',include:['斥罪','贝洛内','古米'],optional:['拉普兰德','德克萨斯'],pact:'siracusa'},
 {id:'sui-trio',env:'origin_yan',core:'黍',include:['令','重岳','古米'],optional:['余','夕','年'],pact:'sui'},
 {id:'element-burn-necrosis',env:'origin_rhodes',core:'烛煌',include:['塑心','妮芙','菲莱','古米'],optional:['焰影苇草','泥岩','清流'],pact:'necrosis'},
];
export const SCENARIO_CONFIGS=[
 {round:12,level:6,assistantStar:2,gearIds:[],phase:'mid-upper-bound'},
 {round:12,level:7,assistantStar:2,gearIds:[],phase:'mid-upper-bound'},
 {round:20,level:8,assistantStar:2,gearIds:['plate','staff'],phase:'late'},
 {round:20,level:9,assistantStar:2,gearIds:['plate','staff'],phase:'late'},
 {round:28,level:10,assistantStar:2,gearIds:['giantSlayer','spellblade','rapidBlade'],phase:'terminal'},
];
const rosterName=(op)=>op.name;
function opNamed(catalog,name){return Object.values(catalog.operators).find(x=>x.name===name);}
export function makeArchetypeRoster(catalog,definition,level,coreStar=2,assistantStar=2,frontlineCount=2,completeMainPact=false){
 const active=new Set(catalog.config.activeOperatorIds), core=opNamed(catalog,definition.core);
 if(!core||!active.has(core.id))throw new Error(`archetype-core-not-active:${definition.id}:${definition.core}`);
 const required=definition.include.map(name=>opNamed(catalog,name));
 if(required.some(op=>!op||!active.has(op.id)))throw new Error(`required-operator-outside-65-pool:${definition.id}:${definition.include.filter((name,i)=>!required[i]||!active.has(required[i].id)).join(',')}`);
 const chosen=[core,...required.filter(op=>op.id!==core.id)];
 if(chosen.length>level)throw new Error(`required-roster-over-level:${definition.id}:${chosen.length}:${level}`);
 if(completeMainPact){const maxTier=catalog.pacts[definition.pact]?.thresholds?.at(-1)??0,requiredNatural=Math.max(0,maxTier-2);let count=new Set(chosen.filter(op=>op.pacts?.includes(definition.pact)).map(op=>op.charId)).size;for(const op of Object.values(catalog.operators).filter(x=>active.has(x.id)&&(x.pacts??[]).includes(definition.pact)&&!chosen.some(y=>y.id===x.id)).sort((a,b)=>a.cost-b.cost||a.name.localeCompare(b.name))){if(count>=requiredNatural||chosen.length>=level)break;if(op.role==='healer'&&chosen.filter(x=>x.role==='healer').length>=2)continue;chosen.push(op);count=new Set(chosen.filter(x=>x.pacts?.includes(definition.pact)).map(x=>x.charId)).size;}}
 const addRole=(role,target)=>{while(chosen.filter(op=>op.role===role).length<target&&chosen.length<level){const op=Object.values(catalog.operators).find(x=>active.has(x.id)&&x.role===role&&!chosen.some(y=>y.id===x.id));if(!op)break;chosen.push(op);}};
 addRole('healer',1);addRole('frontline',frontlineCount);
 const combatRoleCount=()=>chosen.filter(op=>['damage','control','summoner'].includes(op.role)).length;
 addRole('damage',Math.max(0,2-combatRoleCount()));
 if(chosen.length<level&&combatRoleCount()<2){const op=Object.values(catalog.operators).find(x=>active.has(x.id)&&['damage','control','summoner'].includes(x.role)&&!chosen.some(y=>y.id===x.id));if(op)chosen.push(op);}
 if(completeMainPact)for(const op of Object.values(catalog.operators).filter(x=>active.has(x.id)&&(x.pacts??[]).includes(definition.pact)&&!chosen.some(y=>y.id===x.id)).sort((a,b)=>a.cost-b.cost||a.name.localeCompare(b.name)))if(chosen.length<level&&(op.role!=='healer'||chosen.filter(x=>x.role==='healer').length<2))chosen.push(op);
 for(const name of definition.optional??[]){if(chosen.length>=level)break;const op=opNamed(catalog,name);if(op&&active.has(op.id)&&!chosen.some(x=>x.id===op.id))chosen.push(op);}
 if(!completeMainPact)for(const op of Object.values(catalog.operators).filter(x=>active.has(x.id)&&(x.pacts??[]).includes(definition.pact)&&!chosen.some(y=>y.id===x.id)).sort((a,b)=>a.cost-b.cost))if(chosen.length<level&&(op.role!=='healer'||chosen.filter(x=>x.role==='healer').length<2))chosen.push(op);
 const roleOrder=['damage','control','summoner','support'];
 for(const role of roleOrder)if(chosen.length<level){const op=Object.values(catalog.operators).find(x=>active.has(x.id)&&x.role===role&&!chosen.some(y=>y.id===x.id));if(op)chosen.push(op);}
 for(const op of Object.values(catalog.operators).filter(x=>active.has(x.id)&&x.cost<=3).sort((a,b)=>a.cost-b.cost))if(chosen.length<level&&!chosen.some(x=>x.id===op.id))chosen.push(op);
 for(const op of Object.values(catalog.operators).filter(x=>active.has(x.id)).sort((a,b)=>a.cost-b.cost))if(chosen.length<level&&!chosen.some(x=>x.id===op.id))chosen.push(op);
 if(chosen.filter(op=>op.role==='frontline').length<frontlineCount||chosen.filter(op=>op.role==='healer').length<1||combatRoleCount()<2)throw new Error(`role-coverage-unavailable:${definition.id}:L${level}:front${frontlineCount}`);
 const roster=chosen.map(op=>({operatorId:op.id,name:rosterName(op),role:op.role,star:op.id===core.id?coreStar:assistantStar,equipment:[],extraPacts:[],growth:{}}));
 if(!roster.some(x=>x.operatorId===core.id))throw new Error(`core-omitted:${definition.id}`);
 return roster;
}
export function routeSet(field){
 const unique=new Map();
 const sourceRoutes=[...(field.wave?.routes??[]),...(field.wave?.extraRoutes??[])];
 const activeRouteIndices=new Set((field.wave?.spawns??[]).map(spawn=>spawn.routeIndex).filter(Number.isInteger));
 const rect=String(field.field??'normal').startsWith('boss')?GEO.BOSS_RECT:GEO.NORMAL_RECT;
 const grid=field.stage?new Grid(field.stage,rect):null;
 const getCheckpoint=(cp)=>Array.isArray(cp)?cp:Array.isArray(cp?.pos)?cp.pos:Array.isArray(cp?.p)?cp.p:null;
 for(const [originalIndex,route] of sourceRoutes.entries()){
  if(activeRouteIndices.size&&!activeRouteIndices.has(originalIndex))continue;
  const checkpoints=(route.checkpoints??[]).map(getCheckpoint).filter(Boolean);
  const stepPoints=(route.steps??[]).filter(s=>['move','patrol','appear'].includes(String(s.t??'').toLowerCase())).map(s=>getCheckpoint(s)).filter(Boolean);
  const anchors=[route.start,...(checkpoints.length?checkpoints:stepPoints),route.end].filter(p=>Array.isArray(p)&&p.length===2);
  if(anchors.length<2)continue;
  let points=[],source='wave-route-waypoints';
  if(route.motion==='WALK'){
   const key=`${anchors[0].join(',')}->${anchors.at(-1).join(',')}`;
   const direct=checkpoints.length===0&&stepPoints.length===0?(field.stage?.groundPathsWithDevices?.[key]??field.stage?.groundPaths?.[key]??[]):[];
   if(direct.length){points=direct;source=field.stage?.groundPathsWithDevices?.[key]?'groundPathsWithDevices':'groundPaths';}
   else if(grid){
    const legs=[];
    for(let i=1;i<anchors.length;i++){
     const leg=grid.findPath(anchors[i-1][0],anchors[i-1][1],anchors[i][0],anchors[i][1])??grid.findPath(anchors[i-1][0],anchors[i-1][1],anchors[i][0],anchors[i][1],{ignoreObstacles:true});
     if(!leg?.length){legs.length=0;break;}
     legs.push(...(i===1?leg:leg.slice(1)));
    }
    if(legs.length){points=legs;source='native-grid-route';}
    else points=[...new Map(anchors.map(p=>[p.join(','),p])).values()];
   } else points=[...new Map(anchors.map(p=>[p.join(','),p])).values()];
  } else points=[...new Map(anchors.map(p=>[p.join(','),p])).values()];
  if(field.field==='bossL'||field.field==='bossR')points=points.map(([r,c])=>[r+7,field.field==='bossR'?19-c:c]);
  const signature=JSON.stringify([route.motion,points]);if(!unique.has(signature))unique.set(signature,{motion:route.motion,points,source,originalIndices:[]});unique.get(signature).originalIndices.push(originalIndex);
 }
 return [...unique.values()];
}
function routeDistance(cell,route){return Math.min(...route.points.map(([r,c])=>Math.abs(cell.row-r)+Math.abs(cell.col-c)));}
function opRange(op,star){const record=op.stars[star].record;return record.rangeGrid?.length?record.rangeGrid:op.source?.normalChess?.rangeGrid??[[0,0]];}
function coveredRouteIds(op,star,cell,dir,routes){const keys=ownerRangeKeys(opRange(op,star),cell.row,cell.col,dir);return routes.map((route,index)=>route.points.some(([r,c])=>keys.has(`${r},${c}`))?index:null).filter(index=>index!==null);}
const DIRECTIONS=['UP','RIGHT','DOWN','LEFT'];
function putOnField(data,state,field,catalog,roster,cfg,pactId){
 const entries=[...field.deployMap.keys()].map(key=>({key,row:+key.split(',')[0],col:+key.split(',')[1]}));
 const legal=new Set(field.deployMap.keys()),used=new Set(),reservedSummon=new Set(),routePaths=routeSet(field),bossOriginalIndices=new Set((field.wave?.spawns??[]).filter(spawn=>spawn.tag==='boss').map(spawn=>spawn.routeIndex).filter(Number.isInteger)),allRoutes=routePaths;
 const isBossRoute=route=>route.originalIndices?.some(routeIndex=>bossOriginalIndices.has(routeIndex));
 const groundRoutes=routePaths.filter(route=>route.motion==='WALK'&&!isBossRoute(route));
 const pieces=roster.map((unit,i)=>({...unit,uid:`scenario-${cfg.round}-${cfg.level}-${i}-${unit.operatorId}`,row:null,col:null,dir:'RIGHT',summonOrders:[]}));
 const frontUnits=pieces.filter(p=>catalog.operators[p.operatorId].role==='frontline'),assignedFronts=[];
 const routesForBlocking=groundRoutes.slice(0,Math.min(groundRoutes.length,frontUnits.length));
 const summonSlots=(piece,cell,dir,excludeKey=null)=>{const op=catalog.operators[piece.operatorId],record=op.stars[piece.star].record,ids=[...new Set((record.tokens??[]).map(x=>typeof x==='string'?x:x?.tokenId).filter(Boolean))],result=[];for(const tokenId of ids){const token=data.tokens?.[tokenId];if(token?.placeable!==true||Array.isArray(token.owners)&&token.owners.length&&!token.owners.includes(piece.operatorId))continue;if(record.skill?.overrideTokenKey&&tokenId!==record.skill.overrideTokenKey)continue;const anchorKeys=[...ownerRangeKeys(opRange(op,piece.star),cell.row,cell.col,dir)],slots=anchorKeys.filter(key=>key!==excludeKey&&!used.has(key)&&!reservedSummon.has(key)).map(key=>{const [row,col]=key.split(',').map(Number);return {key,row,col};}).filter(c=>canPlace(field.deployMap,positionClass(token),c.row,c.col)).sort((a,b)=>(Math.abs(a.row-cell.row)+Math.abs(a.col-cell.col))-(Math.abs(b.row-cell.row)+Math.abs(b.col-cell.col))||a.key.localeCompare(b.key));if(!slots.length)return null;result.push(slots[0]);}return result;};
 const reserveSummonTiles=(piece,dir)=>{const slots=summonSlots(piece,piece,dir);if(!slots)throw new Error(`summon-anchor-reservation-unavailable:${piece.name}`);for(const slot of slots)reservedSummon.add(slot.key);};
 const put=(piece,cell,dir)=>{if(!cell||!legal.has(cell.key)||used.has(cell.key)||reservedSummon.has(cell.key))throw new Error(`illegal-scenario-cell:${piece.uid}`);Object.assign(piece,{row:cell.row,col:cell.col,dir});used.add(cell.key);reserveSummonTiles(piece,dir);};
 const healer=pieces.find(p=>catalog.operators[p.operatorId].role==='healer');if(!healer)throw new Error('scenario-healer-missing');
 const blockingFrontUnits=frontUnits.slice(0,routesForBlocking.length);
 const healerOp=catalog.operators[healer.operatorId],frontOptions=blockingFrontUnits.map((piece,index)=>{const route=routesForBlocking[index],op=catalog.operators[piece.operatorId],all=entries.filter(c=>legal.has(c.key)&&canOperatorUseTile(op,field.deployMap,c.row,c.col)&&canBlockGround(field,c.row,c.col)).map(cell=>({cell,route,dir:directionToward(cell.row,cell.col,route.points[Math.floor(route.points.length/2)]??[cell.row,cell.col])})).sort((a,b)=>routeDistance(a.cell,a.route)-routeDistance(b.cell,b.route)),onPath=all.filter(x=>routeDistance(x.cell,route)===0);return (onPath.length?onPath:all).slice(0,18);});
 let formation=null;
 for(const healerCell of entries.filter(c=>legal.has(c.key)&&canOperatorUseTile(healerOp,field.deployMap,c.row,c.col)))for(const hDir of DIRECTIONS){
  const hRange=ownerRangeKeys(opRange(healerOp,healer.star),healerCell.row,healerCell.col,hDir);let chosen=[],score=0,ok=true;
  const coveredFrontCells=[];
  for(const options of frontOptions){const option=options.find(x=>hRange.has(x.cell.key)&&x.cell.key!==healerCell.key&&!chosen.some(y=>y.cell.key===x.cell.key))??options.find(x=>x.cell.key!==healerCell.key&&!chosen.some(y=>y.cell.key===x.cell.key));if(!option){ok=false;break;}chosen.push(option);if(hRange.has(option.cell.key))coveredFrontCells.push(option.cell.key);score+=(hRange.has(option.cell.key)?0:1000)+routeDistance(option.cell,option.route)*100+Math.abs(option.cell.row-healerCell.row)+Math.abs(option.cell.col-healerCell.col);}
  const reservedFrontCells=new Set(chosen.map(x=>x.cell.key));
  const healerSlots=summonSlots(healer,healerCell,hDir,healerCell.key);
  if(ok&&coveredFrontCells.length>0&&healerSlots&&!healerSlots.some(x=>reservedFrontCells.has(x.key))&&(!formation||coveredFrontCells.length>formation.coveredFrontCells.length||coveredFrontCells.length===formation.coveredFrontCells.length&&score<formation.score))formation={healerCell,hDir,front:chosen,coveredFrontCells,score};
 }
 let healerCovered=[];
 if(routesForBlocking.length){
  if(!formation)throw new Error(`no-healer-range-frontline-formation:${field.stageId}`);
  for(const [i,piece] of blockingFrontUnits.entries()){const chosen=formation.front[i];put(piece,chosen.cell,chosen.dir);assignedFronts.push(chosen.cell);}
  put(healer,formation.healerCell,formation.hDir);healerCovered=formation.coveredFrontCells;
 }else{
  const fallback=entries.filter(c=>legal.has(c.key)&&canOperatorUseTile(healerOp,field.deployMap,c.row,c.col)).flatMap(cell=>DIRECTIONS.map(dir=>({cell,dir,score:coveredRouteIds(healerOp,healer.star,cell,dir,allRoutes).length}))).filter(x=>summonSlots(healer,x.cell,x.dir,x.cell.key)).sort((a,b)=>b.score-a.score||a.cell.key.localeCompare(b.cell.key))[0];
  if(!fallback)throw new Error(`no-healer-cell:${field.stageId}`);
  put(healer,fallback.cell,fallback.dir);
 }
 const core=pieces.find(p=>p.operatorId===roster[0].operatorId),coreOp=catalog.operators[core.operatorId];
 const bossRouteIndices=allRoutes.map((route,index)=>route.originalIndices?.some(routeIndex=>bossOriginalIndices.has(routeIndex))?index:null).filter(index=>index!==null);
 let coreSpot;
 if(core.row!==null){const cell={key:`${core.row},${core.col}`,row:core.row,col:core.col},covered=coveredRouteIds(coreOp,core.star,cell,core.dir,allRoutes);coreSpot={cell,dir:core.dir,covered};}
 else {const options=entries.filter(c=>legal.has(c.key)&&!used.has(c.key)&&!reservedSummon.has(c.key)&&canOperatorUseTile(coreOp,field.deployMap,c.row,c.col)&&(coreOp.role!=='frontline'||canBlockGround(field,c.row,c.col))).flatMap(cell=>DIRECTIONS.map(dir=>{const covered=coveredRouteIds(coreOp,core.star,cell,dir,allRoutes),bossCovered=bossRouteIndices.filter(index=>covered.includes(index)).length;return {cell,dir,covered,bossCovered,score:bossCovered*1000000+covered.length*1000-Math.min(...allRoutes.map(route=>routeDistance(cell,route)))};})).filter(x=>summonSlots(core,x.cell,x.dir,x.cell.key)).sort((a,b)=>b.score-a.score||a.cell.key.localeCompare(b.cell.key));
  coreSpot=options[0];if(coreSpot)put(core,coreSpot.cell,coreSpot.dir);}
 if(!coreSpot||coreSpot.covered.length===0)throw new Error(`core-range-covers-no-route:${core.name}`);
 const ordered=pieces.filter(p=>p.row===null);
 for(const piece of ordered){const op=catalog.operators[piece.operatorId],record=op.stars[piece.star].record,token=record.skill?.overrideTokenKey?data.tokens?.[record.skill.overrideTokenKey]:null,grid=opRange(op,piece.star);
  const options=entries.filter(c=>legal.has(c.key)&&!used.has(c.key)&&!reservedSummon.has(c.key)&&canOperatorUseTile(op,field.deployMap,c.row,c.col)&&(op.role!=='frontline'||canBlockGround(field,c.row,c.col))).flatMap(cell=>DIRECTIONS.map(dir=>{const nearest=allRoutes.map(route=>routeDistance(cell,route)),target=allRoutes[nearest.indexOf(Math.min(...nearest))]?.points[0]??[cell.row,cell.col],covered=coveredRouteIds(op,piece.star,cell,dir,allRoutes);let anchorOk=true;if(token?.ownerRange)anchorOk=[...ownerRangeKeys(grid,cell.row,cell.col,dir)].some(key=>{const [r,c]=key.split(',').map(Number);return !used.has(key)&&!reservedSummon.has(key)&&canPlace(field.deployMap,positionClass(token),r,c);});return {cell,dir,covered,anchorOk,score:covered.length*1000-Math.min(...nearest)};})).filter(x=>x.anchorOk&&summonSlots(piece,x.cell,x.dir,x.cell.key)).sort((a,b)=>b.score-a.score||a.cell.key.localeCompare(b.cell.key));
  const best=options[0];if(!best)throw new Error(`no-legal-range-cell:${piece.name}:${field.stageId}`);put(piece,best.cell,best.dir);
 }
 state.pieces=pieces;
 const groundFrontlines=routesForBlocking.map((route,index)=>{const piece=blockingFrontUnits[index],distanceToPath=piece?routeDistance(piece,route):null,blocksGround=!!piece&&canBlockGround(field,piece.row,piece.col);return {routeIndex:groundRoutes.indexOf(route),pieceUid:piece?.uid,position:piece?[piece.row,piece.col]:null,distanceToPath,blocksGround,blocksGroundPath:blocksGround&&distanceToPath===0};});
 const routeCoverage={routes:allRoutes.map((route,index)=>({index,originalIndices:route.originalIndices,motion:route.motion,source:route.source,points:route.points})),bossRouteIndices,groundFrontlines,uncoveredGroundRoutes:groundRoutes.map(route=>allRoutes.indexOf(route)).filter(routeIndex=>!groundFrontlines.some(front=>front.routeIndex===routeIndex&&front.blocksGroundPath)),core:{uid:core.uid,coveredRoutes:coreSpot.covered,uncoveredRoutes:allRoutes.map((_,i)=>i).filter(i=>!coreSpot.covered.includes(i)),bossRouteIndices,coversBossRoute:bossRouteIndices.length===0||bossRouteIndices.some(i=>coreSpot.covered.includes(i))},healer:{uid:healer?.uid??null,coveredFrontlineCells:healerCovered,frontlineCells:assignedFronts.map(f=>f.key)}};
 if(cfg.phase==='terminal')core.equipment=cfg.gearIds.map(itemId=>({itemId}));
 else for(const itemId of cfg.gearIds)core.equipment.push({itemId});
 let transferCount=0;
 if(cfg.phase==='terminal'){
  const pactOrder=[pactId];
  for(const currentPactId of pactOrder){
   const itemId=`transfer_${currentPactId}`,item=catalog.equipment[itemId];if(!item)continue;
   while(transferCount<(cfg.transferLimit??2)){
    const members=state.pieces.flatMap(p=>{const op=catalog.operators[p.operatorId];const has=(op.pacts??[]).includes(currentPactId)||p.equipment.some(e=>(catalog.equipment[e.itemId]?.effects??[]).some(x=>['transfer_pact','pact_transfer'].includes(x.kind)&&x.params?.pactId===currentPactId));return has?[[p,op]]:[];});
    const memberIds=new Set(members.map(([,op])=>op.charId));
    const thresholds=catalog.pacts[currentPactId].thresholds??[],next=thresholds.find(t=>t>memberIds.size);
    if(!next)break;
    const target=state.pieces.find(p=>{const op=catalog.operators[p.operatorId];return !memberIds.has(op.charId)&&!p.equipment.some(e=>e.itemId===itemId)&&p.equipment.length<3;});
    if(!target)break;
    target.equipment.push({itemId});transferCount++;
   }
  }
 }
 return {gearCount:state.pieces.reduce((n,p)=>n+p.equipment.length,0),transferCount,routeCoverage};
}
export function buildScenario({data,catalog,definition,config,coreStar,seed,rosterOverride=null}){
 const cfg=config;if(!cfg||!SCENARIO_CONFIGS.some(x=>x.round===cfg.round&&x.level===cfg.level))throw new Error(`bad-scenario-config:${cfg?.round}:${cfg?.level}`);
 const created=createSession({seed,difficulty:'NORMAL',catalog,environmentId:definition.env});if(!created.ok)throw new Error(`create-session:${created.error}`);const state=created.state;
 state.seed=seed;state.round=cfg.round;state.level=cfg.level;state.phase='prep';state.gold=0;state.xp=0;state.difficulty='NORMAL';
 const field=getResonanceField(state,{data,catalog}),requiredFrontlines=Math.min(2,routeSet(field).filter(r=>r.motion==='WALK').length);
 const roster=rosterOverride?structuredClone(rosterOverride).map((p,i)=>({...p,uid:`scenario-${cfg.round}-${cfg.level}-${i}-${p.operatorId}`,row:null,col:null,dir:'RIGHT',summonOrders:[]})):makeArchetypeRoster(catalog,definition,cfg.level,coreStar,cfg.assistantStar,requiredFrontlines,cfg.phase==='terminal');
 state.pieces=roster.map((p,i)=>({...p,uid:`scenario-${cfg.round}-${cfg.level}-${i}-${p.operatorId}`,row:null,col:null,dir:'RIGHT',summonOrders:[]}));
 const equipment=putOnField(data,state,field,catalog,roster,cfg,definition.pact);
 return {state,field,equipment};
}
function scenarioSeed(def,round){let h=2166136261;for(const c of `${def.id}:${round}:archetype-v1`)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h||1;}
export function findArchetypeCatalog(data,def){for(let seed=1;seed<=256;seed++){const catalog=getResonanceCatalog(data,{environmentId:def.env,seed});const active=new Set(catalog.config.activeOperatorIds),core=opNamed(catalog,def.core);if(core&&active.has(core.id)&&def.include.every(n=>{const op=opNamed(catalog,n);return op&&active.has(op.id);}))return {catalog,catalogSeed:seed};}throw new Error(`65-pool-cannot-build-archetype:${def.id}`);}
export function makePactTerminalRoster(catalog,level=10,coreStar=2,{coreMode='preferred'}={}){
 const env=catalog.config.environmentId,mainPact=catalog.environments?.[env]?.identityPactId,active=new Set(catalog.config.activeOperatorIds),operators=Object.values(catalog.operators).filter(op=>active.has(op.id));
 if(!mainPact)throw new Error(`identity-pact-missing:${env}`);
 if(env==='origin_lungmen'&&coreMode==='preferred')coreMode='main-pact-low-cost';
 const thresholds=catalog.pacts[mainPact]?.thresholds??[],configuredMaxTier=thresholds.at(-1)??0;
 const power=op=>(op.cost??0)*1.7+(op.cost>=4?3:0)+(op.role==='frontline'?4:op.role==='healer'?2:op.role==='damage'?2.5:op.role==='control'?1.5:0)+Math.log1p(Number(op.stars?.[2]?.stats?.atk??0))*0.2;
 const mainMembers=operators.filter(op=>op.pacts?.includes(mainPact));
 const activeMainCount=new Set(mainMembers.map(op=>op.charId)).size;
 const transferLimit=env==='origin_lungmen'?3:2,transferAvailable=!!catalog.equipment[`transfer_${mainPact}`];
 const threshold=thresholds.filter(t=>t<=activeMainCount+(transferAvailable?transferLimit:0)).at(-1)??configuredMaxTier;
 const lowCostCore=env==='origin_lungmen'&&coreMode==='main-pact-low-cost';
 const coreCandidates=lowCostCore?mainMembers:operators.filter(op=>(op.cost??0)>=4);
 const core=[...coreCandidates].sort((a,b)=>(b.cost>=5?1:0)-(a.cost>=5?1:0)||b.cost-a.cost||Number(b.pacts?.includes(mainPact))-Number(a.pacts?.includes(mainPact))||(b.role==='damage'?1:0)-(a.role==='damage'?1:0)||a.id.localeCompare(b.id))[0];
 if(!core)throw new Error(`no-active-four-or-five-cost-core:${env}:${mainPact}`);
 const chosen=[],chars=new Set();const add=op=>{if(!op||chosen.length>=level||chars.has(op.charId))return false;chars.add(op.charId);chosen.push(op);return true;};
 add(core);
 const addRole=(role,count)=>{while(chosen.filter(op=>op.role===role).length<count&&chosen.length<level){const op=operators.filter(x=>x.role===role&&!chars.has(x.charId)).sort((a,b)=>candidatePactRank(b,mainPact,catalog)-candidatePactRank(a,mainPact,catalog)||power(b)-power(a)||a.id.localeCompare(b.id))[0];if(!add(op))break;}};
 addRole('frontline',2);addRole('healer',1);
 while(chosen.filter(op=>['damage','control','summoner'].includes(op.role)).length<2&&chosen.length<level){const op=operators.filter(x=>['damage','control','summoner'].includes(x.role)&&!chars.has(x.charId)).sort((a,b)=>candidatePactRank(b,mainPact,catalog)-candidatePactRank(a,mainPact,catalog)||power(b)-power(a)||a.id.localeCompare(b.id))[0];if(!add(op))break;}
 const targetNatural=Math.min(threshold,Math.max(1,threshold-(transferAvailable?transferLimit:2)));
 for(const op of [...mainMembers].sort((a,b)=>Number(a.role==='frontline')-Number(b.role==='frontline')||power(b)-power(a)||a.id.localeCompare(b.id))){
  if(new Set(chosen.filter(x=>x.pacts?.includes(mainPact)).map(x=>x.charId)).size>=targetNatural)break;
  if(op.role==='frontline'&&chosen.filter(x=>x.role==='frontline').length>=2)continue;
  if(op.role==='healer'&&chosen.filter(x=>x.role==='healer').length>=2)continue;
  add(op);
 }
 for(const op of [...operators].sort((a,b)=>power(b)-power(a)||a.id.localeCompare(b.id))){
  const role=op.role;
  if(role==='frontline'&&chosen.filter(x=>x.role==='frontline').length>=2)continue;
  if(role==='healer'&&chosen.filter(x=>x.role==='healer').length>=2)continue;
  add(op);
 }
 const roster=chosen.map((op,index)=>({operatorId:op.id,name:op.name,role:op.role,star:index===0?coreStar:2,equipment:[],extraPacts:[],growth:{}}));
 const naturalCount=new Set(chosen.filter(op=>op.pacts?.includes(mainPact)).map(op=>op.charId)).size;
 return {environmentId:env,mainPact,threshold,configuredMaxTier,core:{name:core.name,cost:core.cost,operatorId:core.id,lowCostCore,coreMode},naturalCount,estimatedFinalCount:naturalCount+Math.min(transferLimit,Math.max(0,level-naturalCount)),transferAvailable,transferLimit,constructible:naturalCount+Math.min(transferLimit,Math.max(0,level-naturalCount))>=threshold&&transferAvailable,roster};
}
function candidatePactRank(op,pactId,catalog){return (op.pacts?.includes(pactId)?100:0)+(catalog.environments?.[catalog.config.environmentId]?.identityPactId===pactId?0:0);}
export function pactProfile(pieces,catalog){const membership={};for(const piece of pieces){const op=catalog.operators[piece.operatorId],ids=new Set(op.pacts??[]);for(const item of piece.equipment??[])for(const effect of catalog.equipment[item.itemId]?.effects??[])if(['transfer_pact','pact_transfer'].includes(effect.kind)&&effect.params?.pactId)ids.add(effect.params.pactId);for(const id of ids){const member=membership[id]??(membership[id]={charIds:new Set()});member.charIds.add(op.charId);}}return Object.fromEntries(Object.entries(membership).map(([id,value])=>{const count=value.charIds.size,thresholds=catalog.pacts[id]?.thresholds??[];return [id,{uniqueOperators:count,thresholds,activeTier:thresholds.filter(x=>x<=count).at(-1)??0}];}));}
export function runArchetypeMatrix({dataDir=process.env.SP_DATA_DIR||DATA_DIR,reportPath=REPORT,writeReport=true}={}){
 const data=loadData(dataDir,{log:{warn(){},error(){},info(){}}});const rows=[];let caseNo=0;
 for(const def of ARCHETYPES){const {catalog,catalogSeed}=findArchetypeCatalog(data,def);
  for(const cfg of SCENARIO_CONFIGS)for(const coreStar of [2,3]){const seed=scenarioSeed(def,cfg.round);const {state,field,equipment}=buildScenario({data,catalog,definition:def,config:cfg,coreStar,seed});
   const expectedRoster=state.pieces.map(p=>{const op=catalog.operators[p.operatorId],transfers=p.equipment.flatMap(item=>(catalog.equipment[item.itemId]?.effects??[]).filter(effect=>['transfer_pact','pact_transfer'].includes(effect.kind)).map(effect=>effect.params?.pactId).filter(Boolean));return {uid:p.uid,id:p.operatorId,name:op.name,role:op.role,star:p.star,pacts:[...new Set([...(op.pacts??[]),...transfers])],equipment:p.equipment.map(e=>e.itemId),position:[p.row,p.col],dir:p.dir};});
   const illegalDeployments=state.pieces.filter(p=>!canOperatorUseTile(catalog.operators[p.operatorId],field.deployMap,p.row,p.col)||(catalog.operators[p.operatorId].role==='frontline'&&!canBlockGround(field,p.row,p.col))).map(p=>p.uid);
   const run=runResonanceBattle(state,{data,catalog,recording:false});const m=run.metrics??{};const player=Object.values(run.result?.perPlayer??{})[0]??{};const leaked=player.leaked??[],unitStats=player.unitStats??[],unitsEnd=player.unitsEnd??[];const corePiece=state.pieces[0],coreStats=unitStats.find(x=>x.uid===corePiece.uid),coreEnd=unitsEnd.find(x=>x.uid===corePiece.uid);const damageByUnit=unitStats.filter(x=>x.kind==='op'||state.pieces.some(p=>p.uid===x.uid)).map(x=>({uid:x.uid,name:x.name,kind:x.kind,damage:x.dmg,healing:x.heal,kills:x.kills,attacks:x.attacks,taken:x.taken}));
   rows.push({archetype:def.id,environmentId:def.env,round:cfg.round,level:cfg.level,phase:cfg.phase,accessibility:cfg.round===12&&state.pieces.some(p=>catalog.operators[p.operatorId].cost===5)?'ideal-upper-bound-not-economically-accessible':'fixed-battle-scenario',core:{uid:corePiece.uid,name:def.core,star:coreStar,skillId:catalog.operators[corePiece.operatorId].fixedSkillId,damage:coreStats?.dmg??0,attacks:coreStats?.attacks??0,healing:coreStats?.heal??0,survived:coreEnd?.alive??null,hpPct:coreEnd?.hpPct??null,spLeft:coreEnd?.sp??null},catalogSeed,seed,party:expectedRoster,partySize:state.pieces.length,roleCounts:Object.fromEntries(['frontline','healer','damage','control','summoner','support'].map(role=>[role,expectedRoster.filter(p=>p.role===role).length])),pactProfile:pactProfile(state.pieces,catalog),routeCoverage:equipment.routeCoverage,equipmentCount:equipment.gearCount,transferCount:equipment.transferCount,teamSkillStarts:m.skills??0,teamDamage:m.damage??null,bossDamage:player.bossDamage??null,teamHealing:m.healing??null,damageByUnit,durationSeconds:run.result?.time??null,leaked:leaked.filter(x=>x.counted!==false).reduce((s,x)=>s+(Number(x.lpr)||0),0),leakCount:leaked.filter(x=>x.counted!==false).length,bossHpLeft:run.result?.bossHpLeft??null,won:run.won,hpLoss:run.hpLoss,errors:run.diagnostics?.errorCount??0,illegalDeployments,summonAnchorGaps:run.summonAnchorGaps??[]});
   caseNo++;if(caseNo%10===0)console.log(`archetype cases ${caseNo}/100`);
  }
 }
 const pairs=[];for(const def of ARCHETYPES)for(const cfg of SCENARIO_CONFIGS){const a=rows.find(x=>x.archetype===def.id&&x.round===cfg.round&&x.level===cfg.level&&x.core.star===2),b=rows.find(x=>x.archetype===def.id&&x.round===cfg.round&&x.level===cfg.level&&x.core.star===3);pairs.push({archetype:def.id,round:cfg.round,level:cfg.level,coreSkillId:a.core.skillId,star2CoreDamage:a.core.damage,star3CoreDamage:b.core.damage,coreDamageDelta:(b.core.damage??0)-(a.core.damage??0),star2TeamDamage:a.teamDamage,star3TeamDamage:b.teamDamage,teamDamageDelta:(b.teamDamage??0)-(a.teamDamage??0),star2Healing:a.teamHealing,star3Healing:b.teamHealing,star2Duration:a.durationSeconds,star3Duration:b.durationSeconds,durationDelta:(b.durationSeconds??0)-(a.durationSeconds??0),star2LeakCount:a.leakCount,star3LeakCount:b.leakCount,leakCountDelta:b.leakCount-a.leakCount,star2HpLoss:a.hpLoss,star3HpLoss:b.hpLoss,hpLossDelta:b.hpLoss-a.hpLoss,star2Won:a.won,star3Won:b.won});}
 const report={schemaVersion:1,kind:'fixed-archetype-battle-scenarios',accessibility:'直接固定阵容对照，不模拟商店经济；round12五费阵容视为理想上界。',difficulty:'NORMAL',rounds:[...new Set(SCENARIO_CONFIGS.map(x=>x.round))],techLevels:[...new Set(SCENARIO_CONFIGS.map(x=>x.level))],cases:rows.length,seedPolicy:'fixed seed by archetype and round; ★2/★3 paired runs share enemy-wave seed',damageDeltaDefinition:'paired total/core damage is interpreted together with battle time, leaked enemy count, hp loss, and win result',summary:{wins:rows.filter(x=>x.won).length,cases:rows.length,errors:rows.reduce((s,x)=>s+x.errors,0),illegalDeployments:rows.reduce((s,x)=>s+x.illegalDeployments.length,0),summonAnchorGaps:rows.reduce((s,x)=>s+x.summonAnchorGaps.length,0)},coreStarComparison:pairs,rows};
 if(writeReport){fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({reportPath,...report.summary,rounds:report.rounds,techLevels:report.techLevels,coreStarComparison:ARCHETYPES.map(d=>`${d.id}: ${pairs.filter(p=>p.archetype===d.id).map(p=>`L${p.level}Δ${Math.round(p.coreDamageDelta)} ${p.star2Won?'W':'L'}→${p.star3Won?'W':'L'}`).join(' | ')}`)},null,2));return report;
}
export function runTerminalPactMatrix({dataDir=process.env.SP_DATA_DIR||DATA_DIR,reportPath=REPORT,seedBase=0x50414354,writeReport=true}={}){
 const data=loadData(dataDir,{log:{warn(){},error(){},info(){}}}),rows=[];
 const pacts=['aegir','laterano','kjerag','yan','victoria','columbia','kazimierz','siracusa','rhodes','lungmen','sargon','leithania','iberia','higashi','ursus','bolivar','rim','babel','sami'];
 for(const [envIndex,pactName] of pacts.entries()){
  const envId=`origin_${pactName}`,coreModes=pactName==='lungmen'?['main-pact-low-cost','high-cost-cross-pact']:['preferred'];
  for(const [modeIndex,coreMode] of coreModes.entries()){
  let catalog=null,catalogSeed=null,composition=null,fallback=null;
  for(let seed=1;seed<=256;seed++){
   const candidate=getResonanceCatalog(data,{environmentId:envId,seed}),built=makePactTerminalRoster(candidate,10,2,{coreMode});
   fallback??={catalog:candidate,catalogSeed:seed,composition:built};
   if((coreMode==='main-pact-low-cost'?built.core.lowCostCore:built.core.cost>=4)){catalog=candidate;catalogSeed=seed;composition=built;if(built.constructible)break;}
  }
  if(!catalog&&fallback)({catalog,catalogSeed,composition}=fallback);
  if(!catalog){rows.push({environmentId:envId,coreMode,error:'no-active-terminal-core'});continue;}
  const cfg={...SCENARIO_CONFIGS.at(-1),transferLimit:composition.transferLimit},definition={id:`terminal-${pactName}-${coreMode}`,env:envId,core:composition.core.name,include:[],pact:composition.mainPact},pairedSeed=seedBase+envIndex*101+modeIndex*17;
  for(const coreStar of [2,3]){
   const seed=pairedSeed,roster=structuredClone(composition.roster);roster[0].star=coreStar;
   try{
    const {state,field,equipment}=buildScenario({data,catalog,definition,config:cfg,coreStar,seed,rosterOverride:roster});
    const run=runResonanceBattle(state,{data,catalog,recording:false}),metrics=run.metrics??{},player=Object.values(run.result?.perPlayer??{})[0]??{},units=player.unitStats??[],coreStats=units.find(unit=>unit.uid===state.pieces[0].uid);
    const mainProfile=pactProfile(state.pieces,catalog)[composition.mainPact],party=state.pieces.map(piece=>({name:catalog.operators[piece.operatorId].name,operatorId:piece.operatorId,charId:catalog.operators[piece.operatorId].charId,cost:catalog.operators[piece.operatorId].cost,role:catalog.operators[piece.operatorId].role,star:piece.star,pacts:[...(catalog.operators[piece.operatorId].pacts??[]),...piece.equipment.flatMap(item=>(catalog.equipment[item.itemId]?.effects??[]).filter(effect=>['transfer_pact','pact_transfer'].includes(effect.kind)).map(effect=>effect.params?.pactId).filter(Boolean))],equipment:piece.equipment.map(item=>item.itemId),position:[piece.row,piece.col],dir:piece.dir}));
    const coreEnd=(player.unitsEnd??[]).find(unit=>unit.uid===state.pieces[0].uid);
    rows.push({environmentId:envId,mainPact:composition.mainPact,coreMode,catalogSeed,catalogPoolSize:catalog.config.activeOperatorIds.length,round:cfg.round,level:cfg.level,core:composition.core,coreStar,seed,accessibility:'direct fixed terminal lineup; no shop-economy claim',party,partySize:party.length,roleCounts:Object.fromEntries(['frontline','healer','damage','control','summoner','support'].map(role=>[role,party.filter(piece=>piece.role===role).length])),targetPactTier:composition.threshold,configuredMaxPactTier:composition.configuredMaxTier,mainPactProfile:mainProfile,constructibleWithinPool:composition.constructible,transferCount:equipment.transferCount,transferLimit:composition.transferLimit,routeCoverage:equipment.routeCoverage,damage:metrics.damage??null,healing:metrics.healing??null,bossDamage:player.bossDamage??null,coreDamage:coreStats?.dmg??0,coreAttacks:coreStats?.attacks??0,coreSurvived:coreEnd?.alive??null,coreHpPct:coreEnd?.hpPct??null,teamSkillStarts:metrics.skills??0,durationSeconds:run.result?.time??null,leaked:(player.leaked??[]).filter(x=>x.counted!==false).reduce((sum,x)=>sum+(Number(x.lpr)||0),0),hpLoss:run.hpLoss,bossHpLeft:run.result?.bossHpLeft??null,won:run.won,errors:run.diagnostics?.errorCount??0,summonAnchorGaps:run.summonAnchorGaps??[]});
   }catch(error){rows.push({environmentId:envId,mainPact:composition.mainPact,coreMode,catalogSeed,round:cfg.round,level:cfg.level,core:composition.core,coreStar,constructibleWithinPool:composition.constructible,error:error.message});}
  }
  }
 }
 const terminal={scope:'19 environments × core 2★/3★ paired terminal scenarios; Lungmen includes native 3-cost main-pact core and cross-pact 5-cost core comparison',accessibility:'Directly fixed level-10 terminal lineups with three completed core items, two-star supports, at most two transfers (Lungmen uses up to three at nodes 12/22/26); not an economy-achievability claim.',rows:rows.length,summary:{constructibleEnvironments:[...new Set(rows.filter(row=>row.constructibleWithinPool).map(row=>row.environmentId))].length,nonconstructibleEnvironments:[...new Set(rows.filter(row=>row.constructibleWithinPool===false).map(row=>row.environmentId))],errors:rows.filter(row=>row.error||row.errors).length,summonAnchorGaps:rows.reduce((n,row)=>n+(row.summonAnchorGaps?.length??0),0),cases:rows.length},rows};
 if(writeReport){const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));report.terminalPactMatrix=terminal;fs.writeFileSync(reportPath,`${JSON.stringify(report,null,2)}\n`,'utf8');}
 console.log(JSON.stringify({reportPath,terminalPactMatrix:terminal.summary},null,2));return terminal;
}
export function runFormalBalanceMatrix({dataDir=process.env.SP_DATA_DIR||DATA_DIR,reportPath=REPORT}={}){
 const original=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 if(original.rows?.length!==100||original.terminalPactMatrix?.rows?.length!==40||original.terminalBalanceCounterfactual?.rows?.length!==80)throw new Error('formal-matrix-requires-preserved-100-40-80-report');
 const archetypes=runArchetypeMatrix({dataDir,reportPath,writeReport:false});
 const terminalPactMatrix=runTerminalPactMatrix({dataDir,reportPath,writeReport:false});
 const data=loadData(dataDir,{log:{warn(){},error(){},info(){}}});
 const catalog=getResonanceCatalog(data,{environmentId:'origin_aegir',seed:1});
 const difficulties=['FUNNY','NORMAL','HARD','ABYSS'];
 const resolvedProfiles=Object.fromEntries(difficulties.map(difficulty=>[difficulty,{regular:resolveEnemyBalance(catalog.campaign.enemyBalance,difficulty,'normal'),terminal:resolveEnemyBalance(catalog.campaign.enemyBalance,difficulty,'boss')} ]));
 const formalBalanceMatrix={scope:'formal compiled configuration; NORMAL 100 archetype and 40 terminal fixed-battle rows; recording=false',accessibility:'direct fixed-lineup scenarios, not an economy-achievability claim',sourceCommit:catalog.source?.commit??null,enemyBalance:structuredClone(catalog.campaign.enemyBalance),resolvedProfiles,archetypes,terminalPactMatrix,summary:{archetypeCases:archetypes.cases,archetypeWins:archetypes.summary.wins,terminalCases:terminalPactMatrix.rows.length,terminalWins:terminalPactMatrix.rows.filter(row=>row.won).length,constructibleEnvironments:terminalPactMatrix.summary.constructibleEnvironments,nonconstructibleEnvironments:terminalPactMatrix.summary.nonconstructibleEnvironments,errors:archetypes.summary.errors+terminalPactMatrix.summary.errors,illegalDeployments:archetypes.summary.illegalDeployments,summonAnchorGaps:archetypes.summary.summonAnchorGaps+terminalPactMatrix.summary.summonAnchorGaps}};
 const updated={...original,formalBalanceMatrix};
 const tempPath=`${reportPath}.pending-${process.pid}`;let fd,created=false;
 try{fd=fs.openSync(tempPath,'wx');created=true;fs.writeFileSync(fd,`${JSON.stringify(updated,null,2)}\n`,'utf8');fs.closeSync(fd);fd=undefined;fs.renameSync(tempPath,reportPath);}
 catch(error){if(fd!==undefined)fs.closeSync(fd);if(created&&fs.existsSync(tempPath))fs.unlinkSync(tempPath);throw error;}
 console.log(JSON.stringify({reportPath,formalBalanceMatrix:formalBalanceMatrix.summary,resolvedProfiles},null,2));
 return formalBalanceMatrix;
}
export const TERMINAL_BALANCE_COUNTERFACTUALS=Object.freeze([
 {id:'mild',enemyBalance:{regular:{hpMultiplier:0.8,atkMultiplier:0.9,defMultiplier:0.5,resMultiplier:1,speedMultiplier:1},terminal:{hpMultiplier:0.85,atkMultiplier:0.9,defMultiplier:0.5,resMultiplier:1,speedMultiplier:1,bossPoolMultiplier:0.75}}},
 {id:'looser',enemyBalance:{regular:{hpMultiplier:0.65,atkMultiplier:0.85,defMultiplier:0.35,resMultiplier:1,speedMultiplier:1},terminal:{hpMultiplier:0.75,atkMultiplier:0.85,defMultiplier:0.35,resMultiplier:1,speedMultiplier:1,bossPoolMultiplier:0.6}}},
]);
function fixedTerminalStateFromReport(row,catalog){
 const created=createSession({seed:row.seed,difficulty:'NORMAL',catalog,environmentId:row.environmentId});if(!created.ok)throw new Error(`counterfactual-session:${created.error}`);
 const state=created.state;state.seed=row.seed;state.round=row.round;state.level=row.level;state.phase='prep';state.gold=0;state.xp=0;state.difficulty='NORMAL';
 state.pieces=row.party.map((piece,index)=>({uid:`scenario-${row.round}-${row.level}-${index}-${piece.operatorId}`,operatorId:piece.operatorId,star:piece.star,row:piece.position[0],col:piece.position[1],dir:piece.dir,equipment:piece.equipment.map(itemId=>({itemId})),growth:{},extraPacts:[],summonOrders:[]}));
 return state;
}
export function runTerminalBalanceCounterfactual({dataDir=process.env.SP_DATA_DIR||DATA_DIR,reportPath=REPORT}={}){
 const data=loadData(dataDir,{log:{warn(){},error(){},info(){}}}),initial=JSON.parse(fs.readFileSync(reportPath,'utf8')),baselineRows=initial.terminalPactMatrix?.rows;
 if(!Array.isArray(baselineRows)||baselineRows.length!==40)throw new Error(`terminal-counterfactual-requires-40-baseline-rows:${baselineRows?.length??'missing'}`);
 const catalogCache=new Map(),results=[];
 for(const candidate of TERMINAL_BALANCE_COUNTERFACTUALS){
  for(const baseRow of baselineRows){
   const cacheKey=`${candidate.id}|${baseRow.environmentId}|${baseRow.catalogSeed}`;let catalog=catalogCache.get(cacheKey);
   if(!catalog){const native=getResonanceCatalog(data,{environmentId:baseRow.environmentId,seed:baseRow.catalogSeed});catalog=structuredClone(native);catalog.campaign={...(catalog.campaign??{}),enemyBalance:structuredClone(candidate.enemyBalance)};catalogCache.set(cacheKey,catalog);}
   const active=new Set(catalog.config.activeOperatorIds);if(baseRow.party.some(piece=>!active.has(piece.operatorId)))throw new Error(`counterfactual-baseline-member-not-active:${baseRow.environmentId}:${baseRow.coreMode}`);
   const state=fixedTerminalStateFromReport(baseRow,catalog);
   for(let i=0;i<state.pieces.length;i++){const piece=state.pieces[i],baseline=baseRow.party[i];if(piece.operatorId!==baseline.operatorId||piece.star!==baseline.star||piece.row!==baseline.position[0]||piece.col!==baseline.position[1]||piece.dir!==baseline.dir||JSON.stringify(piece.equipment.map(x=>x.itemId))!==JSON.stringify(baseline.equipment))throw new Error(`counterfactual-fixed-lineup-drift:${baseRow.environmentId}:${i}`);}
   const run=runResonanceBattle(state,{data,catalog,recording:false}),player=Object.values(run.result?.perPlayer??{})[0]??{},coreStats=(player.unitStats??[]).find(unit=>unit.uid===state.pieces[0].uid),coreEnd=(player.unitsEnd??[]).find(unit=>unit.uid===state.pieces[0].uid);
   results.push({candidate:candidate.id,environmentId:baseRow.environmentId,mainPact:baseRow.mainPact,coreMode:baseRow.coreMode,catalogSeed:baseRow.catalogSeed,seed:baseRow.seed,round:baseRow.round,level:baseRow.level,core:baseRow.core,coreStar:baseRow.coreStar,party:baseRow.party.map(piece=>({operatorId:piece.operatorId,star:piece.star,position:piece.position,dir:piece.dir,equipment:piece.equipment})),pactTier:baseRow.mainPactProfile.activeTier,baseline:{won:baseRow.won,durationSeconds:baseRow.durationSeconds,bossHpLeft:baseRow.bossHpLeft,bossDamage:baseRow.bossDamage,damage:baseRow.damage},result:{won:run.won,durationSeconds:run.result?.time??null,bossHpLeft:run.result?.bossHpLeft??null,bossDamage:player.bossDamage??null,damage:run.metrics?.damage??null,healing:run.metrics?.healing??null,coreDamage:coreStats?.dmg??0,coreAttacks:coreStats?.attacks??0,coreSurvived:coreEnd?.alive??null},errors:run.diagnostics?.errorCount??0,summonAnchorGaps:run.summonAnchorGaps??[]});
  }
 }
 const counterfactual={scope:'same 40 reported terminal lineups × two enemy-balance candidates; fixed operator IDs/stars/positions/directions/equipment and Battle seeds',accessibility:'fixed terminal battle fixtures; no shop-economy claim; recording=false',candidateConfigs:Object.fromEntries(TERMINAL_BALANCE_COUNTERFACTUALS.map(x=>[x.id,x.enemyBalance])),cases:results.length,summary:Object.fromEntries(TERMINAL_BALANCE_COUNTERFACTUALS.map(candidate=>{const rows=results.filter(row=>row.candidate===candidate.id);return [candidate.id,{wins:rows.filter(row=>row.result.won).length,cases:rows.length,errors:rows.reduce((sum,row)=>sum+row.errors,0),summonAnchorGaps:rows.reduce((sum,row)=>sum+row.summonAnchorGaps.length,0)}];})),rows:results};
 const current=JSON.parse(fs.readFileSync(reportPath,'utf8'));current.terminalBalanceCounterfactual=counterfactual;fs.writeFileSync(reportPath,`${JSON.stringify(current,null,2)}\n`,'utf8');
 console.log(JSON.stringify({reportPath,counterfactual:counterfactual.summary,environmentComparison:results.map(row=>`${row.candidate} ${row.environmentId}/${row.coreMode} ${row.core.name} ${row.coreStar}★ ${row.result.won?'W':'L'} ${row.result.durationSeconds}s boss${Math.round(row.result.bossHpLeft??0)} (base ${row.baseline.won?'W':'L'} ${row.baseline.durationSeconds}s boss${Math.round(row.baseline.bossHpLeft??0)})`)},null,2));return counterfactual;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.argv.includes('--formal-balance')?runFormalBalanceMatrix():runArchetypeMatrix();
