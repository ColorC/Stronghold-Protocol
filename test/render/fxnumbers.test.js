import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxSystem } from '../../public/js/render/fx.js';
import { presetCamera } from '../../public/js/render/projection.js';

class FakeText {
  constructor(text) {
    this.text = text;
    this.visible = true;
    this.alpha = 1;
    this.anchor = { set() {} };
    this.scale = { x: 1, set(v) { this.x = v; } };
    this.position = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } };
  }
  destroy() { this.destroyed = true; }
}

function fakeFx(cam) {
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, {
    P: { BitmapText: FakeText },
    ctx: { cam: () => cam, layers: { text: { addChild() {} } }, settings: {} },
    nums: [], numFree: [], time: 0,
    _p: { x: 0, y: 0, s: 0, depth: 0 }, _q: { x: 0, y: 0, s: 0, depth: 0 },
  });
  return fx;
}
const step = (fx, dt = 1 / 60) => { fx._updateNums(dt); fx.time += dt; };

describe('FxSystem damage numbers follow native popups', () => {
  const cam = presetCamera('normal', { width: 1600, height: 900 });

  test('one hit makes one number; rapid hits are neither merged nor repositioned to avoid overlap', () => {
    const fx = fakeFx(cam);
    const u = { id: 1, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 3000 };
    fx.number(u, 41, 'arts', null);
    fx.number(u, 509, 'phys', null);
    assert.equal(fx.nums.length, 2);
    assert.deepEqual(fx.nums.map((n) => n.text.text), ['41', '509']);
    assert.equal(fx.nums[0].end, 1.5);
    assert.equal(fx.nums[1].end, 1.57);
    assert.equal(fx.nums[0].text.scale.x, fx.nums[1].text.scale.x);
    assert.equal(fx.nums.some((n) => n.fading), false);
    assert.equal(fx.nums.some((n) => n.tier), false);
  });

  test('physical / arts / true hits use the row 11 path and source alpha duration', () => {
    const fx = fakeFx(cam);
    const u = { id: 1, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 3000 };
    fx.number(u, 123, 'arts', { src: { id: 2, x: 3, y: 9, z: 0 } });
    assert.equal(fx.nums[0].path.move, 0.5);
    assert.equal(fx.nums[0].direction, 1);
    step(fx, 0.25);
    assert.ok(fx.nums[0].text.position.x > cam.project(7, 9, 0).x);
    assert.ok(fx.nums[0].text.alpha > 0.8);
    step(fx, 0.26);
    assert.equal(fx.nums[0].text.alpha, 0);
    assert.equal(fx.nums.length, 1, 'source row keeps the popup for its 1.5 s total lifetime');
  });

  test('heals and labels use row 9; heals keep the leading plus and cannot be crits', () => {
    const fx = fakeFx(cam);
    const u = { id: 3, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 5000 };
    fx.number(u, 50, 'heal', { crit: true });
    fx.number(u, 0, 'true', { label: 'MISS' });
    assert.equal(fx.nums[0].text.text, '+50');
    assert.equal(fx.nums[0].crit, false);
    assert.equal(fx.nums[0].path.move, 1);
    assert.equal(fx.nums[1].text.text, 'MISS');
    assert.equal(fx.nums[1].path.move, 1);
  });

  test('crit markers work before or after the hit and use row 5 plus the native punch', () => {
    for (const critFirst of [true, false]) {
      const fx = fakeFx(cam);
      const u = { id: 5, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 5000 };
      if (critFirst) fx._onCrit(7, 9, 99);
      fx.number(u, 321, 'phys', null);
      if (!critFirst) fx._onCrit(7, 9, 99);
      assert.equal(fx.nums.length, 1);
      assert.equal(fx.nums[0].crit, true);
      assert.equal(fx.nums[0].text.text, '321!');
      assert.equal(fx.nums[0].path.move, 0.1);
      step(fx, 1 / 60);
      assert.ok(fx.nums[0].text.scale.x > 2.5, `native critical pop: ${fx.nums[0].text.scale.x}`);
    }
  });

  test('numbers on separate units remain independent and may naturally overlap', () => {
    const fx = fakeFx(cam);
    const a = { id: 1, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 5000 };
    const b = { id: 2, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 5000 };
    fx.number(a, 41, 'arts', null);
    fx.number(b, 509, 'phys', null);
    step(fx, 1 / 60);
    assert.equal(fx.nums.length, 2);
    assert.equal(fx.nums.some((n) => n.fading), false);
    assert.ok(Math.abs(fx.nums[0].text.position.x - fx.nums[1].text.position.x) < 60, 'only source jitter and per-hit delay separate them');
  });

  test('numbers are pooled after source lifetime without shortening crowded popups', () => {
    const fx = fakeFx(cam);
    const u = { id: 1, x: 7, y: 9, z: 0, _headTiles: 1.2, maxHp: 5000 };
    for (let i = 0; i < 8; i++) fx.number(u, i + 1, 'phys', null);
    assert.ok(fx.nums.every((n) => n.end >= 1.5));
    for (let i = 0; i < 110; i++) step(fx, 1 / 60);
    assert.equal(fx.nums.length, 0);
    assert.ok(fx._numPools.size > 0);
  });
});
