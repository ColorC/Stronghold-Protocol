import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseArgs } from '../../tools/independent-public-release-smoke.mjs';

const uuid = '18c269cb-56b3-41ba-9c8e-27599fac3f00';

test('public release smoke accepts the two public bases, a recording UUID, and an absolute artifact path', () => {
  const output = path.resolve('runtime/growth-destination-20261008/public-qa/fixture');
  const parsed = parseArgs(['--base', 'https://colorc.cc/stronghold/independent.html', '--base', 'https://workshop.colorc.cc/stronghold/independent.html', '--recording', uuid, '--output', output]);
  assert.equal(parsed.bases.length, 2);
  assert.equal(parsed.recording, uuid);
  assert.equal(parsed.output, output);
});

test('public release smoke rejects missing replay, invalid recording IDs, relative output, and a third base', () => {
  assert.throws(() => parseArgs(['--output', path.resolve('out')]), /--recording UUID is required/);
  assert.throws(() => parseArgs(['--recording', 'not-a-uuid', '--output', path.resolve('out')]), /must be a UUID/);
  assert.throws(() => parseArgs(['--recording', uuid, '--output', 'relative-output']), /absolute path/);
  assert.throws(() => parseArgs(['--base', 'https://a.test', '--base', 'https://b.test', '--base', 'https://c.test', '--recording', uuid, '--output', path.resolve('out')]), /one or two/);
});
