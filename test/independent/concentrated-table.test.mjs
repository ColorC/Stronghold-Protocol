import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTable } from '../../tools/independent-concentrated-table.mjs';
import { getCatalog } from '../../server/modes/independent/catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.resolve(process.env.SP_DATA_DIR || path.join(ROOT, 'data'));
const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
const design = read('independent-design.json');
const gameText = read('independent-game-text.json');
const chessData = read('chess.json');
const sourceReference = read('independent-source-reference.json');
const catalog = getCatalog();
const table = buildTable({ design, gameText, chessData, catalog, sourceReference, nativePower:read('independent-native-power.json') });
const bySection = (name) => table.rows.filter((row) => row.section === name);

test('concentrated table cites original cards, complete native text and probe limits', () => {
  assert.equal(table.columns.length, 15);
  assert.equal(bySection('干员').length, 101);
  assert.equal(bySection('七人阵容').length, 5);
  assert.ok(table.rows.filter((row) => row.section !== '敌人').every((row) => row.reference && row.reference !== '原卡来源待补'));
  assert.ok(bySection('干员').every((row) => row.nativePower.includes('实跑90秒') && row.nativePower.includes('控制、保护、阻挡和经济价值') && row.sourceNormal && row.sourceElite && row.levels && row.landing));
  assert.ok(table.rows.every((row) => !/(?:chess_(?:char|item)_|skchr_|independent:|token_\d+_|single_0_0|single_800_40|four_0_0|[0-9a-f]{40})/i.test(Object.values(row).join(' '))));

  const matterhorn = bySection('干员').find((row) => row.name === '白铁');
  const native = chessData[design.operators.find((op) => op.name === '白铁').chessId];
  for (const skill of native.skills) assert.ok(matterhorn.native.includes(String(skill.desc).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim()));
  for (const talent of native.talents) assert.ok(matterhorn.native.includes(String(talent.desc).replace(/<[^>]*>/g,'')));

  const warbands = bySection('七人阵容');
  for (const row of warbands) {
    const archetype = sourceReference.archetypes.find((item) => item.name === row.name);
    assert.ok(archetype);
    assert.equal(archetype.operators.length, 7);
    for (const member of archetype.operators) assert.ok(row.native.includes(member));
    assert.ok(row.basis.includes(archetype.chain));
    assert.ok(row.reference.includes('；'));
  }
  const victoria = warbands.find((row) => row.name === '炎国商店与招募成长');
  assert.ok(victoria.native.includes('安洁莉娜（科技5；中立成员'));
  assert.ok(victoria.basis.includes('中立成员（阵营按本体资料）：安洁莉娜'));
});

test('new games show only the two active auto-issued handover permits', () => {
  const permits = bySection('交接凭证');
  assert.deepEqual(permits.map((row) => [row.name, row.level]).sort(), [
    ['医疗装置交接单', '科技3'], ['重装器械适配单', '科技4'],
  ]);
  assert.ok(permits.every((row) => row.normal.includes('交出方或接收方') && row.upgrade.includes('无需凭证')));
  const wolf = table.rows.find((row) => row.name === '叙拉古狼嚎哨');
  assert.match(wolf.basis, /12次普通攻击.*0\.75秒.*8秒/);
  const melt = table.rows.find((row) => row.name === '便携式融毁教学仪');
  const airdrop = table.rows.find((row) => row.name === '反冲空降仓');
  assert.match(melt.basis, /六本装备/);
  assert.match(airdrop.basis, /六本装备/);
});

test('current table omits retired and unassigned equipment while keeping catalog-eligible legacy flags', () => {
  const equipmentRows = [...bySection('装备'), ...bySection('特供装备')];
  for (const row of equipmentRows) {
    const item = catalog.equipment[row.name] || Object.values(catalog.equipment).find((entry) => (entry.newName || entry.name) === row.name);
    assert.ok(item, `missing catalog item for ${row.name}`);
    assert.notEqual(item.retired, true, `${row.name} is retired`);
    assert.notEqual(item.unassigned, true, `${row.name} is unassigned`);
  }
  for (const name of ['调和识别牌', '源石促效溶剂', '应急伪装服', '催泪瓦斯组件', '谢拉格不融冰', '维多利亚蒸汽之心', '耶拉冈德之泪', '熔铸模具', '莱茵生命浮空发生器', '黑钢双联弹匣']) {
    assert.ok(!equipmentRows.some((row) => row.name === name), `${name} must not be a current issuance row`);
  }
});
