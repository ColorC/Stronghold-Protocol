export function isDamageDealer(card) {
  if (!card) return false;
  if (card.profession && card.profession !== 'MEDIC') return true;
  const description = `${card.trait?.desc || ''} ${card.skill?.desc || ''}`;
  return card.subProfessionId === 'incantationmedic'
    || Number(card.skill?.bb?.atk_scale) > 0
    || Number(card.skill?.bb?.damage_scale) > 0
    || /造成.{0,12}伤害|攻击敌人时/.test(description);
}

export function hasDamageDealer(roster, catalog) {
  return (roster || []).some((piece) => isDamageDealer(catalog?.[piece.chessId]));
}

export function upgradeReserve({ roster, deployed, funds, upgradePrice, level }) {
  const price = Number(upgradePrice);
  return Number(roster) >= 8 && Number(deployed) >= 6 && Number.isFinite(price)
    && Number(funds) >= price + 3 && Number(level) < 6 ? price + 3 : 0;
}
