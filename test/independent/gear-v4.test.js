// 特殊战斗装备 第四版 (2026-10-07; user: 「做就做呗」「装备不再有精锐形态」「原版的脆弱什么的都不管」): every new engine
// behavior and parameter, on the real catalog pieces. Each fixture first checks the battle installed without an error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const catalog = getCatalog();
const G = (name) => {
  const hit = Object.values(catalog.equipment).find((x) => (x.newName || x.name) === name && x.available !== false && !x.oldName?.includes('停用'));
  assert.ok(hit, `catalog has ${name}`);
  return hit.id;
};
// 隐现 is 拉特兰, 普罗旺斯 叙拉古, 跃跃 / 深靛 have no faction; none has a combat trait (干员表 v3)
const OPS = { lateran: 'chess_char_1_01_a', syracusa: 'chess_char_1_07_a', a: 'chess_char_1_09_a', b: 'chess_char_1_17_a' };
const FACTION_OPS = { victoria:'chess_char_1_06_a', aegir:'chess_char_2_07_a', sargon:'chess_char_2_08_a', kazimierz:'chess_char_1_19_a', yan:'chess_char_1_03_a', yan2:'chess_char_2_04_a' };
const RANGE = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 1], [-1, 1], [1, 2], [-1, 2]];
const tag = (faction) => ({ id: 'chess_item_1_04_e_a', state: { faction } }); // 调和识别牌: an extra faction

function setup(pieces, { skill = null, enemyBlockCnt = 1, dmgType = null } = {}) {
  const chess = {};
  for (const p of pieces) chess[p.chessId] = chessRec({ id: p.chessId, rangeGrid: RANGE, dmgType, stats: { atk: 100, maxHp: 1000, def: 0, res: 0, aspd: 100, spRecovery: 0, respawnTime: 20, blockCnt: 1 }, skill });
  const full = pieces.map((p) => ({ dir: 'RIGHT', skillIndex: 0, moduleId: 'none', attachments: [], nativeState: {}, ...p, equipment: (p.equipment || []).map((x) => (typeof x === 'string' ? { id: x } : x)) }));
  const h = makeBattle({
    units: full.map(({ uid, chessId, row, col, dir }) => ({ uid, chessId, row, col, dir })),
    defs: { chess, enemies: {
      dummy: enemyRec({ key: 'dummy', hp: 10000, def: 0, res: 0, speed: 0, blockCnt: enemyBlockCnt }),
      walker: enemyRec({ key: 'walker', hp: 10000, def: 0, res: 0, speed: 1 }),
      heavy: enemyRec({ key: 'heavy', hp: 10000, def: 0, res: 0, speed: 0, mass: 1 }),
      hitter: enemyRec({ key: 'hitter', hp: 10000, def: 0, res: 0, speed: 0, atk: 200 }),
    } },
    autoFinish: false, content: 'independent',
    flags: { independent: { catalog, pieces: full } },
    extraContent: [(battle) => installIndependentBattle(battle, { catalog, state: { pieces: full } })],
  });
  h.step(1);
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  // no attacks of their own: every hit in a fixture is one the test makes (forceAttack ignores the cooldown)
  for (const u of h.b.allyUnits) if (u.kind === 'op') u.atkCd = 1e9;
  h.gear = [];
  h.b.on('damaged', ({ source, target, amount, dmg }) => { if (source?.side === 'ally' && dmg?.tags?.includes('independentEquipment')) h.gear.push({ target, amount, type: dmg.type }); }, { priority: -2000 });
  return h;
}
const lost = (e) => e.s.maxHp - e.hp;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const attacks = (h, u, target, n = 1) => { for (let i = 0; i < n; i++) h.b.forceAttack(u, [target]); };
const SKILL = { skillType: 'MANUAL', durationType: 'NONE', duration: 3, spCost: 10, initSp: 0, spType: 'INCREASE_WITH_TIME' };
const cast = (u) => { u.skill.gainSp(99); return u.skill.activate('manual'); };

test('one form: an elite flag on a worn piece changes nothing in battle (old saves)', () => {
  const run = (elite) => {
    const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [{ id: G('谢拉格不融冰'), elite }] }]);
    const e = h.spawn('dummy', { pos: [10, 4] });
    attacks(h, h.unit('w'), e, 6);
    return !!e.findBuff('cold');
  };
  assert.equal(run(false), false, 'the 8th attack makes the cold, not the 6th');
  assert.equal(run(true), false, 'an old elite copy counts like the normal one');
});

test('elementOnHit: 侵蚀 / 神经 / 凋亡 on the main target from ATK; 灼燃 from each arts hit (gear damage never again)', () => {
  for (const [name, el, amount] of [['源石促效溶剂', 'erosion', 10], ['阿戈尔神经毒棘', 'neural', 12], ['萨米凋亡枝', 'apoptosis', 15]]) {
    const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G(name)] }]);
    const e = h.spawn('dummy', { pos: [10, 4] });
    attacks(h, h.unit('w'), e);
    assert.ok(near(e.elem[el], amount), `${name}: ${e.elem[el]}`);
    assert.ok(near(lost(e), 100), 'the attack itself is unchanged');
    h.b.dealDamage(h.unit('w'), e, { amount: 100, type: 'phys', tags: ['independentEquipment'] });
    assert.ok(near(e.elem[el], amount), 'gear damage starts nothing');
  }
});

test('elementOnHit with damageType (灼燃维式重锤): 15% of each arts hit as 灼燃损伤; phys hits do nothing', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('灼燃维式重锤')] }]);
  const e = h.spawn('dummy', { pos: [10, 4] });
  attacks(h, h.unit('w'), e);
  assert.equal(e.elem.burn, 0, 'a physical attack makes no 灼燃');
  h.b.dealDamage(h.unit('w'), e, { amount: 200, type: 'arts' });
  assert.ok(near(e.elem.burn, 30), `${e.elem.burn}`);
});

test('knockbackOnHit (冲击维式重锤): 中力 push of the main target, once per 4 s', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('冲击维式重锤')] }]);
  const e = h.spawn('heavy', { pos: [10, 4] });
  const x0 = e.x;
  attacks(h, h.unit('w'), e);
  const x1 = e.x;
  assert.ok(x1 > x0 + 0.5, `pushed away: ${x0} → ${x1}`);
  attacks(h, h.unit('w'), e);
  assert.equal(e.x, x1, 'cooling down');
});

test('pullOnHit (阿戈尔深潜锚钩): every 4th normal attack pulls the main target to the wearer', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('阿戈尔深潜锚钩')] }]);
  const e = h.spawn('heavy', { pos: [10, 6] });
  attacks(h, h.unit('w'), e, 3);
  assert.equal(e.x, 6);
  attacks(h, h.unit('w'), e);
  assert.ok(e.x < 6 - 0.5, `pulled: ${e.x}`);
});

test('pierce (源石激光组件): the enemy right behind the main target on the line takes the same damage; not one further', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('源石激光组件')] }]);
  const main = h.spawn('dummy', { pos: [10, 4] });
  const behind = h.spawn('dummy', { pos: [10, 5] });
  const far = h.spawn('dummy', { pos: [10, 6] });
  const side = h.spawn('dummy', { pos: [11, 4] });
  attacks(h, h.unit('w'), main);
  assert.ok(near(lost(main), 100));
  assert.ok(near(lost(behind), 100), `${lost(behind)}`);
  assert.equal(lost(far), 0);
  assert.equal(lost(side), 0);
});

test('doubleStrike (拉特兰速射扳机): the 5th normal attack is made twice; the second counts for nothing', () => {
  const h = setup([{ uid: 'w', chessId: OPS.lateran, row: 10, col: 3, equipment: [G('拉特兰速射扳机')] }]);
  const e = h.spawn('dummy', { pos: [10, 4] });
  attacks(h, h.unit('w'), e, 4);
  assert.ok(near(lost(e), 400));
  attacks(h, h.unit('w'), e);
  assert.ok(near(lost(e), 600), `${lost(e)}`);
  attacks(h, h.unit('w'), e, 4);
  assert.ok(near(lost(e), 1000), 'the extra shot did not advance the count');
  attacks(h, h.unit('w'), e);
  assert.ok(near(lost(e), 1200));
});

test('extraTargets (黑钢双联弹匣): a normal attack hits two enemies in range', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('黑钢双联弹匣')] }]);
  const a = h.spawn('dummy', { pos: [10, 4] });
  const b = h.spawn('dummy', { pos: [10, 5] });
  const c = h.spawn('dummy', { pos: [10, 6] });
  h.step(1);
  h.b.forceAttack(h.unit('w'));
  assert.equal([a, b, c].filter((e) => lost(e) > 0).length, 2);
});

test('targetPriority (精准狙击镜): the lowest-HP enemy in range is attacked first', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('精准狙击镜')] }]);
  const a = h.spawn('dummy', { pos: [10, 4] });
  const b = h.spawn('dummy', { pos: [10, 6] });
  b.hp = 500;
  h.step(1);
  h.b.forceAttack(h.unit('w'));
  assert.equal(lost(a), 0);
  assert.ok(near(b.hp, 400), `${b.hp}`);
});

test('countedStatus: 恐惧 (狼嚎哨) every 12th attack, and the feared enemy runs; 浮空; 束缚; 停顿', () => {
  for (const [name, status, n, flag] of [['叙拉古狼嚎哨', 'fear', 12, 'fear'], ['莱茵生命浮空发生器', 'levitate', 6, 'levitate'], ['炎国缚锁', 'bind', 6, 'bind']]) {
    const h = setup([{ uid: 'w', chessId: OPS.syracusa, row: 10, col: 3, equipment: [G(name)] }]);
    const e = h.spawn(status === 'fear' ? 'walker' : 'dummy', { pos: [10, 4] });
    attacks(h, h.unit('w'), e, n - 1);
    assert.ok(!e.s.flags[flag], `${name} not yet`);
    attacks(h, h.unit('w'), e);
    assert.ok(e.s.flags[flag], `${name} applies ${status}`);
    if (status === 'fear') {
      const x0 = e.x, y0 = e.y;
      h.run(.5);
      assert.ok(Math.hypot(e.x - x0, e.y - y0) > 0.05, 'a feared enemy runs');
      assert.ok(!e.blockedBy, 'a feared enemy is not blocked');
      h.run(.3);assert.ok(!e.s.flags.fear,'wolf whistle fear expires after .75 seconds');
    }
  }
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('萨尔贡流沙符')] }]);
  const e = h.spawn('dummy', { pos: [10, 4] });
  attacks(h, h.unit('w'), e, 4);
  assert.ok(e.findBuff('sluggish'));
});

test('脆弱 / 法术脆弱 / 防御力降低 from gear are their own effects: they stack apart from an original 脆弱', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('工程部标定信标'), G('卡西米尔破甲箭簇')] }]);
  const e = h.spawn('dummy', { pos: [10, 4] });
  h.b.applyStatus(e, 'fragile', { duration: 10, value: 0.3 }); // an operator's own 脆弱
  attacks(h, h.unit('w'), e, 5);
  assert.ok(e.findBuff('fragile'), 'the original stays');
  assert.ok(e.buffs.some((b) => b.key.startsWith('independent:gear:fragile:')), 'the gear one is there too');
  assert.ok(near(e.s.dmgTakenMul, 1.3 * 1.15, 1e-6), `${e.s.dmgTakenMul}`);
  assert.ok(e.buffs.some((b) => b.key.startsWith('independent:gear:defDown:')), '破甲箭簇: 防御力-20% on every hit');
  // 法术脆弱 (共鸣音叉): any arts damage the wearer deals
  const h2 = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('莱塔尼亚共鸣音叉')] }]);
  const e2 = h2.spawn('dummy', { pos: [10, 4] });
  attacks(h2, h2.unit('w'), e2);
  assert.ok(!e2.buffs.some((b) => b.key.startsWith('independent:gear:artsFragile:')), 'physical: nothing');
  h2.b.dealDamage(h2.unit('w'), e2, { amount: 100, type: 'arts' });
  h2.b.applyStatus(e2, 'artsFragile', { duration: 10, value: 0.2 });
  assert.ok(near(e2.s.artsTakenMul, 1.15 * 1.2, 1e-6), `${e2.s.artsTakenMul}`);
});

test('wolf whistle uses the effective unique 12-attack / .75-second / eight-second rule with real counters',()=>{
  const def=catalog.equipment[G('叙拉古狼嚎哨')],params=def.params.effects[0].params;
  assert.equal(def.unique,true);assert.equal(params.counterEvery,12);assert.equal(params.durationSeconds,.75);assert.equal(params.cooldownSeconds,8);
  const h=setup([{uid:'w',chessId:OPS.syracusa,row:10,col:3,equipment:[def.id]}]);
  const unit=h.unit('w'),enemy=h.spawn('dummy',{pos:[10,4]});
  attacks(h,unit,enemy,11);assert.ok(!enemy.s.flags.fear);attacks(h,unit,enemy);assert.ok(enemy.s.flags.fear);
  h.run(.8);assert.ok(!enemy.s.flags.fear);attacks(h,unit,enemy,24);assert.ok(!enemy.s.flags.fear,'extra twelve-attack cycles during cooldown cannot retrigger');
  h.run(7.3);unit.atkCd=1e9;attacks(h,unit,enemy,12);assert.ok(enemy.s.flags.fear,'a full cycle after eight seconds triggers again');
  h.run(.8);assert.ok(!enemy.s.flags.fear);assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('deployFirstHitStatus perDeploy (谢拉格冰爪): the first normal attack after each deployment chills', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('谢拉格冰爪')] }]);
  const w = h.unit('w');
  const e = h.spawn('dummy', { pos: [10, 4] });
  attacks(h, w, e);
  assert.ok(e.findBuff('cold'));
  h.b.removeBuff(e, 'cold');
  attacks(h, w, e);
  assert.ok(!e.findBuff('cold'), 'only the first one');
  assert.equal(h.b.moveRedeploy(w, w.tileR, w.tileC), true);
  attacks(h, w, e);
  assert.ok(e.findBuff('cold'), 'again after a new deployment');
});

test('disarmOnHit with 战栗 (战栗维式重锤); 蒸汽之心 强化 shortens its cooldown', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('战栗维式重锤')] }]);
  const e = h.spawn('dummy', { pos: [10, 4] });
  attacks(h, h.unit('w'), e);
  assert.ok(e.s.flags.tremble);
  const cd = (equipment,chessId=OPS.a) => {
    const hh = setup([{ uid: 'w', chessId, row: 10, col: 3, equipment }]);
    const t = hh.spawn('dummy', { pos: [10, 4] });
    attacks(hh, hh.unit('w'), t);
    hh.b.removeBuff(t, 'tremble');
    hh.run(5.5);
    attacks(hh, hh.unit('w'), t);
    return !!t.s.flags.tremble;
  };
  assert.equal(cd([G('战栗维式重锤')]), false, '8 s cooldown');
  assert.equal(cd([G('战栗维式重锤'), { id: G('维多利亚蒸汽之心'), state: { hammerSourceIds: ['chess_item_2_03_e_a'] } }],FACTION_OPS.victoria), true, '强化: 5 s');
});

test('spChargeMode (萨尔贡行军浓茶): each normal attack gives 1 SP', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('萨尔贡行军浓茶')] }], { skill: SKILL });
  const w = h.unit('w');
  const e = h.spawn('dummy', { pos: [10, 4] });
  const sp0 = w.skill.sp;
  attacks(h, w, e, 3);
  assert.ok(near(w.skill.sp - sp0, 3, 1e-6), `${w.skill.sp - sp0}`);
});

test('deviceOnDown (不屈部署支架): a 装置 that blocks one enemy lies where the wearer fell, and goes before it redeploys', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('不屈部署支架')] }]);
  const w = h.unit('w');
  h.b.kill(w);
  const dev = h.b.allyUnits.find((u) => u.kind === 'device' && u.alive);
  assert.ok(dev, 'a device stands');
  assert.equal(dev.tileR, 10); assert.equal(dev.tileC, 3);
  assert.equal(dev.s.blockCnt, 1);
  assert.ok(near(dev.s.maxHp, 500));
  const e = h.spawn('dummy', { pos: [10, 3.4] });
  h.b._checkBlock(e);
  assert.equal(e.blockedBy, dev, 'it blocks');
  h.runUntil(() => w.alive, 40);
  assert.ok(w.alive, 'the wearer came back');
  assert.ok(!dev.alive, 'the device is gone');
  assert.equal(w.tileR, 10); assert.equal(w.tileC, 3);
});

test('summonOnDeploy (炎国点睛笔): the first deployment of the battle puts a 召唤物 on a free tile next to the wearer', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('炎国点睛笔')] }]);
  const tokens = h.b.allyUnits.filter((u) => u.kind === 'token' && u.alive);
  assert.equal(tokens.length, 1);
  const t = tokens[0];
  assert.equal(Math.abs(t.tileR - 10) + Math.abs(t.tileC - 3), 1);
  assert.ok(near(t.s.atk, 50) && near(t.s.maxHp, 500), `${t.s.atk}/${t.s.maxHp}`);
  assert.equal(t.s.blockCnt, 1);
  const w = h.unit('w');
  h.b.moveRedeploy(w, w.tileR, w.tileC);
  assert.equal(h.b.allyUnits.filter((u) => u.kind === 'token').length, 1, 'once per battle');
  h.run(20.5);
  assert.ok(!t.alive, 'gone after 20 s');
});

test('skillStartStrike (炎国制式短刀) and deployStrike (卡西米尔竞技旗) hit every enemy in range', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('炎国制式短刀'), G('卡西米尔竞技旗')] }], { skill: SKILL });
  const w = h.unit('w');
  const a = h.spawn('dummy', { pos: [10, 4] });
  const b = h.spawn('dummy', { pos: [10, 6] });
  const out = h.spawn('dummy', { pos: [10, 9] });
  assert.ok(cast(w));
  assert.ok(near(lost(a), 80) && near(lost(b), 80) && lost(out) === 0, `${lost(a)} ${lost(b)} ${lost(out)}`);
  h.b.moveRedeploy(w, w.tileR, w.tileC);
  assert.ok(near(lost(a), 230) && near(lost(b), 230) && lost(out) === 0, `${lost(a)} ${lost(b)}`);
});

test('stealthOnDeploy (叙拉古仪仗正装) ends with the first normal attack; 家族印记 then stuns, paired adds true damage', () => {
  const h = setup([{ uid: 'w', chessId: OPS.syracusa, row: 10, col: 3, equipment: [G('叙拉古仪仗正装'), G('叙拉古家族印记')] }]);
  const w = h.unit('w');
  assert.ok(w.s.flags.stealth, 'hidden on deployment');
  const e = h.spawn('dummy', { pos: [10, 4] });
  attacks(h, w, e);
  assert.ok(!w.s.flags.stealth, 'the first attack ends it');
  assert.ok(!e.s.flags.stun, 'not yet');
  h.step(1); // the wearer notices it left 隐匿
  attacks(h, w, e);
  assert.ok(e.s.flags.stun, '家族印记: 晕眩');
  assert.ok(near(lost(e), 100 + 100 + 100), `paired true damage: ${lost(e)}`);
});

test('attractOnDeploy (诱敌蜂鸣器): enemies in range are drawn to the wearer; it is easier to hit', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('诱敌蜂鸣器')] }]);
  const w = h.unit('w');
  assert.equal(w.s.taunt ?? w.s.tauntLevel, (w.base.tauntLevel || 0) + 1);
  const e = h.spawn('walker', { pos: [10, 6] });
  h.b.moveRedeploy(w, w.tileR, w.tileC);
  assert.ok(e.s.flags.attract, '诱导');
});

test('staticStats 阻挡数 (防暴塔盾)', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('防暴塔盾')] }]);
  assert.equal(h.unit('w').s.blockCnt, 2);
});

test('ricochet damageType (萨尔贡链雷护符): only arts normal attacks bounce, twice within 1 tile', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('萨尔贡链雷护符')] }]);
  const main = h.spawn('dummy', { pos: [10, 4] });
  const n1 = h.spawn('dummy', { pos: [10, 5] });
  attacks(h, h.unit('w'), main);
  assert.equal(lost(n1), 0, 'a physical attack does not bounce');
  const h2 = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('萨尔贡链雷护符')] }], { dmgType: 'arts' });
  const m2 = h2.spawn('dummy', { pos: [10, 4] });
  const b1 = h2.spawn('dummy', { pos: [10, 5] });
  const b2 = h2.spawn('dummy', { pos: [10, 6] });
  const b3 = h2.spawn('dummy', { pos: [10, 8] });
  attacks(h2, h2.unit('w'), m2);
  assert.ok(near(lost(b1), 30) && near(lost(b2), 30) && lost(b3) === 0, `${lost(b1)} ${lost(b2)} ${lost(b3)}`);
});

test('conditionalDamage targetHpBelow (叙拉古处决令): +30% on enemies under 40% HP', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('叙拉古处决令')] }]);
  const e = h.spawn('dummy', { pos: [10, 4] });
  attacks(h, h.unit('w'), e);
  assert.ok(near(lost(e), 100));
  e.hp = 3000;
  attacks(h, h.unit('w'), e);
  assert.ok(near(e.hp, 3000 - 130), `${e.hp}`);
});

test('skillStartShield (天马骑士战盔) and the paired break burst; 天马骑士长枪 works alone and doubles paired', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('天马骑士战盔'), G('天马骑士长枪')] }], { skill: SKILL });
  const w = h.unit('w');
  const near1 = h.spawn('dummy', { pos: [10, 4] });
  assert.ok(cast(w));
  assert.equal(w.findBuff(`independent:equipmentShield:${w.uid}`)?.shieldHits, 1);
  const hitter = h.spawn('hitter', { pos: [10, 4] });
  h.b.dealDamage(hitter, w, { amount: 100, type: 'phys' });
  h.step(1);
  assert.ok(near(lost(near1), 100), `burst: ${lost(near1)}`);
  const h3 = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('天马骑士战盔'), G('天马骑士长枪')] }]);
  const e3 = h3.spawn('dummy', { pos: [10, 4] });
  attacks(h3, h3.unit('w'), e3);
  assert.ok(near(lost(e3), 130), `paired 长枪 30%: ${lost(e3)}`);
  const h2 = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('天马骑士长枪')] }]);
  const e2 = h2.spawn('dummy', { pos: [10, 4] });
  attacks(h2, h2.unit('w'), e2);
  assert.ok(near(lost(e2), 115), `alone 15%: ${lost(e2)}`);
});

test('countedExtraShot (拉特兰铳骑组件): every 8th attack one more shot at another enemy; with 跳弹模块 it bounces', () => {
  const h = setup([{ uid: 'w', chessId: OPS.lateran, row: 10, col: 3, equipment: [G('拉特兰铳骑组件'), G('拉特兰跳弹模块')] }]);
  const w = h.unit('w');
  const main = h.spawn('dummy', { pos: [10, 4] });
  const other = h.spawn('dummy', { pos: [10, 6] });
  const third = h.spawn('dummy', { pos: [10, 7] });
  attacks(h, w, main, 7);
  const before = lost(other);
  const before3 = lost(third);
  attacks(h, w, main);
  assert.ok(lost(other) - before >= 100 - 1e-6, `the shot: ${lost(other) - before}`);
  assert.ok(lost(third) - before3 >= 50 - 1e-6, `it bounces: ${lost(third) - before3}`);
});

test('counterAccelerator (工程部节拍校准器): every counter counts twice per normal attack', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('工程部节拍校准器'), G('谢拉格不融冰')] }]);
  const e = h.spawn('dummy', { pos: [10, 4] });
  attacks(h, h.unit('w'), e, 3);
  assert.ok(!e.findBuff('cold'));
  attacks(h, h.unit('w'), e);
  assert.ok(e.findBuff('cold'), 'the 4th attack counts as the 8th');
});

test('controlledSplash (罗德岛处置预案): hitting a stunned enemy hits the ones around it the same', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: [G('罗德岛处置预案')] }]);
  const main = h.spawn('dummy', { pos: [10, 4] });
  const by = h.spawn('dummy', { pos: [11, 4] });
  attacks(h, h.unit('w'), main);
  assert.equal(lost(by), 0);
  h.b.applyStatus(main, 'stun', { duration: 5 });
  attacks(h, h.unit('w'), main);
  assert.ok(near(lost(by), 100), `${lost(by)}`);
});

test('skillStartTeamStrike (炎国天师古鼎): the other 炎 operators’ next normal attack hits every enemy in their range', () => {
  const h = setup([
    { uid: 'w', chessId: FACTION_OPS.yan, row: 10, col: 3, equipment: [G('炎国天师古鼎')] },
    { uid: 'y', chessId: FACTION_OPS.yan2, row: 12, col: 3, equipment: [] },
  ], { skill: SKILL });
  const a = h.spawn('dummy', { pos: [12, 4] });
  const b = h.spawn('dummy', { pos: [12, 6] });
  assert.ok(cast(h.unit('w')));
  h.b.forceAttack(h.unit('y'), [a]);
  assert.ok(near(lost(a), 60) && near(lost(b), 60), `${lost(a)} ${lost(b)}`);
  h.b.forceAttack(h.unit('y'), [a]);
  assert.ok(near(lost(a), 160) && near(lost(b), 60), 'only the next one');
});

test('damageReductionAndRetaliation paired splash (阿戈尔海沟实验体 + 裂潮重刃)', () => {
  const h = setup([{ uid: 'w', chessId: FACTION_OPS.aegir, row: 10, col: 3, equipment: [G('阿戈尔海沟实验体'), G('阿戈尔裂潮重刃')] }]);
  const w = h.unit('w');
  const src = h.spawn('hitter', { pos: [10, 4] });
  const by = h.spawn('dummy', { pos: [11, 4] });
  h.b.dealDamage(src, w, { amount: 100, type: 'phys' });
  assert.ok(near(lost(src), 40) && near(lost(by), 40), `${lost(src)} ${lost(by)}`);
  assert.ok(near(w.s.maxHp - w.hp, 100), 'no flat reduction any more');
});

test('阿戈尔海沟实验体 retaliates directly without the paired splash blade',()=>{
  const h=setup([{uid:'w',chessId:FACTION_OPS.aegir,row:10,col:3,equipment:[G('阿戈尔海沟实验体')]}]);
  const w=h.unit('w'),source=h.spawn('hitter',{pos:[10,4]}),nearby=h.spawn('dummy',{pos:[11,4]});
  h.b.dealDamage(source,w,{amount:100,type:'phys'});
  assert.ok(near(lost(source),40),`${lost(source)}`);assert.equal(lost(nearby),0);assert.ok(near(lost(w),100));
});

test('阿戈尔裂潮重刃 splashes its own normal-attack hit without the paired retaliation gear',()=>{
  const h=setup([{uid:'w',chessId:OPS.a,row:10,col:3,equipment:[G('阿戈尔裂潮重刃')]}]);
  const main=h.spawn('dummy',{pos:[10,4]}),nearby=h.spawn('dummy',{pos:[11,4]});
  attacks(h,h.unit('w'),main);
  assert.ok(near(lost(main),100));assert.ok(near(lost(nearby),40),`${lost(nearby)}`);
});

test('萨尔贡行军浓茶 grants its wearer SP on normal attacks without a compass',()=>{
  const h=setup([{uid:'w',chessId:FACTION_OPS.sargon,row:10,col:3,equipment:[G('萨尔贡行军浓茶')]}],{skill:{...SKILL,spCost:99}});
  const w=h.unit('w'),enemy=h.spawn('dummy',{pos:[10,4]});w.skill.sp=0;
  attacks(h,w,enemy);assert.ok(w.skill.sp>=1-1e-6,`SP=${w.skill.sp}`);
});

test('skillRecast (萨尔贡黄沙罗盘): the first skill starts again for free; paired 行军浓茶 gives other 萨尔贡 SP', () => {
  const h = setup([
    { uid: 'w', chessId: FACTION_OPS.sargon, row: 10, col: 3, equipment: [G('萨尔贡黄沙罗盘'), G('萨尔贡行军浓茶')] },
    { uid: 's', chessId: 'chess_char_4_05_a', row: 12, col: 3, equipment: [] },
  ], { skill: { ...SKILL, durationType: 'NONE', duration: 2 } });
  const w = h.unit('w');
  w.skill.gainSp(99); assert.ok(w.skill.activate('manual'));
  const n0 = w.skill.activations;
  h.run(2.5);
  assert.equal(w.skill.activations, n0 + 1, 'cast again');
  h.run(3);
  assert.equal(w.skill.activations, n0 + 1, 'once per battle');
  assert.ok(h.unit('s').skill.sp >= 4 - 1e-6, `other 萨尔贡 got SP: ${h.unit('s').skill.sp}`);
});

test('萨尔贡黄沙罗盘 alone recasts its first ended skill once',()=>{
  const h=setup([{uid:'w',chessId:FACTION_OPS.sargon,row:10,col:3,equipment:[G('萨尔贡黄沙罗盘')]}],{skill:{...SKILL,duration:2}});
  const w=h.unit('w');assert.ok(cast(w));h.run(2.5);assert.equal(w.skill.activations,2);h.run(3);assert.equal(w.skill.activations,2);
});

test('skillEndRedeploy (卡西米尔骑士戒律 + 竞技旗): the wearer redeploys on its tile when its skill ends and charges again', () => {
  const h = setup([{ uid: 'w', chessId: FACTION_OPS.kazimierz, row: 10, col: 3, equipment: [G('卡西米尔骑士戒律'), G('卡西米尔竞技旗')] }], { skill: { ...SKILL, duration: 2 } });
  const w = h.unit('w');
  const e = h.spawn('dummy', { pos: [10, 5] });
  const seq = w.deploySeq;
  assert.ok(cast(w));
  assert.ok(e.findBuff(`independent:skillWindowSlow:${w.uid}`), 'slowed in range');
  h.run(2.5);
  assert.ok(w.deploySeq > seq, 'deployed again');
  assert.ok(near(lost(e), 150), `the charge again: ${lost(e)}`);
  assert.equal(h.gear.filter((x) => x.target === e).length, 1);
  assert.equal(w.tileR, 10); assert.equal(w.tileC, 3);
});

test('卡西米尔骑士戒律 alone slows only enemies in the wearer attack range when a skill starts',()=>{
  const h=setup([{uid:'w',chessId:FACTION_OPS.kazimierz,row:10,col:3,equipment:[G('卡西米尔骑士戒律')]}],{skill:SKILL});
  const nearEnemy=h.spawn('dummy',{pos:[10,5]}),farEnemy=h.spawn('dummy',{pos:[10,9]});
  assert.ok(cast(h.unit('w')));assert.ok(nearEnemy.findBuff('independent:skillWindowSlow:w'));assert.equal(farEnemy.findBuff('independent:skillWindowSlow:w'),null);
});

test('卡西米尔竞技旗 alone charges on redeployment and strikes in range',()=>{
  const h=setup([{uid:'w',chessId:FACTION_OPS.kazimierz,row:10,col:3,equipment:[G('卡西米尔竞技旗')]}]);
  const w=h.unit('w'),enemy=h.spawn('dummy',{pos:[10,5]});assert.equal(lost(enemy),0);
  assert.equal(h.b.moveRedeploy(w,w.tileR,w.tileC),true);assert.ok(near(lost(enemy),150),`${lost(enemy)}`);
});

test('工程部特供 mechanisms: 重装防护套件 stuns a blocked attacker sometimes; 战备箱 gives SP on a kill', () => {
  const h = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: ['rhodes-heavy-protection-kit'] }]);
  const w = h.unit('w');
  const e = h.spawn('dummy', { pos: [10, 3.4] });
  h.b._checkBlock(e);
  assert.equal(e.blockedBy, w);
  let stunned = 0;
  for (let i = 0; i < 40; i++) { h.b.dealDamage(e, w, { amount: 1, type: 'phys' }); if (e.s.flags.stun) { stunned++; h.b.removeBuff(e, 'stun'); } }
  assert.ok(stunned > 0 && stunned < 40, `${stunned}`);
  const h2 = setup([{ uid: 'w', chessId: OPS.a, row: 10, col: 3, equipment: ['elite-operator-readiness-case'] }], { skill: SKILL });
  const w2 = h2.unit('w');
  const e2 = h2.spawn('dummy', { pos: [10, 4] });
  const sp0 = w2.skill.sp;
  h2.b.kill(e2, w2);
  assert.ok(near(w2.skill.sp - sp0, 2, 1e-6), `${w2.skill.sp - sp0}`);
});
