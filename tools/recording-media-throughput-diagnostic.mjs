#!/usr/bin/env node
// Isolated API/FS throughput probe. Payload bytes are synthetic and are never finalized or treated as playable media.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { startServer } from '../server/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const runtime = path.join(canonical, 'runtime/growth-destination-20261008/recording');
const tmp = path.join(canonical, '.omni/tmp/growth-destination-20261008/recording');
const output = path.resolve(process.env.SP_RECORD_MEDIA_PROBE_OUTPUT || path.join(tmp, `media-throughput-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`));
const probeCount = 20;
const payloadBytes = 10 * 1024;
const runStartedAt = new Date().toISOString();
let server;
const report = { startedAt: runStartedAt, output, probeCount, payloadBytes, payloadKind: 'synthetic diagnostic bytes; not playable media; never finalized', requests: [] };

try {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'probe-process-start.json'), JSON.stringify({ pid: process.pid, argv: process.argv, cwd: process.cwd(), startedAt: runStartedAt, output }, null, 2));
  server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, publicDir: path.join(repo, 'public'), dataDir: path.join(repo, 'data'), sharedDir: path.join(repo, 'shared'),
    independentDirectory: path.join(runtime, 'sessions'), recordingDirectory: path.join(runtime, 'recordings'), recordingDiagnosticsPath: path.join(output, 'server-media-http.jsonl') });
  const origin = `http://127.0.0.1:${server.port}`;
  const created = await fetch(`${origin}/independent/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seed: Math.floor(Math.random() * 2 ** 31), difficulty: 'NORMAL', roundLimit: 14, growthMode: 'levels' }) });
  const createdPacket = await created.json();
  if (!created.ok || !createdPacket.ok) throw new Error(`probe session creation failed: ${created.status} ${JSON.stringify(createdPacket)}`);
  report.sessionId = createdPacket.id;
  report.recordingIds = Array.from({ length: probeCount + 1 }, () => randomUUID());
  const starts = await Promise.all(report.recordingIds.map(async (recordingId) => {
    const startedAt = performance.now();
    const response = await fetch(`${origin}/independent/api/recordings/start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: report.sessionId, recordingId, viewport: { width: 1600, height: 900 } }) });
    const packet = await response.json();
    return { recordingId, status: response.status, elapsedMs: performance.now() - startedAt, ok: packet.ok, nextMediaSeq: packet.nextMediaSeq };
  }));
  report.startRequests = starts;
  if (starts.some((item) => !item.ok)) throw new Error(`probe recording start failed: ${JSON.stringify(starts.filter((item) => !item.ok))}`);
  const body = Buffer.alloc(payloadBytes, 0x47);
  const concurrentStarted = performance.now();
  report.concurrentRequests = await Promise.all(report.recordingIds.slice(0, probeCount).map(async (recordingId, index) => {
    const mediaStartedAt = Date.now(); const requestStartedAt = new Date().toISOString(); const started = performance.now();
    try {
      const response = await fetch(`${origin}/independent/api/recordings/${recordingId}/media/1`, { method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-media-mime-type': 'video/webm;codecs=vp8',
          'x-media-started-at': String(mediaStartedAt), 'x-media-time-ms': '5000' }, body });
      const packet = await response.json();
      return { index, recordingId, requestStartedAt, completedAt: new Date().toISOString(), status: response.status, elapsedMs: performance.now() - started, requestBytes: body.length,
        ack: packet.ack ?? null, error: packet.error?.code || packet.error || null };
    } catch (error) {
      return { index, recordingId, requestStartedAt, completedAt: new Date().toISOString(), status: 0, elapsedMs: performance.now() - started, requestBytes: body.length,
        transportError: { code: error.code || '', message: error.message } };
    }
  }));
  report.concurrentElapsedMs = performance.now() - concurrentStarted;
  const serialRecordingId = report.recordingIds.at(-1);
  const serialStarted = performance.now(); report.serialRequests = [];
  for (let index = 0; index < probeCount; index += 1) {
    const mediaStartedAt = Date.now(); const requestStartedAt = new Date().toISOString(); const started = performance.now();
    try {
      const response = await fetch(`${origin}/independent/api/recordings/${serialRecordingId}/media/${index + 1}`, { method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-media-mime-type': 'video/webm;codecs=vp8',
          'x-media-started-at': String(mediaStartedAt), 'x-media-time-ms': String((index + 1) * 1000) }, body });
      const packet = await response.json();
      report.serialRequests.push({ index, seq: index + 1, recordingId: serialRecordingId, requestStartedAt, completedAt: new Date().toISOString(),
        status: response.status, elapsedMs: performance.now() - started, requestBytes: body.length, ack: packet.ack ?? null, error: packet.error?.code || packet.error || null });
    } catch (error) {
      report.serialRequests.push({ index, seq: index + 1, recordingId: serialRecordingId, requestStartedAt, completedAt: new Date().toISOString(),
        status: 0, elapsedMs: performance.now() - started, requestBytes: body.length, transportError: { code: error.code || '', message: error.message } });
    }
  }
  report.serialElapsedMs = performance.now() - serialStarted;
  report.finishedAt = new Date().toISOString();
  const concurrentSorted = report.concurrentRequests.map((item) => item.elapsedMs).sort((a, b) => a - b);
  const serverRows = (await fs.readFile(path.join(output, 'server-media-http.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  report.serverRequestTimings = serverRows;
  report.summary = { concurrent: { successCount: report.concurrentRequests.filter((item) => item.status === 200 && item.ack === 1).length,
      failureCount: report.concurrentRequests.filter((item) => item.status !== 200 || item.ack !== 1).length,
      minMs: concurrentSorted[0], medianMs: concurrentSorted[Math.floor(concurrentSorted.length / 2)],
      p95Ms: concurrentSorted[Math.min(concurrentSorted.length - 1, Math.ceil(concurrentSorted.length * 0.95) - 1)], maxMs: concurrentSorted.at(-1),
      wallMs: report.concurrentElapsedMs, throughputBytesPerSecond: Math.round(probeCount * payloadBytes / (report.concurrentElapsedMs / 1000)) },
    serialSameRecording: { successCount: report.serialRequests.filter((item) => item.status === 200 && item.ack === item.seq).length,
      failureCount: report.serialRequests.filter((item) => item.status !== 200 || item.ack !== item.seq).length,
      wallMs: report.serialElapsedMs, medianMs: [...report.serialRequests].sort((a,b)=>a.elapsedMs-b.elapsedMs)[Math.floor(probeCount/2)]?.elapsedMs,
      throughputBytesPerSecond: Math.round(probeCount * payloadBytes / (report.serialElapsedMs / 1000)) } };
  await fs.writeFile(path.join(output, 'media-throughput.jsonl'), `${report.concurrentRequests.concat(report.serialRequests).map((item) => JSON.stringify(item)).join('\n')}\n`);
  await fs.writeFile(path.join(output, 'media-throughput.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ json: path.join(output, 'media-throughput.json'), jsonl: path.join(output, 'media-throughput.jsonl'), serverJsonl: path.join(output, 'server-media-http.jsonl'), sessionId: report.sessionId, recordingIds: report.recordingIds, summary: report.summary }, null, 2));
  if (report.summary.concurrent.failureCount || report.summary.serialSameRecording.failureCount) process.exitCode = 1;
} catch (error) {
  report.finishedAt = new Date().toISOString(); report.failure = error?.stack || String(error);
  await fs.writeFile(path.join(output, 'media-throughput-failure.json'), JSON.stringify(report, null, 2)).catch(() => {});
  console.error(JSON.stringify({ failure: error.message || String(error), json: path.join(output, 'media-throughput-failure.json') }, null, 2));
  process.exitCode = 1;
} finally {
  if (server) { server.closeAllConnections?.(); await server.close().catch(() => {}); }
  await fs.writeFile(path.join(output, 'probe-process-receipt.json'), JSON.stringify({ pid: process.pid, argv: process.argv, cwd: process.cwd(), startedAt: runStartedAt,
    finishedAt: new Date().toISOString(), exitCode: process.exitCode || 0, sessionId: report.sessionId || null, recordingIds: report.recordingIds || [], output }, null, 2)).catch(() => {});
}
