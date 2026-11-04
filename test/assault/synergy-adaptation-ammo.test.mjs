import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime, FLYER } from '../helpers/synergyCard.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';
import { spendCastAmmo, fillCastAmmo } from '../../server/sim/content/assault/adaptation-primitives.js';

test('空弦 preserves native 5→4→3 pursuit hits instead of flattening the whole chain to five hits', () => {
  const h = synergyBattle([{ charId: 'char_332_archet', row: 9, col: 3 }]), [unit] = h.units;
  for (const point of [[9, 4], [9, 5], [9, 6]]) h.spawn(point);
  const hit = new Map();
  h.battle.assaultRuntime.observe('hit', 'test:pursuit', ({ payload: p }) => { if (p.source === unit) hit.set(p.target.id, (hit.get(p.target.id) ?? 0) + 1); });
  assert.equal(h.castNow(unit), true);
  assert.deepEqual([...hit.values()].sort((a, b) => a - b), [3, 4, 5]);
  assert.equal(unit.skill.maxCharges, 3);
});

test('空弦 counts three other sniper casts and reloads the neighbouring actual cast pool', () => {
  const h = synergyBattle([{ charId: 'char_332_archet', row: 9, col: 3 }, { charId: 'char_498_inside', row: 9, col: 4 },
    { charId: 'char_103_angel', row: 9, col: 5 }]);
  const [archet, inside, angel] = h.units; h.units.forEach(h.hold); h.spawn([9, 6]);
  for (let i = 0; i < 4; i++) spendCastAmmo(h.battle, inside, 'setup'); h.flush();
  assert.equal(assaultAmmoState(inside).current, 0);
  h.castNow(angel); h.castNow(angel); assert.equal(assaultAmmoState(inside).current, 0);
  h.castNow(angel); assert.equal(assaultAmmoState(inside).current, 4);
  assert.ok(h.battle.assaultLedger.snapshot().operators.find(row => row.uid === archet.uid).triggers >= 1);
});

test('送葬人 repeats a complete six-shot scatter and retains his own original armour penetration', () => {
  const h = synergyBattle([{ charId: 'char_279_excu', row: 9, col: 3 }, { charId: 'char_498_inside', row: 9, col: 4 }]);
  const [excu, inside] = h.units, enemy = h.spawn([9, 5]); h.units.forEach(h.hold);
  let own = 0, penetration = 0;
  h.battle.on('hit', ({ source, dmg }) => { if (source === excu && dmg.isSkill) own++; if (source === inside) penetration = dmg.defIgnoreFlat; }, { priority: -100 });
  assert.equal(h.castNow(excu), true); assert.equal(own, 6);
  assert.equal(h.castNow(excu), true); assert.equal(own, 12);
  assert.equal(h.castNow(inside), true); assert.equal(penetration, 0); assert.ok(enemy.hp < enemy.s.maxHp);
});

test('圣约送葬人 spends one cast each time, heals through his native trait, and finishes all previously struck targets', () => {
  const h = synergyBattle([{ charId: 'char_1032_excu2', row: 9, col: 3 }]), [unit] = h.units;
  const enemy = h.spawn([9, 4], { mods: { hpMul: 1000, speedMul: 0 } }); h.hold(unit); unit.hp *= .5;
  const initial = assaultAmmoState(unit); assert.equal(initial.current, 5, 'his own Laterano presence retains the native one-round capacity bonus');
  let hits = 0, used = 0;
  h.battle.assaultRuntime.observe('hit', 'test:judgement', ({ payload }) => { if (payload.source === unit) hits++; });
  h.battle.assaultRuntime.observe('ammoUsed', 'test:judgement-ammo', ({ payload }) => { if (payload.source === unit) used += payload.amount; });
  const hp = unit.hp;
  for (let i = 0; i < initial.current; i++) assert.equal(h.castNow(unit), true);
  assert.equal(used, initial.current); assert.equal(hits, initial.current + 1, 'the final additional judgement hits the recorded enemy');
  assert.ok(unit.hp > hp); assert.equal(h.castNow(unit), false); assert.ok(enemy.alive);
});

test('圣约送葬人 converts three friendly ammo uses into an extra full slash on his next cast', () => {
  const h = synergyBattle([{ charId: 'char_1032_excu2', row: 9, col: 3 }, { charId: 'char_498_inside', row: 9, col: 4 }]);
  const [excu, inside] = h.units; h.units.forEach(h.hold); h.spawn([9, 5]);
  for (let i = 0; i < 3; i++) spendCastAmmo(h.battle, inside, 'friendly-round'); h.flush();
  assert.equal(excu.mem.adaptExcuFollowups, 1);
  let hits = 0; h.battle.assaultRuntime.observe('hit', 'test:chosen-slash', ({ payload }) => { if (payload.source === excu) hits++; });
  assert.equal(h.castNow(excu), true); assert.equal(hits, 2); assert.equal(excu.mem.adaptExcuFollowups, 0);
});

test('隐现 retains presence-based capacity; only the first reload expands an adjacent Laterano ally', () => {
  const h = synergyBattle([{ charId: 'char_498_inside', row: 9, col: 3 }, { charId: 'char_1032_excu2', row: 9, col: 4 }]);
  const [inside, excu] = h.units; h.units.forEach(h.hold);
  const cap = assaultAmmoState(excu).capacity;
  h.run(20.2); assert.equal(assaultAmmoState(inside).capacity, 7);
  spendCastAmmo(h.battle, inside, 'round'); fillCastAmmo(h.battle, excu, inside, 'reload'); h.flush();
  assert.equal(assaultAmmoState(excu).capacity, cap + 1);
  h.run(.2); spendCastAmmo(h.battle, inside, 'round'); fillCastAmmo(h.battle, excu, inside, 'reload'); h.flush();
  assert.equal(assaultAmmoState(excu).capacity, cap + 1, 'first-per-battle capacity does not become unlimited resource growth');
});

test('蕾缪安 retains elite exposure marking and can bombard a wanted target outside her original range', () => {
  const h = synergyBattle([{ charId: 'char_4193_lemuen', row: 9, col: 3 }]), [unit] = h.units; h.hold(unit);
  const enemy = h.spawn([9, 4], { mods: { hpMul: 1000, speedMul: 0 } }); enemy.def = { ...enemy.def, rank: 'ELITE' };
  h.run(8.3);
  assert.ok(enemy.buffs.some(b => b.key === 'assault:wanted'));
  enemy.x = 16; enemy.y = 9; h.battle._buildEnemyIndex();
  const hp = enemy.hp;
  assert.equal(h.castNow(unit), true); assert.ok(enemy.hp < hp);
  assert.equal(runtime.bodies.char_4193_lemuen.adaptation.rangeGrid.length, runtime.bodies.char_4193_lemuen.range.length, 'global wanted targeting is the retained talent, not an altered skill grid');
});

test('白面鸮 heals through her original expanded area; reloads add acceleration time without multiplying its rate', () => {
  const h = synergyBattle([{ charId: 'char_128_plosis', row: 9, col: 3 }, { charId: 'char_498_inside', row: 9, col: 4 }]);
  const [plosis, inside] = h.units; h.units.forEach(h.hold); inside.hp -= 500;
  assert.equal(h.castNow(plosis), true); assert.equal(inside.hp, inside.s.maxHp);
  h.run(.3);
  spendCastAmmo(h.battle, inside, 'round'); fillCastAmmo(h.battle, plosis, inside, 'reload'); h.flush();
  const accelerated = () => inside.buffs.find(b => b.key === 'assault:haste:shared');
  assert.equal(accelerated().timeLeft, 4); assert.equal(inside.s.spRecovery, (inside.base.spRecovery + .3) * 2);
  h.run(.2); spendCastAmmo(h.battle, inside, 'round'); fillCastAmmo(h.battle, plosis, inside, 'reload'); h.flush();
  assert.ok(Math.abs(accelerated().timeLeft - 7.8) < 1e-8); assert.equal(inside.s.spRecovery, (inside.base.spRecovery + .3) * 2);
});

test('寒芒克洛丝 keeps the two-to-four-shot burst and credits only her first three friendly stun triggers', () => {
  const h = synergyBattle([{ charId: 'char_1021_kroos2', row: 9, col: 3 }, { charId: 'char_1021_kroos2', row: 9, col: 4 },
    { charId: 'char_498_inside', row: 9, col: 2 }]);
  const [kroos, other, inside] = h.units; h.units.forEach(h.hold); h.spawn([9, 5], { mods: { hpMul: 1000, speedMul: 0 } });
  inside.skill.rule = 'NEVER';
  let granted = 0, hits = 0;
  h.battle.assaultRuntime.observe('chargeGranted', 'test:bullseye', ({ payload }) => { if (payload.source === kroos) granted += payload.amount; });
  h.battle.assaultRuntime.observe('hit', 'test:kroos-shots', ({ payload }) => { if (payload.source === kroos) hits++; });
  h.castNow(kroos); assert.equal(hits, 10);
  for (let i = 0; i < 8; i++) { h.run(.2); h.castNow(other); }
  assert.equal(granted, 12); assert.equal(inside.skill.spTotal, 12);
});

test('流星 keeps five targets and original five-second defence reduction without spreading her own anti-air talent', () => {
  const h = synergyBattle([{ charId: 'char_126_shotst', row: 9, col: 3 }, { charId: 'char_498_inside', row: 9, col: 4 }]);
  const [meteor, inside] = h.units; h.units.forEach(h.hold);
  const foes = Array.from({ length: 6 }, () => h.spawn([9, 5]));
  h.castNow(meteor);
  assert.equal(foes.filter(e => e.buffs.some(b => b.status === 'defDown' && b.duration === 5)).length, 5);
  const flyer = h.spawn([9, 5], { key: FLYER });
  for (const enemy of foes) h.battle.kill(enemy, meteor); h.battle._buildEnemyIndex();
  let factor = 0;
  h.battle.on('hit', ({ source, target, dmg }) => { if (source === inside && target === flyer) factor = dmg.assaultConditionalScales?.['meteor-anti-air']; }, { priority: -100 });
  assert.equal(h.castNow(inside), true); assert.equal(factor, undefined);
});
