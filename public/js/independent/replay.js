const $ = (id) => document.getElementById(id);
const stage = $('stage'); const status = $('status'); const caption = $('caption'); const anchor = $('anchor');
const timeline = $('timeline'); const playButton = $('play'); const clock = $('clock');
const selection = $('selection');
const API = new URL('independent/api/', location.href);
let player; let items = []; let cues = []; let duration = 0; let baseTimestamp = 0; let baseWall = 0; let mediaVideo; let mediaStartSecond = Infinity; let mediaReady = Promise.resolve(); let mediaDuration = 0;
let playing = false; let startedAt = 0; let startedSecond = 0; let raf = 0; let selecting = false; let drag = null;
let zoomRect = null;
const fmt = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const paintCue = (second) => {
  const cue = cues.find((x) => second >= x.at && second < x.at + 5);
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
  timeline.value = String(second); clock.textContent = `${fmt(second)} / ${fmt(duration)}`; paintCue(second);
  if (mediaVideo && !playing) syncMediaTime(second);
}
function syncMediaTime(second) {
  if (!mediaVideo || second < mediaStartSecond) { if (mediaVideo) mediaVideo.pause(); return; }
  const time = Math.max(0, (second - mediaStartSecond));
  if (mediaDuration > 0 && time < mediaDuration) {
    try { if (Math.abs(mediaVideo.currentTime - time) > 0.4) mediaVideo.currentTime = time; } catch { /* metadata may still be loading */ }
  }
}
function attachCanvasMedia(id) {
  const frame = stage.querySelector('iframe') || player?.iframe; const doc = frame?.contentDocument; const canvas = doc?.querySelector('canvas');
  if (!canvas) return;
  if (!mediaVideo || mediaVideo.ownerDocument !== document) {
    mediaVideo = document.createElement('video'); mediaVideo.muted = true; mediaVideo.playsInline = true; mediaVideo.preload = 'auto';
    mediaVideo.dataset.spCanvasMedia = '1';
    Object.assign(mediaVideo.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none', zIndex: '4', background: '#08090c' });
    mediaReady = new Promise((resolve) => {
      const done = () => { mediaDuration = Number.isFinite(mediaVideo.duration) ? mediaVideo.duration : mediaDuration; resolve(); };
      mediaVideo.addEventListener('loadedmetadata', done, { once: true }); mediaVideo.addEventListener('error', done, { once: true });
    });
  }
  if (!mediaVideo.isConnected) stage.appendChild(mediaVideo);
  canvas.style.visibility = 'hidden';
  if (!mediaVideo.src) mediaVideo.src = new URL(`recordings/${encodeURIComponent(id)}/media/playback`, API).href;
  syncMediaTime(Number(timeline.value));
}
function offset() { return playing ? Math.min(duration, startedSecond + (performance.now() - startedAt) / 1000) : Number(timeline.value); }
function tick() {
  if (!playing) return;
  const now = offset(); position(now);
  if (now >= duration) { pause(); return; }
  raf = requestAnimationFrame(tick);
}
function play() {
  if (playing || !player) return;
  playing = true; startedAt = performance.now(); startedSecond = Number(timeline.value);
  player.play(startedSecond * 1000); if (mediaVideo && startedSecond >= mediaStartSecond) { void mediaVideo.play().catch(() => {}); }
  playButton.textContent = '暂停'; raf = requestAnimationFrame(tick);
}
function pause() {
  if (!playing) return;
  const now = offset(); playing = false; cancelAnimationFrame(raf); player?.pause(); mediaVideo?.pause(); timeline.value = String(now); position(now); playButton.textContent = '播放';
}
async function seek(value) {
  const second = Math.max(0, Math.min(duration, Number(value) || 0));
  const resume = playing; playing = false; cancelAnimationFrame(raf); player?.pause();
  timeline.value = String(second); position(second); player?.play(second * 1000);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  player?.pause(); attachCanvasMedia(new URL(location.href).searchParams.get('recording'));
  if (mediaVideo && second >= mediaStartSecond) {
    await mediaReady; syncMediaTime(second);
    if (resume) void mediaVideo.play().catch(() => {});
    else { void mediaVideo.play().then(() => new Promise((resolve) => { if (mediaVideo.requestVideoFrameCallback) mediaVideo.requestVideoFrameCallback(resolve); else setTimeout(resolve, 80); })).then(() => { mediaVideo.pause(); }).catch(() => {}); }
  }
  if (resume) { playing = false; play(); }
}
playButton.addEventListener('click', () => playing ? pause() : play());
timeline.addEventListener('input', () => { if (playing) pause(); void seek(timeline.value); });
$('zoom').addEventListener('click', () => { selecting = true; status.textContent = '在画面上拖动，框选要放大的区域。'; });
$('reset').addEventListener('click', () => { zoomRect = null; stage.style.transform = ''; stage.style.transformOrigin = ''; selection.hidden = true; selecting = false; status.textContent = ''; });
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
  drag = null; selecting = false;
  if (width > 12 && height > 12) { zoomRect = { localX, localY, width, height }; stage.style.transformOrigin = `${localX}px ${localY}px`; stage.style.transform = 'scale(2)'; status.textContent = '放大查看中，可点「还原画面」回到全景。'; }
});

(async () => {
  const id = new URL(location.href).searchParams.get('recording');
  if (!id) throw new Error('没有指定本局回放');
  const response = await fetch(new URL(`recordings/${encodeURIComponent(id)}`, API), { credentials: 'same-origin' });
  const packet = await response.json(); if (!response.ok || !packet.ok) throw new Error('无法载入本局回放');
  const records = packet.events || []; items = records.filter((e) => e.kind === 'rrweb').map((e) => e.p);
  cues = records.filter((e) => e.kind === 'caption' && e.p?.text).map((e) => ({ at: Math.max(0, (e.ts - Date.parse(packet.meta.startedAt)) / 1000), ...e.p }));
  if (!items.length || !globalThis.rrweb?.Replayer) throw new Error('这段记录还没有可播放的画面');
  baseTimestamp = Math.min(...items.map((e) => e.timestamp).filter(Number.isFinite));
  const last = Math.max(...items.map((e) => e.timestamp).filter(Number.isFinite));
  const wallEnd = records.length ? Math.max(...records.map((e) => e.ts || 0)) : Date.parse(packet.meta.startedAt);
  baseWall = Date.parse(packet.meta.startedAt); duration = Math.max(1, (wallEnd - baseWall) / 1000, (last - baseTimestamp) / 1000);
  if (packet.meta.mediaStartedAt) mediaStartSecond = Math.max(0, (Date.parse(packet.meta.mediaStartedAt) - baseWall) / 1000);
  mediaDuration = (Number(packet.meta.mediaLastTimeMs) || 0) / 1000;
  timeline.max = String(duration); timeline.step = '0.05';
  const width = packet.meta.viewport?.width || 1280; const height = packet.meta.viewport?.height || 720;
  stage.style.aspectRatio = `${width} / ${height}`; stage.style.setProperty('--ix-frame-width', `${width}px`); stage.style.setProperty('--ix-frame-height', `${height}px`);
  player = new rrweb.Replayer(items, { root: stage, width, height, skipInactive: false, showWarning: false, showDebug: false, mouseTail: false, UNSAFE_replayCanvas: true });
  // Replayer construction sets up its sandbox but does not paint the full snapshot until the timeline advances.
  // Render the first recorded frame before enabling controls so a replay link never opens on a blank stage.
  const firstVisibleSecond = Number.isFinite(mediaStartSecond) ? Math.min(duration, mediaStartSecond + 0.7) : 0;
  player.play(firstVisibleSecond * 1000);
  // Let CSS transitions present in the captured page finish while the replay clock advances.
  await new Promise((resolve) => setTimeout(resolve, 900));
  player.pause();
  timeline.value = String(Math.min(duration, firstVisibleSecond)); position(Number(timeline.value)); attachCanvasMedia(id);
  if (mediaVideo) {
    await mediaReady; syncMediaTime(Number(timeline.value));
    if (Number(timeline.value) >= mediaStartSecond) {
      void mediaVideo.play().then(() => new Promise((resolve) => { if (mediaVideo.requestVideoFrameCallback) mediaVideo.requestVideoFrameCallback(resolve); else setTimeout(resolve, 80); }))
        .then(() => { mediaVideo.pause(); }).catch(() => {});
    }
  }
  status.textContent = packet.meta.endedAt ? '记录已结束' : '正在记录的本局';
})().catch((error) => { status.textContent = error.message || '回放载入失败'; });

window.addEventListener('pagehide', () => { cancelAnimationFrame(raf); player?.pause(); });
