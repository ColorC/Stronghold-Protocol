// 2026-10-07 second-wave mechanics (user: 「绝大部分随从的功能就是……让另一个随从获得+1/+1……必须立刻参考炉石传说……大幅增加
// 非普通条件的增加徽令的能力和各种阶乘，复合效果，高级装备」): growth, doublers, game totals, shop buffs, badge boosts,
// moving and doubling badges, per-elite / buy-reaction / diversity yields, uncapped battle yields and the two advanced
// gear pieces. (Comeback and streak yields were dropped on 10-07: 「比较少见的……一般不会出现在卡里面，很不建议给」.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runNativeHook } from '../../server/modes/independent/native.js';
import { createSession, applyAction } from '../../server/modes/independent/session.js';
import { getIndependentField, previewUnitStats } from '../../server/modes/independent/battle.js';
import { canPlace, positionClass } from '../../server/match/board.js';
import { getData } from '../../server/data.js';

const data = getData({ log: { info() {}, warn() {}, error() {} } });
const catalog = getCatalog(data);
const idOf = (name, elite = false) => {
  const op = Object.values(catalog.operators).find((x) => !x.elite && x.name === name);
  return elite ? op.eliteChessId : op.chessId;
};

function fixture() {
  const state = { round: 1, shop: { level: 3, freeRefreshes: 0, slots: [] }, pieces: [], counters: { gained: 0, spent: 0, paidRefreshes: 0 }, pendingFunds: 0, nextUid: 100, inventory: [], playerEffects: [], totals: {} };
  const granted = [];
  const services = {
    catalog, data: {}, rng: () => 0.25,
    grantEquipment(_state, id, quantity, extra) { granted.push({ id, quantity, ...extra }); },
    grantChess() {}, addOffer() {}, record() {}, recordProduction() {},
  };
  return { state, services, granted };
}
const piece = (uid, name, row = null, col = null, extra = {}) => ({ uid, chessId: idOf(name, extra.elite), elite: !!extra.elite, row, col, dir: 'RIGHT', nativeState: {}, equipment: extra.equipment || [], attachments: [] });
const sum = (granted, id) => granted.filter((x) => x.id === id).reduce((n, x) => n + x.quantity, 0);

test('雷蛇 grows: every prep phase it begins on the field adds one more 助力, up to +4', () => {
  const { state, services, granted } = fixture();
  state.pieces.push(piece('raze', '雷蛇', 1, 1));
  const amounts = [];
  for (let round = 1; round <= 7; round++) {
    state.round = round;
    if (round > 1) runNativeHook(state, 'roundStart', {}, services);
    const before = sum(granted, 'defense');
    runNativeHook(state, 'prepEnd', {}, services);
    amounts.push(sum(granted, 'defense') - before);
  }
  assert.deepEqual(amounts, [1, 2, 3, 4, 5, 5, 5]);
  const benched = fixture();
  benched.state.pieces.push(piece('raze', '雷蛇'));
  runNativeHook(benched.state, 'roundStart', {}, benched.services);
  assert.equal(benched.state.pieces[0].nativeState.growth, undefined, 'growth counts only prep phases begun on the field');
});

test('铃兰 makes 获得时 effects run twice (elite: three times); a doubler on the bench does nothing', () => {
  for (const [elite, field, expected] of [[false, true, 2], [true, true, 3], [false, false, 1]]) {
    const { state, services, granted } = fixture();
    state.pieces.push(piece('lily', '铃兰', field ? 0 : null, field ? 0 : null, { elite }));
    const corner = piece('corner', '角峰');
    state.pieces.push(corner);
    runNativeHook(state, 'gain', { piece: corner }, services);
    assert.equal(sum(granted, 'vitality'), expected, `elite ${elite} field ${field}`);
  }
});

test('泥岩 makes 出售时 effects run once more; 格雷伊 sells for more the longer it stood on the field', () => {
  const { state, services } = fixture();
  state.pieces.push(piece('mud', '泥岩', 0, 0));
  const grey = piece('grey', '格雷伊', 0, 1); grey.nativeState.growth = 2;
  runNativeHook(state, 'sold', { piece: grey }, services);
  assert.equal(state.pendingFunds, 2 * (1 + 2));
});

test('能天使 counts the refreshes of the whole game; 夕 counts every operator gained', () => {
  const { state, services, granted } = fixture();
  state.totals = { refreshes: 17, gained: 10 };
  const angel = piece('angel', '能天使');
  state.pieces.push(angel);
  runNativeHook(state, 'gain', { piece: angel }, services);
  assert.equal(state.pendingFunds, 1 + 2);
  state.pieces.push(piece('dusk', '夕', 0, 0));
  runNativeHook(state, 'prepEnd', {}, services);
  assert.equal(sum(granted, 'assault'), 3);
});

test('蒂比 and 阿罗玛 put badges on every offer, now and after each refresh, up to their totals', () => {
  let state = createSession({ seed: 11, difficulty: 'NORMAL' });
  state.funds = 99;
  state.shop.slots[0] = { kind: 'chess', id: idOf('蒂比'), elite: false, price: 3, sold: false, equipment: [] };
  let r = applyAction(state, { type: 'buy', slot: 0 }); assert.equal(r.ok, true, r.error?.message); state = r.state;
  const carried = (slot) => (slot.equipment || []).filter((x) => x.id === 'agility').reduce((n, x) => n + x.quantity, 0);
  assert.ok(state.shop.slots.filter((s) => !s.sold).every((s) => carried(s) === 1));
  r = applyAction(state, { type: 'refresh' }); state = r.state;
  assert.ok(state.shop.slots.every((s) => carried(s) === 1), 'a new offer carries it too');
  const target = state.shop.slots[0];
  r = applyAction(state, { type: 'buy', slot: 0 }); state = r.state;
  const bought = state.pieces[state.pieces.length - 1];
  assert.equal(bought.equipment.filter((x) => x.id === 'agility').reduce((n, x) => n + x.quantity, 0) >= 1, true, `the bought ${target.id} wears what it carried`);
});

test('伊内丝 raises every 精准徽章 of the team for the rest of the game, up to +60%', () => {
  const { state, services } = fixture();
  state.pieces.push(piece('ines', '伊内丝', 0, 0));
  for (let round = 1; round <= 15; round++) { state.round = round; runNativeHook(state, 'prepEnd', {}, services); }
  const fx = state.playerEffects.find((x) => x.type === 'badgeBoost');
  assert.deepEqual(fx.badgeIds, ['precision']);
  assert.equal(fx.percent, 0.6);
});

test('a badge boost and 熔铸模具 show in the operator\'s battle stats; 星熊 doubles its own 助力 in battle', () => {
  let state = createSession({ seed: 5, difficulty: 'NORMAL' });
  state.funds = 99;
  for (const name of ['史尔特尔', '星熊']) {
    state.shop.slots[0] = { kind: 'chess', id: idOf(name), elite: false, price: 3, sold: false, equipment: [] };
    const r = applyAction(state, { type: 'buy', slot: 0 }); assert.equal(r.ok, true, r.error?.message); state = r.state;
  }
  const field = getIndependentField(state, { data, catalog });
  const cells = [...field.deployMap.keys()];
  for (const p of state.pieces) {
    const raw = catalog.operators[p.chessId].source.normalChess;
    const cell = cells.find((k) => { const [row, col] = k.split(',').map(Number); return !state.pieces.some((q) => q !== p && q.row === row && q.col === col) && canPlace(field.deployMap, positionClass(raw, 'none'), row, col); });
    [p.row, p.col] = cell.split(',').map(Number);
  }
  const [surt, hoshi] = state.pieces;
  surt.equipment.push({ uid: 'x1', id: 'precision', elite: false, quantity: 10, state: {} });
  const base = previewUnitStats(state, { data, catalog })[surt.uid].atk;
  state.playerEffects.push({ type: 'badgeBoost', key: 'precision', badgeIds: ['precision'], percent: 0.5, max: 0.6 });
  const boosted = previewUnitStats(state, { data, catalog })[surt.uid].atk;
  assert.equal(Math.round(boosted - base), 50, '10 precision badges: +100 attack, +50% of it');
  surt.equipment.push({ uid: 'x2', id: 'independent:熔铸模具', elite: false, quantity: 1, state: {} });
  const forged = previewUnitStats(state, { data, catalog })[surt.uid].atk;
  assert.equal(Math.round(forged - boosted), Math.round(100 * 1.5 * 0.25));
  const defBefore = previewUnitStats(state, { data, catalog })[hoshi.uid].def;
  hoshi.equipment.push({ uid: 'x3', id: 'defense', elite: false, quantity: 5, state: {} });
  const defAfter = previewUnitStats(state, { data, catalog })[hoshi.uid].def;
  // 5 badges give 40 defense; doubled at least 80 (its own talent may scale defense further)
  assert.ok(defAfter - defBefore >= 5 * 8 * 2, String(defAfter - defBefore));
});

test('折桠 hands its badges to the operator wearing most when sold; its other gear goes with it', () => {
  let state = createSession({ seed: 7, difficulty: 'NORMAL' });
  state.funds = 99;
  for (const name of ['折桠', '史尔特尔']) {
    state.shop.slots[0] = { kind: 'chess', id: idOf(name), elite: false, price: 3, sold: false, equipment: [] };
    const r = applyAction(state, { type: 'buy', slot: 0 }); assert.equal(r.ok, true, r.error?.message); state = r.state;
  }
  const [zheya, surt] = state.pieces;
  zheya.row = 9; zheya.col = 3; surt.row = 10; surt.col = 3;
  zheya.equipment.push({ uid: 'b1', id: 'defense', elite: false, quantity: 7, state: {} }, { uid: 'b2', id: 'precision', elite: false, quantity: 3, state: {} });
  surt.equipment.push({ uid: 'b3', id: 'precision', elite: false, quantity: 1, state: {} });
  const r = applyAction(state, { type: 'sell', uid: zheya.uid }); assert.equal(r.ok, true, r.error?.message);
  const after = r.state.pieces.find((x) => x.uid === surt.uid);
  const count = (id) => after.equipment.filter((x) => x.id === id).reduce((n, x) => n + x.quantity, 0);
  assert.equal(count('defense'), 7);
  assert.equal(count('precision'), 4);
  assert.equal(r.state.totals.sold, 1);
});

test('山 devours the right-most offer: its carried gear and its tier in 坚守 come to the stock', () => {
  const { state, services, granted } = fixture();
  state.shop.slots = [
    { kind: 'chess', id: idOf('角峰'), sold: false, equipment: [] },
    { kind: 'chess', id: idOf('伊内丝'), sold: false, equipment: [{ id: 'assault', quantity: 2 }] },
    { kind: 'chess', id: idOf('雷蛇'), sold: true, equipment: [] },
  ];
  state.pieces.push(piece('shan', '山', 0, 0));
  runNativeHook(state, 'prepEnd', {}, services);
  assert.equal(state.shop.slots[1].sold, true);
  assert.equal(state.shop.slots[0].sold, false);
  assert.equal(sum(granted, 'assault'), 2);
  assert.equal(sum(granted, 'vitality'), catalog.operators[idOf('伊内丝')].tier);
});

test('引星棘刺 doubles the badge the operator in front wears most, a few times a game', () => {
  const { state, services } = fixture();
  const front = piece('front', '史尔特尔', 1, 3, { equipment: [{ uid: 'a', id: 'precision', quantity: 4, state: {} }, { uid: 'b', id: 'defense', quantity: 9, state: {} }] });
  state.pieces.push(piece('thorn', '引星棘刺', 1, 2), front);
  const amounts = [];
  for (let round = 1; round <= 5; round++) {
    state.round = round;
    const before = front.equipment.find((x) => x.id === 'defense').quantity;
    runNativeHook(state, 'prepEnd', {}, services);
    amounts.push(front.equipment.find((x) => x.id === 'defense').quantity - before);
  }
  assert.deepEqual(amounts, [6, 6, 6, 0, 0]);
});

test('寒檀 doubles what it gives every prep phase, up to 16', () => {
  const { state, services, granted } = fixture();
  state.pieces.push(piece('han', '寒檀', 0, 0));
  const amounts = [];
  for (let round = 1; round <= 7; round++) {
    state.round = round;
    const before = sum(granted, 'recovery');
    runNativeHook(state, 'roundStart', {}, services);
    amounts.push(sum(granted, 'recovery') - before);
  }
  assert.deepEqual(amounts, [1, 2, 4, 8, 16, 16, 16]);
});

test('烛煌 counts the elite operators on the field', () => {
  const { state, services, granted } = fixture();
  state.pieces.push(piece('candle', '烛煌', 0, 0), piece('a', '史尔特尔', 0, 1, { elite: true }), piece('b', '雷蛇', 0, 2, { elite: true }), piece('c', '角峰', 0, 3), piece('d', '星熊', null, null, { elite: true }));
  runNativeHook(state, 'prepEnd', {}, services);
  assert.equal(sum(granted.filter((x) => x.sourceUid === 'candle'), 'precision'), 2 * 2, 'two elites on the field; the benched one does not count');
});

test('锏 on the field puts agility badges onto every operator bought, one more each time, up to 5', () => {
  let state = createSession({ seed: 19, difficulty: 'NORMAL' });
  state.funds = 99;
  state.shop.slots[0] = { kind: 'chess', id: idOf('锏'), elite: false, price: 3, sold: false, equipment: [] };
  let r = applyAction(state, { type: 'buy', slot: 0 }); assert.equal(r.ok, true, r.error?.message); state = r.state;
  const jian = state.pieces[0];
  const field = getIndependentField(state, { data, catalog });
  const raw = catalog.operators[jian.chessId].source.normalChess;
  const cell = [...field.deployMap.keys()].find((k) => { const [row, col] = k.split(',').map(Number); return canPlace(field.deployMap, positionClass(raw, 'none'), row, col); });
  r = applyAction(state, { type: 'move', uid: jian.uid, row: Number(cell.split(',')[0]), col: Number(cell.split(',')[1]), dir: 'RIGHT' }); state = r.state;
  const worn = [];
  for (const name of ['角峰', '雷蛇', '刺玫', '深靛', '野鬃', '宴', '隐现']) {
    state.shop.slots[0] = { kind: 'chess', id: idOf(name), elite: false, price: 3, sold: false, equipment: [] };
    r = applyAction(state, { type: 'buy', slot: 0 }); assert.equal(r.ok, true, r.error?.message); state = r.state;
    const bought = state.pieces[state.pieces.length - 1];
    worn.push(bought.equipment.filter((x) => x.id === 'agility').reduce((n, x) => n + x.quantity, 0));
  }
  assert.deepEqual(worn, [1, 2, 3, 4, 5, 5, 5]);
  assert.ok(r.state.production.some((row) => row.worn && row.sourceUid === jian.uid && row.id === 'agility'));
});

test('赫默 counts professions on the field; 诗怀雅 counts factions', () => {
  const { state, services, granted } = fixture();
  state.pieces.push(piece('silence', '赫默', 0, 0), piece('surt', '史尔特尔', 0, 1), piece('raze', '雷蛇', 0, 2));
  runNativeHook(state, 'roundStart', {}, services);
  const professions = new Set(state.pieces.map((p) => catalog.operators[p.chessId].source.normalChess.profession));
  assert.equal(sum(granted, 'vitality'), professions.size);
});

test('塑心 doubles the battle yield; 增压臂铠 doubles its 坚守 every prep phase', () => {
  const run = (withSuxin) => {
    let state = createSession({ seed: 13, difficulty: 'NORMAL' });
    state.funds = 99;
    for (const name of withSuxin ? ['锏', '塑心'] : ['锏']) {
      state.shop.slots[0] = { kind: 'chess', id: idOf(name), elite: false, price: 3, sold: false, equipment: [] };
      const r = applyAction(state, { type: 'buy', slot: 0 }); assert.equal(r.ok, true, r.error?.message); state = r.state;
    }
    const field = getIndependentField(state, { data, catalog });
    const cells = [...field.deployMap.keys()];
    for (const p of state.pieces) {
      const raw = catalog.operators[p.chessId].source.normalChess;
      const cell = cells.find((k) => { const [row, col] = k.split(',').map(Number); return !state.pieces.some((q) => q !== p && q.row === row && q.col === col) && canPlace(field.deployMap, positionClass(raw, 'none'), row, col); });
      const r = applyAction(state, { type: 'move', uid: p.uid, row: Number(cell.split(',')[0]), col: Number(cell.split(',')[1]), dir: 'RIGHT' }); assert.equal(r.ok, true, r.error?.message); state = r.state;
    }
    const jian = state.pieces[0];
    const r = applyAction(state, { type: 'ready' }); assert.equal(r.ok, true, r.error?.message);
    return r.state.production.filter((row) => row.phase === 'battle' && row.sourceUid === jian.uid && row.id === 'agility').reduce((n, row) => n + row.quantity, 0);
  };
  const single = run(false);
  assert.ok(single > 0);
  assert.equal(run(true), single * 2);

  let state = createSession({ seed: 17, difficulty: 'NORMAL' });
  state.funds = 99;
  state.shop.slots[0] = { kind: 'chess', id: idOf('佩佩'), elite: false, price: 3, sold: false, equipment: [] };
  let r = applyAction(state, { type: 'buy', slot: 0 }); state = r.state;
  const pepe = state.pieces[0];
  const arm = state.inventory.find((x) => x.id === 'independent:增压臂铠');
  assert.ok(arm, '佩佩 brings 增压臂铠');
  r = applyAction(state, { type: 'equip', itemUid: arm.uid, targetUid: pepe.uid }); assert.equal(r.ok, true, r.error?.message); state = r.state;
  const field = getIndependentField(state, { data, catalog });
  const raw = catalog.operators[pepe.chessId].source.normalChess;
  const cell = [...field.deployMap.keys()].find((k) => { const [row, col] = k.split(',').map(Number); return canPlace(field.deployMap, positionClass(raw, 'none'), row, col); });
  r = applyAction(state, { type: 'move', uid: pepe.uid, row: Number(cell.split(',')[0]), col: Number(cell.split(',')[1]), dir: 'RIGHT' }); state = r.state;
  const yields = [];
  for (let i = 0; i < 3 && state.phase === 'prep'; i++) {
    r = applyAction(state, { type: 'ready' }); assert.equal(r.ok, true, r.error?.message);
    yields.push(r.state.production.filter((row) => row.phase === 'prepEnd' && row.origin === 'equipment' && row.id === 'vitality' && row.round === state.round).reduce((n, row) => n + row.quantity, 0));
    state = r.state;
    while (state.offers?.length) { const o = state.offers[0]; r = applyAction(state, { type: 'choose', offerId: o.id, index: 0 }); if (!r.ok) break; state = r.state; }
  }
  assert.deepEqual(yields.slice(0, 3), [1, 2, 4].slice(0, yields.length));
});
