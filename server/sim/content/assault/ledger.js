// Battle-local, serializable evidence. Native damage/heal counters remain the
// authority, including owned tokens which have left the field by settlement.
import { active, uid } from './primitives.js';

function operatorOf(unit) {
  const seen = new Set();
  while (unit && unit.kind !== 'op' && !seen.has(unit)) { seen.add(unit); unit = unit.ownerUnit; }
  return unit?.side === 'ally' && unit.kind === 'op' ? unit : null;
}

export function installBattleLedger(battle, runtime) {
  const rows = new Map(), units = new Set();
  const rowOf = unit => {
    if (unit) units.add(unit);
    const owner = operatorOf(unit);
    if (!owner) return null;
    const key = uid(owner);
    if (!rows.has(key)) rows.set(key, { uid: key, charId: owner.def?.charId ?? owner.defId,
      name: owner.name, casts: 0, damage: 0, healing: 0, shieldHp: 0, shieldLayers: 0,
      chargeGiven: 0, hasteSeconds: 0, triggers: 0, aliveSeconds: 0 });
    return rows.get(key);
  };
  const count = (type, field, value = p => p.amount ?? 0) => runtime.observe(type, `ledger:${type}`, ({ payload }) => {
    const row = rowOf(payload.source);
    if (row) row[field] += value(payload);
  });
  count('skillStart', 'casts', () => 1);
  count('chargeGranted', 'chargeGiven');
  count('hasteApplied', 'hasteSeconds');
  count('triggerResolved', 'triggers');
  runtime.observe('shieldGained', 'ledger:shield', ({ payload: p }) => {
    const row = rowOf(p.source);
    if (row) row[p.shieldKind === 'layers' ? 'shieldLayers' : 'shieldHp'] += p.amount ?? 0;
  });
  battle.on('deploy', ({ unit }) => rowOf(unit));
  battle.on('tick', ({ dt }) => {
    for (const unit of battle.allyUnits) {
      const row = rowOf(unit);
      if (unit.kind === 'op' && row && active(unit)) row.aliveSeconds += dt;
    }
  });
  const snapshot = () => {
    for (const unit of battle.allyUnits) rowOf(unit);
    const result = new Map([...rows].map(([key, row]) => [key, { ...row, damage: 0, healing: 0 }]));
    for (const unit of units) {
      const owner = operatorOf(unit), row = owner && result.get(uid(owner));
      if (row) { row.damage += unit.stats?.dmg ?? 0; row.healing += unit.stats?.heal ?? 0; }
    }
    return { version: 1, duration: battle.time, operators: [...result.values()] };
  };
  battle.assaultLedger = { snapshot };
  return battle.assaultLedger;
}
