import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';import {previewServer} from './preview-server.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,list)=>i%2?a:[...a,[v.replace(/^--/,''),list[i+1]]],[]));
const install=path.resolve(args.install),code=path.resolve(args.code),out=path.resolve(args.out);await fs.mkdir(out,{recursive:true});
const {url,close}=await previewServer({publicRoot:path.join(code,'public'),installRoot:install});
const puppeteer=createRequire(path.join(install,'package.json'))('puppeteer-core');
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Users/lilithgames/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const deadline=setTimeout(()=>browser.process()?.kill(),90000);
try {
 const page=await browser.newPage();await page.setViewport({width:2100,height:820});await page.goto(url+'/dev/spine-reference/inspect.html');
 await page.waitForFunction(()=>window.__ready||window.__error,{timeout:45000});const error=await page.evaluate(()=>window.__error);if(error)throw Error(error);
 const inventory=await page.evaluate(()=>window.inventory);await fs.writeFile(path.join(out,'raw-inventory.json'),JSON.stringify(inventory,null,2));await page.screenshot({path:path.join(out,'raw-rig-overview.png'),captureBeyondViewport:false});
 for(const [id,raw]of Object.entries(inventory))console.log(JSON.stringify({id,bones:raw.bones.length,slots:raw.slots.length,limbs:raw.bones.filter(b=>/arm|leg|hip|foot|hand|sword|head|body|neck|chest|knee|calf|thigh|shin|torso/i.test(b.id)).map(b=>({id:b.id,parent:b.parent,world:b.world})),animations:raw.animations}));
 console.log(JSON.stringify({inventory:path.join(out,'raw-inventory.json'),screenshot:path.join(out,'raw-rig-overview.png')}));
}finally{await browser.close();clearTimeout(deadline);await close();}
