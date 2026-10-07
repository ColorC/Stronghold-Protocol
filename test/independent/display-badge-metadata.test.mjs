import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { independentDisplayCatalog } from '../../server/modes/independent/display.js';

test('all fifteen badge projection records expose a Chinese stat name and ratio metadata', () => {
  const data = getData({ log: { warn() {}, error() {}, info() {} } });
  const catalog = getCatalog(data);
  const display = independentDisplayCatalog(data, catalog);
  const badges = Object.entries(display.gear).filter(([, item]) => item.kind === 'badge');
  assert.equal(badges.length, 15);
  for (const [id, badge] of badges) {
    assert.equal(typeof badge.statName, 'string', `${id} has a stat label`);
    assert.ok(badge.statName.length > 0, `${id} has a non-empty stat label`);
    assert.equal(badge.ratio, true, `${id} is a ratio/percentage-point stat`);
  }
  assert.equal(display.gear.precision.statName, '基础攻击力');
  assert.match(display.gear.precision.normal, /2%/);
  assert.equal(display.gear.vitality.statName, '基础最大生命值');
  assert.match(display.gear.vitality.normal, /3%/);
  assert.equal(display.gear.arcane.statName, '法术伤害减免');
});

test('projection retains existing badge text and body-penalty metadata', () => {
  const data = getData({ log: { warn() {}, error() {}, info() {} } });
  const catalog = getCatalog(data);
  const display = independentDisplayCatalog(data, catalog);
  assert.equal(display.gear.assault.normal, data['independent-game-text'].gear.assault.normal);
  assert.deepEqual(display.rules.bodyPenalty, { baseAttackRatio: 0.8, baseLifeRatio: 0.8 });
  assert.deepEqual(Object.keys(display.gear.assault).sort(), [
    'available', 'identityFactions', 'inheritable', 'kind', 'level', 'mechanism', 'name', 'normal', 'ratio', 'sourceId', 'stat', 'statName', 'steamLimit', 'steamOptions', 'unique', 'value',
  ].sort());
});
