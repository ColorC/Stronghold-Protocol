import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  for (const path of ['/independent.html', '/independent/api/sessions', '/healthz', '/js/hostingBootstrap.js', '/resonance-references.zip']) assert.equal(handler(req, res(), path), false);
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
