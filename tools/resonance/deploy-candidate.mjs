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
const SOURCE_RULES_REVISION = '4ed1ad32ec10da15c23f9d7939dade603950759b';
const REMOTE_NODE = `${INSTALL_ROOT}/toolchain/node-v22.23.3-linux-x64/bin/node`;
const REMOTE_NPM_CLI = `${INSTALL_ROOT}/toolchain/node-v22.23.3-linux-x64/lib/node_modules/npm/bin/npm-cli.js`;
const OWNED_STAGE_NAMES = ['server-code.tar', 'resonance-references.zip', 'package.json', 'package-lock.json', 'server-release.json'];
const HELP = `用法：node tools/resonance/deploy-candidate.mjs --release-receipt <绝对路径> [--prepare]\n默认dry-run只读本地receipt/档案并打印预演；显式--prepare才进行SSH安全预检、SCP、解包与必要的npm ci。不会安装或启动systemd服务。`;

function parseArgs(argv) {
  const options = { prepare: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--prepare') options.prepare = true;
    else if (value === '--dry-run') options.prepare = false;
    else if (value === '--self-test') options.selfTest = true;
    else if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--release-receipt') {
      const next = argv[++i];
      if (!next || next.startsWith('--')) throw new Error('缺少 --release-receipt 路径');
      options.receiptPath = next;
    } else throw new Error(`未知参数：${value}`);
  }
  return options;
}

function absolutePath(value, label) {
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

function sshArgs() { return ['-i', IDENTITY, '-p', PORT, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=15', '-o', 'LogLevel=ERROR', '-o', 'ServerAliveInterval=15', HOST]; }

function preflightScript(wsVersion, revision, candidateFiles) {
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
  for f in '${STAGING}'/*; do test -e "$f" || continue; name=$(basename "$f"); case " ${stageNames} " in *" '$name' "*) ;; *) echo "staging-unknown:$f"; exit 25;; esac; test -f "$f" && test ! -L "$f" && test "$(stat -c %h "$f")" -eq 1 || { echo "staging-file-unsafe:$f"; exit 25; }; done
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
