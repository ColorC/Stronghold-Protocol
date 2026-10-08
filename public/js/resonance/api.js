const base = () => new URL('resonance/api/', globalThis.location.href);

async function call(path, init = {}) {
  let response;
  try {
    response = await fetch(new URL(path, base()), { credentials: 'same-origin', ...init,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
  } catch { return { ok: false, status: 0, error: { code: 'NETWORK', message: '连接中断，请检查网络后重试' } }; }
  let body;
  try { body = await response.json(); } catch { body = null; }
  return body ? { ...body, status: response.status }
    : { ok: false, status: response.status, error: { code: 'BAD_RESPONSE', message: '服务器没有返回有效内容' } };
}

export const resonanceApi = Object.freeze({
  catalog: (seed = 1, environmentId) => {
    const query = new URLSearchParams({ seed: String(seed) });
    if (environmentId) query.set('environmentId', environmentId);
    return call(`catalog?${query}`);
  },
  create: ({ seed, difficulty, environmentId }) => call('sessions', { method: 'POST', body: JSON.stringify({ seed, difficulty, environmentId }) }),
  load: (id) => call(`sessions/${encodeURIComponent(id)}?catalog=1`),
  act: (id, expectedRevision, action) => call(`sessions/${encodeURIComponent(id)}/actions`, {
    method: 'POST', body: JSON.stringify({ expectedRevision, action }),
  }),
  replay: async (id, round) => {
    const result = await call(`sessions/${encodeURIComponent(id)}/replays/${round}`);
    return result.ok ? result.replay : null;
  },
});
