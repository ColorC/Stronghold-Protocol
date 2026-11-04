import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScenarioHelpers } from '../../tools/resonance/capacity.mjs';

test('capacity runner loads and validates its terminal-fixture module dynamically', async () => {
  const previous = process.env.SP_DATA_DIR;
  process.env.SP_DATA_DIR = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data';
  try {
    const helpers = await loadScenarioHelpers();
    assert.equal(typeof helpers.buildScenario, 'function');
    assert.equal(typeof helpers.makePactTerminalRoster, 'function');
    assert.ok(Array.isArray(helpers.SCENARIO_CONFIGS));
    assert.ok(helpers.SCENARIO_CONFIGS.length > 0);
  } finally {
    if (previous === undefined) delete process.env.SP_DATA_DIR;
    else process.env.SP_DATA_DIR = previous;
  }
});
