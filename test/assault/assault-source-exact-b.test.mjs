import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { assaultTokenKits } from '../../server/sim/content/assault/cards/assault-tokens.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { COLS, ROWS } from '../../server/sim/constants.js';

const runtime = JSON.parse(fs.readFileSync(new URL('../../data/assault-runtime.json', import.meta.url), 'utf8'));
// 大巴扎：裁度第二行「当你部署干员时，此干员本场战斗中 +x% 攻击力（最多 8 层）」；旧的按付费叠攻已删除。
const talrDeployStacks = (unit) => Number(unit.findBuff?.('bazaar:talr-deploy')?.stacks ?? 0);
const talrDeployPct = (rank) => Number(runtime.bodies.char_4155_talr.bazaar.lines[1].params.x[rank - 1]) / 100;

function pieceFor(body, star, moduleId = null) {
  return { uid: `exact-b:${body.charId}:${moduleId ?? 'base'}:${star}`, charId: body.charId, star, moduleId,
    moduleChoices: { [body.charId]: moduleId }, fixedSkill: body.fixedSkill, sourceCopies: 1,
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [] };
}

function realBattle(charId, moduleId, star, suffix, positions = [[10, 6]], seed = 1) {
  const body = runtime.bodies[charId], piece = pieceFor(body, star, moduleId);
  const chess = chessRec({ id: `exact-b:${charId}:${moduleId ?? 'base'}:${star}:${suffix}`, charId,
    profession: body.profession, stats: body.starStats[star - 1].stats, rangeGrid: body.range });
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  const enemy = enemyRec({ key: `exact-b:${charId}:${star}:${suffix}`, hp: 1000000, def: 0, res: 0, atk: 0, speed: 0 });
  const data = new DataSource({ chess: { [chess.chessId]: chess }, enemies: { [enemy.key]: enemy } }, getDefaultSource());
  const battle = new Battle({ kind: 'normal', seed, modeId: `exact-b:${charId}:${suffix}`, stage: flatStage(), routes: flatRoutes(),
    spawns: [{ enemyKey: enemy.key, time: 0, routeIndex: 0, pos: positions[0] }], data,
    players: [{ playerId: 'p1', units: [{ uid: piece.uid, chessId: chess.chessId, row: 9, col: 4 }] }],
    content: 'assault', assault: { kits: { ...assaultKits }, strict: true },
    flags: { dpInit: 99, dpPerSec: 0, dpMax: 99 }, autoFinish: false, timeLimit: 60, quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  const target = battle.enemies[0] ?? battle.spawnEnemy(enemy.key, { routeIndex: 0, pos: positions[0] });
  return { battle, body, piece, unit, target, enemyKey: enemy.key };
}

function nativeSkillBattle(charId, moduleId, star, suffix, positions = [[10, 6]], seed = 1) {
  const body = runtime.bodies[charId], piece = pieceFor(body, star, moduleId);
  const chess = chessRec({ id: `native-skill:${charId}:${suffix}`, charId, profession: body.profession,
    stats: body.starStats[star - 1].stats, rangeGrid: body.range });
  chess.assaultPiece = piece; chess.assaultBody = body;
  const enemy = enemyRec({ key: `native-skill:${charId}:${suffix}`, hp: 1000000000, def: 0, res: 0, atk: 0, speed: 0 });
  const data = new DataSource({ chess: { [chess.chessId]: chess }, enemies: { [enemy.key]: enemy } }, getDefaultSource());
  const battle = new Battle({ kind: 'normal', modeId: `native-skill:${charId}:${suffix}`, stage: flatStage(), routes: flatRoutes(),
    spawns: [{ enemyKey: enemy.key, time: 0, routeIndex: 0, pos: positions[0] }], data,
    players: [{ playerId: 'p1', units: [{ uid: piece.uid, chessId: chess.chessId, row: 10, col: 5 }] }],
    content: 'assault', assault: { kits: { ...assaultKits }, strict: true },
    flags: { dpInit: 99, dpPerSec: 0, dpMax: 99 }, autoFinish: false, timeLimit: 60, quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  for (const pos of positions.slice(1)) battle.spawnEnemy(enemy.key, { routeIndex: 0, pos });
  battle._buildEnemyIndex(); battle.step();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  return { battle, body, piece, unit, target: battle.enemies[0] };
}

function placeTargetInTalrRange(fixture) {
  const { battle, unit, target } = fixture;
  const key = unit.rangeKeys.find((candidate) => candidate !== unit.tileR * COLS + unit.tileC
    && battle.grid.inRect(Math.floor(candidate / COLS), candidate % COLS) && battle.grid.isLow(Math.floor(candidate / COLS), candidate % COLS));
  assert.ok(Number.isInteger(key), 'Talr has an actual legal low target tile');
  target.x = target.tileC = key % COLS;
  target.y = target.tileR = Math.floor(key / COLS);
  battle._buildEnemyIndex();
  return key;
}

function advanceSeconds(battle, seconds) {
  const start = battle.time;
  for (let steps = 0; battle.time - start < seconds - 1e-9 && steps < 2000; steps++) battle.step();
  assert.ok(battle.time - start >= seconds - 1e-9, `native battle clock advanced at least ${seconds}s`);
}

function preparedBattle(pieces, seed) {
  const design = loadAssaultDesign(), data = getAssaultData();
  const encounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const preparedPieces = pieces.map((piece) => ({ ...piece, purchaseCharId: runtime.bodies[piece.charId].purchaseCharId,
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] }));
  const prepared = prepareAssaultBattle({ seed, life: 20, day: 1, hour: 1, pieces: preparedPieces, nextBattleEffects: [] }, encounter,
    { ...data, design });
  return { battle: createAssaultBattle(prepared, { ...data, design, kits: assaultKits }), pieces: preparedPieces };
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

function assertTalrPeriodicDamage(rank) {
  const fixture = realBattle('char_4155_talr', 'uniequip_002_talr', rank, `periodic-root-${rank}`);
  const { battle, unit, target } = fixture;
  placeTargetInTalrRange(fixture);
  const player = battle._pp(unit.ownerId); if (player) player.dp = 99;
  const rootEvents = [], hits = [];
  battle.on('statusApplied', (event) => { if (event.source === unit && event.target === target && event.status === 'bind') rootEvents.push(event); }, { owner: unit });
  battle.on('damaged', (event) => { if (event.source === unit && event.target === target && event.dmg?.isSkill) hits.push({ time: battle.time, amount: event.amount, type: event.dmg.type }); }, { owner: unit });
  unit.skill.charges = 1; unit.skill.sp = unit.skill.spCost;
  assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true, `rank ${rank}: the actual instant cast resolves`);
  const activeDuration = rank === 3 ? 3.5 : 4;
  assert.equal(rootEvents[0]?.duration, activeDuration, `rank ${rank}: the source root duration is exact`);
  for (let tick = 0; tick < 180; tick++) battle.step();
  const ticks = hits.filter((hit) => hit.time > 0 && hit.time <= activeDuration + 1e-6);
  assert.equal(hits.filter((hit) => hit.time <= 1e-6).length, 0, `rank ${rank}: periodic effect does not add an immediate hit`);
  assert.equal(ticks.length, Math.floor(activeDuration),
    `rank ${rank}: source promises exactly one real damage tick per second during root; actual=${JSON.stringify(hits)}`);
  assert.ok(ticks.every((hit) => hit.type === 'phys'), `rank ${rank}: periodic damage remains physical`);
  const expectedScale = rank === 3 ? 1.6 : 1.8;
  assert.ok(ticks.every((hit) => Math.abs(hit.amount / unit.s.atk - expectedScale) < 1e-6),
    `rank ${rank}: each tick uses exact ${expectedScale}x ATK`);
  assert.ok(hits.every((hit) => hit.time <= activeDuration + 1e-6), `rank ${rank}: damage stops after the root window`);
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
