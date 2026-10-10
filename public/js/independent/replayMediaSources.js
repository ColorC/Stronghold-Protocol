/** Use clear native clips inside their recorded intervals, preferring battle checkpoints at shared boundaries. */
export function replayMediaSourceAt(second, originalSegments, renderedClips = []) {
  const time = Number(second);
  const covers = clip => time >= clip.at && time < clip.endSecond;
  const rendered = renderedClips.find(clip => !clip.key.startsWith('rendered-prep-') && covers(clip))
    || renderedClips.find(covers);
  return rendered || [...originalSegments].reverse().find(segment => time >= segment.at) || originalSegments[0] || null;
}

export function renderedReplayClips(packetOrManifest, api, recordingId) {
  const manifest = packetOrManifest?.ok === true
    ? packetOrManifest.manifest
    : packetOrManifest && typeof packetOrManifest === 'object' && 'ok' in packetOrManifest
      ? null
      : packetOrManifest;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.recordingId !== recordingId || !Array.isArray(manifest.clips)) return [];
  return manifest.clips.filter(clip => {
    const index = clip.kind === 'prep' ? clip.index : clip.round;
    return Number.isSafeInteger(index) && index > 0 && Number.isFinite(clip.startSecond) && clip.startSecond >= 0
      && Number.isFinite(clip.endSecond) && clip.endSecond > clip.startSecond && Number.isFinite(clip.mediaDuration) && clip.mediaDuration > 0;
  }).map(clip => {
    const prep = clip.kind === 'prep';
    const index = prep ? clip.index : clip.round;
    const route = prep ? 'prep-' + index : String(index);
    return { key: 'rendered-' + route, index, at: clip.startSecond, endSecond: clip.endSecond, duration: clip.mediaDuration,
      url: new URL('recordings/' + encodeURIComponent(recordingId) + '/rendered/' + route, api).href };
  });
}
