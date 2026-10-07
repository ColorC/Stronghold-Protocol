// The owner's editable card tables (tools/independent-card-table.mjs): exported from the data, read back as changed cells.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardTable, cardTableDiff, ROSTER_KINDS } from '../../tools/independent-card-table.mjs';

test('the operator table has every operator once, with a known kind; an untouched table reads back unchanged', () => {
  const t = cardTable('operators');
  assert.equal(t.schema, 'workshop.table/v1');
  assert.equal(t.rows.length, 112);
  assert.equal(new Set(t.rows.map((r) => r.id)).size, 112);
  for (const r of t.rows) assert.ok(ROSTER_KINDS.includes(r.kind), `${r.name}: ${r.kind}`);
  assert.deepEqual(cardTableDiff('operators', structuredClone(t)), []);
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
