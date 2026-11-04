import { heal, enemies, allies, active, onTimer, uid } from './helpers.js';
import { deriveWorkshopPlatform } from '../summons.js';

const PLATFORM = 'assault_workshop_platform';
const SOURCE = 'token_10027_ironmn_pile3';

function workshopKit() {
  return {
    trait: { noAttack: true },
    skill: { id: 'assault-workshop-no-native-skill', kind: 'passive', onStart() {} },
    install(battle, unit) {
      const start = (event) => {
        if (event.unit !== unit || !active(unit) || unit._assaultWorkshopStarted) return;
        unit._assaultWorkshopStarted = true;
        onTimer(battle, unit, 2.5, () => {
          const target = enemies(battle, unit, { scope: 'range', priority: 'exit', count: 1 })[0];
          if (!target) return false;
          // The derived platform already owns 150% of its owner's ATK. Its
          // timer drives the native attack once, without ordinary AI attacks.
          return battle.forceAttack(unit, [target]);
        }, { every: true });
        onTimer(battle, unit, 5, () => {
          let changed = false;
          for (const target of allies(battle, unit, { scope: 'adjacent4', selection: 'uid', count: 99 })) {
            changed = heal(battle, unit, target, { amount: 500, sourceKey: 'assault:workshop:repair' }) > 0 || changed;
          }
          return changed;
        }, { every: true });
      };
      battle.on('deploy', start, { owner: unit });
    },
  };
}

export function installWorkshopRelic(battle, owner, effect, state) {
  if (!owner || owner.kind !== 'op' || owner.def?.charId !== effect.condition?.ownerCharId) return false;
  if (!active(owner) || state.workshopSpawned) return false;
  const result = deriveWorkshopPlatform(battle, owner, {
    tokenId: PLATFORM,
    derivedKey: 'assault-workshop-platform',
    kit: workshopKit,
    sourceTemplateId: SOURCE,
    relicId: effect._relicId,
    moduleCap: 2,
  });
  if (result.granted > 0 || result.pending > 0) {
    state.workshopSpawned = true;
    state.workshopOwnerUid = uid(owner);
    return true;
  }
  return false;
}

export const workshopConstants = Object.freeze({ PLATFORM, SOURCE });
