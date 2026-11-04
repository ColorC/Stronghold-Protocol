import test from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_DATA_DIR, CARRY_ADAPTIVE_POLICY, ENVIRONMENTS, campaignBossCoverage, campaignCombatProfile, carryItemScore, campaignCorePurchaseAvailable, getSeasonCampaignCatalog, parseSeasonCampaignArguments, runCampaign, runSeasonCampaignMatrix, seasonCampaignFieldableCapacity, seasonCampaignXpDecision, selectAdaptiveCarry, selectEconPactCopyTarget, selectSeasonCampaignCore, selectSeasonCampaignSeeds } from '../../tools/resonance/balance-campaign.mjs';
import { resonanceOpenings, selectResonanceOpening } from '../../shared/resonance/openings.js';
import { resonanceSeasonOperatorIds } from '../../shared/resonance/season-roster.js';
import { createSession, validateSession } from '../../server/modes/resonance/session.js';
import { deployCampaignTeamForVerification, planCarryAdaptiveDeployment } from '../../tools/resonance/balance-campaign.mjs';

test('bounded opening selection finds one deterministic seed for every real event',()=>{
  const tasks=selectSeasonCampaignSeeds();assert.deepEqual(tasks.map(t=>t.openingId),Object.keys(resonanceOpenings));
  assert.deepEqual(selectSeasonCampaignSeeds(),tasks);
  for(const task of tasks)assert.equal(selectResonanceOpening(task.seed),task.openingId);
  assert.throws(()=>selectSeasonCampaignSeeds({openings:['invented']}),/unknown-or-duplicate/);
  assert.throws(()=>selectSeasonCampaignSeeds({searchLimit:0}),/bad-opening-seed-search/);
});

test('season CLI parsing keeps legacy baseline coverage and fixes data/output scope',()=>{
  assert.equal(ENVIRONMENTS.length,19);
  assert.equal(CANONICAL_DATA_DIR,'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
  const options=parseSeasonCampaignArguments(['--season','--dry-run','--opening','none,cheaper_levels','--policy',CARRY_ADAPTIVE_POLICY,'--timeout-ms','480000']);
  assert.deepEqual(options.openings,['none','cheaper_levels']);assert.equal(options.maxMs,480000);assert.equal(options.dryRun,true);
  assert.throws(()=>parseSeasonCampaignArguments(['--season','--unknown']),/invalid-season-option/);
});

test('a dry matrix creates only genuine new sessions and performs no combat or fabricated economy actions',()=>{
  const result=runSeasonCampaignMatrix({dryRun:true});assert.equal(result.status,'dry-run');assert.equal(result.recording,false);
  assert.equal(result.summary.runs,4);assert.equal(result.summary.battles,0);assert.equal(result.summary.errors,0);
  assert.equal(result.summary.allReachedTerminal,false);assert.deepEqual(result.activeOperatorIds,resonanceSeasonOperatorIds);
  for(const run of result.runs){
    assert.equal(run.rulesVersion,2);assert.equal(run.phase,'prep');assert.equal(run.round,1);assert.equal(run.gold,5);assert.equal(run.hp,100);
    assert.equal(run.listConsistent,true);assert.equal(run.poolConservation.ok,true);assert.deepEqual(run.policyActions,{});
    assert.deepEqual(getSeasonCampaignCatalog(run.seed).config.activeOperatorIds,resonanceSeasonOperatorIds);
  }
  assert.throws(()=>runSeasonCampaignMatrix({dryRun:true,maxMs:480001}),/within-eight-minutes/);
});

test('legacy environment baseline remains available without starting a battle',()=>{
  const run=runCampaign({environmentId:'origin_aegir',rulesVersion:1,seed:19,maxBattles:0,policy:CARRY_ADAPTIVE_POLICY});
  assert.equal(run.rulesVersion,1);assert.equal(run.environmentId,'origin_aegir');assert.equal(run.seasonId,null);
  assert.equal(run.activeOperatorIds.length,65);assert.equal(run.battles,0);assert.equal(run.phase,'prep');
});

test('season carry selection needs actual held eligible stock and survives the absence of a faction',()=>{
  const catalog=getSeasonCampaignCatalog(1),active=new Set(catalog.config.activeOperatorIds);
  const eligible=catalog.config.activeOperatorIds.map(id=>catalog.operators[id]).filter(op=>op.cost===3&&['damage','control'].includes(op.role));
  const outsider=Object.values(catalog.operators).find(op=>!active.has(op.id)&&op.cost===3&&op.role==='damage');
  const held={uid:'held',operatorId:eligible[0].id,star:2,row:9,col:3,equipment:[]};
  const state={rulesVersion:2,environmentId:null,level:7,inventory:[{itemId:'bow'}],pieces:[held,{uid:'unavailable',operatorId:outsider.id,star:3,row:9,col:4,equipment:[]}]};
  assert.equal(selectAdaptiveCarry(state,catalog).piece.uid,'held','the 154-entry encyclopedia cannot supply an unavailable carry');
  assert.equal(selectSeasonCampaignCore(state,catalog),held.operatorId);
  assert.equal(selectSeasonCampaignCore({...state,pieces:[]},catalog),null,'no theoretical terminal is designated without owning it');
  const next={uid:'new',operatorId:eligible[1].id,star:3,row:9,col:5,equipment:[]};
  assert.equal(selectSeasonCampaignCore({...state,pieces:[...state.pieces,next]},catalog,held.operatorId),held.operatorId,'a real pursuit stays with its stock branch');
});

test('season three-cost stock can be bought and copied before the legacy five-cost level gate',()=>{
  const catalog=getSeasonCampaignCatalog(1),op=catalog.config.activeOperatorIds.map(id=>catalog.operators[id]).find(op=>op.cost===3&&op.role==='damage');
  const core={uid:'core',operatorId:op.id,star:2,row:9,col:3,equipment:[]},aux={uid:'aux',operatorId:catalog.config.starterIds[0],star:1,row:null,equipment:[]};
  const state={rulesVersion:2,level:7,pieces:[core,aux]};
  assert.equal(campaignCorePurchaseAvailable(state,op),true);
  assert.equal(campaignCorePurchaseAvailable({...state,rulesVersion:1},op),false,'old environment benchmarks keep their level gate');
  assert.equal(campaignCorePurchaseAvailable(state,{cost:5}),false,'five-cost entry still needs its usual level gate');
  assert.equal(selectEconPactCopyTarget({kind:'smallCopy'},[core,aux],state,op.id,catalog),core,'legal low-cost copy advances the held two-star branch');
  assert.equal(selectEconPactCopyTarget({kind:'universalCopy'},[core,aux],state,op.id,catalog),core);
});

test('late season XP uses actual deployable copies and a finite real-gold budget',()=>{
  const catalog=getSeasonCampaignCatalog(1),op=Object.values(catalog.operators).find(o=>o.name==='能天使');
  const field={deployMap:new Map(Array.from({length:10},(_,i)=>[`${9+Math.floor(i/8)},${2+i%8}`,'ranged']))};
  const state={rulesVersion:2,round:28,level:7,hp:46,gold:233,strategies:[],pieces:Array.from({length:10},(_,i)=>({uid:`held${i}`,operatorId:op.id,star:1,row:null,equipment:[]}))};
  assert.equal(seasonCampaignFieldableCapacity(state,catalog,field),10,'legal repeated identities supply population; they do not supply extra pact count');
  assert.deepEqual(seasonCampaignXpDecision(state,catalog,field),{capacity:10,allowed:true,target:10,reserve:0,purchaseLimit:58});
  assert.equal(seasonCampaignXpDecision({...state,pieces:state.pieces.slice(0,7)},catalog,field).allowed,false,'no XP investment without an existing legal next member');
  assert.equal(seasonCampaignXpDecision({...state,round:15},catalog,field).reserve,30,'before the roll-down phase money remains reserved');
  assert.equal(seasonCampaignFieldableCapacity(state,catalog,{deployMap:new Map([['0,0','ranged']])}),0,'population cannot use a tile outside the native field');
});

test('fixed native skills distinguish physical carry gear from healer and being-hit gear',()=>{
  const catalog=getSeasonCampaignCatalog(1),find=name=>Object.values(catalog.operators).find(o=>o.name===name),physical=find('能天使'),healer=find('白面鸮'),arts=find('蜜蜡');
  assert.equal(campaignCombatProfile(physical,3).skill.index,physical.fixedSkillIndex);
  for(const id of ['ironWing','golemArmor','thornArmor'])assert.equal(carryItemScore(catalog.equipment[id],physical,3),0,id);
  for(const id of ['rapidBlade','giantSlayer','berserkBow'])assert(carryItemScore(catalog.equipment[id],physical,3)>carryItemScore(catalog.equipment.lifeSpring,physical,3),id);
  assert(carryItemScore(catalog.equipment.lifeSpring,healer,2)>carryItemScore(catalog.equipment.lifeSpring,physical,3));
  assert(carryItemScore(catalog.equipment.quietCape,arts,2)>carryItemScore(catalog.equipment.quietCape,physical,3),'RES penetration is arts carry gear');
  const ammo=find('隐现');assert.equal(campaignCombatProfile(ammo,2).ammo,true,'AMMO comes from the selected native kit even when the raw durationType is NONE');
  assert(carryItemScore(catalog.equipment.resonanceStaff,ammo,2)<carryItemScore(catalog.equipment.resonanceStaff,physical,3),'a sustained AMMO activation does not value SP recovery');
});

test('raw campaign pieces derive boss coverage from native range rather than absent report fields',()=>{
  const catalog=getSeasonCampaignCatalog(1),op=Object.values(catalog.operators).find(o=>o.name==='能天使');
  const piece={operatorId:op.id,star:3,row:9,col:3,dir:'RIGHT'};
  const profiles=[{points:[[0,0]],originalIndices:[0]},{points:[[9,5],[9,6]],originalIndices:[5]}];
  assert.deepEqual(campaignBossCoverage(piece,catalog,profiles,[5]),{deployed:true,coveredBossRouteIndices:[5],coversBossRoute:true});
  assert.equal(campaignBossCoverage({...piece,dir:'LEFT'},catalog,profiles,[5]).coversBossRoute,false);
  assert.equal(campaignBossCoverage(null,catalog,profiles,[5]).deployed,false);
});

test('season capacity and real placement both count legal duplicate stock',()=>{
  const catalog=getSeasonCampaignCatalog(1),created=createSession({seed:1,difficulty:'NORMAL',catalog});assert.equal(created.ok,true);
  const state=structuredClone(created.state),op=Object.values(catalog.operators).find(o=>o.name==='能天使');
  // A conserved unit-test inventory fixture; no campaign funds, shop or result are changed.
  for(const piece of state.pieces)state.poolRemaining[piece.operatorId]+=3**(piece.star-1);
  const template=state.pieces[0];state.level=9;
  state.pieces=Array.from({length:9},(_,i)=>({...template,uid:`fixture${i}`,operatorId:op.id,star:1,row:null,col:null,equipment:[]}));
  state.poolRemaining[op.id]-=9;
  assert.equal(validateSession(state,{catalog}).ok,true);
  const field=planCarryAdaptiveDeployment(state,catalog).field;
  const capacity=seasonCampaignFieldableCapacity(state,catalog,field);assert.equal(capacity,9);
  const placed=deployCampaignTeamForVerification(state,catalog,{coreOperatorId:op.id});
  assert.equal(placed.pieces.filter(p=>p.row!==null).length,capacity,'actual native deploy actions fill every counted slot');
  assert.equal(validateSession(placed,{catalog}).ok,true);assert.equal(placed.gold,state.gold);assert.deepEqual(placed.poolRemaining,state.poolRemaining);
  // Current season disables this old rule; a local catalog fixture verifies the supported active-rule boundary.
  const restricted=structuredClone(state),uniqueId='fixtureUnique',uniqueCatalog={...catalog,strategies:{...catalog.strategies,[uniqueId]:{id:uniqueId,effects:[{kind:'unique_nation_core'}]}}};
  restricted.strategies=[uniqueId];restricted.strategyState={[uniqueId]:{}};
  assert.equal(seasonCampaignFieldableCapacity(restricted,uniqueCatalog,field),1);
  assert.equal(deployCampaignTeamForVerification(restricted,uniqueCatalog).pieces.filter(p=>p.row!==null).length,1,'active unique rule is applied by both selection and fallback deployment');
});
