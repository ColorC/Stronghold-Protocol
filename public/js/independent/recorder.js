// Opt-in remote play recording. rrweb captures the DOM/canvas stream; HTTP batches are an independent,
// acknowledged side channel so a recording outage can never reject a game action.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from '../ui/components.js';
import { api } from './api.js';
import { drawRecordingCanvasFrame, recordingCanvasLayout } from './recordingCanvas.js';
import { captureRecordingMediaFrame, startRecordingMediaAtFirstCapture } from './recordingMediaClock.js';
import { startPageCapture } from '../recording/pageCapture.js';
import { createCanvasMediaRecorder, resolveMediaOptions } from '../recording/canvasMedia.js';

const API = '/independent/api/';
const newUuid = () => crypto.randomUUID();
const MECHANIC_TEXT = Object.freeze({
  buy: '招募干员的效果按其科技档位结算；部分工坊效果在招募获得或首次上阵时触发，具体时机看干员说明。',
  equip: '装备会放入目标干员的装备栏；成长装备按对应属性乘区计算，徽章成长分项记录，训练等级合并显示。',
  merge: '三名相同干员合成一名进阶干员；进阶后的科技档位与效果以当前干员说明为准。',
});

export function RecordingControls({ sessionId }) {
  const [recording, setRecording] = useState(false);
  const [recordId, setRecordId] = useState('');
  const [message, setMessage] = useState('');
  const ctx = useRef(null);
  const sessionRef = useRef(sessionId || null);
  sessionRef.current = sessionId || null;
  useEffect(() => {
    const url = new URL(location.href);
    const enabled = url.searchParams.get('record') === '1' || !!url.searchParams.get('recording');
    let active = true; let timer;
    const mediaOptions = resolveMediaOptions(url.searchParams);
    const state = { id: '', seq: 0, queue: [], stopped: false, pushing: false, seen: new Set(), rrwebStop: null, observer: null, lastAnchor: null, timer: null,
      mediaSeq: 0, mediaStartedAt: 0, mediaLastTimeMs: 0, mediaCaptureStoppedAt: 0, mediaRecorder: null, mediaObserver: null, mediaCaptureTimer: null, mediaPush: Promise.resolve(),mediaPending:[],mediaPushing:false, mediaError: false,
      mediaBoundView: null, mediaViewOff: null, lastCompositeAt: 0, hasPaintedFrame: false, mediaRecorderStarted: false,
      mediaStartCancelled: false, firstNativeFrameAt: 0, firstCaptureAt: 0, actualRecorderStartedAt: 0, mediaStartError: null };
    state.captureFrames = 0; state.lastCaptureAt = 0; state.nativeFrameCopies = 0; state.lastNativeFrameAt = 0; state.lastMediaAckAt = 0; state.lastMediaAckSeq = 0;
    globalThis.__SP_RECORDING_STATUS__ = () => ({ eventSeq: state.seq, queuedEvents: state.queue.length, pushingEvents: state.pushing,
      mediaSeq: state.mediaSeq, queuedMedia: state.mediaPending.length, pushingMedia: state.mediaPushing, mediaError: state.mediaError,
      recorderState: state.mediaRecorder?.state || null, mediaStartedAt: state.mediaStartedAt || null,
      firstNativeFrameAt: state.firstNativeFrameAt || null, firstCaptureAt: state.firstCaptureAt || null,
      actualRecorderStartedAt: state.actualRecorderStartedAt || null, mediaStartError: state.mediaStartError,
      mediaLastTimeMs: state.mediaLastTimeMs, mediaCaptureStoppedAt: state.mediaCaptureStoppedAt || null,
      captureFrames: state.captureFrames, lastCaptureAt: state.lastCaptureAt || null,
      nativeFrameCopies: state.nativeFrameCopies, lastNativeFrameAt: state.lastNativeFrameAt || null,
      lastMediaAckSeq: state.lastMediaAckSeq, lastMediaAckAt: state.lastMediaAckAt || null });
    ctx.current = state;
    const event = (kind, p) => {
      if (state.stopped || !state.id) return;
      state.queue.push({ seq: ++state.seq, ts: Date.now(), kind, p });
      try { sessionStorage.setItem(`sp:recording-buffer:${state.id}`, JSON.stringify(state.queue)); } catch { /* in-memory retry remains available */ }
      if (state.queue.length > 50) void flush();
    };
    state.emit = event;
    const flush = async (keepalive = false) => {
      if (!state.id || state.pushing || !state.queue.length) return;
      state.pushing = true;
      try {
        while (state.queue.length && active) {
          const batch = []; let bytes = 0;
          for (const item of state.queue) {
            const size = new TextEncoder().encode(JSON.stringify(item)).byteLength;
            if (batch.length && (batch.length >= 35 || bytes + size > 1024 * 1024)) break;
            batch.push(item); bytes += size;
          }
          const result = await api.recordingEvents(state.id, batch, keepalive);
          if (!result.ok) break;
          const ack = Number(result.ack) || 0;
          state.queue = state.queue.filter((item) => item.seq > ack);
          if (state.id) { try { sessionStorage.setItem(`sp:recording-buffer:${state.id}`, JSON.stringify(state.queue)); } catch { /* bounded in-memory retry still works */ } }
          if (state.queue.length && state.queue[0].seq > ack + 1) break;
        }
      } catch { /* a full retry remains queued */ }
      finally { state.pushing = false; }
    };
    const caption = (text, anchor, key) => {
      if (key && state.seen.has(key)) return;
      if (key) state.seen.add(key);
      let rect = null;
      try { const r = anchor?.getBoundingClientRect(); if (r && r.width && r.height) rect = { x: r.x, y: r.y, width: r.width, height: r.height }; } catch { /* detached */ }
      event('caption', { text, rect, key, viewport: { width: innerWidth, height: innerHeight } });
    };
    const flushMedia=async()=>{
      if(state.mediaPushing)return;state.mediaPushing=true;
      try{while(state.mediaPending.length){
        const item=state.mediaPending[0];let response;
        for(let attempt=0;attempt<3;attempt++){
          try{response=await api.recordingMedia(state.id,item.seq,item.blob,item.startedAt,item.timeMs);if(response.ok)break;}catch{/* retry exact sequence */}
          await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
        }
        if(!response?.ok){state.mediaError=true;setMessage('画面正在等待上传');break;}
        state.mediaPending.shift();state.mediaError=false;state.lastMediaAckSeq=item.seq;state.lastMediaAckAt=Date.now();
      }}finally{state.mediaPushing=false;}
    };
    globalThis.__SP_RECORD_NOTE__=(text,selector,key)=>caption(text,typeof selector==='string'?document.querySelector(selector):selector,key);
    globalThis.__SP_RECORD_ACTION__ = (action, result) => {
      event('server-action', { action: action?.type || 'unknown', revision: result?.state?.revision, eventTypes: (result?.events || []).map((item) => item.type).filter(Boolean), occurredAt: Date.now() });
      const label = MECHANIC_TEXT[action?.type];
      if (label) caption(label, state.lastAnchor, `action:${action.type}`);
    };
    const onClick = (e) => { state.lastAnchor = e.target?.closest?.('button,[role=button],summary,a') || e.target; };
    document.addEventListener('click', onClick, true);
    const bindDetails = () => {
      for (const details of document.querySelectorAll('details:not([data-record-bound])')) {
        details.dataset.recordBound = '1';
        details.addEventListener('toggle', () => {
          if (!details.open) return;
          const label = details.querySelector('summary')?.textContent?.trim() || '';
          if (label.includes('参考原卡')) caption('打开干员的参考原卡，查看原始卡面记录。', details, 'reference-card');
        });
      }
    };
    const start = async () => {
      if (state.id || state.starting || !active) return;
      state.starting = true;
      try {
        const attachedSessionId = sessionRef.current;
        const started = await api.recordingStart(attachedSessionId, url.searchParams.get('recording') || null, { width: innerWidth, height: innerHeight }, attachedSessionId ? 'independent-game' : 'independent-lobby');
        if (!active || !started.ok) { setMessage('录制暂时不可用'); return; }
        state.id = started.id; state.sessionId = attachedSessionId; state.seq = Number(started.nextSeq) - 1 || 0;
        state.mediaSeq=(Number(started.nextMediaSeq)||1)-1;state.seen=new Set(started.seenMechanisms||[]);
        try {
          const buffered = JSON.parse(sessionStorage.getItem(`sp:recording-buffer:${state.id}`) || '[]');
          state.queue = Array.isArray(buffered) ? buffered.filter((item) => item.seq >= started.nextSeq) : [];
          if (state.queue.length) state.seq = Math.max(state.seq, ...state.queue.map((item) => item.seq));
        } catch { state.queue = []; }
        setRecordId(state.id); setRecording(true);
        url.searchParams.set('recording', state.id); history.replaceState(null, '', url);
        if (started.endedAt) { setRecording(false); setMessage('录制已结束'); return; }
        const rr = globalThis.rrweb;
        if (!rr?.record) { setMessage('页面记录模块未载入'); return; }
        state.rrwebStop = startPageCapture({ rrweb: rr, emit: event, doc: document, win: window });
        const bindViewFrames = () => {
          const view = globalThis.__SP_VIEW__;
          if (!view?.on || state.mediaBoundView === view) return;
          state.mediaViewOff?.();
          state.mediaBoundView = view;
          state.mediaViewOff = view.on('framePainted', () => {
            if (!state.mediaRecorder || state.stopped || state.mediaStartCancelled
              || (state.mediaRecorderStarted && state.mediaRecorder.state === 'inactive')) return;
            const now = performance.now();
            if (now - state.lastCompositeAt < 1000 / 24) return;
            try {
              if (!drawRecordingCanvasFrame(state.captureField, state.frameCacheContext, state.frameCache.width, state.frameCache.height)) return;
              const snapshot = state.frameCacheContext.getImageData(0, 0, state.frameCache.width, state.frameCache.height);
              state.frameCacheContext.putImageData(snapshot, 0, 0);
              state.lastCompositeAt = now; state.lastNativeFrameAt = Date.now(); state.nativeFrameCopies += 1; state.hasPaintedFrame = true;
              if (!state.firstNativeFrameAt) state.firstNativeFrameAt = state.lastNativeFrameAt;
              if (!state.mediaRecorderStarted) state.startMediaCapture?.();
            } catch { state.mediaError = true; }
          });
        };
        const captureCanvas = () => {
          bindViewFrames();
          if (state.mediaRecorder || typeof MediaRecorder !== 'function') return;
          // rrweb owns the HUD; the native media track composites the field's visible
          // render layers (3D board below Pixi when enabled) into one 2D surface.
          const field = document.querySelector('.gm__field');
          const layout = recordingCanvasLayout(field, mediaOptions.maxDimension);
          if (!layout) return;
          try {
            // Copy each visible canvas frame into a dedicated 2D surface. requestFrame() alone still
            // depends on a source-canvas paint, so copying first keeps the media clock advancing
            // during visually static game states without changing pixels in the game canvases.
            const captureSurface = document.createElement('canvas');
            captureSurface.width = layout.width; captureSurface.height = layout.height;
            const frameCache = document.createElement('canvas');
            frameCache.width = layout.width; frameCache.height = layout.height;
            captureSurface.setAttribute('aria-hidden', 'true');
            Object.assign(captureSurface.style, { position: 'fixed', left: '0', top: '0', zIndex: '-1', opacity: '0', pointerEvents: 'none' });
            document.body.appendChild(captureSurface);
            state.captureSurface = captureSurface;
            const captureContext = captureSurface.getContext('2d', { alpha: false });
            const frameCacheContext = frameCache.getContext('2d', { willReadFrequently: true, alpha: false });
            if (!captureContext || !frameCacheContext) { captureSurface.remove(); return; }
            state.captureField = field; state.captureSurface = captureSurface; state.captureContext = captureContext;
            state.frameCache = frameCache; state.frameCacheContext = frameCacheContext;
            const stream = captureSurface.captureStream(0);
            const videoTrack = stream.getVideoTracks()[0];
            if (typeof videoTrack?.requestFrame !== 'function') {
              stream.getTracks().forEach((track) => track.stop());
              captureSurface.remove();
              return;
            }
            const media = state.mediaPipeline = createCanvasMediaRecorder({ stream, options: mediaOptions, onChunk: ({ blob, timecode }) => {
              if (!blob?.size || !state.id) return;
              const seq = ++state.mediaSeq; const elapsedMs = Date.now() - state.mediaStartedAt;
              const timeMs = Math.max(Number.isFinite(timecode) ? timecode : 0, elapsedMs);
              state.mediaLastTimeMs = timeMs;
              state.mediaPending.push({seq,blob,startedAt:state.mediaStartedAt,timeMs});
              state.mediaPush = state.mediaPush.then(flushMedia).catch(() => { state.mediaError = true; });
            }, onError: () => { state.mediaError = true; } });
            const recorder = state.mediaRecorder = media.recorder;
            const mimeType = media.mimeType;
            const paintCaptureFrame = () => {
              state.captureContext.drawImage(state.frameCache, 0, 0, state.captureSurface.width, state.captureSurface.height);
              return true;
            };
            const requestFrame = () => videoTrack.requestFrame();
            const captureFrame = () => {
              captureRecordingMediaFrame(state, { paintCaptureFrame, requestFrame });
            };
            state.startMediaCapture = () => {
              const started = startRecordingMediaAtFirstCapture(state, { paintCaptureFrame, requestFrame }, mediaOptions.timesliceMs);
              if (!started) return false;
              state.mediaCaptureTimer = setInterval(captureFrame, 1000 / mediaOptions.fps);
              event('custom', { tag: 'canvas-media-start', width: captureSurface.width, height: captureSurface.height, mimeType });
              return true;
            };
          } catch { state.captureSurface?.remove(); state.mediaError = true; }
        };
        captureCanvas();
        state.mediaObserver = new MutationObserver(captureCanvas); state.mediaObserver.observe(document.body, { childList: true, subtree: true });
        state.observer = new MutationObserver(bindDetails); state.observer.observe(document.body, { childList: true, subtree: true }); bindDetails();
        timer = state.timer = setInterval(() => { bindViewFrames(); void flush();state.mediaPush=state.mediaPush.then(flushMedia); }, 1000);
        event('custom', { tag: 'recording-start', sessionId: state.sessionId, surface: state.sessionId ? 'independent-game' : 'independent-lobby', viewport: { width: innerWidth, height: innerHeight } });
      } catch { setMessage('录制暂时不可用'); }
      finally { state.starting = false; }
    };
    state.start = start;
    ctx.current = state;
    if (enabled) void start();
    const onHide = () => { void flush(true); };
    window.addEventListener('pagehide', onHide);
    return () => {
      active = false; clearInterval(timer); window.removeEventListener('pagehide', onHide); document.removeEventListener('click', onClick, true);
      state.mediaStartCancelled = true; state.startMediaCapture = null;
      state.rrwebStop?.(); state.observer?.disconnect(); state.mediaObserver?.disconnect(); state.mediaViewOff?.(); state.mediaViewOff = null; state.mediaBoundView = null;
      clearInterval(state.mediaCaptureTimer);
      try { state.mediaRecorder?.stream?.getTracks().forEach((track) => track.stop()); } catch { /* disposed with the page */ }
      state.captureSurface?.remove();
      if (globalThis.__SP_RECORD_ACTION__) delete globalThis.__SP_RECORD_ACTION__;
      if (globalThis.__SP_RECORDING_STATUS__) delete globalThis.__SP_RECORDING_STATUS__;
      delete globalThis.__SP_RECORD_NOTE__;
      ctx.current = null;
    };
  }, []);

  const stop = async () => {
    const state = ctx.current;
    if (!state?.id || state.stopped) return;
    if (!state.mediaRecorderStarted) state.mediaStartCancelled = true;
    state.startMediaCapture = null;
    state.mediaViewOff?.(); state.mediaViewOff = null; state.mediaBoundView = null;
    state.rrwebStop?.(); state.rrwebStop = null;
    if (state.mediaRecorder && state.mediaRecorderStarted) {
      const recorder = state.mediaRecorder;
      clearInterval(state.mediaCaptureTimer); state.mediaCaptureTimer = null;
      state.mediaCaptureStoppedAt = Date.now();
      try { await state.mediaPipeline?.stop(); } catch { try { recorder.stop(); } catch { /* preserve stop path */ } }
      try { state.mediaPipeline?.dispose(); } catch { /* stopped with recorder */ }
      state.captureSurface?.remove();
      state.emit?.('custom', { tag: 'canvas-media-stopped', captureStoppedAt: state.mediaCaptureStoppedAt,
        lastPaintedAt: state.lastCaptureAt, mediaLastTimeMs: state.mediaLastTimeMs, mediaFinalSeq: state.mediaSeq });
      await Promise.race([state.mediaPush, new Promise((resolve) => setTimeout(resolve, 8000))]);
    } else if (state.mediaRecorder) {
      try { state.mediaRecorder.stream.getTracks().forEach((track) => track.stop()); } catch { /* disposed before first media frame */ }
      state.captureSurface?.remove();
    }
    if(state.mediaPending.length||state.mediaPushing){setMessage('画面仍在上传，请稍后再结束录制');return;}
    const drained = await new Promise((resolve) => { const wait = setInterval(() => { if (!state.queue.length && !state.pushing) { clearInterval(wait); resolve(true); } }, 100); setTimeout(() => { clearInterval(wait); resolve(!state.queue.length && !state.pushing); }, 5000); });
    if (!drained) { setMessage('网络恢复后请再次结束录制，未发送的记录仍在等待'); return; }
    clearInterval(state.timer);
    const stopped=await api.recordingStop(state.id, state.mediaCaptureStoppedAt ? {
      mediaCaptureStoppedAt: state.mediaCaptureStoppedAt, mediaCaptureLastTimeMs: state.mediaLastTimeMs,
      mediaCaptureLastPaintedAt: state.lastCaptureAt, mediaCaptureFinalSeq: state.mediaSeq,
    } : {});
    if(!stopped.ok){setMessage('生成回放失败，请再次结束录制');return;}
    if(state.mediaSeq && !stopped.mediaPlaybackReady){setMessage('录制画面正在整理，请稍后再次结束录制');return;}
    state.stopped = true;setRecording(false);
    try { sessionStorage.removeItem(`sp:recording-buffer:${state.id}`); } catch { /* private mode */ }
    const url = new URL(location.href); url.searchParams.delete('record'); history.replaceState(null, '', url); setMessage('录制已结束');
  };
  const playback = recordId ? new URL(`independent-replay.html?recording=${encodeURIComponent(recordId)}`, location.href).href : '';
  return html`<aside class="ix-recording" aria-live="polite">
    <span class=${recording ? 'ix-recording__dot is-live' : 'ix-recording__dot'}></span>
    <span>${message || (recording ? '正在录制' : recordId ? '录制已结束' : '录制未开始')}</span>
    ${!recording && !recordId ? html`<button type="button" onClick=${() => void ctx.current?.start?.()}>开始录制</button>` : null}
    ${recording ? html`<button type="button" onClick=${stop}>结束录制</button>` : null}
    ${playback && !recording ? html`<a href=${playback} target="_blank" rel="noreferrer">打开回放</a>` : null}
  </aside>`;
}
