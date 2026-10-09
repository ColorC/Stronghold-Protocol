import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { INDEPENDENT_BADGE_STATS, independentBadgeMod } from '../../shared/independentBadgeStats.js';
import { badgeEffectText } from '../../public/js/independent/badgeText.js';
import { applyDamageIncrease } from '../../shared/damageIncrease.js';

const catalog=getCatalog();
function unitWith(equipment,penalty=false,withSkill=false,stats={},combat=[],enemies={},loadout={}) {
  const id='independent_stat_fixture_a';
  const rec={...chessRec({id,stats:{atk:500,maxHp:1000,def:100,aspd:100,spRecovery:1,...stats},skill:withSkill?{spCost:10,initSp:0}:null}),...(loadout.record||{})};
  const piece={uid:'fixture',chessId:id,row:9,col:5,dir:'RIGHT',skillIndex:loadout.skillIndex??0,moduleId:loadout.moduleId??'none',equipment,attachments:[],nativeState:{},bodyPenaltyApplied:penalty};
  const testCatalog={...catalog,operators:{...catalog.operators,[id]:{chessId:id,nativeTrait:{effect:{combat}},source:{normalChess:rec}}}};
  const h=makeBattle({units:[{...piece}],defs:{chess:{[id]:rec},enemies},content:'independent',extraContent:[b=>installIndependentBattle(b,{catalog:testCatalog,state:{pieces:[piece]}})]});
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
  return {h,u:h.unit('fixture')};
}
const badge=(id,quantity)=>({uid:`e-${id}`,id,quantity,elite:false,state:{}});

test('percentage stat badges use the operator base and sum by physical quantity',()=>{
  const {u}=unitWith([badge('precision',3),badge('vitality',2),badge('defense',4),badge('agility',5)]);
  assert.equal(u.s.atk,530);
  assert.equal(u.s.maxHp,1060);
  assert.equal(u.s.def,108);
  assert.equal(u.s.aspd,110);
  const larger=unitWith([badge('precision',1),badge('vitality',1),badge('defense',1),badge('agility',1)],false,false,{atk:1000,maxHp:2000,def:300,aspd:150}).u;
  assert.equal(larger.s.atk,1020);
  assert.equal(larger.s.maxHp,2060);
  assert.equal(larger.s.def,306);
  assert.equal(larger.s.aspd,153);
});

test('same percentage badges add their values instead of compounding each individual copy',()=>{
  const {u}=unitWith([badge('assault',2),badge('unyielding',2),badge('harmony',2)]);
  assert.equal(u.s.atk,520, 'assault adds to the skill attack-percent bucket');
  assert.equal(u.s.maxHp,1060);
  assert.ok(Math.abs(u.s.healingDealtMul-1.02)<1e-8);
});

test('module loadout base attributes receive white badge percentages before equipment stats',()=>{
  const base={atk:500,maxHp:1000,def:100,aspd:100,spRecovery:1,cost:10,blockCnt:2,bat:1,respawnTime:20};
  const rec={statsBase:base,modules:[{uniEquipId:'module_plus',attr:{atk:200,maxHp:300,def:50,aspd:20}}]};
  const {u}=unitWith([badge('precision',1),badge('vitality',1),badge('defense',1),badge('agility',1)],false,false,{},[],{},
    {moduleId:'module_plus',record:rec});
  assert.equal(u.s.atk,714);
  assert.equal(u.s.maxHp,1339);
  assert.equal(u.s.def,153);
  assert.equal(u.s.aspd,122.4);
});

test('all fifteen canonical badge effects and the damage alias stay percentage-valued',()=>{
  assert.deepEqual(Object.fromEntries(Object.entries(INDEPENDENT_BADGE_STATS).map(([id, x])=>[id,[x.stat,x.value]])),{
    damage:['damageDealtPercent',0.02],precision:['attackBasePercent',0.02],agility:['attackSpeedPercent',0.02],vitality:['maxLifeBasePercent',0.03],
    defense:['defenseBasePercent',0.02],assault:['attackPercent',0.02],recovery:['naturalSkillRecoveryPercent',0.02],
    arcane:['artsDamageReduction',0.005],foresight:['skillCostInitialPercent',0.02],miracle:['physicalAndArtsDodge',0.01],
    investor:['maxLifeRecoveryPercent',0.001],unyielding:['maxLifePercent',0.03],harmony:['healingDealtPercent',0.01],
    coordination:['physicalAndArtsDamageReduction',0.005],solitary:['redeployTimeReduction',0.01],mastery:['normalAttackDamagePercent',0.01],
  });
});

test('badge detail text communicates percentages and linearly totals stacks',()=>{
  assert.equal(badgeEffectText('precision'), '原生基础攻击力白值 +2%');
  assert.equal(badgeEffectText('precision',3), '原生基础攻击力白值 +6%');
  assert.equal(badgeEffectText('assault',2), '攻击力 +4%');
  assert.equal(badgeEffectText('foresight',3), '当前所选技能初始技力（按该技能技力需求计算） +6%');
  assert.equal(badgeEffectText('investor',10), '每秒回复原生基础最大生命的 1%');
});

test('recovery and investor use the current native SP and maximum-life bases',()=>{
  const {u}=unitWith([badge('recovery',2),badge('investor',2)],false,false,{maxHp:2000,spRecovery:2});
  assert.equal(u.s.spRecovery,2.08);
  assert.equal(u.s.hpRegen,4);
});

test('inherited body loses native attack and life once while all flat equipment remains intact',()=>{
  const retired=Object.values(catalog.equipment).find(x=>(x.newName||x.name)==='阿戈尔沉海重刃');
  assert.ok(retired);
  const {u}=unitWith([badge('precision',1),badge('vitality',1),{uid:'legacy-flat',id:retired.id,quantity:1,elite:false,state:{}}],true);
  assert.equal(u.s.atk,510,'the 20% loss applies to native ATK, then +10 badge and +100 legacy equipment remain');
  assert.equal(u.s.maxHp,830,'the 20% loss applies to native max HP, then +30 badge remains');
});

test('zero native bases do not receive invented flat badge stats',()=>{
  const {u}=unitWith([badge('precision',5),badge('agility',5),badge('vitality',5),badge('defense',5),badge('recovery',5)],false,false,
    {atk:0,maxHp:0,def:0,aspd:0,spRecovery:0});
  assert.equal(u.s.atk,0);
  assert.equal(u.s.maxHp,1);
  assert.equal(u.s.def,0);
  assert.equal(u.s.aspd,100, 'the simulator normalizes explicit zero native speed to 100 and the badge adds no bonus');
  assert.equal(u.s.spRecovery,0);
  assert.equal(u.s.hpRegen,0);
  assert.equal(independentBadgeMod(INDEPENDENT_BADGE_STATS.investor,{maxHp:0},5).lifeRecoveryFlat,0);
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

test('mastery and native damage increases share one outgoing bucket while other modes retain multiplication',()=>{
  const {h,u}=unitWith([badge('mastery',2)],false,false,{},[],{enemy_stat_dummy:enemyRec({key:'enemy_stat_dummy',hp:5000})});
  const target=h.spawn('enemy_stat_dummy',{pos:[10,6]});
  h.b.applyStatus(target,'fragile',{duration:20,value:0.2});
  u.buffs.push({key:'native-damage-increase',mods:{dmgDealtMul:1.3},stacks:1});
  const dmg={amount:100,type:'true',mul:1,isAttack:true};
  h.b.dealDamage(u,target,dmg);
  assert.ok(Math.abs(target.hp-(5000-100*1.32*1.2))<1e-8,'outgoing bonus bucket is separate from target fragile');

  const attached=h.spawn('enemy_stat_dummy',{pos:[10,7]});
  h.b.applyStatus(attached,'fragile',{duration:20,value:0.2});
  h.b.dealDamage(u,attached,{amount:100,type:'true'});
  assert.ok(Math.abs(attached.hp-(5000-100*1.3*1.2))<1e-8,'normal-attack badge does not recursively amplify attached damage');

  const sourceless=h.spawn('enemy_stat_dummy',{pos:[10,8]});
  const snapshot={amount:100,type:'true',sourceless:true};
  applyDamageIncrease(h.b,u,snapshot,1.2);
  h.b.dealDamage(u,sourceless,snapshot);
  assert.equal(sourceless.hp,4880,'explicit snapshot increase applies while sourceless source stats stay suppressed');

  const normal=makeBattle({units:[{chessId:'damage_test',row:10,col:5}],defs:{chess:{damage_test:chessRec({id:'damage_test'})}}});
  const actor=normal.unit('damage_test');
  const oldMode={amount:100,type:'true',mul:1};
  applyDamageIncrease(normal.b,actor,oldMode,1.02);
  assert.equal(oldMode.mul,1.02);
  assert.equal(oldMode.damageIncreaseBonus,undefined);
});

test('outgoing damage helper preserves reduction and element multipliers in their existing lanes',()=>{
  const {h,u}=unitWith([badge('mastery',2)]);
  const factorDown={amount:100,type:'true',mul:1};
  applyDamageIncrease(h.b,u,factorDown,0.8);
  assert.equal(factorDown.mul,0.8);
  const element={amount:100,type:'element',mul:1};
  applyDamageIncrease(h.b,u,element,1.2);
  assert.equal(element.mul,1.2);
  assert.equal(element.damageIncreaseBonus,undefined);
});

test('legacy badge source IDs resolve to their semantic badge at base grade',()=>{
  const aliases=unitWith([
    {uid:'legacy-assault',id:'chess_item_1_01_e_a',quantity:1,elite:true,state:{}},
    {uid:'legacy-defense',id:'chess_item_1_02_e_a',quantity:1,elite:true,state:{}},
  ]).u;
  assert.equal(aliases.s.atk,510);
  assert.equal(aliases.s.def,102);
});

// gear v4 (2026-10-07): 萨尔贡行军浓茶 no longer raises natural recovery; each normal attack gives 1 SP (gear-v4.test.js)
test('Sargon tea adds no natural SP recovery any more',()=>{
  const tea=Object.values(catalog.equipment).find(x=>x.newName==='萨尔贡行军浓茶');
  assert.ok(tea);
  const item={uid:'tea',id:tea.sourceId,quantity:1,elite:false,state:{}};
  const {h,u}=unitWith([item],false,true);
  assert.ok(Math.abs(u.s.spRecovery-1)<1e-8);
  h.step(1);
  const before=u.skill.sp;
  h.run(1);
  assert.ok(Math.abs((u.skill.sp-before)-1)<1e-8);
});

test('foresight badges grant their SP again on each deployment, not only at battle start',()=>{
  const {h,u}=unitWith([badge('foresight',3)],false,true);
  h.step(1);
  assert.ok(Math.abs(u.skill.sp-(0.6 + 1/30))<1e-8, `cost-based initial SP plus one tick of native natural recovery, got ${u.skill.sp}`);
  h.b.retreat(u);
  u.respawnAt=0;
  assert.equal(h.b.redeploy(u),true);
  assert.ok(Math.abs(u.skill.sp-0.6)<1e-8);
});

test('foresight calculates initial SP from the selected alternate skill cost',()=>{
  const skills=[
    {index:1,isDefault:true,spCost:10,initSp:0,skillType:'MANUAL',durationType:'NONE',duration:0,spType:'INCREASE_WITH_TIME',bb:{},trigger:{rule:'DEFAULT'}},
    {index:2,spCost:20,initSp:0,skillType:'MANUAL',durationType:'NONE',duration:0,spType:'INCREASE_WITH_TIME',bb:{},trigger:{rule:'DEFAULT'}},
  ];
  const {h,u}=unitWith([badge('foresight',2)],false,true,{},[],{},{skillIndex:2,record:{skills}});
  assert.equal(u.skill.spCost,20);
  h.step(1);
  assert.ok(Math.abs(u.skill.sp-(0.8+1/30))<1e-8);
});

test('badge amplification scales native-base contributions and damage badges remain separate',()=>{
  const mold={uid:'mold',id:'independent:熔铸模具',quantity:1,state:{}};
  const {u}=unitWith([badge('precision',2),badge('assault',2),mold]);
  assert.equal(u.s.atk,551.25, 'precision adds amplified base white ATK; assault adds amplified atkPct');
});

test('assault uses the same additive atkPct bucket as native skill attack buffs',()=>{
  const {u}=unitWith([badge('precision',1),badge('assault',1)],false,false,{},[
    {behavior:'staticStats',params:{stats:{attackPercent:0.5}}},
  ]);
  assert.equal(u.s.atk,775.2, '(500 + 10 white ATK) × (1 + 50% skill + 2% assault)');
});
