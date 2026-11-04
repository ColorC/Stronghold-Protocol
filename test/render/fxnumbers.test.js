// Native popup-row motion/timing as consumed by the modular Assault renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxSystem } from '../../public/js/render/fx.js';
import { POPUP_ROWS, popupWaypoints, popupPosition } from '../../public/js/render/dmgNumbers.js';
import { presetCamera } from '../../public/js/render/projection.js';

class FakeText {
  constructor(text) { this.text = text; this.visible = true; this.alpha = 1; this.anchor = { set() {} }; this.scale = { set(v) { this.value = v; } }; this.position = { set(x, y) { this.x = x; this.y = y; } }; }
  destroy() { this.destroyed = true; }
}
function fxHarness() {
  const cam = presetCamera('normal', { width: 1280, height: 720 });
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, { P: { BitmapText: FakeText }, ctx: { cam: () => cam, layers: { text: { addChild() {} } }, settings: {} }, nums: [], _numPools: new Map(), time: 0, _p: {}, _q: {} });
  return fx;
}

test('popup rows match registered native damage, critical, and healing trajectories', () => {
  assert.equal(POPUP_ROWS.damage.id, 11); assert.equal(POPUP_ROWS.crit.id, 5); assert.equal(POPUP_ROWS.heal.id, 9);
  for (const kind of ['damage', 'crit', 'heal']) {
    const a = popupWaypoints(kind, 41), b = popupWaypoints(kind, 41);
    assert.deepEqual(a, b, `${kind} generation is deterministic`);
    assert.equal(a.points.length, 10); assert.equal(a.total, 1.5);
    if (kind !== 'crit') assert.notDeepEqual(popupPosition(a, 0.05), popupPosition(a, a.move));
  }
});

test('damage and DOT styles follow native 1.5s popup lifetime; crit and heal retain native forms', () => {
  const fx = fxHarness(), unit = { id: 7, x: 8, y: 9, z: 0, maxHp: 1000 };
  fx.number(unit, 123, 'phys'); fx.number(unit, 9, 'dot');
  assert.equal(fx.nums.length, 2);
  assert.ok(fx.nums.every((n) => n.kind === 'damage' && n.end >= 1.5 && n.end <= 1.64));
  const start = fx.nums[0].text.position.x;
  fx._updateNums(0.25);
  assert.notEqual(fx.nums[0].text.position.x, start);
  assert.ok(Math.abs(fx.nums[0].text.alpha - 0.9) < 0.02);
  fx.number(unit, 50, 'phys', { crit: true });
  const crit = fx.nums.at(-1);
  assert.equal(crit.kind, 'crit'); assert.equal(crit.end, 1.5);
  fx._updateNums(0);
  assert.equal(crit.text.alpha, 0);
  fx._updateNums(0.02);
  assert.ok(crit.text.alpha > 0.9);
  fx.number(unit, 15, 'heal');
  const heal = fx.nums.at(-1);
  assert.equal(heal.kind, 'heal'); assert.equal(heal.text.text, '+15');
  fx._updateNums(1.5);
  assert.ok(!fx.nums.includes(heal));
});
