import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getData } from '../../server/data.js';
import { bossPoolHp } from '../../server/match/finalAssault.js';
import { GameData } from '../../server/match/gamedata.js';
import { modeIdFor } from '../../shared/constants.js';
import { getIndependentField, runIndependentBattle } from '../../server/modes/independent/battle.js';
import { independentEnemyBalance } from '../../server/modes/independent/enemyBalance.js';

const DATA = getData();
const STATE = (round) => ({ seed: 1087, difficulty: 'FUNNY', roundLimit: 9, round, pieces: [] });
const STAGES = [
  { fromRound: 1, hpMul: 1.2, atkMul: 1.1, defMul: 1.15, resMul: 1.1, bossHpMul: 1.3 },
  { fromRound: 5, hpMul: 1.5, atkMul: 1.2, defMul: 1.25, resMul: 1.2, bossHpMul: 1.6 },
  { fromRound: 9, hpMul: 1.8, atkMul: 1.3, defMul: 1.35, resMul: 1.3, bossHpMul: 1.75 },
];
const catalog = (enemyBalance) => ({ config: enemyBalance ? { enemyBalance } : {}, operators: {}, equipment: {}, attachments: {}, badges: {}, prizes: {} });
const RECEIPTS = [];

after(() => {
  const target = process.env.SP_ENEMY_BALANCE_RESULT_PATH;
  if (!target) return;
  mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  writeFileSync(path.resolve(target), JSON.stringify({ sourceCommit: '9d4c79c6b8087dad21a1f91d0690c9ffde3bfc1c', cases: RECEIPTS }, null, 2), 'utf8');
});

function enemyStats(out) {
  const entries = out.replay.frames.flatMap((frame) => Object.values(frame.stats || {}));
  return entries.filter((entry) => entry.defId && entry.base?.maxHp > 0);
}

test('without Workshop tuning, official normal and boss waves remain byte-for-byte equivalent and source data stays unchanged', () => {
  const sourceWaves = structuredClone(DATA.waves);
  const sourceChoices = structuredClone(DATA.choices);
  for (const round of [1, 5, 9]) {
    const state = STATE(round);
    const implicit = getIndependentField(state, { data: DATA });
    const explicit = getIndependentField(state, { data: DATA, catalog: catalog({}) });
    assert.deepEqual(explicit.wave, implicit.wave, `round ${round} retains its original wave with no stages configured`);
    assert.deepEqual(explicit.wave.spawns, implicit.wave.spawns);
    RECEIPTS.push({ kind: 'unconfiguredWave', round, templateId: explicit.wave.templateId, spawns: explicit.wave.spawns.length, identical: true });
  }
  assert.deepEqual(DATA.waves, sourceWaves);
  assert.deepEqual(DATA.choices, sourceChoices);
});

test('r1, r5, and r9 tuning changes real spawned enemy stats and applies boss HP only to the shared pool', () => {
  const sourceWaves = structuredClone(DATA.waves);
  const baselineCatalog = catalog(undefined);
  const tunedCatalog = catalog({ FUNNY: STAGES });
  for (const round of [1, 5, 9]) {
    const state = STATE(round);
    const baselineField = getIndependentField(state, { data: DATA, catalog: baselineCatalog });
    const tunedField = getIndependentField(state, { data: DATA, catalog: tunedCatalog });
    assert.equal(tunedField.wave.templateId, baselineField.wave.templateId);
    assert.equal(tunedField.wave.spawns.length, baselineField.wave.spawns.length);
    assert.ok(tunedField.wave.spawns.some((spec, i) => Number(spec.mods?.hpMul || 1) !== Number(baselineField.wave.spawns[i].mods?.hpMul || 1)), `round ${round} wave specs carry tuned HP multipliers`);

    const baseline = runIndependentBattle(state, { data: DATA, catalog: baselineCatalog });
    const tuned = runIndependentBattle(state, { data: DATA, catalog: tunedCatalog });
    assert.equal(baseline.diagnostics.errorCount, 0);
    assert.equal(tuned.diagnostics.errorCount, 0);
    const baselineStats = enemyStats(baseline);
    const tunedStats = enemyStats(tuned);
    const baseById = new Map(baselineStats.map((x) => [x.defId, x]));
    const pair = tunedStats.find((x) => baseById.has(x.defId));
    assert.ok(pair, `round ${round} records actual spawned enemy stats`);
    assert.ok(pair.maxHp > baseById.get(pair.defId).maxHp, `round ${round} actual enemy maxHP increases`);
    assert.ok(pair.atk > baseById.get(pair.defId).atk, `round ${round} actual enemy attack increases`);

    let bossPoolMax = null;
    if (round === 9) {
      const gd = new GameData(DATA, modeIdFor('solo', 'funny'));
      const expectedBaseline = bossPoolHp(gd, baselineField.bossId, 1);
      const expectedTuned = Math.round(expectedBaseline * STAGES[2].bossHpMul);
      const bossSnapshot = tuned.replay.frames.find((frame) => frame.snap.boss)?.snap.boss;
      assert.ok(bossSnapshot, 'real round 9 battle exposes its shared boss pool');
      assert.equal(bossSnapshot.max, expectedTuned, 'shared HP uses bossHpMul once and does not also use per-enemy hpMul');
      bossPoolMax = bossSnapshot.max;
      const bossSpecIndex = tunedField.wave.spawns.findIndex((spec) => spec.preview?.boss);
      assert.ok(bossSpecIndex >= 0, 'official boss wave contains a leader spawn');
      assert.equal(tunedField.wave.spawns[bossSpecIndex].mods?.hpMul ?? 1, baselineField.wave.spawns[bossSpecIndex].mods?.hpMul ?? 1, 'leader body HP remains on the shared pool path');
    }
    RECEIPTS.push({ kind: 'tunedBattle', round, templateId: tuned.diagnostics.templateId, enemyId: pair.defId, baseMaxHp: baseById.get(pair.defId).maxHp, tunedMaxHp: pair.maxHp, baseAtk: baseById.get(pair.defId).atk, tunedAtk: pair.atk, bossPoolMax });
  }
  assert.deepEqual(DATA.waves, sourceWaves, 'tuned simulation never mutates source wave definitions');
});

test('invalid balance values and unsorted round thresholds are refused', () => {
  const state = STATE(5);
  assert.throws(() => independentEnemyBalance(state, catalog({ FUNNY: [{ fromRound: 1, hpMul: Number.NaN }] })), /BAD_INDEPENDENT_ENEMY_BALANCE_hpMul/);
  assert.throws(() => independentEnemyBalance(state, catalog({ FUNNY: [{ fromRound: 5 }, { fromRound: 1 }] })), /BAD_INDEPENDENT_ENEMY_BALANCE_ROUND/);
});
