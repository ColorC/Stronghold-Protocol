import test from 'node:test';
import assert from 'node:assert/strict';
import { eligiblePiecesForEffect } from '../../shared/independentEligibility.js';
import { independentDisplayCatalog } from '../../server/modes/independent/display.js';

const mkOp = (id, profession, faction, atk = 100) => ({ chessId: id, tier: 3, profession, nativeFactionTags: [faction], nativeFactions: [faction], nativeStats: { atk },
  source: { normalChess: { profession, bonds: [], stats: { atk } } } });
const realCatalog = () => ({ operators: {
  maker: mkOp('maker', 'SUPPORTER', '炎', 100), adjacent: mkOp('adjacent', 'MEDIC', '炎', 120),
  row: mkOp('row', 'WARRIOR', '叙拉古', 160), bench: mkOp('bench', 'MEDIC', '炎', 180), other: mkOp('other', 'MEDIC', '叙拉古', 90),
}, equipment: { tag: { id: 'tag', mechanism: 'identityTag' }, keyword: { id: 'keyword', mechanism: 'keywordGear', name: '冷却背心' } }, config: { tavernFactions: ['炎', '维多利亚', '叙拉古'] } });
const pieces = () => [
  { uid: 'maker', chessId: 'maker', row: 2, col: 2, dir: 'RIGHT', ownerId: 'p1', kind: 'op', equipment: [] },
  { uid: 'adjacent', chessId: 'adjacent', row: 2, col: 3, ownerId: 'p1', kind: 'op', equipment: [{ id: 'tag', quantity: 1, state: { faction: '维多利亚' } }, { id: 'keyword', quantity: 1, state: {} }] },
  { uid: 'row', chessId: 'row', row: 2, col: 5, ownerId: 'p1', kind: 'op', equipment: [] },
  { uid: 'bench', chessId: 'bench', row: null, col: null, ownerId: 'p1', kind: 'op', equipment: [] },
  { uid: 'other', chessId: 'other', row: 2, col: 1, ownerId: 'p2', kind: 'op', equipment: [] },
];
const ids = (effect, roster = pieces(), catalog = realCatalog(), source = roster[0]) => eligiblePiecesForEffect(effect, { pieces: roster, catalog, source }).map((x) => x.uid);

test('structured scopes report current self, faction, profession, keyword gear, adjacent, row, front and board-only operators', () => {
  const catalog = realCatalog(); const roster = pieces(); const source = roster[0];
  assert.deepEqual(ids({ behavior: 'target', params: { targets: 'self' } }, roster, catalog, source), ['maker']);
  assert.deepEqual(ids({ behavior: 'teamForge', params: { targets: 'faction:维多利亚', excludeSelf: true } }, roster, catalog, source), ['adjacent']);
  assert.deepEqual(ids({ behavior: 'teamForge', params: { targets: 'profession:MEDIC', excludeSelf: true } }, roster, catalog, source), ['adjacent']);
  assert.deepEqual(ids({ behavior: 'allyConditionStats', params: { match: { keywordGear: '冷却背心' } } }, roster, catalog, source), ['adjacent']);
  assert.deepEqual(ids({ behavior: 'teamForge', params: { targets: 'adjacent', excludeSelf: true } }, roster, catalog, source), ['adjacent']);
  assert.deepEqual(ids({ behavior: 'teamForge', params: { targets: 'row', excludeSelf: true } }, roster, catalog, source), ['adjacent', 'row']);
  assert.deepEqual(ids({ behavior: 'buff', params: { targets: 'front' } }, roster, catalog, source), ['adjacent']);
  assert.deepEqual(ids({ behavior: 'buff', params: { targets: ['self', 'adjacent'] } }, roster, catalog, source), ['maker', 'adjacent']);
  assert.deepEqual(ids({ behavior: 'buff', params: { targets: 'boardonly' } }, roster, catalog, source), ['maker', 'adjacent', 'row']);
  assert.deepEqual(ids({ behavior: 'buff', params: { targets: 'all', scope: 'bench' } }, roster, catalog, source), ['bench']);
});

test('display-shaped catalogs and state pieces yield the same faction/profession/gear names', () => {
  const full = realCatalog();
  const display = { operators: Object.fromEntries(Object.entries(full.operators).map(([id, op]) => [id, {
    chessId: id, name: id, profession: op.profession, nativeFactionTags: op.nativeFactionTags, nativeFactions: op.nativeFactions, nativeStats: op.nativeStats,
  }])), gear: Object.fromEntries(Object.entries(full.equipment).map(([id, gear]) => [id, gear])), equipment: full.equipment,
  config: full.config };
  const roster = pieces().map(({ equipment, ...piece }) => ({ ...piece, equipmentDetails: equipment.map((item) => ({ ...item, record: display.gear[item.id] })) }));
  assert.deepEqual(ids({ behavior: 'teamForge', params: { targets: 'faction:维多利亚', excludeSelf: true } }, roster, display, roster[0]), ['adjacent']);
  assert.deepEqual(ids({ behavior: 'teamForge', params: { targets: 'profession:MEDIC', excludeSelf: true } }, roster, display, roster[0]), ['adjacent']);
  assert.deepEqual(ids({ behavior: 'allyConditionStats', params: { match: { keywordGear: '冷却背心' } } }, roster, display, roster[0]), ['adjacent']);
});

test('conditional self rules and scopes respect own-player membership, deployment, and live position changes', () => {
  const catalog = realCatalog(); const roster = pieces(); const source = roster[0];
  assert.deepEqual(ids({ behavior: 'teamForge', params: { targets: 'all', excludeSelf: false } }, roster, catalog, source), ['maker', 'adjacent', 'row']);
  assert.deepEqual(ids({ behavior: 'teamForge', params: { targets: 'all', excludeSelf: true } }, roster, catalog, source), ['adjacent', 'row']);
  roster[1].col = 4;
  assert.deepEqual(ids({ behavior: 'teamForge', params: { targets: 'adjacent', excludeSelf: true } }, roster, catalog, source), []);
  roster[1].col = 3; roster[1].ownerId = 'p2';
  assert.deepEqual(ids({ behavior: 'teamForge', params: { targets: 'all', excludeSelf: false } }, roster, catalog, source), ['maker', 'row']);
});

test('base-stat eligibility uses selected native module stats and compares against the effect owner', () => {
  const catalog = realCatalog(); const roster = pieces(); const source = roster[0];
  catalog.operators.adjacent.source.normalChess.modules = [{ uniEquipId: 'strong', attr: { atk: 30 } }];
  roster[1].moduleId = 'strong';
  const effect = { behavior: 'allyConditionStats', params: { match: { baseStat: 'atk', minBaseStatRatioToSelf: 1.5 } } };
  assert.deepEqual(ids(effect, roster, catalog, source), ['adjacent', 'row']);
  roster[1].bodyPenaltyApplied = true;
  assert.deepEqual(ids(effect, roster, catalog, source), ['row']);
});

test('display projection retains normal and elite original-card text plus structured rules and delivery metadata', () => {
  const normal = { behavior: 'teamForge', trigger: 'prepEnd', params: { targets: 'front', excludeSelf: true } };
  const elite = { behavior: 'teamForge', trigger: 'prepEnd', params: { targets: 'row', excludeSelf: true } };
  const op = { chessId: 'demo_a', eliteChessId: 'demo_b', name: '测试干员', tier: 4, nativeTrait: { effect: { prep: [normal], combat: [] }, normalText: '普通特质', eliteText: '精锐特质' },
    effectDelivery: { normal: [{ trigger: 'prepEnd', recipient: 'target', duration: '当前休整', text: '普通接收说明' }], elite: [{ trigger: 'prepEnd', recipient: 'all', duration: '本场战斗', text: '精锐接收说明' }] },
    sourceRefs: { cards: { name: '原卡名称', version: 'v1', tier: 5, text: '<p>普通历史效果</p>', textElite: '<p>精锐历史效果</p>', sourceUrl: 'https://example.invalid/card' } },
    source: { normalChess: { profession: 'MEDIC', stats: { atk: 100 } }, eliteChess: { profession: 'MEDIC', stats: { atk: 200 } } } };
  const catalog = { name: 'test', operators: { demo_a: op, demo_b: { ...op, chessId: 'demo_b', elite: true, nativeTrait: { ...op.nativeTrait, effect: { prep: [elite], combat: [] } } } },
    badges: {}, equipment: {}, prizes: {}, attachments: {}, config: { tavernFactions: ['炎'] } };
  const display = independentDisplayCatalog({ chess: {}, assets: {} }, catalog, {});
  const view = display.operators.demo_a;
  assert.equal(view.sourceRefs.cards.text, '<p>普通历史效果</p>');
  assert.equal(view.sourceRefs.cards.textElite, '<p>精锐历史效果</p>');
  assert.equal(view.summary[0].rule.params.targets, 'front');
  assert.equal(view.summaryElite[0].rule.params.targets, 'row');
  assert.equal(view.summary[0].effectDelivery.recipient, 'target');
  assert.equal(view.summaryElite[0].effectDelivery.recipient, 'all');
});
