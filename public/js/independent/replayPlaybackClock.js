/** Use decoded media time while its source is active; buffering freezes the shared timeline. */
export function replayMediaClockSecond({ second, source, activeKey, video, duration }) {
  if (!source || !video || source.key !== activeKey || video.currentSrc !== source.url
      || video.readyState < 1 || second < source.at || !Number.isFinite(video.currentTime)) return null;
  if (video.ended) {
    // A rendered clip occupies an exact recorded interval, including rounding at its last frame.
    if (Number.isFinite(source.endSecond)) return Math.min(duration, source.endSecond);
    // Original recordings can finish just before the last recorded DOM event.
    return null;
  }
  const mediaSecond = source.at + Math.max(0, video.currentTime);
  return Math.min(duration, Number.isFinite(source.endSecond) ? Math.min(source.endSecond, mediaSecond) : mediaSecond);
}
