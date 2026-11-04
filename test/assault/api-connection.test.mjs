import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssaultApi } from '../../public/js/assault/api.js';

test('native connection feedback follows transport failure, domain rejection, recovery and server outage', async () => {
  const results = [new Error('offline'), { status: 409, ok: false }, { status: 200, ok: true }, { status: 503, ok: false }];
  const api = createAssaultApi({ href: 'https://example.test/assault.html', fetchFn: async () => {
    const value = results.shift();
    if (value instanceof Error) throw value;
    return { status: value.status, json: async () => ({ ok: value.ok }) };
  } });
  const observed = [];
  const stop = api.subscribeConnection(value => observed.push(value));
  assert.equal((await api.catalog()).error.code, 'NETWORK');
  assert.deepEqual(api.connection(), { status: 'offline', ping: null });
  await api.catalog();
  assert.equal(api.connection().status, 'online');
  assert.ok(Number.isFinite(api.connection().ping));
  await api.catalog();
  assert.equal(api.connection().status, 'online');
  stop();
  await api.catalog();
  assert.deepEqual(api.connection(), { status: 'offline', ping: null });
  assert.deepEqual(observed.map(value => value.status), ['offline', 'online', 'online']);
});

test('export transport and malformed JSON update the same connection indicator', async () => {
  let failing = true;
  const api = createAssaultApi({ href: 'https://example.test/assault.html', fetchFn: async () => {
    if (failing) throw new Error('offline');
    return { status: 200, ok: true, blob: async () => new Blob(['save']), json: async () => null };
  } });
  await api.exportRun('run');
  assert.equal(api.connection().status, 'offline');
  failing = false;
  assert.equal((await api.exportRun('run')).ok, true);
  assert.equal(api.connection().status, 'online');
  assert.equal((await api.catalog()).error.code, 'BAD_RESPONSE');
  assert.equal(api.connection().status, 'offline');
});
