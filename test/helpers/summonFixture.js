// test/helpers/summonFixture.js — start a summon test from an empty summon ledger.
// A synergy summoner (令, design of 2026-10-21) deploys a summon of her own at every deployment; relic and ledger tests
// that grant their own fixture summons call clearCardSummons(battle) after battle.start() so they count only theirs.
import { ledgerFor } from '../../server/sim/content/assault/summons.js';

export function clearCardSummons(battle) {
  for (const owner of battle.allyUnits.filter((u) => u.kind === 'op' && u.alive)) {
    const ledger = ledgerFor(battle, owner);
    for (const entry of [...ledger.activeByKey.values()]) if (entry.unit?.alive) battle.retreat(entry.unit, { reason: 'fixture', permanent: true });
    ledger.activeByKey.clear();
    ledger.stock.clear();
    ledger.sources.clear();
    ledger.pending = [];
  }
  battle.assaultRuntime.flush();
}
