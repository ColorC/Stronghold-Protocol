#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REMOTE_SCHEMA = 'resonance-resource-remote-receipt/v1';
export const DEFAULT_REMOTE_PATHS = Object.freeze({
  candidate: '/opt/stronghold-protocol/releases/resonance-candidate',
  staging: '/var/tmp/stronghold-protocol/resonance',
  sessions: '/var/lib/stronghold-protocol/resonance-sessions',
  capacityTests: '/var/lib/stronghold-protocol/capacity-tests/resonance',
  sharedPackageJson: '/opt/stronghold-protocol/package.json',
  sharedPackageLock: '/opt/stronghold-protocol/package-lock.json',
  sharedWs: '/opt/stronghold-protocol/node_modules/ws',
});

const HELP = `Read-only remote resonance resource audit.
node tools/resonance/remote-resource-audit.mjs --host user@host --identity <absolute-local-key> --source-revision <40-hex-commit> --current-release <absolute-linux-release-root> [--port 22] [--run]
Default prints the exact bounded SSH plan without connecting. --run performs read-only SSH/du and prints one ${REMOTE_SCHEMA} JSON receipt to stdout.`;

function linuxAbsolute(value, label) {
  if (typeof value !== 'string' || !path.posix.isAbsolute(value) || value.includes('\0') || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be a clean absolute Linux path`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value.replace(/\/$/, '') && value !== '/') throw new Error(`${label} must be normalized: ${value}`);
  return normalized;
}
function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }
export function parseArgs(argv) {
  const options = { port: '22', run: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--help' || key === '-h') { options.help = true; continue; }
    if (key === '--run') { options.run = true; continue; }
    if (!['--host', '--identity', '--source-revision', '--current-release', '--port'].includes(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[++i];
    if (!value) throw new Error(`${key} requires a value`);
    if (key === '--host') options.host = value;
    else if (key === '--identity') options.identity = value;
    else if (key === '--source-revision') options.sourceRevision = value.toLowerCase();
    else if (key === '--current-release') options.currentRelease = value;
    else options.port = value;
  }
  if (options.help) return options;
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(options.host ?? '')) throw new Error('--host must be user@host');
  if (!/^[0-9a-f]{40}$/.test(options.sourceRevision ?? '')) throw new Error('--source-revision must be a full 40-hex native Git commit');
  if (!/^[0-9]{1,5}$/.test(options.port) || Number(options.port) < 1 || Number(options.port) > 65535) throw new Error('--port must be 1..65535');
  if (!options.identity || !path.win32.isAbsolute(options.identity) && !path.posix.isAbsolute(options.identity)) throw new Error('--identity must be an absolute local SSH key path');
  options.currentRelease = linuxAbsolute(options.currentRelease, '--current-release');
  if (!/^\/opt\/stronghold-protocol\/releases\/[0-9a-f]{40}$/.test(options.currentRelease)) throw new Error('--current-release must be a versioned release root under /opt/stronghold-protocol/releases');
  return options;
}

export function buildPathRows(sourceRevision) {
  if (!/^[0-9a-f]{40}$/.test(sourceRevision ?? '')) throw new Error('invalid source revision');
  const paths = [
    ['candidate', DEFAULT_REMOTE_PATHS.candidate, 'pending resonance release candidate'],
    ['nativeRelease', `/opt/stronghold-protocol/releases/${sourceRevision}`, 'new native release for requested source revision'],
    ['remoteStaging', DEFAULT_REMOTE_PATHS.staging, 'resonance release staging'],
    ['resonanceSessions', DEFAULT_REMOTE_PATHS.sessions, 'resonance persistent sessions and replays'],
    ['capacityTests', DEFAULT_REMOTE_PATHS.capacityTests, 'resonance capacity-test sessions and receipts'],
    ['sharedPackageJson', DEFAULT_REMOTE_PATHS.sharedPackageJson, 'shared newly introduced ws package manifest'],
    ['sharedPackageLock', DEFAULT_REMOTE_PATHS.sharedPackageLock, 'shared newly introduced ws lock manifest'],
    ['sharedWs', DEFAULT_REMOTE_PATHS.sharedWs, 'shared newly introduced ws package'],
  ];
  return paths.map(([id, remotePath, purpose]) => {
    linuxAbsolute(remotePath, `${id} path`);
    if (![id, remotePath, purpose].every(value => typeof value === 'string' && !/[\t\r\n]/.test(value))) {
      throw new Error(`remote path table row contains a TSV separator: ${id}`);
    }
    return `${id}\t${remotePath}\t${purpose}`;
  }).join('\n');
}

export function buildAuditScript({ sourceRevision, currentRelease }) {
  if (!/^[0-9a-f]{40}$/.test(sourceRevision ?? '')) throw new Error('invalid source revision');
  currentRelease = linuxAbsolute(currentRelease, 'current release');
  if (!/^\/opt\/stronghold-protocol\/releases\/[0-9a-f]{40}$/.test(currentRelease)) throw new Error('current release root must be a versioned release directory');
  const rows = buildPathRows(sourceRevision);
  return `set -eu
REV=${shellQuote(sourceRevision)}
CURRENT=${shellQuote(currentRelease)}
NODE=/opt/stronghold-protocol/toolchain/node-v22.23.3-linux-x64/bin/node
test -f "$NODE" && test -x "$NODE" && test ! -L "$NODE" || { echo 'native-node-missing-or-unsafe' >&2; exit 31; }
read_revision() {
  root="$1"; manifest="$2"
  test -d "$root" && test ! -L "$root" || { echo "release-root-missing-or-unsafe:$root" >&2; exit 32; }
  test -f "$manifest" && test ! -L "$manifest" || { echo "release-manifest-missing-or-unsafe:$manifest" >&2; exit 33; }
  value=$("$NODE" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(r.sourceRevision||""))' "$manifest")
  printf '%s' "$value"
}
CURRENT_REV=$(read_revision "$CURRENT" "$CURRENT/.resonance-release-receipt.json")
printf '%s\\n' "$CURRENT_REV" | grep -Eq '^[0-9a-f]{40}$' || { echo 'current-release-native-revision-invalid' >&2; exit 34; }
CURRENT_PATH_REV=$(basename "$CURRENT")
test "$CURRENT_REV" = "$CURRENT_PATH_REV" || { echo 'current-release-path-revision-mismatch' >&2; exit 34; }
if test -e "/opt/stronghold-protocol/releases/$REV" || test -L "/opt/stronghold-protocol/releases/$REV"; then
  NEW_REV=$(read_revision "/opt/stronghold-protocol/releases/$REV" "/opt/stronghold-protocol/releases/$REV/.resonance-release-receipt.json")
  test "$NEW_REV" = "$REV" || { echo 'new-release-source-revision-mismatch' >&2; exit 35; }
else NEW_REV=missing; fi
if test -e '${DEFAULT_REMOTE_PATHS.candidate}' || test -L '${DEFAULT_REMOTE_PATHS.candidate}'; then
  test -d '${DEFAULT_REMOTE_PATHS.candidate}' && test ! -L '${DEFAULT_REMOTE_PATHS.candidate}' || { echo 'candidate-not-ordinary-directory' >&2; exit 36; }
  CANDIDATE_REV=$(read_revision '${DEFAULT_REMOTE_PATHS.candidate}' '${DEFAULT_REMOTE_PATHS.candidate}/.resonance-release-receipt.json')
  test "$CANDIDATE_REV" = "$REV" || { echo 'candidate-source-revision-mismatch' >&2; exit 37; }
else CANDIDATE_REV=missing; fi
HOSTNAME=$(hostname -f)
OBSERVED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"schema":"${REMOTE_SCHEMA}","source":"ssh-du","host":"%s","observedAt":"%s","purpose":"incremental resonance long-lived resources; old rollback releases and 4ed rules excluded","sourceRevision":"%s","currentRelease":{"path":"%s","sourceRevision":"%s","accounted":false},"entries":[' "$HOSTNAME" "$OBSERVED" "$REV" "$CURRENT" "$CURRENT_REV"
first=1
while IFS="$(printf '\\t')" read -r id target purpose; do
  test -n "$id" || continue
  if test -L "$target"; then echo "accounting-root-is-symlink:$target" >&2; exit 38; fi
  if test -e "$target"; then
    bytes=$(timeout 60s du -sb -- "$target" | awk 'NR==1 {print $1}')
    case "$bytes" in ''|*[!0-9]*) echo "du-output-invalid:$target" >&2; exit 39;; esac
    observed=true; status=measured
  else bytes=0; observed=false; status=missing; fi
  if test "$first" -eq 0; then printf ','; fi
  first=0
  printf '{"path":"%s","byteCount":%s,"purpose":"%s","observedAt":"%s","host":"%s","observed":%s,"status":"%s"}' "$target" "$bytes" "$purpose" "$OBSERVED" "$HOSTNAME" "$observed" "$status"
done <<'RES_PATHS'
${rows}
RES_PATHS
printf ']}\\n'
`;
}

export function commandPlan(options) {
  const script = buildAuditScript(options);
  const args = ['-i', options.identity, '-p', options.port, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=30', '-o', 'LogLevel=ERROR', options.host, 'timeout 90s bash -s'];
  return { command: 'ssh', args, script, connectTimeoutSeconds: 30, remoteDuTimeoutSeconds: 60, outerTimeoutMs: 95_000 };
}

export function runAudit(options, runner = spawnSync) {
  const plan = commandPlan(options);
  const result = runner(plan.command, plan.args, { input: plan.script, encoding: 'utf8', windowsHide: true, timeout: plan.outerTimeoutMs, killSignal: 'SIGTERM', maxBuffer: 2 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`read-only remote resource audit failed (exit ${result.status ?? 'timeout'}): ${(result.stderr || '').trim().slice(0, 400)}`);
  const receipt = JSON.parse(result.stdout);
  if (receipt.schema !== REMOTE_SCHEMA || receipt.source !== 'ssh-du' || receipt.sourceRevision !== options.sourceRevision || !Array.isArray(receipt.entries)) throw new Error('remote resource audit returned an incompatible receipt');
  return receipt;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return process.stdout.write(`${HELP}\n`);
  const plan = commandPlan(options);
  if (!options.run) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', host: options.host, sourceRevision: options.sourceRevision, currentRelease: options.currentRelease, command: plan.command, args: plan.args, connectTimeoutSeconds: 30, remoteDuTimeoutSeconds: 60, script: plan.script })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(runAudit(options))}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { main(); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
