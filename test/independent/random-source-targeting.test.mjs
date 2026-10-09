import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runNativeHook } from '../../server/modes/independent/native.js';
import { buyRequiresTarget, buyTargetSpec } from '../../public/js/independent/targetSelection.js';
import design from '../../data/independent-design.json' with { type: 'json' };

const catalog = getCatalog();
const rag = Object.values(catalog.operators).find((op) => !op.elite && op.sourceRefs?.darkmoon19_2?.id === 'BGS_100');
const elemental = Object.values(catalog.operators).find((op) => !op.elite && op.recruitable && op.nativeFactionTags?.includes('炎') && op.chessId !== rag?.chessId);

function run(isElite, rolls) {
  const source = { uid: 'rag', chessId: isElite ? rag.eliteChessId : rag.chessId, elite: isElite, playerId: 'p1', row: 0, col: 0 };
  const buyer = { uid: 'element', chessId: elemental.chessId, playerId: 'p1', row: 0, col: 2 };
  const ally = { uid: 'ally', chessId: elemental.chessId, playerId: 'p1', row: 0, col: 1 };
  const opposing = { uid: 'opposing', chessId: elemental.chessId, playerId: 'p2', row: 0, col: 3 };
  const benched = { uid: 'benched', chessId: elemental.chessId, playerId: 'p1', row: null, col: null };
  const state = { pieces: [source, ally, buyer, opposing, benched], counters: {}, nextUid: 1 };
  const grants = [];
  let rollIndex = 0;
  const services = { catalog, rng: () => rolls[rollIndex++] ?? 0, grantEquipment(_state, id, quantity, extra) { grants.push({ id, quantity, ...extra }); }, record() {} };
  runNativeHook(state, 'played', { piece: buyer, source: 'hand-play' }, services);
  return { grants, rollIndex, source, buyer, ally, opposing, benched };
}

test('Lil Rag auto-selects a seeded on-board friendly minion, including self, with no buy prompt', () => {
  assert.ok(rag && elemental);
  assert.equal(rag.nativeTrait.effect.prep.some((rule) => rule.trigger === 'played' && rule.behavior === 'darkmoonPlayedRandomTribeGrowth'), true);
  assert.equal(rag.nativeTrait.effect.prep.some((rule) => rule.trigger === 'bought'), false);
  assert.equal(rag.nativeTrait.effect.prep.find((rule) => rule.behavior === 'darkmoonPlayedRandomTribeGrowth').params.triggerFaction, '炎');
  const activeElementals = design.rules.activeRosterIds.map((id) => design.operators.find((op) => op.chessId === id)).filter((op) => op?.sourceRefs?.darkmoon19_2?.rosterTribe === 'ELEMENTAL');
  assert.ok(activeElementals.length > 0);
  assert.ok(activeElementals.every((op) => op.sourceRefs.darkmoon19_2.faction === '炎' && catalog.operators[op.chessId].nativeFactionTags.includes('炎')), 'every active original Elemental maps to the displayed Yan faction');
  const spec = buyTargetSpec({ id: elemental.chessId, kind: 'chess' }, catalog, { pieces: [{ ...rag, row: 0, col: 0, playerId: 'p1' }] });
  assert.equal(spec, null);
  assert.equal(buyRequiresTarget(spec), false);

  const normal = run(false, [0]);
  assert.equal(normal.rollIndex, 1);
  assert.deepEqual(new Set(normal.grants.map((x) => x.targetUid)), new Set(['rag']));
  assert.deepEqual(normal.grants.map((x) => x.id).sort(), ['damage', 'precision']);
  const outsider = { uid: 'other', chessId: elemental.chessId, playerId: 'p1', nativeFactionTags: [], row: 0, col: 2 };
  const noTriggerState = { pieces: [normal.source, normal.ally], counters: {} };
  let noTriggerRolls = 0;
  const noYanCatalog = { ...catalog, operators: { ...catalog.operators, [elemental.chessId]: { ...catalog.operators[elemental.chessId], nativeFactionTags: [] } } };
  runNativeHook(noTriggerState, 'played', { piece: outsider }, { catalog: noYanCatalog, rng: () => { noTriggerRolls++; return 0; }, grantEquipment() {}, record() {} });
  assert.equal(noTriggerRolls, 0, 'the displayed Yan-faction trigger is enforced');
});

test('Lil Rag golden form resolves each of its two random grants independently within the friendly field', () => {
  const elite = run(true, [0.99, 0]);
  assert.equal(elite.rollIndex, 2);
  assert.deepEqual(new Set(elite.grants.map((x) => x.targetUid)), new Set(['element', 'rag']));
  assert.ok(elite.grants.every((x) => x.targetUid !== 'opposing' && x.targetUid !== 'benched'));
  const tier = catalog.operators[elemental.chessId].tier;
  assert.deepEqual(Object.fromEntries(['damage', 'precision'].map((id) => [id, elite.grants.filter((x) => x.id === id).reduce((n, x) => n + x.quantity, 0)])), { damage: tier * 2, precision: tier * 2 });
});

test('true explicit targets keep a non-random target selection contract', () => {
  const explicit = Object.values(catalog.operators).flatMap((op) => [...(op.effectDelivery?.normal || []), ...(op.effectDelivery?.elite || [])]).find((row) => row.targetSelection?.kind === 'friendly');
  assert.ok(explicit?.targetSelection, 'at least one original effect still requires a chosen recipient');
  assert.equal(explicit.recipient.startsWith('selected'), true);
});
