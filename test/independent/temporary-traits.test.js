// Temporary combat traits (user 2026-10-07: 「很多都是战斗时临时buff」): buffs, stacks, strikes and shields that last one battle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const base = getCatalog();
// 普罗旺斯 / 德克萨斯 are 叙拉古, 隐现 is 拉特兰, 深靛 has no faction; none has a combat trait of its own (干员表 v3)
const OPS = { provence: 'chess_char_1_07_a', texas: 'chess_char_1_08_a', lateran: 'chess_char_1_01_a', loner2: 'chess_char_1_17_a' };

function setup(pieces, rulesByUid, recs = {}) {
  const operators = { ...base.operators };
  for (const p of pieces) if (rulesByUid[p.uid]) {
    const op = operators[p.chessId];
    operators[p.chessId] = { ...op, nativeTrait: { ...op.nativeTrait, effect: { ...op.nativeTrait.effect, combat: rulesByUid[p.uid] } } };
  }
  const catalog = { ...base, operators };
  const chess = {};
  for (const p of pieces) chess[p.chessId] = chessRec({ id: p.chessId, stats: { atk: 100, maxHp: 1000, def: 0, res: 0, aspd: 100, spRecovery: 0, respawnTime: 20 }, skill: null, ...(recs[p.uid] || {}) });
  const full = pieces.map((p) => ({ dir: 'RIGHT', skillIndex: 0, moduleId: 'none', attachments: [], nativeState: {}, equipment: [], ...p }));
  const h = makeBattle({
    units: full.map(({ uid, chessId, row, col, dir }) => ({ uid, chessId, row, col, dir })),
    defs: { chess, enemies: { enemy_test: enemyRec({ key: 'enemy_test', hp: 10000, def: 0, res: 0 }), enemy_elite: enemyRec({ key: 'enemy_elite', rank: 'ELITE', hp: 10000, def: 0, res: 0 }) } },
    autoFinish: false, content: 'independent',
    flags: { independent: { catalog, pieces: full } },
    extraContent: [(battle) => installIndependentBattle(battle, { catalog, state: { pieces: full } })],
  });
  h.step(1);
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors)); // a rule the engine cannot install is an error
  return h;
}
const rule = (behavior, params, trigger = 'battle') => ({ trigger, behavior, params });

test('开场加成: the row gets the buff for its seconds, the next row does not', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'same', chessId: OPS.texas, row: 10, col: 5 },
    { uid: 'other', chessId: OPS.lateran, row: 11, col: 3 },
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
    { uid: 'other', chessId: OPS.lateran, row: 11, col: 3 },
  ], { w: [rule('battleStartBuff', { targets: 'faction:same', stats: { aspd: 20 } })] });
  assert.equal(h.unit('same').s.aspd, 120);
  assert.equal(h.unit('other').s.aspd, 100);
});

test('队友倒下叠层: a stack for every fallen ally, up to the cap, for the rest of the battle', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'a', chessId: OPS.texas, row: 10, col: 5 },
    { uid: 'b', chessId: OPS.lateran, row: 11, col: 3 },
    { uid: 'c', chessId: OPS.loner2, row: 12, col: 3 },
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
    { uid: 'b', chessId: OPS.lateran, row: 11, col: 3 },
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

test('溢出伤害: a kill passes its excess on to the nearest enemy within the radius', () => {
  const h = setup([{ uid: 'w', chessId: OPS.provence, row: 10, col: 3 }], { w: [rule('overkillSpill', { radius: 1.5 })] });
  const weak = h.spawn('enemy_test', { pos: [10, 4], mods: { speedMul: 0, hpMul: 0.003 } }); // 30 hp
  const next = h.spawn('enemy_test', { pos: [10, 5], mods: { speedMul: 0 } });
  const far = h.spawn('enemy_test', { pos: [10, 9], mods: { speedMul: 0 } });
  h.b.forceAttack(h.unit('w'), [weak]);
  assert.equal(weak.alive, false);
  assert.ok(Math.abs(next.s.maxHp - next.hp - 70) < 1e-6, `${next.s.maxHp - next.hp}`);
  assert.equal(far.hp, far.s.maxHp);
});

test('targets lists, bench scaling, weakness damage and stacks for others', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'a', chessId: OPS.texas, row: 10, col: 4 },
    { uid: 'b', chessId: OPS.lateran, row: 9, col: 3 },
    { uid: 'bench1', chessId: OPS.loner2, row: null, col: null },
  ], { w: [
    rule('battleStartBuff', { targets: ['self', 'front'], stats: { atkPct: 0.05 }, perBench: true, maxBench: 3 }),
    rule('allyDownStacks', { every: 1, stats: { aspd: 10 }, maxStacks: 2, targets: 'faction:叙拉古' }),
  ] });
  assert.equal(Math.round(h.unit('w').s.atk), 105, 'one operator on the bench');
  assert.equal(Math.round(h.unit('a').s.atk), 105);
  assert.equal(Math.round(h.unit('b').s.atk), 100);
  h.b.kill(h.unit('b')); h.step(1);
  assert.equal(h.unit('a').s.aspd, 110, 'the 叙拉古 ally gets the stack');
  assert.equal(h.unit('w').s.aspd, 110);
});

// ---- 干员特质 v4 (2026-10-07, 方舟化): the seven new behaviors and the new parameters of the old ones ----
const hpLost = (u) => u.s.maxHp - u.hp;
const near = (a, b) => Math.abs(a - b) < 1e-6;
const STATS = { atk: 100, maxHp: 1000, def: 0, res: 0, aspd: 100, spRecovery: 0, respawnTime: 20 };
const WITH_SKILL = { skill: { spCost: 30, initSp: 0 } };

test('在场光环: 周围四格 allies carry it while it stands; it lapses when it falls; `only` narrows the targets', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'a', chessId: OPS.texas, row: 10, col: 4 },
    { uid: 'far', chessId: OPS.lateran, row: 12, col: 3 },
    { uid: 'b', chessId: OPS.loner2, row: 9, col: 3 },
  ], { w: [rule('aura', { targets: 'adjacent', only: { faction: '叙拉古' }, stats: { atkPct: 0.08 } }, 'deploy')] });
  h.run(0.5); // it pulses on the battle's ticks
  assert.equal(Math.round(h.unit('a').s.atk), 108, 'a 叙拉古 neighbour');
  assert.equal(h.unit('b').s.atk, 100, 'a neighbour without the faction');
  assert.equal(h.unit('far').s.atk, 100);
  assert.equal(h.unit('w').s.atk, 100, 'not itself');
  h.b.kill(h.unit('w')); h.run(1);
  assert.equal(h.unit('a').s.atk, 100, 'gone once it fell');
});

test('攻击范围内的敌人状态: lasting 脆弱 on the enemies in its range (精英和领袖 only), its own effect beside the status', () => {
  const h = setup([{ uid: 'w', chessId: OPS.provence, row: 10, col: 3 }, { uid: 'x', chessId: OPS.texas, row: 12, col: 3 }],
    { w: [rule('rangeDebuff', { status: 'fragile', value: 0.1, only: { eliteOrLeader: true } }, 'deploy')] });
  const elite = h.spawn('enemy_elite', { pos: [10, 4], mods: { speedMul: 0 } });
  const plain = h.spawn('enemy_test', { pos: [10, 4], mods: { speedMul: 0 } });
  const away = h.spawn('enemy_elite', { pos: [10, 8], mods: { speedMul: 0 } });
  const x = h.unit('x');
  for (const e of [elite, plain, away]) h.b.dealDamage(x, e, { amount: 100, type: 'true' });
  assert.ok(near(hpLost(elite), 110), `${hpLost(elite)}`);
  assert.equal(hpLost(plain), 100);
  assert.equal(hpLost(away), 100, 'out of its range');
  // a talent's 脆弱 (the status: 同名效果取最高 among talents and skills) neither overrides nor absorbs it
  h.b.applyStatus(elite, 'fragile', { duration: 5, value: 0.3, source: x });
  h.b.dealDamage(x, elite, { amount: 100, type: 'true' });
  assert.ok(near(hpLost(elite), 110 + 143), `${hpLost(elite)}`);
});

test('攻击范围内的敌人状态: 在场N秒后, and 技能开启时 寒冷 once', () => {
  const h = setup([{ uid: 'w', chessId: OPS.provence, row: 10, col: 3 }, { uid: 'x', chessId: OPS.texas, row: 12, col: 3 }], { w: [
    rule('rangeDebuff', { delay: 3, status: 'artsFragile', value: 0.2 }, 'deploy'),
    rule('rangeDebuff', { on: 'skillStart', status: 'cold', duration: 2 }, 'skillStart'),
  ] }, { w: { stats: { ...STATS, atk: 0 } } }); // its own attacks on the enemy in its range do nothing here
  const e = h.spawn('enemy_test', { pos: [10, 4], mods: { speedMul: 0 } });
  const x = h.unit('x');
  h.b.dealDamage(x, e, { amount: 100, type: 'arts' });
  assert.equal(hpLost(e), 100, 'not yet');
  h.run(3);
  h.b.dealDamage(x, e, { amount: 100, type: 'arts' });
  assert.ok(near(hpLost(e), 220), `${hpLost(e)}`);
  h.b.dealDamage(x, e, { amount: 100, type: 'phys' });
  assert.ok(near(hpLost(e), 320), '法术脆弱 is for arts damage only');
  h.b.emit('skillStart', { unit: h.unit('w') });
  assert.ok(e.findBuff('cold'), '寒冷 at the skill start');
});

test('命中上状态: its hits leave 受到的物理伤害提升 for its seconds; afterOwnStun: only an enemy it stunned', () => {
  const h = setup([{ uid: 'w', chessId: OPS.provence, row: 10, col: 3 }, { uid: 'k', chessId: OPS.texas, row: 12, col: 3 }, { uid: 'x', chessId: OPS.lateran, row: 13, col: 3 }], {
    w: [rule('statusOnHit', { status: 'physFragile', value: 0.2, duration: 3 }, 'hit')],
    k: [rule('statusOnHit', { afterOwnStun: true, status: 'physFragile', value: 0.3, duration: 3 }, 'statusApplied')],
  });
  const e = h.spawn('enemy_test', { pos: [8, 9], mods: { speedMul: 0 } }); // out of everyone's range
  const o = h.spawn('enemy_test', { pos: [9, 9], mods: { speedMul: 0 } });
  const x = h.unit('x');
  h.b.dealDamage(h.unit('w'), e, { amount: 100, type: 'phys' });
  h.b.dealDamage(x, e, { amount: 100, type: 'phys' });
  assert.ok(near(hpLost(e), 220), `${hpLost(e)}`);
  h.run(3.5);
  h.b.dealDamage(x, e, { amount: 100, type: 'phys' });
  assert.ok(near(hpLost(e), 320), 'gone after its seconds');
  h.b.dealDamage(x, o, { amount: 100, type: 'phys' });
  assert.equal(hpLost(o), 100, 'k never stunned it');
  h.b.applyStatus(o, 'stun', { duration: 0.2, source: h.unit('k') });
  h.b.dealDamage(x, o, { amount: 100, type: 'phys' });
  assert.ok(near(hpLost(o), 230), `${hpLost(o)}`);
});

test('被治疗者加成: an ally it heals carries the buff for its seconds; itself does not', () => {
  const h = setup([{ uid: 'm', chessId: OPS.provence, row: 10, col: 3 }, { uid: 'a', chessId: OPS.texas, row: 10, col: 5 }],
    { m: [rule('healedBuff', { stats: { aspd: 10 }, duration: 5 }, 'heal')] });
  const a = h.unit('a'); const m = h.unit('m');
  a.hp = 500; m.hp = 500;
  h.b.heal(m, a, 100); h.b.heal(m, m, 100);
  assert.equal(a.s.aspd, 110);
  assert.equal(m.s.aspd, 100);
  h.run(5.5);
  assert.equal(a.s.aspd, 100);
});

test('击倒回技力: its 周围四格 allies, or a killer of the named faction, gain skill points', () => {
  const h = setup([
    { uid: 'p', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'a', chessId: OPS.texas, row: 10, col: 4 },
    { uid: 'l', chessId: OPS.lateran, row: 12, col: 3 },
    { uid: 't', chessId: OPS.loner2, row: 13, col: 3 },
  ], {
    p: [rule('onKillSp', { actor: 'self', targets: 'adjacent', sp: 2 }, 'kill')],
    l: [rule('onKillSp', { actor: 'faction:叙拉古', targets: 'killer', sp: 1 }, 'kill')],
  }, { p: WITH_SKILL, a: WITH_SKILL, l: WITH_SKILL, t: WITH_SKILL });
  const sp = (uid) => h.unit(uid).skill.sp;
  const before = Object.fromEntries(['p', 'a', 'l', 't'].map((u) => [u, sp(u)]));
  h.b.kill(h.spawn('enemy_test', { pos: [9, 9], mods: { speedMul: 0 } }), h.unit('p'));
  assert.equal(sp('a') - before.a, 2, '周围四格 of the killer');
  h.b.kill(h.spawn('enemy_test', { pos: [9, 9], mods: { speedMul: 0 } }), h.unit('a'));
  assert.equal(sp('a') - before.a, 3, 'a 叙拉古 killer (l\'s rule)');
  h.b.kill(h.spawn('enemy_test', { pos: [9, 9], mods: { speedMul: 0 } }), h.unit('t'));
  assert.equal(sp('t') - before.t, 0, 'no faction, no skill points');
});

test('healedBuff effectiveOnly/nativeOnly reject overheal and equipment healing, preserve native targets and duration, and keep old descriptors compatible',()=>{
  const make=flags=>setup([{uid:'m',chessId:OPS.provence,row:10,col:3},{uid:'a',chessId:OPS.texas,row:10,col:5}],{m:[rule('healedBuff',{stats:{aspd:10},duration:5,...flags},'heal')]});
  const h=make({effectiveOnly:true,nativeOnly:true}),medic=h.unit('m'),ally=h.unit('a');
  assert.equal(h.b.heal(medic,ally,100),0);assert.equal(ally.s.aspd,100,'overheal cannot create the temporary buff');
  ally.hp=500;h.b.heal(medic,ally,100,{tags:['independentEquipment']});assert.equal(ally.s.aspd,100);
  h.b.heal(medic,ally,100,{independentOrigin:'equipment'});assert.equal(ally.s.aspd,100);
  medic.mem.independentOrigin='equipment';h.b.heal(medic,ally,100);assert.equal(ally.s.aspd,100);delete medic.mem.independentOrigin;
  const before=ally.hp;assert.equal(h.b.heal(medic,ally,50),50);assert.equal(ally.hp,before+50);assert.equal(ally.s.aspd,110);
  medic.hp=500;h.b.heal(medic,medic,100);assert.equal(medic.s.aspd,100,'self target remains excluded');
  h.run(5.1);assert.equal(ally.s.aspd,100,'declared duration is unchanged');
  const legacy=make({});legacy.b.heal(legacy.unit('m'),legacy.unit('a'),100,{tags:['independentEquipment']});assert.equal(legacy.unit('a').s.aspd,110,'flagless legacy descriptor keeps its prior trigger');
});

test('灼痕蔓延: a marked enemy knocked down passes the mark and its 法术脆弱 to the enemies within the radius', () => {
  const h = setup([{ uid: 'r', chessId: OPS.provence, row: 12, col: 0 }], { r: [rule('markSpread', { mark: 'reed2:scorch', radius: 1 }, 'death')] });
  const marked = h.spawn('enemy_test', { pos: [10, 4], mods: { speedMul: 0 } });
  const next = h.spawn('enemy_test', { pos: [10, 5], mods: { speedMul: 0 } });
  const far = h.spawn('enemy_test', { pos: [10, 8], mods: { speedMul: 0 } });
  const r = h.unit('r');
  h.b.addBuff(marked, { key: 'reed2:scorch', duration: 6, refresh: 'extend', mods: { atkPct: -0.2 }, source: r });
  h.b.applyStatus(marked, 'artsFragile', { duration: 6, value: 0.3, source: r });
  h.b.kill(marked, r);
  assert.ok(next.findBuff('reed2:scorch'), 'the neighbour is marked');
  assert.ok(next.findBuff('artsFragile'), 'with its 法术脆弱');
  assert.equal(far.findBuff('reed2:scorch'), null);
});

test('阻挡时反击: hit while blocking, it deals its DEF × the ratio to the attacker', () => {
  const h = setup([{ uid: 'w', chessId: OPS.provence, row: 10, col: 3 }], { w: [rule('blockRetaliate', { condition: 'blocking', defPct: 0.2, type: 'phys' }, 'hit')] },
    { w: { stats: { ...STATS, def: 200 } } });
  const e = h.spawn('enemy_test', { pos: [10, 4], mods: { speedMul: 0 } });
  const w = h.unit('w');
  h.b.dealDamage(e, w, { amount: 50, type: 'phys' });
  assert.equal(hpLost(e), 0, 'not blocking');
  w.blocking = [e];
  h.b.dealDamage(e, w, { amount: 50, type: 'phys' });
  assert.ok(near(hpLost(e), 40), `${hpLost(e)}`);
});

test('new parameters: 首次部署 / 再部署 / 部署后N秒, 技能持续期间, 部署时护盾, 替身切换时', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'a', chessId: OPS.texas, row: 10, col: 4 },
  ], { w: [
    rule('deployBuff', { redeployOnly: true, targets: 'self', stats: { atkPct: 0.2 }, duration: 15 }, 'deploy'),
    rule('deployBuff', { firstDeployOnly: true, delay: 2, targets: 'all', stats: { aspd: 10 }, duration: 'battle' }, 'deploy'),
    rule('skillStartBuff', { targets: 'adjacent', stats: { atkPct: 0.3 }, duration: 'skill' }, 'skillStart'),
    rule('shieldAllies', { on: 'deploy', targets: 'adjacent', count: 99, layers: 1, excludeSelf: true }, 'deploy'),
    rule('onDown', { on: 'dollSwap', blast: { atkPct: 2, radius: 1.5, type: 'phys' }, perBattle: 2 }, 'dollSwap'),
  ] });
  const w = h.unit('w'); const a = h.unit('a');
  assert.equal(w.s.atk, 100, 'the first deployment is not a redeployment');
  assert.equal(a.s.aspd, 100, 'not before its seconds');
  assert.equal(Number(a.findBuff('independent:equipmentShield:a')?.shieldHits ?? 0), 1, 'a layer on deployment');
  h.run(2);
  assert.equal(a.s.aspd, 110);
  h.b.emit('deploy', { unit: w, initial: false });
  assert.equal(Math.round(w.s.atk), 120, 'redeployed');
  assert.equal(Number(a.findBuff('independent:equipmentShield:a')?.shieldHits ?? 0), 2, 'one more on the redeployment');
  h.b.emit('skillStart', { unit: w });
  assert.equal(Math.round(a.s.atk), 130);
  h.b.emit('skillEnd', { unit: w });
  assert.equal(a.s.atk, 100, 'the skill ended');
  const e = h.spawn('enemy_test', { pos: [10, 4], mods: { speedMul: 0 } });
  for (let i = 0; i < 3; i++) h.b.emit('dollSwap', { unit: w });
  assert.ok(near(hpLost(e), 2 * 2 * 120), `${hpLost(e)}: twice a battle`);
});

test('battle counters: 受到攻击, 闪避, 未被击倒到战斗结束, and a skill start arming the row\'s next trait badge', () => {
  const ev = (trigger, id, extra = {}) => rule('eventProduction', { counterEvent: trigger, counterEvery: 1, outputs: [{ id, quantity: 1 }], ...extra }, trigger);
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3 },
    { uid: 'a', chessId: OPS.texas, row: 10, col: 5 },
  ], {
    w: [ev('damaged', 'defense', { counterEvery: 2, filter: { actor: 'target', targetSide: 'ally', sourceSide: 'enemy' } }), ev('dodge', 'agility', { filter: { actor: 'target' } }), ev('battleEnd', 'assault', { filter: { selfSurvived: true } })],
    a: [rule('eventProduction', { counterEvent: 'nativeProduction', counterEvery: 1, outputs: [], copyOutputFromEvent: true, quantity: 1, armedBy: 'skillStart', maxPerBattle: 3, filter: { actor: 'sameRowAllies', nativeTraitProduction: true, baseBadgeOnly: true, excludeCopy: true } }, 'nativeProduction')],
  });
  const e = h.spawn('enemy_test', { pos: [10, 4], mods: { speedMul: 0 } });
  const w = h.unit('w');
  const got = (uid, id) => (h.b.independentRewards || []).filter((r) => r.sourceUid === uid && r.id === id).reduce((n, r) => n + r.quantity, 0);
  h.b.dealDamage(e, w, { amount: 10, type: 'phys' });
  h.b.dealDamage(e, w, { amount: 10, type: 'phys' });
  assert.equal(got('w', 'defense'), 1, 'one per 2 hits taken');
  assert.equal(got('a', 'defense'), 0, 'not armed yet');
  h.b.emit('skillStart', { unit: h.unit('a') });
  h.b.emit('dodge', { source: e, target: w, dmg: {} });
  assert.equal(got('w', 'agility'), 1);
  assert.equal(got('a', 'agility'), 1, 'the armed copy of the row\'s next trait badge');
  h.b.dealDamage(e, w, { amount: 10, type: 'phys' }); h.b.dealDamage(e, w, { amount: 10, type: 'phys' });
  assert.equal(got('a', 'defense'), 0, 'one skill start arms one');
  h.b.emit('battleEnd', { result: {} });
  assert.equal(got('w', 'assault'), 1, 'standing at the end');
});
