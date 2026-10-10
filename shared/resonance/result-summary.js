const nonnegative = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;

/** Summarize only persisted Resonance history; absent or malformed rows contribute nothing. */
export function summarizeResonanceResult(state, displayedPacts = {}) {
  const totals = { dmgDealt: 0, healing: 0, kills: 0, gold: 0, refreshes: 0, merges: 0, itemsEquipped: 0, lpLost: 0 };
  let bossDamage = 0, hasBossDamage = false;
  for (const event of Array.isArray(state?.history) ? state.history : []) {
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'fight-settled') {
      totals.lpLost += nonnegative(event.hpLoss);
      if (Number.isFinite(event.combatStats?.bossDamage)) {
        bossDamage += nonnegative(event.combatStats.bossDamage);
        hasBossDamage = true;
      }
      for (const unit of Array.isArray(event.combatStats?.units) ? event.combatStats.units : []) {
        if (!unit || typeof unit !== 'object') continue;
        totals.dmgDealt += nonnegative(unit.dmg);
        totals.healing += nonnegative(unit.heal);
        totals.kills += nonnegative(unit.kills);
      }
    } else if (event.type === 'operator-bought') totals.gold += nonnegative(event.cost);
    else if (event.type === 'shop-refreshed') { totals.gold += nonnegative(event.cost); totals.refreshes++; }
    else if (event.type === 'xp-purchased') totals.gold += nonnegative(event.gold);
    else if (event.type === 'operator-merged') totals.merges++;
    else if (event.type === 'item-equipped' || event.type === 'equipment-combined') totals.itemsEquipped++;
  }
  const pacts = Object.entries(displayedPacts && typeof displayedPacts === 'object' ? displayedPacts : {})
    .filter(([, pact]) => Number.isFinite(Number(pact?.activeThreshold)) && Number(pact.activeThreshold) > 0)
    .filter(([, pact]) => typeof pact.name === 'string' && pact.name.length > 0)
    .map(([id, pact]) => ({ id, name: pact.name, count: nonnegative(pact.count), activeThreshold: Number(pact.activeThreshold) }));
  const roundLimit = Math.max(0, Math.trunc(nonnegative(state?.roundLimit)));
  const round = Math.max(0, Math.trunc(nonnegative(state?.round)));
  const roundsPassed = Math.min(roundLimit, Math.max(0, state?.phase === 'complete' && state.terminalReason === 'victory' ? round : round - 1));
  return { stats: { ...totals, ...(hasBossDamage ? { bossDamage } : {}), activatedLayers: pacts.length }, pacts, roundsPassed, lastRound: roundLimit };
}
