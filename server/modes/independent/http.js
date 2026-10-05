import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getCatalog } from './catalog.js';
import { createSession, applyAction, viewSession, validateSession } from './session.js';
import { chessAvatarUrl } from '../../../public/js/ui/assetUrls.js';

const PREFIX = '/independent/api/';
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
      avatar: chessAvatarUrl(data.assets, raw), nativeTrait: op.nativeTrait.text, permission: op.inheritance || null,
      skills: raw.skills || [], modules: (raw.modules || []).map((x) => ({ ...x, id: x.uniEquipId || x.id })) }];
  }));
  const gear = Object.fromEntries([...Object.entries(catalog.badges), ...Object.entries(catalog.equipment)].map(([id, d]) => {
    const steam = d.params?.effects?.find((x) => x.behavior === 'steamGearUpgrade');
    return [id, { name: d.newName || d.name, level: d.level, eliteLevel: d.eliteLevel, normal: gearDescription(d), elite: d.elite || gearDescription(d), kind: d.kind, unique: !!d.unique, mechanism: d.mechanism,
      sourceId: d.sourceId, available: d.available !== false, steamOptions: steam?.params.sourceIds, steamLimit: steam?.params.chooseVariantsOnEquip,
      identityFactions: d.mechanism === 'identityTag' ? catalog.config.tavernFactions : undefined }];
  }));
  const texts = (table) => Object.fromEntries(Object.entries(table).map(([id, d]) => [id, { name: d.name, effect: d.effect, mechanism: d.mechanism }]));
  return { name: catalog.name, operators, gear, prizes: texts(catalog.prizes), attachments: texts(catalog.attachments),
    factions: catalog.config.tavernFactions,
    modes: [{ name: '短程演习', difficulty: 'FUNNY', roundLimit: 9 }, { name: '完整演习', difficulty: 'NORMAL', roundLimit: 14 }, { name: '追加挑战', difficulty: 'NORMAL', roundLimit: 15 }] };
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
  async function load(id) {
    try {
      const state = JSON.parse(await readFile(file(id), 'utf8'));
      const errors = validateSession(state);
      if (errors.length) throw new Error(`Invalid persisted independent session: ${errors.join(',')}`);
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error('演习未找到'), { status: 404, code: 'NOT_FOUND' });
      throw error;
    }
  }
  async function save(id, state) {
    await mkdir(directory, { recursive: true });
    const pending = path.join(directory, `${id}.${randomUUID()}.pending`);
    await writeFile(pending, JSON.stringify(state), { flag: 'wx' });
    await rename(pending, file(id));
  }
  function packet(id, state, events = []) {
    const view = viewSession(state, definitions());
    const { pool, history, catalog: ignoredCatalog, ...thin } = view;
    thin.lastBattle = history.findLast((x) => x.type === 'battle') || null;
    thin.pieces = thin.pieces.map((piece) => ({ ...piece,
      equipmentDetails: piece.equipmentDetails.map((item) => ({ ...item, record: display.gear[item.id] })),
      attachmentDetails: piece.attachmentDetails.map((item) => ({ ...item, record: display.attachments[item.id] })) }));
    return { ok: true, id, state: thin, catalog: display, events };
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
        reply(res, 403, { ok: false, error: { code: 'ORIGIN', message: '请在演习页面进行操作' } }); return true;
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
      if (parts[0] !== 'sessions' || !SESSION_ID.test(parts[1] || '') || parts.length > 3 || (parts.length === 3 && parts[2] !== 'actions')) {
        reply(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '演习未找到' } }); return true;
      }
      const id = parts[1];
      if (parts.length === 2 && req.method === 'GET') { reply(res, 200, packet(id, await load(id))); return true; }
      if (parts.length === 3 && req.method === 'POST') {
        const body = await bodyOf(req);
        await exclusive(id, async () => {
          const state = await load(id);
          if (body.expectedRevision !== state.revision) { reply(res, 409, { ...packet(id, state), ok: false, error: { code: 'REVISION', message: '演习已更新，请重试当前操作' } }); return; }
          const result = applyAction(state, body.action, definitions());
          if (!result.ok) { reply(res, 422, { ...packet(id, state), ok: false, error: result.error }); return; }
          await save(id, result.state);
          reply(res, 200, packet(id, result.state, result.events));
        });
        return true;
      }
      reply(res, 405, { ok: false, error: { code: 'METHOD', message: '不支持此操作' } });
    } catch (error) {
      if (!error.status && !/^[A-Z][A-Z0-9_]*$/.test(error.message)) throw error;
      reply(res, error.status || 422, { ok: false, error: { code: error.code || error.message, message: error.status ? error.message : '无法创建此演习' } });
    }
    return true;
  };
}
