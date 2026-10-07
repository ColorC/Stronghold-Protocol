// 干员特质 v4 (2026-10-07, 方舟化): the prep rules of the current table — the original's 身前一格 copies (白面鸮 进入休整期时,
// 塞雷娅 休整期结束时, 铃兰 获得时, 泥岩 售出时), badges for each of two operators, per refresh and per operator gained — and the
// tier counts. The battle behaviors are in temporary-traits.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runNativeHook } from '../../server/modes/independent/native.js';
import { preV4Catalog } from './helpers/preV4.js';

const catalog = getCatalog();
const idOf = (name, elite = false) => {
  const op = Object.values(catalog.operators).find((x) => !x.elite && x.name === name);
  return elite ? op.eliteChessId : op.chessId;
};
function fixture(useCatalog = catalog) {
  const state = { round: 1, shop: { level: 3, freeRefreshes: 0, slots: [] }, pieces: [], counters: { gained: 0, spent: 0, refreshes: 0, paidRefreshes: 0 }, pendingFunds: 0, nextUid: 100, inventory: [], playerEffects: [], totals: {} };
  const granted = [];
  const services = {
    catalog: useCatalog, data: {}, rng: () => 0.25,
    grantEquipment(_state, id, quantity, extra) { granted.push({ id, quantity, ...extra }); },
    grantChess() {}, addOffer() {}, record() {}, recordProduction() {},
  };
  return { state, services, granted };
}
const piece = (uid, name, row = null, col = null, elite = false) => ({ uid, chessId: idOf(name, elite), elite, row, col, dir: 'RIGHT', nativeState: {}, equipment: [], attachments: [] });
const sum = (granted, id, filter = () => true) => granted.filter((x) => x.id === id && filter(x)).reduce((n, x) => n + x.quantity, 0);

test('the fixed active roster follows the approved tier distribution', () => {
  const counts = {};
  for (const op of Object.values(catalog.operators).filter((x) => !x.elite && x.recruitable)) counts[op.tier] = (counts[op.tier] || 0) + 1;
  assert.deepEqual(counts, { 1: 13, 2: 19, 3: 20, 4: 18, 5: 18, 6: 13 });
});

test('白面鸮 has the 进入休整期时 trait of the operator in front (精锐: its elite numbers); nothing in front, nothing', () => {
  for (const [elite, want] of [[false, 1 + 1], [true, 1 + 2]]) {
    const { state, services } = fixture();
    state.pieces.push(piece('owl', '白面鸮', 1, 1, elite), piece('tex', '缄默德克萨斯', 1, 2));
    runNativeHook(state, 'roundStart', { round: 1 }, services);
    assert.equal(state.shop.freeRefreshes, want, `elite ${elite}`);
  }
  const { state, services } = fixture();
  state.pieces.push(piece('owl', '白面鸮', 1, 1), piece('tex', '缄默德克萨斯', 2, 2));
  runNativeHook(state, 'roundStart', { round: 1 }, services);
  assert.equal(state.shop.freeRefreshes, 1, 'only 缄默德克萨斯 itself');
});

test('塞雷娅 has the 休整期结束时 trait of the operator in front; copiers are never copied', () => {
  const { state, services, granted } = fixture();
  state.pieces.push(piece('sar', '塞雷娅', 1, 1), piece('zy', '折桠', 1, 2));
  runNativeHook(state, 'prepEnd', { round: 1 }, services);
  assert.equal(sum(granted, 'assault', (x) => x.sourceUid === 'sar'), 1, 'its own copy of 折桠\'s badge');
  assert.equal(sum(granted, 'assault', (x) => x.sourceUid === 'zy'), 1);
  const two = fixture();
  two.state.pieces.push(piece('sar', '塞雷娅', 1, 1), piece('sar2', '塞雷娅', 1, 2), piece('zy', '折桠', 1, 3));
  runNativeHook(two.state, 'prepEnd', { round: 1 }, two.services);
  assert.equal(sum(two.granted, 'assault', (x) => x.sourceUid === 'sar'), 0, 'a 塞雷娅 in front is not copied');
});

test('铃兰 triggers one 获得时 trait of the operator in front when the prep phase begins (精锐: two operators deep)', () => {
  for (const [elite, want] of [[false, 1], [true, 2]]) {
    const { state, services, granted } = fixture();
    state.pieces.push(piece('lily', '铃兰', 1, 1, elite), piece('jy', '耶拉', 1, 2), piece('cr', '卡涅利安', 1, 3));
    runNativeHook(state, 'roundStart', { round: 1 }, services);
    const gear = granted.filter((x) => x.sourceUid === 'lily').length;
    assert.equal(gear, want, `elite ${elite}`);
  }
});

test('泥岩 sold: its own funds and the 售出时 trait of the operator in front', () => {
  // Generic sold-hook regression uses its pre-v4 rule fixture; 泥岩 no longer owns this mode effect.
  const { state, services } = fixture(preV4Catalog(catalog));
  const mud = piece('mud', '泥岩', 1, 1); const grey = piece('grey', '格雷伊', 1, 2);
  state.pieces.push(grey);
  runNativeHook(state, 'sold', { piece: mud }, services);
  assert.equal(state.pendingFunds, 2 + 1);
});

test('引星棘刺: itself and the operator in front each wear one; 安洁莉娜: the one in front, per refresh, capped; 山: per operator gained', () => {
  const a = fixture();
  a.state.pieces.push(piece('thorn', '引星棘刺', 1, 1), piece('f', '耶拉', 1, 2));
  runNativeHook(a.state, 'prepEnd', { round: 1 }, a.services);
  assert.deepEqual(a.granted.filter((x) => x.id === 'agility').map((x) => [x.quantity, x.landOn]).sort(), [[1, 'front'], [1, 'self']]);
  const b = fixture();
  b.state.counters.refreshes = 5;
  b.state.pieces.push(piece('ang', '安洁莉娜', 1, 1), piece('f', '耶拉', 1, 2));
  runNativeHook(b.state, 'prepEnd', { round: 1 }, b.services);
  assert.deepEqual(b.granted.filter((x) => x.id === 'agility').map((x) => [x.quantity, x.landOn]), [[3, 'front']]);
  const c = fixture();
  c.state.counters.gained = 6;
  c.state.pieces.push(piece('shan', '山', 1, 1));
  runNativeHook(c.state, 'prepEnd', { round: 1 }, c.services);
  assert.equal(sum(c.granted, 'mastery'), 4, '至多4枚');
});

test('native recruits read a session pool ({ id: { cap, left, tier } }): 歌蕾蒂娅 only picks operators with copies left', () => {
  const { state, services } = fixture();
  const got = [];
  services.grantChess = (_s, id) => got.push(id);
  const [skadi, specter, deep] = ['斯卡蒂', '幽灵鲨', '深巡'].map((n) => idOf(n));
  state.pool = { [skadi]: { cap: 15, left: 0, tier: 1 }, [specter]: { cap: 15, left: 3, tier: 2 }, [deep]: { cap: 13, left: 0, tier: 3 } };
  state.pieces.push(piece('gl', '歌蕾蒂娅', 1, 1), piece('x', '耶拉', 1, 2), piece('y', '卡涅利安', 1, 3));
  runNativeHook(state, 'roundStart', { round: 1 }, services);
  assert.deepEqual(got, [specter]);
});
