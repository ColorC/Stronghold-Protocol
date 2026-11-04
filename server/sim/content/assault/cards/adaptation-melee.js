import { adaptedKit } from '../adapted-kit.js';
import { active, allies, enemies, buff, damage, heal, applyStatus, sp, uid, tileOf } from '../primitives.js';
import { allyAura, matchesClass, hasStatus, withinAdjacent4 } from '../synergy.js';
import { valuesOf, yours, ops, targets, canAttack, sourceKey, onDeploy, anchor } from './adaptation-core.js';
import { observeCount, conditionalSelf, chargeAdjacent, square } from './adaptation-pool.js';
import { grantAttackUses, grantHitUses } from './adaptation-support.js';
import { recordLinkEffect } from '../adaptation-primitives.js';
import { rotateOffset } from '../../../dir.js';

const around=(unit,target)=>{const[r,c]=tileOf(target);return Math.max(Math.abs(unit.tileR-r),Math.abs(unit.tileC-c))<=1;};
const melee=t=>t.profile.attack!=='ranged';
const blocked=unit=>(unit.blocking??[]).filter(active);
function selfBuff(battle,unit,key,mods){onDeploy(battle,unit,key,()=>buff(battle,unit,unit,{key:sourceKey(unit,key),mods,duration:Infinity,persist:true}));}
function guard(battle,unit,key,uses,mods,extra={}){grantHitUses(battle,unit,unit,key,uses,{mods,anyDamage:true,...extra});}
function decayBarrier(battle,unit,ratio,seconds,key){
  const amount=unit.s.maxHp*ratio;
  const entry=battle.addBuff(unit,{key:sourceKey(unit,key),shield:amount,duration:seconds,interval:.1,refresh:'independent',maxStacks:999,source:unit,visible:true,
    onTick:({buff:barrier})=>{barrier.shield=Math.max(0,barrier.shield-amount*.1/seconds);}});
  return entry;
}
function inArea(battle,unit,center,radius){return enemies(battle,unit,{scope:'field',count:999,groundOnly:true})
  .filter(e=>square(e.x-center.x)+square(e.y-center.y)<=square(radius));}
function weakAttack(battle,unit,target,ratio,seconds){if(target.alive)buff(battle,unit,target,{key:sourceKey(unit,'weaken'),mods:{atkMul:1-ratio},duration:seconds});}

const estell=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({unit})=>blocked(unit).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(const target of blocked(unit).slice(0,3))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>observeCount(battle,unit,'kill','self-healing',p=>p.target?.side==='enemy'&&around(unit,p.target),()=>{
    heal(battle,unit,unit,{maxHpRatio:valuesOf(unit).heal});
    for(const target of ops(battle,unit).filter(t=>t!==unit&&t.def.profession==='WARRIOR'&&withinAdjacent4(unit,t)))heal(battle,unit,target,{maxHpRatio:valuesOf(unit).heal*.5});return true;
  }),
});
const humus=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);guard(battle,unit,'efficient-block',v.uses,{blockCnt:v.block});
    for(let i=0;i<v.hits;i++)for(const target of targets(battle,unit)){
      const ratio=unit.hp/unit.s.maxHp,scale=1+(ratio>v.high?v.second:ratio>v.low?v.first:0);
      damage(battle,unit,target,{scale,type:'phys',isSkill:true});}return true;},
  link:(battle,unit)=>battle.on('heal',({source,target,amount,opts})=>{
    if(!active(unit)||opts?.regen||target?.ownerId!==unit.ownerId||target.profile?.sub!=='reaper'||target!==unit&&!withinAdjacent4(unit,target))return;
    const strongest=ops(battle,unit).filter(t=>t.def.charId==='char_491_humus'&&(target===t||withinAdjacent4(t,target)))
      .sort((a,b)=>valuesOf(b).barrier-valuesOf(a).barrier||a.id-b.id)[0];if(strongest!==unit)return;
    const excess=amount-(target.s.maxHp-target.hp);if(!(excess>0))return;
    const key='adaptation:humus:recycled',old=target.findBuff(key),maximum=target.s.maxHp*valuesOf(unit).barrier;
    const before=old?.shield??0,added=battle.addBuff(target,{key,shield:Math.min(maximum,before+excess),duration:Infinity,source:unit,persist:true,visible:true});
    recordLinkEffect(battle,unit,'recycled',target,(added?.shield??0)>before);
  },{owner:unit,priority:-50}),
});
const gravel=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{decayBarrier(battle,unit,valuesOf(unit).shield,valuesOf(unit).duration,'rat-swarm');return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'small-support',mods:{defPct:valuesOf(unit).def},select:t=>t.base.cost<=10}),
  innate:(battle,unit)=>onDeploy(battle,unit,'small-cost',()=>{if(unit.mem.adaptGravelDiscount)return;unit.mem.adaptGravelDiscount=true;unit.mem.assaultCostDelta=(unit.mem.assaultCostDelta??0)-valuesOf(unit).cost;}),
});
const swire=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});
    for(const target of ops(battle,unit).filter(t=>t!==unit&&around(unit,t)&&melee(t)))grantAttackUses(battle,unit,target,'cooperative-guidance',v.uses,{atk:v.boost});return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'close-guidance',mods:{atkPct:valuesOf(unit).aura},select:t=>t!==unit&&around(unit,t)&&melee(t)}),
});
const sophia=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({unit})=>blocked(unit).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);guard(battle,unit,'whip-block',v.uses,{blockCnt:v.block});
    for(const target of blocked(unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});
    for(const target of ops(battle,unit).filter(t=>melee(t)&&t.s.blockCnt>=3)){
      grantAttackUses(battle,unit,target,'whip-scolding',v.uses,{aspd:v.aspd});grantHitUses(battle,unit,target,'whip-scolding',v.uses,{mods:{defPct:v.def},anyDamage:true});}return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'scolding',mods:{aspd:valuesOf(unit).aspd,defPct:valuesOf(unit).def},select:t=>melee(t)&&t.s.blockCnt>=3}),
});
const morgan=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit);battle.loseHp(unit,unit.s.maxHp*v.cost,{source:unit});
    buff(battle,unit,unit,{key:sourceKey(unit,'boiling-blood'),mods:{atkPct:v.berserk*Math.min(1,(1-unit.hp/unit.s.maxHp)/.7)},duration:.51,notify:false});
    decayBarrier(battle,unit,v.shield,v.duration,'fearless-parry');
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>conditionalSelf(battle,unit,'boiling-blood',()=>({atkPct:valuesOf(unit).berserk*Math.min(1,(1-unit.hp/unit.s.maxHp)/.7)})),
});
const ayer=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>canAttack({battle,unit})||ops(battle,unit).some(t=>t!==unit&&around(unit,t)&&blocked(t).length),
  cast:({battle,unit})=>{const v=valuesOf(unit);for(let i=0;i<v.hits;i++){
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});
    const held=new Set(ops(battle,unit).filter(t=>t!==unit&&around(unit,t)).flatMap(blocked));
    for(const target of held)damage(battle,unit,target,{scale:v.echo,type:'arts',isSkill:true});}return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'targeting-assistance',mods:{aspd:valuesOf(unit).aspd},select:t=>t===unit||around(unit,t)}),
});
const ghost=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({unit})=>blocked(unit).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);unit.mem.adaptGhostUndying=(unit.mem.adaptGhostUndying??0)+1;
    for(const target of blocked(unit).slice(0,3))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});
    applyStatus(battle,unit,unit,{status:'stun',duration:v.stun});return true;},
  link:(battle,unit)=>{
    allyAura(battle,unit,{key:'deep-sea-regeneration',mods:{hpRegenRatio:valuesOf(unit).regen},select:t=>t===unit||around(unit,t)&&matchesClass(t,{label:'深海猎人'})});
    battle.on('fatal',ctx=>{if(ctx.unit!==unit||!(unit.mem.adaptGhostUndying>0))return;
      unit.mem.adaptGhostUndying--;ctx.prevented=true;unit.hp=1;},{owner:unit,priority:30});
  },
  innate:(battle,unit)=>selfBuff(battle,unit,'deep-sea-hp',{hpPct:valuesOf(unit).hp}),
});
function mountainRoll(battle,unit,target,chance){const v=valuesOf(unit);if(battle.rng()>=chance)return 1;weakAttack(battle,unit,target,v.weaken,v.duration);return v.crit;}
const mountain=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(let i=0;i<v.rounds;i++)for(const target of targets(battle,unit)){
    damage(battle,unit,target,{scale:v.scale,hits:2,type:'phys',isSkill:true,crit:()=>mountainRoll(battle,unit,target,v.skillChance)});
    if(target.alive)battle.push(target,v.force,{from:unit});}return true;},
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','heavy-punch',p=>p.source?.ownerId===unit.ownerId&&p.status==='push',({payload})=>{
    weakAttack(battle,unit,payload.target,valuesOf(unit).weaken,valuesOf(unit).duration);return true;
  }),
  innate:(battle,unit)=>{selfBuff(battle,unit,'powerful-body',{defPct:valuesOf(unit).def,dodgePhys:valuesOf(unit).dodge});
    battle.on('hit',({source,target,dmg})=>{if(source===unit&&dmg.isAttack)dmg.mul*=mountainRoll(battle,unit,target,valuesOf(unit).chance);},{owner:unit});},
});

// x-6 is the pinned original range_table and op-chyue.js awakening range.
const CHYUE_X6=[[2,0],[1,0],[0,-2],[0,-1],[0,0],[0,1],[0,2],[-1,0],[-2,0]];
const chyueTargets=(battle,unit)=>enemies(battle,unit,{count:1,groundOnly:true});
const chyue=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>chyueTargets(battle,unit).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit),[center]=chyueTargets(battle,unit),picked=inArea(battle,unit,center,v.radius),awake=unit.mem.adaptChyueAwake;
    let kills=0;for(let i=0;i<(awake?2:1);i++)for(const target of picked.filter(active)){
      damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});if(!target.alive)kills++;}
    unit.mem.adaptChyueCasts=(unit.mem.adaptChyueCasts??0)+1;
    if(!awake&&unit.mem.adaptChyueCasts>=v.awaken){unit.mem.adaptChyueAwake=true;unit.rangeGrid=CHYUE_X6;battle.refreshRange(unit);}
    if(kills){const granted=sp(battle,unit,unit,v.charge,'all-things',sourceKey(unit,'all-things-self'))+chargeAdjacent(battle,unit,v.charge,'all-things','WARRIOR');
      recordLinkEffect(battle,unit,'all-things',unit,granted>0);}return true;},
  link:()=>{},
  innate:(battle,unit)=>{
    const mark=target=>target.findBuff(sourceKey(unit,'cease-war'));
    unit.profile.hitsFn=()=>unit.mem.adaptChyueAwake?2:1;
    battle.on('hit',({source,target,dmg})=>{if(source===unit&&mark(target))dmg.mul*=1+valuesOf(unit).bonus;},{owner:unit,priority:40});
    battle.on('damaged',({source,target,dmg})=>{if(source===unit&&dmg.isAttack&&!dmg.isSkill&&target.alive&&battle.rng()<valuesOf(unit).chance)
      buff(battle,unit,target,{key:sourceKey(unit,'cease-war'),mods:{},duration:valuesOf(unit).duration});},{owner:unit});
    battle.on('attack',({attacker,isSkill})=>{if(attacker===unit&&!isSkill&&unit.mem.adaptChyueAwake)sp(battle,unit,unit,1,'awakened-attack',sourceKey(unit,'awake-sp'));},{owner:unit});
  },
});
const qiubai=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(const target of targets(battle,unit))for(let i=0;i<v.hits&&target.alive;i++){
    damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});if(target.alive&&(hasStatus(target,'sluggish')||hasStatus(target,'bind')))
      damage(battle,unit,target,{scale:v.scale*v.skillBonus,type:'arts'});}return true;},
  link:(battle,unit)=>battle.on('damaged',({source,target,dmg,amount})=>{
    if(!active(unit)||!(amount>0)||source!==unit||!dmg.isAttack||!target.alive||!hasStatus(target,'sluggish')&&!hasStatus(target,'bind'))return;
    const scale=valuesOf(unit).bonus;
    battle.assaultRuntime.enqueue(()=>{if(target.alive)damage(battle,source,target,{scale,type:'arts'});},
      {key:sourceKey(unit,'penetrating-strike'),targetUid:uid(target),cause:battle.assaultRuntime.currentCause});
  },{owner:unit}),
  innate:(battle,unit)=>{battle.on('damaged',({source,target,dmg})=>{if(source===unit&&dmg.isAttack&&target.alive&&battle.rng()<valuesOf(unit).chance)
    applyStatus(battle,unit,target,{status:'bind',duration:valuesOf(unit).bind});},{owner:unit});
    observeCount(battle,unit,'statusApplied','fallen-petals',p=>p.source?.ownerId===unit.ownerId&&p.source!==unit&&['sluggish','bind'].includes(p.status)&&p.target?.side==='enemy',
      ({payload})=>active(payload.target)?damage(battle,unit,payload.target,{scale:valuesOf(unit).bonus,type:'arts'}):false,{every:valuesOf(unit).every});},
});
const pepe=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);let kills=0;
    for(let i=0;i<v.hits;i++){
      const [main]=targets(battle,unit);if(!main)break;
      const layer=Math.min(i,v.maxStacks),radius=(unit.profile.splashRadius||1.1)+layer*v.radiusGrowth;
      for(const target of inArea(battle,unit,main,radius)){
        damage(battle,unit,target,{scale:v.scale+layer*v.growth,type:'phys',isSkill:true});
        if(target.alive)applyStatus(battle,unit,target,{status:'stun',duration:target===main?v.mainStun:v.stun});else kills++;}
    }
    if(kills)sp(battle,unit,unit,Math.min(kills,v.maxRefund),'inheritance',sourceKey(unit,'inheritance'));return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'lotus-fragrance',mods:{atkPct:valuesOf(unit).aura},select:t=>t.def.profession==='WARRIOR'}),
});
const gvial2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({unit})=>blocked(unit).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);guard(battle,unit,'jungle-soul',v.uses,{blockCnt:v.block},{defer:v.defer,duration:v.duration,damageTypes:['phys','arts']});
    const extra=unit.mem.adaptAxeSwings??0;unit.mem.adaptAxeSwings=0;
    for(const target of blocked(unit).slice(0,5))for(let i=0;i<v.hits+extra&&active(target);i++)damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>{
    conditionalSelf(battle,unit,'battle-axe',()=>{const v=valuesOf(unit),scale=v.base+blocked(unit).length*v.perBlock;return{atkPct:scale,defPct:scale};});
    observeCount(battle,unit,'blocked','battle-axe-assist',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='WARRIOR',
      ()=>{unit.mem.adaptAxeSwings=(unit.mem.adaptAxeSwings??0)+1;return true;},{every:valuesOf(unit).every});
  },
  innate:(battle,unit)=>conditionalSelf(battle,unit,'medical-background',()=>({healingTakenMul:1+(unit.hp/unit.s.maxHp<.5?valuesOf(unit).lowHealing:valuesOf(unit).healing)})),
});
const kazimierz=unit=>matchesClass(unit,{label:'卡西米尔'});
const mlynar=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit),ramp=unit.trait.ramp??0;let kills=0;
    try{for(let i=0;i<v.hits;i++){
      buff(battle,unit,unit,{key:sourceKey(unit,'glory-ramp'),mods:{atkPct:Math.max(0,ramp*v.trait-kills*v.perKill)-ramp},duration:Infinity});
      for(const target of targets(battle,unit)){
        damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});
        if(target.alive)damage(battle,unit,target,{scale:v.mark,type:'true',isSkill:true});if(!target.alive)kills++;}
    }}finally{battle.removeBuff(unit,sourceKey(unit,'glory-ramp'));}
    for(const target of ops(battle,unit).filter(t=>kazimierz(t)&&anchor(unit).rangeKeySet.has(t.tileR*21+t.tileC)))
      grantAttackUses(battle,unit,target,'unbrilliant-glory',v.uses,{extra:{amount:unit.s.atk*v.mark,type:'true'}});return true;},
  link:(battle,unit)=>battle.on('damaged',({source,target,amount,dmg})=>{
    if(!active(unit)||source?.side!=='enemy'||!yours(unit,target)||!kazimierz(target)||dmg.tags?.includes('hpLoss')||!(amount>0))return;
    battle.assaultRuntime.enqueue(()=>{if(active(source))damage(battle,unit,source,{scale:valuesOf(unit).reflect,type:'true'});},
      {key:sourceKey(unit,'unconcerned'),targetUid:uid(source),cause:battle.assaultRuntime.currentCause});
  },{owner:unit}),
  innate:(battle,unit)=>{
    selfBuff(battle,unit,'unconcerned-taunt',{taunt:1});
    conditionalSelf(battle,unit,'ranger-crowd',()=>enemies(battle,unit,{scope:'adjacent8',count:999}).length>=valuesOf(unit).crowd?{dmgTakenMul:1-valuesOf(unit).crowdProtect}:null);
    battle.on('hit',({source,dmg})=>{if(source===unit&&(dmg.isAttack||dmg.isSkill))dmg.mul*=enemies(battle,unit,{scope:'adjacent8',count:999}).length>=valuesOf(unit).crowd?valuesOf(unit).crowded:valuesOf(unit).normal;},{owner:unit,priority:40});
  },
});
const yak=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit);guard(battle,unit,'cold-physique',v.uses,{hpPct:v.hp,defPct:v.def,resMul:v.resMul});return true;},
  link:(battle,unit)=>{selfBuff(battle,unit,'snowfield-guard',{resFlat:valuesOf(unit).res});
    observeCount(battle,unit,'damageTaken','snowfield-help',p=>yours(unit,p.target)&&p.target!==unit&&p.target.def.profession==='TANK'&&p.damageType==='arts',
      ()=>{const v=valuesOf(unit);guard(battle,unit,'cold-physique',1,{hpPct:v.hp,defPct:v.def,resMul:v.resMul});return true;},{every:valuesOf(unit).every});},
});
const snakek=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit);guard(battle,unit,'shell-defence',v.uses,{defPct:v.def,blockCnt:v.block});heal(battle,unit,unit,{maxHpRatio:v.heal,regen:true});return true;},
  link:(battle,unit)=>{selfBuff(battle,unit,'defence-specialist',{defPct:valuesOf(unit).aura});
    observeCount(battle,unit,'blocked','shell-support',p=>yours(unit,p.source)&&p.source!==unit,
      ()=>{const v=valuesOf(unit);guard(battle,unit,'shell-defence',1,{defPct:v.def,blockCnt:v.block});return true;},{every:valuesOf(unit).every});},
});
const bubble=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit);guard(battle,unit,'beaten',v.uses,{defPct:v.def,taunt:v.taunt},{counterDef:v.counter,type:'phys'});return true;},
  link:(battle,unit)=>observeCount(battle,unit,'hit','thorn-shield',p=>yours(unit,p.target)&&p.source?.side==='enemy',({payload})=>{
    weakAttack(battle,unit,payload.source,valuesOf(unit).weaken,valuesOf(unit).duration);return true;},{every:valuesOf(unit).every}),
  innate:(battle,unit)=>battle.on('hit',({source,target,dmg})=>{if(target===unit&&source?.side==='enemy'&&dmg.isAttack)weakAttack(battle,unit,source,valuesOf(unit).weaken,valuesOf(unit).duration);},{owner:unit}),
});
const sunbr=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>allies(battle,unit,{scope:'adjacent8',count:999}).some(t=>t.hp<t.s.maxHp),
  cast:({battle,unit,cause})=>{const v=valuesOf(unit);guard(battle,unit,'cooking-defence',v.uses,{defPct:v.def});
    battle.after(v.cook,()=>{if(active(unit))battle.assaultRuntime.withCause(cause,()=>{
      for(let i=0;i<v.heals;i++){const [target]=allies(battle,unit,{scope:'adjacent8',count:1});if(target)heal(battle,unit,target,{scale:v.heal});}
    });},{owner:unit});return true;},
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','frying-pan',p=>p.source?.ownerId===unit.ownerId&&p.source!==unit&&p.status==='stun',()=>{
    unit.mem.adaptGummyCrit=(unit.mem.adaptGummyCrit??0)+1;return true;},{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{
    battle.on('assaultAttackStarted',({attacker,attackId,isSkill})=>{if(attacker!==unit||isSkill)return;
      const stored=(unit.mem.adaptGummyCrit??0)>0;if(stored)unit.mem.adaptGummyCrit--;
      if(stored||battle.rng()<valuesOf(unit).chance)(unit.mem.adaptGummyCritIds??=new Set()).add(attackId);},{owner:unit});
    battle.on('hit',({source,target,dmg})=>{if(source===unit&&dmg.isAttack&&unit.mem.adaptGummyCritIds?.has(dmg.attackId)){
      dmg.mul*=valuesOf(unit).crit;if(target.alive)applyStatus(battle,unit,target,{status:'stun',duration:valuesOf(unit).stun});}},{owner:unit});
  },
});
const hsguma=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);guard(battle,unit,'shield-saw-defence',v.uses,{defPct:v.def});
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'special-operation',mods:{defPct:valuesOf(unit).aura},select:t=>t.def.profession==='TANK'}),
  innate:(battle,unit)=>battle.on('hit',({source,credit,target,dmg})=>{
    if(target===unit&&(source??credit)?.side==='enemy'&&['phys','arts'].includes(dmg.type)&&!dmg.cancel&&battle.rng()<valuesOf(unit).blockChance){dmg.cancel=true;battle.fx('block',{x:unit.x,y:unit.y,id:unit.id});}
  },{owner:unit}),
});
const zumama=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({unit})=>blocked(unit).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);guard(battle,unit,'steel-will',v.uses,{defPct:v.def,blockCnt:v.block});
    for(const target of blocked(unit).slice(0,3))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});
    heal(battle,unit,unit,{maxHpRatio:v.heal,regen:true});applyStatus(battle,unit,unit,{status:'stun',duration:v.stun});return true;},
  link:(battle,unit)=>observeCount(battle,unit,'blocked','battle-courage',p=>yours(unit,p.source)&&p.source!==unit,
    ()=>sp(battle,unit,unit,valuesOf(unit).charge,'battle-courage',sourceKey(unit,'battle-courage')),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{
    conditionalSelf(battle,unit,'courage-protection',()=>({dmgTakenMul:unit.hp/unit.s.maxHp<=.5?1-valuesOf(unit).lowProtect:1,spRecoveryFlat:blocked(unit).length?valuesOf(unit).recovery:0}));
    battle.on('hit',({source,dmg})=>{if(source===unit&&unit.hp/unit.s.maxHp>.5)dmg.mul*=valuesOf(unit).highDamage;},{owner:unit});
  },
});

export const adaptationMeleeKits=Object.freeze({char_127_estell:estell,char_491_humus:humus,char_237_gravel:gravel,char_308_swire:swire,
  char_265_sophia:sophia,char_154_morgan:morgan,char_294_ayer:ayer,char_143_ghost:ghost,char_264_f12yin:mountain,char_2024_chyue:chyue,
  char_4082_qiubai:qiubai,char_4058_pepe:pepe,char_1026_gvial2:gvial2,char_4064_mlynar:mlynar,char_199_yak:yak,
  char_150_snakek:snakek,char_381_bubble:bubble,char_196_sunbr:sunbr,char_136_hsguma:hsguma,char_416_zumama:zumama});
