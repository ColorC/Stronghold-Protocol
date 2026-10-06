import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { getCatalog } from './catalog.js';
import { traitSummary, TRAIT_WHEN } from './summary.js';
import { createSession, applyAction, viewSession, validateSession } from './session.js';
import { chessAvatarUrl } from '../../../public/js/ui/assetUrls.js';

const PREFIX = '/independent/api/';
/** The hand-written player texts (data/independent-game-text.json); the design texts stay the rules' source. */
const GAME_TEXT = JSON.parse(readFileSync(new URL('../../../data/independent-game-text.json', import.meta.url), 'utf8'));
/** The three prize draws (design 起步 / 成型 / 兑现) as the player meets them. */
const PRIZE_STAGE = { 起步: '起步', 成型: '成型', 兑现: '决胜' };
const baseChessId = (id) => String(id).replace(/_b$/, '_a');
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_BODY = 64 * 1024;
const BADGE_STATS = { attackFlat: '基础攻击力', attackPercent: '攻击力', maxLifeFlat: '基础最大生命值', maxLifePercent: '最大生命值', defenceFlat: '基础防御力', attackSpeedFlat: '攻击速度', naturalSkillRecoveryFlat: '每秒自然技力恢复', artsResistanceFlat: '法术抗性', initialSkillPointsFlat: '初始技力', physicalAndArtsDodge: '物理与法术闪避率', lifeRecoveryFlat: '每秒生命恢复', healingDealtPercent: '治疗量', physicalAndArtsDamageReduction: '物理与法术伤害减免', redeployTimeReduction: '再部署时间缩减', normalAttackDamagePercent: '普通攻击伤害' };
const BADGE_RATIOS = new Set(['attackPercent', 'maxLifePercent', 'physicalAndArtsDodge', 'healingDealtPercent', 'physicalAndArtsDamageReduction', 'redeployTimeReduction', 'normalAttackDamagePercent']);

function gearDescription(record) {
  if (record.normal || record.effect) return record.normal || record.effect;
  const stat = BADGE_STATS[record.stat];
  if (stat && typeof record.value === 'number') return `${stat}增加${BADGE_RATIOS.has(record.stat) ? `${Number((record.value * 100).toFixed(4))}%` : record.value}。${record.note || ''}`;
  return record.note || '';
}

/** Only display data and action options cross the HTTP boundary; the session owns the rules. */
export function independentDisplayCatalog(data, catalog) {
  const operators = Object.fromEntries(Object.entries(catalog.operators).map(([id, op]) => {
    const raw = op.elite ? op.source.eliteChess || op.source.normalChess : op.source.normalChess;
    return [id, { name: op.name, tier: op.tier, elite: op.elite, position: raw.position, profession: raw.profession,
      eliteChessId: op.eliteChessId || null, baseChessId: op.chessId || id,
      avatar: chessAvatarUrl(data.assets, raw), nativeTrait: op.nativeTrait.text, permitGear: op.permitGearId || null,
      traitTexts: GAME_TEXT.operators[baseChessId(id)] ? { normal: GAME_TEXT.operators[baseChessId(id)].normal, elite: GAME_TEXT.operators[baseChessId(id)].elite }
        : { normal: op.nativeTrait.normalText, elite: op.nativeTrait.eliteText },
      summary: traitSummary(op.nativeTrait.effect),
      skills: raw.skills || [], modules: (raw.modules || []).map((x) => ({ ...x, id: x.uniEquipId || x.id })) }];
  }));
  const gear = Object.fromEntries([...Object.entries(catalog.badges), ...Object.entries(catalog.equipment)].map(([id, d]) => {
    const steam = d.params?.effects?.find((x) => x.behavior === 'steamGearUpgrade');
    const text = GAME_TEXT.gear[id];
    return [id, { name: d.newName || d.name, level: d.level, eliteLevel: d.eliteLevel,
      normal: text ? text.normal : gearDescription(d), elite: text ? (text.elite ?? text.normal) : (d.elite || gearDescription(d)), kind: d.kind, unique: !!d.unique, inheritable: d.inheritable !== false, mechanism: d.mechanism,
      sourceId: d.sourceId, available: d.available !== false, steamOptions: steam?.params.sourceIds, steamLimit: steam?.params.chooseVariantsOnEquip,
      identityFactions: d.mechanism === 'identityTag' ? catalog.config.tavernFactions : undefined,
      ...(d.kind === 'badge' ? { stat: d.stat, value: d.value, statName: BADGE_STATS[d.stat] || null, ratio: BADGE_RATIOS.has(d.stat) } : {}),
      // how many shop slots / operators a supply asks for when used (prizes.js useInventoryItem)
      ...(d.params?.normalCount != null ? { useCount: { normal: Number(d.params.normalCount), elite: Number(d.params.eliteCount ?? d.params.normalCount) } } : {}) }];
  }));
  const prizes = Object.fromEntries(Object.entries(catalog.prizes).map(([id, d]) => [id, { name: d.name, effect: GAME_TEXT.prizes[id]?.text ?? d.effect, mechanism: d.mechanism, stage: PRIZE_STAGE[d.stage] || null }]));
  // the fallback offer when no prize can be drawn (prizes.js choosePrize fallback-procurement-*)
  for (const [id, t] of Object.entries(GAME_TEXT.prizes)) if (!prizes[id]) prizes[id] = { name: t.name, effect: t.text, mechanism: 'fallback', stage: null };
  const attachments = Object.fromEntries(Object.entries(catalog.attachments).map(([id, d]) => [id, { name: d.name, effect: GAME_TEXT.attachments[id]?.text ?? d.effect, mechanism: d.mechanism }]));
  return { name: catalog.name, operators, gear, prizes, attachments, terms: GAME_TEXT.terms,
    factions: catalog.config.tavernFactions,
    // numbers the page shows instead of hard-coding them (the 20 % 接装损耗 = 1 − these ratios)
    rules: { purchasePrice: catalog.config.purchasePrice, sellPrice: catalog.config.sellPrice, refreshPrice: catalog.config.refreshPrice,
      equipmentCapacity: catalog.config.equipmentCapacity, bodyPenalty: { baseAttackRatio: catalog.config.bodyPenalty?.baseAttackRatio ?? 0.8, baseLifeRatio: catalog.config.bodyPenalty?.baseLifeRatio ?? 0.8 } },
    traitWhen: TRAIT_WHEN,
    modes: [{ name: '短局', difficulty: 'FUNNY', roundLimit: 9 }, { name: '标准局', difficulty: 'NORMAL', roundLimit: 14 }, { name: '追加挑战', difficulty: 'NORMAL', roundLimit: 15 }] };
}

function reply(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}
async function bodyOf(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes <= MAX_BODY) chunks.push(chunk);
  }
  if (bytes > MAX_BODY) throw Object.assign(new Error('请求过大'), { status: 413, code: 'BODY_LIMIT' });
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
    if (!catalog) { catalog = getCatalog(data); display = independentDisplayCatalog(data, catalog); }
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
      const errors = validateSession(state);
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
    const view = viewSession(state, definitions());
    const { pool, history, catalog: ignoredCatalog, ...thin } = view;
    thin.lastBattle = history.findLast((x) => x.type === 'battle') || null;
    thin.pieces = thin.pieces.map((piece) => ({ ...piece,
      equipmentDetails: piece.equipmentDetails.map((item) => ({ ...item, record: display.gear[item.id] })),
      attachmentDetails: piece.attachmentDetails.map((item) => ({ ...item, record: display.attachments[item.id] })) }));
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
        const body = await bodyOf(req);
        const state = createSession({ seed: body.seed, difficulty: body.difficulty, roundLimit: body.roundLimit, ...definitions() });
        const id = randomUUID(); await save(id, state); reply(res, 201, packet(id, state)); return true;
      }
      const parts = relative.split('/');
      const replayRoute = parts.length === 4 && parts[2] === 'replays' && /^[1-9][0-9]?$/.test(parts[3]);
      if (parts[0] !== 'sessions' || !SESSION_ID.test(parts[1] || '') || parts.length > 4 || (parts.length === 3 && parts[2] !== 'actions') || (parts.length === 4 && !replayRoute)) {
        reply(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '这一局不存在或已过期' } }); return true;
      }
      const id = parts[1];
      if (parts.length === 2 && req.method === 'GET') { reply(res, 200, packet(id, await load(id), [], !/[?&]catalog=0(&|$)/.test(req.url || ''))); return true; }
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
