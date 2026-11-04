import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { COLS } from '../../server/sim/constants.js';
import { absoluteRangeKeys, tileKeyOf } from '../../server/sim/targeting.js';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';

const data = getAssaultData(), design = loadAssaultDesign();
const roster = JSON.parse((await import('node:fs')).readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const ranks = [3, 4];

function fixture(charId, rank, moduleId = null, row = 10, col = 4, beforeStart = null) {
  const body = data.runtime.bodies[charId];
  const piece = { uid: `exact-d:${charId}:${rank}:${moduleId ?? 'base'}`, charId, purchaseCharId: body.purchaseCharId,
    star: rank, row, col, dir: 'RIGHT', sourceCopies: 1, moduleId, moduleChoices: { [charId]: moduleId },
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const source = design.encounters.encounters.find((entry) => entry.id === 'enc_band5_normal_a1m06');
  assert(source, 'authored normal encounter provides the native legal corridor');
  const encounter = { ...source, wave: { ...source.wave, dp: { ...source.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle({ seed: 92800 + rank, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  beforeStart?.(battle, piece);
  battle.start(); battle.assaultRuntime.flush();
  const unit = battle.allyUnits.find((entry) => entry.uid === piece.uid);
  assert(unit?.alive && unit.deployed, `${charId} rank ${rank} is a live native Battle unit`);
  battle.addBuff(unit, { key: 'exact-d:no-basic', flags: { disarm: true }, duration: 80 });
  return { battle, unit, piece };
}

function enemy(f, row, col, label = `${row}:${col}`, hold = true) {
  assert(f.battle.grid.groundPassable(row, col), `native ground tile ${row},${col} is passable`);
  const target = f.battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: f.battle.enemies.length,
    pos: [row, col], mods: { hpMul: 1000, speed: 0 } });
  if (hold) f.battle.applyStatus(target, 'stun', { duration: 70 });
  target.mem.exactDLabel = label;
  f.battle._buildEnemyIndex();
  return target;
}

function advance(f, seconds) {
  const until = f.battle.time + seconds;
  for (let n = 0; n < 1600 && f.battle.time < until; n++) f.battle.step();
  assert(f.battle.time >= until, `native Battle clock reached ${until}`);
}

function naturalCast(f, label) {
  advance(f, 0.25);
  assert.equal(f.unit.skill.rule, 'SP_FULL', `${label}: selected fixed skill uses SP_FULL`);
  assert.equal(f.unit.skill.spec.canCast({ battle: f.battle, unit: f.unit }), true, `${label}: native skill gate sees a legal target`);
  const starts = [];
  f.battle.assaultRuntime.observe('skillStart', `exact-d:${label}`, (event) => {
    if (event.payload.source === f.unit) starts.push({ ...event.payload, time: f.battle.time, atk: f.unit.s.atk });
  });
  const gained = f.unit.skill.gainSp(f.unit.skill.spCost - f.unit.skill.sp, `exact-d-natural-SP_FULL:${label}`);
  assert(gained > 0, `${label}: native Skill.gainSp filled the actual SP bar`);
  assert.equal(f.unit.skill.ready, true, `${label}: native full-SP readiness is set`);
  advance(f, 0.05);
  assert.equal(starts.length, 1, `${label}: exactly one automatic native skill start`);
  assert.equal(starts[0].reason, 'automatic');
  assert.equal(starts[0].force, false);
  f.battle.assaultRuntime.flush();
  return starts[0];
}

function rosterEntry(id) {
  const entry = roster.operators.find((operator) => operator.charId === id);
  assert(entry, `${id} exists in formal roster-assault.json`);
  return entry;
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
