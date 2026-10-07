import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../../server/index.js';
import { createSession, applyAction } from '../../server/modes/independent/session.js';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';

const RUNTIME = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/client-hosting-20261007/client-compute';

test('client raw-state create/load and revision-checked checkpoints are bounded and never create server replays', async () => {
  await mkdir(RUNTIME, { recursive: true });
  const directory = await mkdtemp(path.join(RUNTIME, 'checkpoint-http-'));
  console.log(JSON.stringify({ directory, role: 'client checkpoint HTTP test data' }));
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, independentDirectory: directory });
  try {
    let cookie = '';
    const admission = await fetch(new URL('/independent/api/admission', server.url), { method: 'POST', body: '{}' });
    cookie = admission.headers.get('set-cookie')?.split(';', 1)[0] || '';
    const request = async (endpoint, body) => {
      const response = await fetch(new URL(endpoint, server.url), { method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      let data = null;
      try { data = await response.json(); } catch { /* keep malformed response visible in assertion */ }
      return { status: response.status, data };
    };
    if (admission.ok) assert.equal(admission.status, 200);
    const data = getData(); const catalog = getCatalog(data);
    const raw = createSession({ seed: 9017, difficulty: 'FUNNY', roundLimit: 9, data, catalog });
    const created = await request('/independent/api/sessions', { rawState: raw });
    assert.equal(created.status, 201);
    const id = created.data.id;
    assert.deepEqual(created.data.rawState, raw);
    for (const malformed of [
      { ...raw, pieces: {} },
      { ...raw, inventory: null },
      { ...raw, pieces: [null] },
      { ...raw, revision: 1 },
    ]) {
      const rejected = await request('/independent/api/sessions', { rawState: malformed });
      assert.equal(rejected.status, 422);
      assert.equal(rejected.data.error.code, 'INVALID_SESSION');
    }
    const loaded = await request(`/independent/api/sessions/${id}?raw=1&catalog=0`);
    assert.equal(loaded.status, 200);
    assert.deepEqual(loaded.data.rawState, raw);

    const slot = raw.shop.slots.findIndex((x) => x.kind === 'chess' && x.id);
    const advanced = applyAction(raw, { type: 'buy', slot }, { data, catalog });
    assert.equal(advanced.ok, true);
    const changes = Object.fromEntries(Object.entries(advanced.state).filter(([key, value]) => JSON.stringify(raw[key]) !== JSON.stringify(value)));
    const deltaRequest = { expectedRevision: raw.revision, changes };
    assert.ok(Buffer.byteLength(JSON.stringify(deltaRequest)) < Buffer.byteLength(JSON.stringify({ expectedRevision: raw.revision, state: advanced.state })));
    const checkpoint = await request(`/independent/api/sessions/${id}/checkpoint`, deltaRequest);
    assert.equal(checkpoint.status, 200);
    assert.equal(checkpoint.data.revision, advanced.state.revision);
    assert.deepEqual((await request(`/independent/api/sessions/${id}?raw=1&catalog=0`)).data.rawState, advanced.state);

    const stale = applyAction(raw, { type: 'refresh' }, { data, catalog });
    assert.equal(stale.ok, true);
    const conflict = await request(`/independent/api/sessions/${id}/checkpoint`, { expectedRevision: raw.revision, state: stale.state });
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.data.rawState, advanced.state);
    const legacyRaw = createSession({ seed: 9018, difficulty: 'FUNNY', roundLimit: 9, data, catalog });
    const legacyCreated = await request('/independent/api/sessions', { rawState: legacyRaw });
    const legacyAction = applyAction(legacyRaw, { type: 'buy', slot: legacyRaw.shop.slots.findIndex((x) => x.kind === 'chess' && x.id) }, { data, catalog });
    const legacyCheckpoint = await request(`/independent/api/sessions/${legacyCreated.data.id}/checkpoint`, { expectedRevision: 0, state: legacyAction.state });
    assert.equal(legacyCheckpoint.status, 200, 'full-state checkpoints remain compatible');
    const persistedBeforeInvalid = await readFile(path.join(directory, `${id}.json`), 'utf8');
    for (const malformed of [
      { ...advanced.state, revision: advanced.state.revision + 1, modeId: 'invalid' },
      { ...advanced.state, revision: advanced.state.revision + 1, pieces: {} },
      { ...advanced.state, revision: advanced.state.revision + 1, inventory: null },
      { ...advanced.state, revision: advanced.state.revision + 1, pieces: [null] },
    ]) {
      const invalid = await request(`/independent/api/sessions/${id}/checkpoint`, { expectedRevision: advanced.state.revision, state: malformed });
      assert.equal(invalid.status, 422);
      assert.equal(invalid.data.error.code, 'INVALID_SESSION');
      assert.equal(await readFile(path.join(directory, `${id}.json`), 'utf8'), persistedBeforeInvalid);
    }
    for (const forbidden of ['__proto__', 'prototype', 'constructor']) {
      const changes = JSON.parse(`{"${forbidden}":{ "polluted":true },"revision":${advanced.state.revision + 1}}`);
      const invalid = await request(`/independent/api/sessions/${id}/checkpoint`, { expectedRevision: advanced.state.revision, changes });
      assert.equal(invalid.status, 422);
      assert.equal(await readFile(path.join(directory, `${id}.json`), 'utf8'), persistedBeforeInvalid);
    }
    assert.deepEqual((await request(`/independent/api/sessions/${id}?raw=1&catalog=0`)).data.rawState, advanced.state);
    assert.equal((await readdir(directory)).some((name) => name.includes('.replay-r')), false);

    const oversized = await request('/independent/api/sessions', { rawState: { text: 'x'.repeat(2 * 1024 * 1024) } });
    assert.equal(oversized.status, 413);
    console.log(JSON.stringify({ path: path.join(directory, `${id}.json`), role: 'persisted bounded client checkpoint' }));
  } finally { await server.close(); }
});
