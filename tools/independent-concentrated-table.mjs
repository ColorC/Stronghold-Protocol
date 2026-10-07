#!/usr/bin/env node
// Build the nine-column workshop roster table from canonical design, game-text and native chess data.
// Usage: node tools/independent-concentrated-table.mjs [--output <absolute-file>]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getCatalog } from '../server/modes/independent/catalog.js';
import { cardTable } from './independent-card-table.mjs';
import { TRAIT_WHEN } from '../server/modes/independent/summary.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.resolve(process.env.SP_DATA_DIR || path.join(ROOT, 'data'));
const DESIGN_PATH = path.resolve(process.env.SP_INDEPENDENT_DESIGN_PATH || path.join(DATA_DIR, 'independent-design.json'));
const TEXT_PATH = path.resolve(process.env.SP_INDEPENDENT_GAME_TEXT_PATH || path.join(DATA_DIR, 'independent-game-text.json'));
const CHESS_PATH = path.resolve(process.env.SP_CHESS_PATH || path.join(DATA_DIR, 'chess.json'));
const DEFAULT_OUTPUT = path.resolve(ROOT, 'docs/independent-mode/roster-rework-table.json');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const clean = (v) => String(v ?? '').replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
const ID_PATTERN = /(?:chess_(?:char|item)_|skchr_|independent:|token_\d+_)/;

const gearNotes = {
  '坚守盟约': '分摊取同队在场最高比例后均分。一件的全队总来伤系数0.98，五件0.88；主要服务承伤分配。',
  '护盾发生器': '两件装备8层，另加空弦/泥岩原生部署1层。累计5层才触发护盾成长。',
  '突袭盟约': '每次部署即开攻速窗口；连续10秒未攻击触发合法再部署。一件对基础攻速100提升频率30%。',
  '巨锤盟约': '当前攻击力1000、零防御时一件每动作额外500伤害；五件900。仅实际0.9格内目标，独立扣除防御。',
  '精准盟约': '攻击1000对800防御：一件使单次200→360；零防御无收益。40法抗伤害倍率0.60→0.68。',
  '不屈盟约': '一/二/五件概率18%/18.4%/19.6%。沿用适用退场条件和替身免费复归，不补虚构技力。',
  '爆破部署台': '一/二/五件每个范围内目标1000/1300/2200真伤。只有部署时有效。',
  '反冲空降仓': '一件对40法抗造成9000伤害；只命中选中格内敌人。部署间隔和敌人后续入场限制收益。',
  '便携式融毁教学仪': '一件全场各敌人10000真伤，攻击过持有者者20000；每战一次，70秒再部署变140秒。',
};

function nativeSummary(chess) {
  const parts = [];
  const stats = chess.stats || {};
  const rawStats = [['生命', stats.maxHp], ['攻击', stats.atk], ['防御', stats.def], ['法抗', stats.res], ['攻击间隔', stats.bat]]
    .filter(([, value]) => Number.isFinite(value)).map(([label, value]) => `${label}${value}`).join('、');
  if (rawStats) parts.push(`本体白值：${rawStats}`);
  if (chess.trait?.desc) parts.push(`本体特性：${clean(chess.trait.desc)}`);
  if (chess.skill?.desc) parts.push(`技能《${clean(chess.skill.name || '当前技能')}》：${clean(chess.skill.desc)}`);
  const talents = (chess.talents || []).filter((t) => t?.desc).map((t) => `${clean(t.name || '天赋')}：${clean(t.desc)}`);
  if (talents.length) parts.push(`天赋：${talents.join('；')}`);
  return parts.join('；') || '本体技能与天赋沿用原始配置';
}

function roleBasis(op, moments) {
  const refs = op.sourceRefs || {};
  const citation = [...new Set([refs.basis, refs.traitRevision, refs.reference].filter(Boolean).map(clean))].join('；');
  const roleText = op.role || op.roster || '定位资料待补';
  const timing = moments ? `生效节点：${moments}` : '';
  return [roleText, citation, timing].filter(Boolean).join('；');
}

export function buildTable({ design, gameText, chessData, catalog }) {
  const rows = [];
  const ops = design.operators.filter((op) => op.active !== false).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, 'zh-CN'));
  for (const op of ops) {
    const chess = chessData[op.chessId];
    const text = gameText.operators?.[op.chessId];
    if (!chess || !text) throw new Error(`${op.name}: missing canonical chess or game-text record`);
    const forms = op.modeEffects || {};
    const rules = ['normal', 'elite'].flatMap((form) => [...(forms[form]?.prep || []), ...(forms[form]?.combat || [])]);
    const moments = [...new Set(rules.map((rule) => TRAIT_WHEN[rule.trigger]).filter(Boolean))].join('、');
    rows.push({
      section: '干员', level: `科技${op.tier}`, name: op.name, role: op.roster || op.role,
      faction: (op.nativeFactionTags || []).join('、'), native: nativeSummary(chess),
      normal: clean(text.normal), upgrade: clean(text.elite), basis: roleBasis(op, moments),
    });
  }
  for (const [id, badge] of Object.entries(catalog.badges)) rows.push({
    section: '徽章', level: `装备${badge.level}`, name: badge.name, role: badge.regularProduction ? '基础成长' : '特殊成长', faction: '',
    native: '按件数线性叠加比例', normal: clean(gameText.gear?.[id]?.normal),
    upgrade: '每多一枚增加相同百分比或百分点；现有上限仍生效', basis: badge.retired ? '旧版装备兼容；新局不再产出' : '原生白值、技能加攻、造伤、治疗和回复分别结算',
  });
  const gearTable = cardTable('gear', catalog);
  for (const gear of gearTable.rows.filter((x) => x.state === '在用').sort((a, b) => Number(!gearNotes[a.name]) - Number(!gearNotes[b.name]) || Number(a.level) - Number(b.level))) {
    const record = catalog.equipment[gear.id];
    rows.push({ section: record.kind === 'prizeGear' ? '特供装备' : '装备', level: gear.level ? `装备${gear.level}` : '', name: gear.name,
      role: record.mechanism === 'keywordGear' ? '关键词转换' : record.kind === '补给' ? '指定目标补给' : record.kind === '玩家设施' ? '玩家设施' : '战术装备',
      faction: gear.faction || '', native: gear.from ? `获得来源：${gear.from}` : record.kind === 'prizeGear' ? '工程部特供' : '对应随机补给或设施来源',
      normal: clean(gear.effect), upgrade: '同名装备按自身规则叠加；装备没有进阶形态', basis: gearNotes[gear.name] || '' });
  }
  for (const [id, prize] of Object.entries(catalog.prizes)) rows.push({ section: '工程部特供', level: prize.stage || '', name: prize.name,
    role: '阶段奖品', faction: '', native: '沿用已有工坊奖品规则', normal: clean(gameText.prizes?.[id]?.text), upgrade: '', basis: '完整暗月奖品译稿与当前已实装奖品目录分开标明' });
  for (const [difficulty, phases] of Object.entries(design.rules.enemyBalance || {})) for (const phase of phases) rows.push({
    section: '敌人', level: `第${phase.fromRound}轮起`, name: difficulty === 'FUNNY' ? '休闲局' : '标准局', role: '波次倍率', faction: '',
    native: '防御、法抗、免疫、路线与出场时间沿用原波次',
    normal: `生命×${phase.hpMul}；攻击×${phase.atkMul}；领袖生命×${phase.bossHpMul ?? 1}`, upgrade: '',
    basis: '休闲维持较高通过率；标准局减轻前中期压力，保留后期挑战',
  });
  const columns = [
    ['section', '内容', 95], ['level', '科技／等级', 100], ['name', '名称', 140], ['role', '主要功能', 105],
    ['faction', '原生阵营', 170], ['native', '本体能力／获得来源', 530], ['normal', '普通效果', 460],
    ['upgrade', '进阶／重复获得', 430], ['basis', '分配与数值依据', 340],
  ].map(([key, title, width]) => ({ key, title, width, type: 'text' }));
  for (const row of rows) for (const column of columns) {
    row[column.key] = clean(row[column.key]);
    if (ID_PATTERN.test(row[column.key])) throw new Error(`internal ID in visible table row ${row.name} field ${column.key}`);
    if (/null\s*:\s*null/.test(row[column.key])) throw new Error(`null:null in visible table row ${row.name} field ${column.key}`);
  }
  if (ops.length !== 101) throw new Error(`expected 101 active operators, found ${ops.length}`);
  return { schema: 'workshop.table/v1', title: '工坊集中配置表', columns, rows };
}

function main() {
  const i = process.argv.indexOf('--output');
  const outputInput = i >= 0 ? process.argv[i + 1] : process.env.SP_INDEPENDENT_CONCENTRATED_TABLE_OUTPUT || DEFAULT_OUTPUT;
  if (!outputInput || !path.isAbsolute(outputInput)) throw new Error(`absolute output path required: ${outputInput || '(missing)'}`);
  const output = path.resolve(outputInput);
  for (const p of [DATA_DIR, DESIGN_PATH, TEXT_PATH, CHESS_PATH]) if (!path.isAbsolute(p)) throw new Error(`absolute source path required: ${p}`);
  const table = buildTable({ design: read(DESIGN_PATH), gameText: read(TEXT_PATH), chessData: read(CHESS_PATH), catalog: getCatalog() });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(table, null, 2)}\n`, 'utf8');
  const counts = table.rows.reduce((out, row) => (out[row.section] = (out[row.section] || 0) + 1, out), {});
  console.log(JSON.stringify({ ok: true, output, rows: table.rows.length, columns: table.columns.length, counts }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
