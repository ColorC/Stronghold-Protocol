import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { createAssaultRecordingHttp } from '../../server/modes/assault/recordings.js';
import { createAssaultHttp } from '../../server/modes/assault/http.js';

const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sp-assault-recording-'));
  const records = path.join(root, 'recordings');
  const handle = createAssaultRecordingHttp({ directory: records });
  const server = http.createServer(async (req, res) => {
    if (!await handle(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return { root, records, base: `http://127.0.0.1:${server.address().port}/api/assault/recordings` };
}
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
const event = (seq, kind = 'rrweb', p = { type: 3 }) => ({ seq, ts: 1000 + seq, kind, p });

test('start rejects bad ids and a missing run is allowed; a repeated start resumes the same recording', async (t) => {
  const f = await fixture(t);
  assert.equal((await post(`${f.base}/start`, { runId: 'nope' })).status, 422);
  assert.equal((await post(`${f.base}/start`, { recordingId: 'nope' })).status, 422);
  const first = await post(`${f.base}/start`, { runId, viewport: { width: 1280, height: 720 } }).then((r) => r.json());
  assert.equal(first.ok, true); assert.equal(first.nextSeq, 1); assert.equal(first.nextMediaSeq, 1);
  await post(`${f.base}/${first.id}/events`, { events: [event(1), event(2)] });
  const again = await post(`${f.base}/start`, { recordingId: first.id }).then((r) => r.json());
  assert.equal(again.id, first.id); assert.equal(again.nextSeq, 3);
  const meta = JSON.parse(await readFile(path.join(f.records, first.id, 'meta.json'), 'utf8'));
  assert.equal(meta.mode, 'assault'); assert.equal(meta.runId, runId); assert.deepEqual(meta.viewport, { width: 1280, height: 720 });
});

test('events are acknowledged in order, a gap stalls the ack, and stop compresses the stream to events.jsonl.gz', async (t) => {
  const f = await fixture(t);
  const { id } = await post(`${f.base}/start`, {}).then((r) => r.json());
  assert.deepEqual(await post(`${f.base}/${id}/events`, { events: [event(1), event(2)] }).then((r) => r.json()), { ok: true, ack: 2 });
  assert.deepEqual(await post(`${f.base}/${id}/events`, { events: [event(4)] }).then((r) => r.json()), { ok: true, ack: 2 }, 'a gap is not acknowledged');
  assert.deepEqual(await post(`${f.base}/${id}/events`, { events: [event(2), event(3), event(4)] }).then((r) => r.json()), { ok: true, ack: 4 }, 'retries are idempotent');
  assert.equal((await post(`${f.base}/${id}/events`, { events: [{ seq: 0, kind: 'x', ts: 1 }] })).status, 422);
  const live = await fetch(`${f.base}/${id}`).then((r) => r.json());
  assert.deepEqual(live.events.map((e) => e.seq), [1, 2, 3, 4]);
  const stopped = await post(`${f.base}/${id}/stop`, {}).then((r) => r.json());
  assert.equal(stopped.ok, true);
  await assert.rejects(stat(path.join(f.records, id, 'events.jsonl')));
  const gz = gunzipSync(await readFile(path.join(f.records, id, 'events.jsonl.gz'))).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(gz.map((e) => e.seq), [1, 2, 3, 4]);
  const replay = await fetch(`${f.base}/${id}`).then((r) => r.json());
  assert.deepEqual(replay.events.map((e) => e.seq), [1, 2, 3, 4]); assert.ok(replay.meta.endedAt); assert.ok(replay.meta.eventsGzBytes > 0);
  assert.equal((await post(`${f.base}/${id}/events`, { events: [event(5)] })).status, 409, 'an ended recording takes no more events');
});

test('media chunks append per segment, enforce order and serve byte ranges without any transcoding', async (t) => {
  const f = await fixture(t);
  const { id } = await post(`${f.base}/start`, {}).then((r) => r.json());
  const media = (seq, bytes, startedAt = 1700000000000, timeMs = 1000) => post(`${f.base}/${id}/media/${seq}`, Buffer.from(bytes), { 'content-type': 'video/webm', 'x-media-started-at': String(startedAt), 'x-media-time-ms': String(timeMs), 'x-media-mime-type': 'video/webm' });
  assert.deepEqual(await media(1, 'AAAA').then((r) => r.json()), { ok: true, ack: 1 });
  assert.equal((await media(3, 'CCCC')).status, 409);
  assert.deepEqual(await media(1, 'AAAA').then((r) => r.json()), { ok: true, ack: 1 }, 'a repeated chunk is acknowledged without a second append');
  assert.deepEqual(await media(2, 'BBBB', 1700000000000, 2000).then((r) => r.json()), { ok: true, ack: 2 });
  assert.deepEqual(await media(3, 'XY', 1700000099000, 500).then((r) => r.json()), { ok: true, ack: 3 }, 'a new start time opens segment 2');
  const meta = await fetch(`${f.base}/${id}?meta=1`).then((r) => r.json()).then((r) => r.meta);
  assert.deepEqual(meta.mediaSegments.map((s) => [s.index, s.bytes]), [[1, 8], [2, 2]]);
  assert.equal(meta.mediaBytes, 10);
  assert.equal((await post(`${f.base}/${id}/media/4`, Buffer.from('x'), { 'x-media-started-at': '1', 'x-media-time-ms': '1', 'x-media-mime-type': 'text/plain' })).status, 409);
  const whole = await fetch(`${f.base}/${id}/media/playback/1`);
  assert.equal(whole.status, 200); assert.equal(whole.headers.get('accept-ranges'), 'bytes'); assert.equal(await whole.text(), 'AAAABBBB');
  const part = await fetch(`${f.base}/${id}/media/playback/1`, { headers: { range: 'bytes=2-5' } });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 2-5/8'); assert.equal(await part.text(), 'AABB');
  assert.equal((await fetch(`${f.base}/${id}/media/playback/2`).then((r) => r.text())), 'XY');
  assert.equal((await fetch(`${f.base}/${id}/media/playback/9`)).status, 404);
  assert.equal((await fetch(`${f.base}/${id}/media/playback/1`, { headers: { range: 'bytes=50-60' } })).status, 416);
});

test('captions are validated, sorted and stored beside the recording, not inside the video', async (t) => {
  const f = await fixture(t);
  const { id } = await post(`${f.base}/start`, {}).then((r) => r.json());
  assert.deepEqual(await fetch(`${f.base}/${id}/captions`).then((r) => r.json()), { ok: true, recordingId: id, items: [] });
  const put = (items) => fetch(`${f.base}/${id}/captions`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) });
  assert.equal((await put([{ at: -1, text: 'x' }])).status, 422);
  assert.equal((await put([{ at: 1, text: '' }])).status, 422);
  assert.equal((await put([{ at: 1, text: '一'.repeat(41) }])).status, 422);
  assert.equal((await put('x')).status, 422);
  assert.equal((await put([{ at: 20, text: '商店刷新' }, { at: 5.12345, until: 9, text: '银灰施放：全队再部署 -12 秒', key: 'k' }])).status, 200);
  const items = await fetch(`${f.base}/${id}/captions`).then((r) => r.json()).then((r) => r.items);
  assert.deepEqual(items, [{ at: 5.123, text: '银灰施放：全队再部署 -12 秒', until: 9, key: 'k' }, { at: 20, text: '商店刷新' }]);
  assert.equal((await fetch(`${f.base}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/captions`)).status, 404);
});

test('foreign origins and unknown routes are refused; assault http mounts the recording routes only when configured', async (t) => {
  const f = await fixture(t);
  assert.equal((await post(`${f.base}/start`, {}, { origin: 'http://evil.example' })).status, 403);
  assert.equal((await fetch(`${f.base}/not-an-id`)).status, 404);
  const context = { catalog: {}, design: {}, runtime: {} };
  const withRoot = createAssaultHttp({ context, runRoot: path.join(f.root, 'runs'), recordingRoot: f.records });
  const without = createAssaultHttp({ context, runRoot: path.join(f.root, 'runs2') });
  const fake = () => ({ status: 0, writeHead(s) { this.status = s; }, end() {}, setHeader() {} });
  const res = fake();
  assert.equal(await withRoot({ method: 'GET', headers: {}, url: '/api/assault/recordings/x' }, res, '/api/assault/recordings/x'), true);
  assert.equal(res.status, 404);
  assert.equal(await without({ method: 'GET', headers: {}, url: '/api/assault/recordings/x' }, fake(), '/api/assault/recordings/x'), false);
});
