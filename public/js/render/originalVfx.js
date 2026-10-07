// Optional original-client VFX playback. The extractor writes one atlas per Unity prefab under
// /assets/vfx/rosmon; this player turns the colour/coverage pair into premultiplied-alpha Pixi textures.

const DEFAULT_ROOT = '/assets/vfx/rosmon';

/**
 * Atlas frames are recorded as `[premultiplied colour | coverage]` but the
 * shader presents that pair as one logical frame.  Keep the geometry and the
 * anchor in logical (colour-half) pixels; using the packed width here shifts
 * every effect by half its own width and makes the error grow with zoom.
 */
export function framePlacement(entry, scaleAtPoint = 1) {
  const cellW = Math.max(1, Number(entry?.cellW) || 1);
  const cellH = Math.max(1, Number(entry?.cellH) || 1);
  const originX = Number(entry?.originX);
  const originY = Number(entry?.originY);
  return {
    // `originPx` is measured in the cropped logical colour frame. The packed
    // coverage half is a storage detail and does not change world geometry.
    anchorX: (Number.isFinite(originX) ? originX : cellW / 2) / cellW,
    anchorY: (Number.isFinite(originY) ? originY : cellH) / cellH,
    scaleX: Number(scaleAtPoint) || 1,
    scaleY: Number(scaleAtPoint) || 1,
  };
}

const asFinite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const FRAME_FRAG = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 uFrame;
uniform vec2 uTexel;
uniform float uAlpha;
void main(void) {
  vec2 leftUv = clamp(uFrame.xy + vTextureCoord * uFrame.zw,
    uFrame.xy + uTexel * 0.5, uFrame.xy + uFrame.zw - uTexel * 0.5);
  vec2 rightUv = leftUv + vec2(uFrame.z, 0.0);
  vec4 colour = texture2D(uSampler, leftUv);
  vec3 coverage = texture2D(uSampler, rightUv).rgb;
  float alpha = max(max(coverage.r, coverage.g), coverage.b);
  gl_FragColor = vec4(colour.rgb, alpha) * uAlpha;
}`;

// Unity's dissolve materials are not ordinary textured quads.  In the source
// shader the dissolve map gates the main texture with a per-particle amount;
// using MeshMaterial directly leaves the whole 64px smoke plane opaque and is
// the square shadow visible in the compare page.
const MESH_VERT = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vTextureCoord;
void main(void) {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vTextureCoord = aTextureCoord;
}`;

// `Program.from` compiles/linkes a WebGL program on first use. Creating one for
// every target hit made the compare page compile the same two programs over and
// over during a skill, which shows up as main-thread stalls and repeated
// texture/program binds in the browser. Keep the immutable programs per Pixi
// namespace; each effect still receives its own Shader uniforms below.
const PROGRAM_CACHE = new WeakMap();
function sharedProgram(P, key, vertex, fragment) {
  let cache = PROGRAM_CACHE.get(P);
  if (!cache) { cache = new Map(); PROGRAM_CACHE.set(P, cache); }
  if (!cache.has(key)) cache.set(key, P.Program.from(vertex, fragment));
  return cache.get(key);
}

function setAtlasFrame(mesh, entry, index) {
  const count = Math.max(1, entry?.textures?.length || 1);
  const i = Math.max(0, Math.min(count - 1, Number(index) | 0));
  const frame = entry?.textures?.[i]?.frame;
  const base = entry?.base;
  const uniforms = mesh?.shader?.uniforms;
  if (!frame || !base || !uniforms?.uFrame) return;
  const baseW = Math.max(1, Number(base.width) || 1);
  const baseH = Math.max(1, Number(base.height) || 1);
  const logicalW = Math.max(1, Number(entry.cellW) || frame.width / 2);
  const logicalH = Math.max(1, Number(entry.cellH) || frame.height);
  uniforms.uFrame[0] = frame.x / baseW;
  uniforms.uFrame[1] = frame.y / baseH;
  uniforms.uFrame[2] = logicalW / baseW;
  uniforms.uFrame[3] = logicalH / baseH;
  mesh.vfxFrameIndex = i;
}

function createAtlasFrame(P, entry, index = 0) {
  if (!P?.MeshGeometry || !P?.Shader || !P?.Program || !P?.Mesh || !P?.Texture) return null;
  const w = Math.max(1, Number(entry.cellW) || 1);
  const h = Math.max(1, Number(entry.cellH) || 1);
  const ox = Number(entry.originX) || w / 2;
  const oy = Number(entry.originY) || h;
  const baseW = Math.max(1, Number(entry.base?.width) || 1);
  const baseH = Math.max(1, Number(entry.base?.height) || 1);
  const geometry = new P.MeshGeometry(
    new Float32Array([-ox, -oy, w - ox, -oy, w - ox, h - oy, -ox, h - oy]),
    new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    new Uint16Array([0, 1, 2, 0, 2, 3]),
  );
  const atlas = entry.atlas || new P.Texture(entry.base);
  const shader = new P.Shader(sharedProgram(P, 'atlas-frame', MESH_VERT, FRAME_FRAG), {
    uSampler: atlas,
    uFrame: new Float32Array(4),
    uTexel: new Float32Array([1 / baseW, 1 / baseH]),
    uAlpha: 1,
  });
  const mesh = new P.Mesh(geometry, shader);
  mesh.blendMode = P.BLEND_MODES?.NORMAL ?? 0;
  setAtlasFrame(mesh, entry, index);
  return mesh;
}

const DISSOLVE_FRAG = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D uDissolveTex;
uniform vec4 uColor;
uniform vec2 uDissolveScale;
uniform vec2 uDissolveOffset;
uniform float uAmount;
uniform float uBorderWidth;
uniform float uAlpha;
void main(void) {
  vec4 c = texture2D(uSampler, vTextureCoord);
  vec2 duv = vec2(vTextureCoord.x * uDissolveScale.x + uDissolveOffset.x,
    1.0 - ((1.0 - vTextureCoord.y) * uDissolveScale.y + uDissolveOffset.y));
  float d = texture2D(uDissolveTex, duv).r;
  float rounded = floor(uAmount + 1.0);
  float k = 1.0 - rounded;
  float edge = clamp((d - uAmount + uBorderWidth * k) / max(uBorderWidth, 0.0001), 0.0, 1.0);
  float a = c.a * uColor.a * 2.0 * edge * uAlpha;
  gl_FragColor = vec4(c.rgb * uColor.rgb * 2.0, a);
}`;

function curveValue(curve, t, fallback = 0) {
  const keys = Array.isArray(curve?.keys) ? curve.keys : [];
  if (!keys.length) return fallback;
  const x = Math.max(0, Math.min(1, Number(t) || 0));
  if (x <= Number(keys[0]?.[0] ?? 0)) return Number(keys[0]?.[1]) || 0;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    const at = Number(a?.[0]) || 0, bt = Number(b?.[0]) || 1;
    if (x <= bt) {
      const k = (x - at) / Math.max(1e-6, bt - at);
      return (Number(a?.[1]) || 0) + ((Number(b?.[1]) || 0) - (Number(a?.[1]) || 0)) * k;
    }
  }
  return Number(keys[keys.length - 1]?.[1]) || 0;
}

/**
 * A small, deliberately optional player. It is absent from the fake Pixi/unit-test contexts and is enabled by
 * render/app.js only when the local extracted VFX directory is present.
 */
export class OriginalVfxPlayer {
  constructor({ P, layers, cam, view, root = DEFAULT_ROOT, cacheKey = null }) {
    this.P = P;
    this.layers = layers;
    this.cam = cam;
    this.view = typeof view === 'function' ? view : () => null;
    this.root = String(root || DEFAULT_ROOT).replace(/\/$/, '');
    // Atlas files are replaceable runtime assets. Keep a batch key so a
    // browser cannot silently combine a new manifest with an old atlas.
    this.cacheKey = cacheKey == null || cacheKey === '' ? null : String(cacheKey);
    this.manifest = null;
    this.manifestPromise = null;
    this.entries = new Map();
    this.active = new Set();
    this.missing = new Set();
    this.requested = new Set();
    this.loaded = new Set();
    this.procedural = new Set();
    this.unresolved = new Set();
  }

  _assetUrl(path) {
    const url = String(path || '');
    return this.cacheKey ? `${url}${url.includes('?') ? '&' : '?'}vfx=${encodeURIComponent(this.cacheKey)}` : url;
  }

  _manifest() {
    if (this.manifest) return Promise.resolve(this.manifest);
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(this._assetUrl(`${this.root}/index.json`), { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error(`original VFX manifest ${r.status}`); return r.json(); })
        .then((m) => {
          // Empty Unity control nodes are kept in the manifest for coverage, but have no atlas to request.
          this.manifest = new Map((Array.isArray(m) ? m : []).filter((x) => x && x.prefab && !x.empty).map((x) => [x.prefab, x]));
          return this.manifest;
        })
        .catch((err) => { this.manifestPromise = null; console.warn('[vfx] original manifest unavailable', err?.message || err); return null; });
    }
    return this.manifestPromise;
  }

  async _entry(prefab) {
    if (this.entries.has(prefab)) return this.entries.get(prefab);
    const manifest = await this._manifest();
    const meta = manifest?.get(prefab);
    if (!meta) { this.missing.add(prefab); return null; }
    const atlasUrl = this._assetUrl(`${this.root}/${encodeURIComponent(prefab)}/atlas.webp`);
    // The extractor's atlas is a premultiplied-colour / coverage pair.  The reference player samples it with
    // nearest filtering and premultiplied blending; linear filtering smears the narrow sword/trail cells into the
    // black padding and is the reason the otherwise-correct 锏 trail looked muddy.
    const base = this.P.BaseTexture.from(atlasUrl, { scaleMode: this.P.SCALE_MODES?.NEAREST });
    if (!base.valid) await new Promise((resolve, reject) => { base.once('loaded', resolve); base.once('error', reject); });
    const cellW = Math.max(1, Math.floor(asFinite(meta.cell?.[0], base.width / Math.max(1, meta.cols || 1) / 2)));
    const cellH = Math.max(1, Math.floor(asFinite(meta.cell?.[1], base.height / Math.max(1, Math.ceil(meta.frames / Math.max(1, meta.cols || 1))))));
    const cols = Math.max(1, Math.floor(asFinite(meta.cols, Math.floor(base.width / (cellW * 2)))));
    const frames = Math.max(1, Math.floor(asFinite(meta.frames, cols * Math.floor(base.height / cellH))));
    const textures = [];
    for (let i = 0; i < frames; i++) {
      const sx = (i % cols) * cellW * 2;
      const sy = Math.floor(i / cols) * cellH;
      textures.push(new this.P.Texture(base, new this.P.Rectangle(sx, sy, cellW * 2, cellH)));
    }
    const atlas = new this.P.Texture(base);
    const entry = { meta, base, atlas, textures, cellW, cellH, fps: Math.max(1, asFinite(meta.fps, 30)), originX: asFinite(meta.originPx?.[0], cellW / 2), originY: asFinite(meta.originPx?.[1], cellH) };
    this.entries.set(prefab, entry);
    return entry;
  }

  /** Warm the atlas decode/cache before a battle event requests its first frame.
   * The source exports can be several megabytes each; decoding them inside the
   * first `play()` callback is visible as a one-frame hitch even when the
   * subsequent Pixi draw stays within budget. Callers pass only the prefabs
   * needed by the current action so this does not turn into a full bundle load.
   */
  async preload(prefabs = []) {
    const names = [...new Set(Array.isArray(prefabs) ? prefabs.filter(Boolean).map(String) : [])];
    const results = await Promise.allSettled(names.map((prefab) => this._entry(prefab)));
    for (let i = 0; i < results.length; i++) if (results[i].status === 'rejected') this.missing.add(names[i]);
    return results;
  }

  /** Warm mesh-particle JSON and its source textures before a map-bound effect starts. */
  async preloadMesh(prefabs = []) {
    const names = [...new Set(Array.isArray(prefabs) ? prefabs.filter(Boolean).map(String) : [])];
    const results = await Promise.allSettled(names.map(async (prefab) => {
      const data = await this._meshEntry(prefab);
      const files = new Set();
      for (const node of data.nodes || []) {
        for (const material of Array.isArray(node?.materials) ? node.materials : []) {
          const info = material?.sourceTexture || material?.texture;
          if (info?.file) files.add(info.file);
          for (const tex of Object.values(material?.textures || {})) if (tex?.file) files.add(tex.file);
        }
      }
      if (!this.meshTextures) this.meshTextures = new Map();
      await Promise.all([...files].map(async (file) => {
        const url = this._assetUrl(`${this.root}/${encodeURIComponent(prefab)}/textures/${encodeURIComponent(file)}`);
        let texture = this.meshTextures.get(url);
        if (!texture) { texture = this.P.Texture.from(url); this.meshTextures.set(url, texture); }
        const base = texture.baseTexture || texture;
        if (!base.valid) await new Promise((resolve, reject) => { base.once('loaded', resolve); base.once('error', reject); });
      }));
      return data;
    }));
    for (let i = 0; i < results.length; i++) if (results[i].status === 'rejected') this.missing.add(names[i]);
    return results;
  }

  async _meshEntry(prefab) {
    if (!this.meshEntries) this.meshEntries = new Map();
    if (this.meshEntries.has(prefab)) return this.meshEntries.get(prefab);
    const promise = fetch(this._assetUrl(`${this.root}/${encodeURIComponent(prefab)}/mesh.json`), { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`mesh VFX ${r.status}`); return r.json(); })
      .then((data) => {
        if (!data || data.format !== 1 || !Array.isArray(data.nodes)) throw new Error('invalid mesh VFX export');
        return data;
      });
    this.meshEntries.set(prefab, promise);
    try { return await promise; } catch (err) { this.meshEntries.delete(prefab); throw err; }
  }

  /**
   * Rebuild a Unity Mesh-particle prefab from the extractor's hierarchy export.
   * This is the path for effects whose authored geometry is part of the visual
   * (ground slashes, rings, lines); treating those prefabs as one billboard is
   * what created the transparent polygons in the original compare page.
   */
  playMesh(prefab, { x = 0, y = 0, z = 0, followId = null, group = null, delay = 0, life = null } = {}) {
    if (!prefab || typeof document === 'undefined' || !this.P?.Mesh || !this.P?.MeshGeometry || !this.P?.MeshMaterial) return false;
    this.requested.add(prefab);
    const record = { kind: 'meshPrefab', prefab, x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0,
      followId, group, elapsed: 0, delay: Math.max(0, Number(delay) || 0), life: life == null ? null : Math.max(0.1, Number(life)), dead: false, parts: [], ready: false, data: null };
    this.active.add(record);
    this._meshEntry(prefab).then(async (data) => {
      if (record.dead) return;
      record.data = data;
      const parts = [];
      for (const node of data.nodes) {
        const raw = node?.mesh;
        const material = Array.isArray(node?.materials) ? node.materials.find((m) => m?.texture?.file) : null;
        if (!raw || !Array.isArray(raw.vertices) || !raw.vertices.length || !Array.isArray(raw.indices) || !raw.indices.length || !material) continue;
        const loadTexture = async (info) => {
          if (!info?.file) return null;
          const url = this._assetUrl(`${this.root}/${encodeURIComponent(prefab)}/textures/${encodeURIComponent(info.file)}`);
          let texture = this.meshTextures?.get(url);
          if (!texture) {
            if (!this.meshTextures) this.meshTextures = new Map();
            texture = this.P.Texture.from(url);
            this.meshTextures.set(url, texture);
            // Texture.from returns a Texture wrapper; the load lifecycle belongs
            // to its BaseTexture. Waiting on the wrapper leaves mesh prefabs in
            // a permanently pending state in Pixi 6, so the coverage report
            // shows the prefab as requested but never loaded.
            const base = texture.baseTexture || texture;
            if (!base.valid) await new Promise((resolve, reject) => { base.once('loaded', resolve); base.once('error', reject); });
          }
          return texture;
        };
        // The baked smoke texture is retained as an extraction fallback, but
        // when the source dissolve map is available use the source pair and
        // evaluate ArkDissolve in the fragment shader. This removes the opaque
        // plane that a static grayscale alpha creates between dissolve frames.
        const source = material.sourceTexture || material.texture;
        const texture = await loadTexture(source);
        if (!texture) continue;
        const dissolveInfo = material.textures?.DissolveTex;
        const dissolveTexture = dissolveInfo ? await loadTexture(dissolveInfo) : null;
        const vtx = new Float32Array(raw.vertices.length * 2);
        const uv = new Float32Array(raw.vertices.length * 2);
        const IndexArray = raw.vertices.length > 65535 ? Uint32Array : Uint16Array;
        const idx = new IndexArray(raw.indices);
        const color = material.color || [1, 1, 1, 1];
        const rgba = new Float32Array([
          Math.max(0, Math.min(1, Number(color[0]) || 0)),
          Math.max(0, Math.min(1, Number(color[1]) || 0)),
          Math.max(0, Math.min(1, Number(color[2]) || 0)),
          Math.max(0, Math.min(1, Number(color[3]) || 0)),
        ]);
        const geometry = new this.P.MeshGeometry(vtx, uv, idx);
        let uniforms = null;
        let materialInstance;
        if (dissolveTexture && this.P.Shader && this.P.Program) {
          uniforms = {
            uSampler: texture,
            uDissolveTex: dissolveTexture,
            uColor: rgba,
            uDissolveScale: new Float32Array(dissolveInfo.scale || [1, 1]),
            uDissolveOffset: new Float32Array(dissolveInfo.offset || [0, 0]),
            uAmount: Number(material.floats?._DissolveIntensity) || 0,
            uBorderWidth: Number(material.floats?._BorderWidth) || 0.1,
            uAlpha: 1,
          };
          materialInstance = new this.P.Shader(sharedProgram(this.P, 'mesh-dissolve', MESH_VERT, DISSOLVE_FRAG), uniforms);
        } else {
          materialInstance = new this.P.MeshMaterial(texture);
        }
        const mesh = new this.P.Mesh(geometry, materialInstance);
        mesh.tint = ((rgba[0] * 255) << 16) | ((rgba[1] * 255) << 8) | (rgba[2] * 255);
        mesh.blendMode = material.additive ? (this.P.BLEND_MODES?.ADD ?? 1) : (this.P.BLEND_MODES?.NORMAL ?? 0);
        mesh.visible = false;
        this.layers.fxAdd.addChild(mesh);
        const texScale = material.texture.scale || [1, 1];
        const texOffset = material.texture.offset || [0, 0];
        for (let i = 0; i < raw.vertices.length; i++) {
          const p = raw.uv0?.[i] || [0, 0];
          // Unity UVs are bottom-left based; Pixi textures are top-left based.
          // Dissolve materials apply the second texture's transform in their
          // fragment shader, so their main UV remains unmodified.
          uv[i * 2] = dissolveTexture ? Number(p[0]) : Number(p[0]) * Number(texScale[0] ?? 1) + Number(texOffset[0] ?? 0);
          uv[i * 2 + 1] = dissolveTexture ? 1 - Number(p[1]) : 1 - (Number(p[1]) * Number(texScale[1] ?? 1) + Number(texOffset[1] ?? 0));
        }
        geometry.getBuffer('aTextureCoord').update(uv);
        parts.push({ mesh, geometry, positions: vtx, uv, node, material, uniforms, colorAlpha: rgba[3] });
      }
      if (record.dead) { for (const p of parts) p.mesh.destroy({ children: true }); return; }
      record.parts = parts;
      record.ready = true;
      this.loaded.add(prefab);
    }).catch((err) => { record.dead = true; this.missing.add(prefab); console.warn('[vfx] mesh prefab unavailable', prefab, err?.message || err); });
    return true;
  }

  play(prefab, { x = 0, y = 0, z = 0, scale = 1, followId = null, group = null, loop = false, life = null, delay = 0, anchor = 'ground', bone = null, mirror = false, offsetZ = 0 } = {}) {
    if (!prefab || typeof document === 'undefined' || !this.P?.MeshGeometry || !this.P?.Shader || !this.P?.Program || !this.P?.Mesh) return false;
    this.requested.add(prefab);
    const record = { prefab, x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0, scale: Number(scale) || 1, followId, group, loop, elapsed: 0, delay: Math.max(0, Number(delay) || 0), ready: false, dead: false, sprite: null, entry: null, life,
      anchor: anchor === 'bone' ? 'bone' : anchor === 'root' ? 'root' : anchor === 'chest' ? 'chest' : anchor === 'tile' ? 'tile' : 'ground',
      bone: typeof bone === 'string' && bone ? bone : null, mirror: mirror === true, offsetZ: Number(offsetZ) || 0 };
    this.active.add(record);
    this._entry(prefab).then((entry) => {
      if (record.dead || !entry) return;
      record.entry = entry;
      record.ready = true;
      this.loaded.add(prefab);
      const sprite = createAtlasFrame(this.P, entry, 0);
      if (!sprite) { record.dead = true; return; }
      sprite.blendMode = this.P.BLEND_MODES?.NORMAL ?? 0;
      sprite.alpha = 1;
      sprite.visible = record.elapsed >= record.delay;
      this.layers.fxAdd.addChild(sprite);
      record.sprite = sprite;
      this._place(record);
    }).catch((err) => { record.dead = true; console.warn('[vfx] original prefab unavailable', prefab, err?.message || err); });
    return true;
  }

  /** Render the authored tile/range frame whose Unity custom vertex stream is
   * not representable by the packed colour/coverage atlas. */
  playGroundFrame({ x = 0, y = 0, z = 0, followId = null, group = null, life = 1.6, delay = 0, grid = null, dir = 'RIGHT' } = {}) {
    if (!this.P?.Graphics || typeof document === 'undefined') return false;
    const record = { kind: 'groundFrame', x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0, followId, group,
      elapsed: 0, delay: Math.max(0, Number(delay) || 0), life: Math.max(0.1, Number(life) || 1.6), dead: false,
      grid: Array.isArray(grid) ? grid.filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))).map((p) => [Number(p[0]), Number(p[1])]) : null,
      dir: typeof dir === 'string' ? dir.toUpperCase() : 'RIGHT', graphics: new this.P.Graphics() };
    record.graphics.visible = false;
    // The source `range_line` is a map Mesh drawn over the ground and the cast
    // pass. Keep the procedural equivalent above the atlas pass so the exact
    // 13-cell footprint remains inspectable while the cast streaks are active.
    (this.layers.fxAdd || this.layers.fxNormal || this.layers.groundFx).addChild(record.graphics);
    this.active.add(record);
    this._placeGroundFrame(record);
    return true;
  }

  /**
   * The S3 end prefab contains several Unity Mesh particle renderers. A packed
   * billboard atlas cannot preserve those mesh vertices: showing it as a Sprite
   * produces the large transparent polygons seen in the compare page. Keep the
   * authored tile binding, but express the mesh ring as thin 2D line geometry
   * until a mesh/vertex-stream renderer is available.
   */
  playGroundSheathe({ x = 0, y = 0, z = 0, followId = null, group = null, life = 1.55, delay = 0 } = {}) {
    if (!this.P?.Graphics || typeof document === 'undefined') return false;
    const record = { kind: 'groundSheathe', x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0, followId, group,
      elapsed: 0, delay: Math.max(0, Number(delay) || 0), life: Math.max(0.1, Number(life) || 1.55), dead: false, graphics: new this.P.Graphics() };
    record.graphics.visible = false;
    // The sheathe is also a tile-bound map pass. It must sit above the cast
    // atlas so the mesh replacement cannot be mistaken for a second billboard.
    (this.layers.fxAdd || this.layers.fxNormal || this.layers.groundFx).addChild(record.graphics);
    this.active.add(record);
    this._placeGroundSheathe(record);
    return true;
  }

  markProcedural(prefab) { if (prefab) this.procedural.add(String(prefab)); }
  markUnresolved(prefab) { if (prefab) this.unresolved.add(String(prefab)); }

  stopGroup(group) {
    if (!group) return;
    for (const r of this.active) if (r.group === group) this._remove(r);
  }

  _place(record) {
    if (!record.sprite || !record.entry) return;
    const followed = record.followId == null ? null : this.view(record.followId);
    // Ground effects belong to the tile, not to the interpolated centre of a
    // walking/preview unit.  Production battle positions are integer row/col;
    // the compare page deliberately uses the same rule so a non-grid test
    // position cannot hide an anchoring bug.
    const x = record.anchor === 'tile' && followed ? Math.round(followed.x) : (followed?.x ?? record.x);
    const y = record.anchor === 'tile' && followed ? Math.round(followed.y) : (followed?.y ?? record.y);
    const z = followed ? (followed.z || 0) + (record.anchor === 'tile' ? 0 : (followed.hover || 0)) + (record.anchor === 'chest' ? (followed._headTiles ? followed._headTiles * 0.45 : 0.5) : 0) + record.offsetZ : record.z + record.offsetZ;
    const p = this.cam()?.project(x, y, z, {});
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    let sx = p.x, sy = p.y;
    let depth = p.depth;
    if (followed && record.anchor === 'bone' && typeof followed.effectAnchor === 'function') {
      const a = followed.effectAnchor(record.bone);
      if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) { sx = a.x; sy = a.y; depth = a.depth ?? depth; }
    } else if (followed && record.anchor === 'root' && followed.root) {
      sx = Number(followed.root.x) || p.x;
      sy = Number(followed.root.y) || p.y;
      depth = Number.isFinite(Number(followed.root.zIndex)) ? -Number(followed.root.zIndex) : depth;
    }
    record.sprite.position.set(sx, sy);
    const s = Math.max(0.01, (p.s || 1) * record.scale / Math.max(1, record.entry.meta.pxPerUnit || 96));
    const facing = followed && record.mirror ? (followed.isEnemy ? -1 : 1) * (Number(followed.visFacing ?? followed.facing) < 0 ? -1 : 1) : 1;
    record.sprite.scale.set(s * facing, s);
    record.sprite.zIndex = Number.isFinite(depth) ? -depth : 0;
  }

  _placeGroundFrame(record) {
    const followed = record.followId == null ? null : this.view(record.followId);
    const tx = followed ? Math.round(followed.x) : Math.round(record.x);
    const ty = followed ? Math.round(followed.y) : Math.round(record.y);
    const z = followed ? (followed.z || 0) : record.z;
    const cam = this.cam();
    if (!cam || !record.graphics) return;
    const p = cam.project(tx, ty, z + 0.025, {});
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const phase = Math.max(0, record.elapsed - record.delay);
    const fade = phase < 0.18 ? phase / 0.18 : phase > record.life - 0.32 ? Math.max(0, (record.life - phase) / 0.32) : 1;
    const pulse = 0.72 + 0.28 * Math.sin(phase * 9);
    const g = record.graphics;
    g.clear();
    const rotate = (dr, dc) => {
      switch (record.dir) {
        case 'UP': return [dc, -dr];
        case 'LEFT': return [-dr, -dc];
        case 'DOWN': return [-dc, dr];
        default: return [dr, dc];
      }
    };
    // start_02's range_line is a Unity mesh, not a sprite. Its authored grid is
    // the skill's x-1 range (13 tiles); the old fallback rendered five guessed
    // squares and therefore put the map effect in the wrong places.
    const localGrid = record.grid?.length ? record.grid : [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]];
    // Combat view positions are (column, row), while an Arknights range grid
    // is authored as [rowOffset, columnOffset]. Keep that distinction here;
    // using (row, column) directly makes the telegraph disagree with the
    // actual target tiles whenever the range is not symmetric on the diagonal.
    const cells = localGrid.map(([dr, dc]) => {
      const [rr, cc] = rotate(dr, dc);
      return [tx + cc, ty + rr];
    });
    const seen = new Set(cells.map(([rr, cc]) => `${rr},${cc}`));
    const q = 0.46;
    const alpha = Math.min(0.8, fade * pulse);
    if (typeof g.beginFill === 'function') g.beginFill(0xe7b96b, Math.min(0.12, alpha * 0.12));
    g.lineStyle(Math.max(1.2, p.s * 0.021), 0xe7b96b, Math.min(0.72, alpha));
    for (const [cx, cy] of cells) {
      const pts = [];
      for (const [ox, oy] of [[-q, -q], [q, -q], [q, q], [-q, q]]) {
        const v = cam.project(cx + ox, cy + oy, z + 0.027, {});
        pts.push(v.x, v.y);
      }
      if (typeof g.drawPolygon === 'function') g.drawPolygon(pts);
    }
    if (typeof g.endFill === 'function') g.endFill();
    // range_line is the exposed perimeter; omit shared internal edges so the
    // indicator reads as one continuous area rather than disconnected boxes.
    g.lineStyle(Math.max(1.7, p.s * 0.029), 0xffe8af, Math.min(0.86, alpha * 0.95));
    // `cells` are already world `(column, row)` positions. These neighbor
    // offsets therefore stay in screen-world axes; applying the authored
    // [row, column] rotation a second time reintroduced every inner edge.
    const edges = [
      [[-q, -q], [q, -q], [0, -1]], [[q, -q], [q, q], [1, 0]],
      [[q, q], [-q, q], [0, 1]], [[-q, q], [-q, -q], [-1, 0]],
    ];
    for (const [cx, cy] of cells) {
      for (const [[a, b], [c, d], [ndx, ndy]] of edges) {
        if (seen.has(`${cx + ndx},${cy + ndy}`)) continue;
        const v1 = cam.project(cx + a, cy + b, z + 0.029, {});
        const v2 = cam.project(cx + c, cy + d, z + 0.029, {});
        g.moveTo(v1.x, v1.y); g.lineTo(v2.x, v2.y);
      }
    }
    g.zIndex = Number.isFinite(p.depth) ? -p.depth : 0;
  }

  _placeGroundSheathe(record) {
    const followed = record.followId == null ? null : this.view(record.followId);
    const tx = followed ? Math.round(followed.x) : Math.round(record.x);
    const ty = followed ? Math.round(followed.y) : Math.round(record.y);
    const z = followed ? (followed.z || 0) : record.z;
    const cam = this.cam();
    if (!cam || !record.graphics) return;
    const p = cam.project(tx, ty, z + 0.034, {});
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const phase = Math.max(0, record.elapsed - record.delay) / Math.max(0.1, record.life);
    const fade = phase < 0.16 ? phase / 0.16 : Math.max(0, 1 - Math.max(0, phase - 0.62) / 0.38);
    const radius = 0.3 + 0.85 * Math.min(1, phase * 1.35);
    const g = record.graphics;
    g.clear();
    const points = [];
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI * 2 * i) / 16;
      const q = cam.project(tx + Math.cos(a) * radius, ty + Math.sin(a) * radius, z + 0.036, {});
      points.push(q);
    }
    g.lineStyle(Math.max(1.5, p.s * 0.026), 0xe7b96b, Math.min(0.88, fade));
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    }
    g.lineStyle(Math.max(1, p.s * 0.014), 0xfff3c4, Math.min(0.72, fade * 0.82));
    const center = cam.project(tx, ty, z + 0.037, {});
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8 + phase * 1.8;
      const inner = cam.project(tx + Math.cos(a) * radius * 0.55, ty + Math.sin(a) * radius * 0.55, z + 0.037, {});
      const outer = cam.project(tx + Math.cos(a) * radius * 1.18, ty + Math.sin(a) * radius * 1.18, z + 0.037, {});
      g.moveTo(inner.x, inner.y); g.lineTo(outer.x, outer.y);
    }
    g.zIndex = Number.isFinite(p.depth) ? -p.depth : 0;
  }

  _remove(record) {
    if (record.dead) return;
    record.dead = true;
    this.active.delete(record);
    try { record.sprite?.destroy({ children: true }); } catch { /* optional */ }
    try { record.graphics?.destroy({ children: true }); } catch { /* optional */ }
  }

  update(dt) {
    const delta = Math.max(0, Number(dt) || 0);
    for (const record of [...this.active]) {
      if (record.dead) continue;
      record.elapsed += delta;
      if (record.kind === 'groundFrame') {
        if (record.elapsed < record.delay) { record.graphics.visible = false; continue; }
        const phase = record.elapsed - record.delay;
        if (phase >= record.life) { this._remove(record); continue; }
        record.graphics.visible = true;
        this._placeGroundFrame(record);
        continue;
      }
      if (record.kind === 'groundSheathe') {
        if (record.elapsed < record.delay) { record.graphics.visible = false; continue; }
        const phase = record.elapsed - record.delay;
        if (phase >= record.life) { this._remove(record); continue; }
        record.graphics.visible = true;
        this._placeGroundSheathe(record);
        continue;
      }
      if (record.kind === 'meshPrefab') {
        if (record.elapsed < record.delay || !record.ready) { for (const part of record.parts) part.mesh.visible = false; continue; }
        const phase = record.elapsed - record.delay;
        const dataLife = Math.max(0.1, ...record.parts.map((part) => Number(part.node?.particle?.life) || 0.1));
        const maxLife = record.life == null ? dataLife : Math.max(0.1, record.life);
        if (phase >= maxLife) { this._remove(record); continue; }
        const followed = record.followId == null ? null : this.view(record.followId);
        const tx = followed ? Math.round(followed.x) : Math.round(record.x);
        const ty = followed ? Math.round(followed.y) : Math.round(record.y);
        const tz = followed ? (followed.z || 0) : record.z;
        const cam = this.cam();
        if (!cam) continue;
        for (const part of record.parts) {
          const node = part.node;
          const raw = node.mesh;
          const particle = node.particle || {};
          const life = Math.max(0.1, Number(particle.life) || maxLife);
          const t = Math.max(0, Math.min(1, phase / life));
          const fadeIn = Math.min(1, phase / 0.05);
          const fadeOut = Math.max(0, 1 - Math.max(0, t - 0.55) / 0.45);
          const alpha = fadeIn * fadeOut * (part.colorAlpha ?? 1);
          const sizes = Array.isArray(particle.size) ? particle.size.slice() : [1, 1, 1];
          // The t2 slash's dark/light child is authored at 10× the edge
          // height. That value is consumed by Torappu's custom particle
          // stream; applying it as raw map geometry makes the browser show a
          // full-height transparent quad. Keep the source width and the
          // sibling edge height while the custom shader path is unavailable.
          if (/\/dg_3\/(dark|light)$/.test(String(node.path || "")) && /_dg_(dark|light)/.test(String(part.material?.name || ""))) {
            sizes[1] = Math.min(Number(sizes[1]) || 1, (Number(sizes[0]) || 1) * 0.8);
          }
          const angle = Number(particle.rotation) || 0;
          const cos = Math.cos(angle), sin = Math.sin(angle);
          const origin = node.origin || [0, 0, 0];
          const basis = node.basis || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
          let depth = 0;
          for (let i = 0; i < raw.vertices.length; i++) {
            const source = raw.vertices[i];
            const rx = source[0] * cos - source[1] * sin;
            const ry = source[0] * sin + source[1] * cos;
            const lx = rx * (Number(sizes[0]) || 1), ly = ry * (Number(sizes[1]) || 1), lz = source[2] * (Number(sizes[2]) || 1);
            const wx = tx + Number(origin[0]) + Number(basis[0][0]) * lx + Number(basis[1][0]) * ly + Number(basis[2][0]) * lz;
            const wy = ty + Number(origin[1]) + Number(basis[0][1]) * lx + Number(basis[1][1]) * ly + Number(basis[2][1]) * lz;
            const wz = tz + Number(origin[2]) + Number(basis[0][2]) * lx + Number(basis[1][2]) * ly + Number(basis[2][2]) * lz;
            const projected = cam.project(wx, wy, wz + 0.04, {});
            part.positions[i * 2] = projected.x;
            part.positions[i * 2 + 1] = projected.y;
            depth += Number(projected.depth) || 0;
          }
          part.geometry.getBuffer('aVertexPosition').update(part.positions);
          if (part.uniforms) {
            const curves = particle.customCurves || {};
            const dissolve = curves.vector1_0;
            const baseAmount = Number(part.material.floats?._DissolveIntensity) || 0;
            part.uniforms.uAmount = (dissolve ? curveValue(dissolve, t, 0) : 0) + baseAmount;
            part.uniforms.uAlpha = fadeIn * fadeOut;
          } else {
            part.mesh.alpha = alpha;
          }
          part.mesh.visible = alpha > 0.001;
          part.mesh.zIndex = Number.isFinite(depth) ? -(depth / Math.max(1, raw.vertices.length)) : 0;
        }
        continue;
      }
      if (!record.ready || record.elapsed < record.delay) { if (record.sprite) record.sprite.visible = false; continue; }
      record.sprite.visible = true;
      const entry = record.entry;
      const playTime = record.elapsed - record.delay;
      const frame = Math.floor(playTime * entry.fps);
      const duration = entry.textures.length / entry.fps;
      const maxLife = record.life == null ? duration : Math.max(0, Number(record.life));
      if (!record.loop && playTime >= maxLife) { this._remove(record); continue; }
      const index = record.loop ? frame % entry.textures.length : Math.min(frame, entry.textures.length - 1);
      setAtlasFrame(record.sprite, entry, index);
      this._place(record);
    }
  }

  get count() { return this.active.size; }
  get missingCount() { return this.missing.size; }
  get unresolvedCount() { return this.unresolved.size; }
  coverage() {
    return { requested: [...this.requested].sort(), loaded: [...this.loaded].sort(), missing: [...this.missing].sort(), procedural: [...this.procedural].sort(), unresolved: [...this.unresolved].sort() };
  }

  clear() { for (const record of [...this.active]) this._remove(record); }
  destroy() { this.clear(); this.entries.clear(); this.meshEntries?.clear(); this.meshTextures?.clear(); this.missing.clear(); this.requested.clear(); this.loaded.clear(); this.procedural.clear(); this.unresolved.clear(); this.manifest = null; this.manifestPromise = null; }
}
