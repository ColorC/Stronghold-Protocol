// Opt-in remote play recording. rrweb captures the DOM/canvas stream; HTTP batches are an independent,
// acknowledged side channel so a recording outage can never reject a game action.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from '../ui/components.js';
import { api } from './api.js';
import { drawRecordingCanvasFrame, recordingCanvasLayout } from './recordingCanvas.js';

const API = '/independent/api/';
const newUuid = () => crypto.randomUUID();
const MECHANIC_TEXT = Object.freeze({
  buy: '招募一名干员，看看他怎样加入阵容。', equip: '为干员装上装备，观察装备效果如何生效。',
  merge: '合成升阶，让干员获得新的强化。', ready: '整备完成，进入本轮战斗。', upgrade: '提升调度中心等级，解锁更高成长。',
  use: '使用道具，观察它带来的变化。', deploy: '把干员部署到战场位置。', skill: '切换干员技能，查看战斗方式变化。',
});

export function RecordingControls({ sessionId }) {
  const [recording, setRecording] = useState(false);
  const [recordId, setRecordId] = useState('');
  const [message, setMessage] = useState('');
  const ctx = useRef(null);
  useEffect(() => {
    const url = new URL(location.href);
    const enabled = url.searchParams.get('record') === '1' || !!url.searchParams.get('recording');
    if (!enabled) return undefined;
    let active = true; let timer;
    const state = { id: '', seq: 0, queue: [], stopped: false, pushing: false, seen: new Set(), rrwebStop: null, observer: null, lastAnchor: null, timer: null,
      mediaSeq: 0, mediaStartedAt: 0, mediaLastTimeMs: 0, mediaCaptureStoppedAt: 0, mediaRecorder: null, mediaObserver: null, mediaCaptureTimer: null, mediaPush: Promise.resolve(),mediaPending:[],mediaPushing:false, mediaError: false };
    state.captureFrames = 0; state.lastCaptureAt = 0; state.lastMediaAckAt = 0; state.lastMediaAckSeq = 0;
    globalThis.__SP_RECORDING_STATUS__ = () => ({ eventSeq: state.seq, queuedEvents: state.queue.length, pushingEvents: state.pushing,
      mediaSeq: state.mediaSeq, queuedMedia: state.mediaPending.length, pushingMedia: state.mediaPushing, mediaError: state.mediaError,
      recorderState: state.mediaRecorder?.state || null, mediaStartedAt: state.mediaStartedAt || null,
      mediaLastTimeMs: state.mediaLastTimeMs, mediaCaptureStoppedAt: state.mediaCaptureStoppedAt || null,
      captureFrames: state.captureFrames, lastCaptureAt: state.lastCaptureAt || null,
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
      try {
        const started = await api.recordingStart(sessionId, url.searchParams.get('recording') || null, { width: innerWidth, height: innerHeight });
        if (!active || !started.ok) { setMessage('录制暂时不可用'); return; }
        state.id = started.id; state.seq = Number(started.nextSeq) - 1 || 0;
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
        state.rrwebStop = rr.record({ emit: (item) => event('rrweb', item), checkoutEveryNms: 30000,
          recordCanvas: false, sampling: { mousemove: 80, mouseInteraction: true, scroll: 150, input: 'last' },
          maskAllInputs: true, maskInputOptions: { color: true, date: true, 'datetime-local': true, email: true, month: true, number: true, password: true, search: true, tel: true, text: true, time: true, url: true, week: true },
          slimDOMOptions: { script: true, comment: true, headFavicon: true, headWhitespace: true, headMetaDesc: true, headMetaSocial: true, headMetaRobots: true, headMetaHttpEquiv: true, headMetaAuthorship: true, headMetaVerification: true },
        });
        const captureCanvas = () => {
          if (state.mediaRecorder || typeof MediaRecorder !== 'function') return;
          // rrweb owns the HUD; the native media track composites the field's visible
          // render layers (3D board below Pixi when enabled) into one 2D surface.
          const field = document.querySelector('.gm__field');
          const layout = recordingCanvasLayout(field);
          if (!layout) return;
          try {
            // Copy each visible canvas frame into a dedicated 2D surface. requestFrame() alone still
            // depends on a source-canvas paint, so copying first keeps the media clock advancing
            // during visually static game states without changing pixels in the game canvases.
            const captureSurface = document.createElement('canvas');
            captureSurface.width = layout.width; captureSurface.height = layout.height;
            const captureContext = captureSurface.getContext('2d');
            if (!captureContext) return;
            const stream = captureSurface.captureStream(0);
            const videoTrack = stream.getVideoTracks()[0];
            if (typeof videoTrack?.requestFrame !== 'function') {
              stream.getTracks().forEach((track) => track.stop());
              return;
            }
            const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
            if (!mimeType) { stream.getTracks().forEach((track) => track.stop()); return; }
            const recorder = state.mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1800000, videoKeyFrameIntervalDuration: 1000 });
            recorder.addEventListener('dataavailable', (e) => {
              if (!e.data?.size || !state.id) return;
              const seq = ++state.mediaSeq; const elapsedMs = Date.now() - state.mediaStartedAt;
              const timeMs = Math.max(Number.isFinite(e.timecode) ? e.timecode : 0, elapsedMs);
              state.mediaLastTimeMs = timeMs;
              state.mediaPending.push({seq,blob:e.data,startedAt:state.mediaStartedAt,timeMs});
              state.mediaPush = state.mediaPush.then(flushMedia).catch(() => { state.mediaError = true; });
            });
            recorder.addEventListener('error', () => { state.mediaError = true; });
            recorder.start(5000);
            const captureFrame = () => {
              try {
                if (!drawRecordingCanvasFrame(field, captureContext, captureSurface.width, captureSurface.height)) return;
                videoTrack.requestFrame(); state.captureFrames += 1; state.lastCaptureAt = Date.now();
              }
              catch { state.mediaError = true; }
            };
            captureFrame(); state.mediaStartedAt = Date.now();
            state.mediaCaptureTimer = setInterval(captureFrame, 1000 / 24);
            event('custom', { tag: 'canvas-media-start', width: captureSurface.width, height: captureSurface.height, mimeType });
          } catch { state.mediaError = true; }
        };
        captureCanvas();
        state.mediaObserver = new MutationObserver(captureCanvas); state.mediaObserver.observe(document.body, { childList: true, subtree: true });
        state.observer = new MutationObserver(bindDetails); state.observer.observe(document.body, { childList: true, subtree: true }); bindDetails();
        timer = state.timer = setInterval(() => { void flush();state.mediaPush=state.mediaPush.then(flushMedia); }, 1000);
        event('custom', { tag: 'recording-start', sessionId, viewport: { width: innerWidth, height: innerHeight } });
      } catch { setMessage('录制暂时不可用'); }
    };
    void start();
    const onHide = () => { void flush(true); };
    window.addEventListener('pagehide', onHide);
    return () => {
      active = false; clearInterval(timer); window.removeEventListener('pagehide', onHide); document.removeEventListener('click', onClick, true);
      state.rrwebStop?.(); state.observer?.disconnect(); state.mediaObserver?.disconnect();
      clearInterval(state.mediaCaptureTimer);
      try { state.mediaRecorder?.stream?.getTracks().forEach((track) => track.stop()); } catch { /* disposed with the page */ }
      if (globalThis.__SP_RECORD_ACTION__) delete globalThis.__SP_RECORD_ACTION__;
      if (globalThis.__SP_RECORDING_STATUS__) delete globalThis.__SP_RECORDING_STATUS__;
      delete globalThis.__SP_RECORD_NOTE__;
      ctx.current = null;
    };
  }, [sessionId]);

  const stop = async () => {
    const state = ctx.current;
    if (!state?.id || state.stopped) return;
    state.rrwebStop?.(); state.rrwebStop = null;
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      const recorder = state.mediaRecorder;
      clearInterval(state.mediaCaptureTimer); state.mediaCaptureTimer = null;
      state.mediaCaptureStoppedAt = Date.now();
      await new Promise((resolve) => { recorder.addEventListener('stop', resolve, { once: true }); try { recorder.stop(); } catch { resolve(); } });
      try { recorder.stream.getTracks().forEach((track) => track.stop()); } catch { /* stopped with recorder */ }
      state.emit?.('custom', { tag: 'canvas-media-stopped', captureStoppedAt: state.mediaCaptureStoppedAt,
        lastPaintedAt: state.lastCaptureAt, mediaLastTimeMs: state.mediaLastTimeMs, mediaFinalSeq: state.mediaSeq });
      await Promise.race([state.mediaPush, new Promise((resolve) => setTimeout(resolve, 8000))]);
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
  if (!recordId && !message) return null;
  const playback = recordId ? new URL(`independent-replay.html?recording=${encodeURIComponent(recordId)}`, location.href).href : '';
  return html`<aside class="ix-recording" aria-live="polite">
    <span class=${recording ? 'ix-recording__dot is-live' : 'ix-recording__dot'}></span>
    <span>${message || (recording ? '正在录制' : '录制已结束')}</span>
    ${recording ? html`<button type="button" onClick=${stop}>结束录制</button>` : null}
    ${playback && !recording ? html`<a href=${playback} target="_blank" rel="noreferrer">打开回放</a>` : null}
  </aside>`;
}
