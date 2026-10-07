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
void main(void) {
  vec2 local = clamp(vTextureCoord, 0.0, 1.0);
  vec2 leftUv = vec2(local.x * 0.5, local.y);
  vec2 rightUv = vec2(0.5 + local.x * 0.5, local.y);
  vec4 colour = texture2D(uSampler, leftUv);
  vec3 coverage = texture2D(uSampler, rightUv).rgb;
  float alpha = max(max(coverage.r, coverage.g), coverage.b);
  gl_FragColor = vec4(colour.rgb, alpha);
}`;

/**
 * A small, deliberately optional player. It is absent from the fake Pixi/unit-test contexts and is enabled by
 * render/app.js only when the local extracted VFX directory is present.
 */
export class OriginalVfxPlayer {
  constructor({ P, layers, cam, view, root = DEFAULT_ROOT }) {
    this.P = P;
    this.layers = layers;
    this.cam = cam;
    this.view = typeof view === 'function' ? view : () => null;
    this.root = String(root || DEFAULT_ROOT).replace(/\/$/, '');
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

  _manifest() {
    if (this.manifest) return Promise.resolve(this.manifest);
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(`${this.root}/index.json`, { cache: 'force-cache' })
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
    const atlasUrl = `${this.root}/${encodeURIComponent(prefab)}/atlas.webp`;
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
    const entry = { meta, base, textures, cellW, cellH, fps: Math.max(1, asFinite(meta.fps, 30)), originX: asFinite(meta.originPx?.[0], cellW / 2), originY: asFinite(meta.originPx?.[1], cellH) };
    this.entries.set(prefab, entry);
    return entry;
  }

  play(prefab, { x = 0, y = 0, z = 0, scale = 1, followId = null, group = null, loop = false, life = null, delay = 0, anchor = 'ground', bone = null, mirror = false, offsetZ = 0 } = {}) {
    if (!prefab || typeof document === 'undefined' || !this.P?.Sprite) return false;
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
      const sprite = new this.P.Sprite(entry.textures[0]);
      const logical = framePlacement(entry);
      sprite.anchor.set(logical.anchorX, logical.anchorY);
      if (this.P.Filter) {
        sprite.filters = [new this.P.Filter(undefined, FRAME_FRAG)];
      }
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
    (this.layers.groundFx || this.layers.fxNormal || this.layers.fxAdd).addChild(record.graphics);
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
    (this.layers.groundFx || this.layers.fxNormal || this.layers.fxAdd).addChild(record.graphics);
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
    // The shader maps the packed pair back to one logical frame.  The sprite
    // geometry is therefore scaled by `s` (not `s/2`); the old factor halved
    // the effect and, together with the packed anchor, put hits behind the
    // target/operator.
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
    const cells = localGrid.map(([dr, dc]) => { const [rr, cc] = rotate(dr, dc); return [tx + rr, ty + cc]; });
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
    const edges = [
      [[-q, -q], [q, -q], [0, -1]], [[q, -q], [q, q], [1, 0]],
      [[q, q], [-q, q], [0, 1]], [[-q, q], [-q, -q], [-1, 0]],
    ];
    for (const [cx, cy] of cells) {
      for (const [[a, b], [c, d], [ndr, ndc]] of edges) {
        if (seen.has(`${cx + ndr},${cy + ndc}`)) continue;
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
      if (!record.ready || record.elapsed < record.delay) { if (record.sprite) record.sprite.visible = false; continue; }
      record.sprite.visible = true;
      const entry = record.entry;
      const playTime = record.elapsed - record.delay;
      const frame = Math.floor(playTime * entry.fps);
      const duration = entry.textures.length / entry.fps;
      const maxLife = record.life == null ? duration : Math.max(0, Number(record.life));
      if (!record.loop && playTime >= maxLife) { this._remove(record); continue; }
      const index = record.loop ? frame % entry.textures.length : Math.min(frame, entry.textures.length - 1);
      record.sprite.texture = entry.textures[index];
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
  destroy() { this.clear(); this.entries.clear(); this.missing.clear(); this.requested.clear(); this.loaded.clear(); this.procedural.clear(); this.unresolved.clear(); this.manifest = null; this.manifestPromise = null; }
}
