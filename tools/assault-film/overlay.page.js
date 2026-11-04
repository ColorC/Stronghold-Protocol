/* global window, Audio, document, innerWidth, innerHeight, addEventListener, requestAnimationFrame  */
// Page-side film overlay (injected before the page scripts run). Everything the viewer sees besides the game itself lives
// here, in the page, so the native tab capture records it in the same frames: a small arrow cursor that follows the real
// mouse events, ONE floating guide card anchored beside the element being explained (the game's own .tooltip look, 24 px body,
// a small triangle pointing at the element, no outline or mask on the element itself), narration playback with game-audio
// ducking, and a frame keep-alive.
(() => {
  if (window.__film) return;
  const state = { card: null, cur: null, queue: [], idleWaiters: [], playing: false, raf: 0, ducked: false, measure: null };
  const W = 520, GAP = 18, MARGIN = 16, LINE = 36, MAXLINES = 4;
  const flog = (ev, data) => { (window.__filmLog ||= []).push({ ev, t: Date.now(), ...data }); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // How many lines a text takes on the card (measured with a hidden copy of the card), so a part that would run past four
  // lines is shown as two or more cards in turn (switched by the voice progress), never shortened.
  const lines = (text, tag) => {
    const m = state.measure; m.querySelector('.film-card__body').textContent = text; m.querySelector('.film-card__tag').style.display = tag ? 'block' : 'none';
    return Math.round(m.querySelector('.film-card__body').getBoundingClientRect().height / LINE);
  };
  const splitChunks = (text, tag) => {
    if (lines(text, tag) <= MAXLINES) return [text];
    const sentences = text.match(/[^。；！？]+[。；！？]?/g) || [text];
    const pieces = [];
    for (const s of sentences) {
      if (lines(s, tag) <= MAXLINES) { pieces.push(s); continue; }
      const parts = s.match(/[^，、]+[，、]?/g) || [s]; let cur = '';
      for (const p of parts) { if (cur && lines(cur + p, tag) > MAXLINES) { pieces.push(cur); cur = p; } else cur += p; }
      if (cur) pieces.push(cur);
    }
    const out = []; let cur = '';
    for (const p of pieces) { if (cur && lines(cur + p, tag) > MAXLINES) { out.push(cur); cur = p; } else cur += p; }
    if (cur) out.push(cur);
    return out;
  };
  const API = window.__film = {
    // Queue a narration cue: spec { id, tag, parts:[{text, url, fallbackSec}], anchor, fallback, sides[], avoid[] }. Cues play one
    // after another; each part is one voice clip and one card (split further only when it would need more than four lines).
    enqueue(spec) { state.queue.push(spec); flog('cue-queued', { id: spec.id }); pump(); },
    // resolves when nothing is speaking and nothing is queued (the 0.6 s card tail is not waited for)
    whenIdle() { return !API.speaking() ? Promise.resolve(true) : new Promise((r) => state.idleWaiters.push(r)); },
    speaking() { return state.playing || state.queue.length > 0; },
    dismiss(now) {
      const card = state.card; if (!card) return;
      if (now) { card.style.display = 'none'; card.classList.remove('is-out'); return; }
      card.classList.add('is-out');
      setTimeout(() => { if (!state.cur) { card.style.display = 'none'; card.classList.remove('is-out'); } }, 150);
    },
    log: () => (window.__filmLog || []).slice(),
    async duck(on) {
      try {
        const { settingsStore } = await import('/js/ui/settings.js');
        const { audio } = await import('/js/audio.js');
        const base = settingsStore.get();
        const k = on ? 0.3 : 1;
        audio.setVolumes({ bgm: base.bgm * k, sfx: base.sfx * k, voice: base.voice * k, muted: base.muted });
        state.ducked = on;
      } catch { /* the game audio manager is optional for the overlay */ }
    },
  };

  // ---- effects that live only while a cue is spoken: a thin frame round what is explained, a smooth zoom ----
  const zs = state.zoom = { active: false, waiters: [], timer: 0 };
  const zoomDone = () => { zs.active = false; for (const w of zs.waiters.splice(0)) w(true); };
  API.zooming = () => zs.active;
  API.whenNoZoom = () => (zs.active ? new Promise((r) => zs.waiters.push(r)) : Promise.resolve(true));
  function startFx(cur) {
    const fx = cur.spec.fx; if (!fx) return;
    if (fx.frame) { // one anchor or a list of anchors: one thin frame each
      cur.frames = (Array.isArray(fx.frame) ? fx.frame : [fx.frame]).map((an) => {
        const el = document.createElement('div'); el.className = 'film-frame rr-block'; el.style.display = 'none'; document.body.append(el);
        return { an, el, rect: null };
      });
      flog('frame-start', { id: cur.spec.id, n: cur.frames.length });
    }
    if (fx.zoom) {
      const a = one(cur, fx.zoom.anchor), b = fx.zoom.also ? one(cur, fx.zoom.also) : null;
      const R = a && b ? union([a, b]) : (a || b);
      const e = appEl(); if (!R || !e) { flog('zoom-skip', { id: cur.spec.id }); return; }
      const W = innerWidth, H = innerHeight;
      const sc = Math.max(1, Math.min(fx.zoom.scale || 1.5, 1.6, 0.85 * W / Math.max(R.w, 1), 0.85 * H / Math.max(R.h, 1)));
      const tx = Math.max(W * (1 - sc), Math.min(0, W / 2 - sc * (R.x + R.w / 2))), ty = Math.max(H * (1 - sc), Math.min(0, H / 2 - sc * (R.y + R.h / 2)));
      clearTimeout(zs.timer); zs.active = true;
      e.style.transformOrigin = '0 0'; e.style.transition = 'transform .4s ease-in-out'; e.style.transform = 'translate(0px,0px) scale(1)';
      void e.offsetWidth; e.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`;
      cur.zoomed = true; flog('zoom-start', { id: cur.spec.id, scale: +sc.toFixed(2) });
      cur.zoomCap = setTimeout(() => { if (cur.zoomed) endZoom(cur); }, 6000); // a zoom is held at most 6 s even when the voice is longer
    }
  }
  function endFx(cur) {
    if (cur.frames) { for (const f of cur.frames) f.el.remove(); cur.frames = null; flog('frame-end', { id: cur.spec.id }); }
    endZoom(cur);
  }
  function endZoom(cur) {
    if (cur.zoomed) {
      clearTimeout(cur.zoomCap);
      const e = appEl(); cur.zoomed = false; flog('zoom-end', { id: cur.spec.id });
      if (e) { e.style.transform = 'translate(0px,0px) scale(1)'; zs.active = true; clearTimeout(zs.timer); zs.timer = setTimeout(() => { e.style.transition = ''; e.style.transform = ''; e.style.transformOrigin = ''; zoomDone(); }, 430); } else zoomDone();
    }
  }
  function frameTick(cur) {
    for (const f of cur.frames || []) {
      const el = f.el; let r = null; try { r = one(cur, f.an); } catch { r = null; }
      if (r) f.rect = r; else r = f.rect; // a unit missing for a frame (its 再部署) keeps its last frame
      if (!r) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
      if (el.style.display === 'none') { el.style.display = 'block'; el.classList.remove('is-in'); void el.offsetWidth; el.classList.add('is-in'); }
      const P = 5; el.style.transform = `translate(${Math.round(r.x - P)}px,${Math.round(r.y - P)}px)`; el.style.width = `${Math.round(r.w + 2 * P)}px`; el.style.height = `${Math.round(r.h + 2 * P)}px`;
    }
  }
  // the rects the card must keep off: its own frames (v5 rule) and the spec's avoid list (selectors, fixed rects, anchors)
  const avoidRects = (cur) => {
    const out = [];
    for (const f of cur.frames || []) if (f.rect) out.push({ x: f.rect.x - 5, y: f.rect.y - 5, w: f.rect.w + 10, h: f.rect.h + 10 });
    for (const s of cur.spec.avoid || []) {
      if (typeof s === 'string') { const e = document.querySelector(s); if (e) { const q = e.getBoundingClientRect(); if (q.width > 0) out.push({ x: q.left, y: q.top, w: q.width, h: q.height }); } }
      else if (s && s.kind) { let r = null; try { r = one(cur, s); } catch { r = null; } if (r) out.push(r); }
      else if (s) out.push(s);
    }
    return out;
  };
  API.cardRect = () => { const c = state.card; if (!c || c.style.display === 'none') return null; const q = c.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; };
  API.frameRects = () => (state.cur?.frames || []).map((f) => f.rect);
  // in-battle event watch: cues armed here start the instant the sim publishes the matching event (no polling, no fixed seconds)
  API.watch = (items) => {
    const s = window.__battleSession; const rt = s?.battle?.assaultRuntime; if (!rt) return false;
    if (state.watching === s) return true; state.watching = s; window.__filmHit = {};
    for (const type of [...new Set(items.map((i) => i.type))]) {
      rt.observe(type, 'film:' + type, ({ payload: p }) => {
        for (const it of items) {
          if (it.type !== type || window.__filmHit[it.id]) continue;
          const src = p.source?.ownerUnit ?? p.source, tgt = p.target, t = Number(s.battle.time) || 0;
          const ok = (!it.sourceUid || src?.uid === it.sourceUid) && (!it.targetUid || tgt?.uid === it.targetUid) && (!it.reason || p.reason === it.reason) && (!it.keyIncludes || String(p.sourceKey || '').includes(it.keyIncludes)) && t >= (it.minT || 0);
          if (!ok) continue;
          window.__filmHit[it.id] = { t }; flog('battle-hit', { id: it.id, bt: t });
          if (it.spec) API.enqueue(it.spec);
        }
      });
    }
    return true;
  };
  const notifyIdle = () => { if (!API.speaking()) for (const w of state.idleWaiters.splice(0)) w(true); };
  const pump = () => { if (state.playing || !state.queue.length) return; playCue(state.queue.shift()); };
  async function playCue(spec) {
    state.playing = true; API.duck(true);
    const card = state.card;
    API.dismiss(true);
    const cur = state.cur = { spec, side: null, last: null, refs: null, refsAt: 0, killed: false, size: null, since: performance.now(), usedFallback: false };
    card.querySelector('.film-card__tag').textContent = spec.tag || '';
    card.querySelector('.film-card__tag').style.display = spec.tag ? 'block' : 'none';
    card.style.display = 'block'; card.style.opacity = '0';
    cur.raf = requestAnimationFrame(function loop() { if (cur.killed) return; place(cur); frameTick(cur); cur.raf = requestAnimationFrame(loop); });
    startFx(cur);
    for (let k = 0; k < spec.parts.length; k++) {
      const part = spec.parts[k];
      const chunks = splitChunks(part.text, spec.tag), total = chunks.reduce((a, c) => a + c.length, 0);
      const show = (i) => { card.querySelector('.film-card__body').textContent = chunks[i]; cur.size = null; card.classList.remove('is-in'); void card.offsetWidth; card.classList.add('is-in'); };
      show(0); flog('card-start', { id: spec.id, part: k, chunks: chunks.length, chars: part.text.length });
      await new Promise((resolve) => {
        let shown = 0; let audio = null; let t0 = performance.now(); let done = false;
        const finish = (why) => { if (done) return; done = true; clearInterval(iv); flog('card-end', { id: spec.id, part: k, why }); resolve(); };
        const progress = (frac) => { let acc = 0; let idx = 0; for (let i = 0; i < chunks.length; i++) { if (frac >= acc / total) idx = i; acc += chunks[i].length; } if (idx !== shown) { shown = idx; show(idx); } };
        const iv = setInterval(() => {
          if (audio && isFinite(audio.duration) && audio.duration > 0) progress(audio.currentTime / audio.duration);
          else if (!part.url) progress((performance.now() - t0) / 1000 / part.fallbackSec);
        }, 80);
        if (!part.url) { setTimeout(() => finish('fallback'), part.fallbackSec * 1000); return; }
        audio = new Audio(part.url);
        audio.onplaying = () => { t0 = performance.now(); flog('audio-playing', { id: spec.id, part: k }); };
        audio.onended = () => finish('ended');
        audio.onerror = () => finish('error:' + (audio.error && audio.error.code));
        audio.play().catch((e) => finish('play:' + e.name));
      });
      if (k < spec.parts.length - 1) await wait(120);
    }
    endFx(cur);
    // the card stays 0.6 s after the voice ends, then fades out in 150 ms (a queued cue replaces it sooner)
    state.playing = false; notifyIdle();
    const next = state.queue.length > 0;
    if (!next) API.duck(false);
    await wait(next ? 350 : 600);
    if (state.queue.length) { cur.killed = true; state.cur = null; pump(); return; }
    if (state.cur === cur) { cur.killed = true; state.cur = null; API.dismiss(false); }
    notifyIdle();
  }

  // the game's own view / battle session / uid map, found through the Preact tree (read-only; used for screen positions)
  window.__fieldRefs = () => {
    let c; const seen = new Set();
    const walk = (v) => { if (!v || typeof v !== 'object' || seen.has(v) || c) return; seen.add(v); if (Array.isArray(v)) return v.forEach(walk); if (v.type?.name === 'NativeAssaultField') { c = v.__c; return; } walk(v.__k); walk(v._children); };
    walk(document.querySelector('#app'));
    const rs = (c?.__H?.__ ?? []).map((h) => h.__?.current);
    return { view: rs.find((x) => typeof x?.pieceAtClient === 'function'), session: rs.find((x) => typeof x?.battle?.snapshot === 'function'), map: rs.find((x) => typeof x?.numberOf === 'function') };
  };
  const union = (rs) => { const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  const appEl = () => document.querySelector('#app');
  const curXf = () => { const e = appEl(); const t = e && getComputedStyle(e).transform; if (!t || t === 'none') return { s: 1, tx: 0, ty: 0 }; const m = new DOMMatrix(t); return { s: m.a, tx: m.e, ty: m.f }; };
  // canvas-derived rects (the game adds canvas-local pixels to the canvas' client rect) are not scaled by a CSS zoom: map them
  const zoomFix = (r) => {
    const xf = curXf(); if (xf.s === 1 || !r) return r;
    const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; if (!cv) return r;
    const c = cv.getBoundingClientRect(); return { x: c.left + xf.s * (r.x - c.left), y: c.top + xf.s * (r.y - c.top), w: r.w * xf.s, h: r.h * xf.s };
  };
  const q2r = (q) => ({ x: q.left, y: q.top, w: q.width, h: q.height });
  const one = (cur, an) => {
    if (!an) return null;
    if (an.kind === 'sel') {
      const list = [...document.querySelectorAll(an.sel)].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && (!an.text || e.textContent.includes(an.text)); });
      if (an.all) { if (!list.length) return null; const rs = list.map((e) => q2r(e.getBoundingClientRect())); return union(rs); }
      const e = list[an.nth || 0]; return e ? q2r(e.getBoundingClientRect()) : null;
    }
    if (an.kind === 'union') { const rs = (an.parts || []).map((x) => one(cur, x)).filter(Boolean); return rs.length ? union(rs) : null; }
    if (an.kind === 'rect') return an.rect;
    if (an.kind === 'piece' || an.kind === 'unit' || an.kind === 'allies' || an.kind === 'pieceRing') {
      const now = performance.now();
      if (!cur.refs || now - cur.refsAt > 1500) { const f = window.__fieldRefs(); if (f?.view && f?.map) { cur.refs = f; cur.refsAt = now; } }
      if (!cur.refs) return null;
      const rect = (id) => { // prep views are keyed by the piece hash; battle views answer the unit's own uid string ('p5').
        // (v5: the old pN -> N fallback hit battle unit number N, which is a device such as 阻隔工事, not the operator)
        const n = typeof id === 'number' ? id : cur.refs.map.numberOf(id);
        const q = (n != null && cur.refs.view.pieceScreenRect(n)) || (typeof id === 'string' ? cur.refs.view.pieceScreenRect(id) : null);
        return q && q.width > 0 ? q2r(q) : null;
      };
      if (an.kind === 'allies') { const rs = (an.uids || []).map(rect).filter(Boolean); if (!rs.length) return null; return zoomFix(union(rs)); }
      if (an.kind === 'pieceRing') { // render/units.js _updateHud + _updateCycleRing: the HUD sits at the body top, the tier chip left of
        // the HP bar and the loop ring centred on the chip (diameter clamp(chipH*1.25, 18, 36))
        const r = rect(an.uid); if (!r) return null;
        const cl = (v, a, b) => Math.max(a, Math.min(b, v));
        const s = r.w / 0.7, bw = cl(s * 0.64, 24, 96), chipH = cl(s * 0.19, 11, 28), chipW = chipH * 64 / 44, D = cl(chipH * 1.25, 18, 36);
        const spH = Math.max(2, cl(s * 0.075, 3, 7) * 0.6);
        const rcx = r.x + r.w / 2 - bw / 2 - chipW / 2 - 1, rcy = r.y - 4 + spH / 2;
        return zoomFix(union([r, { x: rcx - D / 2 - 2, y: rcy - D / 2 - 2, w: D + 4, h: D + 4 }]));
      }
      return zoomFix(rect(an.kind === 'unit' ? an.n : an.uid));
    }
    return null;
  };
  const rectOf = (cur) => {
    try {
      const spec = cur.spec;
      const r = one(cur, spec.anchor); if (r) { cur.missSince = null; return (cur.last = r); }
      cur.missSince ??= performance.now();
      // a battle unit that left the field (or an element that is not on screen yet): keep the last place; with no place at all
      // for 0.8 s, use the stable fallback element
      if (!cur.last && performance.now() - cur.missSince > 800 && spec.fallback) { const f = one(cur, spec.fallback); if (f) { if (!cur.usedFallback) { cur.usedFallback = true; flog('anchor-fallback', { id: spec.id }); } return (cur.last = f); } }
    } catch { cur.refs = null; }
    return cur.last;
  };
  const hits = (a, b, pad = 6) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
  const place = (cur) => {
    const card = state.card; if (!card || cur.killed) return;
    const A = rectOf(cur); if (!A) return;
    if (!cur.size) { const q = card.getBoundingClientRect(); cur.size = { w: q.width, h: q.height }; }
    const { w, h } = cur.size;
    const avoid = avoidRects(cur);
    const acx = A.x + A.w / 2, acy = A.y + A.h / 2;
    // shift 0 = centred on the anchor; +1 / -1 = slid along that side so the card hangs past the anchor's end (the arrow
    // still points at it): tried when every centred place would cover a frame or an avoided rect
    const at = (side, shift = 0) => {
      let x, y;
      if (side === 'bottom') { x = acx - w / 2; y = A.y + A.h + GAP; }
      else if (side === 'top') { x = acx - w / 2; y = A.y - h - GAP; }
      else if (side === 'right') { x = A.x + A.w + GAP; y = acy - h / 2; }
      else { x = A.x - w - GAP; y = acy - h / 2; }
      if (shift && (side === 'top' || side === 'bottom')) x = shift > 0 ? acx - 30 : acx - w + 30;
      if (shift && (side === 'left' || side === 'right')) y = shift > 0 ? acy - 28 : acy - h + 28;
      const cx = Math.max(MARGIN, Math.min(innerWidth - w - MARGIN, x)), cy = Math.max(MARGIN, Math.min(innerHeight - h - MARGIN, y));
      return { side, shift, x: side === 'left' || side === 'right' ? x : cx, y: side === 'top' || side === 'bottom' ? y : cy };
    };
    const ok = (p) => p.x >= MARGIN - 1 && p.y >= MARGIN - 1 && p.x + w <= innerWidth - MARGIN + 1 && p.y + h <= innerHeight - MARGIN + 1 && !hits({ x: p.x, y: p.y, w, h }, A, 4) && !avoid.some((r) => hits({ x: p.x, y: p.y, w, h }, r));
    let pos = cur.side ? at(cur.side, cur.shift || 0) : null;
    if (!pos || !ok(pos)) {
      const order = [...new Set([...(cur.spec.sides || []), 'bottom', 'top', 'right', 'left'])];
      pos = null;
      for (const shift of [0, 1, -1]) { for (const s of order) { const p = at(s, shift); if (ok(p)) { pos = p; break; } } if (pos) break; }
      if (!pos) { pos = at((cur.spec.sides || ['bottom'])[0]); if (!cur.blocked) { cur.blocked = true; flog('card-no-free-side', { id: cur.spec.id }); } }
      cur.side = pos.side; cur.shift = pos.shift;
    }
    card.style.transform = `translate(${Math.round(pos.x)}px,${Math.round(pos.y)}px)`;
    card.dataset.side = pos.side;
    const ar = card.querySelector('.film-card__arrow');
    if (pos.side === 'bottom' || pos.side === 'top') ar.style.left = `${Math.round(Math.max(18, Math.min(w - 30, acx - pos.x - 7)))}px`, ar.style.top = '';
    else ar.style.top = `${Math.round(Math.max(16, Math.min(h - 28, acy - pos.y - 7)))}px`, ar.style.left = '';
    card.style.opacity = '';
  };

  const build = () => {
    const css = document.createElement('style'); css.className = 'rr-block';
    css.textContent = `
.film-cursor{position:fixed;left:0;top:0;width:16px;height:22px;z-index:2147483647;pointer-events:none;will-change:transform;transition:none;filter:drop-shadow(0 0 1px #000)}
.film-cursor svg{display:block;width:100%;height:100%;transform-origin:1.5px 1px;transition:transform .08s ease-out}
.film-cursor.is-down svg{transform:scale(.9)}
.film-card.tooltip{position:fixed;left:0;top:0;z-index:2147483640;display:none;box-sizing:border-box;width:${W}px;max-width:${W}px;padding:12px 18px 14px;
  font:500 24px/1.5 var(--font-cjk,sans-serif);color:var(--text-hi,#e6ede8);white-space:normal;text-wrap:pretty;text-align:left;opacity:0;transition:none;will-change:transform,opacity}
.film-card__tag{font:600 16px/1.2 var(--font-cjk,sans-serif);letter-spacing:.14em;color:var(--sp-bronze-hi,#d6ad76);margin:0 0 6px}
.film-card__body{margin:0}
.film-card__arrow{position:absolute;width:14px;height:14px;background:rgba(10,13,12,.97);border:0 solid var(--line-2,#2b3733);transform:rotate(45deg)}
.film-card[data-side=bottom] .film-card__arrow{top:-8px;border-top-width:1px;border-left-width:1px}
.film-card[data-side=top] .film-card__arrow{bottom:-8px;border-bottom-width:1px;border-right-width:1px}
.film-card[data-side=right] .film-card__arrow{left:-8px;border-bottom-width:1px;border-left-width:1px}
.film-card[data-side=left] .film-card__arrow{right:-8px;border-top-width:1px;border-right-width:1px}
.film-card.is-in{animation:film-in .18s ease-out both}
.film-card.is-out{animation:film-out .15s ease-in both}
@keyframes film-in{from{opacity:0;margin-top:6px}to{opacity:1;margin-top:0}}
@keyframes film-out{from{opacity:1}to{opacity:0}}
.film-frame{position:fixed;left:0;top:0;box-sizing:border-box;border:2px solid var(--sp-bronze-hi,#d6ad76);border-radius:6px;z-index:2147483630;pointer-events:none;will-change:transform}
.film-frame.is-in{animation:film-frame-in .15s ease-out both}
@keyframes film-frame-in{from{opacity:0}to{opacity:1}}
.film-pulse{position:fixed;right:0;bottom:0;width:2px;height:2px;z-index:2147483645;pointer-events:none;animation:film-pulse .0333s steps(1) infinite alternate}
@keyframes film-pulse{from{background:#00000003}to{background:#00000005}}
.ar-rec{display:none!important}
/* the game's temp-row notice is a full-screen box whose own rule says pointer-events:none, but .gm__hud > * wins and the box then
   swallows every canvas drop while a piece waits in the temp row (final boss prep): restore the rule's intent (nothing visible changes) */
.tempnote{pointer-events:none!important}`;
    document.head.append(css);
    const cur = document.createElement('div'); cur.className = 'film-cursor rr-block';
    cur.innerHTML = '<svg viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg"><path d="M2 1.5v23.2l5.6-5.4 4.1 9.2 3.3-1.5-4-8.9h8.1z" fill="#fff" stroke="#000" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    const x0 = Math.round(innerWidth * 0.62), y0 = Math.round(innerHeight * 0.66);
    cur.style.transform = `translate(${x0 - 1.5}px,${y0 - 1}px)`;
    const card = document.createElement('div'); card.className = 'film-card tooltip rr-block';
    card.innerHTML = '<div class="film-card__arrow"></div><div class="film-card__tag"></div><p class="film-card__body"></p>';
    const pulse = document.createElement('div'); pulse.className = 'film-pulse rr-block';
    const meas = card.cloneNode(true); meas.className = 'film-card tooltip film-measure rr-block';
    meas.style.cssText = 'display:block;visibility:hidden;position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
    document.body.append(cur, card, pulse, meas);
    state.card = card; state.measure = meas;
    const move = (e) => { cur.style.transform = `translate(${e.clientX - 1.5}px,${e.clientY - 1}px)`; };
    addEventListener('mousemove', move, true);
    addEventListener('mousedown', (e) => { move(e); cur.classList.add('is-down'); setTimeout(() => cur.classList.remove('is-down'), 80); }, true);
    addEventListener('mouseup', move, true);
  };
  if (document.body) build(); else addEventListener('DOMContentLoaded', build, { once: true });
})();
