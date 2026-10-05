import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';

const catalog=getCatalog();
function unitWith(equipment,penalty=false,withSkill=false) {
  const id='independent_stat_fixture_a';
  const rec=chessRec({id,stats:{atk:500,maxHp:1000,def:100,aspd:100,spRecovery:1},skill:withSkill?{spCost:10,initSp:0}:null});
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
  const {u}=unitWith([badge('assault',20),badge('unyielding',20),badge('harmony',20)]);
  assert.equal(u.s.atk,700);
  assert.equal(u.s.maxHp,1200);
  assert.ok(Math.abs(u.s.healingDealtMul-1.2)<1e-8);
});

test('inherited body loses native attack and life once while all flat equipment remains intact',()=>{
  const {u}=unitWith([badge('precision',3),badge('vitality',2)],true);
  assert.equal(u.s.atk,430);
  assert.equal(u.s.maxHp,960);
});

test('redeploy reduction adds and stays at the approved cap',()=>{
  const bare=unitWith([]).u;
  const many=unitWith([badge('solitary',99)]).u;
  assert.equal(bare.s.redeployMul * (bare.persist?.redeployMul ?? 1),1);
  assert.equal(many.s.redeployMul * (many.persist?.redeployMul ?? 1),0.5);
});

test('physical and arts damage reduction adds badge quantities and caps at fifty percent',()=>{
  const {u}=unitWith([badge('coordination',120)]);
  assert.equal(u.s.physTakenMul,0.5);
  assert.equal(u.s.artsTakenMul,0.5);
});

test('physical and arts dodge add by quantity and cap at sixty percent',()=>{
  const {u}=unitWith([badge('miracle',100)]);
  assert.equal(u.s.dodgePhys,0.6);
  assert.equal(u.s.dodgeArts,0.6);
});

test('legacy badge source IDs resolve to their semantic badge at base grade',()=>{
  const aliases=unitWith([
    {uid:'legacy-assault',id:'chess_item_1_01_e_a',quantity:1,elite:true,state:{}},
    {uid:'legacy-defense',id:'chess_item_1_02_e_a',quantity:1,elite:true,state:{}},
  ]).u;
  assert.equal(aliases.s.atk,510);
  assert.equal(aliases.s.def,108);
});

test('Sargon tea boosts only natural SP recovery, not attack-triggered recovery',()=>{
  const tea=Object.values(catalog.equipment).find(x=>x.newName==='萨尔贡行军浓茶');
  assert.ok(tea);
  const item={uid:'tea',id:tea.sourceId,quantity:1,elite:false,state:{}};
  const {h,u}=unitWith([item],false,true);
  assert.ok(Math.abs(u.s.spRecovery-1.1)<1e-8);
  h.step(1);
  const before=u.skill.sp;
  h.run(1);
  assert.ok(Math.abs((u.skill.sp-before)-1.1)<1e-8);
  assert.equal(u.skill.gainSp(1,'attack'),1);
});

test('foresight badges grant their SP again on each deployment, not only at battle start',()=>{
  const {h,u}=unitWith([badge('foresight',3)],false,true);
  h.step(1);
  assert.ok(u.skill.sp>=3 && u.skill.sp<3.1);
  h.b.retreat(u);
  u.respawnAt=0;
  assert.equal(h.b.redeploy(u),true);
  assert.ok(u.skill.sp>=3 && u.skill.sp<3.1);
});
