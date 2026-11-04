// Select the trait of the same native training record used for the body.
export function nativeTrait(native, growth, ranges) {
  const candidates = native.trait?.candidates ?? [];
  const unlocked = candidates.filter((candidate) => {
    const phase = ['PHASE_0', 'PHASE_1', 'PHASE_2'].indexOf(candidate.unlockCondition?.phase ?? 'PHASE_0');
    return (candidate.requiredPotentialRank ?? 0) === 0 && phase <= growth.phaseIndex
      && (phase < growth.phaseIndex || (candidate.unlockCondition?.level ?? 1) <= growth.level);
  });
  if (candidates.length && !unlocked.length) throw new Error(`${native.name}: no native trait unlocked at selected training`);
  const selected = unlocked.at(-1) ?? null;
  const rawBb = Object.fromEntries((selected?.blackboard ?? []).map((entry) => [entry.key,
    entry.valueStr && (entry.value == null || entry.value === 0) ? entry.valueStr : entry.value]));
  const bb = { ...rawBb };
  // These two branches express a fixed number of life points, rather than an
  // ATK or max-HP ratio. Normalize it once at compilation, just like body HP.
  const fixedLifePoints = ['musha', 'reaper'].includes(native.subProfessionId) && Number.isFinite(bb.value);
  if (fixedLifePoints) bb.value *= 5;
  const description = selected?.overrideDescripton ?? native.description ?? '';
  const values = new Map(Object.entries(bb).map(([key, value]) => [key.toLowerCase(), value]));
  const desc = description.replace(/\{(-?)([^{}:]+)(?::([^{}]+))?\}/g, (match, neg, key, format) => {
    if (!values.has(key.trim().toLowerCase())) return match;
    const value = values.get(key.trim().toLowerCase());
    if (!Number.isFinite(value)) return String(value);
    const signed = neg ? -value : value;
    if (!format) return String(signed);
    const percent = format.endsWith('%');
    const core = percent ? format.slice(0, -1) : format;
    const decimals = core.includes('.') ? core.split('.')[1].length : 0;
    return (percent ? signed * 100 : signed).toFixed(decimals) + (percent ? '%' : '');
  }).replace(/<[^>]*>/g, '');
  const rangeId = selected?.rangeId ?? null;
  const rangeGrid = rangeId ? ranges[rangeId]?.grids.map(({ row, col }) => [row, col]) : null;
  if (rangeId && !rangeGrid) throw new Error(`${native.name}: missing native trait range ${rangeId}`);
  return {
    desc, bb, rangeGrid,
    source: { description, blackboard: selected?.blackboard ?? [], requiredPotentialRank: 0,
      unlockCondition: selected?.unlockCondition ?? null, rangeId },
    normalization: { fixedLifePointScale: fixedLifePoints ? 5 : 1, applications: fixedLifePoints ? 1 : 0 },
  };
}
