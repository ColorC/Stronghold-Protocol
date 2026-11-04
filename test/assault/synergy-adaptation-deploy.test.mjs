import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle } from '../helpers/synergyCard.js';
import { cycleRedeploy } from '../../server/sim/content/assault/redeploy-cycle.js';
import { damage } from '../../server/sim/content/assault/primitives.js';
import { hasStatus, inZone } from '../../server/sim/content/assault/synergy.js';

test('缄默德克萨斯 repeats her original deployment blast and capped sword rain on an in-place deployment', () => {
  const h = synergyBattle([{ charId: 'char_1028_texas2', row: 9, col: 3 }]), [unit] = h.units;
  const enemies = Array.from({ length: 6 }, () => h.spawn([9, 4]));
  const hits = new Map(); h.battle.assaultRuntime.observe('hit', 'test:swords', ({ payload }) => {
    if (payload.source === unit) hits.set(payload.target.id, (hits.get(payload.target.id) ?? 0) + 1);
  });
  cycleRedeploy(h.battle, unit); h.flush();
  assert.deepEqual([...hits.values()].sort(), [2, 2, 5, 5, 5, 5]); assert.ok(enemies.every(e => hasStatus(e, 'stun')));
  assert.equal(unit.skill.kind, 'passive');
});

test('缄默德克萨斯 only replays sword rain for the first two friendly kills this battle', () => {
  const h = synergyBattle([{ charId: 'char_1028_texas2', row: 9, col: 3 }, { charId: 'char_103_angel', row: 9, col: 2 }]);
  const [unit, ally] = h.units; h.units.forEach(h.hold); h.spawn([9, 4]);
  for (let i = 0; i < 3; i++) {
    unit.hp = unit.s.maxHp / 2; const victim = h.spawn([8, 3]);
    h.battle.kill(victim, ally); h.flush();
    assert.equal(unit.hp, i < 2 ? unit.s.maxHp : unit.s.maxHp / 2); h.run(.2);
  }
});

test('伊内丝 plants the player-selected shadow; only the return segment hits and her weave expires with the victim', () => {
  const h = synergyBattle([{ charId: 'char_4087_ines', row: 9, col: 3,
    piece: { summonPresets: [{ tokenId: 'ines-sentry', row: 9, col: 6, dir: 'LEFT' }] } },
  { charId: 'char_103_angel', row: 9, col: 2 }]);
  const [ines, ally] = h.units; h.units.forEach(h.hold);
  assert.deepEqual(ines.mem.adaptInesShadow, { r: 9, c: 6, dir: 'LEFT' });
  const inside = h.spawn([9, 5]), outside = h.spawn([9, 10]);
  assert.equal(inZone(h.battle, inside, 'sentry', ines), true);
  const outHP = outside.hp;
  cycleRedeploy(h.battle, ines); h.flush();
  assert.ok(inside.hp < inside.s.maxHp); assert.equal(outside.hp, outHP);
  const atk = ally.s.atk;
  damage(h.battle, ally, outside, { amount: 1, type: 'true' }); h.flush();
  assert.ok(hasStatus(outside, 'bind')); assert.equal(ally.buffs.find(b => b.key.includes('loot:'))?.mods.atkFlat, 90);
  const stolenAtk = ally.s.atk;
  damage(h.battle, ally, outside, { amount: 1, type: 'true' }); h.flush(); assert.equal(ally.s.atk, stolenAtk);
  h.battle.kill(outside, ally); h.flush(); assert.equal(ally.s.atk, atk);
});

test('an off-field saved sentry instruction stays unchanged without creating a replacement zone or failing the battle',()=>{
  const preset={tokenId:'ines-sentry',row:20,col:20,dir:'LEFT'};
  const h=synergyBattle([{charId:'char_4087_ines',row:9,col:3,piece:{summonPresets:[preset]}}]);
  h.flush();assert.deepEqual(h.units[0].def.raw.assaultPiece.summonPresets,[preset]);
  assert.equal(h.units[0].mem.adaptInesShadow,undefined);assert.deepEqual(h.battle.errors,[]);
});

test('宴 pays current health once per deployment, strikes instantly and retains her own health-dependent berserk talent', () => {
  const h = synergyBattle([{ charId: 'char_337_utage', row: 9, col: 3 }, { charId: 'char_103_angel', row: 9, col: 2 }]);
  const [unit, ally] = h.units; h.units.forEach(h.hold); const foe = h.spawn([9, 4]);
  let loss = 0, hits = 0;
  h.battle.assaultRuntime.observe('hit', 'test:utage', ({ payload }) => { if (payload.source === unit) hits++; });
  h.battle.on('damaged', ({ target, dmg, amount }) => { if (target === unit && dmg.tags?.includes('hpLoss')) loss += amount; });
  cycleRedeploy(h.battle, unit); h.flush(); assert.equal(loss, unit.s.maxHp / 2); assert.equal(hits, 8); assert.ok(foe.hp < foe.s.maxHp);
  assert.equal(unit.hp, unit.s.maxHp / 2 + 8 * unit.profile.selfHeal, 'the original Musha trait still heals on each damaging strike, including the first deployment held slashes');
  unit.profile.noAttack=true;foe.base.atk=0;foe.markDirty();unit.hp = unit.s.maxHp * .3; h.run(.3); assert.ok(Math.abs(unit.findBuff('adaptation:utage:serious-mode')?.mods.aspd-100)<1e-6);
  assert.ok(!ally.findBuff('adaptation:utage:serious-mode'));
  unit.hp = unit.s.maxHp; h.run(.3); assert.equal(unit.findBuff('adaptation:utage:serious-mode').mods.aspd,0);
});

test('宴 retains empty-entry slashes, stacks repeated deployments and settles once on actual contact without another cast or health cost',()=>{
 const h=synergyBattle([{charId:'char_337_utage',row:9,col:3}]),[u]=h.units;
 assert.equal(u.mem.adaptUtageSlashes,4);cycleRedeploy(h.battle,u);h.flush();assert.equal(u.mem.adaptUtageSlashes,8);
 const before=h.battle.assaultLedger.snapshot().operators.find(x=>x.uid===u.uid),seen=[];
 h.battle.on('damaged',p=>{if(p.source===u&&p.dmg.isSkill)seen.push(p);});
 h.spawn([9,4]);h.run(.3);assert.equal(seen.length,8);assert.equal(u.mem.adaptUtageSlashes,0);
 const after=h.battle.assaultLedger.snapshot().operators.find(x=>x.uid===u.uid);
 assert.equal(after.casts,before.casts,'contact settles the existing deployment, not an extra cast');
 assert.ok(after.damage>before.damage);h.run(.3);assert.equal(seen.length,8);assert.deepEqual(h.battle.errors,[]);
});

test('宴 settles more than 100 held slashes from actual separate-frame deployments without losing uses or adding casts',()=>{
 const h=synergyBattle([{charId:'char_337_utage',row:9,col:3}]),[u]=h.units;
 for(let i=0;i<30;i++){assert.equal(cycleRedeploy(h.battle,u),true);h.flush();h.step();}
 assert.equal(u.mem.adaptUtageSlashes,124);const casts=h.battle.assaultLedger.snapshot().operators.find(x=>x.uid===u.uid).casts;
 const seen=[];h.battle.on('damaged',p=>{if(p.source===u&&p.dmg.isSkill)seen.push(p);});
 h.spawn([9,4],{mods:{hpMul:10000,speedMul:0}});h.run(.3);assert.equal(seen.length,124);assert.equal(u.mem.adaptUtageSlashes,0);
 assert.equal(h.battle.assaultLedger.snapshot().operators.find(x=>x.uid===u.uid).casts,casts);assert.deepEqual(h.battle.errors,[]);
});
