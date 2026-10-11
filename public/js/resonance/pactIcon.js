import { html } from '../ui/components.js';
import { data } from '../data.js';
import { resolvePactIconUrl } from './pactIconMap.js';
import { GIcon } from '../ui/gameComponents.js';

const glyphFor = (name = '') => {
  const text = String(name);
  if (/先锋|先鋒|部署|费用|费用/.test(text)) return 'flag';
  if (/近卫|近衛|剑|剑士|刃/.test(text)) return 'sword';
  if (/重装|防御|守护|守護|坚守|堅守/.test(text)) return 'shield';
  if (/狙击|狙擊|远程|遠程|射手/.test(text)) return 'target';
  if (/术师|術師|法术|法術|源石|元素/.test(text)) return 'bolt';
  if (/医疗|醫療|治疗|治療|生命/.test(text)) return 'users';
  if (/辅助|輔助|支援|协同|協同/.test(text)) return 'users';
  if (/召唤|召喚|同构|同構/.test(text)) return 'users';
  if (/策略|战术|戰術/.test(text)) return 'book';
  return 'shield';
};
/** Resolve a real bond icon by the pact id first, then by the native bond record with the same name. */
export function pactIconUrl(catalog, id) {
  return resolvePactIconUrl(catalog, id, data.get('assets'), data.list('bonds'));
}

/** Current-color mask for a native pact glyph, with an existing role glyph when no native icon is available. */
export function PactIcon({ catalog, id, size = 'md', inactive = false, class: cls }) {
  const pact = catalog?.pacts?.[id];
  const src = pactIconUrl(catalog, id);
  const style = src ? { maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")` } : undefined;
  return html`<span class=${['rs-pact-icon', `rs-pact-icon--${size}`, inactive && 'is-inactive', cls].filter(Boolean).join(' ')} title=${pact?.name || id} aria-hidden="true">
    ${src ? html`<i style=${style}></i>` : html`<${GIcon} name=${glyphFor(pact?.name)} />`}
  </span>`;
}
