import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';

const catalog = getCatalog();
// Expected values come from the approved design. Inspect the real Battle stats,
// including items that also install a combat effect.
const cases = [
  ['源石促效溶剂', { atk: 600 }, { atk: 650 }],
  ['不屈部署支架', { maxHp: 850, redeployMul: 0.8 }, { maxHp: 800, redeployMul: 0.7 }],
  ['战栗维式重锤', { atk: 550 }, { atk: 600 }],
  ['坚固维式重锤', { atk: 550 }, { atk: 600 }],
  ['加速维式重锤', { atk: 550, aspd: 110 }, { atk: 600, aspd: 120 }],
  ['灼燃维式重锤', { atk: 575 }, { atk: 625 }],
  ['奥术耐受披风', { res: 10 }, { res: 20 }],
  ['天马骑士战盔', { maxHp: 1200 }, { maxHp: 1350 }],
  ['天马骑士长枪', { atk: 600 }, { atk: 675 }],
  ['双模机械臂', { atk: 575 }, { atk: 625 }],
  ['拉特兰铳骑组件', { atk: 600 }, { atk: 675 }],
  ['炎国天师古鼎', { maxHp: 1200 }, { maxHp: 1350 }],
  ['维多利亚蒸汽之心', { aspd: 115 }, { aspd: 125 }],
  ['耶拉冈德之泪', { res: 15 }, { res: 25 }],
  ['卡西米尔骑士戒律', { redeployMul: 0.85 }, { redeployMul: 0.75 }],
];

for (const [name, normal, elite] of cases) for (const variant of [false, true]) {
  test(`${name} ${variant ? 'elite' : 'ordinary'} constant stats survive its effect handler`, () => {
    const gear = Object.values(catalog.equipment).find(x => x.name === name);
    assert.ok(gear, name);
    const id = 'independent_gear_fixture_a';
    const rec = chessRec({ id, stats: { atk: 500, maxHp: 1000, def: 100, res: 0, aspd: 100 }, skill: null });
    const piece = { uid: 'fixture', chessId: id, row: 9, col: 5, dir: 'RIGHT', skillIndex: 0, moduleId: 'none', equipment: [{ uid: 'gear', id: gear.id, quantity: 1, elite: variant, state: {} }], attachments: [], nativeState: {} };
    const testCatalog = { ...catalog, operators: { ...catalog.operators, [id]: { chessId: id, nativeTrait: { effect: { combat: [] } }, source: { normalChess: rec } } } };
    const h = makeBattle({ units: [{ ...piece }], defs: { chess: { [id]: rec } }, content: 'independent', extraContent: [b => installIndependentBattle(b, { catalog: testCatalog, state: { pieces: [piece], counters: {} } })] });
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
    const u = h.unit('fixture');
    for (const [key, expected] of Object.entries(variant ? elite : normal)) {
      const actual = key === 'redeployMul' ? (u.s.redeployMul ?? 1) * (u.persist.redeployMul ?? 1) : u.s[key];
      assert.ok(Math.abs(actual - expected) < 1e-8, `${key}: ${actual} != ${expected}`);
    }
  });
}
