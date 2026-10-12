// Strategy icons (pure: the manifest and native bond records are passed in). One place decides which existing art a
// strategy shows, so the choice cards, 本局策略, the codex, the detail card and the effects column agree:
//   a strategy that hands out an emblem (徽记 / 王冠) → that emblem's own item art, the badge the inventory shows;
//   any other strategy tied to a pact (迅击爆发, 重装成长, …) → that pact's icon;
//   金币 / 经验 / 刷新 strategies → the HUD's own gold, level and refresh art;
//   equipment strategies → the native 维式重锤 item art (the equipment the HUD's dock shows); recruit strategies → the
//   single-piece buff icon and strategies that buff every operator → the team buff icon (the two the native tactic cards use);
//   anything else → the strategy group's icon.
import { uiUrl, itemIconUrl } from '../ui/assetUrls.js';
import { resolvePactIconUrl } from './pactIconMap.js';
import { resonanceEmblemIconUrl } from './itemIconMap.js';

/** HUD sprites (data/assets.json `ui`; an `item` entry is a native item's art, `items`); `mask` sprites are white glyphs tinted by CSS, the others keep their colours. */
export const STRATEGY_UI_ICONS = Object.freeze({
  gold: Object.freeze({ key: 'garrisonTypeIcon/s_icon_gold', mask: true }),
  xp: Object.freeze({ key: 'shopPanel/level', mask: false }),
  refresh: Object.freeze({ key: 'shopPanel/refresh_icon', mask: false }),
  gear: Object.freeze({ item: 'trap_1041_acarm041', mask: false }),
  recruit: Object.freeze({ key: 'buffIcon/icon_player_buff', mask: false }),
  team: Object.freeze({ key: 'buffIcon/icon_team_buff', mask: false }),
  group: Object.freeze({ key: 'settle/band_icon', mask: true }),
});
// Strategy effect kinds by what they mainly hand out (shared/resonance/prototype-strategies.js, current-strategies.js).
const EFFECT_THEME = Object.freeze({
  prototype_round_gold: 'gold', prototype_going_long: 'gold',
  prototype_epoch: 'xp', prototype_clear_mind: 'xp', prototype_level_up: 'xp', patient_study: 'xp',
  trade_sector: 'refresh', prototype_high_end_sector: 'refresh',
});

/** The pact a strategy belongs to, when the catalog has that pact. */
export function strategyPactId(catalog, id) {
  const strategy = catalog?.strategies?.[id];
  const effect = strategy?.effects?.[0];
  const pactId = strategy?.pactId ?? effect?.params?.traitId ?? effect?.params?.prototypeTraitId ?? null;
  return pactId && catalog?.pacts?.[pactId] ? pactId : null;
}

/** The emblem a strategy hands out (徽记 / 王冠 strategies), when the catalog has that emblem. */
export function strategyEmblemId(catalog, id) {
  const strategy = catalog?.strategies?.[id];
  const effect = strategy?.effects?.[0];
  const itemIds = strategy?.emblemId ? [strategy.emblemId] : effect?.kind === 'choose_transfer' ? effect.params?.itemIds ?? [] : [];
  return itemIds.find((itemId) => catalog?.equipment?.[itemId]?.kind === 'emblem') ?? null;
}

/** `{ kind: 'emblem', itemId, pactId }`, `{ kind: 'pact', pactId }` or `{ kind: 'ui', theme, key, mask }` for a strategy id. */
export function strategyIcon(catalog, id) {
  const pactId = strategyPactId(catalog, id), emblemId = strategyEmblemId(catalog, id);
  if (emblemId && resonanceEmblemIconUrl(catalog, emblemId)) return { kind: 'emblem', itemId: emblemId, pactId };
  if (pactId) return { kind: 'pact', pactId };
  const strategy = catalog?.strategies?.[id];
  const theme = STRATEGY_UI_ICONS[strategy?.iconTheme] ? strategy.iconTheme : EFFECT_THEME[strategy?.effectKind ?? strategy?.effects?.[0]?.kind] || 'group';
  return { kind: 'ui', theme, ...STRATEGY_UI_ICONS[theme] };
}

/** The icon URL a strategy shows, or null when the manifest has no such art. */
export function resolveStrategyIconUrl(catalog, id, manifest, bonds = []) {
  const icon = strategyIcon(catalog, id);
  if (icon.kind === 'emblem') return resonanceEmblemIconUrl(catalog, icon.itemId);
  if (icon.kind === 'pact') return resolvePactIconUrl(catalog, icon.pactId, manifest, bonds);
  return (icon.item ? itemIconUrl(manifest, icon.item) : uiUrl(manifest, icon.key)) || uiUrl(manifest, STRATEGY_UI_ICONS.group.key);
}
