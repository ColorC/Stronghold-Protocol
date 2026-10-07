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
  BGS_049: [{ trigger:'sold', behavior:'deferredFunds', params:{ normal:3, elite:6 } }],
  BGS_116: [{ trigger:'gain', behavior:'freeRefresh', params:{ normal:1, elite:2 } }],
});

export const DARKMOON_PREP_SUPPORTED_IDS = Object.freeze(Object.keys(RULES));

export function darkmoonPrepRulesFor(source,isElite=false) {
  // The generated design add-on carries sourceRefs.darkmoon19_2.id. Do not infer a source
  // from a matching operator name: it is activated only when a compiled source ref is attached.
  const id = source?.sourceRefs?.darkmoon19_2?.id || source?.darkmoonSourceId;
  if(id==='BGS_055') return [{trigger:'gain',behavior:'factionReaction',params:{mode:'discount',targets:'self',count:isElite?2:1,excludeSelf:false,maxEventsPerPrep:1}}];
  return structuredClone(RULES[id] || []);
}
