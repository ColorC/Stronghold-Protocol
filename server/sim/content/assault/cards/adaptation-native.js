// Reuse the upstream mechanism with the pinned source BBs, not the old mode's
// altered passives. Source skills/talents are deliberately restored only in the
// builder's read-only definition; the actor retains its Assault skill/runtime.
import { recordLinkEffect } from '../adaptation-primitives.js';

/** Observe selected upstream talent buffs without editing their implementation.
 * Count actual new beneficiaries / stronger stacks, never timer refreshes. */
export function observeNativeLinkBuffs(battle,unit,key,accept){
  let observers=battle.adaptationLinkBuffObservers;
  if(!observers){observers=battle.adaptationLinkBuffObservers=[];const add=battle.addBuff;
    battle.addBuff=function(target,spec){const result=add.call(this,target,spec);if(!result)return result;
      for(const watch of observers)if(watch.accept(target,spec)){
        const signature=`${target.deploySeq??0}:${result.stacks??1}:`+Object.keys(result.mods??{}).sort().map(k=>`${k}:${result.mods[k]}`).join('|');
        let seen=watch.seen.get(target);if(!seen){seen=new Map();watch.seen.set(target,seen);}
        if(seen.get(spec.key)!==signature){seen.set(spec.key,signature);recordLinkEffect(battle,watch.unit,watch.key,target);}
      }return result;
    };
  }
  observers.push({unit,key,accept,seen:new WeakMap()});
}

export function observeNativeLinkHeal(battle,unit,key,accept){
  let observers=battle.adaptationLinkHealObservers;
  if(!observers){observers=battle.adaptationLinkHealObservers=[];const heal=battle.heal;
    battle.heal=function(source,target,amount,options){const actual=heal.call(this,source,target,amount,options);
      if(actual>0)for(const watch of observers)if(watch.accept(source,target,options??{}))recordLinkEffect(battle,watch.unit,watch.key,target);
      return actual;
    };
  }
  observers.push({unit,key,accept});
}
// An instruction remains useful while its chosen tile is temporarily occupied.
// Legality and payment are handled by the summon queue; never invent a location.
export function hasManualInstruction(unit,tokenId){
  return (unit.def.raw.assaultPiece.summonPresets??[]).some(p=>p?.tokenId===tokenId&&Number.isInteger(p.row)&&Number.isInteger(p.col));
}
export function sourceKit(unit,builder,skillPatch={},talentPatches={}){
  const body=unit.def.raw.assaultBody,plan=body.adaptation;
  const bb=rows=>Object.fromEntries((rows??[]).map(r=>[r.key,r.valueStr??r.value]));
  const skills=body.source.skills.map(s=>({...s,id:s.skillId,bb:{...bb(s.blackboard),...(s.skillId===plan.sourceSkillId?skillPatch:{})},
    rangeGrid:s.skillId===plan.sourceSkillId?plan.rangeGrid:null}));
  const skill=skills.find(s=>s.skillId===plan.sourceSkillId);
  const talents=body.source.talents.map(t=>({...t,bb:{...bb(t.blackboard),...(talentPatches[t.index]??{})},bbStr:bb(t.blackboard.filter(r=>r.valueStr!=null))}));
  const raw={...unit.def.raw,skill,skills,talents,tokens:body.summonTemplateIds};
  const def={...unit.def,raw,talents,skill:{...unit.def.skill,...skill,id:skill.skillId},skills};
  return builder(skill.bb,raw,def);
}
export function installSourceParts(battle,unit,kit,{talents=true,install=true}={}){
  if(talents)for(const part of kit.talents??[])part.install?.(battle,unit);
  if(install)kit.install?.(battle,unit);
}
/** Let a finite mode resource drive a native mechanism which originally read a
 * timed skill window. The native callback sees its resource while it executes;
 * the actual skill, SP, clock and UI keep their normal instant lifecycle. */
const resourceScopes=new WeakMap();
export function installResourceParts(battle,unit,kit,enabled,options={}){
  const on=battle.on,every=battle.every;
  const wrap=(fn,event)=>function(...args){
    const skill=unit.skill;let scope=resourceScopes.get(skill);
    if(!scope){const descriptor=Object.getOwnPropertyDescriptor(skill,'active');
      if(!descriptor||!Object.hasOwn(descriptor,'value'))throw Error('Native resource bridge requires the native active field');
      scope={descriptor,actual:descriptor.value,tests:[]};resourceScopes.set(skill,scope);
      Object.defineProperty(skill,'active',{configurable:true,enumerable:descriptor.enumerable,
        get:()=>scope.actual||scope.tests.at(-1)?.(),set:value=>{scope.actual=value;}});
    }
    scope.tests.push(()=>enabled(event,args[0]));
    try{return fn(...args);}finally{scope.tests.pop();if(!scope.tests.length){Object.defineProperty(skill,'active',{...scope.descriptor,value:scope.actual});resourceScopes.delete(skill);}}
  };
  battle.on=function(event,fn,config){return on.call(this,event,wrap(fn,event),config);};
  battle.every=function(interval,fn,config){return every.call(this,interval,wrap(fn,'timer'),config);};
  try{installSourceParts(battle,unit,kit,options);}finally{battle.on=on;battle.every=every;}
}
// Native moving skills supply an inline marker kit. Assault's boundary instead
// resolves that exact marker from its calibrated registry. No unknown token can
// acquire a fallback behavior through this bridge.
export function nativeMarkerAction(battle,allowed,action){
  const spawn=battle.spawnToken;
  battle.spawnToken=function(owner,id,row,col,options={}){
    if(!allowed.includes(id))return spawn.call(this,owner,id,row,col,options);
    const {kit:_kit,...rest}=options;return spawn.call(this,owner,id,row,col,rest);
  };
  try{return action();}finally{battle.spawnToken=spawn;}
}
// An instantaneous original-state attack still uses native attack IDs,
// profession heals, target hooks, projectiles, source FX and talents.
export function nativeBurst(battle,unit,{mods={},profile={},rangeGrid,rounds,targets,beforeRound,afterRound}){
  const oldProfile=unit.profile,oldRange=unit.rangeGrid,key=`adaptation:native-burst:${unit.uid}`;
  battle.addBuff(unit,{key,mods,duration:Infinity,source:unit});
  unit.profile={...oldProfile,...profile,noAttack:false,isSkill:true};
  if(rangeGrid){unit.rangeGrid=rangeGrid;battle.refreshRange(unit);}
  try{for(let i=0;i<rounds&&unit.alive&&unit.deployed;i++){
    beforeRound?.(i);const list=targets();if(list.length)battle.forceAttack(unit,list,{noAmmo:true});afterRound?.(i);
  }}finally{unit.profile=oldProfile;unit.rangeGrid=oldRange;battle.refreshRange(unit);battle.removeBuff(unit,key);}
}
/** Immediate skill attacks retain native attack IDs/hooks and projectile FX.
 * Their damage settles now, so a delayed arrow cannot lose the cast's native
 * target locks, elemental conversion or dodge rules after skill resolution. */
export function instantAttack(battle,unit,list,{scale=1,type='arts',element=null,canDodge=true,onHit,onImpact}={}){
  const profile={...unit.profile,isSkill:true},context={attacker:unit,targets:list,isSkill:true,profile};
  if(battle.hasHook('beforeAttack'))battle.emit('beforeAttack',context);
  const selected=context.targets.filter(t=>t.alive);if(!selected.length)return false;
  const attackId=++battle._attackSeq;unit.stats.attacks++;unit.lastAttackAt=battle.time;
  battle.emit('assaultAttackStarted',{attacker:unit,targets:selected,isSkill:true,attackId,noAmmo:true});
  for(const target of selected){
    battle._ev(['atk',unit.id,target.id,unit.profile.projectile||'none',attackId,1]);
    battle.dealDamage(unit,target,{amount:unit.s.atk*scale,type,element,canDodge,isAttack:true,isSkill:true,attackId});
    onImpact?.(target);
    if(target.alive)onHit?.(target);
  }
  battle.emit('attack',{attacker:unit,targets:selected,isSkill:true,attackId});return true;
}
