// test/assault/snap-compat.test.mjs — the Assault client's snapshot read-outs (public/js/assault/snapCompat.js) and
// their wiring in client-sim.js runBattleFrame: the three view functions copied from upstream 0.3.2
// (c9d804f47:server/sim/snapshot.js:166-215), the `energy` / `layers` / `charges` rows added to a snapshot, the
// charged cast / counter target fields the official-effects layer reads, and the frame adapter staying safe when the
// compat layer fails.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mysticView, layerView, chargeView, augmentSnapshot, augmentEvents, augmentAssaultSnapshot } from '../../public/js/assault/snapCompat.js';
import { runBattleFrame } from '../../public/js/assault/client-sim.js';

const ally = (o = {}) => ({ id: 1, side: 'ally', alive: true, buffs: [], x: 0, y: 0, ...o });
const enemy = (o = {}) => ({ id: 2, side: 'enemy', alive: true, buffs: [], x: 0, y: 0, ...o });

describe('the view functions (upstream snapshot.js)', () => {
  test('mysticView: an ally stores at most its cap; an enemy or a kit with its own store has no row', () => {
    assert.deepEqual(mysticView(ally({ trait: { stored: 2 }, profile: { storeMax: 3 } })), [2, 3]);
    assert.deepEqual(mysticView(ally({ trait: { stored: 0 }, profile: { storeMax: 3 } })), [0, 3], 'zero is a count');
    assert.deepEqual(mysticView(ally({ trait: { stored: 9 }, profile: { storeMax: 3 } })), [3, 3], 'clamped to the cap');
    assert.equal(mysticView(ally({ trait: {}, profile: { storeMax: 3 } })), null);
    assert.equal(mysticView(ally({ trait: { stored: 1 }, profile: {} })), null);
    assert.equal(mysticView(enemy({ trait: { stored: 2 }, profile: { storeMax: 3 } })), null, 'an enemy has no row');
  });

  test('layerView: the sum of the buffs shieldHits; nothing without a layer', () => {
    assert.equal(layerView({ buffs: [] }), null);
    assert.equal(layerView({ buffs: [{ shieldHits: 2 }, { shieldHits: 0 }, { shield: 100 }] }), 2);
    assert.equal(layerView({ buffs: [{ shieldHits: 1 }, { shieldHits: 2 }] }), 3);
    assert.equal(layerView({ buffs: [{ shieldHits: 0 }] }), null);
  });

  test('chargeView: an ally charge skill as [stored, maximum]; maxCharges 1 or an enemy has none', () => {
    assert.deepEqual(chargeView(ally({ skill: { maxCharges: 2, charges: 1 } })), [1, 2]);
    assert.deepEqual(chargeView(ally({ skill: { maxCharges: 3, charges: 9 } })), [3, 3], 'clamped to the maximum');
    assert.equal(chargeView(ally({ skill: { maxCharges: 1, charges: 1 } })), null);
    assert.equal(chargeView(ally({ skill: { maxCharges: 2, charges: 1, noSkill: true } })), null);
    assert.equal(chargeView(ally({})), null);
    assert.equal(chargeView(enemy({ skill: { maxCharges: 2, charges: 1 } })), null);
  });
});

describe('augmentSnapshot', () => {
  const listed = [[1, 0, 0, 10, 10, 0, 0, 0, 0]];

  test('only units the snapshot lists get a row', () => {
    const u1 = ally({ id: 1, buffs: [{ shieldHits: 2 }], trait: { stored: 1 }, profile: { storeMax: 3 }, skill: { maxCharges: 2, charges: 1 } });
    const u3 = ally({ id: 3, buffs: [{ shieldHits: 4 }], trait: { stored: 2 }, profile: { storeMax: 3 } });
    const snap = augmentSnapshot([u1, u3], { t: 1, units: listed });
    assert.deepEqual(snap.layers, [[1, 2]]);
    assert.deepEqual(snap.energy, [[1, 1, 3]]);
    assert.deepEqual(snap.charges, [[1, 1, 2]]);
  });

  test('a field the snapshot already carries is not overwritten', () => {
    const snap = augmentSnapshot([ally({ id: 1, buffs: [{ shieldHits: 2 }] })], { t: 1, units: listed, layers: [[1, 9]] });
    assert.deepEqual(snap.layers, [[1, 9]]);
  });

  test('nothing to report writes no field at all', () => {
    const snap = augmentSnapshot([ally({ id: 1 })], { t: 1, units: listed });
    assert.deepEqual(Object.keys(snap).sort(), ['t', 'units']);
  });

  test('a missing snapshot or a battle without unit rows is left alone', () => {
    assert.equal(augmentSnapshot([ally()], null), null);
    const snap = { t: 1 };
    assert.equal(augmentSnapshot([ally()], snap), snap);
    assert.deepEqual(Object.keys(snap), ['t']);
  });
});

describe('augmentAssaultSnapshot (the assault-only read-outs)', () => {
  const listed = [[1, 0, 0, 10, 10, 0, 0, 0, 0], [2, 1, 0, 10, 10, 0, 0, 0, 0]];
  const op = (o = {}) => ({ id: 1, uid: 'u1', kind: 'op', side: 'ally', alive: true, deployed: true, mem: {}, ...o });
  const zonedBattle = () => ({
    time: 5,
    assaultZones: new Map([
      ['u1:flare', { id: 'u1:flare', kind: 'flare', tiles: new Set(['3,4', '3,5']), until: 13 }],
      ['u1:seed:9,2', { id: 'u1:seed:9,2', kind: 'seed', tiles: new Set(['9,2']), until: Infinity }],
      ['u1:old', { id: 'u1:old', kind: 'flare', tiles: new Set(['1,1']), until: 4 }],
    ]),
  });

  test('live zones ride the snapshot as [id, kind, tiles]; an expired one does not', () => {
    const snap = augmentAssaultSnapshot(zonedBattle(), { t: 5, units: listed });
    assert.deepEqual(snap.zones, [
      ['u1:flare', 'flare', [[3, 4], [3, 5]]],
      ['u1:seed:9,2', 'seed', [[9, 2]]],
    ]);
  });

  test('圣聆初雪\'s snow tiles join as kind snow while she stands, gone when she is down', () => {
    const battle = { time: 5, allyUnits: [op({ mem: { sbellSnowTiles: new Map([['7,3', 2], ['7,4', 1]]) } })] };
    const snap = augmentAssaultSnapshot(battle, { t: 5, units: listed });
    assert.deepEqual(snap.zones, [['snow:u1', 'snow', [[7, 3], [7, 4]]]]);
    const down = { time: 5, allyUnits: [op({ alive: false, deployed: false, mem: { sbellSnowTiles: new Map([['7,3', 2]]) } })] };
    const snap2 = augmentAssaultSnapshot(down, { t: 5, units: listed });
    assert.equal(snap2.zones, undefined);
  });

  test('the shared assault ammo counter appends an ammo row while rounds are left, none when empty or already listed', () => {
    const withAmmo = (left, bonus = 0, id = 1) => op({
      id,
      _assaultAmmoController: { get: () => left, set: () => {}, max: () => 8 },
      mem: bonus ? { assaultAmmoCapacityBonuses: { growth: bonus } } : {},
    });
    const battle = { time: 5, units: [withAmmo(6, 2)] };
    const snap = augmentAssaultSnapshot(battle, { t: 5, units: listed });
    assert.deepEqual(snap.ammo, [[1, 6, 10]], 'the capacity includes the 弹药上限 bonuses');
    const two = augmentAssaultSnapshot({ time: 5, units: [withAmmo(6, 2, 1), withAmmo(3, 0, 2)] }, { t: 5, units: listed });
    assert.deepEqual(two.ammo, [[1, 6, 10], [2, 3, 8]], 'every loaded unit keeps its row');
    const empty = augmentAssaultSnapshot({ time: 5, units: [withAmmo(0)] }, { t: 5, units: listed });
    assert.equal(empty.ammo, undefined, '打空就消失');
    const native = augmentAssaultSnapshot({ time: 5, units: [withAmmo(6)] }, { t: 5, units: listed, ammo: [[1, 3, 14]] });
    assert.deepEqual(native.ammo, [[1, 3, 14]], 'the native ammoView row stays');
  });

  test('the 再部署 loop rides as [id, at, length] with the rule on, nothing with it off or without a cycle', () => {
    const cycled = op({ assaultCycle: { startedAt: 0, length: 13, at: 13, count: 0 } });
    const snap = augmentAssaultSnapshot({ time: 5, assaultRedeployCycleOn: true, allyUnits: [cycled] }, { t: 5, units: listed });
    assert.deepEqual(snap.redeploy, [[1, 13, 13]]);
    const off = augmentAssaultSnapshot({ time: 5, allyUnits: [cycled] }, { t: 5, units: listed });
    assert.equal(off.redeploy, undefined);
    const summoned = op({ id: 2, kind: 'token', assaultCycle: { length: 13, at: 13 } });
    const none = augmentAssaultSnapshot({ time: 5, assaultRedeployCycleOn: true, allyUnits: [op({}), summoned] }, { t: 5, units: listed });
    assert.equal(none.redeploy, undefined, 'no cycle / not an operator: no row');
  });

  test('a missing battle or snapshot is left alone', () => {
    assert.equal(augmentAssaultSnapshot(null, { t: 1, units: listed }).zones, undefined);
    const snap = { t: 1 };
    assert.equal(augmentAssaultSnapshot(zonedBattle(), snap), snap);
    assert.deepEqual(Object.keys(snap), ['t']);
  });
});

describe('augmentEvents', () => {
  test('a skill start with every charge stored marks that unit\'s shell fx charged, without touching the event', () => {
    const extra = { id: 1 };
    const fx = ['fx', 'shell', 1, 1, extra];
    const skill = ['skill', 1, 1, 'skchr_billro_3'];
    const unit = ally({ id: 1 });
    const prev = new Map([[1, { n: 2, max: 2 }]]);
    const out = augmentEvents([unit], [skill, fx], prev);
    assert.equal(out[0], skill, 'an untouched event keeps its reference');
    assert.equal(out[1][4].charged, true);
    assert.notEqual(out[1][4], extra, 'extra is a copy');
    assert.equal(extra.charged, undefined, 'the sim object is not written');
    assert.equal(fx[4].charged, undefined);
    for (const kind of ['devour', 'sandChains']) {
      const e = { id: 1 };
      assert.equal(augmentEvents([unit], [skill, ['fx', kind, 1, 1, e]], prev)[1][4].charged, true, kind);
    }
  });

  test('a cast without every charge stored, or a fx of another unit, stays untouched', () => {
    const notFull = new Map([[1, { n: 1, max: 2 }]]);
    const fx = ['fx', 'shell', 1, 1, { id: 1 }];
    assert.equal(augmentEvents([ally({ id: 1 })], [['skill', 1, 1], fx], notFull)[1], fx);
    const full = new Map([[1, { n: 2, max: 2 }]]);
    const other = ['fx', 'shell', 1, 1, { id: 2 }];
    assert.equal(augmentEvents([ally({ id: 1 })], [other], full)[0], other);
    const noPrev = ['fx', 'shell', 1, 1, { id: 1 }];
    assert.equal(augmentEvents([ally({ id: 1 })], [['skill', 1, 1], noPrev], undefined)[1], noPrev);
  });

  test('a counter without a target names the nearest living unit of the other side', () => {
    const own = ally({ id: 4, x: 5, y: 5 });
    const near = enemy({ id: 5, x: 6, y: 5 });
    const far = enemy({ id: 6, x: 9, y: 9 });
    const dead = enemy({ id: 7, x: 5.1, y: 5, alive: false });
    const friend = ally({ id: 8, x: 5.05, y: 5 });
    const extra = { id: 4 };
    const out = augmentEvents([own, near, far, dead, friend], [['fx', 'counter', 6, 5, extra]], new Map());
    assert.equal(out[0][4].target, 5);
    assert.equal(extra.target, undefined, 'the sim object is not written');
  });

  test('a counter that already names its target, or has none to name, keeps its event', () => {
    const own = ally({ id: 4, x: 5, y: 5 });
    const named = ['fx', 'counter', 6, 5, { id: 4, target: 9 }];
    assert.equal(augmentEvents([own], [named], new Map())[0], named);
    const lonely = ['fx', 'counter', 6, 5, { id: 4 }];
    assert.equal(augmentEvents([own], [lonely], new Map())[0], lonely, 'no other side alive');
    const unrelated = ['fx', 'hit', 1, 1, { id: 4 }];
    assert.equal(augmentEvents([own], [unrelated], new Map())[0], unrelated);
    assert.equal(augmentEvents([own], [['fx', 'counter', 1, 1, null]], new Map())[0][4], null);
  });
});

describe('runBattleFrame (the compat layer in the frame adapter)', () => {
  const unitRows = [[1, 0, 0, 10, 10, 0, 0, 0, 0]];
  const makeSession = (units, events) => {
    const battle = {
      finished: false, time: 0, units,
      step() { this.time += 0.1; },
      drainEvents() { return events; },
      snapshot() { return { t: this.time, units: unitRows }; },
    };
    return { battle, tick: 0.1, maxSeconds: 120, accumulator: 0 };
  };
  const buffed = () => ally({ id: 1, buffs: [{ shieldHits: 3 }], trait: { stored: 1 }, profile: { storeMax: 2 } });

  test('the returned snapshot carries the read-outs and the events come back filled', () => {
    const events = [['skill', 1, 1, 'sk'], ['fx', 'counter', 1, 0, { id: 1 }]];
    const session = makeSession([buffed(), enemy({ id: 2, x: 1, y: 0 })], events);
    const out = runBattleFrame(session, 0.1, 1);
    assert.equal(out.ticks, 1);
    assert.deepEqual(out.snapshot.layers, [[1, 3]]);
    assert.deepEqual(out.snapshot.energy, [[1, 1, 2]]);
    assert.equal(out.events[1][4].target, 2);
    assert.equal(events[1][4].target, undefined, 'the sim events are not written');
    assert.ok(session.fxPrevCharges instanceof Map);
  });

  test('the charges of a frame are kept for the next one', () => {
    const units = [ally({ id: 1, skill: { maxCharges: 2, charges: 2 } })];
    const first = makeSession(units, []);
    runBattleFrame(first, 0.1, 1);
    assert.deepEqual(first.fxPrevCharges.get(1), { n: 2, max: 2 });
    units[0].skill.charges = 0;
    const events = [['skill', 1, 1, 'sk'], ['fx', 'shell', 0, 0, { id: 1 }]];
    first.battle.drainEvents = () => events;
    const out = runBattleFrame(first, 0.1, 1);
    assert.equal(out.events[1][4].charged, true, 'the cast spent a full store');
    assert.deepEqual(first.fxPrevCharges.get(1), { n: 0, max: 2 });
  });

  test('a compat-layer failure returns the sim\'s own events and snapshot', () => {
    const events = [['fx', 'counter', 1, 0, { id: 1 }]];
    const bad = ally({ id: 1 });
    Object.defineProperty(bad, 'buffs', { get() { throw new Error('compat'); } });
    const session = makeSession([bad], events);
    const out = runBattleFrame(session, 0.1, 1);
    assert.equal(out.ticks, 1);
    assert.equal(out.events, events);
    assert.deepEqual(Object.keys(out.snapshot).sort(), ['t', 'units']);
  });

  test('an in-place 再部署 (the loop count bump) appends one redeploy event, once', () => {
    const unit = ally({ id: 1, kind: 'op', assaultCycle: { startedAt: 0, length: 13, at: 13, count: 0 } });
    const session = makeSession([unit], []);
    session.battle.allyUnits = [unit];
    const first = runBattleFrame(session, 0.1, 1);
    assert.equal(first.events.length, 0, 'no bump at deployment');
    unit.assaultCycle.count = 1;
    const second = runBattleFrame(session, 0.1, 1);
    assert.deepEqual(second.events, [['redeploy', 1]]);
    const third = runBattleFrame(session, 0.1, 1);
    assert.equal(third.events.length, 0, 'the same bump is not reported twice');
  });
});
