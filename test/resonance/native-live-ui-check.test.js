import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attachWsCapture, config, isAllowedHttpRequest, missingChecks, parseArgs, REQUIRED_CHECKS, runtimeFaults, screenshotCount, waitForPopup, waitSent } from '../../tools/resonance/native-live-ui-check.mjs';

const tool = fileURLToPath(new URL('../../tools/resonance/native-live-ui-check.mjs', import.meta.url));

test('prepare mode validates paths without launching a browser or service', () => {
  const result = spawnSync(process.execPath, [tool, '--validate-args'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.browserStarted, false);
  assert.equal(payload.port, 19003);
  assert.equal(payload.deadlineMs, 8 * 60_000);
  assert.match(payload.sessionDirectory.replaceAll('\\', '/'), /runtime\/resonance\/ui-verification\/native-live-test-sessions$/);
  assert.match(payload.serverMount.publicDir.replaceAll('\\', '/'), /\.worktrees\/resonance\/stronghold-protocol\/public$/);
  assert.equal(payload.serverMount.installDirReadOnlyFallback, payload.canonicalInstallDir);
  assert.equal(Object.keys(payload.screenshots).length, 10);
});

test('only creating an isolated session may use POST; REST gameplay mutations stay closed', () => {
  assert.equal(isAllowedHttpRequest('POST', '/resonance/api/sessions'), true);
  assert.equal(isAllowedHttpRequest('POST', '/resonance/api/admission'), true, 'native entry may obtain its bounded admission lease');
  assert.equal(isAllowedHttpRequest('POST', '/resonance/api/sessions/abc/actions'), false);
  assert.equal(isAllowedHttpRequest('POST', '/resonance/api/sessions/abc/fight'), false);
  assert.equal(isAllowedHttpRequest('GET', '/resonance/api/sessions/abc'), true);
});

test('execution requires an explicit one-shot flag and acceptance gaps remain visible', () => {
  assert.deepEqual(parseArgs([]), { execute: false, sourceRoot: config().source });
  assert.deepEqual(parseArgs(['--validate']), { execute: false, sourceRoot: config().source });
  assert.deepEqual(parseArgs(['--execute']), { execute: true, sourceRoot: config().source });
  assert.equal(parseArgs(['--execute', '--source-root', config().canonicalInstallDir]).sourceRoot.replaceAll('\\', '/'), config().canonicalInstallDir.replaceAll('\\', '/'));
  assert.throws(() => parseArgs(['--execute', '--source-root', 'E:/WindowsWorkspace']), /canonical root or registered Resonance worktree/);
  assert.throws(() => parseArgs(['--resume-session', 'abc']), /no browser or server started/);
  assert.equal(missingChecks({}).length, REQUIRED_CHECKS.length);
  const passed = Object.fromEntries(REQUIRED_CHECKS.map((key) => [key, { status: 'passed' }]));
  assert.deepEqual(missingChecks(passed), []);
  assert.equal(screenshotCount(config().screenshots), 10);
  for (const check of ['equipment-holder-combine', 'inventory-combine', 'equipment-detail-unequip', 'equipment-detail-recycle', 'native-detail-deep-link', 'mobile-shop-panel-safe']) {
    assert.ok(REQUIRED_CHECKS.includes(check), `live acceptance must include ${check}`);
  }
  assert.ok(REQUIRED_CHECKS.includes('native-fullscreen-open-link'), 'live acceptance must verify the independent current-session full-screen link');
});

test('live acceptance rejects console/network errors and forbidden requests',()=>{
  assert.deepEqual(runtimeFaults({browserErrors:['console error'],badResponses:[{status:404}],forbiddenRequests:[{method:'POST',url:'http://x'}]}),
    {browserErrors:['console error'],badResponses:[{status:404}],forbiddenRequests:[{method:'POST',url:'http://x'}]});
  assert.deepEqual(runtimeFaults(),{browserErrors:[],badResponses:[],forbiddenRequests:[]});
});

test('full-screen popup wait resolves only from the source page popup event', async () => {
  let handler = null;
  const source = { once: (event, callback) => { assert.equal(event, 'popup'); handler = callback; } };
  const expectedPopup = { id: 'new-tab' };
  const pending = waitForPopup(source, 1000);
  handler(expectedPopup);
  assert.equal(await pending, expectedPopup);
});

test('CDP websocket capture records actual frames and operation waits honor their starting offset', async () => {
  const handlers = new Map(), calls = [];
  const cdp = { send: async (name) => calls.push(name), on: (name, fn) => handlers.set(name, fn) };
  const page = { createCDPSession: async () => cdp }, attempt = { ws: { sent: [], received: [] } }, actions = [];
  await attachWsCapture(page, attempt, (message) => actions.push(message.action?.type ?? null));
  handlers.get('Network.webSocketCreated')({ url: 'ws://127.0.0.1:19003/resonance/ws?session=test' });
  handlers.get('Network.webSocketFrameSent')({ response: { payloadData: JSON.stringify({ t: 'g.resonance', action: { type: 'unequip' } }) } });
  handlers.get('Network.webSocketFrameReceived')({ response: { payloadData: JSON.stringify({ t: 'm.private', phase: 'prep' }) } });
  handlers.get('Network.webSocketFrameReceived')({ response: { payloadData: JSON.stringify({ t: 'b.start', battleId: 'b28', kind: 'boss',
    spec: { kind: 'boss', stageId: 'stage-final', round: 14, spawns: Array.from({ length: 50 }, () => ({ id: 'not-captured' })) } }) } });
  const resultWire = JSON.stringify({ t: 'b.result', battleId: 'b28', result: {
    perPlayer: { one: { unitStats: [{ dmg: 100 }, { dmg: 25 }] }, two: { unitStats: [{ dmg: 5 }] } },
    resonance: { growth: [{ amount: 1 }], coins: [{ amount: 2 }, { amount: 3 }], forge: [],
      contributions: [{ charId: 'one' }, { charId: 'two' }, { charId: 'three' }], metrics: { damage: 130, blocked: 4 } },
  } });
  handlers.get('Network.webSocketFrameSent')({ response: { payloadData: resultWire } });
  assert.deepEqual(calls, ['Network.enable']);
  assert.deepEqual(attempt.ws.sent.map((row) => row.t), ['g.resonance', 'b.result']);
  assert.deepEqual(attempt.ws.received.map((row) => row.t), ['m.private', 'b.start']);
  assert.deepEqual({ kind: attempt.ws.received[1].kind, specKind: attempt.ws.received[1].specKind,
    specStageId: attempt.ws.received[1].specStageId, specRound: attempt.ws.received[1].specRound },
  { kind: 'boss', specKind: 'boss', specStageId: 'stage-final', specRound: 14 });
  assert.equal('spawns' in attempt.ws.received[1], false, 'capture stores only bounded battle identity fields, not the full spec');
  const resultRow = attempt.ws.sent[1];
  assert.deepEqual({ frameBytes: resultRow.resultFrameBytes, statsCount: resultRow.resultStatsCount,
    damageSum: resultRow.resultDamageSum, queues: resultRow.resultModeQueueCounts, metricsKeys: resultRow.resultMetricsKeyCount },
  { frameBytes: new TextEncoder().encode(resultWire).byteLength, statsCount: 3, damageSum: 130,
    queues: { growth: 1, coins: 2, forge: 0, contributions: 3 }, metricsKeys: 2 });
  assert.equal('result' in resultRow, false, 'capture must not retain a full battle result payload');
  assert.equal('spec' in resultRow, false, 'capture must not retain a battle spec');
  assert.equal('resultFrameBytes' in attempt.ws.received[1], false, 'result metadata applies only to sent b.result frames');
  assert.deepEqual(actions, ['unequip', null]);
  assert.match(attempt.ws.connections[0], /\/resonance\/ws/);
  const offset = attempt.ws.sent.length;
  assert.equal(await waitSent(attempt, 'g.resonance', 1, offset), null, 'a previous frame cannot satisfy a later action wait');
  attempt.ws.sent.push({ t: 'g.resonance', action: 'combine' });
  assert.equal((await waitSent(attempt, 'g.resonance', 10, offset)).action, 'combine');
});
