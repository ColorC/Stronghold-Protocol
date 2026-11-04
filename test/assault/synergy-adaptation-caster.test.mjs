import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime, FLYER } from '../helpers/synergyCard.js';
import { CASTER_ADAPTATIONS } from '../../shared/assault/caster-adaptations.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { Grid } from '../../server/sim/grid.js';
import { flatStage } from '../helpers/battleHarness.js';

function setup(entries){const stage=flatStage(),h=synergyBattle(entries,{beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);}});
  for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}return h;}
function hits(h,unit){const seen=[];h.battle.on('hit',({source,target,dmg})=>{if(source===unit)seen.push({target,type:dmg.type,amount:dmg.amount,mul:dmg.mul,skill:dmg.isSkill});},{priority:-100});return seen;}
function tank(h,position,options={}){return h.spawn(position,{mods:{hpMul:10000,speedMul:0},...options});}

test('twelve caster signatures retain source slots, source ranges/target caps and concise sourced upgrades',()=>{
  for(const [id,plan]of Object.entries(CASTER_ADAPTATIONS)){
    const body=runtime.bodies[id];assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId,id);
    assert.equal(body.adaptation.targetCount,plan.targetCount);assert.equal(body.modulePlans.length,2);
    assert.ok(body.adaptation.lines.every(l=>[...l].length<=32));
  }
});

test('native natural-SP auras take the highest eligible value and fall back when a source leaves',()=>{
  const h=setup([{charId:'char_128_plosis',row:10,col:3},{charId:'char_213_mostma',row:10,col:4},
    {charId:'char_358_lisa',row:9,col:4},{charId:'char_235_jesica',row:9,col:3}]);const [plosis,mostma,lisa,sniper]=h.units;
  h.run(.3);assert.equal(mostma.s.spRecovery,mostma.base.spRecovery+.4);assert.equal(lisa.s.spRecovery,lisa.base.spRecovery+.4);
  assert.equal(sniper.s.spRecovery,sniper.base.spRecovery+.3);h.battle.retreat(mostma,{permanent:true});h.run(.3);
  assert.equal(plosis.s.spRecovery,plosis.base.spRecovery+.3);assert.deepEqual(h.battle.errors,[]);
});

test('initial deployment gifts also reach an ally deployed later in the same battle-start sequence',()=>{
  const h=setup([{charId:'char_103_angel',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [angel,ally]=h.units;
  h.run(.1);assert.ok(ally.buffs.some(b=>b.source===angel&&b.mods.atkPct===.08&&b.mods.hpPct===.13));
});

test('奇美拉 deals eight true strikes, gains the native HP state, then actually leaves with native respawn timing',()=>{
  const h=setup([{charId:'char_002_amiya',row:10,col:3}]);const [unit]=h.units;tank(h,[10,4]);const hp=unit.s.maxHp,seen=hits(h,unit);
  h.castNow(unit);assert.equal(seen.filter(x=>x.skill&&x.type==='true').length,8);assert.equal(unit.s.maxHp,hp*2);
  h.run(.2);assert.equal(unit.deployed,false);assert.equal(unit.removeReason,'chimera-end');assert.ok(unit.respawnAt>h.battle.time);
});

test('薄绿 preserves six pull rounds, final damage and native phalanx protection restoration',()=>{
  const h=setup([{charId:'char_388_mint',row:10,col:3}]);const [unit]=h.units,foe=tank(h,[10,5]);foe.base.massLevel=0;foe.markDirty();
  const defence=unit.s.def,seen=hits(h,unit);h.castNow(unit);assert.ok(seen.length>=2);assert.ok(foe.x<5);
  assert.equal(unit.s.def,defence);assert.ok(unit.findBuff('trait:phalanxGuard'));assert.deepEqual(h.battle.errors,[]);
});

test('海霓 preserves two targets, all ordinary-enemy slowdown and excludes elite enemies from her native fragile aura',()=>{
  const h=setup([{charId:'char_4079_haini',row:10,col:3}]);const [unit]=h.units,foes=Array.from({length:3},()=>tank(h,[10,4]));
  for(const foe of foes){foe.base.moveSpeed=1;foe.markDirty();}
  const elite=tank(h,[10,5]);elite.def={...elite.def,rank:'ELITE'};h.run(.3);assert.ok(foes.every(e=>e.s.dmgTakenMul>1));
  assert.equal(elite.s.dmgTakenMul,1);const seen=hits(h,unit);h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,16);
  assert.ok(foes.every(e=>e.s.moveSpeed<e.base.moveSpeed));
});

test('但书 keeps original ten-second silence/sluggish, an opening area hit and six follow-up attacks',()=>{
  const h=setup([{charId:'char_4032_provs',row:10,col:3},{charId:'char_1014_nearl2',row:10,col:4}]);const [unit,ally]=h.units;
  h.run(.1);
  const foes=[tank(h,[10,4]),tank(h,[10,5])],seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>x.skill).length,8);assert.ok(foes.every(e=>e.s.flags.silence&&hasStatus(e,'sluggish')));
  assert.equal(foes[0].findBuff('silence').timeLeft,10);assert.ok(ally.s.aspd>=ally.base.aspd+10);
});

test('小满 each repeated cast completes its own wake-up attack sequence after the original sleep',()=>{
  const h=setup([{charId:'char_4122_grabds',row:10,col:3}]);const [unit]=h.units,foes=Array.from({length:4},()=>tank(h,[10,4]));
  const seen=hits(h,unit);h.castNow(unit);h.castNow(unit);assert.equal(foes.filter(e=>hasStatus(e,'sleep')).length,4,'the next cast can sleep the remaining awake target');
  h.run(4.5);assert.equal(seen.length,0);h.run(1);assert.equal(seen.filter(x=>x.skill).length,24);assert.deepEqual(h.battle.errors,[]);
});

test('莫斯提马 preserves expanded-range wave damage, actual force-zero pushes and caster-specific natural recovery',()=>{
  const h=setup([{charId:'char_213_mostma',row:10,col:3}]);const [unit]=h.units,foe=tank(h,[10,4]);foe.base.massLevel=0;foe.markDirty();
  const x=foe.x,seen=hits(h,unit);h.castNow(unit);assert.ok(seen.filter(x=>x.skill).length>=1);assert.ok(foe.x>x);
  assert.equal(unit.s.spRecovery,unit.base.spRecovery+.4);assert.deepEqual(h.battle.errors,[]);
});

test('卡涅利安 retains charged 80% healing, within-cast growing marks and restores her native phalanx guard',()=>{
  const h=setup([{charId:'char_426_billro',row:10,col:3}]);const [unit]=h.units;tank(h,[10,4]);unit.hp=unit.s.maxHp*.1;
  unit.skill.charges=2;unit.skill.sp=unit.skill.spCost;const defence=unit.s.def,seen=hits(h,unit);
  assert.equal(h.battle.assaultRuntime.cast(unit,{force:true}),true);h.flush();assert.ok(unit.hp>=unit.s.maxHp*.9-1e-7);
  assert.equal(seen.filter(x=>x.skill).length,6);assert.ok(seen.at(-1).amount/seen[0].amount>7);
  assert.equal(unit.s.def,defence);assert.ok(unit.findBuff('trait:phalanxGuard'));assert.deepEqual(h.battle.errors,[]);
});

test('安洁莉娜 preserves five targets, global weightlessness, no ordinary attacks and innate global regeneration',()=>{
  const h=setup([{charId:'char_291_aglina',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  const foes=Array.from({length:6},()=>tank(h,[10,5])),remote=tank(h,[12,8]),seen=hits(h,unit);ally.hp-=500;
  h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,30);assert.ok(hasStatus(remote,'weightless'));
  assert.equal(unit.profile.noAttackUnlessSkill,true);const hp=ally.hp;h.run(1.1);assert.ok(ally.hp>=hp+20);
  assert.ok(foes.every(e=>hasStatus(e,'weightless')));assert.deepEqual(h.battle.errors,[]);
});

test('铃兰 retains expanded all-target slowing, enhanced fragile and six real regeneration heals',()=>{
  const h=setup([{charId:'char_358_lisa',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  ally.base.maxHp=1000000;ally.markDirty();void ally.s;ally.hp=1000;const foe=tank(h,[10,5]);let ticks=0;
  h.battle.on('heal',({source,target,opts})=>{if(source===unit&&target===ally&&opts.regen)ticks++;});h.castNow(unit);
  assert.equal(ticks,6);assert.ok(hasStatus(foe,'sluggish'));assert.ok(Math.abs(foe.s.dmgTakenMul-1.4)<1e-8);
});

test('异客 repeated storms retain the original 13-tile zone, eight real four-target chains and independent duration',()=>{
  const h=setup([{charId:'char_472_pasngr',row:10,col:3}]);const [unit]=h.units;
  for(const position of[[10,4],[10,4.3],[10.3,4],[10.3,4.3]])tank(h,position);const seen=hits(h,unit);h.castNow(unit);h.castNow(unit);h.run(4.2);
  assert.equal(seen.filter(x=>x.skill).length,64);assert.equal(unit.skill.maxCharges,2);assert.deepEqual(h.battle.errors,[]);
});

test('霍尔海雅 preserves all three independent lanes, native flight and first-contact lift before air bonus',()=>{
  const h=setup([{charId:'char_4027_heyak',row:10,col:3}]);const [unit]=h.units;
  const foes=[tank(h,[9,5]),tank(h,[10,5]),tank(h,[11,5])],seen=hits(h,unit);h.battle.rng=()=>.99;
  h.castNow(unit);h.run(2.5);assert.equal(seen.filter(x=>x.skill).length,9);assert.equal(new Set(seen.map(x=>x.target)).size,3);
  assert.ok(foes.every(e=>hasStatus(e,'levitate')));assert.ok(seen.every(x=>x.mul>=1.2));assert.deepEqual(h.battle.errors,[]);
});

test('逻各斯 keeps four main targets, actual RES/flat arts mark, and independently captured enemy projectiles',()=>{
  const h=setup([{charId:'char_4133_logos',row:10,col:3}]);const [unit]=h.units,foes=Array.from({length:5},()=>tank(h,[10,4]));
  for(const e of foes){e.base.res=40;e.markDirty();}h.battle.rng=()=>.99;const seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>x.skill).length,24);assert.equal(foes.filter(e=>e.s.res===30).length,4);
  let landed=0;const shot=h.battle.projectiles.add({from:{x:4,y:10},to:{x:9,y:10},source:foes[0],speed:1,onHit:()=>landed++});
  h.run(.1);assert.equal(shot.speed,.05);assert.equal(unit.mem.adaptLogosInterceptions,5);h.castNow(unit);
  h.run(2.2);assert.ok(!h.battle.projectiles.list.includes(shot));assert.equal(landed,0);assert.equal(unit.mem.adaptLogosInterceptions,11);
});
