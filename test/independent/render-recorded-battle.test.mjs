import test from 'node:test';
import assert from 'node:assert/strict';
import { frameFeedWindow, gameTimeAtWallSeconds, gameTimeFromCountdown, recordedAnimationRate, feedNativeFrames, replayClock, createReplayTimeMapper } from '../../public/js/independent/renderRecordedBattle.js';

test('feed window includes ordered snapshots through target and one interpolation lookahead', () => {
  const frames = [0.1, 0.2, 0.3, 0.4].map((t) => ({ snap: { t }, ev: [] }));
  const result = frameFeedWindow(frames, 0.25);
  assert.deepEqual(result.frames.map((f) => f.snap.t), [0.1, 0.2, 0.3]);
  assert.equal(result.nextIndex, 3);
});

test('continuous 30fps feed at 2x/4x advances only to the right-bracketing snapshot', () => {
  const frames = Array.from({ length: 401 }, (_, i) => ({ snap: { t: i / 10 }, ev: [] }));
  for (const rate of [2, 4]) {
    let index = 0;
    let previousIndex = 0;
    for (let i = 0; i <= 150; i++) {
      const gameTime = i * rate / 30;
      const result = frameFeedWindow(frames, gameTime, index);
      index = result.nextIndex;
      if (result.frames.length) {
        const lastPushedT = result.frames.at(-1).snap.t;
        assert.ok(lastPushedT >= gameTime || Math.abs(lastPushedT - gameTime) < 1e-9,
          `rate=${rate} frame=${i} pushed=${lastPushedT} gt=${gameTime}`);
        assert.ok(lastPushedT <= gameTime + 0.1000001,
          `rate=${rate} frame=${i} fed too far ahead: ${lastPushedT} > ${gameTime}`);
      }
      assert.ok(index - previousIndex <= 2, `rate=${rate} frame=${i} consumed ${index - previousIndex}`);
      previousIndex = index;
    }
    assert.ok(index <= (rate === 2 ? 103 : 203));
    assert.ok(index >= (rate === 2 ? 100 : 200), `rate=${rate} feed lagged unexpectedly: ${index}`);
  }
});

test('wall clock mapping honors explicit rate and rejects invalid values', () => {
  assert.equal(gameTimeAtWallSeconds(5, { originGameTime: 0, rate: 2 }), 10);
  assert.throws(() => gameTimeAtWallSeconds(-1), /invalid replay clock/);
});

test('native replay clock uses first and last snapshot timestamps, not summary duration', () => {
  assert.deepEqual(replayClock({ duration: 108.1, frames: [{ snap: { t: 0.1 } }, { snap: { t: 108.1 } }] }),
    { t0: 0.1, duration: 108, end: 108.1 });
});

test('R1 preserves initial 2x clock then applies its observed ×2 speed selection as native 4x', () => {
  const round = { startSecond: 10, endSecond: 23.3, observations: [
    { at: 10, remaining: 0 }, { at: 10.1, remaining: 33 }, { at: 11.1, remaining: 31 },
    { at: 20, remaining: 13 }, { at: 23.3, remaining: 0 },
  ], uiActions: [{ at: 20, kind: 'speed-select', target: { text: '×2' } }] };
  const replay = { frames: [{ snap: { t: 0.1 } }, { snap: { t: 33.1 } }] };
  const map = createReplayTimeMapper(round, replay);
  assert.equal(map.initialRate, 2);
  assert.equal(map.at(10.1), 0.1);
  assert.ok(Math.abs(map.at(11.1) - 2.1) < 1e-9);
  assert.deepEqual(map.speedChanges, [{ at: 20, rate: 4 }]);
  assert.ok(Math.abs(map.at(21) - 23.9) < 1e-8);
  assert.equal(map.at(23.3), 33.1);
  assert.ok(Math.abs(map.calibration - 1) < 1e-9);
});

test('piecewise mapper applies repeated native 2x/4x/8x selections despite countdown plateaus', () => {
  const round = { startSecond: 0, endSecond: 50, observations: [
    { at: 0, remaining: 0 }, { at: 0.1, remaining: 100 }, { at: 0.5, remaining: 100 },
    { at: 1.1, remaining: 96 }, { at: 2.1, remaining: 92 }, { at: 50, remaining: 0 },
  ], uiActions: [10, 20, 30, 40].map((at, i) => ({ at, kind: 'speed-select', target: { text: ['×4', '×1', '×2', '×4'][i] } })) };
  const replay = { frames: [{ snap: { t: 0.1 } }, { snap: { t: 259.7 } }] };
  const map = createReplayTimeMapper(round, replay);
  assert.equal(map.initialRate, 4);
  assert.deepEqual(map.speedChanges.map((x) => x.rate), [8, 2, 4, 8]);
  assert.ok(Math.abs(map.at(15) - 79.7) < 1e-8);
  assert.ok(Math.abs(map.at(25) - 129.7) < 1e-8);
  assert.ok(Math.abs(map.at(35) - 159.7) < 1e-8);
  assert.equal(map.at(50), replay.frames.at(-1).snap.t);
});

test('skip-to-end clamps exactly at last native snapshot and does not scale prior time', () => {
  const round = { startSecond: 0, endSecond: 10, observations: [
    { at: 0, remaining: 0 }, { at: 0.1, remaining: 40 }, { at: 1.1, remaining: 36 }, { at: 9.9, remaining: 4 },
  ], uiActions: [{ at: 10, kind: 'skip-to-end', target: { testid: 'ix-skip' } }] };
  const replay = { frames: [{ snap: { t: 0.1 } }, { snap: { t: 40.1 } }] };
  const map = createReplayTimeMapper(round, replay);
  assert.equal(map.initialRate, 4);
  assert.equal(map.calibration, 1);
  assert.ok(Math.abs(map.at(9.9) - 39.3) < 1e-8);
  assert.equal(map.at(10), 40.1);
  assert.equal(map.at(11), 40.1);
});

test('same countdown values do not pause the integrated native replay clock', () => {
  const round = { startSecond: 0, endSecond: 5.1, observations: [
    { at: 0.1, remaining: 20 }, { at: 0.5, remaining: 20 }, { at: 1.1, remaining: 16 },
    { at: 2.1, remaining: 12 }, { at: 5.1, remaining: 0 },
  ], uiActions: [] };
  const replay = { frames: [{ snap: { t: 0.1 } }, { snap: { t: 20.1 } }] };
  const map = createReplayTimeMapper(round, replay);
  assert.equal(map.initialRate, 4);
  assert.ok(Math.abs((map.at(1.5) - map.at(0.5)) - 4) < 1e-8);
  assert.equal(map.at(5.1), 20.1);
});

test('timeline mapping uses observed countdown anchors and ignores initial zero transition', () => {
  const round = { observations: [
    { at: 20, remaining: 0 }, { at: 20.01, remaining: 177 }, { at: 20.2, remaining: 176 },
    { at: 20.5, remaining: 175 }, { at: 20.6, remaining: 0 },
  ] };
  assert.equal(gameTimeFromCountdown(round, 20.01, 177), 0);
  assert.equal(gameTimeFromCountdown(round, 20.105, 177), 0.5);
  assert.equal(gameTimeFromCountdown(round, 20.35, 177), 1.5);
  assert.equal(gameTimeFromCountdown(round, 20.6, 177), 177);
});

test('animation rate follows game-time delta and large skip keeps prior speed', () => {
  assert.ok(Math.abs(recordedAnimationRate(1, 1 + 4 / 30, 30) - 4) < 1e-9);
  assert.equal(recordedAnimationRate(1, 1, 30), 0);
  assert.equal(recordedAnimationRate(1, 5, 30, 4), 4);
});

test('native feed dispatches each frame events before its snapshot', () => {
  const seen = [];
  feedNativeFrames({ pushEvents: (e) => seen.push(['events', e.gt]), pushSnapshot: (s) => seen.push(['snapshot', s.t]) },
    [{ snap: { t: 0.1 }, ev: [['spawn', { id: 3 }]] }, { snap: { t: 0.2 }, ev: [] }], 'f');
  assert.deepEqual(seen, [['events', 0.1], ['snapshot', 0.1], ['snapshot', 0.2]]);
});
