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
