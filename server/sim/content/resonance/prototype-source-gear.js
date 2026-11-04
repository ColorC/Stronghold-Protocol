import { resolvePrototypeCritical } from '../../../../shared/resonance/prototype-critical.js';

// The seven Set 13 source items are native completed items now (shared/resonance/prototype-source-gear.js); an old
// source-item id is a hidden alias whose effects run through equipment.js like the item it maps to. What stays here
// is the V3 critical-hit resolution the source items used to share: the baseline attack crit, the 突袭 (redeploy)
// trait's crit chance / damage with ability crits, and the Chem crit chance.
const metric=(battle,id,key)=>{
  battle.resonanceMetrics??={};battle.resonanceMetrics.prototypeSourceGear??={};
  const row=battle.resonanceMetrics.prototypeSourceGear[id]??={};row[key]=(row[key]??0)+1;
};

function critConfig(unit,activeTraits){
  const charId=unit?.charId??unit?.def?.raw?.charId;
  const ambusher=activeTraits.find(row=>row.id==='redeploy'&&row.members?.includes(charId));
  return {ambusher,critChance:ambusher?Number(ambusher.variables?.CritChance??0):0,critDamageBonus:ambusher?Number(ambusher.variables?.CritDamage??0):0};
}

function installSourceCrit(battle,configs){
  battle.prototypeSourceCritInstalled=true;
  battle.on('hit',event=>{
    const source=event?.source;
    if(source?.side!=='ally'||source?.kind!=='op')return;
    const config=configs.get(source);
    const externalChance=Number(source.mem?.prototypeChemCritChance??0);
    const result=resolvePrototypeCritical(event,{battle,bonusChance:(config?.critChance??0)+(Number.isFinite(externalChance)?externalChance:0),abilityCrit:!!config?.ambusher,critDamageBonus:config?.critDamageBonus??0,baseAttackChance:.25});
    if(result.critical){
      metric(battle,'prototype_source_gear_critical','hits');
      if(config?.ambusher){battle.resonanceMetrics.prototypeTraits??={};battle.resonanceMetrics.prototypeTraits.redeploy??={};battle.resonanceMetrics.prototypeTraits.redeploy.criticalHits=(battle.resonanceMetrics.prototypeTraits.redeploy.criticalHits??0)+1;}
    }
  },{owner:battle});
}

/** Install the V3 critical-hit resolution on every operator of a V3 Battle. */
export function installPrototypeSourceGear(battle,state,catalog,activeTraits=[]){
  if(catalog?.prototypeMeta?.rulesVersion!==3)return {installed:0};
  const configs=new Map();
  for(const unit of battle.allyUnits??[])if(unit?.kind==='op')configs.set(unit,critConfig(unit,activeTraits));
  installSourceCrit(battle,configs);
  return {installed:0};
}
