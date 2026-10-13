// 卫戍协议：共鸣「音浪」的动效（css/resonance-wave.css 是它的样式，resonanceWaveSound.js 是它的声音）。
//
// 形象是声波：正弦、驻波、干涉纹、共振环、频谱条。单次动效 150～600 ms，效果层不接收点击（elementFromPoint 和拖放命中都穿过它），
// 减少动态效果时只留短暂的静止淡出。
// - 按下：从指尖散开一圈共振环；拖起干员时环向内收拢，放下时散开。
// - 购买：卡片上扫过一道频谱，金币数字滚动到新值（resonanceWaveCues.js RollingNumber）；刷新：频谱扫过整排商店卡。
// - 经验条平滑填充，升级时等级卡迸出一圈共振和放射状的频谱。
// - 合成：两件组件的“声音”（频率不同的正弦）向产物汇聚，对齐成一个音后响一圈共振环。
// - 升星：干员头顶的正弦振幅放大，再升一个八度飘起。
// - 盟约升档：盟约栏那一行有一道正弦穿过、图标响一圈脉冲，场上该盟约的干员脚下同时亮一圈共振环。
// - 领取策略或补给：一圈共振环；选项卡依次弹出、选中后其余淡出（CSS）。
// - 面板与详情卡：打开时波形从中线展开（CSS），关闭时波形收回中线。
// - 回合开始（单人对局里是结算后进入休整）与战斗开始：音浪从屏幕中间向两侧推开。

import { PHASE } from '../../../shared/constants.js';
import { audio } from '../audio.js';
import { resonanceVoicing } from './resonanceWaveSound.js';
import { nativeStripTier } from './pactTierState.js';
import { resonanceItemPactId } from './itemIconMap.js';

const BATTLE_PHASES = new Set([PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);
const PRESS_TARGETS = 'button, [role="button"], a.btn, summary, .scard, .lvcard, .bond, .spcard, .rs-equipment-dock__item';
const PANELS = ['dpanel', 'rs-native-resonance-panel'];
const MAX_EFFECTS = 16;

// ---- the effect layer ----------------------------------------------------------------------------------------------

let layer = null;
function fxLayer(doc) {
  if (layer?.isConnected) return layer;
  layer = doc.createElement('div');
  layer.className = 'rw-fx';
  layer.setAttribute('aria-hidden', 'true');
  doc.body.append(layer);
  return layer;
}

/** One effect element in the layer: removed when its own animation (or the one named) ends, or after `lifeMs`. */
function spawn(doc, className, vars, lifeMs, { tag = 'span', children = 0, child = 'i', childVars = null, endsOn = null } = {}) {
  if (!doc?.body) return null;
  try {
    const host = fxLayer(doc);
    while (host.childElementCount >= MAX_EFFECTS) host.firstElementChild.remove();
    const el = doc.createElement(tag);
    el.className = className;
    for (const [k, v] of Object.entries(vars || {})) el.style.setProperty(k, v);
    for (let i = 0; i < children; i++) {
      const c = doc.createElement(child);
      for (const [k, v] of Object.entries(childVars?.(i) || {})) c.style.setProperty(k, v);
      el.append(c);
    }
    host.append(el);
    const done = () => el.remove();
    el.addEventListener('animationend', (e) => { if (endsOn ? e.animationName === endsOn : e.target === el && !e.pseudoElement) done(); });
    setTimeout(done, lifeMs + 300);   // safety: reduced motion / a hidden tab may never end the animation
    return el;
  } catch { return null; }
}
const px = (n) => `${Math.round(n)}px`;
const at = (x, y) => ({ '--x': px(x), '--y': px(y) });
const box = (r) => ({ '--x': px(r.left), '--y': px(r.top), '--w': px(r.width), '--h': px(r.height) });

/** A resonance ring at a client point: 'tap' (a press, a drop), 'in' (a lift, a sale), 'lock' (a tone settling), 'pulse'. */
export function ring(x, y, kind = 'tap', doc = globalThis.document) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const cls = { tap: 'rw-ring', in: 'rw-ring rw-ring--in', lock: 'rw-ring rw-ring--lock', pulse: 'rw-ring rw-ring--pulse' }[kind] || 'rw-ring';
  return spawn(doc, cls, at(x, y), kind === 'lock' ? 600 : kind === 'pulse' ? 600 : 360);
}

/** Flattened rings under the feet of the given points ({ x, y, w }). */
export function footRings(points, doc = globalThis.document) {
  return points.map((p) => spawn(doc, 'rw-foot', { ...at(p.x, p.y), '--w': px(p.w || 70) }, 600));
}

/** A pact's row in the strip: a sine runs through it. */
export function rowPulse(rect, doc = globalThis.document) {
  return rect ? spawn(doc, 'rw-row', box(rect), 600, { endsOn: 'rw-row-sine' }) : null;
}

/** Spectrum bars sweeping across a rect (a purchase: one card, a refresh: the whole row). */
export function spectrum(rect, { bars = 12, step = 18, doc = globalThis.document } = {}) {
  if (!rect) return null;
  const heights = [.55, .8, .95, .7, 1, .85, .6, .9, .75, .5, .8, .65];
  return spawn(doc, 'rw-spectrum', { ...box(rect), '--step': `${step}ms` }, 420 + bars * step,
    { children: bars, childVars: (i) => ({ '--i': String(i), '--hgt': String(heights[i % heights.length]) }), endsOn: null });
}

/** A level gained: rings and twelve radial spikes. */
export function burst(x, y, doc = globalThis.document) {
  ring(x, y, 'pulse', doc);
  return spawn(doc, 'rw-burst', at(x, y), 600, { tag: 'span', children: 12, child: 'b', childVars: (i) => ({ '--a': `${i * 30}deg` }) });
}

/** A combine: the parts' voices converge on the product (`to`), settle into one tone, which rings. */
export function converge(from, to, doc = globalThis.document) {
  if (!to) return [];
  const out = from.slice(0, 3).map((f, i) => spawn(doc, 'rw-voice', { ...at(to.x, to.y), '--fx': px(f.x - to.x), '--fy': px(f.y - to.y), '--k': i % 2 ? '.62' : '1.55', '--period': i % 2 ? '14px' : '34px' }, 380));
  out.push(spawn(doc, 'rw-voice rw-voice--one', at(to.x, to.y), 600));
  out.push(ring(to.x, to.y, 'lock', doc));
  return out;
}

/** A star-up: the tone swells and rises an octave over the piece. */
export function octave(x, y, doc = globalThis.document) {
  ring(x, y + 28, 'lock', doc);
  return spawn(doc, 'rw-octave', at(x, y), 600, { endsOn: 'rw-rise' });
}

/** A panel closing: its waveform folds into its centre line. */
export function collapse(rect, doc = globalThis.document) {
  return rect && rect.width > 0 ? spawn(doc, 'rw-collapse', { '--x': px(rect.left), '--y': px(rect.top + rect.height / 2), '--w': px(rect.width) }, 220) : null;
}

let lastFront = 0;
/** A sound wave pushing out from the middle to both sides ('round' 500 ms, 'battle' 600 ms); never twice within a second. */
export function wavefront(kind = 'round', doc = globalThis.document) {
  const now = Date.now();
  if (now - lastFront < 1000) return null;
  lastFront = now;
  return spawn(doc, kind === 'battle' ? 'rw-wavefront rw-wavefront--battle' : 'rw-wavefront', {}, kind === 'battle' ? 600 : 500,
    { tag: 'div', children: 1, endsOn: 'rw-front-right' });
}

// ---- what changed in the session (pure: unit-tested) ---------------------------------------------------------------

const itemsOf = (state) => [
  ...(state?.inventory || []).map((item) => ({ item, owner: null })),
  ...(state?.pieces || []).flatMap((piece) => (piece.equipment || []).map((item) => ({ item, owner: piece }))),
];
const nid = (row) => row?.nativeUid ?? row?.uid;

/** The pact tier of each pact in a session state (the strip's own rule: pactTierState.nativeStripTier). */
export function pactTiers(state, catalog) {
  const out = {};
  for (const [id, pact] of Object.entries(state?.pacts || {})) out[id] = nativeStripTier(pact, catalog?.pacts?.[id]?.levels || []).tier;
  return out;
}

/** The deployed pieces that count for a pact: their operator's pacts, granted pacts and the emblems they wear. */
export function pactMembers(state, catalog, pactId) {
  return (state?.pieces || []).filter((piece) => piece.row !== null && piece.row !== undefined && (
    (catalog?.operators?.[piece.operatorId]?.pacts || []).includes(pactId) || (piece.extraPacts || []).includes(pactId)
    || (piece.equipment || []).some((item) => resonanceItemPactId(catalog, item.itemId) === pactId)));
}

/**
 * The cues between two resonance session states (m.private resonance.state):
 *   starUp   a piece whose star rose, or a new higher-star piece while copies of its operator vanished
 *   sell     a piece gone while the gold rose
 *   combine  two or more items gone, a new one made (itemUid, the owner piece, the parts' uids)
 *   buy      a shop offer taken (its index); refresh: most offers replaced
 *   levelUp  the level rose
 *   pactUp   a pact reached a higher tier (pactId, tier)
 *   claim    a pending strategy / supply choice resolved
 * @returns {Array<object>}
 */
export function resonanceChanges(prev, next, catalog = null) {
  if (!prev || !next || prev === next) return [];
  const out = [];
  const before = new Map((prev.pieces || []).map((p) => [String(p.uid), p]));
  const countOf = (state, operatorId) => (state.pieces || []).filter((p) => p.operatorId === operatorId).length;
  for (const piece of next.pieces || []) {
    const old = before.get(String(piece.uid));
    const rose = old ? Number(piece.star) > Number(old.star)
      : Number(piece.star) >= 2 && countOf(next, piece.operatorId) < countOf(prev, piece.operatorId) + 1
        && (prev.pieces || []).some((p) => p.operatorId === piece.operatorId && Number(p.star) < Number(piece.star));
    if (rose) out.push({ kind: 'starUp', nativeUid: nid(piece) });
  }
  const now = new Set((next.pieces || []).map((p) => String(p.uid)));
  const merged = new Set(out.map((cue) => (next.pieces || []).find((p) => nid(p) === cue.nativeUid)?.operatorId));
  if (Number(next.gold) > Number(prev.gold)) {
    for (const piece of prev.pieces || []) if (!now.has(String(piece.uid)) && !merged.has(piece.operatorId)) out.push({ kind: 'sell', nativeUid: nid(piece) });
  }
  const had = new Map(itemsOf(prev).map(({ item }) => [String(item.uid), item]));
  const has = new Set(itemsOf(next).map(({ item }) => String(item.uid)));
  const gone = [...had.keys()].filter((uid) => !has.has(uid));
  const made = itemsOf(next).filter(({ item }) => !had.has(String(item.uid)));
  if (gone.length >= 2 && made.length >= 1) {
    const { item, owner } = made[0];
    out.push({ kind: 'combine', itemUid: nid(item), nativeUid: owner ? nid(owner) : null, parts: gone.map((uid) => nid(had.get(uid))) });
  }
  const offersBefore = prev.shop?.offers || [], offersNow = next.shop?.offers || [];
  const replaced = offersNow.filter((o, i) => o?.uid !== offersBefore[i]?.uid).length;
  if (offersNow.length && replaced >= Math.min(3, offersNow.length) && offersNow.filter((o) => o?.operatorId).length >= replaced) out.push({ kind: 'refresh' });
  else offersNow.forEach((o, i) => { if (offersBefore[i]?.operatorId && !o?.operatorId && Number(next.gold) <= Number(prev.gold)) out.push({ kind: 'buy', index: i }); });
  if (Number(next.level) > Number(prev.level)) out.push({ kind: 'levelUp', level: Number(next.level) });
  if (catalog) {
    const was = pactTiers(prev, catalog), is = pactTiers(next, catalog);
    for (const [id, tier] of Object.entries(is)) if (tier > (was[id] || 0)) out.push({ kind: 'pactUp', pactId: id, tier });
  }
  // a claim: a pending choice resolved (a strategy may open the next choice at once, so compare the choices, not their count)
  const open = new Set((next.pendingChoices || []).map((c) => String(c.uid)));
  if ((prev.pendingChoices || []).some((c) => !open.has(String(c.uid)))) out.push({ kind: 'claim' });
  return out;
}

/** The surge a phase change starts: 'round' entering ROUND_START (or a prep not preceded by it), 'battle' entering a fight. */
export function wavefrontCue(prev, next) {
  if (prev == null || prev === next) return null;
  if (next === PHASE.ROUND_START) return 'round';
  // a solo run passes ROUND_START within one update: the round shows as its prep opening after the settlement
  if (next === PHASE.PREP && prev !== PHASE.ROUND_START) return 'round';
  return BATTLE_PHASES.has(next) ? 'battle' : null;
}

/** The sound of a set of cues: the most telling one; a pact tier rising under another cue follows it a moment later. */
const SOUND_ORDER = ['starUp', 'combine', 'pactUp', 'levelUp', 'claim'];
export function cueSounds(cues) {
  const top = SOUND_ORDER.map((kind) => cues.find((c) => c.kind === kind)).find(Boolean);
  if (!top) return [];
  const pact = cues.filter((c) => c.kind === 'pactUp').sort((x, y) => y.tier - x.tier)[0];
  const sound = (c) => (c.kind === 'pactUp' ? { name: 'pactTier', tier: c.tier } : { name: c.kind === 'levelUp' ? 'levelBurst' : c.kind, tier: null });
  if (top.kind === 'pactUp') return [{ ...sound(pact), delay: 0 }];
  return pact ? [{ ...sound(top), delay: 0 }, { ...sound(pact), delay: 240 }] : [{ ...sound(top), delay: 0 }];
}

// ---- where things are on screen ------------------------------------------------------------------------------------

const rects = new Map();   // 'i:<item uid>' / 'p:<piece uid>' / 'o:<offer index>' → the last rect seen (a part about to vanish)
const centre = (r) => (r && r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
const plain = (r) => (r ? { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height } : null);

/** Remember where the items, pieces and shop cards are now (the next update may remove them). */
export function rememberRects(view, doc, state) {
  try {
    for (const el of doc.querySelectorAll('[data-item-uid]')) rects.set(`i:${el.getAttribute('data-item-uid')}`, plain(el.getBoundingClientRect()));
    for (const piece of state?.pieces || []) { const r = view?.pieceScreenRect?.(Number(nid(piece))); if (r) rects.set(`p:${nid(piece)}`, plain(r)); }
    [...doc.querySelectorAll('.shopbar__cards .scard')].forEach((el, i) => rects.set(`o:${i}`, plain(el.getBoundingClientRect())));
    if (rects.size > 400) rects.clear();
  } catch { /* the view may be gone */ }
}
const pieceRect = (view, uid) => { try { return uid != null ? plain(view?.pieceScreenRect?.(Number(uid))) : null; } catch { return null; } };
const slotRect = (doc, uid) => (uid != null ? plain(doc.querySelector(`[data-item-uid="${String(uid).replace(/["\\]/g, '')}"]`)?.getBoundingClientRect()) : null);
const elRect = (doc, sel) => plain(doc.querySelector(sel)?.getBoundingClientRect());
const middle = () => ({ x: innerWidth / 2, y: innerHeight * .45 });

/** Draw the cues between two session states and play their sound (the match screen calls this after each update). */
export function playResonanceChanges(prev, next, view, catalog, doc = globalThis.document) {
  const cues = resonanceChanges(prev, next, catalog);
  if (!doc) return cues;
  // a sold piece is still drawn now (the view takes the update after this effect): its ring draws in where it stood
  for (const cue of cues) if (cue.kind === 'sell') { const c = centre(pieceRect(view, cue.nativeUid) || rects.get(`p:${cue.nativeUid}`)); if (c) ring(c.x, c.y, 'in', doc); }
  const buy = cues.find((c) => c.kind === 'buy'), parts = new Map();
  for (const cue of cues) if (cue.kind === 'combine') parts.set(cue, cue.parts.map((uid) => centre(rects.get(`i:${uid}`))).filter(Boolean));
  const buyRect = buy ? rects.get(`o:${buy.index}`) : null, shopRow = cues.some((c) => c.kind === 'refresh') ? elRect(doc, '.shopbar__cards') : null;
  requestAnimationFrame(() => {   // after the update is drawn: the piece / slot is where it now is
    for (const cue of cues) {
      if (cue.kind === 'starUp') { const r = pieceRect(view, cue.nativeUid); const c = centre(r) || middle(); octave(c.x, r ? r.top + 6 : c.y, doc); }
      else if (cue.kind === 'combine') { const to = centre(cue.nativeUid != null ? pieceRect(view, cue.nativeUid) : slotRect(doc, cue.itemUid)) || centre(slotRect(doc, cue.itemUid)) || centre(elRect(doc, '.rs-native-equipment-rail')) || middle(); converge(parts.get(cue) || [], to, doc); }
      else if (cue.kind === 'buy') spectrum(buyRect || elRect(doc, `.shopbar__cards .scard:nth-child(${cue.index + 1})`), { doc });
      else if (cue.kind === 'refresh') spectrum(shopRow || elRect(doc, '.shopbar__cards'), { bars: 30, step: 10, doc });
      else if (cue.kind === 'levelUp') { const c = centre(elRect(doc, '.rs-native-level-card')) || middle(); burst(c.x, c.y, doc); }
      else if (cue.kind === 'pactUp') setTimeout(() => {   // a moment after the drop: the new member stands on its tile
        const row = elRect(doc, `.gm__bond-list .bslot[data-bond="${String(cue.pactId).replace(/["\\]/g, '')}"]`);
        if (row) { rowPulse(row, doc); const disc = centre(elRect(doc, `.gm__bond-list .bslot[data-bond="${String(cue.pactId).replace(/["\\]/g, '')}"] .bond__core`)) || { x: row.left + 20, y: row.top + row.height / 2 }; ring(disc.x, disc.y, 'pulse', doc); }
        footRings(pactMembers(next, catalog, cue.pactId).map((p) => pieceRect(view, nid(p))).filter(Boolean).map((r) => ({ x: r.left + r.width / 2, y: r.bottom - 6, w: Math.max(80, Math.min(140, r.width * 1.4)) })), doc);
      }, 120);
      else if (cue.kind === 'claim') { const c = middle(); ring(c.x, c.y, 'pulse', doc); }
    }
    for (const s of cueSounds(cues)) setTimeout(() => audio.sfx(s.name, { volume: .9, tier: s.tier }), s.delay);
    rememberRects(view, doc, next);
  });
  return cues;
}

// ---- wiring --------------------------------------------------------------------------------------------------------

const pointer = { x: null, y: null };
/** Where the pointer last was (a drop's ring lands there). */
export const lastPointer = () => ({ ...pointer });

let installed = false;
/** Install the press rings, the panel-close waveforms and the resonance voicing (resonance main.js, once). */
export function installResonanceWave({ doc = globalThis.document } = {}) {
  if (installed || !doc) return;
  installed = true;
  audio.setUiVoicing?.(resonanceVoicing);   // (an audio.js from before the voicing hook: the samples play, nothing breaks)
  doc.addEventListener('pointerdown', (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY;
    if (e.button > 0) return;
    const el = e.target?.closest?.(PRESS_TARGETS);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('.rw-fx')) return;
    ring(e.clientX, e.clientY, 'tap', doc);
  }, { capture: true, passive: true });
  doc.addEventListener('pointerup', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { capture: true, passive: true });
  // a panel or a detail card closing: its last place is remembered when it opens and when it settles
  const seen = new WeakMap();
  const isPanel = (n) => n?.nodeType === 1 && PANELS.some((c) => n.classList?.contains(c));
  const note = (n) => { const r = plain(n.getBoundingClientRect()); if (r?.width) seen.set(n, r); };
  try {
    new MutationObserver((records) => {
      for (const rec of records) {
        for (const n of rec.addedNodes) if (isPanel(n)) { requestAnimationFrame(() => note(n)); setTimeout(() => n.isConnected && note(n), 320); }
        for (const n of rec.removedNodes) if (isPanel(n) && seen.has(n)) collapse(seen.get(n), doc);
      }
    }).observe(doc.body, { childList: true, subtree: true });
  } catch { /* no MutationObserver: panels just close */ }
}
