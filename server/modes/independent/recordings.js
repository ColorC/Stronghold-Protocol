import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, appendFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// A rrweb full snapshot can carry a lossless canvas data URL as one indivisible event. Keep the request bounded while
// allowing that real frame through; the regular client batches remain capped at 1 MiB.
const MAX_BODY = 16 * 1024 * 1024;
const MAX_MEDIA_CHUNK = 8 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

function waitForReadStreamOpen(stream) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { stream.off('open', onOpen); stream.off('error', onError); };
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    stream.once('open', onOpen);
    stream.once('error', onError);
  });
}

function writeWithBackpressure(res, chunk) {
  if (res.destroyed || res.writableEnded) return Promise.resolve(false);
  if (res.write(chunk)) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const cleanup = () => { res.off('drain', onDrain); res.off('close', onClose); res.off('error', onError); };
    const onDrain = () => { cleanup(); resolve(!res.destroyed && !res.writableEnded); };
    const onClose = () => { cleanup(); resolve(false); };
    const onError = (error) => { cleanup(); reject(error); };
    res.once('drain', onDrain);
    res.once('close', onClose);
    res.once('error', onError);
  });
}

async function streamRecordingEvents(req, res, filename, meta) {
  const source = createReadStream(filename, { encoding: 'utf8' });
  let lines = null;
  let disconnected = false;
  const abort = () => {
    if (res.writableFinished || res.writableEnded) return;
    disconnected = true;
    lines?.close();
    source.destroy();
  };
  res.once('close', abort);
  req.once('aborted', abort);
  try {
    // Opening before sending headers preserves the existing 404 response for a missing events file.
    await waitForReadStreamOpen(source);
    if (disconnected) return;
    lines = createInterface({ input: source, crlfDelay: Infinity });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    const write = (chunk) => writeWithBackpressure(res, chunk);
    if (!await write(`{"ok":true,"meta":${JSON.stringify(meta)},"events":[`)) return;
    let first = true;
    for await (const line of lines) {
      if (disconnected) return;
      if (!line) continue;
      const event = JSON.parse(line);
      // Actual canvas pixels come from native media. Replaying the redundant
      // WebGL command stream adds texture copies and can stall a long recording.
      if (meta.mediaBytes && event.kind === 'rrweb' && event.p?.type === 3 && event.p?.data?.source === 9) continue;
      if (!await write(`${first ? '' : ','}${JSON.stringify(event)}`)) return;
      first = false;
    }
    if (!disconnected && !res.destroyed) res.end(']}');
  } finally {
    res.off('close', abort);
    req.off('aborted', abort);
    lines?.close();
    if (!source.destroyed) source.destroy();
  }
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size <= MAX_BODY) chunks.push(chunk); }
  if (size > MAX_BODY) throw Object.assign(new Error('BODY_LIMIT'), { status: 413 });
  let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('BAD_JSON'), { status: 400 }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('BAD_JSON'), { status: 400 });
  return value;
}
async function readMediaChunk(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size <= MAX_MEDIA_CHUNK) chunks.push(chunk); }
  if (size > MAX_MEDIA_CHUNK) throw Object.assign(new Error('MEDIA_LIMIT'), { status: 413 });
  return Buffer.concat(chunks);
}
async function remuxPlayback(dir, index=1, ffmpegPath=process.env.SP_FFMPEG_PATH || 'ffmpeg') {
  const stem=index===1?'canvas':`canvas-${index}`;
  const input = path.join(dir, `${stem}.webm`); const output = path.join(dir, `${stem}-playback.webm`); const pending = path.join(dir, `${stem}-playback.pending.webm`);
  try {
    await execFileAsync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-c:v', 'copy', '-cues_to_front', '1', pending],
      { timeout: 25000, windowsHide: true, maxBuffer: 1024 * 1024 });
    await rename(pending, output); const info = await stat(output); return { ready: true, bytes: info.size };
  } catch (error) {
    try { await unlink(pending); } catch { /* no generated output to remove */ }
    return { ready: false, bytes: 0, error: {
      exitCode: Number.isInteger(error.code) ? error.code : null,
      code: typeof error.code === 'string' ? error.code : null,
      signal: error.signal || null,
      message: error.message || String(error),
      stderr: String(error.stderr || ''), stdout: String(error.stdout || ''),
    } };
  }
}

/** Server-side rrweb event store. Recording IDs are opaque UUIDs and never become session state. */
export function createRecordingHttp({ directory, sessionDirectory, diagnosticsPath = '', ffmpegPath = process.env.SP_FFMPEG_PATH || 'ffmpeg', remuxSegment = null }) {
  if (!path.isAbsolute(directory) || !path.isAbsolute(sessionDirectory)) throw new Error('Recording and session directories must be absolute');
  const root = path.resolve(directory);
  const locks = new Map();
  const playbackFinalizers = new Map();
  const runRemux = remuxSegment || ((dir, index) => remuxPlayback(dir, index, ffmpegPath));
  const dirOf = (id) => path.join(root, id);
  const metaFile = (id) => path.join(dirOf(id), 'meta.json');
  const eventsFile = (id) => path.join(dirOf(id), 'events.jsonl');
  async function exclusive(id, task) {
    const previous = locks.get(id) || Promise.resolve(); const current = previous.catch(() => {}).then(task); locks.set(id, current);
    try { return await current; } finally { if (locks.get(id) === current) locks.delete(id); }
  }
  async function loadMeta(id) { return JSON.parse(await readFile(metaFile(id), 'utf8')); }
  function finalizePlayback(id) {
    const existing = playbackFinalizers.get(id);
    if (existing) return existing;
    let flight;
    flight = (async () => {
      const initial = await exclusive(id, () => loadMeta(id));
      if (!initial.mediaBytes || initial.mediaPlaybackReady) return initial;
      const stored = (initial.mediaSegments || []).filter((item) => Number.isInteger(item.index) && typeof item.startedAt === 'string');
      const segments = structuredClone(stored.length ? stored : [{ index: 1, startedAt: initial.mediaStartedAt, bytes: initial.mediaBytes, lastTimeMs: initial.mediaLastTimeMs }]);
      const results = [];
      for (const segment of segments) {
        if (segment.playbackReady) continue;
        const result = await runRemux(dirOf(id), segment.index);
        results.push({ index: segment.index, ...result });
        if (!result.ready) await writeDiagnostic({ type: 'media-playback-remux-failed', recordingId: id, segmentIndex: segment.index, error: result.error || null });
      }
      return exclusive(id, async () => {
        const current = await loadMeta(id);
        const latest = (current.mediaSegments || []).filter((item) => Number.isInteger(item.index) && typeof item.startedAt === 'string');
        const nextSegments = structuredClone(latest.length ? latest : segments);
        for (const result of results) {
          const segment = nextSegments.find((item) => item.index === result.index);
          if (!segment || segment.playbackReady) continue;
          segment.playbackReady = !!result.ready;
          segment.playbackBytes = result.ready ? Number(result.bytes) || 0 : 0;
          if (result.ready) delete segment.playbackError;
          else if (result.error) segment.playbackError = result.error;
        }
        const next = { ...current, mediaSegments: nextSegments,
          mediaPlaybackReady: nextSegments.every((item) => item.playbackReady),
          mediaPlaybackBytes: nextSegments.reduce((sum, item) => sum + (Number(item.playbackBytes) || 0), 0) };
        await saveMeta(id, next); return next;
      });
    })().finally(() => { if (playbackFinalizers.get(id) === flight) playbackFinalizers.delete(id); });
    playbackFinalizers.set(id, flight);
    return flight;
  }
  async function writeDiagnostic(entry) {
    if (!diagnosticsPath) return;
    await appendFile(diagnosticsPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8').catch(() => {});
  }
  async function saveMeta(id, meta) {
    const pending = `${metaFile(id)}.${randomUUID()}.pending`;
    await writeFile(pending, JSON.stringify(meta), { flag: 'wx' }); await rename(pending, metaFile(id));
  }
  return async function handleRecording(req, res, pathname) {
    if (!pathname.startsWith('/independent/api/recordings')) return false;
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { ok: false, error: 'ORIGIN' }), true;
      const relative = pathname.slice('/independent/api/recordings'.length).replace(/^\//, '');
      if (relative === 'start' && req.method === 'POST') {
        const body = await readBody(req);
        if (!UUID.test(body.sessionId || '') || (body.recordingId && !UUID.test(body.recordingId))) return json(res, 422, { ok: false, error: 'INVALID_ID' }), true;
        try { await readFile(path.join(sessionDirectory, `${body.sessionId}.json`)); }
        catch { return json(res, 404, { ok: false, error: 'SESSION_NOT_FOUND' }), true; }
        const id = body.recordingId || randomUUID();
        let nextSeq = 1; let nextMediaSeq = 1;let endedAt = null;let seenMechanisms=[];
        await exclusive(id, async () => {
          let meta;
          try { meta = await loadMeta(id); } catch (e) { if (e.code !== 'ENOENT') throw e; }
          if (meta && meta.sessionId !== body.sessionId) throw Object.assign(new Error('RECORDING_SESSION_MISMATCH'), { status: 409 });
          if (meta) { nextSeq = meta.nextSeq; nextMediaSeq=meta.nextMediaSeq||1; endedAt = meta.endedAt;seenMechanisms=(meta.captions||[]).map(x=>x.key).filter(Boolean); }
          if (!meta) {
            await mkdir(dirOf(id), { recursive: true });
            meta = { id, sessionId: body.sessionId, startedAt: new Date().toISOString(), endedAt: null, viewport: body.viewport || null, nextSeq: 1, captions: [] };
            await saveMeta(id, meta); await writeFile(eventsFile(id), '', { flag: 'wx' });
          } else if (!meta.endedAt) await saveMeta(id, { ...meta, resumedAt: new Date().toISOString() });
        });
        return json(res, 200, { ok: true, id, nextSeq, nextMediaSeq, endedAt,seenMechanisms }), true;
      }
      const mediaMatch = relative.match(/^([0-9a-f-]{36})\/media(?:\/(playback|\d+))?(?:\/(\d+))?$/i);
      if (mediaMatch && UUID.test(mediaMatch[1])) {
        const id = mediaMatch[1]; const mediaFile = path.join(dirOf(id), 'canvas.webm');
        if (mediaMatch[2] && /^\d+$/.test(mediaMatch[2]) && req.method === 'POST') {
          const requestStarted = performance.now();
          const seq = Number(mediaMatch[2]); const startedAt = Number(req.headers['x-media-started-at']);
          const timeMs = Number(req.headers['x-media-time-ms']);
          if (!Number.isSafeInteger(seq) || seq < 1 || !Number.isFinite(startedAt) || !Number.isFinite(timeMs) || timeMs < 0) return json(res, 422, { ok: false, error: 'INVALID_MEDIA_CHUNK' }), true;
          const readStarted = performance.now();
          const chunk = await readMediaChunk(req); if (!chunk.length) return json(res, 422, { ok: false, error: 'EMPTY_MEDIA_CHUNK' }), true;
          const bodyReadMs = performance.now() - readStarted;
          const lockQueuedAt = performance.now(); let lockAcquiredAt = lockQueuedAt; let appendMs = 0; let metadataWriteMs = 0;
          const result = await exclusive(id, async () => {
            lockAcquiredAt = performance.now();
            const meta = await loadMeta(id); if (meta.endedAt) return { error: 'ENDED' };
            const next = Number(meta.nextMediaSeq) || 1;
            if (seq < next) return { ack: next - 1 };
            if (seq > next) return { error: 'OUT_OF_ORDER', ack: next - 1 };
            const mime = String(req.headers['x-media-mime-type'] || 'video/webm').slice(0, 100);
            if (!mime.startsWith('video/webm')) return { error: 'INVALID_MEDIA_TYPE' };
            const segmentStartedAt=new Date(startedAt).toISOString();
            const segments=structuredClone((meta.mediaSegments||[]).filter(x=>Number.isInteger(x.index)&&typeof x.startedAt==='string'));
            if(!segments.length&&meta.mediaBytes)segments.push({index:1,startedAt:meta.mediaStartedAt,bytes:meta.mediaBytes,lastTimeMs:meta.mediaLastTimeMs||0,playbackReady:false});
            let segment=segments.at(-1);
            if(!segment||segment.startedAt!==segmentStartedAt){segment={index:segments.length+1,startedAt:segmentStartedAt,bytes:0,lastTimeMs:0,playbackReady:false};segments.push(segment);}
            const segmentFile=path.join(dirOf(id),segment.index===1?'canvas.webm':`canvas-${segment.index}.webm`);
            const appendStarted = performance.now(); await appendFile(segmentFile,chunk); appendMs = performance.now() - appendStarted; segment.bytes+=chunk.length;segment.lastTimeMs=timeMs;
            const metadataStarted = performance.now(); await saveMeta(id, { ...meta, nextMediaSeq: next + 1, mediaStartedAt: meta.mediaStartedAt || new Date(startedAt).toISOString(),
              mediaMimeType: mime, mediaBytes: (Number(meta.mediaBytes) || 0) + chunk.length,
              mediaChunks: (Number(meta.mediaChunks) || 0) + 1, mediaSegments:segments,mediaLastTimeMs:startedAt-Date.parse(meta.mediaStartedAt||segmentStartedAt)+timeMs });
            metadataWriteMs = performance.now() - metadataStarted;
            return { ack: next };
          });
          await writeDiagnostic({ type: 'media-post', recordingId: id, seq, requestBytes: chunk.length,
            status: result.error ? 409 : 200, ack: result.ack ?? null, error: result.error || null,
            bodyReadMs, exclusiveWaitMs: lockAcquiredAt - lockQueuedAt, appendMs, metadataWriteMs,
            totalMs: performance.now() - requestStarted });
          return json(res, result.error ? (result.error === 'ENDED' ? 409 : 409) : 200, { ok: !result.error, ...result }), true;
        }
        if (!mediaMatch[2] && req.method === 'GET') {
          const meta = await loadMeta(id);
          if (!meta.mediaBytes) return json(res, 404, { ok: false, error: 'MEDIA_NOT_FOUND' }), true;
          const first=meta.mediaSegments?.find(x=>x.index===1&&typeof x.startedAt==='string');
          res.writeHead(200, { 'Content-Type': meta.mediaMimeType || 'video/webm', 'Content-Length': String(first?.bytes||meta.mediaBytes), 'Cache-Control': 'private, no-store',
            'X-Media-Started-At': meta.mediaStartedAt || '', 'X-Media-Duration-Ms': String(first?.lastTimeMs||meta.mediaLastTimeMs || 0) });
          createReadStream(mediaFile).pipe(res); return true;
        }
        if (mediaMatch[2] === 'playback' && req.method === 'GET') {
          const meta = await loadMeta(id);
          const index=Number(mediaMatch[3]||1),segment=meta.mediaSegments?.find(x=>x.index===index&&typeof x.startedAt==='string');
          if(index!==1&&!segment)return json(res,404,{ok:false,error:'MEDIA_NOT_FOUND'}),true;
          if (!segment?.playbackReady&&!meta.mediaPlaybackReady) return json(res, 409, { ok: false, error: 'MEDIA_NOT_FINALIZED' }), true;
          const file = path.join(dirOf(id), index===1?'canvas-playback.webm':`canvas-${index}-playback.webm`); const info = await stat(file); const range = req.headers.range;
          const match = typeof range === 'string' ? range.match(/^bytes=(\d*)-(\d*)$/) : null;
          if (range && !match) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return true; }
          let start = 0; let end = info.size - 1;
          if (match) { start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2])); end = match[2] && match[1] ? Number(match[2]) : info.size - 1; }
          if (start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return true; }
          end = Math.min(end, info.size - 1);
          res.writeHead(match ? 206 : 200, { 'Content-Type': 'video/webm', 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, no-store', ...(match ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
          createReadStream(file, { start, end }).pipe(res); return true;
        }
      }
      const match = relative.match(/^([0-9a-f-]{36})(?:\/(events|stop))?$/i);
      if (!match || !UUID.test(match[1])) return json(res, 404, { ok: false, error: 'NOT_FOUND' }), true;
      const id = match[1]; const action = match[2] || 'read';
      if (action === 'events' && req.method === 'POST') {
        const batch = await readBody(req);
        const events = Array.isArray(batch.events) ? batch.events : [batch];
        if (events.length > 200 || events.some((e) => !Number.isSafeInteger(e.seq) || e.seq < 1 || typeof e.kind !== 'string' || e.kind.length > 60 || !Number.isFinite(e.ts))) return json(res, 422, { ok: false, error: 'INVALID_EVENT' }), true;
        const ack = await exclusive(id, async () => {
          const meta = await loadMeta(id);
          if (meta.endedAt) return { error: 'ENDED' };
          const fresh = events.filter((event) => event.seq >= meta.nextSeq).sort((a, b) => a.seq - b.seq);
          const ordered = []; let next = meta.nextSeq;
          for (const event of fresh) {
            if (event.seq === next) { ordered.push(event); next += 1; }
            else if (event.seq > next) break;
          }
          if (ordered.length) {
            await appendFile(eventsFile(id), `${ordered.map((event) => JSON.stringify({ sid: id, seq: event.seq, ts: event.ts, surface: 'independent-game', src: 'browser', kind: event.kind, p: event.p })).join('\n')}\n`);
            await saveMeta(id, { ...meta, nextSeq: next, captions: [...meta.captions, ...ordered.filter((event) => event.kind === 'caption').map((event) => event.p)] });
          }
          return { ack: next - 1 };
        });
        return json(res, ack.error ? 409 : 200, { ok: !ack.error, ...ack }), true;
      }
      if (action === 'stop' && req.method === 'POST') {
          const stopInfo = await readBody(req);
          const captureStoppedAt = Number(stopInfo.mediaCaptureStoppedAt);
          const captureLastTimeMs = Number(stopInfo.mediaCaptureLastTimeMs);
          const captureLastPaintedAt = Number(stopInfo.mediaCaptureLastPaintedAt);
          const captureFinalSeq = Number(stopInfo.mediaCaptureFinalSeq);
          let meta = await exclusive(id, async () => { const current = await loadMeta(id); if (current.endedAt) return current;
            const endedAt = new Date().toISOString(); const segments = (current.mediaSegments || []).filter((item) => Number.isInteger(item.index) && typeof item.startedAt === 'string');
            const lastSegment = segments.at(-1) || null;
            const lastSegmentWall = lastSegment ? Date.parse(lastSegment.startedAt) + Number(lastSegment.lastTimeMs || 0) : 0;
            const serverFinalSeq = Math.max(0, (Number(current.nextMediaSeq) || 1) - 1);
            const captureStopChecks = {
              timestampValid: Number.isSafeInteger(captureStoppedAt) && captureStoppedAt > 0 && captureStoppedAt <= Date.now() + 30000,
              afterCaptureStart: !current.mediaStartedAt || captureStoppedAt >= Date.parse(lastSegment?.startedAt || current.mediaStartedAt) - 1000,
              afterLastDeclaredFrame: !lastSegment || captureStoppedAt >= lastSegmentWall - 1000,
              lastChunkTimeMatches: !lastSegment || (Number.isFinite(captureLastTimeMs) && Math.abs(captureLastTimeMs - Number(lastSegment.lastTimeMs || 0)) <= 1500),
              lastCanvasPaintedNearStop: Number.isSafeInteger(captureLastPaintedAt) && captureLastPaintedAt > 0
                && captureLastPaintedAt <= captureStoppedAt && captureStoppedAt - captureLastPaintedAt <= 1250,
              allChunksAcknowledged: Number.isSafeInteger(captureFinalSeq) && captureFinalSeq === serverFinalSeq,
            };
            const validCaptureStop = Object.values(captureStopChecks).every(Boolean);
            const done = { ...current, endedAt,
              ...(validCaptureStop ? { mediaCaptureStoppedAt: new Date(captureStoppedAt).toISOString(), mediaCaptureLastTimeMs: Math.max(0, captureLastTimeMs),
                mediaCaptureLastPaintedAt: new Date(captureLastPaintedAt).toISOString(), mediaCaptureFinalSeq: captureFinalSeq } : {}),
              mediaCaptureStopValidation: { accepted: validCaptureStop, captureStopChecks,
                serverFinalSeq, declaredCaptureFinalSeq: Number.isSafeInteger(captureFinalSeq) ? captureFinalSeq : null,
                lastSegmentWall: lastSegmentWall || null } };
            await saveMeta(id, done); return done; });
          if (meta.mediaCaptureStoppedAt) await writeDiagnostic({ type: 'media-capture-stop', recordingId: id,
            captureStoppedAt: meta.mediaCaptureStoppedAt, mediaCaptureLastTimeMs: meta.mediaCaptureLastTimeMs,
            mediaCaptureLastPaintedAt: meta.mediaCaptureLastPaintedAt,
            mediaCaptureFinalSeq: meta.mediaCaptureFinalSeq, finalizeAt: meta.endedAt,
            finalizeDelayMs: Date.parse(meta.endedAt) - Date.parse(meta.mediaCaptureStoppedAt) });
          else if (meta.mediaCaptureStopValidation) await writeDiagnostic({ type: 'media-capture-stop-rejected', recordingId: id,
            validation: meta.mediaCaptureStopValidation });
          if (meta.mediaBytes && !meta.mediaPlaybackReady) meta = await finalizePlayback(id);
          return json(res, 200, { ok: true, endedAt: meta.endedAt, mediaPlaybackReady: !!meta.mediaPlaybackReady }), true;
      }
      if (action === 'read' && req.method === 'GET') {
        const meta = await loadMeta(id);
        if (new URL(req.url, 'http://localhost').searchParams.get('meta') === '1') return json(res, 200, { ok: true, meta }), true;
        await streamRecordingEvents(req, res, eventsFile(id), meta);
        return true;
      }
      return json(res, 405, { ok: false, error: 'METHOD' }), true;
    } catch (error) {
      if (res.headersSent) {
        // A malformed event cannot be skipped without changing replay history; terminate the partial JSON response.
        if (!res.destroyed) res.destroy(error);
        return true;
      }
      if (req.aborted || res.destroyed) return true;
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      return json(res, status, { ok: false, error: error.status ? error.message : status === 404 ? 'NOT_FOUND' : 'RECORDING_FAILED' }), true;
    }
  };
}
