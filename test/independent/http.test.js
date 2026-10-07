import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { startServer } from '../../server/index.js';

test('independent HTTP actions serialize revisions, persist across restarts and run the real battle', async () => {
  await mkdir(path.resolve('.omni/tmp'), { recursive: true });
  const directory = await mkdtemp(path.resolve('.omni/tmp/independent-http-'));
  console.log(JSON.stringify({ directory, role: 'isolated persistent-session test files' }));
  let server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, independentDirectory: directory });
  let root = server.url;
  const request = async (endpoint, body, headers = {}) => {
    const response = await fetch(new URL(endpoint, root), { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const created = await request('/independent/api/sessions', { seed: 1, difficulty: 'FUNNY', roundLimit: 9 });
    assert.equal(created.status, 201);
    const { id, catalog } = created.data;
    assert.equal(Object.keys(catalog.operators).length, 224);
    assert.equal(catalog.gear.precision.normal.includes('10'), true);
    assert.ok(!JSON.stringify(catalog).includes('originalNormal'));
    const endpoint = `/independent/api/sessions/${id}`;
    const actions = endpoint + '/actions';
    const slot = created.data.state.shop.slots.findIndex((x) => x.kind === 'chess' && catalog.operators[x.id]?.position === 'MELEE');
    assert.ok(slot >= 0);
    const concurrent = await Promise.all([request(actions, { expectedRevision: 0, action: { type: 'buy', slot } }), request(actions, { expectedRevision: 0, action: { type: 'buy', slot } })]);
    assert.deepEqual(concurrent.map((x) => x.status).sort(), [200, 409]);
    let snapshot = (await request(endpoint)).data;
    assert.equal(snapshot.state.revision, 1);
    const before = await readFile(path.join(directory, `${id}.json`), 'utf8');
    const failed = await request(actions, { expectedRevision: 1, action: { type: 'move', uid: 'absent', row: 9, col: 3 } });
    assert.equal(failed.status, 422);
    assert.equal(await readFile(path.join(directory, `${id}.json`), 'utf8'), before);
    assert.equal((await request('/independent/api/sessions/not-a-session')).status, 404);
    assert.equal((await request(actions, { expectedRevision: 1, action: { type: 'refresh' } }, { origin: 'https://unrelated.invalid' })).status, 403);
    const oversized = await request(actions, { text: 'a'.repeat(66_000) });
    assert.equal(oversized.status, 413);
    await server.close();
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, independentDirectory: directory });
    root = server.url;
    assert.deepEqual((await request(endpoint)).data.state, snapshot.state);
    if (!snapshot.state.pieces.length) {
      const buySlot = snapshot.state.shop.slots.findIndex((x) => x.kind === 'chess');
      snapshot = (await request(actions, { expectedRevision: snapshot.state.revision, action: { type: 'buy', slot: buySlot } })).data;
    }
    const piece = snapshot.state.pieces[0];
    const tile = snapshot.state.board.map.find(([, kind]) => kind === 'melee');
    const [row, col] = tile[0].split(',').map(Number);
    const moved = await request(actions, { expectedRevision: snapshot.state.revision, action: { type: 'move', uid: piece.uid, row, col } });
    assert.equal(moved.status, 200);
    const ready = await request(actions, { expectedRevision: moved.data.state.revision, action: { type: 'ready' } });
    assert.equal(ready.status, 200);
    assert.equal(ready.data.state.round, 2);
    assert.ok(ready.data.state.battleSummary.samples.length);
    assert.equal(ready.data.state.battleSummary.diagnostics.errorCount, 0);
    // the battle's replay is kept beside the session (never inside it) and served per round, gzip or plain
    const fought = ready.data.events.find((x) => x.type === 'battle');
    assert.equal(fought.round, 1);
    assert.ok(!JSON.stringify(ready.data.state).includes('"frames"'));
    const replayUrl = new URL(`${endpoint}/replays/1`, root);
    const zipped = await fetch(replayUrl, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(zipped.status, 200);
    const replay = await zipped.json();
    assert.equal(replay.round, 1);
    assert.equal(replay.field.fieldId, 'independent-r1');
    assert.ok(replay.frames.length > 10 && replay.frames.every((f) => Array.isArray(f.ev) && Array.isArray(f.snap.units)));
    assert.ok(replay.frames.some((f) => f.ev.some((e) => e[0] === 'atk')), 'the replay carries attack events for the renderer');
    assert.equal(replay.duration, fought.duration);
    const plain = await new Promise((resolve, reject) => http.get(replayUrl, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ res, body }));
    }).on('error', reject));
    assert.equal(plain.res.headers['content-encoding'], undefined);
    assert.deepEqual(JSON.parse(plain.body), replay);
    assert.equal((await fetch(new URL(`${endpoint}/replays/2`, root))).status, 404);
    assert.equal((await fetch(new URL(`${endpoint}/replays/x`, root))).status, 404);
    assert.ok((await fetch(new URL('/', root))).ok, 'original homepage remains available');
    console.log(JSON.stringify({ path: path.join(directory, `${id}.json`), role: 'actual session after battle and server restart' }));
  } finally { await server.close(); }
});
