import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { OriginalVfxPlayer, atlasLayout } from '../../public/js/render/originalVfx.js';

const meta = { prefab: 'effect', frames: 4, fps: 10, cell: [1, 1], originPx: [0, 0], pages: [
  { file: 'atlas-000.webp', start: 0, frames: 2, cols: 2, size: [4, 1] },
  { file: 'atlas-001.webp', start: 2, frames: 2, cols: 2, size: [4, 1] },
] };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  const bases = [], uploads = [], meshes = [];
  class BaseTexture extends EventEmitter {
    constructor(url) { super(); this.url = url; this.valid = false; this.width = 4; this.height = 1; bases.push(this);
      setImmediate(() => { if (!this.destroyed) { this.valid = true; this.emit('loaded'); } }); }
    destroy() { this.destroyed = true; }
  }
  class Texture { constructor(base) { this.baseTexture = base; } destroy() { this.destroyed = true; } }
  class MeshGeometry { constructor(vertices) { this.vertices = vertices; } getBuffer() { return { update() {} }; } }
  class MeshMaterial { constructor(texture) { this.texture = texture; } }
  class Shader { constructor(program, uniforms) { this.uniforms = uniforms; } }
  class Mesh { constructor(geometry, shader) { this.geometry = geometry; this.shader = shader; this.position = { set() {} }; this.scale = { set() {} }; meshes.push(this); }
    destroy() { this.destroyed = true; } }
  const P = { BaseTexture, Texture, MeshGeometry, Shader, Mesh, MeshMaterial, Program: { from: () => ({}) } };
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [meta] }));
  const previousDocument = globalThis.document;
  globalThis.document = {};
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
  const player = () => new OriginalVfxPlayer({ P, layers: { fxAdd: { addChild() {} } }, cam: () => ({ project: () => ({ x: 0, y: 0, s: 1 }) }),
    renderer: { texture: { bind: base => uploads.push(base) } } });
  return { player, bases, uploads, meshes };
}

test('page layout rejects gaps, overlaps, traversal paths and impossible dimensions', () => {
  assert.equal(atlasLayout(meta).frames[2].page, 1);
  for (const change of [{ start: 3 }, { start: 1 }, { file: '../atlas.webp' }, { size: [3, 1] }]) {
    const invalid = structuredClone(meta);
    Object.assign(invalid.pages[1], change);
    assert.throws(() => atlasLayout(invalid));
  }
  assert.throws(() => atlasLayout({ ...meta, frames: 5 }));
  assert.equal(atlasLayout({ frames: 4, cell: [1, 1], cols: 2 }).pages.length, 1);
});

test('concurrent requests share one entry and preload uploads each page before playback', async t => {
  const { player, bases, uploads } = fixture(t);
  const p = player();
  const [a, b] = await Promise.all([p._entry('effect'), p._entry('effect')]);
  assert.equal(a, b);
  assert.equal(bases.length, 1);
  await p.preload(['effect', 'effect']);
  assert.equal(bases.length, 2);
  assert.equal(uploads.length, 2);
  assert.equal(p.resourceStats().pending, 0);
  p.destroy();
  assert.ok(bases.every(base => base.destroyed));
  assert.equal(p.resourceStats().textures, 0);
});

test('frame changes bind the correct page and preserve an origin at zero', async t => {
  const { player, meshes } = fixture(t);
  const p = player();
  await p.preload(['effect']);
  p.play('effect');
  await tick();
  const mesh = meshes[0];
  assert.ok(mesh.geometry.vertices[0] === 0);
  const first = mesh.shader.uniforms.uSampler;
  p.update(0.25);
  assert.notEqual(mesh.shader.uniforms.uSampler, first);
  assert.equal(mesh.vfxFrameIndex, 2);
  assert.deepEqual([...mesh.shader.uniforms.uFrame], [0, 0, 0.25, 1]);
  p.update(0.1);
  assert.deepEqual([...mesh.shader.uniforms.uFrame], [0.5, 0, 0.25, 1]);
  assert.equal(p.resourceStats().pageMisses, 0);
  p.update(0.1);
  assert.equal(p.count, 0);
  assert.ok(mesh.destroyed);
  p.destroy();
});

test('late manifest completion cannot overwrite a new root even if fetch ignores abort', async t => {
  const { player } = fixture(t);
  const responses = [];
  t.mock.method(globalThis, 'fetch', url => new Promise(resolve => responses.push({ url, resolve })));
  const p = player();
  const old = p._entry('old');
  p.setRoot('/new');
  const current = p._entry('effect');
  responses[1].resolve({ ok: true, json: async () => [meta] });
  assert.ok(await current);
  responses[0].resolve({ ok: true, json: async () => [{ ...meta, prefab: 'old' }] });
  assert.equal(await old, null);
  assert.deepEqual([...p.manifest.keys()], ['effect']);
  assert.deepEqual([...p.entries.keys()], ['effect']);
  p.destroy();
});

test('destroy cancels pending image work and does not damage another field using the same URL', async t => {
  const { player, bases } = fixture(t);
  const a = player(), b = player();
  const pending = a._entry('effect');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  a.destroy();
  await pending.catch(() => {});
  assert.equal(a.resourceStats().textures, 0);
  await b.preload(['effect']);
  a.destroy();
  assert.ok(b.entries.get('effect').pages.every(page => page.texture.baseTexture.valid && !page.texture.baseTexture.destroyed));
  b.destroy();
  assert.ok(bases.every(base => base.destroyed));
});

test('repeated operator changes leave only the selected root resources resident', async t => {
  const { player, bases } = fixture(t);
  const p = player();
  for (let i = 0; i < 12; i++) {
    p.setRoot(`/operator-${i}`);
    await p.preload(['effect']);
    assert.equal(p.resourceStats().textures, 2);
    assert.equal(bases.filter(base => !base.destroyed).length, 2);
  }
  p.destroy();
  assert.equal(bases.filter(base => !base.destroyed).length, 0);
});

test('finished mesh particles are removed, rather than left attached after their record expires', async t => {
  const { player, meshes, bases } = fixture(t);
  const data = { format: 1, nodes: [{ mesh: { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], indices: [0, 1, 2] },
    particle: { life: 0.1 }, materials: [{ texture: { file: 'smoke.png' }, color: [1, 1, 1, 1] }] }] };
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => data }));
  const p = player();
  await p.preloadMesh(['smoke']);
  p.playMesh('smoke');
  await tick();
  assert.equal(meshes.length, 1);
  p.update(0.2);
  assert.equal(p.count, 0);
  assert.ok(meshes[0].destroyed);
  p.destroy();
  assert.ok(bases.every(base => base.destroyed));
});

test('an empty static capture remains unresolved and cannot be counted as a played effect', async t => {
  const { player } = fixture(t);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [{ prefab: 'moving-trail', empty: true }] }));
  const p = player();
  p.play('moving-trail');
  await tick();
  assert.equal(p.count, 0);
  assert.deepEqual(p.coverage().loaded, []);
  assert.deepEqual(p.coverage().unresolved, ['moving-trail']);
  p.destroy();
});

test('changing skills releases the previous selection; replaying the same selection keeps its warmed pages', async t => {
  const { player, bases } = fixture(t);
  const p = player();
  p.selectPrefabs(['effect']);
  await p.preload(['effect']);
  const generation = p.generation;
  p.selectPrefabs(['effect', 'effect']);
  assert.equal(p.generation, generation);
  assert.equal(p.resourceStats().textures, 2);
  p.selectPrefabs(['different-skill']);
  assert.equal(p.resourceStats().textures, 0);
  assert.ok(bases.every(base => base.destroyed));
  p.destroy();
});
