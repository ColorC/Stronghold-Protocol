/** Stable, roster-independent Set 13 Experiment laboratory placement. */
export function prototypeLabCells({ stageId = '', seed = 0, deployCells = [], count = 0 } = {}) {
  const unique = new Map();
  for (const cell of deployCells ?? []) {
    const row = Number(Array.isArray(cell) ? cell[0] : cell?.row);
    const col = Number(Array.isArray(cell) ? cell[1] : cell?.col);
    if (!Number.isInteger(row) || !Number.isInteger(col)) continue;
    unique.set(`${row},${col}`, { row, col });
  }
  const key = `${String(stageId)}|${String(seed)}`;
  const score = (coordinate) => {
    let hash = 2166136261;
    for (const ch of `${key}|${coordinate}`) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };
  return [...unique.entries()]
    .sort(([a], [b]) => score(a) - score(b) || a.localeCompare(b))
    .slice(0, Math.max(0, Math.floor(Number(count) || 0)))
    .map(([, cell]) => cell);
}
