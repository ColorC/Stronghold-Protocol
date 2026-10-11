import { prototypeSeason } from './prototype-season.js';
import { factionSeason } from './faction-season.js';

// Keep the registration point singular so additional immutable season modules
// can be added without changing engine rulesVersion.
const PROTOTYPE_SEASONS = Object.freeze({
  [prototypeSeason.id]: prototypeSeason,
  [factionSeason.id]: factionSeason,
});
const ACTIVE_PROTOTYPE_SEASON_ID = factionSeason.id;

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
