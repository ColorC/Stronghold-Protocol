// The rules the 47 operators rewritten by 干员特质 v4 (2026-10-07, 方舟化) had in 干员表 v3, dumped once from commit ee3909a
// into fixtures/pre-v4-rules.json. Engine behaviors no operator of the current table uses any more (growth, doublers,
// game-long totals, shop carry, badge boosts, sale transfer, devouring the shop, doubling worn badges, every Nth attack,
// first-wave strikes …) are still tested through them. Unlike preV3Catalog the badge landing stays as configured.
import { readFileSync } from 'node:fs';

const RULES = JSON.parse(readFileSync(new URL('../fixtures/pre-v4-rules.json', import.meta.url), 'utf8'));

export function preV4Catalog(catalog) {
  const operators = { ...catalog.operators };
  for (const [id, r] of Object.entries(RULES)) {
    for (const [cid, effect] of [[id, r.normal], [r.eliteChessId, r.elite]]) {
      const op = operators[cid];
      if (op) operators[cid] = { ...op, nativeTrait: { ...op.nativeTrait, effect } };
    }
  }
  return { ...catalog, operators };
}
