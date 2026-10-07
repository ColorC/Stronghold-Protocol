import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSession as createNode, applyAction as actNode, viewSession as viewNode } from '../../server/modes/independent/session.js';
import { getData as getNodeData } from '../../server/data.js';
import { getCatalog as getNodeCatalog } from '../../server/modes/independent/catalog.js';
import { independentDisplayCatalog as displayNodeCatalog } from '../../server/modes/independent/display.js';
import { grantEquipment } from '../../server/modes/independent/equipment.js';
const execFile = promisify(execFileCb);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = await (async () => {
  const base = path.join(ROOT, '.omni', 'tmp', 'client-compute-test-engine');
  await mkdir(base, { recursive: true });
  return path.join(base, `engine-${process.pid}-${Date.now()}`);
})();
await execFile(process.execPath, [path.join(ROOT, 'tools', 'build-client-engine.mjs'), '--out', fixtureRoot], { cwd: ROOT, windowsHide: true });
const engineManifest = JSON.parse(await readFile(path.join(fixtureRoot, 'engine-build.json'), 'utf8'));
assert.equal(typeof engineManifest.sourceRevision, 'string');
assert.equal(typeof engineManifest.sourceDirty, 'boolean');
assert.ok(engineManifest.modules.some((item) => item.path === 'server/modes/independent/session.js' && item.bytes > 0));
assert.ok(engineManifest.totalBytes > 0);
const clientSession = await import(pathToFileURL(path.join(fixtureRoot, 'server', 'modes', 'independent', 'session.js')).href);
const clientDataModule = await import(pathToFileURL(path.join(fixtureRoot, 'server', 'data.js')).href);
const clientCatalogModule = await import(pathToFileURL(path.join(fixtureRoot, 'server', 'modes', 'independent', 'catalog.js')).href);
const clientDisplayModule = await import(pathToFileURL(path.join(fixtureRoot, 'server', 'modes', 'independent', 'display.js')).href);
const { createSession: createClient, applyAction: actClient } = clientSession;
const getClientData = clientDataModule.getData;
const getClientCatalog = clientCatalogModule.getCatalog;

const nodeData = getNodeData();
const nodeCatalog = getNodeCatalog(nodeData);
const clientData = getClientData();
const clientCatalog = getClientCatalog(clientData);
const measured = { maxStateBytes: 0, maxReplayBytes: 0, maxStateAtRound: null, maxReplayAtRound: null };
const artifactDir = process.env.SP_TEST_ARTIFACT_DIR || path.join(ROOT, '.omni', 'tmp', 'client-compute-test-artifacts');
const footprintPath = path.join(path.resolve(artifactDir), 'footprint.json');

function advancePair(nodeState, clientState, action, expectedRound = null) {
  const a = actNode(nodeState, action, { data: nodeData, catalog: nodeCatalog });
  const b = actClient(clientState, action, { data: clientData, catalog: clientCatalog });
  assert.deepEqual(b, a, `action ${JSON.stringify(action)}`);
  const stateBytes = Buffer.byteLength(JSON.stringify(a.state));
  if (stateBytes > measured.maxStateBytes) { measured.maxStateBytes = stateBytes; measured.maxStateAtRound = a.state.round; }
  if (a.replay) {
    const replayBytes = Buffer.byteLength(JSON.stringify(a.replay));
    if (replayBytes > measured.maxReplayBytes) { measured.maxReplayBytes = replayBytes; measured.maxReplayAtRound = a.replay.round; }
  }
  if (expectedRound !== null) {
    assert.ok(a.replay, `round ${expectedRound} should produce a replay`);
    assert.equal(a.replay.round, expectedRound);
    assert.deepEqual(a.replay, b.replay);
  }
  return [a.state, b.state, a];
}

function topLevelDelta(before, after) {
  const changes = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(value)) changes[key] = value;
  }
  return changes;
}

function deltaBytes(before, after) {
  return Buffer.byteLength(JSON.stringify({ expectedRevision: before.revision, changes: topLevelDelta(before, after) }));
}

function sampleActionDeltaProfile() {
  let node = createNode({ seed: 20261007, difficulty: 'NORMAL', roundLimit: 9, data: nodeData, catalog: nodeCatalog });
  let client = createClient({ seed: 20261007, difficulty: 'NORMAL', roundLimit: 9, data: clientData, catalog: clientCatalog });
  node.funds = client.funds = 30;
  const records = {};
  const perform = (name, action) => {
    const before = node;
    const advanced = actNode(node, action, { data: nodeData, catalog: nodeCatalog });
    const mirrored = actClient(client, action, { data: clientData, catalog: clientCatalog });
    assert.deepEqual(mirrored, advanced, `${name} delta fixture stays engine-equal`);
    assert.equal(advanced.ok, true, `${name} action fixture should succeed: ${advanced.error?.code || ''}`);
    records[name] = { requestBytes: deltaBytes(before, advanced.state), changedKeys: Object.keys(topLevelDelta(before, advanced.state)) };
    node = advanced.state; client = mirrored.state;
    return advanced;
  };
  const slot = node.shop.slots.findIndex((x) => x.kind === 'chess' && x.id && !x.sold);
  perform('buy', { type: 'buy', slot });
  const view = viewNode(node, { data: nodeData, catalog: nodeCatalog });
  const piece = view.pieces[0];
  const [row, col] = piece.legalTiles[0].split(',').map(Number);
  perform('move', { type: 'move', uid: piece.uid, row, col });
  const itemId = 'precision'; // Unrestricted basic ATK badge; retained legacy gear may have a recipient restriction.
  grantEquipment(node, nodeCatalog, itemId, 1, { origin: 'fixture', phase: 'test' });
  grantEquipment(client, clientCatalog, itemId, 1, { origin: 'fixture', phase: 'test' });
  assert.deepEqual(client, node);
  const itemUid = node.inventory.find(item => item.id === itemId).uid;
  perform('equip', { type: 'equip', itemUid, targetUid: piece.uid });
  perform('refresh', { type: 'refresh' });
  const battle = perform('battle', { type: 'ready' });
  records.battle.replayBytes = Buffer.byteLength(JSON.stringify(battle.replay));
  const averageInteractiveBytes = ['buy', 'move', 'equip', 'refresh'].reduce((sum, key) => sum + records[key].requestBytes, 0) / 4;
  records.inputModel = { concurrentUsers: 50, oneActionEverySeconds: 5, averageInteractiveBytesPerAction: averageInteractiveBytes,
    totalBytesPer5Seconds: Math.ceil(averageInteractiveBytes * 50), bitsPerSecond: Math.ceil(averageInteractiveBytes * 50 / 5 * 8),
    battleCheckpointBytes: records.battle.requestBytes, battleReplayBytes: records.battle.replayBytes };
  return records;
}

function playableAction(state) {
  if (state.phase === 'prize') {
    const offer = state.offers[0];
    return { type: 'choose', offerId: offer.id, index: 0 };
  }
  if (state.phase !== 'prep') return null;
  const slot = state.shop.slots.findIndex((x) => x.kind === 'chess' && x.id && !x.sold);
  if (slot >= 0 && state.funds >= 3 && state.pieces.length < 8) return { type: 'buy', slot };
  const view = viewNode(state, { data: nodeData, catalog: nodeCatalog });
  const occupied = new Set(state.pieces.filter((p) => p.row != null).map((p) => `${p.row},${p.col}`));
  for (const piece of view.pieces) {
    if (piece.row != null) continue;
    const tile = piece.legalTiles.find((t) => !occupied.has(t));
    if (tile) {
      const [row, col] = tile.split(',').map(Number);
      return { type: 'move', uid: piece.uid, row, col };
    }
  }
  return { type: 'ready' };
}

async function compareFullGame(roundLimit) {
  const seed = roundLimit === 9 ? 20261007 : 20261015;
  let node = createNode({ seed, difficulty: roundLimit === 9 ? 'FUNNY' : 'NORMAL', roundLimit, data: nodeData, catalog: nodeCatalog });
  let client = createClient({ seed, difficulty: roundLimit === 9 ? 'FUNNY' : 'NORMAL', roundLimit, data: clientData, catalog: clientCatalog });
  // This is a fixture for rule parity across the full round schedule; the deterministic session actions stay native.
  node.lp = client.lp = 100_000;
  node.funds = client.funds = 30;
  assert.deepEqual(client, node, 'same seed must create the same native state');
  const replayRounds = [];
  const roundMatrix = [];
  let actions = 0;
  while (node.phase !== 'finished' && actions++ < 500) {
    if (node.phase === 'prep') {
      const view = viewNode(node, { data: nodeData, catalog: nodeCatalog });
      const placed = new Set(node.pieces.filter((p) => p.row != null).map((p) => `${p.row},${p.col}`));
      for (const piece of view.pieces) {
        if (piece.row != null) continue;
        const tile = piece.legalTiles.find((x) => !placed.has(x));
        if (!tile) continue;
        const [row, col] = tile.split(',').map(Number);
        [node, client] = advancePair(node, client, { type: 'move', uid: piece.uid, row, col });
        placed.add(tile);
      }
      const shopSlot = node.shop.slots.findIndex((x) => x.kind === 'chess' && x.id && !x.sold);
      if (shopSlot >= 0 && node.funds >= 3 && node.pieces.length < 8) [node, client] = advancePair(node, client, { type: 'buy', slot: shopSlot });
      // Newly bought units begin on the bench; deploy one legal unit before the round starts.
      const fresh = viewNode(node, { data: nodeData, catalog: nodeCatalog }).pieces.find((p) => p.row == null);
      if (fresh) {
        const occupied = new Set(node.pieces.filter((p) => p.row != null).map((p) => `${p.row},${p.col}`));
        const tile = fresh.legalTiles.find((x) => !occupied.has(x));
        if (tile) {
          const [row, col] = tile.split(',').map(Number);
          [node, client] = advancePair(node, client, { type: 'move', uid: fresh.uid, row, col });
        }
      }
      const ready = actNode(node, { type: 'ready' }, { data: nodeData, catalog: nodeCatalog });
      const clientReady = actClient(client, { type: 'ready' }, { data: clientData, catalog: clientCatalog });
      assert.deepEqual(clientReady, ready, `ready round ${node.round}`);
      const readyStateBytes = Buffer.byteLength(JSON.stringify(ready.state));
      if (readyStateBytes > measured.maxStateBytes) { measured.maxStateBytes = readyStateBytes; measured.maxStateAtRound = ready.state.round; }
      if (ready.replay) {
        replayRounds.push(ready.replay.round);
        const replayBytes = Buffer.byteLength(JSON.stringify(ready.replay));
        if (replayBytes > measured.maxReplayBytes) { measured.maxReplayBytes = replayBytes; measured.maxReplayAtRound = ready.replay.round; }
        roundMatrix.push({ round: ready.replay.round, checkpointBytes: readyStateBytes, replayBytes,
          replayFrames: ready.replay.frames?.length || 0, replayField: ready.replay.field?.fieldId || null });
      }
      node = ready.state; client = clientReady.state;
      assert.deepEqual(client, node, `state after ready round ${ready.replay?.round}`);
      if (!ready.ok) throw new Error(`ready failed: ${ready.error?.code}`);
      continue;
    }
    const action = playableAction(node);
    assert.ok(action, `expected an action for phase ${node.phase}`);
    [node, client] = advancePair(node, client, action);
  }
  assert.equal(node.phase, 'finished', `round ${roundLimit} game should finish within the action bound`);
  assert.deepEqual(client, node);
  assert.ok(replayRounds.includes(1));
  assert.ok(replayRounds.includes(roundLimit === 9 ? 9 : 14), 'leader round should be recorded');
  if (roundLimit === 15) assert.ok(replayRounds.includes(15), 'hidden round should be recorded');
  assert.ok(Buffer.byteLength(JSON.stringify(node)) < 2 * 1024 * 1024, 'complete native session must fit the bounded checkpoint body');
  return { replayRounds, roundMatrix };
}

test('browser engine and Node engine deep-equal through a complete leader and hidden-round session', async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(clientCatalog)), JSON.parse(JSON.stringify(nodeCatalog)), 'generated catalog matches this checkout');
  assert.deepEqual(clientDisplayModule.independentDisplayCatalog(clientData, clientCatalog, clientData['independent-game-text']),
    displayNodeCatalog(nodeData, nodeCatalog, nodeData['independent-game-text']), 'worker display catalog matches the server catalog exactly');
  const short = await compareFullGame(9);
  assert.deepEqual(short.replayRounds, Array.from({ length: 9 }, (_, i) => i + 1));
  const full = await compareFullGame(15);
  const rounds = full.replayRounds;
  assert.ok(rounds.includes(14));
  assert.ok(rounds.includes(15));
  const footprint = { measurement: 'UTF-8 JSON serialization of native checkpoint delta requests, full session state, and settled replay',
    maxCheckpointBytes: measured.maxStateBytes, maxCheckpointAtRound: measured.maxStateAtRound,
    estimated50MaxCheckpointsBytes: measured.maxStateBytes * 50, maxBrowserReplayBytes: measured.maxReplayBytes,
    maxBrowserReplayAtRound: measured.maxReplayAtRound, browserReplayRetentionBytes: 32 * 1024 * 1024,
    deltaProfile: sampleActionDeltaProfile(),
    roundMatrix: [{ roundLimit: 9, rounds: short.roundMatrix }, { roundLimit: 15, rounds: full.roundMatrix }] };
  await mkdir(path.dirname(footprintPath), { recursive: true });
  await writeFile(footprintPath, `${JSON.stringify(footprint, null, 2)}\n`);
  console.log(JSON.stringify({ footprintPath, ...footprint }));
});
