import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAssaultDesign } from '../../server/modes/assault/data.js';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { createRun } from '../../shared/assault/run.js';
import { buildAssaultBattleInput, enemyDayScale } from '../../shared/assault/battle-input.js';
import { ENEMY_TUNING, capAllocations, enemyDayScale as tunedDayScale } from '../../tools/assault/chapter-enemy-sets.mjs';

const all = loadAssaultDesign().encounters.encounters;
const encounters = all.filter((encounter) => encounter.chapterSourceRef);
const finals = all.filter((encounter) => encounter.kind === 'final');
const bandOf = (encounter) => Math.floor((encounter.dayRange[0] - 1) / 2);
const shares = (encounter) => {
  const counts = {};
  for (const spawn of encounter.wave.spawns) counts[spawn.key] = (counts[spawn.key] ?? 0) + spawn.count;
  return Object.values(counts).map((n) => n / encounter.wave.spawns.length);
};
const round4 = (value) => Math.round(value * 1e4) / 1e4;
// effective multipliers of an enemy of this encounter on `day` (what the battle applies: constant override x day scale)
const effective = (encounter, key, day) => {
  const stats = encounter.wave.overrides[key].stats, scale = enemyDayScale(encounter.wave, day);
  return { atk: stats.atk * scale.atk, hp: stats.maxHp * scale.hp, speed: (stats.moveSpeed ?? 1) * scale.speed, k: scale.k };
};
const escortKeys = (encounter) => Object.keys(encounter.wave.overrides).filter((key) => key !== encounter.wave.bossId);

test('the k table follows the original ultimate rounds and the constants are the only strength knobs', () => {
  assert.deepEqual([...ENEMY_TUNING.dayK], [1, 2, 2, 2, 3, 3, 3, 4, 5, 6]);
  assert.equal(ENEMY_TUNING.finalK, 7);
  assert.equal(ENEMY_TUNING.riskExtraK, 1);
  assert.equal(ENEMY_TUNING.atkBase, 1.1);
  assert.equal(ENEMY_TUNING.hpBase, 1.2);
  for (let i = 1; i < ENEMY_TUNING.dayK.length; i += 1) assert.ok(ENEMY_TUNING.dayK[i] >= ENEMY_TUNING.dayK[i - 1]);
  // original R1 and R14 anchors: attack 1.1 / 1.95, HP 1.2 / 3.58
  const first = tunedDayScale(1), last = tunedDayScale(10, { final: true });
  assert.deepEqual([first.atk, first.hp], [1.1, 1.2]);
  assert.deepEqual([last.atk, last.hp], [round4(1.1 ** 7), round4(1.2 ** 7)]);
  assert.equal(tunedDayScale(1).speed, 1);
  assert.equal(tunedDayScale(2).speed, ENEMY_TUNING.speedMul);
});

test('every chapter enemy is native x C x 1.1^k (attack) and native x C x 1.2^k (HP) on its day', () => {
  assert.equal(encounters.length, 30);
  for (const encounter of encounters) {
    const band = bandOf(encounter), risk = encounter.kind === 'risk';
    const total = Math.round(ENEMY_TUNING.count[band] * (risk ? ENEMY_TUNING.riskCountFactor[band] : 1));
    assert.equal(encounter.wave.spawns.length, total, `${encounter.id} enemy count`);
    for (const [key, override] of Object.entries(encounter.wave.overrides)) {
      assert.deepEqual(override.stats, { maxHp: ENEMY_TUNING.C.hp, atk: ENEMY_TUNING.C.atk }, `${encounter.id} ${key} constants`);
    }
    assert.deepEqual(Object.keys(encounter.wave.dayScale).map(Number), Array.from({ length: encounter.dayRange[1] - encounter.dayRange[0] + 1 }, (_, i) => encounter.dayRange[0] + i));
    for (let day = encounter.dayRange[0]; day <= encounter.dayRange[1]; day += 1) {
      const k = ENEMY_TUNING.dayK[day - 1] + (risk ? ENEMY_TUNING.riskExtraK : 0);
      for (const key of Object.keys(encounter.wave.overrides)) {
        const got = effective(encounter, key, day);
        assert.equal(got.k, k, `${encounter.id} day ${day} k`);
        assert.ok(Math.abs(got.atk - ENEMY_TUNING.C.atk * ENEMY_TUNING.atkBase ** k) < 1e-3, `${encounter.id} day ${day} atk ${got.atk}`);
        assert.ok(Math.abs(got.hp - ENEMY_TUNING.C.hp * ENEMY_TUNING.hpBase ** k) < 1e-3, `${encounter.id} day ${day} hp ${got.hp}`);
        assert.equal(got.speed, day >= ENEMY_TUNING.speedFromDay ? ENEMY_TUNING.speedMul : 1, `${encounter.id} day ${day} speed`);
      }
    }
    const times = encounter.wave.spawns.map((spawn) => spawn.time);
    assert.equal(Math.min(...times), ENEMY_TUNING.firstSpawn, `${encounter.id} first spawn`);
    assert.equal(Math.max(...times), ENEMY_TUNING.firstSpawn + ENEMY_TUNING.span[band], `${encounter.id} last spawn`);
  }
});

test('finals: escorts take k = 7, the boss keeps its designed attack and its shared pool does not take k', () => {
  assert.equal(finals.length, 6);
  for (const encounter of finals) {
    const bossId = encounter.wave.bossId, boss = encounter.wave.overrides[bossId].stats;
    const pool = Math.round(ENEMY_TUNING.finalBossBasePool[bossId] * ENEMY_TUNING.finalBossPoolMul);
    assert.equal(boss.sharedPoolHp, pool, `${encounter.id} boss pool`);
    assert.equal(boss.maxHp, pool, `${encounter.id} boss absolute hp`);
    assert.equal(boss.hpMode, 'absolute');
    assert.ok(boss.atk > 0 && boss.atk < ENEMY_TUNING.C.atk * ENEMY_TUNING.atkBase ** ENEMY_TUNING.finalK * 1.01, `${encounter.id} boss attack stays as designed`);
    assert.ok(escortKeys(encounter).length >= 4);
    for (const key of escortKeys(encounter)) {
      const got = effective(encounter, key, 10);
      assert.equal(got.k, ENEMY_TUNING.finalK);
      assert.ok(Math.abs(got.atk - ENEMY_TUNING.C.atk * 1.1 ** 7) < 1e-3, `${encounter.id} ${key} atk ${got.atk}`);
      assert.ok(Math.abs(got.hp - ENEMY_TUNING.C.hp * 1.2 ** 7) < 1e-3, `${encounter.id} ${key} hp ${got.hp}`);
      assert.equal(got.speed, ENEMY_TUNING.speedMul);
    }
  }
});

test('strength never falls from day 1 to the final, and a risk fight is never weaker than a normal one of the same day', () => {
  const byDay = (kind) => {
    const rows = [];
    for (let day = 1; day <= 10; day += 1) {
      const factors = encounters.filter((e) => e.kind === kind && e.dayRange[0] <= day && day <= e.dayRange[1])
        .flatMap((e) => Object.keys(e.wave.overrides).map((key) => effective(e, key, day)));
      assert.ok(factors.length, `${kind} day ${day} has encounters`);
      rows.push({ atk: factors.map((f) => f.atk), hp: factors.map((f) => f.hp), speed: factors.map((f) => f.speed) });
    }
    return rows;
  };
  const normal = byDay('normal'), risk = byDay('risk');
  for (const rows of [normal, risk]) {
    for (let day = 1; day < 10; day += 1) {
      for (const stat of ['atk', 'hp', 'speed']) {
        assert.ok(Math.min(...rows[day][stat]) >= Math.max(...rows[day - 1][stat]) - 1e-9, `${stat} falls from day ${day} to ${day + 1}`);
      }
    }
  }
  for (let day = 0; day < 10; day += 1) {
    for (const stat of ['atk', 'hp', 'speed']) assert.ok(Math.min(...risk[day][stat]) >= Math.max(...normal[day][stat]) - 1e-9, `risk ${stat} below normal on day ${day + 1}`);
  }
  for (const encounter of finals) {
    for (const key of escortKeys(encounter)) {
      const got = effective(encounter, key, 10);
      for (const stat of ['atk', 'hp', 'speed']) {
        assert.ok(got[stat] >= Math.max(...risk[9][stat]) - 1e-9, `final ${stat} below the day 10 risk fight`);
        assert.ok(got[stat] >= Math.max(...normal[9][stat]) - 1e-9);
      }
    }
  }
});

test('the battle applies the day scale to every spawned enemy except the boss', () => {
  const context = createAssaultContext();
  const build = (encounter, day) => {
    const state = createRun({ runId: `enemy-tuning-${encounter.id}-${day}`, seed: 20261028, directorId: context.design.system.directors[0].id }, context);
    state.day = day;
    state.prepEncounterId = encounter.id;
    state.currentNode = { id: encounter.id, kind: 'battle', encounterId: encounter.id, battleKind: encounter.kind,
      name: encounter.name, rewards: encounter.rewards, boardRegion: encounter.boardRegion, stageId: encounter.stageId };
    state.phase = 'battlePrep';
    for (const piece of state.pieces) { piece.row = null; piece.col = null; }
    return buildAssaultBattleInput(context.prepareBattle(state, encounter), { runtime: context.runtime, nativeData: context.nativeData, kits: context.kits });
  };
  const pick = [
    ...encounters.filter((e) => e.id.endsWith('_m01') || e.id.endsWith('_m04') || e.id.endsWith('a1m05')),
    ...finals.slice(0, 2),
  ];
  assert.ok(pick.length >= 6);
  for (const encounter of pick) {
    for (let day = encounter.dayRange[0]; day <= encounter.dayRange[1]; day += 1) {
      const built = build(encounter, day), scale = encounter.wave.dayScale[day];
      encounter.wave.spawns.forEach((spawn, index) => {
        const mods = built.spawnSpecs[index].mods, stats = encounter.wave.overrides[spawn.key].stats;
        if (spawn.key === encounter.wave.bossId) { assert.equal(mods.atkMul, stats.atk); assert.equal(mods.speedMul, stats.moveSpeed ?? 1); return; }
        assert.ok(Math.abs(mods.atkMul - stats.atk * scale.atk) < 1e-9, `${encounter.id} day ${day} atkMul`);
        assert.ok(Math.abs(mods.hpMul - stats.maxHp * scale.hp * (spawn.hpScale ?? 1)) < 1e-9, `${encounter.id} day ${day} hpMul`);
        assert.equal(mods.speedMul, scale.speed);
      });
    }
  }
});

test('enemyDayScale: an absent table means no day strength and a day outside the table takes the nearest entry', () => {
  assert.equal(enemyDayScale({}, 3), null);
  assert.equal(enemyDayScale(undefined, 3), null);
  const wave = { dayScale: { 3: { k: 2, atk: 1.21, hp: 1.44, speed: 1.15 }, 4: { k: 2, atk: 1.21, hp: 1.44, speed: 1.15 } } };
  assert.equal(enemyDayScale(wave, 4).atk, 1.21);
  assert.equal(enemyDayScale(wave, 9).k, 2);
  assert.equal(enemyDayScale(wave, undefined).hp, 1.44);
});

test('no enemy type holds more than the share cap of one fight', () => {
  for (const encounter of encounters) for (const share of shares(encounter)) assert.ok(share <= ENEMY_TUNING.maxShare + 1e-9, `${encounter.id} share ${share}`);
});

test('count and span curves rise from band to band', () => {
  for (const curve of [ENEMY_TUNING.count, ENEMY_TUNING.span]) for (let i = 1; i < curve.length; i += 1) assert.ok(curve[i] >= curve[i - 1]);
  for (const curve of [ENEMY_TUNING.count, ENEMY_TUNING.span, ENEMY_TUNING.riskCountFactor]) assert.equal(curve.length, 5);
  assert.equal(ENEMY_TUNING.dayK.length, 10);
});

test('capAllocations keeps the total, the proportions and the cap', () => {
  const split = capAllocations([{ key: 'a', fraction: .7 }, { key: 'b', fraction: .1 }, { key: 'c', fraction: .1 }, { key: 'd', fraction: .1 }], 40);
  assert.equal(split.reduce((sum, item) => sum + item.count, 0), 40);
  assert.equal(split.find((item) => item.key === 'a').count, 16);
  for (const item of split) assert.ok(item.count >= 1 && item.count <= 16);
  assert.throws(() => capAllocations([{ key: 'a', fraction: .5 }, { key: 'b', fraction: .5 }], 10), /cannot hold/);
});
