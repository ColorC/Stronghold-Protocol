// The match screen's 共鸣·音浪 cues (js/resonance/resonanceWave.js): the wavefront when a round / a fight starts, the
// merge · combine · star-up · purchase · refresh · level · pact-tier · claim effects after each update, the lift and drop
// rings of a dragged piece, and the gold's rolling number.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { wavefront, wavefrontCue, playResonanceChanges, ring, lastPointer } from './resonanceWave.js';

const reduced = () => { try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; } };

/** @param {{ phase: string|null, state: any, view: any, catalog: any }} o the match phase, m.private resonance.state, the field view, the catalog */
export function useResonanceWaveCues({ phase, state, view, catalog }) {
  const seen = useRef({ phase: null, state: null });
  const live = useRef({ catalog });
  live.current.catalog = catalog;
  useEffect(() => {
    const cue = wavefrontCue(seen.current.phase, phase);
    seen.current.phase = phase;
    if (cue) wavefront(cue);
  }, [phase]);
  useEffect(() => {
    const prev = seen.current.state;
    seen.current.state = state;
    playResonanceChanges(prev, state, view, live.current.catalog);
  }, [state]);
  useEffect(() => {
    if (!view?.on) return undefined;
    const lift = view.on('pieceDragStart', (e) => {   // (its sound is the native 'pick', voiced as a knock)
      try { const r = view.pieceScreenRect?.(e?.uid); if (r) ring(r.left + r.width / 2, r.top + r.height / 2, 'in'); } catch { /* cosmetic */ }
    });
    const drop = view.on('pieceDragEnd', (e) => { const p = lastPointer(); if (e?.dropped && p.x != null) ring(p.x, p.y, 'tap'); });
    return () => { lift?.(); drop?.(); };
  }, [view]);
}

/** A number that rolls to its new value (the gold) instead of jumping; ease-out over `ms`. */
export function RollingNumber({ value, ms = 420 }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = Number(from.current), end = Number(value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end || reduced()) { from.current = value; setShown(value); return undefined; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), eased = 1 - (1 - k) ** 3;
      setShown(Math.round(start + (end - start) * eased));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = end;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = end; };
  }, [value]);
  return shown;
}
