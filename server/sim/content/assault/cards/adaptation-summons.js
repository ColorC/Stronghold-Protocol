import { adaptedKit } from '../adapted-kit.js';
import { battleState } from '../adaptation-primitives.js';
import { active, enemies, buff, damage, heal, applyStatus, sp, uid, tileOf } from '../primitives.js';
import { enemyAura, withinAdjacent4 } from '../synergy.js';
import { grantSummon, deployStoredSummons, deployPreparedSummons, ledgerFor } from '../summons.js';
import { valuesOf, yours, ops, owned, targets, sourceKey, onDeploy, tagged, link } from './adaptation-core.js';
import { observeCount } from './adaptation-pool.js';
import { grantHitUses } from './adaptation-support.js';
import { bodyOnTile, bodyInKeys } from '../../../body.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { hasManualInstruction } from './adaptation-native.js';

export const MANUAL_TOKENS=Object.freeze({robin:'token_10013_robin_mine',doroth:'token_10025_doroth_recttp',
  kazema:'token_10022_kazema_shadow',beewax:'token_10011_beewax_oblisk',vodfox:'token_10006_vodfox_doll',
  cathy:'token_10041_cathy_catsld',toledo:'token_10067_toledo_tldptm',nearl2:'token_10019_nearl2_sword'});
const ID=MANUAL_TOKENS;
function areaKeys(at,crossOnly=false){const[r,c]=tileOf(at),keys=new Set();
 for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++)
  if(crossOnly?(dr===0||dc===0)&&Math.abs(dr+dc)<=2:Math.max(Math.abs(dr),Math.abs(dc))<=1)keys.add((r+dr)*21+c+dc);
 return keys;
}
const nearby=(a,b)=>b.side==='enemy'?bodyInKeys(b,areaKeys(a)):Math.max(Math.abs(a.tileR-b.tileR),Math.abs(a.tileC-b.tileC))<=1;
const cross=(a,b)=>a.tileR===b.tileR&&Math.abs(a.tileC-b.tileC)<=2||a.tileC===b.tileC&&Math.abs(a.tileR-b.tileR)<=2;
const tokens=(battle,unit,id)=>owned(battle,unit).filter(t=>t.defId===id);
function spec(unit,id,count=1){const v=valuesOf(unit),manual=unit.def.raw.assaultBody.adaptation.manualSummons.find(e=>e.tokenId===id);
  return {tokenId:id,count,stockCap:v.stock,fieldCap:v.field,preparedOnly:true,placementScope:manual.scope??null,
    ruleKey:`adaptation:${unit.def.charId}`,...([ID.robin,ID.doroth].includes(id)?{cost:3,deploymentInterval:5,avoidGroundEnemy:true}:{}),
    ...(Number.isFinite(v.seconds)?{duration:v.seconds}:{} )};}
const held=(battle,unit,id)=>ledgerFor(battle,unit).stock.get(id)??0;
function supply(battle,unit,id){deployStoredSummons(battle,unit,spec(unit,id,valuesOf(unit).stock));return grantSummon(battle,unit,spec(unit,id));}
function initial(battle,unit,id){onDeploy(battle,unit,`manual-stock:${id}`,()=>{
  const first=!unit.mem.adaptManualInitial;unit.mem.adaptManualInitial=true;
  const slots=(unit.def.raw.assaultPiece.summonPresets??[]).filter(p=>p?.tokenId===id);
  const free=first?slots.length:id===ID.doroth?Math.min(2,slots.length):0;
  if(free)deployPreparedSummons(battle,unit,spec(unit,id,free));
  const v=valuesOf(unit),wanted=v.initial??v.stock,missing=Math.max(0,wanted-held(battle,unit,id));
  if(missing)grantSummon(battle,unit,spec(unit,id,missing));
});}
function area(battle,owner,at,{groundOnly=false,crossOnly=false}={}){
  const keys=areaKeys(at,crossOnly);
  return enemies(battle,owner,{scope:'field',groundOnly,count:999}).filter(t=>bodyInKeys(t,keys));
}
function blast(battle,owner,at,scale,type,status,duration,atk=owner.s.atk){
  for(const target of area(battle,owner,at)){
    damage(battle,owner,target,{amount:atk*scale,type,isSkill:true});
    if(target.alive&&status)applyStatus(battle,owner,target,{status,duration});
  }
}
function actionWithSummon(battle,unit,id,action){const before=new Set(tokens(battle,unit,id));
  if(!before.size&&held(battle,unit,id)<valuesOf(unit).stock)supply(battle,unit,id);
  else deployStoredSummons(battle,unit,spec(unit,id,valuesOf(unit).stock));
  for(const token of before)if(active(token))action(token);
}
const robin=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>held(battle,unit,ID.robin)<valuesOf(unit).stock,
  cast:({battle,unit})=>{supply(battle,unit,ID.robin);return true;},
  innate:(battle,unit)=>initial(battle,unit,ID.robin),
  link:(battle,unit)=>observeCount(battle,unit,'deviceTrigger','clip-expert',p=>p.ownerId===unit.ownerId&&p.source!==unit,
    ()=>supply(battle,unit,ID.robin).granted,{every:valuesOf(unit).every}),
});
const doroth=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>held(battle,unit,ID.doroth)<valuesOf(unit).stock,
  cast:({battle,unit})=>{supply(battle,unit,ID.doroth);return true;},
  innate:(battle,unit)=>initial(battle,unit,ID.doroth),
  link:(battle,unit)=>link(battle,unit,'deviceTrigger','dreamer',p=>p.ownerId===unit.ownerId,()=>{
    const v=valuesOf(unit),before=unit.mem.adaptDreamer??0;if(before>=v.cap)return false;
    unit.mem.adaptDreamer=before+1;buff(battle,unit,unit,{key:sourceKey(unit,'dreamer'),mods:{atkFinal:1+v.growth*(before+1)},duration:Infinity,persist:true});return true;
  },{first:valuesOf(unit).cap}),
});
function origami(battle,unit,at,scale){blast(battle,unit,at,scale,'arts',null,null,at.s.atk);}
const kazema=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>hasManualInstruction(unit,ID.kazema)||targets(battle,unit).length>0||tokens(battle,unit,ID.kazema).some(t=>enemies(battle,t,{count:1}).length),
  cast:({battle,unit})=>{const v=valuesOf(unit);battle.loseHp(unit,unit.hp*v.loss,{source:unit});
    actionWithSummon(battle,unit,ID.kazema,()=>{});
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'phys',isSkill:true});
    for(const token of tokens(battle,unit,ID.kazema))for(const target of enemies(battle,token,{count:1}))
      damage(battle,token,target,{scale:1,hits:v.hits,type:'phys',isSkill:true});return true;},
  link:(battle,unit)=>observeCount(battle,unit,'summonEntered','paper-neighbours',p=>p.source?.ownerId===unit.ownerId&&p.source!==unit,
    ()=>{for(const token of tokens(battle,unit,ID.kazema))origami(battle,unit,token,valuesOf(unit).origami/2);return true;}),
  innate:(battle,unit)=>battle.on('dollSwap',p=>{if(p.unit!==unit)return;
    const key=sourceKey(unit,'native-doll');if(p.form!=='doll'){battle.removeBuff(unit,key);return;}
    const stats=battle.tokenDef(ID.kazema,unit).stats;
    buff(battle,unit,unit,{key,mods:{atkFlat:stats.atk-unit.base.atk,defFlat:stats.def-unit.base.def},duration:Infinity});
    origami(battle,unit,unit,valuesOf(unit).origami);
  },{owner:unit}),
});
function obelisk(battle,unit,token){const v=valuesOf(unit);blast(battle,unit,token,v.scale,'arts','stun',v.stun);}
const beewax=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>hasManualInstruction(unit,ID.beewax)||tokens(battle,unit,ID.beewax).some(t=>area(battle,unit,t).length),
  cast:({battle,unit})=>{actionWithSummon(battle,unit,ID.beewax,t=>obelisk(battle,unit,t));return true;},
  link:(battle,unit)=>observeCount(battle,unit,'blocked','sand-shelter',p=>p.source?.ownerUnit===unit&&p.source.defId===ID.beewax,
    ({payload})=>{let n=0;for(const other of ops(battle,unit).filter(t=>t.def.profession==='CASTER'&&nearby(payload.source,t)))
      n+=sp(battle,unit,other,valuesOf(unit).charge,'sand-shelter',sourceKey(unit,'sand-shelter'));return n;},{every:valuesOf(unit).every}),
  innate:(battle,unit)=>battle.every(1,()=>{if(active(unit)&&!unit.skill.active)heal(battle,unit,unit,{maxHpRatio:valuesOf(unit).regen,regen:true});},{owner:unit}),
});
const vodfox=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>held(battle,unit,ID.vodfox)<valuesOf(unit).stock,
  cast:({battle,unit})=>{supply(battle,unit,ID.vodfox);return true;},
  link:(battle,unit)=>enemyAura(battle,unit,{key:'defeat-hint',mods:{dmgTakenMul:1+valuesOf(unit).fragile},
    select:t=>t.hp/t.s.maxHp<valuesOf(unit).threshold&&targets(battle,unit,unit,999).includes(t)}),
});
const CATHY_SHIELD='adaptation:cathy:shield';
function catGive(battle,owner,token,ratio){const target=token.mem.adaptCatTarget;if(!active(target))return 0;
  const old=target.findBuff(CATHY_SHIELD)?.shield??0,cap=owner.s.maxHp*valuesOf(owner).cap,amount=Math.min(cap,old+owner.s.maxHp*ratio);
  if(amount<=old)return 0;const entry=battle.addBuff(target,{key:CATHY_SHIELD,shield:amount,duration:Infinity,source:owner,visible:true});
  (owner.mem.adaptCatShields??=new Map()).set(target,entry);return amount-old;
}
const cathy=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>!unit.mem.assaultBattleStates?.['cathy-forge']||hasManualInstruction(unit,ID.cathy)||tokens(battle,unit,ID.cathy).some(t=>active(t.mem.adaptCatTarget)),
  cast:({battle,unit})=>{const v=valuesOf(unit);battleState(battle,unit,'cathy-forge',{mods:{hpPct:v.hp,defPct:v.def},
    enter:()=>{unit.profile.noAttack=true;}});supply(battle,unit,ID.cathy);
    for(const token of tokens(battle,unit,ID.cathy))catGive(battle,unit,token,v.refill);return true;},
  innate:(battle,unit)=>initial(battle,unit,ID.cathy),
  link:(battle,unit)=>{const consumed=new WeakSet();observeCount(battle,unit,'shieldBroken','signal-return',p=>{
    const entry=unit.mem.adaptCatShields?.get(p.target);
    if(p.shieldKind!=='hp'||!entry||entry.shield>0||consumed.has(entry))return false;
    consumed.add(entry);return true;
  },({payload})=>sp(battle,unit,payload.target,valuesOf(unit).charge,'signal-return',sourceKey(unit,'signal-return')));},
});
function legend(battle,unit,token){const v=valuesOf(unit);unit.mem.adaptLegendUntil=battle.time+v.seconds;
  for(const target of area(battle,unit,token,{groundOnly:true}))applyStatus(battle,unit,target,{status:'tremble',duration:v.tremble});
}
const toledo=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>hasManualInstruction(unit,ID.toledo)||tokens(battle,unit,ID.toledo).length>0,
  cast:({battle,unit})=>{actionWithSummon(battle,unit,ID.toledo,t=>legend(battle,unit,t));return true;},
  link:(battle,unit)=>{const key=sourceKey(unit,'bloodline');battle.every(.1,()=>{if(!active(unit))return;
    const v=valuesOf(unit),mul=1+v.fragile*(unit.mem.adaptLegendUntil>battle.time?2:1);
    for(const target of targets(battle,unit,unit,999).filter(t=>t.blockedBy))buff(battle,unit,target,{key,mods:{dmgTakenMul:mul},duration:.21,notify:false});
  },{owner:unit});},
});
function sun(battle,unit,token){const v=valuesOf(unit);blast(battle,unit,token,v.sun,'true','stun',v.stun);}
const nearl2=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle,unit})=>{const v=valuesOf(unit);actionWithSummon(battle,unit,ID.nearl2,t=>sun(battle,unit,t));
    grantHitUses(battle,unit,unit,'radiant-defence',v.uses,{mods:{defPct:v.def},anyDamage:true});
    for(const target of targets(battle,unit)){const type=target.blockedBy===unit||target.blockedBy?.ownerUnit===unit&&target.blockedBy.defId===ID.nearl2?'true':'phys';
      damage(battle,unit,target,{scale:v.scale,hits:v.hits,type,isSkill:true});}return true;},
  link:(battle,unit)=>{let last=null;const records=new Map();
    battle.assaultRuntime.observe('deployed',sourceKey(unit,'previous-knight'),event=>{const target=event.payload.target;if(!yours(unit,target))return;
      const previous=last;last=target;if(target!==unit)return;
      const key=`${event.payload.deploySeq}:${battle.time}`;if(records.has(key))return;records.set(key,true);
      const kaz=previous&&tagged(previous,'卡西米尔');
      const v=valuesOf(unit),keys=new Set([[0,0],[-1,0],[1,0],[0,-1],[0,1]].map(([r,c])=>(unit.tileR+r)*21+unit.tileC+c));
      for(let i=0;i<(kaz?2:1);i++)for(const foe of enemies(battle,unit,{scope:'field',count:999}).filter(t=>bodyInKeys(t,keys))){
        damage(battle,unit,foe,{scale:v.deploy,type:'true'});if(foe.alive)applyStatus(battle,unit,foe,{status:'stun',duration:v.stun});}
    },{owner:unit});},
  innate:(battle,unit)=>battle.on('hit',({source,dmg})=>{if(source===unit)dmg.defIgnorePct=Math.max(dmg.defIgnorePct??0,valuesOf(unit).ignore);},{owner:unit,priority:45}),
});

function passiveToken(id,install,{noAttack=true}={}){return()=>({trait:{noAttack},
  skill:{id:`${id}:adaptation`,kind:'passive',trigger:'NEVER',assaultCast:()=>false},install});}
function born(battle,token,effect){battle.on('deploy',({unit})=>{if(unit===token)effect();},{owner:token});}
function trapInstall(battle,token){const owner=token.ownerUnit,id=token.defId;
  token.mem.adaptTrapFire=()=>{if(!active(token)||token.mem.adaptTrapSpent||!active(owner))return;
    token.mem.adaptTrapSpent=true;const v=valuesOf(owner);
    const foes=area(battle,owner,token,{groundOnly:true,crossOnly:id===ID.doroth});
    const selected=id===ID.robin?foes.filter(t=>bodyOnTile(t,token.tileR,token.tileC)).slice(0,1):foes;
    for(const target of selected){damage(battle,owner,target,{scale:v.scale,type:id===ID.robin?'phys':'arts',isSkill:true});
      if(!target.alive)continue;if(id===ID.robin)battle.push(target,v.force,{from:owner});
      else applyStatus(battle,owner,target,{status:'sluggish',duration:v.slow});}
    if(id===ID.doroth)for(const other of tokens(battle,owner,id).filter(t=>t!==token&&cross(token,t)&&!t.mem.adaptTrapQueued)){
      other.mem.adaptTrapQueued=true;battle.after(v.chain,()=>other.mem.adaptTrapFire?.(),{owner:other});}
    battle.emit('deviceTrigger',{source:owner,target:selected[0]??null,device:token});
    battle.fx('trapBlast',{id:token.id,x:token.x,y:token.y,consumed:true});
    battle.retreat(token,{reason:'trapTriggered',permanent:true});
  };
  battle.every(.1,()=>{if(active(token)&&enemies(battle,owner,{scope:'field',groundOnly:true,count:999}).some(e=>bodyOnTile(e,token.tileR,token.tileC)))
    token.mem.adaptTrapFire();},{owner:token});
}
function catInstall(battle,token){const owner=token.ownerUnit,holders=battle.adaptCatHolders??=new Map();
  const connect=()=>{const previous=token.mem.adaptCatTarget;if(previous&&holders.get(previous)===token)holders.delete(previous);
    token.mem.adaptCatTarget=null;
    const keys=absoluteRangeKeys(token.def.rangeGrid,token.tileR,token.tileC,token.dir);
    const target=ops(battle,owner).find(t=>keys.includes(t.tileR*21+t.tileC)&&(!active(holders.get(t))||holders.get(t)===token));
    if(target){holders.set(target,token);token.mem.adaptCatTarget=target;catGive(battle,owner,token,valuesOf(owner).cap);}
  };
  born(battle,token,connect);
  battle.every(1,()=>{if(!active(token))return;const target=token.mem.adaptCatTarget;if(!active(target)){connect();return;}
    if(owner.mem.assaultBattleStates?.['cathy-forge']||battle.time-target.lastHitAt>=valuesOf(owner).idle)
      catGive(battle,owner,token,valuesOf(owner).refill);
  },{owner:token});
  battle.on('death',({unit})=>{if(unit===token&&holders.get(token.mem.adaptCatTarget)===token)holders.delete(token.mem.adaptCatTarget);},{owner:token});
}
function dollInstall(battle,token){enemyAura(battle,token,{key:'curse-doll',
  mods:{atkPct:-valuesOf(token.ownerUnit).down,defMul:1-valuesOf(token.ownerUnit).down},select:e=>nearby(token,e)});
  battle.on('death',({unit})=>{if(unit===token)for(const enemy of battle.enemies)
    battle.removeBuff(enemy,`assault:enemyAura:${uid(token)}:curse-doll`);},{owner:token});
}
export const adaptationManualTokenKits=Object.freeze({
  [ID.robin]:passiveToken(ID.robin,trapInstall),[ID.doroth]:passiveToken(ID.doroth,trapInstall),
  [ID.kazema]:passiveToken(ID.kazema,(b,t)=>born(b,t,()=>origami(b,t.ownerUnit,t,valuesOf(t.ownerUnit).origami)),{noAttack:false}),
  [ID.beewax]:passiveToken(ID.beewax,(b,t)=>born(b,t,()=>obelisk(b,t.ownerUnit,t))),
  [ID.vodfox]:passiveToken(ID.vodfox,dollInstall),
  [ID.cathy]:passiveToken(ID.cathy,catInstall),
  [ID.toledo]:passiveToken(ID.toledo,(b,t)=>born(b,t,()=>legend(b,t.ownerUnit,t))),
  [ID.nearl2]:passiveToken(ID.nearl2,(b,t)=>born(b,t,()=>sun(b,t.ownerUnit,t))),
});
export const adaptationSummonKits=Object.freeze({char_451_robin:robin,char_4048_doroth:doroth,char_4016_kazema:kazema,
  char_344_beewax:beewax,char_254_vodfox:vodfox,char_4162_cathy:cathy,char_393_toledo:toledo,char_1014_nearl2:nearl2});
