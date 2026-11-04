import { adaptedKit } from '../adapted-kit.js';
import { active, allies, enemies, buff, damage, heal, applyStatus, sp, gainDP, uid } from '../primitives.js';
import { allyAura, enemyAura, withinAdjacent4, hasStatus, matchesClass } from '../synergy.js';
import { assaultAmmoState } from '../ammo.js';
import { valuesOf, yours, ops, targets, canAttack, sourceKey, onDeploy, anchor } from './adaptation-core.js';
import { observeCount, conditionalSelf, chargeAdjacent, square } from './adaptation-pool.js';
import { grantHitUses } from './adaptation-support.js';
import { rotateOffset } from '../../../dir.js';
import { recordLinkEffect } from '../adaptation-primitives.js';

const blocked=unit=>(unit.blocking??[]).filter(active);
const around=(a,b)=>Math.max(Math.abs(a.tileR-b.tileR),Math.abs(a.tileC-b.tileC))<=1;
const pioneer=t=>t.def.profession==='PIONEER';
function selfStat(battle,unit,key,mods){onDeploy(battle,unit,key,()=>buff(battle,unit,unit,{key:sourceKey(unit,key),mods,duration:Infinity,persist:true}));}
function guard(battle,unit,key,uses,mods){grantHitUses(battle,unit,unit,key,uses,{mods,anyDamage:true});}
function nearEnemies(battle,unit,center,radius=unit.profile.splashRadius||1.1){return enemies(battle,unit,{scope:'field',count:999})
  .filter(t=>square(t.x-center.x)+square(t.y-center.y)<=square(radius));}
function surrounding(battle,unit){const keys=[];for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)keys.push((unit.tileR+dr)*21+unit.tileC+dc);
  return enemies(battle,unit,{anchor:{...anchor(unit),rangeKeys:keys,rangeKeySet:new Set(keys)},count:999,groundOnly:true});}
function healOther(battle,unit,scale){const [target]=allies(battle,unit,{scope:'adjacent8',excludeSelf:true,count:1});return target?heal(battle,unit,target,{scale}):0;}
function poison(battle,unit,target,amount,seconds,key){
  if(!target.alive)return;const version=((target.mem.adaptPoisons??={})[key]??0)+1;target.mem.adaptPoisons[key]=version;
  for(let tick=1;tick<=seconds;tick++)battle.after(tick,()=>{if(target.alive&&target.mem.adaptPoisons[key]===version)
    battle.dealDamage(unit,target,{amount,type:'arts',tags:['talent','dot']});});
}

const wyvern=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit);gainDP(battle,unit,v.dp,sourceKey(unit,'reinforcement'));
    const extra=unit.mem.adaptVanillaHits??0;unit.mem.adaptVanillaHits=0;
    for(const target of targets(battle,unit))for(let i=0;i<v.hits+extra&&active(target);i++)damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>{selfStat(battle,unit,'attack-up',{atkPct:valuesOf(unit).aura});
    observeCount(battle,unit,'dpGranted','charge-strike',p=>p.source?.ownerId===unit.ownerId,
      ()=>{unit.mem.adaptVanillaHits=(unit.mem.adaptVanillaHits??0)+1;return true;},{every:valuesOf(unit).every,amount:p=>p.amount});},
});
const vigna=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit),extra=unit.mem.adaptBruteSpikes??0;unit.mem.adaptBruteSpikes=0;for(const target of targets(battle,unit))for(let i=0;i<v.hits+extra&&target.alive;i++)
    damage(battle,unit,target,{scale:v.scale+(battle.rng()<v.skillChance?v.extra:0),type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>battle.on('hit',({source,target,dmg})=>{
    if(!active(unit)||source!==unit||!dmg.isAttack||target?.side!=='enemy')return;
    if(battle.rng()<valuesOf(unit).chance)dmg.amount+=source.s.atk*valuesOf(unit).extra;
  },{owner:unit,priority:40}),
  innate:(battle,unit)=>observeCount(battle,unit,'dpGranted','brute-pierce',p=>p.source!==unit&&p.source?.ownerId===unit.ownerId&&pioneer(p.source),
    ()=>{unit.mem.adaptBruteSpikes=(unit.mem.adaptBruteSpikes??0)+1;return true;},{every:valuesOf(unit).every,amount:p=>p.amount}),
});
const wildmn=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(let i=0;i<v.hits;i++)for(const target of targets(battle,unit)){
    damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});if(target.alive)battle.push(target,v.force,{from:unit,fixedAngle:true});}return true;},
  link:(battle,unit)=>{
    onDeploy(battle,unit,'forward-together',()=>{
      for(const target of battle.allyUnits.filter(t=>t.kind==='op'&&t.ownerId===unit.ownerId&&t.def.profession==='WARRIOR'&&!t.deployed&&!t.removed)){
        const current=target.mem.adaptWildDiscount??0,delta=Math.min(valuesOf(unit).cap-current,valuesOf(unit).discount);
        if(delta>0){target.mem.adaptWildDiscount=current+delta;target.mem.assaultCostDelta=(target.mem.assaultCostDelta??0)-delta;}
      }
    });
    battle.on('deploy',({unit:target})=>{if(target?.ownerId!==unit.ownerId||!target.mem.adaptWildDiscount)return;
      target.mem.assaultCostDelta+=target.mem.adaptWildDiscount;target.mem.adaptWildDiscount=0;},{owner:unit});
  },
});
const ctable=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(const target of targets(battle,unit))for(let i=0;i<v.hits&&target.alive;i++){
    damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});gainDP(battle,unit,v.dp,sourceKey(unit,'floating-light'));}return true;},
  link:(battle,unit)=>{
    conditionalSelf(battle,unit,'complete-self',()=>blocked(unit).length?{atkPct:valuesOf(unit).atk}:{aspd:valuesOf(unit).aspd});
    observeCount(battle,unit,'blocked','complete-riposte',p=>yours(unit,p.source)&&p.source!==unit&&pioneer(p.source),()=>{
      const v=valuesOf(unit),[target]=targets(battle,unit);if(!target)return false;
      damage(battle,unit,target,{scale:v.scale,type:'phys'});gainDP(battle,unit,v.dp,sourceKey(unit,'complete-riposte'));return true;
    },{every:valuesOf(unit).every});
  },
  innate:(battle,unit)=>{
    const update=()=>{const key=sourceKey(unit,'loaded-camouflage');if(active(unit)&&(assaultAmmoState(unit)?.current??0)>0)
      buff(battle,unit,unit,{key,mods:{},flags:{camou:true},duration:Infinity});else if(unit.findBuff(key))battle.removeBuff(unit,key);};
    onDeploy(battle,unit,'loaded-camouflage',update);battle.assaultRuntime.observe('skillResolved',sourceKey(unit,'camouflage-end'),({payload})=>{if(payload.source===unit)update();},{owner:unit});
    battle.assaultRuntime.observe('reloaded',sourceKey(unit,'camouflage-reload'),({payload})=>{if(payload.target===unit)update();},{owner:unit});
  },
});
function puzzleDot(battle,unit,target,cause){
  const v=valuesOf(unit),key=sourceKey(unit,'doubt'),list=(target.mem.adaptPuzzleDots??=new Map()).get(unit)??[];
  if(!target.mem.adaptPuzzleDots.has(unit))target.mem.adaptPuzzleDots.set(unit,list);
  const dot={amount:unit.s.atk*v.dot};list.push(dot);if(list.length>v.maxDots)list.shift();
  for(let tick=1;tick<=v.seconds;tick++)battle.after(tick,()=>{
    if(!target.alive||!list.includes(dot))return;
    battle.assaultRuntime.withCause(cause,()=>battle.dealDamage(unit,target,{amount:dot.amount,type:'arts',tags:['skill','dot'],isSkill:true,attackId:key}));
    if(tick===v.seconds)list.splice(list.indexOf(dot),1);
  });
}
const puzzle=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit,cause})=>{const v=valuesOf(unit);for(const target of targets(battle,unit))for(let i=0;i<v.hits&&target.alive;i++){
    damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});gainDP(battle,unit,1,sourceKey(unit,'doubt'));if(target.alive)puzzleDot(battle,unit,target,cause);}return true;},
  link:(battle,unit)=>{
    const award=observeCount(battle,unit,'hit','sequence-feeder',p=>yours(unit,p.source)&&p.target?.side==='enemy'&&p.target.hp>=p.target.s.maxHp-1e-7,
      ()=>chargeAdjacent(battle,unit,valuesOf(unit).charge,'sequence-feeder','PIONEER'));
    return award;
  },
  innate:(battle,unit)=>battle.on('hit',({source,target,dmg})=>{
    if(source!==unit||target?.side!=='enemy'||target.hp<target.s.maxHp-1e-7||!(dmg.isAttack||dmg.isSkill))return;
    dmg.mul*=valuesOf(unit).first;sp(battle,unit,unit,valuesOf(unit).nativeSP,'sequence',sourceKey(unit,'sequence'));
  },{owner:unit,priority:40}),
});
const udflow=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(let i=0;i<v.hits;i++)for(const target of targets(battle,unit)){
    damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});if(target.alive){applyStatus(battle,unit,target,{status:'sluggish',duration:v.slow});
      poison(battle,unit,target,target.def.tags?.includes('seamonster')?v.seaPoison:v.poison,v.seconds,sourceKey(unit,'cytotoxin'));}}return true;},
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','toxin-settle',p=>p.source?.ownerId===unit.ownerId&&p.source!==unit&&p.status==='sluggish',({payload})=>
    damage(battle,unit,payload.target,{amount:(payload.target.def.tags?.includes('seamonster')?valuesOf(unit).seaPoison:valuesOf(unit).poison)*valuesOf(unit).seconds,type:'arts'}),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>battle.on('damaged',({source,target,dmg})=>{if(source===unit&&dmg.isAttack&&target.alive)
    poison(battle,unit,target,target.def.tags?.includes('seamonster')?valuesOf(unit).seaPoison:valuesOf(unit).poison,valuesOf(unit).seconds,sourceKey(unit,'cytotoxin'));},{owner:unit}),
});
const branch=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>blocked(unit).length>0||enemies(battle,unit,{scope:'adjacent8',count:1,groundOnly:true}).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(const target of surrounding(battle,unit))applyStatus(battle,unit,target,{status:'tremble',duration:v.tremble});
    guard(battle,unit,'survival',v.uses,{defPct:v.def});for(const target of blocked(unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'arts',isSkill:true});
    heal(battle,unit,unit,{maxHpRatio:v.selfHeal});return true;},
  link:(battle,unit)=>observeCount(battle,unit,'skillResolved','simple-bandage',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='TANK'&&withinAdjacent4(unit,p.source),
    ({payload})=>heal(battle,unit,payload.source,{maxHpRatio:valuesOf(unit).allyHeal})),
});
const cardinalGround=(battle,unit)=>[[-1,0],[1,0],[0,-1],[0,1]].every(([dr,dc])=>{
  const r=unit.tileR+dr,c=unit.tileC+dc;return battle.grid.inRect(r,c)&&battle.grid.tile(r,c).height==='LOW';
});
const ashlok=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit),[center]=targets(battle,unit);buff(battle,unit,unit,{key:sourceKey(unit,'focused-bombardment'),mods:{blockCnt:-99},duration:Infinity});
    const extra=unit.mem.adaptAshlockRounds??0;unit.mem.adaptAshlockRounds=0;
    try{for(let i=0;i<v.hits+extra;i++)for(const target of nearEnemies(battle,unit,center))damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});}
    finally{battle.removeBuff(unit,sourceKey(unit,'focused-bombardment'));}return true;},
  link:(battle,unit)=>{conditionalSelf(battle,unit,'artillery-self',()=>({atkPct:cardinalGround(battle,unit)?valuesOf(unit).groundATK:valuesOf(unit).atk}));
    observeCount(battle,unit,'blocked','artillery-research',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='TANK',
      ()=>{unit.mem.adaptAshlockRounds=(unit.mem.adaptAshlockRounds??0)+1;return true;},{every:valuesOf(unit).every});},
});
const philae=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit);unit.mem.adaptPhilaeUses=(unit.mem.adaptPhilaeUses??0)+v.uses;
    buff(battle,unit,unit,{key:sourceKey(unit,'styx-life'),mods:{hpPct:v.hp},duration:Infinity});return true;},
  link:(battle,unit)=>observeCount(battle,unit,'elementDamage','river-envoy',p=>yours(unit,p.target)&&p.element==='apoptosis',
    ()=>sp(battle,unit,unit,valuesOf(unit).charge,'river-envoy',sourceKey(unit,'river-envoy')),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{
    selfStat(battle,unit,'river-resistance',{elemTakenMul:1-valuesOf(unit).protect});
    battle.on('elementHit',({target})=>{if(target===unit&&unit.mem.adaptPhilaeUses>0)unit.mem.adaptPhilaeEmpowered=true;},{owner:unit});
    battle.on('hit',({source,target,dmg})=>{
      if(target!==unit||source?.side!=='enemy'||!dmg.isAttack||!(unit.mem.adaptPhilaeUses>0))return;
      unit.mem.adaptPhilaeUses--;const v=valuesOf(unit),attack=unit.s.atk*(unit.mem.adaptPhilaeEmpowered?1+v.elementATK:1);
      battle.assaultRuntime.enqueue(()=>{
        for(const foe of surrounding(battle,unit)){
          damage(battle,unit,foe,{amount:attack*v.scale,type:'arts',isSkill:true});if(foe.alive)damage(battle,unit,foe,{amount:attack*v.element,type:'element',element:'apoptosis',isSkill:true});}
        if(!unit.mem.adaptPhilaeUses){battle.removeBuff(unit,sourceKey(unit,'styx-life'));unit.mem.adaptPhilaeEmpowered=false;}
      },{key:sourceKey(unit,'styx-response'),targetUid:uid(unit),cause:battle.assaultRuntime.currentCause});
    },{owner:unit});
  },
});
const bpipe=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);guard(battle,unit,'closed-bolt',v.uses,{defPct:v.def,blockCnt:v.block});
    for(let round=0;round<v.rounds;round++){
      const critical=battle.rng()<v.chance,picked=targets(battle,unit,unit,critical?2:1);
      for(const target of picked)damage(battle,unit,target,{scale:v.scale*(critical?v.crit:1),hits:3,type:'phys',isSkill:true});}return true;},
  link:(battle,unit)=>observeCount(battle,unit,'dpReceived','military-tradition',p=>p.targetUid===unit.ownerId&&(p.amount??0)>0,
    ()=>chargeAdjacent(battle,unit,valuesOf(unit).charge,'military-tradition','PIONEER'),{every:valuesOf(unit).every,amount:p=>p.amount}),
  innate:(battle,unit)=>{
    battle.after(0,()=>{
      const seen=battle.adaptBpipeInitial??=new Set();if(seen.has(unit.ownerId))return;seen.add(unit.ownerId);
      for(const target of ops(battle,unit).filter(pioneer))sp(battle,unit,target,valuesOf(unit).initial,'military-initial',sourceKey(unit,'military-initial'));
    });
    battle.on('beforeAttack',ctx=>{
      if(ctx.attacker!==unit||ctx.isSkill)return;unit.mem.adaptBpipeCritical=battle.rng()<valuesOf(unit).chance;
      if(unit.mem.adaptBpipeCritical){const extra=targets(battle,unit,unit,999).find(t=>!ctx.targets.includes(t));if(extra)ctx.targets=[...ctx.targets,extra];}
    },{owner:unit});
    battle.on('assaultAttackStarted',({attacker,attackId,isSkill})=>{if(attacker===unit&&!isSkill&&unit.mem.adaptBpipeCritical)(unit.mem.adaptBpipeCriticalIds??=new Set()).add(attackId);},{owner:unit});
    battle.on('hit',({source,dmg})=>{if(source===unit&&dmg.isAttack&&unit.mem.adaptBpipeCriticalIds?.has(dmg.attackId))dmg.mul*=valuesOf(unit).crit;},{owner:unit,priority:40});
  },
});

const vulpis=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);const camouflage=unit.findBuff(sourceKey(unit,'hunting-camouflage'));if(camouflage)battle.removeBuff(unit,camouflage);
    gainDP(battle,unit,v.dp,sourceKey(unit,'hidden-fox'));let kills=0;
    for(const target of targets(battle,unit))for(let i=0;i<v.hits&&target.alive;i++){
      damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});if(target.alive)applyStatus(battle,unit,target,{status:'stun',duration:v.stun});else kills++;}
    if(kills)buff(battle,unit,unit,{key:sourceKey(unit,'hunting-camouflage'),mods:{},flags:{camou:true},duration:Infinity,persist:true});return true;},
  link:(battle,unit)=>{
    const first=new WeakMap();
    battle.on('damaged',({source,target,dmg,amount})=>{
      if(!active(unit)||!yours(unit,source)||source!==unit&&!(pioneer(source)&&withinAdjacent4(unit,source))||!(dmg.isAttack||dmg.isSkill)||target?.side!=='enemy'||!(amount>0)||!target.alive)return;
      if(!first.has(target))first.set(target,battle.time);if(battle.time-first.get(target)>valuesOf(unit).markTime)return;
      const scale=valuesOf(unit).echo;
      battle.assaultRuntime.enqueue(()=>{if(target.alive)damage(battle,source,target,{scale,type:'arts'});},
        {key:sourceKey(unit,'pursuit'),targetUid:uid(target),cause:battle.assaultRuntime.currentCause});
    },{owner:unit});
  },
  innate:(battle,unit)=>{
    battle.assaultRuntime.observe('dpReceived',sourceKey(unit,'natural-income'),({payload})=>{
      if(active(unit)&&payload.sourceClass==='natural'&&payload.targetUid===unit.ownerId&&payload.amount>0)gainDP(battle,unit,payload.amount*valuesOf(unit).dpRate,sourceKey(unit,'natural-income'));
    },{owner:unit});
    conditionalSelf(battle,unit,'fox-rest',()=>battle.time-(unit.lastHitAt??-Infinity)>=valuesOf(unit).quiet?{hpRegenRatio:valuesOf(unit).regen}:null);
  },
});
const bannerAt=(battle,unit)=>unit.mem.adaptBanner&&unit.mem.adaptBanner.until>battle.time?unit.mem.adaptBanner.at:{x:unit.x,y:unit.y};
const nearBanner=(battle,unit,target)=>{const p=bannerAt(battle,unit);return Math.max(Math.abs(target.x-p.x),Math.abs(target.y-p.y))<=1.5;};
const sleach=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>enemies(battle,unit,{scope:'field',count:999,groundOnly:true}).some(t=>Math.max(Math.abs(t.x-unit.x),Math.abs(t.y-unit.y))<=2),
  cast:({battle,unit})=>{const v=valuesOf(unit),[target]=enemies(battle,unit,{scope:'field',count:999,groundOnly:true}).filter(t=>Math.max(Math.abs(t.x-unit.x),Math.abs(t.y-unit.y))<=2);
    gainDP(battle,unit,v.dp,sourceKey(unit,'glorious-banner'));const at={x:Math.round(target.x),y:Math.round(target.y)};
    unit.mem.adaptBanner={at,until:battle.time+v.duration};battle.fx('splash',{...at,radius:1.5,id:unit.id});
    for(const enemy of enemies(battle,unit,{scope:'field',count:999}).filter(t=>nearBanner(battle,unit,t))){
      damage(battle,unit,enemy,{scale:v.scale,type:'phys',isSkill:true});if(enemy.alive){applyStatus(battle,unit,enemy,{status:'stun',duration:v.stun});
        applyStatus(battle,unit,enemy,{status:'sluggish',duration:v.duration});applyStatus(battle,unit,enemy,{status:'fragile',value:v.fragile,duration:v.duration});}}
    return true;},
  link:(battle,unit)=>{
    allyAura(battle,unit,{key:'unyielding-banner',mods:{aspd:valuesOf(unit).aspd},select:t=>nearBanner(battle,unit,t)});
    enemyAura(battle,unit,{key:'unyielding-banner',mods:{aspd:-valuesOf(unit).aspd},select:t=>nearBanner(battle,unit,t)});
  },
  innate:(battle,unit)=>{
    onDeploy(battle,unit,'spiritual-inspiration',()=>{unit.mem.adaptBannerDiscount=true;});
    battle.on('assaultDeploymentCost',quote=>{if(active(unit)&&unit.mem.adaptBannerDiscount&&yours(unit,quote.unit)&&quote.unit!==unit)
      quote.amount=Math.max(0,quote.amount-valuesOf(unit).discount);},{owner:unit});
    battle.on('deploy',({unit:target})=>{if(yours(unit,target)&&target!==unit&&unit.mem.adaptBannerDiscount)unit.mem.adaptBannerDiscount=false;},{owner:unit});
  },
});
const flamtl=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({unit})=>blocked(unit).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);gainDP(battle,unit,v.dp,sourceKey(unit,'flame-heart'));
    unit.mem.adaptFlameDodge=(unit.mem.adaptFlameDodge??0)+v.uses;guard(battle,unit,'flame-block',v.blockUses,{blockCnt:v.block});
    for(const target of blocked(unit).slice(0,3))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>{
    battle.on('dodge',({target})=>{if(active(unit)&&yours(unit,target)&&(target===unit||pioneer(target)&&withinAdjacent4(unit,target)))
      unit.mem.adaptFlameSword=(unit.mem.adaptFlameSword??0)+1;},{owner:unit});
    battle.on('beforeAttack',ctx=>{if(ctx.attacker===unit&&!ctx.isSkill&&!unit.mem.adaptFlameExtra&&unit.mem.adaptFlameSword>0){const list=blocked(unit);if(list.length)ctx.targets=list;}},{owner:unit});
    battle.on('assaultAttackStarted',({attacker,attackId,isSkill})=>{if(attacker===unit&&!isSkill&&!unit.mem.adaptFlameExtra&&unit.mem.adaptFlameSword>0){
      unit.mem.adaptFlameSword--;(unit.mem.adaptFlameSwordIds??=new Set()).add(attackId);}},{owner:unit});
    battle.on('attack',({attacker,attackId,isSkill})=>{
      if(attacker!==unit||isSkill||unit.mem.adaptFlameExtra||!unit.mem.adaptFlameSwordIds?.has(attackId))return;
      for(const target of blocked(unit))battle.dealDamage(unit,target,{amount:unit.s.atk*(unit.profile.atkScale??1),type:'phys',isAttack:true,attackId});
    },{owner:unit});
  },
  innate:(battle,unit)=>{
    allyAura(battle,unit,{key:'red-pine-leader',mods:{dodgePhys:valuesOf(unit).aura},select:t=>matchesClass(t,{label:'卡西米尔'})});
    battle.on('hit',({source,target,dmg})=>{if(target!==unit||source?.side!=='enemy'||dmg.canDodge===false||!['phys','arts'].includes(dmg.type))return;
      const ready=(unit.mem.adaptFlameDodge??0)>0;if(ready)unit.mem.adaptFlameDodge--;
      buff(battle,unit,unit,{key:sourceKey(unit,'flame-dodge'),mods:{dodgePhys:ready?valuesOf(unit).dodge:0,dodgeArts:ready?valuesOf(unit).dodge:0},duration:Infinity,notify:false});
    },{owner:unit,priority:100});
  },
});
const blemsh=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);guard(battle,unit,'ancestor-defence',v.uses,{defPct:v.def});
    const [target]=targets(battle,unit,unit,999).sort((a,b)=>(hasStatus(b,'sleep')?1:0)-(hasStatus(a,'sleep')?1:0));
    for(let i=0;i<v.hits&&target.alive;i++){
      damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});if(target.alive)damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});healOther(battle,unit,v.heal);
    }return true;},
  link:(battle,unit)=>{
    const counters=new Map();battle.on('attack',({attacker,isSkill})=>{
      if(!active(unit)||!yours(unit,attacker)||isSkill)return;
      const native=attacker.def.raw.assaultBody.fixedSkill.source?.native?.spData?.spType;
      if(native!=='INCREASE_WHEN_TAKEN_DAMAGE')return;
      const n=(counters.get(attacker)??0)+1;counters.set(attacker,n);
      if(n%valuesOf(unit).every===0)sp(battle,unit,attacker,valuesOf(unit).charge,'sword-and-shield',sourceKey(unit,'sword-and-shield'));
    },{owner:unit});
  },
  innate:(battle,unit)=>{
    unit.profile.hitSleep=true;
    battle.on('beforeAttack',ctx=>{if(ctx.attacker!==unit)return;const [sleeping]=targets(battle,unit,unit,999).filter(t=>hasStatus(t,'sleep'));if(sleeping)ctx.targets=[sleeping];},{owner:unit});
    battle.on('hit',({source,target,dmg})=>{if(source===unit&&hasStatus(target,'sleep'))dmg.mul*=valuesOf(unit).sleepBonus;},{owner:unit,priority:40});
  },
});
function mudShield(battle,unit){const v=valuesOf(unit);for(let i=0;i<v.maxShields;i++){
  const key=sourceKey(unit,`fertile-shield:${i}`);if(!unit.findBuff(key)){battle.addBuff(unit,{key,shieldHits:1,duration:Infinity,source:unit,visible:true});return true;}
}return false;}
const mudrok=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({unit})=>blocked(unit).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);unit.mem.adaptMudInvulnerable=(unit.mem.adaptMudInvulnerable??0)+v.blocks;guard(battle,unit,'bloodline-defence',v.uses,{defPct:v.def});
    for(const target of surrounding(battle,unit)){
      buff(battle,unit,target,{key:sourceKey(unit,'bloodline-slow'),mods:{moveMul:1-v.slow},duration:v.duration});applyStatus(battle,unit,target,{status:'stun',duration:v.stun});}
    for(const target of blocked(unit).slice(0,3))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>battle.on('shieldLayersBroken',({unit:target,buff:barrier})=>{
    if(target!==unit||!String(barrier?.key).startsWith(sourceKey(unit,'fertile-shield:')))return;
    const restored=heal(battle,unit,unit,{maxHpRatio:valuesOf(unit).heal,ignoreHealFree:true});
    const charged=chargeAdjacent(battle,unit,valuesOf(unit).charge,'fertile-shield','TANK');
    recordLinkEffect(battle,unit,'fertile-shield',unit,restored>0||charged>0);
  },{owner:unit}),
  innate:(battle,unit)=>{
    onDeploy(battle,unit,'fertile-shield',()=>mudShield(battle,unit));battle.every(valuesOf(unit).interval,()=>{if(active(unit))mudShield(battle,unit);},{owner:unit});
    battle.on('hit',ctx=>{if(ctx.target!==unit||!(unit.mem.adaptMudInvulnerable>0)||ctx.dmg.cancel)return;unit.mem.adaptMudInvulnerable--;ctx.dmg.cancel=true;},{owner:unit,priority:90});
    battle.on('hit',({source,target,dmg})=>{if(target===unit&&source?.def?.tags?.includes('sarkaz'))dmg.mul*=1-valuesOf(unit).sarkazProtect;},{owner:unit,priority:40});
  },
});
function judgeBarrier(battle,unit,ratio){const v=valuesOf(unit),key=sourceKey(unit,'law-guardian'),old=unit.findBuff(key)?.shield??0;
  battle.addBuff(unit,{key,shield:Math.min(unit.s.maxHp*v.cap,old+unit.s.maxHp*ratio),duration:Infinity,source:unit,visible:true});}
const judge=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);judgeBarrier(battle,unit,v.shield);unit.mem.adaptJudgeStrong=(unit.mem.adaptJudgeStrong??0)+v.strongUses;
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});
    buff(battle,unit,unit,{key:sourceKey(unit,'bramble-taunt'),mods:{taunt:v.taunt},duration:Infinity});return true;},
  link:(battle,unit)=>battle.on('hit',({source,target,dmg})=>{
    if(target!==unit||source?.side!=='enemy'||!dmg.isAttack||!unit.buffs.some(b=>b.source===unit&&b.shield>0))return;
    const v=valuesOf(unit),strong=(unit.mem.adaptJudgeStrong??0)>0;if(strong)unit.mem.adaptJudgeStrong--;
    battle.assaultRuntime.enqueue(()=>{if(active(source))damage(battle,unit,source,{scale:v.reflect+(strong?v.strong:0),type:'arts'});},
      {key:sourceKey(unit,'bramble-reflect'),targetUid:uid(source),cause:battle.assaultRuntime.currentCause});
  },{owner:unit}),
  innate:(battle,unit)=>{
    onDeploy(battle,unit,'law-guardian',()=>{
      const extra=unit.mem.runGrowthOpeningGranted?0:runGrowthPoints(unit.def.raw.assaultPiece)/100;
      unit.mem.runGrowthOpeningGranted=true;
      judgeBarrier(battle,unit,valuesOf(unit).initial+extra);
    });
    observeCount(battle,unit,'kill','law-kill',p=>p.source===unit,()=>{judgeBarrier(battle,unit,valuesOf(unit).kill);return true;});
  },
});
const horn=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit),[center]=targets(battle,unit);for(let i=0;i<v.hits;i++){
    for(const target of nearEnemies(battle,unit,center))damage(battle,unit,target,{scale:i<Math.ceil(v.hits/2)?v.scale:v.overload,type:'phys',isSkill:true});}
    battle.loseHp(unit,unit.s.maxHp*v.loss,{source:unit});return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'military-fortress',mods:{atkPct:valuesOf(unit).aura},select:t=>t.def.profession==='TANK'}),
  innate:(battle,unit)=>{
    onDeploy(battle,unit,'blood-war-reset',()=>{unit.mem.adaptHornRevived=false;});
    battle.on('fatal',ctx=>{if(ctx.unit!==unit||ctx.prevented||unit.mem.adaptHornRevived)return;
      unit.mem.adaptHornRevived=true;ctx.prevented=true;const v=valuesOf(unit);
      buff(battle,unit,unit,{key:sourceKey(unit,'blood-war'),mods:{hpMul:v.reviveHP,aspd:v.aspd,defPct:v.def},duration:Infinity,persist:true});unit.hp=unit.s.maxHp;
    },{owner:unit,priority:30});
  },
});
const grani=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({unit})=>blocked(unit).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);guard(battle,unit,'never-retreat',v.uses,{defPct:v.def,blockCnt:v.block});
    for(const target of blocked(unit).slice(0,2))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'mounted-police',mods:{dodgePhys:valuesOf(unit).dodge},select:pioneer}),
});
function amiya2Aura(battle,unit){if(!active(unit))return;const value=valuesOf(unit).aura*(unit.mem.adaptAmiya2State?2:1);
  for(const target of battle.allyUnits.filter(t=>active(t)&&t.ownerId===unit.ownerId))buff(battle,unit,target,{key:sourceKey(unit,'blue-anger'),mods:{atkPct:value,defPct:value},duration:.51,notify:false});}
const amiya2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  state:({battle,unit})=>({mods:{},enter:()=>{
    const v=valuesOf(unit);unit.mem.adaptAmiya2State=true;amiya2Aura(battle,unit);let kills=0;
    for(let i=0;i<v.hits;i++){
      const [target]=targets(battle,unit,unit,999).sort((a,b)=>a.hp-b.hp||a.id-b.id);if(!target)break;
      damage(battle,unit,target,{scale:i===v.hits-1?v.lastScale:v.scale,type:i===v.hits-1||kills?'true':'arts',isSkill:true});
      if(!target.alive){kills++;buff(battle,unit,unit,{key:sourceKey(unit,'shadow-kills'),mods:{atkPct:Math.min(kills,v.maxKills)*v.killATK,resFlat:Math.min(kills,v.maxKills)*v.killRES},duration:Infinity,persist:true});}
    }
    unit.profile.dmgType='true';
  }}),
  link:(battle,unit)=>battle.every(.25,()=>amiya2Aura(battle,unit),{owner:unit}),
});
const amiya3=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  state:({battle,unit})=>({mods:{},enter:()=>{
    const v=valuesOf(unit),selected=targets(battle,unit);for(const target of selected){
      damage(battle,unit,target,{scale:v.open,type:'arts',isSkill:true});if(target.alive)buff(battle,unit,target,{key:sourceKey(unit,'compassion-slow'),mods:{aspd:v.aspd,moveMul:1-v.slow},duration:v.duration});}
    buff(battle,unit,unit,{key:sourceKey(unit,'compassion-power'),mods:{atkPct:Math.min(selected.length,v.maxStacks)*v.atk},duration:Infinity,persist:true});
    unit.profile.dmgType='true';unit.profile.maxTargets=v.targets;unit.mem.adaptAmiya3State=true;
  }}),
  link:(battle,unit)=>{
    allyAura(battle,unit,{key:'sincere-hope',mods:{hpPct:valuesOf(unit).hp},select:()=>true});
    battle.every(1,()=>{if(active(unit)&&unit.mem.adaptAmiya3State)for(const target of battle.allyUnits.filter(t=>active(t)&&t.ownerId===unit.ownerId))
      heal(battle,unit,target,{maxHpRatio:valuesOf(unit).regen,regen:true});},{owner:unit});
  },
});

export const adaptationFrontlineKits=Object.freeze({char_240_wyvern:wyvern,char_290_vigna:vigna,char_496_wildmn:wildmn,char_497_ctable:ctable,
  char_4017_puzzle:puzzle,char_4137_udflow:udflow,char_4207_branch:branch,char_431_ashlok:ashlok,char_4148_philae:philae,char_222_bpipe:bpipe,
  char_4026_vulpis:vulpis,char_479_sleach:sleach,char_420_flamtl:flamtl,char_423_blemsh:blemsh,char_311_mudrok:mudrok,char_4065_judge:judge,
  char_4039_horn:horn,char_220_grani:grani,char_1001_amiya2:amiya2,char_1037_amiya3:amiya3});
import { runGrowthPoints } from '../../../../../shared/assault/growth-policy.js';
