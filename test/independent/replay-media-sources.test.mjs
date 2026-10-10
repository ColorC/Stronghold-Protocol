import test from 'node:test';
import assert from 'node:assert/strict';
import { replayMediaSourceAt, renderedReplayClips } from '../../public/js/independent/replayMediaSources.js';

const recordingId = 'c3c3f89e-eae2-46ac-a118-a6deda3aa3b6';
const api = 'https://workshop.colorc.cc/stronghold/independent/api/';

function manifest(clips = [{ round: 12, startSecond: 100, endSecond: 150, mediaDuration: 50, file: '../../secret' }]) {
  return {
    schemaVersion: 1,
    recordingId,
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sourceRevision: 'native-test-revision',
    viewport: { width: 2187, height: 1077 },
    fps: 30,
    videoBitsPerSecond: 24_000_000,
    clips,
  };
}

test('rendered clips replace only their exact battle interval', () => {
  const original = [{ key: 'original-1', at: 2.5 }, { key: 'original-2', at: 50 }];
  const rendered = [{ key: 'rendered-1', at: 21, endSecond: 37 }, { key: 'rendered-2', at: 52, endSecond: 63 }];
  for (const time of [0, 2.5, 20.99, 37, 40]) assert.equal(replayMediaSourceAt(time, original, rendered).key, 'original-1');
  for (const time of [21, 30, 36.999]) assert.equal(replayMediaSourceAt(time, original, rendered).key, 'rendered-1');
  assert.equal(replayMediaSourceAt(51, original, rendered).key, 'original-2');
  assert.equal(replayMediaSourceAt(62, original, rendered).key, 'rendered-2');
  assert.equal(replayMediaSourceAt(63, original, rendered).key, 'original-2');
  assert.equal(replayMediaSourceAt(1, [], []), null);
});

test('rendered media URLs preserve the public prefix and reject malformed interval metadata', () => {
  const clips = renderedReplayClips(manifest([
    { round: 12, startSecond: 100, endSecond: 150, mediaDuration: 50, file: '../../secret' },
    { round: 0, startSecond: 0, endSecond: 10, mediaDuration: 10 },
    { round: 13, startSecond: 140, endSecond: 135, mediaDuration: 5 },
    { round: 14, startSecond: Infinity, endSecond: 200, mediaDuration: 30 },
  ]), api, recordingId);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].url, `https://workshop.colorc.cc/stronghold/independent/api/recordings/${recordingId}/rendered/12`);
  assert.equal(clips[0].key, 'rendered-12');
  assert.deepEqual(renderedReplayClips({ ...manifest(), recordingId: 'other' }, 'https://a/api/', recordingId), []);
});

test('native successful HTTP response wrapper is unwrapped while failed wrappers are ignored', () => {
  // This is the production GET /recordings/:id/rendered JSON envelope.
  const nativeResponse = { ok: true, manifest: manifest() };
  const clips = renderedReplayClips(nativeResponse, api, recordingId);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].key, 'rendered-12');
  assert.equal(clips[0].at, 100);
  assert.equal(clips[0].endSecond, 150);
  assert.equal(clips[0].duration, 50);
  assert.equal(clips[0].url, `https://workshop.colorc.cc/stronghold/independent/api/recordings/${recordingId}/rendered/12`);
  assert.deepEqual(renderedReplayClips({ ok: false, error: 'RENDERED_NOT_FOUND', manifest: manifest() }, api, recordingId), []);
  assert.deepEqual(renderedReplayClips({ ok: true, error: 'RENDERED_MANIFEST_INVALID' }, api, recordingId), []);
});
