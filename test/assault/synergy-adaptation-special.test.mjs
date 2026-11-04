import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime, FLYER } from '../helpers/synergyCard.js';
import { flatStage } from '../helpers/battleHarness.js';
import { Grid } from '../../server/sim/grid.js';
import { SPECIAL_ADAPTATIONS } from '../../shared/assault/special-adaptations.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { applyStatus, damage, payDP } from '../../server/sim/content/assault/primitives.js';
import { cycleRedeploy } from '../../server/sim/content/assault/redeploy-cycle.js';

function setup(entries,extra=()=>{}){const stage=flatStage(),h=synergyBattle(entries,{beforeStart:b=>{
  b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);extra(b);
}});for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}return h;}
const spawn=(h,pos,more={})=>h.spawn(pos,{mods:{hpMul:10000,speedMul:0},...more});
function seen(h,source){const hits=[];h.battle.on('hit',p=>{if(p.source===source)hits.push(p);},{priority:-100});return hits;}

test('special signatures retain native slots, card limits and the real skill-less passive exception',()=>{
  for(const [id,plan]of Object.entries(SPECIAL_ADAPTATIONS)){
    const body=runtime.bodies[id];if(plan.passive){assert.equal(body.source.skills.length,0);assert.equal(body.fixedSkill.sourceSkillId,null);assert.ok(body.adaptation.sourceTraitId);}
    else assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId);
    assert.ok(plan.lines.every(l=>[...l].length<=32),id);assert.equal(body.modulePlans.length,2);
  }
});
test('Talr pays exactly 25 DP, binds four and performs every burst hit while insufficient DP refuses the cast',()=>{
  const h=setup([{charId:'char_4155_talr',row:10,col:4}]),[u]=h.units,foes=Array.from({length:5},()=>spawn(h,[10,5]));
  h.battle.getPlayer(u.ownerId).dp=24;assert.equal(h.castNow(u),false);h.battle.getPlayer(u.ownerId).dp=100;
  const hits=seen(h,u);assert.equal(h.castNow(u),true);assert.equal(h.battle.getPlayer(u.ownerId).dp,75);
  assert.equal(hits.length,24);assert.equal(foes.filter(e=>hasStatus(e,'bind')).length,4);assert.deepEqual(h.battle.errors,[]);
});
test('Talr counted DP awards separate conditional attack uses without adding an enduring stat aura',()=>{
  const h=setup([{charId:'char_4155_talr',row:10,col:3},{charId:'char_290_vigna',row:10,col:4}],b=>{for(const unit of b.allyUnits)unit.base.cost=0;}),[u,ally]=h.units,e=spawn(h,[10,5]);h.battle.rng=()=>.99;
  const attacks=seen(h,ally);ally.profile.noAttack=false;h.battle.forceAttack(ally,[e]);ally.profile.noAttack=true;const base=attacks.at(-1).dmg.mul;
  payDP(h.battle,u,12,'test');h.flush();h.run(.3);for(let i=0;i<3;i++){ally.profile.noAttack=false;h.battle.forceAttack(ally,[e]);ally.profile.noAttack=true;}
  assert.ok(attacks[1].dmg.mul>base);assert.ok(attacks[2].dmg.mul>base);assert.equal(attacks[3].dmg.mul,base);
});
test('Tinman repeated alchemy units retain independent fifteen-pulse damage and actual regen through heal prohibition',()=>{
  const h=setup([{charId:'char_4151_tinman',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]),[u,ally]=h.units,e=spawn(h,[10,5]);
  ally.hp=ally.s.maxHp*.1;h.battle.addBuff(ally,{key:'test:no-heal',flags:{healFree:true,noHeal:true},duration:Infinity});const hp=ally.hp,hits=seen(h,u);
  h.castNow(u);h.castNow(u);assert.equal(u.mem.adaptAlchemy.size,2);h.run(15.1);
  assert.equal(hits.filter(p=>p.target===e).length,30);assert.ok(ally.hp>hp);assert.equal(u.mem.adaptAlchemy.size,0);assert.deepEqual(h.battle.errors,[]);
});
test('Tinman wither increases only real DOT in an alchemy unit and leaves an instant friendly attack alone',()=>{
  const h=setup([{charId:'char_4151_tinman',row:10,col:3},{charId:'char_373_lionhd',row:10,col:4}]),[u,ally]=h.units,e=spawn(h,[10,5]);
  h.castNow(u);h.run(.1);const hits=seen(h,ally);damage(h.battle,ally,e,{amount:100,type:'arts'});
  h.battle.dealDamage(ally,e,{amount:100,type:'arts',tags:['dot']});assert.equal(hits[1].dmg.mul/hits[0].dmg.mul,1.2);
});
test('Tippi incoming damage triggers the original reactive triple shots and accumulated flight attacks without a timed stance',()=>{
  const h=setup([{charId:'char_4191_tippi',row:10,col:3}]),[u]=h.units,e=spawn(h,[10,4],{key:FLYER}),hits=seen(h,u);
  u.skill.sp=u.skill.spCost;u.skill.charges=1;const hp=u.hp;h.battle.dealDamage(e,u,{amount:100,type:'phys',isAttack:true});h.flush();
  assert.equal(u.hp,hp);assert.equal(hits.length,9);assert.equal(u.mem.adaptFlightShots,3);assert.ok(u.s.flags.liftoff);assert.ok(u.s.flags.blockFly);
  u.skill.sp=u.skill.spCost;u.skill.charges=1;h.battle.dealDamage(e,u,{amount:100,type:'phys',isAttack:true});h.flush();assert.equal(u.mem.adaptFlightShots,6);
  u.profile.noAttack=false;for(let i=0;i<6;i++)h.battle.forceAttack(u,[e]);assert.equal(u.mem.adaptFlightShots,0);assert.equal(!!u.s.flags.liftoff,false);assert.deepEqual(h.battle.errors,[]);
});
test('Tippi work guide applies its original nine-second damage-free test to a nearby ally',()=>{
  const h=setup([{charId:'char_4191_tippi',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]),[u,ally]=h.units,e=spawn(h,[10,5]),hp=ally.hp;
  h.battle.dealDamage(e,ally,{amount:100,type:'true'});h.battle.dealDamage(e,ally,{amount:100,type:'phys',isAttack:true});assert.ok(ally.hp<hp-100);
  h.run(9.1);const before=ally.hp;h.battle.dealDamage(e,ally,{amount:100,type:'arts'});assert.equal(ally.hp,before);assert.equal(u.mem.adaptFlightShots??0,0);
  h.flush();assert.ok(h.battle.assaultLedger.snapshot().operators.find(row=>row.uid===u.uid).triggers>0);
});
test('Swire enters a single battle two-hit state; native merchant payments build capped coins/ATK and repeat spends all coins in the true forward grid',()=>{
  const h=setup([{charId:'char_1033_swire2',row:10,col:3}]),[u]=h.units,e=spawn(h,[10,5]);h.castNow(u);
  assert.equal(u.profile.hits,2);assert.equal(u.mem.adaptCoins,1);h.run(9.1);assert.equal(u.mem.adaptCoins,4);assert.equal(u.mem.adaptBuyer,3);
  const hits=seen(h,u);h.castNow(u);assert.equal(hits.filter(p=>p.target===e).length,4);assert.equal(u.mem.adaptCoins,0);assert.equal(u.profile.hits,2);
  h.run(18);assert.equal(u.mem.adaptBuyer,8);assert.deepEqual(h.battle.errors,[]);
});
test('Swire fatal save spends 5 then 10 native DP and actual redeployment resets that doubling',()=>{
  const h=setup([{charId:'char_1033_swire2',row:10,col:3}]),[u]=h.units,e=spawn(h,[10,4]);h.battle.getPlayer(u.ownerId).dp=100;
  h.battle.dealDamage(e,u,{amount:u.s.maxHp*2,type:'true'});assert.equal(u.alive,true);assert.equal(h.battle.getPlayer(u.ownerId).dp,95);
  h.battle.dealDamage(e,u,{amount:u.s.maxHp*2,type:'true'});assert.equal(h.battle.getPlayer(u.ownerId).dp,85);assert.equal(u.mem.adaptSaveCount,2);
  cycleRedeploy(h.battle,u);h.flush();assert.equal(u.mem.adaptSaveCount,0);assert.deepEqual(h.battle.errors,[]);
});
test('Gladiia binds a distant target, produces six original area hits and uses the smaller original final capture radius',()=>{
  const h=setup([{charId:'char_474_glady',row:10,col:3}]),[u]=h.units,target=spawn(h,[10,6]),near=spawn(h,[11,6]),outer=spawn(h,[11.4,6]);
  outer.base.massLevel=100;outer.markDirty();
  const hits=seen(h,u),captured=[];const native=h.battle.pullToFront.bind(h.battle);h.battle.pullToFront=(enemy,...args)=>{captured.push(enemy);return native(enemy,...args);};
  h.castNow(u);assert.equal(hits.filter(p=>p.target===target).length,6);assert.equal(hits.filter(p=>p.target===near).length,6);assert.equal(hits.filter(p=>p.target===outer).length,6);
  assert.ok(hasStatus(target,'bind'));assert.ok(captured.includes(target));assert.equal(captured.includes(outer),false);assert.deepEqual(h.battle.errors,[]);
});
test('Mizuki main burst remains whole-range while precisely three lowest-HP targets receive arts and stun',()=>{
  const h=setup([{charId:'char_437_mizuki',row:10,col:4}]),[u]=h.units,foes=Array.from({length:4},()=>spawn(h,[10,5])),hits=seen(h,u);
  h.castNow(u);assert.equal(hits.filter(p=>p.dmg.type==='phys').length,24);assert.equal(hits.filter(p=>p.dmg.type==='arts').length,18);
  assert.equal(foes.filter(e=>hasStatus(e,'stun')).length,3);assert.deepEqual(h.battle.errors,[]);
});
test('Mizuki bind link counts all three source events before one extra original lowest-HP talent hit',()=>{
  const h=setup([{charId:'char_437_mizuki',row:10,col:4},{charId:'char_373_lionhd',row:10,col:3}]),[u,ally]=h.units,e=spawn(h,[10,5]),hits=seen(h,u);
  for(let i=0;i<3;i++)applyStatus(h.battle,ally,e,{status:'bind',duration:1});h.flush();assert.equal(hits.length,1);assert.equal(hits[0].dmg.type,'arts');
});
test('Specter alter preserves all blocked attacks plus the HP-ratio extra branch and native non-attacking substitute',()=>{
  const h=setup([{charId:'char_1023_ghost2',row:10,col:4}]),[u]=h.units,e=spawn(h,[10,4]);h.step(2);u.hp=u.s.maxHp*.5;
  const hits=seen(h,u);h.castNow(u);assert.equal(hits.filter(p=>p.target===e&&p.dmg.type==='phys').length,12);
  h.battle.dealDamage(e,u,{amount:u.s.maxHp*5,type:'true'});h.flush();assert.equal(u.form,'doll');assert.equal(u.profile.dollNoAttack,true);
  const before=e.hp;h.run(2.2);assert.ok(e.hp<before);assert.ok(e.s.moveSpeed<e.base.moveSpeed||e.s.moveMul<1||e.buffs.some(b=>b.mods?.moveMul===.6));assert.deepEqual(h.battle.errors,[]);
});
test('Hbound repeated alchemy units keep all 35 independent pulses, native heavy slow and weight-sensitive extra damage',()=>{
  const h=setup([{charId:'char_4232_hbound',row:10,col:3}]),[u]=h.units,heavy=spawn(h,[10,5]),light=spawn(h,[10,5.5]);
  heavy.base.massLevel=3;heavy.markDirty();light.base.massLevel=1;light.markDirty();const hits=seen(h,u);h.castNow(u);h.castNow(u);h.run(35.1);
  assert.equal(hits.filter(p=>p.target===heavy).length,70);assert.equal(hits.filter(p=>p.target===light).length,70);
  assert.ok(hits.find(p=>p.target===heavy).dmg.amount>hits.find(p=>p.target===light).dmg.amount*9);assert.equal(u.mem.adaptAlchemy.size,0);assert.deepEqual(h.battle.errors,[]);
});
test('Justice Knight truly has no active skill, limits original air fragile to ten seconds and retains native long respawn',()=>{
  const h=setup([{charId:'char_4000_jnight',row:10,col:2},{charId:'char_103_angel',row:10,col:3}]),[u,ally]=h.units;
  const air=spawn(h,[10,4],{key:FLYER}),ground=spawn(h,[10,4]);h.run(.2);assert.equal(u.skill.kind,'passive');assert.equal(u.def.stats.respawnTime,200);
  assert.ok(air.s.dmgTakenMul>=1.1);assert.equal(ground.s.dmgTakenMul,1);assert.ok(ally.s.taunt<ally.base.taunt||ally.buffs.some(b=>b.mods?.taunt===-1));
  h.run(10);assert.equal(air.s.dmgTakenMul,1);assert.deepEqual(h.battle.errors,[]);
});
