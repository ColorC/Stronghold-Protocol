import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import reference from '../../docs/resonance/reference/tft-set18.json' with { type:'json' };
import { resonanceContent as legacy } from '../../shared/resonance/catalog.js';

process.env.SP_DATA_DIR ??= 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const [{getData},{getResonanceCatalog},{applyCurrentStrategies,DISABLED_CURRENT_STRATEGY_IDS},{applyAction,createSession,unbiasedTransferChoices,viewSession},{makeBattle,chessRec,enemyRec},{installResonanceBattle},{selectResonanceOpening}] = await Promise.all([
  import('../../server/data.js'),import('../../server/modes/resonance/catalog.js'),import('../../shared/resonance/current-strategies.js'),import('../../server/modes/resonance/session.js'),import('../helpers/battleHarness.js'),import('../../server/sim/content/resonance/battle.js'),import('../../shared/resonance/openings.js'),
]);
const data=getData();
const current=getResonanceCatalog(data,{rulesVersion:2,seed:91});
const strategyCatalog=applyCurrentStrategies(current);
const officialPatch='https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-4/';
const tftSupplementUrl='https://tftraits.com/api/display/items?v=18-18.4.0.BF63CD5E.u09ac2d13s5&lang=en-us';
const readPointer=(root,pointer)=>pointer.split('/').slice(1).reduce((node,part)=>node?.[part.replaceAll('~1','/').replaceAll('~0','~')],root);
const fields=()=>({deployMap:new Map([['0,0','melee'],['0,1','ranged'],['0,2','melee'],['1,0','melee'],['1,1','ranged']])});
function create(seed=91){const result=createSession({seed,difficulty:'NORMAL',catalog:strategyCatalog});assert.equal(result.ok,true,result.error);return result.state;}
function act(state,action,opts={}){const result=applyAction(state,action,{catalog:strategyCatalog,...opts});assert.equal(result.ok,true,`${action.type}: ${result.error}`);return result.state;}
function selectStrategy(state,id){state.pendingChoices=[{uid:'test-strategy-choice',type:'strategy',options:[id],remaining:1}];state.phase='choice';return act(state,{type:'chooseStrategy',choiceUid:'test-strategy-choice',strategyId:id});}
const stubBattle=(metrics={})=>()=>({won:true,hpLoss:0,diagnostics:{errorCount:0},metrics});
function settle(state,metrics={}){return act(state,{type:'fight'},{fieldResolver:fields,battleRunner:stubBattle(metrics),recording:false});}
function progress(state,metrics={}){
  if(!state.nodeStarted){state=act(state,{type:'advanceSupply'});}
  while(state.pendingChoices.length){const choice=state.pendingChoices[0];if(choice.type==='strategy')state=act(state,{type:'chooseStrategy',choiceUid:choice.uid,strategyId:choice.options[0]});else state=act(state,{type:'claimReward',choiceUid:choice.uid,optionIds:[choice.options[0]]});}
  return settle(state,metrics);
}

test('v2 strategy overlay contains 28 entries, preserves all 36 legacy IDs, and evidence pointers resolve',()=>{
  assert.equal(Object.keys(legacy.strategies).length,36);
  assert.equal(Object.keys(strategyCatalog.strategies).length,28);
  for(const id of DISABLED_CURRENT_STRATEGY_IDS)assert.equal(strategyCatalog.strategies[id],undefined);
  for(const [strategyId,apiName,pointer] of [['strategy_13','DA_TeamBuilding','/supplement/publishedAugmentItems/226'],['strategy_14','DA_WovenMagic','/supplement/publishedAugmentItems/255'],['strategy_20','DA_PatientStudy','/supplement/publishedAugmentItems/176'],['strategy_21','DA_TradeSector','/supplement/publishedAugmentItems/235'],['strategy_22','DA_StandUnited','/supplement/publishedAugmentItems/217']]){
    const effect=strategyCatalog.strategies[strategyId].effects[0],ref=effect.reference;
    assert.equal(readPointer(reference,ref.jsonPointer).apiName,apiName);
    assert.equal(ref.jsonPointer,pointer);assert.equal(ref.recordId,apiName);assert.equal(ref.sourceUrl,tftSupplementUrl);
    assert.equal(ref.sourceKind,'community game-data derivative publication; current official legality unconfirmed');assert.equal(ref.patchUrl,officialPatch);
  }
  const buffet=strategyCatalog.strategies.strategy_14.effects[0].candidateReference;
  assert.equal(readPointer(reference,buffet.jsonPointer).apiName,'DA_ComponentBuffet');
  assert.equal(strategyCatalog.strategies.strategy_15,undefined);assert.equal(strategyCatalog.strategies.strategy_16,undefined);
  assert.equal(strategyCatalog.strategies.strategy_25.effects[0].reference.recordId,'Tome of Traits');
  assert.match(strategyCatalog.strategies.strategy_26.description,/不生成额外棋子，每盟约仅计该身份一次/);
  assert.equal(strategyCatalog.strategies.strategy_33.effects[0].params.sp,0);
  assert.doesNotMatch(strategyCatalog.strategies.strategy_33.description,/回返|回复|返还.*SP/);
});

test('Team Building pays one copy now and one after five actual battle settlements only',()=>{
  let state=create();
  const openingCopies=state.consumables.filter(x=>x.kind==='smallCopy').length;
  state=selectStrategy(state,'strategy_13');
  const initial=state.consumables.filter(x=>x.kind==='smallCopy').length;
  assert.equal(initial,openingCopies+1);
  for(let battle=1;battle<=4;battle++){
    state=progress(state);
    assert.equal(state.consumables.filter(x=>x.kind==='smallCopy').length,openingCopies+1,`battle ${battle} must not deliver the delayed copy`);
  }
  state=progress(state);
  assert.equal(state.consumables.filter(x=>x.kind==='smallCopy').length,openingCopies+2);
  const entry=state.strategyState.strategy_13;
  assert.equal(entry.battlesCompleted,5);assert.equal(entry.copyDelivered,true);
});

test('Woven Magic totals ammo across actual battles, offers four components once, and ignores supply nodes',()=>{
  let state=selectStrategy(create(),'strategy_14');
  const initialChoice=state.pendingChoices.find(x=>x.type==='components');
  assert.ok(initialChoice);assert.equal(initialChoice.options.length,1,'initial reward is one random component');
  state=act(state,{type:'claimReward',choiceUid:initialChoice.uid,optionIds:[initialChoice.options[0]]});
  state=settle(state,{ammoSpent:30});assert.equal(state.strategyState.strategy_14.ammoSpent,30);
  state=act(state,{type:'advanceSupply'});
  while(state.pendingChoices.length){const choice=state.pendingChoices[0];state=choice.type==='strategy'?act(state,{type:'chooseStrategy',choiceUid:choice.uid,strategyId:choice.options[0]}):act(state,{type:'claimReward',choiceUid:choice.uid,optionIds:[choice.options[0]]});}
  assert.equal(state.strategyState.strategy_14.ammoSpent,30,'logistics do not add ammo progress');
  state=settle(state,{ammoSpent:30});
  const reward=state.pendingChoices.find(x=>x.type==='components');assert.ok(reward);assert.equal(reward.options.length,4);
  assert.equal(state.strategyState.strategy_14.ammoSpent,60);assert.equal(state.strategyState.strategy_14.rewarded,true);
  state=act(state,{type:'claimReward',choiceUid:reward.uid,optionIds:[reward.options[0]]});
  state=act(state,{type:'advanceSupply'});while(state.pendingChoices.length){const c=state.pendingChoices[0];state=c.type==='strategy'?act(state,{type:'chooseStrategy',choiceUid:c.uid,strategyId:c.options[0]}):act(state,{type:'claimReward',choiceUid:c.uid,optionIds:[c.options[0]]});}
  state=settle(state,{ammoSpent:100});assert.equal(state.pendingChoices.filter(x=>x.source==='strategy_14').length,0,'threshold reward cannot repeat');
  assert.equal(state.strategyState.strategy_14.ammoSpent,160,'run-scoped ammo total persists across battle settlements');
});

test('Trade Sector keeps per-node and opening refresh balances independent and conserves both',()=>{
  let state=selectStrategy(create(),'strategy_21');
  state.freeRefreshes=8;
  assert.equal(viewSession(state,{catalog:strategyCatalog}).actionCosts.freeRefreshes,9,'eight stored opening refreshes coexist with one node right');
  assert.equal(viewSession(state,{catalog:strategyCatalog}).actionCosts.refreshGold,0);
  state=act(state,{type:'refresh'});
  assert.equal(state.strategyState.strategy_21.freeAvailable,false);
  assert.equal(state.freeRefreshes,8,'consuming the node right leaves opening stock untouched');
  assert.equal(viewSession(state,{catalog:strategyCatalog}).actionCosts.freeRefreshes,8);
  state=settle(state);
  state=act(state,{type:'advanceSupply'});
  assert.equal(state.strategyState.strategy_21.freeAvailable,true,'node entitlement resets at the next node');
  assert.equal(state.freeRefreshes,8);
  assert.equal(viewSession(state,{catalog:strategyCatalog}).actionCosts.freeRefreshes,9);

  let withoutOpening=selectStrategy(create(),'strategy_21');
  withoutOpening=settle(withoutOpening);
  withoutOpening=act(withoutOpening,{type:'advanceSupply'});
  assert.equal(withoutOpening.freeRefreshes,0);
  assert.equal(withoutOpening.strategyState.strategy_21.freeAvailable,true);
  assert.equal(viewSession(withoutOpening,{catalog:strategyCatalog}).actionCosts.freeRefreshes,1,'unused node entitlement does not accumulate into a stored balance');
});

test('transfer candidates are seeded, capped at four distinct pacts, and exclude unique pacts only in v2',()=>{
  const left=unbiasedTransferChoices({seed:404,rngCounter:0},strategyCatalog,4),right=unbiasedTransferChoices({seed:404,rngCounter:0},strategyCatalog,4);
  assert.deepEqual(left,right);assert.equal(left.length,4);assert.ok(left.every(id=>strategyCatalog.equipment[id]?.kind==='emblem'));
  const pacts=left.map(id=>strategyCatalog.equipment[id].effects.find(effect=>['pact_transfer','transfer_pact'].includes(effect.kind))?.params?.pactId);
  assert.equal(new Set(pacts).size,left.length,'aliases for one pact must not occupy multiple candidate slots');
  assert.ok(!pacts.some(id=>['holyGun','yela','crown'].includes(id)),'unique pacts have no v2 transfer offers');
  const removed=['transfer_holyGun','transfer_yela','transfer_crown','transfer_breaker','transfer_arts','transfer_ammo','transfer_control','transfer_symbiosis','transfer_aegir','transfer_yan'];
  for(const id of removed)assert.equal(current.equipment[id],undefined);
  for(const id of ['breakerTransfer','artsTransfer','ammoTransfer','controlTransfer','symbiosisTransfer','aegirTransfer','yanTransfer'])assert.ok(current.equipment[id],'craftable transfer remains the single v2 item for its pact');
  assert.equal(Object.values(legacy.equipment).filter(item=>item.kind==='emblem').length,43,'legacy transfer inventory remains intact');
  for(const id of removed)assert.ok(legacy.equipment[id],'legacy inventory retains removed v2 aliases and unique transfers');
});

test('v2 last-ammo event deals damage without SP refund while v1 retains legacy refund',()=>{
  const gun=chessRec({id:'test_gun',charId:'test_gun',profession:'WARRIOR',stats:{maxHp:2000,atk:500,def:100,blockCnt:1},rangeGrid:[[0,0],[0,1],[0,2]],skill:null});
  const defs={chess:{test_gun:gun},enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:10000,speed:0})}};
  function run(catalog, rulesVersion){
    const battleCatalog={...catalog,operators:{...catalog.operators,test_gun:{id:'test_gun',charId:'test_gun',sourceChessId:'test_gun',pacts:[],stars:{1:{passive:{kind:'none',params:{}}}}}}};
    const state={rulesVersion,strategies:[{id:'strategy_33'}],strategyState:{},pieces:[]};
    const h=makeBattle({defs,units:[{chessId:'test_gun',uid:'gun',row:9,col:5}],enemies:[],content:'generic',autoFinish:false,recordEvents:false,kits:{test_gun:()=>({skill:{id:'test_skill',kind:'ammo',duration:30,ammo:1,spCost:1,initSp:0,spType:'time'}})},extraContent:[b=>installResonanceBattle(b,{catalog:battleCatalog,state})]});
    h.b.start();const u=h.unit('gun'),target=h.spawn('enemy_dummy',{pos:[9,7]});u.skill.gainSp(10,'test-ready');assert.equal(u.skill.activate('test'),true);const before=target.hp;h.b.forceAttack(u,[target]);
    const damaged=before-target.hp,pendingSp=u.mem.resonanceLastAmmoSp;u.skill.end('test');return {u,target,before,damaged,pendingSp,sp:u.skill.sp};
  }
  const v2=run(strategyCatalog,2);assert.equal(v2.damaged,1250);assert.equal(v2.u.mem.resonanceLastAmmoSp,undefined);assert.equal(v2.sp,0);
  const v1=run(legacy,1);assert.equal(v1.damaged,1250);assert.ok(v1.sp>0,'legacy skill-end refund remains active');
});

test('Stand United deployed preview and battle wiring remain tied to active thresholds',()=>{
  const battle=fs.readFileSync(fileURLToPath(new URL('../../server/sim/content/resonance/battle.js',import.meta.url)),'utf8');
  const display=fs.readFileSync(fileURLToPath(new URL('../../server/modes/resonance/display.js',import.meta.url)),'utf8');
  assert.match(battle,/function applyStandUnited/);assert.match(battle,/singleUnique===true/);assert.match(battle,/if\(sp>0\).*deal\(b,u,lastTarget/s);
  assert.match(display,/strategyPreview:\{standUnited:/);
});
