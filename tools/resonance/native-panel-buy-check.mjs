#!/usr/bin/env node
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT='E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const SOURCE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const DATA=path.join(ROOT,'data/resonance-native');
const OUT=path.join(ROOT,'runtime/resonance/ui-verification');
const SESSION_DIR=path.join(OUT,'sessions');
const PROFILE=path.join(ROOT,'.omni/tmp/resonance/browser-profile');
const SOURCE_RECEIPT=path.join(OUT,'ui-native-redesign-receipt.json');
const RECEIPT=path.join(OUT,'native-panel-buy-receipt.json');
const LOG=path.join(ROOT,'.omni/tmp/resonance/native-panel-buy-run.log');
const SESSION_ID='84eeb410-749d-4cc7-a25e-cd5d60c16ae9';
const SCREENSHOTS={detail:path.join(OUT,'70-detail-buy.jpg'),purchased:path.join(OUT,'71-purchased.jpg')};
const actionPath=/\/resonance\/api\/sessions\/[^/]+\/actions\/?$/;

export function parseArgs(args){let session='',resumeEvidence=false;for(let i=0;i<args.length;){if(args[i]==='--session'&&!session&&args[i+1]){session=args[i+1];i+=2;}else if(args[i]==='--resume-evidence'&&!resumeEvidence){resumeEvidence=true;i++;}else throw new Error('usage: --session <owned-sid> [--resume-evidence]');}if(session!==SESSION_ID)throw new Error('only the assigned existing ephemeral SID is allowed');return{session,resumeEvidence};}
export function actionType(body){try{const parsed=typeof body==='string'?JSON.parse(body):body;return(parsed?.action||parsed)?.type||null;}catch{return null;}}
export function classifyRequest({method='GET',pathname='',body='',buyRequests=0,allowBuy=true}){const verb=method.toUpperCase();if(verb==='GET'||verb==='HEAD')return{allowed:true,kind:'readonly'};if(verb==='POST'&&/^\/resonance\/api\/admission\/?$/.test(pathname))return{allowed:true,kind:'admission'};if(verb==='POST'&&actionPath.test(pathname)&&actionType(body)==='buy'&&allowBuy&&buyRequests===0)return{allowed:true,kind:'single-buy'};return{allowed:false,kind:'blocked'};}
export function matchesBuyIntent({pathname='',body='',sessionId,offerUid}){try{const parsed=typeof body==='string'?JSON.parse(body):body;const action=parsed?.action||parsed;return pathname===`/resonance/api/sessions/${sessionId}/actions`&&action?.type==='buy'&&action?.offerUid===offerUid;}catch{return false;}}
export function validatePurchaseDelta(intent,state){
 const events=(state?.history||[]).filter(event=>event.type==='operator-bought').slice(intent?.boughtEventsBefore||0);
 const event=events.find(entry=>entry.operatorId===intent?.operatorId&&Number(entry.cost)===Number(intent?.price));
 const activeOffers=(state?.shop?.offers||[]).filter(offer=>offer.operatorId&&!offer.sold);
 const checks={oneNewBuyEvent:events.length===1&&!!event,exactGold:state?.gold===intent?.goldBefore-intent?.price,onePieceAdded:state?.pieces?.length===intent?.piecesBefore+1,offerSlotsPreserved:state?.shop?.offers?.length===intent?.offersTotalBefore,oneOfferConsumed:activeOffers.length===intent?.activeOffersBefore-1,originalOfferConsumed:!(state?.shop?.offers||[]).some(offer=>offer.uid===intent?.offerUid),poolDecremented:Number.isFinite(Number(intent?.poolBefore))&&Number(state?.poolRemaining?.[intent?.operatorId])===Number(intent.poolBefore)-1};
 return{passed:Object.values(checks).every(Boolean),checks,event,newBuyEvents:events,activeOfferCount:activeOffers.length};
}
export function validateSourceReceipt(receipt,id){return receipt?.status==='passed'&&receipt?.sessionId===id&&receipt?.creates===1&&receipt?.fights===1;}
export function config(){return{source:SOURCE,data:DATA,sessionDirectory:SESSION_DIR,profile:PROFILE,sourceReceipt:SOURCE_RECEIPT,receipt:RECEIPT,log:LOG,screenshots:SCREENSHOTS,sessionId:SESSION_ID,browserStarted:false};}
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const stamp=()=>new Date().toISOString();
async function run(){
 const options=parseArgs(process.argv.slice(2));
 const sourceReceipt=JSON.parse(await readFile(SOURCE_RECEIPT,'utf8'));
 assert(validateSourceReceipt(sourceReceipt,options.session),'existing native UI receipt must be passed for this same SID');
 const sessionFile=path.join(SESSION_DIR,`${options.session}.json`);
 assert(existsSync(sessionFile),`assigned ephemeral session file missing: ${sessionFile}`);
 let previous=null;
 if(options.resumeEvidence){assert(existsSync(RECEIPT)&&existsSync(LOG),'resume requires this checker owned failure receipt and log');previous=JSON.parse(await readFile(RECEIPT,'utf8'));assert(previous.checker==='native-panel-buy-check'&&previous.status==='failed'&&previous.sessionId===options.session&&previous.intent&&previous.intent.beforeRevision!=null,'resume evidence requires an owned failure with saved buy intent');}
 else {assert(!existsSync(RECEIPT)&&!existsSync(LOG),'owned receipt or log already exists; refusing to overwrite');for(const f of Object.values(SCREENSHOTS))assert(!existsSync(f),`refusing to overwrite screenshot ${f}`);}
 const native=execFileSync('git',['-C',SOURCE,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const receipt=previous||{checker:'native-panel-buy-check',sessionId:options.session,startedAt:stamp(),productNative:native,toolingNative:native,status:'running',creates:0,fights:0,gameplayMutations:[],checks:{},screenshots:{}};
 receipt.attempts=(receipt.attempts||0)+1;receipt.status='running';receipt.failure=null;receipt.resumedEvidence=options.resumeEvidence;
 const log=[`${stamp()} ${options.resumeEvidence?'read-only resume evidence':'start single-buy detail-panel check'}`,`source=${SOURCE}`,`session=${options.session}`];
 let server,browser,page,deadline,buyRequests=0,gameplayMutations=0,blockedMutations=0,admissions=0;
 const save=async()=>writeFile(RECEIPT,`${JSON.stringify(receipt,null,2)}\n`);
 const check=(name,passed,evidence)=>{receipt.checks[name]={passed:!!passed,evidence};if(!passed)throw new Error(`${name} failed: ${JSON.stringify(evidence)}`);};
 try{
  await mkdir(OUT,{recursive:true});await mkdir(SESSION_DIR,{recursive:true});
  process.env.SP_DATA_DIR=DATA;process.env.SP_INDEPENDENT_DESIGN_PATH=path.join(DATA,'independent-design.json');process.env.SP_INDEPENDENT_GAME_TEXT_PATH=path.join(DATA,'independent-game-text.json');process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH=path.join(DATA,'independent-darkmoon-design-addon.json');process.env.SP_RESONANCE_DIRECTORY=SESSION_DIR;process.env.SP_INDEPENDENT_DIRECTORY=path.join(OUT,'independent-sessions');process.env.SP_RECORDING_DIRECTORY=path.join(OUT,'recordings');
  const {startServer}=await import(pathToFileURL(path.join(SOURCE,'server/index.js')).href);
  server=await startServer({port:0,host:'127.0.0.1',quiet:true,installDir:ROOT,dataDir:DATA,publicDir:path.join(SOURCE,'public'),sharedDir:path.join(SOURCE,'shared'),resonanceDirectory:SESSION_DIR,independentDirectory:path.join(OUT,'independent-sessions'),recordingDirectory:path.join(OUT,'recordings')});
  const require=createRequire(path.join(ROOT,'package.json'));const puppeteer=require('puppeteer-core');const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';assert(existsSync(chrome),`Chrome missing: ${chrome}`);
  deadline=setTimeout(()=>{void browser?.close().catch(()=>{});void server?.close().catch(()=>{});},120000);
  browser=await puppeteer.launch({executablePath:chrome,headless:true,userDataDir:PROFILE,timeout:30000,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-first-run','--disable-background-networking']});
  page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  await page.setRequestInterception(true);
  page.on('request',async request=>{const url=new URL(request.url());const body=request.postData()||'';const decision=classifyRequest({method:request.method(),pathname:url.pathname,body,buyRequests,allowBuy:!options.resumeEvidence});if(decision.kind==='admission'){admissions++;await request.continue().catch(()=>{});return;}if(decision.kind==='single-buy'){if(!matchesBuyIntent({pathname:url.pathname,body,sessionId:options.session,offerUid:receipt.intent?.offerUid})){blockedMutations++;gameplayMutations++;receipt.requestViolations||=[];receipt.requestViolations.push({method:request.method(),url:url.pathname,reason:'buy did not match saved session/offer intent'});await request.abort('blockedbyclient').catch(()=>{});return;}buyRequests++;gameplayMutations++;receipt.gameplayMutations.push({type:'buy',url:url.pathname,offerUid:receipt.intent.offerUid,at:stamp()});receipt.buyRequest=body;void save();await request.continue().catch(()=>{});return;}if(decision.allowed){await request.continue().catch(()=>{});return;}if(!['GET','HEAD'].includes(request.method().toUpperCase())){blockedMutations++;gameplayMutations++;receipt.requestViolations||=[];receipt.requestViolations.push({method:request.method(),url:url.pathname,reason:'non-readonly request blocked'});}await request.abort('blockedbyclient').catch(()=>{});});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const url=new URL(`${server.url}/resonance.html`);url.searchParams.set('session',options.session);await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForSelector('.gm',{timeout:45000});await page.waitForSelector('.shopbar__cards .scard:not(.scard--sold)',{timeout:30000});await page.waitForFunction(()=>!!globalThis.__SP_VIEW__?.pieceScreenRect&&document.querySelector('.rs-start-battle'),{timeout:30000});
  const getPacket=async()=>page.evaluate(async id=>await(await fetch(`./resonance/api/sessions/${id}`)).json(),options.session);let packet=await getPacket();let state=packet.state;
  check('same-session-prep-state',packet.id===options.session&&state.phase==='prep',{id:packet.id,phase:state.phase});
  if(options.resumeEvidence){
   const prior=receipt.intent;assert(prior?.beforeRevision!=null&&prior.offerUid,'saved buy intent missing');
   const delta=validatePurchaseDelta(prior,state);
   check('resume-purchase-already-applied-readonly',state.revision>prior.beforeRevision&&delta.passed,{revision:state.revision,delta,intent:prior});
   check('resume-does-not-repeat-buy',buyRequests===0,{buyRequests});
  }else{
   const offer=state.shop.offers.find(o=>o.operatorId&&!o.sold&&Number(o.cost)<=Number(state.gold)&&!state.pieces.some(piece=>piece.operatorId===o.operatorId));assert(offer,'no affordable unsold offer without an existing copy (needed to avoid merge ambiguity)');const operator=packet.catalog?.operators?.[offer.operatorId];const price=Number(offer.cost??operator?.cost);assert(Number.isFinite(price)&&price>0,'offer price unavailable');const selector=`#offer-${encodeURIComponent(offer.uid)}`;
   const deployed=state.pieces.find(piece=>piece.row!==null);assert(deployed,'no deployed unit to open native detail');
   const pt=await page.waitForFunction(uid=>{const n=Number(String(uid).replace(/^\D+/,'')),v=globalThis.__SP_VIEW__,r=v?.pieceScreenRect?.(n);if(!r||r.width<3||r.height<3)return false;const p={x:r.x+r.width/2,y:r.y+r.height/2};return v.pieceAtClient?.(p.x,p.y)?.uid===n&&document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS'?p:false;},{polling:'raf',timeout:15000},deployed.uid);const point=await pt.jsonValue();await page.mouse.click(point.x,point.y);await page.waitForSelector('.rs-detail__member',{timeout:10000});
   const panel=await page.evaluate(()=>{const rect=e=>{const r=e?.getBoundingClientRect();return r&&{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};const visible=e=>{const r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return!!r&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0};const center=e=>{const r=e.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,h=document.elementFromPoint(x,y);return{reachable:!!h&&(h===e||e.contains(h)),x,y,rect:rect(e)}};const controls=[...document.querySelectorAll('.shopbar__tools .toolbtn--ice,.shopbar__tools .toolbtn--amber,.shopbar__cards .scard:not(.scard--sold),.rs-level-card')].filter(visible).map(e=>({label:e.getAttribute('aria-label')||e.innerText.trim(),...center(e)}));return{panel:rect(document.querySelector('.dpanel')),detailOpen:visible(document.querySelector('.rs-detail__member')),controls,offers:[...document.querySelectorAll('.shopbar__cards .scard:not(.scard--sold)')].map(e=>({id:e.id,disabled:e.disabled,reachable:center(e).reachable}))};});
   check('member-detail-open-with-shop-controls-reachable',panel.detailOpen&&panel.panel&&panel.controls.length>0&&panel.controls.every(c=>c.reachable),panel);receipt.panelEvidence=panel;
   receipt.intent={beforeRevision:state.revision,offerUid:offer.uid,operatorId:offer.operatorId,price,goldBefore:state.gold,piecesBefore:state.pieces.length,activeOffersBefore:state.shop.offers.filter(o=>o.operatorId&&!o.sold).length,offersTotalBefore:state.shop.offers.length,poolBefore:state.poolRemaining?.[offer.operatorId],boughtEventsBefore:state.history.filter(event=>event.type==='operator-bought').length,at:stamp()};receipt.checkpoint='intent-saved';await save();
   await page.waitForFunction(sel=>{const e=document.querySelector(sel);if(!e)return false;const r=e.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,h=document.elementFromPoint(x,y);return !!h&&(h===e||e.contains(h));},{timeout:8000},selector);
   await page.screenshot({path:SCREENSHOTS.detail,type:'jpeg',quality:90,fullPage:true});receipt.screenshots.detail=SCREENSHOTS.detail;await save();
   await page.click(selector);await page.waitForFunction(async({id,revision})=>{const s=(await(await fetch(`./resonance/api/sessions/${id}`)).json()).state;return s?.revision>revision;},{timeout:15000},{id:options.session,revision:receipt.intent.beforeRevision});
   packet=await getPacket();state=packet.state;const delta=validatePurchaseDelta(receipt.intent,state);
   check('single-purchase-authoritative-state',delta.passed,{delta,revision:state.revision,intent:receipt.intent});
   receipt.purchaseEvidence={...delta,afterRevision:state.revision,goldAfter:state.gold,piecesAfter:state.pieces.length,memberDetailOpenAtAction:panel.detailOpen};receipt.checkpoint='purchased';await save();await page.screenshot({path:SCREENSHOTS.purchased,type:'jpeg',quality:90,fullPage:true});receipt.screenshots.purchased=SCREENSHOTS.purchased;
  }
   check('zero-fights-and-no-other-gameplay',gameplayMutations===(options.resumeEvidence?0:1)&&blockedMutations===0&&buyRequests===(options.resumeEvidence?0:1),{gameplayMutations,blockedMutations,buyRequests,admissions,violations:receipt.requestViolations||[]});check('no-client-errors',errors.length===0,errors);receipt.admissions=admissions;receipt.gameplayMutationsCount=gameplayMutations;receipt.blockedMutations=blockedMutations;receipt.status='passed';
 }catch(error){receipt.status='failed';receipt.failure=error.stack||String(error);log.push(`${stamp()} failed: ${receipt.failure}`);throw error;}
 finally{clearTimeout(deadline);await browser?.close().catch(()=>{});await server?.close().catch(()=>{});receipt.finishedAt=stamp();receipt.admissions=admissions;receipt.gameplayMutationsCount=gameplayMutations;receipt.blockedMutations=blockedMutations;await save();await writeFile(LOG,`${log.join('\n')}\n`,previous?'a':'wx').catch(()=>{});process.stdout.write(`${JSON.stringify({status:receipt.status,receipt:RECEIPT,log:LOG,screenshots:receipt.screenshots,session:SESSION_ID})}\n`);}
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)run().catch(error=>{process.stderr.write(`${error.stack||error}\n`);process.exitCode=1;});
