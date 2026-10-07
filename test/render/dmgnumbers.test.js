import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_TEXT_SCALE, CRIT_ALPHA, CRIT_SCALE, DAMAGE_ALPHA, POPUP_ROWS, lerpKeys, popupAlpha, popupPosition, popupWaypoints,
} from '../../public/js/render/dmgNumbers.js';

describe('damage numbers mirror the registered iGame popup rows', () => {
  test('normal, crit and heal use SkillDamagePopup rows 11, 5 and 9', () => {
    assert.deepEqual([POPUP_ROWS.damage.id, POPUP_ROWS.damage.total, POPUP_ROWS.damage.move], [11, 1.5, 0.5]);
    assert.deepEqual([POPUP_ROWS.crit.id, POPUP_ROWS.crit.total, POPUP_ROWS.crit.move], [5, 1.5, 0.1]);
    assert.deepEqual([POPUP_ROWS.heal.id, POPUP_ROWS.heal.total, POPUP_ROWS.heal.move], [9, 1.5, 1]);
    assert.deepEqual(POPUP_ROWS.damage.velocity, [150, 132]);
    assert.deepEqual(POPUP_ROWS.damage.acceleration, [-250, -612]);
    assert.deepEqual(POPUP_ROWS.heal.points, [[0.3, 0, 0], [1, 0, 20]]);
  });

  test('row trajectories hold at their destination for the remaining 1.5 s lifetime', () => {
    for (const kind of ['damage', 'crit', 'heal']) {
      const path = popupWaypoints(kind, 19);
      assert.equal(path.total, 1.5);
      assert.equal(path.move, POPUP_ROWS[kind].move);
      assert.deepEqual(popupPosition(path, path.move), popupPosition(path, path.total));
      assert.deepEqual(popupPosition(path, 2), popupPosition(path, path.total));
    }
    const hit = popupWaypoints('damage', 1);
    assert.ok(popupPosition(hit, 0.5)[0] > 30, 'native row 11 reaches its ≈44 UI-unit lateral endpoint');
  });

  test('source prefab alpha and crit scale keyframes are retained; one smaller base size serves all values', () => {
    assert.equal(popupAlpha(false, 0), 1);
    assert.equal(popupAlpha(false, 0.5), 0);
    assert.equal(popupAlpha(true, 0), 0);
    assert.equal(popupAlpha(true, 0.433333), 1);
    assert.equal(popupAlpha(true, 0.75), 0);
    assert.equal(lerpKeys(CRIT_SCALE, 0), 3.505806);
    assert.equal(lerpKeys(CRIT_SCALE, 0.25), 1);
    assert.deepEqual(DAMAGE_ALPHA, [[0, 1], [0.25, 0.9], [0.5, 0]]);
    assert.deepEqual(CRIT_ALPHA, [[0, 0], [0.016667, 1], [0.433333, 1], [0.75, 0]]);
    assert.equal(BASE_TEXT_SCALE, 0.8);
  });
});
