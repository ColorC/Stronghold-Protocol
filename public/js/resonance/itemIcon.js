import { html } from '../ui/components.js';
import { GIcon } from '../ui/gameComponents.js';
import { data } from '../data.js';
import { assets } from '../assets.js';
import { resonanceEmblemIconUrl, resonanceItemPactId, resonanceNativeItem, resolveResonanceItemIconUrl } from './itemIconMap.js';
import { pactIconUrl } from './pactIcon.js';
export { resonanceEmblemIconUrl, resonanceItemPactId, resonanceNativeItem, resolveResonanceItemIconUrl } from './itemIconMap.js';

// Resonance equipment IDs are mode data, not native chess_item IDs. Resolve them through a small
// semantic bridge to assets already shipped by the game; never ask the native ItemIcon to render
// an unknown mode ID (its intentional unknown-item fallback is a question mark).
const GLYPH = Object.freeze({ blade: 'sell', staff: 'bolt', bow: 'target', plate: 'shield', cloak: 'eye', belt: 'dp', tear: 'bolt', crest: 'flag' });

export function resonanceItemIconUrl(catalog, id) {
  const emblem = resonanceEmblemIconUrl(catalog, id);
  if (emblem) return emblem;
  const pactId = resonanceItemPactId(catalog, id);
  if (pactId) return pactIconUrl(catalog, pactId);
  return resolveResonanceItemIconUrl(catalog, id, data.list('items'), assets.manifest);
}

export function ResonanceItemIcon({ catalog, itemId, size = 'sm', showTier = true }) {
  const record = catalog?.equipment?.[itemId];
  const native = resonanceNativeItem(catalog, itemId, data.list('items'));
  const src = resonanceItemIconUrl(catalog,itemId) || (native ? assets.itemIcon(native) : null);
  const glyph = GLYPH[itemId] || (record?.kind === 'emblem' ? 'flag' : 'bolt');
  return html`<span class=${`rs-item-icon rs-item-icon--${size}`} data-item-id=${itemId} data-item-kind=${record?.kind || 'equipment'} data-show-quality=${showTier ? 'true' : 'false'} title=${record?.name || '装备'}>
    ${src ? html`<img src=${src} alt="" loading="lazy"/>` : html`<${GIcon} name=${glyph}/>`}
  </span>`;
}
