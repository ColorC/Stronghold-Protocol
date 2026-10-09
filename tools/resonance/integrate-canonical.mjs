#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const DEFAULT_INCOMING_ROOT = `${CANONICAL_ROOT}/.worktrees/resonance/stronghold-protocol`;
const DEFAULT_INTEGRATION_DIR = `${CANONICAL_ROOT}/.omni/tmp/resonance/integration`;
const SNAPSHOT_BASE = '323119340a720d616936262b4fcadd4b5517a364';
const REVIEWED_INCOMING = '96609fcb691fae265726940542f081502e14c6cd';
const MEDIA = /\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mp3|wav|ogg|zip|bin|pdf)$/i;

export function parseArgs(argv = []) {
  const result = { execute: false, canonicalRoot: CANONICAL_ROOT, incomingRoot: DEFAULT_INCOMING_ROOT, integrationDir: DEFAULT_INTEGRATION_DIR };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--execute') result.execute = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

export function isProtectedPath(rel) {
  const p = String(rel).replaceAll('\\', '/').replace(/^\.\//, '');
  const parts = p.split('/');
  return parts.some(part => ['data', 'assets', 'runtime', 'uploads', '.omni'].includes(part))
    || p.startsWith('docs/handoffs/') || p.startsWith('public/dev/') || MEDIA.test(p);
}

export function isSourceOrDocPath(rel) {
  const p = String(rel).replaceAll('\\', '/').replace(/^\.\//, '');
  if (!p || p.startsWith('/') || p.split('/').includes('..') || isProtectedPath(p)) return false;
  const ext = path.posix.extname(p).toLowerCase();
  if (!['.js', '.mjs', '.cjs', '.css', '.html', '.md', '.json'].includes(ext)) return false;
  return /^(server|shared|tools|test|docs|public\/(?:js|css)\/|public\/[^/]+\.html$)/.test(p);
}

export function countCollisionCoverage({ collisions = [], resolved = [], merged = [], historic = [], exact = [], preservedDocs = [] }) {
  const groups = [collisions, resolved, merged, historic, exact, preservedDocs];
  const all = groups.flat().map(row => typeof row === 'string' ? row : row.path).filter(Boolean);
  return { total: all.length, unique: new Set(all).size, duplicates: all.length - new Set(all).size };
}

export function collisionDisposition(summary, rel) {
  if ((summary.canonicalObservedStatus?.collisions ?? []).some(row => row.path === rel && row.path.startsWith('docs/'))
    || (summary.collisionAccounting?.preserveCurrentDocs ?? []).some(row => row.path === rel)) return 'preserve-canonical-doc';
  if ((summary.exactIncomingUntracked ?? []).some(row => row.path === rel)) return 'exact-incoming-in-merge-tree';
  if ((summary.mergeFiles ?? []).some(row => row.path === rel)) return 'reviewed-output-required';
  return 'unclassified';
}

export function findUnreviewedDirtyCollisions(dirtyPaths = [], incomingPaths = [], reviewedPaths = []) {
  const incoming = incomingPaths instanceof Set ? incomingPaths : new Set(incomingPaths);
  const reviewed = reviewedPaths instanceof Set ? reviewedPaths : new Set(reviewedPaths);
  return dirtyPaths
    .filter(row => incoming.has(row.path) && !reviewed.has(row.path))
    .map(row => ({ path: row.path, status: row.status }));
}

function git(root, args, { encoding = 'utf8', env = process.env, timeout = 30000, allow = [0], input } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding, env, timeout, input, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (!allow.includes(result.status)) throw new Error(`git ${args.join(' ')} failed (${result.status}): ${(result.stderr ?? '').toString().slice(0, 1200)}`);
  return { stdout: result.stdout ?? (encoding ? '' : Buffer.alloc(0)), stderr: result.stderr ?? (encoding ? '' : Buffer.alloc(0)), exitCode: result.status };
}

function gitText(root, args, opts = {}) { return git(root, args, opts).stdout.trim(); }
function gitBytes(root, args) { return git(root, args, { encoding: null }).stdout; }

function nativeBlob(root, commit, rel) {
  const raw = gitBytes(root, ['ls-tree', '-z', commit, '--', rel]);
  const entry = raw.toString('utf8').split('\0').filter(Boolean).find(row => row.slice(row.indexOf('\t') + 1) === rel);
  if (!entry) return null;
  const meta = entry.slice(0, entry.indexOf('\t')).split(' ');
  return { mode: meta[0], type: meta[1], objectId: meta[2] };
}

function ensureSafePath(root, rel, { finalMayBeMissing = true } = {}) {
  const normalized = rel.replaceAll('\\', '/');
  if (!isSourceOrDocPath(normalized)) return { ok: false, reason: 'path is outside the source/document allowlist' };
  const segments = normalized.split('/');
  let cursor = root;
  const checked = [];
  for (let i = 0; i < segments.length; i++) {
    cursor = path.join(cursor, segments[i]);
    try {
      const st = fs.lstatSync(cursor);
      if (st.isSymbolicLink()) return { ok: false, reason: 'symlink/reparse point found', path: cursor, checked };
      if (i < segments.length - 1 && !st.isDirectory()) return { ok: false, reason: 'non-directory ancestor', path: cursor, checked };
      if (i === segments.length - 1 && st.isFile() && st.nlink > 1) return { ok: false, reason: 'hardlinked source file', path: cursor, nlink: st.nlink, checked };
      checked.push(cursor);
    } catch (error) {
      if (error.code !== 'ENOENT') return { ok: false, reason: `lstat failed: ${error.message}`, path: cursor, checked };
      if (i < segments.length - 1) {
        // Continue checking any existing ancestors below the missing directory only after it is created.
      } else if (!finalMayBeMissing) return { ok: false, reason: 'required source file is missing', path: cursor, checked };
    }
  }
  return { ok: true, checked };
}

function assertSafeAbsolutePath(target, { allowMissingFinal = true } = {}) {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const relative = path.relative(root, resolved);
  let cursor = root;
  const parts = relative.split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    try {
      const st = fs.lstatSync(cursor);
      if (st.isSymbolicLink()) throw new Error(`symlink/reparse point found: ${cursor}`);
      if (i < parts.length - 1 && !st.isDirectory()) throw new Error(`non-directory ancestor: ${cursor}`);
      if (i === parts.length - 1 && st.isFile() && st.nlink > 1) throw new Error(`hardlinked file (nlink=${st.nlink}): ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (i === parts.length - 1 && !allowMissingFinal) throw new Error(`required file missing: ${cursor}`);
    }
  }
}

function parsePorcelain(text) {
  return text.split(/\r?\n/).filter(Boolean).map(line => ({ status: line.slice(0, 2), path: line.slice(3).replace(/^"|"$/g, '') }));
}

export function findIncomingDirtySourcePaths(statusText) {
  return parsePorcelain(statusText).filter(row => isSourceOrDocPath(row.path));
}

export function reviewedFileBytesMatch(currentPath, reviewedPath) {
  assertSafeAbsolutePath(currentPath, { allowMissingFinal: true });
  assertSafeAbsolutePath(reviewedPath, { allowMissingFinal: false });
  if (!fs.existsSync(currentPath)) return false;
  return Buffer.compare(fs.readFileSync(currentPath), fs.readFileSync(reviewedPath)) === 0;
}

function readSummary(integrationDir) {
  assertSafeAbsolutePath(integrationDir, { allowMissingFinal: false });
  const planPath = path.join(integrationDir, 'plan.json');
  const summaryPath = path.join(integrationDir, 'collision-summary.json');
  assertSafeAbsolutePath(planPath, { allowMissingFinal: false });
  assertSafeAbsolutePath(summaryPath, { allowMissingFinal: false });
  return { planPath, summaryPath, plan: JSON.parse(fs.readFileSync(planPath, 'utf8')), summary: JSON.parse(fs.readFileSync(summaryPath, 'utf8')) };
}

export function buildDryRun({ canonicalRoot = CANONICAL_ROOT, incomingRoot = DEFAULT_INCOMING_ROOT, integrationDir = DEFAULT_INTEGRATION_DIR } = {}) {
  const blockers = [];
  for (const [label, root] of [['canonical', canonicalRoot], ['incoming', incomingRoot]]) {
    try { assertSafeAbsolutePath(root, { allowMissingFinal: false }); }
    catch (error) { blockers.push({ code: `${label.toUpperCase()}_PATH_UNSAFE`, path: root, detail: error.message }); }
  }
  const canonicalTop = gitText(canonicalRoot, ['rev-parse', '--show-toplevel']);
  const incomingTop = gitText(incomingRoot, ['rev-parse', '--show-toplevel']);
  if (path.resolve(canonicalTop).toLowerCase() !== path.resolve(canonicalRoot).toLowerCase()) blockers.push({ code: 'CANONICAL_ROOT_MISMATCH', detail: canonicalTop });
  if (path.resolve(incomingTop).toLowerCase() !== path.resolve(incomingRoot).toLowerCase()) blockers.push({ code: 'INCOMING_ROOT_MISMATCH', detail: incomingTop });
  const canonicalBranch = gitText(canonicalRoot, ['branch', '--show-current']);
  const canonicalHead = gitText(canonicalRoot, ['rev-parse', 'HEAD']);
  const incomingBranch = gitText(incomingRoot, ['branch', '--show-current']);
  const incomingHead = gitText(incomingRoot, ['rev-parse', 'HEAD']);
  const canonicalIndexPath = path.resolve(canonicalRoot, gitText(canonicalRoot, ['rev-parse', '--git-path', 'index']));
  const canonicalIndexLockPath = path.resolve(canonicalRoot, gitText(canonicalRoot, ['rev-parse', '--git-path', 'index.lock']));
  const indexQuiet = git(canonicalRoot, ['diff', '--cached', '--quiet'], { allow: [0, 1] }).exitCode === 0;
  if (!indexQuiet) blockers.push({ code: 'CANONICAL_INDEX_NOT_EMPTY', path: canonicalIndexPath });
  if (fs.existsSync(canonicalIndexLockPath)) blockers.push({ code: 'INDEX_LOCK_EXISTS', path: canonicalIndexLockPath });
  if (canonicalHead !== SNAPSHOT_BASE) blockers.push({ code: 'CANONICAL_HEAD_CHANGED', expected: SNAPSHOT_BASE, actual: canonicalHead });
  if (canonicalBranch !== 'master') blockers.push({ code: 'CANONICAL_BRANCH_CHANGED', expected: 'master', actual: canonicalBranch });
  const refs = gitText(canonicalRoot, ['for-each-ref', '--format=%(refname)', 'refs/heads']);
  const branchPresent = refs.split(/\r?\n/).includes('refs/heads/master');
  if (!branchPresent) blockers.push({ code: 'CANONICAL_BRANCH_REF_MISSING' });

  const { planPath, summaryPath, plan, summary } = readSummary(integrationDir);
  const collisionPaths = plan.canonicalObservedStatus?.collisions?.map(row => row.path) ?? [];
  const sourceChangesRaw = gitText(incomingRoot, ['diff', '--name-status', `${canonicalHead}..${incomingHead}`, '--', 'server', 'shared', 'tools', 'test', 'docs', 'public/js', 'public/css', 'public/*.html']);
  const sourceChanges = sourceChangesRaw.split(/\r?\n/).filter(Boolean).map(line => {
    const [status, ...p] = line.split('\t');
    return { status, path: p.at(-1) };
  }).filter(row => isSourceOrDocPath(row.path));
  const incomingDeletes = sourceChanges.filter(row => row.status === 'D');
  const changedCollisionPaths = [];
  for (const rel of collisionPaths) {
    if (!isSourceOrDocPath(rel)) { blockers.push({ code: 'COLLISION_OUTSIDE_ALLOWLIST', path: rel }); continue; }
    const reviewedBlob = nativeBlob(incomingRoot, summary.incomingSnapshot.commit, rel);
    const finalBlob = nativeBlob(incomingRoot, incomingHead, rel);
    if (!reviewedBlob || !finalBlob || reviewedBlob.objectId !== finalBlob.objectId || reviewedBlob.mode !== finalBlob.mode) {
      changedCollisionPaths.push({ path: rel, reviewedObject: reviewedBlob?.objectId ?? null, finalObject: finalBlob?.objectId ?? null, reviewedMode: reviewedBlob?.mode ?? null, finalMode: finalBlob?.mode ?? null });
    }
  }
  if (changedCollisionPaths.length) blockers.push({ code: 'REVIEWED_COLLISION_CHANGED', paths: changedCollisionPaths });

  const changedPaths = [...new Set(sourceChanges.map(row => row.path))];
  const incomingDirtySourcePaths = findIncomingDirtySourcePaths(git(incomingRoot, ['status', '--porcelain=v1', '--untracked-files=all', '--', 'server', 'shared', 'tools', 'test', 'docs', 'public/js', 'public/css', 'public/*.html']).stdout);
  if (incomingDirtySourcePaths.length) blockers.push({ code: 'INCOMING_DIRTY_SOURCE_DOCS', paths: incomingDirtySourcePaths });
  const pathSafety = changedPaths.map(rel => ({ path: rel, ...ensureSafePath(canonicalRoot, rel) }));
  for (const check of pathSafety) if (!check.ok) blockers.push({ code: 'UNSAFE_CANONICAL_PATH', path: check.path, reason: check.reason, detail: check.path });

  const canonicalStatus = parsePorcelain(git(canonicalRoot, ['status', '--porcelain=v1', '--untracked-files=all', '--', 'server', 'shared', 'tools', 'test', 'docs', 'public/js', 'public/css', 'public/*.html']).stdout);
  const dirtySourcePaths = canonicalStatus.filter(row => isSourceOrDocPath(row.path));
  const knownCollisions = new Set(collisionPaths);
  const incomingPaths = new Set(changedPaths);
  const unreviewedDirtyCollisions = findUnreviewedDirtyCollisions(dirtySourcePaths, incomingPaths, knownCollisions);
  if (unreviewedDirtyCollisions.length) blockers.push({ code: 'UNREVIEWED_DIRTY_SOURCE_COLLISION', paths: unreviewedDirtyCollisions });

  const mergeTreeRun = git(canonicalRoot, ['merge-tree', '--write-tree', canonicalHead, incomingHead], { allow: [0, 1] });
  const mergeLines = mergeTreeRun.stdout.split(/\r?\n/);
  const mergedTree = mergeLines[0] ?? null;
  if (mergeTreeRun.exitCode !== 0) blockers.push({ code: 'NATIVE_MERGE_TREE_CONFLICT', output: mergeLines.slice(1).filter(Boolean).slice(0, 40) });

  const collisionOutputs = [];
  for (const row of summary.mergeFiles ?? []) {
    if (collisionDisposition(summary, row.path) !== 'preserve-canonical-doc') {
      const currentSnapshot = row.inputs?.current;
      if (!currentSnapshot || !reviewedFileBytesMatch(path.join(canonicalRoot, row.path), currentSnapshot)) {
        blockers.push({ code: 'REVIEWED_CANONICAL_COLLISION_CHANGED', path: row.path, reviewedCurrent: currentSnapshot ?? null });
      }
    }
    const baseName = path.basename(row.output).replace(/\.merged$/, '');
    const resolvedPath = path.join(integrationDir, `${baseName}.resolved`);
    const outputPath = fs.existsSync(resolvedPath) ? resolvedPath : row.output;
    const hasResolved = fs.existsSync(resolvedPath);
    const status = hasResolved ? 'resolved-output' : row.outcome;
    const conflict = !hasResolved && row.outcome !== 'clean';
    collisionOutputs.push({ path: row.path, output: outputPath, status, conflict, incomingCommit: summary.incomingSnapshot.commit });
    if (conflict && incomingPaths.has(row.path)) blockers.push({ code: 'UNRESOLVED_COLLISION_OUTPUT', path: row.path, output: outputPath });
  }
  for (const rel of collisionPaths.filter(p => !collisionOutputs.some(row => row.path === p))) {
    const disposition = collisionDisposition(summary, rel);
    if (disposition === 'preserve-canonical-doc' || disposition === 'exact-incoming-in-merge-tree') {
      collisionOutputs.push({ path: rel, status: disposition, output: null, incomingCommit: incomingHead });
    } else if (changedPaths.includes(rel)) blockers.push({ code: 'MISSING_COLLISION_OUTPUT', path: rel, disposition });
  }
  for (const row of summary.exactIncomingUntracked ?? []) {
    if (!reviewedFileBytesMatch(path.join(canonicalRoot, row.path), path.join(incomingRoot, row.path))) {
      blockers.push({ code: 'EXACT_INCOMING_UNTRACKED_CHANGED', path: row.path, incoming: path.join(incomingRoot, row.path) });
    }
  }

  const gitDir = path.resolve(canonicalRoot, gitText(canonicalRoot, ['rev-parse', '--absolute-git-dir']));
  const indexBytesAvailable = fs.existsSync(canonicalIndexPath);
  const incomingDiffBase = summary.incomingSnapshot?.commit;
  if (!incomingDiffBase || incomingDiffBase !== REVIEWED_INCOMING) blockers.push({ code: 'REVIEWED_SNAPSHOT_MISMATCH', expected: REVIEWED_INCOMING, actual: incomingDiffBase ?? null });
  const backupRef = `refs/backup/resonance-integration/${canonicalHead}-${incomingHead}`;
  const backupRefExists = gitText(canonicalRoot, ['show-ref', '--verify', '--quiet', backupRef], { allow: [0, 1] }).exitCode === 0;
  if (backupRefExists) blockers.push({ code: 'BACKUP_REF_ALREADY_EXISTS', ref: backupRef });

  const preservePhysicalDocs = dirtySourcePaths.filter(row => row.path.startsWith('docs/')).map(row => row.path);
  const preserveNativePaths = [...new Set([...preservePhysicalDocs, ...incomingDeletes.map(row => row.path)])];
  const report = {
    schemaVersion: 1,
    mode: 'dry-run',
    ready: blockers.length === 0,
    canonical: { path: canonicalRoot, branch: canonicalBranch, head: canonicalHead, gitDir, indexPath: canonicalIndexPath, indexLockPath: canonicalIndexLockPath, indexStagedEmpty: indexQuiet, indexPresent: indexBytesAvailable },
    incoming: { path: incomingRoot, branch: incomingBranch, head: incomingHead, reviewedHead: incomingDiffBase, sourceChangeCount: sourceChanges.length, sourceChanges, workingTreeChanges: incomingDirtySourcePaths, changedCollisionPaths },
    nativeMergeTree: { command: `git -C ${canonicalRoot} merge-tree --write-tree ${canonicalHead} ${incomingHead}`, exitCode: mergeTreeRun.exitCode, treeId: mergedTree },
    collisionPaths: collisionPaths.map(path => ({ path, incomingObjectAtReviewed: nativeBlob(incomingRoot, incomingDiffBase, path)?.objectId ?? null, incomingObjectAtFinal: nativeBlob(incomingRoot, incomingHead, path)?.objectId ?? null })),
    collisionOutputs,
    dirtyCanonicalSourceDocsToBackup: dirtySourcePaths,
    dirtyDocsPhysicalPolicy: preservePhysicalDocs.map(path => ({ path, action: 'preserve physical content; retain canonical native index entry' })),
    preserveNativePaths,
    unknownUntrackedSourceDocs: dirtySourcePaths.filter(row => row.status === '??' && !knownCollisions.has(row.path)),
    pathSafety,
    backup: { ref: backupRef, scope: 'source/docs and identified source-like untracked paths only; no data/assets/runtime/uploads/handoff' },
    executionProtocol: ['preflight source and path protection; acquire exclusive canonical index.lock before transaction writes', 'under lock, byte-compare original index and source preimages and recheck branch/head', 'save original index and source preimages in fixed integration staging', 'create native source-only backup commit/ref from tracked changes and identified collisions only', 'build temporary index from canonical initial HEAD, then write only reviewed allowlisted task source and docs', 'write all other allowlisted task source and docs after safely creating checked parents', 'create two-parent source-only merge commit', 'CAS update-ref canonical branch', 'atomically replace index from the held index.lock; rollback only actual transaction writes on failure'],
    staging: { planPath, summaryPath, integrationDir },
    blockers,
  };
  const snapshotPaths = [...new Set([...sourceChanges.map(row => row.path), ...dirtySourcePaths.map(row => row.path)])];
  Object.defineProperty(report, '_indexSnapshot', { value: fs.readFileSync(canonicalIndexPath), enumerable: false });
  Object.defineProperty(report, '_sourcePreimages', {
    value: new Map(snapshotPaths.map(rel => {
      const absolute = path.join(canonicalRoot, rel);
      return [rel, fs.existsSync(absolute) ? fs.readFileSync(absolute) : null];
    })), enumerable: false,
  });
  return report;
}

function assertNativePath(root, rel, options) {
  const check = ensureSafePath(root, rel, options);
  if (!check.ok) throw new Error(`unsafe path ${rel}: ${check.reason} ${check.path ?? ''}`);
  return check;
}

function updateIndexBlob(root, tempIndex, rel, bytes, mode = '100644') {
  const blob = gitText(root, ['hash-object', '-w', '--path', rel, '--stdin'], { env: { ...process.env, GIT_INDEX_FILE: tempIndex }, input: bytes });
  git(root, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${rel}`], { env: { ...process.env, GIT_INDEX_FILE: tempIndex } });
}

function atomicReplace(file, bytes) {
  const temp = `${file}.resonance-integrate.tmp`;
  assertSafeAbsolutePath(file);
  assertSafeAbsolutePath(temp);
  if (fs.existsSync(temp)) throw new Error(`refusing overwrite temporary source file ${temp}`);
  let fd = null;
  try {
    fd = fs.openSync(temp, 'wx');
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = null;
    fs.renameSync(temp, file);
  } catch (error) {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
    if (fs.existsSync(temp)) {
      assertSafeAbsolutePath(temp, { allowMissingFinal: false });
      fs.unlinkSync(temp);
    }
    throw error;
  }
}

function ensureTargetDirectory(root, rel, createdDirs) {
  const dirRel = path.posix.dirname(rel.replaceAll('\\', '/'));
  if (dirRel === '.') return;
  let cursor = root;
  for (const part of dirRel.split('/')) {
    cursor = path.join(cursor, part);
    try {
      const st = fs.lstatSync(cursor);
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`unsafe target ancestor: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(cursor);
      createdDirs.push(cursor);
    }
  }
}

function restoreIndexPath(root, tempIndex, head, rel) {
  const entry = nativeBlob(root, head, rel);
  const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
  if (entry) git(root, ['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.objectId},${rel}`], { env });
  else git(root, ['update-index', '--force-remove', '--', rel], { env, allow: [0, 1] });
}

export function executePlan(plan, { afterSourceWrite } = {}) {
  if (!plan.ready) throw new Error(`execution refused: preflight has ${plan.blockers.length} blocker(s)`);
  const c = plan.canonical.path, g = plan.incoming.path, staging = plan.staging.integrationDir;
  const initialHead = plan.canonical.head, incomingHead = plan.incoming.head, branch = plan.canonical.branch;
  const indexPath = plan.canonical.indexPath, lockPath = plan.canonical.indexLockPath;
  const indexBackupPath = path.join(staging, 'canonical-index.before.bin');
  const integrationTemp = path.join(staging, 'canonical-integration.new-index');
  const backupIndex = path.join(staging, 'canonical-backup.index');
  for (const candidate of [staging, indexPath, lockPath, indexBackupPath, integrationTemp, backupIndex]) assertSafeAbsolutePath(candidate);
  for (const candidate of [indexBackupPath, integrationTemp, backupIndex]) if (fs.existsSync(candidate)) throw new Error(`refusing overwrite existing recovery artifact ${candidate}`);

  let lockFd = null, lockOwned = false, lockExpected = Buffer.alloc(0), originalIndex = null, installedIndex = null;
  let indexBackupCreated = false, backupIndexCreated = false, integrationTempCreated = false;
  const createdDirs = [], written = [], preimages = new Map(), writeBuffers = new Map();
  let backupRefCreated = false, backupCommit = null, branchUpdated = false, indexInstalled = false, newCommit = null;
  const recovery = [];
  const preservePaths = new Set(plan.preserveNativePaths ?? []);
  const dirtyDocs = new Set((plan.dirtyDocsPhysicalPolicy ?? []).map(row => row.path));
  const deletedPaths = new Set(plan.incoming.sourceChanges.filter(row => row.status === 'D').map(row => row.path));
  const resolvedByPath = new Map(plan.collisionOutputs.filter(row => row.output).map(row => [row.path, row.output]));
  const targetPaths = plan.incoming.sourceChanges.map(row => row.path).filter(rel => !dirtyDocs.has(rel) && !deletedPaths.has(rel));
  try {
    // Hold Git's exclusive index lock across preimage checks, backup, source writes and CAS ref update.
    lockFd = fs.openSync(lockPath, 'wx');
    lockOwned = true;
    originalIndex = fs.readFileSync(indexPath);
    if (!Buffer.isBuffer(plan._indexSnapshot) || !originalIndex.equals(plan._indexSnapshot)) throw new Error('canonical index bytes changed after dry-run');
    if (gitText(c, ['rev-parse', 'HEAD']) !== initialHead) throw new Error('canonical HEAD changed after preflight');
    if (gitText(c, ['branch', '--show-current']) !== branch) throw new Error('canonical branch changed after preflight');
    if (gitText(g, ['rev-parse', 'HEAD']) !== incomingHead) throw new Error('incoming HEAD changed after preflight');
    if (git(c, ['diff', '--cached', '--quiet'], { allow: [0, 1] }).exitCode !== 0) throw new Error('canonical index gained staged changes');

    for (const [rel, expected] of plan._sourcePreimages ?? []) {
      assertNativePath(c, rel, { finalMayBeMissing: true });
      const absolute = path.join(c, rel);
      const current = fs.existsSync(absolute) ? fs.readFileSync(absolute) : null;
      if ((expected === null) !== (current === null) || (expected && !expected.equals(current))) throw new Error(`source preimage changed after dry-run: ${rel}`);
      preimages.set(rel, expected);
    }
    for (const rel of targetPaths) {
      assertNativePath(c, rel, { finalMayBeMissing: true });
      const collisionOutput = resolvedByPath.get(rel);
      const mergedEntry = nativeBlob(c, plan.nativeMergeTree.treeId, rel);
      const bytes = collisionOutput ? fs.readFileSync(collisionOutput)
        : mergedEntry ? gitBytes(c, ['show', `${plan.nativeMergeTree.treeId}:${rel}`]) : null;
      if (!bytes) throw new Error(`merged source unexpectedly missing: ${rel}`);
      if (/^<<<<<<< /m.test(bytes.toString('utf8'))) throw new Error(`unresolved conflict output: ${rel}`);
      writeBuffers.set(rel, bytes);
    }

    fs.writeFileSync(indexBackupPath, originalIndex, { flag: 'wx' });
    indexBackupCreated = true;
    const backupEnv = { ...process.env, GIT_INDEX_FILE: backupIndex };
    git(c, ['read-tree', initialHead], { env: backupEnv });
    backupIndexCreated = true;
    const recognized = new Set((plan.collisionPaths ?? []).map(row => row.path));
    const dirtyRows = plan.dirtyCanonicalSourceDocsToBackup.filter(row => isSourceOrDocPath(row.path));
    const backupPaths = dirtyRows.filter(row => row.status !== '??' || recognized.has(row.path)).map(row => row.path);
    if (backupPaths.length) git(c, ['add', '-A', '--', ...backupPaths], { env: backupEnv });
    const backupTree = gitText(c, ['write-tree'], { env: backupEnv });
    const oldTree = gitText(c, ['rev-parse', `${initialHead}^{tree}`]);
    backupCommit = backupTree === oldTree ? null : gitText(c, ['commit-tree', backupTree, '-p', initialHead, '-m', 'Preserve canonical source-only changes before resonance integration']);
    if (backupCommit) {
      git(c, ['update-ref', plan.backup.ref, backupCommit, '0'.repeat(initialHead.length)]);
      backupRefCreated = true;
    }

    const integrationEnv = { ...process.env, GIT_INDEX_FILE: integrationTemp };
    // Never seed from the native merge tree: it can carry protected incoming
    // data/assets/runtime entries even though only source/docs are authorized.
    git(c, ['read-tree', initialHead], { env: integrationEnv });
    integrationTempCreated = true;
    for (const [rel, bytes] of writeBuffers) updateIndexBlob(c, integrationTemp, rel, bytes, nativeBlob(c, plan.nativeMergeTree.treeId, rel)?.mode ?? '100644');
    // Revert only protected dirty docs and the eight reviewed deletions to their canonical Native entries.
    for (const rel of preservePaths) restoreIndexPath(c, integrationTemp, initialHead, rel);
    const mergedTree = gitText(c, ['write-tree'], { env: integrationEnv });
    newCommit = gitText(c, ['commit-tree', mergedTree, '-p', initialHead, '-p', incomingHead, '-m', 'Merge resonance source-only work']);

    for (const [rel, bytes] of writeBuffers) {
      const absolute = path.join(c, rel);
      assertNativePath(c, rel, { finalMayBeMissing: true });
      const current = fs.existsSync(absolute) ? fs.readFileSync(absolute) : null;
      const previous = preimages.get(rel);
      if ((previous === null) !== (current === null) || (previous && !previous.equals(current))) throw new Error(`source changed after preimage check: ${rel}`);
      ensureTargetDirectory(c, rel, createdDirs);
      atomicReplace(absolute, bytes);
      written.push({ rel, bytes });
      afterSourceWrite?.(rel, written.length);
    }

    installedIndex = fs.readFileSync(integrationTemp);
    fs.writeSync(lockFd, installedIndex, 0, installedIndex.length, 0);
    fs.ftruncateSync(lockFd, installedIndex.length);
    fs.fsyncSync(lockFd);
    lockExpected = installedIndex;
    fs.closeSync(lockFd); lockFd = null;
    git(c, ['update-ref', `refs/heads/${branch}`, newCommit, initialHead]);
    branchUpdated = true;
    fs.renameSync(lockPath, indexPath);
    lockOwned = false;
    indexInstalled = true;
    if (integrationTempCreated) fs.unlinkSync(integrationTemp);
    if (backupIndexCreated) fs.unlinkSync(backupIndex);
    return { ok: true, newCommit, mergedTree, backupRef: backupRefCreated ? plan.backup.ref : null, indexBackupPath, updatedSourcePaths: targetPaths, preservedCanonicalPaths: [...preservePaths] };
  } catch (error) {
    recovery.push(error.message);
    if (branchUpdated && newCommit) {
      try { git(c, ['update-ref', `refs/heads/${branch}`, initialHead, newCommit]); branchUpdated = false; }
      catch (rollbackError) { recovery.push(`branch rollback failed: ${rollbackError.message}`); }
    }
    if (indexInstalled && originalIndex) {
      try {
        const fd = fs.openSync(lockPath, 'wx');
        lockOwned = true;
        try {
          const currentIndex = fs.readFileSync(indexPath);
          if (!installedIndex || !currentIndex.equals(installedIndex)) throw new Error('active index changed concurrently; rollback refused');
          fs.writeFileSync(fd, originalIndex); fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        fs.renameSync(lockPath, indexPath);
        lockOwned = false;
        indexInstalled = false;
      } catch (rollbackError) { recovery.push(`index rollback failed: ${rollbackError.message}`); }
    }
    for (const { rel, bytes: expected } of [...written].reverse()) {
      const absolute = path.join(c, rel);
      try {
        assertNativePath(c, rel, { finalMayBeMissing: true });
        const current = fs.existsSync(absolute) ? fs.readFileSync(absolute) : null;
        if (!current || !current.equals(expected)) { recovery.push(`source rollback skipped due to concurrent change: ${rel}`); continue; }
        const original = preimages.get(rel);
        if (original === null) fs.unlinkSync(absolute);
        else atomicReplace(absolute, original);
      } catch (rollbackError) { recovery.push(`source rollback failed ${rel}: ${rollbackError.message}`); }
    }
    const rollbackUnsafe = recovery.some(item => /rollback failed|skipped due to concurrent change/.test(item));
    if (backupRefCreated && backupCommit && !rollbackUnsafe) {
      try { git(c, ['update-ref', '-d', plan.backup.ref, backupCommit]); }
      catch (rollbackError) { recovery.push(`backup ref rollback failed: ${rollbackError.message}`); }
    } else if (backupRefCreated) recovery.push(`source backup ref retained for recovery: ${plan.backup.ref}`);
    if (lockFd !== null) { try { fs.closeSync(lockFd); } catch {} lockFd = null; }
    if (lockOwned && fs.existsSync(lockPath)) {
      try {
        assertSafeAbsolutePath(lockPath, { allowMissingFinal: false });
        const actual = fs.readFileSync(lockPath);
        if (!lockExpected.length ? actual.length === 0 : actual.equals(lockExpected)) fs.unlinkSync(lockPath);
        else recovery.push(`index.lock changed by another process; retained: ${lockPath}`);
      } catch (rollbackError) { recovery.push(`index.lock cleanup skipped: ${rollbackError.message}`); }
    }
    for (const [temp, created] of [[integrationTemp, integrationTempCreated], [backupIndex, backupIndexCreated]]) {
      try { if (created && fs.existsSync(temp)) { assertSafeAbsolutePath(temp, { allowMissingFinal: false }); fs.unlinkSync(temp); } }
      catch (rollbackError) { recovery.push(`temporary index cleanup failed ${temp}: ${rollbackError.message}`); }
    }
    for (const dir of [...createdDirs].reverse()) {
      try { fs.rmdirSync(dir); } catch (rollbackError) { if (rollbackError.code !== 'ENOTEMPTY') recovery.push(`created directory cleanup failed ${dir}: ${rollbackError.message}`); }
    }
    throw new Error(`integration failed: ${recovery.join('; ')}`);
  }
}
export function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const plan = buildDryRun(args);
  if (args.execute) {
    const result = executePlan(plan);
    process.stdout.write(`${JSON.stringify({ ...plan, mode: 'executed', execution: result }, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  return plan.ready ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = run(); }
  catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
