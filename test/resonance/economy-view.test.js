import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRoundIncome } from '../../server/modes/resonance/session.js';
import { finiteValue, forecastIncome, interestFor, settlementBreakdown } from '../../shared/resonance/economy-view.js';

const economy = {
  firstBattleBaseGold: 4,
  laterBaseGold: 5,
  victoryGold: 1,
  interest: { perGold: 10, cap: 5 },
  streakBonus: { 2: 1, 3: 1, 4: 1, 5: 2, 6: 3 },
};

test('unknown numeric values stay unknown instead of becoming zero', () => {
  for (const value of [null, undefined, '']) assert.equal(finiteValue(value), null);
  assert.equal(interestFor(null, 0, 10, 5), null);
  assert.equal(forecastIncome({ state: { gold: null, round: 1, winStreak: 0, lossStreak: 0 }, economy, won: true }), null);
});

test('9 gold interest matches session calculation for win and loss and respects changing cap', () => {
  for (const won of [true, false]) {
    for (const cap of [0, 1, 2, 5, 7]) {
      const state = { gold: 9, round: 2, winStreak: 2, lossStreak: 3, actionCosts: { interestCap: cap } };
      const view = forecastIncome({ state, economy, won });
      const actual = calculateRoundIncome({ gold: 9, round: 2, won, winStreak: 3, lossStreak: 4, interestCap: cap });
      assert.equal(view.interest, actual.interest, `${won ? 'win' : 'loss'} at cap ${cap}`);
      assert.equal(view.total, actual.income + actual.winBonus + actual.streakBonus + actual.interest);
    }
  }
  assert.equal(forecastIncome({ state: { gold: 9, round: 2, winStreak: 0, lossStreak: 0 }, economy, won: true }).interest, 1);
  assert.equal(forecastIncome({ state: { gold: 9, round: 2, winStreak: 0, lossStreak: 0 }, economy, won: false }).interest, 0);
});

test('forecast uses the current round and configured logistics node income', () => {
  const first = forecastIncome({ state: { gold: 0, round: 1, winStreak: 0, lossStreak: 0 }, economy, won: false });
  const later = forecastIncome({ state: { gold: 0, round: 2, winStreak: 0, lossStreak: 0 }, economy, won: false });
  const logistics = forecastIncome({
    state: { gold: 0, round: 3, difficulty: 'FUNNY', nodeStarted: true }, economy,
    campaign: { nodeSchedule: { FUNNY: { oddNodeGold: 7 } } }, won: false,
  });
  assert.equal(first.base, calculateRoundIncome({ gold: 0, round: 1, won: false, winStreak: 1, lossStreak: 1 }).income);
  assert.equal(later.base, calculateRoundIncome({ gold: 0, round: 2, won: false, winStreak: 1, lossStreak: 1 }).income);
  assert.deepEqual(logistics, { kind: 'logistics', base: 7, winBonus: 0, streak: 0, interest: 0, total: 7 });
});

test('settlement reports all gold delta outside the four core income fields and unknown XP', () => {
  const view = settlementBreakdown({ income: 5, winBonus: 1, streakBonus: 2, interest: 1, goldBefore: 9, goldAfter: 21, xpBefore: null });
  assert.equal(view.other, 3);
  assert.equal(view.goldDelta, 12);
  assert.equal(view.xpDelta, null);
});
