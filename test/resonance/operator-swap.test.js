import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { applyAction, createSession, validateSession } from '../../server/modes/resonance/session.js';
import { getResonanceField } from '../../server/modes/resonance/battle.js';
import { ResonanceMatch } from '../../server/modes/resonance/native-match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';

const NATIVE_DATA = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const data = loadData(NATIVE_DATA);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * A prep session standing at its deploy cap: 5 deployed (a ranged operator on the high ground, three melee and one more
 * ranged on the ground) and 4 on the bench, level 5. Every acquisition goes through the real buy / deploy actions.
 */
function scenario() {
  for (let seed = 1; seed <= 80; seed++) {
    const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed });
    const created = createSession({ seed, difficulty: 'HARD', catalog });
    if (!created.ok) continue;
    let state = created.state;
    const field = getResonanceField(state, { data, catalog });
    const cells = [...field.deployMap.entries()].map(([key, kind]) => ({ key, kind, row: Number(key.split(',')[0]), col: Number(key.split(',')[1]) }));
    const high = cells.filter((cell) => cell.kind === 'ranged'), ground = cells.filter((cell) => cell.kind === 'melee');
    if (!high.length || ground.length < 6) continue;
    const options = { catalog, fieldResolver: () => field, recording: false };
    const run = (action) => { const result = applyAction(state, action, options); assert.equal(result.ok, true, `${action.type}: ${result.error}`); state = result.state; return result; };
    const position = (piece) => catalog.operators[piece.operatorId].position;
    state.gold = 900; state.level = 5;
    const want = { MELEE: 5, RANGED: 4 };
    const have = () => ({ MELEE: state.pieces.filter((piece) => position(piece) === 'MELEE').length, RANGED: state.pieces.filter((piece) => position(piece) === 'RANGED').length });
    for (let guard = 0; guard < 60 && (have().MELEE < want.MELEE || have().RANGED < want.RANGED); guard++) {
      const offer = state.shop.offers.find((entry) => entry.operatorId && have()[catalog.operators[entry.operatorId].position] < want[catalog.operators[entry.operatorId].position]
        && !state.pieces.some((piece) => piece.operatorId === entry.operatorId));
      if (offer) run({ type: 'buy', offerUid: offer.uid }); else run({ type: 'refresh' });
    }
    const melee = state.pieces.filter((piece) => position(piece) === 'MELEE'), ranged = state.pieces.filter((piece) => position(piece) === 'RANGED');
    const plan = [[ranged[0], high[0]], [melee[0], ground[0]], [melee[1], ground[1]], [melee[2], ground[2]], [ranged[1], ground[3]]];
    for (const [piece, cell] of plan) run({ type: 'deploy', pieceUid: piece.uid, row: cell.row, col: cell.col, dir: 'RIGHT' });
    // distinct facings and some gear, so a swap has something to preserve
    const gear = Object.values(catalog.equipment).find((item) => item.kind === 'component');
    assert.ok(gear, 'the season has a component to carry');
    for (const [index, piece] of state.pieces.filter((entry) => entry.row !== null).entries()) {
      piece.dir = ['UP', 'LEFT', 'DOWN', 'LEFT', 'UP'][index];
      piece.equipment.push({ uid: `swap-gear-${piece.uid}`, itemId: gear.id });
    }
    for (const piece of state.pieces.filter((entry) => entry.row === null)) piece.dir = 'LEFT';
    assert.equal(validateSession(state, { catalog }).ok, true, JSON.stringify(validateSession(state, { catalog }).errors));
    const byUid = (uid) => state.pieces.find((piece) => piece.uid === uid);
    const [highRanged, m0, m1, m2, groundRanged] = plan.map(([piece]) => piece.uid);
    const bench = state.pieces.filter((piece) => piece.row === null);
    return { seed, catalog, field, state, options, run, byUid, ground, high, cap: 5, highRanged, m0, m1, m2, groundRanged,
      benchMelee: bench.find((piece) => position(piece) === 'MELEE').uid, benchRanged: bench.find((piece) => position(piece) === 'RANGED').uid };
  }
  throw new Error('no seed gives a field with a high-ground tile');
}
const deployed = (state) => state.pieces.filter((piece) => piece.row !== null);
const cellOf = (piece) => `${piece.row},${piece.col}`;

test('a bench operator dropped on an occupied tile swaps at the deploy cap instead of being refused', () => {
  const s = scenario();
  const before = structuredClone(s.state);
  assert.equal(deployed(s.state).length, s.cap, 'fixture stands exactly at the cap');
  const target = s.byUid(s.m1), mover = s.byUid(s.benchMelee);
  const targetDir = target.dir, targetGear = structuredClone(target.equipment), slot = mover.benchSlot, tile = cellOf(target);
  // a plain deployment onto an empty tile is still refused at the cap, atomically
  const empty = s.ground.find((cell) => !deployed(s.state).some((piece) => cellOf(piece) === cell.key));
  const refused = applyAction(s.state, { type: 'deploy', pieceUid: mover.uid, row: empty.row, col: empty.col, dir: 'RIGHT' }, s.options);
  assert.equal(refused.ok, false); assert.equal(refused.error, 'POPULATION_OVER_CAPACITY');
  assert.deepEqual(s.state, before, 'a refused deployment leaves the session untouched');

  const swapped = applyAction(s.state, { type: 'deploy', pieceUid: mover.uid, row: target.row, col: target.col, dir: 'UP' }, s.options);
  assert.equal(swapped.ok, true, swapped.error);
  const state = swapped.state, now = (uid) => state.pieces.find((piece) => piece.uid === uid);
  assert.equal(cellOf(now(mover.uid)), tile); assert.equal(now(mover.uid).dir, 'UP', 'the dragged operator takes the chosen facing');
  assert.equal(now(mover.uid).benchSlot, null);
  assert.equal(now(target.uid).row, null); assert.equal(now(target.uid).benchSlot, slot, 'the swapped-out operator takes the dragged one\'s bench slot');
  assert.equal(now(target.uid).dir, targetDir, 'the swapped-out operator keeps its facing');
  assert.deepEqual(now(target.uid).equipment, targetGear, 'and its equipment');
  assert.equal(deployed(state).length, s.cap, 'the deployed count did not change');
  assert.equal(validateSession(state, { catalog: s.catalog }).ok, true);
});

test('two deployed operators swap tiles; each keeps its own facing and gear, the dragged one takes the chosen facing', () => {
  const s = scenario();
  const a = s.byUid(s.m0), b = s.byUid(s.m2);
  const aTile = cellOf(a), bTile = cellOf(b), bDir = b.dir, bGear = structuredClone(b.equipment), aGear = structuredClone(a.equipment);
  const swapped = applyAction(s.state, { type: 'move', pieceUid: a.uid, row: b.row, col: b.col, dir: 'DOWN' }, s.options);
  assert.equal(swapped.ok, true, swapped.error);
  const now = (uid) => swapped.state.pieces.find((piece) => piece.uid === uid);
  assert.equal(cellOf(now(a.uid)), bTile); assert.equal(now(a.uid).dir, 'DOWN');
  assert.equal(cellOf(now(b.uid)), aTile); assert.equal(now(b.uid).dir, bDir);
  assert.deepEqual(now(a.uid).equipment, aGear); assert.deepEqual(now(b.uid).equipment, bGear);
  assert.equal(deployed(swapped.state).length, s.cap);
  assert.equal(validateSession(swapped.state, { catalog: s.catalog }).ok, true);
});

test('a deployed operator dropped on an occupied bench slot swaps with it: the bench operator takes the tile and its facing', () => {
  const s = scenario();
  const board = s.byUid(s.m0), benched = s.byUid(s.benchMelee);
  const tile = cellOf(board), facing = board.dir, gear = structuredClone(board.equipment), benchedDir = benched.dir, slot = benched.benchSlot;
  const swapped = applyAction(s.state, { type: 'bench', pieceUid: board.uid, slot }, s.options);
  assert.equal(swapped.ok, true, swapped.error);
  const now = (uid) => swapped.state.pieces.find((piece) => piece.uid === uid);
  assert.equal(now(board.uid).row, null); assert.equal(now(board.uid).benchSlot, slot);
  assert.equal(now(board.uid).dir, facing, 'the withdrawn operator keeps its facing'); assert.deepEqual(now(board.uid).equipment, gear);
  assert.equal(cellOf(now(benched.uid)), tile); assert.equal(now(benched.uid).dir, facing, 'the bench operator takes the tile\'s facing (as in the original game)');
  assert.notEqual(benchedDir, facing, 'fixture: the facing really was handed over');
  assert.equal(now(benched.uid).benchSlot, null);
  assert.equal(deployed(swapped.state).length, s.cap);
  assert.equal(validateSession(swapped.state, { catalog: s.catalog }).ok, true);
});

test('bench slots swap with each other too', () => {
  const s = scenario();
  const first = s.byUid(s.benchMelee), second = s.byUid(s.benchRanged);
  const swapped = applyAction(s.state, { type: 'bench', pieceUid: first.uid, slot: second.benchSlot }, s.options);
  assert.equal(swapped.ok, true, swapped.error);
  assert.equal(swapped.state.pieces.find((piece) => piece.uid === first.uid).benchSlot, second.benchSlot);
  assert.equal(swapped.state.pieces.find((piece) => piece.uid === second.uid).benchSlot, first.benchSlot);
});

test('ground and high-ground limits still decide a swap: an operator that cannot stand on the other tile is refused, nothing changes', () => {
  const s = scenario();
  const before = structuredClone(s.state);
  const meleeOnHigh = s.catalog.operators[s.byUid(s.benchMelee).operatorId];
  assert.equal(meleeOnHigh.position, 'MELEE'); assert.notEqual(meleeOnHigh.canDeployHighGround, true, 'fixture: this melee operator is ground-only');
  const highPiece = s.byUid(s.highRanged), highTile = { row: highPiece.row, col: highPiece.col };
  // 1. a ground-only operator from the bench onto the high-ground tile held by a ranged one
  let result = applyAction(s.state, { type: 'deploy', pieceUid: s.benchMelee, ...highTile, dir: 'RIGHT' }, s.options);
  assert.equal(result.ok, false); assert.equal(result.error, 'ILLEGAL_DEPLOYMENT');
  // 2. the ranged one on the high ground dragged onto a ground tile held by a ground-only operator: that one could not take the high tile
  const groundPiece = s.byUid(s.m1);
  assert.notEqual(s.catalog.operators[groundPiece.operatorId].canDeployHighGround, true);
  result = applyAction(s.state, { type: 'move', pieceUid: s.highRanged, row: groundPiece.row, col: groundPiece.col, dir: 'RIGHT' }, s.options);
  assert.equal(result.ok, false); assert.equal(result.error, 'ILLEGAL_SWAP');
  // 3. the same from the board onto the bench slot of a ground-only operator
  result = applyAction(s.state, { type: 'bench', pieceUid: s.highRanged, slot: s.byUid(s.benchMelee).benchSlot }, s.options);
  assert.equal(result.ok, false); assert.equal(result.error, 'ILLEGAL_SWAP');
  assert.deepEqual(s.state, before, 'refusals are atomic');
  // the legal mirror images do work: a ranged operator may take a ground tile, and the high tile accepts another ranged operator
  result = applyAction(s.state, { type: 'deploy', pieceUid: s.benchRanged, ...highTile, dir: 'RIGHT' }, s.options);
  assert.equal(result.ok, true, result.error);
  assert.equal(cellOf(result.state.pieces.find((piece) => piece.uid === s.benchRanged)), cellOf(highPiece));
  assert.equal(result.state.pieces.find((piece) => piece.uid === s.highRanged).row, null);
});

test('unique-core identity: a swap judges the identity that remains on the field, in every swap form', () => {
  const s = scenario();
  const uniqueId = 'fixtureUnique', catalog = { ...s.catalog, strategies: { ...s.catalog.strategies, [uniqueId]: { id: uniqueId, effects: [{ kind: 'unique_nation_core' }] } } };
  const options = { ...s.options, catalog };
  const base = structuredClone(s.state);
  base.strategies = [uniqueId]; base.strategyState = { [uniqueId]: {} };
  const copyOf = (piece, slot) => {
    const copy = { ...structuredClone(piece), uid: `copy-${piece.uid}`, row: null, col: null, benchSlot: slot, dir: 'LEFT', equipment: [] };
    base.pieces.push(copy); base.poolRemaining[piece.operatorId] -= 1; return copy;
  };
  const deployedPiece = base.pieces.find((piece) => piece.uid === s.m1);
  const usedSlots = new Set(base.pieces.filter((piece) => piece.row === null).map((piece) => piece.benchSlot));
  const freeSlot = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((slot) => !usedSlots.has(slot));
  const duplicate = copyOf(deployedPiece, freeSlot);
  assert.equal(validateSession(base, { catalog }).ok, true, JSON.stringify(validateSession(base, { catalog }).errors));
  // the duplicate replaces its own identity on the field: allowed (the deployed one leaves)
  let result = applyAction(base, { type: 'deploy', pieceUid: duplicate.uid, row: deployedPiece.row, col: deployedPiece.col, dir: 'RIGHT' }, options);
  assert.equal(result.ok, true, result.error);
  // replacing a different operator while its twin stays on the field would put two of one identity out: refused
  result = applyAction(base, { type: 'deploy', pieceUid: duplicate.uid, row: base.pieces.find((piece) => piece.uid === s.m2).row, col: base.pieces.find((piece) => piece.uid === s.m2).col, dir: 'RIGHT' }, options);
  assert.equal(result.ok, false); assert.equal(result.error, 'DUPLICATE_CORE_IDENTITY');
  // the bench form: withdrawing m2 onto the duplicate's slot would bring the duplicate onto the field next to its twin
  result = applyAction(base, { type: 'bench', pieceUid: s.m2, slot: duplicate.benchSlot }, options);
  assert.equal(result.ok, false); assert.equal(result.error, 'DUPLICATE_CORE_IDENTITY');
  // ...but withdrawing the twin itself hands the tile to its duplicate
  result = applyAction(base, { type: 'bench', pieceUid: s.m1, slot: duplicate.benchSlot }, options);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.pieces.find((piece) => piece.uid === duplicate.uid).row, deployedPiece.row);
});

test('g.move over the native protocol: a bench operator swaps onto an occupied tile at the cap; a new deployment there is refused as 已达到部署上限', { timeout: 60_000 }, async () => {
  const s = scenario();
  const state = structuredClone(s.state);
  let stored = structuredClone(state);
  const store = { async exclusive(_id, task) { return task(); }, async saveSession(_id, next) { stored = structuredClone(next); }, deactivate() {} };
  const scheduler = new VirtualScheduler({ instantCombat: false });
  const match = new ResonanceMatch({ sessionId: 'test-operator-swap', state, catalog: s.catalog, data, store, scheduler, send() {}, broadcast() {}, timerScale: 0, log: quiet });
  try {
    match.start();
    assert.equal((await match.handle('resonance', { t: 'g.infoReady', setupRevision: 0 })).ok, true);
    match.enterBandDraft();
    assert.equal(scheduler.runUntil(() => match.phase === 'PREP', { maxTime: 30_000 }), true);
    const target = match.state.pieces.find((piece) => piece.uid === s.m1), mover = match.state.pieces.find((piece) => piece.uid === s.benchMelee);
    const empty = s.ground.find((cell) => !match.state.pieces.some((piece) => piece.row === cell.row && piece.col === cell.col));
    const refused = await match.handle('resonance', { t: 'g.move', uid: match.uidMap.native(mover.uid), to: { area: 'board', row: empty.row, col: empty.col, dir: 'RIGHT' } });
    assert.equal(refused.error, 'BOARD_FULL'); assert.equal(refused.detail, 'POPULATION_OVER_CAPACITY');
    const row = target.row, col = target.col;
    const swapped = await match.handle('resonance', { t: 'g.move', uid: match.uidMap.native(mover.uid), to: { area: 'board', row, col, dir: 'UP' } });
    assert.equal(swapped.ok, true, JSON.stringify(swapped));
    const after = (uid) => match.state.pieces.find((piece) => piece.uid === uid);
    assert.equal(after(mover.uid).row, row); assert.equal(after(mover.uid).col, col); assert.equal(after(mover.uid).dir, 'UP');
    assert.equal(after(target.uid).row, null);
    const priv = match.resonancePrivateView(match.players.get('resonance'));
    assert.equal(priv.deployCount, 5); assert.equal(priv.deployCap, 5);
    assert.ok(priv.hand.some((entry) => entry && entry.uid === match.uidMap.native(target.uid)), 'the swapped-out operator is on the bench the client sees');
    // the ranged operator on the high ground onto the bench slot of the ground-only operator just swapped out: refused with the tile error
    const illegal = await match.handle('resonance', { t: 'g.move', uid: match.uidMap.native(s.highRanged), to: { area: 'hand', idx: after(target.uid).benchSlot } });
    assert.equal(illegal.error, 'BAD_TILE'); assert.equal(illegal.detail, 'ILLEGAL_SWAP');
    assert.equal(after(s.highRanged).row !== null, true, 'and it stays where it was');
  } finally {
    await match._sessionWrite; match.dispose(); scheduler.dispose();
  }
});
