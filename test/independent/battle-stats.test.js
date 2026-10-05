import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';

const catalog=getCatalog();
function unitWith(equipment,penalty=false) {
  const id='independent_stat_fixture_a';
  const rec=chessRec({id,stats:{atk:500,maxHp:1000,def:100,aspd:100,spRecovery:1},skill:null});
  const piece={uid:'fixture',chessId:id,row:9,col:5,dir:'RIGHT',skillIndex:0,moduleId:'none',equipment,attachments:[],nativeState:{},bodyPenaltyApplied:penalty};
  const testCatalog={...catalog,operators:{...catalog.operators,[id]:{chessId:id,nativeTrait:{effect:{combat:[]}},source:{normalChess:rec}}}};
  const h=makeBattle({units:[{...piece}],defs:{chess:{[id]:rec}},content:'independent',extraContent:[b=>installIndependentBattle(b,{catalog:testCatalog,state:{pieces:[piece]}})]});
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
  return {h,u:h.unit('fixture')};
}
const badge=(id,quantity)=>({uid:`e-${id}`,id,quantity,elite:false,state:{}});

test('badge contributions are summed by physical quantity with the same displayed grade basis',()=>{
  const {u}=unitWith([badge('precision',3),badge('vitality',2),badge('defense',4),badge('agility',5)]);
  assert.equal(u.s.atk,530);
  assert.equal(u.s.maxHp,1160);
  assert.equal(u.s.def,132);
  assert.equal(u.s.aspd,110);
});

test('same percentage badges add their values instead of compounding each individual copy',()=>{
  const {u}=unitWith([badge('assault',20),badge('unyielding',20)]);
  assert.equal(u.s.atk,700);
  assert.equal(u.s.maxHp,1200);
});

test('inherited body loses native attack and life once while all flat equipment remains intact',()=>{
  const {u}=unitWith([badge('precision',3),badge('vitality',2)],true);
  assert.equal(u.s.atk,430);
  assert.equal(u.s.maxHp,960);
});

test('redeploy reduction adds and stays at the approved cap',()=>{
  const bare=unitWith([]).u;
  const many=unitWith([badge('solitary',99)]).u;
  assert.ok(Math.abs(many.s.respawnTime-bare.s.respawnTime*0.5)<1e-8);
});
