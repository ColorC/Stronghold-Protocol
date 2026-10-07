#!/usr/bin/env node
// Headless Chrome check of the 卫戍协议：工坊 page on the original renderer: start a game, buy, drag an operator onto
// a legal tile and choose its direction, reload (?session restores it), open its detail card and its component link,
// ready, watch the replay on the 3D field, skip to the end, compare the result with the server, reach round 2, and
// take a phone-sized shot. Writes browser-receipt.json (every artifact with its absolute path) and screenshots.
//   node tools/independent-browser-smoke.mjs [--output <dir>] [--url <page url>]
// Without --url a test server starts on a random port with its sessions in <dir>/sessions; a checkout without its own
// install (a Git worktree) serves the art of STRONGHOLD_INSTALL_DIR (server/index.js installDir). Chrome: CHROME_PATH.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';

const args = process.argv.slice(2);
const option = (key) => args[args.indexOf(key) + 1];
const output = path.resolve(args.includes('--output') ? option('--output') : `runtime/independent-frontend-${new Date().toISOString().slice(0, 10)}/browser`);
await mkdir(output, { recursive: true });
const server = args.includes('--url') ? null : await startServer({ port: 0, host: '127.0.0.1', quiet: true, independentDirectory: path.join(output, 'sessions') });
const base = args.includes('--url') ? option('--url') : new URL('independent.html', server.url).href;
const reportPath = path.join(output, 'browser-receipt.json');
const artifacts = [{ path: reportPath, role: 'headless browser validation receipt' }];
if (server) artifacts.push({ path: path.join(output, 'sessions'), role: 'test server session and replay files' });
const errors = [];
const receipt = { ok: false, url: base, artifacts, checks: {} };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
try {
  const profile = await mkdtemp(path.join(output, 'chrome-profile-'));
  artifacts.push({ path: profile, role: 'isolated temporary headless Chrome profile' });
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', userDataDir: profile, headless: true,
    // software WebGL so the 3D board and Spine render without a GPU
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      ...(process.env.SP_TEST_IGNORE_HTTPS === '1' ? ['--ignore-certificate-errors'] : [])] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  const shot = async (name) => { const file = path.join(output, name); await page.screenshot({ path: file }); artifacts.push({ path: file, role: 'screenshot' }); };
  const session = () => page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get('session');
    return (await fetch(new URL(`independent/api/sessions/${id}?catalog=0`, location.href))).json();
  });
  const field = async () => {
    await page.waitForSelector('[data-testid="ix-game"]', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.gm__loading') && globalThis.__SP_VIEW__, { timeout: 90000 });
    await wait(2500);
  };

  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.querySelector('.ix-mode')?.click());
  await field();
  receipt.checks.renderer = await page.evaluate(() => ({ kind: globalThis.__SP_VIEW__.kind, board3d: !!globalThis.__SP_VIEW__.raw?.stats?.().board3d?.on }));
  assert.equal(receipt.checks.renderer.kind, 'engine', 'the original renderer mounted');
  await shot('01-prep.png');

  let s = (await session()).state;
  const slot = s.shop.slots.findIndex((x) => x.kind === 'chess');
  await page.click(`[data-testid="ix-shop-${slot}"]`); await wait(300);
  assert.ok(await page.$('[data-testid="ix-detail"]'), 'the first tap opens the detail card');
  await page.click(`[data-testid="ix-shop-${slot}"]`); await wait(1500);
  s = (await session()).state;
  assert.equal(s.pieces.length, 1, 'the second tap buys');
  const piece = s.pieces[0]; const n = Number(piece.uid.slice(1));
  const [row, col] = piece.legalTiles[Math.floor(piece.legalTiles.length / 2)].split(',').map(Number);
  const from = await page.evaluate(() => globalThis.__SP_VIEW__.tileScreen(7, 0));
  const to = await page.evaluate((r, c) => globalThis.__SP_VIEW__.tileScreen(r, c), row, col);
  const fy = from.y + from.s * 0.25; const ty = to.y + to.s * 0.25;
  await page.mouse.move(from.x, fy); await page.mouse.down();
  for (let i = 1; i <= 16; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 16, fy + ((ty - fy) * i) / 16); await wait(40); }
  await page.mouse.up(); await wait(700);
  await shot('02-direction.png');
  await page.keyboard.press('ArrowRight'); await wait(150); await page.keyboard.press('Enter'); await wait(1500);
  s = (await session()).state;
  assert.deepEqual([s.pieces[0].row, s.pieces[0].col, s.pieces[0].dir], [row, col, 'RIGHT'], 'deployed where dropped, facing the chosen way');
  receipt.checks.deploy = { uid: piece.uid, row, col, dir: 'RIGHT' };

  await page.reload({ waitUntil: 'networkidle0' });
  await field();
  const restored = (await session()).state;
  assert.equal(restored.revision, s.revision, 'a reload resumes the same session');
  await page.evaluate((uid) => { location.hash = `piece-${uid}`; }, piece.uid); await wait(800);
  assert.ok(await page.$('[data-testid="ix-detail"]'), 'a component link opens its detail card');
  await shot('03-detail.png');
  await page.keyboard.press('Escape'); await wait(300);

  await page.click('[data-testid="ix-ready"]');
  await page.waitForSelector('[data-testid="ix-battlebar"]', { timeout: 30000 });
  await wait(5000);
  receipt.checks.battle = await page.evaluate(() => { const st = globalThis.__SP_VIEW__.raw.stats(); return { mode: st.mode, units: st.units }; });
  assert.equal(receipt.checks.battle.mode, 'battle');
  assert.ok(receipt.checks.battle.units >= 1, 'units on the battle field');
  await shot('04-battle.png');
  await page.click('[data-testid="ix-skip"]');
  await page.waitForSelector('[data-testid="ix-result"]', { timeout: 30000 }); await wait(500);
  await shot('05-result.png');
  s = (await session()).state;
  const settled = s.lastBattle?.result?.perPlayer?.independent || {};
  const shown = await page.$eval('[data-testid="ix-result"]', (el) => el.textContent);
  assert.ok(shown.includes(`击倒 ${settled.killed}/${settled.total}`), `the result shows the server's ${settled.killed}/${settled.total}`);
  receipt.checks.result = { round: s.lastBattle?.round, killed: settled.killed, total: settled.total, lpLost: s.lastBattle?.lpLost };
  await page.click('[data-testid="ix-result-ok"]'); await wait(2500);
  assert.equal(s.round, 2);
  await shot('06-round2.png');

  // a phone in landscape (switching to mobile emulation reloads the page)
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await field();
  await shot('07-phone.png');
  receipt.ok = errors.length === 0;
  if (errors.length) receipt.reason = 'page errors';
} catch (error) {
  receipt.error = error.stack || error.message;
} finally {
  receipt.errors = errors;
  if (browser) await browser.close();
  if (server) await server.close();
  await writeFile(reportPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: receipt.ok, receipt: reportPath, checks: receipt.checks, errors, error: receipt.error }, null, 2)}\n`);
  process.exitCode = receipt.ok ? 0 : 1;
}
