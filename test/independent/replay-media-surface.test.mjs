import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createReplayMediaSurface } from '../../public/js/independent/replayMediaSurface.js';

function makeStage(ownerDocument = globalThis.document) {
  return {
    ownerDocument,
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

test('creates a host canvas in the host ownerDocument even when the parent document differs', (t) => {
  const previous = globalThis.document;
  const parentDocument = { createElement: () => { throw new Error('used parent document'); } };
  const calls = [];
  const childDocument = {
    createElement(name) {
      calls.push(name);
      return {
        dataset: {}, style: {}, hidden: true,
        getContext: () => ({ clearRect() {}, drawImage() {} }),
        remove() {},
      };
    },
  };
  globalThis.document = parentDocument;
  t.after(() => { globalThis.document = previous; });
  const stage = makeStage(childDocument);
  const surface = createReplayMediaSurface(stage);
  assert.deepEqual(calls, ['canvas']);
  assert.equal(stage.children[0], surface.canvas);
  surface.destroy();
});

test('paints an opaque parent-document video into a connected iframe-document canvas', { timeout: 40000 }, async (t) => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = await readFile(resolve(testDir, '../../public/js/independent/replayMediaSurface.js'), 'utf8');
  const server = createServer((req, res) => {
    if (req.url === '/surface.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(source);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><iframe id="child" srcdoc="<!doctype html><div id=stage></div>"></iframe><video id="source" hidden muted autoplay></video>');
    }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  t.after(async () => { await browser.close().catch(() => {}); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  const facts = await page.evaluate(async () => {
    const { createReplayMediaSurface } = await import('/surface.js');
    const childDocument = document.querySelector('#child').contentDocument;
    const host = childDocument.querySelector('#stage');
    const video = document.querySelector('#source');
    const frame = document.createElement('canvas');
    frame.width = 2; frame.height = 1;
    const frameContext = frame.getContext('2d', { alpha: false });
    frameContext.fillStyle = '#ff0000'; frameContext.fillRect(0, 0, 1, 1);
    frameContext.fillStyle = '#00ff00'; frameContext.fillRect(1, 0, 1, 1);
    const stream = frame.captureStream(0);
    let resolveFrame;
    let rejectFrame;
    const frameReady = new Promise((resolve, reject) => { resolveFrame = resolve; rejectFrame = reject; });
    const frameTimeout = setTimeout(() => rejectFrame(new Error('hidden video frame timeout')), 5000);
    video.addEventListener('loadeddata', resolveFrame, { once: true });
    video.srcObject = stream;
    let playTimeout;
    try {
      await Promise.race([
        video.play(),
        new Promise((_, reject) => { playTimeout = setTimeout(() => reject(new Error('hidden video play timeout')), 5000); }),
      ]);
    } finally {
      clearTimeout(playTimeout);
    }
    stream.getVideoTracks()[0].requestFrame();
    if (video.readyState >= 2) resolveFrame();
    await frameReady;
    clearTimeout(frameTimeout);
    const surface = createReplayMediaSurface(host);
    const painted = surface.paint(video);
    const pixels = surface.canvas.getContext('2d').getImageData(0, 0, 2, 1).data;
    const result = {
      distinctDocuments: document !== childDocument,
      ownerDocument: surface.canvas.ownerDocument === childDocument,
      connectedToHost: surface.canvas.parentElement === host && host.contains(surface.canvas),
      hiddenVideo: video.hidden,
      painted,
      opaqueContext: surface.canvas.getContext('2d').getContextAttributes().alpha === false,
      pixels: [[pixels[0], pixels[1], pixels[2]], [pixels[4], pixels[5], pixels[6]]],
    };
    surface.destroy();
    stream.getTracks().forEach(track => track.stop());
    return result;
  });
  assert.deepEqual(facts, {
    distinctDocuments: true,
    ownerDocument: true,
    connectedToHost: true,
    hiddenVideo: true,
    painted: true,
    opaqueContext: true,
    pixels: [[255, 0, 0], [0, 255, 0]],
  });
});
