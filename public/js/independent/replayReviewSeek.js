export function waitForVideoSeek(video, target, { timeoutMs = 10000 } = {}) {
  const matchesTarget = () =>
    Math.abs(video.currentTime - target) <= 0.035 && video.readyState >= 2 && !video.seeking;
  if (matchesTarget()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => finish(new Error('等待回放视频定位超时')), timeoutMs);
    let seeked = false;
    let framePresented = false;
    let frameHandle = 0;
    let rafHandle = 0;
    let rafFallbackPending = false;
    const view = video.ownerDocument?.defaultView;
    const requestFrame = view?.requestAnimationFrame?.bind(view)
      || globalThis.requestAnimationFrame
      || (callback => setTimeout(() => callback(Date.now()), 16));
    const cancelFrame = view?.cancelAnimationFrame?.bind(view)
      || globalThis.cancelAnimationFrame
      || clearTimeout;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('error', onError);
      if (frameHandle && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle);
      if (rafHandle) cancelFrame(rafHandle);
    };
    const finish = error => {
      cleanup();
      if (error) reject(error); else resolve();
    };
    const onError = () => finish(new Error('回放视频定位失败'));
    const maybeFinish = () => {
      if (seeked && matchesTarget() && framePresented) finish();
    };
    const watchPresentedFrame = () => {
      if (!video.requestVideoFrameCallback || frameHandle || framePresented) return;
      frameHandle = video.requestVideoFrameCallback((_now, metadata) => {
        frameHandle = 0;
        const mediaTime = Number(metadata?.mediaTime);
        framePresented = Number.isFinite(mediaTime)
          ? Math.abs(mediaTime - target) <= 0.05
          : matchesTarget();
        maybeFinish();
        if (!framePresented) watchPresentedFrame();
      });
    };
    const checkAfterPaint = () => {
      if (rafFallbackPending) return;
      rafFallbackPending = true;
      rafHandle = requestFrame(() => {
        rafHandle = requestFrame(() => {
          rafHandle = 0;
          rafFallbackPending = false;
          if (seeked && matchesTarget()) {
            framePresented = true;
            finish();
          } else if (seeked) {
            checkAfterPaint();
          }
        });
      });
    };
    const onSeeked = () => {
      seeked = true;
      checkAfterPaint();
      maybeFinish();
    };
    const onLoadedData = () => {
      if (!video.seeking) onSeeked();
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('loadeddata', onLoadedData, { once: true });
    video.addEventListener('error', onError, { once: true });
    // Register before currentTime changes: paused videos may not produce a new
    // callback if the observer is installed only after the seeked event.
    watchPresentedFrame();
    if (Math.abs(video.currentTime - target) > 0.035 && !video.seeking) {
      try { video.currentTime = target; }
      catch (error) { finish(new Error(`回放视频无法定位：${error?.message || error}`)); }
    }
  });
}
