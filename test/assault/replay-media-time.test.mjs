import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clampReplayMediaTime } from '../../public/js/assault/replayMediaTime.js';

test('replay media seeks keep in-range times and clamp exact or overshot ends to a decodable final frame', () => {
  assert.equal(clampReplayMediaTime(12.5, 20), 12.5);
  assert.equal(clampReplayMediaTime(20, 20), 19.95);
  assert.equal(clampReplayMediaTime(20.009, 20), 19.95);
  assert.equal(clampReplayMediaTime(20, 0.03), 0);
});

test('replay media time stays nonnegative and leaves unknown-duration requests available for metadata load', () => {
  assert.equal(clampReplayMediaTime(-0.01, 20), 0);
  assert.equal(clampReplayMediaTime(2, 0), 2);
  assert.equal(clampReplayMediaTime(2, Number.POSITIVE_INFINITY), 2);
});

test('replay page uses the existing game icon as a relative favicon at root and subpath entries', async () => {
  const html = await readFile(new URL('../../public/assault-replay.html', import.meta.url), 'utf8');
  const href = html.match(/<link\s+rel="icon"[^>]*href="([^"]+)"/i)?.[1];
  assert.equal(href, './icons/app.svg');
  assert.equal(new URL(href, 'https://example.test/assault-replay.html').pathname, '/icons/app.svg');
  assert.equal(new URL(href, 'https://example.test/stronghold/assault/assault-replay.html').pathname, '/stronghold/assault/icons/app.svg');
});
