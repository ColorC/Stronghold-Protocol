import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawRecordingCanvasFrame, recordingCanvasElements, recordingCanvasLayout } from '../../public/js/independent/recordingCanvas.js';

test('render exposes the frame signal after Pixi and the recorder samples it synchronously', () => {
  const renderer = readFileSync(new URL('../../public/js/render/app.js', import.meta.url), 'utf8');
  const recorder = readFileSync(new URL('../../public/js/independent/recorder.js', import.meta.url), 'utf8');
  assert.match(renderer, /const postRender = \(\) => \{[\s\S]*?emit\('framePainted'\);[\s\S]*?\};\s*app\.ticker\.add\(preRender, null, -24\);\s*app\.ticker\.add\(postRender, null, -26\);/);
  assert.match(recorder, /view\.on\('framePainted', \(\) => \{[\s\S]*?drawRecordingCanvasFrame\(state\.captureField, state\.frameCacheContext/);
  assert.match(recorder, /state\.startMediaCapture = \(\) => \{\s*const started = startRecordingMediaAtFirstCapture\(state, \{ paintCaptureFrame, requestFrame \}, mediaOptions\.timesliceMs\);/);
  assert.match(recorder, /captureRecordingMediaFrame\(state, \{ paintCaptureFrame, requestFrame \}\);/);
});

function canvas(width, height, bounds, { zIndex = 'auto', display = 'block', visibility = 'visible', opacity = '1' } = {}) {
  return { width, height, style: {}, getBoundingClientRect: () => ({ ...bounds }),
    computedStyle: { zIndex, display, visibility, opacity } };
}

function withField(entries, run) {
  const fieldBounds = { left: 10, top: 20, width: 320, height: 180, right: 330, bottom: 200 };
  const field = { querySelectorAll: () => entries.map((entry) => entry.canvas), getBoundingClientRect: () => fieldBounds };
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  globalThis.document = { querySelector: () => field, querySelectorAll: () => entries.map((entry) => entry.canvas) };
  globalThis.getComputedStyle = (item) => item.computedStyle;
  try { return run(field); }
  finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousGetComputedStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = previousGetComputedStyle;
  }
}

test('recording canvas composites visible render layers in stack order at the highest canvas DPR', () => {
  const board = canvas(320, 180, { left: 10, top: 20, width: 320, height: 180, right: 330, bottom: 200 }, { zIndex: '0' });
  const pixi = canvas(640, 360, { left: 10, top: 20, width: 320, height: 180, right: 330, bottom: 200 }, { zIndex: '1' });
  const hidden = canvas(640, 360, { left: 10, top: 20, width: 320, height: 180, right: 330, bottom: 200 }, { zIndex: '2', visibility: 'hidden' });
  withField([{ canvas: pixi }, { canvas: board }, { canvas: hidden }], (field) => {
    assert.deepEqual(recordingCanvasLayout(field), { width: 640, height: 360 });
    const draws = [];
    const context = { clearRect() {}, save() {}, beginPath() {}, rect() {}, clip() {}, restore() {},
      drawImage(...args) { draws.push(args); } };
    assert.equal(drawRecordingCanvasFrame(field, context, 640, 360), true);
    assert.deepEqual(draws.map(([item]) => item), [board, pixi]);
    assert.deepEqual(draws.map((args) => args.slice(1)), [
      [0, 0, 320, 180, 0, 0, 640, 360],
      [0, 0, 640, 360, 0, 0, 640, 360],
    ]);
    assert.deepEqual(recordingCanvasElements({ querySelectorAll: () => [board, pixi] }), [board, pixi]);
  });
});

test('single-canvas 2D field keeps its intrinsic output size and still draws one layer', () => {
  const fieldCanvas = canvas(320, 180, { left: 10, top: 20, width: 320, height: 180, right: 330, bottom: 200 });
  withField([{ canvas: fieldCanvas }], (field) => {
    assert.deepEqual(recordingCanvasLayout(field), { width: 320, height: 180 });
    const draws = [];
    const context = { clearRect() {}, save() {}, beginPath() {}, rect() {}, clip() {}, restore() {}, drawImage(...args) { draws.push(args); } };
    assert.equal(drawRecordingCanvasFrame(field, context, 320, 180), true);
    assert.equal(draws.length, 1);
    assert.deepEqual(draws[0].slice(1), [0, 0, 320, 180, 0, 0, 320, 180]);
  });
});

test('large native canvases are scaled down to the configured max edge without changing aspect ratio', () => {
  const large = canvas(5120, 2880, { left: 10, top: 20, width: 320, height: 180, right: 330, bottom: 200 });
  withField([{ canvas: large }], (field) => {
    assert.deepEqual(recordingCanvasLayout(field), { width: 3840, height: 2160 }, 'default capture canvas preserves the source native edge up to 3840px');
    assert.deepEqual(recordingCanvasLayout(field, 1280), { width: 1280, height: 720 });
    assert.deepEqual(recordingCanvasLayout(field, 1920), { width: 1920, height: 1080 });
  });
});
