import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ROOT,loadData} from '../../server/data.js';
import {getResonanceCatalog} from '../../server/modes/resonance/catalog.js';
import {createResonanceHttp} from '../../server/modes/resonance/http.js';

// The sparse worktree has no copied input; tests read the one canonical data tree explicitly.
const data=loadData(process.env.SP_DATA_DIR||path.resolve(ROOT,'..','..','..','data'),{log:{warn(){},error(){}}});
function request(method,url,body,origin='http://local.test'){
 const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=method;req.url=url;req.headers={host:'local.test',...(origin?{origin}:{})};
 const res={headersSent:false,writableEnded:false,destroyed:false,status:0,headers:{},writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true},end(text){this.body=text;this.writableEnded=true}};
 return {req,res};
}
async function invoke(handler,method,url,body,origin){const {req,res}=request(method,url,body,origin);await handler(req,res,new URL(url,'http://local.test').pathname);return {status:res.status,body:JSON.parse(res.body||'{}')};}

test('resonance HTTP is authoritative, same-origin, and returns a source-free player catalog',async(t)=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'resonance-http-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const catalogProvider=(native,options)=>getResonanceCatalog(native,options);
 const handler=createResonanceHttp({data,directory,catalogProvider,fieldResolver:()=>null,battleRunner:()=>{throw new Error('battle must not run in this test')}});
 const blocked=await invoke(handler,'GET','/resonance/api/catalog',undefined,'http://evil.test');assert.equal(blocked.status,403);
 const wrongScheme=await invoke(handler,'GET','/resonance/api/catalog',undefined,'https://local.test');assert.equal(wrongScheme.status,403);
 const bad=await invoke(handler,'POST','/resonance/api/sessions',{rawState:{phase:'prep'}});assert.equal(bad.status,422);assert.equal(bad.body.error.code,'UNSUPPORTED_SESSION_INPUT');
 const env=Object.keys(getResonanceCatalog(data).environments)[0];
 const created=await invoke(handler,'POST','/resonance/api/sessions',{seed:812,difficulty:'NORMAL',environmentId:env});
 assert.equal(created.status,201,JSON.stringify(created.body.error));assert.equal(created.body.state.pieces.length,3);assert.equal(created.body.catalog.activeOperatorIds.length,65);
 assert.deepEqual(created.body.state.history,[],'active preparation DTO starts with empty compact history');
 assert.equal(Object.hasOwn(created.body.catalog.operators[Object.keys(created.body.catalog.operators)[0]],'source'),false);
 assert.equal(Object.hasOwn(created.body.state.pieces[0].operator.starDetails,'record'),false);
 const id=created.body.id;const stored=JSON.parse(await readFile(path.join(directory,`${id}.json`),'utf8'));assert.equal(stored.revision,0);
 const competing=await Promise.all([0,1].map(()=>invoke(handler,'POST',`/resonance/api/sessions/${id}/actions`,{expectedRevision:0,action:{type:'lockShop',locked:true}})));
 assert.equal(competing.filter((packet)=>packet.status===200).length,1,JSON.stringify(competing.map((packet)=>packet.status)));assert.equal(competing.filter((packet)=>packet.status===409).length,1,JSON.stringify(competing.map((packet)=>packet.status)));
 const afterRace=JSON.parse(await readFile(path.join(directory,`${id}.json`),'utf8'));assert.equal(afterRace.revision,1);
 const loaded=await invoke(handler,'GET',`/resonance/api/sessions/${id}?catalog=0`);assert.equal(loaded.status,200);assert.equal(loaded.body.state.revision,1);assert.equal(loaded.body.catalog,undefined);
 const stale=await invoke(handler,'POST',`/resonance/api/sessions/${id}/actions`,{expectedRevision:2,action:{type:'refresh'}});
 assert.equal(stale.status,409);assert.equal(stale.body.error.code,'STALE_REVISION');
 const unknown=await invoke(handler,'POST','/resonance/api/sessions',{seed:1,difficulty:'NORMAL',environmentId:'origin_unknown'});
 assert.equal(unknown.status,422);assert.equal(unknown.body.error.code,'BAD_ENVIRONMENT');
});

test('HTTP session DTO returns each persisted terminal reason without running a battle',async()=>{
 const directory=path.resolve(ROOT,'..','..','..','runtime/resonance/verification/fixture-sessions');
 const catalogProvider=(native,options)=>getResonanceCatalog(native,options);
 const handler=createResonanceHttp({data,directory,catalogProvider,fieldResolver:()=>null,statsPreview:()=>({}),battleRunner:()=>{throw new Error('battle must not run for saved terminal sessions')}});
 const fixtures=[
  ['14f5ff81-2a70-4b2d-b15b-9d88e19eb9c1','victory'],
  ['3ac11314-7783-4364-bbab-0c3144ea1104','hp-depleted'],
  ['507bc965-a382-46d0-ae8a-5f21c82fd981','round-limit-loss'],
 ];
 for(const [id,reason] of fixtures){
  const stored=JSON.parse(await readFile(path.join(directory,`${id}.json`),'utf8'));
  assert.equal(stored.terminalReason,reason,`fixture ${id} reason`);
  const packet=await invoke(handler,'GET',`/resonance/api/sessions/${id}?catalog=0`);
  assert.equal(packet.status,200,`fixture ${id} HTTP status`);
  assert.equal(packet.body.state.terminalReason,stored.terminalReason,`fixture ${id} HTTP reason matches the saved state`);
  assert.equal(packet.body.state.phase,'complete');
  assert.deepEqual(packet.body.state.history,stored.history,`fixture ${id} reopens with the persisted compact history`);
  assert.ok(packet.body.state.history.some(entry=>entry.type==='fight-settled'),`fixture ${id} restores settlement/report rows`);
  for(const entry of packet.body.state.history){assert.equal(Object.hasOwn(entry,'result'),false);assert.equal(Object.hasOwn(entry,'diagnostics'),false);}
 }
});
