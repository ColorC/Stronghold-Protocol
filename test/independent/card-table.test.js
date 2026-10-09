// The owner's editable card tables (tools/independent-card-table.mjs): exported from the data, read back as changed cells.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardTable, cardTableDiff, INACTIVE_OPERATOR_IDS, ROSTER_KINDS } from '../../tools/independent-card-table.mjs';
import { gearSourcesBlock } from '../../tools/independent-gear-sources.mjs';
import { fileURLToPath } from 'node:url';

// In a sparse worktree, resolve formal data through the same explicit override as the runtime.
process.env.SP_INDEPENDENT_DESIGN_PATH ||= process.env.SP_DATA_DIR
  ? `${process.env.SP_DATA_DIR}\\independent-design.json`
  : fileURLToPath(new URL('../../data/independent-design.json', import.meta.url));

test('the operator table has every operator once, with a known kind; an untouched table reads back unchanged', () => {
  const t = cardTable('operators');
  assert.equal(t.schema, 'workshop.table/v1');
  assert.equal(t.rows.length, 101);
  assert.equal(new Set(t.rows.map((r) => r.id)).size, 101);
  for (const r of t.rows) assert.ok(ROSTER_KINDS.includes(r.kind), `${r.name}: ${r.kind}`);
  assert.deepEqual(cardTableDiff('operators', structuredClone(t)), []);
  const legacy = structuredClone(t);
  const [inactiveId] = INACTIVE_OPERATOR_IDS;
  legacy.rows.push({ id: inactiveId, name: 'legacy inactive' });
  assert.deepEqual(cardTableDiff('operators', legacy), []);
});

test('active flags and primary grouping match the authoritative active roster and authored delivery rules', () => {
  const design = JSON.parse(readFileSync(process.env.SP_INDEPENDENT_DESIGN_PATH, 'utf8'));
  const activeIds = new Set(design.rules.activeRosterIds);
  assert.equal(activeIds.size, 101);
  assert.ok(design.operators.every((op) => op.active === activeIds.has(op.chessId)), 'retained rows are explicitly inactive');
  assert.ok(design.operators.filter((op) => activeIds.has(op.chessId)).every((op) => op.roster && ROSTER_KINDS.includes(op.roster)), 'every active row has one supported primary grouping');
  assert.equal(design.operators.find((op) => op.name === '梅尔').roster, '生成', 'combat summon is grouped by its authored summon effect');
  assert.equal(design.operators.find((op) => op.name === '香草').roster, '成长', 'permanent growth is grouped by its authored delivery');
});

test('the editable operator table exposes the six source-effect groupings', () => {
  assert.deepEqual(ROSTER_KINDS, ['成长', '生成', '经济', '辅助', '战斗', '交接']);
});

test('generated gear sources do not list any inactive operator', () => {
  const block = gearSourcesBlock();
  const design = JSON.parse(readFileSync(process.env.SP_INDEPENDENT_DESIGN_PATH, 'utf8'));
  const sourceNames = new Set(block.split('\n').flatMap((line) => {
    const row = line.match(/^- \*\*[^*]+\*\*：(.+)$/);
    return row ? row[1].split('、').map((name) => name.trim()) : [];
  }));
  for (const op of design.operators.filter((x) => x.active === false)) assert.ok(!sourceNames.has(op.name), op.name);
});

test('an edited cell, an added row and a removed row are all reported', () => {
  const t = structuredClone(cardTable('operators'));
  t.rows[0].tier = '2';
  t.rows[1].remark = '加强一点';
  const removed = t.rows.pop();
  t.rows.push({ id: '', name: '新干员' });
  const d = cardTableDiff('operators', t);
  assert.ok(d.some((c) => c.key === 'tier' && c.id === t.rows[0].id && c.now === '2'));
  assert.ok(d.some((c) => c.key === 'remark' && c.now === '加强一点'));
  assert.ok(d.some((c) => c.title === '删除的行' && c.id === removed.id));
  assert.ok(d.some((c) => c.title === '新行'));
});

test('the gear table lists each piece once with its state', () => {
  const t = cardTable('gear');
  assert.equal(new Set(t.rows.map((r) => r.id)).size, t.rows.length);
  for (const r of t.rows) assert.ok(['在用', '停产', '待分配'].includes(r.state), r.name);
});
