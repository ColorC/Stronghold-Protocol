import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, validateSession } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { makePrizeOffer } from '../../server/modes/independent/prizes.js';
import { getIndependentField } from '../../server/modes/independent/battle.js';
import { createRng } from '../../server/sim/rng.js';
import { nativeRecord } from '../../shared/independentRules.js';

const catalog=getCatalog();
function fixture() {
  const state=createSession({seed:91,difficulty:'FUNNY'});
  const map=getIndependentField(state).deployMap;
  const taken=new Set();
  for(const [i,name] of ['角峰','送葬人','调香师','灵知'].entries()) {
    const op=Object.values(catalog.operators).find(x=>!x.elite && x.name===name);
    const p={uid:`p${state.nextUid++}`,chessId:op.chessId,elite:false,row:null,col:null,dir:'RIGHT',skillIndex:op.source.normalChess.skill.index,moduleId:'none',equipment:[],attachments:[],nativeState:{saved:7},bodyPenaltyApplied:false,poolCopies:0};
    // as gained: 角峰 wears its 交接凭证 (session.js gainChess)
    if(op.permitGearId) p.equipment.push({uid:`permit-${p.uid}`,id:op.permitGearId,elite:false,quantity:1,state:{},sourceId:op.permitGearId});
    if(i<2) {
      const tile=[...map].find(([key,cls])=>!taken.has(key) && (nativeRecord(p,catalog).position!=='MELEE' || cls==='melee'));
      assert.ok(tile);[p.row,p.col]=tile[0].split(',').map(Number);taken.add(tile[0]);
    }
    state.pieces.push(p);
  }
  state.pieces[0].equipment.push({uid:`e${state.nextUid++}`,id:'precision',quantity:1,elite:false,state:{saved:9}});
  assert.deepEqual(validateSession(state),[]);
  return state;
}
function choose(id,extra={}) {
  const state=fixture();state.phase='prize';state.offers=[{id:'test-offer',type:'prize',choices:[id],source:'fixture'}];
  const before=JSON.stringify(state);
  const result=applyAction(state,{type:'choose',offerId:'test-offer',index:0,targetUid:state.pieces[0].uid,...extra});
  assert.equal(result.ok,true,`${id}: ${result.error?.message}`);
  assert.equal(JSON.stringify(state),before,'public action preserves input state');
  assert.deepEqual(validateSession(result.state),[]);
  return {state:result.state,before:state};
}
const quantity=(state,id)=>state.inventory.filter(x=>x.id===id).reduce((sum,x)=>sum+x.quantity,0);
const wornQuantity=(state,id)=>state.pieces.reduce((sum,p)=>sum+(p.equipment||[]).filter(x=>x.id===id).reduce((n,x)=>n+x.quantity,0),0);

for(const prize of Object.values(catalog.prizes))test(`prize ${prize.name} resolves through the public action without an unsupported branch`,()=>{
  const {state}=choose(prize.id);
  assert.ok(!state.offers.some(x=>x.id==='test-offer'));
});

test('team support counts deployed bodies while nutrition remains a movable life-supply option',()=>{
  const team=choose('team-readiness-support').state;
  assert.equal(wornQuantity(team,'precision'),3, 'the first deployed operator keeps its pre-existing badge and both deployed operators gain one');
  assert.equal(wornQuantity(team,'damage'),2);
  assert.equal(quantity(team,'precision'),0, 'fixed-recipient prize gains do not become movable inventory');
  assert.equal(quantity(team,'damage'),0);
  const food=choose('emergency-rations').state;
  assert.equal(quantity(food,'precision'),3);
  assert.equal(quantity(food,'vitality'),3);
});

test('portable forge and team support use attack and damage outputs',()=>{
  assert.deepEqual(catalog.equipment['rhodes-portable-forge'].params.outputs,[
    {id:'precision',quantity:1},{id:'damage',quantity:1},
  ]);
  assert.deepEqual(catalog.prizes['team-readiness-support'].params.outputs,[
    {id:'precision',quantity:1},{id:'damage',quantity:1},
  ]);
  assert.equal(catalog.prizes['standard-readiness-upgrade'].params.id,'damage');
});

test('logistics quota pays immediately and cannot stack its persistent income',()=>{
  const {state,before}=choose('long-term-logistics-quota');
  assert.equal(state.funds,before.funds+1);
  state.phase='prize';state.offers=[{id:'second',type:'prize',choices:['long-term-logistics-quota']}];
  const second=applyAction(state,{type:'choose',offerId:'second',index:0});
  if(second.ok) {
    assert.equal(second.state.funds,state.funds);
    assert.equal(second.state.playerEffects.filter(x=>x.type==='facilityIncome').length,1);
  }
});

test('direct promotion preserves assets, position, counters and previous body loss without gain rewards',()=>{
  const state=fixture();const p=state.pieces[0];p.bodyPenaltyApplied=true;
  state.phase='prize';state.offers=[{id:'promote',type:'prize',choices:['readiness-promotion-order']}];
  const result=applyAction(state,{type:'choose',offerId:'promote',index:0,targetUid:p.uid});
  assert.equal(result.ok,true,result.error?.message);
  const promoted=result.state.pieces.find(x=>x.uid===p.uid);
  assert.equal(promoted.elite,true);
  assert.equal(promoted.bodyPenaltyApplied,true);
  assert.deepEqual(promoted.equipment,p.equipment);
  assert.deepEqual(promoted.nativeState,p.nativeState);
  assert.equal(promoted.row,p.row);
  assert.equal(promoted.col,p.col);
  assert.equal(result.state.inventory.length,state.inventory.length);
  assert.deepEqual(result.state.counters,state.counters);
  assert.equal(result.state.offers.length,0);
});

test('prize drawing excludes training with no deployed legal recipient and calibration without attack badges',()=>{
  const state=createSession({seed:1});
  const first=makePrizeOffer(state,catalog,'build','fixture',createRng(42));
  assert.ok(first);
  assert.ok(!first.choices.includes('special-readiness-training'));
  state.offers=[];
  const cash=makePrizeOffer(state,catalog,'cashout','fixture',createRng(3));
  assert.ok(cash);
  assert.ok(!cash.choices.includes('heavy-weapons-calibration'));
  assert.ok(!cash.choices.includes('readiness-promotion-order'));
});

test('standard shop support is attached to the purchased body and is lost with that body',()=>{
  const {state}=choose('standard-readiness-upgrade');state.funds=100;
  const slot=state.shop.slots.findIndex(x=>x.kind==='chess' && !x.sold);
  const result=applyAction(state,{type:'buy',slot});
  assert.equal(result.ok,true,result.error?.message);
  const bought=result.state.pieces.find(x=>!state.pieces.some(p=>p.uid===x.uid));
  assert.ok(bought.equipment.some(x=>x.id==='damage' && x.quantity===1));
  const inventoryBefore=quantity(result.state,'damage');
  const sold=applyAction(result.state,{type:'sell',uid:bought.uid});
  assert.equal(sold.ok,true);
  assert.equal(quantity(sold.state,'damage'),inventoryBefore);
});
