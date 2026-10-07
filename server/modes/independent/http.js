import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { getCatalog } from './catalog.js';
import { createSession, applyAction, viewSession, validateSession } from './session.js';
import { independentDisplayCatalog, independentSessionView } from './display.js';
export { independentDisplayCatalog } from './display.js';

const PREFIX = '/independent/api/';
/** The hand-written player texts (data/independent-game-text.json); the design texts stay the rules' source. */
const GAME_TEXT_OVERRIDE = process.env.SP_INDEPENDENT_GAME_TEXT_PATH
  ? JSON.parse(readFileSync(path.resolve(process.env.SP_INDEPENDENT_GAME_TEXT_PATH), 'utf8'))
  : null;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ACTION_BODY = 64 * 1024;
const MAX_CHECKPOINT_BODY = 2 * 1024 * 1024;

// The rules validator predates public untrusted snapshots and assumes nested arrays contain records.
// Keep its rule semantics intact while turning malformed external JSON shapes into a normal 422.
function validateExternalSession(state) {
  try { return validateSession(state); }
  catch { return ['BAD_SHAPE']; }
}

function safeCheckpointChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.getPrototypeOf(changes) !== Object.prototype) return false;
  return Object.keys(changes).every((key) => key !== '__proto__' && key !== 'prototype' && key !== 'constructor');
}

function reply(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}
async function bodyOf(req, maxBody = MAX_ACTION_BODY) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes <= maxBody) chunks.push(chunk);
  }
  if (bytes > maxBody) throw Object.assign(new Error('请求过大'), { status: 413, code: 'BODY_LIMIT' });
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求格式无效'), { status: 400, code: 'BAD_JSON' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('请求格式无效'), { status: 400, code: 'BAD_JSON' });
  return body;
}

export function createIndependentHttp({ data, directory }) {
  let catalog, display;
  const locks = new Map();
  const definitions = () => {
    if (!catalog) { catalog = getCatalog(data); display = independentDisplayCatalog(data, catalog, GAME_TEXT_OVERRIDE || data['independent-game-text']); }
    return { data, catalog };
  };
  const file = (id) => path.join(directory, `${id}.json`);
  // one gzip file per fought round, next to the session; replays never enter the session state itself
  const replayFile = (id, round) => path.join(directory, `${id}.replay-r${round}.json.gz`);
  async function saveReplay(id, replay) {
    await mkdir(directory, { recursive: true });
    const pending = path.join(directory, `${id}.${randomUUID()}.pending`);
    await writeFile(pending, gzipSync(JSON.stringify(replay)), { flag: 'wx' });
    await rename(pending, replayFile(id, replay.round));
  }
  async function sendReplay(req, res, id, round) {
    let body;
    try { body = await readFile(replayFile(id, round)); }
    catch (error) {
      if (error.code === 'ENOENT') { reply(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '这一轮没有战斗记录' } }); return; }
      throw error;
    }
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (!gzip) body = gunzipSync(body);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=3600', Vary: 'Accept-Encoding',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  async function load(id) {
    try {
      const state = JSON.parse(await readFile(file(id), 'utf8'));
      const errors = validateExternalSession(state);
      if (errors.length) throw new Error(`Invalid persisted independent session: ${errors.join(',')}`);
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error('这一局不存在或已过期'), { status: 404, code: 'NOT_FOUND' });
      throw error;
    }
  }
  async function save(id, state) {
    await mkdir(directory, { recursive: true });
    const pending = path.join(directory, `${id}.${randomUUID()}.pending`);
    await writeFile(pending, JSON.stringify(state), { flag: 'wx' });
    await rename(pending, file(id));
  }
  // withCatalog false: the page fetched GET catalog once and only needs the state (body.catalog === false / ?catalog=0)
  function packet(id, state, events = [], withCatalog = true) {
    const thin = independentSessionView(state, { ...definitions(), display, viewSession });
    return withCatalog ? { ok: true, id, state: thin, catalog: display, events } : { ok: true, id, state: thin, events };
  }
  async function exclusive(id, task) {
    const previous = locks.get(id) || Promise.resolve();
    const result = previous.catch(() => {}).then(task);
    locks.set(id, result);
    try { return await result; }
    finally { if (locks.get(id) === result) locks.delete(id); }
  }
  return async function handle(req, res, pathname) {
    if (!pathname.startsWith(PREFIX)) return false;
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
        reply(res, 403, { ok: false, error: { code: 'ORIGIN', message: '请在游戏页面进行操作' } }); return true;
      }
      const relative = pathname.slice(PREFIX.length);
      if (relative === 'catalog' && req.method === 'GET') {
        definitions(); reply(res, 200, { ok: true, catalog: display }); return true;
      }
      if (relative === 'sessions' && req.method === 'POST') {
        const body = await bodyOf(req, MAX_CHECKPOINT_BODY);
        if (body.rawState !== undefined) {
          const errors = validateExternalSession(body.rawState);
          if (errors.length || body.rawState.revision !== 0) { reply(res, 422, { ok: false, error: { code: 'INVALID_SESSION', message: '对局存档无效', details: errors.length ? errors : ['revision'] } }); return true; }
          const id = randomUUID();
          await save(id, body.rawState);
          reply(res, 201, { ok: true, id, rawState: body.rawState });
          return true;
        }
        const state = createSession({ seed: body.seed, difficulty: body.difficulty, roundLimit: body.roundLimit, growthMode: body.growthMode, ...definitions() });
        const id = randomUUID(); await save(id, state); reply(res, 201, packet(id, state)); return true;
      }
      const parts = relative.split('/');
      const replayRoute = parts.length === 4 && parts[2] === 'replays' && /^[1-9][0-9]?$/.test(parts[3]);
      const checkpointRoute = parts.length === 3 && parts[2] === 'checkpoint';
      if (parts[0] !== 'sessions' || !SESSION_ID.test(parts[1] || '') || parts.length > 4 || (parts.length === 3 && parts[2] !== 'actions' && !checkpointRoute) || (parts.length === 4 && !replayRoute)) {
        reply(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '这一局不存在或已过期' } }); return true;
      }
      const id = parts[1];
      if (parts.length === 2 && req.method === 'GET') {
        const state = await load(id);
        const raw = /[?&]raw=1(&|$)/.test(req.url || '');
        reply(res, 200, raw ? { ok: true, id, rawState: state } : packet(id, state, [], !/[?&]catalog=0(&|$)/.test(req.url || '')));
        return true;
      }
      if (checkpointRoute && req.method === 'POST') {
        const body = await bodyOf(req, MAX_CHECKPOINT_BODY);
        await exclusive(id, async () => {
          const current = await load(id);
          if (body.expectedRevision !== current.revision) {
            reply(res, 409, { ok: false, error: { code: 'REVISION', message: '对局已更新，请重试当前操作' }, rawState: current });
            return;
          }
          const delta = body.changes !== undefined;
          if (delta && !safeCheckpointChanges(body.changes)) {
            reply(res, 422, { ok: false, error: { code: 'INVALID_SESSION', message: '对局存档无效' } });
            return;
          }
          if (!delta && (!body.state || typeof body.state !== 'object' || Array.isArray(body.state))) {
            reply(res, 422, { ok: false, error: { code: 'INVALID_SESSION', message: '对局存档无效' } });
            return;
          }
          const nextState = delta ? { ...current, ...body.changes } : body.state;
          const errors = validateExternalSession(nextState);
          if (errors.length || nextState.revision !== current.revision + 1) {
            reply(res, 422, { ok: false, error: { code: 'INVALID_SESSION', message: '对局存档无效', details: errors.length ? errors : ['revision'] } });
            return;
          }
          await save(id, nextState);
          reply(res, 200, { ok: true, id, revision: nextState.revision });
        });
        return true;
      }
      if (replayRoute && (req.method === 'GET' || req.method === 'HEAD')) { await sendReplay(req, res, id, Number(parts[3])); return true; }
      if (parts.length === 3 && req.method === 'POST') {
        const body = await bodyOf(req);
        await exclusive(id, async () => {
          const state = await load(id);
          const withCatalog = body.catalog !== false;
          if (body.expectedRevision !== state.revision) { reply(res, 409, { ...packet(id, state, [], withCatalog), ok: false, error: { code: 'REVISION', message: '对局已更新，请重试当前操作' } }); return; }
          const result = applyAction(state, body.action, definitions());
          if (!result.ok) { reply(res, 422, { ...packet(id, state, [], withCatalog), ok: false, error: result.error }); return; }
          // the replay first: a saved state never points at a battle whose replay is missing
          if (result.replay) await saveReplay(id, result.replay);
          await save(id, result.state);
          reply(res, 200, packet(id, result.state, result.events, withCatalog));
        });
        return true;
      }
      reply(res, 405, { ok: false, error: { code: 'METHOD', message: '不支持此操作' } });
    } catch (error) {
      if (!error.status && !/^[A-Z][A-Z0-9_]*$/.test(error.message)) throw error;
      reply(res, error.status || 422, { ok: false, error: { code: error.code || error.message, message: error.status ? error.message : '无法开始新的一局' } });
    }
    return true;
  };
}
