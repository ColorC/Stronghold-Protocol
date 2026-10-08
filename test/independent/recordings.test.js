import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
  const canvasFrame = 'x'.repeat(2.5 * 1024 * 1024);
  const largeFrame = await post(`${base}/${created.id}/events`, { events: [{ seq: 3, ts: 2200, kind: 'rrweb', p: { type: 3, timestamp: 2200, canvasFrame } }] });
  assert.deepEqual(await largeFrame.json(), { ok: true, ack: 3 });
  const resumedGap = await post(`${base}/${created.id}/events`, { events: [{ seq: 4, ts: 2300, kind: 'rrweb', p: { timestamp: 2300 } }] });
  assert.deepEqual(await resumedGap.json(), { ok: true, ack: 4 });
  const read = await fetch(`${base}/${created.id}`); const packet = await read.json();
  assert.equal(packet.meta.sessionId, sessionId); assert.equal(packet.events.length, 4);
  assert.equal(packet.events[0].kind, 'rrweb'); assert.equal(packet.events[1].p.rect.x, 20);
  assert.equal(packet.events[2].p.canvasFrame.length, canvasFrame.length);
  const metaOnly = await fetch(`${base}/${created.id}?meta=1`).then((response) => response.json());
  assert.equal(metaOnly.ok, true); assert.equal(metaOnly.meta.sessionId, sessionId); assert.equal('events' in metaOnly, false);
  const jsonl = await readFile(path.join(records, created.id, 'events.jsonl'), 'utf8');
  assert.equal(jsonl.trim().split('\n').length, 4);
  const mediaHeaders = { 'content-type': 'application/octet-stream', 'x-media-started-at': '1700000000000', 'x-media-time-ms': '1000' };
  const chunk1 = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
  const media1 = await fetch(`${base}/${created.id}/media/1`, { method: 'POST', headers: mediaHeaders, body: chunk1 });
  assert.deepEqual(await media1.json(), { ok: true, ack: 1 });
  const duplicateMedia = await fetch(`${base}/${created.id}/media/1`, { method: 'POST', headers: mediaHeaders, body: chunk1 });
  assert.deepEqual(await duplicateMedia.json(), { ok: true, ack: 1 });
  const media2 = await fetch(`${base}/${created.id}/media/2`, { method: 'POST', headers: { ...mediaHeaders, 'x-media-time-ms': '2000' }, body: Buffer.from([8, 9]) });
  assert.deepEqual(await media2.json(), { ok: true, ack: 2 });
  const source9 = await post(`${base}/${created.id}/events`, { events: [{ seq: 5, ts: 3000, kind: 'rrweb', p: { type: 3, data: { source: 9, commands: [] } } }] });
  assert.deepEqual(await source9.json(), { ok: true, ack: 5 });
  const mediaRecordingEvents = await fetch(`${base}/${created.id}`).then((response) => response.json());
  assert.equal(mediaRecordingEvents.events.some((event) => event.seq === 5), false, 'media-backed replay omits redundant WebGL commands');
  assert.equal(mediaRecordingEvents.events.some((event) => event.seq === 2 && event.kind === 'caption'), true, 'captions survive WebGL filtering');
  assert.equal(mediaRecordingEvents.events.some((event) => event.seq === 1 && event.kind === 'rrweb'), true, 'DOM snapshots survive WebGL filtering');
  const mediaRead = await fetch(`${base}/${created.id}/media`);
  assert.equal(mediaRead.status, 200); assert.equal(mediaRead.headers.get('content-type'), 'video/webm');
  assert.equal(mediaRead.headers.get('x-media-duration-ms'), '2000');
  assert.deepEqual(Buffer.from(await mediaRead.arrayBuffer()), Buffer.concat([chunk1, Buffer.from([8, 9])]));
  const metadata = await fetch(`${base}/${created.id}`).then((r) => r.json());
  assert.equal(metadata.meta.mediaChunks, 2); assert.equal(metadata.meta.mediaStartedAt, new Date(1700000000000).toISOString());
  const resumedMedia=await post(`${base}/start`,{sessionId,recordingId:created.id}).then(r=>r.json());
  assert.equal(resumedMedia.nextMediaSeq,3,'refresh resumes acknowledged media sequence');
  const secondSegment=await fetch(`${base}/${created.id}/media/3`,{method:'POST',headers:{...mediaHeaders,'x-media-started-at':'1700000010000','x-media-time-ms':'1000'},body:chunk1});
  assert.deepEqual(await secondSegment.json(),{ok:true,ack:3});
  const afterRefresh=await fetch(`${base}/${created.id}`).then(r=>r.json());
  assert.equal(afterRefresh.meta.mediaSegments.length,2);
  assert.equal(afterRefresh.meta.mediaLastTimeMs,11000,'separate capture timestamps preserve the wall-clock gap');
  assert.deepEqual(await readFile(path.join(records,created.id,'canvas-2.webm')),chunk1,'a new WebM header starts its own playable segment');
  assert.deepEqual(await readFile(path.join(records,created.id,'canvas.webm')),Buffer.concat([chunk1,Buffer.from([8,9])]),'refresh cannot corrupt the first segment');
  const ended = await post(`${base}/${created.id}/stop`, { mediaCaptureStoppedAt: 1700000011000, mediaCaptureLastTimeMs: 1000,
    mediaCaptureLastPaintedAt: 1700000010900, mediaCaptureFinalSeq: 3 }); assert.equal(ended.status, 200);
  const recordDirectory = path.join(records, created.id);
  await writeFile(path.join(recordDirectory, 'canvas-playback.webm'), Buffer.from('seekable-webm'));
  const metaPath = path.join(recordDirectory, 'meta.json');
  const finalMeta = JSON.parse(await readFile(metaPath, 'utf8'));
  assert.equal(finalMeta.mediaCaptureStopValidation.accepted, true);
  assert.equal(finalMeta.mediaCaptureFinalSeq, finalMeta.nextMediaSeq - 1);
  assert.equal(finalMeta.mediaCaptureStoppedAt, new Date(1700000011000).toISOString()); finalMeta.mediaPlaybackReady = true;
  await writeFile(metaPath, JSON.stringify(finalMeta));
  const range = await fetch(`${base}/${created.id}/media/playback`, { headers: { range: 'bytes=2-5' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('accept-ranges'), 'bytes');
  assert.equal(range.headers.get('content-range'), 'bytes 2-5/13'); assert.equal(await range.text(), 'ekab');
  const mediaAfterStop = await fetch(`${base}/${created.id}/media/4`, { method: 'POST', headers: mediaHeaders, body: Buffer.from([1]) });
  assert.equal(mediaAfterStop.status, 409);
  const rejected = await post(`${base}/${created.id}/events`, { events: [{ seq: 5, ts: 3000, kind: 'caption', p: {} }] });
  assert.equal(rejected.status, 409);
  const resumed = await post(`${base}/start`, { sessionId, recordingId: created.id });
  assert.equal((await resumed.json()).endedAt !== null, true);
  const invalidCapture = await post(`${base}/start`, { sessionId }); const invalidPacket = await invalidCapture.json();
  assert.equal(invalidPacket.ok, true);
  const falseFinalSeq = await post(`${base}/${invalidPacket.id}/stop`, { mediaCaptureStoppedAt: Date.now(), mediaCaptureLastTimeMs: 0,
    mediaCaptureLastPaintedAt: Date.now() - 5, mediaCaptureFinalSeq: 1 });
  assert.equal(falseFinalSeq.status, 200);
  const invalidMeta = await fetch(`${base}/${invalidPacket.id}?meta=1`).then((r) => r.json());
  assert.equal(invalidMeta.meta.mediaCaptureStopValidation.accepted, false);
  assert.equal(invalidMeta.meta.mediaCaptureStopValidation.captureStopChecks.allChunksAcknowledged, false);
  assert.equal('mediaCaptureStoppedAt' in invalidMeta.meta, false);
});

test('recording GET checks the events file before headers and does not silently skip malformed JSONL', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sp-recording-read-errors-'));
  const sessions = path.join(root, 'sessions'); const records = path.join(root, 'recordings');
  const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; const sessionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const recordDirectory = path.join(records, id);
  await mkdir(sessions); await mkdir(recordDirectory, { recursive: true });
  await writeFile(path.join(recordDirectory, 'meta.json'), JSON.stringify({ id, sessionId, captions: [] }));
  const handle = createRecordingHttp({ directory: records, sessionDirectory: sessions });
  const server = http.createServer(async (req, res) => {
    if (!await handle(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}/independent/api/recordings/${id}`;
  const missing = await fetch(url);
  assert.equal(missing.status, 404); assert.deepEqual(await missing.json(), { ok: false, error: 'NOT_FOUND' });
  await writeFile(path.join(recordDirectory, 'events.jsonl'), '{"seq":1,"kind":"rrweb","ts":1}\n{not-json}\n');
  const malformed = await fetch(url);
  assert.equal(malformed.status, 200);
  await assert.rejects(() => malformed.text(), /terminated|aborted|reset|socket/i);
});

test('large recording read streams the complete JSON response under a 128 MiB heap and aborts cleanly', async (t) => {
  const tempParent = process.env.SP_RECORDING_TEST_TMP || os.tmpdir();
  await mkdir(tempParent, { recursive: true });
  const root = await mkdtemp(path.join(tempParent, 'sp-recording-stream-'));
  const sessions = path.join(root, 'sessions'); const records = path.join(root, 'recordings');
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const recordDirectory = path.join(records, id);
  await mkdir(sessions); await mkdir(recordDirectory, { recursive: true });
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

  const meta = { id, sessionId, startedAt: '2026-10-08T00:00:00.000Z', endedAt: '2026-10-08T00:10:00.000Z', viewport: { width: 1280, height: 720 }, nextSeq: 1, captions: [] };
  await writeFile(path.join(recordDirectory, 'meta.json'), JSON.stringify(meta));
  const eventsPath = path.join(recordDirectory, 'events.jsonl');
  const writer = createWriteStream(eventsPath, { encoding: 'utf8' });
  const payload = 'x'.repeat(1300);
  const targetBytes = 100 * 1024 * 1024;
  let fileBytes = 0; let eventBytes = 0; let eventCount = 0;
  while (fileBytes < targetBytes) {
    const line = JSON.stringify({ sid: id, seq: eventCount + 1, ts: eventCount + 1, surface: 'independent-game', src: 'browser', kind: 'rrweb', p: { type: 3, timestamp: eventCount + 1, data: { payload } } });
    const lineBytes = Buffer.byteLength(line);
    if (!writer.write(`${line}\n`)) await once(writer, 'drain');
    fileBytes += lineBytes + 1; eventBytes += lineBytes; eventCount += 1;
  }
  writer.end(); await once(writer, 'finish');
  const expectedResponseBytes = Buffer.byteLength(`{"ok":true,"meta":${JSON.stringify(meta)},"events":[`) + eventBytes + Math.max(0, eventCount - 1) + 2;

  const childScript = `
    import http from 'node:http';
    import { pathToFileURL } from 'node:url';
    const { createRecordingHttp } = await import(pathToFileURL(process.env.SP_RECORDING_MODULE).href);
    const metrics = { writes: 0, backpressure: 0 };
    let activeHandlers = 0;
    const handle = createRecordingHttp({ directory: process.env.SP_RECORDING_DIR, sessionDirectory: process.env.SP_SESSION_DIR });
    const server = http.createServer(async (req, res) => {
      activeHandlers++;
      const originalWrite = res.write;
      res.write = function (chunk, ...args) { metrics.writes++; const result = originalWrite.call(this, chunk, ...args); if (!result) metrics.backpressure++; return result; };
      try { await handle(req, res, new URL(req.url, 'http://localhost').pathname); }
      finally { activeHandlers--; }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/independent/api/recordings/' + process.env.SP_RECORDING_ID;
    const response = await fetch(url);
    if (response.status !== 200) throw new Error('GET status ' + response.status);
    let bytes = 0; let seqMarkers = 0; let carry = ''; let first = ''; let last = '';
    let maxHeapBytes = process.memoryUsage().heapUsed;
    for await (const raw of response.body) {
      const chunk = Buffer.from(raw); bytes += chunk.length;
      if (bytes % (1024 * 1024) < chunk.length) maxHeapBytes = Math.max(maxHeapBytes, process.memoryUsage().heapUsed);
      const text = chunk.toString('utf8');
      if (first.length < 160) first += text.slice(0, 160 - first.length);
      last = (last + text).slice(-160);
      const scan = carry + text; let offset = 0;
      while ((offset = scan.indexOf(',"seq":', offset)) !== -1) { seqMarkers++; offset += 7; }
      carry = scan.slice(-8);
    }
    const complete = bytes === Number(process.env.SP_EXPECTED_BYTES) && seqMarkers === Number(process.env.SP_EXPECTED_EVENTS) && first.startsWith('{"ok":true,"meta":') && last.endsWith(']}');
    const beforeAbort = { writes: metrics.writes, backpressure: metrics.backpressure };
    await new Promise((resolve, reject) => {
      let abortTimer;
      const request = http.get(url, response2 => {
        response2.pause();
        response2.once('data', () => { abortTimer = setTimeout(() => response2.destroy(), 100); });
        response2.once('error', () => {});
        response2.once('close', () => { clearTimeout(abortTimer); resolve(); });
      });
      request.once('error', error => { if (error.code === 'ECONNRESET') resolve(); else reject(error); });
      const failSafe = setTimeout(() => request.destroy(), 5000);
      request.once('close', () => clearTimeout(failSafe));
    });
    const drainUntil = Date.now() + 3000;
    while (activeHandlers && Date.now() < drainUntil) await new Promise(resolve => setTimeout(resolve, 10));
    const abort = { backpressureWrites: metrics.backpressure - beforeAbort.backpressure, writes: metrics.writes - beforeAbort.writes, activeHandlers };
    await new Promise(resolve => server.close(resolve));
    console.log(JSON.stringify({ complete, bytes, seqMarkers, maxHeapBytes, abort }));
    if (!complete || maxHeapBytes > 100 * 1024 * 1024 || abort.backpressureWrites < 1 || abort.writes >= Number(process.env.SP_EXPECTED_EVENTS) || abort.activeHandlers !== 0) process.exitCode = 2;
  `;
  const child = spawn(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', childScript], {
    cwd: process.cwd(),
    env: { ...process.env, SP_RECORDING_MODULE: path.resolve('server/modes/independent/recordings.js'), SP_RECORDING_DIR: records, SP_SESSION_DIR: sessions,
      SP_RECORDING_ID: id, SP_EXPECTED_BYTES: String(expectedResponseBytes), SP_EXPECTED_EVENTS: String(eventCount) },
    windowsHide: true,
  });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
  const childExit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('low-heap stream verifier exceeded 120 seconds')); }, 120_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
  });
  assert.equal(childExit.code, 0, `low-heap verifier failed (${childExit.signal}): ${stderr} ${stdout}`);
  const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  t.diagnostic(`128 MiB streaming verifier: ${JSON.stringify(result)}`);
  assert.equal(result.complete, true); assert.equal(result.seqMarkers, eventCount);
  assert.equal(result.bytes, expectedResponseBytes); assert.ok(result.maxHeapBytes < 100 * 1024 * 1024);
  assert.ok(result.abort.backpressureWrites > 0); assert.ok(result.abort.writes < eventCount); assert.equal(result.abort.activeHandlers, 0);
  assert.ok(fileBytes >= targetBytes, `synthetic JSONL is ${fileBytes} bytes, expected at least ${targetBytes}`);
});
