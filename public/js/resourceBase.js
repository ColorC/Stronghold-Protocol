/** App-root URL helpers for root and mounted (/stronghold/) browser entrypoints. */
export function pageBasePath(href = globalThis.location?.href) {
  if (typeof href !== 'string' || !href) return '/';
  try { return new URL('./', href).pathname; } catch { return '/'; }
}

/**
 * Rebase same-origin root asset paths onto the directory containing the current page. `/vendor/` too: a vendored ES
 * module's own relative imports (three.module.js → three.core.js) then stay under the mount, which the gateway routes by
 * path — at the domain root they would carry no page Referer to be routed by.
 */
export function pageResourcePath(path, href = globalThis.location?.href) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return path;
  const match = path.match(/^\/(assets|fonts|media|packs|i18n|vendor)\/(.*)$/i);
  if (!match) return path;
  const base = pageBasePath(href);
  return `${base}${match[1]}/${match[2]}`;
}
