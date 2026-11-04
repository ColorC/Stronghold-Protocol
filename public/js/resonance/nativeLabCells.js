import { GEO } from '../../../shared/constants.js';

/** Legal, deduplicated prototype lab deployment cells, visible only during editable prep. */
export function prototypeLabCells(state, enabled) {
  if (!enabled || state?.phase !== 'prep') return [];
  const seen = new Set(), cells = [];
  for (const cell of state?.prototypeMeta?.labCells || []) {
    const row = Number(cell?.row), col = Number(cell?.col), key = `${row},${col}`;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= GEO.ROWS || col < 0 || col >= GEO.COLS || seen.has(key)) continue;
    seen.add(key); cells.push([row, col]);
  }
  return cells;
}
