import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assaultAssets } from '../../public/js/assault/model.js';
import { enrichSpineAnimationMetadata, parseMetadataOnlyArgs, repairManifestSpineMetadata, resolveSpineAnimationMetadata } from '../../tools/assault/assets-acquire.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const canonicalRoot = process.env.SP_ASSAULT_CANONICAL_ROOT ||
  (path.basename(path.dirname(path.dirname(repoRoot))) === '.worktrees' && path.basename(path.dirname(repoRoot)) === 'assault'
    ? path.resolve(repoRoot, '../../..') : repoRoot);

test('Assault adapter keeps actual native animation metadata when its own model record has only resource paths', () => {
  const role = { begin: null, loop: 'Attack', end: null };
  const nativeEntry = {
    skel: '/assets/native/operator.skel', atlas: '/assets/native/operator.atlas', textures: ['/assets/native/operator.png'], pma: true,
    anims: { idle: 'Idle', attack: role, skill: { ...role, index: 0, idle: null } },
    animations: { Attack: 1.2, Idle: 2 }, events: ['OnAttack'], hits: { Attack: [0.6] }, bounds: { x: 1, y: 2, width: 3, height: 4 },
  };
  const raw = { assets: { units: { char_fixture: { avatar: { url: '/assault-assets/avatar.png' },
    model: { front: { skel: { url: '/assault-assets/operator.skel' }, atlas: { url: '/assault-assets/operator.atlas' }, texture: { url: '/assault-assets/operator.png' }, anims: {} } } } } } };
  const result = assaultAssets(raw, { chars: { char_fixture: { spine: { front: nativeEntry } } } }).chars.char_fixture.spine.front;
  assert.equal(result.skel, '/assault-assets/operator.skel', 'Assault resource URL stays preferred');
  assert.equal(result.pma, true);
  assert.deepEqual(result.anims, nativeEntry.anims);
  assert.deepEqual(result.animations, nativeEntry.animations);
  assert.deepEqual(result.events, nativeEntry.events);
  assert.deepEqual(result.hits, nativeEntry.hits);
  assert.deepEqual(result.bounds, nativeEntry.bounds);
});

test('an empty role object is not synthesized when neither manifest contains parsed roles', () => {
  const result = assaultAssets({ assets: { units: { char_fixture: {
    model: { front: { skel: { url: '/assault-assets/a.skel' }, anims: {} } },
  } } } }).chars.char_fixture.spine.front;
  assert.equal(Object.hasOwn(result, 'anims'), false);
});

test('normal producer parses the existing canonical Skadi skeleton and resolves roles without copying it', async () => {
  const skelPath = path.join(canonicalRoot, 'public', 'assets', 'spine', 'op', 'char_263_skadi', 'front', 'char_263_skadi.skel');
  assert.equal(fs.statSync(skelPath).isFile(), true);
  const before = fs.statSync(skelPath, { bigint: true });
  const result = await enrichSpineAnimationMetadata({
    skel: { url: '/assets/spine/op/char_263_skadi/front/char_263_skadi.skel', sourcePath: skelPath },
    atlas: { url: '/assets/spine/op/char_263_skadi/front/char_263_skadi.atlas' },
    textures: ['/assets/spine/op/char_263_skadi/front/char_263_skadi.png'], pma: true,
  }, { ownerId: 'char_263_skadi', skillIndices: [0, 1, 2] });
  const after = fs.statSync(skelPath, { bigint: true });
  assert.equal(after.ino, before.ino);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.ok(result.animations.Attack > 0);
  assert.ok(result.animations.Idle > 0);
  assert.ok(result.events.includes('OnAttack'));
  assert.deepEqual(result.hits.Attack, [0.867]);
  assert.deepEqual(result.bounds, { x: -221.587, y: -31.657, width: 426.034, height: 418.435 });
  assert.equal(result.anims.attack.loop, 'Attack');
  assert.equal(result.anims.skill.loop, 'Attack');
  assert.ok(result.anims.skills && Object.hasOwn(result.anims.skills, '0'));
});

test('normal producer resolves real Gnosis and SilverAsh bone clips from registered canonical paths', async () => {
  for (const [id, rel] of [
    ['char_206_gnosis', 'char_206_gnosis'],
    ['char_1045_svash2', 'char_1045_svash2'],
  ]) {
    const skelPath = path.join(canonicalRoot, 'public', 'assets', 'spine', 'op', id, 'front', `${rel}.skel`);
    const before = fs.statSync(skelPath, { bigint: true });
    const result = await enrichSpineAnimationMetadata({ skel: { sourcePath: skelPath } }, { ownerId: id, skillIndices: [0, 1, 2] });
    const after = fs.statSync(skelPath, { bigint: true });
    assert.ok(Object.keys(result.animations).length > 0, `${id} has parsed native clips`);
    assert.ok(Object.hasOwn(result.animations, 'Idle'), `${id} includes its real Idle clip`);
    assert.deepEqual(after.ino, before.ino);
    assert.deepEqual(after.size, before.size);
    assert.deepEqual(after.mtimeNs, before.mtimeNs);
  }
});

test('metadata-only producer enriches both unit sides while preserving pma and source records', async () => {
  const skelPath = path.join(canonicalRoot, 'public', 'assets', 'spine', 'op', 'char_263_skadi', 'front', 'char_263_skadi.skel');
  const model = { skel: { sourcePath: skelPath, url: '/assets/skadi.skel' }, pma: true, sentinel: 'preserved' };
  const { output, receipt } = await repairManifestSpineMetadata({ assets: {
    units: { char_263_skadi: { skills: { a: {}, b: {} }, model: { front: model, back: null } } },
    summons: {}, derivedModels: {},
  } }, { inputPath: 'fixture-input', outputPath: 'fixture-output', pid: 123 });
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.counts.modelEntries, 1);
  assert.ok(Object.keys(output.assets.units.char_263_skadi.model.front.animations).includes('Attack'));
  assert.equal(output.assets.units.char_263_skadi.model.front.pma, true);
  assert.equal(output.assets.units.char_263_skadi.model.front.sentinel, 'preserved');
  assert.equal(receipt.networkRequests, 0);
  assert.equal(receipt.downloadedBytes, 0);
});

test('metadata-only CLI accepts only the exact registered input/output arguments', () => {
  const input = path.join(canonicalRoot, 'data', 'assault-rules', 'assault-assets.json');
  const output = path.join(canonicalRoot, '.omni', 'tmp', 'assault', 'assault-assets-repair.json');
  assert.deepEqual(parseMetadataOnlyArgs(['--metadata-only', '--input', input, '--output', output]), { inputPath: input, outputPath: output });
  assert.throws(() => parseMetadataOnlyArgs(['--metadata-only', '--input', input, '--output', output, '--acquire']), /exactly/);
  assert.throws(() => parseMetadataOnlyArgs(['--metadata-only', '--input', path.join(canonicalRoot, 'other.json'), '--output', output]), /canonical source manifest/);
  assert.throws(() => parseMetadataOnlyArgs(['--metadata-only', '--input', input, '--output', path.join(canonicalRoot, 'public', 'assets', 'x.json')]), /fixed Assault tmp manifest/);
});

test('a proven one-animation single-Spine model explicitly has no attack or skill clip', () => {
  const result = resolveSpineAnimationMetadata({ skel: { sourcePath: 'fixture.skel' } }, {
    animations: ['Default'], durations: { Default: 1 }, events: [], hits: {}, bounds: null,
  }, { ownerId: 'fixture-single-spine', skillIndices: [0], singleSpine: true });
  assert.equal(result.animationRoleStatus, 'native-single-spine-no-attack');
  assert.equal(result.anims.attack, null);
  assert.equal(result.anims.skill, null);
});

test('producer rejects missing source path and preserves complete precomputed native metadata', async () => {
  await assert.rejects(enrichSpineAnimationMetadata({ skel: { url: '/assets/no-source.skel' } }), /absolute registered skeleton sourcePath/);
  const complete = { skel: { url: 'x', sourcePath: 'unused' }, anims: { idle: 'Idle', attack: { loop: 'Hit' } },
    animations: { Idle: 1, Hit: 1 }, events: [], hits: {}, bounds: { x: 0, y: 0, width: 1, height: 1 } };
  assert.strictEqual(await enrichSpineAnimationMetadata(complete), complete);
});
