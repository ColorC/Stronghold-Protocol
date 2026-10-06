// render/fxRecipes.js — WHAT the battle FX draw for each event ("recipes"), on top of the drawing primitives of
// render/fx.js (FxSystem: particle pool, projectiles, rings, zones, beams, fire jets, lock reticles, numbers …).
// A recipe is a function (fx, cue, next) → void: `fx` the FxSystem, `cue` the event (render/fxRegistry.js fxCue),
// `next()` runs the next, less specific recipe of the registry chain (a recipe that only adds to the default calls it).
//
//   default layer  one recipe per channel (DEFAULT_RECIPES): 'atk' by projectile kind (render/style.js PROJ), 'fx' by
//                  archetype (FX_KINDS → FX_ARCHETYPES), 'dmg' the hit flash, 'skill' the activation burst + aura, …
//   built-ins      special recipes registered on top of it (BUILTIN_FX, registerBuiltinFx): 蕾缪安's lock reticles and
//                  bombardment, 炎佑's fire jet, the 回环射手 boomerang, chain / beam shots, splash rings by sub-profession
// The registry (render/fxRegistry.js) picks the recipe chain of an event: charId:skillId → charId → sub-profession →
// profession → event kind → the default layer. Nothing here imports render/fx.js (no module cycle): recipes only call
// the FxSystem they are handed.

import { PROJ } from './style.js';

const num = (v, d) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Sim fx kind → visual archetype (`a`), colour (`c`) and defaults (`r` radius, `dur` game s, `tex`, `smoke`).
 * Covers every kind emitted by server/sim (Battle, kits, tokens, enemies, bosses, devices, bonds, items); unknown
 * kinds fall back to a keyword guess, then to a generic sparkle (fxSpec). The default layer of the 'fx' channel.
 */
export const FX_KINDS = Object.freeze({
  // blasts
  aoe: { a: 'blast', c: 0xffb35c }, explode: { a: 'blast', c: 0xff7a33 }, explosion: { a: 'blast', c: 0xff7a33 },
  // `pt`: always at the event's (x, y) (its `id` is the shooter); `heavy`: debris + scorch
  bombard: { a: 'blast', c: 0xffa04a, r: 1.5, pt: true, heavy: true }, bombardShell: { a: 'shell', c: 0xff5a3a, r: 1.5, pt: true },
  airstrike: { a: 'blast', c: 0xff8a3d, r: 1.5, heavy: true }, splash: { a: 'blast', c: 0xffc27a },
  scorchBurst: { a: 'blast', c: 0xff6a2a }, champagneBomb: { a: 'blast', c: 0xffd27a }, shockBlast: { a: 'blast', c: 0x9fd4ff, smoke: 0x1c2630 },
  frostNova: { a: 'blast', c: 0x9fe6ff, smoke: 0x1c2630 }, sunBurst: { a: 'blast', c: 0xffe28a }, meltdown: { a: 'blast', c: 0xff5a2a, r: 1.5, heavy: true },
  iceSpike: { a: 'blast', c: 0xbfeeff, smoke: 0x1c2630 }, rockfall: { a: 'blast', c: 0xc8a878, smoke: 0x4a3f33 }, rockslide: { a: 'blast', c: 0xc8a878, smoke: 0x4a3f33 },
  finale: { a: 'blast', c: 0xffd45a, r: 1.5 }, swordStorm: { a: 'blast', c: 0xdfe8ff }, swordRain: { a: 'blast', c: 0xdfe8ff }, liberate: { a: 'blast', c: 0xffffff },
  quadShot: { a: 'volley', c: 0xfff2d0 }, featherArrow: { a: 'counter', c: 0xfff2d0 },
  burst: { a: 'element', c: 0xd0a0ff },
  // areas
  zone: { a: 'zone', c: 0xffb35c, dur: 3 }, healField: { a: 'zone', c: 0x62f08a, dur: 4 }, firewall: { a: 'wall', c: 0xff6a2a, dur: 4 },
  firewallBlock: { a: 'counter', c: 0xff6a2a }, tide: { a: 'zone', c: 0x5fe0ff, dur: 3, r: 2 }, storm: { a: 'zone', c: 0xd8c8a0, dur: 3 },
  tornado: { a: 'zone', c: 0xd8e8ff, dur: 3 }, snow: { a: 'zone', c: 0xe8f6ff, dur: 3 }, telegraph: { a: 'telegraph', c: 0xff3b30, dur: 1.2 },
  coldWind: { a: 'chill', c: 0x9fd4ff },
  // support
  heal: { a: 'heal', c: 0x62f08a }, healAoe: { a: 'healAoe', c: 0x62f08a, r: 1.5 }, bandage: { a: 'heal', c: 0x62f08a }, blessing: { a: 'healAoe', c: 0xfff0a8 },
  cleanse: { a: 'healAoe', c: 0xdfffff, r: 0.9 }, revive: { a: 'summon', c: 0xfff0a8 }, reborn: { a: 'summon', c: 0xffd45a }, hpShare: { a: 'heal', c: 0xff9aa6 },
  spGift: { a: 'sp', c: 0x6fd3ff }, spGain: { a: 'sp', c: 0x6fd3ff }, reload: { a: 'sp', c: 0xffe066 },
  shield: { a: 'shield', c: 0xdfe8ff }, catShield: { a: 'shield', c: 0xffe0a8 }, saltWard: { a: 'shield', c: 0xbfeeff }, shell: { a: 'shield', c: 0xc8b890 },
  vest: { a: 'shield', c: 0xdfe8ff }, sleepGuard: { a: 'shield', c: 0xa8b6ff }, truesilver: { a: 'shield', c: 0xfff3b8 }, shieldBreak: { a: 'shatter', c: 0xdfe8ff },
  // arrivals / departures
  summon: { a: 'summon', c: 0x9ff0dc }, drones: { a: 'summon', c: 0x8fe6ff }, drone: { a: 'summon', c: 0x8fe6ff }, sentry: { a: 'summon', c: 0x9ff0dc },
  turretOnline: { a: 'summon', c: 0xff8a6a }, yanyouSummon: { a: 'summon', c: 0xffb347 }, device: { a: 'summon', c: 0xc0c8cc },
  appear: { a: 'summon', c: 0xb36bff }, copy: { a: 'summon', c: 0xd8b0ff }, manifoldCopy: { a: 'summon', c: 0xd8b0ff }, split: { a: 'summon', c: 0xff9a6a },
  disappear: { a: 'vanish', c: 0xb36bff }, stealth: { a: 'vanish', c: 0x8fa0b0 }, camouflage: { a: 'vanish', c: 0x8fb08f }, phase: { a: 'vanish', c: 0xb36bff },
  substitute: { a: 'vanish', c: 0xd8b0ff }, swap: { a: 'blink', c: 0xd8b0ff }, blink: { a: 'blink', c: 0xb36bff }, teleport: { a: 'blink', c: 0xb36bff },
  // a dollkeeper knocked out as its <替身> (sim professions.js): only its model form goes back to the 本体 for the
  // redeploy — the 替身's death clip already shows the knock-out, nothing is drawn
  dollEnd: { a: 'none', c: 0xd8b0ff },
  ulpiaReturn: { a: 'blink', c: 0x9ff0dc }, manifoldSplit: { a: 'blink', c: 0xd8b0ff },
  // displacement
  pull: { a: 'move', c: 0x9fd4ff }, push: { a: 'move', c: 0xffd9a0 }, displace: { a: 'move', c: 0xd0c0a0 }, lure: { a: 'move', c: 0xffb3ec },
  charge: { a: 'move', c: 0xff9c33 }, dash: { a: 'move', c: 0xffd9a0 }, slippery: { a: 'move', c: 0x9fe6ff },
  // pulses
  sonic: { a: 'wave', c: 0xc9a2ff, r: 1.5 }, pulse: { a: 'wave', c: 0x9ff0dc }, sermon: { a: 'wave', c: 0xffe28a, r: 1.5 }, ripple: { a: 'wave', c: 0x5fe0ff },
  tornadoPulse: { a: 'wave', c: 0xd8e8ff }, wake: { a: 'wave', c: 0x5fe0ff }, wolfShadow: { a: 'wave', c: 0x8fa0b0 }, wolfShadowLost: { a: 'vanish', c: 0x8fa0b0 },
  redistribute: { a: 'wave', c: 0x62f08a }, dilemma: { a: 'wave', c: 0xc9a2ff },
  // marks
  taunt: { a: 'mark', c: 0xff9c33 }, palsy: { a: 'mark', c: 0xc77dff }, emergency: { a: 'mark', c: 0xff5a4a },
  lock: { a: 'reticle', c: 0xff5a4a }, droneLock: { a: 'reticle', c: 0x8fe6ff }, wanted: { a: 'reticle', c: 0xffc600 }, expose: { a: 'reticle', c: 0xff7b8a },
  reveal: { a: 'reticle', c: 0x9fd4ff }, anchor: { a: 'reticle', c: 0x9fd4ff },
  // buffs
  buff: { a: 'buff', c: 0xffd45a }, overload: { a: 'buff', c: 0xff7a33 }, overclock: { a: 'buff', c: 0xff9c33 }, talent: { a: 'buff', c: 0xffd45a },
  knack: { a: 'buff', c: 0xffd45a }, bloodBattle: { a: 'buff', c: 0xff4b3e }, sword: { a: 'buff', c: 0xdfe8ff }, equip: { a: 'buff', c: 0x4ed8af },
  garrisonGrant: { a: 'buff', c: 0x4ed8af }, extraAttack: { a: 'buff', c: 0xffe066 }, soul: { a: 'buff', c: 0xb36bff }, jungleSoul: { a: 'buff', c: 0x7fd37a },
  candle: { a: 'buff', c: 0xffb347 }, mote: { a: 'buff', c: 0xfff0a8 }, ember: { a: 'buff', c: 0xff7a33 }, ignite: { a: 'buff', c: 0xff6a2a },
  flame: { a: 'buff', c: 0xff6a2a }, grow: { a: 'buff', c: 0x7fd37a }, weightlessBuff: { a: 'buff', c: 0xcfe0ff },
  // 炎佑 祛恶之焰: a continuous jet from the dragon (`id`) onto its locked target (`target`) + a burning disc (fx.js _flame)
  yanyouFlame: { a: 'flame', c: 0xff8a3d, r: 1 },
  // states
  takeoff: { a: 'lift', c: 0xcfe0ff }, levitate: { a: 'lift', c: 0xcfe0ff }, weightless: { a: 'lift', c: 0xcfe0ff },
  sleep: { a: 'sleep', c: 0xa8b6ff }, crit: { a: 'crit', c: 0xffe066 },
  dodge: { a: 'dodge', c: 0xffffff }, riposte: { a: 'counter', c: 0xffd9a0 }, counter: { a: 'counter', c: 0xffd9a0 }, block: { a: 'counter', c: 0xdfe8ff },
  thorns: { a: 'counter', c: 0xff9aa6 }, downed: { a: 'down', c: 0xbfeee2 }, stone: { a: 'down', c: 0xc0b8a8, smoke: 0x5a5448 },
  dp: { a: 'dp', c: 0x9fd4ff }, coin: { a: 'coin', c: 0xffc600 }, steal: { a: 'coin', c: 0xffc600 }, crateBreak: { a: 'crate', c: 0xc89a5a },
  lpLoss: { a: 'lp', c: 0xff3b30 },
  // 限伤 (sim/damage.js leaderHitCancelled): a leader's hit of ≥ 300000 dealt nothing — the official shows no number and
  // no effect [ASSUMED], so nothing is drawn (`a: 'none'`)
  hitCap: { a: 'none', c: 0xffffff },
  // Upstream 0.2.0 自选 kits (4b059c9): explicit looks for the newly emitted kinds.
  bulletClear: { a: 'wave', c: 0xd8b0ff }, logosLexicon: { a: 'mark', c: 0xc9a2ff }, logosExecute: { a: 'strike', c: 0xb07dff },
  mantraArc: { a: 'bolt', c: 0xc77dff }, mantraGrant: { a: 'mark', c: 0xc77dff }, mantraGate: { a: 'reticle', c: 0xc77dff },
  veenBounce: { a: 'counter', c: 0xffd27a }, veenVolley: { a: 'volley', c: 0xffd27a },
  harpoon: { a: 'beam', c: 0xd0c0a0 }, arrowRain: { a: 'volley', c: 0xfff2d0 }, mark: { a: 'reticle', c: 0xff7b8a },
  bounce: { a: 'counter', c: 0xffd9a0 }, dying: { a: 'mark', c: 0xff5a4a },
  // beams
  beam: { a: 'beam', c: 0xff7a5a }, link: { a: 'beam', c: 0x9ff0dc }, lightning: { a: 'bolt', c: 0xc9a2ff }, tentacle: { a: 'beam', c: 0x5fe0ff },
  sandChains: { a: 'beam', c: 0xd8c8a0 }, sandChainsCharged: { a: 'beam', c: 0xffd45a },
  strike: { a: 'strike', c: 0xffe6a8 }, volley: { a: 'volley', c: 0xfff2d0 }, column: { a: 'pillar', c: 0x9ff0dc }, obelisk: { a: 'pillar', c: 0xc9a2ff },
  duskDragon: { a: 'blast', c: 0x9dff6a, r: 1.5 }, shadowWeave: { a: 'vanish', c: 0x8f7bff }, reweave: { a: 'summon', c: 0x8f7bff },
  slash: { a: 'counter', c: 0xfff0d0 }, devour: { a: 'vanish', c: 0xff4b3e }, undying: { a: 'shield', c: 0xffd45a },
  // summon arrival bursts (content/tokens.js burst(): 沙之碑 default, 迷迭香 gear stun, 耀阳 sword, 纸偶)
  summonBurst: { a: 'blast', c: 0xe8c878, smoke: 0x4a3f33 }, summonStun: { a: 'blast', c: 0xcfe0ff, smoke: 0x2a2e36 },
  radiantSword: { a: 'pillar', c: 0xffe8a0 }, paperDoll: { a: 'blast', c: 0xc9a2ff, smoke: 0x2c2436 },
  // bonds / garrisons (support/index.js fxOn)
  bondMilestone: { a: 'buff', c: 0xffc600 }, bondProc: { a: 'buff', c: 0x4ed8af }, bondShare: { a: 'wave', c: 0x4ed8af },
  garrison: { a: 'buff', c: 0x4ed8af }, layer: { a: 'buff', c: 0xffe066 }, sp: { a: 'sp', c: 0x6fd3ff },
});

/** Keyword guesses for kinds added later (checked in order), before the generic sparkle. */
const FX_GUESS = [
  [/heal|cure|mend|regen/i, 'heal'], [/shield|ward|barrier|guard/i, 'shield'], [/summon|spawn|call|deploy/i, 'summon'],
  [/blast|bomb|explo|burst|boom|nova|strike/i, 'blast'], [/zone|field|area|wall|mist|fog|pool/i, 'zone'],
  [/buff|boost|power|rage|charge|up$/i, 'buff'], [/mark|lock|target|wanted|expose/i, 'reticle'], [/teleport|blink|warp|swap/i, 'blink'],
  [/stealth|hide|vanish|cloak/i, 'vanish'], [/pull|push|knock|dash|leap/i, 'move'], [/pulse|wave|ring|sonic/i, 'wave'],
];

/**
 * 'phase' (an enemy's mode change, render/units.js FORMS) kinds the model shows on its own: 暴鸰 'bombed' — its bomb is
 * the 'droneBomb' projectile of the same moment, a puff on the drone would read as something else (feedback D4).
 */
const SILENT_PHASES = new Set(['bombed']);

/** Visual spec of an fx kind (see FX_KINDS); `extra.kind` / `extra.element` may pick a better colour. */
export function fxSpec(kind, extra = {}) {
  const k = typeof kind === 'string' ? kind : '';
  if (k === 'phase' && SILENT_PHASES.has(extra && extra.kind)) return { a: 'none', c: 0xffffff };
  let spec = FX_KINDS[k];
  if (!spec) {
    const g = FX_GUESS.find(([re]) => re.test(k));
    spec = g ? { ...FX_KINDS[{ heal: 'heal', shield: 'shield', summon: 'summon', blast: 'aoe', zone: 'zone', buff: 'buff', reticle: 'lock', blink: 'blink', vanish: 'disappear', move: 'displace', wave: 'pulse' }[g[1]]] } : { a: 'generic', c: 0xfff2d0 };
  }
  const el = extra && extra.element;
  if (el && (spec.a === 'blast' || spec.a === 'zone' || spec.a === 'element')) {
    const c = el === 'burn' ? 0xff7a33 : el === 'neural' ? 0xff5ad0 : el === 'necrosis' || el === 'apoptosis' ? 0x9dff6a : el === 'erosion' ? 0x6fe0ff : null;
    if (c) spec = { ...spec, c };
  }
  if (extra && (extra.dmgType === 'arts' || /arts|magic/i.test(String(extra.kind || ''))) && spec.a === 'blast') spec = { ...spec, c: 0xc77dff };
  return spec;
}

/** Tiles covered by a blast / telegraph: `tiles` = [[r,c]…] or 'box' (Chebyshev ⌊r⌋ around the centre) or 'disc'. */
export function tilesAround(x, y, r, tiles) {
  if (Array.isArray(tiles)) return tiles.filter((t) => Array.isArray(t) && Number.isInteger(t[0]) && Number.isInteger(t[1])).slice(0, 80);
  const cr = Math.round(y), cc = Math.round(x), R = Math.max(0, Math.min(6, Math.floor(r)));
  const out = [];
  for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
    if (tiles === 'box' || dr * dr + dc * dc <= r * r + 0.25) out.push([cr + dr, cc + dc]);
  }
  return out;
}

/**
 * Tiles of a straight wall through tile (round(y), round(x)): `axis` 'col' = that column, 'row' = that row (余 S3
 * fire wall: perpendicular to his facing, sim/content/kits/tier6.js). Clipped to the field `rect` (inclusive
 * { r0, r1, c0, c1 }); without one ±4 tiles.
 */
export function wallTiles(x, y, axis, rect) {
  const R = Math.round(Number(y)), C = Math.round(Number(x));
  if (!Number.isFinite(R) || !Number.isFinite(C)) return [];
  const ok = rect && [rect.r0, rect.r1, rect.c0, rect.c1].every(Number.isFinite);
  const out = [];
  if (axis === 'row') {
    const [a, b] = ok ? [rect.c0, rect.c1] : [C - 4, C + 4];
    for (let c = a; c <= b; c++) out.push([R, c]);
  } else {
    const [a, b] = ok ? [rect.r0, rect.r1] : [R - 4, R + 4];
    for (let r = a; r <= b; r++) out.push([r, C]);
  }
  return out.filter(([r, c]) => r >= 0 && r <= 18 && c >= 0 && c <= 20);
}

// ---- 'fx' channel: where and how big (shared by every fx recipe), archetypes --------------------------------------

/**
 * The resolved site of an 'fx' cue (memoised on it, so the recipes of one chain share it): `ex` the extra object,
 * `spec` (fxSpec), `at` where it happens (on its anchor unit `ex.id`, or at (x, y): fx.js _where / `pt` kinds _point),
 * `col`, `r` (tiles), `ts` (clock rate), `dur` (real s), `cam`, `p` (screen point of the anchor's chest / the spot, in
 * fx._p), `s` (px per tile there). null when nothing is drawn: archetype 'none' (hitCap, dollEnd, silent phases) or no
 * finite position.
 */
export function fxSite(fx, c) {
  if (c.site !== undefined) return c.site;
  c.site = null;
  const ex = c.extra && typeof c.extra === 'object' ? c.extra : {};
  const spec = fxSpec(c.kind, ex);
  if (spec.a === 'none') return null; // an event the screen does not show (hitCap)
  const x = c.x, y = c.y;
  const at = spec.pt ? fx._point(Number(x), Number(y)) : fx._where(Number(x), Number(y), ex);
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const r = clamp(num(ex.r ?? ex.radius, spec.r ?? 1), 0.3, 30);
  const ts = fx.ctx.timeScale ? Math.max(0.25, fx.ctx.timeScale()) : 2;
  const dur = num(ex.dur ?? ex.duration, spec.dur ?? 0) / ts;
  const cam = fx.ctx.cam();
  const p = at.v ? fx._chest(at.v, fx._p) : cam.project(at.x, at.y, at.z + 0.5, fx._p);
  return (c.site = { kind: c.kind, x, y, ex, spec, at, col: spec.c, r, ts, dur, cam, p, s: p.s });
}

const elementColour = (el, col) => (el === 'burn' ? 0xff7a33 : el === 'neural' ? 0xff5ad0 : el === 'necrosis' || el === 'apoptosis' ? 0x9dff6a : el === 'erosion' ? 0x6fe0ff : col);

/**
 * fx archetype → recipe (fx, site): the look of every FX_KINDS archetype (blast, shell, zone, wall, telegraph, chill,
 * heal, healAoe, sp, shield, shatter, summon, vanish, blink, move, wave, mark, reticle, buff, lift, sleep, crit, dodge,
 * counter, dp, coin, crate, down, beam, bolt, flame, strike, pillar, volley, lp, element; `generic` for anything else).
 * `extra` keys read: id (anchor unit — or the shooter of a `pt` kind), r | radius, dur | duration, t (shell flight,
 * game s), src / from / to / target / targets (unit ids), fx, fy / fromX, fromY / tx, ty (positions), element, n, scale,
 * kind, tiles, axis.
 */
export const FX_ARCHETYPES = Object.freeze({
  blast(fx, a) {
    if (a.r >= 12) { fx.flashScreen(a.col, 0.5); return; }
    fx.explosion(a.at.x, a.at.y, a.at.z, a.r, a.col, { smoke: a.spec.smoke, heavy: !!a.spec.heavy, tiles: a.ex.tiles ? tilesAround(a.at.x, a.at.y, a.r, a.ex.tiles) : null });
  },
  // a shell fired now by `id` that lands at (x, y) after `t` game seconds
  shell(fx, a) {
    const flight = num(a.ex.t ?? a.ex.flight ?? a.ex.dur ?? a.ex.duration, 1) / a.ts;
    fx.mortar(fx._viewOf(a.ex.id ?? a.ex.src), a.at.x, a.at.y, a.r, flight);
  },
  zone(fx, a) { fx.zone(a.at.x, a.at.y, a.at.z, a.r, a.col, Math.max(0.6, a.dur || 1.5), a.spec.tex); },
  wall(fx, a) {
    // a line of burning tiles through the anchor tile along `axis` ('col' | 'row', from the sim event)
    const rect = fx.ctx.fieldRect ? fx.ctx.fieldRect() : null;
    fx.tileFlash(wallTiles(Number(a.x), Number(a.y), a.ex.axis === 'row' ? 'row' : 'col', rect), a.col, Math.max(0.6, a.dur || 1.5));
    fx.zone(a.at.x, a.at.y, a.at.z, 0.6, a.col, Math.max(0.6, a.dur || 1.5), a.spec.tex);
  },
  telegraph(fx, a) {
    const d = Math.max(0.4, a.dur || 1);
    if (a.r >= 12) { fx.flashScreen(a.col, 0.45, d); return; }
    if (a.ex.tiles) fx.tileFlash(tilesAround(a.at.x, a.at.y, a.r, a.ex.tiles), a.col, d, true);
    else fx.zone(a.at.x, a.at.y, a.at.z, a.r, a.col, d, 'ring', true);
  },
  chill(fx, a) { fx.flashScreen(a.col, 0.35, 0.8); fx.snowfall(a.col); },
  heal(fx, a) { fx.healBurst(a.at.v || { x: a.at.x, y: a.at.y, z: a.at.z }, 0); },
  healAoe(fx, a) {
    const { at, r, col, cam } = a;
    fx.ring(at.x, at.y, at.z, 0.2, r, col, 0.6);
    const n = fx.quality === 'low' ? 4 : 9;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, d = Math.random() * r * 0.85;
      const q = cam.project(at.x + Math.cos(ang) * d, at.y + Math.sin(ang) * d, at.z + 0.2);
      fx.particle('plus', q.x, q.y, { tint: col, vy: -q.s * 0.9, life: 0.8, s0: q.s / 64 * 0.3, s1: q.s / 64 * 0.18, a0: 0.9, a1: 0, fadeIn: 0.1 });
    }
  },
  sp(fx, a) {
    const { p, s, col } = a;
    for (let i = 0; i < (fx.quality === 'low' ? 3 : 7); i++) {
      fx.particle('dot', p.x + (Math.random() - 0.5) * s * 0.6, p.y + (Math.random() - 0.2) * s * 0.4, { tint: col, vy: -s * (0.6 + Math.random() * 0.6), life: 0.7, s0: s / 32 * 0.2, s1: 0, a0: 1, a1: 0, fadeIn: 0.05 });
    }
    fx.particle('glow', p.x, p.y, { tint: col, life: 0.3, s0: s / 128 * 0.6, s1: s / 128 * 1.1, a0: 0.7, a1: 0 });
  },
  shield(fx, a) {
    const { p, s, col } = a;
    fx.particle('hex', p.x, p.y, { tint: col, life: 0.55, s0: s / 128 * 0.9, s1: s / 128 * 1.25, a0: 0.85, a1: 0, sx: 0.85 });
    fx.particle('glow', p.x, p.y, { tint: col, life: 0.4, s0: s / 128 * 0.9, s1: s / 128 * 1.3, a0: 0.5, a1: 0 });
  },
  shatter(fx, a) {
    const { p, s, col } = a;
    fx.particle('hex', p.x, p.y, { tint: col, life: 0.25, s0: s / 128 * 1.1, s1: s / 128 * 1.5, a0: 0.9, a1: 0 });
    for (let i = 0; i < (fx.quality === 'low' ? 5 : 12); i++) {
      const ang = Math.random() * Math.PI * 2;
      fx.particle('shard', p.x + Math.cos(ang) * s * 0.3, p.y + Math.sin(ang) * s * 0.3, { tint: col, vx: Math.cos(ang) * s * 1.6, vy: Math.sin(ang) * s * 1.2 - s * 0.3, g: s * 3, life: 0.55, s0: s / 32 * 0.16, s1: s / 32 * 0.05, a0: 1, a1: 0, spin: (Math.random() - 0.5) * 12 });
    }
  },
  summon(fx, a) {
    const { at, col } = a;
    const g = a.cam.project(at.x, at.y, at.z);
    fx.particle('pillar', g.x, g.y, { tint: col, life: 0.55, s0: g.s / 64 * 0.8, s1: g.s / 64 * 0.3, a0: 0.9, a1: 0, sx: 1, ay: 1 });
    fx.ring(at.x, at.y, at.z, 0.1, 0.9, col, 0.5, 'hex');
    fx.burst(g.x, g.y - g.s * 0.3, g.s, 8, col, { speed: 1.4, up: 0.8, life: 0.5, tex: 'dot' });
  },
  vanish(fx, a) {
    const { p, s, col } = a;
    fx.particle('glow', p.x, p.y, { tint: col, life: 0.4, s0: s / 128 * 0.7, s1: s / 128 * 1.5, a0: 0.8, a1: 0 });
    fx.smoke(p.x, p.y, s * 0.7, 0x2c2436, 0.5);
    fx.burst(p.x, p.y, s, 7, col, { speed: 1.5, tex: 'dot', life: 0.45 });
  },
  blink(fx, a) {
    const { ex, at, p, s, col } = a;
    const fx0 = num(ex.fx ?? ex.fromX, NaN), fy0 = num(ex.fy ?? ex.fromY, NaN);
    if (Number.isFinite(fx0) && Number.isFinite(fy0)) {
      const q = a.cam.project(fx0, fy0, at.z + 0.5, fx._q);
      fx.smoke(q.x, q.y, q.s * 0.6, 0x2c2436, 0.45);
      fx.particle('glow', q.x, q.y, { tint: col, life: 0.3, s0: q.s / 128 * 0.8, s1: q.s / 128 * 0.2, a0: 0.8, a1: 0 });
      fx.streak(fx0, fy0, at.x, at.y, at.z + 0.5, col, 0.3);
    }
    fx.particle('glow', p.x, p.y, { tint: col, life: 0.35, s0: s / 128 * 0.3, s1: s / 128 * 1.2, a0: 0.9, a1: 0 });
    fx.burst(p.x, p.y, s, 6, col, { speed: 1.4, tex: 'dot', life: 0.4 });
  },
  move(fx, a) {
    const { ex, at, col } = a;
    const fx0 = num(ex.fromX ?? ex.fx ?? ex.x0, NaN), fy0 = num(ex.fromY ?? ex.fy ?? ex.y0, NaN);
    const tx = num(ex.tx, NaN), ty = num(ex.ty, NaN);
    if (Number.isFinite(fx0) && Number.isFinite(fy0)) fx.streak(fx0, fy0, at.x, at.y, at.z + 0.35, col, 0.35);
    else if (Number.isFinite(tx) && Number.isFinite(ty)) fx.streak(at.x, at.y, tx, ty, at.z + 0.35, col, 0.35);
    const g = a.cam.project(at.x, at.y, at.z + 0.05);
    for (let i = 0; i < (fx.quality === 'low' ? 2 : 5); i++) {
      fx.particle('smoke', g.x + (Math.random() - 0.5) * g.s * 0.5, g.y, { add: false, tint: 0x6b6358, vx: (Math.random() - 0.5) * g.s * 0.6, vy: -g.s * 0.2, drag: 2, life: 0.5, s0: g.s / 128 * 0.25, s1: g.s / 128 * 0.55, a0: 0.45, a1: 0 });
    }
  },
  wave(fx, a) {
    const { ex, at, p, s, col } = a;
    const k = clamp(num(ex.scale, 1), 0.5, 4);
    const rr = Math.max(0.8, a.r * (ex.scale ? Math.min(2, k / 2) : 1));
    for (let i = 0; i < 3; i++) fx.ring(at.x, at.y, at.z, 0.15 + i * 0.15, rr * (0.7 + i * 0.25), col, 0.45 + i * 0.12);
    fx.particle('glow', p.x, p.y, { tint: col, life: 0.3, s0: s / 128 * 0.5, s1: s / 128 * 1.2, a0: 0.7, a1: 0 });
  },
  mark(fx, a) { markOrReticle(fx, a); },
  reticle(fx, a) { markOrReticle(fx, a); },
  buff(fx, a) {
    const { at, p, s, col } = a;
    const g = a.cam.project(at.x, at.y, at.z + 0.05);
    const n = fx.quality === 'low' ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const ox = (Math.random() - 0.5) * g.s * 0.7;
      fx.particle('chevron', g.x + ox, g.y - g.s * (0.1 + Math.random() * 0.5), { tint: col, vy: -g.s * (1 + Math.random() * 0.5), life: 0.65, s0: g.s / 64 * 0.22, s1: g.s / 64 * 0.12, a0: 0.95, a1: 0, rot: -Math.PI / 2, fadeIn: 0.06 });
    }
    fx.ring(at.x, at.y, at.z, 0.2, 0.75, col, 0.4);
    fx.particle('glow', p.x, p.y, { tint: col, life: 0.35, s0: s / 128 * 0.6, s1: s / 128 * 1.1, a0: 0.6, a1: 0 });
  },
  lift(fx, a) {
    const { at, col } = a;
    const g = a.cam.project(at.x, at.y, at.z);
    fx.ring(at.x, at.y, at.z, 0.2, 0.8, col, 0.5);
    for (let i = 0; i < (fx.quality === 'low' ? 3 : 7); i++) {
      fx.particle('streak', g.x + (Math.random() - 0.5) * g.s * 0.6, g.y - g.s * Math.random() * 0.4, { tint: col, vy: -g.s * 1.8, life: 0.4, s0: g.s / 128 * 0.4, s1: g.s / 128 * 0.2, a0: 0.8, a1: 0, rot: -Math.PI / 2, sx: 1 });
    }
  },
  sleep(fx, a) {
    const v = a.at.v;
    const hz = v ? (v.z || 0) + (v._headTiles || 1.2) : a.at.z + 1.2;
    const q = a.cam.project(a.at.x + 0.2, a.at.y, hz, fx._q);
    for (let i = 0; i < 3; i++) fx.particle('st_sleep', q.x + i * q.s * 0.12, q.y - i * q.s * 0.12, { add: false, vy: -q.s * 0.5, vx: q.s * 0.15, life: 0.9 + i * 0.2, s0: q.s / 32 * 0.22, s1: q.s / 32 * 0.32, a0: 1, a1: 0, fadeIn: 0.1 * i });
  },
  crit(fx, a) {
    const { p, s, col } = a;
    fx.particle('spark', p.x, p.y, { tint: col, life: 0.28, s0: s / 64 * 1.3, s1: s / 64 * 0.2, a0: 1, a1: 0, rot: Math.random() * Math.PI });
    fx.particle('glow', p.x, p.y, { tint: 0xffffff, life: 0.18, s0: s / 128 * 0.9, s1: s / 128 * 1.4, a0: 0.9, a1: 0 });
    fx.burst(p.x, p.y, s, 8, col, { speed: 3.2, life: 0.3, size: 0.5 });
  },
  dodge(fx, a) {
    const { p, s, col } = a;
    fx.particle('soft', p.x, p.y, { tint: 0xffffff, life: 0.3, s0: s / 128 * 0.5, s1: s / 128 * 0.9, a0: 0.5, a1: 0 });
    fx.particle('slash', p.x, p.y, { tint: col, life: 0.22, s0: s / 128 * 0.8, s1: s / 128 * 1.1, a0: 0.7, a1: 0, rot: -0.5 });
  },
  counter(fx, a) {
    const { p, s, col } = a;
    fx.particle('spark', p.x, p.y, { tint: col, life: 0.22, s0: s / 64 * 0.9, s1: 0, a0: 1, a1: 0 });
    fx.particle('slash', p.x, p.y, { tint: col, life: 0.22, s0: s / 128 * 0.9, s1: s / 128 * 1.2, a0: 0.9, a1: 0, rot: 0.6 });
    fx.burst(p.x, p.y, s, 4, col, { speed: 2.4, life: 0.25 });
  },
  dp(fx, a) {
    const { p, s, col } = a;
    const n = Math.round(num(a.ex.n, 0));
    fx.particle('shard', p.x, p.y, { tint: col, vy: -s * 0.6, life: 0.9, s0: s / 32 * 0.28, s1: s / 32 * 0.22, a0: 1, a1: 0 });
    if (n > 0) fx.numberAt(p.x + s * 0.2, p.y, `+${n}`, col, 0.7);
  },
  coin(fx, a) {
    const { p, s } = a;
    for (let i = 0; i < 4; i++) fx.particle('coin', p.x + (Math.random() - 0.5) * s * 0.4, p.y, { add: false, vx: (Math.random() - 0.5) * s, vy: -s * (1.2 + Math.random() * 0.6), g: s * 4, life: 0.7, s0: s / 48 * 0.2, s1: s / 48 * 0.16, a0: 1, a1: 0.2 });
  },
  crate(fx, a) { fx.crateBreak(a.at.x, a.at.y, a.at.z); },
  down(fx, a) {
    const { p, s, col } = a;
    fx.smoke(p.x, p.y, s * 0.6, a.spec.smoke ?? 0x1a1a1a, 0.5);
    fx.burst(p.x, p.y, s, 5, col, { speed: 1.2, tex: 'dot', life: 0.5, g: 2 });
  },
  beam(fx, a) { beamOrBolt(fx, a); },
  bolt(fx, a) { beamOrBolt(fx, a); },
  // a continuous fire jet from `id` (the dragon) onto `target` — at the event's spot (the locked target), not snapped
  // onto the dragon hovering 0.25 tile from it
  flame(fx, a) {
    const ex = a.ex;
    fx._flame(ex.id ?? ex.src ?? null, ex.target ?? ex.to ?? null, Number(a.x), Number(a.y), a.r, a.col, Math.max(0.2, a.dur || 0.5));
  },
  strike(fx, a) { fx.strike(a.at.x, a.at.y, a.at.z, a.col, false); },
  pillar(fx, a) { fx.strike(a.at.x, a.at.y, a.at.z, a.col, true); },
  volley(fx, a) {
    const { ex, p, s, col } = a;
    const list = Array.isArray(ex.targets) ? ex.targets.slice(0, 12) : [];
    const src = fx._viewOf(ex.src ?? ex.id);
    for (const id of list) {
      const t = fx._viewOf(id);
      if (!t) continue;
      if (src && src !== t) fx.shoot(src, t, 'arrow');
      else { const q = fx._chest(t, fx._q); fx.burst(q.x, q.y, q.s, 4, col, { speed: 2, life: 0.3 }); }
    }
    if (!list.length) fx.burst(p.x, p.y, s, 6, col, { speed: 2.4, life: 0.35 });
  },
  lp(fx) { fx.leak(); },
  element(fx, a) {
    const { at, p, s } = a;
    const c2 = elementColour(a.ex.element, a.col);
    fx.particle('glow', p.x, p.y, { tint: c2, life: 0.45, s0: s / 128 * 1.2, s1: s / 128 * 2.6, a0: 1, a1: 0 });
    fx.ring(at.x, at.y, at.z, 0.2, 1.5, c2, 0.55);
    fx.burst(p.x, p.y, s, 12, c2, { speed: 3, life: 0.5 });
  },
  generic(fx, a) {
    const { p, s, col } = a;
    fx.particle('spark', p.x, p.y, { tint: col, life: 0.35, s0: s / 64 * 0.6, s1: 0, a0: 0.9, a1: 0, rot: Math.random() });
    fx.particle('glow', p.x, p.y, { tint: col, life: 0.3, s0: s / 128 * 0.4, s1: s / 128 * 0.9, a0: 0.6, a1: 0 });
    fx.burst(p.x, p.y, s, 4, col, { speed: 1.6, tex: 'dot', life: 0.35 });
  },
});

/** 'mark' ('!' over the head) and 'reticle' (a turning ring + hex on the unit). */
function markOrReticle(fx, a) {
  const { at, p, s, col } = a;
  const v = at.v;
  const hz = v ? (v.z || 0) + (v.hover || 0) + (v._headTiles || 1.2) + 0.25 : at.z + 1.4;
  const q = a.cam.project(at.x, at.y, hz, fx._q);
  if (a.spec.a === 'mark') {
    fx.particle('glow', q.x, q.y, { tint: col, life: 0.6, s0: q.s / 128 * 0.5, s1: q.s / 128 * 0.7, a0: 0.8, a1: 0 });
    fx.numberAt(q.x, q.y, '!', col, 0.8);
  } else {
    fx.particle('ring', p.x, p.y, { tint: col, life: 0.6, s0: s / 128 * 1.3, s1: s / 128 * 0.7, a0: 0.95, a1: 0, spin: 3 });
    fx.particle('hex', p.x, p.y, { tint: col, life: 0.6, s0: s / 128 * 0.5, s1: s / 128 * 0.9, a0: 0.8, a1: 0, spin: -2 });
  }
}

/** A beam from `from` / `src` to `to` / `target` (the anchor unit fills a missing end); a strike without two ends. */
function beamOrBolt(fx, a) {
  const { ex, at, spec, col } = a;
  const A = fx._viewOf(ex.from ?? ex.src) || (spec.a === 'bolt' ? null : at.v);
  const B = fx._viewOf(ex.to ?? ex.target) || (A === at.v ? null : at.v);
  if (A && B && A !== B) fx._beam(A, B, col, spec.a === 'bolt' ? 0.28 : 0.4, spec.a === 'bolt' ? 1 : 0.4);
  else fx.strike(at.x, at.y, at.z, col);
}

// ---- default layer ------------------------------------------------------------------------------------------------

/**
 * The default recipe of every channel (registered at the kind layer with kind '*'): what the screen showed before
 * the registry existed — the registry only adds layers in front of these.
 */
export const DEFAULT_RECIPES = Object.freeze({
  /** b.ev 'atk': a projectile by kind (style.js PROJ); a melee blow ('none') is remembered for its hit's slash. */
  atk(fx, c) {
    const src = c.src;
    if (!src) return;
    const spec = PROJ[c.kind];
    if (!spec || !c.tgt) {
      if (c.kind === 'none' || !c.kind) fx.meleeBlow(src);
      return;
    }
    fx.shoot(src, c.tgt, c.kind, spec);
  },
  /** b.ev 'dmg': glow + sparks in the hit colour, the melee slash of a blow that just landed, the number. */
  dmg(fx, c) {
    const v = c.view;
    if (!v) return;
    const melee = !!c.src && (c.melee === true || fx._slashAt === c.src.id);
    fx.hit(v, c.amount, c.type, c.src, melee);
  },
  heal(fx, c) { fx.healBurst(c.view, c.amount); },
  /** b.ev 'skill': on — the activation burst, then the active aura; off — the aura fades. */
  skill(fx, c) {
    const v = c.view;
    if (!v) return;
    if (!c.on) { fx._aura(v, false); return; }
    fx.skillFlash(v);
    fx._aura(v, true);
  },
  die(fx, c) { fx.deathBurst(c.view); },
  deploy(fx, c) { fx.deployBurst(c.view); },
  /** b.ev 'fx': the archetype of the kind (FX_KINDS; unknown kinds guess, then the generic sparkle). */
  fx(fx, c) {
    const a = fxSite(fx, c);
    if (!a) return;
    (FX_ARCHETYPES[a.spec.a] || FX_ARCHETYPES.generic)(fx, a);
  },
});

// ---- built-in special recipes ---------------------------------------------------------------------------------

/** Chain bounces: the source is the previous target of the bounce (sim ai.js), so the arc hops unit to unit. */
function chainArc(fx, c) {
  const { src, tgt } = c;
  if (src && tgt && tgt !== src) fx._beam(src, tgt, c.kind === 'chainHeal' ? 0x7dffa8 : 0xc9a2ff, 0.22, 1, true);
}

/** A beam attack (enemy or ally beam weapons). */
function beamShot(fx, c) {
  const { src, tgt } = c;
  if (src && tgt && tgt !== src) fx._beam(src, tgt, src.isEnemy ? 0xff7a5a : 0xffe6a8, 0.18, 0.15);
}

/**
 * 回环射手 (sim ai.js throwBoomerang): the boomerang flies out to the target and back to the thrower's current position
 * (fx.js 'boomerang' flight: _stepBoomerang), caught there.
 */
function boomerang(fx, c) {
  const { src, tgt } = c;
  const spec = PROJ[c.kind];
  if (!src || !spec || !tgt) return;
  fx.shoot(src, tgt, c.kind, spec, 'boomerang');
}

/**
 * 蕾缪安 S3 / S2 (sim content/kits/tier6.js): fx 'lock' keeps a reticle on the locked enemy (`id`; following its view,
 * at the last spot once it is gone) for shooter `src` until the 'bombard' of the shell fired at it, the aimed shot
 * ('crit' from the same shooter) or LOCK_T game s after the shooter's last lock / shell / bombard (fx.js _lock).
 */
function lemuenLock(fx, c) {
  const a = fxSite(fx, c);
  if (!a) return;
  // `id` is always the locked enemy: the reticle sticks to its view even a little off the event's spot
  const lv = a.at.v || fx._viewOf(a.ex.id);
  fx._touchLocks(a.ex.src ?? null);
  fx._lock(lv, a.ex.src ?? null, lv ? lv.x : a.at.x, lv ? lv.y : a.at.y, lv ? fx.aimZ(lv) : a.at.z + 0.55);
}

/**
 * 蕾缪安 S3 'bombardShell': a shell fired now by `id` lands on (x, y) after `t` game seconds (fx.js mortar); it takes the
 * shooter's free lock nearest to that spot — the lock ends with this shell's 'bombard' (lemuenBombard).
 */
function lemuenShell(fx, c) {
  const a = fxSite(fx, c);
  if (!a) return;
  const flight = num(a.ex.t ?? a.ex.flight ?? a.ex.dur ?? a.ex.duration, 1) / a.ts;
  fx._touchLocks(a.ex.id ?? a.ex.src ?? null);
  const src = fx._viewOf(a.ex.id ?? a.ex.src);
  fx.mortar(src, a.at.x, a.at.y, a.r, flight);
  const L = fx._nearestLock(src ? src.id : null, a.at.x, a.at.y, 3, true);
  if (L) { L.shell = true; L.sx = a.at.x; L.sy = a.at.y; }
}

/**
 * 蕾缪安 S3 'bombard' (the impact) at (x, y) by shooter `id`: the shell falling there has landed (ended now if still in
 * the air) and its lock goes — the lock that shell took, found by the landing point (the sim uses the same spot for
 * both events); a sim without 'bombardShell' releases the shooter's lock nearest to the spot. Then the blast (next).
 */
function lemuenBombard(fx, c, next) {
  const a = fxSite(fx, c);
  if (a && a.spec.a === 'blast' && a.r < 12) {
    const src = a.ex.id ?? a.ex.src ?? null;
    const { x, y } = a.at;
    fx._touchLocks(src);
    fx.landShells(src, x, y);
    let best = null, bd = Infinity;
    for (const L of fx.locks) {
      if (L.out >= 0 || (src != null && L.src != null && L.src !== src)) continue;
      const d = L.shell ? Math.hypot(L.sx - x, L.sy - y) : Math.hypot(L.x - x, L.y - y) + 0.5;
      if (d < bd) { bd = d; best = L; }
    }
    if (best && bd <= a.r + 1.5) fx._releaseLock(best);
  }
  next();
}

/** 蕾缪安 S2: the aimed snipe ('crit' on the locked enemy `id`, from her `src`) ends that aim lock. Then the crit (next). */
function lemuenAimedShot(fx, c, next) {
  const a = fxSite(fx, c);
  if (a && a.ex.src != null && a.ex.id != null) {
    for (const L of fx.locks) if (L.src === a.ex.src && L.id === a.ex.id) fx._releaseLock(L);
  }
  next();
}

/**
 * 炎佑 祛恶之焰 'yanyouFlame' (sim/content/tokens.js yanyouKit; user playtest #4 item 12): one event per game second of
 * the channel keeps the dragon's (`id`) jet burning onto its locked target (`target`) — fx.js _flame joins the ticks
 * into one continuous stream with a burning disc under the target.
 */
function yanyouFlame(fx, c) {
  const a = fxSite(fx, c);
  if (a) FX_ARCHETYPES.flame(fx, a);
}

// ---- extracted original-client VFX ---------------------------------------------------------------------------
// These bindings come from the extracted charpack / [uc]skills action data. A prefab is only played when the source
// data names it for this event slot. In particular, a prefab that merely exists in the effects bundle is not treated
// as a hit or projectile binding. Calling `next()` is intentional only for a role that has no extracted binding.

const ROSMON_CHAR = 'char_391_rosmon';
const ROSMON_SKILL_CASTS = Object.freeze({ skchr_rosmon_3: ['rosmon_skill_03_start'] });
// `battle/prefabs/[uc]projectiles.ab` is the authoritative binding for these effects.  The start effect is
// owned by the shooter, while `_effectsToTargetWhenStart`, `_effectsWhenReached`, and `_effectsWhenHit` are
// target-side slots.  Keeping the three slots separate is what prevents Rosmontis' sword/impact from landing on
// her own root.
const ROSMON_SKILL_ATTACKS = Object.freeze({
  skchr_rosmon_1: Object.freeze({ starts: ['rosmon_skill_01_A_start', 'rosmon_skill_01_A_start_02'], targetStart: ['rosmon_skill_01_A_hit_01'], reach: ['rosmon_skill_01_A_range'], hit: ['rosmon_skill_01_A_hit_02'] }),
  skchr_rosmon_2: Object.freeze({ starts: ['rosmon_skill_02_start'], targetStart: ['rosmon_skill_02_range'], reach: ['rosmon_skill_02_range_02'], hit: ['rosmon_attack_A_hit_02'] }),
  skchr_rosmon_3: Object.freeze({ starts: ['rosmon_skill_03_start_02'], targetStart: ['rosmon_skill_03_B_hit_01', 'rosmon_skill_03_B_hit_01_stone'], reach: ['rosmon_skill_03_range'], hit: ['rosmon_attack_A_hit_02'] }),
});
const ROSMON_NORMAL_ATTACKS = Object.freeze([
  Object.freeze({ starts: ['rosmon_attack_A_start', 'rosmon_attack_A_start_02'], targetStart: ['rosmon_attack_A_hit_01'], reach: ['rosmon_attack_A_range'], hit: ['rosmon_attack_A_hit_02'] }),
  Object.freeze({ starts: ['rosmon_attack_B_start', 'rosmon_attack_A_start_02'], targetStart: ['rosmon_attack_B_hit_01'], reach: ['rosmon_attack_A_range'], hit: ['rosmon_attack_A_hit_02'] }),
]);
const ROSMON_ATTACK_TURN = new Map();
const ROSMON_ATTACK_SPECS = new Map();
const ROSMON_LAST_SPEC = new Map();

function sourceMount(fx, view, prefab, delay = 0) {
  // These are action `_castEffects`, whose extracted records carry no mount-point or bone name. The original effect
  // runner therefore receives the action owner/root; the separate `_mountPointType` fields belong to projectile
  // actions and are not evidence for attaching this cast effect to a hand or muzzle.
  return fx.playOriginalVfx(prefab, { followId: view.id, anchor: 'root', mirror: true, delay });
}

/** Skill start is an ability-level effect only for Rosmontis S3. S1/S2 are action cast effects below. */
function rosmonSkill(fx, c) {
  const v = c.view;
  if (!v) return;
  const skill = c.skillId || c.who?.skill;
  const group = `rosmon:skill:${v.id}`;
  if (!c.on) { fx.stopOriginalVfx(group); return; }
  for (const [i, prefab] of (ROSMON_SKILL_CASTS[skill] || []).entries()) {
    fx.playOriginalVfx(prefab, { followId: v.id, anchor: 'root', mirror: true, group, delay: i * 0.05 });
  }
}

function rememberRosmonSpec(c, spec) {
  if (!c.src || !spec) return;
  const record = { view: c.src, spec };
  ROSMON_LAST_SPEC.set(c.src.id, record);
  if (c.attackId != null && c.attackId !== 0) ROSMON_ATTACK_SPECS.set(`${c.src.id}:${c.attackId}`, record);
}

function rosmonSpecForDamage(c) {
  const attacker = c.src || c.attacker;
  if (!attacker) return null;
  const record = (c.attackId != null && c.attackId !== 0 ? ROSMON_ATTACK_SPECS.get(`${attacker.id}:${c.attackId}`) : null)
    || ROSMON_LAST_SPEC.get(attacker.id) || null;
  return record?.view === attacker ? record.spec : null;
}

function targetMount(fx, view, prefab, delay = 0) {
  if (!view) return false;
  return fx.playOriginalVfx(prefab, { followId: view.id, anchor: 'root', mirror: false, delay });
}

function rosmonAttack(fx, c, next) {
  if (!c.src) { next(); return; }
  const skill = c.isSkill ? c.who?.skill : null;
  let spec = skill ? ROSMON_SKILL_ATTACKS[skill] : null;
  if (!spec) {
    const turn = ROSMON_ATTACK_TURN.get(c.src.id) || 0;
    ROSMON_ATTACK_TURN.set(c.src.id, turn + 1);
    spec = ROSMON_NORMAL_ATTACKS[turn % ROSMON_NORMAL_ATTACKS.length];
  }
  rememberRosmonSpec(c, spec);
  for (const [i, prefab] of spec.starts.entries()) sourceMount(fx, c.src, prefab, i * 0.04);
  // `_effectsToTargetWhenStart` is explicitly target-side in the projectile prefab.  This is the large sword /
  // target telegraph that was previously (incorrectly) played on the operator.
  for (const [i, prefab] of spec.targetStart.entries()) targetMount(fx, c.tgt, prefab, i * 0.02);
  // The extracted Attack/Skill action owns this cue; do not add the upstream generic projectile on top of it.
}

function rosmonDamage(fx, c, next) {
  const spec = rosmonSpecForDamage(c);
  if (!spec || !c.view) { next(); return; }
  // The projectile prefab names both its reached and hit effects.  At the renderer's damage point they share the
  // target root; preserve their ordering without falling through to the generic hit flash.
  for (const [i, prefab] of [...spec.reach, ...spec.hit].entries()) targetMount(fx, c.view, prefab, i * 0.015);
}

// 锏's [uc]skills actions name all S1/S2 cast and target-hit effects.  S3's server-side action emits the same
// semantic sequence as the extracted client slots: `skill` → repeated `fx:slash` + `dmg` → `fx:finale` + `dmg`.
const BLKKGT_CHAR = 'char_4116_blkkgt';
const BLKKGT_SKILLS = Object.freeze({
  skchr_blkkgt_1: Object.freeze({ starts: ['blkkgt_skill_01_start_01', 'blkkgt_skill_01_start_02', 'blkkgt_skill_01_start_03'], hits: ['blkkgt_skill_01_hit_01', 'blkkgt_skill_01_hit_02'] }),
  skchr_blkkgt_2: Object.freeze({ starts: ['blkkgt_skill_02_start_01', 'blkkgt_skill_02_start_02', 'blkkgt_skill_02_start_03', 'blkkgt_skill_02_start_05', 'blkkgt_skill_02_start_06'], hits: ['blkkgt_skill_02_hit_1'] }),
  skchr_blkkgt_3: Object.freeze({ starts: ['blkkgt_skill_03_start_01', 'blkkgt_skill_03_start_02'], hits: ['blkkgt_skill_03_hit_1'], endStarts: ['blkkgt_skill_03_end', 'blkkgt_skill_03_start_03', 'blkkgt_skill_03_start_04'], endHits: ['blkkgt_skill_03_hit_2'] }),
});
const BLKKGT_HIT_INDEX = new Map();
const BLKKGT_ACTIVE = new Map();
const BLKKGT_S3_FINAL = new Set();

function blkkgtSkill(fx, c) {
  if (!c.view) return;
  const group = `blkkgt:skill:${c.view.id}`;
  if (c.on) {
    const skill = c.skillId || c.who?.skill;
    BLKKGT_ACTIVE.set(c.view.id, { view: c.view, skill: skill || null });
    BLKKGT_S3_FINAL.delete(c.view.id);
    if (skill === 'skchr_blkkgt_3') {
      c.view.setOriginalVfxHidden?.(true);
      for (const [i, prefab] of BLKKGT_SKILLS.skchr_blkkgt_3.starts.entries()) fx.playOriginalVfx(prefab, { followId: c.view.id, anchor: 'root', mirror: true, group, delay: i * 0.04 });
    }
    return;
  }
  BLKKGT_ACTIVE.delete(c.view.id);
  BLKKGT_S3_FINAL.delete(c.view.id);
  c.view.setOriginalVfxHidden?.(false);
  fx.stopOriginalVfx(group);
}

function blkkgtAttack(fx, c, next) {
  if (!c.src) { next(); return; }
  const skill = c.isSkill ? c.who?.skill : null;
  const binding = skill ? BLKKGT_SKILLS[skill] : null;
  // S3 has no ordinary `atk` event: its loop and finisher are emitted as `fx`/`dmg` by the server skill.
  if (skill === 'skchr_blkkgt_3') return;
  const prefabs = binding?.starts || ['blkkgt_attack_start_01'];
  for (const [i, prefab] of prefabs.entries()) sourceMount(fx, c.src, prefab, i * 0.035);
  if (skill === 'skchr_blkkgt_2') {
    const vertical = c.src.dir === 'UP' || c.src.dir === 'DOWN';
    sourceMount(fx, c.src, vertical ? 'blkkgt_skill_02_start_04_v' : 'blkkgt_skill_02_start_04_h', 0.105);
  }
}

function blkkgtFx(fx, c, next) {
  const id = c.extra?.id ?? c.unitId ?? null;
  const activeRecord = id != null ? BLKKGT_ACTIVE.get(id) : null;
  const active = activeRecord?.view === fx._viewOf?.(id) ? activeRecord.skill : null;
  const binding = active ? BLKKGT_SKILLS[active] : null;
  if (!binding) { next(); return; }
  // Both S2's direct slash burst and S3's ten loop slashes have their target-side visual in the following `dmg`
  // events.  Suppress the old source-centred generic slash so the two systems are never mixed.
  if (c.kind === 'slash') return;
  if (c.kind === 'finale' && active === 'skchr_blkkgt_3') {
    BLKKGT_S3_FINAL.add(id);
    for (const [i, prefab] of (binding.endStarts || []).entries()) sourceMount(fx, c.extra?.id != null ? fx._viewOf(c.extra.id) : c.unit, prefab, i * 0.035);
    return;
  }
  next();
}

function blkkgtDamage(fx, c, next) {
  if (!c.view) { next(); return; }
  const owner = c.src || c.attacker;
  const activeRecord = owner ? BLKKGT_ACTIVE.get(owner.id) : null;
  const active = activeRecord?.view === owner ? activeRecord.skill : null;
  const skill = active || (c.isSkill ? c.who?.skill : null);
  const binding = skill ? BLKKGT_SKILLS[skill] : null;
  if (!binding?.hits?.length) { next(); return; }
  if (skill === 'skchr_blkkgt_3' && owner && BLKKGT_S3_FINAL.has(owner.id)) {
    for (const prefab of binding.endHits || []) targetMount(fx, c.view, prefab);
    BLKKGT_S3_FINAL.delete(owner.id);
    owner.setOriginalVfxHidden?.(false);
    return;
  }
  const key = `${c.src?.id ?? c.attacker?.id ?? ''}:${c.attackId ?? ''}`;
  const hitIndex = BLKKGT_HIT_INDEX.get(key) || 0;
  BLKKGT_HIT_INDEX.set(key, hitIndex + 1);
  const prefab = binding.hits[Math.min(hitIndex, binding.hits.length - 1)];
  fx.playOriginalVfx(prefab, { followId: c.view.id, anchor: 'root' });
  // `_hitGroups` / `_hitEffects` are target slots in [uc]skills, so the generic hit is not also emitted here.
}

/** Sub-professions whose attacks splash around the struck target (the 阵法术师 / 轰击术师 strike every enemy in range). */
export const SPLASH_SUBS = Object.freeze(['aoesniper', 'splashcaster', 'bombarder', 'fortress', 'hammer']);

/**
 * A splash attacker's blow (the attacker the renderer paired with the hit — the melee slash's): an AoE ring on the
 * ground around the struck unit, after the default hit (next).
 */
function splashRing(fx, c, next) {
  next();
  if (c.src && c.view) fx.splashRing(c.view, c.type);
}

/**
 * The built-in registrations: [channel, match, recipe]. `match` = { kind } (kind layer) | { sub } (sub-profession
 * layer) | {} (the default, kind '*'). Later registrations (an operator's or a skill's own recipe:
 * { char } / { char, skill }) take precedence over all of these.
 */
export const BUILTIN_FX = Object.freeze([
  ...Object.entries(DEFAULT_RECIPES).map(([channel, recipe]) => [channel, {}, recipe]),
  ['atk', { kind: 'chain' }, chainArc],
  ['atk', { kind: 'chainHeal' }, chainArc],
  ['atk', { kind: 'beam' }, beamShot],
  ['atk', { kind: 'boomerang' }, boomerang],
  ['fx', { kind: 'lock' }, lemuenLock],
  ['fx', { kind: 'bombardShell' }, lemuenShell],
  ['fx', { kind: 'bombard' }, lemuenBombard],
  ['fx', { kind: 'crit' }, lemuenAimedShot],
  ['fx', { kind: 'yanyouFlame' }, yanyouFlame],
  ['skill', { char: ROSMON_CHAR, kind: 'on' }, rosmonSkill],
  ['skill', { char: ROSMON_CHAR, kind: 'off' }, rosmonSkill],
  ['atk', { char: ROSMON_CHAR }, rosmonAttack],
  ['dmg', { char: ROSMON_CHAR }, rosmonDamage],
  ['skill', { char: BLKKGT_CHAR, kind: 'on' }, blkkgtSkill],
  ['skill', { char: BLKKGT_CHAR, kind: 'off' }, blkkgtSkill],
  ['atk', { char: BLKKGT_CHAR }, blkkgtAttack],
  ['dmg', { char: BLKKGT_CHAR }, blkkgtDamage],
  ['fx', { char: BLKKGT_CHAR, kind: 'slash' }, blkkgtFx],
  ['fx', { char: BLKKGT_CHAR, kind: 'finale' }, blkkgtFx],
  ...SPLASH_SUBS.map((sub) => ['dmg', { sub }, splashRing]),
]);

/** Register the built-ins on `registry` (render/fxRegistry.js FxRegistry); returns it. */
export function registerBuiltinFx(registry) {
  for (const [channel, match, recipe] of BUILTIN_FX) registry.register(channel, match, recipe);
  return registry;
}
