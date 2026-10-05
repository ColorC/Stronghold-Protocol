import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const baseCatalog = getCatalog();

function fixturePiece(uid, chessId, row, col, equipment = []) {
  return { uid, chessId, row, col, dir: 'RIGHT', skillIndex: 0, moduleId: 'none', equipment, attachments: [], nativeState: {} };
}

function fixtureBattle({ pieces, catalog = baseCatalog, rules = [], sourceStats = {}, chessOptions = {} }) {
  const chess = {};
  const operators = { ...catalog.operators };
  for (const piece of pieces) {
    const rec = chessRec({ id: piece.chessId, ...chessOptions, stats: { atk: 100, maxHp: 1000, def: 0, res: 0, aspd: 100, spRecovery: 0, respawnTime: 20, ...sourceStats }, skill: null });
    chess[piece.chessId] = rec;
    if (!catalog.operators[piece.chessId]) operators[piece.chessId] = {
      chessId: piece.chessId, name: piece.chessId,
      nativeTrait: { effect: { combat: rules } }, source: { normalChess: rec },
    };
  }
  const exactCatalog = { ...catalog, operators };
  const h = makeBattle({
    units: pieces.map(({ uid, chessId, row, col, dir }) => ({ uid, chessId, row, col, dir })),
    defs: { chess, enemies: { enemy_test: enemyRec({ key: 'enemy_test', hp: 10000, def: 0, res: 0 }) } },
    autoFinish: false,
    content: 'independent',
    flags: { independent: { catalog: exactCatalog, pieces } },
    extraContent: [battle => installIndependentBattle(battle, { catalog: exactCatalog, state: { pieces } })],
  });
  return { h, catalog: exactCatalog };
}

test('Nearl the Radiant Knight combines her badge count with the deployed front ally', () => {
  const back = fixturePiece('back', 'chess_char_6_17_a', 9, 5, [{ id: 'agility', quantity: 3 }]);
  const front = fixturePiece('front', 'chess_char_1_02_a', 9, 6, [{ id: 'agility', quantity: 2 }]);
  const { h } = fixtureBattle({ pieces: [back, front] });
  h.step(1);
  const unit = h.unit('back');
  assert.equal(unit.s.aspd, 107);
  assert.ok(Math.abs(unit.s.redeployMul - 0.985) < 1e-8);
});

test('M3 emergency cocoon overrides the first respawn delay once and restores normal delay after use', () => {
  const piece = fixturePiece('reviver', 'independent_revive_fixture_a', 9, 5, [{ id: 'chess_item_4_12_e_a', elite: false }]);
  const { h } = fixtureBattle({ pieces: [piece] });
  h.step(1);
  const unit = h.unit('reviver');
  h.b.kill(unit);
  assert.ok(Math.abs((unit.respawnAt - unit.deathAt) - 1) < 1e-8);
  h.run(1.1);
  assert.equal(unit.deployed, true);
  assert.ok(Math.abs(unit.hp / unit.s.maxHp - 0.5) < 1e-8);
  h.b.kill(unit);
  assert.ok(Math.abs((unit.respawnAt - unit.deathAt) - unit.base.respawnTime) < 1e-8);
});

test('equipment-applied freeze is excluded from native cold-record rewards while native freeze counts', () => {
  const id = 'independent_freeze_fixture_a';
  const gear = {
    id: 'status-source-fixture', sourceId: 'status-source-fixture', mechanism: 'combatEquipment', available: true,
    params: { effects: [
      { trigger: 'attack', behavior: 'countedStatus', params: { counterEvery: 1, status: 'freeze', durationSeconds: 4 } },
      { trigger: 'statusApplied', behavior: 'eventProduction', params: {
        counterEvent: 'statusApplied', counterEvery: 1, outputs: [{ id: 'assault', quantity: 1 }], maxPerBattle: 4,
        filter: { actor: 'self', targetSide: 'enemy', status: 'frozen', entered: true, nativeSource: true },
      } },
    ] },
  };
  const piece = fixturePiece('freezer', id, 9, 5, [{ id: gear.id }]);
  const catalog = { ...baseCatalog, equipment: { ...baseCatalog.equipment, [gear.id]: gear } };
  const { h } = fixtureBattle({ pieces: [piece], catalog });
  h.step(1);
  const unit = h.unit('freezer');
  const enemy = h.spawn('enemy_test', { pos: [9, 6] });
  const attackId = h.b._attackSeq + 1;
  h.b.emit('beforeAttack', { attacker: unit, targets: [enemy], isSkill: false });
  h.b.dealDamage(unit, enemy, { amount: 100, type: 'phys', attackId, isAttack: true });
  assert.equal(enemy.s.flags.freeze, true);
  assert.deepEqual(h.b.independentRewards, []);
  h.b.removeBuff(enemy, 'freeze');
  h.b.applyStatus(enemy, 'freeze', { source: unit, duration: 4 });
  assert.deepEqual(h.b.independentRewards, [{ id: 'assault', quantity: 1, origin: 'equipment', sourceUid: 'freezer' }]);
});

test('Specter the Unchained real dollSwitch entry produces vitality and shares her per-battle cap', () => {
  const piece = fixturePiece('specter', 'chess_char_5_13_a', 9, 5);
  const { h } = fixtureBattle({ pieces: [piece], chessOptions: { subProfessionId: 'dollkeeper' } });
  h.step(1);
  const unit = h.unit('specter');

  // This is the profession's real switch request path: it enters the doll form, which emits dollSwap.
  h.b.emit('dollSwitch', { unit, reason: 'test', done: false });
  assert.equal(unit.trait.doll, true);
  assert.equal(h.b.independentRewards.reduce((n, r) => n + r.quantity, 0), 1);

  // Returning to the operator also emits dollSwap; a later switch-in can award more.
  h.b.removeBuff(unit, 'trait:substitute');
  assert.equal(unit.trait.doll, false);
  h.b.emit('dollSwitch', { unit, reason: 'test', done: false });
  h.b.removeBuff(unit, 'trait:substitute');
  h.b.emit('dollSwitch', { unit, reason: 'test', done: false });
  h.b.removeBuff(unit, 'trait:substitute');
  h.b.emit('dollSwitch', { unit, reason: 'test', done: false });

  // death and dollSwap are distinct production rules but share the approved source/id cap.
  for (let i = 0; i < 5; i++) h.b.emit('death', { unit });
  assert.equal(h.b.independentRewards.filter(r => r.id === 'vitality' && r.sourceUid === 'specter').reduce((n, r) => n + r.quantity, 0), 4);
});

test('Maaw native production replay copies one preferred badge at its fixed per-event quantity', () => {
  const id = 'independent_replay_fixture_a';
  const rules = [{ trigger: 'nativeProduction', behavior: 'eventProduction', params: {
    counterEvent: 'nativeProduction', counterEvery: 1, outputs: [{ idFromEvent: true, quantity: 1 }],
    copyOutputFromEvent: true, quantity: 1, maxPerBattle: 4, fallbackPreference: 'productionBadge',
    filter: { actor: 'self', nativeTraitProduction: true, baseBadgeOnly: true, excludeCopy: true },
  } }];
  const piece = fixturePiece('maaw', id, 9, 5);
  piece.nativeState.preferences = { productionBadge: 'assault' };
  const { h } = fixtureBattle({ pieces: [piece], rules });
  h.step(1);
  const actor = h.unit('maaw');
  h.b.emit('nativeProduction', { actor, origin: 'native', outputs: [
    { id: 'precision', quantity: 4 }, { id: 'assault', quantity: 9 },
  ] });
  assert.deepEqual(h.b.independentRewards, [{ id: 'assault', quantity: 1, origin: 'native', sourceUid: 'maaw', copied: true }]);
});
