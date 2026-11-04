import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadAssaultDesign,getAssaultData} from '../../server/modes/assault/data.js';
import {loadAssaultRuntime} from '../helpers/assaultRuntime.js';
import {synergyBattle} from '../helpers/synergyCard.js';
import {enemyDayScale} from '../../shared/assault/battle-input.js';
import {CHAPTER_KITS} from '../../server/sim/content/assault/chapter-enemies.js';
const runtime=loadAssaultRuntime(),data=getAssaultData({runtime}),encounters=loadAssaultDesign().encounters.encounters;
test('30 distinct chapter sets use actual native SPAWN rosters and introduce at least forty enemies',()=>{
 const sets=encounters.filter(e=>e.chapterSourceRef);assert.equal(sets.length,30);
 assert.equal(new Set(sets.map(e=>e.chapterSourceRef.file)).size,30);
 assert.ok(Object.values(runtime.auxiliaryEnemies).filter(e=>e.assaultChapter).length>=40);
 assert.ok(new Set(encounters.flatMap(e=>e.wave.spawns.map(s=>s.key))).size>=80);
 for(const e of sets){
  const level=JSON.parse(fs.readFileSync(e.chapterSourceRef.file,'utf8'));
  const native=new Set(level.waves.flatMap(w=>w.fragments.flatMap(f=>f.actions.filter(a=>a.actionType==='SPAWN').map(a=>a.key))));
  assert.ok(new Set(e.wave.spawns.map(s=>s.key)).size>=2);
  for(const spawn of e.wave.spawns){assert.ok(native.has(spawn.key));assert.ok(data.nativeData.enemies[spawn.key]);assert.ok(spawn.time>=8&&spawn.time<=90);}
 }
});
test('real HP budgets (native x C x the first day 1.2^k) increase across day bands, and risky sets carry at least their normal counterparts',()=>{
 let priorNormal=0,priorRisk=0;
 for(let band=1;band<=5;band++){
  const pool=encounters.filter(e=>e.kind!=='final'&&e.dayRange[0]===band*2-1);
  const hp=e=>e.wave.spawns.reduce((sum,s)=>sum+data.nativeData.enemies[s.key].stats.maxHp*s.count*e.wave.overrides[s.key].stats.maxHp*enemyDayScale(e.wave,e.dayRange[0]).hp,0);
  const normal=pool.filter(e=>e.kind==='normal').reduce((n,e)=>n+hp(e),0)/3;
  const risk=pool.filter(e=>e.kind==='risk').reduce((n,e)=>n+hp(e),0)/3;
  assert.ok(normal>priorNormal);assert.ok(risk>priorRisk);assert.ok(risk>=normal);
  priorNormal=normal;priorRisk=risk;
 }
});
for(const key of Object.keys(CHAPTER_KITS))test(`${key}: native special mechanics install without errors`,()=>{
 const h=synergyBattle([{charId:'char_150_snakek',row:9,col:3}]);
 const enemy=h.spawn([9,4],{key,mods:{hpMul:100,speedMul:0}});
 assert.ok(enemy.mem.ab?.list.length>0,'a special enemy must not silently become a stat-only unit');
 h.run(1);assert.deepEqual(h.battle.errors,[]);
});

test('chapter herald grants its native aura and the aura expires after its death',()=>{
 const h=synergyBattle([{charId:'char_150_snakek',row:9,col:3}]);h.units.forEach(h.hold);
 const herald=h.spawn([9,4],{key:'enemy_1080_sotidp',mods:{hpMul:100,speedMul:0}});
 const soldier=h.spawn([9,5],{key:'enemy_1083_sotiab',mods:{hpMul:100,speedMul:0}});
 h.run(.3);const aura=soldier.buffs.find(b=>b.key==='ab:chapter:herald');
 assert.ok(aura);assert.equal(aura.mods.atkPct,herald.mem.ab.t['strength.atk']+(soldier.def.talent['strength.atk']??0));
 assert.ok(soldier.s.atk>soldier.base.atk);
 h.battle.dealDamage(h.units[0],herald,{amount:1e9,type:'true'});h.flush();h.run(.6);
 assert.equal(soldier.buffs.some(b=>b.key==='ab:chapter:herald'),false);
 assert.deepEqual(h.battle.errors,[]);
});

test('chapter frost caster applies Cold through real automatic enemy attacks',()=>{
 const h=synergyBattle([{charId:'char_150_snakek',row:9,col:3}]);h.units.forEach(h.hold);
 const enemy=h.spawn([9,4],{key:'enemy_1068_snmage',mods:{hpMul:100,speedMul:0}});
 const cold=[];h.battle.on('statusApplied',p=>{if(p.source===enemy&&p.status==='cold')cold.push(p);});
 h.run(16);assert.ok(cold.length>0);assert.ok(cold.every(p=>p.target===h.units[0]));assert.deepEqual(h.battle.errors,[]);
});
