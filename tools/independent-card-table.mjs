#!/usr/bin/env node
// The owner's editable card tables on the Workshop canvas (user 2026-10-07: 「做一个可编辑卡表把，我后续会在里面调整设置，
// 填完你更新到游戏里面就行」): one table of the operators, one of the gear, in the canvas table format
// (wsh canvas table put/get, schema workshop.table/v1). This tool writes them from the game data and, once the owner
// has edited them, lists every changed cell so it can be carried into the rules, the texts and the design doc.
//   node tools/independent-card-table.mjs export operators|gear --out <file.json>
//   node tools/independent-card-table.mjs diff operators|gear --table <file.json>   → changed cells, as JSON
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getCatalog } from '../server/modes/independent/catalog.js';
import { tavernFactions } from '../shared/independentRules.js';
import { classifyRosterKind } from './independent-roster-classification.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const TEXT = JSON.parse(readFileSync(resolve(process.env.SP_INDEPENDENT_GAME_TEXT_PATH || resolve(ROOT, 'data/independent-game-text.json')), 'utf8'));
const DESIGN = JSON.parse(readFileSync(resolve(process.env.SP_INDEPENDENT_DESIGN_PATH || resolve(ROOT, 'data/independent-design.json')), 'utf8'));
const PROFESSION = { PIONEER: '先锋', WARRIOR: '近卫', TANK: '重装', SNIPER: '狙击', CASTER: '术师', MEDIC: '医疗', SUPPORT: '辅助', SPECIAL: '特种' };
export const ROSTER_KINDS = ['成长', '生成', '经济', '辅助', '战斗', '交接'];
export const ACTIVE_OPERATOR_IDS = new Set(DESIGN.rules.activeRosterIds);
export const INACTIVE_OPERATOR_IDS = new Set(DESIGN.operators.filter((op) => !ACTIVE_OPERATOR_IDS.has(op.chessId)).map((op) => op.chessId));

const OPERATOR_COLUMNS = [
  { key: 'id', title: '编号（勿改）', width: 150 },
  { key: 'name', title: '干员', width: 110 },
  { key: 'tier', title: '科技等级', type: 'number', width: 80 },
  { key: 'kind', title: '类别', type: 'select', options: ROSTER_KINDS, width: 90 },
  { key: 'rarity', title: '星级', type: 'number', width: 60 },
  { key: 'profession', title: '职业', width: 70 },
  { key: 'faction', title: '阵营', width: 90 },
  { key: 'normal', title: '普通特质', width: 360 },
  { key: 'elite', title: '精锐特质', width: 360 },
  { key: 'note', title: '设计说明', width: 260 },
  { key: 'remark', title: '批注', width: 220 },
];
const GEAR_COLUMNS = [
  { key: 'id', title: '编号（勿改）', width: 170 },
  { key: 'name', title: '装备', width: 140 },
  { key: 'level', title: '等级', type: 'number', width: 60 },
  { key: 'faction', title: '阵营', width: 80 },
  { key: 'effect', title: '效果', width: 420 },
  { key: 'from', title: '装备来源', width: 230 },
  { key: 'state', title: '状态', type: 'select', options: ['在用', '停产', '待分配'], width: 80 },
  { key: 'remark', title: '批注', width: 220 },
];

function operatorRows(catalog) {
  return DESIGN.operators.filter((op) => ACTIVE_OPERATOR_IDS.has(op.chessId)).slice().sort((a, b) => a.tier - b.tier || 0).map((src) => {
    const op = catalog.operators[src.chessId]; const raw = op.source?.normalChess || {};
    const text = TEXT.operators[src.chessId] || {};
    return { id: src.chessId, name: src.name, tier: String(src.tier), kind: src.roster || classifyRosterKind(src), rarity: String(raw.rarity ?? ''),
      profession: PROFESSION[raw.profession] || raw.profession || '', faction: tavernFactions({ chessId: src.chessId, equipment: [] }, catalog).join('、'),
      normal: text.normal || '', elite: text.elite || '', note: src.role || '', remark: '' };
  });
}

/** Operators whose trait names an item they bring, by item id (the same walk as tools/independent-gear-sources.mjs). */
function bringers(catalog) {
  const out = new Map();
  const ids=catalog.config?.activeRosterIds||catalog.rules?.activeRosterIds;
  const live=Array.isArray(ids)?new Set(ids):null;
  for (const [id,op] of Object.entries(catalog.operators)) {
    // The table shows sources for the live roster only. Retired ordinary forms stay in saved
    // catalog data, but must not make a current gear card look obtainable from an inactive unit.
    if (op.elite || op.recruitable===false || live && !live.has(op.chessId||id)) continue;
    for (const r of [...op.nativeTrait.effect.prep, ...op.nativeTrait.effect.combat]) {
      for (const id of [...(r.params?.outputs || []).map((x) => x.id), ...(r.params?.ids || []), r.params?.id].filter(Boolean)) {
        if (!out.has(id)) out.set(id, new Set());
        out.get(id).add(op.name);
      }
    }
  }
  return out;
}
function gearRows(catalog) {
  const from = bringers(catalog);
  const trainingGearIds = new Set(DESIGN.rules?.trainingGearIds || []);
  return Object.values(catalog.equipment)
    .filter((d) => d.available !== false && d.mechanism !== 'badge' && d.mechanism !== 'disabled' && !['停用', 'permit'].includes(d.kind) && d.canonicalId === d.id)
    .sort((a, b) => Number(a.level ?? 9) - Number(b.level ?? 9))
    .map((d) => ({ id: d.id, name: d.newName || d.name, level: String(d.level ?? ''), faction: d.faction || '',
      effect: TEXT.gear[d.id]?.normal || d.normal || d.effect || '', from: trainingGearIds.has(d.id)
        ? '专项战备授训奖品：永久直接装备给指定干员'
        : [...(from.get(d.id) || [])].join('、'),
      state: d.retired ? '停产' : d.unassigned ? '待分配' : '在用', remark: '' }));
}

export function cardTable(which, catalog = getCatalog()) {
  if (which === 'operators') return { schema: 'workshop.table/v1', title: '工坊干员卡表', columns: OPERATOR_COLUMNS, rows: operatorRows(catalog) };
  if (which === 'gear') return { schema: 'workshop.table/v1', title: '工坊装备卡表', columns: GEAR_COLUMNS, rows: gearRows(catalog) };
  throw new Error(`unknown table ${which}`);
}

/** Cells the owner changed: [{ id, name, key, title, was, now }], plus rows added or removed. */
export function cardTableDiff(which, edited, catalog = getCatalog()) {
  const base = cardTable(which, catalog);
  const byId = new Map(base.rows.map((r) => [r.id, r]));
  const changes = [];
  for (const row of edited.rows || []) {
    const was = byId.get(row.id);
    if (!was) { if (!INACTIVE_OPERATOR_IDS.has(row.id)) changes.push({ id: row.id || '', name: row.name || '', key: '*', title: '新行', was: '', now: JSON.stringify(row) }); continue; }
    byId.delete(row.id);
    for (const col of base.columns) {
      const a = String(was[col.key] ?? ''); const b = String(row[col.key] ?? '');
      if (a !== b) changes.push({ id: row.id, name: was.name, key: col.key, title: col.title, was: a, now: b });
    }
  }
  for (const gone of byId.values()) changes.push({ id: gone.id, name: gone.name, key: '*', title: '删除的行', was: gone.name, now: '' });
  return changes;
}

function main() {
  const [mode, which] = process.argv.slice(2, 4);
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  if (mode === 'export') {
    const out = arg('--out'); if (!out) throw new Error('--out <file.json>');
    writeFileSync(out, JSON.stringify(cardTable(which), null, 1) + '\n');
    console.log(JSON.stringify({ written: out, rows: cardTable(which).rows.length }));
  } else if (mode === 'diff') {
    const file = arg('--table'); if (!file) throw new Error('--table <file.json>');
    console.log(JSON.stringify(cardTableDiff(which, JSON.parse(readFileSync(file, 'utf8'))), null, 1));
  } else {
    console.error('usage: node tools/independent-card-table.mjs export|diff operators|gear ...');
    process.exitCode = 2;
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
