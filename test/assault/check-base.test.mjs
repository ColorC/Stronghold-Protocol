import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { BROWSER_OFF_ENV, CHECK_LIMITS_MS, createCheckPlan, dependencyInventory, dependencyPreflight, parseTapSummary, selectChecks } from '../../tools/assault/check-base.mjs';

test('base check plan pins browser suites off and bounds node test concurrency', () => {
  assert.deepEqual(
    Object.fromEntries(['SP_E2E', 'SP_REAL_E2E', 'RENDER_E2E', 'SIM_E2E'].map((key) => [key, BROWSER_OFF_ENV[key]])),
    { SP_E2E: '0', SP_REAL_E2E: '0', RENDER_E2E: '0', SIM_E2E: '0' },
  );
  const plan = createCheckPlan();
  assert.deepEqual(CHECK_LIMITS_MS, { total: 1_200_000, eachChild: 900_000 });
  assert.deepEqual(plan.map((check) => check.id), ['full-tests', 'lint', 'imports', 'typecheck', 'i18n', 'golden', 'bazaar-style']);
  assert.ok(plan[6].args.some((arg) => arg.endsWith(path.join('tools', 'assault', 'check-bazaar-style.mjs'))));
  assert.ok(plan[0].args.includes('--test-concurrency=2'));
  assert.ok(plan[1].args.includes('--lint-api'));
  assert.ok(plan[2].args.some((arg) => arg.endsWith(path.join('tools', 'check-imports.mjs'))));
  assert.ok(plan[3].args.some((arg) => arg.endsWith(path.join('typescript', 'bin', 'tsc'))));
  assert.ok(plan[4].args.includes('--strict'));
  assert.ok(plan[5].args.includes('--jobs') && plan[5].args.includes('2'));
  assert.deepEqual(selectChecks(plan, ['full-tests', 'i18n']).map((check) => check.id), ['full-tests', 'i18n']);
  assert.throws(() => selectChecks(plan, ['browser']), /unknown check/);
});

test('selective base checks inventory only selected dependencies and fail honestly when a selected tool is missing', () => {
  const plan = createCheckPlan();
  const noPackageChecks = selectChecks(plan, ['imports', 'golden']);
  const emptyInventory = dependencyInventory(noPackageChecks);
  assert.deepEqual(emptyInventory.packages, []);
  assert.deepEqual(emptyInventory.missing, []);
  assert.deepEqual(dependencyPreflight(noPackageChecks, emptyInventory), [], 'unselected lint/typecheck/i18n packages do not preflight-block checks');

  assert.deepEqual(dependencyPreflight(selectChecks(plan, ['lint']), { packages: [] }), [
    { id: 'lint', missing: ['eslint', '@eslint/js', 'globals'] },
  ], 'a selected lint check cannot silently pass without its packages');
  assert.deepEqual(dependencyPreflight(selectChecks(plan, ['typecheck']), { packages: [] }), [
    { id: 'typecheck', missing: ['typescript'] },
  ]);
  assert.deepEqual(dependencyPreflight(selectChecks(plan, ['full-tests']), { packages: [{ name: 'acorn' }] }), [],
    'full tests can reuse the verified absolute parser cache');
});

test('TAP test totals are extracted for reporting without changing child status', () => {
  assert.deepEqual(parseTapSummary([
    'TAP version 13',
    '# tests 47',
    '# pass 44',
    '# fail 1',
    '# cancelled 0',
    '# skipped 2',
    '# todo 0',
  ].join('\n')), { tests: 47, pass: 44, fail: 1, cancelled: 0, skipped: 2, todo: 0 });
  assert.deepEqual(parseTapSummary('ℹ tests 3\nℹ pass 3'), { tests: 3, pass: 3 });
  const priorRun = '===== child output =====\nℹ tests 8\nℹ pass 8\n===== child result =====\n';
  const currentRun = '===== full-tests =====\nrun_id: current\n===== child output =====\n✔ one test completed\n===== child result =====\n';
  assert.deepEqual(parseTapSummary(priorRun + currentRun), {});
  assert.deepEqual(parseTapSummary(`${priorRun}===== full-tests =====\n===== child output =====\nℹ tests 4\nℹ pass 3\nℹ fail 1\n===== child result =====\n`), { tests: 4, pass: 3, fail: 1 });
});
