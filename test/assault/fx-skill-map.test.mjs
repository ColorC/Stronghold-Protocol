// test/assault/fx-skill-map.test.mjs — tools/assault/fx-skill-map.mjs: the seed skeleton, the F-batch input packages, the
// six checks of fx-mapping-spec.md §10 and the batch merge. The coverage pass is exercised through tools/vfx-skill-coverage.mjs
// by test/render/vfx-skills.test.js; here the index is the hand-written miniature test/assault/fixtures/fx-index-mini.json.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = path.join(ROOT, 'tools/assault/fx-skill-map.mjs');
const FIXTURE = path.join(ROOT, 'test/assault/fixtures/fx-index-mini.json');
const SEED = path.join(ROOT, '../../../.omni/tmp/assault/upstream-visual/mapping-seed.json');

const tmp = mkdtempSync(path.join(os.tmpdir(), 'fx-skill-map-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { cwd: ROOT, encoding: 'utf8' });
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const write = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
const batchOf = (entries) => ({ schema: 'assault-fx-skill-map/v1', index: { version: 3, client: 'mini' }, entries });

/** The two spec §9 examples, with the miniature index's real key names. */
function validEntries() {
  return {
    char_290_vigna: {
      assaultSkill: '槌音（进击）',
      shape: 'instant',
      official: { unit: 'char_290_vigna', skill: 'skchr_vigna_2' },
      phases: { attackFrom: 'mode:S2', hits: 'byCount', loop: { holdS: 0.6 } },
      extras: [],
      evidence: {
        design: 'data/assault-design/roster-support.json#/operators/1',
        card: 'server/sim/content/assault/cards/support-bazaar.js:74',
        original: 'skill_table skchr_vigna_2: MANUAL, duration 30, 攻击间隔略增、攻击力+',
        index: 'mini: skchr_vigna_2 mode S2, 3 hit groups',
      },
      confidence: 'medium',
      status: 'filled',
      notes: '',
    },
    char_240_wyvern: {
      assaultSkill: '冲锋号令·援军（进击）',
      shape: 'instant',
      official: { unit: 'char_240_wyvern', skill: 'skchr_wyvern_1' },
      phases: { loop: { holdS: 0.6 }, attackFrom: 'none' },
      extras: [{ what: 'costGain', signal: { event: 'none' }, look: { procedural: 'keep' }, why: '费用增加是游戏事实提示，保留程序表现' }],
      evidence: {
        design: 'data/assault-design/roster-support.json#/operators/0',
        card: 'server/sim/content/assault/cards/support-bazaar.js:65',
        original: 'skill_table skchr_wyvern_1: MANUAL, duration 10, 获得费用+攻击力',
        index: 'mini: skchr_wyvern_1 start + owner loop',
      },
      confidence: 'high',
      status: 'filled',
      notes: '',
    },
  };
}

describe('seed', () => {
  test('172 entries, every official skill from the seed, the body without one pinned to extras', () => {
    const out = path.join(tmp, 'seed', 'fx-skill-map.json');
    const r = run('seed', '--seed', SEED, '--out', out);
    assert.equal(r.status, 0, r.stderr);
    const map = read(out);
    const seed = read(SEED);
    assert.equal(map.schema, 'assault-fx-skill-map/v1');
    assert.deepEqual(map.index, { version: null, client: null });
    assert.equal(Object.keys(map.entries).length, 172);
    assert.equal(seed.entries.length, 172);
    for (const s of seed.entries) {
      const entry = map.entries[s.charId];
      assert.ok(entry, s.charId);
      if (s.skill.sourceSkillId) {
        assert.equal(entry.official.skill, s.skill.sourceSkillId, s.charId);
        assert.equal(entry.official.unit, s.charId);
        assert.equal(entry.status, 'default');
      }
    }
    assert.equal(map.entries.char_4000_jnight.official, null);
    assert.equal(map.entries.char_4000_jnight.status, 'filled');
    assert.match(map.entries.char_4000_jnight.notes, /extras/);
    assert.deepEqual(map.defaults.instant.loop, { holdS: 0.8 });
    assert.equal(map.defaults.passive.modeSwitch, true);
  });

  test('an existing target needs --force', () => {
    const out = path.join(tmp, 'seed', 'again.json');
    assert.equal(run('seed', '--seed', SEED, '--out', out).status, 0);
    const again = run('seed', '--seed', SEED, '--out', out);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /--force/);
  });
});

describe('inputs', () => {
  test('two bodies: the plan summary, the mode attack, the skill_table facts', () => {
    const out = path.join(tmp, 'inputs');
    const r = run('inputs', '--index', FIXTURE, '--seed', SEED, '--out', out, '--only', 'char_290_vigna,char_240_wyvern');
    assert.equal(r.status, 0, r.stderr);
    const vigna = read(path.join(out, 'char_290_vigna.json'));
    assert.equal(vigna.plan.modeName, 'S2');
    assert.equal(vigna.plan.modeAttack.hit.length, 3);
    assert.deepEqual(vigna.plan.modeAttack.hit, [['vigna_skill_02_hit_01'], ['vigna_skill_02_hit_02'], ['vigna_skill_02_hit_03']]);
    assert.equal(vigna.plan.start.length, 1);
    assert.equal(vigna.plan.loop[0].hold, 'skill');
    assert.equal(vigna.index.skillExists, true);
    assert.equal(typeof vigna.skillTable.duration, 'number');
    assert.ok(vigna.skillTable.duration > 0);
    assert.ok(Array.isArray(vigna.simStatuses) && vigna.simStatuses.includes('cold'));
    assert.deepEqual(vigna.genericKeys, ['buff_atk_up']);
    assert.equal(typeof vigna.spCostMin, 'number');
    assert.ok(vigna.cards.length > 0 && vigna.cards.every((c) => /:\d+$/.test(c)));

    const wyvern = read(path.join(out, 'char_240_wyvern.json'));
    assert.deepEqual(wyvern.plan.attacks, []);
    assert.equal(wyvern.plan.start.length, 1);
    assert.equal(wyvern.plan.loop[0].hold, 'skill');
    assert.equal(typeof wyvern.skillTable.duration, 'number');
    assert.ok(wyvern.skillTable.duration > 0);
  });
});

describe('check', () => {
  test('the two spec examples pass', () => {
    const file = path.join(tmp, 'ok.json');
    write(file, batchOf(validEntries()));
    const r = run('check', '--batch', file, '--index', FIXTURE);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.errors, []);
    assert.equal(out.counts.byStatus.filled, 2);
    assert.equal(out.counts.byConfidence.high, 1);
  });

  const cases = {
    'schema': (b) => { b.schema = 'nope'; },
    'phases 多余键': (b) => { b.entries.char_290_vigna.phases.bogus = 1; },
    'holdS=5': (b) => { b.entries.char_290_vigna.phases.loop = { holdS: 5 }; },
    'mode 不存在': (b) => { b.entries.char_290_vigna.phases.attackFrom = 'mode:S9'; },
    'extras 键不在 generic': (b) => {
      b.entries.char_290_vigna.extras = [{ what: 'atkBuff', signal: { event: 'none' }, look: { official: ['not_a_generic_key'], at: 'owner', holdS: 0.6 }, why: 'x' }];
    },
    '缺 evidence': (b) => { delete b.entries.char_290_vigna.evidence; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    test(`one error: ${name}`, () => {
      const batch = batchOf(validEntries());
      mutate(batch);
      const file = path.join(tmp, `${name.replace(/[^\w]+/g, '-')}.json`);
      write(file, batch);
      const r = run('check', '--batch', file, '--index', FIXTURE);
      assert.equal(r.status, 1, `${name}: ${r.stdout}`);
      assert.equal(JSON.parse(r.stdout).errors.length, 1, r.stdout);
    });
  }

  test('a default entry needs no evidence; a missing index is a warning, not an error', () => {
    const entries = validEntries();
    entries.char_290_vigna = {
      assaultSkill: '槌音（进击）',
      shape: 'instant',
      official: { unit: 'char_290_vigna', skill: 'skchr_vigna_2' },
      phases: {},
      extras: [],
      confidence: 'high',
      status: 'default',
      notes: '',
    };
    const file = path.join(tmp, 'default.json');
    write(file, batchOf({ char_290_vigna: entries.char_290_vigna }));
    const r = run('check', '--batch', file);
    assert.equal(r.status, 0, r.stdout);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.errors, []);
    assert.equal(out.warnings.length, 1);
  });
});

describe('merge', () => {
  test('a valid batch replaces its entries and keeps the rest; a broken batch leaves the file untouched', () => {
    const mapPath = path.join(tmp, 'merge', 'fx-skill-map.json');
    const mapBefore = (() => {
      assert.equal(run('seed', '--seed', SEED, '--out', mapPath).status, 0);
      return readFileSync(mapPath, 'utf8');
    })();
    const before = JSON.parse(mapBefore);
    const batch = batchOf(validEntries());
    batch.entries.char_290_vigna.notes = 'merged';
    batch.entries.char_240_wyvern.notes = 'merged';
    const file = path.join(tmp, 'merge', 'batch.json');
    write(file, batch);
    const ok = run('merge', '--batch', file, '--map', mapPath, '--index', FIXTURE);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const after = read(mapPath);
    assert.equal(Object.keys(after.entries).length, 172);
    assert.equal(after.entries.char_290_vigna.notes, 'merged');
    assert.equal(after.entries.char_240_wyvern.notes, 'merged');
    assert.deepEqual(after.entries.char_127_estell, before.entries.char_127_estell);
    assert.deepEqual(after.index, { version: 3, client: 'mini' });

    const bytes = readFileSync(mapPath, 'utf8');
    const bad = batchOf(validEntries());
    bad.entries.char_290_vigna.phases.loop = { holdS: 9 };
    const badFile = path.join(tmp, 'merge', 'bad.json');
    write(badFile, bad);
    const fail = run('merge', '--batch', badFile, '--map', mapPath, '--index', FIXTURE);
    assert.equal(fail.status, 1);
    assert.equal(readFileSync(mapPath, 'utf8'), bytes);
  });
});

describe('CLI', () => {
  test('an unknown option exits 2', () => {
    assert.equal(run('check', '--nope').status, 2);
    assert.equal(run('nothing').status, 2);
  });
});
