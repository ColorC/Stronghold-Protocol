import { apiBase, makeOpId } from './model.js';
import { t } from '../../../shared/i18n.js';

function jsonHeaders(init = {}) {
  return { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) };
}

export function createAssaultApi({ fetchFn = globalThis.fetch?.bind(globalThis), href = globalThis.location?.href } = {}) {
  if (typeof fetchFn !== 'function') throw new Error('当前页面没有可用的网络接口');
  const base = apiBase(href);
  let connection = { status: 'connecting', ping: null };
  const listeners = new Set();
  const noteConnection = (response, started) => {
    connection = response && response.status < 500
      ? { status: 'online', ping: Math.max(0, Date.now() - started) }
      : { status: 'offline', ping: null };
    for (const listener of listeners) listener(connection);
  };
  async function call(path, init = {}) {
    const started = Date.now();
    let response;
    try {
      response = await fetchFn(new URL(path, base), { credentials: 'same-origin', ...init, headers: jsonHeaders(init) });
    } catch {
      noteConnection(null, started);
      return { ok: false, status: 0, error: { code: 'NETWORK', message: t('连接中断，请检查网络后重试。') } };
    }
    let body = null;
    try { body = await response.json(); } catch { /* export is intentionally not JSON */ }
    if (!body || typeof body !== 'object') {
      noteConnection(null, started);
      return { ok: false, status: response.status, error: { code: 'BAD_RESPONSE', message: t('服务器没有返回有效内容。') } };
    }
    noteConnection(response, started);
    return { ...body, status: response.status };
  }
  const id = (runId) => encodeURIComponent(runId);
  return Object.freeze({
    base,
    connection: () => connection,
    subscribeConnection(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    catalog: () => call('catalog'),
    create: ({ directorId, seed }) => call('runs', { method: 'POST', body: JSON.stringify({ directorId, ...(seed === undefined ? {} : { seed }) }) }),
    load: (runId) => call(`runs/${id(runId)}`),
    action(runId, type, params = {}, { opId = makeOpId(), expectedRevision } = {}) {
      return call(`runs/${id(runId)}/actions`, { method: 'POST', body: JSON.stringify({ opId, expectedRevision, type, ...params }) });
    },
    settle(runId, battleId, { opId = makeOpId(), expectedRevision } = {}) {
      return call(`runs/${id(runId)}/settle`, { method: 'POST', body: JSON.stringify({ battleId, opId, expectedRevision }) });
    },
    battle: (runId) => call(`runs/${id(runId)}/battle`),
    async exportRun(runId) {
      const started = Date.now();
      try {
        const response = await fetchFn(new URL(`runs/${id(runId)}/export`, base), { credentials: 'same-origin' });
        noteConnection(response, started);
        if (!response.ok) return { ok: false, status: response.status, error: { code: 'EXPORT', message: t('当前存档无法导出。') } };
        return { ok: true, response, blob: await response.blob() };
      } catch {
        noteConnection(null, started);
        return { ok: false, status: 0, error: { code: 'NETWORK', message: t('导出时连接中断。') } };
      }
    },
    importRun: (run) => call('runs/import', { method: 'POST', body: JSON.stringify({ run }) }),
  });
}

export function downloadBlob(blob, filename = t('进击模式存档.json')) {
  if (!blob || typeof document === 'undefined') return false;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
