import test from 'node:test';
import assert from 'node:assert/strict';
import { academySponsorSets, applyPrototypeEconomy, chooseAcademySponsorSet, prototypeEconomyRules, prototypeEconomySources, junkerKingUpgrades } from '../../shared/resonance/prototype-economy.js';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';
import { installPrototypeEconomy, onPrototypeEconomyPrep, onPrototypeEconomyResult } from '../../server/sim/content/resonance/prototype-economy.js';
import { installPrototypeSourceGear } from '../../server/sim/content/resonance/prototype-source-gear.js';
import { applyPrototypeSourceGear } from '../../shared/resonance/prototype-source-gear.js';
import { prototypeRatingTotal, setPrototypeRatingBonus } from '../../server/sim/content/resonance/prototype-rating.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { applyAction, createSession } from '../../server/modes/resonance/session.js';
import { getResonanceField } from '../../server/modes/resonance/battle.js';
import { resonanceResultExtras, createBattleFromSpec, compactResult, fitResult } from '../../server/sim/spec.js';
import { ResonanceMatch } from '../../server/modes/resonance/native-match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { validateClientResult } from '../../server/match/fields.js';

const tier=(id,count,variables={},members=[])=>({id,count,tier:count,minUnits:count,maxUnits:count,variables,members});
const state=(economy={})=>({seed:14,round:1,lossStreak:0,pendingChoices:[],prototypeMeta:{economy}});
const sourceOptions=(values)=>values.map(([id,label,cost,grant])=>({id,label,description:label,cost,grant}));
// Sponsors, markets and chests belong to the Set 13 / faction season 1 pacts; faction season 2 retires them.
const seasonOne=(catalog={})=>({...catalog,config:{...(catalog.config??{}),seasonId:prototypeSeason.id}});

test('economy catalog source pointers and thresholds match the locked 14.23 trait rows',()=>{
  assert.ok(prototypeEconomySources.season.includes('teamfighttactics.leagueoflegends.com'));
  assert.ok(prototypeEconomySources.conquerorTable.includes('lolchess.gg/rewards/set13/'));
  for(const [source,id] of [['Academy','academy'],['Chem-Baron','risk'],['Conqueror','conqueror'],['Family','family'],['Junker King','armory']]){
    const entry=prototypeSeason.traits.find((row)=>row.sourceName===source);
    assert.equal(entry.id,id);
  }
  assert.deepEqual(prototypeEconomyRules.conqueror.chestThresholds,[10,35,65,100,150,200,330,440,550,660,750,850,1000,1200,1500]);
  assert.equal(prototypeEconomyRules.chemBaron.shimmerBreakpoint,100);
  assert.deepEqual(prototypeEconomyRules.academy.itemsByTier,{3:1,4:2,5:3,6:3});
});

test('Academy locks three sponsors once and tiers grant only the cumulative new items',()=>{
  const offers=sourceOptions([['item-a','装备甲',0,[{kind:'item',id:'item-a'}]],['item-b','装备乙',0,[{kind:'item',id:'item-b'}]],['item-c','装备丙',0,[{kind:'item',id:'item-c'}]]]);
  const catalog=seasonOne({prototypeEconomy:{academy:{sponsoredItemIds:['item-a','item-b','item-c'],sponsorOptions:offers}}});
  const first=onPrototypeEconomyPrep(state(),catalog,[tier('academy',3)]);
  assert.deepEqual(first.state.prototypeMeta.economy.academy.sponsoredItemIds,['item-a','item-b','item-c']);
  assert.equal(first.choiceDrafts[0].economyKind,'academy_sponsor');
  assert.deepEqual(first.choiceDrafts[0].options.map((x)=>x.id),['item-a']);
  assert.deepEqual(first.choiceDrafts[0].options[0].grant,[{kind:'item',id:'item-a'}]);
  const leveled=state({academy:{sponsoredItemIds:['item-a','item-b','item-c'],claimedItemIds:['item-a'],}});
  const second=onPrototypeEconomyPrep(leveled,catalog,[tier('academy',4)]);
  assert.deepEqual(second.choiceDrafts[0].options.map((x)=>x.id),['item-b']);
  const max=onPrototypeEconomyPrep(state({academy:{sponsoredItemIds:['item-a','item-b','item-c'],claimedItemIds:['item-a','item-b','item-c']}}),catalog,[tier('academy',6)]);
  assert.equal(max.choiceDrafts.length,0,'six Academy units do not resend the three cumulative sponsored items');
});

test('Academy sponsor whitelist chooses only complete, source-listed three-item sets and allows unique items across holders',()=>{
  const ids=[...new Set(academySponsorSets.flatMap((set)=>set.map(([,id])=>id)))];
  const equipment=Object.fromEntries(ids.map((id)=>[id,{id,name:id,kind:'completed',grantAllowed:true,unique:true}]));
  const catalog=applyPrototypeEconomy({equipment});
  const sets=catalog.prototypeEconomy.academy.sponsorSets;
  assert.equal(sets.length,academySponsorSets.length);
  assert.ok(sets.every((set)=>set.itemIds.length===3&&new Set(set.itemIds).size===3&&set.sourceNames.length===3));
  assert.deepEqual(chooseAcademySponsorSet(14,sets),chooseAcademySponsorSet(14,academySponsorSets));
  assert.deepEqual(catalog.prototypeEconomy.academy.eligibleItemIds,[...new Set(sets.flatMap((set)=>set.itemIds))].sort());
  assert.ok(catalog.prototypeEconomy.academy.sponsorOptions.every((option)=>catalog.equipment[option.id]?.grantAllowed===true));
  const prepared=onPrototypeEconomyPrep(state(),seasonOne(catalog),[tier('academy',3)]);
  assert.equal(prepared.choiceDrafts[0].options[0].id,prepared.state.prototypeMeta.economy.academy.sponsoredItemIds[0]);
});

test('Chem-Baron Shimmer counts the completed combat result, resets on wins, and journals threshold markets once',()=>{
  const active=[tier('risk',3,{ShimmerPerCombat:15,ShimmerPerCombatStreaking:30,MinStreakLength:3,ShimmerBreakpoint:100,HealthPerSkip:20})];
  let current=state({chemBaron:{shimmer:55,lossStreak:0}});
  const sequence=[
    {battleId:'loss-1',lossStreakBefore:0,outcome:{won:false},expected:15,streak:1},
    {battleId:'loss-2',lossStreakBefore:1,outcome:{won:false},expected:15,streak:2},
    {battleId:'loss-3',lossStreakBefore:2,outcome:{won:false},expected:30,streak:3},
    {battleId:'win-1',lossStreakBefore:3,outcome:{won:true},expected:15,streak:0},
  ];
  const results=[];
  for(const row of sequence){
    const result=onPrototypeEconomyResult(current,seasonOne(),active,{...row,metrics:{}});results.push(result);current=result.state;
    assert.equal(result.events.find((event)=>event.type==='chem_shimmer_gained').amount,row.expected,row.battleId);
    assert.equal(result.state.prototypeMeta.economy.chemBaron.lossStreak,row.streak,row.battleId);
  }
  assert.equal(current.prototypeMeta.economy.chemBaron.shimmer,130);
  const result=results[2];
  const repeated=onPrototypeEconomyResult(result.state,seasonOne(),active,{...sequence[2],metrics:{}});
  assert.equal(repeated.state.prototypeMeta.economy.chemBaron.shimmer,115);
  assert.equal(repeated.events[0].type,'prototype_economy_duplicate_ignored');
  const marketCatalog={prototypeEconomy:{chemBaron:{marketOptions:sourceOptions([['buy-contraband','购买违禁装备',0,[{kind:'item',id:'tft13-crime-bronze'}]],['skip','略过市场',0,[]]]).map((row)=>row.id==='skip'?{...row,action:'skip',description:'略过后险境成员获得额外生命值'}:row)}}};
  const market=onPrototypeEconomyPrep(result.state,seasonOne(marketCatalog),active);
  assert.equal(market.choiceDrafts[0].economyKind,'chem_market');
  assert.ok(market.choiceDrafts[0].options.some((row)=>row.action==='skip'));
});

test('Conqueror chest progression consumes genuine installed takedown metrics, not damage or a win',()=>{
  const active=[tier('conqueror',2,{StacksPerKill:1},['char-a','char-b'])];
  const catalog=seasonOne({prototypeEconomy:{conqueror:{chestOptionsByThreshold:{10:sourceOptions([['gold-2','2枚金币',0,[{kind:'gold',amount:2}] ]])}}}});
  let current=state({conqueror:{conquest:9,openedChests:[],pendingChests:[]}});
  current=onPrototypeEconomyResult(current,catalog,active,{battleId:'c-1',outcome:{won:false},metrics:{prototypeTraits:{conqueror:{kills:0,conquestStacks:1}}}}).state;
  assert.deepEqual(current.prototypeMeta.economy.conqueror.pendingChests,[10]);
  const prep=onPrototypeEconomyPrep(current,catalog,active);
  assert.equal(prep.choiceDrafts[0].economyKind,'war_chest');
  assert.deepEqual(prep.choiceDrafts[0].options[0].grant,[{kind:'gold',amount:2}]);
  const noKill=onPrototypeEconomyResult(state({conqueror:{conquest:9,openedChests:[],pendingChests:[]}}),catalog,active,{battleId:'c-2',outcome:{won:true},metrics:{prototypeTraits:{conqueror:{kills:4,conquestStacks:0}}}});
  assert.equal(noKill.state.prototypeMeta.economy.conqueror.conquest,9,'non-Conqueror kills do not grant Conquest');
});

test('Family heist advances only for surviving Family members and Junker armory opens on three real results',()=>{
  const family=[tier('family',5,{},['powder','violet','vander'])];
  const result=onPrototypeEconomyResult(state(),{},family,{battleId:'f-1',outcome:{won:false},survivors:[{charId:'powder',alive:true},{charId:'violet',alive:false},{charId:'enemy',alive:true}]});
  assert.equal(result.state.prototypeMeta.economy.family.heistProgress,1);
  assert.equal(result.state.prototypeMeta.economy.family.survivorProgress,1);
  assert.equal(result.state.prototypeMeta.economy.family.pendingHeists.length,0);
  const subthreshold=onPrototypeEconomyResult(state(),{},[tier('family',3,{},['powder'])],{battleId:'f-2',survivors:[{charId:'powder',alive:true}]});
  assert.equal(subthreshold.state.prototypeMeta.economy.family.heistProgress,0,'only the source 5-member heist tier advances progress');
  const uidMapped=onPrototypeEconomyResult({...state(),pieces:[{uid:'p1',nativeUid:39,operatorId:'powder-op'}]}, {operators:{'powder-op':{charId:'powder'}}},family,{battleId:'f-uid',survivors:[{uid:39,alive:true}]});
  assert.equal(uidMapped.state.prototypeMeta.economy.family.heistProgress,1,'native result UIDs resolve through the persistent piece map');
  const rumble=prototypeSeason.traits.find((row)=>row.sourceName==='Junker King').members[0];
  const king=[tier('armory',1,{NumRounds1Star:3},[rumble])];
  let current=state();
  for(let i=1;i<=3;i++)current=onPrototypeEconomyResult(current,{},king,{battleId:`j-${i}`,outcome:{won:i===3}}).state;
  assert.equal(current.prototypeMeta.economy.junkerKing.pendingArmories,1);
  current.pieces=[{uid:'r1',operatorId:'rumble',star:1,equipment:[]}];
  const catalog={operators:{rumble:{charId:rumble,cost:2,stars:{1:{stats:{atk:100,maxHp:1000}}}}},prototypeEconomy:{junkerKing:{upgradeOptions:sourceOptions([['spare-parts','备用零件',0,[{kind:'rumble_upgrade',id:'TFT13_JunkerKing_Pass',level:1}]],['microbots','修复微型机器人',5,[{kind:'rumble_upgrade',id:'TFT13_JunkerKing_RepairingMicrobots',level:1}]]])}}};
  const prep=onPrototypeEconomyPrep(current,catalog,king);
  assert.equal(prep.choiceDrafts[0].economyKind,'junker_armory');
  assert.deepEqual(prep.choiceDrafts[0].options.map((x)=>x.cost),[0,5]);assert.equal(prep.choiceDrafts[0].options[0].grant[0].targetUid,'r1');
});

test('catalog injector exposes only source-backed Chem gear and an explicitly adapted paid armory',()=>{
  const mappedIds=[...new Set(academySponsorSets.flatMap((set)=>set.map(([,id])=>id)))];
  const input={equipment:{component:{id:'component',kind:'component'},blade:{id:'blade',kind:'passive',unique:false,grantAllowed:true},finished:{id:'finished',kind:'completed',unique:false,grantAllowed:true},...Object.fromEntries(mappedIds.map((id)=>[id,{id,kind:'completed',unique:false,grantAllowed:true}]))}};
  const catalog=applyPrototypeEconomy({...input,prototypeSeason});
  assert.equal(input.prototypeEconomy,undefined,'injector does not mutate the canonical input catalog');
  assert.equal(catalog.prototypeEconomy.chemBaron.marketOptions.length,3);
  assert.deepEqual(Object.keys(catalog.prototypeEconomy.chemBaron.marketOptionsByThreshold).map(Number),[100,200,300,400,500,600,700,800]);
  assert.ok(Object.values(catalog.prototypeEconomy.chemBaron.marketOptionsByThreshold).flat().every((row)=>row.grant.length>0&&row.grant.every((grant)=>grant.kind==='gold'||grant.kind==='consumable')),
    'every community-table alternative is translated to a real mode consumer');
  assert.ok(catalog.prototypeEconomy.chemBaron.marketOptionsByThreshold[800][0].grant.some((grant)=>grant.id==='prototype_chem_omega_anvil'));
  assert.deepEqual(catalog.prototypeEconomy.gearPools.chemBaron.sort(),catalog.prototypeEconomy.chemBaron.marketOptions.map((row)=>row.id).sort());
  assert.ok(catalog.prototypeEconomy.chemBaron.marketOptions.every((row)=>row.grant[0].kind==='item'&&catalog.equipment[row.grant[0].id].prototypeEconomyEffect));
  assert.deepEqual(catalog.prototypeEconomy.junkerKing.upgradeOptions.filter((row)=>row.grant?.[0]?.kind==='rumble_upgrade').map((row)=>row.id),junkerKingUpgrades.map((row)=>row.id));
  assert.equal(catalog.prototypeEconomy.junkerKing.upgradeOptions[0].cost.amount,0);
  assert.equal(catalog.prototypeEconomy.junkerKing.upgradeOptions[1].priceAdaptation.includes('未提供'),true);
  assert.ok(catalog.prototypeEconomy.academy.eligibleItemIds.length>0);
  assert.ok(!catalog.prototypeEconomy.academy.eligibleItemIds.includes('finished'),'unsourced items do not enter the Academy sponsor pool');
  for(const [tier,count] of [['Bronze',3],['Silver',8],['Gold',8],['Prismatic',8],['OmegaPrismatic',1]]){
    const pool=catalog.prototypeEconomy.gearPools[`chemBaron${tier}`];assert.equal(pool.length,count,`${tier} pool has every source item`);
    assert.ok(pool.every(id=>catalog.equipment[id]?.prototypeSourceEffects&&catalog.equipment[id]?.prototypeEconomyEffect),`${tier} equipment has source data and a battle consumer`);
  }
});

test('all 28 Chem-Baron tier descriptions expand source values into readable Chinese effects',()=>{
  const catalog=applyPrototypeEconomy({prototypeSeason,equipment:{}});
  const rows=Object.values(catalog.equipment).filter(row=>row.prototypeEconomyEffect);
  assert.equal(rows.length,28);
  for(const row of rows){
    assert.ok(row.description.length>12,`${row.id} has a usable effect description`);
    assert.doesNotMatch(row.description,/@[A-Za-z{}]|<[^>]+>|source unknown|未实现/i,`${row.id} has no unresolved source template or process copy`);
  }
  assert.match(rows.find(row=>row.source.apiName==='TFT13_Crime_Prismatic_ShimmerBloom').description,/每6秒.*600点护盾.*30点法术强度.*30%攻击速度/);
  assert.match(rows.find(row=>row.source.apiName==='TFT13_Crime_Prismatic_VirulentVirus').description,/25%.*1600.*8秒/);
  assert.match(rows.find(row=>row.source.apiName==='TFT13_Crime_Gold_FleshRipper').description,/持续5秒/);
  assert.match(rows.find(row=>row.source.apiName==='TFT13_Crime_OmegaPrismatic_DimensionalHeirloom').prototypeModeAdaptation,/35%生命与攻击、持续6秒/);
});

test('Family reward rows stay separate choices and map training dummies/components to working consumers',()=>{
  const catalog=applyPrototypeEconomy({equipment:{part:{id:'part',name:'测试组件',kind:'component',grantAllowed:true}}});
  const tierRow=tier('family',5,{},['powder']);
  const result=onPrototypeEconomyResult(state({family:{heistProgress:16,pendingHeists:[],completedHeists:[]}}),catalog,[tierRow],{battleId:'family-hit',survivors:[{charId:'powder',alive:true}]});
  assert.deepEqual(result.state.prototypeMeta.economy.family.pendingHeists,[10,17]);
  const prep=onPrototypeEconomyPrep(result.state,catalog,[tierRow]);
  const family17=prep.choiceDrafts.find((row)=>row.economyKind==='family_heist'&&row.metadata.threshold===17);
  assert.deepEqual(family17.options.map((row)=>row.id),['family17-copies','family17-components']);
  assert.deepEqual(family17.options[0].grant.map((row)=>row.id),['smallCopy','smallCopy','smallCopy']);
  assert.equal(family17.options[1].grant.filter((row)=>row.kind==='component'&&row.pool==='components').length,2);
  assert.equal(catalog.prototypeEconomy.family.heistOptionsByThreshold[10][0].grant[0].kind,'special_entity');
  assert.equal(catalog.prototypeEconomy.family.heistOptionsByThreshold[10][0].grant[0].id,'TFT_TrainingDummy');
  assert.deepEqual(catalog.prototypeEconomy.family.heistOptionsByThreshold[20].map((row)=>row.grant[0].kind),['gold','consumable']);
  assert.deepEqual(catalog.prototypeEconomy.family.heistOptionsByThreshold[30].map((row)=>row.id),['family30-gold','family30-components']);
  assert.equal(catalog.prototypeEconomy.conqueror.chestOptionsByThreshold[850][0].grant[0].amount,20,'850 is source-listed gold, with no invented crown');
  assert.deepEqual(catalog.prototypeEconomy.conqueror.chestOptionsByThreshold[1000][0].grant.map((row)=>row.id??row.amount),['prototype_item_remover',20]);
  assert.deepEqual(catalog.prototypeEconomy.conqueror.chestOptionsByThreshold[1500][0].grant.map((row)=>row.id??row.amount),['prototype_radiant_conversion',80]);
});

test('paid Junker purchases persist as live combat stats and periodic effects',()=>{
  const rumble=prototypeSeason.traits.find((row)=>row.sourceName==='Junker King').members[0];
  const listeners={};const applied=[];const units=[{id:'rumble-1',uid:'r1',kind:'op',alive:true,deployed:true,removed:false,charId:rumble,s:{atk:100,maxHp:1000,def:10,res:10},mem:{}}];
  const enemy={id:'e',alive:true,deployed:true,s:{def:100,res:100}};let heals=0,damage=[];
  const battle={time:0,allyUnits:units,enemies:[enemy],on(name,fn){(listeners[name]??=[]).push(fn);},addBuff(unit,buff){applied.push({unit,buff});},heal(_src,_dst,amount){heals+=amount;return amount;},dealDamage(_src,target,dmg){damage.push({target,dmg});},foesInRadius(){return [enemy];}};
  const purchase=[{id:'TFT13_JunkerKing_SuperPass'},{id:'TFT13_JunkerKing_RepairingMicrobots'},{id:'TFT13_JunkerKing_Tankbuster'},{id:'TFT13_JunkerKing_SelfDestructButton'}];
  installPrototypeEconomy(battle,{pieces:[{uid:'r1',charId:rumble,star:1}],prototypeMeta:{activeTraits:[tier('armory',1,{},[rumble])],economy:{junkerKing:{upgrades:purchase.map((row)=>({...row,targetUid:'r1'}))}}}},{operators:{rumble:{charId:rumble,stars:{1:{stats:{atk:100,maxHp:1000}}}}}});
  for(const fn of listeners.battleStart)fn();
  const mods=applied.find(row=>row.buff.mods?.hpFlat===300)?.buff.mods;assert.equal(mods.hpFlat,300);assert.equal(mods.artsDealtMul,1.25);
  const power=prototypeSeason.heroes.find(row=>row.charId===rumble).powerReference;
  assert.equal(prototypeRatingTotal(units[0],'armor'),Number(power.armor)*.25,'Junker armor percent is applied to source armor rating through the shared ledger');
  assert.equal(prototypeRatingTotal(units[0],'magicResist'),Number(power.magicResist)*.25,'Junker MR percent uses the same source-rating conversion');
  for(const fn of listeners.tick)fn();assert.equal(heals,60);assert.equal(damage.length,1);assert.equal(damage[0].target,enemy);assert.equal(damage[0].dmg.type,'true');
  battle.time=3;for(const fn of listeners.tick)fn();assert.equal(heals,120);assert.equal(damage.length,2);
  const ratingTotal=Number(power.armor)+prototypeRatingTotal(units[0],'armor')+Number(power.magicResist)+prototypeRatingTotal(units[0],'magicResist');
  const beforeDeath=damage.length;listeners.death[0]({unit:units[0]});
  assert.equal(damage.length,beforeDeath+1);
  assert.equal(damage.at(-1).dmg.amount,ratingTotal*2,'self-destruct uses source armor+MR ratings and the shared ledger rather than native DEF/MR percentages');
});

test('equipped Chem-Baron items consume actual hit, timer, and damage-reduction hooks',()=>{
  const catalog=applyPrototypeEconomy({operators:{},equipment:{}});const owned=[
    {uid:'u1',charId:'chem-char',items:[{itemId:'prototype_chem_salvaged_contraption'},{itemId:'prototype_chem_salvaged_gauntlet'}]},
    {uid:'u2',charId:'chem-char',items:[{itemId:'prototype_chem_salvaged_revolver'}]},
  ];
  const units=owned.map((row)=>({uid:row.uid,id:row.uid,charId:row.charId,kind:'op',alive:true,deployed:true,removed:false,side:'ally',s:{atk:100,maxHp:500,def:0,res:0},mem:{}}));
  units.push({uid:39,id:'native-39',kind:'op',alive:true,deployed:true,removed:false,side:'ally',s:{atk:100,maxHp:500,def:0,res:0},mem:{}});
  const pieces=[{uid:'p3',nativeUid:39,charId:'chem-char',equipment:[{uid:'item-uid'}]}];
  const target={side:'enemy',alive:true,deployed:true};const listeners={};const buffs=[],dealt=[];
  const battle={time:0,allyUnits:units,enemies:[target],on(name,fn){(listeners[name]??=[]).push(fn);},addBuff(unit,row){buffs.push({unit,row});},dealDamage(source,dst,row){dealt.push({source,dst,row});},heal(){}};
  installPrototypeEconomy(battle,{input:{units:owned},pieces,inventory:[{uid:'item-uid',itemId:'prototype_chem_salvaged_contraption'}],prototypeMeta:{activeTraits:[tier('risk',3,{},['chem-char'])],economy:{chemBaron:{healthFromSkips:20}}}},catalog);
  for(const fn of listeners.battleStart)fn();
  assert.ok(buffs.some(({unit,row})=>unit.uid==='u1'&&row.mods.dmgTakenMul===0.9));
  assert.ok(buffs.some(({unit,row})=>unit.uid==='u1'&&row.mods.atkPct===0.25));
  for(const fn of listeners.hit)fn({attacker:units[0],target,dmg:{isSkill:true}});assert.equal(dealt.length,0,'the source bonus is limited to basic attacks');
  for(const fn of listeners.hit)fn({attacker:units[0],target,dmg:{isAttack:true}});assert.equal(dealt[0].row.type,'true');assert.equal(dealt[0].row.amount,15);
  battle.time=5;for(const fn of listeners.tick)fn();
  assert.ok(buffs.some(({unit,row})=>unit.uid==='u2'&&row.mods.artsDealtMul===1.3));
  assert.ok(buffs.some(({unit,row})=>unit.uid===39&&row.mods.dmgTakenMul===0.9),'native numeric piece UID resolves equipped item UID to the same session item');
});

function chemBattle(apiName,{twoAllies=false,keepBattleAlive=false,sourceGearId=null,spCost=40,activeRisk=true}={}){
  const charId=prototypeSeason.traits.find(row=>row.id==='risk').members[0],catalog=applyPrototypeEconomy(applyPrototypeSourceGear({prototypeMeta:{rulesVersion:3},prototypeSeason,equipment:{}})),source=prototypeSeason.chemBaronItems.find(row=>row.apiName===apiName);
  assert.ok(source,`fixture source record ${apiName}`);
  const item=Object.values(catalog.equipment).find(row=>row.source?.apiName===apiName);assert.ok(item);
  const equipment=[{uid:'chem-item',itemId:item.id},...(sourceGearId?[{uid:'source-gear-item',itemId:sourceGearId}]:[])];
  const units=[{uid:'holder',chessId:'holder',row:10,col:5,items:equipment},...(twoAllies?[{uid:'ally',chessId:'ally',row:10,col:6}]:[])];
  const defs={chess:{holder:chessRec({id:'holder',charId,stats:{maxHp:1000,atk:100,def:0,res:0}}),...(twoAllies?{ally:chessRec({id:'ally',charId:'other',stats:{maxHp:1000,atk:100,def:0,res:0}})}:{})},enemies:{dummy:enemyRec({key:'dummy',hp:100000,def:0,res:0})}};
  const h=makeBattle({units,defs,content:'none'}),ownerInput={uid:'holder',charId,items:equipment};
  const pieces=[{uid:'holder',charId,row:10,col:5,equipment}];
  h.unit('holder').skill.baseSpCost=spCost;h.unit('holder').skill.noSkill=false;h.unit('holder').skill.kind='instant';h.unit('holder').skill.maxCharges=1;
  const spGainRows=[],gainSp=h.unit('holder').skill.gainSp.bind(h.unit('holder').skill);
  h.unit('holder').skill.gainSp=(amount,reason,...rest)=>{spGainRows.push({amount,reason});return gainSp(amount,reason,...rest);};
  const battleState={rulesVersion:3,input:{units:[ownerInput]},pieces,prototypeMeta:{activeTraits:activeRisk?[tier('risk',3,{},[charId])]:[],economy:{}}};
  installPrototypeSourceGear(h.battle,battleState,catalog,[]);
  installPrototypeEconomy(h.battle,battleState,catalog);
  if(keepBattleAlive)h.spawn('dummy');
  h.step();return {h,catalog,item,holder:h.unit('holder'),ally:twoAllies?h.unit('ally'):null,charId,spGainRows};
}

test('Silver Chem tank and bloom grant shields through live Battle buffs',()=>{
  const tank=chemBattle('TFT13_Crime_Silver_DestabilizedChemtank'),enemy=tank.h.spawn('dummy');
  assert.ok(tank.holder.s.maxHp>1000,'source Health stat is applied to its Chem-Baron holder');
  tank.h.battle.dealDamage(enemy,tank.holder,{amount:tank.holder.s.maxHp*.55,type:'true',canDodge:false});tank.h.step();
  assert.ok(tank.holder.buffs.some(row=>row.key.includes('chem:tank:')&&row.shield>0),'crossing half health grants the source-scaled shield');
  const bloom=chemBattle('TFT13_Crime_Silver_ShimmerBloom',{twoAllies:true});
  assert.ok(bloom.holder.buffs.some(row=>row.key.includes('chem:bloom:')&&row.shield>0));
  assert.ok(bloom.ally.buffs.some(row=>row.key.includes('chem:bloom:')&&row.shield>0),'periodic bloom shields a real second deployed ally');
  const perfected=chemBattle('TFT13_Crime_Prismatic_ShimmerBloom',{twoAllies:true,keepBattleAlive:true});
  assert.ok(perfected.ally.buffs.some(row=>row.mods?.artsDealtMul===1.3&&Math.abs(row.mods?.aspd-30)<1e-5),
    'perfected team shielding applies the source-record 30 AP and 30% attack-speed values');
});

test('Perfected Chemtank bursts on its threshold shield and each later shield cadence',()=>{
  const fixture=chemBattle('TFT13_Crime_Prismatic_DestabilizedChemtank',{keepBattleAlive:true});
  const enemy=fixture.h.spawn('dummy',{pos:[10,6]});
  const sourceMax=enemy.s.maxHp;
  fixture.h.battle.dealDamage(enemy,fixture.holder,{amount:fixture.holder.s.maxHp*.55,type:'true',canDodge:false});
  fixture.h.step();
  const afterFirst=enemy.hp;
  assert.ok(sourceMax-afterFirst>=sourceMax*.1,'threshold shield release fires the 10% max-health vial');
  fixture.h.run(4.2);
  assert.ok(enemy.hp<afterFirst,'the 4-second follow-up shield fires another perfected vial');
});

test('Silver Voltaic, toxin, and virus equipment cause real battle damage',()=>{
  const voltaic=chemBattle('TFT13_Crime_Silver_VoltaicSaber'),vTarget=voltaic.h.spawn('dummy'),vBefore=vTarget.hp;
  for(let i=0;i<6;i++)voltaic.h.battle.dealDamage(voltaic.holder,vTarget,{amount:1,type:'phys',isAttack:true,canDodge:false});
  assert.ok(vBefore-vTarget.hp>=150,'the source-counted volley deals its configured physical damage');
  const virus=chemBattle('TFT13_Crime_Silver_VirulentVirus'),iTarget=virus.h.spawn('dummy');
  virus.h.battle.dealDamage(virus.holder,iTarget,{amount:1000,type:'arts',isSkill:true,canDodge:false});const beforeTick=iTarget.hp;virus.h.step();
  assert.ok(iTarget.hp<beforeTick,'skill damage creates a ticking true-damage infection');
  const toxin=chemBattle('TFT13_Crime_Prismatic_UnleashedToxins'),tTarget=toxin.h.spawn('dummy');
  toxin.h.battle.dealDamage(toxin.holder,tTarget,{amount:100,type:'arts',isSkill:true,canDodge:false});const beforeCast=tTarget.hp;
  toxin.h.battle.emit('skillEnd',{unit:toxin.holder,skill:toxin.holder.skill,reason:'completed'});
  assert.ok(tTarget.hp<beforeCast-250,'skill-end launches source-counted missiles with an added perfected wave');
});

test('Perfected Virulent Virus weakens the infected enemy outgoing hit until its source duration ends',()=>{
  const fixture=chemBattle('TFT13_Crime_Prismatic_VirulentVirus',{keepBattleAlive:true}),enemy=fixture.h.spawn('dummy');
  fixture.h.battle.dealDamage(fixture.holder,enemy,{amount:100,type:'arts',isSkill:true,canDodge:false});
  const before=fixture.holder.hp;
  fixture.h.battle.dealDamage(enemy,fixture.holder,{amount:100,type:'phys',isAttack:true,canDodge:false});
  assert.equal(before-fixture.holder.hp,75,'the 25% perfected weaken applies to damage dealt by the infected enemy');
  fixture.h.run(3.1);
  const afterExpiry=fixture.holder.hp;
  fixture.h.battle.dealDamage(enemy,fixture.holder,{amount:100,type:'phys',isAttack:true,canDodge:false});
  assert.equal(afterExpiry-fixture.holder.hp,100,'the enemy returns to its base damage after the source duration');
});

test('Perfected Virulent Virus recruits the infected kill as a decaying visible ally',()=>{
  const fixture=chemBattle('TFT13_Crime_Prismatic_VirulentVirus',{keepBattleAlive:true});
  const enemy=fixture.h.battle.enemies[0];
  fixture.h.battle.dealDamage(fixture.holder,enemy,{amount:100,type:'arts',isSkill:true,canDodge:false});
  fixture.h.battle.dealDamage(fixture.holder,enemy,{amount:enemy.hp+1,type:'phys',isAttack:true,canDodge:false});
  const zombie=fixture.h.battle.allyUnits.find(row=>row.kind==='token'&&row.def.name==='病毒感染者');
  assert.ok(zombie?.alive&&zombie.deployed,'the infected enemy death creates an allied combat unit');
  assert.equal(zombie.s.maxHp,1600);
  assert.equal(zombie.def.spine,'token_10022_kazema_shadow');
  assert.equal(zombie.skill?.noSkill,true,'the temporary allied conversion does not inherit its Spine token skill');
  fixture.h.run(8.1);
  assert.equal(zombie.alive,false,'the source decay window removes the temporary ally');
});

test('Gold Flesh Ripper restores its holder when the source threshold is crossed',()=>{
  const fixture=chemBattle('TFT13_Crime_Gold_FleshRipper'),enemy=fixture.h.spawn('dummy'),before=fixture.holder.hp;
  fixture.h.battle.dealDamage(enemy,fixture.holder,{amount:fixture.holder.s.maxHp*.7,type:'true',canDodge:false});
  assert.ok(fixture.holder.hp>before-fixture.holder.s.maxHp*.7,'the actual threshold event heals the equipped holder');
  assert.ok(fixture.holder.buffs.some(row=>row.flags?.untargetable),'crossing the threshold briefly makes the holder untargetable');
});

test('Flesh Ripper uses native fractional atkPct and returns the source attack bonus to base on expiry',()=>{
  const fixture=chemBattle('TFT13_Crime_Gold_FleshRipper',{keepBattleAlive:true}),enemy=fixture.h.spawn('dummy');
  const baseAtk=fixture.holder.s.atk,sourcePct=fixture.item.prototypeSourceEffects.EnhancedAD;
  fixture.h.battle.dealDamage(enemy,fixture.holder,{amount:fixture.holder.s.maxHp*.7,type:'true',canDodge:false});
  const surge=fixture.holder.buffs.find(row=>row.key.includes('chem:damage:')&&row.key.endsWith(':surge'));
  assert.ok(surge,'crossing the real health threshold adds the timed surge');
  assert.equal(surge.mods.atkPct,sourcePct,'the source attack fraction uses NativeBattle fractional units');
  assert.equal(Object.hasOwn(surge.mods,'dmgDealtMul'),false,'source Attack Damage does not multiply all damage a second time');
  const attackBeforePercent=baseAtk/(1+Number(fixture.item.prototypeEconomyStats?.atkPct??0));
  assert.ok(Math.abs(fixture.holder.s.atk-(baseAtk+attackBeforePercent*sourcePct))<1e-5,
    `effective attack rises by the source fraction of native base attack, not 100× that value (base=${baseAtk}, now=${fixture.holder.s.atk}, pct=${sourcePct}, flat=${fixture.item.prototypeEconomyStats?.atk})`);
  fixture.h.run(5.1);
  assert.ok(Math.abs(fixture.holder.s.atk-baseAtk)<1e-5,'temporary source attack bonus expires back to baseline');
  assert.equal(fixture.holder.mem['chem:damage:'+fixture.item.id+':surgeUntil']>fixture.h.battle.time,false,'the source omnivamp window expires with the attack surge');
});

test('Flesh Ripper surge grants the source omnivamp only during its live window',()=>{
  const fixture=chemBattle('TFT13_Crime_Gold_FleshRipper',{keepBattleAlive:true}),enemy=fixture.h.spawn('dummy');
  fixture.h.battle.dealDamage(enemy,fixture.holder,{amount:fixture.holder.s.maxHp*.7,type:'true',canDodge:false});
  fixture.holder.hp-=100;
  const before=fixture.holder.hp;
  fixture.h.battle.dealDamage(fixture.holder,enemy,{amount:200,type:'phys',isAttack:true,canDodge:false});
  assert.ok(fixture.holder.hp>before,'a real attack during the surge heals through EnhancedOmnivamp');
  const during=fixture.holder.hp;
  fixture.h.run(5.1);
  fixture.holder.hp-=100;
  const expiredBefore=fixture.holder.hp;
  fixture.h.battle.dealDamage(fixture.holder,enemy,{amount:200,type:'phys',isAttack:true,canDodge:false});
  assert.equal(fixture.holder.hp,expiredBefore,'the same attack no longer heals after the source window expires');
  assert.ok(during>before);
});

test('Perfected Executioner coins survive Native result validation and settle exactly once', { timeout: 60_000 }, async()=>{
  const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:601});
  const sourceItem=Object.values(catalog.equipment).find(row=>row.source?.apiName==='TFT13_Crime_Prismatic_ExecutionersVorpalblade');
  assert.ok(sourceItem,'the real source equipment is in the V3 catalog');
  const created=createSession({seed:601,difficulty:'NORMAL',catalog});assert.equal(created.ok,true,created.error);
  let state=created.state;state.nodeStarted=true;
  const piece=state.pieces[0],operator=catalog.operators[piece.operatorId];
  piece.equipment.push({uid:'native-executioner-item',itemId:sourceItem.id});
  const fieldView=getResonanceField(state,{data,catalog});
  const legal=[...fieldView.deployMap.entries()].find(([,entry])=>{
    const kind=String(entry?.class??entry?.type??entry?.position??entry?.kind??entry).toUpperCase();
    return operator.position==='RANGED'||kind==='MELEE'||kind==='RANGED'&&operator.canDeployHighGround===true;
  });
  assert.ok(legal,'the isolated session has a legal native deployment tile');
  const [row,col]=legal[0].split(',').map(Number);
  const deployed=applyAction(state,{type:'deploy',pieceUid:piece.uid,row,col,dir:'RIGHT'},{catalog,fieldResolver:()=>fieldView,recording:false});
  assert.equal(deployed.ok,true,deployed.error);state=deployed.state;

  const scheduler=new VirtualScheduler({instantCombat:false}),messages=[];
  const store={async exclusive(_id,task){return task();},async saveSession(){},deactivate(){}};
  const match=new ResonanceMatch({sessionId:'test-native-executioner-result',state,catalog,data,store,scheduler,
    send:(_id,msg)=>messages.push(msg),broadcast:msg=>messages.push(msg),timerScale:0,combatSpeed:2,
    log:{info(){},warn(){},error(){},debug(){}}});
  try{
    match.start();
    assert.equal((await match.handle('resonance',{t:'g.infoReady',setupRevision:0})).ok,true);
    match.enterBandDraft();
    assert.equal(scheduler.runUntil(()=>match.phase==='PREP',{maxTime:30_000}),true,`Native prep not reached: ${match.phase}`);
    assert.equal(match.handle('resonance',{t:'g.ready',ready:true}).ok,true);
    assert.equal(scheduler.runUntil(()=>match.phase==='COMBAT',{maxTime:10_000}),true,`Native combat not reached: ${match.phase}`);
    const field=match.fields.find(row=>row.players.includes('resonance'));
    assert.ok(field?.cc&&field.mode==='client','the result is submitted to the actual Native client-authoritative field');
    const battle=createBattleFromSpec(field.spec,data,{recordEvents:false,quiet:true});battle.start();
    const nativeHolderUid=match.uidMap.native(piece.uid);
    const holder=battle.allyUnits.find(unit=>unit.kind==='op'&&unit.uid===nativeHolderUid);
    assert.ok(holder,'the equipped session piece is the holder in the actual Native Battle');
    for(let i=0;i<1_500&&!battle.enemies.some(enemy=>enemy.alive&&enemy.deployed)&&!battle.finished;i++)battle.step();
    const victim=battle.enemies.find(enemy=>enemy.alive&&enemy.deployed);
    assert.ok(victim,'the authentic prepared Native stage has a live enemy');
    const coinsBeforeSourceKill=structuredClone(battle.resonanceResults.coins??[]);
    battle.dealDamage(holder,victim,{amount:victim.hp+1,type:'true',canDodge:false,tags:['test-native-source-kill']});
    const coinsAfterSourceKill=battle.resonanceResults.coins??[];
    assert.deepEqual(coinsAfterSourceKill.slice(coinsBeforeSourceKill.length),[{amount:3,source:'chemBaron',reason:'perfected_execution'}],
      'a real source-backed kill event, not a fabricated queue, appends its three-gold Native Battle reward');

    for(let tick=0;tick<30_000&&!battle.finished;tick++)battle.step();
    assert.equal(battle.finished,true,'the Native-spec battle reaches its own terminal result');
    assert.equal(battle.errorCount,0,JSON.stringify(battle.errors?.slice(0,3)??[]));
    const raw=compactResult(battle.result()),extras=resonanceResultExtras(battle);
    raw.resonance=extras;
    const expectedBattleGold=extras.coins.reduce((total,row)=>total+row.amount,0);
    assert.ok(expectedBattleGold>=3,'the completed Native Battle preserves at least the explicitly triggered source reward');
    const nativeResult=fitResult(raw,{battleId:field.battleId});
    const validation=validateClientResult(field.spec,nativeResult,{gd:match.gd});
    assert.equal(validation.ok,true,`the actual Native BattleResult must validate before we test extras transport: ${validation.reason}`);
    const beforeGold=match.state.gold;
    const stale=match.handle('resonance',{t:'b.result',battleId:`${field.battleId}-stale`,result:nativeResult});
    assert.ok(stale?.error||stale?.ok===true||stale===undefined,'stale result is ignored or rejected without becoming an accepted field result');
    await match._sessionWrite;
    assert.equal(match.state.gold,beforeGold,'a stale result cannot consume queued source coins');
    const accepted=match.handle('resonance',{t:'b.result',battleId:field.battleId,result:nativeResult});
    assert.equal(accepted?.error,undefined,`Native rejected the actual terminal result: ${JSON.stringify(accepted)}`);
    // The normal Native match lifecycle invokes this after the accepted result; invoke the
    // same hook here because this isolated fixture does not have the network progress loop.
    match._afterCombat();
    match._afterCombat();
    await new Promise((resolve)=>setImmediate(resolve));
    await match._sessionWrite;
    assert.equal(field.resultSource,'client',`the actual Native result was not accepted: done=${field.done} source=${field.resultSource} mode=${field.mode} phase=${match.phase}`);
    assert.equal(field.done,true,`Native did not finish the submitted field: phase=${match.phase}`);
    assert.ok(match.state.history.some(row=>row.type==='fight-settled'),`Native result did not settle the session: phase=${match.phase}; field.done=${field.done}; resultSource=${field.resultSource}`);
    const settled=match.state.history.at(-1);
    assert.equal(settled.battleGold,expectedBattleGold,'accepted native result credits every actual battle coin exactly once');
    assert.equal(match.state.gold,beforeGold+expectedBattleGold+settled.income+settled.winBonus+settled.streakBonus+settled.interest+settled.delayedBonus+settled.strategyGold,
      'persistent gold includes the source coins plus the settlement ledger exactly once');
    const afterGold=match.state.gold;
    const duplicate=match.handle('resonance',{t:'b.result',battleId:field.battleId,result:nativeResult});
    assert.ok(duplicate?.error||duplicate?.ok===true||duplicate===undefined,'duplicate result is ignored or rejected after field completion');
    await match._sessionWrite;
    assert.equal(match.state.gold,afterGold,'a duplicate Native result grants no second reward');
    assert.equal(match.phase,'SETTLE','the accepted Native battle enters its normal settlement phase');
  }finally{match.dispose();scheduler.dispose();}
});

test('Silver Chainblade executes low-health enemies and Hexarmor stacks through the shared nonlinear rating ledger',()=>{
  const chain=chemBattle('TFT13_Crime_Silver_ExecutionersVorpalblade'),target=chain.h.spawn('dummy');
  chain.h.battle.dealDamage(chain.holder,target,{amount:target.s.maxHp*.92,type:'true',canDodge:false});
  chain.h.battle.dealDamage(chain.holder,target,{amount:1,type:'phys',isAttack:true,canDodge:false});
  assert.equal(target.alive,false,'a source-threshold hit executes the low-health enemy');
  const armor=chemBattle('TFT13_Crime_Silver_PiltovenHexplating'),attacker=armor.h.spawn('dummy'),hexTarget=armor.h.spawn('dummy',{pos:[10,6]});
  const baselineArmor=prototypeRatingTotal(armor.holder,'armor'),baselineMr=prototypeRatingTotal(armor.holder,'magicResist');
  const baseDef=armor.holder.s.def,baseRes=armor.holder.s.res;
  for(let i=0;i<14;i++)armor.h.battle.dealDamage(attacker,armor.holder,{amount:1,type:'true',canDodge:false});
  assert.equal(prototypeRatingTotal(armor.holder,'armor'),baselineArmor+42);
  assert.equal(prototypeRatingTotal(armor.holder,'magicResist'),baselineMr+42);
  const beforeCounter=hexTarget.hp;
  armor.h.battle.dealDamage(attacker,armor.holder,{amount:1,type:'true',canDodge:false});
  const hero=prototypeSeason.heroes.find(row=>row.charId===armor.charId),sourceArmor=Number(hero.powerReference.armor??0),sourceMr=Number(hero.powerReference.magicResist??0);
  const expected=(sourceArmor+prototypeRatingTotal(armor.holder,'armor')+sourceMr+prototypeRatingTotal(armor.holder,'magicResist'))*.5;
  assert.ok(Math.abs((beforeCounter-hexTarget.hp)-expected)<1e-5,'the full source ratings and other ledger entries determine the real counter hit');
  assert.ok(armor.holder.s.def>baseDef&&armor.holder.s.def<baseDef+45,'armor is nonlinearly converted, not copied as flat Native defense');
  assert.ok(armor.holder.s.res>baseRes&&armor.holder.s.res<baseRes+45,'MR is nonlinearly converted, not copied as flat Native resistance');
  const key=`prototype-chem-hexarmor:${armor.item.id}`;
  setPrototypeRatingBonus(armor.h.battle,armor.holder,key,{armor:0,magicResist:0},hero.powerReference);
  assert.equal(prototypeRatingTotal(armor.holder,'armor'),baselineArmor,'removing the keyed Hexarmor rating leaves other sources intact');
  assert.equal(prototypeRatingTotal(armor.holder,'magicResist'),baselineMr);
  const noTier=chemBattle('TFT13_Crime_Silver_PiltovenHexplating',{activeRisk:false});
  const noTierAttacker=noTier.h.spawn('dummy');
  const noTierBaseline=prototypeRatingTotal(noTier.holder,'armor');
  noTier.h.battle.dealDamage(noTierAttacker,noTier.holder,{amount:1,type:'true',canDodge:false});
  assert.equal(prototypeRatingTotal(noTier.holder,'armor'),noTierBaseline+3,'a held source item does not silently stop working when the natural trait count changes');
});

test('Chem initial and attack Mana scale with fixed skill cost; criticals use one authorized shared roll',()=>{
  const chem=chemBattle('TFT13_Crime_Silver_FleshRipper',{spCost:40});
  const target=chem.h.spawn('dummy');let rolls=0;chem.h.battle.rng=()=>{rolls++;return .4;};
  const attack={source:chem.holder,target,dmg:{isAttack:true,mul:1}};chem.h.battle.emit('hit',attack);
  assert.equal(rolls,1,'the attack baseline and Chem bonus share one critical roll');
  assert.equal(attack.dmg.mul,1.4,'the single .4 roll uses base 25% and Chem 20% (source items no longer add critical chance)');
  const skill={source:chem.holder,target,dmg:{isSkill:true,mul:1}};chem.h.battle.emit('hit',skill);
  assert.equal(rolls,1,'item critical chance does not authorize a skill critical');
  const toxin40=chemBattle('TFT13_Crime_Silver_UnleashedToxins',{spCost:40});
  assert.equal(toxin40.spGainRows.find(row=>row.reason==='prototypeChemItem')?.amount,4,'source initial 10 Mana is 10% of the fixed 40 SP skill cost');
  const toxin=chemBattle('TFT13_Crime_Silver_UnleashedToxins',{spCost:80});
  assert.equal(toxin.spGainRows.find(row=>row.reason==='prototypeChemItem')?.amount,8,'initial Mana percent scales with 80 SP cost');
  let toxinSp=0;toxin.holder.skill.gainSp=(amount)=>{toxinSp+=amount;};
  toxin.h.battle.emit('hit',{source:toxin.holder,target:toxin.h.spawn('dummy'),dmg:{isAttack:true,mul:1}});
  assert.equal(toxinSp,4,'5% ExtraManaOnAttack maps to 4 SP at a fixed 80 SP skill cost');
});

test('Omega Heirloom produces a live temporary allied echo',()=>{
  const fixture=chemBattle('TFT13_Crime_OmegaPrismatic_DimensionalHeirloom',{keepBattleAlive:true});
  const echoes=fixture.h.battle.allyUnits.filter(unit=>unit.kind==='token'&&unit.def?.name==='维度幻影'&&unit.alive&&unit.deployed);
  assert.equal(echoes.length,1,'the source cadence produces a real allied combat unit');
  assert.ok(echoes[0].s.atk>0&&echoes[0].s.maxHp>0);
  assert.equal(echoes[0].def.spine,'token_10022_kazema_shadow','the temporary combat unit uses an installed native Spine visual');
  assert.equal(echoes[0].skill?.noSkill,true,'the appearance does not inherit the visual operator token skill');
});
