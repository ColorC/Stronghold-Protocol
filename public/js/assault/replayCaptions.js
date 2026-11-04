/** Subtitle track: `{ at, until?, text }` in recording seconds. A caption without `until` shows for DEFAULT_HOLD seconds. */
export const DEFAULT_HOLD = 4;

export function normalizeCaptions(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && Number.isFinite(item.at) && item.at >= 0 && typeof item.text === 'string' && item.text.trim())
    .map((item) => ({ at: item.at, until: Number.isFinite(item.until) && item.until > item.at ? item.until : item.at + DEFAULT_HOLD, text: item.text.trim(), key: item.key || '' }))
    .sort((a, b) => a.at - b.at);
}

/** The latest caption whose window contains `second`, or null. */
export function captionAt(captions, second) {
  let current = null;
  for (const item of captions) {
    if (item.at > second) break;
    if (second < item.until) current = item;
  }
  return current;
}
