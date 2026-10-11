import { setPrototypeRatingBonus, prototypeRatingTotal } from './prototype-rating.js';
import { prototypeSourceGearDefinitions } from '../../../../shared/resonance/prototype-source-gear.js';
import { resolvePrototypeCritical } from '../../../../shared/resonance/prototype-critical.js';

const GEAR_BY_ID=new Map(prototypeSourceGearDefinitions.map(row=>[row.id,row]));
const sourceHeroPowerByChar=(catalog)=>new Map((catalog?.prototypeSeason?.heroes??[]).map(row=>[row.charId,row.nativePowerReference??row.powerReference]));
const inputOf=(unit)=>unit?.player?.input?.units?.find(row=>String(row?.uid)===String(unit.uid))??null;
const itemId=(row)=>typeof row==='string'?row:row?.itemId??row?.id??null;
const metric=(battle,id,key)=>{
  battle.resonanceMetrics??={};battle.resonanceMetrics.prototypeSourceGear??={};
  const row=battle.resonanceMetrics.prototypeSourceGear[id]??={};row[key]=(row[key]??0)+1;
};
const finite=(value)=>value!=null&&Number.isFinite(Number(value));
const effectiveEffects=(catalog,id)=>catalog?.equipment?.[id]?.prototypeEffectiveEffects??GEAR_BY_ID.get(id)?.sourceEffects??{};

function sourceRows(unit,state){
  const uid=String(inputOf(unit)?.uid??unit?.resonanceUid??unit?.uid??'');
  const piece=(state?.pieces??[]).find(row=>String(row.uid)===uid);
  const consumed=new Set((unit?.mem?.prototypeConsumedComponents??[]).map(row=>String(typeof row==='object'?row.uid??row.itemUid??'':row)));
  const stored=piece?.equipment??inputOf(unit)?.items??unit?.items??[];
  const rows=stored.filter(row=>!consumed.has(String(row?.uid??row?.itemUid??'')));
  return [...rows,...(unit?.mem?.prototypeTemporaryItems??[])].filter(row=>GEAR_BY_ID.has(itemId(row)));
}

function sourceConfig(unit,rows,activeTraits,catalog){
  const ids=rows.map(itemId);
  const effectsById=new Map(ids.map(id=>[id,effectiveEffects(catalog,id)]));
  const power=sourceHeroPowerByChar(catalog).get(unit?.charId??unit?.def?.raw?.charId)??null;
  const ambusher=activeTraits.find(row=>row.id==='redeploy'&&row.members?.includes(unit?.charId??unit?.def?.raw?.charId));
  const config={unit,rows,ids,power,effectsById,atkPct:0,apPct:0,aspd:0,hpFlat:0,armorRating:0,mrRating:0,mana:0,critChance:0,abilityCrit:false,critDamageBonus:0,omnivamp:0,ambusher,hojCount:0,hojAtkBase:0,hojApBase:0,vowCount:0,crownguardCount:0,rageCount:0};
  for(const row of rows){
    const id=itemId(row);
    const e=effectsById.get(id)??{};
    const qualityFactor=Number(catalog?.prototypeEconomy?.qualityEffects?.[row.quality]?.[id]?.sourceStatsFactor??0);
    const scaled=(value)=>Number(value??0)*(1+qualityFactor);
    config.atkPct+=scaled(e.AD??e.AD_NotStatBar??0);
    config.apPct+=scaled(e.AP??e.AP_NotStatBar??0);
    config.aspd+=scaled(e.AS??0);
    config.hpFlat+=scaled(e.Health??0);
    config.armorRating+=scaled(e.Armor??0);
    config.mrRating+=scaled(e.MagicResist??0);
    config.mana+=scaled(e.Mana??0);
    config.critChance+=scaled(e.CritChance??0)/100;
    config.omnivamp+=scaled(e.StatOmnivamp_NotStatBar??0);
    if(id==='prototype_source_gear_hand_of_justice'){
      config.hojCount++;
      config.hojAtkBase+=scaled(e.AD_NotStatBar??0);
      config.hojApBase+=scaled(e.AP??e.AP_NotStatBar??0);
    }
    if(id==='prototype_source_gear_protectors_vow')config.vowCount++;
    if(id==='prototype_source_gear_crownguard')config.crownguardCount++;
    if(id==='prototype_source_gear_guinsoos_rageblade')config.rageCount++;
    if(id==='prototype_source_gear_jeweled_gauntlet'){
      config.abilityCrit=true;
      if(ambusher)config.critDamageBonus+=Number(e.CritDamageToGive??0);
    }
  }
  if(ambusher){config.abilityCrit=true;config.critChance+=Number(ambusher.variables?.CritChance??0);config.critDamageBonus+=Number(ambusher.variables?.CritDamage??0);}
  return config;
}

function updateStats(battle,config){
  const {unit,ids}=config;
  if(!unit?.alive||!unit.s)return;
  const modifiers={};
  const hpRatio=unit.hp/Math.max(1,unit.s.maxHp);
  const hoj=ids.includes('prototype_source_gear_hand_of_justice');
  const healthFactor=hoj&&hpRatio>Number(config.effectsById.get('prototype_source_gear_hand_of_justice')?.HealthThreshold??0.5)?1:0;
  const attack=config.atkPct+(healthFactor?config.hojAtkBase:0);
  const ability=config.apPct+(healthFactor?config.hojApBase:0)+(config.crownguardAp??0);
  if(attack)modifiers.atkPct=attack;
  if(ability)modifiers.artsDealtMul=1+ability/100;
  if(config.aspd)modifiers.aspd=config.aspd;
  if(config.hpFlat)modifiers.hpFlat=config.hpFlat;
  const vowRating=config.vowTriggered?Number(config.effectsById.get('prototype_source_gear_protectors_vow')?.Stats??20)*config.vowCount:0;
  setPrototypeRatingBonus(battle,unit,'source-gear',{armor:config.armorRating+vowRating,magicResist:config.mrRating+vowRating},config.power??{});
  if(Object.keys(modifiers).length)battle.addBuff(unit,{key:`resonance:sourcegear:stats:${unit.uid}`,mods:modifiers,persist:true,allowDead:true,tags:['resonance','prototype-source-gear']});
}

function grantVow(battle,config){
  const {unit,ids}=config;
  if(!ids.includes('prototype_source_gear_protectors_vow')||config.vowTriggered||unit.hp/unit.s.maxHp>0.4)return;
  config.vowTriggered=true;unit.mem.prototypeSourceGearVowTriggered=true;
  updateStats(battle,config);
  const effect=config.effectsById.get('prototype_source_gear_protectors_vow')??{};
  battle.addBuff(unit,{key:`resonance:sourcegear:vow:${unit.uid}`,shield:unit.s.maxHp*effect.ShieldHealthPercent/100*config.vowCount,duration:effect.ShieldDuration,source:unit,visible:true,tags:['resonance','prototype-source-gear']});
  metric(battle,'prototype_source_gear_protectors_vow','activated');
}

function applyInitialMana(battle,config){
  if(!config.mana)return;
  const cost=Number(config.unit.skill?.spCost??0);
  if(cost>0)config.unit.skill?.gainSp?.(cost*config.mana/100,'prototypeSourceGearMana');
}

function installSourceCrit(battle,configs){
  battle.prototypeSourceCritInstalled=true;
  battle.on('hit',event=>{
    const source=event?.source;
    if(source?.side!=='ally'||source?.kind!=='op')return;
    const config=configs.get(source);
    const abilityCrit=!!(config?.abilityCrit||config?.ambusher);
    const abilityCritBeforeItem=!!config?.ambusher;
    const externalChance=Number(source.mem?.prototypeChemCritChance??0);
    const result=resolvePrototypeCritical(event,{battle,bonusChance:(config?.critChance??0)+(Number.isFinite(externalChance)?externalChance:0),abilityCrit,critDamageBonus:config?.critDamageBonus??0,baseAttackChance:.25});
    if(result.critical){
      metric(battle,'prototype_source_gear_critical','hits');
      if(abilityCritBeforeItem)metric(battle,'prototype_source_gear_jeweled_gauntlet','ambusher_synergy_crit_damage');
      if(config?.ambusher){battle.resonanceMetrics.prototypeTraits??={};battle.resonanceMetrics.prototypeTraits.redeploy??={};battle.resonanceMetrics.prototypeTraits.redeploy.criticalHits=(battle.resonanceMetrics.prototypeTraits.redeploy.criticalHits??0)+1;}
    }
  },{owner:battle});
}

/** Install only the seven source-exact Set 13 reward items on V3 Battle units. */
export function installPrototypeSourceGear(battle,state,catalog,activeTraits=[]){
  if(catalog?.prototypeMeta?.rulesVersion!==3)return {installed:0};
  const configs=new Map();let installed=0;
  for(const unit of battle.allyUnits??[]){
    if(unit?.kind!=='op')continue;
    const rows=sourceRows(unit,state),ids=rows.map(itemId);
    const config=sourceConfig(unit,rows,activeTraits,catalog);configs.set(unit,config);
    if(!ids.length)continue;
    unit.mem.prototypeSourceGearIds=ids;installed+=ids.length;
    unit.mem.prototypeSourceGearRating={armor:config.armorRating,magicResist:config.mrRating};
    if(config.crownguardCount){
      const source=config.effectsById.get('prototype_source_gear_crownguard')??{};
      unit.mem.prototypeCrownguardPending=true;
      battle.on('battleStart',()=>{
        updateStats(battle,config);
        for(let copy=0;copy<config.crownguardCount;copy++)battle.addBuff(unit,{key:`resonance:sourcegear:crownguard:${unit.uid}:${copy}`,shield:unit.s.maxHp*source.ShieldSize/100,duration:source.ShieldDuration,source:unit,visible:true,tags:['resonance','prototype-source-gear']});
        battle.after(Number(source.ShieldDuration),()=>{
          if(!unit.alive||unit.mem.prototypeCrownguardApGranted)return;
          unit.mem.prototypeCrownguardApGranted=true;config.crownguardAp=Number(source.ShieldBonusAP)*config.crownguardCount;updateStats(battle,config);
          metric(battle,'prototype_source_gear_crownguard','shield_expired');
        });
      },{owner:battle});
    }
    battle.on('battleStart',()=>{updateStats(battle,config);applyInitialMana(battle,config);grantVow(battle,config);},{owner:battle});
  }
  installSourceCrit(battle,configs);
  if(!installed)return {installed:0};

  battle.on('damaged',event=>{
    const unit=event?.target,config=configs.get(unit);
    if(config&&event.dealt>0){
      if(config.ids.includes('prototype_source_gear_hand_of_justice'))updateStats(battle,config);
      grantVow(battle,config);
    }
    const source=event?.source,attacker=configs.get(source),target=event?.target,dmg=event?.dmg;
    if(attacker?.omnivamp&&event.dealt>0){
      const effect=attacker.effectsById.get('prototype_source_gear_hand_of_justice')??{};
      const ratio=attacker.omnivamp*(source.hp/source.s.maxHp<Number(effect.HealthThreshold)?2:1);
      battle.heal(source,source,event.dealt*ratio,{self:true,tags:['resonance','prototype-source-gear','hand-of-justice']});
      metric(battle,'prototype_source_gear_hand_of_justice','healing_events');
    }
    if(!attacker||target?.side!=='enemy'||!(event.dealt>0))return;
    if(attacker.ids.includes('prototype_source_gear_last_whisper')&&dmg?.type==='phys'){
      const effect=attacker.effectsById.get('prototype_source_gear_last_whisper')??{};
      const targetChar=target.charId??target.def?.raw?.charId??target.def?.charId;
      const targetPower=sourceHeroPowerByChar(catalog).get(targetChar);
      if(targetPower&&finite(targetPower.armor)&&finite(targetPower.attackDamage)){
        const key='sourcegear-last-whisper';
        const current=target.mem?.prototypeRatingBonuses?.[key]?.armor??0;
        const other=prototypeRatingTotal(target,'armor')-current;
        const before=Number(targetPower.armor)+other;
        const reduction=Number(effect.ArmorReductionPercent)/100;
        setPrototypeRatingBonus(battle,target,key,{armor:-before*reduction},targetPower);
        battle.addBuff(target,{key:'resonance:sourcegear:last-whisper',duration:effect.ArmorBreakDuration,source,tags:['resonance','prototype-source-gear'],onExpire:()=>setPrototypeRatingBonus(battle,target,key,{armor:0},targetPower)});
      }else{
        // Native PvE enemies expose flat DEF, not TFT ratings. The source item
        // remains a three-second, non-stacking 30% armor cut in that mode.
        battle.addBuff(target,{key:'resonance:sourcegear:last-whisper',duration:effect.ArmorBreakDuration,mods:{defMul:1-Number(effect.ArmorReductionPercent)/100},source,tags:['resonance','prototype-source-gear']});
      }
      metric(battle,'prototype_source_gear_last_whisper','sunder');
    }
  },{owner:battle});

  battle.on('hit',event=>{
    const source=event?.source,target=event?.target,dmg=event?.dmg,config=configs.get(source);
    if(!config||target?.side!=='enemy'||!dmg)return;
    if(!dmg.isAttack&&!dmg.isSkill)return;
    if(config.ids.includes('prototype_source_gear_morellonomicon')){
      const e=config.effectsById.get('prototype_source_gear_morellonomicon')??{};
      battle.addBuff(target,{key:'resonance:sourcegear:morello',duration:e.BurnDuration,interval:1,source,mods:{healingTakenMul:1-e.GrievousWoundsPercent/100},onTick:({battle:current,unit})=>{
        if(unit.alive)current.dealDamage(source,unit,{amount:unit.s.maxHp*e.BurnPercent/100,type:'true',canDodge:false,tags:['resonance','prototype-source-gear','morello-burn']});
      },tags:['resonance','prototype-source-gear']});
      metric(battle,'prototype_source_gear_morellonomicon','applied');
    }
  },{owner:battle});

  battle.on('attack',event=>{
    const unit=event?.attacker,config=configs.get(unit);
    if(!config||unit.side!=='ally'||unit.kind!=='op')return;
    const rage=config.rageCount>0;
    if(rage){
      unit.mem.prototypeSourceRageStacks=(unit.mem.prototypeSourceRageStacks??0)+config.rageCount;
      const perStack=Number(config.effectsById.get('prototype_source_gear_guinsoos_rageblade')?.AttackSpeedPerStack??0);
      battle.addBuff(unit,{key:`resonance:sourcegear:rage:${unit.uid}`,mods:{aspd:perStack*unit.mem.prototypeSourceRageStacks},persist:true,allowDead:true,tags:['resonance','prototype-source-gear']});
      metric(battle,'prototype_source_gear_guinsoos_rageblade','attack_stacks');
    }
  },{owner:battle});
  return {installed};
}
