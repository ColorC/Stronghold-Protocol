import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../public/js/render/projection.js';
import { SnapshotBuffer, normalizeSnapshot } from '../../public/js/render/interp.js';
import { detailHash } from '../../public/js/resonance/model.js';
import {
  activeDynamicFloors, floorTilePolygon, normalizeDynamicFloors, normalizeStaticFloors, resonanceFloorStyle,
  ResonanceFloorRenderer,
} from '../../public/js/render/resonanceFloors.js';

test('static field floors are deduplicated, grid-bounded, and absent legacy metadata stays empty', () => {
  assert.deepEqual(normalizeStaticFloors(undefined), []);
  assert.deepEqual(normalizeStaticFloors([[9, 2], [9, 2], [-1, 2], [9, 21], [1.5, 2], null]), [[9, 2]]);
});

test('dynamic snapshot protocol keeps compact bounded regions and expires on game time', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ id: `f${i}`, kind: i === 0 ? 'firewall' : 'sound', owner: 'p1', tiles: [[9, i]], until: 8 }));
  rows.push({ id: 'broken', kind: 'sun', tiles: [[-1, 0]], until: 9 });
  const normalized = normalizeDynamicFloors(rows);
  assert.equal(normalized.length, 12);
  assert.deepEqual(normalized[0], { id: 'f0', kind: 'firewall', owner: 'p1', tiles: [[9, 0]], until: 8 });
  assert.equal(activeDynamicFloors(normalized, 7.99).length, 12);
  assert.deepEqual(activeDynamicFloors(normalized, 8), []);
  assert.equal(resonanceFloorStyle('snow').color, 0x9fe8ff);
  assert.notEqual(resonanceFloorStyle('planting').color, resonanceFloorStyle('firewall').color);
});

test('normalized snapshots carry floor metadata while old snapshots clear it at their timeline position', () => {
  assert.deepEqual(normalizeSnapshot({ t: 1, units: [] }).resonanceFloors, []);
  const buffer = new SnapshotBuffer();
  buffer.push({ t: 1, units: [], resonanceFloors: [{ id: 'sun:1', kind: 'sun', owner: 3, tiles: [[10, 4]], until: 3 }] }, 0);
  buffer.push({ t: 2, units: [] }, 0.5);
  assert.equal(buffer.resonanceFloorsAt(1.5)[0].id, 'sun:1');
  assert.deepEqual(buffer.resonanceFloorsAt(2), []);
  buffer.reset();
  assert.deepEqual(buffer.resonanceFloorsAt(2), []);
});

test('tile polygons use the shared camera projection and raised tile height in both board modes', () => {
  const camera = new Camera({ tx: 5, ty: 10, tilt: 30, dist: 16, scale: 60, cx: 320, cy: 180 });
  const raised = (row, col) => row === 10 && col === 4 ? 0.42 : 0;
  const polygon = floorTilePolygon(camera, raised, 10, 4);
  assert.equal(polygon.length, 4);
  const expected = [[3.56, 10.44], [4.44, 10.44], [4.44, 9.56], [3.56, 9.56]]
    .map(([x, y]) => camera.project(x, y, 0.445))
    .map(({ x, y }) => [x, y]);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(polygon[i][0] - expected[i][0]) < 1e-9);
    assert.ok(Math.abs(polygon[i][1] - expected[i][1]) < 1e-9);
  }
});

test('floor overlay reuses its graphics and clears expired or legacy-field effects', () => {
  class Graphics {
    constructor() { this.shapes = 0; this.clears = 0; this.parent = null; }
    clear() { this.shapes = 0; this.clears++; }
    lineStyle() {} beginFill() {} endFill() {}
    drawPolygon() { this.shapes++; } drawCircle() { this.shapes++; }
    moveTo() {} lineTo() {}
    destroy() { this.destroyed = true; }
  }
  const PIXI = { Graphics };
  const overlay = { children: [], addChildAt(child, index) { child.parent = this; this.children.splice(index, 0, child); }, removeChild(child) { this.children = this.children.filter(x => x !== child); child.parent = null; } };
  const renderer = new ResonanceFloorRenderer(PIXI, overlay);
  const graphic = renderer.gfx, camera = new Camera({ tx: 5, ty: 10, tilt: 30, dist: 16, scale: 60, cx: 320, cy: 180 });
  renderer.setStatic([[10, 4]]);
  renderer.setDynamic([{ id: 'wall', kind: 'firewall', tiles: [[10, 5]], until: 4 }]);
  renderer.update(2, camera, () => 0, () => true);
  assert.equal(renderer.gfx, graphic, 'same Pixi graphics object is retained');
  assert.ok(graphic.shapes > 0);
  const draws = graphic.clears;
  renderer.update(2.5, camera, () => 0, () => true);
  assert.equal(graphic.clears, draws, 'unchanged floor state does not redraw per frame');
  renderer.update(4, camera, () => 0, () => true);
  assert.ok(graphic.shapes > 0, 'static snow remains after the dynamic wall expires');
  renderer.setStatic(undefined); renderer.setDynamic(undefined);
  renderer.update(5, camera, () => 0, () => true);
  assert.equal(graphic.shapes, 0, 'a later field without metadata removes all previous floors');
  renderer.destroy();
  assert.equal(overlay.children.length, 0);
  assert.equal(graphic.destroyed, true);
});

test('a member fragment preserves the session uid for direct field-card location', () => {
  assert.equal(detailHash('member', 'p42'), '#member-p42');
  assert.equal(detailHash('member', 'piece/42'), '#member-piece%2F42');
});
