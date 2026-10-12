// Node curve for enemy strength in the current (rulesVersion 3) campaign: each difficulty's regular-wave HP and ATK
// multipliers are further multiplied by the factor its curve gives at the campaign node, linear between the points and
// flat beyond the ends. Leader nodes (boss, hidden) keep their terminal profile. DEF is not on the curve.
// Calibrated on the owner's ABYSS run c11b3748 (24 fights rebuilt and rerun) and tempo-bot campaigns; see
// docs/resonance/design.md 「敌人强度曲线」.
const point = (node, factor) => ({ node, hpMultiplier: factor, atkMultiplier: factor });

export const enemyNodeCurve = Object.freeze({
  FUNNY: [point(1, 1), point(12, 1), point(27, 1.1)],
  NORMAL: [point(1, 1), point(6, 1), point(12, 1.1), point(20, 1.2), point(27, 1.25)],
  HARD: [point(1, 1), point(4, 1), point(10, 1.15), point(20, 1.4), point(27, 1.5)],
  ABYSS: [point(1, 1), point(4, 1), point(8, 1.15), point(12, 1.4), point(18, 1.7), point(22, 1.9), point(29, 2)],
});
