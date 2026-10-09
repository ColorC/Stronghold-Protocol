import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataStore, DATA_BASE, defaultDataBase } from '../../public/js/data.js';
import { pageBasePath, pageResourcePath } from '../../public/js/resourceBase.js';
import { mediaUrl } from '../../public/js/media.js';
import { OriginalVfxPlayer } from '../../public/js/render/originalVfx.js';

const withLocation = async (href, fn) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(href) });
  try { return await fn(); }
  finally {
    if (prior) Object.defineProperty(globalThis, 'location', prior);
    else delete globalThis.location;
  }
};

test('browser singleton data base follows root, mounted and versioned CDN module locations', () => {
  assert.equal(DATA_BASE, '/data/', 'Node retains the historical root-relative singleton default');
  assert.equal(defaultDataBase('https://workshop.example/js/data.js'), 'https://workshop.example/data/');
  assert.equal(defaultDataBase('https://game.example/js/data.js'), 'https://game.example/data/');
  assert.equal(defaultDataBase('https://static.example/Stronghold-Protocol/rev/js/data.js'), 'https://static.example/Stronghold-Protocol/rev/data/');
  assert.equal(defaultDataBase('file:///repo/public/js/data.js'), '/data/');
});

test('createDataStore keeps its explicit historical Node default', async () => {
  const calls = [];
  const store = createDataStore({ fetch: async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ ready: true }) };
  } });
  await store.load('config');
  assert.deepEqual(calls, ['/data/config.json']);
});

test('page resource roots support root and mounted pages without touching explicit external URLs', () => {
  assert.equal(pageBasePath('https://game.example/independent.html'), '/');
  assert.equal(pageBasePath('https://game.example/stronghold/independent.html?x=1'), '/stronghold/');
  assert.equal(pageResourcePath('/assets/spine/op/x.atlas', 'https://game.example/independent.html'), '/assets/spine/op/x.atlas');
  assert.equal(pageResourcePath('/fonts/ui.woff2', 'https://game.example/stronghold/independent.html'), '/stronghold/fonts/ui.woff2');
  assert.equal(pageResourcePath('/media/audio/x', 'https://game.example/stronghold/independent.html'), '/stronghold/media/audio/x');
  assert.equal(pageResourcePath('https://cdn.example/assets/x.png', 'https://game.example/stronghold/independent.html'), 'https://cdn.example/assets/x.png');
  assert.equal(pageResourcePath('//cdn.example/assets/x.png', 'https://game.example/stronghold/independent.html'), '//cdn.example/assets/x.png');
});

test('local asset and assets manifests rebase nested paths on load without mutating source JSON', async () => {
  await withLocation('https://game.example/stronghold/independent.html', async () => {
    const assetsRaw = {
      record: { id: 'x', path: '/assets/spine/op/x.atlas', icon: '/assets/icons/x.png' },
      nested: { font: '/fonts/ui.woff2', media: '/media/audio/voice/x', audio: '/assets/audio/voice/unit/line.mp3', external: 'https://cdn.example/assets/x.png' },
    };
    const localRaw = { groups: { 'ui/battle': { field: { path: '/assets/local/field.png' } } } };
    const fetch = async (url) => {
      const name = new URL(url, 'https://game.example').pathname.split('/').at(-1);
      const files = { 'assets.json': assetsRaw, 'local-assets.json': localRaw };
      return { ok: !!files[name], status: files[name] ? 200 : 404, json: async () => files[name] };
    };
    const store = createDataStore({ fetch, base: 'https://static.example/Stronghold-Protocol/rev/data/', timeoutMs: 0 });
    await store.loadAll('assets', 'local');
    const path = '/stronghold/assets/spine/op/x.atlas';
    assert.equal(store.get('assets').record.path, path);
    assert.equal(store.lookup('assets', 'record').path, path);
    assert.equal(store.list('assets').find((item) => item.id === 'x').path, path);
    assert.equal(store.get('assets').nested.font, '/stronghold/fonts/ui.woff2');
    assert.equal(store.get('assets').nested.media, '/stronghold/media/audio/voice/x');
    assert.equal(store.get('assets').nested.audio, '/stronghold/assets/audio/voice/unit/line.mp3');
    assert.equal(mediaUrl(store.get('assets').nested.audio, 'https://game.example'), '/stronghold/media/voice/unit/line');
    assert.equal(store.get('assets').nested.external, 'https://cdn.example/assets/x.png');
    assert.equal(store.get('local').groups['ui/battle'].field.path, '/stronghold/assets/local/field.png');
    assert.equal(assetsRaw.record.path, '/assets/spine/op/x.atlas');
    assert.equal(localRaw.groups['ui/battle'].field.path, '/assets/local/field.png');
  });
});

test('media and original VFX honor the mounted page prefix while preserving cross-origin safety', async () => {
  await withLocation('https://game.example/stronghold/independent.html', async () => {
    assert.equal(mediaUrl('/stronghold/assets/audio/voice/unit/line.mp3', 'https://game.example'), '/stronghold/media/voice/unit/line');
    assert.equal(mediaUrl('/assets/audio/bgm/theme.mp3', 'https://game.example'), '/media/bgm/theme');
    assert.equal(mediaUrl('https://cdn.example/assets/audio/theme.mp3', 'https://game.example'), 'https://cdn.example/assets/audio/theme.mp3');
    const player = new OriginalVfxPlayer({ P: {}, layers: {}, cam: {}, root: '/assets/vfx/rosmon' });
    assert.equal(player.root, '/stronghold/assets/vfx/rosmon');
    const external = new OriginalVfxPlayer({ P: {}, layers: {}, cam: {}, root: 'https://cdn.example/assets/vfx/rosmon' });
    assert.equal(external.root, 'https://cdn.example/assets/vfx/rosmon');
  });
});
