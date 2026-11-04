/* global MediaRecorder, window, requestAnimationFrame */
// Native tab capture: getDisplayMedia on the page itself, encoded by MediaRecorder straight to mp4 (video + audio).
// No frame screenshots, no ffmpeg: the browser's own encoder writes the file. Chunks leave the page through a plain
// fetch(Blob) to a loopback sink (no main-thread base64 work, which used to freeze the game for ~0.4 s per chunk).
import fs from 'node:fs';
import http from 'node:http';

const MIMES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1', 'video/mp4'];

function startSink(outFile) {
  const stream = fs.createWriteStream(outFile);
  const state = { bytes: 0, chunks: 0, outFile, stream };
  state.server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => { const b = Buffer.concat(parts); stream.write(b); state.bytes += b.length; state.chunks++; res.writeHead(204, { 'access-control-allow-origin': '*' }); res.end(); });
  });
  return new Promise((resolve) => state.server.listen(0, '127.0.0.1', () => { state.port = state.server.address().port; resolve(state); }));
}

export async function startCapture(page, outFile, { fps = 60, width = 1920, height = 1080, videoBps = 6_000_000, audioBps = 128_000, chunkMs = 1000, mode } = {}) {
  const state = await startSink(outFile);
  const info = await page.evaluate(async (o) => {
    const ms = await navigator.mediaDevices.getDisplayMedia({ preferCurrentTab: true, video: { frameRate: o.fps, width: o.width, height: o.height }, audio: true });
    const mime = o.mimes.find((m) => MediaRecorder.isTypeSupported(m));
    const opts = { mimeType: mime, videoBitsPerSecond: o.videoBps, audioBitsPerSecond: o.audioBps };
    if (o.mode) opts.videoBitrateMode = o.mode;
    const rec = new MediaRecorder(ms, opts);
    let queue = Promise.resolve();
    rec.ondataavailable = (e) => { if (e.data.size) queue = queue.then(() => fetch('http://127.0.0.1:' + o.port + '/c', { method: 'POST', mode: 'no-cors', body: e.data }).catch(() => {})); };
    window.__mr = rec; window.__mrStream = ms; window.__mrQueue = () => queue;
    window.__raf = { n: 0, t0: performance.now(), last: performance.now(), maxGap: 0, over100: 0, gaps: [] };
    const tick = (t) => { const g = t - window.__raf.last; if (g > window.__raf.maxGap) window.__raf.maxGap = g; if (g > 100) { window.__raf.over100++; window.__raf.gaps.push([+((t - window.__raf.t0) / 1000).toFixed(2), Math.round(g)]); } window.__raf.last = t; window.__raf.n++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    rec.start(o.chunkMs);
    const vt = ms.getVideoTracks()[0];
    return { mime, state: rec.state, settings: vt.getSettings(), audioTracks: ms.getAudioTracks().length };
  }, { fps, width, height, videoBps, audioBps, chunkMs, mode, port: state.port, mimes: MIMES });
  state.info = info;
  return state;
}

export async function stopCapture(page, state) {
  const raf = await page.evaluate(async () => {
    const r = window.__mr; const done = new Promise((x) => { r.onstop = x; }); r.stop(); await done;
    await new Promise((x) => setTimeout(x, 500)); await window.__mrQueue();
    window.__mrStream.getTracks().forEach((t) => t.stop());
    const a = window.__raf; return { frames: a.n, seconds: (performance.now() - a.t0) / 1000, maxGapMs: a.maxGap, rafGapsOver100ms: a.over100, rafGaps: a.gaps };
  });
  await new Promise((x) => setTimeout(x, 400));
  await new Promise((x) => state.stream.end(x));
  await new Promise((x) => state.server.close(x));
  return { ...raf, rafFps: raf.frames / raf.seconds, bytes: state.bytes, chunks: state.chunks, file: state.outFile };
}
