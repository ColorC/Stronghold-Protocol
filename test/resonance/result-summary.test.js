import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeResonanceResult } from '../../shared/resonance/result-summary.js';

test('Resonance result summary totals persisted campaign events and only active pacts', () => {
  const summary = summarizeResonanceResult({ phase: 'complete', terminalReason: 'round-limit-loss', round: 30, roundLimit: 30, history: [
    { type: 'fight-settled', hpLoss: 2, combatStats: { units: [{ dmg: 1300, heal: 45, kills: 2 }, { dmg: 48, heal: 0, kills: 1 }] } },
    { type: 'operator-bought', cost: 2 }, { type: 'shop-refreshed', cost: 3 }, { type: 'xp-purchased', gold: 4 },
    { type: 'operator-merged' }, { type: 'item-equipped' }, { type: 'equipment-combined' },
  ] }, {
    active: { name: '坚阵', count: 4, activeThreshold: 4 }, inactive: { name: '术式', count: 3, activeThreshold: 0 },
  });
  assert.deepEqual(summary, {
    stats: { dmgDealt: 1348, healing: 45, kills: 3, gold: 9, refreshes: 1, merges: 1, itemsEquipped: 2, lpLost: 2, activatedLayers: 1 },
    pacts: [{ id: 'active', name: '坚阵', count: 4, activeThreshold: 4 }], roundsPassed: 29, lastRound: 30,
  });
});

test('Resonance result summary defaults missing data to zero and ignores NaN/negative metrics', () => {
  assert.deepEqual(summarizeResonanceResult({ phase: 'complete', terminalReason: 'victory', round: 99, roundLimit: 30 }), {
    stats: { dmgDealt: 0, healing: 0, kills: 0, gold: 0, refreshes: 0, merges: 0, itemsEquipped: 0, lpLost: 0, activatedLayers: 0 },
    pacts: [], roundsPassed: 30, lastRound: 30,
  });
  const summary = summarizeResonanceResult({ phase: 'complete', terminalReason: 'defeat', round: 1, roundLimit: 30, history: [
    { type: 'fight-settled', hpLoss: -2, combatStats: { units: [{ dmg: Number.NaN, heal: -4, kills: Infinity }] } },
    { type: 'shop-refreshed', cost: Number.NaN }, { type: 'operator-bought', cost: -5 }, { type: 'xp-purchased', gold: -1 },
  ] });
  assert.deepEqual(summary.stats, { dmgDealt: 0, healing: 0, kills: 0, gold: 0, refreshes: 1, merges: 0, itemsEquipped: 0, lpLost: 0, activatedLayers: 0 });
  assert.equal(summary.roundsPassed, 0);
});
