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
