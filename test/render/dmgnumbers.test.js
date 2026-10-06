// test/render/dmgnumbers.test.js — the damage-number rules (render/dmgNumbers.js, docs/damage-numbers.md) and their use
// in render/fx.js: tier by share of max HP, merge windows, lane order by drift side, one rise curve, crit punch, and
// that the layout is deterministic (no Math.random) — the same hits give the same picture.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  numberTier, numberLook, maxTier, pathKind, travelDir, laneOrder, riseAt, driftAt, critPunchAt, numberText, numberChars,
  canMerge, mergeWindow, TIER_LOOK, CRIT, RISE_T,
} from '../../public/js/render/dmgNumbers.js';
import { FxSystem } from '../../public/js/render/fx.js';
import { presetCamera } from '../../public/js/render/projection.js';

describe('tiers', () => {
  test('by share of the target max HP: chip < 3 % ≤ normal < 12 % ≤ heavy < 30 % ≤ massive', () => {
    assert.equal(numberTier(29, 1000), 'chip');
    assert.equal(numberTier(30, 1000), 'normal');
    assert.equal(numberTier(119, 1000), 'normal');
    assert.equal(numberTier(120, 1000), 'heavy');
    assert.equal(numberTier(300, 1000), 'massive');
    // the same 500 is news on a 2000 HP unit, a chip on a 400k boss
    assert.equal(numberTier(500, 2000), 'heavy');
    assert.equal(numberTier(500, 400000), 'chip');
  });
  test('no max HP: a fixed 1000 HP reference', () => {
    assert.equal(numberTier(50, 0), 'normal');
    assert.equal(numberTier(50, NaN), 'normal');
  });
  test('heals and element gauge fills stop at normal; a crit is at least heavy', () => {
    assert.equal(numberTier(900, 1000, 'heal'), 'normal');
    assert.equal(numberTier(900, 1000, 'elem'), 'normal');
    assert.equal(numberTier(5, 1000, 'phys', true), 'heavy');
    assert.equal(numberTier(500, 1000, 'phys', true), 'massive');
  });
  test('looks grow with the tier: bigger, longer, opaque; chips merge longer', () => {
    const order = ['chip', 'normal', 'heavy', 'massive'].map((k) => TIER_LOOK[k]);
    for (let i = 1; i < order.length; i++) {
      assert.ok(order[i].scale > order[i - 1].scale);
      assert.ok(order[i].life >= order[i - 1].life);
      assert.ok(order[i].pop >= order[i - 1].pop);
    }
    assert.ok(TIER_LOOK.chip.alpha < 1);
    assert.ok(TIER_LOOK.chip.merge > TIER_LOOK.normal.merge);
    const c = numberLook('heavy', true);
    assert.ok(c.scale > TIER_LOOK.heavy.scale && c.pop === CRIT.pop && c.merge === 0);
    assert.equal(maxTier('chip', 'heavy'), 'heavy');
    assert.equal(maxTier('massive', 'normal'), 'massive');
  });
});

describe('paths and lanes', () => {
  test('a known attacker → arc away from it; none → rise; heals rise; crits punch', () => {
    assert.equal(pathKind('phys', 1, false), 'arc');
    assert.equal(pathKind('arts', -1, false), 'arc');
    assert.equal(pathKind('phys', 0, false), 'rise');
    assert.equal(pathKind('heal', 1, false), 'rise');
    assert.equal(pathKind('phys', 1, true), 'crit');
  });
  test('drift side: away from the attacker on screen, 0 straight above / below or unknown', () => {
    assert.equal(travelDir(100, 200), 1);
    assert.equal(travelDir(300, 200), -1);
    assert.equal(travelDir(198, 200), 0);
    assert.equal(travelDir(NaN, 200), 0);
  });
  test('lane order: own column first, then outwards on the drift side; no attacker alternates by hit count', () => {
    assert.deepEqual([...laneOrder(1)], [0, 1, 2]);
    assert.deepEqual([...laneOrder(-1)], [0, -1, -2]);
    assert.deepEqual([...laneOrder(0, 2)], [0, 1, -1]);
    assert.deepEqual([...laneOrder(0, 3)], [0, -1, 1]);
  });
  test('one rise curve, monotone and concave; drift only on arcs; crit punch overshoots, undershoots, settles', () => {
    let prev = 0, prevStep = Infinity;
    for (let t = 0.05; t <= RISE_T; t += 0.05) {
      const r = riseAt(t);
      assert.ok(r >= prev);
      assert.ok(r - prev <= prevStep + 1e-9);
      prevStep = r - prev; prev = r;
    }
    assert.equal(riseAt(RISE_T + 1), 1);
    assert.equal(driftAt('rise', 0.3), 0);
    assert.ok(driftAt('arc', 0.25) > 0.5 && driftAt('arc', 1) === 1);
    assert.equal(critPunchAt(0), 1);
    assert.ok(critPunchAt(0.07) < 0);
    assert.equal(critPunchAt(0.5), 0);
  });
  test('text and width: heals "+", crits "!"', () => {
    assert.equal(numberText(1234, 'phys', true), '1234!');
    assert.equal(numberText(56, 'heal', false), '+56');
    assert.equal(numberChars(1234, 'phys', true), 5);
    assert.equal(numberChars(56, 'heal', false), 3);
  });
});

describe('merging', () => {
  test('same style within the window while young; never crits; a chip stream keeps its longer window', () => {
    const t = { style: 'phys', tier: 'normal', tier0: 'normal', lastHit: 0, life: 0.1 };
    assert.ok(canMerge(t, 'phys', false, 0.2));
    assert.ok(!canMerge(t, 'phys', false, 0.35));
    assert.ok(!canMerge(t, 'arts', false, 0.1));
    assert.ok(!canMerge(t, 'phys', true, 0.1));
    assert.ok(!canMerge({ ...t, crit: true }, 'phys', false, 0.1));
    const chip = { style: 'phys', tier: 'normal', tier0: 'chip', lastHit: 0, life: 0.1 };
    assert.equal(mergeWindow(chip), TIER_LOOK.chip.merge);
    assert.ok(canMerge(chip, 'phys', false, 0.45));
    assert.ok(!canMerge({ ...t, life: RISE_T }, 'phys', false, 0.1), 'an old number takes no more hits');
  });
});

class FakeText {
  constructor(text) {
    this.text = text; this.visible = true; this.alpha = 1;
    this.anchor = { set() {} };
    this.scale = { x: 1, set: (v) => { this.scale.x = v; } };
    this.position = { x: 0, y: 0, set: (x, y) => { this.position.x = x; this.position.y = y; } };
  }
  destroy() {}
}
function fakeFx(cam) {
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, {
    P: { BitmapText: FakeText },
    ctx: { cam: () => cam, layers: { text: { addChild() {} } }, settings: {} },
    nums: [], time: 0,
    _p: { x: 0, y: 0, s: 0, depth: 0 }, _q: { x: 0, y: 0, s: 0, depth: 0 },
  });
  return fx;
}
const step = (fx, dt = 1 / 60) => { fx._updateNums(dt); fx.time += dt; };

describe('FxSystem numbers follow the rules', () => {
  const cam = presetCamera('normal', { width: 1600, height: 900 });

  test('a hit from the left drifts right, from the right drifts left; no attacker rises straight up', () => {
    for (const [srcX, sign] of [[3, 1], [11, -1]]) {
      const fx = fakeFx(cam);
      const u = { id: 1, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 3000 };
      fx.number(u, 200, 'phys', { src: { id: 2, x: srcX, y: 9, z: 0 } });
      step(fx, 0);
      const x0 = fx.nums[0].text.position.x;
      for (let i = 0; i < 30; i++) step(fx);
      assert.equal(Math.sign(fx.nums[0].text.position.x - x0), sign);
      assert.equal(fx.nums[0].kind, 'arc');
    }
    const fx = fakeFx(cam);
    const u = { id: 1, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 3000 };
    fx.number(u, 200, 'phys', null);
    step(fx, 0);
    const p0 = { ...fx.nums[0].text.position };
    for (let i = 0; i < 30; i++) step(fx);
    assert.equal(fx.nums[0].text.position.x, p0.x);
    assert.ok(fx.nums[0].text.position.y < p0.y);
  });

  test('size by tier: a 40 % hit is drawn bigger than a 5 % hit, a 1 % hit smaller and fainter', () => {
    const fx = fakeFx(cam);
    const mk = (x, n) => { const u = { id: x, x, y: 9, z: 0, _headTiles: 1.2, maxHp: 1000 }; fx.number(u, n, 'phys', null); return fx.nums.at(-1); };
    const chip = mk(2, 10), normal = mk(6, 50), massive = mk(10, 400);
    for (let i = 0; i < 20; i++) step(fx);
    assert.equal(chip.tier, 'chip'); assert.equal(normal.tier, 'normal'); assert.equal(massive.tier, 'massive');
    assert.ok(massive.text.scale.x > normal.text.scale.x * 1.4);
    assert.ok(chip.text.scale.x < normal.text.scale.x);
    assert.ok(chip.text.alpha < normal.text.alpha);
  });

  test("a 'crit' fx makes this frame's hit on that spot a crit, whichever comes first", () => {
    for (const critFirst of [true, false]) {
      const fx = fakeFx(cam);
      const u = { id: 5, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 5000 };
      if (critFirst) fx._onCrit(7, 9, 99);
      fx.number(u, 321, 'phys', null);
      if (!critFirst) fx._onCrit(7, 9, 99);
      assert.equal(fx.nums.length, 1);
      assert.equal(fx.nums[0].crit, true);
      assert.equal(fx.nums[0].text.text, '321!');
      assert.equal(fx.nums[0].tier, 'heavy');
    }
    // a mark of an earlier frame does not leak into a later hit
    const fx = fakeFx(cam);
    fx._onCrit(7, 9, 99);
    step(fx);
    fx.number({ id: 5, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 5000 }, 10, 'phys', null);
    assert.equal(fx.nums[0].crit, false);
  });

  test("every 'dmg' / 'heal' cue gets its number, whatever its recipe draws (a recipe that draws nothing included)", () => {
    const fx = fakeFx(cam);
    fx.ctx.registry = { play() {} };
    const u = { id: 1, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 3000 };
    fx.play('dmg', { view: u, amount: 300, type: 'arts', src: null, attacker: { id: 9, x: 3, y: 9, z: 0 } });
    fx.play('heal', { view: u, amount: 50 });
    fx.play('atk', { src: u });
    assert.equal(fx.nums.length, 2);
    assert.equal(fx.nums[0].style, 'arts');
    assert.equal(fx.nums[0].kind, 'arc');
    assert.equal(fx.nums[1].text.text, '+50');
    fx.ctx.settings.damageNumbers = false;
    fx.play('dmg', { view: u, amount: 300, type: 'phys' });
    assert.equal(fx.nums.length, 2, 'the setting turns them off');
  });

  test('a dodge label never merges and rises', () => {
    const fx = fakeFx(cam);
    const u = { id: 5, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 5000 };
    fx.number(u, 0, 'true', { label: 'MISS' });
    fx.number(u, 0, 'true', { label: 'MISS' });
    assert.equal(fx.nums.length, 2);
    assert.equal(fx.nums[0].text.text, 'MISS');
    assert.equal(fx.nums[0].kind, 'rise');
  });

  test('deterministic: the same hits give the same picture, and Math.random is never called', () => {
    const shot = () => {
      const fx = fakeFx(cam);
      const units = Array.from({ length: 6 }, (_, i) => ({ id: i, x: 6 + (i % 3) * 0.5, y: 9 + (i >> 1) * 0.3, z: 0, _headTiles: 1.2, maxHp: 2000 + i * 500 }));
      const src = { id: 50, x: 3, y: 9, z: 0 };
      for (let f = 0; f < 90; f++) {
        if (f % 3 === 0) for (const u of units) fx.number(u, 20 + ((f * 37 + u.id * 11) % 700), ['phys', 'arts', 'true', 'elem', 'heal'][(f + u.id) % 5], { src: u.id % 2 ? src : null });
        step(fx);
      }
      return fx.nums.map((t) => [t.text.text, Math.round(t.text.position.x * 100), Math.round(t.text.position.y * 100), t.text.alpha.toFixed(3)]);
    };
    const saved = Math.random;
    Math.random = () => { throw new Error('Math.random in the damage-number layout'); };
    try {
      const a = shot(), b = shot();
      assert.ok(a.length > 0);
      assert.deepEqual(a, b);
    } finally { Math.random = saved; }
  });
});
