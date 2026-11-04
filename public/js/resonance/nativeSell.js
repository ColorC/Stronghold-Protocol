/** The compact sell target is aligned to the lower edge of the existing shop. */
export function nativeSellTargetRect(shopRect, height = 44) {
  if (!shopRect || ![shopRect.left, shopRect.right, shopRect.top, shopRect.bottom].every(Number.isFinite)) return null;
  const width = shopRect.right - shopRect.left;
  const targetHeight = Math.min(Math.max(1, height), shopRect.bottom - shopRect.top);
  if (width <= 0 || targetHeight <= 0) return null;
  return { left: shopRect.left, right: shopRect.right, top: shopRect.bottom - targetHeight, bottom: shopRect.bottom, width, height: targetHeight };
}

/** Only a chess piece released inside the active shop target during prep can be sold. */
export function isNativeSellDrop({ kind, showPrep, sell, target, rect }) {
  if (kind !== 'chess' || !showPrep || !Number.isFinite(sell) || target?.area !== 'outside' || !rect) return false;
  const { clientX, clientY } = target;
  return Number.isFinite(clientX) && Number.isFinite(clientY)
    && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

/** Invoke the supplied existing sale action once for a valid released piece. */
export async function dispatchNativeSellDrop({ piece, showPrep, sell, target, rect, onSell }) {
  if (!piece || typeof onSell !== 'function'
    || !isNativeSellDrop({ kind: piece.kind, showPrep, sell, target, rect })) return false;
  await onSell(piece);
  return true;
}
