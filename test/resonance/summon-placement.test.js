import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { applyAction, createSession, validateSession } from '../../server/modes/resonance/session.js';
import { buildResonanceBattle, getResonanceField } from '../../server/modes/resonance/battle.js';
import { ResonanceMatch, parseSummonSessionId, summonSessionId } from '../../server/modes/resonance/native-match.js';
import { legalSummonCells, orderCopy, placeableSummons, selectedSummonIds, summonLimit } from '../../server/modes/resonance/summons.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { ownerRangeKeys } from '../../server/match/board.js';

const NATIVE_DATA = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const data = loadData(NATIVE_DATA);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const CATHY = 'chess_char_4_11_a';                    // 凯瑟琳: two 爬行号·防护单元
const ROBERTA = 'chess_native_char_484_robrta_a';     // 罗比菈塔: three 全自动造型仪
const VIGIL = 'chess_char_6_11_a';                    // 缪尔赛思: one 流形, only inside her attack range
const CATHY_TOKEN = 'token_10041_cathy_catsld', ROBERTA_TOKEN = 'token_10018_robrta_mach', WOLF = 'token_10030_mlyss_wtrman';

/** A prep session (seed 5 pool) with the given summoners deployed on real legal tiles, level 10 so the cap never interferes. */
function scenario(operatorIds) {
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: 'resonance-factions-2', seed: 5 });
  const created = createSession({ seed: 5, difficulty: 'NORMAL', catalog });
  assert.equal(created.ok, true, created.error);
  let state = created.state;
  for (const piece of state.pieces) state.poolRemaining[piece.operatorId] += ({ 1: 1, 2: 3, 3: 9 })[piece.star];
  state.pieces = []; state.level = 10; state.phase = 'prep'; state.nodeStarted = true;
  const fieldFor = (current) => getResonanceField(current, { data, catalog });
  const options = { catalog, fieldResolver: fieldFor, recording: false };
  const field = fieldFor(state);
  const cells = [...field.deployMap.entries()].filter(([, kind]) => kind === 'melee').map(([key]) => key.split(',').map(Number));
  const pieces = operatorIds.map((operatorId, index) => {
    assert.ok(catalog.config.activeOperatorIds.includes(operatorId), `${operatorId} is in the seed 5 pool`);
    state.poolRemaining[operatorId]--;
    return { uid: `p${state.nextUid++}`, operatorId, star: 1, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT', benchSlot: index, summonOrders: [] };
  });
  state.pieces = pieces;
  const run = (action) => { const result = applyAction(state, action, options); assert.equal(result.ok, true, `${action.type}: ${result.error}`); state = result.state; return result; };
  // the summoners stand on the first tiles of the ground row nearest the enemy so the tiles around them stay free
  pieces.forEach((piece, index) => run({ type: 'deploy', pieceUid: piece.uid, row: cells[index * 3][0], col: cells[index * 3][1], dir: 'RIGHT' }));
  const owner = (operatorId) => state.pieces.find((piece) => piece.operatorId === operatorId);
  const tryAction = (action) => applyAction(state, action, options);
  return { catalog, get state() { return state; }, set state(next) { state = next; }, run, tryAction, fieldFor, owner, options, operator: (id) => catalog.operators[id] };
}

const ordersOf = (s, operatorId) => s.owner(operatorId).summonOrders;
const keyOf = (order) => `${order.row},${order.col}`;

test('deploy limits come from the data: 凯瑟琳 2, 罗比菈塔 3, 缪尔赛思 1', () => {
  const s = scenario([CATHY, ROBERTA, VIGIL]);
  const field = s.fieldFor(s.state);
  for (const [operatorId, tokenId, limit] of [[CATHY, CATHY_TOKEN, 2], [ROBERTA, ROBERTA_TOKEN, 3], [VIGIL, WOLF, 1]]) {
    const offered = placeableSummons(field, s.operator(operatorId), 1).find((entry) => entry.tokenId === tokenId);
    assert.ok(offered, `${operatorId} offers ${tokenId}`);
    assert.equal(offered.limit, limit); assert.equal(summonLimit(offered.token), limit);
  }
});

test('copies: each copy is its own order up to the limit, a copy can be moved or taken back alone, old single orders read as copy 0', () => {
  const s = scenario([ROBERTA]);
  const roberta = () => s.owner(ROBERTA), op = s.operator(ROBERTA);
  const free = () => legalSummonCells(s.fieldFor(s.state), s.state, roberta(), op, ROBERTA_TOKEN);
  const [a, b, c, d] = free().slice(0, 4).map((key) => key.split(',').map(Number));
  s.run({ type: 'setSummonOrder', pieceUid: roberta().uid, tokenId: ROBERTA_TOKEN, row: a[0], col: a[1] });
  assert.deepEqual(ordersOf(s, ROBERTA), [{ tokenId: ROBERTA_TOKEN, row: a[0], col: a[1] }], 'the first copy keeps the historical shape');
  s.run({ type: 'setSummonOrder', pieceUid: roberta().uid, tokenId: ROBERTA_TOKEN, row: b[0], col: b[1], dir: 'UP' });
  s.run({ type: 'setSummonOrder', pieceUid: roberta().uid, tokenId: ROBERTA_TOKEN, row: c[0], col: c[1] });
  assert.deepEqual(ordersOf(s, ROBERTA).map((order) => [orderCopy(order), keyOf(order), order.dir ?? null]), [[0, `${a[0]},${a[1]}`, null], [1, `${b[0]},${b[1]}`, 'UP'], [2, `${c[0]},${c[1]}`, null]]);
  const before = structuredClone(s.state);
  let refused = s.tryAction({ type: 'setSummonOrder', pieceUid: roberta().uid, tokenId: ROBERTA_TOKEN, row: d[0], col: d[1] });
  assert.equal(refused.ok, false); assert.equal(refused.error, 'SUMMON_LIMIT'); assert.deepEqual(s.state, before, 'a refused placement changes nothing');
  assert.ok(![a, b, c].some(([row, col]) => free().includes(`${row},${col}`)), 'placed copies take their tiles away from the next one');
  refused = s.tryAction({ type: 'setSummonOrder', pieceUid: roberta().uid, tokenId: ROBERTA_TOKEN, copy: 2, row: a[0], col: a[1] });
  assert.equal(refused.error, 'ILLEGAL_SUMMON_POSITION', 'a copy cannot move onto another copy');
  // move copy 1 (its facing is kept when none is given), then turn copy 2 on its own tile
  s.run({ type: 'setSummonOrder', pieceUid: roberta().uid, tokenId: ROBERTA_TOKEN, copy: 1, row: d[0], col: d[1] });
  assert.deepEqual(ordersOf(s, ROBERTA).find((order) => orderCopy(order) === 1), { tokenId: ROBERTA_TOKEN, row: d[0], col: d[1], dir: 'UP', copy: 1 });
  s.run({ type: 'setSummonOrder', pieceUid: roberta().uid, tokenId: ROBERTA_TOKEN, copy: 2, row: c[0], col: c[1], dir: 'LEFT' });
  assert.equal(ordersOf(s, ROBERTA).find((order) => orderCopy(order) === 2).dir, 'LEFT');
  assert.equal(ordersOf(s, ROBERTA).length, 3);
  // one copy back onto its card, then all of them
  s.run({ type: 'clearSummonOrder', pieceUid: roberta().uid, tokenId: ROBERTA_TOKEN, copy: 0 });
  assert.deepEqual(ordersOf(s, ROBERTA).map(orderCopy), [1, 2]);
  s.run({ type: 'clearSummonOrder', pieceUid: roberta().uid, tokenId: ROBERTA_TOKEN });
  assert.deepEqual(ordersOf(s, ROBERTA), []);
  assert.equal(validateSession(s.state, { catalog: s.catalog }).ok, true);
});

test('a token that allows one copy is simply re-placed, as before copies existed', () => {
  const s = scenario([VIGIL]);
  const vigil = () => s.owner(VIGIL), op = s.operator(VIGIL);
  const [a, b] = legalSummonCells(s.fieldFor(s.state), s.state, vigil(), op, WOLF).slice(0, 2).map((key) => key.split(',').map(Number));
  s.run({ type: 'setSummonOrder', pieceUid: vigil().uid, tokenId: WOLF, row: a[0], col: a[1] });
  s.run({ type: 'setSummonOrder', pieceUid: vigil().uid, tokenId: WOLF, row: b[0], col: b[1] });
  assert.deepEqual(ordersOf(s, VIGIL), [{ tokenId: WOLF, row: b[0], col: b[1] }]);
});

test('moving, withdrawing or swapping a summoner takes its placed summons back; turning it keeps those its new range still covers', () => {
  const s = scenario([VIGIL, ROBERTA]);
  const field = () => s.fieldFor(s.state);
  const place = (operatorId, tokenId) => {
    const owner = s.owner(operatorId), key = legalSummonCells(field(), s.state, owner, s.operator(operatorId), tokenId)[0];
    const [row, col] = key.split(',').map(Number);
    s.run({ type: 'setSummonOrder', pieceUid: owner.uid, tokenId, row, col }); return [row, col];
  };
  const face = (operatorId, dir) => s.run({ type: 'move', pieceUid: s.owner(operatorId).uid, row: s.owner(operatorId).row, col: s.owner(operatorId).col, dir });
  // turned in place: the manifold is range-bound, so it stays only where the new facing still reaches
  const manifoldAt = place(VIGIL, WOLF), op = s.operator(VIGIL);
  const covers = (dir) => ownerRangeKeys(op.stars[1].record.rangeGrid, s.owner(VIGIL).row, s.owner(VIGIL).col, dir).has(`${manifoldAt[0]},${manifoldAt[1]}`);
  const dirs = ['UP', 'RIGHT', 'DOWN', 'LEFT'], keeps = dirs.find(covers), drops = dirs.find((dir) => !covers(dir));
  assert.ok(keeps && drops, 'fixture: some facing covers the manifold and some does not');
  face(VIGIL, keeps);
  assert.equal(ordersOf(s, VIGIL).length, 1, 'a facing that still reaches it keeps the manifold');
  face(VIGIL, drops);
  assert.equal(ordersOf(s, VIGIL).length, 0, 'a facing that leaves it outside the range takes it back');
  face(VIGIL, 'RIGHT');
  // swapped by another operator: both lose their placed summons
  place(ROBERTA, ROBERTA_TOKEN); place(VIGIL, WOLF);
  const roberta = s.owner(ROBERTA), vigil = s.owner(VIGIL);
  s.run({ type: 'move', pieceUid: roberta.uid, row: vigil.row, col: vigil.col, dir: 'RIGHT' });
  assert.deepEqual([ordersOf(s, ROBERTA), ordersOf(s, VIGIL)], [[], []], 'the mover and the swapped operator both take their summons back');
  // moved to an empty tile
  place(ROBERTA, ROBERTA_TOKEN);
  const empty = [...s.fieldFor(s.state).deployMap.keys()].map((key) => key.split(',').map(Number)).find(([row, col]) => !s.state.pieces.some((piece) => piece.row === row && piece.col === col)
    && !ordersOf(s, ROBERTA).some((order) => order.row === row && order.col === col));
  s.run({ type: 'move', pieceUid: s.owner(ROBERTA).uid, row: empty[0], col: empty[1], dir: 'RIGHT' });
  assert.deepEqual(ordersOf(s, ROBERTA), []);
  // withdrawn to the bench
  place(ROBERTA, ROBERTA_TOKEN);
  s.run({ type: 'bench', pieceUid: s.owner(ROBERTA).uid, slot: 7 });
  assert.deepEqual(ordersOf(s, ROBERTA), []);
  assert.equal(validateSession(s.state, { catalog: s.catalog }).ok, true);
});

test('the battle puts one summon on each placed tile with its facing; unplaced summoners keep the automatic placement', () => {
  const s = scenario([CATHY, ROBERTA]);
  const placeTwo = (operatorId, tokenId, dirs) => {
    const owner = s.owner(operatorId), keys = legalSummonCells(s.fieldFor(s.state), s.state, owner, s.operator(operatorId), tokenId);
    const tiles = [];
    for (const dir of dirs) {
      const key = legalSummonCells(s.fieldFor(s.state), s.state, s.owner(operatorId), s.operator(operatorId), tokenId)[tiles.length * 2];
      const [row, col] = key.split(',').map(Number); tiles.push([row, col, dir]);
      s.run({ type: 'setSummonOrder', pieceUid: owner.uid, tokenId, row, col, dir });
    }
    assert.ok(keys.length >= 4); return tiles;
  };
  const unplaced = buildResonanceBattle(s.state, { data, catalog: s.catalog, recording: false });
  const autoCathy = unplaced.battle.allyUnits.filter((unit) => unit.kind === 'token' && unit.defId === CATHY_TOKEN);
  assert.equal(autoCathy.length, 1, 'nothing placed: the old single automatic summon');

  const cathyTiles = placeTwo(CATHY, CATHY_TOKEN, ['UP', 'LEFT']);
  const { battle } = buildResonanceBattle(s.state, { data, catalog: s.catalog, recording: false });
  const cathy = battle.allyUnits.filter((unit) => unit.kind === 'token' && unit.defId === CATHY_TOKEN).sort((x, y) => x.tileC - y.tileC || x.tileR - y.tileR);
  assert.equal(cathy.length, 2, 'both placed copies reach the battle');
  assert.deepEqual(cathy.map((unit) => [unit.tileR, unit.tileC]).sort(), cathyTiles.map(([row, col]) => [row, col]).sort(), 'on exactly the placed tiles');
  assert.deepEqual(new Set(cathy.map((unit) => unit.dir)), new Set(['UP', 'LEFT']), 'each with the facing it was given');
  assert.equal(battle.resonanceSummonAnchors.filter((anchor) => anchor.tokenId === CATHY_TOKEN).length, 2);
  assert.equal(battle.resonanceSummonAnchorGaps.length, 0); assert.equal(battle.errorCount, 0);
  // the second summoner is untouched by the first one's placements
  assert.equal(battle.allyUnits.filter((unit) => unit.kind === 'token' && unit.defId === ROBERTA_TOKEN).length, 1);
  // orders beyond the data's limit are ignored
  const crowded = structuredClone(s.state), extra = legalSummonCells(s.fieldFor(crowded), crowded, crowded.pieces.find((piece) => piece.operatorId === CATHY), s.operator(CATHY), CATHY_TOKEN, null).slice(0, 2);
  const owner = crowded.pieces.find((piece) => piece.operatorId === CATHY);
  extra.forEach((key, index) => owner.summonOrders.push({ tokenId: CATHY_TOKEN, row: Number(key.split(',')[0]), col: Number(key.split(',')[1]), copy: 2 + index }));
  const over = buildResonanceBattle(crowded, { data, catalog: s.catalog, recording: false }).battle;
  assert.equal(over.allyUnits.filter((unit) => unit.kind === 'token' && unit.defId === CATHY_TOKEN).length, 2, 'two copies at most for 凯瑟琳');
});

test('the native player sees summon cards only for deployed summoners, placed copies as token pieces, and drags them with g.move', { timeout: 60_000 }, async () => {
  const s = scenario([CATHY, ROBERTA]);
  const state = structuredClone(s.state);
  // a third operator waits on the bench: a deployed summoner shows cards, a benched one would not
  const store = { async exclusive(_id, task) { return task(); }, async saveSession() {}, deactivate() {} };
  const scheduler = new VirtualScheduler({ instantCombat: false });
  const match = new ResonanceMatch({ sessionId: 'test-summon-cards', state, catalog: s.catalog, data, store, scheduler, send() {}, broadcast() {}, timerScale: 0, log: quiet });
  try {
    match.start();
    assert.equal((await match.handle('resonance', { t: 'g.infoReady', setupRevision: 0 })).ok, true);
    match.enterBandDraft();
    assert.equal(scheduler.runUntil(() => match.phase === 'PREP', { maxTime: 30_000 }), true);
    const view = () => match.displayState(), priv = () => match.resonancePrivateView(match.players.get('resonance'));
    const cathy = () => view().pieces.find((piece) => piece.operatorId === CATHY);
    const card = () => cathy().summonCards.find((entry) => entry.tokenId === CATHY_TOKEN);
    assert.equal(card().limit, 2); assert.equal(card().remaining, 2); assert.deepEqual(card().placed, []);
    assert.ok(card().legalTiles.length > 4, 'the card carries the tiles a new copy may take');
    assert.equal(priv().board.filter((entry) => entry.kind === 'token').length, 0, 'nothing placed: no token pieces');
    const benchBefore = priv().hand.filter(Boolean).length, deployBefore = priv().deployCount;

    const owner = match.state.pieces.find((piece) => piece.operatorId === CATHY), ownerNative = match.uidMap.native(owner.uid);
    const [row, col] = card().legalTiles[0].split(',').map(Number);
    const set = await match.handle('resonance', { t: 'g.resonance', action: { type: 'setSummonOrder', pieceUid: ownerNative, tokenId: CATHY_TOKEN, row, col, dir: 'DOWN' } });
    assert.equal(set.ok, true, JSON.stringify(set));
    const placed = priv().board.filter((entry) => entry.kind === 'token' && entry.id === CATHY_TOKEN);
    assert.equal(placed.length, 1); assert.deepEqual([placed[0].row, placed[0].col, placed[0].dir, placed[0].ownerUid], [row, col, 'DOWN', ownerNative]);
    assert.equal(card().remaining, 1);
    assert.equal(priv().deployCount, deployBefore, 'a summon takes no deploy slot'); assert.equal(priv().hand.filter(Boolean).length, benchBefore, 'and no bench slot');
    assert.equal(parseSummonSessionId(match.uidMap.session(placed[0].uid)).ownerUid, owner.uid);

    // the placed piece is dragged like any piece: to another tile, onto its own tile with a new facing, back to the bench
    const [row2, col2] = card().legalTiles.find((key) => key !== `${row},${col}`).split(',').map(Number);
    let moved = await match.handle('resonance', { t: 'g.move', uid: placed[0].uid, to: { area: 'board', row: row2, col: col2, dir: 'RIGHT' }, dir: 'RIGHT' });
    assert.equal(moved.ok, true, JSON.stringify(moved));
    assert.deepEqual(match.state.pieces.find((piece) => piece.uid === owner.uid).summonOrders, [{ tokenId: CATHY_TOKEN, row: row2, col: col2, dir: 'RIGHT' }]);
    moved = await match.handle('resonance', { t: 'g.move', uid: placed[0].uid, to: { area: 'board', row: row2, col: col2, dir: 'UP' }, dir: 'UP' });
    assert.equal(moved.ok, true, JSON.stringify(moved));
    assert.equal(priv().board.find((entry) => entry.uid === placed[0].uid).dir, 'UP');
    const onOperator = match.state.pieces.find((piece) => piece.operatorId === ROBERTA);
    const refused = await match.handle('resonance', { t: 'g.move', uid: placed[0].uid, to: { area: 'board', row: onOperator.row, col: onOperator.col, dir: 'UP' } });
    assert.equal(refused.error, 'BAD_TILE'); assert.equal(refused.detail, 'CELL_OCCUPIED');
    const back = await match.handle('resonance', { t: 'g.move', uid: placed[0].uid, to: { area: 'hand', idx: 3 } });
    assert.equal(back.ok, true, JSON.stringify(back));
    assert.deepEqual(match.state.pieces.find((piece) => piece.uid === owner.uid).summonOrders, []);
    assert.equal(card().remaining, 2);

    // withdrawing the summoner removes its cards altogether
    await match.handle('resonance', { t: 'g.move', uid: ownerNative, to: { area: 'hand', idx: 7 } });
    assert.deepEqual(cathy().summonCards, [], 'a summoner on the bench offers no summon cards');
    assert.equal(summonSessionId('p1', CATHY_TOKEN, 2), 'summon:p1:token_10041_cathy_catsld:2');
    assert.deepEqual(parseSummonSessionId('summon:p1:token_10041_cathy_catsld:2'), { ownerUid: 'p1', tokenId: CATHY_TOKEN, copy: 2 });
    assert.equal(selectedSummonIds(s.operator(CATHY), 1).includes(CATHY_TOKEN), true);
  } finally {
    await match._sessionWrite; match.dispose(); scheduler.dispose();
  }
});
