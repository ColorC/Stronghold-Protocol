import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeEffectFor } from '../../server/modes/independent/native.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runNativeHook } from '../../server/modes/independent/native.js';
import { grantEquipment } from '../../server/modes/independent/equipment.js';

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
  assert.equal(byId.get('BGS_104').metadata.op.effectDelivery.normal[0].recipient, 'shop');
  assert.equal(byId.get('BGS_046').metadata.op.effectDelivery.normal[0].recipient, 'hand');
  assert.equal(blueprints.entries.filter(x => x.metadata.op.effectDelivery.normal.some(e=>e.implementation === 'dispatched-pending-gear-landing-verification')).length, 7);
  assert.equal(byId.get('BGS_043').authoredRule.adaptation.source, 'randomFriendlyOperatorFromPreviousRound');
  assert.equal(byId.get('DAL_575').authoredRule.mechanic, 'summonMultiplier');
  assert.equal(byId.get('LOE_077').authoredRule.normal.trigger, 'battlecryOnGain');
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
  assert.equal(blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.some(e=>e.implementation==='dispatched-pending-gear-landing-verification')).length,7);
  assert.equal(blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.every(e=>e.implementation==='unsupported')).length,90);
  assert.equal(blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.every(e=>e.implementation==='supported')).length,4);
  assert.equal(gameTextAddon.operators['风丸'].sourceId, 'DAL_575');
  assert.equal(gameTextAddon.operators['远牙'].sourceId, 'BGS_043');
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
    const state={round:1,shop:{level:1,upgradePrice:5,freeRefreshes:0,slots:[]},pieces:[],counters:{gained:0,spent:0,paidRefreshes:0},pendingFunds:0,nextUid:1,inventory:[]};
    const piece={uid:`${id}-${elite?'elite':'normal'}`,chessId:op.chessId,nativeState:{},equipment:[],row:0,col:0};
    state.pieces.push(piece);
    const services={catalog,data:{},rng:()=>0,grantEquipment:(s,item,n,extra)=>grantEquipment(s,catalog,item,n,extra),grantChess(){},addOffer(){},record(){}};
    const hook=id==='BGS_027'?'roundStart':id==='BGS_049'?'sold':'gain';
    runNativeHook(state,hook,{piece,origin:'player'},services);
    const expected=elite?2:1;
    if(id==='BGS_027') assert.equal(piece.equipment.find(x=>x.id==='precision')?.quantity,expected,`${id} grants permanent precision to self`);
    if(id==='BGS_049') assert.equal(state.pendingFunds,elite?6:3,`${id} credits sell value`);
    if(id==='BGS_055') assert.equal(state.shop.upgradePrice,5-expected,`${id} discounts the next upgrade cost`);
    if(id==='BGS_116') assert.equal(state.shop.freeRefreshes,expected,`${id} grants exactly the next refresh count`);
  }
});
