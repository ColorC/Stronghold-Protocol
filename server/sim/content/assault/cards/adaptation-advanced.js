import { adaptedKit } from '../adapted-kit.js';
import { active, enemies, buff, damage, heal, sp, uid, tileOf } from '../primitives.js';
import { bodyInKeys } from '../../../body.js';
import { valuesOf, yours, ops, owned, targets, sourceKey, onDeploy } from './adaptation-core.js';
import { observeCount } from './adaptation-pool.js';
import { grantHitUses } from './adaptation-support.js';
import { grantSummon, deployStoredSummons } from '../summons.js';
import { sourceKit, installSourceParts, nativeMarkerAction, nativeBurst, hasManualInstruction, observeNativeLinkBuffs } from './adaptation-native.js';
import { recordLinkEffect } from '../adaptation-primitives.js';
import thornKits from '../../kits/ops/chess_char_5_15-thorn2.js';
import demetrKits from '../../kits/ops/op-demetr.js';
import ulpiaKits from '../../kits/ops/chess_char_5_05-ulpia.js';
import etlchiKits from '../../kits/ops/chess_char_5_06-etlchi.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { assaultAmmoState } from '../ammo.js';

const BOND='token_10065_demetr_dmtpos',ANCHOR='token_10039_ulpia_block',LION='token_10040_siege2_vlion';
const CROSS=[[0,0],[-1,0],[1,0],[0,-1],[0,1]];
// Native op-demetr.js X2: a five-by-five search square without its corners.
const DEMETR_SEARCH=Array.from({length:5},(_,r)=>Array.from({length:5},(_,c)=>[r-2,c-2])).flat().filter(([r,c])=>Math.abs(r)+Math.abs(c)<=3);
const near=(a,b)=>Math.max(Math.abs(a.tileR-b.tileR),Math.abs(a.tileC-b.tileC))<=1;
const kits=new WeakMap();
const original=(unit)=>{const kit=kits.get(unit);if(!kit)throw Error('Missing original adaptation mechanism');return kit;};
const ctx=(battle,unit)=>({battle,unit,skill:unit.skill});
function selected(unit,kit=original(unit)){return kit.skills?.[unit.def.raw.assaultBody.adaptation.sourceSkillId]??kit.skill;}
const thorn2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>ops(battle,unit).length>0,
  cast:({battle,unit})=>{selected(unit).onStart(ctx(battle,unit));return true;},
  innate:(battle,unit)=>{const v=valuesOf(unit),kit=sourceKit(unit,thornKits.chess_char_5_15_a,
    {projectile_delay_time:v.seconds,atk_scale:v.scale,max_atk_scale:v.maxScale},
    {0:{projectile_extend:v.extend,atk:v.atk},1:{attack_speed_ally:v.aspd,attack_speed_ally_extra:v.aspd,attack_speed_enemy:-v.aspd,attack_speed_enemy_extra:-v.aspd}});
    kits.set(unit,kit);installSourceParts(battle,unit,kit);},
});
const clemnt=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>!!unit.mem.adaptClemCenter||targets(battle,unit,unit,3,true).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit),at=unit.mem.adaptClemCenter;
    if(at){const keys=new Set(absoluteRangeKeys(CROSS,at.row,at.col,'RIGHT'));for(let i=0;i<3;i++)for(const target of enemies(battle,unit,{scope:'field',count:999,groundOnly:true})
      .filter(t=>bodyInKeys(t,keys))){
        damage(battle,unit,target,{scale:v.bomb,type:'phys',isSkill:true});
        if(target.alive)damage(battle,unit,target,{scale:v.element,type:'elemental',element:'erosion',isSkill:true});
      }return true;}
    for(const target of targets(battle,unit,unit,3,true)){
      const dealt=damage(battle,unit,target,{scale:v.scale,type:'phys',isSkill:true});
      if(target.alive&&dealt>0)damage(battle,unit,target,{amount:dealt*v.erosion,type:'element',element:'erosion',isSkill:true});
    }return true;},
  link:(battle,unit)=>observeCount(battle,unit,'elementDamage','life-decision',p=>p.element==='erosion'&&p.source?.ownerId===unit.ownerId,
    ()=>{unit.mem.adaptClemCritical=(unit.mem.adaptClemCritical??0)+1;return true;},{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{
    battle.on('hit',({source,target,dmg})=>{const v=valuesOf(unit);
      if(source===unit&&target?.side==='enemy'&&dmg.type==='phys'){
        const sure=(unit.mem.adaptClemCritical??0)>0;if(sure)unit.mem.adaptClemCritical--;
        if(sure||battle.rng()<(target.s.def<target.base.def?v.low:v.normal))dmg.amount*=v.crit;
      }
      if(target===unit&&source?.side==='enemy'&&['phys','arts'].includes(dmg.type)){
        const f=unit.fwd??[0,1];if((source.y-unit.y)*f[0]+(source.x-unit.x)*f[1]>0){
          const sea=(source.def?.tags??[]).includes('seamonster');dmg.mul*=1-(sea?v.seaProtect:v.protect);
        }
      }
    },{owner:unit,priority:45});
    battle.assaultRuntime.observe('elementBurst',sourceKey(unit,'erosion-cannon'),event=>{
      if(event.payload.element!=='erosion'||!active(unit)||event.payload.target?.side!=='enemy')return;
      const [row,col]=tileOf(event.payload.target),at={row,col};
      battle.assaultRuntime.enqueue(()=>{if(!active(unit)||(assaultAmmoState(unit)?.current??0)<=0)return;
        unit.mem.adaptClemCenter=at;try{battle.assaultRuntime.cast(unit,{extra:true,force:true,cause:event.cause});}finally{delete unit.mem.adaptClemCenter;}
      },{key:sourceKey(unit,'erosion-cannon'),targetUid:uid(event.payload.target),cause:event.cause});
    },{owner:unit});
  },
});
const demetr=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>{const keys=new Set(absoluteRangeKeys(DEMETR_SEARCH,unit.tileR,unit.tileC,unit.dir));
    return enemies(battle,unit,{scope:'field',count:999,groundOnly:true}).some(t=>bodyInKeys(t,keys));},
  cast:({battle,unit})=>{const v=valuesOf(unit),skill=selected(unit);
    nativeMarkerAction(battle,[BOND],()=>{
      skill.onStart(ctx(battle,unit));
      try{nativeBurst(battle,unit,{mods:{atkPct:v.atk},rounds:v.hits,profile:{attack:'melee',dmgType:'phys'},
        targets:()=>{const list=enemies(battle,unit,{count:1,groundOnly:true});return list;},
        afterRound:()=>{if(unit.mem.demetrS3?.retarget)skill.onTick(ctx(battle,unit));}});
      }finally{skill.onEnd(ctx(battle,unit));}
    });return true;},
  innate:(battle,unit)=>{const v=valuesOf(unit),kit=sourceKit(unit,demetrKits.char_4037_demetr,
    {'attack@demetr_s3[bonus].atk':v.atk,'attack@demetr_s3[bonus].prob':v.chance,'attack@demetr_s3[bonus].prob_atk_scale':v.crit},
    {0:{'attack@def':-v.def,'attack@def_dec_duration':v.seconds,max_add_on_scale:v.lowBonus}});
    kits.set(unit,kit);observeNativeLinkBuffs(battle,unit,'family-means',(_target,spec)=>spec.key==='talent:demetr:means'&&spec.source===unit);installSourceParts(battle,unit,kit);},
});
const ulpia=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit),skill=selected(unit);
    grantHitUses(battle,unit,unit,'anchor-hp',v.uses,{mods:{hpPct:v.hp},anyDamage:true});
    nativeMarkerAction(battle,[ANCHOR],()=>{
      // The anchor impact must see the same original ATK as the subsequent
      // original-state attacks, without installing another timed stance.
      const key=sourceKey(unit,'anchor-attack');buff(battle,unit,unit,{key,mods:{atkPct:v.atk},duration:Infinity});
      try{skill.onStart(ctx(battle,unit));nativeBurst(battle,unit,{rounds:v.hits,profile:{isSkill:true},
        targets:()=>enemies(battle,unit,{count:Math.max(1,unit.s.blockCnt),groundOnly:true})});}
      finally{skill.onEnd(ctx(battle,unit));battle.removeBuff(unit,key);}
    });return true;},
  innate:(battle,unit)=>{const v=valuesOf(unit),kit=sourceKit(unit,ulpiaKits.chess_char_5_05_a,
    {max_hp:v.hp,atk:v.atk,atk_scale:v.anchor},{1:{max_hp:v.hpGrowth,atk:v.atkGrowth,'ulpia_t_1[abyssal].max_hp':v.hpGrowth/2,'ulpia_t_1[abyssal].atk':v.atkGrowth/2}});
    observeNativeLinkBuffs(battle,unit,'bloodline',(target,spec)=>target===unit&&spec.key==='ulpia:blood');
    kits.set(unit,kit);installSourceParts(battle,unit,kit);},
});
function lions(battle,unit){return owned(battle,unit).filter(t=>t.defId===LION);}
function lionSpec(unit,count=1){const v=valuesOf(unit);return{tokenId:LION,count,stockCap:v.stock,fieldCap:v.field,placementScope:'adjacent8',preparedOnly:true,ruleKey:'golden-vows',duration:v.seconds};}
function siegeTargets(battle,unit){const friendly=battle.allyUnits.filter(t=>active(t)&&t.ownerId===unit.ownerId&&near(unit,t));
  const blocked=new Set(friendly.flatMap(t=>(t.blocking??[]).filter(active)));
  const list=enemies(battle,unit,{scope:'field',count:999}).filter(t=>bodyInKeys(t,unit.rangeKeySet)||blocked.has(t));
  sortEnemyTargets(battle,unit,list,unit.profile.priority??null);return list.slice(0,4);
}
const siege2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>hasManualInstruction(unit,LION)||siegeTargets(battle,unit).length>0||lions(battle,unit).some(t=>enemies(battle,t,{count:1}).length),
  cast:({battle,unit})=>{const v=valuesOf(unit),first=!unit.mem.adaptGoldenVows;unit.mem.adaptGoldenVows=true;
    if(first)grantSummon(battle,unit,lionSpec(unit,(unit.def.raw.assaultPiece.summonPresets??[]).filter(p=>p?.tokenId===LION).length||1));
    else if(lions(battle,unit).length< v.field)grantSummon(battle,unit,lionSpec(unit));
    deployStoredSummons(battle,unit,lionSpec(unit,v.stock));
    nativeBurst(battle,unit,{mods:{atkPct:v.scale-1},rounds:v.hits,profile:{dmgType:'true'},targets:()=>siegeTargets(battle,unit)});
    for(const token of lions(battle,unit))nativeBurst(battle,token,{rounds:v.hits,profile:{dmgType:'true'},targets:()=>enemies(battle,token,{count:1})});return true;},
  link:(battle,unit)=>{const seen=new WeakSet();battle.on('damaged',({source,target,amount})=>{
    if(!active(unit)||!active(source)||source.ownerId!==unit.ownerId||!near(unit,source)||target?.side!=='enemy'||amount<=0||seen.has(target))return;
    seen.add(target);if(target.alive){const applied=battle.applyStatus(target,'tremble',{duration:valuesOf(unit).tremble,source:unit});recordLinkEffect(battle,unit,'unbound-edge',target,!!applied);}
  },{owner:unit});},
  innate:(battle,unit)=>battle.every(.1,()=>{if(!active(unit))return;const v=valuesOf(unit),list=battle.allyUnits.filter(t=>active(t)&&t.ownerId===unit.ownerId&&near(unit,t));
    for(const target of list)buff(battle,unit,target,{key:sourceKey(unit,'kings-protection'),mods:{physTakenMul:1-v.protect},duration:.21,notify:false});
    buff(battle,unit,unit,{key:sourceKey(unit,'kings'),mods:{atkPct:v.allyATK*list.filter(t=>t!==unit).length},duration:.21,notify:false});
  },{owner:unit}),
});
const etlchi=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>targets(battle,unit,unit,3,true).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit),skill=selected(unit),rangeGrid=unit.def.raw.assaultBody.adaptation.rangeGrid;
    nativeBurst(battle,unit,{mods:{atkPct:v.scale-1},rangeGrid,rounds:v.hits,
      beforeRound:i=>{if(i===0){skill.onStart(ctx(battle,unit));battle._buildEnemyIndex();}},
      targets:()=>enemies(battle,unit,{count:999,groundOnly:true})});
    skill.onEnd(ctx(battle,unit));return true;},
  link:(battle,unit)=>observeCount(battle,unit,'elementBurst','blood-renewal',p=>p.source?.ownerId===unit.ownerId,
    ()=>heal(battle,unit,unit,{maxHpRatio:valuesOf(unit).heal}),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{const v=valuesOf(unit),kit=sourceKit(unit,etlchiKits.chess_char_5_06_a,{},
    {0:{'attack@steal_hp':v.steal,'attack@steal_hp_max':v.cap}});
    kits.set(unit,kit);installSourceParts(battle,unit,kit);},
});
const marker=id=>()=>({skill:{id:`${id}:adaptation`,kind:'passive',trigger:'NEVER',assaultCast:()=>false},trait:{noAttack:true},
  install:(battle,token)=>battle.addBuff(token,{key:'adaptation:position-marker',flags:{invulnerable:true,isolated:true},duration:Infinity,persist:true,allowDead:true})});
export const adaptationAdvancedTokenKits=Object.freeze({[BOND]:marker(BOND),[ANCHOR]:marker(ANCHOR),
  [LION]:()=>({skill:{id:`${LION}:adaptation`,kind:'passive',trigger:'NEVER',assaultCast:()=>false},trait:{dmgType:'true'}})});
export const adaptationAdvancedKits=Object.freeze({char_1039_thorn2:thorn2,char_4231_clemnt:clemnt,char_4037_demetr:demetr,
  char_4145_ulpia:ulpia,char_1019_siege2:siege2,char_4010_etlchi:etlchi});
