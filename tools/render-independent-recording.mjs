#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';

const gunzip = promisify(zlib.gunzip);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FFMPEG = 'C:/Users/lilithgames/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe';

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) throw new Error(`invalid argument near ${key}`);
    out[key.slice(2)] = argv[++i];
  }
  for (const key of ['recording-id', 'session-id', 'recordings-dir', 'session-dir', 'timeline-json', 'install-root', 'output-root', 'rounds']) {
    if (!out[key]) throw new Error(`missing --${key}`);
  }
  if (!UUID.test(out['recording-id']) || !UUID.test(out['session-id'])) throw new Error('recording and session IDs must be UUIDs');
  const secs = out['sample-seconds'] == null ? null : Number(out['sample-seconds']);
  if (secs != null && (!Number.isFinite(secs) || secs <= 0 || secs > 30)) throw new Error('--sample-seconds must be in (0,30] when supplied');
  const rounds = out.rounds.split(',').map(Number);
  if (!rounds.length || rounds.some((n) => !Number.isInteger(n) || n < 1 || n > 99)) throw new Error('--rounds must be comma-separated positive integers');
  out.sampleSeconds = secs;
  out.roundList = [...new Set(rounds)];
  return out;
}

export function ivfHeader(width, height, fps = 30, codec = 'VP80') {
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(fps) || !['VP80', 'VP90'].includes(codec)) throw new TypeError('invalid IVF parameters');
  const b = Buffer.alloc(32); b.write('DKIF', 0); b.writeUInt16LE(0, 4); b.writeUInt16LE(32, 6); b.write(codec, 8, 4, 'ascii');
  b.writeUInt16LE(width, 12); b.writeUInt16LE(height, 14); b.writeUInt32LE(fps, 16); b.writeUInt32LE(1, 20); b.writeUInt32LE(0xffffffff, 24); return b;
}

export async function writeIvfFrame(stdin, payload, pts) {
  const data = Buffer.from(payload);
  const header = Buffer.alloc(12); header.writeUInt32LE(data.length, 0); header.writeBigUInt64LE(BigInt(pts), 4);
  if (!stdin.write(header)) await once(stdin, 'drain');
  if (!stdin.write(data)) await once(stdin, 'drain');
}

const mime = (file) => file.endsWith('.json') ? 'application/json; charset=utf-8' : file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
const inside = (root, candidate) => { const rel = path.relative(root, candidate); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };

async function main(argv) {
  const args = parseArgs(argv);
  const outputRoot = path.resolve(args['output-root']);
  await fsp.mkdir(outputRoot, { recursive: true });
  const progressFile = path.join(outputRoot, 'renderer.progress.log');
  const stage = (s) => { fs.appendFileSync(progressFile, `${new Date().toISOString()} ${s}\n`); console.log(`[renderer] ${s}`); };
  const recordingId = args['recording-id'], sessionId = args['session-id'];
  stage('reading recording metadata');
  const recDir = path.resolve(args['recordings-dir'], recordingId);
  const sourceMetaPath = path.join(recDir, 'meta.json');
  const eventsPath = path.join(recDir, 'events.jsonl');
  const meta = JSON.parse(await fsp.readFile(sourceMetaPath, 'utf8'));
  if (meta.id !== recordingId) throw new Error('recording metadata ID mismatch');
  let hrefBound = false;
  const eventLines = readline.createInterface({ input: fs.createReadStream(eventsPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of eventLines) { try { const e = JSON.parse(line); const href = e?.p?.data?.href; if (e.sid === recordingId && e.kind === 'rrweb' && e.p?.type === 4 && new URL(href).searchParams.get('session') === sessionId) { hrefBound = true; break; } } catch { /* unrelated event shape */ } }
  eventLines.close();
  if (!hrefBound) throw new Error('recording events do not bind the explicit session UUID');
  stage('recording/session link verified from RRWeb href');
  const timelinePath = path.resolve(args['timeline-json']);
  stage('reading timeline and mapping requested rounds');
  const timeline = JSON.parse(await fsp.readFile(timelinePath, 'utf8'));
  if (timeline.recordingId !== recordingId) throw new Error('timeline recording ID mismatch');
  const clips = args.roundList.map((round) => {
    const clip = timeline.rounds?.find((x) => Number(x.round) === round);
    if (!clip || !Number.isFinite(clip.startSecond) || !Number.isFinite(clip.endSecond)) throw new Error(`timeline has no validated round ${round}`);
    return { round, startSecond: clip.startSecond, endSecond: clip.endSecond, observations: clip.observations || [] };
  });
  const replays = {};
  for (const clip of clips) {
    const sourcePath = path.resolve(args['session-dir'], `${sessionId}.replay-r${clip.round}.json.gz`);
    stage(`reading native replay gzip R${clip.round}`);
    const replay = JSON.parse(await gunzip(await fsp.readFile(sourcePath)));
    if (!replay.field || !Array.isArray(replay.frames) || !replay.frames.length) throw new Error(`native R${clip.round} replay payload lacks field/frames`);
    replay.sourcePath = sourcePath;
    replays[clip.round] = replay;
  }
  const wtRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wtRoot, encoding: 'utf8' }).trim();
  const installRoot = path.resolve(args['install-root']);
  const publicRoot = path.join(installRoot, 'public');
  const fixture = { replays, clips, sampleSeconds: args.sampleSeconds, source: { recordingId, sessionId } };
  let ffmpeg = null, ffmpegOutput = null, ffmpegError = '', browser = null;
  stage(`input validated; ${clips.length} round(s), intervals ${clips[0].startSecond}-${clips.at(-1).endSecond}s`);
  const portProxy = (req, res) => {
    const u = new URL(req.url, 'http://local');
    if (u.pathname.startsWith('/data/') || u.pathname.startsWith('/assets/') || u.pathname.startsWith('/vendor/') || u.pathname.startsWith('/fonts/') || u.pathname === '/independent/api/catalog') {
      const upstream = http.request({ hostname: '127.0.0.1', port: 13000, path: req.url, method: 'GET' }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
      upstream.on('error', (e) => { res.writeHead(502); res.end(e.message); }); upstream.end(); return true;
    }
    return false;
  };
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' && !(req.method === 'POST' && req.url === '/__ivf')) { res.writeHead(405); return res.end(); }
    if (portProxy(req, res)) return;
    if (req.url === '/__fixture.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(fixture)); }
    if (req.url === '/__harness') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><html lang="zh-CN" class="ix-ws"><head><meta charset="utf-8"><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/css/screens/game.css"><link rel="stylesheet" href="/css/devices.css"><link rel="stylesheet" href="/css/workshop.css"><style>html,body,#screen{margin:0;width:2187px;height:1077px;overflow:hidden;background:#0a0e0d}#screen{position:relative}.gm__field{position:absolute;inset:0}</style></head><body><div id="screen" class="gm"><div id="host" class="gm__field"></div></div><script type="module" src="/__entry.js"></script></body></html>');
    }
    if (req.url === '/__entry.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(browserEntry());
    }
    if (req.url === '/__ivf' && req.method === 'POST') { res.writeHead(204); req.resume(); return res.end(); }
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname).replace(/^\/+/, '');
    let target = path.resolve(publicRoot, pathname);
    if (!inside(publicRoot, target)) { res.writeHead(400); return res.end(); }
    if (pathname.startsWith('shared/') || pathname.startsWith('sim/')) target = path.resolve(installRoot, pathname);
    if (pathname === 'js/recording/canvasMedia.js') target = path.join(wtRoot, 'public', 'js', 'recording', 'canvasMedia.js');
    if (pathname === 'js/render/app.js') target = path.join(wtRoot, 'public', 'js', 'render', 'app.js');
    if (pathname === 'js/independent/renderRecordedBattle.js' || pathname === 'js/independent/recordingCanvas.js') target = path.join(wtRoot, 'public', 'js', 'independent', path.basename(pathname));
    try { const body = await fsp.readFile(target); res.writeHead(200, { 'content-type': mime(target), 'cache-control': 'no-store' }); res.end(body); }
    catch (err) { stage(`static 404 ${pathname} => ${target} (${err.code || err.message})`); res.writeHead(404); res.end('not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  stage(`isolated readonly HTTP fixture listening on 127.0.0.1:${port}`);
  const ffprobe = 'C:/Users/lilithgames/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffprobe.exe';
  let puppeteer;
  try {
    const { createRequire } = await import('node:module');
    puppeteer = createRequire(path.join(installRoot, 'package.json'))('puppeteer-core');
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webcodecs', '--use-gl=angle', '--use-angle=d3d11'] });
    stage(`Chrome launched; pid=${browser.process()?.pid || 'unknown'}`);
    const page = await browser.newPage();
    await page.setViewport({ width: 2187, height: 1077, deviceScaleFactor: 1.25 });
    page.on('console', (m) => { if (m.type() === 'error') console.error(`browser: ${m.text()}`); });
    page.on('pageerror', (e) => console.error(`pageerror: ${e.stack || e}`));
    page.exposeFunction('__encoderChunk', async (payload) => {
      if (!ffmpeg?.stdin.writable) throw new Error('FFmpeg input pipe is closed');
      await writeIvfFrame(ffmpeg.stdin, Buffer.from(payload.data, 'base64'), payload.pts);
    });
    page.exposeFunction('__rendererProgress', (value) => stage(`browser: ${value}`));
    page.setDefaultNavigationTimeout(30000);
    await page.goto(`http://127.0.0.1:${port}/__harness`, { waitUntil: 'load' });
    const initialized = await page.evaluate(async () => {
      await window.__rendererProgress('fetching replay fixture');
      await document.fonts.ready;
      const r = await fetch('/__fixture.json').then((x) => x.json());
      const mod = await import('/js/independent/renderRecordedBattle.js');
      const { data, loadData } = await import('/js/data.js');
      const { assets } = await import('/js/assets.js');
      const { hudPadding, hudBands } = await import('/js/ui/fieldHost.js');
      const { withCatalogTiers } = await import('/js/independent/model.js');
      const catalogResponse = await fetch('/independent/api/catalog');
      if (!catalogResponse.ok) throw new Error(`catalog HTTP ${catalogResponse.status}`);
      const catalog = (await catalogResponse.json()).catalog;
      for (const [round, replay] of Object.entries(r.replays)) r.replays[round] = withCatalogTiers(replay, catalog);
      await window.__rendererProgress('loading native game data and asset manifests');
      await Promise.race([Promise.all([loadData('chess','items','enemies','stages','tokens','bonds','assets','local'), assets.ready(), assets.local()]), new Promise((_, reject) => setTimeout(() => reject(new Error('data/assets loading exceeded 45s')), 45000))]);
      await window.__rendererProgress('initializing native renderer and loading Pixi/Spine runtime');
      const { createFieldView } = await import('/js/render/app.js');
      const view = await createFieldView(document.getElementById('host'), { data, assets, settings: { quality: 'high' }, padding: hudPadding, hud: hudBands, tierChips: 'pips' });
      const warmUnits = new Map();
      const collect = (u) => { if (!u) return; const model = u.spine || u.defId; if (model) {
        warmUnits.set(`${model}:front`, { model, back: false });
        if (u.dir === 'UP') warmUnits.set(`${model}:back`, { model, back: true });
      } };
      for (const replay of Object.values(r.replays)) {
        for (const u of (replay.field.units || [])) collect(u);
        for (const frame of replay.frames || []) for (const event of frame.ev || []) if (event?.[0] === 'spawn') collect(event[1]);
      }
      window.__warmHold = assets.spine.hold();
      const warmResults = await Promise.all([...warmUnits.values()].map(async ({ model, back }) => {
        let entry;
        try { entry = assets.spineEntry(model, { back }); if (!entry) return { model, back, status: 'fallback-no-entry' };
          await Promise.race([assets.spine.acquire(entry), new Promise((_, reject) => setTimeout(() => reject(new Error('spine warm timeout')), 30000))]);
          assets.spine.release(entry);
          return { model, back, status: 'loaded' };
        } catch (error) { return { model, back, status: 'fallback-load-failed', error: String(error?.message || error) }; }
      }));
      window.__warmReport = warmResults;
      await window.__rendererProgress(`warmed ${warmResults.filter((x) => x.status === 'loaded').length}/${warmResults.length} unique field/spawn skeleton views`);
      const firstReplay = r.replays[r.clips[0].round];
      view.enterBattle(firstReplay.field);
      view.setCamera(firstReplay.field.kind || 'normal', { rect: firstReplay.field.rect, side: 'L', instant: true });
      window.__renderer = { view, replays: r.replays, helpers: mod, activeRound: r.clips[0].round };
      return { mode: 'battle', units: firstReplay.field.units?.length || 0, frameCount: firstReplay.frames.length, rounds: Object.keys(r.replays).length };
    });
    if (!initialized.units) throw new Error('renderer initialized with no field units');
    stage(`field initialized: units=${initialized.units}, snapshots=${initialized.frameCount}`);
    await new Promise((r) => setTimeout(r, 1200));
    const layout = await page.evaluate(async () => {
      const { recordingCanvasLayout } = await import('/js/independent/recordingCanvas.js');
      const size = recordingCanvasLayout(document.getElementById('host'), 2560);
      if (!size) return null;
      const scale = Math.min(1, 2560 / Math.max(size.width, size.height));
      const even = (n) => Math.max(2, Math.round(n * scale / 2) * 2);
      return { width: even(size.width), height: even(size.height) };
    });
    if (!layout?.width || !layout?.height || Math.max(layout.width, layout.height) < 1920) throw new Error(`captured canvas dimensions invalid: ${JSON.stringify(layout)}`);
    const visualDiagnostics = await page.evaluate(async () => {
      const { hudPadding } = await import('/js/ui/fieldHost.js');
      const canvas = document.querySelector('#host canvas');
      const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const replay = window.__renderer.replays[window.__renderer.activeRound];
      return { innerWidth, innerHeight, rootRemPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
        hostRect: document.getElementById('host').getBoundingClientRect().toJSON(),
        cameraPadding: hudPadding(replay.field.kind || 'normal', { width: innerWidth, height: innerHeight }), cameraSide: 'L',
        glRenderer: ext && gl ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
        nativeCanvas: canvas ? { width: canvas.width, height: canvas.height } : null };
    });
    const fps = 30, bitrate = Math.max(24_000_000, Math.round(layout.width * layout.height * fps * 0.18));
    const encoderConfig = await page.evaluate(async ({ width, height, fps, bitrate }) => {
      const c = new VideoEncoder({ output: () => {}, error: (e) => { throw e; } });
      const config = { codec: 'vp8', width, height, framerate: fps, bitrate, latencyMode: 'realtime' };
      const support = await VideoEncoder.isConfigSupported(config); c.close(); return { supported: support.supported, config: support.config };
    }, { width: layout.width, height: layout.height, fps, bitrate });
    if (!encoderConfig.supported) throw new Error(`WebCodecs VP8 unsupported: ${JSON.stringify(encoderConfig)}`);
    for (const clip of clips) {
    const replay = replays[clip.round];
    const sessionPath = replay.sourcePath;
    const outputFile = path.join(outputRoot, `battle-${clip.round}.webm`);
    const partialFile = `${outputFile}.partial.webm`;
    ffmpegError = '';
    ffmpeg = spawn(FFMPEG, ['-hide_banner','-loglevel','warning','-f','ivf','-i','pipe:0','-c:v','copy','-cues_to_front','1','-f','webm','-y',partialFile], { stdio: ['pipe','ignore','pipe'] });
    ffmpeg.stderr.setEncoding('utf8'); ffmpeg.stderr.on('data', (s) => { ffmpegError += s; });
    ffmpeg.stderr.on('close', () => stage(`FFmpeg stderr closed: ${ffmpegError.trim()}`));
    ffmpeg.stdin.on('error', (error) => stage(`FFmpeg stdin: ${error.code || error.message}`));
    stage(`encoding ${layout.width}x${layout.height} ${fps}fps at ${bitrate}bps through native WebCodecs`);
    ffmpeg.stdin.write(ivfHeader(layout.width, layout.height, fps));
    await page.evaluate((round) => {
      const { view, replays, helpers } = window.__renderer; const replay = replays[round]; window.__renderer.activeRound = round;
      view.enterBattle(replay.field); view.setCamera(replay.field.kind || 'normal', { rect: replay.field.rect, side: 'L', instant: true });
      const clock = helpers.replayClock(replay); const seeded = helpers.frameFeedWindow(replay.frames, clock.t0, 0);
      helpers.feedNativeFrames(view, seeded.frames, replay.field.fieldId);
      view.renderRecordedFrame({ gameTime: clock.t0, delta: 1 / 30, rate: 2 });
    }, clip.round);
    await page.screenshot({ path: path.join(outputRoot, `battle-${clip.round}-first.png`) });
    const render = await page.evaluate(async ({ sampleSeconds, fps, bitrate, width, height, round, clip }) => {
      const { view, replays, helpers } = window.__renderer; const replay = replays[round];
      const { drawRecordingCanvasFrame } = await import('/js/independent/recordingCanvas.js');
      view.enterBattle(replay.field); view.setCamera(replay.field.kind || 'normal', { rect: replay.field.rect, side: 'L', instant: true });
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d', { alpha: false });
      const encoder = new VideoEncoder({ output: (chunk) => {
        const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
        let binary = ''; for (let p = 0; p < bytes.length; p += 0x8000) binary += String.fromCharCode(...bytes.subarray(p, p + 0x8000));
        const b64 = btoa(binary);
        encoder.serial = encoder.serial.then(() => window.__encoderChunk({ data: b64, pts: Math.round(chunk.timestamp * fps / 1e6) }));
      }, error: (e) => { encoder.error = String(e); } });
      encoder.serial = Promise.resolve(); encoder.configure({ codec: 'vp8', width, height, framerate: fps, bitrate, latencyMode: 'realtime' });
      const frames = replay.frames; const clock = helpers.replayClock(replay); let idx = 0; const count = Math.ceil(sampleSeconds * fps); let prior = null;
      for (let i = 0; i < count; i++) {
        const wallSecond = clip.startSecond + i / fps;
        const gameTime = clock.t0 + helpers.gameTimeFromCountdown(clip, wallSecond, clock.duration);
        const rate = prior == null ? 2 : helpers.recordedAnimationRate(prior, gameTime, fps, 2); prior = gameTime;
        const windowed = helpers.frameFeedWindow(frames, gameTime, idx); idx = windowed.nextIndex;
        helpers.feedNativeFrames(view, windowed.frames, replay.field.fieldId);
        if (!view.renderRecordedFrame({ gameTime, delta: 1 / fps, rate })) throw new Error('native recorded-frame renderer refused frame');
        if (!drawRecordingCanvasFrame(document.getElementById('host'), ctx, width, height)) throw new Error('native canvas composition failed');
        const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps) }); encoder.encode(vf, { keyFrame: i === 0 || i % fps === 0 }); vf.close();
        if (encoder.encodeQueueSize > 8) await new Promise((resolve) => { encoder.addEventListener('dequeue', resolve, { once: true }); });
      }
      await encoder.flush(); await encoder.serial; const config = encoder.state; encoder.close();
      return { frames: count, gameTimeEnd: clock.t0 + helpers.gameTimeFromCountdown(clip, clip.startSecond + (count - 1) / fps, clock.duration), replayClock: clock, encoderState: config, warmReport: window.__warmReport, error: encoder.error || null };
    }, { sampleSeconds: args.sampleSeconds ?? Math.max(0.001, clip.endSecond - clip.startSecond), fps, bitrate, width: layout.width, height: layout.height, round: clip.round, clip });
    await page.screenshot({ path: path.join(outputRoot, `battle-${clip.round}-last.png`) });
    ffmpeg.stdin.end();
    const [exitCode] = await once(ffmpeg, 'close');
    if (exitCode !== 0) throw new Error(`FFmpeg exit ${exitCode}: ${ffmpegError}`);
    await fsp.rename(partialFile, outputFile);
    const probe = spawn(ffprobe, ['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,bit_rate','-show_entries','format=duration,size','-of','json',outputFile], { stdio: ['ignore','pipe','pipe'] });
    let probeOut='', probeErr=''; probe.stdout.setEncoding('utf8'); probe.stderr.setEncoding('utf8'); probe.stdout.on('data',(s)=>probeOut+=s); probe.stderr.on('data',(s)=>probeErr+=s);
    const [probeCode] = await once(probe,'close'); if (probeCode !== 0) throw new Error(`ffprobe exit ${probeCode}: ${probeErr}`);
    const probed = JSON.parse(probeOut); const stream = probed.streams?.[0];
    const expectedSeconds = args.sampleSeconds ?? clip.endSecond - clip.startSecond;
    const receipt = { ok: true, recordingId, sessionId, round: clip.round, sourceReplay: sessionPath, sourceEvents: eventsPath,
      viewport: { width: layout.width, height: layout.height }, fps, videoBitsPerSecond: bitrate, encoder: encoderConfig,
      visualDiagnostics, render, output: outputFile, ffprobe: probed, ffmpegExitCode: exitCode, ffprobeExitCode: probeCode, screenshots: [path.join(outputRoot, `battle-${clip.round}-first.png`), path.join(outputRoot, `battle-${clip.round}-last.png`)] };
    if (!stream || stream.width !== layout.width || stream.height !== layout.height || Number(probed.format?.duration) < expectedSeconds * 0.95) throw new Error('encoded WebM failed dimension/duration checks');
    await fsp.writeFile(path.join(outputRoot, `renderer-round-${clip.round}.receipt.json`), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt, null, 2));
    const manifestPath = path.join(outputRoot, 'manifest.json');
    const manifest = await fsp.readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => ({ schemaVersion: 1, recordingId, sessionId, sourceRevision, viewport: { width: layout.width, height: layout.height }, fps, videoBitsPerSecond: bitrate, clips: [] }));
    manifest.clips = [...manifest.clips.filter((x) => x.round !== clip.round), { round: clip.round, startSecond: clip.startSecond, endSecond: clip.endSecond, mediaDuration: Number(probed.format.duration), file: `battle-${clip.round}.webm` }].sort((a, b) => a.round - b.round);
    const manifestTemp = `${manifestPath}.partial`; await fsp.writeFile(manifestTemp, JSON.stringify(manifest, null, 2)); await fsp.rename(manifestTemp, manifestPath);
    ffmpeg = null;
    }
    await browser.close();
  } finally {
    if (ffmpeg && ffmpeg.exitCode == null) { ffmpeg.stdin.destroy(); ffmpeg.kill(); }
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

function browserEntry() {
  return `import { data, loadData } from '/js/data.js';\nimport { assets } from '/js/assets.js';\nimport { createFieldView } from '/js/render/app.js';\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
}
