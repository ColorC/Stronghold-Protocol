import { adaptedKit } from '../adapted-kit.js';
import { active, buff, applyStatus, damage, uid, sp } from '../primitives.js';
import { valuesOf, ops, targets, canAttack, sourceKey, onDeploy, yours } from './adaptation-core.js';
import { observeCount } from './adaptation-pool.js';
import { withinAdjacent4, allyAura } from '../synergy.js';
import { sourceKit, installSourceParts, instantAttack, observeNativeLinkBuffs } from './adaptation-native.js';
import sntllaKits from '../../kits/ops/chess_char_5_21-sntlla.js';
import fartthKits from '../../kits/ops/chess_char_4_20-fartth.js';
import haloKits from '../../kits/ops/chess_char_6_16-halo2.js';

const kits=new WeakMap();
function withRange(battle,unit,action){const old=unit.rangeGrid,base=unit.baseRangeKeys;
  unit.rangeGrid=unit.def.raw.assaultBody.adaptation.rangeGrid;battle.refreshRange(unit);unit.baseRangeKeys=base;
  try{return action();}finally{unit.rangeGrid=old;battle.refreshRange(unit);}
}
export function apoptosisBursts(target){return target.buffs.filter(b=>b.timeLeft>0&&(b.key==='apoptosisBurst'||String(b.key).startsWith('assaultBurst:')&&String(b.key).endsWith(':dot')));}
const sntlla=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>withRange(battle,unit,()=>{const skill=kits.get(unit).skill;skill.onStart({battle,unit});
    for(let i=0;i<valuesOf(unit).hits;i++){unit.mem.iceCd=0;skill.onTick({battle,unit,dt:0});}return true;}),
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','born-in-cold',p=>['cold','frozen'].includes(p.status)&&p.source?.ownerId===unit.ownerId,
    ()=>{const list=ops(battle,unit).filter(t=>t!==unit&&withinAdjacent4(unit,t));for(const target of list)applyStatus(battle,unit,target,{status:'resist',duration:valuesOf(unit).resist});return list.length;},
    {every:valuesOf(unit).every}),
  innate:(battle,unit)=>{const v=valuesOf(unit),kit=sourceKit(unit,sntllaKits.chess_char_5_21_a,{'attack@atk_scale':v.scale,'attack@cold':v.cold},
    {0:{atk:v.atk,interval:v.delay}});kits.set(unit,kit);installSourceParts(battle,unit,kit);},
});
const fartth=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>withRange(battle,unit,()=>{const v=valuesOf(unit);for(let i=0;i<v.hits;i++)instantAttack(battle,unit,targets(battle,unit),{scale:v.scale,type:'phys',canDodge:false});return true;}),
  link:(battle,unit)=>observeCount(battle,unit,'skillResolved','concentration-help',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='SNIPER',
    ()=>sp(battle,unit,unit,valuesOf(unit).charge,'concentration-help',sourceKey(unit,'concentration-help')),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{const v=valuesOf(unit),kit=sourceKit(unit,fartthKits.chess_char_4_20_a,{damage_scale:v.far},{0:{atk:v.focus,delay:v.quiet}});
    kits.set(unit,kit);installSourceParts(battle,unit,kit);},
});
function soul(battle,unit,target){const bursts=apoptosisBursts(target);if(!bursts.length)return;
  const left=Math.max(...bursts.map(b=>b.timeLeft)),key=sourceKey(unit,'soul'),old=target.findBuff(key);
  if(old){old.timeLeft=Math.max(old.timeLeft,left);return;}
  battle.addBuff(target,{key,duration:left,interval:1,source:unit,onTick:()=>{
    if(target.alive&&apoptosisBursts(target).length)damage(battle,unit,target,{scale:valuesOf(unit).soul,type:'elemental',element:'apoptosis'});
  }});
}
const nymph=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>withRange(battle,unit,()=>{const v=valuesOf(unit);for(let i=0;i<v.hits;i++)instantAttack(battle,unit,targets(battle,unit),{scale:v.scale,type:'arts'});return true;}),
  link:(battle,unit)=>battle.assaultRuntime.observe('elementBurst',sourceKey(unit,'mind-key'),({payload:p})=>{
    if(!active(unit)||p.element!=='apoptosis'||!targets(battle,unit,unit,999).includes(p.target))return;
    const v=valuesOf(unit);unit.mem.adaptMindKey=Math.min(v.cap,(unit.mem.adaptMindKey??0)+1);
    buff(battle,unit,unit,{key:sourceKey(unit,'mind-key'),mods:{atkPct:v.growth*unit.mem.adaptMindKey},duration:Infinity,persist:true});
  },{owner:unit}),
  innate:(battle,unit)=>{
    observeNativeLinkBuffs(battle,unit,'mind-key',(target,spec)=>target===unit&&spec.key===sourceKey(unit,'mind-key'));
    battle.on('hit',({source,target,dmg})=>{if(source===unit&&unit.skill.active&&dmg.isAttack&&apoptosisBursts(target).length){dmg.type='elemental';dmg.element='apoptosis';dmg.canDodge=false;}},{owner:unit,priority:-10});
    battle.on('damaged',({source,target,dmg,amount})=>{if(source===unit&&target.side==='enemy'&&target.alive&&amount>0&&dmg?.isAttack)soul(battle,unit,target);},{owner:unit});
  },
});
const halo2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>withRange(battle,unit,()=>{const v=valuesOf(unit),skill=kits.get(unit).skill;skill.onStart({battle,unit});
    try{for(let i=0;i<v.hits;i++)instantAttack(battle,unit,targets(battle,unit),{scale:v.scale,type:'arts',
      onHit:target=>{const status=unit.profile.onHitStatus;if(status)applyStatus(battle,unit,target,{status:status.key,duration:status.duration});}});
    }finally{skill.onEnd({battle,unit});}return true;}),
  innate:(battle,unit)=>{observeNativeLinkBuffs(battle,unit,'data-model',(target,spec)=>target===unit&&spec.key==='halo2:model');
    const v=valuesOf(unit),kit=sourceKit(unit,haloKits.chess_char_6_16_a,{'attack@atk_share':v.share},
    {0:{attack_speed:v.aspd,max_stack_cnt:v.cap},1:{'halo2_t_1[weak].damage_scale':1+v.fragile,'halo2_t_1[weak].interval':v.stay,
      'halo2_t_1[weak].damage_scale_max':1+v.fragile+v.extra}});kits.set(unit,kit);installSourceParts(battle,unit,kit);},
});
export const adaptationPrecisionKits=Object.freeze({char_341_sntlla:sntlla,char_430_fartth:fartth,char_4146_nymph:nymph,char_1047_halo2:halo2});
