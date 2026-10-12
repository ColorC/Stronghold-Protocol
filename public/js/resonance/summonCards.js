// Pure rules of the 召唤栏 (summonBar.js draws it): what cards the player has and where a card may be dropped.

/** Drag type of a summon card (the card carries { ownerUid, tokenId }; the native uid of the summoner). */
export const SUMMON_DRAG_TYPE = 'application/x-resonance-summon';

/**
 * The summon cards the player can drag: one per placeable summon of every deployed summoner (display state `pieces[].summonCards`).
 * A card keeps showing at 0 left, greyed, so the summoner's summons are always listed; a benched summoner offers none.
 */
export function summonCardRows(state) {
  const rows = [];
  for (const piece of state?.pieces || []) {
    if (piece.row == null) continue;
    for (const card of piece.summonCards || []) {
      rows.push({
        key: `${piece.nativeUid ?? piece.uid}:${card.tokenId}`, ownerUid: piece.nativeUid ?? piece.uid, ownerName: piece.operator?.name || '干员',
        ownerDir: piece.dir || 'RIGHT', tokenId: card.tokenId, name: card.name, limit: card.limit, remaining: card.remaining,
        placed: card.placed || [], legalTiles: card.legalTiles || [],
      });
    }
  }
  return rows;
}

/** Why a drop on `tile` is refused, or null when the card may go there (the tile must be one the server listed as legal). */
export function summonDropRefusal(row, tile) {
  if (!tile) return '请把召唤物放在战场的部署格上';
  return row.legalTiles.includes(`${tile.row},${tile.col}`) ? null : '无法部署在该位置';
}
