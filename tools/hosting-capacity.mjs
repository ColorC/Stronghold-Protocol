#!/usr/bin/env node
// An isolated HTTP capacity measurement, not a load test against the production host.
import assert from 'node:assert/strict';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.js';
import { createSession, applyAction } from '../server/modes/independent/session.js';

const args = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(args[args.indexOf('--output') + 1] || path.join(root, '.omni/tmp/hosting-capacity'));
await mkdir(output, { recursive: true });
const sessions = path.join(output, 'sessions');
const initial = createSession({ seed: 47, difficulty: 'FUNNY', roundLimit: 9 });
const changed = applyAction(initial, { type: 'buy', slot: initial.shop.slots.findIndex((x) => x.kind === 'chess') });
assert.equal(changed.ok, true);
const changes = Object.fromEntries(Object.keys(changed.state).filter((key) => JSON.stringify(initial[key]) !== JSON.stringify(changed.state[key])).map((key) => [key, changed.state[key]]));
const checkpoint = JSON.stringify({ expectedRevision: 0, changes });
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, independentMaxActive: 50,
  independentExecution: 'client', independentDirectory: sessions });
const receiptPath = path.join(output, 'capacity.json');
const receipt = { ok: false, measurement: '50 isolated HTTP clients on this development machine; not colorc.cc VM capacity',
  artifacts: [{ path: receiptPath, role: 'capacity, transfer, latency and stored-data receipt' }, { path: sessions, role: 'isolated test session files' }] };
try {
  const visitors = await Promise.all(Array.from({ length: 51 }, async () => {
    const response = await fetch(new URL('/independent.html', server.url));
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], bytes: (await response.arrayBuffer()).byteLength };
  }));
  assert.equal(visitors.filter((x) => x.status === 200).length, 50);
  assert.equal(visitors.filter((x) => x.status === 503).length, 1);
  const clients = await Promise.all(visitors.filter((x) => x.status === 200).map(async (visitor) => {
    const response = await fetch(new URL('/independent/api/sessions', server.url), { method: 'POST',
      headers: { cookie: visitor.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ rawState: initial }) });
    assert.equal(response.status, 201); return { ...visitor, ...(await response.json()) };
  }));
  const cpuBefore = process.cpuUsage(); const before = performance.now();
  const latencies = await Promise.all(clients.map(async (client) => {
    const started = performance.now();
    const response = await fetch(new URL(`/independent/api/sessions/${client.id}/checkpoint`, server.url), { method: 'POST',
      headers: { cookie: client.cookie, 'Content-Type': 'application/json' }, body: checkpoint });
    assert.equal(response.status, 200);
    const body = await response.text(); assert.equal(JSON.parse(body).revision, 1);
    return { ms: performance.now() - started, responseBytes: Buffer.byteLength(body) };
  }));
  const elapsedMs = performance.now() - before; const cpu = process.cpuUsage(cpuBefore);
  const files = await readdir(sessions); assert.equal(files.filter((x) => x.includes('replay')).length, 0);
  let storageBytes = 0; for (const file of files) storageBytes += (await stat(path.join(sessions, file))).size;
  const sorted = latencies.map((x) => x.ms).sort((a, b) => a - b);
  receipt.checks = { accepted: clients.length, refused: 1, serverReplayFiles: 0, checkpointRequestBytes: Buffer.byteLength(checkpoint),
    checkpointResponseBytes: latencies[0].responseBytes, checkpointBatchElapsedMs: elapsedMs,
    checkpointMedianMs: sorted[Math.floor(sorted.length / 2)], checkpointP95Ms: sorted[Math.floor(sorted.length * .95)],
    processCpuMsDuringBatch: (cpu.user + cpu.system) / 1000, storedSessions: files.length, storageBytes,
    fiftyBuyActionsEveryFiveSecondsKbitPerSecond: (Buffer.byteLength(checkpoint) * 50 + latencies.reduce((n, x) => n + x.responseBytes, 0)) * 8 / 5 / 1000 };
  receipt.ok = true;
} catch (error) { receipt.error = error.stack || error.message; }
finally {
  await server.close(); await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2)); process.exitCode = receipt.ok ? 0 : 1;
}
