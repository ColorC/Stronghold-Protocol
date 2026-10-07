#!/usr/bin/env node
// The operator table of docs/independent-mode/design.md (完整干员表) is a copy of data/independent-design.json: one
// row per operator with its two trait texts, its role note and its 交接凭证 line. This keeps the two from drifting:
//   node tools/independent-design-table.mjs check   → lists rows that differ from the data (exit 1 when any)
//   node tools/independent-design-table.mjs write   → rewrites every operator row from the data
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const DESIGN = resolve(ROOT, 'data/independent-design.json');
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

/** Rows of the doc that differ from the data: [{ name, doc, data }] (doc null when the operator has no row). */
export function tableDiff(design = JSON.parse(readFileSync(DESIGN, 'utf8')), doc = readFileSync(DOC, 'utf8')) {
  const lines = doc.split('\n');
  return design.operators.map((op) => ({ name: op.name, doc: lines.find((l) => l.startsWith(`| ${op.name} · 科技等级`)) ?? null, data: operatorRow(op) }))
    .filter((x) => x.doc !== x.data);
}

function main() {
  const mode = process.argv[2];
  const design = JSON.parse(readFileSync(DESIGN, 'utf8'));
  if (mode === 'write') {
    const lines = readFileSync(DOC, 'utf8').split('\n');
    for (const op of design.operators) {
      const i = lines.findIndex((l) => l.startsWith(`| ${op.name} · 科技等级`));
      if (i < 0) throw new Error(`design.md has no row for ${op.name}`);
      lines[i] = operatorRow(op);
    }
    writeFileSync(DOC, lines.join('\n'));
    console.log(JSON.stringify({ written: design.operators.length, doc: DOC }));
  } else if (mode === 'check') {
    const diff = tableDiff(design);
    console.log(JSON.stringify({ operators: design.operators.length, differing: diff.map((x) => x.name), doc: DOC, data: DESIGN }));
    if (diff.length) process.exitCode = 1;
  } else throw new Error('usage: independent-design-table.mjs check|write');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
