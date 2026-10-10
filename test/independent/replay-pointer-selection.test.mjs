import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mapViewportRectToOverlay, selectionAt } from '../../public/js/recording/selectionTimeline.js';

test('selection set and clear events are visible only in their recorded time interval', () => {
  const events = [
    { at: 12.4, p: { operation: 'set', rects: [{ x: 100, y: 80, width: 90, height: 24 }] } },
    { at: 12.43, p: { operation: 'clear', rects: [] } },
  ];
  assert.equal(selectionAt(events, 12.399), null);
  assert.equal(selectionAt(events, 12.4), events[0]);
  assert.equal(selectionAt(events, 12.429), events[0]);
  assert.equal(selectionAt(events, 12.43), null);
  assert.equal(selectionAt(events, 12.41), events[0], 'seeking backward restores the prior selection');
});

test('recorded selection rectangles map through frame and container CSS scale', () => {
  const containerRect = { left: 0, top: 0, width: 1600, height: 788.75 };
  const container = { clientWidth: 1600, clientHeight: 788.75, clientLeft: 0, clientTop: 0 };
  const frameRect = { left: 0, top: 0, width: 1600, height: 788.75 };
  const viewport = { width: 2187, height: 1077 };
  const mapped = mapViewportRectToOverlay({ x: 1093.5, y: 538.5, width: 100, height: 50 }, frameRect, containerRect, viewport, container);
  assert.ok(Math.abs(mapped.x - 800) < 0.01);
  assert.ok(Math.abs(mapped.y - 394.375) < 0.01);
  assert.ok(Math.abs(mapped.width - (1600 * 100 / 2187)) < 0.01);
  assert.ok(Math.abs(mapped.height - (788.75 * 50 / 1077)) < 0.01);

  const cssScaledContainer = { clientWidth: 1200, clientHeight: 591.5625, clientLeft: 0, clientTop: 0 };
  const scaled = mapViewportRectToOverlay({ x: 1093.5, y: 538.5, width: 100, height: 50 }, frameRect, containerRect, viewport, cssScaledContainer);
  assert.ok(Math.abs(scaled.x * 1.333333 - mapped.x) < 0.01);
  assert.ok(Math.abs(scaled.y * 1.333333 - mapped.y) < 0.01);
});

test('replay uses a black-white arrow and paints only in-place selection rectangles', async () => {
  const css = await readFile(new URL('../../public/css/independent-recording.css', import.meta.url), 'utf8');
  const replay = await readFile(new URL('../../public/js/independent/replay.js', import.meta.url), 'utf8');
  assert.match(css, /\.replayer-mouse::after\{display:none\}/);
  assert.match(css, /fill='%23000' stroke='%23fff'/);
  assert.doesNotMatch(css, /ix-replay__text-selection-label/);
  assert.doesNotMatch(replay, /text-selection-label|current\.p\.text/);
  assert.match(replay, /function position\(second\)[\s\S]*paintTextSelection\(second\)/);
  assert.match(replay, /mapViewportRectToOverlay\(rect, bounds, containerRect, viewport, container\)/);
});
