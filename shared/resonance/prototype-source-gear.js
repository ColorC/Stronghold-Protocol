const SOURCE_REFERENCE=Object.freeze({game:'Teamfight Tactics',version:'Set 13 launch patch 14.23',sourceKind:'CommunityDragon extracted client data'});

// Set 13 Crown rewards that named one of these seven source items now grant the native 卫戍协议 completed item whose
// effect is closest (nativeItemId). The source record stays as provenance only; it is never shown or granted.
// Saves that already hold an old source-item id keep it as a hidden alias of that native item (same name, icon and
// effect; grantAllowed false), so no session becomes unreadable.
export const prototypeSourceGearDefinitions=Object.freeze([
  {id:'prototype_source_gear_hand_of_justice',sourceApiName:'TFT_Item_UnstableConcoction',sourceName:'Hand Of Justice',composition:['TFT_Item_TearOfTheGoddess','TFT_Item_SparringGloves'],nativeItemId:'vampBlade',reason:'攻击与全能吸血 → 休眠子裔：攻击力加成并按攻击回复生命'},
  {id:'prototype_source_gear_morellonomicon',sourceApiName:'TFT_Item_Morellonomicon',sourceName:'Morellonomicon',composition:['TFT_Item_NeedlesslyLargeRod','TFT_Item_GiantsBelt'],nativeItemId:'duelistCrest',reason:'命中灼烧 → 灼燃维式重锤：攻击附带灼燃损伤'},
  {id:'prototype_source_gear_last_whisper',sourceApiName:'TFT_Item_LastWhisper',sourceName:'Last Whisper',composition:['TFT_Item_RecurveBow','TFT_Item_SparringGloves'],nativeItemId:'quietCape',reason:'削减目标抗性 → 激光发射器：攻击无视法术抗性'},
  {id:'prototype_source_gear_protectors_vow',sourceApiName:'TFT_Item_FrozenHeart',sourceName:"Protector's Vow",composition:['TFT_Item_TearOfTheGoddess','TFT_Item_ChainVest'],nativeItemId:'armorAxe',reason:'危急时保命 → 坚固维式重锤：致命伤害后不倒'},
  {id:'prototype_source_gear_guinsoos_rageblade',sourceApiName:'TFT_Item_GuinsoosRageblade',sourceName:"Guinsoo's Rageblade",composition:['TFT_Item_RecurveBow','TFT_Item_NeedlesslyLargeRod'],nativeItemId:'thunderRing',reason:'每次攻击叠攻速 → 有限加速器'},
  {id:'prototype_source_gear_jeweled_gauntlet',sourceApiName:'TFT_Item_JeweledGauntlet',sourceName:'Jeweled Gauntlet',composition:['TFT_Item_NeedlesslyLargeRod','TFT_Item_SparringGloves'],nativeItemId:'spellblade',reason:'技能强化输出 → 炎国短刀：开启技能叠攻击力'},
  {id:'prototype_source_gear_crownguard',sourceApiName:'TFT_Item_Crownguard',sourceName:'Crownguard',composition:['TFT_Item_NeedlesslyLargeRod','TFT_Item_ChainVest'],nativeItemId:'vitalEngine',reason:'开战护盾 → 护盾无人机：部署及开启技能获得屏障'},
]);

const byApiName=new Map(prototypeSourceGearDefinitions.map(row=>[row.sourceApiName,row]));

/** Route the seven Set 13 source items to native completed items; keep their old ids readable as hidden aliases. */
export function applyPrototypeSourceGear(catalog) {
  const equipment={...catalog.equipment};
  const bySourceApiName={};
  for(const row of prototypeSourceGearDefinitions){
    if(byApiName.get(row.sourceApiName)!==row)throw new Error(`DUPLICATE_PROTOTYPE_SOURCE_GEAR:${row.sourceApiName}`);
    if(equipment[row.id])throw new Error(`PROTOTYPE_SOURCE_GEAR_ID_COLLISION:${row.id}`);
    bySourceApiName[row.sourceApiName]=row.nativeItemId;
    const native=equipment[row.nativeItemId];
    if(native?.kind!=='completed')continue;
    equipment[row.id]={...structuredClone(native),id:row.id,legacyAliasOf:row.nativeItemId,grantAllowed:false,
      source:{...SOURCE_REFERENCE,apiName:row.sourceApiName,name:row.sourceName,composition:[...row.composition],replacedBy:row.nativeItemId,reason:row.reason}};
  }
  return {...catalog,equipment,prototypeSourceGear:{definitions:prototypeSourceGearDefinitions,bySourceApiName}};
}
