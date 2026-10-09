import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const NATIVE_DATA = path.join(ROOT, 'data/resonance-native');
const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'runtime/resonance/ui-verification');
const PROFILE = path.join(ROOT, '.omni/tmp/resonance/browser-profile');
const args = process.argv.slice(2);
let remoteUrl = null, replaySession = null, createdSession = null, resumeTailSession = null, battleUi = false;
for (let i = 0; i < args.length;) {
  if (args[i] === '--battle-ui' && !battleUi) { battleUi = true; i++; }
  else if (args[i] === '--url' && args[i + 1] && !remoteUrl) { remoteUrl = args[i + 1]; i += 2; }
  else if (args[i] === '--session' && args[i + 1] && !replaySession) { replaySession = args[i + 1]; i += 2; }
  else if (args[i] === '--created-session' && args[i + 1] && !createdSession) { createdSession = args[i + 1]; i += 2; }
  else if (args[i] === '--resume-tail' && args[i + 1] && !resumeTailSession) { resumeTailSession = args[i + 1]; i += 2; }
  else throw new Error('usage: [--url <fresh-flow-entry>] [--session <existing-session-id>] [--battle-ui fresh flow] [--resume-tail <existing-ephemeral-session-id>]; no work started');
}
if (replaySession && !/^[a-zA-Z0-9-]{8,80}$/.test(replaySession)) throw new Error('--session must be an existing session id; no work started');
if (createdSession && !/^[a-zA-Z0-9-]{8,80}$/.test(createdSession)) throw new Error('--created-session must be an existing session id; no work started');
if (resumeTailSession && !/^[a-zA-Z0-9-]{8,80}$/.test(resumeTailSession)) throw new Error('--resume-tail must be an existing ephemeral session id; no work started');
if (resumeTailSession && (remoteUrl || replaySession || createdSession || battleUi)) throw new Error('--resume-tail is an isolated existing ephemeral session flow and cannot be combined with other session/url flags; no work started');
if (resumeTailSession) battleUi = true;
if (battleUi && replaySession) throw new Error('--battle-ui cannot be combined with --session; no work started');
if (createdSession && (!battleUi || !remoteUrl || replaySession)) throw new Error('--created-session requires --url and --battle-ui and cannot be combined with --session; no work started');
const REPORT = path.join(OUT, resumeTailSession ? 'ui-flow-tail-receipt.json' : 'ui-flow-receipt.json');
const require = createRequire(path.join(ROOT, 'package.json'));
const puppeteer = require('puppeteer-core');
const receipt = { sourceNative: execFileSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceStatus: execFileSync('git', ['-C', SOURCE, 'status', '--short', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), deadlineMs: 600000, mode: replaySession ? 'existing-session-read-only' : resumeTailSession ? 'resume-tail-live-session' : createdSession ? 'created-session-battle-ui-resume' : battleUi ? 'fresh-flow-battle-ui' : 'fresh-flow', sessionId: replaySession || resumeTailSession || createdSession, battleUi,
  resumeTailReference: resumeTailSession ? path.join(OUT, 'ui-flow-receipt.json') : null,
  status: 'running', tests: [], screenshots: [], errors: [], creates: 0, fights: 0,
  paths: { report: REPORT, profile: PROFILE, source: SOURCE, sessionDirectory: path.join(OUT, 'sessions') } };
let browser, server, fixtureServer, deadline;
let completedWCheckpoint = false;
const check = (name, value, detail) => { receipt.tests.push({ name, passed: !!value, detail }); if (!value) throw new Error(`${name}: ${JSON.stringify(detail)}`); };
async function button(page, pattern) {
  const h = await page.waitForFunction((source) => { const re = new RegExp(source);
    return [...document.querySelectorAll('button,a.btn')].find(e => {
      const rect = e.getBoundingClientRect(), style = getComputedStyle(e);
      return !e.disabled && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && re.test(e.innerText.trim());
    }) || false;
  }, { timeout: 15000 }, pattern);
  const el = h.asElement(); if (!el) { await h.dispose(); throw new Error(`visible enabled button not found: ${pattern}`); }
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
async function piecePointerPoint(page, uid) {
  const handle = await page.waitForFunction(value => {
    const numeric = Number(String(value).replace(/^\D+/, ''));
    const view = globalThis.__SP_VIEW__, rect = view?.pieceScreenRect?.(numeric);
    if (!rect || rect.width <= 2 || rect.height <= 2) return false;
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const hit = view.pieceAtClient?.(point.x, point.y);
    if (hit?.uid !== numeric || document.elementFromPoint(point.x, point.y)?.tagName !== 'CANVAS') {
      window.__uiFlowPiecePoint = null; return false;
    }
    const key = `${numeric}:${Math.round(point.x)}:${Math.round(point.y)}`;
    const previous = window.__uiFlowPiecePoint;
    const count = previous?.key === key ? previous.count + 1 : 1;
    window.__uiFlowPiecePoint = { key, count };
    return count >= 3 ? point : false;
  }, { polling: 'raf', timeout: 15000 }, uid);
  const point = await handle.jsonValue();
  if (!point) throw new Error(`stable visible hit target unavailable for piece ${uid}`);
  return point;
}
async function assertShopPointerTargets(page, scope) {
  const result = await page.evaluate(() => {
    const visible = element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 && rect.width > 2 && rect.height > 2 && rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0;
    };
    const controls = [
      ...[...document.querySelectorAll('.shopbar__cards .scard:not(.scard--sold)')].map((element, index) => ({ element, label: `shop-card-${index + 1}:${element.querySelector('.scard__name')?.textContent?.trim() || element.getAttribute('aria-label') || 'offer'}` })),
      ...[...document.querySelectorAll('.shopbar__tools .toolbtn--amber, .shopbar__tools .toolbtn--ice, .shopbar .rs-level-card')].map(element => ({ element, label: element.innerText.trim() || element.title })),
      ...[...document.querySelectorAll('.rs-hud-actions button, .rs-hud-actions a')].map(element => ({ element, label: element.getAttribute('aria-label') || element.title || element.innerText.trim() || 'hud-action' })),
      ...[...document.querySelectorAll('.rs-turn-action button')].map(element => ({ element, label: `main-action:${element.innerText.trim()}` })),
    ].filter(({ element }) => visible(element));
    return { count: controls.length, shopCards: controls.filter(row => row.label.startsWith('shop-card-')).length,
      controls: controls.map(({ element, label }) => {
        const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { label, reachable: !!hit && (hit === element || element.contains(hit)), hit: hit?.className?.toString?.() || hit?.tagName || null,
          center: { x: Math.round(x), y: Math.round(y) } };
      }) };
  });
  check(`shop-pointer-centers-reachable-${scope}`, result.shopCards > 0 && result.controls.length >= result.shopCards + 3 && result.controls.every(control => control.reachable), result);
}
async function clickVisibleButtonText(page, rootSelector, text, label) {
  const handle = await page.waitForFunction(({ rootSelector, text }) => {
    const root = document.querySelector(rootSelector);
    return [...(root?.querySelectorAll('button') || [])].find(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return (element.innerText.trim() === text || element.getAttribute('aria-label') === text || element.title === text) &&
        !element.disabled && rect.width > 2 && rect.height > 2 && style.display !== 'none' && style.visibility !== 'hidden';
    }) || false;
  }, { timeout: 10000 }, { rootSelector, text });
  const element = handle.asElement();
  if (!element) { await handle.dispose(); throw new Error(`visible ${text} button not found in ${rootSelector}`); }
  const point = await element.evaluate(button => {
    const rect = button.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: !!hit && (hit === button || button.contains(hit)), hit: hit?.className?.toString?.() || hit?.tagName || null };
  });
  check(`${label}-button-center-reachable`, point.reachable, point);
  await page.mouse.click(point.x, point.y); await handle.dispose();
}
async function clickPointerSelector(page, selector, label) {
  const element=await page.waitForSelector(selector,{visible:true,timeout:8000});
  const point=await element.evaluate(target=>{const r=target.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return{x,y,enabled:!target.disabled,reachable:!!hit&&(hit===target||target.contains(hit)),hit:hit?.className?.toString?.()||hit?.tagName||null};});
  check(`${label}-center-pointer-reachable`,point.enabled&&point.reachable,point);
  await page.mouse.click(point.x,point.y);
}
async function inspectShopHoverTooltip(page) {
  const card = await page.$('.shopbar__cards .scard-wrap > .scard:not(.scard--sold)');
  if (!card) throw new Error('native preview tooltip shop card is unavailable');
  const box = await card.boundingBox();
  if (!box) throw new Error('native preview tooltip shop card has no visible bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => {
    const tip = document.querySelector('div.tooltip.is-shown[role="tooltip"]');
    if (!tip) { window.__uiFlowTooltipSince = null; return false; }
    window.__uiFlowTooltipSince ??= performance.now();
    return performance.now() - window.__uiFlowTooltipSince >= 150;
  }, { polling: 'raf', timeout: 5000 });
  const text = await page.$eval('div.tooltip.is-shown[role="tooltip"]', element => element.innerText.trim());
  check('shop-hover-shows-native-preview-tooltip', /一星/.test(text) && /生命|攻击|防御/.test(text) && /技能/.test(text), text);
  await page.mouse.move(2, 2);
}
async function inspectEconomyControls(page, label) {
  const before = await page.evaluate(async () => { const id=new URL(location.href).searchParams.get('session'); return (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state?.revision; });
  const level = await page.$('.shopbar .rs-level-card');
  if (!level) throw new Error('native level card is unavailable for odds context-menu test');
  const levelBox = await level.boundingBox();
  await page.mouse.click(levelBox.x + levelBox.width / 2, levelBox.y + levelBox.height / 2, { button: 'right' });
  await page.waitForSelector('.rs-panel-drawer[aria-label="等级与招募概率"] .rs-economy-help__odds', { timeout: 8000 });
  check(`${label}-lvcard-right-click-shows-odds`, true, await page.$eval('.rs-panel-drawer[aria-label="等级与招募概率"] .rs-economy-help__odds', element => element.innerText.trim()));
  await clickVisibleButtonText(page, '.rs-panel-drawer[aria-label="等级与招募概率"]', '×', `${label}-odds-close`);
  await page.waitForFunction(() => !document.querySelector('.rs-panel-drawer'), { timeout: 5000 });
  const funds = await page.$('.rs-funds .funds__hex');
  const fundsBox = await funds.boundingBox();
  const fundsHit = await page.evaluate(({x,y}) => { const hit=document.elementFromPoint(x,y),target=document.querySelector('.rs-funds .funds__hex'); return !!hit&&(hit===target||target.contains(hit)); }, {x:fundsBox.x+fundsBox.width/2,y:fundsBox.y+fundsBox.height/2});
  check(`${label}-funds-control-center-reachable`, fundsHit, {x:fundsBox.x+fundsBox.width/2,y:fundsBox.y+fundsBox.height/2});
  await page.mouse.click(fundsBox.x + fundsBox.width / 2, fundsBox.y + fundsBox.height / 2);
  await page.waitForSelector('.rs-panel-drawer[aria-label="收入与利息"] .rs-economy-help', { timeout: 8000 });
  check(`${label}-funds-click-shows-income-rules`, true, await page.$eval('.rs-panel-drawer[aria-label="收入与利息"] .rs-economy-help', element => element.innerText.trim()));
  await clickVisibleButtonText(page, '.rs-panel-drawer[aria-label="收入与利息"]', '×', `${label}-income-close`);
  await page.waitForFunction(() => !document.querySelector('.rs-panel-drawer'), { timeout: 5000 });
  await clickVisibleButtonText(page, 'body', '设置', `${label}-settings-opener`);
  await page.waitForSelector('.modal', { timeout: 8000 });
  const guide = await page.$('.set-guide');
  if (!guide) throw new Error('native settings economy-rule guide is unavailable');
  const guideBox=await guide.boundingBox(); if(!guideBox)throw new Error('settings guide has no visible pointer bounds');
  await page.mouse.click(guideBox.x+guideBox.width/2,guideBox.y+guideBox.height/2);
  await page.waitForSelector('.rs-codex-overlay #rs-section-economy-rules', { timeout: 10000 });
  check(`${label}-settings-guide-opens-codex-economy`, /经营与补给/.test(await page.$eval('#rs-section-economy-rules', element => element.innerText)), 'native settings opens campaign rules');
  const back = await page.$('.rs-codex-overlay .lo-top__left button');
  if (back) await back.click(); else await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.rs-codex-overlay'), { timeout: 8000 });
  const after = await page.evaluate(async () => { const id=new URL(location.href).searchParams.get('session'); return (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state?.revision; });
  check(`${label}-economy-inspection-does-not-mutate-session`, before === after, {before,after});
}
async function inspectOverlayShopReachability(page, pieceUid) {
  await rightClickPiece(page, pieceUid);
  check('operator-detail-visible-for-context-switch-test', await page.$('.rs-detail-panel[role="dialog"]') !== null,
    await page.$eval('.rs-detail-panel[role="dialog"]', element => element.getAttribute('aria-label')));
  await assertShopPointerTargets(page, 'operator-detail');
  const drawers = [
    { root: '.rs-dock', text: '盟约', selector: '.rs-panel-drawer[aria-label="盟约"]', name: 'pacts' },
    { root: '.rs-hud-actions', text: '装备背包', selector: '.rs-panel-drawer[aria-label="装备"]', name: 'equipment' },
    { root: '.rs-dock', text: '战报', selector: '.rs-panel-drawer[aria-label="战斗记录"]', name: 'report' },
  ];
  for (const drawer of drawers) {
    await clickVisibleButtonText(page, drawer.root, drawer.text, `${drawer.name}-drawer-opener`);
    await page.waitForSelector(drawer.selector, { timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector('.rs-detail-panel[role="dialog"]'), { timeout: 5000 });
    check(`${drawer.name}-drawer-replaces-operator-detail`, await page.$(drawer.selector) !== null && await page.$('.rs-detail-panel[role="dialog"]') === null,
      await page.$eval(drawer.selector, element => element.getAttribute('aria-label')));
    await assertShopPointerTargets(page, drawer.name);
    await clickVisibleButtonText(page, drawer.selector, '×', `${drawer.name}-drawer-closer`);
    await page.waitForFunction(selector => !document.querySelector(selector), { timeout: 5000 }, drawer.selector);
    await rightClickPiece(page, pieceUid);
    await page.waitForFunction(() => !!document.querySelector('.rs-detail-panel[role="dialog"]') && !document.querySelector('.rs-panel-drawer'), { timeout: 5000 });
    check(`${drawer.name}-drawer-close-restores-operator-detail`, await page.$('.rs-detail-panel[role="dialog"]') !== null && await page.$('.rs-panel-drawer') === null,
      `selected piece ${pieceUid} is restored for the next action`);
  }
}
async function rightClickPiece(page, uid) {
  const beforeRevision = await page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get('session');
    return (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state?.revision;
  });
  const point = await piecePointerPoint(page, uid);
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
  const point = await piecePointerPoint(page, uid);
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
    selectable: getComputedStyle(document.querySelector('h1,h2,.scard__name') || document.body).userSelect,
    dockInventory: (() => { const dock=document.querySelector('.rs-dock'), inventory=document.querySelector('.rs-quick-inventory'); if(!dock||!inventory)return {present:false}; const a=dock.getBoundingClientRect(),b=inventory.getBoundingClientRect(); return {present:true,overlap:a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,dock:{x:a.x,y:a.y,width:a.width,height:a.height},inventory:{x:b.x,y:b.y,width:b.width,height:b.height}}; })(),
    inventoryReachable: [...document.querySelectorAll('.rs-quick-inventory__item')].every(element => { const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return !!hit&&(hit===element||element.contains(hit)); }) }));
  check(`${name}-viewport`, value.scrollWidth <= value.width + 2 && value.scrollHeight <= value.height + 2, value);
  check(`${name}-selectable`, value.selectable !== 'none', value.selectable);
  if(value.dockInventory.present) check(`${name}-dock-and-inventory-do-not-overlap`, !value.dockInventory.overlap && value.inventoryReachable, value.dockInventory);
  check(`${name}-product-copy`, !/真实素材|按.*标准制作|来自实际运行观测|已脱敏|sourceChess|expectedRevision|MainBoard/.test(value.text), value.text.slice(0, 1200));
  if (value.board) check(`${name}-board-dominates`, value.board.width >= value.width * .85 && value.board.height >= value.height * .85, value.board);
}
async function waitForGameplayReady(page, label) {
  await page.waitForSelector('.gm .shopbar', { timeout: 30000 });
  await page.waitForFunction(() => { const view=globalThis.__SP_VIEW__; return !!view&&(view.kind==='fallback'||Number(view.raw?.stats?.().units)>0); }, { timeout: 30000 });
  check(`${label}-renderer-ready`, await page.evaluate(() => ({kind:globalThis.__SP_VIEW__?.kind,units:globalThis.__SP_VIEW__?.raw?.stats?.().units||0})), 'game shell, shop and native renderer are ready');
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
  if (resumeTailSession) { const tailUrl = new URL(url); tailUrl.searchParams.set('session', resumeTailSession); url = tailUrl.href; receipt.url = url; }
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
  if (resumeTailSession) {
    await page.waitForSelector('.gm', { timeout: 30000 });
    await page.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 30000 });
    const resumed = await page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, resumeTailSession);
    const historyTypes = (resumed?.history || []).map(entry => entry.type);
    const expectedPrefix = ['operator-bought', 'shop-refreshed', 'piece-deployed', 'piece-deployed', 'piece-deployed'];
    let validResumeState = resumed?.phase === 'prep' && resumed?.revision === 5 && resumed?.gold === 2 &&
      expectedPrefix.every((type, index) => historyTypes[index] === type) && resumed.pieces?.filter(piece => piece.row != null && ['p1','p2','p3'].includes(piece.uid)).length === 3;
    if (!validResumeState && resumed?.phase === 'prep' && resumed?.revision === 7 && resumed?.gold === 2) {
      const priorPath=path.join(ROOT,'runtime/resonance/ui-verification/ui-tft-tail-attempt-7.json');
      const prior=JSON.parse(await readFile(priorPath,'utf8'));
      const priorTests=new Map((prior.tests||[]).map(test=>[test.name,test]));
      const priorBench=priorTests.get('W-bench-selected-piece'),priorBenchRevision=priorTests.get('W-bench-revision-advanced');
      const priorDeployRevision=priorTests.get('W-redeploy-revision-advanced'),priorPosition=priorTests.get('W-restores-previous-placement');
      const laterHistory=(resumed.history||[]).slice(expectedPrefix.length);
      const p1=resumed.pieces?.find(piece=>piece.uid==='p1'),p2=resumed.pieces?.find(piece=>piece.uid==='p2'),p3=resumed.pieces?.find(piece=>piece.uid==='p3'),p12=resumed.pieces?.find(piece=>piece.uid==='p12');
      completedWCheckpoint=prior.status==='failed'&&prior.sessionId===resumeTailSession&&prior.initialRevision===5&&
        priorBench?.passed===true&&priorBench.detail?.uid==='p1'&&priorBench.detail?.row==null&&priorBenchRevision?.passed===true&&priorBenchRevision.detail?.current===6&&
        priorDeployRevision?.passed===true&&priorDeployRevision.detail?.current===7&&priorPosition?.passed===false&&
        priorPosition.detail?.expected?.row===9&&priorPosition.detail?.expected?.col===3&&priorPosition.detail?.actual?.row===10&&priorPosition.detail?.actual?.col===3&&
        laterHistory.some(event=>event.type==='piece-benched'&&event.uid==='p1')&&laterHistory.some(event=>event.type==='piece-deployed'&&event.uid==='p1'&&event.row===10&&event.col===3&&event.dir==='RIGHT')&&
        p1?.row===10&&p1?.col===3&&p1?.dir==='RIGHT'&&p2?.row===9&&p2?.col===4&&p3?.row===9&&p3?.col===5&&p12?.row==null;
      validResumeState=completedWCheckpoint;
      check('resume-tail-validates-stored-W-checkpoint-and-live-state',completedWCheckpoint,{priorPath,priorStatus:prior.status,priorSession:prior.sessionId,revision:resumed.revision,p1,p2,p3,p12,laterHistory});
    }
    check('resume-tail-existing-session-at-valid-prep-checkpoint',validResumeState,
      { phase: resumed?.phase, revision: resumed?.revision, gold: resumed?.gold, historyTypes, deployed: resumed?.pieces?.filter(piece => piece.row != null).length, completedWCheckpoint });
    check('resume-tail-no-new-session', receipt.creates === 0 && new URL(page.url()).searchParams.get('session') === resumeTailSession,
      { creates: receipt.creates, sessionId: resumeTailSession });
    receipt.initialRevision = resumed.revision;
  } else if (createdSession) {
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
  await button(page, '^选择战场$');
  await page.waitForFunction(() => !!document.querySelector('.rs-flow--environment') && !document.querySelector('.rs-codex') &&
    document.querySelector('.rs-env-card'), { timeout: 15000 });
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
  const before = await page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, receipt.sessionId);
  const readFresh = () => page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, receipt.sessionId);
  let current = before;
  receipt.freshActions = [];
  if (resumeTailSession) {
    check('resume-tail-gameplay-visible', await page.$('.gm') !== null && await page.$('.rs-codex') === null,
      { phase: before?.phase, revision: before?.revision });
  } else {
  await shot(page, '05-prep'); await layout(page, 'prep');
  check('native-hud-shop', await page.$('.gtop') !== null && await page.$('.shopbar') !== null, 'native TopBar and ShopBar');
  check('prep-no-full-pool', await page.$('.rs-roster') === null, 'full pool absent');
  check('real-session-state', !!before?.pieces?.length, before?.phase);
  check('fresh-opening-five-gold', before.gold === 5, { gold: before.gold });
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
  }
  if (battleUi) {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.waitForSelector('.gm__field canvas', { timeout: 10000 });
    if (!resumeTailSession) {
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
    }
    let live = await readFresh();
    const starterIds = new Set(before.pieces.slice(0, 3).map(piece => piece.uid));
    const deployments = resumeTailSession
      ? live.pieces.filter(piece => starterIds.has(piece.uid) && piece.row != null).map(piece => ({ uid: piece.uid, row: piece.row, col: piece.col, dir: piece.dir || 'RIGHT' }))
      : [];
    if (!resumeTailSession) {
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
    } else {
      check('resume-tail-three-starters-already-deployed', deployments.length === 3,
        { deployments, expectedStarterIds: [...starterIds] });
    }
    const viewportRevision=(await readFresh()).revision;
    await page.setViewport({width:1440,height:900,deviceScaleFactor:1,isMobile:false,hasTouch:false});
    await waitForGameplayReady(page,'resume-tail-1440x900');
    await layout(page,'resume-tail-1440x900'); await assertShopPointerTargets(page,'resume-tail-1440x900'); await shot(page,'19-tft-prep');
    await page.setViewport({width:1366,height:768,deviceScaleFactor:1,isMobile:false,hasTouch:false});
    await waitForGameplayReady(page,'resume-tail-1366x768');
    await layout(page,'resume-tail-1366x768'); await assertShopPointerTargets(page,'resume-tail-1366x768');
    await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});
    await waitForGameplayReady(page,'resume-tail-844x390');
    await layout(page,'resume-tail-844x390'); await assertShopPointerTargets(page,'resume-tail-844x390'); await shot(page,'20-tft-phone-landscape');
    await page.setViewport({width:1440,height:900,deviceScaleFactor:1,isMobile:false,hasTouch:false});
    await waitForGameplayReady(page,'resume-tail-restored-1440x900');
    check('resume-tail-viewport-probes-readonly',(await readFresh()).revision===viewportRevision,{revision:viewportRevision});
    const wTarget = deployments[0];
    await inspectShopHoverTooltip(page);
    await leftClickPiece(page, wTarget.uid);
    await page.click('.dpanel__close'); await page.waitForFunction(() => !document.querySelector('.dpanel'), { timeout: 5000 });
    await inspectEconomyControls(page, 'prep');
    const recipeItemIndex=await page.evaluate(async id=>{const state=(await(await fetch(`./resonance/api/sessions/${id}`)).json()).state;const params=new URLSearchParams({seed:String(state.seed)});if(state.environmentId)params.set('environmentId',state.environmentId);const response=await(await fetch(`./resonance/api/catalog?${params}`)).json();const recipes=response.catalog?.recipes||[];return (state.inventory||[]).findIndex(item=>recipes.some(recipe=>recipe.parts?.includes(item.itemId)||recipe.resultId===item.itemId));},receipt.sessionId);
    const quickItem = recipeItemIndex>=0?await page.$$('.rs-quick-inventory__item').then(items=>items[recipeItemIndex]):null;
    if (!quickItem) throw new Error('no actual recipe-linked item is present in resident inventory for the required right-click test');
    const quickBounds=await quickItem.boundingBox();
    await page.mouse.click(quickBounds.x+quickBounds.width/2,quickBounds.y+quickBounds.height/2,{button:'right'});
    await page.waitForSelector('.dpanel .dhead__name', {timeout:8000});
    const quickDetail=await page.$eval('.dpanel',element=>({text:element.innerText.trim(),recipe:!!element.querySelector('.rs-detail__recipe')}));
    check('quick-inventory-right-click-opens-item-recipe-detail',quickDetail.recipe,quickDetail);
    await page.click('.dpanel__close'); await page.waitForFunction(() => !document.querySelector('.dpanel'), { timeout: 5000 });
    await inspectOverlayShopReachability(page, wTarget.uid);
    if(completedWCheckpoint) {
      current=await readFresh();
      check('W-bench-action-already-validated-from-prior-receipt',current.history?.some(event=>event.type==='piece-benched'&&event.uid===wTarget.uid),{uid:wTarget.uid,revision:current.revision});
      check('W-redeploy-action-already-validated-from-prior-receipt',current.pieces.find(piece=>piece.uid===wTarget.uid)?.row===10&&current.pieces.find(piece=>piece.uid===wTarget.uid)?.col===3,{uid:wTarget.uid,actual:current.pieces.find(piece=>piece.uid===wTarget.uid)});
    } else {
      const beforeBench = await readFresh();
      await page.keyboard.press('w');
      current = await stateAfterRevision(page, receipt.sessionId, beforeBench.revision, 'W-bench');
      const benched = current.pieces.find(piece => piece.uid === wTarget.uid);
      check('W-bench-selected-piece', benched?.row == null, { uid: wTarget.uid, row: benched?.row });
      const wTile = await page.evaluate(async ({id,uid,preferred}) => {
        const state=(await(await fetch(`./resonance/api/sessions/${id}`)).json()).state,piece=state.pieces.find(entry=>entry.uid===uid);
        const occupied=new Set(state.pieces.filter(entry=>entry.uid!==uid&&entry.row!=null).map(entry=>`${entry.row},${entry.col}`));
        const legal=(piece.legalTiles||[]).filter(key=>!occupied.has(key));
        const preferredKey=`${preferred.row},${preferred.col}`,key=legal.includes(preferredKey)?preferredKey:legal[0];
        if(!key)return null;const [row,col]=key.split(',').map(Number),view=globalThis.__SP_VIEW__,screen=view?.tileScreen(row,col);
        if(!screen)return null;const canvas=document.querySelector('.gm__field canvas'),rect=canvas?.getBoundingClientRect(),tile=view.raw?.debug?.pick?.groundTile?.(screen.x-rect.left,screen.y-rect.top);
        return tile?.row===row&&tile?.col===col&&document.elementFromPoint(screen.x,screen.y)?.tagName==='CANVAS'?{row,col,x:screen.x,y:screen.y,preferred:key===preferredKey}:null;
      },{id:receipt.sessionId,uid:wTarget.uid,preferred:{row:wTarget.row,col:wTarget.col}});
      check('W-redeploy-hover-target-is-real-legal-empty-tile',!!wTile,wTile);
      await page.mouse.move(wTile.x,wTile.y);
      await page.waitForFunction(({row,col,x,y})=>{const canvas=document.querySelector('.gm__field canvas'),rect=canvas?.getBoundingClientRect();if(!rect)return false;const point=globalThis.__SP_VIEW__?.raw?.debug?.pick?.groundTile?.(x-rect.left,y-rect.top);return point?.row===row&&point?.col===col&&document.elementFromPoint(x,y)?.tagName==='CANVAS';},{timeout:5000},wTile);
      await page.keyboard.press('w');
      current = await stateAfterRevision(page, receipt.sessionId, current.revision, 'W-redeploy');
      const redeployed = current.pieces.find(piece => piece.uid === wTarget.uid);
      check('W-restores-to-hovered-legal-placement', redeployed?.row === wTile.row && redeployed?.col === wTile.col,
        { expected: { row: wTile.row, col: wTile.col }, preferredOriginal: wTile.preferred, actual: { row: redeployed?.row, col: redeployed?.col } });
      receipt.freshActions.push({ action: 'W-bench-and-restore-to-pointer-legal-tile', uid: wTarget.uid, row: redeployed?.row, col: redeployed?.col });
    }
    const equipmentBefore = await readFresh();
    check('starter-equipment-available-for-real-drag', equipmentBefore.inventory?.length > 0,
      { inventory: equipmentBefore.inventory?.length || 0 });
    await clickVisibleButtonText(page, '.rs-hud-actions', '装备背包', 'drag-equipment-drawer-opener');
    await page.waitForSelector('.rs-inventory__main[draggable="true"]', { timeout: 10000 });
    const itemUid = equipmentBefore.inventory[0].uid;
    const itemButton = await page.$(`[id="inventory-${itemUid}"] .rs-inventory__main[draggable="true"]`);
    const equipPoint = await piecePointerPoint(page, wTarget.uid);
    if (!itemButton) throw new Error('real equipment drag source is unavailable');
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
    const saleSource = await piecePointerPoint(page, dragSale.uid);
    await page.mouse.move(saleSource.x, saleSource.y); await page.mouse.down();
    await page.mouse.move(saleSource.x + 10, saleSource.y + 8, { steps: 2 });
    await page.waitForSelector('.rs-sell-zone[data-drop="sell"]', { timeout: 5000 });
    await page.mouse.move(2, 2, {steps:8}); await page.mouse.up();
    const afterCancelledSale=await readFresh();
    check('outside-sale-drop-cancels-without-session-change',afterCancelledSale.revision===beforeDragSale.revision&&afterCancelledSale.pieces.some(piece=>piece.uid===dragSale.uid),{before:beforeDragSale.revision,after:afterCancelledSale.revision,pieceStillDeployed:afterCancelledSale.pieces.some(piece=>piece.uid===dragSale.uid)});
    const saleRetryPoint=await piecePointerPoint(page,dragSale.uid);
    await page.mouse.move(saleRetryPoint.x,saleRetryPoint.y); await page.mouse.down();
    await page.mouse.move(saleRetryPoint.x+10,saleRetryPoint.y+8,{steps:2});
    await page.waitForSelector('.rs-sell-zone[data-drop="sell"]',{timeout:5000});
    const salePoint = await page.$eval('.rs-sell-zone[data-drop="sell"]', el => {
      const rect = el.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(salePoint.x, salePoint.y, { steps: 12 }); await page.mouse.up();
    current = await stateAfterRevision(page, receipt.sessionId, beforeDragSale.revision, 'drag-sell');
    check('drag-sells-real-deployed-piece', !current.pieces.some(piece => piece.uid === dragSale.uid) && current.gold > beforeDragSale.gold,
      { uid: dragSale.uid, goldBefore: beforeDragSale.gold, goldAfter: current.gold });
    receipt.freshActions.push({ action: 'native-drag-sell', pieceUid: dragSale.uid, gold: current.gold });
    live = current;
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
    if (await page.$('.rs-replay-native')) {
      const pause = await page.$eval('.rs-replay-native', root => [...root.querySelectorAll('button')].find(element => /^(暂停|继续)$/.test(element.innerText.trim())) ? [...root.querySelectorAll('button')].find(element => /^(暂停|继续)$/.test(element.innerText.trim())).innerText.trim() : null);
      if (pause === '暂停') { const pauseButton=await page.$('.rs-replay-native button'); const pauseBox=await pauseButton.boundingBox(); await page.mouse.click(pauseBox.x+pauseBox.width/2,pauseBox.y+pauseBox.height/2); await page.waitForFunction(()=>/继续/.test(document.querySelector('.rs-replay-native')?.innerText||''),{timeout:5000}); }
      const battlePick = await page.waitForFunction(() => {
        const adapter=globalThis.__SP_VIEW__, raw=adapter?.raw, canvas=document.querySelector('.gm__field canvas');
        if(!raw?.debug?.views||!canvas)return false;
        const canvasRect=canvas.getBoundingClientRect();
        for(const candidate of raw.debug.views.values()) {
          const info=candidate?.info;
          if(info?.side!=='ally'||info.kind==='device'||info.uid==null)continue;
          const rect=adapter.pieceScreenRect(info.uid); if(!rect||rect.width<3||rect.height<3)continue;
          for(const point of [{x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:rect.x+rect.width/2,y:rect.bottom-3}]) {
            const hit=raw.debug.pick?.battleUnitAt?.(point.x-canvasRect.left,point.y-canvasRect.top);
            if(hit?.info?.uid===info.uid||hit?.uid===info.uid)return {x:point.x,y:point.y,uid:info.uid,unitId:hit.id,side:info.side};
          }
        }
        return false;
      },{polling:'raf',timeout:10000});
      const battlePickPoint=await battlePick.jsonValue();
      check('paused-replay-ally-pointer-hit-is-real-render-unit',battlePickPoint?.side==='ally',battlePickPoint);
      const beforeReplayDetail=await readFresh();
      await page.mouse.click(battlePickPoint.x,battlePickPoint.y,{button:'right'});
      await page.waitForSelector('.dpanel .dhead__name',{timeout:8000});
      const replayDetail=await page.$eval('.dpanel',element=>({text:element.innerText.trim(),buttons:[...element.querySelectorAll('button')].map(button=>button.innerText.trim())}));
      const readOnlyState=await page.$eval('.rs-replay-native',element=>({label:element.getAttribute('aria-label'),controls:[...element.querySelectorAll('button,select,progress')].length}));
      check('replay-ally-right-click-opens-readonly-detail',readOnlyState.label==='战斗回放'&&readOnlyState.controls>0&&!!await page.$('.dpanel .rs-detail__battle-snapshot')&&!await page.$('.dpanel .rs-detail__member')&&!await page.$('.dpanel .rs-detail__actions')&&!await page.$('.dpanel select'),{replay:readOnlyState,detail:replayDetail});
      await shot(page,'21-tft-replay-detail');
      const afterReplayDetail=await readFresh();
      check('replay-unit-detail-does-not-mutate-session',afterReplayDetail.revision===beforeReplayDetail.revision,{before:beforeReplayDetail.revision,after:afterReplayDetail.revision});
      await page.click('.dpanel__close'); await page.waitForFunction(()=>!document.querySelector('.dpanel'),{timeout:5000});
      check('replay-controls-remain-after-ally-detail',await page.$('.rs-replay-native button')!==null,'native playback controls remain available');
      await button(page, '跳到结算'); await button(page, '关闭'); await page.waitForFunction(() => !document.querySelector('.rs-replay-native'), { timeout: 10000 });
    }
    current=await readFresh();
    if(current.phase==='prep') {
      const refreshCost=Number(current.actionCosts?.refreshGold??2),xpCost=Number(current.actionCosts?.xpGold??4),required=refreshCost+xpCost;
      let finance=null;
      if(current.gold<required) finance=await page.evaluate(async ({id,required})=>{const state=(await(await fetch(`./resonance/api/sessions/${id}`)).json()).state;const q=new URLSearchParams({seed:String(state.seed)});if(state.environmentId)q.set('environmentId',state.environmentId);const catalog=(await(await fetch(`./resonance/api/catalog?${q}`)).json()).catalog;const candidates=(state.pieces||[]).map(piece=>{const cost=Number(catalog?.operators?.[piece.operatorId]?.cost)||0,copies=piece.star===3?9:piece.star===2?3:1;return{uid:piece.uid,operatorId:piece.operatorId,star:piece.star,row:piece.row,refund:cost===1?cost*copies:Math.max(0,cost*copies-(piece.star>1?1:0)),equipped:(piece.equipment||[]).length>0};}).filter(piece=>piece.refund>0).sort((a,b)=>Number(b.row==null)-Number(a.row==null)||Number(a.equipped)-Number(b.equipped)||b.refund-a.refund);return{gold:state.gold,required,candidates};},{id:receipt.sessionId,required});
      if(current.gold<required) {
        const candidates=(finance?.candidates||[]).slice();
        while(current.gold<required&&candidates.length) {
          const candidate=candidates.shift();
          await rightClickPiece(page,candidate.uid);
          const beforeSale=await readFresh(); await page.keyboard.press('e');
          current=await stateAfterRevision(page,receipt.sessionId,beforeSale.revision,'post-fight-sale-funds-mouse-e');
          check('post-fight-sale-funds-from-real-piece',!current.pieces.some(piece=>piece.uid===candidate.uid)&&current.gold>beforeSale.gold,{candidate,before:beforeSale.gold,after:current.gold});
          receipt.freshActions.push({action:'post-fight-sale-funds',uid:candidate.uid,refund:current.gold-beforeSale.gold});
        }
        check('post-fight-real-income-and-legal-sale-fund-mouse-actions',current.gold>=required,{startingGold:finance?.gold,required,candidates:finance?.candidates,endingGold:current.gold});
      }
      if(current.phase==='prep'&&current.gold>=required&&current.level<10) {
        const beforeMouseXp=current;
        await clickPointerSelector(page,'.shopbar .rs-level-card','post-fight-mouse-xp');
        current=await stateAfterRevision(page,receipt.sessionId,beforeMouseXp.revision,'post-fight-mouse-xp');
        check('post-fight-mouse-xp-updates-session',current.gold===beforeMouseXp.gold-xpCost&&(current.level>beforeMouseXp.level||current.xp>beforeMouseXp.xp),{goldBefore:beforeMouseXp.gold,goldAfter:current.gold,levelBefore:beforeMouseXp.level,levelAfter:current.level,xpBefore:beforeMouseXp.xp,xpAfter:current.xp,cost:xpCost});
        const beforeMouseRefresh=current;
        await clickPointerSelector(page,'.shopbar__tools .toolbtn--amber','post-fight-mouse-refresh');
        current=await stateAfterRevision(page,receipt.sessionId,beforeMouseRefresh.revision,'post-fight-mouse-refresh');
        check('post-fight-mouse-refresh-updates-session',current.gold===beforeMouseRefresh.gold-refreshCost,{before:beforeMouseRefresh.gold,after:current.gold,cost:refreshCost});
      } else check('post-fight-mouse-economy-actions-affordable',false,{phase:current.phase,gold:current.gold,required,level:current.level});
    } else check('post-fight-mouse-economy-controls-reachable-in-prep',false,{phase:current.phase});
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
    const { startServer } = await import(pathToFileURL(path.join(SOURCE, 'server/index.js')).href);
    fixtureServer = await startServer({ port: 0, host: '127.0.0.1', quiet: true, installDir: ROOT, dataDir: NATIVE_DATA,
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
