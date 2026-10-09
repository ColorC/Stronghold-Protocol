#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOST = 'root@101.34.223.83';
const PORT = '62635';
const IDENTITY = 'C:/Users/lilithgames/Documents/my_server.pem';
const STAGING = '/var/tmp/stronghold-protocol/resonance';
const RULES = '/var/lib/stronghold-protocol/rules/4ed1ad32ec10da15c23f9d7939dade603950759b/data';
const INSTALL_ROOT = '/opt/stronghold-protocol';
const CANDIDATE = '/opt/stronghold-protocol/releases/resonance-candidate';
const SERVICE_UNIT = '/etc/systemd/system/stronghold-protocol.service';
const SERVICE_ENV = '/etc/stronghold-protocol.env';
const CAPACITY_SESSION = '/var/lib/stronghold-protocol/capacity-tests/resonance';
const CAPACITY_RECEIPT = `${STAGING}/capacity-receipt.json`;
const CAPACITY_RECORDING_RECEIPT = `${STAGING}/capacity-recording-receipt.json`;
const CAPACITY_BATCH_RECEIPT = `${STAGING}/capacity-batch-receipt.json`;
const CAPACITY_BATCH_ARCHIVE_NAMES = revision => [
  `capacity-receipt.${revision}.json`, `capacity-recording-receipt.${revision}.json`,
  `capacity-batch-receipt.${revision}.json`, `capacity-http-cgroup.${revision}.json`,
  `capacity-recording-cgroup.${revision}.json`,
];
const COMPLETED_CAPACITY_ARCHIVE_REVISIONS = [
  'ee9e2d8b90f35a4d46705ad6d019ada9f684d94b',
  '20c9011d0d4afe82ea5350aa6fddb463b0d6cf2d',
  '5fdd4abb283c47eabf6fe1f4c1fb406a2cfbc538',
];
const RESONANCE_DIRECTORY = '/var/lib/stronghold-protocol/resonance-sessions';
const BACKUP_ROOT = STAGING;
const SOURCE_RULES_REVISION = '4ed1ad32ec10da15c23f9d7939dade603950759b';
const REMOTE_NODE = `${INSTALL_ROOT}/toolchain/node-v22.23.3-linux-x64/bin/node`;
const REMOTE_NPM_CLI = `${INSTALL_ROOT}/toolchain/node-v22.23.3-linux-x64/lib/node_modules/npm/bin/npm-cli.js`;
const OWNED_STAGE_NAMES = ['server-code.tar', 'resonance-references.zip', 'package.json', 'package-lock.json', 'server-release.json'];
const CANDIDATE_REFRESH_SOURCES = ['server/modes/resonance/session.js', 'server/modes/resonance/display.js', 'server/modes/resonance/battle.js', 'server/hosting/staticDelivery.js', 'server/sim/content/resonance/kits.js', 'public/resonance.html', 'public/js/hostingBootstrap.js', 'public/js/hostingWait.js', 'public/js/resonance/game.js', 'public/js/resonance/model.js', 'public/js/resonance/panels.js', 'public/css/resonance.css'];
const CANDIDATE_REFRESH_INVARIANTS = ['tools/resonance/capacity.mjs'];
const WINDOWS_TAR = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe');
const TAR_COMMAND = process.platform === 'win32' && fs.existsSync(WINDOWS_TAR) ? WINDOWS_TAR : 'tar';
const HELP = `用法：node tools/resonance/deploy-candidate.mjs --release-receipt <绝对路径> [--prepare [--resume-receipt <失败回执绝对路径> | --replace-staged-revision <旧Native完整commit>] | --refresh-candidate --previous-release-receipt <旧receipt> --previous-capacity-batch-receipt <已完成回执> | --capacity-batch --local-capacity-receipt <绝对路径> | --activate --capacity-receipt <绝对路径> [--capacity-tested-revision <已测Native完整commit>]]\n--refresh-candidate只替换新旧Native间实际变化的获准共鸣源文件；容量回执可在核心源码未变时复用并保留其原测试版本。`;

export function parseArgs(argv) {
  const options = { prepare: false, activate: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--prepare') options.prepare = true;
    else if (value === '--dry-run') options.prepare = false;
    else if (value === '--activate') options.activate = true;
    else if (value === '--capacity-batch') options.capacityBatch = true;
    else if (value === '--refresh-candidate') options.refreshCandidate = true;
    else if (value === '--self-test') options.selfTest = true;
    else if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--release-receipt') {
      const next = argv[++i];
      if (!next || next.startsWith('--')) throw new Error('缺少 --release-receipt 路径');
      options.receiptPath = next;
    } else if (value === '--capacity-receipt') {
      const next = argv[++i];
      if (!next || next.startsWith('--')) throw new Error('缺少 --capacity-receipt 路径');
      options.capacityReceiptPath = next;
    } else if (value === '--capacity-tested-revision') {
      const next = argv[++i];
      if (!next || next.startsWith('--') || !/^[0-9a-f]{40}$/i.test(next)) throw new Error('--capacity-tested-revision 必须为完整Native Git commit');
      options.capacityTestedRevision = next.toLowerCase();
    } else if (value === '--local-capacity-receipt') {
      const next = argv[++i];
      if (!next || next.startsWith('--')) throw new Error('缺少 --local-capacity-receipt 路径');
      options.localCapacityReceiptPath = next;
    } else if (value === '--resume-receipt') {
      const next = argv[++i];
      if (!next || next.startsWith('--')) throw new Error('缺少 --resume-receipt 路径');
      options.resumeReceiptPath = next;
    } else if (value === '--replace-staged-revision') {
      const next = argv[++i];
      if (!next || next.startsWith('--')) throw new Error('缺少 --replace-staged-revision commit');
      if (!/^[0-9a-f]{40}$/i.test(next)) throw new Error('--replace-staged-revision 必须为完整Native Git commit');
      options.replaceStagedRevision = next.toLowerCase();
    } else if (value === '--previous-release-receipt') {
      const next = argv[++i];
      if (!next || next.startsWith('--')) throw new Error('缺少 --previous-release-receipt 路径');
      options.previousReleaseReceiptPath = next;
    } else if (value === '--failure-cgroup-receipt') {
      const next = argv[++i];
      if (!next || next.startsWith('--')) throw new Error('缺少 --failure-cgroup-receipt 路径');
      options.failureCgroupReceiptPath = next;
    } else if (value === '--previous-capacity-batch-receipt') {
      const next = argv[++i];
      if (!next || next.startsWith('--')) throw new Error('缺少 --previous-capacity-batch-receipt 路径');
      options.previousCapacityBatchReceiptPath = next;
    } else throw new Error(`未知参数：${value}`);
  }
  if ([options.prepare, options.activate, Boolean(options.capacityBatch), Boolean(options.refreshCandidate)].filter(Boolean).length > 1) throw new Error('--prepare、--refresh-candidate、--capacity-batch 与 --activate 不能同时使用');
  if (options.activate && !options.capacityReceiptPath) throw new Error('--activate 必须提供 --capacity-receipt');
  if (!options.activate && options.capacityReceiptPath) throw new Error('--capacity-receipt 只能与 --activate 一起使用');
  if (options.capacityTestedRevision && !options.activate) throw new Error('--capacity-tested-revision 只能与 --activate 一起使用');
  if (options.capacityBatch && !options.localCapacityReceiptPath) throw new Error('--capacity-batch 必须提供 --local-capacity-receipt');
  if (!options.capacityBatch && options.localCapacityReceiptPath) throw new Error('--local-capacity-receipt 只能与 --capacity-batch 一起使用');
  if (options.localCapacityReceiptPath && !path.isAbsolute(options.localCapacityReceiptPath)) throw new Error('--local-capacity-receipt 必须提供绝对路径');
  if (options.resumeReceiptPath && !options.prepare) throw new Error('--resume-receipt 只能与 --prepare 一起使用');
  if (options.resumeReceiptPath && !path.isAbsolute(options.resumeReceiptPath)) throw new Error('--resume-receipt 必须提供绝对路径');
  if (options.replaceStagedRevision && !options.prepare) throw new Error('--replace-staged-revision 只能与 --prepare 一起使用');
  if (options.replaceStagedRevision && options.resumeReceiptPath) throw new Error('--replace-staged-revision 不能与 --resume-receipt 共用');
  if (options.refreshCandidate && (!options.previousReleaseReceiptPath || !options.previousCapacityBatchReceiptPath)) throw new Error('--refresh-candidate 必须提供旧release与已完成容量批次回执');
  if (options.refreshCandidate && options.failureCgroupReceiptPath) throw new Error('--failure-cgroup-receipt已弃用；refresh需使用完整--previous-capacity-batch-receipt');
  if (options.previousReleaseReceiptPath && !options.refreshCandidate) throw new Error('--previous-release-receipt 只能与 --refresh-candidate 一起使用');
  if (options.failureCgroupReceiptPath && !options.refreshCandidate) throw new Error('--failure-cgroup-receipt 只能与 --refresh-candidate 一起使用');
  if (options.previousCapacityBatchReceiptPath && !options.refreshCandidate) throw new Error('--previous-capacity-batch-receipt 只能与 --refresh-candidate 一起使用');
  if (options.refreshCandidate && (options.resumeReceiptPath || options.replaceStagedRevision)) throw new Error('--refresh-candidate 不能与prepare续传/替换staging参数共用');
  for (const [key, label] of [['previousReleaseReceiptPath', '--previous-release-receipt'], ['failureCgroupReceiptPath', '--failure-cgroup-receipt'], ['previousCapacityBatchReceiptPath', '--previous-capacity-batch-receipt']]) {
    if (options[key] && !path.isAbsolute(options[key])) throw new Error(`${label} 必须提供绝对路径`);
  }
  return options;
}

export function absolutePath(value, label) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${label} 必须为绝对路径`);
  return path.resolve(value);
}

function checkedRegularFile(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`${label} 必须是普通单链接文件：${file}`);
  return file;
}

function validateArchiveListing(entries, verboseEntries) {
  for (const entry of entries) {
    const clean = entry.replaceAll('\\', '/');
    if (clean.startsWith('/') || clean.split('/').includes('..') || clean.split('/').some(part => ['data', 'assets', 'runtime'].includes(part)) || !/^[A-Za-z0-9_./-]+$/.test(clean)) {
      throw new Error(`server-code.tar含禁止或越界路径：${entry}`);
    }
  }
  const linked = verboseEntries.filter(line => /^[lh]/.test(line));
  if (linked.length) throw new Error(`server-code.tar含符号链接或硬链接：${linked[0]}`);
}

function gitRevision(revision) {
  if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/i.test(revision)) throw new Error('receipt缺少原生Git sourceRevision');
  const actual = execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', `${revision}^{commit}`], { encoding: 'utf8' }).trim();
  if (actual.toLowerCase() !== revision.toLowerCase()) throw new Error('sourceRevision无法解析为原生commit');
  return actual;
}

export function validateStagedReplacementRevision(oldRevision, newRevision, resolver = gitRevision) {
  if (!/^[0-9a-f]{40}$/i.test(oldRevision ?? '') || !/^[0-9a-f]{40}$/i.test(newRevision ?? '')) throw new Error('replacement requires full Native Git commits');
  const resolvedOld = resolver(oldRevision);
  if (String(resolvedOld).toLowerCase() !== oldRevision.toLowerCase()) throw new Error('replace staged revision无法解析为原生commit');
  if (resolvedOld.toLowerCase() === newRevision.toLowerCase()) throw new Error('replace staged revision必须与新Native版本不同');
  return resolvedOld;
}

export function validateCandidateRefreshRevisions(oldRevision, newRevision, resolver = gitRevision) {
  const resolvedOld = validateStagedReplacementRevision(oldRevision, newRevision, resolver);
  const resolvedNew = resolver(newRevision);
  if (String(resolvedNew).toLowerCase() !== newRevision.toLowerCase()) throw new Error('new Native release无法解析为原生commit');
  return { oldRevision: resolvedOld, newRevision: resolvedNew };
}

export function validateCandidateRefreshChangeSet(changedArchivePaths) {
  if (!Array.isArray(changedArchivePaths)) throw new Error('candidate refresh change set must be an array');
  const actual = [...new Set(changedArchivePaths)].sort();
  const allowed = new Set(CANDIDATE_REFRESH_SOURCES);
  if (actual.length === 0 || actual.some(value => !allowed.has(value))) throw new Error(`candidate refresh archive changes must be a nonempty subset of: ${[...allowed].sort().join(', ')}`);
  return actual;
}

export function validateCapacityReuseEvidence(testedRevision, releaseRevision, receipt, changedPaths) {
  const tested = String(testedRevision ?? '').toLowerCase();
  const release = String(releaseRevision ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(tested) || !/^[0-9a-f]{40}$/.test(release) || tested === release) throw new Error('capacity reuse requires distinct full Native revisions');
  const capacity = validateCapacityReceipt(tested, receipt);
  if (!Array.isArray(changedPaths)) throw new Error('capacity reuse requires a Native Git diff path list');
  const forbidden = changedPaths.filter(file => /^(server\/|shared\/|data\/)|(^|\/)package(?:-lock)?\.json$|^tools\/resonance\/capacity\.mjs$/.test(file));
  if (forbidden.length) throw new Error(`capacity reuse Native diff changes core paths: ${forbidden.sort().join(', ')}`);
  return { testedRevision: tested, releaseRevision: release, capacity, nativeUnchangedPaths: ['server/', 'shared/', 'data/', 'tools/resonance/capacity.mjs', 'package.json', 'package-lock.json'] };
}

export function validateCandidateRefreshInvariantBytes(oldNativeBytes, newNativeBytes) {
  for (const file of CANDIDATE_REFRESH_INVARIANTS) {
    if (!Buffer.isBuffer(oldNativeBytes?.[file]) || !Buffer.isBuffer(newNativeBytes?.[file])) throw new Error(`candidate refresh invariant bytes missing: ${file}`);
    if (!oldNativeBytes[file].equals(newNativeBytes[file])) throw new Error(`candidate refresh invariant differs from old Native: ${file}`);
  }
  return true;
}

export function candidateRefreshPreflightScript({ oldRevision, newRevision, expectedFiles, selectedOldBytes }) {
  if (!/^[0-9a-f]{40}$/i.test(oldRevision ?? '') || !/^[0-9a-f]{40}$/i.test(newRevision ?? '') || oldRevision.toLowerCase() === newRevision.toLowerCase()) throw new Error('invalid candidate refresh revisions');
  if (!Array.isArray(expectedFiles) || !expectedFiles.includes('tools/resonance/capacity.mjs') || expectedFiles.some(file => !/^[A-Za-z0-9_./-]+$/.test(file) || file.startsWith('/') || file.split('/').includes('..'))) throw new Error('invalid candidate refresh inventory');
  const selectedSources = [...CANDIDATE_REFRESH_INVARIANTS, 'public/css/resonance.css'];
  if (selectedSources.some(file => !expectedFiles.includes(file) || !/^[A-Za-z0-9+/=]+$/.test(selectedOldBytes?.[file] ?? ''))) throw new Error('refresh requires exact old-Native bytes for capacity.mjs and resonance.css');
  const expected = [...new Set([...expectedFiles, 'public/resonance-references.zip', '.resonance-release-receipt.json'])].sort();
  const expectedLines = expected.map(value => `'${value}'`).join(' ');
  const knownCapacityArchives = [...new Set([
    ...CAPACITY_BATCH_ARCHIVE_NAMES(oldRevision),
    ...COMPLETED_CAPACITY_ARCHIVE_REVISIONS.flatMap(CAPACITY_BATCH_ARCHIVE_NAMES),
    'stronghold-protocol.275375842f5426ccd53ebe0915f6b2883c919fe5.unit.backup',
    'stronghold-protocol.275375842f5426ccd53ebe0915f6b2883c919fe5.env.backup',
  ])].join('|');
  return `set -eu
C='${CANDIDATE}'
S='${STAGING}'
NODE='${REMOTE_NODE}'
OLD='${oldRevision}'
NEW='${newRevision}'
ordinary_dir() { test -d "$1" && test ! -L "$1"; }
for p in /opt /opt/stronghold-protocol /opt/stronghold-protocol/releases /var /var/tmp /var/tmp/stronghold-protocol "$S" "$C" "$C/tools" "$C/tools/resonance" "$C/public"; do ordinary_dir "$p" || { echo "refresh-parent-not-ordinary:$p" >&2; exit 61; }; done
test -f "$C/.resonance-release-receipt.json" && test ! -L "$C/.resonance-release-receipt.json" && test "$(stat -c %h "$C/.resonance-release-receipt.json")" -eq 1 || { echo 'candidate-old-receipt-unsafe' >&2; exit 62; }
candidate_revision=$("$NODE" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' "$C/.resonance-release-receipt.json")
test "$candidate_revision" = "$OLD" || { echo 'candidate-native-not-expected-old' >&2; exit 63; }
test -f "$S/server-release.json" && test ! -L "$S/server-release.json" && test "$(stat -c %h "$S/server-release.json")" -eq 1 || { echo 'staged-new-receipt-unsafe' >&2; exit 64; }
staged_revision=$("$NODE" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' "$S/server-release.json")
test "$staged_revision" = "$OLD" || { echo 'staged-native-not-expected-old' >&2; exit 65; }
for f in server-code.tar resonance-references.zip package.json package-lock.json server-release.json; do test -f "$S/$f" && test ! -L "$S/$f" && test "$(stat -c %h "$S/$f")" -eq 1 || { echo "staging-owned-file-unsafe:$S/$f" >&2; exit 66; }; done
for f in "$S"/*; do test -e "$f" || continue; case "$(basename "$f")" in server-code.tar|resonance-references.zip|package.json|package-lock.json|server-release.json|capacity-http-cgroup.json|capacity-http-cgroup.e890d97c2f044d085b6b1e22b41625e6390530b4.json|capacity-receipt.json|capacity-recording-receipt.json|capacity-batch-receipt.json|capacity-recording-cgroup.json|${knownCapacityArchives}) test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "staging-unknown-or-unsafe:$f" >&2; exit 67; };; *) echo "staging-unknown:$f" >&2; exit 67;; esac; done
links=$(find "$C" -type l -print -quit); test -z "$links" || { echo "candidate-link:$links" >&2; exit 68; }
hard=$(find "$C" -type f -exec sh -c 'for f do test "$(stat -c %h "$f")" -eq 1 || { echo "$f"; exit 1; }; done' sh {} +) || { echo "candidate-hardlink:$hard" >&2; exit 68; }
actual=$(find "$C" -type f -printf '%P\\n' | sort)
expected=$(printf '%s\\n' ${expectedLines} | sort)
test "$actual" = "$expected" || { echo 'candidate-inventory-mismatch' >&2; printf '%s\\n' "$actual" >&2; exit 69; }
command -v fuser >/dev/null 2>&1 || { echo 'fuser-required' >&2; exit 70; }
mapfile -d '' candidate_files < <(find "$C" -type f -print0)
set +e
fuser_output=$(fuser -f -- "\${candidate_files[@]}" 2>/dev/null)
fuser_status=$?
set -e
if test "$fuser_status" -eq 0; then
  fuser_pids=$(printf '%s\\n' "$fuser_output" | grep -oE '[0-9]+' | sort -u || true)
  test -n "$fuser_pids" || { echo 'fuser-output-unparseable' >&2; exit 71; }
  for pid in $fuser_pids; do
    cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
    argv=$(tr '\\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    if { test "$pid" = "$$" || test "$pid" = "$PPID"; } && case "$cwd:$argv" in *"$C"*) false;; *) true;; esac; then continue; fi
    echo "candidate-file-in-use-pid:$pid cwd=$cwd argvCandidatePathPresent=$([[ "$argv" == *"$C"* ]] && echo yes || echo no)" >&2; exit 71
  done
elif test "$fuser_status" -ne 1; then echo 'fuser-error' >&2; exit 72; fi
proc_refs=$(grep -laF -e "$C" /proc/[0-9]*/cmdline 2>/dev/null || true)
for cmdline in $proc_refs; do pid=\${cmdline#/proc/}; pid=\${pid%%/*}; cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true); argv=$(tr '\\0' ' ' < "$cmdline" 2>/dev/null || true); if { test "$pid" = "$$" || test "$pid" = "$PPID"; } && case "$cwd:$argv" in *"$C"*) false;; *) true;; esac; then continue; fi; echo "candidate-process-reference-pid:$pid cwd=$cwd argvCandidateSourcePresent=yes" >&2; exit 71; done
cwd_refs=$(find /proc -mindepth 2 -maxdepth 2 -type l -name cwd -lname "$C*" -print 2>/dev/null || true)
for cwdlink in $cwd_refs; do pid=\${cwdlink#/proc/}; pid=\${pid%%/*}; cwd=$(readlink -f "$cwdlink" 2>/dev/null || true); argv=$(tr '\\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true); if { test "$pid" = "$$" || test "$pid" = "$PPID"; } && case "$cwd:$argv" in *"$C"*) false;; *) true;; esac; then continue; fi; echo "candidate-process-reference-pid:$pid cwd=$cwd argvCandidateSourcePresent=$([[ "$argv" == *"$C"* ]] && echo yes || echo no)" >&2; exit 71; done
printf '%s' '${selectedOldBytes['tools/resonance/capacity.mjs']}' | base64 -d | cmp -s - "$C/tools/resonance/capacity.mjs" || { echo 'candidate-capacity-not-exact-old-native-bytes' >&2; exit 73; }
printf '%s' '${selectedOldBytes['public/css/resonance.css']}' | base64 -d | cmp -s - "$C/public/css/resonance.css" || { echo 'candidate-resonance-css-not-exact-old-native-bytes' >&2; exit 73; }
printf '{"preflight":"ok","oldRevision":"%s","newRevision":"%s","candidate":"%s"}\\n' "$OLD" "$NEW" "$C"`;
}

export function candidateRefreshScript(oldRevision, newRevision, expectedFiles = ['tools/resonance/capacity.mjs', 'server/index.js']) {
  if (!/^[0-9a-f]{40}$/i.test(oldRevision ?? '') || !/^[0-9a-f]{40}$/i.test(newRevision ?? '') || oldRevision.toLowerCase() === newRevision.toLowerCase()) throw new Error('invalid candidate refresh revisions');
  if (!Array.isArray(expectedFiles) || expectedFiles.some(file => !/^[A-Za-z0-9_./-]+$/.test(file) || file.startsWith('/') || file.split('/').includes('..'))) throw new Error('invalid candidate refresh final inventory');
  const expected = [...new Set([...expectedFiles, 'public/resonance-references.zip', '.resonance-release-receipt.json'])].sort();
  const expectedLines = expected.map(value => `'${value}'`).join(' ');
  const sourceFiles = ['tools/resonance/capacity.mjs', 'public/css/resonance.css'];
  if (sourceFiles.some(file => !expectedFiles.includes(file))) throw new Error('refresh archive must contain the selected capacity and resonance CSS files');
  const files = [...sourceFiles, 'public/resonance-references.zip', '.resonance-release-receipt.json'];
  const backups = files.map(file => `${CANDIDATE}/${file}.refresh-backup`);
  const pending = files.map(file => `${CANDIDATE}/${file}.refresh-pending`);
  const extractSelected = sourceFiles.map((file, index) => `tar -xOf "$S/server-code.tar" '${file}' > '${pending[index]}'`).join('\n');
  const moveTargets = files.map((file, index) => `mv -f '${pending[index]}' '${CANDIDATE}/${file}'`).join('\n');
  const updatedFiles = JSON.stringify(files);
  return `set -eu
C='${CANDIDATE}'
S='${STAGING}'
OLD='${oldRevision}'
NEW='${newRevision}'
files='${files.map(file => `${CANDIDATE}/${file}`).join(' ')}'
backups='${backups.join(' ')}'
pending='${pending.join(' ')}'
committed=0
rollback() { rc=$?; trap - EXIT INT TERM; if test "$committed" -ne 1; then set +e; for f in $files; do b="$f.refresh-backup"; if test -f "$b" && test ! -L "$b" && test "$(stat -c %h "$b")" -eq 1; then mv -f -- "$b" "$f"; fi; p="$f.refresh-pending"; if test -f "$p" && test ! -L "$p" && test "$(stat -c %h "$p")" -eq 1; then rm -- "$p"; fi; done; fi; exit "$rc"; }
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
test "$("${REMOTE_NODE}" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' "$C/.resonance-release-receipt.json")" = "$OLD" || { echo 'candidate-native-changed-before-refresh' >&2; exit 81; }
test "$("${REMOTE_NODE}" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' "$S/server-release.json")" = "$NEW" || { echo 'staged-native-changed-before-refresh' >&2; exit 81; }
for f in $files; do test ! -e "$f.refresh-backup" && test ! -e "$f.refresh-pending" || { echo "refresh-temp-already-exists:$f" >&2; exit 82; }; cp -p "$f" "$f.refresh-backup"; done
${extractSelected}
cp -p "$S/resonance-references.zip" '${pending[2]}'
cp -p "$S/server-release.json" '${pending[3]}'
for f in ${pending.join(' ')}; do test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "refresh-pending-invalid:$f" >&2; exit 83; }; done
${moveTargets}
test "$("${REMOTE_NODE}" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' "$C/.resonance-release-receipt.json")" = "$NEW" || { echo 'new-candidate-receipt-mismatch' >&2; exit 84; }
${sourceFiles.map(file => `tar -xOf "$S/server-code.tar" '${file}' | cmp -s - "$C/${file}" || { echo 'new-source-bytes-mismatch:${file}' >&2; exit 85; }`).join('\n')}
cmp -s "$S/resonance-references.zip" "$C/public/resonance-references.zip" || { echo 'new-reference-bytes-mismatch' >&2; exit 85; }
cmp -s "$S/server-release.json" "$C/.resonance-release-receipt.json" || { echo 'new-manifest-bytes-mismatch' >&2; exit 85; }
for f in $files; do test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "refreshed-file-invalid:$f" >&2; exit 86; }; fuser -s -- "$f" 2>/dev/null && { echo "refreshed-file-in-use:$f" >&2; exit 87; } || status=$?; test "\${status:-1}" -eq 1 || { echo "fuser-error:$f" >&2; exit 88; }; unset status; done
links=$(find "$C" -type l -print -quit); test -z "$links" || { echo "candidate-link-after-refresh:$links" >&2; exit 89; }
hard=$(find "$C" -type f ! -name '*.refresh-backup' -exec sh -c 'for f do test "$(stat -c %h "$f")" -eq 1 || { echo "$f"; exit 1; }; done' sh {} +) || { echo "candidate-hardlink-after-refresh:$hard" >&2; exit 89; }
actual=$(find "$C" -type f ! -name '*.refresh-backup' -printf '%P\\n' | sort)
expected=$(printf '%s\\n' ${expectedLines} | sort)
test "$actual" = "$expected" || { echo 'candidate-inventory-after-refresh-mismatch' >&2; exit 89; }
committed=1
for f in $files; do rm -- "$f.refresh-backup"; done
actual=$(find "$C" -type f -printf '%P\\n' | sort)
test "$actual" = "$expected" || { echo 'candidate-final-inventory-mismatch' >&2; exit 89; }
links=$(find "$C" -type l -print -quit); test -z "$links" || { echo "candidate-final-link:$links" >&2; exit 89; }
hard=$(find "$C" -type f -exec sh -c 'for f do test "$(stat -c %h "$f")" -eq 1 || { echo "$f"; exit 1; }; done' sh {} +) || { echo "candidate-final-hardlink:$hard" >&2; exit 89; }
printf '{"refreshed":true,"candidate":"%s","previousRevision":"%s","sourceRevision":"%s","updatedFiles":%s}\\n' "$C" "$OLD" "$NEW" '${updatedFiles}'`;
}

export function archiveCompletedCapacityBatchScript(oldRevision) {
  if (!/^[0-9a-f]{40}$/i.test(oldRevision ?? '')) throw new Error('invalid old capacity Native revision');
  const sources = [CAPACITY_RECEIPT, CAPACITY_RECORDING_RECEIPT, CAPACITY_BATCH_RECEIPT,
    `${STAGING}/capacity-http-cgroup.json`, `${STAGING}/capacity-recording-cgroup.json`];
  const targets = CAPACITY_BATCH_ARCHIVE_NAMES(oldRevision).map(name => `${STAGING}/${name}`);
  const batchCheck = `
const fs=require('fs');const [file,rev,index,stage]=process.argv.slice(2);const r=JSON.parse(fs.readFileSync(file,'utf8'));const fail=m=>{console.error('capacity-archive-invalid:'+m);process.exit(1)};
if(index==='0'||index==='1'){if(r.status!=='completed'||r.sourceRevision!==rev||r.concurrency!==4||r.sessions?.length!==4)fail('capacity-receipt');if(r.recording!==(index==='1'))fail('capacity-recording-flag');}
if(index==='2'||index==='3'||index==='4'){
 const util=require('util');const batchPaths=[stage+'/capacity-batch-receipt.json',stage+'/capacity-batch-receipt.'+rev+'.json'];const batchPath=batchPaths.find(p=>fs.existsSync(p));if(!batchPath)fail('batch-receipt-missing');
 const batch=JSON.parse(fs.readFileSync(batchPath,'utf8'));if(batch.schema!=='resonance-capacity-batch-receipt/v1'||batch.status!=='completed'||batch.sourceRevision!==rev||batch.phases?.length!==2||batch.cleanup?.sessionDirectoryEmpty!==true)fail('batch-receipt-terminal');
 if(index==='2'){
  for(let p=0;p<2;p++){const c=batch.phases[p]?.cgroup;const unit='resonance-cap-'+rev.slice(0,12)+'-'+(p===1?'record':'http')+'.service';const expectedReceipt=stage+(p===1?'/capacity-recording-receipt.json':'/capacity-receipt.json');const fields=[['recording',c?.recording===(p===1)],['unit',c?.unit===unit],['unitResult',c?.unitResult==='success'],['runnerExitCode',c?.runnerExitCode===0],['cgroupVersion',[1,2].includes(c?.cgroupVersion)],['cgroupPath',c?.cgroupPath==='/system.slice/'+unit],['receipt',c?.receipt===expectedReceipt],['cpuUsageNSec',c?.cpuUsageNSec>0],['memoryPeakBytes',c?.memoryPeakBytes>0]];const bad=fields.find(([,ok])=>!ok);if(bad)fail('batch-cgroup-'+p+'-'+bad[0]+(bad[0]==='receipt'?'-got='+c?.receipt+'-expected='+expectedReceipt:''));}
 }else{
  const p=index==='3'?0:1;const expected=batch.phases[p].cgroup;const recording=p===1;
  if(!util.isDeepStrictEqual(r,expected)||r.recording!==recording||r.unit!=='resonance-cap-'+rev.slice(0,12)+'-'+(recording?'record':'http')+'.service'||r.unitResult!=='success'||r.runnerExitCode!==0||![1,2].includes(r.cgroupVersion)||r.cgroupPath!=='/system.slice/'+r.unit||r.receipt!==stage+(recording?'/capacity-recording-receipt.json':'/capacity-receipt.json')||!(r.cpuUsageNSec>0)||!(r.memoryPeakBytes>0))fail('cgroup-file-mismatch-'+p);
 }
}
`;
  const checks = sources.map((source, i) => `
src='${source}'; dst='${targets[i]}';
if test -e "$src" || test -L "$src"; then
  test ! -e "$dst" && test ! -L "$dst" || { echo 'capacity-archive-source-and-target-exist' >&2; exit 91; }
  test -f "$src" && test ! -L "$src" && test "$(stat -c %h "$src")" -eq 1 || { echo 'capacity-source-unsafe' >&2; exit 92; }
  "$NODE" - "$src" '${oldRevision}' '${i}' '${STAGING}' <<'CHECK_CAP'
${batchCheck}
CHECK_CAP
else
  test -f "$dst" && test ! -L "$dst" && test "$(stat -c %h "$dst")" -eq 1 || { echo 'capacity-archive-missing-or-unsafe' >&2; exit 93; }
  "$NODE" - "$dst" '${oldRevision}' '${i}' '${STAGING}' <<'CHECK_CAP'
${batchCheck}
CHECK_CAP
fi`).join('');
  return `set -eu\nNODE='${REMOTE_NODE}'\n${checks}\n${sources.map((source, i) => `if test -e '${source}'; then mv -- '${source}' '${targets[i]}'; fi\n`).join('')}\nfor f in ${targets.map(v => `'${v}'`).join(' ')}; do test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || exit 94; done\nprintf '{"archived":true,"sourceRevision":"${oldRevision}","files":${JSON.stringify(targets)}}\\n'`;
}

export function candidateSessionRefreshScript(oldRevision, newRevision, expectedFiles, unchangedOldBytes, oldSelectedBytes, selectedSources = CANDIDATE_REFRESH_SOURCES) {
  for (const r of [oldRevision, newRevision]) if (!/^[0-9a-f]{40}$/i.test(r ?? '')) throw new Error('invalid candidate session refresh revision');
  if (oldRevision.toLowerCase() === newRevision.toLowerCase()) throw new Error('candidate session refresh Native revisions must differ');
  const update = validateCandidateRefreshChangeSet(selectedSources);
  const referenceIndex = update.length;
  const manifestIndex = update.length + 1;
  const invariant = CANDIDATE_REFRESH_INVARIANTS;
  if (!Array.isArray(expectedFiles) || [...update, ...invariant].some(f => !expectedFiles.includes(f))) throw new Error('new archive lacks selected or invariant source');
  if (update.some(f => !/^[A-Za-z0-9+/=]+$/.test(oldSelectedBytes?.[f] ?? '')) || invariant.some(f => !/^[A-Za-z0-9+/=]+$/.test(unchangedOldBytes?.[f] ?? ''))) throw new Error('session refresh requires exact old Native bytes');
  const files = [...update, 'public/resonance-references.zip', '.resonance-release-receipt.json'];
  const backups = files.map(f => `${CANDIDATE}/${f}.refresh-backup`);
  const pending = files.map(f => `${CANDIDATE}/${f}.refresh-pending`);
  const expected = [...expectedFiles, 'public/resonance-references.zip', '.resonance-release-receipt.json'].sort();
  return `set -eu
C='${CANDIDATE}'; S='${STAGING}'; OLD='${oldRevision}'; NEW='${newRevision}'; NODE='${REMOTE_NODE}'
files='${files.map(f => `${CANDIDATE}/${f}`).join(' ')}'; committed=0
rollback(){ rc=$?; trap - EXIT INT TERM; if test "$committed" -ne 1; then set +e; for f in $files; do b="$f.refresh-backup"; p="$f.refresh-pending"; if test -f "$b" && test ! -L "$b" && test "$(stat -c %h "$b")" -eq 1; then mv -- "$b" "$f"; fi; if test -f "$p" && test ! -L "$p" && test "$(stat -c %h "$p")" -eq 1; then rm -- "$p"; fi; done; fi; exit "$rc"; }
trap rollback EXIT; trap 'exit 130' INT; trap 'exit 143' TERM
test "$("$NODE" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' "$C/.resonance-release-receipt.json")" = "$OLD" || exit 81
test "$("$NODE" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' "$S/server-release.json")" = "$NEW" || exit 82
${update.map(f => `printf '%s' '${oldSelectedBytes[f]}' | base64 -d | cmp -s - "$C/${f}" || { echo 'candidate-product-source-not-exact-old-native:${f}' >&2; exit 83; }`).join('\n')}
${invariant.map(f => `printf '%s' '${unchangedOldBytes[f]}' | base64 -d | cmp -s - "$C/${f}" || { echo 'candidate-invariant-differs:${f}' >&2; exit 83; }`).join('\n')}
for f in $files; do test ! -e "$f.refresh-backup" && test ! -e "$f.refresh-pending" || exit 84; cp -p -- "$f" "$f.refresh-backup"; done
${update.map((f, i) => `tar -xOf "$S/server-code.tar" '${f}' > '${pending[i]}'`).join('\n')}
tar -xOf "$S/server-code.tar" 'tools/resonance/capacity.mjs' | cmp -s - "$C/tools/resonance/capacity.mjs" || { echo 'new-capacity-must-remain-identical' >&2; exit 85; }
cp -p "$S/resonance-references.zip" '${pending[referenceIndex]}'; cp -p "$S/server-release.json" '${pending[manifestIndex]}'
for f in ${pending.map(f => `'${f}'`).join(' ')}; do test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || exit 86; done
${update.map((f, i) => `mv -- '${pending[i]}' '${CANDIDATE}/${f}'`).join('\n')}
mv -- '${pending[referenceIndex]}' '${CANDIDATE}/public/resonance-references.zip'; mv -- '${pending[manifestIndex]}' '${CANDIDATE}/.resonance-release-receipt.json'
test "$("$NODE" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' "$C/.resonance-release-receipt.json")" = "$NEW" || exit 87
${update.map(f => `tar -xOf "$S/server-code.tar" '${f}' | cmp -s - "$C/${f}" || exit 87`).join('\n')}
cmp -s "$S/resonance-references.zip" "$C/public/resonance-references.zip" || exit 87; cmp -s "$S/server-release.json" "$C/.resonance-release-receipt.json" || exit 87
actual=$(find "$C" -type f ! -name '*.refresh-backup' -printf '%P\\n' | sort); expected=$(printf '%s\\n' ${expected.map(f => `'${f}'`).join(' ')} | sort); test "$actual" = "$expected" || exit 88
links=$(find "$C" -type l -print -quit); test -z "$links" || { echo "candidate-link-after-session-refresh:$links" >&2; exit 89; }
hard=$(find "$C" -type f -exec sh -c 'for f do test "$(stat -c %h "$f")" -eq 1 || { echo "$f"; exit 1; }; done' sh {} +) || { echo "candidate-hardlink-after-session-refresh:$hard" >&2; exit 89; }
command -v fuser >/dev/null 2>&1 || { echo 'fuser-required-after-session-refresh' >&2; exit 90; }
mapfile -d '' candidate_files < <(find "$C" -type f -print0)
set +e; fuser_output=$(fuser -f -- "\${candidate_files[@]}" 2>/dev/null); fuser_status=$?; set -e
if test "$fuser_status" -eq 0; then echo "candidate-file-in-use-after-session-refresh:$fuser_output" >&2; exit 90; elif test "$fuser_status" -ne 1; then echo 'fuser-error-after-session-refresh' >&2; exit 90; fi
committed=1; for f in $files; do rm -- "$f.refresh-backup"; done
printf '{"refreshed":true,"candidate":"%s","previousRevision":"%s","sourceRevision":"%s","updatedFiles":%s}\\n' "$C" "$OLD" "$NEW" '${JSON.stringify(files)}'`;
}

export function preserveOldFailureCgroupScript(status, cgroupBase64) {
  const oldName = `${STAGING}/capacity-http-cgroup.json`;
  const archiveName = `${STAGING}/capacity-http-cgroup.e890d97c2f044d085b6b1e22b41625e6390530b4.json`;
  if (!['observed-matching-e890-failure', 'already-preserved-matching-e890-failure'].includes(status) || !/^[A-Za-z0-9+/=]+$/.test(cgroupBase64 ?? '')) throw new Error('invalid failure cgroup preservation input');
  const source = status === 'observed-matching-e890-failure' ? oldName : archiveName;
  const move = status === 'observed-matching-e890-failure'
    ? `test ! -e '${archiveName}' && test ! -L '${archiveName}' || { echo 'failure-cgroup-archive-exists' >&2; exit 91; }; mv -- '${oldName}' '${archiveName}'`
    : `test -f '${archiveName}' && test ! -L '${archiveName}' || { echo 'failure-cgroup-archive-missing' >&2; exit 91; }`;
  return `set -euo pipefail
src='${source}'
printf '%s' '${cgroupBase64}' | base64 -d | cmp -s - "$src" || { echo 'failure-cgroup-bytes-changed' >&2; exit 90; }
test -f "$src" && test ! -L "$src" && test "$(stat -c %h "$src")" -eq 1 || { echo 'failure-cgroup-unsafe' >&2; exit 90; }
${move}
test -f '${archiveName}' && test ! -L '${archiveName}' && test "$(stat -c %h '${archiveName}')" -eq 1 || { echo 'failure-cgroup-preservation-failed' >&2; exit 92; }
printf '{"preserved":true,"path":"%s","source":"%s"}\\n' '${archiveName}' '${oldName}'`;
}

function readReleaseReceipt(receiptPath) {
  checkedRegularFile(receiptPath, 'release receipt');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const sourceRevision = gitRevision(receipt.sourceRevision);
  const artifacts = receipt.artifacts ?? [];
  const byName = name => {
    const item = artifacts.find(value => path.basename(String(value?.path ?? '')) === name);
    if (!item || typeof item.path !== 'string' || !path.isAbsolute(item.path)) throw new Error(`release receipt缺少绝对路径档案：${name}`);
    checkedRegularFile(item.path, `release artifact ${name}`);
    return { path: path.resolve(item.path), role: item.role ?? '' };
  };
  const code = byName('server-code.tar');
  if (receipt.reusesExistingRules !== true || receipt.rulesRevision !== SOURCE_RULES_REVISION) {
    throw new Error(`release receipt必须声明复用既有rules且rulesRevision=${SOURCE_RULES_REVISION}`);
  }
  const references = byName('resonance-references.zip');
  const packageJson = byName('package.json');
  const packageLock = byName('package-lock.json');
  if (!String(code.role).includes('code archive') || !String(references.role).includes('reference')) throw new Error('release receipt档案role与预期不符');
  const manifest = JSON.parse(fs.readFileSync(packageJson.path, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(packageLock.path, 'utf8'));
  const wsVersion = receipt.dependencyVersion?.ws;
  if (typeof wsVersion !== 'string' || !/^[0-9A-Za-z.+-]+$/.test(wsVersion)
    || manifest.dependencies?.ws !== wsVersion || lock.packages?.['node_modules/ws']?.version !== wsVersion) {
    throw new Error('release receipt、package.json与package-lock.json的ws版本不一致');
  }
  const listing = execFileSync(TAR_COMMAND, ['-tf', code.path], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  if (!listing.includes('server/index.js') || !listing.includes('public/resonance.html')) throw new Error('server-code.tar缺少共鸣服务入口');
  const verbose = execFileSync(TAR_COMMAND, ['-tvf', code.path], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  validateArchiveListing(listing, verbose);
  return { sourceRevision, receiptPath, code, references, packageJson, packageLock, wsVersion,
    artifacts: [{ path: receiptPath, role: 'native builder receipt' }, code, references, packageJson, packageLock] };
}

export function validatePrepareResumeReceipt(release, receipt) {
  if (!receipt || receipt.mode !== 'prepare' || receipt.status !== 'failed') throw new Error('resume receipt必须是失败的prepare回执');
  if (String(receipt.sourceRevision ?? '').toLowerCase() !== String(release?.sourceRevision ?? '').toLowerCase()) throw new Error('resume receipt sourceRevision与当前Native builder不一致');
  if (!Number.isInteger(receipt.commandExitCode) || receipt.commandExitCode === 0) throw new Error('resume receipt缺少失败命令退出码');
  if (!Array.isArray(receipt.artifactTransfers) || receipt.artifactTransfers.length === 0 || receipt.artifactTransfers.length > release.artifacts.length) throw new Error('resume receipt artifactTransfers条目数无效');
  let sawIncomplete = false;
  for (let index = 0; index < receipt.artifactTransfers.length; index += 1) {
    const row = receipt.artifactTransfers[index];
    const artifact = release.artifacts[index];
    const expectedTarget = `${STAGING}/${path.basename(artifact.path)}`;
    if (!row || path.resolve(String(row.source ?? '')).toLowerCase() !== path.resolve(artifact.path).toLowerCase()) throw new Error(`resume artifact source与当前Native builder不一致：${index}`);
    if (row.target !== expectedTarget) throw new Error(`resume artifact target与正式staging路径不一致：${index}`);
    if (String(row.role ?? '') !== String(artifact.role ?? '')) throw new Error(`resume artifact role与当前Native builder不一致：${index}`);
    if (!['transferred', 'failed', 'pending', 'batch-transfer-unconfirmed'].includes(row.status)) throw new Error(`resume artifact status无效：${index}`);
    if (row.status !== 'transferred') {
      sawIncomplete = true;
    } else if (sawIncomplete) throw new Error('resume receipt在失败档案后不能标记传输成功');
  }
  if (!sawIncomplete) throw new Error('resume receipt必须包含未完成档案');
  const skipped = receipt.artifactTransfers.filter(row => row.status === 'transferred').map((row, index) => ({ ...row, artifact: release.artifacts[index] }));
  return { receipt, skipped, completedNames: new Set(skipped.map(row => path.basename(row.source))) };
}

export function resumeVerificationScript(revision, rows) {
  if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error('resume revision must be full native Git commit');
  const allowedNames = new Set(['server-release.json', 'server-code.tar', 'resonance-references.zip', 'package.json', 'package-lock.json']);
  const checks = rows.map(row => {
    const name = path.basename(row.source);
    if (!allowedNames.has(name) || row.target !== `${STAGING}/${name}` || !Number.isSafeInteger(row.localBytes) || row.localBytes < 0) throw new Error(`invalid resume verification row: ${name}`);
    return `${name}\t${row.localBytes}`;
  }).join('\n');
  return `set -eu
STAGING='${STAGING}'
REV='${revision}'
NODE='${REMOTE_NODE}'
test -d "$STAGING" && test ! -L "$STAGING" || { echo 'staging-not-ordinary' >&2; exit 51; }
test -f "$STAGING/server-release.json" && test ! -L "$STAGING/server-release.json" && test "$(stat -c %h "$STAGING/server-release.json")" -eq 1 || { echo 'staged-native-receipt-missing-or-unsafe' >&2; exit 52; }
staged_revision=$("$NODE" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' "$STAGING/server-release.json")
test "$staged_revision" = "$REV" || { echo 'staged-native-revision-mismatch' >&2; exit 53; }
while IFS="$(printf '\\t')" read -r name expected_bytes; do
  test -n "$name" || continue
  f="$STAGING/$name"
  test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "resume-file-not-ordinary:$name" >&2; exit 54; }
  actual_bytes=$(stat -c %s "$f")
  test "$actual_bytes" = "$expected_bytes" || { echo "resume-file-size-mismatch:$name" >&2; exit 55; }
done <<'RESUME_FILES'
${checks}
RESUME_FILES
printf 'resume-assets-verified\\n'`;
}

export function scpBatchArgs(identity, port, host, stage, artifacts) {
  if (!identity || !path.isAbsolute(identity) || !/^\d{1,5}$/.test(String(port)) || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(host)) throw new Error('invalid batch SCP connection arguments');
  if (!path.posix.isAbsolute(stage) || !Array.isArray(artifacts) || artifacts.length === 0) throw new Error('invalid batch SCP target or artifact set');
  const files = artifacts.map(artifact => path.resolve(artifact.path));
  if (new Set(files).size !== files.length) throw new Error('duplicate artifact in batch SCP');
  return ['-i', identity, '-P', String(port), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=15', '-o', 'LogLevel=ERROR', '-o', 'ServerAliveInterval=15', ...files, `${host}:${stage}/`];
}

function readPrepareResumeReceipt(receiptPath, release) {
  checkedRegularFile(receiptPath, 'prepare resume receipt');
  return validatePrepareResumeReceipt(release, JSON.parse(fs.readFileSync(receiptPath, 'utf8')));
}

function capacityCommand(revision) {
  return `timeout 480s ${REMOTE_NODE} --max-old-space-size=384 ${CANDIDATE}/tools/resonance/capacity.mjs --data-dir ${RULES} --session-dir ${CAPACITY_SESSION} --receipt ${CAPACITY_RECEIPT} --release-receipt ${STAGING}/server-release.json --source-revision ${revision} --concurrency 4`;
}

function capacityPhaseUnit(revision, recording) {
  if (!/^[0-9a-f]{40}$/i.test(String(revision))) throw new Error('capacity batch requires full Native Git revision');
  return `resonance-cap-${revision.slice(0, 12)}-${recording ? 'record' : 'http'}`;
}

function shellQuotePosix(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }

export function capacityBatchScript(revision) {
  if (!/^[0-9a-f]{40}$/i.test(String(revision))) throw new Error('capacity batch requires full Native Git revision');
  const phases = [
    { recording: false, receipt: CAPACITY_RECEIPT },
    { recording: true, receipt: CAPACITY_RECORDING_RECEIPT },
  ];
  const phaseLines = phases.map(({ recording, receipt }) => {
    const unit = capacityPhaseUnit(revision, recording);
    const recordingArg = recording ? ' --recording' : '';
    const command = `${REMOTE_NODE} --max-old-space-size=384 ${CANDIDATE}/tools/resonance/capacity.mjs --data-dir ${RULES} --session-dir ${CAPACITY_SESSION} --receipt ${receipt} --release-receipt ${STAGING}/server-release.json --source-revision ${revision} --concurrency 4${recordingArg}`;
    const cgroupFile = `${STAGING}/capacity-${recording ? 'recording' : 'http'}-cgroup.json`;
    const wrapper = [
      'set +e', '"$@"', 'capacity_rc=$?',
      'cg2=$(awk -F: \'$1=="0" && $2=="" {print $3}\' /proc/self/cgroup)',
      'if test -n "$cg2" && test -r "/sys/fs/cgroup$cg2/memory.peak" && test -r "/sys/fs/cgroup$cg2/cpu.stat"; then',
      '  memory_peak=$(cat "/sys/fs/cgroup$cg2/memory.peak"); cpu_ns=$(awk \'/usage_usec/ {printf "%.0f", $2*1000}\' "/sys/fs/cgroup$cg2/cpu.stat"); version=2; cg_path="$cg2"',
      'else',
      '  mem_cg=$(awk -F: \'$2 ~ /(^|,)memory(,|$)/ {print $3}\' /proc/self/cgroup); cpu_cg=$(awk -F: \'$2 ~ /(^|,)cpuacct(,|$)/ {print $3}\' /proc/self/cgroup)',
      '  memory_path="/sys/fs/cgroup/memory$mem_cg/memory.max_usage_in_bytes"; cpu_path="/sys/fs/cgroup/cpuacct$cpu_cg/cpuacct.usage"',
      '  if test ! -r "$cpu_path"; then cpu_path="/sys/fs/cgroup/cpu,cpuacct$cpu_cg/cpuacct.usage"; fi',
      '  if test -r "$memory_path" && test -r "$cpu_path"; then memory_peak=$(cat "$memory_path"); cpu_ns=$(cat "$cpu_path"); version=1; cg_path="$mem_cg"; else echo capacity-cgroup-metrics-unavailable >&2; exit 70; fi',
      'fi',
      'case "$memory_peak:$cpu_ns" in *[!0-9:]*|:*|*:) echo capacity-cgroup-metrics-invalid >&2; exit 71;; esac',
      'unit_result=failed; test "$capacity_rc" -eq 0 && unit_result=success',
      `printf '{"recording":${recording ? 'true' : 'false'},"unit":"%s","unitResult":"%s","runnerExitCode":%s,"cpuUsageNSec":%s,"memoryPeakBytes":%s,"cgroupVersion":%s,"cgroupPath":"%s","receipt":"%s"}\\n' '${unit}.service' "$unit_result" "$capacity_rc" "$cpu_ns" "$memory_peak" "$version" "$cg_path" '${receipt}' > '${cgroupFile}'`,
      'exit "$capacity_rc"',
    ].join('\n');
    return `UNIT='${unit}.service'\n` +
      `set +e\ntimeout --signal=TERM --kill-after=5s 520s systemd-run --wait --pipe --collect --unit="$UNIT" --property=MemoryMax=512M --property=CPUQuota=100% --property=RuntimeMaxSec=480s /bin/bash -c ${shellQuotePosix(wrapper)} capacity-wrapper ${command}\nsystemd_rc=$?\nset -e\n` +
      `test -f '${cgroupFile}' && test ! -L '${cgroupFile}' && test "$(stat -c %h '${cgroupFile}')" -eq 1 || { echo "capacity-cgroup-proof-missing:$UNIT" >&2; exit 61; }\n` +
      `"${REMOTE_NODE}" -e 'const fs=require("fs"),r=JSON.parse(fs.readFileSync("${cgroupFile}","utf8"));if(r.unit!=="${unit}.service"||r.runnerExitCode!==0||r.cpuUsageNSec<=0||r.memoryPeakBytes<=0||r.cgroupVersion!==1&&r.cgroupVersion!==2)process.exit(61)'\ntest "$systemd_rc" -eq 0 || { echo "capacity-systemd-run-failed:$UNIT:$systemd_rc" >&2; exit 61; }\n` +
      `"${REMOTE_NODE}" -e 'const fs=require("fs"),p="${receipt}",r=JSON.parse(fs.readFileSync(p,"utf8"));if(r.status!=="completed"||r.sourceRevision!=="${revision}"||r.concurrency!==4||r.recording!==${recording ? 'true' : 'false'}||r.sessions?.length!==4||r.error)process.exit(62);const expected="${CAPACITY_SESSION}/";for(const f of [...(r.outputPaths?.sessionFiles||[]),...(r.outputPaths?.replays||[])])if(typeof f!=="string"||!f.startsWith(expected))process.exit(63);if(${recording ? '!(r.sessions.every(s=>s.replay?.verifiedViaHttp===true&&s.replay.frames>0&&s.replay.gzipBytes>0))' : 'r.sessions.some(s=>s.replay?.verifiedViaHttp||s.replay?.frames)'} )process.exit(64);'\n` +
      `"${REMOTE_NODE}" - "${receipt}" "${CAPACITY_SESSION}" <<'CAPACITY_CLEAN'\nconst fs=require('fs'),cp=require('child_process'),path=require('path');const [receiptPath,dir]=process.argv.slice(2);const ds=fs.lstatSync(dir);if(!ds.isDirectory()||ds.isSymbolicLink())throw Error('capacity-session-directory-not-ordinary');const r=JSON.parse(fs.readFileSync(receiptPath,'utf8'));if(r.status!=='completed'||r.sessions.length!==4)throw Error('capacity-session-receipt-not-complete');const files=[...(r.outputPaths.sessionFiles||[]),...(r.outputPaths.replays||[])];if(files.length!==(r.recording?8:4))throw Error('capacity-output-list-count-invalid');const names=files.map(f=>path.basename(f));if(new Set(names).size!==files.length||JSON.stringify(fs.readdirSync(dir).sort())!==JSON.stringify(names.sort()))throw Error('capacity-directory-has-unknown-or-nested-contents');for(const file of files){if(path.dirname(file)!==dir)throw Error('capacity-output-outside-session-directory');const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error('capacity-output-not-ordinary-single-link');const busy=cp.spawnSync('fuser',['-s','--',file]);if(busy.error)throw busy.error;if(busy.status===0)throw Error('capacity-output-in-use');if(busy.status!==1)throw Error('capacity-output-consumer-check-failed');}for(const file of files)fs.unlinkSync(file);if(fs.readdirSync(dir).length!==0)throw Error('capacity-session-directory-not-empty-after-clean');\nCAPACITY_CLEAN\n` +
      ``;
  }).join('\n');
  return `set -eu\nREV='${revision}'\nSESSION='${CAPACITY_SESSION}'\nSTAGING='${STAGING}'\nNODE='${REMOTE_NODE}'\n` +
    `for p in /var /var/lib /var/lib/stronghold-protocol; do test -d "$p" && test ! -L "$p" || { echo "capacity-ancestor-not-ordinary:$p" >&2; exit 55; }; done\n` +
    `for p in /var/lib/stronghold-protocol/capacity-tests "$SESSION"; do if test -e "$p" || test -L "$p"; then test -d "$p" && test ! -L "$p" || { echo "capacity-directory-not-ordinary:$p" >&2; exit 55; }; else mkdir -m 0755 "$p"; fi; done\n` +
    `test -d "$SESSION" && test ! -L "$SESSION" || { echo 'capacity-session-directory-not-ordinary' >&2; exit 55; }\n` +
    `test -z "$(ls -A "$SESSION")" || { echo 'capacity-session-directory-not-empty' >&2; exit 56; }\n` +
    `for f in '${CAPACITY_RECEIPT}' '${CAPACITY_RECORDING_RECEIPT}' '${CAPACITY_BATCH_RECEIPT}' '${STAGING}/capacity-http-cgroup.json' '${STAGING}/capacity-recording-cgroup.json'; do test ! -e "$f" && test ! -L "$f" || { echo "capacity-batch-output-already-exists:$f" >&2; exit 60; }; done\n` +
    `test -f '${CANDIDATE}/.resonance-release-receipt.json' && test ! -L '${CANDIDATE}/.resonance-release-receipt.json' || { echo 'capacity-candidate-receipt-missing' >&2; exit 57; }\n` +
    `candidate_rev=$("$NODE" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' '${CANDIDATE}/.resonance-release-receipt.json')\ntest "$candidate_rev" = "$REV" || { echo 'capacity-candidate-revision-mismatch' >&2; exit 58; }\n` +
    `staged_rev=$("$NODE" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' '${STAGING}/server-release.json')\ntest "$staged_rev" = "$REV" || { echo 'capacity-staged-revision-mismatch' >&2; exit 59; }\n` +
    `test -z "$(ls -A "$SESSION")" || { echo 'capacity-session-directory-not-empty' >&2; exit 56; }\n` + phaseLines +
    `"$NODE" - <<'CAPACITY_BATCH' > '${CAPACITY_BATCH_RECEIPT}'\nconst fs=require('fs');const rev='${revision}';const http=JSON.parse(fs.readFileSync('${CAPACITY_RECEIPT}','utf8'));const recording=JSON.parse(fs.readFileSync('${CAPACITY_RECORDING_RECEIPT}','utf8'));const cgroupHttp=JSON.parse(fs.readFileSync('${STAGING}/capacity-http-cgroup.json','utf8'));const cgroupRecording=JSON.parse(fs.readFileSync('${STAGING}/capacity-recording-cgroup.json','utf8'));process.stdout.write(JSON.stringify({schema:'resonance-capacity-batch-receipt/v1',sourceRevision:rev,status:'completed',sessionDirectory:'${CAPACITY_SESSION}',candidate:'${CANDIDATE}',staging:'${STAGING}',phases:[{receipt:'${CAPACITY_RECEIPT}',capacity:http,cgroup:cgroupHttp},{receipt:'${CAPACITY_RECORDING_RECEIPT}',capacity:recording,cgroup:cgroupRecording}],cleanup:{sessionDirectoryEmpty:fs.readdirSync('${CAPACITY_SESSION}').length===0,removedOnlyReceiptListedFiles:true}})+'\\n');\nCAPACITY_BATCH\n` +
    `cat '${CAPACITY_BATCH_RECEIPT}'\n`;
}

export function capacityBatchCommand(revision) {
  return { args: [...sshArgs('15'), 'timeout 1080s bash -s'], input: capacityBatchScript(revision), timeoutMs: 1_090_000 };
}

export function capacityBatchReceiptFromStdout(stdout, revision) {
  const text = String(stdout).trim();
  let receipt;
  try { receipt = JSON.parse(text); }
  catch {
    const line = text.split(/\r?\n/).at(-1);
    try { receipt = JSON.parse(line); } catch { throw new Error('远端容量批次未返回可读终态JSON'); }
  }
  if (receipt.schema !== 'resonance-capacity-batch-receipt/v1' || receipt.status !== 'completed'
    || String(receipt.sourceRevision).toLowerCase() !== String(revision).toLowerCase()
    || receipt.phases?.length !== 2 || receipt.cleanup?.sessionDirectoryEmpty !== true) {
    throw new Error('远端容量批次回执未通过source/终态/清理校验');
  }
  const [http, recording] = receipt.phases;
  validateCapacityReceipt(revision, { ...http.capacity, recording: false });
  validateCapacityReceipt(revision, { ...recording.capacity, recording: false });
  if (http.capacity?.recording !== false || recording.capacity?.recording !== true
    || [http, recording].some(phase => phase.capacity?.status !== 'completed' || phase.capacity?.concurrency !== 4
      || phase.capacity?.sourceRevision !== revision || phase.capacity?.sessions?.length !== 4
      || phase.cgroup?.unitResult !== 'success' || !Number.isFinite(phase.cgroup?.cpuUsageNSec) || phase.cgroup.cpuUsageNSec <= 0
      || !Number.isFinite(phase.cgroup?.memoryPeakBytes) || phase.cgroup.memoryPeakBytes <= 0)) {
    throw new Error('远端容量批次缺少两阶段四并发或cgroup资源证明');
  }
  if (!recording.capacity.sessions.every(row => row.replay?.verifiedViaHttp === true && row.replay.frames > 0 && row.replay.gzipBytes > 0)) throw new Error('录制阶段缺少HTTP回读的gzip replay证明');
  return receipt;
}

export function prepareLocalBatchReceiptPath(file, revision) {
  const target = path.resolve(file);
  if (!/^[0-9a-f]{40}$/i.test(revision ?? '')) throw new Error('capacity receipt requires full Native revision');
  if (!target.replaceAll('\\', '/').endsWith('/runtime/resonance/deployment/capacity-batch-receipt.json')) throw new Error('local capacity receipt must use runtime/resonance/deployment/capacity-batch-receipt.json');
  let current = path.parse(target).root;
  const relative = path.relative(current, path.dirname(target)).split(path.sep).filter(Boolean);
  for (const part of relative) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      const st = fs.lstatSync(current);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`local capacity receipt parent is not an ordinary directory: ${current}`);
    } else fs.mkdirSync(current);
  }
  if (fs.existsSync(`${target}.pending`)) throw new Error(`local capacity receipt pending output already exists: ${target}.pending`);
  if (!fs.existsSync(target)) return { target, reuse: false, archivedPreviousReceipt: null };
  checkedRegularFile(target, 'existing local capacity receipt');
  const existingBytes = fs.readFileSync(target);
  const existing = capacityBatchReceiptFromStdout(JSON.stringify(JSON.parse(existingBytes.toString('utf8'))), JSON.parse(existingBytes.toString('utf8')).sourceRevision);
  if (existing.sourceRevision.toLowerCase() === revision.toLowerCase()) return { target, reuse: true, receipt: existing, archivedPreviousReceipt: null };
  const archivedPreviousReceipt = target.slice(0, -'.json'.length) + `.${existing.sourceRevision}.json`;
  if (fs.existsSync(archivedPreviousReceipt)) {
    checkedRegularFile(archivedPreviousReceipt, 'archived local capacity receipt');
    if (!fs.readFileSync(archivedPreviousReceipt).equals(existingBytes)) throw new Error(`旧Native capacity receipt归档字节不一致：${archivedPreviousReceipt}`);
  } else fs.writeFileSync(archivedPreviousReceipt, existingBytes, { flag: 'wx' });
  return { target, reuse: false, receipt: existing, archivedPreviousReceipt };
}

export function writeLocalBatchReceipt(target, receipt) {
  const pending = `${target}.pending`;
  if (fs.existsSync(pending)) throw new Error(`local capacity receipt transaction path exists: ${pending}`);
  if (fs.existsSync(target)) {
    checkedRegularFile(target, 'replaced local capacity receipt');
    const oldBytes = fs.readFileSync(target);
    const old = JSON.parse(oldBytes.toString('utf8'));
    capacityBatchReceiptFromStdout(JSON.stringify(old), old.sourceRevision);
    const archived = target.slice(0, -'.json'.length) + `.${old.sourceRevision}.json`;
    checkedRegularFile(archived, 'archived replaced local capacity receipt');
    if (!fs.readFileSync(archived).equals(oldBytes)) throw new Error(`旧Native capacity receipt归档字节不一致：${archived}`);
  }
  fs.writeFileSync(pending, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  try {
    fs.renameSync(pending, target);
  } catch (error) {
    if (fs.existsSync(pending)) fs.unlinkSync(pending);
    throw error;
  }
  return target;
}

export function validateCapacityReceipt(releaseRevision, receipt) {
  if (receipt?.schema !== 'resonance-capacity-receipt/v1') throw new Error('容量回执schema不匹配');
  if (receipt.status !== 'completed') throw new Error(`容量回执未成功：${receipt.status ?? 'missing status'}`);
  if (String(receipt.sourceRevision).toLowerCase() !== releaseRevision.toLowerCase()
    || String(receipt.providedSourceRevision).toLowerCase() !== releaseRevision.toLowerCase()) throw new Error('容量回执与release的原生sourceRevision不一致');
  if (!['git-rev-parse', 'server-release-receipt'].includes(receipt.sourceProvenance?.provenance)) throw new Error('容量回执缺少受信原生版本来源');
  if (receipt.concurrency !== 4 || receipt.recording !== false || receipt.host !== '127.0.0.1' || receipt.ephemeralPort !== true) throw new Error('容量回执不是四并发、无录制的本机HTTP验收');
  if (receipt.server?.bind !== '127.0.0.1' || !Number.isInteger(receipt.server?.port) || receipt.server.port < 1 || receipt.server.port > 65535) throw new Error('容量回执缺少有效的本机ephemeral server监听记录');
  if (receipt.fixtureType !== 'fixed stress fixture' || receipt.accessibility !== 'not an economy-achievability claim') throw new Error('容量回执fixture标记与正式runner不符');
  if (!Array.isArray(receipt.sessions) || receipt.sessions.length !== 4) throw new Error('容量回执必须包含四个实际HTTP session');
  const ids = new Set();
  for (const row of receipt.sessions) {
    if (!row?.id || ids.has(row.id)) throw new Error('容量回执session ID缺失或重复');
    ids.add(row.id);
    if (row.status !== 'battle-complete' || row.createdViaHttp !== true || row.validatedPool !== true) throw new Error(`容量回执session未通过官方HTTP与池校验：${row.id}`);
    if (row.refresh?.status !== 200 || !Number.isInteger(row.refresh?.revisionBefore) || !Number.isInteger(row.refresh?.revisionAfter)
      || row.refresh.revisionAfter <= row.refresh.revisionBefore || row.fight?.status !== 200
      || !Number.isInteger(row.fight?.expectedRevision) || !Number.isInteger(row.fight?.revisionAfter)
      || row.fight.revisionAfter <= row.fight.expectedRevision || row.fight?.diagnostics?.errorCount !== 0
      || typeof row.fight?.won !== 'boolean' || !Number.isFinite(row.fight?.durationSeconds)) throw new Error(`容量回执session战斗未成功或含诊断：${row.id}`);
  }
  if (receipt.error != null) throw new Error('容量回执带有运行错误');
  return { sourceRevision: releaseRevision, sessions: ids.size, status: receipt.status };
}

export function activationScript(revision) {
  if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error('activation revision must be full native Git commit');
  const release = `${INSTALL_ROOT}/releases/${revision}`;
  const unitBackup = `${BACKUP_ROOT}/stronghold-protocol.${revision}.unit.backup`;
  const envBackup = `${BACKUP_ROOT}/stronghold-protocol.${revision}.env.backup`;
  return `set -Eeuo pipefail
REV='${revision}'
RELEASE='${release}'
CANDIDATE='${CANDIDATE}'
UNIT='${SERVICE_UNIT}'
ENVFILE='${SERVICE_ENV}'
BACKUP_ROOT='${BACKUP_ROOT}'
UNIT_BACKUP='${unitBackup}'
ENV_BACKUP='${envBackup}'
RESONANCE_DIR='${RESONANCE_DIRECTORY}'
mutated=0
rollback_state=not-needed
old_release=unknown
old_path=unknown
ordinary_dir() { test -d "$1" && test ! -L "$1"; }
rollback_config() {
  if test "$mutated" -eq 1; then
    rollback_state=failed
    if cp -p "$UNIT_BACKUP" "$UNIT" && cp -p "$ENV_BACKUP" "$ENVFILE" && systemctl daemon-reload && timeout 40s systemctl restart stronghold-protocol.service && systemctl is-active --quiet stronghold-protocol.service; then rollback_state=restored; fi
  fi
}
fail_activation() {
  rc="$1"
  trap - ERR INT TERM
  rollback_config
  printf '{"terminalStatus":"failed","sourceRevision":"%s","previousRevision":"%s","rollbackPath":"%s","rollback":"%s","unitBackup":"%s","envBackup":"%s","activePath":"%s","candidate":"%s"}\\n' "$REV" "$old_release" "$old_path" "$rollback_state" "$UNIT_BACKUP" "$ENV_BACKUP" "$RELEASE" "$CANDIDATE" >&2
  exit "$rc"
}
on_error() { fail_activation "$?"; }
on_signal() { fail_activation "$1"; }
trap on_error ERR
trap 'on_signal 143' TERM
trap 'on_signal 130' INT
for p in /var /var/tmp /opt /opt/stronghold-protocol /opt/stronghold-protocol/releases /etc /etc/systemd /etc/systemd/system /var/lib /var/lib/stronghold-protocol; do ordinary_dir "$p" || { echo "unsafe-or-missing:$p" >&2; exit 31; }; done
for p in /var/tmp/stronghold-protocol /var/tmp/stronghold-protocol/resonance; do if test -e "$p" || test -L "$p"; then ordinary_dir "$p" || { echo "unsafe-backup-parent:$p" >&2; exit 31; }; else mkdir -m 0700 "$p"; fi; done
if test -e "$RESONANCE_DIR" || test -L "$RESONANCE_DIR"; then ordinary_dir "$RESONANCE_DIR" || { echo "resonance-directory-not-ordinary:$RESONANCE_DIR" >&2; exit 31; }; else mkdir -m 0750 "$RESONANCE_DIR"; fi
for f in "$UNIT" "$ENVFILE"; do test -f "$f" && test ! -L "$f" || { echo "unknown-or-unsafe-existing-file:$f" >&2; exit 32; }; test "$(stat -c %h "$f")" -eq 1 || { echo "hardlinked-file:$f" >&2; exit 32; }; done
ordinary_dir "$CANDIDATE" || { echo "candidate-not-ordinary:$CANDIDATE" >&2; exit 33; }
test -f "$CANDIDATE/server/index.js" && test ! -L "$CANDIDATE/server/index.js" || { echo 'candidate-server-entrypoint-missing-or-unsafe' >&2; exit 33; }
test -f "$CANDIDATE/public/resonance.html" && test ! -L "$CANDIDATE/public/resonance.html" || { echo 'candidate-resonance-page-missing-or-unsafe' >&2; exit 33; }
test -f "$CANDIDATE/.resonance-release-receipt.json" && test ! -L "$CANDIDATE/.resonance-release-receipt.json" || { echo 'candidate-receipt-missing-or-unsafe' >&2; exit 33; }
test "$(stat -c %h "$CANDIDATE/.resonance-release-receipt.json")" -eq 1 || { echo 'candidate-receipt-hardlink' >&2; exit 33; }
candidate_rev=$("${REMOTE_NODE}" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' "$CANDIDATE/.resonance-release-receipt.json")
test "$candidate_rev" = "$REV" || { echo 'candidate-source-revision-mismatch' >&2; exit 33; }
links=$(find "$CANDIDATE" -type l -print -quit); test -z "$links" || { echo "candidate-link:$links" >&2; exit 33; }
hard=$(find "$CANDIDATE" -type f -exec sh -c 'for f do test "$(stat -c %h "$f")" -eq 1 || { echo "$f"; exit 1; }; done' sh {} +) || { echo "candidate-hardlink:$hard" >&2; exit 33; }
bad=$(find "$CANDIDATE" -type d \\( -name data -o -name assets -o -name runtime \\) -print -quit)
test -z "$bad" || { echo "candidate-forbidden-path:$bad" >&2; exit 33; }
candidate_files=$(find "$CANDIDATE" -type f -printf '%P\\n' | sort)
release_action=activate-candidate
if test -e "$RELEASE" || test -L "$RELEASE"; then
  ordinary_dir "$RELEASE" || { echo "existing-release-not-ordinary:$RELEASE" >&2; exit 34; }
  test -f "$RELEASE/.resonance-release-receipt.json" && test ! -L "$RELEASE/.resonance-release-receipt.json" || { echo "existing-release-manifest-missing-or-unsafe:$RELEASE" >&2; exit 34; }
  release_rev=$("${REMOTE_NODE}" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' "$RELEASE/.resonance-release-receipt.json")
  test "$release_rev" = "$REV" || { echo "existing-release-revision-mismatch:$RELEASE" >&2; exit 34; }
  cmp -s "$CANDIDATE/.resonance-release-receipt.json" "$RELEASE/.resonance-release-receipt.json" || { echo "existing-release-manifest-mismatch:$RELEASE" >&2; exit 34; }
  links=$(find "$RELEASE" -type l -print -quit); test -z "$links" || { echo "existing-release-link:$links" >&2; exit 34; }
  hard=$(find "$RELEASE" -type f -exec sh -c 'for f do test "$(stat -c %h "$f")" -eq 1 || { echo "$f"; exit 1; }; done' sh {} +) || { echo "existing-release-hardlink:$hard" >&2; exit 34; }
  existing_files=$(find "$RELEASE" -type f -printf '%P\\n' | sort)
  test "$candidate_files" = "$existing_files" || { echo "existing-release-occupancy-mismatch:$RELEASE" >&2; exit 34; }
  while IFS= read -r rel; do cmp -s "$CANDIDATE/$rel" "$RELEASE/$rel" || { echo "existing-release-file-mismatch:$RELEASE/$rel" >&2; exit 34; }; done <<< "$candidate_files"
  release_action=reuse-existing-release
else
  release_action=move-candidate
fi
if test -e "$BACKUP_ROOT" || test -L "$BACKUP_ROOT"; then ordinary_dir "$BACKUP_ROOT" || { echo "backup-root-not-ordinary:$BACKUP_ROOT" >&2; exit 35; }; else mkdir -m 0700 -p "$BACKUP_ROOT"; fi
test ! -e "$UNIT_BACKUP" && test ! -L "$UNIT_BACKUP" && test ! -e "$ENV_BACKUP" && test ! -L "$ENV_BACKUP" || { echo 'activation-backup-already-exists' >&2; exit 35; }
cp -p "$UNIT" "$UNIT_BACKUP"
cp -p "$ENVFILE" "$ENV_BACKUP"
for b in "$UNIT_BACKUP" "$ENV_BACKUP"; do test -f "$b" && test ! -L "$b" && test "$(stat -c %h "$b")" -eq 1 || { echo "activation-backup-invalid:$b" >&2; exit 35; }; done
old_path=$(awk -F= '$1=="WorkingDirectory" {v=$2} END {print v}' "$UNIT")
old_release=$(printf '%s\\n' "$old_path" | sed -nE 's#^.*/releases/([0-9a-fA-F]{40})$#\\1#p')
test -n "$old_release" || old_release=unknown
if test "$release_action" = move-candidate; then mv -- "$CANDIDATE" "$RELEASE"; fi
mutated=1
"${REMOTE_NODE}" - "$UNIT" "$ENVFILE" "$RELEASE" "$RESONANCE_DIR" <<'NODE'
const fs=require('fs');
const [unitPath,envPath,release,resonanceDir]=process.argv.slice(2);
const unit=fs.readFileSync(unitPath,'utf8');
const lines=unit.split(/(?<=\\n)/); let section='', working=[], exec=[];
for(let i=0;i<lines.length;i++){const line=lines[i],plain=line.replace(/\\r?\\n$/,'');const head=plain.match(/^\\s*\\[([^\\]]+)\\]\\s*$/);if(head){section=head[1];continue;}if(section==='Service'){if(/^\\s*WorkingDirectory\\s*=/.test(plain))working.push(i);if(/^\\s*ExecStart\\s*=/.test(plain))exec.push(i);}}
if(working.length!==1||exec.length!==1)throw new Error('unit must contain exactly one Service WorkingDirectory and ExecStart');
const wi=working[0], ei=exec[0];
lines[wi]=lines[wi].replace(/^(\\s*WorkingDirectory\\s*=).*/,'$1'+release);
const execLine=lines[ei];const matches=[...execLine.matchAll(/(?:^|\\s)(?:[^\\s]*\\/)?server\\/index\\.js(?=\\s|\\r?\\n|$)/g)];
if(matches.length!==1)throw new Error('ExecStart must contain exactly one server/index.js source argument');
const match=matches[0], start=match.index+(match[0].startsWith(' ')?1:0), end=match.index+match[0].length;
lines[ei]=execLine.slice(0,start)+release+'/server/index.js'+execLine.slice(end);
fs.writeFileSync(unitPath,lines.join(''));
let env=fs.readFileSync(envPath,'utf8');const envLines=env.split(/(?<=\\n)/);const found=[];
for(let i=0;i<envLines.length;i++)if(/^\\s*SP_RESONANCE_DIRECTORY\\s*=/.test(envLines[i]))found.push(i);
if(found.length>1)throw new Error('multiple SP_RESONANCE_DIRECTORY entries');
if(found.length===1)envLines[found[0]]=envLines[found[0]].replace(/^(\\s*SP_RESONANCE_DIRECTORY\\s*=).*/,'$1'+resonanceDir);
else {if(envLines.length&&envLines.at(-1)!=='')envLines.push('\\n');envLines.push('SP_RESONANCE_DIRECTORY='+resonanceDir+'\\n');}
fs.writeFileSync(envPath,envLines.join(''));
NODE
systemctl daemon-reload
timeout 25s systemctl restart stronghold-protocol.service
systemctl is-active --quiet stronghold-protocol.service
main_pid=$(systemctl show -p MainPID --value stronghold-protocol.service)
test "$main_pid" -gt 1
test "$(readlink "/proc/$main_pid/cwd")" = "$RELEASE" || { echo 'service-cwd-mismatch' >&2; exit 36; }
tr '\\0' '\\n' < "/proc/$main_pid/cmdline" | grep -Fq "$RELEASE/server/index.js" || { echo 'service-entrypoint-mismatch' >&2; exit 36; }
port=$("${REMOTE_NODE}" - "$ENVFILE" <<'NODE'
const fs=require('fs');const s=fs.readFileSync(process.argv[2],'utf8');const m=[...s.matchAll(/^\\s*PORT\\s*=\\s*['\"]?([0-9]+)['\"]?\\s*$/gm)];if(m.length>1)process.exit(2);const p=m.length?Number(m[0][1]):3000;if(!Number.isInteger(p)||p<1||p>65535)process.exit(3);process.stdout.write(String(p));
NODE
)
health=0
for n in $(seq 1 15); do
  if "${REMOTE_NODE}" - "$port" <<'NODE'
const p=Number(process.argv[2]);fetch('http://127.0.0.1:'+p+'/healthz',{signal:AbortSignal.timeout(1000)}).then(async r=>{const j=await r.json();if(!r.ok||j.ok!==true)process.exit(1);}).catch(()=>process.exit(1));
NODE
  then health=1; break; fi
  sleep 1
done
test "$health" -eq 1 || { echo 'health-timeout' >&2; exit 37; }
mutated=0
rollback_state=not-needed
trap - ERR
printf '{"terminalStatus":"activated","sourceRevision":"%s","previousRevision":"%s","rollbackPath":"%s","activePath":"%s","unitBackup":"%s","envBackup":"%s","resonanceDirectory":"%s","releaseAction":"%s","health":"ok","rollback":"%s"}\\n' "$REV" "$old_release" "$old_path" "$RELEASE" "$UNIT_BACKUP" "$ENV_BACKUP" "$RESONANCE_DIR" "$release_action" "$rollback_state"
`;
}

function readCapacityReceipt(receiptPath) {
  checkedRegularFile(receiptPath, 'capacity receipt');
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
}

export function activationCommand(revision) {
  return { args: [...sshArgs('45'), 'timeout 120s bash -s'], input: activationScript(revision), timeoutMs: 180_000 };
}

function activateRemote(revision) {
  if (!fs.existsSync(IDENTITY)) throw new Error(`SSH identity不存在：${IDENTITY}`);
  const command = activationCommand(revision);
  return invoke('ssh', command.args, command.input, command.timeoutMs);
}

function selfTest() {
  const parsed = parseArgs(['--release-receipt', 'C:/tmp/release.json']);
  if (parsed.prepare || parsed.receiptPath !== 'C:/tmp/release.json') throw new Error('默认dry-run参数测试失败');
  if (!parseArgs(['--release-receipt', 'C:/tmp/r.json', '--prepare']).prepare) throw new Error('--prepare解析测试失败');
  let rejected = false;
  try { absolutePath('relative/file.json', 'receipt'); } catch { rejected = true; }
  if (!rejected) throw new Error('相对receipt路径应拒绝');
  validateArchiveListing(['server/index.js', 'public/resonance.html'], ['-rw-r--r-- root/root 1 server/index.js']);
  for (const unsafe of [['../outside'], ['/etc/passwd'], ['data/rule.json'], ['public/assets/image.png']]) {
    let blocked = false;
    try { validateArchiveListing(unsafe, []); } catch { blocked = true; }
    if (!blocked) throw new Error(`archive路径安全检查未拒绝：${unsafe[0]}`);
  }
  let linkBlocked = false;
  try { validateArchiveListing(['server/index.js'], ['lrwxrwxrwx root/root 0 server/link -> index.js']); } catch { linkBlocked = true; }
  if (!linkBlocked) throw new Error('archive链接检查未拒绝符号链接');
  const command = capacityCommand('0123456789abcdef0123456789abcdef01234567');
  if (!command.includes('timeout 480s') || !command.includes(`${REMOTE_NODE} --max-old-space-size=384`) || !command.includes('--concurrency 4') || !command.includes(CAPACITY_SESSION)) throw new Error('容量命令配置测试失败');
  const preflight = preflightScript('1.0.0', '0123456789abcdef0123456789abcdef01234567', ['server/index.js', 'public/resonance.html']);
  if (preflight.includes("find '${INSTALL_ROOT}' -mindepth 1 -maxdepth 1") || !preflight.includes('candidate-source-revision-mismatch') || !preflight.includes('candidate-occupancy-mismatch') || !preflight.includes('staging-source-revision-mismatch')) throw new Error('remote preflight ownership/target-scope tests failed');
  if (!sshArgs().includes('ConnectTimeout=15') || !sshArgs().includes('ServerAliveInterval=15') || !REMOTE_NPM_CLI.endsWith('/lib/node_modules/npm/bin/npm-cli.js')) throw new Error('remote toolchain/SSH timeout configuration failed');
  if (!CANDIDATE.startsWith(`${INSTALL_ROOT}/releases/`) || CANDIDATE === RULES || STAGING === RULES || CANDIDATE === STAGING) throw new Error('远端路径布局检查失败');
  process.stdout.write(JSON.stringify({ ok: true, mode: 'dry-run default', remoteWrites: false, capacityFlags: { heapMiB: 384, concurrency: 4, timeoutSeconds: 480 } }) + '\n');
}

function sshArgs(connectTimeout = '15') { return ['-i', IDENTITY, '-p', PORT, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', `ConnectTimeout=${connectTimeout}`, '-o', 'LogLevel=ERROR', '-o', 'ServerAliveInterval=15', HOST]; }

export function preflightScript(wsVersion, revision, candidateFiles, { allowStagedReceiptOverwrite = false, replaceStagedRevision = null } = {}) {
  if (allowStagedReceiptOverwrite && replaceStagedRevision) throw new Error('resume receipt replacement and staged revision replacement are mutually exclusive');
  if (replaceStagedRevision && (!/^[0-9a-f]{40}$/i.test(replaceStagedRevision) || replaceStagedRevision.toLowerCase() === revision.toLowerCase())) throw new Error('invalid staged replacement revision');
  const expected = [...new Set([...candidateFiles, 'public/resonance-references.zip', '.resonance-release-receipt.json'])].sort();
  const stageNames = [
    ...OWNED_STAGE_NAMES,
    ...COMPLETED_CAPACITY_ARCHIVE_REVISIONS.flatMap(CAPACITY_BATCH_ARCHIVE_NAMES),
    ...(replaceStagedRevision ? [`stronghold-protocol.${replaceStagedRevision}.unit.backup`, `stronghold-protocol.${replaceStagedRevision}.env.backup`] : []),
  ].map(name => `'${name}'`).join(' ');
  const expectedLines = expected.map(name => `'${name}'`).join(' ');
  const stagedReceiptCheck = replaceStagedRevision
    ? `test -f '${STAGING}/server-release.json' && test ! -L '${STAGING}/server-release.json' && test "$(stat -c %h '${STAGING}/server-release.json')" -eq 1 || { echo 'replacement-old-staging-receipt-missing-or-unsafe:${STAGING}/server-release.json'; exit 25; }; staged_revision=$('${REMOTE_NODE}' -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' '${STAGING}/server-release.json'); test "$staged_revision" = '${replaceStagedRevision}' || { echo 'replacement-old-staging-revision-mismatch:${STAGING}/server-release.json'; exit 25; }`
    : allowStagedReceiptOverwrite
    ? `if test -e '${STAGING}/server-release.json' || test -L '${STAGING}/server-release.json'; then test -f '${STAGING}/server-release.json' && test ! -L '${STAGING}/server-release.json' && test "$(stat -c %h '${STAGING}/server-release.json')" -eq 1 || { echo 'staging-receipt-not-ordinary:${STAGING}/server-release.json'; exit 25; }; fi`
    : `if test -f '${STAGING}/server-release.json'; then staged_revision=$('${REMOTE_NODE}' -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' '${STAGING}/server-release.json'); test "$staged_revision" = '${revision}' || { echo 'staging-source-revision-mismatch:${STAGING}/server-release.json'; exit 25; }; fi`;
  const replacementPreflight = replaceStagedRevision
    ? `test -d '${STAGING}' && test ! -L '${STAGING}' || { echo 'replacement-staging-root-missing-or-unsafe:${STAGING}'; exit 24; }; if test -e '${CANDIDATE}' || test -L '${CANDIDATE}'; then echo 'candidate-present-on-staged-replacement:${CANDIDATE}'; exit 23; fi`
    : '';
  const replacementJson = replaceStagedRevision ? `"${replaceStagedRevision}"` : 'null';
  return `set -eu
ordinary_dir() { p="$1"; test -d "$p" && test ! -L "$p"; }
for p in /var /var/tmp /opt /var/lib /var/lib/stronghold-protocol /var/lib/stronghold-protocol/rules /var/lib/stronghold-protocol/rules/4ed1ad32ec10da15c23f9d7939dade603950759b /var/lib/stronghold-protocol/rules/4ed1ad32ec10da15c23f9d7939dade603950759b/data /etc /etc/systemd /etc/systemd/system; do ordinary_dir "$p" || { echo "unsafe-or-missing:$p"; exit 21; }; done
if test -e /var/tmp/stronghold-protocol || test -L /var/tmp/stronghold-protocol; then ordinary_dir /var/tmp/stronghold-protocol || { echo 'unsafe-or-missing:/var/tmp/stronghold-protocol'; exit 22; }; fi
if test -e '${INSTALL_ROOT}' || test -L '${INSTALL_ROOT}'; then ordinary_dir '${INSTALL_ROOT}' || { echo 'unsafe-or-missing:${INSTALL_ROOT}'; exit 22; }; fi
ordinary_dir '${INSTALL_ROOT}/toolchain' && ordinary_dir '${INSTALL_ROOT}/toolchain/node-v22.23.3-linux-x64' && ordinary_dir '${INSTALL_ROOT}/toolchain/node-v22.23.3-linux-x64/bin' || { echo 'required-toolchain-dir-missing-or-unsafe:${INSTALL_ROOT}/toolchain/node-v22.23.3-linux-x64'; exit 22; }
test -f '${REMOTE_NODE}' && test -x '${REMOTE_NODE}' && test ! -L '${REMOTE_NODE}' || { echo 'required-node-missing-or-unsafe:${REMOTE_NODE}'; exit 22; }
test -f '${REMOTE_NPM_CLI}' && test ! -L '${REMOTE_NPM_CLI}' || { echo 'required-npm-cli-missing-or-unsafe:${REMOTE_NPM_CLI}'; exit 22; }
if test -e '${INSTALL_ROOT}/releases' || test -L '${INSTALL_ROOT}/releases'; then ordinary_dir '${INSTALL_ROOT}/releases' || { echo 'unsafe-or-missing:${INSTALL_ROOT}/releases'; exit 22; }; fi
candidate_state=absent
${replacementPreflight}
if test -e '${CANDIDATE}' || test -L '${CANDIDATE}'; then
  ordinary_dir '${CANDIDATE}' || { echo 'candidate-not-ordinary:${CANDIDATE}'; exit 23; }
  test -f '${CANDIDATE}/.resonance-release-receipt.json' && test ! -L '${CANDIDATE}/.resonance-release-receipt.json' || { echo 'candidate-receipt-missing-or-unsafe:${CANDIDATE}/.resonance-release-receipt.json'; exit 23; }
  test "$(stat -c %h '${CANDIDATE}/.resonance-release-receipt.json')" -eq 1 || { echo 'candidate-receipt-hardlink'; exit 23; }
  candidate_revision=$('${REMOTE_NODE}' -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' '${CANDIDATE}/.resonance-release-receipt.json')
  test "$candidate_revision" = '${revision}' || { echo 'candidate-source-revision-mismatch:${CANDIDATE}'; exit 23; }
  links=$(find '${CANDIDATE}' -type l -print -quit); test -z "$links" || { echo "candidate-link:$links"; exit 23; }
  hard=$(find '${CANDIDATE}' -type f ! -path '${CANDIDATE}/.resonance-release-receipt.json' -exec sh -c 'for f do test "$(stat -c %h "$f")" -eq 1 || { echo "$f"; exit 1; }; done' sh {} +) || { echo "candidate-hardlink:$hard"; exit 23; }
  actual=$(find '${CANDIDATE}' -type f -printf '%P\\n' | sort)
  expected=$(printf '%s\\n' ${expectedLines} | sort)
  test "$actual" = "$expected" || { echo 'candidate-occupancy-mismatch:${CANDIDATE}'; printf '%s\\n' "$actual"; exit 23; }
  candidate_state=reuse
fi
if test -e '${STAGING}' || test -L '${STAGING}'; then
  test -d '${STAGING}' && test ! -L '${STAGING}' || { echo 'staging-not-ordinary:${STAGING}'; exit 24; }
  for f in '${STAGING}'/*; do test -e "$f" || continue; name=$(basename "$f"); case "$name" in 'stronghold-protocol.${revision}.unit.backup'|'stronghold-protocol.${revision}.env.backup') test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "staging-backup-unsafe:$f"; exit 25; }; continue;; 'capacity-http-cgroup.e890d97c2f044d085b6b1e22b41625e6390530b4.json') test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "staging-old-cgroup-archive-unsafe:$f"; exit 25; }; continue;; esac; case " ${stageNames} " in *" '$name' "*) ;; *) echo "staging-unknown:$f"; exit 25;; esac; test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "staging-file-unsafe:$f"; exit 25; }; done
  ${stagedReceiptCheck}
fi
for f in '${INSTALL_ROOT}/package.json' '${INSTALL_ROOT}/package-lock.json' '${INSTALL_ROOT}/node_modules'; do if test -e "$f" || test -L "$f"; then test ! -L "$f" || { echo "install-link:$f"; exit 26; }; fi; done
if test -e '${INSTALL_ROOT}/package.json'; then test -f '${INSTALL_ROOT}/package.json' || { echo 'package-json-not-file:${INSTALL_ROOT}/package.json'; exit 27; }; fi
if test -e '${INSTALL_ROOT}/package-lock.json'; then test -f '${INSTALL_ROOT}/package-lock.json' || { echo 'package-lock-not-file:${INSTALL_ROOT}/package-lock.json'; exit 27; }; fi
if test -e '${INSTALL_ROOT}/node_modules'; then test -d '${INSTALL_ROOT}/node_modules' || { echo 'node_modules-not-dir:${INSTALL_ROOT}/node_modules'; exit 27; }; fi
if test -d '${INSTALL_ROOT}'; then install_state=$('${REMOTE_NODE}' -e 'const fs=require("fs"),p="${INSTALL_ROOT}",want="${wsVersion}",names=["package.json","package-lock.json","node_modules"],have=names.map(n=>fs.existsSync(p+"/"+n));if(have.every(Boolean)){for(const f of [p+"/package.json",p+"/package-lock.json",p+"/node_modules/ws",p+"/node_modules/ws/package.json"])if(fs.lstatSync(f).isSymbolicLink()){console.error("install-link:"+f);process.exit(31)}const a=require(p+"/package.json"),b=require(p+"/package-lock.json"),c=require(p+"/node_modules/ws/package.json");if(JSON.stringify(a.dependencies)!==JSON.stringify({ws:want})||b.packages?.["node_modules/ws"]?.version!==want||c.version!==want){console.error("install-version-mismatch:${INSTALL_ROOT}/package.json ${INSTALL_ROOT}/package-lock.json ${INSTALL_ROOT}/node_modules/ws/package.json");process.exit(32)}process.stdout.write("reuse")}else if(have.every(v=>!v))process.stdout.write("install");else {console.error("install-partial:${INSTALL_ROOT}");process.exit(33)}'); else install_state=install; fi
for f in '${SERVICE_UNIT}' '${SERVICE_ENV}'; do if test -e "$f"; then test -f "$f" && test ! -L "$f" || { echo "protected-file-not-ordinary:$f"; exit 28; }; fi; done
printf '{"preflight":"ok","installState":"%s","candidate":"%s","staging":"known-owned-only","replacedStagedRevision":${replacementJson}}\\n' "$install_state" "$candidate_state"`;
}

function invoke(command, args, input, timeoutMs) {
  const result = spawnSync(command, args, { encoding: 'utf8', input, timeout: timeoutMs, killSignal: 'SIGTERM', maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command}失败（exit ${result.status ?? 'timeout'}）：${(result.stderr || result.stdout || '').trim().slice(0, 500)}`);
  return result.stdout.trim();
}

function prepareRemote(release, resumeInfo = null, replaceStagedRevision = null) {
  if (!fs.existsSync(IDENTITY)) throw new Error(`SSH identity不存在：${IDENTITY}`);
  const archiveEntries = execFileSync(TAR_COMMAND, ['-tf', release.code.path], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const candidateFiles = archiveEntries.filter(name => !name.endsWith('/'));
  const allowStagedReceiptOverwrite = Boolean(resumeInfo && resumeInfo.skipped.length === 0);
  const preflight = invoke('ssh', [...sshArgs(), 'bash', '-s'], preflightScript(release.wsVersion, release.sourceRevision, candidateFiles, { allowStagedReceiptOverwrite, replaceStagedRevision }), 45_000);
  const preflightInfo = JSON.parse(preflight);
  if (preflightInfo.preflight !== 'ok' || !['install', 'reuse'].includes(preflightInfo.installState)) throw new Error('远端安全预检未通过');
  const transferReceipt = resumeInfo ? resumeInfo.receipt.artifactTransfers.map(({ source, target, role, status }) => ({ source, target, role, status })) : [];
  const skippedAlreadyTransferred = resumeInfo ? resumeInfo.skipped.map(({ source, target, role }) => ({ source, target, role })) : [];
  const actualTransferred = [];
  if (resumeInfo?.skipped.length) {
    const verifyRows = resumeInfo.skipped.map(row => ({ ...row, localBytes: fs.statSync(row.artifact.path).size }));
    const verified = invoke('ssh', [...sshArgs(), 'bash', '-s'], resumeVerificationScript(release.sourceRevision, verifyRows), 45_000);
    if (verified !== 'resume-assets-verified') throw new Error('远端已传档案核验未返回成功终态');
  }
  invoke('ssh', [...sshArgs(), 'bash', '-s'], `set -eu\nmkdir -p '${STAGING}' '${path.posix.dirname(CANDIDATE)}'\n`, 45_000);
  const remainingArtifacts = release.artifacts.filter(artifact => !resumeInfo?.completedNames.has(path.basename(artifact.path)));
  const pendingRows = remainingArtifacts.map(artifact => {
    const target = `${STAGING}/${path.basename(artifact.path)}`;
    let row = transferReceipt.find(item => item.target === target);
    if (row) { row.status = 'pending'; delete row.error; }
    else { row = { source: artifact.path, target, role: artifact.role, status: 'pending' }; transferReceipt.push(row); }
    return { artifact, row };
  });
  try {
    invoke('scp', scpBatchArgs(IDENTITY, PORT, HOST, STAGING, remainingArtifacts), undefined, 180_000);
    for (const { artifact, row } of pendingRows) {
      row.status = 'transferred';
      actualTransferred.push({ source: artifact.path, target: row.target, role: artifact.role });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    for (const { row } of pendingRows) row.status = 'batch-transfer-unconfirmed';
    const failureReceipt = { mode: 'prepare', sourceRevision: release.sourceRevision, status: 'failed', commandExitCode: 1,
      artifactTransfers: transferReceipt, skippedAlreadyTransferred, actualTransferred, transferError: detail };
    throw new Error(`artifact batch transfer failed; prepareFailureReceipt=${JSON.stringify(failureReceipt)}`);
  }
  const revision = release.sourceRevision;
  const candidateAction = preflightInfo.candidate === 'reuse'
    ? `printf 'candidate reused after receipt, link, hardlink, and occupancy checks: %s\\n' '${CANDIDATE}'`
    : `mkdir -m 0755 '${CANDIDATE}'\ntar -xf '${STAGING}/server-code.tar' --no-same-owner --no-same-permissions -C '${CANDIDATE}'\ninstall -m 0644 '${STAGING}/resonance-references.zip' '${CANDIDATE}/public/resonance-references.zip'\ninstall -m 0644 '${STAGING}/server-release.json' '${CANDIDATE}/.resonance-release-receipt.json'`;
  const replacedJson = preflightInfo.replacedStagedRevision == null ? 'null' : `"${preflightInfo.replacedStagedRevision}"`;
  const remotePrepare = `set -eu\nfor f in '${STAGING}/server-code.tar' '${STAGING}/resonance-references.zip' '${STAGING}/package.json' '${STAGING}/package-lock.json' '${STAGING}/server-release.json'; do test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "staged-file-invalid:$f"; exit 41; }; done\nif test '${preflightInfo.installState}' = install; then test ! -e '${INSTALL_ROOT}/package.json' && test ! -e '${INSTALL_ROOT}/package-lock.json' && test ! -e '${INSTALL_ROOT}/node_modules'; cp '${STAGING}/package.json' '${INSTALL_ROOT}/package.json'; cp '${STAGING}/package-lock.json' '${INSTALL_ROOT}/package-lock.json'; timeout 180s '${REMOTE_NODE}' '${REMOTE_NPM_CLI}' ci --ignore-scripts --omit=dev --no-audit --no-fund --prefix '${INSTALL_ROOT}'; fi\n${candidateAction}\ntest -f '${CANDIDATE}/server/index.js'\ntest -f '${CANDIDATE}/public/resonance.html'\nprintf '{"prepared":true,"sourceRevision":"${revision}","replacedStagedRevision":${replacedJson},"candidate":"${CANDIDATE}","candidateAction":"${preflightInfo.candidate}","wsVersion":"${release.wsVersion}","artifactTransfers":${JSON.stringify(transferReceipt)},"skippedAlreadyTransferred":${JSON.stringify(skippedAlreadyTransferred)},"actualTransferred":${JSON.stringify(actualTransferred)}}\\n'`;
  try {
    return invoke('ssh', [...sshArgs(), 'timeout 180s bash -s'], remotePrepare, 180_000);
  } catch (error) {
    throw new Error(`remote prepare failed; artifact transfers=${JSON.stringify(transferReceipt)}; ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readPreviousReleaseRevision(receiptPath, nextRevision) {
  checkedRegularFile(receiptPath, 'previous release receipt');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const oldRevision = gitRevision(receipt.sourceRevision);
  validateCandidateRefreshRevisions(oldRevision, nextRevision);
  return oldRevision;
}

function refreshCandidateRemote(release, oldRevision, priorBatchReceipt) {
  if (!fs.existsSync(IDENTITY)) throw new Error(`SSH identity不存在：${IDENTITY}`);
  const archiveEntries = execFileSync(TAR_COMMAND, ['-tf', release.code.path], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const candidateFiles = archiveEntries.filter(name => !name.endsWith('/'));
  if (CANDIDATE_REFRESH_SOURCES.some(file => !candidateFiles.includes(file))) throw new Error('新release缺少获准的共鸣产品源文件');
  const candidateFileSet = new Set(candidateFiles);
  const changedPaths = execFileSync('git', ['-C', ROOT, 'diff', '--name-only', oldRevision, release.sourceRevision], { encoding: 'utf8' })
    .split(/\r?\n/).filter(file => candidateFileSet.has(file));
  const selectedSources = validateCandidateRefreshChangeSet(changedPaths);
  const selectedOldBytes = Object.fromEntries(['tools/resonance/capacity.mjs', 'public/css/resonance.css'].map(file => [
    file, execFileSync('git', ['-C', ROOT, 'show', `${oldRevision}:${file}`]).toString('base64'),
  ]));
  const oldProductBytes = Object.fromEntries(selectedSources.map(file => [
    file, execFileSync('git', ['-C', ROOT, 'show', `${oldRevision}:${file}`]).toString('base64'),
  ]));
  const newProductBytes = Object.fromEntries(selectedSources.map(file => [
    file, execFileSync('git', ['-C', ROOT, 'show', `${release.sourceRevision}:${file}`]).toString('base64'),
  ]));
  for (const file of selectedSources) {
    if (execFileSync(TAR_COMMAND, ['-xOf', release.code.path, file]).toString('base64') !== newProductBytes[file]) throw new Error(`new tar product bytes differ from Native Git: ${file}`);
  }
  const oldInvariantBytes = Object.fromEntries(CANDIDATE_REFRESH_INVARIANTS.map(file => [file, Buffer.from(selectedOldBytes[file], 'base64')]));
  const newInvariantBytes = Object.fromEntries(CANDIDATE_REFRESH_INVARIANTS.map(file => [file, execFileSync(TAR_COMMAND, ['-xOf', release.code.path, file])]));
  validateCandidateRefreshInvariantBytes(oldInvariantBytes, newInvariantBytes);
  const preflightScript = candidateRefreshPreflightScript({ oldRevision, newRevision: release.sourceRevision, expectedFiles: candidateFiles, selectedOldBytes });
  const preflightText = invoke('ssh', [...sshArgs(), 'bash', '-s'], preflightScript, 45_000);
  const preflight = JSON.parse(preflightText);
  if (preflight.preflight !== 'ok' || preflight.oldRevision !== oldRevision || preflight.newRevision !== release.sourceRevision || preflight.candidate !== CANDIDATE) throw new Error('候选原位刷新预检回执与本地Native版本不匹配');
  if (!priorBatchReceipt || priorBatchReceipt.sourceRevision !== oldRevision) throw new Error('本地已完成容量批次不属于候选旧Native');
  const archiveText = invoke('ssh', [...sshArgs(), 'bash', '-s'], archiveCompletedCapacityBatchScript(oldRevision), 60_000);
  const archived = JSON.parse(archiveText);
  if (archived.archived !== true || archived.sourceRevision !== oldRevision || archived.files?.length !== 5) throw new Error('旧Native容量批次未能精确保全归档');
  const transfers = release.artifacts.map(artifact => ({ source: artifact.path, target: `${STAGING}/${path.basename(artifact.path)}`, role: artifact.role }));
  invoke('scp', scpBatchArgs(IDENTITY, PORT, HOST, STAGING, release.artifacts), undefined, 180_000);
  const result = JSON.parse(invoke('ssh', [...sshArgs(), 'timeout 90s bash -s'], candidateSessionRefreshScript(oldRevision, release.sourceRevision,
    candidateFiles, selectedOldBytes, oldProductBytes, selectedSources), 120_000));
  if (result.refreshed !== true || result.candidate !== CANDIDATE || result.previousRevision !== oldRevision || result.sourceRevision !== release.sourceRevision) throw new Error('candidate refresh终态与预期不一致');
  return { ...result, staging: STAGING, archivedCapacityReceipt: priorBatchReceipt.localPath,
    archivedCapacityFiles: archived.files, artifactTransfers: transfers,
    updatedFiles: [...selectedSources, 'public/resonance-references.zip', '.resonance-release-receipt.json'] };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return process.stdout.write(`${HELP}\n`);
  if (options.selfTest) return selfTest();
  const receiptPath = absolutePath(options.receiptPath, '--release-receipt');
  const release = readReleaseReceipt(receiptPath);
  if (options.refreshCandidate) {
    const previousReceiptPath = absolutePath(options.previousReleaseReceiptPath, '--previous-release-receipt');
    const previousBatchPath = absolutePath(options.previousCapacityBatchReceiptPath, '--previous-capacity-batch-receipt');
    const oldRevision = readPreviousReleaseRevision(previousReceiptPath, release.sourceRevision);
    if (!previousBatchPath.replaceAll('\\', '/').endsWith('/runtime/resonance/deployment/capacity-batch-receipt.json')) throw new Error('previous capacity receipt must use runtime/resonance/deployment/capacity-batch-receipt.json');
    checkedRegularFile(previousBatchPath, 'previous capacity batch receipt');
    const previousBatch = capacityBatchReceiptFromStdout(fs.readFileSync(previousBatchPath, 'utf8'), oldRevision);
    const remoteResult = refreshCandidateRemote(release, oldRevision, { ...previousBatch, localPath: previousBatchPath });
    return process.stdout.write(`${JSON.stringify({ mode: 'refresh-candidate', oldRevision,
      sourceRevision: release.sourceRevision, previousReleaseReceipt: previousReceiptPath, previousCapacityBatchReceipt: previousBatchPath,
      staging: STAGING, candidate: CANDIDATE, updatedFiles: remoteResult.updatedFiles,
      remoteResult })}\n`);
  }
  if (options.capacityBatch) {
    if (!fs.existsSync(IDENTITY)) throw new Error(`SSH identity不存在：${IDENTITY}`);
    const localReceipt = prepareLocalBatchReceiptPath(options.localCapacityReceiptPath, release.sourceRevision);
    if (localReceipt.reuse) return process.stdout.write(`${JSON.stringify({ mode: 'capacity-batch', status: localReceipt.receipt.status,
      sourceRevision: release.sourceRevision, reusedExistingReceipt: true, localReceipt: localReceipt.target,
      archivedPreviousReceipt: null, remoteReceipt: `${STAGING}/capacity-batch-receipt.json`, sessionDirectory: CAPACITY_SESSION })}\n`);
    const command = capacityBatchCommand(release.sourceRevision);
    const stdout = invoke('ssh', command.args, command.input, command.timeoutMs);
    const batch = capacityBatchReceiptFromStdout(stdout, release.sourceRevision);
    writeLocalBatchReceipt(localReceipt.target, batch);
    return process.stdout.write(`${JSON.stringify({ mode: 'capacity-batch', status: batch.status, sourceRevision: batch.sourceRevision,
      localReceipt: localReceipt.target, archivedPreviousReceipt: localReceipt.archivedPreviousReceipt,
      remoteReceipt: `${STAGING}/capacity-batch-receipt.json`, sessionDirectory: CAPACITY_SESSION,
      phases: batch.phases.map(phase => ({ recording: phase.capacity.recording, concurrency: phase.capacity.concurrency,
        cpuUsageNSec: phase.cgroup.cpuUsageNSec, memoryPeakBytes: phase.cgroup.memoryPeakBytes,
        sessions: phase.capacity.sessions.length, replayGzipBytes: phase.capacity.sessions.reduce((sum, row) => sum + (row.replay?.gzipBytes || 0), 0) })) })}\n`);
  }
  const resumeInfo = options.resumeReceiptPath
    ? readPrepareResumeReceipt(absolutePath(options.resumeReceiptPath, '--resume-receipt'), release)
    : null;
  const replaceStagedRevision = options.replaceStagedRevision
    ? validateStagedReplacementRevision(options.replaceStagedRevision, release.sourceRevision)
    : null;
  if (options.activate) {
    const capacityReceiptPath = absolutePath(options.capacityReceiptPath, '--capacity-receipt');
    const capacity = readCapacityReceipt(capacityReceiptPath);
    let capacityCheck;
    let reuseEvidence = null;
    if (options.capacityTestedRevision) {
      const testedRevision = gitRevision(options.capacityTestedRevision);
      const changedPaths = execFileSync('git', ['-C', ROOT, 'diff', '--name-only', testedRevision, release.sourceRevision], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
      reuseEvidence = validateCapacityReuseEvidence(testedRevision, release.sourceRevision, capacity, changedPaths);
      capacityCheck = reuseEvidence.capacity;
    } else capacityCheck = validateCapacityReceipt(release.sourceRevision, capacity);
    const remoteResult = JSON.parse(activateRemote(release.sourceRevision));
    if (remoteResult.terminalStatus !== 'activated' || remoteResult.sourceRevision !== release.sourceRevision) throw new Error('远端activation terminal receipt与本地release不匹配');
    return process.stdout.write(`${JSON.stringify({ mode: 'activate', sourceRevision: release.sourceRevision,
      capacityReceipt: capacityReceiptPath, capacity: capacityCheck, ...(reuseEvidence ? { capacityReuseEvidence: reuseEvidence } : {}), remoteResult })}\n`);
  }
  const plan = {
    mode: options.prepare ? 'prepare' : 'dry-run', sourceRevision: release.sourceRevision,
    resumeReceipt: options.resumeReceiptPath ? absolutePath(options.resumeReceiptPath, '--resume-receipt') : null,
    replacedStagedRevision: replaceStagedRevision,
    filesToStage: release.artifacts.map(item => ({ path: item.path, role: item.role })),
    staging: STAGING, rulesData: RULES, installRoot: INSTALL_ROOT, candidate: CANDIDATE,
    protectedReadOnly: [SERVICE_UNIT, SERVICE_ENV], capacityCommand: capacityCommand(release.sourceRevision), capacityBatchCommand: capacityBatchCommand(release.sourceRevision), capacityTimeoutSeconds: 1080,
    note: 'public-rules.tar不传输；复用现有4ed canonical rules。不会启动或变更systemd服务。',
  };
  if (!options.prepare) return process.stdout.write(`${JSON.stringify(plan)}\n`);
  process.stdout.write(`${JSON.stringify({ ...plan, remoteResult: prepareRemote(release, resumeInfo, replaceStagedRevision) })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { main(); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
