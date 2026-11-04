import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  changedPathArgs, nativeChangedPaths, nativeExtraObjectIds, nativeObjectArgs, nativeObjectDiskSizes, nativeObjectIds, nativeObjectInventory, parseArgs, REMOTE_SCHEMA, remoteReceiptAccounting,
  resolveNativeExtras, resolveNativeObject,
  resolveNativeRevision, resourceAuditPlan, revisionDeltaRange, shouldScanIndependentWorktree,
} from '../../tools/resonance/resource-budget.mjs';

test('deleted worktree falls back to native canonical Git while its absent tree stays zero', () => {
  const worktreeRoot = 'E:/project/.worktrees/resonance/repo';
  const canonicalRoot = 'E:/project/repo';
  const args = parseArgs(['--worktree-root', worktreeRoot, '--source-revision', '14d58f96cf8f4350aca06a4a13ec2a6ca2a91273']);
  const plan = resourceAuditPlan({ worktreeRoot: args.worktreeRoot, canonicalRoot, worktreeAvailable: false, sourceRevision: args.sourceRevision });
  assert.equal(plan.sourceRoot, canonicalRoot);
  assert.equal(plan.independentWorktree, false);
  assert.equal(plan.worktreeAccounting, 'missing-worktree-zero');
  assert.equal(plan.sourceRevision, '14d58f96cf8f4350aca06a4a13ec2a6ca2a91273');
  assert.equal(shouldScanIndependentWorktree(plan), false);
});

test('deleted worktree reads the requested commit, changed paths, and objects from canonical native Git', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'resonance-budget-native-git-'));
  const repo = path.join(root, 'canonical');
  const missingWorktree = path.join(root, 'deleted-worktree');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  try {
    await mkdir(repo);
    git('init', '-q', '-b', 'main');
    await writeFile(path.join(repo, 'README.md'), 'baseline\n');
    git('-c', 'user.name=Budget Test', '-c', 'user.email=budget@example.invalid', 'add', 'README.md');
    git('-c', 'user.name=Budget Test', '-c', 'user.email=budget@example.invalid', 'commit', '-qm', 'baseline');
    const base = git('rev-parse', 'HEAD');
    await mkdir(path.join(repo, 'docs', 'resonance'), { recursive: true });
    await writeFile(path.join(repo, 'docs', 'resonance', 'design.md'), 'task source\n');
    git('-c', 'user.name=Budget Test', '-c', 'user.email=budget@example.invalid', 'add', 'docs/resonance/design.md');
    git('-c', 'user.name=Budget Test', '-c', 'user.email=budget@example.invalid', 'commit', '-qm', 'task commit');
    const taskCommit = git('rev-parse', 'HEAD');
    const plan = resourceAuditPlan({ worktreeRoot: missingWorktree, canonicalRoot: repo, worktreeAvailable: false, sourceRevision: taskCommit });
    const revision = resolveNativeRevision(plan.sourceRoot, plan.sourceRevision);
    assert.equal(revision, taskCommit);
    assert.deepEqual(nativeChangedPaths(plan.sourceRoot, base, revision), ['docs/resonance/design.md']);
    assert.ok(nativeObjectIds(plan.sourceRoot, base, revision).length > 0);
    const inventory = nativeObjectInventory(plan.sourceRoot, base, revision);
    assert.deepEqual(inventory.missingObjectIds, []);
    const residentSizes = nativeObjectDiskSizes(repo, inventory.objectIds);
    assert.equal(residentSizes.size, inventory.objectIds.length);
    assert.deepEqual(residentSizes.notResidentObjectIds, []);

    const absentBlob = git('rev-parse', `${taskCommit}:docs/resonance/design.md`);
    const absentPath = path.join(repo, '.git', 'objects', absentBlob.slice(0, 2), absentBlob.slice(2));
    await rm(absentPath);
    const incompleteInventory = nativeObjectInventory(repo, base, taskCommit);
    assert.ok(incompleteInventory.missingObjectIds.includes(absentBlob));
    assert.ok(!existsSync(absentPath), 'native object enumeration must not restore/fetch the missing object');
    const absentSize = nativeObjectDiskSizes(repo, [absentBlob]);
    assert.equal(absentSize.size, 0);
    assert.deepEqual(absentSize.notResidentObjectIds, [absentBlob]);
    assert.ok(!existsSync(absentPath), 'physical size lookup must not restore/fetch the missing object');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('task revision selects native Git path and object delta ranges; default stays HEAD', () => {
  const revision = '14d58f96cf8f4350aca06a4a13ec2a6ca2a91273';
  assert.equal(parseArgs([]).sourceRevision, 'HEAD');
  assert.equal(parseArgs(['--source-revision', revision]).sourceRevision, revision);
  assert.equal(revisionDeltaRange('4ed1ad32ec10da15c23f9d7939dade603950759b', revision), `4ed1ad32ec10da15c23f9d7939dade603950759b..${revision}`);
  assert.deepEqual(changedPathArgs('4ed1ad32ec10da15c23f9d7939dade603950759b', revision),
    ['diff', '--name-only', '-z', '--no-renames', '4ed1ad32ec10da15c23f9d7939dade603950759b', revision]);
});

test('native extra merge-preview trees are counted once beside the source delta without widening source paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'resonance-budget-merge-preview-'));
  const repo = path.join(root, 'repo');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  try {
    await mkdir(repo);
    git('init', '-q', '-b', 'main');
    await writeFile(path.join(repo, 'shared.txt'), 'shared content\n');
    git('-c', 'user.name=Budget Test', '-c', 'user.email=budget@example.invalid', 'add', 'shared.txt');
    git('-c', 'user.name=Budget Test', '-c', 'user.email=budget@example.invalid', 'commit', '-qm', 'baseline');
    const base = git('rev-parse', 'HEAD');

    await writeFile(path.join(repo, 'shared.txt'), 'source shared update\n');
    await writeFile(path.join(repo, 'source.txt'), 'source-only content\n');
    git('add', 'shared.txt', 'source.txt');
    git('-c', 'user.name=Budget Test', '-c', 'user.email=budget@example.invalid', 'commit', '-qm', 'source side');
    const source = git('rev-parse', 'HEAD');

    git('checkout', '-qb', 'incoming', base);
    await writeFile(path.join(repo, 'incoming.txt'), 'incoming-only content\n');
    git('add', 'incoming.txt');
    git('-c', 'user.name=Budget Test', '-c', 'user.email=budget@example.invalid', 'commit', '-qm', 'incoming side');
    const incoming = git('rev-parse', 'HEAD');
    git('-c', 'user.name=Budget Test', '-c', 'user.email=budget@example.invalid', 'tag', '-a', 'incoming-tag', 'incoming', '-m', 'incoming tag');
    const previewTree = git('merge-tree', '--write-tree', source, incoming).split(/\r?\n/)[0];
    assert.equal(git('cat-file', '-t', previewTree), 'tree');

    const parsed = parseArgs(['--native-extra', previewTree, '--native-extra', 'incoming-tag']);
    assert.deepEqual(parsed.nativeExtras, [previewTree, 'incoming-tag']);
    const resolved = resolveNativeExtras(repo, parsed.nativeExtras);
    assert.deepEqual(resolved.map(({ requested, resolved: object, type }) => ({ requested, resolved: object, type })), [
      { requested: previewTree, resolved: previewTree, type: 'tree' },
      { requested: 'incoming-tag', resolved: incoming, type: 'commit' },
    ]);
    assert.deepEqual(resolveNativeObject(repo, previewTree), { requested: previewTree, resolved: previewTree, type: 'tree' });

    const sourceIds = nativeObjectIds(repo, base, source);
    const combinedIds = nativeObjectIds(repo, base, source, undefined, resolved.map((entry) => entry.resolved));
    const extraIds = nativeExtraObjectIds(sourceIds, combinedIds);
    const sharedBlob = git('rev-parse', `${source}:shared.txt`);
    const incomingBlob = git('rev-parse', `${incoming}:incoming.txt`);
    assert.ok(sourceIds.includes(sharedBlob));
    assert.ok(combinedIds.includes(sharedBlob));
    assert.ok(!extraIds.includes(sharedBlob), 'shared reachable object is not charged twice');
    assert.ok(extraIds.includes(previewTree), 'dangling merge preview tree contributes its native tree object');
    assert.ok(extraIds.includes(incomingBlob), 'incoming-only blob is reachable through the preview tree');
    assert.equal(new Set(combinedIds).size, combinedIds.length);
    const diskSizes = nativeObjectDiskSizes(repo, combinedIds);
    assert.equal(diskSizes.size, combinedIds.length);
    assert.deepEqual(diskSizes.notResidentObjectIds, []);
    assert.ok(diskSizes.get(previewTree) > 0);
    assert.equal([...diskSizes.keys()].filter((id) => id === sharedBlob).length, 1);
    assert.ok([...extraIds].reduce((sum, id) => sum + diskSizes.get(id), 0) > 0);
    assert.deepEqual(nativeObjectArgs(base, source, [previewTree]), ['rev-list', '--objects', '--missing=print', source, previewTree, '--not', base]);
    assert.deepEqual(nativeChangedPaths(repo, base, source), ['shared.txt', 'source.txt']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('canonical worktree root is never traversed or charged as a second full tree', () => {
  const canonicalRoot = 'E:/project/repo';
  const plan = resourceAuditPlan({ worktreeRoot: `${canonicalRoot}/`, canonicalRoot, worktreeAvailable: true, sourceRevision: 'HEAD' });
  assert.equal(plan.sameAsCanonical, true);
  assert.equal(plan.independentWorktree, false);
  assert.equal(plan.worktreeAccounting, 'canonical-root-not-counted-as-worktree');
  assert.equal(shouldScanIndependentWorktree(plan), false);
});

test('remote SSH receipt counts ancestor directory bytes once and records covered child scopes', () => {
  const report = remoteReceiptAccounting({
    schema: REMOTE_SCHEMA,
    source: 'ssh-du',
    host: 'linux-host',
    entries: [
      { path: '/srv/resonance', byteCount: 1200, observedAt: '2026-10-09T12:00:00Z', purpose: 'active release' },
      { path: '/srv/resonance/state', byteCount: 400, observedAt: '2026-10-09T12:00:00Z', purpose: 'session state' },
      { path: '/srv/candidate', byteCount: 800, observedAt: '2026-10-09T12:00:00Z', purpose: 'candidate' },
    ],
  });
  assert.equal(report.bytes, 2000);
  assert.equal(report.entries.find((entry) => entry.path === '/srv/resonance/state').coveredBy, '/srv/resonance');
  assert.equal(report.entries.find((entry) => entry.path === '/srv/resonance/state').chargedBytes, 0);
  assert.equal(report.entries.find((entry) => entry.path === '/srv/candidate').chargedBytes, 800);
});

test('remote receipt keeps different hosts separate and rejects duplicate or incomplete measurements', () => {
  const base = { schema: REMOTE_SCHEMA, source: 'ssh-du', entries: [
    { path: '/srv/app', byteCount: 100, observedAt: '2026-10-09T12:00:00Z', purpose: 'active', host: 'a' },
    { path: '/srv/app/state', byteCount: 50, observedAt: '2026-10-09T12:00:00Z', purpose: 'state', host: 'b' },
  ] };
  assert.equal(remoteReceiptAccounting(base).bytes, 150);
  assert.throws(() => remoteReceiptAccounting({ ...base, entries: [base.entries[0], base.entries[0]] }), /重复路径/);
  assert.throws(() => remoteReceiptAccounting({ schema: REMOTE_SCHEMA, source: 'ssh-du', entries: [{ path: '/srv/x', byteCount: 1, purpose: 'missing timestamp' }] }), /observedAt/);
  assert.throws(() => remoteReceiptAccounting({ schema: REMOTE_SCHEMA, source: 'ssh-du', entries: [{ path: 'relative/path', byteCount: 1, observedAt: 'now', purpose: 'bad path' }] }), /Linux绝对路径/);
  assert.throws(() => remoteReceiptAccounting({ schema: REMOTE_SCHEMA, entries: [], source: 'manual estimate' }), /ssh-du/);
});
