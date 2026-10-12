import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { factionSeason } from '../../shared/resonance/faction-season.js';
import { factionSeasonV2 } from '../../shared/resonance/faction-season-v2.js';

const data = loadData(process.env.SP_DATA_DIR, { log: { warn() {}, error() {} } });

test('season 2 does not list the 28 叙拉古 market passive items it cannot hand out; season 1 still lists them', () => {
  const view = (seasonId) => {
    const catalog = getResonanceCatalog(data, { rulesVersion: 3, seed: 1, seasonId });
    const passive = Object.values(catalog.equipment).filter((item) => item.kind === 'passive' && item.prototypeEconomyTier).map((item) => item.id);
    return { passive, equipment: resonanceDisplayCatalog(catalog, data).equipment };
  };
  const current = view(factionSeasonV2.id), first = view(factionSeason.id);
  assert.equal(current.passive.length, 28);
  for (const id of current.passive) assert.equal(current.equipment[id].codexHidden, true, id);
  for (const id of current.passive) assert.equal(getResonanceCatalog(data, { rulesVersion: 3, seed: 1, seasonId: factionSeasonV2.id }).equipment[id].grantAllowed, false, `${id} is never granted in season 2`);
  for (const id of first.passive) assert.ok(!first.equipment[id].codexHidden, `${id} stays in the season-1 codex`);
  assert.ok(Object.values(current.equipment).some((item) => item.kind === 'completed' && !item.codexHidden), 'ordinary items stay listed');
});
