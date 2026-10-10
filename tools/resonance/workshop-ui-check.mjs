#!/usr/bin/env node
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const WORKSHOP_URL = 'https://workshop.colorc.cc/bside/canvas/notes-web.html?theme=workshop&product_ref=spark-workshop&project=arknights&session_id=canvas%3Acanvas-0470c0a1&focus=resonance-play-20261009&fullscreen=1';
const CARD_ID = 'resonance-play-20261009';
const GAME_URL = 'https://workshop.colorc.cc/stronghold/resonance.html';
const LOCAL_GAME_PATH = '/stronghold/resonance/resonance.html';
const RESONANCE_WS_PATH = '/stronghold/resonance/resonance/ws';
const PROFILE = path.join(ROOT, '.omni/tmp/resonance/browser-profile');
const CONFIG = 'C:/Users/lilithgames/AppData/Roaming/wsh/config.json';
const WSH_CLI = process.env.WSH_CLI_PATH
  || 'E:/WindowsWorkspace/spark.workshop/releases/remote-play-card-20261004/wt/remote-play-card-20261004-5ba073215a31/workshop/cli/dist/wsh.mjs';
const DEFAULT_OUTPUTS = Object.freeze({
  verifyDir: path.join(ROOT, 'runtime/resonance/ui-verification'),
  receipt: path.join(ROOT, 'runtime/resonance/ui-verification/native-live-workshop-ui-receipt.json'),
  log: path.join(ROOT, '.omni/tmp/resonance/native-live-workshop-ui-check.log'),
  embedScreenshot: path.join(ROOT, 'runtime/resonance/ui-verification/native-live-workshop-embed.jpg'),
  fullscreenScreenshot: path.join(ROOT, 'runtime/resonance/ui-verification/native-live-workshop-fullscreen.jpg'),
});
let OUTPUTS = DEFAULT_OUTPUTS;
const DEADLINE_MS = 180_000;

function outputPaths(receiptTag) {
  if (receiptTag === undefined) return DEFAULT_OUTPUTS;
  if (receiptTag !== 'ui-refinement') throw new Error('--receipt-tag only accepts ui-refinement');
  const verifyDir = path.join(ROOT, 'runtime/resonance/ui-verification');
  return Object.freeze({
    verifyDir,
    receipt: path.join(verifyDir, 'ui-refinement-workshop-ui-receipt.json'),
    log: path.join(ROOT, '.omni/tmp/resonance/ui-refinement-workshop-ui-check.log'),
    embedScreenshot: path.join(verifyDir, 'ui-refinement-workshop-embed.jpg'),
    fullscreenScreenshot: path.join(verifyDir, 'ui-refinement-workshop-fullscreen.jpg'),
  });
}

function parseArgs(args) {
  const out = { selfTest: false, help: false, receiptTag: undefined };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--self-test') out.selfTest = true;
    else if (args[i] === '--help' || args[i] === '-h') out.help = true;
    else if (['--session', '--product-native', '--receipt-tag'].includes(args[i])) {
      const key = args[i].slice(2);
      const optionKey = key === 'receipt-tag' ? 'receiptTag' : key;
      const value = args[++i];
      if (!value || value.startsWith('--') || out[optionKey]) throw new Error(`missing or duplicate ${args[i - 1]}`);
      out[optionKey] = value;
    } else throw new Error(`unknown argument: ${args[i]}`);
  }
  outputPaths(out.receiptTag);
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

export function isExpectedResonanceSocketUrl(socketUrl, sessionId) {
  try {
    const socket = new URL(socketUrl), game = new URL(GAME_URL);
    const securePair = game.protocol === 'https:' && socket.protocol === 'wss:';
    const localPair = game.protocol === 'http:' && socket.protocol === 'ws:';
    return (securePair || localPair) && socket.host === game.host && socket.pathname === RESONANCE_WS_PATH
      && socket.searchParams.get('session') === sessionId;
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
  const defaultOutputs = outputPaths();
  if (defaultOutputs.receipt !== path.join(ROOT, 'runtime/resonance/ui-verification/native-live-workshop-ui-receipt.json')) throw new Error('default receipt path changed');
  const refinementOutputs = outputPaths('ui-refinement');
  const expectedRefinement = {
    receipt: path.join(ROOT, 'runtime/resonance/ui-verification/ui-refinement-workshop-ui-receipt.json'),
    log: path.join(ROOT, '.omni/tmp/resonance/ui-refinement-workshop-ui-check.log'),
    embedScreenshot: path.join(ROOT, 'runtime/resonance/ui-verification/ui-refinement-workshop-embed.jpg'),
    fullscreenScreenshot: path.join(ROOT, 'runtime/resonance/ui-verification/ui-refinement-workshop-fullscreen.jpg'),
  };
  for (const [key, value] of Object.entries(expectedRefinement)) if (refinementOutputs[key] !== value) throw new Error(`tagged output path mismatch: ${key}`);
  let rejectedTag = false;
  try { outputPaths('other'); } catch { rejectedTag = true; }
  if (!rejectedTag) throw new Error('unknown receipt tag was accepted');
  const target = 'https://workshop.colorc.cc/bside/canvas/notes-web.html';
  for (const url of [target, 'https://workshop.colorc.cc/bside/api/canvases/id', 'https://workshop.colorc.cc/bside/lofa/invoke']) {
    if (!isScopedWorkshopBearerUrl(url, target)) throw new Error(`Workshop route was not scoped: ${new URL(url).pathname}`);
  }
  for (const url of ['https://workshop.colorc.cc/stronghold/resonance.html', 'https://workshop.colorc.cc/resonance/api/sessions/id',
    'https://workshop.colorc.cc/stronghold/resonance/api/sessions/id', 'wss://workshop.colorc.cc/stronghold/resonance/ws?session=01234567-89ab-4def-8123-456789abcdef',
    'https://cdn.example/js/game.js']) {
    if (isScopedWorkshopBearerUrl(url, target)) throw new Error(`non-Workshop route received bearer scope: ${new URL(url).origin}${new URL(url).pathname}`);
  }
  const sid = '01234567-89ab-4def-8123-456789abcdef';
  if (!isExpectedResonanceSocketUrl(`wss://workshop.colorc.cc${RESONANCE_WS_PATH}?session=${sid}`, sid)) throw new Error('native live WebSocket route was not recognized');
  if (isExpectedResonanceSocketUrl(`wss://workshop.colorc.cc${RESONANCE_WS_PATH}?session=${sid}`, `${sid.slice(0, -1)}0`)
    || isExpectedResonanceSocketUrl(`wss://workshop.colorc.cc/stronghold/resonance/ws?session=${sid}`, sid)) throw new Error('native live WebSocket scope accepted a wrong session or route');
  const pageToken = {};
  if (observerPage({ page: () => pageToken }) !== pageToken || observerPage(pageToken) !== pageToken) throw new Error('Puppeteer Frame/Page observer mapping failed');
  const cdpWire = JSON.stringify({ t: 'g.infoReady' });
  if (cdpTextFramePayload({ response: { opcode: 1, payloadData: cdpWire } }) !== cdpWire
    || cdpTextFramePayload({ response: { opcode: 2, payloadData: cdpWire } }) !== null
    || cdpTextFramePayload({ request: { opcode: 1, payloadData: cdpWire } }) !== null) {
    throw new Error('CDP WebSocket sent/received frame payload contract failed');
  }
  for (const pathname of ['/stronghold/resonance/api/sessions', '/stronghold/resonance/api/sessions/id/actions', '/stronghold/resonance/resonance/api/sessions/id/actions', '/resonance/api/fight']) {
    if (!isGameApiPath(pathname) || !isForbiddenMutation('POST', pathname)) throw new Error(`mutation audit missed ${pathname}`);
  }
  for (const pathname of ['/resonance/api/admission', '/stronghold/resonance/api/admission', '/stronghold/resonance/resonance/api/admission']) {
    for (const method of ['POST', 'DELETE']) {
      if (!isGameApiPath(pathname) || isForbiddenMutation(method, pathname)) throw new Error(`native admission permission request was blocked: ${method} ${pathname}`);
    }
    if (!isForbiddenMutation('PATCH', pathname) || !isForbiddenMutation('PUT', pathname)) throw new Error(`non-permission admission mutation was allowed: ${pathname}`);
  }
  for (const [method, pathname] of [['POST', '/stronghold/resonance/resonance/api/admission/extra'], ['POST', '/resonance/api/admissions'],
    ['DELETE', '/resonance/api/sessions/id'], ['POST', '/resonance/api/sessions']]) {
    if (!isForbiddenMutation(method, pathname)) throw new Error(`non-admission gameplay mutation was allowed: ${method} ${pathname}`);
  }
  if (isForbiddenMutation('GET', '/stronghold/resonance/api/sessions/id')) throw new Error('read-only session GET was misclassified as a mutation');
  if (!isForbiddenMutation('PATCH', '/stronghold/resonance/api/sessions/id')) throw new Error('non-POST gameplay mutation was not blocked');
  const valid = parseArgs(['--session', '01234567-89ab-4def-8123-456789abcdef', '--product-native', 'a'.repeat(40)]);
  if (valid.session !== '01234567-89ab-4def-8123-456789abcdef') throw new Error('CLI self-test failed');
  if (parseArgs(['--receipt-tag', 'ui-refinement', '--help']).receiptTag !== 'ui-refinement') throw new Error('receipt tag parsing failed');
  let rejectedCliTag = false;
  try { parseArgs(['--receipt-tag', 'other', '--help']); } catch { rejectedCliTag = true; }
  if (!rejectedCliTag) throw new Error('unknown CLI receipt tag was accepted');
  process.stdout.write(JSON.stringify({ ok: true, workshopOnlyBearerScope: true, sessionReadonly: true }) + '\n');
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function isGameApiPath(pathname) { return /(?:^|\/)resonance\/api(?:\/|$)/.test(pathname); }
const ADMISSION_PATHS = new Set([
  '/resonance/api/admission',
  '/stronghold/resonance/api/admission',
  '/stronghold/resonance/resonance/api/admission',
]);
function isForbiddenMutation(method, pathname) {
  const verb = String(method).toUpperCase();
  if (!isGameApiPath(pathname) || verb === 'GET' || verb === 'HEAD') return false;
  if ((verb === 'POST' || verb === 'DELETE') && ADMISSION_PATHS.has(pathname)) return false;
  return true;
}
function frameIsGame(frame, hostFrame) {
  if (frame === hostFrame) return false;
  let parent = frame.parentFrame();
  while (parent && parent !== hostFrame) parent = parent.parentFrame();
  if (parent !== hostFrame) return false;
  try { const url = new URL(frame.url()); return url.origin === new URL(GAME_URL).origin && [new URL(GAME_URL).pathname, LOCAL_GAME_PATH].includes(url.pathname); }
  catch { return false; }
}
function observerPage(pageOrFrame) {
  return typeof pageOrFrame?.page === 'function' ? pageOrFrame.page() : pageOrFrame;
}

// CDP Network.WebSocketFrame events use `response` for both sent and received frames.
// This is a WebSocket frame payload wrapper, not an HTTP request/response object.
export function cdpTextFramePayload(event) {
  const frame = event?.response;
  return frame?.opcode === 1 && typeof frame.payloadData === 'string' ? frame.payloadData : null;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  OUTPUTS = outputPaths(options.receiptTag);
  if (options.help) {
    process.stdout.write('用法：node tools/resonance/workshop-ui-check.mjs --session <persisted-uuid> --product-native <full-git-commit> [--receipt-tag ui-refinement]\n       node tools/resonance/workshop-ui-check.mjs --self-test\n仅允许的receipt tag：ui-refinement（不带tag时沿用既有输出路径）。\n');
    return;
  }
  if (options.selfTest) return selfTest();
  let priorReceipt = null;
  if (existsSync(OUTPUTS.receipt)) {
    priorReceipt = JSON.parse(readFileSync(OUTPUTS.receipt, 'utf8'));
    if (priorReceipt.status !== 'failed' || priorReceipt.sessionId !== options.session
      || priorReceipt.productNative !== options['product-native'] || typeof priorReceipt.error !== 'string' || !priorReceipt.error.trim()) {
      throw new Error(`refusing to overwrite unrelated receipt: ${OUTPUTS.receipt}`);
    }
  }
  if (existsSync(OUTPUTS.log) && (!priorReceipt || !readFileSync(OUTPUTS.log, 'utf8').includes(priorReceipt.error))) {
    throw new Error(`refusing to append to unrelated log: ${OUTPUTS.log}`);
  }
  for (const output of [OUTPUTS.receipt, OUTPUTS.log, OUTPUTS.embedScreenshot, OUTPUTS.fullscreenScreenshot]) {
    if (output === OUTPUTS.receipt || output === OUTPUTS.log) continue;
    if (existsSync(output) && (!priorReceipt || !priorReceipt.screenshots?.includes(output))) throw new Error(`refusing to overwrite existing output: ${output}`);
  }
  const logLines = [];
  const log = message => logLines.push(`${new Date().toISOString()} ${message}`);
  let currentStage = 'startup';
  const stageHistory = [];
  const setStage = name => {
    currentStage = name;
    if (stageHistory.at(-1) !== name && stageHistory.length < 32) stageHistory.push(name);
    log(`stage=${name}`);
  };
  const writeLog = () => {
    const content = `${logLines.join('\n')}\n`;
    if (existsSync(OUTPUTS.log)) appendFileSync(OUTPUTS.log, content);
    else writeFileSync(OUTPUTS.log, content, { flag: 'wx' });
  };
  const priorAttempts = [...(priorReceipt?.priorAttempts || []), ...(priorReceipt ? [{ status: priorReceipt.status, error: priorReceipt.error }] : [])];
  const writeReceipt = receipt => writeFileSync(OUTPUTS.receipt, `${JSON.stringify({ ...receipt, ...(priorAttempts.length ? { priorAttempts } : {}) }, null, 2)}\n`, { flag: priorReceipt ? 'w' : 'wx' });
  let browser;
  let deadlineTimer;
  let timedOut = false;
  const mutatingRequests = [];
  const requestRows = [];
  const requiredResourceFailures = [];
  const unexpectedHtmlResponses = [];
  const browserErrors = [];
  const networkFailures = [];
  const scopedPages = new WeakMap();
  const websocketPages = new WeakMap();
  const briefingClicks = [];
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
      const cdp = await page.target().createCDPSession();
      await cdp.send('Network.enable');
      const websocketObservation = { sockets: [], messages: [], sentTypes: [], failures: [] };
      const websocketRequestIds = new Set();
      cdp.on('Network.webSocketCreated', event => {
        let url;
        try { url = new URL(event.url); } catch { return; }
        const sessionMatches = url.searchParams.get('session') === options.session;
        const native = isExpectedResonanceSocketUrl(event.url, options.session);
        websocketObservation.sockets.push({ origin: url.origin, path: url.pathname, sessionMatches, native });
        if (native) websocketRequestIds.add(event.requestId);
      });
      cdp.on('Network.webSocketFrameReceived', event => {
        if (!websocketRequestIds.has(event.requestId)) return;
        const payload = cdpTextFramePayload(event);
        if (payload === null) return;
        let message;
        try { message = JSON.parse(payload); } catch { return; }
        const row = { type: message.t };
        if (message.t === 'welcome') {
          row.playerId = message.playerId ?? null;
          row.tokenMatchesSession = message.token === options.session;
        } else if (message.t === 'r.catalog') {
          row.activeOperatorCount = Array.isArray(message.catalog?.activeOperatorIds) ? message.catalog.activeOperatorIds.length : null;
          row.schemaVersion = message.catalog?.schemaVersion ?? null;
        } else if (message.t === 'm.public') {
          row.phase = message.phase ?? null;
          row.round = message.round ?? null;
          row.combatMode = message.combatMode ?? null;
        } else if (message.t === 'm.private') {
          const state = message.resonance?.state;
          row.phase = message.phase ?? null;
          row.statePhase = state?.phase ?? null;
          row.rulesVersion = state?.rulesVersion ?? null;
          row.activeOperatorCount = Array.isArray(state?.activeOperatorIds) ? state.activeOperatorIds.length : null;
        }
        websocketObservation.messages.push(row);
      });
      cdp.on('Network.webSocketFrameSent', event => {
        if (!websocketRequestIds.has(event.requestId)) return;
        const payload = cdpTextFramePayload(event);
        if (payload === null) return;
        try {
          const message = JSON.parse(payload);
          websocketObservation.sentTypes.push(typeof message.t === 'string' ? message.t : 'unknown');
        } catch { websocketObservation.sentTypes.push('unparseable'); }
      });
      cdp.on('Network.webSocketFrameError', event => {
        websocketObservation.failures.push({ error: String(event.errorMessage || 'WebSocket frame error').slice(0, 240) });
      });
      websocketPages.set(page, { cdp, observation: websocketObservation });
      await page.setRequestInterception(true);
      const handler = request => {
        let parsed;
        try { parsed = new URL(request.url()); } catch { parsed = null; }
        const pathName = parsed?.pathname || '';
        const method = request.method();
        if (parsed && isGameApiPath(pathName)) {
          requestRows.push({ method, origin: parsed.origin, path: pathName });
          if (isForbiddenMutation(method, pathName)) {
            mutatingRequests.push({ method, origin: parsed.origin, path: pathName });
            void request.abort('blockedbyclient').catch(() => {});
            return;
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
        if (response.status() >= 400) networkFailures.push({ status: response.status(), origin: url.origin, path: url.pathname });
        if (['/css/screens/draft.css', '/css/screens/title.css', '/css/screens/briefing.css', '/css/screens/lobby.css', '/js/net.js'].includes(url.pathname)
          && response.status() >= 400) requiredResourceFailures.push({ status: response.status(), path: url.pathname });
        const headers = response.headers();
        const contentType = String(headers['content-type'] || '').slice(0, 120);
        const resourceType = response.request().resourceType();
        const expectsCodeOrJson = resourceType === 'script' || /\.(?:m?js|json)$/i.test(url.pathname)
          || (isGameApiPath(url.pathname) && ['xhr', 'fetch'].includes(resourceType));
        if (response.status() === 200 && expectsCodeOrJson && /(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
          const row = { status: 200, origin: url.origin, path: url.pathname, contentType, resourceType };
          if (unexpectedHtmlResponses.length < 20) unexpectedHtmlResponses.push(row);
          if (networkFailures.length < 100) networkFailures.push({ ...row, error: 'expected JavaScript/JSON response but received HTML' });
        }
      });
      page.on('requestfailed', request => {
        let url;
        try { url = new URL(request.url()); } catch { return; }
        networkFailures.push({ error: request.failure()?.errorText || 'request failed', origin: url.origin, path: url.pathname });
      });
      page.on('pageerror', error => {
        const message = String(error?.message || error).slice(0, 400);
        const stack = String(error?.stack || '').slice(0, 1600);
        const detail = `pageerror: ${message}${stack ? `\n${stack}` : ''}`;
        browserErrors.push(detail);
        log(detail.replace(/\r?\n/g, ' | '));
      });
      page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text().slice(0, 400)}`); });
      pages.add(page);
      return { dispose: async () => {
        page.off('request', handler);
        await page.setRequestInterception(false).catch(() => {});
        await cdp.detach().catch(() => {});
      } };
    })();
    scopedPages.set(page, ready);
    return ready;
  };
  const nativePrepProof = page => {
    // This checker ends at Native PREP. The authoritative b.start / COMBAT proof belongs to the full-flow checker.
    const observation = websocketPages.get(observerPage(page))?.observation;
    if (!observation) return { ok: false, reason: 'CDP WebSocket observation is unavailable' };
    const socket = observation.sockets.find(row => row.native);
    const welcome = observation.messages.find(row => row.type === 'welcome' && row.playerId === 'resonance' && row.tokenMatchesSession);
    const catalog = observation.messages.find(row => row.type === 'r.catalog' && row.activeOperatorCount === 60);
    const publicPrep = observation.messages.find(row => row.type === 'm.public' && row.phase === 'PREP');
    const privatePrep = observation.messages.find(row => row.type === 'm.private' && row.phase === 'PREP'
      && row.statePhase === 'prep' && row.rulesVersion === 3 && row.activeOperatorCount === 60);
    return { ok: !!(socket && welcome && catalog && publicPrep && privatePrep && observation.failures.length === 0),
      socket, welcome, catalog, publicPrep, privatePrep, failures: observation.failures };
  };
  const nativeConnectionProof = page => {
    const observation = websocketPages.get(observerPage(page))?.observation;
    if (!observation) return { ok: false, reason: 'CDP WebSocket observation is unavailable' };
    const socket = observation.sockets.find(row => row.native);
    const welcome = observation.messages.find(row => row.type === 'welcome' && row.playerId === 'resonance' && row.tokenMatchesSession);
    const catalog = observation.messages.find(row => row.type === 'r.catalog' && row.activeOperatorCount === 60);
    const publicState = [...observation.messages].reverse().find(row => row.type === 'm.public');
    const privateState = [...observation.messages].reverse().find(row => row.type === 'm.private');
    const privateCatalog = privateState?.rulesVersion === 3 && privateState?.activeOperatorCount === 60;
    return { ok: !!(socket && welcome && catalog && publicState && privateState && privateCatalog && observation.failures.length === 0),
      socket, welcome, catalog, publicState, privateState, sentTypes: [...observation.sentTypes], failures: observation.failures };
  };
  const waitForNativePrep = async page => {
    const until = Date.now() + 30_000;
    let proof = nativePrepProof(page);
    while (!proof.ok && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 100));
      proof = nativePrepProof(page);
    }
    assert(proof.ok, `native PREP WebSocket proof is incomplete: ${JSON.stringify(proof)}`);
    return proof;
  };
  const enterReadonlyPrep = async (page, { allowBriefingAck = false } = {}) => {
    const connectedUntil = Date.now() + 30_000;
    let connection = nativeConnectionProof(page);
    while (!connection.ok && Date.now() < connectedUntil) {
      await new Promise(resolve => setTimeout(resolve, 100));
      connection = nativeConnectionProof(page);
    }
    assert(connection.ok, `native WebSocket welcome/catalog/state proof is incomplete: ${JSON.stringify(connection)}`);
    if (connection.publicState.phase === 'INFO_CHECK') {
      assert(allowBriefingAck, 'fullscreen reconnect unexpectedly returned to INFO_CHECK');
      setStage('native-info-check-ack');
      const ready = await page.waitForSelector('.brief__foot > button.btn--xl', { visible: true, timeout: 15_000 });
      assert(ready, 'Native INFO_CHECK ready button was not visible');
      const clickProof = await ready.evaluate(button => {
        const text = String(button.innerText || button.textContent || '').replace(/\s+/g, ' ').trim();
        const rect = button.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { text, x: Math.round(x), y: Math.round(y), centerHit: !!hit && (hit === button || button.contains(hit)),
          hitTag: hit?.tagName?.toLowerCase() || null, hitClass: typeof hit?.className === 'string' ? hit.className.slice(0, 120) : null,
          disabled: !!button.disabled };
      });
      assert(['准备就绪', '进入战场'].includes(clickProof.text), `Native INFO_CHECK ready button text is unexpected: ${JSON.stringify(clickProof)}`);
      assert(clickProof.centerHit && !clickProof.disabled, `Native INFO_CHECK ready button center is not a usable hit target: ${JSON.stringify(clickProof)}`);
      briefingClicks.push(clickProof);
      await ready.click();
      const sentUntil = Date.now() + 5_000;
      const observation = websocketPages.get(observerPage(page))?.observation;
      while (!(observation?.sentTypes.includes('g.infoReady')) && Date.now() < sentUntil) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const infoReadyCount = observation?.sentTypes.filter(type => type === 'g.infoReady').length ?? 0;
      assert(infoReadyCount === 1, `Native ready click must send exactly one g.infoReady, got ${infoReadyCount}`);
    } else {
      assert(connection.publicState.phase === 'PREP', `session is not in Native PREP: ${connection.publicState.phase}`);
    }
    setStage('native-prep-proof');
    return waitForNativePrep(page);
  };
  const evidence = { status: 'running', sessionId: options.session, productNative: options['product-native'], workshopUrl: WORKSHOP_URL,
    cardId: CARD_ID, screenshots: [OUTPUTS.embedScreenshot, OUTPUTS.fullscreenScreenshot], requestRows, mutatingRequests,
    requiredResourceFailures, unexpectedHtmlResponses, browserErrors, networkFailures, stageHistory, briefingClicks };
  const work = (async () => {
    setStage('browser-launch');
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
    setStage('workshop-navigation');
    await page.goto(WORKSHOP_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    setStage('workshop-host-ready');
    await page.waitForFunction(() => location.pathname.endsWith('/notes-web.html')
      || [...document.querySelectorAll('iframe')].some(frame => /notes-web\.html/.test(frame.src)), { timeout: 30_000 });
    const hostFrame = page.frames().find(frame => {
      try {
        const url = new URL(frame.url());
        return url.pathname.endsWith('/notes-web.html') && (!frame.parentFrame() || frame.parentFrame() === page.mainFrame());
      } catch { return false; }
    });
    assert(hostFrame, 'Workshop notes-web host frame was not found');
    setStage('workshop-card-ready');
    const card = await hostFrame.waitForSelector(`.react-flow__node[data-id="${CARD_ID}"]`, { timeout: 30_000 });
    assert(card, `Workshop card ${CARD_ID} was not found`);
    const cardProof = await card.evaluate(node => ({ id: node.getAttribute('data-id'), text: (node.innerText || '').trim().slice(0, 500) }));
    assert(cardProof.id === CARD_ID, 'Workshop focus resolved to another card');
    setStage('embedded-frame-ready');
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
    setStage('embedded-initial-title-ready');
    await embeddedFrame.waitForFunction(() => document.readyState === 'complete'
      && !!document.querySelector('.rs-entry .title-screen .title-cn')
      && !!document.querySelector('.rs-entry .title-screen .title-login'), { timeout: 30_000 });
    const frameTitles = await hostFrame.$$eval('iframe', elements => elements.map(el => ({ src: el.src, title: el.title, id: el.id })));
    const actualFrameTitle = frameTitles.find(row => {
      try { const u = new URL(row.src); return u.origin === new URL('https://workshop.colorc.cc/stronghold/resonance.html').origin && u.pathname === '/stronghold/resonance.html'; }
      catch { return false; }
    })?.title?.trim();
    assert(actualFrameTitle, 'the actual Workshop game iframe has an empty title');
    setStage('embedded-session-navigation');
    const embeddedUrl = new URL(embeddedFrame.url());
    embeddedUrl.searchParams.set('session', options.session);
    embeddedUrl.hash = 'section-shop';
    await embeddedFrame.evaluate(url => { location.href = url; }, embeddedUrl.href);
    await embeddedFrame.waitForFunction(({ session, hash }) => {
      const url = new URL(location.href);
      return url.searchParams.get('session') === session && url.hash === hash && document.readyState !== 'loading';
    }, { timeout: 45_000 }, { session: options.session, hash: '#section-shop' });
    setStage('embedded-native-info-ack-and-prep');
    const embeddedWsProof = await enterReadonlyPrep(embeddedFrame, { allowBriefingAck: true });
    if (await embeddedFrame.$('.rs-native-choice')) {
      const collapse = await embeddedFrame.$('.rs-native-choice__later');
      assert(collapse, 'native choice overlay is open but has no local defer control');
      await collapse.click();
      await embeddedFrame.waitForFunction(() => !document.querySelector('.rs-native-choice') && !!document.querySelector('.rs-native-choice-tab'), { timeout: 5_000 });
    }
    setStage('embedded-native-engine-ready');
    await embeddedFrame.waitForFunction(() => {
      const view = globalThis.__SP_VIEW__;
      return view?.kind === 'engine' || view?.kind === 'fallback';
    }, { timeout: 45_000 });
    await embeddedFrame.waitForFunction(() => {
      const view = globalThis.__SP_VIEW__;
      return view?.kind !== 'engine' || Number(view.raw?.stats?.()?.units) > 0;
    }, { timeout: 15_000 });
    setStage('embedded-shop-ready');
    await embeddedFrame.waitForFunction(() => document.querySelector('.rs-native-match .shopbar, .rs-native-match .shopbar-tab, #rs-section-shop') !== null, { timeout: 30_000 });
    const gameProof = await embeddedFrame.evaluate(() => {
      const view = globalThis.__SP_VIEW__;
      const stats = view?.raw?.stats?.() || null;
      const title = document.querySelector('.rs-gmeta b')?.textContent?.trim() || document.title?.trim() || '';
      return { url: location.href, title, documentTitle: document.title, viewKind: view?.kind || null, engineUnits: stats?.units ?? null,
        shopVisible: !!document.querySelector('.rs-native-match .shopbar, .rs-native-match .shopbar-tab, #rs-section-shop'),
        choiceOpen: !!document.querySelector('.rs-native-choice'), choiceCollapsed: !!document.querySelector('.rs-native-choice-tab') };
    });
    assert(new URL(gameProof.url).searchParams.get('session') === options.session && new URL(gameProof.url).hash === '#section-shop', 'embedded page lost exact session/hash');
    assert(gameProof.viewKind === 'engine' && Number(gameProof.engineUnits) > 0, `native engine units are not visible: ${JSON.stringify(gameProof)}`);
    assert(gameProof.title, 'real game UI title is empty');
    assert(gameProof.shopVisible && !gameProof.choiceOpen, 'shop section is not visible after local choice collapse');
    assert(requiredResourceFailures.length === 0, `required native resources returned errors: ${JSON.stringify(requiredResourceFailures)}`);
    await page.screenshot({ path: OUTPUTS.embedScreenshot, type: 'jpeg', quality: 90, fullPage: true });
    const fullscreen = await embeddedFrame.$('a.rs-fullscreen-small');
    assert(fullscreen, 'embedded game UI has no small fullscreen link');
    const expectedPopupUrl = await fullscreen.evaluate(el => el.href);
    const expected = new URL(expectedPopupUrl);
    assert(expected.searchParams.get('session') === options.session && expected.hash === '#section-shop', 'fullscreen href does not preserve the exact session/hash');
    setStage('fullscreen-popup-open');
    const popupPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fullscreen link did not open a popup within 15 seconds')), 15_000);
      page.once('popup', popup => { clearTimeout(timer); resolve(popup); });
    });
    await fullscreen.click();
    const popup = await popupPromise;
    await installScope(popup);
    await popup.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    setStage('fullscreen-session-navigation');
    await popup.waitForFunction(({ session, hash }) => {
      const url = new URL(location.href);
      return url.searchParams.get('session') === session && url.hash === hash && document.readyState !== 'loading';
    }, { timeout: 45_000 }, { session: options.session, hash: '#section-shop' });
    setStage('fullscreen-native-prep-proof');
    const popupWsProof = await enterReadonlyPrep(popup);
    setStage('fullscreen-native-engine-ready');
    await popup.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 30_000 });
    try {
      await popup.waitForFunction(() => {
        const view = globalThis.__SP_VIEW__;
        return view?.kind === 'engine' && Number(view.raw?.stats?.()?.units) > 0;
      }, { timeout: 15_000 });
    } catch {
      await popup.screenshot({ path: OUTPUTS.fullscreenScreenshot, type: 'jpeg', quality: 90, fullPage: true }).catch(() => {});
      const diagnostic = await popup.evaluate(() => {
        const view = globalThis.__SP_VIEW__, stats = view?.raw?.stats?.() || null;
        return { url: location.href, title: document.title, viewKind: view?.kind || null, engineUnits: stats?.units ?? null,
          fieldHost: !!document.querySelector('.gm__field'), shop: !!document.querySelector('.shopbar'), body: document.body?.innerText?.slice(0, 300) };
      }).catch(error => ({ error: error.message }));
      throw new Error(`fullscreen native engine did not expose units after 15 seconds: ${JSON.stringify(diagnostic)}`);
    }
    setStage('fullscreen-proof');
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
    assert(browserErrors.length === 0, `pageerror/console errors were observed: ${JSON.stringify(browserErrors)}`);
    assert(networkFailures.length === 0, `network failures or HTTP errors were observed: ${JSON.stringify(networkFailures)}`);
    const sentTypes = [...(websocketPages.get(observerPage(embeddedFrame))?.observation.sentTypes ?? []), ...(websocketPages.get(popup)?.observation.sentTypes ?? [])];
    const allowedReadonlyTypes = new Set(['hello', 'ping', 'g.infoReady', 'g.unitStats']);
    const unexpectedWsActions = sentTypes.filter(type => !allowedReadonlyTypes.has(type));
    assert(unexpectedWsActions.length === 0, `unexpected native WebSocket gameplay actions: ${JSON.stringify(unexpectedWsActions)}`);
    assert(sentTypes.filter(type => type === 'g.infoReady').length <= 1, 'briefing was acknowledged more than once');
    await popup.screenshot({ path: OUTPUTS.fullscreenScreenshot, type: 'jpeg', quality: 90, fullPage: true });
    evidence.status = 'passed';
    evidence.card = cardProof;
    evidence.iframeTitle = actualFrameTitle;
    evidence.embedded = gameProof;
    evidence.embeddedNativeWebSocket = embeddedWsProof;
    evidence.fullscreen = popupProof;
    evidence.fullscreenNativeWebSocket = popupWsProof;
    evidence.nativeWebSocketClientMessageTypes = sentTypes;
    evidence.completedAtStage = currentStage;
    log(`passed card=${CARD_ID} iframeTitle=${actualFrameTitle} session=${options.session} hash=#section-shop nativeUnits=${gameProof.engineUnits}/${popupProof.engineUnits} ws=welcome,catalog,public-PREP,private-PREP`);
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
    writeReceipt(result);
    log('receipt written; no session creation or gameplay mutation requests observed');
    writeLog();
    process.stdout.write(JSON.stringify({ status: result.status, receipt: OUTPUTS.receipt, log: OUTPUTS.log, screenshots: result.screenshots }) + '\n');
  } catch (error) {
    evidence.status = timedOut ? 'timeout' : 'failed';
    evidence.error = error instanceof Error ? error.message : String(error);
    evidence.failedAtStage = currentStage;
    log(`${evidence.status} stage=${currentStage}: ${evidence.error}`);
    writeReceipt(evidence);
    writeLog();
    process.stderr.write(`${JSON.stringify({ status: evidence.status, receipt: OUTPUTS.receipt, log: OUTPUTS.log, error: evidence.error })}\n`);
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
