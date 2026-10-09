import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const NATIVE_DATA = path.join(ROOT, 'data/resonance-native');
const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'runtime/resonance/ui-verification');
const PROFILE = path.join(ROOT, '.omni/tmp/resonance/browser-profile');
const REPORT = path.join(OUT, 'ui-flow-receipt.json');
const args = process.argv.slice(2);
let remoteUrl = null, replaySession = null, createdSession = null, battleUi = false;
for (let i = 0; i < args.length;) {
  if (args[i] === '--battle-ui' && !battleUi) { battleUi = true; i++; }
  else if (args[i] === '--url' && args[i + 1] && !remoteUrl) { remoteUrl = args[i + 1]; i += 2; }
  else if (args[i] === '--session' && args[i + 1] && !replaySession) { replaySession = args[i + 1]; i += 2; }
  else if (args[i] === '--created-session' && args[i + 1] && !createdSession) { createdSession = args[i + 1]; i += 2; }
  else throw new Error('usage: [--url <fresh-flow-entry>] [--session <existing-production-session-id>] [--battle-ui fresh flow (optional --url, forbids --session)]; no work started');
}
if (replaySession && !/^[a-zA-Z0-9-]{8,80}$/.test(replaySession)) throw new Error('--session must be an existing session id; no work started');
if (createdSession && !/^[a-zA-Z0-9-]{8,80}$/.test(createdSession)) throw new Error('--created-session must be an existing session id; no work started');
if (battleUi && replaySession) throw new Error('--battle-ui cannot be combined with --session; no work started');
if (createdSession && (!battleUi || !remoteUrl || replaySession)) throw new Error('--created-session requires --url and --battle-ui and cannot be combined with --session; no work started');
const require = createRequire(path.join(ROOT, 'package.json'));
const puppeteer = require('puppeteer-core');
const receipt = { sourceNative: execFileSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceStatus: execFileSync('git', ['-C', SOURCE, 'status', '--short', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), deadlineMs: 600000, mode: replaySession ? 'existing-session-read-only' : createdSession ? 'created-session-battle-ui-resume' : battleUi ? 'fresh-flow-battle-ui' : 'fresh-flow', sessionId: replaySession || createdSession, battleUi,
  status: 'running', tests: [], screenshots: [], errors: [], creates: 0, fights: 0,
  paths: { report: REPORT, profile: PROFILE, source: SOURCE, sessionDirectory: path.join(OUT, 'sessions') } };
let browser, server, fixtureServer, deadline;
const check = (name, value, detail) => { receipt.tests.push({ name, passed: !!value, detail }); if (!value) throw new Error(`${name}: ${JSON.stringify(detail)}`); };
async function button(page, pattern) {
  const h = await page.evaluateHandle((source) => { const re = new RegExp(source);
    return [...document.querySelectorAll('button,a.btn')].find(e => !e.disabled && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && re.test(e.innerText.trim())); }, pattern);
  const el = h.asElement(); if (!el) { await h.dispose(); throw new Error(`visible button not found: ${pattern}`); }
  await el.click(); await h.dispose();
}
async function stateAfterRevision(page, id, revision, label) {
  const handle = await page.waitForFunction(async (sessionId, previousRevision) => {
    const result = await (await fetch(`./resonance/api/sessions/${sessionId}`)).json();
    return result.state?.revision > previousRevision ? result.state : false;
  }, { timeout: 10000 }, id, revision);
  const state = await handle.jsonValue();
  check(`${label}-revision-advanced`, state.revision > revision, { previous: revision, current: state.revision });
  await page.evaluate(value => { document.body.dataset.uiFlowRevision = String(value); }, state.revision);
  return state;
}
async function rightClickPiece(page, uid) {
  const beforeRevision = await page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get('session');
    return (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state?.revision;
  });
  const point = await page.evaluate(value => {
    const numeric = Number(String(value).replace(/^\D+/, ''));
    const rect = globalThis.__SP_VIEW__?.pieceScreenRect?.(numeric);
    if (!rect || rect.width <= 2 || rect.height <= 2) return null;
    return [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, { x: rect.x + rect.width / 2, y: rect.bottom - 2 }]
      .find(candidate => document.elementFromPoint(candidate.x, candidate.y)?.tagName === 'CANVAS') || null;
  }, uid);
  if (!point) throw new Error(`visible piece bounds unavailable for ${uid}`);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.waitForSelector('.dpanel .rs-detail__member', { timeout: 10000 });
  const afterRevision = await page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get('session');
    return (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state?.revision;
  });
  check('right-click-piece-opens-detail-without-action', afterRevision === beforeRevision,
    { uid, beforeRevision, afterRevision });
}
async function leftClickPiece(page, uid) {
  const beforeRevision = await page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get('session');
    return (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state?.revision;
  });
  const point = await page.evaluate(value => {
    const numeric = Number(String(value).replace(/^\D+/, ''));
    const rect = globalThis.__SP_VIEW__?.pieceScreenRect?.(numeric);
    if (!rect) return null;
    return [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, { x: rect.x + rect.width / 2, y: rect.bottom - 2 }]
      .find(candidate => document.elementFromPoint(candidate.x, candidate.y)?.tagName === 'CANVAS') || null;
  }, uid);
  if (!point) throw new Error(`visible piece bounds unavailable for left click ${uid}`);
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector('.dpanel .rs-detail__member', { timeout: 10000 });
  const afterRevision = await page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get('session');
    return (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state?.revision;
  });
  check('left-click-piece-opens-detail-without-action', afterRevision === beforeRevision,
    { uid, beforeRevision, afterRevision });
}
async function dragPointer(page, source, destination) {
  const from = await source.boundingBox();
  if (!from) throw new Error('drag source is not visible');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 12 });
  await page.mouse.up();
}
async function shot(page, name) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter(a => {
      const timing = a.effect?.getComputedTiming?.();
      return timing && Number.isFinite(timing.endTime) && timing.endTime <= 3000;
    });
    await Promise.all(finite.map(a => a.finished.catch(() => {})));
  });
  const file = path.join(OUT, `${name}.jpg`); await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
  receipt.screenshots.push({ name, path: file });
}
async function layout(page, name) {
  const value = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    scrollHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth,
    board: (() => { const e = document.querySelector('.gm__field'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
    text: document.body.innerText, fonts: getComputedStyle(document.documentElement).fontSize,
    selectable: getComputedStyle(document.querySelector('h1,h2,.scard__name') || document.body).userSelect }));
  check(`${name}-viewport`, value.scrollWidth <= value.width + 2 && value.scrollHeight <= value.height + 2, value);
  check(`${name}-selectable`, value.selectable !== 'none', value.selectable);
  check(`${name}-product-copy`, !/真实素材|按.*标准制作|来自实际运行观测|已脱敏|sourceChess|expectedRevision|MainBoard/.test(value.text), value.text.slice(0, 1200));
  if (value.board) check(`${name}-board-dominates`, value.board.width >= value.width * .85 && value.board.height >= value.height * .85, value.board);
}
try {
  await mkdir(OUT, { recursive: true });
  let url = remoteUrl;
  if (!url) {
    process.env.SP_DATA_DIR = NATIVE_DATA;
    process.env.SP_INDEPENDENT_DESIGN_PATH = path.join(NATIVE_DATA, 'independent-design.json');
    process.env.SP_INDEPENDENT_GAME_TEXT_PATH = path.join(NATIVE_DATA, 'independent-game-text.json');
    process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH = path.join(NATIVE_DATA, 'independent-darkmoon-design-addon.json');
    process.env.SP_INDEPENDENT_DIRECTORY = path.join(OUT, 'independent-sessions');
    process.env.SP_RESONANCE_DIRECTORY = path.join(OUT, 'sessions');
    process.env.SP_RECORDING_DIRECTORY = path.join(OUT, 'recordings');
    const { startServer } = await import(pathToFileURL(path.join(SOURCE, 'server/index.js')).href);
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, installDir: ROOT, dataDir: NATIVE_DATA,
      publicDir: path.join(SOURCE, 'public'), sharedDir: path.join(SOURCE, 'shared'),
      resonanceDirectory: path.join(OUT, 'sessions'), independentDirectory: path.join(OUT, 'independent-sessions'),
      recordingDirectory: path.join(OUT, 'recordings') });
    url = `${server.url}/resonance.html`;
  }
  receipt.url = url;
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    userDataDir: PROFILE, args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  deadline = setTimeout(() => { receipt.timedOut = true; browser?.close().catch(() => {}); server?.close().catch(() => {}); }, receipt.deadlineMs);
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await browser.defaultBrowserContext().overridePermissions(new URL(url).origin, ['clipboard-read', 'clipboard-write']);
  page.on('pageerror', error => receipt.errors.push(error.message));
  const dataResponses = [];
  page.on('response', response => {
    if(response.status() >= 400) (receipt.httpErrors ||= []).push({status:response.status(),url:response.url()});
    if (new URL(response.url()).pathname === '/vendor/three.core.js') (receipt.nativeResourceResponses ||= []).push({ url: response.url(), status: response.status() });
    if (new URL(response.url()).pathname === '/data/chess.json') dataResponses.push((async () => {
      const body = await response.buffer();
      const native = await import('node:fs/promises').then(fs => fs.readFile(path.join(ROOT, 'data/resonance-native/chess.json')));
      const evidence = { url: response.url(), status: response.status(), referer: response.request().headers().referer || null,
        responseBytes: body.length, nativeBytes: native.length, dataNativeMatch: body.equals(native) };
      (receipt.dataNativeResponses ||= []).push(evidence);
    })());
  });
  page.on('console', message => { if (message.type() === 'error' || (message.type() === 'warn' && /\[field\]|render/.test(message.text()))) (receipt.console ||= []).push(message.text()); });
  page.on('request', request => { (receipt.requestUrls ||= []).push(request.url()); if (request.method() === 'POST' && /\/resonance\/api\/sessions$/.test(new URL(request.url()).pathname)) receipt.creates++;
    if (request.method() === 'POST' && request.postData()?.includes('"type":"fight"')) receipt.fights++; });
  if (replaySession) { const replayUrl = new URL(url); replayUrl.searchParams.set('session', replaySession); url = replayUrl.href; receipt.url = url; }
  if (createdSession) { const resumeUrl = new URL(url); resumeUrl.searchParams.set('session', createdSession); url = resumeUrl.href; receipt.url = url; }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (replaySession) {
    await page.waitForSelector('.gm', { timeout: 30000 });
    await page.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 30000 });
    const state = await page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, replaySession);
    check('existing-session-loaded', !!state?.sessionId || !!state?.phase, state?.phase);
    const round8 = (state?.history || []).find(x => x.type === 'fight-settled' && x.round === 8);
    check('existing-session-has-round-8', !!round8, (state?.history || []).map(x => x.round));
    check('existing-session-rests-at-choice', state.phase === 'choice', state.phase);
    receipt.initialRevision = state.revision;
    await button(page, '查看战报|战报'); await page.waitForSelector('#rs-section-battle-report', { timeout: 15000 });
    if (Array.isArray(round8?.combatStats?.units) && round8.combatStats.units.length) {
      check('round-8-stats-rendered', await page.$$('#rs-section-battle-report .rs-battle-report__unit').then(rows => rows.length) > 0,
        'stored round-8 unit statistics appear in the report');
    } else {
      check('round-8-missing-stats-stay-unknown', await page.$eval('#rs-section-battle-report .rs-battle-report__empty', e => e.innerText.trim()).catch(() => '') === '此场战斗没有单位统计。',
        'old history without unit statistics is shown as unknown, not zero');
    }
    const round8Button = await page.$('#rs-section-battle-report .rs-battle-report__rounds #battle-report-8');
    if (!round8Button) throw new Error('round 8 report selector is missing');
    await round8Button.click();
    await page.waitForFunction(() => document.querySelector('#rs-section-battle-report #battle-report-8')?.classList.contains('is-selected'), { timeout: 5000 });
    await button(page, '回放');
    await page.waitForSelector('.rs-replay-native', { timeout: 15000 });
    check('stored-replay-round-8', /第\s*8\s*场/.test(await page.$eval('.rs-replay-native', e => e.innerText)), await page.$eval('.rs-replay-native', e => e.innerText));
    const replayLayers = await page.evaluate(() => ({
      shop: !!document.querySelector('.shopbar'), choice: !!document.querySelector('.rs-choice-full'),
      result: !!document.querySelector('.rs-final-screen'), modal: !!document.querySelector('.modal'),
      turnAction: !!document.querySelector('.rs-turn-action')
    }));
    check('replay-hides-gameplay-overlays', !Object.values(replayLayers).some(Boolean), replayLayers);
    await button(page, '暂停|继续');
    await page.waitForFunction(() => /继续/.test(document.querySelector('.rs-replay-native')?.innerText || ''), { timeout: 5000 });
    await page.select('.rs-replay-native select', '2');
    check('replay-speed-two', await page.$eval('.rs-replay-native select', e => e.value) === '2', 'speed selector is UI-driven');
    await shot(page, '12-existing-replay-r8');
    await button(page, '关闭'); await page.waitForFunction(() => !document.querySelector('.rs-replay-native'), { timeout: 5000 });
    await page.waitForSelector('.rs-choice-full', { timeout: 10000 });
    check('replay-close-restores-choice', await page.$('.rs-choice-full') !== null, 'pending choice overlay returns after replay closes');
    await page.evaluate(() => { location.hash = 'replay-8'; });
    await page.waitForSelector('.rs-replay-native', { timeout: 15000 });
    check('replay-eight-deeplink', /第\s*8\s*场/.test(await page.$eval('.rs-replay-native', e => e.innerText)) &&
      new URL(page.url()).searchParams.get('session') === replaySession, page.url());
    const deepLinkLayers = await page.evaluate(() => ({
      shop: !!document.querySelector('.shopbar'), choice: !!document.querySelector('.rs-choice-full'),
      result: !!document.querySelector('.rs-final-screen'), modal: !!document.querySelector('.modal'),
      turnAction: !!document.querySelector('.rs-turn-action')
    }));
    check('replay-deeplink-hides-gameplay-overlays', !Object.values(deepLinkLayers).some(Boolean), deepLinkLayers);
    await button(page, '关闭'); await page.waitForFunction(() => !document.querySelector('.rs-replay-native'), { timeout: 5000 });
    await page.waitForSelector('.rs-choice-full', { timeout: 10000 });
    const after = await page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, replaySession);
    check('replay-read-only-state', after.revision === state.revision, { before: state.revision, after: after.revision });
    check('replay-no-create-or-fight', receipt.creates === 0 && receipt.fights === 0, { creates: receipt.creates, fights: receipt.fights });
    if (await page.$('.modal')) { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 5000 }); }
    receipt.status = 'passed';
  } else {
  if (createdSession) {
    await page.waitForSelector('.gm', { timeout: 30000 });
    await page.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 30000 });
    const resumed = await page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, createdSession);
    check('created-session-resumed-at-prep', resumed?.phase === 'prep' && resumed?.revision === 0 && !(resumed?.history || []).some(x => x.type === 'fight-settled'),
      { phase: resumed?.phase, revision: resumed?.revision, history: resumed?.history?.length });
    check('resume-skips-create', receipt.creates === 0, receipt.creates);
  } else {
  await page.waitForSelector('.title-screen', { timeout: 30000 });
  await page.waitForFunction(() => { const e = document.querySelector('.title-cn'); return e && Number(getComputedStyle(e).opacity) > .99; }, { timeout: 15000 });
  await shot(page, '01-title'); await layout(page, 'title');
  check('title-no-pool', await page.$('.rs-roster') === null, 'full pool is absent from title');
  await button(page, '开始整备|开始模拟'); await page.waitForFunction(() => /选择难度/.test(document.body.innerText), { timeout: 15000 });
  await layout(page, 'difficulty'); check('no-premature-create', receipt.creates === 0, receipt.creates);
  await page.click('.rs-flow__header .stephead__guide');
  await page.waitForSelector('.rs-codex.rs-codex--economy #rs-section-economy-rules', { timeout: 15000 });
  check('entry-guide-opens-current-economy-rules', /经营与补给/.test(await page.$eval('#rs-section-economy-rules', node => node.innerText)),
    'StepHeader guide opens the resonance campaign economy section');
  await page.click('.rs-codex .lo-top__left button');
  await page.waitForFunction(() => !document.querySelector('.rs-codex') && !!document.querySelector('.rs-flow--difficulty'), { timeout: 10000 });
  const returnedStepText = await page.evaluate(() => document.body.innerText);
  check('entry-guide-returns-to-same-step-without-create', receipt.creates === 0 && /选择难度/.test(returnedStepText),
    { creates: receipt.creates, step: 'difficulty' });
  const hardCard = await page.$$('.diff-card');
  const hardIndex = await page.$$eval('.diff-card', cards => cards.findIndex(card => card.querySelector('.diff-card__name')?.textContent.trim() === '困难'));
  const hardBounds = await hardCard[hardIndex]?.boundingBox();
  if (!hardBounds) throw new Error('native hard difficulty card is missing a visible target');
  await page.mouse.click(hardBounds.x + hardBounds.width / 2, hardBounds.y + hardBounds.height / 2);
  await page.waitForFunction(() => [...document.querySelectorAll('.diff-card')].some(card => card.classList.contains('is-selected') && card.querySelector('.diff-card__name')?.textContent.trim() === '困难'), { timeout: 5000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('.rs-difficulty-feature__art img');
    return !!image && /modeChoice\/hard_rhodes_island/.test(image.src) && image.complete && image.naturalWidth > 0;
  }, { timeout: 15000 });
  const difficultyFeature = await page.$eval('.rs-difficulty-feature__art img', image => ({ src: image.src, loaded: image.complete && image.naturalWidth > 0 }));
  check('difficulty-selection-updates-art-and-campaign-summary', /modeChoice\/hard_rhodes_island/.test(difficultyFeature.src) && difficultyFeature.loaded &&
    /节点/.test(await page.$eval('.rs-difficulty-feature__schedule', node => node.innerText)),
    { selected: await page.$eval('.diff-card.is-selected .diff-card__name', node => node.textContent.trim()), art: difficultyFeature,
      summary: await page.$eval('.rs-difficulty-feature__schedule', node => node.innerText.trim()) });
  await shot(page, '02-difficulty');
  check('no-premature-create-after-difficulty', receipt.creates === 0, receipt.creates);
  await button(page, '^选择战场$'); await page.waitForFunction(() => /选择战场/.test(document.body.innerText), { timeout: 15000 });
  const environmentIndex = await page.$$eval('.rs-env-card', cards => cards.findIndex(card => card.getAttribute('aria-selected') !== 'true' && card.querySelector('.rs-env-card__portrait')));
  if (environmentIndex >= 0) {
    const environmentCards = await page.$$('.rs-env-card');
    const environmentBounds = await environmentCards[environmentIndex].boundingBox();
    if (!environmentBounds) throw new Error('recommended environment card has no visible target');
    await page.mouse.click(environmentBounds.x + environmentBounds.width / 2, environmentBounds.y + environmentBounds.height / 2);
  }
  await page.waitForFunction(() => document.querySelectorAll('.rs-env-card[aria-selected="true"]').length === 1 &&
    !!document.querySelector('.rs-env-card.is-sel .rs-env-card__portrait'), { timeout: 5000 });
  check('environment-selection-single-and-real', await page.$$eval('.rs-env-card[aria-selected="true"]', cards => cards.length) === 1 &&
    await page.$('.rs-env-card.is-sel .rs-env-card__portrait') !== null, 'one selected environment with its representative operator portrait');
  await shot(page, '03-environment'); await layout(page, 'environment'); check('no-create-before-briefing', receipt.creates === 0, receipt.creates);
  await button(page, '查看本局简报|下一步'); await page.waitForFunction(() => /本局简报|确认本局信息/.test(document.body.innerText), { timeout: 15000 });
  await page.click('.rs-advanced'); await page.waitForSelector('.rs-seed-field input', { timeout: 10000 });
  await page.click('.rs-seed-field input'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('0');
  await page.waitForFunction(() => {
    const start = [...document.querySelectorAll('.brief__foot button')].find(button => /确认并开始本局/.test(button.innerText));
    return document.querySelector('.rs-seed-field input')?.value === '0' && !!start && !start.disabled;
  }, { timeout: 15000 });
  check('advanced-seed-zero-valid-without-create', receipt.creates === 0 && await page.$eval('.rs-seed-field input', input => input.value) === '0',
    { creates: receipt.creates, seed: await page.$eval('.rs-seed-field input', input => input.value) });
  await button(page, '完成'); await page.waitForFunction(() => !document.querySelector('.rs-seed-field'), { timeout: 5000 });
  await shot(page, '04-briefing'); await layout(page, 'briefing');
  await button(page, '确认并开始本局|开始本局'); await page.waitForSelector('.gm', { timeout: 30000 });
  check('single-create', receipt.creates === 1, receipt.creates);
  receipt.sessionId = new URL(page.url()).searchParams.get('session'); check('session-url', !!receipt.sessionId, page.url());
  }
  await page.waitForSelector('.gm__field canvas,.fbfield', { timeout: 30000 });
  await page.waitForFunction(() => { const view = globalThis.__SP_VIEW__; return view?.kind === 'fallback' || Number(view?.raw?.stats?.().units) > 0; }, { timeout: 30000 });
  receipt.renderer = await page.evaluate(() => ({ kind: globalThis.__SP_VIEW__?.kind, stats: globalThis.__SP_VIEW__?.raw?.stats?.() }));
  await shot(page, '05-prep'); await layout(page, 'prep');
  check('native-hud-shop', await page.$('.gtop') !== null && await page.$('.shopbar') !== null, 'native TopBar and ShopBar');
  check('prep-no-full-pool', await page.$('.rs-roster') === null, 'full pool absent');
  const before = await page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, receipt.sessionId);
  check('real-session-state', !!before?.pieces?.length, before?.phase);
  receipt.freshActions = [];
  check('fresh-opening-five-gold', before.gold === 5, { gold: before.gold });
  const readFresh = () => page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, receipt.sessionId);
  let current = before;
  const oneCostIndex = await page.$$eval('.shopbar__cards .scard:not(.scard--sold)', cards => cards.findIndex(card => {
    const price = card.querySelector('.scard__price'); return price && Number(price.textContent.trim()) === 1;
  }));
  check('one-cost-shop-offer-visible', oneCostIndex >= 0, oneCostIndex);
  const preBuy = current;
  const shopCards = await page.$$('.shopbar__cards .scard:not(.scard--sold)');
  const offerBounds = await shopCards[oneCostIndex]?.boundingBox();
  if (!offerBounds) throw new Error('one-cost shop offer has no visible pointer bounds');
  await page.mouse.click(offerBounds.x + offerBounds.width / 2, offerBounds.y + offerBounds.height / 2, { button: 'right' });
  await page.waitForSelector('.dpanel', { timeout: 10000 });
  check('right-click-shop-opens-detail-without-action', (await readFresh()).revision === preBuy.revision && await page.$('.dpanel .dhead__name') !== null,
    { revision: preBuy.revision, title: await page.$eval('.dpanel .dhead__name', node => node.innerText.trim()) });
  const pactLink = await page.$('.dpanel .dhead__class .dbond');
  check('operator-detail-exposes-pact', !!pactLink, 'operator detail has a native pact link');
  await pactLink.click();
  await page.waitForSelector('.dpanel .rs-detail__levels', { timeout: 10000 });
  const pactLevelState = await page.evaluate(() => {
    const levels = [...document.querySelectorAll('.dpanel .rs-detail__level')];
    const icon = document.querySelector('.dpanel .rs-pact-icon > i');
    return { levels: levels.length, selected: levels.filter(node => node.classList.contains('is-selected')).length,
      effectCount: document.querySelectorAll('.dpanel .rs-detail__selected-effect').length,
      effect: document.querySelector('.dpanel .rs-detail__selected-effect')?.innerText.trim() || '',
      mask: icon ? getComputedStyle(icon).maskImage : 'missing',
      color: icon ? getComputedStyle(icon.parentElement).color : 'missing',
      mint: (() => { const probe = document.createElement('span'); probe.style.color = 'var(--mint-300)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; })() };
  });
  check('pact-detail-single-level-and-icon', pactLevelState.selected === 1 && pactLevelState.effectCount === 1 && /url\(/.test(pactLevelState.mask) && pactLevelState.color === pactLevelState.mint,
    pactLevelState);
  const pactResource = await page.evaluate(async id => {
    const { state } = (await (await fetch(`./resonance/api/sessions/${id}`)).json());
    const { resonanceApi } = await import('./js/resonance/api.js');
    const { pactIconUrl } = await import('./js/resonance/pactIcon.js');
    const result = await resonanceApi.catalog(state.seed, state.environmentId);
    const pactId = result.catalog?.environments?.[state.environmentId]?.identityPactId;
    const url = pactId ? pactIconUrl(result.catalog, pactId) : null;
    const response = url ? await fetch(url) : null;
    return { pactId, url, status: response?.status || 0, contentType: response?.headers.get('content-type') || '' };
  }, receipt.sessionId);
  check('pact-icon-resolves-and-serves-native-image', !!pactResource.pactId && !!pactResource.url && pactResource.status === 200 && /^image\//.test(pactResource.contentType), pactResource);
  if (pactLevelState.levels > 1) {
    const beforeEffect = pactLevelState.effect;
    await page.click('.dpanel .rs-detail__level:not(.is-selected)');
    const selectedLevel = await page.evaluate(() => ({ selected: document.querySelectorAll('.dpanel .rs-detail__level.is-selected').length,
      effectCount: document.querySelectorAll('.dpanel .rs-detail__selected-effect').length,
      effect: document.querySelector('.dpanel .rs-detail__selected-effect')?.innerText.trim() || '' }));
    check('pact-detail-switches-one-level-effect', selectedLevel.selected === 1 && selectedLevel.effectCount === 1 && selectedLevel.effect !== beforeEffect, selectedLevel);
  }
  const oldUids = new Set(preBuy.pieces.map(piece => piece.uid));
  await page.mouse.click(offerBounds.x + offerBounds.width / 2, offerBounds.y + offerBounds.height / 2);
  current = await stateAfterRevision(page, receipt.sessionId, preBuy.revision, 'single-click-buy');
  const purchased = current.pieces.find(piece => !oldUids.has(piece.uid));
  receipt.freshActions.push({ action: 'single-click-buy-with-detail-open', revision: current.revision, gold: current.gold, purchasedUid: purchased?.uid });
  check('single-card-click-buys-one-cost', !!purchased && current.gold === 4 && current.pieces.length === preBuy.pieces.length + 1,
    { gold: current.gold, piecesBefore: preBuy.pieces.length, piecesAfter: current.pieces.length, purchased: purchased?.uid });
  check('detail-remains-open-after-buy', await page.$('.dpanel') !== null, 'shop detail stays visible while a card is purchased');
  const beforeRefresh = current;
  await page.keyboard.press('d');
  current = await stateAfterRevision(page, receipt.sessionId, beforeRefresh.revision, 'D-refresh');
  receipt.freshActions.push({ action: 'D-refresh-with-detail-open', revision: current.revision, gold: current.gold });
  check('D-refresh-updates-real-session', current.gold === 2 && current.shop?.offers?.some(offer => !offer.sold), { gold: current.gold, offers: current.shop?.offers?.length });
  check('detail-remains-open-after-refresh', await page.$('.dpanel') !== null, 'detail stays open during D refresh');
  check('F-is-not-shop-freeze-control', await page.$('.toolbtn--ice kbd') === null, 'shop freeze has no F shortcut');
  await page.click('.dpanel__close');
  const member = purchased || current.pieces[0];
  await page.evaluate(() => { window.__uiFlowViewRef = globalThis.__SP_VIEW__; });
  await page.evaluate(uid => { location.hash = `member-${encodeURIComponent(uid)}`; }, member.uid);
  await page.waitForSelector('.dpanel .dstats', { timeout: 15000 });
  await shot(page, '06-unit-inspect');
  check('member-deeplink-eight-stats', await page.$$eval('.dpanel .dstat', nodes => nodes.length) === 8, 'member instance detail shows eight stats');
  await page.click('.rs-detail__stars [role="tab"][aria-label="二星"]');
  check('member-detail-catalog-star-preview', await page.$('.rs-detail__note') !== null && await page.$$eval('.dpanel .dstat', nodes => nodes.length) === 8,
    'catalog two-star preview remains separate from the one-star member instance');
  await page.click('.rs-detail__stars [role="tab"][aria-label="一星"]');
  check('member-detail-single-selected-star', await page.$$eval('.rs-detail__stars [role="tab"][aria-selected="true"]', nodes => nodes.length) === 1, 'one star tab selected');
  const selectedMemberStar = await page.$eval('.rs-detail__stars [role="tab"][aria-selected="true"]', el => el.getAttribute('aria-label'));
  check('member-star-matches-instance', selectedMemberStar === `${member.star === 1 ? '一' : member.star === 2 ? '二' : '三'}星`, { selected: selectedMemberStar, instance: member.star });
  await page.click('.dpanel__close');
  check('member-detail-keeps-board-view', await page.evaluate(() => globalThis.__SP_VIEW__ === window.__uiFlowViewRef), 'same board view object survives detail close');
  await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 }); await shot(page, '07-prep-1366'); await layout(page, 'prep-1366');
  await page.setViewport({ width: 1000, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.waitForSelector('.gm .shopbar', { timeout: 30000 });
  await page.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 30000 });
  await shot(page, '08-prep-landscape'); await layout(page, 'prep-landscape');
  const codexUrl = new URL(page.url()); codexUrl.searchParams.set('view', 'codex'); codexUrl.hash = 'section-equipment-catalog';
  await page.goto(codexUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForSelector('.rs-codex-overlay .rs-codex', { timeout: 30000 });
  await page.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 30000 });
  await page.evaluate(() => { window.__uiFlowViewRef = globalThis.__SP_VIEW__; });
  await page.$eval('.rs-codex__catalog-card', el => el.click()); await page.waitForSelector('.rs-codex-overlay .dpanel', { timeout: 10000 });
  check('codex-equipment-card-opens-detail', await page.$('.rs-codex-overlay .dpanel .dtext') !== null, 'catalog card detail visible');
  await page.click('.rs-codex-overlay .dpanel__close');
  check('codex-detail-keeps-board-view', await page.evaluate(() => !!globalThis.__SP_VIEW__ && globalThis.__SP_VIEW__ === window.__uiFlowViewRef), 'codex detail close keeps board view attached');
  await shot(page, '09-independent-codex'); check('codex-session-preserved', new URL(page.url()).searchParams.get('session') === receipt.sessionId, page.url());
  if (battleUi) {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.waitForSelector('.gm__field canvas', { timeout: 10000 });
    const codexBack = await page.$('.rs-codex-overlay .lo-top__left button');
    check('codex-back-control-visible', !!codexBack, 'native top-left back button is present');
    await codexBack.click();
    await page.waitForFunction(id => {
      const url = new URL(location.href);
      return !document.querySelector('.rs-codex-overlay') && !document.querySelector('.dpanel') &&
        !url.searchParams.has('view') && url.searchParams.get('session') === id;
    }, { timeout: 15000 }, receipt.sessionId);
    const boardPoint = await page.waitForFunction(() => {
      const view = globalThis.__SP_VIEW__, canvas = document.querySelector('.gm__field canvas'), rect = canvas?.getBoundingClientRect();
      if (!view || !rect || rect.width < 2 || rect.height < 2) return false;
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      return document.elementFromPoint(point.x, point.y)?.tagName === 'CANVAS' ? point : false;
    }, { timeout: 10000 });
    const boardPointValue = await boardPoint.jsonValue();
    check('codex-return-board-interactive', !!boardPointValue && await page.evaluate(() => !!globalThis.__SP_VIEW__), boardPointValue);
    let live = await readFresh();
    const starterIds = new Set(before.pieces.slice(0, 3).map(piece => piece.uid));
    const deployments = [];
    for (const starterUid of starterIds) {
      live = await readFresh();
      const starter = live.pieces.find(piece => piece.uid === starterUid);
      if (!starter || starter.row != null) continue;
      const occupied = new Set(live.pieces.filter(piece => piece.row != null).map(piece => `${piece.row},${piece.col}`));
      const candidates = (starter.legalTiles || []).filter(key => !occupied.has(key)).slice(0, 5).map(key => ({ piece: starter, key }));
      let deployment = null;
      for (const candidate of candidates) {
      const [row, col] = candidate.key.split(',').map(Number), uid = Number(String(candidate.piece.uid).replace(/^\D+/, ''));
      const ready = await page.waitForFunction(({ uid, row, col }) => {
        const view = globalThis.__SP_VIEW__, rect = view?.pieceScreenRect(uid), dest = view?.tileScreen(row, col);
        if (!rect || !dest) { window.__resonanceBattleDeployGeometry = null; return false; }
        const points = [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, { x: rect.x + rect.width / 2, y: rect.bottom - 2 }];
        const source = points.find(point => view.pieceAtClient?.(point.x, point.y)?.uid === uid && document.elementFromPoint(point.x, point.y)?.tagName === 'CANVAS');
        const sourceHit = source && document.elementFromPoint(source.x, source.y), destHit = document.elementFromPoint(dest.x, dest.y);
        if (!source || sourceHit?.tagName !== 'CANVAS' || destHit?.tagName !== 'CANVAS' || [source.x,source.y,dest.x,dest.y].some((v,i)=>v<0||v>=(i%2?innerHeight:innerWidth))) {
          window.__resonanceBattleDeployGeometry = null; return false;
        }
        const value = [source.x,source.y,dest.x,dest.y].map(Math.round), previous = window.__resonanceBattleDeployGeometry;
        const count = previous && previous.value.every((v,i)=>v===value[i]) ? previous.count + 1 : 1;
        window.__resonanceBattleDeployGeometry = { value, count, source, dest }; return count >= 3;
      }, { polling: 'raf', timeout: 2500 }, { uid, row, col }).catch(() => null);
      if (!ready) continue;
      const geometry = await page.evaluate(() => window.__resonanceBattleDeployGeometry);
      await page.mouse.move(geometry.source.x, geometry.source.y); await page.mouse.down();
      await page.mouse.move(geometry.dest.x, geometry.dest.y, { steps: 8 }); await page.mouse.up();
      try { await page.waitForSelector('.fwheel[role="dialog"]', { timeout: 8000 }); } catch { continue; }
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.fwheel[role="dialog"]')?.classList.contains('is-right'), { timeout: 5000 });
      await page.keyboard.press('Enter'); await page.waitForFunction(() => !document.querySelector('.fwheel[role="dialog"]'), { timeout: 10000 });
      const handle = await page.waitForFunction(async ({ id, uid, row, col, revision }) => {
        const state = (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, piece = state.pieces.find(entry => entry.uid === uid);
        return state.revision > revision && piece?.row === row && piece?.col === col && piece?.dir === 'RIGHT' ? state : false;
      }, { timeout: 10000 }, { id: receipt.sessionId, uid: candidate.piece.uid, row, col, revision: live.revision });
      live = await handle.jsonValue(); deployment = { uid: candidate.piece.uid, row, col, dir: 'RIGHT', revision: live.revision }; break;
      }
      if (deployment) deployments.push(deployment);
    }
    check('three-starters-deployed-by-native-pointer-and-facing-wheel', deployments.length === 3, { deployments, expectedStarterIds: [...starterIds] });
    receipt.freshActions.push({ action: 'mouse-drag-three-starters-facing-wheel', deployments });
    const wTarget = deployments[0];
    await leftClickPiece(page, wTarget.uid);
    await page.click('.dpanel__close'); await page.waitForFunction(() => !document.querySelector('.dpanel'), { timeout: 5000 });
    await rightClickPiece(page, wTarget.uid);
    const beforeBench = await readFresh();
    await page.keyboard.press('w');
    current = await stateAfterRevision(page, receipt.sessionId, beforeBench.revision, 'W-bench');
    const benched = current.pieces.find(piece => piece.uid === wTarget.uid);
    check('W-bench-selected-piece', benched?.row == null, { uid: wTarget.uid, row: benched?.row });
    await page.keyboard.press('w');
    current = await stateAfterRevision(page, receipt.sessionId, current.revision, 'W-redeploy');
    const redeployed = current.pieces.find(piece => piece.uid === wTarget.uid);
    check('W-restores-previous-placement', redeployed?.row === wTarget.row && redeployed?.col === wTarget.col,
      { expected: { row: wTarget.row, col: wTarget.col }, actual: { row: redeployed?.row, col: redeployed?.col } });
    receipt.freshActions.push({ action: 'W-bench-and-restore', uid: wTarget.uid, row: redeployed?.row, col: redeployed?.col });
    const equipmentBefore = await readFresh();
    check('starter-equipment-available-for-real-drag', equipmentBefore.inventory?.length > 0,
      { inventory: equipmentBefore.inventory?.length || 0 });
    await page.click('.rs-hud-actions button[title="装备"]');
    await page.waitForSelector('.rs-inventory__main[draggable="true"]', { timeout: 10000 });
    const itemUid = equipmentBefore.inventory[0].uid;
    const itemButton = await page.$(`[id="inventory-${itemUid}"] .rs-inventory__main[draggable="true"]`);
    const equipPoint = await page.evaluate(uid => {
      const numeric = Number(String(uid).replace(/^\D+/, ''));
      const rect = globalThis.__SP_VIEW__?.pieceScreenRect?.(numeric);
      const point = rect && { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      return point && document.elementFromPoint(point.x, point.y)?.tagName === 'CANVAS' ? point : null;
    }, wTarget.uid);
    if (!itemButton || !equipPoint) throw new Error('real equipment drag source or board target is unavailable');
    await dragPointer(page, itemButton, equipPoint);
    current = await stateAfterRevision(page, receipt.sessionId, equipmentBefore.revision, 'drag-equip');
    const equippedTarget = current.pieces.find(piece => piece.uid === wTarget.uid);
    check('drag-equips-real-inventory-item', !current.inventory.some(item => item.uid === itemUid) && equippedTarget?.equipment?.some(item => item.uid === itemUid),
      { itemUid, inventoryAfter: current.inventory?.map(item => item.uid), equipmentAfter: equippedTarget?.equipment?.map(item => item.uid) });
    receipt.freshActions.push({ action: 'native-drag-equip', pieceUid: wTarget.uid, itemUid });
    await page.click('.rs-panel-drawer > header > button[aria-label="关闭面板"]');
    await page.waitForFunction(() => !document.querySelector('.rs-panel-drawer'), { timeout: 5000 });
    const eTarget = deployments[1];
    await rightClickPiece(page, eTarget.uid);
    const beforeESell = await readFresh();
    await page.keyboard.press('e');
    current = await stateAfterRevision(page, receipt.sessionId, beforeESell.revision, 'E-sell');
    check('E-sells-selected-piece', !current.pieces.some(piece => piece.uid === eTarget.uid) && current.gold > beforeESell.gold,
      { uid: eTarget.uid, goldBefore: beforeESell.gold, goldAfter: current.gold });
    receipt.freshActions.push({ action: 'E-sell-selected-piece', uid: eTarget.uid, gold: current.gold });
    const dragSale = deployments[2];
    await page.evaluate(() => { const close = document.querySelector('.dpanel__close'); close?.click(); });
    await page.waitForFunction(() => !document.querySelector('.dpanel'), { timeout: 5000 });
    const beforeDragSale = await readFresh();
    const saleSource = await page.evaluate(uid => {
      const numeric = Number(String(uid).replace(/^\D+/, ''));
      const rect = globalThis.__SP_VIEW__?.pieceScreenRect?.(numeric);
      return rect && { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, dragSale.uid);
    if (!saleSource) throw new Error(`sale drag source unavailable for ${dragSale.uid}`);
    await page.mouse.move(saleSource.x, saleSource.y); await page.mouse.down();
    await page.mouse.move(saleSource.x + 10, saleSource.y + 8, { steps: 2 });
    await page.waitForSelector('.rs-sell-zone[data-drop="sell"]', { timeout: 5000 });
    const salePoint = await page.$eval('.rs-sell-zone[data-drop="sell"]', el => {
      const rect = el.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(salePoint.x, salePoint.y, { steps: 12 }); await page.mouse.up();
    current = await stateAfterRevision(page, receipt.sessionId, beforeDragSale.revision, 'drag-sell');
    check('drag-sells-real-deployed-piece', !current.pieces.some(piece => piece.uid === dragSale.uid) && current.gold > beforeDragSale.gold,
      { uid: dragSale.uid, goldBefore: beforeDragSale.gold, goldAfter: current.gold });
    receipt.freshActions.push({ action: 'native-drag-sell', pieceUid: dragSale.uid, gold: current.gold });
    await rightClickPiece(page, wTarget.uid);
    const beforeXp = current;
    check('F-xp-cost-is-affordable', beforeXp.gold >= Number(beforeXp.actionCosts?.xpGold ?? 4), { gold: beforeXp.gold, cost: beforeXp.actionCosts?.xpGold ?? 4 });
    check('operator-detail-still-open-before-F', await page.$('.dpanel') !== null, 'selected operator detail remains open');
    await page.keyboard.press('f');
    current = await stateAfterRevision(page, receipt.sessionId, beforeXp.revision, 'F-buy-xp');
    check('F-buys-xp-with-detail-open', current.gold === beforeXp.gold - Number(beforeXp.actionCosts?.xpGold ?? 4) && current.xp > beforeXp.xp,
      { goldBefore: beforeXp.gold, goldAfter: current.gold, xpBefore: beforeXp.xp, xpAfter: current.xp });
    check('operator-detail-still-open-after-F', await page.$('.dpanel') !== null, 'selected operator detail remains open after XP purchase');
    receipt.freshActions.push({ action: 'F-buy-xp-with-detail-open', gold: current.gold, xp: current.xp });
    const beforePoorRefresh = current;
    await page.keyboard.press('d');
    await new Promise(resolve => setTimeout(resolve, 350));
    const afterPoorRefresh = await readFresh();
    check('insufficient-D-refresh-is-blocked', afterPoorRefresh.revision === beforePoorRefresh.revision && afterPoorRefresh.gold === beforePoorRefresh.gold,
      { revision: afterPoorRefresh.revision, gold: afterPoorRefresh.gold });
    receipt.freshActions.push({ action: 'D-refresh-insufficient-funds', revision: afterPoorRefresh.revision, gold: afterPoorRefresh.gold, blocked: true });
    await page.click('.dpanel__close');
    if (live.node?.kind === 'logistics' || !live.nodeStarted) {
      await button(page, '领取补给');
      const handle = await page.waitForFunction(async id => { const state=(await (await fetch(`./resonance/api/sessions/${id}`)).json()).state; return state.nodeStarted ? state : false; }, { timeout: 12000 }, receipt.sessionId);
      live = await handle.jsonValue();
    }
    await page.waitForFunction(() => [...document.querySelectorAll('.rs-turn-action button')].some(el => /开始战斗/.test(el.innerText) && !el.disabled), { timeout: 10000 });
    await button(page, '开始战斗');
    await page.waitForFunction(() => !!document.querySelector('.rs-replay-native') || !!document.querySelector('.rs-final-screen'), { timeout: 60000 });
    await page.waitForFunction(async id => {
      const state=(await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, last=[...(state.history||[])].reverse().find(entry=>entry.type==='fight-settled');
      return Array.isArray(last?.combatStats?.units) && last.combatStats.units.some(unit=>Number.isFinite(unit.dmg) && unit.dmg>0);
    }, { timeout: 60000 }, receipt.sessionId);
    live = await readFresh(); const settled = [...live.history].reverse().find(entry => entry.type === 'fight-settled');
    const damageUnits = settled.combatStats.units.filter(unit => Number.isFinite(unit.dmg) && unit.dmg > 0);
    check('single-ui-fight-authoritative-damage', receipt.fights === 1 && damageUnits.length > 0,
      { fights: receipt.fights, damageUnits: damageUnits.map(unit => ({ uid: unit.uid, dmg: unit.dmg })) });
    receipt.freshActions.push({ action: 'single-ui-fight', round: settled.round, damageUnits: damageUnits.map(unit => ({ uid: unit.uid, dmg: unit.dmg })) });
    if (await page.$('.rs-replay-native')) { await button(page, '跳到结算'); await button(page, '关闭'); await page.waitForFunction(() => !document.querySelector('.rs-replay-native'), { timeout: 10000 }); }
    if (await page.$('.rs-final-screen')) { await button(page, '查看战报'); await page.waitForSelector('.modal', { timeout: 10000 }); }
    else { await button(page, '战报'); await page.waitForSelector('#rs-section-battle-report', { timeout: 10000 }); }
    await page.waitForSelector('#rs-section-battle-report .rs-battle-report__unit', { timeout: 10000 });
    const chart = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('#rs-section-battle-report .rs-battle-report__unit')].map(row => ({ value: row.querySelector('.rs-battle-report__bar > b')?.textContent?.trim(), title: row.querySelector('.rs-battle-report__bar > b')?.getAttribute('title'), bar: Number(row.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) })),
      tabs: [...document.querySelectorAll('#rs-section-battle-report .rs-battle-report__metrics [role="tab"]')].map(tab => ({ label: tab.innerText.trim(), selected: tab.getAttribute('aria-selected') }))
    }));
    const shown = value => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
    const expectedValues = damageUnits.map(unit => shown(unit.dmg));
    const countValues = values => values.slice().sort().join('|');
    const positiveChartRows = chart.rows.filter(row => row.bar > 0);
    const damageExactTitles = damageUnits.map(unit => `精确值：${String(unit.dmg)}`);
    check('battle-report-numeric-bars-match-history',
      countValues(positiveChartRows.map(row => row.value)) === countValues(expectedValues) &&
      countValues(positiveChartRows.map(row => row.title)) === countValues(damageExactTitles) &&
      chart.tabs.some(tab => tab.selected === 'true'), { expectedValues, damageExactTitles, chart });
    const metricEvidence = { dmg: { expectedValues, rows: positiveChartRows } };
    for (const [field, label] of [['heal', '治疗'], ['taken', '承伤']]) {
      await page.$eval('#rs-section-battle-report .rs-battle-report__metrics [role="tab"]', (first, target) => {
        const tab = [...document.querySelectorAll('#rs-section-battle-report .rs-battle-report__metrics [role="tab"]')]
          .find(node => node.innerText.trim() === target);
        if (!tab) throw new Error(`report metric tab missing: ${target}`);
        tab.click();
      }, label);
      await page.waitForFunction(target => [...document.querySelectorAll('#rs-section-battle-report .rs-battle-report__metrics [role="tab"]')]
        .some(tab => tab.innerText.trim() === target && tab.getAttribute('aria-selected') === 'true'), { timeout: 5000 }, label);
      const actualRows = await page.$$eval('#rs-section-battle-report .rs-battle-report__unit', rows => rows.map(row => ({
        value: row.querySelector('.rs-battle-report__bar > b')?.textContent?.trim(),
        title: row.querySelector('.rs-battle-report__bar > b')?.getAttribute('title'),
        bar: Number(row.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'))
      })).filter(row => row.bar > 0));
      const expectedUnits = (settled.combatStats.units || []).filter(unit => Number.isFinite(Number(unit[field])) && Number(unit[field]) > 0);
      const expectedRows = expectedUnits.map(unit => ({ value: shown(Number(unit[field])), title: `精确值：${String(unit[field])}` }))
        .sort((a, b) => Number(b.value) - Number(a.value));
      check(`battle-report-${field}-bars-match-history`,
        actualRows.length === expectedRows.length && actualRows.every((row, index) =>
          row.value === expectedRows[index]?.value && row.title === expectedRows[index]?.title),
        { expectedRows, actualRows });
      metricEvidence[field] = { expectedRows, actualRows };
    }
    receipt.combatStatsEvidence = { round: settled.round, source: 'GET session state.history[].combatStats.units', damageUnits, metricEvidence };
    await shot(page, '14-live-combat-report');
  }
  if (!remoteUrl) {
    const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server/index.js')).href);
    fixtureServer = await startServer({ port: 0, host: '127.0.0.1', quiet: true, installDir: ROOT, dataDir: path.join(ROOT, 'data'),
      publicDir: path.join(SOURCE, 'public'), sharedDir: path.join(SOURCE, 'shared'),
      resonanceDirectory: path.join(ROOT, 'runtime/resonance/verification/fixture-sessions'),
      independentDirectory: path.join(OUT, 'independent-sessions'), recordingDirectory: path.join(OUT, 'recordings') });
    const fixture = new URL(`${fixtureServer.url}/resonance.html`);
    fixture.searchParams.set('session', '071b719c-cf27-4a7d-a615-5ab597d0fe0b');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.goto(fixture.href, { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForSelector('.rs-choice-full', { timeout: 30000 });
    await shot(page, '10-existing-choice');
    const choiceBefore = await page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, '071b719c-cf27-4a7d-a615-5ab597d0fe0b');
    await page.$eval('.rs-choice-full .rs-choice-option button', el => el.click());
    await page.waitForSelector('.dpanel', { timeout: 5000 });
    check('choice-option-preview-without-claim', (await page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, '071b719c-cf27-4a7d-a615-5ab597d0fe0b')).revision === choiceBefore.revision,
      'option card selection remains client-side until confirmation');
    await page.click('.dpanel__close');
    check('choice-card-remains-previewed', await page.$('.rs-choice-full .rs-choice-option button.is-armed') !== null, 'selected card remains previewed');
    await page.waitForSelector('.rs-choice-full .rs-choice-option select', { timeout: 10000 });
    const pairState = await page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, '071b719c-cf27-4a7d-a615-5ab597d0fe0b');
    const pairValue = await page.$eval('.rs-choice-full .rs-choice-option select', el => el.options[1]?.value || '');
    check('adjacent-pair-option-available', !!pairValue && pairValue.includes('|'), await page.$eval('.rs-choice-full .rs-choice-option select', el => [...el.options].map(o => ({ value: o.value, text: o.textContent }))));
    await page.select('.rs-choice-full .rs-choice-option select', pairValue);
    check('adjacent-pair-target-selection-local-only', await page.$eval('.rs-choice-full .rs-choice-option select', el => el.value) === pairValue &&
      (await page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, '071b719c-cf27-4a7d-a615-5ab597d0fe0b')).revision === pairState.revision,
      { selected: await page.$eval('.rs-choice-full .rs-choice-option select', el => el.value), revision: pairState.revision });
    await button(page, '收起整备'); check('choice-can-minimize', await page.$('.rs-choice-full') === null, 'returns to board for capacity arrangement');
    await button(page, '继续选择'); await page.waitForSelector('.rs-choice-full', { timeout: 5000 });
    check('choice-can-restore', await page.$('.rs-choice-full') !== null, 'choice overlay reopens from HUD');
    await shot(page, '13-existing-adjacent-target');
    fixture.searchParams.set('session', '14f5ff81-2a70-4b2d-b15b-9d88e19eb9c1');
    await page.goto(fixture.href, { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForSelector('.rs-final-screen', { timeout: 30000 });
    await shot(page, '11-existing-final-result');
    await button(page, '查看战报'); await page.waitForSelector('.modal', { timeout: 10000 });
    check('completed-report-modal-visible', /战斗记录/.test(await page.$eval('.modal', e => e.innerText)), await page.$eval('.modal', e => e.innerText.slice(0, 400)));
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 5000 });
    await page.click('.rs-final-screen .rs-result-member > summary');
    await page.click('.rs-final-screen .rs-result-member[open] .rs-inline-detail'); await page.waitForSelector('.dpanel .dstats', { timeout: 10000 });
    check('completed-member-detail-eight-stats', await page.$$eval('.dpanel .dstat', nodes => nodes.length) === 8, 'member detail is readable from completed result');
    await page.click('.dpanel__close'); await button(page, '返回开始界面'); await page.waitForSelector('.title-screen', { timeout: 15000 });
  }
  }
  await Promise.all(dataResponses);
  if (replaySession) check('local-three-core-response', (receipt.nativeResourceResponses || []).length > 0 && receipt.nativeResourceResponses.every(item => item.status === 200 || item.status === 304), receipt.nativeResourceResponses || []);
  check('native-chess-response-observed', (receipt.dataNativeResponses || []).length > 0 && receipt.dataNativeResponses.every(item => item.status === 200 || item.status === 304), receipt.dataNativeResponses || []);
  check('native-chess-response-bytes-match', receipt.dataNativeResponses.every(item => item.dataNativeMatch), receipt.dataNativeResponses);
  const forbiddenRequests = [...new Set((receipt.requestUrls || []).filter(value => {
    const parsed = new URL(value);
    return (parsed.hostname === 'colorc.cc' && parsed.pathname.startsWith('/stronghold')) || parsed.hostname.endsWith('.pages.dev');
  }))];
  check('no-cloud-game-or-pages-dependency', forbiddenRequests.length === 0, forbiddenRequests);
  check('expected-fight-count', receipt.fights === (battleUi ? 1 : 0), { expected: battleUi ? 1 : 0, actual: receipt.fights }); check('no-js-error', receipt.errors.length === 0, receipt.errors);
  receipt.status = 'passed';
} catch (error) { receipt.status = 'failed'; receipt.failure = error.stack || String(error);
  if (browser) { const pages = await browser.pages().catch(() => []); if (pages.length) await shot(pages.at(-1), 'failure').catch(() => {}); }
} finally {
  clearTimeout(deadline); await browser?.close().catch(error => receipt.errors.push(`close: ${error.message}`));
  await server?.close().catch(error => receipt.errors.push(`server close: ${error.message}`));
  await fixtureServer?.close().catch(error => receipt.errors.push(`fixture close: ${error.message}`));
  receipt.finishedAt = new Date().toISOString(); await writeFile(REPORT, JSON.stringify(receipt, null, 2));
  process.stdout.write(JSON.stringify({ status: receipt.status, report: REPORT, screenshots: receipt.screenshots, failure: receipt.failure }) + '\n');
  if (receipt.status !== 'passed') process.exitCode = 1;
}
