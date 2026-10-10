import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clampReplayMediaTime } from '../../public/js/independent/replayMediaTime.js';

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

test('both replay seek and playback sync prefer the active video duration over stale prior-segment duration', async () => {
  const replay = await readFile(new URL('../../public/js/independent/replay.js', import.meta.url), 'utf8');
  assert.match(replay, /function mediaDurationForClamp\(\)\s*\{\s*const currentDuration = Number\(mediaVideo\?\.duration\);\s*return Number\.isFinite\(currentDuration\) && currentDuration > 0 \? currentDuration : mediaDuration;\s*\}/);
  assert.equal((replay.match(/clampReplayMediaTime\([^\n]+mediaDurationForClamp\(\)\)/g) || []).length, 2,
    'seek and sync must both use the currently loaded video duration');
  assert.equal(clampReplayMediaTime(32.603, 1194.147), 32.603,
    'the original segment time must remain in range when the previous rendered clip lasted 13.8 seconds');
});

test('replay page uses the existing game PNG as a relative favicon at root and subpath entries', async () => {
  const html = await readFile(new URL('../../public/independent-replay.html', import.meta.url), 'utf8');
  const href = html.match(/<link\s+rel="icon"[^>]*href="([^"]+)"/i)?.[1];
  assert.equal(href, './assets/ui/hudPanel/icon_battle.png');
  assert.equal(new URL(href, 'https://example.test/independent-replay.html').pathname, '/assets/ui/hudPanel/icon_battle.png');
  assert.equal(new URL(href, 'https://example.test/stronghold/independent-replay.html').pathname, '/stronghold/assets/ui/hudPanel/icon_battle.png');
});
