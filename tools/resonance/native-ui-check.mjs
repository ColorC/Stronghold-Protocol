#!/usr/bin/env node
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data/resonance-native');
const OUT = path.join(ROOT, 'runtime/resonance/ui-verification');
const SESSION_DIR = path.join(OUT, 'sessions');
const PROFILE = path.join(ROOT, '.omni/tmp/resonance/browser-profile');
const RECEIPT = path.join(OUT, 'ui-native-redesign-receipt.json');
const PREPARATION_LOG = path.join(ROOT, '.omni/tmp/resonance/native-ui-check.log');
const LOG = path.join(ROOT, '.omni/tmp/resonance/native-ui-run.log');
const SHOTS = Object.fromEntries(['51-title', '52-difficulty', '53-prep', '54-gear', '55-mobile', '56-replay'].map(name => [name, path.join(OUT, `${name}.jpg`)]));
const DEADLINE_MS = 300_000;
const createsPath = /\/resonance\/api\/sessions\/?$/;
const actionPath = /\/resonance\/api\/sessions\/[^/]+\/actions\/?$/;

export function parseArgs(args) {
  let validateArgs = false, selfTest = false, resumeSession = '';
  for (let i = 0; i < args.length;) {
    if (args[i] === '--validate-args' && !validateArgs) { validateArgs = true; i++; }
    else if (args[i] === '--self-test' && !selfTest) { selfTest = true; i++; }
    else if (args[i] === '--resume-session' && !resumeSession && args[i + 1]) { resumeSession = args[i + 1]; i += 2; }
    else throw new Error('usage: [--resume-session <owned-ephemeral-session-id>] [--validate-args|--self-test]; no work started');
  }
  if (resumeSession && !/^[a-zA-Z0-9-]{8,80}$/.test(resumeSession)) throw new Error('--resume-session requires an existing session id; no work started');
  if ((validateArgs || selfTest) && resumeSession) throw new Error('validation cannot resume a session; no work started');
  return { validateArgs, selfTest, resumeSession };
}

export function countsAsCreate(method, pathname) { return method.toUpperCase() === 'POST' && createsPath.test(pathname); }
export function countsAsFight(method, pathname, body = '') {
  if (method.toUpperCase() !== 'POST' || !actionPath.test(pathname)) return false;
  try { const parsed = JSON.parse(body); return (parsed?.action || parsed)?.type === 'fight'; } catch { return /"type"\s*:\s*"fight"/.test(body); }
}
export function intersects(a, b) { return !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
export function iconIsConcrete(iconId, src) {
  return typeof iconId === 'string' && !!iconId && !/^(?:bolt|s)$/i.test(iconId) && typeof src === 'string' && /\.(?:svg|png|webp|jpe?g)(?:[?#].*)?$/i.test(src);
}
export function iconMatchesExpected(iconId, actualUrl, expectedUrl) {
  if (!iconIsConcrete(iconId, actualUrl) || typeof expectedUrl !== 'string' || !expectedUrl) return false;
  try { return new URL(actualUrl, ROOT).href === new URL(expectedUrl, ROOT).href; } catch { return false; }
}
export function costCardHasWholeSurfaceStyle(card) {
  return !!card && /scard--t\d/.test(card.className || '') && !!card.background && card.background !== 'transparent' && card.background !== 'rgba(0, 0, 0, 0)' &&
    !!card.bgImage && card.bgImage !== 'none' && card.bgCoversCard === true && !!card.border && !/tier--color/.test(card.tierClass || '') &&
    !/^[IVXLCDM]+$/.test(String(card.tierText || '').trim());
}
export function config() { return { source: SOURCE, data: DATA, sessionDirectory: SESSION_DIR, profile: PROFILE, receipt: RECEIPT, log: LOG, preparationLog: PREPARATION_LOG, screenshots: SHOTS, deadlineMs: DEADLINE_MS, browserStarted: false }; }

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const stamp = () => new Date().toISOString();

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.validateArgs || options.selfTest) {
    process.stdout.write(`${JSON.stringify({ valid: true, ...config(), mode: 'local-native-ui' })}\n`);
    return;
  }
  let previous = null;
  if (options.resumeSession) {
    assert(existsSync(RECEIPT) && existsSync(LOG), '--resume-session requires the owned receipt and log');
    previous = JSON.parse(await readFile(RECEIPT, 'utf8'));
    assert(previous.checker === 'native-ui-check' && previous.sessionId === options.resumeSession && ['prep', 'after-buy', 'after-deploy', 'after-equip', 'prep-gear', 'replay'].includes(previous.checkpoint) && ['prepared-incomplete', 'failed'].includes(previous.status), 'resume requires this checker’s owned checkpoint and the exact same SID');
  } else {
    assert(!existsSync(RECEIPT) && !existsSync(LOG), 'fixed receipt or log already exists; refusing to overwrite prior evidence');
    for (const screenshot of Object.values(SHOTS)) assert(!existsSync(screenshot), `screenshot already exists; refusing to overwrite: ${screenshot}`);
  }
  const sourceNative = execFileSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const receipt = previous || { checker: 'native-ui-check', sourceNative, startedAt: stamp(), deadlineMs: DEADLINE_MS,
    status: 'running', sessionId: null, creates: 0, fights: 0, gameplayMutations: [], checks: {}, screenshots: {}, paths: config() };
  receipt.attempts = (receipt.attempts || 0) + 1;
  receipt.previousStatus = previous?.status || null;
  receipt.status = 'running';
  const log = [`${stamp()} ${previous ? `resume same SID ${options.resumeSession}` : 'start native UI acceptance'}`, `source=${SOURCE}`, `data=${DATA}`, `ephemeralSessions=${SESSION_DIR}`];
  let browser, server, deadline;
  const save = async () => writeFile(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
  const check = (name, ok, evidence = null) => { receipt.checks[name] = { passed: !!ok, evidence }; if (!ok) throw new Error(`${name} failed: ${JSON.stringify(evidence)}`); };
  try {
    await mkdir(OUT, { recursive: true });
    await mkdir(SESSION_DIR, { recursive: true });
    process.env.SP_DATA_DIR = DATA;
    process.env.SP_RESONANCE_DIRECTORY = SESSION_DIR;
    process.env.SP_INDEPENDENT_DIRECTORY = path.join(OUT, 'independent-sessions');
    process.env.SP_RECORDING_DIRECTORY = path.join(OUT, 'recordings');
    const { startServer } = await import(pathToFileURL(path.join(SOURCE, 'server/index.js')).href);
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, installDir: ROOT, dataDir: DATA,
      publicDir: path.join(SOURCE, 'public'), sharedDir: path.join(SOURCE, 'shared'), resonanceDirectory: SESSION_DIR,
      independentDirectory: path.join(OUT, 'independent-sessions'), recordingDirectory: path.join(OUT, 'recordings') });
    const require = createRequire(path.join(ROOT, 'package.json'));
    const puppeteer = require('puppeteer-core');
    const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    assert(existsSync(chrome), `Chrome executable missing: ${chrome}`);
    deadline = setTimeout(() => { receipt.timedOut = true; void browser?.close().catch(() => {}); void server?.close().catch(() => {}); }, DEADLINE_MS);
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: PROFILE, timeout: 30000,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--disable-background-networking'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url()), method = request.method();
      if (url.origin !== server.url) return;
      if (countsAsCreate(method, url.pathname)) receipt.creates++;
      if (countsAsFight(method, url.pathname, request.postData() || '')) receipt.fights++;
      if (method === 'POST' && /\/resonance\/api\//.test(url.pathname)) receipt.gameplayMutations.push({ path: url.pathname, body: request.postData() || '' });
      if (receipt.creates > 1 || receipt.fights > 1) void request.abort();
      else void request.continue();
    });
    await page.setRequestInterception(true);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const capture = async key => { if (existsSync(SHOTS[key])) return; await page.screenshot({ path: SHOTS[key], type: 'jpeg', quality: 88, fullPage: true }); receipt.screenshots[key] = SHOTS[key]; };
    const inspectGeometry = async label => {
      const result = await page.evaluate(() => {
        const rect = element => { const r = element?.getBoundingClientRect(); return r && { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height }; };
        const visible = element => { const r=element?.getBoundingClientRect(),s=element&&getComputedStyle(element);return !!r&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0; };
        const action=document.querySelector('.rs-start-battle'),remain=document.querySelector('.shopbar__remain');
        const controls=[...document.querySelectorAll('.shopbar__cards .scard:not(.scard--sold),.shopbar__tools .toolbtn--amber,.shopbar__tools .toolbtn--ice,.shopbar .rs-level-card,.rs-start-battle')].filter(visible).map(element=>{const r=rect(element),hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);return{label:element.getAttribute('aria-label')||element.innerText.trim(),reachable:!!hit&&(hit===element||element.contains(hit)),rect:r};});
        const cards=[...document.querySelectorAll('.shopbar__cards .scard:not(.scard--sold)')].map(card=>{const tier=card.querySelector('.tier'),bg=card.querySelector('.scard__bg'),r=card.getBoundingClientRect(),br=bg?.getBoundingClientRect();return{className:card.className,background:getComputedStyle(card).background,bgImage:bg&&getComputedStyle(bg).backgroundImage,bgCoversCard:!!br&&Math.abs(br.width-r.width)<2&&Math.abs(br.height-r.height)<2,border:getComputedStyle(card).borderTopColor,tierClass:tier?.className||'',tierText:tier?.innerText||''};});
        return{viewport:{width:innerWidth,height:innerHeight},action:rect(action),remain:rect(remain),cards,controls,overlap:!!(visible(action)&&visible(remain)&&action.getBoundingClientRect().left<remain.getBoundingClientRect().right&&action.getBoundingClientRect().right>remain.getBoundingClientRect().left&&action.getBoundingClientRect().top<remain.getBoundingClientRect().bottom&&action.getBoundingClientRect().bottom>remain.getBoundingClientRect().top)};
      });
      check(`${label}-turn-action-does-not-overlap-remain`, !result.overlap && !!result.action && !!result.remain, result);
      check(`${label}-shop-controls-center-reachable`, result.controls.length>0 && result.controls.every(control=>control.reachable), result.controls);
      check(`${label}-cost-is-whole-card-surface-no-roman`, result.cards.length>0 && result.cards.every(costCardHasWholeSurfaceStyle), result.cards);
      return result;
    };
    const getState = async () => page.evaluate(async id => (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state, receipt.sessionId);
    const afterRevision = async previous => page.waitForFunction(async ({ id, revision }) => {
      const state = (await (await fetch(`./resonance/api/sessions/${id}`)).json()).state;
      return state?.revision > revision ? state : false;
    }, { timeout: 15000 }, { id: receipt.sessionId, revision: previous });
    const piecePoint = async uid => {
      const handle = await page.waitForFunction(value => {
        const numeric=Number(String(value).replace(/^\D+/,'')),view=globalThis.__SP_VIEW__,rect=view?.pieceScreenRect?.(numeric);
        if(!rect||rect.width<3||rect.height<3)return false;
        const point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
        return view.pieceAtClient?.(point.x,point.y)?.uid===numeric&&document.elementFromPoint(point.x,point.y)?.tagName==='CANVAS'?point:false;
      },{polling:'raf',timeout:12000},uid);
      return handle.jsonValue();
    };
    const deployPiece = async (piece, occupied) => {
      const source=await piecePoint(piece.uid),numeric=Number(String(piece.uid).replace(/^\D+/,''));
      for(const key of piece.legalTiles||[]){if(occupied.has(key))continue;const [row,col]=key.split(',').map(Number);
        const target=await page.evaluate(({numeric,row,col})=>{const v=globalThis.__SP_VIEW__,p=v?.tileScreen(row,col),canvas=document.querySelector('.gm__field canvas'),r=canvas?.getBoundingClientRect();if(!p||!r||document.elementFromPoint(p.x,p.y)?.tagName!=='CANVAS')return null;const tile=v.raw?.debug?.pick?.groundTile?.(p.x-r.left,p.y-r.top);return tile?.row===row&&tile?.col===col?{x:p.x,y:p.y}:null;},{numeric,row,col});
        if(!target)continue;await page.mouse.move(source.x,source.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:12});await page.mouse.up();
        await page.waitForSelector('.fwheel[role="dialog"]',{timeout:7000});await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('.fwheel[role="dialog"]'),{timeout:7000});occupied.add(key);return true;
      }return false;
    };
    const entryUrl = new URL(`${server.url}/resonance.html`);
    if (options.resumeSession) entryUrl.searchParams.set('session', options.resumeSession);
    await page.goto(entryUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (options.resumeSession) {
      await page.waitForSelector('.gm', { timeout: 45000 });
      await page.waitForSelector('.shopbar__remain', { timeout: 30000 });
      check('resume-checkpoint-same-ephemeral-session', receipt.sessionId === options.resumeSession, { sessionId: receipt.sessionId, checkpoint: receipt.checkpoint });
      check('resume-does-not-repeat-create', receipt.creates === 1, { createsThisAttempt: 0, priorCreates: receipt.creates });
    } else {
    await page.waitForSelector('.rs-title-fullscreen', { timeout: 30000 });
    await capture('51-title');
    check('title-entry-visible', true, await page.title());
    const startEntry = await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => /开始整备/.test(button.innerText) && !button.disabled) || false, { timeout: 15000 });
    await startEntry.asElement().click();
    await page.waitForFunction(() => document.body.innerText.includes('选择难度') && !!document.querySelector('button'), { timeout: 10000 });
    check('title-to-difficulty-without-intermediate-gate', await page.evaluate(() => !document.querySelector('.rs-flow--briefing') && !/本局简报/.test(document.body.innerText)), { path: new URL(page.url()).search });
    await capture('52-difficulty');
    await page.click('.rs-advanced');await page.waitForSelector('.rs-seed-field input',{timeout:8000});
    await page.click('.rs-seed-field input');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.type('1');
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.innerText.trim()==='开始备战'&&!button.disabled),{timeout:15000});
    const selectedSeed=await page.$eval('.rs-seed-field input',input=>input.value);
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.innerText.trim()==='完成')?.click());
    check('deterministic-growth-seed-selected',selectedSeed==='1'&&await page.evaluate(()=>document.querySelector('.rs-seed-field input')===null),selectedSeed);
    const begin = await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.innerText.trim() === '开始备战' && !button.disabled) || false, { timeout: 45000 });
    await begin.asElement().click();
    await page.waitForSelector('.gm', { timeout: 45000 });
    await page.waitForSelector('.shopbar__remain', { timeout: 30000 });
    await page.waitForFunction(() => !!globalThis.__SP_VIEW__ && document.querySelector('.rs-start-battle'), { timeout: 30000 });
    check('single-session-create', receipt.creates === 1, receipt.creates);
    receipt.sessionId = new URL(page.url()).searchParams.get('session');
    receipt.checkpoint = 'prep'; receipt.steps = { created: true }; await save();
    check('session-is-in-ephemeral-path', !!receipt.sessionId && path.resolve(SESSION_DIR).toLowerCase() !== path.resolve(path.join(ROOT, 'runtime/resonance/player-sessions')).toLowerCase(), { sessionId: receipt.sessionId, directory: SESSION_DIR });
    check('opening-event-automatic-and-no-brief-gate', await page.evaluate(() => !document.querySelector('.rs-flow--briefing') && !!document.querySelector('.rs-gmeta__opening')), await page.evaluate(() => document.querySelector('.rs-gmeta__opening')?.innerText || null));
    const catalogCounts = await page.evaluate(async id => {
      const state = await (await fetch(`./resonance/api/sessions/${id}`)).json();
      const response = await (await fetch(`./resonance/api/catalog?seed=${state.state?.seed}`)).json();
      const catalog = response.catalog || {};
      return { active: response.activeOperatorIds?.length, operators: Object.keys(catalog.operators || {}).length,
        strategies: Object.keys(catalog.strategies || {}).length, equipment: Object.keys(catalog.equipment || {}).length,
        openingEvents: Object.keys(catalog.openingEvents || {}).length, openingEvent: catalog.openingEvent?.id || catalog.openingEvent?.name,
        legalInventoryRecipe:(catalog.recipes||[]).find(recipe=>recipe.parts?.length===2&&recipe.parts.every(part=>(state.state.inventory||[]).some(item=>item.itemId===part)))||null };
    }, receipt.sessionId);
    check('catalog-season-cardinality', catalogCounts.active === 65 && catalogCounts.operators === 154 && catalogCounts.strategies === 28 && catalogCounts.equipment === 69 && catalogCounts.openingEvents === 4, catalogCounts);
    await inspectGeometry('desktop-1440x900');
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await inspectGeometry('desktop-1280x720');
    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await inspectGeometry('mobile-844x390'); await capture('55-mobile');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await capture('53-prep');
    }
    let state=await getState();
    if(!options.resumeSession){
      const rawInventory=state.inventory||[];check('native-initial-inventory-two-real-components',rawInventory.length===2&&rawInventory.every(item=>item.itemId),rawInventory);
      const shopOffer=state.shop?.offers?.find(offer=>!offer.sold&&offer.cost<=state.gold);
      check('one-affordable-real-shop-offer',!!shopOffer,shopOffer);
      const card=await page.$(`.shopbar__cards .scard[id="${shopOffer?.uid}"]`)|| (await page.$$('.shopbar__cards .scard:not(.scard--sold)'))[state.shop.offers.indexOf(shopOffer)];
      assert(card,'real shop offer DOM card missing');
      const cardBox=await card.boundingBox();assert(cardBox,'shop card has no bounds');
      await page.mouse.click(cardBox.x+cardBox.width/2,cardBox.y+cardBox.height/2,{button:'right'});
      await page.waitForSelector('.dpanel .dskill__icon img',{timeout:8000});
      const icon=await page.evaluate(async()=>{const image=document.querySelector('.dpanel .dskill__icon img'),name=document.querySelector('.dpanel .dhead__name')?.innerText.trim(),response=await(await fetch(`./resonance/api/catalog?seed=${new URL(location.href).searchParams.get('seed')||1}`)).json(),operator=Object.values(response.catalog?.operators||{}).find(value=>value.name===name),{resolveOperatorSkillIcon}=await import('./js/resonance/operatorSkillIcon.js'),expected=operator&&resolveOperatorSkillIcon(operator);return{name,src:image?.src,loaded:!!image?.complete&&image.naturalWidth>0,iconId:expected?.iconId||null,expectedUrl:expected?.url||null,matchesExpected:!!image&&!!expected?.url&&new URL(image.src).href===new URL(expected.url,location.href).href};});
      check('real-skill-image-and-concrete-icon-identity',icon.loaded&&iconMatchesExpected(icon.iconId,icon.src,icon.expectedUrl)&&icon.matchesExpected,icon);
      await page.click('.dpanel__close');await page.waitForFunction(()=>!document.querySelector('.dpanel'),{timeout:5000});
      const beforeBuy=state;await card.click();
      if(await page.$('.shopbar__cards .scard.is-armed')) await card.click();
      const boughtHandle=await afterRevision(beforeBuy.revision),bought=await boughtHandle.jsonValue();
      check('one-real-shop-purchase',bought.history?.some(event=>event.type==='operator-bought'),bought.history?.at(-1));state=bought;
      receipt.checkpoint='after-buy';receipt.steps={...(receipt.steps||{}),bought:true};await save();
      const occupied=new Set();const activePieces=state.pieces.slice(0,3);
      for(const piece of activePieces){const ok=await deployPiece(piece,occupied);check(`piece-${piece.uid}-deployed-by-real-drag`,ok,{uid:piece.uid,legalTiles:piece.legalTiles});}
      state=await getState();check('population-three-deployed-zero-remaining',state.pieces.filter(piece=>piece.row!=null).length===3&&state.deployedCount===3&&/剩余可放置角色：\s*0/.test(await page.$eval('.shopbar__remain',node=>node.innerText)),{deployedCount:state.deployedCount,remain:await page.$eval('.shopbar__remain',node=>node.innerText),pieces:state.pieces.map(piece=>({uid:piece.uid,row:piece.row,col:piece.col}))});
      receipt.checkpoint='after-deploy';receipt.steps={...(receipt.steps||{}),deployed:true};await save();
      await page.evaluate(()=>{const button=[...document.querySelectorAll('.rs-hud-actions button')].find(element=>/装备背包/.test(`${element.innerText} ${element.title} ${element.getAttribute('aria-label')||''}`));button?.click();});await page.waitForSelector('.rs-panel-drawer[aria-label="装备"]',{timeout:8000});
      const item=rawInventory[0],source=await page.$(`#inventory-${item.uid} .rs-inventory__main[draggable="true"]`),target=await piecePoint(activePieces[0].uid);assert(source,'native draggable inventory item missing');
      const sourceBounds=await source.boundingBox();assert(sourceBounds,'inventory component has no bounds');
      await page.mouse.move(sourceBounds.x+sourceBounds.width/2,sourceBounds.y+sourceBounds.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:12});await page.mouse.up();
      let equipped=await afterRevision(state.revision);state=await equipped.jsonValue();
      const equippedUnit=state.pieces.find(piece=>piece.uid===activePieces[0].uid),equippedItem=equippedUnit?.equipment?.find(value=>value.uid===item.uid);
      check('real-inventory-item-equipped-to-live-unit',!!equippedItem&&!state.inventory.some(value=>value.uid===item.uid),{itemUid:item.uid,equippedItem,equippedUnit});
      receipt.checkpoint='after-equip';receipt.steps={...(receipt.steps||{}),equipped:true};await save();
      await page.waitForSelector(`.rs-unit-items__item[data-item-id="${item.itemId}"] img`,{timeout:8000});
      const overlayImage=await page.$eval(`.rs-unit-items__item[data-item-id="${item.itemId}"] img`,img=>({src:img.src,loaded:img.complete&&img.naturalWidth>0}));
      check('equipped-item-overlay-icon-loaded',overlayImage.loaded,overlayImage);
      await capture('54-gear');await inspectGeometry('gear-overlay-1440x900');
      await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.rs-panel-drawer'),{timeout:5000});
      const unitPoint=await piecePoint(activePieces[0].uid);await page.mouse.click(unitPoint.x,unitPoint.y);await page.waitForSelector('.rs-detail__member',{timeout:8000});
      await inspectGeometry('member-detail-1440x900');
      const canUnequip=await page.$eval('.rs-detail__member',root=>[...root.querySelectorAll('button')].some(button=>button.innerText.trim()==='卸下'));
      assert(canUnequip,'equipped item detail is missing its real unload action');await page.evaluate(()=>[...document.querySelectorAll('.rs-detail__member button')].find(button=>button.innerText.trim()==='卸下')?.click());
      state=await afterRevision(state.revision).then(handle=>handle.jsonValue());
      check('unequip-removes-item-from-unit',!state.pieces.find(piece=>piece.uid===activePieces[0].uid)?.equipment?.some(value=>value.uid===item.uid),state.inventory);
      check('unequip-removes-unit-overlay-icon',await page.$(`.rs-unit-items__item[data-item-id="${item.itemId}"] img`)===null,item.itemId);
      await page.click('.dpanel__close');await page.waitForFunction(()=>!document.querySelector('.dpanel'),{timeout:5000});
      await page.mouse.click(unitPoint.x,unitPoint.y);await page.waitForSelector('.rs-detail__member select',{timeout:8000});
      await page.select('.rs-detail__member select',item.uid);state=await afterRevision(state.revision).then(handle=>handle.jsonValue());
      check('re-equip-real-inventory-item',!!state.pieces.find(piece=>piece.uid===activePieces[0].uid)?.equipment?.some(value=>value.uid===item.uid),state.inventory);
      await page.waitForSelector(`.rs-unit-items__item[data-item-id="${item.itemId}"] img`,{timeout:8000});
      await inspectGeometry('member-detail-gear-1440x900');await page.click('.dpanel__close');await page.waitForFunction(()=>!document.querySelector('.dpanel'),{timeout:5000});
      check('real-two-component-recipe-discovered',!!catalogCounts.legalInventoryRecipe,{inventory:rawInventory.map(entry=>entry.itemId),recipe:catalogCounts.legalInventoryRecipe});
      await page.evaluate(()=>[...document.querySelectorAll('.rs-hud-actions button')].find(element=>/装备背包/.test(`${element.innerText} ${element.title} ${element.getAttribute('aria-label')||''}`))?.click());
      await page.waitForSelector('.rs-panel-drawer[aria-label="装备"]',{timeout:8000});
      for(const ingredient of rawInventory){const input=await page.$(`#equipped-${ingredient.uid} input[type="checkbox"]`)||await page.$(`#inventory-${ingredient.uid} input[type="checkbox"]`);assert(input,`synthesis ingredient checkbox missing: ${ingredient.uid}`);await input.click();}
      const combineButton=await page.waitForFunction(()=>[...document.querySelectorAll('.rs-inventory__combine button')].find(button=>button.innerText.trim()==='确认合成'&&!button.disabled)||false,{timeout:8000});
      const combineLabel=await page.$eval('.rs-inventory__combine',node=>node.innerText.trim());check('inventory-ui-offers-real-recipe',combineLabel.includes(catalogCounts.legalInventoryRecipe.resultName||catalogCounts.legalInventoryRecipe.resultId),combineLabel);
      state=await getState();await combineButton.asElement().click();state=await afterRevision(state.revision).then(handle=>handle.jsonValue());
      const combineEvent=state.history?.find(event=>event.type==='equipment-combined'&&event.resultId===catalogCounts.legalInventoryRecipe.resultId);
      const combinedOwner=state.pieces.find(piece=>piece.equipment?.some(entry=>entry.uid===combineEvent?.uid));
      check('real-ui-synthesis-consumes-two-and-creates-result',!!combineEvent&&combineEvent.itemIds.length===2&&(state.inventory.some(entry=>entry.uid===combineEvent.uid&&entry.itemId===combineEvent.resultId)||!!combinedOwner),{combineEvent,inventory:state.inventory,combinedOwner});
      check('synthesis-removes-old-pawn-overlay',await page.$(`.rs-unit-items__item[data-item-id="${item.itemId}"] img`)===null,item.itemId);
      if (!combinedOwner) { await page.select(`#inventory-${combineEvent.uid} select[aria-label="装备给谁"]`,activePieces[0].uid);state=await afterRevision(state.revision).then(handle=>handle.jsonValue()); }
      const finalGear=state.pieces.find(piece=>piece.uid===activePieces[0].uid)?.equipment?.find(entry=>entry.itemId===combineEvent.resultId);
      check('synthesized-result-equipped-and-synced',!!finalGear&&finalGear.uid===combineEvent.uid,{finalGear,resultId:combineEvent.resultId});
      await page.waitForSelector(`.rs-unit-items__item[data-item-id="${combineEvent.resultId}"] img`,{timeout:8000});
      const resultOverlay=await page.$eval(`.rs-unit-items__item[data-item-id="${combineEvent.resultId}"] img`,img=>({src:img.src,loaded:img.complete&&img.naturalWidth>0}));
      check('synthesized-result-icon-visible-on-pawn',resultOverlay.loaded,resultOverlay);
      receipt.checkpoint='prep-gear';receipt.gearEvidence={itemUid:combineEvent.uid,itemId:combineEvent.resultId,overlayImage:resultOverlay,icon};await save();
      await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.rs-panel-drawer'),{timeout:5000});
    }
    const deployedForSurface=(await getState()).pieces.find(piece=>piece.row!=null);assert(deployedForSurface,'no live unit for overlay layout checks');
    for(const viewport of [{width:1440,height:900,isMobile:false,hasTouch:false},{width:1280,height:720,isMobile:false,hasTouch:false},{width:844,height:390,isMobile:true,hasTouch:true}]){
      await page.setViewport({deviceScaleFactor:1,...viewport});await inspectGeometry(`expanded-shop-${viewport.width}x${viewport.height}`);
      await page.click('.funds__collapse');await page.waitForSelector('.shopbar-tab__btn',{timeout:5000});
      const folded=await page.evaluate(()=>{const action=document.querySelector('.rs-start-battle'),tab=document.querySelector('.shopbar-tab'),button=tab?.querySelector('.shopbar-tab__btn');const a=action?.getBoundingClientRect(),t=tab?.getBoundingClientRect(),b=button?.getBoundingClientRect(),hit=b&&document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return{overlap:!!a&&!!t&&a.left<t.right&&a.right>t.left&&a.top<t.bottom&&a.bottom>t.top,buttonReachable:!!hit&&(hit===button||button.contains(hit)),tabText:tab?.innerText};});
      check(`folded-shop-layout-${viewport.width}x${viewport.height}`,!folded.overlap&&folded.buttonReachable,folded);
      await page.click('.shopbar-tab__btn');await page.waitForSelector('.shopbar__remain',{timeout:5000});await inspectGeometry(`reopened-shop-${viewport.width}x${viewport.height}`);
      await page.evaluate(()=>[...document.querySelectorAll('.rs-hud-actions button')].find(element=>/装备背包/.test(`${element.innerText} ${element.title} ${element.getAttribute('aria-label')||''}`))?.click());
      await page.waitForSelector('.rs-panel-drawer[aria-label="装备"]',{timeout:8000});await inspectGeometry(`equipment-drawer-${viewport.width}x${viewport.height}`);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.rs-panel-drawer'),{timeout:5000});
      const target=await piecePoint(deployedForSurface.uid);await page.mouse.click(target.x,target.y);await page.waitForSelector('.rs-detail__member',{timeout:8000});await inspectGeometry(`member-detail-${viewport.width}x${viewport.height}`);await page.click('.dpanel__close');await page.waitForFunction(()=>!document.querySelector('.dpanel'),{timeout:5000});
      if(viewport.width===844)await capture('55-mobile');
    }
    state=await getState();
    if(!state.history?.some(event=>event.type==='fight-settled')){
      const action=await page.$eval('.rs-start-battle',button=>button.innerText.trim());check('fight-button-visible',!!action,action);
      await page.click('.rs-start-battle');await page.waitForFunction(async id=>{const state=(await(await fetch(`./resonance/api/sessions/${id}`)).json()).state;return state?.history?.some(event=>event.type==='fight-settled');},{timeout:45000},receipt.sessionId);
    }
    state=await getState();const fight=(state.history||[]).find(event=>event.type==='fight-settled');
    check('exactly-one-real-fight-with-native-units',!!fight&&fight.combatStats?.units?.length>0&&receipt.fights===1,{fightCount:(state.history||[]).filter(event=>event.type==='fight-settled').length,units:fight?.combatStats?.units?.length});
    await page.waitForSelector('.rs-replay-native[aria-label="战斗回放"]',{timeout:20000});
    const replay=await page.evaluate(()=>{const stats=globalThis.__SP_VIEW__?.raw?.stats?.(),units=stats?.units||[];return{text:document.querySelector('.rs-replay-native')?.innerText||'',engineUnits:units.length,units:units.map(unit=>({uid:unit.uid,items:unit.items||[],skillIcon:unit.skillIcon||unit.icon||null})).filter(unit=>unit.items.length||unit.skillIcon)};});
    const settled=fight.combatStats?.units||[];check('native-replay-shows-real-history',!!replay.text&&replay.engineUnits>0&&settled.some(unit=>(unit.items||[]).some(value=>value===receipt.gearEvidence?.itemUid||value===receipt.gearEvidence?.itemId)),{replay,settledGear:settled.map(unit=>({uid:unit.uid,items:unit.items||[]}))});await capture('56-replay');
    receipt.checkpoint='replay';receipt.replayEvidence=replay;check('no-client-js-errors',errors.length===0,errors);
    receipt.status='passed';
    log.push(`${stamp()} acceptance passed; creates=${receipt.creates}; fights=${receipt.fights}`);
  } catch (error) {
    receipt.status = 'failed'; receipt.failure = error.stack || String(error); log.push(`${stamp()} failed: ${receipt.failure}`);
    throw error;
  } finally {
    clearTimeout(deadline);
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    receipt.finishedAt = stamp();
    await save();
    await writeFile(LOG, `${log.join('\n')}\n`, previous ? { flag: 'a' } : { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ status: receipt.status, receipt: RECEIPT, log: LOG, screenshots: receipt.screenshots, creates: receipt.creates, fights: receipt.fights })}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) run().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
