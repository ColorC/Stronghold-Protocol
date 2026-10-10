import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRecordingHttp } from '../../server/modes/independent/recordings.js';

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sp-recording-comments-'));
  const sessions = path.join(root, 'sessions'); const records = path.join(root, 'recordings');
  await mkdir(sessions); await writeFile(path.join(sessions, `${sessionId}.json`), '{}');
  const handle = createRecordingHttp({ directory: records, sessionDirectory: sessions });
  const server = http.createServer(async (req, res) => {
    if (!await handle(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/independent/api/recordings`;
  const started = await fetch(`${base}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) }).then((r) => r.json());
  return { root, records, base, id: started.id };
}

const makeBody = (time_sec, extra = {}) => ({
  anchor: { time_sec, selector: '#frame', frame_path: ['iframe#stage'], tag: 'canvas', text_excerpt: 'captured scene', beat_id: 'opening', rect: { x: 2, y: 3, width: 40, height: 50 }, viewport: { width: 1280, height: 720 } },
  comment: '  Check this frame  ', author: 'reviewer', ...extra,
});

test('recording timestamp comments persist CRUD data and serialize concurrent writes', async (t) => {
  const f = await fixture(t);
  const folder = path.join(f.records, f.id);
  const metaBefore = await readFile(path.join(folder, 'meta.json'), 'utf8');
  const eventsBefore = await readFile(path.join(folder, 'events.jsonl'), 'utf8');

  const firstResponse = await fetch(`${f.base}/${f.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(makeBody(8.25)) });
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  assert.match(first.id, /^vrc-[0-9a-f]{12}$/); assert.equal(first.comment, 'Check this frame'); assert.equal(first.author, 'reviewer'); assert.equal(first.resolved, false);
  assert.deepEqual(first.anchor, { time_sec: 8.25, selector: '#frame', frame_path: ['iframe#stage'], tag: 'canvas', text_excerpt: 'captured scene', beat_id: 'opening', rect: { x: 2, y: 3, width: 40, height: 50 }, viewport: { width: 1280, height: 720 } });

  const later = await Promise.all(Array.from({ length: 12 }, (_, i) => fetch(`${f.base}/${f.id}/comments`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(makeBody(20 - i, { comment: `parallel-${i}`, author: undefined })),
  })));
  assert.ok(later.every((response) => response.status === 201));
  const listing = await fetch(`${f.base}/${f.id}/comments`).then((r) => r.json());
  assert.equal(listing.total, 13); assert.equal(listing.open, 13); assert.equal(listing.items[0].anchor.time_sec, 8.25);
  assert.equal(new Set(listing.items.map((item) => item.id)).size, 13);
  assert.equal(listing.items.filter((item) => item.comment.startsWith('parallel-') && item.author === 'user').length, 12);
  const stored = JSON.parse(await readFile(path.join(folder, 'comments.json'), 'utf8'));
  stored.sort((a, b) => a.anchor.time_sec - b.anchor.time_sec || a.created_at.localeCompare(b.created_at));
  assert.deepEqual(stored, listing.items);

  const patched = await fetch(`${f.base}/${f.id}/comments/${first.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comment: ' revised ', resolved: true }) });
  assert.equal(patched.status, 200); assert.deepEqual(await patched.json().then(({ comment, resolved }) => ({ comment, resolved })), { comment: 'revised', resolved: true });
  const afterPatch = await fetch(`${f.base}/${f.id}/comments`).then((r) => r.json()); assert.equal(afterPatch.open, 12);
  const deleted = await fetch(`${f.base}/${f.id}/comments/${first.id}`, { method: 'DELETE' }); assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).remaining, 12);
  assert.equal(await readFile(path.join(folder, 'meta.json'), 'utf8'), metaBefore);
  assert.equal(await readFile(path.join(folder, 'events.jsonl'), 'utf8'), eventsBefore);
});

test('recording comments reject invalid data, preserve corrupt stores, and keep origin and recording boundaries', async (t) => {
  const f = await fixture(t);
  const missing = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  assert.equal((await fetch(`${f.base}/${missing}/comments`)).status, 404);
  assert.equal((await fetch(`${f.base}/${f.id}/comments`, { method: 'PUT' })).status, 405);
  assert.equal((await fetch(`${f.base}/${f.id}/comments`, { headers: { origin: 'http://invalid.example' } })).status, 403);

  const badJson = await fetch(`${f.base}/${f.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(badJson.status, 400);
  for (const body of [
    makeBody(Number.NaN), makeBody(-1), makeBody(1, { anchor: { time_sec: Infinity, selector: '#x' } }),
    makeBody(1, { anchor: { time_sec: 1, selector: ' '.repeat(2) } }),
    makeBody(1, { anchor: { time_sec: 1, selector: 'x'.repeat(601) } }),
    makeBody(1, { anchor: { time_sec: 1, selector: '#x', frame_path: Array(7).fill('iframe') } }),
    makeBody(1, { anchor: { time_sec: 1, selector: '#x', frame_path: [4] } }),
    makeBody(1, { comment: '  ' }), makeBody(1, { comment: 'x'.repeat(4001) }),
  ]) {
    const response = await fetch(`${f.base}/${f.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
  const tooLarge = await fetch(`${f.base}/${f.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anchor: { time_sec: 0, selector: '#x' }, comment: 'x'.repeat(300_000) }) });
  assert.equal(tooLarge.status, 413);

  const created = await fetch(`${f.base}/${f.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(makeBody(1)) }).then((r) => r.json());
  const longAuthor = await fetch(`${f.base}/${f.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(makeBody(2, { author: 'a'.repeat(90) })) }).then((r) => r.json());
  assert.equal(longAuthor.author.length, 80);
  assert.equal((await fetch(`${f.base}/${f.id}/comments/no-such-comment`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await fetch(`${f.base}/${f.id}/comments/no-such-comment`, { method: 'DELETE' })).status, 404);
  assert.equal((await fetch(`${f.base}/${f.id}/comments/${created.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolved: 'yes' }) })).status, 400);

  const store = path.join(f.records, f.id, 'comments.json');
  await writeFile(store, '{corrupt');
  const corruptRead = await fetch(`${f.base}/${f.id}/comments`); assert.equal(corruptRead.status, 500);
  const corruptWrite = await fetch(`${f.base}/${f.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(makeBody(3)) }); assert.equal(corruptWrite.status, 500);
  assert.equal(await readFile(store, 'utf8'), '{corrupt', 'malformed store is preserved for recovery');
});
