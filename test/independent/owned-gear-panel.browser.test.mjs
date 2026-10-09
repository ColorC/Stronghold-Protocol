import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const enabled=process.env.DETAIL_PANEL_E2E==='1';
test('owned, shop and battle operator tabs separate references from traits while retaining gear and temporary growth', {skip:enabled?false:'set DETAIL_PANEL_E2E=1 for CPU-only DOM browser verification',timeout:90000}, async()=>{
  const {getCatalog}=await import('../../server/modes/independent/catalog.js');
  const {getData}=await import('../../server/data.js');
  const {independentDisplayCatalog}=await import('../../server/modes/independent/display.js');
  const puppeteer=(await import('puppeteer-core')).default;
  const game=getData(), rawCatalog=getCatalog(game),catalog=independentDisplayCatalog(game,rawCatalog);
  const op=Object.values(rawCatalog.operators).find(x=>x.name==='阿罗玛'&&!x.elite);
  assert.ok(op);
  const piece={uid:'owned-pane-piece',chessId:op.chessId,elite:false,skillIndex:0,moduleId:'none',factions:op.nativeFactionTags,equipment:[{uid:'worn-attack',id:'precision',quantity:2}],attachments:[],startStats:{...op.source.normalChess.stats,temporaryGrowth:[{attackUnits:1,secondaryUnits:1}]}};
  const fixture={catalog,state:{phase:'prep',growthMode:'badges',funds:10,pieces:[piece],shop:{slots:[{id:op.chessId,kind:'chess',price:3,sold:false,equipment:[{id:'precision',quantity:1}]}]},inventory:[]}};
  const conditionOp=Object.values(rawCatalog.operators).find(x=>!x.elite&&x.name==='锏');assert.ok(conditionOp);
  const kjeragOp=Object.values(rawCatalog.operators).find(x=>!x.elite&&(x.nativeFactionTags||[]).includes('谢拉格')&&x.chessId!==conditionOp.chessId);assert.ok(kjeragOp);
  const kazOp=Object.values(rawCatalog.operators).find(x=>!x.elite&&(x.nativeFactionTags||[]).includes('卡西米尔')&&x.chessId!==conditionOp.chessId);assert.ok(kazOp);
  const conditionPieces=[
    {uid:'condition-source',chessId:conditionOp.chessId,playerId:'p1',kind:'op',row:2,col:2,dir:'RIGHT',equipment:[],elite:false},
    {uid:'field-kjerag',chessId:kjeragOp.chessId,playerId:'p1',kind:'op',row:2,col:3,dir:'RIGHT',equipment:[],elite:false},
    {uid:'bench-kjerag',chessId:kjeragOp.chessId,playerId:'p1',kind:'op',row:null,col:null,dir:'RIGHT',equipment:[],elite:false},
    {uid:'field-kaz',chessId:kazOp.chessId,playerId:'p1',kind:'op',row:3,col:3,dir:'RIGHT',equipment:[],elite:false},
  ];
  const conditionFixture={catalog,state:{phase:'prep',growthMode:'badges',funds:10,pieces:conditionPieces,shop:{slots:[]},inventory:[]}};
  const boot=`<!doctype html><html lang="zh-CN" class="ix-ws"><head><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/screens/game-panels.css"><link rel="stylesheet" href="/css/independent.css"></head><body><div id="root" class="ix-game"></div><script type="module">
    import {h,render} from '/vendor/preact.module.js';
    import {DetailCard} from '/js/independent/detail.js';
    import {loadData} from '/js/data.js';
    const fixture=await (await fetch('/fixture.json')).json();const conditionFixture=await (await fetch('/condition-fixture.json')).json();window.highlightedCondition=[];
    await loadData('chess','assets','bonds','items','garrisons','tokens','enemies','config');
    window.mountDetail=(target)=>{render(null,document.querySelector('#root'));render(h(DetailCard,{...fixture,target,busy:false,onClose(){},onAct(){},onInherit(){},onBuy(){},onEquipHere(){}}),document.querySelector('#root'));};
    window.mountBattleDetail=()=>{render(null,document.querySelector('#root'));render(h(DetailCard,{...fixture,state:{...fixture.state,phase:'battle'},target:{kind:'unit',unit:{side:'ally',uid:'owned-pane-piece',id:'battle-unit'}},battle:null,busy:false,onClose(){},onAct(){},onInherit(){},onBuy(){},onEquipHere(){}}),document.querySelector('#root'));};
    const conditionHighlight=(pieces)=>{window.highlightedCondition=pieces.map(p=>p.uid);window.highlightedConditionPositions=pieces.map(p=>({uid:p.uid,row:p.row,col:p.col}));};
    window.mountCondition=()=>{render(null,document.querySelector('#root'));render(h(DetailCard,{...conditionFixture,target:{kind:'piece',uid:'condition-source'},busy:false,onClose(){},onAct(){},onInherit(){},onBuy(){},onEquipHere(){},onFieldHighlight:conditionHighlight}),document.querySelector('#root'));};
    window.moveConditionPiece=(uid,row,col)=>{const state={...conditionFixture.state,pieces:conditionFixture.state.pieces.map(p=>p.uid===uid?{...p,row,col}:p)};render(h(DetailCard,{...conditionFixture,state,target:{kind:'piece',uid:'condition-source'},busy:false,onClose(){},onAct(){},onInherit(){},onBuy(){},onEquipHere(){},onFieldHighlight:conditionHighlight}),document.querySelector('#root'));};
    window.mountBattleCondition=()=>{render(null,document.querySelector('#root'));const battle={fieldPieceUids:()=>['condition-source','field-kaz'],snapHp:()=>100,stats:()=>null};render(h(DetailCard,{...conditionFixture,state:{...conditionFixture.state,phase:'battle'},target:{kind:'unit',unit:{side:'ally',uid:'condition-source',id:'battle-condition'}},battle,busy:false,onClose(){},onAct(){},onInherit(){},onBuy(){},onEquipHere(){},onFieldHighlight:conditionHighlight}),document.querySelector('#root'));};
    window.mountEnemyDetail=()=>window.mountDetail({kind:'unit',unit:{side:'enemy',defId:'enemy_1000_gopro_2',id:'enemy-unit'}});
    window.mountSummonDetail=()=>window.mountDetail({kind:'unit',unit:{side:'ally',defId:'token_10000_silent_healrb',uid:'summon-unit',id:'summon-unit'}});
    window.mountDetail({kind:'piece',uid:'owned-pane-piece'});window.ready=true;
  </script></body></html>`;
  const installation=path.resolve(process.env.SP_INSTALL_ROOT||ROOT),dataRoot=path.resolve(process.env.SP_DATA_DIR||path.join(ROOT,'data'));
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost'),name=url.pathname;
    if(name==='/'){res.setHeader('content-type','text/html');return res.end(boot);}
    if(name==='/fixture.json'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(fixture));}
    if(name==='/condition-fixture.json'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(conditionFixture));}
    const file=name.startsWith('/vendor/')?path.join(installation,'public',name):name.startsWith('/data/')?path.join(dataRoot,path.basename(name)):name.startsWith('/shared/')?path.join(ROOT,name):path.join(ROOT,'public',name);
    if(/\.(?:js|json|css)$/.test(name)&&fs.existsSync(file)){res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'application/json');return res.end(fs.readFileSync(file));}
    res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;const errors=[];let browserPhase='launch';let browserPhaseGuard;let browserProfile=null;
  try{
    browserPhaseGuard=setTimeout(()=>{console.error(`[detail-browser-phase-timeout] ${browserPhase}`);void browser?.close();},60000);
    browserProfile=fs.mkdtempSync(path.join(os.tmpdir(),'sp-detail-panel-e2e-'));
    browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:browserProfile,args:['--disable-gpu','--disable-software-rasterizer','--no-first-run','--no-default-browser-check','--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1600,height:900}});page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push(`requestfailed ${r.method()} ${r.url()} ${r.failure()?.errorText||''}`));
    const screenshotDir=process.env.SP_DETAIL_PANEL_SCREENSHOT_DIR?path.resolve(process.env.SP_DETAIL_PANEL_SCREENSHOT_DIR):null;
    if(screenshotDir)fs.mkdirSync(screenshotDir,{recursive:true});
    const capture=async(name)=>{if(!screenshotDir)return null;const file=path.join(screenshotDir,name);await page.screenshot({path:file,fullPage:true});return file;};
    browserPhase='navigation';await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded',timeout:20000});
    browserPhase='window-ready';
    await page.waitForFunction(()=>window.ready,{timeout:30000});
    browserPhase='owned-tabs';
    const ownedTraits=await page.evaluate(()=>({tabs:[...document.querySelectorAll('[role=tab]')].map(x=>x.textContent.trim()),text:document.querySelector('[role=tabpanel]').textContent,stats:document.querySelector('.ix-dpanel__stats')?.textContent||''}));
    assert.ok(ownedTraits.tabs.includes('参考原卡'),'operators with original-card data get a separate tab');assert.match(ownedTraits.text,/特质/);assert.doesNotMatch(ownedTraits.text,/暴怒的巨蜥|在你使用一张亡语随从牌后/,'default trait pane does not include original-card text');assert.match(ownedTraits.stats,/攻击/,'the permanent stats column remains visible');
    const ownedReference=await page.evaluate(async()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='参考原卡');tab.click();await new Promise(r=>requestAnimationFrame(r));return {selected:tab.getAttribute('aria-selected'),text:document.querySelector('[role=tabpanel]').textContent};});
    assert.equal(ownedReference.selected,'true');assert.match(ownedReference.text,/暴怒的巨蜥/);assert.match(ownedReference.text,/酒馆科技 2/);assert.match(ownedReference.text,/暗月奖品初版 · 19\.2/);assert.match(ownedReference.text,/普通[\s\S]*在你使用一张亡语随从牌后，获得\+1\/\+1/);assert.match(ownedReference.text,/金色[\s\S]*在你使用一张亡语随从牌后，获得\+2\/\+2/);
    const ownedReferenceScreenshot=await capture('owned-reference-tab.png');
    const returnedTraits=await page.evaluate(async()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='特质');tab.click();await new Promise(r=>requestAnimationFrame(r));return {selected:tab.getAttribute('aria-selected'),text:document.querySelector('[role=tabpanel]').textContent};});
    assert.equal(returnedTraits.selected,'true');assert.match(returnedTraits.text,/特质/);assert.doesNotMatch(returnedTraits.text,/暴怒的巨蜥|亡语随从牌/);
    const traitsScreenshot=await capture('owned-traits-tab.png');
    const owned=await page.evaluate(async()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.startsWith('装备'));if(!tab)return {tabs:[...document.querySelectorAll('[role=tab]')].map(x=>x.textContent),exists:false};tab.click();await new Promise(r=>requestAnimationFrame(r));return {exists:true,selected:tab.getAttribute('aria-selected'),text:document.querySelector('[role=tabpanel]').textContent,tiles:document.querySelectorAll('.ix-dgear__tile').length,temporary:!!document.querySelector('[role=tabpanel] .ix-detail__text')};});
    assert.equal(owned.exists,true,'owned gear tab must survive block classification');assert.equal(owned.selected,'true');assert.equal(owned.tiles,1);assert.match(owned.text,/攻击徽章/);assert.match(owned.text,/本场临时增益/);assert.match(owned.text,/本场结束后消失/);
    await page.evaluate(()=>window.mountDetail({kind:'shop',slot:0}));
    const shopReferences=await page.evaluate(async()=>{const traits=document.querySelector('[role=tabpanel]').textContent;const tab=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='参考原卡');tab?.click();await new Promise(r=>requestAnimationFrame(r));return {traits,tabs:[...document.querySelectorAll('[role=tab]')].map(x=>x.textContent.trim()),selected:tab?.getAttribute('aria-selected'),text:document.querySelector('[role=tabpanel]').textContent};});
    assert.ok(shopReferences.tabs.includes('参考原卡'));assert.doesNotMatch(shopReferences.traits,/暴怒的巨蜥|亡语随从牌/);assert.equal(shopReferences.selected,'true');assert.match(shopReferences.text,/普通[\s\S]*亡语/);assert.match(shopReferences.text,/金色[\s\S]*亡语/);
    const shopReferenceScreenshot=await capture('shop-reference-tab.png');
    const shop=await page.evaluate(async()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.startsWith('装备'));if(!tab)return {exists:false};tab.click();await new Promise(r=>requestAnimationFrame(r));return {exists:true,selected:tab.getAttribute('aria-selected'),text:document.querySelector('[role=tabpanel]').textContent,tiles:document.querySelectorAll('.ix-dgear__tile').length};});
    assert.equal(shop.exists,true);assert.equal(shop.selected,'true');assert.equal(shop.tiles,1);assert.match(shop.text,/随干员获得/);assert.match(shop.text,/攻击徽章/);assert.doesNotMatch(shop.text,/本场临时增益/);assert.deepEqual(errors,[]);
    await page.evaluate(()=>window.mountBattleDetail());
    const battleReferences=await page.evaluate(async()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='参考原卡');if(!tab)return {exists:false};tab.click();await new Promise(r=>requestAnimationFrame(r));return {exists:true,selected:tab.getAttribute('aria-selected'),text:document.querySelector('[role=tabpanel]').textContent,stats:document.querySelector('.ix-dpanel__stats')?.textContent||''};});
    const battleReferenceScreenshot=await capture('battle-reference-tab.png');
    assert.equal(battleReferences.exists,true);assert.equal(battleReferences.selected,'true');assert.match(battleReferences.text,/普通[\s\S]*亡语/);assert.match(battleReferences.text,/金色[\s\S]*亡语/);assert.match(battleReferences.stats,/攻击/);assert.deepEqual(errors,[]);
    browserPhase='field-condition-default';await page.evaluate(()=>window.mountCondition());await page.waitForFunction(()=>window.highlightedCondition.length===3);
    const conditionView=await page.evaluate(()=>({text:document.querySelector('[role=tabpanel]').textContent,counts:[...document.querySelectorAll('.ix-field-count')].map(x=>x.textContent.trim()),highlighted:window.highlightedCondition}));
    assert.deepEqual(conditionView.counts,['（2）','（2）','（2）','（2）'],'normal and golden trait lines count deployed source operators when their own faction qualifies');assert.deepEqual(conditionView.highlighted,['condition-source','field-kjerag','field-kaz']);assert.doesNotMatch(conditionView.text,/当前符合条件|当前没有符合条件/);
    const conditionScreenshot=await capture('field-condition-inline-count.png');
    const countRect=await page.$eval('.ix-field-count',el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});await page.mouse.move(countRect.x,countRect.y);
    const hover=await page.evaluate(()=>({title:document.querySelector('.ix-field-count').title,highlighted:window.highlightedCondition}));
    assert.deepEqual(hover.highlighted,['condition-source','field-kjerag']);assert.match(hover.title,/当前场上符合这一效果条件/);
    await page.evaluate(()=>document.querySelector('.ix-field-count').focus());const focusHighlight=await page.evaluate(()=>window.highlightedCondition);assert.deepEqual(focusHighlight,['condition-source','field-kjerag'],'keyboard focus previews the same rule as hover');
    const secondRect=await page.evaluate(()=>{const el=document.querySelectorAll('.ix-field-count')[1];const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});await page.mouse.move(secondRect.x,secondRect.y);
    const secondHover=await page.evaluate(()=>window.highlightedCondition);assert.deepEqual(secondHover,['condition-source','field-kaz'],'hovering another condition narrows the board preview to its own matching rule');
    await page.evaluate(()=>window.moveConditionPiece('field-kjerag',4,4));await page.waitForFunction(()=>window.highlightedConditionPositions.some(p=>p.uid==='field-kjerag'&&p.row===4&&p.col===4));
    const movedHighlight=await page.evaluate(()=>window.highlightedConditionPositions);assert.ok(movedHighlight.some(p=>p.uid==='field-kjerag'&&p.row===4&&p.col===4),'position changes refresh highlighted tiles even when matching UIDs are unchanged');
    const skillTabRect=await page.evaluate(()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='技能');const r=tab.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});await page.mouse.click(skillTabRect.x,skillTabRect.y);
    const cleared=await page.evaluate(()=>({highlighted:window.highlightedCondition,tab:[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='技能')?.getAttribute('aria-selected')}));
    assert.equal(cleared.tab,'true');assert.deepEqual(cleared.highlighted,[],'switching away from traits clears only the detail condition highlight');assert.deepEqual(errors,[]);
    browserPhase='battle-condition';await page.evaluate(()=>window.mountBattleCondition());await page.waitForFunction(()=>window.highlightedCondition.length===2);
    const battleCondition=await page.evaluate(()=>({counts:[...document.querySelectorAll('.ix-field-count')].map(x=>x.textContent.trim()),highlighted:window.highlightedCondition}));
    assert.deepEqual(battleCondition.counts,['（1）','（1）','（1）','（1）']);assert.deepEqual(battleCondition.highlighted,['condition-source','field-kaz'],'battle detail candidates are restricted to units alive in the displayed frame');
    await page.evaluate(()=>window.mountEnemyDetail());const enemy=await page.evaluate(()=>({dialog:!!document.querySelector('[data-testid="ix-detail"]'),referenceTab:[...document.querySelectorAll('[role=tab]')].some(x=>x.textContent.trim()==='参考原卡')}));assert.equal(enemy.dialog,true);assert.equal(enemy.referenceTab,false);
    await page.evaluate(()=>window.mountSummonDetail());const summon=await page.evaluate(()=>({dialog:!!document.querySelector('[data-testid="ix-detail"]'),referenceTab:[...document.querySelectorAll('[role=tab]')].some(x=>x.textContent.trim()==='参考原卡')}));assert.equal(summon.dialog,true);assert.equal(summon.referenceTab,false);
    assert.deepEqual(errors,[]);
    if(process.env.SP_DETAIL_PANEL_REPORT)fs.writeFileSync(process.env.SP_DETAIL_PANEL_REPORT,JSON.stringify({ok:true,ownedTraits,ownedReference,returnedTraits,owned,shopReferences,shop,battleReferences,conditionView,hover,focusHighlight,secondHover,movedHighlight,cleared,battleCondition,enemy,summon,screenshots:[ownedReferenceScreenshot,traitsScreenshot,shopReferenceScreenshot,battleReferenceScreenshot,conditionScreenshot].filter(Boolean),pageErrors:errors,browserProfile,pageUrl:'127.0.0.1 ephemeral test server',browserArgs:['--disable-gpu','--disable-software-rasterizer'],gameRendererStarted:false},null,2)+'\n');
  }finally{clearTimeout(browserPhaseGuard);await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
