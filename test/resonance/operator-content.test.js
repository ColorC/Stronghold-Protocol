import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOperators } from '../../tools/resonance/verify-operators.mjs';

test('all 154×3 frozen variants construct and start the original Battle for a 60s no-record skill coverage probe', (t) => {
  const result = verifyOperators();
  t.diagnostic(JSON.stringify({ ...result.summary, errors: result.errors, documentedGaps: result.gaps }, null, 2));
  assert.equal(result.summary.operators, 154);
  assert.equal(result.summary.variants, 462);
  assert.equal(result.errors.length, 0, `${result.errors.length} real Battle coverage failures; see diagnostic`);
  assert.ok(result.variants.every((entry) => entry.details?.forcedReachable), 'each variant has a live skill runtime or documented active passive');
  assert.equal(result.summary.engineDiagnostics, 0);
  assert.equal(result.summary.nativeSkillSource.generic, 6, 'the two fixed S3 selections add Ling and Shu to native historical generic metadata; all six use explicit Resonance Kits');
  assert.ok(result.variants.every((entry) => !entry.gaps?.some((gap) => gap.reason === 'fixed-skill-kit-gap:generic')),
    'a valid fixed skill resolved through the runtime skills registry must not remain a source-label gap');
  assert.ok(result.variants.every((entry) => Number.isFinite(entry.details?.naturalSp?.seconds) && entry.details.naturalSp.seconds > 0));
});
