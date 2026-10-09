function latestActiveCue(cues, second, endOffset) {
  let latest = null;
  for (const cue of cues) {
    if (!Number.isFinite(cue.at) || second < cue.at || second >= cue.at + endOffset) continue;
    if (!latest || cue.at >= latest.at) latest = cue;
  }
  return latest;
}

export function createReplayCueState(getCues) {
  let activeNarrationCue = null;
  const cues = () => typeof getCues === 'function' ? getCues() : getCues;
  return {
    current(second) { return activeNarrationCue || latestActiveCue(cues(), second, 5); },
    narration(second, explained) {
      let cue = null;
      for (const item of cues()) {
        if (!Number.isFinite(item.at) || explained.has(item.key || item.text) || second < item.at || second >= item.at + 1) continue;
        if (!cue || item.at >= cue.at) cue = item;
      }
      return cue;
    },
    activate(cue) { activeNarrationCue = cue || null; },
    clear() { activeNarrationCue = null; },
  };
}
