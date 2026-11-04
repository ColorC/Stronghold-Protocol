import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTemporaryEnchantment, effectiveEnchantmentId, expireTemporaryEnchantments,
  mergeTemporaryEnchantments, temporaryEnchantmentRecords,
} from '../../shared/assault/temporary-enchantments.js';

const ctx = {
  design: { system: { enchantments: [
    { id: 'ordinary', eligibility: 'any' },
    { id: 'instant-only', eligibility: 'instant' },
  ] } },
  catalog: { bodies: {
    instant: { fixedSkill: { kind: 'instant' } },
    regular: { fixedSkill: { kind: 'manual' } },
  } },
};
const clock = (day = 1, hour = 1) => ({ day, hour });
const piece = (charId = 'regular', extra = {}) => ({ uid: `p-${charId}`, charId, ...extra });
const rec = (id, enchantmentId = 'ordinary', expiresAtHour = 2) => ({ id, enchantmentId, expiresAtHour });

 test('permanent enchantment takes precedence and temporary effect resumes only until its absolute expiry', { timeout: 30000 }, () => {
  const unit = piece('regular', { temporaryEnchantments: [rec('one', 'ordinary', 6)] });
  assert.equal(effectiveEnchantmentId(unit, clock(1, 1)), 'ordinary');
  assert.equal(effectiveEnchantmentId(piece('regular', { temporaryEnchantments: [rec('old', 'ordinary', 0), rec('later', 'ordinary', 8)] }), clock(1, 1)), 'ordinary', 'expired source is skipped when resolving the active effect');
  unit.enchantmentId = 'permanent-choice';
  assert.equal(effectiveEnchantmentId(unit, clock(1, 2)), 'permanent-choice', 'expiry never clears a later permanent choice');
  expireTemporaryEnchantments({ ...clock(2, 1), pieces: [unit] });
  assert.equal(unit.enchantmentId, 'permanent-choice');
  assert.deepEqual(unit.temporaryEnchantments, []);
  delete unit.enchantmentId;
  assert.equal(effectiveEnchantmentId(unit, clock(2, 1)), null, 'after expiry the piece is unenchanted again');
});

test('grant validates definition, native eligibility, live expiry and is atomic/idempotent by exact source record', { timeout: 30000 }, () => {
  const unit = piece('regular');
  const offer = rec('event:one', 'ordinary', 5);
  assert.equal(applyTemporaryEnchantment(unit, offer, clock(), ctx), true);
  const first = structuredClone(unit);
  assert.equal(applyTemporaryEnchantment(unit, offer, clock(), ctx), false);
  assert.deepEqual(unit, first, 'exact replay changes nothing');
  for (const conflicting of [rec('event:one', 'ordinary', 6), rec('event:one', 'instant-only', 5)]) {
    assert.throws(() => applyTemporaryEnchantment(unit, conflicting, clock(), ctx), { code: 'INVALID_TEMPORARY_ENCHANTMENT' });
    assert.deepEqual(unit, first, 'same-ID conflict is atomic');
  }
  assert.throws(() => applyTemporaryEnchantment(piece('regular'), rec('missing', 'unknown', 5), clock(), ctx), { code: 'INVALID_TEMPORARY_ENCHANTMENT' });
  assert.throws(() => applyTemporaryEnchantment(piece('regular'), rec('instant', 'instant-only', 5), clock(), ctx), { code: 'INVALID_TEMPORARY_ENCHANTMENT' });
  assert.equal(applyTemporaryEnchantment(piece('instant'), rec('instant-ok', 'instant-only', 5), clock(), ctx), true);
  assert.throws(() => applyTemporaryEnchantment(piece(), rec('expired', 'ordinary', 0), clock(), ctx), { code: 'INVALID_TEMPORARY_ENCHANTMENT' });
  assert.throws(() => applyTemporaryEnchantment(piece(), rec('now', 'ordinary', 0), clock(1, 2), ctx), { code: 'INVALID_TEMPORARY_ENCHANTMENT' });
});

test('new temporary grant cannot stack over a permanent or another live temporary enchantment', { timeout: 30000 }, () => {
  for (const unit of [piece('regular', { enchantmentId: 'ordinary' }), piece('regular', { temporaryEnchantments: [rec('active', 'ordinary', 3)] })]) {
    const before = structuredClone(unit);
    assert.throws(() => applyTemporaryEnchantment(unit, rec('second', 'ordinary', 4), clock(), ctx), { code: 'INVALID_TEMPORARY_ENCHANTMENT' });
    assert.deepEqual(unit, before);
  }
});

test('record accessor enforces exact shape, unique IDs, safe expiry and optional live context', { timeout: 30000 }, () => {
  assert.deepEqual(temporaryEnchantmentRecords(piece()), []);
  for (const records of [null, {}, [rec('', 'ordinary')], [rec('x', '')], [rec('x', 'ordinary', -1)], [rec('x', 'ordinary', Number.MAX_SAFE_INTEGER + 1)], [rec('x'), { ...rec('x'), expiresAtHour: 3 }], [{ ...rec('x'), price: 4 }]]) {
    assert.throws(() => temporaryEnchantmentRecords(piece('regular', { temporaryEnchantments: records })), { code: 'INVALID_TEMPORARY_ENCHANTMENT' });
  }
  assert.throws(() => temporaryEnchantmentRecords(piece('regular', { temporaryEnchantments: [rec('past', 'ordinary', 0)] }), clock(), ctx), { code: 'INVALID_TEMPORARY_ENCHANTMENT' });
  assert.throws(() => temporaryEnchantmentRecords(piece('regular', { temporaryEnchantments: [rec('not-eligible', 'instant-only', 3)] }), clock(), ctx), { code: 'INVALID_TEMPORARY_ENCHANTMENT' });
});

test('merge preserves all source records in primary-first order, deduplicates exact replay and rejects conflicts atomically', { timeout: 30000 }, () => {
  const a = piece('regular', { temporaryEnchantments: [rec('a', 'ordinary', 2), rec('shared', 'ordinary', 4)] });
  const b = piece('regular', { temporaryEnchantments: [rec('shared', 'ordinary', 4), rec('b', 'ordinary', 5)] });
  const beforeA = structuredClone(a), beforeB = structuredClone(b);
  const merged = mergeTemporaryEnchantments(a, b);
  assert.deepEqual(merged, [rec('a', 'ordinary', 2), rec('shared', 'ordinary', 4), rec('b', 'ordinary', 5)]);
  merged[0].id = 'mutated';
  assert.deepEqual(a, beforeA); assert.deepEqual(b, beforeB, 'merge result and sources do not alias');
  const conflict = piece('regular', { temporaryEnchantments: [rec('shared', 'ordinary', 9)] });
  assert.throws(() => mergeTemporaryEnchantments(a, conflict), { code: 'INVALID_TEMPORARY_ENCHANTMENT' });
  assert.deepEqual(a, beforeA); assert.deepEqual(conflict.temporaryEnchantments, [rec('shared', 'ordinary', 9)]);
});

test('expiry filters every piece at the shared absolute clock and preserves legacy pieces without optional fields', { timeout: 30000 }, () => {
  const legacy = piece('regular');
  const active = piece('regular', { temporaryEnchantments: [rec('live', 'ordinary', 7), rec('expired', 'ordinary', 6)] });
  const state = { ...clock(2, 1), pieces: [legacy, active] };
  assert.equal(expireTemporaryEnchantments(state), state);
  assert.equal(Object.hasOwn(legacy, 'temporaryEnchantments'), false);
  assert.deepEqual(active.temporaryEnchantments, [rec('live', 'ordinary', 7)]);
  assert.equal(effectiveEnchantmentId(active, state), 'ordinary');
  const end = { ...clock(2, 2), pieces: [active] };
  expireTemporaryEnchantments(end);
  assert.deepEqual(active.temporaryEnchantments, []);
  assert.equal(effectiveEnchantmentId(active, end), null);
});

