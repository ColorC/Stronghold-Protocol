export function pieceSourceCandidates(rect, fallback) {
  const candidates = [];
  if (rect && Number(rect.width) > 0 && Number(rect.height) > 0) {
    const x = Number(rect.left) + Number(rect.width) / 2;
    for (const ratio of [0.62, 0.82, 0.96]) candidates.push({ x, y: Number(rect.top) + Number(rect.height) * ratio, source: `body-${ratio}` });
  }
  if (fallback && Number.isFinite(Number(fallback.x)) && Number.isFinite(Number(fallback.y))) {
    candidates.push({ x: Number(fallback.x), y: Number(fallback.y), source: 'tile-fallback' });
  }
  return candidates;
}

export function verifiedPieceHit(uid, pieceNumber, hit, topTag, isGameCanvas) {
  const exactUid = String(hit?.uid ?? '') === String(uid)
    || (Number.isInteger(pieceNumber) && Number(hit?.uid) === pieceNumber);
  const exactNumber = Number.isInteger(pieceNumber) && Number(hit?.n) === pieceNumber;
  return (exactUid || exactNumber) && String(topTag || '').toUpperCase() === 'CANVAS' && !!isGameCanvas;
}
