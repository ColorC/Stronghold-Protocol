import test from 'node:test';
import assert from 'node:assert/strict';
import { blockGameMutation, inWorkshopScope, isGameApi, parseArgs } from '../../tools/resonance/workshop-mode-check.mjs';

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
