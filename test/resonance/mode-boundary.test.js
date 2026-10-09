import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { getData } from '../../server/data.js';
import { getResonanceCatalog, getLegacyResonanceCatalog, getResonanceCatalogForState } from '../../server/modes/resonance/catalog.js';
import { createSession, applyAction, validateSession } from '../../server/modes/resonance/session.js';
import { createResonanceHttp } from '../../server/modes/resonance/http.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { buildResonanceBattle } from '../../server/modes/resonance/battle.js';
import { resonanceOpenings, selectResonanceOpening } from '../../shared/resonance/openings.js';
import { resonanceSeason, resonanceSeasonOperatorIds, validateResonanceSeasonRoster } from '../../shared/resonance/season-roster.js';

const data=getData();
const canonical='E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const seeds=Object.fromEntries(Object.keys(resonanceOpenings).map(id=>[id,Array.from({length:1000},(_,n)=>n).find(seed=>selectResonanceOpening(seed)===id)]));
function newRun(openingId='none'){
  const seed=seeds[openingId],catalog=getResonanceCatalog(data,{rulesVersion:2,seed});
  const result=createSession({seed,catalog});assert.equal(result.ok,true,result.error);
  return {state:result.state,catalog};
}
function invoke(handler,method,url,body){
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  req.method=method;req.url=url;req.headers={host:'local.test'};
  const res={headersSent:false,writableEnded:false,destroyed:false,status:0,writeHead(status){this.status=status;this.headersSent=true;},end(text){this.body=JSON.parse(text);this.writableEnded=true;}};
  return handler(req,res,new URL(url,'http://local.test').pathname).then(()=>res);
}

test('all new seeds, opening encounters and difficulties share the same explicit 65-member season roster',()=>{
  const first=newRun();assert.equal(first.state.activeOperatorIds.length,65);assert.deepEqual(first.state.activeOperatorIds,resonanceSeasonOperatorIds);
  for(const seed of Object.values(seeds)) for(const difficulty of ['FUNNY','NORMAL','HARD','ABYSS']){
    const catalog=getResonanceCatalog(data,{rulesVersion:2,seed});
    const created=createSession({seed,difficulty,catalog});assert.equal(created.ok,true,created.error);
    assert.deepEqual(created.state.activeOperatorIds,first.state.activeOperatorIds);
    assert.equal(created.state.seasonId,resonanceSeason.id);assert.equal(Object.keys(catalog.operators).length,154);
    assert.equal(created.state.environmentId,null);assert.equal(created.state.rulesVersion,2);
    assert.deepEqual(catalog.campaign.strategyNodes,[5,13,20]);
    assert.equal(catalog.campaign.supply.acceleratedStrategy,undefined);
    assert.ok(catalog.campaign.supply.transfers.every(entry=>entry.selection==='viable-pact'));
    assert.equal(validateSession(created.state,{catalog}).ok,true);
  }
});

test('the explicit season validates IDs, identities, fees, starter supply and preserves the named terminals and elemental roles',()=>{
  const {catalog}=newRun();const ids=[...resonanceSeasonOperatorIds];
  assert.deepEqual(validateResonanceSeasonRoster(catalog.operators),ids);
  const missing=[...ids];missing[0]='unknown';assert.throws(()=>validateResonanceSeasonRoster(catalog.operators,missing),/UNKNOWN_SEASON_OPERATOR/);
  const duplicate=[...ids];duplicate[1]=duplicate[0];assert.throws(()=>validateResonanceSeasonRoster(catalog.operators,duplicate),/BAD_SEASON_ROSTER/);
  const wrongFee={...catalog.operators,[ids[0]]:{...catalog.operators[ids[0]],cost:5}};
  assert.throws(()=>validateResonanceSeasonRoster(wrongFee),/BAD_SEASON_QUOTA/);
  const noHealer=Object.fromEntries(Object.entries(catalog.operators).map(([id,op])=>[id,op.cost===1&&op.role==='healer'?{...op,role:'damage'}:op]));
  assert.throws(()=>validateResonanceSeasonRoster(noHealer),/STARTERS_UNAVAILABLE/);
  const members=ids.map(id=>catalog.operators[id]);
  for(const name of ['新约能天使','圣聆初雪','乌尔比安'])assert.ok(members.some(op=>op.name===name),name);
  for(const pact of ['holyGun','yela','sui','crown','burn','necrosis'])assert.ok(members.some(op=>op.pacts.includes(pact)),pact);
  assert.ok(members.every(op=>op.pacts.length<=3));
  const legacy=getLegacyResonanceCatalog(data,{environmentId:'origin_yan',seed:19});
  assert.deepEqual(legacy.operators.chess_char_6_03_a.pacts,['yan','combo']);
  assert.deepEqual(catalog.operators.chess_char_6_03_a.pacts,['yan','combo','sui']);
  assert.deepEqual(getLegacyResonanceCatalog(data,{environmentId:'origin_yan',seed:19}).operators.chess_char_6_03_a.pacts,['yan','combo'],'new trait must not mutate the operator cache');
  const altered=newRun().state;altered.phase='choice';
  altered.pendingChoices=[{uid:'invalid-reward',type:'operators',source:'fixture',options:['chess_native_char_2023_ling_a'],remaining:1}];
  assert.ok(validateSession(altered,{catalog}).errors.some(error=>error.code==='INACTIVE_REWARD_OPERATOR'));
});

test('new strategy gifts and deferred operator choices use only active season IDs',()=>{
  for(const strategyId of ['strategy_04','strategy_12']){
    const {state,catalog}=newRun();
    const limited={...catalog,strategies:{[strategyId]:catalog.strategies[strategyId]}};
    state.round=5;state.nodeStarted=false;
    const supplied=applyAction(state,{type:'advanceSupply'},{catalog:limited});assert.equal(supplied.ok,true,supplied.error);
    const strategyChoice=supplied.state.pendingChoices.find(choice=>choice.type==='strategy');assert.ok(strategyChoice);
    const selected=applyAction(supplied.state,{type:'chooseStrategy',choiceUid:strategyChoice.uid,strategyId},{catalog:limited});
    assert.equal(selected.ok,true,selected.error);
    const operatorChoices=selected.state.pendingChoices.filter(choice=>['operators','target_operator'].includes(choice.type));
    assert.ok(operatorChoices.length);assert.ok(operatorChoices.every(choice=>choice.options.every(id=>resonanceSeasonOperatorIds.includes(id))));
    assert.deepEqual(Object.keys(selected.state.poolRemaining).sort(),[...resonanceSeasonOperatorIds].sort());
  }
});

test('opening effects preserve actual refresh prices, XP purchases and pool conservation',()=>{
  const double=newRun('double_duplicators');
  assert.deepEqual(double.state.consumables.map(x=>x.kind),['smallCopy']);
  double.state.round=14;double.state.nodeStarted=false;
  const awarded=applyAction(double.state,{type:'advanceSupply'},{catalog:double.catalog});
  assert.equal(awarded.ok,true,awarded.error);assert.equal(awarded.state.consumables.filter(x=>x.source==='opening').length,2);
  const duplicate=applyAction(awarded.state,{type:'advanceSupply'},{catalog:double.catalog});assert.equal(duplicate.ok,false);
  assert.deepEqual(duplicate.state,awarded.state,'rejected repeat cannot duplicate the reward');
  const copied=applyAction(awarded.state,{type:'useCopy',consumableUid:awarded.state.consumables[0].uid,pieceUid:awarded.state.pieces[0].uid},{catalog:double.catalog});
  assert.equal(copied.ok,true,copied.error);assert.equal(validateSession(copied.state,{catalog:double.catalog}).ok,true);
  const reroll=newRun('reroll_start');reroll.state.round=5;reroll.state.nodeStarted=false;
  let current=applyAction(reroll.state,{type:'advanceSupply'},{catalog:reroll.catalog});assert.equal(current.ok,true,current.error);
  assert.equal(current.state.freeRefreshes,8);current.state.gold=0;
  for(let i=0;i<8;i++){
    current=applyAction(current.state,{type:'refresh'},{catalog:reroll.catalog});assert.equal(current.ok,true,current.error);
    assert.equal(current.state.gold,0);assert.equal(current.state.freeRefreshes,7-i);
    assert.equal(validateSession(current.state,{catalog:reroll.catalog}).ok,true);
  }
  const ninth=applyAction(current.state,{type:'refresh'},{catalog:reroll.catalog});assert.equal(ninth.error,'NOT_ENOUGH_GOLD');
  const cheap=newRun('cheaper_levels');const xp=applyAction(cheap.state,{type:'buyXp'},{catalog:cheap.catalog});
  assert.equal(xp.ok,true,xp.error);assert.equal(xp.state.gold,1);assert.equal(xp.state.level,4);assert.equal(xp.state.xp,0);
  const ordinary=newRun();const ordinaryXp=applyAction(ordinary.state,{type:'buyXp'},{catalog:ordinary.catalog});
  assert.equal(ordinaryXp.state.level,3);assert.equal(ordinaryXp.state.xp,4);
});

test('corrupt rules/opening are rejected and legacy catalogs restore the original 65-member pool',()=>{
  const run=newRun();for(const patch of [{rulesVersion:9},{rulesVersion:null},{seasonId:'invented'},{openingId:'invented'},{seed:0x100000000},{environmentId:'origin_kjerag'}]){
    assert.equal(validateSession({...run.state,...patch},{catalog:run.catalog}).ok,false);
  }
  const legacy=getLegacyResonanceCatalog(data,{seed:812,environmentId:'origin_aegir'});
  const old=createSession({seed:812,catalog:legacy,environmentId:'origin_aegir'});assert.equal(old.ok,true,old.error);
  assert.equal(old.state.rulesVersion,undefined);assert.equal(old.state.activeOperatorIds.length,65);
  assert.deepEqual(getResonanceCatalogForState(data,old.state).config.activeOperatorIds,old.state.activeOperatorIds);
  assert.deepEqual(legacy.campaign.strategyNodes,[3,9,15,21]);assert.equal(legacy.campaign.supply.acceleratedStrategy.node,26);
  assert.deepEqual(applyAction(old.state,{type:'lockShop',locked:true},{catalog:legacy}).state.activeOperatorIds,old.state.activeOperatorIds);
});

test('new battle installation suppresses every legacy environment fallback',()=>{
  const {state,catalog}=newRun();
  const oldSnow=catalog.environments.origin_kjerag;
  const injected={...state,environmentId:'origin_kjerag',environment:oldSnow,env:oldSnow,field:{environment:oldSnow}};
  const {battle}=buildResonanceBattle(injected,{data,catalog,recording:false,preview:true});
  battle.start();assert.equal(battle.resonanceFloors,null,'legacy snow never installs in v2');
  assert.equal(battle.errorCount,0);
});

test('HTTP rejects faction/opening selection, hides legacy globals and reopens a real saved legacy run',async(t)=>{
  const base=path.join(canonical,'.omni/tmp/resonance');await mkdir(base,{recursive:true});
  const directory=await mkdtemp(path.join(base,'mode-boundary-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const handler=createResonanceHttp({data,directory,fieldResolver:()=>null,statsPreview:()=>({})});
  for(const extra of [{environmentId:'origin_laterano'},{openingId:'none'},{rulesVersion:1}]){
    const denied=await invoke(handler,'POST','/resonance/api/sessions',{seed:1,difficulty:'NORMAL',...extra});
    assert.equal(denied.status,422);assert.equal(denied.body.error.code,'UNSUPPORTED_SESSION_INPUT');
  }
  const catalog=await invoke(handler,'GET',`/resonance/api/catalog?seed=${seeds.none}`);
  assert.equal(catalog.body.environmentChoices,undefined);assert.deepEqual(catalog.body.catalog.environments,{});
  assert.equal(Object.keys(catalog.body.catalog.openingEvents).length,4);
  assert.deepEqual(catalog.body.catalog.openingEvent,resonanceDisplayCatalog(newRun().catalog,data).openingEvent);
  const created=await invoke(handler,'POST','/resonance/api/sessions',{seed:seeds.none,difficulty:'NORMAL'});
  assert.equal(created.status,201);assert.equal(created.body.state.activeOperatorIds.length,65);assert.equal(created.body.state.openingEvent.name,'标准开局');
  const id='53ffde79-85b3-4302-89f7-e0d792f78723';
  const original=await readFile(path.join(canonical,'runtime/resonance/player-sessions',`${id}.json`),'utf8');
  const stored=JSON.parse(original);await writeFile(path.join(directory,`${id}.json`),original);
  const loaded=await invoke(handler,'GET',`/resonance/api/sessions/${id}`);assert.equal(loaded.status,200,JSON.stringify(loaded.body.error));
  assert.deepEqual(loaded.body.state.activeOperatorIds,stored.activeOperatorIds);
  assert.equal(loaded.body.catalog.activeOperatorIds.length,65);
  const acted=await invoke(handler,'POST',`/resonance/api/sessions/${id}/actions`,{expectedRevision:stored.revision,action:{type:'lockShop',locked:!stored.shop.locked}});
  assert.equal(acted.status,200,JSON.stringify(acted.body.error));assert.equal(acted.body.state.revision,stored.revision+1);
  assert.deepEqual(acted.body.state.activeOperatorIds,stored.activeOperatorIds);
  assert.equal(await readFile(path.join(canonical,'runtime/resonance/player-sessions',`${id}.json`),'utf8'),original,'the real save stays read-only');
});
