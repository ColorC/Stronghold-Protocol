// The match screen's 潮汐 cues (js/resonance/tide.js): a surge when a round / a fight starts, a rising ripple and its
// sound where a merge, a star-up or a claim happened.
import { useEffect, useRef } from '../../vendor/hooks.module.js';
import { surge, tidePhaseCue, playTideChanges } from './tide.js';

/** @param {{ phase: string|null, state: any, view: any }} o the match phase, m.private resonance.state, the field view */
export function useTideCues({ phase, state, view }) {
  const seen = useRef({ phase: null, state: null });
  useEffect(() => {
    const cue = tidePhaseCue(seen.current.phase, phase);
    seen.current.phase = phase;
    if (cue) surge(cue);
  }, [phase]);
  useEffect(() => {
    const prev = seen.current.state;
    seen.current.state = state;
    playTideChanges(prev, state, view);
  }, [state]);
}
