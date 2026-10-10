import test from 'node:test';
import assert from 'node:assert/strict';
import { startPageCapture, selectionSnapshot } from '../../public/js/recording/pageCapture.js';
import { DEFAULT_MEDIA_OPTIONS, createCanvasMediaRecorder, fitRecordingDimensions, resolveMediaOptions } from '../../public/js/recording/canvasMedia.js';
import { selectionAt } from '../../public/js/recording/selectionTimeline.js';

class FakeDocument {
  handlers = new Map();
  addEventListener(type, fn) { const list = this.handlers.get(type) || []; list.push(fn); this.handlers.set(type, list); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) || []).filter((item) => item !== fn)); }
  dispatch(type, event = {}) { for (const fn of this.handlers.get(type) || []) fn({ target: null, ...event }); }
  getSelection() { return this.selection || { rangeCount: 0, isCollapsed: true, toString: () => '' }; }
}

test('page capture records ordinary keystrokes, masks password characters, and records selection set/clear geometry', async () => {
  const doc = new FakeDocument(); const win = { innerWidth: 900, innerHeight: 600 };
  const emitted = []; let rrwebOptions; let rrwebStopped = false;
  const rrweb = { record(options) { rrwebOptions = options; return () => { rrwebStopped = true; }; } };
  const stop = startPageCapture({ rrweb, emit: (kind, p) => emitted.push({ kind, p }), doc, win, selectionDelayMs: 0 });
  const textInput = { nodeType: 1, tagName: 'INPUT', type: 'text', id: 'secret', closest: () => textInput, getAttribute: () => null };
  doc.dispatch('keydown', { target: textInput, key: 'x', code: 'KeyX', ctrlKey: false });
  doc.dispatch('click', { target: textInput, clientX: 10, clientY: 20, button: 0 });
  for (const action of ['pointerdown', 'pointerup', 'wheel', 'scroll', 'keyup', 'focusin', 'focusout']) doc.dispatch(action, { target: textInput, key: 'x', code: 'KeyX', clientX: 11, clientY: 21, deltaY: 40 });
  doc.dispatch('pointermove', { target: textInput, clientX: 11, clientY: 21, buttons: 1 });
  const passwordInput = { ...textInput, type: 'password' }; passwordInput.closest = () => passwordInput;
  doc.dispatch('keydown', { target: passwordInput, key: 'x', code: 'KeyX', ctrlKey: false });
  doc.selection = { rangeCount: 1, isCollapsed: false, toString: () => '选中的文本', getRangeAt: () => ({ getClientRects: () => [{ x: 20, y: 30, width: 100, height: 18 }] }) };
  doc.dispatch('selectionchange'); await new Promise((resolve) => setTimeout(resolve, 5));
  doc.selection = { rangeCount: 0, isCollapsed: true, toString: () => '' };
  doc.dispatch('selectionchange'); await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(rrwebOptions.recordCanvas, false);
  assert.equal(rrwebOptions.maskAllInputs, false);
  assert.deepEqual(rrwebOptions.maskInputOptions, { password: true });
  assert.equal(emitted.find((e) => e.kind === 'interaction' && e.p.action === 'keydown').p.key, 'x');
  assert.equal(emitted.filter((e) => e.kind === 'interaction' && e.p.action === 'keydown')[1].p.key, '[password]');
  assert.equal(emitted.some((e) => e.kind === 'interaction' && e.p.action === 'click'), true);
  assert.deepEqual(['pointerdown', 'pointermove', 'pointerup', 'wheel', 'scroll', 'keyup', 'focusin', 'focusout'].map((action) => emitted.some((e) => e.kind === 'interaction' && e.p.action === action)), Array(8).fill(true));
  assert.deepEqual(emitted.filter((e) => e.kind === 'selection').map((e) => [e.p.operation, e.p.text]), [['set', '选中的文本'], ['clear', '']]);
  assert.deepEqual(selectionSnapshot(doc, win), null);
  stop(); assert.equal(rrwebStopped, true);
  assert.equal(doc.handlers.get('click').length, 0, 'capture detaches its listeners');
});

test('selection changes publish synchronously by default, including rapid set-clear and drag geometry updates', async () => {
  const doc = new FakeDocument(); const win = { innerWidth: 900, innerHeight: 600 };
  const emitted = [];
  const stop = startPageCapture({ rrweb: { record: () => () => {} }, emit: (kind, p) => emitted.push({ kind, p }), doc, win });
  const select = (text, x) => {
    doc.selection = text ? { rangeCount: 1, isCollapsed: false, toString: () => text, getRangeAt: () => ({ getClientRects: () => [{ x, y: 30, width: 100, height: 18 }] }) }
      : { rangeCount: 0, isCollapsed: true, toString: () => '' };
    doc.dispatch('selectionchange');
  };

  select('拖动中的文字', 20);
  assert.deepEqual(emitted.filter((event) => event.kind === 'selection').map((event) => [event.p.operation, event.p.rects[0]?.x]), [['set', 20]]);
  select('拖动中的文字', 35);
  assert.deepEqual(emitted.filter((event) => event.kind === 'selection').map((event) => [event.p.operation, event.p.rects[0]?.x]), [['set', 20], ['set', 35]], 'changed drag rectangles publish immediately');
  await new Promise((resolve) => setTimeout(resolve, 5));
  select('', 0);
  assert.deepEqual(emitted.filter((event) => event.kind === 'selection').map((event) => event.p.operation), ['set', 'set', 'clear']);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(emitted.filter((event) => event.kind === 'selection').length, 3, 'no delayed set may arrive after clear');
  stop();
});

test('custom delayed selection capture flushes a short-lived set before its clear', async () => {
  const doc = new FakeDocument(); const win = { innerWidth: 900, innerHeight: 600 };
  const emitted = [];
  const stop = startPageCapture({ rrweb: { record: () => () => {} }, emit: (kind, p) => emitted.push({ kind, p }), doc, win, selectionDelayMs: 60 });
  doc.selection = { rangeCount: 1, isCollapsed: false, toString: () => 'brief', getRangeAt: () => ({ getClientRects: () => [{ x: 20, y: 30, width: 40, height: 18 }] }) };
  doc.dispatch('selectionchange');
  await new Promise((resolve) => setTimeout(resolve, 5));
  doc.selection = { rangeCount: 0, isCollapsed: true, toString: () => '' };
  doc.dispatch('selectionchange');
  assert.deepEqual(emitted.filter((event) => event.kind === 'selection').map((event) => event.p.operation), ['set', 'clear']);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.deepEqual(emitted.filter((event) => event.kind === 'selection').map((event) => event.p.operation), ['set', 'clear'], 'the canceled delay cannot publish a late set');
  stop();
});

test('media defaults cap the composed field at 1280px and permit bounded URL overrides', () => {
  assert.deepEqual(DEFAULT_MEDIA_OPTIONS, { maxDimension: 1280, fps: 24, videoBitsPerSecond: 900000, timesliceMs: 5000 });
  assert.deepEqual(fitRecordingDimensions(2560, 1440), { width: 1280, height: 720 });
  assert.deepEqual(fitRecordingDimensions(800, 1200), { width: 800, height: 1200 });
  assert.deepEqual(resolveMediaOptions('?recordMax=1920&recordFps=30&recordBitrate=1500000&recordChunkMs=3000'), {
    maxDimension: 1920, fps: 30, videoBitsPerSecond: 1500000, timesliceMs: 3000,
  });
  assert.equal(resolveMediaOptions('?recordMax=99999').maxDimension, 2560);
});

test('ordinary recording links retain media defaults when options are absent or blank', () => {
  for (const query of ['', '?record=1', '?recording=an-existing-recording',
    '?recordMax=&recordFps=%20&recordBitrate=&recordChunkMs=']) {
    assert.deepEqual(resolveMediaOptions(query), DEFAULT_MEDIA_OPTIONS, query);
  }
  assert.deepEqual(resolveMediaOptions('?recordFps=30'), { ...DEFAULT_MEDIA_OPTIONS, fps: 30 });
  assert.deepEqual(resolveMediaOptions('?recordMax=invalid&recordFps=invalid'), DEFAULT_MEDIA_OPTIONS);
});

test('canvas media adapter forwards WebM chunks and stops its tracks cleanly', async () => {
  const listeners = new Map(); const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  class FakeRecorder {
    static isTypeSupported(type) { return type === 'video/webm;codecs=vp8'; }
    constructor(_stream, options) { this.options = options; this.state = 'inactive'; this.listeners = new Map(); }
    addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
    start(slice) { this.state = 'recording'; this.slice = slice; }
    stop() { this.state = 'inactive'; for (const fn of this.listeners.get('stop') || []) fn(); }
    emit(type, event) { for (const fn of this.listeners.get(type) || []) fn(event); }
  }
  const chunks = [];
  const media = createCanvasMediaRecorder({ stream, MediaRecorderCtor: FakeRecorder, options: { videoBitsPerSecond: 750000, timesliceMs: 2000 }, onChunk: (chunk) => chunks.push(chunk) });
  media.start(); media.recorder.emit('dataavailable', { data: { size: 4, type: 'video/webm' }, timecode: 3 });
  assert.equal(media.mimeType, 'video/webm;codecs=vp8'); assert.equal(media.recorder.slice, 2000);
  assert.equal(media.recorder.options.videoBitsPerSecond, 750000); assert.equal(chunks[0].timecode, 3);
  await media.stop(); media.dispose(); assert.equal(track.stopped, true);
});

test('selection replay follows seek direction and explicit clear records', () => {
  const events = [
    { at: 2, p: { operation: 'set', text: '开场' } },
    { at: 4, p: { operation: 'clear', text: '' } },
    { at: 7, p: { operation: 'set', text: '战斗中' } },
  ];
  assert.equal(selectionAt(events, 1), null);
  assert.equal(selectionAt(events, 3).p.text, '开场');
  assert.equal(selectionAt(events, 5), null);
  assert.equal(selectionAt(events, 8).p.text, '战斗中');
  assert.equal(selectionAt(events, 3).p.text, '开场', 'seeking backward restores earlier selection');
});
