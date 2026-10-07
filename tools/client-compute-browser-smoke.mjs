#!/usr/bin/env node
// Headless Chrome check for the explicit client-compute URL: worker actions, checkpoints, local replay, conflict and reload.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function options(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output') values.output = argv[++i];
    else if (argv[i] === '--install-dir') values.installDir = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return values;
}
const opts = options(process.argv.slice(2));
if (opts.output && !path.isAbsolute(opts.output)) throw new Error('--output must be an absolute path');
const OUTPUT = path.resolve(opts.output || process.env.SP_TEST_ARTIFACT_DIR || path.join(ROOT, '.omni', 'tmp', 'client-compute-browser-smoke'));
const INSTALL_DIR = path.resolve(opts.installDir || process.env.STRONGHOLD_INSTALL_DIR || ROOT);
await mkdir(OUTPUT, { recursive: true });
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, independentDirectory: path.join(OUTPUT, 'sessions'), installDir: INSTALL_DIR });
const base = new URL('independent.html?execution=client', server.url).href;
const receiptPath = path.join(OUTPUT, 'browser-receipt.json');
const screenshotPath = path.join(OUTPUT, 'client-workshop.png');
const receipt = { ok: false, url: base, artifacts: [{ path: receiptPath, role: 'client-compute Chrome smoke receipt' }, { path: screenshotPath, role: 'client-compute rendered workshop screenshot' }], checks: {} };
const errors = [];
let browser;
let page;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      ...(process.env.SP_TEST_IGNORE_HTTPS === '1' ? ['--ignore-certificate-errors'] : [])] });
  page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/404 \(Not Found\)/.test(text) || /409 \(Conflict\)/.test(text)) return; // favicon and deliberate stale checkpoint probe
    errors.push(`console: ${text}`);
  });
  page.on('requestfailed', (request) => errors.push(`request failed ${request.url()}: ${request.failure()?.errorText || 'unknown'}`));
  page.on('response', (response) => {
    const url = response.url(); const status = response.status();
    if (status >= 400 && !url.endsWith('/favicon.ico') && !/\/replays\/\d+$/.test(url) && !(status === 409 && /\/checkpoint$/.test(url))) errors.push(`HTTP ${status} ${url}`);
  });
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('.ix-mode', { timeout: 30000 });
  await page.$eval('.ix-seed input', (input) => { input.value = '20261007'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('.ix-mode');
  await page.waitForFunction(() => new URL(location.href).searchParams.has('session'), { timeout: 20000 });
  await page.waitForSelector('[data-testid="ix-game"]', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.gm__loading') && globalThis.__SP_VIEW__, { timeout: 90000 });
  const sessionId = await page.evaluate(() => new URL(location.href).searchParams.get('session'));
  const getRaw = () => page.evaluate(async (id) => {
    const response = await fetch(`/independent/api/sessions/${id}?raw=1&catalog=0`);
    return { status: response.status, body: await response.json() };
  }, sessionId);
  let saved = await getRaw();
  assert.equal(saved.status, 200);
  const apiResult = await page.evaluate(async () => {
    const { api, executionMode } = await import('/js/independent/api.js');
    const server = await fetch('/independent/api/catalog').then((response) => response.json());
    const local = await api.catalog();
    return { executionMode, apiType: typeof api.act, catalogsMatch: JSON.stringify(local.catalog) === JSON.stringify(server.catalog) };
  });
  assert.deepEqual(apiResult, { executionMode: 'client', apiType: 'function', catalogsMatch: true });
  receipt.checks.mode = apiResult.executionMode;
  receipt.checks.engineView = await page.evaluate(() => ({ kind: globalThis.__SP_VIEW__.kind, board3d: !!globalThis.__SP_VIEW__.raw?.stats?.().board3d?.on }));
  assert.equal(receipt.checks.engineView.kind, 'engine');

  const bought = await page.evaluate(async ({ sessionId, state }) => {
    const { api } = await import('/js/independent/api.js');
    const slot = state.shop.slots.findIndex((x) => x.kind === 'chess' && x.id);
    return api.act(sessionId, state.revision, { type: 'buy', slot });
  }, { sessionId, state: saved.body.rawState });
  assert.equal(bought.ok, true, bought.error?.message);
  const piece = bought.state.pieces[0];
  const [row, col] = piece.legalTiles[Math.floor(piece.legalTiles.length / 2)].split(',').map(Number);
  const moved = await page.evaluate(async ({ sessionId, revision, uid, row, col }) => {
    const { api } = await import('/js/independent/api.js');
    return api.act(sessionId, revision, { type: 'move', uid, row, col });
  }, { sessionId, revision: bought.state.revision, uid: piece.uid, row, col });
  assert.equal(moved.ok, true, moved.error?.message);
  const beforeFailure = (await getRaw()).body.rawState;
  const rejected = await page.evaluate(async ({ sessionId, revision }) => {
    const { api } = await import('/js/independent/api.js');
    return api.act(sessionId, revision, { type: 'move', uid: 'missing-piece', row: 9, col: 3 });
  }, { sessionId, revision: moved.state.revision });
  assert.equal(rejected.ok, false, 'invalid worker action is rejected');
  assert.deepEqual((await getRaw()).body.rawState, beforeFailure, 'failed worker action leaves the checkpoint untouched');

  const ready = await page.evaluate(async ({ sessionId, revision }) => {
    const { api } = await import('/js/independent/api.js');
    return api.act(sessionId, revision, { type: 'ready' });
  }, { sessionId, revision: moved.state.revision });
  assert.equal(ready.ok, true, ready.error?.message);
  const battle = ready.events.find((event) => event.type === 'battle');
  assert.ok(battle, 'ready action produces a battle result');
  const replay = await page.evaluate(async ({ sessionId, round }) => {
    const { api } = await import('/js/independent/api.js');
    return api.replay(sessionId, round);
  }, { sessionId, round: battle.round });
  assert.ok(replay?.frames?.length > 10, 'battle replay is available from browser IndexedDB');
  const serverReplayStatus = await page.evaluate(async ({ sessionId, round }) => (await fetch(`/independent/api/sessions/${sessionId}/replays/${round}`)).status, { sessionId, round: battle.round });
  assert.equal(serverReplayStatus, 404, 'client-compute does not create a server replay');
  receipt.checks.battle = { round: battle.round, frames: replay.frames.length, result: ready.state.lastBattle?.result || null };

  const rawCurrent = (await getRaw()).body.rawState;
  const conflict = await page.evaluate(async ({ sessionId, rawState }) => {
    const response = await fetch(`/independent/api/sessions/${sessionId}/checkpoint`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, state: { ...rawState, revision: rawState.revision + 1 } }) });
    return { status: response.status, body: await response.json() };
  }, { sessionId, rawState: rawCurrent });
  assert.equal(conflict.status, 409, 'stale checkpoint revision is rejected');
  assert.deepEqual(conflict.body.rawState, rawCurrent);
  receipt.checks.conflict = conflict.status;

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="ix-game"]', { timeout: 30000 });
  await page.waitForFunction(() => globalThis.__SP_VIEW__?.kind === 'engine' && !document.querySelector('.gm__loading'), { timeout: 90000 });
  const restored = await getRaw();
  assert.equal(new URL(page.url()).searchParams.get('session'), sessionId);
  assert.equal(restored.body.rawState.revision, rawCurrent.revision, 'refresh restores the URL session and checkpoint revision');
  receipt.checks.reload = { sessionId, revision: restored.body.rawState.revision };
  receipt.ok = errors.length === 0;
} catch (error) {
  receipt.error = error.stack || error.message;
  if (page) {
    try { receipt.debug = await page.evaluate(() => ({ url: location.href, text: (document.body?.innerText || '').slice(0, 1600), session: new URL(location.href).searchParams.get('session'), buttons: [...document.querySelectorAll('.ix-mode')].map((button) => ({ disabled: button.disabled, text: button.innerText })), resources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /independent|engine|worker/.test(name)) })); }
    catch { /* retain the original failure */ }
    try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch { /* retain the original failure */ }
  }
} finally {
  receipt.errors = errors;
  if (browser) await browser.close();
  await server.close();
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: receipt.ok, receipt: receiptPath, checks: receipt.checks, errors, error: receipt.error }, null, 2)}\n`);
  process.exitCode = receipt.ok ? 0 : 1;
}
