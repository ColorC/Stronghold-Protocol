import { codedError } from './rng.js';
import { absoluteRunHour } from './temporary-enhancements.js';
import { isPieceEligibleForEnchantment } from './upgrades.js';

const fields = new Set(['id', 'enchantmentId', 'expiresAtHour']);
const invalid = (message) => { throw codedError('INVALID_TEMPORARY_ENCHANTMENT', message); };
const sameRecord = (a, b) => [...fields].every((key) => a[key] === b[key]);

function validateRecord(record, ids) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).some((key) => !fields.has(key))
    || typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id)
    || typeof record.enchantmentId !== 'string' || !record.enchantmentId.trim()
    || !Number.isSafeInteger(record.expiresAtHour) || record.expiresAtHour < 0) invalid('Invalid temporary enchantment record');
  ids.add(record.id);
}

/** Return validated source records; optional clock/context enforce live expiry and native eligibility. */
export function temporaryEnchantmentRecords(piece, clock = undefined, ctx = undefined) {
  if (piece?.temporaryEnchantments === undefined) return [];
  if (!Array.isArray(piece.temporaryEnchantments)) invalid('temporaryEnchantments must be an array');
  const ids = new Set();
  const now = clock === undefined ? null : absoluteRunHour(clock);
  for (const record of piece.temporaryEnchantments) {
    validateRecord(record, ids);
    if (now !== null && record.expiresAtHour <= now) invalid('Expired temporary enchantment record');
    if (ctx !== undefined) {
      const definition = ctx?.design?.system?.enchantments?.find((entry) => entry.id === record.enchantmentId);
      if (!definition || !isPieceEligibleForEnchantment(piece, ctx, definition)) invalid('Ineligible temporary enchantment record');
    }
  }
  return piece.temporaryEnchantments;
}

/** Permanent choice wins; otherwise only the first live temporary source is effective. */
export function effectiveEnchantmentId(piece, clock) {
  if (typeof piece?.enchantmentId === 'string' && piece.enchantmentId) return piece.enchantmentId;
  const records = temporaryEnchantmentRecords(piece);
  if (!records.length) return null;
  const now = absoluteRunHour(clock);
  return records.find((record) => record.expiresAtHour > now)?.enchantmentId ?? null;
}

export function applyTemporaryEnchantment(piece, record, clock, ctx) {
  if (!piece || typeof piece !== 'object' || Array.isArray(piece)) invalid('Invalid piece');
  const records = temporaryEnchantmentRecords(piece, clock, ctx);
  const ids = new Set();
  validateRecord(record, ids);
  if (record.expiresAtHour <= absoluteRunHour(clock)) invalid('Temporary enchantment must expire in the future');
  const definition = ctx?.design?.system?.enchantments?.find((entry) => entry.id === record.enchantmentId);
  if (!definition || !isPieceEligibleForEnchantment(piece, ctx, definition)) invalid('Ineligible temporary enchantment');
  const existing = records.find((entry) => entry.id === record.id);
  if (existing) {
    if (!sameRecord(existing, record)) invalid('Conflicting temporary enchantment source id');
    return false;
  }
  if (piece.enchantmentId || records.some((entry) => entry.expiresAtHour > absoluteRunHour(clock))) invalid('Piece already has an enchantment');
  piece.temporaryEnchantments = [...records.map((entry) => ({ ...entry })), { ...record }];
  return true;
}

export function mergeTemporaryEnchantments(primary, secondary) {
  const merged = new Map();
  for (const record of [...temporaryEnchantmentRecords(primary), ...temporaryEnchantmentRecords(secondary)]) {
    const existing = merged.get(record.id);
    if (existing && !sameRecord(existing, record)) invalid('Conflicting merged temporary enchantment source id');
    if (!existing) merged.set(record.id, { ...record });
  }
  return [...merged.values()];
}

export function expireTemporaryEnchantments(state) {
  const now = absoluteRunHour(state);
  for (const piece of state.pieces ?? []) {
    if (piece?.temporaryEnchantments === undefined) continue;
    piece.temporaryEnchantments = temporaryEnchantmentRecords(piece).filter((record) => record.expiresAtHour > now);
  }
  return state;
}
