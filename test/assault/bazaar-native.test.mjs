// test/assault/bazaar-native.test.mjs
//
// 定向机械测试：稀疏 tier 继承、标准价格、Data 数组行、tooltip 占位未知、
// 精确引用回读、latest 新类型 MusicNoteSocketEffect 与 8 件 patch 19 物品、
// 以及真实 DB 分类 / 全部 ID 去重 / 缺失指针不静默丢失。
// 只读真实官方 DB；缺库时跳过真实语料断言，不伪造。

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildIndex,
  buildTierView,
  normalizeDataEntities,
  standardPrice,
  resolveTooltipTemplate,
  readPointer,
  readDatabase,
  parseArgs,
  loadReceipts,
  escapePointerToken,
  unescapePointerToken,
  pointerOf,
  TIER_ORDER,
  PATCH19_ITEMS,
} from '../../tools/assault/bazaar-native.mjs';

const DEFAULT_DB = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/bazaar/official-GameData.db';
const DB_PATH = process.env.ASSAULT_BAZAAR_DB || DEFAULT_DB;
const RECEIPT_PATH = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/assault/bazaar-native-index.json';
const HAS_DB = existsSync(DB_PATH);

const STANDARD_PRICES = {
  ItemBuyPrices: { Small: { Bronze: 2, Silver: 4 }, Medium: { Bronze: 4, Silver: 8 } },
  ItemSellPrices: { Small: { Bronze: 1, Silver: 2 }, Medium: { Bronze: 2, Silver: 4 } },
  SkillBuyPrices: { Medium: { Bronze: 5, Silver: 10 } },
  SkillSellPrices: { Medium: { Bronze: 2, Silver: 5 } },
};

// ---------------------------------------------------------------------------
// 稀疏 tier 继承 + 毫秒转秒
// ---------------------------------------------------------------------------

test('sparse tier inheritance keeps explicit vs inherited cooldown and attributes', () => {
  const card = {
    Type: 'Item',
    Size: 'Small',
    StartingTier: 'Bronze',
    Tiers: {
      Bronze: { Attributes: { CooldownMax: 5000, Multicast: 1, Custom_0: 5 }, AbilityIds: ['0'], AuraIds: [], TooltipIds: [0] },
      Silver: { Attributes: { Custom_0: 10 }, AbilityIds: ['0'], AuraIds: [], TooltipIds: [0] },
      Gold: { Attributes: { Custom_0: 20 }, AbilityIds: ['0'], AuraIds: [], TooltipIds: [] },
    },
  };
  const view = buildTierView(card, STANDARD_PRICES);
  assert.equal(view.applicable, true);
  assert.deepEqual(view.present, ['Bronze', 'Silver', 'Gold']);
  assert.deepEqual(view.tierOrder, TIER_ORDER);

  // Bronze 无更低 tier，全部显式
  assert.equal(view.entries.Bronze.cd.src, 'explicit');
  assert.equal(view.entries.Bronze.cd.s, 5);
  assert.equal(view.entries.Bronze.attrs.Custom_0, 5);

  // Silver 继承 CooldownMax/Multicast，Custom_0 显式
  assert.equal(view.entries.Silver.cd.src, 'inherited');
  assert.equal(view.entries.Silver.cd.from, 'Bronze');
  assert.equal(view.entries.Silver.cd.s, 5);
  assert.equal(view.entries.Silver.attrs.CooldownMax, 5000);
  assert.equal(view.entries.Silver.attrs.Custom_0, 10);
  assert.ok(view.entries.Silver.inh.includes('CooldownMax'));
  assert.ok(!view.entries.Silver.inh.includes('Custom_0'));

  // Gold 继续继承
  assert.equal(view.entries.Gold.cd.src, 'inherited');
  assert.equal(view.entries.Gold.attrs.Multicast, 1);
});

test('does not synthesize a lower tier that is absent in Data.Tiers', () => {
  const card = { Type: 'Item', Size: 'Medium', StartingTier: 'Silver', Tiers: { Silver: { Attributes: {}, AbilityIds: [], AuraIds: [], TooltipIds: [] }, Gold: { Attributes: {}, AbilityIds: [], AuraIds: [], TooltipIds: [] } } };
  const view = buildTierView(card, STANDARD_PRICES);
  assert.deepEqual(view.present, ['Silver', 'Gold']);
  assert.equal(view.entries.Bronze, undefined);
  // 没有更低 tier 可继承 -> unknown，不得当 0
  assert.equal(view.entries.Silver.cd.src, 'unknown');
  assert.equal(view.entries.Silver.cd.s, undefined);
});

// ---------------------------------------------------------------------------
// 标准价格默认 + 精确 tier 覆盖
// ---------------------------------------------------------------------------

test('standard prices used only when no exact card override; empty is not zero', () => {
  assert.equal(standardPrice(STANDARD_PRICES, 'Item', 'buy', 'Small', 'Silver'), 4);
  assert.equal(standardPrice(STANDARD_PRICES, 'Skill', 'sell', 'Medium', 'Silver'), 5);
  // 缺失默认 -> null，不是 0
  assert.equal(standardPrice(STANDARD_PRICES, 'Item', 'buy', 'Large', 'Silver'), null);

  const noOverride = { Type: 'Item', Size: 'Small', Tiers: { Silver: { Attributes: {}, AbilityIds: [], AuraIds: [], TooltipIds: [] } } };
  const v1 = buildTierView(noOverride, STANDARD_PRICES);
  assert.equal(v1.entries.Silver.buy.src, 'standard');
  assert.equal(v1.entries.Silver.buy.v, 4);
  assert.equal(v1.entries.Silver.sell.v, 2);

  const explicitZero = { Type: 'Item', Size: 'Small', Tiers: { Bronze: { Attributes: { SellPrice: 0 }, AbilityIds: [], AuraIds: [], TooltipIds: [] }, Silver: { Attributes: {}, AbilityIds: [], AuraIds: [], TooltipIds: [] } } };
  const v2 = buildTierView(explicitZero, STANDARD_PRICES);
  assert.equal(v2.entries.Bronze.sell.src, 'explicit');
  assert.equal(v2.entries.Bronze.sell.v, 0);
  // Silver 继承 Bronze 的 SellPrice=0，而不是回退标准价 2
  assert.equal(v2.entries.Silver.sell.src, 'inherited');
  assert.equal(v2.entries.Silver.sell.v, 0);

  const inheritedBuy = { Type: 'Item', Size: 'Medium', Tiers: { Bronze: { Attributes: { BuyPrice: 99 }, AbilityIds: [], AuraIds: [], TooltipIds: [] }, Gold: { Attributes: { Custom_0: 1 }, AbilityIds: [], AuraIds: [], TooltipIds: [] } } };
  const v3 = buildTierView(inheritedBuy, STANDARD_PRICES);
  assert.equal(v3.entries.Gold.buy.src, 'inherited');
  assert.equal(v3.entries.Gold.buy.from, 'Bronze');
  assert.equal(v3.entries.Gold.buy.v, 99);
});

// ---------------------------------------------------------------------------
// Data 数组 / 字典 / 单对象
// ---------------------------------------------------------------------------

test('Data arrays are expanded per element; object dictionaries per key', () => {
  const arr = normalizeDataEntities('album', [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }]);
  assert.equal(arr.length, 3);
  assert.deepEqual(arr.map((e) => e.pointer), ['/0', '/1', '/2']);
  assert.deepEqual(arr.map((e) => e.entity.Id), ['a', 'b', 'c']);
  assert.equal(arr[0].rowIsArray, true);

  const single = normalizeDataEntities('x', { $type: 'T', Id: 'only' });
  assert.equal(single.length, 1);
  assert.equal(single[0].pointer, '');

  const dict = normalizeDataEntities('tooltips', { Charge: { Id: 'Charge' }, Burn: { Id: 'Burn' } });
  assert.equal(dict.length, 2);
  assert.deepEqual(dict.map((e) => e.pointer).sort(), ['/Burn', '/Charge']);
});

// ---------------------------------------------------------------------------
// tooltip 占位：能解析逐 tier 填值，不能解析保留 unknown
// ---------------------------------------------------------------------------

test('tooltip placeholders resolve per tier or keep unknown with reason', () => {
  const scope = {
    abilities: {
      0: { Action: { $type: 'TActionCardModifyAttribute', Value: { $type: 'TReferenceValueCardAttribute', AttributeType: 'Custom_0', Modifier: { ModifyMode: 'Multiply', Value: { $type: 'TFixedValue', Value: 2 }, ShouldRound: true } }, TargetCount: 3 } },
      1: { Action: { $type: 'TActionCardFreeze', Value: null, TargetCount: null } },
    },
    auras: {},
  };
  const r = resolveTooltipTemplate('Gain {ability.0} and hit {ability.0.targets}; {ability.1} unknown', scope, { Custom_0: 5 });
  const byToken = Object.fromEntries(r.tokens.map((t) => [t.token, t]));
  assert.equal(byToken['ability.0'].resolved, true);
  assert.equal(byToken['ability.0'].value, 10); // 5 * 2
  assert.equal(byToken['ability.0.targets'].value, 3);
  assert.equal(byToken['ability.1'].resolved, false);
  assert.equal(byToken['ability.1'].reason, 'action.value.absent');
  // 未解占位保留在文本里，不伪造
  assert.ok(r.text.includes('{ability.1}'));
  assert.equal(r.complete, false);
});

// ---------------------------------------------------------------------------
// JSON Pointer
// ---------------------------------------------------------------------------

test('pointer helpers escape and round-trip', () => {
  assert.equal(escapePointerToken('a/b~c'), 'a~1b~0c');
  assert.equal(unescapePointerToken('a~1b~0c'), 'a/b~c');
  const root = { 'a/b': [{ 'x~y': 7 }] };
  const p = pointerOf('a/b', 0, 'x~y');
  assert.equal(p, '/a~1b/0/x~0y');
  assert.deepEqual(readPointer(root, p), { found: true, value: 7 });
  assert.equal(readPointer(root, '/a~1b/9').found, false);
});

// ---------------------------------------------------------------------------
// CLI 参数契约
// ---------------------------------------------------------------------------

test('CLI rejects unknown args, relative paths, missing args', () => {
  assert.throws(() => parseArgs(['--database', 'C:/a', '--out', 'C:/b', '--receipt', 'C:/c', '--bogus', 'x']), /unknown argument/);
  assert.throws(() => parseArgs(['--database', 'relative', '--out', 'C:/b', '--receipt', 'C:/c']), /absolute path/);
  assert.throws(() => parseArgs(['--database', 'C:/a', '--out', 'C:/b']), /missing required argument/);
  const ok = parseArgs(['--database=C:/a', '--out', 'C:/b', '--receipt', 'C:/c']);
  assert.equal(ok.database, 'C:/a');
});

// ---------------------------------------------------------------------------
// 真实官方 DB
// ---------------------------------------------------------------------------

let cached = null;
function loadIndex() {
  if (!cached) {
    if (!HAS_DB) return null;
    const tables = readDatabase(DB_PATH);
    const receipts = existsSync(RECEIPT_PATH) ? loadReceipts(RECEIPT_PATH, DB_PATH) : {};
    cached = { index: buildIndex({ dbPath: DB_PATH, tables, receipts }), tables };
  }
  return cached;
}

test('real DB table classification matches latest public library', { skip: !HAS_DB }, () => {
  const loaded = loadIndex();
  const { index } = loaded;
  const types = index.official.tables.cards.types;
  assert.equal(index.official.tables.cards.databaseRows, 3375);
  assert.equal(index.official.tables.cards.records, 3375);
  assert.equal(types.TCardItem, 1430);
  assert.equal(types.TCardSkill, 573);
  assert.equal(types.TCardEncounterEvent, 554);
  assert.equal(types.TCardEncounterStep, 582);
  assert.equal(types.TCardEncounterCombat, 181);
  assert.equal(index.official.tables.monsters.databaseRows, 176);
  assert.equal(index.official.tables.collectibles.databaseRows, 8);
  assert.equal(index.official.tables.collectibles.records, 1636);
  assert.equal(index.official.tables.seasons.databaseRows, 20);
});

test('latest new card type and eight patch 19 item ids are verified', { skip: !HAS_DB }, () => {
  const { index } = loadIndex();
  assert.equal(index.official.tables.cards.types.TCardMusicNoteSocketEffect, 7);
  assert.equal(index.official.latest.newCardTypes.TCardMusicNoteSocketEffect, 7);
  assert.equal(index.official.latest.patch19PresentCount, 8);
  assert.equal(index.official.latest.patch19Total, 8);
  const byId = new Map(index.official.cards.map((c) => [c.id, c]));
  for (const [name, id] of Object.entries(PATCH19_ITEMS)) {
    const card = byId.get(id);
    assert.ok(card, `${name} (${id}) must exist`);
    assert.equal(card.cardType, 'TCardItem');
    assert.equal(card.internalName, name);
  }
});

test('all entity ids dedup and no missing sourceRef pointers', { skip: !HAS_DB }, () => {
  const { index } = loadIndex();
  assert.equal(index.official.identity.duplicateIdCount, 0);
  assert.equal(index.official.identity.distinctIds, 5287);
  const groups = [index.official.cards, index.official.monsters, index.official.collectibles];
  for (const group of groups) {
    for (const e of group) {
      assert.equal(typeof e.sourceRef.database, 'string');
      assert.equal(e.sourceRef.database, DB_PATH);
      assert.ok(e.sourceRef.table);
      assert.ok(e.sourceRef.rowId !== undefined);
      assert.equal(typeof e.sourceRef.pointer, 'string');
    }
  }
  // 每个怪物都保留原生 HealthMax 与 TemplateId
  for (const m of index.official.monsters) {
    assert.ok(m.player && 'healthMax' in m.player);
    for (const it of [...m.player.hand.items, ...m.player.stash.items]) assert.ok('templateId' in it && 'instanceId' in it);
  }
});

test('reference checks are complete: resolved + missing == referenced, each missing has pointer', { skip: !HAS_DB }, () => {
  const { index } = loadIndex();
  const refs = index.official.references;
  for (const key of ['abilityIds', 'auraIds', 'tooltipIds']) {
    const r = refs[key];
    assert.equal(r.resolved + r.missing.length, r.referenced, `${key} accounting`);
    for (const miss of r.missing) assert.ok(miss.pointer, `${key} missing must keep pointer`);
  }
  for (const key of ['monsterItemTemplates', 'monsterSkillTemplates']) {
    const r = refs[key];
    assert.equal(r.resolved + r.missing.length, r.total, `${key} accounting`);
    for (const miss of r.missing) assert.ok(miss.pointer, `${key} missing must keep pointer`);
  }
  // InstanceId 不能当 TemplateId：怪物道具缺失项必须给出原因
  for (const miss of refs.monsterItemTemplates.missing) assert.ok(typeof miss.reason === 'string' && miss.reason.length > 0);
  // 缺失引用保留在输出里（本库确实存在未解析项）
  assert.ok(refs.monsterItemTemplates.missing.length > 0);
  assert.ok(refs.abilityIds.missing.length > 0);
});

test('precise reference readback: card sourceRef pointer resolves to same id and ability $type', { skip: !HAS_DB }, () => {
  const loaded = loadIndex();
  const { index, tables } = loaded;
  const dragon = index.official.cards.find((c) => c.id === PATCH19_ITEMS['Dragon Harp']);
  assert.ok(dragon);
  const row = tables.cards.find((r) => String(r.rowId) === String(dragon.rowId));
  const data = JSON.parse(row.dataText);
  const back = readPointer(data, dragon.sourceRef.pointer);
  assert.equal(back.found, true);
  assert.equal(back.value.Id, dragon.id);

  // ability 指针 + effectCatalog 精确回读
  assert.ok(dragon.abilities.length > 0);
  const ab = dragon.abilities[0];
  const structure = index.official.effectCatalog[ab.e];
  assert.ok(structure);
  if (structure.trigger) {
    const trigger = readPointer(data, `${dragon.sourceRef.pointer}/Abilities/${ab.k}/Trigger/$type`);
    assert.equal(trigger.found, true, 'ability trigger pointer must resolve');
    assert.equal(trigger.value, structure.trigger);
  }
  if (structure.action) {
    const action = readPointer(data, `${dragon.sourceRef.pointer}/Abilities/${ab.k}/Action/$type`);
    assert.equal(action.found, true, 'ability action pointer must resolve');
    assert.equal(action.value, structure.action);
  }
});

test('array table row (collectibles) expands and pointer reads back the element', { skip: !HAS_DB }, () => {
  const loaded = loadIndex();
  const { index, tables } = loaded;
  assert.equal(index.official.tables.collectibles.byRow.album, index.official.collectibles.filter((c) => c.rowId === 'album').length);
  const album = index.official.collectibles.find((c) => c.rowId === 'album' && c.sourceRef.pointer === '/0');
  assert.ok(album, 'album row element 0 indexed');
  const row = tables.collectibles.find((r) => String(r.rowId) === 'album');
  const data = JSON.parse(row.dataText);
  assert.ok(Array.isArray(data));
  const back = readPointer(data, album.sourceRef.pointer);
  assert.equal(back.found, true);
  assert.equal(back.value.Id, album.id);
  // 数组行必须逐个展开，pointer 为元素索引
  assert.match(album.sourceRef.pointer, /^\/\d+$/);
});

test('real tier inheritance + standard price resolution present in DB', { skip: !HAS_DB }, () => {
  const { index } = loadIndex();
  const cards = index.official.cards.filter((c) => c.tiers.applicable);
  const inherited = cards
    .flatMap((c) => Object.entries(c.tiers.entries).map(([tier, e]) => ({ c, tier, e })))
    .filter((x) => x.e.cd.src === 'inherited');
  assert.ok(inherited.length > 0, 'at least one inherited CooldownMax');
  const sample = inherited[0];
  assert.ok(sample.e.inh.includes('CooldownMax'));
  assert.notEqual(sample.e.cd.from, sample.tier);
  assert.equal(typeof sample.e.cd.s, 'number');

  const standard = cards
    .flatMap((c) => Object.values(c.tiers.entries))
    .filter((e) => (e.buy.src === 'standard' || e.sell.src === 'standard'));
  assert.ok(standard.length > 0, 'standard price fallback used in real data');
  // 标准价必须来自 game_modes.StandardPrices，不是 0 占位
  const sp = index.official.standardPrices;
  assert.ok(sp && sp.ItemBuyPrices && sp.ItemSellPrices);
  const stdBuy = standard.find((e) => e.buy.src === 'standard');
  assert.equal(typeof stdBuy.buy.v, 'number');
  assert.ok(stdBuy.buy.std);
});

test('hero starts come from Start Run events, at least five heroes readable', { skip: !HAS_DB }, () => {
  const { index } = loadIndex();
  const hs = index.official.heroStarts;
  assert.ok(hs.eventCount >= 5);
  assert.ok(hs.distinctHeroes.length >= 5);
  assert.ok(hs.distinctHeroes.includes('Mak'));
  for (const ev of hs.events) {
    assert.ok(ev.sourceRef.pointer !== undefined);
    assert.ok(ev.selectionContext !== undefined);
  }
  assert.equal(hs.startingResources.status, 'unknown');
});

test('version evidence uses data field + receipt + source, and flags stale receipt', { skip: !HAS_DB }, () => {
  const { index } = loadIndex();
  assert.equal(index.official.nativeVersion, '5.0.0');
  assert.equal(index.official.versionEvidence.sourceUrl, 'https://data.playthebazaar.com/static/GameData.db.zip');
  assert.ok(index.unknown.some((u) => u.includes('5.0.0')));
  assert.ok(index.unknown.some((u) => u.includes('patch19 物品核实 8/8')));
  // 旧 official 回执与当前库不一致必须显式列出，不静默
  assert.ok(index.unknown.some((u) => u.includes('旧回执')));
});
