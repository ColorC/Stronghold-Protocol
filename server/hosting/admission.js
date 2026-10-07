import { randomBytes } from 'node:crypto';

const COOKIE = 'sp_ix_lease';
const MESSAGE = '工坊已满，请稍后再试';
const ROUTE = '/independent/api/admission';
const MAX_WAIT_MS = 25000;

function cookieToken(req) {
  const part = String(req.headers.cookie || '').split(';').find((x) => x.trim().startsWith(`${COOKIE}=`));
  const token = part?.trim().slice(COOKIE.length + 1);
  return /^[a-f0-9]{48}$/.test(token || '') ? token : null;
}

function json(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** A bounded in-memory visitor lease and FIFO waiting queue. */
export function createAdmission({
  maxActive = 0, maxWaiting = 0, ttlMs = 120000, queueTtlMs = 90000, waitTimeoutMs = MAX_WAIT_MS,
  execution = 'server', now = Date.now, otherActive = () => 0,
} = {}) {
  if (!Number.isInteger(maxActive) || maxActive < 0) throw new RangeError('invalid SP_INDEPENDENT_MAX_ACTIVE');
  if (!Number.isInteger(maxWaiting) || maxWaiting < 0 || maxWaiting > 10000) throw new RangeError('invalid SP_INDEPENDENT_MAX_WAITING');
  if (!Number.isFinite(ttlMs) || ttlMs < 1000) throw new RangeError('invalid admission lease lifetime');
  if (!Number.isFinite(queueTtlMs) || queueTtlMs < 1000) throw new RangeError('invalid admission queue lifetime');
  if (!Number.isFinite(waitTimeoutMs) || waitTimeoutMs < 1 || waitTimeoutMs > MAX_WAIT_MS) throw new RangeError('invalid admission wait timeout');
  if (!['server', 'client'].includes(execution)) throw new RangeError('invalid SP_INDEPENDENT_EXECUTION');

  const leases = new Map();
  const waiting = new Map();
  const order = [];
  const pending = new Map();
  const enabled = maxActive > 0;
  const heartbeatMs = Math.min(30000, Math.floor(ttlMs / 3));
  let sweepTimer = null;
  let closed = false;

  const activeCount = () => leases.size + Math.max(0, Number(otherActive()) || 0);
  const positionOf = (token) => { const index = order.indexOf(token); return index < 0 ? 0 : index + 1; };
  const secure = (req) => Boolean(req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https');
  const setCookie = (req, res, token, age) => res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure(req) ? '; Secure' : ''}`);
  const clearCookie = (req, res) => setCookie(req, res, '', 0);

  function removePending(token, entry) {
    const list = pending.get(token);
    if (!list) return;
    list.delete(entry);
    if (!list.size) pending.delete(token);
    clearTimeout(entry.timer);
    entry.res.off?.('close', entry.onClose);
  }

  function settlePending(token, status, body, { clear = false } = {}) {
    const list = [...(pending.get(token) || [])];
    for (const entry of list) {
      removePending(token, entry);
      if (entry.res.destroyed || entry.res.writableEnded) continue;
      if (status === 200) setCookie(entry.req, entry.res, token, Math.ceil(ttlMs / 1000));
      if (clear) clearCookie(entry.req, entry.res);
      json(entry.res, status, body);
    }
  }

  function notifyPositions() {
    for (const [token, entries] of [...pending]) {
      const position = positionOf(token);
      if (!position) continue;
      for (const entry of [...entries]) {
        if (entry.lastPosition === position) continue;
        entry.lastPosition = position;
        removePending(token, entry);
        json(entry.res, 202, { ok: true, queued: { position, expiresAt: waiting.get(token)?.expiresAt, queueLength: order.length } });
      }
    }
  }

  function sweep() {
    const time = now();
    for (const [token, expiry] of leases) if (expiry <= time) leases.delete(token);
    let queueChanged = false;
    for (const [token, entry] of waiting) {
      if (entry.expiresAt > time) continue;
      waiting.delete(token);
      const index = order.indexOf(token);
      if (index >= 0) order.splice(index, 1);
      settlePending(token, 410, { ok: false, error: { code: 'QUEUE_EXPIRED', message: '等待已结束，请重新进入工坊' } }, { clear: true });
      queueChanged = true;
    }
    if (queueChanged) notifyPositions();
  }

  function scheduleSweep() {
    clearTimeout(sweepTimer);
    sweepTimer = null;
    if (closed) return;
    const expiries = [...leases.values(), ...[...waiting.values()].map((entry) => entry.expiresAt)];
    if (!expiries.length) return;
    const delay = Math.max(1, Math.min(...expiries) - now());
    sweepTimer = setTimeout(() => { sweep(); pump(); }, delay);
    sweepTimer.unref?.();
  }

  function queueInfo(token) {
    return { position: positionOf(token), expiresAt: waiting.get(token)?.expiresAt, queueLength: order.length };
  }

  function pump() {
    sweep();
    if (enabled && !closed) {
      while (order.length && activeCount() < maxActive) {
        const token = order.shift();
        const entry = waiting.get(token);
        if (!entry || entry.expiresAt <= now()) { waiting.delete(token); continue; }
        waiting.delete(token);
        const expiresAt = now() + ttlMs;
        leases.set(token, expiresAt);
        settlePending(token, 200, { ok: true, lease: { enabled: true, execution, expiresAt, heartbeatMs } });
      }
    }
    notifyPositions();
    scheduleSweep();
  }

  function newIdentity(req, res) {
    let token = cookieToken(req);
    if (!token) token = randomBytes(24).toString('hex');
    setCookie(req, res, token, Math.ceil((enabled ? ttlMs : 120000) / 1000));
    return token;
  }

  function enqueue(req, res, token) {
    if (waiting.has(token)) return true;
    if (!maxWaiting || waiting.size >= maxWaiting) return false;
    waiting.set(token, { expiresAt: now() + queueTtlMs });
    order.push(token);
    setCookie(req, res, token, Math.ceil(queueTtlMs / 1000));
    scheduleSweep();
    return true;
  }

  function queuedPage(req, res, info) {
    const body = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101216"><title>卫戍协议：工坊</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#101216;color:#eee;font:16px system-ui"><main style="max-width:32rem;padding:2rem;text-align:center"><h1>稍等片刻</h1><p>工坊正在为你留位，空位一到会自动进入。</p><p id="queue-position">前面还有 ' + Math.max(0, info.position - 1) + ' 位</p><button id="copy-link" type="button">复制等待页链接</button> <button id="cancel-wait" type="button">取消等待</button><p id="queue-status" aria-live="polite"></p></main><script type="module" src="/js/hostingWait.js"></script></body></html>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function refuse(req, res, page = false) {
    res.setHeader('Retry-After', '30');
    if (!page) { json(res, 503, { ok: false, error: { code: 'CAPACITY', message: MESSAGE } }); return; }
    const body = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>卫戍协议：工坊</title><body style="margin:3rem;font-family:system-ui;color:#eee;background:#101216"><h1>工坊已满</h1><p>请稍后再试。</p><button onclick="location.reload()">重新尝试</button></body></html>';
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function makeLease(req, res, token) {
    const expiresAt = now() + ttlMs;
    leases.set(token, expiresAt);
    setCookie(req, res, token, Math.ceil(ttlMs / 1000));
    scheduleSweep();
    return { enabled: true, execution, expiresAt, heartbeatMs };
  }

  function pendingResponse(req, res, token) {
    if (pending.has(token)) { json(res, 202, { ok: true, queued: queueInfo(token) }); return; }
    const position = positionOf(token);
    const entry = { req, res, token, lastPosition: position, timer: null, onClose: null };
    entry.onClose = () => removePending(token, entry);
    if (typeof res.once === 'function') res.once('close', entry.onClose);
    let list = pending.get(token);
    if (!list) pending.set(token, list = new Set());
    list.add(entry);
    entry.timer = setTimeout(() => {
      if (!pending.get(token)?.has(entry)) return;
      removePending(token, entry);
      json(res, 202, { ok: true, queued: queueInfo(token) });
    }, waitTimeoutMs);
    entry.timer.unref?.();
  }

  function waitRequested(req) {
    try { return new URL(req.url || '/', 'http://localhost').searchParams.get('wait') === '1'; } catch { return false; }
  }

  function stats() {
    pump();
    return { enabled, active: leases.size, otherActive: otherActive(), waiting: waiting.size, limit: maxActive, maxWaiting };
  }

  function canEnter() {
    if (!enabled) return true;
    pump();
    return order.length === 0 && activeCount() < maxActive;
  }

  function handle(req, res, pathname) {
    if (closed) return false;
    if (pathname === ROUTE) {
      if (req.headers.origin && req.headers.origin !== `${secure(req) ? 'https' : 'http'}://${req.headers.host}`) {
        json(res, 403, { ok: false, error: { code: 'ORIGIN', message: '请在游戏页面进行操作' } }); return true;
      }
      if (req.method !== 'POST' && req.method !== 'DELETE') {
        res.setHeader('Allow', 'POST, DELETE'); json(res, 405, { ok: false, error: { code: 'METHOD', message: '不支持此操作' } }); return true;
      }
      if (!enabled) { json(res, 200, { ok: true, lease: { enabled: false, execution } }); return true; }
      const token = cookieToken(req);
      if (req.method === 'DELETE') {
        if (token) {
          leases.delete(token);
          if (waiting.delete(token)) {
            const index = order.indexOf(token);
            if (index >= 0) order.splice(index, 1);
            settlePending(token, 410, { ok: false, error: { code: 'QUEUE_CANCELLED', message: '已取消等待' } }, { clear: true });
          }
        }
        clearCookie(req, res);
        pump();
        json(res, 200, { ok: true }); return true;
      }

      pump();
      const identity = token || newIdentity(req, res);
      if (leases.has(identity)) {
        const lease = makeLease(req, res, identity);
        json(res, 200, { ok: true, lease }); return true;
      }
      if (!waiting.has(identity) && order.length === 0 && activeCount() < maxActive) {
        const lease = makeLease(req, res, identity);
        json(res, 200, { ok: true, lease }); return true;
      }
      if (!enqueue(req, res, identity)) { refuse(req, res); return true; }
      if (waitRequested(req)) pendingResponse(req, res, identity);
      else json(res, 202, { ok: true, queued: queueInfo(identity) });
      return true;
    }
    if (!enabled) return false;
    if (pathname === '/independent.html' && (req.method === 'GET' || req.method === 'HEAD')) {
      pump();
      const token = cookieToken(req);
      if (token && leases.has(token)) {
        makeLease(req, res, token);
        res.setHeader('Cache-Control', 'private, no-store');
        return false;
      }
      const identity = token || newIdentity(req, res);
      if (!waiting.has(identity) && order.length === 0 && activeCount() < maxActive) {
        makeLease(req, res, identity);
        res.setHeader('Cache-Control', 'private, no-store');
        return false;
      }
      if (!enqueue(req, res, identity)) { refuse(req, res, true); return true; }
      queuedPage(req, res, queueInfo(identity));
      return true;
    }
    if (pathname.startsWith('/independent/api/')) {
      pump();
      if (!leases.has(cookieToken(req))) {
        json(res, 403, { ok: false, error: { code: 'ADMISSION_REQUIRED', message: '请重新进入工坊' } }); return true;
      }
    }
    return false;
  }

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(sweepTimer);
    sweepTimer = null;
    for (const token of [...pending.keys()]) {
      settlePending(token, 503, { ok: false, error: { code: 'SERVER_CLOSING', message: '服务即将关闭，请稍后重试' } });
    }
    waiting.clear(); order.length = 0; leases.clear();
  }

  return { handle, stats, canEnter, close };
}
