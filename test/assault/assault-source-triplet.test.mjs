import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { COLS } from '../../server/sim/constants.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const IDS = ['char_356_broca', 'char_173_slchan', 'char_474_glady'];
const data = getAssaultData(), design = loadAssaultDesign();
const roster = JSON.parse((await import('node:fs')).readFileSync(`${ROOT}/data/assault-design/roster-assault.json`, 'utf8'));
const ranks = [3, 4], rankIndex = rank => rank - 1;

function fixture(charId, rank, extra = [], unitCol = 4) {
  const body = data.runtime.bodies[charId];
  const pieces = [{ id: charId, col: unitCol }, ...extra].map((x, i) => {
    const b = data.runtime.bodies[x.id];
    return { uid: `source-triplet:${rank}:${i}:${x.id}`, charId: x.id, purchaseCharId: b.purchaseCharId,
      star: rank, row: x.row ?? 10, col: x.col, dir: 'RIGHT', sourceCopies: 1, moduleId: null,
      moduleChoices: { [x.id]: null }, permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  });
  const source = design.encounters.encounters.find(e => e.id === 'enc_band5_normal_a1m06');
  assert(source, 'the authored encounter has a legal ground corridor for the source-range fixture');
  const encounter = { ...source, wave: { ...source.wave, dp: { ...source.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle({ seed: 89300 + rank, life: 20, day: 1, hour: 1, pieces, nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  battle.start(); battle.assaultRuntime.flush();
  const unit = battle.allyUnits.find(u => u.uid === pieces[0].uid);
  battle.addBuff(unit, { key: 'source-triplet:no-basic', flags: { disarm: true }, duration: 35 });
  return { battle, unit, allies: pieces.slice(1).map(p => battle.allyUnits.find(u => u.uid === p.uid)), body };
}

function enemy(f, col = 5, routeIndex = f.battle.enemies.length, row = 10) {
  assert(f.battle.grid.groundPassable(row, col), 'the source fixture spawns on native ground-passable terrain');
  const e = f.battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex, pos: [row, col], mods: { hpMul: 1000, speed: 0 } });
  f.battle.applyStatus(e, 'stun', { duration: 34 });
  f.battle._buildEnemyIndex();
  return e;
}

function advance(f, seconds) {
  const until = f.battle.time + seconds;
  for (let n = 0; n < 1200 && f.battle.time < until; n++) f.battle.step();
  assert(f.battle.time >= until, 'native Battle clock reached the requested terminal time');
}

function naturalCast(f, waitAfterStart = 0) {
  advance(f, 0.3);
  const starts = [];
  assert.equal(f.unit.skill.rule, 'SP_FULL');
  f.battle.assaultRuntime.observe('skillStart', `source-triplet:natural:${f.unit.uid}`, e => {
    if (e.payload.source === f.unit) starts.push({ ...e.payload, time: f.battle.time, sp: f.unit.skill.sp,
      atk: f.unit.s.atk, def: f.unit.s.def });
  });
  assert.equal(f.unit.skill.spec.canCast({ battle: f.battle, unit: f.unit }), true, 'fixture provides a real legal target for the native cast gate');
  assert(f.unit.skill.gainSp(f.unit.skill.spCost - f.unit.skill.sp, 'fixture-natural-SP_FULL') > 0, 'fixture fills the native skill through Skill.gainSp');
  assert.equal(f.unit.skill.ready, true);
  advance(f, 0.05);
  assert.equal(starts.length, 1, 'exactly one real cast started from native SP recovery');
  assert.equal(starts[0].source, f.unit);
  assert.equal(starts[0].reason, 'automatic'); assert.equal(starts[0].force, false);
  assert(starts[0].sp < f.unit.skill.spCost, 'native automatic start consumes the full-SP charge');
  if (waitAfterStart) advance(f, waitAfterStart);
  return starts[0];
}

test('source-triplet R3/R4 compiled values preserve every roster effect and mode passive', () => {
  for (const id of IDS) {
    const expected = roster.operators.find(x => x.charId === id), actual = data.runtime.bodies[id];
    assert(expected && actual, `${id}: formal roster and compiled body exist`);
    assert.equal(actual.fixedSkill.sourceSkillId, expected.fixedSkill.sourceSkillId);
    assert.equal(actual.fixedSkill.sourceIndex, expected.fixedSkill.sourceIndex);
    assert.equal(actual.fixedSkill.spCosts[rankIndex(3)], expected.fixedSkill.spCosts[rankIndex(3)]);
    assert.deepEqual(actual.modePassives, expected.modePassives, `${id}: compiled mode passive matches formal roster`);
    assert.deepEqual(actual.fixedSkill.effects.map(e => e.values), expected.fixedSkill.effects.map(e => e.values), `${id}: compiled skill values match formal roster`);
    for (const rank of ranks) {
      for (const effect of expected.fixedSkill.effects) for (const [key, values] of Object.entries(effect.values ?? {}))
        assert.deepEqual([actual.fixedSkill.effects[expected.fixedSkill.effects.indexOf(effect)].values[key][rankIndex(rank)]], [values[rankIndex(rank)]], `${id} R${rank} ${effect.action}.${key}`);
      for (const passive of expected.modePassives) for (const [key, values] of Object.entries(passive.values ?? {}))
        assert.equal(actual.modePassives[expected.modePassives.indexOf(passive)].values[key][rankIndex(rank)], values[rankIndex(rank)], `${id} R${rank} passive.${key}`);
    }
  }
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
