import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { createAssaultHttp } from '../../server/modes/assault/http.js';
import { createRun, applyAction } from '../../shared/assault/run.js';

const { runtime, nativeData } = getAssaultData();
const design = loadAssaultDesign();
let settleCalls = 0;
const context = {
  catalog: runtime, runtime, nativeData, design,
  assetManifest: { schema: 'test-assets/v1' }, publicText: { schema: 'test-text/v1' },
  canPlace: () => true,
  prepareBattle: (state, encounter) => ({ battleId: `test:${state.runId}:${encounter.id}`, input: { runId: state.runId, pieces: state.pieces }, encounter, field: { field: 'normal' }, config: { battleSeconds: 120 } }),
  settleBattle: (state, battle) => { settleCalls += 1; return { battleId: battle.battleId, victory: true, leakedLife: 0, summary: { trusted: true } }; },
};

function request(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('assault HTTP supports catalog, three real directors, idempotent actions, trusted settle and import/export', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'assault-http-'));
  const handler = createAssaultHttp({ context, runRoot: path.resolve(root) });
  const server = http.createServer((req, res) => handler(req, res, req.url).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const port = server.address().port;
  const json = (reply) => JSON.parse(reply.body.toString('utf8'));

  const catalog = await request(port, 'GET', '/api/assault/catalog');
  assert.equal(catalog.status, 200);
  assert.equal(Object.keys(json(catalog).runtime.operators).length, 167);
  assert.equal(json(catalog).assetManifest.schema, 'test-assets/v1');

  const created = [];
  for (const director of design.system.directors) {
    const reply = await request(port, 'POST', '/api/assault/runs', { directorId: director.id, seed: 10 });
    assert.equal(reply.status, 201);
    const payload = json(reply);
    assert.equal(payload.state.pieces.length, 3);
    assert.deepEqual(payload.state.pieces.map((piece) => piece.charId), director.startTeam);
    assert.equal(payload.state.seed, 10);
    created.push(payload.runId);
  }
  const omittedSeedReply = await request(port, 'POST', '/api/assault/runs', { directorId: design.system.directors[0].id });
  assert.equal(omittedSeedReply.status, 201);
  const omittedSeedRun = json(omittedSeedReply);
  assert.ok(Number.isInteger(omittedSeedRun.state.seed));
  assert.ok(omittedSeedRun.state.seed >= 0 && omittedSeedRun.state.seed <= 0xffffffff);
  const loadedOmittedSeedRun = json(await request(port, 'GET', `/api/assault/runs/${omittedSeedRun.runId}`));
  assert.equal(loadedOmittedSeedRun.state.seed, omittedSeedRun.state.seed);
  const shopRunId = created[1];
  const shopInitial = json(await request(port, 'GET', `/api/assault/runs/${shopRunId}`));
  const shopNode = shopInitial.state.choices.find((node) => node.kind === 'shop');
  const shopSelected = await request(port, 'POST', `/api/assault/runs/${shopRunId}/actions`, { type: 'selectNode', nodeId: shopNode.id, opId: 'shop-select', expectedRevision: 0 });
  assert.equal(shopSelected.status, 200);
  const shopState = json(shopSelected).state;
  const affordable = shopState.shop.slots.find((slot) => slot.price <= shopState.gold);
  const bought = await request(port, 'POST', `/api/assault/runs/${shopRunId}/actions`, { type: 'buy', slotId: affordable.slotId, opId: 'shop-buy', expectedRevision: 1 });
  assert.equal(bought.status, 200);
  assert.equal(json(bought).state.pieces.length, 4);
  const runId = created[0];
  const initial = json(await request(port, 'GET', `/api/assault/runs/${runId}`));
  const battleNode = initial.state.choices.find((node) => node.kind === 'battle');
  const selected = await request(port, 'POST', `/api/assault/runs/${runId}/actions`, { type: 'selectNode', nodeId: battleNode.id, opId: 'select', expectedRevision: 0 });
  assert.equal(selected.status, 200);
  const duplicate = await request(port, 'POST', `/api/assault/runs/${runId}/actions`, { type: 'selectNode', nodeId: battleNode.id, opId: 'select', expectedRevision: 0 });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(json(duplicate).result, json(selected).result);
  assert.equal(json(duplicate).state.revision, 1);

  const conflict = await request(port, 'POST', `/api/assault/runs/${runId}/actions`, { type: 'selectNode', nodeId: battleNode.id, opId: 'other', expectedRevision: 0 });
  assert.equal(conflict.status, 409);
  const ready = await request(port, 'POST', `/api/assault/runs/${runId}/actions`, { type: 'readyBattle', opId: 'ready', expectedRevision: 1 });
  assert.equal(ready.status, 200);
  const battleA = json(await request(port, 'GET', `/api/assault/runs/${runId}/battle`));
  const battleB = json(await request(port, 'GET', `/api/assault/runs/${runId}/battle`));
  assert.deepEqual(battleA.battle, battleB.battle);
  assert.equal(battleA.battle.config.battleSeconds, 120);
  const refused = await request(port, 'POST', `/api/assault/runs/${runId}/settle`, { battleId: battleA.battle.battleId, opId: 'settle-bad', expectedRevision: 2, victory: true });
  assert.equal(refused.status, 422);
  const settled = await request(port, 'POST', `/api/assault/runs/${runId}/settle`, { battleId: battleA.battle.battleId, opId: 'settle', expectedRevision: 2 });
  assert.equal(settled.status, 200);
  const settledAgain = await request(port, 'POST', `/api/assault/runs/${runId}/settle`, { battleId: battleA.battle.battleId, opId: 'settle', expectedRevision: 2 });
  assert.equal(settledAgain.status, 200);
  assert.equal(settleCalls, 1);

  const exported = await request(port, 'GET', `/api/assault/runs/${runId}/export`);
  assert.equal(exported.status, 200);
  const imported = await request(port, 'POST', '/api/assault/runs/import', { run: JSON.parse(exported.body.toString('utf8')) });
  assert.equal(imported.status, 201);
  assert.notEqual(json(imported).runId, runId);
});

test('assault HTTP skill rewards accept a choice once and reject invalid choices or unrelated fields atomically', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'assault-http-skill-'));
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  t.diagnostic(`isolated store (removed after test): ${path.resolve(root)}`);
  const handler = createAssaultHttp({ context, runRoot: path.resolve(root) });
  const server = http.createServer((req, res) => handler(req, res, req.url).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const port = server.address().port;
  const json = (reply) => JSON.parse(reply.body.toString('utf8'));

  const fixture = createRun({ runId: 'http-skill-reward-fixture', seed: 702, directorId: design.system.directors[0].id }, context);
  fixture.xp = design.system.run.xpThresholds[1] - design.system.run.xpPerHour;
  const shopNode = fixture.nodeChoices.find((node) => node.kind === 'shop');
  const inShop = applyAction(fixture, { type: 'selectNode', nodeId: shopNode.id, opId: 'fixture-shop', expectedRevision: fixture.revision }, context).state;
  const pending = applyAction(inShop, { type: 'finishShop', opId: 'fixture-finish-shop', expectedRevision: inShop.revision }, context).state;
  assert.equal(pending.phase, 'skillChoice');
  const imported = await request(port, 'POST', '/api/assault/runs/import', { run: pending });
  assert.equal(imported.status, 201);
  const { runId, state: before } = json(imported);
  const skillId = before.skillRewards.choices[0];
  const pathname = `/api/assault/runs/${runId}/actions`;
  const unchanged = async () => assert.deepEqual(json(await request(port, 'GET', `/api/assault/runs/${runId}`)).state, before);

  const unknown = await request(port, 'POST', pathname, { type: 'chooseSkill', skillId: 'not-offered', opId: 'bad-skill', expectedRevision: before.revision });
  assert.equal(unknown.status, 422);
  assert.equal(json(unknown).error.code, 'UNKNOWN_SKILL_REWARD_CHOICE');
  await unchanged();
  for (const invalid of [null, 7, ' ']) {
    const reply = await request(port, 'POST', pathname, { type: 'chooseSkill', skillId: invalid, opId: 'bad-skill-shape', expectedRevision: before.revision });
    assert.equal(reply.status, 422);
    assert.equal(json(reply).error.code, 'INVALID_BODY');
    await unchanged();
  }
  for (const extra of [{ unexpected: true }, { uid: before.pieces[0].uid }]) {
    const reply = await request(port, 'POST', pathname, { type: 'chooseSkill', skillId, opId: 'bad-extra', expectedRevision: before.revision, ...extra });
    assert.equal(reply.status, 422);
    assert.equal(json(reply).error.code, 'INVALID_BODY');
    await unchanged();
  }

  const action = { type: 'chooseSkill', skillId, opId: 'choose-free-skill', expectedRevision: before.revision };
  const selected = await request(port, 'POST', pathname, action);
  assert.equal(selected.status, 200);
  const chosen = json(selected);
  assert.equal(chosen.result.free, true);
  assert.equal(chosen.state.skillRanks[skillId], (before.skillRanks[skillId] ?? 0) + 1);
  assert.equal(chosen.state.gold, before.gold);
  assert.equal(chosen.state.revision, before.revision + 1);
  const duplicate = await request(port, 'POST', pathname, action);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(json(duplicate).result, chosen.result);
  assert.deepEqual(json(duplicate).state, chosen.state);

  const unrelatedAction = await request(port, 'POST', pathname, { type: 'finishShop', skillId, opId: 'wrong-action-field', expectedRevision: chosen.state.revision });
  assert.equal(unrelatedAction.status, 422);
  assert.equal(json(unrelatedAction).error.code, 'INVALID_BODY');
  assert.deepEqual(json(await request(port, 'GET', `/api/assault/runs/${runId}`)).state, chosen.state);

  const upgradeFixture = createRun({ runId: 'http-operator-upgrade-fixture', seed: 703, directorId: design.system.directors[0].id }, context);
  const upgrade = design.system.operatorUpgradeRewards[0];
  upgradeFixture.tech = upgrade.tech;
  upgradeFixture.xp = design.system.run.xpThresholds[upgrade.tech - 1];
  upgradeFixture.phase = 'upgradeChoice';
  const targetUid = upgradeFixture.pieces[0].uid;
  upgradeFixture.claimed.push(`operator-upgrade-reward:${upgrade.id}`);
  upgradeFixture.pendingUpgradeRewards = [{ id: upgrade.id, tech: upgrade.tech, maxStar: upgrade.maxStar,
    count: upgrade.count, choices: [targetUid] }];
  const importedUpgrade = await request(port, 'POST', '/api/assault/runs/import', { run: upgradeFixture });
  assert.equal(importedUpgrade.status, 201);
  const upgradeRun = json(importedUpgrade);
  assert.deepEqual(upgradeRun.state.upgradeRewards.choices, [targetUid]);
  const upgradePath = `/api/assault/runs/${upgradeRun.runId}/actions`;
  const beforeUpgrade = upgradeRun.state;
  const malformedUpgrade = await request(port, 'POST', upgradePath, { type: 'chooseUpgrade', uid: targetUid,
    opId: 'bad-upgrade-extra', expectedRevision: beforeUpgrade.revision, skillId: 'unrelated' });
  assert.equal(malformedUpgrade.status, 422);
  assert.equal(json(malformedUpgrade).error.code, 'INVALID_BODY');
  assert.deepEqual(json(await request(port, 'GET', `/api/assault/runs/${upgradeRun.runId}`)).state, beforeUpgrade);
  const upgradeAction = { type: 'chooseUpgrade', uid: targetUid, opId: 'choose-free-upgrade', expectedRevision: beforeUpgrade.revision };
  const upgraded = await request(port, 'POST', upgradePath, upgradeAction);
  assert.equal(upgraded.status, 200);
  assert.equal(json(upgraded).result.star, 2);
  assert.equal(json(upgraded).state.pieces.find((piece) => piece.uid === targetUid).star, 2);
  const repeatedUpgrade = await request(port, 'POST', upgradePath, upgradeAction);
  assert.equal(repeatedUpgrade.status, 200);
  assert.deepEqual(json(repeatedUpgrade).state, json(upgraded).state);
});

test('assault HTTP rejects oversized bodies and leaves unknown URLs for the main router', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'assault-http-limit-'));
  const handler = createAssaultHttp({ context, runRoot: path.resolve(root) });
  t.after(() => rm(root, { recursive: true, force: true }));
  const response = { writeHead() {}, end() {} };
  assert.equal(await handler({ method: 'GET', headers: {}, async *[Symbol.asyncIterator]() {} }, response, '/api/assault/not-a-route'), false);
  const server = http.createServer((req, res) => handler(req, res, req.url));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const huge = 'x'.repeat(9 * 1024 * 1024);
  const reply = await request(server.address().port, 'POST', '/api/assault/runs', { directorId: design.system.directors[0].id, seed: 1, sourcePath: huge });
  assert.equal(reply.status, 413);
});
