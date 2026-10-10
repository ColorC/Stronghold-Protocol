import test from 'node:test';
import assert from 'node:assert/strict';
import { actionType, classifyRequest, matchesBuyIntent, parseArgs, validatePurchaseDelta, validateSourceReceipt } from '../../tools/resonance/native-panel-buy-check.mjs';

const sid='84eeb410-749d-4cc7-a25e-cd5d60c16ae9';

test('checker accepts only the assigned existing SID and explicit evidence resume',()=>{
 assert.deepEqual(parseArgs(['--session',sid]),{session:sid,resumeEvidence:false});
 assert.deepEqual(parseArgs(['--session',sid,'--resume-evidence']),{session:sid,resumeEvidence:true});
 assert.throws(()=>parseArgs(['--session','new-session']));
 assert.throws(()=>parseArgs(['--session',sid,'--session',sid]));
 assert.throws(()=>parseArgs(['--session',sid,'--resume-evidence','--resume-evidence']));
 assert.throws(()=>parseArgs(['--session',sid,'--new-session']));
});

test('source UI receipt must be passed and bound to same SID',()=>{
 assert.equal(validateSourceReceipt({status:'passed',sessionId:sid,creates:1,fights:1},sid),true);
 assert.equal(validateSourceReceipt({status:'failed',sessionId:sid,creates:1,fights:1},sid),false);
 assert.equal(validateSourceReceipt({status:'passed',sessionId:'other',creates:1,fights:1},sid),false);
});

test('firewall permits readonly, exact admission and one wrapped buy only',()=>{
 assert.deepEqual(classifyRequest({method:'GET',pathname:'/resonance/api/sessions/x'}),{allowed:true,kind:'readonly'});
 assert.deepEqual(classifyRequest({method:'POST',pathname:'/resonance/api/admission'}),{allowed:true,kind:'admission'});
 assert.deepEqual(classifyRequest({method:'POST',pathname:`/resonance/api/sessions/${sid}/actions`,body:JSON.stringify({expectedRevision:4,action:{type:'buy',offerUid:'offer-x'}})}),{allowed:true,kind:'single-buy'});
 for(const type of ['fight','refresh','buyXp','sell','equip']) assert.equal(classifyRequest({method:'POST',pathname:`/resonance/api/sessions/${sid}/actions`,body:JSON.stringify({action:{type}})}).allowed,false,type);
 assert.equal(classifyRequest({method:'POST',pathname:`/resonance/api/sessions/${sid}/actions`,body:'{"type":"buy"}',buyRequests:1}).allowed,false);
 assert.equal(classifyRequest({method:'POST',pathname:`/resonance/api/sessions/${sid}/actions`,body:'{"action":{"type":"buy"}}',allowBuy:false}).allowed,false);
});

test('firewall blocks all non-readonly verbs, near-paths, creation, and admission lookalikes',()=>{
 const path=`/resonance/api/sessions/${sid}/actions`;
 for(const method of ['PUT','PATCH','DELETE','OPTIONS','TRACE']) assert.equal(classifyRequest({method,pathname:path}).allowed,false,method);
 for(const pathname of ['/resonance/api/admissions','/resonance/api/admission/extra','/resonance/api/sessions/','/resonance/api/sessions/x/actions/extra']) assert.equal(classifyRequest({method:'POST',pathname,body:'{"action":{"type":"buy"}}'}).allowed,false,pathname);
});

test('action type parses wrapped and bare request bodies without broadening methods',()=>{
 assert.equal(actionType('{"expectedRevision":1,"action":{"type":"buy"}}'),'buy');
 assert.equal(actionType('{"type":"buy"}'),'buy');
 assert.equal(actionType('{broken'),null);
 assert.equal(classifyRequest({method:'GET',pathname:`/resonance/api/sessions/${sid}/actions`,body:'{"type":"buy"}'}).kind,'readonly');
});

test('single-buy intent is bound to exact session, action, and offer UID',()=>{
 const pathname=`/resonance/api/sessions/${sid}/actions`;
 const body=JSON.stringify({expectedRevision:9,action:{type:'buy',offerUid:'o14'}});
 assert.equal(matchesBuyIntent({pathname,body,sessionId:sid,offerUid:'o14'}),true);
 assert.equal(matchesBuyIntent({pathname,body,sessionId:sid,offerUid:'o17'}),false);
 assert.equal(matchesBuyIntent({pathname:`/resonance/api/sessions/other/actions`,body,sessionId:sid,offerUid:'o14'}),false);
 assert.equal(matchesBuyIntent({pathname,body:JSON.stringify({action:{type:'fight',offerUid:'o14'}}),sessionId:sid,offerUid:'o14'}),false);
});

test('authoritative purchase delta accounts for event, gold, pieces, offers, and pool without merges',()=>{
 const intent={operatorId:'op-new',offerUid:'offer-old',price:2,goldBefore:9,piecesBefore:3,activeOffersBefore:5,offersTotalBefore:5,poolBefore:29,boughtEventsBefore:1};
 const state={revision:10,gold:7,pieces:[{operatorId:'op-a'},{operatorId:'op-b'},{operatorId:'op-c'},{operatorId:'op-new'}],poolRemaining:{'op-new':28},shop:{offers:[{uid:'offer-1',operatorId:'op-a'},{uid:'offer-2',operatorId:'op-b'},{uid:'offer-3',operatorId:'op-c'},{uid:'offer-4',operatorId:'op-d'},{uid:'replacement',operatorId:null,cost:null}]},history:[{type:'operator-bought',operatorId:'old',cost:1},{type:'operator-bought',operatorId:'op-new',cost:2}]};
 const result=validatePurchaseDelta(intent,state);
 assert.equal(result.passed,true);
 assert.deepEqual(Object.values(result.checks),[true,true,true,true,true,true,true]);
 const merged={...state,pieces:[{operatorId:'op-a'},{operatorId:'op-b'},{operatorId:'op-c'}]};
 assert.equal(validatePurchaseDelta(intent,merged).checks.onePieceAdded,false);
 const unconsumed={...state,shop:{...state.shop,offers:[...state.shop.offers.slice(0,4),{uid:'offer-old',operatorId:'op-new'}]}};
 assert.equal(validatePurchaseDelta(intent,unconsumed).checks.originalOfferConsumed,false);
});
