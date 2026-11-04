import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildAuditScript, buildPathRows, commandPlan, parseArgs, REMOTE_SCHEMA, runAudit } from '../../tools/resonance/remote-resource-audit.mjs';
import { remoteReceiptAccounting } from '../../tools/resonance/resource-budget.mjs';

const revision = '0123456789abcdef0123456789abcdef01234567';
const current = '/opt/stronghold-protocol/releases/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const options = parseArgs(['--host', 'root@example.invalid', '--identity', 'C:/keys/resonance.pem', '--source-revision', revision,
  '--current-release', current]);

test('remote audit plan uses explicit native identity, bounded read-only du, and only incremental target roots', () => {
  const plan = commandPlan(options);
  assert.equal(plan.connectTimeoutSeconds, 30);
  assert.equal(plan.remoteDuTimeoutSeconds, 60);
  assert.ok(plan.args.includes('ConnectTimeout=30'));
  assert.ok(plan.args.includes('timeout 90s bash -s'));
  assert.match(plan.script, /timeout 60s du -sb/);
  assert.match(plan.script, /sourceRevision/);
  assert.match(plan.script, /CURRENT_REV/);
  assert.match(plan.script, /CURRENT=.*aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(plan.script, /RES_PATHS/);
  assert.ok(plan.script.includes('while IFS="$(printf'));
  assert.match(plan.script, /read -r id target purpose; do/);
  assert.match(plan.script, /\/var\/lib\/stronghold-protocol\/resonance-sessions/);
  assert.match(plan.script, /\/var\/lib\/stronghold-protocol\/capacity-tests\/resonance/);
  assert.match(plan.script, /\/opt\/stronghold-protocol\/releases\/\$REV/);
  assert.doesNotMatch(plan.script, /\/var\/lib\/stronghold-protocol\/rules\/4ed1ad32/);
  assert.doesNotMatch(plan.script, /du -sb -- '\/opt\/stronghold-protocol'/);
});

test('the generated TSV rows survive a real shell read round-trip without quoting paths or truncating purposes', () => {
  const rawRows = buildPathRows(revision);
  assert.equal(rawRows.split('\n').length, 8);
  assert.doesNotMatch(rawRows, /['"]/);
  const parserLine = buildAuditScript({ sourceRevision: revision, currentRelease: current }).match(/^while IFS=.*$/m)?.[0];
  assert.ok(parserLine);
  const shell = `${parserLine}\n  printf '%s\\t%s\\t%s\\n' "$id" "$target" "$purpose"\ndone`;
  const result = spawnSync('bash', ['-c', shell], { input: `${rawRows}\n`, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const parsedRows = result.stdout.trimEnd().split('\n').map((line) => line.split('\t'));
  assert.equal(parsedRows.length, 8);
  assert.deepEqual(parsedRows.map((row) => row[0]), ['candidate', 'nativeRelease', 'remoteStaging', 'resonanceSessions', 'capacityTests', 'sharedPackageJson', 'sharedPackageLock', 'sharedWs']);
  assert.deepEqual(parsedRows.map((row) => row[1]), [
    '/opt/stronghold-protocol/releases/resonance-candidate',
    `/opt/stronghold-protocol/releases/${revision}`,
    '/var/tmp/stronghold-protocol/resonance',
    '/var/lib/stronghold-protocol/resonance-sessions',
    '/var/lib/stronghold-protocol/capacity-tests/resonance',
    '/opt/stronghold-protocol/package.json',
    '/opt/stronghold-protocol/package-lock.json',
    '/opt/stronghold-protocol/node_modules/ws',
  ]);
  assert.equal(parsedRows[0][2], 'pending resonance release candidate');
  assert.equal(parsedRows[3][2], 'resonance persistent sessions and replays');
  assert.equal(parsedRows[7][2], 'shared newly introduced ws package');
});

test('CLI rejects non-native revisions, non-absolute current releases, and unsafe hosts', () => {
  assert.throws(() => parseArgs(['--host', 'root@example.invalid', '--identity', 'C:/key.pem', '--source-revision', 'not-a-commit', '--current-release', current]));
  assert.throws(() => parseArgs(['--host', 'root@example.invalid', '--identity', 'C:/key.pem', '--source-revision', revision, '--current-release', 'relative']));
  assert.throws(() => parseArgs(['--host', 'root;touch.invalid', '--identity', 'C:/key.pem', '--source-revision', revision, '--current-release', current]));
  assert.throws(() => buildAuditScript({ sourceRevision: revision, currentRelease: '/opt/stronghold-protocol/releases/../other' }));
});

test('runner returns resource-budget-compatible receipt and preserves explicitly observed missing paths', () => {
  const entries = [
    { path: '/opt/stronghold-protocol/releases/resonance-candidate', byteCount: 0, purpose: 'candidate', observedAt: '2026-10-09T00:00:00Z', host: 'node-1', observed: false, status: 'missing' },
    { path: '/var/lib/stronghold-protocol/resonance-sessions', byteCount: 512, purpose: 'sessions', observedAt: '2026-10-09T00:00:00Z', host: 'node-1', observed: true, status: 'measured' },
  ];
  const expected = { schema: REMOTE_SCHEMA, source: 'ssh-du', host: 'node-1', observedAt: '2026-10-09T00:00:00Z',
    sourceRevision: revision, currentRelease: { path: current, sourceRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', accounted: false }, entries };
  const receipt = runAudit(options, (command, args, opts) => {
    assert.equal(command, 'ssh');
    assert.ok(args.includes('ConnectTimeout=30'));
    assert.equal(opts.timeout, 95_000);
    assert.match(opts.input, /timeout 60s du -sb/);
    return { status: 0, stdout: JSON.stringify(expected), stderr: '' };
  });
  assert.deepEqual(receipt, expected);
  const accounted = remoteReceiptAccounting(receipt);
  assert.equal(accounted.schema, REMOTE_SCHEMA);
  assert.equal(accounted.bytes, 512);
  const missing = accounted.entries.find((entry) => entry.path.includes('resonance-candidate'));
  const measured = accounted.entries.find((entry) => entry.path.includes('resonance-sessions'));
  assert.equal(missing.byteCount, 0);
  assert.equal(receipt.entries.find((entry) => entry.path === missing.path).observed, false);
  assert.equal(measured.chargedBytes, 512);
});
