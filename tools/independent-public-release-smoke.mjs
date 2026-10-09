#!/usr/bin/env node
// Public release acceptance using real browser input only. No game-state writes bypass the visible UI.
// Example: node tools/independent-public-release-smoke.mjs --base https://colorc.cc/stronghold/independent.html --base https://workshop.colorc.cc/stronghold/independent.html --recording UUID --output E:/.../runtime/growth-destination-20261008/public-qa/run
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const DEFAULT_BASES = [
  'https://colorc.cc/stronghold/independent.html',
  'https://workshop.colorc.cc/stronghold/independent.html',
];
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MAX_BROWSER_MS = 8 * 60 * 1000;
const SLOW_MO = Number(process.env.SP_PUBLIC_QA_SLOW_MO || 0);

function beforeDeadline(promise, startedAt, label) {
  const remaining = Math.max(1, MAX_BROWSER_MS - (Date.now() - startedAt));
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded browser limit ${MAX_BROWSER_MS}ms`)), remaining); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function parseArgs(argv) {
  const bases = []; let recording = null; let output = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--base') { if (!argv[i + 1]) throw new Error('--base needs a URL'); bases.push(argv[++i]); }
    else if (arg === '--recording') { if (!argv[i + 1]) throw new Error('--recording needs a UUID'); recording = argv[++i]; }
    else if (arg === '--output') { if (!argv[i + 1]) throw new Error('--output needs an absolute path'); output = argv[++i]; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  const chosenBases = bases.length ? bases : DEFAULT_BASES;
  if (chosenBases.length < 1 || chosenBases.length > 2) throw new Error('provide one or two --base URLs');
  for (const raw of chosenBases) {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`unsupported base URL: ${raw}`);
  }
  if (!recording) throw new Error('--recording UUID is required for the full replay acceptance');
  if (recording && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recording)) throw new Error('--recording must be a UUID');
  if (!output || !path.isAbsolute(output)) throw new Error('--output must be an absolute path');
  return { bases: chosenBases, recording, output: path.resolve(output) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeName = (s) => String(s).normalize('NFKD').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 64) || 'capture';
async function readSession(page) {
  return page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get('session');
    if (!id) throw new Error('UI start did not put session id in URL');
    const response = await fetch(`/independent/api/sessions/${encodeURIComponent(id)}?catalog=0`, { cache: 'no-store' });
    const packet = await response.json();
    if (!response.ok || !packet.ok) throw new Error(`session read failed: HTTP ${response.status}`);
    return packet.state;
  });
}

async function takeShot(page, output, artifacts, name) {
  const file = path.join(output, `${String(artifacts.filter((x) => x.role === 'screenshot').length + 1).padStart(2, '0')}-${safeName(name)}.png`);
  await page.screenshot({ path: file, fullPage: false });
  artifacts.push({ path: file, role: `browser screenshot: ${name}` });
  return file;
}

function monitor(page, bucket, base) {
  page.on('console', (message) => { if (message.type() === 'error') bucket.consoleErrors.push({ base, text: message.text() }); });
  page.on('pageerror', (error) => bucket.pageErrors.push({ base, message: error.stack || error.message }));
  page.on('requestfailed', (request) => bucket.requestFailures.push({ base, url: request.url(), error: request.failure()?.errorText || 'request failed' }));
  page.on('response', (response) => {
    const url = response.url(); const status = response.status();
    if (/\/recordings\/[^/]+\/media\//.test(url)) bucket.mediaResponses.push({ base, url, status, contentRange: response.headers()['content-range'] || null });
    if (status >= 400) bucket.httpErrors.push({ base, url, status });
  });
}

async function exerciseEntry(page, base, mode, output, receipt) {
  const record = { base, growthMode: mode, checks: {}, errorsAtStart: null };
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.ix-growth-mode__option', { timeout: 60000 });
  const modeButtons = await page.$$('.ix-growth-mode__option');
  let chosenMode = false;
  for (const button of modeButtons) {
    const text = await button.evaluate((el) => el.innerText);
    if (text.includes(mode === 'levels' ? '等级成长' : '徽章成长')) { await button.click(); chosenMode = true; break; }
  }
  assert.ok(chosenMode, `visible ${mode} growth choice was not found`);
  await takeShot(page, output, receipt.artifacts, `${mode}-lobby`);
  const modes = await page.$$('.ix-mode'); let standard = false;
  for (const button of modes) {
    if ((await button.evaluate((el) => el.innerText)).includes('十四轮')) { await button.click(); standard = true; break; }
  }
  assert.ok(standard, 'visible fourteen-round standard mode was not found');
  await page.waitForSelector('[data-testid="ix-game"]', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.gm__loading') && globalThis.__SP_VIEW__, { timeout: 90000 });
  await page.waitForFunction(() => new URL(location.href).searchParams.has('session'), { timeout: 30000 });
  let state = await readSession(page);
  assert.equal(state.phase, 'prep'); assert.equal(state.growthMode, mode); assert.equal(state.roundLimit, 14);
  record.checks.newNormalSession = { sessionId: new URL(page.url()).searchParams.get('session'), phase: state.phase, growthMode: state.growthMode, roundLimit: state.roundLimit };
  record.checks.renderer = await page.evaluate(() => ({ kind: globalThis.__SP_VIEW__?.kind, webgl: !!globalThis.__SP_VIEW__?.raw?.stats?.().board3d?.on }));
  assert.equal(record.checks.renderer.kind, 'engine', 'production renderer did not mount');
  await takeShot(page, output, receipt.artifacts, `${mode}-opening-shop`);

  const slots = state.shop?.slots || [];
  const offerEvidence = [];
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i]; if (!slot || slot.sold) continue;
    state = await readSession(page);
    const selector = slot.kind === 'item' ? '.shopbar__item .scard:not(.scard--sold)' : '.shopbar__cards > .scard, .shopbar__cards > .scard-wrap > .scard';
    const cards = await page.$$(selector);
    let target = null;
    if (slot.kind === 'item') target = cards[0];
    else {
      const chessIndexes = slots.slice(0, i + 1).filter((s) => s && s.kind !== 'item' && !s.sold).length - 1;
      target = cards[chessIndexes] || null;
    }
    if (!target) continue;
    await target.click();
    await page.waitForSelector('[data-testid="ix-detail"]', { timeout: 10000 });
    const detailText = await page.$eval('[data-testid="ix-detail"]', (el) => el.innerText.trim());
    const referenceTabs = await page.$$eval('[data-testid="ix-detail"] [role="tab"]', (tabs) => tabs.filter((tab) => tab.innerText.trim() === '参考原卡').length);
    if (referenceTabs) await page.evaluate(() => [...document.querySelectorAll('[data-testid="ix-detail"] [role="tab"]')].find((tab) => tab.innerText.trim() === '参考原卡')?.click());
    const refs = referenceTabs ? await page.$('[data-testid="ix-detail"] [role="tabpanel"] .ix-original-card') : null;
    const cardEvidence = refs ? await page.$eval('[data-testid="ix-detail"] [role="tabpanel"] .ix-original-card', (el) => {
      const text = el.innerText;
      const forms = [...el.querySelectorAll('section')].map((section) => ({ form: section.querySelector('h4')?.innerText.trim() || '', text: section.querySelector('pre')?.innerText.trim() || '' }));
      return { text, forms, ordinary: forms.some((x) => x.form === '普通' && x.text.length > 0), golden: forms.some((x) => x.form === '金色' && x.text.length > 0) };
    }) : null;
    offerEvidence.push({ index: i, kind: slot.kind || 'chess', id: slot.id, defaultTraitPaneText: detailText, referenceTabVisible: Boolean(referenceTabs), originalCard: cardEvidence });
    if (cardEvidence?.ordinary && cardEvidence?.golden && !record.checks.originalCard) {
      assert.doesNotMatch(detailText, /暴怒的巨蜥|在你使用一张亡语随从牌后/, 'original card text stays out of the default trait pane');
      record.checks.originalCard = { offer: { index: i, id: slot.id }, ordinary: cardEvidence.ordinary, golden: cardEvidence.golden, text: cardEvidence.text };
      await takeShot(page, output, receipt.artifacts, `${mode}-original-card-normal-elite`);
      const referenceTab = await page.$('[data-testid="ix-detail"] [role="tab"][aria-selected="true"]');
      const tabRect = await referenceTab.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.click(tabRect.x, tabRect.y, { button: 'right' });
      await page.waitForFunction(() => document.body.innerText.includes('链接已复制'), { timeout: 5000 });
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(new URL(copied).hash, /#shop-\d+:tab=reference$/, 'right-clicking the reference tab copies a tab-specific component link');
      const linkPage = await page.browserContext().newPage();
      try {
        await linkPage.setViewport({ width: 1600, height: 900 });
        monitor(linkPage, receipt, base);
        await linkPage.goto(copied, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await linkPage.waitForSelector('[data-testid="ix-detail"]', { timeout: 15000 });
        await linkPage.waitForFunction(() => document.querySelector('[data-testid="ix-detail"] [role="tab"][aria-selected="true"]')?.innerText.trim() === '参考原卡', { timeout: 10000 });
        const reopened = await linkPage.$eval('[data-testid="ix-detail"] [role="tabpanel"]', (el) => el.innerText);
        assert.match(reopened, /普通[\s\S]*金色/);
        assert.match(reopened, /暴怒的巨蜥|亡语/);
        record.checks.componentLink = { copied, reopenedInNewPage: true, selectedTab: '参考原卡', sourceTextVisible: true };
        await takeShot(linkPage, output, receipt.artifacts, `${mode}-reference-link-reopened`);
      } finally { await linkPage.close(); }
    }
  }
  record.checks.shop = { offersInState: slots.length, visibleOfferDetails: offerEvidence.length, offers: offerEvidence };
  assert.equal(offerEvidence.length, slots.filter((slot) => slot && !slot.sold).length, 'not every current shop offer detail was opened and read');
  assert.ok(record.checks.originalCard, 'no offer exposes full ordinary and elite source card text');

  // Buy one offered operator via its visible two-tap card, then deploy through the original pointer/facing UI.
  state = await readSession(page);
  const candidateIndex = state.shop.slots.findIndex((s) => s && s.kind !== 'item' && !s.sold && s.price <= state.funds);
  assert.ok(candidateIndex >= 0, 'no currently affordable operator offer');
  const visibleChess = await page.$$('.shopbar__cards > .scard, .shopbar__cards > .scard-wrap > .scard');
  const candidate = visibleChess[candidateIndex]; assert.ok(candidate, `visible operator card missing at ${candidateIndex}`);
  await candidate.click(); await sleep(200); await candidate.click();
  await page.waitForFunction(async () => {
    const id = new URL(location.href).searchParams.get('session');
    const r = await fetch(`/independent/api/sessions/${encodeURIComponent(id)}?catalog=0`, { cache: 'no-store' });
    const p = await r.json(); return p.ok && p.state.pieces?.length > 0;
  }, { timeout: 15000 });
  state = await readSession(page);
  const piece = state.pieces.find((p) => !Number.isInteger(p.row) && !p.temp);
  assert.ok(piece, 'purchased operator did not enter the visible hand');
  const targetTile = (piece.legalTiles || []).map((x) => Array.isArray(x) ? x : String(x).split(',').map(Number)).find((x) => x.length >= 2);
  assert.ok(targetTile, 'bought operator has no legal deployment tile');
  const points = await page.evaluate(([row, col]) => ({ from: globalThis.__SP_VIEW__?.tileScreen?.(7, 0), to: globalThis.__SP_VIEW__?.tileScreen?.(row, col) }), targetTile);
  assert.ok(points.from && points.to, 'renderer did not provide board coordinates');
  await page.mouse.move(points.from.x, points.from.y + points.from.s * .25); await page.mouse.down();
  for (let i = 1; i <= 14; i += 1) { await page.mouse.move(points.from.x + (points.to.x - points.from.x) * i / 14, points.from.y + (points.to.y - points.from.y) * i / 14); await sleep(25); }
  await page.mouse.up();
  await page.waitForSelector('.fwheel[role="dialog"]', { timeout: 10000 });
  const sectors = await page.$eval('.fwheel__dia', (el) => { const r = el.getBoundingClientRect(); return { start: { x: r.left + r.width * .78, y: r.top + r.height * .5 }, end: { x: r.left + r.width * .84, y: r.top + r.height * .5 } }; });
  await page.mouse.move(sectors.start.x, sectors.start.y); await page.mouse.down(); await sleep(120);
  await page.mouse.move(sectors.end.x, sectors.end.y); await sleep(100); await page.mouse.up();
  await page.waitForFunction(async () => {
    const id = new URL(location.href).searchParams.get('session'); const r = await fetch(`/independent/api/sessions/${encodeURIComponent(id)}?catalog=0`, { cache: 'no-store' }); const p = await r.json();
    return p.ok && p.state.pieces?.some((x) => Number.isInteger(x.row));
  }, { timeout: 15000 });
  record.checks.deploy = { uid: piece.uid, legalTile: targetTile };
  const fsButton = await page.$('button.gm__fs'); assert.ok(fsButton, 'fullscreen control missing');
  await fsButton.click(); await page.waitForFunction(() => !!document.fullscreenElement, { timeout: 5000 }); record.checks.fullscreen = true;
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.fullscreenElement, { timeout: 5000 });
  const ready = await page.$('[data-testid="ix-ready"]');
  if (ready) await ready.click();
  else {
    const buttons = await page.$$('button'); let found = false;
    for (const button of buttons) { const text = await button.evaluate((el) => el.innerText.trim()); if (/^(开始战斗|开始本轮|出战)$/.test(text)) { await button.click(); found = true; break; } }
    assert.ok(found, 'visible start-battle control not found');
  }
  await page.waitForSelector('[data-testid="ix-battlebar"]', { timeout: 30000 });
  await page.waitForFunction(() => {
    const view = globalThis.__SP_VIEW__;
    if (view?.kind !== 'engine') return false;
    const stats = view.raw.stats();
    return stats.mode === 'battle' && stats.units > 0;
  }, { timeout: 30000 });
  await page.waitForFunction(() => Number(globalThis.__SP_VIEW__?.raw?.stats?.().numbers || 0) > 0, { timeout: 20000 });
  record.checks.battle = await page.evaluate(() => {
    const view = globalThis.__SP_VIEW__; const stats = view.raw.stats();
    const doc = document;
    return { renderer: view.kind, board3d: !!stats.board3d?.on, mode: stats.mode, units: stats.units, activeRenderedDamageNumbers: stats.numbers, bodyText: doc.body.innerText.slice(-1600) };
  });
  assert.equal(record.checks.battle.mode, 'battle'); assert.ok(record.checks.battle.board3d, 'WebGL/3D board is not active');
  assert.ok(record.checks.battle.activeRenderedDamageNumbers > 0, 'battle renderer did not produce a visible damage-number frame');
  await takeShot(page, output, receipt.artifacts, `${mode}-battle-webgl`);
  return record;
}

async function exerciseReplay(page, base, recording, output, receipt) {
  const record = { base, recording, checks: {} };
  const replayUrl = new URL(`/stronghold/independent-replay.html?recording=${encodeURIComponent(recording)}`, base).href;
  const metaResponse = await page.goto(replayUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.ok(metaResponse && metaResponse.status() < 400, `replay page returned ${metaResponse?.status()}`);
  const packet = await page.evaluate(async (id) => {
    const response = await fetch(`/independent/api/recordings/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const body = await response.json(); if (!response.ok || !body.ok) throw new Error(`recording metadata HTTP ${response.status}`); return body;
  }, recording);
  assert.ok(packet.meta?.endedAt, 'recording lacks endedAt');
  assert.equal(packet.meta?.mediaPlaybackReady, true, 'recording media playback is not finalized');
  const cue = (packet.events || []).find((event) => event.kind === 'caption' && event.p?.key === 'first-native-mechanic');
  assert.ok(cue, 'recording is missing the first-native-mechanic caption');
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === '记录已结束', { timeout: 60000 });
  const duration = Number(await page.$eval('#timeline', (el) => el.max));
  assert.ok(duration > 0, 'replay timeline has no duration');
  const capturePosition = async (second, name) => {
    const timeline = await page.$('#timeline');
    await timeline.evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); }, second);
    await sleep(700);
    const proof = await page.evaluate(() => {
      const frame = document.querySelector('#stage iframe'); const video = document.querySelector('#stage video[data-sp-canvas-media]');
      const visible = (el) => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
      return { iframe: visible(frame), video: visible(video), readyState: video?.readyState ?? 0, width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0, caption: document.querySelector('#caption')?.textContent || '', hudText: frame?.contentDocument?.body?.innerText?.slice(0, 500) || '' };
    });
    record.checks.positions ||= []; record.checks.positions.push({ second, name, ...proof });
    assert.ok(proof.iframe, `${name}: replay iframe is not visible`);
    await takeShot(page, output, receipt.artifacts, `replay-${name}`);
    return proof;
  };
  await capturePosition(0.05, 'start');
  // Click playback to exercise rrweb player controls; pause through the same visible button.
  await page.click('#play'); await page.waitForFunction(() => document.querySelector('#play')?.textContent === '暂停', { timeout: 5000 });
  await sleep(900); await page.click('#play'); await page.waitForFunction(() => document.querySelector('#play')?.textContent === '播放', { timeout: 5000 });
  await capturePosition(duration / 2, 'middle'); await capturePosition(Math.max(0, duration - .1), 'end');

  const cueSecond = Math.max(0, (cue.ts - Date.parse(packet.meta.startedAt)) / 1000);
  const cueTimeline = await page.$('#timeline');
  await cueTimeline.evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); }, Math.min(duration, cueSecond + .05));
  await page.click('#play');
  await page.waitForFunction((text) => document.querySelector('#caption')?.textContent === text && document.querySelector('#play')?.textContent === '播放' && /scale\(/.test(document.querySelector('#stage')?.style.transform || ''), { timeout: 12000 }, cue.p.text);
  record.checks.firstMechanic = await page.evaluate(() => ({ caption: document.querySelector('#caption')?.textContent || '', zoom: document.querySelector('#stage')?.style.transform || '', paused: document.querySelector('#play')?.textContent === '播放', iframe: !!document.querySelector('#stage iframe') }));
  assert.ok(record.checks.firstMechanic.caption && record.checks.firstMechanic.zoom && record.checks.firstMechanic.paused, 'first mechanic did not auto-pause and zoom');
  await takeShot(page, output, receipt.artifacts, 'replay-first-mechanic-caption-zoom');
  await page.waitForFunction(() => { const v = document.querySelector('#stage video[data-sp-canvas-media]'); return v && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0; }, { timeout: 30000 });
  record.checks.media = await page.$eval('#stage video[data-sp-canvas-media]', (video) => ({ readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, currentTime: video.currentTime }));
  assert.ok(receipt.mediaResponses.some((r) => r.base === base && [200, 206].includes(r.status)), 'no successful 200/206 media request observed');
  record.checks.meta = { endedAt: packet.meta.endedAt, mediaPlaybackReady: packet.meta.mediaPlaybackReady, mediaSegments: packet.meta.mediaSegments?.length || 0 };
  return record;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node tools/independent-public-release-smoke.mjs [--base URL [--base URL]] --recording UUID --output ABSOLUTE_PATH\n'); return;
  }
  await mkdir(args.output, { recursive: true });
  const reportPath = path.join(args.output, 'public-release-smoke.json');
  const receipt = { ok: false, startedAt: new Date().toISOString(), bases: args.bases, recording: args.recording, output: args.output,
    policy: 'Only real browser UI input changes game state; metadata/session checks are GET-only. One isolated context per public base.',
    browserConnectionMode: process.env.SP_DETAIL_PANEL_CDP ? 'connected-existing-browser-with-isolated-contexts' : 'owned-browser-with-isolated-contexts',
    entries: [], replay: null, artifacts: [{ path: reportPath, role: 'public release browser QA receipt' }],
    consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [], mediaResponses: [] };
  let browser; let browserOwned = false; const contexts = []; let browserStartedAt = 0;
  try {
    if (process.env.SP_DETAIL_PANEL_CDP) browser = await puppeteer.connect({ browserURL: process.env.SP_DETAIL_PANEL_CDP });
    else {
      browserOwned = true;
      browser = await puppeteer.launch({ executablePath: CHROME, headless: true, slowMo: SLOW_MO, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    }
    browserStartedAt = Date.now();
    for (let i = 0; i < args.bases.length; i += 1) {
      const base = args.bases[i]; const context = await browser.createBrowserContext(); contexts.push(context);
      const page = await context.newPage(); await page.setViewport({ width: 1600, height: 900 });
      await context.overridePermissions(new URL(base).origin, ['clipboard-read', 'clipboard-write']);
      monitor(page, receipt, base);
      const run = exerciseEntry(page, base, i === 0 ? 'badges' : 'levels', args.output, receipt);
      const result = await beforeDeadline(run, browserStartedAt, 'public entry acceptance');
      receipt.entries.push(result);
      // Capture UI result plus all diagnostics before the isolated context is closed.
      receipt.entries.at(-1).urlAfter = page.url();
    }
    if (args.recording) {
      const base = args.bases[0]; const context = contexts[0]; const page = await context.newPage(); await page.setViewport({ width: 1600, height: 900 }); monitor(page, receipt, base);
      const run = exerciseReplay(page, base, args.recording, args.output, receipt);
      receipt.replay = await beforeDeadline(run, browserStartedAt, 'replay acceptance');
    }
    assert.equal(receipt.consoleErrors.length, 0, 'console errors were observed');
    assert.equal(receipt.pageErrors.length, 0, 'uncaught page errors were observed');
    assert.equal(receipt.requestFailures.length, 0, 'network request failures were observed');
    assert.equal(receipt.httpErrors.length, 0, 'HTTP 4xx/5xx responses were observed');
    receipt.ok = true;
  } catch (error) { receipt.error = error.stack || error.message; }
  finally {
    for (const context of contexts) await context.close().catch((error) => { receipt.closeErrors ||= []; receipt.closeErrors.push(error.message); });
    if (browserOwned) await browser?.close().catch((error) => { receipt.closeErrors ||= []; receipt.closeErrors.push(error.message); });
    else browser?.disconnect();
    receipt.finishedAt = new Date().toISOString();
    await writeFile(reportPath, `${JSON.stringify(receipt, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: receipt.ok, report: reportPath, artifactCount: receipt.artifacts.length, entries: receipt.entries.length, replay: !!receipt.replay, error: receipt.error, diagnostics: { console: receipt.consoleErrors.length, page: receipt.pageErrors.length, request: receipt.requestFailures.length, http: receipt.httpErrors.length } }, null, 2)}\n`);
    process.exitCode = receipt.ok ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
