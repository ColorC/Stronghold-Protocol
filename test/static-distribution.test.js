import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILDER = path.join(ROOT, 'tools', 'assets', 'build-static-site.mjs');

function command(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}

test('static builder pins a safe path-only package and copies extensionless audio aliases', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'stronghold-static-fixture-'));
  const resolvedTemp = path.resolve(tempRoot);
  assert.ok(resolvedTemp.startsWith(path.resolve(os.tmpdir()) + path.sep), 'fixture must remain under the OS temp root');
  t.after(async () => rm(resolvedTemp, { recursive: true, force: true }));
  const source = path.join(tempRoot, 'source');
  const output = path.join(tempRoot, 'upload');
  for (const dir of [
    'public/js', 'public/css', 'public/vendor', 'public/fonts', 'public/assets/audio/bgm',
    'data', 'shared', 'server/sim/content/support',
  ]) await mkdir(path.join(source, dir), { recursive: true });
  await writeFile(path.join(source, 'public/js/main.js'), "export const lazy = () => import('/sim/constants.js');\nexport const asset = '/assets/a.png';\n");
  await writeFile(path.join(source, 'public/css/main.css'), "@font-face { src: url('/fonts/demo.woff2'); }\n");
  await writeFile(path.join(source, 'public/vendor/preact.module.js'), 'export {};\n');
  await writeFile(path.join(source, 'public/fonts/fonts.css'), '@font-face { font-family: demo; }\n');
  await writeFile(path.join(source, 'public/fonts/demo.woff2'), Buffer.from([1, 2, 3]));
  await writeFile(path.join(source, 'public/assets/audio/bgm/track.mp3'), Buffer.from([0x49, 0x44, 0x33, 4, 5]));
  await writeFile(path.join(source, 'data/chess.json'), '{"fixture":true}\n');
  await writeFile(path.join(source, 'data/private-unlisted.json'), '{"mustNotCopy":true}\n');
  await writeFile(path.join(source, 'shared/media.js'), 'export const MEDIA_PREFIX = "/media/";\n');
  await writeFile(path.join(source, 'server/sim/simdata.js'), 'export function setSimData() {}\n');
  await writeFile(path.join(source, 'server/sim/content/support/index.js'), 'export {};\n');
  await writeFile(path.join(source, 'server/sim/nodeData.js'), 'export const secret = true;\n');
  await writeFile(path.join(source, 'server/index.js'), 'export const DATA_SHIM_JS = "import { getSimData } from \'./sim/simdata.js\';\\nexport function getData() { return getSimData(); }\\n";\n');
  command('git', ['init', '-q'], source);
  command('git', ['config', 'user.email', 'fixture@example.invalid'], source);
  command('git', ['config', 'user.name', 'Static fixture'], source);
  command('git', ['add', 'public/js', 'public/css', 'shared', 'data/chess.json', 'server/sim', 'server/index.js'], source);
  command('git', ['commit', '-qm', 'fixture'], source);
  const revision = command('git', ['rev-parse', 'HEAD'], source);
  const engine = path.join(source, 'public/js/independent/engine');
  await mkdir(engine, { recursive: true });
  await writeFile(path.join(engine, 'engine-build.json'), JSON.stringify({ sourceRevision: revision, sourceDirty: false }));
  await writeFile(path.join(engine, 'entry.js'), "export const data = { image: '/assets/a.png', media: '/media/' };\n");
  const basePath = `/static/releases/${revision}`;
  command(process.execPath, [BUILDER, `--source-root=${source}`, `--revision=${revision}`, `--base-path=${basePath}`, `--out=${output}`], ROOT);
  const staticRoot = path.join(output, 'static', 'releases', revision);
  const report = JSON.parse(await readFile(path.join(output, 'static-build.json'), 'utf8'));
  assert.equal(report.sourceRevision, revision);
  assert.equal(report.mediaAliasFiles, 1);
  assert.equal(report.mediaAliasBytes, 5);
  assert.deepEqual(await readFile(path.join(staticRoot, 'media/bgm/track')), Buffer.from([0x49, 0x44, 0x33, 4, 5]));
  assert.equal(await readFile(path.join(staticRoot, 'data.js'), 'utf8').then((s) => s.includes('getSimData')), true);
  assert.match(await readFile(path.join(staticRoot, 'js/main.js'), 'utf8'), new RegExp(`import\\('${basePath}/sim/constants.js'\\)`));
  assert.match(await readFile(path.join(staticRoot, 'css/main.css'), 'utf8'), new RegExp(`url\\('${basePath}/fonts/demo\\.woff2'\\)`));
  assert.match(await readFile(path.join(staticRoot, 'js/main.js'), 'utf8'), /asset = '\/assets\/a\.png'/);
  assert.match(await readFile(path.join(staticRoot, 'shared/media.js'), 'utf8'), /MEDIA_PREFIX = "\/media\/"/);
  assert.equal(report.clientEngineRevision, revision);
  assert.equal(await readFile(path.join(staticRoot, 'js/independent/engine/entry.js'), 'utf8'), "export const data = { image: '/assets/a.png', media: '/media/' };\n");
  await assert.rejects(readFile(path.join(staticRoot, 'data/private-unlisted.json')));
  await assert.rejects(readFile(path.join(staticRoot, 'sim/nodeData.js')));
  const headers = await readFile(path.join(output, '_headers'), 'utf8');
  assert.match(headers, new RegExp(`${basePath.replaceAll('/', '\\/')}\\/\\*`));
  assert.match(headers, /Access-Control-Allow-Origin: \*/);
  assert.match(headers, /immutable/);
  assert.match(headers, /Content-Type: audio\/mpeg/);
  assert.match(headers, new RegExp(`${basePath.replaceAll('/', '\\/')}\\/media/\\*`));
});
