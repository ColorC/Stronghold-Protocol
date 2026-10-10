import test from 'node:test';
import assert from 'node:assert/strict';
import { replayMediaClockSecond } from '../../public/js/independent/replayPlaybackClock.js';
const source = { key: 'rendered-12', at: 799.418, endSecond: 845.211, url: 'https://example.test/round/12' };
const sample = (video = {}, rest = {}) => replayMediaClockSecond({ second: 810, source, activeKey: source.key, duration: 1197, video: { currentSrc: source.url, readyState: 4, currentTime: 10.582, ended: false, ...video }, ...rest });
test('buffering and seeking use media time without skipping recorded UI ahead', () => {
  assert.equal(sample({ readyState: 1, currentTime: 11, seeking: true }), 810.418);
  assert.equal(sample({ currentTime: 13 }), 812.418);
});
test('an ended rendered clip advances to the next recorded interval despite frame rounding', () => {
  assert.equal(sample({ ended: true, currentTime: 45.8 }), source.endSecond);
  assert.equal(sample({ currentTime: 50 }), source.endSecond);
});
test('wrong or unloaded sources and the pre-media opening keep the DOM clock', () => {
  assert.equal(sample({}, { activeKey: 'rendered-1' }), null);
  assert.equal(sample({ currentSrc: 'https://example.test/old' }), null);
  assert.equal(sample({ readyState: 0 }), null);
  assert.equal(sample({}, { second: 0 }), null);
});
test('the original recording can end before final DOM events without locking playback', () => {
  const original = { key: 'original-0', at: 2.597, url: source.url };
  assert.equal(sample({ ended: true }, { source: original, activeKey: original.key }), null);
  assert.equal(sample({ currentTime: 1200 }, { source: original, activeKey: original.key }), 1197);
});
