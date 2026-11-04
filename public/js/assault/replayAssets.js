/** Re-point every URL under the recorded page's directory at the directory this replay is served from. */
/** Root-absolute asset folders the game links as `/assets/...`; behind a gateway only the page that recorded them could reach them. */
const ROOT_FOLDERS = ['assets', 'fonts', 'icons', 'vendor', 'data', 'textures', 'i18n'];

/** Re-point every URL under the recorded page's directory (and the root-absolute asset folders) at the directory this replay is served from. */
export function rebaseRecordedAssets(events, currentHref = globalThis.location?.href) {
  const recordedHref = events.find((event) => event?.type === 4 && typeof event.data?.href === 'string')?.data.href;
  if (!recordedHref || !currentHref) return events;
  let recordedBase; let appBase; let recordedRoot;
  try { recordedBase = new URL('./', recordedHref).href; appBase = new URL('./', currentHref).href; recordedRoot = new URL('/', recordedHref).href; } catch { return events; }
  const pairs = [];
  if (recordedBase !== appBase) pairs.push([recordedBase, appBase]);
  if (recordedBase !== recordedRoot) for (const folder of ROOT_FOLDERS) pairs.push([`${recordedRoot}${folder}/`, `${appBase}${folder}/`]);
  if (!pairs.length) return events;
  const rewrite = (text) => { let out = text; for (const [from, to] of pairs) if (out.includes(from)) out = out.split(from).join(to); return out; };
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    for (const [key, current] of Object.entries(value)) {
      if (typeof current === 'string') { const next = rewrite(current); if (next !== current) value[key] = next; }
      else visit(current);
    }
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
