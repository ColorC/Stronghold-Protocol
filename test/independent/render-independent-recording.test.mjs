import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseArgs, ivfHeader, writeIvfFrame, battleFrameRetryUrls, nearestBattleFrameIndex } from '../../tools/render-independent-recording.mjs';

const base = ['--recording-id','c3c3f89e-eae2-46ac-a118-a6deda3aa3b6','--session-id','8e9c96d2-576e-4f8d-8e9b-f7668e093d09',
  '--recordings-dir','C:/recordings','--session-dir','C:/sessions','--timeline-json','C:/timeline.json','--install-root','C:/install','--output-root','C:/out','--rounds','12','--sample-seconds','5'];

test('renderer CLI requires explicit UUID-bound recording and session inputs', () => {
  const args = parseArgs(base);
  assert.equal(args.sampleSeconds, 5);
  assert.deepEqual(args.roundList, [12]);
  const full = parseArgs(base.filter((v) => v !== '--sample-seconds' && v !== '5'));
  assert.equal(full.sampleSeconds, null);
  assert.deepEqual(full.roundList, [12]);
  assert.throws(() => parseArgs(base.slice(0, 2)), /missing --session-id/);
  assert.throws(() => parseArgs(base.map((v) => v === '12' ? '0' : v)), /positive integers/);
  assert.equal(parseArgs([...base, '--prep-only', 'true']).prepOnly, true);
  assert.throws(() => parseArgs([...base, '--prep-only', 'yes']), /prep-only must be true or false/);
});

test('IVF frame header and payload both survive writer backpressure in order', async () => {
  class SlowWriter extends EventEmitter {
    chunks = [];
    writes = 0;
    write(chunk) {
      this.chunks.push(Buffer.from(chunk));
      this.writes++;
      if (this.writes === 1) { setImmediate(() => this.emit('drain')); return false; }
      return true;
    }
  }
  const writer = new SlowWriter(); const payload = Buffer.from([0, 1, 2, 253, 254, 255]);
  await writeIvfFrame(writer, payload, 9000);
  assert.equal(writer.writes, 2);
  assert.equal(writer.chunks[0].readUInt32LE(0), payload.length);
  assert.equal(writer.chunks[0].readBigUInt64LE(4), 9000n);
  assert.deepEqual(writer.chunks[1], payload);
});

test('IVF header carries VP8 dimensions and 30fps timebase', () => {
  const header = ivfHeader(2560, 1260, 30);
  assert.equal(header.toString('ascii', 0, 4), 'DKIF');
  assert.equal(header.toString('ascii', 8, 12), 'VP80');
  assert.equal(header.readUInt16LE(12), 2560);
  assert.equal(header.readUInt16LE(14), 1260);
  assert.equal(header.readUInt32LE(16), 30);
  assert.equal(header.readUInt32LE(20), 1);
});

test('battle frame retries are bounded and cache-bust only retries', () => {
  assert.deepEqual(battleFrameRetryUrls(6, 621), [
    '/__battle-frame/6/621',
    '/__battle-frame/6/621?retry=1',
    '/__battle-frame/6/621?retry=2',
  ]);
  assert.deepEqual(battleFrameRetryUrls(16, 945, 1), ['/__battle-frame/16/945']);
  assert.throws(() => battleFrameRetryUrls(0, 1), /invalid battle frame retry parameters/);
  assert.throws(() => battleFrameRetryUrls(1, -1), /invalid battle frame retry parameters/);
  assert.throws(() => battleFrameRetryUrls(1, 0, 6), /invalid battle frame retry parameters/);
});

test('battle frame selection uses actual PTS, clamps to decoded cache, and never rounds past the last frame', () => {
  const pts = [0, 0.04, 0.08, 0.121];
  assert.equal(nearestBattleFrameIndex(pts, -0.01), 0);
  assert.equal(nearestBattleFrameIndex(pts, 0.079), 1);
  assert.equal(nearestBattleFrameIndex(pts, 0.08), 2);
  assert.equal(nearestBattleFrameIndex(pts, 100), 3);
  assert.throws(() => nearestBattleFrameIndex([], 0), /invalid battle frame timestamps/);
  assert.throws(() => nearestBattleFrameIndex([0, 0.1, 0.09], 0.1), /invalid battle frame timestamps/);
});
