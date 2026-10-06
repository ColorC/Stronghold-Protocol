// Temporary combat traits (user 2026-10-07: 「很多都是战斗时临时buff」): buffs, stacks, strikes and shields that last one battle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const base = getCatalog();
// 普罗旺斯 / 德克萨斯 are 叙拉古, 刺玫 is 维多利亚, 格雷伊 has no faction; none has a combat trait of its own
const OPS = { provence: 'chess_char_1_07_a', texas: 'chess_char_1_08_a', myrtle: 'chess_char_1_06_a', greyy: 'chess_char_1_14_a' };

function setup(pieces, rulesByUid) {
  const operators = { ...base.operators };
  for (const p of pieces) if (rulesByUid[p.uid]) {
    const op = operators[p.chessId];
    operators[p.chessId] = { ...op, nativeTrait: { ...op.nativeTrait, effect: { ...op.nativeTrait.effect, combat: rulesByUid[p.uid] } } };
  }
  const catalog = { ...base, operators };
  const chess = {};
  for (const p of pieces) chess[p.chessId] = chessRec({ id: p.chessId, stats: { atk: 100, maxHp: 1000, def: 0, res: 0, aspd: 100, spRecovery: 0, respawnTime: 20 }, skill: null });
  const full = pieces.map((p) => ({ dir: 'RIGHT', skillIndex: 0, moduleId: 'none', attachments: [], nativeState: {}, equipment: [], ...p }));
  const h = makeBattle({
    units: full.map(({ uid, chessId, row, col, dir }) => ({ uid, chessId, row, col, dir })),
    defs: { chess, enemies: { enemy_test: enemyRec({ key: 'enemy_test', hp: 10000, def: 0, res: 0 }) } },
    autoFinish: false, content: 'independent',
    flags: { independent: { catalog, pieces: full } },
    extraContent: [(battle) => installIndependentBattle(battle, { catalog, state: { pieces: full } })],
  });
  h.step(1);
  return h;
}
const rule = (behavior, params, trigger = 'battle') => ({ trigger, behavior, params });

test('开场加成: the row gets the buff for its seconds, the next row does not', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'same', chessId: OPS.texas, row: 10, col: 5 },
    { uid: 'other', chessId: OPS.myrtle, row: 11, col: 3 },
  ], { w: [rule('battleStartBuff', { targets: 'row', stats: { atkPct: 0.2 }, duration: 5 })] });
  assert.equal(h.unit('same').s.atk, 120);
  assert.equal(h.unit('w').s.atk, 120);
  assert.equal(h.unit('other').s.atk, 100);
  h.run(5);
  assert.equal(h.unit('same').s.atk, 100);
});

test('同阵营 targets read the tavern factions', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'same', chessId: OPS.texas, row: 12, col: 8 },
    { uid: 'other', chessId: OPS.myrtle, row: 11, col: 3 },
  ], { w: [rule('battleStartBuff', { targets: 'faction:same', stats: { aspd: 20 } })] });
  assert.equal(h.unit('same').s.aspd, 120);
  assert.equal(h.unit('other').s.aspd, 100);
});

test('队友倒下叠层: a stack for every fallen ally, up to the cap, for the rest of the battle', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'a', chessId: OPS.texas, row: 10, col: 5 },
    { uid: 'b', chessId: OPS.myrtle, row: 11, col: 3 },
    { uid: 'c', chessId: OPS.greyy, row: 12, col: 3 },
  ], { w: [rule('allyDownStacks', { every: 1, stats: { atkPct: 0.1 }, maxStacks: 2 })] });
  h.b.kill(h.unit('a')); h.step(1);
  assert.equal(Math.round(h.unit('w').s.atk), 110);
  h.b.kill(h.unit('b')); h.b.kill(h.unit('c')); h.step(1);
  assert.equal(Math.round(h.unit('w').s.atk), 120);
});

test('被击倒时: a blast around it, once', () => {
  const h = setup([{ uid: 'w', chessId: OPS.provence, row: 10, col: 3 }],
    { w: [rule('onDown', { blast: { atkPct: 2, radius: 1.5, type: 'arts' } })] });
  const near = h.spawn('enemy_test', { pos: [10, 4], mods: { speedMul: 0 } });
  const far = h.spawn('enemy_test', { pos: [10, 9], mods: { speedMul: 0 } });
  h.b.kill(h.unit('w'));
  assert.equal(near.s.maxHp - near.hp, 200);
  assert.equal(far.hp, far.s.maxHp);
});

test('分发护盾: the given count of allies get a layer at battle start, two at most', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'a', chessId: OPS.texas, row: 10, col: 5 },
    { uid: 'b', chessId: OPS.myrtle, row: 11, col: 3 },
  ], { w: [rule('shieldAllies', { targets: 'all', count: 2, layers: 3 })] });
  const layers = ['w', 'a', 'b'].map((uid) => Number(h.unit(uid).findBuff(`independent:equipmentShield:${uid}`)?.shieldHits ?? 0));
  assert.deepEqual(layers.sort(), [0, 2, 2]);
});

test('每第N次攻击: an extra hit on the main target every Nth attack', () => {
  const h = setup([{ uid: 'w', chessId: OPS.provence, row: 10, col: 3 }],
    { w: [rule('everyNthAttack', { n: 2, effect: 'extraHit', atkPct: 1.5 })] });
  const e = h.spawn('enemy_test', { pos: [10, 4], mods: { speedMul: 0 } });
  const w = h.unit('w');
  h.b.forceAttack(w, [e]);
  assert.equal(e.s.maxHp - e.hp, 100);
  h.b.forceAttack(w, [e]);
  assert.equal(e.s.maxHp - e.hp, 100 + 100 + 150);
});

test('首波打击: once, at its second, on every enemy on the field', () => {
  const h = setup([{ uid: 'w', chessId: OPS.provence, row: 12, col: 0 }],
    { w: [rule('firstWaveStrike', { atSecond: 2, atkPct: 1.2, type: 'arts' })] });
  const a = h.spawn('enemy_test', { pos: [9, 9], mods: { speedMul: 0 } });
  const b = h.spawn('enemy_test', { pos: [9, 10], mods: { speedMul: 0 } });
  h.run(1.5);
  assert.equal(a.hp, a.s.maxHp);
  h.run(3);
  assert.equal(a.s.maxHp - a.hp, 120);
  assert.equal(b.s.maxHp - b.hp, 120);
});

test('技能开启时: the targets get the buff and skill points', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'a', chessId: OPS.texas, row: 10, col: 4 },
  ], { w: [rule('skillStartBuff', { targets: 'front', stats: { atkPct: 0.3 }, duration: 8 })] });
  h.b.emit('skillStart', { unit: h.unit('w') });
  h.step(1);
  assert.equal(h.unit('a').s.atk, 130);
  assert.equal(h.unit('w').s.atk, 100);
});
