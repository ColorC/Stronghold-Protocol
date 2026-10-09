import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction, calculateRoundIncome, createSession, validateSession, viewSession, resonanceRules,
} from '../../server/modes/resonance/session.js';
import { combatStatsOf } from '../../server/modes/resonance/battle.js';

const operators = Object.fromEntries([
  ['m1',1,'MELEE'],['m2',1,'MELEE'],['r1',1,'RANGED'],['m3',1,'MELEE'],['r2',1,'RANGED'],
  ['m4',1,'MELEE'],['r3',1,'RANGED'],['m5',1,'MELEE'],['r4',1,'RANGED'],['m6',1,'MELEE'],
  ['u2',2,'MELEE'],['u3',3,'RANGED'],['u4',4,'MELEE'],['u5',5,'RANGED'],
].map(([id,cost,position])=>[id,{id,charId:`char_${id}`,cost,position,role:'test',fixedSkillIndex:0,sourceChessId:`chess_${id}`,tags:[]} ]));
const equipment = Object.fromEntries(['part-a','part-b','part-c','finished','emblem'].map((id,index)=>[id,{id,kind:index<3?'component':index===3?'completed':'emblem'}]));
const catalog = {
  operators,
  equipment,
  recipes:[{parts:['part-a','part-b'],resultId:'finished'}],
  campaign:{supply:{components:{nodes:[4],countPerNode:2,kind:'component'}},strategyNodes:[],nodeSchedule:{FUNNY:{oddNodeGold:5,oddNodeXp:2}}},
  config:{starterIds:['m1','m2','r1'],starterEquipmentIds:['part-a','part-b']},
};
const fields = () => ({deployMap:new Map([['0,0','melee'],['0,1','ranged'],['0,2','melee'],['1,0','melee'],['1,1','ranged'],['1,2','melee'],['2,0','melee'],['2,1','ranged'],['2,2','melee']])});
function session(seed=1,difficulty='NORMAL') {
  const created=createSession({seed,difficulty,catalog});
  assert.equal(created.ok,true,created.error);
  assert.equal(validateSession(created.state,{catalog}).ok,true);
  return created.state;
}
function act(state,action,options={}) {
  const result=applyAction(state,action,{catalog,fieldResolver:fields,...options});
  assert.equal(result.ok,true,result.error);
  return result;
}
function deployOne(state) {
  const piece=state.pieces.find((entry)=>entry.row===null);
  return act(state,{type:'deploy',pieceUid:piece.uid,row:0,col:0,dir:'RIGHT'}).state;
}
function holdCopies(state,operatorId) {
  return state.pieces.filter((piece)=>piece.operatorId===operatorId).reduce((sum,piece)=>sum+({1:1,2:3,3:9}[piece.star]),0);
}
function assertPoolConserved(state) {
  const validation=validateSession(state,{catalog});
  assert.equal(validation.ok,true,JSON.stringify(validation.errors));
}

test('combatStatsOf copies only the native per-unit measurements and keeps unknown values null',()=>{
  assert.deepEqual(combatStatsOf({unitStats:[
    {uid:41,defId:'chess_m1',kind:'op',dmg:18.5,heal:2.25,taken:4.5,kills:1,attacks:3},
    {uid:42,defId:'token_m1',kind:'token',dmg:0,kills:0,heal:Infinity},
  ]}),{units:[
    {uid:41,defId:'chess_m1',kind:'op',dmg:18.5,heal:2.25,taken:4.5,kills:1,attacks:3},
    {uid:42,defId:'token_m1',kind:'token',dmg:0,heal:null,taken:null,kills:0,attacks:null},
  ]});
  assert.equal(combatStatsOf({}),null);
  assert.deepEqual(combatStatsOf({unitStats:[]}),{units:[]});
});
function installTargetOffer(state,operatorId='m1') {
  if(state.shop.offers.some((offer)=>offer.operatorId===operatorId))return;
  const slot=state.shop.offers.find((offer)=>offer.operatorId!==operatorId);
  assert.ok(slot);
  if(slot.operatorId)state.poolRemaining[slot.operatorId]++;
  state.poolRemaining[operatorId]--;
  slot.operatorId=operatorId;slot.cost=operators[operatorId].cost;
}
function fullBenchFixture() {
  const state=session(900);
  for(const id of ['m1','m3','r2','m4','r3','m5']) {
    state.poolRemaining[id]--;
    state.pieces.push({uid:`fixture-${id}`,operatorId:id,star:1,equipment:[],growth:{},row:null,col:null,dir:'RIGHT'});
  }
  installTargetOffer(state);
  assert.equal(state.pieces.filter((piece)=>piece.row===null).length,9);
  assertPoolConserved(state);
  return state;
}

test('counter RNG resumes exactly, initial starters are distinct and honor melee/ranged supply',()=>{
  const left=session(1234),right=session(1234);
  assert.deepEqual(left,right);
  const held=left.pieces.map((piece)=>piece.operatorId);
  assert.equal(new Set(held).size,3);
  assert.ok(held.filter((id)=>operators[id].position==='MELEE').length>=2);
  assert.ok(held.filter((id)=>operators[id].position==='RANGED').length>=1);
  const before=structuredClone(left);
  const a=act(left,{type:'refresh',expectedRevision:0});
  const b=act(right,{type:'refresh',expectedRevision:0});
  assert.deepEqual(a.state,b.state);
  assert.deepEqual(a.events,b.events);
  assert.deepEqual(left,before,'input state remains immutable');
  assert.equal(a.state.rngCounter>left.rngCounter,true);
  assertPoolConserved(a.state);
});

test('active 65-style catalog slice controls pool and shop while retaining detail catalog',()=>{
  const activeCatalog={...catalog,config:{...catalog.config,activeOperatorIds:['m1','m2','r1']}};
  const created=createSession({seed:91,difficulty:'NORMAL',environmentId:'env-18',catalog:activeCatalog});
  assert.equal(created.ok,true,created.error);
  assert.equal(created.state.environmentId,'env-18');
  assert.deepEqual(Object.keys(created.state.poolRemaining).sort(),['m1','m2','r1']);
  assert.ok(created.state.shop.offers.every((offer)=>offer.operatorId===null||['m1','m2','r1'].includes(offer.operatorId)));
  assert.equal(operators.u5.id,'u5','inactive source detail remains available in full catalog');
  const invalid=structuredClone(created.state);invalid.poolRemaining.u5=9;
  assert.ok(validateSession(invalid,{catalog:activeCatalog}).errors.some((error)=>error.code==='INACTIVE_POOL_ID'));
  const inactiveOffer=structuredClone(created.state);inactiveOffer.poolRemaining.r1++;
  inactiveOffer.shop.offers[0]={uid:'x-inactive',operatorId:'u5',cost:5};inactiveOffer.poolRemaining.u5=8;
  assert.ok(validateSession(inactiveOffer,{catalog:activeCatalog}).errors.some((error)=>error.code==='INACTIVE_OFFER_OPERATOR'));
});

test('design probability table, difficulty limits, caller revision and view field uncertainty',()=>{
  assert.deepEqual(resonanceRules.oddsByLevel[7],[.16,.30,.43,.10,.01]);
  assert.deepEqual(resonanceRules.xpToLevel,{3:6,4:10,5:20,6:36,7:56,8:68,9:68});
  assert.equal(session(4,'FUNNY').roundLimit,28);
  assert.equal(createSession({seed:4,difficulty:'EASY',catalog}).ok,false);
  assert.equal(session(4,'NORMAL').roundLimit,28);
  assert.equal(session(4,'HARD').roundLimit,28);
  assert.equal(session(4,'ABYSS').roundLimit,30);
  const state=session(5);
  const changed=act(state,{type:'lockShop',locked:true,expectedRevision:0}).state;
  const stale=applyAction(changed,{type:'lockShop',locked:false,expectedRevision:0},{catalog});
  assert.equal(stale.ok,false);
  assert.equal(stale.error,'STALE_REVISION');
  assert.equal(changed.shop.locked,true);
  assert.equal(viewSession(state,{catalog}).legalFieldStatus,'unknown');
  assert.equal(viewSession(state,{catalog,fieldResolver:fields}).legalFieldStatus,'resolved');
});

test('session view preserves all terminal reasons and keeps active sessions null',()=>{
  const active=session(81);
  assert.equal(viewSession(active,{catalog}).terminalReason,null);
  const cases=[
    ['victory',{round:28,hp:100}],
    ['hp-depleted',{round:12,hp:0}],
    ['round-limit-loss',{round:28,hp:100}],
  ];
  for(const [reason,changes] of cases){
    const state={...structuredClone(active),...changes,phase:'complete',terminalReason:reason};
    const viewed=viewSession(state,{catalog});
    assert.equal(viewed.ok,true,JSON.stringify(viewed.errors));
    assert.equal(viewed.terminalReason,reason);
  }
});

test('XP purchase crosses thresholds correctly and max level never charges',()=>{
  const initial=session(8);
  const near=structuredClone(initial);near.xp=5;
  const bought=act(near,{type:'buyXp'}).state;
  assert.equal(bought.level,4);
  assert.equal(bought.xp,3);
  assert.equal(bought.gold,1);
  const max=structuredClone(initial);max.level=10;max.xp=0;
  const denied=applyAction(max,{type:'buyXp'},{catalog});
  assert.equal(denied.ok,false);assert.equal(denied.error,'MAX_LEVEL');
  assert.deepEqual(denied.state,max);
});

test('sell returns source copies and follows one-star refund rule',()=>{
  const state=session(9);const piece=state.pieces[0];const before=state.poolRemaining[piece.operatorId];
  const result=act(state,{type:'sell',pieceUid:piece.uid});
  assert.equal(result.state.gold,6);
  assert.equal(result.state.poolRemaining[piece.operatorId],before+1);
  assertPoolConserved(result.state);
});

test('same-identity copies merge 3→2→3 without minting pool copies',()=>{
  let state=deployOne(session(42));
  const origin=state.pieces.find((piece)=>piece.operatorId==='m1');
  state.gold=100;
  let sawTwo=false;
  while(holdCopies(state,'m1')<9){
    installTargetOffer(state);
    const offer=state.shop.offers.find((entry)=>entry.operatorId==='m1');
    state=act(state,{type:'buy',offerUid:offer.uid}).state;
    if(state.pieces.some((piece)=>piece.operatorId==='m1'&&piece.star===2))sawTwo=true;
  }
  assert.equal(sawTwo,true);
  assert.equal(holdCopies(state,'m1'),9);
  assert.ok(state.pieces.some((piece)=>piece.operatorId==='m1'&&piece.star===3&&piece.uid===origin.uid));
  assertPoolConserved(state);
  const star3=state.pieces.find((piece)=>piece.operatorId==='m1'&&piece.star===3);
  const sold=act(state,{type:'sell',pieceUid:star3.uid}).state;
  assert.equal(sold.poolRemaining.m1,state.poolRemaining.m1+9);
  assertPoolConserved(sold);
});

test('full bench admits a purchase that merges and preserves the selected target',()=>{
  const state=fullBenchFixture();
  const first=state.pieces.find((piece)=>piece.operatorId==='m1');
  const offer=state.shop.offers.find((entry)=>entry.operatorId==='m1');
  const result=act(state,{type:'buy',offerUid:offer.uid,mergeTargetUid:first.uid});
  assert.equal(result.state.pieces.filter((piece)=>piece.row===null).length,8);
  assert.equal(result.state.pieces.find((piece)=>piece.operatorId==='m1'&&piece.star===2).uid,first.uid);
  assertPoolConserved(result.state);
});

test('equipment recipe is symmetric and cross-piece combination is rejected atomically',()=>{
  let state=session(18);
  const ids=state.inventory.map((item)=>item.uid);
  const combined=act(state,{type:'combine',itemUids:[ids[1],ids[0]]});
  state=combined.state;
  assert.equal(state.inventory.length,1);
  assert.equal(state.inventory[0].itemId,'finished');
  const item=state.inventory[0];const piece=state.pieces[0];
  state=act(state,{type:'equip',itemUid:item.uid,pieceUid:piece.uid}).state;
  const equipped=piece.uid;
  assert.equal(state.pieces.find((p)=>p.uid===equipped).equipment[0].itemId,'finished');
  state=act(state,{type:'unequip',itemUid:state.pieces.find((p)=>p.uid===equipped).equipment[0].uid}).state;
  assert.equal(state.inventory.some((entry)=>entry.itemId==='finished'),true);

  const split=session(19);const [first,second]=split.pieces;
  split.pieces[0].equipment.push({uid:'fixture-e1',itemId:'part-a'});
  split.pieces[1].equipment.push({uid:'fixture-e2',itemId:'part-b'});
  split.inventory=[];
  split.nextUid=10;
  assertPoolConserved(split);
  const before=structuredClone(split);
  const rejected=applyAction(split,{type:'combine',itemUids:['fixture-e1','fixture-e2']},{catalog});
  assert.equal(rejected.ok,false);assert.equal(rejected.error,'CROSS_OPERATOR_COMBINE');
  assert.deepEqual(split,before);
});

test('recycleEquipment explicitly destroys inventory or equipped item without gold',()=>{
  let state=session(28);const gold=state.gold;const inv=state.inventory[0];
  state=act(state,{type:'recycleEquipment',itemUid:inv.uid}).state;
  assert.equal(state.inventory.some((item)=>item.uid===inv.uid),false);assert.equal(state.gold,gold);
  const target=state.pieces[0];const item=state.inventory[0];
  state=act(state,{type:'equip',itemUid:item.uid,pieceUid:target.uid}).state;
  const equipped=state.pieces.find((piece)=>piece.uid===target.uid).equipment[0];
  const beforeGold=state.gold;
  state=act(state,{type:'recycleEquipment',itemUid:equipped.uid}).state;
  assert.equal(state.pieces.find((piece)=>piece.uid===target.uid).equipment.length,0);assert.equal(state.gold,beforeGold);
  const before=structuredClone(state);const rejected=applyAction(state,{type:'recycleEquipment',itemUid:'missing'},{catalog});
  assert.equal(rejected.ok,false);assert.equal(rejected.error,'ITEM_NOT_FOUND');assert.deepEqual(rejected.state,before);
});

test('equipment overflow rejects the whole merge with full inventory',()=>{
  const state=fullBenchFixture();
  const targetPieces=state.pieces.filter((piece)=>piece.operatorId==='m1');
  targetPieces.forEach((piece,index)=>piece.equipment.push({uid:`merge-gear-${index}-a`,itemId:'part-a'},{uid:`merge-gear-${index}-b`,itemId:'part-b'}));
  state.inventory=Array.from({length:20},(_,index)=>({uid:`inventory-${index}`,itemId:index%2?'part-a':'part-b'}));
  state.nextUid=100;
  assertPoolConserved(state);
  const before=structuredClone(state);
  const offer=state.shop.offers.find((entry)=>entry.operatorId==='m1');
  const rejected=applyAction(state,{type:'buy',offerUid:offer.uid},{catalog,fieldResolver:fields});
  assert.equal(rejected.ok,false);assert.equal(rejected.error,'INVENTORY_CAPACITY');
  assert.deepEqual(state,before);
  assert.deepEqual(rejected.state,before);
});

test('shop lock is a reversible public action without implicit refresh',()=>{
  let state=session(25);
  const offers=structuredClone(state.shop.offers);
  state=act(state,{type:'lockShop',locked:true}).state;
  assert.deepEqual(state.shop.offers,offers);
  assert.equal(state.shop.locked,true);
  state=act(state,{type:'lockShop',locked:false}).state;
  assert.deepEqual(state.shop.offers,offers);
});

test('round income computes interest before base and streak income',()=>{
  const secondWinAt8=calculateRoundIncome({gold:8,round:2,won:true,winStreak:2,lossStreak:0});
  assert.deepEqual(secondWinAt8,{income:5,winBonus:1,streakBonus:1,interest:0,goldAfter:15});
  const winAt9=calculateRoundIncome({gold:9,round:2,won:true,winStreak:1,lossStreak:0});
  assert.equal(winAt9.interest,1);
  assert.equal(winAt9.goldAfter,16);
  assert.equal(calculateRoundIncome({gold:50,round:2,won:false,winStreak:0,lossStreak:6}).interest,5);
  assert.deepEqual([1,2,4,5,6].map((count)=>calculateRoundIncome({gold:0,round:2,won:true,winStreak:count,lossStreak:0}).streakBonus),[0,1,1,2,3]);
});

test('fight refuses to proceed without the injected real runner and preserves input',()=>{
  const state=deployOne(session(27));
  const before=structuredClone(state);
  const noRunner=applyAction(state,{type:'fight'},{catalog,fieldResolver:fields});
  assert.equal(noRunner.ok,false);assert.equal(noRunner.error,'BATTLE_RUNNER_REQUIRED');assertPoolConserved(noRunner.state);
  assert.deepEqual(state,before);
});

test('fight-settled preserves authoritative combat stats and leaves missing values unknown',()=>{
  const combatStats={units:[
    {uid:41,defId:'chess_m1',kind:'op',dmg:18.5,heal:2.25,taken:4.5,kills:1,attacks:3},
    {uid:42,defId:'token_m1',kind:'token',dmg:0,heal:0,taken:0,kills:0,attacks:0},
    {uid:43,defId:'chess_r1',kind:'op',dmg:7,kills:2},
  ]};
  const runner=()=>({won:true,hpLoss:0,result:{reason:'cleared'},diagnostics:{errorCount:0},metrics:{},combatStats,
    replay:{version:1,frames:[],combatStats}});
  const fought=applyAction(deployOne(session(271)),{type:'fight'},{catalog,fieldResolver:fields,battleRunner:runner});
  assert.equal(fought.ok,true,fought.error);
  const event=fought.events.find((entry)=>entry.type==='fight-settled');
  const history=fought.state.history.find((entry)=>entry.type==='fight-settled');
  assert.deepEqual(event.combatStats,combatStats);
  assert.deepEqual(history.combatStats,combatStats);
  assert.deepEqual(fought.replay.combatStats,combatStats);
  assert.deepEqual(event.result,{reason:'cleared'},'the immediate fight event retains its existing result payload');
  assert.equal(Object.hasOwn(history,'result'),false,'the persisted history keeps the existing compact result policy');

  const noStatsRunner=()=>({won:true,hpLoss:0,result:{reason:'cleared'},diagnostics:{errorCount:0},metrics:{}});
  const noStats=applyAction(deployOne(session(272)),{type:'fight'},{catalog,fieldResolver:fields,battleRunner:noStatsRunner,recording:false});
  assert.equal(noStats.ok,true,noStats.error);
  assert.equal(noStats.events.find((entry)=>entry.type==='fight-settled').combatStats,null);
  assert.equal(noStats.state.history.find((entry)=>entry.type==='fight-settled').combatStats,null);
  assert.equal(noStats.replay,null,'an unrecorded fight still has no replay');
  const legacy=structuredClone(noStats.state);delete legacy.history.find((entry)=>entry.type==='fight-settled').combatStats;
  assert.equal(validateSession(legacy,{catalog}).ok,true,'older history without combatStats remains valid without migration');
});

test('four facing directions and typed deployment rules are enforced for deploy and fight',()=>{
  let state=session(31);const melee=state.pieces.find((piece)=>operators[piece.operatorId].position==='MELEE');
  const wrongTile=applyAction(state,{type:'deploy',pieceUid:melee.uid,row:0,col:1,dir:'UP'},{catalog,fieldResolver:fields});
  assert.equal(wrongTile.ok,false);assert.equal(wrongTile.error,'ILLEGAL_DEPLOYMENT');
  state=act(state,{type:'deploy',pieceUid:melee.uid,row:0,col:0,dir:'UP'}).state;
  assert.equal(state.pieces.find((piece)=>piece.uid===melee.uid).dir,'UP');
  state=act(state,{type:'turn',pieceUid:melee.uid,dir:'DOWN'}).state;
  assert.equal(state.pieces.find((piece)=>piece.uid===melee.uid).dir,'DOWN');
  const badMap=()=>({deployMap:new Map([['0,0',true]])});
  const ranged=session(32).pieces.find((piece)=>operators[piece.operatorId].position==='RANGED');
  const bad=applyAction(session(32),{type:'deploy',pieceUid:ranged.uid,row:0,col:0,dir:'LEFT'},{catalog,fieldResolver:badMap});
  assert.equal(bad.ok,false);assert.equal(bad.error,'ILLEGAL_DEPLOYMENT','Map presence alone is not legal-cell evidence');
  const elevatedCatalog={...catalog,operators:{...operators,m1:{...operators.m1,canDeployHighGround:true}}};
  const elevated=createSession({seed:33,catalog:elevatedCatalog}).state;
  const elevatedPiece=elevated.pieces.find((piece)=>piece.operatorId==='m1');
  const highground=applyAction(elevated,{type:'deploy',pieceUid:elevatedPiece.uid,row:0,col:1,dir:'RIGHT'},{catalog:elevatedCatalog,fieldResolver:fields});
  assert.equal(highground.ok,true,highground.error);
  const invalidFight=structuredClone(highground.state);invalidFight.pieces.find((piece)=>piece.uid===elevatedPiece.uid).col=99;
  const fight=applyAction(invalidFight,{type:'fight'},{catalog:elevatedCatalog,fieldResolver:fields});
  assert.equal(fight.ok,false);assert.equal(fight.error,'ILLEGAL_DEPLOYMENT');
});

test('malformed entries and critical capacities return validation errors without throwing',()=>{
  for(const state of [
    {...session(51),pieces:[null]},
    {...session(52),inventory:[null]},
    {...session(53),shop:{offers:[null],locked:false}},
  ]) assert.doesNotThrow(()=>validateSession(state,{catalog}));
  const full=session(54);full.inventory=Array.from({length:21},(_,i)=>({uid:`overflow-${i}`,itemId:'part-a'}));
  assert.ok(validateSession(full,{catalog}).errors.some((error)=>error.code==='INVENTORY_OVER_CAPACITY'));
  const tooMuch=session(55);tooMuch.pieces[0].equipment=Array.from({length:4},(_,i)=>({uid:`gear-${i}`,itemId:'part-a'}));
  assert.ok(validateSession(tooMuch,{catalog}).errors.some((error)=>error.code==='BAD_PIECE_EQUIPMENT'));
  const wrongPhase=session(56);wrongPhase.phase='mystery';
  assert.ok(validateSession(wrongPhase,{catalog}).errors.some((error)=>error.code==='BAD_PHASE'));
  const prematureComplete=session(57);prematureComplete.phase='complete';
  assert.ok(validateSession(prematureComplete,{catalog}).errors.some((error)=>error.code==='BAD_PHASE_TERMINAL'));
});

test('supply choices are idempotent, block fighting, and preserve a full reward until claimed',()=>{
  let state=deployOne(session(310));
  const runner=()=>({won:true,hpLoss:0,result:{reason:'cleared'},diagnostics:{errorCount:0},metrics:{}});
  state=act(state,{type:'fight'},{battleRunner:runner}).state;
  state=act(state,{type:'advanceSupply'}).state;
  state=act(state,{type:'fight'},{battleRunner:runner}).state;
  state.round=4;state.nodeStarted=false;state.claimedNodes=[1,2,3];
  state=act(state,{type:'advanceSupply'}).state;
  assert.equal(state.phase,'choice');
  const choice=state.pendingChoices.find((entry)=>entry.type==='components');assert.ok(choice);
  const denied=applyAction(state,{type:'fight'},{catalog,battleRunner:runner,fieldResolver:fields});assert.equal(denied.error,'CHOICES_PENDING');
  assert.deepEqual(denied.state,state);
  const filled=structuredClone(state);filled.inventory=Array.from({length:20},(_,index)=>({uid:`full-${index}`,itemId:'part-a'}));
  const rejected=applyAction(filled,{type:'claimReward',choiceUid:choice.uid,optionIds:[choice.options[0],choice.options[1]]},{catalog});
  assert.equal(rejected.error,'INVENTORY_CAPACITY');assert.deepEqual(rejected.state,filled);
  const claimed=act(state,{type:'claimReward',choiceUid:choice.uid,optionIds:[choice.options[0]]}).state;
  assert.equal(claimed.pendingChoices[0].remaining,1);
  const completed=act(claimed,{type:'claimReward',choiceUid:choice.uid,optionIds:[choice.options[1]]}).state;
  assert.equal(completed.phase,'prep');assert.equal(completed.pendingChoices.length,0);assert.equal(completed.inventory.length,4);
});

test('FUNNY odd nodes reject fight before runner and settle logistics while retaining streak',()=>{
  let state=deployOne(session(311,'FUNNY'));let calls=0;
  const runner=()=>{calls++;return {won:true,hpLoss:0,result:{reason:'cleared'},diagnostics:{errorCount:0},metrics:{}};};
  const beforeOddFight=structuredClone(state);
  const oddFight=applyAction(state,{type:'fight'},{catalog,battleRunner:runner,fieldResolver:fields});
  assert.equal(oddFight.ok,false);assert.equal(oddFight.error,'FUNNY_LOGISTICS_NODE');
  assert.equal(calls,0);assert.deepEqual(oddFight.state,beforeOddFight);
  const startingGold=state.gold,startingXp=state.xp,startingStreak=state.winStreak;
  state=act(state,{type:'advanceSupply'}).state;
  assert.equal(state.round,2);assert.equal(state.gold,startingGold+5);assert.equal(state.xp,startingXp+2);
  assert.equal(state.winStreak,startingStreak);assert.equal(calls,0);
  state=act(state,{type:'fight'},{battleRunner:runner}).state;
  assert.equal(calls,1);
  assert.equal(state.round,3);
  const beforeThirdNode={gold:state.gold,xp:state.xp,streak:state.winStreak};
  state=act(state,{type:'advanceSupply'}).state;
  assert.equal(state.round,4);assert.equal(state.gold,beforeThirdNode.gold+5+Math.min(5,Math.floor(beforeThirdNode.gold/10)));
  assert.equal(state.level,4);assert.equal(state.xp,0);assert.equal(state.winStreak,beforeThirdNode.streak);
  assert.equal(calls,1);assert.ok(state.history.some((entry)=>entry.type==='logistics-settled'&&entry.round===1));
  assert.ok(state.history.some((entry)=>entry.type==='logistics-settled'&&entry.round===3));
});

test('copy consumable consumes exactly one available pool copy into an independent one-star piece',()=>{
  const state=session(312);const target=state.pieces[0];const before=state.poolRemaining[target.operatorId];
  state.consumables.push({uid:'copy-test',kind:'smallCopy',source:'test'});
  const copied=act(state,{type:'useCopy',consumableUid:'copy-test',pieceUid:target.uid}).state;
  assert.equal(copied.poolRemaining[target.operatorId],before-1);
  assert.equal(copied.pieces.filter((piece)=>piece.operatorId===target.operatorId).length,2);
  assert.ok(copied.pieces.some((piece)=>piece.uid!==target.uid&&piece.star===1));
  assert.equal(copied.consumables.length,0);assertPoolConserved(copied);
});

test('eligible strategy choice applies interest-cap rule and ineligible choice uses configured fallback',()=>{
  const strategies={
    interest:{id:'interest',group:'economy',condition:{kind:'always'},mutuallyExclusive:[],unique:true,effects:[{kind:'interest_cap',params:{amount:2}}],invalidFallback:{kind:'gold',params:{amount:6}}},
    risk:{id:'risk',group:'risk',condition:{kind:'current_hp_above',value:20},mutuallyExclusive:[],unique:true,effects:[{kind:'risk_exchange',params:{hpCost:15,gold:15,minHpExclusive:20}}],invalidFallback:{kind:'gold',params:{amount:6}}},
  };
  const withStrategies={...catalog,strategies,campaign:{strategyNodes:[3],economy:{interest:{perGold:10,cap:5}}}};
  const made=createSession({seed:313,difficulty:'NORMAL',catalog:withStrategies});assert.equal(made.ok,true,made.error);
  let state=structuredClone(made.state);state.round=3;state.nodeStarted=false;state.claimedNodes=[1,2];
  let result=applyAction(state,{type:'advanceSupply'},{catalog:withStrategies});assert.equal(result.ok,true,result.error);state=result.state;
  const choice=state.pendingChoices.find((entry)=>entry.type==='strategy');assert.ok(choice);
  result=applyAction(state,{type:'chooseStrategy',choiceUid:choice.uid,strategyId:'interest'},{catalog:withStrategies});assert.equal(result.ok,true,result.error);state=result.state;
  assert.equal(state.strategyState.interest.amount,2);
  state.gold=100;
  let piece=state.pieces[0];result=applyAction(state,{type:'deploy',pieceUid:piece.uid,row:0,col:0,dir:'RIGHT'},{catalog:withStrategies,fieldResolver:fields});assert.equal(result.ok,true,result.error);state=result.state;
  result=applyAction(state,{type:'fight'},{catalog:withStrategies,fieldResolver:fields,battleRunner:()=>({won:true,hpLoss:0,diagnostics:{errorCount:0},metrics:{}})});
  assert.equal(result.ok,true,result.error);assert.equal(result.events.find((event)=>event.type==='fight-settled').interest,7);
});

test('refresh cadence makes the third refresh free without charging or counting that free use',()=>{
  const refresh={id:'refresh',group:'economy',condition:{kind:'always'},mutuallyExclusive:[],effects:[{kind:'refresh_discount',params:{paidRefreshEvery:3}}],invalidFallback:{kind:'gold',params:{amount:6}}};
  const refreshCatalog={...catalog,strategies:{refresh}};let state=session(314);state.strategies=[{id:'refresh'}];state.strategyState.refresh={paidRefreshEvery:3,paidCount:0};state.gold=20;
  const costs=[];for(let index=0;index<4;index++){const result=applyAction(state,{type:'refresh'},{catalog:refreshCatalog});assert.equal(result.ok,true,result.error);state=result.state;costs.push(result.events[0].cost);}
  assert.deepEqual(costs,[2,2,0,2]);assert.equal(state.strategyState.refresh.paidCount,1);
});

test('delayed income withholds two base incomes and releases both plus eight on the third node',()=>{
  const delayed={id:'delay',group:'risk',condition:{kind:'always'},mutuallyExclusive:[],effects:[{kind:'delayed_income',params:{holdNodes:2,releaseNode:3,bonus:8}}],invalidFallback:{kind:'gold',params:{amount:6}}};
  const delayedCatalog={...catalog,strategies:{delay:delayed},campaign:{supply:{components:{nodes:[],countPerNode:2}},strategyNodes:[3]}};
  let made=createSession({seed:315,difficulty:'NORMAL',catalog:delayedCatalog});assert.equal(made.ok,true,made.error);let state=made.state;
  state.round=3;state.nodeStarted=false;state.claimedNodes=[1,2];state.gold=0;
  let result=applyAction(state,{type:'advanceSupply'},{catalog:delayedCatalog});assert.equal(result.ok,true,result.error);state=result.state;
  const choice=state.pendingChoices.find((entry)=>entry.type==='strategy');assert.ok(choice);
  result=applyAction(state,{type:'chooseStrategy',choiceUid:choice.uid,strategyId:'delay'},{catalog:delayedCatalog});assert.equal(result.ok,true,result.error);state=result.state;
  const resolver=fields,runner=()=>({won:true,hpLoss:0,diagnostics:{errorCount:0},metrics:{}});
  const piece=state.pieces[0];result=applyAction(state,{type:'deploy',pieceUid:piece.uid,row:0,col:0,dir:'RIGHT'},{catalog:delayedCatalog,fieldResolver:resolver});assert.equal(result.ok,true,result.error);state=result.state;
  result=applyAction(state,{type:'fight'},{catalog:delayedCatalog,fieldResolver:resolver,battleRunner:runner});assert.equal(result.ok,true,result.error);state=result.state;
  assert.equal(result.events.find((event)=>event.type==='fight-settled').income,0);
  result=applyAction(state,{type:'advanceSupply'},{catalog:delayedCatalog});assert.equal(result.ok,true,result.error);state=result.state;
  result=applyAction(state,{type:'fight'},{catalog:delayedCatalog,fieldResolver:resolver,battleRunner:runner});assert.equal(result.ok,true,result.error);state=result.state;
  assert.equal(result.events.find((event)=>event.type==='fight-settled').income,0);
  result=applyAction(state,{type:'advanceSupply'},{catalog:delayedCatalog});assert.equal(result.ok,true,result.error);state=result.state;
  result=applyAction(state,{type:'fight'},{catalog:delayedCatalog,fieldResolver:resolver,battleRunner:runner});assert.equal(result.ok,true,result.error);state=result.state;
  assert.equal(result.events.find((event)=>event.type==='fight-settled').income,5);
  assert.equal(state.gold,28,'two withheld five-gold incomes return with the configured eight-gold bonus');
});

test('strategy eligibility is rechecked at selection and applies its explicit fallback',()=>{
  const risk={id:'risk',group:'risk',condition:{kind:'current_hp_above',value:20},mutuallyExclusive:[],effects:[{kind:'risk_exchange',params:{hpCost:15,gold:15,minHpExclusive:20}}],invalidFallback:{kind:'gold',params:{amount:6}}};
  const riskCatalog={...catalog,strategies:{risk},campaign:{strategyNodes:[3],supply:{components:{nodes:[],countPerNode:2}}}};
  const made=createSession({seed:316,difficulty:'NORMAL',catalog:riskCatalog});let state=made.state;state.round=3;state.nodeStarted=false;state.claimedNodes=[1,2];
  let result=applyAction(state,{type:'advanceSupply'},{catalog:riskCatalog});assert.equal(result.ok,true,result.error);state=result.state;
  const choice=state.pendingChoices.find((entry)=>entry.type==='strategy');assert.ok(choice?.options.includes('risk'));
  state.hp=20;const beforeGold=state.gold;
  result=applyAction(state,{type:'chooseStrategy',choiceUid:choice.uid,strategyId:'risk'},{catalog:riskCatalog});assert.equal(result.ok,true,result.error);
  assert.equal(result.state.hp,20);assert.equal(result.state.gold,beforeGold+6);assert.equal(result.state.strategyState.risk.fallbackApplied,true);
});

test('XP discount is bounded to configured purchases and never permits negative gold',()=>{
  const discount={id:'discount',group:'economy',condition:{kind:'always'},mutuallyExclusive:[],effects:[{kind:'xp_discount',params:{uses:2,amount:1}}],invalidFallback:{kind:'gold',params:{amount:6}}};
  const discountCatalog={...catalog,strategies:{discount}};let state=session(317);state.strategies=[{id:'discount'}];state.strategyState.discount={uses:2,amount:1};state.gold=7;
  let result=applyAction(state,{type:'buyXp'},{catalog:discountCatalog});assert.equal(result.ok,true,result.error);state=result.state;assert.equal(state.gold,4);assert.equal(state.strategyState.discount.uses,1);
  result=applyAction(state,{type:'buyXp'},{catalog:discountCatalog});assert.equal(result.ok,true,result.error);state=result.state;assert.equal(state.gold,1);assert.equal(state.strategyState.discount.uses,0);
  result=applyAction(state,{type:'buyXp'},{catalog:discountCatalog});assert.equal(result.ok,false);assert.equal(result.error,'NOT_ENOUGH_GOLD');assert.equal(result.state.gold,1);
});

test('battle growth has independent producer caps and battle gold cannot earn same-node interest',()=>{
  let state=deployOne(session(701));state.gold=9;const piece=state.pieces.find(piece=>piece.row!==null);
  const result=act(state,{type:'fight'},{battleRunner:()=>({won:true,hpLoss:0,diagnostics:{errorCount:0},growth:[
    {pieceUid:piece.uid,key:'bolivar:atk',amount:80,cap:100},
    {pieceUid:piece.uid,key:'bolivar:atk',amount:80,cap:100},
    {pieceUid:piece.uid,key:'babel:atk',amount:12,cap:120},
  ],coins:[{amount:3,source:'lungmen'}]})});
  const grown=result.state.pieces.find(entry=>entry.uid===piece.uid);
  assert.deepEqual(grown.growth,{'bolivar:atk':100,'babel:atk':12});
  assert.equal(result.events.find(event=>event.type==='fight-settled').interest,1);
  assert.equal(result.events.find(event=>event.type==='fight-settled').battleGold,3);
  const bad=applyAction(state,{type:'fight'},{catalog,fieldResolver:fields,battleRunner:()=>({won:true,hpLoss:0,growth:[{pieceUid:piece.uid,key:'x:atk',amount:-1}]})});
  assert.equal(bad.error,'BAD_GROWTH_RESULT');assert.deepEqual(bad.state,state);
});

test('forging persists across battles, caps progress per node and preserves pending reward at capacity',()=>{
  let state=deployOne(session(702));const runner=()=>({won:true,hpLoss:0,forge:[{source:'rim',progress:1,threshold:5},{source:'rim',progress:1,threshold:5}]});
  state.forgeProgress={rim:4};state.inventory=Array.from({length:20},(_,i)=>({uid:`forge-full-${i}`,itemId:'part-a'}));
  const fought=act(state,{type:'fight'},{battleRunner:runner});state=fought.state;
  assert.equal(state.forgeProgress.rim,0);assert.equal(state.pendingChoices.length,1);
  const choice=state.pendingChoices[0];assert.equal(choice.source,'rim');
  const rejected=applyAction(state,{type:'claimReward',choiceUid:choice.uid,optionIds:[choice.options[0]]},{catalog});
  assert.equal(rejected.error,'INVENTORY_CAPACITY');assert.deepEqual(rejected.state,state);
});

test('FUNNY logistics pays interest and shared economy rules once while preserving combat streak',()=>{
  const delayed={id:'delay',effects:[{kind:'delayed_income',params:{holdNodes:1,releaseNode:2,bonus:3}}]};
  const bench={id:'bench',effects:[{kind:'bench_capacity_and_gold',params:{capacity:7,postBattleGold:2}}]};
  const rules={...catalog,strategies:{delay:delayed,bench},campaign:{...catalog.campaign,supply:{components:{nodes:[],countPerNode:2}}}};
  let state=createSession({seed:703,difficulty:'FUNNY',catalog:rules}).state;state.gold=50;state.winStreak=2;
  state.strategies=[{id:'delay'},{id:'bench'}];state.strategyState={delay:{held:0},bench:{}};
  let next=applyAction(state,{type:'advanceSupply'},{catalog:rules});assert.equal(next.ok,true,next.error);state=next.state;
  assert.equal(state.gold,57);assert.equal(state.winStreak,2);assert.equal(state.strategyState.delay.held,5);
  state=applyAction(state,{type:'deploy',pieceUid:state.pieces[0].uid,row:0,col:0,dir:'RIGHT'},{catalog:rules,fieldResolver:fields}).state;
  next=applyAction(state,{type:'fight'},{catalog:rules,fieldResolver:fields,battleRunner:()=>({won:true,hpLoss:0})});assert.equal(next.ok,true,next.error);
  assert.equal(next.events.find(event=>event.type==='fight-settled').delayedBonus,8);
  assert.equal(next.state.strategyState.delay.released,true);
});

test('risk exchange pays its eligible effect and fallback strategies do not retain shop rules',()=>{
  const risk={id:'risk',condition:{kind:'always'},effects:[{kind:'risk_exchange',params:{hpCost:15,gold:15,minHpExclusive:20}}],invalidFallback:{kind:'gold',params:{amount:6}}};
  const rule={...catalog,strategies:{risk},campaign:{strategyNodes:[3],supply:{components:{nodes:[],countPerNode:2}}}};
  let state=createSession({seed:704,catalog:rule}).state;state.round=3;state.nodeStarted=false;state.claimedNodes=[1,2];
  let next=applyAction(state,{type:'advanceSupply'},{catalog:rule});assert.equal(next.ok,true,next.error);state=next.state;
  const before=state.gold;next=applyAction(state,{type:'chooseStrategy',choiceUid:state.pendingChoices[0].uid,strategyId:'risk'},{catalog:rule});
  assert.equal(next.ok,true,next.error);assert.equal(next.state.hp,85);assert.equal(next.state.gold,before+15);
  const refresh={id:'refresh',effects:[{kind:'refresh_discount',params:{paidRefreshEvery:3}}]};
  state=session(705);state.gold=10;state.strategies=[{id:'refresh'}];state.strategyState={refresh:{fallbackApplied:true}};
  const fallbackCatalog={...catalog,strategies:{refresh}};
  for(let i=0;i<3;i++){next=applyAction(state,{type:'refresh'},{catalog:fallbackCatalog});assert.equal(next.ok,true,next.error);assert.equal(next.events[0].cost,2);state=next.state;}
});

test('environment component candidates are distinct, Sargon adds a choice and Rim adds its own pending reward',()=>{
 const items=Object.fromEntries(Array.from({length:8},(_,i)=>[`part-${i}`,{id:`part-${i}`,kind:'component'}]));
 const envs={origin_sargon:{rule:{kind:'environment_component_choice',params:{extraOptions:1}}},origin_rim:{rule:{kind:'environment_component_supply',params:{everyNode:8,count:1}}}};
 const rules={...catalog,equipment:items,recipes:[],environments:envs,config:{starterIds:['m1','m2','r1']},campaign:{supply:{components:{nodes:[4,8],optionCount:3,countPerNode:2}},strategyNodes:[]}};
 for(const [env,round,counts]of [['origin_sargon',4,[4]],['origin_rim',8,[3,3]]]) {
  let state=createSession({seed:706,catalog:rules,environmentId:env}).state;state.round=round;state.nodeStarted=false;state.claimedNodes=[1];
  const next=applyAction(state,{type:'advanceSupply'},{catalog:rules});assert.equal(next.ok,true,next.error);
  assert.deepEqual(next.state.pendingChoices.map(x=>x.options.length),counts);
  for(const choice of next.state.pendingChoices)assert.equal(new Set(choice.options).size,choice.options.length);
  assert.deepEqual(next.state.pendingChoices.map(x=>x.remaining),env==='origin_sargon'?[2]:[2,1]);
 }
});

test('single-battle task totals reset, award once and consecutive wins retain their separate scope',()=>{
 const task={id:'task',effects:[{kind:'metric_reward',params:{metric:'ammoSpent',scope:'battle',threshold:60,reward:'gold',amount:12}}]};
 const streak={id:'streak',effects:[{kind:'metric_reward',params:{metric:'winNoLeakStreak',scope:'streak',threshold:2,reward:'xp',amount:12}}]};
 const rules={...catalog,strategies:{task,streak},campaign:{supply:{components:{nodes:[]}},strategyNodes:[]}};
 let state=deployOne(session(707));state.strategies=[{id:'task'},{id:'streak'}];state.strategyState={task:{progress:0},streak:{progress:0}};
 const fight=(ammo,won=true)=>{const result=applyAction(state,{type:'fight'},{catalog:rules,fieldResolver:fields,battleRunner:()=>({won,hpLoss:0,metrics:{ammoSpent:ammo,leaked:0}})});assert.equal(result.ok,true,result.error);state=result.state;};
 const advance=()=>{const result=applyAction(state,{type:'advanceSupply'},{catalog:rules});assert.equal(result.ok,true,result.error);state=result.state;};
 fight(40);assert.equal(state.strategyState.task.progress,40);assert.equal(state.strategyState.task.rewarded,undefined);assert.equal(state.strategyState.streak.progress,1);
 advance();fight(30);assert.equal(state.strategyState.task.progress,30,'previous battle cannot complete a single-battle task');assert.equal(state.strategyState.task.rewarded,undefined);assert.equal(state.strategyState.streak.rewarded,true);
 advance();fight(60);assert.equal(state.strategyState.task.rewarded,true);const awardGold=state.gold;
 advance();const expected=calculateRoundIncome({gold:awardGold,round:4,won:true,winStreak:4,lossStreak:0});fight(60);assert.equal(state.gold,expected.goldAfter,'completed task cannot pay twice');
});

test('view action costs expose the next free refresh, bounded XP discount and shop-lock rules',()=>{
 const strategies={refresh:{id:'refresh',effects:[{kind:'refresh_discount',params:{paidRefreshEvery:3}}]},xp:{id:'xp',effects:[{kind:'xp_discount',params:{uses:1,amount:1}}]},shop:{id:'shop',effects:[{kind:'shop_rule',params:{lockDisabled:true,refreshCost:1}}]},interest:{id:'interest',effects:[{kind:'interest_cap',params:{amount:2}}]}};
 const rules={...catalog,strategies};const state=session(708);state.strategies=Object.keys(strategies).map(id=>({id}));state.strategyState={refresh:{paidCount:2,paidRefreshEvery:3},xp:{uses:1,amount:1},shop:{lockDisabled:true,refreshCost:1},interest:{amount:2}};
 assert.deepEqual(viewSession(state,{catalog:rules}).actionCosts,{refreshGold:0,xpGold:3,canLockShop:false,interestCap:7});
});

test('summon orders respect the fixed skill, summon deployment class and rotated owner range',()=>{
 const summoner={...operators.m1,stars:{1:{record:{tokens:['token-old','token-active'],skill:{overrideTokenKey:'token-active'},rangeGrid:[[0,0],[0,1]]}}}};
 const rules={...catalog,operators:{...operators,m1:summoner}};
 const field={deployMap:new Map([['9,5','melee'],['9,6','melee'],['9,7','melee'],['10,6','ranged']]),resolveToken:()=>({position:'MELEE',placeable:true,ownerRange:true})};
 let state=createSession({seed:709,catalog:rules}).state;const piece=state.pieces.find(p=>p.operatorId==='m1');
 let out=applyAction(state,{type:'deploy',pieceUid:piece.uid,row:9,col:5,dir:'RIGHT'},{catalog:rules,fieldResolver:()=>field});assert.equal(out.ok,true,out.error);state=out.state;
 const set=(tokenId,row,col)=>applyAction(state,{type:'setSummonOrder',pieceUid:piece.uid,tokenId,row,col},{catalog:rules,fieldResolver:()=>field});
 assert.equal(set('token-old',9,6).error,'TOKEN_NOT_OWNED');
 assert.equal(set('token-active',9,7).error,'ILLEGAL_SUMMON_POSITION');
 assert.equal(set('token-active',10,6).error,'ILLEGAL_SUMMON_POSITION');
 out=set('token-active',9,6);assert.equal(out.ok,true,out.error);assert.deepEqual(out.state.pieces.find(p=>p.uid===piece.uid).summonOrders,[{tokenId:'token-active',row:9,col:6}]);state=out.state;
 out=applyAction(state,{type:'clearSummonOrder',pieceUid:piece.uid,tokenId:'token-old'},{catalog:rules});assert.equal(out.error,'TOKEN_NOT_OWNED');assert.deepEqual(out.state,state);
 out=applyAction(state,{type:'clearSummonOrder',pieceUid:piece.uid,tokenId:'token-active'},{catalog:rules});assert.equal(out.ok,true,out.error);assert.deepEqual(out.state.pieces.find(p=>p.uid===piece.uid).summonOrders,[]);
 out=applyAction(state,{type:'clearSummonOrder',pieceUid:piece.uid},{catalog:rules});assert.equal(out.ok,true,out.error);assert.deepEqual(out.state.pieces.find(p=>p.uid===piece.uid).summonOrders,[]);
});

test('the double-emblem recipe keeps a pending identity selection and preserves its item identity',()=>{
 const items={...equipment,universal:{id:'universal',kind:'emblem',effects:[{kind:'choose_identity_transfer'}]},transfer_aegir:{id:'transfer_aegir',kind:'emblem',effects:[{kind:'transfer_pact',params:{pactId:'aegir'}}]}};
 const rules={...catalog,equipment:items,recipes:[{parts:['part-a','part-b'],resultId:'universal'}],pacts:{aegir:{id:'aegir'}},environments:{origin_aegir:{identityPactId:'aegir'}}};
 let state=session(710);const ids=state.inventory.map(item=>item.uid);
 let out=applyAction(state,{type:'combine',itemUids:ids},{catalog:rules});assert.equal(out.ok,true,out.error);state=out.state;
 assert.equal(state.phase,'choice');assert.equal(state.pendingChoices[0].type,'identity_transfer');const uid=state.inventory[0].uid;
 assert.equal(state.pendingChoices[0].itemUid,uid);assert.deepEqual(state.pendingChoices[0].options,['aegir']);
 out=applyAction(state,{type:'claimReward',choiceUid:state.pendingChoices[0].uid,optionIds:['aegir']},{catalog:rules});assert.equal(out.ok,true,out.error);
 assert.deepEqual(out.state.inventory,[{uid,itemId:'transfer_aegir'}]);assert.equal(out.state.pendingChoices.length,0);assert.equal(out.state.phase,'prep');
 const recycled=applyAction(state,{type:'recycleEquipment',itemUid:uid},{catalog:rules});assert.equal(recycled.ok,true,recycled.error);assert.equal(recycled.state.pendingChoices.length,0,'explicitly destroying the unresolved emblem also removes its selection');
});

test('equipment furnace follows disassembly with a material-backed recipe choice and consumes the chosen pair',()=>{
 const rules={...catalog,equipment:{...equipment,alternate:{id:'alternate',kind:'completed'}},recipes:[...catalog.recipes,{parts:['part-a','part-c'],resultId:'alternate'}],strategies:{furnace:{id:'furnace',effects:[{kind:'free_disassemble_and_recipe',params:{everyNodes:4}}]}}};
 let state=session(712);let out=applyAction(state,{type:'combine',itemUids:state.inventory.map(item=>item.uid)},{catalog:rules});assert.equal(out.ok,true,out.error);state=out.state;
 state.round=4;state.strategies=[{id:'furnace'}];state.strategyState={furnace:{}};state.inventory.push({uid:'extra-component',itemId:'part-c'});
 out=applyAction(state,{type:'disassemble',itemUid:state.inventory.find(item=>item.itemId==='finished').uid},{catalog:rules});assert.equal(out.ok,true,out.error);state=out.state;
 assert.equal(state.phase,'choice');assert.equal(state.pendingChoices[0].type,'recipe');assert.deepEqual(state.pendingChoices[0].options,['finished','alternate']);
 out=applyAction(state,{type:'claimReward',choiceUid:state.pendingChoices[0].uid,optionIds:['alternate']},{catalog:rules});assert.equal(out.ok,true,out.error);state=out.state;
 assert.equal(state.phase,'prep');assert.deepEqual(state.inventory.map(item=>item.itemId).sort(),['alternate','part-b']);assert.equal(state.strategyState.furnace.lastUsedNode,4);
 assert.equal(applyAction(state,{type:'disassemble',itemUid:state.inventory.find(item=>item.itemId==='alternate').uid},{catalog:rules}).error,'DISASSEMBLE_NOT_AVAILABLE');
});

test('emblems from both transfer kinds count only deployed distinct identities for procurement rewards',()=>{
 const rules={...catalog,operators:Object.fromEntries(Object.entries(operators).map(([id,op])=>[id,{...op,pacts:[]}])),equipment:{...equipment,emblem:{id:'emblem',kind:'emblem',effects:[{kind:'transfer_pact',params:{pactId:'aegir'}}]}},strategies:{procure:{id:'procure',effects:[{kind:'pact_set_reward',params:{threshold:2,gold:8}}]}}};
 let state=session(711);state.strategies=[{id:'procure'}];state.strategyState={procure:{}};state.pieces[0].equipment=[{uid:'mark1',itemId:'emblem'}];state.pieces[1].equipment=[{uid:'mark2',itemId:'emblem'}];const gold=state.gold;
 let out=applyAction(state,{type:'deploy',pieceUid:state.pieces[0].uid,row:0,col:0,dir:'RIGHT'},{catalog:rules,fieldResolver:fields});assert.equal(out.ok,true,out.error);state=out.state;assert.equal(state.gold,gold,'bench emblem cannot complete the reward');
 out=applyAction(state,{type:'deploy',pieceUid:state.pieces[1].uid,row:0,col:2,dir:'RIGHT'},{catalog:rules,fieldResolver:fields});assert.equal(out.ok,true,out.error);assert.equal(out.state.gold,gold+8);assert.equal(out.state.strategyState.procure.rewardedPact,true);
});
