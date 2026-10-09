import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { absolutePath, activationCommand, activationScript, capacityBatchCommand, capacityBatchReceiptFromStdout, capacityBatchScript, candidateRefreshPreflightScript, candidateRefreshScript, candidateSessionRefreshScript, archiveCompletedCapacityBatchScript, parseArgs, prepareLocalBatchReceiptPath, writeLocalBatchReceipt, preflightScript, preserveOldFailureCgroupScript, resumeVerificationScript, scpBatchArgs, validateCapacityReceipt, validatePrepareResumeReceipt, validateStagedReplacementRevision, validateCandidateRefreshRevisions, validateCandidateRefreshChangeSet, validateCandidateRefreshInvariantBytes } from '../../tools/resonance/deploy-candidate.mjs';

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

test('capacity batch is two bounded real HTTP phases and cleans only its declared files', () => {
  const parsed = parseArgs(['--release-receipt', 'C:/release.json', '--capacity-batch', '--local-capacity-receipt', 'E:/WindowsWorkspace/runtime/resonance/deployment/capacity-batch-receipt.json']);
  assert.equal(parsed.capacityBatch, true);
  assert.throws(() => parseArgs(['--release-receipt', 'C:/r.json', '--capacity-batch', '--local-capacity-receipt', 'relative.json']), /必须提供绝对路径/);
  const script = capacityBatchScript(revision);
  assert.equal((script.match(/--concurrency 4/g) || []).length, 2);
  assert.equal((script.match(/RuntimeMaxSec=480s/g) || []).length, 2);
  assert.equal((script.match(/MemoryMax=512M/g) || []).length, 2);
  assert.equal((script.match(/CPUQuota=100%/g) || []).length, 2);
  assert.match(script, /timeout --signal=TERM --kill-after=5s 520s/);
  assert.match(script, /memory\.max_usage_in_bytes/);
  assert.match(script, /memory\.peak/);
  assert.match(script, /\/proc\/self\/cgroup/);
  assert.match(script, /cpu\.stat/);
  assert.doesNotMatch(script, /systemctl show/);
  assert.match(script, /capacity-directory-has-unknown-or-nested-contents/);
  assert.match(script, /fuser/);
  assert.match(script, /capacity-session-directory-not-empty-after-clean/);
  const command = capacityBatchCommand(revision);
  assert.equal(command.args.at(-1), 'timeout 1080s bash -s');
  assert.equal(command.timeoutMs, 1_090_000);
  const bash = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8', windowsHide: true });
  if (!bash.error) assert.equal(bash.status, 0, bash.stderr);
});

test('capacity batch receipt requires both true four-session phases and real replay/cgroup evidence', () => {
  const phase = recording => ({
    capacity: { ...capacityReceipt(), recording, sessions: capacityReceipt().sessions.map(row => ({ ...row,
      ...(recording ? { replay: { verifiedViaHttp: true, frames: 3, gzipBytes: 4096 } } : {}) })) },
    cgroup: { unitResult: 'success', cpuUsageNSec: 1000, memoryPeakBytes: 4096 },
  });
  const receipt = { schema: 'resonance-capacity-batch-receipt/v1', sourceRevision: revision, status: 'completed',
    cleanup: { sessionDirectoryEmpty: true }, phases: [phase(false), phase(true)] };
  assert.deepEqual(capacityBatchReceiptFromStdout(`runner output\n${JSON.stringify(receipt)}`, revision), receipt);
  const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-batch-receipt-'));
  try {
    const receiptFile = path.join(localDir, 'capacity-batch-receipt.json');
    fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
    assert.deepEqual(capacityBatchReceiptFromStdout(fs.readFileSync(receiptFile, 'utf8'), revision), receipt);
    assert.deepEqual(capacityBatchReceiptFromStdout(`runner diagnostics\n${JSON.stringify(receipt)}`, revision), receipt);
  } finally { fs.rmSync(localDir, { recursive: true, force: true }); }
  assert.throws(() => capacityBatchReceiptFromStdout(JSON.stringify({ ...receipt, cleanup: { sessionDirectoryEmpty: false } }), revision), /终态\/清理校验/);
  const noReplay = structuredClone(receipt); noReplay.phases[1].capacity.sessions[0].replay.gzipBytes = 0;
  assert.throws(() => capacityBatchReceiptFromStdout(JSON.stringify(noReplay), revision), /replay证明/);
});

function completeBatchReceipt(rev, stage = '/var/tmp/stronghold-protocol/resonance') {
  const phase = (recording, index) => ({
    capacity: { ...capacityReceipt(), sourceRevision: rev, providedSourceRevision: rev, recording,
      sessions: capacityReceipt().sessions.map(row => ({ ...row, ...(recording ? { replay: { verifiedViaHttp: true, frames: 2, gzipBytes: 500 } } : {}) })) },
    cgroup: { recording, unit: `resonance-cap-${rev.slice(0, 12)}-${recording ? 'record' : 'http'}.service`,
      unitResult: 'success', runnerExitCode: 0, cpuUsageNSec: 1000 + index, memoryPeakBytes: 4096 + index,
      cgroupVersion: 2, cgroupPath: `/system.slice/resonance-cap-${rev.slice(0, 12)}-${recording ? 'record' : 'http'}.service`,
      receipt: `${stage}/${recording ? 'capacity-recording-receipt' : 'capacity-receipt'}.json` },
  });
  return { schema: 'resonance-capacity-batch-receipt/v1', sourceRevision: rev, status: 'completed',
    phases: [phase(false, 0), phase(true, 1)], cleanup: { sessionDirectoryEmpty: true } };
}

test('fixed local capacity receipt archives exact prior Native bytes, atomically writes next, and reuses same Native', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-capacity-receipt-'));
  const dir = path.join(root, 'runtime', 'resonance', 'deployment'); fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'capacity-batch-receipt.json');
  const oldRev = '1111111111111111111111111111111111111111';
  const newRev = '2222222222222222222222222222222222222222';
  try {
    const oldBytes = Buffer.from(`${JSON.stringify(completeBatchReceipt(oldRev), null, 4)}\n`);
    fs.writeFileSync(target, oldBytes);
    const prepared = prepareLocalBatchReceiptPath(target, newRev);
    assert.equal(prepared.reuse, false);
    assert.equal(fs.readFileSync(prepared.archivedPreviousReceipt).equals(oldBytes), true);
    assert.equal(fs.readFileSync(target).equals(oldBytes), true);
    writeLocalBatchReceipt(prepared.target, completeBatchReceipt(newRev));
    assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).sourceRevision, newRev);
    assert.equal(fs.readFileSync(prepared.archivedPreviousReceipt).equals(oldBytes), true);
    const reuse = prepareLocalBatchReceiptPath(target, newRev);
    assert.equal(reuse.reuse, true);
    assert.equal(reuse.receipt.sourceRevision, newRev);
    const unknownTarget = path.join(root, 'unknown', 'runtime', 'resonance', 'deployment', 'capacity-batch-receipt.json');
    fs.mkdirSync(path.dirname(unknownTarget), { recursive: true });
    fs.writeFileSync(unknownTarget, '{"status":"incomplete"}');
    assert.throws(() => prepareLocalBatchReceiptPath(unknownTarget, newRev), /Native|终态|source|旧Native/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
    [row => { row.artifactTransfers[1].status = 'transferred'; row.artifactTransfers[0].status = 'failed'; }, /失败档案后/],
    [row => { row.artifactTransfers[4].status = 'succeeded'; }, /status无效/],
  ]) {
    const invalid = prepareFailureFixture(release); mutate(invalid);
    assert.throws(() => validatePrepareResumeReceipt(release, invalid), pattern);
  }
  const batchFailure = prepareFailureFixture(release);
  batchFailure.artifactTransfers.forEach(row => { row.status = 'batch-transfer-unconfirmed'; });
  const retryAll = validatePrepareResumeReceipt(release, batchFailure);
  assert.equal(retryAll.skipped.length, 0);
  assert.equal(retryAll.completedNames.size, 0);
});

test('prepare batches only remaining SCP sources into one connection and reports unconfirmed batch truthfully', () => {
  const release = prepareReleaseFixture();
  const full = scpBatchArgs('C:/keys/server.pem', '62635', 'root@server.invalid', '/var/tmp/stronghold-protocol/resonance', release.artifacts);
  assert.deepEqual(full.slice(-6), [
    ...release.artifacts.map(row => row.path),
    'root@server.invalid:/var/tmp/stronghold-protocol/resonance/',
  ]);
  assert.equal(full.filter(value => value === '-P').length, 1);
  const remaining = scpBatchArgs('C:/keys/server.pem', '62635', 'root@server.invalid', '/var/tmp/stronghold-protocol/resonance', [release.artifacts[4]]);
  assert.deepEqual(remaining.slice(-2), [release.artifacts[4].path, 'root@server.invalid:/var/tmp/stronghold-protocol/resonance/']);
  const batchReceipt = prepareFailureFixture(release);
  batchReceipt.artifactTransfers.forEach(row => { row.status = 'batch-transfer-unconfirmed'; });
  assert.ok(batchReceipt.artifactTransfers.every(row => row.status !== 'transferred'));
  const rewritePreflight = preflightScript('1.0.0', revision, ['server/index.js'], { allowStagedReceiptOverwrite: true });
  assert.ok(rewritePreflight.includes('staging-receipt-not-ordinary:'));
  assert.ok(!rewritePreflight.includes('staging-source-revision-mismatch:'));
  assert.equal(spawnSync('bash', ['-n'], { input: rewritePreflight, encoding: 'utf8' }).status, 0);
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

test('staged Native replacement requires an existing different Git commit and only prepare mode', () => {
  const oldRevision = '9f5d25631d0aed9a6e1c3b6028f92e2aa7c400ec';
  assert.deepEqual(parseArgs(['--release-receipt', 'C:/new.json', '--prepare', '--replace-staged-revision', oldRevision]), {
    prepare: true, activate: false, receiptPath: 'C:/new.json', replaceStagedRevision: oldRevision,
  });
  assert.equal(validateStagedReplacementRevision(oldRevision, revision, requested => requested), oldRevision);
  assert.equal(validateStagedReplacementRevision(oldRevision, revision), oldRevision, 'the old revision must resolve in native Git');
  assert.throws(() => validateStagedReplacementRevision(oldRevision, oldRevision, requested => requested), /必须与新Native版本不同/);
  assert.throws(() => validateStagedReplacementRevision('not-a-commit', revision, requested => requested), /full Native/);
  assert.throws(() => parseArgs(['--release-receipt', 'C:/new.json', '--replace-staged-revision', oldRevision]), /只能与 --prepare/);
  assert.throws(() => parseArgs(['--release-receipt', 'C:/new.json', '--prepare', '--resume-receipt', 'C:/resume.json', '--replace-staged-revision', oldRevision]), /不能与 --resume-receipt/);
  assert.throws(() => parseArgs(['--release-receipt', 'C:/new.json', '--prepare', '--replace-staged-revision', 'short']), /完整Native Git commit/);
});

test('replacement preflight permits only an exact old Native staging receipt with no candidate or unknown paths', () => {
  const oldRevision = '9f5d25631d0aed9a6e1c3b6028f92e2aa7c400ec';
  const script = preflightScript('1.0.0', revision, ['server/index.js'], { replaceStagedRevision: oldRevision });
  assert.ok(script.includes('replacement-old-staging-revision-mismatch:'));
  assert.ok(script.includes('replacement-old-staging-receipt-missing-or-unsafe:'));
  assert.ok(script.includes('candidate-present-on-staged-replacement:'));
  assert.ok(script.includes('staging-unknown:'));
  assert.ok(script.includes('staging-file-unsafe:'));
  assert.ok(script.includes(`"replacedStagedRevision":"${oldRevision}"`));
  assert.ok(!script.includes('staging-source-revision-mismatch:'));
  assert.throws(() => preflightScript('1.0.0', revision, [], { replaceStagedRevision: revision }), /invalid staged replacement/);
  assert.throws(() => preflightScript('1.0.0', revision, [], { replaceStagedRevision: 'not-a-commit' }), /invalid staged replacement/);
  assert.equal(spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' }).status, 0);
});

test('candidate session refresh archives completed ee9e capacity receipts and changes only approved product sources', () => {
  const oldRevision = 'ee9e2d8b90f35a4d46705ad6d019ada9f684d94b';
  const newRevision = '1234567890abcdef1234567890abcdef12345678';
  const batchPath = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/resonance/deployment/capacity-batch-receipt.json';
  assert.deepEqual(parseArgs(['--release-receipt', 'C:/new.json', '--refresh-candidate', '--previous-release-receipt', 'C:/old.json', '--previous-capacity-batch-receipt', batchPath]), {
    prepare: false, activate: false, receiptPath: 'C:/new.json', refreshCandidate: true,
    previousReleaseReceiptPath: 'C:/old.json', previousCapacityBatchReceiptPath: batchPath,
  });
  assert.deepEqual(validateCandidateRefreshRevisions(oldRevision, newRevision, value => value), { oldRevision, newRevision });
  assert.throws(() => validateCandidateRefreshRevisions(oldRevision, oldRevision, value => value), /必须与新Native/);
  assert.throws(() => parseArgs(['--release-receipt', 'C:/new.json', '--refresh-candidate', '--previous-release-receipt', 'relative.json', '--previous-capacity-batch-receipt', batchPath]), /绝对路径/);
  assert.throws(() => parseArgs(['--release-receipt', 'C:/new.json', '--refresh-candidate', '--previous-release-receipt', 'C:/old.json']), /已完成容量批次/);
  assert.throws(() => parseArgs(['--release-receipt', 'C:/new.json', '--refresh-candidate', '--previous-release-receipt', 'C:/old.json', '--previous-capacity-batch-receipt', batchPath, '--prepare']), /不能同时使用/);

  const files = ['tools/resonance/capacity.mjs', 'public/css/resonance.css', 'server/modes/resonance/session.js', 'server/modes/resonance/display.js', 'public/js/resonance/game.js', 'public/js/resonance/model.js', 'server/index.js'];
  const selectedOldBytes = { 'tools/resonance/capacity.mjs': 'Y2Fub25pY2FsLW9sZC1ieXRlcw==', 'public/css/resonance.css': 'b2xkLWNzcw==' };
  const oldProductBytes = { 'server/modes/resonance/session.js': 'b2xkLXNlc3Npb24=', 'server/modes/resonance/display.js': 'b2xkLWRpc3BsYXk=', 'public/js/resonance/game.js': 'b2xkLWdhbWU=', 'public/js/resonance/model.js': 'b2xkLW1vZGVs', 'public/css/resonance.css': 'b2xkLWNzcw==' };
  assert.deepEqual(validateCandidateRefreshChangeSet(Object.keys(oldProductBytes).reverse()), Object.keys(oldProductBytes).sort());
  assert.throws(() => validateCandidateRefreshChangeSet([...Object.keys(oldProductBytes), 'server/index.js']), /exactly/);
  assert.throws(() => validateCandidateRefreshChangeSet(['server/modes/resonance/session.js']), /exactly/);
  assert.equal(validateCandidateRefreshInvariantBytes({ 'tools/resonance/capacity.mjs': Buffer.from('capacity-old'), 'public/css/resonance.css': Buffer.from('css-old') },
    { 'tools/resonance/capacity.mjs': Buffer.from('capacity-old'), 'public/css/resonance.css': Buffer.from('css-new') }), true);
  assert.throws(() => validateCandidateRefreshInvariantBytes({ 'tools/resonance/capacity.mjs': Buffer.from('capacity-old') },
    { 'tools/resonance/capacity.mjs': Buffer.from('capacity-new') }), /invariant differs from old Native: tools\/resonance\/capacity\.mjs/);
  const preflight = candidateRefreshPreflightScript({ oldRevision, newRevision, expectedFiles: files, selectedOldBytes });
  for (const fragment of ['candidate-native-not-expected-old', 'staged-native-not-expected-old', 'candidate-capacity-not-exact-old-native-bytes',
    'candidate-resonance-css-not-exact-old-native-bytes', 'candidate-inventory-mismatch', 'candidate-file-in-use-pid:', 'capacity-batch-receipt.json']) assert.ok(preflight.includes(fragment));
  assert.equal(spawnSync('bash', ['-n'], { input: preflight, encoding: 'utf8' }).status, 0);
  const refresh = candidateSessionRefreshScript(oldRevision, newRevision, files, selectedOldBytes, oldProductBytes);
  assert.ok(refresh.includes('.refresh-backup') && refresh.includes('trap rollback EXIT') && refresh.includes("trap 'exit 130' INT"));
  assert.ok(refresh.includes('new-capacity-must-remain-identical') && !refresh.includes('new-css-must-remain-identical') && Object.keys(oldProductBytes).every(file => refresh.includes(file)));
  assert.ok(refresh.includes('candidate-link-after-session-refresh') && refresh.includes('candidate-hardlink-after-session-refresh') && refresh.includes('fuser -f --'));
  assert.equal(spawnSync('bash', ['-n'], { input: refresh, encoding: 'utf8' }).status, 0);
  assert.throws(() => candidateRefreshPreflightScript({ oldRevision: newRevision, newRevision, expectedFiles: files, selectedOldBytes }), /invalid candidate refresh revisions/);
  assert.throws(() => candidateRefreshPreflightScript({ oldRevision, newRevision, expectedFiles: ['../unknown'], selectedOldBytes }), /invalid candidate refresh inventory/);
  const archive = archiveCompletedCapacityBatchScript(oldRevision);
  assert.ok(archive.includes(`capacity-batch-receipt.${oldRevision}.json`) && archive.includes(`capacity-recording-cgroup.${oldRevision}.json`));
  assert.ok(archive.includes('sessionDirectoryEmpty!==true') && archive.includes('concurrency!==4') && archive.includes('mv --'));
  assert.equal(spawnSync('bash', ['-n'], { input: archive, encoding: 'utf8' }).status, 0);
});

test('capacity receipt archive validates both native cgroup records against the completed batch schema', () => {
  const oldRevision = 'ee9e2d8b90f35a4d46705ad6d019ada9f684d94b';
  const stageToken = '__STAGE__';
  const batch = completeBatchReceipt(oldRevision, stageToken);
  const mismatchedHttp = { ...batch.phases[0].cgroup, cpuUsageNSec: batch.phases[0].cgroup.cpuUsageNSec + 1 };
  const script = archiveCompletedCapacityBatchScript(oldRevision)
    .replaceAll('/var/tmp/stronghold-protocol/resonance', stageToken)
    .replaceAll('/opt/stronghold-protocol/toolchain/node-v22.23.3-linux-x64/bin/node', 'node');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
  const wrapper = `set -euo pipefail
ROOT=$(mktemp -d /tmp/resonance-archive-schema.XXXXXX)
trap 'rm -rf -- "$ROOT"' EXIT
write64(){ printf '%s' "$2" | base64 -d > "$1"; }
run_case(){
 name="$1"; bad="$2"; d="$ROOT/$name"; S="$d/stage"; mkdir -p "$S"
 write64 "$S/capacity-receipt.json" '${encode({ ...batch.phases[0].capacity, sourceRevision: oldRevision })}'
 write64 "$S/capacity-recording-receipt.json" '${encode({ ...batch.phases[1].capacity, sourceRevision: oldRevision })}'
 write64 "$S/capacity-batch-receipt.json" '${encode(batch)}'
 if test "$bad" = yes; then write64 "$S/capacity-http-cgroup.json" '${encode(mismatchedHttp)}'; else write64 "$S/capacity-http-cgroup.json" '${encode(batch.phases[0].cgroup)}'; fi
 write64 "$S/capacity-recording-cgroup.json" '${encode(batch.phases[1].cgroup)}'
 WIN_STAGE=$(cygpath -m "$S")
 for f in capacity-batch-receipt.json capacity-http-cgroup.json capacity-recording-cgroup.json; do sed -i "s|${stageToken}|$WIN_STAGE|g" "$S/$f"; done
 printf '%s' '${Buffer.from(script).toString('base64')}' | base64 -d | sed "s|${stageToken}|$S|g" > "$d/archive.sh"
 if test "$bad" = yes; then
   set +e; PATH="$PATH" bash -x "$d/archive.sh" > "$d/out" 2> "$d/err"; rc=$?; set -e
   test "$rc" -ne 0
   for f in capacity-receipt.json capacity-recording-receipt.json capacity-batch-receipt.json capacity-http-cgroup.json capacity-recording-cgroup.json; do test -f "$S/$f" || exit 41; done
   test ! -e "$S/capacity-batch-receipt.${oldRevision}.json"
 else
   bash -x "$d/archive.sh" > "$d/out" 2> "$d/trace" || { tail -n 40 "$d/trace" >&2; exit 44; }
   bash -x "$d/archive.sh" > "$d/repeat.out" 2> "$d/repeat.trace" || { tail -n 40 "$d/repeat.trace" >&2; exit 45; }
   for f in capacity-receipt.${oldRevision}.json capacity-recording-receipt.${oldRevision}.json capacity-batch-receipt.${oldRevision}.json capacity-http-cgroup.${oldRevision}.json capacity-recording-cgroup.${oldRevision}.json; do test -f "$S/$f" || exit 42; done
   for f in capacity-receipt.json capacity-recording-receipt.json capacity-batch-receipt.json capacity-http-cgroup.json capacity-recording-cgroup.json; do test ! -e "$S/$f" || exit 43; done
 fi
}
run_case valid no
run_case mismatch yes
`;
  const result = spawnSync('bash', ['-euo', 'pipefail'], { input: wrapper, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('candidate five-source refresh updates all five files and rolls all five back on explicit post-write failure', () => {
  const oldRevision = 'ee9e2d8b90f35a4d46705ad6d019ada9f684d94b';
  const newRevision = '1234567890abcdef1234567890abcdef12345678';
  const expectedFiles = ['tools/resonance/capacity.mjs', 'public/css/resonance.css', 'server/modes/resonance/session.js',
    'server/modes/resonance/display.js', 'public/js/resonance/game.js', 'public/js/resonance/model.js', 'server/index.js'];
  const invariantOld = { 'tools/resonance/capacity.mjs': Buffer.from('capacity-old\n').toString('base64') };
  const oldProducts = Object.fromEntries(expectedFiles.filter(file => file.startsWith('server/modes/resonance/') || file.startsWith('public/js/resonance/') || file === 'public/css/resonance.css').map(file => [file, Buffer.from(`old:${file}\n`).toString('base64')]));
  const template = candidateSessionRefreshScript(oldRevision, newRevision, expectedFiles, invariantOld, oldProducts)
    .replaceAll('/opt/stronghold-protocol/releases/resonance-candidate', '__CANDIDATE__')
    .replaceAll('/var/tmp/stronghold-protocol/resonance', '__STAGING__')
    .replaceAll('/opt/stronghold-protocol/toolchain/node-v22.23.3-linux-x64/bin/node', '__NODE__');
  const templateBase64 = Buffer.from(template).toString('base64');
  const wrapper = `set -euxo pipefail
ROOT=$(mktemp -d /tmp/resonance-four-refresh.XXXXXX)
trap 'rm -rf -- "$ROOT"' EXIT
make_case(){
 mode="$1"; d="$ROOT/$mode"; C="$d/candidate"; S="$d/stage"; B="$d/bin"; F="$d/fixtures"; N="$B/node"; mkdir -p "$C" "$S" "$B" "$F"
 mkdir -p "$C/tools/resonance" "$C/public/css" "$C/server/modes/resonance" "$C/public/js/resonance" "$F/tools/resonance" "$F/public/css" "$F/server/modes/resonance" "$F/public/js/resonance"
 printf 'capacity-old\\n' > "$C/tools/resonance/capacity.mjs"; printf 'old:public/css/resonance.css\\n' > "$C/public/css/resonance.css"
 printf 'old:server/modes/resonance/session.js\\n' > "$C/server/modes/resonance/session.js"; printf 'old:server/modes/resonance/display.js\\n' > "$C/server/modes/resonance/display.js"
 printf 'old:public/js/resonance/game.js\\n' > "$C/public/js/resonance/game.js"; printf 'old:public/js/resonance/model.js\\n' > "$C/public/js/resonance/model.js"
 printf 'legacy\\n' > "$C/server/index.js"; printf 'zip-old\\n' > "$C/public/resonance-references.zip"; printf '{"sourceRevision":"${oldRevision}"}\\n' > "$C/.resonance-release-receipt.json"
 for f in server/modes/resonance/session.js server/modes/resonance/display.js public/js/resonance/game.js public/js/resonance/model.js public/css/resonance.css; do printf 'new:%s\\n' "$f" > "$F/$f"; done
 printf 'capacity-old\\n' > "$F/tools/resonance/capacity.mjs"
 printf 'archive\\n' > "$S/server-code.tar"; printf 'zip-new\\n' > "$S/resonance-references.zip"; printf '{"sourceRevision":"${newRevision}"}\\n' > "$S/server-release.json"
 cat > "$N" <<'NODE'
#!/bin/sh
last=''; for arg do last="$arg"; done
sed -n 's/.*"sourceRevision"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$last"
NODE
 cat > "$B/tar" <<'TAR'
#!/bin/sh
test "$1" = -xOf || exit 2
cat "$FIXTURE_ROOT/$3"
TAR
 cat > "$B/fuser" <<'FUSER'
#!/bin/sh
if test "\${FUSER_MODE:-1}" = 0; then echo 424242; exit 0; fi
exit 1
FUSER
 chmod +x "$N" "$B/tar" "$B/fuser"
 printf '%s' '${templateBase64}' | base64 -d | sed -e "s|__CANDIDATE__|$C|g" -e "s|__STAGING__|$S|g" -e "s|__NODE__|$N|g" > "$d/refresh.sh"
 if test "$mode" = success; then
  PATH="$B:/usr/bin:/bin" FIXTURE_ROOT="$F" FUSER_MODE=1 bash -x "$d/refresh.sh" > "$d/result.json" 2> "$d/trace.log"
  for f in server/modes/resonance/session.js server/modes/resonance/display.js public/js/resonance/game.js public/js/resonance/model.js public/css/resonance.css; do grep -q "new:$f" "$C/$f" || exit 31; done
  grep -q zip-new "$C/public/resonance-references.zip" || exit 32
  grep -q '${newRevision}' "$C/.resonance-release-receipt.json" || exit 33
  test -z "$(find "$C" -type f \\( -name '*.refresh-pending' -o -name '*.refresh-backup' \\) -print -quit)"
 else
  set +e; PATH="$B:/usr/bin:/bin" FIXTURE_ROOT="$F" FUSER_MODE=0 bash -x "$d/refresh.sh" > "$d/result.json" 2> "$d/error.log"; rc=$?; set -e
  test "$rc" -ne 0 || { tail -n 30 "$d/error.log" >&2; exit 36; }; grep -q 'candidate-file-in-use-after-session-refresh' "$d/error.log" || { tail -n 30 "$d/error.log" >&2; exit 36; }
  for f in server/modes/resonance/session.js server/modes/resonance/display.js public/js/resonance/game.js public/js/resonance/model.js public/css/resonance.css; do grep -q "old:$f" "$C/$f" || exit 34; done
  grep -q zip-old "$C/public/resonance-references.zip"; grep -q '${oldRevision}' "$C/.resonance-release-receipt.json"
  test -z "$(find "$C" -type f \\( -name '*.refresh-pending' -o -name '*.refresh-backup' \\) -print -quit)"
 fi
}
make_case success
make_case failure
`;
  const bash = spawnSync('bash', ['-euo', 'pipefail'], { input: wrapper, encoding: 'utf8', windowsHide: true, timeout: 90_000 });
  if (bash.error) {
    const trace = String(bash.stderr || '').split(/\r?\n/);
    throw new Error(`${bash.error.message}\n${trace.slice(-30).join('\n')}\n${bash.stdout}`);
  }
  assert.equal(bash.status, 0, bash.stderr || bash.stdout);
});

test('candidate refresh Bash transaction preserves exact bytes on success and restores originals on explicit exit', () => {
  const oldRevision = 'e890d97c2f044d085b6b1e22b41625e6390530b4';
  const newRevision = 'a81a93031e9d024ef44b2e2f4f2d3991b3605788';
  const expectedFiles = ['tools/resonance/capacity.mjs', 'public/css/resonance.css', 'server/index.js'];
  const oldCapacity = Buffer.from('old-capacity-bytes-with-trailing-newline\n');
  const oldCss = Buffer.from('old-css\n');
  const template = candidateRefreshScript(oldRevision, newRevision, expectedFiles)
    .replaceAll('/opt/stronghold-protocol/releases/resonance-candidate', '__CANDIDATE__')
    .replaceAll('/var/tmp/stronghold-protocol/resonance', '__STAGING__')
    .replaceAll('/opt/stronghold-protocol/toolchain/node-v22.23.3-linux-x64/bin/node', '__NODE__');
  const selectedOldBytes = { 'tools/resonance/capacity.mjs': oldCapacity.toString('base64'), 'public/css/resonance.css': oldCss.toString('base64') };
  const preflightTemplate = candidateRefreshPreflightScript({ oldRevision, newRevision, expectedFiles, selectedOldBytes })
    .replaceAll('/opt/stronghold-protocol/releases/resonance-candidate', '__CANDIDATE__')
    .replaceAll('/var/tmp/stronghold-protocol/resonance', '__STAGING__')
    .replaceAll('/opt/stronghold-protocol/toolchain/node-v22.23.3-linux-x64/bin/node', '__NODE__')
    .replace(/^for p in .*; do ordinary_dir .*exit 61; }; done$/m, 'for p in "$C" "$C/tools" "$C/tools/resonance" "$C/public" "$C/public/css" "$S"; do ordinary_dir "$p" || { echo "fixture-parent-invalid:$p" >&2; exit 61; }; done');
  const cgroupJson = `${JSON.stringify({ sourceRevision: oldRevision, unit: 'resonance-cap-e890d97c2f04-http.service', recording: false, runnerExitCode: 61, cpuUsageNSec: 5, memoryPeakBytes: 6 })}\n`;
  const cgroupBase64 = Buffer.from(cgroupJson).toString('base64');
  const cgroupTemplate = preserveOldFailureCgroupScript('observed-matching-e890-failure', cgroupBase64)
    .replaceAll('/var/tmp/stronghold-protocol/resonance', '__STAGING__');
  const wrapper = `set -euo pipefail
ROOT=$(mktemp -d /tmp/resonance-refresh-fixture.XXXXXX)
trap 'rm -rf -- "$ROOT"' EXIT
cat > "$ROOT/template.sh" <<'TEMPLATE'
${template}
TEMPLATE
cat > "$ROOT/preflight-template.sh" <<'PREFLIGHT'
${preflightTemplate}
PREFLIGHT
cat > "$ROOT/cgroup-template.sh" <<'CGROUP'
${cgroupTemplate}
CGROUP
make_case() {
  mode="$1"; d="$ROOT/$mode"; C="$d/candidate"; S="$d/stage"; B="$d/bin"; N="$B/node"
  mkdir -p "$C/tools/resonance" "$C/public/css" "$S" "$B"
  printf 'old-capacity-bytes-with-trailing-newline\\n' > "$C/tools/resonance/capacity.mjs"
  printf 'old-css\\n' > "$C/public/css/resonance.css"
  mkdir -p "$C/server"; printf 'old-server\\n' > "$C/server/index.js"
  printf '{"sourceRevision":"${oldRevision}"}\\n' > "$C/.resonance-release-receipt.json"
  printf 'old-reference\\n' > "$C/public/resonance-references.zip"
  printf 'new-capacity-bytes-with-trailing-newline\\n' > "$d/new-capacity"
  printf 'new-css\\n' > "$d/new-css"
  printf 'opaque-archive\\n' > "$S/server-code.tar"
  printf 'new-reference\\n' > "$S/resonance-references.zip"
  printf '{"sourceRevision":"${oldRevision}"}\\n' > "$S/server-release.json"
  if test "$mode" = success; then printf '%s' '${cgroupBase64}' | base64 -d > "$S/capacity-http-cgroup.json"; fi
  printf 'package\\n' > "$S/package.json"; printf 'lock\\n' > "$S/package-lock.json"
  cat > "$N" <<'NODE'
#!/bin/sh
shift
shift
for arg do last="$arg"; done
sed -n 's/.*"sourceRevision"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$last"
NODE
  cat > "$B/tar" <<'TAR'
#!/bin/sh
case "$3" in tools/resonance/capacity.mjs) cat "$FIXTURE_ROOT/new-capacity";; public/css/resonance.css) cat "$FIXTURE_ROOT/new-css";; *) exit 2;; esac
TAR
  cat > "$B/fuser" <<'FUSER'
#!/bin/sh
if test "\${FUSER_MODE:-1}" = 0; then echo '424242'; exit 0; fi
exit 1
FUSER
  chmod +x "$N" "$B/tar" "$B/fuser"
  sed -e "s|__CANDIDATE__|$C|g" -e "s|__STAGING__|$S|g" -e "s|__NODE__|$N|g" "$ROOT/template.sh" > "$d/refresh.sh"
  sed -e "s|__CANDIDATE__|$C|g" -e "s|__STAGING__|$S|g" -e "s|__NODE__|$N|g" "$ROOT/preflight-template.sh" > "$d/preflight.sh"
  sed -e "s|__STAGING__|$S|g" "$ROOT/cgroup-template.sh" > "$d/preserve-cgroup.sh"
  PATH="$B:/usr/bin:/bin" FIXTURE_STAGE="$S" FUSER_MODE=1 bash "$d/preflight.sh" > "$d/preflight.json"
  grep -q '"preflight":"ok"' "$d/preflight.json"
  set +e
  PATH="$B:/usr/bin:/bin" FIXTURE_STAGE="$S" FUSER_MODE=0 bash "$d/preflight.sh" > "$d/busy.json" 2> "$d/busy.err"
  busy_rc=$?
  set -e
  test "$busy_rc" -ne 0
  grep -q 'candidate-file-in-use-pid:424242' "$d/busy.err"
  if test "$mode" = success; then
    PATH="$B:/usr/bin:/bin" bash "$d/preserve-cgroup.sh" > "$d/cgroup.json"
    test ! -e "$S/capacity-http-cgroup.json"
    printf '%s' '${cgroupBase64}' | base64 -d | cmp -s - "$S/capacity-http-cgroup.e890d97c2f044d085b6b1e22b41625e6390530b4.json"
  fi
  printf '{"sourceRevision":"${newRevision}"}\\n' > "$S/server-release.json"
  printf 'new-reference\\n' > "$S/resonance-references.zip"
  if test "$mode" = success; then
    PATH="$B:/usr/bin:/bin" FIXTURE_STAGE="$S" FIXTURE_ROOT="$d" FUSER_MODE=1 bash "$d/refresh.sh" > "$d/out.json"
    grep -q '"refreshed":true' "$d/out.json"
    cmp -s "$d/new-capacity" "$C/tools/resonance/capacity.mjs"
    cmp -s "$d/new-css" "$C/public/css/resonance.css"
    cmp -s "$S/resonance-references.zip" "$C/public/resonance-references.zip"
    cmp -s "$S/server-release.json" "$C/.resonance-release-receipt.json"
  else
    set +e
    PATH="$B:/usr/bin:/bin" FIXTURE_STAGE="$S" FIXTURE_ROOT="$d" FUSER_MODE=0 bash "$d/refresh.sh" > "$d/out.json" 2> "$d/err.log"
    rc=$?
    set -e
    test "$rc" -ne 0
    printf 'old-capacity-bytes-with-trailing-newline\\n' | cmp -s - "$C/tools/resonance/capacity.mjs"
    printf 'old-css\\n' | cmp -s - "$C/public/css/resonance.css"
    printf 'old-reference\\n' | cmp -s - "$C/public/resonance-references.zip"
    printf '{"sourceRevision":"${oldRevision}"}\\n' | cmp -s - "$C/.resonance-release-receipt.json"
  fi
  test -z "$(find "$C" -type f \\( -name '*.refresh-backup' -o -name '*.refresh-pending' \\) -print)"
}
make_case success
make_case failure
`;
  const run = spawnSync('bash', ['-s'], { input: wrapper, encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
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
