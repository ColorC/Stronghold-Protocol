const DETAIL_TABS = new Set(['traits', 'skill', 'talent', 'gear', 'reference']);

/** Parse a component fragment while keeping an optional detail tab attached to its owner. */
export function parseComponentLinkHash(value) {
  let hash = String(value || '').replace(/^#/, '');
  try { hash = decodeURIComponent(hash); } catch { /* keep the browser-provided fragment */ }
  const match = /^(piece|shop|gear)-(.+?)(?::tab=([a-z]+))?$/.exec(hash);
  if (!match) return null;
  const [, kind, id, requestedTab] = match;
  return { kind, id, tab: DETAIL_TABS.has(requestedTab) ? requestedTab : null };
}
