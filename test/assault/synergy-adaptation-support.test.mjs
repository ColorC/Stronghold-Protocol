import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime } from '../helpers/synergyCard.js';
import { SUPPORT_ADAPTATIONS } from '../../shared/assault/support-adaptations.js';
import { applyStatus, heal } from '../../server/sim/content/assault/primitives.js';
import { grantAttackUses, grantHitUses } from '../../server/sim/content/assault/cards/adaptation-support.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';
import { Grid } from '../../server/sim/grid.js';
import { flatStage } from '../helpers/battleHarness.js';

function setup(entries){const stage=flatStage(),h=synergyBattle(entries,{beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);}});
  for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}return h;}
function wound(unit){unit.base.maxHp=1000000;unit.markDirty();void unit.s;unit.hp=1000;}
function healing(h,unit){const list=[];h.battle.on('heal',({source,target,amount,opts})=>{if(source===unit)list.push({target,amount,regen:opts?.regen});},{priority:-100});return list;}

test('two real Skadi casts use the strongest final-attack inspiration first and preserve all weaker uses',()=>{
  const h=setup([{charId:'char_1012_skadi2',row:10,col:2},{charId:'char_1012_skadi2',row:9,col:2},
    {charId:'char_199_yak',row:10,col:3}]),[weak,strong,ally]=h.units;
  weak.base.atk=100;strong.base.atk=200;weak.markDirty();strong.markDirty();
  const enemy=h.spawn([10,4]);enemy.base.def=0;enemy.markDirty();
  h.castNow(weak);h.castNow(strong);const queue=ally.mem.adaptAttackUses.inspire;
  assert.equal(queue.length,12);const low=queue[0].flat,high=queue[6].flat;assert.ok(high>low);
  h.battle.addBuff(ally,{key:'test:own-atk',mods:{atkPct:1},duration:Infinity});const attack=ally.s.atk;
  ally.profile.noAttack=false;const dealt=[];
  for(let i=0;i<7;i++){const hp=enemy.hp;h.battle.forceAttack(ally,[enemy]);h.flush();dealt.push(hp-enemy.hp);}
  for(const amount of dealt.slice(0,6))assert.ok(Math.abs(amount-attack-high)<1e-5);
  assert.ok(Math.abs(dealt[6]-attack-low)<1e-5);assert.equal(queue.length,5);
  assert.equal(weak.mem.adaptAttackUses?.inspire,undefined,'bards do not receive another bard inspiration');
  assert.deepEqual(h.battle.errors,[]);
});

test('two real Cetsyr casts choose strongest HP before weak HP and never consume both on the final strong hit',()=>{
  const h=setup([{charId:'char_4134_cetsyr',row:10,col:2},{charId:'char_4134_cetsyr',row:9,col:2},
    {charId:'char_199_yak',row:10,col:3}]),[weak,strong,ally]=h.units;
  weak.base.maxHp=3000;strong.base.maxHp=6000;weak.markDirty();strong.markDirty();
  h.battle.addBuff(ally,{key:'test:own-hp',mods:{hpPct:1},duration:Infinity});const base=ally.s.maxHp;
  h.castNow(weak);h.castNow(strong);const queue=ally.mem.adaptHitUses['cetsyr-inspire'];
  const low=queue[0].mods.hpFlat,high=queue[4].mods.hpFlat;assert.ok(high>low);
  assert.ok(Math.abs(ally.s.maxHp-base-high)<1e-5,'inspire is added after the target percentage');
  const enemy=h.spawn([10,4]);
  for(let i=0;i<4;i++){h.battle.dealDamage(enemy,ally,{amount:1,type:'true',isAttack:true});h.flush();}
  assert.equal(queue.length,4);assert.ok(queue.every(g=>g.source===weak));
  assert.ok(Math.abs(ally.s.maxHp-base-low)<1e-5);
  assert.equal(weak.mem.adaptHitUses?.['cetsyr-inspire'],undefined);assert.equal(weak.s.maxHp,3000);assert.equal(strong.s.maxHp,6000);
  assert.deepEqual(h.battle.errors,[]);
});

test('Heidi and Cetsyr share the highest HP inspiration while Heidi keeps independent final DEF and block',()=>{
  const h=setup([{charId:'char_4045_heidi',row:10,col:2},{charId:'char_4134_cetsyr',row:9,col:2},
    {charId:'char_199_yak',row:10,col:3}]),[heidi,cetsyr,ally]=h.units;
  h.run(.3);h.battle.addBuff(ally,{key:'test:own-stats',mods:{hpPct:1,defPct:1},duration:Infinity});
  const hp=ally.s.maxHp,def=ally.s.def,block=ally.s.blockCnt;
  h.castNow(heidi);h.castNow(cetsyr);
  const one=ally.mem.adaptHitUses['rust-city'][0],two=ally.mem.adaptHitUses['cetsyr-inspire'][0];
  assert.ok(Math.abs(ally.s.maxHp-hp-Math.max(one.mods.hpFlat,two.mods.hpFlat))<1e-5);
  assert.ok(Math.abs(ally.s.def-def-one.mods.defFlat)<1e-5);assert.equal(ally.s.blockCnt,block+1);
  const n=ally.mem.adaptHitUses['rust-city'].length,m=ally.mem.adaptHitUses['cetsyr-inspire'].length,enemy=h.spawn([10,4]);
  h.battle.dealDamage(enemy,ally,{amount:1,type:'true',isAttack:true});h.flush();
  assert.equal(ally.mem.adaptHitUses['rust-city'].length,n-1);assert.equal(ally.mem.adaptHitUses['cetsyr-inspire'].length,m-1);
  assert.deepEqual(h.battle.errors,[]);
});

test('sixteen support cards preserve source skill identity, target caps, two modules and concise text',()=>{
  for(const [id,plan]of Object.entries(SUPPORT_ADAPTATIONS)){
    const body=runtime.bodies[id];assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId,id);
    assert.equal(body.adaptation.targetCount,plan.targetCount);assert.equal(body.modulePlans.length,2);
    assert.ok(body.adaptation.lines.every(l=>[...l].length<=32));
  }
});

test('stacked attack grants follow one native attack id through delayed projectiles and expire by uses',()=>{
  const h=setup([{charId:'char_171_bldsk',row:10,col:3},{charId:'char_235_jesica',row:10,col:4}]);
  const [unit,ally]=h.units,foe=h.spawn([10,7]),seen=[];ally.profile.noAttack=false;
  h.battle.on('hit',({source,dmg})=>{if(source===ally)seen.push(dmg.mul);},{priority:-100});
  grantAttackUses(h.battle,unit,ally,'test-plasma',1,{atk:.9});grantAttackUses(h.battle,unit,ally,'test-plasma',1,{atk:.9});
  h.battle.forceAttack(ally,[foe]);h.battle.forceAttack(ally,[foe]);h.battle.forceAttack(ally,[foe]);h.flush();h.run(1.5);
  assert.equal(ally.mem.adaptAttackUses['test-plasma'].length,0);assert.ok(seen.filter(x=>x>1).length>=2);
  assert.ok(seen.some(x=>Math.abs(x-1)<1e-8));assert.deepEqual(h.battle.errors,[]);
});

test('stacked received-hit resources each consume once per real incoming attack',()=>{
  const h=setup([{charId:'char_4196_reckpr',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  wound(ally);const foe=h.spawn([10,5]);grantHitUses(h.battle,unit,ally,'test-care',2,{heal:150});
  let hp=ally.hp;h.battle.dealDamage(foe,ally,{amount:100,type:'true',isAttack:true});h.flush();assert.equal(ally.hp,hp+50);
  hp=ally.hp;h.battle.dealDamage(foe,ally,{amount:100,type:'true',isAttack:true});h.flush();assert.equal(ally.hp,hp+50);
  hp=ally.hp;h.battle.dealDamage(foe,ally,{amount:100,type:'true',isAttack:true});h.flush();assert.equal(ally.hp,hp-100);
});

test('桃金娘 preserves sixteen DP, six single-target surrounding heals and Vanguard regeneration',()=>{
  const h=setup([{charId:'char_151_myrtle',row:10,col:3},{charId:'char_102_texas',row:10,col:4}]);const [unit,ally]=h.units;
  wound(ally);h.battle.getPlayer(unit.ownerId).dp=0;const seen=healing(h,unit);h.castNow(unit);
  assert.equal(h.battle.getPlayer(unit.ownerId).dp,16);assert.equal(seen.filter(x=>!x.regen).length,6);
  const hp=ally.hp;h.run(1.1);assert.ok(ally.hp>=hp+25);
});

test('调香师 preserves three-target enhanced healing and native regeneration through heal prohibition',()=>{
  const h=setup([{charId:'char_181_flower',row:10,col:3},{charId:'char_199_yak',row:10,col:4},{charId:'char_150_snakek',row:9,col:4}]);
  const [unit,...allies]=h.units;for(const u of h.units)wound(u);const seen=healing(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>!x.regen).length,9);const target=allies[0];target.profile.noHeal=true;const hp=target.hp;
  h.run(1.1);assert.ok(target.hp>hp);assert.deepEqual(h.battle.errors,[]);
});

test('清流 resolves all sixteen random heals and gives the actual healed recipients native resistance',()=>{
  const h=setup([{charId:'char_385_finlpp',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  wound(ally);const seen=healing(h,unit);h.castNow(unit);assert.equal(seen.length,16);assert.ok(ally.findBuff('resist'));
});

test('极境 preserves four locks, defence reduction, reveal, DP and accumulating sniper attack-speed uses',()=>{
  const h=setup([{charId:'char_401_elysm',row:10,col:3},{charId:'char_235_jesica',row:10,col:4}]);const [unit,ally]=h.units;
  const foes=Array.from({length:5},()=>h.spawn([10,4]));const beforeDef=foes[0].s.def;h.battle.getPlayer(unit.ownerId).dp=0;h.castNow(unit);h.castNow(unit);
  assert.equal(h.battle.getPlayer(unit.ownerId).dp,40);assert.equal(foes.filter(e=>e.s.flags.reveal).length,4);
  assert.ok(Math.abs(foes[0].s.def-beforeDef*.65)<1e-8);assert.equal(ally.mem.adaptAttackUses['sniper-support'].length,8);
  assert.equal(ally.mem.assaultCostDelta,-2);assert.deepEqual(h.battle.errors,[]);
});

test('万顷 keeps original adjacent-eight healing, facing-dependent HP and stored same-facing attack speed',()=>{
  const h=setup([{charId:'char_4119_wanqin',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  wound(ally);const seen=healing(h,unit);h.castNow(unit);assert.equal(seen.filter(x=>x.target===ally).length,5);
  assert.equal(ally.mem.adaptAttackUses['east-wind'].length,4);assert.ok(ally.s.maxHp>=ally.base.maxHp*1.09-1e-6);
});

test('华法琳 grants stacking complete attacks, including her own healing; an original-range kill charges both recipients',()=>{
  const h=setup([{charId:'char_171_bldsk',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  wound(ally);h.castNow(unit);h.castNow(unit);assert.equal(unit.mem.adaptAttackUses['unstable-plasma'].length,6);
  assert.equal(ally.mem.adaptAttackUses['unstable-plasma'].length,6);const seen=healing(h,unit);unit.profile.noAttack=false;
  h.battle.forceAttack(unit,[ally]);h.flush();assert.ok(Math.abs(seen[0].amount/unit.s.atk-1.9)<1e-8);
  const foe=h.spawn([10,4]);h.hold(unit);h.battle.kill(foe,ally);h.flush();assert.equal(unit.skill.sp,4);assert.equal(ally.skill.sp,4);
});

test('录武官 preserves four enhanced heals, per-hit care stacks and an actual nearby skill feeding SP',()=>{
  const h=setup([{charId:'char_4196_reckpr',row:10,col:3},{charId:'char_199_yak',row:10,col:4},{charId:'char_373_lionhd',row:9,col:4}]);
  const [unit,ally,caster]=h.units;wound(ally);const seen=healing(h,unit);h.castNow(unit);
  assert.equal(seen.length,4);assert.equal(ally.mem.adaptHitUses['pressure-point'].length,8);h.spawn([9,5]);h.castNow(caster);
  assert.equal(unit.skill.sp,4);assert.equal(unit.mem.adaptAttackUses['learn-together'].length,2);
});

test('哈洛德 prioritises the highest native element gauge and applies real severe-patient protection',()=>{
  const h=setup([{charId:'char_4114_harold',row:10,col:3},{charId:'char_199_yak',row:10,col:4},{charId:'char_150_snakek',row:9,col:4}]);
  const [unit,one,two]=h.units;wound(one);wound(two);one.elem.burn=one.gaugeMax*.9;two.elem.burn=two.gaugeMax*.1;
  const seen=healing(h,unit);h.castNow(unit);assert.equal(seen[0].target,one);assert.ok(one.elem.burn<one.gaugeMax*.9);
  one.elem.burn=one.gaugeMax*.6;const foe=h.spawn([10,5]),before=one.elem.burn;
  h.battle.dealDamage(foe,one,{amount:100,type:'element',element:'burn'});assert.ok(one.elem.burn-before<=85+1e-6);
});

test('刺玫 preserves the highest-max-HP target and stored retaliations heal only that target',()=>{
  const h=setup([{charId:'char_494_vendla',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  wound(ally);h.castNow(unit);h.castNow(unit);assert.equal(ally.mem.adaptHitUses['thorn-cover'].length,8);
  const foe=h.spawn([10,5]),hp=foe.hp,seen=healing(h,unit);h.battle.dealDamage(foe,ally,{amount:100,type:'true',isAttack:true});h.flush();
  assert.ok(foe.hp<hp);assert.equal(seen[0].target,ally);assert.equal(ally.mem.adaptHitUses['thorn-cover'].length,7);
});

test('刺玫 counter preserves a legal allied summon recipient without rejecting its trait target',()=>{
  const h=setup([{charId:'char_494_vendla',row:10,col:3}]),[unit]=h.units;
  const ally=h.battle.spawnToken(unit,'token_10020_ling_soul2',10,4,{anySource:true});
  assert.ok(ally);wound(ally);ally.profile.noAttack=true;h.castNow(unit);
  assert.equal(ally.mem.adaptHitUses['thorn-cover'].length,4);
  const foe=h.spawn([10,5]),hp=foe.hp,seen=[];
  h.battle.on('damaged',c=>{if(c.source===unit)seen.push(c.dmg.traitAlly);});
  h.battle.dealDamage(foe,ally,{amount:100,type:'true',isAttack:true});h.flush();
  assert.ok(foe.hp<hp);assert.deepEqual(seen,[ally]);assert.deepEqual(h.battle.errors,[]);
});

test('莎草 retains four-recipient chained healing and native same-source barrier refresh',()=>{
  const h=setup([{charId:'char_4139_papyrs',row:10,col:3},{charId:'char_199_yak',row:10,col:4},
    {charId:'char_150_snakek',row:9,col:4},{charId:'char_381_bubble',row:9,col:3}]);const [unit,...allies]=h.units;
  for(const u of h.units)wound(u);allies[0].base.maxHp*=2;allies[0].markDirty();void allies[0].s;allies[0].hp=1000;
  const seen=healing(h,unit);h.castNow(unit);assert.equal(seen[0].target,allies[0]);assert.equal(seen.length,16);
  for(const u of h.units)assert.ok(u.buffs.some(b=>b.source===unit&&b.shield>0));assert.deepEqual(h.battle.errors,[]);
});

test('风絮 keeps the extra flying recipient and original two-recipient healing splash',()=>{
  const h=setup([{charId:'char_4222_taraxa',row:10,col:3},{charId:'char_199_yak',row:10,col:4},{charId:'char_150_snakek',row:9,col:4}]);
  const [unit,one,two]=h.units;wound(one);wound(two);h.battle.addBuff(two,{key:'native-flight',flags:{liftoff:true},duration:10});h.run(.3);
  assert.ok(two.s.dmgTakenMul<1);const seen=healing(h,unit);h.castNow(unit);assert.ok(seen.length>=9);assert.ok(unit.s.flags.liftoff);
});

test('流明 heals ordinary patients and prioritizes complete abnormal cleansing, spending one battle round per cast',()=>{
  const h=setup([{charId:'char_4042_lumen',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  assert.equal(h.castNow(unit),false);assert.equal(assaultAmmoState(unit).current,8);
  wound(ally);const ordinaryHP=ally.hp;assert.equal(h.castNow(unit),true);assert.ok(ally.hp>ordinaryHP);assert.equal(assaultAmmoState(unit).current,7);
  applyStatus(h.battle,ally,ally,{status:'stun',duration:4});applyStatus(h.battle,ally,ally,{status:'silence',duration:4});
  wound(ally);const hp=ally.hp;assert.equal(h.castNow(unit),true);assert.ok(ally.hp>hp);assert.equal(assaultAmmoState(unit).current,6);
  assert.ok(!ally.s.flags.stun&&!ally.s.flags.silence);assert.ok(ally.findBuff('resist'));
});

test('流明 ordinary-heal fallback keeps the abnormal branch and cannot count its own extra heal recursively',()=>{
  const h=setup([{charId:'char_4042_lumen',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  wound(ally);const before=ally.hp,emergency=unit.s.atk*.8;
  for(let i=0;i<3;i++){heal(h.battle,unit,ally,{amount:1});h.flush();}
  assert.ok(Math.abs(ally.hp-before-3-emergency)<1e-5);
  const counter=Object.values(h.battle.assaultRuntime.diagnostics.counters).find(x=>x.key.endsWith(':ordinary-emergency'));
  assert.equal(counter.counted,3);assert.equal(counter.emitted,1);
  assert.equal(assaultAmmoState(unit).current,8,'the native talent branch never spends a signature cast');
  applyStatus(h.battle,ally,ally,{status:'stun',duration:4});
  for(let i=0;i<3;i++){heal(h.battle,unit,ally,{amount:1});h.flush();}
  assert.equal(counter.counted,3,'controlled patients retain their original emergency branch');
  assert.deepEqual(h.battle.errors,[]);
});

test('纯烬艾雅法拉 keeps full-field five-shot rounds, actual elemental healing and independent capped ordinary-heal mists',()=>{
  const h=setup([{charId:'char_1016_agoat2',row:10,col:3},{charId:'char_199_yak',row:12,col:8}]);const [unit,ally]=h.units;
  wound(ally);ally.elem.burn=500;const seen=healing(h,unit);h.castNow(unit);assert.equal(seen.filter(x=>!x.regen).length,15);
  assert.ok(ally.elem.burn<500);assert.equal(ally.buffs.filter(b=>b.key.endsWith(':mist')).length,0,'skill is not an ordinary heal');
  for(let i=0;i<4;i++)heal(h.battle,unit,ally,{amount:10});assert.equal(ally.buffs.filter(b=>b.key.endsWith(':mist')).length,3);
  const hp=ally.hp;h.run(1.1);assert.ok(ally.hp>hp);assert.deepEqual(h.battle.errors,[]);
});

test('瑰盐 stacks deferred-hit uses and each consumed hit creates its own full five-second debt',()=>{
  const h=setup([{charId:'char_4163_rosesa',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  wound(ally);h.castNow(unit);h.castNow(unit);assert.equal(ally.mem.adaptHitUses['long-medicine'].length,4);
  const foe=h.spawn([10,5]);let immediate=0;h.battle.on('damaged',({target,amount,dmg})=>{if(target===ally&&!dmg.tags?.includes('adaptationDeferred'))immediate+=amount;});
  h.battle.dealDamage(foe,ally,{amount:1000,type:'arts',isAttack:true});h.flush();const hp=ally.hp;
  assert.ok(immediate>0&&immediate<1000);h.run(5.2);assert.ok(Math.abs(hp-ally.hp-immediate)<1e-5);
  assert.equal(ally.mem.adaptHitUses['long-medicine'].length,3);
});

test('海蒂 preserves DEF/HP inspiration and block+1, with extra casts adding uses rather than another stat stack',()=>{
  const h=setup([{charId:'char_4045_heidi',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  const def=ally.s.def,block=ally.s.blockCnt;h.castNow(unit);const enhanced=ally.s.def;h.castNow(unit);
  assert.equal(ally.s.def,enhanced);assert.ok(enhanced>def);assert.equal(ally.s.blockCnt,block+1);assert.equal(ally.mem.adaptHitUses['rust-city'].length,8);
});

test('九色鹿 keeps ranged-only physical resistance uses and her original low-HP protection aura',()=>{
  const h=setup([{charId:'char_4019_ncdeer',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]);const [unit,ally]=h.units;
  wound(ally);const foe=h.spawn([10,5]);h.run(.3);assert.ok(ally.s.dmgTakenMul<1);h.castNow(unit);assert.equal(unit.mem.adaptDeerDodge,3);
  h.battle.dealDamage(foe,unit,{amount:100,type:'phys',isAttack:true});assert.equal(unit.mem.adaptDeerDodge,3,'melee does not spend ranged resistance');
  foe.profile.attack='ranged';h.battle.rng=()=>0;const hp=unit.hp;h.battle.dealDamage(foe,unit,{amount:100,type:'phys',isAttack:true});
  assert.equal(unit.hp,hp);assert.equal(unit.mem.adaptDeerDodge,2);assert.deepEqual(h.battle.errors,[]);
});
