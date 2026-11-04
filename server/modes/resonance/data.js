// 共鸣's game data: its own frozen copy of the native data files, data/resonance-native/ — the data the 共鸣 release
// branch (resonance-clean-20261015) shipped as data/, with the 工坊 native imports (`chess_native_*`, their tokens and
// art) its season roster fields. 盟约 / 工坊 / 进击 keep reading data/ (server/data.js), so neither side changes the
// other's pools, stats or golden results. The browser reads the same copy (public/js/hostingBootstrap.js sets the
// data override of public/js/data.js on resonance.html).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData as loadDataDir, DATA_FILES } from '../../data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The 共鸣 data directory (SP_RESONANCE_DATA_DIR overrides it, tests and deployments). */
export const RESONANCE_DATA_DIR = process.env.SP_RESONANCE_DATA_DIR
  ? path.resolve(process.env.SP_RESONANCE_DATA_DIR)
  : path.join(ROOT, 'data', 'resonance-native');

/** The files 共鸣's copy has: its release shipped no backups.json (补位, a later 盟约 file 共鸣 does not use). */
export const RESONANCE_DATA_FILES = Object.freeze(DATA_FILES.filter((name) => name !== 'backups'));

/**
 * server/data.js loadData with 共鸣's directory as the default (an unset SP_DATA_DIR means the 共鸣 copy, not data/).
 * @param {string | undefined} [dir]
 * @param {{ log?: any, expected?: readonly string[] }} [opts]
 */
export function loadData(dir, opts = {}) {
  return loadDataDir(dir ? path.resolve(dir) : RESONANCE_DATA_DIR, { expected: RESONANCE_DATA_FILES, ...opts });
}

/** @type {Readonly<Record<string, any>> | null} */
let singleton = null;

/**
 * Process-wide 共鸣 data singleton; loads on first call (later calls ignore the options).
 * @param {{ log?: object }} [opts]
 * @returns {Readonly<Record<string, any>>}
 */
export function getResonanceData({ log = console } = {}) {
  if (!singleton) singleton = loadData(RESONANCE_DATA_DIR, { log });
  return singleton;
}

/** Drop the singleton so the next getResonanceData() reloads (tests). */
export function resetResonanceData() { singleton = null; }

// The 共鸣 modules and tests read their data through the same name server/data.js uses.
export { getResonanceData as getData };
// everything else server/data.js exports (ROOT, DATA_FILES …) unchanged; the local loadData / getData above win
export * from '../../data.js';
