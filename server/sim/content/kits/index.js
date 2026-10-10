// Compatibility bridge for native Match's DIY validation. The actual kit registry remains
// server/sim/content/index.js; this module only exposes operators with an authored kit.
import { KITS } from '../index.js';
import { getData } from '../../../data.js';

const data = getData();
const chess = data && data.chess && typeof data.chess === 'object' ? data.chess : {};
const kitIds = new Set(Object.keys(KITS));
export const KITTED_CHARS = new Set(Object.entries(chess)
  .filter(([id, rec]) => kitIds.has(id) || kitIds.has(String(id).replace(/_[ab]$/, '')))
  .map(([, rec]) => rec && rec.charId)
  .filter((id) => typeof id === 'string' && id.length > 0));

export { KITS };
