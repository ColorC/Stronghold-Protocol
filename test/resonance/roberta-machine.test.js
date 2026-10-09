import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { applyAction, createSession, validateSession } from '../../server/modes/resonance/session.js';
import { buildResonanceBattle, getResonanceField, runResonanceBattle } from '../../server/modes/resonance/battle.js';
import { canPlace, ownerRangeKeys, positionClass } from '../../server/match/board.js';
import { canTargetAlly } from '../../server/sim/targeting.js';
import { COLS } from '../../server/sim/constants.js';
import { enemyRec } from '../helpers/battleHarness.js';

const DATA_DIR = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data';
const ROBERTA = 'chess_native_char_484_robrta_a';
const SWIRE = 'chess_char_3_04_a';
const VIGIL = 'chess_char_3_19_a';
const MACHINE = 'token_10018_robrta_mach';
const WOLF = 'token_10028_vigil_wolf';
const copies = { 1: 1, 2: 3, 3: 9 };

function advance(battle, seconds) {
  const ticks = Math.ceil(seconds / battle.dt);
  for (let i = 0; i < ticks && !battle.finished; i++) battle.step();
}

function fixture() {
  const data = loadData(DATA_DIR, { log: { warn() {}, error() {}, info() {} } });
  const catalog = getResonanceCatalog(data, { environmentId: 'origin_laterano', seed: 1 });
  const created = createSession({ seed: 1, difficulty: 'NORMAL', environmentId: 'origin_laterano', catalog });
  assert.equal(created.ok, true, created.error);
  const state = created.state;
  for (const piece of state.pieces) state.poolRemaining[piece.operatorId] += copies[piece.star];
  state.pieces = [];
  state.level = 10;
  state.phase = 'prep';
  state.nodeStarted = true;
  const makePiece = (operatorId) => {
    assert.ok(state.poolRemaining[operatorId] > 0, `pool has ${operatorId}`);
    state.poolRemaining[operatorId]--;
    const piece = { uid: `p${state.nextUid++}`, operatorId, star: 1, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT', summonOrders: [] };
    state.pieces.push(piece);
    return piece;
  };
  const owner = makePiece(ROBERTA), target = makePiece(SWIRE), otherOwner = makePiece(VIGIL);
  const fieldFor = (current) => getResonanceField(current, { data, catalog });
  let field = fieldFor(state), placement = null;
  const opDef = catalog.operators[ROBERTA], targetDef = catalog.operators[SWIRE];
  const tokenDef = field.resolveToken(MACHINE, ROBERTA, opDef.fixedSkillIndex);
  for (const ownerKey of field.deployMap.keys()) {
    const [or, oc] = ownerKey.split(',').map(Number);
    if (!canPlace(field.deployMap, positionClass(opDef), or, oc)) continue;
    for (const tokenKey of field.deployMap.keys()) {
      const [tr, tc] = tokenKey.split(',').map(Number);
      if (ownerKey === tokenKey || !canPlace(field.deployMap, positionClass(tokenDef), tr, tc)) continue;
      const tokenRange = ownerRangeKeys(tokenDef.rangeGrid, tr, tc, 'RIGHT');
      const targetKey = [...tokenRange]
        .find((key) => key !== ownerKey && key !== tokenKey && field.deployMap.has(key)
          && canPlace(field.deployMap, positionClass(targetDef), ...key.split(',').map(Number)));
      if (!targetKey) continue;
      const [ar, ac] = targetKey.split(',').map(Number);
      const initialTargetKey = [...field.deployMap.keys()].find((key) => key !== ownerKey && key !== tokenKey && key !== targetKey
        && !tokenRange.has(key.split(',').map(Number)[0] * COLS + key.split(',').map(Number)[1])
        && canPlace(field.deployMap, positionClass(targetDef), ...key.split(',').map(Number)));
      if (!initialTargetKey) continue;
      const spare = [...field.deployMap.keys()].find((key) => key !== ownerKey && key !== tokenKey && key !== targetKey
        && key !== initialTargetKey && canPlace(field.deployMap, positionClass(catalog.operators[VIGIL]), ...key.split(',').map(Number)));
      if (!spare) continue;
      placement = { owner: [or, oc], token: [tr, tc], target: [ar, ac], initialTarget: initialTargetKey.split(',').map(Number), other: spare.split(',').map(Number) };
      break;
    }
    if (placement) break;
  }
  assert.ok(placement, 'native field has room for owner, melee target, and an unrelated summon owner');
  [owner.row, owner.col] = placement.owner;
  [target.row, target.col] = placement.initialTarget;
  [otherOwner.row, otherOwner.col] = placement.other;
  const chosen = applyAction(state, { type: 'setSummonOrder', pieceUid: owner.uid, tokenId: MACHINE, row: placement.token[0], col: placement.token[1] }, { catalog, fieldResolver: fieldFor });
  assert.equal(chosen.ok, true, chosen.error);
  field = fieldFor(chosen.state);
  assert.equal(validateSession(chosen.state, { catalog }).ok, true);
  return { data, catalog, state: chosen.state, fieldFor, owner, target, otherOwner, placement };
}

test('Roberta machine is untargetable and non-attacking; applies its native one-hit defense support once and expires', () => {
  const { data, catalog, state, owner, target, placement } = fixture();
  const { battle } = buildResonanceBattle(state, { data, catalog, preview: true });
  battle.timeLimit = 150; // Keep the test battle alive long enough to exercise the native token lifecycle.
  const ownerUnit = battle.allyUnits.find((unit) => unit.uid === owner.uid);
  const targetUnit = battle.allyUnits.find((unit) => unit.uid === target.uid);
  const machine = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.defId === MACHINE && unit.ownerUnit === ownerUnit);
  const unrelatedWolf = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.defId === WOLF);
  assert.ok(machine && unrelatedWolf, 'real owner variants create both the machine and the unrelated native summon');
  assert.deepEqual([machine.homeR, machine.homeC], placement.token, 'explicit placement reaches the Battle input');

  let machineAttacks = 0, brokenLayers = 0;
  battle.on('attack', ({ attacker }) => { if (attacker === machine) machineAttacks++; });
  battle.on('shieldLayersBroken', ({ unit, buff }) => { if (unit === targetUnit && buff.key === `native:robrta:shield:${machine.id}`) brokenLayers++; });
  const enemy = battle.spawnEnemy('roberta-machine-test', { pos: placement.target, def: enemyRec({ key: 'roberta-machine-test', hp: 1e9, atk: 0, speed: 0 }) });
  assert.ok(enemy);
  battle.start();

  assert.equal(targetUnit.buffs.some((buff) => buff.key.startsWith('native:robrta:')), false,
    'device waits when its own facing range has no eligible melee operator');
  advance(battle, 23);
  assert.equal(battle.moveRedeploy(targetUnit, placement.target[0], placement.target[1]), true,
    'native movement/deploy lifecycle brings an eligible ally into range');
  advance(battle, 0.3);

  const defBuff = targetUnit.buffs.find((buff) => buff.key === `native:robrta:def:${machine.id}`);
  const shield = targetUnit.buffs.find((buff) => buff.key === `native:robrta:shield:${machine.id}`);
  const supportExpiresAt = battle.time + defBuff.timeLeft;
  const sourceTalent = machine.def?.talents?.[0]?.bb;
  assert.equal(sourceTalent.def, 0.2);
  assert.equal(sourceTalent.duration, 25);
  assert.equal(defBuff?.mods?.defPct, sourceTalent.def, 'defense percent comes from the native owner token BB');
  assert.equal(defBuff?.duration, sourceTalent.duration);
  assert.equal(shield?.shieldHits, 1, 'one native-counted shield charge');
  assert.equal(shield?.duration, sourceTalent.duration);
  assert.equal(defBuff?.source, ownerUnit, 'owner attribution remains the selected Roberta unit');
  assert.equal(machine.profile.noAttack, true);
  assert.equal(machine.profile.maxTargets, 0);
  assert.equal(machine.s.flags.untargetable, true, 'the source token cannot be selected by enemies');
  assert.equal(machine.s.flags.invulnerable, true);
  assert.equal(machine.profile.noHeal, true);
  assert.equal(unrelatedWolf.profile.noAttack, false, 'the resonance effect does not rewrite other token profiles');
  assert.notEqual(unrelatedWolf.s.flags.untargetable, true, 'other token targetability is unchanged');
  assert.equal(ownerUnit.def.loadout.skillIndex, catalog.operators[ROBERTA].fixedSkillIndex, 'the anchor uses the fixed S1 loadout');
  assert.equal(ownerUnit.def.talents?.[0]?.bb?.cnt, 3, 'native talent inventory is three machines');
  assert.equal(ownerUnit.mem.resonanceRobertaStock, 2, 'the free opening anchor consumes one of the three native machines');

  assert.equal(canTargetAlly(enemy, machine, false), false, 'enemy targeting excludes the device');
  const machineHp = machine.hp;
  assert.equal(battle.dealDamage(enemy, machine, { amount: 100, type: 'phys', canDodge: false, isAttack: true }), 0);
  assert.equal(machine.hp, machineHp, 'the machine is invulnerable like its native source');
  advance(battle, 1);
  assert.equal(machineAttacks, 0, 'machine never performs its native ranged normal attack');

  assert.ok(Math.abs(targetUnit.s.def - targetUnit.base.def * 1.2) < 1e-6, 'native 20% DEF bonus is active');
  const hp = targetUnit.hp;
  battle.dealDamage(enemy, targetUnit, { amount: 100, type: 'true', canDodge: false, isAttack: true });
  assert.equal(targetUnit.hp, hp, 'the counted shield absorbs the complete first hit');
  assert.equal(brokenLayers, 1);
  assert.equal(targetUnit.buffs.some((buff) => buff.key === shield?.key), false, 'the one-hit shield is consumed independently');

  const player = battle.getPlayer(ownerUnit.ownerId);
  const initialDeploySeq = machine.deploySeq;
  battle.flags.dpPerSec = 0;
  player.dp = 0;
  const nativeRedeploy = battle.redeploy.bind(battle);
  let paidMachineDpDelta = null;
  battle.redeploy = (unit, options) => {
    const before = player.dp;
    const deployed = nativeRedeploy(unit, options);
    if (unit === machine && options?.free === false && deployed) paidMachineDpDelta = before - player.dp;
    return deployed;
  };
  advance(battle, Math.max(0, machine.mem.resonanceRobertaLifeUntil - battle.time + 0.1));
  assert.equal(machine.alive, false, 'the machine withdraws at its 25-second expiry');
  assert.equal(machine.removed, false, 'the anchor is retained by the native death lifecycle for paid redeploy');
  assert.ok(supportExpiresAt > battle.time + battle.dt, 'support begins later than the device lifetime');
  assert.ok(targetUnit.buffs.some((buff) => buff.key === defBuff?.key), 'machine expiry does not shorten the support timer');
  assert.ok(player.dp < machine.base.cost, 'no redeploy occurs while native DP is insufficient');
  advance(battle, 0.5);
  assert.equal(machine.deploySeq, initialDeploySeq, 'the anchor waits for sufficient DP');
  advance(battle, Math.max(0, supportExpiresAt - battle.time + 0.1));
  assert.equal(targetUnit.buffs.some((buff) => buff.key === defBuff?.key), false, 'DEF expires on its own 25-second timer');
  player.dp = machine.base.cost;
  advance(battle, 0.3);
  assert.ok(machine.deploySeq > initialDeploySeq, 'the first stocked redeploy uses Battle.redeploy');
  assert.equal(paidMachineDpDelta, machine.base.cost, 'the native redeploy charges exactly the token cost of five DP');
  assert.equal(ownerUnit.mem.resonanceRobertaStock, 1, 'each paid redeploy consumes one native stock');
  assert.equal(machine.profile.noAttack, true);
  assert.equal(machineAttacks, 0);
  assert.equal(battle.errorCount, 0);
});

test('Roberta anchor uses the remaining native stock twice, stops at zero, and owner departure clears support', () => {
  const { data, catalog, state, owner, target, placement } = fixture();
  const { battle } = buildResonanceBattle(state, { data, catalog, preview: true });
  battle.timeLimit = 150;
  const ownerUnit = battle.allyUnits.find((unit) => unit.uid === owner.uid);
  const targetUnit = battle.allyUnits.find((unit) => unit.uid === target.uid);
  const machine = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.defId === MACHINE && unit.ownerUnit === ownerUnit);
  const enemy = battle.spawnEnemy('roberta-cycle-test', { pos: placement.target, def: enemyRec({ key: 'roberta-cycle-test', hp: 1e9, atk: 0, speed: 0 }) });
  battle.start();
  assert.equal(battle.moveRedeploy(targetUnit, placement.target[0], placement.target[1]), true);
  const player = battle.getPlayer(ownerUnit.ownerId);
  battle.flags.dpPerSec = 0;
  player.dp = 100;
  let attacks = 0;
  battle.on('attack', ({ attacker }) => { if (attacker === machine) attacks++; });
  for (let paid = 1; paid <= 2; paid++) {
    advance(battle, 25.5);
    assert.equal(machine.alive, true, `paid deployment ${paid} is active`);
    assert.equal(machine.mem.resonanceRobertaPaidRedeploys, paid, `paid deployment ${paid} reuses the one anchor (time=${battle.time}, count=${machine.mem.resonanceRobertaPaidRedeploys}, until=${machine.mem.resonanceRobertaLifeUntil}, stock=${ownerUnit.mem.resonanceRobertaStock})`);
    assert.equal(ownerUnit.mem.resonanceRobertaStock, 2 - paid);
    assert.equal(targetUnit.buffs.filter((buff) => buff.key.startsWith('native:robrta:def:')).length, 1,
      'sequential devices never stack defense on the same target');
  }
  advance(battle, 26);
  assert.equal(machine.alive, false, 'the last device expires normally');
  assert.equal(machine.mem.resonanceRobertaPaidRedeploys, 2, 'the third device is the final use of the initial native stock');
  assert.equal(ownerUnit.mem.resonanceRobertaStock, 0);
  assert.equal(attacks, 0);
  assert.ok(enemy);

  const second = fixture();
  const otherBattle = buildResonanceBattle(second.state, { data: second.data, catalog: second.catalog, preview: true }).battle;
  otherBattle.timeLimit = 80;
  const otherOwner = otherBattle.allyUnits.find((unit) => unit.uid === second.owner.uid);
  const otherTarget = otherBattle.allyUnits.find((unit) => unit.uid === second.target.uid);
  const otherMachine = otherBattle.allyUnits.find((unit) => unit.kind === 'token' && unit.defId === MACHINE && unit.ownerUnit === otherOwner);
  otherBattle.spawnEnemy('roberta-owner-exit-test', { pos: second.placement.target, def: enemyRec({ key: 'roberta-owner-exit-test', hp: 1e9, atk: 0, speed: 0 }) });
  otherBattle.start();
  assert.equal(otherBattle.moveRedeploy(otherTarget, second.placement.target[0], second.placement.target[1]), true);
  advance(otherBattle, 0.3);
  const supported = [otherTarget, otherOwner].find((unit) => unit.buffs.some((buff) => buff.key.startsWith('native:robrta:def:')));
  assert.ok(supported, 'one in-range melee operator, including the owner if applicable, receives support');
  otherBattle.retreat(otherOwner, { reason: 'owner-test-retreat' });
  assert.equal(otherMachine.alive, false, 'owner departure withdraws the anchor');
  assert.equal([otherTarget, otherOwner].some((unit) => unit.buffs.some((buff) => buff.key.startsWith('native:robrta:'))), false,
    'owner departure removes both defense and shield granted by the device');
  assert.equal(otherMachine.removed, false, 'owner departure retains the single anchor for native redeploy');
  const otherPlayer = otherBattle.getPlayer(otherOwner.ownerId);
  otherBattle.flags.dpPerSec = 0;
  otherPlayer.dp = 100;
  assert.equal(otherBattle.redeploy(otherOwner, { free: true }), true, 'owner returns through the native redeploy API');
  assert.equal(otherOwner.mem.resonanceRobertaStock, 3, 'owner deploy replenishes exactly its native stock cap');
  const nativeRedeploy = otherBattle.redeploy.bind(otherBattle);
  let paidMachineDpDelta = null;
  otherBattle.redeploy = (unit, options) => {
    const before = otherPlayer.dp;
    const deployed = nativeRedeploy(unit, options);
    if (unit === otherMachine && options?.free === false && deployed) paidMachineDpDelta = before - otherPlayer.dp;
    return deployed;
  };
  advance(otherBattle, 14);
  assert.equal(otherMachine.alive, false, 'the 15-second native cooldown is still enforced');
  advance(otherBattle, 1.5);
  assert.equal(otherMachine.alive, true, 'the anchor redeploys after cooldown and owner return');
  assert.equal(otherOwner.mem.resonanceRobertaStock, 2);
  assert.equal(paidMachineDpDelta, otherMachine.base.cost, 'redeploy spends the native five DP');
  assert.equal(otherBattle.errorCount, 0);
});

test('real resonance settlement reports Roberta native support parameters without errors', () => {
  const { data, catalog, state, target, placement } = fixture();
  const supportedPiece = state.pieces.find((piece) => piece.uid === target.uid);
  supportedPiece.row = placement.target[0];
  supportedPiece.col = placement.target[1];
  const output = runResonanceBattle(state, { data, catalog, recording: true });
  assert.equal(output.diagnostics.errorCount, 0);
  const support = output.diagnostics.robertaMachines.find((entry) => entry.kind === 'support');
  assert.ok(support, `terminal Battle contains a real Roberta support event: ${JSON.stringify({ events: output.diagnostics.robertaMachines, anchors: output.diagnostics.summonAnchors, gaps: output.diagnostics.summonAnchorGaps, stageId: output.diagnostics.stageId, round: output.diagnostics.round })}`);
  assert.equal(support.targetUid, target.uid);
  assert.equal(support.defPct, 0.2);
  assert.equal(support.shieldHits, 1);
  assert.equal(support.duration, 25);
  assert.ok(output.diagnostics.robertaMachines.some((entry) => entry.kind === 'stock_spent' && entry.freeAnchor === true));
  const unitStats = Object.values(output.result.perPlayer ?? {}).flatMap((player) => player.unitStats ?? []);
  const machineStats = unitStats.find((entry) => entry.uid === support.tokenUid);
  assert.ok(machineStats, 'the settlement includes the real machine unit statistics');
  assert.equal(machineStats.defId, MACHINE, 'the matched statistics belong to the Roberta machine token');
  assert.equal(machineStats.attacks, 0, 'the machine does not perform ordinary attacks in a real settlement');
});

test('Roberta support remains active without recording lifecycle events in recording:false battles', () => {
  const { data, catalog, state, target, placement } = fixture();
  const supportedPiece = state.pieces.find((piece) => piece.uid === target.uid);
  [supportedPiece.row, supportedPiece.col] = placement.target;
  const output = runResonanceBattle(state, { data, catalog, recording: false });
  assert.equal(output.diagnostics.errorCount, 0);
  assert.ok(output.metrics.triggers.roberta_machine_support > 0, 'the live support still contributes its final counter');
  assert.deepEqual(output.diagnostics.robertaMachines, [], 'headless balancing keeps no device event trace');
  assert.equal(output.replay, null, 'headless balancing keeps no replay');
  const machine = Object.values(output.result.perPlayer).flatMap((player) => player.unitStats).find((entry) => entry.kind === 'token' && entry.defId === MACHINE);
  assert.ok(machine);
  assert.equal(machine.attacks, 0);
});
