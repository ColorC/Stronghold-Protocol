import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, validateReleaseReceipt } from '../../tools/resonance/capacity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const abs = (name) => path.resolve(path.parse(ROOT).root, name);
const REVISION = '0123456789abcdef0123456789abcdef01234567';

test('capacity arguments accept Linux-style absolute locations and receipt provenance', () => {
  const parsed = parseArgs([
    '--data-dir', abs('canonical-data'), '--session-dir', abs('var/capacity-tests/run1'),
    '--receipt', abs('capacity/receipt.json'), '--source-revision', REVISION,
    '--release-receipt', abs('release/server-release.json'),
  ]);
  assert.equal(parsed.datadir, abs('canonical-data'));
  assert.equal(parsed.releasereceipt, abs('release/server-release.json'));
  assert.equal(validateReleaseReceipt(REVISION, { sourceRevision: REVISION }), REVISION);
  assert.throws(() => validateReleaseReceipt(`${REVISION.slice(0, -1)}0`, { sourceRevision: REVISION }), /does not match/);
  assert.throws(() => validateReleaseReceipt(REVISION, { sourceRevision: 'a'.repeat(40) }), /does not match/);
  assert.throws(() => validateReleaseReceipt(REVISION, { sourceRevision: 'not-a-native-commit' }), /full native Git/);
});

test('capacity CLI rejects relative source locations including release receipt', () => {
  const common = ['--data-dir', abs('data'), '--session-dir', abs('runtime/capacity-tests/x'),
    '--receipt', abs('out/receipt.json'), '--source-revision', REVISION];
  assert.throws(() => parseArgs([...common, '--release-receipt', 'release/server-release.json']), /--release-receipt must be an absolute path/);
  assert.throws(() => parseArgs(['--data-dir', 'data', ...common.slice(2)]), /--data-dir must be an absolute path/);
});

test('--help exits before loading canonical data or importing scenario helpers', () => {
  const script = path.join(ROOT, 'tools/resonance/capacity.mjs');
  const missingDataDir = path.join(path.parse(ROOT).root, 'path-that-does-not-exist', 'canonical-data');
  const result = spawnSync(process.execPath, [script, '--help'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, SP_DATA_DIR: missingDataDir },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--release-receipt ABS/);
  assert.doesNotMatch(result.stderr, /ENOENT|loadData|archetype-balance/);
});
