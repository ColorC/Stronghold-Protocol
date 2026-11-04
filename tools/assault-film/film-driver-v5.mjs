/* global document, window */
// Replay-style film driver for 进击, v5 (v4 pacing + an opening on the real leader pick + the 再部署 loop pause).
// v5 over v4: the film opens on the title's leader pick (V00a / V00b), hovers the three leaders and picks 凛御银灰 with real
// clicks; the run that click creates gets the saved seed through a driver-side fetch wrapper (the game is untouched), so it
// is the same run as the journal. In-battle pause chains are generic: the lead cue is the one with watch.manual, a
// watch.follow cue queues right behind it, and watch.pauseMax caps how long the game stays paused for the lead card.
// Replays a saved run's opJournal on the REAL game UI (same seed + leader, fresh run): every step is a real mouse click or drag
// through puppeteer's input pipeline; the picture is rendered live by the GPU and recorded by the browser's own tab capture +
// MediaRecorder (capture.mjs). Cursor, guide cards, frames and zoom are page overlays (overlay.page.js).
//
// usage: node film-driver-v5.mjs --out <dir> --narration <json> --storyboard <json> --voice <dir> [--until N] [--no-capture] [--no-opening]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { CHROME, GPU_ARGS, CAPTURE_ARGS } from './gpu-args.mjs';
import { startCapture, stopCapture } from './capture.mjs';

const ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const puppeteer = createRequire(ROOT + '/package.json')('puppeteer-core');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i < 0 ? dflt : (argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[i + 1]); };
const OUT = opt('out'); if (!OUT) throw new Error('--out is required');
const UNTIL = Number(opt('until', 1000));
const BASE = opt('base', 'http://127.0.0.1:13004');
const SESSION = opt('session', ROOT + '/runtime/assault/film-1103/run2/session.json');
const FROM = Number(opt('from', 0)); // debug only: fast-forward by API to this step; the real film starts at 0
const NO_CAPTURE = !!opt('no-capture', false);
const FPS = Number(opt('fps', 60));
const VIDEO_BPS = Number(opt('video-bps', 2_400_000));
const NARRATION = opt('narration', null);
const STORYBOARD = opt('storyboard', null);
const VOICE_DIR = opt('voice', null);
const EXTRA_ARGS = String(opt('chrome-args', '') === true ? '' : opt('chrome-args', '')).split(' ').filter(Boolean);
const PRIORITY = opt('priority', 'AboveNormal');
const MP4 = path.join(OUT, opt('mp4', 'film.mp4'));
fs.mkdirSync(OUT, { recursive: true });

// ---------- deterministic pacing ----------
let seed = 1103;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a, b) => a + (b - a) * rnd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now(); let captureT0 = null;
const clock = () => (Date.now() - (captureT0 ?? T0)) / 1000;
const logFile = path.join(OUT, 'driver.log.ndjson');
fs.writeFileSync(logFile, '');
const log = (ev, data = {}) => { const row = { t: +clock().toFixed(2), ev, ...data }; fs.appendFileSync(logFile, JSON.stringify(row) + '\n'); if (process.env.FILM_VERBOSE) console.log(JSON.stringify(row)); };

// ---------- inputs ----------
const orig = JSON.parse(fs.readFileSync(SESSION, 'utf8'));
const journal = orig.opJournal.slice(0, UNTIL);
const narration = NARRATION ? JSON.parse(fs.readFileSync(NARRATION, 'utf8')).entries : [];
const { CUES } = await import('./cues4.mjs');
const sb = STORYBOARD ? JSON.parse(fs.readFileSync(STORYBOARD, 'utf8')).items : [];
// looks (hover / open detail / pick-one browsing) per step, split by when
const looks = {};
for (const it of sb) { if (it.at.step == null || !['hover', 'openDetail', 'choiceBrowse'].includes(it.kind)) continue; ((looks[it.at.step] ||= { before: [], after: [] })[it.at.when === 'after' ? 'after' : 'before']).push(it); }
const lookOf = (i, kind, when) => (looks[i]?.[when] || []).find((x) => x.kind === kind);
// raised "looking" durations (coordinator): shop card 1.2 s, pick-one option 1.3 s (+0.5 s on the chosen one), detail 1.6 s / key operator 3.2 s;
// a storyboard value that is longer (a narrated screen) is kept
const HOLD = { shopCard: 1200, option: 1300, pick: 500, detailNormal: 1600, detailKey: 3200 };
const entriesAt = (i) => narration.filter((n) => n.at?.step === i);
const triggerOf = (e) => e.trigger || CUES[e.id]?.trigger;
const OPENING = !opt('no-opening', false) && FROM === 0;

// ---------- tiny loopback media server for narration wav files ----------
let mediaPort = 0;
const mediaServer = http.createServer((req, res) => {
  const file = path.join(VOICE_DIR || '.', decodeURIComponent(req.url.replace(/^\/v\//, '')));
  if (!VOICE_DIR || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  const buf = fs.readFileSync(file);
  res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': buf.length, 'access-control-allow-origin': '*' }); res.end(buf);
});
await new Promise((r) => mediaServer.listen(0, '127.0.0.1', r)); mediaPort = mediaServer.address().port;

// ---------- server helpers ----------
const api = (p, init) => fetch(`${BASE}/api/assault/${p}`, init).then((r) => r.json());
const getState = async (id) => (await api(`runs/${id}`)).state;
const exportRun = async (id) => (await api(`runs/${id}/export`));
async function waitRevision(id, rev, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  for (;;) { const s = await getState(id); if (s.revision >= rev) return s; if (Date.now() > end) throw new Error(`timeout waiting for revision ${rev} (at ${s.revision}, phase ${s.phase})`); await sleep(80); }
}

// ---------- browser ----------
const profile = `${ROOT}/.omni/tmp/assault/film-1103/profile-film-${Date.now()}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', pipe: true, ignoreDefaultArgs: ['--mute-audio'], userDataDir: profile, args: [...GPU_ARGS, ...CAPTURE_ARGS, ...EXTRA_ARGS] });
const browserPid = browser.process().pid;
fs.writeFileSync(path.join(OUT, 'browser.pid'), String(browserPid));
log('browser', { pid: browserPid, profile });
// our own browser tree (matched by its unique profile folder) and this node process get a higher priority class; nothing else is touched
const PRIO_PS = new URL('./set-priority.ps1', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const prio = (priority) => { try { const out = execFileSync('powershell', ['-NoProfile', '-File', PRIO_PS, '-Marker', path.basename(profile), '-ExtraPid', [process.pid, ...(opt('service-pid', '') ? [Number(opt('service-pid'))] : [])].join(','), '-Priority', priority], { encoding: 'utf8', timeout: 30000 }); return JSON.parse(out || '[]'); } catch (e) { return [{ error: String(e).slice(0, 200) }]; } };
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
const ptr = [];
for (const k of ['move', 'down', 'up', 'wheel']) { const f = page.mouse[k].bind(page.mouse); page.mouse[k] = (...a) => { ptr.push([+clock().toFixed(3), k, typeof a[0] === 'number' ? Math.round(a[0]) : null, typeof a[1] === 'number' ? Math.round(a[1]) : null]); return f(...a); }; }
await page.evaluateOnNewDocument(fs.readFileSync(new URL('./overlay.page.js', import.meta.url), 'utf8'));
// v5 opening: the leader pick on the title creates the run with POST runs {directorId}; the driver adds the saved seed to that
// one request (page-side fetch wrapper installed before the game's scripts; the game's code and data are not changed)
await page.evaluateOnNewDocument((seed, dir) => {
  const f = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const u = new URL(String(input?.url ?? input), location.href);
      if (init && String(init.method || '').toUpperCase() === 'POST' && /\/api\/assault\/runs$/.test(u.pathname)) {
        const b = JSON.parse(init.body || '{}');
        if (b.directorId === dir && b.seed === undefined) { b.seed = seed; init = { ...init, body: JSON.stringify(b) }; window.__filmSeeded = b; }
      }
    } catch { /* not a run creation */ }
    return f(input, init);
  };
}, orig.seed, orig.directorId);
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(String(e).slice(0, 300)); log('pageerror', { text: String(e).slice(0, 300) }); });

// ---------- humanised pointer ----------
const pointer = { x: Math.round(1920 * 0.62), y: Math.round(1080 * 0.66), flip: 1 };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
async function glide(x, y, { slow = 1 } = {}) {
  const dx = x - pointer.x, dy = y - pointer.y, dist = Math.hypot(dx, dy);
  if (dist < 2) return;
  const dur = Math.min(380, 110 + dist * 0.18) * slow;
  const nx = -dy / dist, ny = dx / dist, bow = dist * 0.1 * pointer.flip; pointer.flip *= -1;
  const cx = pointer.x + dx / 2 + nx * bow, cy = pointer.y + dy / 2 + ny * bow;
  const x0 = pointer.x, y0 = pointer.y;
  const steps = Math.max(2, Math.round(dur / 16)); const t0 = performance.now();
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps), a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    await page.mouse.move(a * x0 + b * cx + c * x, a * y0 + b * cy + c * y);
    const wait = t0 + i * (dur / steps) - performance.now(); if (wait > 0) await sleep(wait);
  }
  pointer.x = x; pointer.y = y;
}
async function pressAt(x, y) { await glide(x, y); await sleep(30); log('click', { at: [Math.round(x), Math.round(y)] }); await page.mouse.down(); await sleep(80); await page.mouse.up(); }

async function centerOf(selector) {
  const c0 = clock();
  // a shop that re-renders (after 刷新) can detach the element between the wait and the measure: retry
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const h = await page.waitForSelector(selector, { visible: true, timeout: 20000 });
      let box = await h.boundingBox();
      for (let k = 0; k < 40 && box; k++) { await sleep(60); const b2 = await h.boundingBox(); if (b2 && Math.abs(b2.x - box.x) < 1.5 && Math.abs(b2.y - box.y) < 1.5) { box = b2; break; } box = b2; }
      await h.dispose();
      if (!box) { await sleep(250); continue; }
      if (clock() - c0 > 0.2) log('dwell', { why: 'game', what: 'element animating in', from: +c0.toFixed(2), ms: Math.round((clock() - c0) * 1000) });
      return { x: box.x + box.width / 2 + between(-box.width * 0.12, box.width * 0.12), y: box.y + box.height / 2 + between(-box.height * 0.1, box.height * 0.1) };
    } catch (e) { if (attempt === 7) throw e; await sleep(250); }
  }
  throw new Error('no box for ' + selector);
}
const buttonCenter = async (pred, timeout = 8000) => {
  const [text, scope, exact] = pred;
  await page.waitForFunction((t, sc, ex) => [...document.querySelectorAll((sc || 'body') + ' button')].some((b) => !b.disabled && b.getBoundingClientRect().width > 0 && (ex === 'name' ? (b.textContent.trim() === t || b.textContent.trim().startsWith(t + '替换')) : ex ? b.textContent.trim() === t : b.textContent.includes(t))), { timeout }, text, scope, exact);
  const r = await page.evaluate((t, sc, ex) => { const b = [...document.querySelectorAll((sc || 'body') + ' button')].find((x) => !x.disabled && x.getBoundingClientRect().width > 0 && (ex === 'name' ? (x.textContent.trim() === t || x.textContent.trim().startsWith(t + '替换')) : ex ? x.textContent.trim() === t : x.textContent.includes(t))); const q = b.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; }, text, scope, exact);
  return { x: r.x + r.w / 2 + between(-r.w * 0.1, r.w * 0.1), y: r.y + r.h / 2 + between(-r.h * 0.1, r.h * 0.1) };
};

// ---------- field geometry ----------
const installRefs = () => page.waitForFunction(() => { const f = window.__fieldRefs(); return f.view?.pieceScreenRect && f.map; }, { timeout: 60000 });
const pieceRect = (uid) => page.evaluate((u) => { const f = window.__fieldRefs(); const q = f.view.pieceScreenRect(f.map.numberOf(u)); return q && { x: q.left + q.width / 2, y: q.top + q.height * 0.7 }; }, uid);
const tileRect = (r, c) => page.evaluate((r, c) => { const f = window.__fieldRefs(); const t = f.view.tileScreen(r, c); return t && { x: t.x, y: t.y, s: t.s }; }, r, c);
async function stableGeom(read, tries = 60) {
  const g0 = clock(); const done = (v) => { if (clock() - g0 > 0.2) log('dwell', { why: 'game', what: 'scene/camera settling', from: +g0.toFixed(2), ms: Math.round((clock() - g0) * 1000) }); return v; };
  let prev = null;
  for (let k = 0; k < tries; k++) {
    const cur = await read();
    if (cur && prev && Math.abs(cur.x - prev.x) < 1.5 && Math.abs(cur.y - prev.y) < 1.5) { await sleep(120); const again = await read(); if (again && Math.abs(again.x - cur.x) < 1.5 && Math.abs(again.y - cur.y) < 1.5) return done(again); }
    prev = cur; await sleep(150);
  }
  return done(prev);
}

// ---------- narration: one wav + one guide card per segment, queued in the page, never blocking the driver ----------
const resolveAnchor = (an, ctx) => {
  if (!an) return an;
  if (an.kind === 'sel' && an.sel === '$slot') return { ...an, sel: ctx.slotSel };
  if (an.kind === 'sel' && an.sel === '$choice') return { ...an, sel: ctx.choiceSel };
  if (an.kind === 'allies') return { kind: 'allies', uids: an.uids || ctx.allies || [] };
  return an;
};
function buildSpec(entry, ctx) {
  const def = CUES[entry.id]; if (!def) throw new Error('no cue def for ' + entry.id);
  const f = `${entry.id}.wav`; const has = VOICE_DIR && fs.existsSync(path.join(VOICE_DIR, f));
  const fx = {};
  if (def.frame) fx.frame = resolveAnchor(def.frame, ctx);
  if (def.zoom) fx.zoom = { anchor: resolveAnchor(def.zoom.anchor, ctx), also: def.zoom.also ? resolveAnchor(def.zoom.also, ctx) : null, scale: def.zoom.scale };
  return { id: entry.id, tag: def.tag, parts: [{ text: entry.text, url: has ? `http://127.0.0.1:${mediaPort}/v/${encodeURIComponent(f)}` : null, fallbackSec: Math.max(2, entry.text.length / 5) }],
    anchor: resolveAnchor(def.anchor, ctx), fallback: resolveAnchor(def.fallback, ctx), sides: def.sides, avoid: def.avoid || ['.gtop__right'], fx };
}
const spoken = [];
async function enqueueCue(entry, ctx = {}) {
  const spec = buildSpec(entry, ctx);
  await page.evaluate((sp) => window.__film.enqueue(sp), spec);
  spoken.push({ id: entry.id, queuedSec: +clock().toFixed(2) });
  log('cue-queued', { id: entry.id });
}
const timers = new Set();
const later = (ms, fn) => { const t = setTimeout(async () => { timers.delete(t); try { await fn(); } catch (e) { log('cue-error', { text: String(e).slice(0, 300) }); } }, Math.max(0, ms)); timers.add(t); };
const idle = async () => { await page.evaluate(() => window.__film.whenIdle()); await sleep(200); };
const idleCap = (ms) => Promise.race([idle(), sleep(ms)]);
// every resting look is logged with its reason: detail-open | voice | static-look (whole screen read once) | battle
const dwell = async (ms, why, extra = {}) => { const t0 = clock(); await sleep(ms); log('dwell', { why, from: +t0.toFixed(2), ms: Math.round(ms), ...extra }); };
const dwellVoice = async (capMs, why = 'voice') => { const t0 = clock(); await idleCap(capMs); if (clock() - t0 > 0.3) log('dwell', { why, from: +t0.toFixed(2), ms: Math.round((clock() - t0) * 1000) }); };
const noZoom = () => page.evaluate(() => window.__film.whenNoZoom());

// ---------- state-derived targets ----------
const strip = (o) => { const { opId, expectedRevision, ...rest } = o; return rest; };
const origRunId = orig.runId; let runId = null;
const norm = (o) => JSON.parse(JSON.stringify(o ?? null).split(origRunId).join('RUN').split(runId).join('RUN'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// shop: hover the cards one by one without clicking
async function hoverShop(ms) { // the shop is looked at once as a whole (the cursor does not stop on each card: hovering shows nothing new)
  const n = await page.evaluate(() => [...document.querySelectorAll('.scard[data-slot-idx]')].filter((e) => e.getBoundingClientRect().width > 0).length);
  if (n) await dwell(ms, 'static-look', { cards: n });
}
// pick-one: look at every option in turn, come back to the chosen one, then arm + confirm (a voice that belongs to this screen is waited for first)
async function pickCard(idx, ctx, kind, waitVoice) {
  const sel = (k) => `.spcard[data-choice-idx="${k}"]`; ctx.choiceSel = sel(idx);
  await page.waitForSelector(sel(idx), { visible: true, timeout: 20000 });
  // the whole screen is read once: route nodes 0.8 s; cards that print their effect ~1 s per 15 characters, 2-4 s
  const chars = await page.evaluate(() => [...document.querySelectorAll('.spcard[data-choice-idx]')].reduce((a, e) => a + e.textContent.length, 0));
  const look = kind === 'route' ? 800 : Math.max(2000, Math.min(4000, chars / 15 * 1000));
  await dwell(look, 'static-look', { chars, kind });
  let c = await centerOf(sel(idx)); await glide(c.x, c.y); await sleep(300);
  if (waitVoice) await dwellVoice(30000);
  await noZoom();
  c = await centerOf(sel(idx)); await glide(c.x, c.y);
  await pressAt(c.x, c.y); await sleep(150);
  const ok = await centerOf('[data-testid="sp-confirm"]'); await pressAt(ok.x, ok.y);
}
async function openLedger(fromEnd) {
  if (!fromEnd) { const c = await centerOf('[data-testid="check-player"]'); await pressAt(c.x, c.y); await sleep(500); }
  const b = await buttonCenter(['本场账本', null, true]); await pressAt(b.x, b.y); await page.waitForSelector('.assault-ledger', { visible: true, timeout: 10000 }); await sleep(400);
}
async function closeLedger(fromEnd) {
  const b = await buttonCenter(['返回', '.st-top', false]); await pressAt(b.x, b.y); await sleep(400);
  if (!fromEnd && await page.$('.modal__box')) { await glide(220, 640); await sleep(60); await page.mouse.down(); await sleep(80); await page.mouse.up(); await sleep(300); }
}
async function closePanel() {
  const h = await page.$('.dpanel__close'); if (!h) return; const b = await h.boundingBox(); await h.dispose(); if (!b) return; await pressAt(b.x + b.width / 2, b.y + b.height / 2); await sleep(120);
}
const SPEED = async (n) => { try { const chip = await buttonCenter([n + '×', '.ix-battlebar', true], 2500); await pressAt(chip.x, chip.y); log('battle-speed', { speed: n }); return true; } catch { return false; } };
const battleInfo = () => page.evaluate(() => ({ t: window.__battleSession?.battle?.time ?? 0, speaking: window.__film.speaking(), zoom: window.__film.zooming(), hit: Object.keys(window.__filmHit || {}) })).catch(() => ({ t: 0, speaking: false, zoom: false, hit: [] }));

// ---------- the replay ----------
let divergence = null; let capture = null; let recordingId = null; const timeline = []; let firstBattleStartSec = null;
let lastScreen = '';
try {
  const NO_RECORD = !!opt('no-record', false);
  const recQ = NO_RECORD ? '' : '&record=1&recordFps=' + opt('record-fps', 10) + '&recordMax=' + opt('record-max', 1280);
  if (OPENING) {
    // ---- v5 opening: title -> callsign -> 开始 (before the capture), then the leader pick is the film's first screen ----
    // warm-up (not filmed): open a throwaway run of the same seed once, so the first title -> run screen switch inside the
    // film finds the game's files, textures and GPU programs already loaded (the first full recording lost ~0.9 s of
    // frames there). The throwaway run lives in the film's own data dir; its resume pointer is cleared afterwards.
    if (!opt('no-warm', false)) {
      const warm = await api('runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ directorId: orig.directorId, seed: orig.seed }) });
      await page.goto(`${BASE}/assault.html?run=${warm.runId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '继续'), { timeout: 60000 });
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '继续').click());
      await page.waitForFunction(() => !!document.querySelector('.gtop__center') && document.querySelectorAll('.spcard[data-choice-idx]').length > 0, { timeout: 60000 });
      await sleep(2500);
      await page.evaluate(() => { try { localStorage.removeItem('assault:lastRun'); } catch { /* optional */ } });
      log('warm-up', { runId: warm.runId });
    }
    await page.goto(`${BASE}/assault.html?new=1${recQ}`, { waitUntil: 'domcontentloaded' });
    const glInfo = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
    log('webgl', { renderer: glInfo }); if (/swiftshader|basic render|llvmpipe/i.test(glInfo)) throw new Error('software renderer: ' + glInfo);
    const field = await page.waitForSelector('.title-login input', { visible: true, timeout: 60000 });
    await field.click({ clickCount: 3 }); await page.keyboard.type('Doctor', { delay: 30 }); await field.dispose();
    const go = await buttonCenter(['开始', '.title-login', true], 15000); await pressAt(go.x, go.y);
    await page.waitForSelector('.spcard[data-choice-idx]', { visible: true, timeout: 30000 });
    await sleep(1500);
    if (PRIORITY && PRIORITY !== 'none') log('priority', { set: prio(PRIORITY).map((x) => x.pid ? `${x.name}:${x.pid}:${x.before}>${x.after}` : x.error) });
    if (!NO_CAPTURE) { capture = await startCapture(page, MP4, { fps: FPS, videoBps: VIDEO_BPS }); captureT0 = Date.now(); log('capture-start', capture.info); }
    if (PRIORITY && PRIORITY !== 'none') log('priority-after-capture', { set: prio(PRIORITY).map((x) => x.pid ? `${x.name}:${x.pid}:${x.after}` : x.error) });
    const leaders = await page.evaluate(() => [...document.querySelectorAll('.spcard[data-choice-idx]')].map((e) => ({ idx: Number(e.dataset.choiceIdx), text: e.textContent.replace(/\s+/g, ' ').slice(0, 40) })));
    const pickIdx = leaders.find((l) => l.text.includes('凛御银灰'))?.idx;
    log('leaders', { leaders, pickIdx }); if (pickIdx == null) throw new Error('凛御银灰 not on the leader pick');
    const lsel = (k) => `.spcard[data-choice-idx="${k}"]`;
    const v00a = narration.find((n) => n.id === 'V00a'), v00b = narration.find((n) => n.id === 'V00b');
    await sleep(700);
    // V00a: the leader screen holds while it is read (pause: the cursor rests)
    if (v00a) { log('opening', { id: 'V00a' }); await enqueueCue(v00a, {}); const t0 = clock(); await idle(); log('dwell', { why: 'voice', from: +t0.toFixed(2), ms: Math.round((clock() - t0) * 1000) }); }
    // V00b: the three leaders are hovered in turn while it is spoken, then 凛御银灰 is picked; confirm once it ends
    if (v00b) {
      log('opening', { id: 'V00b' }); await enqueueCue(v00b, {});
      await sleep(400);
      for (const l of leaders) { const c = await centerOf(lsel(l.idx)); await glide(c.x, c.y); await dwell(1500, 'voice', { hover: l.idx }); }
      const c = await centerOf(lsel(pickIdx)); await glide(c.x, c.y); await sleep(250); await pressAt(c.x, c.y);
      const t0 = clock(); await idle(); log('dwell', { why: 'voice', from: +t0.toFixed(2), ms: Math.round((clock() - t0) * 1000) });
    } else { const c = await centerOf(lsel(pickIdx)); await pressAt(c.x, c.y); await sleep(300); }
    const ok = await centerOf('[data-testid="sp-confirm"]'); await pressAt(ok.x, ok.y);
    await page.waitForFunction(() => { try { return !!localStorage.getItem('assault:lastRun'); } catch { return false; } }, { timeout: 30000 });
    runId = await page.evaluate(() => localStorage.getItem('assault:lastRun'));
    const st0 = await getState(runId); const seeded = await page.evaluate(() => window.__filmSeeded ?? null);
    log('run-created', { runId, via: 'leader-pick', seed: st0.seed, directorId: st0.directorId, revision: st0.revision, seeded });
    if (st0.seed !== orig.seed || st0.directorId !== orig.directorId || st0.revision !== 0) throw new Error(`leader pick made a different run: seed ${st0.seed} director ${st0.directorId} rev ${st0.revision}`);
    await page.waitForFunction(() => !!document.querySelector('.gtop__center') && [...document.querySelectorAll('.spcard[data-choice-idx]')].length > 0, { timeout: 60000 });
    await sleep(500);
    recordingId = await page.evaluate(() => window.__SP_RECORDING_STATUS__?.()?.id ?? null);
  } else {
  const created = await api('runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ directorId: orig.directorId, seed: orig.seed }) });
  runId = created.runId; log('run-created', { runId, seed: orig.seed, directorId: orig.directorId });
  if (FROM > 0) {
    let st = created.state;
    for (let k = 0; k < FROM; k++) {
      const { action } = journal[k];
      const r = action.type === 'settleBattle'
        ? await api(`runs/${runId}/settle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ battleId: st.currentBattle.battleId, opId: action.opId, expectedRevision: st.revision }) })
        : await api(`runs/${runId}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...action, expectedRevision: st.revision }) });
      if (!r.state) throw new Error('fast-forward failed at ' + k); st = r.state;
    }
    log('fast-forwarded', { to: FROM, phase: st.phase });
  }
  const url = `${BASE}/assault.html?run=${runId}${recQ}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const glInfo = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
  log('webgl', { renderer: glInfo }); if (/swiftshader|basic render|llvmpipe/i.test(glInfo)) throw new Error('software renderer: ' + glInfo);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '继续'), { timeout: 30000 });
  await sleep(1500);
  const cont = await buttonCenter(['继续', null, true]); await pressAt(cont.x, cont.y); log('resume-click');
  await page.waitForSelector('.spcard, .scard, [data-testid="deploy-cap"]', { timeout: 60000 });
  await sleep(3000);
  recordingId = await page.evaluate(() => window.__SP_RECORDING_STATUS__?.()?.id ?? null);
  if (PRIORITY && PRIORITY !== 'none') log('priority', { set: prio(PRIORITY).map((x) => x.pid ? `${x.name}:${x.pid}:${x.before}>${x.after}` : x.error) });
  if (!NO_CAPTURE) { capture = await startCapture(page, MP4, { fps: FPS, videoBps: VIDEO_BPS }); captureT0 = Date.now(); log('capture-start', capture.info); }
  // V01 is tied to film seconds, not to a step
  if (PRIORITY && PRIORITY !== 'none') log('priority-after-capture', { set: prio(PRIORITY).map((x) => x.pid ? `${x.name}:${x.pid}:${x.after}` : x.error) });
  }
  for (const e of narration.filter((n) => n.at?.film != null && triggerOf(e) === 'film')) later(e.at.film * 1000, () => enqueueCue(e, {}));
  await sleep(900);

  let prevType = 'resume';
  for (let i = FROM; i < journal.length; i++) {
    const { action, result } = journal[i];
    const isSettle = action.type === 'settleBattle';
    const pre = await getState(runId);
    if (!isSettle && pre.revision !== i) throw new Error(`state revision ${pre.revision} before op ${i}`);
    // a zoom is a short narrated window: let it finish (the screen is then back to normal geometry) before the next action
    if (!isSettle && i > 0) await noZoom();
    const screenKey = `${pre.phase}`;
    const newScreen = screenKey !== lastScreen || ['selectNode', 'finishShop', 'settleBattle', 'chooseRelic', 'chooseSkill', 'chooseUpgrade', 'readyBattle', 'resume', 'confirmEvent', 'leaveEvent'].includes(prevType);
    if (!isSettle) await sleep(between(120, 250)); // natural pace between steps; waits for scenes live in the selectors / stable-geometry checks
    lastScreen = screenKey;
    log('op-start', { i, type: action.type, phase: pre.phase });
    timeline.push({ i, type: action.type, startSec: +clock().toFixed(2) });
    const ctx = {};
    const mine = entriesAt(i);
    const trig = (t) => mine.filter((e) => triggerOf(e) === t);
    if (!['bench'].includes(action.type)) await closePanel();
    const opT0 = Date.now();
    const atLeast = async (ms) => { const rest = ms - (Date.now() - opT0); if (rest > 0) await sleep(rest); };
    const slotIdx = () => { const k = pre.shop.slots.findIndex((s) => s.slotId === action.slotId); if (k < 0) throw new Error('slot not offered: ' + action.slotId); ctx.slotSel = `.scard[data-slot-idx="${k}"]`; return k; };
    if (['buy', 'buySkill', 'enchantPiece'].includes(action.type)) slotIdx();
    // narration queued at the start of the step (plus its offset); the driver keeps acting while it plays
    const stepCues = trig('step'); const hasStepVoice = stepCues.length > 0;
    for (const e of stepCues) later((e.at.offset || 0) * 1000, async () => { for (let k = 0; k < 60 && CUES[e.id].anchor?.sel === '$choice' && !ctx.choiceSel; k++) await sleep(100); await enqueueCue(e, ctx); });
    // looks before the action
    for (const it of looks[i]?.before || []) if (it.kind === 'hover') await hoverShop(1300);

    switch (action.type) {
      case 'selectNode': case 'chooseRelic': case 'chooseSkill': case 'chooseUpgrade': case 'confirmEvent': case 'leaveEvent': {
        let idx;
        if (action.type === 'selectNode') { idx = pre.nodes.findIndex((n) => n.id === action.nodeId); if (idx < 0) throw new Error('node not offered: ' + action.nodeId); }
        else if (action.type === 'chooseRelic') { const ch = (pre.rewardQueue?.[0]?.choices) ?? pre.rewards?.choices; idx = ch.indexOf(action.relicId); if (idx < 0) throw new Error('relic not offered ' + action.relicId); }
        else if (action.type === 'chooseSkill') { idx = pre.skillRewards.choices.indexOf(action.skillId); if (idx < 0) throw new Error('skill not offered ' + action.skillId); }
        else if (action.type === 'chooseUpgrade') { idx = pre.upgradeRewards.choices.indexOf(action.uid); if (idx < 0) throw new Error('upgrade not offered ' + action.uid); }
        else { const cid = action.type === 'leaveEvent' ? result.choiceId : action.choiceId; idx = pre.choices.findIndex((c) => c.id === cid); if (idx < 0) throw new Error('event choice not offered ' + cid); }
        await pickCard(idx, ctx, action.type === 'selectNode' ? 'route' : 'text', hasStepVoice);
        if (action.targetUid || action.filterTag) { // recruit-style event choice: the game asks for a profession and an operator
          await page.waitForSelector('.modal__box', { visible: true, timeout: 8000 }); await sleep(450);
          const ch = pre.choices[idx];
          if (action.filterTag) {
            const fi = (ch.recruitFilters || []).filter((tag) => ch.targets?.some((v) => v.filterTag === tag)).indexOf(action.filterTag);
            const fb = await centerOf(`.modal__box .assault-actions:nth-of-type(1) button:nth-of-type(${fi + 1})`); await pressAt(fb.x, fb.y); await sleep(300);
          }
          const list = (ch.targets || []).filter((v) => !action.filterTag || !v.filterTag || v.filterTag === action.filterTag);
          const ti = list.findIndex((v) => v.targetUid === action.targetUid);
          const tb = await centerOf(`.modal__box .assault-actions:last-of-type button:nth-of-type(${ti + 1})`); await pressAt(tb.x, tb.y); await sleep(300);
          const ok = await buttonCenter(['确认选择', '.modal__box', false]); await pressAt(ok.x, ok.y);
        }
        break;
      }
      case 'buy': case 'buySkill': case 'enchantPiece': {
        const c = await centerOf(ctx.slotSel); await glide(c.x, c.y);
        const det = lookOf(i, 'openDetail', 'before');
        if (hasStepVoice) await dwellVoice(30000); // the narration points at this shop card: it is seen (and heard) before it is opened
        await pressAt(c.x, c.y); await sleep(det ? 350 : 220);
        if (action.type !== 'enchantPiece') {
          if (det) { // first tap opens the card's detail: let the viewer read it (a key operator's card 3.2 s)
            for (const e of trig('detail')) await enqueueCue(e, ctx);
            const pauseCue = trig('detail').length > 0;
            await dwell(Math.max(det.holdMs || 0, det.holdMs >= 3000 ? HOLD.detailKey : HOLD.detailNormal), 'detail-open');
            if (pauseCue) await dwellVoice(30000);
          }
          const c2 = await centerOf(ctx.slotSel); await pressAt(c2.x, c2.y);
        } else {
          const c2 = await centerOf(ctx.slotSel); await pressAt(c2.x, c2.y);
          await page.waitForSelector('.dpanel', { visible: true, timeout: 8000 }); await sleep(450);
          if (det) await dwell(Math.max(det.holdMs || 0, HOLD.detailNormal), 'detail-open');
          const name = pre.pieces.find((p) => p.uid === action.uid)?.name;
          const tb = await buttonCenter([name, '.dpanel', 'name']); await pressAt(tb.x, tb.y); await sleep(250);
          for (let k = 0; k < 8; k++) {
            const on = await page.evaluate(() => { const b = [...document.querySelectorAll('.dpanel button')].find((x) => x.textContent.includes('确认强化')); if (!b) return false; const q = b.getBoundingClientRect(); const e = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return !!e && b.contains(e) && q.bottom < innerHeight - 4; });
            if (on) break; await glide(400, 700); await page.mouse.wheel({ deltaY: 400 }); await sleep(250);
          }
          const ok = await buttonCenter(['确认强化', '.dpanel', false]); await pressAt(ok.x, ok.y);
        }
        break;
      }
      case 'refreshShop': { const c = await centerOf('.shopbar__tools .toolbtn--amber'); await pressAt(c.x, c.y); break; }
      case 'finishShop': { const c = await buttonCenter(['结束补给', null, true]); await pressAt(c.x, c.y); break; }
      case 'place': {
        await installRefs();
        const a = await stableGeom(() => pieceRect(action.uid)), t = await stableGeom(() => tileRect(action.row, action.col)); if (!a || !t) throw new Error('no geometry for place ' + JSON.stringify(action));
        await glide(a.x, a.y); await sleep(60); await page.mouse.down(); await sleep(90);
        await glide(t.x, t.y, { slow: 1.1 }); await sleep(120); await page.mouse.up(); await sleep(260);
        const off = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[action.dir || 'E']; const d = t.s * 0.87;
        await pressAt(t.x + off[0] * d, t.y + off[1] * d);
        break;
      }
      case 'bench': {
        await installRefs();
        const a = await stableGeom(() => pieceRect(action.uid)); if (!a) throw new Error('no geometry for bench ' + action.uid);
        const slot = pre.pieces.filter((p) => !Number.isInteger(p.row)).length;
        const t = await stableGeom(() => tileRect(7, Math.min(slot, 9))); if (!t) throw new Error('no staging tile ' + slot);
        await glide(a.x, a.y); await sleep(60); await page.mouse.down(); await sleep(90);
        await glide(t.x, t.y - 30, { slow: 1.1 }); await sleep(140); await page.mouse.up(); await sleep(200);
        break;
      }
      case 'readyBattle': {
        const key = `D${pre.day}H${pre.hour}`; const bcues = narration.filter((n) => n.at?.battle === key);
        ctx.allies = pre.pieces.filter((p) => Number.isInteger(p.row)).map((p) => p.uid);
        const c = await buttonCenter(['开始战斗', null, true]); await glide(c.x, c.y); await dwellVoice(30000); await pressAt(c.x, c.y);
        await installRefs();
        await page.waitForFunction(() => { const s = window.__fieldRefs().session; if ((s?.battle?.time ?? 0) > 0.3) { window.__battleSession = s; return true; } return false; }, { timeout: 90000 });
        if (firstBattleStartSec == null) { firstBattleStartSec = +clock().toFixed(2); log('first-battle-start', { sec: firstBattleStartSec, key }); }
        // the cues of this battle are armed in the page on the sim's own event stream (no fixed seconds, no polling)
        const items = bcues.map((e) => { const w = CUES[e.id].watch; return { id: e.id, type: w.type, sourceUid: w.sourceUid, targetUid: w.targetUid, reason: w.reason, keyIncludes: w.keyIncludes, minT: Math.max(0, (e.at.t || 0) - (w.minTBefore || 0)), spec: w.manual || w.follow ? null : buildSpec(e, ctx) }; });
        if (items.length) { const ok = await page.evaluate((it) => window.__film.watch(it), items); log('battle-watch', { key, armed: items.map((x) => x.id), ok }); }
        const chain = bcues.filter((e) => CUES[e.id].watch.manual || CUES[e.id].watch.follow); let chainState = chain.length ? 'wait' : 'none';
        const lead = chain.find((e) => CUES[e.id].watch.manual) || chain[0];
        let speed = 1; if (await SPEED(4)) speed = 4; let lastSwitch = clock();
        for (;;) {
          const st = await getState(runId); if (st.revision >= i + 2) break;
          const info = await battleInfo();
          if (chainState === 'wait' && info.t >= lead.at.t - 3.2) {
            chainState = 'run'; // the chain (V18 + V19, V05a + V05b share one pause): slow to 1x, wait for the sim's own event, pause with the game's button
            if (!info.zoom && speed !== 1 && await SPEED(1)) speed = 1;
            const pb = await centerOf('.pausebtn'); await glide(pb.x, pb.y);
            let hit = true; try { await page.waitForFunction((id) => !!window.__filmHit?.[id], { polling: 'raf', timeout: 30000 }, lead.id); } catch { hit = false; }
            await page.mouse.down(); await sleep(60); await page.mouse.up();
            const pausedAt = await battleInfo(); log('battle-paused', { at: pausedAt.t, hit, lead: lead.id, hitAt: (await page.evaluate(() => window.__filmHit || {}))[lead.id] ?? null });
            await sleep(350);
            for (const e of chain) await enqueueCue(e, ctx);
            const hits = await page.evaluate(() => window.__filmHit || {}); log('chain-hits', { hits });
            const pauseMax = CUES[lead.id].watch.pauseMax;
            if (pauseMax) { // hold the pause while the lead card is read, at most pauseMax s; the rest is spoken with the battle running
              const p0 = clock();
              try { await page.waitForFunction((id) => (window.__filmLog || []).some((x) => x.ev === 'card-end' && x.id === id), { polling: 100, timeout: pauseMax * 1000 }, lead.id); } catch { /* cap reached */ }
              log('dwell', { why: 'voice', what: 'battle paused for ' + lead.id, from: +p0.toFixed(2), ms: Math.round((clock() - p0) * 1000) });
            } else { await idle(); await sleep(300); }
            await page.mouse.down(); await sleep(60); await page.mouse.up(); log('battle-resumed');
            lastSwitch = clock(); chainState = 'done'; continue;
          }
          if (chainState === 'run') { await sleep(100); continue; }
          const hinted = bcues.some((e) => !info.hit.includes(e.id) && e.at.t - info.t < 3.5 && e.at.t - info.t > -3);
          const want = info.speaking || info.zoom || hinted ? 2 : 4;
          if (want !== speed && !info.zoom && clock() - lastSwitch > 1.0) { if (await SPEED(want)) speed = want; lastSwitch = clock(); }
          await sleep(120);
        }
        await idleCap(8000); break;
      }
      case 'settleBattle': { break; }
      default: throw new Error('unsupported op type ' + action.type);
    }

    const post = await waitRevision(runId, i + 1, action.type === 'settleBattle' ? 420000 : 30000);
    log('op-done', { i, type: action.type, revision: post.revision, phase: post.phase, gold: post.gold });
    const ex = await exportRun(runId); const mineOp = ex.opJournal?.[i] ?? ex.run?.opJournal?.[i];
    const wantAction = norm(strip(action)), gotAction = norm(strip(mineOp?.action ?? {}));
    const wantResult = norm(result), gotResult = norm(mineOp?.result);
    const actionOk = same(wantAction, gotAction) || (action.type === 'leaveEvent' && gotAction.type === 'confirmEvent' && gotAction.choiceId === result.choiceId);
    if (!actionOk || !same(wantResult, gotResult)) {
      divergence = { step: i, type: action.type, expectedAction: wantAction, actualAction: gotAction, expectedResult: wantResult, actualResult: gotResult, phase: post.phase, gold: post.gold };
      throw new Error('divergence at step ' + i);
    }
    // cues about the result of this step (a merge, the 4/4 cap, the funds, ...)
    for (const e of trig('afterOp')) { const p2 = await getState(runId); ctx.allies = p2.pieces.filter((p) => Number.isInteger(p.row)).map((p) => p.uid); await enqueueCue(e, ctx); }
    // looks after the step: shop cards again, a piece's detail, the battle ledger
    for (const it of looks[i]?.after || []) {
      if (it.kind === 'hover') { if (await page.$('.scard[data-slot-idx]')) await hoverShop(1300); }
      else if (it.kind === 'openDetail' && /^piece:/.test(it.target)) {
        await installRefs(); const uid = it.target.match(/piece:(\w+)/)[1];
        let opened = false;
        for (const frac of [0.7, 0.4, 0.2]) {
          const a = await stableGeom(() => page.evaluate((u, fr) => { const f = window.__fieldRefs(); const q = f.view.pieceScreenRect(f.map.numberOf(u)); return q && { x: q.left + q.width / 2, y: q.top + q.height * fr }; }, uid, frac));
          if (!a) break; await pressAt(a.x, a.y);
          try { await page.waitForSelector('.dpanel', { visible: true, timeout: 1800 }); opened = true; break; } catch { log('detail-retry', { uid, frac }); }
        }
        if (opened) { await dwell(Math.max(it.holdMs || 0, HOLD.detailKey), 'detail-open'); await closePanel(); } else { log('detail-missing', { uid }); await page.screenshot({ path: path.join(OUT, 'detail-missing-' + uid + '.png') }).catch(() => {}); }
      } else if (it.kind === 'openDetail' && /assault-ledger/.test(it.target)) {
        const fromEnd = i >= journal.length - 1 || post.phase === 'finished' || /终局/.test(it.target);
        await sleep(between(500, 800)); await openLedger(fromEnd);
        const lc = trig('ledger'); for (const e of lc) await enqueueCue(e, ctx);
        await dwell(it.holdMs || 4000, 'voice'); if (lc.length) await dwellVoice(30000);
        await closeLedger(fromEnd);
      }
    }
    prevType = action.type;
  }
  await sleep(1500);
  await idleCap(8000);
  log('replay-finished', { ops: journal.length });
} catch (err) {
  log('FAIL', { message: String(err.stack || err).slice(0, 1200) });
  console.log('FAIL', String(err.stack || err).slice(0, 600));
  process.exitCode = 1;
  try { await page.screenshot({ path: path.join(OUT, 'failure.png') }); } catch { /* best effort */ }
}

// ---------- wrap up ----------
for (const t of timers) clearTimeout(t);
const filmSeconds = +clock().toFixed(2);
let captureResult = null;
try { if (capture) captureResult = await stopCapture(page, capture); } catch (e) { log('stop-capture-error', { text: String(e) }); }
try {
  await page.evaluate(async () => { const r = window.__SP_RECORDER__; if (r && r.status().recording) await r.stop(); });
  if (!recordingId) recordingId = await page.evaluate(() => window.__SP_RECORDING_STATUS__?.()?.id ?? null);
} catch (e) { log('stop-recording-error', { text: String(e) }); }

let refCheck = null;
try {
  if (runId && !divergence && FROM === 0) {
    const refCreated = await api('runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ directorId: orig.directorId, seed: orig.seed }) });
    let st = refCreated.state;
    for (const { action } of journal) {
      if (action.type === 'settleBattle') st = (await api(`runs/${refCreated.runId}/settle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ battleId: st.currentBattle.battleId, opId: action.opId, expectedRevision: st.revision }) })).state;
      else st = (await api(`runs/${refCreated.runId}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...action, expectedRevision: st.revision }) })).state;
    }
    const mine = await getState(runId);
    const pick = (s) => ({ phase: s.phase, day: s.day, hour: s.hour, gold: s.gold, xp: s.xp, tech: s.tech, life: s.life, relics: s.relicIds, skillRanks: s.skillRanks, revision: s.revision,
      pieces: s.pieces.map((p) => [p.uid, p.name, p.star, p.row, p.col, p.dir]) });
    refCheck = { equal: same(pick(mine), pick(st)), ui: pick(mine), api: pick(st) };
    log('reference-check', { equal: refCheck.equal });
  }
} catch (e) { log('reference-check-error', { text: String(e) }); }

let pageLog = []; try { pageLog = await page.evaluate(() => window.__film.log()); } catch { /* page gone */ }
const rel = (t) => +((t - (captureT0 ?? T0)) / 1000).toFixed(2);
const cuesTimeline = narration.map((e) => {
  const q = pageLog.find((x) => x.id === e.id && x.ev === 'cue-queued');
  const s = pageLog.find((x) => x.id === e.id && x.ev === 'card-start'), en = pageLog.find((x) => x.id === e.id && x.ev === 'card-end');
  const au = pageLog.find((x) => x.id === e.id && x.ev === 'audio-playing');
  const hit = pageLog.find((x) => x.id === e.id && x.ev === 'battle-hit');
  return { id: e.id, at: e.at, trigger: CUES[e.id]?.trigger, queuedSec: q ? rel(q.t) : null, startSec: s ? rel(s.t) : null, voiceStartSec: au ? rel(au.t) : null, endSec: en ? rel(en.t) : null, endReason: en?.why ?? null,
    durationSec: s && en ? +((en.t - s.t) / 1000).toFixed(2) : null, battleHit: hit ? { battleTime: +Number(hit.bt).toFixed(2) } : null,
    fallbackAnchor: pageLog.some((x) => x.id === e.id && x.ev === 'anchor-fallback'), zoom: pageLog.some((x) => x.id === e.id && x.ev === 'zoom-start'), frame: pageLog.some((x) => x.id === e.id && x.ev === 'frame-start') };
});
const speech = cuesTimeline.reduce((a, c) => a + (c.durationSec || 0), 0);
fs.writeFileSync(path.join(OUT, 'cues-timeline.json'), JSON.stringify({ filmSeconds, firstBattleStartSec, speechSeconds: +speech.toFixed(2), coverage: +(speech / Math.max(1, filmSeconds)).toFixed(4), cues: cuesTimeline }, null, 1));
fs.writeFileSync(path.join(OUT, 'page-log.json'), JSON.stringify(pageLog));
fs.writeFileSync(path.join(OUT, 'pointer-trace.json'), JSON.stringify(ptr));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ runId, origRunId, ops: journal.length, divergence, recordingId, capture: captureResult, captureInfo: capture?.info, timeline, refCheck, pageErrors, browserPid, filmSeconds, firstBattleStartSec }, null, 2));
if (divergence) fs.writeFileSync(path.join(OUT, 'divergence.json'), JSON.stringify(divergence, null, 2));
if (recordingId) fs.writeFileSync(path.join(OUT, 'recording-id.txt'), recordingId + '\n');
try { const c = prio(''); log('cpu-seconds', { total: +c.reduce((a, x) => a + (x.cpuSec || 0), 0).toFixed(1), byProcess: c.map((x) => x.pid ? `${x.name}:${x.pid}:${x.cpuSec}` : x.error) }); } catch { /* best effort */ }
try { await browser.close(); log('browser-closed', { pid: browserPid }); } catch { /* already gone */ }
mediaServer.close();
console.log('done', JSON.stringify({ divergence: !!divergence, recordingId, mp4: capture ? MP4 : null, capture: captureResult }));
process.exit(process.exitCode || 0);
