import { GEO } from '../../../shared/constants.js';

function pointInPolygon(x, y, polygon = []) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i] || [], [xj, yj] = polygon[j] || [];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-8) + xi) inside = !inside;
  }
  return inside;
}

/** The field tile under a pointer, over the whole field (a summon card may be dropped on any tile the server lists as legal). */
export function fieldTileAt(view, x, y) {
  if (!view?.tileScreen) return null;
  const { r0, r1, c0, c1 } = GEO.FIELD;
  for (let row = r1; row >= r0; row--) for (let col = c0; col <= c1; col++) {
    const tile = view.tileScreen(row, col);
    if (tile && pointInPolygon(x, y, tile.poly)) return { row, col };
  }
  return null;
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
