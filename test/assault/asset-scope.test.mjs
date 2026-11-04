import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertKnownAssetScope, assertNativeLocalOnlyScope, mergeIncrementalManifest, parseAssetScope } from '../../tools/assault/asset-scope.mjs';

test('asset scope accepts explicit native IDs and rejects malformed or unknown IDs', () => {
  const ids = parseAssetScope(['--plan', '--ids=char_393_toledo,token_10067_toledo_tldptm']);
  assert.deepEqual([...ids].sort(), ['char_393_toledo', 'token_10067_toledo_tldptm']);
  assert.throws(() => parseAssetScope(['--ids=']), /non-empty/);
  assert.throws(() => parseAssetScope(['--ids=char_393_toledo', '--ids=char_4231_clemnt']), /usage/);
  assert.throws(() => assertKnownAssetScope(ids, new Set(['char_393_toledo'])), /unknown --ids entry: token_10067_toledo_tldptm/);
});

test('native Toledo mode is an explicit accepted flag while unrelated flags stay rejected', () => {
  const ids = parseAssetScope(['--acquire', '--native-local-only', '--ids=token_10067_toledo_tldptm']);
  assert.deepEqual([...ids], ['token_10067_toledo_tldptm']);
  assertNativeLocalOnlyScope(ids, 'token_10067_toledo_tldptm');
  assert.throws(() => assertNativeLocalOnlyScope(parseAssetScope(['--ids=token_10066_closur_ourbase']), 'token_10067_toledo_tldptm'), /exactly/);
  assert.throws(() => assertNativeLocalOnlyScope(parseAssetScope(['--ids=token_10067_toledo_tldptm,token_10066_closur_ourbase']), 'token_10067_toledo_tldptm'), /exactly/);
  assert.throws(() => parseAssetScope(['--native-local-only', '--ids=token_10066_closur_ourbase', '--mystery']), /usage/);
});

test('native Toledo plan rejects before rewriting the current asset manifest', () => {
  const manifest = new URL('../../data/assault-assets.json', import.meta.url);
  const before = readFileSync(manifest);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../tools/assault/assets-acquire.mjs', import.meta.url)), '--plan', '--native-local-only', '--ids=token_10067_toledo_tldptm'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--plan remains read-only/);
  assert.ok(readFileSync(manifest).equals(before), 'plan must leave the complete current manifest unchanged');
});

test('incremental manifest merge retains every existing asset and overlays only supplied mappings', () => {
  const old = { assets: { units: { char_old: { avatar: { url: '/assets/old.png' } } }, skills: { oldSkill: { url: '/assets/old-skill.png' } }, modules: { older: '/assets/local/module/old.png' } }, missing: { units: ['old:missing'] } };
  const add = { assets: { units: { char_393_toledo: { avatar: { url: '/assault-assets/new.png' } } }, skills: { skchr_toledo_2: { url: '/assault-assets/skill.png' } }, modules: { uniequip_002_toledo: '/assets/local/module/original.png' } }, missing: { units: [] } };
  const merged = mergeIncrementalManifest(old, add, new Set(['char_393_toledo']));
  assert.deepEqual(merged.assets.units, { char_old: old.assets.units.char_old, char_393_toledo: add.assets.units.char_393_toledo });
  assert.deepEqual(merged.assets.skills, { oldSkill: old.assets.skills.oldSkill, skchr_toledo_2: add.assets.skills.skchr_toledo_2 });
  assert.deepEqual(merged.assets.modules, { older: old.assets.modules.older, uniequip_002_toledo: add.assets.modules.uniequip_002_toledo });
  assert.deepEqual(merged.missing.units, []);
  assert.deepEqual(mergeIncrementalManifest(old, add, null), add);
});
