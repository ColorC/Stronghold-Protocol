import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, validateSession } from '../../server/modes/resonance/session.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { getSeasonCampaignCatalog } from '../../tools/resonance/balance-campaign.mjs';
import { RESONANCE_EQUIP_SLOTS, equipRefusal } from '../../public/js/resonance/equipmentSlots.js';

const catalog=getSeasonCampaignCatalog(3);
const display=resonanceDisplayCatalog(catalog,null);
function act(state,action){
  const result=applyAction(state,action,{catalog});
  assert.equal(result.ok,true,result.error);
  const valid=validateSession(result.state,{catalog});assert.equal(valid.ok,true,JSON.stringify(valid.errors));
  return result.state;
}
const ids=(rows)=>rows.map((row)=>row.itemId);

test('an operator carries three items; a fourth is refused without loss, a matching component still combines, selling returns all',()=>{
  assert.equal(RESONANCE_EQUIP_SLOTS,3);
  const created=createSession({seed:3,catalog});assert.equal(created.ok,true,created.error);
  let state=created.state;const pieceUid=state.pieces[0].uid,name=catalog.operators[state.pieces[0].operatorId].name;
  state.inventory=['giantSlayer','lifeSpring','blade','hurricane'].map((itemId)=>({uid:`i${state.nextUid++}`,itemId}));
  for(const item of state.inventory.slice(0,3))state=act(state,{type:'equip',itemUid:item.uid,pieceUid});
  let holder=state.pieces.find((piece)=>piece.uid===pieceUid);
  assert.deepEqual(ids(holder.equipment),['giantSlayer','lifeSpring','blade'],'the third item takes the third slot');

  assert.equal(equipRefusal(display,holder,'hurricane',name),`「${name}」的装备栏已满（3/3），可先合成或卸下装备`,'the client names the full operator');
  const before=structuredClone(state);
  const refused=applyAction(state,{type:'equip',itemUid:state.inventory[0].uid,pieceUid},{catalog});
  assert.equal(refused.ok,false);assert.equal(refused.error,'EQUIPMENT_CAPACITY');
  assert.deepEqual(state,before,'the refused 卡西米尔竞技旗 stays in the inventory');

  state.inventory.push({uid:`i${state.nextUid++}`,itemId:'bow'});
  assert.equal(equipRefusal(display,holder,'bow',name),null,'a matching component may still be dropped on a full operator');
  state=act(state,{type:'equip',itemUid:state.inventory[1].uid,pieceUid});
  holder=state.pieces.find((piece)=>piece.uid===pieceUid);
  assert.deepEqual(ids(holder.equipment),['giantSlayer','lifeSpring','rapidBlade'],'维式重锤 + 叙拉古正装 becomes 加速维式重锤 in its original slot');
  assert.match(equipRefusal(display,holder,'giantSlayer',name),/已携带铳骑之威，每名干员限1件/,'one copy per operator');

  const sold=act(state,{type:'sell',pieceUid});
  assert.deepEqual(ids(sold.inventory).sort(),['giantSlayer','hurricane','lifeSpring','rapidBlade'].sort(),'selling returns all three carried items');
});
