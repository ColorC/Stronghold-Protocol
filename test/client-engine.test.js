import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'public', 'js', 'independent', 'engine');
const TOOL = path.join(ROOT, 'tools', 'build-client-engine.mjs');
const DATA_KEYS = ['config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices', 'enemies', 'factions', 'waves', 'stages', 'bosses', 'tokens', 'assets', 'backups', 'independent-game-text'];

test('the browser workshop engine builds in its formal output with the real session closure', { timeout: 120_000 }, async () => {
  const run = spawnSync(process.execPath, [TOOL, '--out', OUTPUT], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, `${TOOL} failed:\n${String(run.stderr || '').slice(0, 2000)}`);
  const manifest = JSON.parse(readFileSync(path.join(OUTPUT, 'engine-build.json'), 'utf8'));
  const paths = manifest.modules.map((entry) => entry.path);
  assert.ok(paths.length > 0 && manifest.totalBytes > 0);
  assert.ok(paths.every((entry) => !/^(?:data\/|.*(?:^|\/)assault(?:\/|-)|.*(?:coverage|runtime|source-reference))/.test(entry)), 'the workshop engine must not include the assault source/data projections');
  assert.ok(paths.every((entry) => !path.isAbsolute(entry)));
  const projectedSimdata = readFileSync(path.join(OUTPUT, 'server', 'sim', 'simdata.js'), 'utf8');
  const nativeSimdata = readFileSync(path.join(ROOT, 'server', 'sim', 'simdata.js'), 'utf8');
  assert.match(projectedSimdata, /const IS_NODE = false;/);
  assert.doesNotMatch(projectedSimdata, /import\(['"]\.\/nodeData\.js['"]\)/);
  assert.match(nativeSimdata, /import\(['"]\.\/nodeData\.js['"]\)/, 'Node source loader remains intact');

  const data = await import(pathToFileURL(path.join(OUTPUT, 'server', 'data.js')).href);
  assert.deepEqual(data.DATA_FILES, DATA_KEYS);
  const session = await import(pathToFileURL(path.join(OUTPUT, 'server', 'modes', 'independent', 'session.js')).href);
  const catalog = await import(pathToFileURL(path.join(OUTPUT, 'server', 'modes', 'independent', 'catalog.js')).href);
  const state = session.createSession({ seed: 7, difficulty: 'NORMAL', catalog: catalog.getCatalog(data.getData()), data: data.getData() });
  assert.equal(session.validateSession(state).length, 0);
});
