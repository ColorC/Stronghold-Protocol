// A checkout without its own install (a Git worktree: public/assets, public/vendor, public/fonts and
// data/local-assets.json are git-ignored) serves another install's copies read-only through `installDir`; its own
// files still win, and nothing outside the three install folders comes from the other install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createStaticHandler } from '../server/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function serve(opts) {
  const handler = createStaticHandler({ sharedDir: path.join(ROOT, 'shared'), ...opts });
  const srv = http.createServer((req, res) => {
    const [p, q] = req.url.split('?');
    handler(req, res, p, q || '');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

function get(srv, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: url }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('installDir serves the install folders a checkout lacks, never its other files', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-'));
  const install = path.join(base, 'install'); const checkout = path.join(base, 'checkout');
  write(path.join(install, 'public', 'assets', 'bond', 'a.png'), 'install-art');
  write(path.join(install, 'public', 'vendor', 'lib.js'), 'install-vendor');
  write(path.join(install, 'public', 'fonts', 'fonts.css'), 'install-fonts');
  write(path.join(install, 'public', 'index.html'), 'install-page');
  write(path.join(install, 'data', 'local-assets.json'), '{"version":1,"groups":{"x":{}}}');
  write(path.join(checkout, 'public', 'index.html'), 'checkout-page');
  write(path.join(checkout, 'public', 'assets', 'partial', 'sentinel.txt'), 'source-assets-folder-exists');
  write(path.join(checkout, 'public', 'vendor', 'checkout.js'), 'checkout-vendor');
  write(path.join(checkout, 'public', 'fonts', 'checkout.css'), 'checkout-fonts');
  write(path.join(checkout, 'data', 'config.json'), '{}');
  const srv = await serve({ publicDir: path.join(checkout, 'public'), dataDir: path.join(checkout, 'data'), installDir: install });
  try {
    assert.equal((await get(srv, '/assets/bond/a.png')).body, 'install-art');
    assert.equal((await get(srv, '/vendor/lib.js')).body, 'install-vendor');
    // the installed manifest belongs to the installed local-art tree
    assert.equal((await get(srv, '/vendor/checkout.js')).body, 'checkout-vendor');
    assert.equal((await get(srv, '/fonts/checkout.css')).body, 'checkout-fonts');
    assert.equal((await get(srv, '/assets/partial/sentinel.txt')).body, 'source-assets-folder-exists');
    assert.equal((await get(srv, '/index.html')).body, 'checkout-page');
    assert.deepEqual(JSON.parse((await get(srv, '/data/local-assets.json')).body).groups, { x: {} });
    assert.notEqual((await get(srv, '/assets/../index.html')).body, 'install-page');
  } finally {
    srv.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('install public assets fall back per missing file while checkout files retain priority', { timeout: 30000 }, async () => {
  const canonical = path.resolve(ROOT, '..', '..', '..');
  assert.equal(path.resolve(execFileSync('git', ['-C', canonical, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()), canonical);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-file-fallback-'));
  const checkout = path.join(base, 'checkout'), install = canonical;
  const tokenRelative = path.join('assets', 'local', 'spine', 'token', 'token_10067_toledo_tldptm', 'token_10067_toledo_tldptm.skel');
  const expectedToken = fs.readFileSync(path.join(install, 'public', tokenRelative));
  const own = Buffer.from('checkout override bytes');
  write(path.join(checkout, 'public', 'assets', 'partial', 'sentinel.txt'), 'source-assets-folder-exists');
  const srv = await serve({ publicDir: path.join(checkout, 'public'), dataDir: path.join(checkout, 'data'), installDir: install });
  try {
    const tokenUrl = '/' + tokenRelative.split(path.sep).join('/');
    const missing = await rawArchiveRequest(srv, tokenUrl);
    assert.equal(missing.status, 200); assert(missing.body.equals(expectedToken), 'missing checkout Toledo skel is byte-identical to canonical install');
    const head = await rawArchiveRequest(srv, tokenUrl, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(head.headers['content-length'], String(expectedToken.length));
    write(path.join(checkout, 'public', 'assets', 'local', 'spine', 'token', 'token_10067_toledo_tldptm', 'token_10067_toledo_tldptm.skel'), own);
    const override = await rawArchiveRequest(srv, tokenUrl, { headers: { 'Accept-Encoding': 'identity' } });
    assert.equal(override.status, 200); assert(override.body.equals(own), 'checkout-owned file wins over install');
    assert.equal((await rawArchiveRequest(srv, '/assets/%2e%2e/data/config.json')).status, 403);
  } finally { await new Promise(resolve => srv.close(resolve)); fs.rmSync(base, { recursive: true, force: true }); }
});

test('installed local-art manifest wins over stale checkout manifest and keeps HTTP cache semantics', { timeout: 30000 }, async () => {
  const canonical = path.resolve(ROOT, '..', '..', '..');
  const actualCanonical = execFileSync('git', ['-C', canonical, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  assert.equal(path.resolve(actualCanonical), canonical, 'test must use the canonical repository, not a copied checkout');
  const stalePath = path.join(ROOT, 'data', 'local-assets.json');
  const staleBytes = fs.readFileSync(stalePath);
  const stale = JSON.parse(fs.readFileSync(stalePath, 'utf8'));
  // (1511 + the six mesh/trap_110 entries of the official 射击台 / 阻隔工事 models)
  assert.equal(stale.count, 1517, 'fixture is the real stale checkout manifest');
  assert.equal(Object.keys(stale.groups).some(group => group.startsWith('scene/act2autochess_m03')), false);
  const fixtureParent = path.join(canonical, '.omni', 'tmp', 'assault');
  const base = path.join(fixtureParent, `local-art-installed-precedence-${process.pid}`);
  assert.equal(fs.existsSync(base), false, 'refuse to reuse an existing fixture path');
  for (let dir = fixtureParent; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (fs.existsSync(dir)) assert(!fs.lstatSync(dir).isSymbolicLink(), `fixture ancestor must not be a symlink: ${dir}`);
  }
  const checkout = path.join(base, 'checkout'), install = path.join(base, 'install');
  const checkoutManifest = path.join(checkout, 'data', 'local-assets.json');
  const checkoutConfig = path.join(checkout, 'data', 'config.json');
  const installedPath = path.join(install, 'data', 'local-assets.json');
  const scenePath = path.join(install, 'public', 'assets', 'local', 'scene', 'act2autochess_m03', 'scene.json');
  const installed = JSON.parse(staleBytes.toString('utf8'));
  installed.groups['scene/act2autochess_m03'] = {
    scene: { path: '/assets/local/scene/act2autochess_m03/scene.json', kind: 'Scene' },
    lighting: { path: '/assets/local/scene/act2autochess_m03/lighting.json', kind: 'Lighting' },
    themes: { path: '/assets/local/scene/act2autochess_m03/themes.json', kind: 'Themes' },
    commonDeps: { path: '/assets/local/scene/act2autochess_m03/common-deps.json', kind: 'CommonDeps' },
    lm0: { path: '/assets/local/scene/act2autochess_m03/lm0.webp', kind: 'Lightmap' },
    lm1: { path: '/assets/local/scene/act2autochess_m03/lm1.webp', kind: 'Lightmap' },
    bin: { path: '/assets/local/scene/act2autochess_m03/scene.bin', kind: 'SceneBinary' },
  };
  installed.count = 1524;
  const installedBytes = Buffer.from(JSON.stringify(installed));
  for (const [group, entries] of Object.entries(stale.groups)) assert.deepEqual(installed.groups[group], entries, `installed fixture preserves prior group ${group}`);
  fs.mkdirSync(base, { recursive: true });
  write(checkoutManifest, staleBytes);
  write(checkoutConfig, '{}');
  write(installedPath, installedBytes);
  write(scenePath, '{"scene":"act2autochess_m03"}');
  assert.equal(installed.count, 1524, 'fixture preserves 1517 checkout resources and adds seven scene resources');
  assert.deepEqual(installed.groups['scene/act2autochess_m03'].scene, { path: '/assets/local/scene/act2autochess_m03/scene.json', kind: 'Scene' });

  const srv = await serve({ publicDir: path.join(checkout, 'public'), dataDir: path.join(checkout, 'data'), installDir: install });
  try {
    const url = '/data/local-assets.json?v=local-art-test';
    const response = await rawArchiveRequest(srv, url);
    assert.equal(response.status, 200);
    assert(response.body.equals(installedBytes), 'normal route serves the installed manifest bytes');
    const bodyManifest = JSON.parse(response.body.toString('utf8'));
    for (const [group, entries] of Object.entries(stale.groups)) assert.deepEqual(bodyManifest.groups[group], entries, `served manifest retains prior group ${group}`);
    assert(bodyManifest.groups['scene/act2autochess_m03']?.scene, 'served manifest includes the scene group');
    assert(response.headers.etag, 'installed manifest retains the normal file ETag');
    assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
    const head = await rawArchiveRequest(srv, url, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.body.length, 0);
    assert.equal(head.headers.etag, response.headers.etag);
    assert.equal(head.headers['content-length'], response.headers['content-length']);
    const fresh = await rawArchiveRequest(srv, url, { headers: { 'If-None-Match': response.headers.etag } });
    assert.equal(fresh.status, 304); assert.equal(fresh.body.length, 0);
    const scene = await rawArchiveRequest(srv, '/assets/local/scene/act2autochess_m03/scene.json');
    assert.equal(scene.status, 200); assert(scene.body.equals(fs.readFileSync(scenePath)));
    const checkoutData = await rawArchiveRequest(srv, '/data/config.json');
    assert.equal(checkoutData.status, 200, 'other data routes still use the checkout mount');
  } finally {
    await new Promise((resolve, reject) => srv.close(error => error ? reject(error) : resolve()));
    for (const file of [checkoutManifest, checkoutConfig, installedPath, scenePath]) if (fs.existsSync(file)) fs.unlinkSync(file);
    for (const dir of [path.dirname(checkoutManifest), path.dirname(installedPath), path.dirname(scenePath), path.join(install, 'public', 'assets', 'local', 'scene', 'act2autochess_m03'), path.join(install, 'public', 'assets', 'local', 'scene'), path.join(install, 'public', 'assets', 'local'), path.join(install, 'public', 'assets'), path.join(install, 'public'), checkout, install, base]) if (fs.existsSync(dir)) fs.rmdirSync(dir);
  }
});

test('local-art manifest fallback keeps checkout and empty behavior without an installed manifest', async () => {
  const canonical = path.resolve(ROOT, '..', '..', '..');
  const fixtureParent = path.join(canonical, '.omni', 'tmp', 'assault');
  const base = path.join(fixtureParent, `local-art-precedence-fixtures-${process.pid}`);
  assert.equal(fs.existsSync(base), false, 'refuse to reuse an existing fixture path');
  for (let dir = fixtureParent; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (fs.existsSync(dir)) assert(!fs.lstatSync(dir).isSymbolicLink(), `fixture ancestor must not be a symlink: ${dir}`);
  }
  fs.mkdirSync(base, { recursive: true });
  const checkout = path.join(base, 'checkout'), install = path.join(base, 'install');
  const stale = '{"version":1,"count":1511,"groups":{"legacy":{"item":{"path":"/assets/local/legacy/item.png"}}}}';
  write(path.join(checkout, 'data', 'local-assets.json'), stale);
  write(path.join(install, 'data', 'config.json'), '{}');
  const installedMissing = await serve({ publicDir: path.join(checkout, 'public'), dataDir: path.join(checkout, 'data'), installDir: install });
  try { assert.equal((await get(installedMissing, '/data/local-assets.json')).body, stale); }
  finally { await new Promise(resolve => installedMissing.close(resolve)); }
  const noInstall = await serve({ publicDir: path.join(checkout, 'public'), dataDir: path.join(checkout, 'data') });
  try { assert.equal((await get(noInstall, '/data/local-assets.json')).body, stale); }
  finally { await new Promise(resolve => noInstall.close(resolve)); }
  const emptyBase = path.join(base, 'empty'); fs.mkdirSync(emptyBase);
  const empty = await serve({ publicDir: path.join(emptyBase, 'public'), dataDir: path.join(emptyBase, 'data') });
  try { assert.deepEqual(JSON.parse((await get(empty, '/data/local-assets.json')).body).groups, {}); }
  finally {
    await new Promise(resolve => empty.close(resolve));
    for (const file of [path.join(checkout, 'data', 'local-assets.json'), path.join(install, 'data', 'config.json')]) if (fs.existsSync(file)) fs.unlinkSync(file);
    for (const dir of [path.join(checkout, 'data'), path.join(install, 'data'), checkout, install, emptyBase, base]) if (fs.existsSync(dir)) fs.rmdirSync(dir);
  }
});

test('installDir serves the dev pages a checkout lacks; a checkout dev page wins, game files never fall back', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-'));
  const install = path.join(base, 'install'); const checkout = path.join(base, 'checkout');
  write(path.join(install, 'public', 'dev', 'demo.html'), 'install-demo');
  write(path.join(install, 'public', 'dev', 'demo', 'demo.js'), 'install-demo-js');
  write(path.join(install, 'public', 'dev', 'both.html'), 'install-both');
  write(path.join(install, 'public', 'js', 'app.js'), 'install-app');
  write(path.join(checkout, 'public', 'dev', 'both.html'), 'checkout-both');
  write(path.join(checkout, 'public', 'index.html'), 'checkout-page');
  write(path.join(checkout, 'data', 'config.json'), '{}');
  const srv = await serve({ publicDir: path.join(checkout, 'public'), dataDir: path.join(checkout, 'data'), installDir: install });
  try {
    assert.equal((await get(srv, '/dev/demo.html')).body, 'install-demo');
    assert.equal((await get(srv, '/dev/demo/demo.js')).body, 'install-demo-js');
    assert.equal((await get(srv, '/dev/both.html')).body, 'checkout-both');
    // only dev pages: the install's game files never stand in for the checkout's
    assert.equal((await get(srv, '/js/app.js')).status, 404);
    assert.equal((await get(srv, '/dev/missing.html')).status, 404);
  } finally {
    srv.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('without installDir a checkout lacking assets answers 404 as before', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-noinstall-'));
  write(path.join(base, 'public', 'index.html'), 'page');
  write(path.join(base, 'data', 'config.json'), '{}');
  const srv = await serve({ publicDir: path.join(base, 'public'), dataDir: path.join(base, 'data') });
  try {
    assert.equal((await get(srv, '/assets/bond/a.png')).status, 404);
    assert.deepEqual(JSON.parse((await get(srv, '/data/local-assets.json')).body).groups, {});
  } finally {
    srv.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});


const ARCHIVE_SHIMS = ['server/data.js', 'server/modes/independent/catalog.js'];
const ARCHIVE_REVISION = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
function archiveFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-engine-archives-'));
  const publicDir = path.join(base, 'checkout', 'public'), dataDir = path.join(base, 'checkout', 'data');
  write(path.join(publicDir, 'index.html'), 'micro-checkout'); write(path.join(dataDir, 'config.json'), '{}');
  const files = {}, bodies = {};
  for (const [index, name] of ARCHIVE_SHIMS.entries()) {
    const body = Buffer.from('// Generated by tools/build-client-engine.mjs from this checkout fixture.\nexport const marker = ' + index + ';\n');
    const target = path.join(base, 'archives', name.replaceAll('/', '-') + '.gz');
    write(target, gzipSync(body)); files[name] = target; bodies[name] = body;
  }
  return { base, publicDir, dataDir, files, bodies, independentEngineArchives: { revision: ARCHIVE_REVISION, files } };
}
async function rawArchiveRequest(srv, url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers, agent: false }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end();
  });
}
async function closeArchiveFixture(f, srv = null) {
  if (srv) await new Promise((resolve, reject) => srv.close(error => error ? reject(error) : resolve()));
  assert.equal(path.dirname(path.resolve(f.base)), path.resolve(os.tmpdir()));
  assert.match(path.basename(f.base), /^sp-engine-archives-/);
  const inspect = target => { const info = fs.lstatSync(target); assert(!info.isSymbolicLink(), 'the newly created fixture tree must contain no links'); if (info.isDirectory()) for (const name of fs.readdirSync(target)) inspect(path.join(target, name)); };
  inspect(f.base); fs.rmSync(f.base, { recursive: true });
  if (process.env.SP_ARCHIVE_HTTP_AUDIT_LOG) fs.appendFileSync(process.env.SP_ARCHIVE_HTTP_AUDIT_LOG, JSON.stringify({ phase: 'archive-http-micro-fixture-cleanup', base: f.base, archives: Object.values(f.files), role: 'self-created tiny test fixture only', removed: !fs.existsSync(f.base) }) + '\n');
}
test('independent engine archive fallback serves byte-identical identity and gzip GET with correct HEAD and ETag 304', { timeout: 30000 }, async () => {
  const f = archiveFixture(), srv = await serve(f);
  try {
    for (const name of ARCHIVE_SHIMS) {
      const url = '/js/independent/engine/' + name, expected = f.bodies[name];
      const plain = await rawArchiveRequest(srv, url, { headers: { 'Accept-Encoding': 'identity' } });
      assert.equal(plain.status, 200); assert(plain.body.equals(expected)); assert.match(plain.headers['content-type'], /javascript/);
      assert.equal(plain.headers['content-encoding'], undefined); assert.equal(Number(plain.headers['content-length']), expected.length);
      assert(plain.headers.etag.includes(ARCHIVE_REVISION), 'native Git version identifies the archive response');
      const gzip = await rawArchiveRequest(srv, url, { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(gzip.status, 200); assert.equal(gzip.headers['content-encoding'], 'gzip');
      assert(gunzipSync(gzip.body).equals(plain.body), 'both representations decode to exactly the same JavaScript bytes');
      assert.equal(Number(gzip.headers['content-length']), gzip.body.length); assert.equal(gzip.headers.etag, plain.headers.etag);
      for (const encoding of ['identity', 'gzip']) {
        const head = await rawArchiveRequest(srv, url, { method: 'HEAD', headers: { 'Accept-Encoding': encoding } });
        assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(Number(head.headers['content-length']), encoding === 'gzip' ? gzip.body.length : plain.body.length);
        assert.equal(head.headers['content-encoding'], encoding === 'gzip' ? 'gzip' : undefined); assert.equal(head.headers.etag, plain.headers.etag);
        const fresh = await rawArchiveRequest(srv, url, { headers: { 'Accept-Encoding': encoding, 'If-None-Match': plain.headers.etag } });
        assert.equal(fresh.status, 304); assert.equal(fresh.body.length, 0);
      }
    }
  } finally { await closeArchiveFixture(f, srv); }
});
test('independent engine archive fallback never exposes adjacent server paths or archive filenames', { timeout: 30000 }, async () => {
  const f = archiveFixture(), srv = await serve(f);
  try {
    for (const url of ['/js/independent/engine/server/private.js', '/js/independent/engine/server/data.js.gz', '/js/independent/engine/server/modes/independent/private.js', '/js/independent/engine/server/modes/independent/catalog.js.gz', '/server/data.js']) {
      const res = await rawArchiveRequest(srv, url); assert.equal(res.status, 404, url); assert(!ARCHIVE_SHIMS.some(name => res.body.equals(f.bodies[name])));
    }
  } finally { await closeArchiveFixture(f, srv); }
});
test('independent engine checkout expanded JavaScript wins over an otherwise valid archive fallback', { timeout: 30000 }, async () => {
  const f = archiveFixture(), own = Buffer.from('// checkout-owned file\nexport const own = true;\n');
  for (const name of ARCHIVE_SHIMS) write(path.join(f.publicDir, 'js', 'independent', 'engine', name), own);
  const srv = await serve(f);
  try { for (const name of ARCHIVE_SHIMS) { const res = await rawArchiveRequest(srv, '/js/independent/engine/' + name, { headers: { 'Accept-Encoding': 'identity' } }); assert.equal(res.status, 200); assert(res.body.equals(own)); assert(!res.body.equals(f.bodies[name])); } }
  finally { await closeArchiveFixture(f, srv); }
});
test('independent engine archive options reject extra keys missing keys relative paths and non-native revisions', { timeout: 30000 }, async () => {
  const f = archiveFixture();
  try {
    const options = archives => ({ ...f, independentEngineArchives: archives, sharedDir: path.join(ROOT, 'shared') });
    assert.throws(() => createStaticHandler(options({ revision: ARCHIVE_REVISION, files: { ...f.files, 'server/private.js': f.files[ARCHIVE_SHIMS[0]] } })), /both generated shims|archives/);
    assert.throws(() => createStaticHandler(options({ revision: ARCHIVE_REVISION, files: { [ARCHIVE_SHIMS[0]]: f.files[ARCHIVE_SHIMS[0]] } })), /both generated shims|archives/);
    assert.throws(() => createStaticHandler(options({ revision: ARCHIVE_REVISION, files: { ...f.files, [ARCHIVE_SHIMS[0]]: 'relative.gz' } })), /absolute gzip/);
    assert.throws(() => createStaticHandler(options({ revision: 'not-a-native-Git-revision', files: f.files })), /native Git revision/);
  } finally { await closeArchiveFixture(f); }
});
test('independent engine archives reject corrupt gzip or decoded JavaScript without the native generated first-line header', { timeout: 30000 }, async () => {
  const f = archiveFixture();
  try {
    const options = () => ({ ...f, sharedDir: path.join(ROOT, 'shared') });
    write(f.files[ARCHIVE_SHIMS[0]], Buffer.from('not-gzip')); assert.throws(() => createStaticHandler(options()));
    write(f.files[ARCHIVE_SHIMS[0]], gzipSync(Buffer.from('// ordinary server source\nexport const secret = true;\n'))); assert.throws(() => createStaticHandler(options()), /not a generated shim/);
    write(f.files[ARCHIVE_SHIMS[0]], gzipSync(Buffer.from('\n// Generated by tools/build-client-engine.mjs\nexport const wrongFirstLine = true;\n'))); assert.throws(() => createStaticHandler(options()), /not a generated shim/);
  } finally { await closeArchiveFixture(f); }
});
