#!/usr/bin/env node
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const ownDir = path.dirname(fileURLToPath(import.meta.url));
const ownRoot = path.resolve(ownDir, '..');
const args = parseArgs(process.argv.slice(2));
const releaseRoot = absoluteArg('release-root', args['release-root'] || ownRoot);
const dataDir = absoluteArg('data-dir', args['data-dir'] || process.env.SP_DATA_DIR || path.join(releaseRoot, 'data'));
const output = absoluteArg('output', args.output);
const concurrency = (args.concurrency || '50,100,200').split(',').map(Number);
const timeoutMs = Number(args['timeout-ms'] || 8000);
if (!concurrency.length || concurrency.some((value) => !Number.isInteger(value) || value < 1 || value > 200)) throw new Error('--concurrency must be comma-separated integers from 1 to 200');
if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 8000) throw new Error('--timeout-ms must be from 100 to 8000');
await assertNoSymlinkAncestors(output);
if (isWithin(output, dataDir) || isWithin(dataDir, output)) throw new Error('--output and --data-dir must be isolated paths');
await mkdir(output, { recursive: true });
const outputInfo = await stat(output);
if (!outputInfo.isDirectory()) throw new Error('--output must be a directory');
const occupied = await readdir(output);
if (occupied.length) throw new Error(`Refusing to overwrite non-empty output directory: ${output}`);

function parseArgs(values) {
  const out = {};
  for (let i = 0; i < values.length; i += 1) {
    const key = values[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const name = key.slice(2);
    const value = values[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    out[name] = value;
  }
  return out;
}
function absoluteArg(name, value) {
  if (!value || !path.isAbsolute(value)) throw new Error(`--${name} must be an absolute path`);
  return path.resolve(value);
}
function isWithin(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
async function assertNoSymlinkAncestors(target) {
  const parsed = path.parse(target);
  let current = parsed.root;
  for (const segment of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const item = await import('node:fs/promises').then((fs) => fs.lstat(current));
      if (item.isSymbolicLink()) throw new Error(`Refusing symlink output path: ${current}`);
      if (!item.isDirectory() && current !== target) throw new Error(`Output ancestor is not a directory: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
function jsonBytes(value) { return Buffer.byteLength(JSON.stringify(value)); }
function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}
async function directoryBytes(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}
function cookieFrom(response) {
  const header = response.headers.get('set-cookie');
  const match = /(?:^|,\s*)sp_ix_lease=([^;,]+)/.exec(header || '');
  if (!match) throw new Error('Admission response did not set sp_ix_lease');
  return `sp_ix_lease=${match[1]}`;
}
async function request(base, route, { method = 'GET', body, cookie, signal } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const response = await fetch(`${base}${route}`, {
    method, signal,
    headers: { ...(payload === null ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    ...(payload === null ? {} : { body: payload }),
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: response.status, requestBytes: payload === null ? 0 : Buffer.byteLength(payload), responseBytes: Buffer.byteLength(text), json: parsed, response };
}
async function runProfile(count, fixtures, base, stateDir) {
  const cpuStart = process.cpuUsage();
  const memoryStart = process.memoryUsage();
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const started = performance.now();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error(`profile exceeded ${timeoutMs}ms`)), timeoutMs);
  const routeTotals = { admission: emptyRoute(), create: emptyRoute(), checkpoint: emptyRoute() };
  const checkpointMs = [];
  const failures = [];
  let errors = 0;
  const work = Array.from({ length: count }, async (_, clientIndex) => {
    try {
      const admitted = await request(base, '/independent/api/admission', { method: 'POST', body: {}, signal: controller.signal });
      record(routeTotals.admission, admitted);
      if (admitted.status !== 200 || !admitted.json?.lease) throw new Error(`admission status ${admitted.status}`);
      const cookie = cookieFrom(admitted.response);
      for (const [kind, fixture] of [['early', fixtures.early], ['round9', fixtures.late]]) {
        const create = await request(base, '/independent/api/sessions', { method: 'POST', body: { rawState: fixture }, cookie, signal: controller.signal });
        record(routeTotals.create, create);
        if (create.status !== 201 || !create.json?.id) throw new Error(`${kind} create status ${create.status}`);
        const updated = { ...fixture, revision: 1 };
        const checkpointStarted = performance.now();
        const checkpoint = await request(base, `/independent/api/sessions/${create.json.id}/checkpoint`, {
          method: 'POST', body: { expectedRevision: 0, state: updated }, cookie, signal: controller.signal,
        });
        checkpointMs.push(performance.now() - checkpointStarted);
        record(routeTotals.checkpoint, checkpoint);
        if (checkpoint.status !== 200 || checkpoint.json?.revision !== 1) throw new Error(`${kind} checkpoint status ${checkpoint.status}`);
      }
    } catch (error) {
      errors += 1;
      const detail = `client ${clientIndex}: ${error.message}`;
      failures.push(detail);
      if (!controller.signal.aborted && errors <= 5) console.error(detail);
    }
  });
  await Promise.allSettled(work);
  clearTimeout(deadline);
  const elapsedMs = performance.now() - started;
  delay.disable();
  const cpu = process.cpuUsage(cpuStart);
  const memoryEnd = process.memoryUsage();
  const diskBytes = await directoryBytes(stateDir);
  const files = await readdir(stateDir);
  const replays = files.filter((name) => name.includes('replay'));
  if (replays.length) throw new Error(`Unexpected server replay files in ${stateDir}: ${replays.join(',')}`);
  return {
    concurrency: count, elapsedMs: Number(elapsedMs.toFixed(2)), clientsFailed: errors,
    requests: routeTotals, failures,
    checkpointLatencyMs: { p50: Number(percentile(checkpointMs, 0.5).toFixed(2)), p95: Number(percentile(checkpointMs, 0.95).toFixed(2)), max: Number(Math.max(0, ...checkpointMs).toFixed(2)) },
    process: { cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, rssStartBytes: memoryStart.rss, rssEndBytes: memoryEnd.rss,
      rssDeltaBytes: memoryEnd.rss - memoryStart.rss, eventLoopDelayMs: { mean: Number((delay.mean / 1e6 || 0).toFixed(2)), p95: Number((delay.percentile(95) / 1e6 || 0).toFixed(2)), max: Number((delay.max / 1e6 || 0).toFixed(2)) } },
    disk: { directory: stateDir, bytes: diskBytes, files: files.length, replayFiles: replays.length },
    fixtureBytes: { early: jsonBytes(fixtures.early), round9: jsonBytes(fixtures.late) },
  };
}
function record(target, value) {
  target.count += 1;
  target.requestBytes += value.requestBytes;
  target.responseBytes += value.responseBytes;
  target.statusCounts[value.status] = (target.statusCounts[value.status] || 0) + 1;
}
function emptyRoute() { return { count: 0, requestBytes: 0, responseBytes: 0, statusCounts: {} }; }

const dataModule = await import(pathToFileURL(path.join(releaseRoot, 'server', 'data.js')));
const data = dataModule.loadData(dataDir, { log: { warn() {}, error() {}, info() {} } });
const fixtureModule = await import(pathToFileURL(path.join(releaseRoot, 'tools', 'hosting-capacity-fixtures.mjs')));
const fixtures = fixtureModule.createCapacityFixtures(data);
const { startServer } = await import(pathToFileURL(path.join(releaseRoot, 'server', 'index.js')));
const results = [];
for (const count of concurrency) {
  const runOutput = path.join(output, `run-${count}`);
  await mkdir(runOutput, { recursive: false });
  const independentDirectory = path.join(runOutput, `sessions-${count}`);
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, dataDir, independentDirectory,
    independentMaxActive: count, independentMaxWaiting: 0, independentExecution: 'client' });
  try {
    const result = await runProfile(count, fixtures, server.url, independentDirectory);
    results.push(result);
    console.log(JSON.stringify({ concurrency: count, elapsedMs: result.elapsedMs, clientsFailed: result.clientsFailed,
      checkpointP95Ms: result.checkpointLatencyMs.p95, diskBytes: result.disk.bytes }));
  } finally { await server.close(); }
}
const report = { generatedAt: new Date().toISOString(), releaseRoot, dataDir, output, timeoutPerProfileMs: timeoutMs,
  limits: { maxConcurrency: 200, requestsPerClient: 5, serverActionRoutesCalled: 0, serverReplayFiles: 0 },
  fixture: { seed: fixtures.seed, actionsToRoundNine: fixtures.actionsToRoundNine }, results };
const reportPath = path.join(output, 'capacity-matrix.json');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
const logPath = path.join(output, 'capacity-matrix.log');
const log = [
  `Generated: ${report.generatedAt}`,
  `Release root: ${releaseRoot}`,
  `Data directory: ${dataDir}`,
  `Timeout per profile: ${timeoutMs} ms`,
  ...results.map((result) => `${result.concurrency}: elapsed=${result.elapsedMs}ms failures=${result.clientsFailed} checkpoint-p95=${result.checkpointLatencyMs.p95}ms disk=${result.disk.bytes}B replays=${result.disk.replayFiles}`),
  `JSON report: ${reportPath}`,
].join('\n') + '\n';
await writeFile(logPath, log, { flag: 'wx' });
console.log(`Report: ${reportPath}`);
console.log(`Log: ${logPath}`);
if (results.some((result) => result.clientsFailed !== 0
  || result.requests.admission.count !== result.concurrency
  || result.requests.create.count !== result.concurrency * 2
  || result.requests.checkpoint.count !== result.concurrency * 2
  || result.disk.replayFiles !== 0)) {
  process.exitCode = 1;
}
