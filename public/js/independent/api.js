// 卫戍协议：工坊 HTTP client (server/modes/independent/http.js). Paths are relative to the page, so the same build
// works on the local server (/independent.html) and behind the Workshop gateway (/stronghold/independent.html).
// The display catalog is fetched once; actions ask for the state only (`catalog: false`).

const base = () => new URL('independent/api/', globalThis.location.href);

async function call(path, init = {}) {
  let response;
  try {
    response = await fetch(new URL(path, base()), { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
  } catch {
    return { ok: false, status: 0, error: { code: 'NETWORK', message: '连接中断，请检查网络后重试' } };
  }
  let body = null;
  try { body = await response.json(); } catch { /* an empty or non-JSON answer */ }
  if (!body) return { ok: false, status: response.status, error: { code: 'BAD_RESPONSE', message: '服务器没有返回有效内容' } };
  return { ...body, status: response.status };
}

const serverApi = {
  catalog: () => call('catalog'),
  create: ({ seed, difficulty, roundLimit, growthMode = 'levels' }) => call('sessions', { method: 'POST', body: JSON.stringify({ seed, difficulty, roundLimit, growthMode }) }),
  load: (id) => call(`sessions/${encodeURIComponent(id)}?catalog=0`),
  act: (id, expectedRevision, action) => call(`sessions/${encodeURIComponent(id)}/actions`, { method: 'POST', body: JSON.stringify({ expectedRevision, action, catalog: false }) }),
  async replay(id, round) {
    try {
      const response = await fetch(new URL(`sessions/${encodeURIComponent(id)}/replays/${round}`, base()));
      return response.ok ? await response.json() : null;
    } catch { return null; }
  },
  recordingStart(sessionId, recordingId, viewport) { return call('recordings/start', { method: 'POST', body: JSON.stringify({ sessionId, recordingId, viewport }) }); },
  recordingEvents(id, events, keepalive = false) { return call(`recordings/${encodeURIComponent(id)}/events`, { method: 'POST', keepalive, body: JSON.stringify({ events }) }); },
  recordingStop(id) { return call(`recordings/${encodeURIComponent(id)}/stop`, { method: 'POST', body: '{}' }); },
  recordingLoad(id) { return call(`recordings/${encodeURIComponent(id)}`); },
};

let worker;
let workerReady;
let nextRequest = 0;
const pending = new Map();
const rawStates = new Map();

function resetWorker(error = '本地引擎启动失败') {
  const current = worker;
  worker = null;
  workerReady = null;
  current?.terminate();
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.resolve({ ok: false, error: { code: 'WORKER', message: error } });
  }
  pending.clear();
}

function getWorker() {
  if (worker) return workerReady;
  const instance = new Worker(new URL('/js/independent/client-worker.js', globalThis.location.href), { type: 'module', name: 'independent-session-engine' });
  worker = instance;
  workerReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { resetWorker('本地引擎启动超时'); reject(new Error('本地引擎启动超时')); }, 30000);
    instance.addEventListener('message', ({ data }) => {
      if (data?.type === 'ready') { clearTimeout(timer); resolve(instance); return; }
      const item = pending.get(data?.requestId);
      if (!item) return;
      pending.delete(data.requestId);
      clearTimeout(item.timer);
      item.resolve(data);
    });
    instance.addEventListener('error', (event) => {
      clearTimeout(timer);
      resetWorker(event.message || '本地引擎启动失败');
      reject(new Error(event.message || '本地引擎启动失败'));
    });
  });
  return workerReady;
}

async function engine(op, args) {
  try {
    const instance = await getWorker();
    return await new Promise((resolve) => {
      const requestId = ++nextRequest;
      const timer = setTimeout(() => { pending.delete(requestId); resetWorker('本地引擎操作超时'); resolve({ ok: false, error: { code: 'WORKER', message: '本地引擎操作超时' } }); }, 120000);
      pending.set(requestId, { resolve, timer });
      try { instance.postMessage({ requestId, op, args }); }
      catch (error) { pending.delete(requestId); clearTimeout(timer); resolve({ ok: false, error: { code: 'WORKER', message: error?.message || '本地引擎无法接收操作' } }); }
    });
  } catch (error) {
    return { ok: false, error: { code: 'WORKER', message: error?.message || '本地引擎启动失败' } };
  }
}

async function restore(rawState) {
  return engine('restore', { rawState });
}

const serverError = (response, fallback = '存档没有保存') => response?.error || { code: 'BAD_RESPONSE', message: fallback };
function topLevelChanges(current, next) {
  const changes = {};
  for (const [key, value] of Object.entries(next)) {
    const before = Object.hasOwn(current, key) ? JSON.stringify(current[key]) : undefined;
    if (before !== JSON.stringify(value)) changes[key] = value;
  }
  return changes;
}
const clientApi = {
  async catalog() {
    const result = await engine('catalog');
    return result.ok ? { ok: true, catalog: result.catalog } : { ...result, status: 503 };
  },
  async create(options) {
    const created = await engine('create', options);
    if (!created.ok) return { ...created, status: 422 };
    const saved = await call('sessions', { method: 'POST', body: JSON.stringify({ rawState: created.rawState }) });
    if (!saved.ok) return { ok: false, status: saved.status || 422, error: serverError(saved, '无法保存新的一局') };
    rawStates.set(saved.id, created.rawState);
    return { ok: true, status: saved.status || 201, id: saved.id, state: created.state };
  },
  async load(id) {
    const saved = await call(`sessions/${encodeURIComponent(id)}?raw=1&catalog=0`);
    if (!saved.ok) return saved;
    const loaded = await restore(saved.rawState);
    if (!loaded.ok) return { ...loaded, status: 422 };
    rawStates.set(id, loaded.rawState);
    return { ok: true, status: saved.status, id, state: loaded.state };
  },
  async act(id, expectedRevision, action) {
    let current = rawStates.get(id);
    if (!current) {
      const loaded = await this.load(id);
      if (!loaded.ok) return loaded;
      current = rawStates.get(id);
    }
    if (expectedRevision !== current.revision) return { ok: false, status: 409, state: (await restore(current)).state, error: { code: 'REVISION', message: '对局已更新，请重试当前操作' } };
    const changed = await engine('act', { rawState: current, action });
    if (!changed.ok) return { ...changed, status: 422 };
    const saved = await call(`sessions/${encodeURIComponent(id)}/checkpoint`, {
      method: 'POST', body: JSON.stringify({ expectedRevision: current.revision, changes: topLevelChanges(current, changed.rawState) }),
    });
    if (!saved.ok) {
      if (saved.status === 409 && saved.rawState) {
        const latest = await restore(saved.rawState);
        if (latest.ok) rawStates.set(id, latest.rawState);
        return { ok: false, status: 409, state: latest.state, error: serverError(saved) };
      }
      return { ok: false, status: saved.status || 422, state: (await restore(current)).state, error: serverError(saved) };
    }
    rawStates.set(id, changed.rawState);
    if (changed.replay) {
      const { saveClientReplay } = await import('./client-replays.js');
      await saveClientReplay(id, changed.replay);
    }
    return { ok: true, status: saved.status, state: changed.state, events: changed.events };
  },
  async replay(id, round) {
    const { loadClientReplay } = await import('./client-replays.js');
    return loadClientReplay(id, round);
  },
  recordingStart: (...args) => serverApi.recordingStart(...args),
  recordingEvents: (...args) => serverApi.recordingEvents(...args),
  recordingStop: (...args) => serverApi.recordingStop(...args),
  recordingLoad: (...args) => serverApi.recordingLoad(...args),
};

export const executionMode = new URL(globalThis.location?.href || 'http://localhost/').searchParams.get('execution') === 'client' ? 'client' : 'server';
export const api = executionMode === 'client' ? clientApi : serverApi;
