import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { applyAction, createSession, drawStrategies, viewSession } from '../../server/modes/resonance/session.js';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';

const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:887});
const create=()=>{const result=createSession({seed:887,difficulty:'NORMAL',catalog});assert.equal(result.ok,true,result.error);return result.state;};
function chooseStrategy(state,id){
  state.pendingChoices=[{uid:'strategy-source-fixture',type:'strategy',options:[id],remaining:1}];state.phase='choice';
  const result=applyAction(state,{type:'chooseStrategy',choiceUid:'strategy-source-fixture',strategyId:id},{catalog,recording:false});
  assert.equal(result.ok,true,result.error);return result.state;
}
function sourceStrategy(apiName){return Object.values(catalog.strategies).find((entry)=>entry.source?.recordId===apiName);}

test('resolved-set economic strategy adapters consume their source grants through session actions',()=>{
  const trade=sourceStrategy('TFT6_Augment_TradeSector');assert.ok(trade);
  const tradeState=create(),startGold=tradeState.gold;
  const selectedTrade=chooseStrategy(tradeState,trade.id);
  assert.equal(selectedTrade.gold,startGold+1,'source trade sector grants one gold');
  assert.equal(selectedTrade.strategyState[trade.id].freeAvailable,true);
  const refreshed=applyAction(selectedTrade,{type:'refresh'},{catalog,recording:false});
  assert.equal(refreshed.ok,true,refreshed.error);
  assert.equal(refreshed.state.gold,selectedTrade.gold,'node refresh is free');
  assert.equal(refreshed.state.strategyState[trade.id].freeAvailable,false);

  const high=sourceStrategy('TFT9_Augment_HighEndSector');assert.ok(high);
  const highState=create();highState.xp=5;
  const selectedHigh=chooseStrategy(highState,high.id),goldAfterGrant=selectedHigh.gold;
  assert.equal(selectedHigh.gold,highState.gold+4,'source grant applies four gold');
  const leveled=applyAction(selectedHigh,{type:'buyXp'},{catalog,recording:false});
  assert.equal(leveled.ok,true,leveled.error);
  assert.equal(leveled.state.level,4);
  assert.equal(leveled.state.freeRefreshes,4,'leveling to four grants four refreshes');
  assert.equal(leveled.state.gold,goldAfterGrant-4);
  const free=applyAction(leveled.state,{type:'refresh'},{catalog,recording:false});
  assert.equal(free.ok,true,free.error);assert.equal(free.state.gold,leveled.state.gold);assert.equal(free.state.freeRefreshes,3);

  const epoch=sourceStrategy('TFT11_Augment_Epoch');assert.ok(epoch);
  const selectedEpoch=chooseStrategy(create(),epoch.id);
  assert.equal(selectedEpoch.freeRefreshes,2,'source Epoch rerolls are usable by V3');
  assert.ok(selectedEpoch.level>3||selectedEpoch.xp>0,'source Epoch XP advances the V3 progression');
});

test('Going Long removes interest and grants its source XP at each combat settlement',()=>{
  const goingLong=sourceStrategy('TFT10_Augment_GoingLong');assert.ok(goingLong);
  const state=create();state.gold=100;state.xp=0;
  const selected=chooseStrategy(state,goingLong.id);
  assert.equal(selected.gold,115,'source grants 15 gold immediately');
  assert.equal(viewSession(selected,{catalog}).actionCosts.interestCap,0,'interest is disabled while the strategy is active');
  const result=applyAction(selected,{type:'fight'},{catalog,recording:false,
    fieldResolver:()=>({known:true,cells:new Map()}),
    battleRunner:()=>({won:true,hpLoss:0,diagnostics:{errorCount:0}})});
  assert.equal(result.ok,true,result.error);
  assert.equal(result.state.gold,120,'a 100-gold balance earns no interest on the four-gold first node');
  assert.equal(result.state.history.at(-1).interest,0);
  assert.equal(result.state.level,4,'ordinary settlement XP plus source 4 round-start XP advances progression');
  assert.equal(result.state.xp,0);
});

test('Clear Mind grants source XP only when the full bench is empty at settlement',()=>{
  const clearMind=sourceStrategy('TFT6_Augment_ClearMind');assert.ok(clearMind);
  const run=(withBench)=>{
    const state=chooseStrategy(create(),clearMind.id);state.xp=0;
    const deployed=state.pieces.slice(0,withBench?state.pieces.length-1:state.pieces.length);
    for(const [index,piece] of deployed.entries()){piece.row=0;piece.col=index;piece.benchSlot=null;}
    const cells=new Map(deployed.map((piece)=>[`${piece.row},${piece.col}`,catalog.operators[piece.operatorId].position==='RANGED'?'RANGED':'MELEE']));
    const result=applyAction(state,{type:'fight'},{catalog,recording:false,fieldResolver:()=>({deployMap:cells}),
      battleRunner:()=>({won:true,hpLoss:0,diagnostics:{errorCount:0}})});
    assert.equal(result.ok,true,result.error);return result.state;
  };
  const emptyBench=run(false),withBench=run(true);
  assert.equal(emptyBench.xp,5,'2 ordinary node XP plus 3 source Clear Mind XP');
  assert.equal(withBench.xp,2,'no bonus when a champion remains on the bench');
});

test('Level Up applies its source initial XP and bonus only to purchased XP',()=>{
  const levelUp=sourceStrategy('TFT6_Augment_MaxLevel10');assert.ok(levelUp);
  const selected=chooseStrategy(create(),levelUp.id);
  assert.equal(selected.level,4);assert.equal(selected.xp,6,'12 source XP are normalized through the current 3→4/4→5 table');
  const gold=selected.gold;
  const bought=applyAction(selected,{type:'buyXp'},{catalog,recording:false});
  assert.equal(bought.ok,true,bought.error);assert.equal(bought.state.gold,gold-4);
  assert.equal(bought.state.level,5);assert.equal(bought.state.xp,2,'the 4 XP purchase grants its source 2 XP bonus');
  assert.deepEqual(bought.events.find((event)=>event.type==='xp-purchased')&&{xp:bought.events.find((event)=>event.type==='xp-purchased').xp,bonusXp:bought.events.find((event)=>event.type==='xp-purchased').bonusXp},{xp:6,bonusXp:2});
});

test('Pit Fighter source growth is shown in localized terms with its exact companion',()=>{
  const source=prototypeSeason.strategyCandidates.find((row)=>row.apiName==='TFT13_Augment_PitFighter');
  const strategy=sourceStrategy('TFT13_Augment_PitFighter');
  assert.ok(source&&strategy);
  const heroId=source.grantedHeroes?.find((hero)=>hero.operatorId)?.operatorId;
  const heroName=heroId?catalog.operators[heroId]?.name:null;
  const attackPct=Number(source.effects.ADPerLoss)*100;
  const hpPerWin=Number(source.effects.HealthPerWin);
  const displayAttackPct=Number.isInteger(attackPct)?attackPct:Number(attackPct.toFixed(2));
  assert.equal(strategy.description,`${heroName?`招募${heroName}；`:''}之后每场战斗结束，上阵的【重装】干员永久成长：失败时攻击力+${displayAttackPct}%，胜利时生命上限+${hpPerWin}。`);
  assert.ok(heroName,'the mapped companion must have a localized catalog name');
  assert.equal(strategy.effects[0].params.attackPctPerLoss,attackPct);
  assert.equal(strategy.effects[0].params.hpPerWin,hpPerWin);
  assert.ok(!/来源干员|布鲁斯尔|来源/.test(strategy.description));
});

test('Crest choice atomically grants its exact source companion with the transfer',()=>{
  const crest=sourceStrategy('TFT13_Augment_AcademyCrest');assert.ok(crest);
  const heroId=crest.effects[0].params.bonusOperatorIds[0];assert.ok(heroId);
  const state=chooseStrategy(create(),crest.id),choice=state.pendingChoices.find((row)=>row.type==='transfer'&&row.source===crest.id);
  assert.ok(choice);assert.deepEqual(choice.bonusOperatorIds,[heroId]);
  const before=state.pieces.filter((piece)=>piece.operatorId===heroId).length;
  const claimed=applyAction(state,{type:'claimReward',choiceUid:choice.uid,optionIds:[choice.options[0]]},{catalog,recording:false});
  assert.equal(claimed.ok,true,claimed.error);
  assert.equal(claimed.state.pieces.filter((piece)=>piece.operatorId===heroId).length,before+1);
  assert.equal(claimed.state.inventory.at(-1).itemId,choice.options[0]);
});

test('Crown choice grants a locked sponsor item and emblem atomically',()=>{
  const crown=sourceStrategy('TFT13_Augment_AcademyCrown');assert.ok(crown);
  const state=chooseStrategy(create(),crown.id),choice=state.pendingChoices.find((row)=>row.type==='transfer'&&row.source===crown.id);
  assert.ok(choice);assert.equal(choice.bonusSponsorItemId!=null,true);
  assert.equal(choice.bonusSponsorSet.length,3);
  assert.ok(choice.bonusSponsorSet.includes(choice.bonusSponsorItemId));
  assert.deepEqual(state.prototypeMeta.economy.academy.sponsoredItemIds,choice.bonusSponsorSet);
  const before=state.inventory.length;
  const claimed=applyAction(state,{type:'claimReward',choiceUid:choice.uid,optionIds:[choice.options[0]]},{catalog,recording:false});
  assert.equal(claimed.ok,true,claimed.error);
  assert.equal(claimed.state.inventory.length,before+2);
  assert.ok(claimed.state.inventory.some((item)=>item.itemId===choice.options[0]));
  assert.ok(claimed.state.inventory.some((item)=>item.itemId===choice.bonusSponsorItemId));
  assert.deepEqual(claimed.state.prototypeMeta.economy.academy.crownGrantedItemIds,[choice.bonusSponsorItemId]);

  const full=structuredClone(state);full.inventory=Array.from({length:19},(_,index)=>({uid:`i${100+index}`,itemId:choice.bonusSponsorItemId}));
  const rejected=applyAction(full,{type:'claimReward',choiceUid:choice.uid,optionIds:[choice.options[0]]},{catalog,recording:false});
  assert.equal(rejected.ok,false);assert.equal(rejected.error,'INVENTORY_CAPACITY');
  assert.equal(full.inventory.length,19,'failed claim leaves the source state untouched');
  assert.equal(full.pendingChoices.some((row)=>row.uid===choice.uid),true);
});

test('Crown candidates keep exact source rewards and exclude unresolved source items',()=>{
  const sourceCrowns=prototypeSeason.augmentCandidates.filter((row)=>row.apiName.endsWith('Crown'));
  const playable=new Map(Object.values(catalog.strategies).filter((row)=>row.source?.recordId?.endsWith('Crown')).map((row)=>[row.source.recordId,row]));
  const expectedPlayable=sourceCrowns.map((row)=>row.apiName);
  assert.deepEqual([...playable.keys()].sort(),expectedPlayable.sort());
  assert.equal(sourceCrowns.length,21,'the complete source reference remains present');
  for(const [apiName,strategy] of playable){
    const effect=strategy.effects.find((row)=>row.kind==='choose_transfer');
    assert.ok(effect,apiName);
    assert.ok(effect.params.bonusOperatorIds.every((operatorId)=>catalog.config.activeOperatorIds.includes(operatorId)),apiName);
    if(apiName==='TFT13_Augment_AcademyCrown'){
      assert.equal(effect.params.bonusSponsorItem,true);
      assert.equal(effect.params.bonusRewards.length,0);
    }else{
      assert.notEqual(effect.params.bonusSponsorItem,true,`${apiName} must not inherit Academy Crown's sponsor rule`);
      assert.ok(effect.params.bonusRewards.length||effect.params.bonusOperatorIds.length,`${apiName} has source-backed reward mapping`);
    }
  }
  for(const apiName of ['TFT13_Augment_AmbusherCrown','TFT13_Augment_CabalCrown','TFT13_Augment_ConquerorCrown','TFT13_Augment_DominatorCrown','TFT13_Augment_FirelightCrown','TFT13_Augment_QuickstrikerCrown','TFT13_Augment_RebelCrown','TFT13_Augment_SentinelCrown']){
    const effect=playable.get(apiName)?.effects[0];assert.ok(effect,`${apiName} has exact source item mapping`);
    const source=sourceCrowns.find((row)=>row.apiName===apiName);
    const sourceItem=source.grantedItems.find((item)=>!/emblem/i.test(item.name));
    const runtimeItem=catalog.prototypeSourceGear.bySourceApiName[sourceItem.apiName];
    assert.ok(runtimeItem,`${sourceItem.apiName} maps to dedicated runtime gear`);
    assert.ok(effect.params.bonusRewards.some((reward)=>reward.kind==='item'&&reward.itemId===runtimeItem),apiName);
  }
  const family=playable.get('TFT13_Augment_FamilyCrown').effects[0].params.bonusOperatorIds;
  assert.equal(family.length,2,'both exact Family Crown champions are granted');
  assert.ok(family.every((operatorId)=>catalog.operators[operatorId].name!=='Vi'),'substring match must not invent Vi as a grant');
});

test('all 21 Crown claims atomically grant source-mapped items, emblems, and named champions',()=>{
  for(const source of prototypeSeason.augmentCandidates.filter((row)=>row.apiName.endsWith('Crown'))){
    const crown=sourceStrategy(source.apiName);assert.ok(crown,source.apiName);
    const effect=crown.effects.find((row)=>row.kind==='choose_transfer');
    const state=chooseStrategy(create(),crown.id),choice=state.pendingChoices.find((row)=>row.type==='transfer'&&row.source===crown.id);
    assert.ok(choice,source.apiName);
    assert.deepEqual(choice.bonusOperatorIds,effect.params.bonusOperatorIds,source.apiName);
    const beforeOperators=new Map(state.pieces.reduce((map,piece)=>map.set(piece.operatorId,(map.get(piece.operatorId)??0)+1),new Map()));
    const beforeItems=new Map(state.inventory.reduce((map,row)=>map.set(row.itemId,(map.get(row.itemId)??0)+1),new Map()));
    const claimed=applyAction(state,{type:'claimReward',choiceUid:choice.uid,optionIds:[choice.options[0]]},{catalog,recording:false});
    assert.equal(claimed.ok,true,`${source.apiName}: ${claimed.error}`);
    assert.equal(claimed.state.inventory.filter((row)=>row.itemId===choice.options[0]).length,(beforeItems.get(choice.options[0])??0)+1,source.apiName);
    for(const reward of effect.params.bonusRewards.filter((row)=>row.kind==='item'))assert.equal(claimed.state.inventory.filter((row)=>row.itemId===reward.itemId).length,(beforeItems.get(reward.itemId)??0)+1,`${source.apiName}:${reward.itemId}`);
    for(const operatorId of effect.params.bonusOperatorIds)assert.equal(claimed.state.pieces.filter((row)=>row.operatorId===operatorId).length,(beforeOperators.get(operatorId)??0)+1,`${source.apiName}:${operatorId}`);
    if(effect.params.bonusSponsorItem)assert.ok(claimed.state.prototypeMeta.economy.academy.crownGrantedItemIds.length>0);
  }
});

test('weighted strategy offers preserve 42/308 source class mass with unique eligible picks',()=>{
  const transferIds=new Set(Object.values(catalog.strategies).filter((row)=>row.effects?.some((effect)=>effect.kind==='choose_transfer')).map((row)=>row.id));
  const strategyIds=new Set(Object.keys(catalog.strategies));
  assert.deepEqual(catalog.prototypeStrategyPool.sourceEmblemCount,42);
  assert.equal(catalog.prototypeStrategyPool.sourceCandidateCount,308);
  assert.equal(catalog.prototypeStrategyPool.playableEmblemCount,42,'all exact source emblem strategies have consumers');
  let transferPicks=0,totalPicks=0;
  const state=create();
  for(let seed=1;seed<=1200;seed++){
    state.seed=seed;state.rngCounter=0;state.strategies=[];state.pendingChoices=[];
    const picks=drawStrategies(state,catalog);
    assert.equal(picks.length,3);
    assert.equal(new Set(picks).size,3,'offers never repeat an entry');
    for(const id of picks){assert.ok(strategyIds.has(id));if(transferIds.has(id))transferPicks++;totalPicks++;}
  }
  const ratio=transferPicks/totalPicks,sourceRatio=42/308;
  assert.ok(Math.abs(ratio-sourceRatio)<0.025,`observed ${ratio} should represent source group ratio ${sourceRatio}`);
  assert.match(catalog.prototypeStrategyPool.weighting,/does not claim TFT original offer odds/);
});
