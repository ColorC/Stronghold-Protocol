import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryStacks } from '../../public/js/independent/model.js';
import { gearGlyphOf, GEAR_GLYPHS } from '../../public/js/independent/gearGlyphs.js';

const catalog = { gear: { precision: { name: '攻击徽章', kind: '徽章' }, whistle: { name: '叙拉古狼嚎哨' } } };
test('same-name inventory cells hold at most 999 and retain actionable source quantities', () => {
  const cells = inventoryStacks([{ uid: 'i1', id: 'precision', quantity: 600 }, { uid: 'i2', id: 'precision', quantity: 600 }], catalog);
  assert.deepEqual(cells.map((x) => x.count), [999, 201]);
  assert.deepEqual(cells[0].items.map((x) => [x.uid, x.quantity]), [['i1', 600], ['i2', 399]]);
  assert.deepEqual(cells[1].items.map((x) => [x.uid, x.quantity]), [['i2', 201]]);
  assert.equal(new Set(cells.map((x) => x.key)).size, 2);
});
test('legacy oversized quantities stay visible and usable in multiple cells', () => {
  const cells = inventoryStacks([{ uid: 'i7', id: 'whistle', quantity: 2000 }], catalog);
  assert.deepEqual(cells.map((x) => x.count), [999, 999, 2]);
  assert.ok(cells.every((x) => x.items[0].uid === 'i7'));
});
test('different equipment state stays in different cells; equal state ignores object key order', () => {
  const cells = inventoryStacks([
    { uid: 'i1', id: 'whistle', quantity: 2, state: { charges: 1, faction: '炎' } },
    { uid: 'i2', id: 'whistle', quantity: 3, state: { faction: '炎', charges: 1 } },
    { uid: 'i3', id: 'whistle', quantity: 2, state: { charges: 2, faction: '炎' } },
  ], catalog);
  assert.deepEqual(cells.map((x) => x.count), [5, 2]);
  assert.equal(new Set(cells.map((x) => x.key)).size, 2);
  const singletons = inventoryStacks([
    { uid: 'i4', id: 'whistle', quantity: 1, state: { uniqueState: true } },
    { uid: 'i5', id: 'whistle', quantity: 1, state: { uniqueState: true } },
  ], catalog);
  assert.equal(singletons.length, 2);
});
test('workshop equipment silhouettes distinguish key functions without character placeholders', () => {
  assert.equal(gearGlyphOf('叙拉古狼嚎哨'), 'whistle');
  assert.equal(gearGlyphOf('炎国缚锁'), 'chain');
  assert.equal(gearGlyphOf('莱塔尼亚共鸣音叉'), 'fork');
  assert.equal(gearGlyphOf('阿戈尔深潜锚钩'), 'anchor');
  assert.equal(gearGlyphOf('罗德岛便携锻炉'), 'forge');
  for (const path of Object.values(GEAR_GLYPHS)) assert.match(path, /^M/);
});
