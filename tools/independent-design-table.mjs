#!/usr/bin/env node
// The operator table of docs/independent-mode/design.md (完整干员表) is a copy of data/independent-design.json: one
// row per operator with its two trait texts, its role note and its 交接凭证 line. This keeps the two from drifting:
//   node tools/independent-design-table.mjs check   → lists rows that differ from the data (exit 1 when any)
//   node tools/independent-design-table.mjs write   → rewrites every operator row from the data
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const DESIGN = resolve(process.env.SP_INDEPENDENT_DESIGN_PATH || resolve(ROOT, 'data/independent-design.json'));
const DOC = resolve(ROOT, 'docs/independent-mode/design.md');

/**
 * The 交接凭证 line of an operator row: only the twelve operators that bring one have it (user 10-07: 「交接的相关文字只放在
 * 交接相关的干员里面……哪有把废话复制上百遍的？」). The shared rules live once in the doc's rules section.
 */
export function permitLine(op) {
  const p = op.inheritance;
  if (!p) return '';
  const who = p.limit.replace(/^只能(被|继承)/, '').replace(/(继承)?。$/, '');
  return p.direction === '给予' ? `交接凭证「${p.gear}」：装备可交给${who}。` : `交接凭证「${p.gear}」：可接收${who}的装备。`;
}
// Markdown table cells must stay on one physical line. Escape pipes as cell
// content and render source newlines as HTML breaks so neither changes columns.
export const tableCell = (value) => String(value ?? '').replace(/\r\n|\r|\n/g, '<br>').replace(/\|/g, '\\|');
const legacyKinds = new Set(['纯战斗', '临时战斗', '联动', '一次性工具', '成长', '经济', '生成']);
export const operatorRow = (op) => {
  const role = [op.roster, op.role && !legacyKinds.has(op.role) ? op.role : ''].filter(Boolean).join('\n');
  return `| ${tableCell(`${op.name} · 科技等级${op.tier}\n原技能：${op.skill || '无主动技能'}`)} | ${tableCell(`普通：${op.nativeTrait.normal}\n精锐：${op.nativeTrait.elite}`)} | ${tableCell(`${role}${permitLine(op) ? `\n${permitLine(op)}` : ''}`)} |`;
};

const activeIds = (design) => new Set(design.rules.activeRosterIds);
const activeOperators = (design) => design.operators.filter((op) => activeIds(design).has(op.chessId));
const HANDOVER_HEADER = '| 干员／方向 | 获得时自带的交接凭证与限制 |';

export function writeHandoverTable(design, doc) {
  const active = activeIds(design);
  const rows = design.operators.filter((op) => active.has(op.chessId) && op.inheritance).map((op) =>
    `| ${op.name} · ${op.inheritance.direction === '给予' ? '可被继承' : '可继承其他干员'} | ${op.inheritance.gear}。${op.inheritance.limit} |`);
  const lines = doc.split('\n'); const start = lines.indexOf(HANDOVER_HEADER);
  if (start < 0) throw new Error('design.md has no handover table');
  let end = start + 2;
  while (end < lines.length && lines[end].startsWith('| ')) end++;
  lines.splice(start + 2, end - start - 2, ...rows);
  return lines.join('\n');
}

/** Rows of the doc that differ from the data: [{ name, doc, data }] (doc null when the operator has no row). */
export function tableDiff(design = JSON.parse(readFileSync(DESIGN, 'utf8')), doc = readFileSync(DOC, 'utf8')) {
  const lines = doc.split('\n');
  return activeOperators(design).map((op) => ({ name: op.name, doc: lines.find((l) => l.startsWith(`| ${tableCell(`${op.name} · 科技等级${op.tier}\n原技能：${op.skill}`)} |`)) ?? null, data: operatorRow(op) }))
    .filter((x) => x.doc !== x.data);
}

/** Rebuild the six generated tier tables, preserving all content outside those table blocks. */
export function writeOperatorTable(design, doc) {
  const active = [...activeOperators(design)].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, 'zh-CN'));
  const lines = doc.split('\n');
  const sectionStart = lines.indexOf('## 完整干员表');
  if (sectionStart < 0) throw new Error('design.md has no 完整干员表 section');
  for (let tier = 6; tier >= 1; tier--) {
    let sectionEnd = lines.findIndex((line, i) => i > sectionStart && line.startsWith('## '));
    if (sectionEnd < 0) sectionEnd = lines.length;
    const heading = `### 科技等级${tier}`;
    const start = lines.indexOf(heading, sectionStart);
    if (start < 0 || start >= sectionEnd) throw new Error(`design.md has no table for tier ${tier}`);
    let next = lines.findIndex((line, i) => i > start && (line.startsWith('### ') || line.startsWith('## ')));
    if (next < 0 || next > sectionEnd) next = sectionEnd;
    const header = lines.findIndex((line, i) => i > start && i < next && line === '| 干员／科技等级 | 普通与精锐自有特质 | 职责与资格 |');
    if (header < 0 || lines[header + 1] !== '| --- | --- | --- |') throw new Error(`tier ${tier} table header not found`);
    let blockEnd = header + 2;
    while (blockEnd < next && lines[blockEnd] !== '') blockEnd++;
    const tierRows = active.filter((op) => Number(op.tier) === tier).map(operatorRow);
    lines.splice(header + 2, blockEnd - header - 2, ...tierRows);
  }
  const result = lines.join('\n');
  return writeHandoverTable(design, result);
}

function main() {
  const mode = process.argv[2];
  const design = JSON.parse(readFileSync(DESIGN, 'utf8'));
  if (mode === 'write') {
    const doc = readFileSync(DOC, 'utf8');
    const out = writeOperatorTable(design, doc);
    writeFileSync(DOC, out);
    console.log(JSON.stringify({ written: activeOperators(design).length, removedInactive: design.operators.filter((op) => !activeIds(design).has(op.chessId)).length, doc: DOC }));
  } else if (mode === 'check') {
    const diff = tableDiff(design);
    console.log(JSON.stringify({ operators: activeOperators(design).length, differing: diff.map((x) => x.name), doc: DOC, data: DESIGN }));
    if (diff.length) process.exitCode = 1;
  } else throw new Error('usage: independent-design-table.mjs check|write');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
