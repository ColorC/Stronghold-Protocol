import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { COLS } from '../../server/sim/constants.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { KITS as nativeKits } from '../../server/sim/content/kits/index.js';
import { kits as nativeTokenKits } from '../../server/sim/content/tokens.js';
import { flatRoutes, flatStage, enemyRec } from '../helpers/battleHarness.js';

const runtime = JSON.parse(fs.readFileSync(new URL('../../data/assault-runtime.json', import.meta.url), 'utf8'));
const mergedKits = { ...nativeKits, ...nativeTokenKits, ...assaultKits };

function nativeChess(charId, uid) {
  const body = runtime.bodies[charId];
  const chess = structuredClone(body.simChess);
  chess.chessId = uid;
  chess.stats = structuredClone(body.starStats[3].stats);
  chess.rangeGrid = structuredClone(body.simChess.rangeGrid ?? body.range);
  chess.assaultPiece = { uid, charId, star: 4, fixedSkill: body.fixedSkill, moduleChoices: {}, sourceCopies: 1 };
  chess.assaultBody = body;
  return { body, chess };
}

function battleFor(charId, uid, { assault = true } = {}) {
  const { chess } = nativeChess(charId, uid);
  const data = new DataSource({ chess: { [uid]: chess }, enemies: runtime.auxiliaryEnemies, tokens: runtime.summons }, getDefaultSource());
  return new Battle({ kind: 'normal', modeId: `tactician-fallback-${uid}`, seed: 4927,
    stage: flatStage(), routes: flatRoutes(), spawns: [], data,
    players: [{ playerId: 'p1', units: [{ uid, chessId: uid, row: 10, col: 5 }] }],
    ...(assault ? { content: 'assault', assault: { kits: mergedKits, strict: true } } : { content: 'full' }),
    flags: { dpInit: 99, dpPerSec: 30, dpMax: 999, startOpCooldown: 0 }, autoFinish: false, timeLimit: 30, quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} },
  });
}

test('Assault Tacticians use their roster-specific summons and their normal Native ally AI', () => {
  for (const [charId, tokenId] of [['char_427_vigil', 'token_10028_vigil_wolf'], ['char_249_mlyss', 'token_10030_mlyss_wtrman']]) {
    const uid = `assault-tactician:${charId}`;
    const battle = battleFor(charId, uid);
    let ownedAttacks = 0;
    battle.on('attack', (event) => { if (event.attacker?.ownerUnit?.uid === uid) ownedAttacks += 1; });
    battle.start();
    const owner = battle.allyUnits.find((unit) => unit.uid === uid);
    for (let i = 0; i < 3; i++) { battle.step(); battle.assaultRuntime?.flush(); }
    const owned = battle.allyUnits.filter((unit) => unit.kind === 'token' && unit.ownerUnit === owner && unit.defId === tokenId && unit.alive && unit.deployed);
    assert.ok(owned.length > 0, `${charId} should deploy its compiled exclusive summon; errors=${JSON.stringify(battle.errors)}`);
    assert.equal(battle.allyUnits.some((unit) => unit.kind === 'token' && unit.defId === 'token_tactician_reinforce'), false);
    assert.ok(owned.includes(owner.trait.reinforcement), 'the native Tactician reinforcement damage trait points at its real exclusive summon');
    const targetKey = owned[0].rangeKeys.find((key) => !battle.allyUnits.some((unit) => unit.alive && unit.tileR * COLS + unit.tileC === key));
    if (targetKey != null) {
      const enemyKey = `tactician-target:${charId}`;
      battle.data.raw.enemies[enemyKey] = enemyRec({ key: enemyKey, hp: 100000, atk: 0, def: 0, res: 0, speed: 0 });
      const enemy = battle.spawnEnemy(enemyKey, { routeIndex: 0, pos: [Math.floor(targetKey / COLS), targetKey % COLS] });
      assert.ok(enemy);
      for (let i = 0; i < 45; i++) { battle.step(); battle.assaultRuntime?.flush(); }
    }
    assert.equal(battle.errorCount, 0, `${charId} error records: ${JSON.stringify(battle.errors.slice(0, 3))}`);
    if (targetKey != null) assert.ok(ownedAttacks > 0, `${charId} exclusive summon should use native ally AI against an in-range enemy`);
    battle.dispose?.();
  }
});

test('non-Assault Tacticians retain the native generic reinforcement fallback', () => {
  const uid = 'native-tactician:char_427_vigil';
  const battle = battleFor('char_427_vigil', uid, { assault: false });
  battle.start();
  for (let i = 0; i < 3; i++) battle.step();
  assert.ok(battle.allyUnits.some((unit) => unit.kind === 'token' && unit.ownerUnit?.uid === uid && unit.defId === 'token_tactician_reinforce'));
  battle.dispose?.();
});
