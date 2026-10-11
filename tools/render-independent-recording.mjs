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
import { buildPrepClips, buildLegacyPrepClips } from './recorded-prep.mjs';

const gunzip = promisify(zlib.gunzip);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveExecutable(name, { pathValue = process.env.PATH || '', platform = process.platform } = {}) {
  if (!name || typeof name !== 'string') throw new TypeError('executable name is required');
  const explicitPath = path.isAbsolute(name) || name.includes('/') || name.includes('\\');
  const withExtension = (value) => platform === 'win32' && !/\.exe$/i.test(value) ? `${value}.exe` : value;
  if (explicitPath) {
    const candidate = path.resolve(name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    throw new Error(`executable not found: ${candidate}`);
  }
  for (const directory of String(pathValue).split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(directory, withExtension(name));
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`executable not found on PATH: ${name}`);
}

export function resolveFfprobe({ explicitPath, ffmpegPath, pathValue = process.env.PATH || '', platform = process.platform } = {}) {
  if (explicitPath) return resolveExecutable(explicitPath, { pathValue, platform });
  const adjacentName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const adjacent = path.join(path.dirname(ffmpegPath), adjacentName);
  if (fs.existsSync(adjacent) && fs.statSync(adjacent).isFile()) return adjacent;
  return resolveExecutable('ffprobe', { pathValue, platform });
}

export function battleFrameRetryUrls(round, frameIndex, maxAttempts = 3) {
  if (!Number.isInteger(round) || round < 1 || !Number.isInteger(frameIndex) || frameIndex < 0
    || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new TypeError('invalid battle frame retry parameters');
  }
  const base = `/__battle-frame/${round}/${frameIndex}`;
  return Array.from({ length: maxAttempts }, (_, index) => index === 0 ? base : `${base}?retry=${index}`);
}

export function nearestBattleFrameIndex(frameTimes, targetTime) {
  if (!Array.isArray(frameTimes) || !frameTimes.length || !Number.isFinite(targetTime)
    || frameTimes.some((time, index) => !Number.isFinite(time) || (index > 0 && time < frameTimes[index - 1]))) {
    throw new TypeError('invalid battle frame timestamps');
  }
  if (targetTime <= frameTimes[0]) return 0;
  let low = 0, high = frameTimes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (frameTimes[middle] <= targetTime) low = middle + 1;
    else high = middle;
  }
  return Math.min(frameTimes.length - 1, Math.max(0, low - 1));
}

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
  const sampleStart = out['sample-start-second'] == null ? null : Number(out['sample-start-second']);
  const highDprSecondsRaw = out['high-dpr-seconds'] ?? out['high-dpr-second'] ?? '';
  const highDprSeconds = String(highDprSecondsRaw).trim() ? String(highDprSecondsRaw).split(',').map(Number) : [];
  const highDpr = out['high-dpr'] == null ? 3 : Number(out['high-dpr']);
  if (secs != null && (!Number.isFinite(secs) || secs <= 0 || secs > 60)) throw new Error('--sample-seconds must be in (0,60] when supplied');
  if (sampleStart != null && (!Number.isFinite(sampleStart) || sampleStart < 0)) throw new Error('--sample-start-second must be non-negative when supplied');
  if (highDprSeconds.some((second) => !Number.isFinite(second) || second < 0)) throw new Error('--high-dpr-seconds must be comma-separated non-negative seconds');
  if (!Number.isFinite(highDpr) || highDpr < 2 || highDpr > 3) throw new Error('--high-dpr must be between 2 and 3');
  if (out['prep-only'] != null && !['true', 'false'].includes(String(out['prep-only']))) throw new Error('--prep-only must be true or false');
  if (out['clock-probe'] != null && !['true', 'false'].includes(String(out['clock-probe']))) throw new Error('--clock-probe must be true or false');
  if (out['composite-only'] != null && !['true', 'false'].includes(String(out['composite-only']))) throw new Error('--composite-only must be true or false');
  if (out['prep-visual-state-json'] != null && !out['prep-visual-state-json'].trim()) throw new Error('--prep-visual-state-json must be a non-empty path');
  if (out['source-segments-json'] != null && !out['source-segments-json'].trim()) throw new Error('--source-segments-json must be a non-empty path');
  if (Boolean(out['battle-dir']) !== Boolean(out['battle-manifest'])) throw new Error('--battle-dir and --battle-manifest must be supplied together');
  out.prepOnly = out['prep-only'] === 'true';
  out.clockProbe = out['clock-probe'] === 'true';
  out.compositeOnly = out['composite-only'] === 'true';
  const rounds = out.rounds.split(',').map(Number);
  if (!rounds.length || rounds.some((n) => !Number.isInteger(n) || n < 1 || n > 99)) throw new Error('--rounds must be comma-separated positive integers');
  out.sampleSeconds = secs;
  out.sampleStartSecond = sampleStart;
  out.highDprSeconds = [...new Set(highDprSeconds)].sort((a, b) => a - b);
  out.highDpr = highDpr;
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
  const recordingViewport = { width: Number(meta.viewport?.width) || 2187, height: Number(meta.viewport?.height) || 1077 };
  let hrefBound = false; const traceEvents = [], rrwebRecords = [];
  const eventLines = readline.createInterface({ input: fs.createReadStream(eventsPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of eventLines) {
    try {
      const e = JSON.parse(line);
      if (e.sid !== recordingId) continue;
      const href = e?.p?.data?.href;
      if (e.kind === 'rrweb' && e.p?.type === 4 && new URL(href).searchParams.get('session') === sessionId) hrefBound = true;
      if (e.kind === 'rrweb') rrwebRecords.push(e.p);
      if (e.kind === 'initial-state' || e.kind === 'server-action') traceEvents.push(e);
    } catch { /* unrelated event shape */ }
  }
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
    return { round, startSecond: clip.startSecond, endSecond: clip.endSecond, observations: clip.observations || [], uiActions: clip.uiActions || [] };
  });
  const recordingOrigin = Date.parse(meta.startedAt);
  const recordingEnd = Date.parse(meta.endedAt || meta.mediaCaptureStoppedAt);
  const recordingDuration = (recordingEnd - recordingOrigin) / 1000;
  if (!Number.isFinite(recordingOrigin) || !Number.isFinite(recordingEnd) || !Number.isFinite(recordingDuration) || recordingDuration <= 0) {
    throw new Error('recording metadata lacks a valid startedAt/end time for recording-clock prep alignment');
  }
  const mediaStartedAt = Date.parse(meta.mediaStartedAt);
  const mediaOffsetSeconds = Number.isFinite(mediaStartedAt) ? (mediaStartedAt - recordingOrigin) / 1000 : null;
  let prepAudit;
  let legacyVisualSource = null;
  if (args['prep-visual-state-json']) {
    legacyVisualSource = JSON.parse(await fsp.readFile(path.resolve(args['prep-visual-state-json']), 'utf8'));
    if (legacyVisualSource.recordingId !== recordingId || legacyVisualSource.sessionId !== sessionId
      || Date.parse(legacyVisualSource.recordingStartedAt) !== recordingOrigin || legacyVisualSource.schemaVersion !== 1) {
      throw new Error('legacy prep visual state identity/clock/schema mismatch');
    }
    prepAudit = buildLegacyPrepClips({ visualStates: legacyVisualSource.states, duration: recordingDuration, battleClips: clips, fps: 30 });
  } else {
    prepAudit = buildPrepClips({ events: traceEvents, recordingId, sessionId, recordingStartedAt: meta.startedAt,
      duration: recordingDuration, battleClips: clips, fps: 30 });
  }
  let prepClipsForRender = prepAudit.clips.map((clip) => ({ ...clip, states: [...clip.states] }));
  if (args.sampleSeconds != null) {
    const windowStart = args.sampleStartSecond ?? 0, windowEnd = Math.min(recordingDuration, windowStart + args.sampleSeconds);
    prepClipsForRender = prepClipsForRender.flatMap((clip) => {
      const startSecond = Math.max(clip.startSecond, windowStart), endSecond = Math.min(clip.endSecond, windowEnd);
      if (!(endSecond > startSecond)) return [];
      const active = [...clip.states].reverse().find((state) => state.at <= startSecond);
      const states = [...(active ? [{ ...active, at: startSecond }] : []), ...clip.states.filter((state) => state.at > startSecond && state.at < endSecond)];
      if (!states.length) return [];
      return [{ ...clip, startSecond, endSecond, states }];
    });
  }
  if (args.sampleSeconds == null && !args['source-segments-json']) {
    const completeRounds = (timeline.rounds || []).map((x) => Number(x.round)).sort((a, b) => a - b);
    if (completeRounds.length !== args.roundList.length || completeRounds.some((round, i) => round !== [...args.roundList].sort((a, b) => a - b)[i])) {
      throw new Error('full render requires every round in the validated timeline; use --sample-seconds only for a bounded sample');
    }
  }
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
  const ffmpegExecutable = resolveExecutable(args['composite-ffmpeg'] || process.env.SP_FFMPEG_PATH || 'ffmpeg');
  const compositeFfmpeg = ffmpegExecutable;
  const ffprobe = resolveFfprobe({ explicitPath: args.ffprobe || process.env.SP_FFPROBE_PATH,
    ffmpegPath: compositeFfmpeg });
  const publicRoot = path.join(installRoot, 'public');
  const dataRoot = path.resolve(args['data-root'] || path.join(wtRoot, 'data'));
  const localAssetsManifest = path.resolve(args['local-assets-manifest'] || path.join(installRoot, 'data', 'local-assets.json'));
  process.env.SP_DATA_DIR = dataRoot;
  process.env.SP_INDEPENDENT_DESIGN_PATH = path.join(dataRoot, 'independent-design.json');
  process.env.SP_INDEPENDENT_HISTORICAL_PRIZES_PATH = path.join(dataRoot, 'independent-darkmoon-prizes-19.2.json');
  process.env.SP_INDEPENDENT_ROGUELIKE_PRIZE_ART_PATH = path.join(dataRoot, 'independent-darkmoon-roguelike-art.json');
  process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH = path.join(dataRoot, 'independent-darkmoon-design-addon.json');
  const { getData } = await import(pathToFileURL(path.join(wtRoot, 'server', 'data.js')).href);
  const { getCatalog } = await import(pathToFileURL(path.join(wtRoot, 'server', 'modes', 'independent', 'catalog.js')).href);
  const { independentDisplayCatalog } = await import(pathToFileURL(path.join(wtRoot, 'server', 'modes', 'independent', 'display.js')).href);
  const offlineData = getData({ dir: dataRoot, log: { warn: (message) => stage(`data warning: ${message}`), error: (message) => stage(`data error: ${message}`) } });
  const offlineCatalog = independentDisplayCatalog(offlineData, getCatalog(offlineData), offlineData['independent-game-text']);
  const fixture = { replays, clips, prepClips: prepAudit.clips, prepGapAudit: { sourceSnapshotCount: prepAudit.sourceSnapshotCount, uncoveredGaps: prepAudit.uncoveredGaps,
      ...(legacyVisualSource ? { sourceKind: legacyVisualSource.sourceKind, coverage: legacyVisualSource.coverage,
        unresolvedExamples: legacyVisualSource.unresolved.slice(0, 50) } : {}) }, sampleSeconds: args.sampleSeconds,
    source: { recordingId, sessionId, recordingStartedAt: meta.startedAt, recordingEndedAt: meta.endedAt || meta.mediaCaptureStoppedAt, recordingDuration,
      mediaStartedAt: meta.mediaStartedAt || null, mediaOffsetSeconds, logicalViewport: recordingViewport } };
  const battleDir = args['battle-dir'] ? path.resolve(args['battle-dir']) : null;
  const battleManifestPath = args['battle-manifest'] ? path.resolve(args['battle-manifest']) : null;
  const battleFramesDir = args['battle-frames-dir'] ? path.resolve(args['battle-frames-dir']) : null;
  const battleManifest = battleManifestPath ? JSON.parse(await fsp.readFile(battleManifestPath, 'utf8')) : null;
  if (battleManifest && (battleManifest.recordingId !== recordingId || !Array.isArray(battleManifest.clips))) throw new Error('native battle manifest identity/schema mismatch');
  if (battleManifest && !battleFramesDir) throw new Error('native battle render requires sequentially decoded --battle-frames-dir');
  if (battleManifest) {
    const selectedRounds = new Set(clips.map((clip) => Number(clip.round)));
    battleManifest.clips = battleManifest.clips.filter((clip) => selectedRounds.has(Number(clip.round)));
    const ffprobePath = ffprobe;
    const decodeManifestPath = path.join(battleFramesDir, 'decode-manifest.json');
    const decodeManifest = JSON.parse(await fsp.readFile(decodeManifestPath, 'utf8'));
    if (decodeManifest.sourceRecordingId !== recordingId || !Array.isArray(decodeManifest.clips)) throw new Error('battle frame decode manifest identity/schema mismatch');
    for (const clip of battleManifest.clips) {
      const decoded = decodeManifest.clips.find((entry) => Number(entry.round) === Number(clip.round) && entry.file === clip.file);
      if (!decoded || !Number.isInteger(decoded.decodedFrameCount) || decoded.decodedFrameCount < 1) throw new Error(`battle frame decode manifest lacks frame count for R${clip.round}`);
      const frameWidth = Number(decoded.reported?.width), frameHeight = Number(decoded.reported?.height);
      if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight) || frameWidth < 2 || frameHeight < 2) throw new Error(`battle frame decode manifest lacks source dimensions for R${clip.round}`);
      const first = path.join(battleFramesDir, `round-${clip.round}`, 'frame-000000.jpg');
      const last = path.join(battleFramesDir, `round-${clip.round}`, `frame-${String(decoded.decodedFrameCount - 1).padStart(6, '0')}.jpg`);
      for (const filename of [first, last]) {
        const stat = await fsp.stat(filename);
        if (!stat.isFile() || stat.size < 4) throw new Error(`battle frame cache endpoint is missing/incomplete: ${filename}`);
      }
      const mediaPath = path.resolve(battleDir, clip.file);
      if (!inside(battleDir, mediaPath)) throw new Error(`battle media path escapes input root: ${clip.file}`);
      const probeText = execFileSync(ffprobePath, ['-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=width,height:frame=best_effort_timestamp_time','-of','json',mediaPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const probeResult = JSON.parse(probeText), probeFrames = probeResult.frames || [], mediaStream = probeResult.streams?.[0];
      if (Number(mediaStream?.width) !== frameWidth || Number(mediaStream?.height) !== frameHeight) throw new Error(`battle source/cache dimensions mismatch R${clip.round}: source=${mediaStream?.width}x${mediaStream?.height} cache=${frameWidth}x${frameHeight}`);
      const firstPts = probeFrames.map((frame) => Number(frame.best_effort_timestamp_time)).filter(Number.isFinite)[0];
      if (!Number.isFinite(firstPts)) throw new Error(`battle source has no usable frame PTS R${clip.round}`);
      const frameTimes = probeFrames.map((frame) => Number(frame.best_effort_timestamp_time) - firstPts);
      if (frameTimes.length !== decoded.decodedFrameCount || frameTimes.some((time, index) => !Number.isFinite(time) || (index > 0 && time < frameTimes[index - 1]))) {
        throw new Error(`battle source PTS/cache frame count mismatch R${clip.round}: probe=${frameTimes.length} cache=${decoded.decodedFrameCount}`);
      }
      clip.frameTimes = frameTimes;
      clip.decodedFrameCount = decoded.decodedFrameCount;
      clip.frameWidth = frameWidth; clip.frameHeight = frameHeight;
      stage(`battle PTS indexed R${clip.round}: ${frameTimes.length} frames first=${frameTimes[0]}s last=${frameTimes.at(-1)}s`);
    }
  }
  fixture.battleClips = battleManifest?.clips || [];
  let ffmpeg = null, ffmpegOutput = null, ffmpegError = '', browser = null;
  stage(`input validated; ${clips.length} round(s), intervals ${clips[0].startSecond}-${clips.at(-1).endSecond}s`);
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' && !(req.method === 'POST' && req.url === '/__ivf')) { res.writeHead(405); return res.end(); }
    if (req.url === '/independent/api/catalog') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); return res.end(JSON.stringify({ ok: true, catalog: offlineCatalog })); }
    if (req.url === '/__fixture.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(fixture)); }
    if (req.url === '/__rrweb.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(rrwebRecords)); }
    if (battleDir && req.url.startsWith('/__battle/')) {
      const file = decodeURIComponent(req.url.slice('/__battle/'.length));
      const clip = battleManifest.clips.find((candidate) => candidate.file === file);
      if (!clip || path.basename(file) !== file) { res.writeHead(404); return res.end('battle clip not registered'); }
      const target = path.resolve(battleDir, file);
      if (!inside(battleDir, target)) { res.writeHead(400); return res.end(); }
      const stream = fs.createReadStream(target);
      stream.once('error', (error) => { if (!res.headersSent) res.writeHead(404); res.end(error.message); });
      res.writeHead(200, { 'content-type': 'video/webm', 'cache-control': 'no-store' }); stream.pipe(res); return;
    }
    if (battleFramesDir && req.url.startsWith('/__battle-frame/')) {
      const match = /^\/__battle-frame\/(\d+)\/(\d+)$/.exec(new URL(req.url, 'http://local').pathname);
      if (!match) { res.writeHead(400); return res.end('invalid battle frame route'); }
      const round = Number(match[1]), frameIndex = Number(match[2]);
      const clip = battleManifest.clips.find((candidate) => Number(candidate.round) === round);
      if (!clip || !Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= Number(clip.decodedFrameCount)) { res.writeHead(404); return res.end('battle frame not registered'); }
      const target = path.resolve(battleFramesDir, `round-${round}`, `frame-${String(frameIndex).padStart(6, '0')}.jpg`);
      if (!inside(battleFramesDir, target)) { res.writeHead(400); return res.end(); }
      let stat;
      try { stat = await fsp.stat(target); }
      catch (error) { stage(`battle frame HTTP 404 round=${round} frame=${frameIndex} path=${target} error=${error.code || error.message}`); res.writeHead(404); return res.end('battle frame unavailable'); }
      if (!stat.isFile() || stat.size < 4) { stage(`battle frame HTTP 503 round=${round} frame=${frameIndex} path=${target} bytes=${stat.size}`); res.writeHead(503); return res.end('battle frame incomplete'); }
      const stream = fs.createReadStream(target);
      stream.once('error', (error) => { stage(`battle frame stream error round=${round} frame=${frameIndex} path=${target} error=${error.code || error.message}`); if (!res.headersSent) res.writeHead(503); res.destroy(error); });
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(stat.size), 'cache-control': 'no-store' }); stream.pipe(res); return;
    }
    if (req.url === '/__harness') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html lang="zh-CN" class="ix-ws"><head><meta charset="utf-8"><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/css/screens/game.css"><link rel="stylesheet" href="/css/devices.css"><link rel="stylesheet" href="/css/workshop.css"><link rel="stylesheet" href="/css/independent-recording.css"><script src="/vendor/rrweb.umd.js"></script><style>html,body,#screen,#rr-stage{margin:0;width:${recordingViewport.width}px;height:${recordingViewport.height}px;overflow:hidden;background:#0a0e0d}body.ix-replay{padding:0!important}#screen{position:relative;padding:0!important;border:0!important;border-radius:0!important}#host{position:absolute;inset:0;opacity:0;pointer-events:none;z-index:-10}.ix-composite-canvas{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none}.ix-replay__text-selection-rect{border:0!important;background:#1683ff33!important;box-shadow:none!important}</style></head><body class="ix-replay"><div id="screen" class="gm ix-replay"><div id="rr-stage"></div><div id="host" class="gm__field"></div></div><script type="module" src="/__entry.js"></script></body></html>`);
    }
    if (req.url === '/__entry.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(browserEntry());
    }
    if (req.url === '/__ivf' && req.method === 'POST') { res.writeHead(204); req.resume(); return res.end(); }
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname).replace(/^\/+/, '');
    let target = path.resolve(publicRoot, pathname), allowedRoot = publicRoot;
    if (pathname === 'data/local-assets.json') { target = localAssetsManifest; allowedRoot = path.dirname(localAssetsManifest); }
    else if (pathname.startsWith('data/')) { target = path.resolve(dataRoot, pathname.slice('data/'.length)); allowedRoot = dataRoot; }
    if (pathname.startsWith('shared/')) { target = path.resolve(wtRoot, pathname); allowedRoot = wtRoot; }
    if (pathname.startsWith('sim/')) { target = path.resolve(wtRoot, 'server', pathname); allowedRoot = path.resolve(wtRoot, 'server'); }
    if (pathname.startsWith('js/')) { target = path.resolve(wtRoot, 'public', pathname); allowedRoot = path.resolve(wtRoot, 'public'); }
    if (pathname.startsWith('css/')) {
      const sourceCss = path.resolve(wtRoot, 'public', pathname), sourceCssRoot = path.resolve(wtRoot, 'public');
      if (inside(sourceCssRoot, sourceCss) && fs.existsSync(sourceCss)) { target = sourceCss; allowedRoot = sourceCssRoot; }
    }
    if (!inside(allowedRoot, target)) { stage(`static 400 source escape ${pathname} => ${target}`); res.writeHead(400); return res.end(); }
    try { const body = await fsp.readFile(target); res.writeHead(200, { 'content-type': mime(target), 'cache-control': 'no-store' }); res.end(body); }
    catch (err) { stage(`static 404 ${pathname} => ${target} (${err.code || err.message})`); res.writeHead(404); res.end('not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  stage(`isolated readonly HTTP fixture listening on 127.0.0.1:${port}`);
  let puppeteer;
  try {
    const { createRequire } = await import('node:module');
    puppeteer = createRequire(path.join(installRoot, 'package.json'))('puppeteer-core');
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 180000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webcodecs', '--use-gl=angle', '--use-angle=d3d11'] });
    stage(`Chrome launched; pid=${browser.process()?.pid || 'unknown'}`);
    const page = await browser.newPage();
    await page.setViewport({ ...recordingViewport, deviceScaleFactor: 2560 / recordingViewport.width });
    const fatalPageErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') console.error(`browser: ${m.text()}`); });
    page.on('response', (response) => { if (response.status() >= 400) stage(`browser HTTP ${response.status()} ${response.url()}`); });
    page.on('pageerror', (e) => { fatalPageErrors.push(String(e?.stack || e)); console.error(`pageerror: ${e.stack || e}`); });
    page.exposeFunction('__encoderChunk', async (payload) => {
      if (!ffmpeg?.stdin.writable) throw new Error('FFmpeg input pipe is closed');
      await writeIvfFrame(ffmpeg.stdin, Buffer.from(payload.data, 'base64'), payload.pts);
    });
    page.exposeFunction('__rendererProgress', (value) => stage(`browser: ${value}`));
    const prepStateScreenshots = [];
    page.exposeFunction('__capturePrepStateFrame', async ({ clipIndex, seq, revision, frameIndex, nativePositions, renderStats, canvases }) => {
      const file = path.join(outputRoot, `prep-${clipIndex}-state-${seq}.png`);
      await page.screenshot({ path: file });
      prepStateScreenshots.push({ clipIndex, seq, revision, frameIndex, nativePositions, renderStats, canvases, file });
      return file;
    });
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
      const { prepView } = await import('/js/independent/model.js');
      const { prepCameraFor } = await import('/js/ui/gameLogic.js');
      const { GEO } = await import('/shared/constants.js');
      const catalogResponse = await fetch('/independent/api/catalog');
      if (!catalogResponse.ok) throw new Error(`catalog HTTP ${catalogResponse.status}`);
      const catalog = (await catalogResponse.json()).catalog;
      for (const [round, replay] of Object.entries(r.replays)) r.replays[round] = withCatalogTiers(replay, catalog);
      await window.__rendererProgress('loading native game data and asset manifests');
      await Promise.race([Promise.all([loadData('chess','items','enemies','stages','tokens','bonds','assets','local'), assets.ready(), assets.local()]), new Promise((_, reject) => setTimeout(() => reject(new Error('data/assets loading exceeded 45s')), 45000))]);
      await window.__rendererProgress('initializing native renderer and loading Pixi/Spine runtime');
      const { createFieldView } = await import('/js/render/app.js');
      const view = await createFieldView(document.getElementById('host'), { data, assets, settings: { quality: 'high' }, padding: hudPadding, hud: hudBands, tierChips: 'pips' });
      let battleBitmap = null;
      const warmUnits = new Map();
      const collect = (u) => { if (!u) return; const model = u.spine || u.defId; if (model) {
        warmUnits.set(`${model}:front`, { model, back: false });
        if (u.dir === 'UP') warmUnits.set(`${model}:back`, { model, back: true });
      } };
      const collectPrep = (state) => {
        const prep = prepView(state, catalog);
        for (const piece of [...prep.hand, ...prep.temp, ...prep.board]) {
          if (!piece) continue;
          const model = piece.kind === 'token'
            ? data.lookup('tokens', piece.id)?.assets?.spine || piece.id
            : data.lookup('chess', piece.id)?.assets?.spine || data.lookup('chess', piece.id)?.charId;
          collect({ spine: model, dir: piece.dir });
        }
      };
      for (const replay of Object.values(r.replays)) {
        for (const u of (replay.field.units || [])) collect(u);
        for (const frame of replay.frames || []) for (const event of frame.ev || []) if (event?.[0] === 'spawn') collect(event[1]);
      }
      for (const clip of r.prepClips || []) for (const snap of clip.states || []) collectPrep(snap.state);
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
      const warmFailures = warmResults.filter((x) => x.status !== 'loaded');
      await window.__rendererProgress(`warmed ${warmResults.filter((x) => x.status === 'loaded').length}/${warmResults.length} unique field/spawn skeleton views; unresolved=${JSON.stringify(warmFailures)}`);
      const firstReplay = r.replays[r.clips[0].round];
      const battleFrameRetryUrls = (round, frameIndex, maxAttempts = 3) => {
        const base = `/__battle-frame/${round}/${frameIndex}`;
        return Array.from({ length: maxAttempts }, (_, index) => index === 0 ? base : `${base}?retry=${index}`);
      };
      const nearestBattleFrameIndex = (frameTimes, targetTime) => {
        let low = 0, high = frameTimes.length;
        while (low < high) { const middle = (low + high) >>> 1; if (frameTimes[middle] <= targetTime) low = middle + 1; else high = middle; }
        return Math.max(0, Math.min(frameTimes.length - 1, low - 1));
      };
      view.enterBattle(firstReplay.field);
      view.setCamera(firstReplay.field.kind || 'normal', { rect: firstReplay.field.rect, side: 'L', instant: true });
      window.__renderer = { view, replays: r.replays, clips: r.clips, battleClips: r.battleClips || [], get battleBitmap() { return battleBitmap; }, set battleBitmap(value) { battleBitmap = value; }, battleFrameRetryUrls, nearestBattleFrameIndex, prepClips: r.prepClips || [],
        prepGapAudit: r.prepGapAudit, helpers: mod, prepView, prepCameraFor, GEO, data, catalog, activeRound: r.clips[0].round };
      const rrItems = await fetch('/__rrweb.json').then((response) => { if (!response.ok) throw new Error(`RRWeb HTTP ${response.status}`); return response.json(); });
      const { rebaseRecordedAssets } = await import('/js/independent/replayAssets.js'); rebaseRecordedAssets(rrItems);
      const rrPlayer = new rrweb.Replayer(rrItems, { root: document.getElementById('rr-stage'), width: r.source.logicalViewport.width, height: r.source.logicalViewport.height,
        skipInactive: false, showWarning: false, showDebug: false, mouseTail: false, useVirtualDom: false, UNSAFE_replayCanvas: true });
      const firstTs = rrItems[0]?.timestamp || 0;
      const targetOffset = Math.max(0, Date.parse(r.source.recordingStartedAt) - firstTs);
      rrPlayer.play(targetOffset);
      const rrTimer = rrPlayer.timer;
      if (rrTimer?.raf && rrTimer.raf !== true) cancelAnimationFrame(rrTimer.raf);
      if (rrTimer) { rrTimer.raf = null; rrTimer.lastTimestamp = performance.now(); }
      const iframe = rrPlayer.iframe || document.querySelector('#rr-stage iframe');
      const rrDoc = iframe?.contentDocument;
      if (!rrDoc) throw new Error('RRWeb replay did not produce a same-origin iframe');
      window.__renderer.rrPlayer = rrPlayer;
      window.__renderer.rrTargetOffset = targetOffset;
      window.__renderer.seekRrwebSource = (second) => {
        const timer = window.__renderer.rrPlayer.timer;
        if (timer.raf && timer.raf !== true) cancelAnimationFrame(timer.raf);
        timer.raf = null;
        timer.timeOffset = second * 1000;
        while (timer.actions.length && timer.actions[0].delay <= timer.timeOffset) {
          const action = timer.actions.shift();
          action.doAction();
        }
        const actual = window.__renderer.rrPlayer.getCurrentTime();
        const expected = window.__renderer.rrTargetOffset + second * 1000;
        if (Math.abs(actual - expected) > 1) throw new Error(`RRWeb source clock drift at ${second}s: expected=${expected}, actual=${actual}`);
        timer.raf = null;
        return { sourceSecond: second, expectedCurrentTimeMs: expected, actualCurrentTimeMs: actual,
          clockErrorMs: actual - expected, queuedActions: timer.actions.length };
      };
      window.__renderer.ensureCompositeCanvas = () => {
        const doc = window.__renderer.rrPlayer.iframe?.contentDocument, field = doc?.querySelector('.gm__field');
        if (!doc || !field) return false;
        doc.body.classList.add('ix-replay');
        if (!doc.getElementById('ix-recording-controls-hidden')) {
          const controls = doc.createElement('style'); controls.id = 'ix-recording-controls-hidden';
          controls.textContent = '.ix-recording{display:none!important}'; doc.head.append(controls);
        }
        let style = doc.getElementById('ix-composite-style');
        if (!style) { style = doc.createElement('style'); style.id = 'ix-composite-style';
          style.textContent = '.gm__field canvas:not([data-sp-canvas-surface]){display:none!important;visibility:hidden!important}.ix-composite-canvas{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none}.ix-replay .replayer-mouse{width:24px;height:32px;background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2732%27 viewBox=%270 0 24 32%27%3E%3Cpath d=%27M2 1v27l6.5-6.5L14 31l4-2-5.5-9H22z%27 fill=%27%23000%27 stroke=%27%23fff%27 stroke-width=%272%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E");filter:drop-shadow(0 0 1px #111)}.ix-replay .replayer-mouse::after{display:none}.ix-replay__text-selection-rect{border:0!important;background:#1683ff33!important;box-shadow:none!important}html[data-sp-replay-scene="game"] .ix-start{display:none!important}html[data-sp-replay-scene="game"] .screen.gm{opacity:1!important;animation:none!important}'; doc.head.append(style); }
        let overlay = field.querySelector('canvas[data-sp-canvas-surface="1"]');
        if (!overlay) { overlay = doc.createElement('canvas'); overlay.width = window.__renderer.compositeCanvas.width; overlay.height = window.__renderer.compositeCanvas.height; overlay.className = 'ix-composite-canvas'; overlay.dataset.spCanvasSurface = '1'; field.append(overlay); }
        else { overlay.width = window.__renderer.compositeCanvas.width; overlay.height = window.__renderer.compositeCanvas.height; }
        window.__renderer.rrCanvas = overlay; window.__renderer.rrContext = overlay.getContext('2d', { alpha: true });
        return true;
      };
      window.__renderer.canvasComposer = await import('/js/independent/recordingCanvas.js');
      window.__renderer.compositeCanvas = document.createElement('canvas'); window.__renderer.compositeCanvas.width = 2560; window.__renderer.compositeCanvas.height = 1260;
      window.__renderer.compositeContext = window.__renderer.compositeCanvas.getContext('2d', { alpha: false });
      window.__renderer.rrTimerReady = !!rrPlayer.timer && Array.isArray(rrPlayer.timer.actions);
      return { mode: 'battle', units: firstReplay.field.units?.length || 0, frameCount: firstReplay.frames.length, rounds: Object.keys(r.replays).length };
    });
    if (!initialized.units) throw new Error('renderer initialized with no field units');
    stage(`field initialized: units=${initialized.units}, snapshots=${initialized.frameCount}`);
    if (args.clockProbe) {
      await page.evaluate(() => window.__renderer.seekRrwebSource(0));
      await page.screenshot({ path: path.join(outputRoot, 'rrweb-clock-probe-source-0.png'), captureBeyondViewport: false, optimizeForSpeed: true });
      const points = await page.evaluate(() => [0, 7.7, 9.65, 15.2].map((second) => {
        const clock = window.__renderer.seekRrwebSource(second);
        const doc = window.__renderer.rrPlayer.iframe.contentDocument;
        const bodyText = (doc?.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 900);
        return { ...clock, battlebarText: doc?.querySelector('.ix-battlebar')?.innerText?.slice(0, 300) || null,
          resultText: doc?.querySelector('.ix-result')?.innerText?.slice(0, 300) || null, bodyText,
          htmlClass: doc?.documentElement?.className || null, replayScene: doc?.documentElement?.getAttribute('data-sp-replay-scene') || null,
          outerHost: (() => { const element = document.querySelector('#host'); if (!element) return null; const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return { className: element.className, display: style.display, opacity: style.opacity, visibility: style.visibility, zIndex: style.zIndex, rect: rect.toJSON(),
              canvases: [...element.querySelectorAll('canvas')].map((canvas) => ({ width: canvas.width, height: canvas.height,
                opacity: getComputedStyle(canvas).opacity, display: getComputedStyle(canvas).display, rect: canvas.getBoundingClientRect().toJSON() })) }; })(),
          outerScreenText: (document.querySelector('#screen')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
          layers: [...(doc?.querySelectorAll('.screen.gm,.ix-start,.gm__field,.gm__shop,.gm__header') || [])].map((element) => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return { selector: element.matches('.screen.gm') ? '.screen.gm' : element.matches('.ix-start') ? '.ix-start' : element.matches('.gm__field') ? '.gm__field' : element.matches('.gm__shop') ? '.gm__shop' : '.gm__header',
              className: element.className, display: style.display, opacity: style.opacity, visibility: style.visibility, zIndex: style.zIndex,
              rect: rect.toJSON(), text: (element.innerText || '').replace(/\s+/g, ' ').slice(0, 220) };
          }) };
      }));
      if (points.some((point) => Math.abs(point.clockErrorMs) > 1)) throw new Error('RRWeb source clock probe found an out-of-tolerance frame');
      await fsp.writeFile(path.join(outputRoot, 'rrweb-clock-probe.json'), JSON.stringify({ schemaVersion: 1, sourceStartSecond: 0,
        recordingStartedAt: meta.startedAt, targetOffsetMs: Date.parse(meta.startedAt) - (rrwebRecords[0]?.timestamp || 0), points }, null, 2));
      stage('RRWeb clock probe passed at 0, 7.7, 9.65, 15.2 seconds');
      return;
    }
    await new Promise((r) => setTimeout(r, 1200));
    const layout = await page.evaluate(async () => {
      const { recordingCanvasLayout } = await import('/js/independent/recordingCanvas.js');
      const size = recordingCanvasLayout(document.getElementById('host'), 3840);
      if (!size) return null;
      const scale = Math.min(1, 3840 / Math.max(size.width, size.height));
      const even = (n) => Math.max(2, Math.round(n * scale / 2) * 2);
      return { width: even(size.width), height: even(size.height) };
    });
    if (!layout?.width || !layout?.height || Math.max(layout.width, layout.height) < 1920) throw new Error(`captured canvas dimensions invalid: ${JSON.stringify(layout)}`);
    await page.evaluate(({ width, height }) => {
      const renderer = window.__renderer;
      renderer.outputLayout = { width, height };
      renderer.compositeCanvas.width = width; renderer.compositeCanvas.height = height;
      if (renderer.rrCanvas) { renderer.rrCanvas.width = width; renderer.rrCanvas.height = height; }
    }, layout);
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
    const renderedClips = [];
    const compositeClips = [];
    const highDprStills = [];
    for (const [clipIndex, clip] of (args.compositeOnly ? [] : prepClipsForRender.entries())) {
      if (args.sampleSeconds != null && clip.endSecond - clip.startSecond > args.sampleSeconds) {
        clip.endSecond = clip.startSecond + args.sampleSeconds;
        clip.states = clip.states.filter((snapshot) => snapshot.at < clip.endSecond);
      }
      if (!clip.states.length) continue;
      const outputFile = path.join(outputRoot, `prep-${clipIndex + 1}.webm`);
      const partialFile = `${outputFile}.partial.webm`;
      ffmpegError = '';
      ffmpeg = spawn(ffmpegExecutable, ['-hide_banner','-loglevel','warning','-f','ivf','-i','pipe:0','-c:v','copy','-cues_to_front','1','-f','webm','-y',partialFile], { stdio: ['pipe','ignore','pipe'] });
      ffmpeg.stderr.setEncoding('utf8'); ffmpeg.stderr.on('data', (s) => { ffmpegError += s; });
      ffmpeg.stdin.on('error', (error) => stage(`FFmpeg stdin: ${error.code || error.message}`));
      stage(`encoding prep ${clipIndex + 1}: ${clip.startSecond}-${clip.endSecond}s with ${clip.states.length} state snapshot(s)`);
      ffmpeg.stdin.write(ivfHeader(layout.width, layout.height, fps));
      const render = await page.evaluate(async ({ clip, clipIndex, fps, bitrate, width, height }) => {
        const { view, prepView, prepCameraFor, catalog, data, clips, replays } = window.__renderer;
        const { drawRecordingCanvasFrame } = await import('/js/independent/recordingCanvas.js');
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        const encoder = new VideoEncoder({ output: (chunk) => {
          const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
          let binary = ''; for (let p = 0; p < bytes.length; p += 0x8000) binary += String.fromCharCode(...bytes.subarray(p, p + 0x8000));
          const b64 = btoa(binary);
          encoder.serial = encoder.serial.then(() => window.__encoderChunk({ data: b64, pts: Math.round(chunk.timestamp * fps / 1e6) }));
        }, error: (e) => { encoder.error = String(e); } });
        encoder.serial = Promise.resolve(); encoder.configure({ codec: 'vp8', width, height, framerate: fps, bitrate, latencyMode: 'realtime' });
        const count = Math.ceil((clip.endSecond - clip.startSecond) * fps); let stateIndex = -1;
        const stateFrames = [];
        const positions = (state) => [...(state.pieces || []), ...(state.summons || [])].map((piece) => ({ uid: piece.uid, row: piece.row ?? null, col: piece.col ?? null }));
        for (let i = 0; i < count; i++) {
          const wallSecond = clip.startSecond + i / fps;
          while (stateIndex + 1 < clip.states.length && clip.states[stateIndex + 1].at <= wallSecond + 1e-8) {
            stateIndex++;
            const snapshot = clip.states[stateIndex];
            // Mirror independent/game.js: choose prep vs bossPrep and the shop framing from each recorded state.
            // Session recordings are single-player; the stable synthetic identity selects the same left-side camera.
            const state = snapshot.state;
            if (snapshot.sourceKind === 'legacy-rrweb-visual') {
              const nextBattle = clips.find((candidate) => candidate.startSecond >= snapshot.at) || clips.at(-1);
              const nextReplay = replays[nextBattle?.round];
              state.round = nextBattle?.round ?? state.round;
              if (nextReplay?.field?.stageId) state.stageId = nextReplay.field.stageId;
              if (nextReplay?.field?.kind === 'boss') state.board = { ...(state.board || {}), field: 'bossL', bossRound: state.round };
            }
            if (state.stageId) {
              const stage = data.lookup('stages', state.stageId);
              if (stage) view.setStage(stage);
            }
            view.setPrep(prepView(state, catalog), { editable: false });
            const boss = state.board?.field === 'bossL';
            const round = boss ? (state.board?.bossRound ?? state.round) : state.round;
            const pub = { round, bossRound: boss ? round : null, hiddenRound: null,
              players: [{ playerId: 'recorded-player', seat: 0 }] };
            const camera = prepCameraFor(pub, 'recorded-player', false);
            view.setCamera(camera.kind, { ...camera.opts, instant: true });
            if (snapshot.sourceKind === 'legacy-rrweb-visual') {
              if (!view.setRecordedPrepVisualPoses(snapshot.visualPoses || [])) throw new Error('native legacy pose projection refused the prep state');
            }
            stateFrames.push({ seq: snapshot.sourceSeq, kind: snapshot.sourceKind, revision: snapshot.revision, at: snapshot.at, frameIndex: i,
              positions: positions(snapshot.state), ...(snapshot.visualPoses ? { visualPoses: snapshot.visualPoses } : {}) });
          }
          if (stateIndex < 0) throw new Error(`prep clip ${clipIndex + 1} has no state at ${wallSecond}s`);
          if (!view.renderRecordedFrame({ gameTime: i / fps, delta: 1 / fps, rate: 1 })) throw new Error('native prep recorded-frame renderer refused frame');
          if (!drawRecordingCanvasFrame(document.getElementById('host'), ctx, width, height)) throw new Error('native prep canvas composition failed');
          const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps) }); encoder.encode(vf, { keyFrame: i === 0 || i % fps === 0 }); vf.close();
          if (encoder.encodeQueueSize > 8) await new Promise((resolve) => { encoder.addEventListener('dequeue', resolve, { once: true }); });
          const settled = clip.states[stateIndex];
          if (settled && !settled.screenshotTaken && wallSecond >= settled.at + 0.3
            && (!clip.states[stateIndex + 1] || wallSecond < clip.states[stateIndex + 1].at)) {
            settled.screenshotTaken = true;
            const source = settled.state;
            const nativePositions = [...(source.pieces || []), ...(source.summons || [])].map((piece) => {
              const uid = Number(String(piece.uid).replace(/^\D+/, ''));
              const rect = view.pieceScreenRect(uid);
              const hit = rect ? view.pieceAtClient(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
              const tile = Number.isInteger(piece.row) && Number.isInteger(piece.col) ? view.tileScreen(piece.row, piece.col) : null;
              return { uid, expectedRow: piece.row ?? null, expectedCol: piece.col ?? null, renderedArea: hit?.area || null,
                bodyVisible: !!rect, bodyRect: rect, tileVisible: Number.isInteger(piece.row) ? !!tile : null, tile };
            });
            const canvases = [...document.querySelectorAll('#host canvas')].map((canvas) => ({ width: canvas.width, height: canvas.height,
              context: canvas.__context || canvas.getAttribute('data-render-surface'), ...(() => { const style = getComputedStyle(canvas); const rect = canvas.getBoundingClientRect();
                return { display: style.display, visibility: style.visibility, opacity: style.opacity, zIndex: style.zIndex, rect: rect.toJSON() }; })() }));
            await window.__capturePrepStateFrame({ clipIndex: clipIndex + 1, seq: settled.sourceSeq, revision: settled.revision, frameIndex: i,
              nativePositions, renderStats: view.stats(), canvases });
          }
        }
        await encoder.flush(); await encoder.serial; const encoderState = encoder.state; encoder.close();
        return { frames: count, stateFrames, encoderState, error: encoder.error || null };
      }, { clip, clipIndex, fps, bitrate, width: layout.width, height: layout.height });
      if (render.error) throw new Error(`prep WebCodecs encoder failed: ${render.error}`);
      if (fatalPageErrors.length) throw new Error(`native browser prep render errors: ${fatalPageErrors.join('\n')}`);
      ffmpeg.stdin.end();
      const [exitCode] = await once(ffmpeg, 'close');
      if (exitCode !== 0) throw new Error(`prep FFmpeg exit ${exitCode}: ${ffmpegError}`);
      await fsp.rename(partialFile, outputFile);
      const probe = spawn(ffprobe, ['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,bit_rate','-show_entries','format=duration,size','-of','json',outputFile], { stdio: ['ignore','pipe','pipe'] });
      let probeOut = '', probeErr = ''; probe.stdout.setEncoding('utf8'); probe.stderr.setEncoding('utf8'); probe.stdout.on('data', (s) => { probeOut += s; }); probe.stderr.on('data', (s) => { probeErr += s; });
      const [probeCode] = await once(probe, 'close'); if (probeCode !== 0) throw new Error(`prep ffprobe exit ${probeCode}: ${probeErr}`);
      const probed = JSON.parse(probeOut); const stream = probed.streams?.[0];
      const receipt = { ok: true, kind: 'prep', clipIndex: clipIndex + 1, startSecond: clip.startSecond, endSecond: clip.endSecond,
        sourceRevision, sourceSnapshots: clip.states.map(({ sourceSeq, sourceKind, revision, at, frameIndex }) => ({ sourceSeq, sourceKind, revision, at, frameIndex })),
        render, output: outputFile, ffprobe: probed, ffmpegExitCode: exitCode, ffprobeExitCode: probeCode,
        stateScreenshots: prepStateScreenshots.filter((item) => item.clipIndex === clipIndex + 1) };
      if (!stream || stream.width !== layout.width || stream.height !== layout.height || Number(probed.format?.duration) < (clip.endSecond - clip.startSecond) * 0.95) throw new Error('prep WebM failed dimension/duration checks');
      await fsp.writeFile(path.join(outputRoot, `renderer-prep-${clipIndex + 1}.receipt.json`), JSON.stringify(receipt, null, 2));
      renderedClips.push({ kind: 'prep', startSecond: clip.startSecond, endSecond: clip.endSecond, mediaDuration: Number(probed.format.duration), file: path.basename(outputFile), sourceSnapshots: receipt.sourceSnapshots });
      ffmpeg = null;
    }
    if ((args.sampleSeconds != null || args['source-segments-json']) && args.prepOnly) {
      let compositeIntervals;
      if (args['source-segments-json']) {
        const intervalInput = JSON.parse(await fsp.readFile(path.resolve(args['source-segments-json']), 'utf8'));
        compositeIntervals = Array.isArray(intervalInput) ? intervalInput : intervalInput.segments;
        if (!Array.isArray(compositeIntervals) || !compositeIntervals.length) throw new Error('source-segments JSON must contain a non-empty segments array');
        let priorEnd = -Infinity;
        for (const [index, interval] of compositeIntervals.entries()) {
          if (!interval.segmentId || !Number.isFinite(interval.sourceStartSecond) || !Number.isFinite(interval.sourceEndSecond)
            || interval.sourceStartSecond < priorEnd || interval.sourceEndSecond <= interval.sourceStartSecond || interval.sourceEndSecond > recordingDuration) {
            throw new Error(`invalid/overlapping source segment ${index}: ${JSON.stringify(interval)}`);
          }
          priorEnd = interval.sourceEndSecond;
        }
      } else {
        const sourceStartSecond = args.sampleStartSecond ?? 0;
        compositeIntervals = [{ segmentId: `sample-${sourceStartSecond}`, sourceStartSecond, sourceEndSecond: Math.min(recordingDuration, sourceStartSecond + args.sampleSeconds) }];
      }
      for (const interval of compositeIntervals) {
      const sourceStart = interval.sourceStartSecond, sourceEnd = interval.sourceEndSecond;
      const frameCount = Math.ceil((sourceEnd - sourceStart) * fps - 1e-9), compositeFile = path.join(outputRoot, `${interval.segmentId}.mp4`);
      ffmpegError = '';
      ffmpeg = spawn(compositeFfmpeg, ['-hide_banner','-loglevel','warning','-f','image2pipe','-framerate',String(fps),'-vcodec','png','-i','pipe:0','-vf','crop=2560:1260:0:0','-an','-c:v','h264_nvenc','-preset','p7','-tune','hq','-rc','vbr','-cq','16','-b:v','0','-maxrate','48M','-bufsize','96M','-spatial-aq','1','-temporal-aq','1','-rc-lookahead','32','-multipass','fullres','-g','60','-pix_fmt','yuv420p','-r',String(fps),'-movflags','+faststart','-y',compositeFile], { stdio: ['pipe','ignore','pipe'] });
      ffmpeg.stderr.setEncoding('utf8'); ffmpeg.stderr.on('data', (s) => { ffmpegError += s; });
      ffmpeg.on('close', (code) => stage(`composite FFmpeg exited ${code}: ${ffmpegError.trim().slice(0, 600)}`));
      ffmpeg.stdin.on('error', (error) => stage(`composite FFmpeg stdin: ${error.code || error.message}`));
      const rrState = await page.evaluate(() => ({ timerReady: window.__renderer.rrTimerReady,
        frame: !!window.__renderer.rrPlayer?.iframe,
        timerActions: window.__renderer.rrPlayer?.timer?.actions?.length }));
      if (!rrState.timerReady || !rrState.frame) throw new Error(`RRWeb deterministic composite is unavailable: ${JSON.stringify(rrState)}`);
      stage(`capturing RRWeb/native composite ${interval.segmentId} ${sourceStart}-${sourceEnd}s (${frameCount} frames)`);
      const compositeTiming = { rrAndNativeMs: 0, screenshotMs: 0, pipeMs: 0, drainWaitMs: 0, frames: 0 };
      const sceneAudit = [];
      for (let i = 0; i < frameCount; i++) {
        const second = sourceStart + i / fps;
        const renderStarted = performance.now();
        const frameAudit = await page.evaluate(async ({ second, i, fps, sourceStart }) => {
          const renderer = window.__renderer, player = renderer.rrPlayer, timer = player.timer;
          const clock = renderer.seekRrwebSource(second);
          if (Math.abs(clock.clockErrorMs) > 1) throw new Error(`RRWeb source time mismatch at output frame ${i}: ${JSON.stringify(clock)}`);
          const replayDoc = player.iframe?.contentDocument;
          const start = replayDoc?.querySelector('.ix-start'), startStyle = start ? getComputedStyle(start) : null;
          const startVisible = !!start && startStyle.display !== 'none' && startStyle.visibility !== 'hidden' && Number(startStyle.opacity) > 0;
          const hasRecordedGameField = !!replayDoc?.querySelector('.gm__field') && !startVisible;
          if (hasRecordedGameField) renderer.ensureCompositeCanvas();
          let active = null, activeSnapshot = null;
          for (const clip of renderer.prepClips) if (second >= clip.startSecond && second < clip.endSecond) { active = clip; break; }
          if (active && hasRecordedGameField) {
            let snapIndex = -1;
            for (let n = 0; n < active.states.length; n++) if (active.states[n].at <= second + 1e-8) snapIndex = n; else break;
            if (snapIndex >= 0) {
              const snapshot = active.states[snapIndex];
              activeSnapshot = snapshot;
              const key = `${active.startSecond}:${snapshot.sourceSeq}`;
              if (renderer.compositeStateKey !== key) {
                const state = snapshot.state;
                const nextBattle = renderer.clips.find((candidate) => candidate.startSecond >= snapshot.at) || renderer.clips.at(-1);
                const nextReplay = renderer.replays[nextBattle?.round];
                state.round = nextBattle?.round ?? state.round;
                if (nextReplay?.field?.stageId) state.stageId = nextReplay.field.stageId;
                if (nextReplay?.field?.kind === 'boss') state.board = { ...(state.board || {}), field: 'bossL', bossRound: state.round };
                if (state.stageId) { const stage = renderer.data.lookup('stages', state.stageId); if (stage) renderer.view.setStage(stage); }
                renderer.view.setPrep(renderer.prepView(state, renderer.catalog), { editable: false });
                const boss = state.board?.field === 'bossL', round = boss ? (state.board?.bossRound ?? state.round) : state.round;
                const camera = renderer.prepCameraFor({ round, bossRound: boss ? round : null, hiddenRound: null,
                  players: [{ playerId: 'recorded-player', seat: 0 }] }, 'recorded-player', false);
                renderer.view.setCamera(camera.kind, { ...camera.opts, instant: true });
                if (!renderer.view.setRecordedPrepVisualPoses(snapshot.visualPoses || [])) throw new Error('native legacy pose projection refused composite state');
                // UnitView creates its Spine actor asynchronously after the first prep state is applied.
                // Keep RRWeb pinned to this exact source second while that one-time model load settles;
                // otherwise the badge is visible but the native body is captured as blank on the first frame.
                const unitIds = (state.pieces || []).map((piece) => Number(String(piece.uid ?? '').replace(/^\D+/, ''))).filter(Number.isInteger);
                const deadline = performance.now() + 10000;
                let loading = [];
                do {
                  loading = unitIds.map((uid) => ({ uid, view: renderer.view.debug.views.get(`p:${uid}`) }))
                    .filter(({ view }) => view && view._spineBusy);
                  if (!loading.length) break;
                  if (performance.now() >= deadline) throw new Error(`native prep model load timed out at source ${second}s: ${JSON.stringify(loading.map(({ uid, view }) => ({ uid, entry: view.entry?.name || null, actor: !!view.actor, retryAt: view._retryAt || 0 })))}`);
                  await new Promise((resolve) => setTimeout(resolve, 25));
                } while (loading.length);
                // Settle the actor's initial display/swap state with two native ticks;
                // the RRWeb source clock is unchanged and subsequent frames need no wait.
                for (let tick = 0; tick < 2; tick++) renderer.view.renderRecordedFrame({ gameTime: second - sourceStart, delta: 1 / fps, rate: 1 });
                renderer.compositeStateKey = key;
              }
              if (!renderer.view.renderRecordedFrame({ gameTime: second - sourceStart, delta: 1 / fps, rate: 1 })) throw new Error('native prep composite frame refused');
              if (renderer.rrCanvas && renderer.canvasComposer.drawRecordingCanvasFrame(document.getElementById('host'), renderer.compositeContext,
                renderer.rrCanvas.width, renderer.rrCanvas.height)) {
                renderer.rrContext.clearRect(0, 0, renderer.rrCanvas.width, renderer.rrCanvas.height);
                renderer.rrContext.drawImage(renderer.compositeCanvas, 0, 0, renderer.rrCanvas.width, renderer.rrCanvas.height);
              }
            }
          }
          let battleAudit = null;
          if (!active && hasRecordedGameField) {
            const battleClip = renderer.clips.find((clip) => second >= clip.startSecond && second < clip.endSecond);
            if (battleClip) {
              const sourceClip = renderer.battleClips.find((candidate) => Number(candidate.round) === Number(battleClip.round));
              if (!sourceClip || !Number.isFinite(sourceClip.mediaDuration) || sourceClip.mediaDuration <= 0) {
                throw new Error(`high-quality native battle media missing for round ${battleClip.round}`);
              }
              const mediaDuration = sourceClip.mediaDuration;
              const desiredMediaTime = sourceClip.mediaOffsetSeconds != null
                ? Math.max(0, second - Number(sourceClip.mediaOffsetSeconds))
                : Math.max(0, (second - battleClip.startSecond) / (battleClip.endSecond - battleClip.startSecond) * mediaDuration);
              const mediaFrameIndex = renderer.nearestBattleFrameIndex(sourceClip.frameTimes || [], desiredMediaTime);
              const imageUrl = `/__battle-frame/${battleClip.round}/${mediaFrameIndex}`;
              if (renderer.activeBattleImageUrl !== imageUrl) {
                const retryUrls = renderer.battleFrameRetryUrls(battleClip.round, mediaFrameIndex, 3);
                let decoded = null, lastDecodeError = null;
                for (let attempt = 0; attempt < retryUrls.length; attempt++) {
                  const requestUrl = retryUrls[attempt];
                  try {
                    const response = await fetch(requestUrl, { cache: 'no-store' });
                    if (!response.ok) {
                      const body = (await response.text()).slice(0, 512);
                      throw new Error(`HTTP ${response.status} ${requestUrl}: ${body}`);
                    }
                    const candidate = await createImageBitmap(await response.blob());
                    if (candidate.width !== sourceClip.frameWidth || candidate.height !== sourceClip.frameHeight) {
                      const dimensions = `${candidate.width}x${candidate.height}`; candidate.close(); throw new Error(`decoded dimensions ${dimensions}`);
                    }
                    decoded = candidate;
                    break;
                  } catch (error) {
                    lastDecodeError = error;
                    await window.__rendererProgress(`battle frame decode retry ${attempt + 1}/${retryUrls.length} source=${second.toFixed(3)} round=${battleClip.round} index=${mediaFrameIndex} url=${requestUrl} error=${error?.message || error}`);
                    if (attempt + 1 < retryUrls.length) await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
                  }
                }
                if (!decoded) throw new Error(`battle frame image failed bounded decode retries: ${JSON.stringify({ sourceSecond: second, round: battleClip.round, frameIndex: mediaFrameIndex, imageUrl, error: lastDecodeError?.message || String(lastDecodeError) })}`);
                renderer.battleBitmap?.close();
                renderer.battleBitmap = decoded;
                renderer.activeBattleImageUrl = imageUrl;
              }
              if (!renderer.battleBitmap || renderer.battleBitmap.width !== sourceClip.frameWidth || renderer.battleBitmap.height !== sourceClip.frameHeight) throw new Error(`native battle decoded frame invalid: ${JSON.stringify({ round: battleClip.round, frameIndex: mediaFrameIndex, width: renderer.battleBitmap?.width, height: renderer.battleBitmap?.height })}`);
              renderer.compositeContext.clearRect(0, 0, renderer.compositeCanvas.width, renderer.compositeCanvas.height);
              renderer.compositeContext.drawImage(renderer.battleBitmap, 0, 0, renderer.compositeCanvas.width, renderer.compositeCanvas.height);
              if (renderer.rrCanvas) {
                renderer.rrContext.clearRect(0, 0, renderer.rrCanvas.width, renderer.rrCanvas.height);
                renderer.rrContext.drawImage(renderer.compositeCanvas, 0, 0, renderer.rrCanvas.width, renderer.rrCanvas.height);
              }
              battleAudit = { round: battleClip.round, mediaFile: sourceClip.file, desiredMediaTime, mediaFrameIndex, frameUrl: imageUrl,
                decodedWidth: renderer.battleBitmap.width, decodedHeight: renderer.battleBitmap.height, sourceSpan: battleClip.endSecond - battleClip.startSecond,
                mediaDuration: sourceClip.mediaDuration };
            }
          }
          const cursors = [...document.querySelectorAll('.replayer-mouse')].map((element) => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return { className: element.className, left: style.left, top: style.top, display: style.display,
              opacity: style.opacity, visibility: style.visibility, rect: rect.toJSON(), backgroundImage: style.backgroundImage };
          });
          const recordingControls = [...(replayDoc?.querySelectorAll('.ix-recording') || [])].map((element) => {
            const style = getComputedStyle(element);
            return { display: style.display, visibility: style.visibility, opacity: style.opacity };
          });
          const nativeUnit = renderer.view.debug.views.get('p:1');
          const nativeCanvases = [...document.querySelectorAll('#host canvas')].map((element) => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return { width: element.width, height: element.height, clientWidth: element.clientWidth, clientHeight: element.clientHeight,
              rect: rect.toJSON(), cssTransform: style.transform, cssWidth: style.width, cssHeight: style.height };
          });
          const rrLayers = replayDoc ? [...replayDoc.querySelectorAll('.gm__field,.gm__field canvas[data-sp-canvas-surface="1"]')].map((element) => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return { selector: element.matches('canvas') ? '.gm__field canvas[data-sp-canvas-surface="1"]' : '.gm__field',
              rect: rect.toJSON(), cssTransform: style.transform, cssWidth: style.width, cssHeight: style.height,
              offsetWidth: element.offsetWidth, offsetHeight: element.offsetHeight };
          }) : [];
          return { sourceSecond: second, clockErrorMs: clock.clockErrorMs, hasRecordedGameField, startVisible, cursors, recordingControls,
            dimensions: { outerViewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
              outerHost: (() => { const element = document.querySelector('#host'), rect = element?.getBoundingClientRect(); return rect ? { rect: rect.toJSON(), clientWidth: element.clientWidth, clientHeight: element.clientHeight } : null; })(),
              rrIframe: (() => { const frame = window.__renderer.rrPlayer.iframe, rect = frame?.getBoundingClientRect(); return rect ? { rect: rect.toJSON(), width: frame.clientWidth, height: frame.clientHeight,
                document: { width: frame.contentDocument.documentElement.clientWidth, height: frame.contentDocument.documentElement.clientHeight,
                  dpr: frame.contentWindow.devicePixelRatio } } : null; })(), nativeCanvases, rrLayers },
            nativeUnit: nativeUnit ? { actor: !!nativeUnit.actor, spineReady: nativeUnit.spineReady, swapT: nativeUnit.swapT,
              alpha: nativeUnit.root?.alpha, visible: nativeUnit.root?.visible, fallbackVisible: nativeUnit.fallback?.visible,
              fallbackAlpha: nativeUnit.fallback?.alpha, retryAt: nativeUnit._retryAt || 0, entry: nativeUnit.entry?.name || null,
              loading: !!nativeUnit._spineBusy, impostor: !!nativeUnit.imp?.sprite } : null,
            prep: activeSnapshot ? { at: activeSnapshot.at, sourceSeq: activeSnapshot.sourceSeq, pieces: activeSnapshot.state.pieces,
              visualPoses: activeSnapshot.visualPoses, nativeUnitRect1: renderer.view.pieceScreenRect(1) } : null, battle: battleAudit };
        }, { second, i, fps, sourceStart });
        if (i < 3 || i % fps === 0) sceneAudit.push(frameAudit);
        compositeTiming.rrAndNativeMs += performance.now() - renderStarted;
        const screenshotStarted = performance.now();
        const png = await page.screenshot({ type: 'png', captureBeyondViewport: false, optimizeForSpeed: true });
        compositeTiming.screenshotMs += performance.now() - screenshotStarted;
        if (i === 0 && compositeClips.length === 0) { await fsp.writeFile(path.join(outputRoot, 'composite-first-frame.png'), png); stage(`composite screenshot PNG ${png.length} bytes`); }
        const stillSecond = args.highDprSeconds.find((target) => Math.abs(second - target) < (0.5 / fps));
        if (stillSecond != null) {
          const originalViewport = page.viewport();
          await page.setViewport({ ...originalViewport, deviceScaleFactor: args.highDpr });
          const highPng = await page.screenshot({ type: 'png', captureBeyondViewport: false, optimizeForSpeed: true });
          const highPath = path.join(outputRoot, `high-dpr-${stillSecond.toFixed(3)}.png`);
          const viewportAudit = await page.evaluate(() => ({ cssViewport: { width: innerWidth, height: innerHeight }, devicePixelRatio }));
          if (highPng.readUInt32BE(16) !== Math.round(viewportAudit.cssViewport.width * args.highDpr)
            || highPng.readUInt32BE(20) !== Math.round(viewportAudit.cssViewport.height * args.highDpr)) {
            throw new Error(`high-DPR screenshot pixel dimensions mismatch: ${JSON.stringify({ viewportAudit, pngWidth: highPng.readUInt32BE(16), pngHeight: highPng.readUInt32BE(20) })}`);
          }
          await fsp.writeFile(highPath, highPng);
          highDprStills.push({ recordingId, sourceSecond: stillSecond, cssViewport: viewportAudit.cssViewport,
            devicePixelRatio: viewportAudit.devicePixelRatio, pixelWidth: highPng.readUInt32BE(16), pixelHeight: highPng.readUInt32BE(20), file: highPath });
          await page.setViewport(originalViewport);
          await fsp.writeFile(path.join(outputRoot, 'high-dpr-stills.json'), JSON.stringify(highDprStills, null, 2));
          stage(`high-DPR still ${highPath} at ${args.highDpr}x`);
        }
        for (const anchor of [7.7, 9.65, 11.6, 15.2]) {
          const anchorFrame = Math.round((anchor - sourceStart) * fps);
          if (anchorFrame === i) await fsp.writeFile(path.join(outputRoot, `composite-anchor-${second.toFixed(3)}.png`), png);
        }
        const pipeStarted = performance.now();
        try { if (!ffmpeg.stdin.write(png)) { const drainStarted = performance.now(); await once(ffmpeg.stdin, 'drain'); compositeTiming.drainWaitMs += performance.now() - drainStarted; } }
        catch (error) { throw new Error(`composite image pipe failed at frame ${i}: ${error.message}; ffmpeg=${ffmpegError.trim()}`); }
        compositeTiming.pipeMs += performance.now() - pipeStarted; compositeTiming.frames++;
        if (i % 60 === 0) stage(`composite frame ${i + 1}/${frameCount} at ${second.toFixed(3)}s; rr/native=${compositeTiming.rrAndNativeMs.toFixed(1)}ms screenshot=${compositeTiming.screenshotMs.toFixed(1)}ms pipe=${compositeTiming.pipeMs.toFixed(1)}ms`);
      }
      ffmpeg.stdin.end();
      const [compositeExit] = await once(ffmpeg, 'close');
      if (compositeExit !== 0) throw new Error(`composite FFmpeg exit ${compositeExit}: ${ffmpegError}`);
      const probe = spawn(ffprobe, ['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,bit_rate','-show_entries','format=duration,size','-of','json',compositeFile], { stdio: ['ignore','pipe','pipe'] });
      let probeOut = '', probeErr = ''; probe.stdout.setEncoding('utf8'); probe.stderr.setEncoding('utf8'); probe.stdout.on('data', (s) => { probeOut += s; }); probe.stderr.on('data', (s) => { probeErr += s; });
      const [probeCode] = await once(probe, 'close'); if (probeCode !== 0) throw new Error(`composite ffprobe exit ${probeCode}: ${probeErr}`);
      const probed = JSON.parse(probeOut), stream = probed.streams?.[0];
      if (!stream || stream.width !== 2560 || stream.height !== 1260 || Number(probed.format?.duration) < (sourceEnd - sourceStart) * 0.95) throw new Error(`composite dimensions/duration invalid: ${JSON.stringify(probed)}`);
      compositeClips.push({ kind: 'composite', segmentId: interval.segmentId, sourceStartSecond: sourceStart, sourceEndSecond: sourceEnd, file: compositeFile,
        width: stream.width, height: stream.height, fps, frames: frameCount, timing: compositeTiming, sceneAudit,
        ffmpegExitCode: compositeExit, ffprobeExitCode: probeCode, ffprobe: probed });
      await fsp.writeFile(path.join(outputRoot, `${interval.segmentId}.receipt.json`), JSON.stringify(compositeClips.at(-1), null, 2));
      ffmpeg = null;
      stage(`composite verified: ${interval.segmentId} ${stream.width}x${stream.height} ${fps}fps, ${probed.format.duration}s`);
      }
    }
    if (!args.prepOnly) for (const clip of clips) {
    const replay = replays[clip.round];
    const sessionPath = replay.sourcePath;
    const outputFile = path.join(outputRoot, `battle-${clip.round}.webm`);
    const partialFile = `${outputFile}.partial.webm`;
    ffmpegError = '';
    ffmpeg = spawn(ffmpegExecutable, ['-hide_banner','-loglevel','warning','-f','ivf','-i','pipe:0','-c:v','copy','-cues_to_front','1','-f','webm','-y',partialFile], { stdio: ['pipe','ignore','pipe'] });
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
    const screenshots = args.sampleSeconds == null ? [] : [path.join(outputRoot, `battle-${clip.round}-first.png`), path.join(outputRoot, `battle-${clip.round}-last.png`)];
    if (args.sampleSeconds != null) await page.screenshot({ path: screenshots[0] });
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
      const frames = replay.frames; const clock = helpers.replayClock(replay); const mapper = helpers.createReplayTimeMapper(clip, replay);
      let idx = 0; const count = Math.ceil(sampleSeconds * fps - 1e-9); let prior = null;
      for (let i = 0; i < count; i++) {
        const wallSecond = clip.startSecond + i / fps;
        const gameTime = mapper.at(wallSecond);
        const rate = prior == null ? mapper.initialRate : helpers.recordedAnimationRate(prior, gameTime, fps, mapper.initialRate); prior = gameTime;
        const windowed = helpers.frameFeedWindow(frames, gameTime, idx); idx = windowed.nextIndex;
        helpers.feedNativeFrames(view, windowed.frames, replay.field.fieldId);
        if (!view.renderRecordedFrame({ gameTime, delta: 1 / fps, rate })) throw new Error('native recorded-frame renderer refused frame');
        if (!drawRecordingCanvasFrame(document.getElementById('host'), ctx, width, height)) throw new Error('native canvas composition failed');
        const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps) }); encoder.encode(vf, { keyFrame: i === 0 || i % fps === 0 }); vf.close();
        if (encoder.encodeQueueSize > 8) await new Promise((resolve) => { encoder.addEventListener('dequeue', resolve, { once: true }); });
      }
      await encoder.flush(); await encoder.serial; const config = encoder.state; encoder.close();
      const timeMap = { origin: mapper.origin, measuredRate: mapper.measuredRate, initialRate: mapper.initialRate,
        speedChanges: mapper.speedChanges, skipAt: mapper.skipAt, finalZeroAt: mapper.finalZeroAt, calibration: mapper.calibration };
      return { frames: count, gameTimeEnd: mapper.at(clip.startSecond + (count - 1) / fps), replayClock: clock, timeMap, encoderState: config, warmReport: window.__warmReport, error: encoder.error || null };
    }, { sampleSeconds: args.sampleSeconds ?? Math.max(0.001, clip.endSecond - clip.startSecond), fps, bitrate, width: layout.width, height: layout.height, round: clip.round, clip });
    if (render.error) throw new Error(`WebCodecs encoder failed: ${render.error}`);
    if (fatalPageErrors.length) throw new Error(`native browser render errors: ${fatalPageErrors.join('\n')}`);
    if (args.sampleSeconds != null) await page.screenshot({ path: screenshots[1] });
    ffmpeg.stdin.end();
    const [exitCode] = await once(ffmpeg, 'close');
    if (exitCode !== 0) throw new Error(`FFmpeg exit ${exitCode}: ${ffmpegError}`);
    await fsp.rename(partialFile, outputFile);
    const probe = spawn(ffprobe, ['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,bit_rate','-show_entries','format=duration,size','-of','json',outputFile], { stdio: ['ignore','pipe','pipe'] });
    let probeOut='', probeErr=''; probe.stdout.setEncoding('utf8'); probe.stderr.setEncoding('utf8'); probe.stdout.on('data',(s)=>probeOut+=s); probe.stderr.on('data',(s)=>probeErr+=s);
    const [probeCode] = await once(probe,'close'); if (probeCode !== 0) throw new Error(`ffprobe exit ${probeCode}: ${probeErr}`);
    const probed = JSON.parse(probeOut); const stream = probed.streams?.[0];
    const expectedSeconds = args.sampleSeconds ?? clip.endSecond - clip.startSecond;
    const receipt = { ok: true, recordingId, sessionId, sourceRevision, round: clip.round, sourceReplay: sessionPath, sourceEvents: eventsPath,
      viewport: { width: layout.width, height: layout.height }, fps, videoBitsPerSecond: bitrate, encoder: encoderConfig,
      visualDiagnostics, render, output: outputFile, ffprobe: probed, ffmpegExitCode: exitCode, ffprobeExitCode: probeCode, screenshots };
    if (!stream || stream.width !== layout.width || stream.height !== layout.height || Number(probed.format?.duration) < expectedSeconds * 0.95) throw new Error('encoded WebM failed dimension/duration checks');
    await fsp.writeFile(path.join(outputRoot, `renderer-round-${clip.round}.receipt.json`), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt, null, 2));
    renderedClips.push({ round: clip.round, startSecond: clip.startSecond, endSecond: clip.endSecond, mediaDuration: Number(probed.format.duration), file: `battle-${clip.round}.webm` });
    ffmpeg = null;
    }
    if (!prepAudit.clips.length && args.prepOnly) throw new Error('prep-only verification found no timestamped prep state snapshots');
    if (!args.prepOnly && (renderedClips.filter((clip) => clip.kind !== 'prep').length !== clips.length || (args.sampleSeconds == null && renderedClips.filter((clip) => clip.kind !== 'prep').length !== (timeline.rounds || []).length))) throw new Error('render set incomplete; refusing to publish manifest');
    const manifestPath = path.join(outputRoot, 'manifest.json');
    const manifest = { schemaVersion: 1, recordingId, sessionId, sourceRevision, renderMode: args.prepOnly ? 'prep-only-verification' : 'full-recording',
      timebase: { clock: 'recording-start', recordingStartedAt: meta.startedAt, recordingEndedAt: meta.endedAt || meta.mediaCaptureStoppedAt,
        recordingDuration, mediaStartedAt: meta.mediaStartedAt || null, mediaOffsetSeconds }, viewport: { width: layout.width, height: layout.height }, fps, videoBitsPerSecond: bitrate,
      prepCoverage: { sourceSnapshotCount: prepAudit.sourceSnapshotCount, uncoveredGaps: prepAudit.uncoveredGaps,
        clips: prepAudit.clips.map((clip) => ({ kind: 'prep', startSecond: clip.startSecond, endSecond: clip.endSecond,
          sourceSnapshots: clip.states.map(({ sourceSeq, sourceKind, revision, at, frameIndex }) => ({ sourceSeq, sourceKind, revision, at, frameIndex })) })) },
      stateScreenshots: prepStateScreenshots, prepClips: renderedClips.filter((clip) => clip.kind === 'prep'), compositeClips,
      clips: renderedClips.filter((clip) => clip.kind !== 'prep').sort((a, b) => a.round - b.round) };
    const manifestTemp = `${manifestPath}.partial`; await fsp.writeFile(manifestTemp, JSON.stringify(manifest, null, 2)); await fsp.rename(manifestTemp, manifestPath);
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
