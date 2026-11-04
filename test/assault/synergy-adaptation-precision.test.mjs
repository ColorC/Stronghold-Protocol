import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime } from '../helpers/synergyCard.js';
import { flatStage } from '../helpers/battleHarness.js';
import { Grid } from '../../server/sim/grid.js';
import { PRECISION_ADAPTATIONS } from '../../shared/assault/precision-adaptations.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { applyStatus } from '../../server/sim/content/assault/primitives.js';
import { apoptosisBursts } from '../../server/sim/content/assault/cards/adaptation-precision.js';

function setup(entries){const stage=flatStage(),h=synergyBattle(entries,{beforeStart:b=>{
  b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);
}});for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}return h;}
const spawn=(h,pos)=>h.spawn(pos,{mods:{hpMul:10000,speedMul:0}});
function seen(h,unit){const hits=[];h.battle.on('hit',p=>{if(p.source===unit)hits.push(p);},{priority:-100});return hits;}

test('four precise plans retain their native signatures and the sourced infinite forward line',()=>{
  for(const [id,plan]of Object.entries(PRECISION_ADAPTATIONS)){
    const body=runtime.bodies[id];assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId);
    assert.ok(body.adaptation.lines.every(l=>[...l].length<=32));
  }
  const body=runtime.bodies.char_430_fartth;assert.deepEqual(body.adaptation.rangeGrid,Array.from({length:21},(_,i)=>[0,i]));
});
test('Santalla preserves left/right/middle icicle cycle, independent repeated casts and real cold/freeze splash',()=>{
  const h=setup([{charId:'char_341_sntlla',row:10,col:2},{charId:'char_103_angel',row:10,col:3}]),[u,ally]=h.units;
  for(const pos of [[9,3],[10,3],[11,3]])spawn(h,pos);h.battle.rng.pick=list=>list[0];const fx=[];
  h.battle.on('statusApplied',()=>{});const native=h.battle.fx.bind(h.battle);h.battle.fx=(kind,p)=>{if(kind==='iceSpike')fx.push(p);return native(kind,p);};
  h.castNow(u);h.castNow(u);assert.equal(fx.length,24);assert.deepEqual(fx.slice(0,3).map(p=>p.y),[11,9,10]);
  h.run(.6);assert.ok(h.battle.enemies.some(e=>hasStatus(e,'frozen')||hasStatus(e,'cold')));assert.ok(ally.findBuff('resist'));assert.deepEqual(h.battle.errors,[]);
});
test('Fartooth truly reaches the far end of its original infinite line, ignores dodge and receives native outside-range bonus',()=>{
  const h=setup([{charId:'char_430_fartth',row:10,col:2}]),[u]=h.units,e=spawn(h,[10,10]),off=spawn(h,[11,10]);
  h.battle.addBuff(e,{key:'test:dodge',mods:{dodgePhys:1},duration:Infinity});const hits=seen(h,u);h.castNow(u);
  assert.equal(hits.length,6);assert.ok(hits.every(p=>p.target===e&&p.dmg.canDodge===false));assert.ok(hits.every(p=>p.dmg.mul>=1.4));
  assert.ok(e.hp<e.s.maxHp);assert.equal(off.hp,off.s.maxHp);assert.deepEqual(h.battle.errors,[]);
});
test('Fartooth original own concentration reacts to real damage and recovers after ten seconds, without a hit-point-loss reset',()=>{
  const h=setup([{charId:'char_430_fartth',row:10,col:2},{charId:'char_103_angel',row:10,col:3}]),[u,ally]=h.units,e=spawn(h,[10,4]);h.run(.3);
  const atk=u.s.atk;h.battle.dealDamage(e,u,{amount:100,type:'true'});h.run(.3);assert.ok(u.s.atk<atk);
  h.run(10.1);assert.ok(u.s.atk>=atk-1e-7);h.battle.loseHp(u,10,{source:e});h.run(.3);assert.ok(u.s.atk>=atk-1e-7);assert.equal(ally.buffs.some(b=>b.source===u&&b.mods?.atkPct),false);assert.deepEqual(h.battle.errors,[]);
});
test('Nymph burst respects two targets and converts damage only during an actual repeatable apoptosis instance',()=>{
  const h=setup([{charId:'char_4146_nymph',row:10,col:2},{charId:'char_373_lionhd',row:11,col:2}]),[u,ally]=h.units;
  const foes=Array.from({length:3},()=>spawn(h,[10,4]));h.battle.dealDamage(ally,foes[0],{amount:foes[0].gaugeMax,type:'element',element:'apoptosis'});h.flush();
  assert.ok(apoptosisBursts(foes[0]).length);const hits=seen(h,u),families=[];h.battle.assaultRuntime.observe('elementalDamage','test:elemental',e=>families.push(e.family));
  h.castNow(u);assert.equal(hits.length,16);assert.equal(hits.filter(p=>p.dmg.type==='elemental').length,8);assert.equal(new Set(hits.map(p=>p.target)).size,2);
  assert.ok(families.length>=8&&families.every(f=>f==='element'));const before=hits.length;h.run(1.2);assert.ok(hits.length>before);assert.deepEqual(h.battle.errors,[]);
});
test('Nymph mind key keeps the native ten-stack battle cap even when one real hit causes twelve separate bursts',()=>{
  const h=setup([{charId:'char_4146_nymph',row:10,col:2},{charId:'char_373_lionhd',row:11,col:2}]),[u,ally]=h.units,e=spawn(h,[10,4]);
  const atk=u.s.atk;h.battle.dealDamage(ally,e,{amount:e.gaugeMax*12,type:'element',element:'apoptosis'});h.flush();assert.equal(u.mem.adaptMindKey,10);
  assert.ok(Math.abs(u.s.atk-atk*1.2)<1e-7);assert.deepEqual(h.battle.errors,[]);
});
test('溯光星源 keeps two real locks, immediate mutually propagated arts damage and capped native sluggish modelling',()=>{
  const h=setup([{charId:'char_1047_halo2',row:10,col:2}]),[u]=h.units,foes=Array.from({length:3},()=>spawn(h,[10,4])),hits=seen(h,u);
  h.castNow(u);assert.equal(hits.filter(p=>!p.dmg.tags.includes('link')).length,16);assert.equal(hits.filter(p=>p.dmg.tags.includes('link')).length,16);
  assert.equal(new Set(hits.map(p=>p.target)).size,2);assert.ok(foes.filter(t=>hasStatus(t,'sluggish')).length===2);assert.equal(u.mem.haloStack,16);
  h.castNow(u);assert.equal(u.mem.haloStack,18);assert.deepEqual(u.mem.haloLocks,[]);assert.deepEqual(h.battle.errors,[]);
});
