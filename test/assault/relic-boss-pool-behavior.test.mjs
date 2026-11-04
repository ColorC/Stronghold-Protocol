import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { LocalBossPool } from '../../server/sim/spec.js';
import { SharedBossPool } from '../../server/match/finalAssault.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { installRelics } from '../../server/sim/content/assault/relics.js';

const design = loadAssaultDesign();
const runtimeData = loadAssaultRuntime();
getAssaultData({ runtime: runtimeData });

function makeCard() {
  const charId = 'char_1045_svash2';
  const body = runtimeData.bodies[charId];
  const piece = { uid: 'owner', charId, star: 4, fixedSkill: body.fixedSkill, moduleId: null,
    moduleChoices: {}, sourceCopies: 1, permanentFlat: {}, permanentPercent: {}, claimed: [], tagEdits: { add: [], remove: [] } };
  const chess = chessRec({ id: 'chess:owner', charId, profession: body.profession, position: body.position,
    subProf: body.subProfessionId, stats: body.starStats[3].stats, rangeGrid: body.range });
  chess.trait = structuredClone(body.simChess.trait);
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  return { piece, chess };
}

function makeBattle({ relic, pool }) {
  const { piece, chess } = makeCard();
  const data = new DataSource({ chess: { [chess.chessId]: chess }, enemies: {
    coffeeBoss: enemyRec({ key: 'coffeeBoss', hp: 1000, atk: 0, speed: 0 }),
  }, tokens: {} }, getDefaultSource());
  const prepared = { input: { relicIds: relic ? ['cross-houndcoffee'] : [], pieces: [piece], gold: 0, derivedBuffInputs: [] } };
  const battle = new Battle({ seed: 7, kind: 'boss', modeId: 'assault-coffee-boss-pool', stage: flatStage(),
    routes: flatRoutes(), spawns: [], data, sharedBoss: pool,
    players: [{ playerId: 'p1', units: [{ uid: 'owner', chessId: chess.chessId, row: 12, col: 5 }] }],
    content: 'assault', assault: { kits: assaultKits, strict: true, install: (b) => installRelics(b, prepared, { design }) },
    flags: { dpInit: 99, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 }, autoFinish: false, timeLimit: 60,
    quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  battle.assaultRuntime.flush();
  return { battle, owner: battle.allyUnits.find((unit) => unit.uid === 'owner') };
}

function flush(battle) { battle.assaultRuntime.flush(); }

for (const [poolName, makePool] of [
  ['SharedBossPool', () => new SharedBossPool(1000)],
  ['LocalBossPool', () => new LocalBossPool(1000)],
]) {
  test(`hound coffee scales ${poolName} max/current HP once and real damage kills the shared cohort`, () => {
    const pool = makePool();
    pool.damage('prior', 500);
    const { battle, owner } = makeBattle({ relic: true, pool });
    const first = battle.spawnEnemy('coffeeBoss', { tag: 'boss', routeIndex: 0, pos: [2, 10], countInTotal: false });
    const second = battle.spawnEnemy('coffeeBoss', { tag: 'boss', routeIndex: 0, pos: [5, 10], countInTotal: false });
    battle.step();
    flush(battle);

    assert.equal(pool.maxHp, 1500);
    assert.equal(pool.hp, 750, 'the original half-health ratio is preserved');
    for (const boss of [first, second]) {
      assert.equal(boss.s.maxHp, 1500);
      assert.equal(boss.hp, 750);
      if (boss === first) assert.equal(boss.buffs.some((buff) => buff.data?.maxHpMul === 1.5), true, 'the chosen boss retains its real relic marker');
    }

    const late = battle.spawnEnemy('coffeeBoss', { tag: 'boss', routeIndex: 0, pos: [8, 10], countInTotal: false });
    battle.step();
    flush(battle);
    assert.equal(pool.maxHp, 1500, 'late cohort members do not scale the pool a second time');
    assert.equal(pool.hp, 750);
    assert.equal(late.s.maxHp, 1500);
    assert.equal(late.hp, 750);

    assert.equal(battle.dealDamage(owner, first, { amount: 500, type: 'true', canDodge: false }), 500);
    assert.equal(pool.hp, 250);
    battle.step();
    flush(battle);
    assert.equal(first.hp, 250);
    assert.equal(second.hp, 250);
    assert.equal(late.hp, 250);
    assert.equal(first.alive, true);

    assert.equal(battle.dealDamage(owner, first, { amount: 250, type: 'true', canDodge: false }), 250);
    assert.equal(pool.hp, 0);
    battle.step();
    flush(battle);
    assert.equal(first.alive, false);
    assert.equal(second.alive, false);
    assert.equal(late.alive, false);
  });

  test(`without hound coffee ${poolName} retains its original pool and damage behavior`, () => {
    const pool = makePool();
    pool.damage('prior', 500);
    const { battle, owner } = makeBattle({ relic: false, pool });
    const boss = battle.spawnEnemy('coffeeBoss', { tag: 'boss', routeIndex: 0, pos: [2, 10], countInTotal: false });
    battle.step();
    flush(battle);
    assert.equal(pool.maxHp, 1000);
    assert.equal(pool.hp, 500);
    assert.equal(boss.s.maxHp, 1000);
    assert.equal(boss.hp, 500);
    assert.equal(battle.dealDamage(owner, boss, { amount: 499, type: 'true', canDodge: false }), 499);
    assert.equal(pool.hp, 1);
    assert.equal(boss.alive, true);
    assert.equal(battle.dealDamage(owner, boss, { amount: 1, type: 'true', canDodge: false }), 1);
    assert.equal(pool.hp, 0);
    battle.step();
    flush(battle);
    assert.equal(boss.alive, false);
  });
}
