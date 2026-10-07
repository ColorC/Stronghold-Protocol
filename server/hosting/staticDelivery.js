const PREFIXES = ['/js/', '/css/', '/vendor/', '/fonts/', '/assets/', '/data/', '/shared/', '/sim/', '/media/'];
const LOCAL_BOOTSTRAP = '/js/hostingBootstrap.js';
const WORKER = '/js/independent/client-worker.js';

/** Only a deployer-supplied, native Git revision URL can become a static origin. */
export function createStaticDelivery({ base = '' } = {}) {
  if (!base) return () => false;
  const parsed = new URL(base);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
      || !/\/[a-f0-9]{40}\/?$/.test(parsed.pathname)) throw new Error('SP_STATIC_BASE must be an HTTPS URL ending in the full Git commit');
  const prefix = parsed.href.replace(/\/$/, '');
  return function handle(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (pathname === LOCAL_BOOTSTRAP) return false;
    if (pathname !== '/data.js' && !PREFIXES.some((p) => pathname.startsWith(p))) return false;
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { decoded = null; }
    if (!decoded || /[\\\x00-\x1f]/.test(decoded) || decoded.split('/').some((p) => p === '.' || p === '..' || p.startsWith('.'))) {
      res.writeHead(400, { 'Cache-Control': 'no-store', 'Content-Length': 0 }); res.end(); return true;
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
