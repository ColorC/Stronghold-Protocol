function entryDirectory(base) {
  return new URL('.', new URL(base));
}

export function publicEntryUrl(base, relativePath) {
  return new URL(relativePath, entryDirectory(base)).href;
}

export function publicSessionUrl(base, sessionId) {
  const url = new URL(`independent/api/sessions/${encodeURIComponent(sessionId)}`, entryDirectory(base));
  url.searchParams.set('catalog', '0');
  return url.href;
}

export function publicRecordingUrl(base, recordingId) {
  return new URL(`independent/api/recordings/${encodeURIComponent(recordingId)}`, entryDirectory(base)).href;
}

export function publicReplayUrl(base, recordingId) {
  const url = new URL('independent-replay.html', entryDirectory(base));
  url.searchParams.set('recording', recordingId);
  return url.href;
}
