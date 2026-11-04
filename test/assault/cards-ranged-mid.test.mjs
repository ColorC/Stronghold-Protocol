import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Battle } from '../../server/sim/Battle.js';
import { COLS } from '../../server/sim/constants.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { ledgerFor, returnSummon } from '../../server/sim/content/assault/summons.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import { rangedMidCards, rangedMidCharIds, rangedMidTokenKits } from '../../server/sim/content/assault/cards/ranged-mid.js';
import { synergyRangedKits } from '../../server/sim/content/assault/cards/synergy-ranged.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';

const compiled = loadAssaultRuntime();
const design = JSON.parse(readFileSync(new URL('../../data/assault-design/roster-ranged.json', import.meta.url), 'utf8'));
const coverage = JSON.parse(readFileSync(new URL('../../data/assault-coverage-ranged-mid.json', import.meta.url), 'utf8'));
// a card replaced by its synergy card (design of 2026-10-21) plays it here too (as another card's partner); its own lines are
// tested in test/assault/synergy-ranged*.test.mjs
const ALL_KITS = { ...assaultKits };
const oldCard = (charId) => !['synergy','adaptation'].includes(compiled.bodies[charId].bazaar?.format);
const TOKEN_IDS = new Set(Object.keys(rangedMidTokenKits));

function tokenIdOf(unit) { return unit?.tokenId ?? unit?.def?.tokenId ?? unit?.defId; }
function hasStatus(unit, status) { return unit?.buffs?.some((entry) => entry.status === status); }
function hasKey(unit, fragment) { return unit?.buffs?.some((entry) => String(entry.key).includes(fragment)); }

function makeBattle(charId, { star = 4, moduleId = null, enemyHp = 100000, enemyCount = 1, enemyPos = [10, 7], enemyPositions = null, enemyRouteIndexes = null, unitPos = [10, 5], flying = false, tags = [], dpInit = 999, summonPresets = [], extraOwners = [], seed = 20261009, onDamage = null, suppressInitialSkill = false } = {}) {
  const body = compiled.bodies[charId];
  assert.ok(body, `${charId} compiled assault body`);
  const piece = { uid: `ranged-mid:${charId}:${star}:${moduleId ?? 'none'}`, charId, star,
    moduleChoices: moduleId ? { [charId]: moduleId } : {}, summonPresets };
  const chess = chessRec({ id: piece.uid, charId, profession: body.profession ?? 'CASTER', subProf: body.subProfession ?? body.subProfessionId, stats: body.starStats[star - 1].stats, rangeGrid: body.range });
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  const enemies = Array.from({ length: enemyCount }, (_, index) => {
    const enemy = enemyRec({ key: `${piece.uid}:enemy:${index}`, hp: enemyHp, speed: 0, atk: 0, motion: flying ? 'FLY' : 'WALK' });
    enemy.tags = tags;
    enemy.rank = tags.includes('elite') ? 'ELITE' : tags.includes('leader') ? 'LEADER' : enemy.rank;
    enemy.isElite = tags.includes('elite');
    enemy.isLeader = tags.includes('leader');
    enemy.isFlying = flying;
    return enemy;
  });
  const extras = extraOwners.map((entry, index) => {
    const otherBody = compiled.bodies[entry.charId];
    assert.ok(otherBody, `${entry.charId} compiled extra owner body`);
    const otherStar = entry.star ?? 4;
    const otherPiece = { uid: entry.uid ?? `ranged-mid:extra:${index}:${entry.charId}`, charId: entry.charId, star: otherStar,
      moduleChoices: entry.moduleId ? { [entry.charId]: entry.moduleId } : {}, summonPresets: entry.summonPresets ?? [] };
    const otherChess = chessRec({ id: otherPiece.uid, charId: entry.charId, profession: otherBody.profession ?? 'CASTER', subProf: otherBody.subProfession ?? otherBody.subProfessionId, stats: otherBody.starStats[otherStar - 1].stats, rangeGrid: otherBody.range });
    otherChess.assaultPiece = otherPiece; otherChess.assaultBody = otherBody;
    return { body: otherBody, piece: otherPiece, chess: otherChess, row: entry.row ?? 9, col: entry.col ?? 5 };
  });
  const messages = [];
  const allChess = Object.fromEntries([chess, ...extras.map((entry) => entry.chess)].map((entry) => [entry.chessId, entry]));
  const data = new DataSource({ chess: allChess, enemies: Object.fromEntries(enemies.map((enemy) => [enemy.key, enemy])), tokens: compiled.summons }, getDefaultSource());
  const battle = new Battle({ seed, kind: 'normal', modeId: piece.uid, stage: flatStage(), routes: flatRoutes(),
    spawns: enemies.map((enemy, index) => ({ enemyKey: enemy.key, time: 0, routeIndex: enemyRouteIndexes?.[index] ?? 0, pos: enemyPositions?.[index] ?? enemyPos })), data,
    players: [{ playerId: 'p1', units: [{ uid: piece.uid, chessId: chess.chessId, row: unitPos[0], col: unitPos[1] }, ...extras.map((entry) => ({ uid: entry.piece.uid, chessId: entry.chess.chessId, row: entry.row, col: entry.col }))] }],
    content: 'assault', assault: { kits: ALL_KITS, strict: true },
    flags: { dpInit, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 }, autoFinish: false, timeLimit: 90, quiet: true,
    logger: { warn(...args) { messages.push(['warn', ...args]); }, error(...args) { messages.push(['error', ...args]); }, info() {}, log() {} } });
  if (onDamage) battle.on('damaged', onDamage);
  battle.start();
  const startingUnit = battle.allyUnits.find((entry) => entry.uid === piece.uid);
  const savedSpType = startingUnit?.skill?.spType;
  if (suppressInitialSkill && startingUnit?.skill) {
    startingUnit.skill.setSpTotal(0);
    startingUnit.skill.spType = 'none';
  }
  battle.step();
  if (suppressInitialSkill && startingUnit?.skill) {
    startingUnit.skill.spType = savedSpType;
    startingUnit.skill.setSpTotal(0);
  }
  for (const entry of extras) {
    const extraUnit = battle.allyUnits.find((unit) => unit.uid === entry.piece.uid);
    if (extraUnit && !extraUnit.deployed) battle._deploy(extraUnit, { initial: true, free: true });
  }
  const unit = battle.allyUnits.find((entry) => entry.uid === piece.uid);
  const target = battle.enemies[0];
  assert.ok(unit && target, `${charId} real Battle deployment`);
  const otherUnits = extras.map((entry) => battle.allyUnits.find((unit) => unit.uid === entry.piece.uid));
  return { battle, body, piece, unit, target, messages, otherUnits };
}

function cast({ battle, unit, piece, body }) {
  unit.skill.sp = unit.skill.spCost;
  const result = unit.kit.skill.assaultCast({ battle, unit, piece, body, rank: piece.star, cause: null });
  battle.assaultRuntime.flush();
  return result;
}

function assertNoHandlerErrors(messages, charId) {
  assert.deepEqual(messages.filter(([kind]) => kind === 'error'), [], `${charId} has no strict handler error`);
}

test('ranged-mid exports exactly its 25 cards and four owned token identities', () => {
  assert.equal(coverage.status, 'complete', 'all per-card and per-star source effects have named real-Battle evidence');
  assert.deepEqual(rangedMidCharIds, design.operators.slice(17, 42).map((entry) => entry.charId));
  assert.equal(Object.keys(rangedMidCards).length, 25);
  assert.deepEqual(Object.keys(rangedMidTokenKits).sort(), [
    'token_10004_otter_motter', 'token_10006_vodfox_doll', 'token_10011_beewax_oblisk', 'token_10041_cathy_catsld',
  ]);
  assert.deepEqual(coverage.pending, []);
  for (const charId of rangedMidCharIds) {
    const body = compiled.bodies[charId];
    const piece = { uid: `builder:${charId}`, charId, star: 4,
      moduleChoices: { [charId]: body.modulePlans.find((entry) => entry.type === 'ADVANCED')?.id } };
    const raw = { assaultBody: body, assaultPiece: piece };
    const kit = rangedMidCards[charId](null, raw, { charId, raw, input_piece: piece });
    assert.equal(typeof kit.skill.assaultCast, 'function', `${charId} fixed handler`);
    assert.equal(typeof kit.install, 'function', `${charId} installer`);
  }
});

// every card of this loop is a synergy card now (design of 2026-10-21): their lines are tested in test/assault/synergy-ranged*.test.mjs

// every card of this loop is a synergy card now (design of 2026-10-21): their lines are tested in test/assault/synergy-ranged*.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-4.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// negative gates: every card of it is a synergy card now (design of 2026-10-21) — their gates are tested in test/assault/synergy-ranged*.test.mjs
