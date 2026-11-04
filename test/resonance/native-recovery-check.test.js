import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { classifyRequest, handleRequestEvent, instrumentRenderModule } from '../../tools/resonance/native-recovery-check.mjs';

test('request event keeps URL global intact and catches malformed request errors',async()=>{
 const receipt={requests:{admissions:0,gameplayMutations:0,violations:[]},instrumentation:{}};
 const calls=[];const req={url:()=>'/not a URL',method:()=> 'GET',abort:async reason=>calls.push(['abort',reason]),continue:async()=>calls.push(['continue'])};
 await handleRequestEvent(req,receipt);
 assert.equal(calls[0][0],'abort');assert.match(receipt.instrumentation.requestFailures[0],/Invalid URL/);
 assert.equal(classifyRequest('POST','/stronghold/resonance/api/admission'),'admission');
 assert.equal(classifyRequest('POST','/stronghold/resonance/api/sessions'),'blocked');
 const src=await readFile(new URL('../../tools/resonance/native-recovery-check.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bconst\s+URL\s*=/);assert.match(src,/page\.on\('request',req=>\{void handleRequestEvent/);
});

test('instrumented real wrapper sequence exercises retry, exhausted error, manual retry, and late destroy',async()=>{
 const source='export async function createFieldView(host, options = {}) { return {kind:"native", id:options.id, destroy(){this.destroyed=true}}; }';
 const transformed=instrumentRenderModule(source).replace('export async function createFieldView','async function createFieldView')+'\nthis.factory=createFieldView;';
 const fixture={mode:'throw-once',calls:0,allowRecovery:false,lateDestroyCount:0};
 const context={globalThis:null,setTimeout,Promise};context.globalThis=context;context.__FIELD_RECOVERY_FIXTURE__=fixture;vm.runInNewContext(transformed,context);
 await assert.rejects(context.factory(null,{id:'retry'}),/first attempt/);const retry=await context.factory(null,{id:'retry'});assert.equal(retry.kind,'native');assert.equal(fixture.calls,2);
 fixture.mode='throw-all';fixture.calls=0;for(let i=0;i<3;i++)await assert.rejects(context.factory(null,{}),/exhausted attempts/);fixture.allowRecovery=true;const manual=await context.factory(null,{id:'manual'});assert.equal(manual.id,'manual');
 fixture.mode='delay-first';fixture.calls=0;fixture.allowRecovery=false;fixture.delayMs=2;const latePromise=context.factory(null,{id:'late'});await Promise.resolve();const primary=await context.factory(null,{id:'primary'});fixture.primaryView=primary;const late=await latePromise;late.destroy();assert.equal(fixture.lateDestroyCount,1);assert.equal(fixture.primaryView,primary);assert.equal(primary.destroyed,undefined);
});
