import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getIndependentField, previewUnitStats, runIndependentBattle } from '../../server/modes/independent/battle.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';

const DATA = getData();
const CHESS_ID = 'chess_char_1_02_a';
const LOW_BOSS_DATA = {
  ...DATA,
  bosses: Object.fromEntries(Object.entries(DATA.bosses).map(([id, boss]) => [id, {
    ...boss,
    bloodPoint: { FUNNY: 1000, NORMAL: 1000, HARD: 1000, ABYSS: 1000 },
  }])),
};

function testCatalog({ equipment = [] } = {}) {
  const catalog = {
    operators: {
      [CHESS_ID]: {
        nativeTrait: {
          effect: {
            combat: [{
              trigger: 'deploy',
              behavior: 'eventProduction',
              params: {
                counterEvent: 'deploy', counterEvery: 1, outputs: [{ id: 'precision', quantity: 2 }], maxPerBattle: 4,
                filter: { actor: 'self' },
              },
            }],
          },
        },
      },
    },
    badges: {},
    equipment: Object.fromEntries(equipment.map((e) => [e.id, e])),
    attachments: {},
  };
  return catalog;
}

function state(overrides = {}) {
  return {
    seed: 73,
    difficulty: 'FUNNY',
    roundLimit: 9,
    round: 1,
    pieces: [{ uid: 'u1', chessId: CHESS_ID, row: 9, col: 2, dir: 'RIGHT', skillIndex: 0, moduleId: 'none', equipment: [], attachments: [], nativeState: {} }],
    ...overrides,
  };
}

test('independent field helper deterministically reuses official normal, boss, and hidden waves', () => {
  const funny = state();
  const a = getIndependentField(funny, { data: DATA });
  const b = getIndependentField(funny, { data: DATA });
  assert.equal(a.stageId, b.stageId);
  assert.deepEqual(a.wave.spawns, b.wave.spawns);
  assert.equal(a.field, 'normal');
  assert.ok(a.deployMap instanceof Map);

  const boss = getIndependentField(state({ round: 9 }), { data: DATA });
  assert.equal(boss.field, 'bossL');
  assert.match(boss.wave.templateId, /_s$/);

  const boss14 = getIndependentField(state({ difficulty: 'NORMAL', roundLimit: 14, round: 14 }), { data: DATA });
  assert.equal(boss14.field, 'bossL');
  assert.match(boss14.wave.templateId, /_s$/);

  const hidden = getIndependentField(state({ difficulty: 'NORMAL', roundLimit: 15, round: 15 }), { data: DATA });
  assert.equal(hidden.field, 'bossL');
  assert.match(hidden.wave.templateId, /_s$/);
});

test('early pressure trims only configured ordinary spawns and leaves round five unchanged', () => {
  const catalog = getCatalog(DATA);
  const baseline = { ...catalog, config: { ...catalog.config, earlyWaveEnemyCountTrim: {} } };
  const make = (round, difficulty = 'NORMAL') => state({ seed: 73031, difficulty, roundLimit: 19, round, pieces: [] });
  const count = (wave) => wave.spawns.reduce((sum, spawn) => sum + Number(spawn.count || 1), 0);
  const normal3 = getIndependentField(make(3), { data: DATA, catalog });
  const normal4 = getIndependentField(make(4), { data: DATA, catalog });
  assert.equal(count(normal3.wave), 5);
  assert.equal(count(normal4.wave), 10);
  assert.ok(normal4.wave.spawns.some((spawn) => ['EF', 'E', 'S'].includes(spawn.mods?.slot)), 'elite and special slots remain present');
  assert.equal(count(getIndependentField(make(5), { data: DATA, catalog }).wave), count(getIndependentField(make(5), { data: DATA, catalog: baseline }).wave));
  assert.equal(count(getIndependentField(make(1, 'HARD'), { data: DATA, catalog } ).wave), 4);
});

test('independent runner resolves KITS and returns actual Battle events and native rewards without mutating state', () => {
  const input = state();
  const before = structuredClone(input);
  const out = runIndependentBattle(input, { data: DATA, catalog: testCatalog() });
  assert.deepEqual(input, before);
  assert.equal(out.diagnostics.modeId, 'mode_single_funny');
  assert.equal(out.diagnostics.kind, 'normal');
  assert.equal(out.diagnostics.errorCount, 0);
  assert.ok(out.result.time > 0);
  assert.ok(out.result.total > 0, 'official wave spawns must feed the real Battle');
  assert.ok(out.result.perPlayer.independent.unitStats[0].attacks > 0, 'independent keeps the upstream operator kit/skill');
  assert.deepEqual(out.rewards, [{ id: 'precision', quantity: 2, origin: 'native', sourceUid: 'u1' }]);
  assert.ok(out.samples.length > 0 && out.samples.length <= 24);
  assert.equal(out.pieceStates.u1.battle.counters['independentCounter:native:eventProduction:deploy'], 0);
});

test('preview and actual Battle use the same percentage badge stats',()=>{
  const baseCatalog=getCatalog(DATA);
  const catalog={...baseCatalog,operators:{...baseCatalog.operators,[CHESS_ID]:{
    ...baseCatalog.operators[CHESS_ID],nativeTrait:{effect:{combat:[]}},
  }}};
  const input=state({pieces:[{...state().pieces[0],equipment:[
    {uid:'p',id:'precision',quantity:2,state:{}},{uid:'v',id:'vitality',quantity:2,state:{}},{uid:'a',id:'assault',quantity:2,state:{}},
  ]}]});
  const preview=previewUnitStats(input,{data:DATA,catalog}).u1;
  const actual=runIndependentBattle(input,{data:DATA,catalog});
  const first=Object.values(actual.replay.frames.find((frame)=>frame.stats)?.stats || {}).find((entry)=>entry.defId===CHESS_ID);
  assert.ok(first,'actual Battle records the operator stats');
  assert.equal(first.atk,preview.atk);
  assert.equal(first.maxHp,preview.maxHp);
});

test('functional equipment production counts ordinary attack events and keeps equipment origin', () => {
  const catalog = testCatalog({ equipment: [{
    id: 'recording-kit', mechanism: 'attackEventProduction', params: {
      counterEvent: 'attack', counterEvery: 3, outputs: [{ id: 'precision', quantity: 1 }],
      filter: { actor: 'self', nativeOnly: true },
    },
  }] });
  const input = state({ pieces: [{ ...state().pieces[0], equipment: [{ uid: 'item-1', id: 'recording-kit' }] }] });
  const out = runIndependentBattle(input, { data: DATA, catalog });
  assert.ok(out.result.perPlayer.independent.unitStats[0].attacks >= 15);
  assert.ok(out.rewards.some((r) => r.id === 'precision' && r.origin === 'equipment' && r.sourceUid === 'u1'));
  assert.ok(out.rewards.find((r) => r.origin === 'equipment').quantity >= 5, 'five real attack cycles produce without an artificial battle cap');
});

test('round 9, 14, and 15 use real boss/hidden Battle instances selected by roundLimit', () => {
  for (const [difficulty, roundLimit, round, kind] of [
    ['FUNNY', 9, 9, 'boss'],
    ['NORMAL', 14, 14, 'boss'],
    ['NORMAL', 15, 14, 'boss'],
    ['NORMAL', 15, 15, 'hidden'],
  ]) {
    const out = runIndependentBattle(state({ difficulty, roundLimit, round }), { data: LOW_BOSS_DATA, catalog: testCatalog() });
    assert.equal(out.diagnostics.kind, kind, `round ${round} / limit ${roundLimit}`);
    assert.ok(out.diagnostics.templateId, `round ${round} uses an upstream wave template`);
    assert.ok(['cleared', 'timeout'].includes(out.result.reason), JSON.stringify({ round, kind, diagnostics: out.diagnostics, reason: out.result.reason }));
    assert.equal(out.diagnostics.errorCount, 0);
  }
});
