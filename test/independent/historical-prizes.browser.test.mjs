import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {getData} from '../../server/data.js';
import {getCatalog} from '../../server/modes/independent/catalog.js';
import {createSession,applyAction,viewSession} from '../../server/modes/independent/session.js';
import {independentDisplayCatalog} from '../../server/modes/independent/display.js';
import {makePrizeOffer} from '../../server/modes/independent/prizes.js';
import {getIndependentField} from '../../server/modes/independent/battle.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const canonical=process.env.SP_INSTALL_ROOT||'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const enabled=process.env.DARKMOON_PRIZE_E2E==='1';
test('production prize inventory/offer, native Jessica detail/reference/skills, decoded icons and battlefield Spine', {skip:!enabled,timeout:240000},async()=>{
 const startedAt=new Date().toISOString(),deadlineAt=new Date(Date.now()+220000).toISOString();
 const output=process.env.SP_TEST_ARTIFACT_DIR||path.join(canonical,'runtime/recording-dev-20261009/economy-and-summons-20261010/economy/browser');fs.mkdirSync(output,{recursive:true});
 const game=getData(),raw=getCatalog(game),catalog=independentDisplayCatalog(game,raw);
 let state=createSession({seed:331,roundLimit:18});state.offers=[{id:'test-award',type:'prize',choices:['darkmoon-prize:SCH_149']}];state.phase='prize';
 const gained=applyAction(state,{type:'choose',offerId:'test-award',index:0},{data:game,catalog:raw});assert.equal(gained.ok,true,gained.error?.message);state=gained.state;
 const award=state.pieces[0];const [row,col]=viewSession(state,{data:game,catalog:raw}).pieces[0].legalTiles[0].split(',').map(Number);state=applyAction(state,{type:'move',uid:award.uid,row,col},{data:game,catalog:raw}).state;
 state.inventory=Object.values(raw.prizes).filter(p=>p.historical&&p.params.sourceId!=='SCH_149').map((p,i)=>({uid:'i'+(10000+i),id:p.id,quantity:1,state:{}}));
 const offers={};for(const tier of ['start','build','cashout','finale'])offers[tier]=makePrizeOffer(createSession({seed:331,roundLimit:18}),raw,tier);
 const fixture={catalog,state:viewSession(state,{data:game,catalog:raw}),awardUid:award.uid,stage:getIndependentField(state,{data:game,catalog:raw}).stage,offers};
 const boot=`<!doctype html><html lang="zh-CN" class="ix-ws"><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/screens/game-panels.css"><link rel="stylesheet" href="/css/independent.css"><link rel="stylesheet" href="/css/workshop.css"></head><body><div id="root" class="ix-game"></div><div id="field" style="position:absolute;inset:0;width:100vw;height:100vh"></div><script type="module">
 import {h,render} from '/vendor/preact.module.js';import {DetailCard} from '/js/independent/detail.js';import {InventoryPanel,OfferOverlay} from '/js/independent/panels.js';import {loadData,data} from '/js/data.js';import {independentGrowthCatalog} from '/shared/independentPrizeText.js';
 const f=await(await fetch('/fixture.json')).json();await loadData('chess','assets','bonds','items','garrisons','tokens','enemies','config');window.actions=[];
 const props=mode=>({...f,state:{...f.state,growthMode:mode},catalog:independentGrowthCatalog(f.catalog,mode),busy:false,onClose(){},onAct(a){window.actions.push(a);return true;},onInherit(){},onBuy(){},onEquipHere(){}});
 window.mountInventory=(mode='badges',id='darkmoon-prize:BGS_Treasures_000')=>{render(null,document.querySelector('#root'));render(h(InventoryPanel,{...props(mode),open:true,focus:id+':n',targetUid:f.awardUid,onTarget(){}}),document.querySelector('#root'));};
 window.mountOffer=(mode='badges',tier='start')=>{render(null,document.querySelector('#root'));render(h(OfferOverlay,{...props(mode),offer:f.offers[tier],onChoose(a){window.actions.push(a);}}),document.querySelector('#root'));};
 window.mountDetail=(mode='badges')=>{render(null,document.querySelector('#root'));render(h(DetailCard,{...props(mode),target:{kind:'piece',uid:f.awardUid}}),document.querySelector('#root'));};
 window.mountField=async()=>{render(null,document.querySelector('#root'));const {assets}=await import('/js/assets.js');const {createFieldView}=await import('/js/render/app.js');assets.seed(data.get('assets'));window.field=await createFieldView(document.querySelector('#field'),{data,assets,board:'2d',settings:{quality:'medium'},tierChips:'pips'});window.field.setStage(f.stage);window.field.setCamera('prep');const p=f.state.pieces[0];window.field.setPrep({board:[{uid:334,kind:'chess',id:p.chessId,row:p.row,col:p.col,dir:p.dir,golden:false,items:[],tier:6}],hand:Array(10).fill(null),temp:Array(5).fill(null)},{editable:false});};
 window.mountInventory();window.ready=true;
 </script></body></html>`;
 const requests=[],missing=[];
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');if(u.pathname==='/'){res.setHeader('content-type','text/html');return res.end(boot);}if(u.pathname==='/fixture.json'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(fixture));}
  const name=decodeURIComponent(u.pathname);const file=name.startsWith('/sim/')?path.join(ROOT,'server',name):name==='/data/local-assets.json'?path.join(canonical,'data','local-assets.json'):name.startsWith('/data/')?path.join(ROOT,'data',path.basename(name)):name.startsWith('/shared/')?path.join(ROOT,name):['/vendor/','/assets/','/fonts/'].some(prefix=>name.startsWith(prefix))?path.join(canonical,'public',name):path.join(ROOT,'public',name);
  const ext=path.extname(file).toLowerCase(),mime={'.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.atlas':'text/plain','.skel':'application/octet-stream'}[ext];
  if(fs.existsSync(file)&&mime){res.setHeader('content-type',mime);requests.push({url:name,status:200,file});return res.end(fs.readFileSync(file));}missing.push({url:name,file});res.statusCode=404;res.end('missing');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const puppeteer=(await import('puppeteer-core')).default;let browser;const errors=[];const screenshots=[];const checks={};let browserPid=null;
 try{
  const profile=path.join(canonical,'.omni/tmp/economy/browser-profile');fs.mkdirSync(profile,{recursive:true});
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:profile,timeout:60000,args:['--no-first-run','--no-default-browser-check','--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});browserPid=browser.process()?.pid;
  const page=await browser.newPage();await page.setViewport({width:1600,height:900});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.ready);
  await page.waitForFunction(()=>{const images=[...document.querySelectorAll('.ix-inv__grid img')];return images.length===29&&images.every(x=>x.complete&&x.naturalWidth>0);});
  checks.icons=await page.evaluate(()=>[...document.querySelectorAll('.ix-inv__grid img')].map(x=>({src:x.currentSrc,width:x.naturalWidth,height:x.naturalHeight})));assert.equal(checks.icons.length,29);assert.ok(checks.icons.every(x=>x.width>0&&x.height>0));
  checks.inventoryText=await page.$eval('.ix-inv__sel',x=>x.innerText);assert.match(checks.inventoryText,/攻击徽章/);await page.evaluate(()=>[...document.querySelectorAll('.ix-inv__act button')].find(x=>x.textContent==='使用').click());assert.equal(await page.$$('.ix-usepick .ix-chip').then(x=>x.length)>0,true);assert.equal(await page.$$('.ix-offer').then(x=>x.length),0,'targeted card uses inline selection');
  await page.evaluate(()=>[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='参考原卡').click());checks.prizeReference=await page.$eval('.ix-original-card',x=>x.innerText);assert.match(checks.prizeReference,/大香蕉/);assert.ok(checks.prizeReference.includes('+2/+2'));
  for(const tier of ['start','build','cashout','finale']){await page.evaluate(t=>window.mountOffer('badges',t),tier);assert.equal(await page.$$('.ix-choice--prize').then(x=>x.length),3);}
  await page.evaluate(()=>window.mountInventory('levels'));checks.levelInventory=await page.$eval('.ix-inv__sel',x=>x.innerText);assert.match(checks.levelInventory,/4级训练/);assert.doesNotMatch(checks.levelInventory,/攻击徽章|伤害徽章/);
  await page.evaluate(()=>window.mountDetail());await page.waitForSelector('[data-testid="ix-detail"]');assert.match(await page.$eval('[data-testid="ix-detail"]',x=>x.innerText),/涤火杰西卡/);await page.evaluate(()=>[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='参考原卡').click());checks.jessicaReference=await page.$eval('.ix-original-card',x=>x.innerText);assert.match(checks.jessicaReference,/攻击 1 · 生命 1/);assert.match(checks.jessicaReference,/攻击 2 · 生命 2/);assert.match(checks.jessicaReference,/两倍/);assert.doesNotMatch(checks.jessicaReference,/死神4000/);
  await page.evaluate(()=>[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='技能').click());checks.skillPanel=await page.$eval('[role=tabpanel]',x=>x.innerText);assert.ok(checks.skillPanel.length>0);const detailShot=path.join(output,'prize-jessica-detail.png');await page.screenshot({path:detailShot});screenshots.push(detailShot);
  await page.evaluate(()=>window.mountDetail('levels'));checks.levelJessica=await page.$eval('[role=tabpanel]',x=>x.innerText);assert.match(checks.levelJessica,/训练/);assert.doesNotMatch(checks.levelJessica,/攻击徽章|生命徽章/);
  await page.evaluate(()=>window.mountField());await page.waitForFunction(()=>window.field?.debug.views.get('p:334')?.actor?.spine?.skeleton?.data?.animations?.length>0,{timeout:60000});checks.spine=await page.evaluate(()=>{const v=window.field.debug.views.get('p:334');return {defId:v.info.defId,spineId:v.info.spine,animations:v.actor.spine.skeleton.data.animations.map(a=>a.name),bounds:v.bounds(),entry:v.entry};});assert.equal(checks.spine.defId,'chess_prize_jesca2_a');assert.ok(checks.spine.bounds.width>0&&checks.spine.bounds.height>0);const spineShot=path.join(output,'prize-jessica-native-spine.png');await page.screenshot({path:spineShot});screenshots.push(spineShot);
  assert.deepEqual(errors,[]);assert.deepEqual(missing.filter(x=>x.url!=='/data/local-assets.json'),[]);
  fs.writeFileSync(path.join(output,'browser-receipt.json'),JSON.stringify({ok:true,nodePid:process.pid,browserPid,startedAt,endedAt:new Date().toISOString(),deadlineAt,checks,requests,optionalMissing:missing.filter(x=>x.url==='/data/local-assets.json'),screenshots,pageErrors:errors,scope:'controlled production component UI and actual native renderer; not a full match recording'},null,2));
 }catch(e){fs.writeFileSync(path.join(output,'browser-receipt.json'),JSON.stringify({ok:false,nodePid:process.pid,browserPid,startedAt,endedAt:new Date().toISOString(),deadlineAt,error:e.message,checks,requests,missing,screenshots,pageErrors:errors},null,2));throw e;}
 finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});
