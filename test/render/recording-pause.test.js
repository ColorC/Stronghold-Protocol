import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('paused field keeps the last complete recording frame until it renders again', () => {
  const source = readFileSync(new URL('../../public/js/render/app.js', import.meta.url), 'utf8');
  const body = source.match(/const postRender = \(\) => \{([\s\S]*?)\n  \};\n  app.ticker.add\(preRender/)?.[1];
  assert.ok(body, 'renderer declares the post-render callback');
  const run = new Function('mode', 'replayPresentationPaused', 'emit', 'let renderT0 = 0, renderMs = 0;' + body);
  const events = [];
  const emit = event => events.push(event);
  run('prep', false, emit);
  run('battle', false, emit);
  const beforePause = events.length;
  run('battle', true, emit); run('battle', true, emit);
  assert.equal(events.length, beforePause, 'an unpainted paused board must not overwrite the capture cache');
  run('battle', false, emit);
  assert.equal(events.length, beforePause + 1, 'the next rendered frame refreshes the cache');
  assert.ok(events.every(event => event === 'framePainted'));
});
