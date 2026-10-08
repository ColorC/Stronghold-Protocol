import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';
import { inheritanceQualification } from '../../shared/independentRules.js';
import { runNativeHook } from '../../server/modes/independent/native.js';

const data=getData();
const design=structuredClone(data['independent-design']);
// This retired source-card record is frozen from the pre-Warband Git design fixture; it is not the current 101-piece pool.
const historicalPermit=JSON.parse(readFileSync(new URL('./fixtures/pre-warband-permit.json',import.meta.url),'utf8'));

test('legacy permit records stay available, autoGrant false suppresses new grants and source-card references survive',()=>{
  const old=structuredClone(historicalPermit.operator.inheritance),candidate=structuredClone(design);
  const source=candidate.operators.find(x=>x.chessId===historicalPermit.operator.chessId);
  candidate.rules.activeRosterIds=[...new Set([...(candidate.rules.activeRosterIds||[]),source.chessId])];
  const edited=candidate.operators.find(x=>x.chessId===source.chessId);
  edited.inheritance={...old,autoGrant:false,sourceRefs:[{game:'original',card:'controlled-fixture'}],limit:'继承伙伴及被继承条件'};
  const catalog=getCatalog(data,candidate),op=catalog.operators[source.chessId],id='permit-north-handover-order';
  assert.equal(catalog.equipment[id].available,true);assert.equal(catalog.equipment[id].legacyOnly,true);assert.equal(catalog.equipment[id].retired,true);
  assert.deepEqual(catalog.equipment[id].sourceRefs.cards,edited.inheritance.sourceRefs);
  assert.ok(!/继承/.test(catalog.equipment[id].effect));assert.equal(op.permitGearId,undefined);assert.equal(catalog.operators[op.eliteChessId].permitGearId,undefined);
  let state=createSession({seed:1,openFactions:null,data,catalog});state.funds=99;state.shop.slots[0]={kind:'chess',id:source.chessId,price:3,sold:false,equipment:[]};
  const purchase=applyAction(state,{type:'buy',slot:0},{data,catalog});assert.equal(purchase.ok,true,purchase.error?.message);
  assert.ok(!purchase.state.pieces[0].equipment.some(x=>x.id===id));
  const peer=Object.values(catalog.operators).find(x=>x.name==='送葬人'&&!x.elite);
  const holder={uid:'old-holder',chessId:source.chessId,equipment:[{uid:'old-permit',id,quantity:1,state:{}}]},partner={uid:'peer',chessId:peer.chessId,equipment:[]};
  assert.equal(inheritanceQualification(holder,partner,catalog).allowed,true);assert.equal(inheritanceQualification(partner,holder,catalog).allowed,true);
  purchase.state.pieces[0].equipment.push(holder.equipment[0]);
  assert.ok(viewSession(purchase.state,{data,catalog}).pieces[0].equipment.some(x=>x.uid==='old-permit'),'restoring a retired permit keeps the old asset');
  const missingFlag=structuredClone(design);delete missingFlag.operators.find(x=>x.chessId===source.chessId).inheritance.autoGrant;const legacy=getCatalog(data,missingFlag);assert.equal(legacy.operators[source.chessId].permitGearId,id,'missing autoGrant keeps old behavior');
});

test('forgeFactionTierPair operators counts three same-technology members, while default keeps one distinct tier',()=>{
  const run=countBy=>{
    const pieces=['maker','one','two'].map((uid,i)=>({uid,chessId:`test_${uid}`,row:10,col:3+i,equipment:[],nativeState:{}}));
    const effect={trigger:'prepEnd',behavior:'forgeFactionTierPair',params:{faction:'维多利亚',ids:['precision','vitality'],normal:1,elite:1,...(countBy?{countBy}: {})}};
    const operators=Object.fromEntries(pieces.map((p,i)=>[p.chessId,{tier:2,nativeFactionTags:['维多利亚'],nativeTrait:{effect:{prep:i===0?[effect]:[],combat:[]}}}]));
    const catalog={operators,config:{tavernFactions:['维多利亚']},badges:{precision:{},vitality:{}},equipment:{}};const outputs=[];
    runNativeHook({round:1,pieces,counters:{}},'prepEnd',{}, {catalog,grantEquipment:(_s,id,quantity)=>outputs.push({id,quantity})});return outputs;
  };
  assert.deepEqual(run('operators'),[{id:'precision',quantity:3},{id:'vitality',quantity:3}]);
  assert.deepEqual(run(),[{id:'precision',quantity:1},{id:'vitality',quantity:1}]);
});
