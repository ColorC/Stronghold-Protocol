#!/usr/bin/env node
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const WORKSHOP_URL = 'https://workshop.colorc.cc/bside/canvas/notes-web.html?theme=workshop&product_ref=spark-workshop&project=arknights&session_id=canvas%3Acanvas-0470c0a1&focus=resonance-play-20261009&fullscreen=1';
const CARD_ID = 'resonance-play-20261009';
const GAME_URL = 'https://workshop.colorc.cc/stronghold/resonance.html';
const PROFILE = path.join(ROOT, '.omni/tmp/resonance/browser-profile');
const CONFIG = 'C:/Users/lilithgames/AppData/Roaming/wsh/config.json';
const WSH_CLI = process.env.WSH_CLI_PATH
  || 'E:/WindowsWorkspace/spark.workshop/releases/remote-play-card-20261004/wt/remote-play-card-20261004-5ba073215a31/workshop/cli/dist/wsh.mjs';
const VERIFY_DIR = path.join(ROOT, 'runtime/resonance/ui-verification');
const RECEIPT = path.join(ROOT, 'runtime/resonance/ui-workshop-ui-receipt.json');
const LOG = path.join(ROOT, 'runtime/resonance/ui-workshop-ui.log');
const EMBED_SCREENSHOT = path.join(VERIFY_DIR, '15-workshop-native-ui.jpg');
const FULLSCREEN_SCREENSHOT = path.join(VERIFY_DIR, '16-workshop-fullscreen.jpg');
const DEADLINE_MS = 180_000;

function parseArgs(args) {
  const out = { selfTest: false, help: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--self-test') out.selfTest = true;
    else if (args[i] === '--help' || args[i] === '-h') out.help = true;
    else if (['--session', '--product-native'].includes(args[i])) {
      const key = args[i].slice(2);
      const value = args[++i];
      if (!value || value.startsWith('--') || out[key]) throw new Error(`missing or duplicate ${args[i - 1]}`);
      out[key] = value;
    } else throw new Error(`unknown argument: ${args[i]}`);
  }
  if (!out.selfTest && !out.help) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(out.session || '')) throw new Error('--session must be the supplied persisted UUID');
    if (!/^[0-9a-f]{40}$/i.test(out['product-native'] || '')) throw new Error('--product-native must be a full native Git commit');
  }
  return out;
}

export function isScopedWorkshopBearerUrl(requestUrl, workshopUrl) {
  try {
    const request = new URL(requestUrl), target = new URL(workshopUrl);
    if (request.origin !== target.origin) return false;
    const pathname = request.pathname.replace(/\/+$/, '') || '/';
    if (/^\/(?:bside\/)?play(?:\/|$)/i.test(pathname) || /(?:^|\/)resonance\.html$/i.test(pathname)) return false;
    if (pathname === '/lofa' || pathname.startsWith('/lofa/')) return true;
    if (pathname === '/bside/lofa' || pathname.startsWith('/bside/lofa/')) return true;
    if (pathname === '/bside/api' || pathname.startsWith('/bside/api/')) return true;
    const targetPath = target.pathname.replace(/\/+$/, '') || '/';
    return pathname === targetPath || (targetPath !== '/' && pathname === `${targetPath}/`)
      || pathname === '/bside/notes-web.html' || pathname.startsWith('/bside/canvas/');
  } catch { return false; }
}

function workshopCredentials() {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const configured = new URL(String(config.server || ''));
  const target = new URL(WORKSHOP_URL);
  if (configured.origin !== target.origin || configured.pathname.replace(/\/+$/, '') !== '/bside'
    || configured.username || configured.password || typeof config.token !== 'string' || !config.token.trim()) {
    throw new Error('official WSH config does not match the exact Workshop /bside origin');
  }
  const stdout = execFileSync(process.execPath, [WSH_CLI, 'whoami', '--json', '--server', `${target.origin}/bside`, '--project', 'arknights'], {
    encoding: 'utf8', timeout: 20_000, windowsHide: true,
  });
  const writer = JSON.parse(stdout)?.writer;
  const writerHeaders = {
    'x-workshop-machine': writer?.machine,
    'x-workshop-session': writer?.session,
    'x-workshop-runtime': writer?.runtime,
    'x-workshop-software': writer?.software,
  };
  if (Object.values(writerHeaders).some(value => typeof value !== 'string' || !value.trim())) throw new Error('official WSH whoami returned incomplete writer identity');
  return { bearer: `Bearer ${config.token.trim()}`, writerHeaders };
}

function selfTest() {
  const target = 'https://workshop.colorc.cc/bside/canvas/notes-web.html';
  for (const url of [target, 'https://workshop.colorc.cc/bside/api/canvases/id', 'https://workshop.colorc.cc/bside/lofa/invoke']) {
    if (!isScopedWorkshopBearerUrl(url, target)) throw new Error(`Workshop route was not scoped: ${new URL(url).pathname}`);
  }
  for (const url of ['https://workshop.colorc.cc/stronghold/resonance.html', 'https://workshop.colorc.cc/resonance/api/sessions/id', 'https://cdn.example/js/game.js']) {
    if (isScopedWorkshopBearerUrl(url, target)) throw new Error(`non-Workshop route received bearer scope: ${new URL(url).origin}${new URL(url).pathname}`);
  }
  const valid = parseArgs(['--session', '01234567-89ab-4def-8123-456789abcdef', '--product-native', 'a'.repeat(40)]);
  if (valid.session !== '01234567-89ab-4def-8123-456789abcdef') throw new Error('CLI self-test failed');
  process.stdout.write(JSON.stringify({ ok: true, workshopOnlyBearerScope: true, sessionReadonly: true }) + '\n');
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function frameIsGame(frame, hostFrame) {
  if (frame === hostFrame) return false;
  let parent = frame.parentFrame();
  while (parent && parent !== hostFrame) parent = parent.parentFrame();
  if (parent !== hostFrame) return false;
  try { const url = new URL(frame.url()); return url.origin === new URL(GAME_URL).origin && url.pathname === new URL(GAME_URL).pathname; }
  catch { return false; }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('用法：node tools/resonance/workshop-ui-check.mjs --session <persisted-uuid> --product-native <full-git-commit>\n       node tools/resonance/workshop-ui-check.mjs --self-test\n');
    return;
  }
  if (options.selfTest) return selfTest();
  for (const output of [RECEIPT, LOG, EMBED_SCREENSHOT, FULLSCREEN_SCREENSHOT]) {
    if (existsSync(output)) throw new Error(`refusing to overwrite existing output: ${output}`);
  }
  const logLines = [];
  const log = message => logLines.push(`${new Date().toISOString()} ${message}`);
  const writeLog = () => writeFileSync(LOG, `${logLines.join('\n')}\n`, { flag: 'wx' });
  let browser;
  let deadlineTimer;
  let timedOut = false;
  const mutatingRequests = [];
  const requestRows = [];
  const requiredResourceFailures = [];
  const scopedPages = new WeakMap();
  const pages = new Set();
  const target = new URL(WORKSHOP_URL);
  const creds = workshopCredentials();
  const canonicalRequire = createRequire(path.join(ROOT, 'package.json'));
  const puppeteer = canonicalRequire('puppeteer-core');
  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (!existsSync(PROFILE) || !existsSync(chromePath)) throw new Error('canonical Chrome or shared resonance browser profile is missing');
  const installScope = async page => {
    if (scopedPages.has(page)) return scopedPages.get(page);
    const ready = (async () => {
      await page.setRequestInterception(true);
      const handler = request => {
        let parsed;
        try { parsed = new URL(request.url()); } catch { parsed = null; }
        const pathName = parsed?.pathname || '';
        const method = request.method();
        if (parsed?.origin === 'https://workshop.colorc.cc' && pathName.startsWith('/resonance/api/')) {
          requestRows.push({ method, path: pathName });
          if (method !== 'GET' && method !== 'HEAD' && /\/(?:sessions(?:\/|$)|actions?(?:\/|$)|fight(?:\/|$)|create(?:\/|$))/.test(pathName)) {
            mutatingRequests.push({ method, path: pathName });
          }
        }
        const headers = { ...request.headers() };
        if (isScopedWorkshopBearerUrl(request.url(), WORKSHOP_URL)) {
          headers.authorization = creds.bearer;
          Object.assign(headers, creds.writerHeaders);
        } else {
          if (headers.authorization === creds.bearer) delete headers.authorization;
          for (const key of Object.keys(creds.writerHeaders)) delete headers[key];
        }
        void request.continue({ headers }).catch(() => {});
      };
      page.on('request', handler);
      page.on('response', response => {
        const url = new URL(response.url());
        if (['/css/screens/draft.css', '/css/screens/title.css', '/css/screens/briefing.css', '/css/screens/lobby.css', '/js/net.js'].includes(url.pathname)
          && response.status() >= 400) requiredResourceFailures.push({ status: response.status(), path: url.pathname });
      });
      page.on('pageerror', error => log(`pageerror: ${error.message}`));
      pages.add(page);
      return { dispose: async () => { page.off('request', handler); await page.setRequestInterception(false).catch(() => {}); } };
    })();
    scopedPages.set(page, ready);
    return ready;
  };
  const evidence = { status: 'running', sessionId: options.session, productNative: options['product-native'], workshopUrl: WORKSHOP_URL,
    cardId: CARD_ID, screenshots: [EMBED_SCREENSHOT, FULLSCREEN_SCREENSHOT], requestRows, mutatingRequests, requiredResourceFailures };
  const work = (async () => {
    browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: PROFILE,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--window-size=1440,1000'] });
    const onTarget = targetEvent => {
      if (targetEvent.type() === 'page') void targetEvent.page().then(page => page && installScope(page)).catch(error => log(`popup scope error: ${error.message}`));
    };
    browser.on('targetcreated', onTarget);
    const page = await browser.newPage();
    await installScope(page);
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.goto(WORKSHOP_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForFunction(() => location.pathname.endsWith('/notes-web.html')
      || [...document.querySelectorAll('iframe')].some(frame => /notes-web\.html/.test(frame.src)), { timeout: 30_000 });
    const hostFrame = page.frames().find(frame => {
      try {
        const url = new URL(frame.url());
        return url.pathname.endsWith('/notes-web.html') && (!frame.parentFrame() || frame.parentFrame() === page.mainFrame());
      } catch { return false; }
    });
    assert(hostFrame, 'Workshop notes-web host frame was not found');
    const card = await hostFrame.waitForSelector(`.react-flow__node[data-id="${CARD_ID}"]`, { timeout: 30_000 });
    assert(card, `Workshop card ${CARD_ID} was not found`);
    const cardProof = await card.evaluate(node => ({ id: node.getAttribute('data-id'), text: (node.innerText || '').trim().slice(0, 500) }));
    assert(cardProof.id === CARD_ID, 'Workshop focus resolved to another card');
    const embeddedFrame = await new Promise((resolve, reject) => {
      const until = Date.now() + 30_000;
      const scan = () => {
        const found = page.frames().find(frame => frameIsGame(frame, hostFrame));
        if (found) return resolve(found);
        if (Date.now() >= until) return reject(new Error('focused card did not open its game iframe'));
        setTimeout(scan, 150);
      };
      scan();
    });
    const frameTitles = await hostFrame.$$eval('iframe', elements => elements.map(el => ({ src: el.src, title: el.title, id: el.id })));
    const actualFrameTitle = frameTitles.find(row => {
      try { const u = new URL(row.src); return u.origin === new URL('https://workshop.colorc.cc/stronghold/resonance.html').origin && u.pathname === '/stronghold/resonance.html'; }
      catch { return false; }
    })?.title?.trim();
    assert(actualFrameTitle, 'the actual Workshop game iframe has an empty title');
    const embeddedUrl = new URL(embeddedFrame.url());
    embeddedUrl.searchParams.set('session', options.session);
    embeddedUrl.hash = 'section-shop';
    await embeddedFrame.evaluate(url => { location.href = url; }, embeddedUrl.href);
    await embeddedFrame.waitForFunction(({ session, hash }) => {
      const url = new URL(location.href);
      return url.searchParams.get('session') === session && url.hash === hash && document.readyState !== 'loading';
    }, { timeout: 45_000 }, { session: options.session, hash: '#section-shop' });
    await embeddedFrame.waitForFunction(() => document.querySelector('.rs-shopbar, .shopbar, #rs-section-shop') !== null, { timeout: 30_000 });
    if (await embeddedFrame.$('.rs-choice-full')) {
      const collapse = await embeddedFrame.$('.rs-choice-collapse');
      assert(collapse, 'choice overlay is open but has no local collapse control');
      await collapse.click();
      await embeddedFrame.waitForFunction(() => !document.querySelector('.rs-choice-full'), { timeout: 5_000 });
    }
    const gameProof = await embeddedFrame.evaluate(() => {
      const view = globalThis.__SP_VIEW__;
      const stats = view?.raw?.stats?.() || null;
      const title = document.querySelector('.rs-gmeta b')?.textContent?.trim() || document.title?.trim() || '';
      return { url: location.href, title, documentTitle: document.title, viewKind: view?.kind || null, engineUnits: stats?.units ?? null,
        shopVisible: !!document.querySelector('.rs-shopbar, .shopbar, #rs-section-shop'), choiceOpen: !!document.querySelector('.rs-choice-full') };
    });
    assert(new URL(gameProof.url).searchParams.get('session') === options.session && new URL(gameProof.url).hash === '#section-shop', 'embedded page lost exact session/hash');
    assert(gameProof.viewKind === 'engine' && Number(gameProof.engineUnits) > 0, `native engine units are not visible: ${JSON.stringify(gameProof)}`);
    assert(gameProof.title, 'real game UI title is empty');
    assert(gameProof.shopVisible && !gameProof.choiceOpen, 'shop section is not visible after local choice collapse');
    assert(requiredResourceFailures.length === 0, `required native resources returned errors: ${JSON.stringify(requiredResourceFailures)}`);
    await page.screenshot({ path: EMBED_SCREENSHOT, type: 'jpeg', quality: 90, fullPage: true });
    const fullscreen = await embeddedFrame.$('a.rs-fullscreen-small');
    assert(fullscreen, 'embedded game UI has no small fullscreen link');
    const expectedPopupUrl = await fullscreen.evaluate(el => el.href);
    const expected = new URL(expectedPopupUrl);
    assert(expected.searchParams.get('session') === options.session && expected.hash === '#section-shop', 'fullscreen href does not preserve the exact session/hash');
    const popupPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fullscreen link did not open a popup within 15 seconds')), 15_000);
      page.once('popup', popup => { clearTimeout(timer); resolve(popup); });
    });
    await fullscreen.click();
    const popup = await popupPromise;
    await installScope(popup);
    await popup.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await popup.waitForFunction(({ session, hash }) => {
      const url = new URL(location.href);
      return url.searchParams.get('session') === session && url.hash === hash && document.readyState !== 'loading';
    }, { timeout: 45_000 }, { session: options.session, hash: '#section-shop' });
    await popup.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 30_000 });
    const popupProof = await popup.evaluate(() => {
      const view = globalThis.__SP_VIEW__, stats = view?.raw?.stats?.() || null;
      return { url: location.href, title: document.querySelector('.rs-gmeta b')?.textContent?.trim() || document.title?.trim() || '',
        documentTitle: document.title, viewKind: view?.kind || null, engineUnits: stats?.units ?? null };
    });
    const popupUrl = new URL(popupProof.url);
    assert(popupUrl.searchParams.get('session') === options.session && popupUrl.hash === '#section-shop', 'fullscreen page lost exact session/hash');
    assert(popupProof.title && popupProof.viewKind === 'engine' && Number(popupProof.engineUnits) > 0, `fullscreen game is not a titled native engine scene: ${JSON.stringify(popupProof)}`);
    assert(requiredResourceFailures.length === 0, `required native resources returned errors: ${JSON.stringify(requiredResourceFailures)}`);
    assert(mutatingRequests.length === 0, `unexpected create/act/fight network requests: ${JSON.stringify(mutatingRequests)}`);
    await popup.screenshot({ path: FULLSCREEN_SCREENSHOT, type: 'jpeg', quality: 90, fullPage: true });
    evidence.status = 'passed';
    evidence.card = cardProof;
    evidence.iframeTitle = actualFrameTitle;
    evidence.embedded = gameProof;
    evidence.fullscreen = popupProof;
    log(`passed card=${CARD_ID} iframeTitle=${actualFrameTitle} session=${options.session} hash=#section-shop nativeUnits=${gameProof.engineUnits}/${popupProof.engineUnits}`);
    return evidence;
  })();
  const deadline = new Promise((_, reject) => {
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      void browser?.close().catch(() => {});
      reject(new Error('Workshop UI check exceeded 180-second deadline'));
    }, DEADLINE_MS);
  });
  try {
    const result = await Promise.race([work, deadline]);
    if (result.mutatingRequests.length) throw new Error(`mutation requests observed: ${JSON.stringify(result.mutatingRequests)}`);
    result.status = 'passed';
    writeFileSync(RECEIPT, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    log('receipt written; no session creation or gameplay mutation requests observed');
    writeLog();
    process.stdout.write(JSON.stringify({ status: result.status, receipt: RECEIPT, log: LOG, screenshots: result.screenshots }) + '\n');
  } catch (error) {
    evidence.status = timedOut ? 'timeout' : 'failed';
    evidence.error = error instanceof Error ? error.message : String(error);
    log(`${evidence.status}: ${evidence.error}`);
    if (!existsSync(RECEIPT)) writeFileSync(RECEIPT, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    writeLog();
    process.stderr.write(`${JSON.stringify({ status: evidence.status, receipt: RECEIPT, log: LOG, error: evidence.error })}\n`);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadlineTimer);
    await browser?.close().catch(() => {});
    for (const page of pages) await scopedPages.get(page)?.then(scope => scope.dispose()).catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  run().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
