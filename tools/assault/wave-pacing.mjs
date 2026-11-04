#!/usr/bin/env node
// Assault spawn pacing: metrics and the deterministic generator for the 36 encounter waves.
//
//   node tools/assault/wave-pacing.mjs report  [--encounters <abs>] [--out <abs.json>]
//   node tools/assault/wave-pacing.mjs rebuild [--encounters <abs>]
//
// The generator only rewrites wave.spawns (plus the pacing record and the count/time phrases of
// the encounter texts). Enemy definitions, the per-type budget calibration in wave.overrides,
// routes, rewards and mechanics stay untouched. The first rebuild records each encounter's
// pre-pacing roster in wave.pacing.baseRoster, so every later rebuild starts from the same roster
// and yields byte-identical output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyChapterSets } from './chapter-enemy-sets.mjs';
import { enemyDayScale } from '../../shared/assault/battle-input.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ENCOUNTERS_PATH = path.join(ROOT, 'data/assault-design/encounters.json');

// Curves (one value per day band: days 1-2, 3-4, 5-6, 7-8, 9-10; finals use the last band).
export const PACING = Object.freeze({
  schema: 'assault-wave-pacing/v1',
  // Every value below was checked with tools/assault/wave-replay.mjs (3 lineups x 2 star levels on all 36
  // encounters, before / after win rate and remaining life): overall win rate 46% -> 47%, life 14.7 -> 14.1.
  // Unit count multiplier on the calibrated roster: +3% per band, so day 9-10 brings 12% more enemies
  // (a single-lineup replay lost its day 9-10 normal win at +4%; +2% per band replayed no easier than +3%).
  countCurve: [1, 1.03, 1.06, 1.09, 1.12],
  // Mean per-unit HP multiplier on top of the per-type budget calibration: +1.5% per band, day 9-10 +6%.
  hpCurve: [1, 1.015, 1.03, 1.045, 1.06],
  // Spawn density over the spawn span u in [0,1] (relative rates, normalised): a flat sparse opening
  // (u < openingEnd, ~8% of the units in the first fifth), then a linear rise from densityMid to densityEnd
  // (~45% of the units in the last third). A plain 0.3 -> 1.7 ramp piled up the tail; 0.5 -> 1.5 left the
  // first two fifths a unit apart in small fights.
  openingEnd: 0.2,
  densityOpen: 0.4,
  densityMid: 0.8,
  densityEnd: 1.5,
  // Within one battle the per-unit HP ramps linearly from early to late spawns (mean kept by normalisation);
  // +-7.5% is enough for "weak first" without a tail spike.
  hpRampStart: 0.925,
  hpRampEnd: 1.075,
  // A first fifth that still outweighs a later one is scaled to this share of the weakest later fifth.
  openingHpCap: 0.95,
  // Highlight elites appear only in the second half of the spawn span.
  lateStart: 0.55,
  lateEnd: 0.95,
  // The final boss enters right after the first escorts, as in the original final waves: its shared HP pool
  // needs most of the 120 s. Entering at 0.55 dropped the replayed finals from 4/36 to 1/36 wins (timeouts).
  bossAt: 0.1,
  // Interleaving: in any 20 s window with at least minWindowUnits non-boss enemies, one type holds <= maxShare.
  shareWindowSec: 20,
  minWindowUnits: 3,
  maxShare: 0.5,
  // Type preference exponent by unit strength (weakest -> strongest); >1 pushes a type later.
  orderGammaWeak: 0.8,
  orderGammaStrong: 1.35,
  // The paced wave ends its spawns earlier than the original (span x spanScale), so the dense tail still has time to be cleared.
  spanScale: 0.85,
  spawnEndCap: 90,
  minGap: 0.3,
});

export function bandOf(encounter) {
  if (encounter.kind === 'final') return 4;
  return Math.max(0, Math.min(4, Math.floor((encounter.dayRange[0] - 1) / 2)));
}

export function loadNative(root = ROOT) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'data', name), 'utf8'));
  return { enemies: { ...read('enemies.json'), ...read('assault-runtime.json').auxiliaryEnemies }, bosses: read('bosses.json') };
}

const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

function enemyKeyOf(encounter, key, native) {
  if (key === encounter.wave.bossId && native.bosses[key]) return native.bosses[key].enemyKey;
  return key;
}

/** Calibrated HP of one unit of `key` before the per-spawn pacing scale. */
export function baseUnitHp(encounter, key, native) {
  const enemyKey = enemyKeyOf(encounter, key, native);
  const enemy = native.enemies[enemyKey];
  if (!enemy) throw new Error(`${encounter.id}: unknown enemy ${key}`);
  const st = (encounter.wave.overrides?.[key] ?? encounter.wave.overrides?.[enemyKey])?.stats ?? {};
  if (key === encounter.wave.bossId) return Number(st.sharedPoolHp ?? st.maxHp ?? enemy.stats.maxHp);
  if (st.hpMode === 'absolute') return Number(enemy.stats.maxHp);
  // the strength of the encounter's first day (wave.dayScale) is part of the calibrated HP the battle fields
  return Number(enemy.stats.maxHp) * Number(st.maxHp ?? 1) * Number(enemyDayScale(encounter.wave, encounter.dayRange?.[0])?.hp ?? 1);
}

export function rankOf(encounter, key, native) {
  if (key === encounter.wave.bossId) return 'BOSS';
  return native.enemies[key]?.rank ?? 'NORMAL';
}

/** Expand spawn blocks to individual units in time order. */
export function expandSpawns(encounter, native) {
  const units = [];
  encounter.wave.spawns.forEach((spawn, block) => {
    const hp = baseUnitHp(encounter, spawn.key, native) * Number(spawn.hpScale ?? 1);
    for (let i = 0; i < spawn.count; i += 1) {
      units.push({ t: round(spawn.time + i * spawn.interval, 3), key: spawn.key, hp, block,
        boss: spawn.key === encounter.wave.bossId, routeIndex: spawn.routeIndex });
    }
  });
  return units.sort((a, b) => a.t - b.t || a.block - b.block);
}

/** Highlight types: rare elites (and the boss) that the generator keeps in the late part. */
export function highlightKeys(encounter, roster, native) {
  const total = roster.reduce((sum, entry) => sum + entry.count, 0);
  return new Set(roster.filter((entry) => entry.key === encounter.wave.bossId
    || (rankOf(encounter, entry.key, native) !== 'NORMAL' && entry.count <= Math.max(2, Math.floor(total * 0.08))))
    .map((entry) => entry.key));
}

export function deriveRoster(encounter) {
  const byKey = new Map();
  const ordered = [...encounter.wave.spawns].map((spawn, index) => ({ spawn, index }))
    .sort((a, b) => a.spawn.time - b.spawn.time || a.index - b.index);
  for (const { spawn } of ordered) {
    if (!byKey.has(spawn.key)) {
      const extra = Object.fromEntries(Object.entries(spawn).filter(([key]) => !['time', 'key', 'count', 'interval', 'routeIndex', 'hpScale'].includes(key)));
      byKey.set(spawn.key, { key: spawn.key, count: 0, routes: [], ...(Object.keys(extra).length ? { extra } : {}) });
    }
    const entry = byKey.get(spawn.key);
    entry.count += spawn.count;
    for (let i = 0; i < spawn.count; i += 1) entry.routes.push(spawn.routeIndex);
  }
  const units = encounter.wave.spawns.flatMap((spawn) => Array.from({ length: spawn.count }, (_, i) => spawn.time + i * spawn.interval));
  return { roster: [...byKey.values()], span: [round(Math.min(...units), 3), round(Math.max(...units), 3)] };
}

/** Roster used as the generator input and as the test baseline. */
export function baseOf(encounter) {
  const pacing = encounter.wave.pacing;
  if (pacing?.baseRoster) return { roster: pacing.baseRoster, span: pacing.baseSpan };
  return deriveRoster(encounter);
}

// ---------------------------------------------------------------------------------------------
// Metrics

export function windowSeries(units, size = 10, start = 0, end = 120) {
  const windows = [];
  for (let a = start; a < end; a += size) {
    const inside = units.filter((unit) => unit.t >= a && unit.t < a + size);
    const byType = {};
    for (const unit of inside) byType[unit.key] = (byType[unit.key] ?? 0) + 1;
    windows.push({ from: a, to: a + size, count: inside.length, hp: Math.round(inside.reduce((sum, unit) => sum + unit.hp, 0)), byType });
  }
  return windows;
}

/** Every distinct unit set a [a, a+size] window can hold (a swept on the 0.05 s grid). */
export function slidingWindows(units, size) {
  const times = units.map((unit) => unit.t);
  if (!times.length) return [];
  const seen = new Set();
  const result = [];
  const step = 0.05;
  for (let a = Math.floor((times[0] - size) / step) * step; a <= times[times.length - 1] + step; a += step) {
    const lo = a - 1e-9, hi = a + size + 1e-9;
    let first = -1, last = -1;
    for (let i = 0; i < times.length; i += 1) if (times[i] >= lo && times[i] <= hi) { if (first < 0) first = i; last = i; }
    if (first < 0) continue;
    const id = `${first}:${last}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({ from: round(a, 2), first, last, units: units.slice(first, last + 1) });
  }
  return result;
}

export function maxTypeShare(units, { windowSec = PACING.shareWindowSec, minUnits = PACING.minWindowUnits } = {}) {
  const pool = units.filter((unit) => !unit.boss);
  let worst = { share: 0, count: 0, key: null, from: null };
  for (const window of slidingWindows(pool, windowSec)) {
    if (window.units.length < minUnits) continue;
    const byType = {};
    for (const unit of window.units) byType[unit.key] = (byType[unit.key] ?? 0) + 1;
    for (const [key, count] of Object.entries(byType)) {
      const share = count / window.units.length;
      if (share > worst.share + 1e-12) worst = { share: round(share, 4), count: window.units.length, key, from: window.from };
    }
  }
  return worst;
}

export function segmentStats(units, span, parts) {
  const [t0, t1] = span;
  const width = (t1 - t0) / parts;
  return Array.from({ length: parts }, (_, index) => {
    const lo = t0 + index * width, hi = index === parts - 1 ? t1 + 1e-9 : t0 + (index + 1) * width;
    const inside = units.filter((unit) => !unit.boss && unit.t >= lo - 1e-9 && unit.t < hi);
    return { from: round(lo, 2), to: round(Math.min(hi, t1), 2), count: inside.length,
      hp: Math.round(inside.reduce((sum, unit) => sum + unit.hp, 0)) };
  });
}

export function encounterMetrics(encounter, native) {
  const units = expandSpawns(encounter, native);
  const regular = units.filter((unit) => !unit.boss);
  const span = [Math.min(...units.map((unit) => unit.t)), Math.max(...units.map((unit) => unit.t))];
  const shares = {};
  for (const unit of units) shares[unit.key] = (shares[unit.key] ?? 0) + 1;
  const keys = Object.keys(shares);
  const late = highlightKeys(encounter, baseOf(encounter).roster, native);
  const lateUnits = units.filter((unit) => late.has(unit.key));
  const windows10 = windowSeries(units, 10);
  const densest = windows10.reduce((best, window) => (window.count > best.count ? window : best), windows10[0]);
  return {
    id: encounter.id, kind: encounter.kind, dayRange: encounter.dayRange, band: bandOf(encounter),
    total: units.length, types: keys.length,
    totalHp: Math.round(regular.reduce((sum, unit) => sum + unit.hp, 0)),
    bossHp: Math.round(units.filter((unit) => unit.boss).reduce((sum, unit) => sum + unit.hp, 0)),
    span: span.map((value) => round(value, 2)),
    typeShare: Object.fromEntries(keys.map((key) => [key, round(shares[key] / units.length, 4)])),
    windows10,
    segments5: segmentStats(units, span, 5),
    thirds: segmentStats(units, span, 3),
    densest10: { from: densest.from, count: densest.count },
    maxShare20: maxTypeShare(units),
    lateUnits: lateUnits.map((unit) => ({ key: unit.key, t: unit.t, u: round((unit.t - span[0]) / Math.max(1e-9, span[1] - span[0]), 3) })),
  };
}

export function dayMetrics(metrics) {
  const days = [];
  for (let day = 1; day <= 10; day += 1) {
    const pool = metrics.filter((entry) => entry.kind !== 'final' && day >= entry.dayRange[0] && day <= entry.dayRange[1]);
    const summary = (kind) => {
      const list = pool.filter((entry) => entry.kind === kind);
      if (!list.length) return null;
      const mean = (pick) => Math.round(list.reduce((sum, entry) => sum + pick(entry), 0) / list.length);
      return { encounters: list.length, meanCount: mean((entry) => entry.total), meanHp: mean((entry) => entry.totalHp),
        meanPeak10Hp: mean((entry) => Math.max(...entry.windows10.map((window) => window.hp))) };
    };
    days.push({ day, normal: summary('normal'), risk: summary('risk') });
  }
  const finals = metrics.filter((entry) => entry.kind === 'final');
  days.push({ day: 'final', final: { encounters: finals.length,
    meanCount: Math.round(finals.reduce((sum, entry) => sum + entry.total, 0) / finals.length),
    meanEscortHp: Math.round(finals.reduce((sum, entry) => sum + entry.totalHp, 0) / finals.length) } });
  return days;
}

// ---------------------------------------------------------------------------------------------
// Generator

/** Share of the units spawned by u (cumulative of the density curve, normalised to 1 at u = 1). */
function densityCdf(u) {
  const { openingEnd: o, densityOpen: r0, densityMid: r1, densityEnd: r2 } = PACING;
  const raw = (x) => (x <= o ? r0 * x
    : r0 * o + (x - o) * (r1 + (r1 + (r2 - r1) * (x - o) / (1 - o))) / 2);
  return raw(u) / raw(1);
}

function densityInverse(y) {
  let lo = 0, hi = 1;
  for (let k = 0; k < 50; k += 1) { const mid = (lo + hi) / 2; if (densityCdf(mid) < y) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

function scaledCount(entry, factor, highlight) {
  if (highlight || entry.count < 4) return entry.count;
  return Math.max(entry.count, Math.round(entry.count * factor));
}

export function rebuildEncounter(encounter, native) {
  const base = baseOf(encounter);
  const band = bandOf(encounter);
  const countFactor = PACING.countCurve[band];
  const hpFactor = PACING.hpCurve[band];
  const bossId = encounter.wave.bossId ?? null;
  const late = highlightKeys(encounter, base.roster, native);
  const roster = base.roster.map((entry) => ({ ...entry, count: scaledCount(entry, countFactor, late.has(entry.key)) }));
  const t0 = round(Math.max(5, Math.min(15, base.span[0])), 1);
  const t1 = round(Math.min(PACING.spawnEndCap, Math.max(t0 + (base.span[1] - t0) * PACING.spanScale, t0 + 40)), 1);
  const width = t1 - t0;

  const boss = roster.find((entry) => entry.key === bossId) ?? null;
  const highlights = roster.filter((entry) => late.has(entry.key) && entry.key !== bossId);
  const mass = roster.filter((entry) => !late.has(entry.key));
  const slotCount = roster.filter((entry) => entry.key !== bossId).reduce((sum, entry) => sum + entry.count, 0);

  // 1. Slot times from the rising density curve; strictly increasing on a 0.1 s grid.
  const times = [];
  for (let i = 0; i < slotCount; i += 1) {
    let t = round(t0 + width * densityInverse((i + 0.5) / slotCount), 1);
    if (times.length && t < times[times.length - 1] + PACING.minGap) t = round(times[times.length - 1] + PACING.minGap, 1);
    times.push(t);
  }
  if (times[times.length - 1] > PACING.spawnEndCap + 5) throw new Error(`${encounter.id}: slots overflow the spawn window`);
  const uOf = (t) => (t - t0) / width;

  // 2. Highlight elites take evenly spread slots of the late part.
  const assigned = new Array(slotCount).fill(null);
  const lateSlots = times.map((t, i) => [t, i]).filter(([t]) => uOf(t) >= PACING.lateStart - 1e-9 && uOf(t) <= PACING.lateEnd + 1e-9).map(([, i]) => i);
  const lateUnits = [];
  for (const entry of [...highlights].sort((a, b) => baseUnitHp(encounter, a.key, native) - baseUnitHp(encounter, b.key, native) || a.key.localeCompare(b.key))) {
    for (let k = 0; k < entry.count; k += 1) lateUnits.push(entry.key);
  }
  // interleave highlight kinds so equal elites do not land back to back
  const lateOrder = [];
  const lateBuckets = new Map();
  for (const key of lateUnits) lateBuckets.set(key, (lateBuckets.get(key) ?? 0) + 1);
  while (lateOrder.length < lateUnits.length) {
    for (const [key, left] of lateBuckets) if (left > 0) { lateOrder.push(key); lateBuckets.set(key, left - 1); }
  }
  if (lateOrder.length > lateSlots.length) throw new Error(`${encounter.id}: not enough late slots for highlight elites`);
  lateOrder.forEach((key, k) => {
    // sqrt spacing leans the elites toward the end of the late part
    const pick = lateSlots[Math.min(lateSlots.length - 1, Math.floor(Math.sqrt((k + 1) / (lateOrder.length + 1)) * lateSlots.length))];
    let slot = pick;
    while (assigned[slot] != null) slot += 1;
    assigned[slot] = key;
  });

  // 3. Mass types fill the remaining slots: each type follows its own cumulative target v^gamma
  //    (weak types lean early, strong types lean late) while no 20 s window lets one type exceed the share cap.
  const strength = mass.map((entry) => ({ key: entry.key, hp: baseUnitHp(encounter, entry.key, native) }))
    .sort((a, b) => a.hp - b.hp || a.key.localeCompare(b.key));
  const gamma = new Map(strength.map((entry, index) => [entry.key, strength.length === 1 ? 1
    : PACING.orderGammaWeak + (PACING.orderGammaStrong - PACING.orderGammaWeak) * index / (strength.length - 1)]));
  const need = new Map(mass.map((entry) => [entry.key, entry.count]));
  const placed = new Map(mass.map((entry) => [entry.key, 0]));
  const massTotal = mass.reduce((sum, entry) => sum + entry.count, 0);
  let massDone = 0;
  const windowFirst = (i) => { let k = i; while (k > 0 && times[i] - times[k - 1] <= PACING.shareWindowSec + 1e-9) k -= 1; return k; };
  const violates = (i, key) => {
    // every window ending at slot i: suffixes [k..i] that some [a, a+20] window can hold exactly
    const first = windowFirst(i);
    for (let k = first; k <= i; k += 1) {
      const size = i - k + 1;
      if (size < PACING.minWindowUnits) continue;
      // a window holding exactly slots k..i must start after slot k-1 and end before slot i+1
      if (k > 0 && i + 1 < slotCount && times[i + 1] - times[k - 1] <= PACING.shareWindowSec + 1e-9) continue;
      let same = 1;
      for (let j = k; j < i; j += 1) if (assigned[j] === key) same += 1;
      if (same / size > PACING.maxShare + 1e-9) return true;
    }
    return false;
  };
  for (let i = 0; i < slotCount; i += 1) {
    if (assigned[i] != null) continue;
    const v = (massDone + 1) / massTotal;
    const candidates = mass.filter((entry) => placed.get(entry.key) < need.get(entry.key)).map((entry) => ({
      key: entry.key, deficit: need.get(entry.key) * v ** gamma.get(entry.key) - placed.get(entry.key),
      remaining: need.get(entry.key) - placed.get(entry.key),
    })).sort((a, b) => b.deficit - a.deficit || b.remaining - a.remaining || a.key.localeCompare(b.key));
    const ok = candidates.find((candidate) => !violates(i, candidate.key));
    const choice = ok ?? candidates[0];
    assigned[i] = choice.key;
    placed.set(choice.key, placed.get(choice.key) + 1);
    massDone += 1;
  }

  // 3b. The last few spawns form 20 s windows of their own (nothing follows them), so the tail is
  //     re-sequenced backwards: every suffix keeps one type at or under the share cap.
  repairTail(assigned, times, late);

  // 4. Per-unit HP: band factor times an early-to-late ramp, normalised to keep the band mean.
  const ramp = (t) => PACING.hpRampStart + (PACING.hpRampEnd - PACING.hpRampStart) * Math.max(0, Math.min(1, uOf(t)));
  const bossTimes = boss ? Array.from({ length: boss.count }, (_, k) => round(t0 + width * PACING.bossAt + k * 2, 1)) : [];

  // 4a. With few units per fifth the type mix can leave a fifth weaker than an earlier one; swap mass
  //     units between fifths (times stay, the share cap still holds) until the fifths' HP rises.
  const span = [Math.min(times[0], ...bossTimes), Math.max(times[times.length - 1], ...bossTimes)];
  smoothFifths(assigned, times, late, (key, t) => baseUnitHp(encounter, key, native) * ramp(t), span);
  const baseHp = assigned.map((key) => baseUnitHp(encounter, key, native));
  const shape = times.map((t) => ramp(t));
  // 4b. When the share cap forces every type into the opening (three types, three units), the first fifth
  //     can still outweigh the second; its units then take a lower scale so the opening stays the weakest.
  const fifthHp = () => segmentStats(assigned.map((key, i) => ({ key, t: times[i], hp: baseHp[i] * shape[i] })), span, 5).map((part) => part.hp);
  const fifths = fifthHp();
  const weakestLater = Math.min(...fifths.slice(1));
  if (fifths[0] > weakestLater) {
    const firstEnd = span[0] + (span[1] - span[0]) / 5;
    for (let i = 0; i < times.length && times[i] < firstEnd - 1e-9; i += 1) shape[i] *= PACING.openingHpCap * weakestLater / fifths[0];
  }
  const weighted = baseHp.reduce((sum, hp, i) => sum + hp * shape[i], 0);
  const plain = baseHp.reduce((sum, hp) => sum + hp, 0);
  const norm = hpFactor * plain / weighted;

  // 5. Routes follow each type's original route sequence (cycled when the count grew).
  const routeCursor = new Map();
  const routeFor = (key) => {
    const entry = roster.find((item) => item.key === key);
    const index = routeCursor.get(key) ?? 0;
    routeCursor.set(key, index + 1);
    return entry.routes[index % entry.routes.length];
  };
  const spawns = assigned.map((key, i) => ({ time: times[i], key, count: 1, interval: 0, routeIndex: routeFor(key),
    hpScale: round(norm * shape[i], 3) }));
  for (const time of bossTimes) spawns.push({ time, key: boss.key, count: 1, interval: 0, routeIndex: routeFor(boss.key) });
  spawns.sort((a, b) => a.time - b.time || (a.key === bossId) - (b.key === bossId));

  const next = structuredClone(encounter);
  next.wave.spawns = spawns;
  next.wave.pacing = { schema: PACING.schema, band: band + 1, countFactor, hpFactor,
    span: [t0, round(Math.max(...spawns.map((spawn) => spawn.time)), 1)],
    baseSpan: base.span, baseRoster: base.roster };
  rewriteCounts(next, encounter);
  return next;
}

function shareOk(sequence, times, from) {
  const units = sequence.map((key, i) => ({ key, t: times[i] }));
  return maxTypeShare(units.slice(Math.max(0, from))).share <= PACING.maxShare + 1e-9;
}

function repairTail(assigned, times, late) {
  if (shareOk(assigned, times, 0)) return;
  const massSlots = assigned.map((key, i) => [key, i]).filter(([key]) => !late.has(key)).map(([, i]) => i);
  for (let size = 3; size <= Math.min(16, massSlots.length); size += 1) {
    const slots = massSlots.slice(-size);
    const pool = new Map();
    for (const i of slots) pool.set(assigned[i], (pool.get(assigned[i]) ?? 0) + 1);
    const trial = [...assigned];
    const built = [];
    let feasible = true;
    for (let p = slots.length - 1; p >= 0; p -= 1) {
      const length = built.length + 1;
      const options = [...pool].filter(([, left]) => left > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const fits = options.find(([key]) => {
        const same = built.filter((item) => item === key).length + 1;
        return length < PACING.minWindowUnits ? same === 1 : same / length <= PACING.maxShare + 1e-9;
      });
      if (!fits) { feasible = false; break; }
      built.push(fits[0]);
      pool.set(fits[0], fits[1] - 1);
      trial[slots[p]] = fits[0];
    }
    if (feasible && shareOk(trial, times, 0)) { trial.forEach((key, i) => { assigned[i] = key; }); return; }
  }
}

/** Shortfall of the fifths' HP against a rising sequence (the first fifth must also be the weakest). */
function fifthsShortfall(assigned, times, hpOf, span) {
  const seg = segmentStats(assigned.map((key, i) => ({ key, t: times[i], hp: hpOf(key, times[i]) })), span, 5).map((part) => part.hp);
  let shortfall = 0;
  for (let i = 1; i < seg.length; i += 1) {
    shortfall += Math.max(0, Math.max(...seg.slice(0, i)) - seg[i]);
    shortfall += Math.max(0, seg[0] - seg[i]);
  }
  return shortfall;
}

function smoothFifths(assigned, times, late, hpOf, span) {
  let current = fifthsShortfall(assigned, times, hpOf, span);
  for (let round_ = 0; round_ < 60 && current > 1e-6; round_ += 1) {
    const moves = [];
    for (let p = 0; p < assigned.length; p += 1) {
      if (late.has(assigned[p])) continue;
      for (let q = p + 1; q < assigned.length; q += 1) {
        if (late.has(assigned[q]) || assigned[q] === assigned[p]) continue;
        if (hpOf(assigned[p], times[q]) <= hpOf(assigned[q], times[q])) continue; // only move a stronger unit later
        const trial = [...assigned];
        [trial[p], trial[q]] = [trial[q], trial[p]];
        const shortfall = fifthsShortfall(trial, times, hpOf, span);
        if (shortfall < current - 1e-6) moves.push({ p, q, shortfall, trial });
      }
    }
    moves.sort((a, b) => a.shortfall - b.shortfall || a.p - b.p || a.q - b.q);
    const move = moves.find((item) => shareOk(item.trial, times, 0));
    if (!move) return;
    move.trial.forEach((key, i) => { assigned[i] = key; });
    current = move.shortfall;
  }
}

/** Keep the count / last-spawn phrases of the encounter texts true after a rebuild. */
function rewriteCounts(next) {
  const total = next.wave.spawns.length;
  const bossId = next.wave.bossId;
  const escorts = next.wave.spawns.filter((spawn) => spawn.key !== bossId).length;
  const last = Math.round(Math.max(...next.wave.spawns.map((spawn) => spawn.time)));
  const fix = (text) => String(text)
    .replace(/共\s*\d+\s*只（首领\s*1\s*\+\s*护卫\s*\d+）/g, `共 ${total} 只（首领 1 + 护卫 ${escorts}）`)
    .replace(/共\s*\d+\s*只/g, `共 ${total} 只`)
    .replace(/总人数\s*\d+/g, `总人数 ${total}`)
    .replace(/末次出生\s*=\s*\d+(?:\.\d+)?s/g, `末次出生=${last}s`)
    .replace(/末次出生\s*\d+(?:\.\d+)?s/g, `末次出生 ${last}s`);
  next.description = fix(next.description);
  next.riskExplanation = fix(next.riskExplanation);
  next.causalChecks = next.causalChecks.map(fix);
}

export function rebuildDesign(doc, native) {
  const chapter = applyChapterSets(doc, native.enemies);
  return { ...chapter, encounters: chapter.encounters.map((encounter) => encounter.chapterSourceRef ? encounter : rebuildEncounter(encounter, native)) };
}

// ---------------------------------------------------------------------------------------------
// CLI

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} requires an absolute path`);
  return value;
}

function main() {
  const command = process.argv[2];
  const file = argValue('--encounters') ?? ENCOUNTERS_PATH;
  const native = loadNative();
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (command === 'report') {
    const metrics = doc.encounters.map((encounter) => encounterMetrics(encounter, native));
    const report = { schema: 'assault-wave-pacing-report/v1', source: file, encounters: metrics, days: dayMetrics(metrics) };
    const out = argValue('--out');
    if (out) fs.writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
    for (const entry of metrics) {
      const seg = entry.segments5.map((part) => `${part.count}/${Math.round(part.hp / 1000)}k`).join(' ');
      console.log(`${entry.id.padEnd(24)} ${entry.kind.padEnd(6)} n=${String(entry.total).padStart(3)} hp=${String(Math.round(entry.totalHp / 1000)).padStart(4)}k `
        + `span=${entry.span.join('-')} seg5[${seg}] max20share=${entry.maxShare20.share}(${entry.maxShare20.key?.replace('enemy_', '')}) `
        + `late=${entry.lateUnits.map((unit) => unit.u).join(',')}`);
    }
    for (const day of report.days) console.log(JSON.stringify(day));
    return;
  }
  if (command === 'rebuild') {
    const next = rebuildDesign(doc, native);
    fs.writeFileSync(file, `${JSON.stringify(next, null, 1)}\n`);
    console.log(`rebuilt ${next.encounters.length} encounters -> ${file}`);
    return;
  }
  throw new Error('usage: wave-pacing.mjs report|rebuild [--encounters <abs>] [--out <abs.json>]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
