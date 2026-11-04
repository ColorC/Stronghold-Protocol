// test/render/dmgnumbers.test.js — the damage-number rules (render/dmgNumbers.js, docs/damage-numbers.md) and their use
// in render/fx.js: tier by share of max HP, merge windows, lane order by drift side, one rise curve, crit punch, and
// that the layout is deterministic (no Math.random) — the same hits give the same picture.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  numberTier, numberLook, maxTier, pathKind, travelDir, laneOrder, riseAt, driftAt, critPunchAt, numberText, numberChars,
  canMerge, mergeWindow, TIER_LOOK, CRIT, RISE_T,
} from '../../public/js/render/dmgNumbers.js';

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
