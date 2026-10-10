export function finiteValue(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function interestFor(gold, winBonus, perGold, cap) {
  const values = [gold, winBonus, perGold, cap].map(finiteValue);
  if (values.some(value => value == null) || values[2] <= 0 || values[3] < 0) return null;
  return Math.min(values[3], Math.floor((values[0] + values[1]) / values[2]));
}

function streakReward(economy, count) {
  const table = economy?.streakBonus;
  if (!table || typeof table !== 'object') return null;
  const thresholds = Object.keys(table).map(Number).filter(value => Number.isFinite(value) && value <= count).sort((a, b) => b - a);
  return thresholds.length ? finiteValue(table[thresholds[0]]) : 0;
}

export function forecastIncome({ state, economy = {}, campaign = {}, won }) {
  const gold = finiteValue(state?.gold);
  const round = finiteValue(state?.round);
  const perGold = finiteValue(economy?.interest?.perGold);
  const cap = finiteValue(state?.actionCosts?.interestCap ?? economy?.interest?.cap);
  if (gold == null || round == null || perGold == null || cap == null || perGold <= 0 || cap < 0) return null;

  const logistics = state?.difficulty === 'FUNNY' && round % 2 === 1 && state?.nodeStarted === true;
  const base = finiteValue(logistics ? campaign?.nodeSchedule?.FUNNY?.oddNodeGold
    : round === 1 ? economy?.firstBattleBaseGold : economy?.laterBaseGold);
  if (base == null) return null;
  if (logistics) {
    const interest = interestFor(gold, 0, perGold, cap);
    return interest == null ? null : { kind: 'logistics', base, winBonus: 0, streak: 0, interest, total: base + interest };
  }

  const streakCount = finiteValue(won ? state?.winStreak : state?.lossStreak);
  if (streakCount == null) return null;
  const nextCount = streakCount + 1;
  const streak = streakReward(economy, nextCount);
  const winBonus = won ? finiteValue(economy?.victoryGold) : 0;
  if (streak == null || winBonus == null) return null;
  const interest = interestFor(gold, winBonus, perGold, cap);
  if (interest == null) return null;
  return { kind: 'battle', base, winBonus, streak, interest, total: base + winBonus + streak + interest, nextCount };
}

export function settlementBreakdown(summary) {
  if (!summary) return null;
  const fields = ['income', 'winBonus', 'streakBonus', 'interest'].map(key => finiteValue(summary[key]));
  const goldBefore = finiteValue(summary.goldBefore);
  const goldAfter = finiteValue(summary.goldAfter);
  const goldDelta = goldBefore == null || goldAfter == null ? null : goldAfter - goldBefore;
  const coreKnown = fields.every(value => value != null);
  const coreTotal = coreKnown ? fields.reduce((sum, value) => sum + value, 0) : null;
  const other = coreTotal == null || goldDelta == null ? null : goldDelta - coreTotal;
  const xpBefore = finiteValue(summary.xpBefore);
  const xpAfter = finiteValue(summary.xpAfter);
  const xpDelta = finiteValue(summary.xpGain) ?? (xpBefore == null || xpAfter == null ? null : xpAfter - xpBefore);
  return { income: fields[0], winBonus: fields[1], streakBonus: fields[2], interest: fields[3], other, goldBefore, goldAfter, goldDelta, xpDelta, xpAfter, hpLoss: finiteValue(summary.hpLoss) };
}
