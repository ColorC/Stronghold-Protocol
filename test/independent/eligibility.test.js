import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { inheritanceQualification, attachmentAccepted, nativeFactions, tavernFactions, nativeBodyStats } from '../../shared/independentRules.js';

const catalog=getCatalog();
const piece=(name)=>({chessId:Object.values(catalog.operators).find(op=>!op.elite && op.name===name).chessId,elite:false,skillIndex:0,moduleId:'none',equipment:[]});

test('inheritance accepts either native permission while respecting tier, faction and profession',()=>{
  assert.equal(inheritanceQualification(piece('角峰'),piece('送葬人'),catalog).allowed,true);
  assert.equal(inheritanceQualification(piece('休谟斯'),piece('宴'),catalog).allowed,true);
  assert.equal(inheritanceQualification(piece('幽灵鲨'),piece('泡泡'),catalog).allowed,false);
  assert.equal(inheritanceQualification(piece('幽灵鲨'),piece('乌尔比安'),catalog).allowed,true);
  assert.equal(inheritanceQualification(piece('古米'),piece('星熊'),catalog).allowed,false);
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
