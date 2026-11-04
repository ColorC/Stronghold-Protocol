import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
function locateProjectRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, 'publish', 'assault', 'code', 'assault-release.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`cannot locate registered Assault project from ${start}`);
    current = parent;
  }
}
const projectRoot = locateProjectRoot(scriptDirectory);
const tmpProducer = path.join(scriptDirectory, 'final-wave-release-producer.mjs');
const producerPath = fs.existsSync(tmpProducer) ? tmpProducer : path.join(projectRoot, 'tools', 'build-server-release.mjs');
const { classifyAssaultReleaseUpdateChanges, readNativeGitBlobBatch, assertNativeProofScopedEquivalent,
  assertReleaseTargetMatchesNativeBlob } = await import(pathToFileURL(producerPath).href);
const codeRoot = path.join(projectRoot, 'publish', 'assault', 'code');
const manifestPath = path.join(codeRoot, 'assault-release.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const oldCommit = manifest.source.nativeGitCommit;
const git = (...args) => execFileSync('git', ['-C', projectRoot, ...args], { encoding: 'utf8', env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } }).trim();

test('transport update selects only existing adopted HTTP and producer rows', () => {
  const result = classifyAssaultReleaseUpdateChanges({ changedPaths: [
    'server/modes/assault/http.js', 'tools/build-server-release.mjs', 'docs/assault-release.md', 'test/assault-release.test.mjs',
  ], oldRows: manifest.files.filter((row) => !row.metadata), codeRoot });
  assert.deepEqual(result.selected.map((row) => row.sourceGitPath), ['server/modes/assault/http.js', 'tools/build-server-release.mjs']);
  assert.deepEqual(result.ignored, ['docs/assault-release.md', 'test/assault-release.test.mjs']);
});

test('current formal HTTP bytes still match the exact adopted native source blob', () => {
  const httpPath = path.join(codeRoot, 'server', 'modes', 'assault', 'http.js');
  const blobs = readNativeGitBlobBatch(projectRoot, oldCommit, ['server/modes/assault/http.js']);
  const checkout = fs.readFileSync(httpPath).toString('utf8').replace(/\r\n/g, '\n');
  const native = blobs.get('server/modes/assault/http.js').toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(checkout, native);
  const sameLengthConflict = Buffer.from(native);
  sameLengthConflict[0] ^= 1;
  assert.equal(sameLengthConflict.length, Buffer.byteLength(native));
  assert.throws(() => assertReleaseTargetMatchesNativeBlob(sameLengthConflict, Buffer.from(native), httpPath), /conflicts with old native source/);
  assert.equal(git('cat-file', '-t', oldCommit), 'commit');
});

test('native engine proof remains scoped-equivalent at the adopted source commit', () => {
  const proof = manifest.nativeEngineProof;
  const result = assertNativeProofScopedEquivalent({ canonicalRoot: projectRoot, proofRevision: proof.sourceRevision,
    sourceRevision: oldCommit, comparedPaths: proof.comparedPaths });
  assert.equal(result.equivalent, true);
  assert.deepEqual(result.changedPaths, []);
});

test('update path classification rejects rules, engine, and unregistered source drift', () => {
  const options = { oldRows: manifest.files.filter((row) => !row.metadata), codeRoot };
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, changedPaths: ['data/assault-runtime.json'] }), /rules\/data drift/);
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, changedPaths: ['public/js/independent/engine/engine-build.json'] }), /generated engine drift/);
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, changedPaths: ['server/modes/assault/unregistered.js'] }), /only transport source paths/);
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, changedPaths: ['server/modes/independent/http.js'] }), /only transport source paths/);
});

test('normal update CLI refuses same-commit no-op without writing release files', () => {
  const before = fs.readFileSync(manifestPath);
  const result = spawnSync(process.execPath, [producerPath,
    '--assault-update-from-git', '--canonical-root', projectRoot, '--source-commit', oldCommit], { cwd: projectRoot, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /no changed adopted Assault source modules/);
  assert.deepEqual(fs.readFileSync(manifestPath), before);
});

test('normal update CLI rejects a non-descendant source commit without writing release files', () => {
  const head = git('rev-parse', 'HEAD');
  if (head === oldCommit) return;
  const ancestor = spawnSync('git', ['-C', projectRoot, 'merge-base', '--is-ancestor', oldCommit, head], { encoding: 'utf8' });
  if (ancestor.status === 0) return;
  const before = fs.readFileSync(manifestPath);
  const result = spawnSync(process.execPath, [producerPath,
    '--assault-update-from-git', '--canonical-root', projectRoot, '--source-commit', head], { cwd: projectRoot, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /not a descendant/);
  assert.deepEqual(fs.readFileSync(manifestPath), before);
});
