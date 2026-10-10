function makeAbortError() {
  return new DOMException('回放视频定位已取消', 'AbortError');
}

export function waitForVideoSeek(video, target, { timeoutMs = 10000, signal } = {}) {
  if (signal?.aborted) return Promise.reject(makeAbortError());
  const matchesTarget = () =>
    Math.abs(video.currentTime - target) <= 0.035 && video.readyState >= 2 && !video.seeking;
  if (matchesTarget()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;
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
      video.removeEventListener('canplay', onLoadedData);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (frameHandle && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle);
      if (rafHandle) cancelFrame(rafHandle);
    };
    const finish = error => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const onError = () => finish(new Error('回放视频定位失败'));
    const onAbort = () => finish(makeAbortError());
    const maybeFinish = () => {
      if (seeked && matchesTarget() && framePresented) finish();
    };
    const watchPresentedFrame = () => {
      if (!video.requestVideoFrameCallback || frameHandle || framePresented || settled) return;
      frameHandle = video.requestVideoFrameCallback((_now, metadata) => {
        frameHandle = 0;
        const mediaTime = Number(metadata?.mediaTime);
        framePresented = Number.isFinite(mediaTime)
          ? Math.abs(mediaTime - target) <= 0.05 && matchesTarget()
          : matchesTarget();
        maybeFinish();
        if (!framePresented) watchPresentedFrame();
      });
    };
    const checkAfterPaint = () => {
      if (rafFallbackPending || settled) return;
      rafFallbackPending = true;
      rafHandle = requestFrame(() => {
        rafHandle = requestFrame(() => {
          rafHandle = 0;
          rafFallbackPending = false;
          if (seeked && matchesTarget()) finish();
          else seeked = false;
        });
      });
    };
    const onSeeked = () => {
      // A seeked event for a superseded target is stale. Keep listening for
      // the event that corresponds to this waiter's requested time.
      if (!matchesTarget()) return;
      seeked = true;
      checkAfterPaint();
      maybeFinish();
    };
    const onLoadedData = () => {
      if (matchesTarget()) onSeeked();
    };

    timer = setTimeout(() => finish(new Error('等待回放视频定位超时')), timeoutMs);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('canplay', onLoadedData);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    // Observe before changing currentTime: a paused video can present the
    // target frame before its seeked event is dispatched.
    watchPresentedFrame();
    // Assign even during an active seek. HTMLMediaElement retargets the seek;
    // leaving the old currentTime in flight makes a new target impossible.
    if (Math.abs(video.currentTime - target) > 0.035) {
      try { video.currentTime = target; }
      catch (error) { finish(new Error(`回放视频无法定位：${error?.message || error}`)); }
    }
  });
}
