import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import { loadAssaultDesign } from '../../server/modes/assault/data.js';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { createRun } from '../../shared/assault/run.js';
import { buildAssaultBattleInput, enemyDayScale } from '../../shared/assault/battle-input.js';
import { PACING, bandOf, baseOf, encounterMetrics, highlightKeys, rebuildDesign } from '../../tools/assault/wave-pacing.mjs';

const calibratedHpMul = (encounter, key) => {
  const st = encounter.wave.overrides?.[key]?.stats ?? {};
  // the battle also applies the day strength of the run's day (the test runs start on day 1: the nearest entry of the table)
  return st.hpMode === 'absolute' ? 1 : (st.maxHp ?? 1) * (enemyDayScale(encounter.wave, 1)?.hp ?? 1);
};
const byKey = (records, key) => (Array.isArray(records) ? Object.fromEntries(records.map((item) => [item[key], item])) : records);
const data = getData();
const native = { enemies: {...byKey(data.enemies, 'key'), ...loadAssaultRuntime().auxiliaryEnemies}, bosses: byKey(data.bosses, 'bossId') };
const design = loadAssaultDesign();
const encounters = design.encounters.encounters;
const metrics = encounters.map((encounter) => encounterMetrics(encounter, native));
const legacy = encounters.filter((encounter) => !encounter.chapterSourceRef);
const legacyMetrics = metrics.filter((entry) => legacy.some((encounter) => encounter.id === entry.id));

test('every encounter wave is the generator output (rebuilding is byte-identical)', () => {
  assert.equal(encounters.length, 36);
  for (const encounter of encounters) assert.equal(encounter.wave.pacing?.schema, encounter.chapterSourceRef ? 'assault-chapter-pacing/v1' : PACING.schema, encounter.id);
  assert.equal(JSON.stringify(rebuildDesign(design.encounters, native)), JSON.stringify(design.encounters));
});

test('sparse and weak first, denser and stronger later, densest in the last third', () => {
  for (const entry of legacyMetrics) {
    const seg = entry.segments5;
    // the first fifth is the sparsest and the weakest part of the battle
    for (const part of seg.slice(1)) {
      assert.ok(seg[0].count <= part.count, `${entry.id} first fifth count ${seg[0].count} > ${part.count}`);
      assert.ok(seg[0].hp <= part.hp, `${entry.id} first fifth hp ${seg[0].hp} > ${part.hp}`);
    }
    // later fifths rise, allowing a small dip (one unit, or a quarter of the strongest earlier fifth's HP)
    for (let i = 1; i < seg.length; i += 1) {
      const priorCount = Math.max(...seg.slice(0, i).map((part) => part.count));
      const priorHp = Math.max(...seg.slice(0, i).map((part) => part.hp));
      assert.ok(seg[i].count >= priorCount - 1, `${entry.id} fifth ${i + 1} count ${seg[i].count} falls below ${priorCount}`);
      assert.ok(seg[i].hp >= 0.75 * priorHp, `${entry.id} fifth ${i + 1} hp ${seg[i].hp} falls below 75% of ${priorHp}`);
    }
    assert.ok(seg[4].hp >= Math.max(...seg.map((part) => part.hp)) * 0.75, `${entry.id} last fifth is not among the strongest`);
    const [a, b, c] = entry.thirds;
    assert.ok(c.count >= a.count && c.count >= b.count, `${entry.id} last third is not the densest: ${a.count}/${b.count}/${c.count}`);
  }
});

test('highlight elites spawn in the late part; the final boss follows the opening escorts', () => {
  for (const encounter of legacy) {
    const entry = metrics.find((item) => item.id === encounter.id);
    const late = highlightKeys(encounter, baseOf(encounter).roster, native);
    const bossId = encounter.wave.bossId;
    for (const unit of entry.lateUnits.filter((item) => item.key !== bossId)) {
      assert.ok(unit.u >= PACING.lateStart - 0.02, `${encounter.id} elite ${unit.key} spawns at u=${unit.u}`);
    }
    if (bossId) {
      const sorted = [...encounter.wave.spawns].sort((x, y) => x.time - y.time);
      assert.notEqual(sorted[0].key, bossId, `${encounter.id} opens with the boss`);
      assert.ok(late.has(bossId));
    }
  }
});

test('types follow the original roster: no new enemy, same types, proportional counts', () => {
  for (const encounter of legacy) {
    const base = baseOf(encounter).roster;
    const now = {};
    for (const spawn of encounter.wave.spawns) now[spawn.key] = (now[spawn.key] ?? 0) + spawn.count;
    assert.deepEqual(Object.keys(now).sort(), base.map((entry) => entry.key).sort(), `${encounter.id} enemy types changed`);
    for (const entry of base) {
      assert.ok(now[entry.key] >= entry.count, `${encounter.id} ${entry.key} lost units`);
      assert.ok(now[entry.key] <= Math.round(entry.count * encounter.wave.pacing.countFactor) + 1, `${encounter.id} ${entry.key} grew past the band factor`);
    }
  }
});

test('interleaved spawns: with three or more types no type holds over half of any 20 s window', () => {
  for (const entry of legacyMetrics) {
    assert.ok(entry.types >= 3, `${entry.id} has ${entry.types} types`);
    assert.ok(entry.maxShare20.share <= PACING.maxShare + 1e-9,
      `${entry.id} ${entry.maxShare20.key} holds ${entry.maxShare20.share} of the 20 s window from ${entry.maxShare20.from}s`);
  }
});

test('later days bring more enemies and more total HP', () => {
  for (const kind of ['normal', 'risk']) {
    const means = [0, 1, 2, 3, 4].map((band) => {
      const list = metrics.filter((entry) => entry.kind === kind && entry.band === band);
      return { count: list.reduce((sum, entry) => sum + entry.total, 0) / list.length, hp: list.reduce((sum, entry) => sum + entry.totalHp, 0) / list.length };
    });
    for (let band = 1; band < means.length; band += 1) {
      assert.ok(means[band].count > means[band - 1].count, `${kind} band ${band + 1} count ${means[band].count} <= ${means[band - 1].count}`);
      assert.ok(means[band].hp > means[band - 1].hp, `${kind} band ${band + 1} hp ${means[band].hp} <= ${means[band - 1].hp}`);
    }
  }
  for (const encounter of legacy) {
    const { countFactor, hpFactor } = encounter.wave.pacing;
    assert.equal(countFactor, PACING.countCurve[bandOf(encounter)]);
    assert.equal(hpFactor, PACING.hpCurve[bandOf(encounter)]);
  }
});

test('the battle applies each spawn hpScale on top of the type calibration; the boss pool and old waves stay as they were', () => {
  const context = createAssaultContext();
  const run = (encounter) => {
    const state = createRun({ runId: `wave-pacing-${encounter.id}`, seed: 20261021, directorId: context.design.system.directors[0].id }, context);
    state.prepEncounterId = encounter.id;
    state.currentNode = { id: encounter.id, kind: 'battle', encounterId: encounter.id, battleKind: encounter.kind,
      name: encounter.name, rewards: encounter.rewards, boardRegion: encounter.boardRegion, stageId: encounter.stageId };
    state.phase = 'battlePrep';
    for (const piece of state.pieces) { piece.row = null; piece.col = null; }
    return buildAssaultBattleInput(context.prepareBattle(state, encounter), { runtime: context.runtime, nativeData: context.nativeData, kits: context.kits });
  };
  const encounter = context.design.encounters.encounters.find((entry) => entry.kind === 'final');
  const built = run(encounter);
  const bossId = encounter.wave.bossId;
  encounter.wave.spawns.forEach((spawn, index) => {
    const mods = built.spawnSpecs[index].mods;
    if (spawn.key === bossId) { assert.equal(mods.hpMul, 1); return; }
    const calibrated = calibratedHpMul(encounter, spawn.key);
    assert.ok(Math.abs(mods.hpMul - calibrated * spawn.hpScale) < 1e-9, `${spawn.key} hpMul ${mods.hpMul}`);
  });
  assert.equal(built.battle.sharedBoss.maxHp, encounter.wave.overrides[bossId].stats.sharedPoolHp ?? encounter.wave.overrides[bossId].stats.maxHp);
  // a battle prepared before pacing keeps its own block spawns without hpScale
  const legacy = structuredClone(encounter);
  legacy.wave.spawns = legacy.wave.spawns.map(({ hpScale, ...spawn }) => spawn);
  const old = run(legacy);
  legacy.wave.spawns.forEach((spawn, index) => {
    if (spawn.key === bossId) return;
    assert.equal(old.spawnSpecs[index].mods.hpMul, calibratedHpMul(encounter, spawn.key));
  });
});
