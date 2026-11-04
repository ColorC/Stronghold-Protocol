import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime } from '../helpers/synergyCard.js';
import { POOL_ADAPTATIONS } from '../../shared/assault/pool-adaptations.js';
import { applyStatus } from '../../server/sim/content/assault/primitives.js';
import { anchor } from '../../server/sim/content/assault/cards/adaptation-core.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { spawnTestSummon } from '../helpers/adaptationActions.js';
import { Grid } from '../../server/sim/grid.js';
import { flatStage } from '../helpers/battleHarness.js';

function hold(h){h.units.forEach(u=>{h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';});}
function hits(h,unit){const list=[];h.battle.on('hit',({source,target,dmg})=>{if(source===unit)list.push({target,type:dmg.type,skill:dmg.isSkill,amount:dmg.amount,mul:dmg.mul});},{priority:-100});return list;}
function skillCells(h,unit){return anchor(unit).rangeKeys.map(k=>[Math.floor(k/21),k%21]).filter(([r,c])=>h.battle.grid.inRect(r,c)&&!(r===unit.tileR&&c===unit.tileC));}
function onFlat(entries,stage=flatStage()){return synergyBattle(entries,{beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);}});}

test('the next pool entries preserve reviewed source slots, original target caps and two sourced modules',()=>{
  for(const [id,plan]of Object.entries(POOL_ADAPTATIONS)){
    const body=runtime.bodies[id];assert.ok(body.adaptation,id);
    assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId);
    assert.equal(body.adaptation.targetCount,plan.targetCount);
    assert.equal(body.modulePlans.length,2);assert.ok(body.modulePlans.every(m=>m.sourceModuleId||m.source.pointer));
    assert.ok(body.adaptation.lines.length<=3);assert.ok(body.adaptation.lines.every(l=>[...l].length<=32));
  }
});

test('因陀罗 preserves her arts life drain and melee dodge; three real dodges grant one next-attack resource',()=>{
  const h=synergyBattle([{charId:'char_155_tiger',row:10,col:3},{charId:'char_356_broca',row:10,col:2}]);hold(h);
  const [tiger,broca]=h.units,foe=h.spawn([10,4]);tiger.hp=tiger.s.maxHp*.1;
  const before=tiger.hp,seen=hits(h,tiger);h.castNow(tiger);
  assert.equal(seen.filter(e=>e.skill&&e.type==='arts').length,8);assert.ok(tiger.hp>before);
  h.battle.rng=()=>0;
  for(let i=0;i<3;i++)h.battle.dealDamage(foe,tiger,{amount:10,type:'phys',isAttack:true});h.flush();
  assert.equal(broca.mem.adaptDoubleAttacks,1);assert.equal(tiger.mem.adaptDoubleAttacks,3);
  broca.profile.noAttack=false;const attacks=hits(h,broca);h.battle.forceAttack(broca,[foe]);h.flush();
  assert.equal(broca.mem.adaptDoubleAttacks,0);assert.ok(attacks.some(e=>e.mul===2));
  assert.deepEqual(h.battle.errors,[]);
});

test('拉普兰德 resolves eleven attacks per original two targets and silence feeds the adjacent guard in counted groups',()=>{
  const h=synergyBattle([{charId:'char_140_whitew',row:10,col:3},{charId:'char_188_helage',row:10,col:2}]);hold(h);
  const [lap,guard]=h.units,foes=[h.spawn([10,4]),h.spawn([10,5]),h.spawn([10,6])],seen=hits(h,lap);
  h.castNow(lap);assert.equal(seen.filter(e=>e.skill).length,22);
  assert.equal(foes.filter(e=>e.s.flags.silence).length,2);
  h.run(.2);assert.equal(guard.skill.sp,8);assert.equal(lap.skill.sp,0);
});

test('布洛卡 keeps three targets, arts strikes, sluggish and self stun; three native blocks charge him once',()=>{
  const h=onFlat([{charId:'char_356_broca',row:10,col:3},{charId:'char_143_ghost',row:11,col:4}]);hold(h);
  const [broca,blocker]=h.units;for(let i=0;i<4;i++)h.spawn([10,4]);const seen=hits(h,broca);
  h.castNow(broca);assert.equal(seen.filter(e=>e.skill).length,15);assert.ok(hasStatus(broca,'stun'));
  h.hold(broca);for(let i=0;i<3;i++)h.spawn([blocker.tileR,blocker.tileC]);h.step(3);
  assert.ok(broca.skill.sp>=4);assert.deepEqual(h.battle.errors,[]);
});

test('崖心 pulls only three original-range targets, deals true damage and turns counted pulls into the original stun',()=>{
  const h=onFlat([{charId:'char_173_slchan',row:10,col:3}]);hold(h);const [unit]=h.units;
  const cells=skillCells(h,unit).filter(([r,c])=>c>=unit.tileC+2);assert.ok(cells.length>=3);
  const foes=cells.slice(0,3).map(p=>h.spawn(p));const seen=hits(h,unit);
  const initial=foes.map(e=>[e.x,e.y]);h.castNow(unit);h.run(.2);
  assert.equal(seen.filter(e=>e.type==='true').length,3);assert.ok(foes.every(e=>hasStatus(e,'stun')));
  assert.ok(foes.some((e,i)=>e.x!==initial[i][0]||e.y!==initial[i][1]));
  assert.ok(foes.every(e=>!hasStatus(e,'cold')&&!hasStatus(e,'frozen')),'the original kit has no 寒冷; the link uses 晕眩');
  const extra=h.spawn(cells[0]);extra.base.massLevel=0;h.battle.assaultRuntime.publish('statusApplied',{source:unit,target:extra,status:'pull'});
  h.battle.assaultRuntime.publish('statusApplied',{source:unit,target:extra,status:'pull'});h.flush();
  assert.ok(hasStatus(extra,'stun'),'every second counted pull stuns the target');
  assert.equal(extra.findBuff('stun').timeLeft,2);assert.deepEqual(h.battle.errors,[]);
});

test('见行者 uses the native highland collision and applies actual weight-based defence penetration',()=>{
  const stage=flatStage();stage.rows[10]=stage.rows[10].slice(0,6)+'h'+stage.rows[10].slice(7);
  const h=onFlat([{charId:'char_4036_forcer',row:10,col:3}],stage);hold(h);
  const [unit]=h.units,foe=h.spawn([10,5]);foe.base.massLevel=0;foe.markDirty();
  h.castNow(unit);assert.ok(hasStatus(foe,'stun'));assert.equal(foe.findBuff('stun').timeLeft,4);
  const heavy=h.spawn([10,4]);heavy.base.massLevel=3;heavy.markDirty();let ignore=0;
  h.battle.on('hit',({source,dmg})=>{if(source===unit)ignore=dmg.defIgnoreFlat;},{priority:-100});
  h.battle.dealDamage(unit,heavy,{amount:1000,type:'phys',isAttack:true});assert.equal(ignore,180);
});

test('赫拉格 keeps original three targets, innate berserk and own healing from three friendly kills',()=>{
  const h=synergyBattle([{charId:'char_188_helage',row:10,col:3},{charId:'char_103_angel',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units;for(let i=0;i<4;i++)h.spawn([10,4]);unit.hp=unit.s.maxHp*.2;
  const seen=hits(h,unit);h.castNow(unit);assert.equal(seen.filter(e=>e.skill).length,21);
  h.run(.3);assert.ok(unit.s.aspd>unit.base.aspd);
  const hp=unit.hp;for(let i=0;i<3;i++){const e=h.spawn([12,9]);h.battle.kill(e,ally);}h.flush();
  assert.ok(unit.hp>=hp+unit.s.maxHp*.2-1e-6);
});

test('白金 enters the original expanded battle range once and uses stored full charge on an actual attack',()=>{
  const h=synergyBattle([{charId:'char_204_platnm',row:10,col:3},{charId:'char_102_texas',row:10,col:2}]);hold(h);
  const [unit,other]=h.units,old=unit.rangeKeys.length;assert.equal(h.castNow(unit),true);const atk=unit.s.atk;
  assert.ok(unit.rangeKeys.length>old);assert.equal(h.castNow(unit),false);assert.equal(unit.s.atk,atk);
  const foe=h.spawn([10,5]);for(let i=0;i<3;i++){applyStatus(h.battle,other,foe,{status:'stun',duration:3});h.flush();}
  assert.equal(unit.mem.adaptPlatinumFull,1);unit.profile.noAttack=false;
  h.battle.forceAttack(unit,[foe]);h.flush();assert.equal(unit.mem.adaptPlatinumFull,0);
});

test('莱恩哈特 hits his original wider area, reduces RES by a fraction and charges from a real caster in a crowd',()=>{
  const h=synergyBattle([{charId:'char_373_lionhd',row:10,col:3},{charId:'char_4054_malist',row:10,col:2}]);hold(h);
  const [unit,caster]=h.units,foes=Array.from({length:4},()=>h.spawn([10,4]));
  for(const e of foes){e.base.res=40;e.markDirty();}h.castNow(unit);
  assert.ok(foes.every(e=>Math.abs(e.s.res-34)<1e-9));h.hold(unit);h.castNow(caster);assert.equal(unit.skill.sp,4);
});

test('复奏 preserves three original main targets and independent six-tick damage across repeated casts',()=>{
  const h=synergyBattle([{charId:'char_4031_liesel',row:10,col:3}]);hold(h);const [unit]=h.units;
  const foe=h.spawn([10,5],{mods:{hpMul:1000,speedMul:0}}),seen=hits(h,unit);
  h.castNow(unit);h.castNow(unit);assert.equal(seen.filter(e=>e.skill).length,2);
  h.run(6.1);assert.equal(seen.filter(e=>e.skill).length,14);assert.ok(foe.hp<foe.s.maxHp);
  assert.deepEqual(h.battle.errors,[]);
});

test('至简 retains two hits and three stored uses, while a three-cast link earns one complete critical skill',()=>{
  const h=synergyBattle([{charId:'char_4054_malist',row:10,col:3},{charId:'char_373_lionhd',row:10,col:2}]);hold(h);
  const [unit,caster]=h.units;h.spawn([10,4]);h.battle.rng=()=>.99;
  for(let i=0;i<3;i++)h.castNow(caster);assert.equal(unit.mem.adaptInsight,1);
  const seen=hits(h,unit);h.castNow(unit);assert.equal(seen.length,2);assert.equal(unit.mem.adaptInsight,0);
  assert.ok(seen.every(e=>Math.abs(e.amount-unit.s.atk*2*1.5)<1e-8));assert.equal(unit.skill.maxCharges,3);
});

test('雪猎 retains two special rounds plus the native beast; three friendly cold applications earn another beast',()=>{
  const h=synergyBattle([{charId:'char_4211_snhunt',row:10,col:3},{charId:'char_206_gnosis',row:10,col:2}]);hold(h);
  const [unit,gnosis]=h.units,foe=h.spawn([10,5]),seen=hits(h,unit);foe.moving=false;
  h.castNow(unit);assert.equal(seen.length,3);assert.ok(hasStatus(foe,'cold'));
  for(let i=0;i<3;i++)applyStatus(h.battle,gnosis,foe,{status:'cold',duration:3});h.flush();
  assert.equal(seen.length,4);assert.equal(unit.skill.maxCharges,2);
});

test('德克萨斯 retains two sword hits, actual DP and counted DP-to-vanguard charge',()=>{
  const h=synergyBattle([{charId:'char_102_texas',row:10,col:3},{charId:'char_112_siege',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units,foe=h.spawn([10,4]);h.battle.getPlayer(unit.ownerId).dp=0;const seen=hits(h,unit);
  h.castNow(unit);assert.equal(seen.filter(e=>e.skill).length,2);assert.ok(hasStatus(foe,'stun'));
  assert.equal(h.battle.getPlayer(unit.ownerId).dp,12);assert.equal(ally.skill.sp,4);
});

test('贾维 preserves percentage RES reduction and cuts only the actual owner of each second entered summon',()=>{
  const h=synergyBattle([{charId:'char_349_chiave',row:10,col:3},{charId:'char_2023_ling',row:11,col:3},{charId:'char_103_angel',row:10,col:2}]);hold(h);
  const [unit,ling,other]=h.units,foe=h.spawn([10,4]);foe.base.res=40;foe.markDirty();h.castNow(unit);assert.equal(foe.s.res,32);
  const before=ling.assaultCycle.at,untouched=other.assaultCycle.at;spawnTestSummon(h,ling);spawnTestSummon(h,ling);
  assert.equal(ling.assaultCycle.at,before-12);assert.equal(other.assaultCycle.at,untouched);
  assert.deepEqual(h.battle.errors,[]);
});
