/** Select a workshop narration queue while keeping cue timing and focus tied to the recording. */
export function applyReplayNarration(recordingId, recordedCues, profile) {
  if (!Array.isArray(recordedCues)) throw new TypeError('Recorded cues must be an array');
  if (!profile || profile.recordingId !== recordingId) return recordedCues.map((cue) => ({ ...cue }));
  if (!Array.isArray(profile.cues)) throw new TypeError('Narration profile cues must be an array');

  const selected = profile.cues.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new TypeError('Narration cue must be an object');
    if (entry.sourceKey !== undefined) {
      if (typeof entry.key !== 'string' || !entry.key.trim() || typeof entry.text !== 'string' || !entry.text.trim()) {
        throw new TypeError('Selected narration cue requires a non-empty key and text');
      }
      const source = recordedCues.find((cue) => cue.key === entry.sourceKey);
      if (!source) throw new Error(`Narration source cue not found: ${entry.sourceKey}`);
      return { ...source, key: entry.key, text: entry.text };
    }
    if (!Number.isFinite(entry.at) || entry.at < 0 || typeof entry.key !== 'string' || !entry.key.trim() || typeof entry.text !== 'string' || !entry.text.trim()) {
      throw new TypeError('New narration cue requires at >= 0, a non-empty key, and non-empty text');
    }
    const { sourceKey: _sourceKey, ...cue } = entry;
    return { ...cue };
  });
  return selected.sort((a, b) => a.at - b.at);
}
