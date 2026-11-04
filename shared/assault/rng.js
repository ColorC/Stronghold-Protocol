export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  if (typeof seed === 'string' && seed.length) {
    let value = 2166136261;
    for (let i = 0; i < seed.length; i += 1) value = Math.imul(value ^ seed.charCodeAt(i), 16777619) >>> 0;
    return value || 0x6d2b79f5;
  }
  throw codedError('INVALID_SEED', 'A numeric or non-empty string seed is required');
}

export function nextUint32(state) {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  value >>>= 0;
  return { value, state: value };
}

export function nextFloat(state) {
  const next = nextUint32(state);
  return { value: next.value / 0x100000000, state: next.state };
}

export function pickWeighted(entries, state, weightOf = (entry) => entry.weight) {
  const eligible = entries.filter((entry) => Number.isFinite(weightOf(entry)) && weightOf(entry) > 0);
  const total = eligible.reduce((sum, entry) => sum + weightOf(entry), 0);
  if (!total) return { value: null, state: state >>> 0 };
  if (eligible.length === 1) return { value: eligible[0], state: state >>> 0 };
  const roll = nextFloat(state);
  let cursor = roll.value * total;
  for (const entry of eligible) {
    cursor -= weightOf(entry);
    if (cursor < 0) return { value: entry, state: roll.state };
  }
  return { value: eligible.at(-1), state: roll.state };
}

export function sampleWithoutReplacement(entries, count, state, weightOf = () => 1) {
  let rngState = state >>> 0;
  const pool = [...entries];
  const selected = [];
  while (selected.length < count && pool.length) {
    const picked = pickWeighted(pool, rngState, weightOf);
    rngState = picked.state;
    if (!picked.value) break;
    selected.push(picked.value);
    pool.splice(pool.indexOf(picked.value), 1);
  }
  return { values: selected, state: rngState };
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
    return result;
  }
  return value;
}

export function structurallyEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structurallyEqual(value, right[index]));
  }
  if (typeof left !== 'object') return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && structurallyEqual(left[key], right[key]));
}

export function codedError(code, message) {
  return Object.assign(new Error(message ?? code), { code });
}
