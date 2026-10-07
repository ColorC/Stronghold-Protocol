import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeEffectFor } from '../../server/modes/independent/native.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runNativeHook } from '../../server/modes/independent/native.js';

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
});

test('compiler add-ons link only existing native definitions and preserve all source text without replacing canonical files', () => {
  assert.equal(designAddon.operators.length, 67);
  assert.equal(designAddon.pendingNativeDefinitions.length, 34);
  assert.ok(designAddon.operators.every(x => x.chessId && x.modeEffects === null));
  assert.equal(Object.keys(gameTextAddon.operators).length, 101);
  assert.equal(blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.some(e=>e.implementation==='dispatched-pending-gear-landing-verification')).length,7);
  assert.equal(blueprints.entries.filter(x=>x.metadata.op.effectDelivery.normal.every(e=>e.implementation==='unsupported')).length,94);
  assert.equal(gameTextAddon.operators['风丸'].sourceId, 'DAL_575');
  assert.equal(gameTextAddon.operators['远牙'].sourceId, 'BGS_043');
});

test('explicit keyword adapters dispatch source-id keyed gain grants only to self', () => {
  const source = { name:'砾', modeEffects:{ normal:{prep:[],combat:[]}, elite:{prep:[],combat:[]} } };
  const effect = nativeEffectFor('test-id', source, false);
  const rule = effect.prep.find(x=>x.params?.outputs?.some(o=>o.id==='independent:坚守盟约'));
  assert.ok(rule);
  assert.equal(rule.trigger,'gain');
  assert.equal(rule.params.landOn,'self');
  assert.equal(rule.params.outputs[0].normal,1);
  assert.equal(rule.params.outputs[0].elite,1);
});

test('live catalog dispatches the Taunt adapter once on recruit gain with wearer target', () => {
  const catalog = getCatalog();
  const op = Object.values(catalog.operators).find(x=>x.name==='砾'&&!x.elite);
  assert.ok(op);
  const state={round:1,shop:{level:1,freeRefreshes:0,slots:[]},pieces:[],counters:{gained:0,spent:0,paidRefreshes:0},pendingFunds:0,nextUid:1,inventory:[]};
  const granted=[];
  const piece={uid:'dragonspawn',chessId:op.chessId,nativeState:{}};
  const services={catalog,data:{},rng:()=>0,grantEquipment(_s,id,quantity,extra){granted.push({id,quantity,...extra});},grantChess(){},addOffer(){},record(){}};
  state.pieces.push(piece);
  runNativeHook(state,'gain',{piece,origin:'player'},services);
  const grant=granted.find(x=>x.id==='independent:坚守盟约');
  assert.ok(grant);
  assert.equal(grant.landOn,'self');
  assert.equal(grant.quantity,1);
  const n=granted.length;
  runNativeHook(state,'roundStart',{piece,origin:'player'},services);
  assert.equal(granted.length,n,'gear is awarded on acquisition, not redeploy or a later prep phase');
});
