import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeEffectFor } from '../../server/modes/independent/native.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runNativeHook } from '../../server/modes/independent/native.js';
import { grantEquipment } from '../../server/modes/independent/equipment.js';
import { decorateDarkmoonShopSlots, applyDarkmoonShopGrowth } from '../../server/modes/independent/darkmoonShop.js';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';

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
  assert.equal(byId.get('BGS_009').metadata.op.effectDelivery.normal[0].recipient, 'onePerEligibleType');
  assert.equal(byId.get('BGS_104').metadata.op.effectDelivery.normal[0].recipient, 'matchingTribeShopOffers');
  assert.equal(byId.get('BGS_037').metadata.op.effectDelivery.normal[0].recipient, 'currentShopOffers');
  assert.equal(byId.get('BGS_046').metadata.op.effectDelivery.normal[0].recipient, 'hand');
  assert.equal(blueprints.entries.filter(x => x.metadata.op.effectDelivery.normal.some(e=>e.kind==='keywordGear' && e.implementation==='supported')).length, 7);
  assert.equal(byId.get('BGS_043').authoredRule.adaptation.source, 'randomFriendlyOperatorFromPreviousRound');
  assert.equal(byId.get('DAL_575').authoredRule.mechanic, 'summonMultiplier');
  assert.equal(byId.get('LOE_077').authoredRule.normal.trigger, 'battlecryOnGain');
  assert.equal(byId.get('BGS_113').authoredRule.normal.recipient, 'selectedShopMinion');
  assert.equal(byId.get('FP1_031').authoredRule.normal.trigger, 'retiringEffect');
  assert.equal(byId.get('BGS_039').authoredRule.normal.outputs[0].id,'independent:坚守盟约');
  assert.equal(byId.get('BGS_034').authoredRule.elite.outputs.length,2);
});

test('compiler add-ons link only existing native definitions and preserve all source text without replacing canonical files', () => {
  assert.equal(designAddon.operators.length, 67);
  assert.equal(designAddon.pendingNativeDefinitions.length, 34);
  assert.ok(designAddon.operators.every(x => x.chessId && x.modeEffects === null));
  assert.ok(designAddon.operators.every(x => x.metadata.op.effectDelivery.normal.length && x.metadata.op.effectDelivery.elite.length));
  assert.equal(Object.keys(gameTextAddon.operators).length, 101);
  assert.equal(blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.some(e=>e.kind==='keywordGear' && e.implementation==='supported')).length,7);
  assert.equal(blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.every(e=>e.implementation==='unsupported')).length,78);
  assert.equal(blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.every(e=>e.implementation==='supported')).length,23);
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

test('all seven static keyword adapters really wear their gear on normal and elite recipients',()=>{
  const baseCatalog=getCatalog();
  const sourceIds=['BGS_039','BGS_106','BGS_034','BGS_131','FP1_010','GVG_113','LOOT_078'];
  for(const id of sourceIds) for(const elite of [false,true]) {
    const op=Object.values(baseCatalog.operators).find(x=>Boolean(x.elite)===elite);
    const source={...op,sourceRefs:{darkmoon19_2:{id}},modeEffects:{normal:{prep:[],combat:[]},elite:{prep:[],combat:[]}}};
    const effect=nativeEffectFor(op.chessId,source,elite);
    const catalog={...baseCatalog,operators:{...baseCatalog.operators,[op.chessId]:{...op,nativeTrait:{...op.nativeTrait,effect}}}};
    const state={round:1,shop:{level:1,freeRefreshes:0,slots:[]},pieces:[],counters:{gained:0,spent:0,paidRefreshes:0},pendingFunds:0,nextUid:1,inventory:[]};
    const piece={uid:`${id}-${elite?'elite':'normal'}`,chessId:op.chessId,nativeState:{},equipment:[]};state.pieces.push(piece);
    const services={catalog,data:{},rng:()=>0,grantEquipment:(s,item,n,extra)=>grantEquipment(s,catalog,item,n,extra),grantChess(){},addOffer(){},record(){}};
    runNativeHook(state,'gain',{piece,origin:'player'},services);
    const expected=byId.get(id).authoredRule.normal.outputs.map(x=>x.id).sort();
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
    const pirate={...buyerOp,sourceRefs:{darkmoon19_2:{id:'BGS_001',rosterTribe:'PIRATE',faction:'维多利亚'}}};
    const other={...otherOp,sourceRefs:{darkmoon19_2:{id:'BGS_002',rosterTribe:'BEAST',faction:'维多利亚'}}};
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
  const elemental={...elementalOp,sourceRefs:{darkmoon19_2:{id:'BGS_001',rosterTribe:'ELEMENTAL',faction:'炎'}}};
  const mech={...mechOp,sourceRefs:{darkmoon19_2:{id:'BGS_002',rosterTribe:'MECHANICAL',faction:'哥伦比亚'}}};
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
  const services={grantEquipment:(s,id,n,extra)=>grantEquipment(s,catalog,id,n,extra)};
  assert.equal(applyDarkmoonShopGrowth(state,future[0],target,services).length,2);
  assert.deepEqual(target.equipment.map(x=>[x.id,x.quantity]),[['precision',1],['vitality',1]]);
  assert.equal(state.inventory.length,0,'shop stats are fixed recipient growth, not carried inventory');
});

test('original Battlecry buffs inspect the acquired source tag and wear permanent growth only on the fixed tribe targets',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite&&x.recruitable!==false);
  for(const [id,tribe,elite,count,badges] of [['BGS_041','DRAGON',false,1,['precision','vitality']],['BGS_053','PIRATE',true,6,['precision']],['BGS_128','ELEMENTAL',false,1,['precision','vitality']]]) {
    const holderOp=normal.find(x=>x.name!==byId.get(id).operator), otherOp=normal.find(x=>x.chessId!==holderOp.chessId&&x.name!==byId.get(id).operator), gainOp=normal.find(x=>x.chessId!==holderOp.chessId&&x.chessId!==otherOp.chessId);
    const holderRef={id,rosterTribe:tribe}, otherRef={id:'TEST_TARGET',rosterTribe:tribe}, gainedRef={id:'TEST_BATTLECRY',battlecry:true,rosterTribe:'NEUTRAL'};
    const holder={...holderOp,sourceRefs:{darkmoon19_2:holderRef}};
    const effect=nativeEffectFor(holderOp.chessId,holder,elite);
    const catalog={...base,operators:{...base.operators,[holderOp.chessId]:{...holderOp,sourceRefs:holder.sourceRefs,nativeTrait:{...holderOp.nativeTrait,effect}},[otherOp.chessId]:{...otherOp,sourceRefs:{darkmoon19_2:otherRef}},[gainOp.chessId]:{...gainOp,sourceRefs:{darkmoon19_2:gainedRef}}}};
    const state={round:1,shop:{level:1,freeRefreshes:0,slots:[]},pieces:[],counters:{gained:0,spent:0,paidRefreshes:0},pendingFunds:0,nextUid:1,inventory:[]};
    const host={uid:'host',chessId:holderOp.chessId,ownerId:'p1',nativeState:{},row:0,col:0,equipment:[]},other={uid:'other',chessId:otherOp.chessId,ownerId:'p1',nativeState:{},row:0,col:1,equipment:[]},gained={uid:'gained',chessId:gainOp.chessId,ownerId:'p1',nativeState:{},equipment:[]};state.pieces.push(host,other);
    const services={catalog,data:{},rng:()=>0,grantEquipment:(s,badge,n,extra)=>grantEquipment(s,catalog,badge,n,extra),grantChess(){},addOffer(){},record(){}};
    runNativeHook(state,'gain',{piece:gained,source:'buy',paid:true},services);
    assert.deepEqual(host.equipment.map(x=>x.id).sort(),(id==='BGS_041'?badges:[]).sort(),`${id} applies only to eligible self if the original says all Dragons`);
    assert.deepEqual(other.equipment.map(x=>x.id).sort(),badges.slice().sort(),`${id} grants its fixed friendly tribe recipient`);
    assert.ok(other.equipment.every(x=>x.quantity===count),`${id} normal/elite authored output amount is direct gear growth`);
    assert.equal(state.inventory.length,0,`${id} fixed target growth never spills into free inventory`);
  }
});

test('golden Elemental Battlecries add the exact number of frozen shop offers or one-card hand recruit choices',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite&&x.recruitable!==false);
  for(const [id,behavior,targetType] of [['BGS_122','darkmoonAddTribeShopOffer','shop'],['BGS_123','darkmoonRecruitTribeToHand','hand']]) for(const elite of [false,true]) {
    const holderOp=normal.find(x=>x.name!==byId.get(id).operator),candidateOps=normal.filter(x=>x.chessId!==holderOp.chessId).slice(0,2);
    const holder={...holderOp,elite,sourceRefs:{darkmoon19_2:{id,rosterTribe:'ELEMENTAL',faction:'炎',battlecry:true}}};
    const effect=nativeEffectFor(holderOp.chessId,holder,elite);
    const operators={...base.operators,[holderOp.chessId]:{...holderOp,sourceRefs:holder.sourceRefs,nativeTrait:{...holderOp.nativeTrait,effect}}};
    candidateOps.forEach((op,i)=>operators[op.chessId]={...op,sourceRefs:{darkmoon19_2:{id:`TEST_${i}`,rosterTribe:'ELEMENTAL',faction:'炎'}}});
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
  const buyer={...buyerOp,sourceRefs:{darkmoon19_2:buyerRef}},effect=nativeEffectFor(buyerOp.chessId,buyer,false);
  const catalog={...base,operators:{...base.operators,[buyerOp.chessId]:{...buyerOp,sourceRefs:buyer.sourceRefs,nativeTrait:{...buyerOp.nativeTrait,effect}},[targetOp.chessId]:{...targetOp,sourceRefs:{darkmoon19_2:targetRef}}}};
  const state=createSession({seed:711,catalog});state.funds=20;state.counters.tribeBought={PIRATE:2};
  state.pieces.push({uid:'pirate-target',chessId:targetOp.chessId,nativeState:{},equipment:[],attachments:[],row:9,col:2});
  state.shop.slots[0]={kind:'chess',id:buyerOp.chessId,price:3,sold:false,equipment:[]};
  const result=applyAction(state,{type:'buy',slot:0,targetUid:'pirate-target'},{catalog});
  assert.equal(result.ok,true,JSON.stringify(result.error));
  const target=result.state.pieces.find(x=>x.uid==='pirate-target');
  assert.deepEqual(target.equipment.map(x=>[x.id,x.quantity]),[['precision',3],['vitality',3]],'the current bought Pirate joins two earlier same-turn purchases before gain resolves');
  assert.equal(result.state.inventory.length,0,'selected Pirate receives permanent direct growth');

  const elemental={...holderOp,sourceRefs:{darkmoon19_2:{id:'BGS_100'}}},elementalEffect=nativeEffectFor(holderOp.chessId,elemental,false);
  const bought={...targetOp,sourceRefs:{darkmoon19_2:{id:'TEST_ELEMENTAL',rosterTribe:'ELEMENTAL'}}};
  const catalog2={...base,operators:{...base.operators,[holderOp.chessId]:{...holderOp,sourceRefs:elemental.sourceRefs,nativeTrait:{...holderOp.nativeTrait,effect:elementalEffect}},[targetOp.chessId]:{...targetOp,sourceRefs:bought.sourceRefs}}};
  const state2={round:1,shop:{slots:[]},pieces:[{uid:'holder',chessId:holderOp.chessId,ownerId:'p1',nativeState:{},row:9,col:2,equipment:[]},{uid:'selected',chessId:targetOp.chessId,ownerId:'p1',nativeState:{},row:9,col:3,equipment:[]}],counters:{},inventory:[]};
  const services={catalog:catalog2,data:{},rng:()=>0,grantEquipment:(s,id,n,extra)=>grantEquipment(s,catalog2,id,n,extra),grantChess(){},addOffer(){},record(){}};
  runNativeHook(state2,'bought',{piece:{uid:'elemental-bought',chessId:targetOp.chessId,ownerId:'p1'},targetUid:'selected'},services);
  const tier=Number(targetOp.tier||1);
  assert.deepEqual(state2.pieces.find(x=>x.uid==='selected').equipment.map(x=>[x.id,x.quantity]),[['precision',tier],['vitality',tier]],'BGS 100 uses the purchased Elemental tier on the exact selected friend');
});

test('a generated hand card defers its native Battlecry until its first field move, then cannot replay it on redeploy',()=>{
  const base=getCatalog(),normal=Object.values(base.operators).filter(x=>!x.elite&&x.recruitable!==false),sourceOp=normal[0],candidateOp=normal[1];
  const source={...sourceOp,sourceRefs:{darkmoon19_2:{id:'BGS_123',rosterTribe:'ELEMENTAL',battlecry:true}}},sourceEffect=nativeEffectFor(sourceOp.chessId,source,false);
  const candidate={...candidateOp,sourceRefs:{darkmoon19_2:{id:'BGS_116',rosterTribe:'ELEMENTAL',battlecry:true}}},candidateEffect=nativeEffectFor(candidateOp.chessId,candidate,false);
  const catalog={...base,operators:{...base.operators,[sourceOp.chessId]:{...sourceOp,sourceRefs:source.sourceRefs,nativeTrait:{...sourceOp.nativeTrait,effect:sourceEffect}},[candidateOp.chessId]:{...candidateOp,sourceRefs:candidate.sourceRefs,nativeTrait:{...candidateOp.nativeTrait,effect:candidateEffect}}}};
  const state=createSession({seed:812,catalog});state.funds=20;state.shop.slots[0]={kind:'chess',id:sourceOp.chessId,price:3,sold:false,equipment:[]};
  const bought=applyAction(state,{type:'buy',slot:0},{catalog});assert.equal(bought.ok,true,JSON.stringify(bought.error));
  const offer=bought.state.offers.find(x=>x.source==='darkmoon-hand-reward');assert.ok(offer);
  const chosen=applyAction(bought.state,{type:'choose',offerId:offer.id,index:0},{catalog});assert.equal(chosen.ok,true,JSON.stringify(chosen.error));
  const handPiece=chosen.state.pieces.find(x=>x.chessId===candidateOp.chessId);
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
