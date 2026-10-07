import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tableDiff, writeOperatorTable } from '../../tools/independent-design-table.mjs';

const designPath = process.env.SP_INDEPENDENT_DESIGN_PATH || new URL('../../data/independent-design.json', import.meta.url);
const design = JSON.parse(readFileSync(designPath, 'utf8'));
const docPath = new URL('../../docs/independent-mode/design.md', import.meta.url);

test('design table diff is scoped to the 101 active operators', () => {
  const active = design.operators.filter((op) => op.active !== false);
  assert.equal(active.length, 101);
  const synced = writeOperatorTable(design, readFileSync(docPath, 'utf8'));
  assert.deepEqual(tableDiff(design, synced), []);
  for (const op of design.operators.filter((x) => x.active === false)) {
    assert.ok(!synced.split('\n').some((line) => line.startsWith(`| ${op.name} · 科技等级`)), op.name);
  }
});

test('write replaces stale active data, adds missing rows and preserves non-table prose', () => {
  const original = readFileSync(docPath, 'utf8');
  const inactive = design.operators.find((op) => op.active === false);
  const tierHeader = `### 科技等级${inactive.tier}\n\n| 干员／科技等级 | 普通与精锐自有特质 | 职责与资格 |\n| --- | --- | --- |`;
  const modified = original.replace(/\| 角峰 · 科技等级[^\n]*/, '| 角峰 · 科技等级1<br>stale | stale | stale |')
    .replace(tierHeader, `${tierHeader}\n| ${inactive.name} · 科技等级${inactive.tier}<br>legacy | legacy | legacy |`)
    .replace(/\| 锡人 · 科技等级[^\n]*\n/, '');
  const out = writeOperatorTable(design, modified);
  assert.match(out, /\| 角峰 · 科技等级1<br>原技能：/);
  assert.match(out, /## 本次定下的规则/);
  assert.doesNotMatch(out, new RegExp(`\\| ${inactive.name} · 科技等级`));
  assert.match(out, /\| 锡人 · 科技等级/);
  assert.deepEqual(tableDiff(design, out), []);
});

test('handover table tracks the two automatic permits and preserves retired IDs', () => {
  const out = writeOperatorTable(design, readFileSync(docPath, 'utf8'));
  const automatic=design.operators.filter(x=>x.inheritance&&x.inheritance.autoGrant!==false).map(x=>[x.name,x.tier]).sort();
  assert.deepEqual(automatic,[['幽灵鲨',3],['蛇屠箱',4]]);
  assert.equal(design.operators.filter(x=>x.inheritance).length,12);
  assert.match(out,/幽灵鲨/);
  assert.match(out,/蛇屠箱/);
});
