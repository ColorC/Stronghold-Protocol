import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getSeasonCampaignCatalog } from '../../tools/resonance/balance-campaign.mjs';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { resolveOperatorSkillIcon } from '../../public/js/resonance/operatorSkillIcon.js';
import { blockGameMutation, isAdmissionBootstrap, isGameApi, isGameFrameUrl, isIndependentHostFavicon404, isWorkshopScope, parseArgs, rectanglesOverlap, mapLimit, skillIconVerdict, touchActionFits, cardBackingFits } from '../../tools/resonance/workshop-native-ui-check.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=readFileSync(path.join(ROOT,'tools/resonance/workshop-native-ui-check.mjs'),'utf8');

test('all65 fixed skills match the chosen native option rather than the upstream default',()=>{
  const catalog=getSeasonCampaignCatalog(1),display=resonanceDisplayCatalog(catalog);
  const chess=JSON.parse(readFileSync('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native/chess.json','utf8'));
  const alternatives=[];
  for(const id of catalog.config.activeOperatorIds){
    const operator=display.operators[id],record=chess[id],name=operator.stars[1].skill?.name;
    assert.ok(record,id);
    const selected=name?[record.skill,...(record.skills||[])].filter(Boolean).find(skill=>skill.name===name):record.skill;
    assert.ok(selected,id);
    const resolved=resolveOperatorSkillIcon(operator);
    assert.equal(resolved.skillId,selected.skillId,id);assert.equal(resolved.iconId,selected.iconId,id);
    const actual=new URL(resolved.url,'https://workshop.colorc.cc/stronghold/resonance.html').href;
    assert.equal(skillIconVerdict(operator,{skill:selected},resolved,actual,true).passed,true,id);
    if(selected.skillId!==record.skill?.skillId)alternatives.push({id,skillId:selected.skillId});
  }
  assert.equal(catalog.config.activeOperatorIds.length,65);
  assert.deepEqual(alternatives,[
    {id:'chess_native_char_4119_wanqin_a',skillId:'skchr_wanqin_2'},
    {id:'chess_native_char_2023_ling_a',skillId:'skchr_ling_3'},
    {id:'chess_native_char_2025_shu_a',skillId:'skchr_shu_3'},
  ],'万顷、令、黍分别使用其已选的原生技能');
});

test('chosen skill audit rejects a loaded wrong image and only exempts the native skill-less robot',()=>{
  const native={skill:{skillId:'skchr_angel_3',iconId:'skchr_angel_3'}};
  const resolved={skillId:'skchr_angel_3',iconId:'skchr_angel_3',url:'/assets/skill/skchr_angel_3.png'};
  const url='https://workshop.colorc.cc/assets/skill/skchr_angel_3.png';
  assert.equal(skillIconVerdict({charId:'char_103_angel'},native,resolved,url,true).passed,true);
  assert.equal(skillIconVerdict({charId:'char_103_angel'},native,resolved,url.replace('angel_3','angel_2'),true).passed,false);
  assert.equal(skillIconVerdict({charId:'char_103_angel'},native,{...resolved,skillId:'wrong'},url,true).passed,false);
  assert.equal(skillIconVerdict({charId:'char_103_angel'},native,resolved,url,false).passed,false);
  assert.deepEqual(skillIconVerdict({charId:'char_4000_jnight'},{skill:null},{url:null},null,false),{passed:true,exempt:true});
  assert.equal(skillIconVerdict({charId:'char_103_angel'},{skill:null},{url:null},null,false).passed,false);
  assert.equal(skillIconVerdict({charId:'char_4000_jnight'},{},{url:null},null,false).passed,false);
  assert.equal(blockGameMutation('HEAD','https://workshop.colorc.cc/stronghold/resonance/api/sessions/x'),false);
});

test('resource mapping keeps output order and bounds concurrent requests',async()=>{
  let active=0,peak=0;
  const result=await mapLimit([5,4,3,2,1],2,async value=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,value));active--;return value*2;});
  assert.deepEqual(result,[10,8,6,4,2]);assert.equal(peak,2);
  await assert.rejects(mapLimit([1],0,()=>1),/invalid concurrency/);
});

test('touch target and backing geometry reject undersized or partial surfaces',()=>{
  assert.equal(touchActionFits({width:88,height:44}),true);
  assert.equal(touchActionFits({width:87,height:44}),false);
  assert.equal(touchActionFits({width:88,height:43}),false);
  const card={width:120,height:190,backingWidth:116,backingHeight:186,backing:'linear-gradient(rgb(40,182,106),rgb(40,182,106))'};
  assert.equal(cardBackingFits(card),true);
  assert.equal(cardBackingFits({...card,backingHeight:130}),false);
  assert.equal(cardBackingFits({...card,backing:'none'}),false);
});

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
  assert.deepEqual(parseArgs(['--product-native','a'.repeat(40)]),{help:false,selfTest:false,productNative:'a'.repeat(40),resumeFailed:false});
  assert.equal(parseArgs(['--product-native','a'.repeat(40),'--resume-failed']).resumeFailed,true);
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
