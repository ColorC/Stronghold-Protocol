import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../../server/data.js';
import {getResonanceCatalog} from '../../server/modes/resonance/catalog.js';
import {buildResonanceBattle} from '../../server/modes/resonance/battle.js';
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
