import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { getIndependentField } from '../../server/modes/independent/battle.js';
import { grantEquipment } from '../../server/modes/independent/equipment.js';
import { trainingChoiceOptions, drawTrainingChoices } from '../../shared/independentTrainingChoice.js';
import { makePrizeOffer } from '../../server/modes/independent/prizes.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { cardTable } from '../../tools/independent-card-table.mjs';

const catalog = getCatalog();
const whistleId = 'independent:叙拉古狼嚎哨';
const blastId = 'independent:爆破部署台';
const meltdownId = 'independent:便携式融毁教学仪';
const assaultId = 'independent:突袭盟约';
const recoilId = 'independent:反冲空降仓';

function fixture(level = 3, elite = false) {
  const state = createSession({ seed: 91, difficulty: 'FUNNY' });
  const op = Object.values(catalog.operators).find((x) => !x.elite && x.name === '普罗旺斯');
  const tile = [...getIndependentField(state).deployMap].find(([, cls]) => cls === 'MELEE' || cls === 'melee');
  assert.ok(op && tile);
  const [row, col] = tile[0].split(',').map(Number);
  const piece = { uid: `p${state.nextUid++}`, chessId: op.chessId, elite: false, row, col, dir: 'RIGHT', skillIndex: 0,
    moduleId: 'none', elite, equipment: [], attachments: [], nativeState: {}, bodyPenaltyApplied: false, poolCopies: 0 };
  state.pieces.push(piece);
  state.shop.level = level;
  state.phase = 'prize';
  state.offers = [];
  return { state, piece };
}

function seedRevealing(id, options) {
  for (let seed = 1; seed < 10000; seed++) if (drawTrainingChoices(options, seed, 3).choices.includes(id)) return seed;
  assert.fail(`deterministic training draw never revealed ${id}`);
}

function openTraining(state, piece, id) {
  const prizeOffer = { id: `legacy-training-${state.nextUid++}`, type: 'prize', choices: ['special-readiness-training'], tier: 'build' };
  state.offers = [prizeOffer];
  const index = prizeOffer.choices.indexOf('special-readiness-training');
  assert.notEqual(index, -1);
  state.rngState = seedRevealing(id, trainingChoiceOptions(state, catalog, piece));
  const result = applyAction(state, { type: 'choose', offerId: prizeOffer.id, index, targetUid: piece.uid });
  assert.equal(result.ok, true, result.error?.message);
  const offer = result.state.offers.find((x) => x.type === 'attachment');
  assert.ok(offer?.trainingChoice);
  assert.equal(offer.targetUid, piece.uid);
  return { state: result.state, offer, prizeOffer };
}

test('current build-stage draws exclude the retired training card while existing prize offers remain resolvable', () => {
  for (let seed = 1; seed <= 32; seed++) {
    const { state } = fixture(3);
    state.rngState = seed;
    const generated = makePrizeOffer(state, catalog, 'build', 'current-draw-regression');
    assert.ok(!generated.choices.includes('special-readiness-training'), `seed ${seed}`);
  }
  const legacy = fixture(3);
  const opened = openTraining(legacy.state, legacy.piece, whistleId);
  assert.equal(opened.prizeOffer.choices[0], 'special-readiness-training');
  assert.ok(opened.offer.trainingChoice, 'the compatible existing offer still opens direct training choices');
});

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

test('training prize causally equips assault oath and recoil airdrop for normal and golden operators', () => {
  for (const id of [assaultId, recoilId]) for (const elite of [false, true]) {
    const level = id === recoilId ? 6 : 2;
    const { state, piece } = fixture(level, elite);
    const opened = openTraining(state, piece, id);
    const index = opened.offer.choices.indexOf(id);
    assert.notEqual(index, -1, id + ' is discovered for ' + (elite ? 'golden' : 'normal') + ' operator');
    const picked = applyAction(opened.state, { type: 'choose', offerId: opened.offer.id, index });
    assert.equal(picked.ok, true, picked.error?.message);
    const wearer = picked.state.pieces.find((p) => p.uid === piece.uid);
    assert.equal(wearer.elite, elite);
    assert.equal(wearer.equipment.filter((x) => x.id === id).reduce((n, x) => n + x.quantity, 0), 1);
    assert.equal(picked.state.inventory.some((x) => x.id === id), false);
    assert.deepEqual(picked.state.production.at(-1), { round: picked.state.round, revision: picked.state.revision, id, quantity: 1,
      origin: 'prize', phase: 'prize', prizeId: 'special-readiness-training', worn: true, targetUid: wearer.uid });

    const pieces = [structuredClone(wearer)];
    const chessId = wearer.chessId;
    const h = makeBattle({
      units: [{ uid: wearer.uid, chessId, row: wearer.row, col: wearer.col, dir: wearer.dir }],
      defs: { chess: { [chessId]: chessRec({ id: chessId, rangeGrid: [[0, 0], [0, 1]], stats: { atk: 100, maxHp: 1000, def: 0, res: 0, aspd: 100, respawnTime: 20, blockCnt: 1 } }) },
        enemies: { dummy: enemyRec({ key: 'dummy', hp: 40000, def: 0, res: 0, speed: 0 }) } },
      autoFinish: false, content: 'independent', flags: { independent: { catalog, pieces } },
      extraContent: [(battle) => installIndependentBattle(battle, { catalog, state: picked.state })],
    });
    h.step(1);
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
    const unit = h.unit(wearer.uid);
    if (id === assaultId) {
      const target = h.spawn('dummy', { pos: [10, 10] });
      unit.atkCd = 1e9;
      const deploys = unit.deploySeq;
      assert.ok(unit.findBuff('independent:keywordGear:assault-oath:' + unit.uid + ':aspd'), 'gear gives its attack-speed effect on deployment');
      h.run(9.8);
      assert.equal(unit.deploySeq, deploys, 'the target-seeking redeploy waits for ten seconds without an ordinary attack');
      h.run(0.5);
      assert.ok(unit.deploySeq > deploys, 'after ten seconds it performs the real legal raid redeploy');
      assert.ok(unit.findBuff('independent:keywordGear:assault-oath:' + unit.uid + ':aspd'), 'the redeploy refreshes the attack-speed effect');
      assert.ok(target.alive);
    } else {
      const target = h.spawn('dummy', { pos: [10, 10] });
      const before = target.hp;
      h.b.rng = () => 0;
      h.b.retreat(unit, { reason: 'gear-causal-redeploy' });
      h.b.redeploy(unit, { free: true });
      assert.ok(before - target.hp >= 15000, 'the real redeploy event fires the airdrop against its occupied tile');
      assert.ok(h.eventsOf('keywordGearRandomTile').length > 0, 'battle records the airdrop target tile');
    }
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  }
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

test('all sixteen configured supplementary items have a live direct-equip training source and clear table attribution', () => {
  const ids = catalog.config.trainingGearIds;
  assert.equal(ids.length, 16);
  assert.equal(new Set(ids).size, 16);
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
  assert.match(prize.effect, /已解锁.*装备/);
  assert.match(prize.effect, /装备直接穿戴在该干员身上/);
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
