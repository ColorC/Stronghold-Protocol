import { GEO } from '../../../shared/constants.js';

const ROWS = GEO.ROWS, COLS = GEO.COLS;
const FLOOR_LIMIT = 12;
const STYLES = Object.freeze({
  snow: { color: 0x9fe8ff, alpha: 0.3, line: 0xd9f8ff, mark: 'snow' },
  quicksand: { color: 0xd99b38, alpha: 0.34, line: 0xffd27a, mark: 'sand' },
  sound: { color: 0xa77aff, alpha: 0.3, line: 0xe3d0ff, mark: 'sound' },
  sun: { color: 0xffc83d, alpha: 0.35, line: 0xfff1a8, mark: 'sun' },
  firewall: { color: 0xf04427, alpha: 0.42, line: 0xffb04a, mark: 'fire' },
  planting: { color: 0x60b95b, alpha: 0.32, line: 0xc7f39d, mark: 'plant' },
});
const FALLBACK_STYLE = Object.freeze({ color: 0x65d5c8, alpha: 0.28, line: 0xc5fff4, mark: 'generic' });
const validTile = (r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < ROWS && c >= 0 && c < COLS;

/** Battle.fieldMeta's one-time board-wide floor list: [[row, col], ...]. */
export function normalizeStaticFloors(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(), out = [];
  for (const tile of value) {
    if (!Array.isArray(tile) || !validTile(tile[0], tile[1])) continue;
    const key = `${tile[0]},${tile[1]}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push([tile[0], tile[1]]);
  }
  return out;
}

/** Compact snapshot floor records. The battle contract bounds the list to twelve active regions. */
export function normalizeDynamicFloors(value) {
  if (!Array.isArray(value)) return [];
  const out = [], ids = new Set();
  for (const floor of value) {
    if (out.length >= FLOOR_LIMIT) break;
    if (!floor || typeof floor !== 'object' || Array.isArray(floor) || typeof floor.id !== 'string' || !floor.id ||
      typeof floor.kind !== 'string' || !floor.kind || !Number.isFinite(floor.until) || ids.has(floor.id)) continue;
    const tiles = normalizeStaticFloors(floor.tiles);
    if (!tiles.length) continue;
    ids.add(floor.id);
    const owner = typeof floor.owner === 'string' || Number.isFinite(floor.owner) ? floor.owner : null;
    out.push({ id: floor.id, kind: floor.kind, owner, tiles, until: floor.until });
  }
  return out;
}

export function activeDynamicFloors(value, time) {
  if (!Number.isFinite(time)) return [];
  return normalizeDynamicFloors(value).filter((floor) => floor.until > time);
}

/** Tile-level floor lookup shared by simplified renderers that cannot use the projected Pixi overlay. */
export function resonanceFloorsForTile(staticValue, dynamicValue, time, row, col) {
  const staticFloor = normalizeStaticFloors(staticValue).some(([r, c]) => r === row && c === col);
  const dynamic = activeDynamicFloors(dynamicValue, time)
    .filter((floor) => floor.tiles.some(([r, c]) => r === row && c === col));
  return { static: staticFloor, dynamic };
}

/** Pre-index overlays for a flat DOM board so each tile avoids re-normalizing the protocol. */
export function resonanceFloorTileIndex(staticValue, dynamicValue, time) {
  const tiles = new Map();
  const entry = (row, col) => {
    const key = `${row},${col}`;
    let value = tiles.get(key);
    if (!value) { value = { static: false, dynamic: [] }; tiles.set(key, value); }
    return value;
  };
  for (const [row, col] of normalizeStaticFloors(staticValue)) entry(row, col).static = true;
  for (const floor of activeDynamicFloors(dynamicValue, time)) {
    for (const [row, col] of floor.tiles) entry(row, col).dynamic.push(floor);
  }
  return tiles;
}

/** World-projected top corners shared by the Pixi overlay and the board's 2D/3D camera. */
export function floorTilePolygon(cam, heightAt, row, col, inset = 0.06) {
  if (!cam || !validTile(row, col)) return null;
  const z = (typeof heightAt === 'function' ? Number(heightAt(row, col)) || 0 : 0) + 0.025;
  const a = Math.max(0, Math.min(0.45, inset));
  const corners = [[-0.5 + a, 0.5 - a], [0.5 - a, 0.5 - a], [0.5 - a, -0.5 + a], [-0.5 + a, -0.5 + a]];
  const points = corners.map(([dx, dy]) => {
    const p = cam.project(col + dx, row + dy, z);
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? [p.x, p.y] : null;
  });
  return points.every(Boolean) ? points : null;
}

export function resonanceFloorStyle(kind) { return STYLES[kind] || FALLBACK_STYLE; }

function drawMark(g, mark, x, y, s, color, alpha) {
  const r = Math.max(2, s * 0.12), lw = Math.max(1, s * 0.025);
  g.lineStyle(lw, color, alpha);
  if (mark === 'snow') {
    for (const a of [0, Math.PI / 3, -Math.PI / 3]) {
      const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
      g.moveTo(x - dx, y - dy); g.lineTo(x + dx, y + dy);
    }
  } else if (mark === 'sand') {
    g.moveTo(x - r, y + r * 0.35); g.lineTo(x - r * 0.35, y - r * 0.35);
    g.moveTo(x - r * 0.1, y + r * 0.45); g.lineTo(x + r * 0.55, y - r * 0.25);
  } else if (mark === 'sound') {
    g.drawCircle(x, y, r * 0.25); g.drawCircle(x, y, r * 0.72); g.drawCircle(x, y, r * 1.2);
  } else if (mark === 'sun') {
    g.drawCircle(x, y, r * 0.45);
    for (const a of [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4]) {
      const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
      g.moveTo(x - dx, y - dy); g.lineTo(x + dx, y + dy);
    }
  } else if (mark === 'fire') {
    g.moveTo(x - r, y + r * 0.6); g.lineTo(x - r * 0.3, y - r * 0.6); g.lineTo(x + r * 0.1, y + r * 0.2); g.lineTo(x + r * 0.65, y - r * 0.55);
  } else if (mark === 'plant') {
    g.moveTo(x, y + r); g.lineTo(x, y - r * 0.55);
    g.moveTo(x, y); g.lineTo(x - r * 0.65, y - r * 0.45);
    g.moveTo(x, y - r * 0.2); g.lineTo(x + r * 0.65, y - r * 0.7);
  } else {
    g.drawCircle(x, y, r * 0.65);
  }
}

/** Reused Pixi overlay; floor graphics sit below tile highlights and units, above either board renderer. */
export class ResonanceFloorRenderer {
  constructor(PIXI, overlay) {
    this.gfx = new PIXI.Graphics();
    overlay.addChildAt(this.gfx, 0);
    this.staticFloors = [];
    this.dynamicFloors = [];
    this.staticKey = '';
    this.dynamicKey = '';
    this.lastDrawKey = '';
    this.destroyed = false;
  }

  setStatic(value) {
    const floors = normalizeStaticFloors(value);
    const key = floors.map(([r, c]) => `${r},${c}`).join('|');
    if (key === this.staticKey) return false;
    this.staticFloors = floors; this.staticKey = key; this.lastDrawKey = '';
    return true;
  }

  setDynamic(value) {
    const floors = normalizeDynamicFloors(value);
    const key = floors.map((f) => `${f.id}:${f.kind}:${f.owner ?? ''}:${f.until}:${f.tiles.map(([r, c]) => `${r},${c}`).join(';')}`).join('|');
    if (key === this.dynamicKey) return false;
    this.dynamicFloors = floors; this.dynamicKey = key; this.lastDrawKey = '';
    return true;
  }

  clear() {
    this.staticFloors = []; this.dynamicFloors = [];
    this.staticKey = ''; this.dynamicKey = ''; this.lastDrawKey = '';
    this.gfx.clear();
  }

  invalidate() { this.lastDrawKey = ''; }

  update(time, cam, heightAt, isDrawn = () => true) {
    if (this.destroyed) return;
    const active = activeDynamicFloors(this.dynamicFloors, time);
    const activeKey = active.map((f) => `${f.id}:${f.kind}:${f.until}`).join('|');
    const key = `${this.staticKey}#${activeKey}#${cam?.version ?? ''}`;
    if (key === this.lastDrawKey) return;
    this.lastDrawKey = key;
    const g = this.gfx;
    g.clear();
    if (!cam) return;
    for (const [r, c] of this.staticFloors) this._drawTile(g, 'snow', r, c, cam, heightAt, isDrawn);
    for (const floor of active) for (const [r, c] of floor.tiles) this._drawTile(g, floor.kind, r, c, cam, heightAt, isDrawn);
  }

  _drawTile(g, kind, row, col, cam, heightAt, isDrawn) {
    if (!isDrawn(row, col)) return;
    const points = floorTilePolygon(cam, heightAt, row, col);
    if (!points) return;
    const style = resonanceFloorStyle(kind), flat = points.flat();
    g.lineStyle(1, style.line, 0.72);
    g.beginFill(style.color, style.alpha); g.drawPolygon(flat); g.endFill();
    const center = cam.project(col, row, (typeof heightAt === 'function' ? Number(heightAt(row, col)) || 0 : 0) + 0.035);
    if (center) drawMark(g, style.mark, center.x, center.y, center.s || 18, style.line, 0.85);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gfx.parent?.removeChild(this.gfx);
    this.gfx.destroy();
    this.staticFloors = []; this.dynamicFloors = [];
  }
}
