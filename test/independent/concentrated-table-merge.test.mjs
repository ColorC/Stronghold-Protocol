import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTables } from '../../tools/merge-workshop-concentrated-table.mjs';

const columns = [{ key: 'section', title: '内容', width: 95 }, { key: 'normal', title: '普通效果', width: 460 }];
const table = (rows, title = 'baseline') => ({ schema: 'workshop.table/v1', title, columns, rows });

test('incremental Workshop merge updates only generated cells still matching baseline', () => {
  const base = table([
    { section: '干员', level: '科技1', name: '甲', normal: '旧规则', role: '旧定位', nativePower: '用户保留' },
    { section: '装备', level: '装备1', name: '乙', normal: '未变', basis: '基线说明' },
  ]);
  const next = table([
    { ...base.rows[0], normal: '新规则', role: '新定位', nativePower: '不应覆盖' },
    { ...base.rows[1], basis: '新依据' },
  ]);
  const current = table([
    { ...base.rows[0], normal: '用户手改', role: '旧定位', nativePower: '用户保留' },
    { ...base.rows[1] },
  ], '用户表标题');

  const { merged, report } = mergeTables(base, next, current);
  assert.equal(merged.title, '用户表标题');
  assert.equal(merged.columns[1].width, 460);
  assert.deepEqual(merged.rows.map((row) => row.name), ['甲', '乙']);
  assert.equal(merged.rows[0].normal, '用户手改');
  assert.equal(merged.rows[0].role, '新定位');
  assert.equal(merged.rows[0].nativePower, '用户保留');
  assert.equal(merged.rows[1].basis, '新依据');
  assert.deepEqual(report.counts, { liveRows: 2, baselineRows: 2, generatedRows: 2, changedCells: 2, preservedManualCells: 1, addedLiveRows: 0, missingCurrentRows: 0, rowsAbsentFromGenerated: 0 });
});

test('incremental merge reports rows missing live and does not add or reorder rows', () => {
  const base = table([{ section: '干员', level: '科技1', name: '甲', normal: '旧' }, { section: '干员', level: '科技2', name: '乙', normal: '旧' }]);
  const next = table([{ ...base.rows[0], normal: '新' }, { ...base.rows[1], normal: '新' }]);
  const current = table([{ ...base.rows[1], normal: '旧' }]);
  const { merged, report } = mergeTables(base, next, current);
  assert.deepEqual(merged.rows.map((row) => row.name), ['乙']);
  assert.equal(merged.rows[0].normal, '新');
  assert.equal(report.counts.missingCurrentRows, 1);
});

test('rows added by Workshop users stay in place and are reported', () => {
  const base = table([{ section: '徽章', level: '装备1', name: '甲', normal: '旧' }]);
  const next = table([{ ...base.rows[0], normal: '新' }]);
  const custom = { section: '徽章', level: '装备1', name: '兼容徽章', normal: '手工内容' };
  const current = table([custom, base.rows[0]]);
  const { merged, report } = mergeTables(base, next, current);
  assert.deepEqual(merged.rows.map((row) => row.name), ['兼容徽章', '甲']);
  assert.deepEqual(merged.rows[0], custom);
  assert.equal(report.counts.addedLiveRows, 1);
  assert.equal(report.addedLiveRows[0].row.normal, '手工内容');
});
