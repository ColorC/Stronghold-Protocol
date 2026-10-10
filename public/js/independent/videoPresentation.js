import { waitForVideoSeek } from './replayReviewSeek.js';
const video = document.getElementById('movie');
const message = document.getElementById('message');
const full = document.getElementById('full');
const params = new URL(location.href).searchParams;
const id = params.get('recording');
const API = new URL('independent/api/', location.href);
let initialized = false, initializationError = '', generation = 0, controller = null, seeking = false;
let viewport = null;
const duration = () => Number.isFinite(video.duration) ? video.duration : 0;
async function seek(value) {
  controller?.abort(); const current = ++generation;
  const abort = new AbortController(); controller = abort; seeking = true;
  try {
    const second = Math.max(0, Math.min(duration(), Number(value) || 0));
    await waitForVideoSeek(video, second, { signal: abort.signal });
    return second;
  } finally { if (generation === current) { seeking = false; controller = null; } }
}
const api = {
  state: () => ({ time: video.currentTime || 0, duration: duration(), ready: initialized && !seeking,
    paused: video.paused, seeking, buffering: !video.paused && video.readyState < 3, viewport, error: initializationError }),
  getTime: () => video.currentTime || 0, setTime: seek, seek,
  play: () => video.play(), pause: () => video.pause(),
};
Object.defineProperty(api, 'duration', { get: duration });
window.__SP_REPLAY_REVIEW__ = api;
video.addEventListener('error', () => { initializationError = '视频暂时无法播放，请稍后重试。'; message.textContent = initializationError; });
if (params.get('review') !== '1') {
  video.controls = true; full.hidden = false;
  const link = new URL('independent-review.html', location.href); link.searchParams.set('recording', id || ''); full.href = link.href;
}
(async () => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || '')) throw new Error('视频链接无效。');
  const response = await fetch(new URL('recordings/' + encodeURIComponent(id) + '/rendered', API), { credentials: 'same-origin' });
  const packet = await response.json();
  if (!response.ok || !packet.ok || !(packet.manifest?.movie?.mediaDuration > 0)) throw new Error('视频尚未就绪，请稍后重试。');
  viewport = packet.manifest.viewport;
  const ready = new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timeout); video.removeEventListener('loadedmetadata', loaded); video.removeEventListener('error', failed); error ? reject(error) : resolve(); };
    const loaded = () => finish(); const failed = () => finish(new Error('视频载入失败。'));
    const timeout = setTimeout(() => finish(new Error('视频载入超时，请稍后重试。')), 30000);
    video.addEventListener('loadedmetadata', loaded, { once: true }); video.addEventListener('error', failed, { once: true });
  });
  video.src = new URL('recordings/' + encodeURIComponent(id) + '/rendered/showcase', API).href;
  video.load(); await ready; await seek(Math.max(0, Number(params.get('t')) || 0));
  initialized = true; message.textContent = '';
})().catch(error => { initializationError = error.message || '视频载入失败。'; message.textContent = initializationError; });
window.addEventListener('pagehide', () => { controller?.abort(); video.pause(); });
