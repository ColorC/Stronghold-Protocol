import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRecordingHttp } from '../../server/modes/independent/recordings.js';

test('recording API accepts and persists full initial-state and server-action traces', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sp-recording-traces-'));
  const sessions = path.join(root, 'sessions'); const records = path.join(root, 'recordings');
  await mkdir(sessions);
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await writeFile(path.join(sessions, `${sessionId}.json`), '{}');
  const handle = createRecordingHttp({ directory: records, sessionDirectory: sessions });
  const server = http.createServer(async (req, res) => {
    if (!await handle(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/independent/api/recordings`;
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const started = await post(`${base}/start`, { sessionId, viewport: { width: 1280, height: 720 } }).then((response) => response.json());
  const events = [
    { seq: 1, ts: 1000, kind: 'initial-state', p: { sessionId, revision: 8, occurredAt: 1000, state: { revision: 8, round: 3, field: [{ uid: 'u1', x: 2, y: 4 }], bench: [] } } },
    { seq: 2, ts: 1250, kind: 'server-action', p: { action: 'deploy', command: { type: 'deploy', uid: 'u1', x: 2, y: 4 }, revision: 9, eventTypes: ['deployed'], occurredAt: 1250, state: { revision: 9, round: 3, field: [{ uid: 'u1', x: 2, y: 4 }], bench: [] } } },
  ];
  const accepted = await post(`${base}/${started.id}/events`, { events });
  assert.deepEqual(await accepted.json(), { ok: true, ack: 2 });
  const replay = await fetch(`${base}/${started.id}`).then((response) => response.json());
  assert.equal(replay.events[0].kind, 'initial-state');
  assert.deepEqual(replay.events[0].p.state.field, [{ uid: 'u1', x: 2, y: 4 }]);
  assert.equal(replay.events[1].kind, 'server-action');
  assert.deepEqual(replay.events[1].p.command, events[1].p.command);
  assert.deepEqual(replay.events[1].p.state, events[1].p.state);
  const persisted = await readFile(path.join(records, started.id, 'events.jsonl'), 'utf8');
  assert.match(persisted, /"kind":"initial-state"/);
  assert.match(persisted, /"kind":"server-action"/);
});
