import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { createAssaultHttp } from '../../server/modes/assault/http.js';

// 10-21 a player's fresh run answered every move with 「请求无法完成」: day 1 already fields its three starters, so the
// fourth operator could not go on the board (POPULATION_FULL), and with no funds left buying / refreshing was refused
// (INSUFFICIENT_GOLD). Rule refusals must say what happened, in every shipped language.
const { runtime, nativeData } = getAssaultData();
const design = loadAssaultDesign();
const context = {
  catalog: runtime, runtime, nativeData, design,
  assetManifest: { schema: 'test-assets/v1' }, publicText: { schema: 'test-text/v1' },
  canPlace: () => true,
  prepareBattle: () => { throw new Error('not used'); },
  settleBattle: () => { throw new Error('not used'); },
};
const here = path.dirname(fileURLToPath(import.meta.url));
const packs = ['en', 'ja', 'ko', 'zh-TW'].map((lang) => [lang, JSON.parse(fs.readFileSync(path.join(here, '../../public/i18n', `${lang}.json`), 'utf8'))]);

function request(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('rule refusals in the shop name the reason (funds, deployment limit, wrong phase) in every language', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'assault-rule-errors-'));
  const handler = createAssaultHttp({ context, runRoot: path.resolve(root) });
  const server = http.createServer((req, res) => handler(req, res, req.url).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const port = server.address().port;
  let op = 0;
  const act = async (runId, revision, body) => request(port, 'POST', `/api/assault/runs/${runId}/actions`, { opId: `op-${op += 1}`, expectedRevision: revision, ...body });

  const created = await request(port, 'POST', '/api/assault/runs', { directorId: design.system.directors[0].id, seed: 10 });
  assert.equal(created.status, 201);
  const runId = created.body.runId;
  const shopNode = created.body.state.choices.find((node) => node.kind === 'shop');
  let reply = await act(runId, 0, { type: 'selectNode', nodeId: shopNode.id });
  assert.equal(reply.status, 200);
  let state = reply.body.state;
  assert.equal(state.pieces.filter((piece) => piece.row != null).length, 3, 'the starters fill day 1');

  const refusals = [];
  reply = await act(runId, state.revision, { type: 'readyBattle' });
  refusals.push([reply, '现在不能进行这个操作']);

  // Spend down to below the cheapest offer, then one more purchase is refused for funds.
  for (;;) {
    const slot = state.shop.slots.filter((s) => s.offered !== false).sort((a, b) => a.price - b.price)[0];
    if (!slot || slot.price > state.gold) break;
    reply = await act(runId, state.revision, { type: 'buy', slotId: slot.slotId });
    assert.equal(reply.status, 200);
    state = reply.body.state;
  }
  const benched = state.pieces.find((piece) => piece.row == null);
  assert.ok(benched, 'a bought operator waits on the bench');
  const leftover = state.shop.slots.find((s) => s.offered !== false);
  if (leftover) {
    reply = await act(runId, state.revision, { type: 'buy', slotId: leftover.slotId });
    refusals.push([reply, '资金不足']);
  }
  if(!leftover) {reply=await act(runId,state.revision,{type:'refreshShop'});refusals.push([reply,'资金不足']);}
  reply = await act(runId, state.revision, { type: 'place', uid: benched.uid, row: 12, col: 6, dir: 'E' });
  refusals.push([reply, '已达到部署上限']);

  for (const [refused, message] of refusals) {
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error.message, message);
    assert.notEqual(refused.body.error.message, '请求无法完成');
    for (const [lang, pack] of packs) assert.ok(typeof pack[message] === 'string' && pack[message].length, `${lang} translates ${message}`);
  }
  assert.ok(refusals.some(([, m]) => m === '资金不足'), 'the funds refusal was exercised');
});
