import fs from 'node:fs';
import path from 'node:path';

const PREFIXES = ['/js/', '/css/', '/vendor/', '/fonts/', '/assets/', '/data/', '/shared/', '/sim/', '/media/'];
const LOCAL_BOOTSTRAP = '/js/hostingBootstrap.js';
const LOCAL_RESONANCE_DOWNLOAD = '/resonance-references.zip';
const LOCAL_RESONANCE = new Set([
  '/css/resonance.css',
  '/js/ui/fieldHost.js',
  '/js/ui/fallbackField.js',
]);
const WORKER = '/js/independent/client-worker.js';
const GIT_REVISION = /^[a-f0-9]{40}$/;

function safeSegments(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || /[\\\x00-\x1f\x7f?#]/.test(pathname)) return false;
  let decoded = pathname;
  for (let pass = 0; pass < 8; pass += 1) {
    if (/%(?:2f|5c)/i.test(decoded)) return false;
    let next;
    try { next = decodeURIComponent(decoded); } catch { return false; }
    if (next === decoded) break;
    decoded = next;
    if (pass === 7) return false;
  }
  if (/[\\\x00-\x1f\x7f?#]/.test(decoded)) return false;
  const parts = decoded.split('/');
  return parts.slice(1).every((part) => part.length > 0 && part !== '.' && part !== '..' && !part.startsWith('.'));
}

function safeAssetPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/assets/') || !safeSegments(pathname)) return false;
  try { return new URL(pathname, 'https://asset-map.invalid').pathname === pathname; }
  catch { return false; }
}

function validateSourceUrl(source) {
  if (typeof source !== 'string') throw new TypeError('assetSources values must be HTTPS provider URLs');
  const matchRaw = /^https:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/([a-f0-9]{40})\/(.+)$/.exec(source);
  const matchJsdelivr = /^https:\/\/cdn\.jsdelivr\.net\/gh\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)@([a-f0-9]{40})\/(.+)$/.exec(source);
  const match = matchRaw || matchJsdelivr;
  if (!match) throw new TypeError(`unsafe asset source URL: ${source}`);
  if (!safeSegments(`/${match[1]}/${match[2]}/${match[3]}/${match[4]}`)) throw new TypeError(`unsafe asset source URL: ${source}`);
  let url;
  try { url = new URL(source); } catch { throw new TypeError(`unsafe asset source URL: ${source}`); }
  const expectedHost = matchRaw ? 'raw.githubusercontent.com' : 'cdn.jsdelivr.net';
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.port || url.username || url.password || url.search || url.hash
      || !safeSegments(url.pathname)) throw new TypeError(`unsafe asset source URL: ${source}`);
  return source;
}

/** Read and validate the optional absolute, formal source-map path once during server startup. */
export function loadAssetSourceMap(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new TypeError('SP_ASSET_SOURCE_MAP must be an absolute JSON file path');
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype
      || parsed.version !== 1 || typeof parsed.applicationRevision !== 'string' || !GIT_REVISION.test(parsed.applicationRevision)
      || !parsed.assets || Array.isArray(parsed.assets) || Object.getPrototypeOf(parsed.assets) !== Object.prototype
      || Object.keys(parsed).sort().join(',') !== 'applicationRevision,assets,version') {
    throw new TypeError('SP_ASSET_SOURCE_MAP must match the exact version-1 schema with a full Git revision');
  }
  validateAssetSources(parsed.assets);
  return parsed.assets;
}

function validateAssetSources(assetSources) {
  if (!assetSources || Array.isArray(assetSources) || typeof assetSources !== 'object'
      || Object.getPrototypeOf(assetSources) !== Object.prototype) throw new TypeError('assetSources must be a plain pathname-to-URL object');
  for (const [pathname, source] of Object.entries(assetSources)) {
    if (!safeAssetPath(pathname)) throw new TypeError(`unsafe asset source pathname: ${pathname}`);
    validateSourceUrl(source);
  }
}

/** Only a deployer-supplied, native Git revision URL can become a static origin. */
export function createStaticDelivery({ base = '', assetSources = {} } = {}) {
  validateAssetSources(assetSources);
  if (Object.keys(assetSources).length && !base) throw new Error('SP_STATIC_BASE is required when assetSources are configured');
  if (!base) return () => false;
  const parsed = new URL(base);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
      || !/\/[a-f0-9]{40}\/?$/.test(parsed.pathname)) throw new Error('SP_STATIC_BASE must be an HTTPS URL ending in the full Git commit');
  const prefix = parsed.href.replace(/\/$/, '');
  return function handle(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (pathname === LOCAL_BOOTSTRAP) return false;
    if (pathname === LOCAL_RESONANCE_DOWNLOAD) return false;
    if (pathname.startsWith('/js/resonance/') || pathname.startsWith('/js/render/') || LOCAL_RESONANCE.has(pathname)) return false;
    if (pathname !== '/data.js' && !PREFIXES.some((p) => pathname.startsWith(p))) return false;
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { decoded = null; }
    if (!decoded || /[\\\x00-\x1f]/.test(decoded) || decoded.split('/').some((p) => p === '.' || p === '..' || p.startsWith('.'))) {
      res.writeHead(400, { 'Cache-Control': 'no-store', 'Content-Length': 0 }); res.end(); return true;
    }
    const directSource = assetSources[pathname];
    if (directSource) {
      res.writeHead(307, { Location: directSource, 'Cache-Control': 'public, max-age=300', 'Content-Length': 0 });
      res.end(); return true;
    }
    if (pathname === WORKER) {
      // Worker() itself must remain same-origin; module imports inside it can use the CDN with CORS.
      const script = `import ${JSON.stringify(prefix + pathname)};\n`;
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(script) });
      res.end(req.method === 'HEAD' ? undefined : script); return true;
    }
    res.writeHead(307, { Location: prefix + pathname, 'Cache-Control': 'public, max-age=300', 'Content-Length': 0 });
    res.end(); return true;
  };
}
