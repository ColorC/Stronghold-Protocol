import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, validateSession } from '../../server/modes/resonance/session.js';
import { getSeasonCampaignCatalog } from '../../tools/resonance/balance-campaign.mjs';

const catalog=getSeasonCampaignCatalog(3);
const recipe=(a,b)=>catalog.recipes.find(row=>row.parts.includes(a)&&row.parts.includes(b)&&((a!==b)||row.parts.every(id=>id===a)));
function fresh() {
  const result=createSession({seed:3,catalog});
  assert.equal(result.ok,true,result.error);
  return result.state;
}
function item(state,itemId) { return {uid:`i${state.nextUid++}`,itemId}; }
function held(state,piece,ids) { piece.equipment=ids.map(id=>item(state,id)); return piece.equipment; }
function inventory(state,ids) { state.inventory=ids.map(id=>item(state,id)); return state.inventory; }
function valid(state,rules=catalog) { const result=validateSession(state,{catalog:rules});assert.equal(result.ok,true,JSON.stringify(result.errors)); }
function act(state,action,rules=catalog) {
  valid(state,rules);
  const result=applyAction(state,action,{catalog:rules});
  assert.equal(result.ok,true,result.error);
  valid(result.state,rules);
  return result;
}
function reject(state,action,error,rules=catalog) {
  valid(state,rules);const before=structuredClone(state);
  const result=applyAction(state,action,{catalog:rules});
  assert.equal(result.ok,false);assert.equal(result.error,error);
  assert.deepEqual(state,before);assert.deepEqual(result.state,before);
  assert.deepEqual(result.events,[]);
}
function equip(state,uid,pieceUid=state.pieces[0].uid,rules=catalog) { return act(state,{type:'equip',itemUid:uid,pieceUid},rules); }
function targetOffer(state,operatorId) {
  const offer=state.shop.offers[0];
  if(offer.operatorId)state.poolRemaining[offer.operatorId]++;
  state.poolRemaining[operatorId]--;
  Object.assign(offer,{operatorId,cost:catalog.operators[operatorId].cost});
  return offer.uid;
}
function merger() {
  let state=fresh();const keepUid=state.pieces[0].uid,operatorId=state.pieces[0].operatorId;
  const bought=act(state,{type:'buy',offerUid:targetOffer(state,operatorId),mergeTargetUid:keepUid});
  state=bought.state;
  return {state,keep:state.pieces.find(row=>row.uid===keepUid),other:state.pieces.find(row=>row.operatorId===operatorId&&row.uid!==keepUid),operatorId};
}
function merge(state,keep) { return act(state,{type:'buy',offerUid:targetOffer(state,keep.operatorId),mergeTargetUid:keep.uid}); }

test('a component equipped into an empty slot keeps its UID and charges no resources',()=>{
  const state=fresh(),piece=state.pieces[0],[input]=inventory(state,['blade']);
  const result=equip(state,input.uid);
  assert.deepEqual(result.state.pieces[0].equipment,[input]);assert.equal(result.state.inventory.length,0);
  assert.equal(result.state.gold,state.gold);assert.equal(result.state.nextUid,state.nextUid);
  assert.equal(result.events[0].type,'item-equipped');
});

test('equip combines with the earliest compatible component in its original slot',()=>{
  const state=fresh(),piece=state.pieces[0];
  const [first,second]=held(state,piece,['plate','blade']);const [input]=inventory(state,['bow']);
  const result=equip(state,input.uid),gear=result.state.pieces[0].equipment,event=result.events[0];
  assert.equal(gear.length,2);assert.equal(gear[0].itemId,recipe('plate','bow').resultId);
  assert.deepEqual(gear[1],second);assert.notEqual(gear[0].uid,first.uid);assert.notEqual(gear[0].uid,input.uid);
  assert.deepEqual(event,{type:'equipment-combined',itemIds:['plate','bow'],itemUids:[first.uid,input.uid],resultId:gear[0].itemId,uid:gear[0].uid,pieceUid:piece.uid});
  assert.equal(result.state.inventory.length,0);
});

test('a full three-slot piece admits a matching component and preserves neighbouring slots',()=>{
  const state=fresh(),piece=state.pieces[0];
  const [before,,after]=held(state,piece,['giantSlayer','blade','transfer_sui']);const [input]=inventory(state,['bow']);
  const result=equip(state,input.uid),gear=result.state.pieces[0].equipment;
  assert.equal(gear.length,3);assert.deepEqual(gear[0],before);assert.equal(gear[1].itemId,'rapidBlade');assert.deepEqual(gear[2],after);
});

test('a full piece without a component pair rejects equip without consuming either item',()=>{
  const state=fresh(),piece=state.pieces[0];held(state,piece,['giantSlayer','spellblade','transfer_sui']);
  const [input]=inventory(state,['bow']);reject(state,{type:'equip',itemUid:input.uid,pieceUid:piece.uid},'EQUIPMENT_CAPACITY');
});

test('unique result and direct unique-item conflicts reject before consuming materials or allocating UID',()=>{
  const state=fresh(),piece=state.pieces[0];held(state,piece,['rapidBlade','blade']);
  const [input,completed]=inventory(state,['bow','rapidBlade']);
  reject(state,{type:'equip',itemUid:input.uid,pieceUid:piece.uid},'UNIQUE_EQUIPMENT_CONFLICT');
  reject(state,{type:'equip',itemUid:completed.uid,pieceUid:piece.uid},'UNIQUE_EQUIPMENT_CONFLICT');
});

test('completed equipment and emblems cannot be recipe inputs even in a malformed recipe table',()=>{
  for(const nonComponent of ['rapidBlade','transfer_sui']) {
    const state=fresh(),piece=state.pieces[0];const [existing]=held(state,piece,[nonComponent]);const [input]=inventory(state,['bow']);
    const rules={...catalog,recipes:[{parts:[nonComponent,'bow'],resultId:'giantSlayer'},...catalog.recipes]};
    const result=equip(state,input.uid,piece.uid,rules);
    assert.deepEqual(result.state.pieces[0].equipment,[existing,input]);assert.equal(result.events[0].type,'item-equipped');
    reject(state,{type:'combine',itemUids:[existing.uid,input.uid]},'RECIPE_NOT_FOUND',rules);
  }
});

test('explicit combine remains symmetric, keeps the owned component slot and checks unique results',()=>{
  const state=fresh(),piece=state.pieces[0];const [before,material,after]=held(state,piece,['giantSlayer','blade','transfer_sui']);
  const [input]=inventory(state,['bow']);const result=act(state,{type:'combine',itemUids:[input.uid,material.uid]});
  assert.deepEqual(result.state.pieces[0].equipment.map(row=>row.itemId),[before.itemId,'rapidBlade',after.itemId]);
  assert.equal(result.events[0].pieceUid,piece.uid);
  const conflict=fresh(),target=conflict.pieces[0];const [,part]=held(conflict,target,['rapidBlade','blade']);const [bow]=inventory(conflict,['bow']);
  reject(conflict,{type:'combine',itemUids:[bow.uid,part.uid]},'UNIQUE_EQUIPMENT_CONFLICT');
});

test('buy-triggered promotion combines materials across copies and reports both consumed UIDs',()=>{
  const {state,keep,other}=merger();const [a]=held(state,keep,['blade']),[b]=held(state,other,['bow']);
  const gold=state.gold,result=merge(state,keep),promoted=result.state.pieces.find(row=>row.uid===keep.uid);
  assert.equal(promoted.star,2);assert.equal(promoted.equipment.length,1);assert.equal(promoted.equipment[0].itemId,'rapidBlade');
  assert.equal(result.state.gold,gold-1);assert.equal(result.state.pieces.some(row=>row.uid===other.uid),false);
  const event=result.events.find(row=>row.type==='equipment-combined');assert.deepEqual(event.itemUids,[a.uid,b.uid]);assert.equal(event.pieceUid,keep.uid);
});

test('promotion returns unique conflicts and a blocked recipe material to inventory without losing UIDs',()=>{
  const {state,keep,other}=merger();const [existing,blade]=held(state,keep,['rapidBlade','blade']);
  const [duplicate,bow]=held(state,other,['rapidBlade','bow']);inventory(state,[]);
  const result=merge(state,keep),promoted=result.state.pieces.find(row=>row.uid===keep.uid);
  assert.deepEqual(promoted.equipment,[existing,blade]);assert.deepEqual(result.state.inventory,[duplicate,bow]);
  assert.equal(result.events.find(row=>row.type==='operator-merged').equipmentReturned,2);
  assert.equal(result.events.some(row=>row.type==='equipment-combined'),false);
});

test('promotion admits compatible materials with a full inventory but rejects genuine overflow atomically',()=>{
  const ready=merger();held(ready.state,ready.keep,['blade']);held(ready.state,ready.other,['bow']);inventory(ready.state,Array(20).fill('blade'));
  const merged=merge(ready.state,ready.keep);assert.equal(merged.state.inventory.length,20);assert.equal(merged.state.pieces.find(row=>row.uid===ready.keep.uid).equipment[0].itemId,'rapidBlade');
  const full=merger();held(full.state,full.keep,['giantSlayer','spellblade','rapidBlade']);
  const [overflow]=held(full.state,full.other,['armorAxe']);inventory(full.state,Array(20).fill('blade'));
  const offerUid=targetOffer(full.state,full.operatorId);
  reject(full.state,{type:'buy',offerUid,mergeTargetUid:full.keep.uid},'INVENTORY_CAPACITY');
  assert.equal(full.other.equipment[0].uid,overflow.uid);
});

test('promotion returns genuine slot overflow intact when inventory has room',()=>{
  const {state,keep,other}=merger();const retained=held(state,keep,['giantSlayer','spellblade','rapidBlade']);
  const overflow=held(state,other,['armorAxe','vampBlade']);inventory(state,[]);
  const result=merge(state,keep);assert.deepEqual(result.state.pieces.find(row=>row.uid===keep.uid).equipment,retained);assert.deepEqual(result.state.inventory,overflow);
});
