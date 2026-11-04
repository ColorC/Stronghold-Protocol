import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_COMMENT = 4000;
const MAX_SELECTOR = 600;
const MAX_FRAME_DEPTH = 6;

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

async function bodyJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes <= 256 * 1024) chunks.push(chunk);
  }
  if (bytes > 256 * 1024) throw problem(413, 'BODY_LIMIT');
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw problem(400, 'BAD_JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem(400, 'BAD_JSON');
  return value;
}

function optionalString(value, field, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw problem(400, `INVALID_${field.toUpperCase()}`);
  return value.slice(0, max);
}

function validateRect(value, field) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem(400, `INVALID_${field.toUpperCase()}`);
  const result = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(value[key])) throw problem(400, `INVALID_${field.toUpperCase()}`);
    result[key] = value[key];
  }
  return result;
}

function validateAnchor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem(400, 'INVALID_ANCHOR');
  if (typeof value.time_sec !== 'number' || !Number.isFinite(value.time_sec) || value.time_sec < 0) throw problem(400, 'INVALID_TIME');
  if (typeof value.selector !== 'string' || !value.selector.trim() || value.selector.trim().length > MAX_SELECTOR) throw problem(400, 'INVALID_SELECTOR');
  const framePath = value.frame_path === undefined ? [] : value.frame_path;
  if (!Array.isArray(framePath) || framePath.length > MAX_FRAME_DEPTH || framePath.some((part) => typeof part !== 'string')) throw problem(400, 'INVALID_FRAME_PATH');
  let viewport = null;
  if (value.viewport !== undefined && value.viewport !== null) {
    if (!value.viewport || typeof value.viewport !== 'object' || Array.isArray(value.viewport)
      || !Number.isInteger(value.viewport.width) || !Number.isInteger(value.viewport.height)) throw problem(400, 'INVALID_VIEWPORT');
    viewport = { width: value.viewport.width, height: value.viewport.height };
  }
  const scaledTime = value.time_sec * 1000;
  const roundedTime = Number.isFinite(scaledTime) ? Math.round(scaledTime) / 1000 : value.time_sec;
  return {
    time_sec: roundedTime,
    selector: value.selector.trim(),
    frame_path: framePath.map((part) => part.slice(0, MAX_SELECTOR)),
    tag: optionalString(value.tag, 'tag', 40),
    text_excerpt: optionalString(value.text_excerpt, 'text_excerpt', 240),
    beat_id: optionalString(value.beat_id, 'beat_id', 40),
    rect: validateRect(value.rect, 'rect'),
    viewport,
  };
}

async function readComments(filename) {
  try {
    const value = JSON.parse(await readFile(filename, 'utf8'));
    if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) throw new Error('invalid comments store shape');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeComments(filename, items) {
  const pending = `${filename}.${randomUUID()}.pending`;
  await writeFile(pending, JSON.stringify(items), { flag: 'wx' });
  try { await rename(pending, filename); }
  catch (error) {
    await unlink(pending).catch(() => {});
    throw error;
  }
}

export async function handleRecordingComments({ req, res, id, commentId = null, directory, exclusive, loadMeta, json }) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return json(res, 405, { ok: false, error: 'METHOD' }), true;
  if ((req.method === 'GET' && commentId) || (req.method === 'POST' && commentId)
    || ((req.method === 'PATCH' || req.method === 'DELETE') && !commentId)) return json(res, 405, { ok: false, error: 'METHOD' }), true;
  const filename = path.join(directory, id, 'comments.json');
  const result = await exclusive(id, async () => {
    await loadMeta(id);
    const items = await readComments(filename);
    if (req.method === 'GET') {
      items.sort((a, b) => Number(a.anchor?.time_sec || 0) - Number(b.anchor?.time_sec || 0)
        || String(a.created_at || '').localeCompare(String(b.created_at || '')));
      return { status: 200, body: { recordingId: id, items, total: items.length, open: items.filter((item) => !item.resolved).length } };
    }
    if (req.method === 'POST') {
      const body = await bodyJson(req);
      const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
      if (!comment || comment.length > MAX_COMMENT) throw problem(400, comment ? 'COMMENT_TOO_LONG' : 'EMPTY_COMMENT');
      if (body.author !== undefined && body.author !== null && typeof body.author !== 'string') throw problem(400, 'INVALID_AUTHOR');
      const entry = {
        id: `vrc-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        anchor: validateAnchor(body.anchor),
        comment,
        author: (body.author || 'user').slice(0, 80),
        created_at: new Date().toISOString(),
        resolved: false,
      };
      await writeComments(filename, [...items, entry]);
      return { status: 201, body: entry };
    }
    const index = items.findIndex((item) => item.id === commentId);
    if (index < 0) throw problem(404, 'COMMENT_NOT_FOUND');
    if (req.method === 'PATCH') {
      const body = await bodyJson(req);
      const entry = { ...items[index] };
      if (Object.hasOwn(body, 'comment')) {
        if (typeof body.comment !== 'string' || !body.comment.trim()) throw problem(400, 'EMPTY_COMMENT');
        if (body.comment.trim().length > MAX_COMMENT) throw problem(400, 'COMMENT_TOO_LONG');
        entry.comment = body.comment.trim();
      }
      if (Object.hasOwn(body, 'resolved')) {
        if (typeof body.resolved !== 'boolean') throw problem(400, 'INVALID_RESOLVED');
        entry.resolved = body.resolved;
      }
      items[index] = entry;
      await writeComments(filename, items);
      return { status: 200, body: entry };
    }
    const remaining = items.filter((item) => item.id !== commentId);
    await writeComments(filename, remaining);
    return { status: 200, body: { ok: true, remaining: remaining.length } };
  });
  return json(res, result.status, result.body), true;
}
