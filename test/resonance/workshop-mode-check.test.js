import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveFailedAttempt, blockGameMutation, inWorkshopScope, isGameAdmissionBootstrap, isGameApi, isGameFrameUrl, isIndependentHostFavicon404, parseArgs } from '../../tools/resonance/workshop-mode-check.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
  assert.throws(()=>parseArgs(['--self-test','--resume-failed']),/only valid for a real run/);
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
