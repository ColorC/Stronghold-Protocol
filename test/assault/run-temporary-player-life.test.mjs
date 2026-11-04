import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRun,applyAction,auditRun} from '../../shared/assault/run.js';
import {pieceFromBody} from '../../shared/assault/inventory.js';
import {applyTemporaryMaxLife,validateTemporaryMaxLife} from '../../shared/assault/temporary-player-enhancements.js';
import {applyRunLifecycleEvent} from '../../shared/assault/run-lifecycle.js';
import {createAssaultStore} from '../../server/modes/assault/store.js';

const json=name=>JSON.parse(readFileSync(new URL(`../../data/assault-design/${name}.json`,import.meta.url),'utf8'));
const system=json('system'),events=json('events'),collectibles=json('collectibles'),encounters=json('encounters'),forms=json('forms');
const roster=['support','assault','ranged'].flatMap(group=>json(`roster-${group}`).operators),operators=Object.fromEntries(roster.map(entry=>[entry.charId,structuredClone(entry)]));
operators.char_002_amiya.extraForms=forms.forms.map(entry=>entry.charId);
const bodies=Object.fromEntries(roster.map(entry=>[entry.charId,{charId:entry.charId,purchaseCharId:entry.charId,name:entry.name,profession:entry.profession,price:entry.price,defaultModuleId:entry.defaultModuleId??null,modulePlans:entry.modulePlans,baseStats:{maxHp:1000},starStats:Array.from({length:4},(_,i)=>({star:i+1,stats:{maxHp:1000*(i+1),atk:100}}))}]));
for(const entry of forms.forms)bodies[entry.charId]={charId:entry.charId,purchaseCharId:forms.family.charId,name:entry.name,profession:entry.profession,price:entry.price,defaultModuleId:entry.defaultModuleId??null,modulePlans:entry.modulePlans,baseStats:{maxHp:1000},starStats:Array.from({length:4},(_,i)=>({star:i+1,stats:{maxHp:1000*(i+1),atk:100}}))};
const baseCtx={catalog:{operators,bodies},design:{system,events,collectibles,encounters}};
const effect=(mode,amountByStar,durationType)=>({kind:'playerEnhance',stat:'maxLife',mode,amountByStar,durationType});
const rule=(id,event,fx)=>({id,owner:{kind:'skill',id:'life-fixture'},event,effects:[fx]});
const context=rules=>({...baseCtx,design:{...baseCtx.design,system:{...system,runLifecycleRules:rules}}});
const makeRun=ctx=>createRun({runId:'123e4567-e89b-42d3-a456-426614174000',seed:711,directorId:system.directors[0].id},ctx);
const apply=(state,ctx,type,params={},opId=type)=>applyAction(state,{type,...params,opId,expectedRevision:state.revision},ctx);
const shop=(state,offer=true)=>{state.phase='shop';state.shop={id:'fixture-shop',refreshCost:2,refreshCount:0,slots:offer?[{slotId:'fixture-offer',purchaseCharId:'char_127_estell',charId:'char_127_estell',star:1,requiredCopies:1,price:1}]:[]};};

test('player max-life rules use permanent base, real buy/sell/clock actions, expiry order, and never heal on cap gain',{timeout:30000},()=>{
 const ctx=context([
  rule('buy-cap','buy',effect('flat',[20,20,20,20],'UntilEndOfDay')),
  rule('sell-cap','sell',effect('percent',[0.1,0.1,0.1,0.1],'UntilEndOfHour')),
  rule('sell-life','sell',{kind:'currency',currency:'life',amountByStar:[100,100,100,100]}),
  rule('hour-life','hourStarted',{kind:'currency',currency:'life',amountByStar:[100,100,100,100]}),
  rule('daily-cap','dayStarted',effect('flat',[5,5,5,5],'UntilEndOfDay')),
 ]);
 const state=makeRun(ctx);state.skillRanks={'life-fixture':1};state.maxLife=100;state.life=100;shop(state);
 const buyAction={type:'buy',slotId:'fixture-offer',opId:'life-buy',expectedRevision:state.revision};const bought=applyAction(state,buyAction,ctx).state;
 assert.equal(bought.maxLife,120);assert.equal(bought.life,100,'raising the cap does not restore life');
 assert.strictEqual(applyAction(bought,buyAction,ctx).state,bought,'replaying the same action is idempotent');
 const beforeOpConflict=structuredClone(bought);
 assert.throws(()=>applyAction(bought,{...buyAction,slotId:'different',expectedRevision:bought.revision},ctx),{code:'OP_ID_CONFLICT'});
 assert.deepEqual(bought,beforeOpConflict,'conflicting operation replay leaves the source run unchanged');
 const owner=bought.pieces.find(piece=>piece.uid===bought.pieces[0].uid);shop(bought,false);
 const sold=apply(bought,ctx,'sell',{uid:owner.uid},'life-sell').state;
 assert.equal(sold.maxLife,130,'percent uses the permanent base 100, not the already increased 120');
 assert.equal(sold.life,130,'the independent life currency effect can fill the temporary cap');
 assert.deepEqual(sold.temporaryMaxLife.map(record=>record.amount),[20,10]);
 const same=sold.temporaryMaxLife[0],before=structuredClone(sold);
 assert.throws(()=>applyTemporaryMaxLife(sold,{...same,amount:same.amount+1}),{code:'INVALID_TEMPORARY_MAX_LIFE'});
 assert.deepEqual(sold,before,'a conflicting source ID rejects atomically');
 for(let hour=1;hour<=6;hour++){
  if(sold.day!==1||sold.hour!==hour)assert.fail(`unexpected clock ${sold.day}:${sold.hour}`);
  shop(sold,false);const advanced=apply(sold,ctx,'finishShop',{},`finish-${hour}`);Object.assign(sold,advanced.state);
  if(hour===1){assert.equal(sold.hour,2);assert.equal(sold.maxLife,120);assert.equal(sold.life,120,'expiry clamps life to the remaining cap before hourly restoration');}
 }
 assert.equal(sold.day,2);assert.equal(sold.hour,1);
 assert.equal(sold.maxLife,105,'old day records expire before the next day grant');
 assert.equal(sold.life,105);
 assert.equal(sold.maxLifeBase,100,'the permanent base remains for later grants');
 assert.deepEqual(sold.temporaryMaxLife.map(record=>record.amount),[5]);
 assert.deepEqual(sold.history.filter(entry=>entry.kind==='runLifecycleTriggered'&&entry.target==='player').map(entry=>[entry.event,entry.amount]),[['buy',20],['sell',10],['dayStarted',5]]);
 assert.ok(sold.history.some(entry=>entry.kind==='runLifecycleTriggered'&&entry.target==='life'&&entry.event==='sell'));
 const playerHistory=sold.history.filter(entry=>entry.kind==='runLifecycleTriggered'&&entry.target==='player').length;
 applyRunLifecycleEvent(sold,ctx,'dayStarted',{eventKey:'day:2:started'});
 assert.equal(sold.history.filter(entry=>entry.kind==='runLifecycleTriggered'&&entry.target==='player').length,playerHistory,'claimKey prevents duplicate lifecycle grants');
 assert.equal(auditRun(sold,ctx).events,events.events.length);
});

test('temporary max-life schema accepts old zero-cap saves and rejects malformed optional records in helper and store validation',{timeout:30000},()=>{
 const ctx=context([]),store=createAssaultStore({root:'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/assault',context:ctx});
 const legacy=makeRun(ctx);legacy.maxLife=0;legacy.life=0;delete legacy.maxLifeBase;delete legacy.temporaryMaxLife;
 assert.equal(validateTemporaryMaxLife(legacy),legacy);assert.doesNotThrow(()=>store.validate(legacy));
 const valid=makeRun(ctx);valid.maxLifeBase=valid.maxLife;valid.temporaryMaxLife=[];assert.doesNotThrow(()=>store.validate(valid));
 for(const records of [null,[{id:'',amount:1,expiresAtHour:1}],[{id:'nan',amount:NaN,expiresAtHour:1}],[{id:'x',amount:0,expiresAtHour:1}],[{id:'x',amount:Number.MAX_SAFE_INTEGER+1,expiresAtHour:1}],[{id:'x',amount:1,expiresAtHour:-1}],[{id:'expired',amount:1,expiresAtHour:0}],[{id:'x',amount:1,expiresAtHour:1},{id:'x',amount:1,expiresAtHour:2}]]){
  const invalid=structuredClone(valid);invalid.temporaryMaxLife=records;invalid.maxLife=invalid.maxLifeBase;
  assert.throws(()=>validateTemporaryMaxLife(invalid),{code:'INVALID_TEMPORARY_MAX_LIFE'});
 assert.throws(()=>store.validate(invalid),{code:'INVALID_TEMPORARY_MAX_LIFE'});
 }
 const legacyZero={day:1,hour:1,life:0,maxLife:0};assert.equal(validateTemporaryMaxLife(legacyZero),legacyZero);assert.doesNotThrow(()=>store.validate({...legacyZero,...makeRun(ctx),life:0,maxLife:0}));
 const noBase={day:1,hour:1,life:6,maxLife:6,temporaryMaxLife:[{id:'x',amount:1,expiresAtHour:1}]};
 assert.throws(()=>validateTemporaryMaxLife(noBase),{code:'INVALID_TEMPORARY_MAX_LIFE'});
 const unknownField={day:1,hour:1,life:6,maxLife:6,maxLifeBase:5,temporaryMaxLife:[{id:'x',amount:1,expiresAtHour:1,mode:'flat'}]};
 assert.throws(()=>validateTemporaryMaxLife(unknownField),{code:'INVALID_TEMPORARY_MAX_LIFE'});
 const overflow={day:1,hour:1,life:Number.MAX_SAFE_INTEGER,maxLife:Number.MAX_SAFE_INTEGER,maxLifeBase:Number.MAX_SAFE_INTEGER-1,temporaryMaxLife:[{id:'x',amount:2,expiresAtHour:1}]};
 assert.throws(()=>validateTemporaryMaxLife(overflow),{code:'INVALID_TEMPORARY_MAX_LIFE'});
 const state={day:1,hour:1,life:0,maxLife:0};const grant={id:'rounding-zero',amount:1,expiresAtHour:1};
 assert.equal(applyTemporaryMaxLife(state,grant),true);const first=structuredClone(state);
 assert.equal(applyTemporaryMaxLife(state,grant),false);assert.deepEqual(state,first,'same record ID and content is an idempotent replay');
 assert.throws(()=>applyTemporaryMaxLife(state,{...grant,amount:2}),{code:'INVALID_TEMPORARY_MAX_LIFE'});assert.deepEqual(state,first,'conflicting record replay leaves the source state unchanged');
 assert.throws(()=>applyTemporaryMaxLife(state,{id:'expired',amount:1,expiresAtHour:0}),{code:'INVALID_TEMPORARY_MAX_LIFE'});assert.deepEqual(state,first,'expired grants reject atomically');
});

test('successive percent grants round against permanent base and a late-day grant expires at absolute hour six',{timeout:30000},()=>{
 const pctCtx=context([
  rule('buy-percent','buy',effect('percent',[0.3,0.3,0.3,0.3],'UntilEndOfDay')),
  rule('sell-percent','sell',effect('percent',[0.3,0.3,0.3,0.3],'UntilEndOfHour')),
 ]);
 const state=makeRun(pctCtx);state.skillRanks={'life-fixture':1};state.maxLife=20;state.life=20;shop(state);
 const bought=apply(state,pctCtx,'buy',{slotId:'fixture-offer'},'percent-base-buy').state;
 assert.equal(bought.maxLife,26);assert.equal(bought.temporaryMaxLife[0].amount,6);
 shop(bought,false);const sold=apply(bought,pctCtx,'sell',{uid:bought.pieces[0].uid},'percent-base-sell').state;
 assert.equal(sold.maxLife,32,'second 30% is rounded from base 20 (6), not temporary cap 26 (8)');
 assert.deepEqual(sold.temporaryMaxLife.map(record=>record.amount),[6,6]);

 const lateCtx=context([rule('late-day-grant','buy',effect('flat',[7,7,7,7],'UntilEndOfDay'))]);
 const late=makeRun(lateCtx);late.skillRanks={'life-fixture':1};late.day=1;late.hour=4;shop(late);
 let stateAtHour4=apply(late,lateCtx,'buy',{slotId:'fixture-offer'},'late-day-buy').state;
 assert.equal(stateAtHour4.hour,4);assert.equal(stateAtHour4.temporaryMaxLife[0].expiresAtHour,6);
 for(const hour of [4,5]){shop(stateAtHour4,false);stateAtHour4=apply(stateAtHour4,lateCtx,'finishShop',{},`late-day-hour${hour+1}`).state;assert.equal(stateAtHour4.maxLife,system.run.life+7);}
 shop(stateAtHour4,false);const rollover=apply(stateAtHour4,lateCtx,'finishShop',{},'late-day-rollover').state;
 assert.equal(rollover.day,2);assert.equal(rollover.hour,1);assert.equal(rollover.maxLife,system.run.life);assert.deepEqual(rollover.temporaryMaxLife,[]);
});

test('invalid player enhancement duration rejects a real action without modifying its source state',{timeout:30000},()=>{
 const liveCtx=context([]),badCtx=context([rule('bad-duration','buy',effect('flat',[2,2,2,2],'UntilEndOfBattle'))]);
 const state=makeRun(liveCtx);state.skillRanks={'life-fixture':1};shop(state);const before=structuredClone(state);
 assert.throws(()=>apply(state,badCtx,'buy',{slotId:'fixture-offer'},'invalid-duration-buy'),{code:'INVALID_RUN_LIFECYCLE_RULE'});
 assert.deepEqual(state,before,'validation on the working copy leaves the original run untouched');
});
