import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRecordingHttp } from '../../server/modes/independent/recordings.js';

test('recording API stores acknowledged rrweb and caption events, deduplicates retries, and ends explicitly', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sp-recording-test-'));
  const sessions = path.join(root, 'sessions'); const records = path.join(root, 'recordings');
  await mkdir(sessions); const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await writeFile(path.join(sessions, `${sessionId}.json`), '{}');
  const handle = createRecordingHttp({ directory: records, sessionDirectory: sessions });
  const server = http.createServer(async (req, res) => {
    if (!await handle(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/independent/api/recordings`;
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const start = await post(`${base}/start`, { sessionId, viewport: { width: 1280, height: 720 } });
  const created = await start.json(); assert.equal(start.status, 200); assert.equal(created.nextSeq, 1); assert.match(created.id, /^[0-9a-f-]{36}$/i);
  const replayEvents = [
    { seq: 1, ts: 1000, kind: 'rrweb', p: { type: 2, timestamp: 1000, data: {} } },
    { seq: 2, ts: 1800, kind: 'caption', p: { text: '展开参考原卡', rect: { x: 20, y: 30, width: 200, height: 44 } } },
  ];
  const written = await post(`${base}/${created.id}/events`, { events: replayEvents });
  assert.deepEqual(await written.json(), { ok: true, ack: 2 });
  const retry = await post(`${base}/${created.id}/events`, { events: replayEvents });
  assert.deepEqual(await retry.json(), { ok: true, ack: 2 });
  const gap = await post(`${base}/${created.id}/events`, { events: [{ seq: 4, ts: 2300, kind: 'rrweb', p: { timestamp: 2300 } }] });
  assert.deepEqual(await gap.json(), { ok: true, ack: 2 });
  const read = await fetch(`${base}/${created.id}`); const packet = await read.json();
  assert.equal(packet.meta.sessionId, sessionId); assert.equal(packet.events.length, 2);
  assert.equal(packet.events[0].kind, 'rrweb'); assert.equal(packet.events[1].p.rect.x, 20);
  const jsonl = await readFile(path.join(records, created.id, 'events.jsonl'), 'utf8');
  assert.equal(jsonl.trim().split('\n').length, 2);
  const ended = await post(`${base}/${created.id}/stop`, {}); assert.equal(ended.status, 200);
  const rejected = await post(`${base}/${created.id}/events`, { events: [{ seq: 3, ts: 3000, kind: 'caption', p: {} }] });
  assert.equal(rejected.status, 409);
  const resumed = await post(`${base}/start`, { sessionId, recordingId: created.id });
  assert.equal((await resumed.json()).endedAt !== null, true);
});
