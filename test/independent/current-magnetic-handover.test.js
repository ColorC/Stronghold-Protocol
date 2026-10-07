import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,applyAction,validateSession} from '../../server/modes/independent/session.js';
import {getCatalog} from '../../server/modes/independent/catalog.js';
import {getIndependentField} from '../../server/modes/independent/battle.js';
const catalog=getCatalog();
function fixture(a,b){
  const state=createSession({seed:129,difficulty:'FUNNY',openFactions:null});
  for(const name of [a,b]){
    const op=Object.values(catalog.operators).find(o=>o.name===name&&!o.elite&&o.recruitable!==false);
    assert.ok(op,name);const raw=op.source.normalChess;
    const p={uid:'p'+state.nextUid++,chessId:op.chessId,elite:false,row:null,col:null,dir:'RIGHT',skillIndex:raw.skill?.index??0,moduleId:'none',equipment:[],attachments:[],nativeState:{},bodyPenaltyApplied:false,poolCopies:1};
    if(op.permitGearId)p.equipment.push({uid:'e'+state.nextUid++,id:op.permitGearId,quantity:1,elite:false,state:{}});
    state.pool[op.chessId].left--;state.pieces.push(p);
  }
  const donor=state.pieces[0],raw=catalog.operators[donor.chessId].source.normalChess;
  const cell=[...getIndependentField(state).deployMap].find(([,type])=>raw.position!=='MELEE'||type==='melee');
  assert.ok(cell);[donor.row,donor.col]=cell[0].split(',').map(Number);
  donor.equipment.push({uid:'e'+state.nextUid++,id:'precision',quantity:2,elite:false,state:{}});
  assert.deepEqual(validateSession(state),[]);return state;
}
for(const [bearer,partner]of [['赫默','杰西卡'],['蛇屠箱','雷蛇']])for(const reverse of [false,true])test(bearer+' permits both handover directions without a partner permit '+reverse,()=>{
  const state=fixture(...(reverse?[partner,bearer]:[bearer,partner]));const [donor,receiver]=state.pieces;
  const partnerPiece=state.pieces.find(p=>catalog.operators[p.chessId].name===partner);
  assert.equal(partnerPiece.equipment.some(x=>catalog.equipment[x.id]?.mechanism==='inheritancePermit'),false);
  const r=applyAction(state,{type:'inherit',donorUid:donor.uid,receiverUid:receiver.uid});
  assert.equal(r.ok,true,r.error?.message);assert.equal(r.state.pieces.length,1);
  assert.equal(r.state.pieces[0].chessId,receiver.chessId);
  assert.equal(r.state.pieces[0].equipment.find(x=>x.id==='precision')?.quantity,2);
  assert.deepEqual(validateSession(r.state),[]);
});
for(const [a,b]of [['赫默','格拉尼'],['赫默','塞雷娅'],['蛇屠箱','杰西卡']])test(a+' rejects an out-of-scope partner '+b,()=>{
  const state=fixture(a,b),before=JSON.stringify(state),[donor,receiver]=state.pieces;
  const r=applyAction(state,{type:'inherit',donorUid:donor.uid,receiverUid:receiver.uid});
  assert.equal(r.ok,false);assert.equal(JSON.stringify(state),before);assert.equal(JSON.stringify(r.state),before);
});
test('the current pool has only two permit bearers and high-impact deployment equipment costs technology six',()=>{
  const ops=Object.values(catalog.operators).filter(o=>!o.elite&&o.recruitable!==false&&o.permitGearId);
  assert.deepEqual(ops.map(o=>o.name).sort(),['蛇屠箱','赫默'].sort());
  for(const name of ['便携式融毁教学仪','反冲空降仓']){
    const item=Object.values(catalog.equipment).find(g=>g.name===name);assert.equal(item.level,6);assert.equal(item.shopTier,6);
  }
  for(const id of ['permit-north-handover-order','permit-tianshi-seal','permit-deepsea-entrustment']){
    assert.ok(catalog.equipment[id]);assert.equal(catalog.equipment[id].legacyOnly,true);assert.equal(catalog.equipment[id].shopEligible,false);
  }
});
