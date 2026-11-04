import test from 'node:test';
import assert from 'node:assert/strict';
import {synergyBattle,runtime} from '../helpers/synergyCard.js';
import {sp,haste} from '../../server/sim/content/assault/primitives.js';
import {spendCastAmmo} from '../../server/sim/content/assault/adaptation-primitives.js';
import {assaultAmmoState} from '../../server/sim/content/assault/ammo.js';
import {installLinkFeedback,runBattleFrame} from '../../public/js/assault/client-sim.js';
import {normalizeSnapshot,SnapshotBuffer} from '../../public/js/render/interp.js';
import {bazaarCard} from '../../public/js/assault/mechanicsView.js';
import {Grid} from '../../server/sim/grid.js';
import {flatStage} from '../helpers/battleHarness.js';

test('settled SP, haste and redeploy reductions become once-per-frame native feedback without changing their ledger',()=>{
  const h=synergyBattle([{charId:'char_172_svrash',row:10,col:3},{charId:'char_103_angel',row:10,col:2}]),[u,ally]=h.units;
  h.units.forEach(x=>{h.hold(x);x.profile.noAttack=true;});h.spawn([10,4]);installLinkFeedback(h.battle);
  sp(h.battle,u,ally,4,'test','test-a');sp(h.battle,u,ally,4,'test','test-b');
  haste(h.battle,u,ally,4,'test-a');haste(h.battle,u,ally,4,'test-b');h.castNow(u);
  const before=h.battle.assaultLedger.snapshot(),session={battle:h.battle,tick:h.battle.dt,maxSeconds:120,accumulator:0};
  const frame=runBattleFrame(session,0);
  assert.ok(frame.events.some(e=>e[0]==='assaultProc'&&e[1]===u.id));
  assert.deepEqual(frame.events.filter(e=>e[0]==='assaultGrant'&&e[1]===ally.id).map(e=>e.slice(2)).sort(),
    [['charge',8],['haste',8],['redeploy',12]]);
  assert.deepEqual(h.battle.assaultLedger.snapshot(),before,'feedback only reads actual outcomes');
  assert.equal(runBattleFrame(session,0).events.some(e=>e[0]==='assaultGrant'||e[0]==='assaultProc'),false);
  assert.deepEqual(h.battle.errors,[]);
});

test('empty battle-cast ammo stays visible beside an independent recovering SP bar, with actual haste expiry',()=>{
  const h=synergyBattle([{charId:'char_498_inside',row:10,col:3}]),[u]=h.units;h.hold(u);
  while(assaultAmmoState(u).current)spendCastAmmo(h.battle,u,'test-empty');
  sp(h.battle,u,u,5,'test','test');haste(h.battle,u,u,4,'test');h.flush();
  const frame=runBattleFrame({battle:h.battle,tick:h.battle.dt,maxSeconds:120,accumulator:0},0),snapshot=normalizeSnapshot(frame.snapshot);
  assert.equal(snapshot.units.get(u.id)[5],5,'the native SP readout is not replaced with an empty magazine');
  assert.equal(snapshot.ammo?.has(u.id)??false,false);
  assert.deepEqual(snapshot.assaultStatus.get(u.id),[0,assaultAmmoState(u).capacity,4,0,1]);
  assert.deepEqual(h.battle.errors,[]);
});

test('Assault status validation rejects impossible counts and interpolation clears expired rows instead of retaining a prior operator state',()=>{
  const unit=[1,2,3,100,100,5,10,0,0],valid=[1,0,6,4,1,2];
  const normalized=normalizeSnapshot({t:0,units:[unit],assaultStatus:[valid,[9,0,6,4,1,2],[1,7,6,4,1,2],[1,0,6,4,3,2]]});
  assert.deepEqual([...normalized.assaultStatus.entries()],[[1,valid.slice(1)]]);
  assert.equal(normalizeSnapshot({t:0,units:[unit],assaultStatus:{bad:true}}).assaultStatus,null);
  const buffer=new SnapshotBuffer();buffer.push({t:0,units:[unit],assaultStatus:[valid]},0);
  buffer.push({t:.1,units:[unit]},.1);
  const out=buffer.sample(0,new Map());assert.deepEqual(out.get(1).assaultStatus,valid.slice(1));
  buffer.sample(.1,out);assert.equal(out.get(1).assaultStatus,null);
});

test('the card storage badge uses native capacity and the chosen unlocked storage keyword at the same star as the real skill',()=>{
  const id='char_172_svrash',body=runtime.bodies[id],module=body.modulePlans[0];
  const catalog={runtime,publicText:{operators:{[id]:{card:{typeLabel:'测试',sp:[35,35,35,35],lines:[],modules:{}}}}}};
  for(const star of [1,3]){
    const h=synergyBattle([{charId:id,star,moduleId:module.id}]);
    const card=bazaarCard(catalog,{charId:id,star},module.id);
    assert.equal(card.charges,h.units[0].skill.maxCharges);
  }
});

test('the battle-ammo card badge includes the chosen unlocked capacity keyword rather than SP storage',()=>{
  const id='char_4194_rmixer',body=runtime.bodies[id],module=body.modulePlans[1];
  const catalog={runtime,publicText:{operators:{[id]:{card:{typeLabel:'测试',sp:[35,35,35,35],lines:[],modules:{}}}}}};
  for(const star of [1,3]){
    const h=synergyBattle([{charId:id,star,moduleId:module.id}]);
    assert.equal(bazaarCard(catalog,{charId:id,star},module.id).ammo,assaultAmmoState(h.units[0]).capacity);
  }
});

const quiet=h=>h.units.forEach(u=>{h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';});
const ledger=(h,u)=>h.battle.assaultLedger.snapshot().operators.find(row=>row.uid===u.uid);

function damageAuraFixture(id,extra=[]){
 const stage=flatStage(),wolf='token_10028_vigil_wolf';
 const h=synergyBattle([{charId:id,row:10,col:2,piece:id==='char_427_vigil'?{summonPresets:[{tokenId:wolf,row:10,col:4,dir:'RIGHT'}]}:{}},
  ...extra,{charId:'char_103_angel',row:10,col:3}],{beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);}});
 quiet(h);return h;
}
test('native conditional damage auras credit real landed benefits and their actual attackers, excluding immunity and penetration floors',()=>{
 for(const id of['char_4116_blkkgt','char_4027_heyak','char_427_vigil']){
  const h=damageAuraFixture(id),[u,a]=h.units,wolf=h.battle.allyUnits.find(t=>t.ownerUnit===u&&t.defId==='token_10028_vigil_wolf');
  const prepare=(def)=>{
   const e=h.spawn(wolf?[wolf.tileR,wolf.tileC]:[10,4],{mods:{hpMul:10000,speedMul:0}});e.base.def=def;e.markDirty();
   if(wolf){assert.equal(h.battle._checkBlock(e),true);assert.equal(e.blockedBy,wolf);}
   if(id==='char_4116_blkkgt')h.battle.applyStatus(e,'tremble',{duration:5,source:u});
   if(id==='char_4027_heyak')h.battle.applyStatus(e,'levitate',{duration:5,source:u});
   return e;
  };
  const e=prepare(500),events=[];h.battle.assaultRuntime.observe('triggerResolved','test:landed-aura',({payload})=>{if(payload.source===u)events.push(payload);});
  const before=ledger(h,u).triggers;assert.ok(h.battle.dealDamage(a,e,{amount:1000,type:'phys',isAttack:true,canDodge:false})>500);h.flush();
  assert.equal(ledger(h,u).triggers,before+1,id);assert.equal(events[0].target,a);assert.equal(events[0].aura,true);
  h.run(.2);h.battle.addBuff(e,{key:'test:no-damage',flags:{invulnerable:true},duration:Infinity});
  assert.equal(h.battle.dealDamage(a,e,{amount:1000,type:'phys',isAttack:true,canDodge:false}),0);h.flush();assert.equal(ledger(h,u).triggers,before+1);
  if(id!=='char_4027_heyak'){
   const floor=prepare(1000000);assert.equal(h.battle.dealDamage(a,floor,{amount:1000,type:'phys',isAttack:true,canDodge:false}),50);h.flush();
   assert.equal(ledger(h,u).triggers,before+1,'penetration that leaves native minimum damage unchanged is not a benefit');
  }
  assert.deepEqual(h.battle.errors,[]);
 }
});

test('only the strongest original legend modifier earns the landed benefit when another copy replaces it',()=>{
 const id='char_4116_blkkgt',moduleId=runtime.bodies[id].modulePlans[1].id;
 const h=damageAuraFixture(id,[{charId:id,row:9,col:2,moduleId}]),[weak,strong,a]=h.units,e=h.spawn([10,4],{mods:{hpMul:10000,speedMul:0}});
 e.base.def=500;e.markDirty();h.battle.applyStatus(e,'tremble',{duration:5,source:weak});
 const before=[ledger(h,weak).triggers,ledger(h,strong).triggers];h.battle.dealDamage(a,e,{amount:1000,type:'phys',isAttack:true,canDodge:false});h.flush();
 assert.equal(ledger(h,weak).triggers,before[0]);assert.equal(ledger(h,strong).triggers,before[1]+1);assert.deepEqual(h.battle.errors,[]);
});

test('a native talent aura records actual entry and re-entry, while repeated synchronization adds no triggers',()=>{
  const h=synergyBattle([{charId:'char_388_mint',row:10,col:2},{charId:'char_199_yak',row:10,col:3}]),[u,a]=h.units;quiet(h);h.run(.3);
  assert.ok(a.s.def>a.base.def);const count=ledger(h,u).triggers;assert.ok(count>0);h.run(2);assert.equal(ledger(h,u).triggers,count);
  a.deployed=false;h.run(.3);a.deployed=true;h.run(.3);assert.equal(ledger(h,u).triggers,count+1);assert.deepEqual(h.battle.errors,[]);
});

test('Dusk native kill stacks enter the actual ledger and idle clocks never manufacture triggers',()=>{
  const h=synergyBattle([{charId:'char_2015_dusk',row:10,col:2}]),[u]=h.units;quiet(h);
  for(let i=1;i<=2;i++){const e=h.spawn([10,4]);h.battle.dealDamage(u,e,{amount:e.hp*2,type:'true'});h.flush();
    assert.equal(u.findBuff('dusk:realm').stacks,i);assert.equal(ledger(h,u).triggers,i);h.run(.3);}
  h.run(2);assert.equal(ledger(h,u).triggers,2);assert.deepEqual(h.battle.errors,[]);
});

test('Flower and Myrtle record only positive regeneration, including multiple recipients in one same-source batch',()=>{
  const h=synergyBattle([{charId:'char_181_flower',row:10,col:2},{charId:'char_151_myrtle',row:10,col:3},{charId:'char_240_wyvern',row:11,col:3}]),[flower,myrtle,a]=h.units;quiet(h);
  a.hp-=1;myrtle.hp-=1;h.run(1.1);assert.equal(a.hp,a.s.maxHp);assert.equal(myrtle.hp,myrtle.s.maxHp);
  assert.ok(ledger(h,flower).triggers>0);const before=h.battle.assaultLedger.snapshot();h.run(3);
  assert.deepEqual(h.battle.assaultLedger.snapshot().operators.map(x=>x.triggers),before.operators.map(x=>x.triggers));
  a.hp-=1000;h.run(1);assert.ok(ledger(h,myrtle).triggers>0);assert.deepEqual(h.battle.errors,[]);
});

test('Papyrus records real new shield capacity and replenishment, not a full shield timer refresh',()=>{
  const h=synergyBattle([{charId:'char_4139_papyrs',row:10,col:2},{charId:'char_199_yak',row:10,col:3}]),[u,a]=h.units;quiet(h);a.hp-=1000;
  h.battle.heal(u,a,100);h.flush();const count=ledger(h,u).triggers;assert.ok(count>0);h.run(.2);
  h.battle.heal(u,a,100);h.flush();assert.equal(ledger(h,u).triggers,count);
  const e=h.spawn([10,4]);h.battle.dealDamage(e,a,{amount:100,type:'true'});h.run(.2);h.battle.heal(u,a,100);h.flush();
  assert.equal(ledger(h,u).triggers,count+1);assert.deepEqual(h.battle.errors,[]);
});

test('Reed native shared healing records actual recovered HP and ignores reflection into full HP',()=>{
  const h=synergyBattle([{charId:'char_1020_reed2',row:10,col:2},{charId:'char_199_yak',row:10,col:3}]),[u,a]=h.units;quiet(h);u.hp-=1000;a.hp-=1000;
  const hp=u.hp;h.battle.heal(u,a,100);h.flush();assert.ok(u.hp>hp);assert.equal(ledger(h,u).triggers,1);
  u.hp=u.s.maxHp;h.run(.2);h.battle.heal(u,a,100);h.flush();assert.equal(ledger(h,u).triggers,1);assert.deepEqual(h.battle.errors,[]);
});

test('Shu original profession conditions record actual seasonal buffs and keep periodic refreshes out of trigger counts',()=>{
  const h=synergyBattle([{charId:'char_2025_shu',row:10,col:3},{charId:'char_181_flower',row:10,col:2},{charId:'char_103_angel',row:11,col:2}]),[u,a]=h.units;quiet(h);h.run(.3);
  assert.ok(a.findBuff('talent:shu:seasons:hp'));const count=ledger(h,u).triggers;assert.ok(count>0);h.run(2);assert.equal(ledger(h,u).triggers,count);assert.deepEqual(h.battle.errors,[]);
});
