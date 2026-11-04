import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime } from '../helpers/synergyCard.js';
import { RANGED_ADAPTATIONS } from '../../shared/assault/ranged-adaptations.js';
import { applyStatus } from '../../server/sim/content/assault/primitives.js';
import { installCastAmmo, spendCastAmmo, fillCastAmmo } from '../../server/sim/content/assault/adaptation-primitives.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { Grid } from '../../server/sim/grid.js';
import { flatStage } from '../helpers/battleHarness.js';

function hold(h){for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}}
function hits(h,unit){const list=[];h.battle.on('hit',({source,target,dmg})=>{if(source===unit)list.push({target,type:dmg.type,skill:dmg.isSkill,amount:dmg.amount,mul:dmg.mul,tags:dmg.tags});},{priority:-100});return list;}
function reload(h,source,target){installCastAmmo(h.battle,target,2);spendCastAmmo(h.battle,target,'test-round');fillCastAmmo(h.battle,source,target,'test-refill');h.flush();}
function onFlat(entries){const stage=flatStage();return synergyBattle(entries,{beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);}});}

test('sixteen ranged adaptations retain their actual source slots, original target caps and sourced modules',()=>{
  for(const [id,plan]of Object.entries(RANGED_ADAPTATIONS)){
    const body=runtime.bodies[id];assert.ok(body.adaptation,id);
    assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId);
    assert.equal(body.adaptation.targetCount,plan.targetCount);assert.equal(body.modulePlans.length,2);
    assert.ok(body.adaptation.lines.every(l=>[...l].length<=32));
  }
});

test('格雷伊 preserves six splash rounds and eight actual sluggish applications feed adjacent casters',()=>{
  const h=synergyBattle([{charId:'char_253_greyy',row:10,col:3},{charId:'char_373_lionhd',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units,foes=[h.spawn([10,4]),h.spawn([10,4.5])],seen=hits(h,unit);
  h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,12);assert.ok(foes.every(e=>hasStatus(e,'sluggish')));
  h.run(.2);assert.equal(ally.skill.sp,4);assert.deepEqual(h.battle.errors,[]);
});

test('协律 first three distinct allied casters keep all rewards when cast in one tick',()=>{
  const h=onFlat([{charId:'char_4051_akkord',row:10,col:3},{charId:'char_373_lionhd',row:10,col:4},
    {charId:'char_4054_malist',row:10,col:5},{charId:'char_253_greyy',row:10,col:6}]);hold(h);
  const [unit,...allies]=h.units;h.spawn([10,7]);const bases=allies.map(u=>u.s.atk);
  for(const ally of allies)h.castNow(ally);h.run(.3);
  for(const [i,ally]of allies.entries())assert.ok(ally.s.atk>=bases[i]*1.15-1e-8,ally.charId);
  const seen=hits(h,unit);h.castNow(unit);assert.ok(seen.filter(x=>x.skill).length>=5);
  assert.deepEqual(h.battle.errors,[]);
});

test('深靛 retains bound-target damage and stores a guaranteed bind from three friendly binds',()=>{
  const h=synergyBattle([{charId:'char_469_indigo',row:10,col:3},{charId:'char_346_aosta',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units,foe=h.spawn([10,4]);h.battle.rng=()=>.99;
  for(let i=0;i<3;i++)applyStatus(h.battle,ally,foe,{status:'bind',duration:4});h.flush();
  assert.equal(unit.mem.adaptIndigoBind,1);const seen=hits(h,unit);h.castNow(unit);
  assert.equal(unit.mem.adaptIndigoBind,0);assert.ok(hasStatus(foe,'bind'));assert.ok(seen.filter(x=>x.skill).length>=5);
});

test('杰西卡 smoke stacks as discrete hits across recasts and actual reloads add a use',()=>{
  const h=synergyBattle([{charId:'char_235_jesica',row:10,col:3},{charId:'char_332_archet',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units,foe=h.spawn([10,4]);h.castNow(unit);h.castNow(unit);assert.equal(unit.mem.adaptSmoke,6);
  reload(h,unit,ally);reload(h,unit,ally);h.run(.2);assert.equal(unit.mem.adaptSmoke,7);
  h.battle.rng=()=>0;const before=unit.hp;h.battle.dealDamage(foe,unit,{amount:100,type:'phys',isAttack:true});
  assert.equal(unit.hp,before);assert.equal(unit.mem.adaptSmoke,6);
});

test('红云 preserves two targets and twelve rounds; two adjacent sniper casts return actual SP',()=>{
  const h=synergyBattle([{charId:'char_190_clour',row:10,col:3},{charId:'char_235_jesica',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units;for(let i=0;i<3;i++)h.spawn([10,4]);const seen=hits(h,unit);
  h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,24);h.castNow(ally);h.castNow(ally);
  assert.equal(ally.skill.sp,4);assert.ok(unit.s.spRecovery>0);
});

test('松果 preserves the shortened skill range, capped native cast growth and original sixty-second power supply',()=>{
  const h=synergyBattle([{charId:'char_440_pinecn',row:10,col:3}]);hold(h);const [unit]=h.units;
  h.spawn([10,4]);h.spawn([10,7]);const seen=hits(h,unit);h.castNow(unit);const first=seen[0].amount;
  for(let i=0;i<4;i++)h.castNow(unit);
  assert.equal(seen.length,25);assert.ok(seen.every(x=>x.target.tileC!==7));
  assert.ok(Math.abs(seen.at(-1).amount/first-2.2/1.6)<1e-8);
  assert.ok(unit.findBuff(`adaptation:${unit.uid}:portable-recovery`)||unit.buffs.some(b=>b.timeLeft===60&&b.mods.spRecoveryFlat===.45));
});

test('酸糖 retains her own native minimum damage against actual high defence',()=>{
  const h=synergyBattle([{charId:'char_366_acdrop',row:10,col:3},{charId:'char_498_inside',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units,foe=h.spawn([10,4]);foe.base.def=100000;foe.markDirty();
  const before=foe.hp;h.battle.dealDamage(ally,foe,{amount:ally.s.atk,type:'phys',isAttack:true});h.flush();
  assert.ok(before-foe.hp<ally.s.atk*.25-1e-6);
  const hp=foe.hp;h.castNow(unit);assert.ok(hp-foe.hp>=unit.s.atk*1.4*.4*12-1e-6);
});

test('跃跃 receives one complete guaranteed critical skill after three other sniper skills',()=>{
  const h=synergyBattle([{charId:'char_4100_caper',row:10,col:3},{charId:'char_235_jesica',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units;h.spawn([10,4]);h.battle.rng=()=>.99;
  for(let i=0;i<3;i++)h.castNow(ally);assert.equal(unit.mem.adaptCaperCritical,1);
  const seen=hits(h,unit);h.castNow(unit);assert.equal(seen.length,24);assert.equal(unit.mem.adaptCaperCritical,0);
  assert.ok(seen.every(x=>Math.abs(x.amount-unit.s.atk*1.6*1.5)<1e-8));
});

test('地灵 repeated casts each finish all four slow pulses and extend actual allied sluggish by 0.1s',()=>{
  const h=synergyBattle([{charId:'char_183_skgoat',row:10,col:3}]);hold(h);const [unit]=h.units,foe=h.spawn([10,4]);
  let pulses=0;h.battle.on('statusApplied',p=>{if(p.source===unit&&p.status==='sluggish')pulses++;});
  h.castNow(unit);h.castNow(unit);h.run(4.5);assert.equal(pulses,8);
  assert.ok(foe.findBuff('sluggish').timeLeft<=.9+1e-8);assert.deepEqual(h.battle.errors,[]);
});

test('地灵 original extension records a successful native slow, never an immune or rejected application',()=>{
 const h=synergyBattle([{charId:'char_183_skgoat',row:10,col:3}]);hold(h);const[u]=h.units,e=h.spawn([10,4]);
 const triggers=()=>h.battle.assaultLedger.snapshot().operators.find(x=>x.uid===u.uid).triggers;
 assert.equal(triggers(),0);applyStatus(h.battle,u,e,{status:'sluggish',duration:.8});h.flush();
 assert.ok(Math.abs(e.findBuff('sluggish').timeLeft-.9)<1e-9);assert.equal(triggers(),1);h.run(.2);
 const immune=h.spawn([10,5]);h.battle.addBuff(immune,{key:'test:immune',flags:{invulnerable:true,untargetable:true},duration:Infinity});
 assert.equal(applyStatus(h.battle,u,immune,{status:'sluggish',duration:.8}),false);h.flush();assert.equal(triggers(),1);assert.deepEqual(h.battle.errors,[]);
});

test('波登可 overlapping bottles each deliver all six independent ticks at their cast position',()=>{
  const h=synergyBattle([{charId:'char_258_podego',row:10,col:3}]);hold(h);const [unit]=h.units;
  const foe=h.spawn([10,4]),seen=hits(h,unit);h.castNow(unit);h.castNow(unit);h.run(5.2);
  assert.equal(seen.filter(x=>x.skill).length,12);assert.ok(foe.s.flags.silence);assert.ok(hasStatus(foe,'sluggish'));
});

test('波登可 retains the original support attack aura as a visible useful branch while the six allied slows still heal',()=>{
 const h=synergyBattle([{charId:'char_258_podego',row:10,col:3},{charId:'char_206_gnosis',row:10,col:2},{charId:'char_103_angel',row:9,col:2}]);hold(h);
 const[u,a,other]=h.units,e=h.spawn([10,4]),key=`assault:allyAura:${u.uid}:gardener`;
 assert.equal(u.findBuff(key)?.mods.atkPct,.09);
 assert.equal(a.findBuff(key)?.mods.atkPct,.09);assert.equal(other.findBuff(key),null);
 const count=()=>h.battle.assaultLedger.snapshot().operators.find(x=>x.uid===u.uid).triggers,opening=count();
 assert.ok(opening>0);h.run(.5);assert.equal(count(),opening,'aura refresh is not a new reward');a.hp-=1000;const hp=a.hp;
 for(let i=0;i<6;i++)applyStatus(h.battle,a,e,{status:'sluggish',duration:.5});h.flush();
 assert.ok(a.hp>hp);assert.equal(count(),opening+1);assert.deepEqual(h.battle.errors,[]);
});

test('奥斯塔 recasts each complete native doubled bleed independently and a third allied bind resolves blood damage',()=>{
  const h=synergyBattle([{charId:'char_346_aosta',row:10,col:3},{charId:'char_469_indigo',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units,foe=h.spawn([10,4]),seen=hits(h,unit);h.castNow(unit);h.castNow(unit);h.run(3.2);
  assert.equal(seen.filter(x=>x.skill).length,10);assert.equal(seen.filter(x=>x.type==='arts').length,6);
  const before=foe.hp;for(let i=0;i<3;i++)applyStatus(h.battle,ally,foe,{status:'bind',duration:2});h.flush();
  assert.ok(foe.hp<before);assert.deepEqual(h.battle.errors,[]);
});

test('惊蛰 keeps four-target chains and her original own unblocked-target damage',()=>{
  const h=synergyBattle([{charId:'char_306_leizi',row:10,col:3},{charId:'char_235_jesica',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units;const foes=[h.spawn([10,4]),h.spawn([10,5]),h.spawn([10,6]),h.spawn([10,7]),h.spawn([10,8])];
  const seen=hits(h,unit);h.castNow(unit);assert.equal(seen.filter(x=>x.skill).length,16);
  assert.equal(new Set(seen.map(x=>x.target)).size,4);
  const [foe]=foes;let hp=foe.hp;h.battle.dealDamage(unit,foe,{amount:100,type:'true'});assert.ok(Math.abs(hp-foe.hp-120)<1e-6);
  foe.blockedBy=ally;hp=foe.hp;h.battle.dealDamage(unit,foe,{amount:100,type:'true'});assert.ok(Math.abs(hp-foe.hp-100)<1e-6);
});

test('阿罗玛 preserves first-hit levitate, independent landing packets and every-third new enemy allied lift',()=>{
  const h=synergyBattle([{charId:'char_446_aroma',row:10,col:3},{charId:'char_235_jesica',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units,foe=h.spawn([10,4]),seen=hits(h,unit);h.castNow(unit);h.castNow(unit);
  assert.ok(hasStatus(foe,'levitate'));h.run(3);assert.equal(seen.filter(x=>x.skill).length,12);
  const fresh=Array.from({length:3},()=>h.spawn([11,5]));for(const e of fresh)h.battle.dealDamage(ally,e,{amount:10,type:'phys',isAttack:true});h.flush();
  assert.ok(hasStatus(fresh[2],'levitate'));
});

test('耶拉 retains two real funnel-tagged hits per round, ramping and counted cold; friendly cold adds haste seconds',()=>{
  const h=synergyBattle([{charId:'char_4013_kjera',row:10,col:3},{charId:'char_206_gnosis',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units,foe=h.spawn([10,4]),seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.filter(x=>x.tags?.includes('funnel')).length,12);assert.equal(seen.length,18);h.run(.4);
  assert.ok(hasStatus(foe,'cold')||hasStatus(foe,'frozen'));
  for(let i=0;i<6;i++)applyStatus(h.battle,ally,foe,{status:'cold',duration:4});h.flush();assert.ok(unit.findBuff('assault:haste:shared'));
});

test('洛洛 keeps the native overdrive funnel ramp and stun; reload advances capped actual battle growth',()=>{
  const h=synergyBattle([{charId:'char_4040_rockr',row:10,col:3},{charId:'char_332_archet',row:10,col:2}]);hold(h);
  const [unit,ally]=h.units;h.spawn([10,4]);const seen=hits(h,unit);h.castNow(unit);
  assert.equal(seen.length,34);const drones=seen.filter(x=>x.tags?.includes('funnel'));assert.ok(drones.at(-1).amount>drones[0].amount);
  assert.ok(hasStatus(unit,'stun'));const base=unit.s.atk;reload(h,unit,ally);h.run(.3);assert.ok(unit.s.atk>=base*1.04-1e-8);
  assert.deepEqual(h.battle.errors,[]);
});

test('洛洛 original on-field clock and reload share four genuine growth steps without timer-refresh or cap credits',()=>{
 const h=synergyBattle([{charId:'char_4040_rockr',row:10,col:3},{charId:'char_332_archet',row:10,col:2}]);hold(h);const[u,a]=h.units;
 h.battle.addBuff(u,{key:'test:isolate-clock',flags:{invulnerable:true},duration:Infinity});
 h.spawn([10,4],{mods:{hpMul:10000,speedMul:0}});
 const triggers=()=>h.battle.assaultLedger.snapshot().operators.find(x=>x.uid===u.uid).triggers;
 h.run(14.8);assert.equal(triggers(),0);h.run(.4);assert.equal(triggers(),1);
 assert.equal(u.findBuff(`adaptation:${u.uid}:standing-rock`).mods.atkPct,.04);
 reload(h,u,a);assert.equal(triggers(),2,'one reload growth records once');
 h.run(30);assert.equal(triggers(),4);const atk=u.s.atk;h.run(15);assert.equal(triggers(),4);
 reload(h,u,a);h.run(.3);assert.equal(triggers(),4,'full growth cap gives no new reward');assert.equal(u.s.atk,atk);assert.deepEqual(h.battle.errors,[]);
});

test('普罗旺斯 respects the eighty-percent target gate and native front critical chance',()=>{
  const h=synergyBattle([{charId:'char_145_prove',row:10,col:3}]);hold(h);const [unit]=h.units,foe=h.spawn([10,4]);
  assert.equal(h.castNow(unit),false);foe.hp=foe.s.maxHp*.8;h.battle.rng=()=>0;
  const seen=hits(h,unit);assert.equal(h.castNow(unit),true);assert.equal(seen.length,9);
  assert.ok(seen.every(x=>Math.abs(x.amount-unit.s.atk*3.2*1.8)<1e-8));
});
