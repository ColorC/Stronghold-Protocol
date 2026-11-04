import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createAssaultContext} from '../../server/modes/assault/context.js';
import {lineBuilds,linePurchaseScore,moduleForLine,ownThemeShopScore} from './line-builder.mjs';
import {createRun,applyAction} from '../../shared/assault/run.js';
import {addBodyToInventory,activePieceLimit} from '../../shared/assault/inventory.js';
import {configureCampaign,deployLegalReorder,routeSamplesFor,ctx as playerContext} from './campaign-player.mjs';
import {createAssaultBattle} from '../../server/modes/assault/battle.js';
import {synergyBattle} from '../../test/helpers/synergyCard.js';
import {installCampaignEvidence} from './campaign-evidence.mjs';
const ctx=createAssaultContext(),checks=[];
for(const director of ctx.design.system.directors){
 const state={directorId:director.id};
 const own=ctx.design.system.shopDefinitions.find(s=>s.filter?.type==='faction'&&s.filter.value===director.themeFaction);
 assert.equal(ownThemeShopScore(state,{kind:'shop',shopId:own.id},ctx),100);
 assert.equal(ownThemeShopScore(state,{kind:'shop',shopId:'shop_base'},ctx),0);
 assert.equal(ownThemeShopScore(state,{kind:'event'},ctx),0);
}
for(const [id,line]of Object.entries(lineBuilds.lines)){
 for(const group of ['core','producers','consumers','finishers']){
  assert(line[group].length>0,`${id} ${group}`);
  for(const charId of line[group])assert(ctx.runtime.bodies[charId],`${id} ${charId}`);
 }
 const leader=ctx.design.system.directors.find(d=>d.id===id).leaderCharId;
 const piece={uid:'leader',charId:leader,purchaseCharId:leader,star:3};
 const module=moduleForLine({runId:'fixture',directorId:id},piece,ctx);
 assert(line.moduleKeywords.includes(module.keyword),`${id} relevant event module`);
 const members=new Set(line.members??['core','producers','consumers','finishers'].flatMap(k=>line[k]));
 assert(members.size<=60,`${id} exceeds the line-size limit`);
 assert.deepEqual(line.core,ctx.design.system.directors.find(d=>d.id===id).coreCharIds);
 checks.push({directorId:id,members:members.size,module:module.id});
}
const body=id=>({uid:id,charId:id,purchaseCharId:id,star:1});
const state={gold:99,pieces:['char_1045_svash2','char_206_gnosis','char_4087_ines'].map(body)};
const slot={purchaseCharId:'char_1045_svash2',star:1,price:3};
const score=linePurchaseScore(state,slot,ctx,{...lineBuilds.lines.director_svash2,leaderCharId:slot.purchaseCharId});
assert.deepEqual(score,{score:17,leader:5,merge:4,member:3,pairs:4,star:1});
assert.equal(linePurchaseScore({...state,gold:2},slot,ctx,lineBuilds.lines.director_svash2),null);
const result={status:'pass',score,checks,writesGameData:false};
for(const [id,link]of Object.entries(lineBuilds.acceptanceLinks??{})){
 assert(ctx.runtime.bodies[id]?.adaptation.roles.includes('aura'),id+' is an actual aura');
 assert.equal(link.kind,'aura');assert(link.reason.length>10);
}
assert(!lineBuilds.acceptanceLinks.char_4042_lumen,'the conditional Lumen link remains subject to trigger metrics');
assert(!lineBuilds.acceptanceLinks.char_4072_ironmn,'device destruction remains a trigger condition');
assert(!lineBuilds.acceptanceLinks.char_4146_nymph,'apoptosis-triggered growth remains a trigger condition');
result.auditedAuraLinks=Object.keys(lineBuilds.acceptanceLinks).length;
configureCampaign({policy:'line-builder/v3'});
const swap=createRun({runId:'v3-population-swap',seed:20261101,directorId:'director_ironmn'},playerContext);
const encounter=playerContext.design.encounters.encounters.find(e=>e.kind==='normal');
swap.phase='battlePrep';swap.currentNode={kind:'battle',encounterId:encounter.id};swap.prepEncounterId=encounter.id;
assert.equal(swap.pieces.filter(p=>p.row!==null).length,activePieceLimit(swap,playerContext));
const incoming=addBodyToInventory(swap,playerContext,'char_2023_ling',1,{row:null,col:null});
const retained=swap.pieces.filter(p=>p.row!==null).slice(0,2);
const tile=[...playerContext.fieldFor(swap).normalizedDeployMap.keys()].map(k=>k.split(',').map(Number))
 .find(([r,c])=>!retained.some(p=>p.row===r&&p.col===c)&&playerContext.canPlace(swap,incoming,r,c));
assert(tile,'legal replacement tile');
const targets=[...retained.map(p=>({uid:p.uid,row:p.row,col:p.col,dir:p.dir})),{uid:incoming.uid,row:tile[0],col:tile[1],dir:'E'}];
const actions=[];
const after=deployLegalReorder(swap,targets,'v3-test',(state,type,payload)=>applyAction(state,{type,...payload,opId:`check:${state.revision}:${type}`,expectedRevision:state.revision},playerContext).state,actions);
assert.equal(after.pieces.find(p=>p.uid===incoming.uid).row,tile[0]);
assert(actions.findIndex(a=>a.type==='bench')<actions.findIndex(a=>a.type==='place'),'release population before placement');
result.populationSwap={status:'pass',actions};
const aura=synergyBattle([{charId:'char_263_skadi',row:10,col:3}],{beforeStart:installCampaignEvidence});
const auraRow=aura.battle.campaignEvidence().operators[0];
assert(auraRow.auraBeneficiaries.includes(aura.units[0].uid),'the original Deep Hunter aura also benefits Skadi herself');
const stateOnly=synergyBattle([{charId:'char_350_surtr',row:10,col:3}],{beforeStart:installCampaignEvidence});
stateOnly.spawn([10,4]);assert.equal(stateOnly.castNow(stateOnly.units[0]),true);
assert.equal(Object.keys(stateOnly.units[0].mem.assaultBattleStates).length,1);
assert.equal(stateOnly.battle.campaignEvidence().operators[0].auraBeneficiaries.length,0,'a single-operator battle state is not a group aura');
result.auraRecipients={status:'pass',originalGroupIncludesOwner:true,individualStateExcluded:true};
const regen=synergyBattle([{charId:'char_151_myrtle',row:10,col:3}],{beforeStart:installCampaignEvidence});
regen.units[0].skill.rule='NEVER';regen.run(1.1);
assert(regen.battle.campaignEvidence().operators[0].auraBeneficiaries.includes(regen.units[0].uid),'Myrtle is herself an eligible Pioneer in her original group regeneration aura');
assert.equal(regen.battle.assaultLedger.snapshot().operators[0].healing,0,'full HP regeneration remains zero production');
result.auraRecipients.regenerationOriginalSelfRecipient=true;
const recycler=synergyBattle([{charId:'char_491_humus',row:10,col:3}],{beforeStart:installCampaignEvidence});
const recycled=recycler.units[0],victim=recycler.spawn([10,4]);
recycler.battle.forceAttack(recycled,[victim]);recycler.flush();
assert(recycled.findBuff('adaptation:humus:recycled')?.shield>0,'a real reaper attack overflows native self-healing into a shield');
assert(recycler.battle.campaignEvidence().operators[0].auraBeneficiaries.includes(recycled.uid),'the original recovery group explicitly includes Humus herself');
result.auraRecipients.recoveryOriginalSelfRecipient=true;
result.routeSpawns=[];
for(const encounter of playerContext.design.encounters.encounters){
 const state=createRun({runId:'route-conservation:'+encounter.id,seed:20261101,directorId:'director_svash2'},playerContext);
 Object.assign(state,{day:encounter.dayRange[0],hour:encounter.kind==='final'?6:3,phase:'battlePrep',prepEncounterId:encounter.id,currentNode:{kind:'battle',encounterId:encounter.id}});
 const battle=createAssaultBattle(playerContext.prepareBattle(state,encounter),playerContext),routes=routeSamplesFor(state,encounter);
 const expected=battle.opts.spawns.reduce((n,s)=>n+(s.count??1),0),actual=routes.routeThreats.reduce((n,r)=>n+r.spawnCount,0);
 assert.equal(actual,expected,encounter.id+' all native mapped spawns accounted for');
 assert(routes.routeThreats.every(r=>r.spawnCount>0&&r.routeIndex<battle.routes.length),'unused routes never acquire phantom pressure');
 if(encounter.kind==='final')assert(routes.samples.some(s=>s.boss),encounter.id+' original native boss geometry');
 result.routeSpawns.push({encounterId:encounter.id,expected,actual,oldIgnored:encounter.wave.spawns.filter(s=>s.routeIndex>=battle.routes.length).reduce((n,s)=>n+(s.count??1),0)});
}
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));console.log(JSON.stringify(result));
