import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {previewServer} from './preview-server.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,list)=>i%2?a:[...a,[v.replace(/^--/,''),list[i+1]]],[]));
for(const key of ['install','code','out'])if(!args[key])throw Error(`Missing --${key}`);
const install=path.resolve(args.install),code=path.resolve(args.code),out=path.resolve(args.out);await fs.mkdir(out,{recursive:true});
const local=args.url?null:await previewServer({publicRoot:path.join(code,'public'),installRoot:install});
const url=args.url||local.url,puppeteer=createRequire(path.join(install,'package.json'))('puppeteer-core');
const browser=await puppeteer.launch({headless:true,executablePath:args.chromium||'C:/Users/lilithgames/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const deadline=setTimeout(()=>browser.process()?.kill(),120000),artifacts=[],errors=[];
try {
 const page=await browser.newPage();await page.setViewport({width:1580,height:1160});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/dev/spine-reference/index.html',{waitUntil:'networkidle0',timeout:45000});await page.waitForFunction(()=>window.__ready||window.__error,{timeout:45000});const error=await page.evaluate(()=>window.__error);if(error)throw Error(error);
 const result={url,observedAt:new Date().toISOString(),localSourceRepository:{root:install,commit:execFileSync('git',['-C',install,'rev-parse','HEAD'],{encoding:'utf8'}).trim()},checks:[],artifacts};
 for(const id of ['2b-front','surtr-front','surtr-back']){
  await page.evaluate(id=>window.reference.loadSource(id,'Idle',.15),id);
  const inventory=await page.evaluate(()=>({bones:window.reference.getRig().skeleton.bones.length,slots:window.currentPose.parts.length,pose:window.currentPose}));
  assert.ok(inventory.pose.landmarks['leg.L.knee'].position,`${id}: knee`);assert.ok(inventory.pose.landmarks['arm.R.wrist'].position,`${id}: active wrist`);
  assert.ok(inventory.pose.parts.filter(p=>p.rendered).every(p=>p.geometry.every(pt=>pt.every(Number.isFinite))),`${id}: geometry finite`);
  const head=inventory.pose.landmarks['head.center'].position,neck=inventory.pose.landmarks.neck.position;assert.ok(head[1]>neck[1]+30,`${id}: head center differs from neck`);
  const foot=inventory.pose.parts.find(p=>p.rendered&&p.semanticPart==='leg.L'&&/foot/i.test(p.id));assert.ok(foot.geometry.some(p=>Math.abs(p[0]-foot.geometry[0][0])>10),`${id}: region corners not collapsed`);
  const before=await page.evaluate(()=>window.reference.sample('Idle',.15));
  const after=await page.evaluate(()=>{const s=window.reference.getRig();s.position.set(9e3,-4e3);s.scale.set(3);s.rotation=.8;const p=window.reference.sample('Idle',.15);s.position.set(270,410);s.scale.set(1);s.rotation=0;window.reference.setTime(.15);return p;});
  assert.deepEqual(after.landmarks,before.landmarks,`${id}: camera excluded`);
  const idle=await page.evaluate(()=>window.reference.exportClip('Idle',25));
  const attack=await page.evaluate(()=>window.reference.exportClip('Attack',25));
  for(const clip of [idle,attack]){assert.ok(clip.frames.every(f=>Object.keys(f.landmarks).length===23));assert.ok(clip.frames.every(f=>f.sideConvention.screenXSorting===false));const file=path.join(out,`${id}-${clip.animation}-semantic.json`);await fs.writeFile(file,JSON.stringify(clip,null,2));artifacts.push({path:file,role:'actual-runtime semantic frame sequence'});}
  await page.evaluate(()=>{window.reference.selectPoint('leg.L.knee');window.reference.setTime(.15);});
  const screenshot=path.join(out,`${id}-idle.png`);await page.screenshot({path:screenshot,fullPage:true});artifacts.push({path:screenshot,role:'visual reference and source'});
  await page.evaluate(()=>window.reference.setPart('arm.L'));const isolated=path.join(out,`${id}-arm-isolated.png`);await page.screenshot({path:isolated,fullPage:true});artifacts.push({path:isolated,role:'isolated semantic part'});await page.evaluate(()=>window.reference.setPart('all'));
  await page.evaluate(()=>window.reference.selectPoint('leg.L.knee'));const query=await page.evaluate(()=>window.reference.query('leg.L.knee'));result.checks.push({source:id,bones:inventory.bones,slots:inventory.slots,query,positionedCandidates:Object.values(inventory.pose.landmarks).filter(p=>p.position).length,unmappedVisible:inventory.pose.unmappedVisibleParts,cameraExcluded:true,geometryVerified:true,samples:50});
  await page.evaluate(()=>window.reference.setPart('arm.L.hand'));const hand=path.join(out,`${id}-hand-isolated.png`);await page.screenshot({path:hand,fullPage:true});artifacts.push({path:hand,role:'isolated hand attachments with wrist candidate'});await page.evaluate(()=>window.reference.setPart('all'));
  await page.evaluate(id=>window.reference.loadSource(id,'Attack',.3),id);
  await page.evaluate(()=>window.reference.selectPoint('arm.L.wrist'));
  const framesDir=path.join(out,`${id}-attack-frames`);await fs.mkdir(framesDir,{recursive:true});
  const displayFrames=await page.evaluate(()=>window.reference.exportClip('Attack',12));
  for(let f=0;f<12;f++) {await page.evaluate(t=>window.reference.setTime(t),attack.duration*f/11);const file=path.join(framesDir,`frame-${String(f).padStart(2,'0')}.png`);await page.screenshot({path:file,clip:{x:70,y:196,width:1114,height:674}});artifacts.push({path:file,role:'ordered native attack frame: source and semantic reference'});displayFrames.frames[f].imagePath=file;}
  const aligned=path.join(out,`${id}-Attack-image-aligned.json`);await fs.writeFile(aligned,JSON.stringify(displayFrames,null,2));artifacts.push({path:aligned,role:'semantic frames exactly aligned to captured image times'});
 }
 // An unsupported form is readable as unknown rather than hidden normal joints.
 await page.evaluate(()=>window.reference.loadSource('surtr-front','Skill_3_Idle',.3));const form=await page.evaluate(()=>window.currentPose);assert.equal(form.form,'unsupported-transformed');assert.ok(Object.values(form.landmarks).every(p=>p.position===null));result.checks.push({source:'surtr-front',animation:'Skill_3_Idle',unsupportedFormUnknown:true});
 assert.deepEqual(errors,[]);const receipt=path.join(out,'verification.json');await fs.writeFile(receipt,JSON.stringify(result,null,2));console.log(JSON.stringify({receipt,checks:result.checks,artifacts},null,2));
}finally{await browser.close();clearTimeout(deadline);await local?.close();}
