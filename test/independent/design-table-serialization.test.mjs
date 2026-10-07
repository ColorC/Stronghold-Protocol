import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { operatorRow, tableDiff, writeOperatorTable } from '../../tools/independent-design-table.mjs';

const op = (name, tier, role, active = true) => ({ name, tier, skill: '测试\n技能|一', active, nativeTrait: { normal: '普通\n特质|甲', elite: '精锐特质' }, role });
const fixture = {
  operators: [op('甲', 1, '职责\n含|竖线'), op('乙', 2, '第二职责'), op('旧干员', 1, '停用内容', false)],
};
const docFixture = () => [
  '# 保留的标题', '区外说明不应改变。', '', '## 交接凭证', '| 干员／方向 | 获得时自带的交接凭证与限制 |', '| --- | --- |', '', '## 完整干员表', '表内独有引言需保留。', '',
  ...Array.from({ length: 6 }, (_, i) => [`### 科技等级${i + 1}`, '本级说明需保留。', '| 干员／科技等级 | 普通与精锐自有特质 | 职责与资格 |', '| --- | --- | --- |', ...(i === 0 ? ['| 旧干员 · 科技等级1<br>原技能：旧 | 旧 | 旧 |', '破损续行'] : ['| 遗漏占位 | 旧 | 旧 |']), '']).flat(),
  '## 历史修订', '历史表与说明保留。', '| 历史 | 值 |', '',
].join('\n');

test('serializer keeps each row on one line and escapes cell delimiters', () => {
  const row = operatorRow(fixture.operators[0]);
  assert.equal(row.split('\n').length, 1);
  assert.match(row, /测试<br>技能\\\|一/);
  assert.match(row, /职责<br>含\\\|竖线/);
});

test('writer rebuilds only tier table blocks, removes inactive/missing rows, and is idempotent', () => {
  const before = docFixture();
  const after = writeOperatorTable(fixture, before);
  assert.equal(tableDiff(fixture, after).length, 0);
  assert.match(after, /表内独有引言需保留。/);
  assert.match(after, /本级说明需保留。/);
  assert.match(after, /区外说明不应改变。/);
  assert.match(after, /## 历史修订\n历史表与说明保留。\n\| 历史 \| 值 \|/);
  assert.doesNotMatch(after, /旧干员 · 科技等级|破损续行|遗漏占位/);
  const rows = after.split('\n').filter((line) => /^\| (甲|乙) · 科技等级/.test(line));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((line) => line.endsWith('|') && line.split('\n').length === 1));
  assert.equal(writeOperatorTable(fixture, after), after);
});

test('canonical candidate generates 101 active rows in expected tiers without writing the document', { skip: !process.env.SP_INDEPENDENT_DESIGN_PATH }, () => {
  const design = JSON.parse(readFileSync(process.env.SP_INDEPENDENT_DESIGN_PATH, 'utf8'));
  const source = readFileSync(new URL('../../docs/independent-mode/design.md', import.meta.url), 'utf8');
  const expected = [13, 19, 20, 18, 18, 13];
  assert.equal(design.operators.filter((entry) => entry.active !== false).length, 101);
  assert.deepEqual(expected.map((_, i) => design.operators.filter((entry) => entry.active !== false && Number(entry.tier) === i + 1).length), expected);
  const regenerated = writeOperatorTable(design, source);
  assert.deepEqual(tableDiff(design, regenerated), []);
  assert.equal(writeOperatorTable(design, regenerated), regenerated);
});
