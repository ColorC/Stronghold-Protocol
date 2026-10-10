function pointInPolygon(x, y, polygon = []) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i] || [], [xj, yj] = polygon[j] || [];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-8) + xi) inside = !inside;
  }
  return inside;
}

/** Map a pointer to the native own-board deployment region only. */
export function specialBoardTile(view, x, y) {
  if (!view?.tileScreen) return null;
  for (let row = 12; row >= 9; row--) for (let col = 2; col <= 10; col++) {
    const tile = view.tileScreen(row, col);
    if (tile && pointInPolygon(x, y, tile.poly)) return { row, col };
  }
  return null;
}
