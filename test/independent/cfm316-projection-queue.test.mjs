import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runIndependentBattle } from '../../server/modes/independent/battle.js';
import { getData } from '../../server/data.js';
import { Battle } from '../../server/sim/Battle.js';

function runRealWave(markerCell) {
  const data = getData();
  const catalog = getCatalog(data);
  const source = (id) => Object.values(catalog.operators).find(op => !op.elite && op.sourceRefs?.darkmoon19_2?.id === id);
  const trainer = source('BGS_021');
  const summoner = source('CFM_316');
  assert.ok(trainer && summoner, 'real BGS021 and CFM316 cards are available');

  let state = createSession({ seed: 82131, growthMode: 'levels' });
  state.growthMode = 'levels'; state.funds = 30;
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
  const originalDeploy = Battle.prototype._deploy;
  Battle.prototype._deploy = function(unit, options = {}) {
    const output = originalDeploy.call(this, unit, options);
    if (unit?.kind === 'token' && unit.defId === 'token_10028_vigil_wolf') deployments.push({
      time: this.time, row: unit.tileR, col: unit.tileC, name: unit.name,
      ownerId: unit.ownerUnit?.defId, ownerAlive: unit.ownerUnit?.alive, initial: !!options.initial, output, unit,
    });
    return output;
  };
  let output;
  try { output = runIndependentBattle(state, { data, catalog }); }
  finally { Battle.prototype._deploy = originalDeploy; }
  return { output, deployments, summoner };
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
  assert.equal(projection.unit.ownerUnit.trait.reinforcement, projection.unit, 'the native wolf kit points to the currently deployed reinforcement');
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
