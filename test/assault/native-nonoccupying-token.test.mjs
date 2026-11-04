import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { installRelics } from '../../server/sim/content/assault/relics.js';
import { grantSummon } from '../../server/sim/content/assault/summons.js';
import { loadAssaultDesign } from '../../server/modes/assault/data.js';

const design = loadAssaultDesign();
const TOKEN = 'token_nonoccupying_fixture';
const OWNER = 'char_nonoccupying_owner';
const OTHER = 'char_nonoccupying_other';
const CHESS_OWNER = 'chess_nonoccupying_owner';
const CHESS_OTHER = 'chess_nonoccupying_other';
const ENEMY = 'enemy_nonoccupying_fixture';
const tokenDef = { tokenId: TOKEN, name: 'fixture token', profession: 'TOKEN', position: 'MELEE',
  stats: { maxHp: 300, atk: 10, def: 0, res: 0, cost: 0, blockCnt: 3, bat: 1, aspd: 100, respawnTime: 0, spRecovery: 0 }, rangeGrid: [[0, 0]] };

function makeBattle({ kind = 'normal', tokenPosition = 'MELEE', placement = null } = {}) {
  const chess = {
    [CHESS_OWNER]: chessRec({ id: CHESS_OWNER, charId: OWNER, profession: 'SUPPORT', stats: { cost: 1 }, skill: { skillId: 'fixture-skill-owner', spCost: 30, initSp: 0, spType: 'INCREASE_WITH_TIME' } }),
    [CHESS_OTHER]: chessRec({ id: CHESS_OTHER, charId: OTHER, profession: 'SUPPORT', stats: { cost: 1 }, skill: { skillId: 'fixture-skill-other', spCost: 30, initSp: 0, spType: 'INCREASE_WITH_TIME' } }),
  };
  const tokenRecord = { ...tokenDef, position: tokenPosition, ...(placement ? { sourceTemplate: { assaultPlacementClass: placement } } : null) };
  const data = new DataSource({ chess, tokens: { [TOKEN]: tokenRecord }, enemies: { [ENEMY]: enemyRec({ key: ENEMY, hp: 1000, speed: 0 }) } }, getDefaultSource());
  const kits = {
    [OWNER]: () => ({ skill: { id: 'fixture-skill-owner', kind: 'instant', spCost: 30, trigger: 'SP_FULL', assaultCast() {} } }),
    [OTHER]: () => ({ skill: { id: 'fixture-skill-other', kind: 'instant', spCost: 30, trigger: 'SP_FULL', assaultCast() {} } }),
    [TOKEN]: () => ({}),
  };
  const players = [{ playerId: 'p1', units: [
    { uid: 'nonoccupying-owner', chessId: CHESS_OWNER, row: 10, col: 5 },
    { uid: 'nonoccupying-operator', chessId: CHESS_OTHER, row: 10, col: 6 },
  ] }];
  const prepared = { input: { relicIds: [], pieces: players[0].units.map(({ uid }) => ({ uid })), gold: 0 } };
  const battle = new Battle({ kind, modeId: 'native-nonoccupying-token', stage: flatStage(), routes: flatRoutes(kind), spawns: [], data,
    players, content: 'assault', assault: { kits, strict: true, install: (b) => installRelics(b, prepared, { design }) },
    flags: { dpInit: 99, dpPerSec: 0, dpMax: 99, startOpCooldown: 0 }, autoFinish: false, timeLimit: 60,
    quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  return { battle, owner: battle.allyUnits.find((unit) => unit.uid === 'nonoccupying-owner'), operator: battle.allyUnits.find((unit) => unit.uid === 'nonoccupying-operator') };
}

function summon(battle, owner, extra = {}) {
  const operator = battle.allyUnits.find((unit) => unit.kind === 'op' && unit !== owner && unit.ownerId === owner.ownerId);
  return grantSummon(battle, owner, { tokenId: TOKEN, count: 1, stockCap: 1, fieldCap: 1, cost: 0, anySource: true,
    ruleKey: extra.ruleKey ?? 'native-nonoccupying', preparedSlot: extra.preparedSlot ?? [operator.tileR, operator.tileC],
    ...(extra.occupiesTile === undefined ? null : { occupiesTile: extra.occupiesTile }), ...(extra.duration === undefined ? null : { duration: extra.duration }) });
}

test('nonoccupying summon shares only its live owner operator tile and survives native movement', { timeout: 30_000 }, () => {
  const { battle, owner, operator } = makeBattle();
  const result = summon(battle, owner, { occupiesTile: false });
  assert.deepEqual(result, { granted: 1, spawned: 1, pending: 0, rejected: 0 });
  const token = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.ownerUnit === owner && unit.alive);
  assert.ok(token && (token.uid ?? token.id));
  assert.equal(token.side, 'ally');
  assert.equal(token.deployed, true);
  assert.equal(token.occupiesTile, false);
  assert.equal(token.s.blockCnt, 0);
  assert.equal(battle.unitAt(10, 6), operator);
  assert.equal(battle.snapshot().units.some((unit) => unit[0] === token.id), true);

  assert.equal(battle.relocate(token, 10, 7), true);
  assert.equal(battle.unitAt(10, 6), operator, 'leaving the shared tile cannot clear its operator');
  assert.equal(battle.unitAt(10, 7), null, 'a nonoccupying token never enters _occ');
  assert.equal(battle.relocate(operator, 10, 7), true, 'an operator can move onto a live token tile');
  assert.equal(battle.unitAt(10, 7), operator);
  assert.equal(battle.relocate(token, 10, 7), true, 'the token can move onto its same-owner active operator');
  assert.equal(battle.unitAt(10, 7), operator, 'token relocation cannot overwrite the operator');
  assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
});

test('retreat, death and native duration expiry never clear a shared operator or leave a down body', { timeout: 30_000 }, () => {
  for (const ending of ['retreat', 'death', 'expiry']) {
    const { battle, owner, operator } = makeBattle();
    assert.equal(summon(battle, owner, { occupiesTile: false, ruleKey: `end-${ending}`, ...(ending === 'expiry' ? { duration: 0.05 } : null) }).spawned, 1);
    const token = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.ownerUnit === owner && unit.alive);
    assert.ok(token);
    if (ending === 'retreat') battle.retreat(token, { reason: 'fixtureReturn', permanent: true });
    if (ending === 'death') battle.kill(token);
    if (ending === 'expiry') for (let i = 0; i < 10 && token.alive; i++) battle.step();
    assert.equal(token.alive, false, `${ending} removes the native summon`);
    assert.equal(token.removed, true);
    assert.equal(battle.unitAt(10, 6), operator, `${ending} preserves operator occupancy`);
    assert.equal(battle.downOn(10, 6), null, 'tokens do not create operator down bodies');
    assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
  }
});

test('nonoccupying grant preserves native obstacle and own-board placement checks', { timeout: 30_000 }, () => {
  const { battle, owner } = makeBattle();
  battle.grid.setObstacle(10, 7, true);
  assert.equal(summon(battle, owner, { occupiesTile: false, ruleKey: 'obstacle-fallback', preparedSlot: [10, 7] }).spawned, 1);
  const token = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.alive);
  assert.ok(token);
  assert.notDeepEqual([token.tileR, token.tileC], [10, 7]);
  assert.equal(battle.grid.isObstacle(token.tileR, token.tileC), false);
  assert.equal(battle.onOwnBoard(owner.player, token.tileR, token.tileC), true);
});

test('default summons still occupy; nonoccupying grants reject devices, enemy units, down tiles and foreign operators', { timeout: 30_000 }, () => {
  {
    const { battle, owner } = makeBattle();
    assert.ok(battle.spawnToken(owner, TOKEN, 10, 7, { anySource: true }));
    const token = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.alive);
    assert.equal(token.occupiesTile, true);
    assert.equal(token.s.blockCnt, 3);
    assert.equal(battle.unitAt(10, 7), token);
  }
  {
    const { battle, owner, operator } = makeBattle();
    assert.equal(battle.spawnDevice('native-device', 10, 7, { hp: 100 })?.kind, 'device');
    assert.equal(battle.spawnEnemy(ENEMY, { pos: [10, 8], routeIndex: 0 })?.side, 'enemy');
    const movingResult = summon(battle, owner, { occupiesTile: false, ruleKey: 'move-negative', preparedSlot: [10, 9] });
    const movingToken = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.alive);
    assert.ok(movingToken, JSON.stringify(movingResult));
    assert.equal(battle.relocate(movingToken, 10, 8), false, 'nonoccupying tokens cannot move onto enemy bodies');
    assert.equal(battle.spawnToken({ kind: 'op', ownerId: 'foreign-player', player: null }, TOKEN, 10, 6, { occupiesTile: false, anySource: true }), null, 'foreign owner cannot share another operator');
    assert.equal(battle.spawnToken(owner, TOKEN, 10, 7, { occupiesTile: false, anySource: true }), null, 'device tiles remain exclusive');
    assert.equal(battle.spawnToken(owner, TOKEN, 10, 8, { occupiesTile: false, anySource: true }), null, 'enemy bodies remain exclusive');
    battle.kill(operator);
    assert.ok(battle.downOn(10, 6));
    assert.equal(battle.spawnToken(owner, TOKEN, 10, 6, { occupiesTile: false, anySource: true }), null, 'down tiles remain exclusive');
    assert.equal(battle.unitAt(10, 7)?.kind, 'device');
    assert.ok(battle.enemies.some((enemy) => enemy.alive && enemy.y === 10 && enemy.x === 8));
  }
});



test('occupancy checks are symmetric and same-owner operators deploy natively onto a token tile', { timeout: 30_000 }, () => {
  const { battle, owner, operator } = makeBattle();
  const result = summon(battle, owner, { occupiesTile: false, ruleKey: 'symmetric', preparedSlot: [10, 7] });
  const token = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.alive);
  assert.ok(token);
  assert.equal(battle.unitAt(10, 7), null);
  assert.equal(battle.spawnDevice('blocked-by-token', 10, 7, { hp: 50 }), null, 'device spawn cannot enter a nonoccupying token tile');
  assert.equal(battle.spawnToken(owner, TOKEN, 10, 7, { anySource: true }), null, 'ordinary token cannot enter a drone tile');

  const reserve = battle._makeAlly(battle.getPlayer(owner.ownerId), owner.def, 'op', 10, 6, { uid: 'native-deploy-over-token' });
  battle._setupUnit(reserve);
  assert.equal(battle._deploy(reserve, { initial: false, free: true, tile: [10, 7] }), true);
  assert.equal(battle.unitAt(10, 7), reserve, 'operator occupancy remains authoritative');
  const second = battle._makeAlly(battle.getPlayer(owner.ownerId), owner.def, 'op', 10, 6, { uid: 'native-second-deploy-over-token' });
  battle._setupUnit(second);
  assert.equal(battle._deploy(second, { initial: false, free: true, tile: [10, 7] }), false, 'a second operator cannot displace the first on a token tile');
  assert.equal(battle.relocate(operator, 10, 7), false, 'relocate cannot enter op+token occupied tile');
  assert.equal(battle.unitAt(10, 7), reserve, 'the original operator remains in _occ');
  const waiting = battle._makeAlly(battle.getPlayer(owner.ownerId), owner.def, 'op', 10, 8, { uid: 'native-waiting-rest-reservation' });
  battle._setupUnit(waiting);
  assert.equal(waiting.deployed, false);
  assert.equal(battle.relocate(token, 10, 8), false, 'token relocation respects a waiting operator rest tile');

  const movedToken = battle.allyUnits.find((unit) => unit === token);
  battle.grid.setObstacle(10, 8, true);
  assert.equal(battle.relocate(movedToken, 10, 8), false, 'token relocation respects blocking terrain');
  assert.equal(battle.unitAt(10, 7), reserve);
});
test('unite nonoccupying entry paths reject a real walkable tile outside the owner board', { timeout: 30_000 }, () => {
  const { battle, owner, operator } = makeBattle({ kind: 'unite' });
  const outside = [];
  for (let r = battle.rect.r0; r <= battle.rect.r1; r++) for (let c = battle.rect.c0; c <= battle.rect.c1; c++) {
    if (battle.grid.inRect(r, c) && battle.grid.canStand(r, c, { ranged: true }) && !battle.grid.isObstacle(r, c)
      && !battle.unitAt(r, c) && !battle.onOwnBoard(owner.player, r, c)) outside.push([r, c]);
  }
  assert.ok(outside.length, 'unite flat field supplies real passable, non-owner-board cells');
  const [row, col] = outside[0];
  assert.equal(battle.grid.inRect(row, col), true);
  assert.equal(battle.grid.canStand(row, col, { ranged: true }), true);
  assert.equal(battle.onOwnBoard(owner.player, row, col), false);
  assert.equal(battle.spawnToken(owner, TOKEN, row, col, { occupiesTile: false, anySource: true }), null);

  const pending = battle._makeAlly(battle.getPlayer(owner.ownerId), battle.tokenDef(TOKEN, owner), 'token', row, col, { ownerUnit: owner });
  battle._setupUnit(pending);
  pending.occupiesTile = false;
  pending.base.blockCnt = 0;
  assert.equal(battle._deploy(pending, { initial: false, free: true, tile: [row, col] }), false);

  const { spawned } = summon(battle, owner, { occupiesTile: false, ruleKey: 'outside-relocate-control' });
  assert.equal(spawned, 1);
  const token = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.alive);
  assert.ok(token);
  assert.equal(battle.relocate(token, row, col), false);
  assert.equal(battle.unitAt(operator.tileR, operator.tileC), operator);
});

test('sourceTemplate all can move low-to-high, while strict melee cannot spawn, deploy or move onto high terrain', { timeout: 30_000 }, () => {
  const rangedBattle = makeBattle({ placement: 'all' });
  const rangedToken = summon(rangedBattle.battle, rangedBattle.owner, { occupiesTile: false, ruleKey: 'all-terrain-positive' });
  assert.equal(rangedToken.spawned, 1);
  const token = rangedBattle.battle.allyUnits.find((unit) => unit.kind === 'token' && unit.alive);
  const high = [10, 2];
  assert.equal(rangedBattle.battle.grid.tile(...high).height, 'HIGH');
  assert.equal(rangedBattle.battle.grid.canStand(...high, { ranged: true }), true);
  assert.equal(rangedBattle.battle.relocate(token, ...high), true);
  const low = [10, 3];
  assert.equal(rangedBattle.battle.grid.tile(...low).height, 'LOW');
  assert.equal(rangedBattle.battle.relocate(token, ...low), true);

  const melee = makeBattle();
  const { battle, owner, operator } = melee;
  assert.equal(battle.grid.tile(...high).height, 'HIGH');
  assert.equal(battle.grid.canStand(...high), false);
  assert.equal(battle.spawnToken(owner, TOKEN, ...high, { occupiesTile: false, anySource: true }), null);
  const illegal = battle._makeAlly(battle.getPlayer(owner.ownerId), battle.tokenDef(TOKEN, owner), 'token', ...high, { ownerUnit: owner });
  battle._setupUnit(illegal); illegal.occupiesTile = false; illegal.base.blockCnt = 0;
  assert.equal(battle._deploy(illegal, { initial: false, free: true, tile: high }), false);
  const legalToken = summon(battle, owner, { occupiesTile: false, ruleKey: 'melee-high-negative' });
  assert.equal(legalToken.spawned, 1);
  const deployed = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.alive);
  assert.equal(battle.relocate(deployed, ...high), false);
  assert.equal(battle.unitAt(operator.tileR, operator.tileC), operator);
});
