import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime } from '../helpers/synergyCard.js';
import { cycleRedeploy } from '../../server/sim/content/assault/redeploy-cycle.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';
import { ROWS, COLS } from '../../server/sim/constants.js';
import { summonPlacementLegal } from '../../server/sim/content/assault/summons.js';
import {applyStatus} from '../../server/sim/content/assault/primitives.js';

test('new core cards preserve source slots, fixed tier costs and native charge capacity', () => {
  for (const id of Object.keys(runtime.bodies).filter(id => runtime.bodies[id].adaptation)) {
    const body = runtime.bodies[id];
    assert.equal(body.adaptation.version, 'bazaar-adaptation/v1');
    if(body.adaptation.sourceSkillId==null){
      assert.equal(body.adaptation.passive,true);assert.equal(body.source.skills.length,0);assert.ok(body.adaptation.sourceTraitId);
    } else assert.equal(body.source.skills[body.adaptation.sourceIndex].skillId, body.adaptation.sourceSkillId);
    if (!body.adaptation.passive) assert.equal(new Set(body.fixedSkill.spCosts).size, 1);
    assert.equal(body.bazaar.castPayoff, undefined);
  }
  assert.equal(runtime.bodies.char_172_svrash.fixedSkill.sourceSkillId, 'skchr_svrash_3');
  assert.equal(runtime.bodies.char_263_skadi.fixedSkill.sourceSkillId, 'skchr_skadi_2');
  assert.deepEqual(runtime.bodies.char_1045_svash2.fixedSkill.maxCharges, [2, 2, 2, 2]);
});

test('真银斩 hits the original cone, caps six targets and its leader link cuts actual timers', () => {
  const h = synergyBattle([{ charId: 'char_172_svrash', row: 9, col: 3 }, { charId: 'char_103_angel', row: 9, col: 2 }]);
  const [silverash, ally] = h.units;
  for (const pos of [[9, 4], [9, 5], [9, 6], [8, 4], [10, 4], [11, 3], [7, 3]]) h.spawn(pos);
  const outside = h.spawn([9, 7]), hp = outside.hp;
  const hit = new Set(); h.battle.assaultRuntime.observe('hit', 'test:cone', e => { if (e.payload.source === silverash) hit.add(e.payload.target); });
  const timer = ally.assaultCycle.at;
  assert.equal(h.castNow(silverash), true);
  assert.equal(hit.size, 6); assert.equal(outside.hp, hp);
  assert.equal(ally.assaultCycle.at, timer - 12);
  assert.equal(silverash.buffs.some(b => /snow|guard|survival/.test(b.key)), false);
});

test('能天使 performs twelve immediate shots again on the second cast, without an overload window', () => {
  const h = synergyBattle([{ charId: 'char_103_angel', row: 9, col: 3 }]);
  const [angel] = h.units; h.spawn([9, 4]);
  let hits = 0; h.battle.assaultRuntime.observe('hit', 'test:shots', e => { if (e.payload.source === angel) hits++; });
  assert.equal(h.castNow(angel), true); assert.equal(hits, 12);
  assert.equal(h.castNow(angel), true); assert.equal(hits, 24);
  assert.equal(angel.buffs.some(b => /overload/.test(b.key)), false);
  assert.equal(h.battle.assaultLedger.snapshot().operators.find(r => r.uid === angel.uid).casts, 2);
});

test('凛御银灰 supplies each teammate two independent original-grid echoes and observes their redeploy', () => {
  const h = synergyBattle([{ charId: 'char_1045_svash2', row: 9, col: 2 }, { charId: 'char_103_angel', row: 9, col: 4 }]);
  const [leader, ally] = h.units; h.spawn([9, 5]);
  assert.equal(h.castNow(leader), true); assert.equal(h.castNow(leader), true);
  assert.ok(h.units.some(u => (u.mem.assaultCostDelta ?? 0) < 0), 'the original S2 deployment-cost reduction remains alongside its visible damage and echoes');
  assert.equal(leader.mem.svash2Echoes[ally.uid], 2);
  h.hold(leader); h.hold(ally);
  let echoed = 0; h.battle.assaultRuntime.observe('hit', 'test:echo', e => { if (e.payload.source === ally) echoed++; });
  const before = leader.skill.sp;
  assert.equal(cycleRedeploy(h.battle, ally), true); h.flush();
  assert.equal(leader.skill.sp - before, 4);
  h.run(1.7); assert.ok(echoed >= 2);
  assert.equal(leader.mem.svash2Echoes[ally.uid], 0);
});

test('灵知 charged S2 pairs native cold into freeze, retaining original area and stored charges', () => {
  const h = synergyBattle([{ charId: 'char_206_gnosis', row: 9, col: 3 }]);
  const [gnosis] = h.units, target = h.spawn([9, 4]);
  gnosis.skill.charges = 2;
  assert.equal(h.castNow(gnosis), true); assert.equal(hasStatus(target, 'frozen'), true);
  assert.equal(gnosis.skill.maxCharges, 2);
});

test('初雪 uses the original 自然震慑 debuff and 虚弱化 fragile aura, with no cold and no charge link',()=>{
  const h=synergyBattle([{charId:'char_174_slbell',row:9,col:3},{charId:'char_103_angel',row:9,col:2}]),[u,ally]=h.units;
  assert.equal(runtime.bodies.char_174_slbell.fixedSkill.sourceSkillId,'skchr_slbell_2');
  assert.equal(runtime.bodies.char_174_slbell.fixedSkill.spCosts[0],20);
  h.units.forEach(x=>{h.hold(x);x.profile.noAttack=true;});
  const foes=[[9,4],[8,4],[10,3]].map(p=>h.spawn(p)),outside=h.spawn([9,7]);foes[0].hp*=.3;
  const def=foes.map(e=>e.s.def),res=foes.map(e=>e.s.res),outsideDef=outside.s.def;
  assert.equal(h.castNow(u),true);h.run(.3);
  foes.forEach((e,i)=>{assert.ok(Math.abs(e.s.def-def[i]*.4)<1e-6,'防御−60%');assert.ok(Math.abs(e.s.res-res[i]*.7)<1e-6,'法抗−30%');
    assert.equal(hasStatus(e,'cold'),false);});
  assert.equal(outside.s.def,outsideDef);
  assert.ok(Math.abs(foes[0].s.dmgTakenMul-1.3)<1e-8);assert.equal(foes[1].s.dmgTakenMul,1);
  h.run(12);foes.forEach((e,i)=>assert.equal(e.s.def,def[i],'削弱持续12秒后结束'));
  h.hold(u);const sp=u.skill.sp;applyStatus(h.battle,ally,outside,{status:'cold',duration:4});h.flush();assert.equal(u.skill.sp,sp,'no cold charge link');
  assert.equal(u.profile.maxTargets,2);assert.deepEqual(h.battle.errors,[]);
});

test('锏 retains six-target double strikes, a third strike on actually blocked enemies and real allied defence penetration',()=>{
  const h=synergyBattle([{charId:'char_4116_blkkgt',row:9,col:3},{charId:'char_103_angel',row:9,col:2}]),[u,ally]=h.units;
  h.units.forEach(x=>{h.hold(x);x.profile.noAttack=true;});h.battle.rng=()=>.99;
  const blocked=h.spawn([9,3.25]);h.battle._checkBlock(blocked);assert.equal(blocked.blockedBy,u);
  const others=Array.from({length:6},()=>h.spawn([9,4])),outside=h.spawn([9,8]),hits=new Map();
  h.battle.on('hit',({source,target,dmg})=>{if(source===u&&dmg.isSkill)hits.set(target,(hits.get(target)??0)+1);});
  assert.equal(h.castNow(u),true);assert.equal(hits.size,6);assert.equal(hits.get(blocked),3);assert.equal(hits.has(outside),false);
  for(const [e,n]of hits){assert.equal(n,e.blockedBy===u?3:2);assert.ok(hasStatus(e,'tremble'));}
  assert.equal(others.filter(e=>hits.has(e)).length,5);
  blocked.base.def=1000;blocked.markDirty();
  const withLink=h.battle.dealDamage(ally,blocked,{amount:1000,type:'phys',isAttack:true});
  u.deployed=false;
  const without=h.battle.dealDamage(ally,blocked,{amount:1000,type:'phys',isAttack:true});
  assert.ok(Math.abs(withLink-300)<1e-6);assert.ok(Math.abs(without-50)<1e-6);
  assert.deepEqual(h.battle.errors,[]);
});

test('塞雷娅 heals the original wide range; every actually healed operator receives one SP', () => {
  const h = synergyBattle([{ charId: 'char_202_demkni', row: 9, col: 3 }, { charId: 'char_103_angel', row: 9, col: 5 }]);
  const [saria, ally] = h.units; h.hold(ally); ally.hp -= 500;
  assert.equal(h.castNow(saria), true);
  assert.ok(ally.hp > ally.s.maxHp - 500); assert.equal(ally.skill.sp, 1);
  const row = h.battle.assaultLedger.snapshot().operators.find(r => r.uid === saria.uid);
  assert.equal(row.healing, 500); assert.equal(row.chargeGiven, 1);
});

test('黄昏 enters one battle state; recasting heals and does not add more attack, HP or extra hits', () => {
  const h = synergyBattle([{ charId: 'char_350_surtr', row: 9, col: 3 }]);
  const [surtr] = h.units; h.spawn([9, 4]);
  assert.equal(h.castNow(surtr), true);
  const stats = { atk: surtr.s.atk, hp: surtr.s.maxHp, targets: surtr.s.maxTargets, range: surtr.s.rangeExtend };
  surtr.hp -= 100;
  let hits = 0; h.battle.assaultRuntime.observe('hit', 'test:no-payoff', e => { if (e.payload.source === surtr) hits++; });
  assert.equal(h.castNow(surtr), true);
  assert.equal(surtr.hp, stats.hp); assert.equal(surtr.s.atk, stats.atk); assert.equal(hits, 0);
  assert.equal(surtr.s.maxTargets, stats.targets); assert.equal(surtr.s.rangeExtend, 2);
});

test('斯卡蒂 retains the explicit thirty-second deployment example and does not acquire an SP clock', () => {
  const h = synergyBattle([{ charId: 'char_263_skadi', row: 9, col: 3 }]);
  const [skadi] = h.units;
  const wave = () => skadi.buffs.find(b=>b.key.endsWith(':wave'));
  assert.equal(skadi.skill.kind, 'passive'); assert.ok(wave()); assert.equal(wave().duration, 30);
  assert.equal(skadi.assaultCycle.length, skadi.base.respawnTime - 10);
  h.run(30.2); assert.equal(wave(),undefined);
  cycleRedeploy(h.battle, skadi); h.flush(); assert.equal(wave().duration, 30);
});

test('新约能天使 consumes one cast-ammo and lands a melee ally at its manually chosen coordinate', () => {
  const h = synergyBattle([{ charId: 'char_1041_angel2', row: 9, col: 3 },
    { charId: 'char_172_svrash', row: 9, col: 4 }]);
  const [angel, ally] = h.units; h.spawn([9, 5]);
  const legal = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++)
    if (h.battle.grid.canStand(row, col, { ranged: false }) && h.battle.onOwnBoard(angel.player, row, col) && !h.battle.isReservedTile(row, col)) legal.push([row, col]);
  assert.ok(legal.length, 'a genuine native ground tile is available');
  const [row, col] = legal[0], point = { tokenId: 'token_10056_angel2_target', row, col, dir: 'RIGHT' };
  angel.def.raw.assaultPiece.summonPresets = [point];
  h.hold(ally);
  assert.deepEqual(assaultAmmoState(angel), { current: 4, capacity: 4 });
  assert.equal(h.castNow(angel), true);
  assert.deepEqual([ally.tileR, ally.tileC], [point.row, point.col]);
  assert.equal(ally.skill.sp, 6); assert.equal(assaultAmmoState(angel).current, 3);
});

function legalTokenTiles(h, tokenId) {
  const list = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++)
    if (summonPlacementLegal(h.battle, h.units[0], tokenId, row, col))
      list.push({ tokenId, row, col, dir: 'RIGHT' });
  return list;
}

test('令 uses only manual S2 summon placements; recalling her hurt summon emits charge and capped battle growth', () => {
  const id = 'char_2023_ling', tokenId = 'token_10020_ling_soul2';
  const quote = synergyBattle([{ charId: id, row: 9, col: 3 }]);
  assert.equal(quote.battle.allyUnits.some(u => u.kind === 'token'), false, 'no automatic fallback summon tile');
  const presets = legalTokenTiles(quote, tokenId).slice(0, 3);
  assert.equal(presets.length, 3);
  const h = synergyBattle([{ charId: id, row: 9, col: 3, piece: { summonPresets: presets } }]);
  const [ling] = h.units;
  const tokens = h.battle.allyUnits.filter(u => u.kind === 'token' && u.ownerUnit === ling && u.alive);
  assert.equal(tokens.length, 3);
  assert.deepEqual(tokens.map(u => [u.tileR, u.tileC]), presets.map(p => [p.row, p.col]));
  const hurt = tokens[0]; hurt.hp = hurt.s.maxHp * .4;
  h.spawn([9, 4]);
  let charge = 0, returned = 0;
  h.battle.assaultRuntime.observe('chargeGranted', 'test:poem-sp', ({ payload }) => { if (payload.source === ling && payload.reason === 'poem') charge += payload.amount; });
  h.battle.assaultRuntime.observe('summonReturned', 'test:poem-return', ({ payload }) => { if (payload.target === hurt) returned++; });
  assert.equal(h.castNow(ling), true);
  assert.equal(returned, 1); assert.equal(charge, 4); assert.equal(ling.mem.adaptPoemStacks, 1);
  assert.equal((h.battle.assaultPermanentEffects ?? []).length, 0, 'native battle growth never becomes cross-battle growth');
});

test('白铁 device clock and cast grant SP to real adjacent operators; original HP drain remains', () => {
  const id = 'char_4072_ironmn', tokenId = 'token_10027_ironmn_pile2';
  const quote = synergyBattle([{ charId: id, row: 9, col: 3 }]);
  let preset = null, adjacent = null;
  for (let row = 0; row < ROWS && !preset; row++) for (let col = 0; col < COLS && !preset; col++) {
    if (!quote.battle.grid.canStand(row, col, { ranged: false }) || !quote.battle.onOwnBoard(quote.units[0].player, row, col)) continue;
    if (!quote.battle.relocate(quote.units[0], row, col)) continue;
    preset = legalTokenTiles(quote, tokenId).find(p => Math.abs(p.row - row) + Math.abs(p.col - col) === 1);
    if (preset) adjacent = { row, col };
  }
  assert.ok(preset);
  preset.dir=adjacent.row<preset.row?'DOWN':adjacent.row>preset.row?'UP':adjacent.col<preset.col?'LEFT':'RIGHT';
  const h = synergyBattle([{ charId: id, row: adjacent.row, col: adjacent.col, piece: { summonPresets: [preset] } }]);
  const [iron] = h.units, device = h.battle.allyUnits.find(u => u.kind === 'token' && u.ownerUnit === iron);
  assert.ok(device); h.hold(iron);
  const hp = device.hp;
  let grants = 0;
  h.battle.assaultRuntime.observe('chargeGranted', 'test:device-charge', ({ payload }) => { if (payload.source === iron) grants += payload.amount; });
  h.run(4.2);
  assert.equal(grants, 2); assert.ok(device.hp < hp);
  const beforeCast=device.hp;
  assert.equal(h.castNow(iron), true); assert.equal(grants, 6, 'signature gives four more SP through each placed device');
  assert.ok(Math.abs(beforeCast-device.hp-device.s.maxHp*.24)<1e-8,'the original 30-second device cost settles immediately');
  const stats = { atk: iron.s.atk, def: iron.s.def };
  assert.equal(iron.profile.hitAllBlocked, true);
  h.run(.2); assert.equal(h.castNow(iron), true);
  assert.equal(iron.s.atk, stats.atk); assert.equal(iron.s.def, stats.def, 'repeating the action never stacks the battle state');
  h.battle.rng=Object.assign(()=>0,{chance:()=>true});
  for(let i=0;i<3;i++){h.run(.2);h.castNow(iron);}
  assert.equal(device.alive,false,'full repeated support costs really destroy the old device');
  const replacement=h.battle.allyUnits.find(t=>t.ownerUnit===iron&&t.defId===tokenId&&t!==device&&t.alive);
  assert.ok(replacement);assert.deepEqual([replacement.tileR,replacement.tileC],[device.tileR,device.tileC]);
  assert.ok(h.battle.assaultLedger.snapshot().operators.find(row=>row.uid===iron.uid).triggers>0,'death bookkeeping and replacement consume stock before recovery is evaluated');
  assert.deepEqual(h.battle.errors,[]);
  const second=legalTokenTiles(quote,tokenId).find(p=>p.row!==preset.row||p.col!==preset.col);assert.ok(second);
  const cycle=synergyBattle([{charId:id,row:adjacent.row,col:adjacent.col,piece:{summonPresets:[preset,second]}}]),[owner]=cycle.units;
  cycle.hold(owner);cycle.battle.rng=Object.assign(()=>0,{chance:()=>true});
  for(let i=0;i<5;i++){cycle.run(.2);cycle.castNow(owner);}
  assert.ok(cycle.battle.assaultLedger.snapshot().operators.find(row=>row.uid===owner.uid).triggers>0,'actual destruction replenishes a pool after its two manual slots consume held devices');
  assert.deepEqual(cycle.battle.errors,[]);
});

test('White Iron device keeps its original forward range and does not charge a different adjacent side',()=>{
  const tokenId='token_10027_ironmn_pile2',probe=synergyBattle([{charId:'char_4072_ironmn',row:9,col:3}]);let fixture;
  search:for(let row=9;row<=12;row++)for(let col=2;col<=10;col++){
    if(!probe.battle.relocate(probe.units[0],row,col))continue;
    for(const preset of legalTokenTiles(probe,tokenId)){
      if(Math.abs(row-preset.row)+Math.abs(col-preset.col)!==1)continue;
      const side=[[-1,0],[1,0],[0,-1],[0,1]].map(([r,c])=>[r+preset.row,c+preset.col]).find(([r,c])=>!(r===row&&c===col)&&probe.battle.onOwnBoard(probe.units[0].player,r,c)&&probe.battle.grid.canStand(r,c,{ranged:true}));
      if(side){fixture={row,col,preset:{...preset,dir:row<preset.row?'DOWN':row>preset.row?'UP':col<preset.col?'LEFT':'RIGHT'},side};break search;}
    }
  }
  assert.ok(fixture);const h=synergyBattle([{charId:'char_4072_ironmn',row:fixture.row,col:fixture.col,piece:{summonPresets:[fixture.preset]}},
    {charId:'char_103_angel',row:fixture.side[0],col:fixture.side[1]}]),[owner,side]=h.units;
  h.units.forEach(h.hold);h.units.forEach(u=>u.profile.noAttack=true);h.run(4.2);
  assert.equal(owner.skill.sp,2);assert.equal(side.skill.sp,0);assert.equal(h.castNow(owner),true);
  assert.equal(owner.skill.sp,4);assert.equal(side.skill.sp,0);assert.deepEqual(h.battle.errors,[]);
});
