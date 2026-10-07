// Source-id keyed, authored adapters for Darkmoon effects delivered in preparation.
// Gear IDs intentionally reuse the project's nine stable keyword-gear definitions.
import { darkmoonCombatMetadata } from '../../sim/content/independent/darkmoonCombat.js';
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
  BGS_060: [grantSelf(gear('坚守盟约'))],
  BGS_071: [grantSelf(gear('护盾发生器'))],
  BGS_119: [grantSelf(gear('护盾发生器'))], BGS_121: [grantSelf(gear('坚守盟约'))],
  BGS_124: [grantSelf(gear('坚守盟约')),{trigger:'gain',behavior:'darkmoonPlayedFactionCountSelfGrowth',params:{faction:'炎',attackUnits:{normal:0,elite:0},secondaryUnitsPerTarget:{normal:1,elite:2}}}], BGS_127: [grantSelf(gear('坚守盟约')),
    {trigger:'bought',behavior:'darkmoonBoughtSelfGrowth',params:{faction:'炎',attackUnits:{normal:0,elite:0},secondaryUnits:{normal:1,elite:2}}}],
  BGS_201: [grantSelf(gear('坚守盟约'))],
  BGS_205: [grantSelf(gear('护盾发生器'),gear('不屈盟约'))],
  BOT_911: [grantSelf(gear('坚守盟约'),gear('护盾发生器')),{trigger:'gain',behavior:'darkmoonMagneticMerge',params:{sourceId:'BOT_911',faction:'哥伦比亚',attackUnits:{normal:1,elite:2},secondaryUnits:{normal:1,elite:2}}}],
  FP1_024: [grantSelf(gear('坚守盟约'))],
  ICC_858: [grantSelf(gear('护盾发生器'))],
  ULD_217: [grantSelf(gear('不屈盟约')),{trigger:'prepEnd',behavior:'darkmoonEndTurnGrowth',params:{mode:'randomOtherFriendly',attackUnits:{normal:1,elite:2},secondaryUnits:{normal:0,elite:0}}}],
  BGS_033: [{trigger:'roundStart',behavior:'darkmoonPreviousWinSelfGrowth',params:{attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}}],
  // Pack Leader / Mama Bear grant their original permanent stat increase to each
  // newly recruited or first-played Siracusa unit; this is not an aura on old units.
  BGS_017: [{trigger:'gain',behavior:'darkmoonBeastSummonGrowth',params:{faction:'叙拉古',attackUnits:{normal:2,elite:4},secondaryUnits:{normal:0,elite:0}}}],
  BGS_021: [{trigger:'gain',behavior:'darkmoonBeastSummonGrowth',params:{faction:'叙拉古',attackUnits:{normal:4,elite:8},secondaryUnits:{normal:4,elite:8}}}],
  BGS_120: [{trigger:'gain',behavior:'darkmoonPlayedTribeGrowth',params:{faction:'炎',attackUnits:{normal:1,elite:2},secondaryUnits:{normal:1,elite:2}}}],
  GVG_048: [{trigger:'gain',behavior:'darkmoonBattlecryFactionGrowth',params:{faction:'哥伦比亚',count:{normal:2,elite:4},excludeSelf:true,outputs:['precision']}}],
  CFM_315: [{trigger:'gain',behavior:'darkmoonSummonSupport',params:{normalId:'darkmoon:support-cat-1-1',eliteId:'darkmoon:support-cat-2-2'}}],
  BGS_009: [{trigger:'prepEnd',behavior:'darkmoonEndTurnGrowth',params:{mode:'randomEachFaction',attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}}],
  BGS_036: [{trigger:'prepEnd',behavior:'darkmoonEndTurnGrowth',params:{mode:'selfPerFaction',faction:'卡西米尔',attackPer:{normal:1,elite:2},secondaryPer:{normal:1,elite:2}}}],
  BGS_038: [grantSelf(gear('坚守盟约')),{trigger:'gain',behavior:'darkmoonBattlecryTargetGrowth',params:{faction:'卡西米尔',fixedCount:0,attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}}],
  BGS_066: [{trigger:'prepEnd',behavior:'darkmoonEndTurnGrowth',params:{mode:'selfIfGolden',attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}}],
  BGS_075: [{trigger:'gain',behavior:'darkmoonPlayedTagSelfGrowth',params:{tag:'deathrattle',attackUnits:{normal:1,elite:2},secondaryUnits:{normal:1,elite:2}}}],
  BGS_081: [{trigger:'bought',behavior:'darkmoonBoughtSelfGrowth',params:{faction:'维多利亚',attackUnits:{normal:1,elite:2},secondaryUnits:{normal:1,elite:2}}}],
  BGS_082: [{trigger:'gain',behavior:'darkmoonEndTurnGrowth',params:{mode:'randomDistinctFaction',targets:{normal:3,elite:3},attackUnits:{normal:1,elite:2},secondaryUnits:{normal:1,elite:2}}}],
  BGS_083: [{trigger:'gain',behavior:'darkmoonEndTurnGrowth',params:{mode:'randomDistinctFaction',targets:{normal:3,elite:3},attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}}],
  BGS_105: [{trigger:'prepEnd',behavior:'darkmoonEndTurnGrowth',params:{mode:'leftmostPerPurchase',faction:'炎',attackPer:{normal:1,elite:2},secondaryPer:{normal:1,elite:2}}}],
  BGS_202: [{trigger:'prepEnd',behavior:'darkmoonEndTurnGrowth',params:{mode:'selfPerDistinctFaction',attackPer:{normal:1,elite:2},secondaryPer:{normal:2,elite:4}}}],
  CFM_816: [{trigger:'gain',behavior:'darkmoonBattlecryTargetGrowth',params:{faction:'叙拉古',fixedCount:0,attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}}],
  DS1_070: [{trigger:'gain',behavior:'darkmoonBattlecryTargetGrowth',params:{faction:'叙拉古',fixedCount:0,attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4},extraGear:['independent:坚守盟约']}}],
  EX1_093: [{trigger:'gain',behavior:'darkmoonAdjacentGrowth',params:{attackUnits:{normal:1,elite:2},secondaryUnits:{normal:1,elite:2},extraGear:['independent:坚守盟约']}}],
  GVG_027: [{trigger:'prepEnd',behavior:'darkmoonEndTurnGrowth',params:{mode:'randomOtherFaction',faction:'哥伦比亚',attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}}],
  GVG_055: [{trigger:'gain',behavior:'darkmoonBattlecryTargetGrowth',params:{faction:'哥伦比亚',fixedCount:0,attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}}],
  ICC_029: [{trigger:'prepEnd',behavior:'darkmoonEndTurnGrowth',params:{mode:'randomOtherFriendly',attackUnits:{normal:3,elite:6},secondaryUnits:{normal:0,elite:0}}}],
  ICC_807: [{trigger:'gain',behavior:'darkmoonTaggedGrowth',params:{gearId:'oath-cover',attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}}],
  BGS_027: [{ trigger:'roundStart', behavior:'grantEquipment', params:{ landOn:'self', outputs:[{id:'precision',normal:1,elite:2}] } }],
  BGS_116: [{ trigger:'gain', behavior:'freeRefresh', params:{ normal:1, elite:2 } }],
});

export const DARKMOON_PREP_SUPPORTED_IDS = Object.freeze(Object.keys(RULES));

export function darkmoonPrepRulesFor(source,isElite=false) {
  // The generated design add-on carries sourceRefs.darkmoon19_2.id. Do not infer a source
  // from a matching operator name: it is activated only when a compiled source ref is attached.
  const id = source?.sourceRefs?.darkmoon19_2?.id || source?.darkmoonSourceId;
  if(id==='BOT_312') return [{trigger:'gain',behavior:'darkmoonMagneticMerge',params:{sourceId:'BOT_312',faction:'哥伦比亚'}}];
  if(id==='BGS_055') return [{trigger:'gain',behavior:'factionReaction',params:{mode:'discount',targets:'self',count:isElite?2:1,excludeSelf:false,maxEventsPerPrep:3}}];
  if(id==='BGS_043') return [{trigger:'gain',behavior:'darkmoonLastWarbandRecruit',params:{source:'previousRoundFriendlyWarband',pristine:true}}];
  if(id==='BGS_115') return [{trigger:'sold',behavior:'darkmoonElementalTokenOffer',params:{supportId:'darkmoon:support-elemental-2-2',count:isElite?2:1}}];
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
