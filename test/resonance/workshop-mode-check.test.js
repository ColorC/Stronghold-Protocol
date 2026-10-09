import test from 'node:test';
import assert from 'node:assert/strict';
import { blockGameMutation, inWorkshopScope, isGameApi, isGameFrameUrl, isIndependentHostFavicon404, parseArgs } from '../../tools/resonance/workshop-mode-check.mjs';
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
  for(const [method,path] of [['POST','sessions'],['POST','sessions/x/actions'],['PUT','sessions/x'],['DELETE','sessions/x']])
    assert.equal(blockGameMutation(method,`https://workshop.colorc.cc/stronghold/resonance/api/${path}`),true);
  assert.equal(blockGameMutation('GET','https://workshop.colorc.cc/stronghold/resonance/api/sessions/x?catalog=1'),false);
  assert.equal(blockGameMutation('GET','https://workshop.colorc.cc/stronghold/resonance/api/sessions/x/replays/8'),false);
  assert.equal(blockGameMutation('POST','https://workshop.colorc.cc/bside/api/canvases/x'),false);
});

test('execution requires supplied full native commit and does not default to browser execution',()=>{
  assert.throws(()=>parseArgs([]),/full Git commit/);
  assert.equal(parseArgs(['--product-native','a'.repeat(40)]).productNative,'a'.repeat(40));
  assert.equal(parseArgs(['--self-test']).selfTest,true);
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
