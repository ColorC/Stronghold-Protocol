import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 2 * 1024 * 1024;
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size <= MAX_BODY) chunks.push(chunk); }
  if (size > MAX_BODY) throw Object.assign(new Error('BODY_LIMIT'), { status: 413 });
  let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('BAD_JSON'), { status: 400 }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('BAD_JSON'), { status: 400 });
  return value;
}

/** Server-side rrweb event store. Recording IDs are opaque UUIDs and never become session state. */
export function createRecordingHttp({ directory, sessionDirectory }) {
  if (!path.isAbsolute(directory) || !path.isAbsolute(sessionDirectory)) throw new Error('Recording and session directories must be absolute');
  const root = path.resolve(directory);
  const locks = new Map();
  const dirOf = (id) => path.join(root, id);
  const metaFile = (id) => path.join(dirOf(id), 'meta.json');
  const eventsFile = (id) => path.join(dirOf(id), 'events.jsonl');
  async function exclusive(id, task) {
    const previous = locks.get(id) || Promise.resolve(); const current = previous.catch(() => {}).then(task); locks.set(id, current);
    try { return await current; } finally { if (locks.get(id) === current) locks.delete(id); }
  }
  async function loadMeta(id) { return JSON.parse(await readFile(metaFile(id), 'utf8')); }
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
        let nextSeq = 1; let endedAt = null;
        await exclusive(id, async () => {
          let meta;
          try { meta = await loadMeta(id); } catch (e) { if (e.code !== 'ENOENT') throw e; }
          if (meta && meta.sessionId !== body.sessionId) throw Object.assign(new Error('RECORDING_SESSION_MISMATCH'), { status: 409 });
          if (meta) { nextSeq = meta.nextSeq; endedAt = meta.endedAt; }
          if (!meta) {
            await mkdir(dirOf(id), { recursive: true });
            meta = { id, sessionId: body.sessionId, startedAt: new Date().toISOString(), endedAt: null, viewport: body.viewport || null, nextSeq: 1, captions: [] };
            await saveMeta(id, meta); await writeFile(eventsFile(id), '', { flag: 'wx' });
          } else if (!meta.endedAt) await saveMeta(id, { ...meta, resumedAt: new Date().toISOString() });
        });
        return json(res, 200, { ok: true, id, nextSeq, endedAt }), true;
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
        const meta = await exclusive(id, async () => { const current = await loadMeta(id); if (current.endedAt) return current; const done = { ...current, endedAt: new Date().toISOString() }; await saveMeta(id, done); return done; });
        return json(res, 200, { ok: true, endedAt: meta.endedAt }), true;
      }
      if (action === 'read' && req.method === 'GET') {
        const meta = await loadMeta(id); const lines = (await readFile(eventsFile(id), 'utf8')).split(/\r?\n/).filter(Boolean);
        return json(res, 200, { ok: true, meta, events: lines.map((line) => JSON.parse(line)) }), true;
      }
      return json(res, 405, { ok: false, error: 'METHOD' }), true;
    } catch (error) {
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      return json(res, status, { ok: false, error: error.status ? error.message : status === 404 ? 'NOT_FOUND' : 'RECORDING_FAILED' }), true;
    }
  };
}
