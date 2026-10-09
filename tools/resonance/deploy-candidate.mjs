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
const RESONANCE_DIRECTORY = '/var/lib/stronghold-protocol/resonance-sessions';
const BACKUP_ROOT = STAGING;
const SOURCE_RULES_REVISION = '4ed1ad32ec10da15c23f9d7939dade603950759b';
const REMOTE_NODE = `${INSTALL_ROOT}/toolchain/node-v22.23.3-linux-x64/bin/node`;
const REMOTE_NPM_CLI = `${INSTALL_ROOT}/toolchain/node-v22.23.3-linux-x64/lib/node_modules/npm/bin/npm-cli.js`;
const OWNED_STAGE_NAMES = ['server-code.tar', 'resonance-references.zip', 'package.json', 'package-lock.json', 'server-release.json'];
const HELP = `用法：node tools/resonance/deploy-candidate.mjs --release-receipt <绝对路径> [--prepare | --activate --capacity-receipt <绝对路径>]\n默认dry-run只读本地receipt/档案并打印预演；--prepare准备候选；--activate要求匹配的四并发容量回执，有界切换服务，失败恢复原unit/env。`;

export function parseArgs(argv) {
  const options = { prepare: false, activate: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--prepare') options.prepare = true;
    else if (value === '--dry-run') options.prepare = false;
    else if (value === '--activate') options.activate = true;
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
    } else throw new Error(`未知参数：${value}`);
  }
  if (options.prepare && options.activate) throw new Error('--prepare 与 --activate 不能同时使用');
  if (options.activate && !options.capacityReceiptPath) throw new Error('--activate 必须提供 --capacity-receipt');
  if (!options.activate && options.capacityReceiptPath) throw new Error('--capacity-receipt 只能与 --activate 一起使用');
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
  const listing = execFileSync('tar', ['-tf', code.path], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  if (!listing.includes('server/index.js') || !listing.includes('public/resonance.html')) throw new Error('server-code.tar缺少共鸣服务入口');
  const verbose = execFileSync('tar', ['-tvf', code.path], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  validateArchiveListing(listing, verbose);
  return { sourceRevision, receiptPath, code, references, packageJson, packageLock, wsVersion,
    artifacts: [{ path: receiptPath, role: 'native builder receipt' }, code, references, packageJson, packageLock] };
}

function capacityCommand(revision) {
  return `timeout 480s ${REMOTE_NODE} --max-old-space-size=384 ${CANDIDATE}/tools/resonance/capacity.mjs --data-dir ${RULES} --session-dir ${CAPACITY_SESSION} --receipt ${CAPACITY_RECEIPT} --release-receipt ${STAGING}/server-release.json --source-revision ${revision} --concurrency 4`;
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

export function preflightScript(wsVersion, revision, candidateFiles) {
  const expected = [...new Set([...candidateFiles, 'public/resonance-references.zip', '.resonance-release-receipt.json'])].sort();
  const stageNames = OWNED_STAGE_NAMES.map(name => `'${name}'`).join(' ');
  const expectedLines = expected.map(name => `'${name}'`).join(' ');
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
  for f in '${STAGING}'/*; do test -e "$f" || continue; name=$(basename "$f"); case "$name" in 'stronghold-protocol.${revision}.unit.backup'|'stronghold-protocol.${revision}.env.backup') test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "staging-backup-unsafe:$f"; exit 25; }; continue;; esac; case " ${stageNames} " in *" '$name' "*) ;; *) echo "staging-unknown:$f"; exit 25;; esac; test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "staging-file-unsafe:$f"; exit 25; }; done
  if test -f '${STAGING}/server-release.json'; then staged_revision=$('${REMOTE_NODE}' -e 'const r=require(process.argv[1]);process.stdout.write(String(r.sourceRevision||""))' '${STAGING}/server-release.json'); test "$staged_revision" = '${revision}' || { echo 'staging-source-revision-mismatch:${STAGING}/server-release.json'; exit 25; }; fi
fi
for f in '${INSTALL_ROOT}/package.json' '${INSTALL_ROOT}/package-lock.json' '${INSTALL_ROOT}/node_modules'; do if test -e "$f" || test -L "$f"; then test ! -L "$f" || { echo "install-link:$f"; exit 26; }; fi; done
if test -e '${INSTALL_ROOT}/package.json'; then test -f '${INSTALL_ROOT}/package.json' || { echo 'package-json-not-file:${INSTALL_ROOT}/package.json'; exit 27; }; fi
if test -e '${INSTALL_ROOT}/package-lock.json'; then test -f '${INSTALL_ROOT}/package-lock.json' || { echo 'package-lock-not-file:${INSTALL_ROOT}/package-lock.json'; exit 27; }; fi
if test -e '${INSTALL_ROOT}/node_modules'; then test -d '${INSTALL_ROOT}/node_modules' || { echo 'node_modules-not-dir:${INSTALL_ROOT}/node_modules'; exit 27; }; fi
if test -d '${INSTALL_ROOT}'; then install_state=$('${REMOTE_NODE}' -e 'const fs=require("fs"),p="${INSTALL_ROOT}",want="${wsVersion}",names=["package.json","package-lock.json","node_modules"],have=names.map(n=>fs.existsSync(p+"/"+n));if(have.every(Boolean)){for(const f of [p+"/package.json",p+"/package-lock.json",p+"/node_modules/ws",p+"/node_modules/ws/package.json"])if(fs.lstatSync(f).isSymbolicLink()){console.error("install-link:"+f);process.exit(31)}const a=require(p+"/package.json"),b=require(p+"/package-lock.json"),c=require(p+"/node_modules/ws/package.json");if(JSON.stringify(a.dependencies)!==JSON.stringify({ws:want})||b.packages?.["node_modules/ws"]?.version!==want||c.version!==want){console.error("install-version-mismatch:${INSTALL_ROOT}/package.json ${INSTALL_ROOT}/package-lock.json ${INSTALL_ROOT}/node_modules/ws/package.json");process.exit(32)}process.stdout.write("reuse")}else if(have.every(v=>!v))process.stdout.write("install");else {console.error("install-partial:${INSTALL_ROOT}");process.exit(33)}'); else install_state=install; fi
for f in '${SERVICE_UNIT}' '${SERVICE_ENV}'; do if test -e "$f"; then test -f "$f" && test ! -L "$f" || { echo "protected-file-not-ordinary:$f"; exit 28; }; fi; done
printf '{"preflight":"ok","installState":"%s","candidate":"%s","staging":"known-owned-only"}\\n' "$install_state" "$candidate_state"`;
}

function invoke(command, args, input, timeoutMs) {
  const result = spawnSync(command, args, { encoding: 'utf8', input, timeout: timeoutMs, killSignal: 'SIGTERM', maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command}失败（exit ${result.status ?? 'timeout'}）：${(result.stderr || result.stdout || '').trim().slice(0, 500)}`);
  return result.stdout.trim();
}

function prepareRemote(release) {
  if (!fs.existsSync(IDENTITY)) throw new Error(`SSH identity不存在：${IDENTITY}`);
  const archiveEntries = execFileSync('tar', ['-tf', release.code.path], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const candidateFiles = archiveEntries.filter(name => !name.endsWith('/'));
  const preflight = invoke('ssh', [...sshArgs(), 'bash', '-s'], preflightScript(release.wsVersion, release.sourceRevision, candidateFiles), 45_000);
  const preflightInfo = JSON.parse(preflight);
  if (preflightInfo.preflight !== 'ok' || !['install', 'reuse'].includes(preflightInfo.installState)) throw new Error('远端安全预检未通过');
  const transferReceipt = [];
  invoke('ssh', [...sshArgs(), 'bash', '-s'], `set -eu\nmkdir -p '${STAGING}' '${path.posix.dirname(CANDIDATE)}'\n`, 45_000);
  for (const artifact of release.artifacts) {
    const target = `${STAGING}/${path.basename(artifact.path)}`;
    const entry = { source: artifact.path, target, role: artifact.role, status: 'pending' };
    transferReceipt.push(entry);
    try {
      invoke('scp', ['-i', IDENTITY, '-P', PORT, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=15', '-o', 'LogLevel=ERROR', '-o', 'ServerAliveInterval=15', artifact.path, `${HOST}:${target}`], undefined, 120_000);
      entry.status = 'transferred';
    } catch (error) {
      entry.status = 'failed';
      entry.error = error instanceof Error ? error.message : String(error);
      throw new Error(`artifact transfer failed; receipt=${JSON.stringify(transferReceipt)}`);
    }
  }
  const revision = release.sourceRevision;
  const candidateAction = preflightInfo.candidate === 'reuse'
    ? `printf 'candidate reused after receipt, link, hardlink, and occupancy checks: %s\\n' '${CANDIDATE}'`
    : `mkdir -m 0755 '${CANDIDATE}'\ntar -xf '${STAGING}/server-code.tar' --no-same-owner --no-same-permissions -C '${CANDIDATE}'\ninstall -m 0644 '${STAGING}/resonance-references.zip' '${CANDIDATE}/public/resonance-references.zip'\ninstall -m 0644 '${STAGING}/server-release.json' '${CANDIDATE}/.resonance-release-receipt.json'`;
  const remotePrepare = `set -eu\nfor f in '${STAGING}/server-code.tar' '${STAGING}/resonance-references.zip' '${STAGING}/package.json' '${STAGING}/package-lock.json' '${STAGING}/server-release.json'; do test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "staged-file-invalid:$f"; exit 41; }; done\nif test '${preflightInfo.installState}' = install; then test ! -e '${INSTALL_ROOT}/package.json' && test ! -e '${INSTALL_ROOT}/package-lock.json' && test ! -e '${INSTALL_ROOT}/node_modules'; cp '${STAGING}/package.json' '${INSTALL_ROOT}/package.json'; cp '${STAGING}/package-lock.json' '${INSTALL_ROOT}/package-lock.json'; timeout 180s '${REMOTE_NODE}' '${REMOTE_NPM_CLI}' ci --ignore-scripts --omit=dev --no-audit --no-fund --prefix '${INSTALL_ROOT}'; fi\n${candidateAction}\ntest -f '${CANDIDATE}/server/index.js'\ntest -f '${CANDIDATE}/public/resonance.html'\nprintf '{"prepared":true,"sourceRevision":"${revision}","candidate":"${CANDIDATE}","candidateAction":"${preflightInfo.candidate}","wsVersion":"${release.wsVersion}","artifactTransfers":${JSON.stringify(transferReceipt)}}\\n'`;
  try {
    return invoke('ssh', [...sshArgs(), 'timeout 180s bash -s'], remotePrepare, 180_000);
  } catch (error) {
    throw new Error(`remote prepare failed; artifact transfers=${JSON.stringify(transferReceipt)}; ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return process.stdout.write(`${HELP}\n`);
  if (options.selfTest) return selfTest();
  const receiptPath = absolutePath(options.receiptPath, '--release-receipt');
  const release = readReleaseReceipt(receiptPath);
  if (options.activate) {
    const capacityReceiptPath = absolutePath(options.capacityReceiptPath, '--capacity-receipt');
    const capacity = readCapacityReceipt(capacityReceiptPath);
    const capacityCheck = validateCapacityReceipt(release.sourceRevision, capacity);
    const remoteResult = JSON.parse(activateRemote(release.sourceRevision));
    if (remoteResult.terminalStatus !== 'activated' || remoteResult.sourceRevision !== release.sourceRevision) throw new Error('远端activation terminal receipt与本地release不匹配');
    return process.stdout.write(`${JSON.stringify({ mode: 'activate', sourceRevision: release.sourceRevision,
      capacityReceipt: capacityReceiptPath, capacity: capacityCheck, remoteResult })}\n`);
  }
  const plan = {
    mode: options.prepare ? 'prepare' : 'dry-run', sourceRevision: release.sourceRevision,
    filesToStage: release.artifacts.map(item => ({ path: item.path, role: item.role })),
    staging: STAGING, rulesData: RULES, installRoot: INSTALL_ROOT, candidate: CANDIDATE,
    protectedReadOnly: [SERVICE_UNIT, SERVICE_ENV], capacityCommand: capacityCommand(release.sourceRevision), capacityTimeoutSeconds: 480,
    note: 'public-rules.tar不传输；复用现有4ed canonical rules。不会启动或变更systemd服务。',
  };
  if (!options.prepare) return process.stdout.write(`${JSON.stringify(plan)}\n`);
  process.stdout.write(`${JSON.stringify({ ...plan, remoteResult: prepareRemote(release) })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { main(); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
