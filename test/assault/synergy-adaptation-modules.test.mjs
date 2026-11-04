import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime } from '../helpers/synergyCard.js';
import { valuesOf } from '../../server/sim/content/assault/cards/adaptation-core.js';
import { cycleLength } from '../../server/sim/content/assault/redeploy-cycle.js';
import { fillCastAmmo, spendCastAmmo } from '../../server/sim/content/assault/adaptation-primitives.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';
import { summonPlacementLegal } from '../../server/sim/content/assault/summons.js';
import { applyStatus } from '../../server/sim/content/assault/primitives.js';

test('all 172 cards offer two native-keyword upgrades, locked until three stars, including legacy saved choices', () => {
  for (const body of Object.values(runtime.bodies).filter(b => b.adaptation)) {
    assert.equal(body.modulePlans.length, 2, body.charId);
    for (const module of body.modulePlans) for (const star of [1, 3, 4]) {
      assert.ok(module.keyword,body.charId);
      const h = synergyBattle([{ charId: body.charId, star, moduleId: module.id }]), [unit] = h.units;
      const changed = Object.keys(valuesOf(unit)).filter(key => valuesOf(unit)[key] !== body.adaptation.values[key]);
      assert.deepEqual(changed, star < 3 ? [] : [module.adaptationUpgrade.key]);
      assert.deepEqual(h.battle.errors, [], `${body.charId} ${module.id} ${star}`);
    }
    for (const [oldId, newId] of Object.entries(body.adaptation.moduleAliases)) {
      const h = synergyBattle([{ charId: body.charId, star: 3, moduleId: oldId }]);
      const patch = body.modulePlans.find(m => m.id === newId).adaptationUpgrade;
      assert.equal(valuesOf(h.units[0])[patch.key], patch.value);
    }
  }
});

test('银灰 storage module really holds a second cast; the talent alternative cuts actual timers by sixteen seconds', () => {
  const probe = index => {
    const h = synergyBattle([{ charId: 'char_172_svrash', row: 9, col: 3,
      moduleId: index == null ? null : runtime.bodies.char_172_svrash.modulePlans[index].id },
    { charId: 'char_103_angel', row: 9, col: 2 }]);
    const [unit, ally] = h.units; h.units.forEach(h.hold); h.spawn([9, 4]);
    let amount = 0;
    h.battle.on('hit', ({ source, dmg }) => { if (source === unit && dmg.isSkill) amount = dmg.amount; }, { priority: -100 });
    const before = ally.assaultCycle.at; h.castNow(unit);
    return { amount, cut: before - ally.assaultCycle.at,unit };
  };
  const base = probe(null), skill = probe(0), talent = probe(1);
  assert.equal(skill.amount,base.amount);
  assert.equal(base.unit.skill.maxCharges,1);assert.equal(skill.unit.skill.maxCharges,2);
  skill.unit.skill.gainSp(1000,'test');assert.equal(skill.unit.skill.spTotal,skill.unit.skill.spCost*2);
  assert.equal(skill.cut, 12); assert.equal(talent.cut, 16); assert.equal(talent.amount, base.amount);
});

test('斯卡蒂 shield module absorbs an actual hit, keeps native thirty-second attack and has no SP clock', () => {
  const body = runtime.bodies.char_263_skadi;
  const h=synergyBattle([{ charId: body.charId, moduleId: body.modulePlans[0].id }]),[a]=h.units;
  const b = synergyBattle([{ charId: body.charId, moduleId: body.modulePlans[1].id }]).units[0];
  assert.ok(Math.abs(a.s.atk / a.base.atk - 2.84) < 1e-9, 'the original Abyssal aura also buffs herself');
  assert.equal(a.skill.kind,'passive');assert.equal(a.skill.spType,'none');
  const enemy=h.spawn([9,3]),hp=a.hp;
  h.battle.dealDamage(enemy,a,{amount:100,type:'true',isAttack:true});assert.equal(a.hp,hp);
  h.battle.dealDamage(enemy,a,{amount:100,type:'true',isAttack:true});assert.equal(a.hp,hp-100);
  assert.equal(cycleLength(a), a.base.respawnTime - 10);
  assert.equal(cycleLength(b), b.base.respawnTime - 14);
});

test('the ammo keyword increases actual starting capacity and full reload, but stays locked below three stars',()=>{
  const body=runtime.bodies.char_4194_rmixer,moduleId=body.modulePlans[1].id;
  for(const star of [1,3]){
    const h=synergyBattle([{charId:body.charId,star,moduleId}]),[u]=h.units,expected=body.adaptation.ammo+(star===3?1:0);
    assert.deepEqual(assaultAmmoState(u),{current:expected,capacity:expected});
    spendCastAmmo(h.battle,u,'test');assert.equal(fillCastAmmo(h.battle,u,u,'test'),1);
    assert.equal(assaultAmmoState(u).current,expected);assert.deepEqual(h.battle.errors,[]);
  }
});

test('a manually chosen real drone entry charges exactly one of its adjacent operators',()=>{
  const body=runtime.bodies.char_108_silent,tokenId='token_10000_silent_healrb',moduleId=body.modulePlans[1].id;
  const probe=synergyBattle([{charId:body.charId,row:10,col:3}]),owner=probe.units[0];
  let preset;
  for(let row=9;row<=12&&!preset;row++)for(let col=2;col<=10;col++)
    if(summonPlacementLegal(probe.battle,owner,tokenId,row,col)&&Math.abs(row-10)+Math.abs(col-3)===1){preset={tokenId,row,col,dir:'RIGHT'};break;}
  assert.ok(preset);
  const h=synergyBattle([{charId:body.charId,row:10,col:3,moduleId,piece:{summonPresets:[preset]}}]),[u]=h.units;
  const drone=h.battle.allyUnits.find(t=>t.kind==='token'&&t.ownerUnit===u&&t.alive);assert.ok(drone);
  assert.equal(u.skill.spTotal,4);
  const empty=synergyBattle([{charId:body.charId,row:10,col:3,moduleId}]);
  assert.equal(empty.units[0].skill.spTotal,0,'a module never invents a summon or placement');assert.deepEqual(h.battle.errors,[]);
});

test('first-three control module queues simultaneous real controls and adds haste duration without scaling recovery again',()=>{
  const body=runtime.bodies.char_291_aglina,h=synergyBattle([{charId:body.charId,row:10,col:3,moduleId:body.modulePlans[1].id},
    {charId:'char_103_angel',row:10,col:2}]),[u,ally]=h.units;
  h.units.forEach(t=>{h.hold(t);t.profile.noAttack=true;});
  const enemies=Array.from({length:4},()=>h.spawn([10,5]));
  for(const e of enemies)applyStatus(h.battle,u,e,{status:'bind',duration:2});h.flush();h.run(.3);
  const haste=ally.findBuff('assault:haste:shared');assert.ok(haste);assert.ok(Math.abs(haste.timeLeft-11.7)<1e-8);
  const row=h.battle.assaultLedger.snapshot().operators.find(r=>r.uid===u.uid);assert.equal(row.hasteSeconds,12);
  assert.equal(u.findBuff('assault:haste:shared'),null,'only the adjacent other operator is accelerated');
  assert.deepEqual(h.battle.errors,[]);
});

test('every-three element module counts six genuine bursts and preserves both haste rewards',()=>{
  const body=runtime.bodies.char_245_cello,h=synergyBattle([{charId:body.charId,row:10,col:3,moduleId:body.modulePlans[1].id},
    {charId:'char_103_angel',row:10,col:2}]),[u,ally]=h.units;
  h.units.forEach(t=>{h.hold(t);t.profile.noAttack=true;});
  const enemy=h.spawn([10,6]);h.battle.dealDamage(ally,enemy,{amount:enemy.gaugeMax*6,type:'element',element:'apoptosis'});h.flush();h.run(.2);
  const row=h.battle.assaultLedger.snapshot().operators.find(r=>r.uid===u.uid);
  assert.equal(row.hasteSeconds,8);assert.ok(Math.abs(u.findBuff('assault:haste:shared').timeLeft-7.8)<1e-8);
  assert.deepEqual(h.battle.errors,[]);
});

test('once-per-battle states receive useful keywords without granting a second native activation',()=>{
  for(const id of ['char_1001_amiya2','char_1037_amiya3','char_204_platnm']){
    const body=runtime.bodies[id];assert.ok(body.modulePlans.every(m=>m.adaptationUpgrade.key!=='moduleStorage'));
  }
  const body=runtime.bodies.char_1001_amiya2,h=synergyBattle([{charId:body.charId,row:10,col:3,moduleId:body.modulePlans[1].id}]),[u]=h.units;
  h.hold(u);h.spawn([10,4]);assert.equal(h.castNow(u),true);
  assert.equal(u.buffs.reduce((n,b)=>n+(b.shieldHits??0),0),2);assert.equal(h.castNow(u),false);
  assert.deepEqual(h.battle.errors,[]);
});

test('白面鸮 talent module grants six seconds of acceleration on an actual full reload', () => {
  const h = synergyBattle([{ charId: 'char_128_plosis', row: 9, col: 3,
    moduleId: runtime.bodies.char_128_plosis.modulePlans[1].id }, { charId: 'char_498_inside', row: 9, col: 4 }]);
  const [plosis, inside] = h.units; h.units.forEach(h.hold);
  spendCastAmmo(h.battle, inside, 'probe'); fillCastAmmo(h.battle, plosis, inside, 'probe'); h.flush();
  assert.equal(inside.findBuff('assault:haste:shared').timeLeft, 6);
});
