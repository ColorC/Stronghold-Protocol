import { adaptedKit } from '../adapted-kit.js';
import { active, enemies, buff, damage, sp } from '../primitives.js';
import { valuesOf, ops, targets, canAttack, sourceKey, tagged, yours } from './adaptation-core.js';
import { observeCount } from './adaptation-pool.js';
import { sourceKit, installSourceParts, instantAttack } from './adaptation-native.js';
import { fillCastAmmo, countedTrigger, recordLinkEffect } from '../adaptation-primitives.js';
import sbellKits from '../../kits/ops/chess_char_6_02-sbell2.js';
import whitwKits from '../../kits/ops/chess_char_6_18-whitw2.js';
import blazeKits from '../../kits/ops/chess_char_5_03-blaze2.js';
import rmixerKits from '../../kits/ops/chess_char_4_01-rmixer.js';

const originals=new WeakMap();
function inSkillRange(battle,unit,action){const grid=unit.rangeGrid;unit.rangeGrid=unit.def.raw.assaultBody.adaptation.rangeGrid;battle.refreshRange(unit);
  try{return action();}finally{unit.rangeGrid=grid;battle.refreshRange(unit);}
}
const burnBurst=target=>target.buffs.some(b=>b.timeLeft>0&&(b.key==='burnBurst'||String(b.key).startsWith('assaultBurst:')&&String(b.key).endsWith(':res')));
const sbell2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>inSkillRange(battle,unit,()=>{const v=valuesOf(unit),skill=originals.get(unit).skill;
    const key=sourceKey(unit,'res-penetration');buff(battle,unit,unit,{key,mods:{resIgnoreFlat:v.ignore},duration:Infinity});
    try{skill.onStart({battle,unit});
      for(const cell of unit.rangeKeys)if(battle.grid.groundPassable(Math.floor(cell/21),cell%21,true))unit.mem.snow.set(cell,Math.min(5,(unit.mem.snow.get(cell)??0)+v.snow));
      for(let i=0;i<v.hits;i++)instantAttack(battle,unit,targets(battle,unit),{scale:v.scale,type:'arts'});
    }finally{battle.removeBuff(unit,key);}return true;}),
  link:(battle,unit)=>observeCount(battle,unit,'statusApplied','mountain-blessing',p=>p.status==='frozen'&&p.source?.ownerId===unit.ownerId&&p.source!==unit,
    ()=>{unit.mem.adaptBlessings=(unit.mem.adaptBlessings??0)+1;return true;},{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{const v=valuesOf(unit),kit=sourceKit(unit,sbellKits.chess_char_6_02_a,{attract_time:v.attract},{1:{cold:v.cold}});
    originals.set(unit,kit);installSourceParts(battle,unit,kit);
    battle.on('fatal',ctx=>{if(ctx.unit===unit&&!ctx.prevented&&unit.mem.blessUsed&&unit.mem.adaptBlessings>0){unit.mem.adaptBlessings--;unit.mem.blessUsed=false;}},{owner:unit,priority:-40});
  },
});
const whitw2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>enemies(battle,unit,{scope:'field',count:1}).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit),skill=originals.get(unit).skill,key=sourceKey(unit,'hunt-attack');
    buff(battle,unit,unit,{key,mods:{atkPct:v.atk},duration:Infinity});skill.onStart({battle,unit});
    // Compress the native deterministic flight/target/attack process, without
    // advancing the battle clock, enemies, cooldowns or growth timers.
    try{for(let step=0;step<v.seconds*4&&active(unit);step++)skill.onTick({battle,unit,dt:.25});}
    finally{skill.onEnd({battle,unit});battle.removeBuff(unit,key);}return true;},
  innate:(battle,unit)=>{const v=valuesOf(unit),kit=sourceKit(unit,whitwKits.chess_char_6_18_a,
    {'attack@magic_atk_scale':v.area,'attack@fear':v.fear,'attack@move_speed':-v.slow},{0:{interval:v.stage}});
    originals.set(unit,kit);installSourceParts(battle,unit,kit,{talents:false});kit.talents[0].install(battle,unit);
    const teams=battle.adaptSiracusaOpening??=new Map();let team=teams.get(unit.ownerId);
    if(!team){team={source:unit};teams.set(unit.ownerId,team);
      battle.assaultRuntime.observe('deployed',`adaptation:siracusa-opening:${unit.ownerId}`,({payload:p})=>{
        if(yours(unit,p.target)&&tagged(p.target,'叙拉古'))sp(battle,team.source,p.target,5,'siracusa-opening',sourceKey(team.source,'siracusa-opening'));
      });
    }
  },
});
const blaze2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:ctx=>!ctx.unit.mem.downed&&canAttack(ctx),
  cast:({battle,unit})=>{const v=valuesOf(unit);battle.loseHp(unit,unit.s.maxHp*v.loss,{source:unit});
    for(let i=0;i<v.hits&&active(unit)&&!unit.mem.downed;i++){
      const [target]=targets(battle,unit);if(!target)break;
      const list=enemies(battle,unit,{scope:'field',count:999}).filter(e=>(e.x-target.x)*(e.x-target.x)+(e.y-target.y)*(e.y-target.y)<=v.radius*v.radius);
      for(const enemy of list)if(burnBurst(enemy))damage(battle,unit,enemy,{scale:v.scale*v.extra,type:'elemental',element:'burn',isSkill:true});
      instantAttack(battle,unit,list,{scale:v.scale,type:'arts'});battle.fx('splash',{x:target.x,y:target.y,id:target.id,src:unit.id,r:v.radius,element:'burn'});
    }return true;},
  link:(battle,unit)=>battle.assaultRuntime.observe('elementBurst',sourceKey(unit,'melt-reload'),({payload})=>{
    if(active(unit)&&payload.element==='burn'&&payload.target?.side==='enemy')fillCastAmmo(battle,unit,unit,sourceKey(unit,'melt-reload'));
  },{owner:unit}),
  innate:(battle,unit)=>{const v=valuesOf(unit),kit=sourceKit(unit,blazeKits.chess_char_5_03_a,{}, {0:{ep_damage_scale:v.melt}});
    originals.set(unit,kit);installSourceParts(battle,unit,kit,{install:false});
    battle.on('damaged',p=>{if(p.source===unit&&p.amount>0&&p.dmg?.tags?.includes('blazeMelt'))recordLinkEffect(battle,unit,'melting-point',p.target);},{owner:unit});},
});
function counterSync(battle,unit){const queue=unit.mem.adaptSermon??[],key=sourceKey(unit,'sermon-guard');
  if(queue.length){const v=queue[0];buff(battle,unit,unit,{key,mods:{hpPct:v.hp,defPct:v.guard},duration:Infinity});unit.profile.noAttack=true;}
  else{battle.removeBuff(unit,key);unit.profile.noAttack=unit.mem.adaptSermonNoAttack??false;}
}
const rmixer=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit),queue=unit.mem.adaptSermon??=[];
    if(!queue.length)unit.mem.adaptSermonNoAttack=unit.profile.noAttack;
    for(let i=0;i<v.uses;i++)queue.push({...v});counterSync(battle,unit);
    for(const target of ops(battle,unit).filter(t=>t!==unit&&tagged(t,'拉特兰')))fillCastAmmo(battle,unit,target,sourceKey(unit,'sermon-reload'));
    return true;},
  innate:(battle,unit)=>{const v=valuesOf(unit),kit=sourceKit(unit,rmixerKits.chess_char_4_01_a,{}, {0:{def:v.def,attack_speed:v.aspd}});
    installSourceParts(battle,unit,kit,{install:false});
    const take=countedTrigger(battle,{key:sourceKey(unit,'sermon-counter'),owner:unit},()=>{
      const value=unit.mem.adaptSermon?.shift();if(!value)return false;
      const list=targets(battle,unit);unit.mem.inCounter=true;
      try{if(list.length)instantAttack(battle,unit,list,{scale:value.scale,type:'phys'});}
      finally{unit.mem.inCounter=false;counterSync(battle,unit);}return true;
    });
    battle.on('damaged',ctx=>{if(ctx.target!==unit||!unit.canAct||unit.s.flags.disarm||ctx.type==='element'||ctx.dmg?.tags?.includes('hpLoss')||!ctx.dmg||!unit.mem.adaptSermon?.length)return;
      take({target:unit,cause:battle.assaultRuntime.currentCause});
    },{owner:unit});
  },
});
export const adaptationLateKits=Object.freeze({char_1046_sbell2:sbell2,char_1038_whitw2:whitw2,char_1040_blaze2:blaze2,char_4194_rmixer:rmixer});
