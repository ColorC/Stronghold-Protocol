import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { getAssaultData } from '../../server/modes/assault/data.js';
import { createAssaultBattle, prepareAssaultBattle } from '../../server/modes/assault/battle.js';
import { createAssaultStore } from '../../server/modes/assault/store.js';
import { applyAction, createRun, viewRun } from '../../shared/assault/run.js';
import { absoluteRunHour } from '../../shared/assault/temporary-enhancements.js';
import { applyTemporaryEnchantment } from '../../shared/assault/temporary-enchantments.js';
import { mergeInventory } from '../../shared/assault/inventory.js';
import { buildAssaultBattleInput, makeChessRecords } from '../../shared/assault/battle-input.js';

const { runtime, nativeData } = getAssaultData();
const context = createAssaultContext({ runtime, data: nativeData });
let actionSeq = 0;

function act(state, type, fields = {}) {
  const action = { type, ...fields, opId: `temporary-enchant:${++actionSeq}`, expectedRevision: state.revision };
  return { action, ...applyAction(state, action, context) };
}

function runFixture() {
  const suffix = String(++actionSeq).padStart(12, '0');
  return createRun({ runId: `00000000-0000-4000-8000-${suffix}`, seed: 12, directorId: 'director_svash2' }, context);
}

test('temporary enchant survives real purchase merge, reaches native Battle, expires on next day, and leaves permanent choice intact', { timeout: 30000 }, () => {
  let state = runFixture();
  assert.ok(state.pieces.find((piece) => piece.charId === 'char_174_slbell'));
  state.nodeChoices = [{ id: 'fixture-shop', kind: 'shop', shopId: 'shop_base', name: 'fixture' }];
  state = act(state, 'selectNode', { nodeId: 'fixture-shop' }).state;
  const slbell = state.pieces.find((piece) => piece.charId === 'char_174_slbell');
  const permanentPiece = state.pieces.find((piece) => piece.charId === 'char_196_sunbr');
  const slot = state.shop.slots[0];
  Object.assign(slot, { charId: slbell.charId, purchaseCharId: slbell.purchaseCharId, star: slbell.star, requiredCopies: 1, price: 1 });

  const shieldRecord = { id: 'soda-shield-hour-1', enchantmentId: 'enchant_shielded', expiresAtHour: 6 };
  const shieldHost = state.pieces.find((piece) => piece.charId === 'char_1045_svash2');
  assert.equal(applyTemporaryEnchantment(shieldHost, shieldRecord, state, context), true);
  const toxicRecord = { id: 'soda-toxic-hour-1', enchantmentId: 'enchant_toxic', expiresAtHour: 6 };
  assert.equal(applyTemporaryEnchantment(slbell, toxicRecord, state, context), true);
  assert.equal(applyTemporaryEnchantment(permanentPiece, toxicRecord, state, context), true);
  permanentPiece.enchantmentId = 'enchant_heavy';
  assert.equal(viewRun(state, context).pieces.find((piece) => piece.uid === permanentPiece.uid).effectiveEnchantmentId, 'enchant_heavy');

  const buyAction = { type: 'buy', slotId: slot.slotId, opId: 'temporary-enchant-real-buy', expectedRevision: state.revision };
  const purchase = applyAction(state, buyAction, context);
  state = purchase.state;
  const merged = state.pieces.find((piece) => piece.uid === slbell.uid);
  assert.equal(purchase.result.purchaseCharId, slbell.purchaseCharId);
  assert.equal(merged.star, 2, 'the actual buy path merged the purchased copy into the existing piece');
  assert.deepEqual(merged.temporaryEnchantments, [toxicRecord], 'merge retained the source record');
  const replay = applyAction(state, buyAction, context);
  assert.strictEqual(replay.state, state, 'replaying the same buy opId does not duplicate the purchase or record');
  assert.equal(replay.state.gold, state.gold);

  const beforeExpire = viewRun(state, context);
  assert.equal(beforeExpire.pieces.find((piece) => piece.uid === shieldHost.uid).effectiveEnchantmentId, 'enchant_shielded');
  const encounter = context.design.encounters.encounters.find((entry) => entry.wave);
  const prepared = prepareAssaultBattle(state, encounter, context);
  const nativeDTO = buildAssaultBattleInput(prepared, { runtime, nativeData, kits: context.kits, install: context.install });
  assert.equal(nativeDTO.data.chess[`assault:${shieldHost.uid}`]?.assaultPiece?.enchantmentId, 'enchant_shielded');
  const battle = createAssaultBattle(prepared, context);
  assert.equal(nativeDTO.data.chess[`assault:${shieldHost.uid}`].assaultPiece.enchantmentId, 'enchant_shielded', 'battle input consumes the temporary effective ID while permanent enchantmentId stays absent');
  assert.equal(state.pieces.find((piece) => piece.uid === shieldHost.uid).enchantmentId, undefined);
  battle.start();
  const owner = battle.allyUnits.find((unit) => unit.uid === shieldHost.uid);
  battle.spawnEnemy('enemy_1422_lrsldr', { routeIndex: 0, pos: [9, 5] });
  owner.skill.addCharge();
  assert.equal(battle.assaultRuntime.cast(owner, { force: true }), true);
  battle.assaultRuntime.flush();
  const shield = owner.buffs.find((buff) => buff.key.startsWith('assault:upgrade:shielded:'));
  assert.equal(shield?.shield, 50, 'real enchantment activation grants the star-1 numeric shield');
  assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));

  const mergeA = structuredClone(merged), mergeB = structuredClone(merged);
  mergeA.uid = 'merge-temp-a'; mergeB.uid = 'merge-temp-b';
  mergeA.star = mergeB.star = 1; mergeA.sourceCopies = mergeB.sourceCopies = 1;
  mergeA.row = mergeA.col = mergeB.row = mergeB.col = null;
  mergeA.temporaryEnchantments = [{ id: 'source-a', enchantmentId: 'enchant_toxic', expiresAtHour: 6 }];
  mergeB.temporaryEnchantments = [{ id: 'source-b', enchantmentId: 'enchant_fiery', expiresAtHour: 7 }];
  const recordsMerged = mergeInventory([mergeA, mergeB], context);
  assert.equal(recordsMerged.length, 1);
  assert.deepEqual(recordsMerged[0].temporaryEnchantments.map((record) => record.id), ['source-a', 'source-b']);

  state.day = 1; state.hour = 6;
  state = act(state, 'finishShop').state;
  assert.equal(state.day, 2); assert.equal(state.hour, 1);
  const afterExpire = viewRun(state, context);
  assert.deepEqual(afterExpire.pieces.find((piece) => piece.uid === slbell.uid).temporaryEnchantments, []);
  assert.equal(afterExpire.pieces.find((piece) => piece.uid === shieldHost.uid).effectiveEnchantmentId, null);
  assert.equal(afterExpire.pieces.find((piece) => piece.uid === permanentPiece.uid).effectiveEnchantmentId, 'enchant_heavy');
  assert.equal(state.pieces.find((piece) => piece.uid === permanentPiece.uid).enchantmentId, 'enchant_heavy');

  const expiredPrepared = prepareAssaultBattle(state, encounter, context);
  const expiredDTO = buildAssaultBattleInput(expiredPrepared, { runtime, nativeData, kits: context.kits, install: context.install });
  assert.equal(expiredDTO.data.chess[`assault:${shieldHost.uid}`]?.assaultPiece?.enchantmentId, null);
  const expiredBattle = createAssaultBattle(expiredPrepared, context);
  expiredBattle.start();
  const expiredOwner = expiredBattle.allyUnits.find((unit) => unit.uid === shieldHost.uid);
  expiredBattle.spawnEnemy('enemy_1422_lrsldr', { routeIndex: 0, pos: [9, 5] });
  expiredOwner.skill.addCharge();
  assert.equal(expiredBattle.assaultRuntime.cast(expiredOwner, { force: true }), true);
  expiredBattle.assaultRuntime.flush();
  assert.equal(expiredOwner.buffs.some((buff) => buff.key.startsWith('assault:upgrade:shielded:')), false, 'expired enchantment has no real Battle effect');
  assert.equal(expiredBattle.errors.length, 0, JSON.stringify(expiredBattle.errors));
});

test('store validates temporary records without filesystem I/O and legacy pieces still build native records without an optional clock field', { timeout: 30000 }, () => {
  const state = runFixture();
  const root = path.join(os.tmpdir(), `assault-validation-noio-${process.pid}-${Date.now()}`);
  const store = createAssaultStore({ root, context });
  assert.equal(store.validate(state), true);
  const legacy = structuredClone(state.pieces[0]);
  delete legacy.temporaryEnchantments;
  assert.equal(Object.hasOwn(legacy, 'temporaryEnchantments'), false);
  const chess = makeChessRecords(runtime, [legacy], []);
  assert.ok(chess.chess[`assault:${legacy.uid}`]);
  assert.equal(existsSync(root), false, 'validation and legacy projection do not create a store directory');

  const invalid = structuredClone(state);
  invalid.pieces[0].temporaryEnchantments = [{ id: 'bad', enchantmentId: 'enchant_toxic', expiresAtHour: absoluteRunHour(invalid) }];
  assert.throws(() => store.validate(invalid), { code: 'INVALID_TEMPORARY_ENCHANTMENT' });
  assert.equal(existsSync(root), false, 'invalid-record validation has no filesystem side effect');
});
