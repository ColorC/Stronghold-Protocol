import test from 'node:test';
import assert from 'node:assert/strict';
import { battleEndControl } from '../../public/js/independent/battleEndControl.js';

test('battle end control stays available and changes from seek to continue', () => {
  assert.deepEqual(battleEndControl(false), { label: '跳到结尾', action: 'seek', disabled: false });
  assert.deepEqual(battleEndControl(true), { label: '继续备战', action: 'close', disabled: false });
  assert.deepEqual(battleEndControl(true, true), { label: '查看结算', action: 'close', disabled: false });
});
