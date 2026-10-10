/** Select a rendered battle only inside its recorded interval; keep the original recording elsewhere. */
export function replayMediaSourceAt(second, originalSegments, renderedClips = []) {
  const time = Number(second);
  const rendered = renderedClips.find(clip => time >= clip.at && time < clip.endSecond);
  return rendered || [...originalSegments].reverse().find(segment => time >= segment.at) || originalSegments[0] || null;
}

export function renderedReplayClips(manifest, api, recordingId) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.recordingId !== recordingId || !Array.isArray(manifest.clips)) return [];
  return manifest.clips.filter(clip => Number.isSafeInteger(clip.round) && clip.round > 0 && Number.isFinite(clip.startSecond) && clip.startSecond >= 0 && Number.isFinite(clip.endSecond) && clip.endSecond > clip.startSecond && Number.isFinite(clip.mediaDuration) && clip.mediaDuration > 0).map(clip => ({ key: 'rendered-' + clip.round, index: clip.round, at: clip.startSecond, endSecond: clip.endSecond, duration: clip.mediaDuration, url: new URL('recordings/' + encodeURIComponent(recordingId) + '/rendered/' + clip.round, api).href }));
}
