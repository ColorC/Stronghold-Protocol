import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssaultContext} from '../../server/modes/assault/context.js';
import {createRun,applyAction} from '../../shared/assault/run.js';
import {buildShopState,calculateSellPrice,repriceOperatorShop} from '../../shared/assault/shops.js';
import {buildAssaultBattleInput} from '../../shared/assault/battle-input.js';

const context=createAssaultContext();
test('every operator uses the same 4/8/16/32 curve; merges preserve purchase and resale value',()=>{
  for(const star of [1,2,3,4]) {
    const system=structuredClone(context.design.system);
    system.shopQualityWeights.days['10']={[star]:1};
    const ctx={...context,design:{...context.design,system}};
    const state={day:10,pieces:[],relicIds:[],nextShopDiscount:0,rngState:7100};
    for(let seed=1;seed<30;seed++) {
      const shop=buildShopState({...state,rngState:seed},ctx,'shop_base');
      for(const slot of shop.slots) {
        assert.equal(slot.price,[4,8,16,32][star-1]);
        const sale=calculateSellPrice({purchaseCharId:slot.purchaseCharId,star,sourceCopies:slot.requiredCopies},ctx);
        assert.equal(sale,[2,4,8,16][star-1]);assert.equal(sale*2,slot.price);
      }
    }
  }
});

test('an old 48-gold quote is repriced without changing identities, prior spending or RNG',()=>{
  const state={phase:'shop',gold:7,rngState:123,shop:{id:'shop_base',kind:'operator',consumedNextShopDiscount:0,
    slots:[{slotId:'old',purchaseCharId:'char_1045_svash2',star:4,requiredCopies:8,price:48}]}};
  const before=structuredClone(state),result=repriceOperatorShop(state,context);
  assert.equal(result.shop.slots[0].price,32);assert.equal(result.shop.slots[0].slotId,'old');
  assert.equal(result.rngState,123);assert.deepEqual(state,before);
  assert.equal(repriceOperatorShop({...state,shop:result.shop},context),null);
});

test('normal encounters change enemy rosters while preserving the map, routes and deployed formation',()=>{
  const state=createRun({runId:'fixed-map',seed:71,directorId:context.design.system.directors[0].id},context);
  const initial=context.fieldFor(state),formation=state.pieces.map(piece=>[piece.uid,piece.row,piece.col,piece.dir]);
  for(const encounter of context.design.encounters.encounters.filter(entry=>entry.kind!=='final')) {
    const run=structuredClone(state);
    run.currentNode={kind:'battle',encounterId:encounter.id};
    assert.equal(context.fieldFor(run).stageId,initial.stageId);
    const prepared=context.prepareBattle(run,encounter);
    const built=buildAssaultBattleInput(prepared,context);
    assert.equal(prepared.encounter.id,encounter.id);
    assert.deepEqual(prepared.field.routes,initial.routes);
    assert.ok(built.spawnSpecs.every(spawn=>Number.isInteger(spawn.routeIndex)&&spawn.routeIndex>=0&&spawn.routeIndex<built.battle.routes.length));
    assert.deepEqual(run.pieces.map(piece=>[piece.uid,piece.row,piece.col,piece.dir]),formation);
  }
});

test('manual summon relocation is validated, saved and removable through real run actions',()=>{
  const state=createRun({runId:'manual-summon',seed:72,directorId:context.design.system.directors[0].id},context);
  const body=context.catalog.bodies.char_249_mlyss;
  const owner={...structuredClone(state.pieces[0]),charId:body.charId,purchaseCharId:body.purchaseCharId,uid:'manual-owner',moduleChoices:{},summonPresets:[]};
  state.pieces=[owner];
  const tile=[...context.fieldFor(state).normalizedDeployMap.keys()].map(key=>key.split(',').map(Number)).find(([r,c])=>context.canPlace(state,owner,r,c));
  [owner.row,owner.col]=tile;
  const tokenId='token_10030_mlyss_wtrman',view=context.view(state);
  const [row,col]=view.pieces[0].summonLegalTiles[tokenId][0];
  const placed=applyAction(state,{type:'setSummonPreset',uid:owner.uid,index:0,tokenId,row,col,dir:'N',opId:'summon:place',expectedRevision:state.revision},context).state;
  assert.equal(placed.pieces[0].summonPresets[0].dir,'N');
  const removed=applyAction(placed,{type:'setSummonPreset',uid:owner.uid,index:0,remove:true,opId:'summon:remove',expectedRevision:placed.revision},context).state;
  assert.equal(removed.pieces[0].summonPresets[0],null);
});
