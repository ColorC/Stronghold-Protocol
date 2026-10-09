import test from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_DATA_DIR, CARRY_ADAPTIVE_POLICY, ENVIRONMENTS, campaignCorePurchaseAvailable, getSeasonCampaignCatalog, parseSeasonCampaignArguments, runCampaign, runSeasonCampaignMatrix, selectAdaptiveCarry, selectEconPactCopyTarget, selectSeasonCampaignCore, selectSeasonCampaignSeeds } from '../../tools/resonance/balance-campaign.mjs';
import { resonanceOpenings, selectResonanceOpening } from '../../shared/resonance/openings.js';
import { resonanceSeasonOperatorIds } from '../../shared/resonance/season-roster.js';

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
