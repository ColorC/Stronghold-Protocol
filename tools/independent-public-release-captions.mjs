export function expectedReplayCaption(recordingId, cue, profile) {
  if (!cue || typeof cue.text !== 'string') return '';
  if (profile?.recordingId !== recordingId || !Array.isArray(profile.cues)) return cue.text;
  return profile.cues.find((entry) => entry?.sourceKey === cue.key)?.text || cue.text;
}
