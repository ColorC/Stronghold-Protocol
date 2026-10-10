import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('guardView forwards replay pause to the renderer API', () => {
  const source = readFileSync(fileURLToPath(new URL('../../public/js/ui/fieldHost.js', import.meta.url)), 'utf8');
  const implementation = source.match(/export function guardView\(view, kind\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(implementation, 'fieldHost exports guardView');
  const methods = source.match(/const METHODS = (\[[^\n]+\]);/)?.[1];
  const optional = source.match(/const OPTIONAL = (\[[^\n]+\]);/)?.[1];
  assert.ok(methods && optional, 'fieldHost declares its view API lists');
  const guardView = new Function(`const METHODS=${methods}; const OPTIONAL=${optional}; ${implementation.replace(/^export function guardView/, 'function guardView')}; return guardView;`)();
  const calls = [];
  const raw = { setReplayPaused(paused) { calls.push(paused); return true; } };
  const view = guardView(raw, 'engine');

  assert.equal(view.setReplayPaused(true), true);
  assert.equal(view.setReplayPaused(false), true);
  assert.deepEqual(calls, [true, false]);
});

function replayPauseCallback(view) {
  const source = readFileSync(fileURLToPath(new URL('../../public/js/independent/game.js', import.meta.url)), 'utf8');
  const body = source.match(/const toggleReplayPause = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[view\]\);/)?.[1];
  assert.ok(body, 'GameScreen declares its pause callback');
  const refs = { replayPausedRef: { current: false }, replayEndTimeRef: { current: 25 }, replayTimeRef: { current: 9 } };
  const values = { paused: [], remaining: [] };
  const toggle = new Function('view', 'replayPausedRef', 'replayEndTimeRef', 'replayTimeRef', 'setReplayRemaining', 'setReplayPaused', body).bind(null, view, refs.replayPausedRef, refs.replayEndTimeRef, refs.replayTimeRef, x => values.remaining.push(x), x => values.paused.push(x));
  return { toggle, refs, values };
}

test('pause input is safe while the field view is still mounting', () => {
  const { toggle, refs, values } = replayPauseCallback(null);
  assert.doesNotThrow(toggle);
  assert.equal(refs.replayPausedRef.current, true);
  assert.deepEqual(values.remaining, [16]);
  assert.deepEqual(values.paused, [true]);
  assert.doesNotThrow(toggle);
  assert.equal(refs.replayPausedRef.current, false);
  assert.deepEqual(values.paused, [true, false]);
});

test('pause input forwards pause and resume once the field is mounted', () => {
  const calls = [];
  const { toggle } = replayPauseCallback({ setReplayPaused(value) { calls.push(value); } });
  toggle(); toggle();
  assert.deepEqual(calls, [true, false]);
});
