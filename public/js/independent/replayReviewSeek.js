export function waitForVideoSeek(video, target, { timeoutMs = 10000 } = {}) {
  if (Math.abs(video.currentTime - target) <= 0.035 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => finish(new Error('等待回放视频定位超时')), timeoutMs);
    let seeked = false;
    let frame = false;
    let frameHandle = 0;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('error', onError);
    };
    const finish = (error) => {
      cleanup();
      if (frameHandle && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle);
      if (error) reject(error); else resolve();
    };
    const onError = () => finish(new Error('回放视频定位失败'));
    const onFrameReady = () => {
      if (video.requestVideoFrameCallback) {
        frameHandle = video.requestVideoFrameCallback(() => { frame = true; if (seeked && frame) finish(); });
      } else {
        frame = video.readyState >= 2;
        if (seeked && frame) finish();
      }
    };
    const onSeeked = () => { seeked = true; onFrameReady(); };
    const onLoadedData = () => { seeked = true; onFrameReady(); };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('loadeddata', onLoadedData, { once: true });
    video.addEventListener('error', onError, { once: true });
    if (Math.abs(video.currentTime - target) > 0.035) {
      try { video.currentTime = target; }
      catch (error) { finish(new Error(`回放视频无法定位：${error?.message || error}`)); }
    }
  });
}
