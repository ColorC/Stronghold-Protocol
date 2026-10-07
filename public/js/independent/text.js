// 卫戍协议：工坊 game text: the hand-written texts (data/independent-game-text.json via the display catalog) shown the
// way the original shows its own — the moment in angle brackets, values highlighted — and every piece of gear,
// attachment or game term a text names becomes a term with its explanation: a tooltip on the word, and a 相关说明
// list under longer texts (a touch screen has no hover). The wording itself is never rewritten here.
import { html, Icon, Tooltip } from '../ui/components.js';
import { BondGlyph, ItemIcon } from '../ui/gameComponents.js';
import { data } from '../data.js';
import { BADGE_BOND } from './model.js';
import { badgeEffectText } from './badgeText.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const glossaries = new WeakMap();
/** Gear that is used, not worn: no equipment level to show. */
const USED = new Set(['补给', '玩家设施', '奖品']);
const showsLevel = (e) => e.kind === 'gear' && !e.badge && !e.used && e.level;

/** Name → { kind: 'gear'|'attachment'|'term', id, name, text, level, badge } for one display catalog (cached). */
export function glossaryOf(catalog) {
  if (!catalog) return { byName: new Map(), re: null };
  let g = glossaries.get(catalog);
  if (g) return g;
  const byName = new Map();
  const add = (name, entry) => { if (name && !byName.has(name)) byName.set(name, entry); };
  // badges first: an old item id renamed to a badge shares the badge's name
  for (const id of Object.keys(BADGE_BOND)) { const x = catalog.gear?.[id]; if (x) add(x.name, { kind: 'gear', id, name: x.name, text: badgeEffectText(id) || x.normal, level: x.level, badge: true }); }
  for (const [id, x] of Object.entries(catalog.gear || {})) {
    if (x.available === false || x.kind === '停用') continue;
    add(x.name, { kind: 'gear', id, name: x.name, text: x.normal, level: x.level, badge: x.kind === 'badge' || x.kind === '徽章', used: USED.has(x.kind) });
  }
  for (const [id, x] of Object.entries(catalog.attachments || {})) add(x.name, { kind: 'attachment', id, name: x.name, text: x.effect });
  for (const [id, x] of Object.entries(catalog.terms || {})) add(x.name, { kind: 'term', id, name: x.name, text: x.text });
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // a moment tag <获得时>, a known name, or a value (+10 / -0.5% / 150%)
  const re = new RegExp(`(<[^<>]{1,12}>)|(${names.join('|') || '\\u0000'})|([+-]?\\d+(?:\\.\\d+)?%?)`, 'g');
  g = { byName, re };
  glossaries.set(catalog, g);
  return g;
}

/** The glossary entries a set of texts names, first appearance first, without `exclude` (an item's own name). */
export function termsIn(texts, catalog, exclude = null) {
  const { byName, re } = glossaryOf(catalog);
  const seen = new Map();
  if (!re) return [];
  for (const t of texts.filter(Boolean)) {
    for (const m of String(t).matchAll(re)) if (m[2] && m[2] !== exclude && !seen.has(m[2])) seen.set(m[2], byName.get(m[2]));
  }
  return [...seen.values()];
}

/**
 * An item's icon (a badge wears its bond's glyph, other gear the original item art, a 交接凭证 a key, other gear
 * without art the first character of its name) with its explanation on hover / tap; `plain` where the explanation
 * is already beside it.
 */
export function GearIcon({ id, catalog, class: cls, plain = false }) {
  const g = (id && (catalog?.gear?.[id] || catalog?.prizes?.[id])) || null;
  const name = g?.name || '徽章';
  const icon = id && BADGE_BOND[id] ? html`<${BondGlyph} bondId=${BADGE_BOND[id]} class=${cx('ix-gear', cls)} />`
    : id && data.lookup('items', id) ? html`<span class=${cx('ix-gear', 'ix-gear--item', cls)}><${ItemIcon} itemId=${id} size="sm" showTier=${false} /></span>`
      : g?.kind === 'permit' ? html`<span class=${cx('ix-gear', 'ix-gear--permit', cls)}><${Icon} name="key" /></span>`
        : html`<span class=${cx('ix-gear', 'ix-gear--txt', cls)}>${[...name][0]}</span>`;
  if (plain || !g) return icon;
  const badge = !!BADGE_BOND[id] || g.kind === 'badge' || g.kind === '徽章';
  const tip = html`<span class="ix-tip"><b>${name}</b>${!badge && !USED.has(g.kind) && g.level ? html`<em>${g.level}级</em>` : null}<span>${badgeEffectText(id) || g.normal || g.effect || ''}</span></span>`;
  return html`<${Tooltip} text=${tip} placement="top">${icon}<//>`;
}

/** One term in running text: the word, its explanation on hover / tap. */
function Term({ entry, children }) {
  const tip = html`<span class="ix-tip"><b>${entry.name}</b>${showsLevel(entry) ? html`<em>${entry.level}级</em>` : null}<span>${entry.text}</span></span>`;
  return html`<${Tooltip} text=${tip} placement="top"><span class="rt-term" tabindex="0">${children}</span><//>`;
}

/** A hand-written text with its moment, values and terms marked. */
export function GameText({ text, catalog, class: cls, plainTerms = false }) {
  const { byName, re } = glossaryOf(catalog);
  const s = String(text || '');
  if (!re) return html`<span class=${cls}>${s}</span>`;
  const out = [];
  let last = 0; let k = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push(html`<span class="ix-when" key=${k++}>${m[1]}</span>`);
    else if (m[2]) out.push(plainTerms ? html`<span class="rt-term" key=${k++}>${m[2]}</span>` : html`<${Term} key=${k++} entry=${byName.get(m[2])}>${m[2]}<//>`);
    else out.push(html`<span class="rt-vup" key=${k++}>${m[3]}</span>`);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return html`<span class=${cx('rt', 'ix-text', cls)}>${out}</span>`;
}

/** 相关说明: every item and term the texts name, with its icon and explanation, under the texts. */
export function TermNotes({ texts, catalog, exclude = null, class: cls }) {
  const entries = termsIn(texts, catalog, exclude);
  if (!entries.length) return null;
  return html`<ul class=${cx('ix-notes', cls)} aria-label="相关说明">
    ${entries.map((e) => html`<li key=${e.name}>
      ${e.kind === 'gear' ? html`<${GearIcon} id=${e.id} catalog=${catalog} plain=${true} />` : html`<span class="ix-notes__mark" aria-hidden="true">${e.kind === 'attachment' ? '◆' : '·'}</span>`}
      <span><b>${e.name}</b>${showsLevel(e) ? html`<em>${e.level}级</em>` : null}<${GameText} text=${e.text} catalog=${catalog} plainTerms=${true} /></span>
    </li>`)}
  </ul>`;
}
