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
export const operatorRow = (op) => `| ${op.name} · 科技等级${op.tier}<br>原技能：${op.skill} | 普通：${op.nativeTrait.normal}<br>精锐：${op.nativeTrait.elite} | ${op.role}${permitLine(op) ? `<br>${permitLine(op)}` : ''} |`;

const activeOperators = (design) => design.operators.filter((op) => op.active !== false);
const HANDOVER_HEADER = '| 干员／方向 | 获得时自带的交接凭证与限制 |';

export function writeHandoverTable(design, doc) {
  const rows = design.operators.filter((op) => op.active !== false && op.inheritance).map((op) =>
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
  return activeOperators(design).map((op) => ({ name: op.name, doc: lines.find((l) => l.startsWith(`| ${op.name} · 科技等级`)) ?? null, data: operatorRow(op) }))
    .filter((x) => x.doc !== x.data);
}

/** Replace active operator rows, add missing current rows, remove retired rows, and leave surrounding prose intact. */
export function writeOperatorTable(design, doc) {
  const active = activeOperators(design);
  const activeByName = new Map(active.map((op) => [op.name, op]));
  const inactiveNames = new Set(design.operators.filter((op) => op.active === false).map((op) => op.name));
  const lines = doc.split('\n');
  const seen = new Set();
  const kept = [];
  for (const line of lines) {
    if (!line.startsWith('| ') || !line.includes(' · 科技等级')) { kept.push(line); continue; }
    const name = line.slice(2, line.indexOf(' · 科技等级'));
    const op = activeByName.get(name);
    if (op) { kept.push(operatorRow(op)); seen.add(name); }
    else if (!inactiveNames.has(name)) kept.push(line);
  }
  const missing = active.filter((op) => !seen.has(op.name));
  for (const op of missing) {
    const heading = kept.findIndex((line) => line === `### 科技等级${op.tier}`);
    if (heading < 0) throw new Error(`design.md has no table for tier ${op.tier}`);
    let tableEnd = heading + 1;
    while (tableEnd < kept.length && !kept[tableEnd].startsWith('## ') && !kept[tableEnd].startsWith('### ')) tableEnd++;
    let insertAt = tableEnd;
    for (let i = heading + 1; i < tableEnd; i++) if (kept[i].startsWith('| ') && kept[i].includes(' · 科技等级')) insertAt = i + 1;
    kept.splice(insertAt, 0, operatorRow(op));
  }
  return writeHandoverTable(design, kept.join('\n'));
}

function main() {
  const mode = process.argv[2];
  const design = JSON.parse(readFileSync(DESIGN, 'utf8'));
  if (mode === 'write') {
    const doc = readFileSync(DOC, 'utf8');
    const out = writeOperatorTable(design, doc);
    writeFileSync(DOC, out);
    console.log(JSON.stringify({ written: activeOperators(design).length, removedInactive: design.operators.filter((op) => op.active === false).length, doc: DOC }));
  } else if (mode === 'check') {
    const diff = tableDiff(design);
    console.log(JSON.stringify({ operators: activeOperators(design).length, differing: diff.map((x) => x.name), doc: DOC, data: DESIGN }));
    if (diff.length) process.exitCode = 1;
  } else throw new Error('usage: independent-design-table.mjs check|write');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
