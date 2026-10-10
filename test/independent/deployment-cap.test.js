import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { applyAction, createSession, viewSession } from '../../server/modes/independent/session.js';
import { canDrop, dropRefusal, legalTilesOf, pieceNum, deployedSlots } from '../../public/js/independent/model.js';
import { countDeploymentSlots, deploymentSlots } from '../../shared/independentRules.js';

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
  state.pieces.find((p) => p.uid === secondUid).deploymentSlots = 0; // an untrusted persisted projection must not bypass server cap
  const cappedView = view(state);
  assert.equal(cappedView.pieces.find((p) => p.uid === secondUid).deploymentSlots, 1, 'server derives ordinary operator slots from catalog');
  const secondTile = tileFor(state, secondUid);
  assert.equal(canDrop(cappedView, secondN, secondTile), false, 'renderer must not open the facing wheel for a capped deployment');
  assert.match(dropRefusal(cappedView, secondN, secondTile), /最多 1 名干员/);
  assert.match(dropRefusal(cappedView, secondN, { row: secondTile.row, col: secondTile.col }), /最多 1 名干员/, 'a renderer tile without area metadata still gets the cap message');
  assert.deepEqual(legalTilesOf(cappedView, secondN), [], 'drag preview must not highlight tiles that cap validation will reject');
  assert.match(dropRefusal(cappedView, secondN, { row: secondTile.row, col: 99 }), /无法部署在该位置/, 'non-legal field coordinates retain the terrain refusal');
  result = applyAction(state, { type: 'move', uid: secondUid, row: secondTile.row, col: secondTile.col }, { data, catalog });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DEPLOY_CAP');
  assert.equal(result.state.pieces.filter((p) => p.row != null && p.col != null).length, 1, 'failed move leaves the live roster intact');

  // Repositioning an existing operator does not consume another slot.
  const firstLegal = view(result.state).pieces.find((p) => p.uid === firstUid).legalTiles;
  const candidate = firstLegal.map((s) => s.split(',').map(Number)).find(([r, c]) => r !== firstTile.row || c !== firstTile.col);
  assert.ok(candidate, 'fixture has another legal tile for the deployed operator');
  assert.ok(legalTilesOf(view(result.state), pieceNum(firstUid)).length > 0, 'an on-field operator still has legal reposition highlights at cap');
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
  assert.deepEqual(legalTilesOf(state, 10), [[9, 9]], 'native summon placement preview remains available at the operator cap');
});

test('catalog-classified Darkmoon support summon bodies keep zero slots while real operators and prize Jessica count', () => {
  const supports = Object.entries(catalog.operators).filter(([, op]) => op.darkmoonSupport === true && op.profession === 'TOKEN');
  assert.equal(supports.length, 3, 'the exception remains limited to the three configured summon bodies');
  for (const [chessId] of supports) assert.equal(deploymentSlots({ chessId, source: 'native' }, catalog), 0);
  const prizeOperators = Object.entries(catalog.operators).filter(([, op]) => op.darkmoonSupport === true && op.profession !== 'TOKEN');
  assert.ok(prizeOperators.length >= 2, 'Jessica prize forms are represented in the catalog');
  for (const [chessId] of prizeOperators) assert.equal(deploymentSlots({ chessId, source: 'native' }, catalog), 1);
  const ordinary = Object.keys(catalog.operators).find((id) => !catalog.operators[id].darkmoonSupport && catalog.operators[id].source?.normalChess);
  assert.ok(ordinary);
  assert.equal(deploymentSlots({ chessId: ordinary, source: 'native' }, catalog), 1, 'source metadata never grants a broad exemption');
  assert.equal(deploymentSlots({ chessId: ordinary, source: 'copy' }, catalog), 1, 'a copied ordinary operator still occupies one slot');
  assert.equal(deploymentSlots({ chessId: ordinary, kind: 'token' }, catalog), 1, 'a forged legacy token kind cannot override an operator catalog entry');
  assert.equal(deploymentSlots({ chessId: 'legacy-native-marker', kind: 'token' }, catalog), 0, 'native markers without an operator catalog entry remain exempt');
  const fixture = [
    { chessId: supports[0][0], row: 9, col: 1, deploymentSlots: 1 },
    { chessId: ordinary, row: 9, col: 2, deploymentSlots: 0 },
    { chessId: prizeOperators[0][0], row: 9, col: 3 },
  ];
  assert.equal(countDeploymentSlots(fixture, catalog), 2, 'server recounts persisted saves from catalog rather than forged fields');
});

test('Darkmoon support can deploy at a full cap, is projected for client drag/HUD, and cannot ready alone', () => {
  const supportId = Object.entries(catalog.operators).find(([, op]) => op.darkmoonSupport === true && op.profession === 'TOKEN')[0];
  let state = createSession({ data, seed: 8801, difficulty: 'NORMAL' });
  state.funds = 30;
  const slot = buySlot(state);
  let result = applyAction(state, { type: 'buy', slot }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  state = result.state;
  const ordinary = state.pieces[0];
  const ordinaryTile = tileFor(state, ordinary.uid);
  result = applyAction(state, { type: 'move', uid: ordinary.uid, row: ordinaryTile.row, col: ordinaryTile.col }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  state = result.state;
  state.deployCap = 1;
  const support = structuredClone(ordinary);
  Object.assign(support, { uid: `p${state.nextUid++}`, chessId: supportId, row: null, col: null, source: 'native', deploymentSlots: 1 });
  state.pieces.push(support);
  const supportView = view(state);
  const supportProjected = supportView.pieces.find((p) => p.uid === support.uid);
  assert.equal(supportProjected.deploymentSlots, 0, 'viewSession overwrites stale save metadata using the catalog');
  assert.equal(deployedSlots(supportView), 1);
  const tile = tileFor(state, support.uid);
  const supportN = pieceNum(support.uid);
  assert.equal(canDrop(supportView, supportN, tile), true, 'client permits support deployment when a real operator fills cap');
  assert.ok(legalTilesOf(supportView, supportN).length > 0);
  result = applyAction(state, { type: 'move', uid: support.uid, row: tile.row, col: tile.col }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(countDeploymentSlots(result.state.pieces, catalog), 1);

  let supportOnly = createSession({ data, seed: 8802, difficulty: 'NORMAL' });
  const single = { ...structuredClone(support), uid: `p${supportOnly.nextUid++}`, row: null, col: null };
  supportOnly.pieces.push(single);
  const lonelyTile = tileFor(supportOnly, single.uid);
  result = applyAction(supportOnly, { type: 'move', uid: single.uid, row: lonelyTile.row, col: lonelyTile.col }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  result = applyAction(result.state, { type: 'ready' }, { data, catalog });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_DEPLOYED_PIECES', 'support-only roster does not satisfy the ordinary operator requirement');
});

test('native summon marker deploy remains legal when its owner consumes the last operator slot', () => {
  let state = createSession({ data, seed: 8803, difficulty: 'NORMAL' });
  const owner = {
    ...structuredClone(state.pieces[0] || { uid: 'p1', elite: false, dir: 'RIGHT', moduleId: 'none', equipment: [], attachments: [], nativeState: {}, bodyPenaltyApplied: false, poolCopies: 1 }),
    uid: 'p900', chessId: 'chess_native_char_4048_doroth_a', elite: false, row: null, col: null,
    skillIndex: catalog.operators.chess_native_char_4048_doroth_a.defaultSkillIndex || 0,
    equipment: [], attachments: [], nativeState: {}, bodyPenaltyApplied: false,
  };
  state.pieces.push(owner);
  state.deployCap = 1;
  const ownerTile = tileFor(state, owner.uid);
  let result = applyAction(state, { type: 'move', uid: owner.uid, row: ownerTile.row, col: ownerTile.col }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  state = result.state;
  const marker = state.summons.find((token) => token.ownerUid === owner.uid);
  assert.ok(marker, 'deploying Dorothy generated her native trap marker');
  const markerView = view(state);
  const projectedMarker = markerView.pieces.find((p) => p.uid === marker.uid);
  assert.equal(projectedMarker.deploymentSlots, 0);
  const markerTile = tileFor(state, marker.uid);
  assert.ok(projectedMarker.legalTiles.length > 0, 'owner attack-range restriction still supplies legal cells');
  result = applyAction(state, { type: 'move', uid: marker.uid, row: markerTile.row, col: markerTile.col }, { data, catalog });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(countDeploymentSlots(result.state.pieces, catalog), 1, 'native marker adds no operator slot');
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
