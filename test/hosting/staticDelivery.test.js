import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL } from 'node:url';
import { createStaticDelivery, loadAssetSourceMap } from '../../server/hosting/staticDelivery.js';
const base = 'https://external.example/d31592f27b1567267ff35ac95932f08c8ae74d9d';
const res = () => ({ writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } });
const req = { method: 'GET' };

test('static traffic goes straight to fixed external revision, with no origin body', () => {
  const handler = createStaticDelivery({ base });
  for (const path of ['/assets/spine/x.atlas', '/fonts/fonts.css', '/js/independent/engine/server/data.js', '/data/config.json', '/sim/Battle.js', '/shared/media.js', '/media/bgm/act1', '/data.js']) {
    const response = res(); assert.equal(handler(req, response, path), true); assert.equal(response.status, 307);
    assert.equal(response.headers.Location, base + path); assert.equal(response.headers['Content-Length'], 0); assert.equal(response.body, undefined);
  }
});
test('worker bootstraps same-origin, API and entry stay local', () => {
  const handler = createStaticDelivery({ base });
  const response = res(); handler(req, response, '/js/independent/client-worker.js'); assert.equal(response.status, 200);
  assert.equal(response.body, `import "${base}/js/independent/client-worker.js";\n`);
  for (const path of ['/independent.html', '/independent/api/sessions', '/healthz', '/js/hostingBootstrap.js', '/js/hostingWait.js', '/resonance-references.zip']) assert.equal(handler(req, res(), path), false);
  for (const path of ['/resonance.html', '/resonance/api/catalog', '/js/resonance/main.js', '/css/resonance.css',
    '/js/ui/fieldHost.js', '/js/ui/fallbackField.js', '/js/render/app.js', '/js/render/interp.js',
    '/js/render/resonanceFloors.js', '/js/render/board3d/scene.js']) {
    assert.equal(handler(req, res(), path), false, 'resonance host, fallback, and renderer modules must resolve from the active release');
  }
  for (const path of ['/js/ui/settings.js', '/js/independent/game.js']) {
    const response = res(); assert.equal(handler(req, response, path), true); assert.equal(response.status, 307);
    assert.equal(response.headers.Location, base + path, 'unrelated workshop/UI modules keep their existing CDN route');
  }
  assert.equal(handler({ method: 'POST' }, res(), '/assets/x.png'), false);
  assert.equal(createStaticDelivery()(req, res(), '/assets/x.png'), false);
});

test('resonance entry resources stay relative at root and under the stronghold namespace', () => {
  const html = readFileSync(new URL('../../public/resonance.html', import.meta.url), 'utf8');
  const stylesheetHrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
  const importMap = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]);
  const bootstrap = html.match(/<script type="module" src="([^"]+)"/)[1];
  assert.equal(stylesheetHrefs.length, 5);
  for (const href of [...stylesheetHrefs, ...Object.values(importMap.imports), bootstrap]) assert.ok(href.startsWith('./'), href);
  for (const entry of ['https://host.example/resonance.html', 'https://host.example/stronghold/resonance.html']) {
    const root = new URL(entry);
    assert.equal(new URL(bootstrap, root).origin, root.origin);
    assert.equal(new URL(bootstrap, root).pathname, `${root.pathname.slice(0, root.pathname.lastIndexOf('/') + 1)}js/hostingBootstrap.js`);
    for (const href of stylesheetHrefs) assert.equal(new URL(href, root).origin, root.origin);
    for (const href of Object.values(importMap.imports)) assert.equal(new URL(href, root).origin, root.origin);
  }
  const source = readFileSync(new URL('../../public/js/hostingBootstrap.js', import.meta.url), 'utf8');
  assert.match(source, /import\('\.\/hostingWait\.js'\)/);
});

test('waiting POST follows the resonance entry at root and under stronghold while preserving independent routes', async () => {
  const source = readFileSync(new URL('../../public/js/hostingWait.js', import.meta.url), 'utf8')
    .replace(/^export function /gm, 'function ')
    + '\nglobalThis.__startHostingWait = startHostingWait;';
  async function postFor(href) {
    const requests = [];
    const status = { textContent: '' };
    const buttons = { '#copy-link': { addEventListener() {} }, '#cancel-wait': { addEventListener() {} }, '#queue-status': status };
    let main;
    const app = { replaceChildren(node) { main = node; } };
    const location = { href, pathname: new URL(href).pathname, replace() {}, reload() {} };
    const context = {
      URL, AbortController, Date, Math, setTimeout, clearTimeout, setImmediate,
      location, navigator: { onLine: true }, window: { addEventListener() {} },
      document: { hidden: false, querySelector(selector) {
        if (selector === '#app') return app;
        if (selector === '#hosting-wait') return main?.id === 'hosting-wait' ? main : null;
        if (selector === '#queue-status') return status;
        return null;
      }, createElement(tag) {
        if (tag !== 'main') return {};
        return main = { dataset: {}, style: {}, setAttribute() {}, querySelector(selector) { return buttons[selector] ?? null; }, append() {} };
      }, addEventListener() {} },
      fetch: async (url, options) => {
        requests.push({ url: String(url), options });
        return { status: 410, ok: false, async json() { return { error: { message: 'ended' } }; } };
      },
    };
    runInNewContext(source, context);
    context.__startHostingWait();
    await new Promise(resolve => setImmediate(resolve));
    return { request: requests[0], html: main.innerHTML };
  }

  for (const [href, expected] of [
    ['https://host.example/resonance.html', '/resonance/api/admission?wait=1'],
    ['https://host.example/stronghold/resonance.html', '/stronghold/resonance/api/admission?wait=1'],
    ['https://host.example/independent.html', '/independent/api/admission?wait=1'],
    ['https://host.example/stronghold/independent.html', '/stronghold/independent/api/admission?wait=1'],
  ]) {
    const { request, html } = await postFor(href);
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(new URL(request.url).pathname + new URL(request.url).search, expected);
    assert.match(html, href.includes('resonance.html') ? /共鸣正在为你留位/ : /工坊正在为你留位/);
  }
});
test('deployment URLs and unsafe paths cannot escape the version directory', () => {
  for (const wrong of ['http://external.example/' + 'a'.repeat(40), 'https://external.example/latest', base + '?x=1', base + '#x', base.replace('external.example', 'user:pass@external.example')]) assert.throws(() => createStaticDelivery({ base: wrong }));
  const handler = createStaticDelivery({ base });
  for (const path of ['/assets/%2e%2e/private', '/assets/.env', '/assets/%5cprivate', '/assets/%00x', '/assets/%broken']) {
    const response = res(); assert.equal(handler(req, response, path), true); assert.equal(response.status, 400);
  }
});

const directAsset = 'https://raw.githubusercontent.com/example-org/game-assets/0123456789abcdef0123456789abcdef01234567/sprites/operator.png';
test('exact verified asset paths redirect directly to their pinned source without a body', () => {
  const handler = createStaticDelivery({ base, assetSources: { '/assets/sprites/operator.png': directAsset } });
  for (const method of ['GET', 'HEAD']) {
    const response = res();
    assert.equal(handler({ method }, response, '/assets/sprites/operator.png'), true);
    assert.equal(response.status, 307);
    assert.equal(response.headers.Location, directAsset);
    assert.equal(response.headers['Content-Length'], 0);
    assert.equal(response.body, undefined);
  }
});

test('asset source paths and providers are strictly restricted', () => {
  for (const assetSources of [
    { '/media/audio/act1': directAsset },
    { '/assets/../private': directAsset },
    { '/assets/.env': directAsset },
    { '/assets/x': 'http://raw.githubusercontent.com/example-org/repo/0123456789abcdef0123456789abcdef01234567/x.png' },
    { '/assets/x': directAsset + '?download=1' },
    { '/assets/x': directAsset + '#fragment' },
    { '/assets/x': directAsset.replace('raw.githubusercontent.com', 'user@raw.githubusercontent.com') },
    { '/assets/x': directAsset.replace('0123456789abcdef0123456789abcdef01234567', 'main') },
    { '/assets/x': directAsset.replace('/sprites/operator.png', '/sprites/%252e%252e/private.png') },
    { '/assets/x': directAsset.replace('/example-org/game-assets/', '/example-org/../') },
    { '/assets/x': directAsset.replace('/sprites/operator.png', '/../private.png') },
    { '/assets/x': directAsset.replace('raw.githubusercontent.com', 'example.com') },
  ]) assert.throws(() => createStaticDelivery({ base, assetSources }));
  assert.throws(() => createStaticDelivery({ assetSources: { '/assets/x': directAsset } }), /SP_STATIC_BASE/);
});

test('source map is an absolute, versioned JSON file and rejects malformed configuration', async () => {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const root = await mkdtemp(path.join(tmpdir(), 'stronghold-static-map-'));
  const file = path.join(root, 'asset-sources.json');
  try {
    await writeFile(file, JSON.stringify({ version: 1, applicationRevision: 'a'.repeat(40), assets: { '/assets/sprites/operator.png': directAsset } }));
    assert.deepEqual(loadAssetSourceMap(file), { '/assets/sprites/operator.png': directAsset });
    assert.throws(() => loadAssetSourceMap('relative-map.json'), /absolute/);
    await writeFile(file, JSON.stringify({ version: 1, applicationRevision: 'a'.repeat(40), assets: {}, extra: true }));
    assert.throws(() => loadAssetSourceMap(file), /schema/);
    await writeFile(file, JSON.stringify({ version: 1, applicationRevision: 'main', assets: {} }));
    assert.throws(() => loadAssetSourceMap(file), /schema/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
