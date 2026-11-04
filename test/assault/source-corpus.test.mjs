// test/assault/source-corpus.test.mjs
//
// 只做必要的机械真实性测试：真实一条表记录、小型缺失引用、大小写独立名称、
// JSON Pointer 可回读、可获得过滤/技能模板/类型去重、肉鸽收藏品分类。
// 不做自我镜像测试：涉及真实语料的断言只读取 source-root 原始文件。

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildArknightsCorpus,
  buildBazaarCards,
  buildBazaarCorpus,
  compareCardSkillsAndSkillsGenerated,
  buildRoguelikeCorpus,
  classifyArknightsEntity,
  isObtainableOperator,
  isCollectibleType,
  escapePointerToken,
  unescapePointerToken,
  pointerOf,
  joinPointer,
  readPointer,
  parseArgs,
} from '../../tools/assault/source-corpus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources';
const SOURCE_ROOT = process.env.ASSAULT_SOURCE_ROOT || DEFAULT_SOURCE_ROOT;

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(SOURCE_ROOT, rel), 'utf8'));
}

// ---------------------------------------------------------------------------
// JSON Pointer 可回读
// ---------------------------------------------------------------------------

test('JSON Pointer escapes ~ and / and round-trips nested values', () => {
  const token = 'a/b~c';
  const escaped = escapePointerToken(token);
  assert.equal(escaped, 'a~1b~0c');
  assert.equal(unescapePointerToken(escaped), token);

  const root = { 'a/b~c': { list: [{ 'x/y': 42 }] } };
  const ptr = pointerOf('a/b~c', 'list', 0, 'x/y');
  assert.equal(ptr, '/a~1b~0c/list/0/x~1y');
  const back = readPointer(root, ptr);
  assert.equal(back.found, true);
  assert.equal(back.value, 42);

  const joined = joinPointer(pointerOf('a/b~c'), 'list', 0);
  assert.equal(joined, '/a~1b~0c/list/0');
  assert.equal(readPointer(root, '/a~1b~0c/list/1').found, false);
});

// ---------------------------------------------------------------------------
// 真实一条表记录 + 引用闭合
// ---------------------------------------------------------------------------

test('real character_table record for char_002_amiya is indexed with real fields', { skip: !existsSync(path.join(SOURCE_ROOT, 'arknights/excel/character_table.json')) }, () => {
  const characterTable = loadJson('arknights/excel/character_table.json');
  const skillTable = loadJson('arknights/excel/skill_table.json');
  const rangeTable = loadJson('arknights/excel/range_table.json');
  const uniequipTable = loadJson('arknights/excel/uniequip_table.json');
  const battleEquipTable = loadJson('arknights/excel/battle_equip_table.json');
  const charPatchTable = loadJson('arknights/excel/char_patch_table.json');
  const charMetaTable = loadJson('arknights/excel/char_meta_table.json');

  const result = buildArknightsCorpus({
    characterTable, skillTable, rangeTable, uniequipTable, battleEquipTable, charPatchTable, charMetaTable,
    paths: {
      characterTable: path.join(SOURCE_ROOT, 'arknights/excel/character_table.json'),
      skillTable: path.join(SOURCE_ROOT, 'arknights/excel/skill_table.json'),
      rangeTable: path.join(SOURCE_ROOT, 'arknights/excel/range_table.json'),
      uniequipTable: path.join(SOURCE_ROOT, 'arknights/excel/uniequip_table.json'),
      battleEquipTable: path.join(SOURCE_ROOT, 'arknights/excel/battle_equip_table.json'),
      charPatchTable: path.join(SOURCE_ROOT, 'arknights/excel/char_patch_table.json'),
      charMetaTable: path.join(SOURCE_ROOT, 'arknights/excel/char_meta_table.json'),
    },
  });

  // 分类计数来自真实表：1375 实体、429 可获得。按 profession 分类：
  // TOKEN 74 / TRAP 843 / character 458（与 id 前缀 token_ 73 / trap_ 844 不同）。
  assert.equal(result.classification.allEntities, 1375);
  assert.equal(result.classification.obtainableOperators, 429);
  assert.equal(result.classification.tokens, 74);
  assert.equal(result.classification.traps, 843);
  assert.equal(result.tokens.length, 74);
  assert.equal(result.traps.length, 843);
  assert.equal(result.classification.characters, 458);
  assert.equal(result.classification.nonObtainableCharacters, 29);

  const amiya = result.operators.find((o) => o.charId === 'char_002_amiya');
  assert.ok(amiya, 'char_002_amiya must be indexed');
  assert.equal(amiya.name, '阿米娅');
  assert.equal(amiya.rarity, 'TIER_5');
  assert.equal(amiya.profession, 'CASTER');
  assert.equal(amiya.subProfessionId, 'corecaster');
  assert.ok(amiya.skillIds.includes('skchr_amiya_2'));
  assert.equal(amiya.phaseCount, 3);
  assert.deepEqual(amiya.keyFrameCounts, [2, 2, 2]);
  assert.ok(amiya.talents.length >= 1);

  // pointer 回读同一真实记录
  const record = readPointer(characterTable, amiya.pointers.record);
  assert.equal(record.found, true);
  assert.equal(record.value.name, '阿米娅');
  assert.equal(record.value.profession, 'CASTER');

  // 真实语料引用闭合：无缺失
  assert.equal(result.missingReferences.length, 0);
  assert.equal(result.integrity.skillTemplates.missing, 0);
  assert.equal(result.integrity.growthSources.operatorsMissingKeyFrames.length, 0);

  // 额外多职业形态来自 patchChars，且不在 character_table
  const extra = result.extraForms.map((f) => f.charId);
  assert.ok(extra.includes('char_1001_amiya2'));
  assert.ok(extra.includes('char_1037_amiya3'));
  assert.equal(characterTable['char_1001_amiya2'], undefined);
});

// ---------------------------------------------------------------------------
// 小型缺失引用
// ---------------------------------------------------------------------------

test('missing skill / range / module references are listed per operator', () => {
  const characterTable = {
    char_test_1: {
      name: '测试干员',
      rarity: 'TIER_6',
      profession: 'WARRIOR',
      subProfessionId: 'sword',
      isNotObtainable: false,
      nationId: 'rhodes',
      groupId: null,
      teamId: null,
      position: 'MELEE',
      tagList: [],
      mainPower: { nationId: 'rhodes', groupId: null, teamId: null },
      subPower: [],
      skills: [{ skillId: 'skill_ok', unlockCond: { phase: 'PHASE_0', level: 1 } }, { skillId: 'skill_missing', unlockCond: null }],
      phases: [
        { rangeId: 'range_ok', attributesKeyFrames: [{ level: 1, data: {} }] },
        { rangeId: 'range_missing', attributesKeyFrames: [{ level: 1, data: {} }] },
      ],
      talents: [{ candidates: [{ prefabKey: '1', name: '天赋', blackboard: [] }] }],
      trait: { prefabKey: 't', rangeId: 'trait_range_missing', candidates: [] },
      allSkillLvlup: [{ unlockCond: {}, lvlUpCost: [] }],
    },
  };
  const skillTable = { skill_ok: { skillId: 'skill_ok', levels: [{ prefabId: 'p', rangeId: null }] } };
  const rangeTable = { range_ok: { id: 'range_ok', grids: [] } };
  const uniequipTable = {
    charEquip: { char_test_1: ['mod_ok', 'mod_no_battle', 'mod_absent'] },
    equipDict: {
      mod_ok: { uniEquipId: 'mod_ok', charId: 'char_test_1', type: 'X' },
      mod_no_battle: { uniEquipId: 'mod_no_battle', charId: 'char_test_1', type: 'Y' },
    },
  };
  const battleEquipTable = { mod_ok: { phases: [] } };

  const result = buildArknightsCorpus({
    characterTable, skillTable, rangeTable, uniequipTable, battleEquipTable,
    charPatchTable: { patchChars: {}, infos: {} },
    charMetaTable: { charIdMasterListMap: {}, charMasterDataMap: {} },
    paths: {},
  });

  assert.equal(result.classification.obtainableOperators, 1);
  const kinds = result.missingReferences.map((m) => m.kind).sort();
  assert.deepEqual(kinds, [
    'module-not-in-battle-equip',
    'module-not-in-equipDict',
    'phase-range',
    'skill-missing',
    'trait-range',
  ]);
  // 干员项不含缺失副本，缺失集中在顶层列表
  assert.equal(result.operators[0].missingReferences, undefined);
  assert.equal(result.missingReferences.find((m) => m.kind === 'skill-missing').skillId, 'skill_missing');
  assert.equal(result.missingReferences.find((m) => m.kind === 'module-not-in-battle-equip').moduleId, 'mod_no_battle');
  assert.equal(result.missingReferences.find((m) => m.kind === 'module-not-in-equipDict').moduleId, 'mod_absent');
});

// ---------------------------------------------------------------------------
// 可获得过滤 / 实体分类
// ---------------------------------------------------------------------------

test('classification separates token, trap, obtainable and non-obtainable', () => {
  const token = { profession: 'TOKEN', isNotObtainable: false };
  const trap = { profession: 'TRAP', isNotObtainable: false };
  const npc = { profession: 'MEDIC', isNotObtainable: true };
  const op = { profession: 'MEDIC', isNotObtainable: false };
  assert.equal(classifyArknightsEntity(token), 'token');
  assert.equal(classifyArknightsEntity(trap), 'trap');
  assert.equal(classifyArknightsEntity(npc), 'character');
  assert.equal(isObtainableOperator(npc), false);
  assert.equal(isObtainableOperator(op), true);
});

// ---------------------------------------------------------------------------
// 大小写独立名称
// ---------------------------------------------------------------------------

test('names differing only by case stay independent entries', () => {
  const cards = {
    Katana: { id: 'id-upper', name: 'Katana', type: 'Item', raw_effects: {} },
    katana: { id: 'id-lower', name: 'katana', type: 'Item', raw_effects: {} },
  };
  const result = buildBazaarCards(cards, 'cards.json');
  assert.equal(result.total, 2);
  assert.equal(result.byType.Item, 2);
  assert.equal(result.gaps.noAbilities.count, 2);
  assert.deepEqual(result.gaps.noAbilities.allIds.sort(), ['id-lower', 'id-upper']);
});

// ---------------------------------------------------------------------------
// 技能集合比较：不简单加总
// ---------------------------------------------------------------------------

test('cards skills and skills_generated compare by native id without summing', () => {
  const cards = {
    A: { id: 'shared', name: 'A', type: 'Skill', raw_effects: { abilities: {} } },
    B: { id: 'cards-only', name: 'B', type: 'Skill', raw_effects: { abilities: {} } },
    C: { id: 'item-1', name: 'C', type: 'Item', raw_effects: {} },
  };
  const generated = {
    A: { id: 'shared', internal_name: 'A', name: 'A', type: 'Skill', heroes: ['X'], tags: [], description: 'd' },
    D: { id: 'gen-only', internal_name: 'D', name: 'D', type: 'Skill', heroes: ['Y'], tags: [], description: 'd' },
    Bad: { id: 'bad', name: 'Bad' },
  };
  const cmp = compareCardSkillsAndSkillsGenerated(cards, generated, {});
  assert.equal(cmp.cardSkillCount, 2);
  assert.equal(cmp.skillsGeneratedCount, 3);
  assert.equal(cmp.sameIdCount, 1);
  assert.equal(cmp.onlyInCardsCount, 1);
  assert.equal(cmp.onlyInSkillsGeneratedCount, 2);
  assert.equal(cmp.unionCount, 4);
  assert.equal(cmp.arithmeticSum, 5);
  assert.notEqual(cmp.unionCount, cmp.arithmeticSum);
  assert.ok(cmp.onlyInCards.includes('cards-only'));
  assert.ok(cmp.onlyInSkillsGenerated.includes('gen-only'));
  assert.equal(cmp.generatedMissingFields.length, 1);
});

// ---------------------------------------------------------------------------
// 肉鸽收藏品分类
// ---------------------------------------------------------------------------

test('roguelike collectibles are only items of native RELIC type', () => {
  assert.equal(isCollectibleType('RELIC'), true);
  assert.equal(isCollectibleType(9), true);
  assert.equal(isCollectibleType('RECRUIT_TICKET'), false);

  const topicTable = {
    topics: { rogue_1: {} },
    details: {
      rogue_1: {
        items: {
          relic_a: { id: 'relic_a', type: 'RELIC', name: '收藏品A' },
          relic_b: { id: 'relic_b', type: 9, name: '收藏品B' },
          ticket_a: { id: 'ticket_a', type: 'RECRUIT_TICKET' },
          band_a: { id: 'band_a', type: 'BAND' },
        },
        relics: { relic_a: { id: 'relic_a', buffs: [{ key: 'x', blackboard: [] }] }, relic_b: { id: 'relic_b', buffs: [] } },
        relicParams: { relic_a: { id: 'relic_a' } },
        choices: { c1: { id: 'c1', nextSceneId: 'missing_scene' } },
        choiceScenes: { s1: { id: 's1' } },
      },
    },
  };
  const result = buildRoguelikeCorpus(topicTable, { itemTable: { items: {} } }, {});
  const topic = result.topics.rogue_1;
  assert.equal(topic.collectibles.count, 2);
  assert.deepEqual(topic.collectibles.ids.sort(), ['relic_a', 'relic_b']);
  assert.equal(topic.notCollectible.byType.RECRUIT_TICKET.count, 1);
  assert.equal(topic.notCollectible.byType.BAND.count, 1);
  assert.equal(topic.relicEffects.relics, 2);
  assert.equal(topic.relicEffects.relicsWithoutBuffsCount, 1);
  assert.equal(topic.events.choicesMissingNextScene.length, 1);
  assert.equal(topic.events.choicesMissingNextScene[0].nextSceneId, 'missing_scene');
  // 条件/消耗/概率缺失要明确 unknown
  assert.ok(result.unknown.some((u) => u.includes('condition')));
});

// ---------------------------------------------------------------------------
// CLI 参数契约
// ---------------------------------------------------------------------------

test('CLI rejects unknown args and relative paths', () => {
  assert.throws(() => parseArgs(['--source-root', 'C:/a', '--index', 'C:/b', '--operators', 'C:/c', '--receipt', 'C:/d', '--bogus', 'x']), /unknown argument/);
  assert.throws(() => parseArgs(['--source-root', 'relative', '--index', 'C:/b', '--operators', 'C:/c', '--receipt', 'C:/d']), /absolute path/);
  assert.throws(() => parseArgs(['--source-root', 'C:/a', '--index', 'C:/b', '--operators', 'C:/c']), /missing required argument/);
  const ok = parseArgs(['--source-root', 'C:/a', '--index=C:/b', '--operators', 'C:/c', '--receipt', 'C:/d']);
  assert.equal(ok.index, 'C:/b');
  assert.equal(ok['source-root'], 'C:/a');
});
