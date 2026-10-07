import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

const data = getData();
const catalog = getCatalog(data);
for (const elite of [false, true]) {
  test(`Tippi native guaranteed dodge publishes production, ${elite ? 'elite' : 'ordinary'}`, () => {
    const id = elite ? 'chess_char_2_13_b' : 'chess_char_2_13_a';
    const piece = { uid: 'tippi', chessId: id, elite, row: 10, col: 5, dir: 'RIGHT', skillIndex: 1, moduleId: 'none', equipment: [], attachments: [], nativeState: {} };
    const h = makeBattle({ data, units: [piece], content: 'full', autoFinish: false,
      defs: { enemies: { probe: enemyRec({ key: 'probe', hp: 1e9, atk: 100, speed: 0 }) } },
      enemies: [{ key: 'probe', pos: [10, 7] }],
      flags: { independent: { catalog, pieces: [piece] } },
      extraContent: [(b) => installIndependentBattle(b, { catalog, state: { pieces: [piece] } })] });
    h.step(1);
    const unit = h.unit('tippi');
    const attacker = h.enemies()[0];
    const dodges = [];
    h.b.on('dodge', (e) => { if (e.target === unit) dodges.push(e); });
    const before = unit.hp;
    h.b.dealDamage(attacker, unit, { amount: 100, type: 'phys', canDodge: true, isAttack: true });
    assert.equal(unit.hp, before, 'native talent really avoids damage');
    assert.equal(dodges.length, 1, 'one logical dodge, not just the visual MISS');
    assert.equal(h.b.independentRewards.find((r) => r.id === 'agility' && r.sourceUid === 'tippi')?.quantity, elite ? 2 : 1);
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  });
}
