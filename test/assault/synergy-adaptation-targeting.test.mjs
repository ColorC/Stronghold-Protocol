import test from 'node:test';
import assert from 'node:assert/strict';
import {synergyBattle,runtime} from '../helpers/synergyCard.js';
import {Grid} from '../../server/sim/grid.js';
import {flatStage} from '../helpers/battleHarness.js';
import {targets} from '../../server/sim/content/assault/cards/adaptation-core.js';
import {bodyInKeys} from '../../server/sim/body.js';
import {hasStatus} from '../../server/sim/content/assault/synergy.js';

function movingFixture(charId){const stage=flatStage(),h=synergyBattle([{charId,row:10,col:3}],{beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);}});
 for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}return h;}
function moved(h,initial,current){const e=h.spawn(initial,{mods:{hpMul:10000,speedMul:0}});[e.y,e.x]=current;h.battle._buildEnemyIndex();
 assert(initial[0]!==current[0]||initial[1]!==current[1]);return e;}

test('Estelle heals for a nearby enemy death at its current position, never its former spawn tile',()=>{
 const h=movingFixture('char_127_estell'),[u]=h.units,inside=moved(h,[12,9],[10,4]);
 inside.tileR=12;inside.tileC=9;u.hp-=500;const before=u.hp;h.battle.kill(inside,u);h.flush();assert.ok(u.hp>before);
 h.run(.2);const outside=moved(h,[10,4],[12,9]);outside.tileR=10;outside.tileC=4;u.hp-=500;const next=u.hp;
 h.battle.kill(outside,u);h.flush();assert.equal(u.hp,next);assert.deepEqual(h.battle.errors,[]);
});

test('Specter substitute damages and slows enemies at their current positions',()=>{
 const h=movingFixture('char_1023_ghost2'),[u]=h.units,inside=moved(h,[12,9],[10,4]),outside=moved(h,[10,4],[12,9]);
 inside.tileR=12;inside.tileC=9;outside.tileR=10;outside.tileC=4;
 h.battle.dealDamage(inside,u,{amount:u.s.maxHp*5,type:'true'});h.flush();assert.equal(u.form,'doll');h.run(2.2);
 assert.ok(inside.hp<inside.s.maxHp);assert.ok(inside.buffs.some(b=>b.mods?.moveMul===.6));assert.equal(outside.hp,outside.s.maxHp);
 assert.deepEqual(h.battle.errors,[]);
});

test('native contact blocking remains a legal skill target beyond the painted tiles, with the original target cap',()=>{
 const stage=flatStage();
 const h=synergyBattle([{charId:'char_356_broca',row:10,col:3,piece:{dir:'LEFT'}}],{beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.grid=new Grid(stage,b.rect);}});
 const [unit]=h.units;h.hold(unit);unit.profile.noAttack=true;
 const held=[];
 for(const offset of [.6,.62,.64]){
  const enemy=h.spawn([10,3+offset]);assert.equal(h.battle._checkBlock(enemy),true);held.push(enemy);
 }
 const unblocked=h.spawn([10,3.66]);assert.equal(h.battle._checkBlock(unblocked),false);
 const original=runtime.bodies.char_356_broca.adaptation.rangeGrid;
 assert(held.every(e=>!bodyInKeys(e,new Set(unit.rangeKeys))),'native contact extends into the neighbouring tile');
 assert.equal(h.battle.blockedTargets(unit,unit.profile).length,3);
 const selected=targets(h.battle,unit);
 assert.equal(selected.length,3);assert(held.every(e=>selected.includes(e)));
 const hp=held.map(e=>e.hp),outsideHp=unblocked.hp;
 assert.equal(h.castNow(unit),true);
 assert(held.every((e,i)=>e.hp<hp[i]));assert.equal(unblocked.hp,outsideHp);
 assert.deepEqual(runtime.bodies.char_356_broca.adaptation.rangeGrid,original);
 assert.deepEqual(h.battle.errors,[]);
});

test('an enemy blocked by another operator is not added outside this skill original range',()=>{
 const stage=flatStage();
 const h=synergyBattle([{charId:'char_356_broca',row:10,col:3,piece:{dir:'LEFT'}},{charId:'char_199_yak',row:10,col:6}],{beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.grid=new Grid(stage,b.rect);}});
 const [unit,other]=h.units;for(const u of h.units){h.hold(u);u.profile.noAttack=true;}
 const enemy=h.spawn([10,6.6]);assert.equal(h.battle._checkBlock(enemy),true);assert.equal(enemy.blockedBy,other);
 assert.equal(targets(h.battle,unit).includes(enemy),false);
});

test('Demetri searches current enemy positions and keeps native movement, six hits and return',()=>{
 const h=movingFixture('char_4037_demetr'),[u]=h.units,e=moved(h,[12,9],[10,5]);
 const hp=e.hp;assert.equal(h.castNow(u),true);assert(e.hp<hp);
 assert.deepEqual([u.tileR,u.tileC],[10,3]);assert.equal(u.skill.sp,0);
 assert.deepEqual(h.battle.errors,[]);
});

test('Swire coin cash-out hits a moved enemy in the original grid and ignores its former tile',()=>{
 const h=movingFixture('char_1033_swire2'),[u]=h.units,inside=moved(h,[12,9],[10,4]),outside=moved(h,[10,4],[12,9]);
 assert.equal(h.castNow(u),true);u.mem.adaptCoins=3;const hp=inside.hp,out=outside.hp;
 assert.equal(h.castNow(u),true);assert(inside.hp<hp);assert.equal(outside.hp,out);
 assert.deepEqual(h.battle.errors,[]);
});

test('Nearl deployment burst uses the current five-tile cross after enemies move',()=>{
 const h=movingFixture('char_1014_nearl2'),[u]=h.units,inside=moved(h,[12,9],[10,4]),outside=moved(h,[10,4],[12,9]);
 h.run(.2); // a later real deployment, outside the initial same-source instant
 const hp=inside.hp,out=outside.hp;assert.equal(h.battle.skillRedeploy(u),true);h.flush();
 assert(inside.hp<hp);assert(hasStatus(inside,'stun'));assert.equal(outside.hp,out);
 assert.deepEqual(h.battle.errors,[]);
});

test('Clementia erosion artillery centres on the current burst location and retains its exact cross',()=>{
 const h=movingFixture('char_4231_clemnt'),[u]=h.units,centre=moved(h,[12,9],[11,7]),cross=moved(h,[9,2],[11,8]),outside=moved(h,[11,8],[12,8]);
 h.battle.rng=()=>.99;u.base.atk=10;u.markDirty();const hp=cross.hp,out=outside.hp;
 h.battle.dealDamage(u,centre,{amount:centre.gaugeMax,type:'element',element:'erosion'});h.flush();
 assert(cross.hp<hp);assert.equal(outside.hp,out);assert.deepEqual(h.battle.errors,[]);
});
