import { prototypeSeasonForCatalog } from '../../../../shared/resonance/season-registry.js';
import { setPrototypeRatingBonus, prototypeRatingTotal, resolvePrototypeRatingReference } from './prototype-rating.js';

const clone=(value)=>structuredClone(value);

function selectedAugments(state,catalog){
  const selected=(state?.strategies??[]).map((entry)=>typeof entry==='string'?entry:entry?.id).filter(Boolean);
  const rows=[];
  for(const id of selected){
    if(state?.strategyState?.[id]?.fallbackApplied)continue;
    const strategy=catalog?.strategies?.[id];
    for(const effect of strategy?.effects??[]){
      if(effect.kind!=='prototype_battle_augment')continue;
      const params=effect.params??{};
      if(!params.sourceApiName||!params.mechanic||!params.traitId)throw new Error(`BAD_PROTOTYPE_BATTLE_AUGMENT:${id}`);
      rows.push({id,sourceApiName:params.sourceApiName,mechanic:params.mechanic,traitId:params.traitId,variables:clone(params.variables??{})});
    }
  }
  return rows;
}

/** Install source-variable-backed Set 13 battle augments before Battle.start(). */
export function installPrototypeBattleAugments(battle,state,catalog){
  const season=prototypeSeasonForCatalog(catalog);
  const augments=selectedAugments(state,catalog);
  if(!augments.length)return {augments:[],metrics:battle.resonanceMetrics?.prototypeBattleAugments??{}};
  const operators=catalog?.operators??{};
  const bySource=new Map(Object.values(operators).map((operator)=>[operator.sourceChessId,operator]));
  const operatorFor=(unit)=>{
    const raw=unit?.def?.raw??{};
    for(const id of [raw.id,raw.chessId,unit?.def?.id,unit?.def?.chessId,unit?.defId,unit?.baseDefId]){
      const operator=bySource.get(id);if(operator)return operator;
    }
    return null;
  };
  const charFor=(unit)=>{
    const raw=unit?.def?.raw??unit?.def??{};
    return raw.charId??operatorFor(unit)?.charId??null;
  };
  const powerFor=(unit)=>{const hero=season.heroes.find((entry)=>entry.charId===charFor(unit));return resolvePrototypeRatingReference(unit,hero?.nativePowerReference??hero?.powerReference??{}).powerReference;};
  const ratingsFor=(unit)=>{
    const power=powerFor(unit);
    return {armor:Number(power.armor??0)+prototypeRatingTotal(unit,'armor'),magicResist:Number(power.magicResist??0)+prototypeRatingTotal(unit,'magicResist')};
  };
  const hasTrait=(unit,traitId)=>{
    if(!unit||unit.kind!=='op'||unit.side!=='ally')return false;
    const operator=operatorFor(unit);
    const contains=(value)=>value instanceof Set?value.has(traitId):Array.isArray(value)?value.includes(traitId):Boolean(value&&typeof value==='object'&&value[traitId]===true);
    return contains(operator?.pacts)||contains(unit.mem?.resonancePacts);
  };
  const members=(traitId)=>battle.allyUnits.filter((unit)=>unit.kind==='op'&&unit.alive&&unit.deployed&&!unit.removed&&hasTrait(unit,traitId));
  const counters={};
  const metric=(augment,key,amount=1)=>{
    const row=counters[augment.sourceApiName]??{strategyId:augment.id,sourceApiName:augment.sourceApiName,mechanic:augment.mechanic,triggers:0};
    row[key]=(row[key]??0)+amount;row.triggers++;counters[augment.sourceApiName]=row;
  };
  const entries=(mechanic)=>augments.filter((row)=>row.mechanic===mechanic);
  const addBuff=(unit,augment,key,mods,duration=Infinity)=>battle.addBuff(unit,{key:`resonance:v3:augment:${augment.id}:${key}:${unit.id}`,duration,mods,tags:['resonance','prototype-augment']});
  battle.resonanceMetrics??={};
  battle.resonanceMetrics.prototypeBattleAugments=counters;

  battle.on('battleStart',()=>{
    for(const augment of entries('quickstriker_burst')){
      const burst=(unit)=>addBuff(unit,augment,'burst',{aspd:Number(augment.variables.AttackSpeed??0)*100},Number(augment.variables.BuffDuration??2.5));
      const every=Number(augment.variables.TimeBetweenProcs??6);
      if(Number(augment.variables.StartOnFirstAttack)>0){
        // season 2: the field is empty when the battle starts, so each member's bursts count from its first attack
        const next=new Map();
        battle.on('hit',(event)=>{
          const unit=event?.source;
          if(next.has(unit)||event.target?.side!=='enemy'||!(event.dmg?.isAttack||event.dmg?.isSkill)||!hasTrait(unit,augment.traitId))return;
          next.set(unit,battle.time+every);burst(unit);metric(augment,'bursts');
        },{owner:battle});
        battle.every(.25,()=>{
          for(const [unit,due] of next){
            if(!unit.alive||!unit.deployed||battle.time+1e-9<due)continue;
            next.set(unit,due+every);burst(unit);metric(augment,'bursts');
          }
        },{owner:battle});
        continue;
      }
      const pulse=()=>{for(const unit of members(augment.traitId))burst(unit);metric(augment,'bursts');};
      battle.every(every,pulse,{owner:battle,immediate:true});
    }
    for(const augment of entries('bruiser_health_strike')){
      const arm=()=>{for(const unit of members(augment.traitId))unit.mem.prototypeBruiserAugmentReady=true;metric(augment,'readyWindows');};
      battle.every(Number(augment.variables.RefreshSeconds??4),arm,{owner:battle,immediate:true});
    }
    for(const augment of entries('sentinel_shield_bash')){
      const key=`augment:${augment.id}:sentinel-resists`;
      const updateRatings=()=>{
        for(const unit of members(augment.traitId)){
          const current=ratingsFor(unit),previous=unit.mem.prototypeRatingBonuses?.[key]??{};
          const multiplier=Number(augment.variables.PercGain??0);
          setPrototypeRatingBonus(battle,unit,key,{armor:(current.armor-Number(previous.armor??0))*multiplier,magicResist:(current.magicResist-Number(previous.magicResist??0))*multiplier},powerFor(unit));
        }
      };
      updateRatings();
      battle.every(.2,updateRatings,{owner:battle});
      const arm=()=>{for(const unit of members(augment.traitId))unit.mem.prototypeSentinelAugmentReady=true;metric(augment,'readyWindows');};
      battle.every(Number(augment.variables.Interval??4),arm,{owner:battle,immediate:true});
    }
    for(const augment of entries('dominator_shield_rush')){
      battle.every(.2,()=>{
        for(const unit of members(augment.traitId))if(unit.buffs.some((buff)=>Number(buff.shield)>0&&buff.timeLeft>0))addBuff(unit,augment,'shielded-as',{aspd:Number(augment.variables.ShieldPercentAS??0)*100},.25);
      },{owner:battle,immediate:true});
    }
  },{owner:battle});

  battle.on('hit',(event)=>{
    const source=event?.source,target=event?.target,dmg=event?.dmg;
    if(!source||!target||!dmg||source.side!=='ally'||target.side!=='enemy')return;
    for(const augment of entries('bruiser_health_strike')){
      if(hasTrait(source,augment.traitId)&&dmg.isAttack&&!dmg.isSkill&&source.mem.prototypeBruiserAugmentReady){
        dmg.amount+=source.s.maxHp*Number(augment.variables.SlamPercentHealth??0);
        source.mem.prototypeBruiserAugmentReady=false;metric(augment,'healthStrikes');
      }
    }
    for(const augment of entries('sentinel_shield_bash')){
      if(hasTrait(source,augment.traitId)&&dmg.isAttack&&!dmg.isSkill&&source.mem.prototypeSentinelAugmentReady){
        const ratings=ratingsFor(source);
        const resistance=season.powerModel==='native-pve'?Number(source.s.def??0)+Number(source.s.res??0):ratings.armor+ratings.magicResist;
        const amount=resistance*Number(augment.variables.ResistToDamageRatio??0);
        source.mem.prototypeSentinelAugmentReady=false;
        if(amount>0)battle.dealDamage(source,target,{amount,type:'arts',canDodge:false,tags:['resonance','prototype-sentinel-shield-bash']});
        metric(augment,'shieldBashes');
      }
    }
    for(const augment of entries('conqueror_execute')){
      if(!hasTrait(source,augment.traitId)||(dmg.tags??[]).includes('prototype-conqueror-execute'))continue;
      const threshold=Number(augment.variables.BaseExecuteThreshold??0)/100;
      if(target.hpRatio<=threshold){
        dmg.cancel=true;
        battle.dealDamage(source,target,{amount:target.hp*2,type:'true',canDodge:false,tags:['resonance','prototype-conqueror-execute']});
        if(!target.alive){
          source.mem.prototypeConquerorExecutions??={};
          const count=(source.mem.prototypeConquerorExecutions[augment.id]??0)+1;
          source.mem.prototypeConquerorExecutions[augment.id]=count;
          const bonus=count*Number(augment.variables.ArmorandMagicResist??0);
          setPrototypeRatingBonus(battle,source,`augment:${augment.id}:conqueror-executions`,{armor:bonus,magicResist:bonus},powerFor(source));
          metric(augment,'executions');
        }
      }
    }
    for(const augment of entries('automata_second_blast')){
      if(!hasTrait(source,augment.traitId)||(dmg.tags??[]).includes('prototype-automata')===false||(dmg.tags??[]).includes('prototype-fractured-crystal'))continue;
      const second=(battle.enemies??[]).filter((enemy)=>enemy!==target&&enemy.alive&&enemy.deployed&&!enemy.hidden)
        .sort((a,b)=>Math.hypot(a.x-target.x,a.y-target.y)-Math.hypot(b.x-target.x,b.y-target.y)||a.id-b.id)[0];
      if(second){
        battle.dealDamage(source,second,{amount:Number(dmg.amount??0)*Number(dmg.mul??1)*Number(augment.variables.Percentage??0),type:'arts',canDodge:false,tags:['resonance','prototype-fractured-crystal']});
        metric(augment,'secondBlasts');
      }
    }
  },{owner:battle});

  battle.on('kill',(event)=>{
    const killer=event?.killer,victim=event?.victim;
    if(!killer||killer.side!=='ally'||killer.kind!=='op'||victim?.side!=='enemy')return;
    for(const augment of entries('dominator_shield_rush'))if(hasTrait(killer,augment.traitId)){
      for(const unit of members(augment.traitId))battle.addBuff(unit,{key:`resonance:v3:augment:${augment.id}:kill-shield:${unit.id}`,shield:Number(augment.variables.ShieldAmount??0),duration:Number(augment.variables.ShieldDuration??3),tags:['resonance','prototype-augment']});
      metric(augment,'killShields');
    }
  },{owner:battle});

  battle.on('death',(event)=>{
    const dead=event?.unit;if(!dead||dead.side!=='ally'||dead.kind!=='op')return;
    for(const augment of entries('sorcerer_death_burst')){
      if(!hasTrait(dead,augment.traitId))continue;
      // This engine has no TFT `AP` stat. Preserve the source ratio as a mode
      // adaptation against the operator's resolved attack power and arts amp.
      const abilityPower=Number(dead.s.atk??0)*Number(dead.s.artsDealtMul??1);
      for(const unit of battle.units.filter((target)=>target!==dead&&target.alive&&target.deployed&&!target.removed&&Math.hypot(target.x-dead.x,target.y-dead.y)<=1.5)){
        battle.dealDamage(dead,unit,{amount:abilityPower*Number(augment.variables.DeathPercentage??0),type:'arts',canDodge:false,tags:['resonance','prototype-sorcerer-death-burst']});
      }
      metric(augment,'deathBursts');
    }
  },{owner:battle});

  battle.on('damaged',(event)=>{
    const target=event?.target,dmg=event?.dmg;
    if(target?.side!=='ally'||target.kind!=='op'||event?.source?.side!=='enemy'||!(event.dealt>0))return;
    for(const augment of entries('watcher_battle_scars')){
      if(!hasTrait(target,augment.traitId))continue;
      if(dmg?.isAttack){target.mem.prototypeWatcherAttackStacks=(target.mem.prototypeWatcherAttackStacks??0)+1;const stacks=target.mem.prototypeWatcherAttackStacks;addBuff(target,augment,'attack-scars',{atkPct:Number(augment.variables.IncreaseADByTakeAttack??0)*stacks/100});metric(augment,'attackScars');}
      if(dmg?.isSkill){target.mem.prototypeWatcherSpellStacks=(target.mem.prototypeWatcherSpellStacks??0)+1;const stacks=target.mem.prototypeWatcherSpellStacks;addBuff(target,augment,'spell-scars',{artsDealtMul:1+Number(augment.variables.IncreaseAPByTakeSpell??0)*stacks/100});metric(augment,'spellScars');}
    }
  },{owner:battle});

  battle.on('battleEnd',()=>{
    battle.resonanceMetrics.prototypeBattleAugments=Object.fromEntries(Object.entries(counters).map(([id,row])=>[id,{...row}]));
  },{owner:battle});
  return {augments:augments.map((row)=>({...row,variables:clone(row.variables)})),metrics:counters};
}

export const prototypeBattleAugmentMechanics=Object.freeze(['automata_second_blast','bruiser_health_strike','conqueror_execute','dominator_shield_rush','quickstriker_burst','sentinel_shield_bash','sorcerer_death_burst','watcher_battle_scars']);
