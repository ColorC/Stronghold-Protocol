const exactValues = level => {
  const values = level?.exactCounts ?? level?.exactUnits ?? level?.exact;
  if (Array.isArray(values)) {
    const parsed = values.map(Number).filter(Number.isFinite);
    return parsed.length ? parsed : null;
  }
  if (Number.isFinite(Number(values))) return [Number(values)];
  return null;
};

/** Exact source tiers can be encoded as a closed one-unit range instead of exactCounts. */
export function levelExactCounts(level) {
  const explicit = exactValues(level);
  if (explicit) return explicit;
  const min = Number(level?.minUnits ?? level?.threshold);
  const hasMax = level?.maxUnits !== undefined && level?.maxUnits !== null;
  const max = hasMax ? Number(level.maxUnits) : Number.NaN;
  if (level?.exactCount === true || level?.exactUnits === true || (Number.isFinite(min) && Number.isFinite(max) && min === max)) {
    return Number.isFinite(min) ? [min] : null;
  }
  return null;
}

export function tierIsExact(level) {
  return levelExactCounts(level) !== null;
}

export function pactTierStatus(level, count) {
  const n = Number(count) || 0, exact = levelExactCounts(level);
  if (exact !== null) return exact.includes(n) ? 'reached' : 'inactive';
  if (tierIsExact(level)) return n === Number(level.minUnits ?? level.threshold) ? 'reached' : 'inactive';
  return n >= (Number(level.minUnits ?? level.threshold) || 0) ? 'reached' : 'unreached';
}

export function pactCurrentTier(levels = [], count, activeThreshold = 0) {
  const explicit = Number(activeThreshold) || 0;
  if (explicit) {
    const match = levels.find(level => Number(level.minUnits ?? level.threshold) === explicit);
    if (match && pactTierStatus(match, count) === 'reached') return match;
  }
  return levels.filter(level => pactTierStatus(level, count) === 'reached')
    .sort((a, b) => Number(a.minUnits ?? a.threshold) - Number(b.minUnits ?? b.threshold)).at(-1) || null;
}

export function nativeStripTier(pact, levels = []) {
  const count = Number(pact?.count) || 0;
  const activeThreshold = Number(pact?.activeThreshold) || 0;
  const current = pactCurrentTier(levels, count, activeThreshold);
  return { active: !!current, tier: current ? levels.indexOf(current) + 1 : 0 };
}

export function pactTierStatusLabel(level, count) {
  const status = pactTierStatus(level, count);
  if (status === 'reached') return '已达成';
  if (status === 'inactive' && tierIsExact(level)) {
    const exact = levelExactCounts(level) ?? [Number(level.minUnits ?? level.threshold)];
    return `未激活：需恰好${exact.join('或')}人`;
  }
  return '未达成';
}
