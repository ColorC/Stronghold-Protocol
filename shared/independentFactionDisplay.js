import { TAVERN_FACTIONS } from './independentRules.js';

/** Complete native nation/organization labels; legacy bonds are a compatibility fallback. */
export function operatorDisplayFactions(operator, rawChess = null) {
  const configured = operator?.nativeFactions ?? operator?.nativeFactionTags;
  const values = Array.isArray(configured) ? configured : (rawChess?.bonds || []).map(id => TAVERN_FACTIONS[id]);
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}
