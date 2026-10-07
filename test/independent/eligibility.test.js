import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { inheritanceQualification, attachmentAccepted, nativeFactions, tavernFactions, nativeBodyStats } from '../../shared/independentRules.js';

const catalog=getCatalog();
// a piece as gained: the twelve permission operators wear their 交接凭证 (session.js gainChess)
const piece=(name)=>{const op=Object.values(catalog.operators).find(x=>!x.elite && x.name===name);return {chessId:op.chessId,elite:false,skillIndex:0,moduleId:'none',equipment:op.permitGearId?[{uid:'k',id:op.permitGearId,quantity:1,elite:false,state:{}}]:[]};};

test('inheritance accepts the 交接凭证 of either side while respecting tier, faction and profession',()=>{
  assert.equal(inheritanceQualification(piece('角峰'),piece('送葬人'),catalog).allowed,true);
  assert.equal(inheritanceQualification(piece('宴'),piece('崖心'),catalog).allowed,true);
  assert.equal(inheritanceQualification(piece('幽灵鲨'),piece('泡泡'),catalog).allowed,false);
  assert.equal(inheritanceQualification(piece('幽灵鲨'),piece('乌尔比安'),catalog).allowed,true);
  assert.equal(inheritanceQualification(piece('古米'),piece('星熊'),catalog).allowed,false);
});

test('the worn 交接凭证 decides, not who the operator is',()=>{
  const bare=piece('角峰');bare.equipment=[];
  assert.equal(inheritanceQualification(bare,piece('送葬人'),catalog).allowed,false);
  const carrier=piece('休谟斯');carrier.equipment=piece('角峰').equipment;
  const q=inheritanceQualification(carrier,piece('送葬人'),catalog);
  assert.equal(q.allowed,true);assert.equal(q.give.id,'permit-north-handover-order');assert.equal(q.receive,null);
});

test('identity gear can add a tavern tag without forging native inheritance eligibility',()=>{
  const receiver=piece('雷蛇');
  const gear=Object.values(catalog.equipment).find(x=>x.mechanism==='identityTag');
  receiver.equipment=[{id:gear.id,state:{faction:'阿戈尔'}}];
  assert.ok(tavernFactions(receiver,catalog).includes('阿戈尔'));
  assert.ok(!nativeFactions(receiver,catalog).includes('阿戈尔'));
  assert.equal(inheritanceQualification(piece('幽灵鲨'),receiver,catalog).allowed,false);
});

test('attached eligibility follows selected ammo skill and original abilities',()=>{
  const insider=piece('隐现');
  assert.equal(attachmentAccepted(catalog.attachments['ammo-recovery'],insider,catalog),true);
  assert.equal(attachmentAccepted(catalog.attachments['medical-readiness'],piece('调香师'),catalog),true);
  assert.equal(attachmentAccepted(catalog.attachments['medical-readiness'],piece('古米'),catalog),false);
  assert.equal(attachmentAccepted(catalog.attachments['cold-region-log'],piece('灵知'),catalog),true);
  assert.equal(attachmentAccepted(catalog.attachments['cold-region-log'],piece('角峰'),catalog),false);
});

test('body loss applies once to native attack and life, leaving equipment out of the calculation',()=>{
  const body=piece('水月');
  const base=nativeBodyStats(body,catalog);
  body.bodyPenaltyApplied=true;
  const lost=nativeBodyStats(body,catalog);
  assert.equal(lost.atk,Math.floor(base.atk*0.8));
  assert.equal(lost.maxHp,Math.floor(base.maxHp*0.8));
  body.equipment=[{id:'precision',quantity:99,state:{}}];
  assert.deepEqual(nativeBodyStats(body,catalog),lost);
});
