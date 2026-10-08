import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { getIndependentField } from '../../server/modes/independent/battle.js';
import { grantEquipment } from '../../server/modes/independent/equipment.js';
import { trainingChoiceOptions, drawTrainingChoices } from '../../shared/independentTrainingChoice.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { cardTable } from '../../tools/independent-card-table.mjs';

const catalog = getCatalog();
const whistleId = 'independent:叙拉古狼嚎哨';
const blastId = 'independent:爆破部署台';
const meltdownId = 'independent:便携式融毁教学仪';

function fixture(level = 3) {
  const state = createSession({ seed: 91, difficulty: 'FUNNY' });
  const op = Object.values(catalog.operators).find((x) => !x.elite && x.name === '普罗旺斯');
  const tile = [...getIndependentField(state).deployMap].find(([, cls]) => cls === 'MELEE' || cls === 'melee');
  assert.ok(op && tile);
  const [row, col] = tile[0].split(',').map(Number);
  const piece = { uid: `p${state.nextUid++}`, chessId: op.chessId, elite: false, row, col, dir: 'RIGHT', skillIndex: 0,
    moduleId: 'none', equipment: [], attachments: [], nativeState: {}, bodyPenaltyApplied: false, poolCopies: 0 };
  state.pieces.push(piece);
  state.shop.level = level;
  state.phase = 'prize';
  state.offers = [{ id: 'training-prize', type: 'prize', choices: ['special-readiness-training'], source: 'fixture' }];
  return { state, piece };
}

function seedRevealing(id, options) {
  for (let seed = 1; seed < 10000; seed++) if (drawTrainingChoices(options, seed, 3).choices.includes(id)) return seed;
  assert.fail(`deterministic training draw never revealed ${id}`);
}

function openTraining(state, piece, id) {
  const options = trainingChoiceOptions(state, catalog, piece);
  state.rngState = seedRevealing(id, options);
  const result = applyAction(state, { type: 'choose', offerId: 'training-prize', index: 0, targetUid: piece.uid });
  assert.equal(result.ok, true, result.error?.message);
  const offer = result.state.offers.find((x) => x.type === 'attachment');
  assert.ok(offer?.trainingChoice);
  return { state: result.state, offer };
}

test('专项战备授训 directly equips a selected item, records its prize source and recipient, then its gear works in battle', () => {
  const { state, piece } = fixture(2);
  const options = trainingChoiceOptions(state, catalog, piece);
  assert.ok(options.includes(whistleId));
  assert.ok(!options.includes(meltdownId), 'sixth-tier equipment is unavailable at shop level two');
  const opened = openTraining(state, piece, whistleId);
  const index = opened.offer.choices.indexOf(whistleId);
  assert.notEqual(index, -1);
  assert.equal(opened.offer.choices.length, 3, 'the prize reveals up to three combined attachment and equipment choices');

  const picked = applyAction(opened.state, { type: 'choose', offerId: opened.offer.id, index });
  assert.equal(picked.ok, true, picked.error?.message);
  const wearer = picked.state.pieces.find((p) => p.uid === piece.uid);
  assert.deepEqual(wearer.equipment.filter((x) => x.id === whistleId).map((x) => x.quantity), [1]);
  assert.equal(picked.state.inventory.some((x) => x.id === whistleId), false, 'training gear is worn directly, never put in stock');
  assert.deepEqual(picked.state.production.at(-1), {
    round: picked.state.round, revision: picked.state.revision, id: whistleId, quantity: 1,
    origin: 'prize', phase: 'prize', prizeId: 'special-readiness-training', worn: true, targetUid: piece.uid,
  });

  const pieces = [structuredClone(wearer)];
  const chessId = wearer.chessId;
  const h = makeBattle({
    units: [{ uid: wearer.uid, chessId, row: wearer.row, col: wearer.col, dir: wearer.dir }],
    defs: { chess: { [chessId]: chessRec({ id: chessId, rangeGrid: [[0, 0], [0, 1]], stats: { atk: 100, maxHp: 1000, def: 0, res: 0, aspd: 100, respawnTime: 20, blockCnt: 1 } }) },
      enemies: { walker: enemyRec({ key: 'walker', hp: 10000, def: 0, res: 0, speed: 1 }) } },
    autoFinish: false, content: 'independent', flags: { independent: { catalog, pieces } },
    extraContent: [(battle) => installIndependentBattle(battle, { catalog, state: { pieces } })],
  });
  h.step(1);
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  const operator = h.unit(wearer.uid); operator.atkCd = 1e9;
  const enemy = h.spawn('walker', { pos: [10, 4] });
  for (let i = 0; i < 11; i++) h.b.forceAttack(operator, [enemy]);
  assert.equal(enemy.s.flags.fear, undefined, 'the wearer has not yet reached the twelfth ordinary attack');
  h.b.forceAttack(operator, [enemy]);
  assert.ok(enemy.s.flags.fear, 'the prize-equipped whistle applies its real fear effect');
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
});

test('training revalidates a stale unique item and a full target without consuming the offer', () => {
  const first = fixture(2);
  const opened = openTraining(first.state, first.piece, whistleId);
  const index = opened.offer.choices.indexOf(whistleId);
  const target = opened.state.pieces.find((p) => p.uid === first.piece.uid);
  target.equipment.push({ uid: 'raced-unique', id: whistleId, quantity: 1, state: {} });
  const before = structuredClone(opened.state);
  const invalid = applyAction(opened.state, { type: 'choose', offerId: opened.offer.id, index });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.state, before, 'a stale duplicate leaves the whole session unchanged');

  const second = fixture(3);
  const opened2 = openTraining(second.state, second.piece, blastId);
  const blastIndex = opened2.offer.choices.indexOf(blastId);
  assert.notEqual(blastIndex, -1);
  const target2 = opened2.state.pieces.find((p) => p.uid === second.piece.uid);
  target2.equipment = [{ uid: 'full', id: 'precision', quantity: 999, state: {} }];
  const before2 = structuredClone(opened2.state);
  const full = applyAction(opened2.state, { type: 'choose', offerId: opened2.offer.id, index: blastIndex });
  assert.equal(full.ok, false);
  assert.deepEqual(full.state, before2, 'capacity failure does not consume the offer or mutate the target');
});

test('training prize requires a deployed legal target and technology-six meltdown stays locked below six', () => {
  const { state, piece } = fixture(2);
  assert.ok(!trainingChoiceOptions(state, catalog, piece).includes(meltdownId));
  assert.ok(!trainingChoiceOptions(state, catalog, piece).includes(blastId), 'shopTier 3 takes priority over the equipment level 2');
  state.shop.level = 5;
  assert.ok(trainingChoiceOptions(state, catalog, piece).includes(blastId));
  assert.ok(!trainingChoiceOptions(state, catalog, piece).includes(meltdownId));
  state.shop.level = 6;
  assert.ok(trainingChoiceOptions(state, catalog, piece).includes(meltdownId), 'portable meltdown training unlocks at shop level six');
  state.shop.level = 5;
  const bench = structuredClone(piece); bench.uid = 'bench'; bench.row = null; bench.col = null; state.pieces.push(bench);
  const before = structuredClone(state);
  const badTarget = applyAction(state, { type: 'choose', offerId: 'training-prize', index: 0, targetUid: 'bench' });
  assert.equal(badTarget.ok, false);
  assert.deepEqual(badTarget.state, before);
});

test('all fourteen configured supplementary items have a live direct-equip training source and clear table attribution', () => {
  const ids = catalog.config.trainingGearIds;
  assert.equal(ids.length, 14);
  assert.equal(new Set(ids).size, 14);
  for (const id of ids) {
    const item = catalog.equipment[id];
    assert.ok(item, `catalog includes ${id}`);
    assert.equal(item.available, true, `${id} remains obtainable`);
    assert.equal(item.retired, false, `${id} is not retired`);
    assert.equal(item.unassigned, false, `${id} has a real source`);
    assert.ok(item.shopTier || item.level, `${id} has a technology requirement`);
  }
  const table = cardTable('gear', catalog);
  for (const id of ids) assert.equal(table.rows.find((row) => row.id === id)?.from, '专项战备授训奖品：永久直接装备给指定干员', id);
  const prize = catalog.prizes['special-readiness-training'];
  assert.match(prize.effect, /已解锁装备/);
  assert.match(prize.effect, /直接永久穿戴/);
  assert.doesNotMatch(prize.effect, /chess_item|independent:|special-readiness-training|undefined/);
});

test('fixed-target training overflow records the prize, wearer, and lost item without putting it in stock', () => {
  const { state, piece } = fixture(3);
  piece.equipment = [{ uid: 'already-full', id: 'precision', quantity: 999, state: {} }];
  const result = grantEquipment(state, catalog, blastId, 1, { origin: 'prize', phase: 'prize', prizeId: 'special-readiness-training',
    targetUid: piece.uid, landOn: `uid:${piece.uid}` });
  assert.deepEqual(result, { id: blastId, quantity: 0, worn: piece.uid, lost: 1 });
  assert.equal(state.inventory.some((x) => x.id === blastId), false);
  assert.deepEqual(state.production.at(-1), { round: 1, revision: 1, id: blastId, quantity: 1,
    origin: 'prize', phase: 'prize', prizeId: 'special-readiness-training', lost: true, worn: true, targetUid: piece.uid });
});
