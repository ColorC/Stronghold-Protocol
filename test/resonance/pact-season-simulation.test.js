import test from 'node:test';
import assert from 'node:assert/strict';
import { PACT_SET, buildLineup, buildScenarioState, buildSimulationPlan, compareTriggerCounts, completeBattleLineup, targetEffectObservations } from '../../tools/resonance/pact-season-simulation.mjs';

function mockCatalog() {
  const activeOperatorIds = Array.from({ length: 65 }, (_, index) => `op-${index}`);
  const operators = Object.fromEntries(activeOperatorIds.map((id, index) => [id, { id, charId: `char-${index}`, cost: index % 5 + 1,
    pacts: index < 3 ? [...PACT_SET] : [], profession: index === 3 ? 'GUARD' : index === 4 ? 'MEDIC' : index === 5 ? 'SNIPER' : 'CASTER',
    position: index === 5 ? 'RANGED' : 'MELEE', name: id }]));
  const pacts = Object.fromEntries([...PACT_SET].map((id) => [id, { levels: [
    { threshold: 2, effects: [{ kind: `${id}-low` }] }, { threshold: 3, effects: [{ kind: `${id}-high` }] },
  ] }]));
  return { config: { rulesVersion: 2, seasonId: 'resonance-season-2', activeOperatorIds }, operators, pacts, equipment: {} };
}

test('season simulation plan covers all 35 pacts, every authored tier, and a native boss case for each final tier', () => {
  const plan = buildSimulationPlan(mockCatalog());
  assert.equal(PACT_SET.size, 35);
  assert.equal(plan.length, 105);
  assert.equal(new Set(plan.map((row) => `${row.pactId}:${row.threshold}`)).size, 70);
  assert.equal(plan.filter((row) => row.node === 'boss').length, 35);
  assert.ok(plan.every((row) => row.eligible && row.members.length >= 6 && row.composition.targetPactMembers === row.threshold));
  const catalog = mockCatalog();
  assert.ok(plan.every((row) => row.members.every((member) => {
    const cost = catalog.operators[member.operatorId].cost;
    const expected = row.round >= 28 ? (cost <= 4 ? 2 : 1) : (cost <= 3 ? 2 : 1);
    return member.star === expected;
  })));
});

test('lineup transfer requires a configured emblem recipe and preserves unique active identities under level-10 cap', () => {
  const catalog = mockCatalog();
  const members = catalog.config.activeOperatorIds.map((id) => catalog.operators[id]);
  members[0].pacts = ['test-pact'];
  members[1].pacts = ['natural-pact-a', 'natural-pact-b'];
  catalog.pacts['test-pact'] = { levels: [{ threshold: 2, effects: [] }] };
  catalog.equipment = { blade: { kind: 'component' }, crest: { kind: 'component' }, emblem_test: { kind: 'emblem', parts: ['blade', 'crest'], effects: [{ kind: 'pact_transfer', params: { pactId: 'test-pact' } }] } };
  catalog.recipes = [{ id: 'recipe_test', resultId: 'emblem_test', parts: ['blade', 'crest'] }];
  const legal = buildLineup(catalog, 'test-pact', 2);
  assert.equal(legal.eligible, true);
  assert.deepEqual(legal.members.map((row) => row.natural), [true, false]);
  assert.equal(legal.members[1].transfer.itemId, 'emblem_test');
  assert.equal(catalog.operators[legal.members[1].operatorId].pacts.length, 2, 'an otherwise legal empty-slot holder may already have multiple natural pacts');
  const missing = buildLineup(catalog, 'test-pact', 4);
  assert.equal(missing.eligible, false);
  assert.match(missing.reason, /unique legal season identities/);
  assert.equal(buildLineup(catalog, 'test-pact', 11).eligible, false);
  catalog.pacts['test-pact'].emblemAllowed = false;
  assert.equal(buildLineup(catalog, 'test-pact', 2).eligible, false, 'explicit pact metadata forbids an emblem identity');
});

test('canonical season-2 build covers every current tier and final boss case with valid unique identities', async () => {
  const dataDirectory = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
  process.env.SP_DATA_DIR = dataDirectory;
  const [{ getData }, { getResonanceCatalog }] = await Promise.all([
    import('../../server/data.js'), import('../../server/modes/resonance/catalog.js'),
  ]);
  const catalog = getResonanceCatalog(getData(), { rulesVersion: 2, seasonId: 'resonance-season-2', seed: 73021 });
  const plan = buildSimulationPlan(catalog);
  assert.ok(plan.length > 35);
  assert.ok(plan.every((row) => row.eligible), plan.filter((row) => !row.eligible).map((row) => `${row.id}: ${row.reason}`).join('\n'));
  assert.ok(plan.every((row) => row.members.filter((member) => member.isTargetPactMember).length === row.threshold));
  assert.ok(plan.every((row) => row.members.length >= 6 && row.members.length <= 10));
  assert.ok(plan.every((row) => new Set(row.members.map((member) => member.charId)).size === row.members.length));
  assert.ok(plan.every((row) => row.members.every((member) => catalog.config.activeOperatorIds.includes(member.operatorId))));
  assert.equal(plan.filter((row) => row.node === 'boss').length, 35);
  assert.ok(plan.every((row)=>row.composition.unitFaceValueTotal===row.composition.totalCost));
  assert.ok(plan.every((row)=>row.composition.recruitmentMergeCost===row.composition.costBreakdown.reduce((sum,entry)=>sum+entry.unitFaceValue*entry.copiesForStar,0)));
});

test('creation tier-6 native fixture leaves a legal owner-range tile for the real Vigil wolf token', async () => {
  const dataDirectory = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
  process.env.SP_DATA_DIR = dataDirectory;
  const [{ getData }, { getResonanceCatalog }, { getResonanceField, buildResonanceBattle }, board] = await Promise.all([
    import('../../server/data.js'), import('../../server/modes/resonance/catalog.js'), import('../../server/modes/resonance/battle.js'), import('../../server/match/board.js'),
  ]);
  const data=getData(),catalog=getResonanceCatalog(data,{rulesVersion:2,seasonId:'resonance-season-2',seed:73021});
  const row=buildSimulationPlan(catalog).find((entry)=>entry.id==='creation:6:normal');
  let seed=2166136261; for(const char of row.id)seed=Math.imul(seed^char.charCodeAt(0),16777619); seed>>>=0;
  const field=getResonanceField({seed,rulesVersion:2,seasonId:catalog.config.seasonId,difficulty:'NORMAL',round:row.round,roundLimit:28},{data,catalog});
  const state=buildScenarioState(row,catalog,field,{data,board,ensureSummonSpace:true});
  const {battle}=buildResonanceBattle(state,{data,catalog,recording:false});
  assert.equal(state.level,state.pieces.length,'focused battle fixture uses the minimum population matching its deployed roster');
  assert.equal(state.pieces.length,row.members.length,'fixture keeps the original legal lineup');
  assert.equal(new Set(state.pieces.map((piece)=>piece.operatorId)).size,row.members.length,'fixture keeps every identity unique');
  assert.ok(battle.resonanceSummonAnchors.some((anchor)=>anchor.ownerUid==='pact-sim-6'&&anchor.tokenId==='token_10028_vigil_wolf'));
  assert.ok(!battle.resonanceSummonAnchorGaps.some((gap)=>gap.ownerUid==='pact-sim-6'&&gap.tokenId==='token_10028_vigil_wolf'));
});

test('viable-pact supply transfer is an authorized configured source when no craft recipe exists', () => {
  const catalog = mockCatalog();
  const first = catalog.operators['op-0']; first.pacts = ['test-pact'];
  catalog.operators['op-1'].pacts = [];
  catalog.pacts['test-pact'] = { levels: [{ threshold: 2, effects: [] }] };
  catalog.equipment = { transfer_test: { id: 'transfer_test', kind: 'emblem', effects: [{ kind: 'transfer_pact', params: { pactId: 'test-pact' } }] } };
  catalog.campaign = { supply: { transfers: [{ node: 12, count: 1, selection: 'viable-pact' }, { node: 22, count: 1, selection: 'viable-pact' }] } };
  const lineup = buildLineup(catalog, 'test-pact', 2);
  assert.equal(lineup.eligible, true);
  assert.deepEqual(lineup.members[1].transfer.nodes, [12, 22]);
  assert.equal(lineup.members[1].transfer.configPath, 'catalog.campaign.supply.transfers');
  const completed = completeBattleLineup(catalog, lineup, 12);
  assert.equal(completed.battleRound, 12, 'single transfer uses the earliest configured supply node');
  assert.deepEqual(completed.composition.transferSourceNodes, [12]);
  const twoTransfers = completeBattleLineup(catalog, buildLineup(catalog, 'test-pact', 3), 12);
  assert.equal(twoTransfers.battleRound, 22, 'two transfers are not available before the second configured node');
  assert.deepEqual(twoTransfers.composition.transferSourceNodes, [12, 22]);
});

test('trigger metrics distinguish unobserved from observed-zero values', () => {
  const rows = compareTriggerCounts({ observedZero: 0, observedRise: 3 }, { observedZero: 0, observedRise: 1 });
  assert.deepEqual(rows.map((row) => [row.key, row.withoutTrait, row.withTrait, row.delta, row.status]), [
    ['observedRise', 1, 3, 2, 'changed'], ['observedZero', 0, 0, 0, 'zero-delta'],
  ]);
  assert.deepEqual(targetEffectObservations(['iberia_barrier'], {}, {}), [
    { effect: 'iberia_barrier', counters: [{ key: 'iberiaExplosion', withTrait: 0, withoutTrait: 0, delta: 0, status: 'observed-zero' }], status: 'observed-through-handler-counter' },
  ]);
  assert.equal(targetEffectObservations(['victoria_artillery'], {}, {})[0].status, 'unknown-no-effect-specific-counter-mapping');
});
