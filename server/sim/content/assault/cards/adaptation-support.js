import { adaptedKit } from '../adapted-kit.js';
import { active, allies, buff, damage, heal, applyStatus, sp, gainDP, uid } from '../primitives.js';
import { allyAura, withinAdjacent4 } from '../synergy.js';
import { valuesOf, yours, ops, targets, sourceKey, onDeploy, anchor } from './adaptation-core.js';
import { observeCount, square } from './adaptation-pool.js';
import { powi } from '../../../detmath.js';
import { aggregateMods } from '../../../buffs.js';
import { recordLinkEffect } from '../adaptation-primitives.js';

const inRange=(unit,target)=>anchor(unit).rangeKeySet.has(target.tileR*21+target.tileC);
const friends=(battle,unit)=>allies(battle,unit,{anchor:anchor(unit),count:999}).filter(t=>t.ownerId===unit.ownerId);
const allInRange=(battle,unit)=>battle.allyUnits.filter(t=>active(t)&&t.ownerId===unit.ownerId&&t.kind!=='device'&&inRange(unit,t));
const wounded=list=>list.filter(t=>t.hp<t.s.maxHp-1e-7).sort((a,b)=>a.hp/a.s.maxHp-b.hp/b.s.maxHp||a.id-b.id);
const around=(unit,target)=>Math.max(Math.abs(unit.tileR-target.tileR),Math.abs(unit.tileC-target.tileC))<=1;
const elementLoad=t=>Math.max(0,...Object.values(t.elem??{}).filter(Number.isFinite));
const ABNORMAL=new Set(['stun','freeze','cold','sleep','slow','sluggish','bind','fragile','artsFragile','physFragile','elemFragile',
  'silence','fear','tremble','disarm','levitate','weaken','aspdDown','defDown','resDown','palsy','groundbind']);
const controlled=t=>t.buffs.some(b=>ABNORMAL.has(b.status));
function pickHeal(battle,unit,list,scale){const target=wounded(list)[0];return target?heal(battle,unit,target,{scale}):0;}
function resist(battle,unit,target,seconds){return applyStatus(battle,unit,target,{status:'resist',duration:seconds});}
function regenAura(battle,unit,key,select,amount){
  battle.every(1,()=>{if(active(unit))for(const target of battle.allyUnits.filter(t=>active(t)&&t.ownerId===unit.ownerId&&select(t)))
    recordLinkEffect(battle,unit,key,target,heal(battle,unit,target,{amount:amount(),regen:true})>0);},{owner:unit});
}

// A grant owns uses rather than a refresh timer. An entire native attack id
// keeps its grant through late projectiles; native multi-target/chain healing
// is boosted only while that one healing attack is being performed.
function installAttackUses(battle){
  if(battle.adaptationAttackUses)return;
  battle.adaptationAttackUses=true;
  battle.on('assaultAttackStarted',({attacker,attackId,isSkill})=>{
    if(isSkill)return;
    let added=0,flat=0,inspire=0;const extras=[];
    const nativeInspire=Math.max(0,...attacker.buffs.filter(b=>b.key==='inspire'||b.status==='inspire').map(b=>b.data?.val??0));
    for(const [key,queue]of Object.entries(attacker.mem.adaptAttackUses??{})){
      let index=0;
      if(queue[0]?.inspire){
        for(let i=1;i<queue.length;i++)if((queue[i].flat??0)>(queue[index].flat??0))index=i;
        if((queue[index].flat??0)<=nativeInspire)continue;
      }
      const grant=queue.splice(index,1)[0];if(!grant)continue;added+=grant.atk??0;
      if(grant.inspire)inspire=Math.max(inspire,grant.flat??0);else flat+=grant.flat??0;
      if(grant.extra)extras.push({...grant.extra,source:grant.source});
      if(grant.loss>0)battle.loseHp(attacker,attacker.s.maxHp*grant.loss,{source:grant.source});
      battle.after(battle.dt,()=>syncAttackSpeed(battle,attacker,key));
    }
    // 鼓舞 is an added final attribute, strongest same-attribute source wins.
    // A native inspire already in the actor's stats must not be added twice.
    flat+=Math.max(0,inspire-nativeInspire);
    const factor=attacker.s.atk>0?1+(attacker.base.atk*added+flat)/attacker.s.atk:1;
    if(factor!==1){(attacker.mem.adaptGrantedAttackIds??=new Map()).set(attackId,factor);attacker.mem.adaptGrantedHeal=factor;}
    if(extras.length)(attacker.mem.adaptGrantedAttackExtras??=new Map()).set(attackId,extras);
  });
  battle.on('attack',({attacker})=>{if(attacker.mem)attacker.mem.adaptGrantedHeal=0;},{priority:-100});
  battle.on('hit',({source,target,dmg})=>{
    if(!dmg.isAttack)return;
    const factor=source?.mem?.adaptGrantedAttackIds?.get(dmg.attackId);if(factor)dmg.mul*=factor;
    for(const extra of source?.mem?.adaptGrantedAttackExtras?.get(dmg.attackId)??[])battle.assaultRuntime.enqueue(()=>{
      if(active(target))damage(battle,extra.source,target,{amount:extra.amount,type:extra.type??'true'});
    },{key:`adaptation:attack-extra:${uid(extra.source)}`,targetUid:uid(target),cause:battle.assaultRuntime.currentCause});
  },{priority:35});
  battle.on('healingAmount',ctx=>{if(ctx.source?.mem?.adaptGrantedHeal&&!ctx.opts?.regen)ctx.amount*=ctx.source.mem.adaptGrantedHeal;});
}
function syncAttackSpeed(battle,target,key){
  const queue=target.mem.adaptAttackUses?.[key],aspd=queue?.[0]?.aspd??0,buffKey=`adaptation:attack-uses:${key}`;
  if(aspd)buff(battle,queue[0].source,target,{key:buffKey,mods:{aspd},duration:Infinity,notify:false});
  else if(target.findBuff(buffKey))battle.removeBuff(target,buffKey);
}
export function grantAttackUses(battle,source,target,key,uses,values){
  if(values.inspire&&noInspire(target))return;
  installAttackUses(battle);
  const queue=(target.mem.adaptAttackUses??={})[key]??=[];
  for(let i=0;i<uses;i++)queue.push({...values,source});syncAttackSpeed(battle,target,key);
}

const INSPIRE_KEY='adaptation:hit-inspire',INSPIRE_STATS=['hpFlat','defFlat','atkFlat'];
const noInspire=target=>target.mem.noInspire||target.def.raw?.assaultBody?.subProfessionId==='bard';
function hitInspireSelection(target){
  const selected=new Map(),mods={},grants=Object.entries(target.mem.adaptHitUses??{})
    .flatMap(([key,queue])=>queue.filter(g=>g.inspire).map(grant=>({key,grant})));
  const {add,mul}=aggregateMods(target.buffs.filter(b=>b.key!==INSPIRE_KEY));
  const factors={hpFlat:Math.max(0,1+(add.hpPct??0))*(mul.hpMul??1),
    defFlat:Math.max(0,1+(add.defPct??0))*(mul.defMul??1),atkFlat:Math.max(0,1+(add.atkPct??0))*(mul.atkMul??1)};
  const choose=(key,grant)=>{const set=selected.get(key)??new Set();set.add(grant);selected.set(key,set);};
  for(const stat of INSPIRE_STATS){
    const native=Math.max(0,...target.buffs.filter(b=>b.key!==INSPIRE_KEY&&(b.status==='inspire'||b.key.startsWith('inspire')))
      .map(b=>b.mods?.[stat]?b.data?.val??b.mods[stat]*factors[stat]:0));
    let best=native,winner=null;
    for(const item of grants)if((item.grant.mods?.[stat]??0)>best){best=item.grant.mods[stat];winner=item;}
    if(winner){choose(winner.key,winner.grant);mods[stat]=(best-native)/(factors[stat]>1e-6?factors[stat]:1);}
  }
  // Non-inspire parts such as Heidi's +block remain one named resource.
  for(const [key,queue]of Object.entries(target.mem.adaptHitUses??{})){
    const own=queue.filter(g=>g.inspire);if(!own.length)continue;
    const extra={};
    for(const grant of own)for(const [stat,value]of Object.entries(grant.mods??{}))
      if(!INSPIRE_STATS.includes(stat)&&value>(extra[stat]?.value??-Infinity))extra[stat]={grant,value};
    for(const {grant}of Object.values(extra))choose(key,grant);
  }
  return {selected,mods};
}
function syncHitInspire(battle,target){
  const {mods}=hitInspireSelection(target);
  if(Object.keys(mods).length)buff(battle,target,target,{key:INSPIRE_KEY,mods,duration:Infinity,notify:false});
  else if(target.findBuff(INSPIRE_KEY))battle.removeBuff(target,INSPIRE_KEY);
}

// Independent incoming-hit resources (care, thorns, deferred damage, inspire).
// Recasting appends uses. One attack consumes one packet of each named kind.
function installHitUses(battle){
  if(battle.adaptationHitUses)return;battle.adaptationHitUses=true;
  battle.adaptInspireRecipients=new Set();
  battle.every(.25,()=>{for(const target of battle.adaptInspireRecipients)if(active(target))syncHitInspire(battle,target);});
  battle.on('hpDamage',ctx=>{
    const enemy=ctx.source??ctx.credit;
    if(enemy?.side!=='enemy'||!ctx.dmg)return;
    const target=ctx.target;
    const selection=hitInspireSelection(target).selected;
    // Snapshot every contributing source before consuming anything. A final
    // strong packet must not expose and consume a weaker packet on this hit.
    const spent=Object.entries(target.mem.adaptHitUses??{}).flatMap(([key,queue])=>
      [...(selection.get(key)??(queue[0]&&!queue[0].inspire?[queue[0]]:[]))].map(grant=>({key,queue,grant})));
    for(const {key,queue,grant}of spent){
      if((!ctx.dmg.isAttack&&!grant.anyDamage)||grant.damageTypes&&!grant.damageTypes.includes(ctx.dmg.type))continue;
      queue.splice(queue.indexOf(grant),1);
      const deferred=grant.defer&&['phys','arts'].includes(ctx.dmg.type)?ctx.amount*grant.defer:0;
      if(deferred){ctx.amount-=deferred;for(let tick=1;tick<=grant.duration;tick++)battle.after(tick,()=>{
        if(active(target))battle.loseHp(target,deferred/grant.duration,{source:grant.source,tags:['adaptationDeferred']});
      });}
      const counter=grant.counter??(grant.counterDef?target.s.def*grant.counterDef:0);
      battle.assaultRuntime.enqueue(()=>{
        if(active(target)&&grant.heal>0)heal(battle,grant.source,target,{amount:grant.heal});
        if(active(enemy)&&counter>0){const dealt=damage(battle,grant.source,enemy,{amount:counter,type:grant.type??'arts',isSkill:true,traitAlly:grant.traitAlly});
          if(dealt>0&&active(target)&&grant.leech)heal(battle,grant.source,target,{amount:dealt*grant.leech});}
        grant.onUse?.({battle,source:grant.source,target,enemy});
        syncHitMods(battle,target,key);
        if(grant.inspire)syncHitInspire(battle,target);
      },{key:`adaptation:hit-use:${key}`,targetUid:uid(target),cause:battle.assaultRuntime.currentCause});
    }
  },{priority:10});
}
function syncHitMods(battle,target,key){
  const next=target.mem.adaptHitUses?.[key]?.[0],buffKey=`adaptation:hit-uses:${key}`;
  const mods=next?.inspire?Object.fromEntries(Object.entries(next.mods??{}).filter(([stat])=>!INSPIRE_STATS.includes(stat))):next?.mods;
  if(mods&&Object.keys(mods).length)buff(battle,next.source,target,{key:buffKey,mods,duration:Infinity,notify:false});
  else if(target.findBuff(buffKey))battle.removeBuff(target,buffKey);
}
export function grantHitUses(battle,source,target,key,uses,values){
  if(values.inspire&&noInspire(target))return;
  installHitUses(battle);const queue=(target.mem.adaptHitUses??={})[key]??=[];
  for(let i=0;i<uses;i++)queue.push({...values,source});syncHitMods(battle,target,key);
  if(values.inspire){battle.adaptInspireRecipients.add(target);syncHitInspire(battle,target);}
  // A compressed attack follows this grant in the same call. Fill newly
  // available native block slots now, so +block skills hit their full original
  // blocked-target set without waiting for the next movement tick.
  if(values.mods?.blockCnt>0)for(const enemy of battle.enemies)if(active(enemy)&&!enemy.blockedBy)battle._checkBlock(enemy);
}

const myrtle=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit);gainDP(battle,unit,v.dp,sourceKey(unit,'healing-wings'));
    for(let i=0;i<v.heals;i++)pickHeal(battle,unit,friends(battle,unit).filter(t=>around(unit,t)),v.heal);return true;},
  link:(battle,unit)=>regenAura(battle,unit,'golden-light',t=>t.def.profession==='PIONEER',()=>valuesOf(unit).regen),
});
const flower=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>wounded(friends(battle,unit)).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(let i=0;i<v.heals;i++)for(const target of wounded(friends(battle,unit)).slice(0,3))heal(battle,unit,target,{scale:v.heal});return true;},
  link:(battle,unit)=>regenAura(battle,unit,'lavender',()=>true,()=>unit.s.atk*valuesOf(unit).regen),
});
const finlpp=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>wounded(friends(battle,unit)).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(let i=0;i<v.heals;i++){
    const list=wounded(friends(battle,unit));if(!list.length)break;heal(battle,unit,list[Math.floor(battle.rng()*list.length)],{scale:v.heal});}return true;},
  link:(battle,unit)=>battle.on('heal',({source,target,opts})=>{if(source===unit&&!opts?.regen)resist(battle,unit,target,valuesOf(unit).resist);},{owner:unit}),
});
const elysm=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit);gainDP(battle,unit,v.dp,sourceKey(unit,'listen'));
    for(const target of targets(battle,unit))buff(battle,unit,target,{key:sourceKey(unit,'listen-lock'),mods:{moveMul:1-v.slow,defMul:1-v.def},flags:{reveal:true},duration:v.duration});
    for(const target of ops(battle,unit).filter(t=>t.def.profession==='SNIPER'))grantAttackUses(battle,unit,target,'sniper-support',v.uses,{aspd:v.aspd});return true;},
  link:(battle,unit)=>battle.assaultRuntime.observe('deployed',sourceKey(unit,'sniper-discount'),({payload})=>{
    if(payload.target?.ownerId!==unit.ownerId)return;
    const targets=payload.target===unit?ops(battle,unit):[payload.target];
    for(const target of targets)if(target.kind==='op'&&target.def.profession==='SNIPER'){
      const key=sourceKey(unit,'cost'),old=target.mem.adaptElysmCost??=new Set();
      if(!old.has(key)){old.add(key);target.mem.assaultCostDelta=(target.mem.assaultCostDelta??0)-valuesOf(unit).cost;}
    }
  },{owner:unit}),
});
const wanqin=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit);gainDP(battle,unit,v.dp,sourceKey(unit,'east-wind'));
    const list=friends(battle,unit).filter(t=>around(unit,t));for(let i=0;i<v.heals;i++)for(const target of list)heal(battle,unit,target,{scale:v.heal});
    for(const target of allInRange(battle,unit).filter(t=>around(unit,t)&&t!==unit&&t.dir===unit.dir))grantAttackUses(battle,unit,target,'east-wind',v.uses,{aspd:v.aspd});return true;},
  link:(battle,unit)=>{for(const same of[false,true])allyAura(battle,unit,{key:`weather:${same}`,mods:{hpPct:valuesOf(unit).hp+(same?valuesOf(unit).extraHP:0)},
    select:t=>t!==unit&&around(unit,t)&&(t.dir===unit.dir)===same});},
});
const bldsk=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit),list=allInRange(battle,unit).filter(t=>t!==unit),other=list[Math.floor(battle.rng()*list.length)];
    for(const target of[unit,other].filter(Boolean))grantAttackUses(battle,unit,target,'unstable-plasma',v.uses,{atk:v.atk,loss:v.loss});return true;},
  link:(battle,unit)=>observeCount(battle,unit,'kill','blood-sample',p=>p.target?.side==='enemy'&&inRange(unit,p.target),()=>{
    const list=friends(battle,unit).filter(t=>t!==unit),other=list[Math.floor(battle.rng()*list.length)];let n=sp(battle,unit,unit,valuesOf(unit).charge,'blood-sample',sourceKey(unit,'sample-self'));
    if(other)n+=sp(battle,unit,other,valuesOf(unit).charge,'blood-sample',sourceKey(unit,'sample-ally'));return n;
  }),
});
const reckpr=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>wounded(friends(battle,unit)).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(let i=0;i<v.heals;i++){
    const target=wounded(friends(battle,unit))[0];if(!target)break;heal(battle,unit,target,{scale:v.heal});grantHitUses(battle,unit,target,'pressure-point',v.care,{heal:v.fixedHeal});}return true;},
  link:(battle,unit)=>observeCount(battle,unit,'skillResolved','learn-together',p=>yours(unit,p.source)&&p.source!==unit&&inRange(unit,p.source),()=>{
    grantAttackUses(battle,unit,unit,'learn-together',valuesOf(unit).uses,{aspd:valuesOf(unit).aspd});return sp(battle,unit,unit,valuesOf(unit).charge,'learn-together',sourceKey(unit,'learn'));}),
});
const harold=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>friends(battle,unit).some(t=>t.hp<t.s.maxHp||elementLoad(t)>0),
  cast:({battle,unit})=>{const v=valuesOf(unit);for(let i=0;i<v.heals;i++){
    const target=friends(battle,unit).sort((a,b)=>elementLoad(b)-elementLoad(a)||a.hp/a.s.maxHp-b.hp/b.s.maxHp||a.id-b.id)[0];if(!target)break;
    const severe=elementLoad(target)>target.gaugeMax*.5;heal(battle,unit,target,{scale:v.heal});
    battle.reduceElement(target,unit.s.atk*(unit.profile.heal?.elementHealRatio??.5)*(severe?v.trait:1));}return true;},
  link:(battle,unit)=>battle.on('elementHit',({target,dmg})=>{if(active(unit)&&target?.ownerId===unit.ownerId&&inRange(unit,target)&&elementLoad(target)>target.gaugeMax*.5){
    const before=dmg.mul;dmg.mul*=1-valuesOf(unit).protect;recordLinkEffect(battle,unit,'winter-protection',target,before>0&&dmg.mul<before);
  }},{owner:unit}),
});
const vendla=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>allInRange(battle,unit).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit),target=allInRange(battle,unit).sort((a,b)=>b.s.maxHp-a.s.maxHp||a.id-b.id)[0];
    grantHitUses(battle,unit,target,'thorn-cover',v.uses,{counter:unit.s.atk*v.scale,traitAlly:target,mods:{taunt:v.taunt}});return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'soil-improvement',mods:{healingTakenMul:1+valuesOf(unit).healing},select:t=>
    allInRange(battle,unit).sort((a,b)=>b.s.maxHp-a.s.maxHp||a.id-b.id)[0]===t}),
});
const papyrs=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>friends(battle,unit).some(t=>t!==unit&&t.hp<t.s.maxHp),
  cast:({battle,unit})=>{const v=valuesOf(unit),first=friends(battle,unit).filter(t=>t!==unit).sort((a,b)=>b.s.maxHp-a.s.maxHp||a.id-b.id)[0];
    for(let round=0;round<v.heals;round++){
      const seen=new Set(),range=unit.profile.heal?.radius??1.5;let previous=first;
      for(let i=0;i<v.jumps+1&&previous;i++){
        heal(battle,unit,previous,{scale:v.heal*powi(1-v.falloff,i)});seen.add(previous);
        previous=wounded(ops(battle,unit).filter(t=>!seen.has(t)&&square(t.x-previous.x)+square(t.y-previous.y)<=square(range)))[0];
      }
    }return true;},
  link:(battle,unit)=>battle.on('heal',({source,target,opts})=>{
    if(source!==unit||opts?.regen)return;const v=valuesOf(unit),key=sourceKey(unit,'ancient-scroll'),old=target.findBuff(key);
    const before=old?.shield??0;
    const added=battle.addBuff(target,{key,shield:Math.max(before,unit.s.atk*v.barrier),duration:v.duration,source:unit,visible:true});
    recordLinkEffect(battle,unit,'ancient-scroll',target,(added?.shield??0)>before);
  },{owner:unit}),
});
const taraxa=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>wounded(friends(battle,unit)).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);buff(battle,unit,unit,{key:sourceKey(unit,'take-flight'),mods:{},flags:{liftoff:true},duration:v.liftoff});
    for(let i=0;i<v.heals;i++){
      const list=friends(battle,unit),main=wounded(list)[0],flying=wounded(list.filter(t=>t!==main&&(t.isFlying||t.s.flags.liftoff)))[0];
      for(const target of[main,flying].filter(Boolean)){heal(battle,unit,target,{scale:v.heal});
        for(const other of wounded(list.filter(t=>t!==target&&around(target,t))).slice(0,v.splashTargets))heal(battle,unit,other,{scale:v.splash});}
    }return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'wind-cotton',mods:{dmgTakenMul:1-valuesOf(unit).protect,blockCnt:1},select:t=>inRange(unit,t)&&(t.isFlying||t.s.flags.liftoff)}),
});
const lumen=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>friends(battle,unit).some(t=>controlled(t)||t.hp<t.s.maxHp-1e-7),
  cast:({battle,unit})=>{const list=friends(battle,unit),target=list.filter(controlled).sort((a,b)=>a.hp/a.s.maxHp-b.hp/b.s.maxHp||a.id-b.id)[0]??wounded(list)[0];
    if(!target)return false;
    unit.mem.adaptLumenSignature=true;
    try{heal(battle,unit,target,{scale:valuesOf(unit).heal});for(const b of [...target.buffs])if(ABNORMAL.has(b.status))battle.removeBuff(target,b);}
    finally{unit.mem.adaptLumenSignature=false;}return true;},
  link:(battle,unit)=>{
    observeCount(battle,unit,'statusApplied','emergency-treatment',p=>yours(unit,p.target)&&inRange(unit,p.target)&&
      ['stun','freeze','frozen','sleep','bind','fear','tremble','levitate','cold','palsy'].includes(p.status),({payload})=>{
        unit.mem.adaptLumenEmergency=true;
        try{return heal(battle,unit,payload.target,{scale:valuesOf(unit).emergency});}finally{unit.mem.adaptLumenEmergency=false;}
      },{every:valuesOf(unit).every});
    observeCount(battle,unit,'heal','ordinary-emergency',p=>p.source===unit&&!p.regen&&!unit.mem.adaptLumenSignature&&!unit.mem.adaptLumenEmergency
      &&!friends(battle,unit).some(controlled),()=>{
        const target=wounded(friends(battle,unit))[0];if(!target)return false;
        unit.mem.adaptLumenEmergency=true;
        try{return heal(battle,unit,target,{scale:valuesOf(unit).emergency});}finally{unit.mem.adaptLumenEmergency=false;}
      },{every:valuesOf(unit).normalEvery});
  },
  innate:(battle,unit)=>battle.on('heal',({source,target,opts})=>{if(source===unit&&!opts?.regen){const v=valuesOf(unit);resist(battle,unit,target,target.hp/target.s.maxHp>v.highHP?v.highResist:v.resist);}},{owner:unit}),
});
const agoat2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>ops(battle,unit).some(t=>t.hp<t.s.maxHp||elementLoad(t)>0),
  cast:({battle,unit})=>{const v=valuesOf(unit);unit.mem.adaptVolcanoCasting=true;try{for(let round=0;round<v.rounds;round++){
    const seen=new Set();for(let i=0;i<5;i++){
      const all=ops(battle,unit),fresh=all.filter(t=>!seen.has(t)),target=(fresh.length?fresh:all).sort((a,b)=>a.hp/a.s.maxHp-b.hp/b.s.maxHp||elementLoad(b)-elementLoad(a)||a.id-b.id)[0];
      if(!target)break;seen.add(target);heal(battle,unit,target,{scale:v.heal});battle.reduceElement(target,unit.s.atk*v.heal*(unit.profile.heal?.elementHealRatio??.5));
    }
  }}finally{unit.mem.adaptVolcanoCasting=false;}return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'volcanic-ash',mods:{hpPct:valuesOf(unit).hp,elemTakenMul:1-valuesOf(unit).protect},select:()=>true}),
  innate:(battle,unit)=>battle.on('heal',({source,target,opts})=>{
    if(source!==unit||opts?.regen||unit.mem.adaptVolcanoCasting)return;
    const v=valuesOf(unit),amount=unit.s.atk*v.mist;
    battle.addBuff(target,{key:sourceKey(unit,'mist'),duration:v.mistTime,refresh:'independent',maxStacks:v.mistCap,source:unit,interval:1,
      onTick:()=>{if(active(target)){heal(battle,unit,target,{amount,regen:true});battle.reduceElement(target,amount*(unit.profile.heal?.elementHealRatio??.5));}}});
  },{owner:unit}),
});
const rosesa=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit);for(const target of allInRange(battle,unit)){
    for(let i=0;i<v.heals;i++)heal(battle,unit,target,{scale:v.heal});grantHitUses(battle,unit,target,'long-medicine',v.uses,{defer:v.defer,duration:v.duration,anyDamage:true,damageTypes:['phys','arts']});}return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'herbalist',mods:{healingTakenMul:1+valuesOf(unit).amp},select:t=>inRange(unit,t)}),
  innate:(battle,unit)=>onDeploy(battle,unit,'herbalist-atk',()=>buff(battle,unit,unit,{key:sourceKey(unit,'herbalist-atk'),mods:{atkPct:valuesOf(unit).atk},duration:Infinity,persist:true})),
});
const heidi=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit),mods={defFlat:unit.s.def*v.def,hpFlat:unit.s.maxHp*v.hp,blockCnt:v.block};
    for(const target of allInRange(battle,unit)){
      if(target!==unit)grantHitUses(battle,unit,target,'rust-city',v.uses,{mods,inspire:true});
      for(let i=0;i<v.heals;i++)heal(battle,unit,target,{scale:v.heal,regen:true});}return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'resourceful-rebel',mods:{defPct:valuesOf(unit).aura},select:t=>inRange(unit,t)}),
});
const ncdeer=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>targets(battle,unit).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);unit.mem.adaptDeerDodge=(unit.mem.adaptDeerDodge??0)+v.uses;
    for(const target of targets(battle,unit))for(let i=0;i<v.hits&&target.alive;i++){
      damage(battle,unit,target,{scale:1,type:'arts',isSkill:true});pickHeal(battle,unit,friends(battle,unit),v.heal);}return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'ethereal-cloud',mods:{dmgTakenMul:1-valuesOf(unit).protect},select:t=>inRange(unit,t)&&
    ((unit.mem.adaptDeerDodge??0)>0||t.hp/t.s.maxHp<valuesOf(unit).threshold)}),
  innate:(battle,unit)=>battle.on('hit',({source,target,dmg})=>{
    if(target!==unit||dmg.type!=='phys'||!dmg.isAttack||source?.profile?.attack!=='ranged'||dmg.canDodge===false)return;
    const ready=(unit.mem.adaptDeerDodge??0)>0;if(ready)unit.mem.adaptDeerDodge--;
    buff(battle,unit,unit,{key:sourceKey(unit,'deer-dodge'),mods:{dodgePhys:ready?valuesOf(unit).chance:0},duration:Infinity,notify:false});
  },{owner:unit,priority:100}),
});

export const adaptationSupportKits=Object.freeze({char_151_myrtle:myrtle,char_181_flower:flower,char_385_finlpp:finlpp,char_401_elysm:elysm,
  char_4119_wanqin:wanqin,char_171_bldsk:bldsk,char_4196_reckpr:reckpr,char_4114_harold:harold,char_494_vendla:vendla,
  char_4139_papyrs:papyrs,char_4222_taraxa:taraxa,char_4042_lumen:lumen,char_1016_agoat2:agoat2,char_4163_rosesa:rosesa,
  char_4045_heidi:heidi,char_4019_ncdeer:ncdeer});
