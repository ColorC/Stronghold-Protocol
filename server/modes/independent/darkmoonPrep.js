// Source-id keyed, authored adapters for Darkmoon effects delivered in preparation.
// Gear IDs intentionally reuse the project's nine stable keyword-gear definitions.
const gear = id => ({ id: `independent:${id}`, normal: 1, elite: 1 });
const grantSelf = (...items) => ({ trigger:'gain', behavior:'grantEquipment', params:{ landOn:'self', outputs:items } });

// Triggering on gain means Battlecry adaptations pay once; leaving/redeploying cannot refill them.
const RULES = Object.freeze({
  BGS_039: [grantSelf(gear('坚守盟约'))], // Taunt
  BGS_106: [grantSelf(gear('坚守盟约'), gear('不屈盟约'))], // Taunt + Reborn
  BGS_034: [grantSelf(gear('护盾发生器'), gear('不屈盟约'))], // Divine Shield + Reborn
  BGS_131: [grantSelf(gear('精准盟约'))], // Poisonous -> user-approved Precision gear
  FP1_010: [grantSelf(gear('精准盟约'))],
  GVG_113: [grantSelf(gear('巨锤盟约'))], // Cleave
  LOOT_078: [grantSelf(gear('巨锤盟约'))],
  BGS_027: [{ trigger:'roundStart', behavior:'grantEquipment', params:{ landOn:'self', outputs:[{id:'precision',normal:1,elite:2}] } }],
  BGS_116: [{ trigger:'gain', behavior:'freeRefresh', params:{ normal:1, elite:2 } }],
});

export const DARKMOON_PREP_SUPPORTED_IDS = Object.freeze(Object.keys(RULES));

export function darkmoonPrepRulesFor(source,isElite=false) {
  // The generated design add-on carries sourceRefs.darkmoon19_2.id. Do not infer a source
  // from a matching operator name: it is activated only when a compiled source ref is attached.
  const id = source?.sourceRefs?.darkmoon19_2?.id || source?.darkmoonSourceId;
  if(id==='BGS_055') return [{trigger:'gain',behavior:'factionReaction',params:{mode:'discount',targets:'self',count:isElite?2:1,excludeSelf:false,maxEventsPerPrep:3}}];
  if(id==='BGS_049') return [{trigger:'sold',behavior:'factionReaction',params:{mode:'funds',targets:'all',count:isElite?5:2,maxEventsPerPrep:1}}];
  if(id==='BGS_072') return [{trigger:'bought',behavior:'darkmoonRosterTribePurchaseFunds',params:{rosterTribe:'PIRATE',faction:'维多利亚',count:isElite?2:1}}];
  if(id==='BGS_037') return [{trigger:'sold',behavior:'darkmoonShopGrowth',params:{rosterTribe:'*',attack:isElite?2:1,health:isElite?2:1,persistent:false}}];
  if(id==='BGS_104') return [{trigger:'bought',behavior:'darkmoonShopGrowth',params:{rosterTribe:'ELEMENTAL',faction:'炎',attack:isElite?2:1,health:isElite?2:1,persistent:true}}];
  if(id==='BGS_113') return [{trigger:'gain',behavior:'darkmoonTransformFromShop',params:{eliteCopy:isElite}}];
  if(id==='BGS_041') return [{trigger:'gain',behavior:'darkmoonBattlecryFactionGrowth',params:{rosterTribe:'DRAGON',count:isElite?2:1,outputs:['precision','vitality']}}];
  if(id==='BGS_053') return [{trigger:'gain',behavior:'darkmoonBattlecryFactionGrowth',params:{rosterTribe:'PIRATE',count:isElite?6:3,outputs:['precision'],excludeSelf:true}}];
  if(id==='BGS_128') return [{trigger:'gain',behavior:'darkmoonBattlecryFactionGrowth',params:{rosterTribe:'ELEMENTAL',count:isElite?2:1,outputs:['precision','vitality'],excludeSelf:true}}];
  if(id==='BGS_122') return [{trigger:'gain',behavior:'darkmoonAddTribeShopOffer',params:{rosterTribe:'ELEMENTAL',count:isElite?2:1}}];
  if(id==='BGS_123') return [{trigger:'gain',behavior:'darkmoonRecruitTribeToHand',params:{rosterTribe:'ELEMENTAL',count:isElite?2:1}}];
  if(id==='BGS_048') return [{trigger:'gain',behavior:'darkmoonBattlecryTargetGrowth',params:{rosterTribe:'PIRATE',perTribeBought:isElite?2:1,outputs:['precision','vitality']}}];
  if(id==='BGS_100') return [{trigger:'bought',behavior:'darkmoonBoughtTribeTargetGrowth',params:{triggerTribe:'ELEMENTAL',outputs:['precision','vitality']}}];
  if(id==='LOE_077') return [{trigger:'aura',behavior:'triggerMultiplier',params:{hook:'gain',extra:isElite?2:1,filter:'darkmoonBattlecry'}}];
  return structuredClone(RULES[id] || []);
}
