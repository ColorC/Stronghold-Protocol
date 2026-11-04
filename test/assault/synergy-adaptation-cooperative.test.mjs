import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime } from '../helpers/synergyCard.js';
import { flatStage } from '../helpers/battleHarness.js';
import { Grid } from '../../server/sim/grid.js';
import { COOPERATIVE_ADAPTATIONS } from '../../shared/assault/cooperative-adaptations.js';
import { sourceKey } from '../../server/sim/content/assault/cards/adaptation-core.js';
import { installResourceParts } from '../../server/sim/content/assault/cards/adaptation-native.js';

function setup(entries){const stage=flatStage(),h=synergyBattle(entries,{beforeStart:b=>{
  b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);
}});for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}return h;}
const spawn=(h,pos)=>h.spawn(pos,{mods:{hpMul:10000,speedMul:0}});
function seen(h,u){const list=[];h.battle.on('hit',p=>{if(p.source===u)list.push(p);},{priority:-100});return list;}
const ok=h=>assert.deepEqual(h.battle.errors,[]);
test('seven cooperative cards retain real skill slots, original target counts and compact lines',()=>{
  for(const[id,plan]of Object.entries(COOPERATIVE_ADAPTATIONS)){const body=runtime.bodies[id];assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId);
    assert.ok(body.adaptation.lines.length<=3);assert.ok(body.adaptation.lines.every(l=>[...l].length<=32),`${id}: ${body.adaptation.lines}`);assert.equal(body.modulePlans.length,2);}
});
test('Cetsyr shares HP proportionally and repeated casts store eight inspirations without stacking max HP',()=>{
  const h=setup([{charId:'char_4134_cetsyr',row:10,col:2},{charId:'char_373_lionhd',row:10,col:3}]),[u,a]=h.units;
  u.hp=u.s.maxHp*.5;a.hp=a.s.maxHp*.2;h.castNow(u);const max=a.s.maxHp;assert.ok(a.hp>0);assert.equal(a.mem.adaptHitUses['cetsyr-inspire'].length,4);
  h.castNow(u);assert.equal(a.mem.adaptHitUses['cetsyr-inspire'].length,8);assert.equal(a.s.maxHp,max);assert.ok(a.findBuff('cetsyr:mote'));ok(h);
});
test('Cetsyr protection applies to a real Sarkaz enemy even when she is not the assault leader and ends when she leaves',()=>{
  const h=setup([{charId:'char_4134_cetsyr',row:10,col:2},{charId:'char_373_lionhd',row:10,col:3}]),[u,a]=h.units,e=spawn(h,[10,5]);e.def={...e.def,tags:['sarkaz']};
  let dealt=h.battle.dealDamage(e,a,{amount:100,type:'true'});assert.ok(Math.abs(dealt-90)<1e-6);u.deployed=false;
  dealt=h.battle.dealDamage(e,a,{amount:100,type:'true'});assert.ok(Math.abs(dealt-100)<1e-6);ok(h);
});
test('Haruka accumulates twelve strong bubbles, mitigates real damage and pops after the native delay with levitation damage',()=>{
  const h=setup([{charId:'char_4202_haruka',row:10,col:2},{charId:'char_373_lionhd',row:10,col:3}]),[u,a]=h.units,e=spawn(h,[10,5]);
  a.hp=1;u.hp=1;h.castNow(u);const holder=h.units.find(x=>x.mem.adaptHitUses?.['haruka-bubbles']?.length===6);assert.ok(holder);
  // Keep this recipient the lowest for the second cast.
  holder.hp=1;h.units.find(x=>x!==holder).hp=1;h.castNow(u);assert.equal(holder.mem.adaptHitUses['haruka-bubbles'].length,12);
  holder.hp=holder.s.maxHp*.5;const hp=holder.hp;h.battle.dealDamage(e,holder,{amount:100,type:'arts',isAttack:true});h.flush();
  assert.ok(holder.hp<hp);assert.ok(holder.hp>hp-100);assert.equal(holder.mem.adaptHitUses['haruka-bubbles'].length,11);assert.equal(e.s.flags.levitate,true);
  const hits=seen(h,u);h.run(.6);assert.ok(holder.hp>hp-100);assert.ok(hits.some(p=>p.target===e&&p.dmg.isSkill));ok(h);
});
test('Cello chooses three native base-stat leaders independently, stores uses and amplifies actual apoptosis fill only during the cast',()=>{
  const h=setup([{charId:'char_245_cello',row:10,col:2},{charId:'char_373_lionhd',row:10,col:3}]),[u,a]=h.units,e=spawn(h,[10,4]);u.base.atk=10;u.markDirty();const hits=seen(h,u);
  h.castNow(u);assert.equal(a.mem.adaptHitUses['tango-hp'].length,6);assert.equal(a.mem.adaptHitUses['tango-def'].length,6);assert.equal(a.mem.adaptAttackUses['tango-atk'].length,6);
  assert.equal(hits.filter(p=>p.dmg.type==='element').length,0);assert.ok(e.elem.apoptosis>6*2.8);assert.equal(u.mem.celloBoost,1);
  const old=e.elem.apoptosis;h.battle.dealDamage(a,e,{amount:10,type:'element',element:'apoptosis'});assert.ok(Math.abs(e.elem.apoptosis-old-12)<1e-6);
  h.castNow(u);assert.equal(a.mem.adaptAttackUses['tango-atk'].length,12);ok(h);
});
test('Reed stores twelve independent burn pulses, retains two targets, real profession healing and self sharing',()=>{
  const h=setup([{charId:'char_1020_reed2',row:10,col:2},{charId:'char_373_lionhd',row:10,col:3}]),[u,a]=h.units,es=[spawn(h,[10,4]),spawn(h,[10,5]),spawn(h,[11,5])],hits=seen(h,u);
  a.hp=1;u.hp=1;h.castNow(u);h.castNow(u);assert.equal(u.mem.adaptReedPulses.length,12);assert.equal(hits.filter(p=>p.dmg.isAttack).length,24);
  assert.ok(a.hp>1);assert.ok(u.hp>1);assert.equal(es.filter(e=>e.findBuff(sourceKey(u,'scorch'))).length,2);
  const before=hits.length;h.run(1.1);assert.equal(u.mem.adaptReedPulses.length,11);assert.ok(hits.length>before);ok(h);
});
test('Reed original scorch explosion spreads to an adjacent enemy when the marked victim is killed by someone else',()=>{
  const h=setup([{charId:'char_1020_reed2',row:10,col:2},{charId:'char_373_lionhd',row:10,col:3}]),[u,a]=h.units,e=spawn(h,[10,4]);h.castNow(u);const other=spawn(h,[11,4]),hits=seen(h,u);
  h.battle.dealDamage(a,e,{amount:e.hp*2,type:'true'});h.flush();assert.ok(hits.some(p=>p.target===other));assert.ok(other.findBuff(sourceKey(u,'scorch')));ok(h);
});
test('Titi stores twelve dream bursts, attacks sleeping targets, and another operator sleep really causes global wake propagation',()=>{
  const h=setup([{charId:'char_4056_titi',row:10,col:2},{charId:'char_373_lionhd',row:10,col:3}]),[u,a]=h.units,e=spawn(h,[10,4]),hits=seen(h,u);
  h.castNow(u);h.castNow(u);assert.equal(hits.filter(p=>p.dmg.isAttack).length,12);assert.equal(u.mem.adaptTitiWakes,12);assert.equal(u.skill.active,false);
  const distant=spawn(h,[12,8]),next=spawn(h,[12,9]);h.battle.applyStatus(distant,'sleep',{duration:.3,source:a});h.run(.5);
  assert.ok(hits.some(p=>p.target===distant));assert.equal(next.s.flags.sleep,true);assert.equal(u.mem.adaptTitiWakes,11);assert.equal(e.s.flags.sleep,true);ok(h);
});
test('Titi spends one real fatal guard, keeps the ally asleep until full health, and never needs a lingering skill window',()=>{
  const h=setup([{charId:'char_4056_titi',row:10,col:2},{charId:'char_373_lionhd',row:10,col:3}]),[u,a]=h.units,e=spawn(h,[10,4]);h.castNow(u);
  h.battle.dealDamage(e,a,{amount:a.s.maxHp*4,type:'true'});h.flush();assert.equal(a.alive,true);assert.ok(a.findBuff('titi:allySleep'));assert.equal(u.mem.adaptTitiGuards,0);assert.equal(u.skill.active,false);
  a.hp=a.s.maxHp;h.run(.3);assert.equal(a.findBuff('titi:allySleep'),null);ok(h);
});
test('Shu sows actual healed tiles, accumulates twelve returns and attack grants, then returns a moving enemy by two tiles',()=>{
  const h=setup([{charId:'char_2025_shu',row:10,col:3},{charId:'char_373_lionhd',row:10,col:4}]),[u,a]=h.units,e=spawn(h,[10,5]);a.hp=1;
  h.castNow(u);assert.ok(u.mem.shuSown.has(10*21+4));h.castNow(u);assert.equal(u.mem.adaptShuReturns,12);assert.equal(a.mem.adaptAttackUses['shu-harvest'].length,12);
  h.run(.2);e.x=7;h.battle._buildEnemyIndex();h.run(.2);assert.equal(e.x,5);assert.equal(e.y,10);assert.equal(u.mem.adaptShuReturns,11);assert.ok(a.findBuff('talent:shu:farm'));ok(h);
});
test('Yu repeat does not multiply stats and actual ally arts crossing his original wall consumes one stock per damage',()=>{
  const h=setup([{charId:'char_2026_yu',row:10,col:3},{charId:'char_373_lionhd',row:10,col:2}]),[u,a]=h.units,e=spawn(h,[10,5]);
  h.castNow(u);const hp=u.s.maxHp,atk=u.s.atk;assert.deepEqual(u.mem.yuWall,{axis:'x',v:3});h.castNow(u);assert.equal(u.s.maxHp,hp);assert.equal(u.s.atk,atk);assert.equal(u.mem.adaptYuWall,16);
  h.battle.dealDamage(a,e,{amount:10,type:'arts'});assert.equal(u.mem.adaptYuWall,15);assert.ok(e.elem.burn>0);assert.equal(u.skill.active,false);
  for(let i=0;i<15;i++)h.battle.dealDamage(a,e,{amount:10,type:'arts'});assert.equal(u.mem.adaptYuWall,0);assert.equal(u.mem.yuWall,null);assert.equal(u.s.maxHp,hp);ok(h);
});
test('Yu actual ranged projectile interception consumes stock and leaves the skill runtime inactive',()=>{
  const h=setup([{charId:'char_2026_yu',row:10,col:3},{charId:'char_373_lionhd',row:10,col:2}]),[u,a]=h.units,e=spawn(h,[10,5]);h.castNow(u);e.base.rangeRadius=5;h.battle.rng=Object.assign(()=>0,{chance:()=>true});
  const hp=a.hp;h.battle.dealDamage(e,a,{amount:100,type:'phys',isAttack:true});assert.equal(a.hp,hp);assert.equal(u.mem.adaptYuWall,7);assert.equal(u.skill.active,false);ok(h);
});
test('Yu grants native field-wide regeneration only while wall stock remains, without leaving a timed active flag',()=>{
  const h=setup([{charId:'char_2026_yu',row:10,col:3},{charId:'char_373_lionhd',row:10,col:2},{charId:'char_150_snakek',row:11,col:3},{charId:'char_199_yak',row:11,col:4}]),[u,a]=h.units;
  h.castNow(u);a.hp=a.s.maxHp*.5;const hp=a.hp;h.run(1.1);assert.ok(a.hp>hp);assert.equal(u.skill.active,false);
  u.mem.adaptYuWall=0;u.mem.yuWall=null;const stopped=a.hp;h.run(1.1);assert.equal(a.hp,stopped);ok(h);
});
test('Shu retains the native four-Sui squad bonus and periodic actual SP gift',()=>{
  const h=setup([{charId:'char_2025_shu',row:10,col:3},{charId:'char_2026_yu',row:11,col:3},{charId:'char_2024_chyue',row:10,col:4},{charId:'char_2023_ling',row:10,col:2}]),[,a]=h.units;
  assert.ok(a.findBuff('talent:shu:sui'));h.run(4.2);assert.ok(h.spOf(a)>=1);ok(h);
});
test('native resource scopes restore active even across nested hooks and exceptions',()=>{
  const h=setup([{charId:'char_373_lionhd',row:10,col:3}]),[u]=h.units,b=h.battle;let seen=false;
  installResourceParts(b,u,{install(b){b.on('test:outer',()=>{assert.equal(u.skill.active,true);b.emit('test:inner',{});assert.equal(u.skill.active,true);});
    b.on('test:inner',()=>{seen=true;assert.equal(u.skill.active,false);});b.on('test:error',()=>{assert.equal(u.skill.active,true);throw Error('resource scope test');});}},event=>event!=='test:inner');
  b.emit('test:outer',{});assert.equal(seen,true);assert.equal(u.skill.active,false);
  assert.throws(()=>b.emit('test:error',{}),/resource scope test/);assert.equal(u.skill.active,false);
});
