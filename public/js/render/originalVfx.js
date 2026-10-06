// Optional original-client VFX playback. The extractor writes one atlas per Unity prefab under
// /assets/vfx/rosmon; this player turns the colour/coverage pair into premultiplied-alpha Pixi textures.

const DEFAULT_ROOT = '/assets/vfx/rosmon';

const asFinite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const FRAME_FRAG = `
precision mediump float;
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
  }

  _manifest() {
    if (this.manifest) return Promise.resolve(this.manifest);
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(`${this.root}/index.json`, { cache: 'force-cache' })
        .then((r) => { if (!r.ok) throw new Error(`original VFX manifest ${r.status}`); return r.json(); })
        .then((m) => {
          this.manifest = new Map((Array.isArray(m) ? m : []).filter((x) => x && x.prefab).map((x) => [x.prefab, x]));
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
    if (!meta) return null;
    const atlasUrl = `${this.root}/${encodeURIComponent(prefab)}/atlas.webp`;
    const base = this.P.BaseTexture.from(atlasUrl, { scaleMode: this.P.SCALE_MODES?.LINEAR });
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

  play(prefab, { x = 0, y = 0, z = 0, scale = 1, followId = null, group = null, loop = false, life = null, delay = 0 } = {}) {
    if (!prefab || typeof document === 'undefined' || !this.P?.Sprite) return false;
    const record = { prefab, x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0, scale: Number(scale) || 1, followId, group, loop, elapsed: 0, delay: Math.max(0, Number(delay) || 0), ready: false, dead: false, sprite: null, entry: null, life };
    this.active.add(record);
    this._entry(prefab).then((entry) => {
      if (record.dead || !entry) return;
      record.entry = entry;
      record.ready = true;
      const sprite = new this.P.Sprite(entry.textures[0]);
      sprite.anchor.set(entry.originX / (entry.cellW * 2), entry.originY / entry.cellH);
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

  stopGroup(group) {
    if (!group) return;
    for (const r of this.active) if (r.group === group) this._remove(r);
  }

  _place(record) {
    if (!record.sprite || !record.entry) return;
    const followed = record.followId == null ? null : this.view(record.followId);
    const x = followed?.x ?? record.x, y = followed?.y ?? record.y, z = followed?.z ?? record.z;
    const p = this.cam()?.project(x, y, z, {});
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    record.sprite.position.set(p.x, p.y);
    const s = Math.max(0.01, (p.s || 1) * record.scale / Math.max(1, record.entry.meta.pxPerUnit || 96));
    record.sprite.scale.set(s / 2, s);
    record.sprite.zIndex = Number.isFinite(p.depth) ? -p.depth : 0;
  }

  _remove(record) {
    if (record.dead) return;
    record.dead = true;
    this.active.delete(record);
    try { record.sprite?.destroy({ children: true }); } catch { /* optional */ }
  }

  update(dt) {
    const delta = Math.max(0, Number(dt) || 0);
    for (const record of [...this.active]) {
      if (record.dead) continue;
      record.elapsed += delta;
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

  clear() { for (const record of [...this.active]) this._remove(record); }
  destroy() { this.clear(); this.entries.clear(); this.manifest = null; this.manifestPromise = null; }
}
