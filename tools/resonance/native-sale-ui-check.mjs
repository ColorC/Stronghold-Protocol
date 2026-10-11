import {createRequire} from 'node:module';
import {readFile,writeFile,stat,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {getActivePrototypeSeason} from '../../shared/resonance/season-registry.js';
const ROOT='E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const SOURCE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const OUT=path.join(ROOT,'runtime/resonance/ui-verification');
const RECEIPT=path.join(OUT,'native-sale-factions.json');
const SHOT=path.join(OUT,'native-sale-factions-target.jpg');
const PROTECTED=path.join(ROOT,'runtime/resonance/player-sessions/53ffde79-85b3-4302-89f7-e0d792f78723.json');
const require=createRequire(path.join(ROOT,'package.json'));
const receipt={status:'running',startedAt:new Date().toISOString(),source:SOURCE,receipt:RECEIPT,screenshot:SHOT,ws:[],errors:[]};
try{const prior=JSON.parse(await readFile(RECEIPT,'utf8'));if(prior.receipt!==RECEIPT)throw new Error('Unrelated sale receipt');receipt.previousAttempts=[...(prior.previousAttempts??[]),{...prior,previousAttempts:undefined}];}catch(e){if(e.code!=='ENOENT')throw e;}
const before=await stat(PROTECTED,{bigint:true});
let browser,page;
const timer=setTimeout(()=>{receipt.timeout=true;void browser?.close();},180000);
try{
  await mkdir(OUT,{recursive:true});
  browser=await require('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
    userDataDir:path.join(ROOT,'.omni/tmp/resonance/browser-profile'),timeout:30000,
    args:['--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-dev-shm-usage']});
  page=await browser.newPage();await page.setViewport({width:1440,height:900});await page.setCacheEnabled(false);
  page.on('pageerror',e=>receipt.errors.push(e.message));
  const cdp=await page.createCDPSession();await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameSent',e=>{try{const m=JSON.parse(e.response.payloadData);if(m.t?.startsWith('g.'))receipt.ws.push({t:m.t,uid:m.uid,itemUid:m.itemUid,targetUid:m.targetUid});}catch{}});
  await page.goto('http://127.0.0.1:13001/resonance.html?seed=470',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForSelector('.rs-title-fullscreen',{timeout:20000});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(n=>n.innerText.includes('开始整备')).click());
  await page.waitForSelector('.rs-difficulty-feature__next');await page.click('.rs-difficulty-feature__next');
  await page.waitForFunction(()=>new URL(location.href).searchParams.has('session'),{timeout:25000});
  receipt.sessionId=new URL(page.url()).searchParams.get('session');
  assert.notEqual(receipt.sessionId,'53ffde79-85b3-4302-89f7-e0d792f78723');
  await page.waitForFunction(()=>[...document.querySelectorAll('.brief__foot button')].some(n=>n.innerText.includes('准备就绪')&&!n.disabled),{timeout:15000});
  await page.evaluate(()=>[...document.querySelectorAll('.brief__foot button')].find(n=>n.innerText.includes('准备就绪')&&!n.disabled).click());
  await page.waitForFunction(()=>!document.querySelector('.pbanner--overlay')&&globalThis.__SP_VIEW__?.pieceScreenRect&&document.querySelector('.shopbar'),{timeout:45000});
  await page.waitForFunction(async()=>{const {store}=await import('./js/store.js');return store.get().match.public?.phase==='PREP';},{timeout:20000});
  const state=()=>page.evaluate(async()=>{const {store}=await import('./js/store.js');return store.get().match.private.resonance.state;});
  const initial=await state(),piece=initial.pieces.find(p=>p.row==null);assert(piece);
  receipt.seasonId=initial.seasonId;assert.equal(initial.seasonId,getActivePrototypeSeason().id);
  receipt.before={uid:piece.uid,nativeUid:piece.nativeUid,gold:initial.gold,inventory:initial.inventory};
  const item=initial.inventory.find(i=>Number.isSafeInteger(i.nativeUid));assert(item);
  // The normal client intent equips one genuinely owned starting component;
  // the sale under test is performed solely with physical browser pointers.
  const equipped=await page.evaluate(async({item,piece})=>{const {actions}=await import('./js/ui/gameActions.js');return actions.equip(item,piece);},{item:item.nativeUid,piece:piece.nativeUid});
  assert(equipped,'owned starter equipment must equip');
  await page.waitForFunction(async uid=>{const {store}=await import('./js/store.js');return store.get().match.private.resonance.state.pieces.some(p=>p.nativeUid===uid&&p.equipment.length>0);},{timeout:8000},piece.nativeUid);
  const point=()=>page.waitForFunction(uid=>{const v=globalThis.__SP_VIEW__,r=v?.pieceScreenRect(uid);if(!r)return false;for(let y=r.top+2;y<r.bottom-2;y+=3)for(let x=r.left+2;x<r.right-2;x+=3)if(document.elementFromPoint(x,y)?.tagName==='CANVAS'&&Number(v.pieceAtClient(x,y)?.uid)===uid)return{x,y};return false;},{timeout:12000},Number(piece.nativeUid)).then(h=>h.jsonValue());
  const startDrag=async()=>{const p=await point();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+32,p.y-20,{steps:5});await page.waitForSelector('.rs-native-sell-zone',{timeout:4000});return p;};
  let p=await startDrag();const cancelOffset=receipt.ws.length;await page.mouse.move(p.x,p.y,{steps:5});await page.mouse.up();
  await page.waitForFunction(()=>!document.querySelector('.rs-native-sell-zone'),{timeout:3000});
  const cancelled=await state();assert(cancelled.pieces.some(x=>x.uid===piece.uid));assert.equal(cancelled.gold,initial.gold);
  assert(!receipt.ws.slice(cancelOffset).some(x=>x.t==='g.sell'));receipt.cancelledWithoutSale=true;
  await startDrag();
  receipt.target=await page.$eval('.rs-native-sell-zone',n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n),shop=n.parentElement.querySelector('.shopbar')?.getBoundingClientRect();return{rect:r.toJSON(),shop:shop?.toJSON(),text:n.innerText,pointerEvents:s.pointerEvents,fontSize:s.fontSize,background:s.backgroundColor,border:s.borderColor,radius:s.borderRadius};});
  const r=receipt.target.rect;assert(r.height<=50);assert.equal(receipt.target.pointerEvents,'auto');assert(parseFloat(receipt.target.fontSize)>=18);
  receipt.expectedRefund=Number(receipt.target.text.match(/\+(\d+)/)?.[1]);assert(Number.isFinite(receipt.expectedRefund)&&receipt.expectedRefund>0);
  const at={x:r.x+r.width/2,y:r.y+r.height/2};await page.mouse.move(at.x,at.y,{steps:12});
  receipt.target.hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.rs-native-sell-zone')!==null,at);assert(receipt.target.hit);
  await page.screenshot({path:SHOT,type:'jpeg',quality:80});
  const saleOffset=receipt.ws.length;await page.mouse.up();
  await page.waitForFunction(async uid=>{const {store}=await import('./js/store.js');return !store.get().match.private.resonance.state.pieces.some(p=>p.uid===uid);},{timeout:8000},piece.uid);
  const after=await state();receipt.after={gold:after.gold,pieces:after.pieces.length,inventory:after.inventory};
  assert.equal(receipt.ws.slice(saleOffset).filter(m=>m.t==='g.sell').length,1,'drop must send exactly one sale');
  assert.equal(after.gold,initial.gold+receipt.expectedRefund,'sale refunds exactly the displayed amount');assert(after.inventory.some(i=>i.uid===item.uid),'sale returns the equipped component');
  assert.equal(await page.$('.rs-native-sell-zone'),null,'sale target disappears after release');
  assert.equal(receipt.errors.length,0,receipt.errors.join('\n'));receipt.status='passed';
}catch(e){receipt.status='failed';receipt.failure=e.stack;process.exitCode=1;}
finally{
  clearTimeout(timer);await browser?.close().catch(()=>{});const after=await stat(PROTECTED,{bigint:true});
  receipt.protectedSaveUnchanged=before.size===after.size&&before.mtimeNs===after.mtimeNs;
  if(!receipt.protectedSaveUnchanged){receipt.status='failed';process.exitCode=1;}
  receipt.finishedAt=new Date().toISOString();await writeFile(RECEIPT,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({status:receipt.status,receipt:RECEIPT,screenshot:receipt.target?SHOT:null,failure:receipt.failure,protectedSaveUnchanged:receipt.protectedSaveUnchanged}));
}
