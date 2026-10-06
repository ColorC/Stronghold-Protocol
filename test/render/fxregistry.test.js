// test/render/fxregistry.test.js — the FX registry (render/fxRegistry.js) between the event handler and the FX
// primitives (render/fx.js), and the event fields it reads (shared/protocol.js EV):
//   * resolution: charId:skillId → charId → sub-profession → profession → event kind → the channel default; the event's
//     kind before '*' in every layer; next() runs the layer below; register() returns an undo that restores the
//     previous entry; bad registrations throw
//   * the built-ins: 蕾缪安's lock / bombardShell / bombard / crit, 炎佑's yanyouFlame, the boomerang flight, chain /
//     beam arcs, the splash ring of the splash sub-professions — all registry entries over the default layer
//   * an operator's / a skill's own recipe takes effect with no change to the dispatch code; the default layer ignores
//     the new fields (the melee slash still pairs a blow with its target's next hit)
//   * FxCues reads the appended tuple fields (attackId, isSkill, attacker, skillId) and plays older tuples without them
//   * unitFxIdentity: charId / sub-profession / profession / equipped skill from UnitInfo + the game data
//   * the sim appends them: 'skill' carries its skillId

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

let fake, FX, REG, RCP;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
  REG = await import('../../public/js/render/fxRegistry.js');
  RCP = await import('../../public/js/render/fxRecipes.js');
});
after(() => fake.restore());

const cam = presetCamera('normal', { width: 1600, height: 900 });
const unit = (id, x, y, info = {}) => ({ id, x, y, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, isEnemy: info.side === 'enemy', maxHp: 3000, info: { id, defId: 'x', ...info }, onHit() {} });

/** Game data stand-in for unitFxIdentity. */
const DATA = {
  chess: (id) => ({
    chess_lemuen_a: { charId: 'char_4193_lemuen', profession: 'SNIPER', subProfessionId: 'bombarder', skill: { skillId: 'skchr_lemuen_1', index: 0 }, skills: [{ skillId: 'skchr_lemuen_1', index: 0 }, { skillId: 'skchr_lemuen_2', index: 1 }, { skillId: 'skchr_lemuen_3', index: 2 }] },
    chess_pepe_a: { charId: 'char_4058_pepe', profession: 'WARRIOR', subProfessionId: 'hammer', skill: { skillId: 'skchr_pepe_2', index: 1 } },
    chess_guard_a: { charId: 'char_guard', profession: 'WARRIOR', subProfessionId: 'instructor', skill: { skillId: 'skchr_guard_1', index: 0 } },
  })[id] || null,
  token: (id) => (id === 'token_dragon' ? { tokenId: id, profession: 'TOKEN', subProfessionId: 'notchar1', skill: { skillId: 'sktok_dragon' } } : null),
};

/** A FxSystem with its own registry (the built-ins) and the data identity; `views` resolves ids. */
function makeFx(views = []) {
  const map = new Map(views.map((v) => [v.id, v]));
  const ctx = fakeViewCtx(fake.P);
  const registry = REG.createFxRegistry();
  const fx = new FX.FxSystem({
    P: fake.P, layers: ctx.layers, cam: () => cam, heightAt: () => 0, settings: { quality: 'high', damageNumbers: true },
    timeScale: () => 2, loadLevel: () => 0, view: (id) => map.get(id) || null, screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
    registry, identify: (v) => REG.unitFxIdentity(v.info, DATA),
  });
  const cues = new REG.FxCues({ fx, view: (id) => map.get(id) || null });
  return { fx, registry, cues, map };
}

describe('resolution order', () => {
  test('charId:skillId → charId → sub → profession → kind → default; the kind before * in each layer; next() goes down', () => {
    const reg = new REG.FxRegistry();
    const seen = [];
    const rec = (name, pass = true) => (fx, cue, next) => { seen.push(name); if (pass) next(); };
    reg.register('atk', {}, rec('default'));
    reg.register('atk', { kind: 'arrow' }, rec('kind'));
    reg.register('atk', { prof: 'SNIPER' }, rec('prof*'));
    reg.register('atk', { prof: 'SNIPER', kind: 'arrow' }, rec('prof'));
    reg.register('atk', { sub: 'bombarder' }, rec('sub'));
    reg.register('atk', { char: 'c1' }, rec('char*'));
    reg.register('atk', { char: 'c1', kind: 'arrow' }, rec('char'));
    reg.register('atk', { char: 'c1', skill: 's3' }, rec('charSkill'));
    reg.register('atk', { char: 'c2' }, rec('other char'));
    const fx = { identify: () => ({ char: 'c1', sub: 'bombarder', prof: 'SNIPER', skill: 's3' }) };
    reg.play(fx, 'atk', { kind: 'arrow', unit: {}, useSkill: true });
    assert.deepEqual(seen, ['charSkill', 'char', 'char*', 'sub', 'prof', 'prof*', 'kind', 'default']);
    // a normal attack (not a skill's): no charId:skillId layer; another kind: only the '*' entries
    seen.length = 0;
    reg.play(fx, 'atk', { kind: 'bolt', unit: {}, useSkill: false });
    assert.deepEqual(seen, ['char*', 'sub', 'prof*', 'default']);
    // no identity: kind layer + default only
    seen.length = 0;
    reg.play({ identify: () => null }, 'atk', { kind: 'arrow', unit: {} });
    assert.deepEqual(seen, ['kind', 'default']);
  });

  test('a recipe that does not call next() replaces the layers below; register() undo restores the previous entry', () => {
    const reg = new REG.FxRegistry();
    const seen = [];
    reg.register('fx', {}, () => seen.push('default'));
    const undo1 = reg.register('fx', { kind: 'aoe' }, () => seen.push('first'));
    const undo2 = reg.register('fx', { kind: 'aoe' }, () => seen.push('second'));
    reg.play({}, 'fx', { kind: 'aoe' });
    undo2();
    reg.play({}, 'fx', { kind: 'aoe' });
    undo1(); undo1();
    reg.play({}, 'fx', { kind: 'aoe' });
    assert.deepEqual(seen, ['second', 'first', 'default']);
    assert.equal(reg.scoped('fx'), false);
    const u = reg.register('fx', { sub: 'x' }, () => {});
    assert.equal(reg.scoped('fx'), true, 'identity is looked up only for channels with scoped entries');
    u();
    assert.equal(reg.scoped('fx'), false);
  });

  test('bad registrations throw', () => {
    const reg = new REG.FxRegistry();
    const f = () => {};
    assert.throws(() => reg.register('nope', {}, f), /unknown channel/);
    assert.throws(() => reg.register('atk', {}, null), /function/);
    assert.throws(() => reg.register('atk', { skill: 's' }, f), /needs its char/);
    assert.throws(() => reg.register('atk', { char: 'a', sub: 'b' }, f), /one of/);
    assert.throws(() => reg.register('atk', { charId: 'a' }, f), /unknown match key/);
    assert.throws(() => reg.register('atk', { kind: '' }, f), /non-empty/);
  });

  test('the built-ins are registry entries over the default layer', () => {
    const reg = REG.createFxRegistry();
    const names = (chain) => chain.map((r) => r.name);
    assert.deepEqual(names(reg.resolve('fx', 'lock')), ['lemuenLock', 'fx']);
    assert.deepEqual(names(reg.resolve('fx', 'bombardShell')), ['lemuenShell', 'fx']);
    assert.deepEqual(names(reg.resolve('fx', 'bombard')), ['lemuenBombard', 'fx']);
    assert.deepEqual(names(reg.resolve('fx', 'crit')), ['lemuenAimedShot', 'fx']);
    assert.deepEqual(names(reg.resolve('fx', 'yanyouFlame')), ['yanyouFlame', 'fx']);
    assert.deepEqual(names(reg.resolve('fx', 'aoe')), ['fx']);
    assert.deepEqual(names(reg.resolve('atk', 'boomerang')), ['boomerang', 'atk']);
    assert.deepEqual(names(reg.resolve('atk', 'chainHeal')), ['chainArc', 'atk']);
    assert.deepEqual(names(reg.resolve('atk', 'arrow')), ['atk']);
    for (const sub of RCP.SPLASH_SUBS) assert.deepEqual(names(reg.resolve('dmg', 'phys', { sub })), ['splashRing', 'dmg'], sub);
    assert.deepEqual(names(reg.resolve('dmg', 'phys', { sub: 'instructor' })), ['dmg']);
    for (const ch of REG.FX_CHANNELS) assert.equal(reg.resolve(ch, 'whatever').at(-1), RCP.DEFAULT_RECIPES[ch], `${ch} default`);
    // every archetype FX_KINDS names has a recipe
    for (const [k, s] of Object.entries(RCP.FX_KINDS)) assert.ok(s.a === 'none' || RCP.FX_ARCHETYPES[s.a], `${k}: archetype ${s.a}`);
  });
});

describe('per-operator recipes', () => {
  test('a charId:skillId recipe on the skill channel: the event skillId, else the equipped skill; nothing else changes', () => {
    const lem = unit(1, 3, 10, { defId: 'chess_lemuen_a', side: 'ally', skillIndex: 2 });
    const guard = unit(2, 4, 10, { defId: 'chess_guard_a', side: 'ally', skillIndex: 0 });
    const { fx, registry, cues } = makeFx([lem, guard]);
    const seen = [];
    const flashes = [];
    const real = fx.skillFlash.bind(fx);
    fx.skillFlash = (v) => { flashes.push(v.id); return real(v); };
    registry.register('skill', { char: 'char_4193_lemuen', skill: 'skchr_lemuen_3', kind: 'on' }, (f, cue, next) => { seen.push([cue.view.id, cue.who.skill]); next(); });
    cues.skill(['skill', 1, 1, 'skchr_lemuen_3'], lem);     // new tuple: the event's skillId
    cues.skill(['skill', 1, 1], lem);                       // old tuple: UnitInfo.skillIndex 2 → skchr_lemuen_3
    cues.skill(['skill', 1, 1, 'skchr_lemuen_1'], lem);     // another skill: not this recipe
    cues.skill(['skill', 1, 0, 'skchr_lemuen_3'], lem);     // off: kind 'off'
    cues.skill(['skill', 2, 1, 'skchr_guard_1'], guard);    // another operator
    assert.deepEqual(seen, [[1, 'skchr_lemuen_3'], [1, 'skchr_lemuen_3']]);
    assert.deepEqual(flashes, [1, 1, 1, 2], 'the default burst still runs below it (next) and for everyone else');
  });

  test('a charId recipe on the attack channel replaces the default projectile of that operator only', () => {
    const lem = unit(1, 3, 10, { defId: 'chess_lemuen_a', side: 'ally', skillIndex: 2 });
    const guard = unit(2, 4, 10, { defId: 'chess_guard_a', side: 'ally' });
    const foe = unit(20, 7, 10, { side: 'enemy', defId: 'enemy_x' });
    const { fx, registry, cues } = makeFx([lem, guard, foe]);
    const mine = [];
    registry.register('atk', { char: 'char_4193_lemuen', skill: 'skchr_lemuen_3' }, (f, cue) => mine.push(['s3', cue.attackId, cue.isSkill]));
    registry.register('atk', { char: 'char_4193_lemuen' }, (f, cue) => mine.push(['normal', cue.attackId, cue.isSkill]));
    cues.atk(['atk', 1, 20, 'arrow', 7, 0], lem, foe, 0);
    cues.atk(['atk', 1, 20, 'arrow', 8, 1], lem, foe, 0);
    cues.atk(['atk', 1, 20, 'arrow'], lem, foe, 0);          // an old tuple: no isSkill → the charId layer
    assert.deepEqual(mine, [['normal', 7, false], ['s3', 8, true], ['normal', null, null]]);
    assert.equal(fx.projs.length, 0, 'her shots are her recipes now');
    cues.atk(['atk', 2, 20, 'arrow', 9, 0], guard, foe, 0);
    assert.equal(fx.projs.length, 1, 'anyone else: the default projectile');
  });
});

describe('FxCues', () => {
  test('melee slash pairing as before; the dmg cue carries the attacker, attackId and the attack\'s isSkill', () => {
    const pepe = unit(1, 4, 10, { defId: 'chess_pepe_a', side: 'ally' });
    const foe = unit(20, 5, 10, { side: 'enemy', defId: 'enemy_x' });
    const { fx, registry, cues } = makeFx([pepe, foe]);
    const hits = [], rings = [], cuesSeen = [];
    const realHit = fx.hit.bind(fx);
    fx.hit = (v, amt, type, src, melee) => { hits.push([v.id, src ? src.id : null, melee]); return realHit(v, amt, type, src, melee); };
    fx.splashRing = (v) => rings.push(v.id);
    registry.register('dmg', { char: 'char_4058_pepe' }, (f, cue, next) => { cuesSeen.push([cue.attacker?.id ?? null, cue.attackId, cue.isSkill]); next(); });
    cues.atk(['atk', 1, 20, 'none', 5, 1], pepe, foe, 10);
    cues.dmg(['dmg', 20, 300, 'phys', 1, 5], foe, 10.2);    // within 0.35 render s: the slash (+ 佩佩's splash ring)
    cues.dmg(['dmg', 20, 300, 'phys', 1, 5], foe, 10.25);   // a second hit of the same blow: no slash, no ring
    cues.atk(['atk', 1, 20, 'none', 6, 0], pepe, foe, 11);
    cues.dmg(['dmg', 20, 300, 'phys'], foe, 11.5);          // too late (and an old tuple): no slash
    assert.deepEqual(hits, [[20, 1, true], [20, null, false], [20, null, false]]);
    assert.deepEqual(rings, [20], 'splash ring only on the paired blow');
    // the attacker id resolves the charId layer even without a paired blow; the old tuple has no attacker
    assert.deepEqual(cuesSeen, [[1, 5, true], [1, 5, true]]);
  });

  test('older tuples (recordings) and junk play without errors', () => {
    const a = unit(1, 4, 10, { side: 'ally' }), b = unit(20, 7, 10, { side: 'enemy' });
    const { fx, cues } = makeFx([a, b]);
    cues.atk(['atk', 1, 20, 'arrow'], a, b, 0);
    cues.atk(['atk', 1, 20], a, b, 0);
    cues.atk(['atk', 5, 999, 'arrow'], null, null, 0);
    cues.dmg(['dmg', 20, 'x', 'phys'], b, 0);
    cues.dmg(['dmg', 20, 50, 'phys', 'junk', 'junk'], b, 0);
    cues.dmg(['dmg', 999, 50, 'phys'], null, 0);
    cues.heal(['heal', 1, 40], a);
    cues.heal(['heal'], null);
    cues.skill(['skill', 1, 1], a);
    cues.skill(['skill', 1, 0, 42], a);
    cues.fx(['fx', 'burst', 'a', null, null]);
    cues.fx(['fx', 'aoe', 7, 10, { id: 20 }]);
    cues.die(a); cues.deploy(b); cues.die(null);
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    assert.ok(fx.counts.particles >= 0);
  });
});

test('unitFxIdentity: chess (charId, sub, profession, the equipped skill), token, enemy, no data', () => {
  assert.deepEqual(REG.unitFxIdentity({ id: 1, side: 'ally', defId: 'chess_lemuen_a', spine: 'char_4193_lemuen', skillIndex: 1 }, DATA),
    { char: 'char_4193_lemuen', sub: 'bombarder', prof: 'SNIPER', skill: 'skchr_lemuen_2' });
  assert.equal(REG.unitFxIdentity({ id: 1, side: 'ally', defId: 'chess_lemuen_a' }, DATA).skill, 'skchr_lemuen_1', 'no skillIndex: its default skill');
  assert.deepEqual(REG.unitFxIdentity({ id: 2, side: 'ally', kind: 'token', defId: 'token_dragon', spine: 'token_dragon' }, DATA),
    { char: 'token_dragon', sub: 'notchar1', prof: 'TOKEN', skill: 'sktok_dragon' });
  assert.deepEqual(REG.unitFxIdentity({ id: 3, side: 'enemy', defId: 'chess_lemuen_a', spine: 'enemy_spine' }, DATA),
    { char: 'enemy_spine', sub: null, prof: null, skill: null }, 'an enemy never reads the chess table');
  assert.deepEqual(REG.unitFxIdentity({ id: 4, defId: 'x' }, null), { char: 'x', sub: null, prof: null, skill: null });
  assert.equal(REG.unitFxIdentity(null, DATA), null);
});

test('the sim appends the skill id to the skill events, attackId / isSkill to the attacks, source / attackId to the hits', () => {
  const RANGE3 = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [-1, 0], [-1, 1], [-1, 2], [-1, 3]];
  const h = makeBattle({
    defs: {
      chess: { t_sn: chessRec({ id: 't_sn', profession: 'SNIPER', subProfessionId: 'closerange', rangeGrid: RANGE3, stats: { atk: 100, bat: 1 }, skill: { skillId: 'sk_fx_test', spCost: 1, initSp: 1, duration: 2 } }) },
      enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) },
    },
    units: [{ chessId: 't_sn', row: 10, col: 4 }], content: 'generic', autoFinish: false,
    kits: { t_sn: () => ({ skill: { kind: 'duration', duration: 2, attack: { atkScale: 2 } } }) },   // its attacks: skill attacks
  });
  const u = h.unit('t_sn');
  h.spawn('enemy_dummy', { pos: [10, 6] });
  assert.ok(h.runUntil(() => u.skill.activations >= 1 && !u.skill.active, 6), 'the skill went on and off');
  h.run(1);
  const sk = h.events.filter((e) => e[0] === 'skill');
  assert.deepEqual(sk.slice(0, 2).map((e) => [e[1], e[2], e[3]]), [[u.id, 1, 'sk_fx_test'], [u.id, 0, 'sk_fx_test']]);
  const atk = h.events.filter((e) => e[0] === 'atk' && e[1] === u.id);
  assert.ok(atk.some((e) => e[5] === 1) && atk.some((e) => e[5] === 0), 'skill attacks during it, normal ones after');
  for (const e of atk) {
    const hits = h.events.filter((d) => d[0] === 'dmg' && d[5] === e[4]);
    assert.ok(hits.length && hits.every((d) => d[4] === u.id && d[1] === e[2]), `attack ${e[4]}: its hits carry it and the shooter`);
  }
});
