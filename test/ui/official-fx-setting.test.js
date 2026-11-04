// 设置「官方特效」 (render/vfx): the stored setting (settings `officialFx`, 关 / 精简 / 完整, default 'auto') and the
// dialog row — shown only when effects were extracted from the local client (render/vfx/available.js) and never fed by
// a plugin/cosmetics pack (the fork has none).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSettings, DEFAULT_SETTINGS, OFFICIAL_FX_MODES } from '../../public/js/ui/gameLogic/settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dialog = readFileSync(path.join(ROOT, 'public/js/ui/settings.js'), 'utf8');

test('officialFx: the four modes survive sanitising, anything else falls back to auto', () => {
  assert.equal(DEFAULT_SETTINGS.officialFx, 'auto');
  assert.deepEqual([...OFFICIAL_FX_MODES], ['auto', 'off', 'lite', 'full']);
  assert.equal(sanitizeSettings({ officialFx: 'lite' }).officialFx, 'lite');
  for (const value of ['off', 'full', 'auto']) assert.equal(sanitizeSettings({ officialFx: value }).officialFx, value);
  for (const junk of [undefined, null, 'bogus', 'LITE', 1, true, {}, []]) {
    assert.equal(sanitizeSettings({ officialFx: junk }).officialFx, 'auto', `${JSON.stringify(junk)} → auto`);
  }
  // the rest of the profile is untouched by the new key
  const s = sanitizeSettings({ officialFx: 'lite', quality: 'low' });
  assert.equal(s.quality, 'low');
  assert.equal(s.officialFx, 'lite');
});

test('设置 dialog: the 官方特效 row follows the extracted effects list, not cosmetics', () => {
  assert.match(dialog, /data-testid="official-fx"/);
  assert.match(dialog, /fxAvailable\(null\)/);
  assert.match(dialog, /resolveOfficialFx\(s\.officialFx, true\)/);
  assert.doesNotMatch(dialog, /cosmetics/);
});
