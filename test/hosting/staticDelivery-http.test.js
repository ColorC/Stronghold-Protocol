import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const base = 'https://static.example/0123456789abcdef0123456789abcdef01234567';
const direct = 'https://cdn.jsdelivr.net/gh/example-org/assets@0123456789abcdef0123456789abcdef01234567/sprites/operator.png';

test('HTTP exact asset source, media fallback, worker bootstrap, admission UI, and API keep their routes', async () => {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'stronghold-static-routing-'));
  const designPath = path.join(fixtureDir, 'independent-design.json');
  const sourceMapPath = path.join(fixtureDir, 'asset-sources.json');
  const localModulePaths = ['js/hostingBootstrap.js', 'js/hostingWait.js', 'js/ui/fieldHost.js', 'js/ui/fallbackField.js', 'js/render/app.js', 'js/render/board3d/scene.js'];
  const previousDesignPath = process.env.SP_INDEPENDENT_DESIGN_PATH;
  const previousSourceMapPath = process.env.SP_ASSET_SOURCE_MAP;
  await writeFile(designPath, '{}');
  await writeFile(path.join(fixtureDir, 'resonance-references.zip'), 'test archive payload');
  for (const relative of localModulePaths) {
    const target = path.join(fixtureDir, ...relative.split('/'));
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(target), { recursive: true }));
    await writeFile(target, `// ${relative}\n`);
  }
  await writeFile(sourceMapPath, JSON.stringify({ version: 1, applicationRevision: 'a'.repeat(40),
    assets: { '/assets/sprites/operator.png': direct } }));
  process.env.SP_INDEPENDENT_DESIGN_PATH = designPath;
  process.env.SP_ASSET_SOURCE_MAP = sourceMapPath;
  let server;
  try {
    const { startServer } = await import('../../server/index.js');
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, staticBase: base,
      publicDir: fixtureDir, independentDirectory: path.join(fixtureDir, 'sessions'),
      independentMaxActive: 1, independentMaxWaiting: 1,
      independentExecution: 'client' });
    const asset = await fetch(new URL('/assets/sprites/operator.png', server.url), { redirect: 'manual' });
    assert.equal(asset.status, 307);
    assert.equal(asset.headers.get('location'), direct);
    assert.equal(await asset.text(), '');
    const unmapped = await fetch(new URL('/assets/sprites/other.png', server.url), { redirect: 'manual' });
    assert.equal(unmapped.status, 307);
    assert.equal(unmapped.headers.get('location'), `${base}/assets/sprites/other.png`);
    assert.equal(await unmapped.text(), '');
    const head = await fetch(new URL('/assets/sprites/operator.png', server.url), { method: 'HEAD', redirect: 'manual' });
    assert.equal(head.status, 307);
    assert.equal(head.headers.get('location'), direct);
    assert.equal(await head.text(), '');

    const media = await fetch(new URL('/media/bgm/act1', server.url), { redirect: 'manual' });
    assert.equal(media.status, 307);
    assert.equal(media.headers.get('location'), `${base}/media/bgm/act1`);
    assert.equal(await media.text(), '');
    const worker = await fetch(new URL('/js/independent/client-worker.js', server.url), { redirect: 'manual' });
    assert.equal(worker.status, 200);
    assert.equal(await worker.text(), `import "${base}/js/independent/client-worker.js";\n`);
    for (const pathname of localModulePaths.map((relative) => `/${relative}`)) {
      const localModule = await fetch(new URL(pathname, server.url), { redirect: 'manual' });
      assert.equal(localModule.status, 200, `${pathname} should be served by the active release`);
      assert.equal(localModule.headers.has('location'), false);
    }
    const references = await fetch(new URL('/resonance-references.zip', server.url), { redirect: 'manual' });
    assert.equal(references.status, 200);
    assert.equal(references.headers.has('location'), false);
    assert.equal(await references.text(), 'test archive payload');

    const active = await fetch(new URL('/independent.html?execution=client', server.url));
    assert.equal(active.status, 404); // isolated fixture intentionally has no public page files
    const queued = await fetch(new URL('/independent.html?execution=client', server.url));
    assert.equal(queued.status, 200);
    assert.match(await queued.text(), /hostingWait\.js/);
    const api = await fetch(new URL('/independent/api/catalog', server.url));
    assert.equal(api.status, 403); // admission guards API before static delivery
    const health = await fetch(new URL('/healthz', server.url));
    assert.equal(health.status, 200);
    await server.close(); server = null;

    delete process.env.SP_ASSET_SOURCE_MAP;
    const legacy = await startServer({ port: 0, host: '127.0.0.1', quiet: true, staticBase: '',
      publicDir: fixtureDir, independentDirectory: path.join(fixtureDir, 'sessions') });
    try {
      const local = await fetch(new URL('/assets/sprites/operator.png', legacy.url), { redirect: 'manual' });
      assert.equal(local.status, 404);
      assert.equal(local.headers.has('location'), false);
      assert.equal((await fetch(new URL('/healthz', legacy.url))).status, 200);
    } finally { await legacy.close(); }
  } finally {
    if (server) await server.close();
    if (previousDesignPath === undefined) delete process.env.SP_INDEPENDENT_DESIGN_PATH;
    else process.env.SP_INDEPENDENT_DESIGN_PATH = previousDesignPath;
    if (previousSourceMapPath === undefined) delete process.env.SP_ASSET_SOURCE_MAP;
    else process.env.SP_ASSET_SOURCE_MAP = previousSourceMapPath;
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
