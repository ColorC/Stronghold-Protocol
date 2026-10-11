import { html } from '../ui/components.js';
import { data } from '../data.js';
import { PactIcon } from './pactIcon.js';
import { strategyIcon, resolveStrategyIconUrl } from './strategyIconMap.js';

/** The icon URL a strategy shows (strategyIconMap.js), against the loaded art manifest. */
export function strategyIconUrl(catalog, id) {
  return resolveStrategyIconUrl(catalog, id, data.get('assets'), data.list('bonds'));
}

/** A strategy's icon: its pact's glyph, the HUD's gold / level / refresh art, or the strategy group's glyph. */
export function StrategyIcon({ catalog, id, size = 'md', class: cls }) {
  const icon = strategyIcon(catalog, id);
  if (icon.kind === 'pact') return html`<${PactIcon} catalog=${catalog} id=${icon.pactId} size=${size} class=${['rs-strategy-icon', cls].filter(Boolean).join(' ')}/>`;
  const src = strategyIconUrl(catalog, id);
  const classes = ['rs-strategy-icon', `rs-strategy-icon--${size}`, `rs-strategy-icon--${icon.theme}`, icon.mask ? 'is-mask' : 'is-art', cls].filter(Boolean).join(' ');
  return html`<span class=${classes} aria-hidden="true">${!src ? null : icon.mask
    ? html`<i style=${{ maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")` }}></i>`
    : html`<img src=${src} alt="" />`}</span>`;
}
