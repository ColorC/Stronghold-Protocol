// Shared, data-based eligibility. Descriptions are display text and never execution rules.
import { loadoutRecord } from './loadoutRecord.js';

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
  return (nativeRecord(piece,catalog)?.bonds || []).filter(id=>Object.hasOwn(TAVERN_FACTIONS,id)).map(id=>TAVERN_FACTIONS[id]);
}

export function tavernFactions(piece, catalog) {
  const out=new Set(nativeFactions(piece,catalog));
  for(const item of piece?.equipment || []) {
    const def=catalog?.equipment?.[item.id];
    if(def?.mechanism!=='identityTag')continue;
    const faction=item.state?.faction || item.state?.tavernFaction;
    if(Object.values(TAVERN_FACTIONS).includes(faction))out.add(faction);
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

export function inheritanceQualification(donor, receiver, catalog) {
  const donorOp=catalog?.operators?.[donor?.chessId];
  const receiverOp=catalog?.operators?.[receiver?.chessId];
  const give=catalog?.permissions?.[donorOp?.name];
  const receive=catalog?.permissions?.[receiverOp?.name];
  const donorAllowed=give?.direction==='给予' && matchesInheritancePermission(give,'receiver',receiver,catalog);
  const receiverAllowed=receive?.direction==='接收' && matchesInheritancePermission(receive,'donor',donor,catalog);
  return {allowed:!!(donorAllowed || receiverAllowed),donorAllowed:!!donorAllowed,receiverAllowed:!!receiverAllowed,give:give||null,receive:receive||null};
}

export function nativeBodyStats(piece, catalog) {
  const raw=nativeRecord(piece,catalog);
  const stats={...(loadoutRecord(raw,piece)?.stats || raw?.stats || {})};
  if(piece?.bodyPenaltyApplied) {
    const penalty=catalog?.config?.bodyPenalty || {};
    stats.atk=Math.floor((stats.atk||0)*(penalty.baseAttackRatio ?? 0.8));
    stats.maxHp=Math.floor((stats.maxHp||0)*(penalty.baseLifeRatio ?? 0.8));
  }
  return stats;
}
