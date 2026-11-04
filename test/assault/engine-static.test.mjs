import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../../server/http/static.js';
import { createRequestHandler } from '../../server/http/routes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUN_ROOT = path.resolve(ROOT, '../../..');
const prefix = '/stronghold/assault/';

function request(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
    req.end();
  });
}

test('isolated Assault engine mounts serve only browser ESM and preserve nested-prefix imports', async (t) => {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'data/assault-assets.json'), 'utf8'));
  const serveStatic = createStaticHandler({ publicDir: path.join(ROOT, 'public'), dataDir: path.join(ROOT, 'data'),
    sharedDir: path.join(ROOT, 'shared'), simDir: path.join(ROOT, 'server/sim'), packsDir: path.join(ROOT, 'packs'),
    installDir: RUN_ROOT, assaultAssetsDir: manifest.mappings['/assault-assets/'] });
  const handler = createRequestHandler({ serveStatic, assaultHttp: async () => false,
    health: { startedAt: Date.now(), network: { connectionCount: 0 }, registry: { size: 0 }, lobby: { stats: () => ({}) } },
    log: { info() {}, warn() {}, error() {}, debug() {} } });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith(prefix)) req.url = `/${url.pathname.slice(prefix.length)}${url.search}`;
    handler(req, res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const get = (pathName) => request(port, pathName);
  const nested = (pathName) => `${prefix}${pathName.replace(/^\//, '')}`;

  for (const pathName of [
    '/assault-engine/server/sim/Battle.js', '/assault-engine/server/sim/simdata.js',
    '/assault-engine/server/sim/spec.js', '/assault-engine/server/sim/content/assault/cards/registry.js',
    '/assault-engine/server/sim/content/assault/relics.js', '/assault-engine/shared/assault/battle-input.js',
    '/assault-engine/server/data.js',
  ]) {
    const direct = await get(pathName);
    assert.equal(direct.status, 200, `direct ${pathName}`);
    const prefixed = await get(nested(pathName));
    assert.equal(prefixed.status, 200, `nested ${pathName}`);
  }

  const shim = await get('/assault-engine/server/data.js');
  assert.equal(shim.body, (await get('/data.js')).body, 'virtual and legacy aliases serve the same browser data shim');
  assert.match(shim.body, /import \{ getSimData \} from '\.\/sim\/simdata\.js'/);
  const simdata = await get('/assault-engine/server/sim/simdata.js');
  assert.match(simdata.body, /if \(IS_NODE\)/);
  assert.match(simdata.body, /import\('\.\/nodeData\.js'\)/);
  for (const pathName of ['/assault-engine/server/sim/nodeData.js', '/assault-engine/server/index.js',
    '/sim/nodeData.js', '/server/index.js']) {
    assert.equal((await get(pathName)).status, 404, `private route ${pathName}`);
  }
  for (const pathName of ['/sim/Battle.js', '/shared/constants.js', '/data.js']) {
    assert.equal((await get(pathName)).status, 200, `legacy static route ${pathName}`);
  }
  assert.notEqual((await get('/assault-engine/server/sim/%2e%2e/%2e%2e/data.js')).status, 200,
    'encoded traversal must not reach data files');
  assert.equal((await request(port, '/assault-engine/server/sim/Battle.js', 'POST')).status, 405,
    'virtual engine mount is read-only');

  const disabled = http.createServer(createRequestHandler({ serveStatic,
    health: { startedAt: Date.now(), network: { connectionCount: 0 }, registry: { size: 0 }, lobby: { stats: () => ({}) } },
    log: { info() {}, warn() {}, error() {}, debug() {} } }));
  await new Promise((resolve, reject) => { disabled.once('error', reject); disabled.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => disabled.close(resolve)));
  assert.equal((await request(disabled.address().port, '/assault-engine/server/sim/Battle.js')).status, 404,
    'namespace is unavailable when Assault HTTP is disabled');
});
