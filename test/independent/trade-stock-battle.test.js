import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const OP = 'chess_char_1_09_a';
const WOLF = 'independent:叙拉古狼嚎哨';

function setup(equipment, secondWearer = false) {
  const catalog = structuredClone(getCatalog());
  const wolf = catalog.equipment[WOLF];
  assert.equal(wolf.unique, true, 'the effective catalog keeps the design unique flag');
  wolf.params.effects[0].params = { status: 'fear', counterEvery: 2, durationSeconds: .1, cooldownSeconds: 8, target: 'primary' };
  catalog.equipment['other-status'] = { ...structuredClone(wolf), id: 'other-status', sourceId: 'other-status', uniqueKey: 'other-status', canonicalId: 'other-status', params: { effects: [{ trigger: 'attack', behavior: 'countedStatus', params: { status: 'bind', counterEvery: 2, durationSeconds: .1, cooldownSeconds: 8 } }] } };
  const pieces = [{ uid: 'w', chessId: OP, row: 10, col: 3, dir: 'RIGHT', equipment, attachments: [], nativeState: {} }];
  if (secondWearer) pieces.push({ ...pieces[0], uid: 'v', row: 11, equipment: [{ id: WOLF, quantity: 1 }] });
  const snapshot = structuredClone(pieces);
  const h = makeBattle({ units: pieces.map(p => ({ uid: p.uid, chessId: p.chessId, row: p.row, col: p.col })), defs: {
    chess: { [OP]: chessRec({ id: OP, rangeGrid: [[0, 0], [0, 1], [0, 2]], stats: { atk: 10, maxHp: 1000, aspd: 100, spRecovery: 0, respawnTime: 20 } }) },
    enemies: { dummy: enemyRec({ key: 'dummy', hp: 100000, def: 0, res: 0, speed: 0 }) },
  }, autoFinish: false, content: 'independent', flags: { independent: { catalog, pieces } }, extraContent: [(b) => installIndependentBattle(b, { catalog, state: { pieces } })] });
  h.step(1);
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  for (const unit of h.b.allyUnits) unit.atkCd = 1e9;
  return { h, catalog, pieces, snapshot };
}
const attack = (h, unit, enemy, n = 1) => { for (let i = 0; i < n; i++) h.b.forceAttack(unit, [enemy]); };

test('countedStatus cooldown is per wearer and native gear id, survives redeployment, and does not count multihits/skill/gear damage', () => {
  const { h } = setup([{ id: WOLF, quantity: 1 }, { id: 'other-status', quantity: 1 }], true);
  const unit = h.unit('w'); const other = h.unit('v');
  const enemy = h.spawn('dummy', { pos: [10, 4] });
  const enemy2 = h.spawn('dummy', { pos: [11, 4] });
  unit.profile.hits = 3;
  attack(h, unit, enemy);
  assert.ok(!enemy.s.flags.fear, 'three hits are one counted attack');
  unit.profile.isSkill = true; attack(h, unit, enemy, 2); unit.profile.isSkill = false;
  h.b.dealDamage(unit, enemy, { amount: 10, type: 'phys', tags: ['independentEquipment'], attackId: h.b._attackSeq + 1 });
  assert.ok(!enemy.s.flags.fear, 'skills and gear damage do not advance the counter');
  attack(h, unit, enemy);
  assert.ok(enemy.s.flags.fear);
  assert.ok(enemy.s.flags.bind, 'a different native gear id has its own cooldown');
  const first = unit.mem[`independentCountedStatusCd:${WOLF}`];
  attack(h, other, enemy2, 2);
  assert.ok(enemy2.s.flags.fear, 'another wearer may trigger at the same moment');
  h.run(.3);
  h.b.moveRedeploy(unit, unit.tileR, unit.tileC);
  unit.atkCd = 1e9;
  attack(h, unit, enemy, 2);
  assert.ok(!enemy.s.flags.fear, 'redeployment cannot refresh a running cooldown');
  assert.equal(unit.mem[`independentCountedStatusCd:${WOLF}`], first);
  h.run(8);
  unit.atkCd = 1e9;
  attack(h, unit, enemy, 2);
  assert.ok(enemy.s.flags.fear, 'the next eligible attack after cooldown triggers');
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
});

test('legacy duplicates of unique gear have exactly one battle effect and leave every saved asset untouched', () => {
  const { h, pieces, snapshot } = setup([{ uid: 'old1', id: WOLF, quantity: 99, state: { counter: 3 } }, { uid: 'old2', id: WOLF, quantity: 7, state: { counter: 8 } }]);
  const enemy = h.spawn('dummy', { pos: [10, 4] });
  attack(h, h.unit('w'), enemy);
  assert.ok(!enemy.s.flags.fear);
  attack(h, h.unit('w'), enemy);
  assert.ok(enemy.s.flags.fear);
  const wolfHooks = (h.b._hooks.beforeAttack || []).filter(x => x.owner === h.unit('w'));
  assert.ok(wolfHooks.length > 0);
  assert.deepEqual(pieces, snapshot, 'battle projection never deletes or rewrites saved quantity/state');
});
