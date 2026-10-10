const COST_TIERS = Object.freeze({ 1: 'gray', 2: 'green', 3: 'blue', 4: 'purple', 5: 'gold' });

export function shopCostPresentation(cost) {
  const tier = Math.max(1, Math.min(5, Math.trunc(Number(cost) || 1)));
  return Object.freeze({ tier, tone: COST_TIERS[tier] });
}

export function rectanglesOverlap(a, b) {
  return !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
