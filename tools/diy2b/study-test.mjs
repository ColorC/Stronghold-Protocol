// Actual Spine runtime contact/gesture checks and separate-part screenshots.
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
export const STUDY_USAGE='Usage: node tools/diy2b/study-test.mjs <url> <absolute-output-directory> [candidate-checkout]';
export async function runStudyTest(url,out,candidate){
if(typeof url!=='string'||!url.trim()||typeof out!=='string'||!out.trim())throw new TypeError(STUDY_USAGE);
const puppeteer=createRequire('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/package.json')('puppeteer-core');
fs.mkdirSync(out,{recursive:true});let browser;const deadline=setTimeout(()=>{browser?.close().finally(()=>process.exit(124))},120000);
const report={url,candidate:candidate||null,errors:[],clips:[],screens:[]};
try{
browser=await puppeteer.launch({executablePath:'C:/Users/lilithgames/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();await page.setViewport({width:1000,height:800});page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`)});
if(candidate){await page.setRequestInterception(true);page.on('request',r=>{const relative=new URL(r.url()).pathname.match(/\/dev\/(diy-2b\/.*)$/)?.[1];if(relative&&!relative.includes('..')){const f=path.join(candidate,'public/dev',relative);if(fs.existsSync(f))return r.respond({status:200,contentType:{'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png'}[path.extname(f)]||'text/plain',body:fs.readFileSync(f)})}r.continue()})}
for(const side of ['front','back'])for(const clip of ['Attack','Skill_1','Stun_Skill_3','Skill_3_End']){
const u=new URL(url);u.searchParams.set('side',side);u.searchParams.set('action',clip);await page.goto(u.href,{waitUntil:'networkidle2',timeout:45000});await page.waitForFunction(()=>window.__motion?.ready,{timeout:30000});
const metrics=await page.evaluate(clip=>{
 const d=window.__motion,sp=d.sp(),duration=sp.spineData.findAnimation(clip).duration,p=n=>{const b=sp.skeleton.findBone(n);return [b.matrix.tx,-b.matrix.ty]};let frames=[];
 for(let i=0;i<=Math.ceil(duration*120);i++){const t=Math.min(i/120,duration);d.pose(t);let f={t};for(const n of ['foot_r','foot_l','shin_r','shin_l','sword','sword_tip','hand_r'])f[n]=p(n);frames.push(f)}
 const maxFootDrift=Math.max(...frames.map(f=>Math.max(...['r','l'].map(s=>Math.hypot(f['foot_'+s][0]-frames[0]['foot_'+s][0],f['foot_'+s][1]-frames[0]['foot_'+s][1])))));
 const bladeAngles=frames.map(f=>Math.atan2(f.sword_tip[1]-f.sword[1],f.sword_tip[0]-f.sword[0])*180/Math.PI);
 const bladeLength=frames.map(f=>Math.hypot(f.sword_tip[0]-f.sword[0],f.sword_tip[1]-f.sword[1]));
 const kneeHeights=frames.map(f=>[f.shin_r[1],f.shin_l[1]]);
 return {clip,duration,maxFootDrift,bladeRange:Math.max(...bladeAngles)-Math.min(...bladeAngles),bladeLengthRange:Math.max(...bladeLength)-Math.min(...bladeLength),minFootY:Math.min(...frames.flatMap(f=>[f.foot_r[1],f.foot_l[1]])),minTipY:Math.min(...frames.map(f=>f.sword_tip[1])),kneeYMin:Math.min(...kneeHeights.flat()),kneeYMax:Math.max(...kneeHeights.flat()),frames};
},clip);
metrics.side=side;report.clips.push(metrics);
if(['Attack','Skill_1'].includes(clip)&&metrics.maxFootDrift>.1)report.errors.push(`${side} ${clip}: support foot moved ${metrics.maxFootDrift}`);
if(['Attack','Skill_1'].includes(clip)&&metrics.bladeRange<120)report.errors.push(`${side} ${clip}: blade never makes a broad sweep`);
if(metrics.minFootY<0)report.errors.push(`${side} ${clip}: foot passed below floor`);
if(metrics.minTipY<-4)report.errors.push(`${side} ${clip}: blade passed below floor`);
if(metrics.bladeLengthRange>.01)report.errors.push(`${side} ${clip}: blade resized`);
if(clip==='Stun_Skill_3'&&(metrics.kneeYMin<29.9||metrics.kneeYMax>30.1))report.errors.push(`${side}: both knees must keep their contact plane`);
for(const part of ['all','legs','arms','blade']){const visible=await page.evaluate(([part,t])=>{window.__motion.part(part);window.__motion.pose(t);document.querySelector('#bones').checked=part==='legs';const sp=window.__motion.sp();return sp.skeleton.slots.filter((s,i)=>sp.slotContainers[i].visible).map(s=>s.data.name)},[part,clip==='Stun_Skill_3'?.5:clip==='Attack'?.59:.65]);if(part==='legs'&&visible.some(n=>!/thigh|shin|foot/.test(n)))report.errors.push('Part filter did not hide torso');const file=path.join(out,`${side}-${clip}-${part}.png`);await page.screenshot({path:file});report.screens.push(file)}
}
const linked=new URL(url);linked.searchParams.set('side','back');linked.searchParams.set('action','Skill_1');linked.searchParams.set('part','legs');linked.searchParams.set('t','.7');await page.goto(linked.href,{waitUntil:'networkidle2',timeout:30000});await page.waitForFunction(()=>window.__motion?.ready,{timeout:15000});const deep=await page.evaluate(()=>({paused:document.querySelector('#pause').textContent==='播放',time:document.querySelector('#time').textContent,link:document.querySelector('#frameLink').href}));if(!deep.paused||!deep.time.startsWith('0.70'))report.errors.push('Exact-frame link did not restore paused pose');report.deepLink=deep;
report.passed=!report.errors.length;
}catch(e){report.errors.push(e.stack);report.passed=false;}
finally{clearTimeout(deadline);await browser?.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({path:path.resolve(out,'receipt.json'),passed:report.passed,errors:report.errors,clips:report.clips.map(({frames,...c})=>c)},null,2));}
return report;
}

const isMain=process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;
// Node test discovery executes matching *-test files as entrypoints; it must never launch this browser CLI.
if(isMain&&!process.env.NODE_TEST_CONTEXT){
const [url,out,candidate]=process.argv.slice(2);
if(!url?.trim()||!out?.trim()){console.error(STUDY_USAGE);process.exitCode=2;}
else{try{const report=await runStudyTest(url,out,candidate);if(!report.passed)process.exitCode=1;}catch(error){console.error(error.stack||error.message);process.exitCode=1;}}
}
