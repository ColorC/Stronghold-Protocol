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
  write(path.join(install, 'public', 'vendor', 'rrweb.umd.js'), 'install-recording');
  write(path.join(install, 'public', 'vendor', 'pixi.min.js'), 'install-rendering');
  // Node-only UI tests may cache just a few vendor modules in a sparse checkout.
  write(path.join(checkout, 'public', 'vendor', 'htm.module.js'), 'checkout-test-cache');
  write(path.join(checkout, 'public', 'vendor', 'lib.js'), 'checkout-test-cache-vendor');
  write(path.join(install, 'public', 'fonts', 'fonts.css'), 'install-fonts');
  write(path.join(install, 'public', 'index.html'), 'install-page');
  write(path.join(install, 'data', 'local-assets.json'), '{"version":1,"groups":{"x":{}}}');
  write(path.join(checkout, 'public', 'index.html'), 'checkout-page');
  write(path.join(checkout, 'public', 'fonts', 'fonts.css'), 'checkout-fonts');
  write(path.join(checkout, 'data', 'config.json'), '{}');
  const srv = await serve({ publicDir: path.join(checkout, 'public'), dataDir: path.join(checkout, 'data'), installDir: install });
  try {
    assert.equal((await get(srv, '/assets/bond/a.png')).body, 'install-art');
    assert.equal((await get(srv, '/vendor/lib.js')).body, 'install-vendor');
    assert.equal((await get(srv, '/vendor/rrweb.umd.js')).body, 'install-recording');
    assert.equal((await get(srv, '/vendor/pixi.min.js')).body, 'install-rendering');
    assert.equal((await get(srv, '/vendor/htm.module.js')).status, 404, 'Node test cache is not a public install');
    // the checkout's own folder wins over the install's
    assert.equal((await get(srv, '/fonts/fonts.css')).body, 'checkout-fonts');
    assert.equal((await get(srv, '/index.html')).body, 'checkout-page');
    assert.deepEqual(JSON.parse((await get(srv, '/data/local-assets.json')).body).groups, { x: {} });
    assert.notEqual((await get(srv, '/assets/../index.html')).body, 'install-page');
  } finally {
    srv.close();
    fs.rmSync(base, { recursive: true, force: true });
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
