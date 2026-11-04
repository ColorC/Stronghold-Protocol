import { adaptedKit } from '../adapted-kit.js';
import { active, enemies, buff, damage, heal, applyStatus, sp, payDP, uid, tileOf } from '../primitives.js';
import { allyAura, withinAdjacent4 } from '../synergy.js';
import { valuesOf, yours, ops, targets, canAttack, sourceKey, onDeploy, tagged } from './adaptation-core.js';
import { observeCount, conditionalSelf, chargeAdjacent, square } from './adaptation-pool.js';
import { grantHitUses } from './adaptation-support.js';
import { recordLinkEffect } from '../adaptation-primitives.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { bodyInKeys } from '../../../body.js';
import { powi } from '../../../detmath.js';

const near=(a,b)=>{const[r,c]=tileOf(b);return Math.max(Math.abs(a.tileR-r),Math.abs(a.tileC-c))<=1;};
const inside=(at,target,radius)=>square(target.x-at.x)+square(target.y-at.y)<=square(radius);
const ground=(battle,unit)=>enemies(battle,unit,{scope:'field',count:999,groundOnly:true});
function zone(battle,unit,at,seconds,radius,pulse){
  const fields=unit.mem.adaptAlchemy??=new Map(),id=unit.mem.adaptAlchemySeq=(unit.mem.adaptAlchemySeq??0)+1;
  const field={x:at.x,y:at.y,radius,until:battle.time+seconds};fields.set(id,field);
  battle.fx('zone',{id:unit.id,x:at.x,y:at.y,radius,dur:seconds,skill:unit.def.raw.assaultBody.adaptation.sourceSkillId});
  for(let tick=0;tick<seconds;tick++)battle.after(tick,()=>pulse(field,tick));
  battle.after(seconds,()=>fields.delete(id));return field;
}
const hasField=(unit,target)=>[...(unit.mem.adaptAlchemy?.values()??[])].some(f=>inside(f,target,f.radius));
const talr=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:ctx=>canAttack(ctx)&&ctx.battle.getPlayer(ctx.unit.ownerId).dp>=valuesOf(ctx.unit).costDP,
  cast:({battle,unit})=>{const v=valuesOf(unit);payDP(battle,unit,v.costDP,sourceKey(unit,'sewing'));
    for(const target of targets(battle,unit)){applyStatus(battle,unit,target,{status:'bind',duration:v.bind});
      damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});}return true;},
  link:(battle,unit)=>{
    const funded=new Map(),attackIds=new Map();
    observeCount(battle,unit,'dpSpent','careful-clients',p=>p.targetUid===unit.ownerId,()=>{
      const list=ops(battle,unit).filter(t=>t!==unit&&withinAdjacent4(unit,t));for(const target of list)funded.set(target,(funded.get(target)??0)+1);return list.length;
    },{every:valuesOf(unit).every,amount:p=>p.amount});
    battle.on('hit',({source,target,dmg})=>{if(!active(unit)||!yours(unit,source)||source===unit||!dmg.isAttack||target.blockedBy===source)return;
      const key=`${uid(source)}:${dmg.attackId}`;if(!attackIds.has(key)&&funded.get(source)>0){funded.set(source,funded.get(source)-1);attackIds.set(key,true);}
      if(attackIds.has(key))dmg.mul*=1+valuesOf(unit).bonus;
    },{owner:unit,priority:40});
  },
  innate:(battle,unit)=>battle.on('hit',({source,target,dmg})=>{if(source===unit&&target?.side==='enemy'&&target.blockedBy!==unit)dmg.mul*=1+valuesOf(unit).bonus;},{owner:unit,priority:40}),
});
const tinman=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit),[target]=targets(battle,unit,unit,1,true),at=target??targets(battle,unit)[0],atk=unit.s.atk;
    zone(battle,unit,at,v.seconds,v.radius,field=>{
      for(const enemy of ground(battle,unit).filter(e=>inside(field,e,v.radius)))battle.dealDamage(unit,enemy,{amount:atk*v.scale,type:'arts',isSkill:true,tags:['dot','zone']});
      for(const ally of battle.allyUnits.filter(t=>active(t)&&t.ownerId===unit.ownerId&&inside(field,t,v.radius)))heal(battle,unit,ally,{amount:atk*v.heal,regen:true});
    });return true;},
  link:(battle,unit)=>battle.on('hit',({target,dmg})=>{if(target?.side==='enemy'&&!target.isFlying&&hasField(unit,target)
    &&(dmg.tags??[]).some(tag=>['dot','necrosis','apoptosis'].includes(tag)))dmg.mul*=1+valuesOf(unit).dotBonus;},{owner:unit,priority:40}),
});
function flight(battle,unit){const uses=unit.mem.adaptFlightShots??0,key=sourceKey(unit,'flight');
  if(uses>0)buff(battle,unit,unit,{key,mods:{},flags:{liftoff:true,blockFly:true},duration:Infinity});
  else if(unit.findBuff(key)){battle.removeBuff(unit,key);battle.releaseBlocked(unit);}
}
const tippi=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({unit})=>unit.mem.adaptTippiIncoming===true,
  cast:({battle,unit})=>{const v=valuesOf(unit);unit.mem.adaptFlightShots=(unit.mem.adaptFlightShots??0)+v.flight;
    battle.releaseBlocked(unit);flight(battle,unit);for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:3*v.rounds,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>{const last=new Map();battle.on('hit',ctx=>{if(!active(unit)||!yours(unit,ctx.target)||!(ctx.target===unit||withinAdjacent4(unit,ctx.target)))return;
    const before=last.get(ctx.target)??-Infinity;last.set(ctx.target,battle.time);
    if(!ctx.dmg.cancel&&['phys','arts'].includes(ctx.dmg.type)&&battle.time-before+1e-9>=valuesOf(unit).quiet){
      ctx.dmg.cancel=true;battle.emit('dodge',{source:ctx.source,target:ctx.target,dmg:ctx.dmg});recordLinkEffect(battle,unit,'quiet-shelter',ctx.target);}
  },{owner:unit,priority:20});},
  innate:(battle,unit)=>{
    unit.profile.blockFly=false;battle.removeBuff(unit,'trait:skywalker');
    battle.on('hit',ctx=>{if(ctx.target!==unit||!active(unit)||!unit.skill.ready)return;
      unit.mem.adaptTippiIncoming=true;const cast=battle.assaultRuntime.cast(unit);unit.mem.adaptTippiIncoming=false;
      if(cast&&['phys','arts'].includes(ctx.dmg.type)){ctx.dmg.cancel=true;battle.emit('dodge',{source:ctx.source,target:unit,dmg:ctx.dmg});}
    },{owner:unit,priority:30});
    battle.on('attack',({attacker})=>{if(attacker===unit&&unit.mem.adaptFlightShots>0){unit.mem.adaptFlightShots--;flight(battle,unit);}},{owner:unit});
  },
});
const CASH_GRID=[[1,1],[0,0],[0,1],[0,2],[-1,1]];
function cash(battle,unit){const v=valuesOf(unit),keys=new Set(absoluteRangeKeys(CASH_GRID,unit.tileR,unit.tileC,unit.dir));
  const list=ground(battle,unit).filter(t=>bodyInKeys(t,keys)||t.blockedBy===unit),n=unit.mem.adaptCoins??0;unit.mem.adaptCoins=0;
  for(let i=0;i<n;i++){const live=list.filter(active);if(!live.length)break;const target=live[Math.floor(battle.rng()*live.length)];
    damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});if(target.alive)battle.push(target,v.force,{from:unit});}
  battle.fx('coin',{id:unit.id,x:unit.x,y:unit.y,n:0,spent:n});
}
const swire2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>!unit.mem.assaultBattleStates?.[unit.def.raw.assaultBody.adaptation.sourceSkillId]
    ||unit.mem.adaptCoins>0&&ground(battle,unit).length>0,
  state:()=>({enter:({unit})=>{unit.profile.hits=2;unit.mem.adaptCoins=1;},repeat:({battle,unit})=>cash(battle,unit)}),
  link:(battle,unit)=>{
    battle.on('merchantPay',ctx=>{if(ctx.unit!==unit)return;
      if(battle.getPlayer(unit.ownerId).dp<ctx.cost||ctx.cancel)return;
      if(!unit.mem.assaultBattleStates?.[unit.def.raw.assaultBody.adaptation.sourceSkillId])return;
      const v=valuesOf(unit);unit.mem.adaptCoins=Math.min(v.purse,(unit.mem.adaptCoins??0)+1);
      unit.mem.adaptBuyer=Math.min(v.cap,(unit.mem.adaptBuyer??0)+1);
      buff(battle,unit,unit,{key:sourceKey(unit,'buyer'),mods:{atkPct:v.growth*unit.mem.adaptBuyer},duration:Infinity,persist:true});
    },{owner:unit,priority:-100});
    battle.assaultRuntime.observe('kill',sourceKey(unit,'coin-kill'),({payload:p})=>{
      if(p.source===unit&&unit.mem.assaultBattleStates?.[unit.def.raw.assaultBody.adaptation.sourceSkillId])
        unit.mem.adaptCoins=Math.min(valuesOf(unit).purse,(unit.mem.adaptCoins??0)+1);
    },{owner:unit});
  },
  innate:(battle,unit)=>{
    onDeploy(battle,unit,'save-reset',()=>{unit.mem.adaptSaveCount=0;});
    battle.on('fatal',ctx=>{if(ctx.unit!==unit||ctx.prevented)return;const v=valuesOf(unit),n=unit.mem.adaptSaveCount??0,cost=v.saveDP*powi(2,n);
      if(!payDP(battle,unit,cost,sourceKey(unit,'save')))return;
      unit.mem.adaptSaveCount=n+1;ctx.prevented=true;unit.hp=Math.max(1,unit.s.maxHp*v.saveHP);
    },{owner:unit,priority:40});
  },
});
const glady=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit),target=targets(battle,unit,unit,999).sort((a,b)=>square(b.x-unit.x)+square(b.y-unit.y)-square(a.x-unit.x)-square(a.y-unit.y))[0];
    const at={x:target.x,y:target.y};applyStatus(battle,unit,target,{status:'bind',duration:v.bind});
    for(let i=0;i<v.hits;i++)for(const enemy of enemies(battle,unit,{scope:'field',count:999}).filter(e=>inside(at,e,v.radius))){
      buff(battle,unit,enemy,{key:sourceKey(unit,'tornado-slow'),mods:{moveMul:1-v.slow},duration:v.bind});
      damage(battle,unit,enemy,{scale:v.scale,type:'arts',isSkill:true});if(enemy.alive)battle.pull(enemy,v.force,{to:at,from:unit,stop:.05});}
    for(const enemy of enemies(battle,unit,{scope:'field',count:999}).filter(e=>inside(at,e,1)))battle.pullToFront(enemy,unit,v.force);return true;},
  link:(battle,unit)=>{
    allyAura(battle,unit,{key:'abyssal-tide',mods:{hpRegenRatio:valuesOf(unit).regen},select:t=>tagged(t,'深海猎人')});
    battle.on('hit',({source,target,dmg})=>{if(active(unit)&&yours(unit,target)&&tagged(target,'深海猎人')&&tagged(source,'海怪')&&['phys','arts'].includes(dmg.type))dmg.mul*=1-valuesOf(unit).protect;},{owner:unit,priority:40});
  },
  innate:(battle,unit)=>battle.on('hit',({source,target,dmg})=>{if(source===unit&&dmg.isAttack&&target?.side==='enemy'&&target.s.massLevel<=valuesOf(unit).weight)dmg.mul*=valuesOf(unit).crit;},{owner:unit,priority:40}),
});
function hysteria(battle,unit,list,stun=false){const v=valuesOf(unit);for(const target of list.filter(active).sort((a,b)=>a.hp-b.hp||a.id-b.id).slice(0,stun?3:1)){
  damage(battle,unit,target,{scale:v.arts*(stun?v.scale:1),type:'arts'});if(stun&&target.alive)applyStatus(battle,unit,target,{status:'stun',duration:v.stun});}
}
const mizuki=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(let i=0;i<v.hits&&active(unit);i++){
    const list=targets(battle,unit,unit,999,true);for(const target of list)damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});
    hysteria(battle,unit,list,true);if(list.length<3)battle.loseHp(unit,unit.s.maxHp*v.loss,{source:unit});}return true;},
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','hysteria',p=>p.status==='bind'&&p.source?.ownerId===unit.ownerId,
    ()=>{hysteria(battle,unit,targets(battle,unit,unit,999,true));return true;},{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{
    battle.on('attack',({attacker,targets:list})=>{if(attacker===unit)hysteria(battle,unit,list);},{owner:unit});
    conditionalSelf(battle,unit,'countertransference',()=>targets(battle,unit,unit,999).some(t=>t.hp/t.s.maxHp<.5)?{atkPct:valuesOf(unit).bonus}:null);
  },
});
function embrace(battle,unit){const v=valuesOf(unit);for(const target of ground(battle,unit).filter(t=>near(unit,t))){
  buff(battle,unit,target,{key:sourceKey(unit,'embrace'),mods:{moveMul:1-v.slow},duration:1.05});damage(battle,unit,target,{scale:v.dot,type:'arts'});}
}
const ghost2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({unit})=>!unit.trait.doll&&(unit.blocking??[]).some(active),
  cast:({battle,unit})=>{const v=valuesOf(unit);grantHitUses(battle,unit,unit,'ghost-heavy-hp',v.uses,{mods:{hpPct:v.hp},anyDamage:true});
    for(let i=0;i<v.hits&&active(unit);i++)for(const target of (unit.blocking??[]).filter(active)){
      const extra=target.hp/target.s.maxHp+1e-9>=unit.hp/unit.s.maxHp;
      damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});if(extra&&target.alive)damage(battle,unit,target,{scale:v.scale*v.extra,type:'phys',isSkill:true});
      else if(!extra&&active(unit))battle.loseHp(unit,unit.s.maxHp*v.loss,{source:unit});}return true;},
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','embrace-pull',p=>p.status==='pull'&&p.source?.ownerId===unit.ownerId&&p.source!==unit,
    ()=>{embrace(battle,unit);return true;}),
  innate:(battle,unit)=>{
    unit.profile.dollNoAttack=true;
    for(const other of battle.allyUnits.filter(t=>yours(unit,t)&&tagged(t,'深海猎人')))buff(battle,unit,other,{key:sourceKey(unit,'abyssal-depths'),mods:{hpPct:valuesOf(unit).teamHP},duration:Infinity,persist:true,allowDead:true});
    battle.every(1,()=>{if(active(unit)&&unit.trait.doll&&!unit.trait.dollSwitching)embrace(battle,unit);},{owner:unit});
  },
});
const hbound=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:ctx=>targets(ctx.battle,ctx.unit,ctx.unit,1,true).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit),target=targets(battle,unit,unit,999,true).sort((a,b)=>b.s.massLevel-a.s.massLevel||a.id-b.id)[0],atk=unit.s.atk;
    zone(battle,unit,target,v.seconds,v.radius,field=>{for(const enemy of ground(battle,unit).filter(e=>inside(field,e,v.radius))){
      const heavy=enemy.s.massLevel>=v.weight;battle.dealDamage(unit,enemy,{amount:atk*(v.scale+(heavy?v.heavy:0)),type:'arts',isSkill:true,tags:['dot','zone']});
      if(heavy&&enemy.alive)buff(battle,unit,enemy,{key:sourceKey(unit,'aground'),mods:{moveMul:1-v.slow},duration:1.05});
    }});return true;},
  link:(battle,unit)=>battle.on('hit',({source,target,dmg})=>{if(source?.side==='enemy'&&!source.isFlying&&hasField(unit,source)&&['phys','arts'].includes(dmg.type)
    &&target?.side==='ally'&&battle.rng()<(source.s.massLevel>=valuesOf(unit).weight?valuesOf(unit).heavyMiss:valuesOf(unit).miss)){
      dmg.cancel=true;battle.emit('dodge',{source,target,dmg});}
  },{owner:unit,priority:40}),
});
const jnight=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{unit.mem.adaptCheerUntil=battle.time+valuesOf(unit).seconds;return true;},
  link:(battle,unit)=>observeCount(battle,unit,'kill','justice-cheer',p=>p.source?.ownerId===unit.ownerId&&p.target?.isFlying,
    ()=>chargeAdjacent(battle,unit,valuesOf(unit).charge,'justice-cheer','SNIPER'),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>battle.every(.1,()=>{const left=(unit.mem.adaptCheerUntil??0)-battle.time;if(!active(unit)||left<=0)return;
    for(const target of enemies(battle,unit,{count:999}).filter(t=>t.isFlying))buff(battle,unit,target,{key:sourceKey(unit,'cheer-air'),mods:{dmgTakenMul:1+valuesOf(unit).fragile},duration:Math.min(.21,left)});
    for(const target of ops(battle,unit).filter(t=>t.def.position==='RANGED'&&unit.rangeKeySet.has(t.tileR*21+t.tileC)))
      buff(battle,unit,target,{key:sourceKey(unit,'cheer-ranged'),mods:{taunt:valuesOf(unit).taunt},duration:Math.min(.21,left)});
  },{owner:unit}),
});
export const adaptationSpecialKits=Object.freeze({char_4155_talr:talr,char_4151_tinman:tinman,char_4191_tippi:tippi,char_1033_swire2:swire2,
  char_474_glady:glady,char_437_mizuki:mizuki,char_1023_ghost2:ghost2,char_4232_hbound:hbound,char_4000_jnight:jnight});
