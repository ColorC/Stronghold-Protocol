import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runIndependentBattle } from '../../server/modes/independent/battle.js';
import { getData } from '../../server/data.js';
import { Battle } from '../../server/sim/Battle.js';

function runRealWave(markerCell, round = 1) {
  const data = getData();
  const catalog = getCatalog(data);
  const source = (id) => Object.values(catalog.operators).find(op => !op.elite && op.sourceRefs?.darkmoon19_2?.id === id);
  const trainer = source('BGS_021');
  const summoner = source('CFM_316');
  assert.ok(trainer && summoner, 'real BGS021 and CFM316 cards are available');

  let state = createSession({ seed: 82131, growthMode: 'levels' });
  state.growthMode = 'levels'; state.funds = 30; state.round = round;
  for (const [slot, op] of [[0, trainer], [1, summoner]]) {
    state.shop.slots[slot] = { ...state.shop.slots[slot], kind: 'chess', id: op.chessId, sold: false, price: 3 };
    state.pool[op.chessId] ||= { left: 5, cap: 5 };
    const bought = applyAction(state, { type: 'buy', slot }, { catalog });
    assert.equal(bought.ok, true, bought.error?.message); state = bought.state;
  }
  for (const piece of [...state.pieces]) {
    const legal = viewSession(state, { data, catalog }).pieces.find(x => x.uid === piece.uid)?.legalTiles ?? [];
    const target = piece.chessId === summoner.chessId ? '9,8' : legal[0];
    assert.ok(legal.includes(target), `${piece.chessId} can use its actual legal deployment cell ${target}`);
    const [row, col] = target.split(',').map(Number);
    const moved = applyAction(state, { type: 'move', uid: piece.uid, row, col }, { catalog });
    assert.equal(moved.ok, true, moved.error?.message); state = moved.state;
  }

  const marker = state.summons.find(x => x.tokenId === 'token_10028_vigil_wolf');
  assert.ok(marker, 'the original native wolf marker remains in the prepared session');
  const legalMarker = viewSession(state, { data, catalog }).pieces.find(x => x.uid === marker.uid)?.legalTiles ?? [];
  assert.ok(legalMarker.includes(markerCell), `native marker can be placed at ${markerCell}; legal=${legalMarker.join(' ')}`);
  const [markerRow, markerCol] = markerCell.split(',').map(Number);
  const markerMove = applyAction(state, { type: 'move', uid: marker.uid, row: markerRow, col: markerCol }, { catalog });
  assert.equal(markerMove.ok, true, markerMove.error?.message); state = markerMove.state;

  const deployments = [];
  const retreats = [];
  const activePairs = [];
  const originalDeploy = Battle.prototype._deploy;
  const originalRetreat = Battle.prototype.retreat;
  const originalStep = Battle.prototype.step;
  Battle.prototype._deploy = function(unit, options = {}) {
    const output = originalDeploy.call(this, unit, options);
    if (unit?.kind === 'token' && unit.defId === 'token_10028_vigil_wolf') deployments.push({
      time: this.time, row: unit.tileR, col: unit.tileC, name: unit.name,
      ownerId: unit.ownerUnit?.defId, ownerAlive: unit.ownerUnit?.alive, initial: !!options.initial, output, unit,
      activeWolves: this.allyUnits.filter(x => x.kind === 'token' && x.defId === 'token_10028_vigil_wolf' && x.alive && x.deployed).map(x => ({id:x.id,name:x.name,fromTokens:x.kit?.fromTokens,wolves:x.mem.wolves ?? x.mem.shadows,replaced:!!x.mem.replaced,darkmoonPrototypeId:x.def?.raw?.darkmoonPrototypeTokenId})),
    });
    return output;
  };
  Battle.prototype.retreat = function(unit, options = {}) {
    if (unit?.kind === 'token' && unit.defId === 'token_10028_vigil_wolf') retreats.push({time:this.time,id:unit.id,name:unit.name,reason:options.reason,permanent:!!options.permanent,replaced:!!unit.mem.replaced,projection:!!unit.def?.raw?.darkmoonPrototypeTokenId});
    return originalRetreat.call(this, unit, options);
  };
  Battle.prototype.step = function(...args) {
    const result = originalStep.apply(this, args);
    const active = this.allyUnits.filter(x => x.kind === 'token' && x.defId === 'token_10028_vigil_wolf' && x.alive && x.deployed);
    if (!activePairs.length && active.some(x => x.name === '狼群') && active.some(x => x.name === '狼群投影')) activePairs.push({time:this.time,units:active.map(x=>({id:x.id,name:x.name,replaced:!!x.mem.replaced,removed:x.removed,fromTokens:x.kit?.fromTokens,darkmoonPrototypeId:x.def?.raw?.darkmoonPrototypeTokenId,ownerId:x.ownerUnit?.id})),reinforcement:active[0]?.ownerUnit?.trait?.reinforcement?.id});
    return result;
  };
  let output;
  try { output = runIndependentBattle(state, { data, catalog }); }
  finally { Battle.prototype._deploy = originalDeploy; Battle.prototype.retreat = originalRetreat; Battle.prototype.step = originalStep; }
  return { output, deployments, retreats, activePairs, summoner };
}

test('CFM316 releases its waiting request on a real enemy when a legal wolf tile is free', (t) => {
  // 10,8 is the player's other valid marker position; the routed ground tile 9,9 stays open for the projection.
  const { output, deployments, summoner } = runRealWave('10,8');
  const nativeMarker = deployments.find(x => x.name === '狼群');
  const projection = deployments.find(x => x.name === '狼群投影');
  assert.ok(nativeMarker, `native marker remains represented; deployments=${JSON.stringify(deployments.map(x => ({t:x.time,name:x.name,cell:[x.row,x.col],removed:x.unit.removed,pending:x.unit.mem.nativeEngagementPending})))}`);
  assert.equal(nativeMarker.unit.removed, false, 'the chosen native marker was not removed by the projection');
  assert.ok(projection, `CFM316 deploys when the real wave reaches a legal cell; deployments=${JSON.stringify(deployments.map(x => ({t:x.time,name:x.name,cell:[x.row,x.col]})))}`);
  assert.ok(projection.time > 0 && projection.ownerAlive, 'the projection arrives later while CFM316 is still deployed');
  assert.equal(projection.ownerId, summoner.chessId);
  assert.ok(projection.unit.alive && projection.unit.deployed, 'the native wolf projection reaches the real field');
  assert.equal(projection.unit.defId, 'token_10028_vigil_wolf');
  assert.equal(projection.unit.kit?.fromTokens, true, 'the projected wolf retains the native kit');
  assert.ok(projection.unit.mem.darkmoonLevelContributions, 'BGS021 training is applied before the projection is deployed');
  assert.notEqual(projection.unit.ownerUnit.trait.reinforcement, projection.unit, 'a Workshop projection does not claim the native reinforcement pointer');
  assert.ok(!projection.unit.ownerUnit.trait.reinforcement || !projection.unit.ownerUnit.trait.reinforcement.def?.raw?.darkmoonPrototypeTokenId, 'the owner pointer stays native-only');
  assert.equal(nativeMarker.unit.mem.nativeEngagementPending, true, 'the original marker remains queued while its chosen legal tile is unavailable');
  t.diagnostic(JSON.stringify({ marker: { id: nativeMarker.unit.id, name: nativeMarker.unit.name, alive: nativeMarker.unit.alive, deployed: nativeMarker.unit.deployed, removed: nativeMarker.unit.removed, pending: nativeMarker.unit.mem.nativeEngagementPending }, projection: { id: projection.unit.id, name: projection.unit.name, alive: projection.unit.alive, deployed: projection.unit.deployed, owner: projection.unit.ownerUnit?.defId, kitFromTokens: projection.unit.kit?.fromTokens, ownerReinforcementId: projection.unit.ownerUnit?.trait?.reinforcement?.id }, sameTokenId: nativeMarker.unit.defId === projection.unit.defId, sameOwner: nativeMarker.unit.ownerUnit === projection.unit.ownerUnit }));
  assert.equal(output.diagnostics.errorCount, 0, JSON.stringify(output.diagnostics));
  assert.ok(output.darkmoonTrace.some(x => x.sourceId === 'CFM_316' && x.kind === 'summon' && x.time > 0 && x.targets.length), 'the replay trace records CFM316 generating a wolf after enemy arrival');
});

test('CFM316 keeps waiting when its only real blocking cell is reserved by the selected native marker', () => {
  // 9,9 is also a legal player choice, but it reserves the sole same-lane tile at the real wave choke.
  const { output, deployments } = runRealWave('9,9');
  const nativeMarker = deployments.find(x => x.name === '狼群');
  assert.ok(nativeMarker && nativeMarker.unit.alive && nativeMarker.unit.deployed, 'the selected native wolf marker takes its legal route position');
  assert.equal(nativeMarker.unit.removed, false);
  assert.equal(deployments.some(x => x.name === '狼群投影'), false, 'the projection does not steal an occupied marker cell or deploy outside native range');
  assert.equal(output.diagnostics.errorCount, 0, JSON.stringify(output.diagnostics));
  assert.equal(output.darkmoonTrace.filter(x => x.sourceId === 'CFM_316' && x.kind === 'summon' && x.time > 0).length, 0, 'no generated wolf is logged until an engageable cell exists');
});

test('a native wolf and CFM316 projection coexist on distinct real enemy routes without replacing or stealing from the native marker', (t) => {
  // Round 4 has real ground routes on rows 9 and 12, so the player marker on row 9 leaves another legal engagement cell.
  const { output, deployments, retreats, activePairs } = runRealWave('9,9', 4);
  const dualDeployment = deployments.find(x => x.activeWolves.some(w => w.name === '狼群') && x.activeWolves.some(w => w.name === '狼群投影'));
  t.diagnostic(JSON.stringify({diagnostics:output.diagnostics,deployments:deployments.map(x=>({time:x.time,id:x.unit.id,name:x.name,tile:[x.row,x.col],ownerAlive:x.ownerAlive,fromTokens:x.unit.kit?.fromTokens,darkmoonPrototypeId:x.unit.def?.raw?.darkmoonPrototypeTokenId,final:{alive:x.unit.alive,deployed:x.unit.deployed,removed:x.unit.removed,replaced:x.unit.mem.replaced,pending:x.unit.mem.nativeEngagementPending},reinforcement:x.unit.ownerUnit?.trait?.reinforcement?.id})),activePair:activePairs[0],reinforcementAtDual:dualDeployment?.unit.ownerUnit?.trait?.reinforcement?.id}));
  assert.equal(output.diagnostics.errorCount, 0, JSON.stringify(output.diagnostics));
  assert.ok(dualDeployment && activePairs.length, 'the real R4 wave has a full battle frame with both native marker and Workshop projection deployed');
  const native = deployments.find(x => x.name === '狼群' && x.time > 0);
  assert.ok(native && !native.unit.mem.replaced && !native.unit.removed, 'the native marker is not withdrawn by a Workshop pseudo-cap');
  assert.ok(!retreats.some(x => x.name === '狼群' && x.replaced), 'deploy-limit replacement never marks the original marker');
  assert.ok(dualDeployment.activeWolves.some(x => x.name === '狼群' && x.fromTokens === true), 'the native marker retains its native token kit');
  assert.ok(dualDeployment.activeWolves.some(x => x.name === '狼群投影' && x.fromTokens === true), 'the projection keeps native kit identity for the genuine wolf behavior');
  assert.ok(dualDeployment.activeWolves.every(x => x.wolves >= 1), 'both pieces retain their independent native wolf growth state');
  const nativeMarker = deployments.find(x => x.name === '狼群');
  const projection = deployments.find(x => x.name === '狼群投影' && x.time > 0);
  assert.ok(nativeMarker && projection && nativeMarker.unit.ownerUnit === projection.unit.ownerUnit, 'the two active wolves share the actual owner');
  assert.equal(dualDeployment.unit.ownerUnit.trait.reinforcement, nativeMarker.unit, 'native reinforcement pointer remains attached to the player-selected marker');
  assert.ok(!dualDeployment.unit.ownerUnit.trait.reinforcement.def?.raw?.darkmoonPrototypeTokenId, 'projection identity never replaces the native reinforcement');
  assert.ok(!retreats.some(x => x.id === nativeMarker.unit.id), 'the selected native marker is never retired by the Workshop projection');
});
