// Shared, data-based eligibility. Descriptions are display text and never execution rules.
import { loadoutRecord } from './loadoutRecord.js';
import { levelBodyStats } from './independentGrowth.js';

// Catalog data, not mutable save metadata, defines whether a deployed entity
// consumes an operator slot. TOKEN profession narrows Darkmoon support entries
// to summon bodies; prize-support operators remain ordinary operators.
export function deploymentSlots(piece, catalog) {
  const operator = catalog?.operators?.[piece?.chessId];
  if (!operator) return piece?.kind === 'token' ? 0 : 1;
  return operator?.darkmoonSupport === true && operator?.profession === 'TOKEN' ? 0 : 1;
}

export function countDeploymentSlots(pieces, catalog) {
  return (pieces || []).reduce((total, piece) => total + (piece?.row != null && piece?.col != null ? deploymentSlots(piece, catalog) : 0), 0);
}

export const TAVERN_FACTIONS = Object.freeze({
  yanShip:'炎', victoriaShip:'维多利亚', lateranoShip:'拉特兰', egirShip:'阿戈尔',
  kjeragShip:'谢拉格', sargonShip:'萨尔贡', siracusaShip:'叙拉古', kazimierzShip:'卡西米尔',
});

export function nativeRecord(piece, catalog) {
  const op=catalog?.operators?.[piece?.chessId];
  return piece?.elite || String(piece?.chessId).endsWith('_b')
    ? op?.source?.eliteChess || op?.source?.normalChess || null
    : op?.source?.normalChess || null;
}

export function nativeFactions(piece, catalog) {
  const configured = catalog?.operators?.[piece?.chessId]?.nativeFactionTags;
  if (Array.isArray(configured)) return [...new Set(configured.filter(id => typeof id === 'string' && id.trim().length > 0))];
  return (nativeRecord(piece,catalog)?.bonds || []).filter(id=>Object.hasOwn(TAVERN_FACTIONS,id)).map(id=>TAVERN_FACTIONS[id]);
}

export function tavernFactions(piece, catalog) {
  const out=new Set(nativeFactions(piece,catalog));
  if(catalog?.config?.factionIdentityEquipment===false)return [...out];
  const proxyEligible = new Set(Array.isArray(catalog?.config?.tavernFactions) ? catalog.config.tavernFactions : Object.values(TAVERN_FACTIONS));
  // Workshop faction equivalence satisfies recipes, while native identity still governs handovers.
  if(catalog?.operators?.[piece?.chessId]?.tavernFactionProxy==='ALL')for(const faction of proxyEligible)out.add(faction);
  for(const item of piece?.equipment || []) {
    const def=catalog?.equipment?.[item.id];
    if(def?.mechanism!=='identityTag')continue;
    const faction=item.state?.faction || item.state?.tavernFaction;
    if(typeof faction === 'string' && proxyEligible.has(faction))out.add(faction);
  }
  return [...out];
}

export function attachmentAccepted(def, piece, catalog) {
  const raw=nativeRecord(piece,catalog);
  if(!def || !raw)return false;
  switch(def.condition) {
    case 'any':return true;
    case 'native medic profession':return raw.profession==='MEDIC';
    case 'selected ammo skill': {
      const selected=(raw.skills||[]).find(s=>s.index===piece.skillIndex) || raw.skill;
      return selected?.durationType==='AMMO';
    }
    case 'native freeze':return [...(raw.skills||[]),...(raw.talents||[])].some(s=>
      Object.entries(s.bb || {}).some(([key,value])=>/freez|froz/i.test(key) && Number(value)>0));
    default:return false;
  }
}

export function matchesInheritancePermission(permission, prefix, subject, catalog) {
  const op=catalog?.operators?.[subject?.chessId];
  const raw=nativeRecord(subject,catalog);
  if(!permission || !op || !raw)return false;
  const tiers=permission[`${prefix}Tiers`];
  if(Array.isArray(tiers) && !tiers.includes(op.tier))return false;
  if(Number.isFinite(permission[`${prefix}MaxTier`]) && op.tier>permission[`${prefix}MaxTier`])return false;
  if(permission[`${prefix}Profession`] && raw.profession!==permission[`${prefix}Profession`])return false;
  if(permission[`${prefix}Faction`] && !nativeFactions(subject,catalog).includes(permission[`${prefix}Faction`]))return false;
  return true;
}

/** The 交接凭证 a piece wears (gear with mechanism inheritancePermit; its params limit its partner). */
export function wornPermits(piece, catalog) {
  return (piece?.equipment || []).map(item=>catalog?.equipment?.[item.id]).filter(def=>def?.mechanism==='inheritancePermit');
}

export function inheritanceQualification(donor, receiver, catalog) {
  const eligible = (def, partner) => {
    const params = def.params || {};
    // Legacy directional permissions describe the same partner scope; direction no longer limits who hands over.
    const prefix = ['Tiers', 'MaxTier', 'Profession', 'Faction'].some((key) => Object.hasOwn(params, `partner${key}`))
      ? 'partner' : params.direction === '接收' ? 'donor' : 'receiver';
    return matchesInheritancePermission(params, prefix, partner, catalog);
  };
  const give=wornPermits(donor,catalog).find(def=>eligible(def,receiver));
  const receive=wornPermits(receiver,catalog).find(def=>eligible(def,donor));
  return {allowed:!!(give || receive),donorAllowed:!!give,receiverAllowed:!!receive,give:give||null,receive:receive||null};
}

export function nativeBodyStats(piece, catalog) {
  const raw=nativeRecord(piece,catalog);
  const stats=levelBodyStats(piece,catalog,raw);
  if(piece?.bodyPenaltyApplied) {
    const penalty=catalog?.config?.bodyPenalty || {};
    stats.atk=Math.floor((stats.atk||0)*(penalty.baseAttackRatio ?? 0.8));
    stats.maxHp=Math.floor((stats.maxHp||0)*(penalty.baseLifeRatio ?? 0.8));
  }
  return stats;
}
