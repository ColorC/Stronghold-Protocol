import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { createRun, viewRun } from '../../shared/assault/run.js';

const plannerPath = fileURLToPath(new URL('../../tools/assault/campaign-probe.mjs', import.meta.url));

test('browser planner NDJSON protocol starts once, reports invalid input, and recommends only from a public view', () => {
  const ctx = createAssaultContext();
  const director = ctx.design.system.directors[0];
  const state = createRun({ runId: 'browser-planner-protocol-fixture', seed: 123456, directorId: director.id }, ctx);
  const view = { runId: state.runId, state: viewRun(state, ctx) };
  const input = [
    'not-json',
    JSON.stringify({ requestId: 'bad-view', view: { runId: 'bad-view', state: {} } }),
    JSON.stringify({ requestId: 'first-view', view }),
    JSON.stringify({ requestId: 'same-view-different-secret', view: { ...view, state: { ...view.state, rngState: 0xdeadbeef, seed: 7 } } }),
  ].join('\n') + '\n';
  const result = spawnSync(process.execPath, [plannerPath, '--browser-planner'], { input, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  const messages = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(messages[0].type, 'ready');
  assert.equal(messages[0].protocol, 'assault-browser-planner/v1');
  assert.match(messages[0].sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(messages[1].code, 'INVALID_JSON');
  assert.equal(messages[2].code, 'INVALID_VIEW');
  assert.equal(messages[3].type, 'recommendation');
  assert.equal(messages[3].requestId, 'first-view');
  assert.equal(messages[3].kind, 'click-node');
  const { requestId: _a, ...first } = messages[3];
  const { requestId: _b, ...second } = messages[4];
  assert.deepEqual(second, first);
  assert.doesNotMatch(JSON.stringify(messages.slice(1)), /rngState|futureHiddenOutcome|opJournal/i);
});

test('browser planner fixtures keep hidden RNG out and return replayable legal battle placements', () => {
  const result = spawnSync(process.execPath, [plannerPath, '--browser-planner-fixture-only'], { encoding: 'utf8', timeout: 90000 });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout.trim());
  assert.deepEqual(receipt.fixture, {
    hiddenRngInvariant: true,
    invalidViewVisible: true,
    plannerDoesNotExposeRng: true,
    battlePrepPreviewCount: receipt.fixture.battlePrepPreviewCount,
    browserOperations: receipt.fixture.browserOperations,
    legalFinalPlacements: receipt.fixture.legalFinalPlacements,
    doesNotCreateOrSettleRun: true,
  });
  assert.ok(receipt.fixture.battlePrepPreviewCount > 0);
  assert.ok(receipt.fixture.legalFinalPlacements > 0);
});
