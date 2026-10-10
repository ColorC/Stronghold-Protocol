// Workshop economy and round plan. Original game modes keep their own GameData rules.
export const INDEPENDENT_ROUND_LIMITS = Object.freeze([9, 14, 15, 18, 19]);
export const INDEPENDENT_NEW_MODES = Object.freeze([
  { name: '标准局', difficulty: 'NORMAL', roundLimit: 18 },
  { name: '追加挑战', difficulty: 'NORMAL', roundLimit: 19 },
  { name: '短局', difficulty: 'FUNNY', roundLimit: 9 },
]);
export const INDEPENDENT_UPGRADE_PRICES = Object.freeze([5, 7, 8, 9, 10]);
export const INDEPENDENT_SHOP_SLOTS = Object.freeze([3, 4, 4, 5, 5, 6]);
export const independentIncome = round => Math.min(12, Math.max(0, Math.trunc(Number(round)) + 2));
export const independentUpgradeBase = level => INDEPENDENT_UPGRADE_PRICES[level - 1] ?? 0;
export const independentShopSlots = level => INDEPENDENT_SHOP_SLOTS[Math.max(0, Math.min(5, Number(level) - 1))];
export function independentRoundPlan(roundLimit = 18, round = 1) {
  const limit = Number(roundLimit);
  if (!INDEPENDENT_ROUND_LIMITS.includes(limit)) throw new RangeError('BAD_ROUND_LIMIT');
  const bossRound = limit === 9 ? 9 : limit >= 18 ? 18 : 14;
  const hiddenRound = limit === 15 || limit === 19 ? limit : null;
  const kind = round === hiddenRound ? 'hidden' : round === bossRound ? 'boss' : 'normal';
  const waveRound = limit >= 18 ? kind === 'boss' ? 14 : kind === 'hidden' ? 15 : round >= 14 ? round - 4 : round : round;
  return { limit, bossRound, hiddenRound, kind, waveRound, long: limit >= 18 };
}
export function independentPrizeRounds(roundLimit = 18) {
  return roundLimit === 9 ? [4, 8] : roundLimit >= 18 ? [4, 8, 12, 16] : [4, 8, 12];
}
export function independentPrizeStage(roundLimit, round) {
  if (!independentPrizeRounds(roundLimit).includes(round)) return null;
  return roundLimit === 9 && round === 8 ? 'cashout' : ({ 4: 'start', 8: 'build', 12: 'cashout', 16: 'finale' })[round];
}
// Extend the last regular-wave trend: positive R10..13 ratios, retaining flat trends and the native speed/supply.
// This is a Workshop balance curve, not a claim about original stages beyond round 15.
export function independentRoundScale(gd, round, roundLimit) {
  if (roundLimit < 18 || round <= 13) return gd.enemyScale(round);
  const available = Object.keys(gd.mode.enemyScale || {}).map(Number).filter(r => r <= 13).sort((a,b) => a-b);
  const last = available.at(-1) ?? 13;
  const base = gd.enemyScale(last);
  const out = { ...base };
  for (const key of ['hpMul', 'atkMul']) {
    const ratios = available.filter(r => r >= Math.max(2, last - 3)).map(r => {
      const previous = gd.enemyScale(r - 1)[key], value = gd.enemyScale(r)[key];
      return previous > 0 && value >= previous ? value / previous : 1;
    }).filter(x => x > 1.000001);
    const ratio = ratios.length ? Math.exp(ratios.reduce((n,x) => n + Math.log(x),0) / ratios.length) : 1;
    out[key] = Math.round(base[key] * ratio ** (round - last) * 1e9) / 1e9;
  }
  return out;
}
