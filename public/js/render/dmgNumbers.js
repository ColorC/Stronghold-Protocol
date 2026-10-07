// Damage-number motion and timing mirrored from the registered iGame-TFT overlay and SkillDamagePopup.csv.
// This module is pure: FxSystem owns the clock and screen projection; overlapping popups are allowed.

export const POPUP_ROWS = Object.freeze({
  damage: Object.freeze({
    id: 11, total: 1.5, move: 0.5, mode: 1,
    randomStart: Object.freeze([0.1, 0.15]), randomEnd: Object.freeze([0.25, 0.05]),
    velocity: Object.freeze([150, 132]), randomVelocity: Object.freeze([0.15, 0.1]),
    acceleration: Object.freeze([-250, -612]), randomAcceleration: null,
  }),
  crit: Object.freeze({
    id: 5, total: 1.5, move: 0.1, mode: 2,
    randomStart: Object.freeze([0.25, 0.15]), randomEnd: Object.freeze([0.1, 0]),
    points: Object.freeze([[0.1, 0, 0]]), scale: Object.freeze([0.5, 0.5, 0.1]),
  }),
  heal: Object.freeze({
    id: 9, total: 1.5, move: 1, mode: 2,
    randomStart: Object.freeze([0.05, 0.05]), randomEnd: Object.freeze([0.3, 0]),
    points: Object.freeze([[0.3, 0, 0], [1, 0, 20]]), scale: Object.freeze([1.1, 1.1, 0.1]),
  }),
});

// Extracted keyframes used by BattleOverlay for anui_font_battle_damage / _critical.
export const DAMAGE_ALPHA = Object.freeze([[0, 1], [0.25, 0.9], [0.5, 0]]);
export const CRIT_ALPHA = Object.freeze([[0, 0], [0.016667, 1], [0.433333, 1], [0.75, 0]]);
export const CRIT_SCALE = Object.freeze([[0, 3.505806], [0.016667, 3.205806], [0.083333, 0.7256578], [0.116667, 0.95802957], [0.25, 1]]);
export const CRIT_Y = Object.freeze([[0, 1.9], [0.25, 1.9], [0.75, 44.62]]);

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

const randomSource = (seed) => {
  let state = (seed >>> 0) || 1;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
};
const randomAround = (rnd, spread = 0) => 1 + rnd() * spread * 2 - spread;

/** Generate the same ten waypoints as iGame-TFT BattleOverlay.waypoints(). */
export function popupWaypoints(kind = 'damage', seed = 1) {
  const row = POPUP_ROWS[kind] || POPUP_ROWS.damage;
  const rnd = randomSource(seed);
  const end = row.randomEnd || [];
  const xC = randomAround(rnd, end[0] || 0), yC = randomAround(rnd, end[1] || 0);
  const count = 10, dt = row.move / count;
  const points = [];
  if (row.mode === 1) {
    const velocity = row.velocity, randomVelocity = row.randomVelocity, accel = row.acceleration;
    const r1 = rnd();
    const vx = 1 + r1 * 2 * randomVelocity[0] - randomVelocity[0];
    const ax = 1 + (r1 * 2 * randomVelocity[0] - randomVelocity[0]) * 0.9;
    const r2 = rnd();
    const vy = 1 + r2 * 2 * randomVelocity[1] - randomVelocity[1];
    for (let i = 1; i <= count; i++) {
      const t = Math.min(dt * i, row.move);
      points.push([
        (velocity[0] * vx * t + accel[0] * ax * t * t / 2 + dt * i) * xC,
        (velocity[1] * vy * t + accel[1] * t * t / 2) * yC,
      ]);
    }
  } else {
    const slice = [[0, 0, 0], ...row.points];
    for (let i = 1; i <= count; i++) {
      const t = dt * i;
      let x = 0, y = 0;
      for (let k = 0; k < slice.length; k++) {
        if (t >= slice[k][0]) {
          if (k === slice.length - 1) { x = slice[k][1]; y = slice[k][2]; }
          else if (t <= slice[k + 1][0]) {
            const f = (t - slice[k][0]) / Math.max(1e-6, slice[k + 1][0] - slice[k][0]);
            x = slice[k][1] + (slice[k + 1][1] - slice[k][1]) * f;
            y = slice[k][2] + (slice[k + 1][2] - slice[k][2]) * f;
          }
        }
      }
      points.push([x * xC, y * yC]);
    }
  }
  const start = row.randomStart || [];
  const ox = (rnd() * 2 * (start[0] || 0) - (start[0] || 0));
  const oy = (rnd() * 2 * (start[1] || 0) - (start[1] || 0));
  return Object.freeze({ move: row.move, total: row.total, points: Object.freeze(points), ox, oy });
}

/** Linear interpolation through iGame's generated path, in native UI units (y points upward). */
export function popupPosition(path, elapsed, direction = 1) {
  if (elapsed <= 0 || !path.points.length) return [0, 0];
  const f = Math.min(1, elapsed / Math.max(1e-3, path.move)) * path.points.length;
  const i = Math.min(path.points.length - 1, Math.floor(f));
  const a = i === 0 ? [0, 0] : path.points[i - 1], b = path.points[i];
  const w = Math.min(1, f - i);
  return [(a[0] + (b[0] - a[0]) * w) * direction, a[1] + (b[1] - a[1]) * w];
}

export function popupAlpha(crit, elapsed) {
  return lerpKeys(crit ? CRIT_ALPHA : DAMAGE_ALPHA, elapsed);
}

/** Single base text scale for all hit values; only the source critical prefab punches its scale. */
export const BASE_TEXT_SCALE = 0.8;
/** BattleOverlay uses 50 px for a critical number and 22 px for an ordinary one. */
export const CRIT_FONT_SCALE = 50 / 22;
export const CRIT_PUNCH_T = 0.25;

export function numberText(value, style, crit) {
  return (style === 'heal' ? '+' : '') + Math.round(value) + (crit ? '!' : '');
}

export function travelDir(srcX, tgtX, dead = 4) {
  if (!Number.isFinite(srcX) || !Number.isFinite(tgtX)) return 0;
  const dx = tgtX - srcX;
  return dx > dead ? 1 : dx < -dead ? -1 : 0;
}
