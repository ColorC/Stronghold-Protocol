// The official battle effects' file list (data/local-fx.json, DESIGN §33.1): the static server answers the install's
// copy first, falls back to the checkout's, and answers an empty { groups: {} } manifest when neither has one (like
// data/local-assets.json), so a client without effects logs no 404. /data/local-assets.json keeps its old behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../server/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function serve({ publicDir = path.join(ROOT, 'public'), dataDir, installDir = null } = {}) {
  const handler = createStaticHandler({ publicDir, dataDir, sharedDir: path.join(ROOT, 'shared'), installDir });
  const srv = http.createServer((req, res) => {
    const [p, q] = req.url.split('?');
    handler(req, res, p, q || '');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

function get(srv, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const FX = { version: 1, groups: { 'fx/prefabs': { atk: { path: '/assets/local/fx/atk.prefab.json' } } } };

test('installDir data/local-fx.json wins over a stale checkout list and is served as-is', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-fx-install-'));
  const install = path.join(base, 'install'); const checkout = path.join(base, 'checkout');
  try {
    fs.mkdirSync(path.join(install, 'data'), { recursive: true });
    fs.mkdirSync(path.join(checkout, 'data'), { recursive: true });
    fs.writeFileSync(path.join(install, 'data', 'local-fx.json'), JSON.stringify(FX));
    fs.writeFileSync(path.join(checkout, 'data', 'local-fx.json'), JSON.stringify({ version: 1, groups: { 'fx/prefabs': { stale: {} } } }));
    const srv = await serve({ dataDir: path.join(checkout, 'data'), installDir: install });
    try {
      const r = await get(srv, '/data/local-fx.json');
      assert.equal(r.status, 200);
      assert.match(r.type, /application\/json/);
      assert.deepEqual(JSON.parse(r.body), FX);
    } finally { srv.close(); }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a missing data/local-fx.json answers 200 with an empty groups object (no 404), like local-assets', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-no-fx-'));
  const checkout = path.join(base, 'checkout');
  try {
    fs.mkdirSync(path.join(checkout, 'data'), { recursive: true });
    fs.writeFileSync(path.join(checkout, 'data', 'config.json'), '{}');
    const srv = await serve({ dataDir: path.join(checkout, 'data') });
    try {
      const r = await get(srv, '/data/local-fx.json');
      assert.equal(r.status, 200);
      assert.match(r.type, /application\/json/);
      assert.deepEqual(JSON.parse(r.body), { version: 1, groups: {} });
      const head = await get(srv, '/data/local-fx.json', 'HEAD');
      assert.equal(head.status, 200);
      assert.equal(head.body, '');
      // a checkout's own list is served when there is no install copy (and no empty stand-in)
      fs.writeFileSync(path.join(checkout, 'data', 'local-fx.json'), JSON.stringify(FX));
      assert.deepEqual(JSON.parse((await get(srv, '/data/local-fx.json')).body), FX);
      // other missing data files still 404
      assert.equal((await get(srv, '/data/nope.json')).status, 404);
      assert.equal((await get(srv, '/data/sub/local-fx.json')).status, 404);
    } finally { srv.close(); }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('/data/local-assets.json keeps its behaviour: present file served, absent one gets the empty art manifest', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-art-unchanged-'));
  const checkout = path.join(base, 'checkout');
  try {
    fs.mkdirSync(path.join(checkout, 'data'), { recursive: true });
    const srv = await serve({ dataDir: path.join(checkout, 'data') });
    try {
      const empty = await get(srv, '/data/local-assets.json');
      assert.equal(empty.status, 200);
      assert.deepEqual(JSON.parse(empty.body), { version: 1, source: 'none', count: 0, groups: {} });
      const art = { version: 1, source: 'local-client', count: 1, groups: { module: { 'mar-x': { path: '/assets/local/module/mar-x.png' } } } };
      fs.writeFileSync(path.join(checkout, 'data', 'local-assets.json'), JSON.stringify(art));
      assert.deepEqual(JSON.parse((await get(srv, '/data/local-assets.json')).body), art);
    } finally { srv.close(); }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
