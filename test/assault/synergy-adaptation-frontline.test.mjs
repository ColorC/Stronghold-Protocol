import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime } from '../helpers/synergyCard.js';
import { FRONTLINE_ADAPTATIONS } from '../../shared/assault/frontline-adaptations.js';
import { applyStatus, gainDP } from '../../server/sim/content/assault/primitives.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { cycleRedeploy } from '../../server/sim/content/assault/redeploy-cycle.js';
import { Grid } from '../../server/sim/grid.js';
import { flatStage } from '../helpers/battleHarness.js';

function setup(entries,extra=()=>{}){const stage=flatStage(),h=synergyBattle(entries,{beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);extra(b);}});
  for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}return h;}
function tank(h,position){return h.spawn(position,{mods:{hpMul:10000,speedMul:0}});}
function block(h,unit,n=1){const foes=Array.from({length:n},()=>tank(h,[unit.tileR,unit.tileC]));h.step(3);assert.ok(unit.blocking.length>0);return foes;}
function hits(h,unit){const seen=[];h.battle.on('hit',({source,target,dmg})=>{if(source===unit)seen.push({target,type:dmg.type,amount:dmg.amount,mul:dmg.mul,skill:dmg.isSkill});},{priority:-100});return seen;}

test('twenty frontline plans use real native signature slots and preserve sourced modules and readable cards',()=>{
  for(const [id,plan]of Object.entries(FRONTLINE_ADAPTATIONS)){
    const body=runtime.bodies[id];assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId,id);
    assert.equal(body.adaptation.targetCount,plan.targetCount);assert.equal(body.modulePlans.length,2);assert.ok(body.adaptation.lines.every(l=>[...l].length<=32));
  }
});

test('香草 produces actual DP and retains her original own strengthened attack',()=>{
  const h=setup([{charId:'char_240_wyvern',row:10,col:3},{charId:'char_290_vigna',row:10,col:4}]);const [unit,ally]=h.units;
  h.battle.getPlayer(unit.ownerId).dp=0;tank(h,[10,4]);const seen=hits(h,unit);h.castNow(unit);
  assert.equal(h.battle.getPlayer(unit.ownerId).dp,6);assert.equal(seen.filter(x=>x.skill).length,6);assert.ok(unit.s.atk>=unit.base.atk*1.08-1e-7);assert.equal(ally.s.atk,ally.base.atk);
});

test('红豆 native skill proc adds one base-ATK coefficient rather than doubling the entire skill',()=>{
  const h=setup([{charId:'char_290_vigna',row:10,col:3}]);const [unit]=h.units;tank(h,[10,4]);h.battle.rng=()=>0;
  const seen=hits(h,unit);h.castNow(unit);assert.equal(seen.length,6);assert.ok(seen.every(x=>Math.abs(x.amount-unit.s.atk*4)<1e-7));
});

test('野鬃 native deployment discount changes the next actual Guard payment and is then consumed',()=>{
  const paid=[];const h=setup([{charId:'char_496_wildmn',row:10,col:3},{charId:'char_127_estell',row:10,col:4}],b=>b.on('deploy',p=>{if(p.unit.kind==='op')paid.push([p.unit.def.charId,p.actualPaid]);}));
  const [unit,guard]=h.units;assert.equal(paid.find(([id])=>id===guard.def.charId)[1],0,'the opening entry is free; the discount offered to the waiting Guard is consumed by it');
  h.battle.retreat(guard,{reason:'test'});h.battle.retreat(unit,{reason:'test'});h.battle.addDp(guard.ownerId,99);paid.length=0;
  assert.equal(h.battle.redeploy(unit,{free:true}),true);assert.equal(guard.mem.adaptWildDiscount,1,'a redeployed 野鬃 discounts the waiting Guard');
  assert.equal(h.battle.redeploy(guard,{free:false}),true);assert.equal(paid.find(([id])=>id===guard.def.charId)[1],Math.max(0,guard.base.cost-1));
  assert.equal(guard.mem.adaptWildDiscount,0);tank(h,[10,4]);const seen=hits(h,unit);h.castNow(unit);assert.ok(seen.some(x=>x.skill));assert.deepEqual(h.battle.errors,[]);
});

test('晓歌 spends one battle cast for four DP-producing strikes and her camouflage follows the real loaded pool',()=>{
  const h=setup([{charId:'char_497_ctable',row:10,col:3}]);const [unit]=h.units;tank(h,[10,4]);h.battle.getPlayer(unit.ownerId).dp=0;
  assert.equal(unit.s.flags.camou,true);const seen=hits(h,unit);h.castNow(unit);assert.equal(seen.length,4);assert.equal(assaultAmmoState(unit).current,3);
  assert.equal(h.battle.getPlayer(unit.ownerId).dp,4);for(let i=0;i<3;i++)h.castNow(unit);assert.equal(!!unit.s.flags.camou,false);
});

test('谜图 repeated casts accumulate the native ten independent sixteen-second poison stacks and exact DP',()=>{
  const h=setup([{charId:'char_4017_puzzle',row:10,col:3}]);const [unit]=h.units,foe=tank(h,[10,4]);h.battle.getPlayer(unit.ownerId).dp=0;
  h.castNow(unit);h.castNow(unit);assert.equal(foe.mem.adaptPuzzleDots.get(unit).length,10);assert.equal(h.battle.getPlayer(unit.ownerId).dp,10);
  const seen=hits(h,unit);h.run(1.1);assert.equal(seen.filter(x=>x.type==='arts').length,10);h.run(15);assert.equal(foe.mem.adaptPuzzleDots.get(unit).length,0);
});

test('深巡 preserves four-target piercing, original sluggish and refreshed native poison',()=>{
  const h=setup([{charId:'char_4137_udflow',row:10,col:3}]);const [unit]=h.units;const foes=Array.from({length:5},()=>tank(h,[10,4]));
  const seen=hits(h,unit);h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,24);assert.equal(new Set(seen.filter(x=>x.skill).map(x=>x.target)).size,4);
  assert.equal(foes.filter(e=>hasStatus(e,'sluggish')).length,4);h.run(3.2);assert.equal(seen.filter(x=>x.type==='arts').length,12);
});

test('折桠 preserves the original ground tremble, blocked arts attacks and native end heal',()=>{
  const h=setup([{charId:'char_4207_branch',row:10,col:3}]);const [unit]=h.units,[foe]=block(h,unit);unit.hp=unit.s.maxHp*.1;
  const seen=hits(h,unit);h.castNow(unit);assert.ok(hasStatus(foe,'tremble'));assert.equal(seen.filter(x=>x.skill&&x.type==='arts').length,6);
  assert.ok(unit.hp>=unit.s.maxHp*.6-1e-7);assert.deepEqual(h.battle.errors,[]);
});

test('灰毫 uses original fortress range and repeated splash, then restores her native block count',()=>{
  const h=setup([{charId:'char_431_ashlok',row:10,col:3}]);const [unit]=h.units;tank(h,[10,6]);tank(h,[10,6.5]);
  const block=unit.s.blockCnt,seen=hits(h,unit);h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,12);assert.equal(unit.s.blockCnt,block);
});

test('菲莱 incoming-hit resources preserve native arts plus actual apoptosis gauge damage',()=>{
  const h=setup([{charId:'char_4148_philae',row:10,col:3}]);const [unit]=h.units,[foe]=block(h,unit);h.castNow(unit);
  const seen=hits(h,unit);h.battle.dealDamage(foe,unit,{amount:100,type:'phys',isAttack:true});h.flush();
  assert.equal(unit.mem.adaptPhilaeUses,3);assert.ok(seen.some(x=>x.type==='arts'));assert.ok(foe.elem.apoptosis>0);assert.deepEqual(h.battle.errors,[]);
});

test('风笛 retains real three-hit rounds, native opening SP and a counted eight-DP ally feed',()=>{
  const h=setup([{charId:'char_222_bpipe',row:10,col:3},{charId:'char_240_wyvern',row:10,col:4}]);const [unit,ally]=h.units;
  h.run(.1);assert.equal(ally.skill.sp,6);tank(h,[10,4]);h.battle.rng=()=>.99;const seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>x.skill).length,15);h.hold(ally);h.battle.getPlayer(unit.ownerId).dp=0;gainDP(h.battle,unit,8,'native-fee-source');h.flush();assert.equal(ally.skill.sp,4);
});

test('忍冬 preserves native DP, per-hit short stun and the first-hit-inclusive arts pursuit',()=>{
  const h=setup([{charId:'char_4026_vulpis',row:10,col:3}]);const [unit]=h.units;const [foe]=block(h,unit);h.battle.getPlayer(unit.ownerId).dp=0;
  const seen=hits(h,unit);h.castNow(unit);assert.equal(h.battle.getPlayer(unit.ownerId).dp,9);assert.equal(seen.filter(x=>x.skill).length,12);
  assert.ok(seen.some(x=>x.type==='arts'));assert.ok(hasStatus(foe,'stun'));assert.deepEqual(h.battle.errors,[]);
});

test('琴柳 keeps a real thrown flag centre, area control and returns the aura to her own position',()=>{
  const h=setup([{charId:'char_479_sleach',row:10,col:3}]);const [unit]=h.units,foe=tank(h,[10,5]);h.battle.getPlayer(unit.ownerId).dp=0;
  h.castNow(unit);assert.equal(h.battle.getPlayer(unit.ownerId).dp,10);assert.equal(unit.mem.adaptBanner.at.x,5);
  assert.ok(hasStatus(foe,'stun'));assert.ok(hasStatus(foe,'sluggish'));assert.ok(foe.s.dmgTakenMul>=1.3);h.run(6.2);assert.deepEqual(h.battle.errors,[]);
});

test('焰尾 gains the extra native block slot before the instant burst and dodge earns one two-hit whole-blocked attack',()=>{
  const h=setup([{charId:'char_420_flamtl',row:10,col:3}]);const [unit]=h.units,foes=block(h,unit,3),seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>x.skill).length,18);h.battle.rng=()=>0;h.battle.dealDamage(foes[0],unit,{amount:100,type:'phys',isAttack:true});
  assert.equal(unit.mem.adaptFlameSword,1);unit.profile.noAttack=false;const before=seen.length;h.battle.forceAttack(unit,[foes[0]]);h.flush();
  assert.equal(seen.length-before,6);assert.equal(unit.mem.adaptFlameSword,0);assert.deepEqual(h.battle.errors,[]);
});

test('瑕光 keeps paired physical/arts damage and heals another ally while retaining the original hurt-SP type link',()=>{
  const h=setup([{charId:'char_423_blemsh',row:10,col:3},{charId:'char_4065_judge',row:10,col:4},{charId:'char_199_yak',row:9,col:4}]);const [unit,ally,patient]=h.units;
  patient.hp=patient.s.maxHp*.1;tank(h,[10,4]);const seen=hits(h,unit),hp=patient.hp;h.castNow(unit);
  assert.equal(seen.filter(x=>x.skill).length,12);assert.ok(patient.hp>hp);h.hold(ally);ally.profile.noAttack=false;
  const foe=tank(h,[10,5]);for(let i=0;i<3;i++)h.battle.forceAttack(ally,[foe]);h.flush();assert.equal(ally.skill.sp,4);
});

test('泥岩 native nine-second shields restore exact life and feed adjacent tanks on a real layer break',()=>{
  const h=setup([{charId:'char_311_mudrok',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  const foe=tank(h,[10,4]);unit.hp=unit.s.maxHp*.2;const hp=unit.hp;h.battle.dealDamage(foe,unit,{amount:100,type:'phys',isAttack:true});h.flush();
  assert.ok(unit.hp>=hp+unit.s.maxHp*.2-1e-7);assert.equal(ally.skill.sp,4);h.run(9.1);assert.ok(unit.buffs.some(b=>b.key.includes('fertile-shield:')&&b.shieldHits>0));
  assert.ok(h.battle.assaultLedger.snapshot().operators.find(row=>row.uid===unit.uid).triggers>0);
});

test('Mudrock approved run growth raises a real native shield-break heal from 20 to 30 percent',()=>{
 const h=setup([{charId:'char_311_mudrok',row:10,col:3,piece:{runGrowth:{char_311_mudrok:5}}}]),[unit]=h.units;
 const foe=tank(h,[10,4]);unit.hp=unit.s.maxHp*.2;const hp=unit.hp;
 h.battle.dealDamage(foe,unit,{amount:100,type:'phys',isAttack:true});h.flush();
 assert.ok(Math.abs(unit.hp-hp-unit.s.maxHp*.3)<1e-6);assert.deepEqual(h.battle.errors,[]);
});

test('Penance approved run growth grants 80 percent opening barrier once and keeps native redeploy barrier',()=>{
 const h=setup([{charId:'char_4065_judge',row:10,col:3,piece:{runGrowth:{char_4065_judge:6}}}]),[unit]=h.units;
 const barrier=()=>unit.buffs.find(b=>b.key.endsWith(':law-guardian'));
 assert.ok(Math.abs(barrier().shield-unit.s.maxHp*.8)<1e-6);
 h.battle.removeBuff(unit,barrier().key);cycleRedeploy(h.battle,unit);h.flush();
 assert.ok(Math.abs(barrier().shield-unit.s.maxHp*.5)<1e-6);assert.deepEqual(h.battle.errors,[]);
});

test('斥罪 native barriers add with a 300% cap and actual hits consume stored enhanced thorns',()=>{
  const h=setup([{charId:'char_4065_judge',row:10,col:3}]);const [unit]=h.units,foe=tank(h,[10,4]);h.castNow(unit);h.castNow(unit);
  const barrier=unit.buffs.find(b=>b.key.endsWith(':law-guardian'));assert.equal(barrier.shield,unit.s.maxHp*3);const seen=hits(h,unit);
  h.battle.dealDamage(foe,unit,{amount:100,type:'phys',isAttack:true});h.flush();assert.equal(unit.mem.adaptJudgeStrong,7);assert.ok(seen.some(x=>x.type==='arts'));
});

test('号角 preserves both normal/overload shells and the original once-per-deployment blood-war revival',()=>{
  const h=setup([{charId:'char_4039_horn',row:10,col:3}]);const [unit]=h.units,foe=tank(h,[10,6]);const seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>x.skill).length,6);assert.ok(seen.at(-1).amount>seen[0].amount);const hp=unit.s.maxHp;
  h.battle.dealDamage(foe,unit,{amount:hp*10,type:'true'});assert.equal(unit.alive,true);assert.equal(unit.s.maxHp,hp*.5);assert.equal(unit.hp,unit.s.maxHp);
  cycleRedeploy(h.battle,unit);h.flush();assert.equal(unit.mem.adaptHornRevived,false);
});

test('格拉尼 fills her second original block slot before the burst and keeps the Vanguard dodge aura',()=>{
  const h=setup([{charId:'char_220_grani',row:10,col:3}]);const [unit]=h.units;block(h,unit,2);const seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>x.skill).length,12);assert.ok(unit.s.dodgePhys>=.2);assert.deepEqual(h.battle.errors,[]);
});

test('近卫阿米娅 keeps one-per-battle ten slashes, retargets lowest HP, then retains true normal attacks and the amplified aura',()=>{
  const h=setup([{charId:'char_1001_amiya2',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  const weak=tank(h,[10,4]);weak.hp=1;tank(h,[10,4]);const seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>x.skill).length,10);assert.equal(weak.alive,false);assert.ok(seen.slice(1).every(x=>x.type==='true'));
  assert.equal(unit.profile.dmgType,'true');assert.equal(h.castNow(unit),false);assert.ok(ally.s.atk>=ally.base.atk*1.14-1e-7);
});

test('医疗阿米娅 keeps one-per-battle full-range opening, native debuff, double-target true state and party regeneration',()=>{
  const h=setup([{charId:'char_1037_amiya3',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  const foes=Array.from({length:3},()=>tank(h,[10,5]));ally.hp=ally.s.maxHp*.2;const seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>x.skill).length,3);assert.equal(unit.profile.maxTargets,2);assert.equal(unit.profile.dmgType,'true');assert.equal(h.castNow(unit),false);
  assert.ok(foes.every(e=>e.s.aspd<e.base.aspd));const hp=ally.hp;h.run(1.1);assert.ok(ally.hp>=hp+ally.s.maxHp*.025-1e-6);
});
