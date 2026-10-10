import { html } from '../ui/components.js';
import { Img, BondGlyph } from '../ui/gameComponents.js';
import { TAVERN_FACTIONS } from '../../../shared/independentRules.js';

const FACTION_BOND = Object.fromEntries(Object.entries(TAVERN_FACTIONS).map(([bond, name]) => [name, bond]));

/** Shared native faction art for the shop and operator details. */
export function FactionIcon({ faction, catalog }) {
  const detail = catalog?.factionDetails?.[faction];
  const iconUrl = detail?.iconUrl || detail?.url;
  const fallback = FACTION_BOND[faction] ? html`<${BondGlyph} bondId=${FACTION_BOND[faction]} class="dbond__icon" />` : null;
  return iconUrl ? html`<${Img} class="dbond__icon ix-faction-icon" src=${iconUrl} alt="" loading="lazy" fallback=${fallback} />` : fallback;
}
