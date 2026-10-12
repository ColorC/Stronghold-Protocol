import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../../server/data.js';
import {getResonanceCatalog} from '../../server/modes/resonance/catalog.js';
import {buildResonanceBattle} from '../../server/modes/resonance/battle.js';
import {spawnChildren} from '../../server/sim/content/enemies.js';
const data=loadData(process.env.SP_DATA_DIR,{log:{warn(){},error(){}}});
const PHALANX='enemy_1169_duphlx',PHANTOM='enemy_2017_csphts';
const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-6,`${message}: ${actual} vs ${expected}`);
const battleAt=(difficulty,seed=23,round=10)=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seed});
  return buildResonanceBattle({seed,difficulty,round,roundLimit:difficulty==='ABYSS'?30:28,rulesVersion:3,seasonId:catalog.config.seasonId,level:1,hp:100,strategies:[],pieces:[]},{data,catalog});
};

test('an enemy spawned in the fight takes the node DEF multiplier once, and passes it on without compounding',()=>{
  const {battle,prepared}=battleAt('NORMAL');
  const factor=prepared.enemyBalance.defMultiplier;
  assert.equal(factor,0.35);
  const phantom=battle.spawnEnemy(PHANTOM,{pos:[10,9]});
  close(phantom.base.def,data.enemies[PHANTOM].stats.def*factor,'a summon with no wave mods gets DEF ×0.35');
  assert.equal(phantom.mods.resonanceDefMul,factor);
  const wave=prepared.wave.spawns.find(spawn=>spawn.enemyKey===PHALANX);
  const scheduled=battle.spawnEnemy(PHALANX,{pos:[10,8],mods:wave.mods});
  close(scheduled.base.def,data.enemies[PHALANX].stats.def*factor,'a wave enemy keeps its scaled DEF');
  const child=battle.spawnEnemy(PHALANX,{pos:[11,8],mods:{...scheduled.mods}});
  close(child.base.def,scheduled.base.def,'a child copying its parent\'s mods is not scaled again');
  assert.equal(battle.errorCount,0);
});

test('flat DEF an enemy gains from its own auras and states follows the multiplier; operator DEF reductions do not',()=>{
  const {battle}=battleAt('NORMAL');
  const foe=battle.spawnEnemy(PHANTOM,{pos:[10,9]}),base=foe.base.def;
  battle.addBuff(foe,{key:'test:aura',mods:{defFlat:200},duration:10});
  close(foe.s.def,base+200*0.35,'+200 aura DEF counts as +70 at ×0.35');
  battle.addBuff(foe,{key:'test:shred',mods:{defFlat:-100},duration:10});
  close(foe.s.def,base+200*0.35-100,'a −100 DEF reduction keeps its full value');
  const abyss=battleAt('ABYSS').battle;
  const native=abyss.spawnEnemy(PHANTOM,{pos:[10,9]});
  abyss.addBuff(native,{key:'test:aura',mods:{defFlat:200},duration:10});
  close(native.s.def,data.enemies[PHANTOM].stats.def+200,'abyss keeps native DEF and native auras');
});

test('a NORMAL 深池方阵步兵 formation stacks its DEF aura at the node multiplier in a real wave',()=>{
  // seed 23, node 10: five 深池方阵步兵 enter together from 14 s; each nearby one adds +200 DEF (native)
  const {battle,prepared}=battleAt('NORMAL');
  assert.ok(prepared.wave.spawns.some(spawn=>spawn.enemyKey===PHALANX));
  while(battle.time<24&&!battle.finished)battle.step();
  const phalanx=battle.enemies.filter(enemy=>enemy.alive&&enemy.defId===PHALANX);
  assert.ok(phalanx.length>=2,`phalanx on the field: ${phalanx.length}`);
  let stacked=0;
  for(const enemy of phalanx){
    const neighbours=(enemy.s.def/0.35-data.enemies[PHALANX].stats.def)/200;
    assert.ok(Math.abs(neighbours-Math.round(neighbours))<1e-6&&neighbours>=0,`DEF ${enemy.s.def} is (300 + 200k) × 0.35`);
    if(Math.round(neighbours)>0)stacked++;
  }
  assert.ok(stacked>0,'the aura is active on at least one');
  assert.equal(battle.errorCount,0);
});

const statsOf=enemy=>({maxHp:enemy.base.maxHp,atk:enemy.base.atk,def:enemy.base.def});
const natives=key=>({maxHp:data.enemies[key].stats.maxHp,atk:data.enemies[key].stats.atk,def:data.enemies[key].stats.def});

test('an enemy spawned in the fight takes the same HP, ATK and DEF multipliers as a wave enemy of its kind',()=>{
  // node 10 sits on each difficulty's node curve: NORMAL ×1.0667 and HARD ×1.15 on HP and ATK, FUNNY still flat
  for(const [difficulty,hp,atk,def] of [['NORMAL',0.6934,0.9067,0.35],['HARD',1.035,1.15,0.65],['FUNNY',0.55,0.75,0.3]]){
    const {battle,prepared}=battleAt(difficulty);
    assert.deepEqual([prepared.enemyBalance.hpMultiplier,prepared.enemyBalance.atkMultiplier,prepared.enemyBalance.defMultiplier],[hp,atk,def],difficulty);
    const wave=prepared.wave.spawns.find(spawn=>data.enemies[spawn.enemyKey]&&spawn.mods);
    const scheduled=battle.spawnEnemy(wave.enemyKey,{pos:[10,8],mods:wave.mods});
    const summoned=battle.spawnEnemy(wave.enemyKey,{pos:[10,9]});
    const native=natives(wave.enemyKey);
    close(summoned.base.maxHp,native.maxHp*hp,`${difficulty} summon HP`);
    close(summoned.base.atk,native.atk*atk,`${difficulty} summon ATK`);
    close(summoned.base.def,native.def*def,`${difficulty} summon DEF`);
    // the wave enemy carries the same node factors in the mods its own summons inherit
    assert.deepEqual([scheduled.mods.resonanceHpMul,scheduled.mods.resonanceAtkMul??1,scheduled.mods.resonanceDefMul],[hp,atk,def],`${difficulty} wave mods`);
    assert.deepEqual([summoned.mods.resonanceHpMul,summoned.mods.resonanceAtkMul??1,summoned.mods.resonanceDefMul],[hp,atk,def],`${difficulty} summon mods`);
    assert.equal(summoned.hp,summoned.s.maxHp,`${difficulty} a summon starts at full scaled HP`);
    assert.equal(battle.errorCount,0);
  }
});

test('a summon chain is scaled once however long it is, and a summon with its own modifiers keeps them',()=>{
  const {battle,prepared}=battleAt('NORMAL');
  const wave=prepared.wave.spawns.find(spawn=>spawn.enemyKey===PHALANX);
  const scheduled=battle.spawnEnemy(PHALANX,{pos:[10,8],mods:wave.mods});
  const fresh=battle.spawnEnemy(PHANTOM,{pos:[10,9]});
  let parent=scheduled;
  for(let link=1;link<=3;link++){
    const [child]=spawnChildren(battle,parent,PHANTOM,1);
    assert.ok(child,`link ${link} spawned`);
    for(const stat of ['maxHp','atk','def'])close(child.base[stat],link===1?natives(PHANTOM)[stat]*wave.mods[{maxHp:'hpMul',atk:'atkMul',def:'defMul'}[stat]]:parent.base[stat],`link ${link} ${stat}`);
    assert.equal(child.mods.resonanceHpMul,prepared.enemyBalance.hpMultiplier);
    parent=child;
  }
  // an unrelated summon with no wave mods is the plain node factor, not the wave enemy's per-kind rolls
  // (NORMAL node 10: HP 0.6934, ATK 0.9067 on the node curve, DEF 0.35)
  const {hpMultiplier:hp,atkMultiplier:atk}=prepared.enemyBalance;
  assert.deepEqual([hp,atk],[0.6934,0.9067]);
  assert.deepEqual(statsOf(fresh),{maxHp:natives(PHANTOM).maxHp*hp,atk:natives(PHANTOM).atk*atk,def:natives(PHANTOM).def*0.35});
  const own=battle.spawnEnemy(PHANTOM,{pos:[10,9],mods:{hpMul:0.5}});
  close(own.base.maxHp,natives(PHANTOM).maxHp*0.5*hp,'its own ×0.5 stays, the node factor goes on top');
  assert.equal(own.mods.hpMul,0.5*hp);
  assert.equal(battle.errorCount,0);
});

test('ABYSS before its node curve rises keeps native HP and ATK for summons, and a boss on the shared pool keeps the pool HP',()=>{
  const abyss=battleAt('ABYSS',23,4).battle;
  const native=abyss.spawnEnemy(PHANTOM,{pos:[10,9]});
  assert.deepEqual(statsOf(native),natives(PHANTOM));
  assert.equal(native.mods,null);
  const {battle,prepared}=battleAt('NORMAL',23,28);
  assert.equal(prepared.nodeKind,'boss');
  assert.equal(prepared.enemyBalance.hpMultiplier,0.75);
  while(!battle.enemies.some(enemy=>enemy.bossPool)&&battle.time<10)battle.step();
  const boss=battle.enemies.find(enemy=>enemy.bossPool);
  assert.ok(boss,'the leader is on the shared pool');
  assert.equal(boss.base.maxHp,boss.bossPool.maxHp);
  assert.equal(boss.hp,boss.s.maxHp);
  const summon=battle.spawnEnemy(PHANTOM,{pos:[10,9]});
  close(summon.base.maxHp,natives(PHANTOM).maxHp*0.75,'a leader-node summon takes the leader profile HP');
  close(summon.base.atk,natives(PHANTOM).atk*0.85,'and ATK');
  assert.equal(battle.errorCount,0);
});
