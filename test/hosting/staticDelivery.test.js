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
  for (const path of ['/resonance/api/catalog', '/js/resonance/main.js', '/css/resonance.css',
    '/css/resonance-entry.css', '/css/resonance-detail.css', '/css/resonance-codex.css', '/css/resonance-panels.css',
    '/js/ui/fieldHost.js', '/js/ui/fallbackField.js', '/js/render/app.js', '/js/render/interp.js',
    '/js/ui/hud.js', '/js/ui/shopBar.js', '/js/ui/bondStrip.js', '/js/screens/title.js',
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

test('external resonance entry pins every Preact importer to one release and keeps HEAD metadata exact', () => {
  const sourceHtml = readFileSync(new URL('../../public/resonance.html', import.meta.url), 'utf8');
  const handler = createStaticDelivery({ base });
  const get = res();
  assert.equal(handler({ method: 'GET' }, get, '/resonance.html'), true);
  assert.equal(get.status, 200);
  assert.equal(get.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(get.headers['Cache-Control'], 'no-cache');
  assert.equal(get.headers['Content-Length'], Buffer.byteLength(get.body));

  const renderedHtml = get.body.toString('utf8');
  const importMap = JSON.parse(renderedHtml.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  const map = importMap.imports;
  const pinnedPreact = `${base}/vendor/preact.module.js`;
  const pinnedHooks = `${base}/vendor/hooks.module.js`;
  const pinnedHtm = `${base}/vendor/htm.module.js`;
  const pinnedGameData = `${base}/js/data.js`;
  assert.equal(map['./js/data.js'], pinnedGameData);
  assert.equal(map['./vendor/preact.module.js'], pinnedPreact);
  assert.equal(map['./vendor/hooks.module.js'], pinnedHooks);
  assert.equal(map['./vendor/htm.module.js'], pinnedHtm);
  assert.equal(map.preact, pinnedPreact);
  assert.equal(map['preact/hooks'], pinnedHooks);
  assert.equal(map.htm, pinnedHtm);
  assert.equal(map['/Stronghold-Protocol/4ed1ad32ec10da15c23f9d7939dade603950759b/vendor/preact.module.js'], pinnedPreact);
  const resolveImport = runInNewContext(`(imports, scopes, specifier, referrer, documentUrl) => {
    const normalized = Object.entries(imports).map(([key, value]) => [
      key.startsWith('.') || key.startsWith('/') ? new URL(key, documentUrl).href : key,
      new URL(value, documentUrl).href,
    ]);
    const resolvedSpecifier = specifier.startsWith('.') || specifier.startsWith('/')
      ? new URL(specifier, referrer).href : specifier;
    const scope = Object.entries(scopes).map(([key, value]) => [new URL(key, documentUrl).href, value])
      .filter(([key]) => referrer.startsWith(key)).sort(([a], [b]) => b.length - a.length)[0]?.[1] ?? {};
    const scoped = Object.entries(scope).map(([key, value]) => [
      key.startsWith('.') || key.startsWith('/') ? new URL(key, documentUrl).href : key,
      new URL(value, documentUrl).href,
    ]);
    return scoped.find(([key]) => key === resolvedSpecifier)?.[1]
      ?? normalized.find(([key]) => key === resolvedSpecifier)?.[1] ?? null;
  }`, { URL });

  for (const href of ['https://host.example/resonance.html', 'https://host.example/stronghold/resonance.html']) {
    const entry = new URL(href);
    const gameModule = new URL('./js/resonance/game.js', entry);
    const localFieldHost = new URL('./js/ui/fieldHost.js', entry);
    const cdnGameComponents = new URL(`${base}/js/ui/gameComponents.js`);
    const localGameData = new URL('../data.js', gameModule);
    const localRendererData = new URL('../data.js', localFieldHost);
    const pinnedComponentData = new URL('../data.js', cdnGameComponents);
    assert.equal(resolveImport(map, importMap.scopes, '../data.js', gameModule.href, entry.href), pinnedGameData);
    assert.equal(resolveImport(map, importMap.scopes, '../data.js', localFieldHost.href, entry.href), pinnedGameData);
    assert.equal(pinnedComponentData.href, pinnedGameData);
    assert.equal(new URL(map['./js/data.js'], entry).href, pinnedGameData);
    assert.equal(localGameData.pathname, entry.pathname.slice(0, entry.pathname.lastIndexOf('/') + 1) + 'js/data.js');
    assert.equal(localRendererData.href, localGameData.href);
    assert.match(readFileSync(new URL('../../public/js/resonance/game.js', import.meta.url), 'utf8'), /from ['"]\.\.\/data\.js['"]/);
    assert.match(readFileSync(new URL('../../public/js/ui/fieldHost.js', import.meta.url), 'utf8'), /from ['"]\.\.\/data\.js['"]/);
    assert.match(readFileSync(new URL('../../public/js/ui/gameComponents.js', import.meta.url), 'utf8'), /from ['"]\.\.\/data\.js['"]/);
    const moduleUrl = new URL('./js/resonance/main.js', entry);
    const relativePreact = new URL('../../vendor/preact.module.js', moduleUrl);
    const importMapPreactKey = new URL('./vendor/preact.module.js', entry);
    assert.equal(relativePreact.pathname, importMapPreactKey.pathname);
    assert.equal(new URL(map['./vendor/preact.module.js'], entry).href, pinnedPreact);
    assert.equal(new URL(map['/Stronghold-Protocol/4ed1ad32ec10da15c23f9d7939dade603950759b/vendor/preact.module.js'], entry).href, pinnedPreact);
    assert.equal(resolveImport(map, importMap.scopes, '../../vendor/preact.module.js', moduleUrl.href, entry.href), pinnedPreact);
    assert.equal(resolveImport(map, importMap.scopes, '/Stronghold-Protocol/4ed1ad32ec10da15c23f9d7939dade603950759b/vendor/preact.module.js', `${base}/vendor/hooks.module.js`, entry.href), pinnedPreact);
    assert.equal(resolveImport(map, importMap.scopes, 'preact', moduleUrl.href, entry.href), pinnedPreact);
    assert.equal(resolveImport(map, importMap.scopes, 'preact/hooks', moduleUrl.href, entry.href), pinnedHooks);
    assert.equal(resolveImport(map, importMap.scopes, 'htm', moduleUrl.href, entry.href), pinnedHtm);
  }

  const head = res();
  assert.equal(handler({ method: 'HEAD' }, head, '/resonance.html'), true);
  assert.equal(head.status, 200);
  assert.equal(head.headers['Content-Length'], get.headers['Content-Length']);
  assert.equal(head.body, undefined);

  const local = createStaticDelivery();
  assert.equal(local({ method: 'GET' }, res(), '/resonance.html'), false);
  assert.match(sourceHtml, /"preact"\s*:\s*"\.\/vendor\/preact\.module\.js"/);
  assert.equal(local({ method: 'GET' }, res(), '/independent.html'), false);
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
