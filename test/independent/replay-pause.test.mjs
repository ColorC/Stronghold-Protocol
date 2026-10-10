import test from 'node:test';
import assert from 'node:assert/strict';
import { stepReplayClock } from '../../public/js/independent/model.js';
import { battleEndControl } from '../../public/js/independent/battleEndControl.js';

test('pausing holds replay time and refreshes wall-clock baseline so resume does not skip frames', () => {
  const paused = stepReplayClock(12.5, 1000, 6000, 8, true);
  assert.deepEqual(paused, { gameTime: 12.5, previousNow: 6000 });
  const resumed = stepReplayClock(paused.gameTime, paused.previousNow, 6016, 8, false);
  assert.ok(Math.abs(resumed.gameTime - 12.628) < 1e-9);
  assert.equal(resumed.previousNow, 6016);
});

test('replay end/close action remains reachable independently of pause state', () => {
  assert.deepEqual(battleEndControl(false), { label: '跳到结尾', action: 'seek', disabled: false });
  assert.deepEqual(battleEndControl(true), { label: '继续备战', action: 'close', disabled: false });
});
