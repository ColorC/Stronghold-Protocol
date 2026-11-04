import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/synergyFixture.js';
import { haste, sp, damage, heal, applyStatus, gainDP, payDP } from '../../server/sim/content/assault/primitives.js';
import { cycleRedeploy } from '../../server/sim/content/assault/redeploy-cycle.js';
import { countedTrigger, battleState, installCastAmmo, hasCastAmmo, spendCastAmmo, fillCastAmmo } from '../../server/sim/content/assault/adaptation-primitives.js';
import { assaultAmmoState, reloadAssaultAmmo } from '../../server/sim/content/assault/ammo.js';
import { skillTempo, compressedAttackScale, validateAdaptation, ADAPTATION_VERSION, EVENT_FAMILIES } from '../../shared/assault/adaptation.js';

test('acceleration from two casts adds remaining seconds and doubles only natural recovery', () => {
  const h = makeBattle({ ops: [{ id: 'a' }, { id: 'b' }], redeployCycle: false });
  const a = h.op('a'), b = h.op('b'), base = b.s.spRecovery;
  a.skill.spec.assaultCast = () => haste(h.battle, a, b, 4, 'a');
  h.battle.assaultRuntime.cast(a, { extra: true }); h.flush();
  h.run(1);
  haste(h.battle, b, b, 4, 'b'); h.flush();
  const entries = b.buffs.filter(x => x.key === 'assault:haste:shared');
  assert.equal(entries.length, 1);
  assert.ok(Math.abs(entries[0].timeLeft - 7) < 1e-8);
  assert.equal(b.s.spRecovery, base * 2);
  const before = b.skill.sp;
  sp(h.battle, a, b, 4, 'test', 'fixed-charge');
  assert.equal(b.skill.sp - before, 4, 'acceleration does not multiply an external grant');
  h.run(7.1);
  assert.equal(b.s.spRecovery, base);
});

test('battle state enters once; repeat runs only its explicit action', () => {
  const h = makeBattle({ redeployCycle: false }), a = h.op('a');
  const before = a.s.atk;
  let enters = 0, repeats = 0;
  a.skill.spec.assaultCast = () => battleState(h.battle, a, 'native-state', {
    mods: { atkPct: 1 }, enter: () => enters++, repeat: () => { repeats++; heal(h.battle, a, a, { amount: 100 }); },
  });
  h.battle.assaultRuntime.cast(a, { extra: true }); h.flush();
  a.hp -= 300;
  for (let i = 0; i < 3; i++) { h.battle.assaultRuntime.cast(a, { extra: true }); h.flush(); }
  assert.equal(enters, 1); assert.equal(repeats, 3);
  assert.equal(a.s.atk, before * 2); assert.equal(a.hp, a.s.maxHp);
  h.run(35);
  assert.equal(a.s.atk, before * 2, 'state has no N-second refresh window');
});

test('same-source intrinsic dedup is 0.1 seconds and independent sources still fire', () => {
  const h = makeBattle({ ops: [{ id: 'a' }, { id: 'b' }], redeployCycle: false });
  const a = h.op('a'), b = h.op('b');
  const proc = key => countedTrigger(h.battle, { key, owner: a }, () => sp(h.battle, a, b, 4, 'link', key));
  const one = proc('one'), two = proc('two');
  for (let i = 0; i < 5; i++) one({});
  two({}); h.flush();
  assert.equal(b.skill.sp, 8);
  h.run(.1); one({}); h.flush();
  assert.ok(Math.abs(b.skill.sp - 12.1) < 1e-8);
  assert.equal(one.record.deduplicated, 4);
});

test('every N counts all events, preserves remainder and drains earned rewards without loss', () => {
  const h = makeBattle({ ops: [{ id: 'a' }, { id: 'b' }], redeployCycle: false });
  const a = h.op('a'), b = h.op('b');
  const take = countedTrigger(h.battle, { key: 'third-cast', owner: a, every: 3 }, () => sp(h.battle, a, b, 4, 'link', 'third'));
  h.battle.assaultRuntime.observe('skillResolved', 'test:third', event => take({ cause: event.cause }));
  for (let i = 0; i < 8; i++) { h.battle.assaultRuntime.cast(a, { extra: true }); h.flush(); }
  assert.equal(take.record.counted, 8); assert.equal(take.record.remainder, 2);
  assert.equal(b.skill.sp, 4);
  // Native scheduled callbacks run at the beginning of the following tick.
  h.run(.2);
  assert.equal(take.record.emitted, 2); assert.ok(Math.abs(b.skill.sp - 8.2) < 1e-8);
  h.battle.assaultRuntime.cast(a, { extra: true }); h.flush(); h.run(.1);
  assert.equal(take.record.emitted, 3); assert.equal(take.record.remainder, 0);
});

test('first N is a battle cap; queued causal feedback cannot create a new root', () => {
  const h = makeBattle({ redeployCycle: false }), a = h.op('a');
  let effects = 0;
  const take = countedTrigger(h.battle, { key: 'first-two', owner: a, every: 2, first: 2 }, () => { effects++; });
  for (let i = 0; i < 20; i++) take({});
  h.flush(); h.run(1);
  assert.equal(effects, 2); assert.equal(take.record.rewards, 2);
  const feedback = countedTrigger(h.battle, { key: 'feedback', owner: a, every: 2 }, () => {
    h.battle.assaultRuntime.cast(a, { extra: true }); h.battle.assaultRuntime.cast(a, { extra: true });
  });
  h.battle.assaultRuntime.observe('skillResolved', 'test:feedback', e => feedback({ cause: e.cause }));
  h.battle.assaultRuntime.cast(a, { extra: true }); h.battle.assaultRuntime.cast(a, { extra: true }); h.flush(); h.run(1);
  assert.equal(feedback.record.emitted, 1, 'the queued callback retains the causal guard');
});

test('the first N distinct same-tick recipients are queued without losing a reward to intrinsic dedup', () => {
  const h = makeBattle({ ops: [{ id: 'a' }, { id: 'b' }], redeployCycle: false });
  const a = h.op('a'), received = [];
  const take = countedTrigger(h.battle, { key: 'first-three-recipients', owner: a, first: 3 }, ({ target }) => received.push(target));
  for (const target of ['one', 'two', 'three', 'four']) take({ target });
  h.flush(); assert.deepEqual(received, ['one']);
  h.run(.3); assert.deepEqual(received, ['one', 'two', 'three']);
  assert.equal(take.record.rewards, 3); assert.equal(take.record.deduplicated, 0);
});

test('ammo is casts per battle; empty bars still recover SP; reloading fills the actual pool', () => {
  const h = makeBattle({ ops: [{ id: 'a' }, { id: 'b' }], redeployCycle: false });
  const a = h.op('a'), b = h.op('b');
  installCastAmmo(h.battle, a, 2);
  a.skill.spec.canCast = () => hasCastAmmo(a);
  a.skill.spec.assaultCast = () => spendCastAmmo(h.battle, a, 'native-round');
  h.battle.assaultRuntime.observe('ammoUsed', 'test:ammo-link', ({ payload }) => sp(h.battle, a, b, payload.amount * 4, 'ammo-link', 'ammo'));
  assert.equal(h.battle.assaultRuntime.cast(a, { extra: true }), true);
  assert.equal(h.battle.assaultRuntime.cast(a, { extra: true }), true);
  assert.equal(h.battle.assaultRuntime.cast(a, { extra: true }), false); h.flush();
  assert.equal(b.skill.sp, 8); assert.equal(assaultAmmoState(a).current, 0);
  h.run(1); assert.ok(a.skill.sp > 0, 'the SP clock keeps running with no ammo');
  let reloads = 0;
  h.battle.assaultRuntime.observe('reloaded', 'test:reload', ({ payload }) => { reloads++; assert.equal(payload.amount, 2); });
  assert.equal(fillCastAmmo(h.battle, b, a, 'reload'), 2);
  assert.deepEqual(assaultAmmoState(a), { current: 2, capacity: 2 });
  assert.equal(fillCastAmmo(h.battle, b, a, 'reload'), 0); assert.equal(reloads, 1);
  spendCastAmmo(h.battle, a, 'round'); spendCastAmmo(h.battle, a, 'round');
  assert.equal(reloadAssaultAmmo(h.battle, b, a, 1, 'old-collectible-reload'), 2, 'old numeric reload callers also fill the new cast pool');
});

test('12 event families subscribe to real skill, cold, damage and healing outcomes', () => {
  const h = makeBattle({ enemies: [{ pos: [5, 10] }], redeployCycle: false }), a = h.op('a'), enemy = h.battle.enemies[0];
  assert.equal(Object.keys(EVENT_FAMILIES).length, 12);
  const seen = [];
  for (const family of ['skill', 'cold', 'control', 'sustain', 'kill']) h.battle.assaultRuntime.observeFamily(family, `test:${family}`, event => seen.push([family, event.type, event.payload.amount]));
  a.skill.spec.assaultCast = () => {
    applyStatus(h.battle, a, enemy, { status: 'cold', duration: 4 });
    applyStatus(h.battle, a, enemy, { status: 'stun', duration: 2 });
    heal(h.battle, a, a, { amount: 100 });
  };
  a.hp -= 150;
  h.battle.assaultRuntime.cast(a, { extra: true }); h.flush();
  damage(h.battle, a, enemy, { amount: enemy.s.maxHp * 2, type: 'true' }); h.flush();
  for (const family of ['skill', 'cold', 'control', 'sustain', 'kill']) assert.ok(seen.some(x => x[0] === family), family);
  assert.throws(() => h.battle.assaultRuntime.observeFamily('unknown', 'test:no', () => {}), /unknown/);
});

test('ledger attributes native output and link grants to the source and is detached JSON', () => {
  const h = makeBattle({ ops: [{ id: 'a' }, { id: 'b' }], enemies: [{ pos: [5, 10] }], redeployCycle: false });
  const a = h.op('a'), b = h.op('b'), enemy = h.battle.enemies[0];
  a.skill.spec.assaultCast = () => {
    damage(h.battle, a, enemy, { amount: 100, type: 'true' });
    heal(h.battle, a, b, { amount: 80 });
    sp(h.battle, a, b, 4, 'link', 'grant'); haste(h.battle, a, b, 4, 'grant');
    h.battle.addBuff(b, { key: 'ledger-shield', shield: 120, duration: 5, source: a });
  };
  b.hp -= 100;
  h.battle.assaultRuntime.cast(a, { extra: true }); h.flush(); h.run(1);
  const ledger = JSON.parse(JSON.stringify(h.battle.assaultLedger.snapshot()));
  const row = ledger.operators.find(x => x.uid === a.uid);
  assert.equal(row.casts, 1); assert.equal(row.damage, a.stats.dmg); assert.equal(row.healing, 80);
  assert.equal(row.chargeGiven, 4); assert.equal(row.hasteSeconds, 4); assert.equal(row.shieldHp, 120);
  assert.ok(Math.abs(row.aliveSeconds - 1) < 1e-8);
  row.damage = -1; assert.notEqual(h.battle.assaultLedger.snapshot().operators[0].damage, -1);
});

test('all 12 families carry real engine outcomes to a numerical consumer', () => {
  const h = makeBattle({ ops: [{ id: 'a' }, { id: 'b' }], enemies: [{ pos: [10, 3.2] }], redeployCycle: false });
  const a = h.op('a'), b = h.op('b'), enemy = h.battle.enemies[0];
  const counts = Object.fromEntries(Object.keys(EVENT_FAMILIES).map(family => [family, 0]));
  for (const family of Object.keys(counts)) h.battle.assaultRuntime.observeFamily(family, `test:all:${family}`, () => {
    counts[family]++;
    sp(h.battle, a, b, 1, 'family-link', `family:${family}`);
  });
  h.battle.assaultRuntime.cast(a, { extra: true }); h.flush();
  applyStatus(h.battle, a, enemy, { status: 'cold', duration: 4 });
  applyStatus(h.battle, a, enemy, { status: 'stun', duration: 2 });
  h.run(.2);
  assert.ok(counts.block > 0, 'a real nearby enemy becomes blocked');
  h.battle.push(enemy, 3, { from: a });
  damage(h.battle, a, enemy, { amount: 100, type: 'element', element: 'burn' });
  a.hp -= 100; heal(h.battle, a, a, { amount: 40 });
  cycleRedeploy(h.battle, a);
  installCastAmmo(h.battle, a, 2); spendCastAmmo(h.battle, a, 'round'); fillCastAmmo(h.battle, b, a, 'reload');
  payDP(h.battle, a, 8, 'spend'); gainDP(h.battle, a, 3, 'income');
  const device = h.battle.spawnDevice('test_owned_device', 9, 3, { ownerUnit: a, hp: 100 });
  assert.ok(device);
  damage(h.battle, enemy, device, { amount: 1000, type: 'true' });
  damage(h.battle, a, enemy, { amount: enemy.s.maxHp * 2, type: 'true' }); h.flush();
  for (const [family, count] of Object.entries(counts)) assert.ok(count > 0, `${family} reached its consumer`);
  assert.ok(b.skill.sp >= Object.values(counts).reduce((sum, n) => sum + n, 0), 'every subscription changed actual SP');
});

test('skill tier is a shared authoring field with fixed costs at all four stars', () => {
  for (const [tier, cost] of [['fast', 10], ['medium', 20], ['slow', 35]]) assert.deepEqual(skillTempo(tier, cost).spCosts, [cost, cost, cost, cost]);
  assert.throws(() => skillTempo('fast', 15), /outside/);
  const plan = { version: ADAPTATION_VERSION, type: 'D', sourceSkillId: 'native-s3', rangeGrid: [[0, 0]], targetCount: 1, ammo: 4, tempo: skillTempo('medium', 20) };
  assert.equal(validateAdaptation(plan), plan);
  assert.throws(() => validateAdaptation({ ...plan, ammo: 0 }), /number of casts/);
  assert.ok(validateAdaptation({ version: ADAPTATION_VERSION, type: 'C', passive: true, sourceSkillId: null,
    sourceTraitId: 'character_table.json#/char_4000_jnight/talents/0', rangeGrid: [[0, 0]], targetCount: 99 }), 'a native skill-less operator names its original talent instead of inventing a skill');
  assert.equal(compressedAttackScale({ duration: 30, attackInterval: 1.3, attackScale: 3, hits: 1,
    nativeCost: 90, assaultCost: 35, roleWeight: .9 }), 30 / 1.3 * 3 * 35 / 90 * .9);
});
