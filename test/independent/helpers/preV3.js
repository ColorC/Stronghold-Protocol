// The rules 68 operators had before 干员表 v3 (2026-10-07), dumped once from commit 7ac5ca1 into
// fixtures/pre-v3-rules.json. Engine behaviors that no operator of the current table uses any more (bench-active
// faction forging, diversity grants, doll-swap production …) are still tested through them, with badge landing off
// so outputs go to the stock as they did then. The current table is tested against getCatalog() as it is.
import { readFileSync } from 'node:fs';

const RULES = JSON.parse(readFileSync(new URL('../fixtures/pre-v3-rules.json', import.meta.url), 'utf8'));

export function preV3Catalog(catalog) {
  const operators = { ...catalog.operators };
  for (const [id, r] of Object.entries(RULES)) {
    for (const [cid, effect] of [[id, r.normal], [r.eliteChessId, r.elite]]) {
      const op = operators[cid];
      if (op) operators[cid] = { ...op, nativeTrait: { ...op.nativeTrait, effect } };
    }
  }
  return { ...catalog, operators, config: { ...catalog.config, badgeLanding: 'stock' } };
}
