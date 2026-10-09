#!/usr/bin/env node
// Full UI acceptance runner for Resonance. This file is intentionally only prepared here;
// running it starts Chrome and writes verification sessions, screenshots, and a receipt.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const CANONICAL_ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const VERIFY_ROOT = path.join(CANONICAL_ROOT, 'runtime/resonance/verification');
const SESSION_DIR = path.join(VERIFY_ROOT, 'sessions');
const FIXTURE_SESSION_DIR = path.join(VERIFY_ROOT, 'fixture-sessions');
const FIXTURE_INDEPENDENT_DIR = path.join(VERIFY_ROOT, 'fixture-independent-sessions');
const FIXTURE_RECORDING_DIR = path.join(VERIFY_ROOT, 'fixture-recordings');
const SCREENSHOT_DIR = path.join(VERIFY_ROOT, 'screenshots');
const RECEIPT_PATH = path.join(VERIFY_ROOT, 'browser-receipt.json');
const PROFILE_DIR = path.join(CANONICAL_ROOT, '.omni/tmp/resonance/browser-profile');
const WSH_CONFIG_PATH = 'C:/Users/lilithgames/AppData/Roaming/wsh/config.json';
const DEADLINE_MS = 25 * 60 * 1000;
const urlArg = process.argv.findIndex((arg) => arg === '--url');
const REMOTE_ENTRY_URL = urlArg >= 0 ? process.argv[urlArg + 1] : process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length) || null;
const workshopUrlArg = process.argv.findIndex((arg) => arg === '--workshop-url');
const REMOTE_WORKSHOP_URL = workshopUrlArg >= 0 ? process.argv[workshopUrlArg + 1] : process.argv.find((arg) => arg.startsWith('--workshop-url='))?.slice('--workshop-url='.length) || null;
const embedUrlArg = process.argv.findIndex((arg) => arg === '--embed-url');
const REMOTE_EMBED_URL = embedUrlArg >= 0 ? process.argv[embedUrlArg + 1] : process.argv.find((arg) => arg.startsWith('--embed-url='))?.slice('--embed-url='.length) || null;
const REMOTE_MODE = !!REMOTE_ENTRY_URL;
if (REMOTE_ENTRY_URL) {
  const parsed = new URL(REMOTE_ENTRY_URL);
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.pathname.endsWith('/resonance.html')) throw new Error('--url 必须是可访问的 resonance.html HTTP(S) 页面地址');
}
if (REMOTE_WORKSHOP_URL) {
  const parsed = new URL(REMOTE_WORKSHOP_URL);
  if (!REMOTE_MODE || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('--workshop-url 需要与 --url 一起使用，并且必须是 HTTP(S) Workshop 入口');
}
if (REMOTE_EMBED_URL) {
  const parsed = new URL(REMOTE_EMBED_URL);
  if (!REMOTE_MODE || !REMOTE_WORKSHOP_URL || !['http:', 'https:'].includes(parsed.protocol)
    || parsed.pathname !== '/stronghold/resonance.html' || parsed.origin !== new URL(REMOTE_WORKSHOP_URL).origin) {
    throw new Error('--embed-url 必须与 --url/--workshop-url 一起使用，并精确指向 Workshop 同源 /stronghold/resonance.html');
  }
}
function matchesExpectedEmbeddedGame(candidateUrl, expectedUrl) {
  try {
    const candidate = new URL(candidateUrl), expected = new URL(expectedUrl);
    return candidate.origin === expected.origin && candidate.pathname === expected.pathname;
  } catch { return false; }
}
if (process.argv.includes('--self-test-embed-url')) {
  const expected = 'https://workshop.colorc.cc/stronghold/resonance.html';
  if (!matchesExpectedEmbeddedGame(`${expected}?session=abc#shop`, expected)
    || matchesExpectedEmbeddedGame('https://colorc.cc/stronghold/resonance.html', expected)
    || matchesExpectedEmbeddedGame('https://workshop.colorc.cc/other/resonance.html', expected)) {
    throw new Error('embedded URL exact-origin/path pure check failed');
  }
  process.stdout.write(JSON.stringify({ ok: true, expectedOrigin: new URL(expected).origin, expectedPath: new URL(expected).pathname }) + '\n');
  process.exit(0);
}
const [{ startServer }, { loadData }, { getResonanceCatalog, resonanceContent }, { createSession, validateSession },
  { getResonanceField, runResonanceBattle }, { legalSummonCells },
  { ARCHETYPES, SCENARIO_CONFIGS, buildScenario, makePactTerminalRoster }] = await Promise.all([
  import('../../server/index.js'), import('../../server/data.js'), import('../../server/modes/resonance/catalog.js'),
  import('../../server/modes/resonance/session.js'), import('../../server/modes/resonance/battle.js'),
  import('../../server/modes/resonance/summons.js'), import('./archetype-balance.mjs'),
]);
const STORIES = [
  'opening-four-difficulties', 'opening-three-environments', 'renderer-native', 'renderer-dom-fallback',
  'purchase-refresh-xp-shop-lock', 'natural-flow-supply-claims', 'equip-unequip-combine-recycle', 'move-and-four-directions',
  'summon-order-and-clear', 'copy-selector', 'fixture-copy-summon-real-battle', 'supply-and-strategy-description', 'strategy-pair-selection', 'fixture-high-end-real-battle',
  'terminal-normal-victory-final-panel', 'terminal-funny-final-panel', 'terminal-hard-final-panel',
  'terminal-hp-depleted-final-panel', 'terminal-round-limit-loss-final-panel', 'abyss-28-29-30-final-panel',
  'battle-report-pause-speed-settlement', 'session-reload', 'deep-links-and-copy', 'body-text-selection',
  'workshop-iframe-fullscreen-session-fragment', 'landscape-layout', 'section-copy-links',
];

const requireFromCanonical = createRequire(path.join(CANONICAL_ROOT, 'package.json'));
const puppeteer = requireFromCanonical('puppeteer-core');
const results = new Map(STORIES.map((name) => [name, { status: 'unavailable', evidence: '尚未执行' }]));
const remoteStories = new Map(['production-starts','production-renderers','production-natural-battles-and-supply','production-shop-actions','production-deep-links-and-copy','production-session-reload','production-selection-and-layout','production-workshop-embedded-fullscreen','production-section-copy-links']
  .map((name) => [name, { status: 'unavailable', evidence: '尚未执行' }]));
const sessions = [];
const fixtureSessions = [];
const copiedLinkEvidence = new Map();
const verifiedLinkKinds = new Set();
const naturalSupplyClaims = [];
const screenshots = [];
const errors = [];
const missingResources = [];
let server;
let fixtureServer;
let browser;
let timeoutHandle;
let timedOut = false;

function story(name, status, evidence) {
  if (!results.has(name)) throw new Error(`unknown acceptance story: ${name}`);
  results.set(name, { status, evidence: String(evidence || '') });
}
function passed(name, evidence) { story(name, 'passed', evidence); }
function unavailable(name, evidence) { story(name, 'unavailable', evidence); }
function remoteStory(name, status, evidence) { if (remoteStories.has(name)) remoteStories.set(name, { status, evidence: String(evidence || '') }); }
function entryUrl(serverInstance, params = {}) {
  const url = new URL(serverInstance.entryUrl || `${serverInstance.url}/resonance.html`);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  return url.href;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function attachPageDiagnostics(page, label = 'page') {
  page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on('response', (response) => {
    const status = response.status();
    const url = new URL(response.url());
    const sameOrigin = url.origin === new URL(page.url() || 'http://127.0.0.1').origin;
    if (url.pathname.endsWith('/favicon.ico')) return;
    if (REMOTE_MODE) {
      if (status !== 404 && status < 500) return;
      const type = response.request().resourceType();
      if (['image','font','media'].includes(type)) missingResources.push({ status, url: response.url(), resourceType: type });
      else if (sameOrigin) errors.push(`same-origin business HTTP ${status} ${response.url()}`);
    } else if (sameOrigin && status >= 400) errors.push(`HTTP ${status} ${response.url()}`);
  });
  if (!REMOTE_MODE) page.on('console', (message) => { if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`); });
}
const copiesForStar = (star) => ({ 1: 1, 2: 3, 3: 9 })[star];
const tokenIdsFor = (operator, star = 1) => {
  const record = operator?.stars?.[star]?.record || {};
  const tokens = record.skill?.tokens ?? record.tokens ?? [];
  const ids = tokens.map((entry) => typeof entry === 'string' ? entry : entry?.tokenId).filter(Boolean);
  return [...new Set(record.skill?.overrideTokenKey ? ids.filter((id) => id === record.skill.overrideTokenKey) : ids)];
};
function canUseClass(operator, tileClass) {
  return operator.position === 'RANGED' || tileClass === 'melee' || (tileClass === 'ranged' && operator.canDeployHighGround === true);
}
function legalTileKeys(field, operator) {
  return [...(field?.deployMap || new Map()).entries()].filter(([, tileClass]) => canUseClass(operator, tileClass)).map(([key]) => key);
}
function adjacentTilePair(field, first, second) {
  const b = new Set(legalTileKeys(field, second));
  for (const aKey of legalTileKeys(field, first)) {
    const [ar, ac] = aKey.split(',').map(Number);
    for (const bKey of b) {
      const [br, bc] = bKey.split(',').map(Number);
      if (Math.abs(ar - br) + Math.abs(ac - bc) === 1) return [aKey, bKey];
    }
  }
  return null;
}
function fixtureOpPair(catalog, field) {
  const ids = catalog.config.activeOperatorIds;
  for (let ai = 0; ai < ids.length; ai++) for (let bi = ai + 1; bi < ids.length; bi++) {
    const a = catalog.operators[ids[ai]], b = catalog.operators[ids[bi]];
    if (a.charId === b.charId) continue;
    const tiles = adjacentTilePair(field, a, b);
    if (tiles) return [{ operatorId: a.id, star: 1, tile: tiles[0] }, { operatorId: b.id, star: 1, tile: tiles[1] }];
  }
  return null;
}
function firstOperator(catalog, predicate, { star = 1 } = {}) {
  return catalog.config.activeOperatorIds.find((id) => predicate(catalog.operators[id]) && catalog.operators[id]?.stars?.[star]?.record);
}
async function writeFixtureSession({ data, catalog, specs, strategyId = null, label, seed = null, difficulty = 'NORMAL', round = 1, level = 10, hp = 100, dryRun = false, requireAllDeployed = false }) {
  const fixtureSeed = seed ?? (0x51a7 + fixtureSessions.length);
  const created = createSession({ seed: fixtureSeed, difficulty, environmentId: catalog.config.environmentId, catalog });
  assert(created.ok, `fixture createSession failed: ${created.error}`);
  const state = created.state;
  for (const piece of state.pieces) state.poolRemaining[piece.operatorId] += copiesForStar(piece.star);
  state.pieces = [];
  state.inventory = [];
  state.consumables = [];
  state.strategies = [];
  state.strategyState = {};
  state.pendingChoices = [];
  state.phase = 'prep';
  state.round = round; state.level = level; state.xp = 0; state.hp = hp; state.gold = 0; state.phase = 'prep'; state.nodeStarted = true;

  const reserve = (operatorId, star) => {
    const required = copiesForStar(star);
    if (!catalog.config.activeOperatorIds.includes(operatorId)) throw new Error(`fixture operator outside active pool: ${operatorId}`);
    while (state.poolRemaining[operatorId] < required) {
      const held = state.shop.offers.find((offer) => offer.operatorId === operatorId);
      if (!held) throw new Error(`fixture pool cannot supply ${operatorId} at ${star} star`);
      held.operatorId = null; held.cost = 0; state.poolRemaining[operatorId]++;
    }
    state.poolRemaining[operatorId] -= required;
    const spec = specs.find((entry) => entry.operatorId === operatorId && entry.star === star && !entry._reserved);
    if (spec) spec._reserved = true;
    const template = { uid: `p${state.nextUid++}`, operatorId, star, equipment: (spec?.equipment ?? []).map((itemId) => ({ uid: `i${state.nextUid++}`, itemId })), growth: structuredClone(spec?.growth ?? {}), row: null, col: null, dir: spec?.dir || 'RIGHT', summonOrders: [] };
    return template;
  };
  state.pieces = specs.map((spec) => reserve(spec.operatorId, spec.star));
  for (const spec of specs) delete spec._reserved;
  const field = getResonanceField(state, { data, catalog });
  const occupied = new Set();
  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index], piece = state.pieces[index], operator = catalog.operators[spec.operatorId];
    let tile = spec.tile;
    if (spec.summonTokenId) {
      tile = legalTileKeys(field, operator).find((key) => {
        if (occupied.has(key)) return false;
        const [row,col]=key.split(',').map(Number);piece.row=row;piece.col=col;
        return legalSummonCells(field,state,piece,operator,spec.summonTokenId).length>0;
      }) || null;
      if (!tile) throw new Error(`fixture summon has no legal native summon tile: ${spec.operatorId}/${spec.summonTokenId}`);
    }
    if (!tile) tile = legalTileKeys(field, operator).find((key) => !occupied.has(key));
    if (tile && (!legalTileKeys(field, operator).includes(tile) || occupied.has(tile))) throw new Error(`fixture deployment is illegal: ${label}/${operator.name}/${tile}`);
    if (!tile || occupied.has(tile)) { if (requireAllDeployed) throw new Error(`fixture member has no selected legal tile: ${label}/${operator.name}`); continue; }
    const [row, col] = tile.split(',').map(Number);
    piece.row = row; piece.col = col; occupied.add(tile);
  }
  let recipeResult = null;
  if (catalog.recipes?.length) {
    const recipe = catalog.recipes.find((entry) => entry.parts?.length === 2);
    const componentIds = [...(recipe?.parts || []), Object.keys(catalog.equipment).find((id) => catalog.equipment[id].kind === 'component' && !recipe?.parts?.includes(id))].filter(Boolean);
    state.inventory = componentIds.map((itemId) => ({ uid: `i${state.nextUid++}`, itemId }));
    recipeResult = recipe?.resultId || null;
  }
  const copyTarget = state.pieces.find((piece) => piece.star === 1);
  if (copyTarget) state.consumables.push({ uid: `c${state.nextUid++}`, kind: catalog.operators[copyTarget.operatorId].cost <= 2 ? 'smallCopy' : 'universalCopy', source: '验收夹具' });
  if (strategyId) {
    state.pendingChoices.push({ uid: `c${state.nextUid++}`, type: 'strategy', source: '验收夹具', options: [strategyId], remaining: 1 });
    state.phase = 'choice';
  }
  const validation = validateSession(state, { catalog });
  if (!validation.ok) throw new Error(`fixture state validation failed (${label}): ${JSON.stringify(validation.errors)}`);
  const id = randomUUID();
  if (!dryRun) {
    await writeFile(path.join(FIXTURE_SESSION_DIR, `${id}.json`), `${JSON.stringify(state)}\n`, { flag: 'wx' });
    fixtureSessions.push({ id, label, difficulty, round, hp, seed: fixtureSeed, environmentId: catalog.config.environmentId, stars: specs.map((spec) => `${spec.operatorId}:${spec.star}`), strategyId, recipeResult,
      summonOwnerId: specs.find((spec) => spec.summonTokenId)?.operatorId || null, summonTokenId: specs.find((spec) => spec.summonTokenId)?.summonTokenId || null,
      source: 'canonical createSession + validated isolated fixture state; browser actions still use real HTTP and runResonanceBattle' });
  }
  return { id, state, catalog };
}
async function prepareFixtures(data) {
  const envIds = Object.keys(resonanceContent.environments);
  const byEnvironment = new Map();
  const catalogFor = (id) => {
    if (!byEnvironment.has(id)) byEnvironment.set(id, getResonanceCatalog(data, { environmentId: id, seed: 1 }));
    return byEnvironment.get(id);
  };
  const common = catalogFor(envIds.includes('origin_laterano') ? 'origin_laterano' : envIds[0]);
  const commonField = getResonanceField(createSession({ seed: 41, difficulty: 'NORMAL', environmentId: common.config.environmentId, catalog: common }).state, { data, catalog: common });
  const strategyId = Object.entries(common.strategies).find(([, entry]) => entry.condition?.kind === 'choose_adjacent_pair')?.[0];
  const pair = fixtureOpPair(common, commonField);
  if (!pair || !strategyId) throw new Error('could not resolve a real adjacent-pair strategy fixture from the canonical catalog');
  const summonId = firstOperator(common, (operator) => tokenIdsFor(operator, 1).some((tokenId) => commonField.resolveToken?.(tokenId, operator.id, operator.fixedSkillIndex)?.placeable));
  const secondaryId = common.config.activeOperatorIds.find((id) => id !== summonId && common.operators[id].charId !== common.operators[summonId]?.charId);
  if (!summonId || !secondaryId) throw new Error('could not resolve a real summon owner in the fixture active pool');
  const summonTokenId = tokenIdsFor(common.operators[summonId], 1).find((tokenId) => commonField.resolveToken?.(tokenId, summonId, common.operators[summonId].fixedSkillIndex)?.placeable);
  const summonSpecs = [{ operatorId: summonId, star: 1, summonTokenId }, { operatorId: secondaryId, star: 1 }];
  const interactive = await writeFixtureSession({ data, catalog: common, specs: summonSpecs, label: 'copy/equipment/summon' });
  const pairFixture = await writeFixtureSession({ data, catalog: common, specs: pair, strategyId, label: 'adjacent-pair-strategy' });

  const highEnvironment = ['origin_sami', 'origin_kjerag'].find((id) => envIds.includes(id)) || common.config.environmentId;
  const highCatalog = catalogFor(highEnvironment);
  const highIds = highCatalog.config.activeOperatorIds.filter((id) => highCatalog.operators[id].stars?.[3]?.record);
  const snowIds = highIds.filter((id) => (highCatalog.operators[id].pacts || []).some((pact) => ['sami', 'kjerag'].includes(pact)));
  const chosen = [...snowIds.slice(0, 3)];
  for (const id of highIds) if (chosen.length < 4 && !chosen.includes(id)) chosen.push(id);
  if (chosen.length < 3) throw new Error(`only ${chosen.length} real active three-star operators available for high-end fixture`);
  const highend = await writeFixtureSession({ data, catalog: highCatalog, specs: chosen.slice(0, 4).map((operatorId) => ({ operatorId, star: 3 })), label: 'three-star-snow-environment' });
  const endgames = await prepareEndgameFixtures(data, catalogFor('origin_laterano'));
  return { interactive, pairFixture, highend, endgames, runner: runResonanceBattle.name };
}
function matureFixtureSpecs({data,catalog,difficulty,round,seed,composition}) {
  const definition={id:`browser-terminal-${difficulty.toLowerCase()}`,env:catalog.config.environmentId,core:composition.core.name,include:[],pact:composition.mainPact};
  const config={...SCENARIO_CONFIGS.at(-1),round:28,level:10,transferLimit:composition.transferLimit};
  const built=buildScenario({data,catalog,definition,config,coreStar:3,seed,rosterOverride:composition.roster});
  const state=built.state;state.difficulty=difficulty;state.roundLimit=difficulty==='ABYSS'?30:28;state.round=round;
  const field=getResonanceField(state,{data,catalog}),used=new Set();
  const order=state.pieces.map((piece,index)=>({piece,index})).sort((a,b)=>Number(catalog.operators[b.piece.operatorId].role==='frontline')-Number(catalog.operators[a.piece.operatorId].role==='frontline')||a.index-b.index);
  for(const {piece} of order){
    const operator=catalog.operators[piece.operatorId],current=`${piece.row},${piece.col}`;
    let key=legalTileKeys(field,operator).find((candidate)=>candidate===current&&!used.has(candidate));
    if(!key)key=legalTileKeys(field,operator).find((candidate)=>!used.has(candidate));
    if(!key)throw new Error(`terminal fixture has no legal deployment cell ${difficulty}/${round}/${operator.name}`);
    const [row,col]=key.split(',').map(Number);piece.row=row;piece.col=col;used.add(key);
  }
  return state.pieces.map((piece)=>({operatorId:piece.operatorId,star:piece.star,tile:`${piece.row},${piece.col}`,dir:piece.dir,equipment:piece.equipment.map((item)=>item.itemId),growth:structuredClone(piece.growth)}));
}
function battleProbe(state,data,catalog,label){
  const result=runResonanceBattle(state,{data,catalog,recording:false});
  if(Number(result.diagnostics?.errorCount??0)!==0)throw new Error(`${label} real Battle diagnostics: ${JSON.stringify(result.diagnostics?.errors??[])}`);
  return result;
}
async function findBattleOutcomeFixture({data,catalog,label,difficulty,round,level,hp,specsForSeed,accept,maxAttempts=48}){
  for(let seed=0x6e000;seed<0x6e000+maxAttempts;seed++){
    const specs=specsForSeed(seed),fixture=await writeFixtureSession({data,catalog,label,difficulty,round,level,hp,seed,specs,dryRun:true,requireAllDeployed:true});
    const outcome=battleProbe(fixture.state,data,catalog,label);
    if(!accept(outcome))continue;
    const saved=await writeFixtureSession({data,catalog,label,difficulty,round,level,hp,seed,specs,requireAllDeployed:true});
    return { ...saved, expected:{won:outcome.won,hpLoss:outcome.hpLoss,time:outcome.result?.time??null,bossHpLeft:outcome.result?.bossHpLeft??null},source:'validated fixture state + real recording:false Battle preflight; the UI later repeats the authoritative fight' };
  }
  throw new Error(`no deterministic real Battle outcome found for ${label} after ${maxAttempts} fixed seeds`);
}
async function prepareEndgameFixtures(data,catalog){
  const composition=makePactTerminalRoster(catalog,10,3,{coreMode:'preferred'});
  if(!composition.constructible)throw new Error(`endgame fixture cannot reach its configured main pact: ${composition.mainPact}`);
  const specsFor=(difficulty,round)=>(seed)=>matureFixtureSpecs({data,catalog,difficulty,round,seed,composition});
  const terminal={};
  for(const difficulty of ['NORMAL','FUNNY','HARD']){
    terminal[difficulty.toLowerCase()]=await findBattleOutcomeFixture({data,catalog,label:`terminal-${difficulty.toLowerCase()}`,difficulty,round:28,level:10,hp:100,
      specsForSeed:specsFor(difficulty,28),accept:(outcome)=>difficulty==='NORMAL'?outcome.won&&Math.floor(outcome.hpLoss)<100:true,maxAttempts:64});
  }
  const weak=firstOperator(catalog,(operator)=>operator.cost<=2&&operator.role!=='summoner'&&operator.stars?.[1]?.record);
  if(!weak)throw new Error('no active low-cost operator is available for terminal failure fixtures');
  const weakSpecs=()=>[{operatorId:weak,star:1}];
  const hpFailure=await findBattleOutcomeFixture({data,catalog,label:'terminal-hp-depleted',difficulty:'NORMAL',round:12,level:3,hp:1,specsForSeed:weakSpecs,
    accept:(outcome)=>!outcome.won&&Math.floor(outcome.hpLoss)>=1,maxAttempts:96});
  const roundLoss=await findBattleOutcomeFixture({data,catalog,label:'terminal-round-limit-loss',difficulty:'NORMAL',round:28,level:3,hp:100,specsForSeed:weakSpecs,
    accept:(outcome)=>!outcome.won&&Math.floor(outcome.hpLoss)<100,maxAttempts:96});
  let abyss=null;
  for(let seed=0x6f000;seed<0x6f030;seed++){
    const specs=matureFixtureSpecs({data,catalog,difficulty:'ABYSS',round:28,seed,composition});
    const fixture=await writeFixtureSession({data,catalog,label:'abyss-28-to-30',difficulty:'ABYSS',round:28,level:10,hp:100,seed,specs,dryRun:true,requireAllDeployed:true});
    const early=battleProbe(fixture.state,data,catalog,'abyss-round-28');
    if(!early.won||Math.floor(early.hpLoss)>=100)continue;
    fixture.state.round=29;
    const middle=battleProbe(fixture.state,data,catalog,'abyss-round-29');
    if(!middle.won||Math.floor(early.hpLoss)+Math.floor(middle.hpLoss)>=100)continue;
    fixture.state.round=30;
    const hidden=battleProbe(fixture.state,data,catalog,'abyss-round-30-hidden');
    const saved=await writeFixtureSession({data,catalog,label:'abyss-28-to-30',difficulty:'ABYSS',round:28,level:10,hp:100,seed,specs,requireAllDeployed:true});
    abyss={...saved,expectedRounds:[{round:28,won:early.won},{round:29,won:middle.won},{round:30,won:hidden.won,bossHpLeft:hidden.result?.bossHpLeft??null}],source:'three isolated stage probes use real hidden/elite/leader Battles; the browser session advances through official actions'};
    break;
  }
  if(!abyss)throw new Error('no deterministic ABYSS seed wins real rounds 28 and 29 and reaches a diagnostic-free hidden round 30');
  return {terminal,hpFailure,roundLoss,abyss,mainPact:composition.mainPact,core:composition.core.name,coreStar:3,accessibility:'fixed terminal test lineup; not an economy-achievability claim'};
}
async function waitForAny(page, selectors, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) if (await page.$(selector).catch(() => null)) return selector;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`未找到页面元素: ${selectors.join(', ')}`);
}
async function visible(handle) {
  return !!handle && handle.evaluate((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; }).catch(() => false);
}
async function enabled(handle) { return !!handle && handle.evaluate((el) => !el.disabled).catch(() => false); }
async function textOf(handle) { return handle?.evaluate((el) => el.innerText || el.textContent || '').catch(() => '') || ''; }
async function selectOption(handle, value) { return handle.select(String(value)); }
async function findTextHandle(page, selector, text, exact = false) {
  for (const handle of await page.$$(selector)) {
    const value = (await textOf(handle)).trim();
    if ((exact && value.split('\n')[0] === text) || (!exact && value.includes(text))) return handle;
  }
  return null;
}
async function clickText(page, selector, text, { exact = true, timeout = 10_000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const list = await page.$$(selector);
    for (const item of list) {
      const value = (await textOf(item)).trim();
      if ((!exact && value.includes(text)) || (exact && value.split('\n')[0] === text)) {
        if (await visible(item)) { await item.click(); return item; }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`未找到可点击文本 ${JSON.stringify(text)} (${selector})`);
}
async function clickButton(page, text) { return clickText(page, 'button', text, { exact: false }); }
async function waitGame(page) { await page.waitForSelector('.rs-game', { timeout: 60_000 }); }
async function stateOf(page, id) {
  const response = await page.evaluate(async (sessionId) => fetch(new URL(`resonance/api/sessions/${encodeURIComponent(sessionId)}?catalog=0`, location.href)).then((r) => r.json()), id);
  assert(response?.ok && response.state, '无法读取由页面创建的验证存档');
  return response.state;
}
async function startViaUi(page, { difficulty = 'NORMAL', environmentText = null } = {}) {
  if (environmentText) await clickText(page, '.rs-env-choice button', environmentText, { exact: false });
  await clickText(page, '.rs-difficulties button', ({ FUNNY: '轻松', NORMAL: '标准', HARD: '困难', ABYSS: '深渊' })[difficulty], { exact: false });
  await clickButton(page, '开始新的一局');
  await waitGame(page);
  const id = new URL(page.url()).searchParams.get('session');
  assert(id, '开局后URL没有存档定位参数');
  sessions.push({ id, purpose: `${difficulty}${environmentText ? `/${environmentText}` : ''}` });
  return { id, state: await stateOf(page, id) };
}
async function capture(page, name, purpose) {
  const file = path.join(SCREENSHOT_DIR, name);
  await page.screenshot({ path: file, fullPage: true, captureBeyondViewport: true });
  screenshots.push({ path: file, purpose });
}
async function leaveToOpening(page) {
  await clickButton(page, '返回开局');
  await page.waitForSelector('.rs-start__setup', { timeout: 30_000 });
}
async function clickEnabled(page, selector, label) {
  const list = await page.$$(selector);
  for (const el of list) {
    if (await visible(el) && await enabled(el)) {
      if (label && !(await textOf(el)).includes(label)) continue;
      await el.click(); return true;
    }
  }
  return false;
}
async function waitState(page, id, predicate, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = await stateOf(page, id).catch(() => null);
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`UI action did not reach expected authoritative session state (${id})`);
}
async function resolveChoicesViaUi(page, id) {
  let state = await stateOf(page, id);
  let passes = 0;
  while (state.phase === 'choice' && state.pendingChoices?.length && passes++ < 12) {
    const choice = state.pendingChoices[0];
    const section = await page.$(`#choice-${choice.uid}`);
    if (!section) throw new Error(`pending choice ${choice.uid} is not visible in UI`);
    const select = await section.$('select');
    if (choice.type === 'strategy' && select && (await select.$$('option')).length > 1) {
      await selectOption(select, await select.$eval('option:nth-child(2)', (option) => option.value));
      const button = await section.$('.rs-choice__option button');
      if (!button) throw new Error('strategy choice has no submit button');
      await button.click();
      state = await waitState(page, id, (next) => next.revision > state.revision);
      continue;
    }
    const choiceButtons = await section.$$('.rs-choice__option button');
    let clicked = false;
    for (const button of choiceButtons) {
      if (await enabled(button)) { await button.click(); clicked = true; break; }
    }
    if (!clicked) throw new Error(`choice ${choice.uid} has no enabled real UI option`);
    for (let selected = 1; selected < choice.remaining; selected++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const latestSection = await page.$(`#choice-${choice.uid}`);
      const remainingButtons = await latestSection?.$$('.rs-choice__option button') || [];
      let next = null;
      for (const button of remainingButtons) if (await enabled(button)) { next = button; break; }
      if (next) await next.click();
    }
    state = await waitState(page, id, (next) => next.revision > state.revision || next.phase !== 'choice');
  }
  return state;
}
async function advancePrepViaUi(page, id) {
  let state = await stateOf(page, id);
  for (let index = 0; index < 8 && state.phase !== 'complete'; index++) {
    if (state.phase === 'choice') { state = await resolveChoicesViaUi(page, id); continue; }
    if (state.node?.kind === 'logistics' || !state.nodeStarted) {
      const label = state.node?.kind === 'logistics' ? '领取后勤并继续' : '领取本节点补给';
      const button = await findTextHandle(page, 'button', label, false);
      if (!button || !await enabled(button)) return state;
      const previous = state.revision; await button.click();
      state = await waitState(page, id, (next) => next.revision > previous);
      naturalSupplyClaims.push({ round: state.round, nodeKind: state.node?.kind || 'supply', revision: state.revision });
      continue;
    }
    return state;
  }
  return state;
}
async function performRealFight(page, id, { captureName = null, pauseControls = false, closeReport = true } = {}) {
  let state = await advancePrepViaUi(page, id);
  if (state.phase !== 'prep' || state.node?.kind === 'logistics' || !state.nodeStarted) return { state, ran: false };
  if (!state.pieces.some((piece) => piece.row != null)) {
    const piece = state.pieces.find((entry) => entry.row == null && entry.legalTiles?.length);
    if (!piece) return { state, ran: false };
    await clickText(page, '.rs-piece button', piece.operator?.name || '', { exact: false });
    state = await waitState(page, id, (next) => next.pieces.find((entry) => entry.uid === piece.uid)?.row != null);
  }
  const battleRound = state.round;
  const beforeRevision = state.revision;
  const fight = await findTextHandle(page, 'button', '开始战斗', false);
  if (!fight || !await enabled(fight)) return { state, ran: false };
  const responsePromise = page.waitForResponse((response) => response.url().includes(`/resonance/api/sessions/${id}/actions`)
    && response.request().method() === 'POST', { timeout: 180_000 });
  await fight.click();
  const response = await responsePromise;
  const packet = await response.json();
  const settlement = packet.events?.find((event) => event.type === 'fight-settled');
  if (!packet.ok || !settlement) throw new Error(`real browser fight action did not settle: ${JSON.stringify(packet.error || packet.events)}`);
  await page.waitForSelector('.rs-replay', { timeout: 180_000 });
  if (captureName) await capture(page, captureName, '原生真实战斗回放');
  if (pauseControls) {
    await clickButton(page, '暂停');
    if (!await findTextHandle(page, '.rs-replay button', '继续', true)) throw new Error('replay pause button did not enter paused state');
    const speedSelect = await page.$('.rs-replay select');
    if (speedSelect) {
      await selectOption(speedSelect, '2');
      assert(await speedSelect.evaluate((el) => el.value) === '2', 'replay speed did not change to 2x');
    } else throw new Error('replay speed selector missing');
  }
  await clickButton(page, '跳到结算');
  await page.waitForSelector('.rs-result', { timeout: 45_000 });
  state = await waitState(page, id, (next) => next.revision > beforeRevision);
  if (closeReport) await clickButton(page, '关闭战报');
  return { state, ran: true, battleRound, settlement };
}
async function alignRosterToCurrentField(page,id){
  for(let pass=0;pass<16;pass++){
    const state=await stateOf(page,id),invalid=state.pieces.filter((piece)=>piece.row!=null&&!piece.legalTiles?.includes(`${piece.row},${piece.col}`));
    if(!invalid.length)return state;
    const piece=invalid[0],article=await page.$(`#member-${encodeURIComponent(piece.uid)}`),move=await article?.$('button');
    if(!move)throw new Error(`current battle field has no visible legal move control for ${piece.uid}`);
    await move.click();
    const next=await waitState(page,id,(candidate)=>{const changed=candidate.pieces.find((entry)=>entry.uid===piece.uid);return changed&&changed.row!=null&&changed.legalTiles?.includes(`${changed.row},${changed.col}`);});
    if(next.pieces.some((entry)=>entry.row==null))throw new Error(`field alignment benched a mature terminal fixture member (${piece.uid})`);
  }
  throw new Error(`could not align all fixture members to current stage field (${id})`);
}
async function assertFinalUi(page,fixture,result,{expectReason=null,reselect=false}={}){
  if(!result.ran||Number(result.settlement.diagnostics?.errorCount??0)!==0)throw new Error(`final fixture did not finish a diagnostic-free real Battle: ${fixture.label}`);
  const state=result.state;
  if(state.phase!=='complete'||!state.terminalReason)throw new Error(`fight did not reach an authoritative terminal state: ${state.phase}/${state.terminalReason}`);
  if(expectReason&&state.terminalReason!==expectReason)throw new Error(`unexpected final branch ${state.terminalReason}; expected ${expectReason}`);
  const panel=await page.$('.rs-final h2'),heading=(await textOf(panel)).trim(),body=await page.$eval('.rs-game',(element)=>element.innerText);
  if(!panel||!(state.terminalReason==='victory'?heading.includes('防线守住了'):heading.includes('本局结束')))throw new Error(`FinalPanel does not reflect authoritative terminal result (${heading})`);
  const reportRow=`第${result.battleRound}场 · ${result.settlement.won?'胜利':'失守'}`;
  if(!body.includes('本局战报')||!body.includes(reportRow)||!await page.$('.rs-result'))throw new Error(`terminal battle report or settlement panel missing (${reportRow})`);
  if(reselect){
    await capture(page,'06-final-victory.png','真实领袖胜利后的最终阵容、结算与战报');
    await clickButton(page,'关闭战报');await leaveToOpening(page);
    const environmentName=fixture.catalog.environments[fixture.state.environmentId]?.name;
    const environmentChoice=await findTextHandle(page,'.rs-env-choice button',environmentName,false);
    if(!environmentChoice||!await visible(environmentChoice))await clickButton(page,'查看全部环境');
    const restarted=await startViaUi(page,{difficulty:'HARD',environmentText:environmentName});
    if(restarted.id===fixture.id||restarted.state.environmentId!==fixture.state.environmentId||restarted.state.difficulty!=='HARD')throw new Error('return-to-opening and new selected game did not create the requested fresh session');
  }
  return {state,heading,reportRow};
}
async function exerciseTerminalOutcome(browserInstance,serverInstance,fixture,storyName,expectReason=null,{reselect=false,captureName=null}={}){
  const page=await openSessionPage(browserInstance,serverInstance,fixture.id);
  try{
    const fight=await performRealFight(page,fixture.id,{captureName,closeReport:false});
    const result=await assertFinalUi(page,fixture,fight,{expectReason,reselect});
    passed(storyName,`${fixture.state.difficulty} 第${fight.battleRound}节点由正式UI动作执行真实Battle；terminalReason=${result.state.terminalReason}，诊断0；${result.heading}，战报=${result.reportRow}${reselect?'；返回开局并重选困难模式/同环境成功':''}。仅是固定阵容fixture，不证明经济可达`);
  }finally{await page.close();}
}
async function exerciseAbyssFlow(browserInstance,serverInstance,fixture){
  const page=await openSessionPage(browserInstance,serverInstance,fixture.id),observed=[];
  try{
    for(const round of [28,29,30]){
      let state=await stateOf(page,fixture.id);
      if(state.round!==round||state.difficulty!=='ABYSS')throw new Error(`ABYSS flow reached wrong node ${state.difficulty}/${state.round}`);
      if(state.phase==='choice')state=await resolveChoicesViaUi(page,fixture.id);
      if(!state.nodeStarted||state.node?.kind==='logistics')state=await advancePrepViaUi(page,fixture.id);
      if(state.round!==round||state.phase!=='prep'||!state.nodeStarted)throw new Error(`could not advance officially into ABYSS node ${round}`);
      state=await alignRosterToCurrentField(page,fixture.id);
      const fight=await performRealFight(page,fixture.id,{closeReport:round!==30,captureName:round===30?'07-abyss-final.png':null});
      if(!fight.ran||Number(fight.settlement.diagnostics?.errorCount??0)!==0)throw new Error(`ABYSS ${round} source field battle did not complete cleanly`);
      observed.push({round,won:!!fight.settlement.won,terminalReason:fight.state.terminalReason??null});
      if(round<30&&(fight.state.phase==='complete'||fight.state.round!==round+1||fight.state.hp<=0))throw new Error(`ABYSS did not survive and advance from ${round} to ${round+1}`);
      if(round===30){const final=await assertFinalUi(page,fixture,{...fight,ran:true},{reselect:false});if(fight.state.terminalReason!=='victory'&&fight.state.terminalReason!=='round-limit-loss'&&fight.state.terminalReason!=='hp-depleted')throw new Error(`ABYSS 30 did not settle to a final branch: ${fight.state.terminalReason}`);await capture(page,'08-abyss-complete.png','深渊最终隐藏战结算与最终阵容');observed.push({heading:final.heading,report:final.reportRow});}
    }
    passed('abyss-28-29-30-final-panel',`正式session动作与Battle完成28→29→30；阶段结果${observed.map(row=>`${row.round??'FinalPanel'}:${row.won??row.heading}`).join('、')}；hidden/leader diagnostics=0。固定阵容fixture，不证明经济可达`);
  }finally{await page.close();}
}
async function openSessionPage(browserInstance, serverInstance, id, { fallback = false } = {}) {
  const page = await browserInstance.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  attachPageDiagnostics(page, 'session page');
  await page.browserContext().overridePermissions(serverInstance.url, ['clipboard-read', 'clipboard-write']);
  const params = { session: id }; if (fallback) params.render = 'fallback';
  await page.goto(entryUrl(serverInstance, params), { waitUntil: 'domcontentloaded' });
  await waitGame(page);
  return page;
}
async function exerciseFixtureInteractions(browserInstance, fixtureServerInstance, fixture) {
  const page = await openSessionPage(browserInstance, fixtureServerInstance, fixture.id);
  try {
    let state = await stateOf(page, fixture.id);
    await collectStoryLinks(page, fixtureServerInstance);
    const inventoryLink = await verifyCopiedLinkKinds(browserInstance, page, fixtureServerInstance, ['inventory']);
    for (const kind of inventoryLink.verified) verifiedLinkKinds.add(kind);
    await page.goto(`${fixtureServerInstance.url}/resonance.html?session=${encodeURIComponent(fixture.id)}`, { waitUntil: 'domcontentloaded' });
    await waitGame(page);
    state = await stateOf(page, fixture.id);
    const recipe = fixture.catalog.recipes.find((entry) => entry.resultId === fixture.recipeResult);
    const target = state.pieces[0];
    const equip = await page.$(`#inventory-${state.inventory[0]?.uid} select[aria-label="装备给谁"]`);
    if (!recipe || !target || !equip) throw new Error('fixture did not expose canonical recipe, owner, and equip selector');
    await selectOption(equip, target.uid);
    state = await waitState(page, fixture.id, (next) => next.pieces.find((piece) => piece.uid === target.uid)?.equipment.length === 1);
    await collectStoryLinks(page, fixtureServerInstance);
    const equippedLink = await verifyCopiedLinkKinds(browserInstance, page, fixtureServerInstance, ['equipped']);
    for (const kind of equippedLink.verified) verifiedLinkKinds.add(kind);
    await page.goto(`${fixtureServerInstance.url}/resonance.html?session=${encodeURIComponent(fixture.id)}`, { waitUntil: 'domcontentloaded' });
    await waitGame(page);
    state = await stateOf(page, fixture.id);
    const unequip = await page.$(`#member-${target.uid} .rs-equipped button`);
    if (!unequip) throw new Error('fixture equipment did not appear on the operator card');
    await unequip.click();
    state = await waitState(page, fixture.id, (next) => next.pieces.find((piece) => piece.uid === target.uid)?.equipment.length === 0 && next.inventory.length >= 3);

    const materialIds = recipe.parts;
    const materialUids = materialIds.map((itemId) => state.inventory.find((entry) => entry.itemId === itemId)?.uid);
    if (materialUids.some((uid) => !uid)) throw new Error(`fixture recipe materials missing: ${materialIds.join(',')}`);
    for (const uid of materialUids) await (await page.$(`#inventory-${uid} input[type="checkbox"]`)).click();
    const combine = await findTextHandle(page, 'button', '合成所选', true);
    if (!combine || !await enabled(combine)) throw new Error('fixture recipe components are not combinable in the UI');
    await combine.click();
    state = await waitState(page, fixture.id, (next) => next.inventory.some((entry) => entry.itemId === fixture.recipeResult));
    const completed = state.inventory.find((entry) => entry.itemId === fixture.recipeResult);
    const recycle = await findTextHandle(page, `#inventory-${completed.uid} button`, '回收', false);
    if (!recycle) throw new Error('completed fixture equipment has no recycle control');
    await recycle.click();
    state = await waitState(page, fixture.id, (next) => !next.inventory.some((entry) => entry.uid === completed.uid));
    passed('equip-unequip-combine-recycle', `隔离fixture真实UI依次装配/卸下/合成${recipe.resultName}/回收；不证明这些材料在玩家经济中可达`);

    const copySelect = await page.$('.rs-piece select[aria-label="选择复制器"]');
    if (!copySelect) throw new Error('fixture copy consumable selector not visible');
    const consumableUid = await copySelect.$eval('option:nth-child(2)', (option) => option.value);
    const beforeCopy = state;
    const copyOwnerUid = await copySelect.evaluate((el) => el.closest('.rs-piece')?.id?.replace(/^member-/, ''));
    const previousStar = beforeCopy.pieces.find((piece) => piece.uid === copyOwnerUid)?.star;
    await selectOption(copySelect, consumableUid);
    state = await waitState(page, fixture.id, (next) => next.consumables.length < beforeCopy.consumables.length
      && (next.pieces.length > beforeCopy.pieces.length || next.pieces.find((piece) => piece.uid === copyOwnerUid)?.star !== previousStar));
    passed('copy-selector', `隔离fixture从真实选择器使用复制器${consumableUid}；不证明补给经济可达`);

    const owner = state.pieces.find((piece) => piece.operatorId === fixture.summonOwnerId && piece.row != null);
    const summon = owner && await page.$(`#member-${owner.uid} .rs-summons select`);
    if (!summon || (await summon.$$('option')).length < 2) throw new Error(`fixture ${fixture.summonTokenId} has no legal player-visible summon cells`);
    await selectOption(summon, await summon.$eval('option:nth-child(2)', (option) => option.value));
    state = await waitState(page, fixture.id, (next) => next.pieces.find((piece) => piece.uid === owner.uid)?.summonOrders?.length > 0);
    await selectOption(summon, '');
    state = await waitState(page, fixture.id, (next) => !next.pieces.find((piece) => piece.uid === owner.uid)?.summonOrders?.length);
    passed('summon-order-and-clear', `隔离fixture固定技能召唤物${fixture.summonTokenId}真实选择合法格并清除；不证明自然商店可达`);
    const battle = await performRealFight(page, fixture.id);
    if (!battle.ran || Number(battle.settlement.diagnostics?.errorCount ?? 0) !== 0) throw new Error('copy/summon fixture did not complete a real diagnostic-free resonance Battle');
    passed('fixture-copy-summon-real-battle', `隔离fixture复制后继续完成真实Battle；所用复制器${consumableUid}。不证明补给经济可达`);
  } finally { await page.close(); }
}
async function exercisePairFixture(browserInstance, fixtureServerInstance, fixture) {
  const page = await openSessionPage(browserInstance, fixtureServerInstance, fixture.id);
  try {
    const state = await stateOf(page, fixture.id);
    await collectStoryLinks(page, fixtureServerInstance);
    const choiceLink = await verifyCopiedLinkKinds(browserInstance, page, fixtureServerInstance, ['choice']);
    for (const kind of choiceLink.verified) verifiedLinkKinds.add(kind);
    await page.goto(`${fixtureServerInstance.url}/resonance.html?session=${encodeURIComponent(fixture.id)}`, { waitUntil: 'domcontentloaded' });
    await waitGame(page);
    const choice = state.pendingChoices?.[0];
    const section = choice && await page.$(`#choice-${choice.uid}`);
    const description = section && await section.$('.rs-choice__option p');
    const text = await textOf(description);
    const definition = fixture.catalog.strategies[fixture.strategyId];
    if (!section || !text.includes(definition.description) || !text.includes('条件：') || !text.includes('时点：')) throw new Error('strategy fixture did not display full description/condition/timing');
    const select = await section.$('select');
    if (!select || (await select.$$('option')).length < 2) throw new Error('pair fixture lacks two genuinely adjacent deployed operators');
    const targetText = await select.$eval('option:nth-child(2)', (option) => option.innerText);
    await selectOption(select, await select.$eval('option:nth-child(2)', (option) => option.value));
    const submit = await section.$('.rs-choice__option button');
    if (!submit) throw new Error('pair strategy submit control missing');
    await submit.click();
    const after = await waitState(page, fixture.id, (next) => next.phase !== 'choice' && next.strategies?.some((entry) => (typeof entry === 'string' ? entry : entry.id) === fixture.strategyId));
    passed('strategy-pair-selection', `隔离fixture在相邻上阵干员间选择并经正式动作提交策略：${targetText}；不证明策略节点经济可达`);
    passed('supply-and-strategy-description', `隔离fixture显示完整策略描述、条件和时点；正式状态已选策略数${after.strategies.length}`);
    const fight = await performRealFight(page, fixture.id);
    if (fight.ran && Number(fight.settlement.diagnostics?.errorCount ?? 0) === 0) return { page, battle: fight };
    throw new Error('pair fixture did not complete a real error-free native Battle');
  } catch (error) { await page.close(); throw error; }
}
async function exerciseHighendFixture(browserInstance, fixtureServerInstance, fixture) {
  const page = await openSessionPage(browserInstance, fixtureServerInstance, fixture.id);
  try {
    const before = await stateOf(page, fixture.id);
    if (before.pieces.length < 3 || before.pieces.some((piece) => piece.star !== 3 || piece.row == null)) throw new Error('high-end fixture roster is not a deployed 3-star team');
    const focusedPacts = Object.entries(before.pacts || {}).filter(([id, pact]) => ['sami','kjerag'].includes(id) && pact.activeThreshold > 0);
    if (!focusedPacts.length) throw new Error('high-end fixture did not resolve a live Sami/Kjerag pact threshold');
    const result = await performRealFight(page, fixture.id, { captureName: '05-high-end-fixture.png' });
    if (!result.ran || Number(result.settlement.diagnostics?.errorCount ?? 0) !== 0) throw new Error('high-end fixture failed to execute native Battle without diagnostics');
    passed('fixture-high-end-real-battle', `真实runResonanceBattle调用；3星干员${before.pieces.length}名；生效盟约档：${focusedPacts.map(([id,pact]) => `${id}:${pact.activeThreshold}`).join('、')}；错误诊断0。此夹具只验内容/战斗，不证明经济可达`);
  } finally { await page.close(); }
}
async function runStory(name, action) {
  try { await action(); }
  catch (error) {
    unavailable(name, `可执行分支失败：${error.message || error}`);
    errors.push(`${name}: ${error.stack || error}`);
  }
}
async function collectCopiedLinks(page, serverInstance) {
  const links = new Map();
  const expected = ['operator','pact','item','recipe','strategy','environment','member','inventory','equipped','offer','choice','node','battleNode'];
  for (const button of await page.$$('.rs-copy')) {
    if (!await visible(button)) continue;
    await button.click().catch(() => {});
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    try {
      const url = new URL(copied);
      const kind = decodeURIComponent(url.hash.slice(1).split('-', 1)[0]);
      if (url.origin === new URL(serverInstance.url).origin && kind && url.searchParams.get('session') && !links.has(kind)) links.set(kind, url.href);
    } catch { /* no browser-side data substitution; invalid clipboard results are omitted */ }
    if (expected.every((kind) => links.has(kind))) break;
  }
  const sessionButton = await findTextHandle(page, '.rs-resources button', '复制本局链接', true);
  if (sessionButton && !links.has('session')) {
    await sessionButton.click();
    const value = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    try { const url = new URL(value); if (url.origin === new URL(serverInstance.url).origin && url.searchParams.get('session')) links.set('session', url.href); } catch { /* unavailable clipboard */ }
  }
  return links;
}
async function collectStoryLinks(page, serverInstance) {
  const roster = await findTextHandle(page, '.rs-game button', '展开全部干员', true);
  if (roster) await roster.click().catch(() => {});
  for (const summary of await page.$$('details > summary')) await summary.click().catch(() => {});
  const links = await collectCopiedLinks(page, serverInstance);
  for (const [kind, url] of links) if (url && !copiedLinkEvidence.has(kind)) copiedLinkEvidence.set(kind, { url, server: serverInstance });
  return links;
}
function detailHashParts(url) {
  const raw = decodeURIComponent(url.hash.slice(1));
  const kinds = ['battleNode', 'environment', 'operator', 'strategy', 'inventory', 'equipped', 'session', 'choice', 'member', 'recipe', 'offer', 'pact', 'item', 'node', 'section'];
  const kind = kinds.find((candidate) => raw.startsWith(`${candidate}-`));
  return kind ? { kind, id: raw.slice(kind.length + 1) } : { kind: null, id: null };
}
async function verifySectionDeepLink(page, sectionId, expectedSessionId = null) {
  const targetSelector = `#rs-section-${sectionId}`;
  await page.waitForSelector(`${targetSelector} button[aria-label="复制区域链接"]`, { timeout: 15_000 });
  await page.click(`${targetSelector} button[aria-label="复制区域链接"]`);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const target = new URL(copied);
  const parsed = detailHashParts(target);
  assert(parsed.kind === 'section' && parsed.id === sectionId, `区域${sectionId}复制链接的定位片段不正确`);
  if (expectedSessionId) assert(target.searchParams.get('session') === expectedSessionId, `区域${sectionId}链接未保留当前对局`);
  await page.goto(copied, { waitUntil: 'domcontentloaded' });
  if (expectedSessionId) await waitGame(page);
  await page.waitForSelector(targetSelector, { timeout: 15_000 });
  await page.waitForFunction((selector) => {
    const section = document.querySelector(selector);
    if (!section) return false;
    const rect = section.getBoundingClientRect();
    return rect.top < innerHeight && rect.bottom > 0;
  }, { timeout: 15_000 }, targetSelector);
  return { sectionId, href: copied, sessionId: target.searchParams.get('session') || null };
}
function workshopFocusCardId(rawUrl) {
  const url = new URL(rawUrl);
  const queryFocus = url.searchParams.get('focus') || url.searchParams.get('card') || url.searchParams.get('cardId');
  if (queryFocus) return queryFocus;
  let hash = url.hash.slice(1);
  try { hash = decodeURIComponent(hash); } catch { /* keep the raw fragment for URLSearchParams */ }
  if (!hash) return '';
  if (hash.startsWith('card=')) return new URLSearchParams(hash).get('card') || '';
  return hash;
}
async function verifyCopiedLinkKinds(browserInstance, page, serverInstance, expectedKinds = []) {
  for (const summary of await page.$$('details > summary')) await summary.click().catch(() => {});
  const links = new Map(copiedLinkEvidence);
  for (const [kind, url] of await collectCopiedLinks(page, serverInstance)) if (url && !links.has(kind)) links.set(kind, { url, server: serverInstance });
  const verified = [];
  const detailKinds = new Set(['operator','pact','item','recipe','strategy','environment']);
  const kindsToCheck = expectedKinds.length ? expectedKinds : [...links.keys()];
  for (const kind of kindsToCheck) {
    const entry = links.get(kind);
    if (!entry) continue;
    const url = typeof entry === 'string' ? entry : entry.url;
    const originServer = typeof entry === 'string' ? serverInstance : entry.server;
    if (new URL(url).origin !== new URL(originServer.url).origin) throw new Error(`copied ${kind} link has wrong source origin`);
    const target = new URL(url);
    const parsed = detailHashParts(target);
    if (parsed.kind !== kind) throw new Error(`copied ${kind} link parsed as ${parsed.kind}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' }); await waitGame(page);
    if (detailKinds.has(kind)) await page.waitForSelector('.rs-detail', { timeout: 15_000 });
    else if (kind === 'member') await page.waitForFunction((id) => !!document.getElementById(`member-${encodeURIComponent(id)}`)?.matches(':focus'), { timeout: 15_000 }, parsed.id);
    else if (kind === 'session') {
      assert(target.searchParams.get('session') === parsed.id, '复制的本局链接hash与session参数不一致');
      await stateOf(page, parsed.id);
    }
    else {
      const prefix = { inventory:'inventory', equipped:'equipped', offer:'offer', choice:'choice', node:'node', battleNode:'battle-node' }[kind];
      if (prefix) await page.waitForSelector(`[id="${prefix}-${parsed.id.replaceAll('"', '\\"')}"]`, { timeout: 15_000 });
      else continue;
    }
    verified.push(kind);
    verifiedLinkKinds.add(kind);
  }
  const missing = expectedKinds.filter((kind) => !verified.includes(kind));
  return { verified, missing };
}
async function verifyIframeFullscreen(browserInstance, fixtureServerInstance, fixture) {
  const embedded = await openSessionPage(browserInstance, fixtureServerInstance, fixture.id);
  try {
    const embeddedLinks = await collectStoryLinks(embedded, fixtureServerInstance);
    const detailUrl = embeddedLinks.get('strategy');
    if (!detailUrl) throw new Error('iframe fixture has no real copyable strategy link');
    const wrapper = await browserInstance.newPage();
    try {
      await wrapper.setContent(`<iframe id="workshop-embed" title="共鸣嵌入画布" src="${detailUrl.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe>`);
      const frameDeadline = Date.now() + 30_000;
      let frame = null;
      while (!frame && Date.now() < frameDeadline) {
        frame = wrapper.frames().find((candidate) => candidate.url() === detailUrl) || null;
        if (!frame) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!frame) throw new Error('embedded session/detail page did not load in iframe');
      await frame.waitForSelector('.rs-game', { timeout: 60_000 });
      await frame.waitForSelector('.rs-detail', { timeout: 30_000 });
      const fullscreen = await findTextHandle(frame, 'a', '全屏打开', false);
      if (!fullscreen) throw new Error('embedded Resonance page has no full screen link');
      const href = await fullscreen.evaluate((el) => el.href);
      const hrefUrl = new URL(href), embeddedUrl = new URL(frame.url());
      if (hrefUrl.searchParams.get('session') !== fixture.id || hrefUrl.hash !== embeddedUrl.hash) throw new Error('full screen link dropped session or deep link fragment');
      const popupPromise = new Promise((resolve) => wrapper.once('popup', resolve));
      await fullscreen.click();
      const popup = await popupPromise;
      await waitGame(popup);
      if (new URL(popup.url()).searchParams.get('session') !== fixture.id || new URL(popup.url()).hash !== embeddedUrl.hash) throw new Error('opened full screen page did not preserve embedded session/fragment');
      await popup.close();
      passed('workshop-iframe-fullscreen-session-fragment', '本地iframe宿主中从真实策略定位链接点全屏；新页保留同一session与hash。iframe嵌入行为已验，实际Workshop宿主未接入本仓运行环境');
    } finally { await wrapper.close(); }
  } finally { await embedded.close(); }
}
async function verifyRemoteWorkshopEmbed(browserInstance, workshopUrl) {
  const workshop = await browserInstance.newPage();
  const scopedPages = new WeakMap();
  const scopedPageList = new Set();
  let targetHandler;
  const scopePage = (page) => {
    if (!scopedPages.has(page)) {
      const setup = installWorkshopBearerScope(page, workshopUrl);
      scopedPages.set(page, setup);
      scopedPageList.add(page);
    }
    return scopedPages.get(page);
  };
  targetHandler = (target) => {
    if (target.type() !== 'page') return;
    void target.page().then((page) => page && scopePage(page)).catch(() => {});
  };
  browserInstance.on('targetcreated', targetHandler);
  attachPageDiagnostics(workshop, 'remote Workshop page');
  try {
    const workshopAuth = await scopePage(workshop);
    await workshop.goto(workshopUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const expectedEmbeddedURL = REMOTE_EMBED_URL || REMOTE_ENTRY_URL;
    const expectedOrigin = new URL(expectedEmbeddedURL).origin;
    const hostDeadline = Date.now() + 30_000;
    let hostFrame = null;
    while (!hostFrame && Date.now() < hostDeadline) {
      hostFrame = workshop.frames().find((candidate) => {
        try { return candidate.parentFrame() && new URL(candidate.url()).pathname.endsWith('/notes-web.html'); }
        catch { return false; }
      }) || null;
      if (!hostFrame) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!hostFrame) throw new Error('Workshop页面没有载入外层 notes-web.html 画布宿主frame');
    const focusCardId = workshopFocusCardId(workshopUrl) || workshopFocusCardId(hostFrame.url());
    if (!focusCardId) throw new Error('Workshop URL及notes-web宿主URL都没有focus/card查询或#card定位；为避免误开其它卡，跳过宿主故事');
    const cardDeadline = Date.now() + 30_000;
    let card = null;
    while (!card && Date.now() < cardDeadline) {
      for (const candidate of await hostFrame.$$('.react-flow__node')) {
        if (await candidate.evaluate((el) => el.getAttribute('data-id')).catch(() => null) === focusCardId) { card = candidate; break; }
      }
      if (!card) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!card) throw new Error(`notes-web画布宿主中不存在URL指定的目标卡 ${focusCardId}`);
    let activate = await card.$('button[aria-label="游玩"]');
    let activationLabel = '游玩';
    if (!activate || !(await visible(activate))) {
      activate = await findTextHandle(card, 'button', '全屏查看', false);
      activationLabel = '全屏查看';
    }
    if (!activate || !(await visible(activate))) throw new Error(`目标卡 ${focusCardId} 没有可用的“游玩”或“全屏查看”入口`);
    await activate.click();
    const deadline = Date.now() + 30_000;
    let frame = null;
    while (!frame && Date.now() < deadline) {
      frame = workshop.frames().find((candidate) => {
        try {
          const url = new URL(candidate.url());
          let parent = candidate.parentFrame();
          let nestedInHost = false;
          while (parent) { if (parent === hostFrame) { nestedInHost = true; break; } parent = parent.parentFrame(); }
          return nestedInHost && matchesExpectedEmbeddedGame(url.href, expectedEmbeddedURL);
        } catch { return false; }
      }) || null;
      if (!frame) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!frame) throw new Error(`点击目标卡 ${focusCardId} 的“${activationLabel}”后未出现嵌套于notes-web画布的同源Resonance页面`);
    const { id: sessionId } = await startViaUi(frame);
    await frame.waitForSelector('.rs-game', { timeout: 60_000 });
    const rosterButton = await findTextHandle(frame, '.rs-game button', '展开全部干员', true);
    if (!rosterButton) throw new Error('新开的Workshop本局没有干员图鉴入口');
    await rosterButton.click();
    const operatorButton = await frame.$('.rs-roster article.rs-card button.rs-card__main');
    if (!operatorButton) throw new Error('新开的Workshop本局未显示可定位的干员详情');
    const operatorId = await operatorButton.evaluate((el) => el.closest('article')?.id?.slice('operator-'.length) || '');
    if (!operatorId) throw new Error('图鉴干员详情缺少可定位ID');
    await operatorButton.click();
    await frame.waitForSelector('.rs-detail', { timeout: 15_000 });
    const copyDetail = await frame.$('.rs-detail button[aria-label="复制定位链接"]');
    if (!copyDetail) throw new Error('打开的干员详情没有复制定位链接');
    await browserInstance.defaultBrowserContext().overridePermissions(expectedOrigin, ['clipboard-read', 'clipboard-write']).catch(() => {});
    await copyDetail.click();
    const detailUrl = await frame.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    const detailTarget = detailUrl ? new URL(detailUrl) : null;
    if (!detailTarget || detailTarget.searchParams.get('session') !== sessionId || detailHashParts(detailTarget).kind !== 'operator' || detailHashParts(detailTarget).id !== operatorId)
      throw new Error('干员详情复制链接未包含该iframe本局session和干员hash');
    await frame.goto(detailTarget.href, { waitUntil: 'domcontentloaded' });
    await frame.waitForSelector('.rs-detail', { timeout: 15_000 });
    const fullscreen = await findTextHandle(frame, 'a', '全屏打开', false);
    if (!fullscreen) throw new Error('Workshop新局的干员详情没有全屏入口');
    const iframeUrl = new URL(frame.url());
    const href = new URL(await fullscreen.evaluate((el) => el.href));
    if (href.searchParams.get('session') !== sessionId || href.hash !== iframeUrl.hash) throw new Error('Workshop iframe 的全屏链接未保留当前session/hash');
    const popupPromise = new Promise((resolve) => workshop.once('popup', resolve));
    await fullscreen.click();
    const popup = await popupPromise;
    try {
      await scopePage(popup);
      await waitGame(popup);
      const opened = new URL(popup.url());
      if (opened.searchParams.get('session') !== sessionId || opened.hash !== iframeUrl.hash) throw new Error('Workshop 全屏页未保留当前session/hash');
    } finally { await popup.close(); }
    return `实际Workshop入口聚焦卡 ${focusCardId}，点击“${activationLabel}”后在notes-web画布内新开局 ${sessionId}；通过干员详情真实复制链接后全屏打开并保留session与hash；同源凭据范围${workshopAuth.enabled ? '已启用' : '使用现有cookies/公开访问'}`;
  } finally {
    browserInstance.off('targetcreated', targetHandler);
    for (const page of scopedPageList) {
      const scoped = scopedPages.get(page);
      if (scoped) await scoped.then((value) => value.dispose()).catch(() => {});
    }
    await workshop.close();
  }
}

export function isScopedWorkshopBearerUrl(requestUrl, workshopUrl) {
  try {
    const request = new URL(requestUrl);
    const workshopTarget = new URL(workshopUrl);
    if (request.origin !== workshopTarget.origin) return false;
    const pathname = request.pathname.replace(/\/+$/, '') || '/';
    if (/^\/(?:bside\/)?play(?:\/|$)/i.test(pathname) || /(?:^|\/)resonance\.html$/i.test(pathname)) return false;
    if (pathname === '/lofa' || pathname.startsWith('/lofa/')) return true;
    if (pathname === '/bside/lofa' || pathname.startsWith('/bside/lofa/')) return true;
    if (pathname === '/bside/api' || pathname.startsWith('/bside/api/')) return true;
    const targetPath = workshopTarget.pathname.replace(/\/+$/, '') || '/';
    return pathname === targetPath
      || (targetPath !== '/' && pathname === `${targetPath}/`)
      || pathname === '/bside/notes-web.html'
      || pathname.startsWith('/bside/canvas/');
  } catch { return false; }
}

function readWorkshopBearer(workshopUrl) {
  try {
    const config = JSON.parse(readFileSync(WSH_CONFIG_PATH, 'utf8'));
    const configuredServer = new URL(String(config.server || ''));
    const target = new URL(workshopUrl);
    const configuredPath = configuredServer.pathname.replace(/\/+$/, '') || '/';
    const token = typeof config.token === 'string' ? config.token.trim() : '';
    if (!token || configuredServer.origin !== target.origin || configuredPath !== '/bside') return null;
    return token;
  } catch { return null; }
}

async function installWorkshopBearerScope(page, workshopUrl) {
  const token = readWorkshopBearer(workshopUrl);
  if (!token) return { enabled: false, dispose: async () => {} };
  const bearer = `Bearer ${token}`;
  await page.setRequestInterception(true);
  const onRequest = (request) => {
    const headers = { ...request.headers() };
    if (isScopedWorkshopBearerUrl(request.url(), workshopUrl)) headers.authorization = bearer;
    else if (headers.authorization === bearer) delete headers.authorization;
    void request.continue({ headers }).catch(() => {});
  };
  page.on('request', onRequest);
  return {
    enabled: true,
    dispose: async () => { page.off('request', onRequest); await page.setRequestInterception(false).catch(() => {}); },
  };
}
async function chooseNativeFieldAction(page, currentState) {
  const view = await page.evaluate(() => {
    const v = globalThis.__SP_VIEW__;
    if (!v) return null;
    const stats = v.raw?.stats?.();
    return { kind: v.kind, stats, hasGeometry: typeof v.pieceScreenRect === 'function' && typeof v.tileScreen === 'function' };
  });
  const fieldKind = view?.kind || 'unavailable';
  const canvas = await page.$('.rs-field__canvas');
  const rendererVisible = !!view && await canvas?.evaluate((el) => {
    const rect = el.getBoundingClientRect(); const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }).catch(() => false);
  const usableUnits = currentState.pieces.filter((piece) => piece.row == null && piece.legalTiles?.length);
  if (view?.hasGeometry && usableUnits.length) {
    const piece = usableUnits[0];
    const tile = (piece.legalTiles[1] || piece.legalTiles[0]).split(',').map(Number);
    const geometry = await page.evaluate(({ uid, row, col }) => {
      const view = globalThis.__SP_VIEW__;
      const rect = view.pieceScreenRect(Number(String(uid).replace(/^\D+/, '')));
      const dest = view.tileScreen(row, col);
      return { rect, dest };
    }, { uid: piece.uid, row: tile[0], col: tile[1] });
    if (geometry?.rect && geometry?.dest) {
      await page.mouse.move(geometry.rect.x + geometry.rect.width / 2, geometry.rect.y + geometry.rect.height / 2);
      await page.mouse.down(); await page.mouse.move(geometry.dest.x, geometry.dest.y, { steps: 8 }); await page.mouse.up();
      await waitForAny(page, ['.fwheel[role="dialog"]', '.rs-field__board']);
      const wheel = await page.$('.fwheel[role="dialog"]');
      if (wheel) {
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !document.querySelector('.fwheel[role="dialog"]'), { timeout: 10_000 }).catch(() => {});
      } else {
        await page.waitForSelector('.rs-field__board');
      }
      const cards = await page.$$('.rs-piece');
      let matchedCard = null;
      for (const candidate of cards) if ((await textOf(candidate)).includes(piece.operator?.name || '')) { matchedCard = candidate; break; }
      const selects = await matchedCard?.$$('select') || [];
      const facing = selects.at(-1);
      const directions = [];
      for (const dir of ['UP', 'RIGHT', 'DOWN', 'LEFT']) {
        if (facing && (await facing.$(`option[value="${dir}"]`))) {
          await selectOption(facing, dir);
          const updated = await stateOf(page, new URL(page.url()).searchParams.get('session'));
          if (updated.pieces.find((candidate) => candidate.uid === piece.uid)?.dir === dir) directions.push(dir);
        }
      }
      return { fieldKind, rendererVisible, view, deployed: true, directions };
    }
  }
  if (usableUnits.length) {
    // The explicit unit card is part of the real UI; its first legal cell deploys it.
    const piece = usableUnits[0];
    await clickText(page, '.rs-piece button', piece.operator?.name || '', { exact: false });
    let deployed = await stateOf(page, new URL(page.url()).searchParams.get('session'));
    const directions = [];
    const cards = await page.$$('.rs-piece');
    let card = null;
    for (const candidate of cards) if ((await textOf(candidate)).includes(piece.operator?.name || '')) { card = candidate; break; }
    const facing = (await card?.$$('select') || []).at(-1);
    for (const dir of ['UP', 'RIGHT', 'DOWN', 'LEFT']) {
      if (facing && await facing.$(`option[value="${dir}"]`)) {
        await selectOption(facing, dir);
        deployed = await stateOf(page, new URL(page.url()).searchParams.get('session'));
        if (deployed.pieces.find((candidate) => candidate.uid === piece.uid)?.dir === dir) directions.push(dir);
      }
    }
    return { fieldKind, rendererVisible, view, deployed: deployed.pieces.find((candidate) => candidate.uid === piece.uid)?.row != null, directions };
  }
  return { fieldKind, rendererVisible, view, deployed: false, directions: [] };
}

async function run() {
  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert(puppeteer?.launch, 'canonical puppeteer-core 不可用');
  const { access } = await import('node:fs/promises');
  await access(chromePath);
  await mkdir(VERIFY_ROOT, { recursive: true });
  if (!REMOTE_MODE) {
    await mkdir(SESSION_DIR, { recursive: true });
    await mkdir(FIXTURE_SESSION_DIR, { recursive: true });
  }
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await mkdir(PROFILE_DIR, { recursive: true });
  let fixtures = null;
  if (REMOTE_MODE) {
    server = { url: new URL(REMOTE_ENTRY_URL).origin, entryUrl: REMOTE_ENTRY_URL, close: async () => {} };
    remoteStory('production-starts', 'unavailable', '远端真实开局尚未开始');
  } else {
    const canonicalData = loadData(path.join(CANONICAL_ROOT, 'data'), { log: { warn() {}, error() {} } });
    fixtures = await prepareFixtures(canonicalData);
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true,
      installDir: CANONICAL_ROOT, dataDir: path.join(CANONICAL_ROOT, 'data'),
      independentDirectory: path.join(VERIFY_ROOT, 'independent-sessions'),
      resonanceDirectory: SESSION_DIR, recordingDirectory: path.join(VERIFY_ROOT, 'recordings') });
    fixtureServer = await startServer({ port: 0, host: '127.0.0.1', quiet: true,
      installDir: CANONICAL_ROOT, dataDir: path.join(CANONICAL_ROOT, 'data'),
      independentDirectory: FIXTURE_INDEPENDENT_DIR,
      resonanceDirectory: FIXTURE_SESSION_DIR, recordingDirectory: FIXTURE_RECORDING_DIR });
  }
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: PROFILE_DIR,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--window-size=1440,1000'] });
  const context = browser.defaultBrowserContext();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await context.overridePermissions(server.url, ['clipboard-read', 'clipboard-write']);
  if (fixtureServer) await context.overridePermissions(fixtureServer.url, ['clipboard-read', 'clipboard-write']);
  attachPageDiagnostics(page, REMOTE_MODE ? 'remote page' : 'local page');
  await page.goto(entryUrl(server), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.rs-start__setup', { timeout: 90_000 });
  await capture(page, '01-opening.png', '开局难度与环境选择');
  const sectionLinkEvidence = [];
  sectionLinkEvidence.push(await verifySectionDeepLink(page, 'start-settings'));

  const difficulties = [['FUNNY', '轻松'], ['NORMAL', '标准'], ['HARD', '困难'], ['ABYSS', '深渊']];
  const expectedRoundLimit = { FUNNY: 28, NORMAL: 28, HARD: 28, ABYSS: 30 };
  const difficultyEvidence = [];
  for (const [id, label] of difficulties) {
    const { id: sessionId, state } = await startViaUi(page, { difficulty: id });
    assert(state.difficulty === id && state.roundLimit === expectedRoundLimit[id], `开局 ${label} 状态或轮数上限错误`);
    difficultyEvidence.push(`${label}:${state.difficulty}/${state.roundLimit}`);
    await leaveToOpening(page);
  }
  passed('opening-four-difficulties', difficultyEvidence.join('，'));

  await clickButton(page, '查看全部环境');
  const envs = await page.$$eval('.rs-env-choice button', (buttons) => buttons.map((button) => ({
    label: button.querySelector('b')?.textContent?.trim() || '',
    text: button.innerText.trim(),
  })));
  const pickedEnvs = envs.filter((entry) => entry.label).slice(0, 3);
  const envEvidence = [];
  for (const env of pickedEnvs) {
    const { state } = await startViaUi(page, { difficulty: 'NORMAL', environmentText: env.label });
    const catalogResponse = await page.evaluate(async () => fetch(new URL('resonance/api/catalog?seed=1', location.href)).then((response) => response.json()));
    const actualName = catalogResponse.catalog?.environments?.[state.environmentId]?.name;
    assert(state.environmentId && actualName === env.label, `环境选择 ${env.label} 与存档环境不一致 (${state.environmentId}/${actualName})`);
    envEvidence.push(`${env.label}:${state.environmentId}`);
    await leaveToOpening(page);
  }
  if (envEvidence.length === 3) passed('opening-three-environments', envEvidence.join('，'));
  else unavailable('opening-three-environments', `开局页只暴露 ${envEvidence.length} 个可选环境`);
  if (REMOTE_MODE) remoteStory('production-starts', difficultyEvidence.length === 4 && envEvidence.length === 3 ? 'passed' : 'unavailable',
    `远端真实存档难度/轮数上限：${difficultyEvidence.join('，')}；环境：${envEvidence.join('，') || '无'}`);

  const { id: mainId, state: initial } = await startViaUi(page, { difficulty: 'NORMAL' });
  await page.waitForSelector('.rs-field__canvas', { timeout: 60_000 });
  for (const sectionId of ['field', 'shop', 'equipment'])
    sectionLinkEvidence.push(await verifySectionDeepLink(page, sectionId, mainId));
  passed('section-copy-links', sectionLinkEvidence.map((entry) => `${entry.sectionId}${entry.sessionId ? `@${entry.sessionId}` : ''}`).join('、'));
  if (REMOTE_MODE) remoteStory('production-section-copy-links', 'passed', `开局与对局区域链接均保留可用定位；${sectionLinkEvidence.map((entry) => entry.sectionId).join('、')}`);
  let field = await chooseNativeFieldAction(page, initial);
  const prepState = await stateOf(page, mainId);
  await capture(page, '02-prep.png', '真实干员整备与部署');
  await collectStoryLinks(page, server);
  const mode = field.view?.kind;
  if (mode === 'engine' && field.rendererVisible && field.view?.stats?.board3d?.on) passed('renderer-native', `Pixi/Spine引擎真实运行；board3d=${JSON.stringify(field.view.stats.board3d)}；Spine=${JSON.stringify(field.view.stats.spine)}`);
  else unavailable('renderer-native', `期望原生engine/3D/Spine，实际mode=${mode || '未就绪'}，canvasVisible=${field.rendererVisible}`);
  const fallbackPage = await browser.newPage();
  await fallbackPage.setViewport({ width: 1000, height: 700 });
  fallbackPage.on('pageerror', (error) => errors.push(`fallback pageerror: ${error.message}`));
  attachPageDiagnostics(fallbackPage, 'fallback page');
  await fallbackPage.goto(entryUrl(server, { render: 'fallback', session: mainId }), { waitUntil: 'domcontentloaded' });
  await waitGame(fallbackPage);
  await fallbackPage.waitForFunction(() => globalThis.__SP_VIEW__?.kind === 'fallback', { timeout: 60_000 });
  const fallbackUnit = (await stateOf(fallbackPage, mainId)).pieces.find((piece) => piece.row != null);
  const fallbackSelect = await fallbackPage.$('.rs-piece select:last-of-type');
  let fallbackVerified = false;
  if (fallbackUnit && fallbackSelect) {
    for (const dir of ['UP', 'RIGHT', 'DOWN', 'LEFT']) {
      if (await fallbackSelect.$(`option[value="${dir}"]`)) {
        await selectOption(fallbackSelect, dir);
        if ((await stateOf(fallbackPage, mainId)).pieces.find((piece) => piece.uid === fallbackUnit.uid)?.dir === dir) { fallbackVerified = true; break; }
      }
    }
  }
  if (fallbackVerified) passed('renderer-dom-fallback', 'render=fallback下DOM棋子/朝向控件与正式session API成功交互');
  else unavailable('renderer-dom-fallback', 'fallback已挂载但没有完成真实session朝向交互');
  if (REMOTE_MODE) {
    const nativeOk = results.get('renderer-native').status === 'passed';
    remoteStory('production-renderers', nativeOk && fallbackVerified ? 'passed' : 'unavailable', `native=${results.get('renderer-native').status}；fallback=${fallbackVerified ? 'passed' : 'unavailable'}；fallback朝向动作已写入真实session`);
  }
  await fallbackPage.close();
  if (field.deployed && field.directions.join(',') === 'UP,RIGHT,DOWN,LEFT') passed('move-and-four-directions', '使用真实棋盘拖放部署，再通过朝向控件提交四方向操作');
  else if (field.deployed) unavailable('move-and-four-directions', `已真实部署；朝向操作覆盖：${field.directions.join(',')}`);
  else unavailable('move-and-four-directions', '未找到有合法格的备战干员或可用棋盘坐标');

  const shopResult = [];
  const beforeShop = await stateOf(page, mainId);
  const locked = await clickEnabled(page, '.rs-panel button', '锁定');
  if (locked) {
    const lockedState = await waitState(page, mainId, (next) => next.shop.locked);
    shopResult.push('已锁定');
    await clickButton(page, '解锁');
    await waitState(page, mainId, (next) => !next.shop.locked && next.revision > lockedState.revision);
  }
  const bought = await clickEnabled(page, '.rs-offer button', '招募');
  if (bought) {
    const boughtState = await waitState(page, mainId, (next) => next.revision > beforeShop.revision);
    if (boughtState.gold < beforeShop.gold || boughtState.pieces.length > beforeShop.pieces.length || boughtState.pieces.some((piece) => beforeShop.pieces.find((old) => old.uid === piece.uid)?.star !== piece.star)) shopResult.push('已招募');
  }
  const afterShop = await stateOf(page, mainId);
  const naturalShopEvidence = [`开局金币${beforeShop.gold}`, ...shopResult, `金币${afterShop.gold}`];

  const inventoryBefore = await stateOf(page, mainId);
  const equipTarget = await page.$('select[aria-label="装备给谁"]');
  let equipmentStory = [];
  if (equipTarget && (await equipTarget.$$('option')).length > 1) {
    const target = await equipTarget.$eval('option:nth-child(2)', (option) => option.value);
    await selectOption(equipTarget, target);
    equipmentStory.push('装备');
    const cards = await page.$$('.rs-piece'); let card = null;
    for (const candidate of cards) if (await candidate.$('.rs-equipped')) { card = candidate; break; }
    const unequip = await card?.$('.rs-equipped button');
    if (unequip) { await unequip.click(); equipmentStory.push('卸下'); }
  }
  const itemChecks = await page.$$('.rs-card input[type="checkbox"]');
  if (itemChecks.length >= 2) {
    await itemChecks[0].click(); await itemChecks[1].click();
    const combineButton = await findTextHandle(page, 'button', '合成所选', true);
    if (combineButton && await enabled(combineButton)) { await combineButton.click(); equipmentStory.push('合成'); }
  }
  const recycle = await findTextHandle(page, '.rs-card button', '回收', false);
  if (recycle && await enabled(recycle)) { await recycle.click(); equipmentStory.push('回收'); }
  const inventoryAfter = await stateOf(page, mainId);
  const naturalEquipmentEvidence = `${equipmentStory.join('、') || '当前开局物品不足以完成全部装备操作'}；背包 ${inventoryBefore.inventory.length}→${inventoryAfter.inventory.length}`;

  const summons = (prepState.pieces || []).filter((piece) => piece.row != null && piece.summons?.length);
  const summonSelect = await page.$('.rs-summons select');
  if (summons.length && summonSelect && (await summonSelect.$$('option')).length > 1) {
    await selectOption(summonSelect, await summonSelect.$eval('option:nth-child(2)', (option) => option.value));
    const current = await stateOf(page, mainId);
    const chosen = current.pieces.find((piece) => piece.uid === summons[0].uid)?.summonOrders?.length;
    await selectOption(summonSelect, '');
    const cleared = await stateOf(page, mainId);
    if (chosen && !cleared.pieces.find((piece) => piece.uid === summons[0].uid)?.summonOrders?.length) passed('summon-order-and-clear', '正常流程真实技能召唤物指定合法格后清除订单');
    else unavailable('summon-order-and-clear', '正常流程订单操作未在存档中体现');
  } else unavailable('summon-order-and-clear', '正常开局尚未购买/招募到可指定召唤物，稍后使用隔离的真实战斗fixture');

  const copySelect = await page.$('select[aria-label="选择复制器"]');
  if (copySelect && (await copySelect.$$('option')).length > 1) {
    const uid = await copySelect.$eval('option:nth-child(2)', (option) => option.value);
    await selectOption(copySelect, uid);
    const afterCopy = await stateOf(page, mainId);
    if (afterCopy.consumables.length < initial.consumables.length) passed('copy-selector', `正常流程已选择 ${uid} 并由真实操作消耗复制器`);
    else unavailable('copy-selector', '正常流程选择复制器后未观察到合法目标对应的消耗结果');
  } else unavailable('copy-selector', '正常流程尚未提供复制器，稍后使用隔离fixture');

  const strategyChoices = await page.$$('.rs-choice');
  const choiceDescriptions = await page.$$('.rs-choice p');
  const pairSelect = await page.$('.rs-choice select');
  if (strategyChoices.length && choiceDescriptions.length) {
    const description = await textOf(choiceDescriptions[0]);
    assert(description.trim().length > 0, '策略/补给描述为空');
    if (pairSelect && (await pairSelect.$$('option')).length > 1) {
      await selectOption(pairSelect, await pairSelect.$eval('option:nth-child(2)', (option) => option.value));
      const optionButton = await pairSelect.evaluateHandle((el) => el.closest('.rs-choice__option')?.querySelector('button'));
      if (optionButton) {
        const pairText = await pairSelect.$eval('option:nth-child(2)', (option) => option.innerText);
        const exists = await optionButton.evaluate((el) => !!el).catch(() => false);
        if (exists) { await optionButton.click(); passed('strategy-pair-selection', `选择组合并经页面提交策略：${pairText}`); }
        else unavailable('strategy-pair-selection', '相邻组合可选，但提交按钮不存在');
      } else unavailable('strategy-pair-selection', '相邻组合可选，但没有找到对应的策略提交按钮');
    } else unavailable('strategy-pair-selection', `正常流程未自然给出相邻组合策略，稍后使用隔离fixture。${description.slice(0, 120)}`);
    passed('supply-and-strategy-description', `真实补给文本：${description.slice(0, 180)}`);
  } else unavailable('supply-and-strategy-description', '尚无真实策略/补给选择节点，稍后推进节点并用fixture验证策略描述');
  if (!prepState.nodeStarted || prepState.node?.kind === 'logistics') {
    const supplyButton = await findTextHandle(page, 'button', '领取后勤并继续', false) || await findTextHandle(page, 'button', '领取本节点补给', false);
    if (supplyButton && await enabled(supplyButton)) {
      await supplyButton.click(); passed('supply-and-strategy-description', '通过页面按钮推进真实后勤/补给节点');
    }
  }

  const title = await page.$('.rs-game h1');
  const selectorCanSelect = await title?.evaluate((el) => {
    const range = document.createRange(); range.selectNodeContents(el);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    return selection.toString().trim().length > 0;
  }).catch(() => false);
  if (selectorCanSelect) passed('body-text-selection', '页面正文可使用DOM selection选中');
  else unavailable('body-text-selection', '当前标题节点无法选中');
  // Return to the real session without bypassing the UI, then fight through the game action.
  await page.goto(entryUrl(server, { session: mainId }), { waitUntil: 'domcontentloaded' });
  await waitGame(page);
  const mainBattles = [];
  let firstFight = await performRealFight(page, mainId, { captureName: '03-native-battle.png', pauseControls: true });
  if (firstFight.ran) mainBattles.push(firstFight.battleRound);
  let latest = firstFight.state;
  for (let i = 0; i < 6 && latest.phase !== 'complete'; i++) {
    const next = await performRealFight(page, mainId);
    latest = next.state;
    if (!next.ran) break;
    mainBattles.push(next.battleRound);
    if (latest.gold >= 12) break;
  }
  if (mainBattles.length) {
    const result = await page.$('.rs-result');
    passed('battle-report-pause-speed-settlement', `真实开局战斗 ${mainBattles.length} 场（节点 ${mainBattles.join('、')}）；暂停/2倍速/跳结算已逐项断言；结算=${!!result}；回放关闭后状态revision=${latest.revision}`);
  } else unavailable('battle-report-pause-speed-settlement', `没有真实可战节点（phase=${latest.phase}, deployed=${latest.pieces.filter((piece) => piece.row != null).length}）`);
  if (naturalSupplyClaims.length) passed('natural-flow-supply-claims', `真实开局战斗后通过正式UI领取 ${naturalSupplyClaims.map((entry) => `${entry.round}/${entry.nodeKind}`).join('、')}`);
  else unavailable('natural-flow-supply-claims', `真实战斗后未触达可领取节点；完成战斗数 ${mainBattles.length}`);
  if (REMOTE_MODE) {
    const evidence = `远端真实战斗节点：${mainBattles.join('、') || '无'}；真实后勤领取：${naturalSupplyClaims.map((entry) => entry.round).join('、') || '无'}`;
    remoteStory('production-natural-battles-and-supply', mainBattles.length > 0 && naturalSupplyClaims.length > 0 ? 'passed' : 'unavailable', evidence);
  }
  const latePrep = await advancePrepViaUi(page, mainId);
  const lateShopBefore = latePrep;
  const lateShopActions = [];
  const refreshButton = await findTextHandle(page, '.rs-panel button', '刷新', false);
  if (refreshButton && await enabled(refreshButton) && lateShopBefore.gold >= (lateShopBefore.actionCosts?.refreshGold ?? 2)) {
    await refreshButton.click();
    const refreshed = await waitState(page, mainId, (next) => next.revision > lateShopBefore.revision && next.gold < lateShopBefore.gold);
    if (refreshed.shop.offers.length === 5) lateShopActions.push('刷新');
  }
  const xpBefore = await stateOf(page, mainId);
  const xpBought = await clickEnabled(page, '.rs-panel button', '经验');
  if (xpBought) {
    const xpAfter = await waitState(page, mainId, (next) => next.revision > xpBefore.revision);
    if (xpAfter.gold < xpBefore.gold && (xpAfter.xp > xpBefore.xp || xpAfter.level > xpBefore.level)) lateShopActions.push('经验购买');
  }
  const purchaseBefore = await stateOf(page, mainId);
  if (await clickEnabled(page, '.rs-offer button', '招募')) {
    const purchaseAfter = await waitState(page, mainId, (next) => next.revision > purchaseBefore.revision);
    if (purchaseAfter.gold < purchaseBefore.gold || purchaseAfter.pieces.some((piece) => !purchaseBefore.pieces.some((old) => old.uid === piece.uid)) || purchaseAfter.pieces.some((piece) => purchaseBefore.pieces.find((old) => old.uid === piece.uid)?.star !== piece.star)) lateShopActions.push('招募');
  }
  const lateShopAfter = await stateOf(page, mainId);
  const shopEvidence = [...naturalShopEvidence, ...lateShopActions, `真实战斗${mainBattles.length}场后金币${lateShopBefore.gold}→${lateShopAfter.gold}`];
  if (shopResult.includes('已锁定') && lateShopActions.includes('刷新') && xpBought && lateShopActions.includes('招募')) passed('purchase-refresh-xp-shop-lock', shopEvidence.join('；'));
  else unavailable('purchase-refresh-xp-shop-lock', `${shopEvidence.join('；')}；尚未完成的实际动作：${['已锁定'].filter((x) => !shopResult.includes(x)).concat(['刷新','经验购买','招募'].filter((x) => !lateShopActions.includes(x))).join('、')}`);
  if (REMOTE_MODE) remoteStory('production-shop-actions', results.get('purchase-refresh-xp-shop-lock').status, results.get('purchase-refresh-xp-shop-lock').evidence);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitGame(page);
  const reloaded = await stateOf(page, mainId);
  if (reloaded.revision >= latest.revision && new URL(page.url()).searchParams.get('session') === mainId) passed('session-reload', `重新载入同一局revision=${reloaded.revision}`);
  else unavailable('session-reload', '重载后未恢复原存档定位');
  if (REMOTE_MODE) remoteStory('production-session-reload', results.get('session-reload').status, results.get('session-reload').evidence);

  await collectStoryLinks(page, server);

  await page.setViewport({ width: 1000, height: 560, deviceScaleFactor: 1 });
  await page.evaluate(() => screen.orientation?.lock?.('landscape').catch?.(() => {})).catch(() => {});
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-landscape.png'), fullPage: true, captureBeyondViewport: true });
  screenshots.push({ path: path.join(SCREENSHOT_DIR, '04-landscape.png'), purpose: '横屏整备/战报布局' });
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
  if (layout.scrollWidth <= layout.width + 2) passed('landscape-layout', `横屏 ${layout.width}px 页面宽度 ${layout.scrollWidth}px`);
  else unavailable('landscape-layout', `横屏出现横向溢出 ${layout.scrollWidth}px > ${layout.width}px`);
  if (REMOTE_MODE) remoteStory('production-selection-and-layout', selectorCanSelect && layout.scrollWidth <= layout.width + 2 ? 'passed' : 'unavailable',
    `正文可选中=${selectorCanSelect}；横屏宽度 ${layout.scrollWidth}/${layout.width}`);
  if (naturalSupplyClaims.length) passed('supply-and-strategy-description', `自然经营已通过UI领取节点 ${naturalSupplyClaims.map((entry) => `${entry.round}/${entry.nodeKind}`).join('、')}；策略完整描述另由相邻组合fixture验证`);

  if (REMOTE_MODE) {
    const expectedKinds = [...copiedLinkEvidence.keys()];
    const check = await verifyCopiedLinkKinds(browser, page, server, expectedKinds);
    const missingLinks = expectedKinds.filter((kind) => !check.verified.includes(kind));
    remoteStory('production-deep-links-and-copy', expectedKinds.length > 0 && !missingLinks.length ? 'passed' : 'unavailable',
      `远端页面实际可见链接已分别打开：${check.verified.join('、') || '无'}；缺失：${missingLinks.join('、') || '无'}`);
    if (REMOTE_WORKSHOP_URL) {
      try {
        remoteStory('production-workshop-embedded-fullscreen', 'passed', await verifyRemoteWorkshopEmbed(browser, REMOTE_WORKSHOP_URL));
      } catch (error) {
        remoteStory('production-workshop-embedded-fullscreen', 'unavailable', error.message || error);
      }
    } else remoteStory('production-workshop-embedded-fullscreen', 'unavailable', '未传入 --workshop-url；不会用本地模拟宿主冒充真实Workshop卡验证');
  } else {
    await runStory('fixture-copy-summon-real-battle', () => exerciseFixtureInteractions(browser, fixtureServer, fixtures.interactive));
    await runStory('strategy-pair-selection', () => exercisePairFixture(browser, fixtureServer, fixtures.pairFixture).then((result) => result.page.close()));
    await runStory('fixture-high-end-real-battle', () => exerciseHighendFixture(browser, fixtureServer, fixtures.highend));
    await runStory('terminal-normal-victory-final-panel', () => exerciseTerminalOutcome(browser,fixtureServer,fixtures.endgames.terminal.normal,'terminal-normal-victory-final-panel','victory',{reselect:true}));
    await runStory('terminal-funny-final-panel', () => exerciseTerminalOutcome(browser,fixtureServer,fixtures.endgames.terminal.funny,'terminal-funny-final-panel'));
    await runStory('terminal-hard-final-panel', () => exerciseTerminalOutcome(browser,fixtureServer,fixtures.endgames.terminal.hard,'terminal-hard-final-panel'));
    await runStory('terminal-hp-depleted-final-panel', () => exerciseTerminalOutcome(browser,fixtureServer,fixtures.endgames.hpFailure,'terminal-hp-depleted-final-panel','hp-depleted'));
    await runStory('terminal-round-limit-loss-final-panel', () => exerciseTerminalOutcome(browser,fixtureServer,fixtures.endgames.roundLoss,'terminal-round-limit-loss-final-panel','round-limit-loss'));
    await runStory('abyss-28-29-30-final-panel', () => exerciseAbyssFlow(browser,fixtureServer,fixtures.endgames.abyss));
    await runStory('workshop-iframe-fullscreen-session-fragment', () => verifyIframeFullscreen(browser, fixtureServer, fixtures.pairFixture));

    const linkPage = await openSessionPage(browser, fixtureServer, fixtures.interactive.id);
    try {
      await collectStoryLinks(linkPage, fixtureServer);
      const expectedKinds = ['operator','pact','item','recipe','strategy','environment','member','inventory','equipped','offer','choice','node','battleNode','session'];
      const linkCheck = await verifyCopiedLinkKinds(browser, linkPage, fixtureServer, expectedKinds.filter((kind) => !verifiedLinkKinds.has(kind)));
      for (const kind of linkCheck.verified) verifiedLinkKinds.add(kind);
      const missingLinks = expectedKinds.filter((kind) => !verifiedLinkKinds.has(kind));
      if (!missingLinks.length) passed('deep-links-and-copy', `分别打开并定位全部链接类型：${expectedKinds.join('、')}`);
      else unavailable('deep-links-and-copy', `链接目标实际打开/定位成功：${[...verifiedLinkKinds].join('、') || '无'}；缺失：${missingLinks.join('、')}`);
    } finally { await linkPage.close(); }
  }
}

async function writeReceipt(error = null) {
  clearTimeout(timeoutHandle);
  if (error) errors.push(`${timedOut ? 'timeout' : 'runner'}: ${error.stack || error.message || error}`);
  for (const name of STORIES) if (results.get(name).status === 'unavailable' && results.get(name).evidence === '尚未执行') {
    results.set(name, { status: 'unavailable', evidence: timedOut ? '整体25分钟截止' : '脚本在该故事前异常终止' });
  }
  const judgedStories = REMOTE_MODE ? [...remoteStories.values()] : [...results.values()];
  const receipt = {
    schemaVersion: 1, createdAt: new Date().toISOString(), mode: REMOTE_MODE ? 'remote-production' : 'isolated-local',
    status: error || errors.length || judgedStories.some((entry) => entry.status !== 'passed') ? 'incomplete' : 'passed',
    serverUrl: server?.url || null, entryUrl: server?.entryUrl || null, fixtureServerUrl: fixtureServer?.url || null, timeoutMs: DEADLINE_MS,
    paths: { canonicalRoot: CANONICAL_ROOT, sessionDirectory: REMOTE_MODE ? null : SESSION_DIR, fixtureSessionDirectory: REMOTE_MODE ? null : FIXTURE_SESSION_DIR,
      fixtureIndependentDirectory: REMOTE_MODE ? null : FIXTURE_INDEPENDENT_DIR, fixtureRecordingDirectory: REMOTE_MODE ? null : FIXTURE_RECORDING_DIR, screenshotDirectory: SCREENSHOT_DIR,
      receipt: RECEIPT_PATH, chromeProfile: PROFILE_DIR },
    sessions, fixtureSessions, naturalSupplyClaims, verifiedLinkKinds: [...verifiedLinkKinds], screenshots,
    stories: Object.fromEntries(results), remoteStories: Object.fromEntries(remoteStories),
    missingStories: [...(REMOTE_MODE ? remoteStories : results).entries()].filter(([,value]) => value.status !== 'passed').map(([name,value]) => ({ name, ...value })),
    errors, missingResources,
    notes: ['自然路径使用真实开局、UI动作、服务端session与战斗，直接GET只用于核验权威状态。',
      ...(REMOTE_MODE ? ['远端模式不创建fixture session、不启动本地服务；只执行生产真实开局与页面可达操作。'] : ['fixture路径使用隔离session目录与正式runResonanceBattle；只证明界面和战斗路径，不证明玩家经济可达。',
        'iframe检查使用本地宿主模拟嵌入层，检查全屏新页保留session与hash；不声称接入外部Workshop宿主。']),
      '覆盖全部故事且无页面/API错误才退出0；失败项保留具体执行证据。'],
  };
  await mkdir(VERIFY_ROOT, { recursive: true });
  await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ status: receipt.status, receipt: RECEIPT_PATH, screenshots, missingStories: receipt.missingStories }, null, 2)}\n`);
  return receipt;
}

try {
  const deadline = new Promise((_, reject) => { timeoutHandle = setTimeout(() => {
    timedOut = true;
    void browser?.close().catch(() => {});
    void server?.close().catch(() => {});
    void fixtureServer?.close().catch(() => {});
    reject(new Error('Resonance browser E2E exceeded 25-minute deadline'));
  }, DEADLINE_MS); });
  const execution = run();
  await Promise.race([execution, deadline]);
} catch (error) {
  await writeReceipt(error).catch((receiptError) => { process.stderr.write(`receipt failure ${RECEIPT_PATH}: ${receiptError.message}\n`); });
  process.exitCode = 1;
} finally {
  clearTimeout(timeoutHandle);
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await fixtureServer?.close().catch(() => {});
}
if (process.exitCode !== 1) {
  const receipt = await writeReceipt();
  if (receipt.status !== 'passed') process.exitCode = 1;
}
