import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeEffectFor } from '../../server/modes/independent/native.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runNativeHook } from '../../server/modes/independent/native.js';
import { grantEquipment } from '../../server/modes/independent/equipment.js';
import { decorateDarkmoonShopSlots, applyDarkmoonShopGrowth, darkmoonGrowthBadges } from '../../server/modes/independent/darkmoonShop.js';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';
import { runIndependentBattle } from '../../server/modes/independent/battle.js';
import { operatorGrowthInfo, grantGrowthLevels } from '../../shared/independentGrowth.js';
import { buyTargetSpec, buyTargetChoices, buyTargetCount, buyRequiresTarget } from '../../public/js/independent/targetSelection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const blueprints = JSON.parse(fs.readFileSync(path.join(root, 'data/independent-darkmoon-blueprints.json'), 'utf8'));
const designAddon = JSON.parse(fs.readFileSync(path.join(root, 'data/independent-darkmoon-design-addon.json'), 'utf8'));
const gameTextAddon = JSON.parse(fs.readFileSync(path.join(root, 'data/independent-darkmoon-game-text-addon.json'), 'utf8'));
const byId = new Map(blueprints.entries.map(x => [x.sourceId, x]));

test('blueprint is an exact 101-name roster slice with original 19.2 texts and both variants', () => {
  assert.equal(blueprints.sourceBuild, '19.2.0.68600');
  assert.equal(blueprints.entries.length, 101);
  assert.equal(new Set(blueprints.entries.map(x => x.sourceId)).size, 101);
  assert.equal(new Set(blueprints.entries.map(x => x.operator)).size, 101);
  assert.ok(blueprints.entries.flatMap(x=>[...x.metadata.op.effectDelivery.normal,...x.metadata.op.effectDelivery.elite]).every(e=>e.recipient!=='unresolved'));
  const counts = Object.groupBy(blueprints.entries, x => x.rosterTribe);
  assert.deepEqual(Object.fromEntries(Object.entries(counts).map(([k,v]) => [k,v.length])), {
    MECHANICAL:16, PIRATE:14, ELEMENTAL:12, DRAGON:13, BEAST:14, NEUTRAL:32
  });
  for (const entry of blueprints.entries) {
    assert.ok(entry.sourceTexts.normal.length > 0, `${entry.sourceId} normal text`);
    assert.ok(entry.sourceTexts.elite.length > 0, `${entry.sourceId} golden text`);
    for (const variant of ['normal','elite']) {
      const effects = entry.metadata.op.effectDelivery[variant];
      assert.ok(effects.length > 0, `${entry.sourceId} ${variant} source effects`);
      for (const key of ['trigger','recipient','duration','text']) assert.ok(effects[0][key], `${entry.sourceId} ${variant} ${key}`);
    }
  }
});

test('delivery descriptors preserve fixed target distinctions and expose unimplemented mechanics', () => {
  assert.equal(byId.get('BGS_105').metadata.op.effectDelivery.normal[0].recipient, 'leftmostFriendly');
  assert.equal(byId.get('BGS_009').metadata.op.effectDelivery.normal[0].recipient, 'oneRandomFriendlyPerFaction');
  assert.equal(byId.get('BGS_104').metadata.op.effectDelivery.normal[0].recipient, 'matchingTribeShopOffers');
  assert.equal(byId.get('BGS_037').metadata.op.effectDelivery.normal[0].recipient, 'currentShopOffers');
  assert.equal(byId.get('BGS_046').metadata.op.effectDelivery.normal[0].recipient, 'hand');
  assert.equal(blueprints.entries.filter(x => x.metadata.op.effectDelivery.normal.some(e=>e.kind==='keywordGear' && e.implementation==='supported')).length, 20);
  assert.equal(byId.get('BGS_043').authoredRule.normal.adapter, 'darkmoonLastWarbandRecruit');
  assert.equal(byId.get('DAL_575').authoredRule.mechanic, 'darkmoonCombat');
  assert.equal(byId.get('LOE_077').authoredRule.normal.trigger, 'battlecryMultiplier');
  assert.equal(byId.get('BGS_113').authoredRule.normal.recipient, 'selectedShopMinion');
  assert.equal(byId.get('FP1_031').authoredRule.normal.sourceId, 'FP1_031');
  assert.equal(byId.get('BGS_121').metadata.op.effectDelivery.normal.find(e=>e.sourceTrigger==='darkmoonCombat').recipient,'combatSummonAndHand');
  assert.equal(byId.get('BGS_200').metadata.op.effectDelivery.normal[0].recipient,'inventory');
  assert.equal(byId.get('BGS_039').authoredRule.normal.outputs[0].id,'independent:坚守盟约');
  assert.equal(byId.get('BGS_034').authoredRule.elite.outputs.length,2);
  const keywordIds=blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.some(e=>e.kind==='keywordGear')).map(x=>x.sourceId).sort();
  assert.deepEqual(keywordIds,['BGS_034','BGS_038','BGS_039','BGS_060','BGS_071','BGS_106','BGS_119','BGS_121','BGS_124','BGS_127','BGS_131','BGS_201','BGS_205','BOT_911','FP1_010','FP1_024','GVG_113','ICC_858','LOOT_078','ULD_217'].sort(), 'static keywords grant self gear only for the explicit source-ID whitelist');
  for (const id of ['BGS_040','BGS_067','BGS_110','BGS_111','BGS_112','BOT_218','DS1_070','EX1_093','ICC_807','OG_221']) {
    assert.ok(!byId.get(id).metadata.op.effectDelivery.normal.some(e=>e.kind==='keywordGear'), `${id} must not infer self gear from a word in its text`);
  }
  assert.equal(byId.get('DS1_070').authoredRule.normal.recipient,'selectedFriendlyBeast');
  assert.equal(byId.get('EX1_093').authoredRule.normal.recipient,'adjacentFriendlyOperators');
  assert.equal(byId.get('ICC_807').authoredRule.normal.recipient,'allFriendlyWithTaunt');
});

test('compiler add-ons link only existing native definitions and preserve all source text without replacing canonical files', () => {
  assert.equal(designAddon.operators.length, 67);
  assert.equal(designAddon.pendingNativeDefinitions.length, 34);
  const levelsText=gameTextAddon.operators[byId.get('BGS_111').operator];
  assert.match(levelsText.normalLevels,/攻击训练等级×1/);
  assert.match(levelsText.eliteLevels,/攻击训练等级×2/);
  assert.notEqual(levelsText.normal,byId.get('BGS_111').sourceTexts.normal);
  assert.equal(levelsText.sourceRefs.cards[0].text,byId.get('BGS_111').sourceTexts.normal);
  assert.ok(!levelsText.normal.includes(byId.get('BGS_111').sourceTexts.normal),'player-facing text must describe the executed adaptation, not repeat the source card text');
  assert.notEqual(levelsText.normalLevels,levelsText.normal);
  assert.ok(designAddon.operators.every(x => x.chessId && x.modeEffects === null));
  assert.ok(designAddon.operators.every(x => x.metadata.op.effectDelivery.normal.length && x.metadata.op.effectDelivery.elite.length));
  assert.equal(Object.keys(gameTextAddon.operators).length, 101);
  assert.equal(blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.some(e=>e.kind==='keywordGear' && e.implementation==='supported')).length,20);
  assert.deepEqual(blueprints.entries.filter(x=>[...x.metadata.op.effectDelivery.normal,...x.metadata.op.effectDelivery.elite].some(e=>e.implementation==='unsupported')).map(x=>x.sourceId),[]);
  assert.equal(blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.every(e=>e.implementation==='supported')&&x.metadata.op.effectDelivery.elite.every(e=>e.implementation==='supported')).length,101);
  assert.equal(gameTextAddon.operators['风丸'].sourceId, 'DAL_575');
  assert.equal(gameTextAddon.operators['远牙'].sourceId, 'BGS_043');
  const addonBySource=new Map(designAddon.operators.map(x=>[x.sourceId,x.sourceRefs.darkmoon19_2.battlecry]));
  assert.equal(addonBySource.get('BGS_038'),true,'a keyword line before the Battlecry still identifies the card trigger');
  assert.equal(addonBySource.get('BGS_041'),false,'mentioning another minions Battlecry is not this cards own Battlecry');
  assert.equal(addonBySource.get('LOE_077'),false,'a Battlecry multiplier is not itself a Battlecry minion');
});

test('explicit keyword adapters dispatch source-id keyed gain grants only to self', () => {
  const source = { name:'砾', sourceRefs:{darkmoon19_2:{id:'BGS_039'}}, modeEffects:{ normal:{prep:[],combat:[]}, elite:{prep:[],combat:[]} } };
  const effect = nativeEffectFor('test-id', source, false);
  const rule = effect.prep.find(x=>x.params?.outputs?.some(o=>o.id==='independent:坚守盟约'));
  assert.ok(rule);
  assert.equal(rule.trigger,'gain');
  assert.equal(rule.params.landOn,'self');
  assert.equal(rule.params.outputs[0].normal,1);
  assert.equal(rule.params.outputs[0].elite,1);
});

test('a compiled source-ref dispatches the Taunt adapter once on recruit gain with wearer target', () => {
  const baseCatalog = getCatalog();
  for (const elite of [false,true]) {
    const op = Object.values(baseCatalog.operators).find(x=>x.name==='砾'&&Boolean(x.elite)===elite);
    assert.ok(op);
    const source={...op,sourceRefs:{darkmoon19_2:{id:'BGS_039'}}};
    const effect=nativeEffectFor(op.chessId,source,elite);
    const catalog={...baseCatalog,operators:{...baseCatalog.operators,[op.chessId]:{...op,nativeTrait:{...op.nativeTrait,effect}}}};
    const state={round:1,shop:{level:1,freeRefreshes:0,slots:[]},pieces:[],counters:{gained:0,spent:0,paidRefreshes:0},pendingFunds:0,nextUid:1,inventory:[]};
    const granted=[];
    const piece={uid:`dragonspawn-${elite?'elite':'normal'}`,chessId:op.chessId,nativeState:{}};
    const services={catalog,data:{},rng:()=>0,grantEquipment(_s,id,quantity,extra){granted.push({id,quantity,...extra});},grantChess(){},addOffer(){},record(){}};
    state.pieces.push(piece);
    runNativeHook(state,'gain',{piece,origin:'player'},services);
    const grant=granted.find(x=>x.id==='independent:坚守盟约');
    assert.ok(grant);
    assert.equal(grant.landOn,'self');
    assert.equal(grant.quantity,1,'non-scaled golden source keeps one gear');
    const n=granted.length;
    runNativeHook(state,'roundStart',{piece,origin:'player'},services);
    assert.equal(granted.length,n,'gear is awarded on acquisition, not redeploy or a later prep phase');
  }
});

test('all source-specific static keyword adapters really wear their gear on normal and elite recipients',()=>{
  const baseCatalog=getCatalog();
  const sourceIds=blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.some(e=>e.kind==='keywordGear'&&e.implementation==='supported')).map(x=>x.sourceId);
  for(const id of sourceIds) for(const elite of [false,true]) {
    const op=Object.values(baseCatalog.operators).find(x=>Boolean(x.elite)===elite);
    const source={...op,sourceRefs:{darkmoon19_2:{id}},modeEffects:{normal:{prep:[],combat:[]},elite:{prep:[],combat:[]}}};
    const effect=nativeEffectFor(op.chessId,source,elite);
    const faction={BGS_038:'卡西米尔',CFM_816:'叙拉古',DS1_070:'叙拉古'}[id];
    const targetOp=faction?Object.values(baseCatalog.operators).find(x=>Boolean(x.elite)===elite&&x.chessId!==op.chessId):null;
    const operators={...baseCatalog.operators,[op.chessId]:{...op,nativeTrait:{...op.nativeTrait,effect}}};
    if(targetOp)operators[targetOp.chessId]={...targetOp,nativeFactionTags:[faction]};
    const catalog={...baseCatalog,operators};
    const state={round:1,shop:{level:1,freeRefreshes:0,slots:[]},pieces:[],counters:{gained:0,spent:0,paidRefreshes:0},pendingFunds:0,nextUid:1,inventory:[]};
    const piece={uid:`${id}-${elite?'elite':'normal'}`,chessId:op.chessId,ownerId:'player',nativeState:{},equipment:[]};state.pieces.push(piece);
    const target=targetOp?{uid:`target-${id}-${elite}`,chessId:targetOp.chessId,nativeFactionTags:[faction],ownerId:'player',row:0,col:1,equipment:[]}:null;
    if(target)state.pieces.push(target);
    const services={catalog,data:{},rng:()=>0,grantEquipment:(s,item,n,extra)=>grantEquipment(s,catalog,item,n,extra),grantChess(){},addOffer(){},record(){}};
    runNativeHook(state,'gain',{piece,origin:'player',targetUid:target?.uid},services);
    const expected=byId.get(id).metadata.op.effectDelivery.normal.filter(x=>x.kind==='keywordGear'&&x.implementation==='supported').map(x=>x.adapter[0]).sort();
    assert.deepEqual(piece.equipment.map(x=>x.id).sort(),expected,`${id} ${elite?'elite':'ordinary'} wears the granted gear`);
    assert.equal(state.inventory.length,0,`${id} never routes fixed self gear through hand inventory`);
  }
});

test('four source-keyed prep adapters cause the expected ordinary and elite state changes', () => {
  const baseCatalog=getCatalog();
  const ids=['BGS_027','BGS_049','BGS_055','BGS_116'];
  for(const id of ids) for(const elite of [false,true]) {
    const entry=byId.get(id);
    const op=Object.values(baseCatalog.operators).find(x=>Boolean(x.elite)===elite);
    assert.ok(op,`${id} ${elite?'elite':'ordinary'} fixture`);
    const source={...op,sourceRefs:{darkmoon19_2:{id}},modeEffects:{normal:{prep:[],combat:[]},elite:{prep:[],combat:[]}}};
    const effect=nativeEffectFor(op.chessId,source,elite);
    const catalog={...baseCatalog,operators:{...baseCatalog.operators,[op.chessId]:{...op,nativeTrait:{...op.nativeTrait,effect}}}};
    const state={round:1,funds:id==='BGS_049'?1:0,shop:{level:1,upgradePrice:5,freeRefreshes:0,slots:[]},pieces:[],counters:{gained:0,spent:0,paidRefreshes:0},pendingFunds:0,nextUid:1,inventory:[]};
    const piece={uid:`${id}-${elite?'elite':'normal'}`,chessId:op.chessId,nativeState:{},equipment:[],row:0,col:0};
    state.pieces.push(piece);
    const services={catalog,data:{},rng:()=>0,grantEquipment:(s,item,n,extra)=>grantEquipment(s,catalog,item,n,extra),grantChess(){},addOffer(){},record(){}};
    const hook=id==='BGS_027'?'roundStart':id==='BGS_049'?'sold':'gain';
    runNativeHook(state,hook,{piece,origin:'player'},services);
    const expected=elite?2:1;
    if(id==='BGS_027') assert.equal(piece.equipment.find(x=>x.id==='precision')?.quantity,expected,`${id} grants permanent precision to self`);
    if(id==='BGS_049') {assert.equal(state.funds,elite?6:3,`${id} immediately reaches source sell value including the base sale`);assert.equal(state.pendingFunds,0,`${id} is not deferred to a later prep phase`);}
    if(id==='BGS_055') assert.equal(state.shop.upgradePrice,5-expected,`${id} discounts the next upgrade cost`);
    if(id==='BGS_116') assert.equal(state.shop.freeRefreshes,expected,`${id} grants exactly the next refresh count`);
  }
});

test('Captain Hoggarr pays only for an original Pirate purchase and only for this turn',()=>{
  const baseCatalog=getCatalog();
  const normalOps=Object.values(baseCatalog.operators).filter(x=>!x.elite);
  const eliteOps=Object.values(baseCatalog.operators).filter(x=>x.elite);
  for(const elite of [false,true]) {
    const holderOp=(elite?eliteOps:normalOps)[0], buyerOp=(elite?eliteOps:normalOps)[1], otherOp=(elite?eliteOps:normalOps)[2];
    const holder={...holderOp,sourceRefs:{darkmoon19_2:{id:'BGS_072',rosterTribe:'PIRATE',faction:'维多利亚'}},modeEffects:{normal:{prep:[],combat:[]},elite:{prep:[],combat:[]}}};
    const effect=nativeEffectFor(holderOp.chessId,holder,elite);
    const pirate={...buyerOp,nativeFactionTags:['维多利亚'],sourceRefs:{darkmoon19_2:{id:'BGS_001',rosterTribe:'PIRATE',faction:'维多利亚'}}};
    const other={...otherOp,nativeFactionTags:['叙拉古'],sourceRefs:{darkmoon19_2:{id:'BGS_002',rosterTribe:'BEAST',faction:'维多利亚'}}};
    const catalog={...baseCatalog,operators:{...baseCatalog.operators,[holderOp.chessId]:{...holderOp,nativeTrait:{...holderOp.nativeTrait,effect}},[buyerOp.chessId]:pirate,[otherOp.chessId]:other}};
    const state={round:1,funds:4,shop:{level:1,upgradePrice:5,freeRefreshes:0,slots:[]},pieces:[],counters:{gained:0,spent:0,paidRefreshes:0},pendingFunds:0,nextUid:1,inventory:[]};
    const host={uid:'hoggarr',chessId:holderOp.chessId,ownerId:'p1',nativeState:{},row:0,col:0}, buyer={uid:'pirate',chessId:buyerOp.chessId,ownerId:'p1',nativeState:{}}, otherBuyer={uid:'other',chessId:otherOp.chessId,ownerId:'p1',nativeState:{}};
    state.pieces.push(host);
    const services={catalog,data:{},rng:()=>0,grantEquipment(){},grantChess(){},addOffer(){},record(){}};
    runNativeHook(state,'bought',{piece:buyer},services);
    assert.equal(state.funds,4+(elite?2:1),'same-owner source Pirate purchase grants 1/2 spendable gold immediately');
    runNativeHook(state,'bought',{piece:otherBuyer},services);
    assert.equal(state.funds,4+(elite?2:1),'non-Pirate purchase does not grant gold');
    runNativeHook(state,'bought',{piece:{...buyer,uid:'rival',ownerId:'p2'}},services);
    assert.equal(state.funds,4+(elite?2:1),'another owner purchase does not grant this player gold');
  }
});

test('compiled source refs replace old mixed traits and Brann multiplies only original Battlecries',()=>{
  const catalog0=getCatalog();
  for(const brannElite of [false,true]) {
    const ordinary=Object.values(catalog0.operators).find(x=>!x.elite), brannOp=Object.values(catalog0.operators).find(x=>!x.elite&&x.chessId!==ordinary.chessId);
    const original={...ordinary,sourceRefs:{darkmoon19_2:{id:'BGS_055',battlecry:true}},modeEffects:{normal:{prep:[{trigger:'gain',behavior:'freeRefresh',params:{normal:5,elite:5}}],combat:[{trigger:'passive',behavior:'staticStats',params:{x:1}}]},elite:{prep:[],combat:[]}}};
    const brann={...brannOp,sourceRefs:{darkmoon19_2:{id:'LOE_077'}},modeEffects:{normal:{prep:[],combat:[]},elite:{prep:[],combat:[]}}};
    const originalEffect=nativeEffectFor(ordinary.chessId,original,false), brannEffect=nativeEffectFor(brannOp.chessId,brann,brannElite);
    assert.equal(originalEffect.combat.length,0,'Darkmoon refs must not inherit unrelated existing combat traits');
    assert.equal(originalEffect.prep.some(x=>x.behavior==='freeRefresh'),false,'Darkmoon refs replace unrelated prep traits');
    assert.equal(brannEffect.prep[0].behavior,'triggerMultiplier');
    const catalog={...catalog0,operators:{...catalog0.operators,[ordinary.chessId]:{...ordinary,sourceRefs:original.sourceRefs,nativeTrait:{...ordinary.nativeTrait,effect:originalEffect}},[brannOp.chessId]:{...brannOp,sourceRefs:brann.sourceRefs,nativeTrait:{...brannOp.nativeTrait,effect:brannEffect}}}};
    const state={round:1,funds:5,shop:{level:1,upgradePrice:5,freeRefreshes:0,slots:[]},pieces:[],counters:{gained:0,spent:0,paidRefreshes:0},pendingFunds:0,nextUid:1,inventory:[]};
    const host={uid:'host',chessId:ordinary.chessId,ownerId:'p1',nativeState:{},row:0,col:0}, amplifier={uid:'brann',chessId:brannOp.chessId,ownerId:'p1',elite:brannElite,nativeState:{},row:0,col:1};
    state.pieces.push(host,amplifier);
    runNativeHook(state,'gain',{piece:host,origin:'player'},{catalog,data:{},rng:()=>0,grantEquipment(){},grantChess(){},addOffer(){},record(){}});
    assert.equal(state.shop.upgradePrice,5-(brannElite?3:2),'normal/elite Brann repeats the Battlecry exactly 2/3 total times');
  }
});

test('shop growth remains a fixed shop recipient and purchase grants growth directly to that operator',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite);
  const nomiOp=normal[0], elementalOp=normal[1], mechOp=normal[2];
  const nomi={...nomiOp,sourceRefs:{darkmoon19_2:{id:'BGS_104'}},modeEffects:{normal:{prep:[],combat:[]},elite:{prep:[],combat:[]}}};
  const elemental={...elementalOp,nativeFactionTags:['炎'],sourceRefs:{darkmoon19_2:{id:'BGS_001',rosterTribe:'ELEMENTAL',faction:'炎'}}};
  const mech={...mechOp,nativeFactionTags:['哥伦比亚'],sourceRefs:{darkmoon19_2:{id:'BGS_002',rosterTribe:'MECHANICAL',faction:'哥伦比亚'}}};
  const nomiEffect=nativeEffectFor(nomiOp.chessId,nomi,false);
  const catalog={...base,operators:{...base.operators,[nomiOp.chessId]:{...nomiOp,sourceRefs:nomi.sourceRefs,nativeTrait:{...nomiOp.nativeTrait,effect:nomiEffect}},[elementalOp.chessId]:elemental,[mechOp.chessId]:mech}};
  const shop=[{kind:'chess',id:elementalOp.chessId,sold:false,equipment:[]},{kind:'chess',id:mechOp.chessId,sold:false,equipment:[]}];
  const state={round:1,shop:{level:1,slots:shop,freeRefreshes:0},pieces:[{uid:'nomi',chessId:nomiOp.chessId,ownerId:'p1',nativeState:{},row:0,col:0}],playerEffects:[],counters:{gained:0,spent:0,paidRefreshes:0},pendingFunds:0,nextUid:1,inventory:[]};
  runNativeHook(state,'bought',{piece:{uid:'elemental',chessId:elementalOp.chessId,ownerId:'p1'}},{catalog,data:{},rng:()=>0,grantEquipment(){},grantChess(){},addOffer(){},record(){}});
  assert.deepEqual(shop[0].darkmoonGrowth,{attack:1,health:1});
  assert.equal(shop[1].darkmoonGrowth,undefined,'native faction mapping keeps non-Elemental shop offers untouched');
  assert.equal(state.playerEffects.find(x=>x.type==='darkmoonShopGrowth')?.faction,'炎');
  const future=decorateDarkmoonShopSlots(state,catalog,[{kind:'chess',id:elementalOp.chessId},{kind:'chess',id:mechOp.chessId}]);
  assert.deepEqual(future[0].darkmoonGrowth,{attack:1,health:1});
  assert.equal(future[1].darkmoonGrowth,undefined);
  const target={uid:'purchased',chessId:elementalOp.chessId,ownerId:'p1',equipment:[]};state.pieces.push(target);
  const services={catalog,grantEquipment:(s,id,n,extra)=>grantEquipment(s,catalog,id,n,extra)};
  const [attackBadge,healthBadge]=darkmoonGrowthBadges(target,catalog);
  assert.equal(applyDarkmoonShopGrowth(state,future[0],target,services).length,2);
  assert.deepEqual(target.equipment.map(x=>[x.id,x.quantity]),[[attackBadge,1],[healthBadge,1]]);
  assert.equal(state.inventory.length,0,'shop stats are fixed recipient growth, not carried inventory');
});

test('original Battlecry buffs inspect the acquired source tag and wear permanent growth only on the fixed tribe targets',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite&&x.recruitable!==false);
  for(const [id,tribe,elite,count,badges] of [['BGS_041','DRAGON',false,1,['precision','vitality']],['BGS_053','PIRATE',true,6,['precision']],['BGS_128','ELEMENTAL',false,1,['precision','vitality']]]) {
    const holderOp=normal.find(x=>x.profession==='TANK'&&x.name!==byId.get(id).operator), otherOp=normal.find(x=>x.chessId!==holderOp.chessId&&x.name!==byId.get(id).operator), gainOp=normal.find(x=>x.chessId!==holderOp.chessId&&x.chessId!==otherOp.chessId);
    const holderRef={id,rosterTribe:tribe}, otherRef={id:'TEST_TARGET',rosterTribe:tribe}, gainedRef={id:'TEST_BATTLECRY',battlecry:true,rosterTribe:'NEUTRAL'};
    const faction={BGS_041:'卡西米尔',BGS_053:'维多利亚',BGS_128:'炎'}[id];
    const holder={...holderOp,nativeFactionTags:[faction],sourceRefs:{darkmoon19_2:holderRef}};
    const effect=nativeEffectFor(holderOp.chessId,holder,elite);
    const catalog={...base,operators:{...base.operators,[holderOp.chessId]:{...holderOp,nativeFactionTags:[faction],sourceRefs:holder.sourceRefs,nativeTrait:{...holderOp.nativeTrait,effect}},[otherOp.chessId]:{...otherOp,nativeFactionTags:[faction],sourceRefs:{darkmoon19_2:otherRef}},[gainOp.chessId]:{...gainOp,sourceRefs:{darkmoon19_2:gainedRef}}}};
    const state={round:1,shop:{level:1,freeRefreshes:0,slots:[]},pieces:[],counters:{gained:0,spent:0,paidRefreshes:0},pendingFunds:0,nextUid:1,inventory:[]};
    const host={uid:'host',chessId:holderOp.chessId,ownerId:'p1',nativeState:{},row:0,col:0,equipment:[]},other={uid:'other',chessId:otherOp.chessId,ownerId:'p1',nativeState:{},row:0,col:1,equipment:[]},gained={uid:'gained',chessId:gainOp.chessId,ownerId:'p1',nativeState:{},equipment:[]};state.pieces.push(host,other);
    const services={catalog,data:{},rng:()=>0,grantEquipment:(s,badge,n,extra)=>grantEquipment(s,catalog,badge,n,extra),grantChess(){},addOffer(){},record(){}};
    const recipientBadges=id==='BGS_053'?['precision']:darkmoonGrowthBadges(other,catalog);
    runNativeHook(state,'gain',{piece:gained,source:'buy',paid:true},services);
    assert.deepEqual(host.equipment.map(x=>x.id).sort(),(id==='BGS_041'?badges:[]).sort(),`${id} applies only to eligible self if the original says all Dragons`);
    assert.deepEqual(other.equipment.map(x=>x.id).sort(),recipientBadges.slice().sort(),`${id} grants its fixed friendly tribe recipient using that recipient's profession`);
    assert.ok(other.equipment.every(x=>x.quantity===count),`${id} normal/elite authored output amount is direct gear growth`);
    assert.equal(state.inventory.length,0,`${id} fixed target growth never spills into free inventory`);
  }
});

test('additional source keyed prep families deliver profession mapped growth on the named trigger and target',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite);
  for(const [id,hook,targetFaction,amountMode] of [['BGS_036','prepEnd','卡西米尔','selfPerFaction'],['BGS_038','gain','卡西米尔','selected'],['BGS_075','gain',null,'deathrattleTag'],['BGS_105','prepEnd',null,'leftmost'],['BGS_127','bought',null,'healthOnly']]) for(const elite of [false,true]) {
    const holderOp=Object.values(base.operators).find(x=>Boolean(x.elite)===elite),targetOp=normal.find(x=>x.chessId!==holderOp.chessId);
    const holderRef={id,battlecry:id==='BGS_038'};
    const holderFaction=id==='BGS_036'?'卡西米尔':null;
    const source={...holderOp,nativeFactionTags:holderFaction?[holderFaction]:holderOp.nativeFactionTags,sourceRefs:{darkmoon19_2:holderRef}},effect=nativeEffectFor(holderOp.chessId,source,elite);
    const targetTags=targetFaction?[targetFaction]:id==='BGS_105'?['拉特兰']:[];
    const buyerOp=normal.find(x=>x.chessId!==holderOp.chessId&&x.chessId!==targetOp.chessId);
    const operators={...base.operators,[holderOp.chessId]:{...holderOp,nativeFactionTags:source.nativeFactionTags,sourceRefs:source.sourceRefs,nativeTrait:{...holderOp.nativeTrait,effect}},[targetOp.chessId]:{...targetOp,nativeFactionTags:targetTags}};
    if(id==='BGS_127')operators[buyerOp.chessId]={...buyerOp,nativeFactionTags:['炎']};
    const catalog={...base,operators},holder={uid:`holder-${id}-${elite}`,chessId:holderOp.chessId,ownerId:'p1',elite,nativeState:{},row:0,col:4,equipment:[]};
    const target={uid:`target-${id}-${elite}`,chessId:targetOp.chessId,ownerId:'p1',row:0,col:id==='BGS_105'?1:2,nativeState:{},equipment:[]};
    const state={round:1,shop:{level:1,freeRefreshes:0,slots:[]},pieces:[holder,target],counters:{factionBought:{炎:2}},pendingFunds:0,nextUid:1,inventory:[]};
    const services={catalog,data:{},rng:()=>0,grantEquipment:(s,badge,n,extra)=>grantEquipment(s,catalog,badge,n,extra),grantChess(){},addOffer(){},record(){}};
    let event={piece:holder,source:'buy',targetUid:target.uid};
    if(id==='BGS_036') {
      operators[targetOp.chessId]={...targetOp,nativeFactionTags:['卡西米尔']};
      runNativeHook(state,hook,{round:1},services);
      const n=elite?4:2,ids=darkmoonGrowthBadges(holder,catalog);
      assert.deepEqual(holder.equipment.map(x=>[x.id,x.quantity]),ids.map(x=>[x,n]),`${id} counts friendly Dragon analogs and applies the elite multiplier`);
    } else if(id==='BGS_038') {
      assert.equal(runNativeHook(state,hook,event,services),state);
      const n=elite?4:2,ids=darkmoonGrowthBadges(target,catalog);
      assert.deepEqual(target.equipment.map(x=>[x.id,x.quantity]),ids.map(x=>[x,n]),`${id} honors selected eligible fixed recipient`);
    } else if(id==='BGS_075') {
      const deathrattleOp=normal.find(x=>x.chessId!==holderOp.chessId&&x.chessId!==targetOp.chessId),played={uid:'played',chessId:deathrattleOp.chessId,ownerId:'p1'};
      operators[deathrattleOp.chessId]={...deathrattleOp,sourceRefs:{darkmoon19_2:{id:'TEST_DEATHRATTLE',deathrattle:true}}};
      runNativeHook(state,'gain',{piece:played,source:'buy'},services);
      const n=elite?2:1,ids=darkmoonGrowthBadges(holder,catalog);
      assert.deepEqual(holder.equipment.map(x=>[x.id,x.quantity]),ids.map(x=>[x,n]),`${id} reacts to the acquired card's actual source tag once`);
    } else if(id==='BGS_105') {
      runNativeHook(state,hook,{round:1},services);
      const n=elite?4:2,ids=darkmoonGrowthBadges(target,catalog);
      assert.deepEqual(target.equipment.map(x=>[x.id,x.quantity]),ids.map(x=>[x,n]),`${id} uses the leftmost deployed friend and matching purchases`);
    } else {
      const buyer={uid:'buyer',chessId:buyerOp.chessId,ownerId:'p1'};
      runNativeHook(state,hook,{piece:buyer,source:'buy'},services);
      const [,healthId]=darkmoonGrowthBadges(holder,catalog),n=elite?2:1;
      assert.deepEqual(holder.equipment.map(x=>[x.id,x.quantity]),[[healthId,n]],`${id} turns its health gain into the holder profession's secondary growth only`);
    }
  }
});

test('19.2 trigger mappings keep turn-win, played-Elemental, and random-target growth on their real recipients',()=>{
  const base=getCatalog(),ops=Object.values(base.operators).filter(x=>!x.elite),first=ops[0],second=ops[1],third=ops[2],fourth=ops[3],elementalA=ops[4],elementalB=ops[5];
  const make=(id,op,elite=false)=>({ ...op, sourceRefs:{darkmoon19_2:{id, ...(id==='BGS_120'||id==='BGS_124'?{rosterTribe:'ELEMENTAL',faction:'炎'}:{})}}, nativeTrait:{...op.nativeTrait,effect:nativeEffectFor(op.chessId,{...op,sourceRefs:{darkmoon19_2:{id}}},elite)} });
  const held120=make('BGS_120',first),held124=make('BGS_124',second),roundHolder=make('BGS_033',third),endHolder=make('ULD_217',fourth);
  const operators={...base.operators,[first.chessId]:held120,[second.chessId]:{...held124,nativeFactionTags:['炎']},[third.chessId]:roundHolder,[fourth.chessId]:endHolder,
    [elementalA.chessId]:{...elementalA,nativeFactionTags:['炎'],sourceRefs:{darkmoon19_2:{id:'TEST_ELEMENTAL_A',rosterTribe:'ELEMENTAL'}}},[elementalB.chessId]:{...elementalB,nativeFactionTags:['炎'],sourceRefs:{darkmoon19_2:{id:'TEST_ELEMENTAL_B',rosterTribe:'ELEMENTAL'}}}};
  const catalog={...base,operators},holders=[0,1,2,3].map((i)=>({uid:`h${i}`,chessId:[first,second,third,fourth][i].chessId,ownerId:'p',elite:false,row:0,col:i,nativeState:{},equipment:[]}));
  const friend={uid:'f',chessId:elementalA.chessId,ownerId:'p',row:0,col:4,nativeState:{},equipment:[]},played={uid:'play',chessId:elementalB.chessId,ownerId:'p',row:0,col:5,nativeState:{},equipment:[]};
  const state={round:2,lastCombatWon:true,shop:{slots:[],freeRefreshes:0},pieces:[...holders,friend,played],inventory:[],nextUid:1};
  const services={catalog,data:{},rng:()=>0,grantEquipment:(s,id,n,e)=>grantEquipment(s,catalog,id,n,e),grantChess(){},addOffer(){},record(){}};
  runNativeHook(state,'roundStart',{round:2},services);
  assert.deepEqual(holders[2].equipment.map(x=>[x.id,x.quantity]),darkmoonGrowthBadges(holders[2],catalog).map(id=>[id,2]),'a prior cleared combat grants normal +2/+2 only at the next prep start');
  runNativeHook(state,'gain',{piece:played,source:'buy'},services);
  const recipient=holders[1],ids=darkmoonGrowthBadges(recipient,catalog);
  assert.deepEqual(recipient.equipment.map(x=>[x.id,x.quantity]),[[ids[0],1],[ids[1],5]],'BGS120 randomly buffs another eligible Elemental; BGS124 separately adds one secondary unit per owned Elemental');
  const [,healthId]=darkmoonGrowthBadges(holders[1],catalog);
  const before=state.pieces.reduce((n,x)=>n+x.equipment.length,0);
  runNativeHook(state,'prepEnd',{round:2},services);
  assert.ok(state.pieces.reduce((n,x)=>n+x.equipment.length,0)>before,'ULD217 ends prep by giving attack growth to another friendly operator');
});

test('Pack Leader and Mama Bear permanently grow only each newly gained Siracusa operator (normal and elite)',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite),sourceOp=normal[0],targetOp=normal[1],wrongOp=normal[2];
  for(const [id,attack,secondary] of [['BGS_017',2,0],['BGS_021',4,4]])for(const elite of [false,true]) {
    const source={...sourceOp,sourceRefs:{darkmoon19_2:{id}},nativeTrait:{...sourceOp.nativeTrait,effect:nativeEffectFor(sourceOp.chessId,{...sourceOp,sourceRefs:{darkmoon19_2:{id}}},elite)}};
    const target={...targetOp,nativeFactionTags:['叙拉古'],nativeTrait:{effect:{prep:[],combat:[]}}},wrong={...wrongOp,nativeFactionTags:['维多利亚'],nativeTrait:{effect:{prep:[],combat:[]}}};
    const catalog={...base,operators:{...base.operators,[sourceOp.chessId]:source,[targetOp.chessId]:target,[wrongOp.chessId]:wrong}};
    const holder={uid:`h-${id}-${elite}`,chessId:sourceOp.chessId,ownerId:'p1',elite,row:0,col:0,nativeState:{},equipment:[]};
    const friend={uid:'f',chessId:targetOp.chessId,ownerId:'p1',row:0,col:1,nativeState:{},equipment:[]};
    const unrelated={uid:'u',chessId:wrongOp.chessId,ownerId:'p1',row:0,col:2,nativeState:{},equipment:[]};
    const gained={uid:'gain',chessId:targetOp.chessId,ownerId:'p1',row:0,col:3,nativeState:{},equipment:[]};
    const state={round:1,shop:{level:1,slots:[]},pieces:[holder,friend,unrelated,gained],inventory:[],nextUid:1};
    const services={catalog,data:{},rng:()=>0,grantEquipment:(s,badge,n,extra)=>grantEquipment(s,catalog,badge,n,extra),grantChess(){},addOffer(){},record(){}};
    runNativeHook(state,'gain',{piece:gained,source:'buy'},services);
    const [attackId,secondaryId]=darkmoonGrowthBadges(gained,catalog),mult=elite?2:1;
    assert.deepEqual(gained.equipment.map(x=>[x.id,x.quantity]),[[attackId,attack*mult],...(secondary?[[secondaryId,secondary*mult]]:[])],`${id} grants source-specific permanent growth directly to the new mapped-faction recipient`);
    assert.equal(holder.equipment.length,0,'the source card is not its own summon recipient');
    assert.equal(friend.equipment.length,0,'existing units do not gain retroactive aura growth');
    assert.equal(unrelated.equipment.length,0,'a different native faction is excluded');
    assert.deepEqual(state.inventory,[],'fixed target growth cannot be turned into free hand resources');
  }
});

test('purchase target spec requires explicit eligible friendly or shop targets and Brann repeat count',()=>{
  const catalog={operators:{
    source:{name:'source',sourceRefs:{darkmoon19_2:{battlecry:true}},effectDelivery:{normal:[{recipient:'selectedFriendlyDragon',params:{faction:'卡西米尔'},targetSelection:{kind:'friendly',faction:'卡西米尔',count:1}}]}},
    friend:{name:'friend',nativeFactions:['卡西米尔']},wrong:{name:'wrong',nativeFactions:['炎']},
    shop:{name:'shop',sourceRefs:{darkmoon19_2:{battlecry:true}},effectDelivery:{normal:[{recipient:'selectedShopMinion',targetSelection:{kind:'shopSlot',count:1,excludeSource:true}}]}},
    brann:{name:'brann',nativeTrait:{effect:{prep:[{trigger:'aura',behavior:'triggerMultiplier',params:{hook:'gain',filter:'darkmoonBattlecry',extra:1}}]}}},
    eliteBrann:{name:'elite brann',nativeTrait:{effect:{prep:[{trigger:'aura',behavior:'triggerMultiplier',params:{hook:'gain',filter:'darkmoonBattlecry',extra:2}}]}}},
    magnetic:{name:'磁力干员',metadata:{op:{effectDelivery:{normal:[{kind:'magneticAttachment',targetSelection:{kind:'magnetic',faction:'哥伦比亚',count:1,optional:true}}]}}}},
    columbia:{name:'哥伦比亚目标',nativeFactions:['哥伦比亚']},wrongFaction:{name:'炎目标',nativeFactions:['炎']}
  }};
  const state={pieces:[{uid:'f',chessId:'friend',ownerId:'p',row:0,col:0},{uid:'bad',chessId:'wrong',ownerId:'p',row:0,col:1}],shop:{slots:[{id:'a'},{id:'b',sold:true},{id:'c'}]}};
  const friendSpec=buyTargetSpec({id:'source'},catalog);
  assert.equal(friendSpec.kind,'friendly');
  assert.deepEqual(buyTargetChoices(friendSpec,state,catalog,0).map(x=>x.uid),['f']);
  const shopSpec=buyTargetSpec({id:'shop'},catalog);
  assert.deepEqual(buyTargetChoices(shopSpec,state,catalog,0).map(x=>x.slot),[2]);
  const brannState={pieces:[...state.pieces,{uid:'b1',chessId:'brann',row:0,col:2},{uid:'b2',chessId:'eliteBrann',elite:true,row:0,col:3}]};
  assert.equal(buyTargetCount(shopSpec,brannState,catalog,{id:'shop'}),3,'strongest non-stacking Battlecry multiplier sets the number of selected shop slots');
  const magneticSpec=buyTargetSpec({id:'magnetic'},catalog);
  assert.equal(magneticSpec.optional,true,'magnetic card remains an ordinary recruit unless player chooses fusion');
  assert.equal(buyRequiresTarget(magneticSpec),false,'an optional target may proceed through the explicit ordinary-buy button');
  assert.deepEqual(buyTargetChoices(magneticSpec,{pieces:[{uid:'c',chessId:'columbia',row:0,col:0},{uid:'w',chessId:'wrongFaction',row:0,col:1}]},catalog,0).map(x=>x.uid),['c']);
  const noEligible=buyTargetChoices(friendSpec,{pieces:[{uid:'wrong',chessId:'wrong',ownerId:'p',row:0,col:0}]},catalog,0);
  assert.equal(noEligible.length,0);
  assert.equal(buyRequiresTarget(friendSpec),true,'UI must keep a required-target purchase open and disabled when no legal recipient exists');
  for(const id of ['BOT_312','BOT_911']) {
    const entry=byId.get(id),generated={id,metadata:{op:entry.metadata.op},sourceRefs:{darkmoon19_2:{id}}};
    const actual=buyTargetSpec({id}, {operators:{[id]:generated}});
    assert.deepEqual(actual,{kind:'magnetic',faction:'哥伦比亚',count:1,optional:true},`${id} compiled data drives the UI target picker`);
  }
});

test('Magnetic purchases can stay normal or consume into an explicit deployed Columbia target; unrelated factions are rejected',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite&&x.recruitable!==false),sourceOp=normal[0],targetOp=normal[1],wrongOp=normal[2];
  for(const id of ['BOT_312','BOT_911']) {
    const source={...sourceOp,nativeFactionTags:['哥伦比亚'],sourceRefs:{darkmoon19_2:{id}}},effect=nativeEffectFor(sourceOp.chessId,source,false);
    const target={...targetOp,nativeFactionTags:['哥伦比亚'],nativeTrait:{effect:{prep:[],combat:[]}}};
    const wrong={...wrongOp,nativeFactionTags:['炎'],nativeTrait:{effect:{prep:[],combat:[]}}};
    const catalog={...base,operators:{...base.operators,[sourceOp.chessId]:{...source,nativeTrait:{...sourceOp.nativeTrait,effect}},[targetOp.chessId]:target,[wrongOp.chessId]:wrong}};
    const makeState=(recipient)=>{const state=createSession({seed:id==='BOT_312'?314:911,catalog});state.funds=20;state.pieces.push({uid:'selected-columbia',chessId:recipient.chessId,row:9,col:2,equipment:[],attachments:[],nativeState:{}});state.shop.slots[0]={kind:'chess',id:sourceOp.chessId,price:3,sold:false,equipment:[]};return state;};
    const state=makeState(target),result=applyAction(state,{type:'buy',slot:0,magneticTargetUid:'selected-columbia'},{catalog});
    assert.equal(result.ok,true,JSON.stringify(result.error));
    assert.equal(result.state.pieces.some(x=>x.chessId===sourceOp.chessId),false,'fusion consumes the magnetic source and it cannot merge into the ordinary roster');
    const fused=result.state.pieces.find(x=>x.uid==='selected-columbia');
    if(id==='BOT_312') {
      assert.deepEqual(fused.attachments,[{id:'darkmoon-magnetic',state:{sourceId:'BOT_312',elite:false,sourceName:sourceOp.name,sourceEffect:byId.get('BOT_312').metadata.op.effectDelivery.normal.find(x=>x.kind==='sourceSpecificCombat').text}}]);
      assert.ok(catalog.attachments['darkmoon-magnetic'].name&&catalog.attachments['darkmoon-magnetic'].effect,'the attachment always has a display definition');
    } else {
      assert.ok(fused.equipment.some(x=>x.id==='independent:坚守盟约'));
      assert.ok(fused.equipment.some(x=>x.id==='independent:护盾发生器'));
      assert.equal(result.state.inventory.length,0,'BOT 911 selected growth and keywords land directly on the fixed recipient');
    }
    const invalid=makeState(wrongOp),bad=applyAction(invalid,{type:'buy',slot:0,magneticTargetUid:'selected-columbia'},{catalog});
    assert.equal(bad.ok,false,'a target outside the native Columbia faction is rejected');
    assert.equal(bad.error.code,'MAGNETIC_TARGET_MUST_BE_DEPLOYED_COLUMBIA');
    assert.equal(bad.state.funds,invalid.funds,'target validation happens before spending or drawing the source');
  }
  const source={...sourceOp,nativeFactionTags:['哥伦比亚'],sourceRefs:{darkmoon19_2:{id:'BOT_312'}}},catalog={...base,operators:{...base.operators,[sourceOp.chessId]:{...source,nativeTrait:{...sourceOp.nativeTrait,effect:nativeEffectFor(sourceOp.chessId,source,false)}}}};
  const ordinary=createSession({seed:312,catalog});ordinary.funds=20;ordinary.shop.slots[0]={kind:'chess',id:sourceOp.chessId,price:3,sold:false,equipment:[]};
  const bought=applyAction(ordinary,{type:'buy',slot:0},{catalog});assert.equal(bought.ok,true,JSON.stringify(bought.error));
  assert.ok(bought.state.pieces.some(x=>x.chessId===sourceOp.chessId),'choosing ordinary buy leaves the magnetic operator in the roster');
});

test('CFM 315 and BGS 115 use actual non-shop, non-merge support prototypes, including native levels and battle simulation',()=>{
  const base=getCatalog(),specs=designAddon.supportOperators;
  assert.equal(specs.length,3);
  for(const spec of specs) {
    const op=base.operators[spec.id];
    assert.ok(op?.darkmoonSupport&&op.recruitable===false&&op.mergeable===false,`${spec.id} is a runtime prototype outside the shop pool`);
    assert.equal(op.source.normalChess.stats.atk,spec.attack*120);
    assert.equal(op.source.normalChess.stats.maxHp,spec.health*350);
    assert.ok(op.nativeFactionTags.length,'a support unit also has its summon origin affiliation');
    assert.ok(op.source.normalChess.nativeGrowth,'support token carries an explicit native curve for levels mode');
  }
  const normal=Object.values(base.operators).find(x=>!x.elite&&x.recruitable!==false),summoner={...normal,sourceRefs:{darkmoon19_2:{id:'CFM_315'}}};
  const catalog={...base,operators:{...base.operators,[normal.chessId]:{...summoner,nativeTrait:{...normal.nativeTrait,effect:nativeEffectFor(normal.chessId,summoner,false)}}}};
  const state=createSession({seed:315,catalog,growthMode:'levels'});state.funds=20;state.shop.slots[0]={kind:'chess',id:normal.chessId,price:3,sold:false,equipment:[]};
  const recruited=applyAction(state,{type:'buy',slot:0},{catalog});assert.equal(recruited.ok,true,JSON.stringify(recruited.error));
  const cat=recruited.state.pieces.find(x=>x.chessId==='darkmoon:support-cat-1-1');assert.ok(cat);
  assert.equal(cat.growthMode,'levels');assert.equal(cat.growthLevel,1);
  assert.deepEqual(operatorGrowthInfo(cat,base).stats,{maxHp:350,atk:120,def:0,res:0},'support starts from its translated combat body');
  grantGrowthLevels(recruited.state,base,cat,1);
  assert.deepEqual(operatorGrowthInfo(cat,base).stats,{maxHp:354,atk:121,def:0,res:0},'support recipient advances along its authored support curve');
  const legal=viewSession(recruited.state,{catalog}).pieces.find(x=>x.uid===cat.uid).legalTiles;assert.ok(legal.length);
  const [row,col]=legal[0].split(',').map(Number),deployed=applyAction(recruited.state,{type:'move',uid:cat.uid,row,col},{catalog});assert.equal(deployed.ok,true,JSON.stringify(deployed.error));
  const fight=runIndependentBattle(deployed.state,{catalog});assert.equal(fight.diagnostics.errorCount,0,JSON.stringify(fight.diagnostics.errors));
  assert.ok(fight.samples.some(frame=>frame.units.some(unit=>unit.uid===cat.uid)),'the authored support body appears as a real participant in the existing Battle simulation');

  const source={...normal,sourceRefs:{darkmoon19_2:{id:'BGS_115'}}},catalog2={...base,operators:{...base.operators,[normal.chessId]:{...source,nativeTrait:{...normal.nativeTrait,effect:nativeEffectFor(normal.chessId,source,false)}}}};
  const sellerState=createSession({seed:115,catalog:catalog2});sellerState.funds=20;sellerState.shop.slots[0]={kind:'chess',id:normal.chessId,price:3,sold:false,equipment:[]};
  const bought=applyAction(sellerState,{type:'buy',slot:0},{catalog:catalog2});assert.equal(bought.ok,true,JSON.stringify(bought.error));
  const sold=applyAction(bought.state,{type:'sell',uid:bought.state.pieces.find(x=>x.chessId===normal.chessId).uid},{catalog:catalog2});assert.equal(sold.ok,true,JSON.stringify(sold.error));
  const offers=sold.state.offers.filter(x=>x.source==='darkmoon-elemental-token');assert.equal(offers.length,1);
  const chosen=applyAction(sold.state,{type:'choose',offerId:offers[0].id,index:0},{catalog:catalog2});assert.equal(chosen.ok,true,JSON.stringify(chosen.error));
  const elemental=chosen.state.pieces.find(x=>x.chessId==='darkmoon:support-elemental-2-2');assert.ok(elemental?.darkmoonPendingPlay,'a hand reward enters the roster without firing its gain trigger before first use');
  assert.equal(chosen.state.pool['darkmoon:support-elemental-2-2'],undefined,'support copy does not draw or spend normal pool stock');
});

test('golden Elemental Battlecries add the exact number of frozen shop offers or one-card hand recruit choices',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite&&x.recruitable!==false);
  for(const [id,behavior,targetType] of [['BGS_122','darkmoonAddTribeShopOffer','shop'],['BGS_123','darkmoonRecruitTribeToHand','hand']]) for(const elite of [false,true]) {
    const holderOp=normal.find(x=>x.name!==byId.get(id).operator),candidateOps=normal.filter(x=>x.chessId!==holderOp.chessId).slice(0,2);
    const holder={...holderOp,elite,sourceRefs:{darkmoon19_2:{id,rosterTribe:'ELEMENTAL',faction:'炎',battlecry:true}}};
    const effect=nativeEffectFor(holderOp.chessId,holder,elite);
    const operators={...base.operators,[holderOp.chessId]:{...holderOp,sourceRefs:holder.sourceRefs,nativeTrait:{...holderOp.nativeTrait,effect}}};
    candidateOps.forEach((op,i)=>operators[op.chessId]={...op,nativeFactionTags:['炎'],sourceRefs:{darkmoon19_2:{id:`TEST_${i}`,rosterTribe:'ELEMENTAL',faction:'炎'}}});
    const catalog={...base,operators};
    const state={round:1,shop:{level:1,freeRefreshes:0,slots:[]},pieces:[],offers:[],pool:Object.fromEntries(candidateOps.map(op=>[op.chessId,{left:3,cap:3,tier:op.tier}])),nextUid:1,counters:{},inventory:[]};
    const piece={uid:`${id}-${elite}`,chessId:holderOp.chessId,elite,ownerId:'p1',nativeState:{},equipment:[]};
    state.pieces.push(piece);
    runNativeHook(state,'gain',{piece,source:'buy'}, {catalog,data:{},rng:()=>0,grantEquipment(){},grantChess(){},addOffer(){},record(){}});
    const expected=elite?2:1;
    if(targetType==='shop') {
      assert.equal(state.shop.slots.length,expected);
      assert.ok(state.shop.slots.every(x=>x.kind==='chess'&&x.frozen&&x.id!==holderOp.chessId),'source card is excluded and the added tavern offer is frozen');
      assert.equal(state.offers.length,0,'shop offer never becomes a free hand choice');
    } else {
      assert.equal(state.offers.length,expected);
      assert.ok(state.offers.every(x=>x.type==='recruit'&&x.choices.length===1),'each random card is an explicit single-card recruit into the hand/bench flow');
      assert.equal(state.shop.slots.length,0,'hand reward never becomes a tavern offer');
    }
  }
});

test('frozen Battlecry-added tavern slots survive refresh even beyond the normal shop width',()=>{
  const catalog=getCatalog(),normal=Object.values(catalog.operators).find(x=>!x.elite&&x.recruitable!==false),state=createSession({seed:773,catalog});
  state.funds=20;
  state.shop.slots.push({kind:'chess',id:normal.chessId,price:3,sold:false,frozen:true,equipment:[]});
  const result=applyAction(state,{type:'refresh'},{catalog});
  assert.equal(result.ok,true,JSON.stringify(result.error));
  assert.ok(result.state.shop.slots.some(x=>x.id===normal.chessId&&x.frozen&&!x.sold),'the added frozen slot persists through the refresh and stays available');
});

test('BGS 048 uses this turns Pirate purchases and an explicit friendly Pirate; BGS 100 targets a selected friend from bought Elemental tier',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite&&x.recruitable!==false),buyerOp=normal[0],targetOp=normal[1],holderOp=normal[2];
  const buyerRef={id:'BGS_048',rosterTribe:'PIRATE',battlecry:true},targetRef={id:'TEST_PIRATE',rosterTribe:'PIRATE'};
  const buyer={...buyerOp,nativeFactionTags:['维多利亚'],sourceRefs:{darkmoon19_2:buyerRef}},effect=nativeEffectFor(buyerOp.chessId,buyer,false);
  const catalog={...base,operators:{...base.operators,[buyerOp.chessId]:{...buyerOp,nativeFactionTags:['维多利亚'],sourceRefs:buyer.sourceRefs,nativeTrait:{...buyerOp.nativeTrait,effect}},[targetOp.chessId]:{...targetOp,nativeFactionTags:['维多利亚'],sourceRefs:{darkmoon19_2:targetRef}}}};
  const state=createSession({seed:711,catalog});state.funds=20;state.counters.factionBought={'维多利亚':2};
  state.pieces.push({uid:'pirate-target',chessId:targetOp.chessId,nativeState:{},equipment:[],attachments:[],row:9,col:2});
  state.shop.slots[0]={kind:'chess',id:buyerOp.chessId,price:3,sold:false,equipment:[]};
  const result=applyAction(state,{type:'buy',slot:0,targetUid:'pirate-target'},{catalog});
  assert.equal(result.ok,true,JSON.stringify(result.error));
  const target=result.state.pieces.find(x=>x.uid==='pirate-target');
  assert.deepEqual(target.equipment.map(x=>[x.id,x.quantity]),darkmoonGrowthBadges(target,catalog).map(id=>[id,3]),'the current bought Pirate joins two earlier same-turn purchases before gain resolves and uses the target profession');
  assert.equal(result.state.inventory.length,0,'selected Pirate receives permanent direct growth');

  const elemental={...holderOp,sourceRefs:{darkmoon19_2:{id:'BGS_100'}}},elementalEffect=nativeEffectFor(holderOp.chessId,elemental,false);
  const bought={...targetOp,nativeFactionTags:['炎'],sourceRefs:{darkmoon19_2:{id:'TEST_ELEMENTAL',rosterTribe:'ELEMENTAL'}}};
  const catalog2={...base,operators:{...base.operators,[holderOp.chessId]:{...holderOp,nativeFactionTags:['哥伦比亚'],sourceRefs:elemental.sourceRefs,nativeTrait:{...holderOp.nativeTrait,effect:elementalEffect}},[targetOp.chessId]:{...targetOp,nativeFactionTags:['炎'],sourceRefs:bought.sourceRefs}}};
  const state2={round:1,shop:{slots:[]},pieces:[{uid:'holder',chessId:holderOp.chessId,ownerId:'p1',nativeState:{},row:9,col:2,equipment:[]},{uid:'selected',chessId:targetOp.chessId,ownerId:'p1',nativeState:{},row:9,col:3,equipment:[]}],counters:{},inventory:[]};
  const services={catalog:catalog2,data:{},rng:()=>0,grantEquipment:(s,id,n,extra)=>grantEquipment(s,catalog2,id,n,extra),grantChess(){},addOffer(){},record(){}};
  runNativeHook(state2,'bought',{piece:{uid:'elemental-bought',chessId:targetOp.chessId,ownerId:'p1'},targetUid:'selected'},services);
  const tier=Number(targetOp.tier||1);
  const selected=state2.pieces.find(x=>x.uid==='selected');
  assert.deepEqual(selected.equipment.map(x=>[x.id,x.quantity]),darkmoonGrowthBadges(selected,catalog2).map(id=>[id,tier]),'BGS 100 uses the purchased Elemental tier on the exact selected friend using that target profession');
});

test('a generated hand card defers its native Battlecry until its first field move, then cannot replay it on redeploy',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite&&x.recruitable!==false),sourceOp=normal[0],candidateOp=normal[1];
  const source={...sourceOp,sourceRefs:{darkmoon19_2:{id:'BGS_123',rosterTribe:'ELEMENTAL',battlecry:true}}},sourceEffect=nativeEffectFor(sourceOp.chessId,source,false);
  const candidate={...candidateOp,nativeFactionTags:['炎'],sourceRefs:{darkmoon19_2:{id:'BGS_116',rosterTribe:'ELEMENTAL',battlecry:true}}},candidateEffect=nativeEffectFor(candidateOp.chessId,candidate,false);
  const catalog={...base,operators:{...base.operators,[sourceOp.chessId]:{...sourceOp,sourceRefs:source.sourceRefs,nativeTrait:{...sourceOp.nativeTrait,effect:sourceEffect}},[candidateOp.chessId]:{...candidateOp,nativeFactionTags:['炎'],sourceRefs:candidate.sourceRefs,nativeTrait:{...candidateOp.nativeTrait,effect:candidateEffect}}}};
  const state=createSession({seed:812,catalog});for(const poolId of Object.keys(state.pool))state.pool[poolId].left=poolId===candidateOp.chessId?3:poolId===sourceOp.chessId?3:0;state.funds=20;state.shop.slots[0]={kind:'chess',id:sourceOp.chessId,price:3,sold:false,equipment:[]};
  const bought=applyAction(state,{type:'buy',slot:0},{catalog});assert.equal(bought.ok,true,JSON.stringify(bought.error));
  const offer=bought.state.offers.find(x=>x.source==='darkmoon-hand-reward');assert.ok(offer);
  const chosen=applyAction(bought.state,{type:'choose',offerId:offer.id,index:0},{catalog});assert.equal(chosen.ok,true,JSON.stringify(chosen.error));
  const handPiece=chosen.state.pieces.find(x=>x.chessId===offer.choices[0]);
  assert.equal(handPiece.darkmoonPendingPlay,true,'the hand copy waits on the bench without firing its Battlecry');
  assert.equal(chosen.state.shop.freeRefreshes,0);
  const tiles=viewSession(chosen.state,{catalog}).pieces.find(x=>x.uid===handPiece.uid).legalTiles;
  const [row,col]=tiles[0].split(',').map(Number);
  const deployed=applyAction(chosen.state,{type:'move',uid:handPiece.uid,row,col},{catalog});assert.equal(deployed.ok,true,JSON.stringify(deployed.error));
  assert.equal(deployed.state.pieces.find(x=>x.uid===handPiece.uid).darkmoonPendingPlay,undefined);
  assert.equal(deployed.state.shop.freeRefreshes,1,'first use fires its original Battlecry once');
  const tilesAgain=viewSession(deployed.state,{catalog}).pieces.find(x=>x.uid===handPiece.uid).legalTiles;
  const alternate=tilesAgain.find(x=>x!==`${row},${col}`);assert.ok(alternate);
  const [row2,col2]=alternate.split(',').map(Number);
  const redeployed=applyAction(deployed.state,{type:'move',uid:handPiece.uid,row:row2,col:col2},{catalog});assert.equal(redeployed.ok,true,JSON.stringify(redeployed.error));
  assert.equal(redeployed.state.shop.freeRefreshes,1,'redeploy never repeats the hand copy Battlecry');
});

test('Murozond recruits a pristine copy from the saved previous friendly warband and defers its hooks until first play',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite&&x.recruitable!==false),sourceOp=normal[0],copyOp=normal.find(x=>x.chessId!==sourceOp.chessId);
  const source={...sourceOp,sourceRefs:{darkmoon19_2:{id:'BGS_043',battlecry:true}}},effect=nativeEffectFor(sourceOp.chessId,source,false);
  const catalog={...base,operators:{...base.operators,[sourceOp.chessId]:{...sourceOp,sourceRefs:source.sourceRefs,nativeTrait:{...sourceOp.nativeTrait,effect}}}};
  const state=createSession({seed:910,catalog});state.funds=20;state.previousRoundWarband=[{chessId:copyOp.chessId}];state.shop.slots[0]={kind:'chess',id:sourceOp.chessId,price:3,sold:false,equipment:[]};
  const bought=applyAction(state,{type:'buy',slot:0},{catalog});assert.equal(bought.ok,true,JSON.stringify(bought.error));
  const copy=bought.state.pieces.find(x=>x.chessId===copyOp.chessId);assert.ok(copy?.darkmoonPendingPlay,'the copied operator enters the bench without replaying gain hooks');
  const copyPoolBefore=state.pool[copyOp.chessId].left;
  assert.equal(bought.state.pool[copyOp.chessId].left,copyPoolBefore,'a pristine original copy does not consume a fresh pool copy');
  const tile=viewSession(bought.state,{catalog}).pieces.find(x=>x.uid===copy.uid).legalTiles[0].split(',').map(Number);
  const moved=applyAction(bought.state,{type:'move',uid:copy.uid,row:tile[0],col:tile[1]},{catalog});assert.equal(moved.ok,true,JSON.stringify(moved.error));
  assert.equal(moved.state.pieces.find(x=>x.uid===copy.uid).darkmoonPendingPlay,undefined);
});

test('applyAction persists combat growth on its fixed target and resolves pristine hand copies and coins',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite&&x.recruitable!==false),ownerOp=normal[0],recruitOp=normal.find(x=>x.chessId!==ownerOp.chessId);
  for(const growthMode of ['badges','levels']) {
    const state=createSession({seed:growthMode==='badges'?991:992,catalog:base,growthMode});state.funds=20;
    state.shop.slots[0]={kind:'chess',id:ownerOp.chessId,price:3,sold:false,equipment:[]};
    const bought=applyAction(state,{type:'buy',slot:0},{catalog:base});assert.equal(bought.ok,true,JSON.stringify(bought.error));
    const owner=bought.state.pieces.find(x=>x.chessId===ownerOp.chessId);
    const tile=viewSession(bought.state,{catalog:base}).pieces.find(x=>x.uid===owner.uid).legalTiles[0].split(',').map(Number);
    const moved=applyAction(bought.state,{type:'move',uid:owner.uid,row:tile[0],col:tile[1]},{catalog:base});assert.equal(moved.ok,true,JSON.stringify(moved.error));
    const initialLevel=owner.growthLevel||1;
    const result=applyAction(moved.state,{type:'ready'},{catalog:base,battleRunner:()=>({result:{perPlayer:{independent:{leaked:[]}},killed:0},pieceStates:{},darkmoonResults:{
      growth:[{sourceUid:owner.uid,targetUid:owner.uid,attackUnits:1,secondaryUnits:1}],
      recruits:[{sourceUid:owner.uid,chessId:recruitOp.chessId,pristine:true}],coins:[{sourceUid:owner.uid,quantity:2,inventory:true}]
    }})});
    assert.equal(result.ok,true,JSON.stringify(result.error));
    const grown=result.state.pieces.find(x=>x.uid===owner.uid),copy=result.state.pieces.find(x=>x.chessId===recruitOp.chessId);
    assert.ok(copy?.darkmoonPendingPlay,'combat hand copies enter the bench without firing Battlecry or inheriting gear');
    assert.equal(result.state.inventory.find(x=>x.id==='chess_item_1_03_e_a')?.quantity,2,'coin output becomes the named inventory resource');
    if(growthMode==='badges')assert.ok(grown.equipment.some(x=>x.id==='precision'&&x.quantity===1),'combat attack growth wears on the specified target');
    else assert.equal(grown.growthLevel,initialLevel+2,'attack and profession-matched secondary growth become native curve levels on the same target');
    assert.equal(result.state.production.some(x=>x.sourceUid===owner.uid&&x.targetUid===owner.uid),true,'battle reward production records the fixed recipient');
  }
});

test('BGS 113 consumes the explicitly selected shop slot and creates a normal or golden copy on the purchased body',()=>{
  const base=getCatalog();
  const ops=Object.values(base.operators), sourceOp=ops.find(x=>!x.elite&&x.recruitable!==false), targetOp=ops.find(x=>!x.elite&&x.chessId!==sourceOp.chessId&&x.recruitable!==false);
  assert.ok(sourceOp&&targetOp);
  const source={...sourceOp,sourceRefs:{darkmoon19_2:{id:'BGS_113'}},modeEffects:{normal:{prep:[],combat:[]},elite:{prep:[],combat:[]}}};
  const effect=nativeEffectFor(sourceOp.chessId,source,false);
  const catalog={...base,operators:{...base.operators,[sourceOp.chessId]:{...sourceOp,sourceRefs:source.sourceRefs,nativeTrait:{...sourceOp.nativeTrait,effect}}}};
  const state=createSession({seed:440,catalog});
  state.funds=20;
  state.shop.slots=[{kind:'chess',id:sourceOp.chessId,price:3,sold:false,equipment:[]},{kind:'chess',id:targetOp.chessId,price:3,sold:false,equipment:[]}];
  const result=applyAction(state,{type:'buy',slot:0,shopSlot:1},{catalog});
  assert.equal(result.ok,true,JSON.stringify(result.error));
  assert.equal(result.state.pieces[0].chessId,targetOp.chessId,'normal source copies only the explicitly selected shop slot');
  assert.equal(result.state.pool[sourceOp.chessId].left,state.pool[sourceOp.chessId].left,'original purchased body returns to its source pool');
  assert.equal(result.state.pool[targetOp.chessId].left,state.pool[targetOp.chessId].left-1,'copy consumes the selected operator pool copy');
  assert.equal(result.state.inventory.length,0,'transformation is a body change, not hand/inventory reward');

  const eliteSourceRef={...source};delete eliteSourceRef.modeEffects;
  const eliteEffect=nativeEffectFor(sourceOp.chessId,eliteSourceRef,true), selected=[];
  const eliteSource={uid:'elite-battlemaster',chessId:sourceOp.chessId,ownerId:'p1',elite:true,nativeState:{},row:0,col:0};
  const eliteState={round:1,shop:{slots:[{kind:'chess',id:targetOp.chessId},{kind:'chess',id:sourceOp.chessId},{kind:'chess',id:targetOp.chessId}]},pieces:[eliteSource],counters:{},totals:{}};
  const eliteCatalog={...base,operators:{...base.operators,[sourceOp.chessId]:{...sourceOp,sourceRefs:source.sourceRefs,nativeTrait:{effect:eliteEffect}}}};
  runNativeHook(eliteState,'gain',{piece:eliteSource,source:'buy',shopSlots:[0],buySlot:1},{catalog:eliteCatalog,data:{},rng:()=>0,transformPiece:(_s,_p,slot,golden)=>selected.push({id:slot.id,golden}),grantEquipment(){},grantChess(){},addOffer(){},record(){}});
  assert.deepEqual(selected,[{id:targetOp.chessId,golden:true}],'elite Battlecry requests a golden copy of the selected offer once');
});
