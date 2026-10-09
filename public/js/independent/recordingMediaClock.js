export function startRecordingMediaAtFirstCapture(state, { paintCaptureFrame, requestFrame }, timesliceMs = 5000) {
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
