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
  BGS_038: [grantSelf(gear('坚守盟约'))], BGS_040: [grantSelf(gear('护盾发生器'))],
  BGS_060: [grantSelf(gear('坚守盟约'))], BGS_067: [grantSelf(gear('护盾发生器'))],
  BGS_071: [grantSelf(gear('护盾发生器'))], BGS_110: [grantSelf(gear('坚守盟约'))],
  BGS_111: [grantSelf(gear('坚守盟约'))], BGS_112: [grantSelf(gear('坚守盟约'))],
  BGS_119: [grantSelf(gear('护盾发生器'))], BGS_121: [grantSelf(gear('坚守盟约'))],
  BGS_124: [grantSelf(gear('坚守盟约'))], BGS_127: [grantSelf(gear('坚守盟约'))],
  BGS_201: [grantSelf(gear('坚守盟约'))],
  BGS_205: [grantSelf(gear('坚守盟约'),gear('护盾发生器'),gear('不屈盟约'))],
  BOT_218: [grantSelf(gear('坚守盟约'))], BOT_911: [grantSelf(gear('坚守盟约'),gear('护盾发生器'))],
  DS1_070: [grantSelf(gear('坚守盟约'))], EX1_093: [grantSelf(gear('坚守盟约'))],
  FP1_024: [grantSelf(gear('坚守盟约'))], ICC_807: [grantSelf(gear('坚守盟约'))],
  ICC_858: [grantSelf(gear('护盾发生器'))], OG_221: [grantSelf(gear('护盾发生器'))],
  ULD_217: [grantSelf(gear('不屈盟约'))],
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
  if(id==='BGS_072') return [{trigger:'bought',behavior:'darkmoonRosterTribePurchaseFunds',params:{faction:'维多利亚',count:isElite?2:1}}];
  if(id==='BGS_037') return [{trigger:'sold',behavior:'darkmoonShopGrowth',params:{rosterTribe:'*',attack:isElite?2:1,health:isElite?2:1,persistent:false}}];
  if(id==='BGS_104') return [{trigger:'bought',behavior:'darkmoonShopGrowth',params:{rosterTribe:'ELEMENTAL',faction:'炎',attack:isElite?2:1,health:isElite?2:1,persistent:true}}];
  if(id==='BGS_113') return [{trigger:'gain',behavior:'darkmoonTransformFromShop',params:{eliteCopy:isElite}}];
  if(id==='BGS_041') return [{trigger:'gain',behavior:'darkmoonBattlecryFactionGrowth',params:{faction:'卡西米尔',count:isElite?2:1,outputs:['precision','vitality']}}];
  if(id==='BGS_053') return [{trigger:'gain',behavior:'darkmoonBattlecryFactionGrowth',params:{faction:'维多利亚',count:isElite?6:3,outputs:['precision'],excludeSelf:true}}];
  if(id==='BGS_128') return [{trigger:'gain',behavior:'darkmoonBattlecryFactionGrowth',params:{faction:'炎',count:isElite?2:1,outputs:['precision','vitality'],excludeSelf:true}}];
  if(id==='BGS_122') return [{trigger:'gain',behavior:'darkmoonAddTribeShopOffer',params:{faction:'炎',count:isElite?2:1}}];
  if(id==='BGS_123') return [{trigger:'gain',behavior:'darkmoonRecruitTribeToHand',params:{faction:'炎',count:isElite?2:1}}];
  if(id==='BGS_048') return [{trigger:'gain',behavior:'darkmoonBattlecryTargetGrowth',params:{faction:'维多利亚',perTribeBought:isElite?2:1,outputs:['precision','vitality']}}];
  if(id==='BGS_100') return [{trigger:'bought',behavior:'darkmoonBoughtTribeTargetGrowth',params:{triggerFaction:'炎',outputs:['precision','vitality']}}];
  if(id==='LOE_077') return [{trigger:'aura',behavior:'triggerMultiplier',params:{hook:'gain',extra:isElite?2:1,filter:'darkmoonBattlecry'}}];
  return structuredClone(RULES[id] || []);
}
