import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  countCollisionCoverage,
  collisionDisposition,
  executePlan,
  findIncomingDirtySourcePaths,
  findUnreviewedDirtyCollisions,
  isProtectedPath,
  isSourceOrDocPath,
  parseArgs,
  reviewedFileBytesMatch,
} from '../../tools/resonance/integrate-canonical.mjs';

test('canonical integration defaults to a read-only dry run and requires explicit absolute overrides', () => {
  const args = parseArgs([]);
  assert.equal(args.execute, false);
  assert.match(args.canonicalRoot, /webworks[\\/]apps[\\/]stronghold-protocol$/i);
  assert.throws(() => parseArgs(['--canonical-root', 'relative/path']), /unknown argument/);
  assert.throws(() => parseArgs(['--integration-dir', 'E:/elsewhere']), /unknown argument/);
  assert.throws(() => parseArgs(['--execute', '--unknown']), /unknown argument/);
});

test('source allowlist excludes user data, runtime, staging and media paths', () => {
  assert.equal(isSourceOrDocPath('server/index.js'), true);
  assert.equal(isSourceOrDocPath('docs/resonance/design.md'), true);
  assert.equal(isSourceOrDocPath('public/js/ui/fallbackField.js'), true);
  for (const rel of [
    'data/resonance-reference/tft/input.json',
    'runtime/resonance/session.json',
    'assets/portrait.png',
    '.omni/tmp/resonance/integration/plan.json',
    'docs/handoffs/other-agent.md',
    'public/dev/vfx-compare.js',
    '../outside/file.js',
  ]) {
    assert.equal(isProtectedPath(rel) || !isSourceOrDocPath(rel), true, rel);
    assert.equal(isSourceOrDocPath(rel), false, rel);
  }
});

test('collision accounting identifies duplicate path assignments rather than masking them', () => {
  const accounting = countCollisionCoverage({
    collisions: ['server/index.js'],
    resolved: ['server/index.js', 'public/js/ui/fallbackField.js'],
    merged: ['server/modes/independent/catalog.js'],
    preservedDocs: [{ path: 'docs/independent-mode/design.md' }],
  });
  assert.deepEqual(accounting, { total: 5, unique: 4, duplicates: 1 });
});

test('native merge dispositions keep protected dirty docs and exact incoming paths out of collision-output requirements', () => {
  const summary = {
    collisionAccounting: { preserveCurrentDocs: [{ path: 'docs/independent-mode/design.md' }] },
    exactIncomingUntracked: [{ path: 'public/css/independent-recording.css' }],
    mergeFiles: [{ path: 'server/index.js' }],
  };
  assert.equal(collisionDisposition(summary, 'docs/independent-mode/design.md'), 'preserve-canonical-doc');
  assert.equal(collisionDisposition(summary, 'public/css/independent-recording.css'), 'exact-incoming-in-merge-tree');
  assert.equal(collisionDisposition(summary, 'server/index.js'), 'reviewed-output-required');
  assert.equal(collisionDisposition(summary, 'server/new-file.js'), 'unclassified');
});

test('dirty source collision guard blocks only overlapping unreviewed paths, tracked or untracked', () => {
  const dirty = [
    { path: 'server/dirty-tracked.js', status: ' M' },
    { path: 'docs/dirty-untracked.md', status: '??' },
    { path: 'tools/unrelated-local.mjs', status: ' M' },
    { path: 'server/already-reviewed.js', status: ' M' },
  ];
  assert.deepEqual(
    findUnreviewedDirtyCollisions(dirty, new Set(['server/dirty-tracked.js', 'docs/dirty-untracked.md', 'server/already-reviewed.js']), new Set(['server/already-reviewed.js'])),
    [
      { path: 'server/dirty-tracked.js', status: ' M' },
      { path: 'docs/dirty-untracked.md', status: '??' },
    ],
  );
  assert.deepEqual(findUnreviewedDirtyCollisions(dirty, ['tools/new-file.mjs'], []), []);
});

test('incoming worktree source and document edits are surfaced instead of silently omitted from the native merge', () => {
  assert.deepEqual(findIncomingDirtySourcePaths([
    ' M docs/plans/resonance/progress.md',
    ' M tools/resonance/integrate-canonical.mjs',
    '?? test/resonance/new.test.js',
    ' M data/resonance-reference/private.json',
    ' M runtime/resonance/session.json',
  ].join('\n')), [
    { status: ' M', path: 'docs/plans/resonance/progress.md' },
    { status: ' M', path: 'tools/resonance/integrate-canonical.mjs' },
    { status: '??', path: 'test/resonance/new.test.js' },
  ]);
});

const FIXTURE = 'C:/Users/lilithgames/AppData/Local/Temp/stronghold-resonance-integration';

function nativeGit(root, args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], { encoding: options.encoding ?? 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: options.input });
}

function put(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

test('porcelain parsing keeps the first tracked source path and its leading status byte from native Git output', () => {
  assert.equal(fs.existsSync(FIXTURE), false, `fixed fixture already exists: ${FIXTURE}`);
  try {
    fs.mkdirSync(FIXTURE, { recursive: false });
    nativeGit(FIXTURE, ['init', '-b', 'main']);
    nativeGit(FIXTURE, ['config', 'user.name', 'Resonance Fixture']);
    nativeGit(FIXTURE, ['config', 'user.email', 'fixture@example.invalid']);
    put(FIXTURE, 'server/changed.js', 'export const value = 1;\n');
    nativeGit(FIXTURE, ['add', 'server/changed.js']);
    nativeGit(FIXTURE, ['commit', '-m', 'base']);
    put(FIXTURE, 'server/changed.js', 'export const value = 2;\n');
    const rawStatus = nativeGit(FIXTURE, ['status', '--porcelain=v1', '--untracked-files=all']);
    assert.equal(rawStatus.startsWith(' M server/changed.js'), true, JSON.stringify(rawStatus));
    assert.deepEqual(findIncomingDirtySourcePaths(rawStatus), [{ status: ' M', path: 'server/changed.js' }]);
  } finally {
    if (fs.existsSync(FIXTURE)) {
      assertFixtureNoSymlinks(FIXTURE);
      fs.rmSync(path.resolve(FIXTURE), { recursive: true, force: false });
    }
  }
});

function initMergeFixture(root, { rollback = false } = {}) {
  const canonical = path.join(root, 'canonical');
  const incoming = path.join(root, 'incoming');
  const staging = path.join(root, 'staging');
  fs.mkdirSync(canonical, { recursive: true });
  fs.mkdirSync(staging, { recursive: true });
  nativeGit(canonical, ['init', '-b', 'master']);
  nativeGit(canonical, ['config', 'user.name', 'Resonance Fixture']);
  nativeGit(canonical, ['config', 'user.email', 'fixture@example.invalid']);
  put(canonical, 'server/app.js', 'export const revision = "native";\n');
  put(canonical, 'data/protected.json', '{"value":"native"}\n');
  put(canonical, 'docs/dirty.md', 'base dirty document\n');
  put(canonical, 'docs/clean.md', 'base clean document\n');
  const deletes = ['docs/legacy-a.md', 'docs/legacy-b.md', 'docs/legacy-c.md', 'test/legacy-a.js', 'test/legacy-b.js', 'test/legacy-c.js', 'tools/legacy-a.mjs', 'tools/legacy-b.mjs'];
  for (const rel of deletes) put(canonical, rel, `native:${rel}\n`);
  nativeGit(canonical, ['add', '-A']);
  nativeGit(canonical, ['commit', '-m', 'fixture base']);
  const initialHead = nativeGit(canonical, ['rev-parse', 'HEAD']).trim();
  nativeGit(root, ['clone', '--quiet', '--no-hardlinks', canonical, incoming]);
  nativeGit(incoming, ['config', 'user.name', 'Resonance Fixture']);
  nativeGit(incoming, ['config', 'user.email', 'fixture@example.invalid']);
  put(incoming, 'server/app.js', 'export const revision = "incoming";\n');
  put(incoming, 'data/protected.json', '{"value":"incoming"}\n');
  if (rollback) put(incoming, 'server/nested/new.js', 'export const newFile = true;\n');
  else {
    put(incoming, 'docs/dirty.md', 'incoming dirty document\n');
    put(incoming, 'docs/clean.md', 'incoming clean document\n');
    put(incoming, 'docs/resonance/new.md', 'new formal resonance document\n');
    put(incoming, 'server/nested/new.js', 'export const newFile = true;\n');
    for (const rel of deletes) fs.unlinkSync(path.join(incoming, rel));
  }
  nativeGit(incoming, ['add', '-A']);
  nativeGit(incoming, ['commit', '-m', 'fixture incoming']);
  const incomingHead = nativeGit(incoming, ['rev-parse', 'HEAD']).trim();
  nativeGit(canonical, ['fetch', '--quiet', incoming, `refs/heads/master:refs/remotes/incoming/master`]);

  if (!rollback) {
    put(canonical, 'docs/dirty.md', 'canonical user-edited document\n');
    put(canonical, 'data/protected.json', '{"value":"canonical user data"}\n');
    put(canonical, 'server/unknown-local.js', 'unknown local untracked\n');
  }
  const indexPath = path.resolve(canonical, nativeGit(canonical, ['rev-parse', '--git-path', 'index']).trim());
  const indexLockPath = path.resolve(canonical, nativeGit(canonical, ['rev-parse', '--git-path', 'index.lock']).trim());
  const status = nativeGit(canonical, ['status', '--porcelain=v1', '--untracked-files=all']).split(/\r?\n/).filter(Boolean).map(line => ({ status: line.slice(0, 2), path: line.slice(3) }));
  const sourceChanges = nativeGit(canonical, ['diff', '--name-status', `${initialHead}..${incomingHead}`, '--', 'server', 'shared', 'tools', 'test', 'docs', 'public/js', 'public/css', 'public/*.html'])
    .split(/\r?\n/).filter(Boolean).map(line => { const [statusCode, ...parts] = line.split('\t'); return { status: statusCode, path: parts.at(-1) }; });
  const mergeLine = nativeGit(canonical, ['merge-tree', '--write-tree', initialHead, incomingHead]).split(/\r?\n/)[0];
  const preserveNativePaths = rollback ? [] : ['docs/dirty.md', ...deletes];
  const collisionPaths = rollback ? [] : [{ path: 'docs/dirty.md' }];
  const plan = {
    ready: true,
    canonical: { path: canonical, head: initialHead, branch: 'master', indexPath, indexLockPath },
    incoming: { path: incoming, head: incomingHead, sourceChanges },
    nativeMergeTree: { treeId: mergeLine },
    collisionPaths,
    collisionOutputs: rollback ? [] : [{ path: 'docs/dirty.md', output: null }],
    preserveNativePaths,
    dirtyDocsPhysicalPolicy: rollback ? [] : [{ path: 'docs/dirty.md' }],
    dirtyCanonicalSourceDocsToBackup: status,
    backup: { ref: `refs/backup/resonance-fixture/${rollback ? 'rollback' : 'success'}` },
    staging: { integrationDir: staging },
  };
  const snapshotPaths = [...new Set([...sourceChanges.map(row => row.path), ...status.map(row => row.path).filter(rel => /^(server|shared|tools|test|docs|public\/js|public\/css)\//.test(rel) || /^public\/[^/]+\.html$/.test(rel))])];
  Object.defineProperty(plan, '_indexSnapshot', { value: fs.readFileSync(indexPath) });
  Object.defineProperty(plan, '_sourcePreimages', { value: new Map(snapshotPaths.map(rel => {
    const file = path.join(canonical, rel);
    return [rel, fs.existsSync(file) ? fs.readFileSync(file) : null];
  })) });
  return { plan, canonical, incoming, staging, deletes, initialHead, incomingHead };
}

function assertNoFixtureLinks(root) {
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const st = fs.lstatSync(file);
      assert.equal(st.isSymbolicLink(), false, `unexpected fixture link: ${file}`);
      if (st.isDirectory()) visit(file);
      else assert.equal(st.nlink, 1, `unexpected fixture hardlink: ${file}`);
    }
  };
  visit(root);
}

function assertFixtureNoSymlinks(root) {
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const st = fs.lstatSync(file);
      assert.equal(st.isSymbolicLink(), false, `unexpected fixture symlink: ${file}`);
      if (st.isDirectory()) visit(file);
    }
  };
  visit(root);
}

function fixtureSizeBytes(root) {
  return fs.readdirSync(root, { withFileTypes: true }).reduce((sum, entry) => {
    const file = path.join(root, entry.name);
    return sum + (entry.isDirectory() ? fixtureSizeBytes(file) : fs.statSync(file).size);
  }, 0);
}

test('reviewed collision preimages are compared as current file bytes, including changed and missing targets', () => {
  assert.equal(fs.existsSync(FIXTURE), false, `fixed fixture already exists: ${FIXTURE}`);
  try {
    fs.mkdirSync(FIXTURE, { recursive: false });
    const current = path.join(FIXTURE, 'canonical', 'server', 'index.js');
    const reviewed = path.join(FIXTURE, 'integration', 'server-index.current.input');
    put(FIXTURE, path.relative(FIXTURE, current), Buffer.from([0x00, 0x0d, 0x0a, 0xff]));
    put(FIXTURE, path.relative(FIXTURE, reviewed), Buffer.from([0x00, 0x0d, 0x0a, 0xff]));
    assert.equal(reviewedFileBytesMatch(current, reviewed), true);
    fs.writeFileSync(current, Buffer.from([0x00, 0x0d, 0x0a, 0xfe]));
    assert.equal(reviewedFileBytesMatch(current, reviewed), false);
    fs.unlinkSync(current);
    assert.equal(reviewedFileBytesMatch(current, reviewed), false);
  } finally {
    if (fs.existsSync(FIXTURE)) {
      assertFixtureNoSymlinks(FIXTURE);
      fs.rmSync(path.resolve(FIXTURE), { recursive: true, force: false });
    }
  }
});

test('native fixture transaction merges reviewed source/docs only, preserves protected data, dirty docs and eight deletions', () => {
  assert.equal(fs.existsSync(FIXTURE), false, `fixed fixture already exists: ${FIXTURE}`);
  let totalBytes = 0;
  try {
    fs.mkdirSync(FIXTURE, { recursive: false });
    const fixture = initMergeFixture(FIXTURE);
    const result = executePlan(fixture.plan, { afterSourceWrite: () => {
      assert.equal(fs.existsSync(fixture.plan.canonical.indexLockPath), true, 'canonical index lock remains held during source writes');
      assert.equal(nativeGit(fixture.canonical, ['rev-parse', 'HEAD']).trim(), fixture.initialHead, 'branch CAS has not happened during source writes');
    } });
    assert.equal(result.ok, true);
    assert.deepEqual(nativeGit(fixture.canonical, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' '), [result.newCommit, fixture.initialHead, fixture.incomingHead], 'integration commit retains canonical and incoming parents');
    assert.equal(fs.readFileSync(path.join(fixture.canonical, 'server/app.js'), 'utf8'), 'export const revision = "incoming";\n');
    assert.equal(nativeGit(fixture.canonical, ['show', 'HEAD:server/app.js']), 'export const revision = "incoming";\n', 'native commit contains the actual hashed source bytes');
    assert.equal(nativeGit(fixture.canonical, ['show', 'HEAD:server/nested/new.js']), 'export const newFile = true;\n');
    assert.equal(fs.readFileSync(path.join(fixture.canonical, 'data/protected.json'), 'utf8'), '{"value":"canonical user data"}\n', 'physical protected user data remains untouched');
    assert.equal(nativeGit(fixture.canonical, ['show', ':data/protected.json']), '{"value":"native"}\n', 'protected data index entry stays at the canonical Native value');
    assert.equal(nativeGit(fixture.canonical, ['show', 'HEAD:data/protected.json']), '{"value":"native"}\n', 'incoming protected data is excluded from the integration commit');
    assert.equal(nativeGit(fixture.canonical, ['diff', '--name-status', `${fixture.initialHead}..HEAD`, '--', 'data', 'assets', 'runtime', 'uploads', 'public/dev']).trim(), '', 'protected path groups are absent from the native merge diff');
    assert.equal(fs.readFileSync(path.join(fixture.canonical, 'docs/clean.md'), 'utf8'), 'incoming clean document\n');
    assert.equal(fs.readFileSync(path.join(fixture.canonical, 'docs/resonance/new.md'), 'utf8'), 'new formal resonance document\n');
    assert.equal(nativeGit(fixture.canonical, ['show', 'HEAD:docs/resonance/new.md']), 'new formal resonance document\n');
    assert.equal(fs.readFileSync(path.join(fixture.canonical, 'docs/dirty.md'), 'utf8'), 'canonical user-edited document\n');
    assert.equal(nativeGit(fixture.canonical, ['show', ':docs/dirty.md']), 'base dirty document\n');
    assert.equal(fs.readFileSync(path.join(fixture.canonical, 'server/unknown-local.js'), 'utf8'), 'unknown local untracked\n');
    for (const rel of fixture.deletes) {
      assert.equal(fs.readFileSync(path.join(fixture.canonical, rel), 'utf8'), `native:${rel}\n`);
      assert.equal(nativeGit(fixture.canonical, ['show', `:${rel}`]), `native:${rel}\n`);
      assert.equal(nativeGit(fixture.canonical, ['show', `HEAD:${rel}`]), `native:${rel}\n`);
    }
    const backup = nativeGit(fixture.canonical, ['rev-parse', result.backupRef]).trim();
    assert.equal(nativeGit(fixture.canonical, ['show', `${backup}:docs/dirty.md`]), 'canonical user-edited document\n');
    assert.throws(() => nativeGit(fixture.canonical, ['show', `${backup}:server/unknown-local.js`]), /fatal/);
    assert.equal(fs.existsSync(fixture.canonical + path.sep + '.git' + path.sep + 'index.lock'), false);
    assert.equal(fs.existsSync(path.join(fixture.staging, 'canonical-integration.new-index')), false);
    assert.equal(nativeGit(fixture.canonical, ['diff', '--cached', '--quiet']).length, 0);
    assertNoFixtureLinks(FIXTURE);
    totalBytes = fixtureSizeBytes(FIXTURE);
    assert.ok(totalBytes < 1024 * 1024, `fixture grew to ${totalBytes} bytes`);
  } finally {
    if (fs.existsSync(FIXTURE)) {
      assertFixtureNoSymlinks(FIXTURE);
      const resolved = path.resolve(FIXTURE);
      assert.equal(resolved, path.resolve('C:/Users/lilithgames/AppData/Local/Temp/stronghold-resonance-integration'));
      fs.rmSync(resolved, { recursive: true, force: false });
    }
  }
  assert.ok(totalBytes > 0);
});

test('native fixture transaction rolls back actual source writes and created directories on injected failure', () => {
  assert.equal(fs.existsSync(FIXTURE), false, `fixed fixture already exists: ${FIXTURE}`);
  try {
    fs.mkdirSync(FIXTURE, { recursive: false });
    const fixture = initMergeFixture(FIXTURE, { rollback: true });
    const indexBefore = fs.readFileSync(fixture.plan.canonical.indexPath);
    const originalHead = nativeGit(fixture.canonical, ['rev-parse', 'HEAD']).trim();
    assert.throws(() => executePlan(fixture.plan, { afterSourceWrite: (_rel, count) => { if (count === 1) throw new Error('fixture injected failure after first source write'); } }), /fixture injected failure/);
    assert.equal(fs.readFileSync(path.join(fixture.canonical, 'server/app.js'), 'utf8'), 'export const revision = "native";\n');
    assert.equal(fs.existsSync(path.join(fixture.canonical, 'server/nested/new.js')), false);
    assert.equal(fs.existsSync(path.join(fixture.canonical, 'server/nested')), false);
    assert.equal(nativeGit(fixture.canonical, ['rev-parse', 'HEAD']).trim(), originalHead);
    assert.deepEqual(fs.readFileSync(fixture.plan.canonical.indexPath), indexBefore);
    assert.equal(fs.existsSync(fixture.plan.canonical.indexLockPath), false);
    assertNoFixtureLinks(FIXTURE);
    assert.ok(fixtureSizeBytes(FIXTURE) < 1024 * 1024, 'rollback fixture stays below one megabyte');
  } finally {
    if (fs.existsSync(FIXTURE)) {
      assertFixtureNoSymlinks(FIXTURE);
      fs.rmSync(path.resolve(FIXTURE), { recursive: true, force: false });
    }
  }
});
