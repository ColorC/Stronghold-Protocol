import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';

test('HTTP: 50 concurrent cold visitors, renewal, protected API, 51st rejection and release', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, independentMaxActive: 50 });
  try {
    const visitors = await Promise.all(Array.from({ length: 51 }, async () => {
      const response = await fetch(new URL('/independent.html?execution=client', server.url));
      return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], cache: response.headers.get('cache-control'), body: await response.text() };
    }));
    assert.equal(visitors.filter((x) => x.status === 200).length, 50);
    assert.equal(visitors.filter((x) => x.status === 503).length, 1);
    assert.doesNotMatch(visitors.find((x) => x.status === 503).body, /src=|stylesheet/);
    const accepted = visitors.find((x) => x.status === 200);
    assert.equal(accepted.cache, 'private, no-store');
    const headers = { cookie: accepted.cookie };
    const denied = await fetch(new URL('/independent/api/catalog', server.url)); assert.equal(denied.status, 403);
    const catalog = await fetch(new URL('/independent/api/catalog', server.url), { headers }); assert.equal(catalog.status, 200);
    const renewed = await fetch(new URL('/independent/api/admission', server.url), { headers, method: 'POST' }); assert.equal(renewed.status, 200);
    assert.equal(server.admission.stats().active, 50);
    await fetch(new URL('/independent/api/admission', server.url), { headers, method: 'DELETE' });
    const next = await fetch(new URL('/independent.html', server.url)); assert.equal(next.status, 200);
    assert.equal(server.admission.stats().active, 50);
  } finally { await server.close(); }
});
