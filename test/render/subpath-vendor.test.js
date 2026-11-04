// test/render/subpath-vendor.test.js — a page mounted at /stronghold/assault/ loads the vendored three.js and PIXI under
// its own directory (public/js/resourceBase.js rebases /vendor/), so three.module.js's own import of three.core.js stays
// under the mount; PIXI loads textures on the page's thread (a worker fetch carries no page Referer for the gateway).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageBasePath, pageResourcePath } from '../../public/js/resourceBase.js';

const MOUNTED = 'http://127.0.0.1:15001/stronghold/assault/assault.html';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('vendored scripts under a mounted subpath', () => {
  test('/vendor/ follows the page directory like /assets/; other root paths stay', () => {
    assert.equal(pageBasePath(MOUNTED), '/stronghold/assault/');
    assert.equal(pageResourcePath('/vendor/three.module.js', MOUNTED), '/stronghold/assault/vendor/three.module.js');
    assert.equal(pageResourcePath('/vendor/pixi.min.js', MOUNTED), '/stronghold/assault/vendor/pixi.min.js');
    assert.equal(pageResourcePath('/assets/spine/op/x/front/x.skel', MOUNTED), '/stronghold/assault/assets/spine/op/x/front/x.skel');
    assert.equal(pageResourcePath('/vendor/three.module.js', 'http://127.0.0.1:13003/assault.html'), '/vendor/three.module.js');
    assert.equal(pageResourcePath('/api/assault/catalog', MOUNTED), '/api/assault/catalog');
  });

  test('three.js and PIXI load through pageResourcePath; PIXI textures do not use workers', () => {
    assert.match(read('public/js/render/board3d/load.js'), /const at = pageResourcePath\(url\);/);
    const pixi = read('public/js/render/app/pixi.js');
    assert.match(pixi, /s\.src = pageResourcePath\(src\);/);
    assert.match(pixi, /setPreferences\?\.\(\{ preferWorkers: false \}\)/);
  });
});
