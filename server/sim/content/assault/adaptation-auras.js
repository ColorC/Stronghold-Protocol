import { active, buff, uid } from './primitives.js';

/** The native 技力光环 family takes its highest eligible value, including
 * Ptilopsis's whole-party aura and Mostima/Suzuran's profession auras. Haste
 * remains a separate ×2 multiplier and direct SP grants never enter here. */
export function naturalSpAura(battle,source,key,value,select=()=>true){
  let state=battle.adaptationNaturalSpAuras;
  if(!state){
    state={sources:new Map(),holders:new Set()};battle.adaptationNaturalSpAuras=state;
    state.sync=()=>{
      const current=new Set(battle.allyUnits.filter(t=>active(t)&&t.kind==='op'));
      for(const target of new Set([...state.holders,...current])){
        const eligible=[...state.sources.values()].filter(entry=>active(entry.source)&&entry.source.ownerId===target.ownerId&&entry.select(target));
        const winner=current.has(target)?eligible.sort((a,b)=>b.value-a.value||a.source.id-b.source.id)[0]:null;
        if(winner){buff(battle,winner.source,target,{key:'adaptation:natural-sp-aura',mods:{spRecoveryFlat:winner.value},duration:Infinity,notify:false});state.holders.add(target);}
        else{if(target.findBuff('adaptation:natural-sp-aura'))battle.removeBuff(target,'adaptation:natural-sp-aura');state.holders.delete(target);}
      }
    };
    battle.every(.25,state.sync);battle.on('deploy',state.sync);battle.on('death',state.sync);
  }
  state.sources.set(`${uid(source)}:${key}`,{source,value,select});state.sync();
}
