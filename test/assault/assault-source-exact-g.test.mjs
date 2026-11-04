import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { COLS } from '../../server/sim/constants.js';
import { tileKeyOf } from '../../server/sim/targeting.js';
import { mitigate } from '../../server/sim/damage.js';

const data = getAssaultData(), design = loadAssaultDesign();
const roster = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const ranks = [3, 4], normal = design.encounters.encounters.find((entry) => entry.kind === 'normal');
let seq = 0;

function formal(charId) {
  const entry = roster.operators.find((operator) => operator.charId === charId);
  assert(entry, `${charId} exists in the formal assault roster`);
  return entry;
}
function fixture(charId, rank, moduleId = null, { row = 9, col = 8, dir = 'RIGHT', extras = [] } = {}) {
  const body = data.runtime.bodies[charId];
  const piece = (id, star, r, c, facing, index) => ({ uid: `exact-g:${++seq}:${id}:${star}:${moduleId ?? 'base'}:${index}`,
    charId: id, isPrimary: index === 0, purchaseCharId: data.runtime.bodies[id].purchaseCharId, star, row: r, col: c, dir: facing,
    sourceCopies: 1, moduleId: index === 0 ? moduleId : null, moduleChoices: { [id]: index === 0 ? moduleId : null },
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] });
  const pieces = [piece(charId, rank, row, col, dir, 0), ...extras.map((item, index) => piece(item.charId, item.star ?? rank,
    item.row, item.col, item.dir ?? dir, index + 1))];
  const encounter = { ...normal, wave: { ...normal.wave, spawns: [], dp: { ...normal.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle({ seed: 640030 + seq, life: 20, day: 1, hour: 1, pieces, nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  battle.autoFinish = false;
  battle.start(); battle.assaultRuntime.flush();
  const unit = battle.allyUnits.find((entry) => entry.uid === pieces[0].uid);
  assert(unit?.alive && unit.deployed, `native stage deploys ${charId} R${rank}`);
  return { battle, unit, piece: pieces[0], pieces, prepared, body };
}
function targetsInRange(f, count, { hpMul = 10000 } = {}) {
  const tiles = [...new Set(f.unit.rangeKeys)].map((key) => [Math.floor(key / COLS), key % COLS])
    .filter(([row, col]) => f.battle.grid.groundPassable(row, col) && !f.battle._occ[row * COLS + col]?.alive &&
      !f.battle.enemies.some((enemy) => enemy.alive && tileKeyOf(enemy) === row * COLS + col));
  assert(tiles.length >= 1, 'native range exposes a legal enemy tile');
  const targets = Array.from({ length: count }, (_, index) => {
    const [row, col] = tiles[0];
    const key = tileKeyOf({ x: col, y: row });
    assert.equal(key, row * COLS + col, 'fixture uses tileKeyOf current-coordinate convention');
    const enemy = f.battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: f.battle.enemies.length, pos: [row, col], mods: { hpMul } });
    assert(enemy?.alive, `native route enemy spawns on legal tile ${row},${col}`);
    f.battle.applyStatus(enemy, 'sluggish', { value: 1, duration: 100, key: `exact-g:hold:${seq}:${index}` });
    return enemy;
  });
  f.battle._buildEnemyIndex();
  return targets;
}
function advance(battle, seconds) {
  const until = battle.time + seconds;
  for (let i = 0; i < 12000 && battle.time + 1e-9 < until; i++) battle.step();
  assert(battle.time + 1e-9 >= until, `normal Battle timer reached ${until}`);
  battle.assaultRuntime.flush();
}
function naturalCast(f, label, maxSeconds = 500) {
  const starts = [];
  f.battle.on('skillStart', ({ unit, reason }) => { if (unit === f.unit) starts.push({ time: f.battle.time, reason }); }, { owner: f.unit });
  const until = f.battle.time + maxSeconds;
  for (let i = 0; i < 60000 && f.battle.time + 1e-9 < until && starts.length === 0; i++) {
    f.battle.step(); f.battle.assaultRuntime.flush();
  }
  if (starts.length !== 1) assert.fail(`${label}: natural cast absent; ${JSON.stringify({time:f.battle.time,sp:f.unit.skill.sp,cost:f.unit.skill.spCost,type:f.unit.skill.spType,ready:f.unit.skill.ready,recovery:f.unit.s.spRecovery,canAct:f.unit.canAct,hidden:f.unit.hidden,rule:f.unit.skill.rule})}`);
  assert.equal(starts[0].reason, 'automatic', `${label}: cast is native automatic SP_FULL`);
  return starts[0];
}
function noTargetCastCheck(f, label, maxSeconds = 500) {
  const starts = [];
  f.battle.on('skillStart', ({ unit }) => { if (unit === f.unit) starts.push(unit); }, { owner: f.unit });
  const until = f.battle.time + maxSeconds;
  for (let i = 0; i < 60000 && f.battle.time + 1e-9 < until && !f.unit.skill.ready; i++) { f.battle.step(); f.battle.assaultRuntime.flush(); }
  assert.equal(starts.length, 0, `${label}: no-target gate prevents an automatic cast`);
  assert(f.unit.skill.ready || f.unit.skill.sp >= f.unit.skill.spCost, `${label}: native SP naturally reached its no-target gate`);
}
function statDamage(atk, scale, type, target) { return mitigate(atk * scale, type, target.s); }
function damageEvents(f, predicate = () => true) {
  const hits = [];
  f.battle.on('damaged', (event) => { if (event.source === f.unit && predicate(event)) hits.push({ ...event, time: f.battle.time, sourceAtk: f.unit.s.atk }); }, { owner: f.unit });
  return hits;
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
