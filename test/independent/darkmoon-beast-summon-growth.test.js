import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runNativeHook } from '../../server/modes/independent/native.js';
import { grantEquipment, recordProduction } from '../../server/modes/independent/equipment.js';
import { nativeFactions } from '../../shared/independentRules.js';

const data=getData(),catalog=getCatalog(data);
const trainer=Object.values(catalog.operators).find(op=>!op.elite&&op.sourceRefs?.darkmoon19_2?.id==='BGS_021');
const targetId=Object.keys(catalog.operators).find(id=>!catalog.operators[id].elite&&id!==trainer.chessId&&nativeFactions({chessId:id},catalog).includes('叙拉古'));
const unrelatedId=Object.keys(catalog.operators).find(id=>!catalog.operators[id].elite&&!nativeFactions({chessId:id},catalog).includes('叙拉古'));
assert.ok(trainer&&targetId&&unrelatedId,'catalog supplies the source and both faction cases');
const itemQty=(piece,id)=>(piece.equipment||[]).filter(item=>item.id===id).reduce((sum,item)=>sum+item.quantity,0);
function fixture({trainers=1,elite=false,targetChessId=targetId,targetOnField=false}={}) {
  const sourceId=elite?(trainer.eliteChessId||trainer.chessId.replace(/_a$/,'_b')):trainer.chessId;
  const pieces=Array.from({length:trainers},(_,i)=>({uid:`trainer-${i}`,chessId:sourceId,elite:elite&&i===0,row:10,col:3+i,equipment:[],nativeState:{}}));
  const target={uid:'gained-1',chessId:targetChessId,elite:false,row:targetOnField?11:null,col:targetOnField?3:null,equipment:[],nativeState:{}};
  pieces.push(target);
  const state={round:1,pieces,inventory:[],production:[],playerEffects:[],counters:{gained:0},shop:{level:6,slots:[]}};
  const services={catalog,data,rng:()=>0.25,grantEquipment:(draft,id,quantity,extra)=>grantEquipment(draft,catalog,id,quantity,extra),recordProduction};
  return {state,pieces,target,services};
}
const hook=(f,name,piece)=>runNativeHook(f.state,name,{piece},f.services);

test('BGS_021 buffs a newly recruited bench Siracusa once and does not repeat at first placement',()=>{
  const alone=fixture();hook(alone,'gain',alone.pieces[0]);
  assert.equal(itemQty(alone.pieces[0],'precision'),0,'a trainer does not grant to itself');
  assert.equal(itemQty(alone.pieces[0],'damage'),0);
  const f=fixture({trainers:2});
  for(const holder of f.pieces.slice(0,2))hook(f,'gain',holder);
  assert.equal(itemQty(f.pieces[0],'precision'),4,'a different trainer can grant to this Siracusa target');
  assert.equal(itemQty(f.pieces[1],'damage'),4);
  hook(f,'gain',f.target);
  assert.equal(itemQty(f.target,'precision'),8);
  assert.equal(itemQty(f.target,'damage'),8);
  f.target.row=11;f.target.col=3;
  hook(f,'firstDeploy',f.target);
  assert.equal(itemQty(f.target,'precision'),8,'the same source-target pair cannot pay twice');
  assert.equal(itemQty(f.target,'damage'),8);
  const targetProduction=f.state.production.filter(row=>row.targetUid===f.target.uid);
  assert.equal(targetProduction.length,4,'both badges from both sources are worn by the recruited operator');
  assert.ok(targetProduction.every(row=>row.worn===true&&row.origin==='native'));
});

test('BGS_021 first placement pays once when gain was deferred, then dedupes the deferred gain callback',()=>{
  const f=fixture({targetOnField:true});
  hook(f,'firstDeploy',f.target);
  hook(f,'gain',f.target);
  assert.equal(itemQty(f.target,'precision'),4);
  assert.equal(itemQty(f.target,'damage'),4);
});

test('a target first deployed before Suzuran joins cannot receive a late repeat-deploy reward',()=>{
  const f=fixture({trainers:0,targetOnField:true});
  hook(f,'firstDeploy',f.target);
  assert.equal(f.target.nativeState.firstDeployHooksFired,true);
  f.target.row=null;f.target.col=null;
  const lateTrainer={uid:'late-trainer',chessId:trainer.chessId,row:10,col:3,equipment:[],nativeState:{}};
  f.state.pieces.push(lateTrainer);
  f.target.row=11;f.target.col=3;
  hook(f,'firstDeploy',f.target);
  assert.equal(itemQty(f.target,'precision'),0);
  assert.equal(itemQty(f.target,'damage'),0);
});

test('BGS_021 does not trigger from a trainer that is still in the bench',()=>{
  const f=fixture();f.pieces[0].row=null;f.pieces[0].col=null;
  hook(f,'gain',f.target);
  assert.equal(itemQty(f.target,'precision'),0);
  assert.equal(itemQty(f.target,'damage'),0);
});

test('BGS_021 scales elite sources and stacks independent sources without affecting unrelated factions',()=>{
  const f=fixture({trainers:2,elite:true});
  f.pieces[1].elite=false;f.pieces[1].chessId=trainer.chessId;
  const unrelated={uid:'unrelated',chessId:unrelatedId,row:null,col:null,equipment:[],nativeState:{}};
  f.state.pieces.push(unrelated);
  hook(f,'gain',f.target);hook(f,'gain',unrelated);
  assert.equal(itemQty(f.target,'precision'),12,'normal and elite trainers each grant their own amount');
  assert.equal(itemQty(f.target,'damage'),12);
  assert.equal(itemQty(unrelated,'precision'),0);
  assert.equal(itemQty(unrelated,'damage'),0);
});

test('a fresh UID is eligible after the previous recruit leaves the roster',()=>{
  const f=fixture();
  hook(f,'gain',f.target);
  const replacement={uid:'gained-2',chessId:targetId,row:null,col:null,equipment:[],nativeState:{}};
  f.state.pieces=f.state.pieces.filter(piece=>piece!==f.target);f.state.pieces.push(replacement);
  hook(f,'gain',replacement);
  assert.equal(itemQty(replacement,'precision'),4);
  assert.equal(itemQty(replacement,'damage'),4);
});

test('bench UID landing is opt-in and still rejects absent, foreign-owner and non-operator targets',()=>{
  const holder={uid:'holder',chessId:trainer.chessId,ownerId:'same',row:10,col:3,equipment:[],nativeState:{}};
  const target={uid:'bench',chessId:targetId,ownerId:'same',row:null,col:null,equipment:[],nativeState:{}};
  const foreign={uid:'foreign',chessId:targetId,ownerId:'other',row:null,col:null,equipment:[],nativeState:{}};
  const summon={uid:'summon',chessId:targetId,ownerId:'same',kind:'summon',row:null,col:null,equipment:[],nativeState:{}};
  const state={round:1,pieces:[holder,target,foreign,summon],inventory:[],production:[],playerEffects:[],counters:{gained:0},shop:{level:6,slots:[]}};
  const grant=(uid,allowBenchTarget)=>grantEquipment(state,catalog,'precision',1,{origin:'native',sourceUid:holder.uid,targetUid:uid,landOn:`uid:${uid}`,...(allowBenchTarget?{allowBenchTarget:true}:{})});
  assert.throws(()=>grant(target.uid,false),/BAD_LANDING_TARGET/,'bench recipients need the explicit native grant option');
  assert.equal(grant(target.uid,true).worn,target.uid);
  for(const uid of ['missing',foreign.uid,summon.uid])assert.throws(()=>grant(uid,true),/BAD_LANDING_TARGET/,uid);
});
