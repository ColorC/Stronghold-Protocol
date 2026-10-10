export function selectionAt(events, seconds) {
  let current = null;
  for (const event of events || []) {
    if (!Number.isFinite(event?.at) || event.at > seconds) continue;
    if (!current || event.at >= current.at) current = event;
  }
  return current?.p?.operation === 'set' ? current : null;
}

export function mapViewportRectToOverlay(rect, frameRect, containerRect, viewport, container) {
  const scaleX = containerRect.width / Math.max(1, container.clientWidth);
  const scaleY = containerRect.height / Math.max(1, container.clientHeight);
  const originX = containerRect.left + (container.clientLeft || 0) * scaleX;
  const originY = containerRect.top + (container.clientTop || 0) * scaleY;
  const frameScaleX = frameRect.width / Math.max(1, viewport.width);
  const frameScaleY = frameRect.height / Math.max(1, viewport.height);
  return {
    x: (frameRect.left - originX + rect.x * frameScaleX) / scaleX,
    y: (frameRect.top - originY + rect.y * frameScaleY) / scaleY,
    width: rect.width * frameScaleX / scaleX,
    height: rect.height * frameScaleY / scaleY,
  };
}
