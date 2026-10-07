import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';

const chess = JSON.parse(fs.readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
const tokens = JSON.parse(fs.readFileSync(new URL('../../data/tokens.json', import.meta.url), 'utf8'));
const ownerA = Object.values(chess).find((rec) => rec.charId === 'char_242_otter' && rec.chessId.endsWith('_a'));
const tokenId = 'token_10004_otter_motter';
const rawToken = tokens[tokenId];
const enemyKey = 'enemy_dummy';

// Pinned character_table.json a550f5e048bb94e7cdefc6eb97a4091f0c4c7add:
// token_10004_otter_motter phase 1 is 1250/280/290 at Lv1 and 1480/350/350 at Lv70;
// phase 2 is 1530/370/360 at Lv1 and 1950/444/415 at Lv80.
const nativeGrowth = {
  source: { table: 'character_table.json', revision: 'a550f5e048bb94e7cdefc6eb97a4091f0c4c7add' },
  phases: [
    { phase: 0, maxLevel: 50, attributesKeyFrames: [{ level: 1, data: { maxHp: 975, atk: 185, def: 175, magicResistance: 0, cost: 5, blockCnt: 1, moveSpeed: 1, attackSpeed: 100, baseAttackTime: 1, respawnTime: 10, spRecoveryPerSec: 1, hpRecoveryPerSec: 0, maxDeployCount: 4, maxDeckStackCnt: 0, tauntLevel: 0, massLevel: 0 } }, { level: 50, data: { maxHp: 1150, atk: 263, def: 280, magicResistance: 0, cost: 5, blockCnt: 1, moveSpeed: 1, attackSpeed: 100, baseAttackTime: 1, respawnTime: 10, spRecoveryPerSec: 1, hpRecoveryPerSec: 0, maxDeployCount: 4, maxDeckStackCnt: 0, tauntLevel: 0, massLevel: 0 } }] },
    { phase: 1, maxLevel: 70, attributesKeyFrames: [{ level: 1, data: { maxHp: 1250, atk: 280, def: 290, magicResistance: 0, cost: 5, blockCnt: 1, moveSpeed: 1, attackSpeed: 100, baseAttackTime: 1.25, respawnTime: 10, spRecoveryPerSec: 1, hpRecoveryPerSec: 0, maxDeployCount: 4, maxDeckStackCnt: 0, tauntLevel: 0, massLevel: 0 } }, { level: 70, data: { maxHp: 1480, atk: 350, def: 350, magicResistance: 0, cost: 5, blockCnt: 1, moveSpeed: 1, attackSpeed: 100, baseAttackTime: 1.25, respawnTime: 10, spRecoveryPerSec: 1, hpRecoveryPerSec: 0, maxDeployCount: 4, maxDeckStackCnt: 0, tauntLevel: 0, massLevel: 0 } }] },
    { phase: 2, maxLevel: 80, attributesKeyFrames: [{ level: 1, data: { maxHp: 1530, atk: 370, def: 360, magicResistance: 0, cost: 5, blockCnt: 1, moveSpeed: 1, attackSpeed: 100, baseAttackTime: 1.25, respawnTime: 10, spRecoveryPerSec: 1, hpRecoveryPerSec: 0, maxDeployCount: 5, maxDeckStackCnt: 0, tauntLevel: 0, massLevel: 0 } }, { level: 80, data: { maxHp: 1950, atk: 444, def: 415, magicResistance: 0, cost: 5, blockCnt: 1, moveSpeed: 1, attackSpeed: 100, baseAttackTime: 1.25, respawnTime: 10, spRecoveryPerSec: 1, hpRecoveryPerSec: 0, maxDeployCount: 5, maxDeckStackCnt: 0, tauntLevel: 0, massLevel: 0 } }] },
  ],
};

function dataSource() {
  assert.ok(ownerA, 'Mayer ordinary native owner row exists');
  const token = { ...rawToken, nativeGrowth };
  return new DataSource({ chess: { [ownerA.chessId]: ownerA }, tokens: { [tokenId]: token }, enemies: { [enemyKey]: enemyRec({ key: enemyKey, hp: 1e7, speed: 0 }) } }, getDefaultSource());
}

function makeTokenBattle() {
  const data = dataSource();
  const battle = makeBattle({ data, units: [{ chessId: ownerA.chessId, row: 10, col: 5 }], enemies: [{ key: enemyKey, pos: [10, 8] }], flags: { dpPerSec: 0, dpMax: 999 } });
  return { battle, unit: battle.unit(ownerA.chessId) };
}

test('native token phase and level resolve from the owning operator instead of staying at its preset cap', () => {
  const data = dataSource();
  const defaultDef = data.getToken(tokenId, ownerA.chessId);
  const levelOneDef = data.getToken(tokenId, ownerA.chessId, null, { phase: 1, level: 1 });
  const eliteDef = data.getToken(tokenId, ownerA.chessId, null, { phase: 2, level: 50 });

  // Default phase/level matches the already-built native Mayer E1 Lv55 variant (1430 HP).
  assert.equal(defaultDef.stats.maxHp, 1430);
  assert.equal(defaultDef.stats.atk, 335);
  assert.equal(levelOneDef.stats.maxHp, 1250);
  assert.equal(levelOneDef.stats.atk, 280);
  assert.equal(levelOneDef.stats.def, 290);
  assert.equal(eliteDef.stats.maxHp, 1791);
  assert.equal(eliteDef.stats.atk, 416);
  assert.equal(eliteDef.stats.def, 394);
  assert.equal(levelOneDef.count, defaultDef.count, 'level growth does not replace owner count');
  assert.deepEqual(levelOneDef.sources, defaultDef.sources, 'level growth preserves native source/loadout eligibility');
});

test('native token level growth retains generated default and selected module adjustments over table baseline', () => {
  const owner = structuredClone(ownerA);
  owner.modules = [{ uniEquipId: 'uniequip_native_fixture', name: 'fixture module', isDefault: false }];
  const token = structuredClone(rawToken);
  const base = token.variants[owner.chessId];
  base.stats.atk += 50;
  base.stats.deployLimit = 6;
  base.count = 6;
  base.byModule = {
    ...base.byModule,
    uniequip_native_fixture: {
      stats: { ...base.stats, atk: base.stats.atk + 100, deployLimit: 8 },
      count: 8,
    },
  };
  const data = new DataSource({ chess: { [owner.chessId]: owner }, tokens: { [tokenId]: { ...token, nativeGrowth } }, enemies: {} }, getDefaultSource());
  const defaultLevelOne = data.getToken(tokenId, owner.chessId, null, { phase: 1, level: 1 });
  const moduleLevelOne = data.getToken(tokenId, owner.chessId, { moduleId: 'uniequip_native_fixture' }, { phase: 1, level: 1 });

  assert.equal(defaultLevelOne.stats.atk, 330, 'Lv1 table ATK 280 keeps the generated default +50 ATK adjustment');
  assert.equal(defaultLevelOne.count, 6, 'the generated default deploy-count override remains intact');
  assert.equal(moduleLevelOne.stats.atk, 430, 'Lv1 table ATK keeps both default +50 and selected module +100');
  assert.equal(moduleLevelOne.count, 8, 'module-selected deploy count remains intact');
});

test('native battle token spawn consumes the runtime owner phase and level', () => {
  const { battle, unit } = makeTokenBattle();
  assert.equal(battle.b.tokenDef(tokenId, unit, { phase: 1, level: 1 }).stats.maxHp, 1250);
  const token = battle.b.spawnToken(unit, tokenId, 10, 7, { ownerGrowth: { phase: 1, level: 1 } });
  assert.ok(token);
  assert.equal(token.base.maxHp, 1250, `spawned def=${JSON.stringify(token.def.stats)} rawGrowth=${!!token.def.raw?.nativeGrowth}`);
  assert.equal(token.s.maxHp, 1250);
  assert.equal(token.base.atk, 280);
  battle.invariants();
});

test('native board token input carries the operator runtime phase and level through initial deployment', () => {
  const data = dataSource();
  const battle = makeBattle({
    data,
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [
      { uid: 1, chessId: ownerA.chessId, row: 10, col: 5, nativeGrowthStatus: { phase: 1, level: 1 } },
      { uid: 2, kind: 'token', tokenId, ownerUid: 1, row: 10, col: 7 },
    ] }],
    enemies: [{ key: enemyKey, pos: [10, 8] }], flags: { dpPerSec: 0, dpMax: 999 },
  });
  battle.b.start();
  const summoned = battle.allies().find((unit) => unit.kind === 'token' && unit.defId === tokenId);
  assert.ok(summoned);
  assert.equal(summoned.base.maxHp, 1250);
  assert.equal(summoned.base.atk, 280);
  battle.invariants();
});

test('native owner growth context survives death and redeployment before a later summon', () => {
  const growthStatus = { phase: 1, level: 1 };
  const battle = makeBattle({
    data: dataSource(),
    units: [{ chessId: ownerA.chessId, row: 10, col: 5, nativeGrowthStatus: growthStatus }],
    enemies: [{ key: enemyKey, pos: [10, 8] }], flags: { dpPerSec: 0, dpMax: 999 },
  });
  battle.b.start();
  const owner = battle.unit(ownerA.chessId);
  assert.deepEqual(owner.nativeGrowthStatus, growthStatus);
  battle.b.kill(owner);
  assert.equal(battle.b.redeploy(owner, { free: true, tile: [10, 4] }), true);
  assert.deepEqual(owner.nativeGrowthStatus, growthStatus);
  const token = battle.b.spawnToken(owner, tokenId, 10, 7);
  assert.ok(token);
  assert.equal(token.base.maxHp, 1250);
  assert.equal(token.base.atk, 280);
  battle.invariants();
});

test('Darkmoon native clone resolves its original operator token variant before its kit runs', () => {
  const { battle, unit: originalOwner } = makeTokenBattle();
  const growthStatus = { phase: 1, level: 1 };
  let observedGrowth = null;
  let summonedStats = null;
  let summonedGrowth = null;
  const copyDef = {
    id: 'token_darkmoon_native_mayer_fixture', name: 'native-copy-fixture',
    darkmoonNativeChessId: ownerA.chessId,
    profession: 'TOKEN', position: 'MELEE', stats: { maxHp: 100, atk: 0, def: 0, res: 0, cost: 0, blockCnt: 0 },
    nativeGrowth: null,
  };
  const copy = battle.b.spawnToken(originalOwner, copyDef.id, 10, 7, {
    def: copyDef,
    nativeGrowthStatus: growthStatus,
    kit: { install(b, copiedUnit) {
      observedGrowth = copiedUnit.nativeGrowthStatus;
      const mibo = b.spawnToken(copiedUnit, tokenId, 10, 6);
      summonedStats = mibo ? { maxHp: mibo.base.maxHp, atk: mibo.base.atk } : null;
      summonedGrowth = mibo?.nativeOwnerGrowth ?? null;
    } },
  });

  assert.ok(copy);
  assert.deepEqual(observedGrowth, growthStatus, 'nativeGrowthStatus is set before the native onDeploy kit executes');
  assert.deepEqual(summonedStats, { maxHp: 1250, atk: 280 }, 'Mibo is resolved through raw.darkmoonNativeChessId and Lv1 curve');
  assert.deepEqual(summonedGrowth, growthStatus, 'the child summon retains the clone owner growth context');
});

test('native E2 battle token spawn uses E2 keyframes and clamps to the token phase cap', () => {
  const { battle, unit } = makeTokenBattle();
  assert.equal(battle.b.tokenDef(tokenId, unit, { phase: 2, level: 90 }).stats.maxHp, 1950);
  const token = battle.b.spawnToken(unit, tokenId, 10, 7, { ownerGrowth: { phase: 2, level: 90 } });
  assert.ok(token);
  assert.equal(token.base.maxHp, 1950, 'owner Lv90 clamps to token phase maxLevel 80');
  assert.equal(token.base.atk, 444);
  assert.equal(token.base.def, 415);
  battle.invariants();
});
