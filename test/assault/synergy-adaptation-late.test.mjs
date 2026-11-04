import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime } from '../helpers/synergyCard.js';
import { flatStage } from '../helpers/battleHarness.js';
import { Grid } from '../../server/sim/grid.js';
import { LATE_ADAPTATIONS } from '../../shared/assault/late-adaptations.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { applyStatus } from '../../server/sim/content/assault/primitives.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';
import { cycleRedeploy } from '../../server/sim/content/assault/redeploy-cycle.js';

function setup(entries){const stage=flatStage(),h=synergyBattle(entries,{quiet:true,beforeStart:b=>{
  b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);
}});for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}return h;}
const spawn=(h,pos)=>h.spawn(pos,{mods:{hpMul:10000,speedMul:0}});
function seen(h,unit){const hits=[];h.battle.on('hit',p=>{if(p.source===unit)hits.push(p);},{priority:-100});return hits;}

test('four late signatures retain original slots and compact card lines',()=>{
  for(const [id,plan]of Object.entries(LATE_ADAPTATIONS)){
    const body=runtime.bodies[id];assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId);
    assert.ok(body.adaptation.lines.every(l=>[...l].length<=32));assert.equal(body.modulePlans.length,2);
  }
});
test('Pramanix alter keeps original attract routing, meaningful snow layers and repeatable full-range attacks',()=>{
  const h=setup([{charId:'char_1046_sbell2',row:10,col:2}]),[u]=h.units,e=spawn(h,[10,4]),hits=seen(h,u);
  h.castNow(u);assert.equal(hits.filter(p=>p.dmg.isAttack).length,6);assert.ok(e.buffs.some(b=>b.status==='attract'));assert.ok(u.mem.snow.size>0);
  assert.ok([...u.mem.snow.values()].every(n=>n===3));h.castNow(u);assert.equal(hits.filter(p=>p.dmg.isAttack).length,12);assert.ok([...u.mem.snow.values()].every(n=>n===5));assert.deepEqual(h.battle.errors,[]);
});
test('Pramanix alter stores a blessing after three other-source freezes and really revives twice without a same-source self-loop',()=>{
  const h=setup([{charId:'char_1046_sbell2',row:10,col:2},{charId:'char_373_lionhd',row:11,col:2}]),[u,ally]=h.units,e=spawn(h,[10,4]);
  for(let i=0;i<3;i++)applyStatus(h.battle,ally,e,{status:'freeze',duration:1});h.flush();assert.equal(u.mem.adaptBlessings,1);
  h.battle.dealDamage(e,u,{amount:u.s.maxHp*3,type:'true'});h.flush();assert.equal(u.alive,true);assert.equal(u.mem.blessUsed,true);assert.ok(hasStatus(e,'frozen'));
  h.battle.dealDamage(e,u,{amount:u.s.maxHp*3,type:'true'});h.flush();assert.equal(u.alive,true);assert.equal(u.mem.adaptBlessings,0);assert.deepEqual(h.battle.errors,[]);
});
test('Lappland alter follows native drone flight to a distant global target and settles independently on every cast without advancing time',()=>{
  const h=setup([{charId:'char_1038_whitw2',row:10,col:2}]),[u]=h.units,e=spawn(h,[12,10]),hits=seen(h,u),time=h.battle.time;
  h.castNow(u);assert.ok(hits.length>0);assert.equal(h.battle.time,time);assert.ok(hasStatus(e,'fear'));assert.equal(u.mem.drones,null);
  const before=hits.length;h.castNow(u);assert.ok(hits.length>before);assert.equal(u.mem.wolfStage??0,0);assert.deepEqual(h.battle.errors,[]);
});
test('Lappland alter uses actual Siracusa labels for native opening SP, and head-wolf stages follow actual field time',()=>{
  const h=setup([{charId:'char_1038_whitw2',row:10,col:2},{charId:'char_140_whitew',row:10,col:3}]),[u,ally]=h.units;
  // The fixture clears starting SP; observe the real second deployment.
  let grant=0;h.battle.assaultRuntime.observe('chargeGranted','test:sira',({payload:p})=>{if(p.target===ally)grant+=p.amount;});
  cycleRedeploy(h.battle,ally);h.flush();assert.equal(grant,5);
  h.run(20.2);assert.equal(u.mem.wolfStage,1);h.run(20);assert.equal(u.mem.wolfStage,2);h.run(20);assert.equal(u.mem.wolfStage,3);assert.deepEqual(h.battle.errors,[]);
});
test('Blaze alter spends one battle cast for three original-radius group attacks and burn bursts refill her true cast pool',()=>{
  const h=setup([{charId:'char_1040_blaze2',row:10,col:2},{charId:'char_373_lionhd',row:11,col:2}]),[u,ally]=h.units,e=spawn(h,[10,5]),near=spawn(h,[10,6]),outside=spawn(h,[12,7]),hits=seen(h,u);
  const hp=u.hp;h.castNow(u);assert.equal(assaultAmmoState(u).current,7);assert.ok(u.hp<hp);assert.equal(hits.filter(p=>p.target===e&&p.dmg.isAttack).length,3);assert.equal(hits.filter(p=>p.target===near&&p.dmg.isAttack).length,3);assert.equal(outside.hp,outside.s.maxHp);
  h.battle.dealDamage(ally,e,{amount:e.gaugeMax,type:'element',element:'burn'});h.flush();assert.equal(assaultAmmoState(u).current,8);assert.ok(hits.some(p=>p.dmg.type==='elemental'));assert.deepEqual(h.battle.errors,[]);
});
test('Blaze alter keeps original shielded downed regeneration and nearby revival stun',()=>{
  const h=setup([{charId:'char_1040_blaze2',row:10,col:2}]),[u]=h.units,e=spawn(h,[10,3]);
  h.battle.dealDamage(e,u,{amount:u.s.maxHp*3,type:'true'});h.flush();assert.equal(u.alive,true);assert.equal(u.mem.downed,true);
  assert.ok(u.buffs.some(b=>b.key==='blaze2:downed'&&b.shield===6000));u.hp=u.s.maxHp;h.run(.3);assert.equal(u.mem.downed,false);assert.ok(hasStatus(e,'stun'));assert.deepEqual(h.battle.errors,[]);
});
test('Faith mixer reloads an actual Laterano cast pool, accumulates ten counters without multiplying HP/DEF and consumes one per real incoming damage',()=>{
  const h=setup([{charId:'char_4194_rmixer',row:10,col:3},{charId:'char_1032_excu2',row:10,col:4}]),[u,ally]=h.units,foes=Array.from({length:4},()=>spawn(h,[10,5]));
  h.castNow(ally);assert.ok(assaultAmmoState(ally).current<assaultAmmoState(ally).capacity);h.castNow(u);const hp=u.s.maxHp,def=u.s.def;h.castNow(u);
  assert.equal(u.s.maxHp,hp);assert.equal(u.s.def,def);assert.equal(u.mem.adaptSermon.length,10);assert.equal(assaultAmmoState(ally).current,assaultAmmoState(ally).capacity);
  const hits=seen(h,u);h.battle.dealDamage(foes[0],u,{amount:1,type:'true'});h.flush();assert.equal(u.mem.adaptSermon.length,9);assert.equal(hits.length,3);
  assert.ok(u.findBuff('rmixer:t1'));assert.deepEqual(h.battle.errors,[]);
});
