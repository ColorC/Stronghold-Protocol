import { fitRecordingDimensions, DEFAULT_MEDIA_OPTIONS } from '../recording/canvasMedia.js';

const cssNumber = (value) => Number.parseFloat(value) || 0;

function visibleCanvasEntries(field) {
  return [...field.querySelectorAll('canvas')]
    .map((canvas, order) => {
      const bounds = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      return { canvas, bounds, order, zIndex: style.zIndex === 'auto' ? 0 : cssNumber(style.zIndex),
        visible: style.display !== 'none' && style.visibility !== 'hidden' && cssNumber(style.opacity) > 0
          && bounds.width > 0 && bounds.height > 0 && canvas.width > 0 && canvas.height > 0 };
    })
    .filter((entry) => entry.visible)
    .sort((a, b) => a.zIndex - b.zIndex || a.order - b.order);
}

function resolveField(field) {
  if (field) return field;
  return document.querySelector('.gm__field');
}

function entriesFor(field) {
  const host = resolveField(field);
  if (host) return { host, entries: visibleCanvasEntries(host) };
  const canvas = [...document.querySelectorAll('canvas')].find((item) => item.width > 0 && item.height > 0
    && (item.__context === 'webgl' || item.__context === 'webgl2' || item.getAttribute('data-render-surface') === 'game'));
  if (!canvas) return { host: null, entries: [] };
  const bounds = canvas.getBoundingClientRect();
  return { host: canvas.parentElement, entries: [{ canvas, bounds, order: 0, zIndex: 0 }] };
}

export function recordingCanvasLayout(field, maxDimension = DEFAULT_MEDIA_OPTIONS.maxDimension) {
  const { host, entries } = entriesFor(field);
  if (!host || !entries.length) return null;
  const bounds = host.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const ratioX = Math.max(...entries.map(({ canvas, bounds: rect }) => canvas.width / rect.width));
  const ratioY = Math.max(...entries.map(({ canvas, bounds: rect }) => canvas.height / rect.height));
  return fitRecordingDimensions(Math.max(1, Math.round(bounds.width * ratioX)), Math.max(1, Math.round(bounds.height * ratioY)), maxDimension);
}

export function drawRecordingCanvasFrame(field, context, width, height) {
  const { host, entries } = entriesFor(field);
  if (!host || !entries.length) return false;
  const fieldBounds = host.getBoundingClientRect();
  if (!fieldBounds.width || !fieldBounds.height) return false;
  context.clearRect(0, 0, width, height);
  context.save();
  context.beginPath(); context.rect(0, 0, width, height); context.clip();
  for (const { canvas, bounds } of entries) {
    const left = (bounds.left - fieldBounds.left) / fieldBounds.width * width;
    const top = (bounds.top - fieldBounds.top) / fieldBounds.height * height;
    const right = (bounds.right - fieldBounds.left) / fieldBounds.width * width;
    const bottom = (bounds.bottom - fieldBounds.top) / fieldBounds.height * height;
    const x = Math.max(0, left); const y = Math.max(0, top);
    const r = Math.min(width, right); const b = Math.min(height, bottom);
    if (r <= x || b <= y) continue;
    const sourceX = (x - left) / (right - left) * canvas.width;
    const sourceY = (y - top) / (bottom - top) * canvas.height;
    const sourceWidth = (r - x) / (right - left) * canvas.width;
    const sourceHeight = (b - y) / (bottom - top) * canvas.height;
    context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, x, y, r - x, b - y);
  }
  context.restore();
  return true;
}

export function recordingCanvasElements(doc) {
  return [...(doc?.querySelectorAll('.gm__field canvas') || [])];
}

export function recordingCanvasField(doc) {
  return doc?.querySelector('.gm__field') || null;
}
