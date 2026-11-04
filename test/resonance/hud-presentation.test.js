import test from 'node:test';
import assert from 'node:assert/strict';
import { rectanglesOverlap, shopCostPresentation } from '../../public/js/resonance/hudPresentation.js';

test('shop cost tiers map to the five requested full-card color families', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(shopCostPresentation), [
    { tier: 1, tone: 'gray' },
    { tier: 2, tone: 'green' },
    { tier: 3, tone: 'blue' },
    { tier: 4, tone: 'purple' },
    { tier: 5, tone: 'gold' },
  ]);
  assert.deepEqual([0, 6, null].map(shopCostPresentation), [
    { tier: 1, tone: 'gray' },
    { tier: 5, tone: 'gold' },
    { tier: 1, tone: 'gray' },
  ]);
});

test('HUD overlap detection treats touching edges as separate and catches shared area', () => {
  assert.equal(rectanglesOverlap({ left: 0, top: 0, right: 20, bottom: 20 }, { left: 20, top: 0, right: 40, bottom: 20 }), false);
  assert.equal(rectanglesOverlap({ left: 0, top: 0, right: 20, bottom: 20 }, { left: 19, top: 19, right: 40, bottom: 40 }), true);
  assert.equal(rectanglesOverlap(null, { left: 0, top: 0, right: 1, bottom: 1 }), false);
});
