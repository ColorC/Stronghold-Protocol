// Training uses the same native phase/keyframe interpolation as tools/build-data.mjs.
// Equipment rank and technology tier are independent of the operator's actual training level.
import { loadoutRecord } from './loadoutRecord.js';

export const GROWTH_MODES = Object.freeze(['badges', 'levels']);
const STAT_KEYS = Object.freeze({ maxHp: 'maxHp', atk: 'atk', def: 'def', magicResistance: 'res' });

export function nativeLevelAttributes(curve, phase, level) {
  const p = curve?.phases?.[phase];
  if (!p?.attributesKeyFrames?.length) throw new Error('MISSING_NATIVE_GROWTH_CURVE');
  const lv = Math.min(p.maxLevel, Math.max(1, Number(level) || 1));
  const keys = p.attributesKeyFrames;
  let a = keys[0], b = keys.at(-1);
  for (let i = 0; i < keys.length - 1; i++) {
    if (lv >= keys[i].level && lv <= keys[i + 1].level) { a = keys[i]; b = keys[i + 1]; break; }
  }
  const t = b.level === a.level ? 0 : (lv - a.level) / (b.level - a.level);
  const out = {};
  for (const [from, to] of Object.entries(STAT_KEYS)) {
    const value = Number(a.data[from]) + (Number(b.data[from]) - Number(a.data[from])) * t;
    if (!Number.isFinite(value)) throw new Error(`BAD_NATIVE_GROWTH_STAT:${from}`);
    out[to] = to === 'res' ? value : Math.round(value);
  }
  return out;
}

function recordFor(piece, catalog) {
  const op = catalog?.operators?.[piece?.chessId];
  return piece?.elite || String(piece?.chessId).endsWith('_b')
    ? op?.source?.eliteChess || op?.source?.normalChess : op?.source?.normalChess;
}

export function operatorGrowthInfo(piece, catalog) {
  const raw = recordFor(piece, catalog);
  const curve = raw?.nativeGrowth;
  if (!curve) throw new Error(`MISSING_NATIVE_GROWTH_CURVE:${piece?.chessId}`);
  const phase = Number(raw.status?.phase ?? 0);
  const maximum = Number(curve.phases?.[phase]?.maxLevel);
  if (!(maximum >= 1)) throw new Error('BAD_NATIVE_GROWTH_MAX_LEVEL');
  const level = Math.min(maximum, Math.max(1, Number(piece.growthLevel) || 1));
  return { phase, level, maximum, stats: nativeLevelAttributes(curve, phase, level) };
}

export function levelBodyStats(piece, catalog, raw = recordFor(piece, catalog)) {
  const selected = loadoutRecord(raw, piece) ?? raw;
  const stats = { ...(selected?.stats || {}) };
  if (piece?.growthMode !== 'levels') return stats;
  const info = operatorGrowthInfo(piece, catalog);
  const before = nativeLevelAttributes(raw.nativeGrowth, info.phase, raw.status?.level ?? 1);
  // Preserve trust/potential/module additions that are already present in the native loadout.
  for (const key of Object.values(STAT_KEYS)) stats[key] = Number(stats[key] || 0) + info.stats[key] - before[key];
  return stats;
}

export function grantGrowthLevels(state, catalog, piece, badgeUnits) {
  if (state.growthMode !== 'levels') return null;
  if (!Number.isInteger(badgeUnits) || badgeUnits < 1) throw new Error('BAD_GROWTH_QUANTITY');
  const info = operatorGrowthInfo(piece, catalog);
  const units = Number(catalog.config?.levelsPerBadge ?? 1);
  const requested = badgeUnits * units;
  const add = Math.min(requested, info.maximum - info.level);
  piece.growthMode = 'levels';
  piece.growthLevel = info.level + add;
  return { requested, added: add, level: piece.growthLevel, maximum: info.maximum };
}
