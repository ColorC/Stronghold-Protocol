import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { getResonanceCatalog } from './catalog.js';
import { resonanceRulesVersion } from '../../../shared/resonance/openings.js';
import { getResonanceField, previewUnitStats, runResonanceBattle } from './battle.js';
import { applyAction, createSession, validateSession, viewSession } from './session.js';
import { resonanceDisplayCatalog, resonanceSessionDisplay } from './display.js';
import { renameWithTransientRetry } from '../independent/persistence.js';

const PREFIX = '/resonance/api/';
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 64 * 1024;
const CATALOG_CACHE_LIMIT = 12;

function reply(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function bodyOf(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('请求过大'), { status: 413, code: 'BODY_LIMIT' });
    chunks.push(chunk);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求格式无效'), { status: 400, code: 'BAD_JSON' }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('请求格式无效'), { status: 400, code: 'BAD_JSON' });
  return parsed;
}

function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    const protocol = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
    return origin.host === req.headers.host && origin.protocol === protocol;
  }
  catch { return false; }
}

function validSeed(seed) { return Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff; }

export function createResonanceHttp({ data, directory, battleRunner = runResonanceBattle, fieldResolver = getResonanceField, statsPreview = previewUnitStats,
  catalogProvider = getResonanceCatalog, recording = true } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('SP_RESONANCE_DIRECTORY must be an absolute runtime path');
  const catalogCache = new Map();
  const displayCache = new WeakMap();
  const locks = new Map();
  const liveMatches = new Set();
  const file = (id) => path.join(directory, `${id}.json`);
  const replayFile = (id, round) => path.join(directory, `${id}.replay-r${round}.json.gz`);

  function catalogFor(rulesVersion = 3, seed = 1, environmentId = null) {
    resonanceRulesVersion({rulesVersion});
    const key = `${rulesVersion}|${environmentId}|${seed}`;
    if (catalogCache.has(key)) {
      const cached = catalogCache.get(key); catalogCache.delete(key); catalogCache.set(key, cached); return cached;
    }
    const catalog = catalogProvider(data, { rulesVersion, environmentId, seed });
    catalogCache.set(key, catalog);
    while (catalogCache.size > CATALOG_CACHE_LIMIT) catalogCache.delete(catalogCache.keys().next().value);
    return catalog;
  }

  function displayFor(catalog) {
    if (displayCache.has(catalog)) return displayCache.get(catalog);
    const display = resonanceDisplayCatalog(catalog, data);
    displayCache.set(catalog, display);
    return display;
  }

  function catalogForIdentity(identity) {
    try { return catalogFor(resonanceRulesVersion(identity), identity.seed, identity.environmentId); }
    catch { throw Object.assign(new Error('这一局的规则存档内容无效'), { status: 500, code: 'CORRUPT_SESSION' }); }
  }

  async function atomicWrite(target, text) {
    await mkdir(directory, { recursive: true });
    const pending = `${target}.${randomUUID()}.pending`;
    try {
      await writeFile(pending, text, { flag: 'wx' });
      await renameWithTransientRetry(pending, target, { renameImpl: rename });
    } catch (error) {
      await rm(pending, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function saveSession(id, state) { await atomicWrite(file(id), JSON.stringify(state)); }
  async function saveReplay(id, replay) { await atomicWrite(replayFile(id, replay.round), gzipSync(JSON.stringify(replay))); }

  async function loadSession(id, catalog) {
    let state;
    try { state = JSON.parse(await readFile(file(id), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error('这一局不存在或已过期'), { status: 404, code: 'NOT_FOUND' });
      if (error instanceof SyntaxError) throw Object.assign(new Error('这一局的存档无法读取'), { status: 500, code: 'CORRUPT_SESSION' });
      throw error;
    }
    let validation;
    try { validation = validateSession(state, { catalog }); }
    catch { validation = { ok: false, errors: [{ code: 'BAD_SHAPE' }] }; }
    if (!validation.ok) throw Object.assign(new Error('这一局的存档内容无效'), { status: 500, code: 'CORRUPT_SESSION', details: validation.errors });
    return state;
  }

  async function loadOwnedSession(id) {
    const identityText = await readFile(file(id), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') throw Object.assign(new Error('这一局不存在或已过期'), { status: 404, code: 'NOT_FOUND' });
      throw error;
    });
    let identity;
    try { identity = JSON.parse(identityText); }
    catch { throw Object.assign(new Error('这一局的存档无法读取'), { status: 500, code: 'CORRUPT_SESSION' }); }
    const catalog = catalogForIdentity(identity);
    const state = await loadSession(id, catalog);
    return { state, catalog };
  }

  function statePacket(id, state, catalog, includeCatalog = false, events = []) {
    const unitStats=state.pieces.some(piece=>piece.row!==null)?statsPreview(state,{data,catalog}):{};
    const view = resonanceSessionDisplay(state, { data, catalog, viewSession,
      fieldResolver: (current) => fieldResolver(current, { data, catalog }),unitStats });
    return { ok: view.ok, id, state: view, events, ...(includeCatalog ? { catalog: displayFor(catalog) } : {}) };
  }

  async function exclusive(id, task) {
    const previous = locks.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    locks.set(id, current);
    try { return await current; }
    finally { if (locks.get(id) === current) locks.delete(id); }
  }

  async function replayResponse(res, id, round) {
    let compressed;
    try { compressed = await readFile(replayFile(id, round)); }
    catch (error) {
      if (error.code === 'ENOENT') { reply(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '这一轮没有战斗记录' } }); return; }
      throw error;
    }
    let replay;
    try { replay = JSON.parse(gunzipSync(compressed).toString('utf8')); }
    catch { throw Object.assign(new Error('这一轮的战斗记录无法读取'), { status: 500, code: 'CORRUPT_REPLAY' }); }
    reply(res, 200, { ok: true, replay });
  }

  async function handle(req, res, pathname) {
    if (!pathname.startsWith(PREFIX)) return false;
    try {
      if (!sameOrigin(req)) { reply(res, 403, { ok: false, error: { code: 'ORIGIN', message: '请在共鸣页面进行操作' } }); return true; }
      const relative = pathname.slice(PREFIX.length);
      if (relative === 'catalog' && req.method === 'GET') {
        const url = new URL(req.url, 'http://localhost');
        const seedValue = url.searchParams.has('seed') ? Number(url.searchParams.get('seed')) : 1;
        const seed = validSeed(seedValue) ? seedValue : 1;
        if (url.searchParams.has('environmentId') || url.searchParams.has('openingId')) {
          reply(res, 422, { ok:false, error:{code:'UNSUPPORTED_SESSION_INPUT',message:'开局效果由本局自动决定'} }); return true;
        }
        const catalog = catalogFor(3, seed);
        reply(res, 200, { ok: true, catalog: displayFor(catalog), activeOperatorIds: [...catalog.config.activeOperatorIds], seed });
        return true;
      }
      if (relative === 'sessions' && req.method === 'POST') {
        const body = await bodyOf(req);
        if (Object.keys(body).some((key) => !['seed','difficulty'].includes(key))) {
          reply(res, 422, { ok: false, error: { code: 'UNSUPPORTED_SESSION_INPUT', message: '开局请求只接受种子与难度' } }); return true;
        }
        const seed = body.seed ?? randomUUID().split('-').join('').slice(0,8).split('').reduce((value, char) => (value * 16 + parseInt(char,16)) >>> 0, 0);
        if (!validSeed(seed)) { reply(res, 422, { ok: false, error: { code: 'BAD_SEED', message: '种子必须是有效的非负整数' } }); return true; }
        const difficulty = String(body.difficulty || 'NORMAL').toUpperCase();
        if (!['FUNNY','NORMAL','HARD','ABYSS'].includes(difficulty)) { reply(res, 422, { ok: false, error: { code: 'BAD_DIFFICULTY', message: '请选择有效难度' } }); return true; }
        const catalog = catalogFor(3, seed);
        const created = createSession({ seed, difficulty, catalog, fieldResolver: (state) => fieldResolver(state, { data, catalog }) });
        if (!created.ok) { reply(res, 422, { ok: false, error: { code: created.error, message: '无法开始新的一局' } }); return true; }
        const id = randomUUID();
        await saveSession(id, created.state);
        reply(res, 201, statePacket(id, created.state, catalog, true, created.events));
        return true;
      }

      const parts = relative.split('/');
      const replayRoute = parts.length === 4 && parts[2] === 'replays' && /^[1-9][0-9]?$/.test(parts[3]);
      if (parts[0] !== 'sessions' || !SESSION_ID.test(parts[1] || '') || parts.length > 4
        || (parts.length === 3 && parts[2] !== 'actions') || (parts.length === 4 && !replayRoute)) {
        reply(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '这一局不存在或已过期' } }); return true;
      }
      const id = parts[1];
      if (parts.length === 2 && req.method === 'GET') {
        const url = new URL(req.url, 'http://localhost');
        const text = await readFile(file(id), 'utf8').catch((error) => {
          if (error.code === 'ENOENT') throw Object.assign(new Error('这一局不存在或已过期'), { status: 404, code: 'NOT_FOUND' });
          throw error;
        });
        let identity;
        try { identity = JSON.parse(text); } catch { throw Object.assign(new Error('这一局的存档无法读取'), { status: 500, code: 'CORRUPT_SESSION' }); }
        const catalog = catalogForIdentity(identity);
        const state = await loadSession(id, catalog);
        reply(res, 200, statePacket(id, state, catalog, url.searchParams.get('catalog') !== '0'));
        return true;
      }
      if (replayRoute && req.method === 'GET') {
        const stateText = await readFile(file(id), 'utf8').catch((error) => {
          if (error.code === 'ENOENT') throw Object.assign(new Error('这一局不存在或已过期'), { status: 404, code: 'NOT_FOUND' }); throw error;
        });
        let state; try { state = JSON.parse(stateText); } catch { throw Object.assign(new Error('这一局的存档无法读取'), { status: 500, code: 'CORRUPT_SESSION' }); }
        const catalog = catalogForIdentity(state);
        await loadSession(id, catalog);
        await replayResponse(res, id, Number(parts[3]));
        return true;
      }
      if (parts.length === 3 && req.method === 'POST') {
        const body = await bodyOf(req);
        if (!Number.isInteger(body.expectedRevision) || !body.action || typeof body.action !== 'object' || Array.isArray(body.action)) {
          reply(res, 400, { ok: false, error: { code: 'BAD_ACTION_REQUEST', message: '操作请求无效' } }); return true;
        }
        await exclusive(id, async () => {
          if (liveMatches.has(id)) {
            reply(res, 409, { ok: false, error: { code: 'NATIVE_MATCH_ACTIVE', message: '请在当前对局中继续操作' } }); return;
          }
          const first = await readFile(file(id), 'utf8').catch((error) => {
            if (error.code === 'ENOENT') throw Object.assign(new Error('这一局不存在或已过期'), { status: 404, code: 'NOT_FOUND' }); throw error;
          });
          let identity; try { identity = JSON.parse(first); } catch { throw Object.assign(new Error('这一局的存档无法读取'), { status: 500, code: 'CORRUPT_SESSION' }); }
          const catalog = catalogForIdentity(identity);
          const state = await loadSession(id, catalog);
          if (body.expectedRevision !== state.revision) {
            reply(res, 409, { ...statePacket(id, state, catalog, false), ok: false, error: { code: 'STALE_REVISION', message: '对局已在别处更新，请重试当前操作' } }); return;
          }
          const action = { ...body.action, expectedRevision: body.expectedRevision };
          const result = applyAction(state, action, { catalog, fieldResolver: (current) => fieldResolver(current, { data, catalog }),
            battleRunner: (current, options) => battleRunner(current, { ...options, data, catalog, recording }), recording });
          if (!result.ok) {
            reply(res, 422, { ...statePacket(id, state, catalog, false), ok: false, error: { code: result.error, message: '这项操作没有完成' } }); return;
          }
          if (result.replay) await saveReplay(id, result.replay);
          await saveSession(id, result.state);
          reply(res, 200, statePacket(id, result.state, catalog, false, result.events));
        });
        return true;
      }
      reply(res, 405, { ok: false, error: { code: 'METHOD', message: '不支持此操作' } });
    } catch (error) {
      if (res.headersSent || res.writableEnded) return true;
      const status = Number.isInteger(error.status) ? error.status : 500;
      reply(res, status, { ok: false, error: { code: error.code || 'RESONANCE_HTTP_ERROR', message: error.status ? error.message : '共鸣服务暂时无法完成请求', ...(error.details ? { details: error.details } : {}) } });
    }
    return true;
  }
  // WS and REST share this exact lock, validator, and persistence path. A live native
  // match owns writes while active; callers use this store rather than opening files.
  handle.store = Object.freeze({
    loadSession, saveSession, exclusive, catalogForIdentity, catalogFor,
    displayFor, statePacket, loadOwnedSession,
    activate(id) { liveMatches.add(id); },
    deactivate(id) { liveMatches.delete(id); },
    file,
  });
  return handle;
}
