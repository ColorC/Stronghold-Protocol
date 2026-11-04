import { codedError } from './rng.js';

const STATS = new Set(['maxHp', 'atk', 'def', 'res', 'aspd', 'bat', 'spRecovery', 'hpRecoveryPerSec']);
export const TEMPORARY_DURATION_TYPES = new Set(['UntilEndOfDay', 'UntilEndOfHour']);
const fields = new Set(['id', 'stat', 'mode', 'amount', 'expiresAtHour']);
const invalid = (message) => { throw codedError('INVALID_TEMPORARY_ENHANCEMENT', message); };
export const temporaryStat = (stat) => stat === 'spGain' ? 'spRecovery' : stat;
export const isTemporaryStat = (stat) => STATS.has(temporaryStat(stat));

export function absoluteRunHour(clock) {
  if (!Number.isSafeInteger(clock?.day) || clock.day < 1 || !Number.isInteger(clock?.hour) || clock.hour < 1 || clock.hour > 6) invalid('Invalid temporary enhancement clock');
  const hour = (clock.day - 1) * 6 + clock.hour - 1;
  if (!Number.isSafeInteger(hour)) invalid('Invalid absolute hour');
  return hour;
}

export function temporaryExpiry(clock, durationType) {
  const now = absoluteRunHour(clock);
  if (!TEMPORARY_DURATION_TYPES.has(durationType)) invalid('Unknown temporary duration');
  const expiry = durationType === 'UntilEndOfDay' ? clock.day * 6 : now + 1;
  if (!Number.isSafeInteger(expiry)) invalid('Invalid temporary expiry');
  return expiry;
}

export function temporaryRecords(piece) {
  if (piece?.temporaryEnhancements === undefined) return [];
  if (!Array.isArray(piece.temporaryEnhancements)) invalid('temporaryEnhancements must be an array');
  const ids = new Set();
  for (const record of piece.temporaryEnhancements) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(key => !fields.has(key))
      || typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id) || !STATS.has(record.stat)
      || !['flat', 'percent'].includes(record.mode) || typeof record.amount !== 'number' || !Number.isFinite(record.amount)
      || !Number.isSafeInteger(record.expiresAtHour) || record.expiresAtHour < 0) invalid('Invalid temporary enhancement record');
    ids.add(record.id);
  }
  return piece.temporaryEnhancements;
}

function assertDomain(stat, value) {
  const valid = Number.isFinite(value) && (stat === 'maxHp' ? value >= 1
    : stat === 'bat' ? value >= 0.05 : ['res', 'aspd', 'hpRecoveryPerSec'].includes(stat) ? true : value >= 0);
  if (!valid) invalid('Invalid temporary projected ' + stat);
}

/** Apply only live records after permanent growth; sum flat first, then sum percent. */
export function projectTemporaryStats(stats, piece, clock) {
  const records = temporaryRecords(piece);
  if (!records.length) return stats;
  const now = absoluteRunHour(clock), flat = {}, percent = {};
  for (const record of records) if (record.expiresAtHour > now) {
    const target = record.mode === 'flat' ? flat : percent;
    target[record.stat] = (target[record.stat] ?? 0) + record.amount;
    if (!Number.isFinite(target[record.stat])) invalid('Non-finite temporary total');
  }
  for (const stat of new Set([...Object.keys(flat), ...Object.keys(percent)])) {
    if (typeof stats[stat] !== 'number' || !Number.isFinite(stats[stat])) invalid('Missing native temporary stat ' + stat);
    const value = (stats[stat] + (flat[stat] ?? 0)) * (1 + (percent[stat] ?? 0));
    assertDomain(stat, value); stats[stat] = value;
  }
  return stats;
}

export function validateTemporaryPiece(piece, clock, body) {
  const records = temporaryRecords(piece);
  if (!records.length) return;
  const stats = { ...body?.starStats?.[piece.star - 1]?.stats };
  for (const [rawStat, value] of Object.entries(piece.permanentFlat ?? {})) {
    const stat = temporaryStat(rawStat); if (STATS.has(stat)) stats[stat] += value;
  }
  for (const [rawStat, value] of Object.entries(piece.permanentPercent ?? {})) {
    const stat = temporaryStat(rawStat); if (STATS.has(stat)) stats[stat] *= 1 + value;
  }
  projectTemporaryStats(stats, piece, clock);
}

export function validateTemporaryRun(state, ctx) {
  for (const piece of state.pieces ?? []) validateTemporaryPiece(piece, state, (ctx.catalog ?? ctx.runtime)?.bodies?.[piece.charId]);
}

export function applyTemporaryEnhancement(piece, record, clock, body) {
  const records = temporaryRecords(piece), existing = records.find(entry => entry.id === record.id);
  if (existing) {
    if ([...fields].some(key => existing[key] !== record[key])) invalid('Conflicting temporary source id');
    return false;
  }
  const candidate = { ...piece, temporaryEnhancements: [...records, { ...record, stat: temporaryStat(record.stat) }] };
  validateTemporaryPiece(candidate, clock, body);
  piece.temporaryEnhancements = candidate.temporaryEnhancements;
  return true;
}

export function mergeTemporaryEnhancements(primary, secondary) {
  const merged = new Map();
  for (const record of [...temporaryRecords(primary), ...temporaryRecords(secondary)]) {
    const existing = merged.get(record.id);
    if (existing && [...fields].some(key => existing[key] !== record[key])) invalid('Conflicting merged temporary source id');
    if (!existing) merged.set(record.id, { ...record });
  }
  return [...merged.values()];
}

export function expireTemporaryEnhancements(state) {
  const now = absoluteRunHour(state);
  for (const piece of state.pieces ?? []) if (piece.temporaryEnhancements !== undefined) {
    piece.temporaryEnhancements = temporaryRecords(piece).filter(record => record.expiresAtHour > now);
  }
}
