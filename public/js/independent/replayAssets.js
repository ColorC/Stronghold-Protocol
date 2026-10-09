export function rebaseRecordedAssets(events, currentHref = globalThis.location?.href) {
  const recordedHref = events.find((event) => event?.type === 4 && typeof event.data?.href === 'string')?.data.href;
  if (!recordedHref || !currentHref) return events;
  let recorded; let appBase;
  try { recorded = new URL(recordedHref); appBase = new URL('./', currentHref); } catch { return events; }
  const isLocalAsset = (url) => url.origin === recorded.origin && /^\/(?:assets|fonts|css|vendor)\//.test(url.pathname);
  const isGameEntry = (url) => url.origin === recorded.origin && url.pathname === '/independent.html';
  const rebase = (raw) => {
    try {
      const url = new URL(raw, recorded.href);
      if (!isLocalAsset(url) && !isGameEntry(url)) return raw;
      const relativePath = url.pathname.replace(/^\/+/, '');
      return `${new URL(relativePath, appBase).href}${url.search}${url.hash}`;
    } catch { return raw; }
  };
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    for (const [key, current] of Object.entries(value)) {
      if (typeof current !== 'string') continue;
      let next = current.replace(/https?:\/\/[^\s"'()<>]+|\/(?:assets|fonts|css|vendor)\/[^\s"'()<>]+|\/independent\.html(?:\?[^\s"'()<>#]*)?(?:#[^\s"'()<>]*)?/g, rebase);
      if (['src', 'href', 'poster', 'xlink:href'].includes(key)) next = rebase(next);
      if (next !== current) value[key] = next;
    }
    for (const item of Object.values(value)) visit(item);
  };
  visit(events);
  return events;
}

export function timestampRange(items, select = (item) => item) {
  let min = Infinity;
  let max = -Infinity;
  for (const item of items || []) {
    const value = select(item);
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}
