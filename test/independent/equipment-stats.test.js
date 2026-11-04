// Gear v4 (2026-10-07, user: 「装备不再有精锐形态」): special combat gear changes how its wearer fights and adds no numbers
// (攻击力、生命、攻速 belong to the badges). The reworked pieces that used to carry stats carry none in battle, an old
// save's elite copy fights like the normal one, and a retired piece still gives its normal stats to the save holding it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';

const catalog = getCatalog();
const BASE = { atk: 500, maxHp: 1000, def: 100, res: 0, aspd: 100 };
const cases = [
  ['源石促效溶剂', {}], ['不屈部署支架', {}], ['战栗维式重锤', {}], ['坚固维式重锤', {}], ['冲击维式重锤', {}],
  ['灼燃维式重锤', {}], ['奥术抑制器', {}], ['天马骑士战盔', {}], ['天马骑士长枪', {}], ['双模机械臂', {}],
  ['拉特兰铳骑组件', {}], ['炎国天师古鼎', {}], ['维多利亚蒸汽之心', {}], ['耶拉冈德之泪', {}], ['卡西米尔骑士戒律', {}],
  ['防暴塔盾', { blockCnt: 3 }],
  // retired: kept for old saves, normal numbers only
  ['阿戈尔沉海重刃', { atk: 600, aspd: 95 }], ['歌利亚防护盔', { maxHp: 1150 }],
];

for (const [name, changed] of cases) for (const elite of [false, true]) {
  test(`${name}${elite ? ' (an old elite copy)' : ''}: the stats it gives in battle`, () => {
    const gear = Object.values(catalog.equipment).find((x) => (x.newName || x.name) === name);
    assert.ok(gear, name);
    const id = 'independent_gear_fixture_a';
    const rec = chessRec({ id, stats: { ...BASE }, skill: null });
    const piece = { uid: 'fixture', chessId: id, row: 9, col: 5, dir: 'RIGHT', skillIndex: 0, moduleId: 'none', equipment: [{ uid: 'gear', id: gear.id, quantity: 1, elite, state: {} }], attachments: [], nativeState: {} };
    const testCatalog = { ...catalog, operators: { ...catalog.operators, [id]: { chessId: id, nativeTrait: { effect: { combat: [] } }, source: { normalChess: rec } } } };
    const h = makeBattle({ units: [{ ...piece }], defs: { chess: { [id]: rec } }, content: 'independent', extraContent: [(b) => installIndependentBattle(b, { catalog: testCatalog, state: { pieces: [piece], counters: {} } })] });
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
    const u = h.unit('fixture');
    for (const [key, expected] of Object.entries({ ...BASE, blockCnt: 2, ...changed })) assert.ok(Math.abs(u.s[key] - expected) < 1e-8, `${key}: ${u.s[key]} != ${expected}`);
  });
}
