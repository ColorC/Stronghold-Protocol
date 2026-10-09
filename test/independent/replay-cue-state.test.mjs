import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReplayCueState } from '../../public/js/independent/replayCueState.js';

const reference = { key: 'reference', at: 1, text: '回看原卡', rect: { x: 18, y: 295, width: 300, height: 80 }, viewport: { width: 1280, height: 720 } };
const native = { key: 'native', at: 2.1, text: '说明原生技能', rect: { x: 550, y: 179, width: 160, height: 90 }, viewport: { width: 1280, height: 720 } };

test('overlapping cues select the latest cue and bind narration text and focus geometry to it', () => {
  const state = createReplayCueState([reference, native]);
  const explained = new Set();
  const cue = state.narration(2.5, explained);
  assert.strictEqual(cue, native);
  state.activate(cue);
  const displayed = state.current(2.5);
  assert.strictEqual(displayed, native);
  assert.equal(displayed.text, '说明原生技能');
  assert.strictEqual(displayed.rect, native.rect);
  assert.strictEqual(state.current(3.2), native, 'the paused narration keeps its selected cue');
});

test('the latest valid cue is used outside narration, while clear removes the paused cue', () => {
  const state = createReplayCueState([reference, native]);
  assert.strictEqual(state.current(2.5), native);
  state.activate(native);
  state.clear();
  assert.strictEqual(state.current(1.5), reference);
  assert.equal(state.current(8), null);
});

test('replay paint uses one cue object and reset paths clear paused cue state', async () => {
  const source = await readFile(new URL('../../public/js/independent/replay.js', import.meta.url), 'utf8');
  assert.match(source, /const cue = cueState\.current\(second\);/);
  assert.match(source, /cueState\.activate\(cue\);narrating=true;pause\(\);/);
  assert.match(source, /function resetZoom\(\)\{[^}]*cueState\.clear\(\)/);
  assert.match(source, /narrationTimer=setTimeout\(\(\)=>\{resetZoom\(\);play\(\);\}/);
  assert.match(source, /if\(narrating\)\{resetZoom\(\);play\(\);\}/);
  assert.match(source, /narrating=false;resetZoom\(\);/);
  assert.match(source, /\$\('reset'\)\.addEventListener\('click', \(\) => \{resetZoom\(\)/);
});
