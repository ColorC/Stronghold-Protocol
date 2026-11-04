import { randomInt, randomUUID } from 'node:crypto';
import { createRun, applyAction, viewRun } from '../../../shared/assault/run.js';
import { createAssaultStore, RUN_ID } from './store.js';
import { t, N_ } from '../../../shared/i18n.js';
import { createAssaultRecordingHttp } from './recordings.js';

export function projectAssaultBattleDto(state, current) {
  return { ok: true, runId: state.runId, revision: state.revision, battle: {
    battleId: current.battleId, seed: current.seed, encounterId: current.encounterId,
    waveId: current.waveId, nativeTemplateId: current.nativeTemplateId,
    input: { ...clone(current.input), derivedBuffInputs: clone(current.derivedBuffInputs ?? current.input?.derivedBuffInputs ?? []) },
    encounter: clone(current.encounter), field: clone(current.field), config: clone(current.config),
  } };
}

const PREFIX = '/api/assault/';
const MAX_BODY = 8 * 1024 * 1024;
const MAX_SMALL_BODY = 256 * 1024;
const BASE = Object.freeze({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const knownError = (error) => error && typeof error.code === 'string' ? error.code : null;
const messages = {
  BAD_JSON: N_('请求格式无效'), BODY_LIMIT: N_('请求内容过大'), INVALID_BODY: N_('请求内容无效'), INVALID_RUN: N_('存档内容无效'),
  INVALID_RUN_ID: N_('局标识无效'), INVALID_RUN_ROOT: N_('存档目录无效'), NOT_FOUND: N_('未找到这局游戏'), REVISION_CONFLICT: N_('游戏状态已更新，请刷新后重试'),
  OP_ID_CONFLICT: N_('操作编号已被用于另一组参数'), ORIGIN: N_('请在游戏页面中进行操作'), BATTLE_NOT_READY: N_('当前没有已准备的战斗'),
  INVALID_BATTLE: N_('战斗状态无效'), METHOD: N_('不支持此操作'), INTERNAL: N_('服务器暂时无法处理请求'),
  // Rules a player can run into while preparing (buy, place, refresh, events); without these the reply is the bare
  // 「请求无法完成」 and the player cannot tell what to change.
  INSUFFICIENT_GOLD: N_('资金不足'), POPULATION_FULL: N_('已达到部署上限'), INVALID_TILE: N_('无法部署在该位置'),
  NODE_REROLL_LIMIT: N_('本时段的节点重抽次数已用完'),
  TILE_OCCUPIED: N_('这一格已有干员'), BENCH_FULL: N_('整备区已满'), SOURCE_CAP: N_('这名干员已达到合成上限'),
  FORM_REQUIRES_REPOSITION: N_('新形态放不进这一格，请换一格或先放回整备区'), SUPPLY_CAPACITY: N_('补给已存满'),
  SHOP_REFRESH_LIMIT: N_('这家商店不能再刷新了'), SHOP_LOCKED: N_('这家商店还没开放'), RELIC_OWNED: N_('已经拥有这件收藏品'),
  NO_ENCHANTMENT_TARGET: N_('没有可以强化的干员'), NO_RELIC_TARGET: N_('没有可选的收藏品'),
  INVALID_PHASE: N_('现在不能进行这个操作'), NO_SHOP: N_('现在不能进行这个操作'), NO_EVENT: N_('现在不能进行这个操作'),
};
const statusFor = (code) => code === 'NOT_FOUND' ? 404 : code === 'BODY_LIMIT' ? 413 : code === 'METHOD' ? 405
  : code === 'REVISION_CONFLICT' || code === 'OP_ID_CONFLICT' ? 409 : code === 'INTERNAL' ? 500 : 422;

function respond(res, status, payload, extra = {}) {
  res.writeHead(status, { ...BASE, ...extra });
  res.end(JSON.stringify(payload));
}

async function bodyOf(req, max = MAX_BODY) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += part.length;
    if (bytes <= max) chunks.push(part);
  }
  if (bytes > max) throw Object.assign(new Error('body'), { code: 'BODY_LIMIT' });
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('json'), { code: 'BAD_JSON' }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('body'), { code: 'INVALID_BODY' });
  return value;
}

function routeFor(pathname) {
  if (pathname === `${PREFIX}catalog`) return { kind: 'catalog' };
  if (pathname === `${PREFIX}runs`) return { kind: 'runs' };
  if (pathname === `${PREFIX}runs/import`) return { kind: 'import' };
  const match = pathname.match(new RegExp(`^${PREFIX.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}runs/([^/]+)(?:/(actions|settle|battle|export))?$`));
  if (!match || !RUN_ID.test(match[1])) return null;
  return { kind: match[2] ?? 'run', runId: match[1] };
}

function contextFor(context) {
  const catalog = context.catalog ?? context.runtime;
  const design = context.design;
  if (!catalog || !design) throw Object.assign(new Error('context'), { code: 'INVALID_CONTEXT' });
  return { ...context, catalog, design };
}

function catalogPacket(context) {
  const catalog = context.catalog ?? context.runtime;
  return {
    runtime: clone(context.runtime ?? catalog),
    ...(context.browserNativeData ? { nativeData: clone(context.browserNativeData) } : {}),
    design: {
      system: clone(context.design.system),
      events: clone(context.design.events),
      collectibles: clone(context.design.collectibles),
      encounters: clone(context.design.encounters),
    },
    assetManifest: clone(context.assetManifest ?? context.assets ?? null),
    publicText: clone(context.publicText ?? context.publicTextManifest ?? null),
  };
}

function publicRun(state, context) { return { runId: state.runId, state: context.view ? context.view(state) : viewRun(state, context) }; }

function invalidActionBody(body, expectedType = null) {
  const allowed = expectedType === 'settleBattle'
    ? new Set(['type', 'battleId', 'opId', 'expectedRevision'])
    : expectedType === 'chooseSkill'
      ? new Set(['type', 'skillId', 'opId', 'expectedRevision'])
      : expectedType === 'chooseUpgrade'
        ? new Set(['type', 'uid', 'opId', 'expectedRevision'])
        : expectedType === 'skipUpgradeReward'
          ? new Set(['type', 'opId', 'expectedRevision'])
      : new Set(['opId', 'expectedRevision', 'type', 'nodeId', 'slotId', 'uid', 'row', 'col', 'dir', 'charId', 'moduleId', 'index', 'summonId', 'tokenId', 'slot', 'choiceId', 'free_leave_choice_id', 'targetUid', 'filterTag', 'relicId', 'battleId']);
  if (expectedType && body.type !== undefined && body.type !== expectedType) return true;
  if (expectedType === 'chooseSkill' && (typeof body.skillId !== 'string' || !body.skillId.trim())) return true;
  if (expectedType === 'chooseUpgrade' && (typeof body.uid !== 'string' || !body.uid.trim())) return true;
  return Object.keys(body).some((key) => !allowed.has(key));
}

function httpError(error) {
  const code = knownError(error) ?? 'INTERNAL';
  return { status: statusFor(code), body: { ok: false, error: { code, message: messages[code] ?? (code === 'INVALID_CONTEXT' ? t('服务器配置无效') : t('请求无法完成')) } } };
}

export function createAssaultHttp({ context, runRoot, recordingRoot = null }) {
  const rules = contextFor(context);
  const recordings = recordingRoot ? createAssaultRecordingHttp({ directory: recordingRoot }) : null;
  const store = createAssaultStore({ root: runRoot, context: rules });
  return async function handle(req, res, url) {
    const raw = typeof url === 'string' ? url : url?.pathname;
    if (typeof raw !== 'string') return false;
    let pathname;
    try { pathname = new URL(raw, 'http://assault.invalid').pathname; } catch { return false; }
    if (!pathname.startsWith(PREFIX)) return false;
    if (recordings && await recordings(req, res, pathname)) return true;
    const route = routeFor(pathname);
    if (!route) return false;
    try {
      if (route.kind === 'catalog') {
        if (req.method !== 'GET') { respond(res, 405, { ok: false, error: { code: 'METHOD', message: messages.METHOD } }); return true; }
        respond(res, 200, { ok: true, ...catalogPacket(rules) }); return true;
      }
      if (route.kind === 'runs') {
        if (req.method !== 'POST') { respond(res, 405, { ok: false, error: { code: 'METHOD', message: messages.METHOD } }); return true; }
        const body = await bodyOf(req, MAX_SMALL_BODY);
        if (Object.keys(body).some((key) => !['directorId', 'seed'].includes(key))) throw Object.assign(new Error('body'), { code: 'INVALID_BODY' });
        if (typeof body.directorId !== 'string' || (body.seed !== undefined && (!Number.isInteger(body.seed) || body.seed < 0 || body.seed > 0xffffffff))) throw Object.assign(new Error('body'), { code: 'INVALID_BODY' });
        const runId = randomUUID();
        const state = createRun({ runId, seed: body.seed ?? randomInt(0x100000000), directorId: body.directorId }, rules);
        await store.create(state);
        respond(res, 201, { ok: true, ...publicRun(state, rules) }); return true;
      }
      if (route.kind === 'import') {
        if (req.method !== 'POST') { respond(res, 405, { ok: false, error: { code: 'METHOD', message: messages.METHOD } }); return true; }
        const body = await bodyOf(req, MAX_BODY);
        if (Object.keys(body).some((key) => !['run', 'state', 'schema'].includes(key))) throw Object.assign(new Error('body'), { code: 'INVALID_BODY' });
        const source = body.run ?? body.state ?? (body.schema === 'assault-run/v1' ? body : null);
        if (!source || typeof source !== 'object' || Array.isArray(source)) throw Object.assign(new Error('body'), { code: 'INVALID_BODY' });
        const runId = randomUUID();
        const restored = clone(source);
        restored.runId = runId;
        await store.importRun(restored, runId);
        const state = await store.load(runId);
        respond(res, 201, { ok: true, ...publicRun(state, rules) }); return true;
      }
      if (route.kind === 'run' && req.method === 'GET') {
        const state = await store.load(route.runId);
        respond(res, 200, { ok: true, ...publicRun(state, rules) }); return true;
      }
      if (route.kind === 'export' && req.method === 'GET') {
        const state = await store.load(route.runId);
        const data = Buffer.from(JSON.stringify(state));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${state.runId}.json"`, 'Content-Length': data.length });
        res.end(data); return true;
      }
      if (route.kind === 'battle' && req.method === 'GET') {
        const state = await store.load(route.runId);
        if (state.phase !== 'battle' || !state.currentBattle) throw Object.assign(new Error('battle'), { code: 'BATTLE_NOT_READY' });
        respond(res, 200, projectAssaultBattleDto(state, state.currentBattle)); return true;
      }
      if ((route.kind === 'actions' || route.kind === 'settle') && req.method === 'POST') {
        const body = await bodyOf(req, MAX_SMALL_BODY);
        const settle = route.kind === 'settle';
        if (settle && (Object.keys(body).some((key) => !['battleId', 'opId', 'expectedRevision'].includes(key)) || typeof body.battleId !== 'string')) throw Object.assign(new Error('body'), { code: 'INVALID_BODY' });
        if (!settle && invalidActionBody(body, ['settleBattle', 'chooseSkill', 'chooseUpgrade', 'skipUpgradeReward'].includes(body.type) ? body.type : null)) throw Object.assign(new Error('body'), { code: 'INVALID_BODY' });
        if (typeof body.opId !== 'string' || !body.opId.trim() || !Number.isInteger(body.expectedRevision)) throw Object.assign(new Error('body'), { code: 'INVALID_BODY' });
        const action = settle ? { type: 'settleBattle', battleId: body.battleId, opId: body.opId, expectedRevision: body.expectedRevision } : body;
        const result = await store.withRun(route.runId, async (current) => {
          try {
            const applied = applyAction(current, action, rules);
            if (applied.state !== current) await store.save(applied.state);
            return applied;
          } catch (error) {
            error.current = current;
            throw error;
          }
        });
        const state = result.state ?? await store.load(route.runId);
        respond(res, 200, { ok: true, result: clone(result.result), ...publicRun(state, rules) }); return true;
      }
      respond(res, 405, { ok: false, error: { code: 'METHOD', message: messages.METHOD } }); return true;
    } catch (error) {
      const failure = httpError(error);
      if (error?.current && (failure.body.error.code === 'REVISION_CONFLICT' || failure.body.error.code === 'OP_ID_CONFLICT')) failure.body.run = publicRun(error.current, rules);
      respond(res, failure.status, failure.body); return true;
    }
  };
}
