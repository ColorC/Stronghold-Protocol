import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { applyAction, createSession, viewSession } from '../../server/modes/independent/session.js';
import { canDrop, dropRefusal, pieceNum } from '../../public/js/independent/model.js';

const data = getData({ log: { info() {}, warn() {}, error() {} } });
const catalog = getCatalog(data);
const view = (state) => viewSession(state, { data, catalog });
const tileFor = (state, uid) => {
  const p = view(state).pieces.find((x) => x.uid === uid);
  assert.ok(p, `view contains ${uid}`);
  const [row, col] = p.legalTiles[0].split(',').map(Number);
  return { area: 'board', row, col };
};
const buySlot = (state, except = -1) => state.shop.slots.findIndex((s, i) => i !== except && s.kind === 'chess' && !s.sold);

test('deployment cap blocks only adding another operator to the board, with immediate UI feedback', () => {
  let state = createSession({ data, seed: 127, difficulty: 'NORMAL' });
  state.deployCap = 1;
  state.funds = 30;

  const firstSlot = buySlot(state);
  assert.notEqual(firstSlot, -1);
  let result = applyAction(state, { type: 'buy', slot: firstSlot }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  state = result.state;
  const firstUid = state.pieces[0].uid;

  // Buying and keeping a second card on the bench remains legal when the board is full or capped.
  const secondSlot = buySlot(state, firstSlot);
  assert.notEqual(secondSlot, -1);
  result = applyAction(state, { type: 'buy', slot: secondSlot }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  state = result.state;
  const secondUid = state.pieces.find((p) => p.uid !== firstUid).uid;
  const secondN = pieceNum(secondUid);

  const firstTile = tileFor(state, firstUid);
  result = applyAction(state, { type: 'move', uid: firstUid, row: firstTile.row, col: firstTile.col }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  state = result.state;
  const fullView = view(state);
  assert.equal(fullView.pieces.filter((p) => p.row != null && p.col != null).length, 1);
  const thirdSlot = buySlot(state);
  assert.notEqual(thirdSlot, -1, 'shop keeps an unsold offer while the board is capped');
  result = applyAction(state, { type: 'buy', slot: thirdSlot }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  state = result.state;
  const thirdUid = state.pieces.find((p) => p.uid !== firstUid && p.uid !== secondUid).uid;
  assert.equal(view(state).pieces.find((p) => p.uid === thirdUid).row, null, 'the purchased operator stays on the bench');
  const cappedView = view(state);
  const secondTile = tileFor(state, secondUid);
  assert.equal(canDrop(cappedView, secondN, secondTile), false, 'renderer must not open the facing wheel for a capped deployment');
  assert.match(dropRefusal(cappedView, secondN, secondTile), /最多 1 名干员/);
  result = applyAction(state, { type: 'move', uid: secondUid, row: secondTile.row, col: secondTile.col }, { data, catalog });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DEPLOY_CAP');
  assert.equal(result.state.pieces.filter((p) => p.row != null && p.col != null).length, 1, 'failed move leaves the live roster intact');

  // Repositioning an existing operator does not consume another slot.
  const firstLegal = view(result.state).pieces.find((p) => p.uid === firstUid).legalTiles;
  const candidate = firstLegal.map((s) => s.split(',').map(Number)).find(([r, c]) => r !== firstTile.row || c !== firstTile.col);
  assert.ok(candidate, 'fixture has another legal tile for the deployed operator');
  const moved = applyAction(result.state, { type: 'move', uid: firstUid, row: candidate[0], col: candidate[1] }, { data, catalog });
  assert.equal(moved.ok, true, moved.error?.message);
  assert.equal(moved.state.pieces.filter((p) => p.row != null && p.col != null).length, 1);

  const benched = applyAction(moved.state, { type: 'bench', uid: firstUid }, { data, catalog });
  assert.equal(benched.ok, true, benched.error?.message);
  const nowFree = tileFor(benched.state, secondUid);
  assert.equal(canDrop(view(benched.state), secondN, nowFree), true, 'benching frees the operator deployment slot');
  const deployed = applyAction(benched.state, { type: 'move', uid: secondUid, row: nowFree.row, col: nowFree.col }, { data, catalog });
  assert.equal(deployed.ok, true, deployed.error?.message);
});

test('native token markers do not count as deployed operators in the client cap guard', () => {
  const operator = { uid: 'p8', row: null, col: null, legalTiles: ['9,7', '9,9'] };
  const candidate = { uid: 'p9', row: null, col: null, legalTiles: ['9,9'] };
  const summon = { uid: 't10', kind: 'token', row: 9, col: 8, legalTiles: ['9,9'] };
  const state = { phase: 'prep', deployCap: 1, pieces: [operator, summon, candidate], summons: [summon] };
  assert.equal(canDrop(state, 9, { area: 'board', row: 9, col: 9 }), true, 'a token on the board does not occupy an operator deployment slot');
});

test('a legacy save over the current cap stays readable and can be recovered by benching an operator', () => {
  let state = createSession({ data, seed: 128, difficulty: 'NORMAL' });
  state.funds = 30;
  const firstSlot = buySlot(state);
  let result = applyAction(state, { type: 'buy', slot: firstSlot }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  state = result.state;
  const firstUid = state.pieces[0].uid;
  const secondSlot = buySlot(state, firstSlot);
  result = applyAction(state, { type: 'buy', slot: secondSlot }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  state = result.state;
  const secondUid = state.pieces.find((p) => p.uid !== firstUid).uid;
  for (const uid of [firstUid, secondUid]) {
    const tile = tileFor(state, uid);
    result = applyAction(state, { type: 'move', uid, row: tile.row, col: tile.col }, { data, catalog });
    assert.equal(result.ok, true, result.error?.message);
    state = result.state;
  }
  state.deployCap = 1; // represents a persisted lineup made under an older/larger rule
  assert.equal(view(state).pieces.filter((p) => p.row != null && p.col != null).length, 2, 'old lineup remains visible');
  const recovered = applyAction(state, { type: 'bench', uid: secondUid }, { data, catalog });
  assert.equal(recovered.ok, true, recovered.error?.message);
  assert.equal(recovered.state.pieces.filter((p) => p.row != null && p.col != null).length, 1);
});
