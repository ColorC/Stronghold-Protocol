import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../../server/http/static.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CANONICAL_ROOT = path.resolve(REPO_ROOT, '../../..');
const TEST_TMP = path.resolve(process.env.SP_ASSAULT_TEST_TMP
  || path.join(CANONICAL_ROOT, '.omni', 'tmp', 'assault', 'tests', 'audio-fallback'));

function listen(serveStatic) {
  const server = http.createServer((req, res) => {
    const [rawPath, query = ''] = (req.url || '/').split('?');
    serveStatic(req, res, rawPath, query).catch((error) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function get(port, pathname, range) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: range ? { range } : {} }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.once('error', reject);
    req.end();
  });
}

async function makeFixture(t, assaultOptIn, withInstall = false) {
  await fs.mkdir(TEST_TMP, { recursive: true });
  const root = await fs.mkdtemp(path.join(TEST_TMP, 'case-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const publicDir = path.join(root, 'public');
  const dataDir = path.join(root, 'data');
  const sharedDir = path.join(root, 'shared');
  const assaultAssetsDir = path.join(root, 'assault-assets');
  const canonical = Buffer.from('canonical audio source');
  const install = Buffer.from('install canonical fallback audio');
  const fallback = Buffer.from('assault fallback audio');
  const write = async (base, relative, contents) => {
    const target = path.join(base, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  };
  await write(publicDir, 'assets/audio/bgm/canonical-only.mp3', canonical);
  await write(publicDir, 'assets/audio/bgm/shared.mp3', canonical);
  await write(assaultAssetsDir, 'audio/bgm/fallback-only.mp3', fallback);
  await write(assaultAssetsDir, 'audio/bgm/shared.mp3', fallback);
  const installDir = path.join(root, 'install');
  if (withInstall) {
    await write(publicDir, 'assets/audio/partial/sentinel.txt', 'source audio folder exists');
    await write(installDir, 'public/assets/audio/bgm/install-only.mp3', install);
  }
  const serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, packs: {},
    ...(withInstall ? { installDir } : {}),
    ...(assaultOptIn ? { assaultAssetsDir } : {}) });
  const server = await listen(serveStatic);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, canonical, install, fallback };
}

test('Assault audio fallback is opt-in, canonical-first, and shared by direct and extensionless URLs', async (t) => {
  const { port, canonical, fallback } = await makeFixture(t, true);
  for (const [url, expected] of [
    ['/media/bgm/canonical-only', canonical],
    ['/media/bgm/fallback-only', fallback],
    ['/media/bgm/shared', canonical],
    ['/assets/audio/bgm/canonical-only.mp3', canonical],
    ['/assets/audio/bgm/fallback-only.mp3', fallback],
    ['/assets/audio/bgm/shared.mp3', canonical],
  ]) {
    const response = await get(port, url);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers['content-type'], 'audio/mpeg', url);
    assert.deepEqual(response.body, expected, url);
  }
  for (const url of ['/media/bgm/fallback-only', '/assets/audio/bgm/fallback-only.mp3']) {
    const response = await get(port, url, 'bytes=0-6');
    assert.equal(response.status, 206, url);
    assert.equal(response.headers['content-range'], 'bytes 0-6/' + fallback.length, url);
    assert.deepEqual(response.body, fallback.subarray(0, 7), url);
  }
  for (const url of ['/media/..%2f..%2fsecret.mp3', '/assets/audio/..%2f..%2fsecret.mp3']) {
    const response = await get(port, url);
    assert.equal(response.status, 403, url);
  }
});

test('ordinary static service cannot reach the Assault audio fallback', async (t) => {
  const { port } = await makeFixture(t, false);
  assert.equal((await get(port, '/media/bgm/fallback-only')).status, 404);
  assert.equal((await get(port, '/assets/audio/bgm/fallback-only.mp3')).status, 404);
});

test('audio lookup is source-first then install then Assault fallback for media and direct URLs', async (t) => {
  const { port, canonical, install, fallback } = await makeFixture(t, true, true);
  for (const [url, expected] of [
    ['/media/bgm/install-only', install],
    ['/assets/audio/bgm/install-only.mp3', install],
    ['/media/bgm/shared', canonical],
    ['/assets/audio/bgm/shared.mp3', canonical],
    ['/media/bgm/fallback-only', fallback],
    ['/assets/audio/bgm/fallback-only.mp3', fallback],
  ]) {
    const response = await get(port, url);
    assert.equal(response.status, 200, url);
    assert.deepEqual(response.body, expected, url);
  }
});
