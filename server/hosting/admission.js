import { randomBytes } from 'node:crypto';

const COOKIE = 'sp_ix_lease';
const MESSAGE = '工坊已满，请稍后再试';
const ROUTE = '/independent/api/admission';

function cookieToken(req) {
  const part = String(req.headers.cookie || '').split(';').find((x) => x.trim().startsWith(`${COOKIE}=`));
  return part ? part.trim().slice(COOKIE.length + 1) : null;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** A bounded in-memory visitor lease, shared with the original game's live socket count. */
export function createAdmission({ maxActive = 0, ttlMs = 120000, execution = 'server', now = Date.now, otherActive = () => 0 } = {}) {
  if (!Number.isInteger(maxActive) || maxActive < 0) throw new RangeError('invalid SP_INDEPENDENT_MAX_ACTIVE');
  if (!Number.isFinite(ttlMs) || ttlMs < 1000) throw new RangeError('invalid admission lease lifetime');
  if (!['server', 'client'].includes(execution)) throw new RangeError('invalid SP_INDEPENDENT_EXECUTION');
  const leases = new Map();
  const enabled = maxActive > 0;
  const heartbeatMs = Math.min(30000, Math.floor(ttlMs / 3));
  const sweep = () => { const t = now(); for (const [id, expiry] of leases) if (expiry <= t) leases.delete(id); };
  const stats = () => { sweep(); return { enabled, active: leases.size, otherActive: otherActive(), limit: maxActive }; };
  const canEnter = () => !enabled || stats().active + otherActive() < maxActive;
  const secure = (req) => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  const setCookie = (req, res, token, age) => res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure(req) ? '; Secure' : ''}`);
  function acquire(req, res) {
    sweep();
    let token = cookieToken(req);
    if (!leases.has(token)) {
      if (!canEnter()) return false;
      token = randomBytes(24).toString('hex');
    }
    const expiresAt = now() + ttlMs;
    leases.set(token, expiresAt);
    setCookie(req, res, token, Math.ceil(ttlMs / 1000));
    return { expiresAt, heartbeatMs };
  }
  function refuse(req, res, page = false) {
    res.setHeader('Retry-After', '30');
    if (!page) { json(res, 503, { ok: false, error: { code: 'CAPACITY', message: MESSAGE } }); return; }
    const body = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>卫戍协议：工坊</title><body style="margin:3rem;font-family:system-ui;color:#eee;background:#101216"><h1>工坊已满</h1><p>请稍后再试。</p><button onclick="location.reload()">重新尝试</button></body></html>';
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  function handle(req, res, pathname) {
    if (pathname === ROUTE) {
      if (req.headers.origin && req.headers.origin !== `${secure(req) ? 'https' : 'http'}://${req.headers.host}`) {
        json(res, 403, { ok: false, error: { code: 'ORIGIN', message: '请在游戏页面进行操作' } }); return true;
      }
      if (req.method !== 'POST' && req.method !== 'DELETE') {
        res.setHeader('Allow', 'POST, DELETE'); json(res, 405, { ok: false, error: { code: 'METHOD', message: '不支持此操作' } }); return true;
      }
      if (!enabled) { json(res, 200, { ok: true, lease: { enabled: false, execution } }); return true; }
      if (req.method === 'DELETE') {
        leases.delete(cookieToken(req)); setCookie(req, res, '', 0); json(res, 200, { ok: true }); return true;
      }
      const lease = acquire(req, res);
      if (!lease) refuse(req, res);
      else json(res, 200, { ok: true, lease: { enabled: true, execution, ...lease } });
      return true;
    }
    if (!enabled) return false;
    if (pathname === '/independent.html' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!acquire(req, res)) { refuse(req, res, true); return true; }
      res.setHeader('Cache-Control', 'private, no-store');
      // The static handler must not replace this with a publicly cacheable response.
      return false;
    }
    if (pathname.startsWith('/independent/api/')) {
      sweep();
      if (!leases.has(cookieToken(req))) {
        json(res, 403, { ok: false, error: { code: 'ADMISSION_REQUIRED', message: '请重新进入工坊' } }); return true;
      }
    }
    return false;
  }
  return { handle, stats, canEnter };
}
