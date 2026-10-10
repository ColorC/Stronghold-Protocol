import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const missing = (res, json, error = 'RENDERED_NOT_FOUND') => json(res, 404, { ok: false, error });

function positiveFinite(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function nonnegativeFinite(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }

function normalizeManifest(value, id) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
    || value.recordingId !== id || !(value.sessionId === null || typeof value.sessionId === 'string')
    || typeof value.sourceRevision !== 'string' || !value.sourceRevision
    || !value.viewport || !Number.isSafeInteger(value.viewport.width) || value.viewport.width < 1
    || !Number.isSafeInteger(value.viewport.height) || value.viewport.height < 1
    || !positiveFinite(value.fps) || !Number.isSafeInteger(value.videoBitsPerSecond) || value.videoBitsPerSecond < 1
    || !Array.isArray(value.clips)) return null;
  const keys = new Set();
  const clips = [];
  for (const clip of value.clips) {
    const prep = clip?.kind === 'prep';
    const index = prep ? clip.index : clip?.round;
    const key = prep ? 'prep-' + index : String(index);
    if (!clip || !Number.isSafeInteger(index) || index < 1 || index > 999999999 || keys.has(key)
      || !nonnegativeFinite(clip.startSecond) || !nonnegativeFinite(clip.endSecond) || clip.endSecond < clip.startSecond
      || !nonnegativeFinite(clip.mediaDuration) || typeof clip.file !== 'string') return null;
    keys.add(key);
    clips.push({ ...(prep ? { kind: 'prep', index, round: null } : { round: index }),
      startSecond: clip.startSecond, endSecond: clip.endSecond, mediaDuration: clip.mediaDuration,
      file: prep ? 'prep-' + index + '.webm' : 'battle-' + index + '.webm' });
  }
  let movie;
  if (value.movie !== undefined) {
    if (!value.movie || typeof value.movie !== 'object' || !positiveFinite(value.movie.mediaDuration)) return null;
    movie = { file: 'showcase.mp4', mediaDuration: value.movie.mediaDuration };
  }
  return { schemaVersion: 1, recordingId: id, sessionId: value.sessionId, sourceRevision: value.sourceRevision,
    viewport: { width: value.viewport.width, height: value.viewport.height }, fps: value.fps,
    videoBitsPerSecond: value.videoBitsPerSecond, clips, ...(movie ? { movie } : {}) };
}

async function readPublishedManifest({ id, recordingDirectory, renderDirectory, loadMeta }) {
  await loadMeta(id);
  const base = path.resolve(renderDirectory, id);
  const root = await realpath(renderDirectory);
  const realBase = await realpath(base);
  if (realBase !== path.join(root, id)) throw Object.assign(new Error('RENDERED_PATH_INVALID'), { status: 500 });
  const info = await lstat(base);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Object.assign(new Error('RENDERED_PATH_INVALID'), { status: 500 });
  const manifestPath = path.join(base, 'manifest.json');
  try {
    const manifestInfo = await lstat(manifestPath);
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw Object.assign(new Error('RENDERED_MANIFEST_INVALID'), { status: 500 });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let parsed;
  try { parsed = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw Object.assign(new Error('RENDERED_MANIFEST_INVALID'), { status: 500 });
  }
  const manifest = normalizeManifest(parsed, id);
  if (!manifest) throw Object.assign(new Error('RENDERED_MANIFEST_INVALID'), { status: 500 });
  return { manifest, base };
}

export async function handleRenderedRecording({ req, res, id, roundText = null, renderDirectory, recordingDirectory, loadMeta, json, pipeFileReadStream }) {
  if (!UUID.test(id)) return missing(res, json);
  if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return json(res, 405, { ok: false, error: 'METHOD' }); }
  if (!path.isAbsolute(renderDirectory) || !path.isAbsolute(recordingDirectory)) throw new Error('Recording render directories must be absolute');
  if (roundText != null && roundText !== 'showcase' && !/^(?:prep-)?[1-9]\d{0,8}$/.test(roundText)) return json(res, 400, { ok: false, error: 'INVALID_ROUND' });

  let published;
  try { published = await readPublishedManifest({ id, recordingDirectory, renderDirectory, loadMeta }); }
  catch (error) {
    if (error.code === 'ENOENT') return missing(res, json);
    return json(res, error.status || 500, { ok: false, error: error.status ? error.message : 'RENDERED_FAILED' });
  }
  if (roundText == null) return json(res, 200, { ok: true, manifest: published.manifest });

  const movie = roundText === 'showcase';
  const prep = /^prep-/.test(roundText);
  const index = Number(prep ? roundText.slice(5) : roundText);
  const clip = movie ? published.manifest.movie : published.manifest.clips.find(c => prep ? c.kind === 'prep' && c.index === index : c.kind !== 'prep' && c.round === index);
  if (!clip) return missing(res, json, 'RENDERED_CLIP_NOT_FOUND');
  const file = path.resolve(published.base, clip.file);
  if (!file.startsWith(published.base + path.sep)) return json(res, 400, { ok: false, error: 'INVALID_ROUND' });
  let info;
  try {
    info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) return missing(res, json, 'RENDERED_CLIP_NOT_FOUND');
    if (info.size < 1) return missing(res, json, 'RENDERED_CLIP_NOT_FOUND');
  } catch (error) {
    if (error.code === 'ENOENT') return missing(res, json, 'RENDERED_CLIP_NOT_FOUND');
    throw error;
  }

  const range = req.headers.range;
  const match = typeof range === 'string' ? range.match(/^bytes=(\d*)-(\d*)$/) : null;
  if (range && !match) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return true; }
  let start = 0; let end = info.size - 1;
  if (match) {
    if (match[1]) start = Number(match[1]);
    else { const suffix = Number(match[2]); if (!suffix) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return true; } start = Math.max(0, info.size - suffix); }
    if (match[1] && match[2]) end = Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return true;
    }
    end = Math.min(end, info.size - 1);
  }
  res.writeHead(match ? 206 : 200, { 'Content-Type': movie ? 'video/mp4' : 'video/webm', 'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', ...(match ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
  if (req.method === 'HEAD') res.end();
  else pipeFileReadStream(req, res, createReadStream(file, { start, end }));
  return true;
}
