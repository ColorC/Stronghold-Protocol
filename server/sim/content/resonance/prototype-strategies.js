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
      const arm=()=>{for(const unit of members(augment.traitId))unit.mem.prototypeSentinelAugmentReady=true;metric(augment,'readyWindows');};
      if(Number(augment.variables.NativeDefPct)>0){
        // season 2: a native DEF share instead of the source defense rating
        for(const unit of members(augment.traitId))addBuff(unit,augment,'sentinel-def',{defPct:Number(augment.variables.NativeDefPct)});
        battle.every(Number(augment.variables.Interval??4),arm,{owner:battle,immediate:true});
        continue;
      }
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
          if(Number(augment.variables.NativeDefPctPerKill)>0){
            // season 2: native DEF / RES per execution, at most MaxKills times
            const stacks=Math.min(count,Number(augment.variables.MaxKills??Infinity));
            addBuff(source,augment,'conqueror-executions',{defPct:stacks*Number(augment.variables.NativeDefPctPerKill),resFlat:stacks*Number(augment.variables.NativeResPerKill??0)});
          }else{
            const bonus=count*Number(augment.variables.ArmorandMagicResist??0);
            setPrototypeRatingBonus(battle,source,`augment:${augment.id}:conqueror-executions`,{armor:bonus,magicResist:bonus},powerFor(source));
          }
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
      for(const unit of battle.units.filter((target)=>target.side==='enemy'&&target.alive&&target.deployed&&!target.removed&&!target.hidden&&Math.hypot(target.x-dead.x,target.y-dead.y)<=1.5)){
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
      const cap=Number(augment.variables.MaxStacks??Infinity);
      if(dmg?.isAttack){target.mem.prototypeWatcherAttackStacks=Math.min(cap,(target.mem.prototypeWatcherAttackStacks??0)+1);const stacks=target.mem.prototypeWatcherAttackStacks;addBuff(target,augment,'attack-scars',{atkPct:Number(augment.variables.IncreaseADByTakeAttack??0)*stacks/100});metric(augment,'attackScars');}
      if(dmg?.isSkill){target.mem.prototypeWatcherSpellStacks=Math.min(cap,(target.mem.prototypeWatcherSpellStacks??0)+1);const stacks=target.mem.prototypeWatcherSpellStacks;addBuff(target,augment,'spell-scars',{artsDealtMul:1+Number(augment.variables.IncreaseAPByTakeSpell??0)*stacks/100});metric(augment,'spellScars');}
    }
  },{owner:battle});

  battle.on('battleEnd',()=>{
    battle.resonanceMetrics.prototypeBattleAugments=Object.fromEntries(Object.entries(counters).map(([id,row])=>[id,{...row}]));
  },{owner:battle});
  return {augments:augments.map((row)=>({...row,variables:clone(row.variables)})),metrics:counters};
}

export const prototypeBattleAugmentMechanics=Object.freeze(['automata_second_blast','bruiser_health_strike','conqueror_execute','dominator_shield_rush','quickstriker_burst','sentinel_shield_bash','sorcerer_death_burst','watcher_battle_scars']);

/** Season-2 generic team strategies (shared/resonance/generic-strategies.js, kind prototype_team_battle). */
export function installPrototypeTeamStrategies(battle,state,catalog){
  const rows=[];
  for(const entry of state?.strategies??[]){
    const id=typeof entry==='string'?entry:entry?.id;
    if(!id||state?.strategyState?.[id]?.fallbackApplied)continue;
    for(const effect of catalog?.strategies?.[id]?.effects??[])if(effect.kind==='prototype_team_battle')rows.push({id,...clone(effect.params??{})});
  }
  if(!rows.length)return {strategies:0};
  const bySource=new Map(Object.values(catalog?.operators??{}).map((operator)=>[operator.sourceChessId,operator]));
  const operatorOf=(unit)=>{const raw=unit?.def?.raw??{};for(const id of [raw.id,raw.chessId,raw.resonanceOperatorId,unit?.def?.id,unit?.defId])if(bySource.has(id))return bySource.get(id);return null;};
  const costOf=(unit)=>Number(operatorOf(unit)?.cost??0);
  const starOf=(unit)=>Number(unit?.def?.raw?.resonanceStar??1);
  const ranged=(unit)=>(unit?.def?.position??unit?.def?.raw?.position)==='RANGED';
  const ops=()=>battle.allyUnits.filter((unit)=>unit?.kind==='op'&&unit.alive&&unit.deployed&&!unit.removed);
  const counters={};
  const metric=(row,key,amount=1)=>{const record=counters[row.id]??={mechanic:row.mechanic};record[key]=(record[key]??0)+amount;};
  const buff=(unit,row,key,mods,extra={})=>battle.addBuff(unit,{key:`resonance:v3:team-strategy:${row.id}:${key}:${unit.id}`,duration:Infinity,persist:true,allowDead:true,mods,tags:['resonance','prototype-strategy'],...extra});
  battle.resonanceMetrics??={};
  battle.resonanceMetrics.prototypeTeamStrategies=counters;
  battle.on('battleStart',()=>{
    const all=ops();
    for(const row of rows){
      if(row.mechanic==='team_stats'){
        const mods={};
        if(Number(row.atkPct)>0)mods.atkPct=Number(row.atkPct);
        if(Number(row.aspd)>0)mods.aspd=Number(row.aspd);
        if(Number(row.defPct)>0)mods.defPct=Number(row.defPct);
        if(Number(row.artsDamage)>0)mods.artsDealtMul=1+Number(row.artsDamage);
        for(const unit of all){
          if(Object.keys(mods).length)buff(unit,row,'stats',mods);
          if(Number(row.initialSp)>0)unit.skill?.gainSp?.(Number(row.initialSp),'init');
        }
        metric(row,'allies',all.length);
      }
      if(row.mechanic==='ranged_backup'&&all.filter(ranged).length>=Number(row.minRanged??4)){for(const unit of all)buff(unit,row,'aspd',{aspd:Number(row.aspd)});metric(row,'active');}
      if(row.mechanic==='ranged_sp_regen'){const members=all.filter(ranged);for(const unit of members)buff(unit,row,'sp',{spRecoveryFlat:Number(row.spRegen)});metric(row,'allies',members.length);}
      if(row.mechanic==='one_cost_unity'){
        const count=new Set(all.filter((unit)=>costOf(unit)===1).map((unit)=>operatorOf(unit)?.charId)).size;
        if(count>0)for(const unit of all)buff(unit,row,'unity',{hpPct:Number(row.hpPctPer)*count,dmgDealtMul:1+Number(row.damagePer)*count});
        metric(row,'oneCost',count);
      }
      if(row.mechanic==='little_buddies'){
        const count=Math.min(Number(row.maxCount??4),all.filter((unit)=>costOf(unit)>=1&&costOf(unit)<=2).length);
        const seniors=all.filter((unit)=>costOf(unit)>=4);
        if(count>0)for(const unit of seniors)buff(unit,row,'buddies',{hpPct:Number(row.hpPctPer)*count,aspd:Number(row.aspdPer)*count});
        metric(row,'buddies',count);
      }
      if(row.mechanic==='pair_of_fours'){
        const fours=all.filter((unit)=>costOf(unit)===4);
        if(fours.length===2){for(const unit of fours)buff(unit,row,'pair',{hpPct:Number(row.hpPct),aspd:Number(row.aspd)});metric(row,'active');}
      }
      if(row.mechanic==='mentorship'){
        const pupils=all.filter((unit)=>all.some((other)=>other!==unit&&costOf(other)>costOf(unit)&&Math.max(Math.abs(other.tileR-unit.tileR),Math.abs(other.tileC-unit.tileC))===1));
        for(const unit of pupils)buff(unit,row,'pupil',{aspd:Number(row.aspd),hpPct:Number(row.hpPct)});
        metric(row,'pupils',pupils.length);
      }
      if(row.mechanic==='superstars'){
        const bonus=Math.min(Number(row.max),Number(row.base)+Number(row.perThreeStar)*all.filter((unit)=>starOf(unit)===3).length);
        for(const unit of all)buff(unit,row,'stars',{dmgDealtMul:1+bonus});
        metric(row,'bonusPct',Math.round(bonus*100));
      }
      if(row.mechanic==='glass_cannon'){
        const members=all.filter(ranged);
        for(const unit of members){buff(unit,row,'glass',{dmgDealtMul:1+Number(row.damage)});unit.hp=Math.min(unit.hp,unit.s.maxHp*Number(row.startHp));}
        metric(row,'allies',members.length);
      }
      if(row.mechanic==='pressure_ramp'){
        // the field is empty when the battle starts: the ramp only counts while an enemy is on the field
        let stacks=0;const maxStacks=Math.floor(Number(row.maxAspd)/Number(row.aspd));
        battle.every(Number(row.interval??3),()=>{
          if(stacks>=maxStacks||!battle.enemies.some((enemy)=>enemy?.alive&&enemy.deployed))return;
          stacks++;for(const unit of ops())buff(unit,row,'ramp',{aspd:Number(row.aspd)*stacks});metric(row,'stacks');
        },{owner:battle});
      }
    }
  },{owner:battle});
  const epitaphs=rows.filter((row)=>row.mechanic==='epitaph');
  if(epitaphs.length)battle.on('death',(event)=>{
    const fallen=event?.unit;if(fallen?.side!=='ally'||fallen.kind!=='op')return;
    const heir=ops().filter((unit)=>unit!==fallen).sort((a,b)=>Math.hypot(a.x-fallen.x,a.y-fallen.y)-Math.hypot(b.x-fallen.x,b.y-fallen.y)||a.id-b.id)[0];
    if(!heir)return;
    for(const row of epitaphs){
      heir.mem.prototypeEpitaph=Math.min(Number(row.maxStacks??5),Number(heir.mem.prototypeEpitaph??0)+1);
      buff(heir,row,'aspd',{aspd:Number(row.aspd)*heir.mem.prototypeEpitaph});
      battle.addBuff(heir,{key:`resonance:v3:team-strategy:${row.id}:shield:${heir.id}:${battle.time}`,shield:heir.s.maxHp*Number(row.shieldPct),duration:Number(row.shieldDuration??8),tags:['resonance','prototype-strategy']});
      metric(row,'triggers');
    }
  },{owner:battle});
  return {strategies:rows.length};
}
