import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { traitSummary, TRAIT_WHEN } from '../../server/modes/independent/summary.js';
import { independentDisplayCatalog } from '../../server/modes/independent/http.js';

const data = getData({ log: { info() {}, warn() {}, error() {} } });
const catalog = getCatalog(data);

test('every rule of all 224 trait forms gets a classified summary entry with known items', () => {
  const gear = new Set([...Object.keys(catalog.badges), ...Object.keys(catalog.equipment)]);
  for (const op of Object.values(catalog.operators)) {
    const rules = [...op.nativeTrait.effect.prep, ...op.nativeTrait.effect.combat];
    const summary = traitSummary(op.nativeTrait.effect);
    assert.equal(summary.length, rules.length, op.name);
    for (const entry of summary) {
      assert.ok(TRAIT_WHEN[entry.when], `${op.name}: moment ${entry.when} has a label`);
      assert.notEqual(entry.kind, 'other', `${op.name}: ${JSON.stringify(entry)}`);
      for (const item of entry.items || []) if (item.id !== null) assert.ok(gear.has(item.id), `${op.name}: ${item.id}`);
    }
  }
});

test('each form reads its own counts: an elite form uses its own catalog entry', () => {
  const display = independentDisplayCatalog(data, catalog);
  const find = (name, elite) => Object.values(display.operators).find((x) => x.name === name && !!x.elite === elite);
  const undertaker = find('送葬人', false); const undertakerElite = find('送葬人', true);
  assert.equal(undertaker.summary[0].items[0].normal, 1);
  assert.equal(undertakerElite.summary[0].items[0].elite, 2);
  assert.equal(display.operators[undertaker.eliteChessId].name, '送葬人');
  assert.equal(find('薄绿', true).summary[0].items[0].elite, 2);
  assert.equal(find('薄绿', false).summary[0].faction, '维多利亚');
  assert.match(undertaker.traitTexts.elite, /2件拉特兰跳弹模块/);
  assert.deepEqual(display.rules.bodyPenalty, { baseAttackRatio: 0.8, baseLifeRatio: 0.8 });
});
