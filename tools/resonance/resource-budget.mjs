import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const DEFAULT_WORKTREE = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/resonance/stronghold-protocol';
const CANONICAL = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const LIMIT_BYTES = 2_000_000_000;
const BASE_COMMIT = '4ed1ad32ec10da15c23f9d7939dade603950759b';
const DEFAULTS = [
  { role: 'worktree-full-tree', path: DEFAULT_WORKTREE, note: '本职责簇工作树全量，包含.git文件；所有文件和节点模块均计入。' },
  { role: 'canonical-reference-input', path: `${CANONICAL}/data/resonance-reference`, note: '本路线使用的正式参考输入，全量计入。' },
  { role: 'canonical-resonance-staging', path: `${CANONICAL}/.omni/tmp/resonance`, note: '本路线临时staging，全量计入；不存在时明确列为missing。' },
  { role: 'canonical-resonance-runtime', path: `${CANONICAL}/runtime/resonance`, note: '本路线运行区，全量计入；不存在时明确列为missing。' },
];

function normalizeAbsolute(input, label) {
  if (!path.win32.isAbsolute(input)) throw new Error(`${label}路径必须为绝对路径：${input}`);
  return path.win32.resolve(input).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
}
function isWithin(file, root) { return file === root || file.startsWith(`${root.replace(/\/$/, '')}/`); }
export function parseArgs(argv) {
  const extra = [];
  let worktreeRoot = DEFAULT_WORKTREE;
  let remoteReceipt = null;
  let sourceRevision = 'HEAD';
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--worktree-root') {
      worktreeRoot = argv[++i];
      if (!worktreeRoot) throw new Error('--worktree-root 后必须提供绝对路径');
      continue;
    }
    if (flag === '--remote-receipt') {
      remoteReceipt = argv[++i];
      if (!remoteReceipt || !path.win32.isAbsolute(remoteReceipt)) throw new Error('--remote-receipt 后必须提供JSON文件的绝对路径');
      continue;
    }
    if (flag === '--source-revision') {
      sourceRevision = argv[++i];
      if (!sourceRevision) throw new Error('--source-revision 后必须提供native Git revision');
      continue;
    }
    if (flag !== '--candidate' && flag !== '--publish') throw new Error(`未知参数：${flag}`);
    const value = argv[++i];
    if (!value) throw new Error(`${flag} 后必须提供绝对路径`);
    extra.push({ role: flag.slice(2), path: value, note: `${flag.slice(2)}路径存在时全量计入。` });
  }
  return { extra, worktreeRoot, remoteReceipt, sourceRevision };
}
function runGit(root, args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options });
}
const REMOTE_SCHEMA = 'resonance-resource-remote-receipt/v1';
export function resourceAuditPlan({ worktreeRoot, canonicalRoot, worktreeAvailable, sourceRevision = 'HEAD' }) {
  const worktreeAbs = normalizeAbsolute(worktreeRoot, 'worktree');
  const canonicalAbs = normalizeAbsolute(canonicalRoot, 'canonical');
  const sameAsCanonical = worktreeAbs === canonicalAbs;
  const independentWorktree = Boolean(worktreeAvailable && !sameAsCanonical);
  return {
    sourceRoot: independentWorktree ? worktreeRoot : canonicalRoot,
    sourceRevision,
    sameAsCanonical,
    independentWorktree,
    worktreeAccounting: independentWorktree ? 'full-worktree' : sameAsCanonical ? 'canonical-root-not-counted-as-worktree' : 'missing-worktree-zero',
  };
}
export function revisionDeltaRange(baseCommit, sourceRevision) { return `${baseCommit}..${sourceRevision}`; }
export function changedPathArgs(baseCommit, sourceRevision) {
  return ['diff', '--name-only', '-z', '--no-renames', baseCommit, sourceRevision];
}
export function shouldScanIndependentWorktree(plan) { return Boolean(plan?.independentWorktree); }
export function resolveNativeRevision(root, requestedRevision, gitRunner = runGit) {
  return gitRunner(root, ['rev-parse', '--verify', `${requestedRevision}^{commit}`]).trim();
}
export function nativeChangedPaths(root, baseCommit, sourceRevision, gitRunner = runGit) {
  return gitRunner(root, changedPathArgs(baseCommit, sourceRevision)).split('\0').filter(Boolean);
}
export function nativeObjectIds(root, baseCommit, sourceRevision, gitRunner = runGit) {
  return [...new Set(gitRunner(root, ['rev-list', '--objects', revisionDeltaRange(baseCommit, sourceRevision)])
    .trim().split(/\r?\n/).filter(Boolean).map((line) => line.trim().split(/\s+/, 1)[0]).filter(Boolean))];
}
function remoteReceiptAccounting(receipt) {
  if (!receipt || receipt.schema !== REMOTE_SCHEMA) throw new Error(`remote receipt schema 必须为 ${REMOTE_SCHEMA}`);
  if (receipt.source !== 'ssh-du') throw new Error('remote receipt.source 必须明确为 ssh-du');
  const entries = receipt.entries;
  if (!Array.isArray(entries)) throw new Error('remote receipt.entries 必须是数组');
  const normalized = entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || !path.posix.isAbsolute(entry.path)) throw new Error(`remote receipt entries[${index}].path 必须是Linux绝对路径`);
    if (!Number.isSafeInteger(entry.byteCount) || entry.byteCount < 0) throw new Error(`remote receipt entries[${index}].byteCount 必须是非负安全整数`);
    const observedAt = entry.observedAt ?? receipt.observedAt;
    const purpose = entry.purpose ?? receipt.purpose;
    if (typeof observedAt !== 'string' || !observedAt.trim()) throw new Error(`remote receipt entries[${index}] 缺少 observedAt`);
    if (typeof purpose !== 'string' || !purpose.trim()) throw new Error(`remote receipt entries[${index}] 缺少 purpose`);
    const scope = String(entry.host ?? receipt.host ?? 'remote-default');
    const remotePath = path.posix.normalize(entry.path);
    return { path: remotePath, byteCount: entry.byteCount, observedAt, purpose, host: scope, coveredBy: null, chargedBytes: 0 };
  });
  for (let i = 0; i < normalized.length; i++) for (let j = 0; j < i; j++) {
    if (normalized[i].host === normalized[j].host && normalized[i].path === normalized[j].path) throw new Error(`remote receipt重复路径：${normalized[i].host}:${normalized[i].path}`);
  }
  normalized.sort((a, b) => a.host.localeCompare(b.host) || a.path.length - b.path.length || a.path.localeCompare(b.path));
  let bytes = 0;
  const charged = [];
  for (const entry of normalized) {
    const ancestor = charged.find((candidate) => candidate.host === entry.host && (candidate.path === '/' || entry.path.startsWith(`${candidate.path.replace(/\/$/, '')}/`)));
    if (ancestor) entry.coveredBy = ancestor.path;
    else { entry.chargedBytes = entry.byteCount; bytes += entry.byteCount; charged.push(entry); }
  }
  return { schema: receipt.schema, source: receipt.source ?? null, observedAt: receipt.observedAt ?? null, purpose: receipt.purpose ?? null, bytes, entries: normalized };
}
function existsLstat(target) {
  try { return lstatSync(target); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
}
function rootStatWithoutFollowingLinks(target) {
  const resolved = path.win32.resolve(target);
  const parsed = path.win32.parse(resolved);
  let current = parsed.root;
  let stat = existsLstat(current);
  for (const part of resolved.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean)) {
    current = path.win32.join(current, part);
    stat = existsLstat(current);
    if (!stat || stat.isSymbolicLink()) return { stat, linkPath: stat?.isSymbolicLink() ? current : null };
  }
  return { stat, linkPath: null };
}

function runAudit(argv = process.argv.slice(2)) {
const parsedArgs = parseArgs(argv);
const WORKTREE = path.win32.resolve(parsedArgs.worktreeRoot).replaceAll('\\', '/');
const worktreeProbe = rootStatWithoutFollowingLinks(WORKTREE);
const sourcePlan = resourceAuditPlan({ worktreeRoot: WORKTREE, canonicalRoot: CANONICAL,
  worktreeAvailable: Boolean(worktreeProbe.stat && !worktreeProbe.linkPath), sourceRevision: parsedArgs.sourceRevision });
const SOURCE_ROOT = sourcePlan.sourceRoot;
const inputs = [
  { ...DEFAULTS[0], path: WORKTREE },
  ...DEFAULTS.slice(1),
  ...parsedArgs.extra,
].map((item) => ({ ...item, abs: normalizeAbsolute(item.path, item.role) }));
for (let i = 0; i < inputs.length; i++) for (let j = i + 1; j < inputs.length; j++) {
  if (inputs[i].abs === inputs[j].abs) throw new Error(`重复的预算路径：${inputs[i].path} 与 ${inputs[j].path}`);
}

const git = { branch: null, commit: null, versionIdentityIsInformationalOnly: true, error: null };
git.sourceRoot = SOURCE_ROOT;
git.requestedSourceRevision = parsedArgs.sourceRevision;
git.worktreeAccounting = sourcePlan.worktreeAccounting;
try { git.branch = runGit(SOURCE_ROOT, ['branch', '--show-current']).trim(); } catch (error) { git.error = error.message; }
try { git.commit = resolveNativeRevision(SOURCE_ROOT, parsedArgs.sourceRevision); } catch (error) { git.error ??= error.message; }

const entries = inputs.map((item) => {
  const checked = rootStatWithoutFollowingLinks(item.path);
  return {
    ...item,
    exists: Boolean(checked.stat),
    rootIsLink: Boolean(checked.linkPath),
    rootLinkPath: checked.linkPath,
    rootStat: checked.stat,
    bytes: 0,
    files: 0,
    chargedBytes: 0,
    links: [],
    hardlinks: [],
  };
});
const existingRoots = entries.filter((entry) => entry.exists && !entry.rootIsLink
  && !(sourcePlan.sameAsCanonical && entry.role === 'worktree-full-tree'));
const traversalRoots = existingRoots.filter((entry) => !existingRoots.some((candidate) => candidate !== entry && candidate.abs.length < entry.abs.length && isWithin(entry.abs, candidate.abs)));
const diagnostics = [];
if (git.error) diagnostics.push({ code: 'native-git-identity-read-failed', message: git.error });
let totalBytes = 0;
let filesObserved = 0;
let linksObserved = 0;
let hardlinkFilesObserved = 0;
const seenLinkPaths = new Set();

function matchingScopes(normalizedPath) {
  return existingRoots.filter((entry) => isWithin(normalizedPath, entry.abs));
}
function recordEntry(absPath, stat, chargeRoot, type) {
  const normalizedPath = absPath.replaceAll('\\', '/').toLowerCase();
  const scopes = matchingScopes(normalizedPath);
  const record = { path: absPath, bytes: stat.size, nlink: stat.nlink, entryType: type };
  filesObserved++;
  totalBytes += stat.size;
  chargeRoot.chargedBytes += stat.size;
  for (const scope of scopes) {
    scope.bytes += stat.size;
    scope.files++;
    if (type === 'link') scope.links.push(record);
    if (type === 'file' && stat.nlink > 1) scope.hardlinks.push(record);
  }
  if (type === 'link') {
    linksObserved++;
    seenLinkPaths.add(normalizedPath);
    diagnostics.push({ code: 'reparse-or-symlink', path: absPath, bytes: stat.size, action: 'not-followed' });
  }
  if (type === 'file' && stat.nlink > 1) {
    hardlinkFilesObserved++;
    diagnostics.push({ code: 'hardlink-nlink-greater-than-one', path: absPath, bytes: stat.size, nlink: stat.nlink, accounting: 'logical-path-bytes-counted-in-full' });
  }
}
function walk(absPath, chargeRoot) {
  const stat = existsLstat(absPath);
  if (!stat) return;
  if (stat.isSymbolicLink()) { recordEntry(absPath, stat, chargeRoot, 'link'); return; }
  if (stat.isFile()) { recordEntry(absPath, stat, chargeRoot, 'file'); return; }
  if (!stat.isDirectory()) return;
  for (const name of readdirSync(absPath)) walk(path.join(absPath, name), chargeRoot);
}

for (const root of traversalRoots) walk(root.path, root);
for (const entry of entries) {
  if (!entry.exists) diagnostics.push({ code: 'missing-path', path: entry.path, role: entry.role });
  const parent = entries.filter((candidate) => candidate !== entry && candidate.abs.length < entry.abs.length && isWithin(entry.abs, candidate.abs)).sort((a, b) => b.abs.length - a.abs.length)[0];
  const traversalParent = traversalRoots.find((candidate) => candidate !== entry && isWithin(entry.abs, candidate.abs));
  if (parent) entry.coveredBy = parent.path;
  if (entry.rootIsLink) {
    const record = { path: entry.rootLinkPath, requestedRoot: entry.path, bytes: entry.rootStat.size, nlink: entry.rootStat.nlink, entryType: 'link' };
    entry.links.push(record);
    entry.bytes = entry.rootStat.size;
    entry.files = 1;
    const normalizedLinkPath = entry.rootLinkPath.replaceAll('\\', '/').toLowerCase();
    if (!seenLinkPaths.has(normalizedLinkPath)) {
      seenLinkPaths.add(normalizedLinkPath);
      entry.chargedBytes = entry.rootStat.size;
      totalBytes += entry.rootStat.size;
      filesObserved++;
      linksObserved++;
      diagnostics.push({ code: 'reparse-or-symlink', path: entry.rootLinkPath, requestedRoot: entry.path, bytes: entry.rootStat.size, action: 'not-followed' });
    }
  }
  if (sourcePlan.sameAsCanonical && entry.role === 'worktree-full-tree') {
    entry.independentWorktree = false;
    entry.budgetContribution = 'not-an-independent-worktree';
  } else if (entry.exists) {
    if (traversalParent) {
      entry.budgetContribution = 'covered-by-parent';
    } else entry.budgetContribution = 'charged-once';
  } else entry.budgetContribution = 'missing-zero';
}

function scanGitMetadata(rootPath) {
  const result = { path: rootPath, bytes: 0, files: 0, links: [], hardlinks: [] };
  function visit(target) {
    const stat = existsLstat(target);
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      const record = { path: target, bytes: stat.size, nlink: stat.nlink, entryType: 'link' };
      result.links.push(record); result.bytes += stat.size; result.files++;
      linksObserved++; filesObserved++; totalBytes += stat.size;
      diagnostics.push({ code: 'reparse-or-symlink', path: target, bytes: stat.size, action: 'not-followed' });
      return;
    }
    if (stat.isFile()) {
      const record = { path: target, bytes: stat.size, nlink: stat.nlink, entryType: 'file' };
      result.bytes += stat.size; result.files++; filesObserved++; totalBytes += stat.size;
      if (stat.nlink > 1) {
        result.hardlinks.push(record); hardlinkFilesObserved++;
        diagnostics.push({ code: 'hardlink-nlink-greater-than-one', path: target, bytes: stat.size, nlink: stat.nlink, accounting: 'logical-path-bytes-counted-in-full' });
      }
      return;
    }
    if (stat.isDirectory()) for (const name of readdirSync(target)) visit(path.join(target, name));
  }
  visit(rootPath);
  return result;
}

const gitStorage = {
  baselineCommit: BASE_COMMIT,
  sourceRevision: git.commit,
  sourceRoot: SOURCE_ROOT,
  worktreeGitDir: null,
  commonGitDir: null,
  deltaObjects: 0,
  deltaObjectDiskBytes: 0,
  objectAccounting: 'native git rev-list BASE..sourceRevision object difference, sized by git cat-file --batch-check=%(objectname) %(objectsize:disk)',
  worktreeMetadata: null,
  independentWorktreeMetadata: sourcePlan.independentWorktree,
  error: null,
};
try {
  gitStorage.commonGitDir = runGit(SOURCE_ROOT, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  if (shouldScanIndependentWorktree(sourcePlan)) gitStorage.worktreeGitDir = runGit(WORKTREE, ['rev-parse', '--absolute-git-dir']).trim();
  else gitStorage.worktreeMetadata = { path: null, bytes: 0, files: 0, links: [], hardlinks: [], status: sourcePlan.worktreeAccounting };
  const objectIds = nativeObjectIds(SOURCE_ROOT, BASE_COMMIT, git.commit);
  if (objectIds.length) {
    const sized = execFileSync('git', ['-C', SOURCE_ROOT, 'cat-file', '--batch-check=%(objectname) %(objectsize:disk)'], {
      input: `${objectIds.join('\n')}\n`, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    });
    for (const line of sized.split(/\r?\n/).filter(Boolean)) {
      const [, diskSize] = line.trim().split(/\s+/);
      if (!/^\d+$/.test(diskSize ?? '')) throw new Error(`Git对象存储大小无法解析：${line}`);
      gitStorage.deltaObjectDiskBytes += Number(diskSize);
    }
  }
  gitStorage.deltaObjects = objectIds.length;
  totalBytes += gitStorage.deltaObjectDiskBytes;
  filesObserved += objectIds.length;
  if (shouldScanIndependentWorktree(sourcePlan)) gitStorage.worktreeMetadata = scanGitMetadata(gitStorage.worktreeGitDir);
} catch (error) {
  gitStorage.error = error.message;
  diagnostics.push({ code: 'native-git-storage-accounting-failed', message: error.message });
}

const canonicalPromotion = { role: 'canonical-promoted-source', root: CANONICAL, baselineCommit: BASE_COMMIT, sourceRevision: git.commit, status: 'unknown', bytes: 0, files: 0, chargedBytes: 0, changedPaths: [], missingPaths: [], links: [], coveredPaths: [], fileRecords: [] };
try {
  const relativePaths = nativeChangedPaths(SOURCE_ROOT, BASE_COMMIT, git.commit);
  canonicalPromotion.taskChangedPathCount = relativePaths.length;
  canonicalPromotion.pathSource = `native git diff ${BASE_COMMIT}..${git.commit}`;
  const visited = new Set();
  for (const relative of relativePaths) {
    const absolute = path.win32.resolve(CANONICAL, ...relative.split(/[\\/]+/));
    canonicalPromotion.changedPaths.push(relative.replaceAll('\\', '/'));
    const measured = rootStatWithoutFollowingLinks(absolute);
    if (!measured.stat) { canonicalPromotion.missingPaths.push(absolute); continue; }
    const observedPath = measured.linkPath || absolute;
    const normalized = path.win32.resolve(observedPath).replaceAll('\\', '/').toLowerCase();
    if (visited.has(normalized)) continue;
    visited.add(normalized);
    const alreadyCounted = existingRoots.some((entry) => !entry.rootIsLink && isWithin(normalized, entry.abs));
    const stat = measured.stat;
    canonicalPromotion.files++;
    canonicalPromotion.bytes += stat.size;
    const coveredBy = alreadyCounted ? existingRoots.find((entry) => !entry.rootIsLink && isWithin(normalized, entry.abs))?.path ?? null : null;
    canonicalPromotion.fileRecords.push({ path: observedPath, bytes: stat.size, charged: !alreadyCounted, coveredBy, entryType: measured.linkPath ? 'link' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other' });
    if (alreadyCounted) canonicalPromotion.coveredPaths.push({ path: observedPath, bytes: stat.size, coveredBy });
    else {
      canonicalPromotion.chargedBytes += stat.size;
      totalBytes += stat.size;
      filesObserved++;
    }
    if (measured.linkPath) {
      canonicalPromotion.links.push({ path: observedPath, bytes: stat.size, nlink: stat.nlink });
      if (!alreadyCounted) { linksObserved++; diagnostics.push({ code: 'reparse-or-symlink', path: observedPath, bytes: stat.size, action: 'not-followed' }); }
    } else if (!alreadyCounted && stat.isFile() && stat.nlink > 1) {
      hardlinkFilesObserved++;
      diagnostics.push({ code: 'hardlink-nlink-greater-than-one', path: absolute, bytes: stat.size, nlink: stat.nlink, accounting: 'logical-path-bytes-counted-in-full' });
    }
  }
  canonicalPromotion.changedPathCount = relativePaths.length;
  canonicalPromotion.status = 'measured';
} catch (error) {
  canonicalPromotion.error = error.message;
  diagnostics.push({ code: 'canonical-promotion-accounting-failed', message: error.message });
}

let remoteReceipt = null;
if (parsedArgs.remoteReceipt) {
  try {
    const receiptPath = path.win32.resolve(parsedArgs.remoteReceipt);
    const receiptStat = rootStatWithoutFollowingLinks(receiptPath);
    if (!receiptStat.stat?.isFile() || receiptStat.linkPath) throw new Error('remote receipt 必须是非链接普通文件');
    remoteReceipt = { receiptPath, ...remoteReceiptAccounting(JSON.parse(readFileSync(receiptPath, 'utf8'))) };
    totalBytes += remoteReceipt.bytes;
    filesObserved += remoteReceipt.entries.filter((entry) => !entry.coveredBy).length;
  } catch (error) {
    remoteReceipt = { receiptPath: parsedArgs.remoteReceipt, status: 'invalid', bytes: null, entries: [], error: error.message };
    diagnostics.push({ code: 'remote-receipt-invalid', path: parsedArgs.remoteReceipt, message: error.message });
  }
} else remoteReceipt = { status: 'unknown', bytes: null, entries: [], reason: 'no SSH du receipt supplied; remote candidate/active/staging/state are not measured' };

const overLimit = totalBytes > LIMIT_BYTES;
const result = {
  schema: 'resonance-resource-budget/v4',
  generatedAt: new Date().toISOString(),
  limitBytes: LIMIT_BYTES,
  totalBytes,
  totalGiB: Number((totalBytes / 1024 ** 3).toFixed(4)),
  logicalPathBytes: totalBytes,
  filesObserved,
  linksObserved,
  hardlinkFilesObserved,
  git,
  gitStorage,
  worktreePlan: sourcePlan,
  canonicalPromotion,
  remoteReceipt,
  missingPaths: entries.filter((entry) => !entry.exists).map((entry) => ({ role: entry.role, path: entry.path })),
  paths: entries.map((entry) => ({
    role: entry.role,
    path: entry.path,
    exists: entry.exists,
    note: entry.note,
    bytes: entry.bytes,
    files: entry.files,
    chargedBytes: entry.chargedBytes,
    budgetContribution: entry.budgetContribution,
    independentWorktree: entry.role === 'worktree-full-tree' ? sourcePlan.independentWorktree : undefined,
    coveredBy: entry.coveredBy ?? null,
    links: entry.links,
    hardlinks: entry.hardlinks,
  })),
  diagnostics,
  overLimit,
  completeAudit: Boolean(remoteReceipt?.status === undefined && remoteReceipt?.bytes != null && canonicalPromotion.status === 'measured' && !git.error && !gitStorage.error),
  auditStatus: overLimit ? 'over-limit' : linksObserved ? 'links-found' : git.error || gitStorage.error || canonicalPromotion.status !== 'measured' ? 'accounting-error' : remoteReceipt?.status === 'invalid' ? 'invalid-remote-receipt' : remoteReceipt?.status === 'unknown' ? 'incomplete-remote-unknown' : 'within-limit',
};
return { result, exitCode: overLimit || linksObserved || git.error || gitStorage.error || canonicalPromotion.status !== 'measured' || remoteReceipt?.status === 'invalid' ? 2 : 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { result, exitCode } = runAudit();
    console.log(JSON.stringify(result, null, 2));
    if (exitCode) process.exitCode = exitCode;
  } catch (error) {
    console.log(JSON.stringify({ schema: 'resonance-resource-budget/v4', auditStatus: 'invalid-input', error: error.message }, null, 2));
    process.exitCode = 2;
  }
}

export { remoteReceiptAccounting, REMOTE_SCHEMA };
