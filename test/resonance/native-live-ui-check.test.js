import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { artifactPaths, attachWsCapture, colorContrastRatio, config, isAllowedHttpRequest, isRunnerResultWarning, missingChecks, parseArgs, REQUIRED_CHECKS, runtimeFaults, screenshotCount, waitForPopup, waitSent } from '../../tools/resonance/native-live-ui-check.mjs';

const tool = fileURLToPath(new URL('../../tools/resonance/native-live-ui-check.mjs', import.meta.url));

test('prepare mode validates paths without launching a browser or service', () => {
  const result = spawnSync(process.execPath, [tool, '--validate-args'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.browserStarted, false);
  assert.equal(payload.port, 19003);
  assert.equal(payload.deadlineMs, 8 * 60_000);
  assert.match(payload.sessionDirectory.replaceAll('\\', '/'), /runtime\/resonance\/ui-verification\/native-live-test-sessions$/);
  assert.equal(payload.serverMount.publicDir.replaceAll('\\', '/'), `${config().source.replaceAll('\\', '/')}/public`);
  assert.equal(payload.serverMount.installDirReadOnlyFallback, payload.canonicalInstallDir);
  assert.equal(Object.keys(payload.screenshots).length, 10);
  assert.equal(Object.keys(payload.supplementalScreenshots).length, 5);
  const tagged = spawnSync(process.execPath, [tool, '--validate-args', '--receipt-tag', 'ui-alignment'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(tagged.status, 0, tagged.stderr);
  const taggedPayload=JSON.parse(tagged.stdout);
  assert.match(taggedPayload.receipt.replaceAll('\\','/'),/native-live-ui-receipt-ui-alignment\.json$/);
  assert.ok(Object.values(taggedPayload.screenshots).every(file=>file.includes('native-live-ui-alignment-')));
  assert.equal(artifactPaths().receipt,config().receipt);
  assert.notEqual(artifactPaths('ui-alignment').receipt,artifactPaths().receipt,'alignment proof must not overwrite the previous receipt');
  assert.ok(Object.values(artifactPaths('ui-alignment').screenshots).every((file,index)=>!Object.values(artifactPaths().screenshots).includes(file)),
    'alignment screenshots must have paths distinct from previous proof');
  const canonical = spawnSync(process.execPath, [tool, '--validate-args', '--source-root', config().canonicalInstallDir], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(canonical.status, 0, canonical.stderr);
  const canonicalPayload = JSON.parse(canonical.stdout);
  assert.equal(canonicalPayload.serverMount.publicDir.replaceAll('\\', '/'), `${config().canonicalInstallDir.replaceAll('\\', '/')}/public`);
  assert.equal(canonicalPayload.browserStarted, false);
});

test('only creating an isolated session may use POST; REST gameplay mutations stay closed', () => {
  assert.equal(isAllowedHttpRequest('POST', '/resonance/api/sessions'), true);
  assert.equal(isAllowedHttpRequest('POST', '/resonance/api/admission'), true, 'native entry may obtain its bounded admission lease');
  assert.equal(isAllowedHttpRequest('POST', '/resonance/api/sessions/abc/actions'), false);
  assert.equal(isAllowedHttpRequest('POST', '/resonance/api/sessions/abc/fight'), false);
  assert.equal(isAllowedHttpRequest('GET', '/resonance/api/sessions/abc'), true);
});

test('execution requires an explicit one-shot flag and acceptance gaps remain visible', () => {
  assert.deepEqual(parseArgs([]), { execute: false, sourceRoot: config().source, receiptTag: '' });
  assert.deepEqual(parseArgs(['--validate']), { execute: false, sourceRoot: config().source, receiptTag: '' });
  assert.deepEqual(parseArgs(['--execute']), { execute: true, sourceRoot: config().source, receiptTag: '' });
  assert.equal(parseArgs(['--receipt-tag','ui-alignment']).receiptTag,'ui-alignment');
  assert.throws(()=>parseArgs(['--receipt-tag','UI Alignment']),/short lowercase tag/);
  assert.equal(parseArgs(['--execute', '--source-root', config().canonicalInstallDir]).sourceRoot.replaceAll('\\', '/'), config().canonicalInstallDir.replaceAll('\\', '/'));
  assert.throws(() => parseArgs(['--execute', '--source-root', 'E:/WindowsWorkspace']), /canonical root or registered Resonance worktree/);
  assert.throws(() => parseArgs(['--resume-session', 'abc']), /no browser or server started/);
  assert.equal(missingChecks({}).length, REQUIRED_CHECKS.length);
  const passed = Object.fromEntries(REQUIRED_CHECKS.map((key) => [key, { status: 'passed' }]));
  assert.deepEqual(missingChecks(passed), []);
  assert.equal(screenshotCount(config().screenshots), 10);
  assert.equal(screenshotCount({...config().screenshots,...config().supplementalScreenshots}),15);
  for (const check of ['equipment-holder-combine', 'inventory-combine', 'equipment-detail-unequip', 'equipment-detail-recycle', 'native-detail-deep-link', 'mobile-shop-panel-safe']) {
    assert.ok(REQUIRED_CHECKS.includes(check), `live acceptance must include ${check}`);
  }
  assert.ok(REQUIRED_CHECKS.includes('native-fullscreen-open-link'), 'live acceptance must verify the independent current-session full-screen link');
  assert.ok(REQUIRED_CHECKS.includes('native-codex-content-and-detail-visible'), 'live acceptance must verify Codex card/detail geometry and controls');
  for (const check of ['native-entrypoints-unique', 'native-codex-session-and-shortcuts', 'native-panels-open-close', 'native-icons-and-type-readable', 'native-recipe-contrast', 'native-pact-rewards-disclosure', 'native-remaining-controls-live', 'native-visible-text-audit-14px', 'combat-speed-1-2-4-same-battle']) {
    assert.ok(REQUIRED_CHECKS.includes(check), `live acceptance must verify ${check}`);
  }
});

test('contrast helper computes WCAG ratios and composites transparent colors over the supplied surface', () => {
  assert.equal(colorContrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)'), 21);
  assert.ok(colorContrastRatio('rgb(118, 118, 118)', 'rgb(255, 255, 255)') >= 4.5);
  assert.ok(colorContrastRatio('rgb(150, 150, 150)', 'rgb(255, 255, 255)') < 4.5);
  assert.ok(colorContrastRatio('rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)') > 3);
  assert.equal(colorContrastRatio('transparent', 'rgb(255, 255, 255)'), 0);
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

test('CDP websocket capture records bounded parse failures, b.end reasons and actual frames', async () => {
  const handlers = new Map(), calls = [];
  const cdp = { send: async (name) => calls.push(name), on: (name, fn) => handlers.set(name, fn) };
  const page = { createCDPSession: async () => cdp }, attempt = { ws: { sent: [], received: [] } }, actions = [];
  await attachWsCapture(page, attempt, (message) => actions.push(message.action?.type ?? null));
  handlers.get('Network.webSocketCreated')({ url: 'ws://127.0.0.1:19003/resonance/ws?session=test' });
  handlers.get('Network.webSocketFrameSent')({ response: { payloadData: JSON.stringify({ t: 'g.resonance', action: { type: 'unequip' } }) } });
  handlers.get('Network.webSocketFrameReceived')({ response: { payloadData: JSON.stringify({ t: 'm.private', phase: 'prep' }) } });
  handlers.get('Network.webSocketFrameReceived')({ response: { payloadData: JSON.stringify({ t: 'b.start', battleId: 'b28', kind: 'boss',
    spec: { kind: 'boss', stageId: 'stage-final', round: 14, spawns: Array.from({ length: 50 }, () => ({ id: 'not-captured' })) } }) } });
  const nativeResultWire = JSON.stringify({ t: 'm.result', victory: false, roundsPassed: 29, lastRound: 30,
    players: [{ playerId: 'other', stats: { dmgDealt: 900 } }, { playerId: 'resonance', roundsPassed: 29,
      stats: { dmgDealt: 130, kills: 4, gold: 7, privateData: 'omit' } }] });
  handlers.get('Network.webSocketFrameReceived')({ response: { payloadData: nativeResultWire } });
  handlers.get('Network.webSocketFrameReceived')({ response: { payloadData: JSON.stringify({t:'b.end',battleId:'b28',reason:'cleared'}) } });
  handlers.get('Network.webSocketFrameReceived')({ response: { payloadData: '{bad]' } });
  const resultWire = JSON.stringify({ t: 'b.result', battleId: 'b28', result: {
    perPlayer: { one: { unitStats: [{ dmg: 100 }, { dmg: 25 }] }, two: { unitStats: [{ dmg: 5 }] } },
    resonance: { growth: [{ amount: 1 }], coins: [{ amount: 2 }, { amount: 3 }], forge: [],
      contributions: [{ charId: 'one' }, { charId: 'two' }, { charId: 'three' }], metrics: { damage: 130, blocked: 4 } },
  } });
  handlers.get('Network.webSocketFrameSent')({ response: { payloadData: resultWire } });
  assert.deepEqual(calls, ['Network.enable']);
  assert.deepEqual(attempt.ws.sent.map((row) => row.t), ['g.resonance', 'b.result']);
  assert.deepEqual(attempt.ws.received.map((row) => row.t), ['m.private', 'b.start', 'm.result', 'b.end']);
  assert.deepEqual({ kind: attempt.ws.received[1].kind, specKind: attempt.ws.received[1].specKind,
    specStageId: attempt.ws.received[1].specStageId, specRound: attempt.ws.received[1].specRound },
  { kind: 'boss', specKind: 'boss', specStageId: 'stage-final', specRound: 14 });
  assert.equal('spawns' in attempt.ws.received[1], false, 'capture stores only bounded battle identity fields, not the full spec');
  assert.deepEqual(attempt.ws.received[2].resultSummary,
    { victory: false, roundsPassed: 29, lastRound: 30, stats: { dmgDealt: 130, kills: 4, spent: 7 } });
  assert.equal('players' in attempt.ws.received[2], false, 'capture must not retain full player result data');
  const resultRow = attempt.ws.sent[1];
  assert.deepEqual({ frameBytes: resultRow.resultFrameBytes, statsCount: resultRow.resultStatsCount,
    damageSum: resultRow.resultDamageSum, queues: resultRow.resultModeQueueCounts, metricsKeys: resultRow.resultMetricsKeyCount },
  { frameBytes: new TextEncoder().encode(resultWire).byteLength, statsCount: 3, damageSum: 130,
    queues: { growth: 1, coins: 2, forge: 0, contributions: 3 }, metricsKeys: 2 });
  assert.equal('result' in resultRow, false, 'capture must not retain a full battle result payload');
  assert.equal('spec' in resultRow, false, 'capture must not retain a battle spec');
  assert.equal('resultFrameBytes' in attempt.ws.received[1], false, 'result metadata applies only to sent b.result frames');
  assert.equal(attempt.ws.received[3].endReason,'cleared');
  assert.equal(attempt.ws.parseErrorCount,1);
  assert.equal(attempt.ws.parseErrorPayloadBytes,5);
  assert.deepEqual(attempt.ws.parseErrors,[{direction:'received',payloadBytes:5,errorName:'SyntaxError'}]);
  assert.equal('payload' in attempt.ws.parseErrors[0],false,'parse diagnostic must not retain raw wire payload');
  assert.deepEqual(actions, ['unequip', null]);
  assert.match(attempt.ws.connections[0], /\/resonance\/ws/);
  const offset = attempt.ws.sent.length;
  assert.equal(await waitSent(attempt, 'g.resonance', 1, offset), null, 'a previous frame cannot satisfy a later action wait');
  attempt.ws.sent.push({ t: 'g.resonance', action: 'combine' });
  assert.equal((await waitSent(attempt, 'g.resonance', 10, offset)).action, 'combine');
});

test('runner result warnings are narrowly recognized for diagnostics',()=>{
  assert.equal(isRunnerResultWarning('[runner] result failed: invalid'),true);
  assert.equal(isRunnerResultWarning('[runner] b.result refused by client'),true);
  assert.equal(isRunnerResultWarning('[runner] b.result not delivered'),true);
  assert.equal(isRunnerResultWarning('[runner] simulation started'),false);
  assert.equal(isRunnerResultWarning('ordinary console warning'),false);
});

test('native result projection captures only the resonance player result metrics', async () => {
  const { projectNativeResultSummary } = await import('../../tools/resonance/native-live-ui-check.mjs');
  const summary = projectNativeResultSummary({ t: 'm.result', victory: false, roundsPassed: 29, lastRound: 30, players: [
    { playerId: 'other', roundsPassed: 30, stats: { dmgDealt: 999, kills: 99, gold: 88 } },
    { playerId: 'resonance', roundsPassed: 29, stats: { dmgDealt: 1348, kills: 27, gold: 14, secret: 'omit' } },
  ] });
  assert.deepEqual(summary, { victory: false, roundsPassed: 29, lastRound: 30, stats: { dmgDealt: 1348, kills: 27, spent: 14 } });
  assert.equal(JSON.stringify(summary).includes('secret'), false);
  assert.equal(projectNativeResultSummary({ t: 'm.result', players: [] }), null);
});
