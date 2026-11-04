import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime, FLYER } from '../helpers/synergyCard.js';
import { MELEE_ADAPTATIONS } from '../../shared/assault/melee-adaptations.js';
import { applyStatus, heal } from '../../server/sim/content/assault/primitives.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { cycleRedeploy } from '../../server/sim/content/assault/redeploy-cycle.js';
import { Grid } from '../../server/sim/grid.js';
import { flatStage } from '../helpers/battleHarness.js';

function setup(entries){const stage=flatStage(),h=synergyBattle(entries,{beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);}});
  for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}return h;}
function hits(h,unit){const seen=[];h.battle.on('hit',({source,target,dmg})=>{if(source===unit)seen.push({target,type:dmg.type,amount:dmg.amount,mul:dmg.mul,skill:dmg.isSkill});},{priority:-100});return seen;}
function block(h,unit,n=1){const foes=Array.from({length:n},()=>h.spawn([unit.tileR,unit.tileC]));h.step(3);assert.ok(unit.blocking.length>0);return foes;}

test('twenty melee adaptations preserve exact source slots, target caps, sourced modules and concise cards',()=>{
  for(const [id,plan]of Object.entries(MELEE_ADAPTATIONS)){
    const body=runtime.bodies[id];assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId,id);
    assert.equal(body.adaptation.targetCount,plan.targetCount);assert.equal(body.modulePlans.length,2);
    assert.ok(body.adaptation.lines.every(l=>[...l].length<=32));
  }
});

test('艾丝黛尔 preserves blocked-target attacks and nearby deaths heal herself plus the adjacent guard',()=>{
  const h=setup([{charId:'char_127_estell',row:10,col:3},{charId:'char_155_tiger',row:10,col:4}]);const [unit,ally]=h.units;
  block(h,unit,3);unit.hp=unit.s.maxHp*.2;ally.hp=ally.s.maxHp*.2;const seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>x.skill).length,18);const hp=unit.hp,other=ally.hp;h.battle.kill(h.spawn([9,3]),ally);h.flush();
  assert.ok(unit.hp>=hp+unit.s.maxHp*.12-1e-7);assert.ok(ally.hp>=other+ally.s.maxHp*.06-1e-7);
});

test('休谟斯 keeps health-dependent skill damage and recycles real Reaper overflow into capped shields',()=>{
  const h=setup([{charId:'char_491_humus',row:10,col:3},{charId:'char_1032_excu2',row:10,col:4}]);const [unit,ally]=h.units;
  h.spawn([10,4]);const seen=hits(h,unit);h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,6);
  for(const target of[unit,ally]){target.hp=target.s.maxHp;heal(h.battle,target,target,{amount:200});}
  assert.ok(unit.buffs.some(b=>b.shield>0));assert.ok(ally.buffs.some(b=>b.shield>0));assert.deepEqual(h.battle.errors,[]);
});

test('砾 only triggers her native barrier on deployment, decays it and grants the original low-cost defence aura',()=>{
  const h=setup([{charId:'char_237_gravel',row:10,col:3}]);const [unit]=h.units;
  const barrier=unit.buffs.find(b=>b.key.endsWith(':rat-swarm'));assert.ok(barrier?.shield>0);const before=barrier.shield;
  assert.equal(h.castNow(unit),false);h.run(1);assert.ok(barrier.shield<before);assert.equal(unit.mem.assaultCostDelta,-1);
  cycleRedeploy(h.battle,unit);h.flush();assert.ok(unit.buffs.filter(b=>b.key.endsWith(':rat-swarm')).length>=2);
});

test('诗怀雅 retains six physical strikes and the threefold guidance as native aura plus stored attack uses',()=>{
  const h=setup([{charId:'char_308_swire',row:10,col:3},{charId:'char_127_estell',row:10,col:4}]);const [unit,ally]=h.units;
  h.spawn([10,4]);const seen=hits(h,unit);h.castNow(unit);h.castNow(unit);assert.equal(seen.length,12);
  assert.equal(ally.mem.adaptAttackUses['cooperative-guidance'].length,8);assert.ok(ally.s.atk>=ally.base.atk*1.1-1e-7);
});

test('鞭刃 retains the expanded skill range, all blocked attacks, block resource and conditional native scolding',()=>{
  const h=setup([{charId:'char_265_sophia',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  block(h,unit);const seen=hits(h,unit);h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,6);
  assert.equal(unit.mem.adaptHitUses['whip-block'].length,4);assert.ok(ally.s.def>ally.base.def);
  assert.equal(ally.mem.adaptAttackUses['whip-scolding'].length,4);
});

test('摩根 retains native deployment HP cost, fading shield, immediate berserk and actual redeploy slashes',()=>{
  const h=setup([{charId:'char_154_morgan',row:10,col:3}]);const [unit]=h.units;
  assert.ok(Math.abs(unit.hp/unit.s.maxHp-.3)<1e-8);assert.ok(unit.buffs.some(b=>b.key.endsWith(':fearless-parry')&&b.shield>0));
  h.spawn([10,4]);const seen=hits(h,unit);cycleRedeploy(h.battle,unit);h.flush();
  assert.equal(seen.filter(x=>x.skill).length,6);assert.ok(unit.s.atk>=unit.base.atk*1.5-1e-7);assert.deepEqual(h.battle.errors,[]);
});

test('断崖 preserves six main attacks plus the complete set of adjacent allies blocked targets',()=>{
  const h=setup([{charId:'char_294_ayer',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  const [held]=block(h,ally);h.spawn([10,5]);const seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>x.skill).length,12);assert.ok(seen.every(x=>x.type==='arts'));assert.ok(seen.filter(x=>x.target===held).length>=6);
});

test('幽灵鲨 preserves native regeneration, end stun and a real lethal-hit resistance resource',()=>{
  const h=setup([{charId:'char_143_ghost',row:10,col:3}]);const [unit]=h.units;const [foe]=block(h,unit);
  h.castNow(unit);assert.ok(hasStatus(unit,'stun'));assert.equal(unit.mem.adaptGhostUndying,1);
  h.battle.dealDamage(foe,unit,{amount:unit.s.maxHp*10,type:'true'});assert.equal(unit.alive,true);assert.equal(unit.hp,1);assert.equal(unit.mem.adaptGhostUndying,0);
});

test('山 retains four targets, six double punches, native push and actual weakening',()=>{
  const h=setup([{charId:'char_264_f12yin',row:10,col:3}]);const [unit]=h.units;const foes=Array.from({length:5},()=>h.spawn([10,4]));
  h.battle.rng=()=>0;const seen=hits(h,unit);h.castNow(unit);assert.equal(new Set(seen.slice(0,8).map(x=>x.target)).size,4);
  assert.ok(seen.length<=6*2*4,'each original attack has at most four targets');
  assert.ok(seen.length>=8);assert.ok(foes.some(e=>e.s.atk<e.base.atk));assert.deepEqual(h.battle.errors,[]);
});

test('重岳 fifth cast keeps its single strike then unlocks original x-6, double normal hits and double skill splash',()=>{
  const h=setup([{charId:'char_2024_chyue',row:10,col:3}]);const [unit]=h.units;h.spawn([10,4]);const seen=hits(h,unit);
  for(let i=0;i<5;i++)h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,5);assert.equal(unit.mem.adaptChyueAwake,true);
  assert.equal(unit.rangeKeys.length,9);h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,7);
  const far=h.spawn([12,3]);unit.profile.noAttack=false;const before=seen.length;h.battle.forceAttack(unit,[far]);h.flush();assert.equal(seen.length-before,2);
  assert.deepEqual(h.battle.errors,[]);
});

test('仇白 retains three original targets and does not turn her own slit talent into an allied damage aura',()=>{
  const h=setup([{charId:'char_4082_qiubai',row:10,col:3},{charId:'char_235_jesica',row:10,col:4}]);const [unit,ally]=h.units;
  const foes=Array.from({length:4},()=>h.spawn([10,5]));const seen=hits(h,unit);h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,30);
  applyStatus(h.battle,ally,foes[0],{status:'bind',duration:2});const hp=foes[0].hp;
  h.battle.dealDamage(ally,foes[0],{amount:100,type:'true',isAttack:true});h.flush();assert.equal(hp-foes[0].hp,100);
});

test('佩佩 keeps growing splash within the one cast, native main stun and the original guard aura',()=>{
  const h=setup([{charId:'char_4058_pepe',row:10,col:3},{charId:'char_127_estell',row:10,col:4}]);const [unit,ally]=h.units;
  const main=h.spawn([10,4]),far=h.spawn([10,5.5]),seen=hits(h,unit);h.castNow(unit);
  assert.ok(seen.some(x=>x.target===far));assert.ok(hasStatus(main,'stun'));assert.ok(ally.s.atk>=ally.base.atk*1.16-1e-7);
  const rounds=seen.filter(x=>x.target===main);assert.ok(rounds.at(-1).amount>rounds[0].amount);
});

test('百炼嘉维尔 keeps deferred damage, extra block and actual current-block-based guard aura',()=>{
  const h=setup([{charId:'char_1026_gvial2',row:10,col:3}]);const [unit]=h.units;const [foe]=block(h,unit,3);
  h.run(.3);const before=unit.s.blockCnt,seen=hits(h,unit);h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,30);
  assert.equal(unit.s.blockCnt,before+2);const hp=unit.hp;h.battle.dealDamage(foe,unit,{amount:100,type:'phys',isAttack:true});h.flush();
  assert.ok(unit.hp>=hp-50);assert.equal(unit.mem.adaptHitUses['jungle-soul'].length,3);assert.deepEqual(h.battle.errors,[]);
});

test('玛恩纳 retains native ramp amplification, original five targets including air, and resets through native skillEnd',()=>{
  const h=setup([{charId:'char_4064_mlynar',row:10,col:3},{charId:'char_1014_nearl2',row:10,col:4}]);const [unit,ally]=h.units;
  h.run(20);assert.ok(unit.trait.ramp>0);for(const enemy of h.battle.enemies.filter(e=>e.alive))h.battle.kill(enemy,null);
  const air=h.spawn([9,5],{key:FLYER,mods:{hpMul:10000,speedMul:0}});for(let i=0;i<4;i++)h.spawn([10,5],{mods:{hpMul:10000,speedMul:0}});
  const seen=hits(h,unit);h.castNow(unit);assert.equal(new Set(seen.filter(x=>x.type==='phys').map(x=>x.target)).size,5);
  assert.ok(seen.some(x=>x.target===air));assert.equal(unit.trait.ramp,0);assert.equal(unit.s.blockCnt,0);
  assert.equal(ally.mem.adaptAttackUses['unbrilliant-glory'].length,3);assert.deepEqual(h.battle.errors,[]);
});

test('角峰 stores original three defensive stats by uses; recasting adds uses without stacking values',()=>{
  const h=setup([{charId:'char_199_yak',row:10,col:3}]);const [unit]=h.units,base=unit.s;
  h.castNow(unit);const hp=unit.s.maxHp,def=unit.s.def,res=unit.s.res;h.castNow(unit);
  assert.equal(unit.s.maxHp,hp);assert.equal(unit.s.def,def);assert.equal(unit.s.res,res);assert.ok(hp>base.maxHp&&res>base.res);
  assert.equal(unit.mem.adaptHitUses['cold-physique'].length,12);
});

test('蛇屠箱 restores eighteen percent life and retains the full shell DEF/block modifiers as accumulated hit uses',()=>{
  const h=setup([{charId:'char_150_snakek',row:10,col:3}]);const [unit]=h.units;unit.hp=unit.s.maxHp*.2;
  const hp=unit.hp,block=unit.s.blockCnt;h.castNow(unit);assert.ok(unit.hp>=hp+unit.s.maxHp*.18-1e-7);assert.equal(unit.s.blockCnt,block+1);
  h.castNow(unit);assert.equal(unit.mem.adaptHitUses['shell-defence'].length,12);
});

test('泡泡 uses actual enhanced defence for each reflected hit and preserves original attacker weakening',()=>{
  const h=setup([{charId:'char_381_bubble',row:10,col:3}]);const [unit]=h.units,foe=h.spawn([10,4]);h.castNow(unit);
  const seen=hits(h,unit),def=unit.s.def;h.battle.dealDamage(foe,unit,{amount:100,type:'phys',isAttack:true});h.flush();
  assert.ok(seen.some(x=>Math.abs(x.amount-def*.5)<1e-7));assert.ok(foe.s.atk<foe.base.atk);assert.equal(unit.mem.adaptHitUses.beaten.length,5);
});

test('古米 repeated casts finish two independent ten-second cooking sequences and real allied stuns reserve a critical attack',()=>{
  const h=setup([{charId:'char_196_sunbr',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  ally.base.maxHp=1000000;ally.markDirty();void ally.s;ally.hp=1000;let heals=0;h.battle.on('heal',({source})=>{if(source===unit)heals++;});
  h.castNow(unit);h.castNow(unit);h.run(9.5);assert.equal(heals,0);h.run(1);assert.equal(heals,12);
  const foe=h.spawn([10,4]);for(let i=0;i<3;i++)applyStatus(h.battle,ally,foe,{status:'stun',duration:1});h.flush();assert.equal(unit.mem.adaptGummyCrit,1);
});

test('星熊 retains the exact original forward range and native twenty-five-percent physical/arts block',()=>{
  const h=setup([{charId:'char_136_hsguma',row:10,col:3}]);const [unit]=h.units,near=h.spawn([10,4]),far=h.spawn([10,5]),seen=hits(h,unit);
  h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,10);assert.ok(seen.every(x=>x.target===near&&x.target!==far));
  h.battle.rng=()=>0;const hp=unit.hp;h.battle.dealDamage(near,unit,{amount:100,type:'arts'});assert.equal(unit.hp,hp);
});

test('森蚺 retains three blocked attacks, native heal, defensive uses, end stun and health-gated damage',()=>{
  const h=setup([{charId:'char_416_zumama',row:10,col:3}]);const [unit]=h.units;block(h,unit);unit.hp=unit.s.maxHp*.2;
  const hp=unit.hp,seen=hits(h,unit);h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,6);
  assert.ok(unit.hp>=hp+unit.s.maxHp*.36-1e-7);assert.ok(hasStatus(unit,'stun'));assert.equal(unit.mem.adaptHitUses['steel-will'].length,4);
});
