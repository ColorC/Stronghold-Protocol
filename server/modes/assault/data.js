import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getData } from '../../data.js';
import { assertAssaultCatalog } from '../../../shared/assault/catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export function getAssaultRulesRoot() {
  const configured = process.env.SP_ASSAULT_RULES_ROOT;
  if (configured && !path.isAbsolute(configured)) throw new TypeError('SP_ASSAULT_RULES_ROOT must be absolute');
  return configured ? path.resolve(configured) : path.join(ROOT, 'data');
}
const read = (name) => JSON.parse(fs.readFileSync(path.join(getAssaultRulesRoot(), 'assault-design', name), 'utf8'));

export function getAssaultData({ nativeData = null, runtime = null } = {}) {
  const source = nativeData ?? getData();
  const catalog = assertAssaultCatalog(runtime ?? source['assault-runtime'] ?? getData()['assault-runtime']);
  for (const key of ['chess', 'enemies', 'tokens', 'bosses', 'stages', 'waves']) {
    if (!source?.[key]) throw new Error(`assault requires native 0.2.2 ${key} data`);
  }
  const extra = catalog.auxiliaryEnemies ?? {};
  return { nativeData: Object.keys(extra).length ? { ...source, enemies: { ...source.enemies, ...extra } } : source, runtime: catalog };
}

export function loadAssaultDesign() {
  return { system: read('system.json'), encounters: read('encounters.json'), events: read('events.json'), collectibles: read('collectibles.json') };
}

export function getAssaultEncounter(design, encounterId) {
  const entries = Array.isArray(design?.encounters) ? design.encounters : design?.encounters?.encounters;
  if (!Array.isArray(entries)) throw new TypeError('assault encounter design is missing');
  const encounter = entries.find((item) => item.id === encounterId);
  if (!encounter) throw new Error(`unknown assault encounter ${encounterId}`);
  return encounter;
}
