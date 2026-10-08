import { lstatSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const WORKTREE = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/resonance/stronghold-protocol';
const CANONICAL = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const LIMIT_BYTES = 2_000_000_000;
const BASE_COMMIT = '4ed1ad32ec10da15c23f9d7939dade603950759b';
const DEFAULTS = [
  { role: 'worktree-full-tree', path: WORKTREE, note: '本职责簇工作树全量，包含.git文件；所有文件和节点模块均计入。' },
  { role: 'canonical-reference-input', path: `${CANONICAL}/data/resonance-reference`, note: '本路线使用的正式参考输入，全量计入。' },
  { role: 'canonical-resonance-staging', path: `${CANONICAL}/.omni/tmp/resonance`, note: '本路线临时staging，全量计入；不存在时明确列为missing。' },
  { role: 'canonical-resonance-runtime', path: `${CANONICAL}/runtime/resonance`, note: '本路线运行区，全量计入；不存在时明确列为missing。' },
];

function normalizeAbsolute(input, label) {
  if (!path.win32.isAbsolute(input)) throw new Error(`${label}路径必须为绝对路径：${input}`);
  return path.win32.resolve(input).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
}
function isWithin(file, root) { return file === root || file.startsWith(`${root.replace(/\/$/, '')}/`); }
function parseArgs(argv) {
  const extra = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--candidate' && flag !== '--publish') throw new Error(`未知参数：${flag}`);
    const value = argv[++i];
    if (!value) throw new Error(`${flag} 后必须提供绝对路径`);
    extra.push({ role: flag.slice(2), path: value, note: `${flag.slice(2)}路径存在时全量计入。` });
  }
  return extra;
}
function runGit(args) {
  return execFileSync('git', ['-C', WORKTREE, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).trim();
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

const inputs = [...DEFAULTS, ...parseArgs(process.argv.slice(2))].map((item) => ({
  ...item,
  abs: normalizeAbsolute(item.path, item.role),
}));
for (let i = 0; i < inputs.length; i++) {
  for (let j = i + 1; j < inputs.length; j++) {
    if (inputs[i].abs === inputs[j].abs) throw new Error(`重复的预算路径：${inputs[i].path} 与 ${inputs[j].path}`);
  }
}

const git = { branch: null, commit: null, versionIdentityIsInformationalOnly: true, error: null };
try { git.branch = runGit(['branch', '--show-current']); } catch (error) { git.error = error.message; }
try { git.commit = runGit(['rev-parse', 'HEAD']); } catch (error) { git.error ??= error.message; }

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
const existingRoots = entries.filter((entry) => entry.exists && !entry.rootIsLink);
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
  if (entry.exists) {
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
  worktreeGitDir: null,
  commonGitDir: null,
  deltaObjects: 0,
  deltaObjectDiskBytes: 0,
  objectAccounting: 'native git rev-list BASE..HEAD object difference, sized by git cat-file --batch-check=%(objectname) %(objectsize:disk)',
  worktreeMetadata: null,
  error: null,
};
try {
  gitStorage.worktreeGitDir = runGit(['rev-parse', '--absolute-git-dir']);
  gitStorage.commonGitDir = runGit(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const objectLines = runGit(['rev-list', '--objects', `${BASE_COMMIT}..HEAD`]).split(/\r?\n/).filter(Boolean);
  const objectIds = [...new Set(objectLines.map((line) => line.trim().split(/\s+/, 1)[0]).filter(Boolean))];
  if (objectIds.length) {
    const sized = execFileSync('git', ['-C', WORKTREE, 'cat-file', '--batch-check=%(objectname) %(objectsize:disk)'], {
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
  gitStorage.worktreeMetadata = scanGitMetadata(gitStorage.worktreeGitDir);
} catch (error) {
  gitStorage.error = error.message;
  diagnostics.push({ code: 'native-git-storage-accounting-failed', message: error.message });
}

const overLimit = totalBytes > LIMIT_BYTES;
const result = {
  schema: 'resonance-resource-budget/v3',
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
    coveredBy: entry.coveredBy ?? null,
    links: entry.links,
    hardlinks: entry.hardlinks,
  })),
  diagnostics,
  overLimit,
  auditStatus: overLimit ? 'over-limit' : linksObserved ? 'links-found' : git.error || gitStorage.error ? 'git-identity-unavailable' : 'within-limit',
};
console.log(JSON.stringify(result, null, 2));
if (overLimit || linksObserved || git.error || gitStorage.error) process.exitCode = 2;
