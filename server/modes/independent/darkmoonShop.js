const sourceRef = (catalog,id) => catalog?.operators?.[id]?.sourceRefs?.darkmoon19_2;
const matches = (ref,effect) => !!ref && (effect.rosterTribe==='*' || ref.rosterTribe===effect.rosterTribe)
  && (!effect.faction || ref.faction===effect.faction);
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
  for(const slot of state.shop?.slots||[]) if(!slot.sold&&matches(sourceRef(catalog,slot.id),growth)) addGrowth(slot,growth.attack,growth.health);
  return growth;
}

export function decorateDarkmoonShopSlots(state,catalog,slots) {
  const effects=(state.playerEffects||[]).filter(x=>x.type==='darkmoonShopGrowth');
  for(const slot of slots||[]) for(const effect of effects) if(matches(sourceRef(catalog,slot.id),effect)) addGrowth(slot,effect.attack,effect.health);
  return slots;
}

// The shop buff is a fixed recipient. On purchase, translate its A/H growth directly onto that operator.
// It never creates a stock item, and runs before the bought card's own native hooks.
export function applyDarkmoonShopGrowth(state,slot,piece,services) {
  const growth=slot?.darkmoonGrowth;
  if(!growth) return [];
  const grants=[];
  for(const [id,quantity] of [['precision',growth.attack],['vitality',growth.health]]) if(quantity>0) {
    services.grantEquipment(state,id,quantity,{origin:'native',sourceUid:piece.uid,landOn:'self',targetUid:piece.uid,shopGrowth:true});
    grants.push({id,quantity,targetUid:piece.uid});
  }
  return grants;
}
