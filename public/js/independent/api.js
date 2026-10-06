// 罗德岛战备演习 HTTP client (server/modes/independent/http.js). Paths are relative to the page, so the same build
// works on the local server (/independent.html) and behind the Workshop gateway (/stronghold/independent.html).
// The display catalog is fetched once; actions ask for the state only (`catalog: false`).

const base = () => new URL('independent/api/', globalThis.location.href);

async function call(path, init = {}) {
  let response;
  try {
    response = await fetch(new URL(path, base()), { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
  } catch {
    return { ok: false, status: 0, error: { code: 'NETWORK', message: '连接中断，请检查网络后重试' } };
  }
  let body = null;
  try { body = await response.json(); } catch { /* an empty or non-JSON answer */ }
  if (!body) return { ok: false, status: response.status, error: { code: 'BAD_RESPONSE', message: '服务器没有返回有效内容' } };
  return { ...body, status: response.status };
}

export const api = {
  catalog: () => call('catalog'),
  create: ({ seed, difficulty, roundLimit }) => call('sessions', { method: 'POST', body: JSON.stringify({ seed, difficulty, roundLimit }) }),
  load: (id) => call(`sessions/${encodeURIComponent(id)}?catalog=0`),
  act: (id, expectedRevision, action) => call(`sessions/${encodeURIComponent(id)}/actions`, { method: 'POST', body: JSON.stringify({ expectedRevision, action, catalog: false }) }),
  async replay(id, round) {
    try {
      const response = await fetch(new URL(`sessions/${encodeURIComponent(id)}/replays/${round}`, base()));
      return response.ok ? await response.json() : null;
    } catch { return null; }
  },
};
