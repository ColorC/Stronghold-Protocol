// A talent an operator gains at a later star (resonance 升星特性, record `unlockStar`): its card lists it at every star and
// marks it while the unit is below that star. Pure, so a Node test reads the same rule the detail card shows.

const CN_STAR = { 2: '二', 3: '三' };

/** "三星时获得" for a talent still locked at the card's star, else '' (no `unlockStar`, or the star is reached). */
export function talentLockLabel(talent, star) {
  const unlock = talent?.unlockStar;
  if (!Number.isInteger(unlock) || Number(star ?? 1) >= unlock) return '';
  return `${CN_STAR[unlock] ?? unlock}星时获得`;
}
