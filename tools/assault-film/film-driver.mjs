/* global document, window */
// Replay-style film driver for 进击.
// Replays a saved run's opJournal on the REAL game UI (same seed + leader, fresh run): every step is a real mouse click or
// drag through puppeteer's input pipeline; the picture is rendered live by the GPU and recorded by the browser's own tab
// capture + MediaRecorder (see capture.mjs). Cursor, subtitles, narration are page overlays (overlay.page.js).
//
// usage: node film-driver.mjs --out <dir> --until <journalIndexExclusive> [--narration <json>] [--voice <dir>] [--no-capture]
//        [--session <player-session.json>] [--base http://127.0.0.1:13004] [--fps 60] [--video-bps 2600000]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CHROME, GPU_ARGS, CAPTURE_ARGS } from './gpu-args.mjs';
import { startCapture, stopCapture } from './capture.mjs';

const ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const puppeteer = createRequire(ROOT + '/package.json')('puppeteer-core');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i < 0 ? dflt : (argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[i + 1]); };
const OUT = opt('out'); if (!OUT) throw new Error('--out is required');
const UNTIL = Number(opt('until', 40));
const BASE = opt('base', 'http://127.0.0.1:13004');
const SESSION = opt('session', ROOT + '/runtime/assault/film-1103/run2/session.json');
const NO_CAPTURE = !!opt('no-capture', false);
const FPS = Number(opt('fps', 60));
const VIDEO_BPS = Number(opt('video-bps', 2_300_000));
const NARRATION = opt('narration', null);
const VOICE_DIR = opt('voice', null);
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
const FROM = Number(opt('from', 0)); // fast-forward by API to this step (debug runs and second segments only); a full film starts at 0
const narration = NARRATION ? JSON.parse(fs.readFileSync(NARRATION, 'utf8')).entries : [];
const { CUES } = await import('./cues.mjs');
const stepCues = (i) => narration.filter((n) => n.atStep === i);
const battleCues = (key) => narration.filter((n) => n.orBattleEvent && n.orBattleEvent.battle === key).sort((a, b) => a.orBattleEvent.t - b.orBattleEvent.t);

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
const getState = async (runId) => (await api(`runs/${runId}`)).state;
const exportRun = async (runId) => (await api(`runs/${runId}/export`));
async function waitRevision(runId, rev, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  for (;;) { const s = await getState(runId); if (s.revision >= rev) return s; if (Date.now() > end) throw new Error(`timeout waiting for revision ${rev} (at ${s.revision}, phase ${s.phase})`); await sleep(80); }
}

// ---------- browser ----------
const profile = `${ROOT}/.omni/tmp/assault/film-1103/profile-film-${Date.now()}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', pipe: true, ignoreDefaultArgs: ['--mute-audio'], userDataDir: profile, args: [...GPU_ARGS, ...CAPTURE_ARGS] });
const browserPid = browser.process().pid;
fs.writeFileSync(path.join(OUT, 'browser.pid'), String(browserPid));
log('browser', { pid: browserPid, profile });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(fs.readFileSync(new URL('./overlay.page.js', import.meta.url), 'utf8'));
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(String(e).slice(0, 300)); log('pageerror', { text: String(e).slice(0, 300) }); });

// ---------- humanised pointer ----------
const pointer = { x: Math.round(1920 * 0.62), y: Math.round(1080 * 0.66), flip: 1 };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
async function glide(x, y, { slow = 1 } = {}) {
  const dx = x - pointer.x, dy = y - pointer.y, dist = Math.hypot(dx, dy);
  if (dist < 2) return;
  const dur = Math.min(380, 110 + dist * 0.18) * slow; // revision 1: 110 ms + 0.18 ms/px, capped at 380 ms
  const nx = -dy / dist, ny = dx / dist, bow = dist * 0.1 * pointer.flip; pointer.flip *= -1;
  const cx = pointer.x + dx / 2 + nx * bow, cy = pointer.y + dy / 2 + ny * bow;
  const x0 = pointer.x, y0 = pointer.y;
  const steps = Math.max(2, Math.round(dur / 16)); const t0 = performance.now();
  log('glide', { from: [Math.round(x0), Math.round(y0)], to: [Math.round(x), Math.round(y)], ms: Math.round(dur) });
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps), a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    const px = a * x0 + b * cx + c * x, py = a * y0 + b * cy + c * y;
    await page.mouse.move(px, py);
    const wait = t0 + i * (dur / steps) - performance.now(); if (wait > 0) await sleep(wait);
  }
  pointer.x = x; pointer.y = y;
}
async function pressAt(x, y) { await glide(x, y); await sleep(30); log('click', { at: [Math.round(x), Math.round(y)] }); await page.mouse.down(); await sleep(80); await page.mouse.up(); }

async function centerOf(selector) {
  // wait until the element stops moving (card slide-ins, layout reflow) so the click lands on what the viewer sees
  const h = await page.waitForSelector(selector, { visible: true, timeout: 20000 });
  let box = await h.boundingBox();
  for (let k = 0; k < 40; k++) { await sleep(60); const b2 = await h.boundingBox(); if (b2 && box && Math.abs(b2.x - box.x) < 1.5 && Math.abs(b2.y - box.y) < 1.5) { box = b2; break; } box = b2; }
  await h.dispose();
  return { x: box.x + box.width / 2 + between(-box.width * 0.12, box.width * 0.12), y: box.y + box.height / 2 + between(-box.height * 0.1, box.height * 0.1) };
}
const centerOfButton = async (text, timeout = 20000) => {
  await page.waitForFunction((t) => [...document.querySelectorAll('button')].some((b) => !b.disabled && b.textContent.trim() === t), { timeout }, text);
  const r = await page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => !x.disabled && x.textContent.trim() === t); const q = b.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; }, text);
  return { x: r.x + r.w / 2 + between(-r.w * 0.1, r.w * 0.1), y: r.y + r.h / 2 + between(-r.h * 0.1, r.h * 0.1) };
};

// ---------- field geometry (read-only access to the game's own view for tile / piece screen positions; refs live in overlay.page.js) ----------
const installRefs = () => page.waitForFunction(() => { const f = window.__fieldRefs(); return f.view?.pieceScreenRect && f.map; }, { timeout: 60000 });
const pieceRect = (uid) => page.evaluate((u) => { const f = window.__fieldRefs(); const q = f.view.pieceScreenRect(f.map.numberOf(u)); return q && { x: q.left + q.width / 2, y: q.top + q.height * 0.7 }; }, uid);
const tileRect = (r, c) => page.evaluate((r, c) => { const f = window.__fieldRefs(); const t = f.view.tileScreen(r, c); return t && { x: t.x, y: t.y, s: t.s }; }, r, c);
// a scene that is still settling (camera move after a screen change) gives moving geometry: wait until a reading holds still
async function stableGeom(read, tries = 60) {
  let prev = null;
  for (let k = 0; k < tries; k++) {
    const cur = await read();
    if (cur && prev && Math.abs(cur.x - prev.x) < 1.5 && Math.abs(cur.y - prev.y) < 1.5) { await sleep(120); const again = await read(); if (again && Math.abs(again.x - cur.x) < 1.5 && Math.abs(again.y - cur.y) < 1.5) return again; }
    prev = cur; await sleep(150);
  }
  return prev;
}
const buttonCenter = async (pred, timeout = 8000) => {
  // pred: [text, scopeSelector?, exact?]; returns the centre of the first visible enabled button whose text matches
  const [text, scope, exact] = pred;
  await page.waitForFunction((t, sc, ex) => [...document.querySelectorAll((sc || 'body') + ' button')].some((b) => !b.disabled && b.getBoundingClientRect().width > 0 && (ex === 'name' ? (b.textContent.trim() === t || b.textContent.trim().startsWith(t + '替换')) : ex ? b.textContent.trim() === t : b.textContent.includes(t))), { timeout }, text, scope, exact);
  const r = await page.evaluate((t, sc, ex) => { const b = [...document.querySelectorAll((sc || 'body') + ' button')].find((x) => !x.disabled && x.getBoundingClientRect().width > 0 && (ex === 'name' ? (x.textContent.trim() === t || x.textContent.trim().startsWith(t + '替换')) : ex ? x.textContent.trim() === t : x.textContent.includes(t))); const q = b.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; }, text, scope, exact);
  return { x: r.x + r.w / 2 + between(-r.w * 0.1, r.w * 0.1), y: r.y + r.h / 2 + between(-r.h * 0.1, r.h * 0.1) };
};

// ---------- narration: floating guide cards (overlay.page.js) ----------
// Cues are queued in the page and play one after another (one voice clip and one card per part). The driver waits for the queue
// only right before a step that leaves the screen the card points at (`idle`), at most until the last voice ends + 0.2 s.
const spoken = [];
const whenOf = (entry, type) => CUES[entry.id]?.when ?? (['place', 'readyBattle', 'settleBattle', 'bench'].includes(type) ? 'after' : 'before');
const resolveAnchor = (an, ctx) => {
  if (!an) return an;
  if (an.kind === 'sel' && an.sel === '$slot') return { kind: 'sel', sel: ctx.slotSel };
  if (an.kind === 'sel' && an.sel === '$choice') return { kind: 'sel', sel: ctx.choiceSel };
  if (an.kind === 'allies') return { kind: 'allies', uids: ctx.allies || [] };
  return an;
};
async function enqueueCue(entry, ctx = {}) {
  const def = CUES[entry.id]; if (!def) throw new Error('no cue anchor for ' + entry.id);
  const parts = entry.parts.map((text, k) => {
    const f = `${entry.id}_${k + 1}.wav`; const has = VOICE_DIR && fs.existsSync(path.join(VOICE_DIR, f));
    return { text, url: has ? `http://127.0.0.1:${mediaPort}/v/${encodeURIComponent(f)}` : null, fallbackSec: Math.max(2, text.length / 5) };
  });
  const spec = { id: entry.id, tag: def.tag, parts, anchor: resolveAnchor(def.anchor, ctx), fallback: resolveAnchor(def.fallback, ctx), sides: def.sides, avoid: [...(def.avoid || []), ...(ctx.avoid || [])] };
  await page.evaluate((sp) => window.__film.enqueue(sp), spec);
  spoken.push({ id: entry.id, atStep: entry.atStep, event: entry.orBattleEvent, queuedSec: +clock().toFixed(2), anchor: entry.anchor, parts: entry.parts });
  log('cue-queued', { id: entry.id });
  if (process.env.FILM_CARDSHOT) for (const ms of [2500, 9000]) setTimeout(() => { fs.mkdirSync(path.join(OUT, 'cards'), { recursive: true }); page.screenshot({ path: path.join(OUT, 'cards', `${entry.id}-${ms}.png`) }).catch(() => {}); }, ms);
}
const enqueueAll = async (list, ctx) => { for (const e of list) await enqueueCue(e, ctx); };
const idle = async () => { await page.evaluate(() => window.__film.whenIdle()); await sleep(200); };
const speakingNow = () => page.evaluate(() => window.__film.speaking()).catch(() => false);

// ---------- state-derived targets ----------
const strip = (o) => { const { opId, expectedRevision, ...rest } = o; return rest; };
let origRunId = orig.runId; let runId = null;
const norm = (o) => JSON.parse(JSON.stringify(o ?? null).split(origRunId).join('RUN').split(runId).join('RUN'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// pick-one overlays: hover the card, show the cues with the voice, then arm + confirm the moment the voice has ended
async function pickCard(idx, before, ctx) {
  const sel = `.spcard[data-choice-idx="${idx}"]`; ctx.choiceSel = sel;
  const c = await centerOf(sel); await glide(c.x, c.y);
  if (before.length) { await enqueueAll(before, ctx); await idle(); } else await idle();
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
async function closePanel() { // the detail drawer a piece click opens: close it with its own button
  const h = await page.$('.dpanel__close'); if (!h) return; const b = await h.boundingBox(); await h.dispose(); if (!b) return; await pressAt(b.x + b.width / 2, b.y + b.height / 2); await sleep(250);
}
const SPEED = async (n) => { try { const chip = await buttonCenter([n + '×', '.ix-battlebar', true], 2500); await pressAt(chip.x, chip.y); log('battle-speed', { speed: n }); return true; } catch { return false; } };
const battleInfo = () => page.evaluate(() => ({ t: window.__battleSession?.battle?.time ?? 0, speaking: window.__film.speaking() })).catch(() => ({ t: 0, speaking: false }));

// ---------- the replay ----------
let divergence = null; let capture = null; let recordingId = null; const timeline = [];
let lastScreen = '';
try {
  const created = await api('runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ directorId: orig.directorId, seed: orig.seed }) });
  runId = created.runId; log('run-created', { runId, seed: orig.seed, directorId: orig.directorId, firstNodes: created.state.nodes.map((n) => n.id) });
  if (FROM > 0) { // fast-forward by API (debug / second segment): the same ops, applied without a picture
    let st = created.state;
    for (let k = 0; k < FROM; k++) {
      const { action } = journal[k];
      const r = action.type === 'settleBattle'
        ? await api(`runs/${runId}/settle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ battleId: st.currentBattle.battleId, opId: action.opId, expectedRevision: st.revision }) })
        : await api(`runs/${runId}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...action, expectedRevision: st.revision }) });
      if (!r.state) throw new Error('fast-forward failed at ' + k + ' ' + JSON.stringify(r).slice(0, 200));
      st = r.state;
    }
    log('fast-forwarded', { to: FROM, phase: st.phase });
  }
  const NO_RECORD = !!opt('no-record', false);
  const url = `${BASE}/assault.html?run=${runId}${NO_RECORD ? '' : '&record=1&recordFps=' + opt('record-fps', 10) + '&recordMax=' + opt('record-max', 1280)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const glInfo = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
  log('webgl', { renderer: glInfo }); if (/swiftshader|basic render|llvmpipe/i.test(glInfo)) throw new Error('software renderer: ' + glInfo);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '继续'), { timeout: 30000 });
  await sleep(1500);
  // the title click and the scene load happen before the tape rolls (loading stalls are not part of the film)
  const cont = await buttonCenter(['继续', null, true]); await pressAt(cont.x, cont.y); log('resume-click');
  await page.waitForSelector('.spcard, .scard, [data-testid="deploy-cap"]', { timeout: 60000 });
  await sleep(3000);
  recordingId = await page.evaluate(() => window.__SP_RECORDING_STATUS__?.()?.id ?? null);
  if (!NO_CAPTURE) { capture = await startCapture(page, MP4, { fps: FPS, videoBps: VIDEO_BPS }); captureT0 = Date.now(); log('capture-start', capture.info); }
  await sleep(900);

  let prevType = 'resume';
  for (let i = FROM; i < journal.length; i++) {
    const { action, result } = journal[i];
    const isSettle = action.type === 'settleBattle';
    const pre = await getState(runId);
    if (!isSettle && pre.revision !== i) throw new Error(`state revision ${pre.revision} before op ${i}`);
    const screenKey = `${pre.phase}`;
    const newScreen = screenKey !== lastScreen || ['selectNode', 'finishShop', 'settleBattle', 'chooseRelic', 'chooseSkill', 'chooseUpgrade', 'readyBattle', 'resume', 'confirmEvent', 'leaveEvent'].includes(prevType);
    if (!isSettle) { if (newScreen) await sleep(between(400, 600)); else await sleep(between(120, 250)); }
    lastScreen = screenKey;
    log('op-start', { i, type: action.type, phase: pre.phase });
    if (process.env.FILM_SHOTS) { fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true }); await page.screenshot({ path: path.join(OUT, 'shots', 'op-' + String(i).padStart(3, '0') + '-' + action.type + '.png') }); }
    timeline.push({ i, type: action.type, startSec: +clock().toFixed(2) });
    const cues = stepCues(i);
    const before = cues.filter((c) => whenOf(c, action.type) === 'before');
    const after = cues.filter((c) => whenOf(c, action.type) === 'after');
    const ctx = {};
    const slotCard = async () => { // the shop card this step buys
      const idx = pre.shop.slots.findIndex((s) => s.slotId === action.slotId); if (idx < 0) throw new Error('slot not offered: ' + action.slotId);
      ctx.slotSel = `.scard[data-slot-idx="${idx}"]`; const c = await centerOf(ctx.slotSel); await glide(c.x, c.y); return c;
    };
    if (!['bench'].includes(action.type)) await closePanel();
    const cueThenWait = async () => { if (before.length) await enqueueAll(before, ctx); await idle(); };

    switch (action.type) {
      case 'selectNode': {
        const idx = pre.nodes.findIndex((n) => n.id === action.nodeId); if (idx < 0) throw new Error('node not offered: ' + action.nodeId);
        await pickCard(idx, before, ctx); break;
      }
      case 'buy': case 'buySkill': {
        const c = await slotCard(); await cueThenWait();
        await pressAt(c.x, c.y); await sleep(220); const c2 = await centerOf(ctx.slotSel); await pressAt(c2.x, c2.y); break;
      }
      case 'enchantPiece': {
        const c = await slotCard(); await cueThenWait();
        await pressAt(c.x, c.y); await sleep(220); const c2 = await centerOf(ctx.slotSel); await pressAt(c2.x, c2.y);
        await page.waitForSelector('.dpanel', { visible: true, timeout: 8000 }); await sleep(450);
        const name = pre.pieces.find((p) => p.uid === action.uid)?.name;
        const tb = await buttonCenter([name, '.dpanel', 'name']); await pressAt(tb.x, tb.y); await sleep(250);
        // the target list can push 确认强化 below the panel's fold: scroll the panel with the wheel until the button is really on top
        for (let k = 0; k < 8; k++) {
          const on = await page.evaluate(() => { const b = [...document.querySelectorAll('.dpanel button')].find((x) => x.textContent.includes('确认强化')); if (!b) return false; const q = b.getBoundingClientRect(); const e = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return !!e && b.contains(e) && q.bottom < innerHeight - 4; });
          if (on) break; await glide(400, 700); await page.mouse.wheel({ deltaY: 400 }); await sleep(250);
        }
        const ok = await buttonCenter(['确认强化', '.dpanel', false]); await pressAt(ok.x, ok.y); break;
      }
      case 'refreshShop': {
        const c = await centerOf('.shopbar__tools .toolbtn--amber'); await glide(c.x, c.y); await cueThenWait(); await pressAt(c.x, c.y); break;
      }
      case 'finishShop': {
        const c = await buttonCenter(['结束补给', null, true]); await glide(c.x, c.y); await cueThenWait(); await pressAt(c.x, c.y); break;
      }
      case 'place': {
        await installRefs();
        const a = await stableGeom(() => pieceRect(action.uid)), t = await stableGeom(() => tileRect(action.row, action.col)); if (!a || !t) throw new Error('no geometry for place ' + JSON.stringify(action));
        await glide(a.x, a.y); await sleep(60); await page.mouse.down(); await sleep(90);
        await glide(t.x, t.y, { slow: 1.1 }); await sleep(120); await page.mouse.up(); await sleep(260);
        const off = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[action.dir || 'E']; const d = t.s * 0.87;
        await pressAt(t.x + off[0] * d, t.y + off[1] * d); break;
      }
      case 'bench': {
        // drag the piece back onto the staging row (the game's own drop target for 撤退)
        await installRefs();
        const a = await stableGeom(() => pieceRect(action.uid)); if (!a) throw new Error('no geometry for bench ' + action.uid);
        const slot = pre.pieces.filter((p) => !Number.isInteger(p.row)).length;
        const t = await stableGeom(() => tileRect(7, Math.min(slot, 9))); if (!t) throw new Error('no staging tile ' + slot);
        await glide(a.x, a.y); await sleep(60); await page.mouse.down(); await sleep(90);
        await glide(t.x, t.y - 30, { slow: 1.1 }); await sleep(140); await page.mouse.up(); await sleep(200); break;
      }
      case 'readyBattle': {
        const key = `D${pre.day}H${pre.hour}`; const evs = battleCues(key);
        const board = pre.pieces.filter((p) => Number.isInteger(p.row)).map((p) => p.uid); ctx.allies = board;
        const c = await buttonCenter(['开始战斗', null, true]); await glide(c.x, c.y); await idle(); await pressAt(c.x, c.y);
        await installRefs();
        await page.waitForFunction(() => { const s = window.__fieldRefs().session; if ((s?.battle?.time ?? 0) > 0.3) { window.__battleSession = s; return true; } return false; }, { timeout: 90000 });
        let speed = 0; if (await SPEED(2)) speed = 2; let lastSwitch = clock();
        await enqueueAll(after, ctx);
        const groups = []; for (const e of evs) { const g = groups.find((x) => Math.abs(x.t - e.orBattleEvent.t) < 0.01); if (g) g.list.push(e); else groups.push({ t: e.orBattleEvent.t, list: [e], done: false }); }
        const pauseBtn = '.pausebtn';
        for (;;) {
          const st = await getState(runId); if (st.revision >= i + 2) break;
          const info = await battleInfo();
          const next = groups.find((g) => !g.done);
          if (next) {
            // the chain group (several cues at one instant) is held with the game's own pause button
            if (next.list.length > 1 && info.t >= next.t - 1.6 && info.t < next.t) {
              const pb = await centerOf(pauseBtn); await glide(pb.x, pb.y);
              await page.waitForFunction((T) => (window.__battleSession.battle.time ?? 0) >= T - 0.1, { polling: 'raf', timeout: 60000 }, next.t);
              await page.mouse.down(); await sleep(60); await page.mouse.up();
              const pausedAt = await battleInfo(); log('battle-paused', { at: pausedAt.t, want: next.t, group: next.list.map((e) => e.id) });
              next.done = true; await sleep(350);
              await enqueueAll(next.list, { ...ctx }); await idle(); await sleep(300);
              await page.mouse.down(); await sleep(60); await page.mouse.up(); log('battle-resumed');
              lastSwitch = clock(); continue;
            }
            if (next.list.length === 1 && info.t >= next.t) { next.done = true; await enqueueAll(next.list, ctx); continue; }
            if (next.list.length > 1 && info.t >= next.t) { next.done = true; await enqueueAll(next.list, ctx); continue; }
          }
          const near = next && next.t - info.t < 3.5;
          const want = info.speaking || info.t < 10 || near ? 2 : 4;
          if (want !== speed && clock() - lastSwitch > 1.0) { if (await SPEED(want)) speed = want; lastSwitch = clock(); }
          await sleep(120);
        }
        await idle(); break;
      }
      case 'settleBattle': { /* the game posts the settlement itself when its battle ends */ break; }
      case 'chooseRelic': {
        const choices = (pre.rewardQueue?.[0]?.choices) ?? pre.rewards?.choices; const idx = choices.indexOf(action.relicId); if (idx < 0) throw new Error('relic not offered ' + action.relicId);
        await pickCard(idx, before, ctx); break;
      }
      case 'chooseSkill': {
        const idx = pre.skillRewards.choices.indexOf(action.skillId); if (idx < 0) throw new Error('skill not offered ' + action.skillId);
        await pickCard(idx, before, ctx); break;
      }
      case 'chooseUpgrade': {
        const idx = pre.upgradeRewards.choices.indexOf(action.uid); if (idx < 0) throw new Error('upgrade not offered ' + action.uid);
        await pickCard(idx, before, ctx); break;
      }
      case 'confirmEvent': case 'leaveEvent': {
        const cid = action.type === 'leaveEvent' ? result.choiceId : action.choiceId;
        const idx = pre.choices.findIndex((c) => c.id === cid); if (idx < 0) throw new Error('event choice not offered ' + cid);
        await pickCard(idx, before, ctx);
        if (action.targetUid || action.filterTag) { // recruit-style choice: the game asks for a profession and an operator
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
      default: throw new Error('unsupported op type ' + action.type);
    }

    const post = await waitRevision(runId, i + 1, action.type === 'settleBattle' ? 420000 : 30000);
    log('op-done', { i, type: action.type, revision: post.revision, phase: post.phase, gold: post.gold });
    // exact comparison with the saved run (a leaveEvent is the game's 离开 card, i.e. the same event choice sent as confirmEvent)
    const ex = await exportRun(runId); const mine = ex.opJournal?.[i] ?? ex.run?.opJournal?.[i];
    const wantAction = norm(strip(action)), gotAction = norm(strip(mine?.action ?? {}));
    const wantResult = norm(result), gotResult = norm(mine?.result);
    const actionOk = same(wantAction, gotAction) || (action.type === 'leaveEvent' && gotAction.type === 'confirmEvent' && gotAction.choiceId === result.choiceId);
    if (!actionOk || !same(wantResult, gotResult)) {
      divergence = { step: i, type: action.type, expectedAction: wantAction, actualAction: gotAction, expectedResult: wantResult, actualResult: gotResult, phase: post.phase, gold: post.gold };
      throw new Error('divergence at step ' + i);
    }
    // cues that belong after the step (the result of a placement, the battle's ledger, ...)
    if (after.length && action.type !== 'readyBattle') {
      const post2 = await getState(runId); ctx.allies = post2.pieces.filter((p) => Number.isInteger(p.row)).map((p) => p.uid);
      const needLedger = after.some((c) => CUES[c.id]?.pre);
      if (needLedger) {
        const fromEnd = after.some((c) => CUES[c.id].pre === 'ledger-end');
        await sleep(between(500, 800)); await openLedger(fromEnd); await enqueueAll(after, ctx); await idle(); await closeLedger(fromEnd);
      } else await enqueueAll(after, ctx);
    }
    prevType = action.type;
  }
  await sleep(1500);
  await idle();
  log('replay-finished', { ops: journal.length });
} catch (err) {
  log('FAIL', { message: String(err.stack || err).slice(0, 1200) });
  console.log('FAIL', String(err.stack || err).slice(0, 600));
  process.exitCode = 1;
  try { await page.screenshot({ path: path.join(OUT, 'failure.png') }); } catch { /* best effort */ }
}

// ---------- wrap up ----------
let captureResult = null;
try { if (capture) captureResult = await stopCapture(page, capture); } catch (e) { log('stop-capture-error', { text: String(e) }); }
try {
  await page.evaluate(async () => { const r = window.__SP_RECORDER__; if (r && r.status().recording) await r.stop(); });
  if (!recordingId) recordingId = await page.evaluate(() => window.__SP_RECORDING_STATUS__?.()?.id ?? null);
} catch (e) { log('stop-recording-error', { text: String(e) }); }

// reference check: the same prefix applied by API only, compared with the UI-driven run's final state
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
const cuesTimeline = spoken.map((r) => { const cards = pageLog.filter((x) => x.id === r.id && x.ev === 'card-start').map((x) => { const end = pageLog.find((y) => y.id === r.id && y.part === x.part && y.ev === 'card-end'); return { part: x.part, chunks: x.chunks, startSec: rel(x.t), endSec: end ? rel(end.t) : null, why: end?.ev ? undefined : undefined }; });
  const fb = pageLog.some((x) => x.id === r.id && x.ev === 'anchor-fallback');
  return { id: r.id, atStep: r.atStep ?? null, battleEvent: r.event ?? null, anchor: r.anchor, queuedSec: r.queuedSec, startSec: cards[0]?.startSec ?? null, endSec: cards.at(-1)?.endSec ?? null, usedFallbackAnchor: fb, cards }; });
fs.writeFileSync(path.join(OUT, 'cues-timeline.json'), JSON.stringify(cuesTimeline, null, 1));
fs.writeFileSync(path.join(OUT, 'page-log.json'), JSON.stringify(pageLog));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ runId, origRunId, ops: journal.length, divergence, recordingId, capture: captureResult, captureInfo: capture?.info, timeline, refCheck, pageErrors, browserPid }, null, 2));
if (divergence) fs.writeFileSync(path.join(OUT, 'divergence.json'), JSON.stringify(divergence, null, 2));
if (recordingId) fs.writeFileSync(path.join(OUT, 'recording-id.txt'), recordingId + '\n');
try { await browser.close(); log('browser-closed', { pid: browserPid }); } catch { /* already gone */ }
mediaServer.close();
console.log('done', JSON.stringify({ divergence: !!divergence, recordingId, mp4: capture ? MP4 : null, capture: captureResult }));
process.exit(process.exitCode || 0);
