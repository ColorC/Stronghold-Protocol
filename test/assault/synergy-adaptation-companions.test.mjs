import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime, FLYER } from '../helpers/synergyCard.js';
import { flatStage } from '../helpers/battleHarness.js';
import { Grid } from '../../server/sim/grid.js';
import { COMPANION_ADAPTATIONS } from '../../shared/assault/companion-adaptations.js';
import { COMPANION_TOKENS as ID } from '../../server/sim/content/assault/cards/adaptation-companions.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';
import { summonTemplateOptions } from '../../public/js/assault/model.js';

function setup(id,positions=[],extras=[]){const stage=flatStage(),key=id.split('_').at(-1),ground=id==='char_1034_jesca2';
  const h=synergyBattle([{charId:id,row:10,col:ground?3:2,piece:{summonPresets:positions.map(([row,col,dir='RIGHT'])=>({tokenId:ID[key],row,col,dir}))}},...extras],
    {quiet:true,beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);}});
  for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}
  h.tokens=()=>h.battle.allyUnits.filter(t=>t.ownerUnit===h.units[0]&&t.kind==='token'&&t.alive&&t.deployed);return h;
}
const foe=(h,pos,key)=>h.spawn(pos,{...(key?{key}:{}),mods:{hpMul:10000,speedMul:0}});
function seen(h,u){const hits=[];h.battle.on('hit',p=>{if(!u||p.source===u)hits.push(p);},{priority:-100});return hits;}
const ok=h=>assert.deepEqual(h.battle.errors,[]);
test('the final seven signatures retain original skills, targets and visible manual coordinates',()=>{
  for(const[id,plan]of Object.entries(COMPANION_ADAPTATIONS)){const b=runtime.bodies[id];assert.equal(b.source.skills[2].skillId,b.fixedSkill.sourceSkillId);
    assert.ok(b.adaptation.lines.every(l=>[...l].length<=32),`${id}: ${b.adaptation.lines}`);assert.equal(summonTemplateOptions({runtime},{charId:id})[0].max,plan.manualSummons[0].max);}
});
test('Rosmontis summons exactly two manual gears, keeps native stun, block, DEF reduction, two-target attacks and delayed aftershocks',()=>{
  const h=setup('char_391_rosmon',[[10,4],[11,4]]),[u]=h.units,a=foe(h,[10,4]),c=foe(h,[11,4]),hits=seen(h,u);
  h.castNow(u);assert.equal(h.tokens().length,2);assert.deepEqual(h.tokens().map(t=>[t.tileR,t.tileC]),[[10,4],[11,4]]);assert.ok(a.s.flags.stun);assert.ok(c.s.flags.stun);
  assert.equal(hits.filter(p=>p.dmg.isAttack).length,12);h.run(.2);assert.ok(a.blockedBy);assert.ok(c.blockedBy);h.castNow(u);assert.equal(hits.filter(p=>p.dmg.isAttack).length,24);
  const before=hits.length;h.run(.5);assert.ok(hits.length>before);assert.equal(a.findBuff('token:rosmonGear').mods.defFlat,-160);assert.ok(u.findBuff('rosmon:pierce'));ok(h);
});
test('Rosmontis native deployment talent really shares attack with a caster, and gear lifetime remains 25 seconds',()=>{
  const h=setup('char_391_rosmon',[[10,4],[11,4]],[{charId:'char_213_mostma',row:11,col:2}]),[u,a]=h.units;h.run(.2);
  assert.ok(u.findBuff('rosmon:stable'));assert.ok(a.findBuff('rosmon:stable'));h.castNow(u);h.run(25.2);assert.equal(h.tokens().length,0);ok(h);
});
test('Wisadel retains six battle casts, three manual shadows, ground-only aftershock and a snapshotted original attack state',()=>{
  const h=setup('char_1035_wisdel',[[10,3],[10,4],[11,3]]),[u]=h.units,e=foe(h,[10,5]),air=foe(h,[11,5],FLYER),hits=seen(h,u);
  assert.equal(h.tokens().length,1);h.castNow(u);assert.equal(h.tokens().length,3);assert.equal(assaultAmmoState(u).current,5);assert.equal(u.skill.active,false);
  const main=hits.find(p=>p.target===e&&p.dmg.isAttack);assert.ok(main);assert.ok(hits.some(p=>p.target===air));h.run(.4);
  const shock=hits.find(p=>p.target===e&&p.dmg.tags?.includes('aftershock'));assert.ok(shock);assert.ok(Math.abs(shock.dmg.amount/main.dmg.amount-.5)<1e-6);
  assert.equal(hits.some(p=>p.target===air&&p.dmg.tags?.includes('aftershock')),false);assert.ok(e.s.flags.stun);ok(h);
});
test('Wisadel shadows use actual five-SP casts, mark unmarked targets, grant cross camouflage, and survive her exit',()=>{
  const h=setup('char_1035_wisdel',[[10,3],[10,4],[11,3]]),[u]=h.units,e=foe(h,[10,5]),shadow=h.tokens()[0],hits=seen(h,shadow);
  assert.equal(u.s.flags.camou,true);h.run(5.2);assert.ok(hits.length>0);assert.ok(e.findBuff(`wisdel:mark:${u.id}`));assert.equal(shadow.profile.noAttack,true);
  h.battle.retreat(u,{reason:'test-owner-exit',permanent:true});h.flush();assert.equal(shadow.alive,true);assert.equal(h.tokens().length,1);ok(h);
});
test('Ray refills and spends her original ordinary magazine, retains 120% hunter scale, binds and three target-focus layers',()=>{
  const h=setup('char_4117_ray',[[10,4]]),[u]=h.units,e=foe(h,[10,5]),hits=seen(h,u);u.trait.ammo=0;h.castNow(u);
  assert.equal(u.trait.ammo,2);assert.equal(hits.filter(p=>p.dmg.isAttack).length,6);assert.ok(e.s.flags.bind);assert.equal(u.mem.rayStacks,3);assert.equal(u.mem.rayTrance,e);
  h.castNow(u);assert.equal(u.trait.ammo,2);assert.equal(hits.filter(p=>p.dmg.isAttack).length,12);assert.ok(u.mem.rayArea.has(10*21+5));ok(h);
});
test('Ray native ordinary reload still takes the base attack interval and the real sandbeast leaves at 25 seconds then returns after 30 for 3 DP',()=>{
  const h=setup('char_4117_ray',[[10,4]]),[u]=h.units,t=h.tokens()[0];u.profile.noAttack=false;u.trait.ammo=0;u.atkCd=0;
  h.run(1.3);assert.equal(u.trait.ammo,0);h.run(.6);assert.equal(u.trait.ammo,1);u.profile.noAttack=true;
  h.run(23.3);assert.equal(t.alive,false);assert.equal(u.mem.rayArea,null);h.battle.getPlayer(u.ownerId).dp=100;
  h.run(29);assert.equal(t.alive,false);const payments=[];h.battle.on('deploy',p=>{if(p.unit===t)payments.push(p.actualPaid);});h.run(1.3);
  assert.equal(t.alive,true);assert.deepEqual(payments,[3]);assert.equal(t.tileC,4);ok(h);
});
test('Dusk original splash and unblocked preference retain one manually specified dragon whose 25-second life refreshes',()=>{
  const h=setup('char_2015_dusk',[[10,4]]),[u]=h.units,e=foe(h,[10,5]),near=foe(h,[11,5]),hits=seen(h,u);
  h.castNow(u);assert.equal(h.tokens().length,1);const dragon=h.tokens()[0];assert.deepEqual([dragon.tileR,dragon.tileC],[10,4]);assert.equal(dragon.s.blockCnt,2);assert.equal(dragon.profile.noAttack,false);
  assert.equal(hits.filter(p=>p.dmg.isAttack).length,6);assert.ok(near.hp<near.s.maxHp);h.run(20);h.castNow(u);assert.equal(h.tokens()[0],dragon);
  h.run(6);assert.equal(dragon.alive,true);h.run(19.2);assert.equal(dragon.alive,false);assert.ok(e.hp<e.s.maxHp);ok(h);
});

test('Dusk casts at the exact chosen outer skill-range tile while her ordinary range remains unchanged',()=>{
  const h=setup('char_2015_dusk',[[10,5]]),[u]=h.units;
  assert.equal(u.rangeKeySet.has(10*21+5),false);foe(h,[10,4]);assert.equal(h.castNow(u),true);
  assert.deepEqual(h.tokens().map(t=>[t.tileR,t.tileC]),[[10,5]]);
  assert.equal(u.rangeKeySet.has(10*21+5),false);ok(h);
  const invalid=setup('char_2015_dusk',[[10,6]]);invalid.castNow(invalid.units[0]);
  assert.equal(invalid.tokens().length,0,'a tile outside the original skill range is never substituted');ok(invalid);
});

test('Dusk can summon a fresh entity on the same manual tile after the previous twenty-five-second life expires',()=>{
  const h=setup('char_2015_dusk',[[10,4]]),[u]=h.units;h.castNow(u);const first=h.tokens()[0];
  assert.ok(first);h.run(25.1);assert.equal(first.alive,false);assert.equal(h.castNow(u),true);
  assert.equal(h.tokens().length,1);assert.notEqual(h.tokens()[0],first);assert.equal(h.tokens()[0].tileC,4);ok(h);
});
test('Dusk keeps first-attack point placement and native kill growth from her actual dragon',()=>{
  const h=setup('char_2015_dusk',[[10,4]]),[u]=h.units,e=foe(h,[10,5]);h.battle.forceAttack(u,[e]);h.flush();assert.equal(h.tokens().length,1);
  const t=h.tokens()[0];h.battle.dealDamage(t,e,{amount:e.hp*2,type:'true'});h.flush();assert.equal(u.findBuff('dusk:realm').stacks,1);ok(h);
});
test('Skadi tide overlaps really hit twice, repeated inspire stores twelve uses, and the life drain never kills her',()=>{
  const h=setup('char_1012_skadi2',[[11,3]],[{charId:'char_373_lionhd',row:10,col:3}]),[u,a]=h.units,e=foe(h,[10,4]),hits=seen(h,u);u.hp=2;
  h.castNow(u);assert.equal(hits.filter(p=>p.target===e).length,12);assert.equal(u.hp,1);assert.equal(a.mem.adaptAttackUses.inspire.length,6);
  h.castNow(u);assert.equal(a.mem.adaptAttackUses.inspire.length,12);assert.equal(u.mem.adaptAttackUses?.inspire,undefined);assert.equal(u.mem.noInspire,true);ok(h);
});
test('Skadi inspire is a flat final attack grant per real attack, with no duplicate native regeneration in an overlapping sea area',()=>{
  const h=setup('char_1012_skadi2',[[11,3]],[{charId:'char_373_lionhd',row:10,col:3}]),[u,a]=h.units,e=foe(h,[10,4]);e.base.def=0;e.markDirty();
  h.castNow(u);const before=e.hp;h.battle.forceAttack(a,[e]);h.flush();assert.equal(a.mem.adaptAttackUses.inspire.length,5);h.run(.5);assert.ok(before-e.hp>a.s.atk);
  a.hp=a.s.maxHp*.5;h.run(.6);const regen=a.buffs.filter(b=>b.key.startsWith('trait:bard'));assert.equal(regen.length,1);ok(h);
});
test('Mon3tr requires a real reconstruct, moves to its exact manual tile, attacks three targets, chain-heals and returns clearing SP',()=>{
  const empty=setup('char_4179_monstr');assert.equal(empty.castNow(empty.units[0]),false);ok(empty);
  const h=setup('char_4179_monstr',[[10,4]],[{charId:'char_373_lionhd',row:11,col:4}]),[u,a]=h.units,es=[foe(h,[10,5]),foe(h,[11,5]),foe(h,[9,5])],hits=seen(h,u),moves=[];
  a.hp=1;u.hp=u.s.maxHp*.5;h.battle.on('deploy',p=>{if(p.unit===u&&p.move)moves.push([u.tileR,u.tileC]);});assert.equal(h.castNow(u),true);
  assert.deepEqual(moves,[[10,4],[10,2]]);assert.equal(hits.filter(p=>p.dmg.isAttack).length,18);assert.ok(a.hp>1);assert.equal(u.skill.sp,0);assert.equal(u.skill.charges,0);
  assert.ok(u.mem.mUndeadUntil>h.battle.time);assert.ok(a.mem.adaptAttackUses['tactical-synergy'].length>0);assert.equal(h.tokens().length,0);assert.ok(es.every(e=>e.hp<e.s.maxHp));ok(h);
});
test('Mon3tr reconstruct keeps no block, only-owner healing, 80-per-second bleed after one second and native paid 15-second return',()=>{
  const h=setup('char_4179_monstr',[[10,4]],[{charId:'char_373_lionhd',row:11,col:4}]),[u,a]=h.units,t=h.tokens()[0],hp=t.hp;
  h.run(.9);assert.equal(t.hp,hp);h.run(.3);assert.ok(t.hp<hp);assert.equal(t.s.flags.noBlock,true);assert.equal(h.battle.heal(a,t,100),0);
  assert.ok(h.battle.heal(u,t,100,{ignoreHealFree:true})>0);h.battle.retreat(t,{reason:'test',permanent:true});h.flush();h.battle.getPlayer(u.ownerId).dp=100;
  const paid=[];h.battle.on('deploy',p=>{if(p.unit===t)paid.push(p.actualPaid);});
  h.run(14);assert.equal(t.alive,false);h.run(1.2);assert.equal(t.alive,true);assert.equal(t.tileC,4);assert.deepEqual(paid,[3]);ok(h);
});
test('Jessica shield turns her and protects the unit behind, while a real cast fires a native travelling shell with one cast ammunition',()=>{
  const h=setup('char_1034_jesca2',[[11,3]],[{charId:'char_373_lionhd',row:9,col:3}]),[u,a]=h.units,e=foe(h,[12,3]),hits=seen(h,u),t=h.tokens()[0];
  assert.equal(u.dir,'UP');assert.equal(t.dir,'UP');h.run(.3);assert.ok(a.findBuff('talent:jesca2:def'));h.castNow(u);assert.equal(assaultAmmoState(u).current,19);
  assert.equal(u.mem.jescaShells.length,1);const shell=u.mem.jescaShells[0];assert.ok(Math.abs(shell.atk/u.s.atk-4.1)<1e-6);assert.equal(shell.radius,1.7);assert.equal(shell.stun,6);
  h.run(.6);assert.equal(u.mem.jescaShells.length,0);assert.ok(e.s.flags.stun);assert.ok(hits.some(p=>p.dmg.tags?.includes('jesca2:bomb')));ok(h);
});
test('Jessica repeats store guard uses without multiplying defence, real shield damage charges her, and its 50-second departure restores facing',()=>{
  const h=setup('char_1034_jesca2',[[11,3]]),[u]=h.units,t=h.tokens()[0],e=foe(h,[12,3]);h.castNow(u);const guard=u.s.def;h.castNow(u);
  assert.equal(u.s.def,guard);assert.equal(u.mem.adaptHitUses['saturation-guard'].length,8);assert.equal(t.mem.adaptHitUses['saturation-shield'].length,8);h.hold(u);
  h.battle.dealDamage(e,t,{amount:10,type:'true',isAttack:true});h.battle.dealDamage(e,t,{amount:10,type:'true',isAttack:true});h.flush();assert.equal(h.spOf(u),4);
  h.run(50.1);assert.equal(t.alive,false);assert.equal(u.dir,'RIGHT');ok(h);
});
test('Jessica restored shield retains its five-DP price and its native entry fires another real shell from the original attack state',()=>{
  const h=setup('char_1034_jesca2',[[11,3]]),[u]=h.units,t=h.tokens()[0];foe(h,[12,3]);h.castNow(u);h.run(.7);
  h.battle.retreat(t,{reason:'test',permanent:true});h.flush();h.battle.getPlayer(u.ownerId).dp=100;const paid=[];
  h.battle.on('deploy',p=>{if(p.unit===t)paid.push(p.actualPaid);});h.run(30.1);assert.equal(t.alive,true);assert.deepEqual(paid,[5]);
  assert.ok(u.mem.jescaShells.length>0);assert.ok(Math.abs(u.mem.jescaShells[0].atk/u.s.atk-4.1)<1e-6);assert.equal(u.skill.active,false);ok(h);
});
test('Jessica shield HP loss does not create battery charges, while two actual damage instances do',()=>{
  const h=setup('char_1034_jesca2',[[11,3]]),[u]=h.units,t=h.tokens()[0];
  h.battle.loseHp(t,10,{source:t});h.battle.loseHp(t,10,{source:t});h.flush();assert.equal(h.spOf(u),0);
  h.battle.dealDamage(null,t,{amount:10,type:'true'});h.battle.dealDamage(null,t,{amount:10,type:'true'});h.flush();assert.equal(h.spOf(u),4);ok(h);
});
test('all seven manual companions refuse to invent a coordinate when the player specified none',()=>{
  for(const id of Object.keys(COMPANION_ADAPTATIONS)){const h=setup(id);h.castNow(h.units[0]);h.run(.3);assert.equal(h.tokens().length,0,id);ok(h);}
});
test('compressed splash still lands when its main target is killed by the first hit',()=>{
  const h=setup('char_2015_dusk',[[10,6]]),[u]=h.units,e=foe(h,[10,4]),near=foe(h,[11,4]);e.hp=1;const hits=seen(h,u);
  h.castNow(u);assert.equal(e.alive,false);assert.ok(hits.some(p=>p.target===near&&!p.dmg.isAttack));assert.ok(near.hp<near.s.maxHp);ok(h);
});
