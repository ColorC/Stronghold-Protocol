import { rebaseRecordedAssets, timestampRange } from './replayAssets.js';
import { recordingCanvasElements, recordingCanvasField } from './recordingCanvas.js';
import { createReplayCueState } from './replayCueState.js';
import { clampReplayMediaTime } from './replayMediaTime.js';
import { waitForVideoSeek } from './replayReviewSeek.js';
import { applyReplayNarration } from './replayNarration.js';
import { selectionAt } from '../recording/selectionTimeline.js';
import { workshopShowcaseNarration } from './workshopShowcaseNarration.js';
const $ = (id) => document.getElementById(id);
$('open-full').href = location.href;
const reviewMode = new URL(location.href).searchParams.get('review') === '1';
if (reviewMode) {
  document.documentElement.classList.add('ix-replay-review-mode');
  const reviewLayout=document.createElement('style');
  reviewLayout.textContent='.ix-replay-review-mode .ix-replay{width:100%;min-height:100vh;padding:0}.ix-replay-review-mode .ix-replay__shell{width:100%;max-width:none;margin:0}.ix-replay-review-mode .ix-replay__screen{width:100%;max-width:none;margin:0;border:0;border-radius:0}.ix-replay-review-mode .ix-replay__stage{width:100%;height:auto}';
  document.head.append(reviewLayout);
  const narrationLabel=$('narration')?.closest('label');if(narrationLabel){narrationLabel.hidden=true;narrationLabel.style.display='none';}
  for(const element of document.querySelectorAll('.ix-replay__controls,.ix-replay__head')){element.hidden=true;element.style.display='none';}
}
const stage = $('stage'); const status = $('status'); const caption = $('caption'); const anchor = $('anchor');
const timeline = $('timeline'); const playButton = $('play'); const clock = $('clock');
const selection = $('selection');
const textSelection = $('text-selection');
const API = new URL('independent/api/', location.href);
let player; let items = []; let cues = []; let duration = 0; let baseTimestamp = 0; let baseWall = 0; let mediaVideo; let mediaStartSecond = Infinity; let mediaReady = Promise.resolve(); let mediaDuration = 0;
let playing = false; let startedAt = 0; let startedSecond = 0; let raf = 0; let selecting = false; let drag = null;
let zoomRect = null;
let rrOffset = 0; let mediaId = ''; let narrationTimer = 0; let narrating = false; const explained = new Set();
let mediaSegments=[];let activeMediaIndex=0;
let selectionEvents=[];let paintedSelection=null;
let initialized=false;let seeking=false;let seekGeneration=0;
let replayViewport=null;let initializationError='';
const reviewApi={state:()=>({time:Number(timeline.value)||0,duration,ready:initialized&&!seeking,paused:!playing,seeking,viewport:replayViewport,error:initializationError}),getTime:()=>Number(timeline.value)||0,setTime:seek,seek,play,pause};
Object.defineProperty(reviewApi,'duration',{get:()=>duration});
window.__SP_REPLAY_REVIEW__=reviewApi;
const cueState = createReplayCueState(() => cues);
function keepReplayAnimationsVisible() {
  const frame = stage.querySelector('iframe') || player?.iframe; const doc = frame?.contentDocument;
  if (!doc?.head || doc.getElementById('sp-replay-animation-playback')) return;
  const style = doc.createElement('style'); style.id = 'sp-replay-animation-playback';
  style.textContent = 'html.rrweb-paused *, html.rrweb-paused *::before, html.rrweb-paused *::after { animation-play-state: running !important; }';
  doc.head.append(style);
}
function paintMediaLayer() {
  const frame = stage.querySelector('iframe') || player?.iframe;
  if (frame) frame.style.pointerEvents = selecting ? 'none' : 'auto';
  if (!mediaVideo) return;
  const doc = frame?.contentDocument; const field = recordingCanvasField(doc);
  if (!field || !frame) { mediaVideo.hidden = true; return; }
  const fb = frame.getBoundingClientRect(), sb = stage.getBoundingClientRect(), cb = field.getBoundingClientRect();
  const outerScale = sb.width / Math.max(1, stage.clientWidth), sx = fb.width / Math.max(1, frame.clientWidth), sy = fb.height / Math.max(1, frame.clientHeight);
  Object.assign(mediaVideo.style, { left: `${(fb.left-sb.left+cb.left*sx)/outerScale}px`, top: `${(fb.top-sb.top+cb.top*sy)/outerScale}px`, width: `${cb.width*sx/outerScale}px`, height: `${cb.height*sy/outerScale}px` });
  // Keep the recorded HUD above the native video. A WebM inside the replay iframe
  // does not composite reliably on software WebGL, so only the canvas pixels live outside it.
  frame.style.position = 'relative'; frame.style.zIndex = '5';
  for(let node=frame.parentElement;node&&node!==stage;node=node.parentElement){node.style.position='relative';node.style.zIndex='5';node.style.background='transparent';}
  for (const canvas of recordingCanvasElements(doc)) canvas.style.visibility = 'hidden';
  for(let node=field;node;node=node.parentElement){node.style.backgroundColor='transparent';node.style.backgroundImage='none';}
  doc.documentElement.style.background='transparent';
  mediaVideo.hidden = Number(timeline.value) < mediaStartSecond;
}
function fitReplay() {
  const frame = stage.querySelector('iframe') || player?.iframe;
  if(frame){frame.style.transform=`scale(${stage.clientWidth/Math.max(1,parseFloat(frame.style.width)||frame.clientWidth)})`;}
  paintMediaLayer();
}
const fmt = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const paintCue = (second) => {
  const cue = cueState.current(second);
  caption.textContent = cue?.text || '';
  caption.hidden = !cue;
  anchor.hidden = !cue?.rect;
  if (cue?.rect) {
    const frame = stage.querySelector('iframe'); const screen = stage.parentElement.getBoundingClientRect(); const bounds = frame?.getBoundingClientRect();
    const vw = cue.viewport?.width || 1280; const vh = cue.viewport?.height || 720;
    if (bounds) {
      const sx = bounds.width / vw; const sy = bounds.height / vh;
      anchor.style.left = `${bounds.left - screen.left + cue.rect.x * sx}px`; anchor.style.top = `${bounds.top - screen.top + cue.rect.y * sy}px`;
      anchor.style.width = `${cue.rect.width * sx}px`; anchor.style.height = `${cue.rect.height * sy}px`;
    } else anchor.hidden = true;
  }
  if (!cue || !cue.rect || !zoomRect) {
    document.documentElement.style.removeProperty('--ix-cue-x'); document.documentElement.style.removeProperty('--ix-cue-y');
  }
};
function position(second) {
  timeline.value = String(second); clock.textContent = `${fmt(second)} / ${fmt(duration)}`; paintCue(second); paintTextSelection(second);
  if (mediaVideo && !playing) syncMediaTime(second);
  paintMediaLayer();
}
function paintTextSelection(second) {
  const current = selectionAt(selectionEvents, second);
  if (current === paintedSelection) return;
  paintedSelection = current;
  textSelection.replaceChildren();
  if (!current) { textSelection.hidden = true; return; }
  const frame = stage.querySelector('iframe') || player?.iframe;
  const screen = stage.parentElement.getBoundingClientRect(); const bounds = frame?.getBoundingClientRect();
  if (!bounds) { textSelection.hidden = true; return; }
  const viewport = current.p.viewport || { width: 1280, height: 720 };
  const sx = bounds.width / Math.max(1, viewport.width); const sy = bounds.height / Math.max(1, viewport.height);
  const outerScale = screen.width / Math.max(1, stage.clientWidth);
  for (const rect of current.p.rects || []) {
    const mark = document.createElement('span'); mark.className = 'ix-replay__text-selection-rect';
    Object.assign(mark.style, {
      left: `${(bounds.left - screen.left + rect.x * sx) / outerScale}px`,
      top: `${(bounds.top - screen.top + rect.y * sy) / outerScale}px`,
      width: `${rect.width * sx / outerScale}px`, height: `${rect.height * sy / outerScale}px`,
    });
    textSelection.append(mark);
  }
  const label = document.createElement('span'); label.className = 'ix-replay__text-selection-label';
  label.textContent = current.p.text || '';
  const first = current.p.rects?.[0];
  if (first) Object.assign(label.style, { left: `${Math.max(0, (bounds.left - screen.left + first.x * sx) / outerScale)}px`, top: `${Math.max(0, (bounds.top - screen.top + first.y * sy) / outerScale - 28)}px` });
  textSelection.append(label); textSelection.hidden = false;
}
function loadMediaSegment(segment) {
  activeMediaIndex=segment.index;
  mediaReady=new Promise((resolve,reject)=>{
    let timer=setTimeout(()=>finish(new Error('等待回放视频载入超时')),10000);
    const cleanup=()=>{clearTimeout(timer);mediaVideo.removeEventListener('loadedmetadata',onReady);mediaVideo.removeEventListener('error',onError);};
    const finish=error=>{cleanup();if(error)reject(error);else{mediaDuration=Number.isFinite(mediaVideo.duration)?mediaVideo.duration:segment.duration;resolve();}};
    const onReady=()=>finish();const onError=()=>finish(new Error('回放视频载入失败'));
    mediaVideo.addEventListener('loadedmetadata',onReady,{once:true});mediaVideo.addEventListener('error',onError,{once:true});
    mediaVideo.src=new URL(`recordings/${encodeURIComponent(mediaId)}/media/playback/${segment.index}`,API).href;
    mediaVideo.load();
  });
  void mediaReady.catch(error=>{status.textContent=error.message||'回放视频载入失败';});
  return mediaReady;
}
function waitForReplayPaint() {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('等待回放画面更新超时')),8000);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));
  });
}
function syncMediaTime(second) {
  if (!mediaVideo) return;
  const segment=[...mediaSegments].reverse().find(x=>second>=x.at)||mediaSegments[0];
  if(segment&&activeMediaIndex!==segment.index)void loadMediaSegment(segment).then(()=>{syncMediaTime(Number(timeline.value));if(playing)void mediaVideo.play().catch(()=>{});}).catch(error=>{status.textContent=error.message||'回放视频载入失败';});
  if(second<mediaStartSecond){mediaVideo.pause();return;}
  const time = Math.max(0, (second - (segment?.at??mediaStartSecond)));
  if (mediaDuration > 0) {
    const seekTime = clampReplayMediaTime(time, mediaDuration);
    try { if (Math.abs(mediaVideo.currentTime - seekTime) > 0.4) mediaVideo.currentTime = seekTime; } catch { /* metadata may still be loading */ }
  }
}
function attachCanvasMedia(id) {
  mediaId=id;
  const frame = stage.querySelector('iframe') || player?.iframe; const doc = frame?.contentDocument; const field = recordingCanvasField(doc);
  if (!mediaVideo || mediaVideo.ownerDocument !== document) {
    mediaVideo = document.createElement('video'); mediaVideo.muted = true; mediaVideo.playsInline = true; mediaVideo.preload = 'auto';
    mediaVideo.dataset.spCanvasMedia = '1';
    Object.assign(mediaVideo.style, { position: 'absolute', objectFit: 'fill', pointerEvents: 'none', zIndex: '4', background: '#08090c' });
    mediaReady=Promise.resolve();
  }
  if (!mediaVideo.isConnected) stage.appendChild(mediaVideo);
  if (field) for (const canvas of recordingCanvasElements(doc)) canvas.style.visibility = 'hidden';
  syncMediaTime(Number(timeline.value));
  fitReplay();
}
function offset() { return playing ? Math.min(duration, startedSecond + (performance.now() - startedAt) / 1000) : Number(timeline.value); }
function tick() {
  if (!playing) return;
  const now = offset(); position(now);syncMediaTime(now);
  const cue = cueState.narration(now, explained);
  if(cue&&$('narration')?.checked){
    explained.add(cue.key||cue.text);cueState.activate(cue);narrating=true;pause();
    if(cue.rect){const vw=cue.viewport?.width||1280,vh=cue.viewport?.height||720;
      const w=stage.clientWidth,h=stage.clientHeight,rect={localX:cue.rect.x*w/vw,localY:cue.rect.y*h/vh,width:cue.rect.width*w/vw,height:cue.rect.height*h/vh};
      zoomArea(rect);paintCue(now);
    }
    caption.textContent=cue.text;caption.hidden=false;
    narrationTimer=setTimeout(()=>{resetZoom();play();},Math.max(4000,Math.min(8000,cue.text.length*110)));
    return;
  }
  if (now >= duration) { pause(); return; }
  raf = requestAnimationFrame(tick);
}
function play() {
  if (playing || !player) return;
  playing = true; startedAt = performance.now(); startedSecond = Number(timeline.value);
  player.play(Math.max(0,startedSecond-rrOffset) * 1000); syncMediaTime(startedSecond);if (mediaVideo && startedSecond >= mediaStartSecond) { void mediaVideo.play().catch(() => {}); }
  playButton.textContent = '暂停'; raf = requestAnimationFrame(tick);
}
function pause() {
  if (!playing) return;
  const now = offset(); playing = false; cancelAnimationFrame(raf); player?.pause(); keepReplayAnimationsVisible(); mediaVideo?.pause(); timeline.value = String(now); position(now); playButton.textContent = '播放';
}
async function seek(value) {
  const generation=++seekGeneration;
  const second = Math.max(0, Math.min(duration, Number(value) || 0));
  seeking=true;
  const resume = playing; playing = false; cancelAnimationFrame(raf); player?.pause(); mediaVideo?.pause(); keepReplayAnimationsVisible();
  clearTimeout(narrationTimer);narrating=false;resetZoom();
  try {
    timeline.value = String(second); position(second); player?.play(Math.max(0,second-rrOffset) * 1000);
    await waitForReplayPaint();
    if(generation!==seekGeneration)throw new DOMException('定位已被更新的操作取代','AbortError');
    player?.pause(); keepReplayAnimationsVisible(); attachCanvasMedia(new URL(location.href).searchParams.get('recording'));
    if (mediaVideo && second >= mediaStartSecond) {
      const segment=[...mediaSegments].reverse().find(x=>second>=x.at)||mediaSegments[0];
      if(segment&&activeMediaIndex!==segment.index)await loadMediaSegment(segment);
      else await mediaReady;
      if(generation!==seekGeneration)throw new DOMException('定位已被更新的操作取代','AbortError');
      const target=clampReplayMediaTime(Math.max(0,second-(segment?.at??mediaStartSecond)),mediaDuration);
      if(Math.abs(mediaVideo.currentTime-target)>0.035||mediaVideo.readyState<2||mediaVideo.seeking)await waitForVideoSeek(mediaVideo,target);
    }
    if(generation!==seekGeneration)throw new DOMException('定位已被更新的操作取代','AbortError');
    if (resume) { playing = false; play(); }
    return second;
  } finally {
    if(generation===seekGeneration)seeking=false;
  }
}
playButton.addEventListener('click', () => {if(narrating){resetZoom();play();}else playing ? pause() : play();});
timeline.addEventListener('input', () => { const requestedSecond = timeline.value; if (playing) pause(); void seek(requestedSecond).catch(error=>{if(error?.name!=='AbortError')status.textContent=error.message||'回放定位失败';}); });
$('zoom').addEventListener('click', () => { selecting = true; paintMediaLayer(); status.textContent = '在画面上拖动，框选要放大的区域。'; });
function resetZoom(){clearTimeout(narrationTimer);narrationTimer=0;narrating=false;cueState.clear();zoomRect=null;stage.style.transform='';stage.style.transformOrigin='';selection.hidden=true;selecting=false;paintMediaLayer();paintCue(Number(timeline.value));}
function zoomArea(rect){
  zoomRect=rect;const w=stage.clientWidth,h=stage.clientHeight;
  const scale=Math.min(2,Math.max(1.15,Math.min(w*.8/Math.max(1,rect.width),h*.8/Math.max(1,rect.height))));
  const tx=Math.max(w*(1-scale),Math.min(0,w/2-(rect.localX+rect.width/2)*scale));
  const ty=Math.max(h*(1-scale),Math.min(0,h/2-(rect.localY+rect.height/2)*scale));
  stage.style.transformOrigin='0 0';stage.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;paintMediaLayer();
}
$('reset').addEventListener('click', () => {resetZoom();status.textContent='';});
stage.parentElement.addEventListener('pointerdown', (e) => {
  if (!selecting) return; const rect = stage.getBoundingClientRect();
  drag = { x: e.clientX, y: e.clientY, rect }; selection.hidden = false; selection.style.left = `${e.clientX - rect.left}px`; selection.style.top = `${e.clientY - rect.top}px`; selection.style.width = '0'; selection.style.height = '0';
  stage.parentElement.setPointerCapture(e.pointerId);
});
stage.parentElement.addEventListener('pointermove', (e) => {
  if (!drag) return; const x = Math.min(Math.max(e.clientX, drag.rect.left), drag.rect.right); const y = Math.min(Math.max(e.clientY, drag.rect.top), drag.rect.bottom);
  selection.style.left = `${Math.min(drag.x, x) - drag.rect.left}px`; selection.style.top = `${Math.min(drag.y, y) - drag.rect.top}px`; selection.style.width = `${Math.abs(x - drag.x)}px`; selection.style.height = `${Math.abs(y - drag.y)}px`;
});
stage.parentElement.addEventListener('pointerup', (e) => {
  if (!drag) return; const x = Math.min(Math.max(e.clientX, drag.rect.left), drag.rect.right); const y = Math.min(Math.max(e.clientY, drag.rect.top), drag.rect.bottom);
  const width = Math.abs(x - drag.x); const height = Math.abs(y - drag.y); const localX = Math.min(drag.x, x) - drag.rect.left; const localY = Math.min(drag.y, y) - drag.rect.top;
  drag = null; selecting = false; paintMediaLayer();
  if (width > 12 && height > 12) {zoomArea({localX,localY,width,height});status.textContent='放大查看中，可点「还原画面」回到全景。';}
});

(async () => {
  const id = new URL(location.href).searchParams.get('recording');
  if (!id) throw new Error('没有指定本局回放');
  const response = await fetch(new URL(`recordings/${encodeURIComponent(id)}`, API), { credentials: 'same-origin' });
  const packet = await response.json(); if (!response.ok || !packet.ok) throw new Error('无法载入本局回放');
  const records = packet.events || []; items = records.filter((e) => e.kind === 'rrweb').map((e) => e.p); rebaseRecordedAssets(items);
  const recordedCues = records.filter((e) => e.kind === 'caption' && e.p?.text).map((e) => ({ at: Math.max(0, (e.ts - Date.parse(packet.meta.startedAt)) / 1000), ...e.p }));
  selectionEvents = records.filter((e) => e.kind === 'selection').map((e) => ({ at: Math.max(0, (e.ts - Date.parse(packet.meta.startedAt)) / 1000), p: e.p })).sort((a, b) => a.at - b.at);
  cues = applyReplayNarration(id, recordedCues, workshopShowcaseNarration);
  if (!items.length || !globalThis.rrweb?.Replayer) throw new Error('这段记录还没有可播放的画面');
  const visibleRecords = records.filter((event) => !(event.kind === 'custom' && event.p?.tag === 'canvas-media-stopped'));
  const { min: firstTimestamp, max: last } = timestampRange(items, (event) => event.timestamp);
  baseTimestamp = firstTimestamp;
  const wallEnd = visibleRecords.length ? timestampRange(visibleRecords, (event) => event.ts || 0).max : Date.parse(packet.meta.startedAt);
  const captureEnd = Date.parse(packet.meta.mediaCaptureStoppedAt || packet.meta.endedAt || packet.meta.startedAt);
  baseWall = Date.parse(packet.meta.startedAt); duration = Math.max(1, (wallEnd - baseWall) / 1000, (last - baseTimestamp) / 1000,(captureEnd-baseWall)/1000);
  rrOffset=(baseTimestamp-baseWall)/1000;
  if (packet.meta.mediaStartedAt) mediaStartSecond = Math.max(0, (Date.parse(packet.meta.mediaStartedAt) - baseWall) / 1000);
  mediaDuration = (Number(packet.meta.mediaLastTimeMs) || 0) / 1000;
  const validSegments=(packet.meta.mediaSegments||[]).filter(x=>Number.isInteger(x.index)&&typeof x.startedAt==='string');
  mediaSegments=(validSegments.length?validSegments:packet.meta.mediaStartedAt?[{index:1,startedAt:packet.meta.mediaStartedAt,lastTimeMs:packet.meta.mediaLastTimeMs}]:[]).map(x=>({...x,at:Math.max(0,(Date.parse(x.startedAt)-baseWall)/1000),duration:(x.lastTimeMs||0)/1000}));
  timeline.max = String(duration); timeline.step = '0.05';
  const width = packet.meta.viewport?.width || 1280; const height = packet.meta.viewport?.height || 720;
  replayViewport={width,height};
  stage.style.aspectRatio = `${width} / ${height}`; stage.style.setProperty('--ix-frame-width', `${width}px`); stage.style.setProperty('--ix-frame-height', `${height}px`);
  player = new rrweb.Replayer(items, { root: stage, width, height, skipInactive: false, showWarning: false, showDebug: false, mouseTail: false, UNSAFE_replayCanvas: true });
  // Replayer construction sets up its sandbox but does not paint the full snapshot until the timeline advances.
  // Render the first recorded frame before enabling controls so a replay link never opens on a blank stage.
  const firstVisibleSecond = 0;
  player.play(Math.max(0,firstVisibleSecond-rrOffset) * 1000);
  // Let CSS transitions present in the captured page finish while the replay clock advances.
  await new Promise((resolve) => setTimeout(resolve, 900));
  player.pause(); keepReplayAnimationsVisible();
  timeline.value = String(Math.min(duration, firstVisibleSecond)); position(Number(timeline.value)); attachCanvasMedia(id);
  if (mediaVideo) {
    await mediaReady; syncMediaTime(Number(timeline.value));
    if (Number(timeline.value) >= mediaStartSecond) {
      const segment=[...mediaSegments].reverse().find(x=>Number(timeline.value)>=x.at)||mediaSegments[0];
      const target=clampReplayMediaTime(Math.max(0,Number(timeline.value)-(segment?.at??mediaStartSecond)),mediaDuration);
      await waitForVideoSeek(mediaVideo,target);
      mediaVideo.pause();
    }
  }
  status.textContent = packet.meta.endedAt ? '记录已结束' : '正在记录的本局';
  initialized=true;
  new ResizeObserver(fitReplay).observe(stage.parentElement);
})().catch((error) => {
  status.textContent = error.message || '回放载入失败';
  if(reviewMode)initializationError='回放载入失败，请检查链接或稍后重试。';
});

window.addEventListener('pagehide', () => {cancelAnimationFrame(raf);clearTimeout(narrationTimer);player?.pause();mediaVideo?.pause();});
