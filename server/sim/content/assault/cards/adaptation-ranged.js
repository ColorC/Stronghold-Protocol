import { adaptedKit } from '../adapted-kit.js';
import { countedTrigger, recordLinkEffect } from '../adaptation-primitives.js';
import { active, damage, heal, buff, applyStatus, sp, haste, enemies, uid } from '../primitives.js';
import { withinAdjacent4, allyAura, hasStatus } from '../synergy.js';
import { assaultAmmoState } from '../ammo.js';
import { rotateOffset } from '../../../dir.js';
import { valuesOf, yours, ops, targets, canAttack, sourceKey, onDeploy, anchor } from './adaptation-core.js';
import { observeCount, conditionalSelf, chargeAdjacent, square } from './adaptation-pool.js';

const friendly=p=>p.source?.kind==='op'&&p.source.side==='ally';
const nearby=(battle,unit,point,radius)=>enemies(battle,unit,{scope:'field',count:999})
  .filter(e=>square(e.x-point.x)+square(e.y-point.y)<=square(radius));
const inSkillRange=(unit,other)=>anchor(unit).rangeKeySet.has(other.tileR*21+other.tileC);
function sourceSlow(battle,unit,target,seconds){if(target.alive)applyStatus(battle,unit,target,{status:'sluggish',duration:seconds});}
function splash(battle,unit,center,scale,type='arts'){
  const radius=unit.profile.splashRadius||1.1;
  for(const target of nearby(battle,unit,center,radius))damage(battle,unit,target,{scale,type,isSkill:true});
}
function innateBasic(battle,unit,key,run){
  battle.on('damaged',ctx=>{if(ctx.source===unit&&ctx.target?.side==='enemy'&&ctx.target.alive&&ctx.amount>0&&ctx.dmg?.isAttack)run(ctx);},{owner:unit});
}

const greyy=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit),[center]=targets(battle,unit);
    for(let i=0;i<v.hits&&center.alive;i++)for(const target of nearby(battle,unit,center,unit.profile.splashRadius||1.1)){
      damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});sourceSlow(battle,unit,target,v.slow);
    }
    return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','static-field',p=>friendly(p)&&p.source.ownerId===unit.ownerId&&p.status==='sluggish',
    ()=>chargeAdjacent(battle,unit,valuesOf(unit).charge,'static-field','CASTER'),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>innateBasic(battle,unit,'static-basic',({target})=>sourceSlow(battle,unit,target,valuesOf(unit).nativeSlow)),
});

const akkord=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit);
    for(let i=0;i<v.hits;i++){
      for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});
      for(const ally of ops(battle,unit).filter(x=>x!==unit&&inSkillRange(unit,x)))
        for(const target of nearby(battle,unit,ally,v.radius))damage(battle,unit,target,{scale:v.scale*v.echo,type:'arts',isSkill:true});
    }
    return true;
  },
  link:(battle,unit)=>{
    const selected=new Set(),v=valuesOf(unit);
    const take=countedTrigger(battle,{key:sourceKey(unit,'synchrony'),owner:unit,first:v.first},({payload})=>{
      const target=payload.source;if(!active(target))return false;
      return !!buff(battle,target,target,{key:'adaptation:akkord:synchrony',mods:{atkPct:valuesOf(unit).allyATK},duration:Infinity,persist:true});
    });
    battle.assaultRuntime.observe('skillResolved',sourceKey(unit,'synchrony-watch'),event=>{
      const target=event.payload.source;
      if(!yours(unit,target)||target===unit||selected.has(target)||!inSkillRange(unit,target)||selected.size>=v.first)return;
      selected.add(target);take({payload:event.payload,cause:event.cause,target});
    },{owner:unit});
  },
  innate:(battle,unit)=>conditionalSelf(battle,unit,'synchrony-self',()=>ops(battle,unit).some(x=>x!==unit&&inSkillRange(unit,x))?{atkPct:valuesOf(unit).selfATK}:null),
});

function indigoBind(battle,unit,target,chance){
  const stored=(unit.mem.adaptIndigoBind??0)>0;
  if(stored)unit.mem.adaptIndigoBind--;
  if(target.alive&&(stored||battle.rng()<chance))applyStatus(battle,unit,target,{status:'bind',duration:valuesOf(unit).bind});
}
const indigo=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit),energy=unit.profile.releaseEnergy?.(battle,unit)??0;
    for(const target of targets(battle,unit))for(let i=0;i<v.hits+energy&&target.alive;i++){
      damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});indigoBind(battle,unit,target,v.skillChance);
    }
    for(const target of targets(battle,unit,unit,999).filter(e=>hasStatus(e,'bind')))damage(battle,unit,target,{scale:v.maze,type:'arts',isSkill:true});
    return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','soft-binding',p=>friendly(p)&&p.source.ownerId===unit.ownerId&&p.source!==unit&&p.status==='bind',
    ()=>{unit.mem.adaptIndigoBind=(unit.mem.adaptIndigoBind??0)+1;return true;},{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{
    battle.on('beforeAttack',ctx=>{
      if(ctx.attacker!==unit||ctx.isSkill||!ctx.targets?.length)return;
      const free=enemies(battle,unit,{count:999}).filter(e=>!hasStatus(e,'bind'));
      ctx.targets=ctx.targets.filter(e=>!hasStatus(e,'bind'));if(!ctx.targets.length&&free.length)ctx.targets=[free[0]];
    },{owner:unit});
    innateBasic(battle,unit,'soft-binding-basic',({target})=>indigoBind(battle,unit,target,valuesOf(unit).nativeChance));
  },
});

const jesica=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit);unit.mem.adaptSmoke=(unit.mem.adaptSmoke??0)+v.smoke;
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'reloaded','quick-magazine',p=>p.target?.ownerId===unit.ownerId&&p.target!==unit,
    ()=>{unit.mem.adaptSmoke=(unit.mem.adaptSmoke??0)+1;return true;},{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{
    onDeploy(battle,unit,'quick-magazine-aspd',()=>buff(battle,unit,unit,{key:sourceKey(unit,'quick-magazine-aspd'),mods:{aspd:valuesOf(unit).aspd},duration:Infinity,persist:true}));
    battle.on('hit',({source,target,dmg})=>{
      if(target!==unit||source?.side!=='enemy'||dmg.canDodge===false||!['phys','arts'].includes(dmg.type))return;
      const loaded=(unit.mem.adaptSmoke??0)>0;if(loaded)unit.mem.adaptSmoke--;
      buff(battle,unit,unit,{key:sourceKey(unit,'smoke-dodge'),mods:{dodgePhys:loaded?valuesOf(unit).dodge:0,dodgeArts:loaded?valuesOf(unit).dodge:0},duration:Infinity,notify:false});
    },{owner:unit,priority:100});
  },
});

const clour=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>observeCount(battle,unit,'skillResolved','hunters-experience',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='SNIPER'&&withinAdjacent4(unit,p.source),
    ({payload})=>sp(battle,unit,payload.source,valuesOf(unit).charge,'hunters-experience',sourceKey(unit,'hunters-experience')),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>onDeploy(battle,unit,'hunters-recovery',()=>buff(battle,unit,unit,{key:sourceKey(unit,'hunters-recovery'),mods:{spRecoveryFlat:valuesOf(unit).spAura},duration:Infinity,persist:true})),
});

const pinecn=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit),past=unit.mem.adaptPinecnCasts??0,scale=v.scale+Math.min(v.maxGrowth,past)*v.growth;
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale,hits:v.hits,type:'phys',isSkill:true});
    unit.mem.adaptPinecnCasts=past+1;return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'deviceTrigger','portable-power',p=>p.source?.ownerId===unit.ownerId&&p.source!==unit,()=>{
    let n=0;for(const target of ops(battle,unit).filter(x=>x!==unit&&x.def.profession==='SNIPER'&&withinAdjacent4(unit,x)))
      if(haste(battle,unit,target,valuesOf(unit).haste,sourceKey(unit,'portable-power')))n++;return n;
  },{every:valuesOf(unit).every}),
  innate:(battle,unit)=>onDeploy(battle,unit,'portable-recovery',()=>buff(battle,unit,unit,{key:sourceKey(unit,'portable-recovery'),mods:{spRecoveryFlat:valuesOf(unit).recovery},duration:valuesOf(unit).powerTime})),
});

function inFront(unit,target){return[[0,1],[0,2]].some(([r,c])=>{const [dr,dc]=rotateOffset(r,c,unit.dir);return Math.round(target.y)===unit.tileR+dr&&Math.round(target.x)===unit.tileC+dc;});}
const acdrop=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit);unit.mem.adaptAcdropCasting=v.scale;
    try{for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits*2,type:'phys',isSkill:true});}
    finally{unit.mem.adaptAcdropCasting=0;}return true;
  },
  link:(battle,unit)=>{
    battle.assaultRuntime.observe('hit',sourceKey(unit,'sliding-floor'),event=>{
      const p=event.payload,actor=p.source,target=p.target;
      if(!active(unit)||actor!==unit||p.damageType!=='phys'||target?.side!=='enemy')return;
      const own=actor===unit;
      if(own&&!unit.mem.adaptAcdropCasting&&!(typeof p.attackId==='number'&&p.attackId>0))return;
      const v=valuesOf(unit),ratio=own&&inFront(unit,target)?v.frontFloor:v.floor;
      const minimum=actor.s.atk*(own?(unit.mem.adaptAcdropCasting||1):1)*ratio,missing=minimum-p.amount;
      if(!(missing>1e-6))return;
      battle.assaultRuntime.enqueue(()=>{
        if(target.alive)damage(battle,actor,target,{amount:missing,type:'true',cause:event.cause});
      },{key:sourceKey(unit,'sliding-floor-award'),targetUid:uid(target),cause:event.cause});
    },{owner:unit});
    observeCount(battle,unit,'ammoUsed','sliding-reply',p=>yours(unit,p.source)&&p.source!==unit,()=>{
      const [target]=targets(battle,unit);if(!target)return false;unit.mem.adaptAcdropCasting=1;
      try{return damage(battle,unit,target,{scale:1,type:'phys'});}finally{unit.mem.adaptAcdropCasting=0;}
    },{every:valuesOf(unit).every});
  },
});

const caper=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit),sure=(unit.mem.adaptCaperCritical??0)>0;if(sure)unit.mem.adaptCaperCritical--;
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.rounds*4,type:'phys',isSkill:true,crit:()=>sure||battle.rng()<v.chance?v.crit:1});return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'skillResolved','free-play',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='SNIPER',
    ()=>{unit.mem.adaptCaperCritical=(unit.mem.adaptCaperCritical??0)+1;return true;},{every:valuesOf(unit).every}),
  innate:(battle,unit)=>battle.on('hit',({source,dmg})=>{if(source===unit&&dmg.isAttack&&battle.rng()<valuesOf(unit).chance)dmg.mul*=valuesOf(unit).crit;},{owner:unit,priority:40}),
});

const skgoat=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit,cause})=>{
    const v=valuesOf(unit);
    for(let i=0;i<v.pulses;i++){
      const pulse=()=>{if(active(unit))battle.assaultRuntime.withCause(cause,()=>{for(const target of targets(battle,unit))sourceSlow(battle,unit,target,v.slow);});};
      if(i===0)pulse();else battle.after(i*v.interval,pulse,{owner:unit});
    }
    return true;
  },
  link:(battle,unit)=>{
    battle.on('beforeStatus',ctx=>{
      if(active(unit)&&ctx.status==='sluggish'&&ctx.source===unit&&ctx.target?.side==='enemy'){
        ctx.duration+=valuesOf(unit).extend;
      }
    },{owner:unit});
    battle.on('statusApplied',p=>{
      if(p.source===unit&&p.status==='sluggish'&&!p.keepalive&&p.applied!==false&&!p.immune)
        recordLinkEffect(battle,unit,'geology-extension',p.target);
    },{owner:unit});
    observeCount(battle,unit,'statusApplied','geology-reply',p=>p.source?.ownerId===unit.ownerId&&p.source!==unit&&p.status==='sluggish'&&p.target?.side==='enemy',()=>{
      const list=targets(battle,unit);for(const target of list)sourceSlow(battle,unit,target,valuesOf(unit).slow);return list.length;
    },{every:valuesOf(unit).every});
  },
});

const podego=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit,cause})=>{
    const v=valuesOf(unit),[target]=targets(battle,unit),point={x:target.x,y:target.y},amount=unit.s.atk*v.dot;
    for(let tick=0;tick<v.seconds;tick++)battle.after(tick,()=>battle.assaultRuntime.withCause(cause,()=>{
      for(const enemy of nearby(battle,unit,point,v.radius)){
        damage(battle,unit,enemy,{amount,type:'arts',isSkill:true,cause});
        if(enemy.alive){sourceSlow(battle,unit,enemy,1.01);applyStatus(battle,unit,enemy,{status:'silence',duration:1.01});}
      }
    }));
    return true;
  },
  link:(battle,unit)=>{
    allyAura(battle,unit,{key:'gardener',mods:{atkPct:valuesOf(unit).aura},select:x=>x.def.profession==='SUPPORT'});
    observeCount(battle,unit,'statusApplied','gardener-heal',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='SUPPORT'&&p.status==='sluggish',
      ({payload})=>heal(battle,unit,payload.source,{scale:valuesOf(unit).heal}),{every:valuesOf(unit).every});
  },
});

function aostaBleed(battle,unit,target,ratio,cause){
  const v=valuesOf(unit),amount=unit.s.atk*ratio;
  if(target.blockedBy)return;
  for(let tick=1;tick<=v.seconds;tick++)battle.after(tick,()=>{if(target.alive&&!target.removed)damage(battle,unit,target,{amount,type:'arts',cause});});
}
const aosta=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit,cause})=>{
    const v=valuesOf(unit);
    for(const target of targets(battle,unit)){
      damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});
      if(target.alive){applyStatus(battle,unit,target,{status:'bind',duration:v.bind});aostaBleed(battle,unit,target,v.bleed*v.bleedBonus,cause);}
    }
    return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','nail',p=>p.target?.side==='enemy'&&p.source?.ownerId===unit.ownerId&&p.source!==unit&&p.status==='bind',
    ({payload})=>damage(battle,unit,payload.target,{scale:valuesOf(unit).bleed*valuesOf(unit).seconds,type:'arts'}),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>innateBasic(battle,unit,'nail-basic',({target})=>{
    // Original same-source basic bleed refreshes; separately cast S2 packets
    // above each own their complete independent three ticks.
    if(target.blockedBy)return;
    const serial=target.mem.adaptAostaBasic??=new Map(),key=unit;
    const n=(serial.get(key)??0)+1;serial.set(key,n);const v=valuesOf(unit),amount=unit.s.atk*v.bleed;
    for(let tick=1;tick<=v.seconds;tick++)battle.after(tick,()=>{if(target.alive&&serial.get(key)===n)damage(battle,unit,target,{amount,type:'arts'});});
  }),
});

function leiziChain(battle,unit,rounds){
    const v=valuesOf(unit),[first]=targets(battle,unit),picked=[first],radius=unit.profile.chain?.radius??1.7;
    if(!first)return false;
    while(picked.length<v.chainTargets){
      const last=picked.at(-1),candidates=nearby(battle,unit,last,radius).filter(e=>!picked.includes(e))
        .sort((a,b)=>square(a.x-last.x)+square(a.y-last.y)-square(b.x-last.x)-square(b.y-last.y));
      if(!candidates.length)break;picked.push(candidates[0]);
    }
    for(let i=0;i<rounds;i++)for(const target of picked.filter(active)){
      damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});sourceSlow(battle,unit,target,unit.profile.chain?.sluggish??.5);
    }
    return true;
}
const leizi=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>leiziChain(battle,unit,valuesOf(unit).rounds),
  link:(battle,unit)=>{
    battle.on('hit',({source,target,dmg})=>{
      if(!active(unit)||source!==unit||target?.side!=='enemy'||target.blockedBy)return;
      const prior=dmg.adaptationUnimpeded??0,value=valuesOf(unit).bonus;
      if(value>prior){dmg.mul*=(1+value)/(1+prior);dmg.adaptationUnimpeded=value;}
    },{owner:unit,priority:40});
    observeCount(battle,unit,'skillResolved','unimpeded-chain',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='CASTER',
      ()=>leiziChain(battle,unit,1),{every:valuesOf(unit).every});
  },
});

const aroma=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit,cause})=>{
    const v=valuesOf(unit),chosen=targets(battle,unit);
    for(const target of chosen)damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'arts',isSkill:true});
    const amount=unit.s.atk*v.scale*v.landing;
    for(const target of chosen){
      const lift=target.findBuff('levitate');if(!lift)continue;
      battle.after(lift.timeLeft+battle.dt,()=>{if(target.alive&&!target.s.flags.levitate&&!target.isFlying)damage(battle,unit,target,{amount,type:'arts',isSkill:true,cause});});
    }
    return true;
  },
  link:(battle,unit)=>{
    const met=new WeakSet();
    observeCount(battle,unit,'hit','foam-contact',p=>{
      if(!yours(unit,p.source)||p.source===unit||p.target?.side!=='enemy'||met.has(p.target))return false;
      met.add(p.target);return true;
    },({payload})=>applyStatus(battle,unit,payload.target,{status:'levitate',duration:valuesOf(unit).lift}),{every:valuesOf(unit).every});
  },
  innate:(battle,unit)=>{
    const met=new WeakSet();
    battle.on('hit',({source,target,dmg})=>{
      if(source!==unit||target?.side!=='enemy'||!(dmg.isAttack||dmg.isSkill)||met.has(target))return;
      met.add(target);dmg.mul*=valuesOf(unit).firstScale;
      applyStatus(battle,unit,target,{status:'levitate',duration:valuesOf(unit).lift});
    },{owner:unit,priority:40});
  },
});

function funnelShot(battle,unit,target,scale){
  const ratio=unit.profile.funnelMul?.(battle,unit,target)??1;
  return battle.dealDamage(unit,target,{amount:unit.s.atk*scale*ratio,type:'arts',isSkill:true,tags:['funnel']});
}
const kjera=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit);unit.mem.adaptKjeraBurst=true;
    try{for(const target of targets(battle,unit))for(let i=0;i<v.rounds&&target.alive;i++){
      damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});
      for(let drone=0;drone<2&&target.alive;drone++)funnelShot(battle,unit,target,v.scale);
    }}finally{unit.mem.adaptKjeraBurst=false;}return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','lowered-gaze',p=>p.source?.ownerId===unit.ownerId&&p.source!==unit&&['cold','frozen','freeze'].includes(p.status),
    ()=>haste(battle,unit,unit,valuesOf(unit).haste,sourceKey(unit,'lowered-gaze')),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{
    const cold=countedTrigger(battle,{key:sourceKey(unit,'funnel-cold'),owner:unit,every:valuesOf(unit).funnelEvery},({target})=>
      applyStatus(battle,unit,target,{status:'cold',duration:valuesOf(unit).cold}));
    battle.on('damaged',({source,target,dmg})=>{if(source===unit&&unit.mem.adaptKjeraBurst&&dmg.tags?.includes('funnel')&&target.alive)cold({target,cause:battle.assaultRuntime.currentCause});},{owner:unit});
    conditionalSelf(battle,unit,'ground-gaze',()=>{
      const n=unit.rangeKeys.filter(k=>battle.grid.inRect(Math.floor(k/21),k%21)&&battle.grid.tile(Math.floor(k/21),k%21).height==='LOW').length;
      return{atkPct:n>=2?valuesOf(unit).groundATK:valuesOf(unit).atk};
    });
  },
});

function syncStandingRock(battle,unit,record=true){
 const v=valuesOf(unit),stacks=Math.min(v.maxStacks,Math.floor(((unit.mem.adaptRockElapsed??0)+1e-9)/v.interval)+(unit.mem.adaptRockReloads??0));
 const key=sourceKey(unit,'standing-rock'),before=unit.findBuff(key)?.mods?.atkPct??0,next=stacks*v.growth;
 const applied=buff(battle,unit,unit,{key,mods:{atkPct:next},duration:Infinity,persist:true});
 const increased=!!applied&&next>before+1e-9;if(record)recordLinkEffect(battle,unit,'standing-rock',unit,increased);return increased;
}
const rockr=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{
    const v=valuesOf(unit),original=unit.profile.funnel;
    unit.profile.funnel={...(original??{init:.2,delta:.15}),max:v.funnelMax};
    try{for(const target of targets(battle,unit))for(let i=0;i<v.rounds&&target.alive;i++){
      damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});if(target.alive)funnelShot(battle,unit,target,v.scale);
    }}finally{unit.profile.funnel=original;unit.trait.funnelTarget=null;unit.trait.funnelScale=original?.init??.2;}
    applyStatus(battle,unit,unit,{status:'stun',duration:v.stun});return true;
  },
  link:(battle,unit)=>observeCount(battle,unit,'reloaded','rock-reload',p=>p.target?.ownerId===unit.ownerId&&p.target!==unit,
    ()=>{unit.mem.adaptRockReloads=Math.min(valuesOf(unit).maxStacks,(unit.mem.adaptRockReloads??0)+1);return syncStandingRock(battle,unit,false);}),
  innate:(battle,unit)=>{
    battle.every(.25,()=>{
      if(!active(unit))return;unit.mem.adaptRockElapsed=(unit.mem.adaptRockElapsed??0)+.25;
      syncStandingRock(battle,unit);
    },{owner:unit});
  },
});

function proveCrit(battle,unit,target){
  const v=valuesOf(unit),[dr,dc]=rotateOffset(0,1,unit.dir),front=Math.round(target.y)===unit.tileR+dr&&Math.round(target.x)===unit.tileC+dc;
  return battle.rng()<(front?v.frontChance:v.chance)?v.crit:1;
}
const prove=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>targets(battle,unit,unit,999).some(e=>e.hp/e.s.maxHp<=valuesOf(unit).hpLimit),
  cast:({battle,unit})=>{
    const v=valuesOf(unit),target=targets(battle,unit,unit,999).find(e=>e.hp/e.s.maxHp<=v.hpLimit);
    if(!target)return false;
    damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true,crit:()=>proveCrit(battle,unit,target)});return true;
  },
  link:(battle,unit)=>{
    const credited=countedTrigger(battle,{key:sourceKey(unit,'hunting-arrow'),owner:unit},()=>true);
    battle.on('hit',({source,target,dmg})=>{
      if(source!==unit||!dmg.isAttack)return;
      const scale=proveCrit(battle,unit,target);dmg.mul*=scale;if(scale>1)credited({target});
    },{owner:unit,priority:40});
  },
});

export const adaptationRangedKits=Object.freeze({char_253_greyy:greyy,char_4051_akkord:akkord,char_469_indigo:indigo,char_235_jesica:jesica,
  char_190_clour:clour,char_440_pinecn:pinecn,char_366_acdrop:acdrop,char_4100_caper:caper,char_183_skgoat:skgoat,char_258_podego:podego,
  char_346_aosta:aosta,char_306_leizi:leizi,char_446_aroma:aroma,char_4013_kjera:kjera,char_4040_rockr:rockr,char_145_prove:prove});
