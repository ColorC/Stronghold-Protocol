import test from 'node:test';
import assert from 'node:assert/strict';
import { eligiblePiecesForEffect, fieldConditionPiecesForEffect, hasConditionalTargets } from '../../shared/independentEligibility.js';
import { independentDisplayCatalog } from '../../server/modes/independent/display.js';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';

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
const fieldIds = (effect, roster = pieces(), catalog = realCatalog(), source = roster[0], more = {}) => fieldConditionPiecesForEffect(effect, { pieces: roster, catalog, source, ...more })?.map((x) => x.uid) ?? null;

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


test('source-card target growth uses the deployed native faction and reports same-owner candidates only',()=>{
  const effect={behavior:'darkmoonBattlecryTargetGrowth',params:{faction:'炎',attackUnits:{normal:2,elite:4}}};
  assert.equal(hasConditionalTargets(effect),true);
  assert.deepEqual(ids(effect),['maker','adjacent']);
  assert.deepEqual(ids({behavior:'darkmoonBoughtTribeTargetGrowth',params:{triggerFaction:'炎'}}),['maker','adjacent','row','bench']);
});
test('end-turn source effects distinguish other allies, active elites, count parameters and exact adjacent cells',()=>{
  assert.deepEqual(ids({behavior:'darkmoonEndTurnGrowth',params:{mode:'randomOtherFaction',faction:'炎'}}),['adjacent']);
  assert.deepEqual(ids({behavior:'darkmoonEndTurnGrowth',params:{mode:'randomDistinctFaction',targets:{normal:3,elite:3}}}),['maker','adjacent','row']);
  const roster=pieces();roster[1].elite=true;roster[3].elite=true;
  assert.deepEqual(ids({behavior:'darkmoonEndTurnGrowth',params:{mode:'selfIfGolden'}},roster),['adjacent']);
  assert.deepEqual(ids({behavior:'darkmoonAdjacentGrowth',params:{}}),['adjacent']);
});
test('purchase-faction conditions count currently owned native members including the bench without adding identity gear',()=>{
  const catalog=realCatalog();catalog.config.factionIdentityEquipment=false;
  assert.deepEqual(ids({behavior:'darkmoonShopGrowth',params:{faction:'炎'}},pieces(),catalog),['maker','adjacent','bench']);
  assert.deepEqual(ids({behavior:'darkmoonRosterTribePurchaseFunds',params:{faction:'维多利亚'}},pieces(),catalog),[]);
});

test('field-only display projection distinguishes no field condition from zero and excludes bench candidates',()=>{
  const catalog=realCatalog(),roster=pieces(),effect={behavior:'allyConditionStats',params:{match:{faction:'炎'},stats:{maxHpPercent:.1}}};
  assert.deepEqual(fieldIds(effect,roster,catalog,roster[0]),['adjacent']);
  const noMatch=roster.map(p=>({...p,chessId:'row'}));
  assert.deepEqual(fieldIds(effect,noMatch,catalog,noMatch[0]),[],'a field-conditioned effect may have zero visible matches');
  const future={behavior:'darkmoonShopGrowth',params:{faction:'炎'}};
  assert.equal(fieldConditionPiecesForEffect(future,{pieces:roster,catalog,source:roster[0]}),null,'future shop effects have no current field count');
  assert.equal(fieldConditionPiecesForEffect({behavior:'darkmoonRosterTribePurchaseFunds',params:{faction:'炎'}},{pieces:roster,catalog,source:roster[0]}),null);
  assert.equal(fieldConditionPiecesForEffect({behavior:'darkmoonPlayedTribeGrowth',params:{faction:'炎'}},{pieces:roster,catalog,source:roster[0]}),null,'played-trait scope is not assumed to be board-only');
});

test('field projection preserves exact faction, adjacency, row, source-exclusion, and aura range conditions',()=>{
  const catalog=realCatalog(),roster=pieces(),source=roster[0];
  assert.deepEqual(fieldIds({behavior:'forgeFactionTierPair',params:{faction:'炎',countBy:'operators'}},roster,catalog,source),['maker','adjacent'],'the source itself counts when the native rule includes it');
  assert.deepEqual(fieldIds({behavior:'forgeAdjacent',params:{direction:'front'}},roster,catalog,source),['maker','adjacent']);
  assert.deepEqual(fieldIds({behavior:'warbandEvent',params:{event:'shieldLayersBroken',faction:'炎',targets:'self'}},roster,catalog,source),['maker','adjacent'],'self-benefit rules highlight the field actors whose event can trigger it');
  assert.deepEqual(fieldIds({behavior:'warbandEvent',params:{event:'death',faction:'炎',targets:'self'}},roster,catalog,source),['adjacent'],'the source cannot trigger its own death benefit');
  assert.deepEqual(fieldIds({behavior:'warbandEvent',params:{event:'kill',faction:'炎',targets:'actor'}},roster,catalog,source),['maker','adjacent']);
  assert.deepEqual(fieldIds({behavior:'deathrattleEcho',params:{faction:'叙拉古'}},roster,catalog,source),['row']);
  assert.deepEqual(fieldIds({behavior:'dominantFactionRecruit',params:{normalRequires:'sameRowCount>=3'}},roster,catalog,source),['maker','adjacent','row']);
  assert.deepEqual(fieldIds({behavior:'darkmoonPlayedFactionCountSelfGrowth',params:{faction:'炎'}},roster,catalog,source),['maker','adjacent']);
  catalog.operators.adjacent.nativeStats.maxHp=100;
  const aura={behavior:'aura',params:{targets:'inRange',only:{hpAbove:.5}}};
  roster[1].hp=60;roster[1].maxHp=100;
  assert.deepEqual(fieldIds(aura,roster,catalog,source,{rangeTiles:[[2,3],[4,4]]}),['adjacent']);
  roster[1].hp=50;
  assert.deepEqual(fieldIds(aura,roster,catalog,source,{rangeTiles:[[2,3],[4,4]]}),[],'native hpAbove is strict and follows the displayed frame health');
});

test('field count reuses module-adjusted base-stat, equipment keyword and normal/gold-form thresholds',()=>{
  const catalog=realCatalog(),roster=pieces(),source=roster[0];
  catalog.operators.adjacent.source.normalChess.modules=[{uniEquipId:'strong',attr:{atk:30}}];
  roster[1].moduleId='strong';
  const effect={behavior:'allyConditionStats',params:{match:{baseStat:'atk',minBaseStatRatioToSelf:1.5,keywordGear:'冷却背心'}}};
  assert.deepEqual(fieldIds(effect,roster,catalog,source),['adjacent']);
  roster[1].bodyPenaltyApplied=true;
  assert.deepEqual(fieldIds(effect,roster,catalog,source),[]);
});

test('Javi and Wuxian field counts require an installed deployment payload, include magnetic recipients and exclude phantom tokens',()=>{
  const data=getData(),display=independentDisplayCatalog(data,getCatalog(data));
  const bySource=id=>Object.values(display.operators).find(op=>op.sourceRefs?.darkmoon19_2?.id===id);
  const javi=bySource('BGS_078'),wuxian=bySource('FP1_031'),payload=bySource('OG_256'),koOnly=bySource('BGS_008'),magneticHost=bySource('BOT_218');
  assert.ok(javi&&wuxian&&payload&&koOnly&&magneticHost);
  const ruleFor=op=>op.summary.find(x=>x.rule?.behavior==='darkmoonCombat'&&x.rule.params.match?.deploymentPayload);
  const jRule=ruleFor(javi),wRule=ruleFor(wuxian);assert.ok(jRule&&wRule);
  const roster=[
    {uid:'javi',chessId:javi.baseChessId,kind:'op',row:1,col:1,ownerId:'p1'},
    {uid:'wuxian',chessId:wuxian.baseChessId,kind:'op',row:1,col:2,ownerId:'p1'},
    {uid:'adapted',chessId:payload.baseChessId,kind:'op',row:1,col:3,ownerId:'p1'},
    {uid:'ko',chessId:koOnly.baseChessId,kind:'op',row:1,col:4,ownerId:'p1'},
    {uid:'magnetic',chessId:magneticHost.baseChessId,kind:'op',row:1,col:5,ownerId:'p1',attachments:[{id:'darkmoon-magnetic',state:{sourceId:'BOT_312'}}]},
    {uid:'phantom',chessId:payload.baseChessId,kind:'token',row:1,col:6,ownerId:'p1'},
    {uid:'token-payload',chessId:payload.baseChessId,kind:'token',x:6,y:1,ownerId:'p1',darkmoonDeploymentSources:['OG_256']},
    {uid:'enemy-owner',chessId:payload.baseChessId,kind:'op',row:1,col:7,ownerId:'p2'},
  ];
  const count=(rule,source)=>fieldConditionPiecesForEffect(rule,{pieces:roster,catalog:display,source}).map(x=>x.uid);
  assert.deepEqual(count(jRule,roster[0]),['adapted','magnetic','token-payload'],'Javi excludes itself and filters by current-owner installed payload');
  assert.deepEqual(count(wRule,roster[1]),['adapted','magnetic','token-payload'],'Wuxian counts the same actual payload holders');
  assert.deepEqual(count(jRule,{...roster[0],x:1,y:1}),['adapted','magnetic','token-payload'],'battle snapshots use runtime source metadata for ops and tokens');
});
