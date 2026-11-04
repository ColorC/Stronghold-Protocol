import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { createAssaultBattle } from '../../server/modes/assault/battle.js';
import { createRun, applyAction } from '../../shared/assault/run.js';
import { buildAssaultBattleInput } from '../../shared/assault/battle-input.js';
import { pieceFromBody, mergeInventory } from '../../shared/assault/inventory.js';

const context = createAssaultContext({ data: getData() });
const encounter = context.design.encounters.encounters.find((entry) => entry.kind === 'normal' && entry.dayRange[0] === 1);
assert.ok(encounter, 'native day-one encounter exists');

function action(state, type, payload = {}) {
  const opId = `${state.runId}:${state.revision}:${type}`;
  return applyAction(state, { type, ...payload, opId, expectedRevision: state.revision }, context);
}
function createFixture(runId) {
  const state = createRun({ runId, seed: 20261011, directorId: 'director_angel2' }, context);
  state.day = 1;
  state.hour = 6;
  state.phase = 'shop';
  state.gold = 40;
  state.shop = { id: 'supply-test', kind: 'supply', slots: [
    { slotId: 'punch', kind: 'supply', itemId: 'supply_punch', star: 1, price: 2 },
    { slotId: 'smoothie', kind: 'supply', itemId: 'supply_smoothie', star: 1, price: 2 },
    { slotId: 'courage', kind: 'supply', itemId: 'supply_courage', star: 1, price: 2 },
  ], refreshCost: 2, refreshCount: 0 };
  // A second copy of a real starter identity exercises native inventory merging
  // after actual sales have recorded the same source IDs on both pieces.
  const duplicate = pieceFromBody(state, context, state.pieces[0].charId, 1, { row: null, col: null });
  state.pieces.push(duplicate);
  return state;
}
function soldFixture(runId) {
  let state = createFixture(runId);
  for (const slotId of ['punch', 'smoothie', 'courage']) state = action(state, 'buySupply', { slotId }).state;
  for (const supply of [...state.supplies]) state = action(state, 'sellSupply', { uid: supply.uid }).state;
  return state;
}
function assertLegalDeployment(state) {
  for (const piece of state.pieces.filter((entry) => entry.row != null && entry.col != null)) {
    assert.equal(context.canPlace(state, piece, piece.row, piece.col), true, `${piece.uid} has a native legal tile`);
  }
}
function battleFor(state) {
  state.prepEncounterId = encounter.id;
  state.currentNode = { id: encounter.id, kind: 'battle', encounterId: encounter.id, battleKind: encounter.kind,
    name: encounter.name, rewards: encounter.rewards, boardRegion: encounter.boardRegion, stageId: encounter.stageId };
  state.phase = 'battlePrep';
  assertLegalDeployment(state);
  const prepared = context.prepareBattle(state, encounter);
  for (const piece of prepared.input.pieces) if (piece.temporaryAbilityEnhancements !== undefined) {
    assert.ok(Object.isFrozen(piece.temporaryAbilityEnhancements), 'prepared ability records are frozen copies');
    assert.ok(piece.temporaryAbilityEnhancements.every(Object.isFrozen), 'each prepared ability record is frozen');
  }
  const built = buildAssaultBattleInput(prepared, { runtime: context.runtime, nativeData: context.nativeData, kits: context.kits });
  const hostPiece = state.pieces.find((piece) => piece.temporaryAbilityEnhancements?.length) ?? state.pieces[0];
  const hostRecord = built.data.chess[`assault:${hostPiece.uid}`]?.assaultPiece?.abilityBonuses;
  assert.ok(hostRecord, 'actual battle input contains the ability power map');
  const battle = createAssaultBattle(prepared, context);
  assert.ok(battle._assaultUpgradeState, 'native context.install installed the upgrades and temporary-ability runtime');
  battle.start();
  for (let i = 0; i < 1200 && !battle.finished && !battle.enemies.some((unit) => unit.alive); i += 1) battle.step();
  const source = battle.allyUnits.find((unit) => unit.kind === 'op' && unit.uid === hostPiece.uid && unit.alive && unit.deployed);
  assert.ok(source, 'the recorded source operator deployed through the native Battle');
  const enemy = battle.enemies.find((unit) => unit.alive);
  assert.ok(enemy, 'native encounter wave spawned a real enemy');
  return { battle, prepared, built, source, enemy, hostRecord };
}
function combatMetrics(state) {
  const fixture = battleFor(state);
  const { battle, source, enemy } = fixture;
  const hpBefore = enemy.hp;
  battle.dealDamage(source, enemy, { amount: 100, type: 'true', canDodge: false, tags: ['supply-causal-test'] });
  const damage = hpBefore - enemy.hp;
  const ally = source;
  const sourceEnemy = battle.enemies.find((unit) => unit.alive) ?? enemy;
  battle.dealDamage(sourceEnemy, ally, { amount: 200, type: 'true', canDodge: false, tags: ['supply-causal-wound'] });
  const regenQuarter = battle.heal(source, ally, 25, { regen: true, regenSeconds: 0.25 });
  battle.dealDamage(sourceEnemy, ally, { amount: 200, type: 'true', canDodge: false, tags: ['supply-causal-wound'] });
  const regenHalf = battle.heal(source, ally, 25, { regen: true, regenSeconds: 0.5 });
  battle.dealDamage(sourceEnemy, ally, { amount: 200, type: 'true', canDodge: false, tags: ['supply-causal-wound'] });
  const directHeal = battle.heal(source, ally, 25);
  battle.dealDamage(sourceEnemy, ally, { amount: 200, type: 'true', canDodge: false, tags: ['supply-causal-wound'] });
  battle.addBuff(ally, { key: `supply-regen:${state.runId}`, duration: 2, source: ally, mods: { hpRegen: 10 } });
  let nativeRegenTick = null;
  battle.on('heal', (event) => {
    if (event.source === ally && event.target === ally && event.opts?.regen && Number.isFinite(event.amount)) nativeRegenTick = event.amount;
  });
  for (let i = 0; i < 10 && nativeRegenTick === null; i += 1) battle.step();
  const shield = battle.addBuff(ally, { key: `supply-test:${state.runId}`, shield: 20, duration: 5, source: ally });
  return { ...fixture, damage, regenQuarter, regenHalf, directHeal, nativeRegenTick, shieldValue: shield?.shield ?? 0 };
}

test('supply sale records flow through immutable battle input into auto-installed native power effects and expire at day boundary', () => {
  const control = createFixture('00000000-0000-4000-8000-000000000061');
  const sold = soldFixture('00000000-0000-4000-8000-000000000062');
  assert.equal(sold.supplies.length, 0, 'each bought item was sold through applyAction');
  assert.equal(sold.gold, control.gold - 6, 'three purchases cost six gold; zero-price sales add no gold');
  const firstHost = sold.pieces[0];
  const powers = firstHost.temporaryAbilityEnhancements.map((entry) => [entry.ability, entry.amount]).sort();
  assert.deepEqual(powers, [['damage', 10], ['heal', 10], ['regen', 2], ['shield', 10]].sort());
  assert.ok(firstHost.temporaryAbilityEnhancements.every((entry) => entry.expiresAtHour === 6));

  const sourcePieces = sold.pieces.filter((piece) => piece.purchaseCharId === firstHost.purchaseCharId);
  assert.equal(sourcePieces.length, 2);
  assert.deepEqual(sourcePieces[0].temporaryAbilityEnhancements.map((entry) => entry.id),
    sourcePieces[1].temporaryAbilityEnhancements.map((entry) => entry.id), 'each sale applies the same source identity to both matching bodies');
  const merged = mergeInventory(sold.pieces, context);
  const mergedHost = merged.find((piece) => piece.purchaseCharId === firstHost.purchaseCharId);
  assert.equal(merged.filter((piece) => piece.purchaseCharId === firstHost.purchaseCharId).length, 1);
  assert.equal(new Set(mergedHost.temporaryAbilityEnhancements.map((entry) => entry.id)).size, 4,
    'native merge keeps each distinct sale source once');
  assert.deepEqual(mergedHost.temporaryAbilityEnhancements.map((entry) => entry.id).sort(),
    firstHost.temporaryAbilityEnhancements.map((entry) => entry.id).sort());

  const baseline = combatMetrics(control);
  const active = combatMetrics(sold);
  assert.equal(active.hostRecord.damage, 10);
  assert.equal(active.hostRecord.heal, 10);
  assert.equal(active.hostRecord.regen, 2);
  assert.equal(active.hostRecord.shield, 10);
  assert.equal(active.damage - baseline.damage, 10, 'native hit pipeline receives exactly the Punch damage bonus');
  assert.equal(active.regenQuarter - baseline.regenQuarter, 0.5, 'regen addition is scaled by native dt=0.25');
  assert.equal(active.regenHalf - baseline.regenHalf, 1, 'regen addition is scaled by native dt=0.5');
  assert.ok(Math.abs((active.nativeRegenTick - baseline.nativeRegenTick) - 0.2) < 1e-9,
    `the ordinary native HP-regeneration tick applies the same per-second bonus: ${baseline.nativeRegenTick}/${active.nativeRegenTick}`);
  assert.equal(active.directHeal - baseline.directHeal, 10, 'non-regen healing receives the separate Smoothie value');
  assert.equal(active.shieldValue - baseline.shieldValue, 10, 'native numeric shield gains the Courage bonus');
  assert.equal(baseline.battle.errorCount, 0);
  assert.equal(active.battle.errorCount, 0);

  let boundary = sold;
  boundary.shop = { id: 'boundary-shop', kind: 'supply', slots: [], refreshCost: 2, refreshCount: 0 };
  boundary.phase = 'shop';
  boundary = action(boundary, 'finishShop').state;
  assert.deepEqual([boundary.day, boundary.hour], [2, 1]);
  assert.ok(boundary.pieces.every((piece) => piece.temporaryAbilityEnhancements.length === 0),
    'actual finishShop expiration removes all day-one sale records before the new day begins');
  const expired = combatMetrics(boundary);
  assert.deepEqual(expired.hostRecord, { damage: 0, heal: 0, regen: 0, shield: 0, poison: 0, burn: 0 });
  assert.equal(expired.damage, baseline.damage, 'the next native battle returns to the no-sale damage result');
  assert.equal(expired.directHeal, baseline.directHeal, 'the next battle no longer has sale healing');
  assert.equal(expired.shieldValue, baseline.shieldValue, 'the next battle no longer has sale shield');
  assert.equal(expired.battle.errorCount, 0);
});
