import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle, getAssaultField } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { Battle } from '../../server/sim/Battle.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';
import { tileKeyOf } from '../../server/sim/targeting.js';

const data = getAssaultData(), design = loadAssaultDesign();
const roster = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const ranks = [3, 4];
const normal = design.encounters.encounters.find((entry) => entry.kind === 'normal');
let fixtureSeq = 0;

function body(charId) { return data.runtime.bodies[charId]; }
function formal(charId) {
  const entry = roster.operators.find((operator) => operator.charId === charId);
  assert(entry, `${charId} exists in formal roster`);
  return entry;
}
function piece(charId, rank, moduleId, row = 9, col = 8, dir = 'RIGHT', uid = null) {
  const operator = body(charId);
  return { uid: uid ?? `exact-f:${charId}:${rank}:${moduleId ?? 'base'}:${++fixtureSeq}`, charId,
    isPrimary: true, purchaseCharId: operator.purchaseCharId, star: rank, row, col, dir, sourceCopies: 1,
    moduleId, moduleChoices: { [charId]: moduleId }, permanentFlat: {}, permanentPercent: {},
    tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
}
function battleFixture(charId, rank, moduleId = null, row = 9, col = 8, dir = 'RIGHT') {
  const selectedPiece = piece(charId, rank, moduleId, row, col, dir);
  const encounter = { ...normal, wave: { ...normal.wave, spawns: [], dp: { ...normal.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle({ seed: 823100 + fixtureSeq, life: 20, day: 1, hour: 1,
    pieces: [selectedPiece], nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  battle.autoFinish = false;
  battle.start(); battle.assaultRuntime.flush();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === selectedPiece.uid);
  assert(unit?.alive && unit.deployed, `native Battle deploys ${charId} R${rank}`);
  return { battle, unit, piece: selectedPiece, prepared };
}
function enemyAt(battle, [row, col], { routeIndex = 0, speed = 0, hpMul = 1000 } = {}) {
  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex, pos: [row, col], mods: { speed, hpMul } });
  assert(enemy?.alive, `native enemy spawned at ${row},${col}`);
  battle._buildEnemyIndex();
  return enemy;
}
function advance(battle, seconds) {
  const until = battle.time + seconds;
  for (let i = 0; i < 12000 && battle.time + 1e-9 < until; i++) battle.step();
  assert(battle.time + 1e-9 >= until, `native Battle time reached ${until}`);
}
function routeSpec(path) { return { motion: 'WALK', start: path[0], end: path.at(-1), checkpoints: path.slice(1, -1) }; }
function naturalCast(battle, unit, label) {
  assert.equal(unit.skill.rule, 'SP_FULL', `${label}: compiled fixed skill is SP_FULL`);
  assert.equal(unit.skill.spec.canCast({ battle, unit }), true, `${label}: normal cast gate accepts eligible source action`);
  const starts = [];
  battle.assaultRuntime.observe('skillStart', `exact-f:${label}`, ({ payload }) => {
    if (payload.source === unit) starts.push(payload);
  });
  assert(unit.skill.gainSp(unit.skill.spCost - unit.skill.sp, `exact-f-natural-SP_FULL:${label}`) > 0,
    `${label}: actual Skill.gainSp reaches SP_FULL`);
  advance(battle, 0.05); battle.assaultRuntime.flush();
  assert.equal(starts.length, 1, `${label}: one automatic native skillStart`);
  assert.equal(starts[0].reason, 'automatic');
}
function deviceTile(battle, unit) {
  const tiles = unit.rangeKeys.map((key) => [Math.floor(key / 19), key % 19])
    .filter(([r, c]) => battle.grid.inRect(r, c) && battle.grid.isLow(r, c) && !battle._occ[r * 19 + c]?.alive && !battle.downOn(r, c));
  const enemies = battle.enemies.filter((enemy) => enemy.alive);
  tiles.sort((a, b) => {
    const da = enemies.length ? Math.min(...enemies.map((enemy) => Math.hypot(enemy.tileR - a[0], enemy.tileC - a[1]))) : 0;
    const db = enemies.length ? Math.min(...enemies.map((enemy) => Math.hypot(enemy.tileR - b[0], enemy.tileC - b[1]))) : 0;
    return da - db;
  });
  return tiles[0] ?? null;
}
function pathDeviceFixture(charId, rank, moduleId) {
  const field = getAssaultField({}, normal, { ...data, design });
  const paths = Object.entries(field.stage.raw.groundPaths ?? {});
  for (const [deployKey, kind] of field.normalizedDeployMap) {
    if (!['melee', 'ranged'].includes(kind)) continue;
    const [row, col] = deployKey.split(',').map(Number);
    for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
      const fixture = battleFixture(charId, rank, moduleId, row, col, dir);
      naturalCast(fixture.battle, fixture.unit, `path-device:${charId}:${rank}:${row},${col}:${dir}`);
      const trap = fixture.battle.allyUnits.find((candidate) => candidate.kind === 'device' && candidate.ownerUnit === fixture.unit && candidate.alive);
      if (!trap) continue;
      const tile = [trap.tileR, trap.tileC];
      const key = `${tile[0]},${tile[1]}`;
      const pathIndex = paths.findIndex(([, path]) => path.some(([r, c]) => r === tile[0] && c === tile[1]));
      if (pathIndex >= 0) {
        const path = paths[pathIndex][1];
        const position = path.findIndex(([r, c]) => r === tile[0] && c === tile[1]);
        const ownerBlocksApproach = path.slice(1, position + 1).some(([r, c]) => r === fixture.unit.tileR && c === fixture.unit.tileC);
        if (position > 0 && !ownerBlocksApproach) return { ...fixture, tile, path, pathIndex, position, trap };
      }
    }
  }
  assert.fail(`${charId} has a legal native device tile intersecting a formal ground path`);
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
