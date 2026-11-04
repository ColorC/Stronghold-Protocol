// Opt-in structured recording for 进击. rrweb owns the DOM and the interaction stream (no canvas pixels); the board
// canvases are composited into one 2D surface that a native MediaRecorder encodes. Both streams go to the server
// through acknowledged HTTP batches, so a recording outage can never reject a game action.
import { startPageCapture } from '../recording/pageCapture.js';
import { createCanvasMediaRecorder, resolveMediaOptions } from '../recording/canvasMedia.js';
import { drawRecordingCanvasFrame, recordingCanvasLayout } from './recorderCanvas.js';
import { captureRecordingMediaFrame, enqueueRecordingMediaBlob, startRecordingMediaAtFirstCapture } from './recorderMediaClock.js';
import { LAST_COMPLETED_RECORDING_KEY, initialPlaybackId, prepareNewRecordingUrl } from './recorderLifecycle.js';

const RECORDING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Full rrweb snapshots repeat the page's inlined stylesheets; one every three minutes keeps seeking cheap enough.
const CHECKOUT_MS = 180_000;

/** `?record=1` starts a recording as the page loads; `?record=ui` only shows the control; `?recording=<id>` resumes. */
export function recordingRequest(href) {
  let url;
  try { url = new URL(href); } catch { return { mode: null, recordingId: '' }; }
  const record = url.searchParams.get('record');
  const recordingId = url.searchParams.get('recording') || '';
  if (recordingId && !RECORDING_ID.test(recordingId)) return { mode: null, recordingId: '' };
  if (record === '1' || recordingId) return { mode: 'auto', recordingId };
  if (record === 'ui') return { mode: 'ui', recordingId };
  return { mode: null, recordingId: '' };
}

export function recordingApiBase(href) { return new URL('api/assault/recordings/', href); }

export function createRecordingApi({ fetchFn = globalThis.fetch?.bind(globalThis), href = globalThis.location?.href } = {}) {
  const base = recordingApiBase(href);
  const call = async (path, init = {}) => {
    try {
      const response = await fetchFn(new URL(path, base), { credentials: 'same-origin', ...init,
        headers: { ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } });
      let body = null;
      try { body = await response.json(); } catch { /* non-JSON failure */ }
      return { ...(body || {}), ok: !!(response.ok && body?.ok), status: response.status };
    } catch { return { ok: false, status: 0 }; }
  };
  const id = (value) => encodeURIComponent(value);
  return {
    start: (runId, recordingId, viewport) => call('start', { method: 'POST', body: JSON.stringify({ runId: runId || null, recordingId: recordingId || undefined, viewport }) }),
    events: (recording, events, keepalive = false) => call(`${id(recording)}/events`, { method: 'POST', keepalive, body: JSON.stringify({ events }) }),
    media: (recording, seq, blob, startedAt, timeMs) => call(`${id(recording)}/media/${seq}`, { method: 'POST', body: blob,
      headers: { 'content-type': 'video/webm', 'x-media-started-at': String(startedAt), 'x-media-time-ms': String(Math.round(timeMs)), 'x-media-mime-type': blob.type || 'video/webm' } }),
    stop: (recording, mediaCapture = {}) => call(`${id(recording)}/stop`, { method: 'POST', body: JSON.stringify(mediaCapture) }),
  };
}

async function loadRrweb(doc, href) {
  if (globalThis.rrweb?.record) return globalThis.rrweb;
  await new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = new URL('vendor/rrweb.umd.js', href).href;
    script.onload = resolve; script.onerror = () => reject(new Error('rrweb failed to load'));
    doc.head.append(script);
  });
  return globalThis.rrweb;
}

/** The recorder state machine, free of any control widget. */
export function createAssaultRecorder({ win = globalThis.window, doc = globalThis.document, api = createRecordingApi(), onStatus = () => {} } = {}) {
  const href = win.location.href;
  const url = new URL(href);
  const mediaOptions = resolveMediaOptions(url.searchParams);
  const state = { id: '', seq: 0, queue: [], stopped: false, pushing: false, starting: false, rrwebStop: null, timer: null,
    mediaSeq: 0, mediaStartedAt: 0, mediaLastTimeMs: 0, mediaCaptureStoppedAt: 0, mediaRecorder: null, mediaPipeline: null, mediaObserver: null,
    mediaCaptureTimer: null, mediaPush: Promise.resolve(), mediaPending: [], mediaPushing: false, mediaError: false,
    mediaBoundView: null, mediaViewOff: null, lastCompositeAt: 0, hasPaintedFrame: false, mediaRecorderStarted: false,
    mediaStartCancelled: false, firstNativeFrameAt: 0, firstCaptureAt: 0, actualRecorderStartedAt: 0, mediaStartError: null,
    captureFrames: 0, lastCaptureAt: 0, nativeFrameCopies: 0, lastNativeFrameAt: 0, lastMediaAckAt: 0, lastMediaAckSeq: 0 };
  const status = () => ({ id: state.id, recording: !!state.id && !state.stopped, eventSeq: state.seq, queuedEvents: state.queue.length,
    pushingEvents: state.pushing, mediaSeq: state.mediaSeq, queuedMedia: state.mediaPending.length, pushingMedia: state.mediaPushing,
    mediaError: state.mediaError, recorderState: state.mediaRecorder?.state || null, mediaStartedAt: state.mediaStartedAt || null,
    firstNativeFrameAt: state.firstNativeFrameAt || null, mediaStartError: state.mediaStartError, mediaLastTimeMs: state.mediaLastTimeMs,
    captureFrames: state.captureFrames, nativeFrameCopies: state.nativeFrameCopies, lastMediaAckSeq: state.lastMediaAckSeq });
  const bufferKey = () => `sp:assault-recording-buffer:${state.id}`;
  const persist = () => { try { win.sessionStorage.setItem(bufferKey(), JSON.stringify(state.queue)); } catch { /* in-memory retry remains */ } };

  const emit = (kind, p) => {
    if (state.stopped || !state.id) return;
    state.queue.push({ seq: ++state.seq, ts: Date.now(), kind, p });
    persist();
    if (state.queue.length > 50) void flush();
  };
  const flush = async (keepalive = false) => {
    if (!state.id || state.pushing || !state.queue.length) return;
    state.pushing = true;
    try {
      while (state.queue.length) {
        const batch = []; let bytes = 0;
        for (const item of state.queue) {
          const size = new TextEncoder().encode(JSON.stringify(item)).byteLength;
          if (batch.length && (batch.length >= 35 || bytes + size > 1024 * 1024)) break;
          batch.push(item); bytes += size;
        }
        const result = await api.events(state.id, batch, keepalive);
        if (!result.ok) break;
        const ack = Number(result.ack) || 0;
        state.queue = state.queue.filter((item) => item.seq > ack);
        persist();
        if (state.queue.length && state.queue[0].seq > ack + 1) break;
      }
    } catch { /* a full retry remains queued */ }
    finally { state.pushing = false; }
  };
  const flushMedia = async () => {
    if (state.mediaPushing) return;
    state.mediaPushing = true;
    try {
      while (state.mediaPending.length) {
        const item = state.mediaPending[0]; let response;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { response = await api.media(state.id, item.seq, item.blob, item.startedAt, item.timeMs); if (response.ok) break; } catch { /* retry exact sequence */ }
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
        if (!response?.ok) { state.mediaError = true; onStatus({ kind: 'warn', text: '待上传' }); break; }
        state.mediaPending.shift(); state.mediaError = false; state.lastMediaAckSeq = item.seq; state.lastMediaAckAt = Date.now();
      }
    } finally { state.mediaPushing = false; }
  };

  const bindViewFrames = () => {
    const view = globalThis.__SP_VIEW__;
    if (!view?.on || state.mediaBoundView === view) return;
    state.mediaViewOff?.();
    state.mediaBoundView = view;
    state.mediaViewOff = view.on('framePainted', () => {
      if (!state.mediaRecorder || state.stopped || state.mediaStartCancelled
        || (state.mediaRecorderStarted && state.mediaRecorder.state === 'inactive')) return;
      const now = performance.now();
      if (now - state.lastCompositeAt < 1000 / mediaOptions.fps) return;
      try {
        if (!drawRecordingCanvasFrame(state.captureField, state.frameCacheContext, state.frameCache.width, state.frameCache.height)) return;
        state.lastCompositeAt = now; state.lastNativeFrameAt = Date.now(); state.nativeFrameCopies += 1; state.hasPaintedFrame = true;
        if (!state.firstNativeFrameAt) state.firstNativeFrameAt = state.lastNativeFrameAt;
        if (!state.mediaRecorderStarted) state.startMediaCapture?.();
      } catch { state.mediaError = true; }
    });
  };
  const captureCanvas = () => {
    bindViewFrames();
    if (state.mediaRecorder || typeof MediaRecorder !== 'function') return;
    const field = doc.querySelector('.gm__field');
    const layout = recordingCanvasLayout(field, mediaOptions.maxDimension);
    if (!layout) return;
    try {
      // Copy each visible canvas frame into a dedicated 2D surface; requestFrame() alone depends on a source paint, so
      // copying first keeps the media clock advancing during visually static states.
      const captureSurface = doc.createElement('canvas');
      captureSurface.width = layout.width; captureSurface.height = layout.height;
      const frameCache = doc.createElement('canvas');
      frameCache.width = layout.width; frameCache.height = layout.height;
      captureSurface.setAttribute('aria-hidden', 'true');
      captureSurface.className = 'rr-block';
      Object.assign(captureSurface.style, { position: 'fixed', left: '0', top: '0', zIndex: '-1', opacity: '0', pointerEvents: 'none' });
      doc.body.appendChild(captureSurface);
      state.captureSurface = captureSurface;
      const captureContext = captureSurface.getContext('2d', { alpha: false });
      const frameCacheContext = frameCache.getContext('2d', { alpha: false });
      if (!captureContext || !frameCacheContext) { captureSurface.remove(); return; }
      state.captureField = field; state.captureContext = captureContext;
      state.frameCache = frameCache; state.frameCacheContext = frameCacheContext;
      const stream = captureSurface.captureStream(0);
      const videoTrack = stream.getVideoTracks()[0];
      if (typeof videoTrack?.requestFrame !== 'function') { stream.getTracks().forEach((track) => track.stop()); captureSurface.remove(); return; }
      const media = state.mediaPipeline = createCanvasMediaRecorder({ stream, options: mediaOptions, onChunk: ({ blob, timecode }) => {
        if (!blob?.size || !state.id) return;
        const elapsedMs = Date.now() - state.mediaStartedAt;
        const timeMs = Math.max(Number.isFinite(timecode) ? timecode : 0, elapsedMs);
        state.mediaLastTimeMs = timeMs;
        enqueueRecordingMediaBlob(state, { blob, startedAt: state.mediaStartedAt, timeMs });
        state.mediaPush = state.mediaPush.then(flushMedia).catch(() => { state.mediaError = true; });
      }, onError: () => { state.mediaError = true; } });
      const recorder = state.mediaRecorder = media.recorder;
      const paintCaptureFrame = () => { state.captureContext.drawImage(state.frameCache, 0, 0, state.captureSurface.width, state.captureSurface.height); return true; };
      const requestFrame = () => videoTrack.requestFrame();
      const captureFrame = () => captureRecordingMediaFrame(state, { paintCaptureFrame, requestFrame });
      state.startMediaCapture = () => {
        const started = startRecordingMediaAtFirstCapture(state, { paintCaptureFrame, requestFrame }, mediaOptions.timesliceMs);
        if (!started) return false;
        state.mediaCaptureTimer = setInterval(captureFrame, 1000 / mediaOptions.fps);
        emit('custom', { tag: 'canvas-media-start', width: captureSurface.width, height: captureSurface.height, fps: mediaOptions.fps,
          videoBitsPerSecond: recorder.videoBitsPerSecond || mediaOptions.videoBitsPerSecond, mimeType: media.mimeType });
        return true;
      };
    } catch { state.captureSurface?.remove(); state.mediaError = true; }
  };

  async function start(requestedId = '') {
    if (state.id || state.starting) return status();
    state.starting = true;
    try {
      const runId = url.searchParams.get('run');
      const started = await api.start(/^[0-9a-f-]{36}$/i.test(runId || '') ? runId : null, requestedId || url.searchParams.get('recording') || '', { width: win.innerWidth, height: win.innerHeight });
      if (!started.ok) { onStatus({ kind: 'error', text: '不可用' }); return status(); }
      state.id = started.id; state.seq = Number(started.nextSeq) - 1 || 0; state.mediaSeq = (Number(started.nextMediaSeq) || 1) - 1;
      try {
        const buffered = JSON.parse(win.sessionStorage.getItem(bufferKey()) || '[]');
        state.queue = Array.isArray(buffered) ? buffered.filter((item) => item.seq >= started.nextSeq) : [];
        if (state.queue.length) state.seq = Math.max(state.seq, ...state.queue.map((item) => item.seq));
      } catch { state.queue = []; }
      url.searchParams.set('recording', state.id); win.history.replaceState(null, '', url);
      if (started.endedAt) { onStatus({ kind: 'ended', id: state.id }); return status(); }
      const rr = await loadRrweb(doc, href);
      if (!rr?.record) { onStatus({ kind: 'error', text: '无模块' }); return status(); }
      state.rrwebStop = startPageCapture({ rrweb: rr, emit, doc, win, checkoutEveryNms: CHECKOUT_MS });
      captureCanvas();
      state.mediaObserver = new MutationObserver(captureCanvas); state.mediaObserver.observe(doc.body, { childList: true, subtree: true });
      state.timer = setInterval(() => { bindViewFrames(); void flush(); state.mediaPush = state.mediaPush.then(flushMedia); }, 1000);
      emit('custom', { tag: 'recording-start', runId, viewport: { width: win.innerWidth, height: win.innerHeight } });
      onStatus({ kind: 'recording', id: state.id });
    } catch { onStatus({ kind: 'error', text: '不可用' }); }
    finally { state.starting = false; }
    return status();
  }

  async function stop() {
    if (!state.id || state.stopped) return status();
    if (!state.mediaRecorderStarted) state.mediaStartCancelled = true;
    state.startMediaCapture = null;
    state.mediaViewOff?.(); state.mediaViewOff = null; state.mediaBoundView = null;
    state.mediaObserver?.disconnect();
    state.rrwebStop?.(); state.rrwebStop = null;
    if (state.mediaRecorder && state.mediaRecorderStarted) {
      clearInterval(state.mediaCaptureTimer); state.mediaCaptureTimer = null;
      state.mediaCaptureStoppedAt = Date.now();
      try { await state.mediaPipeline?.stop(); } catch { try { state.mediaRecorder.stop(); } catch { /* preserve stop path */ } }
      try { state.mediaPipeline?.dispose(); } catch { /* stopped with recorder */ }
      state.captureSurface?.remove();
      emit('custom', { tag: 'canvas-media-stopped', captureStoppedAt: state.mediaCaptureStoppedAt, lastPaintedAt: state.lastCaptureAt,
        mediaLastTimeMs: state.mediaLastTimeMs, mediaFinalSeq: state.mediaSeq });
      await Promise.race([state.mediaPush, new Promise((resolve) => setTimeout(resolve, 8000))]);
      state.mediaPush = state.mediaPush.then(flushMedia);
      await Promise.race([state.mediaPush, new Promise((resolve) => setTimeout(resolve, 20000))]);
    } else if (state.mediaRecorder) {
      try { state.mediaRecorder.stream.getTracks().forEach((track) => track.stop()); } catch { /* disposed before first media frame */ }
      state.captureSurface?.remove();
    }
    if (state.mediaPending.length || state.mediaPushing) { onStatus({ kind: 'warn', text: '待上传' }); return status(); }
    const drained = await new Promise((resolve) => {
      const wait = setInterval(() => { void flush(); if (!state.queue.length && !state.pushing) { clearInterval(wait); resolve(true); } }, 100);
      setTimeout(() => { clearInterval(wait); resolve(!state.queue.length && !state.pushing); }, 8000);
    });
    if (!drained) { onStatus({ kind: 'warn', text: '待上传' }); return status(); }
    clearInterval(state.timer);
    const stopped = await api.stop(state.id, state.mediaCaptureStoppedAt ? { mediaCaptureStoppedAt: state.mediaCaptureStoppedAt,
      mediaCaptureLastTimeMs: state.mediaLastTimeMs, mediaCaptureFinalSeq: state.mediaSeq } : {});
    if (!stopped.ok) { onStatus({ kind: 'error', text: '失败' }); return status(); }
    state.stopped = true;
    try { win.sessionStorage.setItem(LAST_COMPLETED_RECORDING_KEY, state.id); win.sessionStorage.removeItem(bufferKey()); } catch { /* URL retains the id */ }
    const done = new URL(win.location.href); done.searchParams.delete('record'); win.history.replaceState(null, '', done);
    onStatus({ kind: 'ended', id: state.id });
    return status();
  }

  const note = (kind, payload) => emit(String(kind || 'custom').slice(0, 60), payload ?? null);
  const onHide = () => { void flush(true); };
  win.addEventListener('pagehide', onHide);
  win.__SP_RECORD_NOTE__ = note;
  win.__SP_RECORDING_STATUS__ = status;
  return { start, stop, note, status, flush };
}

const CONTROL_CSS = '.ar-rec{position:fixed;z-index:2147483000;top:2px;left:2px;display:flex;align-items:center;gap:3px;padding:1px 4px;border-radius:4px;background:#0d1214cc;color:#d9dfdc;font:11px/1.4 sans-serif;opacity:.55}'
  + '.ar-rec:hover{opacity:1}.ar-rec__dot{width:7px;height:7px;border-radius:50%;background:#6b7570}.ar-rec__dot.is-live{background:#e5624a}'
  + '.ar-rec button,.ar-rec a{border:1px solid #5b665f;border-radius:3px;background:#1b2421;color:#e8d9ae;font:inherit;padding:0 4px;text-decoration:none;cursor:pointer}';

/** Mounts the small start / end control. It is blocked from the DOM stream, so the replay never shows it. */
export function installAssaultRecording({ win = globalThis.window, doc = globalThis.document } = {}) {
  const request = recordingRequest(win.location.href);
  if (!request.mode || win.__SP_RECORDER__) return null;
  const style = doc.createElement('style'); style.textContent = CONTROL_CSS; style.className = 'rr-block'; doc.head.append(style);
  const box = doc.createElement('aside');
  box.className = 'ar-rec rr-block'; box.setAttribute('aria-live', 'polite');
  const dot = doc.createElement('span'); dot.className = 'ar-rec__dot';
  const action = doc.createElement('button'); action.type = 'button';
  const link = doc.createElement('a'); link.target = '_blank'; link.rel = 'noopener'; link.hidden = true; link.textContent = '回放';
  box.append(dot, action, link); doc.body.append(box);
  let recorderState = 'idle';
  const paint = (next, id) => {
    recorderState = next;
    dot.className = next === 'recording' ? 'ar-rec__dot is-live' : 'ar-rec__dot';
    action.textContent = next === 'recording' ? '结束' : next === 'ended' ? '新录' : '录制';
    action.disabled = next === 'busy';
    if (id) { link.href = new URL(`assault-review.html?recording=${encodeURIComponent(id)}`, win.location.href).href; link.hidden = next === 'recording'; }
  };
  const recorder = createAssaultRecorder({ win, doc, onStatus(info) {
    if (info.kind === 'recording') paint('recording', info.id);
    else if (info.kind === 'ended') paint('ended', info.id);
    else if (info.text) box.title = info.text;
  } });
  win.__SP_RECORDER__ = recorder;
  paint(request.recordingId ? 'recording' : 'idle', request.recordingId);
  action.addEventListener('click', async () => {
    if (recorderState === 'recording') { action.disabled = true; await recorder.stop(); action.disabled = false; return; }
    if (recorderState === 'ended') { win.location.href = prepareNewRecordingUrl(win.location.href).href; return; }
    paint('busy'); await recorder.start(); if (!recorder.status().recording) paint('idle');
  });
  if (request.mode === 'auto') {
    // rrweb snapshots a settled page: wait until the app has replaced its loading placeholder.
    const begin = () => { void recorder.start(); };
    if (doc.readyState === 'complete') setTimeout(begin, 1500); else win.addEventListener('load', () => setTimeout(begin, 1500), { once: true });
  }
  return recorder;
}

export { initialPlaybackId };
