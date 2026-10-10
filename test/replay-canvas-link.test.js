import test from 'node:test';
import assert from 'node:assert/strict';
import { mountReplayInCanvas, REPLAY_CANVAS_ID } from '../public/js/independent/replayCanvasLink.js';

const recordingId = 'a1b2c3d4-1234-4abc-8def-1234567890ab';
const reviewUrl = 'https://review.example.test/replay/a1b2c3d4';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function doc(cards = [], revision = 4) {
  return { document: { revision, cards }, workspace_ref: { kind: 'workshop-canvas', ref: 'canvas:canvas-0470c0a1' } };
}

function fetchQueue(items, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const next = items.shift();
    if (!next) throw new Error(`Unexpected request ${url}`);
    return typeof next === 'function' ? next(url, init, calls) : next;
  };
}

test('adds a material iframe card right of existing top-level bounds and verifies readback', async () => {
  const calls = [];
  const initial = doc([
    { id: 'left', x: 40, y: 90, width: 400, height: 220 },
    { id: 'right', x: 700, y: 50, width: 500, height: 340 },
    { id: 'nested', parentId: 'group', x: 5000, y: -4000, width: 900, height: 600 },
    { id: 'group', x: 1000, y: 80, width: 750, height: 820 },
  ]);
  const savedCard = (payload) => payload.patch.upsert_cards[0];
  const fetchImpl = fetchQueue([
    response(200, { user: { id: 'user-1', name: 'Signed-in user' } }),
    response(200, initial),
    (url, init) => {
      const payload = JSON.parse(init.body);
      assert.equal(url, `/bside/api/canvases/${REPLAY_CANVAS_ID}/mutations`);
      assert.equal(payload.base_revision, 4);
      assert.deepEqual(payload.workspace_ref, initial.workspace_ref);
      assert.deepEqual(payload.actor_ref, { kind: 'user', ref: 'user-1' });
      assert.ok(payload.mutation_id);
      assert.equal(payload.idempotency_key.includes(payload.mutation_id), true);
      const card = savedCard(payload);
      assert.equal(card.id, `replay-${recordingId}`);
      assert.equal(card.kind, 'material');
      assert.equal(card.title, '本局游玩回放与批注');
      assert.equal(card.adapter, 'web');
      assert.deepEqual(card.source, { kind: 'link', url: reviewUrl });
      assert.equal(card.material.runtime, 'iframe');
      assert.ok(card.material.material_ref);
      assert.ok(card.material.representation_id);
      assert.equal(card.width, 1440);
      assert.equal(card.height, 1060);
      assert.equal(card.x, 1910);
      assert.equal(card.y, 50);
      assert.equal(card.x >= 1750 + 160, true);
      return response(200, { revision: 5 });
    },
    response(200, doc([
      ...initial.document.cards,
      { id: `replay-${recordingId}` },
    ], 5)),
  ], calls);

  const result = await mountReplayInCanvas({ recordingId, reviewUrl, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.revision, 5);
  assert.equal(result.url, `/bside/canvas?project=arknights&canvas=${REPLAY_CANVAS_ID}#card=replay-${recordingId}`);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.init.credentials, 'same-origin');
    assert.equal(call.init.headers['x-workshop-project'], 'arknights');
  }
});

test('existing recording card is idempotent and does not mutate', async () => {
  const calls = [];
  const fetchImpl = fetchQueue([
    response(200, { user: { id: 'user-1', name: 'Signed-in user' } }),
    response(200, doc([{ id: `replay-${recordingId}` }], 9)),
  ], calls);
  const result = await mountReplayInCanvas({ recordingId, reviewUrl, fetchImpl });
  assert.equal(result.created, false);
  assert.equal(result.revision, 9);
  assert.equal(calls.length, 2);
});

test('401 and 403 return explicit errors without issuing a mutation', async () => {
  for (const [status, expected] of [[401, /会话已失效/], [403, /无权编辑/]]) {
    const calls = [];
    const fetchImpl = fetchQueue([
      response(200, { user: { id: 'user-1', name: 'Signed-in user' } }),
      response(status, { error: 'scope_denied' }),
    ], calls);
    await assert.rejects(mountReplayInCanvas({ recordingId, reviewUrl, fetchImpl }), expected);
    assert.equal(calls.some((call) => call.init.method === 'POST'), false);
  }
});

test('409 rereads once, recalculates position, and retries once', async () => {
  const calls = [];
  const fetchImpl = fetchQueue([
    response(200, { user: { id: 'user-1', name: 'Signed-in user' } }),
    response(200, doc([], 2)),
    response(409, { error: 'canvas_conflict' }),
    response(200, doc([{ id: 'newer', x: 100, y: 40, width: 500, height: 400 }], 3)),
    response(200, { revision: 4 }),
    response(200, doc([{ id: `replay-${recordingId}` }], 4)),
  ], calls);
  const result = await mountReplayInCanvas({ recordingId, reviewUrl, fetchImpl });
  assert.equal(result.revision, 4);
  const mutations = calls.filter((call) => call.init.method === 'POST');
  assert.equal(mutations.length, 2);
  assert.equal(JSON.parse(mutations[1].init.body).patch.upsert_cards[0].x, 760);
});

test('non-conflict mutation failures are preserved and are not reported as success', async () => {
  const calls = [];
  const fetchImpl = fetchQueue([
    response(200, { user: { id: 'user-1', name: 'Signed-in user' } }),
    response(200, doc([], 2)),
    response(400, { error: 'canvas_mutation_rejected', detail: 'invalid source' }),
  ], calls);
  await assert.rejects(mountReplayInCanvas({ recordingId, reviewUrl, fetchImpl }), /invalid source/);
  assert.equal(calls.length, 3);
});

test('invalid input never makes a request', async () => {
  let called = false;
  await assert.rejects(mountReplayInCanvas({ recordingId: 'bad', reviewUrl, fetchImpl: async () => { called = true; } }), /录像标识无效/);
  assert.equal(called, false);
});
