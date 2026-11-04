import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle, getAssaultField } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';

const data = getAssaultData(), design = loadAssaultDesign();
const roster = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const ranks = [3, 4];
const normal = design.encounters.encounters.find((entry) => entry.kind === 'normal');
let fixtureSeq = 0;
const body = (id) => data.runtime.bodies[id];
const entityId = (entity) => entity?.uid ?? entity?.id;
const fromUnit = (payload, unit) => payload?.sourceUid === unit.uid || entityId(payload?.source) === unit.uid;
function formal(id) {
  const result = roster.operators.find((entry) => entry.charId === id);
  assert(result, `${id} exists in formal roster-assault.json`);
  return result;
}
function piece(id, rank, moduleId = null, row = 9, col = 8) {
  const op = body(id);
  const uid = `exact-h:${id}:${rank}:${moduleId ?? 'base'}:${++fixtureSeq}`;
  return { uid, charId: id, isPrimary: true, purchaseCharId: op.purchaseCharId, star: rank, row, col,
    dir: 'RIGHT', sourceCopies: 1, moduleId, moduleChoices: { [id]: moduleId }, permanentFlat: {}, permanentPercent: {},
    tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
}
function battleFixture(id, rank, moduleId = null, extraPieces = []) {
  const selected = piece(id, rank, moduleId);
  const pieces = [selected, ...extraPieces];
  const encounter = { ...normal, wave: { ...normal.wave, spawns: [], dp: { ...normal.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle({ seed: 827000 + fixtureSeq, life: 20, day: 1, hour: 1, pieces, nextBattleEffects: [] },
    encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  battle.autoFinish = false;
  battle.start(); battle.assaultRuntime.flush();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === selected.uid);
  assert(unit?.alive && unit.deployed, `native Assault Battle deploys ${id} R${rank}`);
  return { battle, unit, selected, prepared };
}
function validDeviceTiles(battle, unit) {
  return (unit.rangeKeys ?? []).map((key) => [Math.floor(key / 19), key % 19])
    .filter(([r, c]) => battle.grid.inRect(r, c) && battle.grid.isLow(r, c) && !battle._occ[r * 19 + c]?.alive && !battle.downOn(r, c));
}
function pickDeviceTile(battle, unit) {
  const enemies = battle.enemies.filter((enemy) => enemy.alive);
  return validDeviceTiles(battle, unit).sort((a, b) => {
    const dist = (tile) => enemies.length ? Math.min(...enemies.map((enemy) => Math.hypot(enemy.y - tile[0], enemy.x - tile[1]))) : 0;
    return dist(a) - dist(b);
  })[0] ?? null;
}
function enemyAt(battle, [row, col], { hpMul = 50000, speed = 0 } = {}) {
  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [row, col], mods: { speed, hpMul } });
  assert(enemy?.alive, `native enemy spawned at current coordinate ${row},${col}`);
  enemy.atkCd = Infinity;
  battle._buildEnemyIndex();
  return enemy;
}
function advance(battle, seconds) {
  const until = battle.time + seconds;
  for (let i = 0; i < 18000 && battle.time + 1e-9 < until; i++) battle.step();
  assert(battle.time + 1e-9 >= until, `native Battle reaches ${until.toFixed(3)}s`);
  battle.assaultRuntime.flush();
}
function naturalCast(battle, unit, label) {
  assert.equal(unit.skill.rule, 'SP_FULL', `${label}: compiled entry is natural SP_FULL`);
  assert.equal(unit.skill.spec.canCast({ battle, unit }), true, `${label}: native cast gate accepts a legal device action`);
  const starts = [];
  battle.assaultRuntime.observe('skillStart', `exact-h:${label}`, ({ payload }) => { if (payload.source?.uid === unit.uid) starts.push({ reason: payload.reason }); });
  assert(unit.skill.gainSp(unit.skill.spCost - unit.skill.sp, `exact-h-natural-SP_FULL:${label}`) > 0,
    `${label}: real Skill.gainSp reaches SP_FULL`);
  advance(battle, 0.05);
  assert.equal(starts.length, 1, `${label}: one automatic native skill start`);
  assert.equal(starts[0].reason, 'automatic');
}
function valueAt(values, rank) { return values[rank - 1]; }
function expectedArts(source, target, scale, resistance = target.s.res) { return source.s.atk * scale * Math.max(0, 1 - resistance / 100) * source.s.dmgDealtMul * source.s.artsDealtMul * target.s.dmgTakenMul * target.s.artsTakenMul; }
function nativeSourceMatches(id) {
  const source = formal(id), compiled = body(id);
  assert.deepEqual(compiled.fixedSkill.effects.map((effect) => effect.values), source.fixedSkill.effects.map((effect) => effect.values), `${id}: compiled fixed values preserve the formal source`);
  assert.deepEqual(compiled.modePassives.map((effect) => effect.values), source.modePassives.map((effect) => effect.values), `${id}: compiled passive values preserve the formal source`);
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
