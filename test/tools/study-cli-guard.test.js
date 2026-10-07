import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runStudyTest, STUDY_USAGE } from '../../tools/diy2b/study-test.mjs';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../../tools/diy2b/study-test.mjs', import.meta.url));
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const options = { env, windowsHide: true, timeout: 15000 };

test('study runner import is inert and missing runner arguments reject before browser/filesystem work', async () => {
  assert.equal(typeof runStudyTest, 'function');
  await assert.rejects(runStudyTest(), { name: 'TypeError', message: STUDY_USAGE });
  const probe = `import fs from 'node:fs'; import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); const Module=require('node:module'); const original=Module._load; Module._load=function(id,...args){if(id==='puppeteer-core')throw new Error('browser dependency loaded during import');return original.call(this,id,...args);}; fs.mkdirSync=()=>{throw new Error('filesystem write during import');}; await import(${JSON.stringify(new URL('../../tools/diy2b/study-test.mjs', import.meta.url).href)}); console.log('inert');`;
  const result = await exec(process.execPath, ['--input-type=module', '-e', probe], options);
  assert.equal(result.stdout.trim(), 'inert');
  assert.equal(result.stderr, '');
});

test('direct CLI with missing URL or output prints usage and exits 2', async () => {
  for (const args of [[], ['http://127.0.0.1:1/dev/diy-2b/']]) {
    await assert.rejects(exec(process.execPath, [script, ...args], options), error => {
      assert.equal(error.code, 2);
      assert.equal(error.stdout, '');
      assert.equal(error.stderr.trim(), STUDY_USAGE);
      return true;
    });
  }
});

test('node test discovery of study-test.mjs succeeds without browser or output side effects', async () => {
  const result = await exec(process.execPath, ['--test', script], options);
  assert.match(result.stdout, /pass 1/);
  assert.doesNotMatch(result.stdout + result.stderr, /Usage:|ERR_INVALID_ARG_TYPE|puppeteer|receipt\.json/);
});
