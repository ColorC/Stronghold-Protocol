// render/dmgNumbers.js — the rules of the battle damage numbers (docs/damage-numbers.md), pure: no PIXI, no clock, no
// Math.random. render/fx.js (FxSystem.number) and the 2D fallback field (ui/fallbackField.js) both read them.
//
//   tier       how much the hit matters to the unit it lands on: its share of the target's max HP (chip < 3 % ≤ normal
//              < 12 % ≤ heavy < 30 % ≤ massive). A merged running total is re-tiered from its total. Element gauge
//              fills (not HP) and heals stop at 'normal'; a crit is at least 'heavy'.
//   look       per tier: text scale, birth pop, life, opacity, merge window (chip hits merge longer and stay quiet)
//   path       'arc' — a hit with a known attacker: drifts away from the attacker on screen while it rises;
//              'rise' — no attacker known (area, damage over time, element gauge), heals, labels: straight up;
//              'crit' — no drift: a punch in place (igame-tft anui_font_battle_critical) while it rises.
//              Every path rises the same curve (easeOut over RISE_T): a younger number never catches up with an older
//              one in its column (the layout's margin rule, render/fx.js _numSlotPx).
//   lanes      a number starts on its unit's head; when that spot is taken it stacks up in its own column, then spills
//              into the next lane on the side it drifts to (no attacker: alternating by the unit's hit count)

export const TIERS = Object.freeze(['chip', 'normal', 'heavy', 'massive']);
/** Lower bounds of the tiers above 'chip', as a share of the target's max HP. */
export const TIER_SHARE = Object.freeze({ normal: 0.03, heavy: 0.12, massive: 0.3 });
/** Max HP assumed when the target has none (devices, a view without a snapshot yet). */
export const REF_HP = 1000;

/**
 * Per tier: `scale` of the text (× the camera scale), `pop` = birth scale (decays to 1 over POP_T), `life` (real s),
 * `alpha` (resting opacity), `merge` = the window (real s) in which a next same-style hit joins the running total.
 */
export const TIER_LOOK = Object.freeze({
  chip: Object.freeze({ scale: 0.78, pop: 1.08, life: 0.7, alpha: 0.8, merge: 0.5 }),
  normal: Object.freeze({ scale: 1, pop: 1.3, life: 0.9, alpha: 1, merge: 0.3 }),
  heavy: Object.freeze({ scale: 1.28, pop: 1.5, life: 1.1, alpha: 1, merge: 0.3 }),
  massive: Object.freeze({ scale: 1.55, pop: 1.65, life: 1.3, alpha: 1, merge: 0.3 }),
});
/** A crit: × text scale on top of its tier, birth punch, life (it never merges). */
export const CRIT = Object.freeze({ scale: 1.12, pop: 1.9, life: 1.2 });
/** A label ('MISS'): a quiet chip-sized word that rises. */
export const LABEL = Object.freeze({ scale: 0.72, pop: 1.1, life: 0.75, alpha: 0.9, merge: 0 });
/** Real s of the birth pop of a normal number (a crit follows CRIT_PUNCH). */
export const POP_T = 1 / 6;
/**
 * Crit punch, as the pop factor by real s (scale = 1 + f × (CRIT.pop − 1)): igame-tft anui_font_battle_critical —
 * huge → undershoot → settle (3.5 → 0.73 → 0.96 → 1 in 0.25 s there), compressed to start at CRIT.pop (1.9 → 0.85 →
 * 1.05 → 1) so the layout can reserve its box.
 */
export const CRIT_PUNCH = Object.freeze([[0, 1], [0.07, -0.17], [0.11, 0.06], [0.2, 0]]);

/** The tier of a hit of `amount` on a unit of `maxHp` (style: render/style.js dmgStyleKey). */
export function numberTier(amount, maxHp, style = 'phys', crit = false) {
  const hp = maxHp > 0 && Number.isFinite(maxHp) ? maxHp : REF_HP;
  const share = amount > 0 ? amount / hp : 0;
  let i = share >= TIER_SHARE.massive ? 3 : share >= TIER_SHARE.heavy ? 2 : share >= TIER_SHARE.normal ? 1 : 0;
  if (style === 'heal' || style === 'elem') i = Math.min(i, 1);
  if (crit) i = Math.max(i, 2);
  return TIERS[i];
}

/** The higher of two tiers. */
export function maxTier(a, b) {
  return TIERS[Math.max(TIERS.indexOf(a), TIERS.indexOf(b), 0)];
}

/** The look of a number: its tier's, a crit's / a label's overrides on top. */
export function numberLook(tier, crit, label = false) {
  if (label) return LABEL;
  const L = TIER_LOOK[tier] || TIER_LOOK.normal;
  if (!crit) return L;
  return { scale: L.scale * CRIT.scale, pop: CRIT.pop, life: Math.max(L.life, CRIT.life), alpha: 1, merge: 0 };
}

/** The path kind of a number (see header): `dir` = its drift side (-1 / 1, 0 = no attacker known). */
export function pathKind(style, dir, crit) {
  if (crit) return 'crit';
  return dir && style !== 'heal' ? 'arc' : 'rise';
}

/**
 * Drift side of a hit on screen: away from the attacker (target right of it → +1, left → -1); 0 when no attacker is
 * known or it stands (almost) straight above / below the target on screen (less than `dead` px apart sideways).
 */
export function travelDir(srcX, tgtX, dead = 4) {
  if (!Number.isFinite(srcX) || !Number.isFinite(tgtX)) return 0;
  const dx = tgtX - srcX;
  return dx > dead ? 1 : dx < -dead ? -1 : 0;
}

const LANES_R = Object.freeze([0, 1, 2]);
const LANES_L = Object.freeze([0, -1, -2]);
const LANES_EVEN = Object.freeze([0, 1, -1]);
const LANES_ODD = Object.freeze([0, -1, 1]);
/** Lane order of a new number (lane widths from its unit's head): its column, then outwards on its drift side. */
export function laneOrder(dir, seq = 0) {
  if (dir > 0) return LANES_R;
  if (dir < 0) return LANES_L;
  return seq & 1 ? LANES_ODD : LANES_EVEN;
}
/** Lines a number may stack up in its own column before it spills into the next lane. */
export const COLUMN_LINES = 2.2;

/** Seconds a number takes to rise its full rise (every path). */
export const RISE_T = 0.9;
/** Seconds an 'arc' number takes to drift its full sideways distance (it decelerates, igame-tft SkillDamagePopup 11). */
export const ARC_T = 0.5;
/** Sideways drift of an 'arc' number, in tiles at the spot (≈ igame-tft's 44 UI units at 56 UI units per world unit). */
export const ARC_TILES = 0.42;

const easeOut = (t) => 1 - (1 - t) * (1 - t);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Share (0..1) of its full rise a number has made after `t` real s (one curve for every path, see header). */
export function riseAt(t) {
  return easeOut(clamp01(t / RISE_T));
}

/** Share (0..1) of its sideways drift an 'arc' number has made after `t` real s (others: 0). */
export function driftAt(kind, t) {
  return kind === 'arc' ? easeOut(clamp01(t / ARC_T)) : 0;
}

/** Linear keyframe lookup ([[t, v], …], t ascending). */
export function lerpKeys(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-6, t1 - t0);
    }
  }
  return keys[keys.length - 1][1];
}

/** A crit's punch factor after `t` real s (CRIT_PUNCH; scale = 1 + f × (pop − 1), below 0 = the undershoot). */
export function critPunchAt(t) {
  return lerpKeys(CRIT_PUNCH, t);
}

/** Text of a number: heals get '+', crits a trailing '!'. */
export function numberText(value, style, crit) {
  return (style === 'heal' ? '+' : '') + Math.round(value) + (crit ? '!' : '');
}

/** Width of a number's text in digit advances (a label's capitals are wider than digits). */
export function numberChars(value, style, crit, label = null) {
  if (label) return String(label).length * 1.2;
  return String(Math.round(value)).length + (style === 'heal' ? 1 : 0) + (crit ? 1 : 0);
}

/** Merge window of a running total: the longer of its first hit's tier and its current tier (a chip stream keeps merging). */
export function mergeWindow(t) {
  return Math.max((TIER_LOOK[t.tier0] || TIER_LOOK.normal).merge, (TIER_LOOK[t.tier] || TIER_LOOK.normal).merge);
}

/**
 * Whether a hit (style, crit) may join a live number `t` of its unit: the same style, neither is a crit or a label, the
 * hit comes within the number's merge window after its last hit (`now` − t.lastHit) while it is still young.
 */
export function canMerge(t, style, crit, now) {
  if (!t || t.style !== style || crit || t.crit || t.label) return false;
  return now - t.lastHit < mergeWindow(t) && t.life < RISE_T * 0.55;
}
