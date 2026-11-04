import { damage, watch, enemies } from '../primitives.js';

const silentTokenKit = () => ({});
const toledoTokenKit = () => ({ skill: { id: 'token_10067_toledo_tldptm:native', kind: 'passive', trigger: 'NEVER', assaultCast: () => false } });
function hit(battle, unit, targets, cause) {
  for (const target of targets) {
    if (!target?.alive) continue;
    damage(battle, unit, target, { scale: 1.1, type: 'true', isSkill: true, sourceKey: 'sktok_nearl2_3', cause });
    if (target.alive) battle.applyStatus(target, 'stun', { duration: 3, source: unit, instanceKey: 'assault:nearl2:sun-stun' });
  }
}
const radiantSunKit = () => ({
  skill: { id: 'sktok_nearl2_3', kind: 'passive', trigger: 'NEVER', assaultCast: ({ battle, unit, cause }) => hit(battle, unit, enemies(battle, unit, { scope: 'range', count: 1 }), cause) },
  install: (battle, unit) => {
    watch(battle, unit, 'attack', 'assault:nearl2:radiant-sun', ({ payload }) => payload?.sourceUid === unit.uid,
      ({ payload, cause }) => {
        hit(battle, unit, payload.targets ?? [], cause);
      });
  },
});

export const assaultTokenKits = Object.freeze({
  token_10022_kazema_shadow: silentTokenKit,
  token_10040_siege2_vlion: silentTokenKit,
  token_10019_nearl2_sword: radiantSunKit,
  token_10067_toledo_tldptm: toledoTokenKit,
});
