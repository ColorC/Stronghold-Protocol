import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveFailedAttempt, archiveFailedReplayAttempt, blockGameMutation, inWorkshopScope, isGameAdmissionBootstrap, isGameApi, isGameFrameUrl, isIndependentHostFavicon404, parseArgs, replayControlCenter } from '../../tools/resonance/workshop-mode-check.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const checkerSource=await readFile(fileURLToPath(new URL('../../tools/resonance/workshop-mode-check.mjs',import.meta.url)),'utf8');

test('Workshop bearer scope is limited to bside and never reaches game/assets',()=>{
  assert.equal(inWorkshopScope('https://workshop.colorc.cc/bside/canvas/notes-web.html'),true);
  assert.equal(inWorkshopScope('https://workshop.colorc.cc/stronghold/resonance.html'),false);
  assert.equal(inWorkshopScope('https://cdn.example/game.js'),false);
});

test('game API firewall blocks every non-read method while permitting old-session/replay GETs',()=>{
  assert.equal(isGameApi('https://workshop.colorc.cc/stronghold/resonance/api/sessions'),true);
  assert.equal(isGameApi('https://workshop.colorc.cc/resonance/api/sessions'),true);
  const nestedApi='https://workshop.colorc.cc/stronghold/resonance/resonance/api/';
  assert.equal(isGameAdmissionBootstrap('POST',`${nestedApi}admission`),true);
  assert.equal(blockGameMutation('POST',`${nestedApi}admission`),false);
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS'])for(const endpoint of ['sessions','sessions/x/actions','sessions/x/fights','admissions','admission/extra','admission/'])
    assert.equal(blockGameMutation(method,`${nestedApi}${endpoint}`),true,`${method} ${endpoint} must be blocked`);
  assert.equal(blockGameMutation('PUT',`${nestedApi}admission`),true);
  assert.equal(blockGameMutation('GET','https://workshop.colorc.cc/stronghold/resonance/api/sessions/x?catalog=1'),false);
  assert.equal(blockGameMutation('GET','https://workshop.colorc.cc/stronghold/resonance/api/sessions/x/replays/8'),false);
  assert.equal(blockGameMutation('POST','https://workshop.colorc.cc/bside/api/canvases/x'),false);
});

test('execution requires supplied full native commit and does not default to browser execution',()=>{
  assert.throws(()=>parseArgs([]),/full Git commit/);
  assert.equal(parseArgs(['--product-native','a'.repeat(40)]).productNative,'a'.repeat(40));
  assert.equal(parseArgs(['--self-test']).selfTest,true);
  assert.equal(parseArgs(['--product-native','a'.repeat(40),'--resume-failed']).resumeFailed,true);
  assert.equal(parseArgs(['--product-native','a'.repeat(40),'--resume-replay-only']).resumeReplayOnly,true);
  assert.throws(()=>parseArgs(['--self-test','--resume-failed']),/only valid for a real run/);
  assert.throws(()=>parseArgs(['--product-native','a'.repeat(40),'--resume-failed','--resume-replay-only']),/mutually exclusive/);
});

test('resume archives only the owned failed attempt and refuses success receipts',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'workshop-mode-check-'));
  try{
    const receiptPath=path.join(dir,'receipt.json'),logPath=path.join(dir,'check.log');
    const archiveReceiptPath=path.join(dir,'attempt-1.json'),archiveLogPath=path.join(dir,'attempt-1.log');
    const fixture={status:'failed',workshopUrl:'https://workshop.colorc.cc/bside/canvas/notes-web.html?theme=workshop&product_ref=spark-workshop&project=arknights&session_id=canvas%3Acanvas-0470c0a1&focus=resonance-play-20261009&fullscreen=1',cardId:'resonance-play-20261009',screenshots:['E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/resonance/ui-verification/48-mode-workshop.jpg','E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/resonance/ui-verification/49-mode-fullscreen.jpg','E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/resonance/ui-verification/50-mode-production-replay.jpg'],error:'Waiting for selector `.rs-title-fullscreen` failed',apiRequests:[{method:'POST',path:'/stronghold/resonance/resonance/api/admission'}],blockedMutations:[{method:'POST',path:'/stronghold/resonance/resonance/api/admission'}]};
    const original=JSON.stringify(fixture,null,2)+'\n',originalLog='2026-10-09T20:10:18.357Z failed: Waiting for selector `.rs-title-fullscreen` failed\n';
    writeFileSync(receiptPath,original);writeFileSync(logPath,originalLog);
    assert.deepEqual(archiveFailedAttempt({receiptPath,logPath,archiveReceiptPath,archiveLogPath}),{receipt:archiveReceiptPath,log:archiveLogPath,status:'failed'});
    assert.equal(readFileSync(archiveReceiptPath,'utf8'),original);assert.equal(readFileSync(archiveLogPath,'utf8'),originalLog);
    assert.equal(existsSync(receiptPath),false);assert.equal(existsSync(logPath),false);
    writeFileSync(receiptPath,JSON.stringify({...fixture,status:'passed'}));writeFileSync(logPath,originalLog);
    assert.throws(()=>archiveFailedAttempt({receiptPath,logPath,archiveReceiptPath:path.join(dir,'attempt-2.json'),archiveLogPath:path.join(dir,'attempt-2.log')}),/only accepts a failed receipt/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('replay control callback serializes and receives its label in page context',()=>{
  const root={querySelectorAll:()=>[
    {innerText:'暂停',getBoundingClientRect:()=>({x:10,y:20,width:40,height:20})},
    {innerText:'关闭',getBoundingClientRect:()=>({x:80,y:30,width:60,height:20})}
  ]};
  const serialized='('+replayControlCenter.toString()+')(root,label)';
  const result=JSON.parse(JSON.stringify(runInNewContext(serialized,{root,label:'关闭'})));
  assert.deepEqual(result,{x:110,y:40});
  assert.equal(runInNewContext(serialized,{root,label:'不存在'}),null);
});

test('replay-only resume archives the owned failed R8 checkpoint with inherited checks',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'workshop-replay-resume-'));
  try{
    const receiptPath=path.join(dir,'receipt.json'),logPath=path.join(dir,'check.log');
    const archiveReceiptPath=path.join(dir,'attempt-2.json'),archiveLogPath=path.join(dir,'attempt-2.log');
    const screenshots=['E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/resonance/ui-verification/48-mode-workshop.jpg','E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/resonance/ui-verification/49-mode-fullscreen.jpg','E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/resonance/ui-verification/50-mode-production-replay.jpg'];
    const fixture={checkerId:'workshop-mode-check',status:'failed',workshopUrl:'https://workshop.colorc.cc/bside/canvas/notes-web.html?theme=workshop&product_ref=spark-workshop&project=arknights&session_id=canvas%3Acanvas-0470c0a1&focus=resonance-play-20261009&fullscreen=1',cardId:'resonance-play-20261009',screenshots,error:'label is not defined\npptr:$eval;clickReplayControl',apiRequests:[{method:'POST',path:'/stronghold/resonance/resonance/api/admission'},{method:'GET',path:'/stronghold/resonance/resonance/api/sessions/53ffde79-85b3-4302-89f7-e0d792f78723'}],gameplayMutations:[],blockedMutations:[],checks:{playCard:{id:'resonance-play-20261009',finalIframeUrl:'https://workshop.colorc.cc/stronghold/resonance/resonance.html?'},fullscreen:{opened:true},titleDifficultyBriefingOpening:{reached:true},codex:{visible:true},catalog:{events:4,active:65,operators:154,strategies:28,equipment:69},oldV1Reads:[{id:'53ffde79-85b3-4302-89f7-e0d792f78723',sessionStatus:200,sessionOk:true,revision:27,revisionAfter:27,replayStatus:200,replayOk:true,replayRound:8}]}};
    const original=JSON.stringify(fixture,null,2)+'\n',originalLog='failed: label is not defined\npptr:$eval;clickReplayControl\n';
    writeFileSync(receiptPath,original);writeFileSync(logPath,originalLog);
    const archived=archiveFailedReplayAttempt({receiptPath,logPath,archiveReceiptPath,archiveLogPath,screenshots});
    assert.equal(readFileSync(archiveReceiptPath,'utf8'),original);assert.equal(readFileSync(archiveLogPath,'utf8'),originalLog);
    assert.deepEqual(archived.inheritedChecks,{playCard:true,fullscreen:true,titleDifficultyBriefingOpening:true,codex:true,catalog:{events:4,active:65,operators:154,strategies:28,equipment:69},oldV1:{id:'53ffde79-85b3-4302-89f7-e0d792f78723',revision:27,revisionAfter:27,replayRound:8}});
    writeFileSync(receiptPath,JSON.stringify({...fixture,error:'different failure'}));writeFileSync(logPath,originalLog);
    assert.throws(()=>archiveFailedReplayAttempt({receiptPath,logPath,archiveReceiptPath:path.join(dir,'attempt-3.json'),archiveLogPath:path.join(dir,'attempt-3.log'),screenshots}),/known replay callback error/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('production replay check uses the known replay deep link and final game document paths',()=>{
  assert.equal(isGameFrameUrl('https://workshop.colorc.cc/stronghold/resonance.html'),true);
  assert.equal(isGameFrameUrl('https://workshop.colorc.cc/stronghold/resonance/resonance.html'),true);
  assert.equal(isGameFrameUrl('https://workshop.colorc.cc/stronghold/resonance/api/catalog'),false);
  assert.match(checkerSource,/const replayUrl=new URL\(GAME\);replayUrl\.searchParams\.set\('session',OLD\[0\]\);replayUrl\.hash='replay-8'/);
  assert.match(checkerSource,/productionV1Replay=/);
  assert.match(checkerSource,/\.rs-replay-native\[aria-label="战斗回放"\]/);
  assert.match(checkerSource,/Number\(view\.raw\?\.stats\?\.\(\)\?\.units\)>0/);
  assert.match(checkerSource,/pieceScreenRect\?\.\(info\.uid\)/);
  assert.match(checkerSource,/battleUnitAt\?\.\(point\.x-cr\.left,point\.y-cr\.top\)/);
  assert.match(checkerSource,/50-mode-production-replay\.jpg/);
  assert.match(checkerSource,/path\.join\(ROOT,'runtime\/resonance\/player-sessions',`\$\{OLD\[0\]\}\.json`\)/);
});

test('only an independently observed Workshop host favicon 404 is diagnosable',()=>{
  assert.equal(isIndependentHostFavicon404('https://workshop.colorc.cc/favicon.ico',404),true);
  assert.equal(isIndependentHostFavicon404('https://workshop.colorc.cc/bside/favicon.ico',404),true);
  assert.equal(isIndependentHostFavicon404('https://workshop.colorc.cc/stronghold/favicon.ico',404),false);
  assert.equal(isIndependentHostFavicon404('https://workshop.colorc.cc/favicon.ico',500),false);
  assert.match(checkerSource,/\|mjs\|css\|json\|webp\|png\|jpe\?g\|svg\|woff2\?/);
});
