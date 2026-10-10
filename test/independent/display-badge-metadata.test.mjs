import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { independentDisplayCatalog } from '../../server/modes/independent/display.js';
import { nativeFactions } from '../../shared/independentRules.js';

test('all sixteen badge projection records expose a Chinese stat name and ratio metadata', () => {
  const data = getData({ log: { warn() {}, error() {}, info() {} } });
  const catalog = getCatalog(data);
  const display = independentDisplayCatalog(data, catalog);
  const badges = Object.entries(display.gear).filter(([, item]) => item.kind === 'badge');
  assert.equal(badges.length, 16);
  assert.ok(badges.some(([id]) => id === 'damage'), 'the added damage badge remains part of the visible catalog');
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
    'available', 'iconItemId', 'identityFactions', 'inheritable', 'kind', 'level', 'mechanism', 'name', 'normal', 'normalLevels', 'quantityEquippable', 'ratio', 'sourceId', 'sourceRefs', 'stat', 'statName', 'steamLimit', 'steamOptions', 'unique', 'value',
  ].sort());
  assert.deepEqual(display.gear.assault.sourceRefs, catalog.badges.assault.sourceRefs, 'real reference card metadata remains available');
});

test('Texas retains her two roster factions and also qualifies for Siracusa effects', () => {
  const data = getData({ log: { warn() {}, error() {}, info() {} } });
  const catalog = getCatalog(data);
  const display = independentDisplayCatalog(data, catalog);
  const [texasId, texas] = Object.entries(display.operators).find(([, x]) => x.name === '缄默德克萨斯');
  assert.deepEqual(texas.nativeFactions, ['炎-龙门', '企鹅物流', '叙拉古']);
  assert.equal(Object.hasOwn(texas, 'originFactions'), false);
  assert.deepEqual(nativeFactions({ chessId: texasId }, catalog), ['炎-龙门', '企鹅物流', '叙拉古']);
  assert.equal(catalog.equipment['chess_item_6_11_e_a'].params.effects[0].params.requiresTag, '叙拉古');
});

test('Shu visible prep text matches the actual paired attack and damage badge growth', () => {
  const data = getData({ log: { warn() {}, error() {}, info() {} } });
  const catalog = getCatalog(data);
  const display = independentDisplayCatalog(data, catalog);
  const shu = display.operators.chess_native_char_2025_shu_a;
  assert.match(shu.traitTexts.normal, /攻击徽章×1及伤害徽章×1/);
  assert.match(shu.traitTexts.elite, /攻击徽章×2及伤害徽章×2/);
  assert.match(shu.traitTexts.normalLevels, /训练等级×2/);
  assert.match(shu.traitTexts.eliteLevels, /训练等级×4/);
  assert.doesNotMatch(shu.traitTexts.normalLevels + shu.traitTexts.eliteLevels, /徽章|基础攻击力训练等级|造成伤害训练等级/);
});
