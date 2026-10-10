import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { getData } from '../../server/data.js';
import { independentDisplayCatalog } from '../../server/modes/independent/display.js';

const ROOT=path.resolve(import.meta.dirname,'../..');
const enabled=process.env.SHOP_FACTIONS_E2E==='1';
test('actual ShopBar shows complete native factions for every normal and elite operator', {skip:enabled?false:'set SHOP_FACTIONS_E2E=1',timeout:120000}, async()=>{
  const puppeteer=(await import('puppeteer-core')).default;
  const game=getData(),raw=getCatalog(game),catalog=independentDisplayCatalog(game,raw);
  const installation=path.resolve(process.env.SP_INSTALL_ROOT||ROOT);
  const output=process.env.SP_SHOP_FACTION_REPORT_DIR;
  assert.ok(output&&path.isAbsolute(output),'absolute report directory required');fs.mkdirSync(output,{recursive:true});
  const active=Object.values(raw.operators).filter(op=>op.recruitable);
  const all=[...new Set(active.flatMap(op=>[op.chessId,op.eliteChessId].filter(Boolean)))];
  const examples=['九色鹿','酸糖','杰西卡','刺玫','歌蕾蒂娅','贾维'];
  const exampleIds=examples.map(name=>active.find(op=>op.name===name&&!op.elite)?.chessId);assert.ok(exampleIds.every(Boolean));
  const css=fs.readFileSync(path.join(ROOT,'public/independent.html'),'utf8').match(/<link rel="stylesheet"[^>]+>/g).join('\n');
  const boot=`<!doctype html><html lang="zh-CN" class="ix-ws"><head><meta charset="utf-8"><link rel="icon" href="data:,">${css}<style>#root{width:100%;height:100vh}.ix-shop{bottom:0}</style></head><body><div id="root"></div><script type="module">
    import {h,render} from '/vendor/preact.module.js';
    import {ShopBar} from '/js/independent/hud.js';
    import {DetailCard} from '/js/independent/detail.js';
    import {loadData} from '/js/data.js';
    const fixture=await (await fetch('/fixture.json')).json();
    await loadData('chess','assets','bonds','items','garrisons','config');
    window.mountShop=ids=>{const state={phase:'prep',growthMode:'badges',funds:30,pieces:[],shop:{level:3,upgradePrice:7,slots:ids.map(id=>({id,kind:'chess',price:3,equipment:[]}))}};render(h(ShopBar,{state,catalog:fixture.catalog,deployed:0,deployCap:8,onArm(){},onBuy(){},onUpgrade(){},onRefresh(){},onFreeze(){},onDetail(){}}),document.querySelector('#root'));};
    window.mountReference=id=>{const state={phase:'prep',growthMode:'badges',funds:30,pieces:[],inventory:[],shop:{level:3,slots:[{id,kind:'chess',price:3,equipment:[]}]}};render(null,document.querySelector('#root'));render(h(DetailCard,{state,catalog:fixture.catalog,target:{kind:'shop',slot:0,tab:'reference'},onClose(){},onAct(){},onBuy(){},onInherit(){},onEquipHere(){}}),document.querySelector('#root'));};
    window.ready=true;
  </script></body></html>`;
  const missing=[];const server=http.createServer(async(req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname;
    if(name==='/'){res.setHeader('content-type','text/html');return res.end(boot);}
    if(name==='/fixture.json'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({catalog}));}
    const file=name.startsWith('/vendor/')||name.startsWith('/assets/')||name.startsWith('/fonts/')?path.join(installation,'public',name):name.startsWith('/data/')?path.join(ROOT,'data',path.basename(name)):name.startsWith('/shared/')?path.join(ROOT,name):path.join(ROOT,'public',name);
    if(fs.existsSync(file)){const mime={'.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2'}[path.extname(file).toLowerCase()];if(mime){res.setHeader('content-type',mime);return res.end(fs.readFileSync(file));}}
    missing.push({name,file});res.statusCode=404;res.end('missing');
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser,context;const pageErrors=[],consoleErrors=[];const screenshots=[],cards=[];
  const timer=setTimeout(()=>{void context?.close();server.close();},110000);
  try{
    browser=await puppeteer.connect({browserURL:process.env.SP_SHOP_FACTION_CDP||'http://127.0.0.1:12703'});context=await browser.createBrowserContext();const page=await context.newPage();await page.setViewport({width:1600,height:900});
    page.on('pageerror',error=>pageErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    const origin='http://127.0.0.1:'+server.address().port;await page.goto(origin,{waitUntil:'domcontentloaded',timeout:20000});await page.waitForFunction(()=>window.ready,{timeout:30000});
    const mount=async ids=>{await page.evaluate(ids=>window.mountShop(ids),ids);await page.waitForFunction(n=>document.querySelectorAll('.scard__name').length===n,{timeout:10000},ids.length);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
    for(let index=0;index<all.length;index+=6){const ids=all.slice(index,index+6);await mount(ids);const labels=await page.$$eval('.scard',els=>els.map(el=>({name:el.querySelector('.scard__name')?.textContent,labels:[...el.querySelectorAll('.scard__bond>span')].map(node=>node.textContent.trim()),watermark:!!el.querySelector('.scard__water img,.scard__water .bglyph')})));
      for(let i=0;i<ids.length;i++){const op=catalog.operators[ids[i]];assert.deepEqual(labels[i].labels,op.nativeFactions,ids[i]);assert.ok(labels[i].labels.length,ids[i]);cards.push({id:ids[i],elite:op.elite,...labels[i]});}
    }
    await mount(exampleIds);await page.waitForFunction(()=>[...document.querySelectorAll('.scard__bond img')].every(img=>img.complete&&img.naturalWidth>0),{timeout:15000});const exampleImage=path.join(output,'shop-all-native-factions.png');await page.screenshot({path:exampleImage,fullPage:true});screenshots.push(exampleImage);
    for(const name of ['歌蕾蒂娅','贾维']){const id=exampleIds[examples.indexOf(name)];await page.evaluate(id=>window.mountReference(id),id);await page.waitForFunction(()=>document.querySelector('.ix-sourcecard')||document.body.textContent.includes('攻击 4'),{timeout:10000});const text=await page.$eval('#root',el=>el.textContent);assert.ok(text.includes(name==='歌蕾蒂娅'?'巨大的金刚鹦鹉':'驯兽师'));assert.ok(text.includes('攻击 4'));assert.ok(text.includes('生命 3'));assert.ok(text.includes('攻击 8'));assert.ok(text.includes('生命 6'));const image=path.join(output,name==='歌蕾蒂娅'?'gladiia-reference.png':'chiave-reference.png');await page.screenshot({path:image,fullPage:true});screenshots.push(image);}
    assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(missing,[]);
    const factionIconUrls=[...new Set(cards.flatMap(card=>card.labels).map(f=>catalog.factionDetails[f]?.iconUrl||catalog.factionDetails[f]?.url).filter(Boolean))];
    const iconChecks=[];for(const url of factionIconUrls){const response=await fetch(new URL(url,origin));assert.equal(response.status,200,url);iconChecks.push({url,status:response.status,bytes:(await response.arrayBuffer()).byteLength});}
    const report={ok:true,ordinary:active.filter(op=>!op.elite).length,elite:active.filter(op=>op.elite).length,cards,iconChecks,screenshots,pageErrors,consoleErrors,missing};fs.writeFileSync(path.join(output,'shop-factions-browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:true,report:path.join(output,'shop-factions-browser-report.json'),screenshots,cards:cards.length,iconChecks:iconChecks.length,pageErrors}));
  }finally{clearTimeout(timer);await context?.close();browser?.disconnect();await new Promise(resolve=>server.close(resolve));}
});
