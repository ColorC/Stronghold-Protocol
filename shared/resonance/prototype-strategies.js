const sourceKey=(value)=>String(value??'').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const sourceItemRows=(augment)=>(augment.grantedItems??[]).filter((row)=>String(row?.name??'').trim());
function activeSourceHeroes(augment,catalog) {
  const active=new Set(catalog.config?.activeOperatorIds??Object.keys(catalog.operators??{}));
  const description=sourceKey(augment.description);
  return (augment.grantedHeroes??[]).filter((hero)=>{
    if(!hero?.sourceName||!hero.operatorId||!active.has(hero.operatorId)||!catalog.operators?.[hero.operatorId])return false;
    const name=sourceKey(hero.sourceName);
    return name.length>0&&` ${description} `.includes(` ${name} `);
  });
}
function sourceRewardPlan(augment,catalog,emblemId) {
  const description=String(augment.description??'').trim();
  const match=/^Gain\s+(.+?)[.!?]*$/i.exec(description);
  if(!match||!emblemId||!catalog.equipment?.[emblemId])return null;
  const phrases=match[1].replace(/[.!?]+$/,'').split(/,|\s+and\s+/i).map((value)=>value.trim().replace(/^(?:a|an|some)\s+/i,'')).filter(Boolean);
  const grants=sourceItemRows(augment);
  const heroes=activeSourceHeroes(augment,catalog);
  const heroByName=new Map(heroes.map((hero)=>[sourceKey(hero.sourceName),hero]));
  const emblemSource=grants.find((item)=>/emblem/i.test(item.name));
  if(!emblemSource)return null;
  const sourceEmblemName=phrases.find((phrase)=>/emblem$/i.test(phrase));
  if(!sourceEmblemName||sourceKey(sourceEmblemName)!==sourceKey(emblemSource.name))return null;
  const table=catalog.prototypeEconomy?.academy??{};
  const sourceItems=new Map();
  for(const row of table.sponsorOptions??[]){
    const key=sourceKey(row.sourceName);
    if(!key)continue;
    const ids=sourceItems.get(key)??new Set();ids.add(row.id);sourceItems.set(key,ids);
  }
  const bonusOperatorIds=[],bonusRewards=[],seenSourceItems=new Set();
  let sawRandomSponsored=false,sawRandomComponents=false;
  for(const phrase of phrases){
    const key=sourceKey(phrase);
    if(key===sourceKey(sourceEmblemName))continue;
    if(key.includes('random sponsored item')){
      if(augment.apiName!=='TFT13_Augment_AcademyCrown'||sawRandomSponsored)return null;
      sawRandomSponsored=true;continue;
    }
    if(/random components?/i.test(phrase)){
      if(augment.apiName!=='TFT13_Augment_ScrapCrown'||sawRandomComponents)return null;
      const amount=Number(augment.effects?.NumComponents);
      if(!Number.isInteger(amount)||amount<1||amount>6)return null;
      bonusRewards.push({kind:'random-components',count:amount});sawRandomComponents=true;continue;
    }
    const hero=heroByName.get(key);
    if(hero){bonusOperatorIds.push(hero.operatorId);continue;}
    const item=grants.find((row)=>sourceKey(row.name)===key&&!/emblem/i.test(row.name));
    if(!item)return null;
    const sourceGearId=item.apiName?catalog.prototypeSourceGear?.bySourceApiName?.[item.apiName]:null;
    const ids=sourceGearId?[sourceGearId]:[...(sourceItems.get(key)??[])];
    if(ids.length!==1||!catalog.equipment?.[ids[0]]||catalog.equipment[ids[0]].grantAllowed===false)return null;
    seenSourceItems.add(key);bonusRewards.push({kind:'item',itemId:ids[0],sourceApiName:item.apiName,sourceName:item.name});
  }
  if(phrases.some((phrase)=>!(/emblem$/i.test(phrase)||sourceKey(phrase).includes('random sponsored item')||/random components?/i.test(phrase)||heroByName.has(sourceKey(phrase))||seenSourceItems.has(sourceKey(phrase)))))return null;
  const describedNamedItems=phrases.filter((phrase)=>!(/emblem$/i.test(phrase)||sourceKey(phrase).includes('random sponsored item')||/random components?/i.test(phrase)||heroByName.has(sourceKey(phrase)))).map(sourceKey).sort();
  const extractedNamedItems=grants.filter((row)=>!/emblem/i.test(row.name)).map((row)=>sourceKey(row.name)).sort();
  if(describedNamedItems.join('|')!==extractedNamedItems.join('|'))return null;
  return {bonusOperatorIds:[...new Set(bonusOperatorIds)],bonusRewards,sawRandomSponsored,sawRandomComponents,sourceItemNames:extractedNamedItems};
}

export function applyPrototypeStrategies(catalog) {
  const season=catalog.prototypeSeason;
  if(!season)throw new Error(`RESONANCE_SEASON_REQUIRED:${catalog.config?.seasonId??'unknown'}`);
  const strategies={};
  for(const [index,augment] of season.augmentCandidates.entries()){
    const id=`prototype_set13_${augment.apiName.slice('TFT13_Augment_'.length).toLowerCase()}`;
    const itemId=`prototype_emblem_${augment.traitId}`;
    if(augment.adapter==='choose_transfer'&&!catalog.equipment?.[itemId])continue;
    const rewards=augment.adapter==='choose_transfer'?sourceRewardPlan(augment,catalog,itemId):null;
    if(augment.adapter==='choose_transfer'&&!rewards)continue;
    const isAcademyCrown=augment.apiName==='TFT13_Augment_AcademyCrown';
    const effects=augment.adapter==='battle'
      ? [{kind:'prototype_battle_augment',params:{traitId:augment.traitId,mechanic:augment.mechanic,variables:augment.effects,sourceApiName:augment.apiName,grantedHeroIds:(augment.grantedHeroes??[]).map((hero)=>hero.operatorId).filter(Boolean),grantedItemIds:(augment.grantedItems??[]).map((item)=>item.apiName)}}]
      : [{kind:'choose_transfer',params:{itemIds:[itemId],prototypeTraitId:augment.traitId,bonusOperatorIds:rewards.bonusOperatorIds,bonusRewards:rewards.bonusRewards,...(rewards.sawRandomSponsored?{bonusSponsorItem:true}:{})},reference:{...augment.reference,recordId:augment.apiName}}];
    const traitName=catalog.pacts?.[augment.traitId]?.name??augment.traitId;
    const heroNames=rewards?.bonusOperatorIds.map((operatorId)=>catalog.operators[operatorId]?.name).filter(Boolean)??[];
    const rewardNames=rewards?.bonusRewards.filter((row)=>row.kind==='item').map((row)=>catalog.equipment[row.itemId]?.name).filter(Boolean)??[];
    const transferDescription=augment.adapter==='choose_transfer'
      ?`获得「${traitName}」转职徽记${heroNames.length?`，招募${heroNames.join('、')}`:''}${rewardNames.length?`，并获得${rewardNames.join('、')}`:''}${rewards.sawRandomSponsored?'，并从本局赞助装备中随机获得一件':''}${rewards.sawRandomComponents?`，并获得${rewards.bonusRewards.find((row)=>row.kind==='random-components').count}件随机组件`:''}。`
      :null;
    strategies[id]={
      id,name:augment.displayName??augment.name,group:'rule',description:augment.adapter==='choose_transfer'?transferDescription:augment.adaptation,timing:'run-or-node',condition:{kind:'always'},
      mutuallyExclusive:[],unique:true,prototype:true,
      source:{...augment.reference,recordId:augment.apiName,sourceEffectText:augment.description,associatedTraits:augment.associatedTraits??[],grantedHeroes:rewards?.bonusOperatorIds.map((operatorId)=>({operatorId,name:catalog.operators[operatorId]?.name})).filter((hero)=>hero.name)??[],grantedItems:augment.grantedItems??[],adaptationState:augment.adapter==='choose_transfer'?(isAcademyCrown?'transfer-and-locked-random-sponsor-item':rewards.bonusRewards.length?'transfer-and-source-rewards':'transfer-only'):'battle-consumer-installed'},
      effects,
      weight:1,order:index,
    };
  }
  const already=new Set(season.augmentCandidates.map((row)=>row.apiName));
  const sourcePresentation={
    TFT6_Augment_TradeSector:{name:'商贸枢纽',description:'获得1金币；每个节点可免费刷新一次商店。'},
    TFT6_Augment_ClearMind:{name:'清心',description:'若战斗结束时备战席为空，获得3点经验。'},
    TFT6_Augment_MaxLevel10:{name:'等级提升',description:'立即获得12点经验；每次购买经验时额外获得2点。'},
    TFT10_Augment_GoingLong:{name:'长线经营',description:'立即获得15金币；每场战斗结束后获得4点经验，且不再获得利息。'},
    TFT9_Augment_HighEndSector:{name:'高端商圈',description:'立即获得4金币；每次升级时按新等级获得免费刷新次数。'},
    TFT11_Augment_Epoch:{name:'纪元',description:'立即获得6点经验和2次免费刷新；每进入新阶段再获得相同奖励。'},
    TFT11_Augment_EpochPlus:{name:'纪元+',description:'立即获得8点经验和3次免费刷新；每进入新阶段再获得相同奖励。'},
    TFT9_Augment_LearningFromExperience2:{name:'学有所成',description:'每场战斗胜利获得2点经验，失败获得3点经验。'},
    TFT11_Augment_RainingGold:{name:'金币雨',description:'立即获得8金币；每场战斗结束后再获得1金币。'},
    TFT11_Augment_RainingGoldPlus:{name:'金币雨+',description:'立即获得18金币；每场战斗结束后再获得1金币。'},
    TFT13_Augment_PitFighter:{name:'重装成长',description:''},
  };
  const sourceAdapters={
    TFT6_Augment_TradeSector:(row)=>({kind:'trade_sector',params:{gold:Number(row.effects?.Gold??1),sourceApiName:row.apiName}}),
    TFT6_Augment_ClearMind:(row)=>({kind:'prototype_clear_mind',params:{xp:Number(row.effects?.XP??3),sourceApiName:row.apiName}}),
    TFT6_Augment_MaxLevel10:(row)=>({kind:'prototype_level_up',params:{initialXp:Number(row.effects?.InitialXP??12),bonusXpPerPurchase:Number(row.effects?.XP??2),sourceApiName:row.apiName}}),
    TFT10_Augment_GoingLong:(row)=>({kind:'prototype_going_long',params:{gold:Number(row.effects?.Gold??15),roundXp:Number(row.effects?.XP??4),sourceApiName:row.apiName}}),
    TFT9_Augment_HighEndSector:(row)=>({kind:'prototype_high_end_sector',params:{gold:Number(row.effects?.Gold??4),sourceApiName:row.apiName}}),
    TFT11_Augment_Epoch:(row)=>({kind:'prototype_epoch',params:{xp:Number(row.effects?.XP??6),rerolls:Number(row.effects?.Rerolls??2),stageNodes:4,sourceApiName:row.apiName}}),
    TFT11_Augment_EpochPlus:(row)=>({kind:'prototype_epoch',params:{xp:Number(row.effects?.XP??8),rerolls:Number(row.effects?.Rerolls??3),stageNodes:4,sourceApiName:row.apiName}}),
    TFT9_Augment_LearningFromExperience2:(row)=>({kind:'patient_study',params:{winXp:Number(row.effects?.winxp??2),lossXp:Number(row.effects?.lossxp??3),sourceApiName:row.apiName}}),
    TFT11_Augment_RainingGold:(row)=>({kind:'prototype_round_gold',params:{instantGold:Number(row.effects?.InstantGold??8),roundGold:Number(row.effects?.RoundGold??1),sourceApiName:row.apiName}}),
    TFT11_Augment_RainingGoldPlus:(row)=>({kind:'prototype_round_gold',params:{instantGold:Number(row.effects?.InstantGold??18),roundGold:Number(row.effects?.RoundGold??1),sourceApiName:row.apiName}}),
    TFT13_Augment_PitFighter:(row)=>({kind:'prototype_win_loss_growth',params:{traitId:'bruiser',attackPctPerLoss:Number(row.effects?.ADPerLoss??0)*100,hpPerWin:Number(row.effects?.HealthPerWin??0),bonusOperatorIds:(row.grantedHeroes??[]).map((hero)=>hero.operatorId).filter(Boolean),sourceApiName:row.apiName}}),
  };
  for(const [index,row] of season.strategyCandidates.entries()){
    if(already.has(row.apiName))continue;
    const adapt=sourceAdapters[row.apiName];
    if(!adapt)continue;
      const presentation=sourcePresentation[row.apiName];
      const localizedPresentation=row.apiName==='TFT13_Augment_PitFighter'
        ?(()=>{
          const heroId=row.grantedHeroes?.find((hero)=>hero.operatorId)?.operatorId;
          const heroName=heroId?catalog.operators?.[heroId]?.name:null;
          const attackPct=Number(row.effects?.ADPerLoss??0)*100;
          const hpPerWin=Number(row.effects?.HealthPerWin??0);
          const attackText=Number.isInteger(attackPct)?String(attackPct):String(Number(attackPct.toFixed(2)));
          const hpText=Number.isInteger(hpPerWin)?String(hpPerWin):String(Number(hpPerWin.toFixed(2)));
          return {name:presentation.name,description:`重装盟约干员每次战败永久获得${attackText}%攻击力；每次胜利永久获得${hpText}点生命${heroName?`，并招募「${heroName}」`:''}。`};
        })()
        :presentation;
      const id=`prototype_source_${row.apiName.replace(/^TFT\d*_?Augment_?/,'').replace(/[^a-zA-Z0-9]+/g,'_').toLowerCase()}`;
      strategies[id]={id,name:localizedPresentation?.name??row.name,group:'rule',description:localizedPresentation?.description??presentation?.description??row.description,timing:'run-or-node',condition:{kind:'always'},mutuallyExclusive:[],unique:true,prototype:true,weight:1,
      source:{...row.reference,recordId:row.apiName,sourceEffectText:row.description,sourceEffects:row.effects,associatedTraits:row.associatedTraits??[],adapterState:'mode-adapted'},
      effects:[adapt(row)],order:strategies.length+index};
  }
  const sourceEmblemCount=season.strategyCandidates.filter((row)=>(row.grantedItems??[]).some((item)=>/emblem/i.test(item.apiName??''))).length;
  const sourceOtherCount=season.strategyCandidates.length-sourceEmblemCount;
  const playable=Object.values(strategies),playableEmblems=playable.filter((strategy)=>strategy.effects?.some((effect)=>effect.kind==='choose_transfer'));
  const playableOthers=playable.filter((strategy)=>!strategy.effects?.some((effect)=>effect.kind==='choose_transfer'));
  const emblemWeight=playableEmblems.length?sourceEmblemCount/playableEmblems.length:0;
  const otherWeight=playableOthers.length?sourceOtherCount/playableOthers.length:0;
  for(const strategy of playable){
    const emblem=strategy.effects?.some((effect)=>effect.kind==='choose_transfer');
    strategy.weight=emblem?emblemWeight:otherWeight;
    strategy.source={...strategy.source,sourcePoolWeight:strategy.weight,
      sourcePoolWeightBasis:`${season.displayName} resolved candidate source ratio ${sourceEmblemCount}/${season.strategyCandidates.length}; this is a Resonance pool weighting adaptation, not the original offer odds.`};
  }
  return {...catalog,strategies,prototypeStrategyPool:{sourceCandidateCount:season.strategyCandidates.length,sourceEmblemCount,sourceOtherCount,
    playableCount:playable.length,playableEmblemCount:playableEmblems.length,playableOtherCount:playableOthers.length,sourceEmblemRatio:sourceEmblemCount/season.strategyCandidates.length,
    weighting:'Playable source groups are weighted to represent the pinned resolved candidate counts; this does not claim TFT original offer odds.'}};
}
