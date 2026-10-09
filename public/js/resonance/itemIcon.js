import { html } from '../ui/components.js';
import { GIcon } from '../ui/gameComponents.js';
import { data } from '../data.js';
import { assets } from '../assets.js';
import { resonanceNativeItem, resolveResonanceItemIconUrl } from './itemIconMap.js';
export { resonanceNativeItem, resolveResonanceItemIconUrl } from './itemIconMap.js';

// Resonance equipment IDs are mode data, not native chess_item IDs. Resolve them through a small
// semantic bridge to assets already shipped by the game; never ask the native ItemIcon to render
// an unknown mode ID (its intentional unknown-item fallback is a question mark).
const GLYPH = Object.freeze({ blade: 'sell', staff: 'bolt', bow: 'target', plate: 'shield', cloak: 'eye', belt: 'dp', tear: 'bolt', crest: 'flag' });

export function resonanceItemIconUrl(catalog, id) {
  return resolveResonanceItemIconUrl(catalog, id, data.list('items'), assets.manifest);
}

export function ResonanceItemIcon({ catalog, itemId, size = 'sm', showTier = true }) {
  const record = catalog?.equipment?.[itemId];
  const native = resonanceNativeItem(catalog, itemId, data.list('items'));
  const src = resonanceItemIconUrl(catalog,itemId) || (native ? assets.itemIcon(native) : null) || assets.profIcon('SUPPORT');
  const glyph = GLYPH[itemId] || 'bolt';
  return html`<span class=${`rs-item-icon rs-item-icon--${size}`} data-item-id=${itemId} title=${record?.name || '装备'}>
    ${src ? html`<img src=${src} alt="" loading="lazy"/>` : html`<${GIcon} name=${glyph}/>`}
    ${showTier && record?.tier ? html`<small aria-label=${`${record.tier}费装备`}>${record.tier}</small>` : null}
  </span>`;
}
