import { prototypeSeasonForCatalog, redesignedTraitIds, retiredEconomyTraitIds } from '../../../../shared/resonance/season-registry.js';
import { PROTOTYPE_FORM_SWAP, prototypeFormForRow } from '../../../../shared/resonance/prototype-form.js';
import { resolvePrototypeCritical } from '../../../../shared/resonance/prototype-critical.js';
import { SkillRuntime } from '../../skills.js';
import { tftMrToNativeResistance, tftRatingBonusToNative, tftArmorToNativeDefense } from '../../../../shared/resonance/prototype-resistance.js';
import { setPrototypeRatingBonus } from './prototype-rating.js';
import { nativeFlatAmount } from '../../../../shared/resonance/native-effect-scale.js';
import { nativePactCopy } from '../../../../shared/resonance/native-pact-copy.js';
import { strongholdPactCopy } from '../../../../shared/resonance/stronghold-pacts.js';

const clone = (value) => structuredClone(value);
const mechanicByTrait = Object.freeze({
  Automata:'damage_crystal_blast_20', Sorcerer:'mana_to_ap', Scrap:'temporary_item_upgrade', Artillerist:'rocket_every_5_attacks',
  'Form Swapper':'front_back_role_swap', Emissary:'exact_count_1_or_4', Sentinel:'shield_and_defense', Family:'living_family_loot',
  Ambusher:'skill_critical', Visionary:'bonus_mana_and_healing', Sniper:'distance_damage_amp', Conqueror:'knockout_treasure',
  'High Roller':'sevika_random_cast_mod', Academy:'shared_item_training', 'Chem-Baron':'shimmer_loss_streak_market', Rebel:'low_hp_signal_stun',
  Dominator:'shield_spell_ap_stacks', 'Pit Fighter':'low_hp_true_damage_lifesteal', Enforcer:'highest_hp_bounty_attack_speed',
  Firelight:'dash_loss_recovery', Experiment:'copy_personal_trait', Bruiser:'health_and_shield', 'Junker King':'paid_per_3_battle_upgrade',
  'Black Rose':'visible_summon_unlink_revive', Quickstriker:'target_missing_health_damage', Watcher:'half_health_damage_reduction',
});

const pct = (value) => `${Math.round(Number(value ?? 0) * 100)}%`;
const pctPrecise = (value) => `${Number((Number(value ?? 0) * 100).toFixed(2))}%`;
function sourceHookHero(season,apiName) {
  const assignedName=season.sourceHookAssignments?.[apiName];
  return (assignedName&&season.heroes.find((hero)=>hero.operatorName===assignedName))
    ??season.heroes.find((hero)=>hero.apiName===apiName);
}
function tierDescription(name, v, minUnits=0, season) {
  const trait=season.traits.find((entry)=>entry.sourceName===name);
  const description=(()=>{switch (name) {
    case 'Automata': return `机巧干员每次造成伤害获得1枚晶体；累计${v.TriggerNumCrystals}枚后，对当前目标造成${v.MagicDamage}点术法伤害，并追加自上次爆发以来伤害总量的${pct(v.ConversionDamagePct)}，随后重置晶体。机巧干员获得${v.Resists}点双抗评分对应的防护。`;
    case 'Sorcerer': return `非术式干员术法伤害提高${v.TeamAP}%；术式干员术法伤害总计提高${v.BaseAP}%。${v.DamageDecrease == null ? '' : `术式干员的技能命中使目标造成的伤害降低${pct(v.DamageDecrease)}，持续${v.DamageDecreaseDuration}秒。`}`;
    case 'Scrap': {
      const count=Number(v.NumComponents??0),conversion=minUnits>=6?'全部组件':`至多${minUnits===2?1:3}件组件`;
      return `战地整备干员获得${v.HPShieldAmount}点护盾，持续${v.ShieldDuration}秒；数值按全队持有的组件总数计算，已合成装备内的组件也计入。战斗开始时${conversion}会临时合成为装备，战后恢复原状。${v['{659aef8d}'] ? '临时装备按干员定位获得幸运强化。' : ''}${v['{7e2474c8}'] ? '临时装备升为辉光品质。' : ''}`;
    }
    case 'Artillerist': return `炮术干员获得${pct(v.AD)}攻击力；每${v.NumOfAttacks}次普攻发射火箭，对目标周围造成${pct(v.PercentDamage)}攻击力的范围伤害。`;
    case 'Form Swapper': return `双形干员部署在前两排时获得${pct(v.DR)}减伤，部署在后两排时获得${pct(v.DA)}伤害增幅。`;
    case 'Emissary': {
      const hero=(api)=>sourceHookHero(season,api)?.operatorName??'对应干员';
      const [attackSpeed,energy,healing,defense]=['TFT13_Tristana','TFT13_Nami','TFT13_Garen','TFT13_Ambessa'].map(hero);
      const effects=`${attackSpeed}使每名友军按自身星级获得6%/12%/18%攻速；${energy}使每名友军每次攻击额外获得${v.NamiMana}技力；${healing}使自己和左右相邻友军获得其最大生命值${pct(v.GarenHealthPercent)}的生命；${defense}每获胜一场已结算战斗，全队获得${v.AmbessaArmor_PVE ?? v.AmbessaArmor}点护甲评分对应的防护，最多计入7场。`;
      return minUnits===1?`恰好上场1名${trait?.name??'盟约'}干员时生效：${effects}`:`恰好上场4名${trait?.name??'盟约'}干员时生效：${effects}4名${trait?.name??'盟约'}干员各额外获得${v.BonusHealth}点生命与${pct(v.SelfishDamageAmp)}伤害增幅。`;
    }
    case 'Sentinel': return `全队获得${v.BonusArmor}点护甲评分对应的物理减伤与法术抗性；坚阵干员获得三倍加成。`;
    case 'Family': return `并肩干员攻击速度+${pct(v.AttackSpeed)}、所受伤害降低${pct(v.DamageReduction)}、技能技力需求降低${pct(v.ManaReduction)}。${v['{01fcc30b}'] == null ? '' : `战斗结束后，存活的并肩干员推进家族行动。`}`;
    case 'Ambusher': return `突袭干员获得${pct(v.CritChance)}暴击率加成，普攻与技能均可暴击；暴击伤害提高${pct(v.CritDamage)}。${v.DamageReductionPct == null ? '' : `所受伤害降低${pct(v.DamageReductionPct)}。`}`;
    case 'Visionary': return `技力协同干员获得技力时额外获得${pct(v.EnlightenedBonusMana)}；${v.AllyHealing == null ? '' : `技力协同干员的技能伤害会治疗当前生命值最低的友军，治疗量为该次伤害的${pct(v.AllyHealing)}。`}`;
    case 'Sniper': return `狙击干员与目标每相隔一格，伤害提高${v.PercentDamageIncrease}%。${Number.isFinite(v.BonusHexRangeIncrease)&&v.BonusHexRangeIncrease>0?`攻击距离增加${v.BonusHexRangeIncrease}格。`:''}`;
    case 'Conqueror': return `远征干员攻击力与术法伤害提高${pct(v.ADAPBase)}；每次击倒获得${v.StacksPerKill}点征服进度，累计达到10、35、65、100、150、200、330、440、550、660、750、850、1000、1200或1500点可领取一档奖励；每开启一箱，远征干员攻击力与术法伤害再提高${pct(v.PercentIncreasePerChest)}。`;
    case 'High Roller': return `圣枪干员施放技能时随机获得一种强化：发射${v.Bonus1NumRockets}枚火箭，每枚造成${v.Bonus1RocketDamage}点物理伤害；获得${v.Bonus2ShieldAmount}点护盾，持续${v.Bonus2ShieldDuration}秒；战斗结算时获得${v.Bonus4Gold}枚金币；或将本次强化效果扩大至三倍。每次施法还会获得${pct(v.Durability)}减伤，持续${v.Duration}秒。强化结果各占四种之一。`;
    case 'Academy': return `本局锁定三件赞助装备。达到本档后，累计领取${v.NumOfItems}件；每件由持有者获得${pct(v.PercentIncreaseSponsored)}最大生命与伤害增幅，研发干员持有时获得${pct(Number(v.PercentIncreaseSponsored)*2+Number(v.BaseValues))}。`;
    case 'Chem-Baron': return `每场战斗结算后获得${v.ShimmerPerCombat}点微光；连败达到${v.MinStreakLength}场时本场改为获得${v.ShimmerPerCombatStreaking}点，胜利会重置连败。每累计${v.ShimmerBreakpoint}点微光可选择一件险境装备或略过；略过后险境干员永久获得${v.HealthPerSkip}点生命。`;
    case 'Rebel': return `逆潮干员开战时最大生命值+${pct(v.MaxHealthIncrease)}；全队累计损失${pct(v.PercentHealthTrigger)}生命后，${v.PercentMaxHealthBonus == null ? '' : `逆潮干员最大生命值再提高${pct(v.PercentMaxHealthBonus)}，`}永久获得${pct(v.ADAP)}攻击力与术法伤害，并获得${pct(v.BurstAS)}攻速持续${v.BurstDuration}秒。${v.StunDuration == null ? '' : `信号还会使敌人眩晕${v.StunDuration}秒。`}${v.ForceDuration == null ? '' : `最高档从开战起每${v.ForceDuration}秒触发一次信号。`}`;
    case 'Dominator': return `掌控干员获得${v.ShieldAmount}点护盾，持续${v.ShieldDuration}秒；每消耗1点技力，术法伤害提高${pctPrecise(Number(v.APPercent??0)/100)}。`;
    case 'Pit Fighter': return `决斗干员全能吸血+${pct(v.OmnivampPercent)}、伤害转为额外真实伤害${pct(v.TrueDamagePercent)}；首次降至${pct(v.HealthThreshold)}生命时恢复${pct(v.HealPercent)}生命。`;
    case 'Enforcer': return `围剿干员获得${pct(v.BaseDA)}伤害增幅与相当于自身最大生命值${pct(v.PercentMaxHealthShield)}的护盾；开战标记${Number(v.NumOfWantedEnemies)>=99?'所有':v.NumOfWantedEnemies}名高生命敌人。每名被标记者被击倒后，所有围剿干员的攻速提高${pct(v.AttackSpeedPerWantedKill)}。`;
    case 'Firelight': return `游击干员每${v.Duration}秒冲刺；冲刺期间获得无限射程，并恢复所受伤害的${pct(v.PercentDamageTakenHeal)}。`;
    case 'Experiment': return `共生干员获得${v.MaxHealth}点生命值并开启${v.NumLaboratory}格实验室。处于实验室格的干员可共享实验效果；实验室内的干员造成伤害后追加相当于自身最大生命值${pct(Number(sourceHookHero(season,'TFT13_NunuWillump')?.experimentBonus?.sourceVariables?.ExperimentMaxHealthDamage??0.03))}的术法伤害（7人档翻倍）。${Number(v.ExperimentBonusIncrease??0)>0?`实验效果提高${pct(v.ExperimentBonusIncrease)}。`:''}`;
    case 'Bruiser': return `全队最大生命值+${v.TeamFlatHealth}；重装干员额外获得${pct(v.BonusPercentHealth)}最大生命值。`;
    case 'Junker King': return `每${v.NumRounds1Star}场已结算战斗开启一次${trait?.name??'盟约'}升级铺；由场上最强的${sourceHookHero(season,'TFT13_Rumble')?.operatorName??'该盟约干员'}选择一项永久机甲升级，按标价支付金币，也可暂不购买。`;
    case 'Black Rose': return `幻造守卫被锁链束缚；幻造干员施放${v.NumCastsToUnlock}次技能或守卫生命低于${pct(v.PercentHealthUnlock)}时解锁。解锁后守卫冲锋。${minUnits>=4?'冲锋命中的敌人会被标记，幻造干员对其伤害提高15%。':''}${minUnits>=5?'冲锋还会对附近敌人造成其最大生命值25%的伤害，并将守卫恢复至满生命。':''}守卫获得${v['{2e45fc86}']}点护甲评分对应的物理防护与法术抗性；技能获得175点护盾，并对直线敌人造成伤害与眩晕。${minUnits>=7?'守卫被击倒后以50%生命复生，并获得300%攻速与40%全能吸血。':''}`;
    case 'Quickstriker': return `迅击干员依据目标已损失生命值获得${pct(v.MinBonusAS)}至${pct(v.MaxBonusAS)}攻击速度。${v.ShieldAmount == null ? '' : `击倒目标后冲向新的目标，并获得${v.ShieldAmount}点护盾，持续${v.ShieldDuration}秒。`}`;
    case 'Watcher': return `守望干员基础减伤${pct(v.BaseDR)}；生命值高于${pct(v.HealthBreakpoint)}时提升至${pct(v.IncreasedDR)}。`;
    default: return '原型效果尚无中文适配。';
  }})();
  const terms={
    Automata:'机巧',Sorcerer:'术式',Scrap:'战地整备',Artillerist:'炮术','Form Swapper':'双形',Emissary:'领军',Sentinel:'坚阵',Family:'并肩',Ambusher:'突袭',Visionary:'技力协同',Sniper:'狙击',Conqueror:'远征','High Roller':'圣枪',Academy:'研发','Chem-Baron':'险境',Rebel:'逆潮',Dominator:'掌控','Pit Fighter':'决斗',Enforcer:'围剿',Firelight:'游击',Experiment:'共生',Bruiser:'重装','Junker King':'军械','Black Rose':'幻造',Quickstriker:'迅击',Watcher:'守望',
  };
  let localized=description;
  if(trait?.name)for(const oldTerm of terms[name]?[terms[name]]:[])localized=localized.split(`${oldTerm}干员`).join(`${trait.name}干员`);
  if(trait?.name&&name==='Junker King')localized=localized.split('军械铺').join(`${trait.name}升级铺`);
  return localized;
}

export function applyPrototypePacts(catalog) {
  const season=prototypeSeasonForCatalog(catalog);
  const pacts = {};
  for (const trait of season.traits) {
    const mechanic = trait.mechanic ?? mechanicByTrait[trait.sourceName];
    if (!mechanic) throw new Error(`PROTOTYPE_MECHANIC_MISSING:${trait.sourceName}`);
    const nativeIconId=catalog.pacts?.[trait.id]?.iconId??catalog.pacts?.[trait.id]?.icon??null;
    // Season 2 replaces every pact text with handwritten copy; earlier seasons keep their source-derived copy.
    const nativeCopy=season.strongholdPacts?strongholdPactCopy(trait,season,{itemName:(id)=>catalog.equipment?.[id]?.name??id})
      :season.powerModel==='native-pve'?{...nativePactCopy(trait,season)}:null;
    const overview=nativeCopy?.overview??trait.description;
    const sourceOperators=trait.members.map((charId)=>season.heroes.find((hero)=>hero.charId===charId)?.sourceChessId).filter(Boolean);
    pacts[trait.id] = {
      id:trait.id, name:trait.name, description:overview, icon:nativeIconId, iconId:nativeIconId,
      ...(nativeCopy?{summaryDescription:overview,...(nativeCopy.notes?.length?{detailNotes:nativeCopy.notes}:{})}:{}),
      ...(trait.strongholdPact?{stronghold:true}:{}),
      members:sourceOperators, memberCharIds:[...trait.members], thresholds:trait.effects.map((tier)=>tier.minUnits),
      group:trait.group??'prototype-natural-trait', nativeIconPath:trait.nativeIconPath, unique:false, natural:true, emblemRequired:trait.emblemRequired,
      exactCounts:trait.effects.filter((tier)=>tier.minUnits===tier.maxUnits).map((tier)=>tier.minUnits),
      source:{...clone(trait.reference),recordId:trait.sourceApiName,sourceEffectText:trait.description},
      levels:trait.effects.map((tier)=>({
        threshold:tier.minUnits,minUnits:tier.minUnits,maxUnits:tier.maxUnits,style:tier.style,
        description:nativeCopy?.tier(tier)??tierDescription(trait.sourceName,tier.variables,tier.minUnits,season),sourceVariables:clone(tier.sourceVariables??tier.variables),
        effects:[{kind:'prototype_trait',params:{traitId:trait.id,sourceName:trait.sourceName,mechanic,variables:clone(tier.variables),description:season.strongholdPacts?nativeCopy.tier(tier):tierDescription(trait.sourceName,tier.variables,tier.minUnits,season),sourceReference:clone(trait.reference)}}],
      })),
    };
  }
  const equipment={...(catalog.equipment??{})};
  const recipes=[...(catalog.recipes??[])];
  const componentMap={TFT_Item_Spatula:'crest',TFT_Item_FryingPan:null,TFT_Item_BFSword:'blade',TFT_Item_NegatronCloak:'cloak',TFT_Item_NeedlesslyLargeRod:'staff',TFT_Item_GiantsBelt:'belt',TFT_Item_TearOfTheGoddess:'tear',TFT_Item_RecurveBow:'bow',TFT_Item_ChainVest:'plate'};
  const emblemItems=[];
  for(const candidate of season.emblemCandidates??[]){
    const id=`prototype_emblem_${candidate.traitId}`;
    const sourceParts=candidate.composition??[];
    const parts=sourceParts.length===2?sourceParts.map((part)=>componentMap[part]??null):[];
    const craftable=parts.length===2&&parts.every(Boolean);
    const plainDescription=candidate.description.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    const item={id,name:season.powerModel==='native-pve'?`${pacts[candidate.traitId]?.name}徽记`:candidate.name,description:`佩戴者获得【${pacts[candidate.traitId]?.name}】盟约身份。`,kind:'emblem',unique:true,grantAllowed:true,prototype:true,source:{game:'Teamfight Tactics',version:'Set 13 patch 14.23',apiName:candidate.apiName,icon:candidate.icon,sourceComposition:candidate.composition,recipeEvidence:candidate.recipeEvidence,sourceEffects:candidate.effects},effects:[{kind:'transfer_pact',params:{pactId:candidate.traitId}}]};
    if(craftable){item.parts=parts;item.baseEffects=parts.flatMap((part)=>equipment[part]?.effects??[]);recipes.push({parts:[...parts].sort(),resultId:id,source:{apiName:candidate.apiName,recipeEvidence:'source composition mapped onto available Resonance components'}});}
    else item.grantOnly=true;
    equipment[id]=item;emblemItems.push(id);
  }
  const playerText={...(catalog.playerText??{}),pacts:{...(catalog.playerText?.pacts??{})},equipment:{...(catalog.playerText?.equipment??{})}};
  for(const [id,pact] of Object.entries(pacts))playerText.pacts[id]={name:pact.name,levels:pact.levels.map((level)=>({description:level.description}))};
  for(const itemId of emblemItems)playerText.equipment[itemId]={description:equipment[itemId].description};
  return {...catalog,pacts,equipment,recipes,playerText,prototypeSeason:season,prototypeEmblemItems:emblemItems};
}

/** Prepare battle-local Scrap conversions before the ordinary equipment installer runs. */
export function preparePrototypeScrapGear(battle,state,catalog,activeTraits=[]) {
  if(retiredEconomyTraitIds(prototypeSeasonForCatalog(catalog)).has('rhodes'))return {converted:0,components:0};
  const tier=activeTraits.find((entry)=>entry.id==='rhodes');
  if(!tier)return {converted:0,components:0};
  const members=new Set((tier.memberUids??[]).map(String));
  const operators=catalog?.operators??{};
  const recipes=(catalog?.recipes??[]).filter((recipe)=>{
    const item=catalog.equipment?.[recipe.resultId];
    return item&&item.kind!=='component'&&item.kind!=='emblem'&&Array.isArray(recipe.parts)&&recipe.parts.length===2;
  });
  // Battle construction precedes deployment; inventory still belongs to roster units while they are
  // in the pre-start state (alive/deployed are both false until Battle.start()).
  const holders=(battle?.allyUnits??[]).filter((unit)=>unit?.kind==='op'&&!unit.removed&&(!members.size||members.has(String(unit.uid))));
  const available=[];
  for(const unit of holders){
    for(const [index,item] of (unit.items??[]).entries()){
      const itemId=typeof item==='string'?item:item?.itemId??item?.id;
      if(catalog?.equipment?.[itemId]?.kind!=='component')continue;
      const matches=recipes.filter((recipe)=>recipe.parts.includes(itemId));
      if(!matches.length)continue;
      available.push({unit,index,item,itemId,matches});
    }
  }
  const cap=Math.max(0,Math.floor(Number(tier.variables?.NumComponents??0)));
  const selected=available.slice(0,cap);
  const lucky=Number(tier.variables?.['{659aef8d}']??0)>0;
  const radiant=Number(tier.variables?.['{7e2474c8}']??0)>0;
  const roleProfile=(unit)=>{
    const raw=unit?.def?.raw??unit?.def??{};
    const sourceId=raw.id??raw.chessId??unit?.defId;
    const role=operators[sourceId]?.role??'damage';
    return role==='frontline'?{profile:'frontline',atk:0.25,aspd:0.2,crit:0.1,arts:0.1,sp:0.15,def:2,res:2,hp:1,shield:1}
      :role==='support'?{profile:'support',atk:0.3,aspd:0.2,crit:0.1,arts:1,sp:2,def:0.6,res:0.6,hp:0.7,shield:0.8}
      :{profile:'damage',atk:1.4,aspd:1,crit:1,arts:0.65,sp:0.6,def:0.2,res:0.2,hp:0.2,shield:0.2};
  };
  const itemFit=(item,profile)=>{
    const values={};
    for(const effect of item?.effects??[])for(const [key,value] of Object.entries(effect?.params??{}))
      if(Number.isFinite(Number(value))&&Number(value)>0)values[key]=(values[key]??0)+Number(value);
    const weights={atk:profile.atk,aspd:profile.aspd,crit:profile.crit,arts:profile.arts,sp:profile.sp,def:profile.def,res:profile.res,hp:profile.hp,shield:profile.shield};
    return Object.entries(weights).reduce((sum,[key,weight])=>sum+Number(values[key]??0)*weight,0);
  };
  for(const component of selected){
    const recipesForPart=component.matches.slice().sort((a,b)=>String(a.resultId).localeCompare(String(b.resultId)));
    const role=roleProfile(component.unit);
    const ranked=recipesForPart.map((recipe)=>({recipe,score:itemFit(catalog.equipment?.[recipe.resultId],role)}));
    const bestScore=Math.max(...ranked.map((entry)=>entry.score));
    const best=ranked.filter((entry)=>entry.score===bestScore);
    const roll=Math.max(0,Math.min(0.999999,Number(battle.rng?.()??0)));
    const pool=lucky?best:ranked;
    const chosen=pool[Math.floor(roll*pool.length)];
    const recipe=chosen.recipe;
    const holder=component.unit;
    const localId=String(component.item?.uid??component.item?.itemUid??`${holder.uid}:held:${component.index}:${component.itemId}`);
    holder.mem.prototypeConsumedComponents??=[];
    if(holder.mem.prototypeConsumedComponents.includes(localId))continue;
    holder.mem.prototypeConsumedComponents.push(localId);
    holder.mem.prototypeTemporaryItems??=[];
    holder.mem.prototypeTemporaryItems.push({itemId:recipe.resultId,quality:radiant?'radiant':lucky?'lucky':'normal',sourceComponentIds:[localId],sourceComponents:[component.itemId],sourceTraitId:'rhodes',isTemporary:true,source:{season:'Set 13 patch 14.23',variableFlags:{lucky:lucky?1:0,radiant:radiant?1:0},selection:lucky?'role-fit highest weighted native item stat profile; seeded tie-break':'seeded uniform among recipes containing the selected component',roleProfile:role.profile,fitScore:chosen.score,fitInputs:role}});
  }
  return {converted:selected.length,components:available.length,quality:radiant?'radiant':lucky?'lucky':'normal'};
}

/** Attach serializable, source-tier-scoped battle instrumentation for the v3 adapter. */
export function installPrototypePacts(battle,catalog,activeTraits=[]) {
  const season=prototypeSeasonForCatalog(catalog);
  const consumedTraits=activeTraits.map((entry)=>{
    const pact=catalog?.pacts?.[entry.id];
    const tier=pact?.levels?.find((row)=>row.threshold===entry.tier);
    const effect=tier?.effects?.find((row)=>row.kind==='prototype_trait');
    if(!effect)throw new Error(`PROTOTYPE_TRAIT_EFFECT_NOT_CONSUMED:${entry.id}:${entry.tier}`);
    return {...entry,variables:clone(effect.params?.variables??{}),mechanic:effect.params?.mechanic??entry.mechanic};
  });
  // A redesigned pact (season 2) is installed by stronghold-pacts.js; its season-1 adapter below stays silent.
  const redesigned=redesignedTraitIds(season);
  const active=new Map(consumedTraits.filter((entry)=>!redesigned.has(entry.id)).map((entry)=>[entry.id,entry]));
  const operators=catalog?.operators??{};
  const byChar=new Map(Object.values(operators).map((operator)=>[operator.charId,operator]));
  const bySource=new Map(Object.values(operators).map((operator)=>[operator.sourceChessId,operator]));
  const ownedUnit=(unit)=>unit?.kind==='token'&&unit.ownerUnit?unit.ownerUnit:unit;
  const charIdOf=(unit)=>{
    const owner=ownedUnit(unit);
    const raw=owner?.def?.raw??owner?.def??{};
    return raw.charId??bySource.get(raw.id??raw.chessId??owner?.defId)?.charId??null;
  };
  const sourceApiOf=(unit)=>{
    const owner=ownedUnit(unit),raw=owner?.def?.raw??owner?.def??{},sourceId=raw.id??raw.chessId??owner?.defId;
    return season.heroes.find((hero)=>hero.sourceChessId===sourceId)?.apiName??null;
  };
  const powerReferenceFor=(unit)=>season.heroes.find((hero)=>hero.apiName===sourceApiOf(unit))?.nativePowerReference??season.heroes.find((hero)=>hero.apiName===sourceApiOf(unit))?.powerReference??{};
  const applyRating=(unit,key,armor,magicResist)=>setPrototypeRatingBonus(battle,unit,key,{armor,magicResist},powerReferenceFor(unit));
  const traitIdsFor=(unit)=>{
    const owner=ownedUnit(unit),charId=charIdOf(owner),operator=byChar.get(charId);
    if(operator?.ignoresDeployLimit===true)return new Set();   // 正义骑士号 is in no 盟约
    return new Set([...(operator?.pacts??[]),...(owner?.extraPacts??[]),...(owner?.def?.raw?.extraPacts??[]),...(owner?.mem?.resonancePacts??[])]);
  };
  const isActiveMember=(unit,traitId)=>active.has(traitId)&&traitIdsFor(unit).has(traitId);
  const counters={};
  const contributions=new Map();
  const rowFor=(unit)=>{
    const owner=ownedUnit(unit),charId=charIdOf(owner);
    if(!charId)return null;
    const row=contributions.get(charId)??{charId,damage:0,healing:0,summonDamage:0,kills:0,attacks:0,skills:0,damageTaken:0,shieldAbsorbed:0,shieldLayersBroken:0,controlAppliedMs:0,controlApplications:0};
    contributions.set(charId,row);
    return row;
  };
  const refresh=()=>{battle.resonanceContributions=[...contributions.values()].map((row)=>({...row}));};
  battle.on('shieldAbsorbed',(event)=>{
    const unit=ownedUnit(event?.unit),row=rowFor(unit);
    if(!row||unit?.side!=='ally')return;
    row.shieldAbsorbed+=Math.max(0,Number(event?.amount??0));
    if(event?.kind==='layer')row.shieldLayersBroken+=Math.max(0,Number(event?.layers??1));
    refresh();
  },{owner:battle});
  const count=(unit,eventName)=>{
    if(unit?.side!=='ally')return;
    const ids=traitIdsFor(unit);
    for(const id of ids){
      const tier=active.get(id);if(!tier)continue;
      const record=counters[id]??{tier:tier.tier,count:tier.count,mechanic:tier.mechanic,attacks:0,casts:0,kills:0,damageEvents:0,damageTakenEvents:0};
      if(eventName==='attack')record.attacks++;
      else if(eventName==='skillStart')record.casts++;
      else if(eventName==='kill')record.kills++;
      else if(eventName==='damage')record.damageEvents++;
      else if(eventName==='damageTaken')record.damageTakenEvents++;
      counters[id]=record;
    }
  };
  battle.resonanceMetrics??={};
  battle.resonanceMetrics.prototypeTraits=counters;
  battle.resonanceContributions=Array.isArray(battle.resonanceContributions)?battle.resonanceContributions:[];
  let experimentLabUnits=[];
  const experimentSourcesFor=(unit)=>unit?.mem?.prototypeExperimentSources??[];
  const applyUrgotExperiment=(unit,variables)=>{
    const scale=active.get('experiment')?.tier>=7?2:1;
    const target=battle.enemies.filter((enemy)=>enemy?.alive&&enemy.deployed&&!enemy.hidden)
      .sort((a,b)=>Math.hypot(a.tileR-unit.tileR,a.tileC-unit.tileC)-Math.hypot(b.tileR-unit.tileR,b.tileC-unit.tileC)||a.id-b.id)[0];
    if(target){
      const rect=battle.rect,cells=[];
      for(let row=rect.r0;row<=rect.r1;row++)for(let col=rect.c0;col<=rect.c1;col++)
        if(Math.abs(row-target.tileR)+Math.abs(col-target.tileC)===1&&battle.grid.canStand(row,col)&&!battle.unitAt(row,col)&&!battle.downOn(row,col,unit))cells.push([row,col]);
      cells.sort((a,b)=>Math.hypot(a[0]-unit.tileR,a[1]-unit.tileC)-Math.hypot(b[0]-unit.tileR,b[1]-unit.tileC)||a[0]-b[0]||a[1]-b[1]);
      if(cells[0]&&battle.moveRedeploy(unit,cells[0][0],cells[0][1]))metric('experiment','urgotDashes');
    }
    battle.addBuff(unit,{key:`resonance:v3:experiment-urgot-shield:${unit.id}:${battle.time}`,shield:unit.s.maxHp*Number(variables.ExperimentPercentHealthShield??0)*scale,duration:Number(variables.ExperimentDuration??5),tags:['resonance','prototype-experiment']});
    buff(unit,`experiment-urgot-attack-speed-${battle.time}`,{aspd:Number(variables.ExperimentAttackSpeed??0)*100*scale},Number(variables.ExperimentDuration??5));
    metric('experiment','urgotBonusTriggers');
  };
  battle.on('attack',(event)=>count(event?.attacker,'attack'),{owner:battle});
  battle.on('attack',(event)=>{
    const unit=event?.attacker,target=event?.target;
    if(!unit||!target?.alive||!experimentSourcesFor(unit).includes('TFT13_Twitch'))return;
    const key='prototypeExperimentTwitchAttacks';unit.mem[key]=(Number(unit.mem[key])||0)+1;
    const needed=Number(season.heroes.find((hero)=>hero.apiName==='TFT13_Twitch')?.experimentBonus?.sourceVariables?.ExperimentDamageTicks??5);
    if(unit.mem[key]>=needed){unit.mem[key]=0;const amount=target.s.maxHp*Number(season.heroes.find((hero)=>hero.apiName==='TFT13_Twitch')?.experimentBonus?.sourceVariables?.ExperimentMaxHealthDamage??0.15)*(active.get('experiment')?.tier>=7?2:1);battle.dealDamage(unit,target,{amount,type:'phys',canDodge:false,tags:['resonance','prototype-experiment','twitch-bonus']});metric('experiment','twitchBonusHits');}
  },{owner:battle});
  battle.on('attack',(event)=>{const row=rowFor(event?.attacker);if(row)row.attacks++;refresh();},{owner:battle});
  battle.on('skillStart',(event)=>{
    const unit=event?.unit;count(unit,'skillStart');
    const row=rowFor(unit);if(row)row.skills++;
    refresh();
  },{owner:battle});
  battle.on('kill',(event)=>count(event?.killer,'kill'),{owner:battle});
  battle.on('battleStart',()=>{
    for(const unit of liveOps())rowFor(unit);
    refresh();
    const experiment=active.get('experiment');
    if(experiment){
      const labs=new Set((experiment.labCells??[]).map((cell)=>`${Number(cell.row)},${Number(cell.col)}`));
      const candidates=liveOps().filter((unit)=>isActiveMember(unit,'experiment'));
      experimentLabUnits=candidates.filter((unit)=>labs.has(`${unit.tileR},${unit.tileC}`));
      const sourceApis=experimentLabUnits.map((unit)=>sourceApiOf(unit)).filter(Boolean);
      for(const unit of experimentLabUnits){
        unit.mem.prototypeExperimentLab=true;
        unit.mem.prototypeExperimentSources=[...sourceApis];
        const hp=Number(experiment.variables?.MaxHealth??0);
        if(hp>0)buff(unit,'experiment-lab-health',{hpFlat:hp});
        const mundo=season.heroes.find((hero)=>hero.apiName==='TFT13_DrMundo')?.experimentBonus?.sourceVariables;
        if(sourceApis.includes('TFT13_DrMundo')&&mundo?.BaseExperimentHealthGain)
          buff(unit,'experiment-lab-mundo-health',{hpFlat:Number(mundo.BaseExperimentHealthGain)*(experiment.tier>=7?2:1)});
        if(sourceApis.includes('TFT13_Urgot'))applyUrgotExperiment(unit,season.heroes.find((hero)=>hero.apiName==='TFT13_Urgot').experimentBonus.sourceVariables);
      }
      metric('experiment','labbedMembers',experimentLabUnits.length);
      metric('experiment','labCells',labs.size);
    }
  },{owner:battle});
  battle.on('kill',(event)=>{
    const killer=event?.killer;
    if(killer?.side==='ally'&&killer.kind==='op'){
      const row=rowFor(killer);if(row)row.kills=(row.kills??0)+1;
      refresh();
    }
  },{owner:battle});
  battle.on('damaged',(event)=>{
    const source=event?.source,target=event?.target;
    if(source?.side==='ally'&&target?.side==='enemy'){
      const row=rowFor(source);
      if(row){const field=source.kind==='token'?'summonDamage':'damage';row[field]=(row[field]??0)+Math.max(0,Number(event.dealt)||0);}
      count(source,'damage');
    }
    if(target?.side==='ally'){
      count(target,'damageTaken');
      const row=rowFor(target);if(row)row.damageTaken=(row.damageTaken??0)+Math.max(0,Number(event.dealt)||0);
    }
    refresh();
  },{owner:battle});
  battle.on('healed',(event)=>{
    if(event?.source?.side==='ally'){
      const row=rowFor(event.source);if(row)row.healing=(row.healing??0)+Math.max(0,Number(event.amount)||0);
      refresh();
    }
  },{owner:battle});
  const controlStatuses=new Set(['stun','freeze','bind','sleep','fear','disarm','sluggish','slow','silence','palsy','levitate']);
  battle.on('statusApplied',(event)=>{
    const source=event?.source,target=event?.target;
    if(source?.side!=='ally'||target?.side!=='enemy'||!controlStatuses.has(event?.status)||event?.entered===false)return;
    const row=rowFor(source);if(!row)return;
    const duration=Number(event.duration);
    row.controlApplications=(row.controlApplications??0)+1;
    if(Number.isFinite(duration))row.controlAppliedMs=(row.controlAppliedMs??0)+Math.max(0,duration)*1000;
    refresh();
  },{owner:battle});
  const liveOps=()=>battle.allyUnits.filter((unit)=>unit?.kind==='op'&&unit.alive&&unit.deployed&&!unit.removed);
  const traitMembers=(trait)=>liveOps().filter((unit)=>isActiveMember(unit,trait));
  const buff=(unit,key,mods,duration=Infinity)=>battle.addBuff(unit,{key:`resonance:v3:${key}:${unit.id}`,duration,mods,tags:['resonance','prototype-trait']});
  const metric=(trait,key,amount=1)=>{
    const row=counters[trait]??{tier:active.get(trait)?.tier,count:active.get(trait)?.count,mechanic:active.get(trait)?.mechanic};
    row[key]=(row[key]??0)+amount;counters[trait]=row;
  };
  const vars=(trait)=>active.get(trait)?.variables??{};
  const triggerRebelSignal=(grantHealth=false)=>{
    const tier=active.get('resistance');if(!tier)return;
    const members=traitMembers('resistance');
    for(const unit of members){
      buff(unit,'rebel-power',{atkPct:Number(tier.variables?.ADAP??0),artsDealtMul:1+Number(tier.variables?.ADAP??0)},Infinity);
      buff(unit,'rebel-burst',{aspd:Number(tier.variables?.BurstAS??0)*100},Number(tier.variables?.BurstDuration??4));
      const hpBonus=Number(tier.variables?.PercentMaxHealthBonus??0);
      if(grantHealth&&hpBonus>0&&!unit.mem.prototypeRebelHealthBonusGranted){
        buff(unit,'rebel-signal-health',{hpPct:hpBonus},Infinity);
        unit.mem.prototypeRebelHealthBonusGranted=true;
      }
    }
    if(Number(tier.variables?.StunDuration)>0)
      for(const enemy of battle.enemies.filter((row)=>row.alive&&row.deployed))battle.applyStatus(enemy,'stun',{duration:Number(tier.variables.StunDuration),source:members[0]??null});
    metric('resistance','signals');
  };
  const roseState={token:null,casts:0,freed:false,revived:false};
  const sionSource=season.summonedEntities?.TFT13_Sion??null;
  const sionVariable=(name,fallback=0)=>Number(sionSource?.ability?.variables?.find((entry)=>entry.name===name)?.value?.[0]??fallback);
  const roseMembers=()=>traitMembers('sui');
  const formSwapMembers=new Set(season.traits.find((trait)=>trait.id==='formSwap')?.members??[]);
  const freeSion=(healOnFree=false)=>{
    const unit=roseState.token;if(!unit?.alive||roseState.freed)return false;
    roseState.freed=true;unit.mem.prototypeRoseChained=false;unit.profile.noAttack=false;
    const nearest=battle.enemies.filter((enemy)=>enemy?.alive&&enemy.deployed&&!enemy.hidden)
      .sort((a,b)=>Math.hypot(a.x-unit.x,a.y-unit.y)-Math.hypot(b.x-unit.x,b.y-unit.y)||a.id-b.id)[0];
    if(nearest){
      for(let step=0;step<12&&Math.hypot(nearest.tileR-unit.tileR,nearest.tileC-unit.tileC)>1.5;step++){
        const next=[unit.tileR+Math.sign(nearest.tileR-unit.tileR),unit.tileC+Math.sign(nearest.tileC-unit.tileC)];
        if((next[0]===unit.tileR&&next[1]===unit.tileC)||!battle.grid.canStand(next[0],next[1],{ranged:false})||battle.unitAt(next[0],next[1])||battle.downOn(next[0],next[1])||!battle.relocate(unit,next[0],next[1]))break;
      }
      const radius=sionVariable('NovaRadius',2),near=battle.enemies.filter((enemy)=>enemy.alive&&Math.hypot(enemy.tileR-unit.tileR,enemy.tileC-unit.tileC)<=radius);
      let novaHits=0;
      for(const enemy of near){
        if(Number(active.get('sui')?.tier)>=4){
          enemy.mem.prototypeRoseChargeUntil=Math.max(Number(enemy.mem.prototypeRoseChargeUntil??0),battle.time+sionVariable('ChargeDamageAmpDuration',60));
          battle.addBuff(enemy,{key:`resonance:v3:sion-charge-mark:${enemy.id}`,duration:sionVariable('ChargeDamageAmpDuration',60),tags:['resonance','prototype-sion']});
        }
        battle.applyStatus(enemy,'stun',{duration:sionVariable('ChargeKnockupDuration',0.5),source:unit});
        battle.dealDamage(unit,enemy,{amount:unit.s.atk*sionVariable('ChargeADPercent',1),type:'phys',canDodge:false,tags:['resonance','prototype-sion','charge']});
        if(Number(active.get('sui')?.tier)>=5){battle.dealDamage(unit,enemy,{amount:enemy.s.maxHp*sionVariable('NovaPercentHealthDamage',0.25),type:'phys',canDodge:false,tags:['resonance','prototype-sion','nova']});novaHits++;}
      }
      metric('sui','sionCharges');if(novaHits)metric('sui','sionNovaHits',novaHits);
    }
    if(Number(active.get('sui')?.tier)>=5){unit.hp=unit.s.maxHp;metric('sui','sionFullHeal');}
    metric('sui','sionFreed');return true;
  };
  const spawnSion=()=>{
    if(roseState.token||!sionSource)return;
    const owner=roseMembers()[0];if(!owner)return;
    const cells=[];
    for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){
      if(!dr&&!dc)continue;const r=owner.tileR+dr,c=owner.tileC+dc;
      if(battle.grid.canStand(r,c,{ranged:false})&&!battle.unitAt(r,c)&&!battle.downOn(r,c))cells.push([r,c]);
    }
    cells.sort((a,b)=>Math.hypot(a[0]-owner.tileR,a[1]-owner.tileC)-Math.hypot(b[0]-owner.tileR,b[1]-owner.tileC)||a[0]-b[0]||a[1]-b[1]);
    const cell=cells[0];if(!cell)return;
    const totalStars=roseMembers().reduce((sum,row)=>sum+Number(row.def?.raw?.resonanceStar??1),0);
    const stats=sionSource.stats??{},traitVariables=vars('sui'),hp=nativeFlatAmount(season,stats.hp??750)*(1+Number(traitVariables.PercentHealthPerStarLevel??0.15)*totalStars);
    const sionArmor=Number(traitVariables['{2e45fc86}']??0),sourceAttackSpeed=Math.max(0.01,Number(stats.attackSpeed??0.7));
    const guardianName=season.powerModel==='native-pve'?'山海卫灵':'幻造守卫';
    const defenseAnchor=season.powerModel==='native-pve'?1500:(stats.damage??50);
    const def={id:'prototype_TFT13_Sion',name:guardianName,profession:'TOKEN',position:'MELEE',stats:{maxHp:hp,atk:nativeFlatAmount(season,stats.damage??50),def:tftArmorToNativeDefense(sionArmor,defenseAnchor)??0,res:tftMrToNativeResistance(sionArmor)??0,aspd:100,bat:1/sourceAttackSpeed,blockCnt:1,cost:0,respawnTime:0},rangeGrid:[[0,0],[0,1]],spine:'token_10022_kazema_shadow',avatar:'token_10022_kazema_shadow',description:guardianName};
    roseState.token=battle.spawnToken(owner,def.id,cell[0],cell[1],{def,anySource:true,kit:{skill:null,trait:{noAttack:true}}});
    if(roseState.token){
      roseState.token.mem.prototypeRoseChained=true;
      const skillDef={id:'prototype_sion_decimating_smash',name:'幻造猛击',spCost:Number(stats.mana??120),initSp:Number(stats.initialMana??120),spType:'time',skillType:'MANUAL'};
      const skillSpec={id:skillDef.id,name:skillDef.name,kind:'instant',trigger:'NEVER',attack:{dmgType:'phys'},onStart:({battle,unit})=>{
        const target=battle.enemies.filter((enemy)=>enemy?.alive&&enemy.deployed&&!enemy.hidden).sort((a,b)=>Math.hypot(a.x-unit.x,a.y-unit.y)-Math.hypot(b.x-unit.x,b.y-unit.y)||a.id-b.id)[0];
        if(!target)return;
        battle.addBuff(unit,{key:`resonance:v3:sion-active-shield:${unit.id}`,shield:nativeFlatAmount(season,sionVariable('Shield',175)),duration:sionVariable('ShieldDuration',5),tags:['resonance','prototype-sion']});
        const dr=Math.sign(target.tileR-unit.tileR),dc=Math.sign(target.tileC-unit.tileC),length=sionVariable('SlamHexLength',3),seen=new Set();
        for(let step=1;step<=length;step++){
          const victim=battle.unitAt(unit.tileR+dr*step,unit.tileC+dc*step);
          if(victim?.side!=='enemy'||!victim.alive||seen.has(victim.id))continue;
          seen.add(victim.id);battle.dealDamage(unit,victim,{amount:unit.s.atk*sionVariable('ADPercent',3),type:'phys',canDodge:false,isSkill:true,tags:['resonance','prototype-sion','active']});
          battle.applyStatus(victim,'stun',{duration:sionVariable('StunDuration',1.5),source:unit});
        }
        metric('sui','sionActiveCasts');
      }};
      roseState.token.skill=new SkillRuntime(battle,roseState.token,skillDef,skillSpec,{});
      if(skillDef.initSp>0)roseState.token.skill.gainSp(skillDef.initSp,'prototypeSionInitial');
      metric('sui','sionSummoned');
    }
  };
  // Runtime adapters for Set 13 variables that map to the simulator's supported combat hooks.
  // Effects that require a PvP board, non-native unit shops, equipment sponsorship or campaign inventory stay explicit in the catalog,
  // but are not falsely substituted by passive stats here.
  battle.on('battleStart',()=>{
    const all=liveOps();
    if(active.has('sui'))spawnSion();
    // season 2 决斗: below the health threshold a member attacks faster (no lifesteal, no emergency heal)
    const pitSpeed=Number(active.get('breaker')?.variables?.LowHealthAspd??0);
    if(pitSpeed>0)battle.every(.25,()=>{
      const threshold=Number(active.get('breaker')?.variables?.HealthThreshold??0.5);
      for(const unit of traitMembers('breaker'))if(unit.alive&&unit.hpRatio<threshold)battle.addBuff(unit,{key:`resonance:v3:pit-fury:${unit.id}`,mods:{aspd:pitSpeed},duration:.5,tags:['resonance','prototype-trait']});
    },{owner:battle});
    for(const unit of all){
      if(!formSwapMembers.has(charIdOf(unit)))continue;
      const form=prototypeFormForRow(unit.tileR,battle.rect);
      if(!form)continue;
      unit.mem.prototypeFormSwap=form;
      unit.mem.prototypeFormSwapSkillId=unit.skill?.id??null;
      if(unit.skill){
        const spec=unit.skill.spec??{};
        const targeting={...(spec.targeting??{})};
        if(form==='backline')targeting.rangeExtend=(Number(targeting.rangeExtend)||0)+PROTOTYPE_FORM_SWAP.backlineSkillRangeExtension;
        unit.skill.spec={...spec,targeting,prototypeFormSwap:{mode:form,skillId:unit.skill.id,policy:PROTOTYPE_FORM_SWAP.modeSkillPolicy}};
        battle.refreshRange?.(unit);
      }
      metric('formSwap',form==='frontline'?'frontlineForms':'backlineForms');
    }
    for(const id of active.keys()){
      const v=vars(id),members=traitMembers(id);
      if(id==='formSwap'){
        for(const unit of members){
          const frontline=unit.mem.prototypeFormSwap==='frontline';
          // season 2: the front form slows what it hits (FrontSlow) instead of taking less damage
          if(frontline&&Number(v.FrontSlow)>0){unit.mem.prototypeFrontSlow={value:Number(v.FrontSlow),duration:Number(v.FrontSlowDuration??2)};continue;}
          buff(unit,`form-swap-${frontline?'frontline':'backline'}`,frontline?{dmgTakenMul:1-Number(v.DR??0)}:{dmgDealtMul:1+Number(v.DA??0)});
        }
      }
      if(id==='arts'){
        for(const unit of all.filter((row)=>!isActiveMember(row,'arts')))buff(unit,'arts-team',{artsDealtMul:1+Number(v.TeamAP??0)/100});
        for(const unit of members)buff(unit,'arts-member',{artsDealtMul:1+Number(v.BaseAP??0)/100});
      }
      if(id==='sentinel'){
        for(const unit of all)applyRating(unit,'sentinel-team',Number(v.BonusArmor??0),Number(v.BonusArmor??0));
        for(const unit of members)applyRating(unit,'sentinel-member',Number(v.BonusArmor??0)*2,Number(v.BonusArmor??0)*2);
      }
      if(id==='bruiser'){
        for(const unit of all)buff(unit,'bruiser-team',{hpFlat:Number(v.TeamFlatHealth??0)});
        for(const unit of members)buff(unit,'bruiser-member',{hpPct:Number(v.BonusPercentHealth??0)});
      }
      if(id==='resistance')for(const unit of members){
        const bonus=Number(v.MaxHealthIncrease??0);
        if(bonus>0)buff(unit,'rebel-health',{hpPct:bonus});
        if(Number(v.ForceDuration)>0)unit.mem.prototypeRebelNextSignal=Number(v.ForceDuration);
      }
      if(id==='creation') for(const unit of members)applyRating(unit,'automata',Number(v.Resists??0),Number(v.Resists??0));
      if(id==='artillery') for(const unit of members)buff(unit,'artillerist-ad',{atkPct:Number(v.AD??0)});
      if(id==='dominator'){
        const give=(unit)=>battle.addBuff(unit,{key:`resonance:v3:dominator-shield:${unit.id}`,shield:Number(v.ShieldAmount??0),duration:Number(v.ShieldDuration??15),tags:['resonance','prototype-trait']});
        if(Number(v.ShieldOnFirstContact)>0||Number(v.SpOnFirstContact)>0){
          // season 2: the field is empty when the battle starts, so each member's reward comes when an enemy first enters its
          // attack range (members that never attack, such as a trapmaster, included): SP to cast sooner, or the old 屏障
          const waiting=new Set(members);
          const contact=(unit)=>{
            if(!waiting.delete(unit))return;
            if(Number(v.SpOnFirstContact)>0){unit.skill?.gainSp?.(Number(v.SpOnFirstContact),'prototypeDominatorContact');metric('dominator','contactSp');}
            else{give(unit);metric('dominator','contactShields');}
          };
          battle.every(.25,()=>{
            for(const unit of waiting)if(unit.alive&&unit.deployed&&battle.anyEnemyInKeys(unit.rangeKeys||[]))contact(unit);
          },{owner:battle});
          battle.on('hit',(event)=>{if(waiting.has(event?.source)&&event.target?.side==='enemy')contact(event.source);},{owner:battle});
        }else for(const unit of members)give(unit);
      }
      if(id==='emissary'){
        const emissaryUnits=all.filter((unit)=>isActiveMember(unit,'emissary'));
        const emissaryApis=new Set(emissaryUnits.map(sourceApiOf));
        if(emissaryApis.has('TFT13_Tristana'))for(const ally of all){
          const star=Number(ally?.def?.raw?.resonanceStar??ally?.def?.resonance?.star??1);
          buff(ally,'emissary-tristana-team',{aspd:Number(v.StarAS??0)*100*star});
        }
        if(emissaryApis.has('TFT13_Garen')){
          const garen=emissaryUnits.find((unit)=>sourceApiOf(unit)==='TFT13_Garen');
          if(garen)for(const ally of all){
            if(ally===garen||(ally.tileR===garen.tileR&&Math.abs(ally.tileC-garen.tileC)===1))
              buff(ally,`emissary-garen-${ally.id}`,{hpFlat:garen.s.maxHp*Number(v.GarenHealthPercent??0)});
          }
        }
        if(Number(active.get(id)?.count)===4)for(const unit of emissaryUnits)
          buff(unit,'emissary-four-member',{hpFlat:Number(v.BonusHealth??0),dmgDealtMul:1+Number(v.SelfishDamageAmp??0)});
        if(emissaryApis.has('TFT13_Ambessa')&&[1,4].includes(Number(active.get(id)?.count))){
          if(Number.isFinite(Number(v.AmbessaDefPct))){
            // season 2: a fixed native DEF% / RES share instead of the win-count armor rating
            for(const ally of all)buff(ally,'emissary-ambessa',{defPct:Number(v.AmbessaDefPct),resFlat:Number(v.AmbessaResFlat??0)});
            metric('emissary','ambessaAllies',all.length);
          }else{
            const wins=Math.max(0,Math.min(7,Math.floor(Number(active.get(id)?.pveWins??0))));
            const armor=Number(v.AmbessaArmor_PVE??0);
            if(wins>0&&armor>0){
              for(const ally of all)applyRating(ally,'emissary-ambessa',wins*armor,wins*armor);
              metric('emissary','ambessaWinStacks',wins);
            }
          }
        }
        if(emissaryApis.size)metric('emissary','championBonuses',emissaryApis.size);
      }
      if(id==='rhodes'){
        const componentsHeld=liveOps().reduce((total,holder)=>total+(holder.items??[]).reduce((n,item)=>{
          const itemId=typeof item==='string'?item:item?.itemId??item?.id;
          const record=catalog.equipment?.[itemId];
          if(record?.kind==='component')return n+1;
          const parts=record?.parts?.length?record.parts:record?.source?.composition?.length?record.source.composition:record?.composition??[];
          return n+parts.filter((part)=>{
            const component=catalog.equipment?.[part]??Object.values(catalog.equipment??{}).find((candidate)=>candidate?.sourceApiName===part||candidate?.apiName===part);
            return component?.kind==='component';
          }).length;
        },0),0);
        for(const unit of members)battle.addBuff(unit,{key:`resonance:v3:scrap-shield:${unit.id}`,shield:componentsHeld*Number(v.HPShieldAmount??0),duration:Number(v.ShieldDuration??30),tags:['resonance','prototype-trait']});
        metric('rhodes','shieldComponents',componentsHeld);
      }
      if(id==='family') for(const unit of members){buff(unit,'family',{aspd:Number(v.AttackSpeed??0)*100,dmgTakenMul:1-Number(v.DamageReduction??0)});if(unit.skill)unit.skill.spCostMul=1-Number(v.ManaReduction??0);}
      if(id==='conqueror') for(const unit of members)buff(unit,'conqueror-base',{atkPct:Number(v.ADAPBase??0),artsDealtMul:1+Number(v.ADAPBase??0)});
      if(id==='ammo') for(const unit of members)if(Number(v.BonusHexRangeIncrease)>0)buff(unit,'sniper-range',{rangeExtend:Number(v.BonusHexRangeIncrease)});
      if(id==='enforcer'){
        for(const unit of members){
          buff(unit,'enforcer-base',{dmgDealtMul:1+Number(v.BaseDA??0)});
          battle.addBuff(unit,{key:`resonance:v3:enforcer-shield:${unit.id}`,shield:unit.s.maxHp*Number(v.PercentMaxHealthShield??0),duration:Infinity,tags:['resonance','prototype-trait']});
        }
      }
      if(id==='redeploy'&&Number(v.DamageReductionPct??0)>0)
        for(const unit of members)buff(unit,'ambusher-durability',{dmgTakenMul:1-Number(v.DamageReductionPct)});
      if(id==='resistance'&&Number(v.ForceDuration)>0)triggerRebelSignal();
      if(id==='combo') for(const unit of members)buff(unit,'quickstriker-base',{aspd:Number(v.MinBonusAS??0)*100});
    }
  },{owner:battle});
  battle.on('skillEnd',(event)=>{
    const unit=event?.unit;if(!unit||!experimentSourcesFor(unit).includes('TFT13_Urgot'))return;
    applyUrgotExperiment(unit,season.heroes.find((hero)=>hero.apiName==='TFT13_Urgot').experimentBonus.sourceVariables);
  },{owner:battle});
  battle.on('kill',(event)=>{
    const killer=event?.killer;if(!killer||event?.victim?.side!=='enemy'||!killer.alive||!experimentSourcesFor(killer).includes('TFT13_DrMundo'))return;
    const source=season.heroes.find((hero)=>hero.apiName==='TFT13_DrMundo')?.experimentBonus?.sourceVariables;
    const amount=Number(source?.ExperimentHealthGain??0)*(active.get('experiment')?.tier>=7?2:1);
    if(amount>0){battle.addBuff(killer,{key:`resonance:v3:experiment-mundo-takedown:${killer.id}:${event.victim?.id??battle.time}`,persist:true,allowDead:true,mods:{hpFlat:amount},tags:['resonance','prototype-experiment']});metric('experiment','mundoTakedownHealth',amount);}
  },{owner:battle});
  battle.on('damaged',(event)=>{
    const source=event?.source,target=event?.target,amount=Number(event?.dealt??0),dmg=event?.dmg;
    if(source?.side!=='ally'||target?.side!=='enemy'||!target.alive||!(amount>0)||dmg?.tags?.includes('prototype-experiment'))return;
    const tier=active.get('experiment'),scale=tier?.tier>=7?2:1;
    if(experimentSourcesFor(source).includes('TFT13_Zyra')&&dmg?.isSkill){
      const bonus=amount*Number(season.heroes.find((hero)=>hero.apiName==='TFT13_Zyra')?.experimentBonus?.sourceVariables?.ExperimentTrueDamage??0.5)*scale;
      metric('experiment','zyraBleedsStarted');
      let ticks=4;const tick=()=>{if(!target.alive||ticks<=0)return;const dealt=battle.dealDamage(source,target,{amount:bonus/4,type:'true',canDodge:false,tags:['resonance','prototype-experiment','zyra-bleed']});ticks--;if(dealt>0)metric('experiment','zyraBleedDamage',dealt);if(ticks>0)battle.after(0.5,tick,{owner:source});};
      battle.after(0.5,tick,{owner:source});
    }
    if(experimentSourcesFor(source).includes('TFT13_NunuWillump')){
      const cooldown=Number(season.heroes.find((hero)=>hero.apiName==='TFT13_NunuWillump')?.experimentBonus?.sourceVariables?.ExperimentICD??1),ready=Number(source.mem.prototypeNunuExperimentReady??0);
      if(battle.time>=ready){source.mem.prototypeNunuExperimentReady=battle.time+cooldown;const bonus=source.s.maxHp*Number(season.heroes.find((hero)=>hero.apiName==='TFT13_NunuWillump')?.experimentBonus?.sourceVariables?.ExperimentMaxHealthDamage??0.03)*scale;const dealt=battle.dealDamage(source,target,{amount:bonus,type:'arts',canDodge:false,tags:['resonance','prototype-experiment','nunu-bonus']});if(dealt>0)metric('experiment','nunuBonusDamage',dealt);}
    }
  },{owner:battle});
  battle.on('spGain',(event)=>{
    const unit=event?.unit;if(unit?.side!=='ally'||unit.kind!=='op')return;
    const tier=active.get('logistics');if(isActiveMember(unit,'logistics'))event.amount*=1+Number(tier.variables?.EnlightenedBonusMana??0);
  },{owner:battle});
  battle.on('hit',(event)=>{
    const source=event?.source,target=event?.target,dmg=event?.dmg;
    if(source?.side!=='ally'||target?.side!=='enemy'||!dmg)return;
    const ids=traitIdsFor(source),charId=charIdOf(source);
    if(isActiveMember(source,'sui')&&Number(target.mem.prototypeRoseChargeUntil??0)>battle.time){
      dmg.mul=(dmg.mul??1)*(1+sionVariable('ChargeDamageAmp',0.15));
      metric('sui','blackRoseMarkedHits');
    }
    const sniper=active.get('ammo');
    if(isActiveMember(source,'ammo')){
      const distance=Math.hypot((source.x??0)-(target.x??0),(source.y??0)-(target.y??0));
      dmg.mul=(dmg.mul??1)*(1+Number(sniper.variables?.PercentDamageIncrease??0)*distance/100);
    }
    const ambusher=active.get('redeploy');
    if(isActiveMember(source,'redeploy')&&(dmg.isAttack||dmg.isSkill)&&!dmg.prototypeCritResolved){
      const result=resolvePrototypeCritical(event,{battle,bonusChance:Number(ambusher.variables?.CritChance??0),abilityCrit:true,critDamageBonus:Number(ambusher.variables?.CritDamage??0),baseAttackChance:0.25});
      if(result.critical)metric('redeploy','criticalHits');
    }
    const sorcerer=active.get('arts');
    if(sorcerer?.tier>=8&&isActiveMember(source,'arts')&&dmg.isSkill){
      battle.addBuff(target,{key:`resonance:v3:sorcerer-target-weakness:${target.id}`,duration:Number(sorcerer.variables?.DamageDecreaseDuration??3),mods:{dmgDealtMul:1-Number(sorcerer.variables?.DamageDecrease??0.25)},tags:['resonance','prototype-trait']});
      metric('arts','damageReductionApplications');
    }
    if(ids.has('enforcer')&&target.mem.prototypeWanted)metric('enforcer','wantedHits');
  },{owner:battle});
  battle.on('attack',(event)=>{
    const unit=event?.attacker,target=(event?.targets??[]).find((row)=>row?.side==='enemy'&&row.alive);
    if(unit?.side==='ally'&&unit.kind==='op'&&active.has('emissary')&&liveOps().some((row)=>isActiveMember(row,'emissary')&&sourceApiOf(row)==='TFT13_Nami'))
      unit.skill?.gainSp(Number(vars('emissary').NamiMana??0),'resonanceEmissaryAttack');
    if(!unit||unit.side!=='ally'||unit.kind!=='op'||!target)return;
    const charId=charIdOf(unit),artillery=active.get('artillery');
    if(isActiveMember(unit,'artillery')&&!event.isSkill){
      unit.mem.prototypeRocketCount=(unit.mem.prototypeRocketCount??0)+1;
      if(unit.mem.prototypeRocketCount%Number(artillery.variables?.NumOfAttacks??5)===0){
        for(const enemy of battle.foesInRadius(target.x,target.y,1.5,true))battle.dealDamage(unit,enemy,{amount:unit.s.atk*Number(artillery.variables?.PercentDamage??1.25),type:'phys',canDodge:false,tags:['resonance','prototype-artillerist']});
        metric('artillery','rockets');
      }
    }
    const quick=active.get('combo');
    if(isActiveMember(unit,'combo')){
      const missing=Math.max(0,Math.min(1,1-target.hpRatio));
      const max=Number(quick.variables?.MaxBonusAS??0),min=Number(quick.variables?.MinBonusAS??0);
      buff(unit,'quickstriker-dynamic',{aspd:100*(max-min)*missing},0.35);
    }
  },{owner:battle});
  battle.on('skillStart',(event)=>{
    const unit=event?.unit;if(unit?.side!=='ally'||unit.kind!=='op')return;
    if(isActiveMember(unit,'sui')){roseState.casts++;if(roseState.casts>=Number(active.get('sui').variables?.NumCastsToUnlock??5))freeSion(true);}
    const tier=active.get('dominator');if(isActiveMember(unit,'dominator')){
      const spent=Math.max(0,Number(event.skill?.spCost??unit.skill?.spCost??0));
      unit.mem.prototypeDominatorManaSpent=(unit.mem.prototypeDominatorManaSpent??0)+spent;
      const cap=Number(tier.variables?.APCapPercent);
      const bonusAp=Math.min(Number.isFinite(cap)?cap:Infinity,unit.mem.prototypeDominatorManaSpent*Number(tier.variables?.APPercent??0));
      buff(unit,'dominator-stack',{artsDealtMul:1+bonusAp/100},Infinity);
      metric('dominator','casts');metric('dominator','manaSpent',spent);
    }
    const roller=active.get('holyGun');
    if(isActiveMember(unit,'holyGun')){
      const v=roller.variables??{},rng=Math.max(0,Math.min(0.999999,battle.rng())),rolled=['rocket','shield','coin','triple'][Math.floor(rng*4)];
      const mode=rolled==='triple'?(unit.mem.prototypeHighRollerLast??'rocket'):rolled;
      unit.mem.prototypeHighRollerLast=mode;
      buff(unit,'high-roller-durability',{dmgTakenMul:1-Number(v.Durability??0.8)},Number(v.Duration??1.5));
      const rockets=(multiplier)=>{
        const enemies=battle.enemies.filter((enemy)=>enemy?.alive&&enemy.deployed&&!enemy.hidden).sort((a,b)=>Math.hypot(a.x-unit.x,a.y-unit.y)-Math.hypot(b.x-unit.x,b.y-unit.y)||a.id-b.id);
        if(!enemies.length)return 0;
        const count=Math.max(1,Math.floor(Number(v.Bonus1NumRockets??8)*multiplier));
        for(let index=0;index<count;index++){
          const target=enemies[index%enemies.length];
          battle.dealDamage(unit,target,{amount:Number(v.Bonus1RocketDamage??100),type:'phys',canDodge:false,tags:['resonance','prototype-high-roller','rocket']});
        }
        return count;
      };
      if(mode==='rocket')metric('holyGun','rockets',rockets(rolled==='triple'?3:1));
      else if(mode==='shield'){
        const multiplier=rolled==='triple'?3:1;
        battle.addBuff(unit,{key:`resonance:v3:high-roller-shield:${unit.id}:${battle.time}`,shield:Number(v.Bonus2ShieldAmount??500)*multiplier,duration:Number(v.Bonus2ShieldDuration??4),tags:['resonance','prototype-high-roller']});
        metric('holyGun','shields');
      }else if(mode==='coin'){
        const amount=Number(v.Bonus4Gold??3)*(rolled==='triple'?3:1);
        const results=battle.resonanceResults??=( {growth:[],coins:[],forge:[]} );
        results.coins??=[];
        results.coins.push({amount,reason:'prototype_high_roller',sourceUnitId:unit.id,sourceCharId:charIdOf(unit)});
        metric('holyGun','gold',amount);
      }
      metric('holyGun',`roll_${rolled}`);
    }
  },{owner:battle});
  battle.on('kill',(event)=>{
    const killer=event?.killer,victim=event?.victim;
    if(victim===roseState.token&&Number(active.get('sui')?.tier)>=7&&!roseState.revived){
      roseState.revived=true;victim.mem.prototypeRoseRevived=true;victim.hp=victim.s.maxHp*sionVariable('PercentReviveHealth',0.5);victim.profile.noAttack=false;
      battle.addBuff(victim,{key:`resonance:v3:sion-revive:${victim.id}`,duration:Infinity,mods:{aspd:sionVariable('PercentAttackSpeed',3)*100},tags:['resonance','prototype-sion']});
      victim.mem.prototypeRoseOmnivamp=sionVariable('PercentOmnivamp',0.4);metric('sui','sionRevivals');return;
    }
    const enforcer=active.get('enforcer');
    if(enforcer&&victim?.side==='enemy'&&victim.mem.prototypeWanted){
      for(const unit of traitMembers('enforcer')){
        buff(unit,`enforcer-wanted-kill-${victim.id}`,{aspd:Number(enforcer.variables?.AttackSpeedPerWantedKill??0)*100},Infinity);
        metric('enforcer','wantedKills');
      }
    }
    const quick=active.get('combo');
    if(killer?.side==='ally'&&killer.kind==='op'&&isActiveMember(killer,'combo')&&Number(quick?.variables?.ShieldAmount)>0){
      const target=battle.enemies.filter((enemy)=>enemy?.alive&&enemy.deployed&&!enemy.hidden&&enemy!==victim)
        .sort((a,b)=>Math.hypot(a.x-killer.x,a.y-killer.y)-Math.hypot(b.x-killer.x,b.y-killer.y)||a.id-b.id)[0];
      let moved=false;
      if(target){
        const candidates=[];
        for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if(dr||dc)candidates.push([target.tileR+dr,target.tileC+dc]);
        candidates.sort((a,b)=>Math.hypot(a[0]-killer.tileR,a[1]-killer.tileC)-Math.hypot(b[0]-killer.tileR,b[1]-killer.tileC));
        const destination=candidates.find(([row,col])=>battle.grid.canStand(row,col,{ranged:false})&&!battle.unitAt(row,col)&&!battle.downOn(row,col));
        if(destination)moved=battle.moveRedeploy(killer,destination[0],destination[1],{clearSp:false});
      }
      battle.addBuff(killer,{key:`resonance:v3:quickstriker-kill-shield:${killer.id}:${battle.time}`,shield:Number(quick.variables.ShieldAmount),duration:Number(quick.variables.ShieldDuration??3),tags:['resonance','prototype-trait']});
      if(moved){killer.mem.prototypeQuickstrikerDashTargetId=target?.id??null;metric('combo','targetDeathDashes');}
      metric('combo','targetDeathShields');
    }
    if(killer?.side!=='ally'||killer.kind!=='op'||victim?.side!=='enemy')return;
    const charId=charIdOf(killer),conqueror=active.get('conqueror');
    if(isActiveMember(killer,'conqueror')){
      killer.mem.prototypeConquest=(killer.mem.prototypeConquest??0)+Number(conqueror.variables?.StacksPerKill??1);
      metric('conqueror','conquestStacks',Number(conqueror.variables?.StacksPerKill??1));
    }
  },{owner:battle});
  battle.on('damaged',(event)=>{
    const source=event?.source,target=event?.target;
    if(target===roseState.token&&target?.alive&&target.mem.prototypeRoseChained&&target.hpRatio<=Number(active.get('sui')?.variables?.PercentHealthUnlock??0.65))freeSion(true);
    if(source===roseState.token&&Number(source?.mem?.prototypeRoseOmnivamp)>0&&event?.dealt>0)
      battle.heal(source,source,event.dealt*Number(source.mem.prototypeRoseOmnivamp),{tags:['resonance','prototype-sion','omnivamp']});
    if(source?.side==='ally'&&target?.side==='enemy'&&event.dealt>0){
      const charId=charIdOf(source),automata=active.get('creation');
      if(isActiveMember(source,'creation')&&!(event.dmg?.tags??[]).includes('prototype-automata')){
        source.mem.prototypeCrystals=(source.mem.prototypeCrystals??0)+1;
        source.mem.prototypeAutomataDamage=(source.mem.prototypeAutomataDamage??0)+Number(event.dealt||0);
        if(source.mem.prototypeCrystals>=Number(automata.variables?.TriggerNumCrystals??20)){
          const amount=Number(automata.variables?.MagicDamage??150)+source.mem.prototypeAutomataDamage*Number(automata.variables?.ConversionDamagePct??0);
          source.mem.prototypeCrystals=0;
          source.mem.prototypeAutomataDamage=0;
          battle.dealDamage(source,target,{amount,type:'arts',canDodge:false,tags:['resonance','prototype-automata']});
          metric('creation','crystalBlasts');
        }
      }
      if(source.mem?.prototypeFrontSlow&&event.dmg?.isAttack&&target.alive&&isActiveMember(source,'formSwap'))battle.applyStatus(target,'slow',{duration:source.mem.prototypeFrontSlow.duration,value:source.mem.prototypeFrontSlow.value,source});
      if(isActiveMember(source,'breaker')&&Number(vars('breaker').OmnivampPercent)>0)battle.heal(source,source,event.dealt*Number(vars('breaker').OmnivampPercent),{tags:['resonance','prototype-pitfighter']});
      if(isActiveMember(source,'breaker')&&!(event.dmg?.tags??[]).includes('prototype-pitfighter'))battle.dealDamage(source,target,{amount:event.dealt*Number(vars('breaker').TrueDamagePercent??0),type:'true',canDodge:false,tags:['resonance','prototype-pitfighter']});
      const visionary=active.get('logistics');
      if(visionary?.tier>=8&&isActiveMember(source,'logistics')&&event.dmg?.isSkill){
        const recipient=liveOps().sort((a,b)=>a.hpRatio-b.hpRatio||a.id-b.id)[0];
        if(recipient){const healed=battle.heal(source,recipient,event.dealt*Number(visionary.variables?.AllyHealing??0),{tags:['resonance','prototype-visionary']});if(healed>0)metric('logistics','abilityHealing',healed);}
      }
    }
    if(source?.side==='enemy'&&target?.side==='ally'&&event.dealt>0){
      battle.prototypeTeamDamage=(battle.prototypeTeamDamage??0)+event.dealt;
      const rebel=active.get('resistance');
      if(rebel&&!battle.prototypeRebelTriggered){
        const maxHp=liveOps().reduce((sum,unit)=>sum+unit.s.maxHp,0);
        if(battle.prototypeTeamDamage>=maxHp*Number(rebel.variables?.PercentHealthTrigger??0.3)){
          battle.prototypeRebelTriggered=true;
          triggerRebelSignal(true);
        }
      }
    }
      if(target?.side==='ally'&&target.kind==='op'&&event.dealt>0){
        const tier=active.get('flight');if(isActiveMember(target,'flight'))target.mem.prototypeFlightDamage=(target.mem.prototypeFlightDamage??0)+Number(event.dealt);
        const pit=active.get('breaker');
        if(isActiveMember(target,'breaker')&&target.hpRatio<=Number(pit.variables?.HealthThreshold??0.5)&&!target.mem.prototypePitHealUsed){
          target.mem.prototypePitHealUsed=true;
          target.mem.prototypePitHealRemaining=target.s.maxHp*Number(pit.variables?.HealPercent??0);
          target.mem.prototypePitHealUntil=battle.time+Number(pit.variables?.Duration??2);
          metric('breaker','thresholdHeals');
        }
      }
    refresh();
  },{owner:battle});
  let lastPrototypeTick=Number(battle.time??0);
  battle.on('tick',()=>{
    const now=Number(battle.time??0),dt=Math.max(0,now-lastPrototypeTick);lastPrototypeTick=now;
    const sionSkill=roseState.token?.skill;
    if(roseState.freed&&sionSkill?.ready&&!sionSkill.active)sionSkill.activate('prototypeSionAuto',{free:true});
    const tier=active.get('watcher');
    if(tier)for(const unit of traitMembers('watcher')){
      const value=unit.hpRatio>Number(tier.variables?.HealthBreakpoint??0.5)?Number(tier.variables?.IncreasedDR??0):Number(tier.variables?.BaseDR??0);
      buff(unit,'watcher-dynamic',{dmgTakenMul:1-value},0.3);
    }
    const flight=active.get('flight');
    if(flight)for(const unit of traitMembers('flight')){
      const interval=Math.max(0.1,Number(flight.variables?.Duration??6));
      const next=Number(unit.mem.prototypeFlightNextDash??now+interval);
      if(now+1e-9>=next){
        const target=battle.enemies.filter((enemy)=>enemy?.alive&&enemy.deployed&&!enemy.hidden)
          .sort((a,b)=>Math.hypot(a.x-unit.x,a.y-unit.y)-Math.hypot(b.x-unit.x,b.y-unit.y)||a.id-b.id)[0];
        if(!target)continue;
        unit.mem.prototypeFlightNextDash=now+interval;
        const fromX=unit.x,fromY=unit.y,dr=Math.sign(target.tileR-unit.tileR),dc=Math.sign(target.tileC-unit.tileC);
        const candidates=[[unit.tileR+dr,unit.tileC+dc],[unit.tileR+dr,unit.tileC],[unit.tileR,unit.tileC+dc]];
        const destination=candidates.find(([row,col])=>((row!==unit.tileR||col!==unit.tileC)&&battle.grid.canStand(row,col,{ranged:false})&&!battle.unitAt(row,col)&&!battle.downOn(row,col)));
        const moved=destination?battle.relocate(unit,destination[0],destination[1]):false;
        if(moved){
          battle.fx?.('teleport',{id:unit.id,x:unit.x,y:unit.y,fromX,fromY});
          const burst=Number(flight.variables?.['{0a9a9714}']??0);
          buff(unit,'firelight-dash',{rangeExtend:99,...(burst>0?{aspd:burst*100}:{})},0.35);
          metric('flight','dashes');
        }
        const taken=Number(unit.mem.prototypeFlightDamage??0),heal=taken*Number(flight.variables?.PercentDamageTakenHeal??0);
        unit.mem.prototypeFlightDamage=0;
        if(heal>0){battle.heal(unit,unit,heal,{tags:['resonance','prototype-firelight']});metric('flight','dashHealing',heal);}
      }
    }
    const rebel=active.get('resistance');
    if(rebel&&Number(rebel.variables?.ForceDuration)>0){
      const interval=Number(rebel.variables.ForceDuration);
      for(const unit of traitMembers('resistance'))if(now+1e-9>=Number(unit.mem.prototypeRebelNextSignal??Infinity)){
        unit.mem.prototypeRebelNextSignal=now+interval;
        triggerRebelSignal();
        break;
      }
    }
    for(const unit of liveOps())if(unit.mem.prototypePitHealRemaining>0){
      const healUntil=Number(unit.mem.prototypePitHealUntil??Infinity);
      if(now>healUntil+1e-9){
        unit.mem.prototypePitHealRemaining=0;
        continue;
      }
      const duration=Math.max(0.05,Number(active.get('breaker')?.variables?.Duration??2));
      const activeDt=Math.min(dt,Math.max(0,healUntil-(now-dt)));
      const amount=Math.min(unit.mem.prototypePitHealRemaining,unit.s.maxHp*Number(active.get('breaker')?.variables?.HealPercent??0)*activeDt/duration);
      const healed=battle.heal(unit,unit,amount,{tags:['resonance','prototype-pitfighter']});
      unit.mem.prototypePitHealRemaining=Math.max(0,unit.mem.prototypePitHealRemaining-Number(healed||0));
      if(unit.mem.prototypePitHealRemaining<1e-9)unit.mem.prototypePitHealRemaining=0;
    }
  },{owner:battle});
  battle.on('battleEnd',()=>{
    for(const unit of liveOps()){
      const row=rowFor(unit);if(row)row.survivor=unit.alive===true;
    }
    refresh();
  },{owner:battle});
  let enforcerWantedQuotas=null;
  const planWantedEnemies=()=>{
    const tier=active.get('enforcer');if(!tier||enforcerWantedQuotas)return;
    const planned=[];
    for(const spawn of battle._pending??[]){
      const key=spawn.enemyKey,source=battle.data?.getEnemy?.(key),override=battle.enemyOverrides?.[source?.key]??battle.enemyOverrides?.[key];
      if(!source)continue;
      const baseHp=Number(override?.stats?.maxHp??override?.stats?.hp??source.maxHp);
      const maxHp=baseHp*Math.max(0.0001,Number(spawn.mods?.hpMul??1));
      planned.push({key,hp:maxHp});
    }
    planned.sort((a,b)=>b.hp-a.hp||String(a.key).localeCompare(String(b.key)));
    enforcerWantedQuotas=new Map();
    for(const row of planned.slice(0,Math.max(0,Math.floor(Number(tier.variables?.NumOfWantedEnemies??1))))){
      const signature=`${row.key}:${row.hp}`;enforcerWantedQuotas.set(signature,(enforcerWantedQuotas.get(signature)??0)+1);
    }
    metric('enforcer','plannedWanted',planned.slice(0,Math.max(0,Math.floor(Number(tier.variables?.NumOfWantedEnemies??1)))).length);
  };
  const markWantedEnemy=({enemy}={})=>{
    const tier=active.get('enforcer');if(!tier||!enemy)return;
    planWantedEnemies();
    const signature=`${enemy.defId}:${enemy.s.maxHp}`,remaining=enforcerWantedQuotas.get(signature)??0;
    if(remaining>0){enemy.mem.prototypeWanted=true;enforcerWantedQuotas.set(signature,remaining-1);metric('enforcer','wantedMarked');}
  };
  if(active.has('enforcer')){
    battle.on('battleStart',planWantedEnemies,{owner:battle});
    battle.on('enemySpawn',markWantedEnemy,{owner:battle});
  }
  return {metrics:battle.resonanceMetrics,contributions:battle.resonanceContributions,activeTraits:consumedTraits.map((entry)=>({...entry}))};
}

export { mechanicByTrait };
