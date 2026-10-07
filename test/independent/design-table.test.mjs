import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tableDiff, writeOperatorTable } from '../../tools/independent-design-table.mjs';

const designPath = process.env.SP_INDEPENDENT_DESIGN_PATH || new URL('../../data/independent-design.json', import.meta.url);
const design = JSON.parse(readFileSync(designPath, 'utf8'));
const docPath = new URL('../../docs/independent-mode/design.md', import.meta.url);

test('design table diff is scoped to the 101 active operators', () => {
  const activeIds = new Set(design.rules.activeRosterIds);
  const active = design.operators.filter((op) => activeIds.has(op.chessId));
  assert.equal(active.length, 101);
  const synced = writeOperatorTable(design, readFileSync(docPath, 'utf8'));
  assert.deepEqual(tableDiff(design, synced), []);
  for (const op of design.operators.filter((x) => !activeIds.has(x.chessId))) {
    assert.ok(!synced.split('\n').some((line) => line.startsWith(`| ${op.name} · 科技等级`)), op.name);
  }
});

test('write replaces stale active data, adds missing rows and preserves non-table prose', () => {
  const original = readFileSync(docPath, 'utf8');
  const activeIds = new Set(design.rules.activeRosterIds);
  const inactive = design.operators.find((op) => !activeIds.has(op.chessId));
  const current = design.operators.find((op) => activeIds.has(op.chessId));
  const missing = design.operators.find((op) => activeIds.has(op.chessId) && op.chessId !== current.chessId);
  const tierHeader = `### 科技等级${inactive.tier}\n\n| 干员／科技等级 | 普通与精锐自有特质 | 职责与资格 |\n| --- | --- | --- |`;
  const modified = original.replace(new RegExp(`\\| ${current.name} · 科技等级[^\\n]*`), `| ${current.name} · 科技等级${current.tier}<br>stale | stale | stale |`)
    .replace(tierHeader, `${tierHeader}\n| ${inactive.name} · 科技等级${inactive.tier}<br>legacy | legacy | legacy |`)
    .replace(new RegExp(`\\| ${missing.name} · 科技等级[^\\n]*\\n`), '');
  const out = writeOperatorTable(design, modified);
  assert.ok(out.split('\n').some((line) => line.startsWith(`| ${current.name} · 科技等级${current.tier}<br>原技能：`)));
  assert.match(out, /## 本次定下的规则/);
  assert.doesNotMatch(out, new RegExp(`\\| ${inactive.name} · 科技等级`));
  assert.ok(out.split('\n').some((line) => line.startsWith(`| ${missing.name} · 科技等级${missing.tier}<br>原技能：`)));
  assert.deepEqual(tableDiff(design, out), []);
});

test('handover table tracks the two automatic permits and preserves retired IDs', () => {
  const out = writeOperatorTable(design, readFileSync(docPath, 'utf8'));
  const automatic=design.operators.filter(x=>x.inheritance&&x.inheritance.autoGrant!==false).map(x=>[x.name,x.tier]).sort();
  assert.deepEqual(automatic,[['蛇屠箱',4],['赫默',3]]);
  assert.equal(design.legacyPermissions.length,12, 'all 12 historic permissions remain attached to their original source records');
  assert.equal(design.operators.filter(x=>x.active && x.inheritance?.autoGrant).length,2);
  assert.match(out,/幽灵鲨/);
  assert.match(out,/蛇屠箱/);
});
