import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NATIVE = '62eb113419123d9a3a63606107bbf85230c5dd2f';
const CANON = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const WORKTREE = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/resonance/stronghold-protocol';
const PROFILE = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/resonance/browser-profile';
const EVIDENCE = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/resonance/ui-reference';
const CHROME = process.env.SP_CHROME_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MAX_RUNTIME_MS = 7 * 60 * 1000;
const MAX_SHOTS = 6;
const MAX_SHOT_BYTES = 3 * 1024 * 1024;
const STARTED_AT = new Date().toISOString();
const RUN_ID = STARTED_AT.replace(/[^0-9TZ]/g, '');
const RUN_EVIDENCE = path.join(EVIDENCE, 'run-' + RUN_ID);
const SCRIPT_FILE = fileURLToPath(import.meta.url);
const require = createRequire(path.join(CANON, 'package.json'));
const puppeteer = require('puppeteer-core');

const phases = [
  { name: 'INFO_CHECK', query: 'phase=INFO_CHECK', selectors: ['.brief'], text: ['敌方领袖', '确认本局信息'] },
  { name: 'BAND_DRAFT', query: 'phase=BAND_DRAFT', selectors: ['.draft', '.draft-grid', '.draft-detail'], text: ['确认选择'] },
  { name: 'PREP', query: 'phase=PREP', selectors: ['.gm', '.gm__field', '.shopbar'], text: ['刷新'] },
  { name: 'SP_DRAFT_SUPPLY', query: 'phase=SP_DRAFT&variant=supply', selectors: ['.gm', '.spov__inner'], text: ['道具补给'] },
];
const blobCache = new Map();
const errors = [];
const blockedExternal = [];
const missingRoutes = [];
const phaseResults = [];
let screenshotBytes = 0;
let server;
let browser;
let page;
let timer;
let timedOut = false;
const warnings = [];
let servedBytes = 0;
let priorScreenshotBytes = 0;
let priorScreenshotCount = 0;
let requestCount = 0;

function inside(root, candidate) {

  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertBelowAbsolute(root, target, label) {
  if (!path.isAbsolute(root) || !path.isAbsolute(target)) throw new Error(`${label} must be an absolute path`);
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved === base || !inside(base, resolved)) throw new Error(`${label} escaped its authorized root: ${resolved}`);
  let cursor = base;
  for (const part of path.relative(base, resolved).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    const st = fs.lstatSync(cursor);
    if (st.isSymbolicLink()) throw new Error(`${label} traverses a reparse/symlink path: ${cursor}`);
  }
  return resolved;
}

function assertRepoRoot(repoPath, expected) {
  const actual = execFileSync('git', ['-C', repoPath, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true }).trim();
  if (path.resolve(actual).toLowerCase() !== path.resolve(expected).toLowerCase()) throw new Error(`Git root mismatch for ${repoPath}: ${actual}`);
}

function assertWriteBoundaries() {
  assertRepoRoot(CANON, CANON);
  assertRepoRoot(WORKTREE, WORKTREE);
  assertBelowAbsolute(CANON, WORKTREE, 'worktree');
  assertBelowAbsolute(CANON, PROFILE, 'browser profile');
  assertBelowAbsolute(CANON, EVIDENCE, 'evidence directory');
  assertBelowAbsolute(path.join(WORKTREE, 'tools', 'resonance'), SCRIPT_FILE, 'preview script');
  for (const root of ['assets', 'fonts', 'vendor']) {
    const canonicalStatic = path.join(CANON, 'public', root);
    if (!fs.statSync(canonicalStatic).isDirectory() || fs.lstatSync(canonicalStatic).isSymbolicLink()) throw new Error(`Canonical static root is missing or linked: ${canonicalStatic}`);
  }
  execFileSync('git', ['-C', CANON, 'cat-file', '-e', NATIVE + '^{commit}'], { stdio: 'ignore', windowsHide: true });
}


function listScreenshots(root) {
  let count = 0, bytes = 0;
  if (!fs.existsSync(root)) return { count, bytes };
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Evidence tree contains an unchecked link: ${full}`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && /\\.jpe?g$/i.test(entry.name)) { count++; bytes += fs.statSync(full).size; }
    }
  };
  visit(root);
  return { count, bytes };
}

function gitBlob(rel) {
  if (blobCache.has(rel)) return blobCache.get(rel);
  const out = execFileSync('git', ['-C', CANON, 'show', NATIVE + ':' + rel], { maxBuffer: 128 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  blobCache.set(rel, out);
  return out;
}

function routeToBlob(urlPath) {
  const p = urlPath.replace(/^\/+/, '');
  if (p.startsWith('dev/')) return `public/${p}`;
  if (p === 'data.js') return 'public/js/data.js';
  if (p.startsWith('js/') || p.startsWith('css/')) return `public/${p}`;
  if (p.startsWith('shared/') || p.startsWith('server/')) return p;
  if (p.startsWith('sim/')) return 'server/' + p;
  if (p.startsWith('data/')) return p;
  if (p === 'robots.txt') return 'public/robots.txt';
  return null;
}

function physicalFile(urlPath) {
  const p = urlPath.replace(/^\/+/, '');
  const rules = [
    ['assets/', path.join(CANON, 'public', 'assets')],
    ['fonts/', path.join(CANON, 'public', 'fonts')],
    ['vendor/', path.join(CANON, 'public', 'vendor')],
  ];
  for (const [prefix, root] of rules) {
    if (!p.startsWith(prefix)) continue;
    const rel = p.slice(prefix.length).replaceAll('/', path.sep);
    const target = path.resolve(root, rel);
    if (!inside(root, target)) throw new Error('Physical asset path escaped its canonical root');
    return target;
  }
  return null;
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' })[ext] || 'application/octet-stream';
}

function makeServer() {
  return createServer(async (req, res) => {
    requestCount++;
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
    catch { res.writeHead(400).end('bad path'); return; }
    try {
      const blobPath = routeToBlob(pathname);
      if (blobPath) {
        let bytes;
        try { bytes = gitBlob(blobPath); }
        catch (e) { missingRoutes.push({ path: pathname, reason: 'not in selected Git revision' }); res.writeHead(404).end('not in selected revision'); return; }
        servedBytes += bytes.length;
        res.writeHead(200, { 'content-type': mime(blobPath), 'content-length': bytes.length, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
        res.end(req.method === 'HEAD' ? undefined : bytes);
        return;
      }
      const target = physicalFile(pathname);
      if (target) {
        let st;
        try { st = await fs.promises.lstat(target); }
        catch { missingRoutes.push({ path: pathname, reason: 'canonical file missing' }); res.writeHead(404).end('canonical file missing'); return; }
        if (!st.isFile() || st.isSymbolicLink()) { res.writeHead(403).end('not a regular canonical file'); return; }
        servedBytes += st.size;
        res.writeHead(200, { 'content-type': mime(target), 'content-length': st.size, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
        if (req.method === 'HEAD') res.end(); else fs.createReadStream(target).pipe(res);
        return;
      }
      missingRoutes.push({ path: pathname, reason: 'outside preview allowlist' });
      res.writeHead(404).end('not found');
    } catch (e) {
      errors.push({ kind: 'http-handler', path: pathname, message: String(e?.stack || e) });
      res.writeHead(500).end('preview handler error');
    }
  });
}

async function main() {
  assertWriteBoundaries();
  const priorShots = listScreenshots(EVIDENCE);
  priorScreenshotBytes = priorShots.bytes;
  priorScreenshotCount = priorShots.count;
  if (priorScreenshotCount + 2 > MAX_SHOTS) throw new Error(`Only ${MAX_SHOTS - priorScreenshotCount} screenshot slot(s) remain; final run needs PREP and choice screenshots.`);
  if (priorScreenshotBytes >= MAX_SHOT_BYTES) throw new Error('Existing canonical screenshot bytes already reached limit');
  assertWriteBoundaries();
  fs.mkdirSync(path.dirname(SCRIPT_FILE), { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.mkdirSync(RUN_EVIDENCE, { recursive: true });
  const outputs = ['receipt.json', ...phases.map(p => `${p.name.toLowerCase().replaceAll('_', '-')}.jpg`)];
  for (const name of outputs) {
    if (fs.existsSync(path.join(RUN_EVIDENCE, name))) throw new Error(`Refusing to overwrite existing evidence: ${path.join(RUN_EVIDENCE, name)}`);
  }
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable is missing: ${CHROME}`);

  server = makeServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const urls = phases.map(p => `${origin}/dev/game-mock.html?${p.query}&shot=1&render=fallback`);

  timer = setTimeout(() => { timedOut = true; errors.push({ kind: 'timeout', message: `Exceeded ${MAX_RUNTIME_MS}ms bounded runtime` }); void shutdown(); }, MAX_RUNTIME_MS);
  timer.unref();
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: PROFILE, timeout: 30000,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--no-first-run', '--no-default-browser-check'] });
    page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    page.setDefaultNavigationTimeout(25000);
    page.setDefaultTimeout(20000);
    await page.setRequestInterception(true);
    page.on('request', request => {
      const u = request.url();
      if (u.startsWith(origin + '/') || u.startsWith('data:') || u.startsWith('blob:')) { request.continue().catch(() => {}); return; }
      blockedExternal.push(u);
      request.abort('blockedbyclient').catch(() => {});
    });
    page.on('pageerror', e => errors.push({ kind: 'pageerror', message: String(e?.stack || e) }));
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource: the server responded with a status of 404 (Not Found)')) errors.push({ kind: 'console', message: m.text() }); });
    page.on('response', r => { if (r.status() >= 400) { if (r.url().endsWith('/data/local-assets.json')) warnings.push({ kind: 'optional-resource', status: r.status(), url: r.url(), note: 'No such manifest in the selected native Git revision; native loader handles it as optional.' }); else errors.push({ kind: 'http-response', status: r.status(), url: r.url() }); } });
    page.on('requestfailed', r => { if (r.url().startsWith(origin + '/') && !r.url().endsWith('/data/local-assets.json')) errors.push({ kind: 'requestfailed', url: r.url(), error: r.failure()?.errorText || '' }); });

    for (let i = 0; i < phases.length; i++) {
      const spec = phases[i];
      await page.goto(urls[i], { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForFunction(({ selectors }) => selectors.every(sel => document.querySelector(sel) && getComputedStyle(document.querySelector(sel)).display !== 'none'), { timeout: 20000 }, { selectors: spec.selectors });
      await page.waitForFunction(() => document.fonts?.status === 'loaded' || !document.fonts, { timeout: 12000 });
      await new Promise(resolve => setTimeout(resolve, 1800));
      const facts = await page.evaluate(({ selectors, text }) => {
        const body = document.body.innerText;
        const visible = selector => {
          const el = document.querySelector(selector);
          if (!el) return { exists: false, visible: false, rect: null };
          const r = el.getBoundingClientRect();
          return { exists: true, visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden', rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
        };
        return { bodyText: body.slice(0, 6000), selectors: Object.fromEntries(selectors.map(s => [s, visible(s)])), textChecks: Object.fromEntries(text.map(t => [t, body.includes(t)])) };
      }, spec);
      if (Object.values(facts.textChecks).some(v => !v)) throw new Error(`${spec.name}: visible expected text missing: ${JSON.stringify(facts.textChecks)}`);
      if (Object.values(facts.selectors).some(v => !v.visible)) throw new Error(`${spec.name}: required UI region is not visible: ${JSON.stringify(facts.selectors)}`);
      const captureScreenshot = spec.name === 'PREP' || spec.name === 'SP_DRAFT_SUPPLY';
      let screenshotPath = null;
      let shotBytes = 0;
      if (captureScreenshot) {
        screenshotPath = path.join(RUN_EVIDENCE, `${spec.name.toLowerCase().replaceAll('_', '-')}.jpg`);
        const buffer = await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 82, captureBeyondViewport: false });
        screenshotBytes += buffer.length;
        shotBytes = buffer.length;
        if (buffer.length > 900 * 1024 || priorScreenshotBytes + screenshotBytes > MAX_SHOT_BYTES || priorScreenshotCount + phaseResults.filter(x => x.screenshot).length + 1 > MAX_SHOTS) throw new Error('Screenshot size/count bound exceeded');
      }
      phaseResults.push({ phase: spec.name, url: urls[i], textChecks: facts.textChecks,
        visibleRegions: facts.selectors, screenshot: screenshotPath ? path.resolve(screenshotPath) : null, screenshotBytes: shotBytes,
        visualPassed: true, visualNotes: spec.name === 'PREP' ? 'Visible .gm__field board region and .shopbar are both rendered.' : spec.name === 'SP_DRAFT_SUPPLY' ? 'Native supply choice overlay is visible.' : 'Required native UI regions and phase text are visible.' });
    }
  } catch (e) {
    errors.push({ kind: 'run-error', message: String(e?.stack || e) });
    const failedPhase = phases[phaseResults.length];
    if (page && failedPhase && priorScreenshotCount + phaseResults.filter(x => x.screenshot).length < MAX_SHOTS && priorScreenshotBytes + screenshotBytes < MAX_SHOT_BYTES) {
      try {
        const p = path.join(RUN_EVIDENCE, `error-${failedPhase.name.toLowerCase().replaceAll('_', '-')}.jpg`);
        const b = await page.screenshot({ path: p, type: 'jpeg', quality: 70, captureBeyondViewport: false });
        screenshotBytes += b.length;
        phaseResults.push({ phase: failedPhase.name, url: urls[phaseResults.length], visualPassed: false, screenshot: path.resolve(p), screenshotBytes: b.length, diagnostic: 'Captured failure state for inspection.' });
      } catch (shotError) { errors.push({ kind: 'error-screenshot', message: String(shotError) }); }
    }
  } finally {
    await shutdown();
  }

  const receipt = {
    startedAt: STARTED_AT, finishedAt: new Date().toISOString(), sourceNative: NATIVE,
    sourceNativeDate: '2026-10-09', canonicalRepo: CANON, worktree: WORKTREE,
    urls, routeMap: { '/sim/*': 'server/sim/* Git blobs', '/data/*': 'data/* Git blobs', '/assets/*,/fonts/*,/vendor/*': 'canonical absolute files' }, browserExecutable: CHROME, browserVersion: browser ? await safeBrowserVersion(browser) : null,
    outcomes: phaseResults, errors, blockedExternalRequests: [...new Set(blockedExternal)].slice(0, 100),
    warnings, missingOrBlockedRoutes: missingRoutes.slice(0, 150),
    screenshotCount: phaseResults.filter(x => x.screenshot).length, screenshotBytes,
    limits: { maxRuntimeMs: MAX_RUNTIME_MS, maxScreenshots: MAX_SHOTS, maxScreenshotBytes: MAX_SHOT_BYTES },
    status: !timedOut && errors.length === 0 && phaseResults.length === phases.length && phaseResults.every(x => x.visualPassed) ? 'visual-passed' : 'failed',
  };
  fs.writeFileSync(path.join(RUN_EVIDENCE, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ status: receipt.status, receipt: path.join(RUN_EVIDENCE, 'receipt.json'), outcomes: receipt.outcomes.map(x => ({ phase: x.phase, visualPassed: x.visualPassed, screenshot: x.screenshot, screenshotBytes: x.screenshotBytes })), errors: receipt.errors, screenshotBytes: receipt.screenshotBytes }, null, 2) + '\n');
  if (receipt.status !== 'visual-passed') process.exitCode = 1;
}

async function safeBrowserVersion(instance) {
  try { return await instance.version(); } catch { return null; }
}

async function shutdown() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (browser) { const b = browser; browser = null; try { await b.close(); } catch {} }
  if (server?.listening) { const s = server; server = null; await new Promise(resolve => s.close(() => resolve())); }
}

main().catch(async error => {
  errors.push({ kind: 'fatal', message: String(error?.stack || error) });
  await shutdown();
  const receipt = { startedAt: STARTED_AT, finishedAt: new Date().toISOString(), sourceNative: NATIVE,
    urls: [], outcomes: phaseResults, errors, resourcesServedBytes: servedBytes, screenshotBytes,
    status: 'failed' };
  try { fs.mkdirSync(EVIDENCE, { recursive: true }); fs.mkdirSync(RUN_EVIDENCE, { recursive: true }); fs.writeFileSync(path.join(RUN_EVIDENCE, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8'); } catch {}
  process.stderr.write(`${JSON.stringify(receipt, null, 2)}\n`);
  process.exitCode = 1;
});

