import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { absolutePath, activationCommand, activationScript, parseArgs, preflightScript, resumeVerificationScript, validateCapacityReceipt, validatePrepareResumeReceipt } from '../../tools/resonance/deploy-candidate.mjs';

const revision = '0123456789abcdef0123456789abcdef01234567';
function capacityReceipt() {
  return {
    schema: 'resonance-capacity-receipt/v1', sourceRevision: revision, providedSourceRevision: revision,
    sourceProvenance: { provenance: 'git-rev-parse' }, status: 'completed', concurrency: 4,
    recording: false, host: '127.0.0.1', ephemeralPort: true, server: { bind: '127.0.0.1', port: 43127 }, fixtureType: 'fixed stress fixture',
    accessibility: 'not an economy-achievability claim', error: null,
    sessions: Array.from({ length: 4 }, (_, index) => ({
      id: `session-${index}`, status: 'battle-complete', createdViaHttp: true, validatedPool: true,
      refresh: { status: 200, revisionBefore: 0, revisionAfter: 1 },
      fight: { status: 200, expectedRevision: 1, revisionAfter: 2, diagnostics: { errorCount: 0 }, won: index !== 3, durationSeconds: 42 },
    })),
  };
}

test('activation arguments require capacity receipt and exclude prepare', () => {
  assert.deepEqual(parseArgs(['--release-receipt', 'C:/release.json', '--activate', '--capacity-receipt', 'C:/capacity.json']), {
    prepare: false, activate: true, receiptPath: 'C:/release.json', capacityReceiptPath: 'C:/capacity.json',
  });
  assert.throws(() => parseArgs(['--release-receipt', 'C:/r.json', '--activate']), /必须提供 --capacity-receipt/);
  assert.throws(() => parseArgs(['--release-receipt', 'C:/r.json', '--activate', '--prepare', '--capacity-receipt', 'C:/c.json']), /不能同时使用/);
  assert.throws(() => parseArgs(['--release-receipt', 'C:/r.json', '--capacity-receipt', 'C:/c.json']), /只能与 --activate/);
  assert.throws(() => absolutePath('relative-capacity.json', '--capacity-receipt'), /必须为绝对路径/);
});

function prepareReleaseFixture() {
  const names = ['server-release.json', 'server-code.tar', 'resonance-references.zip', 'package.json', 'package-lock.json'];
  const roles = ['native builder receipt', 'backend and small control page/code archive', 'resonance reference documents', 'minimal server dependency manifest', 'ws version lock manifest'];
  return { sourceRevision: revision, artifacts: names.map((name, index) => ({ path: path.resolve(`E:/release/${name}`), role: roles[index] })) };
}

function prepareFailureFixture(release = prepareReleaseFixture()) {
  return {
    mode: 'prepare', sourceRevision: revision, status: 'failed', commandExitCode: 1,
    artifactTransfers: release.artifacts.map((artifact, index) => ({
      source: artifact.path,
      target: `/var/tmp/stronghold-protocol/resonance/${path.basename(artifact.path)}`,
      role: artifact.role,
      status: index < 4 ? 'transferred' : 'failed',
    })),
  };
}

test('prepare resume accepts only the same Native builder failure prefix and skips transferred artifacts', () => {
  const release = prepareReleaseFixture();
  const receipt = prepareFailureFixture(release);
  const result = validatePrepareResumeReceipt(release, receipt);
  assert.deepEqual(result.skipped.map(row => path.basename(row.source)), release.artifacts.slice(0, 4).map(row => path.basename(row.path)));
  assert.deepEqual([...result.completedNames], ['server-release.json', 'server-code.tar', 'resonance-references.zip', 'package.json']);
  for (const [mutate, pattern] of [
    [row => { row.mode = 'activate'; }, /失败的prepare/],
    [row => { row.status = 'completed'; }, /失败的prepare/],
    [row => { row.sourceRevision = 'f'.repeat(40); }, /sourceRevision/],
    [row => { row.artifactTransfers[0].source = path.resolve('E:/other/server-release.json'); }, /source/],
    [row => { row.artifactTransfers[0].target = '/tmp/unrelated/server-release.json'; }, /target/],
    [row => { row.artifactTransfers[0].role = 'different role'; }, /role/],
    [row => { row.artifactTransfers[1].status = 'transferred'; row.artifactTransfers[0].status = 'failed'; }, /连续成功前缀/],
    [row => { row.artifactTransfers[4].status = 'succeeded'; }, /status无效/],
  ]) {
    const invalid = prepareFailureFixture(release); mutate(invalid);
    assert.throws(() => validatePrepareResumeReceipt(release, invalid), pattern);
  }
});

test('resume verification checks exact remote byte lengths, ordinary files and staged Native revision without writes', () => {
  const release = prepareReleaseFixture();
  const receipt = prepareFailureFixture(release);
  const rows = receipt.artifactTransfers.slice(0, 4).map((row, index) => ({ ...row, localBytes: 100 + index }));
  const script = resumeVerificationScript(revision, rows);
  assert.ok(script.includes("stat -c %h \"$STAGING/server-release.json\""));
  assert.ok(script.includes('staged_revision'));
  assert.ok(script.includes('resume-file-size-mismatch:'));
  assert.ok(script.includes('server-release.json\t100'));
  assert.ok(script.includes('package.json\t103'));
  const parserLine = script.match(/^while IFS=.*$/m)?.[0];
  assert.ok(parserLine);
  const parseShell = `${parserLine}\n  printf '%s\\t%s\\n' "$name" "$expected_bytes"\ndone`;
  const parsed = spawnSync('bash', ['-c', parseShell], { input: `${rows.map(row => `${path.basename(row.source)}\t${row.localBytes}`).join('\n')}\n`, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.deepEqual(parsed.stdout.trimEnd().split('\n'), ['server-release.json\t100', 'server-code.tar\t101', 'resonance-references.zip\t102', 'package.json\t103']);
  assert.equal(spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' }).status, 0);
  assert.throws(() => resumeVerificationScript(revision, [{ ...rows[0], localBytes: -1 }]), /invalid resume verification row/);
});

test('resume CLI is available only with prepare and remains separate from activation', () => {
  assert.deepEqual(parseArgs(['--release-receipt', 'C:/r.json', '--prepare', '--resume-receipt', 'C:/failure.json']), {
    prepare: true, activate: false, receiptPath: 'C:/r.json', resumeReceiptPath: 'C:/failure.json',
  });
  assert.throws(() => parseArgs(['--release-receipt', 'C:/r.json', '--resume-receipt', 'C:/failure.json']), /只能与 --prepare/);
  assert.throws(() => parseArgs(['--release-receipt', 'C:/r.json', '--prepare', '--resume-receipt', 'relative.json']), /必须提供绝对路径/);
  assert.throws(() => parseArgs(['--release-receipt', 'C:/r.json', '--activate', '--capacity-receipt', 'C:/c.json', '--resume-receipt', 'C:/failure.json']), /只能与 --prepare/);
});

test('capacity acceptance requires native matching revision and four successful official HTTP battles', () => {
  assert.deepEqual(validateCapacityReceipt(revision, capacityReceipt()), { sourceRevision: revision, sessions: 4, status: 'completed' });
  const cases = [
    [row => { row.status = 'failed'; }, /未成功/],
    [row => { row.sourceRevision = 'f'.repeat(40); }, /sourceRevision不一致/],
    [row => { row.concurrency = 2; }, /四并发/],
    [row => { row.sessions[0].createdViaHttp = false; }, /官方HTTP/],
    [row => { row.sessions[1].fight.diagnostics.errorCount = 1; }, /战斗未成功或含诊断/],
    [row => { row.sessions.pop(); }, /四个实际HTTP/],
    [row => { row.sessions[0].id = row.sessions[1].id; }, /缺失或重复/],
  ];
  for (const [mutate, error] of cases) {
    const receipt = capacityReceipt(); mutate(receipt);
    assert.throws(() => validateCapacityReceipt(revision, receipt), error);
  }
});

test('activation script fails closed on unknown paths and preserves exact rollback backups', () => {
  const script = activationScript(revision);
  for (const fragment of [
    '/opt/stronghold-protocol/releases/0123456789abcdef0123456789abcdef01234567',
    '/var/tmp/stronghold-protocol/resonance/stronghold-protocol.0123456789abcdef0123456789abcdef01234567.unit.backup',
    '/var/tmp/stronghold-protocol/resonance/stronghold-protocol.0123456789abcdef0123456789abcdef01234567.env.backup',
    'candidate-not-ordinary:', 'candidate-source-revision-mismatch', 'existing-release-manifest-mismatch:',
    'unknown-or-unsafe-existing-file:', 'SP_RESONANCE_DIRECTORY', 'previousRevision', 'rollbackPath',
    'timeout 25s systemctl restart', 'timeout 40s systemctl restart', 'systemctl daemon-reload', 'trap \'on_signal 143\' TERM',
    'trap \'on_signal 130\' INT', 'service-cwd-mismatch', 'health-timeout',
    'cp -p "$UNIT_BACKUP" "$UNIT"', 'cp -p "$ENV_BACKUP" "$ENVFILE"',
  ]) assert.ok(script.includes(fragment), `missing activation guard: ${fragment}`);
  const command = activationCommand(revision);
  assert.ok(command.args.includes('timeout 120s bash -s'));
  assert.ok(command.args.includes('ConnectTimeout=45'));
  assert.equal(command.timeoutMs, 180_000, 'leave a bounded rollback window after the 120 second remote cap');
  const shellSyntax = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
  assert.equal(shellSyntax.status, 0, shellSyntax.stderr);
  const nodeBlocks = [...script.matchAll(/<<'NODE'\n([\s\S]*?)\nNODE/g)].map(match => match[1]);
  assert.equal(nodeBlocks.length, 3);
  for (const [index, block] of nodeBlocks.entries()) new vm.Script(block, { filename: `activation-remote-${index}.js` });
  const preflight = preflightScript('1.0.0', revision, ['server/index.js', 'public/resonance.html']);
  assert.ok(preflight.includes('stronghold-protocol.0123456789abcdef0123456789abcdef01234567.unit.backup'));
  assert.ok(preflight.includes('staging-unknown:'));
  assert.equal(spawnSync('bash', ['-n'], { input: preflight, encoding: 'utf8' }).status, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-activation-test-'));
  try {
    const unitPath = path.join(dir, 'unit'); const envPath = path.join(dir, 'env');
    const releasePath = `/opt/stronghold-protocol/releases/${revision}`;
    const resonancePath = '/var/lib/stronghold-protocol/resonance-sessions';
    const originalUnit = '[Unit]\nDescription=Keep this\n[Service]\nUser=service-user\nWorkingDirectory=/opt/stronghold-protocol/releases/old\nExecStart=/usr/bin/node server/index.js\nRestart=always\n';
    const originalEnv = 'PORT=3000\nKEEP_THIS=value\nSP_RESONANCE_DIRECTORY=/old/state\n';
    fs.writeFileSync(unitPath, originalUnit); fs.writeFileSync(envPath, originalEnv);
    const apply = spawnSync(process.execPath, ['-', unitPath, envPath, releasePath, resonancePath], { input: nodeBlocks[0], encoding: 'utf8' });
    assert.equal(apply.status, 0, apply.stderr);
    const changedUnit = fs.readFileSync(unitPath, 'utf8');
    assert.ok(changedUnit.includes(`WorkingDirectory=${releasePath}\n`));
    assert.ok(changedUnit.includes(`ExecStart=/usr/bin/node ${releasePath}/server/index.js\n`));
    assert.ok(changedUnit.includes('User=service-user\n'));
    assert.ok(changedUnit.includes('Restart=always\n'));
    assert.equal(fs.readFileSync(envPath, 'utf8'), `PORT=3000\nKEEP_THIS=value\nSP_RESONANCE_DIRECTORY=${resonancePath}\n`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.throws(() => activationScript('short'), /full native Git commit/);
});
