import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const readJson = (path) => JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'));
const gameText = readJson('data/independent-game-text.json');
const blueprints = readJson('data/independent-darkmoon-blueprints.json').entries;
const { getData } = await import(new URL('../../server/data.js', import.meta.url));
const { getCatalog } = await import(new URL('../../server/modes/independent/catalog.js', import.meta.url));
const { independentDisplayCatalog } = await import(new URL('../../server/modes/independent/display.js', import.meta.url));
const { DARKMOON_COMBAT_RULES, darkmoonCombatMetadata } = await import(new URL('../../server/sim/content/independent/darkmoonCombat.js', import.meta.url));

test('deployment and knockout descriptions disclose the per-source battle cap', () => {
  const data = getData();
  const display = independentDisplayCatalog(data, getCatalog(data));
  const sourceOps = Object.values(display.operators).filter((op) => op.sourceRefs?.darkmoon19_2 && !op.elite);
  const missing = [];
  for (const op of sourceOps) {
    const id = op.sourceRefs.darkmoon19_2.id;
    if (!DARKMOON_COMBAT_RULES[id]?.retire) continue;
    const copy = gameText.operators[op.baseChessId];
    for (const form of ['normal', 'elite', 'normalLevels', 'eliteLevels']) {
      if (!String(copy?.[form] || '').includes('每场最多触发3次')) missing.push(`${id}/${form}`);
    }
  }
  assert.deepEqual(missing, [], 'all current retirement/deployment payload descriptions include their actual three-activation cap');
  assert.equal(darkmoonCombatMetadata('BGS_012', false).trigger, '战斗部署时', '缪尔赛思 display metadata describes deployment, not the original source-card deathrattle');
  const bgs008Copy = gameText.operators['chess_native_char_4155_talr_a'].normal;
  assert.match(bgs008Copy, /招募获得或首次上阵时，自身装备突袭盟约×1/);
  assert.match(bgs008Copy, /被击倒时召唤2名随机带有战斗部署效果干员的作战投影；每场最多触发3次/);
  assert.equal((bgs008Copy.match(/突袭盟约/g) || []).length, 1, 'the acquisition grant appears once');
  assert.doesNotMatch(bgs008Copy, /装备装备|获得时装备/);
});

test('adaptation metadata trigger labels agree with the executable combat handler', () => {
  const byId = new Map(blueprints.map((entry) => [entry.sourceId, entry]));
  for (const [sourceId] of Object.entries(DARKMOON_COMBAT_RULES)) {
    const entry = byId.get(sourceId);
    assert.ok(entry, `${sourceId} blueprint exists`);
    for (const [form, elite] of [['normal', false], ['elite', true]]) {
      const expected = darkmoonCombatMetadata(sourceId, elite)?.trigger;
      const deliveryRows = entry.metadata?.op?.effectDelivery?.[form] || [];
      const delivery = deliveryRows.find((row) => row.sourceTrigger === 'darkmoonCombat');
      // Several sources in DARKMOON_COMBAT_RULES are adapted through distinct
      // gain/summon handlers; only assert combat-trigger labels for rows that
      // are actually delivered by this adapter.
      if (!delivery) continue;
      const authored = entry.authoredRule?.[form]?.trigger;
      assert.equal(authored, expected, `${sourceId}/${form} authored adaptation trigger`);
      assert.equal(delivery.trigger, expected, `${sourceId}/${form} effect delivery trigger`);
      assert.equal(delivery.triggerLabel, expected, `${sourceId}/${form} effect delivery label`);
    }
  }
});

test('copy separates badge growth from levels growth and avoids duplicate claims', () => {
  const data = getData();
  const display = independentDisplayCatalog(data, getCatalog(data));
  const modeLeaks = Object.values(display.operators).filter((op) => !op.elite).flatMap((op) => {
    const t = op.traitTexts || [];
    return [/徽章/.test(t.normalLevels || '') || /徽章/.test(t.eliteLevels || '') ? op.name + ':badge-in-levels' : null,
      /训练等级/.test(t.normal || '') || /训练等级/.test(t.elite || '') ? op.name + ':levels-in-badges' : null].filter(Boolean);
  });
  assert.deepEqual(modeLeaks, [], 'all active operator copy variants stay within their selected growth mode');
  const byId = new Map(blueprints.map((entry) => [entry.sourceId, entry]));
  const aromo = gameText.operators[byId.get('BGS_075').operatorChessId] || Object.values(gameText.operators).find((entry) => entry.name === '阿罗玛');
  assert.ok(aromo, '阿罗玛 game copy exists');
  for (const form of ['normal', 'elite', 'normalLevels', 'eliteLevels']) {
    assert.doesNotMatch(aromo[form], /招募具有战斗部署效果的干员时/, `${form} must not repeat the same acquisition trigger`);
  }
  assert.match(aromo.normalLevels, /训练等级×2/);
  assert.match(aromo.eliteLevels, /训练等级×4/);
  assert.doesNotMatch(aromo.normalLevels + aromo.eliteLevels, /徽章/);

  const chongyue = Object.values(gameText.operators).find((entry) => entry.name === '重岳');
  assert.ok(chongyue, '重岳 game copy exists');
  assert.match(chongyue.normalLevels, /元素科技等级两倍的训练等级/g);
  assert.match(chongyue.eliteLevels, /所购干员科技等级两倍的训练等级/);
  assert.match(chongyue.eliteLevels, /结算两次/);
  assert.match(chongyue.normal, /随机使一名场上友方干员获得等同于该元素科技等级的攻击徽章和伤害徽章/);
  assert.doesNotMatch(chongyue.normal + chongyue.elite, /所购干员星级/);
  assert.doesNotMatch(chongyue.normalLevels + chongyue.eliteLevels, /徽章/);

  assert.equal(gameText.gear['growth-training-record'].normal, '使用后，目标干员的训练等级提升1级；属性按其成长曲线计算。');
});

test('deployment-reactor text matches its other-unit faction scope in both modes', () => {
  for (const [sourceId, name, faction] of [['EX1_531', '普罗旺斯', '叙拉古'], ['GVG_106', '山', '哥伦比亚']]) {
    const source = blueprints.find((entry) => entry.sourceId === sourceId);
    const key = source?.operatorChessId || Object.keys(gameText.operators).find((id) => gameText.operators[id].name === name);
    const text = gameText.operators[key];
    assert.ok(text, `${name} game copy exists`);
    for (const form of ['normal', 'elite', 'normalLevels', 'eliteLevels']) {
      assert.match(text[form], new RegExp(`其他${faction}友方单位战斗部署时`), `${sourceId}/${form} excludes its own deployment and includes token actors`);
    }
  }
});
