// 进击 replay page: rrweb replays the recorded DOM and interaction; the natively recorded board video is painted into
// the recorded field element on the same clock; the subtitle track is an overlay read from captions.json.
import { rebaseRecordedAssets, timestampRange } from './replayAssets.js';
import { recordingCanvasElements, recordingCanvasField } from './recorderCanvas.js';
import { clampReplayMediaTime } from './replayMediaTime.js';
import { waitForVideoSeek } from './replayReviewSeek.js';
import { createReplayMediaSurface } from './replayMediaSurface.js';
import { captionAt, normalizeCaptions } from './replayCaptions.js';

const $ = (id) => document.getElementById(id);
const params = new URL(location.href).searchParams;
const reviewMode = params.get('review') === '1';
const filmMode = params.get('film') === '1';
const captionsWanted = params.get('captions') !== '0';
if (reviewMode || filmMode) {
  document.documentElement.classList.add('ar-review-mode');
  for (const element of document.querySelectorAll('.ar-replay__controls,.ar-replay__head')) element.hidden = true;
}
const stage = $('stage'); const status = $('status'); const caption = $('caption');
const timeline = $('timeline'); const playButton = $('play'); const clock = $('clock'); const captionToggle = $('captions');
if (captionToggle) captionToggle.checked = captionsWanted;
const API = new URL('api/assault/', location.href);
let player; let captions = []; let duration = 0; let baseTimestamp = 0; let baseWall = 0; let rrOffset = 0; let rrMinimumOffsetMs = 0;
let mediaVideo = null; let mediaSurface = null; let mediaSegments = []; let activeMediaKey = ''; let mediaReady = Promise.resolve(); let mediaDuration = 0;
let mediaLoadGeneration = 0; let cancelMediaLoad = null; let mediaSeekController = null; const blobUrls = new Map();
let playing = false; let startedAt = 0; let startedSecond = 0; let raf = 0;
let initialized = false; let seeking = false; let seekGeneration = 0; let playheadSecond = 0; let replayViewport = null; let initializationError = '';

const reviewApi = { state: () => ({ time: playheadSecond, duration, ready: initialized && !seeking, paused: !playing, seeking, viewport: replayViewport, error: initializationError }),
  getTime: () => playheadSecond, setTime: seek, seek, play, pause };
Object.defineProperty(reviewApi, 'duration', { get: () => duration });
window.__SP_REPLAY_REVIEW__ = reviewApi;
window.__SP_REPLAY_DONE__ = false;

const abortError = () => new DOMException('回放媒体载入已被更新的操作取代', 'AbortError');
const fmt = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const replayFrame = () => stage.querySelector('iframe') || player?.iframe;

function keepReplayAnimationsVisible() {
  const doc = replayFrame()?.contentDocument;
  if (!doc?.head || doc.getElementById('ar-replay-animation-playback')) return;
  const style = doc.createElement('style'); style.id = 'ar-replay-animation-playback';
  style.textContent = 'html.rrweb-paused *, html.rrweb-paused *::before, html.rrweb-paused *::after { animation-play-state: running !important; } .rr-block { display: none !important; }';
  doc.head.append(style);
}
function cancelPendingMediaSeek() { mediaSeekController?.abort(); mediaSeekController = null; }
const mediaSourceAt = (second) => [...mediaSegments].reverse().find((segment) => second >= segment.at) || null;
const mediaDurationForClamp = () => (Number.isFinite(mediaVideo?.duration) && mediaVideo.duration > 0 ? mediaVideo.duration : mediaDuration);

/**
 * The recorded game canvas is shown by a 2D canvas that lives in this page, under the transparent rrweb frame: a canvas inside the
 * replay frame never reaches the screen (Chrome does not composite it there), while DOM overlays in the frame stay on top of it.
 */
function paintMediaLayer() {
  const frame = replayFrame();
  if (!mediaVideo) return;
  const doc = frame?.contentDocument; const field = recordingCanvasField(doc);
  if (!field || !frame) { mediaVideo.hidden = true; mediaSurface?.hide(); return; }
  if (!mediaSurface?.canvas.isConnected || mediaSurface.canvas.parentElement !== stage) { mediaSurface?.destroy(); mediaSurface = createReplayMediaSurface(stage); mediaSurface.canvas.style.zIndex = '0'; stage.insertBefore(mediaSurface.canvas, stage.firstChild); }
  const frameBox = frame.getBoundingClientRect(); const stageBox = stage.getBoundingClientRect(); const fieldBox = field.getBoundingClientRect();
  const scale = frameBox.width / Math.max(1, frame.clientWidth);
  mediaSurface.setBounds({ left: frameBox.left - stageBox.left + fieldBox.left * scale, top: frameBox.top - stageBox.top + fieldBox.top * scale, width: fieldBox.width * scale, height: fieldBox.height * scale });
  const wrapper = frame.parentElement; if (wrapper && wrapper.style.zIndex !== '1') { wrapper.style.position = 'relative'; wrapper.style.zIndex = '1'; }
  if (doc?.head && !doc.getElementById('ar-replay-canvas-layer')) {
    const style = doc.createElement('style'); style.id = 'ar-replay-canvas-layer';
    style.textContent = 'html, body { background: transparent !important; } .gm__field canvas, canvas[aria-hidden="true"] { display: none !important; visibility: hidden !important; }';
    doc.head.append(style);
  }
  for (const canvas of recordingCanvasElements(doc)) { canvas.style.visibility = 'hidden'; canvas.style.display = 'none'; }
  const desired = mediaSourceAt(playheadSecond);
  const matches = !!desired && activeMediaKey === desired.key && mediaVideo.currentSrc === desired.objectUrl;
  mediaVideo.hidden = !matches;
  if (matches && mediaVideo.readyState >= 2 && !mediaVideo.seeking) mediaSurface.paint(mediaVideo);
  else if (!desired) mediaSurface?.hide();
}
function fitReplay() {
  const frame = replayFrame();
  if (frame) {
    const wrapper = stage.querySelector('.replayer-wrapper') || frame.parentElement;
    const scale = stage.clientWidth / Math.max(1, frame.clientWidth);
    frame.style.transform = 'none';
    if (wrapper) { wrapper.style.width = `${frame.clientWidth}px`; wrapper.style.height = `${frame.clientHeight}px`; wrapper.style.transformOrigin = '0 0'; wrapper.style.transform = `scale(${scale})`; }
    stage.style.height = `${frame.clientHeight * scale}px`;
  }
  paintMediaLayer();
}
function paintCaption(second) {
  const cue = captionToggle?.checked === false ? null : captionAt(captions, second);
  const text = cue?.text || '';
  if (caption.textContent !== text) caption.textContent = text;
  caption.hidden = !text;
}
function position(second) {
  playheadSecond = second; timeline.value = String(second); clock.textContent = `${fmt(second)} / ${fmt(duration)}`; paintCaption(second);
  if (mediaVideo && !playing && !seeking) syncMediaTime(second);
  paintMediaLayer();
}

async function fetchSegmentBlob(segment) {
  if (blobUrls.has(segment.key)) return blobUrls.get(segment.key);
  const response = await fetch(segment.url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('回放视频载入失败');
  const objectUrl = URL.createObjectURL(await response.blob());
  blobUrls.set(segment.key, objectUrl);
  return objectUrl;
}
/** A MediaRecorder file declares no duration: ask the decoder to run to the end once so seeking and duration work. */
async function settleDuration(video, fallback) {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  await new Promise((resolve) => {
    const done = () => { video.removeEventListener('durationchange', onChange); resolve(); };
    const onChange = () => { if (Number.isFinite(video.duration)) done(); };
    video.addEventListener('durationchange', onChange);
    setTimeout(done, 8000);
    try { video.currentTime = 1e7; } catch { done(); }
  });
  const found = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : fallback;
  try { video.currentTime = 0; } catch { /* metadata still loading */ }
  return found;
}
function loadMediaSegment(segment) {
  if (activeMediaKey === segment.key && mediaVideo?.currentSrc === segment.objectUrl && (mediaVideo.readyState >= 1 || cancelMediaLoad)) return mediaReady;
  cancelMediaLoad?.(abortError());
  const generation = ++mediaLoadGeneration;
  activeMediaKey = segment.key;
  mediaVideo.pause(); mediaVideo.hidden = true;
  mediaReady = (async () => {
    segment.objectUrl = await fetchSegmentBlob(segment);
    if (generation !== mediaLoadGeneration) throw abortError();
    await new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); mediaVideo.removeEventListener('loadedmetadata', onReady); mediaVideo.removeEventListener('error', onError); if (cancelMediaLoad === cancel) cancelMediaLoad = null; };
      const onReady = () => { cleanup(); generation !== mediaLoadGeneration ? reject(abortError()) : resolve(); };
      const onError = () => { cleanup(); reject(new Error('回放视频载入失败')); };
      const cancel = (error) => { cleanup(); reject(error || abortError()); };
      cancelMediaLoad = cancel;
      timer = setTimeout(() => { cleanup(); reject(new Error('等待回放视频载入超时')); }, 60000);
      mediaVideo.addEventListener('loadedmetadata', onReady); mediaVideo.addEventListener('error', onError);
      mediaVideo.src = segment.objectUrl; mediaVideo.load();
    });
    mediaDuration = await settleDuration(mediaVideo, segment.duration);
  })();
  void mediaReady.catch((error) => { if (error?.name !== 'AbortError') status.textContent = error.message || '回放视频载入失败'; });
  return mediaReady;
}
function waitForReplayPaint() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待回放画面更新超时')), 8000);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
  });
}
async function waitForRecordedFonts() {
  const doc = replayFrame()?.contentDocument;
  if (!doc?.fonts?.ready) return;
  let timer;
  await Promise.race([doc.fonts.ready, new Promise((resolve) => { timer = setTimeout(resolve, 2000); })]);
  clearTimeout(timer);
}
function mediaNeedsLoad(second) {
  const segment = mediaSourceAt(second);
  if (!segment) return null;
  return activeMediaKey !== segment.key || mediaVideo?.readyState < 1 || mediaVideo?.currentSrc !== segment.objectUrl ? segment : null;
}
async function positionMediaAt(second, generation = seekGeneration) {
  if (!mediaVideo) return null;
  const segment = mediaSourceAt(second);
  if (!segment) { cancelMediaLoad?.(abortError()); activeMediaKey = ''; mediaVideo.pause(); mediaVideo.hidden = true; mediaSurface?.hide(); return null; }
  if (mediaNeedsLoad(second)) await loadMediaSegment(segment);
  if (generation !== seekGeneration) throw abortError();
  const target = clampReplayMediaTime(Math.max(0, second - segment.at), mediaDurationForClamp());
  const controller = new AbortController();
  cancelPendingMediaSeek(); mediaSeekController = controller;
  try { await waitForVideoSeek(mediaVideo, target, { signal: controller.signal }); }
  finally { if (mediaSeekController === controller) mediaSeekController = null; }
  if (generation !== seekGeneration) throw abortError();
  paintMediaLayer();
  return segment;
}
function syncMediaTime(second) {
  if (!mediaVideo) return;
  const segment = mediaSourceAt(second);
  if (!segment || activeMediaKey !== segment.key || mediaVideo.readyState < 1 || mediaVideo.currentSrc !== segment.objectUrl) { mediaVideo.pause(); mediaVideo.hidden = true; return; }
  const time = clampReplayMediaTime(Math.max(0, second - segment.at), mediaDurationForClamp());
  try { if (Math.abs(mediaVideo.currentTime - time) > 0.4 && !mediaVideo.seeking) mediaVideo.currentTime = time; } catch { /* metadata may still be loading */ }
}
function attachCanvasMedia() {
  if (!mediaSegments.length) { fitReplay(); return; }
  if (!mediaVideo || mediaVideo.ownerDocument !== document) {
    mediaVideo = document.createElement('video'); mediaVideo.muted = true; mediaVideo.playsInline = true; mediaVideo.preload = 'auto';
    Object.assign(mediaVideo.style, { display: 'none', pointerEvents: 'none' });
    for (const type of ['seeked', 'loadeddata']) mediaVideo.addEventListener(type, () => paintMediaLayer()); // a paused seek in a long recording lands after position() ran
    mediaReady = Promise.resolve();
  }
  if (!mediaVideo.isConnected) stage.appendChild(mediaVideo);
  fitReplay();
}
const replayerTime = (second) => Math.max(rrMinimumOffsetMs, Math.max(0, second - rrOffset) * 1000);
const offset = () => (playing ? Math.min(duration, startedSecond + (performance.now() - startedAt) / 1000) : playheadSecond);
const loadFailure = (error) => { if (error?.name !== 'AbortError') status.textContent = error.message || '回放视频载入失败'; };

function tick() {
  if (!playing) return;
  const now = offset();
  if (mediaNeedsLoad(now)) { void seek(now, { resumeAfter: true }).catch(loadFailure); return; }
  position(now); syncMediaTime(now);
  if (now >= duration) { pause(); window.__SP_REPLAY_DONE__ = true; return; }
  raf = requestAnimationFrame(tick);
}
function play() {
  if (playing || !player || seeking) return;
  const second = playheadSecond >= duration ? 0 : playheadSecond;
  if (second !== playheadSecond) { void seek(0, { resumeAfter: true }).catch(loadFailure); return; }
  if (mediaNeedsLoad(second)) { void seek(second, { resumeAfter: true }).catch(loadFailure); return; }
  window.__SP_REPLAY_DONE__ = false;
  playing = true; startedAt = performance.now(); startedSecond = playheadSecond;
  player.play(replayerTime(startedSecond)); syncMediaTime(startedSecond);
  const segment = mediaSourceAt(startedSecond);
  if (mediaVideo && segment) { void mediaVideo.play().catch(() => {}); }
  playButton.textContent = '暂停'; raf = requestAnimationFrame(tick);
}
function pause() {
  const now = playing ? offset() : playheadSecond;
  cancelPendingMediaSeek();
  const generation = ++seekGeneration; seeking = false;
  playing = false; cancelAnimationFrame(raf); player?.pause(); keepReplayAnimationsVisible(); mediaVideo?.pause(); timeline.value = String(now); position(now); playButton.textContent = '播放';
  if (mediaVideo) void positionMediaAt(now, generation).catch((error) => { if (generation === seekGeneration) loadFailure(error); });
}
async function seek(value, { resumeAfter } = {}) {
  cancelPendingMediaSeek();
  const generation = ++seekGeneration;
  const second = Math.max(0, Math.min(duration, Number(value) || 0));
  seeking = true;
  const resume = resumeAfter ?? playing; playing = false; cancelAnimationFrame(raf); player?.pause(); mediaVideo?.pause(); keepReplayAnimationsVisible();
  try {
    position(second); player?.pause(replayerTime(second)); keepReplayAnimationsVisible();
    await waitForReplayPaint();
    await waitForRecordedFonts();
    if (generation !== seekGeneration) throw abortError();
    player?.pause(); keepReplayAnimationsVisible(); attachCanvasMedia();
    if (mediaVideo) await positionMediaAt(second, generation);
    if (generation !== seekGeneration) throw abortError();
    if (resume) { playing = false; seeking = false; play(); }
    return second;
  } catch (error) {
    if (generation !== seekGeneration) throw abortError();
    throw error;
  } finally {
    if (generation === seekGeneration) seeking = false;
  }
}
playButton.addEventListener('click', () => { if (playing) pause(); else play(); });
timeline.addEventListener('input', () => { const requested = timeline.value; if (playing) pause(); void seek(requested).catch(loadFailure); });
captionToggle?.addEventListener('change', () => paintCaption(playheadSecond));

(async () => {
  const id = params.get('recording');
  if (!id) throw new Error('没有指定本局回放');
  const response = await fetch(new URL(`recordings/${encodeURIComponent(id)}`, API), { credentials: 'same-origin' });
  const packet = await response.json(); if (!response.ok || !packet.ok) throw new Error('无法载入本局回放');
  const records = packet.events || [];
  const items = records.filter((e) => e.kind === 'rrweb').map((e) => e.p); rebaseRecordedAssets(items);
  if (!items.length || !globalThis.rrweb?.Replayer) throw new Error('这段记录还没有可播放的画面');
  try {
    const captionResponse = await fetch(new URL(`recordings/${encodeURIComponent(id)}/captions`, API), { credentials: 'same-origin' });
    if (captionResponse.ok) captions = normalizeCaptions((await captionResponse.json()).items);
  } catch { captions = []; }
  const visible = records.filter((event) => !(event.kind === 'custom' && event.p?.tag === 'canvas-media-stopped'));
  const { min: firstTimestamp, max: last } = timestampRange(items, (event) => event.timestamp);
  baseTimestamp = firstTimestamp;
  const wallEnd = visible.length ? timestampRange(visible, (event) => event.ts || 0).max : Date.parse(packet.meta.startedAt);
  const captureEnd = Date.parse(packet.meta.mediaCaptureStoppedAt || packet.meta.endedAt || packet.meta.startedAt);
  baseWall = Date.parse(packet.meta.startedAt);
  duration = Math.max(1, (wallEnd - baseWall) / 1000, (last - baseTimestamp) / 1000, (captureEnd - baseWall) / 1000);
  rrOffset = (baseTimestamp - baseWall) / 1000;
  const firstSnapshot = items.find((event) => event.type === 2);
  rrMinimumOffsetMs = firstSnapshot ? Math.max(0, firstSnapshot.timestamp - baseTimestamp) + 1 : 0;
  mediaDuration = (Number(packet.meta.mediaLastTimeMs) || 0) / 1000;
  const stored = (packet.meta.mediaSegments || []).filter((x) => Number.isInteger(x.index) && typeof x.startedAt === 'string');
  mediaSegments = stored.map((x) => ({ ...x, key: `original-${x.index}`, at: Math.max(0, (Date.parse(x.startedAt) - baseWall) / 1000), duration: (x.lastTimeMs || 0) / 1000,
    url: new URL(`recordings/${encodeURIComponent(id)}/media/playback/${x.index}`, API).href, objectUrl: '' }));
  timeline.max = String(duration); timeline.step = '0.05';
  const width = packet.meta.viewport?.width || 1280; const height = packet.meta.viewport?.height || 720;
  replayViewport = { width, height };
  stage.style.aspectRatio = `${width} / ${height}`; stage.style.setProperty('--ar-frame-width', `${width}px`); stage.style.setProperty('--ar-frame-height', `${height}px`);
  player = new globalThis.rrweb.Replayer(items, { root: stage, width, height, skipInactive: false, showWarning: false, showDebug: false, mouseTail: false, useVirtualDom: false, UNSAFE_replayCanvas: false });
  player.play(replayerTime(0));
  await new Promise((resolve) => setTimeout(resolve, 900));
  player.pause(); keepReplayAnimationsVisible();
  position(0); attachCanvasMedia();
  if (mediaVideo) { await positionMediaAt(0); mediaVideo.pause(); }
  status.textContent = packet.meta.endedAt ? '' : '记录未结束';
  initialized = true;
  new ResizeObserver(fitReplay).observe(stage.parentElement);
  if (params.get('autoplay') === '1') play();
})().catch((error) => {
  status.textContent = error.message || '回放载入失败';
  initializationError = '回放载入失败，请检查链接或稍后重试。';
});

window.addEventListener('pagehide', () => {
  cancelPendingMediaSeek(); cancelMediaLoad?.(abortError()); cancelAnimationFrame(raf); player?.pause(); mediaVideo?.pause();
  for (const url of blobUrls.values()) URL.revokeObjectURL(url);
});
