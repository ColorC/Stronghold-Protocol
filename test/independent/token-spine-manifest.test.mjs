import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spineEntry } from '../../public/js/assets.js';
import { parseSkel } from '../../tools/assets/skel.mjs';
import { atlasInfo } from '../../tools/assets/atlas.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'data/assets.json'), 'utf8'));
const tokens = JSON.parse(await fs.readFile(path.join(root, 'data/tokens.json'), 'utf8'));
const added = ['token_10004_otter_motter', 'token_10013_robin_mine', 'token_10018_robrta_mach',
  'token_10020_ling_soul1', 'token_10020_ling_soul2', 'token_10020_ling_soul3',
  'token_10025_doroth_recttp', 'token_10027_ironmn_pile1', 'token_10027_ironmn_pile2',
  'token_10027_ironmn_pile3', 'token_10032_jesca2_jckshd', 'token_10041_cathy_catsld',
  'token_10057_svash2_eagle1', 'token_10057_svash2_eagle2', 'token_10057_svash2_eagle3'];

for (const id of added) {
  test(`${tokens[id].name}: native token resolves its own model and declared animation roles`, async () => {
    const sp = spineEntry(manifest, tokens[id].assets.spine);
    assert.ok(sp, 'the token unit asset id resolves a model');
    assert.equal(sp, manifest.tokens[id].spine);
    assert.ok(sp.skel.includes(id.replace(/eagle[123]$/, 'eagle')), 'model belongs to the token family');
    assert.ok(sp.animations[sp.anims.idle] !== undefined, 'idle role is present in the skeleton');
    for (const role of [sp.anims.deploy, sp.anims.die, sp.anims.attack?.loop, sp.anims.skill?.loop]) {
      if (role) assert.ok(sp.animations[role] !== undefined, `declared clip ${role} exists`);
    }
    if (process.env.SP_TOKEN_ASSET_ROOT) {
      const local = url => path.join(process.env.SP_TOKEN_ASSET_ROOT, url.replace(/^\/assets\//, ''));
      const atlas = atlasInfo(await fs.readFile(local(sp.atlas), 'utf8'));
      const parsed = parseSkel(await fs.readFile(local(sp.skel)), atlas.regions);
      assert.deepEqual(parsed.missingRegions, [], 'native attachment names agree with native texture atlas');
      assert.deepEqual(parsed.durations, sp.animations, 'manifest describes the actual native skeleton');
      for (const texture of sp.textures) assert.ok((await fs.stat(local(texture))).isFile());
    }
  });
}

test('Katherine puppet keeps native identity and source statistics', () => {
  const id = 'token_10041_cathy_catsld';
  assert.equal(tokens[id].name, '爬行号·防护单元');
  assert.equal(tokens[id].assets.spine, id);
  assert.equal(manifest.tokens[id].owner, 'char_4162_cathy');
  assert.equal(manifest.tokens[id].spine.anims.idle, 'Idle');
  assert.equal(manifest.tokens[id].spine.anims.deploy, 'Start');
});

test('manifest token counts describe the registered resources', () => {
  assert.equal(manifest.stats.tokensWithSpine, Object.values(manifest.tokens).filter(t => t.spine).length);
  assert.equal(manifest.stats.tokensWithSpine, 28);
});
