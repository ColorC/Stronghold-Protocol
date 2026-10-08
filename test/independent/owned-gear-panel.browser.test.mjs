import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const enabled=process.env.DETAIL_PANEL_E2E==='1';
test('owned and shop detail gear panes render through real Preact and preserve temporary growth', {skip:enabled?false:'set DETAIL_PANEL_E2E=1 for CPU-only DOM browser verification',timeout:90000}, async()=>{
  const {getCatalog}=await import('../../server/modes/independent/catalog.js');
  const {getData}=await import('../../server/data.js');
  const {independentDisplayCatalog}=await import('../../server/modes/independent/display.js');
  const puppeteer=(await import('puppeteer-core')).default;
  const game=getData(), rawCatalog=getCatalog(game),catalog=independentDisplayCatalog(game,rawCatalog);
  const op=Object.values(rawCatalog.operators).find(x=>x.name==='阿罗玛'&&!x.elite);
  assert.ok(op);
  const piece={uid:'owned-pane-piece',chessId:op.chessId,elite:false,skillIndex:0,moduleId:'none',factions:op.nativeFactionTags,equipment:[{uid:'worn-attack',id:'precision',quantity:2}],attachments:[],startStats:{...op.source.normalChess.stats,temporaryGrowth:[{attackUnits:1,secondaryUnits:1}]}};
  const fixture={catalog,state:{phase:'prep',growthMode:'badges',funds:10,pieces:[piece],shop:{slots:[{id:op.chessId,kind:'chess',price:3,sold:false,equipment:[{id:'precision',quantity:1}]}]},inventory:[]}};
  const boot=`<!doctype html><div id="root"></div><script type="module">
    import {h,render} from '/vendor/preact.module.js';
    import {DetailCard} from '/js/independent/detail.js';
    import {loadData} from '/js/data.js';
    const fixture=await (await fetch('/fixture.json')).json();
    await loadData('chess','assets','bonds','items','garrisons','tokens','config');
    window.mountDetail=(target)=>{render(null,document.querySelector('#root'));render(h(DetailCard,{...fixture,target,busy:false,onClose(){},onAct(){},onInherit(){},onBuy(){},onEquipHere(){}}),document.querySelector('#root'));};
    window.mountDetail({kind:'piece',uid:'owned-pane-piece'});window.ready=true;
  </script>`;
  const installation=path.resolve(process.env.SP_INSTALL_ROOT||ROOT),dataRoot=path.resolve(process.env.SP_DATA_DIR||path.join(ROOT,'data'));
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost'),name=url.pathname;
    if(name==='/'){res.setHeader('content-type','text/html');return res.end(boot);}
    if(name==='/fixture.json'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(fixture));}
    const file=name.startsWith('/vendor/')?path.join(installation,'public',name):name.startsWith('/data/')?path.join(dataRoot,path.basename(name)):name.startsWith('/shared/')?path.join(ROOT,name):path.join(ROOT,'public',name);
    if(/\.(?:js|json)$/.test(name)&&fs.existsSync(file)){res.setHeader('content-type',name.endsWith('.js')?'text/javascript':'application/json');return res.end(fs.readFileSync(file));}
    res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;const errors=[];
  try{
    browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu','--disable-software-rasterizer','--no-first-run','--no-default-browser-check','--no-sandbox']});
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>window.ready,{timeout:30000});
    const owned=await page.evaluate(async()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.startsWith('装备'));if(!tab)return {tabs:[...document.querySelectorAll('[role=tab]')].map(x=>x.textContent),exists:false};tab.click();await new Promise(r=>requestAnimationFrame(r));return {exists:true,selected:tab.getAttribute('aria-selected'),text:document.querySelector('[role=tabpanel]').textContent,tiles:document.querySelectorAll('.ix-dgear__tile').length,temporary:!!document.querySelector('[role=tabpanel] .ix-detail__text')};});
    assert.equal(owned.exists,true,'owned gear tab must survive block classification');assert.equal(owned.selected,'true');assert.equal(owned.tiles,1);assert.match(owned.text,/攻击徽章/);assert.match(owned.text,/本场临时增益/);assert.match(owned.text,/本场结束后消失/);
    await page.evaluate(()=>window.mountDetail({kind:'shop',slot:0}));
    const shop=await page.evaluate(async()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.startsWith('装备'));if(!tab)return {exists:false};tab.click();await new Promise(r=>requestAnimationFrame(r));return {exists:true,selected:tab.getAttribute('aria-selected'),text:document.querySelector('[role=tabpanel]').textContent,tiles:document.querySelectorAll('.ix-dgear__tile').length};});
    assert.equal(shop.exists,true);assert.equal(shop.selected,'true');assert.equal(shop.tiles,1);assert.match(shop.text,/随干员获得/);assert.match(shop.text,/攻击徽章/);assert.doesNotMatch(shop.text,/本场临时增益/);assert.deepEqual(errors,[]);
    if(process.env.SP_DETAIL_PANEL_REPORT)fs.writeFileSync(process.env.SP_DETAIL_PANEL_REPORT,JSON.stringify({ok:true,owned,shop,pageErrors:errors,browserArgs:['--disable-gpu','--disable-software-rasterizer'],gameRendererStarted:false},null,2)+'\n');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
