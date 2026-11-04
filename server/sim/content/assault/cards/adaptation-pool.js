import { adaptedKit } from '../adapted-kit.js';
import { countedTrigger } from '../adaptation-primitives.js';
import { active, damage, heal, buff, applyStatus, sp, gainDP, enemies } from '../primitives.js';
import { withinAdjacent4, matchesClass, cutRedeploy, allyAura } from '../synergy.js';
import { valuesOf, yours, ops, targets, canAttack, sourceKey } from './adaptation-core.js';

const controlled = p => p.target?.side === 'enemy' && ['stun', 'tremble', 'bind', 'sleep'].includes(p.status);
const square = n => n * n;
function observeCount(battle, unit, type, key, accept, effect, { every = 1, amount = () => 1 } = {}) {
  const take = countedTrigger(battle, { key: sourceKey(unit, key), owner: unit, every }, effect);
  battle.assaultRuntime.observe(type, sourceKey(unit, `watch:${key}`), event => {
    if(accept(event.payload))take({payload:event.payload,cause:event.cause,target:event.payload.target},amount(event.payload));
  }, { owner: unit });
  return take;
}
function conditionalSelf(battle, unit, key, mods) {
  battle.every(.25, () => {
    if(!active(unit))return;
    const current=mods();if(current)buff(battle,unit,unit,{key:sourceKey(unit,key),mods:current,duration:.51,notify:false});
  },{owner:unit});
}
function chargeAdjacent(battle, unit, amount, label, profession = null) {
  let granted=0;
  for(const target of ops(battle,unit).filter(x=>x!==unit&&withinAdjacent4(unit,x)&&(!profession||x.def.profession===profession)))
    granted+=sp(battle,unit,target,amount,label,sourceKey(unit,label));
  return granted;
}

// Next-attack resources stack as uses, never as a timed attack modifier. One
// real attack id carries its original multiplier through all late projectiles.
function installNextAttack(battle) {
  if(battle.adaptationNextAttackInstalled)return;
  battle.adaptationNextAttackInstalled=true;
  battle.on('assaultAttackStarted',({attacker,attackId,isSkill})=>{
    if(isSkill||!(attacker.mem?.adaptDoubleAttacks>0))return;
    attacker.mem.adaptDoubleAttacks--;
    (attacker.mem.adaptDoubleAttackIds??=new Set()).add(attackId);
  });
  battle.on('hit',({source,dmg})=>{
    if(dmg.isAttack&&source?.mem?.adaptDoubleAttackIds?.has(dmg.attackId))dmg.mul*=2;
  },{priority:35});
}
const tiger=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit);
    for(const target of targets(battle,unit))for(let i=0;i<v.hits&&target.alive;i++){
      const dealt=damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});
      if(dealt>0)heal(battle,unit,unit,{amount:dealt*v.drain,ignoreHealFree:true});
    }
    return true;
  },
  link:(battle,unit)=>{
    installNextAttack(battle);
    observeCount(battle,unit,'dodge','tiger-team',p=>yours(unit,p.target),()=>{
      const list=ops(battle,unit).filter(x=>x!==unit&&withinAdjacent4(unit,x)&&x.def.profession==='WARRIOR');
      for(const x of list)x.mem.adaptDoubleAttacks=(x.mem.adaptDoubleAttacks??0)+1;
      return list.length;
    },{every:valuesOf(unit).every});
  },
  innate:(battle,unit)=>{
    battle.on('hit',({source,target,dmg})=>{
      if(target!==unit||!active(unit))return;
      const melee=source?.profile?.attack!=='ranged'&&dmg.isAttack&&dmg.type==='phys';
      buff(battle,unit,unit,{key:sourceKey(unit,'tiger-dodge'),mods:{dodgePhys:melee?valuesOf(unit).dodge:0},duration:Infinity,notify:false});
    },{owner:unit,priority:100});
    battle.on('dodge',({target})=>{if(target===unit)unit.mem.adaptDoubleAttacks=(unit.mem.adaptDoubleAttacks??0)+1;},{owner:unit});
  },
});

const whitew=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit);
    for(const target of targets(battle,unit)){
      damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'arts',isSkill:true});
    }
    return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','spirit-destroy',p=>p.target?.side==='enemy'&&p.status==='silence'
    &&p.source?.ownerId===unit.ownerId,()=>chargeAdjacent(battle,unit,valuesOf(unit).charge,'spirit-destroy','WARRIOR'),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>battle.on('damaged',({source,target,amount,dmg})=>{
    if(source===unit&&target?.side==='enemy'&&amount>0&&target.alive&&(dmg.isAttack||dmg.isSkill))applyStatus(battle,unit,target,{status:'silence',duration:valuesOf(unit).silence});
  },{owner:unit}),
});

const broca=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit);
    for(const target of targets(battle,unit)){
      damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'arts',isSkill:true});
      if(target.alive)applyStatus(battle,unit,target,{status:'sluggish',duration:v.slow});
    }
    applyStatus(battle,unit,unit,{status:'stun',duration:v.selfStun});return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'blocked','drill-charge',p=>yours(unit,p.source)&&p.source!==unit,
    ()=>sp(battle,unit,unit,valuesOf(unit).charge,'drill-charge',sourceKey(unit,'drill-charge')),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>conditionalSelf(battle,unit,'drill',()=>unit.blocking?.filter(active).length>=2?{atkPct:valuesOf(unit).guard,defPct:valuesOf(unit).guard}:null),
});

const slchan=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit),distance=x=>square(x.x-unit.x)+square(x.y-unit.y);
    const chosen=targets(battle,unit,unit,999).sort((a,b)=>distance(b)-distance(a)).slice(0,3);
    for(const target of chosen){
      battle.pullToFront(target,unit,v.force);
      damage(battle,unit,target,{scale:v.scale,type:'true',isSkill:true});
      if(target.alive)applyStatus(battle,unit,target,{status:'stun',duration:v.stun});
    }
    return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','snow-hunter',p=>p.status==='pull'&&p.target?.side==='enemy'
    &&p.source?.ownerId===unit.ownerId,({payload})=>applyStatus(battle,unit,payload.target,{status:'stun',duration:valuesOf(unit).linkStun}),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>conditionalSelf(battle,unit,'snow-hunter-stats',()=>!unit.blocking?.some(active)?{atkPct:valuesOf(unit).guard,defPct:valuesOf(unit).guard}:null),
});

const forcer=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit),forward=unit.fwd??[0,1];
    for(const target of targets(battle,unit)){
      const {collision}=battle.assaultPushEnemy(target,unit,v.force,{from:unit,dir:{x:forward[1],y:forward[0]},fixedAngle:true,effect:true});
      if(target.alive)applyStatus(battle,unit,target,{status:'stun',duration:collision?.kind==='highland'?v.wallStun:v.stun});
      if(collision?.other?.side==='enemy'&&collision.other.alive)applyStatus(battle,unit,collision.other,{status:'stun',duration:v.brushStun});
    }
    return true;
  },
  link:(battle,unit)=>{
    observeCount(battle,unit,'statusApplied','trickshot',p=>p.status==='push'&&p.source?.ownerId===unit.ownerId
      &&p.target?.side==='enemy'&&p.target.s.massLevel>=valuesOf(unit).weight,({payload})=>{
      (payload.target.mem.adaptTrickshots??=new Map()).set(unit,battle.time+valuesOf(unit).exposed);return true;
    });
    battle.on('hit',({source,target,dmg})=>{
      if(!active(unit)||source?.ownerId!==unit.ownerId||target?.side!=='enemy'||target.s.massLevel<valuesOf(unit).weight)return;
      if(source!==unit&&!(target.mem.adaptTrickshots?.get(unit)>battle.time))return;
      const previous=dmg.defIgnoreFlat??0;dmg.defIgnoreFlat=Math.max(previous,valuesOf(unit).ignore);
    },{owner:unit,priority:45});
  },
});

const helage=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>observeCount(battle,unit,'kill','battle-plan',p=>yours(unit,p.source)&&p.source!==unit,
    ()=>heal(battle,unit,unit,{maxHpRatio:valuesOf(unit).heal,ignoreHealFree:true}),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>conditionalSelf(battle,unit,'helage-native',()=>{
    const v=valuesOf(unit);return{aspd:v.aspd*Math.min(1,Math.max(0,1-unit.hp/unit.s.maxHp)/v.lostForMax),hpRegen:unit.blocking?.some(active)?0:v.regen};
  }),
});

const platnm=(_bb,_raw,def)=>adaptedKit(def,{
  state:({unit})=>({mods:{atkPct:valuesOf(unit).atk,aspd:valuesOf(unit).aspd},enter:({battle})=>{
    unit.rangeGrid=unit.def.raw.assaultBody.adaptation.rangeGrid;battle.refreshRange(unit);
  }}),
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','full-charge',p=>controlled(p)&&p.source?.ownerId===unit.ownerId&&p.source!==unit,
    ()=>{unit.mem.adaptPlatinumFull=(unit.mem.adaptPlatinumFull??0)+1;return true;},{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{
    const multipliers=new Map();let last=-Infinity;
    battle.on('assaultAttackStarted',({attacker,attackId,isSkill})=>{
      if(attacker!==unit||isSkill)return;const v=valuesOf(unit),gap=battle.time-last;last=battle.time;
      const stored=(unit.mem.adaptPlatinumFull??0)>0;if(stored)unit.mem.adaptPlatinumFull--;
      const progress=stored?1:Math.max(0,Math.min(1,(gap-v.minGap)/(v.maxGap-v.minGap)));
      multipliers.set(attackId,1+(v.chargeScale-1)*progress);
    },{owner:unit});
    battle.on('hit',({source,dmg})=>{if(source===unit&&dmg.isAttack)dmg.mul*=multipliers.get(dmg.attackId)??1;},{owner:unit,priority:40});
  },
});

const lionhd=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit);
    for(const target of targets(battle,unit)){
      damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});
      if(target.alive)battle.addBuff(target,{key:'adaptation:lionhd:res-down',status:'resDown',mods:{resMul:1-v.resDown},duration:v.seconds,source:unit});
    }
    return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'skillResolved','fragments',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='CASTER'
    &&targets(battle,unit).length>=3,()=>sp(battle,unit,unit,valuesOf(unit).charge,'fragments',sourceKey(unit,'fragments'))),
  innate:(battle,unit)=>conditionalSelf(battle,unit,'fragments-atk',()=>({atkPct:valuesOf(unit).atk*Math.min(valuesOf(unit).maxStacks,targets(battle,unit).length)})),
});

const liesel=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit,cause})=>{
    const v=valuesOf(unit),dots=new Set();
    for(const center of targets(battle,unit)){
      const splash=enemies(battle,unit,{scope:'field',count:999}).filter(e=>square(e.x-center.x)+square(e.y-center.y)<=v.radius*v.radius);
      for(const target of splash){damage(battle,unit,target,{scale:v.scale*(splash.length>=3?1+v.bonus:1),type:'arts',isSkill:true});if(target.alive)dots.add(target);}
    }
    const amount=unit.s.atk*v.dot;
    for(const target of dots)for(let tick=1;tick<=v.seconds;tick++)battle.after(tick,()=>{
      if(target.alive&&!target.removed)damage(battle,unit,target,{amount,type:'arts',isSkill:true,cause});
    });
    return true;
  },
  link:(battle,unit)=>{
    const hitGroups=new Map();
    battle.assaultRuntime.observe('skillStart',sourceKey(unit,'group-start'),({payload})=>{if(yours(unit,payload.source))hitGroups.set(payload.source,new Set());},{owner:unit});
    battle.assaultRuntime.observe('hit',sourceKey(unit,'group-hit'),({payload})=>{if(payload.target?.side==='enemy')hitGroups.get(payload.source)?.add(payload.target);},{owner:unit});
    observeCount(battle,unit,'skillResolved','baton',p=>yours(unit,p.source)&&p.source!==unit&&(hitGroups.get(p.source)?.size??0)>=3,
      ()=>sp(battle,unit,unit,valuesOf(unit).charge,'baton',sourceKey(unit,'baton')),{every:valuesOf(unit).every});
    observeCount(battle,unit,'attack','baton-basic',p=>yours(unit,p.source)&&p.source!==unit&&(p.targets?.length??0)>=3,
      ()=>sp(battle,unit,unit,valuesOf(unit).charge,'baton',sourceKey(unit,'baton')),{every:valuesOf(unit).every});
  },
  innate:(battle,unit)=>battle.on('hit',({source,target,dmg})=>{
    if(source===unit&&dmg.isAttack&&enemies(battle,unit,{scope:'field',count:999}).filter(e=>square(e.x-target.x)+square(e.y-target.y)<=square(valuesOf(unit).radius)).length>=3)dmg.mul*=1+valuesOf(unit).bonus;
  },{owner:unit,priority:40}),
});

const malist=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit),sure=(unit.mem.adaptInsight??0)>0;if(sure)unit.mem.adaptInsight--;
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'arts',isSkill:true,crit:()=>sure||battle.rng()<v.chance?v.crit:1});
    return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'skillResolved','insight',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='CASTER',
    ()=>{unit.mem.adaptInsight=(unit.mem.adaptInsight??0)+1;return true;},{every:valuesOf(unit).every}),
  innate:(battle,unit)=>battle.on('hit',({source,dmg})=>{if(source===unit&&dmg.isAttack&&battle.rng()<valuesOf(unit).chance)dmg.mul*=valuesOf(unit).crit;},{owner:unit,priority:40}),
});

function cloudBeast(battle,unit){
  const v=valuesOf(unit),[target]=targets(battle,unit);if(!target)return false;
  damage(battle,unit,target,{scale:v.beast,type:'phys',isSkill:true});
  if(target.alive)applyStatus(battle,unit,target,{status:'cold',duration:v.cold});return true;
}
const snhunt=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit);
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale:target.moving?v.scale:v.stationary,hits:2,type:'phys',isSkill:true});
    cloudBeast(battle,unit);return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','cloud-beast',p=>p.target?.side==='enemy'&&p.status==='cold'
    &&p.source?.ownerId===unit.ownerId&&p.source!==unit,()=>cloudBeast(battle,unit),{every:valuesOf(unit).every}),
});

const texas=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit);gainDP(battle,unit,v.dp,'sword-rain');
    for(const target of targets(battle,unit)){damage(battle,unit,target,{scale:v.scale,hits:2,type:'arts',isSkill:true});if(target.alive)applyStatus(battle,unit,target,{status:'stun',duration:v.stun});}
    return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'dpReceived','tactical-delivery',p=>p.targetUid===unit.ownerId||p.ownerId===unit.ownerId,
    ()=>chargeAdjacent(battle,unit,valuesOf(unit).charge,'tactical-delivery','PIONEER'),{every:valuesOf(unit).every,amount:p=>p.amount??1}),
  innate:(battle,unit)=>{battle.addDp(unit.ownerId,valuesOf(unit).initialDP);},
});

const chiave=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit);gainDP(battle,unit,v.dp,'strip-flame');
    for(const target of targets(battle,unit)){damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});if(target.alive)battle.addBuff(target,{key:'adaptation:chiave:res-down',status:'resDown',mods:{resMul:1-v.resDown},duration:v.seconds,source:unit});}
    return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'summonEntered','mechanic',p=>p.source?.ownerId===unit.ownerId&&p.source!==unit,
    ({payload})=>cutRedeploy(battle,unit,{seconds:valuesOf(unit).cut,select:x=>x===payload.source}),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{
    allyAura(battle,unit,{key:'support-robots',mods:{redeployMul:valuesOf(unit).machineTime},select:x=>matchesClass(x,{label:'支援机械'})});
    conditionalSelf(battle,unit,'mechanic-stats',()=>{const n=ops(battle,unit).filter(x=>matchesClass(x,{label:'支援机械'})).length;return{atkPct:n*valuesOf(unit).bonus,defPct:n*valuesOf(unit).bonus};});
  },
});

export const adaptationPoolKits=Object.freeze({char_155_tiger:tiger,char_140_whitew:whitew,char_356_broca:broca,char_173_slchan:slchan,
  char_4036_forcer:forcer,char_188_helage:helage,char_204_platnm:platnm,char_373_lionhd:lionhd,char_4031_liesel:liesel,
  char_4054_malist:malist,char_4211_snhunt:snhunt,char_102_texas:texas,char_349_chiave:chiave});
export { observeCount, conditionalSelf, chargeAdjacent, square };
