// test/assault/fx-compat.test.mjs — the Assault instant-skill compatibility layer (public/js/assault/fxCompat.js, T11):
// the official unit / skill a body's record points at (`record`, skills.js resolveSkill's rec.fx), the compressed
// plan of `planHook` (fx-mapping-spec.md §2 defaults, §9.1 香草, the hit group / projectile / immutability rules),
// the three render/vfx/skillfx.js hooks (the plan hook at a unit's first resolve, `holdS` in _keep) and the table
// loader on a page that has none.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createFxCompat, loadFxSkillMap } from '../../public/js/assault/fxCompat.js';
import { emptyPlan } from '../../public/js/render/vfx/skills.js';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';

const SCHEMA = 'assault-fx-skill-map/v1';

/** The spec §9.2 / §9.1 / §3.1 entries this file works with. */
function makeMap(phases = {}, extra = {}) {
  return {
    schema: SCHEMA,
    entries: {
      char_290_vigna: {
        assaultSkill: '槌音（进击）', shape: 'instant',
        official: { unit: 'char_290_vigna', skill: 'skchr_vigna_2' },
        phases: { loop: { holdS: 0.6 }, ...phases },
      },
      char_240_wyvern: {
        assaultSkill: '冲锋号令·援军（进击）', shape: 'instant',
        official: { unit: 'char_240_wyvern', skill: 'skchr_wyvern_1' },
        phases: { loop: { holdS: 0.6 }, attackFrom: 'none' },
      },
      char_4000_jnight: { assaultSkill: '正义助威（进击）', shape: 'passive', official: null, phases: {} },
      ...extra,
    },
  };
}

/** Our data record of an Assault body (shared/assault/battle-input.js makeChessRecords). */
const assaultRec = (charId, skill = { skillId: 'skchr_vigna_2', index: 1 }, source = 'skchr_vigna_2') => ({
  charId, assaultBody: { charId },
  skill,
  assaultPiece: { fixedSkill: { sourceSkillId: source } },
});

/** The plan of a lasting official skill with a skill-held loop, three hit groups, an aim-less attack and a target loop. */
function basePlan(unitKey = 'char_290_vigna', skillId = 'skchr_vigna_2') {
  const plan = emptyPlan(unitKey, skillId);
  plan.kind = 'lasting';
  plan.loop = [{ key: 'loop_a', hold: 'skill', loop: true, role: 'loop' }];
  plan.attacks = [{
    node: null, ability: 'MeleeAttack', cast: [], range: [], aim: [],
    projectile: 'proj_a', shot: { mount: null }, hit: [[1], [2], [3]],
    hitOpts: { indexed: false, loop: false, random: false, once: false },
  }];
  plan.targets = [{ key: 'target_a', hold: 'skill', role: 'loop' }];
  plan.projectiles = ['proj_a'];
  return plan;
}

/** The planFor result of an ally body. */
const planForResult = (plan, unitKey = 'char_290_vigna', skillId = 'skchr_vigna_2') => ({
  unitKey, skillId, reason: null, srec: {}, plan, charge: null, enemy: [],
});

const hookOf = (c, phases = {}, plan = basePlan(), extra = {}) => c.planHook(planForResult(plan),
  { info: { side: 'ally' }, rec: assaultRec('char_290_vigna'), unitKey: 'char_290_vigna', idx: null, ...extra });

describe('record', () => {
  test('an entry points the record at its official unit and skill, by slot and by id; the record is not changed', () => {
    const c = createFxCompat(makeMap());
    const rec = assaultRec('char_290_vigna');
    const out = c.record({ side: 'ally', spine: 'char_290_vigna' }, rec);
    assert.equal(out.fx.unit, 'char_290_vigna');
    assert.equal(out.fx.skills.skchr_vigna_2, 'skchr_vigna_2');
    assert.equal(out.fx.skills['1'], 'skchr_vigna_2', 'the slot index too: resolveSkill reads it first');
    assert.equal('fx' in rec, false, 'the base record is untouched');
    assert.notEqual(out, rec);
    assert.equal(out.skill, rec.skill);
  });

  test('a body without an entry falls back to its fixed skill under its own charId (spec §3)', () => {
    const c = createFxCompat(makeMap());
    const rec = assaultRec('char_999_plain', { skillId: 'skchr_plain_1', index: 0 }, 'skchr_plain_1');
    const out = c.record({ side: 'ally' }, rec);
    assert.equal(out.fx.unit, 'char_999_plain');
    assert.equal(out.fx.skills.skchr_plain_1, 'skchr_plain_1');
    assert.equal(out.fx.skills['0'], 'skchr_plain_1');
  });

  test('an official: null entry (正义骑士号) adds no fx', () => {
    const c = createFxCompat(makeMap());
    const rec = assaultRec('char_4000_jnight', { skillId: 'skchr_none', index: 0 }, '');
    const out = c.record({ side: 'ally' }, rec);
    assert.equal('fx' in out, false);
    assert.equal(out, rec);
  });

  test('an enemy, or a record no charId names, is returned as it is', () => {
    const c = createFxCompat(makeMap());
    const rec = assaultRec('char_290_vigna');
    assert.equal(c.record({ side: 'enemy' }, rec), rec);
    const bare = { skill: { skillId: 'skchr_x_1', index: 0 } };
    assert.equal(c.record({ side: 'ally' }, bare), bare);
  });

  test('the charId comes from assaultBody, then the record, then the view spine', () => {
    const c = createFxCompat(makeMap());
    const srec = { skillId: 'skchr_vigna_2', index: 1 };
    const body = c.record({ side: 'ally' }, { assaultBody: { charId: 'char_290_vigna' }, charId: 'char_000_other', skill: srec });
    assert.equal(body.fx.unit, 'char_290_vigna', 'assaultBody wins');
    const own = c.record({ side: 'ally', spine: 'char_000_other' }, { charId: 'char_290_vigna', skill: srec });
    assert.equal(own.fx.unit, 'char_290_vigna', 'the record own charId next');
    const spine = c.record({ side: 'ally', spine: 'char_290_vigna' }, { skill: srec, assaultPiece: { fixedSkill: { sourceSkillId: 'skchr_vigna_2' } } });
    assert.equal(spine.fx.unit, 'char_290_vigna', 'the spine last');
  });

  test('a null table runs on the spec §2 defaults', () => {
    const c = createFxCompat(null);
    const rec = assaultRec('char_290_vigna');
    assert.equal(c.record({ side: 'ally' }, rec).fx.unit, 'char_290_vigna');
  });
});

describe('planHook', () => {
  test('the defaults: instant, the loop held for 0.8 s, target loops go to the status wiring', () => {
    const c = createFxCompat(makeMap());
    const rec = assaultRec('char_999_plain');
    const out = hookOf(c, {}, basePlan(), { rec });
    assert.equal(out.plan.kind, 'instant');
    assert.equal(out.plan.loop[0].hold, 'cast');
    assert.equal(out.plan.loop[0].holdS, 0.8);
    assert.deepEqual(out.plan.targets, []);
    assert.equal(out.plan.mode, null);
    assert.equal(out.plan.modeName, null);
  });

  test('spec §9.1 香草: loop 0.6 s, no attack rows', () => {
    const c = createFxCompat(makeMap());
    const plan = basePlan('char_240_wyvern', 'skchr_wyvern_1');
    const out = hookOf(c, {}, plan, { rec: assaultRec('char_240_wyvern', { skillId: 'skchr_wyvern_1', index: 0 }) });
    assert.equal(out.plan.loop[0].holdS, 0.6);
    assert.deepEqual(out.plan.attacks, []);
    assert.deepEqual(out.plan.each, { cast: [], hit: [[]] });
  });

  test('hits: first / last / all pick the group of the one cast', () => {
    const first = hookOf(createFxCompat(makeMap({ hits: 'first' }))).plan;
    assert.deepEqual(first.attacks[0].hit, [[1]]);
    const last = hookOf(createFxCompat(makeMap({ hits: 'last' }))).plan;
    assert.deepEqual(last.attacks[0].hit, [[3]]);
    const all = hookOf(createFxCompat(makeMap({ hits: 'all' }))).plan;
    assert.deepEqual(all.attacks[0].hit, [[1, 2, 3]]);
  });

  test('projectile: none drops the plan projectiles and every attack\'s shot', () => {
    const out = hookOf(createFxCompat(makeMap({ projectile: 'none' }))).plan;
    assert.deepEqual(out.projectiles, []);
    assert.equal(out.attacks[0].projectile, null);
    assert.equal(out.attacks[0].shot, null);
  });

  test('start / range / end / ready / targets hold rules, endDelayS and skip', () => {
    const plan = basePlan();
    plan.start = [{ key: 'start_a', hold: null }];
    plan.range = [{ key: 'range_a', hold: 'skill', loop: true }];
    plan.end = [{ key: 'end_a', hold: null }];
    plan.ready = [{ key: 'ready_a', hold: 'ready', loop: true }];
    const out = hookOf(createFxCompat(makeMap({
      start: 'skip', range: { holdS: 1.2 }, targets: { holdS: 1.5 }, endDelayS: 0.7, ready: 'skip',
    })), {}, plan).plan;
    assert.deepEqual(out.start, []);
    assert.equal(out.range[0].hold, 'cast');
    assert.equal(out.range[0].holdS, 1.2);
    assert.equal(out.targets[0].hold, 'cast');
    assert.equal(out.targets[0].holdS, 1.5);
    assert.equal(out.end[0].delayS, 0.7);
    assert.deepEqual(out.ready, []);
  });

  test('attackFrom mode:<name>: the mode attack\'s cast / hit rows become the plan attacks, also when the skill names that mode', () => {
    const row = (k) => ({ effects: [k], oneshot: 1, startEvent: 2, endEvent: 3 });
    const idx = {
      prefabs: { v_start: {}, v_buff: { looping: true }, v_hit: {}, n_hit_1: {}, n_hit_2: {} },
      projectiles: {},
      units: {
        char_290_vigna: { modes: [
          { name: 'Default', attack: { class: 'MeleeAttack', node: 'Modes/Default/Body/Attack', cast: [row('v_start')], hit: [row('v_hit')] } },
          { name: 'S1-2', attack: { class: 'MeleeAttack', node: 'Modes/S1-2/Body/Attack', cast: [row('v_start'), { ...row('v_buff'), oneshot: 0 }], hit: [row('v_hit')] } },
        ] },
        char_1014_nearl2: { modes: [
          { name: 'S3', attack: { class: 'EmptyAnimatedAbility', node: 'Modes/S3/Body/Attack', hit: [row('n_hit_1'), row('n_hit_2')] } },
        ] },
      },
    };
    const plan = basePlan();
    plan.attacks = [];
    plan.mode = 1;
    plan.modeName = 'S1-2';
    const out = hookOf(createFxCompat(makeMap({ attackFrom: 'mode:S1-2' })), {}, plan, { idx }).plan;
    assert.equal(out.attacks.length, 1);
    assert.deepEqual(out.attacks[0].cast.map((e) => e.key), ['v_start', 'v_buff']);
    assert.equal(out.attacks[0].cast[1].hold, 'cast', 'a held cast row of the mode lasts the cast');
    assert.deepEqual(out.attacks[0].hit.flat().map((e) => e.key), ['v_hit']);
    assert.equal(out.modeName, null, 'an instant cast still switches no mode');
    // a mode attack node of another class (耀骑士临光 S3) carries its hits too
    const nearl = hookOf(createFxCompat(makeMap({}, {
      char_1014_nearl2: { shape: 'instant', official: { unit: 'char_1014_nearl2', skill: 'skchr_nearl2_3' }, phases: { attackFrom: 'mode:S3' } },
    })), {}, Object.assign(basePlan('char_1014_nearl2', 'skchr_nearl2_3'), { attacks: [] }),
    { idx, unitKey: 'char_1014_nearl2', rec: assaultRec('char_1014_nearl2', { skillId: 'skchr_nearl2_3', index: 2 }, 'skchr_nearl2_3') }).plan;
    assert.deepEqual(nearl.attacks.flatMap((a) => a.hit.flat()).map((e) => e.key), ['n_hit_1', 'n_hit_2']);
  });

  test('the caller\'s plan is not changed: its arrays and entries keep their values', () => {
    const plan = basePlan();
    const before = JSON.parse(JSON.stringify(plan));
    const out = hookOf(createFxCompat(makeMap({ hits: 'last', projectile: 'none', targets: { holdS: 1.5 } })), {}, plan);
    assert.equal(out.plan === plan, false);
    assert.equal(out.plan.loop === plan.loop, false);
    assert.equal(out.plan.loop[0] === plan.loop[0], false);
    assert.equal(out.plan.attacks === plan.attacks, false);
    assert.equal(out.plan.attacks[0] === plan.attacks[0], false);
    assert.deepEqual(plan, before);
  });

  test('an enemy, a request without a plan, or a broken plan comes back as it is', () => {
    const c = createFxCompat(makeMap());
    const r = planForResult(basePlan());
    assert.equal(c.planHook(r, { info: { side: 'enemy' } }), r);
    const empty = { plan: null };
    assert.equal(c.planHook(empty, { info: { side: 'ally' } }), empty);
    const broken = { plan: Object.defineProperty({}, 'start', { get() { throw new Error('broken plan'); } }) };
    assert.equal(c.planHook(broken, { info: { side: 'ally' } }), broken);
  });
});

/** The index a body's official skill resolves against (one empty skill). */
function makeIndex() {
  const prefabs = {};
  return {
    units: {
      char_290_vigna: {
        kind: 'char', modes: [{ name: 'Default', attack: { class: 'MeleeAttack', cast: [], hit: [] } }],
        skills: { skchr_vigna_2: { mode: null, projectiles: [], uses: [] } },
      },
    },
    skills: {}, projectiles: {}, prefabs, generic: { status: {} }, skins: {},
  };
}

function fakeOfx(index) {
  return {
    active: true, time: 0, tier: 'full', timers: [],
    lib: {
      has: (k) => !!index.prefabs[k], def: (k) => index.prefabs[k] || null,
      index: async () => index, preload: async () => 0,
    },
  };
}

describe('skillfx hooks', () => {
  test('the plan hook runs once at a unit\'s resolve and receives the view\'s info, record, key and index', async () => {
    const index = makeIndex();
    const ofx = fakeOfx(index);
    const seen = [];
    const hook = (r, ctx) => { seen.push([r, ctx]); return r; };
    const w = new FxWiring(ofx, {
      unitKey: (info) => info.spine, record: () => assaultRec('char_290_vigna'), view: () => null, planHook: hook,
    });
    await w.ready();
    const v = { id: 1, x: 5, y: 10, isEnemy: false, alive: true, flags: 0,
      info: { id: 1, spine: 'char_290_vigna', defId: 'char_290_vigna', side: 'ally', kind: 'op', skillIndex: 0 } };
    w.skill(v, true);
    w.skill(v, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0][1].info, v.info);
    assert.equal(seen[0][1].rec.charId, 'char_290_vigna');
    assert.equal(seen[0][1].unitKey, 'char_290_vigna');
    assert.equal(seen[0][1].idx, w.idx);
  });

  test('a held cast row stops after its holdS (1.5 s), or after SKILL_CAST_S (0.6 s) without one', async () => {
    const index = makeIndex();
    const ofx = fakeOfx(index);
    const w = new FxWiring(ofx, { unitKey: () => null, record: () => null, view: () => null });
    await w.ready();
    const U = { loops: [], ready: [] };
    const held = { held: false, stop() { this.held = true; } };
    w.skills._keep(U, { key: 'a', hold: 'cast', holdS: 1.5 }, held);
    ofx.time = 1.4;
    w.tick();
    assert.equal(held.held, false, 'still held at 1.4 s');
    ofx.time = 1.5;
    w.tick();
    assert.equal(held.held, true, 'stopped at 1.5 s');

    const plain = { held: false, stop() { this.held = true; } };
    w.skills._keep(U, { key: 'b', hold: 'cast' }, plain);
    ofx.time = 2.0;
    w.tick();
    assert.equal(plain.held, false, 'the default is the cast\'s 0.6 s, not more');
    ofx.time = 2.1;
    w.tick();
    assert.equal(plain.held, true, 'stopped 0.6 s after 1.5 s');
  });
});

describe('loadFxSkillMap', () => {
  test('a page without the table (404), another schema, or a parse error gives null', async () => {
    const real = globalThis.fetch;
    try {
      let asked = null;
      globalThis.fetch = async (url) => { asked = url; return { ok: false, status: 404, json: async () => { throw new Error('no body'); } }; };
      assert.equal(await loadFxSkillMap(), null);
      assert.match(String(asked), /fx-skill-map\.json$/);
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ schema: 'other/v9' }) });
      assert.equal(await loadFxSkillMap(), null);
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
      assert.equal(await loadFxSkillMap(), null);
      globalThis.fetch = async () => { throw new TypeError('offline'); };
      assert.equal(await loadFxSkillMap(), null);
    } finally {
      globalThis.fetch = real;
    }
  });

  test('the table itself is returned', async () => {
    const real = globalThis.fetch;
    const table = makeMap();
    try {
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => table });
      assert.equal(await loadFxSkillMap(), table);
    } finally {
      globalThis.fetch = real;
    }
  });
});
