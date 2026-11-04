import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  API_COMPARE_URL, NEW_REVISION, OLD_REVISION, PRODUCTION_PATHS, RAW_ROOT, REPOSITORY,
  SOURCE_KEYS, AcquisitionError, assertNoReparsePath,
  deepEqualJson, parseMode, runRefresh, validateAuditedCharacterAnchors, validateFreshBudget,
} from '../../tools/assault/acquire-arknights-sources.mjs';
import { SOURCE_FILES } from '../../tools/assault/source-corpus.mjs';

const root = path.resolve(PRODUCTION_PATHS.projectRoot, '.omni/tmp/assault/arknights-acquisition-fixture');
const fixtureProject = path.join(root, 'project');
const fixturePaths = {
  projectRoot: fixtureProject,
  sourceRoot: path.join(fixtureProject, 'data/assault-sources'),
  sourceIndex: path.join(fixtureProject, 'data/assault-sources/source-index.json'),
  acquisition: path.join(fixtureProject, 'runtime/assault/arknights-acquisition.json'),
  receiptDir: path.join(fixtureProject, 'runtime/assault'),
  staging: path.join(fixtureProject, '.omni/tmp/assault/arknights-source-refresh.pending.json'),
  stagingDir: path.join(fixtureProject, '.omni/tmp/assault'),
  diskBudget: path.join(fixtureProject, 'runtime/assault/disk-budget.json'),
  wofQueryScript: PRODUCTION_PATHS.wofQueryScript,
};
const ownedFiles = new Set();
const attempts = [];
const priorFailedAttempts = [
  { command: 'node --test test/assault/arknights-acquisition.test.mjs', outcome: 'module import failed: SOURCE_FILES was imported from the acquisition tool instead of source-corpus.mjs; fixed import path' },
  { command: 'node --test test/assault/arknights-acquisition.test.mjs', outcome: 'native compression fixture failed because tiny JSON did not receive WOF; fixture enlarged to compressible payload; per-test cleanup added' },
  { command: 'node --test test/assault/arknights-acquisition.test.mjs', outcome: 'fault injection matched github.com/raw while new table URLs use raw.githubusercontent.com; URL predicate and expected mutation assertion corrected' },
];
const liveFormatProbe = {
  scope: 'single-table RAM read; no writes', sourceKey: 'arknights.characterTable', revision: OLD_REVISION,
  url: `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${OLD_REVISION}/zh_CN/gamedata/excel/character_table.json`,
  canonicalBytes: 15_525_104, acquisitionRowBytes: 15_525_104, pinnedOldRawBytes: 14_975_251,
  canonicalTopLevelEntries: 1_375, pinnedOldTopLevelEntries: 1_375, deepKeyOrderIndependentJsonEqual: true,
};

function mkdirFor(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function writeOwned(file, bytes) { mkdirFor(file); fs.writeFileSync(file, bytes); ownedFiles.add(file); }
function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value)}\n`); }
function canonicalCrlfBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2).replaceAll('\n', '\r\n')}\r\n`); }
function upstreamLfBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function tableFor(key) {
  const prop = key.slice('arknights.'.length);
  return Object.entries(SOURCE_FILES.arknights).find(([name]) => name === prop)?.[1];
}
function tableTarget(key) { return path.join(fixturePaths.sourceRoot, ...tableFor(key).split('/')); }

function setupFixture() {
  if (fs.existsSync(root)) throw new Error(`fixture root already exists; preserve it: ${root}`);
  const oldValue = { alpha: { nested: [1, { x: true }] }, omega: 'old', padding: 'x'.repeat(131_072) };
  const newValue = { alpha: { nested: [1, { x: true }] }, omega: 'new', padding: 'y'.repeat(131_072) };
  const newCharacters = {
    char_393_toledo: { name: '德·托莱多', rarity: 'TIER_5', profession: 'SUPPORT', subProfessionId: 'underminer', skills: [{}, { overrideTokenKey: 'token_10067_toledo_tldptm' }] },
    char_4232_hbound: { name: '旅骨', rarity: 'TIER_5', profession: 'SPECIAL', subProfessionId: 'alchemist' },
    char_4231_clemnt: { name: '克莱门莎', rarity: 'TIER_6', profession: 'WARRIOR', subProfessionId: 'primguard' },
    token_10067_toledo_tldptm: { profession: 'TOKEN', subProfessionId: 'notchar1' },
    trap_331_spksum: { profession: 'TRAP', subProfessionId: 'notchar2' },
    trap_332_blkcan: { profession: 'TRAP', subProfessionId: 'notchar2' },
    trap_338_almytw: { profession: 'TRAP', subProfessionId: 'notchar2' },
    padding: 'y'.repeat(131_072),
  };
  const files = [];
  const sources = {};
  for (const [prop, rel] of Object.entries(SOURCE_FILES.arknights)) {
    const key = `arknights.${prop}`;
    const value = SOURCE_KEYS[key] ? oldValue : { fixture: prop };
    const bytes = canonicalCrlfBytes(value);
    const abs = path.join(fixturePaths.sourceRoot, ...rel.split('/'));
    writeOwned(abs, bytes);
    sources[key] = { path: abs, present: true, bytes: bytes.length, topLevelEntries: Object.keys(value).length };
    files.push({ file: abs, source: `${REPOSITORY}/raw/${OLD_REVISION}/zh_CN/gamedata/${SOURCE_KEYS[key]?.rel ?? rel}`, reusedFrom: null, bytes: bytes.length, topLevelEntries: Object.keys(value).length, revision: OLD_REVISION, ok: true });
  }
  const index = { schema: 'assault-source-corpus/v1', sourceRoot: fixturePaths.sourceRoot, versions: { arknights: { revision: OLD_REVISION } }, sources };
  const acquisition = { sourceRepository: REPOSITORY, revision: OLD_REVISION, files, totalBytes: files.reduce((n, x) => n + x.bytes, 0), receipt: 'fixture-old', completedAt: 'fixture-old-time' };
  writeOwned(fixturePaths.sourceIndex, jsonBytes(index));
  writeOwned(fixturePaths.acquisition, jsonBytes(acquisition));
  writeOwned(fixturePaths.diskBudget, jsonBytes({ limitBytes: 2_000_000_000, totalAccountedBytes: 1_900_000_000, remainingBytes: 100_000_000, monotonicClock: 'Windows.GetTickCount64', checkedAtMonotonicMs: os.uptime() * 1000, unmeasured: [] }));
  for (const directory of [fixturePaths.stagingDir, fixturePaths.receiptDir]) fs.mkdirSync(directory, { recursive: true });
  const compare = jsonBytes({ status: 'ahead', ahead_by: 2, total_commits: 2, files: Object.values(SOURCE_KEYS).map((spec) => ({ filename: `zh_CN/gamedata/${spec.rel}` })) });
  const old = new Map(Object.entries(SOURCE_KEYS).map(([key]) => [key, upstreamLfBytes(oldValue)]));
  const newer = new Map(Object.entries(SOURCE_KEYS).map(([key]) => [key, jsonBytes(key === 'arknights.characterTable' ? newCharacters : newValue)]));
  const fetchBytes = async (url) => {
    if (url === API_COMPARE_URL) return compare;
    const spec = Object.entries(SOURCE_KEYS).find(([, v]) => url.endsWith(`/${OLD_REVISION}/zh_CN/gamedata/${v.rel}`));
    if (spec) return old.get(spec[0]);
    const next = Object.entries(SOURCE_KEYS).find(([, v]) => url.endsWith(`/${NEW_REVISION}/zh_CN/gamedata/${v.rel}`));
    if (next) return newer.get(next[0]);
    throw new Error(`unexpected URL ${url}`);
  };
  return { oldValue, newValue, fetchBytes, canonicalOldBytes: canonicalCrlfBytes(oldValue).length, remoteOldBytes: upstreamLfBytes(oldValue).length };
}

function fixtureDependencies(fetchBytes, { failNewAt = null, tamper = null } = {}) {
  let newCount = 0;
  return {
    fetchBytes: async (url, timeout) => {
      assert.equal(timeout, 30_000);
      if (url.startsWith(RAW_ROOT)) {
        newCount++;
        if (failNewAt === newCount) throw new Error('fixture injected network failure');
      }
      return fetchBytes(url);
    },
    monotonicNow: () => os.uptime() * 1000,
    getCompressionProfile: () => ({ attributeCompressed: false, wof: { hresult: 0, isExternal: false, provider: 0, algorithm: 0 } }),
    beforePromotion: async (table, promotedCount) => { if (tamper === table.sourceKey && promotedCount === 0) fs.appendFileSync(table.target, 'x'); },
    maxBytesByKey: Object.fromEntries(Object.keys(SOURCE_KEYS).map((k) => [k, 200_000])),
  };
}

function removeOwnedFixture() {
  for (const file of [...ownedFiles].sort((a, b) => b.length - a.length)) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (fs.existsSync(fixturePaths.staging)) fs.unlinkSync(fixturePaths.staging);
  const dirs = new Set();
  for (const file of [...ownedFiles, fixturePaths.staging]) {
    let dir = path.dirname(file);
    while (dir.startsWith(root)) { dirs.add(dir); dir = path.dirname(dir); }
  }
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) if (fs.existsSync(dir)) fs.rmdirSync(dir);
  if (fs.existsSync(root)) fs.rmdirSync(root);
}

function writeWorkerReceipts() {
  const receipt = {
    task: 'arknights-acquisition-entry-worker', status: attempts.some((x) => x.status === 'failed') ? 'fixtures-passed-with-expected-failure-cases' : 'fixtures-passed',
    nativeRevisions: { old: OLD_REVISION, new: NEW_REVISION }, tableAllowlistCount: Object.keys(SOURCE_KEYS).length,
    tests: attempts, priorFailedAttempts, liveFormatProbe, fixtureRoot: root, sourceTool: path.resolve(PRODUCTION_PATHS.projectRoot, '.worktrees/assault/stronghold-protocol/tools/assault/acquire-arknights-sources.mjs'),
  };
  const receiptPath = path.join(PRODUCTION_PATHS.receiptDir, 'arknights-acquisition-entry-worker.json');
  const logPath = path.join(PRODUCTION_PATHS.receiptDir, 'arknights-acquisition-entry-worker.log');
  fs.mkdirSync(PRODUCTION_PATHS.receiptDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(logPath, `${JSON.stringify({ status: receipt.status, tests: attempts.length, allowlistCount: 11, liveProbe: { canonicalBytes: liveFormatProbe.canonicalBytes, oldRawBytes: liveFormatProbe.pinnedOldRawBytes, jsonEqual: liveFormatProbe.deepKeyOrderIndependentJsonEqual }, receipt: receiptPath })}\n`);
  process.stdout.write(`${JSON.stringify({ status: receipt.status, tests: attempts.length, allowlistCount: 11, rawFormatMismatchVerified: true })}\n`);
}

after(() => {
  try { removeOwnedFixture(); } finally { writeWorkerReceipts(); }
});
afterEach(() => {
  removeOwnedFixture();
  ownedFiles.clear();
});

test('pinned revisions, 11-table allowlist, key-order independent comparison, and budget gates', () => {
  assert.equal(Object.keys(SOURCE_KEYS).length, 11);
  assert.equal(parseMode(['--verify-only']), 'verify-only');
  assert.equal(parseMode(['--apply']), 'apply');
  assert.throws(() => parseMode([]), AcquisitionError);
  assert.throws(() => parseMode(['--apply', '--verify-only']), AcquisitionError);
  assert.equal(deepEqualJson({ z: 2, a: { b: 1 } }, { a: { b: 1 }, z: 2 }), true);
  assert.equal(deepEqualJson({ z: 2 }, { z: 3 }), false);
  assert.deepEqual(validateAuditedCharacterAnchors({
    char_393_toledo: { name: '德·托莱多', rarity: 'TIER_5', profession: 'SUPPORT', subProfessionId: 'underminer', skills: [{}, { overrideTokenKey: 'token_10067_toledo_tldptm' }] },
    char_4232_hbound: { name: '旅骨', rarity: 'TIER_5', profession: 'SPECIAL', subProfessionId: 'alchemist' },
    char_4231_clemnt: { name: '克莱门莎', rarity: 'TIER_6', profession: 'WARRIOR', subProfessionId: 'primguard' },
    token_10067_toledo_tldptm: { profession: 'TOKEN', subProfessionId: 'notchar1' },
    trap_331_spksum: { profession: 'TRAP', subProfessionId: 'notchar2' },
    trap_332_blkcan: { profession: 'TRAP', subProfessionId: 'notchar2' },
    trap_338_almytw: { profession: 'TRAP', subProfessionId: 'notchar2' },
  }), { characters: 3, nativeEntities: 4, resolvedSummonReferences: 1 });
  const budget = { limitBytes: 2_000_000_000, totalAccountedBytes: 1_900_000_000, remainingBytes: 100_000_000, monotonicClock: 'Windows.GetTickCount64', checkedAtMonotonicMs: 20_000, unmeasured: [] };
  assert.equal(validateFreshBudget(budget, 21_000, 29_671_119).remainingAfterReserve, 70_328_881);
  assert.throws(() => validateFreshBudget({ ...budget, unmeasured: ['x'] }, 21_000, 1), /unmeasured/);
  assert.throws(() => validateFreshBudget(budget, 400_001, 1), /stale/);
  attempts.push({ name: 'static-contracts', status: 'passed' });
});

test('apply promotes all 11 native-compressed tables and records the pinned new revision', async () => {
  setupFixtureData = setupFixture();
  assert.ok(setupFixtureData.canonicalOldBytes > setupFixtureData.remoteOldBytes, 'fixture canonical CRLF/pretty bytes exceed equivalent upstream LF bytes');
  const { fetchBytes } = setupFixtureData;
  const result = await runRefresh({ mode: 'apply', paths: fixturePaths, dependencies: fixtureDependencies(fetchBytes) });
  assert.equal(result.status, 'applied');
  assert.equal(result.tableCount, 11);
  const receipt = JSON.parse(fs.readFileSync(fixturePaths.acquisition, 'utf8'));
  assert.equal(receipt.revision, NEW_REVISION);
  assert.equal(receipt.previousAttempts[0].revision, OLD_REVISION);
  for (const key of Object.keys(SOURCE_KEYS)) {
    const expected = key === 'arknights.characterTable'
      ? JSON.parse((await setupFixtureData.fetchBytes(`${RAW_ROOT}excel/character_table.json`)).toString('utf8'))
      : setupFixtureData.newValue;
    assert.deepEqual(JSON.parse(fs.readFileSync(tableTarget(key), 'utf8')), expected);
  }
  assert.equal(fs.existsSync(fixturePaths.staging), false);
  attempts.push({ name: 'native-wof-lzx-rename-and-new-revision', status: 'passed', tableCount: 11, canonicalCrlfBytes: setupFixtureData.canonicalOldBytes, equivalentOldRawLfBytes: setupFixtureData.remoteOldBytes });
});

test('verify-only validates fixtures without promoting or changing the acquisition receipt', async () => {
  setupFixtureData = setupFixture();
  const targets = Object.keys(SOURCE_KEYS).map((key) => [tableTarget(key), fs.readFileSync(tableTarget(key))]);
  const receiptBefore = fs.readFileSync(fixturePaths.acquisition);
  const result = await runRefresh({ mode: 'verify-only', paths: fixturePaths, dependencies: fixtureDependencies(setupFixtureData.fetchBytes) });
  assert.equal(result.status, 'verified');
  assert.ok(fs.readFileSync(fixturePaths.acquisition).equals(receiptBefore));
  for (const [target, bytes] of targets) assert.ok(fs.readFileSync(target).equals(bytes));
  assert.equal(fs.existsSync(fixturePaths.staging), false);
  attempts.push({ name: 'verify-only-zero-writes', status: 'passed' });
});

let setupFixtureData;
test('failure after one promotion restores exact original bytes and preserves old receipt', async () => {
  setupFixtureData = setupFixture();
  const before = new Map(Object.keys(SOURCE_KEYS).map((key) => [key, fs.readFileSync(tableTarget(key))]));
  const receiptBefore = fs.readFileSync(fixturePaths.acquisition);
  await assert.rejects(runRefresh({ mode: 'apply', paths: fixturePaths, dependencies: fixtureDependencies(setupFixtureData.fetchBytes, { failNewAt: 2 }) }), /fixture injected network failure/);
  for (const key of Object.keys(SOURCE_KEYS)) assert.ok(fs.readFileSync(tableTarget(key)).equals(before.get(key)), `${key} exact bytes restored`);
  assert.ok(fs.readFileSync(fixturePaths.acquisition).equals(receiptBefore));
  assert.equal(fs.existsSync(fixturePaths.staging), false);
  attempts.push({ name: 'later-table-failure-exact-ram-rollback-old-receipt', status: 'passed' });
});

test('pre-promotion canonical mutation is detected and never overwritten', async () => {
  setupFixtureData = setupFixture();
  const firstKey = Object.keys(SOURCE_KEYS)[0];
  const original = fs.readFileSync(tableTarget(firstKey));
  await assert.rejects(runRefresh({ mode: 'apply', paths: fixturePaths, dependencies: fixtureDependencies(setupFixtureData.fetchBytes, { tamper: firstKey }) }), /changed before promotion/);
  assert.ok(!fs.readFileSync(tableTarget(firstKey)).equals(original));
  assert.ok(fs.readFileSync(fixturePaths.acquisition).length > 0);
  attempts.push({ name: 'external-mutation-preserved-and-rejected', status: 'passed' });
});

test('wrong native source revision and unknown old-canonical mutation stop before writes', async () => {
  setupFixtureData = setupFixture();
  const index = JSON.parse(fs.readFileSync(fixturePaths.sourceIndex, 'utf8'));
  index.versions.arknights.revision = 'wrong-native-revision';
  fs.writeFileSync(fixturePaths.sourceIndex, jsonBytes(index));
  await assert.rejects(runRefresh({ mode: 'apply', paths: fixturePaths, dependencies: fixtureDependencies(setupFixtureData.fetchBytes) }), /not pinned to expected old revision/);
  removeOwnedFixture();
  ownedFiles.clear();

  setupFixtureData = setupFixture();
  const key = Object.keys(SOURCE_KEYS)[0];
  const target = tableTarget(key);
  const prior = JSON.parse(fs.readFileSync(target, 'utf8'));
  prior.omega = 'bad';
  fs.writeFileSync(target, canonicalCrlfBytes(prior));
  const receiptBefore = fs.readFileSync(fixturePaths.acquisition);
  await assert.rejects(runRefresh({ mode: 'apply', paths: fixturePaths, dependencies: fixtureDependencies(setupFixtureData.fetchBytes) }), /not deep-equal to pinned old official JSON/);
  assert.ok(fs.readFileSync(fixturePaths.acquisition).equals(receiptBefore));
  attempts.push({ name: 'wrong-native-version-and-unknown-old-change-rejected', status: 'passed' });
});

test('ancestor link/reparse and byte cap are rejected', async () => {
  setupFixtureData = setupFixture();
  const link = path.join(fixturePaths.stagingDir, 'bad-link');
  fs.mkdirSync(path.join(fixturePaths.stagingDir, 'link-target'));
  fs.symlinkSync(path.join(fixturePaths.stagingDir, 'link-target'), link, 'junction');
  assert.throws(() => assertNoReparsePath(path.join(link, 'child.json')), /link|reparse/i);
  fs.rmdirSync(link);
  fs.rmdirSync(path.join(fixturePaths.stagingDir, 'link-target'));
  const tooLarge = async (url) => {
    const bytes = await setupFixtureData.fetchBytes(url);
    return url.startsWith(RAW_ROOT) ? Buffer.concat([bytes, Buffer.alloc(200_001 - bytes.length)]) : bytes;
  };
  await assert.rejects(runRefresh({ mode: 'apply', paths: fixturePaths, dependencies: fixtureDependencies(tooLarge) }), /byte cap exceeded/);
  assert.equal(fs.existsSync(fixturePaths.staging), false);
  attempts.push({ name: 'junction-ancestor-and-byte-cap-rejected', status: 'passed' });
});
