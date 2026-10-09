#!/usr/bin/env node
// Bounded HTTP capacity probe for an isolated Resonance runtime directory.
// The runner deliberately does not start a browser and never enables recording unless --recording is explicit.
import { createServer } from 'node:http';
import { mkdir, lstat, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { createResonanceHttp } from '../../server/modes/resonance/http.js';
import { validateSession } from '../../server/modes/resonance/session.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEADLINE_MS = 8 * 60 * 1000;
const POOL_COPIES = Object.freeze({ 1: 30, 2: 25, 3: 18, 4: 10, 5: 9 });
const STAR_COPIES = Object.freeze({ 1: 1, 2: 3, 3: 9 });
const HELP = `Usage: node tools/resonance/capacity.mjs --data-dir ABS --session-dir ABS --receipt ABS --source-revision GIT_REF [options]

Required:
  --data-dir ABS          Canonical read-only game data directory
  --session-dir ABS       Isolated capacity-tests runtime directory (must include a capacity-tests path segment)
  --receipt ABS           The single JSON receipt to atomically overwrite
  --source-revision REF   Native Git revision/ref used for this run
Options:
  --environment-id ID    Resonance environment (default origin_laterano)
  --concurrency 2|4      Number of simultaneous fixed terminal sessions (default 2)
  --release-receipt ABS  Native server-release.json for source archives without .git
  --recording            Enable true Battle replay recording; default is false
  --help                 Show this usage without touching files
`;

export function parseArgs(argv) {
  const options = { concurrency: 2, environmentid: 'origin_laterano', recording: false, help: false };
  const takesValue = new Set(['--data-dir', '--session-dir', '--receipt', '--source-revision', '--release-receipt', '--environment-id', '--concurrency']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--recording') { options.recording = true; continue; }
    if (!takesValue.has(arg)) throw new Error(`unknown option: ${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    options[arg.slice(2).replaceAll('-', '')] = value;
  }
  if (options.help) return options;
  for (const key of ['datadir', 'sessiondir', 'receipt']) {
    const flag = ({ datadir: '--data-dir', sessiondir: '--session-dir', receipt: '--receipt' })[key];
    if (typeof options[key] !== 'string' || !path.isAbsolute(options[key])) throw new Error(`${flag} must be an absolute path`);
  }
  if (typeof options.sourcerevision !== 'string' || !options.sourcerevision.trim()) throw new Error('--source-revision is required');
  if (options.releasereceipt !== undefined && !path.isAbsolute(options.releasereceipt)) throw new Error('--release-receipt must be an absolute path');
  options.concurrency = Number(options.concurrency);
  if (![2, 4].includes(options.concurrency)) throw new Error('--concurrency must be 2 or 4');
  if (!/^origin_[a-z0-9_]+$/.test(options.environmentid)) throw new Error('--environment-id must be a canonical origin_* id');
  return options;
}

function maxMemory(current, next) {
  return {
    rssBytes: Math.max(current.rssBytes || 0, next.rssBytes || 0),
    heapUsedBytes: Math.max(current.heapUsedBytes || 0, next.heapUsedBytes || 0),
    heapTotalBytes: Math.max(current.heapTotalBytes || 0, next.heapTotalBytes || 0),
    resourceMaxRssBytes: Math.max(current.resourceMaxRssBytes || 0, next.resourceMaxRssBytes || 0),
  };
}
function memorySample() {
  const usage = process.memoryUsage();
  const resource = process.resourceUsage?.();
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    // Node reports maxRSS in KiB on Linux and bytes on macOS; this candidate runner targets Linux.
    resourceMaxRssBytes: resource?.maxRSS ? resource.maxRSS * 1024 : usage.rss,
  };
}

async function runHttpWorker() {
  const { dataDir, sessionDir, recording } = workerData;
  const data = loadData(dataDir, { log: { warn() {}, error() {}, info() {} } });
  const handleResonance = createResonanceHttp({ data, directory: sessionDir, recording });
  const server = createServer((req, res) => {
    res.once('finish', () => parentPort.postMessage({ type: 'memory', sample: memorySample() }));
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    Promise.resolve(handleResonance(req, res, pathname)).then((handled) => {
      if (!handled && !res.writableEnded) { res.writeHead(404); res.end(); }
    }).catch((error) => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      if (!res.writableEnded) res.end(JSON.stringify({ ok: false, error: { code: 'CAPACITY_HTTP_ERROR', message: error.message } }));
    });
  });
  const sampler = setInterval(() => parentPort.postMessage({ type: 'memory', sample: memorySample() }), 250);
  sampler.unref();
  parentPort.on('message', async (message) => {
    if (message?.type !== 'shutdown') return;
    clearInterval(sampler);
    server.close(() => parentPort.postMessage({ type: 'closed' }));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  parentPort.postMessage({ type: 'listening', url: `http://127.0.0.1:${server.address().port}` });
}

async function noSymlinkPath(target) {
  const parsed = path.parse(target);
  let current = parsed.root;
  for (const part of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`symlink path is not allowed: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function hasPathSegment(target, segment) { return path.resolve(target).split(path.sep).includes(segment); }
function isWithin(parent, child) { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
async function ensureEmptySessionDir(directory) {
  await noSymlinkPath(directory);
  await mkdir(directory, { recursive: true });
  await noSymlinkPath(directory);
  const entries = await readdir(directory);
  if (entries.length) throw new Error(`session directory must be empty before a run: ${directory}`);
}

export function validateReleaseReceipt(sourceRevision, receipt) {
  const nativeRevision = receipt?.sourceRevision;
  if (typeof nativeRevision !== 'string' || !/^[0-9a-f]{40}$/i.test(nativeRevision)) {
    throw new Error('release receipt must contain a full native Git sourceRevision');
  }
  if (sourceRevision !== nativeRevision) throw new Error(`release receipt sourceRevision does not match requested revision: ${nativeRevision}`);
  return nativeRevision;
}

export async function resolveSourceRevision(value, releaseReceiptPath) {
  let gitUnavailable = false;
  try {
    const revision = execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', `${value}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!revision) throw new Error(`could not resolve native Git source revision: ${value}`);
    if (releaseReceiptPath) {
      const receipt = JSON.parse(await readFile(releaseReceiptPath, 'utf8'));
      validateReleaseReceipt(revision, receipt);
    }
    return { revision, provenance: 'git-rev-parse' };
  } catch (error) {
    const stderr = String(error.stderr || '');
    gitUnavailable = error.code === 'ENOENT' || /not a git repository|must be run in a work tree|not a git work tree/i.test(stderr);
    if (!gitUnavailable) throw error;
  }
  if (!releaseReceiptPath) throw new Error('Git metadata is unavailable; provide --release-receipt from the native server builder');
  const receipt = JSON.parse(await readFile(releaseReceiptPath, 'utf8'));
  return { revision: validateReleaseReceipt(value, receipt), provenance: 'server-release-receipt', releaseReceiptPath: path.resolve(releaseReceiptPath) };
}

function assertPoolConservation(state, catalog) {
  const errors = validateSession(state, { catalog });
  if (!errors.ok) throw new Error(`fixed stress fixture failed validateSession: ${JSON.stringify(errors.errors)}`);
  for (const id of catalog.config.activeOperatorIds) {
    const cap = POOL_COPIES[catalog.operators[id].cost];
    const remaining = state.poolRemaining[id];
    const offers = state.shop.offers.filter((offer) => offer.operatorId === id).length;
    const held = state.pieces.filter((piece) => piece.operatorId === id).reduce((n, piece) => n + STAR_COPIES[piece.star], 0);
    if (remaining + offers + held !== cap) throw new Error(`fixed stress fixture pool conservation failed for ${id}`);
  }
  return true;
}

function prepareTerminalFixture({ data, catalog, envId, seed, state }) {
  if (!scenarioHelpers) throw new Error('terminal scenario helpers are only available in the main thread');
  const { SCENARIO_CONFIGS, buildScenario, makePactTerminalRoster } = scenarioHelpers;
  const composition = makePactTerminalRoster(catalog, 10, 3, { coreMode: 'preferred' });
  if (!composition.constructible) throw new Error(`terminal fixture cannot construct main pact ${composition.mainPact} in ${envId}`);
  const config = { ...SCENARIO_CONFIGS.at(-1), transferLimit: composition.transferLimit };
  const definition = { id: `capacity-${envId}`, env: envId, core: composition.core.name, include: [], pact: composition.mainPact };
  const roster = structuredClone(composition.roster);
  const built = buildScenario({ data, catalog, definition, config, coreStar: 3, seed, rosterOverride: roster });
  const fixture = built.state;
  fixture.roundLimit = state.roundLimit;
  fixture.difficulty = state.difficulty;
  fixture.round = 28;
  fixture.level = 10;
  fixture.xp = 0;
  fixture.phase = 'prep';
  fixture.nodeStarted = true;
  fixture.hp = 100;
  fixture.gold = 2; // lets every fixture perform a real paid refresh before fighting
  fixture.winStreak = 0; fixture.lossStreak = 0; fixture.terminalReason = undefined;
  fixture.pendingChoices = []; fixture.strategies = []; fixture.strategyState = {}; fixture.consumables = [];
  fixture.inventory = [];
  fixture.shop.locked = false;
  fixture.shop.offers = fixture.shop.offers.map((offer) => ({ ...offer, operatorId: null, cost: null }));
  for (const piece of fixture.pieces) for (const item of piece.equipment) item.uid ||= `i${fixture.nextUid++}`;
  for (const id of catalog.config.activeOperatorIds) {
    const cap = POOL_COPIES[catalog.operators[id].cost];
    const held = fixture.pieces.filter((piece) => piece.operatorId === id).reduce((n, piece) => n + STAR_COPIES[piece.star], 0);
    if (held > cap) throw new Error(`fixture roster exceeds native pool for ${id}`);
    fixture.poolRemaining[id] = cap - held;
  }
  fixture.revision = 0;
  assertPoolConservation(fixture, catalog);
  return {
    state: fixture,
    composition: {
      mainPact: composition.mainPact,
      core: composition.core,
      targetPactTier: composition.threshold,
      fixedStressFixture: true,
      accessibility: 'fixed stress fixture; not an economy-achievability claim',
      party: fixture.pieces.map((piece) => ({ operatorId: piece.operatorId, star: piece.star,
        position: [piece.row, piece.col], dir: piece.dir, equipment: piece.equipment.map((item) => item.itemId) })),
    },
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

async function atomicJson(file, value) {
  await noSymlinkPath(path.dirname(file));
  await mkdir(path.dirname(file), { recursive: true });
  await noSymlinkPath(file);
  const pending = `${file}.pending-${process.pid}`;
  try {
    await writeFile(pending, `${JSON.stringify(value, null, 2)}\n`, { flag: 'w' });
    await rename(pending, file);
  } catch (error) { await rm(pending, { force: true }).catch(() => {}); throw error; }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return 0; }
  const dataDir = options.datadir;
  const sessionDir = options.sessiondir;
  const receiptPath = options.receipt;
  const repositoryRoot = path.resolve(ROOT);
  const dataReal = await (await import('node:fs/promises')).realpath(dataDir);
  if (isWithin(repositoryRoot, path.resolve(sessionDir)) || isWithin(path.resolve(sessionDir), dataReal) || isWithin(dataReal, path.resolve(sessionDir)))
    throw new Error('session directory must be independent of the source checkout and canonical data directory');
  if (!hasPathSegment(sessionDir, 'capacity-tests')) throw new Error('session directory must be under the designated capacity-tests runtime area');
  if (isWithin(repositoryRoot, path.resolve(receiptPath)) || isWithin(dataReal, path.resolve(receiptPath)))
    throw new Error('receipt must be outside source and canonical data trees');
  await ensureEmptySessionDir(sessionDir);
  process.env.SP_DATA_DIR = dataDir;
  scenarioHelpers = await import('./archetype-balance.mjs');
  const sourceProvenance = await resolveSourceRevision(options.sourcerevision, options.releasereceipt);
  const sourceRevision = sourceProvenance.revision;
  const data = loadData(dataDir, { log: { warn() {}, error() {}, info() {} } });
  const startedAt = new Date().toISOString();
  const deadlineAt = Date.now() + DEADLINE_MS;
  const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { mode: 'http-worker', dataDir, sessionDir, recording: options.recording } });
  const responseLatencies = [];
  let memoryPeak = {};
  let runnerHeapPeak = 0;
  let workerHeapPeak = 0;
  let serverUrl = null;
  let sessionRows = [];
  const sessions = [];
  let workerTermination = null;
  let terminalStatus = 'running';
  let failure = null;
  const waiting = new Map();
  const queue = [];
  worker.on('message', (message) => {
    if (message.type === 'memory') {
      memoryPeak = maxMemory(memoryPeak, message.sample || {});
      workerHeapPeak = Math.max(workerHeapPeak, message.sample?.heapUsedBytes || 0);
    }
    const waiter = waiting.get(message.type);
    if (waiter) { waiting.delete(message.type); waiter.resolve(message); }
    else queue.push(message);
  });
  worker.on('error', (error) => { failure ||= error; });
  function message(type, timeoutMs = 15_000) {
    const index = queue.findIndex((entry) => entry.type === type);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(type); reject(new Error(`timeout waiting for server worker ${type}`)); }, timeoutMs);
      waiting.set(type, { resolve: (value) => { clearTimeout(timer); resolve(value); } });
    });
  }
  const timer = setTimeout(() => {
    terminalStatus = 'timeout'; failure = new Error(`hard deadline exceeded (${DEADLINE_MS}ms)`);
    workerTermination = worker.terminate();
    for (const [type, waiter] of waiting) { waiting.delete(type); waiter.resolve({ type, timeout: true }); }
  }, DEADLINE_MS);
  timer.unref();
  const runnerSampler = setInterval(() => {
    const sample = memorySample();
    memoryPeak = maxMemory(memoryPeak, sample);
    runnerHeapPeak = Math.max(runnerHeapPeak, sample.heapUsedBytes || 0);
  }, 100);
  const request = async (pathName, { method = 'GET', body = undefined } = {}) => {
    if (Date.now() >= deadlineAt || terminalStatus === 'timeout') throw new Error('capacity probe deadline reached');
    const started = performance.now();
    const response = await fetch(`${serverUrl}${pathName}`, {
      method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json();
    const latencyMs = performance.now() - started;
    responseLatencies.push(latencyMs);
    if (!response.ok || !json.ok) throw new Error(`${method} ${pathName} failed (${response.status}): ${JSON.stringify(json.error || json)}`);
    return { json, latencyMs, status: response.status };
  };
  const receiptBase = {
    schema: 'resonance-capacity-receipt/v1', sourceRevision, sourceProvenance, providedSourceRevision: options.sourcerevision,
    dataDir: path.resolve(dataDir), sessionDir: path.resolve(sessionDir), receiptPath: path.resolve(receiptPath),
    startedAt, host: '127.0.0.1', ephemeralPort: true, concurrency: options.concurrency,
    recording: options.recording, fixtureType: 'fixed stress fixture', accessibility: 'not an economy-achievability claim',
    deadlineMs: DEADLINE_MS, status: terminalStatus,
  };
  try {
    worker.postMessage({ type: 'start' });
    const listening = await message('listening');
    serverUrl = listening.url;
    for (let index = 0; index < options.concurrency; index++) {
      const seed = 0x5a000 + index;
      const created = await request('/resonance/api/sessions', { method: 'POST', body: { seed, difficulty: 'NORMAL', environmentId: options.environmentid } });
      const id = created.json.id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || '')) throw new Error('official session API returned an invalid session ID');
      const catalog = getResonanceCatalog(data, { environmentId: options.environmentid, seed });
      if (catalog.config.activeOperatorIds.length !== 65) throw new Error(`expected 65 active operators, got ${catalog.config.activeOperatorIds.length}`);
      const { state, composition } = prepareTerminalFixture({ data, catalog, envId: options.environmentid, seed, state: created.json.state });
      const fixturePath = path.join(sessionDir, `${id}.json`);
      await writeFile(fixturePath, `${JSON.stringify(state)}\n`, { flag: 'w' });
      const session = { id, seed, catalogSeed: seed, fixturePath, composition, createdViaHttp: true };
      sessions.push(session);
      sessionRows.push({ id, seed, catalogSeed: seed, fixturePath, composition, createdViaHttp: true, status: 'fixture-created' });
    }
    // Load through the same authoritative HTTP path before applying any action.
    for (const session of sessions) {
      const loaded = await request(`/resonance/api/sessions/${session.id}?catalog=0`);
      session.initialRevision = loaded.json.state.revision;
      session.validatedPool = true;
      Object.assign(sessionRows.find((row) => row.id === session.id), { initialRevision: session.initialRevision, validatedPool: true, status: 'http-loaded' });
    }
    for (const session of sessions) {
      const refreshed = await request(`/resonance/api/sessions/${session.id}/actions`, {
        method: 'POST', body: { expectedRevision: session.initialRevision, action: { type: 'refresh' } },
      });
      session.refresh = { revisionBefore: session.initialRevision, revisionAfter: refreshed.json.state.revision, latencyMs: refreshed.latencyMs, status: refreshed.status };
      session.fightRevision = refreshed.json.state.revision;
      Object.assign(sessionRows.find((row) => row.id === session.id), { refresh: session.refresh, fightRevision: session.fightRevision, status: 'refreshed' });
    }
    const battleResults = await Promise.all(sessions.map(async (session) => {
      const response = await request(`/resonance/api/sessions/${session.id}/actions`, {
        method: 'POST', body: { expectedRevision: session.fightRevision, action: { type: 'fight' } },
      });
      const event = response.json.events?.find((entry) => entry.type === 'fight-settled');
      if (!event) throw new Error(`session ${session.id} Battle response omitted fight-settled event`);
      const diagCount = Number(event.diagnostics?.errorCount || 0);
      if (diagCount !== 0) throw new Error(`session ${session.id} Battle reported ${diagCount} engine diagnostics`);
      const row = {
        id: session.id, seed: session.seed, fixturePath: session.fixturePath, composition: session.composition,
        refresh: session.refresh, fight: { status: response.status, latencyMs: response.latencyMs,
          expectedRevision: session.fightRevision, revisionAfter: response.json.state.revision,
          won: event.won, hpLoss: event.hpLoss, durationSeconds: event.result?.time ?? null,
          bossHpLeft: event.result?.bossHpLeft ?? null, diagnostics: event.diagnostics, terminalReason: response.json.state.terminalReason ?? null },
      };
      if (options.recording) {
        const replay = await request(`/resonance/api/sessions/${session.id}/replays/28`);
        const compressedPath = path.join(sessionDir, `${session.id}.replay-r28.json.gz`);
        const replayStat = await stat(compressedPath);
        if (!replay.json.replay || !Array.isArray(replay.json.replay.frames) || !replay.json.replay.frames.length) throw new Error(`session ${session.id} replay response is empty`);
        row.replay = { absolutePath: compressedPath, gzipBytes: replayStat.size, verifiedViaHttp: true,
          frames: replay.json.replay.frames.length, fetchLatencyMs: replay.latencyMs };
      } else row.replay = { enabled: false, gzipBytes: 0, verifiedViaHttp: false };
      const completedSession = sessionRows.find((entry) => entry.id === session.id);
      Object.assign(completedSession, row, { status: 'battle-complete' });
      return completedSession;
    }));
    sessionRows = battleResults;
    terminalStatus = 'completed';
  } catch (error) {
    if (terminalStatus !== 'timeout') terminalStatus = 'failed';
    failure = error;
  } finally {
    clearTimeout(timer);
    clearInterval(runnerSampler);
    if (workerTermination) await workerTermination.catch(() => {});
    else if (worker.threadId !== -1) {
      worker.postMessage({ type: 'shutdown' });
      await Promise.race([message('closed', 4_000).catch(() => null), new Promise((resolve) => setTimeout(resolve, 4_000))]);
      if (worker.threadId !== -1) await worker.terminate();
    }
  }
  const finishedAt = new Date().toISOString();
  const receipt = {
    ...receiptBase, status: terminalStatus, finishedAt,
    server: serverUrl ? { url: serverUrl, bind: '127.0.0.1', port: Number(new URL(serverUrl).port) } : null,
    memoryPeakObserved: { ...memoryPeak, runnerHeapUsedPeakBytes: runnerHeapPeak, serverWorkerHeapUsedPeakBytes: workerHeapPeak,
      heapUsedPeakUpperBoundBytes: runnerHeapPeak + workerHeapPeak },
    latencyMs: { requests: responseLatencies.length, p50: percentile(responseLatencies, 0.5), p95: percentile(responseLatencies, 0.95), max: responseLatencies.length ? Math.max(...responseLatencies) : null },
    sessions: sessionRows,
    outputPaths: { receipt: path.resolve(receiptPath), sessionDirectory: path.resolve(sessionDir), sessionFiles: sessionRows.map((row) => row.fixturePath), replays: sessionRows.map((row) => row.replay?.absolutePath).filter(Boolean) },
    error: failure ? { message: failure.message || String(failure), stack: failure.stack || null } : null,
    directoryRole: 'isolated runtime/capacity-test batch; never canonical production session data',
  };
  await atomicJson(receiptPath, receipt);
  process.stdout.write(`${JSON.stringify({ terminalStatus, receiptPath: path.resolve(receiptPath), sessionDir: path.resolve(sessionDir), sessions: sessionRows.length, recording: options.recording, error: receipt.error?.message ?? null }, null, 2)}\n`);
  return terminalStatus === 'completed' ? 0 : 1;
}

if (!isMainThread && workerData?.mode === 'http-worker') {
  await runHttpWorker();
} else if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  });
}
