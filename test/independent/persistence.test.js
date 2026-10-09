import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renameWithTransientRetry } from '../../server/modes/independent/persistence.js';

async function withTempDirectory(task) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sp-session-atomic-write-'));
  try { await task(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('atomic rename retries transient Windows errors and readers see complete old or new JSON', async () => {
  await withTempDirectory(async (directory) => {
    const target = path.join(directory, 'session.json');
    const pending = path.join(directory, 'session.unique.pending');
    const oldState = { revision: 72, payload: 'old'.repeat(24_000) };
    const newState = { revision: 73, payload: 'new'.repeat(24_000) };
    const oldText = JSON.stringify(oldState);
    const newText = JSON.stringify(newState);
    await writeFile(target, oldText, { flag: 'wx' });
    await writeFile(pending, newText, { flag: 'wx' });

    let attempts = 0;
    const seen = [];
    await renameWithTransientRetry(pending, target, {
      renameImpl: async (from, to) => {
        attempts += 1;
        seen.push(JSON.parse(await readFile(target, 'utf8')));
        if (attempts === 1) throw Object.assign(new Error('transient Windows rename lock'), { code: 'EPERM' });
        if (attempts === 2) throw Object.assign(new Error('transient Windows rename lock'), { code: 'EACCES' });
        return rename(from, to);
      },
      wait: async () => {},
    });

    assert.equal(attempts, 3);
    assert.deepEqual(seen, [oldState, oldState, oldState]);
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), newState);
    await assert.rejects(readFile(pending), { code: 'ENOENT' });
  });
});

test('atomic rename does not retry other errors and preserves old target plus pending file after exhaustion', async () => {
  await withTempDirectory(async (directory) => {
    const target = path.join(directory, 'session.json');
    const pending = path.join(directory, 'session.unique.pending');
    const oldText = JSON.stringify({ revision: 72, value: 'old' });
    const newText = JSON.stringify({ revision: 73, value: 'new' });
    await writeFile(target, oldText, { flag: 'wx' });
    await writeFile(pending, newText, { flag: 'wx' });

    const invalid = Object.assign(new Error('invalid rename'), { code: 'EINVAL' });
    let invalidAttempts = 0;
    await assert.rejects(renameWithTransientRetry(pending, target, {
      renameImpl: async () => { invalidAttempts += 1; throw invalid; },
      wait: async () => assert.fail('non-transient error must not wait'),
    }), (error) => error === invalid);
    assert.equal(invalidAttempts, 1);

    const locked = Object.assign(new Error('rename remains locked'), { code: 'EBUSY' });
    let lockedAttempts = 0;
    let delays = 0;
    await assert.rejects(renameWithTransientRetry(pending, target, {
      renameImpl: async () => { lockedAttempts += 1; throw locked; },
      wait: async (milliseconds) => { delays += milliseconds; },
    }), (error) => error === locked);
    assert.equal(lockedAttempts, 8);
    assert.equal(delays, 975);
    assert.equal(await readFile(target, 'utf8'), oldText);
    assert.equal(await readFile(pending, 'utf8'), newText);
  });
});
