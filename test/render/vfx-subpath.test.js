// test/render/vfx-subpath.test.js — the official effects' entry points resolve under the page's own directory
// (render/vfx/available.js's fxListHref, render/vfx/library.js's default fetch and image fallback), so a deployment
// mounted at /stronghold/assault/ reads /stronghold/assault/data/local-fx.json and /stronghold/assault/assets/local/fx/…
// rather than the domain root (public/js/resourceBase.js). 进击不带插件：library.js must not import a plugin module.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fxListHref } from '../../public/js/render/vfx/available.js';
import { FxLibrary } from '../../public/js/render/vfx/library.js';

const MOUNTED = { href: 'http://127.0.0.1:15001/stronghold/assault/assault.html' };

/** Set `globalThis.location` (or remove it when `loc` is null) and return a restore function. */
function withLocation(loc) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'location');
  const prev = globalThis.location;
  if (loc) globalThis.location = loc; else delete globalThis.location;
  return () => {
    if (had) globalThis.location = prev; else delete globalThis.location;
  };
}

describe('official effects under a mounted subpath', () => {
  test('without a location the file list sits at the root', () => {
    const restore = withLocation(null);
    try {
      assert.equal(fxListHref(), '/data/local-fx.json');
    } finally { restore(); }
  });

  test('under /stronghold/assault/ the file list follows the page', () => {
    const restore = withLocation(MOUNTED);
    try {
      assert.equal(fxListHref(), '/stronghold/assault/data/local-fx.json');
    } finally { restore(); }
  });

  test('the default fetch rebases an official asset URL onto the page path', async () => {
    const restore = withLocation(MOUNTED);
    try {
      const lib = new FxLibrary({});
      const calls = [];
      const prevFetch = globalThis.fetch;
      globalThis.fetch = async (url) => { calls.push(url); return { ok: true, status: 200 }; };
      try {
        assert.equal(typeof lib._defaultFetch, 'function');
        await lib._defaultFetch('/assets/local/fx/index.json');
        assert.deepEqual(calls, ['/stronghold/assault/assets/local/fx/index.json']);
      } finally { globalThis.fetch = prevFetch; }
    } finally { restore(); }
  });

  test('library.js carries no plugin import (进击不带插件)', () => {
    const src = readFileSync(new URL('../../public/js/render/vfx/library.js', import.meta.url), 'utf8');
    assert.equal(src.includes('pluginLibrary'), false);
  });
});
