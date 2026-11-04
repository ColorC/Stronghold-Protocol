// Historical authored roster fixture; all mechanics still execute the live implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, validateSession } from './helpers/preWarbandSession.js';
import { getCatalog } from './helpers/preWarbandCatalog.js';
import { getIndependentField } from '../../server/modes/independent/battle.js';
import { nativeRecord } from '../../shared/independentRules.js';

const catalog=getCatalog();
function fixture(donorName='角峰',receiverName='送葬人') {
  const state=createSession({seed:91,difficulty:'FUNNY',openFactions:null});
  const map=getIndependentField(state).deployMap;
  for(const name of [donorName,receiverName]) {
    const op=Object.values(catalog.operators).find(x=>!x.elite && x.name===name);
    const raw=op.source.normalChess;
    const p={uid:`p${state.nextUid++}`,chessId:op.chessId,elite:false,row:null,col:null,dir:'RIGHT',skillIndex:raw.skill.index,moduleId:'none',equipment:[],attachments:[],nativeState:{ownCounter:7},bodyPenaltyApplied:false,poolCopies:1};
    state.pool[op.chessId].left--;state.pieces.push(p);
  }
  const donor=state.pieces[0];
  const tile=[...map].find(([,cls])=>nativeRecord(donor,catalog).position!=='MELEE' || cls==='melee');
  [donor.row,donor.col]=tile[0].split(',').map(Number);
  return state;
}
const gear=(state,id,quantity=1,extra={})=>({uid:`e${state.nextUid++}`,id,quantity,elite:false,state:{spent:3,...extra}});

test('inheritance is reachable from a deployed donor to a benched receiver and never repeats gain',()=>{
  const state=fixture();const [donor,receiver]=state.pieces;
  donor.equipment=[gear(state,'precision',3)];
  donor.attachments=[{id:'quartermaster-kit',state:{lastRound:1,spent:2}}];
  const snapshot=JSON.stringify(state);
  const preview=applyAction(state,{type:'inherit-preview',donorUid:donor.uid,receiverUid:receiver.uid});
  assert.equal(preview.ok,true,preview.error?.message);
  assert.equal(preview.events[0].preview.ok,true);
  assert.equal(preview.state.revision,state.revision);
  const result=applyAction(state,{type:'inherit',donorUid:donor.uid,receiverUid:receiver.uid});
  assert.equal(result.ok,true,result.error?.message);
  assert.equal(JSON.stringify(state),snapshot);
  const body=result.state.pieces.find(p=>p.uid===receiver.uid);
  assert.equal(result.state.pieces.length,1);
  assert.equal(body.chessId,receiver.chessId);
  assert.equal(body.row,donor.row);assert.equal(body.col,donor.col);
  assert.equal(body.bodyPenaltyApplied,true);
  assert.deepEqual(body.equipment,donor.equipment);
  assert.deepEqual(body.attachments,donor.attachments);
  assert.deepEqual(body.nativeState,receiver.nativeState);
  assert.equal(result.state.inventory.length,0);
  assert.equal(result.state.funds,state.funds+1);
  assert.equal(result.state.pool[donor.chessId].left,state.pool[donor.chessId].left+1);
  assert.deepEqual(validateSession(result.state),[]);
});

test('qualification can come from the receiver and noneligible attached abilities are explicitly lost',()=>{
  const state=fixture('送葬人','崖心');const [donor,receiver]=state.pieces;
  donor.attachments=[{id:'ammo-recovery',state:{ammo:11,spent:2}}];
  const preview=applyAction(state,{type:'inherit-preview',donorUid:donor.uid,receiverUid:receiver.uid});
  assert.equal(preview.ok,true);
  assert.equal(preview.events[0].preview.ok,true);
  assert.ok(preview.events[0].preview.destroyedAttachments.some(x=>x.id==='ammo-recovery'));
  const result=applyAction(state,{type:'inherit',donorUid:donor.uid,receiverUid:receiver.uid});
  assert.equal(result.ok,true,result.error?.message);
  assert.deepEqual(result.state.pieces[0].attachments,[]);
});

test('1000 combined worn items reject the whole operation before money, pool or assets change',()=>{
  const state=fixture();const [donor,receiver]=state.pieces;
  donor.equipment=[gear(state,'precision',998)];receiver.equipment=[gear(state,'vitality',2)];
  const snapshot=JSON.stringify(state);
  const result=applyAction(state,{type:'inherit',donorUid:donor.uid,receiverUid:receiver.uid});
  assert.equal(result.ok,false);
  assert.equal(JSON.stringify(result.state),snapshot);
  assert.equal(JSON.stringify(state),snapshot);
});

test('999 combined worn items succeed while independent inventory does not consume body capacity',()=>{
  const state=fixture();const [donor,receiver]=state.pieces;
  donor.equipment=[gear(state,'precision',998)];receiver.equipment=[gear(state,'vitality',1)];
  state.inventory=[{uid:`i${state.nextUid++}`,id:'agility',quantity:5000,elite:false,state:{}}];
  assert.deepEqual(validateSession(state),[]);
  const result=applyAction(state,{type:'inherit',donorUid:donor.uid,receiverUid:receiver.uid});
  assert.equal(result.ok,true,result.error?.message);
  assert.equal(result.state.pieces[0].equipment.reduce((n,i)=>n+i.quantity,0),999);
  assert.equal(result.state.inventory[0].quantity,5000);
});

test('identity aliases are one unique item and require an explicit retention choice',()=>{
  const state=fixture();const [donor,receiver]=state.pieces;
  donor.equipment=[gear(state,'chess_item_1_04_e_a',1,{faction:'阿戈尔'})];
  receiver.equipment=[gear(state,'chess_item_6_09_e_a',1,{faction:'炎'})];
  const preview=applyAction(state,{type:'inherit-preview',donorUid:donor.uid,receiverUid:receiver.uid});
  assert.equal(preview.ok,true);
  assert.equal(preview.events[0].preview.equipmentConflicts.length,1);
  const result=applyAction(state,{type:'inherit',donorUid:donor.uid,receiverUid:receiver.uid});
  assert.equal(result.ok,false);
  assert.deepEqual(result.state,state);
});
