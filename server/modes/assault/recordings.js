// Structured play recordings for 进击: rrweb events (DOM + interaction), the board canvas as native WebM chunks, the
// subtitle track and review comments. Layout: <root>/<id>/{meta.json, events.jsonl[.gz], canvas*.webm, captions.json,
// comments.json}. Nothing here renders or transcodes video; the browser records and the browser plays.
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { handleRecordingComments } from './recording-comments.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const RECORDINGS_PREFIX = '/api/assault/recordings';
// A rrweb full snapshot is one indivisible event that inlines the page's stylesheets.
const MAX_BODY = 16 * 1024 * 1024;
const MAX_MEDIA_CHUNK = 8 * 1024 * 1024;
const MAX_CAPTIONS = 400;
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

async function readBody(req, max = MAX_BODY) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size <= max) chunks.push(chunk); }
  if (size > max) throw Object.assign(new Error('BODY_LIMIT'), { status: 413 });
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

function waitForOpen(stream) {
  return new Promise((resolve, reject) => {
    const onOpen = () => { stream.off('error', onError); resolve(); };
    const onError = (error) => { stream.off('open', onOpen); reject(error); };
    stream.once('open', onOpen); stream.once('error', onError);
  });
}
function write(res, chunk) {
  if (res.destroyed || res.writableEnded) return Promise.resolve(false);
  if (res.write(chunk)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (value) => { res.off('drain', onDrain); res.off('close', onClose); resolve(value); };
    const onDrain = () => done(!res.destroyed); const onClose = () => done(false);
    res.once('drain', onDrain); res.once('close', onClose);
  });
}

/** Stream `{ok, meta, events:[...]}` from a (possibly gzip) JSON-lines file without holding it in memory. */
async function streamEvents(req, res, filename, gz, meta) {
  const raw = createReadStream(filename);
  const source = gz ? raw.pipe(createGunzip()) : raw;
  let lines = null; let gone = false;
  const abort = () => { if (res.writableFinished) return; gone = true; lines?.close(); raw.destroy(); source.destroy(); };
  res.once('close', abort); req.once('aborted', abort);
  try {
    await waitForOpen(raw);
    if (gone) return;
    source.setEncoding('utf8');
    lines = createInterface({ input: source, crlfDelay: Infinity });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (!await write(res, `{"ok":true,"meta":${JSON.stringify(meta)},"events":[`)) return;
    let first = true;
    for await (const line of lines) {
      if (gone) return;
      if (!line) continue;
      if (!await write(res, `${first ? '' : ','}${line}`)) return;
      first = false;
    }
    if (!gone && !res.destroyed) res.end(']}');
  } finally {
    res.off('close', abort); req.off('aborted', abort); lines?.close(); raw.destroy(); source.destroy();
  }
}

function validCaptions(value) {
  if (!Array.isArray(value) || value.length > MAX_CAPTIONS) return null;
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !Number.isFinite(item.at) || item.at < 0 || typeof item.text !== 'string') return null;
    const text = item.text.trim();
    if (!text || text.length > 40) return null;
    out.push({ at: Number(item.at.toFixed(3)), text, ...(Number.isFinite(item.until) && item.until > item.at ? { until: Number(item.until.toFixed(3)) } : {}),
      ...(typeof item.key === 'string' ? { key: item.key.slice(0, 80) } : {}) });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function createAssaultRecordingHttp({ directory }) {
  if (!path.isAbsolute(directory)) throw new Error('Recording directory must be absolute');
  const root = path.resolve(directory);
  const locks = new Map();
  const dirOf = (id) => path.join(root, id);
  const metaFile = (id) => path.join(dirOf(id), 'meta.json');
  const rawEvents = (id) => path.join(dirOf(id), 'events.jsonl');
  const gzEvents = (id) => path.join(dirOf(id), 'events.jsonl.gz');
  const segmentFile = (id, index) => path.join(dirOf(id), index === 1 ? 'canvas.webm' : `canvas-${index}.webm`);
  async function exclusive(id, task) {
    const previous = locks.get(id) || Promise.resolve(); const current = previous.catch(() => {}).then(task); locks.set(id, current);
    try { return await current; } finally { if (locks.get(id) === current) locks.delete(id); }
  }
  const loadMeta = async (id) => JSON.parse(await readFile(metaFile(id), 'utf8'));
  async function saveMeta(id, meta) {
    const pending = `${metaFile(id)}.${randomUUID()}.pending`;
    await writeFile(pending, JSON.stringify(meta), { flag: 'wx' }); await rename(pending, metaFile(id));
  }
  async function compressEvents(id) {
    const source = rawEvents(id); const target = gzEvents(id); const pending = `${target}.pending`;
    try { await stat(source); } catch { return 0; }
    await pipeline(createReadStream(source), createGzip({ level: 9 }), createWriteStream(pending));
    await rename(pending, target); await unlink(source);
    return (await stat(target)).size;
  }

  return async function handle(req, res, pathname) {
    if (pathname !== RECORDINGS_PREFIX && !pathname.startsWith(`${RECORDINGS_PREFIX}/`)) return false;
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { ok: false, error: 'ORIGIN' }), true;
      const relative = pathname.slice(RECORDINGS_PREFIX.length).replace(/^\//, '');

      const commentsMatch = relative.match(/^([0-9a-f-]{36})\/comments(?:\/([^/]+))?$/i);
      if (commentsMatch && UUID.test(commentsMatch[1])) {
        return await handleRecordingComments({ req, res, id: commentsMatch[1], commentId: commentsMatch[2] || null, directory: root, exclusive, loadMeta, json });
      }
      if (relative === 'start' && req.method === 'POST') {
        const body = await readBody(req);
        const runId = typeof body.runId === 'string' && UUID.test(body.runId) ? body.runId : null;
        if ((body.runId && !runId) || (body.recordingId && !UUID.test(body.recordingId))) return json(res, 422, { ok: false, error: 'INVALID_ID' }), true;
        const id = body.recordingId || randomUUID();
        let nextSeq = 1; let nextMediaSeq = 1; let endedAt = null;
        await exclusive(id, async () => {
          let meta;
          try { meta = await loadMeta(id); } catch (e) { if (e.code !== 'ENOENT') throw e; }
          if (meta) { nextSeq = meta.nextSeq; nextMediaSeq = meta.nextMediaSeq || 1; endedAt = meta.endedAt; }
          if (!meta) {
            await mkdir(dirOf(id), { recursive: true });
            meta = { id, mode: 'assault', runId, startedAt: new Date().toISOString(), endedAt: null, viewport: body.viewport || null, nextSeq: 1 };
            await saveMeta(id, meta); await writeFile(rawEvents(id), '', { flag: 'wx' });
          } else if (!meta.endedAt) await saveMeta(id, { ...meta, resumedAt: new Date().toISOString() });
        });
        return json(res, 200, { ok: true, id, nextSeq, nextMediaSeq, endedAt }), true;
      }

      const mediaMatch = relative.match(/^([0-9a-f-]{36})\/media(?:\/(playback|\d+))?(?:\/(\d+))?$/i);
      if (mediaMatch && UUID.test(mediaMatch[1])) {
        const id = mediaMatch[1];
        if (mediaMatch[2] && /^\d+$/.test(mediaMatch[2]) && req.method === 'POST') {
          const seq = Number(mediaMatch[2]); const startedAt = Number(req.headers['x-media-started-at']); const timeMs = Number(req.headers['x-media-time-ms']);
          if (!Number.isSafeInteger(seq) || seq < 1 || !Number.isFinite(startedAt) || !Number.isFinite(timeMs) || timeMs < 0) return json(res, 422, { ok: false, error: 'INVALID_MEDIA_CHUNK' }), true;
          const chunk = await readMediaChunk(req); if (!chunk.length) return json(res, 422, { ok: false, error: 'EMPTY_MEDIA_CHUNK' }), true;
          const result = await exclusive(id, async () => {
            const meta = await loadMeta(id); if (meta.endedAt) return { error: 'ENDED' };
            const next = Number(meta.nextMediaSeq) || 1;
            if (seq < next) return { ack: next - 1 };
            if (seq > next) return { error: 'OUT_OF_ORDER', ack: next - 1 };
            const mime = String(req.headers['x-media-mime-type'] || 'video/webm').slice(0, 100);
            if (!mime.startsWith('video/webm')) return { error: 'INVALID_MEDIA_TYPE' };
            const segmentStartedAt = new Date(startedAt).toISOString();
            const segments = structuredClone(meta.mediaSegments || []);
            let segment = segments.at(-1);
            if (!segment || segment.startedAt !== segmentStartedAt) { segment = { index: segments.length + 1, startedAt: segmentStartedAt, bytes: 0, lastTimeMs: 0 }; segments.push(segment); }
            await appendFile(segmentFile(id, segment.index), chunk); segment.bytes += chunk.length; segment.lastTimeMs = timeMs;
            await saveMeta(id, { ...meta, nextMediaSeq: next + 1, mediaStartedAt: meta.mediaStartedAt || segmentStartedAt, mediaMimeType: mime,
              mediaBytes: (Number(meta.mediaBytes) || 0) + chunk.length, mediaChunks: (Number(meta.mediaChunks) || 0) + 1, mediaSegments: segments,
              mediaLastTimeMs: Date.parse(segmentStartedAt) - Date.parse(meta.mediaStartedAt || segmentStartedAt) + timeMs });
            return { ack: next };
          });
          return json(res, result.error ? 409 : 200, { ok: !result.error, ...result }), true;
        }
        if (mediaMatch[2] === 'playback' && req.method === 'GET') {
          const meta = await loadMeta(id);
          const index = Number(mediaMatch[3] || 1);
          if (!meta.mediaSegments?.some((segment) => segment.index === index)) return json(res, 404, { ok: false, error: 'MEDIA_NOT_FOUND' }), true;
          const file = segmentFile(id, index); const info = await stat(file); const range = req.headers.range;
          const match = typeof range === 'string' ? range.match(/^bytes=(\d*)-(\d*)$/) : null;
          if (range && !match) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return true; }
          let start = 0; let end = info.size - 1;
          if (match) { start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2])); end = match[2] && match[1] ? Number(match[2]) : info.size - 1; }
          if (start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return true; }
          end = Math.min(end, info.size - 1);
          res.writeHead(match ? 206 : 200, { 'Content-Type': 'video/webm', 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
            ...(match ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
          const source = createReadStream(file, { start, end });
          res.once('close', () => source.destroy());
          source.once('error', () => { if (!res.destroyed) res.destroy(); });
          source.pipe(res);
          return true;
        }
      }

      const captionsMatch = relative.match(/^([0-9a-f-]{36})\/captions$/i);
      if (captionsMatch && UUID.test(captionsMatch[1])) {
        const id = captionsMatch[1]; const file = path.join(dirOf(id), 'captions.json');
        await loadMeta(id);
        if (req.method === 'GET') {
          let items = [];
          try { items = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
          return json(res, 200, { ok: true, recordingId: id, items }), true;
        }
        if (req.method === 'PUT') {
          const body = await readBody(req, 512 * 1024);
          const items = validCaptions(body.items);
          if (!items) return json(res, 422, { ok: false, error: 'INVALID_CAPTIONS' }), true;
          await exclusive(id, async () => {
            const pending = `${file}.${randomUUID()}.pending`;
            await writeFile(pending, JSON.stringify(items), { flag: 'wx' }); await rename(pending, file);
          });
          return json(res, 200, { ok: true, recordingId: id, total: items.length }), true;
        }
        return json(res, 405, { ok: false, error: 'METHOD' }), true;
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
            await appendFile(rawEvents(id), `${ordered.map((event) => JSON.stringify({ seq: event.seq, ts: event.ts, kind: event.kind, p: event.p })).join('\n')}\n`);
            await saveMeta(id, { ...meta, nextSeq: next });
          }
          return { ack: next - 1 };
        });
        return json(res, ack.error ? 409 : 200, { ok: !ack.error, ...ack }), true;
      }
      if (action === 'stop' && req.method === 'POST') {
        const info = await readBody(req);
        const stoppedAt = Number(info.mediaCaptureStoppedAt);
        const meta = await exclusive(id, async () => {
          const current = await loadMeta(id);
          if (current.endedAt) return current;
          const done = { ...current, endedAt: new Date().toISOString(),
            ...(Number.isSafeInteger(stoppedAt) && stoppedAt > 0 && stoppedAt <= Date.now() + 30000
              ? { mediaCaptureStoppedAt: new Date(stoppedAt).toISOString(), mediaCaptureLastTimeMs: Math.max(0, Number(info.mediaCaptureLastTimeMs) || 0), mediaCaptureFinalSeq: Number(info.mediaCaptureFinalSeq) || 0 } : {}) };
          const gzBytes = await compressEvents(id);
          if (gzBytes) done.eventsGzBytes = gzBytes;
          await saveMeta(id, done); return done;
        });
        return json(res, 200, { ok: true, endedAt: meta.endedAt, mediaPlaybackReady: !!meta.mediaBytes }), true;
      }
      if (action === 'read' && req.method === 'GET') {
        const meta = await loadMeta(id);
        if (new URL(req.url, 'http://localhost').searchParams.get('meta') === '1') return json(res, 200, { ok: true, meta }), true;
        let gz = true;
        try { await stat(gzEvents(id)); } catch { gz = false; }
        await streamEvents(req, res, gz ? gzEvents(id) : rawEvents(id), gz, meta);
        return true;
      }
      return json(res, 405, { ok: false, error: 'METHOD' }), true;
    } catch (error) {
      if (res.headersSent) { if (!res.destroyed) res.destroy(error); return true; }
      if (req.aborted || res.destroyed) return true;
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      return json(res, status, { ok: false, error: error.status ? error.message : status === 404 ? 'NOT_FOUND' : 'RECORDING_FAILED' }), true;
    }
  };
}
