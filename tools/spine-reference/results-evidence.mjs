import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,list)=>i%2?a:[...a,[v.replace(/^--/,''),list[i+1]]],[]));
const install=args.install, out=args.out;
if(!install||!out||!args.metrics)throw Error('需要 --install --out --metrics');
await fs.mkdir(out,{recursive:true});
const metrics=JSON.parse(await fs.readFile(args.metrics,'utf8'));
const titles={'2b-front':'2B','surtr-front':'史尔特尔','blkkgt-front':'锏','mlynar-front':'玛恩纳','skadi-front':'斯卡蒂','nearl2-front':'耀骑士临光'};
const data=metrics.map(m=>{const arm=m.arms[m.weaponSide];return {id:m.source,title:titles[m.source],clip:m.animation,duration:m.duration,progress:arm.wrist.peakProgress,elbow:arm.elbowAtHandPeak,elbowAngles:arm.elbowAngles,minimum:arm.elbowAngleRange[0],normalizer:m.normalizer};});
const require=createRequire(path.join(install,'package.json'));
const puppeteer=require('puppeteer-core');
const report={startedAt:new Date().toISOString(),metrics:args.metrics,out,frames:[],errors:[]};
let browser,timer;
try {
 await Promise.race([(async()=>{
  browser=await puppeteer.launch({executablePath:'C:/Users/lilithgames/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe',headless:true,userDataDir:args.profile,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage();await page.setViewport({width:1500,height:1000});
  page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto((args.url||'http://127.0.0.1:13000')+'/dev/spine-reference/compare.html',{waitUntil:'networkidle0',timeout:60000});
  await page.waitForFunction(()=>window.__ready||window.__error,{timeout:60000});
  if(await page.evaluate(()=>window.__error))throw Error(await page.evaluate(()=>window.__error));
  for(const d of data){
   const actual=await page.evaluate(({id,clip,progress})=>{
    const s=window.compare.states.get(id);if(s.animation.value!==clip)throw Error(`动画不匹配: ${id}`);
    const time=document.getElementById('time');time.value=String(progress);time.dispatchEvent(new Event('input'));
    const p=s.pose.landmarks,side=s.profile.weaponSide;
    const [a,b,c]=['shoulder','elbow','wrist'].map(x=>p[`arm.${side}.${x}`].position);
    const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]];
    const cosine=(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v));
    return {clip:s.animation.value,time:s.pose.time,elbow:Math.acos(Math.max(-1,Math.min(1,cosine)))*180/Math.PI};
   },d);
   if(Math.abs(actual.elbow-d.elbow)>0.1)throw Error(`姿态与记录相差超过0.1度: ${d.id}: ${actual.elbow}/${d.elbow}`);
   const stage=await page.$(`.col:has([data-source="${d.id}"]) .stage`);
   if(!stage)throw Error(`没有找到角色画面: ${d.id}`);
   for(const mode of ['bones','overlay']){
    await page.evaluate(mode=>{const box=document.getElementById('original');box.checked=mode==='overlay';box.dispatchEvent(new Event('change'));},mode);
    const file=path.join(out,`${d.id}-${mode}.png`);await stage.screenshot({path:file});
    report.frames.push({id:d.id,clip:d.clip,progress:d.progress,elbow:actual.elbow,file,mode});
   }
  }
  await fs.writeFile(path.join(out,'results-data.json'),JSON.stringify({sources:data,sourceModelCommit:'67bb26c2d3d6b9e5db12282a147759a3a7b84867',analysisCommit:'d7e1629fe3ba4cd9ccf11c242a81a4ef4713930b'},null,2));
 })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('姿态截图超过180秒截止')),180000);})]);
 if(report.errors.length)throw Error(report.errors.join('\n'));
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{clearTimeout(timer);if(browser)await browser.close();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'capture-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(out,'capture-verification.json'),out,error:report.error}));}
