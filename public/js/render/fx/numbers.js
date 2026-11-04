// public/js/render/fx/numbers.js — FxSystem damage numbers and screen-space labels.
// Installed on FxSystem.prototype by ./system.js (a method container: never instantiated; `this` is the effect system).

import { DMG_STYLE, HIT_TINT, dmgStyleKey } from '../style.js';
import { camKey } from './camera.js';
import { clamp, easeOut } from './limits.js';
import {
  ARC_TILES, COLUMN_LINES, POP_T, TIER_LOOK, canMerge, critPunchAt, driftAt, laneOrder, maxTier,
  numberChars, numberLook, numberText, numberTier, pathKind, riseAt, travelDir,
  POPUP_ROWS, CRIT_ALPHA, CRIT_SCALE, CRIT_Y, CRIT_FONT_SCALE, lerpKeys, popupWaypoints, popupPosition, popupAlpha,
} from '../dmgNumbers.js';

const MAX_NUMBERS = 90;

const NUM_RISE = 0.45;        // tiles a damage number rises over the shared rise curve, then it stays

const NUM_LIFE = 0.9;         // seconds a number lives (a merged running total lives longer, ≤ NUM_MAX_LIFE)

const NUM_MAX_LIFE = 1.8;

const NUM_FADE_T = 0.27;      // fade-out at the end of its life

const NUM_LINE_EM = 0.95;     // vertical room of one line of digits, in em of the 24 px bitmap font

const NUM_MAX_LINES = 5;      // a number starts at most this many lines above the head

const NUM_DIGIT_EM = 0.66;    // advance of one digit of the damage font, in em (Bender 700: 0.56–0.66, the widest kept)

const NUM_GAP_PX = 7;         // horizontal gap between two numbers side by side (never read as one number)

const NUM_PER_TARGET = 4;     // live numbers per unit (then hits join / the oldest fades)

const NUM_CROWD = 6;          // more live numbers than this around a spot → shorter lives there
const BASE_TEXT_SCALE = 0.8;

/** Screen scale of a number's text (24 px font) at `s` px per tile. */
const numScale = (s, style) => clamp(s / 115, 0.42, 1.05) * (style === 'heal' ? 0.9 : 1);

export class FxNumbers {
  // ---- hits / numbers -----------------------------------------------------------------------------------------

  /** b.ev 'dmg' visual: glow + sparks in the hit colour; a melee blow (atk 'none' just before) adds its slash. */
  hit(view, amount, type, srcView) {
    if (!view) return;
    const style = dmgStyleKey(type);
    const p = this._chest(view);
    const px = p.x, py = p.y, s = p.s;
    const tint = HIT_TINT[style] || 0xffffff;
    const big = view.maxHp > 0 && amount >= view.maxHp * 0.18;
    const melee = !!srcView && this._slashAt === srcView.id;
    this.particle('glow', px, py, { tint, life: 0.18, s0: (s / 128) * (big ? 1.0 : 0.6), s1: (s / 128) * (big ? 1.5 : 0.9), a0: 0.9, a1: 0 });
    if (melee) { this._slashAt = null; this._slash(view, srcView, px, py, s, style, big); }
    this.burst(px, py, s, big ? 8 : melee ? 6 : 4, tint, { speed: melee ? 2.8 : 2.4, size: big ? 0.6 : 0.46 });
    view.onHit?.();
  }

  splashRing(view, type) {
    if (!view || (this._lastRing && this.time - this._lastRing <= 0.08)) return;
    this._lastRing = this.time;
    this.ring(view.x, view.y, view.z || 0, 0.1, 1.1, HIT_TINT[dmgStyleKey(type)] || 0xffffff, 0.3);
  }

  /**
   * Melee blow on `view` by `src`: a crescent swept across the victim, bulging along the blow (attacker → victim on
   * screen, a little random tilt / mirroring), in the hit colour with a white-hot inner stroke.
   */
  _slash(view, src, px, py, s, style, big) {
    const q = this._chest(src, this._q);
    const dx = px - q.x, dy = py - q.y;
    const ang = Math.abs(dx) + Math.abs(dy) > 1 ? Math.atan2(dy, dx) : (src.x > view.x ? Math.PI : 0);
    const rot = ang + Math.PI / 2 + (Math.random() - 0.5) * 0.9;
    const flip = Math.random() < 0.5 ? -1 : 1;
    const k = big ? 1.25 : 1;
    const a = this.particle('slash', px, py, { tint: style === 'phys' ? 0xffe2b0 : HIT_TINT[style] || 0xffffff, life: 0.2, s0: (s / 128) * 1.05 * k, s1: (s / 128) * 1.3 * k, a0: 1, a1: 0, rot });
    a.sx = flip;
    const b = this.particle('slash', px, py, { tint: 0xffffff, life: 0.12, s0: (s / 128) * 0.8 * k, s1: (s / 128) * 1.0 * k, a0: 0.85, a1: 0, rot });
    b.sx = flip;
  }

  // Upstream's optional red integer/MISS path stays separate from this mode's existing per-hit popup rows.
  officialNumber(view, amount, style) {
    if (!view) return;
    const miss = style === 'miss', n = miss ? 0 : Math.round(amount);
    if (!miss && (!Number.isFinite(n) || n < 0)) return;
    const cam = this.ctx.cam();
    const base = (view.z || 0) + (view.hover || 0) + (view._headTiles || 1.2) * 0.8;
    const a = cam.project(view.x, view.y, base, this._p), ax = a.x, ay = a.y, s = a.s > 0 ? a.s : 100;
    const pxPerZ = ay - cam.project(view.x, view.y, base + 1, this._q).y;
    const tile = pxPerZ > 1e-3 ? pxPerZ : s;
    const maxNums = this.load >= 2 ? MAX_NUMBERS >> 1 : MAX_NUMBERS;
    while (this.nums.length >= maxNums) this._releaseNum(this.nums.shift());
    const t = this._takeNum(style);
    t.text.visible = true; t.text.alpha = 1; t.text.text = miss ? 'MISS' : String(n);
    Object.assign(t, {
      unit: view, style, value: n, life: 0, end: NUM_LIFE, born: this.time, delay: 0, crit: false, label: null,
      official: true, fading: false, ox: (Math.random() - 0.5) * 0.7 * tile, oy: -(0.15 + Math.random() * 0.4) * tile,
      x0: view.x, y0: view.y, z0: base, risePx: NUM_RISE * tile * 0.5,
      _tx: ax, _y: ay, _sc: numScale(s, style), _animScale: 1.35, _animY: 0, _alpha: 1,
    });
    this.nums.push(t);
  }

  healBurst(view, amount) {
    if (!view) return;
    const p = this._chest(view);
    const s = p.s;
    this.particle('glow', p.x, p.y, { tint: 0x62f08a, life: 0.3, s0: (s / 128) * 0.5, s1: (s / 128) * 0.9, a0: 0.55, a1: 0 });
    for (let i = 0; i < (this.quality === 'low' ? 1 : 3); i++) {
      this.particle('plus', p.x + (Math.random() - 0.5) * s * 0.5, p.y + (Math.random() - 0.2) * s * 0.3, {
        tint: 0x7dffa8, vy: -s * 0.9, life: 0.7, s0: s / 64 * 0.32, s1: s / 64 * 0.2, a0: 0.95, a1: 0, fadeIn: 0.08,
      });
    }
  }

  /**
   * A damage / heal number over `view` (see the header). Layout in screen space, against EVERY live number (the
   * '41509' / '201625' overlaps were numbers of neighbouring units standing side by side):
   *   * merge: a same-style hit on the same unit within its tier's merge window (and while it is still
   *     young) adds to it — a running total that re-pops and lives a little longer;
   *   * cap: a unit shows at most NUM_PER_TARGET numbers; past it the hit joins the unit's youngest same-style number,
   *     else the unit's oldest number fades out at once;
   *   * lanes: the new number takes the lowest free slot of its unit's lanes (centre, then beside the head, 0 / ±1 / ±2
   *     lane widths), stacking upwards at most NUM_MAX_LINES lines; a slot is free when no live number of any unit
   *     overlaps it now or later (a younger number rises faster: below an older one it must keep that one's rise so
   *     far as a margin) with a gap wide enough that two numbers never read as one;
   *   * crowded (> NUM_CROWD numbers near it): it lives shorter; a pair that still ends up overlapping (units walking
   *     into each other) resolves by fading the older one quickly (_updateNums).
   */
  number(view, amount, style, options) {
    const opt = options && typeof options === 'object' ? options : { big: !!options };
    const label = opt.label ? String(opt.label) : null;
    const n = label ? 0 : Math.round(amount);
    if (!view || !(label || n > 0)) return;
    const now = this.time;
    const cam = this.ctx.cam();
    const base = (view.z || 0) + (view.hover || 0) + (view._headTiles || 1.2) * 0.8;
    const a = cam.project(view.x, view.y, base, this._p);
    const ax = a.x, ay = a.y, s = a.s > 0 ? a.s : 100;
    const pxPerZ = ay - cam.project(view.x, view.y, base + 1, this._q).y;
    const risePx = NUM_RISE * (pxPerZ > 1e-3 ? pxPerZ : s * 0.5);
    const crit = !label && style !== 'heal' && (!!opt.crit || this._critPending(view));
    const src = opt.src && opt.src !== view && !opt.src.destroyed && Number.isFinite(opt.src.x) && Number.isFinite(opt.src.y) ? opt.src : null;
    const dir = src && !label ? travelDir(cam.project(src.x, src.y, base, this._q).x, ax, s * 0.12) : 0;
    // the live boxes only change between frames: laid out once per frame / camera, not once per hit (a heavy AoE
    // lands dozens of hits in one frame — re-projecting every live number for each was O(hits × numbers))
    this._layoutNumsOnce(cam);
    // 1. merge into this unit's running total of the same style
    let mine = 0, youngest = null, oldest = null;
    for (const t of this.nums) {
      if (t.unit !== view || t.fading || t.official) continue;
      mine++;
      if (!oldest || t.born < oldest.born) oldest = t;
      if (t.style === style && !t.crit && !t.label && (!youngest || t.born > youngest.born)) youngest = t;
    }
    if (!label && !crit) {
      const merge = canMerge(youngest, style, false, now) || mine >= NUM_PER_TARGET ? youngest : null;
      if (merge && this._growFits(merge, n, opt.big)) { this._addToNum(merge, n, opt.big, true); return; }
    }
    if (mine >= NUM_PER_TARGET && oldest) this._fadeNum(oldest, 0.1);
    const tier = label ? 'chip' : maxTier(numberTier(n, view.maxHp, style, crit), opt.big ? 'heavy' : 'chip');
    const look = numberLook(tier, crit, !!label);
    const kind = label ? 'rise' : pathKind(style, dir, crit);
    const drift = kind === 'arc' ? ARC_TILES * s * dir : 0;
    const sc = numScale(s, style) * look.scale;
    const w = numberChars(n, style, crit, label) * NUM_DIGIT_EM * 24 * sc * look.pop + NUM_GAP_PX + Math.abs(drift);
    const h = 24 * NUM_LINE_EM * sc * look.pop;
    const lane = Math.max(w, 24 * NUM_DIGIT_EM * sc * 3.2) * 0.62;
    view._numSeq = (view._numSeq | 0) + 1;
    let best = null;
    for (const k of laneOrder(dir, view._numSeq)) {
      const cx = ax + k * lane;
      const cy = this._numSlotPx(cx + drift / 2, ay, w, h, risePx);
      const lift = ay - cy;
      if (lift <= h * COLUMN_LINES) { best = { cx, cy, lift }; break; }
      if (!best || lift < best.lift - 0.5) best = { cx, cy, lift };
    }
    const cap = h * NUM_MAX_LINES;
    let { cx, cy } = best;
    if (ay - cy > cap) {
      // over capacity (a knot of units under fire): join this unit's latest same-style total when it fits, else take
      // the capped spot and drop whatever is there (crowded numbers give way at once)
      let same = null;
      if (!label && !crit) for (const t of this.nums) if (t.unit === view && t.style === style && !t.fading && !t.crit && !t.label && (!same || t.born > same.born)) same = t;
      if (same && this._growFits(same, n, opt.big)) { this._addToNum(same, n, opt.big, false); return; }
      // (released at once, not merely ended: they would vanish before the next render anyway, and as obstacles they
      // made every further hit of the same frame search a crowd that is no longer there — a knot under AoE)
      cx = ax; cy = ay - cap;
      const mx = cx + drift / 2;
      let keep = 0;
      for (const t of this.nums) {
        if (Math.abs(t._x - mx) < (t._w + w) / 2 && t._y > cy - h && t._y - t._h < cy) { this._releaseNum(t); continue; }
        this.nums[keep++] = t;
      }
      this.nums.length = keep;
    }
    // 3. crowding: numbers around this spot → a shorter life for everyone new here
    let near = 0;
    for (const t of this.nums) if (!t.fading && Math.abs(t._x - cx) < 150 && Math.abs(t._y - cy) < 110) near++;
    const life = near >= NUM_CROWD ? look.life * 0.62 : look.life;
    const maxNums = this.load >= 2 ? MAX_NUMBERS >> 1 : MAX_NUMBERS;
    while (this.nums.length >= maxNums) this._releaseNum(this.nums.shift());
    const t = this._takeNum(style);
    t.text.visible = true;
    t.text.alpha = look.alpha;
    t.text.text = label || numberText(n, style, crit);
    Object.assign(t, {
      unit: view, style, value: n, life: 0, end: life, born: now, lastHit: now, pop: 1, big: !!opt.big, fading: false,
      tier, tier0: tier, look, crit, label, kind, drift, src,
      ox: cx - ax, oy: cy - ay, x0: view.x, y0: view.y, z0: base, risePx,
      _tx: cx, _x: cx + drift / 2, _y: cy, _w: w, _h: h, _sc: sc, _pop: look.pop,
    });
    this.nums.push(t);
  }

  _addToNum(t, n, big, extend) {
    t.value += n;
    t.big = t.big || !!big;
    t.tier = maxTier(t.tier, maxTier(numberTier(t.value, t.unit?.maxHp, t.style), t.big ? 'heavy' : 'chip'));
    t.look = numberLook(t.tier, false);
    t.text.text = numberText(t.value, t.style, false);
    t.pop = 1;
    t.lastHit = this.time;
    if (extend) {
      const life = Math.max(t.look.life, NUM_LIFE);
      t.end = Math.min(t.life + life * 0.75, Math.max(t.end, t.life + life * 0.6), NUM_MAX_LIFE);
    }
    this._sizeNum(t);
    t._w += Math.abs(t.drift * (1 - driftAt(t.kind, t.life)));
  }

  _critPending(view) {
    const marks = this._critMarks;
    if (!marks?.length) return false;
    for (let i = marks.length - 1; i >= 0; i--) {
      const mark = marks[i];
      if (mark.t !== this.time) { marks.splice(i, 1); continue; }
      const at = Number.isFinite(mark.x) && Number.isFinite(mark.y);
      if (at ? Math.hypot(view.x - mark.x, view.y - mark.y) <= 0.75 : mark.id === view.id) {
        marks.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  _onCrit(x, y, id) {
    const at = Number.isFinite(x) && Number.isFinite(y);
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const t = this.nums[i], unit = t.unit;
      if (!unit || t.born !== this.time || t.crit || t.label || t.style === 'heal' || t.fading) continue;
      if (at ? Math.hypot(unit.x - x, unit.y - y) > 0.75 : unit.id !== id) continue;
      this.nums.splice(i, 1);
      this._releaseNum(t);
      this.number(unit, t.value, t.style, { crit: true, src: t.src, big: t.big });
      return;
    }
    (this._critMarks || (this._critMarks = [])).push({ x, y, id, t: this.time });
  }

  /** Whether a merged number's grown text still fits among its neighbours (else a new number is made). */
  _growFits(t, add, big) {
    const tier = maxTier(t.tier, maxTier(numberTier(t.value + add, t.unit?.maxHp, t.style), t.big || big ? 'heavy' : 'chip'));
    const look = numberLook(tier, false);
    const sc = numScale(t._s || 100, t.style) * look.scale;
    const w = numberChars(t.value + add, t.style, false) * NUM_DIGIT_EM * 24 * sc * look.pop + NUM_GAP_PX + Math.abs(t.drift * (1 - driftAt(t.kind, t.life)));
    const h = 24 * NUM_LINE_EM * sc * look.pop;
    for (const o of this.nums) {
      if (o === t || o.fading) continue;
      if (Math.abs(o._x - t._x) < (o._w + w) / 2 && o._y - o._h < t._y && t._y - h < o._y) return false;
    }
    return true;
  }

  /**
   * Lowest (largest screen y) bottom for a number of size w×h centred at x, starting at y0, clear of every live number
   * now and later: above one it must sit on its top; below one it must leave that one's rise so far as a margin
   * (the new number rises faster and would catch up).
   */
  _numSlotPx(x, y0, w, h, risePx) {
    let y = y0;
    for (let pass = 0; pass <= this.nums.length; pass++) {
      let moved = false;
      for (const t of this.nums) {
        if (t.fading && t.text.alpha < 0.3) continue;   // almost gone
        if (Math.abs(t._x - x) >= (t._w + w) / 2) continue;
        const top = t._y - t._h, bottom = t._y;
        const risen = t.risePx * riseAt(t.life);
        if (y <= top) continue;                                   // entirely above it (bottom at or over its top)
        if (y - h >= bottom + risen) continue;                    // below it, for good
        y = top;
        moved = true;
      }
      if (!moved) break;
    }
    return y;
  }

  /** Screen boxes of the live numbers (their current anchor, rise and size) → t._x, t._y (bottom), t._w, t._h. */
  _layoutNums(cam) {
    const p = this._p;
    for (const t of this.nums) {
      const u = t.unit;
      if (u && !u.destroyed) { t.x0 = u.x; t.y0 = u.y; }
      cam.project(t.x0, t.y0, t.z0, p);
      t._s = p.s;
      const d = driftAt(t.kind, t.life);
      const rest = t.drift * (1 - d);
      t._tx = p.x + t.ox + t.drift * d;
      t._x = t._tx + rest / 2;
      t._y = p.y + t.oy - t.risePx * riseAt(t.life);
      this._sizeNum(t);
      t._w += Math.abs(rest);
    }
    this._laidAt = this.time;
    this._laidCam = cam;
    this._laidKey = camKey(cam);
  }

  /** `_layoutNums` unless the boxes are already current: same frame (fx time) and the same camera framing. */
  _layoutNumsOnce(cam) {
    if (this._laidAt === this.time && this._laidCam === cam && this._laidKey === camKey(cam)) return;
    this._layoutNums(cam);
  }

  /** A number's box size from its value, style, pop and the scale of its last layout (t._s px per tile). */
  _sizeNum(t) {
    const look = t.look || TIER_LOOK.normal;
    const sc = numScale(t._s || 100, t.style) * look.scale;
    const f = t.crit ? critPunchAt(t.life) : t.pop;
    const pop = 1 + f * (look.pop - 1);
    t._w = numberChars(t.value, t.style, t.crit, t.label) * NUM_DIGIT_EM * 24 * sc * pop + NUM_GAP_PX;
    t._h = 24 * NUM_LINE_EM * sc * pop;
    t._sc = sc;
    t._pop = pop;
  }

  _fadeNum(t, within) {
    if (t.fading) return;
    t.fading = true;
    t.fadeFrom = t.text.alpha;
    t.end = Math.min(t.end, t.life + within);
    t.fadeT0 = t.life;
  }

  _takeNum(style) {
    const P = this.P;
    const font = DMG_STYLE[style]?.font || DMG_STYLE.phys.font;
    const pool = this._numPools || (this._numPools = new Map());
    const list = pool.get(font);
    let t = list && list.length ? list.pop() : null;
    if (!t) {
      const text = new P.BitmapText('0', { fontName: font, fontSize: 24, align: 'center' });
      text.anchor.set(0.5, 1);
      this.ctx.layers.text.addChild(text);
      t = { text, font };
    }
    return t;
  }

  _releaseNum(t) {
    t.text.visible = false;
    t.unit = null;
    const pool = this._numPools || (this._numPools = new Map());
    let list = pool.get(t.font);
    if (!list) pool.set(t.font, list = []);
    if (list.length < 30) list.push(t); else t.text.destroy();
  }

  _updateNums(dt) {
    const cam = this.ctx.cam();
    let w = 0;
    for (const t of this.nums) {
      t.life += dt;
      if (t.life >= t.end) { this._releaseNum(t); continue; }
      t.pop = Math.max(0, t.pop - dt / POP_T);
      this.nums[w++] = t;
    }
    this.nums.length = w;
    this._layoutNums(cam);
    // a pair still overlapping (their units walked into each other): the older one gives way
    const L = this.nums;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.fading) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.fading) continue;
        if (Math.abs(a._x - b._x) < (a._w + b._w) / 2 - NUM_GAP_PX * 0.5 && Math.abs((a._y - a._h / 2) - (b._y - b._h / 2)) < (a._h + b._h) / 2 * 0.9) {
          this._fadeNum(a.born <= b.born ? a : b, 0.06);
          if (a.fading) break;
        }
      }
    }
    for (const t of L) {
      const tx = t.text;
      tx.scale.set(t._sc * t._pop);
      tx.position.set(t._tx, t._y);
      const rest = t.look ? t.look.alpha : 1;
      let alpha = rest;
      const left = t.end - t.life;
      if (t.fading) alpha = (t.fadeFrom ?? rest) * clamp(left / Math.max(0.01, t.end - t.fadeT0), 0, 1);
      else if (left < NUM_FADE_T) alpha = rest * left / NUM_FADE_T;
      tx.alpha = alpha;
    }
  }

  /** Floating label ('!', '+10') at a screen point, using the damage-number pool. */
  numberAt(x, y, label, tint, life = 0.8) {
    const P = this.P;
    if (this.labels.length >= 24) { const o = this.labels.shift(); o.t.destroy(); }
    const t = new P.BitmapText(String(label), { fontName: DMG_STYLE.true.font, fontSize: 26, align: 'center' });
    t.anchor.set(0.5, 1);
    t.tint = tint;
    t.position.set(x, y);
    this.ctx.layers.text.addChild(t);
    this.labels.push({ t, y0: y, life: 0, max: life });
  }

  /**
   * Floating WORD label at a screen point (the assault 「再部署！」 cue): a canvas Text — the damage bitmap fonts only
   * carry digits / '+-×!' / MISS, no glyphs for words — with the same rise-and-fade as numberAt's labels.
   */
  textAt(x, y, label, tint, life = 0.8) {
    const P = this.P;
    if (this.labels.length >= 24) { const o = this.labels.shift(); o.t.destroy(); }
    const t = new P.Text(String(label), { fontFamily: 'Bender, Oxanium, sans-serif', fontSize: 20, fontWeight: '700', fill: '#ffffff', stroke: '#0b0f0e', strokeThickness: 4 });
    t.anchor.set(0.5, 1);
    t.tint = tint;
    t.position.set(x, y);
    this.ctx.layers.text.addChild(t);
    this.labels.push({ t, y0: y, life: 0, max: life });
  }

  _updateLabels(dt) {
    let w = 0;
    for (const l of this.labels) {
      l.life += dt;
      if (l.life >= l.max) { l.t.destroy(); continue; }
      const k = l.life / l.max;
      l.t.position.y = l.y0 - 22 * easeOut(k);
      l.t.alpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      l.t.scale.set(k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : 1.1 - Math.min(0.1, k - 0.12));
      this.labels[w++] = l;
    }
    this.labels.length = w;
  }
}

// The iGame popup rows replace the prior heuristic stack/merge motion while retaining FxSystem.number's public API.
const nativeNumber = function(view, amount, style, options) {
  const opt = options && typeof options === 'object' ? options : { big: !!options };
  const label = opt.label ? String(opt.label) : null, n = label ? 0 : Math.round(amount);
  if (!view || !(label || n > 0)) return;
  const crit = !label && style !== 'heal' && (!!opt.crit || this._critPending(view));
  const src = opt.src && opt.src !== view && !opt.src.destroyed && Number.isFinite(opt.src.x) && Number.isFinite(opt.src.y) ? opt.src : null;
  const base = (view.z || 0) + (view.hover || 0) + (view._headTiles || 1.2) * 0.8;
  const cam = this.ctx.cam(), p = cam.project(view.x, view.y, base, this._p);
  const kind = label || style === 'heal' ? 'heal' : crit ? 'crit' : 'damage';
  const dir = src && !label ? travelDir(cam.project(src.x, src.y, base, this._q).x, p.x, (p.s || 100) * 0.12) : 1;
  view._numSeq = (view._numSeq | 0) + 1;
  if (view._popupAt !== this.time) { view._popupAt = this.time; view._popupCounts = Object.create(null); }
  const count = (view._popupCounts[kind] || 0) % 3; view._popupCounts[kind] = count + 1;
  const delay = label ? count * 0.15 : kind === 'crit' ? count * 0.09 : kind === 'heal' ? count * 0.03 : count * 0.07;
  const path = popupWaypoints(kind, (view._numSeq + (Number(view.id) || 0) * 31) >>> 0);
  const t = this._takeNum(style);
  t.text.visible = true; t.text.alpha = 1; t.text.text = label || numberText(n, style, crit);
  Object.assign(t, { unit: view, style, value: n, life: 0, end: path.total + delay, born: this.time, delay, path, direction: dir, crit, label, src, kind, official: false, rowScale: POPUP_ROWS[kind].scale?.[1] ?? 1, x0: view.x, y0: view.y, z0: base, _tx: p.x, _y: p.y });
  this.nums.push(t);
};
const nativeLayoutNums = function(cam) {
  const p = this._p;
  for (const t of this.nums) {
    if (t.unit && !t.unit.destroyed) { t.x0 = t.unit.x; t.y0 = t.unit.y; }
    if (t.official) {
      cam.project(t.x0, t.y0, t.z0, p);
      t._tx = p.x + t.ox; t._y = p.y + t.oy - t.risePx * easeOut(Math.min(1, t.life / 0.65));
      t._sc = numScale(p.s > 0 ? p.s : 100, t.style);
      t._animScale = 1 + Math.max(0, 1 - t.life / 0.1) * 0.35; t._animY = 0;
      t._alpha = clamp((t.end - t.life) / NUM_FADE_T, 0, 1);
      continue;
    }
    cam.project(t.x0 + t.path.ox, t.y0 + t.path.oy, t.z0, p);
    const elapsed = Math.max(0, t.life - t.delay), [x, y] = popupPosition(t.path, elapsed, t.direction);
    const ui = (p.s > 0 ? p.s : 100) / 56;
    t._tx = p.x + x * ui; t._y = p.y - y * ui;
    t._sc = clamp(p.s / 115, 0.42, 1.05) * BASE_TEXT_SCALE * t.rowScale * (t.crit ? CRIT_FONT_SCALE : 1);
    t._animScale = t.crit ? lerpKeys(CRIT_SCALE, elapsed) : 1;
    t._animY = t.crit ? lerpKeys(CRIT_Y, elapsed) * ui : 0;
    t._alpha = popupAlpha(t.crit, elapsed);
  }
};
const nativeUpdateNums = function(dt) {
  const cam = this.ctx.cam(); let w = 0;
  for (const t of this.nums) { t.life += dt; if (t.life >= t.end) { this._releaseNum(t); continue; } this.nums[w++] = t; }
  this.nums.length = w; nativeLayoutNums.call(this, cam);
  for (const t of this.nums) {
    t.text.scale.set(t._sc * t._animScale);
    t.text.position.set(t._tx, t._y - t._animY);
    t.text.alpha = t.life < t.delay ? 0 : t._alpha;
  }
};
FxNumbers.prototype.number = nativeNumber;
FxNumbers.prototype._layoutNums = nativeLayoutNums;
FxNumbers.prototype._updateNums = nativeUpdateNums;
