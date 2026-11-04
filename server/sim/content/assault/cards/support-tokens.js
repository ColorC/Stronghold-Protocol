import { allies, heal, buff, damage, active, uid } from '../primitives.js';
import { absoluteRangeKeys } from '../../../targeting.js';
const DRONE_BLAST_GRID=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const enemiesForDrone=(battle,unit)=>battle.enemiesInKeys(absoluteRangeKeys(DRONE_BLAST_GRID,unit.tileR,unit.tileC,unit.dir),unit,{...unit.profile,canHitFly:true});
import { supportPlans } from './support-plans.js';
import { TICK } from '../../../constants.js';
import { resolveProfile } from '../../../professions.js';

const ids=['token_10000_silent_healrb','token_10028_vigil_wolf','token_10030_mlyss_wtrman','token_10050_monstr_prosts','token_10032_jesca2_jckshd'];
const around=(battle,unit)=>allies(battle,unit,{scope:'adjacent8',priority:'hp',count:99}).filter(target=>target.ownerId===unit.ownerId);
function kitFor(tokenId){return (_battle,_raw,_def)=>({skill:{kind:'passive',onStart(){}},install(battle,unit){
  const owner=unit.ownerUnit;
  if(!owner)throw new Error(`${tokenId} requires a real ownerUnit`);
  const ownerPiece=owner.input_piece??owner.inputPiece??owner.def?.raw?.assaultPiece??{};
  if((tokenId==='token_10028_vigil_wolf'||tokenId==='token_10030_mlyss_wtrman')&&owner.profile?.sub==='tactician'){
    const link=()=>{if(active(unit)&&active(owner))owner.trait.reinforcement=unit;};
    battle.on('deploy',event=>{const ctx=event.payload??event;if(ctx.unit===unit)link();},{owner:unit});
    battle.on('death',event=>{const ctx=event.payload??event;if(ctx.unit!==unit||owner.trait.reinforcement!==unit)return;owner.trait.reinforcement=battle.allyUnits.filter(x=>x!==unit&&x.kind==='token'&&x.ownerUnit===owner&&x.defId===tokenId&&active(x)).sort((a,b)=>b.deploySeq-a.deploySeq)[0]??null;},{owner});
    battle.on('retreating',event=>{const ctx=event.payload??event;if(ctx.unit!==unit||owner.trait.reinforcement!==unit)return;owner.trait.reinforcement=battle.allyUnits.filter(x=>x!==unit&&x.kind==='token'&&x.ownerUnit===owner&&x.defId===tokenId&&active(x)).sort((a,b)=>b.deploySeq-a.deploySeq)[0]??null;},{owner});
  }
  if(tokenId==='token_10000_silent_healrb'){

    const params=supportPlans.char_108_silent.skill.effects.find(e=>e.action==='summon').params,index=Math.max(0,Math.min(3,(ownerPiece.star??1)-1));
    const duration=params.duration[index],healScale=params.healScale[index],module=owner.assaultSupportModules?.has('uniequip_002_silent')===true;
    unit.profile={...unit.profile,noAttack:true};
    // 紧急防卫程序 no longer widens the drone's healing range (removed); only the exit blast remains.
    battle.refreshRange(unit);
    const healingKey=`assault:silent:drone-healing:${uid(unit)}`;let destroyed=false;
    const clearBonus=()=>{for(const ally of battle.allyUnits)battle.removeBuff(ally,healingKey);};
    const refresh=()=>{for(const ally of battle.allyUnits){if(index===3&&active(unit)&&active(owner)&&active(ally)&&ally.tileR===unit.tileR&&ally.tileC===unit.tileC&&battle.allySelectable(ally,unit))buff(battle,unit,ally,{key:healingKey,mods:{healingTakenMul:1.1},duration:1.5*TICK,stacking:'replace'});else battle.removeBuff(ally,healingKey);}};
    const healTimer=battle.every(1,()=>{if(!active(unit)||!active(owner))return;for(const target of allies(battle,unit,{scope:'range',count:99}).filter(t=>battle.allySelectable(t,unit)&&t.hp<t.s.maxHp))heal(battle,unit,target,{amount:owner.s.atk*healScale});},{owner:unit});
    const auraTimer=battle.every(TICK,refresh,{owner:unit,immediate:true});
    const life=battle.after(duration,()=>{if(unit.alive)battle.retreat(unit,{reason:'expired',permanent:true});},{owner:unit});
    const clear=()=>{healTimer.cancel();auraTimer.cancel();life.cancel();clearBonus();};
    battle.on('retreating',event=>{if(event.unit===unit)clear();if(event.unit===owner&&active(unit))battle.retreat(unit,{reason:'ownerRemoved',permanent:true});},{owner:unit});
    battle.on('death',event=>{if(event.unit!==unit)return;clear();if(destroyed)return;destroyed=true;if(!module||!active(owner)||['ownerRemoved','ownerDeath','retreat'].includes(event.reason))return;for(const target of enemiesForDrone(battle,unit))damage(battle,owner,target,{amount:owner.s.atk*Number(owner.def?.raw?.assaultBody?.bazaar?.modules?.uniequip_002_silent?.params?.a?.[index])/100,type:'arts',sourceKey:'assault:module:uniequip_002_silent:droneDeath'});},{owner:unit});
    battle.on('deploy',event=>{if(event.unit===unit)refresh();},{owner:unit});
    refresh();
  } else if(tokenId==='token_10028_vigil_wolf'){
    battle.on('attack',({attacker,targets})=>{if(attacker!==unit||!active(unit))return;for(const target of targets)damage(battle,unit,target,{scale:0.2,type:'phys',sourceKey:`wolf:${uid(unit)}`});},{owner:unit});
  } else if(tokenId==='token_10030_mlyss_wtrman'){
    // Assault explicitly selects owned, off-board damage operators from the prepared DTO.
    // Templates are normalized data only: no template Unit, KIT or passive is installed.
    const ordinaryProfile={...unit.profile};
    const asTemplate=(id,record)=>{
      const piece=record?.assaultPiece;
      if(record?.assaultOwnerId!==owner.ownerId||!piece||piece.uid===uid(owner)||typeof piece.charId!=='string'||!piece.charId.startsWith('char_')||piece.row!==null||piece.col!==null)return null;
      const def=battle.data.getChess(id),profile=def&&resolveProfile(def,null);
      if(!def||!profile||profile.noAttack||profile.noAttackUnlessSkill||!['melee','ranged'].includes(profile.attack)||!['phys','arts','true'].includes(profile.dmgType))return null;
      return {uid:piece.uid,def,profile,stats:def.stats,rangeGrid:def.rangeGrid};
    };
    const selectTemplate=()=>Object.keys(battle.data.raw?.chess??{}).map(id=>asTemplate(id,battle.data.rawChess(id))).filter(Boolean)
      .sort((a,b)=>(b.stats.atk-a.stats.atk)||(b.stats.maxHp-a.stats.maxHp)||String(a.uid).localeCompare(String(b.uid)))[0]
      ??{uid:uid(owner),def:owner.def,profile:resolveProfile(owner.def,null),stats:owner.def.stats,rangeGrid:owner.def.rangeGrid};
    const copyTemplate=(initial=false)=>{
      const template=selectTemplate(),ratio=initial?1:Math.max(0,Math.min(1,unit.hp/unit.s.maxHp)),factor=0.9*(owner.assaultSupportModules?.has('uniequip_002_mlyss')?1.15:1);
      unit._mlyssTemplateUid=template.uid;
      for(const stat of ['maxHp','atk','def','res','blockCnt','bat','aspd'])if(Number.isFinite(template.stats[stat]))unit.base[stat]=template.stats[stat]*(['maxHp','atk','def','res'].includes(stat)?factor:1);
      const ranged=template.def.position==='RANGED';
      unit.profile={...ordinaryProfile,attack:ranged?'ranged':'melee',projectile:ranged?'bolt':'none',canHitFly:ranged||template.profile.canHitFly===true,dmgType:template.profile.dmgType,heal:null,noAttack:false,noAttackUnlessSkill:false};
      unit.rangeGrid=template.rangeGrid;unit.markDirty();battle.refreshRange(unit);unit.hp=unit.s.maxHp*ratio;
      battle.fx('manifoldCopy',{x:unit.x,y:unit.y,id:unit.id,from:template.uid});
    };
    copyTemplate(true);
    battle.assaultRuntime.observe('skillResolved','mlyss-owned-bench:'+uid(unit),event=>{
      const ctx=event.payload??event,id=owner.def?.raw?.assaultBody?.fixedSkill?.sourceSkillId;
      if(active(unit)&&active(owner)&&id&&ctx.source===owner&&ctx.sourceUid===uid(owner)&&ctx.skillId===id){
        copyTemplate(false);
        if(unit.profile.attack==='ranged'){unit.hp=unit.s.maxHp;battle.emit('mlyssFlowRefreshed',{source:owner,target:unit,reason:'skill',cause:ctx.cause});}
      }
    },{owner:unit});
    const rank=Math.max(1,Math.min(4,ownerPiece.star??1));
    const ownerBody=owner.def?.raw?.assaultBody,skill=ownerBody?.fixedSkill?.effects?.find(x=>x.action==='nativeMechanism')?.values??{};
    const starIndex=rank-1;let meleeElapsed=0;
    battle.every(0.25,()=>{
      if(!active(unit)||!active(owner)||!unit.buffs?.some(x=>x.key==='assault:char_249_mlyss:skill:1'))return;
      const ranged=unit.profile?.attack==='ranged';
      if(ranged)return;
      meleeElapsed+=0.25;if(meleeElapsed<2)return;meleeElapsed=0;
      for(const enemy of battle.unitsInGrid(unit,[[0,1],[-1,0],[0,-1],[1,0],[-1,1],[-1,-1],[1,1],[1,-1]],{side:'enemy'})){
        battle.pull(enemy,skill.meleeDragForce?.[starIndex]??1,{to:{x:unit.x,y:unit.y},center:unit});
      }
      for(const enemy of unit.blocking??[])if(enemy.alive)battle.applyStatus(enemy,'stun',{duration:(skill.meleeDragInterval?.[starIndex]??2)+0.1,source:owner});
    },{owner:unit});
    battle.on('damaged',event=>{const ctx=event.payload??event;if(ctx.source!==unit||!active(unit)||!active(owner)||!unit.buffs?.some(x=>x.key==='assault:char_249_mlyss:skill:1'))return;const ranged=unit.profile?.attack==='ranged';if(ranged&&ctx.dmg?.isAttack&&ctx.target?.alive)battle.applyStatus(ctx.target,'bind',{duration:skill.rangeRoot?.[starIndex]??1.5,source:unit});},{owner:unit});
  } else if(tokenId==='token_10050_monstr_prosts'){
    const star=Math.max(1,Math.min(4,ownerPiece.star??1));const selectedModule=ownerPiece.moduleChoices?.[ownerPiece.charId??owner.def?.charId]==='uniequip_002_monstr'&&star>=3;const atk=[0.03,0.05,0.1,0.15][star-1]+(selectedModule?Number(owner.def?.raw?.assaultBody?.bazaar?.modules?.uniequip_002_monstr?.params?.a?.[star-1])/100:0);
    battle.every(1,()=>{if(!active(unit)||!active(owner))return;for(const target of around(battle,unit))buff(battle,unit,target,{key:`monstr-aura:${uid(unit)}`,mods:{atkMul:1+atk},duration:1.1,stacking:'replace'});},{owner:unit});
    if(ownerPiece.moduleChoices!=null&&(!ownerPiece.moduleChoices||typeof ownerPiece.moduleChoices!=='object'||Array.isArray(ownerPiece.moduleChoices)))throw new Error('Mon3tr moduleChoices must be keyed by body charId');
    // 记忆存档 (uniequip_002_monstr) only adds {a}% to the aura above; its retreat heal was removed.
  } else if(tokenId==='token_10032_jesca2_jckshd'){
    const rank=Math.max(1,Math.min(4,ownerPiece.star??1)),talent0=supportPlans['char_1034_jesca2'].talents[0].parameters,talent1=supportPlans['char_1034_jesca2'].talents[1].parameters,def=talent0.def[rank-1],prob=0/* 卡面无盾牌受击回技力：旧天赋已被 bazaar 防御光环行替换 */,key=`jesca-shield:${uid(unit)}`,covered=new Set();
    const faceShield=()=>{const dr=unit.tileR-owner.tileR,dc=unit.tileC-owner.tileC,dir=Math.abs(dr)>=Math.abs(dc)?(dr<0?'UP':'DOWN'):(dc<0?'LEFT':'RIGHT');owner.dir=dir;owner.markDirty?.();battle.refreshRange?.(owner);};
    faceShield();
    // 机动盾牌与相邻干员的防御光环在 support-bazaar.js；旧「自身与身后单位」光环停用
    if(false)battle.every(0.2,()=>{const eligible=active(unit)&&active(owner)?[owner,...allies(battle,owner,{scope:'adjacent8',priority:'hp',count:99}).filter(target=>target!==owner&&target.ownerId===owner.ownerId&&((target.tileR-owner.tileR)*(owner.dir==='UP'?-1:owner.dir==='DOWN'?1:0)+(target.tileC-owner.tileC)*(owner.dir==='LEFT'?-1:owner.dir==='RIGHT'?1:0)<0))]:[],next=new Set(eligible.map(uid));for(const id of covered)if(!next.has(id)){const target=battle.allyUnits.find(x=>uid(x)===id);if(target)battle.removeBuff(target,key);}for(const target of eligible)buff(battle,unit,target,{key,mods:{defMul:1+def},duration:0.45,stacking:'replace'});covered.clear();for(const id of next)covered.add(id);},{owner:unit});
    battle.on('damaged',event=>{const ctx=event.payload??event;if(ctx.target!==unit||!active(unit)||!active(owner)||!(ctx.amount>0)||prob<=0||battle.rng()>=prob)return;owner.skill?.gainSp(talent1.spGain,`assault:char_1034_jesca2:shield-hit:${uid(unit)}`);},{owner:unit});
  }
}})}
export const supportTokenKits=Object.fromEntries(ids.map(id=>[id,kitFor(id)]));
