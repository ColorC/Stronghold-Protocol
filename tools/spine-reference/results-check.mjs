import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {previewServer} from './preview-server.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,list)=>i%2?a:[...a,[v.replace(/^--/,''),list[i+1]]],[]));
const here=path.dirname(fileURLToPath(import.meta.url)),install=args.install,out=args.out;
await fs.mkdir(out,{recursive:true});
const puppeteer=createRequire(path.join(install,'package.json'))('puppeteer-core');
const report={startedAt:new Date().toISOString(),checks:{},files:[],errors:[]};
let browser,server,timer;
try{await Promise.race([(async()=>{
 if(!args.url)server=await previewServer({publicRoot:path.resolve(here,'../../public'),installRoot:install});
 const base=args.url||server.url;
 browser=await puppeteer.launch({executablePath:'C:/Users/lilithgames/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe',headless:true,userDataDir:args.profile,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();await page.setViewport({width:1440,height:1080});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
 const resultUrl=base+'/dev/spine-reference/results.html';report.url=resultUrl;
 await page.goto(resultUrl,{waitUntil:'networkidle0',timeout:45000});await page.waitForFunction(()=>window.__ready||window.__error,{timeout:15000});
 report.checks.initial=await page.evaluate(()=>({ready:window.__ready,error:window.__error,cards:document.querySelectorAll('#cards .card').length,viewport:innerWidth,gridColumns:getComputedStyle(document.getElementById('cards')).gridTemplateColumns.split(' ').length,images:[...document.querySelectorAll('#cards img')].every(i=>i.complete&&i.naturalWidth>0),curves:[...document.querySelectorAll('.chart polyline')].every(i=>!i.getAttribute('points').includes('NaN')),textSelectable:getComputedStyle(document.body).userSelect,defaultView:new URL(location.href).searchParams.get('view')}));
 const init=report.checks.initial;if(!init.ready||init.cards!==6||init.viewport!==1440||init.gridColumns!==3||!init.images||!init.curves||init.textSelectable==='none')throw Error('默认视图或曲线检查失败');
 report.files.push({path:path.join(out,'results-desktop.png'),role:'默认原图视图'});await page.screenshot({path:report.files.at(-1).path,fullPage:true});
 await page.click('[data-view="bones"]');await page.waitForFunction(()=>[...document.querySelectorAll('#cards img')].every(i=>i.complete&&i.naturalWidth>0));
 const link=await page.evaluate(()=>document.getElementById('full').href);await page.goto(link+'#pose-2b-front',{waitUntil:'networkidle0',timeout:30000});
 report.checks.modeRoundTrip=await page.evaluate(()=>({view:new URL(location.href).searchParams.get('view'),pressed:document.querySelector('[data-view="bones"]').getAttribute('aria-pressed'),image:document.querySelector('#pose-2b-front img').src,hash:location.hash}));
 if(report.checks.modeRoundTrip.view!=='bones'||report.checks.modeRoundTrip.pressed!=='true')throw Error('骨架视图未按链接回载');
 report.checks.frameLinks=await page.evaluate(()=>[...document.querySelectorAll('#cards .frame')].map(a=>({href:a.href,source:new URL(a.href).searchParams.get('sources'),progress:new URL(a.href).searchParams.get('t'),original:new URL(a.href).searchParams.get('original')})));
 if(report.checks.frameLinks.some(l=>l.original!=='false')||new Set(report.checks.frameLinks.map(l=>l.source)).size!==6)throw Error('具体帧链接没有保留角色或画面模式');
 report.files.push({path:path.join(out,'results-bones.png'),role:'骨架模式，定位到2B'});await page.screenshot({path:report.files.at(-1).path});
 await page.goto(resultUrl+'#timing-surtr-front',{waitUntil:'networkidle0',timeout:30000});
 report.checks.deepLink=await page.evaluate(()=>({details:document.querySelector('#otherCharts').closest('details').open,top:document.querySelector('#timing-surtr-front').getBoundingClientRect().top}));
 if(!report.checks.deepLink.details||Math.abs(report.checks.deepLink.top)>100)throw Error('折叠曲线的链接没有展开并定位');
 await page.evaluate(()=>{window.__copied=null;Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copied=text},configurable:true});document.querySelector('#pose-2b-front img').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));});
 report.checks.contextLink=await page.evaluate(()=>window.__copied);if(!report.checks.contextLink?.endsWith('#pose-2b-front'))throw Error('右键复制没有定位到角色卡');
 await page.setViewport({width:390,height:844});await page.goto(resultUrl,{waitUntil:'networkidle0',timeout:30000});
 report.checks.mobile=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,cards:document.querySelectorAll('#cards .card').length}));if(report.checks.mobile.scrollWidth>report.checks.mobile.viewport+1)throw Error('手机视图横向溢出');
 report.files.push({path:path.join(out,'results-mobile.png'),role:'手机默认视图'});await page.screenshot({path:report.files.at(-1).path,fullPage:true});
 if(report.errors.length)throw Error(report.errors.join('\n'));report.passed=true;
})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('结果页检查超过120秒截止')),120000);})]);}
catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{clearTimeout(timer);if(browser)await browser.close();if(server)await server.close();report.finishedAt=new Date().toISOString();const file=path.join(out,'results-check.json');await fs.writeFile(file,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:file,files:report.files,error:report.error}));}
