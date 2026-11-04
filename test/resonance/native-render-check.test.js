import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRequest, compareModuleSources, comparePlayerSnapshot, moduleUrlFor, normalChromeArgs, outputPaths, parseArgs, WHOLE_UI_MODULES } from '../../tools/resonance/native-render-check.mjs';

test('baseline URL is fixed and candidate URLs use an allowlisted same-origin resonance page',()=>{
 const baseline=parseArgs([]);assert.equal(baseline.phase,'baseline');assert.equal(baseline.url,'https://workshop.colorc.cc/stronghold/resonance.html?session=53ffde79-85b3-4302-89f7-e0d792f78723');
 const native='a'.repeat(40);
 assert.equal(parseArgs(['--phase','candidate','--published-native',native,'--url','https://workshop.colorc.cc/stronghold/resonance.html?session=53ffde79-85b3-4302-89f7-e0d792f78723']).phase,'candidate');
 assert.equal(parseArgs(['--phase','candidate','--published-native',native,'--url','http://127.0.0.1:3000/resonance.html?session=x']).phase,'candidate');
 assert.throws(()=>parseArgs(['--phase','candidate','--url','https://workshop.colorc.cc/stronghold/resonance.html']));
 const strict=parseArgs(['--phase','candidate','--published-native',native,'--capture-suffix','strict','--url','https://workshop.colorc.cc/stronghold/resonance.html?session=x&render=fallback']);assert.equal(strict.captureSuffix,'strict');assert.match(strict.url,/render=fallback/);
 assert.throws(()=>parseArgs(['--phase','candidate','--published-native','bad','--url','https://workshop.colorc.cc/stronghold/resonance.html']));
 assert.throws(()=>parseArgs(['--phase','candidate','--url','https://evil.example/resonance.html']));
 assert.throws(()=>parseArgs(['--phase','candidate','--url','http://localhost:3000/other.html']));
 assert.throws(()=>parseArgs(['--url','https://workshop.colorc.cc/stronghold/resonance.html']));
});

test('firewall permits only readonly requests and exact admission POST',()=>{
 assert.deepEqual(classifyRequest({method:'GET',pathname:'/resonance/api/sessions/x'}),{allowed:true,kind:'readonly'});
 assert.deepEqual(classifyRequest({method:'HEAD',pathname:'/asset.png'}),{allowed:true,kind:'readonly'});
 for(const pathname of ['/resonance/api/admission','/stronghold/resonance/resonance/api/admission','/stronghold/resonance/api/admission'])assert.deepEqual(classifyRequest({method:'POST',pathname}),{allowed:true,kind:'admission'});
 for(const pathname of ['/resonance/api/admissions','/stronghold/resonance/api/admission/extra','/stronghold/x/resonance/api/admission'])assert.equal(classifyRequest({method:'POST',pathname}).allowed,false,pathname);
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS'])assert.equal(classifyRequest({method,pathname:'/resonance/api/sessions/x/actions'}).allowed,false,method);
 assert.equal(classifyRequest({method:'POST',pathname:'/resonance/api/admissions'}).allowed,false);
});

test('module source identity requires exact text for all three published modules',()=>{
 const files=['public/js/ui/fieldHost.js','public/js/render/app.js','public/js/resonance/game.js'];
 const exact=Object.fromEntries(files.map(file=>[file,`source:${file}`]));
 assert.deepEqual(compareModuleSources(exact,exact).map(row=>row.match),[true,true,true]);
 const changed={...exact,[files[1]]:'different'};
 assert.deepEqual(compareModuleSources(exact,changed).map(row=>row.match),[true,false,true]);
 assert.equal(compareModuleSources(exact,{})[0].nativeAvailable,true);
 assert.equal(compareModuleSources(exact,{})[0].remoteAvailable,false);
});

test('session invariant requires revision 27 and exact byte plus mtime equality',()=>{
 const before={revision:27,mtimeMs:123,bytes:Buffer.from('{"revision":27}')};
 assert.equal(comparePlayerSnapshot(before,{revision:27,mtimeMs:123,bytes:Buffer.from('{"revision":27}')}),true);
 assert.equal(comparePlayerSnapshot(before,{revision:27,mtimeMs:124,bytes:Buffer.from('{"revision":27}')}),false);
 assert.equal(comparePlayerSnapshot(before,{revision:27,mtimeMs:123,bytes:Buffer.from('{"revision":28}')}),false);
 assert.equal(comparePlayerSnapshot(before,{revision:28,mtimeMs:123,bytes:Buffer.from('{"revision":27}')}),false);
});

test('baseline and candidate use separate canonical evidence paths',()=>{
 const baseline=outputPaths('baseline'),candidate=outputPaths('candidate'),strict=outputPaths('candidate','strict');
 assert.notEqual(baseline.receipt,candidate.receipt);assert.notEqual(baseline.log,candidate.log);assert.notEqual(baseline.screenshot,candidate.screenshot);
 assert.notEqual(candidate.receipt,strict.receipt);assert.equal(strict.receipt.endsWith('render-candidate-strict-receipt.json'),true);assert.equal(strict.log.endsWith('render-candidate-strict-run.log'),true);assert.equal(strict.screenshot.endsWith('74-render-candidate-strict.jpg'),true);
 assert.equal(baseline.screenshot.endsWith('72-render-normal.jpg'),true);assert.equal(candidate.screenshot.endsWith('73-render-candidate.jpg'),true);
});

test('module fetch URLs use the actual redirected resonance page directory',()=>{
 assert.equal(moduleUrlFor('https://workshop.colorc.cc/stronghold/resonance/resonance.html?session=x','public/js/render/app.js'),'https://workshop.colorc.cc/stronghold/resonance/js/render/app.js');
 assert.equal(moduleUrlFor('http://127.0.0.1:3000/resonance.html?session=x','public/js/render/app.js'),'http://127.0.0.1:3000/js/render/app.js');
});

test('normal browser launch uses only non-forcing Chrome args',()=>{
 assert.deepEqual(normalChromeArgs(),['--no-first-run','--disable-background-networking']);
 assert.equal(normalChromeArgs().some(arg=>/swiftshader|angle|gpu-blocklist|no-sandbox/i.test(arg)),false);
});

test('whole UI publication has distinct evidence paths and verifies its result and economy sources',()=>{
 const options=parseArgs(['--phase','candidate','--published-native','a'.repeat(40),'--capture-suffix','whole-ui','--url','https://workshop.colorc.cc/stronghold/resonance.html']);
 assert.equal(options.captureSuffix,'whole-ui');
 const output=outputPaths('candidate','whole-ui');
 for(const old of [outputPaths('baseline'),outputPaths('candidate'),outputPaths('candidate','strict')])for(const key of Object.keys(output))assert.notEqual(output[key],old[key]);
 assert.ok(WHOLE_UI_MODULES.includes('public/js/resonance/native/ResultView.js'));
 assert.ok(WHOLE_UI_MODULES.includes('public/js/resonance/economyPanels.js'));
 assert.ok(WHOLE_UI_MODULES.includes('shared/resonance/economy-view.js'));
 const exact=Object.fromEntries(WHOLE_UI_MODULES.map(file=>[file,`published:${file}`]));
 assert.ok(compareModuleSources(exact,exact,WHOLE_UI_MODULES).every(row=>row.match));
 const incomplete={...exact};delete incomplete['public/js/resonance/native/ResultView.js'];
 assert.equal(compareModuleSources(exact,incomplete,WHOLE_UI_MODULES).find(row=>row.file.endsWith('/ResultView.js')).match,false);
});

test('whole-ui-gateway uses isolated evidence paths and fetches shared economy code through the gateway route',()=>{
 const native='b'.repeat(40),args=['--phase','candidate','--published-native',native,'--capture-suffix','whole-ui-gateway','--url','https://workshop.colorc.cc/stronghold/resonance/resonance.html?session=x'];
 const options=parseArgs(args);assert.equal(options.captureSuffix,'whole-ui-gateway');
 const gateway=outputPaths('candidate','whole-ui-gateway'),original=outputPaths('candidate','whole-ui');
 assert.notEqual(gateway.receipt,original.receipt);assert.notEqual(gateway.log,original.log);assert.notEqual(gateway.screenshot,original.screenshot);
 assert.ok(gateway.screenshot.endsWith('86-whole-ui-gateway-published-readonly.jpg'));
 assert.equal(moduleUrlFor(options.url,'shared/resonance/economy-view.js'),'https://workshop.colorc.cc/stronghold/shared/resonance/economy-view.js');
 assert.equal(moduleUrlFor(options.url,'public/js/resonance/economyPanels.js'),'https://workshop.colorc.cc/stronghold/resonance/js/resonance/economyPanels.js');
 assert.ok(compareModuleSources(Object.fromEntries(WHOLE_UI_MODULES.map(file=>[file,`native:${file}`])),Object.fromEntries(WHOLE_UI_MODULES.map(file=>[file,`native:${file}`])),WHOLE_UI_MODULES).every(row=>row.match));
});
