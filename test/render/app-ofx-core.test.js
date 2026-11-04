// T07: the official battle effects' skeleton in render/app.js (render/vfx). Event dispatch is not wired yet (T09), so
// this only pins the construction, layers, tier sync, clearing, battle preload, frame stepping, settings, teardown,
// stats and the impostor clip stepping — plus the fork's own identifiers, which the merge must not have dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const app = readFileSync(join(ROOT, 'public/js/render/app.js'), 'utf8');
const count = (needle) => app.split(needle).length - 1;

test('the official effects are constructed and wired into the view', () => {
  for (const needle of [
    'new OfficialFx(',
    'new FxWiring(',
    'function syncOfficialFx',
    'ofx.init()',
    'wiring.more(',
    'wiring.begin(',
    'ofx.frameStats()',
    'wiring.sync(views.values())',
    'wiring.tick()',
    'ofx.update(gdt)',
    'stepClipBounds()',
    'officialFx: ofx.stats()',
    'vfxGround',
    'vfxOver',
    'canUploadSameBuffer = false',
  ]) {
    assert.ok(app.includes(needle), needle);
  }
});

test('the plugin player, the studio clock and the plugin reload stay out', () => {
  for (const needle of ['pluginFx', 'PluginFxPlayer', 'advanceEffectClock', 'playbackTime', 'reloadPlugins', './app/playback.js', 'pluginPlayer']) {
    assert.equal(count(needle), 0, needle);
  }
});

test('syncOfficialFx is defined once and called from the four places that change the tier', () => {
  // the definition, the init callback, the 3D board on / off, and setSettings
  assert.equal(count('syncOfficialFx('), 5);
});

test('the fork\'s own effect and view identifiers survive the merge', () => {
  // counts before this change (HEAD of the assault-visual branch) — the merge only adds
  const before = {
    fxCues: 10, originalVfx: 1, cyclePick: 3, noPictureIds: 3,
    framePainted: 1, pieceAtClient: 2, setTierChipLook: 2, unitFxIdentity: 2,
  };
  for (const [needle, n] of Object.entries(before)) assert.ok(count(needle) >= n, `${needle}: ${count(needle)} < ${n}`);
});

test('the official layer is cleared with the fork cues and the battle clock restarts', () => {
  // enterPrepMode and enterBattle
  assert.equal(count('ofx.clear(); wiring.clear(); ofxPrevT = null;'), 2);
  assert.equal(count('ofxPrevT = renderT;'), 1);
});

test('the setting is a string that only resyncs when it changes', () => {
  assert.match(app, /officialFx: 'auto',/);
  assert.match(app, /typeof s\.officialFx === 'string' && s\.officialFx !== settings\.officialFx/);
  assert.match(app, /ofx\.setTier\(board3d \? resolveOfficialFx\(settings\.officialFx, ofx\.available\) : 'off'\)/);
});

test('teardown destroys the official player', () => {
  assert.match(app, /try \{ ofx\.destroy\(\); \} catch \{ \/\* ignore \*\/ \}/);
});
