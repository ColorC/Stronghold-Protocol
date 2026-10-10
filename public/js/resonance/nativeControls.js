/** Resonance-only controls. This mapping intentionally does not alter shared game key bindings. */
export function resonanceShortcutFor(event) {
  if (event?.key === 'Escape') return 'escape';
  if (event?.key === ' ' || event?.code === 'Space') return 'ready';
  const key = String(event?.key || '').toLowerCase();
  return ({ d: 'refresh', f: 'levelUp', e: 'sell', w: 'retreat' })[key] || null;
}

export const RESONANCE_SHORTCUT_LABEL = '快捷键：D 刷新 · F 购买经验 · E 出售选中干员 · W 部署或撤回选中干员 · Space 准备就绪 · Esc 关闭弹窗 · 右键查看详情';

/** Backend display DTOs encode legal cells as "row,col"; accept object cells for native callers too. */
export function firstAvailableLegalTile(legalTiles, occupied = new Set()) {
  for (const raw of legalTiles || []) {
    const match = typeof raw === 'string' ? /^(\d+),(\d+)$/.exec(raw) : null;
    const row = match ? Number(match[1]) : Number(raw?.row);
    const col = match ? Number(match[2]) : Number(raw?.col);
    if (!Number.isInteger(row) || !Number.isInteger(col) || occupied.has(`${row},${col}`)) continue;
    return { row, col };
  }
  return null;
}

/** Only a deliberate release inside the visible sale target sells; chess may come from board or hand. */
export function isResonanceSaleDrop({ kind, showPrep, sell, point, rect }) {
  if (kind !== 'chess' || !showPrep || !Number.isFinite(sell) || !point || !rect) return false;
  const { clientX, clientY } = point;
  return Number.isFinite(clientX) && Number.isFinite(clientY)
    && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}
