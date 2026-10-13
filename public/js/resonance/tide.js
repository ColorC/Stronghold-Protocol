// 卫戍协议：共鸣「潮汐」的动效与声音（css/resonance-tide.css 是它的样式）。
//
// - 按下：按钮、商店卡、等级卡、盟约、选择卡、装备格按下时，从指尖散开一圈涟漪（460 ms）。
// - 合成、升星、领取策略或补给：在发生的位置散开三圈更大的涟漪（600 ms），配一声上扬的涟漪声。
// - 回合开始（ROUND_START，单人对局里是结算后进入休整）与战斗开始（COMBAT / 最终攻势 / 隐秘核心）：一道浪涌扫过全屏（520 / 600 ms）。
// - 声音：WebAudio 程序化合成，不用素材。点击是轻的水滴，合成和升星是上扬的涟漪，回合和战斗开始是一阵浪，出售和撤退是退潮。
//   作为 audio.js 的界面音色（setUiVoicing）接在音效通道上：跟随设置里的音效音量与静音，音频解锁（第一次点按）之前不发声，
//   比原版音效轻。没有对应音色的界面音（报错、倒计时、结算……）仍播放原版音效。
// 效果层 pointer-events: none，不改布局，不挡点击与拖放命中（elementFromPoint 会穿过它）；减少动态效果时只留短暂的静止淡出。

import { PHASE } from '../../../shared/constants.js';
import { audio } from '../audio.js';

const BATTLE_PHASES = new Set([PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);
const PRESS_TARGETS = 'button, [role="button"], a.btn, summary, .scard, .lvcard, .bond, .spcard, .rs-equipment-dock__item';
const MAX_RIPPLES = 10;
const MAX_VOICES = 10;

// ---- the effect layer ----------------------------------------------------------------------------------------------

let layer = null;
function fxLayer(doc) {
  if (layer?.isConnected) return layer;
  layer = doc.createElement('div');
  layer.className = 'tide-fx';
  layer.setAttribute('aria-hidden', 'true');
  doc.body.append(layer);
  return layer;
}

function spawn(doc, className, style, lifeMs) {
  try {
    const host = fxLayer(doc);
    while (host.childElementCount >= MAX_RIPPLES) host.firstElementChild.remove();
    const el = doc.createElement('span');
    el.className = className;
    for (const [k, v] of Object.entries(style)) el.style.setProperty(k, v);
    host.append(el);
    const done = () => el.remove();
    // the element's own animation ends it; a surge has none, its sweep (::before) does
    el.addEventListener('animationend', (e) => { if (e.target === el && (!e.pseudoElement || e.animationName === 'tide-surge')) done(); });
    setTimeout(done, lifeMs + 300);   // safety: reduced motion / a hidden tab may never end the animation
    return el;
  } catch { return null; }
}

/**
 * A ripple at a client point: 'tap' (a press), 'rise' (a merge, a star-up, a claim) or 'ebb' (a sale).
 * @param {number} x @param {number} y @param {'tap'|'rise'|'ebb'} [kind]
 */
export function ripple(x, y, kind = 'tap', doc = globalThis.document) {
  if (!doc?.body || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const cls = kind === 'rise' ? 'tide-ripple tide-ripple--rise' : kind === 'ebb' ? 'tide-ripple tide-ripple--ebb' : 'tide-ripple';
  return spawn(doc, cls, { '--x': `${Math.round(x)}px`, '--y': `${Math.round(y)}px` }, kind === 'rise' ? 600 : 460);
}

let lastSurge = 0;
/** One surge across the screen ('round' 520 ms, 'battle' 600 ms); never twice within a second. */
export function surge(kind = 'round', doc = globalThis.document) {
  if (!doc?.body) return null;
  const now = Date.now();
  if (now - lastSurge < 1000) return null;
  lastSurge = now;
  return spawn(doc, kind === 'battle' ? 'tide-surge tide-surge--battle' : 'tide-surge', {}, kind === 'battle' ? 600 : 520);
}

// ---- the sounds ----------------------------------------------------------------------------------------------------

/** UI sound name → tide voice. Names without a voice keep the manifest's sample. */
export const TIDE_VOICES = Object.freeze({
  click: 'drop', tab: 'drop', pick: 'drop', confirm: 'drop', drop: 'drop', equip: 'drop', buy: 'drop2', ready: 'drop2',
  sell: 'ebb', retreat: 'ebb', back: 'ebbSoft',
  // a round starts: ROUND_START's cue, or 休整 when the round opens straight into its prep (a solo run never shows ROUND_START)
  roundStart: 'wave', rest: 'wave', battleStart: 'surf',
  levelup: 'rise', merge: 'rise', starUp: 'rise', combine: 'rise', claim: 'rise',
});

let noiseBuffer = null;
function noise(ctx) {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 2.2);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

let voices = 0;
let lastDrop = 0;
let lastWave = 0;
/** Start a voice's sources at its own time (before it a gain still holds its default 1: a click); count it until its
 *  last source ends. */
function voice(ctx, sources, nodes, startAt, stopAt) {
  voices += 1;
  let left = sources.length;
  const end = () => { left -= 1; if (left > 0) return; voices = Math.max(0, voices - 1); for (const n of nodes) { try { n.disconnect(); } catch { /* ignore */ } } };
  for (const s of sources) { s.onended = end; s.start(startAt); s.stop(stopAt); }
}
const env = (param, t, peak, attack, release) => {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + release);
};

/** 水滴: a sine whose pitch jumps up as it fades (a drop's bubble), with a faint upper partial. */
function drop(ctx, out, t, { pitch = 1, gain = .12 } = {}) {
  const o = ctx.createOscillator(), p = ctx.createOscillator(), g = ctx.createGain(), pg = ctx.createGain();
  o.type = 'sine'; p.type = 'triangle';
  o.frequency.setValueAtTime(460 * pitch, t); o.frequency.exponentialRampToValueAtTime(1280 * pitch, t + .05);
  p.frequency.setValueAtTime(920 * pitch, t); p.frequency.exponentialRampToValueAtTime(2560 * pitch, t + .05);
  env(g.gain, t, gain, .005, .13); env(pg.gain, t, gain * .12, .005, .07);
  o.connect(g); p.connect(pg); g.connect(out); pg.connect(out);
  voice(ctx, [o, p], [g, pg], t, t + .2);
}

/** 涟漪上扬: three drops climbing (a triad) and a shimmering glide over them. */
function rise(ctx, out, t, { gain = .1 } = {}) {
  [1, 1.26, 1.5].forEach((pitch, i) => drop(ctx, out, t + i * .07, { pitch, gain: gain * (1 - i * .12) }));
  const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain(), trem = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(640, t); o.frequency.exponentialRampToValueAtTime(1500, t + .5);
  lfo.frequency.value = 11; depth.gain.value = .45; trem.gain.value = .55;
  lfo.connect(depth); depth.connect(trem.gain);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain * .5, t + .14); g.gain.exponentialRampToValueAtTime(0.0001, t + .6);
  o.connect(trem); trem.connect(g); g.connect(out);
  voice(ctx, [o, lfo], [g, depth, trem], t, t + .65);
}

/** 浪: band-passed noise swelling and breaking (the band sweeps up then settles), a foam hiss on the crest. */
function wave(ctx, out, t, { dur = 1.5, gain = .18, peak = 1100, swell = false } = {}) {
  const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise(ctx);
  bp.type = 'bandpass'; bp.Q.value = .8;
  bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(peak, t + dur * .38); bp.frequency.exponentialRampToValueAtTime(420, t + dur);
  lp.type = 'lowpass'; lp.frequency.value = 2600;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + dur * .32); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out);
  const foam = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), fg = ctx.createGain();
  foam.buffer = noise(ctx); foam.playbackRate.value = .9;
  hp.type = 'highpass'; hp.frequency.value = 2400;
  fg.gain.setValueAtTime(0.0001, t); fg.gain.linearRampToValueAtTime(gain * .22, t + dur * .4); fg.gain.exponentialRampToValueAtTime(0.0001, t + dur * .85);
  foam.connect(hp); hp.connect(fg); fg.connect(out);
  const sources = [src, foam], nodes = [bp, lp, g, hp, fg];
  if (swell) {   // the fight's wave has a low swell under it
    const o = ctx.createOscillator(), sg = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(72, t); o.frequency.exponentialRampToValueAtTime(48, t + dur * .7);
    sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(gain * .4, t + dur * .25); sg.gain.exponentialRampToValueAtTime(0.0001, t + dur * .8);
    o.connect(sg); sg.connect(out); sources.push(o); nodes.push(sg);
  }
  voice(ctx, sources, nodes, t, t + dur + .05);
}

/** 退潮: noise whose low-pass closes as it fades (the water draining back), and a bubble sinking under it. */
function ebb(ctx, out, t, { dur = 1, gain = .14 } = {}) {
  const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise(ctx);
  lp.type = 'lowpass'; lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(240, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + .07); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp); lp.connect(g); g.connect(out);
  const o = ctx.createOscillator(), og = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(330, t + .36);
  env(og.gain, t, gain * .32, .01, .34);
  o.connect(og); og.connect(out);
  voice(ctx, [src, o], [lp, g, og], t, t + dur + .05);
}

/**
 * The tide voicing for AudioManager.setUiVoicing: plays the cue of a UI sound name and returns true, or false when the
 * name has no tide voice (the manifest's sample plays).
 * @param {string} name @param {{ volume?: number }} o @param {{ ctx: AudioContext, destination: AudioNode }} out
 */
export function tideVoicing(name, o, { ctx, destination }) {
  const kind = TIDE_VOICES[name];
  if (!kind) return false;
  if (voices >= MAX_VOICES) return true;
  const level = Math.max(.2, Math.min(1, o?.volume ?? .9));   // the callers' own relative volume, kept
  // levels: each voice peaks 4–9 dB under the original sample it stands in for (offline renders at the default sfx
  // volume: click 0.52 → 0.18, merge 0.52 → 0.19, 休整 0.30 → 0.18, 开战 0.50 → 0.23, sell 0.25 → 0.10)
  const t = ctx.currentTime + .005;
  try {
    if (kind === 'drop' || kind === 'drop2') {
      const now = Date.now();
      if (now - lastDrop < 35) return true;
      lastDrop = now;
      drop(ctx, destination, t, { pitch: .94 + Math.random() * .12, gain: .36 * level });
      if (kind === 'drop2') drop(ctx, destination, t + .07, { pitch: 1.3, gain: .27 * level });
    } else if (kind === 'rise') rise(ctx, destination, t, { gain: .38 * level });
    else if (kind === 'wave') {   // ROUND_START then 休整 two seconds later: one wave for the round
      const now = Date.now();
      if (now - lastWave < 3000) return true;
      lastWave = now;
      wave(ctx, destination, t, { dur: 1.4, gain: .45, peak: 1000 });   // (休整 asks at 0.7: the wave keeps its own level)
    }
    else if (kind === 'surf') wave(ctx, destination, t, { dur: 1.8, gain: .57 * level, peak: 1300, swell: true });
    else if (kind === 'ebb') ebb(ctx, destination, t, { dur: 1, gain: .3 * level });
    else if (kind === 'ebbSoft') ebb(ctx, destination, t, { dur: .6, gain: .17 * level });
  } catch { /* a missing node type: stay silent */ }
  return true;
}

// ---- what changed in the session (pure: unit-tested) ---------------------------------------------------------------

const itemsOf = (state) => [
  ...(state?.inventory || []).map((item) => ({ item, owner: null })),
  ...(state?.pieces || []).flatMap((piece) => (piece.equipment || []).map((item) => ({ item, owner: piece }))),
];

/**
 * The tide cues between two resonance session states (m.private resonance.state): a star-up (a piece whose star rose, or
 * a new higher-star piece while copies of its operator vanished), a sale (a piece gone while the gold rose), a combine (two
 * or more items gone, a new one made) and a claim (a pending strategy / supply choice resolved).
 * @returns {Array<{ kind: 'starUp'|'sell'|'combine'|'claim', nativeUid?: number|string|null, itemUid?: number|string|null }>}
 */
export function tideChanges(prev, next) {
  if (!prev || !next || prev === next) return [];
  const out = [];
  const before = new Map((prev.pieces || []).map((p) => [String(p.uid), p]));
  const countOf = (state, operatorId) => (state.pieces || []).filter((p) => p.operatorId === operatorId).length;
  for (const piece of next.pieces || []) {
    const old = before.get(String(piece.uid));
    const rose = old ? Number(piece.star) > Number(old.star)
      : Number(piece.star) >= 2 && countOf(next, piece.operatorId) < countOf(prev, piece.operatorId) + 1
        && (prev.pieces || []).some((p) => p.operatorId === piece.operatorId && Number(p.star) < Number(piece.star));
    if (rose) out.push({ kind: 'starUp', nativeUid: piece.nativeUid ?? piece.uid });
  }
  // a sale: a piece gone for gold, not consumed by a merge
  const now = new Set((next.pieces || []).map((p) => String(p.uid)));
  const merged = new Set(out.map((cue) => (next.pieces || []).find((p) => (p.nativeUid ?? p.uid) === cue.nativeUid)?.operatorId));
  if (Number(next.gold) > Number(prev.gold)) {
    for (const piece of prev.pieces || []) if (!now.has(String(piece.uid)) && !merged.has(piece.operatorId)) out.push({ kind: 'sell', nativeUid: piece.nativeUid ?? piece.uid });
  }
  const had = new Set(itemsOf(prev).map(({ item }) => String(item.uid)));
  const has = new Set(itemsOf(next).map(({ item }) => String(item.uid)));
  const gone = [...had].filter((uid) => !has.has(uid)).length;
  const made = itemsOf(next).filter(({ item }) => !had.has(String(item.uid)));
  if (gone >= 2 && made.length >= 1) {
    const { item, owner } = made[0];
    out.push({ kind: 'combine', itemUid: item.nativeUid ?? item.uid, nativeUid: owner ? owner.nativeUid ?? owner.uid : null });
  }
  // a claim: a pending choice resolved (a strategy may open the next choice at once, so compare the choices, not their count)
  const open = new Set((next.pendingChoices || []).map((c) => String(c.uid)));
  if ((prev.pendingChoices || []).some((c) => !open.has(String(c.uid)))) out.push({ kind: 'claim' });
  return out;
}

// ---- wiring --------------------------------------------------------------------------------------------------------

const centre = (r) => (r && r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);

/** Where a cue lands on screen: the piece, the item's slot in the rail, else the middle of the field. */
function cueAt(cue, view, doc) {
  let at = null;
  try { if (cue.nativeUid != null) at = centre(view?.pieceScreenRect?.(Number(cue.nativeUid))); } catch { /* the view may be gone */ }
  if (!at && cue.itemUid != null) at = centre(doc.querySelector(`[data-item-uid="${String(cue.itemUid).replace(/["\\]/g, '')}"]`)?.getBoundingClientRect());
  if (!at && cue.kind === 'combine') at = centre(doc.querySelector('.rs-native-equipment-rail')?.getBoundingClientRect());
  return at || { x: innerWidth / 2, y: innerHeight * .45 };
}

/** The surge a phase change starts: 'round' entering ROUND_START (or a prep not preceded by it), 'battle' entering a fight. */
export function tidePhaseCue(prev, next) {
  if (prev == null || prev === next) return null;
  if (next === PHASE.ROUND_START) return 'round';
  // a solo run passes ROUND_START within one update: the round shows as its prep opening after the settlement
  if (next === PHASE.PREP && prev !== PHASE.ROUND_START) return 'round';
  return BATTLE_PHASES.has(next) ? 'battle' : null;
}

/** Play the cues between two session states: a rising ripple where each happened, and one rising sound. */
export function playTideChanges(prev, next, view, doc = globalThis.document) {
  const cues = tideChanges(prev, next);
  if (!cues.length || !doc) return cues;
  // a sold piece is still drawn now (the view takes the update after this effect): the ebb lands where it stood
  for (const cue of cues) if (cue.kind === 'sell') { const at = cueAt(cue, view, doc); ripple(at.x, at.y, 'ebb', doc); }
  const rising = cues.filter((cue) => cue.kind !== 'sell');
  if (rising.length) requestAnimationFrame(() => {   // after the update is drawn: the piece / slot is where it now is
    for (const cue of rising) { const at = cueAt(cue, view, doc); ripple(at.x, at.y, 'rise', doc); }
    audio.sfx(rising[0].kind, { volume: .9 });   // (a sale's ebb sound is the 出售 action's own)
  });
  return cues;
}

let installed = false;
/** Install the press ripples and the tide voicing (resonance main.js, once). */
export function installTide({ doc = globalThis.document } = {}) {
  if (installed || !doc) return;
  installed = true;
  audio.setUiVoicing?.(tideVoicing);   // (an audio.js from before the voicing hook: the samples play, nothing breaks)
  doc.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const el = e.target?.closest?.(PRESS_TARGETS);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('.tide-fx')) return;
    ripple(e.clientX, e.clientY, 'tap', doc);
  }, { capture: true, passive: true });
}
