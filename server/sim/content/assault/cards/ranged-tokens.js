import { active, uid } from '../primitives.js';
import { COLS } from '../../../constants.js';
import { bodyInKeys } from '../../../body.js';
import { rangedTokenIds, rangedEffectPlans } from './ranged-plans.js';

// The token identity is a real compiled template.  Behaviour is intentionally
// not substituted with a generic periodic attack or a fixed healing amount:
// token mechanics must be specified by the owning ranged card's typed plan.
function ownerUnit(battle, unit) {
  const ownerUid = unit.ownerUnit?.uid ?? unit.ownerUid ?? unit.ownerId ?? unit.sourceOwnerUid;
  const owner = [...battle.allyUnits, ...battle.enemies].find((candidate) => uid(candidate) === String(ownerUid));
  if (!owner) throw new TypeError(`ranged token ${unit.tokenId ?? unit.def?.charId ?? 'unknown'} has no live owner unit`);
  return owner;
}

const tokenBuilders = Object.fromEntries(rangedTokenIds.map((tokenId) => {
  const builder = (_battle, raw, def) => ({
    skill: { id: tokenId, kind: 'passive', trigger: 'NEVER', assaultCast: () => false, onStart() {} },
    install: (battle, unit) => {
      const owner = ownerUnit(battle, unit);
      if (tokenId !== 'token_10018_robrta_mach' || owner.def?.charId !== 'char_484_robrta') throw new TypeError(`missing typed ranged token behaviour for ${tokenId}`);
      const body = owner.def.raw?.assaultBody ?? owner.def.assaultBody;
      const piece = owner.def.raw?.assaultPiece ?? owner.def.assaultPiece;
      const moduleId = piece?.moduleId ?? piece?.moduleChoices?.[body.charId];
      const moduleSource = (body.modulePlans ?? []).find((entry) => entry.id === moduleId && entry.type === 'ADVANCED');
      const modulePlan = moduleSource && piece.star >= 3 ? rangedEffectPlans[body.charId].modules[moduleId][piece.star >= 4 ? 'star4' : 'star3'] : null;
      const layers = modulePlan?.shieldLayers ?? body.modePassives[0].values.shieldLayers[piece.star - 1];
      const duration = body.modePassives[0].values.shieldDuration[piece.star - 1];
      let lastTargetUid = null;
      let lastAt = -Infinity;
      const applySupport = () => {
        if (!active(unit) || !active(owner)) return;
        const target = battle.allyUnits.filter((candidate) => active(candidate) && candidate.kind === 'op'
          && ((candidate.def?.raw?.assaultBody ?? candidate.def?.assaultBody)?.position === 'MELEE' || candidate.profile?.attack === 'melee')
          && bodyInKeys(candidate, unit.rangeKeySet ?? new Set(unit.rangeKeys ?? [])))
          .sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp || uid(a).localeCompare(uid(b)))[0];
        if (!target) return;
        const targetUid = uid(target);
        if (targetUid === lastTargetUid && battle.time - lastAt < duration) return;
        battle.addBuff(target, { key: `assault:${tokenId}:${uid(unit)}`, mods: { defPct: 0.3 }, shieldHits: layers,
          duration, visible: true, source: unit });
        lastTargetUid = targetUid;
        lastAt = battle.time;
      };
      battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) applySupport(); }, { owner: unit });
      battle.on('tick', applySupport, { owner: unit });
    },
  });
  return [tokenId, builder];
}));

export const rangedTokenKits = Object.freeze(tokenBuilders);
