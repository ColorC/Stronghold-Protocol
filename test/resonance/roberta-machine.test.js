import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { applyAction, createSession, validateSession } from '../../server/modes/resonance/session.js';
import { buildResonanceBattle, getResonanceField } from '../../server/modes/resonance/battle.js';
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
  assert.equal(battle.moveRedeploy(targetUnit, placement.target[0], placement.target[1]), true,
    'native movement/deploy lifecycle brings an eligible ally into range');
  advance(battle, 0.3);

  const defBuff = targetUnit.buffs.find((buff) => buff.key === `native:robrta:def:${machine.id}`);
  const shield = targetUnit.buffs.find((buff) => buff.key === `native:robrta:shield:${machine.id}`);
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
  assert.equal(unrelatedWolf.profile.noAttack, false, 'the resonance effect does not rewrite other token profiles');
  assert.notEqual(unrelatedWolf.s.flags.untargetable, true, 'other token targetability is unchanged');

  assert.equal(canTargetAlly(enemy, machine, false), false, 'enemy targeting excludes the device');
  advance(battle, 1);
  assert.equal(machineAttacks, 0, 'machine never performs its native ranged normal attack');

  assert.ok(Math.abs(targetUnit.s.def - targetUnit.base.def * 1.2) < 1e-6, 'native 20% DEF bonus is active');
  const hp = targetUnit.hp;
  battle.dealDamage(enemy, targetUnit, { amount: 100, type: 'true', canDodge: false, isAttack: true });
  assert.equal(targetUnit.hp, hp, 'the counted shield absorbs the complete first hit');
  assert.equal(brokenLayers, 1);
  assert.equal(targetUnit.buffs.some((buff) => buff.key === shield?.key), false, 'the one-hit shield is consumed independently');

  battle.kill(machine, enemy);
  assert.equal(machine.alive, false, 'machine death follows the native Battle lifecycle');
  assert.ok(targetUnit.buffs.some((buff) => buff.key === defBuff?.key), 'already granted DEF remains until its own timer expires');
  advance(battle, 23);
  assert.ok(targetUnit.buffs.some((buff) => buff.key === defBuff?.key), 'the 25-second buff survives until its expiry window');
  advance(battle, 2);
  assert.equal(targetUnit.buffs.some((buff) => buff.key === defBuff?.key), false, `DEF expires after 25 seconds (time=${battle.time}, left=${defBuff?.timeLeft})`);
  assert.equal(machineAttacks, 0);
  assert.equal(battle.errorCount, 0);
});
