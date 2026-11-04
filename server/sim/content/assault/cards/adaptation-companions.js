import { adaptedKit } from '../adapted-kit.js';
import { active, damage, heal, buff, sp, applyStatus, enemies } from '../primitives.js';
import { valuesOf, targets, owned, ops, anchor, sourceKey, onDeploy } from './adaptation-core.js';
import { grantAttackUses, grantHitUses } from './adaptation-support.js';
import { sourceKit, installSourceParts, installResourceParts, instantAttack, hasManualInstruction, observeNativeLinkBuffs } from './adaptation-native.js';
import { observeCount } from './adaptation-pool.js';
import { countedTrigger } from '../adaptation-primitives.js';
import { grantSummon, deployPreparedSummons, summonPlacementLegal } from '../summons.js';
import { assaultAmmoState } from '../ammo.js';
import { sortEnemyTargets } from '../../../targeting.js';
import { dirFromDelta } from '../../../dir.js';
import { installAura } from '../../kits/shared/tier1.js';
import nativeTokens from '../../tokens.js';
import rosmonKits from '../../kits/ops/chess_char_6_12-rosmon.js';
import wisdelKits from '../../kits/ops/op-wisdel.js';
import rayKits from '../../kits/ops/op-ray.js';
import duskKits from '../../kits/ops/chess_char_5_12-dusk.js';
import skadiKits from '../../kits/ops/chess_char_6_04-skadi2.js';
import monstrKits from '../../kits/ops/op-monstr.js';
import jescaKits from '../../kits/ops/op-jesca2.js';

export const COMPANION_TOKENS=Object.freeze({rosmon:'token_10012_rosmon_shield',wisdel:'token_10035_wisdel_wward',ray:'token_10034_ray_sndbst',
  dusk:'token_10015_dusk_drgn',skadi2:'token_10017_skadi2_dedant',monstr:'token_10050_monstr_prosts',jesca2:'token_10032_jesca2_jckshd'});
const ID=COMPANION_TOKENS,originals=new WeakMap(),my=(b,u,id)=>owned(b,u).filter(t=>t.defId===id);
function original(u,builder){return sourceKit(u,builder);}
function nativeSkill(u){const kit=originals.get(u);return kit.skills?.[u.def.raw.assaultBody.adaptation.sourceSkillId]??kit.skill;}
function inSkillRange(b,u,fn){const grid=u.rangeGrid;u.rangeGrid=u.def.raw.assaultBody.adaptation.rangeGrid;b.refreshRange(u);
  try{return fn();}finally{u.rangeGrid=grid;b.refreshRange(u);}}
function summonSpec(u,id,count=1){const v=valuesOf(u),manual=u.def.raw.assaultBody.adaptation.manualSummons.find(s=>s.tokenId===id);
  return {tokenId:id,count,stockCap:v.stock,fieldCap:v.field,preparedOnly:true,placementScope:manual.scope,ruleKey:`adaptation:${u.def.charId}`};}
function initial(b,u,id){onDeploy(b,u,`companion-initial:${id}`,()=>{if(u.mem.adaptCompanionInitial)return;u.mem.adaptCompanionInitial=true;
  deployPreparedSummons(b,u,summonSpec(u,id));});}
function passive(id,trait={},install){return {trait,skill:{id:`${id}:adaptation`,kind:'passive',trigger:'NEVER',assaultCast:()=>false},install};}
function born(b,t,fn){b.on('deploy',p=>{if(p.unit===t)fn();},{owner:t});}
function foes(b,x,y,r,ground=false){return b.foesInRadius(x,y,r,true).filter(e=>active(e)&&(!ground||!e.isFlying));}

const rosmon=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle:b,unit:u})=>hasManualInstruction(u,ID.rosmon)||targets(b,u).some(e=>e.blockedBy),
  cast:({battle:b,unit:u})=>{const v=valuesOf(u);grantSummon(b,u,summonSpec(u,ID.rosmon,2));
    for(const e of b.enemies)if(active(e)&&!e.blockedBy)b._checkBlock(e);
    const profile=u.profile;u.profile={...profile,maxTargets:2};
    try{for(let i=0;i<v.hits;i++)instantAttack(b,u,targets(b,u).filter(e=>e.blockedBy),{scale:v.scale,type:'phys',onImpact:main=>{
      const x=main.x,y=main.y,atk=u.s.atk*v.scale;
      for(const e of foes(b,x,y,.9,true))if(e!==main)damage(b,u,e,{amount:atk,type:'phys',isSkill:true});
      b.after(.35,()=>{for(const e of foes(b,x,y,.9,true))b.dealDamage(u,e,{amount:atk*.5,type:'phys',isSkill:true,tags:['aftershock']});});
    }});}finally{u.profile=profile;}return true;},
  innate:(b,u)=>{observeNativeLinkBuffs(b,u,'perception-stability',(target,spec)=>target===u&&spec.key==='rosmon:stable');
    const kit=sourceKit(u,rosmonKits.chess_char_6_12_a,{}, {1:{atk:valuesOf(u).linkAtk}});installSourceParts(b,u,kit);},
});

const markKey=u=>`wisdel:mark:${u.id}`;
function mark(b,u,e){if(active(e)&&active(u)&&!e.findBuff(markKey(u)))b.addBuff(e,{key:markKey(u),source:u,tags:['wisdel:mark']});}
function shadowSupply(b,u,n,firstSP=0){u.mem.adaptShadowSupply=Math.min(3,(u.mem.adaptShadowSupply??0)+n);let spawned=0;
  if(!active(u))return 0;
  for(const p of u.def.raw.assaultPiece.summonPresets??[]){if(!u.mem.adaptShadowSupply||my(b,u,ID.wisdel).length>=3)break;
    if(p.tokenId!==ID.wisdel||!summonPlacementLegal(b,u,ID.wisdel,p.row,p.col,{placementScope:'ownerRange'}))continue;
    const t=b.spawnToken(u,ID.wisdel,p.row,p.col,{dir:p.dir??u.dir,assaultCost:0});if(!t)continue;
    u.mem.adaptShadowSupply--;if(!spawned&&firstSP>0)t.skill.gainSp(firstSP,'init');spawned++;
  }return spawned;
}
const wisdel=(_bb,_raw,def)=>{
  const source=sourceKit({def},wisdelKits.char_1035_wisdel);
  return {...adaptedKit(def,{
    canCast:({battle,unit})=>targets(battle,unit).length>0,
    cast:({battle:b,unit:u})=>{const v=valuesOf(u);shadowSupply(b,u,2,v.firstSP);
      const [main]=targets(b,u);if(!main)return false;const atk=u.s.atk*(1+v.atk),x=main.x,y=main.y;
      // The main attack is one native round; its ground-only aftershock keeps
      // the cast's ATK snapshot after the instant skill has already ended.
      instantAttack(b,u,[main],{scale:(1+v.atk)*v.scale*v.main,type:'phys',onHit:e=>mark(b,u,e)});
      for(const e of foes(b,x,y,v.radius))if(e!==main)damage(b,u,e,{amount:atk*v.scale,type:'phys',isSkill:true});
      b.after(.35,()=>{for(const e of foes(b,x,y,v.radius,true)){
        b.dealDamage(u,e,{amount:atk*v.scale*.5*(e===main?v.main:1),type:'phys',isSkill:true,isSplash:true,tags:['aftershock','wisdel:shock']});
        if(!active(e)||!e.findBuff(markKey(u)))continue;b.removeBuff(e,markKey(u));
        for(const other of foes(b,e.x,e.y,1.1)){b.dealDamage(u,other,{amount:atk*v.bomb,type:'phys',isSkill:true,isSplash:true,tags:['wisdel:bomb']});
          if(active(other))applyStatus(b,u,other,{status:'stun',duration:v.stun});}
      }});return true;},
    innate:(b,u)=>{source.talents[0].install(b,u);onDeploy(b,u,'dead-soul',()=>shadowSupply(b,u,1));
      b.on('tick',()=>{if(active(u)&&u.mem.adaptShadowSupply>0)shadowSupply(b,u,0);},{owner:u});},
  }),trait:source.trait};
};

function rayTargets(b,u){const keys=[...new Set([...anchor(u).rangeKeys,...u.mem.rayAreaKeys??[]])],list=b.enemiesInKeys(keys,u,{...u.profile,canHitFly:true});
  sortEnemyTargets(b,u,list,u.profile.priority);return list.slice(0,1);}
const ray=(_bb,_raw,def)=>{const source=sourceKit({def},rayKits.char_4117_ray,{}, {0:{damage_scale:def.raw.assaultBody.adaptation.values.area}});
  return {...adaptedKit(def,{
    canCast:({battle,unit})=>rayTargets(battle,unit).length>0,
    cast:({battle:b,unit:u})=>inSkillRange(b,u,()=>{const v=valuesOf(u);u.trait.ammo=u.profile.ammoMax??8;u.mem.rayReloading=false;u.mem.rayFill=false;u.mem.rayKilled=false;
      for(let i=0;i<v.hits&&u.trait.ammo>0;i++){const list=rayTargets(b,u);if(!list.length)break;u.trait.ammo--;
        instantAttack(b,u,list,{scale:v.scale*(u.profile.ammoScale??1.2),type:'phys',onHit:e=>applyStatus(b,u,e,{status:'bind',duration:v.bind})});}
      if(u.mem.rayKilled)sp(b,u,u,v.refund,'ray-skill-refund',sourceKey(u,'ray-refund'));u.mem.rayKilled=false;return true;}),
    innate:(b,u)=>{const kit=sourceKit(u,rayKits.char_4117_ray,{}, {0:{damage_scale:valuesOf(u).area},1:{atk:valuesOf(u).trance}});
      installSourceParts(b,u,kit);initial(b,u,ID.ray);},
  }),trait:source.trait};};

function duskSummon(b,u){const v=valuesOf(u),t=my(b,u,ID.dusk)[0];if(t){t.mem.adaptDuskUntil=b.time+v.seconds;return;}
  grantSummon(b,u,summonSpec(u,ID.dusk));}
const dusk=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle:b,unit:u})=>hasManualInstruction(u,ID.dusk)||my(b,u,ID.dusk).length>0||inSkillRange(b,u,()=>targets(b,u,u,999).length>0),
  cast:({battle:b,unit:u})=>inSkillRange(b,u,()=>{const v=valuesOf(u);duskSummon(b,u);
    for(let i=0;i<v.hits;i++){const list=targets(b,u,u,999).sort((a,c)=>Number(!!a.blockedBy)-Number(!!c.blockedBy));const main=list[0];if(!main)break;
      instantAttack(b,u,[main],{scale:v.scale,type:'arts',onImpact:e=>{for(const other of foes(b,e.x,e.y,v.radius))if(other!==e)damage(b,u,other,{scale:v.scale,type:'arts',isSkill:true});}});
    }return true;}),
  innate:(b,u)=>{const kit=sourceKit(u,duskKits.chess_char_5_12_a,{}, {0:{atk:valuesOf(u).growth,max_stack_cnt:valuesOf(u).cap}});
    observeNativeLinkBuffs(b,u,'realm',(target,spec)=>target===u&&spec.key==='dusk:realm');kit.talents[0].install(b,u);
    b.on('deploy',p=>{if(p.unit===u)u.mem.adaptDuskDotted=false;},{owner:u});
    b.on('attack',p=>{if(p.attacker===u&&!u.mem.adaptDuskDotted&&p.targets.some(e=>e.side==='enemy')){u.mem.adaptDuskDotted=true;duskSummon(b,u);}},{owner:u});
  },
});

const skadi2=(_bb,_raw,def)=>{const source=sourceKit({def},skadiKits.chess_char_6_04_a);
  return {...adaptedKit(def,{
    cast:({battle:b,unit:u})=>{const v=valuesOf(u),areas=[u,...my(b,u,ID.skadi2)],covered=new Set();
      for(const at of areas)for(const a of b.alliesInGrid(at))if(a!==u&&a.kind!=='device'&&a.defId!==ID.skadi2&&!a.mem.noInspire)covered.add(a);
      for(const a of covered)grantAttackUses(b,u,a,'inspire',v.uses,{flat:u.s.atk*v.inspire,inspire:true});
      for(let i=0;i<v.pulses;i++){for(const at of areas)for(const e of b.enemiesInKeys(at.rangeKeys,u,{canHitFly:true}))damage(b,u,e,{scale:v.scale,type:'true',isSkill:true});
        b.loseHp(u,Math.min(Math.max(0,u.hp-1),u.s.maxHp*v.loss),{source:u});}
      b.fx('tide',{x:u.x,y:u.y,id:u.id});return true;},
    innate:(b,u)=>{const v=valuesOf(u),kit=sourceKit(u,skadiKits.chess_char_6_04_a,{}, {1:{'skadi2_t_2[atk][1].atk':v.ally,'skadi2_t_2[atk][2].atk':v.abyssal}});
      installSourceParts(b,u,kit);initial(b,u,ID.skadi2);},
  }),trait:source.trait};};

const monstr=(_bb,_raw,def)=>{const source=sourceKit({def},monstrKits.char_4179_monstr);
  return {...adaptedKit(def,{
    canCast:({battle,unit})=>my(battle,unit,ID.monstr).length>0,
    cast:({battle:b,unit:u})=>{const v=valuesOf(u),skill=nativeSkill(u),old=u.profile,grid=u.rangeGrid,key=sourceKey(u,'meltdown');
      buff(b,u,u,{key,mods:{atkPct:v.atk,hpFlat:v.hp,blockCnt:v.block},duration:Infinity});
      u.profile={...old,dmgType:'true',attack:'melee',projectile:'none',canHitFly:false,groundOnly:true,heal:null,hitAllBlocked:true};
      u.rangeGrid=u.def.raw.assaultBody.adaptation.rangeGrid;b.refreshRange(u);
      try{skill.onStart({battle:b,unit:u,skill:u.skill});if(!u.mem.mHome)return false;
        for(const e of b.enemies)if(active(e)&&!e.blockedBy)b._checkBlock(e);
        for(let i=0;i<v.hits&&active(u)&&!u.mem.mFatal;i++){
          const list=b.enemiesInKeys(u.rangeKeys,u,u.profile);sortEnemyTargets(b,u,list);const selected=list.slice(0,u.s.blockCnt);
          if(selected.length)instantAttack(b,u,selected,{type:'true'});b.loseHp(u,80,{source:u});
        }
      }finally{skill.onEnd({battle:b,unit:u});u.profile=old;u.rangeGrid=grid;b.refreshRange(u);b.removeBuff(u,key);}return true;},
    innate:(b,u)=>{const kit=sourceKit(u,monstrKits.char_4179_monstr);originals.set(u,kit);
      installSourceParts(b,u,kit,{talents:false});kit.talents[0].install(b,u);initial(b,u,ID.monstr);
      b.on('heal',p=>{if(p.source!==u||p.opts?.regen||!(p.amount>0))return;const v=valuesOf(u);
        for(const a of new Set([u,p.target]))grantAttackUses(b,u,a,'tactical-synergy',v.uses,{aspd:v.aspd});},{owner:u});
    },
  }),trait:source.trait};};

const jesca2=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle:b,unit:u})=>inSkillRange(b,u,()=>{const v=valuesOf(u),key=sourceKey(u,'saturation');u.mem.adaptJescaArmed=true;
    grantHitUses(b,u,u,'saturation-guard',v.uses,{mods:{defPct:v.def},anyDamage:true});
    for(const t of my(b,u,ID.jesca2))grantHitUses(b,u,t,'saturation-shield',v.uses,{mods:{defPct:v.shieldDef},anyDamage:true});
    buff(b,u,u,{key,mods:{atkPct:v.atk},duration:Infinity});
    try{instantAttack(b,u,targets(b,u),{type:'phys'});nativeSkill(u).onStart({battle:b,unit:u});u.mem.adaptJescaTick?.({dt:0});}
    finally{b.removeBuff(u,key);}return true;}),
  link:(b,u)=>{const take=countedTrigger(b,{key:sourceKey(u,'shield-battery'),owner:u,every:valuesOf(u).every},
    ()=>sp(b,u,u,valuesOf(u).charge,'shield-battery',sourceKey(u,'shield-battery')));
    b.on('damaged',p=>{if(p.target?.ownerUnit===u&&p.target.defId===ID.jesca2&&active(u)&&p.type!=='element'&&p.dmg&&!p.dmg.tags?.includes('hpLoss'))
      take({target:u,cause:b.assaultRuntime.currentCause});},{owner:u});},
  innate:(b,u)=>{const kit=sourceKit(u,jescaKits.char_1034_jesca2);originals.set(u,kit);kit.talents[0].install(b,u);
    // Preserve the native travelling shell. Only its pending fire action sees
    // the original attack state; shells already in flight keep their snapshot.
    const on=b.on;b.on=function(event,fn,config){if(event==='tick'&&config?.owner===u){const native=fn;fn=ctx=>{
      const fire=u.mem.jescaBomb&&u.mem.adaptJescaArmed&&active(u)&&!u.findBuff(sourceKey(u,'saturation')),key=sourceKey(u,'shell-launch');
      if(fire)buff(b,u,u,{key,mods:{atkPct:valuesOf(u).atk},duration:Infinity});
      try{return fire?inSkillRange(b,u,()=>native(ctx)):native(ctx);}finally{if(fire)b.removeBuff(u,key);
        for(const t of my(b,u,ID.jesca2))b.removeBuff(t,'skill:jesca2:shield');}
    };u.mem.adaptJescaTick=fn;}return on.call(this,event,fn,config);};
    try{installResourceParts(b,u,kit,event=>event==='tick'&&!!u.mem.jescaBomb&&u.mem.adaptJescaArmed&&assaultAmmoState(u).current>0,{talents:false});}
    finally{b.on=on;}initial(b,u,ID.jesca2);
  },
});

function respawn(b,t,{before,after}={}){b.on('death',p=>{if(p.unit!==t||b.finished)return;before?.();t.removed=false;t.mem.adaptReadyAt=b.time+t.base.respawnTime;
  if(t.mem.adaptRetry)return;t.mem.adaptRetry=b.every(.1,(battle,sched)=>{
    if(t.alive||t.removed||battle.finished){sched.cancel();t.mem.adaptRetry=null;return;}
    if(!active(t.ownerUnit)||battle.time+1e-9<t.mem.adaptReadyAt)return;if(battle.redeploy(t,{free:false})){sched.cancel();t.mem.adaptRetry=null;after?.();}
  },{owner:t});},{owner:t,priority:-10});}
function shadowKit(_bb,_raw,def,t){const u=t.ownerUnit;
  return {trait:{noAttack:true},skill:{id:def.skill.id,kind:'instant',spType:'time',spCost:5,trigger:'SP_FULL',
    canCast:({battle})=>active(u)&&targets(battle,u,u,999,true).length>0,
    assaultCast:({battle:b,unit})=>{const list=targets(b,u,u,999,true).sort((a,c)=>Number(!!a.findBuff(markKey(u)))-Number(!!c.findBuff(markKey(u))));const e=list[0];if(!e)return false;
      damage(b,unit,e,{scale:1,type:'arts',isSkill:true});if(active(e)){applyStatus(b,unit,e,{status:'sluggish',duration:1});mark(b,u,e);}
      const add=b.rng.int(3);if(add)unit.skill.gainSp(add,'init');return true;},},
    install:(b,unit)=>{buff(b,unit,unit,{key:'trait:abnormal',mods:{},flags:{noHeal:true},persist:true,allowDead:true});
      born(b,unit,()=>{if(active(u)&&Math.abs(u.tileR-unit.tileR)+Math.abs(u.tileC-unit.tileC)<=1)buff(b,unit,u,{key:`wisdel:camou:${unit.id}`,mods:{},flags:{camou:true}});});
      b.on('death',p=>{if(p.unit===unit)b.removeBuff(u,`wisdel:camou:${unit.id}`);},{owner:unit});},};
}
function prostsKit(_bb,_raw,_def,t){const u=t.ownerUnit;
  return passive(ID.monstr,{noAttack:true},(b,unit)=>{
    buff(b,unit,unit,{key:'monstr:prosts:abnormal',mods:{taunt:-1},flags:{noHeal:true,noBlock:true},persist:true,allowDead:true});
    installAura(b,unit,{key:'talent:monstr:prostsAtk',select:a=>a!==unit&&Math.abs(a.tileR-unit.tileR)<=1&&Math.abs(a.tileC-unit.tileC)<=1,
      mods:{atkPct:valuesOf(u).aura},value:valuesOf(u).aura,interval:.1});
    born(b,unit,()=>{const seq=unit.deploySeq;b.after(1,()=>{if(!active(unit)||unit.deploySeq!==seq)return;
      b.every(.1,(battle,sched)=>{if(!active(unit)||unit.deploySeq!==seq){sched.cancel();return;}battle.loseHp(unit,8,{source:unit,tags:['monstr:prostsBleed']});},{owner:unit,immediate:true});},{owner:unit});});
    respawn(b,unit);b.on('deploy',p=>{if(p.unit===u&&!p.move)unit.mem.adaptReadyAt=b.time;},{owner:unit});
  });
}
function shieldKit(_bb,_raw,_def,t){const u=t.ownerUnit;
  return passive(ID.jesca2,{noAttack:true},(b,unit)=>{
    buff(b,unit,unit,{key:'jesca2:shield:abnormal',mods:{taunt:1},flags:{noHeal:true},persist:true,allowDead:true});
    born(b,unit,()=>{unit.mem.adaptShieldUntil=b.time+50;const dir=dirFromDelta(unit.tileR-u.tileR,unit.tileC-u.tileC,u.dir);
      u.mem.jescaOldDir??=u.dir;unit.dir=dir;u.dir=dir;b.refreshRange(u);
      if(u.mem.adaptJescaArmed&&assaultAmmoState(u).current>0)u.mem.jescaBomb=true;
    });
    b.on('tick',()=>{if(active(unit)&&b.time>=unit.mem.adaptShieldUntil)b.retreat(unit,{reason:'expired',permanent:true});},{owner:unit});
    respawn(b,unit,{before:()=>{if(u.mem.jescaOldDir!=null){u.dir=u.mem.jescaOldDir;u.mem.jescaOldDir=null;b.refreshRange(u);}}});
    b.on('deploy',p=>{if(p.unit===u&&!p.move)unit.mem.adaptReadyAt=b.time;},{owner:unit});
  });
}
export const adaptationCompanionTokenKits=Object.freeze({
  [ID.rosmon]:(bb,raw,def)=>{const native=nativeTokens[ID.rosmon](bb,raw,def);return {...native,skill:passive(ID.rosmon).skill};},
  [ID.wisdel]:shadowKit,
  [ID.ray]:()=>passive(ID.ray,{noAttack:true},(b,t)=>buff(b,t,t,{key:'ray:sandbeast',mods:{},flags:{invulnerable:true,noHeal:true},persist:true,allowDead:true})),
  [ID.dusk]:()=>passive(ID.dusk,{},(b,t)=>{born(b,t,()=>{t.mem.adaptDuskUntil=b.time+25;});b.on('tick',()=>{if(active(t)&&b.time>=t.mem.adaptDuskUntil)b.retreat(t,{reason:'expired',permanent:true});},{owner:t});}),
  [ID.skadi2]:()=>passive(ID.skadi2,{noAttack:true},(b,t)=>buff(b,t,t,{key:'skadi2:seaborn',mods:{},flags:{invulnerable:true,noHeal:true},persist:true,allowDead:true})),
  [ID.monstr]:prostsKit,[ID.jesca2]:shieldKit,
});
export const adaptationCompanionKits=Object.freeze({char_391_rosmon:rosmon,char_1035_wisdel:wisdel,char_4117_ray:ray,char_2015_dusk:dusk,
  char_1012_skadi2:skadi2,char_4179_monstr:monstr,char_1034_jesca2:jesca2});
