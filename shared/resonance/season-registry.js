import { prototypeSeason } from './prototype-season.js';
import { factionSeason } from './faction-season.js';
import { factionSeasonV2 } from './faction-season-v2.js';

// Keep the registration point singular so additional immutable season modules
// can be added without changing engine rulesVersion.
const PROTOTYPE_SEASONS = Object.freeze({
  [prototypeSeason.id]: prototypeSeason,
  [factionSeason.id]: factionSeason,
  [factionSeasonV2.id]: factionSeasonV2,
});
const ACTIVE_PROTOTYPE_SEASON_ID = factionSeasonV2.id;

export function getPrototypeSeason(id) {
  if (!Object.hasOwn(PROTOTYPE_SEASONS, id)) throw new Error(`RESONANCE_UNKNOWN_SEASON:${id}`);
  const season = PROTOTYPE_SEASONS[id];
  return season;
}

export function getActivePrototypeSeason() {
  return getPrototypeSeason(ACTIVE_PROTOTYPE_SEASON_ID);
}

export function prototypeSeasonForCatalog(catalog = {}) {
  const embedded = catalog?.prototypeSeason;
  const seasonId = catalog?.config?.seasonId ?? catalog?.season?.id ?? catalog?.prototypeMeta?.seasonId ?? embedded?.id;
  const registered = getPrototypeSeason(seasonId ?? ACTIVE_PROTOTYPE_SEASON_ID);
  if (embedded && embedded.id === registered.id) return embedded;
  return registered;
}

/** Trait ids whose season-1 mechanism a season replaced; their old battle and economy adapters stay silent. */
export function redesignedTraitIds(season) {
  return new Set(season?.strongholdPacts ?? []);
}

/** Trait ids whose season-1 economy hook (sponsors, markets, chests, temporary gear) a season retired. */
export function retiredEconomyTraitIds(season) {
  return new Set(season?.retiredEconomyTraits ?? []);
}
