import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplayMediaSurface } from '../../public/js/independent/replayMediaSurface.js';

function makeStage() {
  return {
    children: [],
    appendChild(node) { this.children.push(node); node.parentNode = this; return node; },
  };
}

function installDocumentStub(t) {
  const previous = globalThis.document;
  const calls = [];
  globalThis.document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      const node = {
        dataset: {}, style: {}, hidden: false, width: 300, height: 150,
        getContext(kind, options) {
          assert.equal(kind, '2d');
          if (options !== undefined) assert.deepEqual(options, { alpha: false });
          return {
            clearRect(...args) { calls.push(['clearRect', ...args]); },
            drawImage(...args) { calls.push(['drawImage', ...args]); },
          };
        },
        remove() {
          if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
        },
      };
      return node;
    },
  };
  t.after(() => { globalThis.document = previous; });
  return calls;
}

test('surface draws only ready current video frames and keeps the prior frame during gaps', (t) => {
  const calls = installDocumentStub(t);
  const stage = makeStage();
  const surface = createReplayMediaSurface(stage);
  const { canvas } = surface;

  assert.equal(stage.children.length, 1);
  assert.equal(canvas.dataset.spCanvasSurface, '1');
  assert.equal(canvas.hidden, true);
  assert.equal(canvas.style.position, 'absolute');
  assert.equal(canvas.style.zIndex, '4');
  assert.equal(canvas.style.pointerEvents, 'none');
  assert.equal(canvas.style.opacity, '1');
  assert.equal(canvas.style.background, '#08090c');

  surface.setBounds({ left: 2, top: 3, width: 90.5, height: 45 });
  assert.deepEqual(
    [canvas.style.left, canvas.style.top, canvas.style.width, canvas.style.height],
    ['2px', '3px', '90.5px', '45px'],
  );

  const green = { readyState: 2, seeking: false, videoWidth: 64, videoHeight: 36 };
  assert.equal(surface.paint(green), true);
  assert.equal(surface.hasFrame(), true);
  assert.equal(canvas.hidden, false);
  assert.deepEqual(calls.map(([name]) => name), ['clearRect', 'drawImage']);
  assert.deepEqual(calls[1], ['drawImage', green, 0, 0, 64, 36]);

  const retainedCalls = calls.length;
  for (const unavailable of [
    { ...green, readyState: 1 },
    { ...green, seeking: true },
    { ...green, videoWidth: 0 },
    null,
  ]) assert.equal(surface.paint(unavailable), false);
  assert.equal(calls.length, retainedCalls);
  assert.equal(surface.hasFrame(), true);
  assert.equal(canvas.hidden, false);

  const red = { readyState: 2, seeking: false, videoWidth: 80, videoHeight: 45 };
  assert.equal(surface.paint(red), true);
  assert.equal(canvas.width, 80);
  assert.equal(canvas.height, 45);
  assert.deepEqual(calls.slice(-2).map(([name]) => name), ['clearRect', 'drawImage']);
  assert.deepEqual(calls.at(-1), ['drawImage', red, 0, 0, 80, 45]);

  surface.hide();
  assert.equal(surface.hasFrame(), true);
  assert.equal(canvas.hidden, true);
  surface.destroy();
  assert.equal(surface.hasFrame(), false);
  assert.equal(stage.children.length, 0);
  assert.equal(surface.paint(red), false);
});

test('surface requires a stage and a usable 2D context', (t) => {
  installDocumentStub(t);
  assert.throws(() => createReplayMediaSurface(null), /stage element/i);
  const previous = globalThis.document;
  globalThis.document = {
    createElement: () => ({ dataset: {}, style: {}, getContext: () => null, remove() {} }),
  };
  t.after(() => { globalThis.document = previous; });
  assert.throws(() => createReplayMediaSurface(makeStage()), /2D canvas context/i);
});
