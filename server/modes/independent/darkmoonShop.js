import { nativeFactions, nativeRecord } from '../../../shared/independentRules.js';

const matches = (catalog,slot,effect) => effect.rosterTribe==='*' || nativeFactions({chessId:slot.id,equipment:[]},catalog).includes(effect.faction);
function addGrowth(target,attack,health) {
  target.darkmoonGrowth ||= { attack:0,health:0 };
  target.darkmoonGrowth.attack += attack;
  target.darkmoonGrowth.health += health;
}

// Persistent shop growth survives refreshes; one-shot growth touches the offers present now.
export function addDarkmoonShopGrowth(state,catalog,effect,persistent=false) {
  const growth={type:'darkmoonShopGrowth',sourceId:effect.sourceId,rosterTribe:effect.rosterTribe,faction:effect.faction||null,
    attack:Number(effect.attack||0),health:Number(effect.health||0)};
  if(persistent) (state.playerEffects ||= []).push(growth);
  for(const slot of state.shop?.slots||[]) if(!slot.sold&&matches(catalog,slot,growth)) addGrowth(slot,growth.attack,growth.health);
  return growth;
}

export function decorateDarkmoonShopSlots(state,catalog,slots) {
  const effects=(state.playerEffects||[]).filter(x=>x.type==='darkmoonShopGrowth');
  for(const slot of slots||[]) for(const effect of effects) if(matches(catalog,slot,effect)) addGrowth(slot,effect.attack,effect.health);
  return slots;
}

// The shop buff is a fixed recipient. On purchase, translate its A/H growth directly onto that operator.
// It never creates a stock item, and runs before the bought card's own native hooks.
export function applyDarkmoonShopGrowth(state,slot,piece,services) {
  const growth=slot?.darkmoonGrowth;
  if(!growth) return [];
  return applyDarkmoonAHGrowth(state,services.catalog,piece,growth.attack,growth.health,services,{sourceUid:piece.uid,landOn:'self',targetUid:piece.uid,shopGrowth:true});
}

export function darkmoonGrowthBadges(piece,catalog) {
  const raw=nativeRecord(piece,catalog)||{},profession=raw.profession||catalog?.operators?.[piece?.chessId]?.profession;
  let secondary='agility';
  if(profession==='CASTER') secondary='damage';
  else if(profession==='TANK') secondary='vitality';
  else if(['MEDIC','SUPPORT','PIONEER'].includes(profession)) {
    const skill=raw.skills?.find(x=>Number(x.index)===Number(piece?.skillIndex))||raw.skill;
    secondary=skill?.spType==='INCREASE_WITH_TIME'?'recovery':'agility';
  }
  return ['precision',secondary];
}

export function applyDarkmoonAHGrowth(state,catalog,piece,attackUnits,healthUnits,services,extra={}) {
  if(!piece)return [];
  const [attackBadge,healthBadge]=darkmoonGrowthBadges(piece,catalog),grants=[];
  for(const [id,quantity] of [[attackBadge,Number(attackUnits||0)],[healthBadge,Number(healthUnits||0)]]) if(quantity>0) {
    services.grantEquipment(state,id,quantity,{origin:'native',sourceUid:extra.sourceUid||piece.uid,targetUid:piece.uid,landOn:extra.landOn||'self',...extra});
    grants.push({id,quantity,targetUid:piece.uid});
  }
  return grants;
}
