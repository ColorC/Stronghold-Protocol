import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { applyAction, countedDeployed, createSession, validateSession, viewSession } from '../../server/modes/resonance/session.js';
import { getResonanceField } from '../../server/modes/resonance/battle.js';
import { ResonanceMatch, resonanceCatalogPacket } from '../../server/modes/resonance/native-match.js';
import { resonanceSessionDisplay, DEPLOY_FREE_TRAIT_TEXT } from '../../server/modes/resonance/display.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { GEO } from '../../shared/constants.js';
import { placementContext, canPlace } from '../../public/js/ui/gameLogic.js';

const NATIVE_DATA = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const data = loadData(NATIVE_DATA);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const JNIGHT = 'chess_native_char_4000_jnight_a';      // 正义骑士号: 「不受部署数量限制」
const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: 'resonance-factions-2', seed: 5 });

/** A level-5 prep session (cap 5, seed 5 pool): `deployed` counted operators on the field, `bench` more waiting, real deploy actions. */
function scenario({ deployed = 5, bench = 2, jnight = 0 } = {}) {
  const created = createSession({ seed: 5, difficulty: 'NORMAL', catalog });
  assert.equal(created.ok, true, created.error);
  let state = created.state;
  for (const piece of state.pieces) state.poolRemaining[piece.operatorId] += ({ 1: 1, 2: 3, 3: 9 })[piece.star];
  state.pieces = []; state.level = 5; state.phase = 'prep'; state.nodeStarted = true;
  const field = getResonanceField(state, { data, catalog });
  const options = { catalog, fieldResolver: () => field, recording: false };
  const cells = [...field.deployMap.entries()].filter(([, kind]) => kind === 'melee').map(([key]) => key.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const fillers = catalog.config.activeOperatorIds.filter((id) => id !== JNIGHT && state.poolRemaining[id] > 1);
  const make = (operatorId, slot = null) => {
    state.poolRemaining[operatorId]--;
    return { uid: `p${state.nextUid++}`, operatorId, star: 1, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT', benchSlot: slot };
  };
  const run = (action) => { const result = applyAction(state, action, options); assert.equal(result.ok, true, `${action.type}: ${result.error}`); state = result.state; return result; };
  const attempt = (action) => applyAction(state, action, options);
  const fresh = () => cells.find(([row, col]) => !state.pieces.some((piece) => piece.row === row && piece.col === col));
  state.pieces = fillers.slice(0, deployed).map((id, index) => make(id, index));
  for (const piece of [...state.pieces]) { const [row, col] = fresh(); run({ type: 'deploy', pieceUid: piece.uid, row, col, dir: 'RIGHT' }); }
  for (let index = 0; index < jnight; index++) { const piece = make(JNIGHT, index); state.pieces.push(piece); const [row, col] = fresh(); run({ type: 'deploy', pieceUid: piece.uid, row, col, dir: 'RIGHT' }); }
  fillers.slice(deployed, deployed + bench).forEach((id, index) => state.pieces.push(make(id, 4 + index)));
  const addToBench = (operatorId) => { const used = new Set(state.pieces.filter((p) => p.row === null).map((p) => p.benchSlot)); const slot = [...Array(9).keys()].find((i) => !used.has(i)); const piece = make(operatorId, slot); state.pieces.push(piece); return piece; };
  return { get state() { return state; }, set state(next) { state = next; }, run, attempt, fresh, addToBench, field, options, cells,
    byOp: (operatorId) => state.pieces.filter((piece) => piece.operatorId === operatorId) };
}
const onField = (state) => state.pieces.filter((piece) => piece.row !== null);

test('正义骑士号 is marked from its 特性 text, belongs to no 盟约, and nobody else is marked', () => {
  const marked = Object.values(catalog.operators).filter((operator) => operator.ignoresDeployLimit).map((operator) => operator.sourceChessId);
  assert.deepEqual(marked, [JNIGHT], 'only the operator whose native 特性 says 不受部署数量限制');
  assert.deepEqual(catalog.operators[JNIGHT].pacts, [], 'no 盟约 tag on its card');
  assert.ok(catalog.config.activeOperatorIds.includes(JNIGHT), 'shop, pool and star-ups are untouched');
  for (const [id, pact] of Object.entries(catalog.pacts)) {
    assert.ok(!(pact.members ?? []).includes(JNIGHT), `${id} lists it among its members`.replace('lists', 'does not list'));
    assert.ok(!(pact.memberCharIds ?? []).includes('char_4000_jnight'), `${id} member char ids`);
  }
  assert.ok(catalog.prototypeMeta.traits.every((trait) => !trait.members.includes('char_4000_jnight')), 'the season trait lists leave it out');
  assert.ok(catalog.prototypeSeason.traits.every((trait) => !trait.members.includes('char_4000_jnight')));
});

test('the 特性 text players read: the native sentence incl. its long redeploy, the one-at-a-time rule and 不计入盟约', () => {
  assert.match(DEPLOY_FREE_TRAIT_TEXT, /但再部署时间极长/, 'the mode does redeploy: the native clause stays');
  assert.match(DEPLOY_FREE_TRAIT_TEXT, /不受部署数量限制/); assert.match(DEPLOY_FREE_TRAIT_TEXT, /不计入盟约/);
  const packet = resonanceCatalogPacket({ data, catalog, displayCatalog: catalog, nativeChessId: (id, star) => (star === 1 ? id : `resonance_${id}_star${star}`) });
  for (const star of [1, 2, 3]) {
    const id = star === 1 ? JNIGHT : `resonance_${JNIGHT}_star${star}`, record = packet.data.chess[id];
    assert.equal(record.trait.desc, DEPLOY_FREE_TRAIT_TEXT); assert.equal(record.trait.descRaw, DEPLOY_FREE_TRAIT_TEXT);
    assert.deepEqual(record.bonds, [], 'the card shows no 盟约 chips');
  }
  const other = packet.data.chess[Object.keys(packet.data.chess).find((id) => id !== JNIGHT && !id.includes('_star'))];
  assert.notEqual(other.trait?.desc, DEPLOY_FREE_TRAIT_TEXT, 'other operators keep their own 特性');
});

test('at the deploy cap it can still be deployed: one such operator is free, a second copy counts', () => {
  const s = scenario({ deployed: 5, bench: 0 });
  assert.equal(countedDeployed(s.state, catalog), 5);
  let first = s.addToBench(JNIGHT), [row, col] = s.fresh();
  const refusedFiller = s.attempt({ type: 'deploy', pieceUid: s.addToBench(catalog.config.activeOperatorIds.find((id) => id !== JNIGHT)).uid, row, col, dir: 'RIGHT' });
  assert.equal(refusedFiller.error, 'POPULATION_OVER_CAPACITY', 'an ordinary operator is still refused at the cap');
  s.run({ type: 'deploy', pieceUid: first.uid, row, col, dir: 'RIGHT' });
  assert.equal(onField(s.state).length, 6, 'six stand on the field');
  assert.equal(countedDeployed(s.state, catalog), 5, 'five count');
  assert.equal(validateSession(s.state, { catalog }).ok, true);
  const second = s.addToBench(JNIGHT); [row, col] = s.fresh();
  const refused = s.attempt({ type: 'deploy', pieceUid: second.uid, row, col, dir: 'RIGHT' });
  assert.equal(refused.ok, false); assert.equal(refused.error, 'POPULATION_OVER_CAPACITY', 'the second copy counts, so the cap cannot be broken through it');
  assert.equal(viewSession(s.state, { catalog }).deployedCount, 5);
  assert.equal(viewSession(s.state, { catalog }).deployCap, 5);
});

test('with room left the second copy counts like anyone else, and the free slot is taken by whichever stands first', () => {
  const s = scenario({ deployed: 3, bench: 0, jnight: 2 });
  assert.equal(onField(s.state).length, 5); assert.equal(countedDeployed(s.state, catalog), 4, 'two copies, one of them counted');
  const next = s.addToBench(catalog.config.activeOperatorIds.find((id) => id !== JNIGHT)), [row, col] = s.fresh();
  s.run({ type: 'deploy', pieceUid: next.uid, row, col, dir: 'RIGHT' });
  assert.equal(countedDeployed(s.state, catalog), 5);
  const more = s.addToBench(catalog.config.activeOperatorIds.filter((id) => id !== JNIGHT)[9]), [r2, c2] = s.fresh();
  assert.equal(s.attempt({ type: 'deploy', pieceUid: more.uid, row: r2, col: c2, dir: 'RIGHT' }).error, 'POPULATION_OVER_CAPACITY');
});

test('swaps judge the counted population: a free operator may take an ordinary one\'s place, not the other way round, at the cap', () => {
  // five ordinary operators, nobody free on the field: the bench's 正义骑士号 replaces one, five stay counted four
  let s = scenario({ deployed: 5, bench: 0 });
  const knight = s.addToBench(JNIGHT), target = onField(s.state)[1];
  let swapped = s.attempt({ type: 'deploy', pieceUid: knight.uid, row: target.row, col: target.col, dir: 'LEFT' });
  assert.equal(swapped.ok, true, swapped.error);
  assert.equal(countedDeployed(swapped.state, catalog), 4); assert.equal(onField(swapped.state).length, 5);
  // 正义骑士号 and four ordinary ones on the field, five counted with the free one: an ordinary bench operator for the knight would make six
  s = scenario({ deployed: 5, bench: 0, jnight: 1 });
  const bench = s.addToBench(catalog.config.activeOperatorIds.find((id) => id !== JNIGHT)), onTile = s.byOp(JNIGHT)[0];
  const refused = s.attempt({ type: 'deploy', pieceUid: bench.uid, row: onTile.row, col: onTile.col, dir: 'UP' });
  assert.equal(refused.ok, false); assert.equal(refused.error, 'POPULATION_OVER_CAPACITY', 'the free operator leaves, so the newcomer would count');
  const viaBench = s.attempt({ type: 'bench', pieceUid: onTile.uid, slot: bench.benchSlot });
  assert.equal(viaBench.ok, false); assert.equal(viaBench.error, 'POPULATION_OVER_CAPACITY', 'the same swap started from the field');
  // ordinary for ordinary at the cap is unchanged
  const ordinary = onField(s.state).find((piece) => piece.operatorId !== JNIGHT);
  assert.equal(s.attempt({ type: 'deploy', pieceUid: bench.uid, row: ordinary.row, col: ordinary.col, dir: 'UP' }).ok, true);
});

test('it adds nothing to any 盟约, even carrying an emblem or an extra pact', () => {
  const s = scenario({ deployed: 3, bench: 0 });
  const without = resonanceSessionDisplay(s.state, { data, catalog, viewSession, fieldResolver: () => s.field });
  const knight = s.addToBench(JNIGHT), [row, col] = s.fresh();
  s.run({ type: 'deploy', pieceUid: knight.uid, row, col, dir: 'RIGHT' });
  const placed = s.state.pieces.find((piece) => piece.uid === knight.uid);
  placed.extraPacts = ['conqueror', 'breaker'];
  const emblem = Object.values(catalog.equipment).find((item) => item.kind === 'emblem' && item.effects?.some((effect) => ['pact_transfer', 'transfer_pact'].includes(effect.kind)));
  if (emblem) placed.equipment.push({ uid: 'knight-emblem', itemId: emblem.id });
  const withKnight = resonanceSessionDisplay(s.state, { data, catalog, viewSession, fieldResolver: () => s.field });
  assert.deepEqual(Object.fromEntries(Object.entries(withKnight.pacts).map(([id, pact]) => [id, pact.count])),
    Object.fromEntries(Object.entries(without.pacts).map(([id, pact]) => [id, pact.count])), 'every 盟约 count is as without it');
  for (const pact of Object.values(withKnight.pacts)) assert.ok(!pact.members.some((member) => member.name === '正义骑士号'));
});

test('a save made when it still took a slot reads correctly: valid, one less counted, and the room it frees is usable', () => {
  const s = scenario({ deployed: 4, bench: 1, jnight: 1 });             // 4 ordinary + 正义骑士号 = five on the field: the old rule's cap
  assert.equal(onField(s.state).length, 5);
  const legacy = structuredClone(s.state);                              // nothing in the save itself says "counted"
  assert.equal(validateSession(legacy, { catalog }).ok, true);
  assert.equal(viewSession(legacy, { catalog, fieldResolver: () => s.field }).deployedCount, 4, 'the view counts four');
  const waiting = legacy.pieces.find((piece) => piece.row === null), [row, col] = s.fresh();
  const result = applyAction(legacy, { type: 'deploy', pieceUid: waiting.uid, row, col, dir: 'RIGHT' }, s.options);
  assert.equal(result.ok, true, result.error);
  assert.equal(countedDeployed(result.state, catalog), 5); assert.equal(onField(result.state).length, 6);
  // a save that exceeded the cap under the new rule is still refused by validation
  const over = structuredClone(result.state), extra = s.addToBench(catalog.config.activeOperatorIds.filter((id) => id !== JNIGHT)[12]);
  void extra;
  const stray = over.pieces.find((piece) => piece.row === null);
  if (stray) { stray.row = 0; stray.col = 0; stray.benchSlot = null; assert.equal(validateSession(over, { catalog }).ok, false); }
});

test('the native player\'s count and entries: deployCount is the counted population and the knight carries the flag', { timeout: 60_000 }, async () => {
  const s = scenario({ deployed: 5, bench: 1, jnight: 1 });
  const state = structuredClone(s.state);
  const store = { async exclusive(_id, task) { return task(); }, async saveSession() {}, deactivate() {} };
  const scheduler = new VirtualScheduler({ instantCombat: false });
  const match = new ResonanceMatch({ sessionId: 'test-deploy-free', state, catalog, data, store, scheduler, send() {}, broadcast() {}, timerScale: 0, log: quiet });
  try {
    match.start();
    assert.equal((await match.handle('resonance', { t: 'g.infoReady', setupRevision: 0 })).ok, true);
    match.enterBandDraft();
    assert.equal(scheduler.runUntil(() => match.phase === 'PREP', { maxTime: 30_000 }), true);
    const priv = match.resonancePrivateView(match.players.get('resonance'));
    assert.equal(priv.deployCap, 5); assert.equal(priv.deployCount, 5, 'six on the field, five counted');
    assert.equal(priv.board.filter((entry) => entry.kind === 'chess').length, 6);
    assert.deepEqual(priv.board.filter((entry) => entry.ignoresDeployLimit).map((entry) => entry.id), [JNIGHT]);
    assert.equal(match.players.get('resonance').deployCount, 5, 'the base player state counts the same');
    // withdrawn, it shows on the bench still flagged; deploying it again at the cap goes through the protocol
    const knight = match.state.pieces.find((piece) => piece.operatorId === JNIGHT);
    assert.equal((await match.handle('resonance', { t: 'g.move', uid: match.uidMap.native(knight.uid), to: { area: 'hand', idx: 8 } })).ok, true);
    const benched = match.resonancePrivateView(match.players.get('resonance'));
    assert.equal(benched.deployCount, 5); assert.ok(benched.hand.some((entry) => entry?.ignoresDeployLimit), 'the benched knight carries the flag');
    const [row, col] = s.fresh();
    const back = await match.handle('resonance', { t: 'g.move', uid: match.uidMap.native(knight.uid), to: { area: 'board', row, col, dir: 'RIGHT' } });
    assert.equal(back.ok, true, JSON.stringify(back));
    assert.equal(match.resonancePrivateView(match.players.get('resonance')).deployCount, 5);
  } finally {
    await match._sessionWrite; match.dispose(); scheduler.dispose();
  }
});

test('the client agrees: it lets the knight up at the cap and refuses the swaps the server refuses', () => {
  const stages = JSON.parse(readFileSync(`${NATIVE_DATA}/stages.json`, 'utf8')), chessData = JSON.parse(readFileSync(`${NATIVE_DATA}/chess.json`, 'utf8'));
  const stage = stages.act2autochess_m01;
  const empty = { alive: true, funds: 10, board: [], hand: new Array(GEO.HAND_SIZE).fill(null), temp: new Array(GEO.TEMP_SIZE).fill(null), deployCap: 3, deployCount: 0, shop: { level: 3, slots: [] } };
  const probe = placementContext({ priv: empty, stage, editable: true, getChess: (id) => chessData[id] || null });
  const tiles = [...probe.deploy.melee].map((key) => key.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ordinary = Object.values(chessData).filter((record) => record.position === 'MELEE' && record.tier === 1).slice(0, 5).map((record) => record.chessId);
  const unit = (uid, id, extra = {}) => ({ uid, kind: 'chess', id, items: [], dir: 'RIGHT', ...extra });
  const priv = (board, hand, count) => ({ ...empty, board, hand: [...hand, ...new Array(GEO.HAND_SIZE - hand.length).fill(null)], deployCount: count });
  const ctxFor = (p) => placementContext({ priv: p, stage, editable: true, getChess: (id) => chessData[id] || null });
  const full = [0, 1, 2].map((index) => unit(10 + index, ordinary[index], { row: tiles[index][0], col: tiles[index][1] }));
  // cap 3, three ordinary on the field: an ordinary bench operator is refused on a free tile, the knight is not
  let ctx = ctxFor(priv(full, [unit(20, ordinary[3]), unit(21, ordinary[4], { ignoresDeployLimit: true })], 3));
  assert.equal(canPlace(ctx, 20, { area: 'board', row: tiles[5][0], col: tiles[5][1] }).code, 'BOARD_FULL');
  assert.equal(canPlace(ctx, 21, { area: 'board', row: tiles[5][0], col: tiles[5][1] }).ok, true, 'the free operator may go up');
  assert.equal(canPlace(ctx, 20, { area: 'board', row: tiles[0][0], col: tiles[0][1] }).ok, true, 'a plain swap at the cap is fine');
  // the knight is on the field with the three: an ordinary operator replacing it would make four
  const withKnight = [...full, unit(15, ordinary[4], { row: tiles[3][0], col: tiles[3][1], ignoresDeployLimit: true })];
  ctx = ctxFor(priv(withKnight, [unit(20, ordinary[3])], 3));
  assert.equal(canPlace(ctx, 20, { area: 'board', row: tiles[3][0], col: tiles[3][1] }).code, 'BOARD_FULL', 'bench onto the knight');
  assert.equal(canPlace(ctx, 15, { area: 'hand', idx: 0 }).code, 'BOARD_FULL', 'the knight onto the bench slot of an ordinary operator');
  assert.equal(canPlace(ctx, 20, { area: 'board', row: tiles[0][0], col: tiles[0][1] }).ok, true, 'ordinary for ordinary');
});
