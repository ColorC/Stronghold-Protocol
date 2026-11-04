export function clampReplayMediaTime(time, mediaDuration, endMargin = 0.05) {
  const requested = Number(time);
  const target = Number.isFinite(requested) ? Math.max(0, requested) : 0;
  const duration = Number(mediaDuration);
  if (!Number.isFinite(duration) || duration <= 0) return target;
  const margin = Number.isFinite(Number(endMargin)) ? Math.max(0, Number(endMargin)) : 0;
  return Math.min(target, Math.max(0, duration - margin));
}
