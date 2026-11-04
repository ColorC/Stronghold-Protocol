// Saves written before the synergy primitives (copies of three real player runs of 2026-10-21, see fixtures/legacy-saves)
// load through the real store, continue to a fought and settled battle, sell, and merge. The growth primitive adds no
// field to the save: 本局成长 lives in the piece's permanent maps the saves already carry (empty = 0), summed on merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { createAssaultHttp } from '../../server/modes/assault/http.js';
import { mergeInventory, applyPermanentEffect } from '../../shared/assault/inventory.js';
import { applyAction } from '../../shared/assault/run.js';
import { synergyBattle } from '../helpers/synergyCard.js';
import { runCounter, runCounterValue } from '../../server/sim/content/assault/synergy.js';
import { growthView } from '../../public/js/assault/model.js';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';

const FIXTURES = new URL('./fixtures/legacy-saves/', import.meta.url);
// the runtime and card text under test (ASSAULT_RUNTIME_PATH / ASSAULT_PUBLIC_TEXT_PATH at the gate, else this tree's):
// the gate's rules root holds the release runtime, whose bodies the synergy kits of this code cannot run
const publicTextPath = process.env.ASSAULT_PUBLIC_TEXT_PATH && path.isAbsolute(process.env.ASSAULT_PUBLIC_TEXT_PATH)
  ? process.env.ASSAULT_PUBLIC_TEXT_PATH : new URL('../../data/assault-public-text.json', import.meta.url);
const context = createAssaultContext({ runtime: loadAssaultRuntime(), publicText: JSON.parse(await readFile(publicTextPath, 'utf8')) });

function request(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function serve(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'assault-legacy-save-'));
  const handler = createAssaultHttp({ context, runRoot: path.resolve(root) });
  const server = http.createServer((req, res) => handler(req, res, req.url).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return { root, port: server.address().port };
}

const saves = (await readdir(FIXTURES)).filter((name) => name.endsWith('.json')).sort();

test('the three legacy saves are present and keep the piece growth fields of their time', async () => {
  assert.equal(saves.length, 3);
  for (const name of saves) {
    const state = JSON.parse(await readFile(new URL(name, FIXTURES), 'utf8'));
    assert.equal(state.schema, 'assault-run/v1');
    for (const piece of state.pieces) {
      assert.deepEqual(growthView(piece).run, [], 'no growth yet: every stat counts 0');
    }
  }
});

for (const name of saves) {
  test(`legacy save ${name.slice(0, 8)}: loads with the new code, sells, fights and settles a battle`, async (t) => {
    const { root, port } = await serve(t);
    const saved = JSON.parse(await readFile(new URL(name, FIXTURES), 'utf8'));
    // the store reads the file as the service does (a copy: the fixture itself is never written)
    await writeFile(path.join(root, `${saved.runId}.json`), JSON.stringify(saved));
    const base = `/api/assault/runs/${saved.runId}`;
    let reply = await request(port, 'GET', base);
    assert.equal(reply.status, 200, JSON.stringify(reply.body?.error));
    let state = reply.body.state;
    assert.equal(state.runId, saved.runId);
    let op = 0;
    const act = async (body) => {
      const out = await request(port, 'POST', `${base}/actions`, { ...body, opId: `legacy-${op++}`, expectedRevision: state.revision });
      assert.equal(out.status, 200, `${body.type}: ${JSON.stringify(out.body?.error)}`);
      state = out.body.state;
      return out.body;
    };
    let sold = false, settled = null;
    for (let guard = 0; guard < 24 && !settled; guard++) {
      if (!sold && ['shop', 'battlePrep', 'nodeChoice'].includes(state.phase) && state.pieces.length >= 2) {
        const piece = state.pieces.find((p) => !p.starter) ?? state.pieces.at(-1);
        const gold = state.gold;
        const out = await act({ type: 'sell', uid: piece.uid });
        assert.ok(out.result.price > 0 && state.gold === gold + out.result.price);
        assert.ok(!state.pieces.some((p) => p.uid === piece.uid), 'the sold piece and its growth are gone');
        sold = true;
        continue;
      }
      if (state.phase === 'shop') { await act({ type: 'finishShop' }); continue; }
      if (state.phase === 'event') { await act({ type: 'leaveEvent' }); continue; }
      if (state.phase === 'nodeChoice') {
        const node = state.choices.find((c) => c.kind === 'battle') ?? state.choices[0];
        await act({ type: 'selectNode', nodeId: node.id });
        continue;
      }
      if (state.phase === 'battlePrep') { await act({ type: 'readyBattle' }); continue; }
      if (state.phase === 'battle') {
        const battle = await request(port, 'GET', `${base}/battle`);
        assert.equal(battle.status, 200, JSON.stringify(battle.body?.error));
        const out = await request(port, 'POST', `${base}/settle`, { battleId: battle.body.battle.battleId, opId: `legacy-settle-${op++}`, expectedRevision: state.revision });
        assert.equal(out.status, 200, JSON.stringify(out.body?.error));
        state = out.body.state;
        settled = out.body.result;
        continue;
      }
      assert.fail(`unexpected phase ${state.phase}`);
    }
    assert.ok(settled && typeof settled.victory === 'boolean', 'a battle was fought by the real simulator and settled');
    assert.ok(sold, 'a piece was sold');
    for (const piece of state.pieces) for (const row of growthView(piece).run) assert.ok(Number.isFinite(row.amount));
    // the original fixture stays as it was
    assert.deepEqual(JSON.parse(await readFile(new URL(name, FIXTURES), 'utf8')), saved);
  });
}

test('merging legacy pieces: an empty growth map counts 0, growth of both copies is summed', async () => {
  const saved = JSON.parse(await readFile(new URL(saves[0], FIXTURES), 'utf8'));
  const piece = saved.pieces.find((p) => p.star === 1);
  assert.ok(piece, 'a one-star piece');
  const legacy = structuredClone(piece);
  const grown = { ...structuredClone(piece), uid: `${piece.uid}-copy`, row: null, col: null,
    permanentFlat: { atk: 45 }, permanentPercentSources: { [`def:growth:${piece.uid}-copy:block:percent`]: { def: 0.05 } }, permanentPercent: { def: 0.05 } };
  const [merged] = mergeInventory([legacy, grown], context);
  assert.equal(merged.star, 2);
  assert.equal(merged.permanentFlat.atk, 45);
  assert.equal(merged.permanentPercent.def, 0.05);
  const other = { ...structuredClone(piece), uid: `${piece.uid}-other`, row: null, col: null,
    permanentFlat: { atk: 30 }, permanentPercentSources: { [`def:growth:${piece.uid}-other:block:percent`]: { def: 0.1 } }, permanentPercent: { def: 0.1 } };
  const [both] = mergeInventory([structuredClone(grown), other], context);
  assert.equal(both.permanentFlat.atk, 75, 'flat growth summed');
  assert.ok(Math.abs(both.permanentPercent.def - 0.15) < 1e-12, 'percent growth of two copies summed');
  assert.deepEqual(growthView(both).run.map(({ stat, mode, amount }) => [stat, mode, amount]), [['atk', 'flat', 75], ['def', 'percent', 15]]);
});

test('卡内本局永久成长 (runCounter): settles into piece.permanentCounters, sums on merge, goes with a sale; old saves count 0', async () => {
  // in battle: earlier battles (the piece) + this battle's gains
  const h = synergyBattle([{ charId: 'char_4145_ulpia', row: 10, col: 3, piece: { permanentCounters: { prey: { label: '弱肉强食攻击力', suffix: '%', amount: 6 } } } },
    { charId: 'char_172_svrash', row: 11, col: 6 }]);
  const [ulpia, plain] = h.units;
  assert.equal(runCounterValue(h.battle, ulpia, 'prey'), 6);
  assert.equal(runCounterValue(h.battle, plain, 'prey'), 0, 'a piece without counters counts 0');
  assert.equal(runCounter(h.battle, plain, ulpia, { key: 'prey', label: '弱肉强食攻击力', amount: 3, suffix: '%' }), 9);
  runCounter(h.battle, plain, ulpia, { key: 'prey', label: '弱肉强食攻击力', amount: 3, suffix: '%' });
  assert.equal(runCounterValue(h.battle, ulpia, 'prey'), 12);
  const effect = h.battle.assaultPermanentEffects.find((x) => x.mode === 'counter');
  assert.deepEqual({ uid: effect.uid, key: effect.counterKey, amount: effect.amount }, { uid: ulpia.uid, key: 'prey', amount: 6 });
  // settlement through the real run rules: the effect lands on the piece
  const saved = JSON.parse(await readFile(new URL(saves.find((n) => n.startsWith('575c8f15')), FIXTURES), 'utf8'));
  const pieceUid = saved.pieces[0].uid;
  const rules = { ...context, settleBattle: (_state, battle) => ({ battleId: battle.battleId, victory: true, leakedLife: 0,
    permanentEffects: [{ ...effect, uid: pieceUid }] }) };
  const ready = applyAction(saved, { type: 'readyBattle', opId: 'counter-ready', expectedRevision: saved.revision }, rules).state;
  const settled = applyAction(ready, { type: 'settleBattle', battleId: ready.currentBattle.battleId, opId: 'counter-settle', expectedRevision: ready.revision }, rules).state;
  const piece = settled.pieces.find((p) => p.uid === pieceUid);
  assert.deepEqual(piece.permanentCounters, { prey: { label: '弱肉强食攻击力', suffix: '%', amount: 6 } });
  assert.deepEqual(growthView(piece).run.filter((r) => r.mode === 'counter'), [{ stat: 'counter', mode: 'counter', label: '弱肉强食攻击力', suffix: '%', amount: 6 }]);
  // merge: both copies' counters add up; a copy without the field counts 0
  const a = { ...structuredClone(piece), uid: 'merge-a', row: null, col: null, star: 1, sourceCopies: 1 };
  const b = { ...structuredClone(piece), uid: 'merge-b', row: null, col: null, star: 1, sourceCopies: 1 };
  applyPermanentEffect(b, { stat: 'counter', mode: 'counter', counterKey: 'prey', label: '弱肉强食攻击力', suffix: '%', amount: 4 });
  const [merged] = mergeInventory([a, b], context);
  assert.equal(merged.permanentCounters.prey.amount, 6 + 10);
  const bare = { ...structuredClone(a), uid: 'merge-c' }; delete bare.permanentCounters;
  const [mergedBare] = mergeInventory([bare, structuredClone(a)], context);
  assert.equal(mergedBare.permanentCounters.prey.amount, 6);
  // a sale takes the piece and its counters away (sold from the next preparation; the settled state waits on its reward)
  const prep = { ...structuredClone(settled), phase: 'battlePrep', rewardQueue: null };
  const sold = applyAction(prep, { type: 'sell', uid: pieceUid, opId: 'counter-sell', expectedRevision: prep.revision }, rules).state;
  assert.ok(!sold.pieces.some((p) => p.uid === pieceUid));
});

test('piece counters of a save are checked on load: absent = 0, well-formed loads, malformed is refused like any bad field', async (t) => {
  const { root, port } = await serve(t);
  const saved = JSON.parse(await readFile(new URL(saves.find((n) => n.startsWith('575c8f15')), FIXTURES), 'utf8'));
  const write = async (runId, mutate) => {
    const copy = structuredClone(saved);
    copy.runId = runId;
    mutate(copy.pieces[0]);
    await writeFile(path.join(root, `${runId}.json`), JSON.stringify(copy));
    return request(port, 'GET', `/api/assault/runs/${runId}`);
  };
  const id = (n) => `${saved.runId.slice(0, -2)}${String(n).padStart(2, '0')}`;
  const absent = await write(id(1), (p) => { delete p.permanentCounters; });
  assert.equal(absent.status, 200, 'older saves have no counters');
  const good = await write(id(2), (p) => { p.permanentCounters = { prey: { label: '弱肉强食攻击力', suffix: '%', amount: 6 } }; });
  assert.equal(good.status, 200, JSON.stringify(good.body?.error));
  assert.deepEqual(good.body.state.pieces[0].permanentCounters, { prey: { label: '弱肉强食攻击力', suffix: '%', amount: 6 } });
  for (const [n, bad] of [[3, []], [4, { prey: 6 }], [5, { prey: { label: '', amount: 1 } }], [6, { prey: { label: 'x', amount: 'NaN' } }],
    [7, { prey: { label: 'x', amount: 1, extra: true } }], [8, { prey: { label: 'x', suffix: 5, amount: 1 } }]]) {
    const reply = await write(id(n), (p) => { p.permanentCounters = bad; });
    assert.notEqual(reply.status, 200, `refused: ${JSON.stringify(bad)}`);
    assert.equal(reply.body?.error?.code, 'INVALID_RUN');
  }
});
