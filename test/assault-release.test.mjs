import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = process.env.ASSAULT_RELEASE_TEST_SOURCE_ROOT || path.resolve(fixtureDirectory, '..');
const gitEnvironment = { ...process.env, GIT_NO_LAZY_FETCH: '1' };
const gitTopLevel = execFileSync('git', ['-C', sourceRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env: gitEnvironment }).trim();
assert.equal(path.resolve(gitTopLevel).toLowerCase(), path.resolve(sourceRoot).toLowerCase(),
  'sourceRoot must be an actual native Git root, never a parent-repo fallback');
const commonDirOutput = execFileSync('git', ['-C', sourceRoot, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', env: gitEnvironment }).trim();
const canonicalRoot = process.env.ASSAULT_RELEASE_TEST_CANONICAL_ROOT
  || path.dirname(path.isAbsolute(commonDirOutput) ? commonDirOutput : path.resolve(sourceRoot, commonDirOutput));
const producerPath = process.env.ASSAULT_RELEASE_TEST_PRODUCER || path.join(sourceRoot, 'tools', 'build-server-release.mjs');
const { assertNativeProofRevisionEquivalent, assertNativeProofScopedEquivalent, buildAssaultReleaseManifest,
  collectAssaultDynamicContentClosure, movePlanFiles, planAssaultRelease, readNativeGitBlobBatch,
  restoreNativeMtimes, selectedTrackedStatus } = await import(pathToFileURL(producerPath).href);
const { findSpecifiers } = await import(pathToFileURL(path.join(path.dirname(producerPath), 'check-imports.mjs')).href);
const servicePath = process.env.ASSAULT_RELEASE_TEST_SERVICE || path.join(sourceRoot, 'tools', 'assault', 'local-service.mjs');
const rulesDataPath = process.env.ASSAULT_RELEASE_TEST_RULES_DATA || path.join(sourceRoot, 'server', 'modes', 'assault', 'data.js');
const { resolveAssaultServiceConfig, validateReleaseContract } = await import(pathToFileURL(servicePath).href);
const { getAssaultRulesRoot } = await import(pathToFileURL(rulesDataPath).href);

const storageValidatorUrl = process.env.ASSAULT_RELEASE_STORAGE_VALIDATOR_URL;
const fixtureModuleUrl = (value) => value.startsWith('file:') ? new URL(value).href : pathToFileURL(value).href;
const storageValidator = storageValidatorUrl ? await import(fixtureModuleUrl(storageValidatorUrl)) : null;
test('explicit storage validator accepts the same native module by absolute path or file URL', { skip: !storageValidatorUrl }, async () => {
  const nativePath = fileURLToPath(fixtureModuleUrl(storageValidatorUrl));
  assert.equal(await import(fixtureModuleUrl(nativePath)), await import(fixtureModuleUrl(pathToFileURL(nativePath).href)));
});
const sourceWorktreeAvailable = sourceRoot !== canonicalRoot && fs.existsSync(path.join(sourceRoot, 'server', 'index.js'));
const makeTempFixture = (prefix) => fs.mkdtempSync(path.join(canonicalRoot, '.omni', 'tmp', 'assault', prefix));

function readNativeGitTextBlobs(commit, paths) {
  const input = Buffer.from(paths.map((file) => `${commit}:${file}\n`).join(''), 'utf8');
  const output = execFileSync('git', ['-C', canonicalRoot, 'cat-file', '--batch'],
    { input, encoding: null, timeout: 30000, maxBuffer: 64 * 1024 * 1024, env: gitEnvironment });
  const files = new Map(); let offset = 0;
  for (const file of paths) {
    const newline = output.indexOf(0x0a, offset);
    assert.notEqual(newline, -1, `native Git batch header exists for ${file}`);
    const [objectId, kind, sizeText] = output.subarray(offset, newline).toString('ascii').trim().split(/\s+/);
    assert.match(objectId, /^[0-9a-f]{40,64}$/i); assert.equal(kind, 'blob'); assert.match(sizeText, /^(0|[1-9]\d*)$/);
    const size = Number(sizeText); const start = newline + 1; const end = start + size;
    assert.ok(end < output.length && output[end] === 0x0a, `native Git batch body is complete for ${file}`);
    files.set(file, output.subarray(start, end).toString('utf8')); offset = end + 1;
  }
  assert.equal(offset, output.length, 'native Git batch has no trailing data');
  return files;
}

function nativeRelativeImports(file, source, files) {
  const result = [];
  for (const { spec } of findSpecifiers(source)) {
    if (file === 'server/http/static.js' && spec === './sim/simdata.js') continue;
    if (!spec.startsWith('.')) continue;
    const clean = spec.split(/[?#]/, 1)[0];
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), clean));
    const candidates = path.posix.extname(relative) ? [relative]
      : [relative, `${relative}.js`, `${relative}.mjs`, `${relative}.cjs`, `${relative}.json`, `${relative}/index.js`];
    const found = candidates.find((candidate) => files.has(candidate));
    assert.ok(found, `native import resolves from ${file}: ${spec}`);
    result.push(found);
  }
  return result;
}

function nativeImportClosure(entries, files) {
  const seen = new Set(); const pending = [...entries];
  while (pending.length) {
    const file = pending.pop(); if (seen.has(file)) continue;
    assert.ok(files.has(file), `native closure entry exists: ${file}`); seen.add(file);
    pending.push(...nativeRelativeImports(file, files.get(file), files));
  }
  return seen;
}

test('native selected-source status batches real Windows-length path sets without widening the scope', { skip: !sourceWorktreeAvailable },()=>{
  const paths=planAssaultRelease({sourceRoot,canonicalRoot}).files.filter(row=>row.adopt).map(row=>row.sourceRelative);
  assert(paths.join(' ').length>32767,'fixture must exceed the real failed command length');
  assert.equal(selectedTrackedStatus(sourceRoot,paths),'');
  assert.throws(()=>selectedTrackedStatus(sourceRoot,['x'.repeat(12001)]),/native command budget/);
});

test('Assault release plan computes current source closure without adopting files', { skip: !sourceWorktreeAvailable }, () => {
  const codeRoot = path.join(canonicalRoot, 'publish', 'assault', 'code');
  const rulesRoot = path.join(canonicalRoot, 'data', 'assault-rules');
  if (fs.existsSync(codeRoot) || fs.existsSync(rulesRoot)) {
    assert.throws(() => planAssaultRelease({ sourceRoot, canonicalRoot }), /target conflict/);
    return;
  }
  let plan;
  try { plan = planAssaultRelease({ sourceRoot, canonicalRoot }); }
  catch (error) {
    if (/selected Assault release source must be committed and clean/.test(error.message)) {
      assert.match(error.message, /server\/modes\/assault\/data\.js|tools\/assault\/local-service\.mjs/);
      assert.equal(fs.existsSync(codeRoot), false);
      assert.equal(fs.existsSync(rulesRoot), false);
      return;
    }
    throw error;
  }
  assert.equal(plan.sourceRevision, execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: gitEnvironment }).trim());
  assert.equal(plan.engineRevision, '1a2eb3811b7ad622008441eb81d8280966c4e3cd');
  assert.equal(plan.engineSourceRevision, '4fadcefc914c02ee243d0b892271b3e1150dfb41');
  assert.equal(plan.proofEquivalence.proofRevision, '8ce3960f56ec2b67495e100a0caa7ccaf947a270');
  assert.equal(plan.proofEquivalence.sourceRevision, plan.sourceRevision);
  assert.deepEqual(plan.proofEquivalence.changedPaths, []);
  assert.equal(plan.moduleClosure.simulationFiles, 93);
  assert.equal(plan.moduleClosure.engineDeclaredModules, 320);
  assert.equal(plan.moduleClosure.enginePresentModules, 318);
  assert.deepEqual(plan.moduleClosure.engineFallbacks.sort(), ['server/data.js', 'server/modes/independent/catalog.js']);
  assert.equal(plan.rules.nativeDataFiles.length, 16);
  assert.equal(plan.rules.languageOverlays.length, 4);
  assert.deepEqual(plan.moduleClosure.supportedPacks.map((pack) => pack.id).sort(), ['en', 'ja', 'ko', 'zh-TW']);
  assert.equal(plan.status, 'planned');
  assert.equal(plan.adoptionStatus, 'planned');
  assert.equal(plan.totals.movableFiles, plan.files.filter((row) => row.adopt).length);
  assert.ok(plan.files.every((row) => path.isAbsolute(row.sourcePath) && path.isAbsolute(row.targetPath)));
  assert.ok(plan.files.filter((row) => row.adopt).every((row) => !/\\(?:test|tests|runtime|input|assets|vendor|fonts|node_modules)(?:\\|$)/i.test(row.targetPath)));
  assert.ok(plan.files.some((row) => row.sourceRelative === 'public/index.html'));
  assert.ok(plan.files.some((row) => row.sourceRelative === 'public/independent.html'));
  assert.ok(plan.files.some((row) => row.sourceRelative === 'public/js/independent/client-worker.js'));
  assert.ok(plan.files.some((row) => row.sourceRelative === 'public/manifest.json'));
  assert.ok(plan.references.some((row) => row.role === 'canonical-readonly-asset-mount'));
  assert.ok(plan.references.some((row) => row.role === 'canonical-readonly-install-data' && row.sourceRelative === 'data/local-assets.json'));
  assert.equal(fs.existsSync(codeRoot), false);
  assert.equal(fs.existsSync(rulesRoot), false);
});

test('Assault release planner rejects a parent repository masquerading as source root', () => {
  assert.throws(() => planAssaultRelease({ sourceRoot: canonicalRoot, canonicalRoot }), /must be distinct native Git worktrees/);
});

test('native engine HTTP proof may cross a tools-only commit after scoped source equivalence', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(canonicalRoot, 'runtime', 'assault', 'root-live-engine-archives.json'), 'utf8'));
  const sourceRevision = process.env.ASSAULT_RELEASE_TEST_SOURCE_COMMIT || '9a6e68ad26d7f9399cfe41ab4a563ed287a997fb';
  const result = assertNativeProofRevisionEquivalent({ canonicalRoot, sourceRoot, sourceRevision, nativeProof: proof });
  assert.equal(result.equivalent, true);
  assert.equal(result.proofRevision, '8ce3960f56ec2b67495e100a0caa7ccaf947a270');
  assert.equal(result.sourceRevision, sourceRevision);
  assert.ok(result.comparedPaths.includes('server/sim'));
  assert.ok(result.comparedPaths.includes('shared'));
  assert.ok(result.comparedPaths.includes('data/assault-runtime.json'));
  assert.ok(result.comparedPaths.includes('public/js/assault/client-sim.js'));
  assert.deepEqual(result.changedPaths, []);
});

test('native dynamic content pool literal imports are covered by the existing release closure', () => {
  const sourceCommit = process.env.ASSAULT_RELEASE_TEST_SOURCE_COMMIT || '9a6e68ad26d7f9399cfe41ab4a563ed287a997fb';
  const listed = execFileSync('git', ['-C', canonicalRoot, 'ls-tree', '-r', '--name-only', sourceCommit,
    '--', 'server', 'shared', 'public'], { encoding: 'utf8', env: gitEnvironment })
    .trim().split(/\r?\n/).filter(Boolean);
  const files = listed.filter((file) => /\.(?:js|mjs|cjs|json)$/.test(file));
  const sources = readNativeGitTextBlobs(sourceCommit, files);
  const dynamicContent = files.filter((file) => file.startsWith('server/sim/content/') && file.endsWith('.js'));
  assert.equal(dynamicContent.length, 283);
  const client = sources.get('public/js/assault/client-sim.js');
  const dynamicUrls = [...client.matchAll(/moduleUrl\(\s*['"](assault-engine\/(?:server\/sim|shared)\/[^'"]+)['"]\s*\)/g)]
    .map((match) => match[1]);
  assert.ok(dynamicUrls.length > 0);
  const simEntries = dynamicUrls.map((url) => url.startsWith('assault-engine/server/sim/')
    ? `server/sim/${url.slice('assault-engine/server/sim/'.length)}`
    : `shared/${url.slice('assault-engine/shared/'.length)}`);
  const existingRuntimeClosure = nativeImportClosure(['server/index.js', ...simEntries], sources);
  const poolClosure = nativeImportClosure(dynamicContent, sources);
  const missing = [...poolClosure].filter((file) => !file.startsWith('server/sim/content/') && !existingRuntimeClosure.has(file)).sort();
  assert.deepEqual(missing, [], `dynamic content pool has imports outside both existing runtime closures: ${missing.join(', ')}`);
});

test('normal dynamic content filesystem closure follows imports and rejects missing modules', () => {
  const tempRoot = makeTempFixture('dynamic-pool-');
  const contentRoot = path.join(tempRoot, 'server', 'sim', 'content');
  const write = (relative, source) => {
    const file = path.join(tempRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  };
  try {
    write('server/sim/content/index.js', "import './kits/index.js';\n");
    write('server/sim/content/kits/index.js', "import './ops/operator.js';\n");
    write('server/sim/content/kits/ops/operator.js', "import '../../shared.js';\n");
    write('server/sim/content/kits/ops/operator.js.map', '{}');
    write('server/sim/content/shared.js', 'export const shared = true;\n');
    const closure = collectAssaultDynamicContentClosure(tempRoot);
    assert.deepEqual(closure.entries, [
      'server/sim/content/index.js', 'server/sim/content/kits/index.js', 'server/sim/content/kits/ops/operator.js',
      'server/sim/content/shared.js',
    ]);
    assert.equal(closure.seen.size, 4);
    assert.ok(closure.seen.has('server/sim/content/shared.js'));
    write('server/sim/content/kits/ops/operator.js', "import './missing-module.js';\n");
    assert.throws(() => collectAssaultDynamicContentClosure(tempRoot), /unresolved root-relative module import/);
    write('server/sim/content/kits/ops/operator.js', 'export const valid = true;\n');
    fs.unlinkSync(path.join(contentRoot, 'kits', 'index.js'));
    assert.throws(() => collectAssaultDynamicContentClosure(tempRoot), /registry is missing its runtime entry modules/);
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
});

test('native Git repair fetches exact blobs in one bounded batch and rejects unresolved paths', () => {
  const sourceCommit = process.env.ASSAULT_RELEASE_TEST_SOURCE_COMMIT || '9a6e68ad26d7f9399cfe41ab4a563ed287a997fb';
  const paths = ['server/sim/content/index.js', 'tools/build-server-release.mjs'];
  const blobs = readNativeGitBlobBatch(canonicalRoot, sourceCommit, paths);
  assert.deepEqual([...blobs.keys()], paths);
  for (const file of paths) {
    const expected = execFileSync('git', ['-C', canonicalRoot, 'show', `${sourceCommit}:${file}`],
      { encoding: null, env: gitEnvironment });
    assert.deepEqual(blobs.get(file), expected, `batch blob bytes match native Git ${file}`);
  }
  assert.throws(() => readNativeGitBlobBatch(canonicalRoot, sourceCommit, ['tools/does-not-exist.mjs']), /native Git batch/);
});

test('native engine proof rejects an actual core source change through the same equivalence function', () => {
  const tempRoot = makeTempFixture('proof-diff-');
  const git = (...args) => execFileSync('git', ['-C', tempRoot, ...args], { encoding: 'utf8', env: gitEnvironment }).trim();
  try {
    git('init', '-q'); git('config', 'user.name', 'Assault proof fixture'); git('config', 'user.email', 'fixture@example.invalid');
    const relative = path.join('server', 'sim', 'proof-fixture.js'); const file = path.join(tempRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'export const damage = 1;\n');
    git('add', '--', relative); git('commit', '-q', '-m', 'proof source baseline');
    const proofRevision = git('rev-parse', 'HEAD');
    fs.writeFileSync(file, 'export const damage = 2;\n');
    git('add', '--', relative); git('commit', '-q', '-m', 'changed simulation source');
    const sourceRevision = git('rev-parse', 'HEAD');
    const nativeProof = { sourceRevision: proofRevision, checks: [{
      url: 'http://127.0.0.1:13003/assault-engine/server/sim/proof-fixture.js', sourcePath: file,
    }] };
    assert.throws(() => assertNativeProofRevisionEquivalent({ canonicalRoot: tempRoot, sourceRoot: tempRoot, sourceRevision, nativeProof }),
      /native HTTP proof source closure changed.*server\/sim\/proof-fixture\.js/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function fileRow(source, target) {
  const st = fs.statSync(source, { bigint: true });
  return { source, target, sourcePath: source, targetPath: target, role: 'logical-code', consumers: ['test'],
    lifetime: 'test fixture', logicalBytes: Number(st.size), storedBytes: Number(st.size),
    identity: { device: String(st.dev), fileId: String(st.ino),
      links: Number(st.nlink), bytes: Number(st.size), mtimeNs: String(st.mtimeNs), reparsePoint: false }, adopt: true };
}

function metadataRows(codeRoot, prefix = '') {
  return ['package.json', 'assault-release.json', 'copy.json'].map((name) => ({
    target: path.join(codeRoot, `${prefix}${name}`), role: 'generated-metadata', contents: '', adopt: false,
  }));
}

function fixturePlan(tempRoot, source, target) {
  const codeRoot = path.join(tempRoot, 'release');
  const roots = { code: codeRoot, rules: path.join(tempRoot, 'rules'), canonical: tempRoot, runtime: path.join(tempRoot, 'runtime') };
  const plan = { files: [fileRow(source, target)], roots, source: { nativeGitCommit: 'a'.repeat(40), version: '0.0.0', engineRevision: 'e1', engineSourceRevision: 's1' },
    sourceRoot: tempRoot, version: '0.0.0', package: { type: 'module', version: '0.0.0', dependencies: { ws: '8.22.0' } },
    engineFallbacks: { 'server/data.js': path.join(tempRoot, 'runtime', 'independent-engine-data.js.gz'),
      'server/modes/independent/catalog.js': path.join(tempRoot, 'runtime', 'independent-engine-catalog.js.gz') },
    references: [], totals: {}, rules: {}, generatedMetadata: metadataRows(codeRoot) };
  return plan;
}

test('same-volume file adoption preserves native identity and exact bytes; injected failure rolls back', () => {
  const tempRoot = makeTempFixture('adopt-');
  try {
    const source = path.join(tempRoot, 'source.js'); const target = path.join(tempRoot, 'release', 'source.js');
    fs.writeFileSync(source, 'export const retained = true;\n');
    const original = fs.statSync(source, { bigint: true }); const bytes = fs.readFileSync(source);
    const plan = fixturePlan(tempRoot, source, target);
    const result = movePlanFiles(plan);
    const adopted = fs.statSync(target, { bigint: true });
    assert.equal(result.status, 'pass');
    assert.equal(plan.adoptionStatus, 'adopted');
    assert.equal(String(adopted.ino), String(original.ino));
    assert.deepEqual(fs.readFileSync(target), bytes);
    assert.equal(fs.existsSync(source), false);
    assert.deepEqual(Object.keys(result.releaseManifest.engineFallbacks).sort(), ['server/data.js', 'server/modes/independent/catalog.js']);
    for (const name of ['package.json', 'assault-release.json', 'copy.json']) {
      const row = result.releaseManifest.files.find((item) => path.basename(item.targetPath) === name);
      assert.ok(row, `${name} metadata row is declared`);
      assert.equal(row.logicalBytes, fs.statSync(row.targetPath).size);
      assert.equal(row.storedBytes, row.logicalBytes);
      assert.equal(row.sourceIdentity, null);
      assert.equal(row.targetIdentity, null);
    }
    const copy = JSON.parse(fs.readFileSync(result.copyReceipt, 'utf8'));
    assert.equal(Object.hasOwn(copy, 'files'), false);
    assert.equal(copy.manifest, result.manifest);
    assert.match(copy.cleanup.sourceWorktreeNativeEntry, /git worktree remove/);
    assert.match(copy.cleanup.publishedArtifactLifecycle, /manifest-listed files/);
    assert.doesNotMatch(copy.cleanup.sourceWorktreeNativeEntry, /release worktree/);
    assert.equal(Buffer.byteLength(fs.readFileSync(result.manifest, 'utf8')), result.releaseManifest.files.find((row) => path.basename(row.targetPath) === 'assault-release.json').logicalBytes);
    assert.equal(result.releaseManifest.totals.generatedMetadataBytes,
      ['package.json', 'assault-release.json', 'copy.json'].reduce((sum, name) => sum + fs.statSync(path.join(plan.roots.code, name)).size, 0));

    const source2 = path.join(tempRoot, 'source2.js'); const target2 = path.join(tempRoot, 'release2', 'source2.js');
    fs.writeFileSync(source2, bytes);
    const before2 = fs.statSync(source2, { bigint: true });
    const failing = fixturePlan(tempRoot, source2, target2);
    failing.generatedMetadata = metadataRows(path.join(tempRoot, 'release2'));
    assert.throws(() => movePlanFiles(failing, { afterMetadata: () => { throw new Error('injected rollback check'); } }), /injected rollback check/);
    const restored = fs.statSync(source2, { bigint: true });
    assert.equal(String(restored.ino), String(before2.ino));
    assert.deepEqual(fs.readFileSync(source2), bytes);
    assert.equal(fs.existsSync(target2), false);
    assert.equal(fs.existsSync(path.join(tempRoot, 'release2', 'package.json')), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('producer adoption manifest is consumed directly by the sibling ReleaseClosed validator', () => {
  const batchRoot = fs.mkdtempSync(path.join(canonicalRoot, '.omni', 'tmp', 'assault', 'releaseclosed-fixture-'));
  try {
    const projectRoot = path.join(batchRoot, 'project');
    const worktreeRoot = path.join(projectRoot, '.worktrees', 'assault', 'stronghold-protocol');
    const codeRoot = path.join(projectRoot, 'publish', 'assault', 'code');
    const rulesRoot = path.join(projectRoot, 'data', 'assault-rules');
    const runtimeRoot = path.join(projectRoot, 'runtime', 'assault');
    const source = path.join(worktreeRoot, 'server', 'probe.js');
    const target = path.join(codeRoot, 'server', 'probe.js');
    fs.mkdirSync(path.dirname(source), { recursive: true }); fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'data'), { recursive: true });
    const localAssets = path.join(projectRoot, 'data', 'local-assets.json');
    fs.writeFileSync(localAssets, '{}\n');
    fs.writeFileSync(source, 'export const fixture = true;\n');
    const gzipTargets = [path.join(runtimeRoot, 'independent-engine-data.js.gz'), path.join(runtimeRoot, 'independent-engine-catalog.js.gz')];
    const fallbackRows = gzipTargets.map((file, index) => {
      fs.writeFileSync(file, `gzip-fixture-${index}`);
      const identity = fileRow(file, file).identity;
      return { source: file, target: file, sourcePath: file, targetPath: file, sourceRelative: file, targetRelative: file,
        role: 'generated-engine-runtime-reference', consumers: ['public/js/independent/client-worker.js'],
        lifetime: 'fixture runtime reference', logicalBytes: fs.statSync(file).size, storedBytes: fs.statSync(file).size,
        identity, sourceIdentity: identity, targetIdentity: identity, bytewiseVerified: true, identityPreserved: true, adopt: false, adopted: false };
    });
    const localAssetsIdentity = fileRow(localAssets, localAssets).identity;
    const roots = { code: codeRoot, rules: rulesRoot, canonical: projectRoot, runtime: runtimeRoot };
    const sourceCommit = process.env.ASSAULT_RELEASE_TEST_SOURCE_COMMIT
      || '9a6e68ad26d7f9399cfe41ab4a563ed287a997fb';
    assert.equal(execFileSync('git', ['-C', canonicalRoot, 'rev-parse', `${sourceCommit}^{commit}`],
      { encoding: 'utf8', env: gitEnvironment }).trim(), sourceCommit);
    const originalReleaseProof = JSON.parse(fs.readFileSync(path.join(canonicalRoot, 'publish', 'assault', 'code', 'assault-release.json'), 'utf8')).nativeEngineProof;
    assert.equal(originalReleaseProof.sourceRevision, '8ce3960f56ec2b67495e100a0caa7ccaf947a270');
    const proofEquivalence = assertNativeProofScopedEquivalent({ canonicalRoot,
      proofRevision: originalReleaseProof.sourceRevision, sourceRevision: sourceCommit,
      comparedPaths: originalReleaseProof.comparedPaths });
    const restoredGitPath = 'server/sim/content/kits/ops/chess_char_1_01-inside.js';
    const restoredBytes = execFileSync('git', ['-C', canonicalRoot, 'show', `${sourceCommit}:${restoredGitPath}`],
      { encoding: null, env: gitEnvironment });
    const restoredSourcePath = path.join(worktreeRoot, ...restoredGitPath.split('/'));
    const restoredTargetPath = path.join(codeRoot, ...restoredGitPath.split('/'));
    fs.mkdirSync(path.dirname(restoredTargetPath), { recursive: true }); fs.writeFileSync(restoredTargetPath, restoredBytes);
    const restoredIdentity = fileRow(restoredTargetPath, restoredTargetPath).identity;
    const restoredRow = { source: restoredSourcePath, target: restoredTargetPath,
      sourcePath: restoredSourcePath, targetPath: restoredTargetPath, sourceRelative: restoredGitPath,
      targetRelative: restoredGitPath, role: 'native-git-restored-runtime-module', consumers: ['Assault Node battle content registry'],
      lifetime: 'retain with formal Assault code release', logicalBytes: restoredBytes.length, storedBytes: restoredBytes.length,
      identity: restoredIdentity, sourceIdentity: null, targetIdentity: restoredIdentity, bytewiseVerified: true,
      identityPreserved: false, adopted: true, adopt: false, metadata: false,
      restorationMethod: 'git-show-exact-blob', sourceCommit, sourceGitPath: restoredGitPath };
    const priorMovableBytes = fs.statSync(source).size;
    const plan = { files: [fileRow(source, target), ...fallbackRows, restoredRow], roots,
      source: { nativeGitCommit: sourceCommit, version: '0.0.0', engineRevision: 'engine-fixture', engineSourceRevision: 'source-fixture' },
      sourceRoot: worktreeRoot, version: '0.0.0', package: { type: 'module', version: '0.0.0', dependencies: { ws: '8.22.0' } },
      engineFallbacks: { 'server/data.js': gzipTargets[0], 'server/modes/independent/catalog.js': gzipTargets[1] },
      references: [{ sourcePath: localAssets, targetPath: localAssets, role: 'canonical-readonly-install-data',
        logicalBytes: 0, storedBytes: localAssetsIdentity.bytes, sourceIdentity: localAssetsIdentity, targetIdentity: localAssetsIdentity,
        adopted: false, consumers: ['public/js/main.js /data/local-assets.json'] }],
      proofEquivalence, totals: { movableFiles: 1, movableBytes: priorMovableBytes,
        restoredFiles: 1, restoredBytes: restoredBytes.length, codeAndRulesBytes: priorMovableBytes + restoredBytes.length },
      rules: {}, generatedMetadata: metadataRows(codeRoot) };
    const producerManifest = buildAssaultReleaseManifest(plan).releaseManifest;
    const restoredManifestRow = producerManifest.files.find((row) => row.sourceGitPath === restoredGitPath);
    assert.equal(restoredManifestRow.sourceIdentity, null, 'native Git restoration cannot claim a source file identity');
    assert.equal(restoredManifestRow.sourceCommit, sourceCommit);
    assert.equal(restoredManifestRow.identityPreserved, false);
    assert.equal(producerManifest.nativeEngineProof.sourceRevision, '8ce3960f56ec2b67495e100a0caa7ccaf947a270');
    assert.equal(producerManifest.nativeEngineProof.scopedEquivalentTo, sourceCommit);
    assert.deepEqual(producerManifest.nativeEngineProof.changedPaths, []);
    assert.equal(producerManifest.totals.movableFiles, 1);
    assert.equal(producerManifest.totals.movableBytes, priorMovableBytes);
    assert.equal(producerManifest.totals.restoredFiles, 1);
    assert.equal(producerManifest.totals.restoredBytes, restoredBytes.length);
    assert.match(JSON.stringify(producerManifest), /native-git-restored-runtime-module/);
    if (!storageValidator) return;
    const adopted = movePlanFiles(plan);
    const requests = storageValidator.nativeGitRestoreRequests(adopted.releaseManifest, { projectRoot });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].sourceCommit, sourceCommit);
    assert.equal(requests[0].sourceGitPath, restoredGitPath);
    fs.mkdirSync(rulesRoot, { recursive: true });
    const measureScript = path.join(canonicalRoot, '.omni', 'tmp', 'assault', 'measure-project-files.ps1');
    const identityPaths = adopted.releaseManifest.files.filter((row) => row.targetPath.startsWith(`${codeRoot}${path.sep}`)).map((row) => row.targetPath);
    const measured = JSON.parse(execFileSync('C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.6.0_x64__8wekyb3d8bbwe\\pwsh.exe',
      ['-NoProfile', '-File', measureScript, '-Profile', 'ReleaseClosed', '-Fixture', '-FixtureCodeRoot', codeRoot, '-FixtureRulesRoot', rulesRoot,
        '-IdentityPathsJson', JSON.stringify(identityPaths)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }));
    const actualFiles = storageValidator.verifyNativeGitRestoredFiles({ manifest: adopted.releaseManifest, actualFiles: measured.files,
      blobs: [{ size: restoredBytes.length, bytes: restoredBytes }], readTarget: (file) => fs.readFileSync(file), projectRoot });
    const removal = { schema: 'assault-worktree-removal/v1', status: 'pass', nativeGitCommit: plan.source.nativeGitCommit,
      worktreeRoot, removalMethod: 'git-worktree-remove', nativeCommand: { argv: ['git', 'worktree', 'remove', worktreeRoot], cwd: projectRoot, exitCode: 0, timedOut: false },
      removedAt: new Date().toISOString(), worktreeAbsent: true, releaseManifest: path.join(codeRoot, 'assault-release.json'),
      sourceBranch: 'assault', sourcePreserved: true, service: { pid: 1234, sourceRoot: codeRoot, sourceRevision: plan.source.nativeGitCommit, status: 'pass' } };
    const result = storageValidator.validateReleaseClosed({ manifest: adopted.releaseManifest, removal, expectedCodeRoot: codeRoot,
      expectedRulesRoot: rulesRoot, expectedCanonicalRoot: projectRoot, expectedRuntimeRoot: runtimeRoot,
      releaseProjectRoot: projectRoot, worktreeExists: false, commitExists: true, actualFiles });
    assert.equal(result.nativeGitCommit, plan.source.nativeGitCommit);
    assert.equal(result.files.length, 5);
    assert.equal(result.files.find((row) => path.basename(row.targetPath) === 'assault-release.json').logicalBytes,
      Buffer.byteLength(fs.readFileSync(adopted.manifest, 'utf8')));
    const wrongSameLength = Buffer.from(restoredBytes); wrongSameLength[0] ^= 1;
    assert.throws(() => storageValidator.verifyNativeGitRestoredFiles({ manifest: adopted.releaseManifest, actualFiles,
      blobs: [{ size: restoredBytes.length, bytes: restoredBytes }],
      readTarget: () => wrongSameLength, projectRoot }), /differ from exact source blob/);
  } finally {
    fs.rmSync(batchRoot, { recursive: true, force: true });
  }
});

test('Assault adoption refuses cross-volume source and target before moving bytes', () => {
  const tempRoot = makeTempFixture('volume-');
  try {
    const source = path.join(tempRoot, 'source.js');
    fs.writeFileSync(source, 'export const volume = true;\n');
    const row = fileRow(source, 'C:\\Windows\\Temp\\assault-release-cross-volume-probe\\rejected.js');
    const plan = { files: [row] };
    assert.throws(() => movePlanFiles(plan), /cross-volume adopt refused/);
    assert.equal(fs.existsSync(source), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Assault adoption rejects same native file ID and size when nanosecond mtime changes', () => {
  const tempRoot = makeTempFixture('mtime-');
  try {
    const source = path.join(tempRoot, 'source.js'); const target = path.join(tempRoot, 'release', 'source.js');
    fs.writeFileSync(source, 'value=1;');
    const row = fileRow(source, target);
    const shifted = new Date(Date.now() + 5000);
    fs.writeFileSync(source, 'value=2;');
    fs.utimesSync(source, shifted, shifted);
    const current = fs.statSync(source, { bigint: true });
    assert.equal(String(current.ino), row.identity.fileId);
    assert.equal(Number(current.size), row.identity.bytes);
    assert.notEqual(String(current.mtimeNs), row.identity.mtimeNs);
    assert.throws(() => movePlanFiles({ files: [row] }), /source file identity changed since plan/);
    assert.equal(fs.existsSync(source), true);
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release rollback puts back the exact nanosecond mtime so the recorded native identity still matches', () => {
  const tempRoot = makeTempFixture('rollback-mtime-');
  try {
    const files = ['a.json', 'b.js', "c'quote.js"].map((name) => path.join(tempRoot, name));
    const recorded = files.map((target, i) => {
      fs.writeFileSync(target, `original ${i}`);
      return { target, mtimeNs: String(fs.statSync(target, { bigint: true }).mtimeNs) };
    });
    for (const [i, target] of files.entries()) {
      fs.writeFileSync(target, `updated ${i}`);
      fs.writeFileSync(target, `original ${i}`); // rollback rewrite stamps a fresh mtime
    }
    assert.ok(recorded.some((row) => String(fs.statSync(row.target, { bigint: true }).mtimeNs) !== row.mtimeNs)
      || recorded.length === 0);
    assert.deepEqual(restoreNativeMtimes(recorded), []);
    for (const row of recorded) assert.equal(String(fs.statSync(row.target, { bigint: true }).mtimeNs), row.mtimeNs);
    assert.match(restoreNativeMtimes([{ target: path.join(tempRoot, 'missing.js'), mtimeNs: recorded[0].mtimeNs }]).join(' '), /missing\.js/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Assault adoption rejects occupied targets without overwriting either file', () => {
  const tempRoot = makeTempFixture('conflict-');
  try {
    const source = path.join(tempRoot, 'source.js'); const target = path.join(tempRoot, 'target.js');
    fs.writeFileSync(source, 'source bytes'); fs.writeFileSync(target, 'pre-existing target');
    const sourceBytes = fs.readFileSync(source); const targetBytes = fs.readFileSync(target);
    assert.throws(() => movePlanFiles({ files: [fileRow(source, target)] }), /target conflict/);
    assert.deepEqual(fs.readFileSync(source), sourceBytes);
    assert.deepEqual(fs.readFileSync(target), targetBytes);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('service keeps development roots and rejects a parent fallback; Assault rules root is explicit and absolute', { skip: !sourceWorktreeAvailable }, () => {
  const config = resolveAssaultServiceConfig({ sourceRoot, canonicalRoot });
  assert.equal(config.mode, 'development');
  assert.equal(config.sourceRoot, sourceRoot);
  assert.equal(config.dataRoot, path.join(sourceRoot, 'data'));
  assert.throws(() => resolveAssaultServiceConfig({ sourceRoot: path.join(canonicalRoot, 'data'), canonicalRoot }), /development source path is not its own Git root/);
  const old = process.env.SP_ASSAULT_RULES_ROOT;
  try {
    delete process.env.SP_ASSAULT_RULES_ROOT;
    assert.equal(getAssaultRulesRoot(), path.join(sourceRoot, 'data'));
    process.env.SP_ASSAULT_RULES_ROOT = path.join(canonicalRoot, 'data', 'assault-rules');
    assert.equal(getAssaultRulesRoot(), path.join(canonicalRoot, 'data', 'assault-rules'));
    process.env.SP_ASSAULT_RULES_ROOT = 'relative-rules';
    assert.throws(() => getAssaultRulesRoot(), /must be absolute/);
  } finally {
    if (old === undefined) delete process.env.SP_ASSAULT_RULES_ROOT;
    else process.env.SP_ASSAULT_RULES_ROOT = old;
  }
});

test('published service requires adopted manifest, exact registered roots, native source revision, and module package version', () => {
  const codeRoot = path.join(canonicalRoot, 'publish', 'assault', 'code');
  const code = codeRoot;
  const rules = path.join(canonicalRoot, 'data', 'assault-rules');
  const runtime = path.join(canonicalRoot, 'runtime', 'assault');
  const packageJson = { type: 'module', version: '0.2.5', dependencies: { ws: '8.22.0' } };
  const manifest = { schema: 'assault-release/v1', status: 'pass', adoptionStatus: 'adopted',
    roots: { code, rules, canonical: canonicalRoot, runtime },
    source: { nativeGitCommit: '8ce3960f56ec2b67495e100a0caa7ccaf947a270', version: packageJson.version },
    metadataAllowlist: ['package.json', 'assault-release.json', 'copy.json'] };
  assert.deepEqual(validateReleaseContract(manifest, { codeRoot: code, canonicalRoot, packageJson }),
    { codeRoot: code, rulesRoot: rules, runtimeRoot: runtime, revision: manifest.source.nativeGitCommit });
  assert.throws(() => validateReleaseContract({ ...manifest, status: 'planned' }, { codeRoot: code, canonicalRoot, packageJson }), /fully adopted pass/);
  assert.throws(() => validateReleaseContract({ ...manifest, roots: { ...manifest.roots, rules: canonicalRoot } }, { codeRoot: code, canonicalRoot, packageJson }), /roots do not match/);
  assert.throws(() => validateReleaseContract({ ...manifest, source: { ...manifest.source, version: '0.2.4' } }, { codeRoot: code, canonicalRoot, packageJson }), /package version/);
  assert.throws(() => validateReleaseContract({ ...manifest, source: { ...manifest.source, nativeGitCommit: '../HEAD' } }, { codeRoot: code, canonicalRoot, packageJson }), /source commit is invalid/);
  assert.throws(() => validateReleaseContract(manifest, { codeRoot, canonicalRoot, packageJson: { ...packageJson, type: 'commonjs' } }), /module type/);
  assert.throws(() => validateReleaseContract({ ...manifest, metadataAllowlist: ['package.json', 'runtime.json'] }, { codeRoot, canonicalRoot, packageJson }), /metadata allowlist/);
});
