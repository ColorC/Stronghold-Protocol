import test from 'node:test';
import assert from 'node:assert/strict';
import { captureRecordingMediaFrame, enqueueRecordingMediaBlob, MAX_RECORDING_MEDIA_UPLOAD_BYTES, startRecordingMediaAtFirstCapture } from '../../public/js/independent/recordingMediaClock.js';

function state(overrides = {}) {
  return { mediaStartCancelled: false, mediaRecorderStarted: false, mediaRecorder: { state: 'inactive', start() { this.state = 'recording'; } },
    hasPaintedFrame: false, captureFrames: 0, lastCaptureAt: 0, mediaStartedAt: 0, firstCaptureAt: 0, actualRecorderStartedAt: 0, ...overrides };
}

test('pending recording does not start before a native cache exists and cancellation prevents late start', () => {
  const beforeFrame = state(); const calls = [];
  const options = { paintCaptureFrame: () => { calls.push('paint'); return true; }, requestFrame: () => calls.push('request') };
  assert.equal(startRecordingMediaAtFirstCapture(beforeFrame, options), false);
  assert.equal(beforeFrame.mediaRecorder.state, 'inactive');
  beforeFrame.hasPaintedFrame = true; beforeFrame.mediaStartCancelled = true;
  assert.equal(startRecordingMediaAtFirstCapture(beforeFrame, options), false);
  assert.deepEqual(calls, []);
});

test('first materialized output paint precedes MediaRecorder start and its first requested frame', () => {
  const media = state({ hasPaintedFrame: true }); const calls = [];
  media.mediaRecorder.start = (timeslice) => { calls.push(`start:${timeslice}`); media.mediaRecorder.state = 'recording'; };
  assert.equal(startRecordingMediaAtFirstCapture(media, {
    paintCaptureFrame: () => { calls.push('paint-cache-to-output'); return true; },
    requestFrame: () => calls.push('request-first-frame'),
  }), true);
  assert.deepEqual(calls, ['paint-cache-to-output', 'start:1000', 'request-first-frame']);
  assert.equal(media.mediaRecorderStarted, true);
  assert.ok(media.firstCaptureAt > 0);
  assert.ok(media.actualRecorderStartedAt >= media.firstCaptureAt);
  assert.equal(media.mediaStartedAt, media.actualRecorderStartedAt);
  assert.ok(media.lastCaptureAt >= media.actualRecorderStartedAt);
  assert.equal(media.captureFrames, 1);
});

test('30 Hz static-cache output paints and requests each frame only after recorder start', () => {
  const media = state({ hasPaintedFrame: true }); const calls = [];
  assert.equal(captureRecordingMediaFrame(media, { paintCaptureFrame: () => { calls.push('paint'); return true; }, requestFrame: () => calls.push('request') }), false);
  media.mediaRecorderStarted = true; media.mediaRecorder.state = 'recording';
  assert.equal(captureRecordingMediaFrame(media, { paintCaptureFrame: () => { calls.push('paint'); return true; }, requestFrame: () => calls.push('request') }), true);
  assert.deepEqual(calls, ['paint', 'request']);
  assert.equal(media.captureFrames, 1);
  assert.ok(media.lastCaptureAt > 0);
});

test('oversized MediaRecorder blobs split into ordered bounded upload chunks with one timeline anchor', () => {
  const state = { mediaSeq: 8, mediaPending: [] };
  const splitRanges = [];
  const oversizedBlob = { size: MAX_RECORDING_MEDIA_UPLOAD_BYTES * 2 + 19,
    slice(start, end) { splitRanges.push([start, end]); return { size: end - start }; } };
  assert.equal(enqueueRecordingMediaBlob(state, { blob: oversizedBlob, startedAt: 1234, timeMs: 5678 }), 3);
  assert.deepEqual(state.mediaPending.map((item) => item.seq), [9, 10, 11]);
  assert.deepEqual(state.mediaPending.map((item) => [item.startedAt, item.timeMs, item.blob.size]), [
    [1234, 5678, MAX_RECORDING_MEDIA_UPLOAD_BYTES],
    [1234, 5678, MAX_RECORDING_MEDIA_UPLOAD_BYTES],
    [1234, 5678, 19],
  ]);
  assert.deepEqual(splitRanges, [[0, MAX_RECORDING_MEDIA_UPLOAD_BYTES], [MAX_RECORDING_MEDIA_UPLOAD_BYTES, MAX_RECORDING_MEDIA_UPLOAD_BYTES * 2], [MAX_RECORDING_MEDIA_UPLOAD_BYTES * 2, oversizedBlob.size]]);
});

test('native capture timer follows the configured frame rate and applies composed canvas dimensions', async () => {
  const { readFileSync } = await import('node:fs');
  const recorder = readFileSync(new URL('../../public/js/independent/recorder.js', import.meta.url), 'utf8');
  assert.match(recorder, /setInterval\(captureFrame,\s*1000\s*\/\s*mediaOptions\.fps\)/);
  assert.match(recorder, /captureSurface\.width\s*=\s*layout\.width;\s*captureSurface\.height\s*=\s*layout\.height/);
});

test('recorder start failure is retained and cancels future start attempts', () => {
  const media = state({ hasPaintedFrame: true });
  media.mediaRecorder.start = () => { throw Object.assign(new Error('fixture start failure'), { name: 'InvalidStateError' }); };
  assert.equal(startRecordingMediaAtFirstCapture(media, { paintCaptureFrame: () => true, requestFrame() { assert.fail('no frame after a failed start'); } }), false);
  assert.equal(media.mediaStartCancelled, true);
  assert.deepEqual(media.mediaStartError, { name: 'InvalidStateError', message: 'fixture start failure' });
  assert.equal(media.captureFrames, 0);
});
