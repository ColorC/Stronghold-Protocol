// test/helpers/synergyFixture.js — a small assault battle of synthetic operators for synergy primitive tests.
// makeBattle({ ops: [{ id, profession, row, col, respawn, castOnDeploy, labels }], enemies: [{ pos, fly }], redeployCycle })
// → { battle, op(id), flush, run(seconds), casts }. Real cards: test/helpers/synergyCard.js.
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from './battleHarness.js';

export const ENEMY = 'enemy_synergy';
export const FLYER = 'enemy_synergy_fly';

/** Assault battle with fixture operators: `ops` = [{ id, profession, row, col, respawn, castOnDeploy }]. */
export function makeBattle({ ops = [{ id: 'a' }], enemies = [], timeLimit = 300, redeployCycle } = {}) {
  const chess = {}, kits = {}, units = [], labels = {};
  const casts = {};
  for (const [i, op] of ops.entries()) {
    const chessId = `chess_syn_${op.id}`, charId = `char_syn_${op.id}`;
    chess[chessId] = chessRec({ id: chessId, charId, profession: op.profession ?? 'WARRIOR', subProfessionId: op.sub ?? null,
      stats: { cost: 0, respawnTime: op.respawn ?? 20, blockCnt: 2, spRecovery: 1, maxHp: 2000 },
      skill: { skillId: `sk_${op.id}`, spCost: 1000, initSp: 0, spType: 'INCREASE_WITH_TIME' } });
    casts[op.id] = 0;
    kits[charId] = () => ({ skill: { id: `syn-${op.id}`, kind: 'instant', spCost: 1000, trigger: 'SP_FULL',
      ...(op.castOnDeploy ? { castOnDeploy: true } : null), assaultCast: () => { casts[op.id]++; } } });
    units.push({ uid: `u-${op.id}`, chessId, row: op.row ?? 10, col: op.col ?? 3 + i });
    if (op.labels) labels[`u-${op.id}`] = op.labels;
  }
  const data = new DataSource({ chess, enemies: {
    [ENEMY]: enemyRec({ key: ENEMY, hp: 1e6, speed: 0, rangeRadius: 0 }),
    [FLYER]: enemyRec({ key: FLYER, hp: 1e6, speed: 0, rangeRadius: 0, motion: 'FLY' }),
  } }, getDefaultSource());
  const battle = new Battle({ kind: 'normal', modeId: 'assault-synergy', stage: flatStage(), routes: flatRoutes(), spawns: [], data,
    players: [{ playerId: 'p1', units }], content: 'assault', assault: { kits, strict: true, ...(redeployCycle == null ? null : { redeployCycle }) },
    flags: { dpInit: 99, dpPerSec: 1, dpMax: 99, startOpCooldown: 0 }, autoFinish: false, timeLimit,
    quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  // class words (「你的某类干员」) of the fixture operators, as a compiled card carries them
  for (const u of battle.allyUnits) if (labels[u.uid]) u.def = { ...u.def, raw: { ...(u.def.raw ?? {}), assaultBody: { ...(u.def.raw?.assaultBody ?? {}), bazaar: { labels: labels[u.uid] } } } };
  battle.start();
  // the fixture enemies stand where the test puts them from the first tick on (a scheduled spawn waits for a step)
  for (const e of enemies) battle.spawnEnemy(e.fly ? FLYER : ENEMY, { routeIndex: e.fly ? 2 : 0, pos: e.pos });
  const op = (id) => battle.allyUnits.find((x) => x.uid === `u-${id}`);
  const flush = () => battle.assaultRuntime.flush();
  const run = (seconds) => { const n = Math.round(seconds / battle.dt); for (let i = 0; i < n; i++) battle.step(); };
  return { battle, op, flush, run, casts };
}
