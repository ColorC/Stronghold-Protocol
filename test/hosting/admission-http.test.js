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

test('client-only deploy announces frontend execution and blocks legacy server simulation', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, independentExecution: 'client' });
  try {
    const admission = await fetch(new URL('/independent/api/admission', server.url), { method: 'POST' });
    assert.equal((await admission.json()).lease.execution, 'client');
    const legacy = await fetch(new URL('/independent/api/sessions/00000000-0000-4000-8000-000000000000/actions', server.url), { method: 'POST', body: '{}' });
    assert.equal(legacy.status, 409); assert.equal((await legacy.json()).error.code, 'CLIENT_EXECUTION_REQUIRED');
  } finally { await server.close(); }
});

test('HTTP FIFO queue advances one visitor at a time and shutdown ends pending waits', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, independentMaxActive: 1,
    independentMaxWaiting: 2, independentExecution: 'client', staticBase: 'https://static.invalid/0123456789abcdef0123456789abcdef01234567' });
  let closed = false;
  const endpoint = new URL('/independent/api/admission', server.url);
  const enter = async () => {
    const response = await fetch(new URL('/independent.html?execution=client', server.url));
    return { response, cookie: response.headers.get('set-cookie')?.split(';')[0], body: await response.text() };
  };
  const poll = (cookie) => fetch(`${endpoint.href}?wait=1`, { method: 'POST', headers: { cookie } });
  try {
    const first = await enter(); assert.equal(first.response.status, 200); assert.ok(first.cookie);
    const second = await enter(); assert.equal(second.response.status, 200); assert.ok(second.cookie);
    assert.match(second.response.headers.get('set-cookie'), /HttpOnly/);
    assert.ok(Buffer.byteLength(second.body) < 2048);
    assert.match(second.body, /前面还有 0 位|排在最前面/);
    assert.match(second.body, /hostingWait\.js/);
    assert.doesNotMatch(second.body, /<link|\/css\/|\/assets\/|\/vendor\/|independent\/main/);
    const third = await enter(); assert.equal(third.response.status, 200); assert.ok(third.cookie);
    assert.match(third.body, /前面还有 1 位/);
    const fourth = await enter(); assert.equal(fourth.response.status, 503);
    const localWaitScript = await fetch(new URL('/js/hostingWait.js', server.url));
    assert.equal(localWaitScript.status, 200); assert.match(localWaitScript.headers.get('content-type'), /javascript/);
    assert.match(await localWaitScript.text(), /startHostingWait/);

    const secondPoll = poll(second.cookie);
    const thirdPoll = poll(third.cookie);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await fetch(endpoint, { method: 'DELETE', headers: { cookie: first.cookie } });
    const secondTurn = await secondPoll; assert.equal(secondTurn.status, 200); assert.equal((await secondTurn.json()).lease.execution, 'client');
    assert.equal(secondTurn.headers.get('set-cookie')?.split(';')[0], second.cookie);
    const positionUpdate = await thirdPoll; assert.equal(positionUpdate.status, 202); assert.equal((await positionUpdate.json()).queued.position, 1);
    const thirdPollAgain = poll(third.cookie);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fetch(endpoint, { method: 'DELETE', headers: { cookie: second.cookie } });
    const thirdTurn = await thirdPollAgain; assert.equal(thirdTurn.status, 200);

    const nextWaiter = await enter(); assert.equal(nextWaiter.response.status, 200);
    const pending = poll(nextWaiter.cookie);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await server.close(); closed = true;
    const shutdown = await pending; assert.equal(shutdown.status, 503); assert.equal((await shutdown.json()).error.code, 'SERVER_CLOSING');
  } finally { if (!closed) await server.close(); }
});
