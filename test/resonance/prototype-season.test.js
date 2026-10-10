import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { activePrototypeTraits, onPrototypePrep, onPrototypeBattleResult, prototypeFormModes } from '../../server/sim/content/resonance/prototype-meta.js';
import { buildResonanceBattle, getResonanceField } from '../../server/modes/resonance/battle.js';
import { applyAction, createSession, validateSession, viewSession } from '../../server/modes/resonance/session.js';
import { resonanceSessionDisplay } from '../../server/modes/resonance/display.js';
import { canPlace } from '../../server/match/board.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { preparePrototypeScrapGear } from '../../server/sim/content/resonance/prototype-pacts.js';
import { tftArmorToNativeDefense, tftMrToNativeResistance, tftRatingReduction } from '../../shared/resonance/prototype-resistance.js';
import { prototypeLabCells } from '../../shared/resonance/prototype-labs.js';

const inputPath='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft-set13-14.23.json';
const reference=JSON.parse(fs.readFileSync(inputPath,'utf8'));
const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');

test('Set 13 launch prototype is a 60-slot unique roster at exact fee counts',()=>{
  const {heroes,costDistribution}=prototypeSeason;
  assert.equal(heroes.length,60);
  assert.equal(new Set(heroes.map((hero)=>hero.charId)).size,60);
  assert.equal(new Set(heroes.map((hero)=>hero.sourceChessId)).size,60);
  assert.deepEqual(costDistribution,{1:14,2:13,3:13,4:12,5:8});
  assert.deepEqual(Object.fromEntries([1,2,3,4,5].map((cost)=>[cost,heroes.filter((hero)=>hero.cost===cost).length])),costDistribution);
  for(const hero of heroes){
    const source=reference.naturalChampions.find((row)=>row.apiName===hero.apiName);
    assert.deepEqual(hero.powerReference,{hp:source.stats.hp,attackDamage:source.stats.damage,armor:source.stats.armor,magicResist:source.stats.magicResist,attackSpeed:source.stats.attackSpeed,range:source.stats.range,source:'CommunityDragon client data',version:'Set 13 patch 14.23',apiName:hero.apiName});
  }
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:1});
  for(const hero of heroes){
    const operator=catalog.operators[hero.sourceChessId];
    for(const star of [1,2,3])for(const key of ['maxHp','atk','def','res','aspd','bat'])assert.ok(Number.isFinite(operator.stars[star].stats[key]),`${hero.apiName} star ${star} ${key} is finite`);
  }
  for(const [apiName,budgetScale] of [['TFT13_Corki',0.36],['TFT13_Lieutenant',0.65]]){
    const hero=heroes.find((row)=>row.apiName===apiName),operator=catalog.operators[hero.sourceChessId];
    assert.equal(hero.currentFeeAdjustment.budgetScale,budgetScale,apiName);
    assert.equal(operator.currentFeeAdjustment.budgetScale,budgetScale,apiName);
    const expectedDps=prototypeSeason.powerBudget.oneStarBaseDps[hero.cost-1]
      *prototypeSeason.powerBudget.roleMultipliers[hero.role].dps*budgetScale;
    const expectedBat=1/hero.powerReference.attackSpeed;
    assert.equal(operator.stars[1].stats.atk,Math.round(expectedDps*expectedBat),apiName);
    assert.equal(operator.stars[1].stats.bat,expectedBat,apiName);
    assert.equal(operator.source.normalChess.stats.atk,data.chess[hero.sourceChessId].stats.atk,`${apiName} keeps source native stats`);
    assert.equal(operator.stars[1].record.skill.skillId,operator.fixedSkillId,`${apiName} keeps fixed skill identity`);
  }
  assert.deepEqual(catalog.prototypeMeta.currentFeeAdjustments.map(({apiName,budgetScale})=>({apiName,budgetScale})),[
    {apiName:'TFT13_Corki',budgetScale:0.36},{apiName:'TFT13_Lieutenant',budgetScale:0.65},
  ]);
});

test('all 26 traits preserve raw natural members, joined fee arrays, and tier bounds',()=>{
  assert.equal(prototypeSeason.traits.length,26);
  assert.equal(new Set(prototypeSeason.traits.map((trait)=>trait.sourceName)).size,26);
  for(const trait of prototypeSeason.traits){
    const source=reference.naturalTraits.find((row)=>row.name===trait.sourceName);
    assert.ok(source,trait.sourceName);
    assert.deepEqual(trait.naturalMemberApiNames,source.naturalMemberApiNames,trait.sourceName);
    const members=trait.members.map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
    assert.equal(members.length,source.naturalMemberApiNames.length,trait.sourceName);
    assert.deepEqual(members.map((hero)=>hero.apiName),source.naturalMemberApiNames,trait.sourceName);
    assert.deepEqual(trait.costDistribution,Object.fromEntries([1,2,3,4,5].map((cost)=>[cost,members.filter((hero)=>hero.cost===cost).length])),trait.sourceName);
    assert.deepEqual(trait.effects.map(({minUnits,maxUnits,variables})=>({minUnits,maxUnits,variables})),source.effects.map(({minUnits,maxUnits,variables})=>({minUnits,maxUnits,variables})),trait.sourceName);
    assert.ok(trait.effects.every((tier)=>tier.minUnits>0&&tier.maxUnits>=tier.minUnits),trait.sourceName);
    assert.equal(trait.emblemRequired,Math.max(...trait.effects.map((tier)=>tier.minUnits))>trait.memberCount,trait.sourceName);
  }
});

test('Chem-Baron source item table contains only the 28 pinned tier-specific Crime items',()=>{
  assert.equal(prototypeSeason.chemBaronItems.length,28);
  assert.equal(new Set(prototypeSeason.chemBaronItems.map((row)=>row.apiName)).size,28);
  assert.deepEqual([...new Set(prototypeSeason.chemBaronItems.map((row)=>row.tier))].sort(),['Bronze','Gold','OmegaPrismatic','Prismatic','Silver']);
  assert.ok(prototypeSeason.chemBaronItems.every((row)=>row.apiName.startsWith('TFT13_Crime_')&&row.name&&row.effects&&typeof row.unique==='boolean'));
  assert.equal(prototypeSeason.chemBaronItems.some((row)=>row.apiName.includes('ArmoryCashout')||row.apiName.includes('ArmoryContinue')),false);
});

test('strategy source candidate projection is the exact resolved Set 13 list and preserves all source rows',()=>{
  const rows=prototypeSeason.strategyCandidates;
  assert.equal(rows.length,308);
  assert.equal(new Set(rows.map((row)=>row.apiName)).size,rows.length);
  assert.ok(rows.every((row)=>row.description.trim()&&row.effects&&typeof row.effects==='object'));
  assert.ok(rows.every((row)=>row.adapterHint===null&&row.reference.version==='Set 13 launch patch 14.23'&&row.reference.setListResolution==='SetData[number=13] resolveSetList result'));
  assert.ok(rows.some((row)=>!row.apiName.startsWith('TFT13_Augment_')));
  assert.ok(rows.some((row)=>Object.keys(row.effects).length===0));
  assert.ok(rows.every((row)=>!row.grantedHeroes.some((hero)=>hero.apiName.includes('TFT18_'))));
});

test('Crest/Crown reward extraction uses complete source-name matches and never emits blank items',()=>{
  const crest=prototypeSeason.augmentCandidates.find((row)=>row.apiName==='TFT13_Augment_AcademyCrest');
  const crown=prototypeSeason.augmentCandidates.find((row)=>row.apiName==='TFT13_Augment_AcademyCrown');
  const visionary=prototypeSeason.augmentCandidates.find((row)=>row.apiName==='TFT13_Augment_VisionaryCrown');
  assert.deepEqual(crest.grantedHeroes.map(({apiName,name,operatorId})=>({apiName,name,operatorId})),[
    {apiName:'TFT13_Leona',name:'泡泡',operatorId:'chess_char_2_08_a'},
  ]);
  assert.equal(crest.grantedItems.some((item)=>!item.name?.trim()),false);
  assert.equal(crown.grantedHeroes.length,0,'random sponsored item is not a fixed hero grant');
  assert.equal(crown.grantedItems.some((item)=>!item.name?.trim()),false);
  assert.deepEqual(visionary.grantedHeroes.map((hero)=>hero.apiName),['TFT13_RenataGlasc']);
  assert.ok(visionary.grantedHeroes.every((hero)=>hero.sourceName&&hero.name&&hero.operatorId), 'source and localized runtime identity stay distinct');
  assert.equal(crown.modeRewardPool.kind,'academy_sponsor');
  assert.equal(crown.modeRewardPool.sets.length,22);
  const v3=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:19});
  assert.ok(crown.modeRewardPool.sets.every((set)=>set.itemIds.length===3&&set.itemIds.every((id)=>!!v3.equipment[id])));
  assert.match(crown.adaptation,/本模式按赞助装备映射池随机获得一件装备/);
  for(const row of [...prototypeSeason.augmentCandidates,...prototypeSeason.strategyCandidates]){
    assert.ok(row.grantedItems.every((item)=>item.name?.trim()),`${row.apiName} has no blank item match`);
    assert.ok(row.grantedHeroes.every((hero)=>hero.sourceName&&hero.name&&hero.operatorId),`${row.apiName} has complete source/runtime hero mapping`);
  }
});

test('special Set 13 Training Dummy stays outside the natural roster and preserves no-move/no-attack source',()=>{
  const source=reference.prototypeEntities.entities.TFT_TrainingDummy;
  const entity=prototypeSeason.specialEntities.TFT_TrainingDummy;
  assert.ok(source);
  assert.ok(entity);
  assert.equal(prototypeSeason.heroes.some((hero)=>hero.apiName===source.apiName),false);
  assert.equal(source.stats.hp,550);
  assert.equal(source.stats.armor,30);
  assert.equal(source.stats.magicResist,30);
  assert.equal(source.stats.initialMana,0);
  assert.equal(source.stats.mana,0);
  assert.equal(source.ability.name,'On Duty!');
  assert.match(source.ability.desc,/cannot move or attack/i);
  assert.deepEqual(source.ability.variables,[]);
  assert.equal(entity.id,'TFT_TrainingDummy');
  assert.equal(entity.kind,'training_dummy');
  assert.equal(entity.maxHp,550);
  assert.equal(entity.def,30);
  assert.equal(entity.res,30);
  assert.equal(entity.atk,0);
  assert.equal(entity.aspd,0);
  assert.equal(entity.range,1);
  assert.equal(entity.blockCount,1);
  assert.equal(entity.attackDisabled,true);
  assert.equal(entity.canMove,false);
  assert.equal(entity.nativeTokenId,'token_10011_beewax_oblisk');
  assert.equal(entity.source.apiName,'TFT_TrainingDummy');
  assert.equal(data.tokens.token_10011_beewax_oblisk?.tokenId,'token_10011_beewax_oblisk');
  assert.equal(data.assets.tokens.token_10011_beewax_oblisk?.spine?.anims?.idle,'Idle');
});

test('v3 catalog remaps costs and identities while v1/v2 catalogs remain available',()=>{
  const v3=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:19});
  assert.equal(v3.config.rulesVersion,3);
  assert.equal(v3.config.openingId,'none');
  assert.equal(v3.config.activeOperatorIds.length,60);
  assert.equal(new Set(v3.config.activeOperatorIds).size,60);
  assert.deepEqual(v3.campaign.poolByCost,{1:14,2:13,3:13,4:12,5:8});
  assert.equal(Object.keys(v3.pacts).length,26);
  assert.equal(v3.prototypeEmblemItems.length,22);
  assert.ok(Object.keys(v3.strategies).length>=prototypeSeason.augmentCandidates.length);
  const registeredSourceAugments=Object.values(v3.strategies).filter((strategy)=>strategy.source?.recordId&&prototypeSeason.augmentCandidates.some((candidate)=>candidate.apiName===strategy.source.recordId));
  assert.equal(registeredSourceAugments.length,50,'all eight battle augments and 42 exact-mapped transfer augments remain playable; unresolved source rows stay reference-only');
  assert.ok(Object.values(v3.strategies).every((strategy)=>strategy.source?.version==='Set 13 launch patch 14.23'));
  assert.equal(Object.values(v3.strategies).filter((strategy)=>strategy.effects[0].kind==='choose_transfer').length,42);
  assert.equal(Object.values(v3.strategies).filter((strategy)=>strategy.effects[0].kind==='prototype_battle_augment').length,8);
  for(const [apiName,effectKind] of [['TFT6_Augment_TradeSector','trade_sector'],['TFT10_Augment_GoingLong','prototype_going_long'],['TFT9_Augment_HighEndSector','prototype_high_end_sector'],['TFT11_Augment_Epoch','prototype_epoch'],['TFT11_Augment_EpochPlus','prototype_epoch'],['TFT9_Augment_LearningFromExperience2','patient_study'],['TFT11_Augment_RainingGold','prototype_round_gold'],['TFT13_Augment_PitFighter','prototype_win_loss_growth']]){
    const strategy=Object.values(v3.strategies).find((row)=>row.source?.recordId===apiName);
    assert.equal(strategy?.effects?.[0]?.kind,effectKind,apiName);
    assert.equal(strategy?.source?.setListResolution,'SetData[number=13] resolveSetList result',apiName);
  }
  assert.ok(Object.values(v3.strategies).filter((strategy)=>strategy.effects[0].kind==='choose_transfer').every((strategy)=>strategy.effects[0].params.itemIds.length===1));
  assert.ok(Object.values(v3.equipment).filter((item)=>item.kind==='emblem').every((item)=>item.prototype===true));
  for(const trait of prototypeSeason.traits.filter((entry)=>entry.emblemRequired)){
    assert.ok(prototypeSeason.emblemCandidates.some((candidate)=>candidate.traitId===trait.id),`missing Set 13 emblem ${trait.id}`);
    const item=v3.equipment[`prototype_emblem_${trait.id}`];
    assert.equal(item.effects.find((effect)=>effect.kind==='transfer_pact')?.params.pactId,trait.id);
  }
  assert.deepEqual(v3.prototypeMeta.exactCounts.filter((entry)=>entry.traitId==='emissary').map((entry)=>entry.count),[1,4]);
  for(const hero of prototypeSeason.heroes){
    const operator=v3.operators[hero.sourceChessId];
    assert.equal(operator.charId,hero.charId);
    assert.equal(operator.cost,hero.cost);
    assert.deepEqual(operator.pacts,prototypeSeason.traits.filter((trait)=>trait.members.includes(hero.charId)).map((trait)=>trait.id));
  }
  const v2=getResonanceCatalog(data,{rulesVersion:2,seed:19});
  assert.equal(v2.config.rulesVersion,2);
  assert.equal(v2.config.activeOperatorIds.length,65);
  assert.equal(v2.season.id,'resonance-season-2');
  const v1=getResonanceCatalog(data,{rulesVersion:1,environmentId:'origin_laterano',seed:19});
  assert.equal(v1.config.rulesVersion,1);
});

test('session display activates Emissary only at its exact one- and four-member counts',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:701});
  const trait=prototypeSeason.traits.find((entry)=>entry.id==='emissary');
  const members=trait.members.map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  assert.equal(members.length,4);
  const thresholds=[];
  for(let count=1;count<=5;count++){
    const roster=members.slice(0,Math.min(count,4)).map((hero,index)=>({uid:`emissary-${count}-${index}`,operatorId:hero.sourceChessId,
      star:1,row:9,col:index,extraPacts:[],equipment:[]}));
    if(count===5){
      const other=prototypeSeason.heroes.find((hero)=>!trait.members.includes(hero.charId));
      roster.push({uid:'emissary-5-extra',operatorId:other.sourceChessId,star:1,row:9,col:4,extraPacts:['emissary'],equipment:[]});
    }
    const state={rulesVersion:3,difficulty:'NORMAL',round:1,roundLimit:28,phase:'prep',strategies:[],strategyState:{},pieces:roster,shop:{offers:[]}};
    const display=resonanceSessionDisplay(state,{data,catalog,viewSession:()=>({ok:true,pieces:[],shop:{offers:[]},strategyState:{},specialEntities:[]})});
    thresholds.push(display.pacts.emissary.activeThreshold);
  }
  assert.deepEqual(thresholds,[1,0,0,4,0]);
});

test('all 60 natural operators load their native fixed skill through the actual v3 Battle builder',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:6013});
  const loaded=[];
  for(const [index,hero] of prototypeSeason.heroes.entries()){
    const state={seed:6013+index,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,seasonId:prototypeSeason.id,
      pieces:[{uid:`kit-${hero.charId}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9,col:5,dir:'RIGHT'}]};
    const {battle}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
    const unit=battle.allyUnits.find((row)=>row.uid===`kit-${hero.charId}`);
    assert.ok(unit,`native unit missing: ${hero.apiName}/${hero.charId}`);
    assert.ok(unit.skill,`native fixed skill missing: ${hero.apiName}/${hero.charId}`);
    assert.equal(battle.errorCount,0,`battle builder errors: ${hero.apiName}/${hero.charId}`);
    loaded.push({apiName:hero.apiName,charId:hero.charId,skillId:unit.skill.id});
  }
  assert.equal(loaded.length,60);
  assert.equal(new Set(loaded.map((row)=>row.charId)).size,60);
});

test('v3 display pact tiers carry only named numeric source values for concise player-facing tier copy',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:19});
  const display=resonanceDisplayCatalog(catalog,data),creation=display.pacts.creation.levels[0];
  assert.equal(creation.threshold,2);
  assert.deepEqual(creation.sourceVariables,{ConversionDamagePct:0.25,MagicDamage:150,Resists:20,TriggerNumCrystals:20});
  assert.equal(Object.keys(creation.sourceVariables).some(key=>key.startsWith('{')),false,'hashed source keys never enter player display data');
  assert.deepEqual(display.pacts.armory.levels[0].sourceVariables,{NumRounds1Star:3,NumRounds1Star_HR:2});
  const visible=Object.values(display.pacts).flatMap((pact)=>pact.levels.map((level)=>level.description)).join('\n');
  assert.doesNotMatch(visible,/尚未接入|尚无.*流程|来源未提供|奖励箱未接入|经济流程|TFT13_|Black Rose|Chem-Baron|Junker King|Academy|Conqueror|Rumble/i);
  assert.match(display.pacts.conqueror.levels[0].description,/累计达到10、35、65/);
  assert.match(display.pacts.academy.levels[0].description,/累计领取1件/);
  assert.match(display.pacts.risk.levels[0].description,/连败达到3场/);
  assert.match(display.pacts.armory.levels[0].description,/3场已结算战斗/);
  assert.doesNotMatch(display.pacts.ammo.levels[0].description,/射程增加|来源未提供/);
  assert.deepEqual(prototypeSeason.powerBudget.starMultipliers.atk,[1,1.5,2.25]);
  assert.match(display.pacts.rhodes.levels[0].description,/至多1件组件/);
  assert.match(display.pacts.rhodes.levels[1].description,/至多3件组件/);
  assert.match(display.pacts.rhodes.levels[2].description,/全部组件/);
  assert.match(display.pacts.logistics.levels.at(-1).description,/生命值最低的友军/);
  assert.match(display.pacts.logistics.levels.at(-1).description,/20%/);
  assert.match(display.pacts.redeploy.levels[0].description,/暴击率加成/);
  assert.match(display.pacts.redeploy.levels[0].description,/普攻与技能/);
  assert.match(display.pacts.enforcer.levels[0].description,/12%/);
  assert.match(display.pacts.enforcer.levels.at(-1).description,/100%/);
  assert.match(display.pacts.enforcer.levels[0].description,/所有围剿干员/);
  assert.match(display.pacts.holyGun.levels[0].description,/8枚火箭/);
  assert.match(display.pacts.holyGun.levels[0].description,/500点护盾/);
  assert.match(display.pacts.holyGun.levels[0].description,/3枚金币/);
  assert.match(display.pacts.holyGun.levels[0].description,/战斗结算时/);
  assert.match(display.pacts.holyGun.levels[0].description,/扩大至三倍/);
  assert.match(display.pacts.rhodes.levels[0].description,/至多1件组件/);
  assert.match(display.pacts.rhodes.levels[1].description,/至多3件组件/);
  assert.match(display.pacts.rhodes.levels[2].description,/全部组件/);
  assert.match(display.pacts.rhodes.levels[3].description,/全部组件/);
  assert.match(display.pacts.emissary.levels[0].description,/恰好上场1名/);
  assert.doesNotMatch(display.pacts.emissary.levels[0].description,/额外获得200点生命/);
  assert.match(display.pacts.emissary.levels[1].description,/恰好上场4名/);
  assert.match(display.pacts.emissary.levels[1].description,/6%\/12%\/18%攻速/);
  assert.match(display.pacts.emissary.levels[1].description,/额外获得200点生命/);
  assert.match(display.pacts.emissary.levels[0].description,/每获胜一场已结算战斗/);
  assert.match(display.pacts.emissary.levels[0].description,/最多计入7场/);
  assert.match(display.pacts.dominator.levels[0].description,/每消耗1点技力，术法伤害提高0\.25%/);
  assert.doesNotMatch(display.pacts.resistance.levels[0].description,/最大生命值再提高/);
  assert.match(display.pacts.resistance.levels[1].description,/最大生命值再提高12%/);
});

test('prototype meta selects inclusive source bounds and Emissary exact counts',()=>{
  const v3=getResonanceCatalog(data,{rulesVersion:3,seed:1});
  const emissary=v3.pacts.emissary;
  assert.deepEqual(emissary.exactCounts,[1,4]);
  const heroById=prototypeSeason.heroes;
  const chosen=prototypeSeason.traits.find((trait)=>trait.id==='emissary');
  const unitsAt=(count)=>chosen.members.slice(0,count).map((charId,index)=>({uid:`u${index}`,charId,kind:'op'}));
  assert.equal(activePrototypeTraits({units:unitsAt(1)},v3).find((trait)=>trait.id==='emissary')?.tier,1);
  assert.equal(activePrototypeTraits({units:unitsAt(2)},v3).find((trait)=>trait.id==='emissary'),undefined);
  assert.equal(activePrototypeTraits({units:unitsAt(4)},v3).find((trait)=>trait.id==='emissary')?.tier,4);
  assert.ok(heroById.length===60);
  const original={units:unitsAt(4),gold:7};
  const prep=onPrototypePrep(original,v3);
  assert.notEqual(prep.state,original);
  assert.equal(original.prototypeMeta,undefined);
  assert.equal(prep.state.prototypeMeta.rulesVersion,3);
  const result=onPrototypeBattleResult(prep.state,v3,{battleId:'test-prototype-result-1',outcome:{won:true},contributions:[{charId:chosen.members[0],damage:42,healing:3,blocked:5,controlMs:20,summonDamage:0}],survivors:[{charId:chosen.members[0],alive:true}]});
  assert.equal(result.contribution[chosen.members[0]].damage,42);
});

test('Experiment laboratory cells are deterministic, legal, and independent of roster positions',()=>{
  const legal=[{row:9,col:1},{row:9,col:2},{row:10,col:1},{row:10,col:2},{row:11,col:1}];
  const two=prototypeLabCells({stageId:'field-a',seed:71,deployCells:legal,count:2});
  const same=prototypeLabCells({stageId:'field-a',seed:71,deployCells:[...legal].reverse(),count:2});
  const three=prototypeLabCells({stageId:'field-a',seed:71,deployCells:legal,count:3});
  assert.deepEqual(two,same,'reordering roster or legal-cell inputs does not move the labs');
  assert.equal(two.length,2);
  assert.ok(two.every((cell)=>legal.some((candidate)=>candidate.row===cell.row&&candidate.col===cell.col)));
  assert.ok(two.every((cell)=>three.some((candidate)=>candidate.row===cell.row&&candidate.col===cell.col)),'higher tiers retain lower-tier lab cells');
  const state={seed:71,round:2,pieces:['TFT13_NunuWillump','TFT13_Urgot','TFT13_Zyra'].map((api,index)=>({uid:`exp-${index}`,charId:prototypeSeason.heroes.find((hero)=>hero.apiName===api).charId,row:9,col:index+1}))};
  const prep=onPrototypePrep(state,{}, {stageId:'field-a',deployCells:legal});
  assert.equal(prep.state.prototypeMeta.labCells.length,2);
  assert.deepEqual(prep.state.prototypeMeta.labCells,two);
});

test('Experiment Battle shares only bonuses from source units standing on the fixed laboratory cells',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:72});
  const selected=['TFT13_NunuWillump','TFT13_Urgot','TFT13_Zyra'].map((api)=>prototypeSeason.heroes.find((hero)=>hero.apiName===api));
  const seedState={seed:72,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:[]};
  const field=getResonanceField(seedState,{data,catalog});
  const deployCells=[...field.deployMap].map(([key])=>{const [row,col]=key.split(',').map(Number);return {row,col};});
  const labCells=prototypeLabCells({stageId:field.fieldId??'field-a',seed:seedState.seed,deployCells,count:2});
  const placements=[...labCells,{row:deployCells.find((cell)=>!labCells.some((lab)=>lab.row===cell.row&&lab.col===cell.col)).row,col:deployCells.find((cell)=>!labCells.some((lab)=>lab.row===cell.row&&lab.col===cell.col)).col}];
  const state={...seedState,pieces:selected.map((hero,index)=>({uid:`lab-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:placements[index].row,col:placements[index].col,dir:'RIGHT'})),prototypeMeta:{labCells}};
  const {battle,prepared}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  battle.start();
  const nunu=battle.allyUnits.find((unit)=>unit.uid==='lab-0'),urgot=battle.allyUnits.find((unit)=>unit.uid==='lab-1'),zyra=battle.allyUnits.find((unit)=>unit.uid==='lab-2');
  assert.equal(nunu.mem.prototypeExperimentLab,true);
  assert.equal(urgot.mem.prototypeExperimentLab,true);
  assert.notEqual(zyra.mem.prototypeExperimentLab,true,'the source bonus does not follow a member to an arbitrary occupied tile');
  assert.deepEqual(nunu.mem.prototypeExperimentSources.sort(),['TFT13_NunuWillump','TFT13_Urgot'].sort());
  assert.ok(nunu.s.maxHp>nunu.base.maxHp,'a laboratory occupant gets the source max-health bonus');
  const enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,[9,7]);
  enemy.s.maxHp=10000;enemy.hp=10000;
  const hpBefore=enemy.hp;
  const ownHealthBonus=prototypeSeason.heroes.find((hero)=>hero.apiName==='TFT13_NunuWillump').experimentBonus;
  assert.equal(ownHealthBonus.modeAdaptation.maxHealthBasis,'holder');
  assert.match(ownHealthBonus.sourceAmbiguity,/does not identify whose maximum health/);
  assert.notEqual(nunu.s.maxHp,enemy.s.maxHp,'fixture distinguishes holder and target maximum health');
  battle.dealDamage(nunu,enemy,{amount:1,type:'phys',canDodge:false,tags:['prototype-experiment-fixture']});
  assert.ok(enemy.hp<hpBefore-1,'the labbed Nunu applies its actual max-health magic-damage bonus');
  assert.equal(prototypeSeason.heroes.find((hero)=>hero.apiName==='TFT13_NunuWillump').experimentBonus.sourceVariables.ExperimentMaxHealthDamage,0.029999999329447746);
  assert.ok(Math.abs(battle.resonanceMetrics.prototypeTraits.experiment.nunuBonusDamage-nunu.s.maxHp*0.03)<1e-5,'mode adaptation uses 3% of Nunu’s own maximum health while the target has independent health');
  assert.ok(battle.resonanceMetrics.prototypeTraits.experiment.urgotBonusTriggers>0,'labbed Urgot bonus triggers on combat start');
  battle.emit('skillEnd',{unit:urgot});
  assert.ok(battle.resonanceMetrics.prototypeTraits.experiment.urgotDashes>0,'Urgot shared bonus dashes toward a real enemy after a cast');
});

test('Set 13 armor and MR ratings reduce real Battle damage without Native resistance immunity',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:73});
  const sentinel=prototypeSeason.traits.find((trait)=>trait.id==='sentinel');
  const heroes=sentinel.members.slice(0,2).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const state={seed:73,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:heroes.map((hero,index)=>({uid:`sentinel-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9,col:index+1,dir:'RIGHT'}))};
  const {battle,prepared}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  battle.start();
  const ally=battle.allyUnits.find((unit)=>unit.uid==='sentinel-0'),source=heroes[0];
  const tier=activePrototypeTraits(state,catalog).find((row)=>row.id==='sentinel');
  const bonus=Number(tier.variables.BonusArmor);
  const expectedRes=tftMrToNativeResistance(source.powerReference.magicResist+3*bonus);
  const expectedDef=tftArmorToNativeDefense(source.powerReference.armor+3*bonus,source.powerReference.attackDamage);
  assert.ok(Math.abs(ally.s.res-expectedRes)<1e-6,'member MR uses the total three-times rating before conversion');
  assert.ok(Math.abs(ally.s.def-expectedDef)<1e-6,'member physical defense uses the total three-times armor rating before conversion');
  assert.ok(ally.s.res<100,'source score cannot produce Native spell immunity');
  const enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,[9,7]);
  battle.addBuff(ally,{key:'prototype-shield-observer-fixture',shield:75});
  const shieldHp=ally.hp;
  battle.dealDamage(enemy,ally,{amount:100,type:'arts',canDodge:false});
  assert.equal(ally.hp,shieldHp,'the fixture shield absorbs the mitigated incoming hit before HP loss');
  const shieldContribution=battle.resonanceContributions.find((row)=>row.charId===source.charId);
  assert.ok(shieldContribution?.shieldAbsorbed>0&&shieldContribution.shieldAbsorbed<75,'V3 contribution records numeric shield actually consumed, not shield capacity');
  battle.removeBuff(ally,'prototype-shield-observer-fixture');
  for(const type of ['arts','phys']){
    const hpBefore=ally.hp;
    battle.dealDamage(enemy,ally,{amount:100,type,canDodge:false});
    const actual=hpBefore-ally.hp;
    const expected=type==='arts'?100*(1-ally.s.res/100):Math.max(100-ally.s.def,5);
    assert.ok(Math.abs(actual-expected)<1e-5,`${type} damage uses the adapted defense`);
  }
  assert.ok(tftRatingReduction(120)<1,'high source ratings retain a nonzero damage floor');
});

test('Experiment lab shares Zyra bleed, Twitch attacks, and Mundo takedown growth through Battle events',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:74});
  const apis=['TFT13_Twitch','TFT13_DrMundo','TFT13_Zyra','TFT13_NunuWillump','TFT13_Urgot'];
  const heroes=apis.map((api)=>prototypeSeason.heroes.find((hero)=>hero.apiName===api));
  const seedState={seed:74,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:[]};
  const field=getResonanceField(seedState,{data,catalog});
  const deployCells=[...field.deployMap.keys()].map((key)=>{const [row,col]=key.split(',').map(Number);return {row,col};});
  const labCells=prototypeLabCells({stageId:field.fieldId??'field-a',seed:seedState.seed,deployCells,count:3});
  const otherCells=deployCells.filter((cell)=>!labCells.some((lab)=>lab.row===cell.row&&lab.col===cell.col));
  assert.ok(labCells.length===3&&otherCells.length>=2,'fixture uses real legal deploy cells');
  const placements=[...labCells,...otherCells.slice(0,2)];
  const state={...seedState,pieces:heroes.map((hero,index)=>({uid:`lab-full-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:placements[index].row,col:placements[index].col,dir:'RIGHT'})),prototypeMeta:{labCells}};
  const {battle,prepared}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  battle.start();
  const twitch=battle.allyUnits.find((unit)=>unit.uid==='lab-full-0');
  const mundo=battle.allyUnits.find((unit)=>unit.uid==='lab-full-1');
  const zyra=battle.allyUnits.find((unit)=>unit.uid==='lab-full-2');
  const enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,[9,7]);
  enemy.s.maxHp=100000;enemy.hp=100000;
  const twBefore=enemy.hp;
  for(let index=0;index<5;index++)battle.emit('attack',{attacker:twitch,target:enemy});
  assert.ok(twBefore-enemy.hp>1000,'every five attacks applies the source max-health physical hit');
  const zyraBefore=enemy.hp;
  battle.dealDamage(zyra,enemy,{amount:100,type:'arts',isSkill:true,canDodge:false,tags:['experiment-fixture']});
  assert.equal(zyra.mem.prototypeExperimentLab,true);
  assert.ok(zyra.mem.prototypeExperimentSources.includes('TFT13_Zyra'));
  assert.ok(battle.resonanceMetrics.prototypeTraits.experiment.zyraBleedsStarted>0,'Zyra ability hit schedules its shared source effect');
  for(let index=0;index<20;index++)battle.step();
  assert.ok(enemy.hp<zyraBefore-100,'skill damage starts the source two-second true-damage bleed');
  assert.ok(battle.resonanceMetrics.prototypeTraits.experiment.zyraBleedDamage>0);
  const maxHpBefore=mundo.s.maxHp;
  enemy.hp=1;
  battle.dealDamage(mundo,enemy,{amount:10,type:'true',canDodge:false});
  assert.ok(mundo.s.maxHp>maxHpBefore,'Mundo takedown adds source max health to every lab occupant sharing his bonus');
  assert.ok(battle.resonanceMetrics.prototypeTraits.experiment.mundoTakedownHealth>0);
});

test('Experiment tier seven doubles shared effects only for units on fixed labs',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:75});
  const natural=['TFT13_NunuWillump','TFT13_Urgot','TFT13_Zyra','TFT13_DrMundo','TFT13_Twitch'].map((api)=>prototypeSeason.heroes.find((hero)=>hero.apiName===api));
  const naturalIds=new Set(prototypeSeason.traits.find((trait)=>trait.id==='experiment').members);
  const extras=prototypeSeason.heroes.filter((hero)=>!naturalIds.has(hero.charId)).slice(0,2);
  const selected=[...natural,...extras];
  const seedState={seed:75,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:[]};
  const field=getResonanceField(seedState,{data,catalog});
  const deployCells=[...field.deployMap.keys()].map((key)=>{const [row,col]=key.split(',').map(Number);return {row,col};});
  const labCells=prototypeLabCells({stageId:field.fieldId??'field-a',seed:seedState.seed,deployCells,count:3});
  const otherCells=deployCells.filter((cell)=>!labCells.some((lab)=>lab.row===cell.row&&lab.col===cell.col));
  assert.ok(labCells.length===3&&otherCells.length>=4);
  const placements=[...labCells,...otherCells.slice(0,4)];
  const state={...seedState,pieces:selected.map((hero,index)=>({uid:`lab-seven-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:placements[index].row,col:placements[index].col,dir:'RIGHT',...(index>=natural.length?{extraPacts:['experiment']}:{})})),prototypeMeta:{labCells}};
  assert.equal(activePrototypeTraits(state,catalog).find((trait)=>trait.id==='experiment').tier,7);
  const {battle,prepared}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  battle.start();
  const nunu=battle.allyUnits.find((unit)=>unit.uid==='lab-seven-0'),urgot=battle.allyUnits.find((unit)=>unit.uid==='lab-seven-1'),zyra=battle.allyUnits.find((unit)=>unit.uid==='lab-seven-2');
  assert.ok(urgot.buffs.some((row)=>row.key.includes('experiment-urgot-shield')&&Math.abs(row.shield-urgot.s.maxHp*0.16)<1e-5));
  const enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,[9,7]);
  enemy.s.maxHp=100000;enemy.hp=100000;
  const beforeNunu=enemy.hp;
  battle.dealDamage(nunu,enemy,{amount:1,type:'phys',canDodge:false});
  assert.ok(Math.abs(battle.resonanceMetrics.prototypeTraits.experiment.nunuBonusDamage-nunu.s.maxHp*0.06)<1e-5,'seven-tier doubles the holder-based 3% to 6%, independent of the 100000-health enemy');
  assert.ok(beforeNunu-enemy.hp>nunu.s.maxHp*0.06-10,'the seven-tier Experiment bonus doubles Nunu max-health damage');
  const beforeZyra=enemy.hp;
  battle.dealDamage(zyra,enemy,{amount:100,type:'arts',isSkill:true,canDodge:false});
  for(let index=0;index<20;index++)battle.step();
  assert.ok(beforeZyra-enemy.hp>190,'the seven-tier Experiment bonus doubles Zyra bleed');
  assert.ok(battle.resonanceMetrics.prototypeTraits.experiment.labbedMembers===3);
});

test('Form Swapper innate mode is prepared per placement and retains the fixed native skill',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:108});
  const hero=prototypeSeason.heroes.find((entry)=>entry.apiName==='TFT13_Gangplank');
  const state={pieces:[{uid:'form-front',operatorId:hero.sourceChessId,charId:hero.charId,row:9,col:5},{uid:'form-back',operatorId:hero.sourceChessId,charId:hero.charId,row:12,col:5}]};
  const modes=prototypeFormModes(state,catalog);
  assert.deepEqual(modes.map(({uid,mode,label})=>({uid,mode,label})),[
    {uid:'form-front',mode:'frontline',label:'前排形态'},
    {uid:'form-back',mode:'backline',label:'后排形态'},
  ]);
  const prepared=onPrototypePrep(state,catalog).state;
  assert.deepEqual(prepared.prototypeMeta.formModes,modes);
  assert.equal(prototypeSeason.formSwapAdaptation.modeSkillPolicy,'retain-native-fixed-skill');
  assert.equal(prototypeSeason.formSwapAdaptation.backlineSkillRangeExtension,1);
  assert.match(prototypeSeason.formSwapAdaptation.adaptationNote,/mode adaptation/i);
});

test('real claim/equip actions add two distinct transfer emblems and activate the nine-member Rhodes tier',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:917});
  const trait=prototypeSeason.traits.find((row)=>row.id==='rhodes');
  const heroes=trait.members.map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const extras=prototypeSeason.heroes.filter((hero)=>!trait.members.includes(hero.charId)).slice(0,2);
  const created=createSession({seed:917,catalog});
  assert.equal(created.ok,true,created.error);
  const state=created.state;
  state.level=10;state.xp=0;state.gold=999;
  state.pieces=[...heroes,...extras].map((hero,index)=>({uid:`fixture-piece-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],growth:{},row:null,col:null,dir:'RIGHT',benchSlot:index}));
  state.nextUid=500;
  const caps={1:30,2:25,3:18,4:10,5:9};
  const heldPieces=new Map();for(const piece of state.pieces)heldPieces.set(piece.operatorId,(heldPieces.get(piece.operatorId)??0)+1);
  for(const id of state.activeOperatorIds){const cost=catalog.operators[id].cost;const offers=state.shop.offers.filter((offer)=>offer.operatorId===id).length;state.poolRemaining[id]=caps[cost]-(heldPieces.get(id)??0)-offers;}
  const emblemId='prototype_emblem_rhodes';
  for(let index=0;index<2;index++){
    const choiceUid=`fixture-transfer-${index}`;
    state.pendingChoices=[{uid:choiceUid,type:'transfer',source:'fixture',options:[emblemId],remaining:1}];state.phase='choice';
    const claim=applyAction(state,{type:'claimReward',choiceUid,optionIds:[emblemId]},{catalog});
    assert.equal(claim.ok,true,claim.error);Object.assign(state,claim.state);
  }
  const extraPieces=state.pieces.slice(-2);
  for(const piece of extraPieces){
    const item=state.inventory.find((entry)=>entry.itemId===emblemId);
    assert.ok(item,'claimed transfer emblem must be in inventory');
    const equip=applyAction(state,{type:'equip',pieceUid:piece.uid,itemUid:item.uid},{catalog});
    assert.equal(equip.ok,true,equip.error);Object.assign(state,equip.state);
  }
  const fieldResolver=(candidate)=>getResonanceField(candidate,{data,catalog}).deployMap;
  const field=fieldResolver(state),occupied=new Set();
  for(const piece of state.pieces){
    const operator=catalog.operators[piece.operatorId],position=operator.position;
    const cell=[...field.keys()].map((key)=>key.split(',').map(Number)).find(([row,col])=>!occupied.has(`${row},${col}`)&&canPlace(field,position,row,col));
    assert.ok(cell,`no legal tile for ${operator.id}/${position}`);
    occupied.add(`${cell[0]},${cell[1]}`);
    const deployed=applyAction(state,{type:'deploy',pieceUid:piece.uid,row:cell[0],col:cell[1],dir:'RIGHT'},{catalog,fieldResolver});
    assert.equal(deployed.ok,true,deployed.error);Object.assign(state,deployed.state);
  }
  const markedCopy=state.pieces.at(-2);
  markedCopy.equipment.push({uid:'fixture-component-for-marked-emblem-owner',itemId:'tear'});
  const duplicate={...structuredClone(markedCopy),uid:'fixture-unmarked-duplicate',equipment:[],row:null,col:null,benchSlot:0};
  state.poolRemaining[duplicate.operatorId]--;
  state.pieces.push(duplicate);
  const duplicateCell=[...field.keys()].map((key)=>key.split(',').map(Number)).find(([row,col])=>!occupied.has(`${row},${col}`)&&canPlace(field,catalog.operators[duplicate.operatorId].position,row,col));
  assert.ok(duplicateCell,'legal position for unmarked duplicate');
  const duplicateDeploy=applyAction(state,{type:'deploy',pieceUid:duplicate.uid,row:duplicateCell[0],col:duplicateCell[1],dir:'RIGHT'},{catalog,fieldResolver});
  assert.equal(duplicateDeploy.ok,true,duplicateDeploy.error);Object.assign(state,duplicateDeploy.state);
  const active=activePrototypeTraits(state,catalog).find((row)=>row.id==='rhodes');
  assert.equal(active.count,9,JSON.stringify({pieces:state.pieces.map((piece)=>({uid:piece.uid,charId:catalog.operators[piece.operatorId]?.charId,operatorId:piece.operatorId,equipment:piece.equipment})),active}));
  assert.equal(active.tier,9);
  assert.equal(active.memberUids.includes(duplicate.uid),false,'another copy without the emblem is not a trait member');
  const display=resonanceSessionDisplay(state,{data,catalog,viewSession});
  assert.equal(display.pacts.rhodes.count,9);
  const runtimeState={...state,pieces:state.pieces.map((piece)=>({...piece,items:piece.equipment.map((item)=>item.itemId)}))};
  const runtimeActive=activePrototypeTraits({input:{units:runtimeState.pieces}},catalog).find((row)=>row.id==='rhodes');
  assert.equal(runtimeActive.count,9,'native input.items contributes emblem identity');
  assert.equal(new Set(runtimeActive.members).size,9);
  assert.equal(new Set(runtimeActive.memberUids).size,9);
  const {battle,prepared}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  battle.start();
  assert.equal(battle.resonanceMetrics.prototypeTraits.rhodes.tier,9);
  assert.equal(battle.allyUnits.filter((unit)=>unit.kind==='op').length,10);
  const marked=battle.allyUnits.find((unit)=>unit.uid===markedCopy.uid);
  const unmarked=battle.allyUnits.find((unit)=>unit.uid===duplicate.uid);
  assert.ok(marked.findBuff(`resonance:v3:scrap-shield:${marked.id}`)?.shield>0);
  assert.equal(unmarked.findBuff(`resonance:v3:scrap-shield:${unmarked.id}`),null);
});

test('a real preview Battle consumes tier data and Artillerist emits its fifth-attack rocket',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:333});
  const trait=prototypeSeason.traits.find((row)=>row.id==='artillery');
  const heroes=trait.members.slice(0,2).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const state={seed:333,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:heroes.map((hero,index)=>({uid:`artillery-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9+index,col:5,dir:'RIGHT'}))};
  const {battle,prepared}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  const active=activePrototypeTraits(state,catalog);
  assert.equal(active.find((row)=>row.id==='artillery')?.tier,2);
  battle.start();
  const unit=battle.allyUnits.find((row)=>row.kind==='op');
  const enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,{pos:[9,7]});
  const before=enemy.hp;
  for(let index=0;index<5;index++)battle.forceAttack(unit,[enemy]);
  assert.ok(before-enemy.hp>0);
  assert.equal(battle.resonanceMetrics.prototypeTraits.artillery.rockets,1);
  const contribution=battle.resonanceContributions.find((row)=>row.charId===heroes[0].charId);
  assert.ok(contribution?.damage>0);
  assert.equal(contribution.attacks,5);
});

test('Sorcerer AP adaptation grants member totals and nonmember team bonus without multiplication',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:334});
  const trait=prototypeSeason.traits.find((row)=>row.id==='arts');
  const members=trait.members.slice(0,2).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const nonmember=prototypeSeason.heroes.find((hero)=>!trait.members.includes(hero.charId));
  const pieces=[...members,nonmember].map((hero,index)=>({uid:`arts-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9+index,col:2+index,dir:'RIGHT'}));
  const {battle}=buildResonanceBattle({seed:334,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces},{data,catalog,recording:false,preview:true});
  battle.start();
  const [memberA,memberB,other]=pieces.map((piece)=>battle.allyUnits.find((unit)=>unit.uid===piece.uid));
  const memberBuff=memberA.findBuff(`resonance:v3:arts-member:${memberA.id}`);
  const otherBuff=other.findBuff(`resonance:v3:arts-team:${other.id}`);
  assert.equal(memberBuff.mods.artsDealtMul,1.2);
  assert.equal(memberB.findBuff(`resonance:v3:arts-member:${memberB.id}`).mods.artsDealtMul,1.2);
  assert.equal(memberA.findBuff(`resonance:v3:arts-team:${memberA.id}`),null);
  assert.equal(otherBuff.mods.artsDealtMul,1.1);
  assert.deepEqual(trait.modeAdaptation,{sourceConcept:'AP',nativeStat:'artsDealtMul',playerTerm:'术法伤害提高',rule:'non-members receive TeamAP; members receive BaseAP as their total bonus, without stacking TeamAP',reference:'CommunityDragon Set 13 patch 14.23 trait variables; native simulator adaptation'});
});

test('Scrap shield is flat per team-held component including completed-item recipes',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:339});
  catalog.equipment.sourceGear7CompositionFixture={kind:'gear',parts:[],source:{composition:['tear','bow']}};
  const trait=prototypeSeason.traits.find((row)=>row.id==='rhodes');
  const heroes=trait.members.slice(0,2).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const other=prototypeSeason.heroes.find((hero)=>!trait.members.includes(hero.charId));
  const pieces=[
    {uid:'scrap-a',operatorId:heroes[0].sourceChessId,star:1,equipment:[{itemId:'tear'}],row:9,col:3,dir:'RIGHT'},
    {uid:'scrap-b',operatorId:heroes[1].sourceChessId,star:1,equipment:[{itemId:'sourceGear7CompositionFixture'}],row:10,col:4,dir:'RIGHT'},
    {uid:'scrap-other',operatorId:other.sourceChessId,star:1,equipment:[{itemId:'giantSlayer'}],row:11,col:5,dir:'RIGHT'},
  ];
  const {battle}=buildResonanceBattle({seed:339,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces},{data,catalog,recording:false,preview:true});
  battle.start();
  for(const uid of ['scrap-a','scrap-b']){
    const unit=battle.allyUnits.find((row)=>row.uid===uid);
    assert.equal(unit.findBuff(`resonance:v3:scrap-shield:${unit.id}`)?.shield,125);
  }
  assert.equal(battle.resonanceMetrics.prototypeTraits.rhodes.shieldComponents,5);
});

test('Scrap temporary upgrades consume only battle-local selected components and preserve saved gear',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:340});
  const trait=prototypeSeason.traits.find((row)=>row.id==='rhodes');
  const heroes=trait.members.slice(0,6).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const sourceComponents=['tear','bow','blade','cloak','belt','plate'];
  const pieces=heroes.map((hero,index)=>({uid:`scrap-temp-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[{uid:`gear-${index}`,itemId:sourceComponents[index]}],row:9+index,col:3,dir:'RIGHT'}));
  const state={seed:340,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces};
  const {battle}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  const active=activePrototypeTraits(state,catalog);
  const result=preparePrototypeScrapGear(battle,state,catalog,active);
  assert.equal(active.find((row)=>row.id==='rhodes')?.tier,6);
  assert.equal(result.converted,6);
  const temporary=battle.allyUnits.filter((unit)=>unit.kind==='op').flatMap((unit)=>unit.mem.prototypeTemporaryItems??[]);
  assert.equal(temporary.length,6);
  assert.ok(temporary.every((item)=>catalog.equipment[item.itemId]&&item.isTemporary&&item.sourceTraitId==='rhodes'));
  assert.equal(temporary.every((item)=>item.quality==='lucky'),true);
  assert.deepEqual(state.pieces.map((piece)=>piece.equipment[0].itemId),sourceComponents);
  assert.equal(state.inventory,undefined);
});

test('Quickstriker kill dash and shield exist only on the four-member tier',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:340});
  const trait=prototypeSeason.traits.find((row)=>row.id==='combo');
  const run=(count)=>{
    const heroes=trait.members.slice(0,count).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
    const pieces=heroes.map((hero,index)=>({uid:`quick-${count}-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9+index,col:2+index,dir:'RIGHT'}));
    const {battle,prepared}=buildResonanceBattle({seed:340,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces},{data,catalog,recording:false,preview:true});
    battle.start();
    const killer=battle.allyUnits.find((row)=>row.uid===pieces[0].uid);
    const [enemyKey]=prepared.wave.spawns.map((spawn)=>spawn.enemyKey);
    const victim=battle.spawnEnemy(enemyKey,{pos:[9,8]}),target=battle.spawnEnemy(enemyKey,{pos:[10,8]});
    const oldTile=[killer.tileR,killer.tileC];
    battle.kill(victim,killer);
    const shield=killer.buffs.find((row)=>row.key.startsWith('resonance:v3:quickstriker-kill-shield:'));
    return {battle,killer,target,oldTile,shield};
  };
  const low=run(2);
  assert.equal(low.shield,undefined);
  assert.equal(low.battle.resonanceMetrics.prototypeTraits.combo?.targetDeathShields,undefined);
  const top=run(4);
  assert.ok(top.shield);
  assert.equal(top.shield.shield,200);
  assert.equal(top.shield.duration,3);
  assert.notDeepEqual([top.killer.tileR,top.killer.tileC],top.oldTile);
  assert.equal(Math.max(Math.abs(top.killer.tileR-top.target.tileR),Math.abs(top.killer.tileC-top.target.tileC)),1);
  assert.equal(top.battle.resonanceMetrics.prototypeTraits.combo.targetDeathDashes,1);
});

test('Dominator AP starts at zero and scales from actual effective SP cost per cast',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:341});
  const trait=prototypeSeason.traits.find((row)=>row.id==='dominator');
  const heroes=trait.members.map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId))
    .filter((hero)=>Number(catalog.operators[hero.sourceChessId].stars?.[1]?.skillOverrides?.spCost)>0).slice(0,2);
  const pieces=heroes.map((hero,index)=>({uid:`dominator-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9+index,col:3+index,dir:'RIGHT'}));
  const {battle}=buildResonanceBattle({seed:341,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces},{data,catalog,recording:false,preview:true});
  battle.start();
  const unit=battle.allyUnits.find((row)=>row.uid===pieces[0].uid),key=`resonance:v3:dominator-stack:${unit.id}`;
  assert.equal(unit.findBuff(key),null,'no AP is granted at combat start');
  const firstCost=unit.skill.spCost;
  unit.skill.setSpTotal(firstCost);
  assert.equal(unit.skill.activate('prototype-paid-cast'),true);
  unit.skill.end?.('prototype-test');
  const pct=Number(catalog.pacts.dominator.levels.find((row)=>row.threshold===2).effects[0].params.variables.APPercent);
  assert.equal(unit.findBuff(key)?.mods?.artsDealtMul,1+firstCost*pct/100);
  unit.skill.spCostMul=0.5;
  const secondCost=unit.skill.spCost;
  unit.skill.setSpTotal(secondCost);
  assert.equal(unit.skill.activate('prototype-reduced-paid-cast'),true);
  const expected=1+(firstCost+secondCost)*pct/100;
  assert.ok(Math.abs(unit.findBuff(key)?.mods?.artsDealtMul-expected)<1e-9);
  assert.equal(battle.resonanceMetrics.prototypeTraits.dominator.manaSpent,firstCost+secondCost);
  assert.equal(battle.resonanceContributions.find((row)=>row.charId===heroes[0].charId)?.skills,2);
});

test('Rebel extra max health waits for the real team-loss signal and is granted once',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:342});
  const trait=prototypeSeason.traits.find((row)=>row.id==='resistance');
  const heroes=trait.members.slice(0,5).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const pieces=heroes.map((hero,index)=>({uid:`rebel-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9,col:2+index,dir:'RIGHT'}));
  const {battle,prepared}=buildResonanceBattle({seed:342,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces},{data,catalog,recording:false,preview:true});
  battle.start();
  const units=pieces.map((piece)=>battle.allyUnits.find((unit)=>unit.uid===piece.uid));
  const tier=trait.effects.find((row)=>row.minUnits===5).variables;
  for(const unit of units){
    assert.equal(unit.findBuff(`resonance:v3:rebel-health:${unit.id}`)?.mods?.hpPct,tier.MaxHealthIncrease);
    assert.equal(unit.findBuff(`resonance:v3:rebel-signal-health:${unit.id}`),null);
  }
  const enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,{pos:[12,10]});
  const threshold=units.reduce((sum,unit)=>sum+unit.s.maxHp,0)*tier.PercentHealthTrigger;
  const hit=threshold*1.02/units.length;
  for(const unit of units)battle.dealDamage(enemy,unit,{amount:hit,type:'true',canDodge:false,tags:['rebel-loss-signal-fixture']});
  assert.equal(battle.prototypeRebelTriggered,true);
  for(const unit of units)assert.equal(unit.findBuff(`resonance:v3:rebel-signal-health:${unit.id}`)?.mods?.hpPct,tier.PercentMaxHealthBonus);
  assert.equal(battle.resonanceMetrics.prototypeTraits.resistance.signals,1);
  const maxAfterSignal=units[1].s.maxHp;
  battle.dealDamage(enemy,units[1],{amount:1,type:'true',canDodge:false,tags:['rebel-repeat-guard-fixture']});
  assert.equal(units[1].s.maxHp,maxAfterSignal,'later loss cannot re-stack the one-time health reward');
  assert.equal(battle.resonanceMetrics.prototypeTraits.resistance.signals,1);
});

test('Pit Fighter threshold heal completes within its two-second window and expires',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:343});
  const trait=prototypeSeason.traits.find((row)=>row.id==='breaker');
  const heroes=trait.members.slice(0,2).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const pieces=heroes.map((hero,index)=>({uid:`pit-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9,col:2+index,dir:'RIGHT'}));
  const {battle,prepared}=buildResonanceBattle({seed:343,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces},{data,catalog,recording:false,preview:true});
  battle.start();
  const unit=battle.allyUnits.find((row)=>row.uid===pieces[0].uid),enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,{pos:[9,10]});
  const maxHp=unit.s.maxHp;
  battle.dealDamage(enemy,unit,{amount:maxHp*0.6,type:'true',canDodge:false,tags:['pit-threshold-fixture']});
  assert.equal(unit.mem.prototypePitHealUsed,true);
  for(let index=0;index<61;index++)battle.step();
  const hpAfterWindow=unit.hp;
  assert.ok(Math.abs((hpAfterWindow-(maxHp*0.4))-maxHp*Number(trait.effects[0].variables.HealPercent))<0.1,JSON.stringify({hpAfterWindow,maxHp,expectedHeal:maxHp*Number(trait.effects[0].variables.HealPercent),actualHeal:unit.stats.heal,remaining:unit.mem.prototypePitHealRemaining,until:unit.mem.prototypePitHealUntil,time:battle.time}));
  assert.equal(unit.mem.prototypePitHealRemaining,0);
  for(let index=0;index<30;index++)battle.step();
  assert.equal(unit.hp,hpAfterWindow,'expired healing budget must not resume later');
  assert.ok(unit.stats.heal>0);
});

test('Automata converts damage accumulated across 20 crystal events exactly once',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:330});
  const trait=prototypeSeason.traits.find((row)=>row.id==='creation');
  const heroes=trait.members.slice(0,2).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const state={seed:330,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:heroes.map((hero,index)=>({uid:`automata-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9+index,col:5,dir:'RIGHT'}))};
  const {battle,prepared}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  battle.start();
  const unit=battle.allyUnits.find((row)=>row.kind==='op'),enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,{pos:[9,7]});
  for(let index=0;index<20;index++)battle.dealDamage(unit,enemy,{amount:10,type:'phys',canDodge:false,tags:['fixture']});
  assert.equal(battle.resonanceMetrics.prototypeTraits.creation?.crystalBlasts,1,JSON.stringify({metrics:battle.resonanceMetrics,units:battle.allyUnits.map((row)=>({charId:row.def?.charId,id:row.def?.raw?.id,kind:row.kind,mem:row.mem}))}));
  assert.equal(unit.mem.prototypeCrystals,0);
  assert.equal(unit.mem.prototypeAutomataDamage,0);
});

test('Form Swapper applies its source tier stat according to deployed row',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:332});
  const trait=prototypeSeason.traits.find((row)=>row.id==='formSwap');
  const heroes=trait.members.slice(0,2).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const state={seed:332,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:heroes.map((hero,index)=>({uid:`form-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:index===0?9:11,col:5,dir:'RIGHT'}))};
  const {battle}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  battle.start();
  const front=battle.allyUnits.find((unit)=>unit.uid==='form-0'),back=battle.allyUnits.find((unit)=>unit.uid==='form-1');
  assert.equal(front.mem.prototypeFormSwap,'frontline');
  assert.equal(back.mem.prototypeFormSwap,'backline');
  assert.ok(front.findBuff(`resonance:v3:form-swap-frontline:${front.id}`)?.mods?.dmgTakenMul<1);
  assert.ok(back.findBuff(`resonance:v3:form-swap-backline:${back.id}`)?.mods?.dmgDealtMul>1);
  assert.equal(battle.resonanceMetrics.prototypeTraits.formSwap.frontlineForms,1);
  assert.equal(battle.resonanceMetrics.prototypeTraits.formSwap.backlineForms,1);
});

test('High Roller skill casts resolve the source rocket, shield, coin, and triple branches',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:335});
  const trait=prototypeSeason.traits.find((row)=>row.id==='holyGun');
  const hero=prototypeSeason.heroes.find((row)=>row.charId===trait.members[0]);
  const run=(roll)=>{
    const state={seed:335,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:[{uid:'roller',operatorId:hero.sourceChessId,star:1,equipment:[],row:9,col:5,dir:'RIGHT'}]};
    const {battle,prepared}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
    battle.start();
    const unit=battle.allyUnits.find((row)=>row.uid==='roller');
    const enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,{pos:[9,7]});
    if(roll===0.9){enemy.s.maxHp=10000;enemy.hp=10000;}
    battle.rng=()=>roll;
    const hp=enemy.hp;
    assert.equal(unit.skill.activate('prototypeFixture',{free:true}),true);
    return {battle,unit,enemy,hp};
  };
  const rocket=run(0);
  assert.equal(rocket.hp-rocket.enemy.hp,rocket.hp,'eight source rockets can exceed the single-target fixture health; the first valid hit defeats it');
  assert.equal(rocket.battle.resonanceMetrics.damage,rocket.hp,'rocket damage is recorded by the actual battle damage handler');
  assert.equal(rocket.battle.resonanceMetrics.prototypeTraits.holyGun.rockets,8);
  const shield=run(0.3);
  assert.equal(shield.unit.mem.prototypeHighRollerLast,'shield');
  assert.ok(shield.unit.buffs.some((row)=>row.key.startsWith('resonance:v3:high-roller-shield:')));
  const coin=run(0.6);
  assert.deepEqual(coin.battle.resonanceResults.coins,[{amount:3,reason:'prototype_high_roller',sourceUnitId:coin.unit.id,sourceCharId:hero.charId}]);
  const session=createSession({seed:335,catalog});
  assert.equal(session.ok,true,session.error);
  const settlementState=session.state;
  settlementState.gold=10;
  assert.equal(validateSession(settlementState,{catalog}).ok,true,'use an intact session with its original UID/pool/bench state');
  const completedResult={battleId:'fixture-high-roller-coin-335',won:true,hpLoss:0,diagnostics:{errorCount:0},coins:coin.battle.resonanceResults.coins};
  const settled=applyAction(settlementState,{type:'fight'},{catalog,completedResult,fieldResolver:(state)=>getResonanceField(state,{data,catalog})});
  assert.equal(settled.ok,true,settled.error);
  assert.equal(settled.events.find((event)=>event.type==='fight-settled').battleGold,3);
  assert.ok(settled.state.gold>=13);
  assert.equal(validateSession(settled.state,{catalog}).ok,true);
  const duplicate=applyAction(settled.state,{type:'fight'},{catalog,completedResult,fieldResolver:(state)=>getResonanceField(state,{data,catalog})});
  assert.equal(duplicate.ok,false,'settled session cannot credit the same battle reward again');
  const triple=run(0.9);
  assert.equal(triple.battle.resonanceMetrics.prototypeTraits.holyGun.rockets,24);
  assert.equal(triple.hp-triple.enemy.hp,2400,'triple rocket branch fires 24 normal-damage rockets, not 24 triple-damage rockets');
});

test('Black Rose summon resolves a canonical native model and frees after five real skill activations',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:337});
  const trait=prototypeSeason.traits.find((row)=>row.id==='sui');
  const natural=trait.members.slice(0,3).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const extras=prototypeSeason.heroes.filter((hero)=>!trait.members.includes(hero.charId)).slice(0,2);
  const heroes=[...natural,...extras];
  const state={seed:337,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:heroes.map((hero,index)=>({uid:`rose-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],extraPacts:index>=natural.length?['sui']:[],row:9+index,col:1+index*2,dir:'RIGHT'}))};
  const {battle,prepared}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  battle.start();
  const errorsBeforeNullDamage=battle.errors.length;
  battle.emit('damaged',{source:null,target:null,dealt:1});
  assert.equal(battle.errors.length,errorsBeforeNullDamage,'nullable environmental damage events do not crash the Sion consumer');
  const sion=battle.allyUnits.find((unit)=>unit.kind==='token'&&unit.defId==='prototype_TFT13_Sion');
  assert.ok(sion);
  const sourceGuardRes=Number(activePrototypeTraits(state,catalog).find((row)=>row.id==='sui').variables['{2e45fc86}']);
  assert.ok(Math.abs(sion.base.def-tftArmorToNativeDefense(sourceGuardRes,50))<1e-6,'TFT armor rating is converted to the V3 flat-defense budget');
  assert.ok(Math.abs(sion.base.res-tftMrToNativeResistance(sourceGuardRes))<1e-6,'TFT magic-resistance rating is converted to Native percentage resistance');
  assert.equal(sion.s.res,sion.base.res,'converted Native resistance is applied without reaching the immunity cap');
  assert.ok(Math.abs((sion.s.bat*100/sion.s.aspd)-(1/0.7))<1e-6,'source 0.7 attacks/sec maps to one native attack interval, not two compounded slowdowns');
  assert.ok(battle.allyUnits.filter((unit)=>unit.kind==='op').every((unit)=>unit.buffs.every((row)=>!row.key.includes('black-rose-armor'))), 'Black Rose armor is not incorrectly granted to pact members');
  const rendered=unitInfo(sion);
  assert.equal(rendered.spine,'token_10022_kazema_shadow');
  const model=data.assets.tokens?.[rendered.spine]?.spine;
  assert.ok(model?.skel&&model?.atlas&&model?.textures?.length,'renderer manifest resolves skeleton, atlas, and texture');
  const enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,{pos:[9,7]});
  enemy.s.maxHp=10000;enemy.hp=10000;
  assert.equal(sion.mem.prototypeRoseChained,true);
  for(let index=0;index<5;index++){
    const caster=battle.allyUnits.find((unit)=>unit.uid===`rose-${index%3}`);
    assert.equal(caster.skill.activate('prototypeFixture',{free:true}),true);
    if(caster.skill.active)caster.skill.end('prototypeFixture');
  }
  assert.equal(sion.mem.prototypeRoseChained,false);
  assert.equal(sion.hp,sion.s.maxHp);
  assert.equal(battle.resonanceMetrics.prototypeTraits.sui.sionFreed,1);
  assert.ok(enemy.findBuff(`resonance:v3:sion-charge-mark:${enemy.id}`),'five-tier guard marks nearby enemies with source 15% vulnerability');
  assert.equal(enemy.findBuff(`resonance:v3:sion-charge-mark:${enemy.id}`).mods,null,'mark itself does not amplify damage from non-Black-Rose allies');
  const suiAttacker=battle.allyUnits.find((unit)=>unit.uid==='rose-0');
  const markedHitsBefore=battle.resonanceMetrics.prototypeTraits.sui.blackRoseMarkedHits??0;
  const hit={mul:1,isAttack:true};battle.emit('hit',{source:suiAttacker,target:enemy,dmg:hit});
  assert.ok(Math.abs(hit.mul-1.15)<1e-6,'marked damage bonus is scoped to Black Rose members');
  assert.equal(battle.resonanceMetrics.prototypeTraits.sui.blackRoseMarkedHits,markedHitsBefore+1);
  const nonSui=battle.allyUnits.find((unit)=>unit.uid===`rose-${natural.length}`),nonSuiHit={mul:1,isAttack:true};
  battle.emit('hit',{source:nonSui,target:enemy,dmg:nonSuiHit});
  assert.equal(nonSuiHit.mul,1,'marked enemies do not take bonus damage from non-Black-Rose allies');
  assert.ok(battle.resonanceMetrics.prototypeTraits.sui.sionNovaHits>0);
  assert.equal(sion.skill.activate('prototypeSionFixture',{free:true}),true,'freed guard can activate its native SkillRuntime');
  assert.ok(sion.findBuff(`resonance:v3:sion-active-shield:${sion.id}`)?.shield>0);
  assert.equal(battle.resonanceMetrics.prototypeTraits.sui.sionActiveCasts,1);
});

test('Black Rose emblem identities reach source seven-tier and revive the fallen summon once',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:338});
  const trait=prototypeSeason.traits.find((row)=>row.id==='sui');
  const natural=trait.members.map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const extras=prototypeSeason.heroes.filter((hero)=>!trait.members.includes(hero.charId)).slice(0,2);
  const roster=[...natural,...extras];
  const state={seed:338,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:roster.map((hero,index)=>({uid:`rose7-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],extraPacts:index>=5?['sui']:[],row:9+(index%4),col:1+index,dir:'RIGHT'}))};
  const active=activePrototypeTraits(state,catalog).find((row)=>row.id==='sui');
  assert.equal(active?.tier,7);
  assert.equal(active?.count,7);
  assert.equal(new Set(active.members).size,7,'summons never add natural identities');
  const {battle}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  battle.start();
  const sion=battle.allyUnits.find((unit)=>unit.kind==='token'&&unit.defId==='prototype_TFT13_Sion');
  assert.ok(sion);
  assert.ok(sion.skill,'summoned guard receives an actual SkillRuntime');
  battle.kill(sion,null);
  assert.equal(sion.alive,true);
  assert.equal(sion.hp,sion.s.maxHp*0.5,'revive restores the source 50% health');
  assert.ok(Math.abs(sion.mem.prototypeRoseOmnivamp-0.4)<1e-6);
  assert.equal(sion.findBuff(`resonance:v3:sion-revive:${sion.id}`)?.mods?.aspd,300);
  battle.kill(sion,null);
  assert.equal(sion.alive,false,'the source revival is once per summon life cycle');
  assert.equal(battle.resonanceMetrics.prototypeTraits.sui.sionRevivals,1);
});

test('Firelight relocates toward an enemy, extends attack range during the dash, and heals stored damage',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:339});
  const trait=prototypeSeason.traits.find((row)=>row.id==='flight');
  const heroes=trait.members.slice(0,2).map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const state={seed:339,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:heroes.map((hero,index)=>({uid:`flight-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9,col:3+index*2,dir:'RIGHT'}))};
  const {battle,prepared}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});
  battle.start();
  const unit=battle.allyUnits.find((row)=>row.uid==='flight-0');
  const enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,{pos:[9,8]});
  const start=[unit.tileR,unit.tileC];
  battle.dealDamage(enemy,unit,{amount:100,type:'phys',canDodge:false});
  unit.mem.prototypeFlightNextDash=6;
  battle.time=6;
  battle.emit('tick',{});
  assert.notDeepEqual([unit.tileR,unit.tileC],start);
  assert.ok(unit.s.rangeExtend>=99);
  assert.equal(battle.resonanceMetrics.prototypeTraits.flight.dashes,1);
  assert.ok(battle.resonanceMetrics.prototypeTraits.flight.dashHealing>0);
});

test('Watcher switches one live mitigation layer and Enforcer wanted kills empower every Enforcer',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:350});
  const watcher=prototypeSeason.traits.find((row)=>row.id==='watcher');
  const enforcer=prototypeSeason.traits.find((row)=>row.id==='enforcer');
  const heroes=[...watcher.members.slice(0,2),...enforcer.members.slice(0,2)].map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const state={seed:350,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:heroes.map((hero,index)=>({uid:`watch-enforce-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9+index,col:2+index,dir:'RIGHT'}))};
  const {battle}=buildResonanceBattle(state,{data,catalog,recording:false,preview:false});
  const planned=[...(battle._pending??[])].map((spawn)=>({spawn,hp:Number(battle.enemyOverrides?.[spawn.enemyKey]?.stats?.maxHp??battle.enemyOverrides?.[spawn.enemyKey]?.stats?.hp??battle.data.getEnemy(spawn.enemyKey)?.maxHp??0)*Number(spawn.mods?.hpMul??1)})).sort((a,b)=>b.hp-a.hp);
  assert.ok(planned.length>1,'the test battle contains a full native wave plan');
  battle.start();
  const watcherUnit=battle.allyUnits.find((unit)=>unit.uid==='watch-enforce-0');
  battle.emit('tick',{});
  const watcherKeys=watcherUnit.buffs.filter((buff)=>/watcher-(?:base|dynamic)/.test(buff.key));
  assert.equal(watcherKeys.length,1);
  assert.match(watcherKeys[0].key,/watcher-dynamic/);
  assert.ok(Math.abs(watcherKeys[0].mods.dmgTakenMul-0.7)<1e-6);
  const wantedSpawn=planned[0].spawn;
  const enemy=battle.spawnEnemy(wantedSpawn.enemyKey,{mods:wantedSpawn.mods,pos:[9,7]});
  assert.equal(enemy.mem.prototypeWanted,true,'spawn callback marks the wanted unit before it can be killed');
  battle.kill(enemy,null);
  const later=battle.spawnEnemy(wantedSpawn.enemyKey,{mods:wantedSpawn.mods,pos:[9,7]});
  assert.notEqual(later.mem.prototypeWanted,true,'a later wave spawn cannot refill the finite wanted quota');
  for(const uid of ['watch-enforce-2','watch-enforce-3']){
    const unit=battle.allyUnits.find((row)=>row.uid===uid);
    assert.ok(unit.buffs.some((buff)=>buff.key.includes('enforcer-wanted-kill-')),'every active Enforcer gains the wanted-kill attack-speed stack');
  }
  assert.equal(battle.resonanceMetrics.prototypeTraits.enforcer.wantedKills,2);
});

test('Emissary effects are team-wide only at exact one or four identities',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:351});
  const trait=prototypeSeason.traits.find((row)=>row.id==='emissary');
  const tristana=prototypeSeason.heroes.find((hero)=>hero.apiName==='TFT13_Tristana');
  const natural=trait.members.map((charId)=>prototypeSeason.heroes.find((hero)=>hero.charId===charId));
  const others=prototypeSeason.heroes.filter((hero)=>!trait.members.includes(hero.charId));
  const run=(heroes,label)=>{
    const state={seed:351,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,pieces:heroes.map((hero,index)=>({uid:`emissary-${label}-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9+index,col:2+index,dir:'RIGHT'}))};
    const {battle}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});battle.start();return battle;
  };
  const one=run([tristana,...others.slice(0,2)],'one');
  assert.equal(one.resonanceMetrics.prototypeTraits.emissary.count,1);
  assert.ok(one.allyUnits.filter((unit)=>unit.kind==='op').every((unit)=>unit.buffs.some((buff)=>buff.key.includes('emissary-tristana-team'))));
  const two=run(natural.slice(0,2),'two');
  assert.equal(two.resonanceMetrics.prototypeTraits.emissary,undefined,'two members are outside the exact source thresholds');
  const four=run(natural,'four');
  assert.equal(four.resonanceMetrics.prototypeTraits.emissary.count,4);
  for(const unit of four.allyUnits.filter((row)=>row.kind==='op'))assert.ok(unit.buffs.some((buff)=>buff.key.includes('emissary-four-member')));
});

test('Ambessa emissary armor uses prior won matches capped at seven, never minion kills',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:352});
  const trait=prototypeSeason.traits.find((row)=>row.id==='emissary');
  const ambessa=prototypeSeason.heroes.find((hero)=>hero.apiName==='TFT13_Ambessa');
  const others=prototypeSeason.heroes.filter((hero)=>!trait.members.includes(hero.charId));
  const run=(wins,label)=>{
    const state={seed:352,difficulty:'NORMAL',round:2,roundLimit:28,rulesVersion:3,history:Array.from({length:wins},(_,index)=>({type:'fight-settled',round:index+1,won:true})),pieces:[ambessa,...others.slice(0,2)].map((hero,index)=>({uid:`ambessa-${label}-${index}`,operatorId:hero.sourceChessId,star:1,equipment:[],row:9,col:2+index,dir:'RIGHT'}))};
    const {battle,prepared}=buildResonanceBattle(state,{data,catalog,recording:false,preview:true});battle.start();
    const units=battle.allyUnits.filter((unit)=>unit.kind==='op');
    const expected=Math.min(7,wins)*4;
    for(const unit of units)assert.equal(unit.mem.prototypeRatingBonuses?.['emissary-ambessa']?.armor??0,expected);
    const before=units[0].mem.prototypeRatingBonuses?.['emissary-ambessa']?.armor??0;
    const enemy=battle.spawnEnemy(prepared.wave.spawns[0].enemyKey,{pos:[12,10]});
    battle.kill(enemy,units[0]);
    assert.equal(units[0].mem.prototypeRatingBonuses?.['emissary-ambessa']?.armor??0,before,'PvE minion kills do not count as defeated opponents');
    return battle;
  };
  assert.equal(run(0,'zero').resonanceMetrics.prototypeTraits.emissary.pveWins,undefined);
  assert.equal(run(1,'one').allyUnits.find((unit)=>unit.kind==='op').mem.prototypeRatingBonuses['emissary-ambessa'].armor,4);
  assert.equal(run(7,'seven').allyUnits.find((unit)=>unit.kind==='op').mem.prototypeRatingBonuses['emissary-ambessa'].armor,28);
  assert.equal(run(8,'eight').allyUnits.find((unit)=>unit.kind==='op').mem.prototypeRatingBonuses['emissary-ambessa'].armor,28);
});
