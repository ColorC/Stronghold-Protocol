import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.resolve(process.env.SP_REUSED_PUBLIC_DIR || path.join(ROOT, 'public'));

/** Resolve a read-only public resource; sparse worktrees explicitly reuse the canonical public tree. */
export function publicResourcePath(resource) {
  const relative = String(resource).replace(/^\/+/, '').replaceAll('/', path.sep);
  if (!relative || relative.split(path.sep).some((part) => part === '..')) throw new TypeError('public resource path must stay inside public/');
  const target = path.resolve(PUBLIC, relative);
  if (!target.startsWith(`${PUBLIC}${path.sep}`)) throw new TypeError('public resource path must stay inside public/');
  return target;
}

/** Relative stylesheet links must preserve both the root and an application mount prefix. */
export function resolveStylesheetHref(href, resource) {
  const expected = `./${String(resource).replaceAll('\\', '/').replace(/^\/+/, '')}`;
  if (href !== expected) throw new TypeError(`expected relative stylesheet href ${expected}`);
  return {
    root: new URL(href, 'https://static.test/').pathname,
    mounted: new URL(href, 'https://static.test/stronghold/assault/').pathname,
    resource: expected.slice(2),
  };
}
