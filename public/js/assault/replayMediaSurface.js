export function createReplayMediaSurface(stage) {
  if (!stage || typeof stage.appendChild !== 'function') {
    throw new TypeError('A stage element is required');
  }

  const canvas = stage.ownerDocument.createElement('canvas');
  canvas.dataset.spCanvasSurface = '1';
  canvas.style.position = 'absolute';
  canvas.style.zIndex = '4';
  canvas.style.pointerEvents = 'none';
  canvas.style.opacity = '1';
  canvas.style.background = '#08090c';
  canvas.hidden = true;
  stage.appendChild(canvas);

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    canvas.remove();
    throw new Error('A 2D canvas context is unavailable');
  }

  let frameAvailable = false;
  let destroyed = false;

  function setBounds(bounds = {}) {
    if (destroyed) return;
    for (const key of ['left', 'top', 'width', 'height']) {
      const value = Number(bounds[key]);
      if (Number.isFinite(value)) canvas.style[key] = `${value}px`;
    }
  }

  function paint(video) {
    if (destroyed || !video || video.readyState < 2 || video.seeking
      || !(video.videoWidth > 0) || !(video.videoHeight > 0)) return false;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(video, 0, 0, width, height);
    canvas.hidden = false;
    frameAvailable = true;
    return true;
  }

  function hide() {
    if (destroyed) return;
    canvas.hidden = true;
  }

  function hasFrame() {
    return !destroyed && frameAvailable;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    frameAvailable = false;
    canvas.remove();
  }

  return { canvas, setBounds, paint, hide, hasFrame, destroy };
}
