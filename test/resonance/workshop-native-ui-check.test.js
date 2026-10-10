import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { blockGameMutation, isAdmissionBootstrap, isGameApi, isGameFrameUrl, isIndependentHostFavicon404, isWorkshopScope, parseArgs, rectanglesOverlap } from '../../tools/resonance/workshop-native-ui-check.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=readFileSync(path.join(ROOT,'tools/resonance/workshop-native-ui-check.mjs'),'utf8');

test('Workshop credentials stay on /bside and game API writes are denied except exact admission bootstrap',()=>{
  const api='https://workshop.colorc.cc/stronghold/resonance/resonance/api/';
  assert.equal(isWorkshopScope('https://workshop.colorc.cc/bside/api/x'),true);
  assert.equal(isWorkshopScope('https://workshop.colorc.cc/stronghold/resonance.html'),false);
  assert.equal(isWorkshopScope('https://cdn.example/skill.png'),false);
  assert.equal(isGameApi(`${api}sessions/${'53ffde79-85b3-4302-89f7-e0d792f78723'}`),true);
  assert.equal(isGameFrameUrl('https://workshop.colorc.cc/stronghold/resonance.html'),true);
  assert.equal(isGameFrameUrl('https://workshop.colorc.cc/stronghold/resonance/resonance.html'),true);
  assert.equal(isGameFrameUrl('https://workshop.colorc.cc/stronghold/resonance/api/catalog'),false);
  assert.equal(isIndependentHostFavicon404('https://workshop.colorc.cc/favicon.ico',404),true);
  assert.equal(isIndependentHostFavicon404('https://workshop.colorc.cc/stronghold/favicon.ico',404),false);
  assert.equal(isAdmissionBootstrap('POST',`${api}admission`),true);
  assert.equal(blockGameMutation('POST',`${api}admission`),false);
  for(const method of ['POST','PUT','PATCH','DELETE'])for(const endpoint of ['sessions','sessions/x/actions','sessions/x/fights','sessions/x/replays/8','admissions','admission/extra'])assert.equal(blockGameMutation(method,`${api}${endpoint}`),true,`${method} ${endpoint}`);
  assert.equal(blockGameMutation('GET',`${api}sessions/x`),false);
});

test('checker defaults to safe inspection, fixed outputs, viewport geometry, and never starts a new session',()=>{
  assert.deepEqual(parseArgs(['--product-native','a'.repeat(40)]),{help:false,selfTest:false,productNative:'a'.repeat(40)});
  assert.throws(()=>parseArgs(['--product-native','bad']),/full Git commit/);
  for(const file of ['57-new-title.jpg','58-new-difficulty.jpg','59-live-prep.jpg','60-legacy-replay.jpg'])assert.ok(source.includes(file));
  assert.ok(source.includes("SESSION='53ffde79-85b3-4302-89f7-e0d792f78723'"));
  assert.ok(source.includes("focus=resonance-play-20261009&fullscreen=1"),'opens the existing fullscreen Workshop play card first');
  assert.ok(source.includes(".rs-title-fullscreen")&&source.includes('startVisible&&workshopTitle.fullscreenVisible&&workshopTitle.fullscreenHref'));
  assert.ok(source.includes("await gameFrame.click('a.rs-title-fullscreen')")&&source.includes('fullscreen Workshop play-card page must show the title action'));
  assert.ok(source.includes('{width:1440,height:900}')&&source.includes('{width:1280,height:720}')&&source.includes('{width:844,height:390,isMobile:true,hasTouch:true}'));
  assert.ok(source.includes('images.every(image=>image&&image.complete&&image.naturalWidth>0)'),'waits for every visible shop skill icon to load');
  assert.ok(source.includes("replay.hash='replay-8'"));
  assert.ok(source.includes("rj.replay?.field?.units??[]"),'legacy equipment must come from replay field units, not combatStats');
  assert.ok(source.includes('unit.items')&&source.includes(".dpanel .rs-detail__battle-items"),'checker must verify historical equipment renders in replay detail');
  assert.ok(source.includes('raw.stats?.()?.units'),'native engine unit count uses numeric stats.units');
  assert.doesNotMatch(source,/combatStats\??\.items|stats\(\)\?\.units\.map/,'do not treat engine counts as arrays or combatStats as equipment source');
  assert.ok(source.includes("await page.screenshot({path:SHOTS[2]"));
  assert.ok(source.includes('300-second internal watchdog'));
  assert.ok(source.includes('requestfailed')&&source.includes("response.status()>=400")&&source.includes('receipt.failedResources.length'),'records failed static resources and asserts none remain');
  assert.ok(source.includes('!receipt.pageErrors.length&&!receipt.consoleErrors.length'),'browser errors are failure conditions');
  assert.match(source,/typeof units==='number'&&units>0/,'legacy replay count is confirmed numeric');
  assert.match(source,/innerText\.trim\(\)==='开始整备'/,'entry advances only to difficulty');
  assert.ok(source.includes('difficulty.createButtons===1'),'start action is observed without clicking it');
  assert.doesNotMatch(source,/button\.innerText\.trim\(\)==='开始备战'\)\s*;?\s*button\.click/);
  assert.equal(rectanglesOverlap({left:0,top:0,right:10,bottom:10},{left:10,top:0,right:20,bottom:10}),false);
  assert.equal(rectanglesOverlap({left:0,top:0,right:10,bottom:10},{left:9,top:9,right:20,bottom:20}),true);
});
