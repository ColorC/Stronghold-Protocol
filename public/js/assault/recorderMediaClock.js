export const MAX_RECORDING_MEDIA_UPLOAD_BYTES = 7 * 1024 * 1024;

export function enqueueRecordingMediaBlob(state, { blob, startedAt, timeMs, maxChunkBytes = MAX_RECORDING_MEDIA_UPLOAD_BYTES } = {}) {
  if (!blob?.size || typeof blob.slice !== 'function') return 0;
  const limit = Math.max(1, Math.floor(Number(maxChunkBytes) || MAX_RECORDING_MEDIA_UPLOAD_BYTES));
  let count = 0;
  for (let offset = 0; offset < blob.size; offset += limit) {
    state.mediaPending.push({ seq: ++state.mediaSeq, blob: blob.slice(offset, Math.min(offset + limit, blob.size)), startedAt, timeMs });
    count += 1;
  }
  return count;
}

export function startRecordingMediaAtFirstCapture(state, { paintCaptureFrame, requestFrame }, timesliceMs = 1000) {
  if (state.mediaStartCancelled || state.mediaRecorderStarted || !state.mediaRecorder || !state.hasPaintedFrame) return false;
  try {
    if (!paintCaptureFrame()) return false;
    state.firstCaptureAt = Date.now();
    state.mediaRecorder.start(timesliceMs);
    state.mediaRecorderStarted = true;
    state.mediaStartedAt = Date.now();
    state.actualRecorderStartedAt = state.mediaStartedAt;
    requestFrame();
    state.captureFrames += 1;
    state.lastCaptureAt = Date.now();
    return true;
  } catch (error) {
    state.mediaStartCancelled = true;
    state.mediaError = true;
    state.mediaStartError = { name: error?.name || 'Error', message: error?.message || String(error) };
    try { if (state.mediaRecorder.state !== 'inactive') state.mediaRecorder.stop(); } catch { /* preserve the original start failure */ }
    return false;
  }
}

export function captureRecordingMediaFrame(state, { paintCaptureFrame, requestFrame }) {
  if (state.mediaStartCancelled || !state.mediaRecorderStarted || !state.hasPaintedFrame) return false;
  try {
    if (!paintCaptureFrame()) return false;
    requestFrame();
    state.captureFrames += 1;
    state.lastCaptureAt = Date.now();
    return true;
  } catch {
    state.mediaError = true;
    return false;
  }
}
