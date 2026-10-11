import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { validateC2S } from '../../shared/protocol.js';
import { existsSync, readFileSync } from 'node:fs';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { applyAction, createSession, validateSession } from '../../server/modes/resonance/session.js';
import { buildResonanceBattle, getResonanceField, nativeResultForSession, runResonanceBattle } from '../../server/modes/resonance/battle.js';
import { ResonanceMatch, resonanceCatalogPacket } from '../../server/modes/resonance/native-match.js';
import { createResonanceLive } from '../../server/modes/resonance/live.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { syntheticResult } from '../../server/match/fields.js';
import { createBattleFromSpec, compactResult, resonanceResultExtras, fitResult, battleProgress } from '../../server/sim/spec.js';
import { ERR, PROTOCOL_VERSION } from '../../shared/constants.js';
import { summarizeResonanceResult } from '../../shared/resonance/result-summary.js';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import * as simSpec from '../../server/sim/spec.js';

const NATIVE_DATA = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const NATURAL_CAMPAIGN_REPORT='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/resonance/native-natural-campaign.json';

test('V3 native chess projection hides unsupported acquisition equipment text and preserves skills and talents', () => {
  const data = loadData(NATIVE_DATA);
  const nativeChessId = (id, star) => star === 1 ? id : `resonance_${id}_star${star}`;
  const characterId = 'char_4013_kjera';
  const modeCatalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 917 });
  const modeOperator = Object.values(modeCatalog.operators).find((operator) => operator.charId === characterId);
  assert.ok(modeOperator, 'V3 catalog includes 耶拉');
  const modePacket = resonanceCatalogPacket({ data, catalog: modeCatalog, displayCatalog: modeCatalog, nativeChessId });
  const modeRecord = modePacket.data.chess[modeOperator.id];
  const sourceEquipmentGarrison = modeOperator.stars[1].record.garrisonIds.find((id) => data.garrisons?.[id]?.effectType === 'SERVER_GAIN_EQUIP');
  assert.equal(sourceEquipmentGarrison, 'garrison_92_a', 'fixture is tied to the canonical source record');
  assert.ok(!modeRecord.garrisonIds.includes(sourceEquipmentGarrison), 'V3 projection omits the unsupported acquisition effect');
  assert.equal(modeRecord.skill.skillId, modeOperator.fixedSkillId, 'selected fixed skill remains projected');
  assert.deepEqual(modeRecord.talents, modeOperator.stars[1].record.talents, 'native talents remain projected');

  const sharedModeOperator = Object.values(modeCatalog.operators).find((operator) => operator.name === '诗怀雅');
  const sharedEquipmentGarrison = sharedModeOperator.stars[1].record.garrisonIds.find((id) => data.garrisons?.[id]?.effectType === 'SERVER_GAIN_EQUIP');
  assert.ok(sharedEquipmentGarrison, 'shared-roster regression fixture uses an actual source equipment garrison');
  const modeSharedRecord = modePacket.data.chess[sharedModeOperator.id];
  assert.ok(!modeSharedRecord.garrisonIds.includes(sharedEquipmentGarrison), 'V3 omits the unsupported garrison for a shared-roster operator too');

  const legacyCatalog = getResonanceCatalog(data, { rulesVersion: 2, seed: 917 });
  const legacyOperator = Object.values(legacyCatalog.operators).find((operator) => operator.name === '诗怀雅');
  assert.ok(legacyOperator && legacyCatalog.config.activeOperatorIds.includes(legacyOperator.id), 'legacy fixture includes 诗怀雅 in its active pool');
  const legacyPacket = resonanceCatalogPacket({ data, catalog: legacyCatalog, displayCatalog: legacyCatalog, nativeChessId });
  assert.ok(legacyPacket.data.chess[legacyOperator.id].garrisonIds.includes(sharedEquipmentGarrison), 'legacy projection is unchanged');
});

function buildCombatFixture(state, catalog) {
  // These boss fixtures isolate the Native clock/result lifecycle, not natural campaign
  // economy. The explicit fixture treasury is spent through real session buy/XP actions.
  state.gold = 100;
  while (state.level < 6) {
    const level = applyAction(state, { type: 'buyXp' }, { catalog, recording: false });
    assert.equal(level.ok, true, level.error);
    state = level.state;
  }
  let refreshes = 0;
  while (state.pieces.length < 6 && refreshes < 20) {
    const owned = new Set(state.pieces.map((piece) => piece.operatorId));
    const offer = state.shop.offers.find((entry) => entry.operatorId && !owned.has(entry.operatorId));
    if (offer) {
      const bought = applyAction(state, { type: 'buy', offerUid: offer.uid }, { catalog, recording: false });
      assert.equal(bought.ok, true, bought.error);
      state = bought.state;
    } else {
      const refreshed = applyAction(state, { type: 'refresh' }, { catalog, recording: false });
      assert.equal(refreshed.ok, true, refreshed.error);
      state = refreshed.state;
      refreshes++;
    }
  }
  assert.ok(state.pieces.length >= 6, `could only build ${state.pieces.length} distinct operators`);
  return state;
}

class FakeSocket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.messages = []; }
  send(data, callback) { this.messages.push(JSON.parse(data)); callback?.(); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit('close'); }
  receive(message) { this.emit('message', Buffer.from(JSON.stringify(message)), false); }
}

async function waitFor(predicate, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function connectResonanceLive(live, sessionId) {
  const socket = new FakeSocket();
  await live.attach(socket, { url: `/resonance/ws?session=${sessionId}`,
    headers: { host: 'workshop.test', origin: 'http://workshop.test' }, socket: {} });
  socket.receive({ t: 'hello', token: sessionId, name: 'test', version: PROTOCOL_VERSION, rid: 1 });
  await waitFor(() => socket.messages.some((message) => message.t === 'welcome'), 'resonance welcome');
  return socket;
}

test('native ResonanceMatch runs a real NORMAL Battle before one session settlement', { timeout: 240_000 }, async () => {
  const data = loadData(NATIVE_DATA);
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 47 });
  catalog.specialEntities={TFT_TrainingDummy:{id:'TFT_TrainingDummy',kind:'training_dummy',nativeTokenId:'token_10011_beewax_oblisk',maxHp:550,def:30,res:30,attackDisabled:true,canMove:false,blockCount:1}};
  const created = createSession({ seed: 47, difficulty: 'NORMAL', catalog });
  assert.equal(created.ok, true, created.error);
  let state = created.state;
  assert.equal(state.rulesVersion, 3);
  const legal = getResonanceField(state, { data, catalog });
  const first = state.pieces[0];
  const operator = catalog.operators[first.operatorId];
  const position = [...legal.deployMap.entries()].find(([, cell]) => {
    const kind = String(cell?.class ?? cell?.type ?? cell?.position ?? cell?.kind ?? cell).toUpperCase();
    return operator.position === 'RANGED' || kind === 'MELEE' || (kind === 'RANGED' && operator.canDeployHighGround === true);
  });
  assert.ok(position, `no legal starting cell for ${first.operatorId}`);
  const [row, col] = position[0].split(',').map(Number);
  const deployed = applyAction(state, { type: 'deploy', pieceUid: first.uid, row, col, dir: 'RIGHT' }, {
    catalog, fieldResolver: () => legal, recording: false,
  });
  assert.equal(deployed.ok, true, deployed.error);
  state = deployed.state;
  state.specialEntities.push({uid:'se-native-fixture',entityId:'TFT_TrainingDummy',source:'test',row:null,col:null});

  let stored = structuredClone(state);
  const store = {
    async exclusive(_id, task) { return task(); },
    async saveSession(_id, next) { stored = structuredClone(next); },
    deactivate() {},
  };
  const scheduler = new VirtualScheduler({ instantCombat: false });
  const messages = [], runtimeErrors = [];
  const match = new ResonanceMatch({ sessionId: 'test-native-match', state, catalog, data, store, scheduler,
    send: (_id, msg) => messages.push(msg), broadcast: (msg) => messages.push(msg), onEnd() {},
    timerScale: 0, combatSpeed: 2, log: { info() {}, warn(...args) { runtimeErrors.push(args.map(String).join(' ')); }, error(...args) { runtimeErrors.push(args.map(String).join(' ')); }, debug() {} },
  });
  try {
    match.start();
    assert.equal(match.phase, 'INFO_CHECK');
    const infoReady=await match.handle('resonance',{t:'g.infoReady',setupRevision:0});
    assert.equal(infoReady.ok,true,'native briefing confirmation must reach Match INFO_CHECK');
    assert.equal(match.players.get('resonance').infoReady,true);
    match.enterBandDraft();
    assert.equal(scheduler.runUntil(() => match.phase === 'PREP', { maxTime: 30_000 }), true);
    assert.equal(match.state.round, 1);
    const privateView=match.resonancePrivateView(match.players.get('resonance'));
    assert.equal(privateView.hand.length,10);
    assert.equal(privateView.handCapacity,9);
    assert.equal(privateView.hand.filter(Boolean).length,state.pieces.filter((piece)=>piece.row==null).length);
    assert.equal(privateView.hand[9],null,'the native tenth visual slot must not accept Resonance chess or equipment');
    assert.equal(Object.values(privateView.items).length,match.state.inventory.length+match.state.pieces.reduce((n,piece)=>n+piece.equipment.length,0));
    assert.equal(privateView.specialEntities.length,1);assert.equal(privateView.specialEntities[0].id,'token_10011_beewax_oblisk');
    const occupiedCells=new Set(match.state.pieces.filter(piece=>piece.row!==null).map(piece=>`${piece.row},${piece.col}`));
    const dummyCell=[...legal.deployMap.keys()].map(key=>key.split(',').map(Number)).find(([row,col])=>!occupiedCells.has(`${row},${col}`));
    assert.ok(dummyCell);
    const nativeDummyUid=privateView.specialEntities[0].uid;
    assert.equal((await match.handle('resonance',{t:'g.move',uid:nativeDummyUid,to:{area:'board',row:dummyCell[0],col:dummyCell[1]}})).ok,true);
    assert.deepEqual([match.state.specialEntities[0].row,match.state.specialEntities[0].col],dummyCell);
    assert.equal(match.resonancePrivateView(match.players.get('resonance')).deployCount,1,'special entities do not count as deployed chess');
    assert.equal((await match.handle('resonance',{t:'g.move',uid:nativeDummyUid,to:{area:'hand'}})).ok,true);
    assert.equal(match.state.specialEntities[0].row,null,'special entity can be withdrawn and stays withdrawn');
    assert.equal(match.handle('resonance', { t: 'g.ready', ready: true }).ok, true);
    assert.equal(scheduler.runUntil(() => match.phase === 'COMBAT', { maxTime: 1_000 }), true);
    const field = match.fields.find((entry) => entry.players.includes('resonance'));
    assert.ok(field?.cc);
    assert.equal(field.spec.kind, field.kind);
    assert.equal(field.spec.stageId, match.stageId);
    assert.ok(field.spec.spawns.length > 0);
    assert.deepEqual(match.publicView().resonanceCombat, { speed: 2, finishing: false, available: true });
    const battleId = field.battleId;
    scheduler.advance(2_000);
    const elapsedAt2x = match._fieldElapsed(field);
    assert.equal(elapsedAt2x, 4);
    assert.equal(match.handle('resonance', { t: 'g.resonanceCombat', speed: 4 }).ok, true);
    assert.equal(field.battleId, battleId, 'speed control must keep the live Native battle ID');
    assert.equal(match._fieldElapsed(field), elapsedAt2x, 'rate change preserves elapsed game time');
    assert.ok(messages.some((msg) => msg.t === 'b.start' && msg.battleId === battleId && msg.speed === 4),
      'server resends the same battle with its new absolute speed');
    scheduler.advance(1_000);
    assert.equal(match._fieldElapsed(field), elapsedAt2x + 4, 'four game seconds pass per wall second at 4x');
    assert.equal(match.handle('resonance', { t: 'g.pause', on: true }).ok, true);
    const pausedElapsed = match._fieldElapsed(field);
    scheduler.advance(5_000);
    assert.equal(match.handle('resonance', { t: 'g.resonanceCombat', speed: 1 }).ok, true,
      'owner can change rate while paused without moving the simulation clock');
    assert.equal(match._fieldElapsed(field), pausedElapsed);
    assert.equal(match.handle('resonance', { t: 'g.pause', on: false }).ok, true);
    scheduler.advance(1_000);
    assert.equal(match._fieldElapsed(field), pausedElapsed + 1, 'resume uses the selected 1x rate');
    field.mode = 'server';
    assert.equal(match.handle('resonance', { t: 'g.resonanceCombat', speed: 2 }).error, ERR.WRONG_PHASE,
      'client speed controls reject server-taken-over fields');
    field.mode = 'client';
    assert.equal(match.handle('resonance', { t: 'g.resonanceCombat', finish: true }).ok, true);
    assert.equal(match.gameSpeed, 32);
    assert.deepEqual(match.publicView().resonanceCombat, { speed: 32, finishing: true, available: true });
    assert.ok(messages.some((msg) => msg.t === 'b.start' && msg.battleId === battleId && msg.speed === 32),
      'natural fast finish remains on the same b.start battle');
    assert.equal(match.handle('resonance', { t: 'g.resonanceCombat', speed: 2 }).error, ERR.WRONG_PHASE,
      'speed cannot be switched back after continuous finish begins');
    assert.equal(match.handle('resonance', { t: 'g.resonanceCombat', finish: true }).ok, true, 'finish is idempotent');
    await match._sessionWrite;
    assert.equal(stored.nativeRuntime.speed, 32, 'selected rate persists');
    assert.equal(stored.nativeRuntime.selectedSpeed, 1, 'normal preference remains separate from the temporary fast-finish rate');
    assert.equal(stored.nativeRuntime.finishing, true, 'fast-finish state persists');
    assert.equal(stored.nativeCombatSpeed, 1, 'normal preference is persisted outside the per-battle runtime');
    const resumedScheduler = new VirtualScheduler({ instantCombat: false });
    const resumed = new ResonanceMatch({ sessionId: 'test-native-match-resume', state: stored, catalog, data, store,
      scheduler: resumedScheduler, send: (_id, msg) => messages.push(msg), broadcast: (msg) => messages.push(msg),
      timerScale: 0, combatSpeed: 2, log: { info() {}, warn() {}, error() {}, debug() {} } });
    resumed.start();
    assert.equal(resumed.gameSpeed, 32, 'restart restores fast-finish rate before rebuilding clocks');
    assert.ok(messages.some((msg) => msg.t === 'b.start' && msg.battleId === battleId && msg.speed === 32),
      'restart resumes the same battle at its persisted rate');
    resumed.dispose();
    const before = { gold: match.state.gold, hp: match.state.hp, round: match.state.round, history: match.state.history.length, revision: match.state.revision };
    const handlers = new Map(), frames = [], sentResults = [];
    const storeListeners = new Set();
    let runnerStoreState = { match: { public: { phase: 'COMBAT', paused: false } } };
    const runnerStore = {
      get: () => runnerStoreState,
      patch(key, value) {
        runnerStoreState = { ...runnerStoreState, [key]: { ...(runnerStoreState[key] ?? {}), ...value } };
        for (const listener of storeListeners) listener(runnerStoreState);
      },
      subscribe(listener) { storeListeners.add(listener); return () => storeListeners.delete(listener); },
    };
    let runnerNow = 1_000, battleConstructions = 0;
    const instrumentedSpec = { ...simSpec, createBattleFromSpec(...args) {
      battleConstructions++;
      return simSpec.createBattleFromSpec(...args);
    } };
    const runnerNet = {
      on(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); return () => handlers.get(type)?.delete(fn); },
      emit(type, message) { for (const fn of handlers.get(type) ?? []) fn({ t: type, ...message }); },
      send(type, fields) { return match.handle('resonance', { t: type, ...fields }); },
      request(type, fields) {
        if (type === 'b.result') sentResults.push({ ...fields });
        // WebSocket request handling crosses an asynchronous transport boundary.
        // Keep the native session action real while preventing the fixture from
        // settling inside Runner's synchronous request() call stack.
        return Promise.resolve().then(() => match.handle('resonance', { t: type, ...fields })).then((response) => {
          if (response?.error) throw Object.assign(new Error(response.detail || response.error), { code: response.error });
          return { t: 'ok' };
        });
      },
    };
    const runner = createBattleRunner({ net: runnerNet, store: runnerStore, doc: { hidden: false, addEventListener() {} },
      now: () => runnerNow, raf: (fn) => { frames.push(fn); return frames.length; }, caf() {},
      setInterval() { return 1; }, clearInterval() {}, loadSim: async () => ({ spec: instrumentedSpec, ds: data }),
      logger: { info() {}, warn() {}, error() {}, debug() {} } });
    const flushRunnerMicrotasks = async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve)); };
    const advanceRunner = (ms, stepMs = 1000 / 60) => {
      const end = runnerNow + ms;
      while (runnerNow < end) {
        const next = Math.min(end, runnerNow + stepMs), delta = next - runnerNow;
        runnerNow = next;
        scheduler.advance(delta);
        for (const frame of frames.splice(0)) frame(runnerNow);
      }
    };
    const initialStart = messages.find((msg) => msg.t === 'b.start' && msg.battleId === battleId && msg.speed === 2);
    assert.ok(initialStart, 'the original Native b.start begins at the default 2x rate');
    try {
      runnerNet.emit('b.start', initialStart);
      await flushRunnerMicrotasks();
      const runnerEntry = runner._entries.get(battleId);
      assert.ok(runnerEntry, 'the actual browser Runner constructs the Native spec');
      const actualBattle = runnerEntry.battle;
      advanceRunner(500);
      const at2x = actualBattle.time;
      assert.ok(at2x >= 0.9 && at2x <= 1.1, `Runner advances one simulated second at 2x: ${at2x}`);
      const speed4Start = messages.find((msg) => msg.t === 'b.start' && msg.battleId === battleId && msg.speed === 4);
      runnerNet.emit('b.start', speed4Start);
      await flushRunnerMicrotasks();
      assert.equal(runner._entries.get(battleId).battle, actualBattle, 'same-ID rate update does not reconstruct the Battle');
      assert.equal(actualBattle.time, at2x, 'same-ID rate reanchor is continuous');
      advanceRunner(250);
      assert.ok(Math.abs(actualBattle.time - (at2x + 1)) < 0.1, 'Runner advances at absolute 4x after the same-ID update');
      assert.equal(match.handle('resonance', { t: 'g.pause', on: true }).ok, true);
      runnerStore.patch('match', { public: { phase: 'COMBAT', paused: true } });
      const atPause = actualBattle.time;
      advanceRunner(5_000);
      assert.equal(actualBattle.time, atPause, 'Runner freezes its existing simulation while Native pause is active');
      const speed1Start = messages.find((msg) => msg.t === 'b.start' && msg.battleId === battleId && msg.speed === 1);
      runnerNet.emit('b.start', speed1Start);
      await flushRunnerMicrotasks();
      assert.equal(actualBattle.time, atPause, 'rate change during pause retains the same frozen simulation tick');
      assert.equal(match.handle('resonance', { t: 'g.pause', on: false }).ok, true);
      runnerStore.patch('match', { public: { phase: 'COMBAT', paused: false } });
      advanceRunner(500);
      assert.ok(Math.abs(actualBattle.time - (atPause + 0.5)) < 0.1, 'Runner resumes continuously at 1x');
      const fastStart = messages.find((msg) => msg.t === 'b.start' && msg.battleId === battleId && msg.speed === 32);
      runnerNet.emit('b.start', fastStart);
      await flushRunnerMicrotasks();
      assert.equal(runner._entries.get(battleId).battle, actualBattle, 'fast finish keeps the same Battle object');
      const preFinishTick = actualBattle.tickCount;
      assert.ok(!actualBattle.finished, 'fast finish begins before the natural Battle end');
      for (let i = 0; i < 12 && !runnerEntry.done; i++) { advanceRunner(500, 1000 / 60); await flushRunnerMicrotasks(); }
      assert.equal(runnerEntry.done, true, '32x advances the live simulation to its natural result');
      assert.equal(actualBattle.finished, true);
      assert.equal(actualBattle.errorCount, 0, JSON.stringify(actualBattle.errors?.slice(0, 5) ?? []));
      assert.ok(actualBattle.tickCount > preFinishTick, 'fast finish advances ticks instead of forcing or replacing the Battle');
      assert.equal(battleConstructions, 1, 'all rate changes reuse the single constructed Native Battle');
      assert.equal(sentResults.length, 1, 'natural finish sends exactly one b.result');
      assert.notEqual(sentResults[0].result.reason, 'forced', 'fast finish does not force an outcome');
    } finally {
      runner.dispose();
    }
    const result = sentResults[0]?.result;
    assert.ok(result, 'the actual Runner delivered a Native result');
    assert.equal(match.state.gold, before.gold, 'client report must not settle synchronously');
    assert.equal(field.done, true, 'native Match must accept the real completed Runner result');
    match._afterCombat();
    match._afterCombat();
    // Native _finishCombat schedules _afterCombat; its override awaits the shared session store.
    // Advance the native timer first, then yield to that real async store transaction.
    scheduler.runUntil(() => scheduler.pending() === 0 || scheduler.nextAt() > scheduler.now(), { maxTime: 5_000, maxSteps: 100 });
    await new Promise((resolve) => setImmediate(resolve));
    await match._sessionWrite;
    assert.equal(match.phase, 'SETTLE', JSON.stringify({ phase: match.phase, fieldDone: field.done, errors: runtimeErrors }));
    assert.equal(match.state.history.length, before.history + 1);
    assert.equal(match.state.revision, before.revision + 1);
    assert.equal(match.phase, 'SETTLE');
    const settled = { revision: match.state.revision, gold: match.state.gold, hp: match.state.hp, history: match.state.history.length };
    match.handle('resonance', { t: 'b.result', battleId: field.battleId, result });
    await new Promise((resolve) => setImmediate(resolve));
    await match._sessionWrite;
    assert.deepEqual({ revision: match.state.revision, gold: match.state.gold, hp: match.state.hp, history: match.state.history.length }, settled);
    assert.deepEqual(stored, match.state);
    assert.ok(messages.some((msg) => msg.t === 'b.start'));
    assert.ok(match.state.prototypeMeta?.lastBattle, 'v3 result hook must persist real completed battle metadata');
    assert.equal(match.state.prototypeMeta.lastBattle.battleId, field.battleId);
    assert.equal(match.state.prototypeMeta.economy.processedBattleIds.filter((id) => id === field.battleId).length, 1,
      'the shared result/economy hook must process a native battle once even after duplicate b.result');
    assert.equal(match.gameSpeed, 1, 'settlement restores the selected normal rate after deleting fast-finish runtime');
    assert.equal(match.nativeCombatSpeed, 1);
    assert.equal(match.state.nativeRuntime, undefined, 'completed field runtime is cleared before the next node');
    assert.deepEqual(match.publicView().resonanceCombat, { speed: 1, finishing: false, available: false },
      'settled prep state advertises the saved normal preference, never a stale 32x field');
    const prepRestored = new ResonanceMatch({ sessionId: 'test-native-match-prep-resume', state: match.state, catalog, data, store,
      scheduler: new VirtualScheduler({ instantCombat: false }), send: (_id, msg) => messages.push(msg), broadcast: () => {},
      timerScale: 0, combatSpeed: 2, log: { info() {}, warn() {}, error() {}, debug() {} } });
    prepRestored.start();
    assert.equal(prepRestored.phase, 'INFO_CHECK', 'a saved prep state restarts through Native briefing, not as a live fast battle');
    assert.equal(prepRestored.gameSpeed, 1, 'normal preference survives a reconnect after field runtime cleanup');
    assert.equal(prepRestored.fields.length, 0, 'PREP restore does not reconstruct a completed 32x combat');
    prepRestored.dispose();
    let supplyActionCalls = 0;
    const enqueueSessionAction = match.enqueueSessionAction.bind(match);
    match.enqueueSessionAction = (action, ...args) => {
      if (action?.type === 'advanceSupply') supplyActionCalls++;
      return enqueueSessionAction(action, ...args);
    };
    const settledHistoryCount = match.state.history.filter((entry) => entry.type === 'fight-settled').length;
    match.phase = 'PREP';
    assert.equal(match.state.nodeStarted, false, 'settlement leaves the next campaign node unstarted');
    assert.equal(match.handle('resonance', { t: 'g.ready', ready: true }).error, ERR.WRONG_PHASE,
      'Native cannot start a field while session supply is unadvanced');
    match.phase = 'SETTLE';
    match.afterSettle();
    assert.ok(match._supplyAdvancePromise, 'a new unstarted session node is advanced before Native ROUND_START');
    const supplyPromise = match._supplyAdvancePromise;
    assert.equal(match.startRound(2), supplyPromise, 'duplicate round entry joins the pending supply transaction');
    assert.equal(match.handle('resonance', { t: 'g.ready', ready: true }).error, ERR.WRONG_PHASE,
      'ready cannot bypass the serialized supply step');
    await supplyPromise;
    await match._sessionWrite;
    assert.equal(match.state.nodeStarted, true, 'supply is persisted before entering the next Native round');
    assert.equal(match.state.claimedNodes.filter((node) => node === 2).length, 1, 'the next node is claimed once');
    assert.equal(supplyActionCalls, 1, 'the queued supply action is issued exactly once');
    assert.equal(match.round, 2, 'the same real Match advances to its next campaign round');
    assert.equal(match.gameSpeed, 1, 'the next round starts with the selected 1x rate, never 32x');
    assert.equal(scheduler.runUntil(() => match.phase === 'PREP', { maxTime: 5_000 }), true,
      'the next round follows Native ROUND_START directly into its real prep phase');
    assert.equal(match.handle('resonance', { t: 'g.ready', ready: true }).ok, true);
    assert.equal(scheduler.runUntil(() => match.phase === 'COMBAT', { maxTime: 1_000 }), true);
    const nextField = match.fields.find((entry) => entry.players.includes('resonance'));
    assert.ok(nextField?.cc && nextField.battleId !== battleId, 'next round constructs a distinct real Native field');
    assert.equal(match.gameSpeed, 1);
    assert.equal(match.publicView().resonanceCombat.speed, 1);
    assert.equal(match.publicView().resonanceCombat.finishing, false);
    assert.ok(messages.some((msg) => msg.t === 'b.start' && msg.battleId === nextField.battleId && msg.speed === 1),
      'next b.start uses the saved normal preference rather than leaking fast finish');
    assert.equal(match.state.nativeRuntime.speed, 1);
    assert.equal(match.state.nativeRuntime.selectedSpeed, 1);
    assert.equal(match.state.nativeRuntime.finishing, false);
    const secondBattle = createBattleFromSpec(nextField.spec, data, { recordEvents: false, quiet: true });
    secondBattle.start();
    while (!secondBattle.finished && secondBattle.tickCount < 20_000) secondBattle.step();
    assert.equal(secondBattle.finished, true, 'the second Native round produces a natural completed simulation');
    const secondRaw = compactResult(secondBattle.result());
    const secondExtras = resonanceResultExtras(secondBattle);
    if (secondExtras) secondRaw.resonance = secondExtras;
    const secondProgress = battleProgress(secondBattle);
    assert.equal(match.handle('resonance', { t: 'b.progress', battleId: nextField.battleId, ...secondProgress,
      resolved: secondProgress.killed }).ok, true);
    const secondHistoryCount = match.state.history.filter((entry) => entry.type === 'fight-settled').length;
    const secondFightResult = fitResult(secondRaw, { battleId: nextField.battleId });
    assert.equal(match.handle('resonance', { t: 'b.result', battleId: nextField.battleId, result: secondFightResult }).ok, true);
    scheduler.advance(1_500, 1000 / 60);
    for (let i = 0; i < 20 && match.phase !== 'SETTLE'; i++) await new Promise((resolve) => setImmediate(resolve));
    await match._sessionWrite;
    assert.equal(match.phase, 'SETTLE', 'the second natural result settles through the same Native path');
    assert.equal(match.state.history.filter((entry) => entry.type === 'fight-settled').length, secondHistoryCount + 1,
      'the second completed battle appends exactly one settlement');
    assert.equal(match.state.prototypeMeta.economy.processedBattleIds.filter((id) => id === nextField.battleId).length, 1,
      'the second battle result is processed exactly once');
    const secondSettlement = { gold: match.state.gold, xp: match.state.xp, revision: match.state.revision,
      history: match.state.history.length, claimedNodes: [...match.state.claimedNodes] };
    match.handle('resonance', { t: 'b.result', battleId: nextField.battleId, result: secondFightResult });
    await new Promise((resolve) => setImmediate(resolve));
    await match._sessionWrite;
    assert.deepEqual({ gold: match.state.gold, xp: match.state.xp, revision: match.state.revision,
      history: match.state.history.length, claimedNodes: [...match.state.claimedNodes] }, secondSettlement,
      'duplicate result cannot repeat round economy, supply, or settlement');
  } finally {
    await match._sessionWrite;
    match.dispose();
    scheduler.dispose();
  }
});

test('Native PREP permits shop, move, and equip actions while a reward choice is pending', { timeout: 30_000 }, async () => {
  const data=loadData(NATIVE_DATA),catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:481});
  const created=createSession({seed:481,difficulty:'NORMAL',catalog});assert.equal(created.ok,true,created.error);
  let state=created.state;state.gold=20;
  const field=getResonanceField(state,{data,catalog});
  const piece=state.pieces[0],operator=catalog.operators[piece.operatorId];
  const cell=[...field.deployMap.entries()].find(([key,tile])=>{
    const kind=String(tile?.class??tile?.type??tile?.position??tile?.kind??tile).toUpperCase();
    return operator.position==='RANGED'||kind==='MELEE'||kind==='RANGED'&&operator.canDeployHighGround===true;
  });
  assert.ok(cell,'starter has a legal field cell');
  const [row,col]=cell[0].split(',').map(Number);
  const deployed=applyAction(state,{type:'deploy',pieceUid:piece.uid,row,col,dir:'RIGHT'},{catalog,fieldResolver:()=>field,recording:false});
  assert.equal(deployed.ok,true,deployed.error);state=deployed.state;
  const item=Object.values(catalog.equipment).find((entry)=>entry.kind==='completed'&&entry.grantAllowed!==false);
  assert.ok(item,'catalog provides a real equip target');
  state.inventory.push({uid:'choice-window-item',itemId:item.id});
  let stored=structuredClone(state);
  const store={async exclusive(_id,task){return task();},async saveSession(_id,next){stored=structuredClone(next);},deactivate(){}};
  const scheduler=new VirtualScheduler({instantCombat:false});
  const match=new ResonanceMatch({sessionId:'test-choice-window',state,catalog,data,store,scheduler,send(){},broadcast(){},timerScale:0,
    log:{info(){},warn(){},error(){},debug(){}}});
  try{
    match.start();
    assert.equal((await match.handle('resonance',{t:'g.infoReady',setupRevision:0})).ok,true);
    match.enterBandDraft();
    assert.equal(scheduler.runUntil(()=>match.phase==='PREP',{maxTime:30_000}),true);
    const emblemId=catalog.prototypeEmblemItems[0];
    const choice={uid:'choice-window-reward',type:'transfer',source:'fixture',options:[emblemId],remaining:1};
    match.state.pendingChoices.push(choice);match.state.phase='choice';match.syncPlayer();
    await store.saveSession(match.sessionId,match.state);
    const beforeGold=match.state.gold;

    const offerSlot=match.state.shop.offers.findIndex((offer)=>offer.operatorId);
    assert.ok(offerSlot>=0,'a real shop offer is available');
    const bought=await match.handle('resonance',{t:'g.buy',slot:offerSlot});
    assert.equal(bought.ok,true,bought.error);
    assert.ok(match.state.gold<beforeGold,'the native shop action consumed its real cost');
    assert.equal(match.state.phase,'choice');assert.equal(match.state.pendingChoices[0].uid,choice.uid);

    const nativeUid=match.uidMap.native(piece.uid);
    const benched=await match.handle('resonance',{t:'g.move',uid:nativeUid,to:{area:'hand',idx:0}});
    assert.equal(benched.ok,true,benched.error);
    assert.equal(match.state.pieces.find((entry)=>entry.uid===piece.uid).row,null);
    assert.equal(match.state.phase,'choice');assert.equal(match.state.pendingChoices[0].uid,choice.uid);
    const redeployed=await match.handle('resonance',{t:'g.move',uid:nativeUid,to:{area:'board',row,col,dir:'RIGHT'}});
    assert.equal(redeployed.ok,true,redeployed.error);

    const equip=await match.handle('resonance',{t:'g.equip',itemUid:match.uidMap.native('choice-window-item'),targetUid:nativeUid});
    assert.equal(equip.ok,true,equip.error);
    assert.equal(match.state.pieces.find((entry)=>entry.uid===piece.uid).equipment[0].itemId,item.id);
    assert.equal(match.state.phase,'choice');assert.equal(match.state.pendingChoices[0].uid,choice.uid);
    assert.equal(match.handle('resonance',{t:'g.ready',ready:true}).error,'WRONG_PHASE','ready cannot bypass a pending choice');

    const claimed=await match.handle('resonance',{t:'g.resonance',action:{type:'claimReward',choiceUid:choice.uid,optionIds:[emblemId]}});
    assert.equal(claimed.ok,true,JSON.stringify(claimed));
    assert.equal(match.state.phase,'prep');assert.equal(match.state.pendingChoices.length,0);
    assert.equal(match.handle('resonance',{t:'g.ready',ready:true}).ok,true,'native ready works after the choice is resolved');
  }finally{
    await match._sessionWrite;match.dispose();scheduler.dispose();
  }
});

test('session bench slots preserve the native 9-slot hand, occupied swap, and invalid move atomicity',()=>{
  const data=loadData(NATIVE_DATA),catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:123});
  const created=createSession({seed:123,difficulty:'NORMAL',catalog});assert.equal(created.ok,true,created.error);
  let state=created.state;
  assert.deepEqual(state.pieces.map((piece)=>piece.benchSlot),[0,1,2]);
  const field=getResonanceField(state,{data,catalog});
  const piece=state.pieces[0],operator=catalog.operators[piece.operatorId];
  const position=[...field.deployMap.entries()].find(([,entry])=>{
    const kind=String(entry?.class??entry?.type??entry?.position??entry?.kind??entry).toUpperCase();
    return operator.position==='RANGED'||kind==='MELEE'||kind==='RANGED'&&operator.canDeployHighGround===true;
  });
  assert.ok(position,'starter has a real legal deployment cell');
  const [row,col]=position[0].split(',').map(Number);
  let moved=applyAction(state,{type:'deploy',pieceUid:piece.uid,row,col,dir:'RIGHT'},
    {catalog,fieldResolver:()=>field,recording:false});
  assert.equal(moved.ok,true,moved.error);state=moved.state;
  moved=applyAction(state,{type:'bench',pieceUid:piece.uid,slot:1},{catalog,fieldResolver:(s)=>getResonanceField(s,{data,catalog}),recording:false});
  assert.equal(moved.ok,true,moved.error);state=moved.state;
  assert.equal(state.pieces.find((entry)=>entry.uid===piece.uid).benchSlot,1);
  assert.equal(state.pieces.find((entry)=>entry.uid===state.pieces[1].uid).row,row);
  assert.equal(state.pieces.find((entry)=>entry.uid===state.pieces[1].uid).col,col);
  const reordered=applyAction(state,{type:'bench',pieceUid:piece.uid,slot:2},{catalog,recording:false});
  assert.equal(reordered.ok,true,reordered.error);
  assert.equal(reordered.state.pieces.find((entry)=>entry.uid===piece.uid).benchSlot,2);
  assert.equal(reordered.state.pieces.find((entry)=>entry.uid===state.pieces[2].uid).benchSlot,1);
  const invalid=applyAction(state,{type:'bench',pieceUid:piece.uid,slot:9},{catalog,recording:false});
  assert.equal(invalid.ok,false);assert.equal(invalid.error,'BAD_BENCH_SLOT');
  assert.deepEqual(state,moved.state,'failed hand moves leave authoritative state untouched');
});

test('Family training dummy stays outside roster and only enters real specs from a saved legal tile',()=>{
  const data=loadData(NATIVE_DATA),catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:124});
  catalog.specialEntities={TFT_TrainingDummy:{id:'TFT_TrainingDummy',kind:'training_dummy',nativeTokenId:'token_10011_beewax_oblisk',
    maxHp:550,def:30,res:30,attackDisabled:true,canMove:false,blockCount:1}};
  const created=createSession({seed:124,difficulty:'NORMAL',catalog});assert.equal(created.ok,true,created.error);
  const base=created.state,choice=structuredClone(base);choice.pendingChoices.push({uid:'dummy-choice',type:'prototype_economy',source:'family',economyKind:'family_heist',options:['dummy'],remaining:1,
    metadata:{threshold:10,optionDetails:[{id:'dummy',grant:[{kind:'special_entity',id:'TFT_TrainingDummy',count:1}]}]}});choice.phase='choice';
  const claimed=applyAction(choice,{type:'claimReward',choiceUid:'dummy-choice',optionIds:['dummy']},{catalog,recording:false});
  assert.equal(claimed.ok,true,claimed.error);let state=claimed.state;
  assert.equal(state.pieces.length,base.pieces.length);assert.equal(state.specialEntities.length,1);
  assert.equal(state.specialEntities[0].row,null);assert.equal(state.specialEntities[0].col,null);
  assert.equal(state.pieces.filter((piece)=>piece.row!==null).length,0,'a dummy does not consume chess population');
  const field=getResonanceField(state,{data,catalog}),[cell]=[...field.deployMap.keys()].map(key=>key.split(',').map(Number));assert.ok(cell);
  const placed=applyAction(state,{type:'placeSpecialEntity',entityUid:state.specialEntities[0].uid,row:cell[0],col:cell[1]},
    {catalog,fieldResolver:()=>field,recording:false});assert.equal(placed.ok,true,placed.error);state=placed.state;
  const invalid=applyAction(state,{type:'placeSpecialEntity',entityUid:state.specialEntities[0].uid,row:999,col:999},
    {catalog,fieldResolver:()=>field,recording:false});assert.equal(invalid.ok,false);assert.deepEqual(invalid.state,state);
  const built=buildResonanceBattle(state,{data,catalog});
  const dummy=built.battle.opts.players[0].units.find((unit)=>unit.uid===state.specialEntities[0].uid);
  assert.ok(dummy);assert.equal(dummy.kind,'token');assert.equal(dummy.row,cell[0]);assert.equal(dummy.col,cell[1]);
  assert.equal(dummy.def.stats.maxHp,550);assert.equal(dummy.def.stats.atk,0);assert.equal(dummy.def.stats.blockCnt,1);
  assert.equal(dummy.def.skill,null);assert.deepEqual(dummy.def.talents,[]);assert.equal(dummy.def.spine,'token_10011_beewax_oblisk');
  built.battle.start();
  const dummyRuntime=built.battle.allyUnits.find((unit)=>unit.uid===state.specialEntities[0].uid);
  assert.ok(dummyRuntime);assert.equal(dummyRuntime.profile.noAttack,true);assert.equal(dummyRuntime.base.moveSpeed,0);
  const stored=applyAction(state,{type:'storeSpecialEntity',entityUid:state.specialEntities[0].uid},{catalog,recording:false});
  assert.equal(stored.ok,true,stored.error);assert.equal(stored.state.specialEntities[0].row,null);
  assert.equal(buildResonanceBattle(stored.state,{data,catalog}).battle.opts.players[0].units.some((unit)=>unit.uid===state.specialEntities[0].uid),false);
});

test('session economy claims resolve source selectors and reject unaffordable purchases atomically',()=>{
  const data=loadData(NATIVE_DATA),catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:254});
  const created=createSession({seed:254,difficulty:'NORMAL',catalog});assert.equal(created.ok,true,created.error);
  let state=created.state;
  const component=Object.values(catalog.equipment).find((item)=>item.kind==='component'&&item.grantAllowed!==false);
  assert.ok(component);
  state.pendingChoices.push({uid:'choice-component',type:'prototype_economy',source:'family',economyKind:'family_heist',options:['parts'],remaining:1,
    metadata:{threshold:17,optionDetails:[{id:'parts',grant:[{kind:'component',id:component.id},{kind:'component',id:component.id}]}]}});
  state.phase='choice';
  const claimed=applyAction(state,{type:'claimReward',choiceUid:'choice-component',optionIds:['parts']},{catalog,recording:false});
  assert.equal(claimed.ok,true,claimed.error);assert.deepEqual(claimed.state.inventory.slice(state.inventory.length).map((item)=>item.itemId),[component.id,component.id]);

  const unaffordable=structuredClone(created.state);unaffordable.gold=4;unaffordable.pendingChoices.push({uid:'choice-armory',type:'prototype_economy',source:'armory',economyKind:'junker_armory',options:['upgrade'],remaining:1,
    metadata:{optionDetails:[{id:'upgrade',cost:{currency:'gold',amount:5},grant:[{kind:'rumble_upgrade',id:'TFT13_JunkerKing_Pass',targetUid:'missing'}]}]}});unaffordable.phase='choice';
  const before=structuredClone(unaffordable),denied=applyAction(unaffordable,{type:'claimReward',choiceUid:'choice-armory',optionIds:['upgrade']},{catalog,recording:false});
  assert.equal(denied.ok,false);assert.equal(denied.error,'NOT_ENOUGH_GOLD');assert.deepEqual(denied.state,before);

  const operatorChoice=structuredClone(created.state);operatorChoice.pendingChoices.push({uid:'choice-operator',type:'prototype_economy',source:'conqueror',economyKind:'war_chest',options:['unit'],remaining:1,
    metadata:{threshold:35,optionDetails:[{id:'unit',grant:[{kind:'operator',targetCost:2}]}]}});operatorChoice.phase='choice';
  const operatorClaim=applyAction(operatorChoice,{type:'claimReward',choiceUid:'choice-operator',optionIds:['unit']},{catalog,recording:false});
  assert.equal(operatorClaim.ok,true,operatorClaim.error);assert.equal(operatorClaim.state.pieces.length,created.state.pieces.length+1);
  assert.equal(catalog.operators[operatorClaim.state.pieces.at(-1).operatorId].cost,2);

  const skipState=structuredClone(created.state);skipState.pendingChoices.push({uid:'choice-skip',type:'prototype_economy',source:'risk',economyKind:'chem_market',options:['skip-market'],remaining:1,
    metadata:{key:'chem:1',healthPerSkip:6,optionDetails:[{id:'skip-market',action:'skip',cost:{currency:'shimmer',amount:0}}]}});skipState.phase='choice';
  const skipped=applyAction(skipState,{type:'claimReward',choiceUid:'choice-skip',optionIds:['skip-market']},{catalog,recording:false});
  assert.equal(skipped.ok,true,skipped.error);assert.equal(skipped.state.prototypeMeta.economy.chemBaron.marketsSkipped,1);
  assert.equal(skipped.state.prototypeMeta.economy.chemBaron.healthFromSkips,6);

  const legacyCatalog=getResonanceCatalog(data,{rulesVersion:2,seed:254}),legacy=createSession({seed:254,difficulty:'NORMAL',catalog:legacyCatalog});
  assert.equal(legacy.ok,true,legacy.error);assert.equal(legacy.state.rulesVersion,2);
  assert.equal(Object.hasOwn(legacy.state,'prototypeMeta'),false);
  assert.equal(legacyCatalog.campaign.economy.xpToLevel[7],56,'legacy V2 economy table remains unchanged');
});

test('V3 gear anvil consumes its source atomically and grants a catalog-backed quality item',()=>{
  const data=loadData(NATIVE_DATA),catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:255});
  const created=createSession({seed:255,difficulty:'NORMAL',catalog});assert.equal(created.ok,true,created.error);
  const state=created.state,item=Object.values(catalog.equipment).find((entry)=>entry.kind==='completed'&&entry.grantAllowed!==false);
  assert.ok(item,'real completed catalog item is available');
  catalog.prototypeEconomy.gearConsumables.prototype_artifact_anvil={id:'prototype_artifact_anvil',kind:'artifact_anvil'};
  catalog.prototypeEconomy.gearPools.artifact=[item.id];
  catalog.prototypeEconomy.qualityEffects.artifact={[item.id]:{mods:{atkPct:0.5},qualityBonus:'test fixture'}};
  state.pendingChoices.push({uid:'choice-anvil-source',type:'prototype_economy',source:'conqueror',economyKind:'war_chest',options:['anvil'],remaining:1,
    metadata:{threshold:660,optionDetails:[{id:'anvil',grant:[{kind:'consumable',id:'prototype_artifact_anvil'}]}]}});
  state.phase='choice';
  const sourceClaim=applyAction(state,{type:'claimReward',choiceUid:'choice-anvil-source',optionIds:['anvil']},{catalog,recording:false});
  assert.equal(sourceClaim.ok,true,sourceClaim.error);
  const sourceUid=sourceClaim.state.consumables.at(-1).uid;
  const opened=applyAction(sourceClaim.state,{type:'useConsumable',consumableUid:sourceUid},{catalog,recording:false});
  assert.equal(opened.ok,true,opened.error);
  const choice=opened.state.pendingChoices.find((entry)=>entry.economyKind==='gear_anvil');assert.ok(choice);
  assert.equal(opened.state.consumables.some((entry)=>entry.uid===sourceUid),true,'opening the selection does not spend the source');
  const option=choice.options[0];
  const claimed=applyAction(opened.state,{type:'claimReward',choiceUid:choice.uid,optionIds:[option]},{catalog,recording:false});
  assert.equal(claimed.ok,true,claimed.error);
  assert.equal(claimed.state.consumables.some((entry)=>entry.uid===sourceUid),false);
  assert.equal(claimed.state.pendingChoices.some((entry)=>entry.uid===choice.uid),false);
  const granted=claimed.state.inventory.at(-1);
  assert.equal(granted.itemId,item.id);assert.equal(granted.quality,'artifact');
  assert.equal(validateSession(claimed.state,{catalog}).ok,true);

  const wrongQuality=structuredClone(state);
  const denied=applyAction(wrongQuality,{type:'useConsumable',consumableUid:'missing',itemUid:'missing'},{catalog,recording:false});
  assert.equal(denied.ok,false);assert.deepEqual(denied.state,wrongQuality,'failed gear actions are atomic');
});

test('nine deployed chess plus three persisted training dummies leave native population full and ready',()=>{
  const data=loadData(NATIVE_DATA),catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:256});
  const created=createSession({seed:256,difficulty:'NORMAL',catalog});assert.equal(created.ok,true,created.error);
  const state=created.state,field=getResonanceField(state,{data,catalog});
  const candidates=catalog.config.activeOperatorIds.slice(0,9),used=new Set();
  assert.equal(candidates.length,9);state.level=9;state.xp=0;
  state.pieces=candidates.map((operatorId,index)=>{
    const operator=catalog.operators[operatorId];
    const cell=[...field.deployMap.entries()].find(([key,tile])=>{
      const kind=String(tile?.class??tile?.type??tile?.position??tile?.kind??tile).toUpperCase();
      return !used.has(key)&&(operator.position==='RANGED'||kind==='MELEE'||kind==='RANGED'&&operator.canDeployHighGround===true);
    });
    assert.ok(cell,`legal tile exists for ${operatorId}`);used.add(cell[0]);
    const [row,col]=cell[0].split(',').map(Number),template=created.state.pieces[0];
    return {...structuredClone(template),uid:`fixture-nine-${index}`,operatorId,star:1,equipment:[],growth:{},row,col,dir:'RIGHT',benchSlot:null};
  });
  const free=[...field.deployMap.keys()].filter((key)=>!used.has(key));assert.ok(free.length>=3,'field provides three distinct entity tiles');
  state.specialEntities=free.slice(0,3).map((key,index)=>{const [row,col]=key.split(',').map(Number);return {uid:`fixture-dummy-${index}`,entityId:'TFT_TrainingDummy',source:'test',row,col};});
  const caps={1:30,2:25,3:18,4:10,5:9};
  for(const id of state.activeOperatorIds){
    const copies=state.pieces.filter((piece)=>piece.operatorId===id).reduce((n,piece)=>n+(piece.star===3?9:piece.star===2?3:1),0);
    const held=state.shop.offers.filter((offer)=>offer.operatorId===id).length;
    state.poolRemaining[id]=caps[catalog.operators[id].cost]-copies-held;
  }
  assert.equal(validateSession(state,{catalog}).ok,true,JSON.stringify(validateSession(state,{catalog}).errors));
  const scheduler=new VirtualScheduler(),store={async exclusive(_id,task){return task();},async saveSession(){},deactivate(){}};
  const match=new ResonanceMatch({sessionId:'test-nine-plus-dummies',state,catalog,data,store,scheduler,send(){},broadcast(){},onEnd(){},
    timerScale:0,log:{info(){},warn(){},error(){},debug(){}}});
  try{
    match.phase='PREP';match.syncPlayer();
    const view=match.resonancePrivateView(match.players.get('resonance'));
    assert.equal(match.players.get('resonance').deployCount,9);
    assert.equal(match.players.get('resonance').deployCap,9);
    assert.equal(view.deployCount,9);assert.equal(view.deployCap,9);assert.equal(view.canReady,true);
    assert.equal(match.players.get('resonance').board.size,12,'all three entities render beside nine chess');
    assert.equal(view.hand.filter(Boolean).length,0);assert.equal(view.handCapacity,9);assert.equal(view.hand[9],null);
    assert.deepEqual(view.specialEntities.map((entity)=>entity.entityId),['TFT_TrainingDummy','TFT_TrainingDummy','TFT_TrainingDummy']);
    assert.equal(view.specialEntities.every((entity)=>entity.definition?.maxHp===550&&entity.definition?.attack===0&&entity.definition?.canMove===false),true);
  }finally{match.dispose();}
});

test('native battle reason cleared still settles as a loss when counted leaks consumed LP', () => {
  const data = loadData(NATIVE_DATA);
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 48 });
  const created = createSession({ seed: 48, difficulty: 'NORMAL', catalog });
  assert.equal(created.ok, true, created.error);
  const result = nativeResultForSession(created.state, {
    reason: 'cleared', total: 10, killed: 10, errors: 0,
    perPlayer: { resonance: { leaked: [{ enemyKey: 'enemy', counted: true, lpr: 6 }], unitStats: [], unitsEnd: [] } },
  }, { data, catalog });
  assert.equal(result.hpLoss, 6);
  assert.equal(result.won, false);
});

test('native Match routes campaign NORMAL, FINAL_ASSAULT, HIDDEN_CORE, and FUNNY logistics through real Runner specs', { timeout: 240_000 }, async () => {
  const data = loadData(NATIVE_DATA);
  const cases = [
    { difficulty: 'NORMAL', round: 14, nativePhase: 'COMBAT', kind: 'normal' },
    { difficulty: 'NORMAL', round: 28, nativePhase: 'FINAL_ASSAULT', kind: 'boss' },
    { difficulty: 'ABYSS', round: 30, nativePhase: 'HIDDEN_CORE', kind: 'hidden' },
  ];
  for (const [index, target] of cases.entries()) {
    const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 109 + index });
    const created = createSession({ seed: 109 + index, difficulty: target.difficulty, catalog });
    assert.equal(created.ok, true, created.error);
    const state = created.state;
    state.round = target.round;
    if (target.kind !== 'normal') Object.assign(state, buildCombatFixture(state, catalog));
    const legal = getResonanceField(state, { data, catalog });
    let preparedState = state;
    const usedCells = new Set();
    for (const piece of [...state.pieces]) {
      const operator = catalog.operators[piece.operatorId];
      const position = [...legal.deployMap.entries()].find(([key, cell]) => {
        if (usedCells.has(key)) return false;
        const kind = String(cell?.class ?? cell?.type ?? cell?.position ?? cell?.kind ?? cell).toUpperCase();
        return operator.position === 'RANGED' || kind === 'MELEE' || (kind === 'RANGED' && operator.canDeployHighGround === true);
      });
      assert.ok(position, `${target.difficulty} R${target.round}: no legal cell for ${piece.operatorId}`);
      const [row, col] = position[0].split(',').map(Number);
      const deployed = applyAction(preparedState, { type: 'deploy', pieceUid: piece.uid, row, col, dir: 'RIGHT' }, {
        catalog, fieldResolver: () => legal, recording: false,
      });
      assert.equal(deployed.ok, true, deployed.error);
      preparedState = deployed.state;
      usedCells.add(position[0]);
    }
    const store = { async exclusive(_id, task) { return task(); }, async saveSession() {}, deactivate() {} };
    let scheduler = new VirtualScheduler({ instantCombat: target.kind === 'normal' });
    let match = new ResonanceMatch({ sessionId: `test-phase-${target.difficulty}-${target.round}`, state: preparedState,
      catalog, data, store, scheduler, send() {}, broadcast() {}, timerScale: target.kind === 'normal' ? 0 : 1, combatSpeed: 2,
      log: { info() {}, warn() {}, error() {}, debug() {} } });
    const messages = [];
    const attachMessages = () => {
      match.sendFn = (_id, msg) => { messages.push(msg); return true; };
      match.broadcastFn = (msg) => messages.push(msg);
    };
    attachMessages();
    let nativeFinalOutcome = null;
    try {
      // This fixture enters the native per-round transition directly; the first-NORMAL
      // test above separately covers INFO_CHECK through the live session entrance.
      match.startRound(target.round);
      assert.equal(scheduler.runUntil(() => match.phase === 'PREP', { maxTime: 30_000 }), true,
        `${target.difficulty} R${target.round} did not reach PREP (phase=${match.phase}, errors=${JSON.stringify(scheduler.errors)})`);
      assert.equal(match.state.round, target.round);
      assert.equal(match.handle('resonance', { t: 'g.ready', ready: true }).ok, true);
      assert.equal(scheduler.runUntil(() => match.phase === target.nativePhase, { maxTime: 10_000 }), true,
        `${target.difficulty} R${target.round} did not enter ${target.nativePhase}`);
      assert.equal(match.phase, target.nativePhase, `${target.difficulty} R${target.round} native phase`);
      let field = match.fields.find((entry) => entry.players.includes('resonance'));
      assert.ok(field?.cc, `${target.difficulty} R${target.round} has no native client field`);
      assert.equal(field.spec.kind, target.kind);
      assert.equal(field.spec.stageId, legal.stageId);
      assert.ok(field.spec.spawns.length > 0, `${target.difficulty} R${target.round} has no real wave spawns`);
      if (target.kind === 'boss' || target.kind === 'hidden') {
        if (target.kind === 'hidden') {
          assert.ok(Number.isFinite(match.teamLp), 'fresh Hidden Core initializes a finite team LP pool');
          assert.equal(match.teamLp, match.state.hp, 'fresh Hidden Core starts from settled campaign HP');
        }
        scheduler.advance(3_000);
        const bossElapsedBeforeRateChange = (match._clockNow() - match._bossStartAt) / 1000 * match.gameSpeed;
        const deadlineGameRemaining = match.deadline ? (match.deadline - match._clockNow()) / 1000 * match.gameSpeed : null;
        const overtimeGameRemaining = match.overtimeAt ? (match.overtimeAt - match._clockNow()) / 1000 * match.gameSpeed : null;
        const bossDamageBudget = match._bossDmgBudget(field), lpBudget = match._bossLpBudget(field);
        assert.equal(match.handle('resonance', { t: 'g.resonanceCombat', speed: 4 }).ok, true,
          `${target.kind} permits the live owner to change Native clock rate`);
        assert.ok(Math.abs((match._clockNow() - match._bossStartAt) / 1000 * match.gameSpeed - bossElapsedBeforeRateChange) < 0.01,
          `${target.kind} preserves boss elapsed game-time`);
        if (deadlineGameRemaining != null) assert.ok(Math.abs((match.deadline - match._clockNow()) / 1000 * match.gameSpeed - deadlineGameRemaining) < 0.01,
          `${target.kind} rescales the Native deadline without changing its remaining game-time`);
        if (overtimeGameRemaining != null) assert.ok(Math.abs((match.overtimeAt - match._clockNow()) / 1000 * match.gameSpeed - overtimeGameRemaining) < 0.01,
          `${target.kind} rescales the overtime clock without changing its remaining game-time`);
        assert.equal(match._bossDmgBudget(field), bossDamageBudget, `${target.kind} damage budget stays continuous across rate changes`);
        assert.equal(match._bossLpBudget(field), lpBudget, `${target.kind} team-LP budget stays continuous across rate changes`);
        const savedBattleId = field.battleId, savedPoolHp = match.bossPool.hp, savedPoolMax = match.bossPool.maxHp;
        const savedTeamLp = match.teamLp;
        assert.equal(match.handle('resonance', { t: 'g.pause', on: true }).ok, true, 'pause the live Native boss field before process restart');
        await match._sessionWrite;
        const savedState = structuredClone(match.state);
        assert.ok(savedState.nativeRuntime.bossRuntime, `${target.kind} runtime snapshot must include Native boss state`);
        assert.equal(savedState.nativeRuntime.bossRuntime.pool.hp, savedPoolHp);
        assert.equal(savedState.nativeRuntime.bossRuntime.pool.maxHp, savedPoolMax);
        assert.equal(savedState.nativeRuntime.bossRuntime.teamLp, savedTeamLp);
        assert.deepEqual(savedState.nativeRuntime.spec, field.spec, `${target.kind} saved Native spec is the complete live spec`);

        // Older snapshots have no bossRuntime clock fields. Their remaining time must
        // follow Native's real-time conversion at the saved combat speed.
        const legacyState = structuredClone(savedState);
        delete legacyState.nativeRuntime.bossRuntime;
        const legacyScheduler = new VirtualScheduler({ instantCombat: false });
        const legacyMatch = new ResonanceMatch({ sessionId: `legacy-clock-${target.difficulty}-${target.round}`, state: legacyState,
          catalog, data, store, scheduler: legacyScheduler, send() {}, broadcast() {}, timerScale: 1, combatSpeed: 2,
          log: { info() {}, warn() {}, error() {}, debug() {} } });
        try {
          legacyMatch.start();
          const legacyElapsed = Math.max(0, Number(legacyState.nativeRuntime.elapsed) || 0);
          const speed = Number(legacyMatch.gameSpeed) || 1;
          const expectedDeadline = Math.max(0, (Number(legacyMatch.gd.bossLevelTime(legacyMatch.round))
            * (Number(legacyMatch.gd.combatTimeScale) || 1) - legacyElapsed) / speed * 1000);
          const expectedOvertime = Math.max(0, (Number(legacyMatch.gd.bossOvertimeAfterReal)
            * (Number(legacyMatch.gd.combatTimeScale) || 1) - legacyElapsed) / speed * 1000);
          assert.equal(legacyMatch.deadline - legacyScheduler.now(), expectedDeadline, `${target.kind} legacy deadline uses Native game-speed conversion`);
          assert.equal(legacyMatch.overtimeAt - legacyScheduler.now(), expectedOvertime, `${target.kind} legacy overtime uses Native game-speed conversion`);
        } finally {
          legacyMatch.dispose();
          legacyScheduler.dispose();
        }
        match.dispose();
        scheduler.dispose();
        scheduler = new VirtualScheduler({ instantCombat: false });
        match = new ResonanceMatch({ sessionId: `test-phase-${target.difficulty}-${target.round}`, state: savedState,
          catalog, data, store, scheduler, send() {}, broadcast() {}, timerScale: 1, combatSpeed: 2,
          log: { info() {}, warn() {}, error() {}, debug() {} } });
        attachMessages();
        match.start();
        assert.equal(match.phase, target.nativePhase, `${target.kind} restore phase`);
        assert.equal(match.paused, true, `${target.kind} restore keeps the saved pause`);
        assert.equal(match.bossPool?.hp, savedPoolHp, `${target.kind} pool HP resumes without reset`);
        assert.equal(match.bossPool?.maxHp, savedPoolMax, `${target.kind} pool maximum resumes`);
        assert.equal(match.teamLp, savedTeamLp, `${target.kind} team LP resumes`);
        assert.equal(match.fields[0]?.battleId, savedBattleId, `${target.kind} battle identity resumes`);
        assert.equal(match.fields[0]?.spec.kind, target.kind, `${target.kind} saved Native spec resumes`);
        assert.deepEqual(match.fields[0]?.spec, savedState.nativeRuntime.spec, `${target.kind} restart preserves the complete Native spec unchanged`);
        assert.ok(messages.some((msg) => msg.t === 'b.start' && msg.battleId === savedBattleId), `${target.kind} sends the same battle start`);
        assert.ok(messages.some((msg) => msg.t === 'b.pool' && msg.hp === savedPoolHp), `${target.kind} broadcasts the restored pool`);
        assert.equal(match.handle('resonance', { t: 'g.pause', on: false }).ok, true, `${target.kind} resumes its saved Native clock`);
        assert.ok(match._bossClock, `${target.kind} boss ticker is re-armed after resume`);
        field = match.fields.find((entry) => entry.players.includes('resonance'));
      }
      const finishFinal = match._finishFinal.bind(match);
      match._finishFinal = (...args) => {
        finishFinal(...args);
        if (match.nativeFinalOutcome) nativeFinalOutcome = structuredClone(match.nativeFinalOutcome);
      };
      const battle = createBattleFromSpec(field.spec, data, { recordEvents: false, quiet: true });
      battle.start();
      if (target.kind === 'boss' || target.kind === 'hidden') {
        const initial = { gold: match.state.gold, hp: match.state.hp, history: match.state.history.length };
        const nativeTeamLpStart = match.teamLp;
        let reportedResult = false, progressReports = 0, nativeClockTicks = 0, duplicateProgressChecked = false;
        const leaksBy = () => {
          const by = {};
          for (const pp of Object.values(battle._perPlayer ?? {})) for (const leak of pp.leaked ?? []) {
            if (leak?.counted === false) continue;
            const pid = leak?.sourcePlayerId ?? 'resonance';
            by[pid] = (by[pid] ?? 0) + (Number.isFinite(leak?.lpr) && leak.lpr >= 0 ? leak.lpr : 1);
          }
          return by;
        };
        const sendResult = () => {
          const raw = compactResult(battle.result());
          const extras = resonanceResultExtras(battle);
          if (extras) raw.resonance = extras;
          match.handle('resonance', { t: 'b.result', battleId: field.battleId, result: fitResult(raw, { battleId: field.battleId }) });
          reportedResult = true;
        };
        // Advance the actual Runner at 2× and the Native clock by matching virtual wall time.
        // Each quarter second is 15 Battle ticks (0.5 game seconds), then a real b.progress report
        // feeds Native's plausibility budgets before its 250 ms boss-clock callback runs.
        for (let wallQuarter = 0; wallQuarter < 1_200 && !field.done; wallQuarter++) {
          for (let tick = 0; tick < 15 && !battle.finished; tick++) battle.step();
          const progress = battleProgress(battle);
          const leakedBy = leaksBy();
          const leaks = Object.values(leakedBy).reduce((sum, value) => sum + value, 0);
          match.handle('resonance', { t: 'b.progress', battleId: field.battleId, ...progress,
            leaks, leaksBy: leakedBy, by: { resonance: progress.bossDmg } });
          if (!duplicateProgressChecked && ((Number(progress.bossDmg) || 0) > 0 || leaks > 0)) {
            const creditedHp = match.bossPool.hp, creditedLp = match.teamLp, creditedDamage = field.bossAcked;
            match.handle('resonance', { t: 'b.progress', battleId: field.battleId, ...progress,
              leaks, leaksBy: leakedBy, by: { resonance: progress.bossDmg } });
            assert.equal(match.bossPool.hp, creditedHp, 'replayed cumulative boss progress is not credited twice');
            assert.equal(match.teamLp, creditedLp, 'replayed cumulative leak progress does not charge LP twice');
            assert.equal(field.bossAcked, creditedDamage, 'replayed cumulative boss ack remains unchanged');
            duplicateProgressChecked = true;
          }
          progressReports++;
          scheduler.advance(250);
          nativeClockTicks++;
          if (messages.some((msg) => msg.t === 'b.end' && msg.battleId === field.battleId) && !battle.finished) battle.forceEnd('forced');
          if (battle.finished && !reportedResult) sendResult();
          await new Promise((resolve) => setImmediate(resolve));
          await match._sessionWrite;
        }
        if (!battle.finished && messages.some((msg) => msg.t === 'b.end' && msg.battleId === field.battleId)) battle.forceEnd('forced');
        if (battle.finished && !reportedResult) sendResult();
        await new Promise((resolve) => setImmediate(resolve));
        await match._sessionWrite;
        assert.ok(field.done, `${target.difficulty} R${target.round} Native boss clock did not accept a terminal result (phase=${match.phase}, pool=${match.bossPool?.hp}, lp=${match.teamLp})`);
        assert.ok(battle.finished && battle.result()?.perPlayer?.resonance,
          `${target.difficulty} R${target.round} lacks a real Runner result ${JSON.stringify({ battleFinished: battle.finished, result: battle.finished ? battle.result()?.reason : null, nativeResult: field.result?.reason, finalEnding: match._finalEnding, progressReports, lp: match.teamLp, pool: match.bossPool?.hp, messages: messages.filter((msg) => ['b.end','b.result'].includes(msg.t)).map((msg) => ({ t: msg.t, reason: msg.reason })) })}`);
        assert.ok(progressReports > 0 && nativeClockTicks > 0, 'Native must consume real progress and clock ticks');
        assert.equal(duplicateProgressChecked, true, 'the duplicate cumulative-frame check uses actual boss damage or leak values');
        assert.ok(field.progress.gt > 0 && field.bossReported, 'Native must retain the Runner progress and boss-pool report');
        assert.ok(nativeFinalOutcome && Number.isFinite(nativeFinalOutcome.teamLp), 'Native final hook must provide its accepted team-LP result');
        assert.equal(match.state.history.length, initial.history + 1, 'Native terminal must settle exactly one Resonance round');
        assert.equal(match.state.hp, Math.max(0, initial.hp - (nativeTeamLpStart - nativeFinalOutcome.teamLp)),
          'Resonance settlement HP must reflect Native team LP loss exactly once');
        assert.ok(match.state.gold !== initial.gold || match.state.hp !== initial.hp || match.state.history.length > initial.history,
          'the accepted Native result must produce the authoritative session result');
      } else battle.step();
      assert.ok(battle.time > 0, `${target.difficulty} R${target.round} Runner did not advance`);
      if (target.kind === 'normal') assert.equal(battle.finished, false, `${target.difficulty} R${target.round} unexpectedly used a DeadBattle terminal`);
      assert.equal(battle.errorCount, 0, JSON.stringify(battle.errors?.slice(0, 3) ?? []));
    } finally {
      match.dispose();
      scheduler.dispose();
    }
  }
});

test('natural R28 winning session closes through the Native Runner and boss clock like direct settlement', { timeout: 360_000 }, async () => {
  assert.equal(existsSync(NATURAL_CAMPAIGN_REPORT), true, `missing natural campaign report: ${NATURAL_CAMPAIGN_REPORT}`);
  const report = JSON.parse(readFileSync(NATURAL_CAMPAIGN_REPORT, 'utf8'));
  const fixture = report.nativeFinalFixtures?.at(-1);
  assert.equal(fixture?.status, 'captured');
  assert.equal(fixture?.expected?.round, 28);
  assert.equal(fixture?.expected?.terminalReason, 'victory');
  assert.equal(fixture?.expected?.finalRow?.won, true);

  const data = loadData(NATIVE_DATA);
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: fixture.seed });
  const initial = structuredClone(fixture.preFightSession);
  const validity = validateSession(initial, { catalog });
  assert.equal(validity.ok, true, JSON.stringify(validity.errors));
  assert.equal(initial.round, 28);
  assert.equal(initial.phase, 'prep');
  assert.equal(initial.pieces.filter((piece) => piece.row != null).length, 8);

  const direct = runResonanceBattle(initial, { data, catalog, recording: false });
  assert.equal(direct.won, true);
  assert.equal(direct.diagnostics.nodeKind, 'boss');
  assert.equal(direct.diagnostics.stageId, fixture.expected.finalRow.stageId);
  assert.equal(direct.diagnostics.errorCount, 0);
  assert.equal(direct.diagnostics.capped, false);
  const directSettlement = applyAction(initial, { type: 'fight' }, { catalog, recording: false, completedResult: direct,
    fieldResolver: (state) => getResonanceField(state, { data, catalog }) });
  assert.equal(directSettlement.ok, true, directSettlement.error);

  const saves = [];
  const store = { async exclusive(_id, task) { return task(); }, async saveSession(_id, state) { saves.push(structuredClone(state)); }, deactivate() {} };
  const scheduler = new VirtualScheduler({ instantCombat: false });
  const match = new ResonanceMatch({ sessionId: 'natural-r28-native-final', state: initial, catalog, data, store, scheduler,
    send() {}, broadcast() {}, timerScale: 1, combatSpeed: 2,
    log: { info() {}, warn() {}, error() {}, debug() {} } });
  const messages = [];
  match.sendFn = (_id, message) => { messages.push(message); return true; };
  match.broadcastFn = (message) => messages.push(message);
  let nativeFinalOutcome = null;
  const finishFinal = match._finishFinal.bind(match);
  match._finishFinal = (...args) => {
    finishFinal(...args);
    if (match.nativeFinalOutcome) nativeFinalOutcome = structuredClone(match.nativeFinalOutcome);
  };
  try {
    match.startRound();
    assert.equal(scheduler.runUntil(() => match.phase === 'PREP', { maxTime: 30_000 }), true,
      `natural R28 did not reach PREP: ${match.phase}; ${JSON.stringify(scheduler.errors)}`);
    assert.equal(match.handle('resonance', { t: 'g.ready', ready: true }).ok, true);
    assert.equal(scheduler.runUntil(() => match.phase === 'FINAL_ASSAULT', { maxTime: 10_000 }), true,
      `natural R28 did not enter Native FINAL_ASSAULT: ${match.phase}`);
    const field = match.fields.find((entry) => entry.players.includes('resonance'));
    assert.ok(field?.cc);
    assert.equal(field.spec.kind, 'boss');
    assert.equal(field.spec.stageId, direct.diagnostics.stageId);
    assert.equal(field.spec.waveId, direct.diagnostics.templateId);
    assert.ok(field.spec.spawns.length > 0);
    const nativeOptsSource = buildResonanceBattle(initial, { data, catalog }).battle.opts;
    assert.equal(field.spec.seed, nativeOptsSource.seed, 'Native spec seed must match the authoritative prepared Battle');
    assert.deepEqual(field.spec.spawns, nativeOptsSource.spawns, 'Native boss phase must not add/remove/reorder prepared wave spawns');
    assert.deepEqual(field.spec.routes, nativeOptsSource.routes, 'Native boss phase must use the authoritative routes');
    assert.deepEqual(field.spec.enemyOverrides, nativeOptsSource.enemyOverrides, 'Native boss phase must use prepared enemy tuning');
    assert.deepEqual(field.spec.boss, { poolHp: nativeOptsSource.sharedBoss.maxHp, poolMax: nativeOptsSource.sharedBoss.maxHp },
      'Native shared pool must match prepared Resonance boss pool');
    const directUnits = structuredClone(nativeOptsSource.players[0].units);
    for (const unit of directUnits) {
      unit.uid = match.uidMap.native(unit.uid);
      if (unit.ownerUid != null) unit.ownerUid = match.uidMap.native(unit.ownerUid);
    }
    assert.deepEqual(field.spec.players[0].units, directUnits, 'Native spec player formation may only normalize stable UIDs');
    assert.deepEqual(field.spec.flags.resonance.dataPatch.chess,
      Object.fromEntries(Object.entries(nativeOptsSource.data.chess).filter(([id]) => id.startsWith('resonance_'))),
      'Native spec fixed-star data must match direct prepared records');
    const nativeStarTwo = field.spec.players[0].units.find((unit) => /_star2$/.test(unit.chessId));
    assert.ok(nativeStarTwo, 'the captured R28 Native lineup contains a real two-star operator record');
    assert.equal(data.chess[nativeStarTwo.chessId], undefined, 'the base dataset does not carry generated V3 star variants');
    assert.deepEqual(match.gd.chess(nativeStarTwo.chessId), field.spec.flags.resonance.dataPatch.chess[nativeStarTwo.chessId],
      'only this Resonance Match validation lookup overlays the exact records from its real BattleSpec');
    assert.equal(match.state.gold, initial.gold, 'Native COMBAT must not settle campaign gold before accepted result');
    assert.equal(match.state.hp, initial.hp, 'Native COMBAT must not settle campaign HP before accepted result');
    assert.equal(match.state.history.length, initial.history.length, 'Native COMBAT must not append history before accepted result');

    const battle = createBattleFromSpec(field.spec, data, { recordEvents: false, quiet: true });
    battle.start();
    const directSpecBattle = createBattleFromSpec(field.spec, data, { recordEvents: false, quiet: true });
    directSpecBattle.start();
    for (let tick = 0; tick < 30_000 && !directSpecBattle.finished; tick++) directSpecBattle.step();
    assert.equal(directSpecBattle.finished, true, 'direct headless replay of the exact Native spec must finish naturally');
    assert.equal(directSpecBattle.errorCount, 0, JSON.stringify(directSpecBattle.errors?.slice(0, 4) ?? []));
    const directSpecResult = compactResult(directSpecBattle.result());
    const directSpecExtras = resonanceResultExtras(directSpecBattle);
    if (directSpecExtras) directSpecResult.resonance = directSpecExtras;
    const directSpecSessionResult = nativeResultForSession(initial,
      fitResult(directSpecResult, { battleId: field.battleId }), { data, catalog,
        prepared: match.currentPrepared?.prepared, uidMap: match.uidMap });
    directSpecSessionResult.battleId = field.battleId;
    directSpecSessionResult.won = directSpecBattle.result().bossHpLeft <= 0;
    const directSpecSettlement = applyAction(initial, { type: 'fight' }, { catalog, recording: false,
      completedResult: directSpecSessionResult, fieldResolver: (state) => getResonanceField(state, { data, catalog }) });
    assert.equal(directSpecSettlement.ok, true, directSpecSettlement.error);
    const leaksBy = () => {
      const by = {};
      for (const player of Object.values(battle._perPlayer ?? {})) for (const leak of player.leaked ?? []) {
        if (leak?.counted === false) continue;
        const playerId = leak?.sourcePlayerId ?? 'resonance';
        by[playerId] = (by[playerId] ?? 0) + (Number.isFinite(leak?.lpr) && leak.lpr >= 0 ? leak.lpr : 1);
      }
      return by;
    };
    let resultSent = false, progressReports = 0, maxGameTime = 0;
    let nativeClientExtras = null;
    const sendResult = () => {
      const raw = compactResult(battle.result());
      const extras = resonanceResultExtras(battle);
      if (extras) raw.resonance = extras;
      const rawStats = raw.perPlayer?.resonance?.unitStats ?? [];
      assert.ok(rawStats.length >= 8, `real R28 Runner should report all 8 deployed operators; got ${rawStats.length}`);
      assert.ok(rawStats.some((unit) => /_star2$/.test(unit.defId)), 'real fixture includes a V3 two-star defId');
      const fitted = fitResult(raw, { battleId: field.battleId });
      assert.equal(fitted.perPlayer?.resonance?.unitStats?.length, rawStats.length,
        'the actual frame budget path must retain these stats when the result fits');
      nativeClientExtras = extras;
      const response = match.handle('resonance', { t: 'b.result', battleId: field.battleId, result: fitted });
      assert.equal(response?.error, undefined, `Native rejected actual R28 BattleResult: ${JSON.stringify(response)}`);
      resultSent = true;
    };
    for (let wallQuarter = 0; wallQuarter < 1_200 && !field.done; wallQuarter++) {
      for (let tick = 0; tick < 15 && !battle.finished; tick++) battle.step();
      const progress = battleProgress(battle);
      maxGameTime = Math.max(maxGameTime, progress.gt);
      const by = leaksBy();
      match.handle('resonance', { t: 'b.progress', battleId: field.battleId, ...progress,
        leaks: Object.values(by).reduce((sum, value) => sum + value, 0), leaksBy: by, by: { resonance: progress.bossDmg } });
      progressReports++;
      scheduler.advance(250);
      assert.equal(messages.some((message) => message.t === 'b.end' && message.battleId === field.battleId && !battle.finished), false,
        'Native ended the boss clock before the actual Runner reached its terminal result');
      if (battle.finished && !resultSent) sendResult();
      await new Promise((resolve) => setImmediate(resolve));
      await match._sessionWrite;
    }
    if (battle.finished && !resultSent) sendResult();
    await new Promise((resolve) => setImmediate(resolve));
    await match._sessionWrite;

    assert.equal(battle.finished, true, 'R28 Runner must reach its own real terminal result');
    assert.equal(battle.errorCount, 0, JSON.stringify(battle.errors?.slice(0, 4) ?? []));
    assert.equal(battle.result().reason, direct.result.reason);
    assert.equal(battle.result().reason, directSpecBattle.result().reason);
    assert.equal(directSpecBattle.resonanceMetrics?.prototypeTraits?.rhodes?.shieldComponents,
      direct.metrics?.prototypeTraits?.rhodes?.shieldComponents,
      'Native mode catalog must retain source component definitions used by the active Scrap tier');
    assert.equal(battle.result().killed, directSpecBattle.result().killed,
      `same Native spec diverged: client=${battle.result().killed}/${battle.result().total}, headless=${directSpecBattle.result().killed}/${directSpecBattle.result().total}`);
    assert.equal(battle.result().total, directSpecBattle.result().total);
    assert.equal(battle.result().time, directSpecBattle.result().time);
    assert.equal(directSpecBattle.result().killed, direct.result.killed,
      `same-session direct build and Native spec replay diverged: direct killed=${direct.result.killed}/${direct.result.total} t=${direct.result.time} bossHp=${direct.result.bossHpLeft}; spec killed=${directSpecBattle.result().killed}/${directSpecBattle.result().total} t=${directSpecBattle.result().time} bossHp=${directSpecBattle.result().bossHpLeft}; directUnits=${JSON.stringify(direct.result.perPlayer?.resonance?.unitStats)}; specUnits=${JSON.stringify(directSpecBattle.result().perPlayer?.resonance?.unitStats)}; directScrap=${JSON.stringify(direct.battle?.allyUnits?.filter(u=>u.kind==='op').map(u=>({uid:u.uid,converted:u.mem?.prototypeTemporaryItems?.map(i=>i.itemId)??[],consumed:u.mem?.prototypeConsumedComponents?.length??0})))}; specScrap=${JSON.stringify(directSpecBattle.allyUnits?.filter(u=>u.kind==='op').map(u=>({uid:u.uid,converted:u.mem?.prototypeTemporaryItems?.map(i=>i.itemId)??[],consumed:u.mem?.prototypeConsumedComponents?.length??0})))}`);
    assert.equal(directSpecBattle.result().total, direct.result.total);
    assert.equal(directSpecBattle.result().time, direct.result.time);
    assert.equal(progressReports > 0, true);
    // the client path received the whole real fight (the headless run of the same session), not a cut-short clock;
    // the length itself follows the fixture's gear (native-scale equipment, 3125e361, shortened it from >100 s to 85 s)
    assert.ok(direct.result.time > 30, `the R28 fixture should be a real fight: ${direct.result.time}`);
    assert.ok(maxGameTime >= direct.result.time - 1, `Native received too little actual game time: ${maxGameTime} of ${direct.result.time}`);
    assert.equal(resultSent, true);
    assert.equal(field.done, true, `Native boss clock did not settle: phase=${match.phase}, hp=${match.bossPool?.hp}, lp=${match.teamLp}`);
    assert.equal(field.resultSource, 'client', 'the accepted Native terminal result must remain client-authoritative');
    assert.ok(field.result?.perPlayer?.resonance?.unitStats?.length >= 8,
      `Native validation discarded deployed V3 star records: ${field.result?.perPlayer?.resonance?.unitStats?.length ?? 0}`);
    assert.ok(field.result?.perPlayer?.resonance?.unitStats?.some((unit) => /_star2$/.test(unit.defId)));
    for (const unit of field.spec.players[0].units.filter((row) => row.chessId?.startsWith('resonance_chess_'))) {
      const nativeUid = unit.uid;
      const sessionUid = match.uidMap.session(nativeUid);
      assert.ok(initial.pieces.some((piece) => piece.uid === sessionUid),
      `Native UID must reverse-map to the same session operator ${nativeUid}:${sessionUid}:${unit.chessId}`);
      assert.ok(field.result.perPlayer.resonance.unitStats.some((stat) => stat.uid === nativeUid && stat.defId === unit.chessId),
        `Native validation must retain uid/defId mapping ${nativeUid}:${unit.chessId}`);
    }
    assert.deepEqual(field.result?.resonance, nativeClientExtras,
      'mode growth/coins/forge/contribution payload survives actual Native validation');
    assert.ok(nativeClientExtras && (Object.keys(nativeClientExtras.metrics ?? {}).length
      || (nativeClientExtras.contributions?.length ?? 0)), 'real battle mode metrics/contributions are present to preserve');
    assert.equal(nativeFinalOutcome?.victory, true);
    assert.equal(nativeFinalOutcome?.phase, 'FINAL_ASSAULT');
    assert.equal(match.state.terminalReason, 'victory');
    assert.equal(match.state.history.length, initial.history.length + 1);
    assert.deepEqual({ gold: match.state.gold, hp: match.state.hp, xp: match.state.xp, level: match.state.level,
      terminalReason: match.state.terminalReason }, { gold: directSpecSettlement.state.gold, hp: directSpecSettlement.state.hp,
      xp: directSpecSettlement.state.xp, level: directSpecSettlement.state.level, terminalReason: directSpecSettlement.state.terminalReason });
    assert.equal(match.state.history.at(-1).won, directSpecSettlement.state.history.at(-1).won);
    assert.equal(match.state.history.at(-1).hpLoss, directSpecSettlement.state.history.at(-1).hpLoss);
    assert.ok(saves.length > 0, 'Native settlement must persist the accepted natural R28 result');
  } finally {
    match.dispose();
    scheduler.dispose();
  }
});

test('Native skips an already-started FUNNY odd logistics node into the next even prep', { timeout: 120_000 }, async () => {
  const data = loadData(NATIVE_DATA);
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 157 });
  const created = createSession({ seed: 157, difficulty: 'FUNNY', catalog });
  assert.equal(created.ok, true, created.error);
  const state = created.state;
  state.round = 3;
  state.nodeStarted = true;
  state.claimedNodes = [...new Set([...state.claimedNodes, 3])];
  const store = { async exclusive(_id, task) { return task(); }, async saveSession() {}, deactivate() {} };
  const scheduler = new VirtualScheduler({ instantCombat: false });
  const match = new ResonanceMatch({ sessionId: 'test-funny-logistics', state, catalog, data, store, scheduler,
    send() {}, broadcast() {}, timerScale: 0, log: { info() {}, warn() {}, error() {}, debug() {} } });
  try {
    match.startRound();
    assert.ok(match._supplyAdvancePromise, 'an already-started odd logistics node is advanced before Native battle prep');
    await match._supplyAdvancePromise;
    await match._sessionWrite;
    assert.equal(match.state.round, 4);
    assert.equal(match.round, 4);
    assert.ok(match.state.history.some((entry) => entry.round === 3 && entry.type === 'logistics-settled'));
    assert.equal(scheduler.runUntil(() => match.phase === 'PREP', { maxTime: 1_000 }), true);
    assert.equal(match.fields.length, 0, 'logistics node advances to the even prep without constructing combat');
    assert.equal(match.state.claimedNodes.filter((node) => node === 3).length, 1);
  } finally {
    await match._sessionWrite;
    match.dispose();
    scheduler.dispose();
  }
});

test('Native holds FUNNY odd-node choices in PREP, settles logistics, and never battles odd nodes', { timeout: 120_000 }, async () => {
  const data = loadData(NATIVE_DATA);
  const sourceCatalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 159 });
  const catalog = { ...sourceCatalog, campaign: { ...sourceCatalog.campaign, supply: {
    ...sourceCatalog.campaign.supply, components: { nodes: [3, 5], countPerNode: 1, optionCount: 3 },
  } } };
  const created = createSession({ seed: 159, difficulty: 'FUNNY', catalog });
  assert.equal(created.ok, true, created.error);
  let state = created.state;
  state.round = 3;
  state.nodeStarted = false;
  state.pendingChoices = [];
  const field = getResonanceField(state, { data, catalog });
  const first = state.pieces[0], operator = catalog.operators[first.operatorId];
  const position = [...field.deployMap.entries()].find(([, cell]) => {
    const kind = String(cell?.class ?? cell?.type ?? cell?.position ?? cell?.kind ?? cell).toUpperCase();
    return operator.position === 'RANGED' || kind === 'MELEE' || (kind === 'RANGED' && operator.canDeployHighGround === true);
  });
  assert.ok(position, `no legal FUNNY fixture cell for ${first.operatorId}`);
  const [row, col] = position[0].split(',').map(Number);
  const deployed = applyAction(state, { type: 'deploy', pieceUid: first.uid, row, col, dir: 'RIGHT' }, {
    catalog, fieldResolver: () => field, recording: false,
  });
  assert.equal(deployed.ok, true, deployed.error);
  state = deployed.state;
  let stored = structuredClone(state);
  const store = { async exclusive(_id, task) { return task(); }, async saveSession(_id, next) { stored = structuredClone(next); }, deactivate() {} };
  const scheduler = new VirtualScheduler({ instantCombat: false });
  const match = new ResonanceMatch({ sessionId: 'test-funny-choice-logistics', state, catalog, data, store, scheduler,
    send() {}, broadcast() {}, timerScale: 0, log: { info() {}, warn() {}, error() {}, debug() {} } });
  try {
    match.startRound();
    await match._supplyAdvancePromise;
    await match._sessionWrite;
    assert.equal(match.state.round, 3);
    assert.equal(match.state.nodeStarted, true);
    const choice = match.state.pendingChoices.find((entry) => entry.type === 'components');
    assert.ok(choice, 'Native prep displays the component choice created by odd-node supply');
    assert.equal(scheduler.runUntil(() => match.phase === 'PREP', { maxTime: 1_000 }), true);
    assert.equal(match.fields.length, 0, 'odd logistics has a prep/choice UI but no battle field');
    assert.equal(match.handle('resonance', { t: 'g.ready', ready: true }).error, ERR.WRONG_PHASE,
      'odd logistics cannot be turned into combat while its reward is pending');

    const selected = choice.options[0];
    const claim = await match.handle('resonance', { t: 'g.resonance', action: {
      type: 'claimReward', choiceUid: choice.uid, optionIds: [selected],
    } });
    assert.equal(claim.ok, true, claim.detail);
    await match._sessionWrite;
    scheduler.runUntil(() => match.phase === 'PREP' && match.state.round === 4, { maxTime: 1_000 });
    assert.equal(match.state.round, 4, 'clearing the odd-node choice auto-runs the existing logistics advance');
    assert.equal(match.state.history.filter((entry) => entry.type === 'logistics-settled' && entry.round === 3).length, 1);
    assert.equal(match.state.claimedNodes.filter((node) => node === 3).length, 1,
      'choice resolution does not prepare or claim the odd node a second time');
    assert.equal(match.fields.length, 0, 'Native prep now points at even node 4, with no odd battle constructed');
    assert.equal(match.state.phase, 'prep');
    assert.equal(stored.round, 4, 'the even supply state is saved before the Native even-round prep is exposed');

    assert.equal(match.handle('resonance', { t: 'g.ready', ready: true }).ok, true);
    assert.equal(scheduler.runUntil(() => match.phase === 'COMBAT', { maxTime: 1_000 }), true);
    const evenField = match.fields.find((entry) => entry.players.includes('resonance'));
    assert.ok(evenField?.cc && match.round === 4 && evenField.kind === 'normal',
      'only session even round 4 starts a real Native normal battle');
    const battle = createBattleFromSpec(evenField.spec, data, { recordEvents: false, quiet: true });
    battle.start();
    while (!battle.finished && battle.tickCount < 20_000) battle.step();
    assert.equal(battle.finished, true, 'even-node battle reaches a natural result');
    const progress = battleProgress(battle);
    match.handle('resonance', { t: 'b.progress', battleId: evenField.battleId, ...progress, resolved: progress.killed });
    const raw = compactResult(battle.result()), extras = resonanceResultExtras(battle);
    if (extras) raw.resonance = extras;
    assert.equal(match.handle('resonance', { t: 'b.result', battleId: evenField.battleId,
      result: fitResult(raw, { battleId: evenField.battleId }) }).ok, true);
    scheduler.advance(1_500, 1000 / 60);
    for (let i = 0; i < 20 && match.phase !== 'SETTLE'; i++) await new Promise((resolve) => setImmediate(resolve));
    await match._sessionWrite;
    assert.equal(match.phase, 'SETTLE');
    assert.equal(match.state.round, 5);
    assert.equal(match.state.nodeStarted, false, 'real even-round settlement leaves odd logistics unstarted');

    assert.equal(scheduler.runUntil(() => !!match._supplyAdvancePromise, { maxTime: 5_000 }), true,
      'Native afterSettle queues the next unstarted odd-node supply');
    const oddPrepSupply = await match._supplyAdvancePromise;
    assert.ok(!oddPrepSupply?.error, `odd supply preparation rejected: ${oddPrepSupply?.detail ?? oddPrepSupply?.error ?? ''}`);
    await match._sessionWrite;
    assert.equal(scheduler.runUntil(() => match.phase === 'PREP' && match.state.round === 5, { maxTime: 5_000 }), true);
    assert.equal(match.state.pendingChoices.length > 0, true,
      'odd supply choices from the post-battle node appear in Native PREP');
    assert.equal(match.fields.length, 0, 'the odd post-battle logistics node still has no field');
    assert.equal(match.handle('resonance', { t: 'g.ready', ready: true }).error, ERR.WRONG_PHASE,
      'ready remains blocked while an odd-node reward is pending');
    while (match.state.pendingChoices.length) {
      const choice = match.state.pendingChoices[0];
      const optionIds = choice.options.slice(0, Math.max(1, Number(choice.remaining) || 1));
      const action = choice.type === 'strategy'
        ? { type: 'chooseStrategy', choiceUid: choice.uid, strategyId: optionIds[0] }
        : { type: 'claimReward', choiceUid: choice.uid, optionIds };
      const claimed = await match.handle('resonance', { t: 'g.resonance', action });
      assert.equal(claimed.ok, true, claimed.detail);
      await match._sessionWrite;
    }
    await match._supplyAdvancePromise;
    await match._sessionWrite;
    assert.equal(match.state.round, 6, 'the final odd-node choice auto-advances logistics into round 6');
    assert.equal(match.state.history.filter((entry) => entry.type === 'logistics-settled' && entry.round === 5).length, 1);
    assert.equal(match.state.claimedNodes.filter((node) => node === 5).length, 1);
    assert.equal(scheduler.runUntil(() => match.phase === 'PREP' && match.state.round === 6, { maxTime: 1_000 }), true);
    assert.equal(match.fields.length, 0, 'odd round 5 never receives a Native combat field');
  } finally {
    await match._sessionWrite;
    match.dispose();
    scheduler.dispose();
  }
});

test('v3 transfer supply honors explicit grantAllowed and emblemAllowed metadata', () => {
  const data = loadData(NATIVE_DATA);
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 211 });
  const item = Object.values(catalog.equipment).find((entry) => entry.kind === 'emblem'
    && entry.effects?.some((effect) => ['pact_transfer', 'transfer_pact'].includes(effect.kind)));
  assert.ok(item, 'v3 catalog has an actual transfer emblem to restrict');
  const transfer = item.effects.find((effect) => ['pact_transfer', 'transfer_pact'].includes(effect.kind));
  const pactId = transfer.params?.pactId ?? transfer.params?.pact;
  assert.ok(catalog.pacts[pactId], `transfer item ${item.id} references a catalog pact`);
  item.grantAllowed = false;
  catalog.pacts[pactId].emblemAllowed = false;
  const state = createSession({ seed: 211, difficulty: 'NORMAL', catalog }).state;
  state.round = 12;
  state.nodeStarted = false;
  const advanced = applyAction(state, { type: 'advanceSupply' }, { catalog, recording: false });
  assert.equal(advanced.ok, true, advanced.error);
  const choices = advanced.state.pendingChoices.filter((choice) => choice.type === 'transfer');
  assert.ok(choices.length > 0, 'node 12 should exercise the configured transfer supply');
  assert.ok(choices.every((choice) => !choice.options.includes(item.id)), `disabled ${item.id} entered v3 transfer options`);
});

test('V3 Native data patches resolve only own string keys and preserve real star records', () => {
  const data = loadData(NATIVE_DATA), catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 550 });
  const state = createSession({ seed: 550, difficulty: 'NORMAL', catalog }).state;
  const scheduler = new VirtualScheduler();
  const match = new ResonanceMatch({ sessionId: 'test-own-data-patch', state, catalog, data, scheduler,
    store: { async saveSession() {}, async exclusive(_id, task) { return task(); } }, send() {}, broadcast() {}, onEnd() {} });
  try {
    const operator = Object.values(catalog.operators)[0];
    const starId = `resonance_${operator.id}_star2`, starRecord = operator.stars[2].record;
    const inherited = Object.defineProperty({ constructor: { id: 'forged-constructor' } }, '__proto__', { value: { id: 'forged-proto' } });
    const chess = Object.create(inherited), tokens = Object.create(inherited);
    chess[starId] = starRecord;
    tokens['resonance_fixture_token'] = { id: 'resonance_fixture_token', name: 'fixture' };
    match._resonanceValidationData = { chess, tokens };
    assert.equal(match.gd.chess(starId), starRecord, 'the own, validated star patch remains available');
    assert.equal(match.gd.chess('constructor'), null, 'an inherited constructor cannot shadow base GameData lookup');
    assert.equal(match.gd.chess('__proto__'), null, 'an inherited prototype cannot shadow base GameData lookup');
    assert.equal(match.gd.token('constructor'), null, 'token patch rejects inherited constructor values');
    assert.equal(match.gd.token('__proto__'), null, 'token patch rejects inherited prototype values');
    assert.equal(match.gd.token('resonance_fixture_token').name, 'fixture', 'the own token patch remains available');
  } finally { match.dispose(); scheduler.dispose(); }
});

test('Native synthetic boss grace result reaches campaign settlement without mode rewards', async () => {
  const data = loadData(NATIVE_DATA), catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 551 });
  const state = createSession({ seed: 551, difficulty: 'NORMAL', catalog }).state;
  state.round = 28;
  const scheduler = new VirtualScheduler();
  const match = new ResonanceMatch({ sessionId: 'test-native-grace-settlement', state, catalog, data, scheduler,
    store: { async saveSession() {}, async exclusive(_id, task) { return task(); } }, send() {}, broadcast() {}, onEnd() {} });
  const submissions = [];
  match.phase = 'FINAL_ASSAULT';
  match.currentPrepared = { prepared: buildResonanceBattle(state, { data, catalog }).prepared };
  match.fields = [{ cc: true, players: ['resonance'], battleId: 'native-grace', done: true,
    result: syntheticResult(['resonance']), resultSource: null }];
  match.enqueueSessionAction = (action, result) => { submissions.push({ action, result }); return Promise.resolve({ ok: true }); };
  try {
    match._afterCombat();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(submissions.length, 1, 'Native grace synthetic results still settle the round');
    assert.equal(submissions[0].action.type, 'fight');
    assert.equal(submissions[0].result.won, false, 'the Native forced result remains a defeat');
    assert.equal(submissions[0].result.result.synthetic, true);
    assert.equal(Object.hasOwn(submissions[0].result.result, 'resonance'), false, 'synthetic fallback has no fabricated mode extras');
  } finally { match.dispose(); scheduler.dispose(); }
});

test('native live WebSocket carries Runner results and reconstructs saved active Battles', { timeout: 120_000 }, async () => {
  const data = loadData(NATIVE_DATA);
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 313 });
  const created = createSession({ seed: 313, difficulty: 'NORMAL', catalog });
  assert.equal(created.ok, true, created.error);
  const legal = getResonanceField(created.state, { data, catalog });
  const piece = created.state.pieces[0];
  const cell = [...legal.deployMap.entries()].find(([, value]) => {
    const kind = String(value?.class ?? value?.type ?? value?.position ?? value?.kind ?? value).toUpperCase();
    const operator = catalog.operators[piece.operatorId];
    return operator.position === 'RANGED' || kind === 'MELEE' || (kind === 'RANGED' && operator.canDeployHighGround === true);
  });
  assert.ok(cell, 'live websocket fixture needs a legal deployed unit');
  const [row, col] = cell[0].split(',').map(Number);
  const deployed = applyAction(created.state, { type: 'deploy', pieceUid: piece.uid, row, col, dir: 'RIGHT' }, {
    catalog, fieldResolver: () => legal, recording: false,
  });
  assert.equal(deployed.ok, true, deployed.error);

  async function storeFor(initial) {
    let saved = structuredClone(initial);
    return {
      async loadOwnedSession() { return { state: structuredClone(saved), catalog }; },
      async exclusive(_id, task) { return task(); },
      async saveSession(_id, next) { saved = structuredClone(next); },
      activate() {}, deactivate() {}, read() { return structuredClone(saved); },
    };
  }

  const sid = randomUUID(), store = await storeFor(deployed.state);
  const live = createResonanceLive({ store, data, log: { error() {}, debug() {} } });
  const socket = await connectResonanceLive(live, sid), match = live.matches.get(sid);
  assert.ok(socket.messages.some((message) => message.t === 'r.catalog'));
  assert.ok(socket.messages.some((message) => message.t === 'room.state' && message.mode === 'solo'));
  assert.equal(match.phase,'INFO_CHECK');
  match.timerScale = 0;
  socket.receive({t:'g.infoReady',setupRevision:0,rid:1});
  await waitFor(()=>match.phase==='PREP','live INFO_CHECK confirmation → PREP');
  assert.ok(socket.messages.some((message)=>message.t==='ok'&&message.rid===1),'native briefing confirmation receives an acknowledgment');
  await waitFor(() => match.phase === 'PREP', 'live PREP');
  socket.receive({ t: 'g.ready', ready: true, rid: 2 });
  await waitFor(() => match.phase === 'COMBAT', 'live COMBAT');
  await match._sessionWrite;
  const field = match.fields.find((entry) => entry.players.includes('resonance'));
  assert.ok(field?.spec && match.state.nativeRuntime?.battleId === field.battleId);
  const battle = createBattleFromSpec(field.spec, data, { recordEvents: false, quiet: true });
  battle.start();
  while (!battle.finished && battle.tickCount < 10_000) battle.step();
  assert.equal(battle.finished, true, 'live client fixture Runner must complete naturally');
  const progress = battleProgress(battle);
  socket.receive({ t: 'b.progress', battleId: field.battleId, ...progress, resolved: progress.killed });
  const raw = compactResult(battle.result()), extras = resonanceResultExtras(battle);
  if (extras) raw.resonance = extras;
  const resultFrame={ t: 'b.result', battleId: field.battleId, result: fitResult(raw, { battleId: field.battleId }) };
  assert.equal(validateC2S(resultFrame),null,`client result rejected by shared protocol: ${JSON.stringify(resultFrame.result.resonance)}`);
  socket.receive(resultFrame);
  await waitFor(() => match.phase === 'SETTLE', `WS result settlement (phase=${match.phase}, fieldDone=${field.done}, result=${field.result?.reason ?? 'none'}, lastError=${JSON.stringify(socket.messages.filter((message)=>message.t==='error').at(-1)??null)})`);
  await match._sessionWrite;
  assert.equal(match.state.history.filter((entry) => entry.type === 'fight-settled').length, 1);
  assert.ok(socket.messages.some((message) => message.t === 'ok' && message.rid === 2));
  assert.equal(match.state.prototypeMeta.lastBattle.outcome.round, 1, 'shared applyAction settlement owns V3 meta updates');
  await live.close();

  const restartId = randomUUID(), restartStore = await storeFor(deployed.state);
  const firstLive = createResonanceLive({ store: restartStore, data, log: { error() {}, debug() {} } });
  const firstSocket = await connectResonanceLive(firstLive, restartId);
  const firstMatch = firstLive.matches.get(restartId);
  firstMatch.timerScale = 0;
  firstSocket.receive({t:'g.infoReady',setupRevision:0,rid:1});
  await waitFor(() => firstMatch.phase === 'PREP', 'restart PREP');
  firstSocket.receive({ t: 'g.ready', ready: true, rid: 3 });
  await waitFor(() => firstMatch.phase === 'COMBAT', 'restart COMBAT');
  await firstMatch._sessionWrite;
  const savedBattleId = firstMatch.state.nativeRuntime.battleId;
  await firstLive.close();

  const resumedLive = createResonanceLive({ store: restartStore, data, log: { error() {}, debug() {} } });
  const resumedSocket = await connectResonanceLive(resumedLive, restartId);
  const resumed = resumedLive.matches.get(restartId);
  assert.equal(resumed.phase, 'COMBAT');
  assert.ok(resumedSocket.messages.some((message) => message.t === 'b.start' && message.battleId === savedBattleId),
    'process restart must resume the saved native Battle spec and identity');
  resumedSocket.close();
  await waitFor(() => resumed.fields[0]?.mode === 'server' || resumed.fields[0]?.done, 'Native disconnect takeover');
  assert.ok(resumed.fields[0]?.mode === 'server' || resumed.fields[0]?.done,
    'disconnect must hand the active native field to the server runner');
  await resumedLive.close();
});

test('native live close rejects failed session flush and still deactivates ownership',async()=>{
  const data=loadData(NATIVE_DATA),catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:416});
  const created=createSession({seed:416,difficulty:'NORMAL',catalog});assert.equal(created.ok,true,created.error);
  let deactivated=false;
  const store={async loadOwnedSession(){return {state:structuredClone(created.state),catalog};},
    async exclusive(_id,task){return task();},async saveSession(){throw new Error('fixture flush failure');},
    activate(){},deactivate(){deactivated=true;}};
  const live=createResonanceLive({store,data,log:{error(){},debug(){}}});
  const sid=randomUUID();await connectResonanceLive(live,sid);
  await assert.rejects(live.close(),/fixture flush failure/);
  assert.equal(deactivated,true,'failed flush must not leave the session owner locked');
});

test('completed live match persists before releasing owner and rebuilds its result from saved state', { timeout: 30_000 }, async () => {
  const data = loadData(NATIVE_DATA), catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 927 });
  const created = createSession({ seed: 927, difficulty: 'NORMAL', catalog });
  assert.equal(created.ok, true, created.error);
  let saved = structuredClone(created.state);
  const active = new Set(), errors = [];
  let releaseSave;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  let holdCompletionSave = true;
  const store = {
    async loadOwnedSession() { return { state: structuredClone(saved), catalog }; },
    async exclusive(_id, task) { return task(); },
    async saveSession(_id, state) {
      if (state.phase === 'complete' && holdCompletionSave) await saveGate;
      saved = structuredClone(state);
    },
    activate(id) { active.add(id); },
    deactivate(id) { active.delete(id); },
  };
  const live = createResonanceLive({ store, data, log: { error: (...args) => errors.push(args), debug() {} } });
  const sid = randomUUID();
  try {
    const socket = await connectResonanceLive(live, sid);
    const match = live.matches.get(sid);
    match.state.gold += 2;
    match.state.history.push({ type: 'fight-settled', round: 1, won: true, goldDelta: 2 });
    match.state.phase = 'complete';
    match.state.terminalReason = 'victory';
    const completedState = structuredClone(match.state);
    match.finish({ victory: true, reason: 'victory' });
    await waitFor(() => socket.messages.some((message) => message.t === 'm.result'), 'native completion result frame');
    const firstResult = socket.messages.find((message) => message.t === 'm.result');
    assert.ok(firstResult, 'Native Match sends its result before asynchronous persistence finishes');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(live.matches.get(sid), match, 'match remains addressable while completion save is pending');
    assert.equal(match.disposed, false);
    assert.equal(active.has(sid), true, 'owner remains active until durable completion');
    assert.notEqual(saved.phase, 'complete');

    holdCompletionSave = false;
    releaseSave();
    await waitFor(() => !live.matches.has(sid), 'completed match release after durable save');
    assert.equal(saved.phase, 'complete');
    assert.equal(match.disposed, true);
    assert.equal(active.has(sid), false, 'dispose releases the session owner');

    const resumedSocket = await connectResonanceLive(live, sid);
    await waitFor(() => !live.matches.has(sid), 'reconnected completed session result delivery and release');
    const resumedResult = resumedSocket.messages.find((message) => message.t === 'm.result');
    assert.ok(resumedResult, 'persisted completed session replays its native final result on reconnect');
    assert.deepEqual(
      { victory: resumedResult.victory, reason: resumedResult.reason, roundsPassed: resumedResult.roundsPassed, players: resumedResult.players },
      { victory: firstResult.victory, reason: firstResult.reason, roundsPassed: firstResult.roundsPassed, players: firstResult.players },
      'reconnect reproduces the same saved outcome and roster without rerunning settlement',
    );
    assert.deepEqual(saved.history, completedState.history, 'reconnect does not append another campaign reward/history entry');
    assert.equal(saved.gold, completedState.gold, 'reconnect does not grant the completed reward a second time');
    assert.equal(errors.length, 0);
  } finally {
    holdCompletionSave = false;
    releaseSave();
    await live.close();
  }
});

test('completed Resonance result projects persisted history to Native result and cold reconnect once', () => {
  const data = loadData(NATIVE_DATA), catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 930 });
  const created = createSession({ seed: 930, difficulty: 'ABYSS', catalog });
  assert.equal(created.ok, true, created.error);
  const state = created.state;
  state.round = 30;
  state.roundLimit = 30;
  state.phase = 'complete';
  state.terminalReason = 'round-limit-loss';
  state.history.push(
    { type: 'fight-settled', round: 30, won: false, hpLoss: 30, combatStats: { bossDamage: 0, units: [{ uid: 'u1', dmg: 1348, heal: 17, kills: 2 }] } },
    { round: 4, type: 'operator-bought', cost: 2 }, { round: 5, type: 'shop-refreshed', cost: 3 },
    { round: 6, type: 'xp-purchased', gold: 4 }, { round: 8, type: 'operator-merged' }, { round: 9, type: 'item-equipped' },
  );
  const store = { async exclusive(_id, task) { return task(); }, async saveSession() {}, deactivate() {} };
  const messages = [], endedSummaries = [];
  const scheduler = new VirtualScheduler({ instantCombat: false });
  const match = new ResonanceMatch({ sessionId: 'result-summary-native', state, catalog, data, store, scheduler,
    send(_id, message) { messages.push(message); return true; }, broadcast() {}, onEnd(summary) { endedSummaries.push(summary); },
    log: { info() {}, warn() {}, error() {}, debug() {} } });
  try {
    match.players.get('resonance').stats.bossDamage = 83;
    for (const [id, pact] of Object.entries(match._resonancePactViews())) assert.equal(pact.name, catalog.pacts[id].name);
    match.start();
    const result = messages.find((message) => message.t === 'm.result');
    assert.ok(result);
    const player = result.players.find((row) => row.playerId === 'resonance');
    assert.equal(result.victory, false);
    assert.equal(result.roundsPassed, 29);
    assert.equal(result.lastRound, 30);
    assert.equal(player.roundsPassed, 29);
    assert.deepEqual(player.stats, {
      ...player.stats, dmgDealt: 1348, healing: 17, kills: 2, gold: 9, refreshes: 1, merges: 1,
      itemsEquipped: 1, lpLost: 30, activatedLayers: player.resonance.pacts.length, bossDamage: 83,
    });
    assert.ok(player.resonance && Array.isArray(player.resonance.pacts));
    assert.equal(player.stats.activatedLayers, player.resonance.pacts.length);
    assert.equal(Object.hasOwn(match.lastResultMsg, 'playerId'), false, 'stored result is viewer-neutral for reconnect');
    assert.equal(endedSummaries.length, 1);
    assert.equal(endedSummaries[0].roundsPassed, result.roundsPassed, 'onEnd receives the same projected campaign round count');
    assert.deepEqual(endedSummaries[0].players, result.players, 'onEnd receives the same projected result rows as clients');
    assert.deepEqual(endedSummaries[0].players[0].stats, player.stats);
    assert.equal(Object.hasOwn(endedSummaries[0], 't'), false, 'onEnd summary does not expose the wire message type');
    assert.equal(Object.hasOwn(endedSummaries[0], 'playerId'), false, 'onEnd summary does not expose viewer-specific identity');
    const firstResultCount = messages.filter((message) => message.t === 'm.result').length;
    match.finish({ victory: true, reason: 'victory' });
    assert.equal(messages.filter((message) => message.t === 'm.result').length, firstResultCount, 'duplicate finish emits no second result');

    const coldMessages = [], coldEndedSummaries = [], coldScheduler = new VirtualScheduler({ instantCombat: false });
    const coldState = structuredClone(state);
    coldState.history.find((event) => event.type === 'fight-settled').combatStats.bossDamage = 23;
    const cold = new ResonanceMatch({ sessionId: 'result-summary-native-cold', state: coldState, catalog, data, store,
      scheduler: coldScheduler, send(_id, message) { coldMessages.push(message); return true; }, broadcast() {}, onEnd(summary) { coldEndedSummaries.push(summary); },
      log: { info() {}, warn() {}, error() {}, debug() {} } });
    try {
      cold.start();
      const resumed = coldMessages.find((message) => message.t === 'm.result');
      const resumedPlayer = resumed.players.find((row) => row.playerId === 'resonance');
      assert.equal(resumedPlayer.stats.bossDamage, 23, 'cold restore retains finite boss damage saved in history');
      assert.equal(resumedPlayer.stats.dmgDealt, 1348);
      assert.equal(resumed.roundsPassed, 29);
      assert.equal(coldEndedSummaries.length, 1);
      assert.equal(coldEndedSummaries[0].roundsPassed, resumed.roundsPassed);
      assert.deepEqual(coldEndedSummaries[0].players, resumed.players);
      assert.equal(Object.hasOwn(coldEndedSummaries[0], 't'), false);
      assert.equal(Object.hasOwn(coldEndedSummaries[0], 'playerId'), false);
    } finally { cold.dispose(); coldScheduler.dispose(); }
  } finally { match.dispose(); scheduler.dispose(); }
});

test('Resonance result summary counts passed rounds only before and during campaign completion', () => {
  const rounds = (phase, terminalReason, round) => summarizeResonanceResult({ phase, terminalReason, round, roundLimit: 30 }).roundsPassed;
  assert.equal(rounds('PREP', null, 1), 0, 'first-round prep has not passed a round');
  assert.equal(rounds('PREP', null, 3), 2, 'third-round prep has passed two rounds');
  assert.equal(rounds('complete', 'round-limit-loss', 30), 29, 'round-30 loss counts only completed prior rounds');
  assert.equal(rounds('complete', 'victory', 30), 30, 'completed victory counts the victory round');
});

test('completed persistence failure keeps the Native instance and owner for retry', { timeout: 30_000 }, async () => {
  const data = loadData(NATIVE_DATA), catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 928 });
  const created = createSession({ seed: 928, difficulty: 'NORMAL', catalog });
  assert.equal(created.ok, true, created.error);
  let saved = structuredClone(created.state), failCompletionSave = true;
  const active = new Set(), errors = [];
  const store = {
    async loadOwnedSession() { return { state: structuredClone(saved), catalog }; },
    async exclusive(_id, task) { return task(); },
    async saveSession(_id, state) {
      if (state.phase === 'complete' && failCompletionSave) throw new Error('completion write fixture failure');
      saved = structuredClone(state);
    },
    activate(id) { active.add(id); }, deactivate(id) { active.delete(id); },
  };
  const live = createResonanceLive({ store, data, log: { error: (...args) => errors.push(args), debug() {} } });
  const sid = randomUUID();
  try {
    const socket = await connectResonanceLive(live, sid), match = live.matches.get(sid);
    match.state.phase = 'complete';
    match.state.terminalReason = 'defeat';
    match.finish({ victory: false, reason: 'defeat' });
    await waitFor(() => errors.some(([message]) => String(message).includes('persist completed session failed')),
      'completion persistence failure report');
    assert.ok(socket.messages.some((message) => message.t === 'm.result' && message.victory === false));
    assert.equal(live.matches.get(sid), match, 'failed save must not remove or dispose the match');
    assert.equal(match.disposed, false);
    assert.equal(active.has(sid), true, 'failed save must retain the active session owner');
    assert.notEqual(saved.phase, 'complete');

    failCompletionSave = false;
    await live.close();
    assert.equal(saved.phase, 'complete', 'shutdown retries persistence of the retained complete state');
    assert.equal(active.has(sid), false);
  } finally {
    if (live.matches.size) {
      failCompletionSave = false;
      await live.close();
    }
  }
});
