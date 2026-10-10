import { academySponsorSets, chooseAcademySponsorSet, prototypeEconomyRules, junkerKingUpgrades } from '../../../../shared/resonance/prototype-economy.js';
import { prototypeSeason } from '../../../../shared/resonance/prototype-season.js';
import { setPrototypeRatingBonus, prototypeRatingTotal, resolvePrototypeRatingReference } from './prototype-rating.js';

const clone=(value)=>structuredClone(value);
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const asObject=(value)=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const traitMap=(rows)=>new Map((rows??[]).map((row)=>[row.id,row]));
const sourceTable=(catalog,key)=>asObject(catalog?.prototypeEconomy?.[key]);
const economyOf=(state)=>({
  version:1,
  processedBattleIds:[],
  draftedKeys:[],
  academy:{sponsoredItemIds:[],claimedItemIds:[]},
  chemBaron:{shimmer:0,marketsOpened:0,marketsSkipped:0,healthFromSkips:0,lossStreak:0},
  conqueror:{conquest:0,openedChests:[],pendingChests:[]},
  family:{heistProgress:0,completedHeists:[],pendingHeists:[],survivorProgress:0},
  junkerKing:{eligibleBattles:0,pendingArmories:0,upgrades:[],},
  ...asObject(state?.prototypeMeta?.economy),
  academy:{sponsoredItemIds:[],claimedItemIds:[],...asObject(state?.prototypeMeta?.economy?.academy)},
  chemBaron:{shimmer:0,marketsOpened:0,marketsSkipped:0,healthFromSkips:0,lossStreak:0,...asObject(state?.prototypeMeta?.economy?.chemBaron)},
  conqueror:{conquest:0,openedChests:[],pendingChests:[],...asObject(state?.prototypeMeta?.economy?.conqueror)},
  family:{heistProgress:0,completedHeists:[],pendingHeists:[],survivorProgress:0,...asObject(state?.prototypeMeta?.economy?.family)},
  junkerKing:{eligibleBattles:0,pendingArmories:0,upgrades:[],...asObject(state?.prototypeMeta?.economy?.junkerKing)},
});
const appendUnique=(rows,value)=>rows.includes(value)?rows:[...rows,value];
const pending=(state,kind,key)=>state?.pendingChoices?.some((choice)=>choice?.type==='prototype_economy'&&choice?.economyKind===kind&&choice?.metadata?.key===key);
function draft(state,economy,kind,key,source,options,metadata={}) {
  if(!Array.isArray(options)||options.length===0||economy.draftedKeys.includes(key)||pending(state,kind,key))return null;
  economy.draftedKeys=appendUnique(economy.draftedKeys,key);
  return {type:'prototype_economy',source,economyKind:kind,options:clone(options),remaining:1,metadata:{key,...clone(metadata)}};
}
function displayOptions(rows) {
  return (rows??[]).filter((row)=>row&&typeof row.id==='string').map((row)=>({
    ...clone(row),id:row.id,label:String(row.label??row.name??row.id),description:String(row.description??''),
    ...(Number.isFinite(Number(row.cost))?{cost:Number(row.cost)}:{}),
  }));
}
function requiredAcademyCount(tier) {
  const byTier=prototypeEconomyRules.academy.itemsByTier;
  return byTier[tier]??(tier>6?byTier[6]:0);
}
function strongestRumblePiece(state,catalog) {
  const memberIds=new Set(prototypeSeason.traits.find((row)=>row.sourceName==='Junker King')?.members??[]);
  const rows=(state?.pieces??[]).map((piece)=>{
    const op=catalog?.operators?.[piece.operatorId]??catalog?.operators?.[piece.sourceChessId];
    const charId=piece.charId??op?.charId;
    if(!memberIds.has(charId))return null;
    const star=Number(piece.star??piece.stars??1),gear=(piece.equipment??[]).length;
    const stats=op?.stars?.[star]?.stats??{};
    return {piece,charId,star,gear,power:Number(stats.atk??0)+Number(stats.maxHp??0)/10,uid:String(piece.uid??piece.nativeUid??'')};
  }).filter(Boolean);
  rows.sort((a,b)=>b.star-a.star||b.gear-a.gear||b.power-a.power||a.uid.localeCompare(b.uid));
  return rows[0]??null;
}

/**
 * Pure round-preparation transition. The session adapter owns choice UIDs,
 * appending drafts to pendingChoices and the claimReward transaction.
 * Reward pools are injected from pinned, source-backed catalog tables.
 */
export function onPrototypeEconomyPrep(state,catalog={},activeTraits=[]) {
  const next=clone(state),economy=economyOf(next),active=traitMap(activeTraits),events=[],choiceDrafts=[];
  const academy=active.get(prototypeEconomyRules.academy.traitId);
  if(academy){
    const table=sourceTable(catalog,'academy');
    const eligible=table.eligibleItemIds??[];
    const sponsored=Array.isArray(economy.academy.sponsoredItemIds)&&economy.academy.sponsoredItemIds.length===3
      ?economy.academy.sponsoredItemIds
      :Array.isArray(table.sponsoredItemIds)&&table.sponsoredItemIds.length===3?[...table.sponsoredItemIds]:chooseAcademySponsorSet(next.seed??next.id??'run',table.sponsorSets?.length?table.sponsorSets:eligible);
    if(sponsored.length===3&&!economy.academy.sponsoredItemIds.length){economy.academy.sponsoredItemIds=[...sponsored];events.push({type:'academy_sponsors_locked',itemIds:[...sponsored]});}
    const desired=requiredAcademyCount(academy.tier);
    const claimed=economy.academy.claimedItemIds.length;
    const offers=sponsored.filter((id)=>!economy.academy.claimedItemIds.includes(id)).slice(0,Math.max(0,desired-claimed));
    if(offers.length){
      const rows=displayOptions(table.sponsorOptions?.filter((row)=>offers.includes(row.id))??offers.map((id)=>({id,label:table.itemNames?.[id]??id,description:'领取本局赞助装备',cost:{currency:'gold',amount:0},grant:[{kind:'item',id}]})));
      const value=draft(next,economy,'academy_sponsor',`academy:${offers.join(',')}`,'academy',rows,{itemIds:offers,tier:academy.tier,grantCount:offers.length});
      if(value)choiceDrafts.push(value);
    }
  }
  const baron=active.get(prototypeEconomyRules.chemBaron.traitId),chem=economy.chemBaron;
  if(baron){
    const table=sourceTable(catalog,'chemBaron');
    const due=Math.max(0,Math.floor(chem.shimmer/prototypeEconomyRules.chemBaron.shimmerBreakpoint)-chem.marketsOpened-chem.marketsSkipped);
    if(due>0){
      const index=chem.marketsOpened+chem.marketsSkipped+1,key=`chem:${index}`;
      const options=displayOptions([...(table.marketOptionsByThreshold?.[String(index)]??table.marketOptions??[]),...(table.skipOption?[table.skipOption]:[])]);
      const value=draft(next,economy,'chem_market',key,'risk',options,{marketIndex:index,shimmer:chem.shimmer,threshold:prototypeEconomyRules.chemBaron.shimmerBreakpoint,healthPerSkip:finite(baron.variables?.HealthPerSkip)});
      if(value)choiceDrafts.push(value);
    }
  }
  const conqueror=active.get(prototypeEconomyRules.conqueror.traitId),conq=economy.conqueror;
  if(conqueror){
    const table=sourceTable(catalog,'conqueror');
    for(const threshold of conq.pendingChests){
      const key=`conqueror:${threshold}`;
      const options=displayOptions(table.chestOptionsByThreshold?.[String(threshold)]);
      const value=draft(next,economy,'war_chest',key,'conqueror',options,{threshold,conquest:conq.conquest,tier:conqueror.tier});
      if(value)choiceDrafts.push(value);
    }
  }
  const family=active.get(prototypeEconomyRules.family.traitId),familyState=economy.family;
  if(family){
    const table=sourceTable(catalog,'family');
    for(const threshold of familyState.pendingHeists){
      const key=`family:${threshold}`;
      const value=draft(next,economy,'family_heist',key,'family',displayOptions(table.heistOptionsByThreshold?.[String(threshold)]),{threshold,heistProgress:familyState.heistProgress,tier:family.tier});
      if(value)choiceDrafts.push(value);
    }
  }
  const king=active.get(prototypeEconomyRules.junkerKing.traitId),kingState=economy.junkerKing;
  if(king&&kingState.pendingArmories>0){
    const table=sourceTable(catalog,'junkerKing'),key=`junker:${kingState.eligibleBattles}`,target=strongestRumblePiece(next,catalog);
    const available=(table.upgradeOptions??[]).filter((option)=>option.action==='skip'||!kingState.upgrades.some((row)=>row.id===(option.grant??[]).find((grant)=>grant.kind==='rumble_upgrade')?.id))
      .filter((option)=>option.id!=='TFT13_JunkerKing_3Star'||target?.star===3);
    const bound=available.map((option)=>({...option,grant:option.grant?.map((grant)=>grant.kind==='rumble_upgrade'?{...grant,targetUid:target?.uid,targetStar:target?.star}:grant)}));
    const value=target?draft(next,economy,'junker_armory',key,'armory',displayOptions(bound),{eligibleBattle:kingState.eligibleBattles,upgradeIds:kingState.upgrades,tier:king.tier,targetUid:target.uid,targetStar:target.star}):null;
    if(value)choiceDrafts.push(value);
  }
  next.prototypeMeta={...(next.prototypeMeta??{}),economy};
  return {state:next,events,choiceDrafts};
}

/** Exactly-once, source-tier-aware post-combat progression. */
export function onPrototypeEconomyResult(state,catalog={},activeTraits=[],result={}) {
  const next=clone(state),economy=economyOf(next),active=traitMap(activeTraits),events=[];
  const battleId=String(result?.battleId??'');
  if(!battleId)throw new Error('PROTOTYPE_ECONOMY_BATTLE_ID_REQUIRED');
  if(economy.processedBattleIds.includes(battleId))return {state:next,events:[{type:'prototype_economy_duplicate_ignored',battleId}],choiceDrafts:[]};
  const outcome=asObject(result?.outcome),won=outcome.won===true;
  economy.processedBattleIds=[...economy.processedBattleIds,battleId];
  const baron=active.get(prototypeEconomyRules.chemBaron.traitId);
  if(baron){
    const chem=economy.chemBaron,vars=asObject(baron.variables),min=finite(vars.MinStreakLength,prototypeEconomyRules.chemBaron.minStreakLength);
    const streakBefore=Number.isFinite(Number(result.lossStreakBefore))?Number(result.lossStreakBefore):chem.lossStreak;
    // The source says Shimmer is gained after combat but does not specify whether
    // the just-finished result updates the streak first. This mode counts the
    // completed loss before awarding that combat's Shimmer; a win resets first.
    const streakAfter=won?0:streakBefore+1;
    const streaking=streakAfter>=min;
    const gain=finite(streaking?vars.ShimmerPerCombatStreaking:vars.ShimmerPerCombat);
    chem.shimmer+=gain;
    chem.lossStreak=streakAfter;
    events.push({type:'chem_shimmer_gained',battleId,amount:gain,total:chem.shimmer,streaking,streakAfter,adaptation:'post-combat-streak'});
  }
  const conqueror=active.get(prototypeEconomyRules.conqueror.traitId);
  if(conqueror){
    const stacks=finite(result?.metrics?.prototypeTraits?.conqueror?.conquestStacks);
    if(stacks>0){
      const data=economy.conqueror;data.conquest+=stacks;
      const thresholds=prototypeEconomyRules.conqueror.chestThresholds;
      for(const threshold of thresholds){if(data.conquest>=threshold&&!data.openedChests.includes(threshold)&&!data.pendingChests.includes(threshold)){data.pendingChests.push(threshold);events.push({type:'conqueror_chest_unlocked',battleId,threshold,conquest:data.conquest});}}
      events.push({type:'conqueror_conquest_gained',battleId,amount:stacks,total:data.conquest});
    }
  }
  const family=active.get(prototypeEconomyRules.family.traitId);
  if(family&&Number(family.tier)>=5){
    const members=new Set(family.members??[]),pieces=next.pieces??[],operators=catalog?.operators??{};
    const charIdByUid=new Map(pieces.flatMap((piece)=>{
      const op=operators[piece.operatorId]??operators[piece.sourceChessId],charId=piece.charId??op?.charId;
      return charId?[[String(piece.uid),charId],[String(piece.nativeUid),charId]]:[];
    }));
    const survivors=new Set((result.survivors??[]).filter((unit)=>unit&&unit.alive!==false).map((unit)=>unit.charId??charIdByUid.get(String(unit.uid??unit.nativeUid))).filter((id)=>members.has(id)));
    const count=survivors.size;
    if(count){
      const data=economy.family;data.survivorProgress+=count;data.heistProgress+=count;
      events.push({type:'family_heist_progress',battleId,survivors:count,total:data.heistProgress,adaptation:'one progress per living Family member'});
      for(const threshold of prototypeEconomyRules.family.heistThresholds)if(data.heistProgress>=threshold&&!data.completedHeists.includes(threshold)&&!data.pendingHeists.includes(threshold)){data.pendingHeists.push(threshold);events.push({type:'family_heist_unlocked',battleId,threshold});}
    }
  }
  const king=active.get(prototypeEconomyRules.junkerKing.traitId);
  if(king){
    const data=economy.junkerKing;data.eligibleBattles++;
    const interval=finite(king.variables?.NumRounds1Star,prototypeEconomyRules.junkerKing.roundsPerArmory);
    if(interval>0&&data.eligibleBattles%interval===0){data.pendingArmories++;events.push({type:'junker_armory_unlocked',battleId,battleCount:data.eligibleBattles});}
  }
  next.prototypeMeta={...(next.prototypeMeta??{}),economy};
  return {state:next,events,choiceDrafts:[]};
}

/** Apply persistent armory purchases to the actual Rumble unit for each battle. */
export function installPrototypeEconomy(battle,state,catalog={}) {
  // NativeBattle does not expose addCoins; mode rewards are returned through this
  // result queue and credited by session settlement.
  battle.resonanceResults??={};
  battle.resonanceResults.coins??=[];
  const upgrades=state?.prototypeMeta?.economy?.junkerKing?.upgrades??[];
  const activeTraits=state?.prototypeMeta?.activeTraits??[];
  const active=new Map(activeTraits.map((row)=>[row.id,row]));
  const pieceRows=state?.pieces??[];
  const inputRows=state?.player?.input?.units??state?.input?.units??state?.units??pieceRows;
  const inputFor=(unit)=>inputRows.find((row)=>[row.uid,row.nativeUid].some((uid)=>uid!=null&&String(uid)===String(unit.uid)))??unit.player?.input?.units?.find((row)=>String(row.uid)===String(unit.uid))??pieceRows.find((row)=>[row.uid,row.nativeUid].some((uid)=>uid!=null&&String(uid)===String(unit.uid)))??null;
  const charIdFor=(unit)=>unit.charId??unit.def?.raw?.charId??unit.def?.charId??inputFor(unit)?.charId??null;
  const held=(unit)=>{const row=inputFor(unit),equipped=row?.items??row?.equipment??unit.items??[],inventory=state?.inventory??[];return equipped.map((item)=>{
    if(typeof item==='string')return item;
    const itemId=item?.itemId??item?.id;if(itemId)return itemId;
    const uid=item?.uid??item?.itemUid;return inventory.find((entry)=>String(entry.uid)===String(uid))?.itemId??null;
  }).filter(Boolean);};
  const chemItems=new Map(Object.values(catalog.equipment??{}).filter((item)=>item?.prototypeEconomyEffect).map((item)=>[item.id,item]));
  const definitions=new Map(junkerKingUpgrades.map((row)=>[row.id,row]));
  const rumbleCharIds=new Set(prototypeSeason.traits.find((row)=>row.sourceName==='Junker King')?.members??[]);
  const sourcePowerByChar=new Map((prototypeSeason.heroes??[]).map((hero)=>[hero.charId,hero.powerReference??{}]));
  const ratingReference=(unit)=>resolvePrototypeRatingReference(unit,sourcePowerByChar.get(charIdFor(unit))??{}).powerReference;
  const targets=()=>{
    const candidates=battle.allyUnits.filter((unit)=>unit?.kind==='op'&&unit.alive&&unit.deployed&&!unit.removed&&rumbleCharIds.has(charIdFor(unit))).map((unit)=>({unit,star:Number(unit.resonanceStar??unit.def?.raw?.resonanceStar??inputFor(unit)?.star??1),gear:held(unit).length,power:Number(unit.s?.atk??0)+Number(unit.s?.maxHp??0)/10,uid:String(inputFor(unit)?.uid??unit.uid??'')}));
    const targetUid=[...upgrades].reverse().find((row)=>row.targetUid)?.targetUid;
    const selected=targetUid?candidates.filter((row)=>row.uid===String(targetUid)):candidates;
    selected.sort((a,b)=>b.star-a.star||b.gear-a.gear||b.power-a.power||a.uid.localeCompare(b.uid));return selected[0]?[selected[0].unit]:[];
  };
  const purchased=upgrades.map((row)=>definitions.get(row?.id)).filter(Boolean);
  const applied=new Set();
  const academy=active.get('academy'),academyIds=new Set(state?.prototypeMeta?.economy?.academy?.sponsoredItemIds??[]),chem=active.get('risk');
  const hasChemGear=battle.allyUnits.some((unit)=>held(unit).some((id)=>chemItems.has(id)));
  const chemEffectsFor=(unit)=>{
    return held(unit).map((id)=>chemItems.get(id)).filter(Boolean).map((item)=>({item,effect:item.prototypeEconomyEffect??{}}));
  };
  const shield=(target,key,amount,duration=10,source=null)=>{
    if(!(amount>0)||!target?.alive||!target.deployed)return false;
    const old=target.buffs.find((row)=>row.key===key);
    if(old){old.shield=Math.min(target.s.maxHp,Number(old.shield??0)+amount);old.duration=Math.max(Number(old.duration??0),duration);target.markDirty?.();}
    else battle.addBuff(target,{key,shield:Math.min(target.s.maxHp,amount),duration,source,visible:true,tags:['resonance','chem-baron']});
    return true;
  };
  const foesNear=(unit,radius)=>battle.foesInRadius?.(unit.x,unit.y,radius,true)??[];
  const perfectedTankVial=(unit,item)=>{
    const count=Math.max(0,Math.floor(sourceValue(item,'PrismaticNumChampions',0)));
    if(!count)return;
    for(const enemy of foesNear(unit,2).sort((a,b)=>a.hp-b.hp).slice(0,count))battle.dealDamage(unit,enemy,{amount:enemy.s.maxHp*sourceValue(item,'PrismaticDamagePercent',0),type:'arts',isSkill:true,canDodge:false,tags:['resonance','chem-baron','perfected-chemtank']});
  };
  const freeTile=(unit)=>{for(let d=1;d<=3;d++)for(let r=unit.tileR-d;r<=unit.tileR+d;r++)for(let c=unit.tileC-d;c<=unit.tileC+d;c++)if(Math.max(Math.abs(r-unit.tileR),Math.abs(c-unit.tileC))===d&&battle.grid?.canStand(r,c)&&!battle.unitAt?.(r,c)&&!battle.downOn?.(r,c))return[r,c];return null;};
  const addTimedBuff=(unit,key,mods,duration)=>battle.addBuff(unit,{key,mods,duration,source:unit,tags:['resonance','chem-baron']});
  const sourceValue=(item,key,fallback=0)=>Number(item.prototypeSourceEffects?.[key]??fallback);
  const applyPersistents=()=>{
    for(const unit of battle.allyUnits.filter((row)=>row?.kind==='op'&&row.alive&&!row.removed)){
      if(applied.has(unit.id))continue;applied.add(unit.id);
      const charId=charIdFor(unit),items=held(unit),mods={};
      if(academy&&items.some((id)=>academyIds.has(id))){
        const copies=items.filter((id)=>academyIds.has(id)).length,bonus=Number(academy.variables?.PercentIncreaseSponsored??0),extra=Number(academy.variables?.BaseValues??0);
        const multiplier=charId&&academy.members?.includes(charId)?2:1;
        mods.hpPct=copies*(bonus*multiplier+(multiplier===2?extra:0));mods.dmgDealtMul=1+copies*(bonus*multiplier+(multiplier===2?extra:0));
      }
      if(chem&&chem.members?.includes(charId)){
        const skipped=Number(state?.prototypeMeta?.economy?.chemBaron?.healthFromSkips??0);
        if(skipped>0)mods.hpFlat=(mods.hpFlat??0)+skipped;
      }
      let chemArmor=0,chemMr=0;
      for(const id of items){
        const item=chemItems.get(id);if(!item)continue;
        const stats=item.prototypeEconomyStats??{};
        if(stats.health)mods.hpFlat=(mods.hpFlat??0)+stats.health;
        if(stats.armor)chemArmor+=stats.armor;
        if(stats.magicResist)chemMr+=stats.magicResist;
        if(stats.ap)mods.artsDealtMul=(mods.artsDealtMul??1)*(1+stats.ap/100);
        if(stats.atkPct)mods.atkPct=(mods.atkPct??0)+stats.atkPct;
        if(stats.aspd)mods.aspd=(mods.aspd??0)+stats.aspd;
        if(stats.mana>0){const cost=Number(unit.skill?.spCost??0);if(cost>0)unit.skill?.gainSp?.(cost*stats.mana/100,'prototypeChemItem');}
        if(stats.critChance>0)unit.mem.prototypeChemCritChance=(Number(unit.mem.prototypeChemCritChance??0)+stats.critChance/100);
        const effect=item.prototypeEconomyEffect;
        if(effect.kind==='flat_damage_reduction')mods.dmgTakenMul=(mods.dmgTakenMul??1)*(1-effect.amount/100);
      }
      setPrototypeRatingBonus(battle,unit,'prototype-chem-equipment',{armor:chemArmor,magicResist:chemMr},ratingReference(unit));
      if(Object.keys(mods).length)battle.addBuff(unit,{key:`resonance:v3:economy:${unit.id}`,mods,persist:true,allowDead:true,tags:['resonance','prototype-economy']});
    }
  };
  if(!purchased.length&&!academy&&!chem&&!hasChemGear)return {upgrades:0};
  battle.on('battleStart',()=>{
    applyPersistents();
    for(const unit of targets()){
      const mods={};
      const power=ratingReference(unit);
      let armorRating=0,magicResistRating=0;
      for(const upgrade of purchased)for(const [key,value] of Object.entries(upgrade.stats??{})){
        if(key==='health')mods.hpFlat=(mods.hpFlat??0)+value;
        else if(key==='ap')mods.artsDealtMul=(mods.artsDealtMul??1)*(1+value/100);
        else if(key==='apPct')mods.artsDealtMul=(mods.artsDealtMul??1)*(1+value);
        else if(key==='armorPct')armorRating+=Number(power.armor??0)*value;
        else if(key==='resistPct')magicResistRating+=Number(power.magicResist??0)*value;
        else if(key==='durability')mods.dmgTakenMul=(mods.dmgTakenMul??1)*(1-value);
      }
      setPrototypeRatingBonus(battle,unit,'prototype-junker-upgrades',{armor:armorRating,magicResist:magicResistRating},power);
      if(Object.keys(mods).length)battle.addBuff(unit,{key:`resonance:v3:junker-king:${unit.id}`,mods,persist:true,allowDead:true,tags:['resonance','prototype-economy']});
    }
  },{owner:battle});
  battle.on('tick',()=>{
    const now=Number(battle.time??0);
    for(const unit of battle.allyUnits.filter((row)=>row?.kind==='op'&&row.alive&&row.deployed&&!row.removed))for(const id of held(unit)){
      const item=chemItems.get(id),effect=item?.prototypeEconomyEffect;if(effect?.kind!=='periodic_arts_power')continue;
      const key=`chem:periodic:${id}`,ready=Number(unit.mem[key]??0);if(now>=ready){unit.mem[key]=now+effect.interval;unit.mem[`${key}:stacks`]=(unit.mem[`${key}:stacks`]??0)+1;const value=1+(Number(item.prototypeEconomyStats?.ap??0)+unit.mem[`${key}:stacks`]*Number(effect.perTickPct??0))/100;battle.addBuff(unit,{key:`resonance:v3:${key}:${unit.id}`,mods:{artsDealtMul:value},persist:true,allowDead:true,tags:['resonance','prototype-economy']});}
    }
    for(const upgrade of purchased){
      const kind=upgrade.combat?.kind;
      if(kind==='repair')for(const unit of targets()){
        const key=`junker:repair:${unit.id}`,ready=Number(unit.mem[key]??0);
        const pct=upgrade.combat.healPctByStar?.[Math.max(0,Math.min(2,Number(unit.resonanceStar??inputFor(unit)?.star??1)-1))]??0;
        if(now>=ready){unit.mem[key]=now+upgrade.combat.interval;battle.heal(unit,unit,unit.s.maxHp*pct,{tags:['resonance','prototype-junker-king']});}
      }
      if(kind==='tankbuster')for(const unit of targets()){
        const key=`junker:tankbuster:${unit.id}`,ready=Number(unit.mem[key]??0);
        const pct=upgrade.combat.trueDamagePctByStar?.[Math.max(0,Math.min(2,Number(unit.resonanceStar??inputFor(unit)?.star??1)-1))]??0;
        if(now>=ready){unit.mem[key]=now+upgrade.combat.interval;const target=battle.enemies.filter((enemy)=>enemy.alive&&enemy.deployed).sort((a,b)=>(b.s.def+b.s.res)-(a.s.def+a.s.res))[0];if(target)battle.dealDamage(unit,target,{amount:unit.s.atk*pct/100,type:'true',canDodge:false,tags:['resonance','prototype-junker-king']});}
      }
      if(kind==='flamethrower')for(const unit of targets()){
        const key=`junker:flame:${unit.id}`,ready=Number(unit.mem[key]??0);if(now<ready)continue;unit.mem[key]=now+upgrade.combat.interval;
        const star=Math.max(0,Math.min(2,Number(unit.resonanceStar??inputFor(unit)?.star??1)-1)),pct=upgrade.combat.damagePctByStar?.[star]??0;
        const foes=battle.foesInRadius?.(unit.x,unit.y,2,true)??[];for(const enemy of foes)battle.dealDamage(unit,enemy,{amount:unit.s.atk*pct/100,type:'arts',canDodge:false,tags:['resonance','prototype-junker-king']});
      }
      if(kind==='pertricite')for(const unit of targets()){
        const key=`junker:rod:${unit.id}`,ready=Number(unit.mem[key]??0);if(now<ready)continue;unit.mem[key]=now+upgrade.combat.interval;
        const target=battle.enemies.filter((enemy)=>enemy.alive&&enemy.deployed&&Math.hypot(enemy.x-unit.x,enemy.y-unit.y)<=upgrade.combat.range).sort((a,b)=>Math.hypot(b.x-unit.x,b.y-unit.y)-Math.hypot(a.x-unit.x,a.y-unit.y))[0];
        if(target){const star=Math.max(0,Math.min(2,Number(unit.resonanceStar??inputFor(unit)?.star??1)-1));unit.mem[`${key}:target`]=target;unit.mem[`${key}:until`]=now+upgrade.combat.duration;unit.mem[`${key}:dps`]=unit.s.atk*(upgrade.combat.damagePctByStar?.[star]??0)/100/upgrade.combat.duration;unit.mem[`${key}:last`]=now;}
      }
      if(kind==='pertricite')for(const unit of targets()){
        const key=`junker:rod:${unit.id}`,target=unit.mem[`${key}:target`],dt=Math.max(0,now-Number(unit.mem[`${key}:last`]??now));unit.mem[`${key}:last`]=now;
        if(target?.alive&&now<=Number(unit.mem[`${key}:until`]??-1)&&dt>0)battle.dealDamage(unit,target,{amount:unit.mem[`${key}:dps`]*dt,type:'arts',canDodge:false,tags:['resonance','prototype-junker-king']});
      }
    }
    for(const unit of battle.allyUnits.filter((row)=>row?.kind==='op'&&row.alive&&row.deployed&&!row.removed))for(const {item,effect} of chemEffectsFor(unit)){
      if(effect.kind==='threshold_shield'){
        const key=`chem:tank:${item.id}`,threshold=sourceValue(item,'HealthThreshold',.5);
        if(unit.hp/unit.s.maxHp<=threshold&&!unit.mem[`${key}:opened`]){
          unit.mem[`${key}:opened`]=true;unit.mem[`${key}:next`]=now+sourceValue(item,'TickRate',8);
          shield(unit,`${key}:shield`,unit.s.maxHp*sourceValue(item,'InitialPercentShield',.2),sourceValue(item,'ShieldDuration',10),unit);
          perfectedTankVial(unit,item);
        }
        if(unit.mem[`${key}:opened`]&&now>=Number(unit.mem[`${key}:next`]??Infinity)){
          unit.mem[`${key}:next`]=now+sourceValue(item,'TickRate',8);
          shield(unit,`${key}:shield`,unit.s.maxHp*sourceValue(item,'PercentShield',.1),sourceValue(item,'ShieldDuration',10),unit);
          perfectedTankVial(unit,item);
        }
      }
      if(effect.kind==='team_shimmer_bloom'){
        const key=`chem:bloom:${item.id}`;
        if(now>=Number(unit.mem[`${key}:next`]??0)){
          unit.mem[`${key}:next`]=now+sourceValue(item,'Cadence',8);
          const recipients=battle.allyUnits.filter((ally)=>ally.kind==='op'&&ally.alive&&ally.deployed&&!ally.removed).sort((a,b)=>a.hp/a.s.maxHp-b.hp/b.s.maxHp).slice(0,Math.max(1,Math.floor(sourceValue(item,'NumAllies',2))));
          for(const ally of new Set([unit,...recipients])){
            shield(ally,`${key}:shield:${ally.id}`,sourceValue(item,'ShieldAmount',300)*(1+sourceValue(item,'IncreasedHealShieldPercent',.2)),sourceValue(item,'ShieldDuration',10),unit);
            if(effect.perfected)addTimedBuff(ally,`${key}:perfected:${ally.id}`,{artsDealtMul:1+sourceValue(item,'PrismaticAllyAP',30)/100,aspd:sourceValue(item,'PrismaticAllyAS',.3)*100},sourceValue(item,'ShieldDuration',10));
          }
        }
      }
      if(effect.kind==='dimensional_heirloom'){
        const key=`chem:heirloom:${item.id}`;
        if(now>=Number(unit.mem[`${key}:next`]??0)){
          unit.mem[`${key}:next`]=now+sourceValue(item,'Cadence',4);
          const tile=freeTile(unit);
          if(tile){const nativeTokenId='token_10022_kazema_shadow',visual=battle.tokenDef?.(nativeTokenId,unit)??{};
            const def={...visual,id:`resonance_chem_echo_${unit.id}`,name:'维度幻影',spine:nativeTokenId,avatar:nativeTokenId,profession:unit.def?.profession??visual.profession??'WARRIOR',position:unit.def?.position??visual.position??'MELEE',stats:{...visual.stats,maxHp:unit.s.maxHp*.35,atk:unit.s.atk*.35,def:unit.s.def,res:unit.s.res,aspd:unit.s.aspd,bat:unit.s.bat,blockCnt:0,respawnTime:0},trait:{bb:{}},talents:[],tokens:[],rangeGrid:[[0,0],[0,1]]};
            battle.spawnToken(unit,def.id,tile[0],tile[1],{def,anySource:true,duration:6,stats:{maxHp:def.stats.maxHp,atk:def.stats.atk,def:def.stats.def,res:def.stats.res},kit:{skill:null,trait:{noAttack:false}}});}
        }
      }
    }
  },{owner:battle});
  battle.on('death',(event)=>{
    const unit=event?.unit;if(!unit||!rumbleCharIds.has(charIdFor(unit)))return;
    const targetUid=[...upgrades].reverse().find((row)=>row.targetUid)?.targetUid;if(targetUid&&String(inputFor(unit)?.uid??unit.uid)!==String(targetUid))return;
    const upgrade=purchased.find((row)=>row.combat?.kind==='self_destruct');if(!upgrade)return;
    const star=Math.max(0,Math.min(2,Number(unit.resonanceStar??inputFor(unit)?.star??1)-1)),pct=upgrade.combat.armorMrPctByStar?.[star]??0;
    const power=ratingReference(unit);
    const sourceResistance=Number(power.armor??0)+prototypeRatingTotal(unit,'armor')+Number(power.magicResist??0)+prototypeRatingTotal(unit,'magicResist');
    for(const enemy of battle.foesInRadius(unit.x,unit.y,upgrade.combat.radius,true)??[])battle.dealDamage(unit,enemy,{amount:sourceResistance*pct/100,type:'arts',canDodge:false,tags:['resonance','prototype-junker-king']});
  },{owner:battle});
  battle.on('hit',(event)=>{
    const unit=event?.attacker??event?.source,target=event?.target;
    if(unit?.side==='enemy'&&event?.dmg){for(const key of Object.keys(unit.mem??{}))if(key.startsWith('chem:combat:')&&key.endsWith(':weakenedUntil')&&battle.time<=Number(unit.mem[key]))event.dmg.mul*=1-Number(unit.mem[key.slice(0,-'weakenedUntil'.length)+'weakenPct']??.25);}
    if(!unit||target?.side!=='enemy')return;
    if(event.dmg?.tags?.includes('chem-baron'))return;
    for(const id of held(unit)){const item=chemItems.get(id),effect=item?.prototypeEconomyEffect;if(effect?.kind==='attack_true_damage'&&event.dmg?.isAttack)battle.dealDamage(unit,target,{amount:Number(effect.amount),type:'true',canDodge:false,tags:['resonance','prototype-chem-baron']});}
    for(const {item,effect} of chemEffectsFor(unit)){
      const key=`chem:combat:${item.id}`;
      if(effect.kind==='skill_toxins'&&!event.dmg?.isSkill){const cost=Number(unit.skill?.spCost??0);if(cost>0)unit.skill?.gainSp?.(cost*sourceValue(item,'ExtraManaOnAttack',5)/100,'prototypeChemItem');}
      if(effect.kind==='voltaic_saber'){
        unit.mem[`${key}:hits`]=(Number(unit.mem[`${key}:hits`]??0)+1);
        const every=Math.max(1,sourceValue(item,'NumDamageInstances',6));
        if(unit.mem[`${key}:hits`]>=every){unit.mem[`${key}:hits`]=0;const count=Math.max(1,Math.floor(sourceValue(item,'NumEnemies',2)));for(const foe of battle.enemies.filter((row)=>row.alive&&row.deployed).sort((a,b)=>a.hp/a.s.maxHp-b.hp/b.s.maxHp).slice(0,count)){battle.dealDamage(unit,foe,{amount:sourceValue(item,'JoltDamage',150),type:'phys',canDodge:false,tags:['resonance','chem-baron','voltaic']});if(effect.perfected)addTimedBuff(unit,`${key}:aspd`,{aspd:sourceValue(item,'PrismaticASPerTrigger',.2)*100},3);}}
      }
      if(effect.kind==='execute_kill'&&target.alive&&target.hp/target.s.maxHp<=sourceValue(item,'ExecuteThreshold',.1))battle.dealDamage(unit,target,{amount:target.hp+1,type:'true',canDodge:false,tags:['resonance','chem-baron','execute']});
      if(effect.kind==='skill_virus'&&event.dmg?.isSkill&&Number(event.dmg?.amount)>0&&target.alive){
        target.mem??={};const until=Number(target.mem[`${key}:until`]??0);target.mem[`${key}:dps`]=Math.max(Number(target.mem[`${key}:dps`]??0),Number(event.dmg.amount)*sourceValue(item,'DoTPercentDamage',.15)/sourceValue(item,'Duration',3));target.mem[`${key}:until`]=Math.max(until,battle.time+sourceValue(item,'Duration',3));target.mem[`${key}:owner`]=unit;
        if(effect.perfected){target.mem[`${key}:weakenedUntil`]=battle.time+sourceValue(item,'Duration',3);target.mem[`${key}:weakenPct`]=sourceValue(item,'PrismaticReducedDamage',.25);}
      }
    }
  },{owner:battle});
  battle.on('damaged',(event)=>{
    const unit=event?.target,source=event?.source;
    if(source?.side==='ally'&&unit?.side==='enemy'&&event.dealt>0){
      for(const {item,effect} of chemEffectsFor(source)){
        const surgeUntil=Number(source.mem?.[`chem:damage:${item.id}:surgeUntil`]??0);
        const percent=Number(item.prototypeEconomyStats?.omnivamp??0)
          +(effect.kind==='low_health_ripper'&&surgeUntil>battle.time?sourceValue(item,'EnhancedOmnivamp',0):0);
        if(percent>0)battle.heal(source,source,event.dealt*percent,{tags:['resonance','chem-baron','omnivamp']});
      }
    }
    if(!unit||unit.side!=='ally'||unit.kind!=='op'||!(event.dealt>0))return;
    for(const {item,effect} of chemEffectsFor(unit)){
      const key=`chem:damage:${item.id}`;
      if(effect.kind==='low_health_ripper'&&unit.hp/unit.s.maxHp<=sourceValue(item,'HealthThreshold',.4)&&!unit.mem[`${key}:triggered`]){
        unit.mem[`${key}:triggered`]=true;battle.heal(unit,unit,unit.s.maxHp*sourceValue(item,'PercentHeal',.25),{tags:['resonance','chem-baron']});
        battle.addBuff(unit,{key:`${key}:untargetable`,flags:{untargetable:true},duration:.5,persist:false,source:unit,tags:['resonance','chem-baron']});
        unit.mem[`${key}:surgeUntil`]=battle.time+sourceValue(item,'SurgeDuration',5);
        addTimedBuff(unit,`${key}:surge`,{atkPct:sourceValue(item,'EnhancedAD',.1)},sourceValue(item,'SurgeDuration',5));
      }
      if(effect.kind==='stacking_hexarmor'){
        const stacks=Math.min(sourceValue(item,'MaxStacks',15),Number(unit.mem[`${key}:stacks`]??0)+1);unit.mem[`${key}:stacks`]=stacks;
        setPrototypeRatingBonus(battle,unit,`prototype-chem-hexarmor:${item.id}`,{armor:stacks*sourceValue(item,'ArmorPerStack',3),magicResist:stacks*sourceValue(item,'ArmorPerStack',3)},ratingReference(unit));
        const cooldown=Number(unit.mem[`${key}:ready`]??0);
        if(stacks>=sourceValue(item,'MaxStacks',15)&&battle.time>=cooldown){unit.mem[`${key}:ready`]=battle.time+sourceValue(item,'Cooldown',2);const power=ratingReference(unit);const totalArmor=(Number(power.armor??0)+prototypeRatingTotal(unit,'armor'));const totalMr=(Number(power.magicResist??0)+prototypeRatingTotal(unit,'magicResist'));const amount=(totalArmor+totalMr)*sourceValue(item,'ResistancePercentageDamage',.5);for(const enemy of foesNear(unit,sourceValue(item,'HexRange',1)))battle.dealDamage(unit,enemy,{amount,type:effect.perfected?'true':'arts',isSkill:true,canDodge:false,tags:['resonance','chem-baron','hexarmor']});}
      }
    }
  },{owner:battle});
  battle.on('kill',(event)=>{
    const unit=event?.killer,victim=event?.victim;if(!unit||victim?.side!=='enemy'||unit.side!=='ally')return;
    for(const {item,effect} of chemEffectsFor(unit))if(effect.kind==='execute_kill'){
      addTimedBuff(unit,`chem:execute:${item.id}`,{dmgDealtMul:1+sourceValue(item,'OnKillDA',.1),dmgTakenMul:1-sourceValue(item,'OnKillDR',.1)},sourceValue(item,'Duration',5));
      if(effect.perfected&&sourceValue(item,'PrismaticGold',0)>0)battle.resonanceResults.coins.push({
        amount:Math.max(0,Math.floor(sourceValue(item,'PrismaticGold',3))),source:'chemBaron',reason:'perfected_execution',
      });
      if(effect.perfected&&sourceValue(item,'PrismaticHeal',0)>0)battle.heal(unit,unit,sourceValue(item,'PrismaticHeal',400),{tags:['resonance','chem-baron']});
    }
  },{owner:battle});
  battle.on('skillEnd',(event)=>{
    const unit=event?.unit;if(!unit||unit.side!=='ally')return;
    for(const {item,effect} of chemEffectsFor(unit))if(effect.kind==='skill_toxins'){
      const target=battle.enemies.filter((row)=>row.alive&&row.deployed).sort((a,b)=>Math.hypot(a.x-unit.x,a.y-unit.y)-Math.hypot(b.x-unit.x,b.y-unit.y))[0];if(!target)continue;
      for(let n=0;n<Math.max(1,Math.floor(sourceValue(item,'NumMissiles',3)));n++)battle.dealDamage(unit,target,{amount:sourceValue(item,'FlatDamage',100),type:'arts',isSkill:true,canDodge:false,tags:['resonance','chem-baron','toxins']});
      if(effect.perfected)for(const foe of foesNear(target,2))battle.dealDamage(unit,foe,{amount:sourceValue(item,'PrismaticWaveDamage',450),type:'arts',isSkill:true,canDodge:false,tags:['resonance','chem-baron','toxins-wave']});
    }
  },{owner:battle});
  battle.on('heal',(event)=>{
    const unit=event?.source;if(!unit||unit.side!=='ally')return;
    for(const {item,effect} of chemEffectsFor(unit))if(effect.kind==='team_shimmer_bloom')event.amount*=1+sourceValue(item,'IncreasedHealShieldPercent',.2);
  },{owner:battle});
  battle.on('tick',(event)=>{
    const dt=Number(event?.dt??0.1);
    for(const zombie of battle.allyUnits.filter(row=>row?.kind==='token'&&row.mem?.prototypeVirusDecay)){
      const decay=zombie.mem.prototypeVirusDecay;decay.elapsed=Math.min(decay.duration,Number(decay.elapsed??0)+dt);
      zombie.hp=Math.max(0,Number(zombie.hp??0)-decay.maxHp*dt/decay.duration);zombie.markDirty?.();
      if(zombie.hp<=0&&zombie.alive)battle.retreat(zombie,{reason:'virus-decay',permanent:true});
    }
    for(const enemy of battle.enemies)if(enemy?.alive&&enemy.deployed)for(const key of Object.keys(enemy.mem??{}))if(key.startsWith('chem:combat:')&&key.endsWith(':until')){
      const base=key.slice(0,-':until'.length),until=Number(enemy.mem[key]??0),dps=Number(enemy.mem[`${base}:dps`]??0),owner=enemy.mem[`${base}:owner`];
      if(battle.time<=until&&dps>0&&owner?.alive)battle.dealDamage(owner,enemy,{amount:dps*Math.min(dt,Math.max(0,until-(battle.time-dt))),type:'true',canDodge:false,tags:['resonance','chem-baron','virus']});
    }
  },{owner:battle});
  battle.on('death',(event)=>{
    const unit=event?.unit;if(!unit)return;
    if(unit.side==='enemy'&&event.reason==='killed'){
      for(const key of Object.keys(unit.mem??{})){
        if(!key.startsWith('chem:combat:')||!key.endsWith(':owner'))continue;
        const itemId=key.slice('chem:combat:'.length,-':owner'.length),item=chemItems.get(itemId),effect=item?.prototypeEconomyEffect,owner=unit.mem[key];
        if(!effect?.perfected||effect.kind!=='skill_virus'||!owner?.alive||!owner.deployed)continue;
        const tile=freeTile(owner);if(!tile)continue;
        const nativeTokenId='token_10022_kazema_shadow',visual=battle.tokenDef?.(nativeTokenId,owner)??{};
        const def={...visual,id:`resonance_chem_virus_zombie_${unit.id}`,name:'病毒感染者',spine:nativeTokenId,avatar:nativeTokenId,
          profession:'WARRIOR',position:'MELEE',dmgType:unit.def?.dmgType,stats:{...visual.stats,maxHp:sourceValue(item,'PrismaticZombieHealth',1600),atk:unit.s.atk,def:unit.s.def,res:unit.s.res,aspd:unit.s.aspd,bat:unit.s.bat,blockCnt:0,respawnTime:0},
          trait:{bb:{}},talents:[],tokens:[],rangeGrid:unit.def?.rangeGrid??[[0,0],[0,1]]};
        const duration=sourceValue(item,'PrismaticZombieDecayDuration',8);
        const zombie=battle.spawnToken(owner,def.id,tile[0],tile[1],{def,anySource:true,duration,stats:{maxHp:def.stats.maxHp,atk:def.stats.atk,def:def.stats.def,res:def.stats.res,aspd:def.stats.aspd,bat:def.stats.bat},kit:{skill:null,trait:{noAttack:false}}});
        if(zombie)zombie.mem.prototypeVirusDecay={duration,maxHp:def.stats.maxHp,elapsed:0,sourceItemId:item.id};
        break;
      }
      return;
    }
    if(unit.side!=='ally'||unit.kind!=='op'||event.reason!=='killed')return;
    for(const {item,effect} of chemEffectsFor(unit))if(effect.kind==='low_health_ripper'&&effect.perfected&&!unit.mem[`chem:damage:${item.id}:revived`]){
      unit.mem[`chem:damage:${item.id}:revived`]=true;battle.after(.05,()=>{if(!unit.removed&&battle.redeploy(unit,{free:true,keepSp:true}))unit.hp=Math.max(unit.hp,unit.s.maxHp*sourceValue(item,'PrismaticReviveHeal',1));},{owner:battle});
    }
  },{owner:battle});
  return {upgrades:purchased.length,targets:rumbleCharIds.size};
}
