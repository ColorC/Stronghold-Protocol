#!/usr/bin/env node
// Build the concentrated workshop table from canonical design, game-text, source references and native chess data.
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
const SOURCE_REFERENCE_PATH = path.resolve(process.env.SP_INDEPENDENT_SOURCE_REFERENCE_PATH || path.join(DATA_DIR, 'independent-source-reference.json'));
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
  '反冲空降仓': '六本装备；部署时选合法格，优先有敌人的格，对格上敌人造成15000法术伤害，每多一件加500。科技6蕾缪安带来。',
  '便携式融毁教学仪': '六本装备；每战限一次，指定离场时全场10000真实伤害，每多一件加3000；攻击过携带者的敌人双倍；再部署时间翻倍。科技6史尔特尔带来。',
  '叙拉古狼嚎哨': '同一干员唯一；每发动12次普通攻击使主目标恐惧0.75秒，冷却8秒。新局由科技4拉普兰德带来。',
};

function nativeSummary(chess) {
  const parts = [];
  const stats = chess.stats || {};
  const rawStats = [['生命', stats.maxHp], ['攻击', stats.atk], ['防御', stats.def], ['法抗', stats.res], ['攻击间隔', stats.bat]]
    .filter(([, value]) => Number.isFinite(value)).map(([label, value]) => `${label}${value}`).join('、');
  if (rawStats) parts.push(`本体白值：${rawStats}`);
  if (chess.trait?.desc) parts.push(`本体特性：${clean(chess.trait.desc)}`);
  const skills = Array.isArray(chess.skills) && chess.skills.length ? [...chess.skills] : (chess.skill ? [chess.skill] : []);
  const listedSkillIds = new Set(skills.map((skill) => skill.skillId).filter(Boolean));
  if (chess.skill?.desc && !listedSkillIds.has(chess.skill.skillId)) skills.push(chess.skill);
  if (skills.length) parts.push(`原生技能：${skills.map((skill) => `《${clean(skill.name || '技能')}》${skill.level ? `Lv${skill.level}` : ''}：${clean(skill.desc)}`).join('；')}`);
  const talents = (chess.talents || []).filter((t) => t?.desc).map((t) => `${clean(t.name || '天赋')}：${clean(t.desc)}`);
  if (talents.length) parts.push(`天赋：${talents.join('；')}`);
  return parts.join('；') || '本体技能与天赋沿用原始配置';
}

function sourceCardSummary(sourceRefs, fallbackTier = null) {
  const cards = sourceRefs?.cards;
  if (!Array.isArray(cards) || !cards.length) return '原卡来源待补';
  return cards.map((card) => {
    const type = card.type === 'Battlegrounds' ? '酒馆战棋原卡'
      : card.type === 'Constructed supplement' ? '构筑补充原卡'
        : card.type === 'later Battlegrounds supplement' ? '后续酒馆战棋补充原卡' : clean(card.type || '原卡');
    const tier = Number.isFinite(card.tier) ? `原科技${card.tier}`
      : Number.isFinite(fallbackTier) ? `关联奖品档位${fallbackTier}` : '无酒馆科技等级';
    return `${clean(card.name || card.nameEn || '未命名卡')}（${type}；${tier}；${clean(card.version || '版本未知')}）`;
  }).join('；');
}

function nativePowerSummary(op) {
  const power = op.sourceRefs?.nativePower;
  if (!power || !Number.isFinite(power.bestStaticDps)) return '暂无已记录的90秒木桩探针';
  const dps = Number(power.bestStaticDps.toFixed(1));
  const interval = Number.isFinite(power.attackInterval) ? `；原生攻击间隔${power.attackInterval}秒` : '';
  const scenario = ({ single_0_0: '单体、零防御零法抗', single_800_40: '单体、800防御40法抗', four_0_0: '四目标、零防御零法抗' })[power.scenario] || '对应木桩场景';
  return `已有90秒静止木桩记录：${scenario}最佳DPS ${dps}（技能《${clean(power.skill || '未注明')}》${interval}）。该数值只表示对应场景的输出探针，不等同通用强度；治疗、控制、阻挡、射程、部署周期与经济能力需结合原生技能天赋判断。`;
}

function roleBasis(op, moments) {
  const refs = op.sourceRefs || {};
  const humanizeScenario = (value) => clean(value).replaceAll('single_0_0', '单体零防零抗场景')
    .replaceAll('single_800_40', '单体800防40法抗场景').replaceAll('four_0_0', '四目标零防零抗场景');
  const citation = [...new Set([refs.basis, refs.traitRevision, refs.reference].filter(Boolean).map(humanizeScenario))].join('；');
  const roleText = op.role || op.roster || '定位资料待补';
  const timing = moments ? `生效节点：${moments}` : '';
  return [roleText, citation, timing].filter(Boolean).join('；');
}

export function buildTable({ design, gameText, chessData, catalog, sourceReference }) {
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
      faction: (op.nativeFactionTags || []).join('、'), reference: sourceCardSummary(op.sourceRefs),
      native: nativeSummary(chess), nativePower: nativePowerSummary(op),
      normal: clean(text.normal), upgrade: clean(text.elite), basis: roleBasis(op, moments),
    });
  }
  for (const [id, badge] of Object.entries(catalog.badges)) rows.push({
    section: '徽章', level: `装备${badge.level}`, name: badge.name, role: badge.regularProduction ? '基础成长' : '特殊成长', faction: '',
    reference: sourceCardSummary(badge.sourceRefs), native: '按件数线性叠加比例', nativePower: '', normal: clean(gameText.gear?.[id]?.normal),
    upgrade: '每多一枚增加相同百分比或百分点；现有上限仍生效', basis: badge.retired ? '旧版装备兼容；新局不再产出' : '原生白值、技能加攻、造伤、治疗和回复分别结算',
  });
  const gearTable = cardTable('gear', catalog);
  for (const gear of gearTable.rows.filter((x) => x.state === '在用').sort((a, b) => Number(!gearNotes[a.name]) - Number(!gearNotes[b.name]) || Number(a.level) - Number(b.level))) {
    const record = catalog.equipment[gear.id];
    rows.push({ section: record.kind === 'prizeGear' ? '特供装备' : '装备', level: gear.level ? `装备${gear.level}` : '', name: gear.name,
      role: record.mechanism === 'keywordGear' ? '关键词转换' : record.kind === '补给' ? '指定目标补给' : record.kind === '玩家设施' ? '玩家设施' : '战术装备',
      faction: gear.faction || '', reference: sourceCardSummary(record.sourceRefs), native: gear.from ? `获得来源：${gear.from}` : record.kind === 'prizeGear' ? '工程部特供' : '对应随机补给或设施来源', nativePower: '',
      normal: clean(gear.effect), upgrade: '同名装备按自身规则叠加；装备没有进阶形态', basis: gearNotes[gear.name] || '' });
  }
  for (const permission of (design.permissions || []).filter((entry) => entry.autoGrant !== false)) {
    const bearer = design.operators.find((op) => op.inheritance?.name === permission.name && op.inheritance?.autoGrant !== false);
    if (!bearer) throw new Error(`automatic inheritance permit has no bearer: ${permission.name}`);
    rows.push({ section: '交接凭证', level: `科技${bearer.tier}`, name: permission.gear, role: '获得时自动装备',
      faction: (bearer.nativeFactionTags || []).join('、'), reference: sourceCardSummary(permission.sourceRefs),
      native: `由${bearer.name}（科技${bearer.tier}）带来；凭证留在原持有人身上，不随交接转移。`, nativePower: '',
      normal: '双方任一人的凭证资格满足条件即可交接；持有人可作为交出方或接收方。',
      upgrade: permission.limit, basis: '新局自动来源；其余旧凭证仅为存档兼容，不作为新局来源。' });
  }
  for (const [id, prize] of Object.entries(catalog.prizes)) rows.push({ section: '工程部特供', level: prize.stage || '', name: prize.name,
    role: '阶段奖品', faction: '', reference: sourceCardSummary(prize.sourceRefs, prize.historicalTier), native: '沿用已有工坊奖品规则', nativePower: '',
    normal: clean(gameText.prizes?.[id]?.text), upgrade: '', basis: '完整暗月奖品译稿与当前已实装奖品目录分开标明' });
  const operatorByName = new Map(ops.map((op) => [op.name, op]));
  for (const warband of sourceReference?.archetypes || []) {
    const members = warband.operators.map((name) => {
      const op = operatorByName.get(name);
      if (!op) throw new Error(`${warband.name}: missing active operator ${name}`);
      return op;
    });
    rows.push({ section: '七人阵容', level: `参考族群：${warband.sourceTribe}`, name: warband.name, role: '完整构筑阵容', faction: warband.faction,
      native: members.map((op) => `${op.name}（科技${op.tier}）`).join('、'),
      reference: members.map((op) => `${op.name}：${sourceCardSummary(op.sourceRefs)}`).join('；'), nativePower: '',
      normal: '', upgrade: '', basis: warband.chain });
  }
  for (const [difficulty, phases] of Object.entries(design.rules.enemyBalance || {})) for (const phase of phases) rows.push({
    section: '敌人', level: `第${phase.fromRound}轮起`, name: difficulty === 'FUNNY' ? '休闲局' : '标准局', role: '波次倍率', faction: '',
    reference: '无原卡来源：敌方波次规则', nativePower: '',
    native: '防御、法抗、免疫、路线与出场时间沿用原波次',
    normal: `生命×${phase.hpMul}；攻击×${phase.atkMul}；领袖生命×${phase.bossHpMul ?? 1}`, upgrade: '',
    basis: '休闲维持较高通过率；标准局减轻前中期压力，保留后期挑战',
  });
  const columns = [
    ['section', '内容', 95], ['level', '科技／等级', 100], ['name', '名称', 140], ['role', '主要功能', 105],
    ['faction', '原生阵营', 170], ['reference', '参考原卡', 360], ['native', '完整本体能力／获得来源', 660],
    ['nativePower', '90秒木桩证据与限定', 440], ['normal', '普通效果', 460],
    ['upgrade', '进阶／重复获得', 430], ['basis', '分配与数值依据', 380],
  ].map(([key, title, width]) => ({ key, title, width, type: 'text' }));
  for (const row of rows) for (const column of columns) {
    row[column.key] = clean(row[column.key]);
    if (ID_PATTERN.test(row[column.key])) throw new Error(`internal ID in visible table row ${row.name} field ${column.key}`);
    if (/null\s*:\s*null/.test(row[column.key])) throw new Error(`null:null in visible table row ${row.name} field ${column.key}`);
  }
  if (ops.length !== 101) throw new Error(`expected 101 active operators, found ${ops.length}`);
  if ((sourceReference?.archetypes || []).length !== 5) throw new Error(`expected five source-reference warbands, found ${(sourceReference?.archetypes || []).length}`);
  for (const row of rows.filter((entry) => entry.section !== '敌人')) if (row.reference === '原卡来源待补') throw new Error(`missing source card reference: ${row.section} ${row.name}`);
  return { schema: 'workshop.table/v1', title: '工坊集中配置表', columns, rows };
}

function main() {
  const i = process.argv.indexOf('--output');
  const outputInput = i >= 0 ? process.argv[i + 1] : process.env.SP_INDEPENDENT_CONCENTRATED_TABLE_OUTPUT || DEFAULT_OUTPUT;
  if (!outputInput || !path.isAbsolute(outputInput)) throw new Error(`absolute output path required: ${outputInput || '(missing)'}`);
  const output = path.resolve(outputInput);
  for (const p of [DATA_DIR, DESIGN_PATH, TEXT_PATH, CHESS_PATH, SOURCE_REFERENCE_PATH]) if (!path.isAbsolute(p)) throw new Error(`absolute source path required: ${p}`);
  const table = buildTable({ design: read(DESIGN_PATH), gameText: read(TEXT_PATH), chessData: read(CHESS_PATH), catalog: getCatalog(), sourceReference: read(SOURCE_REFERENCE_PATH) });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(table, null, 2)}\n`, 'utf8');
  const counts = table.rows.reduce((out, row) => (out[row.section] = (out[row.section] || 0) + 1, out), {});
  const roleCounts = opsRoleCounts(read(DESIGN_PATH).operators);
  console.log(JSON.stringify({ ok: true, output, rows: table.rows.length, columns: table.columns.length, counts, roleCounts }));
}

function opsRoleCounts(operators) {
  return operators.filter((op) => op.active !== false).reduce((out, op) => {
    const role = op.roster || op.role || '未分类'; out[role] = (out[role] || 0) + 1; return out;
  }, {});
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
