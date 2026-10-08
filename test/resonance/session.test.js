import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction, calculateRoundIncome, createSession, validateSession, viewSession, resonanceRules,
} from '../../server/modes/resonance/session.js';

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
