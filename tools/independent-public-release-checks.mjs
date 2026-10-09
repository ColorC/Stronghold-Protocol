export function isExpectedMediaSeekCancellation(url, error) {
  if (error !== 'net::ERR_ABORTED') return false;
  try { return /\/independent\/api\/recordings\/[^/]+\/media\//.test(new URL(url).pathname); }
  catch { return false; }
}
