// Node curve for enemy strength in the current (rulesVersion 3) campaign: each difficulty's regular-wave HP and ATK
// multipliers are further multiplied by the factors its curve gives at the campaign node, linear between the points and
// flat beyond the ends. Leader nodes (boss, hidden) do not take the curve: they take enemyLeaderBalance below. DEF is
// not on the curve. At every node the four difficulties keep their order (HP strictly, ATK never reversed).
// ABYSS is calibrated on the owner's run c11b3748 (24 fights rebuilt and rerun); NORMAL and HARD on tempo-bot campaigns
// with planned and careless boards; see docs/resonance/design.md 「敌人强度曲线」.
const point = (node, factor) => ({ node, hpMultiplier: factor, atkMultiplier: factor });
const split = (node, hp, atk) => ({ node, hpMultiplier: hp, atkMultiplier: atk });

export const enemyNodeCurve = Object.freeze({
  FUNNY: [point(1, 1), point(12, 1), point(27, 1.1)],
  NORMAL: [split(1, 1, 1), split(5, 1.1, 1.08), split(9, 1.45, 1.25), split(13, 1.9, 1.5), split(17, 2.3, 1.72), split(21, 2.6, 1.92), split(27, 2.9, 2.15)],
  HARD: [split(1, 1, 1), split(4, 1.05, 1), split(8, 1.2, 1.12), split(12, 1.5, 1.36), split(18, 1.85, 1.65), split(22, 2.05, 1.85), split(27, 2.15, 1.92)],
  ABYSS: [point(1, 1), point(4, 1), point(8, 1.15), point(12, 1.4), point(18, 1.7), point(22, 1.9), point(29, 2)],
});

// Leader nodes (第28节点领袖; 深渊第28节点领袖与第30节点隐藏领袖): the HP and ATK of the leader's escort and of the leader
// itself, and the multiplier on the native shared leader pool, set over the terminal profile (DEF stays on it). The native
// pool of one leader grows with the difficulty (about ×2–3.8 from 标准 to 困难, ×1.4–3.8 from 困难 to 深渊), so the pool
// multipliers keep every leader's pool in difficulty order without being ordered themselves. 困难 stays below ×1.41,
// where boss_9's 困难 pool would pass its 深渊 one.
export const enemyLeaderBalance = Object.freeze({
  FUNNY: Object.freeze({ hpMultiplier: 0.65, atkMultiplier: 0.8, bossPoolMultiplier: 0.4 }),
  NORMAL: Object.freeze({ hpMultiplier: 0.85, atkMultiplier: 0.9, bossPoolMultiplier: 2 }),
  HARD: Object.freeze({ hpMultiplier: 0.95, atkMultiplier: 1, bossPoolMultiplier: 1.35 }),
  ABYSS: Object.freeze({ hpMultiplier: 1, atkMultiplier: 1, bossPoolMultiplier: 1 }),
});
