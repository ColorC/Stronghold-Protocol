// 共鸣「音浪」主题的色值层：public/css/resonance-wave-remap.css 由本工具从共鸣页实际加载的样式表生成，不手改。
//
// resonance.html 加载原生样式的副本（resonance-native/，上游字节）和共鸣自己的样式（resonance*.css）。原生的薄荷绿、墨绿
// 写死在约五百条声明里，不只在设计变量里。这里按加载顺序读出这些样式表，把绿色系的色值换成海蓝系：
//   - 原生强调色（#4ed8af / #17f9b7 / #59f4ca … 及其透明度）换成同名设计变量 var(--mint-*)，由 resonance-wave.css 定为海蓝；
//   - 共鸣面板反复使用的墨绿底色和灰绿文字换成 --rw-* 变量；
//   - 其余绿黑底、灰绿线条按色相映射到深海蓝，亮度和透明度不变；
//   - 语义绿（2 费卡、治疗、生命条、属性提升）保留。
// 输出的每条规则都限定在 :where(html.rs-resonance-wave) 之下：只有共鸣页面的根节点带这个类，原版对局和工坊不受影响。
// :where() 不加特异度，色值层排在所有原样式之后，所以被换色的声明照原顺序覆盖原声明。为保持原来的层叠胜负，同一组件
// （去掉修饰符的 BEM 类）上同一类颜色属性的其余声明也按原文一并重写；用到绿色的自定义属性，所有声明都重写。
//
// usage: node tools/resonance/build-resonance-wave-theme.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const WAVE_REMAP_PATH = 'public/css/resonance-wave-remap.css';

/** The stylesheets resonance.html applies, in cascade order (an @import applied twice counts at its last place). */
export const WAVE_SOURCES = [
  'public/css/resonance-native/theme.css', 'public/css/resonance-native/components.css', 'public/css/resonance-native/devices.css',
  ...['game', 'game-shop', 'title', 'lobby', 'briefing', 'draft', 'result'].map((name) => `public/css/resonance-native/screens/${name}.css`),
  'public/css/resonance-entry.css', 'public/css/resonance-native/screens/game-panels.css', 'public/css/resonance-detail.css',
  'public/css/resonance-native/screens/loadout.css', 'public/css/resonance-codex.css', 'public/css/resonance-panels.css',
  'public/css/resonance/economy-panels.css', 'public/css/resonance.css',
];

// ---- colours -------------------------------------------------------------------------------------------------------

const ACCENTS = new Map([
  ['78,216,175', '--mint-500'], ['23,249,183', '--mint-glow'], ['89,244,202', '--mint-400'], ['53,216,180', '--mint-600'],
  ['42,158,127', '--mint-700'], ['20,84,67', '--mint-800'], ['13,44,36', '--mint-900'],
]);
/** The resonance panels' own green-black surfaces and grey-green text, as --rw-* tokens (values in resonance-wave.css). */
const NAMED = new Map([
  ['#d7e5dc', '--rw-ink'], ['#edf3ef', '--rw-ink-hi'], ['#b9c9c0', '--rw-ink-lo'], ['#c5d8ce', '--rw-ink-soft'],
  ['#101814', '--rw-deep'], ['#18251f', '--rw-deep-2'], ['#101512', '--rw-abyss'],
]);
/** Greens that mean something (heal, HP, a 2-cost card, a raised stat, the time-skill tag's ink): never recoloured. */
const SEMANTIC = new Set(['#0b1a0a']);

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const toHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const toRgb = ([h, s, l]) => {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => Math.round(clamp(v) * 255));
};
const hex2 = (n) => n.toString(16).padStart(2, '0');

/** Whether a colour is part of the original's mint / green-black look (and not a semantic green). */
export function isMintGreen(rgb) {
  const [h, s, l] = toHsl(rgb);
  if (h < 95 || h > 185 || s < .05 || l <= .015) return false;
  if (h < 150 && s >= .4 && l >= .25 && l <= .82) return false;   // heal / HP / 2-cost / raised-stat greens
  return true;
}

/** The sea-blue counterpart of a green: navy for the dark surfaces, slate for mid greys, pale blue-grey for light text,
 *  sea blue for the accents, aqua for the palest accents. Lightness and alpha are kept. */
export function seaBlueRgb(rgb) {
  const [, s, l] = toHsl(rgb);
  let next;
  if (s >= .4 && l >= .25) next = [l > .8 ? 193 : 199, clamp(s * 1.12 + .06), clamp(l + .02, 0, .97)];
  else if (l < .3) next = [208, clamp(s * 1.9 + .1, 0, .6), l * 1.08];
  else if (l < .6) next = [207, clamp(s * 1.6 + .08, 0, .45), clamp(l * 1.04)];
  else next = [205, clamp(s * 1.3 + .05, 0, .5), l];
  return toRgb(next);
}

const parseHex = (t) => { let x = t.slice(1); if (x.length <= 4) x = [...x].map((c) => c + c).join(''); return { rgb: [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)), a: x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1, alphaHex: x.length === 8 ? x.slice(6, 8) : null }; };
const COLOUR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/g;

/** Rewrite the green colours of one declaration value; returns null when it has none. */
export function remapValue(value) {
  let changed = false;
  const out = value.replace(COLOUR, (m, r, g, b, a) => {
    const lower = m.toLowerCase();
    if (SEMANTIC.has(lower)) return m;
    let rgb, alpha = 1, alphaHex = null;
    if (m[0] === '#') ({ rgb, a: alpha, alphaHex } = parseHex(m));
    else { rgb = [r, g, b].map(Number); if (a != null) alpha = a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a); }
    if (!isMintGreen(rgb)) return m;
    changed = true;
    const named = m[0] === '#' && NAMED.get(lower);
    if (named) return `var(${named})`;
    const accent = ACCENTS.get(rgb.join(','));
    if (accent) return alpha >= 1 ? `var(${accent})` : `color-mix(in srgb, var(${accent}) ${+(alpha * 100).toFixed(1)}%, transparent)`;
    const next = seaBlueRgb(rgb);
    if (m[0] === '#') return `#${next.map(hex2).join('')}${alphaHex ?? ''}`;
    return alpha >= 1 && !m.startsWith('rgba') ? `rgb(${next.join(', ')})` : `rgba(${next.join(', ')}, ${+alpha.toFixed(3)})`;
  });
  return changed ? out : null;
}

// ---- a small CSS reader (rules, @media / @supports blocks, @keyframes; comments dropped) ---------------------------

function parseBlocks(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  const readUntil = (stops) => {
    let out = '', depth = 0, quote = null;
    while (i < src.length) {
      const c = src[i];
      if (quote) { out += c; if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; } if (c === quote) quote = null; i++; continue; }
      if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
      if (c === '(') depth++; else if (c === ')') depth--;
      if (depth <= 0 && stops.includes(c)) return out;
      out += c; i++;
    }
    return out;
  };
  const list = () => {
    const items = [];
    while (i < src.length) {
      const head = readUntil('{};').trim();
      const c = src[i];
      if (c === '}') { i++; return items; }
      if (c === ';' || c === undefined) { i++; if (head) items.push({ type: 'statement', text: head }); continue; }
      i++; // '{'
      if (/^@(media|supports|container|layer)\b/.test(head)) items.push({ type: 'group', prelude: head, items: list() });
      else if (/^@(-webkit-)?keyframes\b/.test(head)) { const start = i; let depth = 1; while (i < src.length && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; } items.push({ type: 'keyframes', prelude: head, body: src.slice(start, i - 1) }); }
      else if (head.startsWith('@')) { let depth = 1; while (i < src.length && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; } }
      else { items.push({ type: 'rule', selector: head.replace(/\s+/g, ' '), decls: declarations(readUntil('}')) }); i++; }
    }
    return items;
  };
  return list();
}

function declarations(body) {
  const out = []; let cur = '', depth = 0, quote = null;
  const push = () => { const t = cur.trim(); cur = ''; if (!t) return; const k = t.indexOf(':'); if (k < 0) return; const prop = t.slice(0, k).trim(); let value = t.slice(k + 1).trim(); const important = /!important\s*$/i.test(value); if (important) value = value.replace(/\s*!important\s*$/i, ''); out.push({ prop, value, important }); };
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(') depth++; else if (c === ')') depth--;
    if (c === ';' && depth <= 0) { push(); continue; }
    cur += c;
  }
  push();
  return out;
}

const splitTop = (text, sep = ',') => { const out = []; let cur = '', depth = 0; for (const c of text) { if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; if (c === sep && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c; } if (cur.trim()) out.push(cur.trim()); return out; };

/** The property family a declaration competes in (shorthands and their longhands together). */
const family = (prop) => {
  if (prop.startsWith('--')) return prop;
  if (/^background/.test(prop)) return 'background';
  if (/^border/.test(prop)) return 'border';
  if (/^outline/.test(prop)) return 'outline';
  if (/^(color|fill|stroke|box-shadow|text-shadow|filter|accent-color|caret-color|text-decoration-color|scrollbar-color|-webkit-text-fill-color|mask|-webkit-mask)/.test(prop)) return prop.replace(/^-webkit-/, '');
  return null;
};

/** Component keys of a selector's subject: its classes without BEM modifiers or state classes (plus the pseudo-element). */
function subjectKeys(selector) {
  const parts = selector.replace(/\([^()]*\)/g, '()').split(/\s*[\s>+~]\s*/).filter(Boolean);
  const last = parts.at(-1) || '';
  const pseudo = (last.match(/::?(before|after|placeholder|marker|selection|-webkit-[a-z-]+)/) || [])[0]?.replace(/^:+/, '::') || '';
  const classes = [...last.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]).filter((c) => !/^(is|has|sp)-/.test(c)).map((c) => c.replace(/--.*$/, ''));
  if (!classes.length) { const tag = last.match(/^[a-z][a-z0-9-]*/)?.[0] || '*'; return [`<${tag}>${pseudo}`]; }
  return classes.map((c) => c + pseudo);
}

/** Scope a selector to the resonance root without changing its specificity. */
function scope(selector) {
  if (/^:root\b/.test(selector)) return selector.replace(/^:root/, ':root:where(.rs-resonance-wave)');
  if (/^html\b/.test(selector)) return selector.replace(/^html/, 'html:where(.rs-resonance-wave)');
  if (/^\.sp-[a-z-]+/.test(selector)) return `:where(html.rs-resonance-wave)${selector}`;
  return `:where(html.rs-resonance-wave) ${selector}`;
}

// ---- the build -----------------------------------------------------------------------------------------------------

export function buildWaveRemap(read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')) {
  const sheets = WAVE_SOURCES.map((file) => ({ file, items: parseBlocks(read(file)) }));
  // pass 1: which (component, family) pairs and custom properties carry a green somewhere
  const touched = new Set(), customs = new Set();
  const walk = (items, fn, media = []) => { for (const it of items) { if (it.type === 'group') walk(it.items, fn, [...media, it.prelude]); else fn(it, media); } };
  for (const { items } of sheets) walk(items, (it) => {
    if (it.type !== 'rule' || /^:root\b/.test(it.selector)) return;
    for (const d of it.decls) {
      if (!remapValue(d.value)) continue;
      const fam = family(d.prop); if (!fam) continue;
      if (fam.startsWith('--')) { customs.add(fam); continue; }
      for (const sel of splitTop(it.selector)) for (const key of subjectKeys(sel)) touched.add(`${key}|${fam}`);
    }
  });
  // pass 2: re-emit, in cascade order, every declaration that competes with a recoloured one
  const lines = [];
  let remapped = 0, kept = 0;
  for (const { file, items } of sheets) {
    const chunk = [];
    const emitItems = (list, indent) => {
      for (const it of list) {
        if (it.type === 'group') {
          const save = chunk.length;
          emitItems(it.items, indent + '  ');
          const body = chunk.splice(save);
          if (body.length) chunk.push(`${indent}${it.prelude} {`, ...body, `${indent}}`);
        } else if (it.type === 'keyframes') {
          const body = it.body.replace(/([^{};]+:)([^;{}]+)/g, (m, p, v) => { const r = remapValue(v); return r ? `${p}${r}` : m; });
          if (body !== it.body) { chunk.push(`${indent}${it.prelude} {${body.replace(/\s+/g, ' ').trim()}}`); remapped++; }
        } else if (it.type === 'rule' && !/^:root\b/.test(it.selector) && !/^(from|to|\d)/.test(it.selector)) {
          const sels = splitTop(it.selector);
          const own = [];
          for (const d of it.decls) {
            const fam = family(d.prop); if (!fam) continue;
            const next = remapValue(d.value);
            const competes = fam.startsWith('--') ? customs.has(fam) : sels.some((sel) => subjectKeys(sel).some((key) => touched.has(`${key}|${fam}`)));
            if (!next && !competes) continue;
            own.push(`${d.prop}: ${next ?? d.value}${d.important ? ' !important' : ''}`);
            if (next) remapped++; else kept++;
          }
          if (own.length) chunk.push(`${indent}${sels.map(scope).join(', ')} { ${own.join('; ')}; }`);
        }
      }
    };
    emitItems(items, '');
    if (chunk.length) lines.push(`/* ${file} */`, ...chunk);
  }
  const head = [
    '/* GENERATED by tools/resonance/build-resonance-wave-theme.mjs from the stylesheets resonance.html loads — do not edit by hand.',
    '   卫戍协议：共鸣「音浪」色值层：原生与共鸣样式中的薄荷绿、墨绿换成海蓝系（resonance-wave.css 定义变量）；',
    `   只在 html.rs-resonance-wave 下生效，:where() 不增加特异度。${remapped} declarations recoloured, ${kept} re-stated to keep their cascade order. */`,
  ];
  return `${[...head, ...lines].join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const css = buildWaveRemap();
  const target = path.join(ROOT, WAVE_REMAP_PATH);
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== css) { process.stderr.write(`${WAVE_REMAP_PATH} is out of date: run node tools/resonance/build-resonance-wave-theme.mjs\n`); process.exit(1); }
    process.stdout.write(`${WAVE_REMAP_PATH} is up to date\n`);
  } else {
    fs.writeFileSync(target, css);
    process.stdout.write(`${JSON.stringify({ written: target, bytes: Buffer.byteLength(css) })}\n`);
  }
}
