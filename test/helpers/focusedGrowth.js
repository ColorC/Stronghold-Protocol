import assert from 'node:assert/strict';
import {GROWTH_IDENTITIES} from '../../shared/assault/growth-policy.js';

/** Real event scenarios still exercise their original attacks, statuses, healing
 * and modules; their removed generic growth must leave no battle/run ledger. */
export function assertNoGenericGrowth(h) {
  assert.ok(h?.battle);
  const byUid=new Map(h.battle.allyUnits.map(unit=>[unit.uid,unit]));
  for(const effect of h.battle.assaultPermanentEffects??[]) {
    const source=byUid.get(effect.sourceUid);
    if(source)assert.ok(Object.hasOwn(GROWTH_IDENTITIES,source.def.charId),`${source.def.charId} emitted removed cross-battle growth`);
  }
  for(const entries of Object.values(h.battle.assaultBattleStacks??{}))for(const entry of Object.values(entries)) {
    if(entry.key==='svash2-ready')continue;
    const source=String(entry.key).split(':')[0];
    if(source.startsWith('char_'))assert.ok(Object.hasOwn(GROWTH_IDENTITIES,source),`${source} emitted removed battle growth`);
  }
  assert.deepEqual(h.battle.errors,[]);
}
