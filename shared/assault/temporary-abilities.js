import { codedError } from './rng.js';
import { absoluteRunHour } from './temporary-enhancements.js';

const abilities = new Set(['damage', 'heal', 'regen', 'shield', 'poison', 'burn']);
const fields = new Set(['id', 'ability', 'amount', 'expiresAtHour']);
const invalid = message => { throw codedError('INVALID_TEMPORARY_ABILITY', message); };
const same = (a, b) => [...fields].every(key => a[key] === b[key]);

export function temporaryAbilityRecords(piece, clock = undefined) {
  if (piece?.temporaryAbilityEnhancements === undefined) return [];
  const records = piece.temporaryAbilityEnhancements;
  if (!Array.isArray(records)) invalid('Ability enhancements must be an array');
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(key => !fields.has(key))
      || typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id) || !abilities.has(record.ability)
      || !Number.isFinite(record.amount) || record.amount <= 0 || !Number.isSafeInteger(record.expiresAtHour) || record.expiresAtHour < 0) invalid('Invalid ability enhancement record');
    ids.add(record.id);
    if (clock !== undefined && record.expiresAtHour <= absoluteRunHour(clock)) invalid('Expired ability enhancement');
  }
  return records;
}

export function abilityBonuses(piece, clock) {
  const records = temporaryAbilityRecords(piece), result = Object.fromEntries([...abilities].map(ability => [ability, 0]));
  if (!records.length) return result;
  const now = absoluteRunHour(clock);
  for (const record of records) if (record.expiresAtHour > now) {
    result[record.ability] = (result[record.ability] ?? 0) + record.amount;
    if (!Number.isFinite(result[record.ability])) invalid('Ability enhancement overflow');
  }
  return result;
}

export function validateTemporaryAbilityRun(state) {
  for (const piece of state.pieces ?? []) {
    temporaryAbilityRecords(piece, state); abilityBonuses(piece, state);
  }
  return true;
}

export function applyTemporaryAbilityEnhancement(piece, record, clock) {
  if (!piece || typeof piece !== 'object' || Array.isArray(piece)) invalid('Invalid ability owner');
  temporaryAbilityRecords({ temporaryAbilityEnhancements: [record] }, clock);
  const existing = temporaryAbilityRecords(piece, clock).find(entry => entry.id === record?.id);
  if (existing) {
    if (!same(existing, record)) invalid('Conflicting ability source');
    return false;
  }
  const candidate = { ...piece, temporaryAbilityEnhancements: [...temporaryAbilityRecords(piece), { ...record }] };
  temporaryAbilityRecords(candidate, clock); abilityBonuses(candidate, clock);
  piece.temporaryAbilityEnhancements = candidate.temporaryAbilityEnhancements;
  return true;
}

export function mergeTemporaryAbilityEnhancements(primary, secondary) {
  const result = new Map();
  for (const record of [...temporaryAbilityRecords(primary), ...temporaryAbilityRecords(secondary)]) {
    if (result.has(record.id) && !same(result.get(record.id), record)) invalid('Conflicting merged ability source');
    if (!result.has(record.id)) result.set(record.id, { ...record });
  }
  return [...result.values()];
}

export function expireTemporaryAbilityEnhancements(state) {
  if (!(state.pieces ?? []).some(piece => piece.temporaryAbilityEnhancements !== undefined)) return 0;
  const now = absoluteRunHour(state);
  let removed = 0;
  for (const piece of state.pieces ?? []) if (piece.temporaryAbilityEnhancements !== undefined) {
    const records = temporaryAbilityRecords(piece), retained = records.filter(record => record.expiresAtHour > now);
    removed += records.length - retained.length;
    piece.temporaryAbilityEnhancements = retained;
  }
  return removed;
}
