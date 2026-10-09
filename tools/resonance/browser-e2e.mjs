#!/usr/bin/env node
// Full UI acceptance runner for Resonance. This file is intentionally only prepared here;
// running it starts Chrome and writes verification sessions, screenshots, and a receipt.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
const fixtureCatalogCache = new Map();
const WSH_CONFIG_PATH = 'C:/Users/lilithgames/AppData/Roaming/wsh/config.json';
const WSH_CLI_PATH = process.env.WSH_CLI_PATH
  || 'E:/WindowsWorkspace/spark.workshop/releases/remote-play-card-20261004/wt/remote-play-card-20261004-5ba073215a31/workshop/cli/dist/wsh.mjs';
const DEADLINE_MS = 25 * 60 * 1000;
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nativeSourceState = () => ({
  revision: execFileSync('git', ['-C', SOURCE_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  trackedStatus: execFileSync('git', ['-C', SOURCE_ROOT, 'status', '--short', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
});
const SOURCE_BEFORE = nativeSourceState();
const urlArg = process.argv.findIndex((arg) => arg === '--url');
const REMOTE_ENTRY_URL = urlArg >= 0 ? process.argv[urlArg + 1] : process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length) || null;
const workshopUrlArg = process.argv.findIndex((arg) => arg === '--workshop-url');
const REMOTE_WORKSHOP_URL = workshopUrlArg >= 0 ? process.argv[workshopUrlArg + 1] : process.argv.find((arg) => arg.startsWith('--workshop-url='))?.slice('--workshop-url='.length) || null;
const embedUrlArg = process.argv.findIndex((arg) => arg === '--embed-url');
const REMOTE_EMBED_URL = embedUrlArg >= 0 ? process.argv[embedUrlArg + 1] : process.argv.find((arg) => arg.startsWith('--embed-url='))?.slice('--embed-url='.length) || null;
const REMOTE_MODE = !!REMOTE_ENTRY_URL;
const resumeSessionArg = process.argv.findIndex((arg) => arg === '--resume-production-session');
const REMOTE_RESUME_SESSION_ID = resumeSessionArg >= 0 ? process.argv[resumeSessionArg + 1] : null;
const productionFollowupArg = process.argv.findIndex((arg) => arg === '--check-production-followups');
const REMOTE_FOLLOWUP_SESSION_ID = productionFollowupArg >= 0 ? process.argv[productionFollowupArg + 1] : null;
const existingVisualReplayArg = process.argv.findIndex((arg) => arg === '--replay-existing-session');
const EXISTING_VISUAL_REPLAY_SESSION_ID = existingVisualReplayArg >= 0 ? process.argv[existingVisualReplayArg + 1] : null;
const existingFollowupArg = process.argv.findIndex((arg) => arg === '--followup-existing-sessions');
const REMOTE_FOLLOWUP_EXISTING_SESSIONS = existingFollowupArg >= 0
  ? (process.argv[existingFollowupArg + 1] || '').split(',').map((id) => id.trim()).filter(Boolean) : [];
const productNativeArg = process.argv.findIndex((arg) => arg === '--product-native');
const REMOTE_PRODUCT_NATIVE_REVISION = productNativeArg >= 0 ? process.argv[productNativeArg + 1] : null;
const auditNativeArg = process.argv.findIndex((arg) => arg === '--audit-native');
const REMOTE_AUDIT_NATIVE_REVISION = auditNativeArg >= 0 ? process.argv[auditNativeArg + 1] : REMOTE_PRODUCT_NATIVE_REVISION;
const REMOTE_ATTEMPT_ID = new Date().toISOString().replace(/[^0-9TZ-]/g, '-');
const REMOTE_PRIOR_ATTEMPTS = (() => {
  if (!REMOTE_MODE) return [];
  try {
    const previous = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
    if (previous.mode !== 'remote-production') return [];
    const history = Array.isArray(previous.priorAttempts) ? previous.priorAttempts : [];
    const { priorAttempts: _priorAttempts, ...previousAttempt } = previous;
    return [...history, previousAttempt];
  } catch {
    return [];
  }
})();
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
// Resolve module-time inputs before importing the server from a sparse checkout.
process.env.SP_DATA_DIR ||= path.join(CANONICAL_ROOT, 'data');
process.env.SP_INDEPENDENT_DESIGN_PATH ||= path.join(CANONICAL_ROOT, 'data/independent-design.json');
process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH ||= path.join(CANONICAL_ROOT, 'data/independent-darkmoon-design-addon.json');
process.env.SP_INDEPENDENT_GAME_TEXT_PATH ||= path.join(CANONICAL_ROOT, 'data/independent-game-text.json');
const [{ startServer }, { loadData }, { getResonanceCatalog, resonanceContent }, { createSession, validateSession },
  { getResonanceField, runResonanceBattle }, { legalSummonCells },
  { ownerRangeKeys }, { ARCHETYPES, SCENARIO_CONFIGS, buildScenario, makePactTerminalRoster }] = await Promise.all([
  import('../../server/index.js'), import('../../server/data.js'), import('../../server/modes/resonance/catalog.js'),
  import('../../server/modes/resonance/session.js'), import('../../server/modes/resonance/battle.js'),
  import('../../server/modes/resonance/summons.js'), import('../../server/match/board.js'), import('./archetype-balance.mjs'),
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
let puppeteer;
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
const pendingResponseDiagnostics = new Set();
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
  page.on('requestfailed', (request) => {
    if (!REMOTE_MODE) return;
    const url = request.url();
    const scoped = REMOTE_WORKSHOP_URL && isScopedWorkshopBearerUrl(url, REMOTE_WORKSHOP_URL);
    const sameOrigin = (() => { try { return new URL(url).origin === new URL(page.url() || 'http://127.0.0.1').origin; } catch { return false; } })();
    if (scoped || sameOrigin) errors.push(`${label} requestfailed ${url}: ${request.failure()?.errorText || 'unknown network failure'}`);
  });
  page.on('response', (response) => {
    const status = response.status();
    const url = new URL(response.url());
    const sameOrigin = url.origin === new URL(page.url() || 'http://127.0.0.1').origin;
    if (url.pathname.endsWith('/favicon.ico')) return;
    if (REMOTE_MODE) {
      const workshopScoped = REMOTE_WORKSHOP_URL && isScopedWorkshopBearerUrl(response.url(), REMOTE_WORKSHOP_URL);
      if (status >= 400 && (sameOrigin || workshopScoped)) {
        const task = response.text().catch(() => '').then((body) => {
          errors.push(`${workshopScoped ? 'Workshop scoped' : 'same-origin'} HTTP ${status} ${response.url()}${body ? ` response=${body.slice(0, 5000)}` : ''}`);
        });
        pendingResponseDiagnostics.add(task);
        void task.finally(() => pendingResponseDiagnostics.delete(task));
        return;
      }
      if (status < 400) return;
      const type = response.request().resourceType();
      if (['image','font','media'].includes(type)) missingResources.push({ status, url: response.url(), resourceType: type });
      else if (sameOrigin) {
        const task = response.text().catch(() => '').then((body) => {
          errors.push(`same-origin business HTTP ${status} ${response.url()}${body ? ` response=${body.slice(0, 3000)}` : ''}`);
        });
        pendingResponseDiagnostics.add(task);
        void task.finally(() => pendingResponseDiagnostics.delete(task));
      }
    } else if (sameOrigin && status >= 400) errors.push(`HTTP ${status} ${response.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location()?.url || '';
    if (/\/favicon\.ico(?:[?#]|$)/.test(location)) return;
    errors.push(`${label} console: ${message.text()}${location ? ` (${location})` : ''}`);
  });
}
const copiesForStar = (star) => ({ 1: 1, 2: 3, 3: 9 })[star];
function fixtureCatalogFor(data,environmentId,seed){
  const key=`${environmentId}:${seed}`;
  if(!fixtureCatalogCache.has(key))fixtureCatalogCache.set(key,getResonanceCatalog(data,{environmentId,seed}));
  return fixtureCatalogCache.get(key);
}
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
    if (!catalog.operators[operatorId]?.stars?.[star]?.record) throw new Error(`fixture selected star record missing: ${operatorId}/${star}`);
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
      const selectedToken=field.resolveToken?.(spec.summonTokenId,operator.id,operator.fixedSkillIndex);
      if(!selectedToken?.placeable)throw new Error(`fixture selected native skill token is not placeable: ${label}/${operator.id}/${spec.star}/${spec.summonTokenId}`);
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
    if(spec.summonTokenId&&!legalSummonCells(field,state,piece,operator,spec.summonTokenId).length)throw new Error(`fixture selected native skill token has no legal summon location: ${label}/${operator.id}/${spec.summonTokenId}`);
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
  const reconstructedCatalog=fixtureCatalogFor(data,state.environmentId,state.seed);
  if(JSON.stringify(reconstructedCatalog.config.activeOperatorIds)!==JSON.stringify(catalog.config.activeOperatorIds))throw new Error(`fixture catalog seed mismatch: ${label}/${state.environmentId}/${state.seed}`);
  const validation = validateSession(state, { catalog: reconstructedCatalog });
  if (!validation.ok) throw new Error(`fixture state validation failed (${label}): ${JSON.stringify(validation.errors)}`);
  const uniqueIds=[...state.pieces.map(piece=>piece.uid),...state.pieces.flatMap(piece=>piece.equipment.map(item=>item.uid)),...state.inventory.map(item=>item.uid),...state.consumables.map(item=>item.uid)];
  if(new Set(uniqueIds).size!==uniqueIds.length)throw new Error(`fixture duplicate uid: ${label}`);
  if(state.pieces.length>state.level||state.pieces.filter(piece=>piece.row!=null).length>state.level)throw new Error(`fixture capacity invalid: ${label}`);
  const tileKeys=state.pieces.filter(piece=>piece.row!=null).map(piece=>`${piece.row},${piece.col}`);if(new Set(tileKeys).size!==tileKeys.length)throw new Error(`fixture duplicate deployment tile: ${label}`);
  for(const piece of state.pieces){
    if(!catalog.config.activeOperatorIds.includes(piece.operatorId))throw new Error(`fixture operator outside active pool: ${label}/${piece.operatorId}`);
    if(!catalog.operators[piece.operatorId]?.stars?.[piece.star]?.record)throw new Error(`fixture selected star record missing: ${label}/${piece.operatorId}/${piece.star}`);
  }
  const id = randomUUID();
  if (!dryRun) {
    await writeFile(path.join(FIXTURE_SESSION_DIR, `${id}.json`), `${JSON.stringify(state)}\n`, { flag: 'wx' });
    fixtureSessions.push({ id, label, difficulty, round, hp, seed: fixtureSeed, environmentId: catalog.config.environmentId, stars: specs.map((spec) => `${spec.operatorId}:${spec.star}`), strategyId, recipeResult,
      summonOwnerId: specs.find((spec) => spec.summonTokenId)?.operatorId || null, summonTokenId: specs.find((spec) => spec.summonTokenId)?.summonTokenId || null,
      source: 'canonical createSession + validated isolated fixture state; browser actions still use real HTTP and runResonanceBattle' });
  }
  return { id, state, catalog: reconstructedCatalog, seed: fixtureSeed, strategyId };
}
function resolveFixtureSummonToken(field,catalog,operator,star=1){
  const record=operator?.stars?.[star]?.record;if(!record)return null;
  for(const tokenId of tokenIdsFor(operator,star)){
    const resolved=field.resolveToken?.(tokenId,operator.id,operator.fixedSkillIndex);
    if(resolved?.placeable)return {tokenId,resolved};
  }
  return null;
}
function fixtureHasLegalSummonPosition(field,state,operator,tokenId){
  const piece={uid:'fixture-summon-probe',operatorId:operator.id,star:1,equipment:[],growth:{},row:null,col:null,dir:'RIGHT',summonOrders:[]};
  for(const key of legalTileKeys(field,operator)){
    const [row,col]=key.split(',').map(Number);piece.row=row;piece.col=col;
    if(legalSummonCells(field,{...state,pieces:[piece]},piece,operator,tokenId).length)return true;
  }
  return false;
}
async function prepareFixtures(data,{dryRun=false}={}) {
  const envIds = Object.keys(resonanceContent.environments);
  const fieldCache=new Map();
  const catalogFor = (id,seed=1) => fixtureCatalogFor(data,id,seed);
  const fieldFor=(id,seed,catalog)=>{const key=`${id}:${seed}`;if(!fieldCache.has(key)){const created=createSession({seed,difficulty:'NORMAL',environmentId:id,catalog});assert(created.ok,`fixture session seed failed: ${key}/${created.error}`);fieldCache.set(key,getResonanceField(created.state,{data,catalog}));}return fieldCache.get(key);};
  const environmentOrder=['origin_laterano','origin_aegir','origin_sami','origin_kjerag',...envIds].filter((id,index,all)=>envIds.includes(id)&&all.indexOf(id)===index);
  let selected=null;
  for(const environmentId of environmentOrder){
    for(let seed=1;seed<=64;seed++){
      const catalog=catalogFor(environmentId,seed),field=fieldFor(environmentId,seed,catalog),state=createSession({seed,difficulty:'NORMAL',environmentId,catalog}).state;
      const strategyId=Object.entries(catalog.strategies).find(([,entry])=>entry.condition?.kind==='choose_adjacent_pair')?.[0];
      const pair=fixtureOpPair(catalog,field);if(!pair||!strategyId)continue;
      let summon=null;
      for(const operatorId of catalog.config.activeOperatorIds){
        const operator=catalog.operators[operatorId],choice=resolveFixtureSummonToken(field,catalog,operator,1);
        if(choice&&fixtureHasLegalSummonPosition(field,state,operator,choice.tokenId)){summon={operatorId,tokenId:choice.tokenId};break;}
      }
      if(!summon)continue;
      const secondaryId=catalog.config.activeOperatorIds.find(id=>id!==summon.operatorId&&catalog.operators[id].charId!==catalog.operators[summon.operatorId].charId);
      if(!secondaryId)continue;
      selected={environmentId,seed,catalog,field,strategyId,pair,summon,secondaryId};break;
    }
    if(selected)break;
  }
  if(!selected)throw new Error('no deterministic environment/seed 1..64 has both a real adjacent-pair choice and a legal selected-star manual-summon owner in its active pool');
  const {environmentId:commonEnvironment,seed:commonSeed, catalog:common,field:commonField,strategyId,pair,summon,secondaryId}=selected;
  const summonId=summon.operatorId,summonTokenId=summon.tokenId;
  const summonSpecs = [{ operatorId: summonId, star: 1, summonTokenId }, { operatorId: secondaryId, star: 1 }];
  const interactive = await writeFixtureSession({ data, catalog: common, specs: summonSpecs, label: 'copy/equipment/summon',seed:commonSeed,dryRun,requireAllDeployed:true });
  const pairFixture = await writeFixtureSession({ data, catalog: common, specs: pair, strategyId, label: 'adjacent-pair-strategy',seed:commonSeed,dryRun,requireAllDeployed:true });

  const highEnvironment = ['origin_sami', 'origin_kjerag'].find((id) => envIds.includes(id)) || common.config.environmentId;
  let highCatalog=null,highSeed=1;
  for(;highSeed<=64;highSeed++){highCatalog=catalogFor(highEnvironment,highSeed);if(highCatalog.config.activeOperatorIds.some(id=>(highCatalog.operators[id].pacts??[]).some(pact=>['sami','kjerag'].includes(pact))&&highCatalog.operators[id].stars?.[3]?.record))break;}
  if(highSeed>64)throw new Error('no Sami/Kjerag 3-star snow operator found in fixed high-end fixture search');
  const highIds = highCatalog.config.activeOperatorIds.filter((id) => highCatalog.operators[id].stars?.[3]?.record);
  const snowIds = highIds.filter((id) => (highCatalog.operators[id].pacts || []).some((pact) => ['sami', 'kjerag'].includes(pact)));
  const chosen = [...snowIds.slice(0, 3)];
  for (const id of highIds) if (chosen.length < 4 && !chosen.includes(id)) chosen.push(id);
  if (chosen.length < 3) throw new Error(`only ${chosen.length} real active three-star operators available for high-end fixture`);
  const highend = await writeFixtureSession({ data, catalog: highCatalog, specs: chosen.slice(0, 4).map((operatorId) => ({ operatorId, star: 3 })), label: 'three-star-snow-environment',seed:highSeed,dryRun,requireAllDeployed:true });
  const endgames = await prepareEndgameFixtures(data, catalogFor('origin_laterano',1),{dryRun});
  const summarize=(fixture)=>({environmentId:fixture.catalog.config.environmentId,seed:fixture.state.seed,pieces:fixture.state.pieces.map(piece=>({operatorId:piece.operatorId,star:piece.star,recordAvailable:Boolean(fixture.catalog.operators[piece.operatorId]?.stars?.[piece.star]?.record),position:[piece.row,piece.col],equipment:piece.equipment.map(item=>item.itemId)})),summonOwnerId:fixture.state.pieces.find(piece=>piece.operatorId===summonId&&piece.star===1)?summonId:null,summonTokenId:fixture.state.pieces.some(piece=>piece.operatorId===summonId)?summonTokenId:null,sessionWritten:!dryRun});
  return { interactive, pairFixture, highend, endgames, runner: runResonanceBattle.name,fixtureValidation:{dryRun,common:{environmentId:commonEnvironment,seed:commonSeed,strategyId,summonOwnerId:summonId,summonTokenId,tokenResolution:commonField.resolveToken(summonTokenId,summonId,common.operators[summonId].fixedSkillIndex)},fixtures:[summarize(interactive),summarize(pairFixture),summarize(highend),...Object.values(endgames.terminal).map(summarize),summarize(endgames.hpFailure),summarize(endgames.roundLoss),summarize(endgames.abyss)],fixtureSessionsWritten:dryRun?0:fixtureSessions.length}};
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
async function findBattleOutcomeFixture({data,catalog,catalogForSeed=null,label,difficulty,round,level,hp,specsForSeed,accept,maxAttempts=48,dryRun=false}){
  for(let seed=0x6e000;seed<0x6e000+maxAttempts;seed++){
    const seededCatalog=catalogForSeed?catalogForSeed(seed):catalog;
    const specs=specsForSeed(seed,seededCatalog),fixture=await writeFixtureSession({data,catalog:seededCatalog,label,difficulty,round,level,hp,seed,specs,dryRun:true,requireAllDeployed:true});
    const outcome=battleProbe(fixture.state,data,seededCatalog,label);
    if(!accept(outcome))continue;
    const saved=await writeFixtureSession({data,catalog:seededCatalog,label,difficulty,round,level,hp,seed,specs,requireAllDeployed:true,dryRun});
    return { ...saved, expected:{won:outcome.won,hpLoss:outcome.hpLoss,time:outcome.result?.time??null,bossHpLeft:outcome.result?.bossHpLeft??null},source:'validated fixture state + real recording:false Battle preflight; the UI later repeats the authoritative fight' };
  }
  throw new Error(`no deterministic real Battle outcome found for ${label} after ${maxAttempts} fixed seeds`);
}
async function prepareEndgameFixtures(data,catalog,{dryRun=false}={}){
  const environmentId=catalog.config.environmentId,catalogForSeed=(seed)=>fixtureCatalogFor(data,environmentId,seed),compositions=new Map();
  const specsFor=(difficulty,round)=>(seed,seededCatalog)=>{const composition=makePactTerminalRoster(seededCatalog,10,3,{coreMode:'preferred'});compositions.set(`${difficulty}:${seed}`,composition);if(!composition.constructible)throw new Error(`endgame fixture cannot reach its configured main pact: ${difficulty}/${seed}/${composition.mainPact}`);return matureFixtureSpecs({data,catalog:seededCatalog,difficulty,round,seed,composition});};
  const terminal={};
  for(const difficulty of ['NORMAL','FUNNY','HARD']){
    const fixture=await findBattleOutcomeFixture({data,catalog,catalogForSeed,label:`terminal-${difficulty.toLowerCase()}`,difficulty,round:28,level:10,hp:100,
      specsForSeed:specsFor(difficulty,28),accept:(outcome)=>difficulty==='NORMAL'?outcome.won&&Math.floor(outcome.hpLoss)<100:true,maxAttempts:64,dryRun});
    terminal[difficulty.toLowerCase()]={...fixture,composition:compositions.get(`${difficulty}:${fixture.seed}`)};
  }
  const weakSpecs=(_seed,seededCatalog)=>{const weak=firstOperator(seededCatalog,(operator)=>operator.cost<=2&&operator.role!=='summoner'&&operator.stars?.[1]?.record);if(!weak)throw new Error('no active low-cost operator is available for terminal failure fixtures');return [{operatorId:weak,star:1}];};
  const hpFailure=await findBattleOutcomeFixture({data,catalog,catalogForSeed,label:'terminal-hp-depleted',difficulty:'NORMAL',round:12,level:3,hp:1,specsForSeed:weakSpecs,
    accept:(outcome)=>!outcome.won&&Math.floor(outcome.hpLoss)>=1,maxAttempts:96,dryRun});
  const roundLoss=await findBattleOutcomeFixture({data,catalog,catalogForSeed,label:'terminal-round-limit-loss',difficulty:'NORMAL',round:28,level:3,hp:100,specsForSeed:weakSpecs,
    accept:(outcome)=>!outcome.won&&Math.floor(outcome.hpLoss)<100,maxAttempts:96,dryRun});
  let abyss=null;
  for(let seed=0x6f000;seed<0x6f030;seed++){
    const seededCatalog=catalogForSeed(seed),composition=makePactTerminalRoster(seededCatalog,10,3,{coreMode:'preferred'});if(!composition.constructible)continue;
    const specs=matureFixtureSpecs({data,catalog:seededCatalog,difficulty:'ABYSS',round:28,seed,composition});
    const fixture=await writeFixtureSession({data,catalog:seededCatalog,label:'abyss-28-to-30',difficulty:'ABYSS',round:28,level:10,hp:100,seed,specs,dryRun:true,requireAllDeployed:true});
    const early=battleProbe(fixture.state,data,seededCatalog,'abyss-round-28');
    if(!early.won||Math.floor(early.hpLoss)>=100)continue;
    fixture.state.round=29;
    const middle=battleProbe(fixture.state,data,seededCatalog,'abyss-round-29');
    if(!middle.won||Math.floor(early.hpLoss)+Math.floor(middle.hpLoss)>=100)continue;
    fixture.state.round=30;
    const hidden=battleProbe(fixture.state,data,seededCatalog,'abyss-round-30-hidden');
    const saved=await writeFixtureSession({data,catalog:seededCatalog,label:'abyss-28-to-30',difficulty:'ABYSS',round:28,level:10,hp:100,seed,specs,requireAllDeployed:true,dryRun});
    abyss={...saved,composition,expectedRounds:[{round:28,won:early.won},{round:29,won:middle.won},{round:30,won:hidden.won,bossHpLeft:hidden.result?.bossHpLeft??null}],source:'three isolated stage probes use real hidden/elite/leader Battles; the browser session advances through official actions'};
    break;
  }
  if(!abyss)throw new Error('no deterministic ABYSS seed wins real rounds 28 and 29 and reaches a diagnostic-free hidden round 30');
  const composition=terminal.normal.composition;
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
async function visibleInViewport(handle) {
  return !!handle && handle.evaluate((el) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0) || s.display === 'none' || s.visibility === 'hidden') return false;
    const x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2));
    const top = document.elementFromPoint(x, y);
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && (top === el || el.contains(top));
  }).catch(() => false);
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
async function waitGame(page, timeout = 60_000) {
  await page.waitForFunction(() => document.querySelector('.rs-game')
    || [...document.querySelectorAll('main.rs-start .panel__title')].some((title) => title.textContent.trim() === '暂时无法进入共鸣'), { timeout });
  if (await page.$('.rs-game')) return;
  const message = (await page.$eval('main.rs-start .panel__title', (title) => title.closest('.panel')?.innerText?.trim() || title.textContent.trim()).catch(() => '开局错误面板未提供错误文本'));
  await capture(page, '02-production-start-failure.png', '生产开局失败现场');
  throw new Error(`开局没有创建对局：${message}`);
}
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
  await page.evaluate(() => window.getSelection?.()?.removeAllRanges?.());
  const file = path.join(SCREENSHOT_DIR, REMOTE_MODE ? `${REMOTE_ATTEMPT_ID}-${name}` : name);
  await page.screenshot({ path: file, fullPage: true, captureBeyondViewport: true });
  screenshots.push({ path: file, purpose });
}
async function leaveToOpening(page) {
  await clickButton(page, '返回开局');
  await page.waitForSelector('.rs-start__setup', { timeout: 30_000 });
}
async function clickEnabled(page, selector, label) {
  const deadline = Date.now() + 5_000;
  let lastClickError = null;
  while (Date.now() < deadline) {
    let matched = false;
    for (const el of await page.$$(selector)) {
      if (label && !(await textOf(el)).includes(label)) continue;
      matched = true;
      if (!await visible(el)) continue;
      await el.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })).catch(() => {});
      if (!await visibleInViewport(el) || !await enabled(el)) continue;
      try { await el.click({ timeout: 1_000 }); return true; }
      catch (error) {
        lastClickError = error;
        if (!/not clickable|notclickable|detached|not attached|Node is detached/i.test(error.message || '')) throw error;
      }
    }
    if (!matched && lastClickError) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (lastClickError) throw new Error(`could not click current visible control ${selector} (${label || 'any'}): ${lastClickError.message}`);
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
  const network = [];
  page.on('response', (response) => {
    const url = response.url();
    if (/\/resonance\/(api\/|data\/|js\/)|\.js(?:\?|$)/.test(url)) network.push({ status: response.status(), url,
      resourceType: response.request().resourceType() });
  });
  page.on('requestfailed', (request) => network.push({ failed: request.failure()?.errorText || 'request failed', url: request.url(),
    resourceType: request.resourceType() }));
  await page.browserContext().overridePermissions(serverInstance.url, ['clipboard-read', 'clipboard-write']);
  const params = { session: id }; if (fallback) params.render = 'fallback';
  const targetUrl = entryUrl(serverInstance, params);
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitGame(page);
    return page;
  } catch (error) {
    const diagnostic = await page.evaluate(async (sessionId) => {
      let sessionApi = null;
      try {
        const response = await fetch(new URL(`resonance/api/sessions/${encodeURIComponent(sessionId)}?catalog=0`, location.href));
        const body = await response.json();
        sessionApi = { status: response.status, ok: body?.ok, state: body?.state ? { phase: body.state.phase,
          round: body.state.round, revision: body.state.revision } : null, error: body?.error || null };
      } catch (error) { sessionApi = { error: error.message }; }
      return { url: location.href, title: document.title, sessionApi,
      body: (document.body?.innerText || '').slice(0, 1600), rootClasses: document.querySelector('main')?.className || null,
      game: Boolean(document.querySelector('.rs-game')), setup: Boolean(document.querySelector('.rs-start__setup')) };
    }, id).catch(() => ({ url: page.url() }));
    await page.close().catch(() => {});
    throw new Error(`session page failed to become ready: ${error.message}; target=${targetUrl}; diagnostic=${JSON.stringify(diagnostic)}; network=${JSON.stringify(network.slice(-30))}; recentPageErrors=${JSON.stringify(errors.slice(-8))}`);
  }
}
async function exerciseFixtureInteractions(browserInstance, fixtureServerInstance, fixture) {
  const page = await openSessionPage(browserInstance, fixtureServerInstance, fixture.id);
  try {
    let state = await stateOf(page, fixture.id);
    // This fixture may already have been exercised by earlier preserved attempts.
    // Begin from its actual authoritative state: use official unequip controls to
    // bring its existing components back to inventory instead of assuming a fresh bag.
    for (const piece of state.pieces) {
      for (const equipped of [...(piece.equipment || [])]) {
        const card = await page.$(`#member-${piece.uid} .rs-equipped`);
        let unequip = null;
        for (const button of await (card?.$$('button') || [])) {
          if ((await textOf(button)).includes('卸下')) { unequip = button; break; }
        }
        if (!unequip) throw new Error(`equipped component ${equipped.uid} has no official unequip button`);
        await unequip.click();
        state = await waitState(page, fixture.id, (next) => next.inventory.some((entry) => entry.uid === equipped.uid));
        if (state.pieces.some((owner) => owner.equipment?.some((entry) => entry.uid === equipped.uid))) {
          throw new Error(`official unequip duplicated component ${equipped.uid}`);
        }
      }
    }
    state = await stateOf(page, fixture.id);
    const recipe = fixture.catalog.recipes.find((entry) => entry.resultId === fixture.recipeResult);
    const target = state.pieces.find((piece) => piece.uid !== state.pieces[0]?.uid) || state.pieces[0];
    const materialIds = recipe?.parts || [];
    const usedMaterials = new Set();
    const materialUids = materialIds.map((itemId) => {
      const found = state.inventory.find((entry) => entry.itemId === itemId && !usedMaterials.has(entry.uid));
      if (found) usedMaterials.add(found.uid);
      return found?.uid;
    });
    if (!recipe || !target || state.inventory.length < materialIds.length || materialUids.some((uid) => !uid)) {
      throw new Error(`fixture lacks live canonical recipe materials after official unequip: ${JSON.stringify({
        recipe: recipe?.id, materialIds, inventory: state.inventory.map((entry) => ({ uid: entry.uid, itemId: entry.itemId }))
      })}`);
    }
    const equippedUid = state.inventory.find((entry) => entry.itemId === materialIds[0])?.uid;
    const equip = await page.$(`#inventory-${equippedUid} select[aria-label="装备给谁"]`);
    if (!equip) throw new Error('fixture did not expose canonical equipment owner selector');
    await selectOption(equip, target.uid);
    state = await waitState(page, fixture.id, (next) => next.pieces.find((piece) => piece.uid === target.uid)?.equipment.length === 1);
    const unequip = await page.$(`#member-${target.uid} .rs-equipped button`);
    if (!unequip) throw new Error('fixture equipment did not appear on the operator card');
    await unequip.click();
    state = await waitState(page, fixture.id, (next) => next.pieces.find((piece) => piece.uid === target.uid)?.equipment.length === 0
      && next.inventory.some((entry) => entry.uid === equippedUid));

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
    passed('equip-unequip-combine-recycle', `隔离fixture通过正式UI卸下既有装备后转装，再合成${recipe.resultName}并回收；不证明这些材料在玩家经济中可达`);

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
    if (!summon) throw new Error(`fixture ${fixture.summonTokenId} has no visible owner summon selector for ${owner?.uid || 'missing owner'}`);
    await page.waitForFunction((ownerUid) => {
      const select = document.querySelector(`#member-${CSS.escape(ownerUid)} .rs-summons select`);
      return !!select && [...select.options].some((option) => option.value);
    }, { timeout: 15_000 }, owner.uid).catch(async (error) => {
      const actual = await page.evaluate((ownerUid) => {
        const select = document.querySelector(`#member-${CSS.escape(ownerUid)} .rs-summons select`);
        return { ownerPresent: !!document.querySelector(`#member-${CSS.escape(ownerUid)}`), selectPresent: !!select,
          disabled: select?.disabled, options: [...(select?.options || [])].map((option) => ({ value: option.value, text: option.innerText })) };
      }, owner.uid);
      throw new Error(`fixture ${fixture.summonTokenId} has no legal player-visible summon cell after UI settled: ${JSON.stringify(actual)}; ${error.message}`);
    });
    const readySummon = await page.$(`#member-${owner.uid} .rs-summons select`);
    if (!readySummon || (await readySummon.$$('option')).length < 2) throw new Error(`fixture ${fixture.summonTokenId} summon selector has no legal target options`);
    await selectOption(readySummon, await readySummon.$eval('option:nth-child(2)', (option) => option.value));
    state = await waitState(page, fixture.id, (next) => next.pieces.find((piece) => piece.uid === owner.uid)?.summonOrders?.length > 0);
    await selectOption(await page.$(`#member-${owner.uid} .rs-summons select`), '');
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
    if (choiceLink.missing.length) throw new Error('当前fixture没有可定位的策略选择项');
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
async function copyLiveLinkForKind(page, serverInstance, kind, onProgress = () => {}) {
  const bounded = (promise, ms, label) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })])
      .finally(() => clearTimeout(timer));
  };
  const sessionId = new URL(page.url()).searchParams.get('session');
  if (!sessionId) return null;
  if (kind === 'operator') {
    onProgress({ stage: 'expand-roster' });
    const rosterButton = await findTextHandle(page, '.rs-game button', '展开全部干员', true);
    if (rosterButton) await rosterButton.click().catch(() => {});
  }
  if (new Set(['recipe','strategy','environment','node']).has(kind)) {
    onProgress({ stage: 'expand-catalog' });
    for (const summary of await page.$$('details > summary')) {
      const text = (await textOf(summary)).trim();
      if (text.includes('图鉴与经营规则') || text.includes('合成配方')) await summary.click().catch(() => {});
    }
  }
  const selectors = {
    operator: '.rs-card--operator .rs-copy', pact: '.rs-pact .rs-copy',
    item: '#rs-section-equipment .rs-card .rs-copy', recipe: '#rs-section-recipe-catalog .rs-card .rs-copy, #rs-section-equipment details .rs-copy',
    strategy: '#rs-section-strategy-catalog .rs-card .rs-copy, [id^="choice-"] .rs-choice__option .rs-copy', environment: '#rs-section-environment-catalog .rs-card .rs-copy',
    member: '#rs-section-field .rs-piece .rs-copy', inventory: '#rs-section-equipment [id^="inventory-"] .rs-copy',
    equipped: '#rs-section-equipment [id^="equipped-"] .rs-copy', offer: '#rs-section-shop .rs-offer .rs-copy',
    choice: '[id^="choice-"] .rs-copy', node: '#rs-section-economy-rules .rs-node .rs-copy',
    battleNode: '.rs-next .rs-copy',
  };
  if (kind === 'session') {
    onProgress({ stage: 'find-session-copy' });
    const button = await findTextHandle(page, '.rs-resources button', '复制本局链接', true);
    if (!button) return null;
    await button.click();
    const raw = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    try { const url = new URL(raw); return url.origin === new URL(serverInstance.url).origin && url.searchParams.get('session') === sessionId
      ? { url: url.href, targetId: sessionId } : null; } catch { return null; }
  }
  const selector = selectors[kind];
  if (!selector) return null;
  if (new Set(['operator','pact','item','recipe','strategy','environment','member','inventory','equipped','offer','choice','node','battleNode']).has(kind)) {
    onProgress({ stage: 'wait-for-copy-target', selector });
    await page.waitForSelector(selector, { timeout: 4_000 }).catch(() => {});
  }
  onProgress({ stage: 'enumerate-copy-targets', selector });
  const buttons = await bounded(page.$$(selector), 2_000, `query ${kind} copy controls`);
  onProgress({ stage: 'candidate-count', selector, count: buttons.length });
  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index];
    onProgress({ stage: 'candidate-visible', selector, index });
    if (!await bounded(visible(button), 1_500, `visibility ${kind} copy control ${index}`).catch(() => false)) continue;
    onProgress({ stage: 'candidate-click', selector, index });
    const previousClipboard = await bounded(page.evaluate(() => navigator.clipboard.readText()), 1_000, `read prior ${kind} clipboard`).catch(() => '');
    await bounded(button.click({ timeout: 1_500 }), 2_000, `click ${kind} copy control ${index}`).catch(() => {});
    onProgress({ stage: 'wait-for-copied-link', selector, index });
    await page.waitForFunction(async ({ expectedKind, expectedSession, previous }) => {
      try {
        const value = await navigator.clipboard.readText();
        const url = new URL(value), rawHash = decodeURIComponent(url.hash.slice(1));
        return value !== previous && url.searchParams.get('session') === expectedSession && rawHash.startsWith(`${expectedKind}-`);
      } catch { return false; }
    }, { timeout: 2_500 }, { expectedKind: kind, expectedSession: sessionId, previous: previousClipboard }).catch(() => {});
    onProgress({ stage: 'read-clipboard', selector, index });
    const raw = await bounded(page.evaluate(() => navigator.clipboard.readText()), 2_000, `read ${kind} clipboard`).catch(() => '');
    let url, parsed;
    try { url = new URL(raw); parsed = detailHashParts(url); } catch { continue; }
    if (url.origin !== new URL(serverInstance.url).origin || parsed.kind !== kind || url.searchParams.get('session') !== sessionId) continue;
    const targetId = kind === 'member' ? `member-${encodeURIComponent(parsed.id)}`
      : kind === 'battleNode' ? `battle-node-${parsed.id}` : `${kind}-${parsed.id}`;
    onProgress({ stage: 'verify-live-target', targetId });
    if (!await bounded(page.evaluate((id) => !!document.getElementById(id), targetId), 1_500, `verify live ${kind} target`).catch(() => false)) continue;
    return { url: url.href, targetId };
  }
  return null;
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
async function verifyCopiedLinkKinds(browserInstance, page, serverInstance, expectedKinds = [], onProgress = () => {}) {
  for (const summary of await page.$$('details > summary')) await summary.click().catch(() => {});
  const links = new Map(copiedLinkEvidence);
  for (const [kind, url] of await collectCopiedLinks(page, serverInstance)) if (url) links.set(kind, { url, server: serverInstance });
  const liveLinkKinds = new Set(['inventory', 'equipped', 'choice']);
  for (const kind of expectedKinds.filter((candidate) => liveLinkKinds.has(candidate))) {
    const selector = kind === 'choice' ? '[id^="choice-"]' : `#rs-section-equipment [id^="${kind}-"]`;
    const targets = await page.$$(selector);
    let fresh = null;
    for (const targetElement of targets) {
      if (!await visible(targetElement)) continue;
      const targetId = await targetElement.evaluate((el) => el.id);
      const copy = await targetElement.$('.rs-copy');
      if (!copy) continue;
      await copy.click();
      const raw = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      try {
        const url = new URL(raw), parsed = detailHashParts(url);
        const expectedTargetId = `${kind}-${parsed.id}`;
        const currentTargetExists = await page.evaluate((id) => Boolean(document.getElementById(id)), expectedTargetId);
        const currentSessionId = new URL(page.url()).searchParams.get('session');
        if (url.origin === new URL(serverInstance.url).origin && parsed.kind === kind && targetId === expectedTargetId
          && currentTargetExists && currentSessionId && url.searchParams.get('session') === currentSessionId) {
          fresh = { url: url.href, server: serverInstance };
          break;
        }
      } catch { /* a non-link clipboard result cannot be evidence for this target */ }
    }
    if (fresh) links.set(kind, fresh);
    else links.delete(kind);
  }
  const verified = [];
  const detailKinds = new Set(['operator','pact','item','recipe','strategy','environment']);
  const kindsToCheck = expectedKinds.length ? expectedKinds : [...links.keys()];
  for (const kind of kindsToCheck) {
    onProgress({ stage: 'open-link', kind, verified: [...verified] });
    const entry = links.get(kind);
    if (!entry) continue;
    const url = typeof entry === 'string' ? entry : entry.url;
    const originServer = typeof entry === 'string' ? serverInstance : entry.server;
    if (new URL(url).origin !== new URL(originServer.url).origin) throw new Error(`copied ${kind} link has wrong source origin`);
    const target = new URL(url);
    const parsed = detailHashParts(target);
    if (parsed.kind !== kind) throw new Error(`copied ${kind} link parsed as ${parsed.kind}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 }); await waitGame(page, 20_000);
    if (detailKinds.has(kind)) await page.waitForSelector('.rs-detail', { timeout: 10_000 });
    else if (kind === 'member') await page.waitForFunction((id) => !!document.getElementById(`member-${encodeURIComponent(id)}`)?.matches(':focus'), { timeout: 10_000 }, parsed.id);
    else if (kind === 'session') {
      assert(target.searchParams.get('session') === parsed.id, '复制的本局链接hash与session参数不一致');
      await stateOf(page, parsed.id);
    }
    else {
      const prefix = { inventory:'inventory', equipped:'equipped', offer:'offer', choice:'choice', node:'node', battleNode:'battle-node' }[kind];
      if (prefix) await page.waitForSelector(`[id="${prefix}-${parsed.id.replaceAll('"', '\\"')}"]`, { timeout: 10_000 });
      else continue;
    }
    verified.push(kind);
    onProgress({ stage: 'link-verified', kind, verified: [...verified] });
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
      await wrapper.setViewport({ width: 1120, height: 800 });
      await wrapper.setContent(`<iframe id="workshop-embed" title="共鸣嵌入画布" style="width:1120px;height:800px;border:0" src="${detailUrl.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe>`);
      const frameDeadline = Date.now() + 30_000;
      let frame = null;
      while (!frame && Date.now() < frameDeadline) {
        frame = wrapper.frames().find((candidate) => candidate.url() === detailUrl) || null;
        if (!frame) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!frame) throw new Error('embedded session/detail page did not load in iframe');
      await frame.waitForSelector('.rs-game', { timeout: 60_000 });
      await frame.waitForSelector('.rs-detail', { timeout: 30_000 });
      let fullscreen = await findTextHandle(frame, 'a', '全屏打开', false);
      if (!fullscreen) throw new Error('embedded Resonance page has no full screen link');
      const initialHit = await fullscreen.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, hitTag: hit?.tagName, hitText: hit?.textContent?.trim(), dialog: !!document.querySelector('.rs-detail') };
      });
      if (initialHit.dialog) {
        const close = await frame.$('button[aria-label="关闭详情"]');
        if (!close) throw new Error('detail dialog blocks fullscreen anchor and has no close control');
        await close.click();
        await frame.waitForSelector('.rs-detail', { hidden: true, timeout: 10_000 });
        fullscreen = await findTextHandle(frame, 'a', '全屏打开', false);
        if (!fullscreen) throw new Error('fullscreen anchor disappeared after closing the detail dialog');
      }
      await frame.waitForFunction(() => {
        const el = [...document.querySelectorAll('a')].find((candidate) => candidate.textContent.trim() === '全屏打开');
        if (!el) return false;
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && hit === el && !document.querySelector('.rs-detail');
      }, { timeout: 10_000 });
      const href = await fullscreen.evaluate((el) => el.href);
      const hrefUrl = new URL(href), embeddedUrl = new URL(frame.url());
      if (hrefUrl.searchParams.get('session') !== fixture.id || hrefUrl.hash !== embeddedUrl.hash) throw new Error('full screen link dropped session or deep link fragment');
      let targetHandler;
      const popupPromise = new Promise((resolve) => {
        targetHandler = (target) => {
          if (target.type() === 'page') resolve(target.page());
        };
        browserInstance.on('targetcreated', targetHandler);
      });
      let popup;
      try {
        await fullscreen.click();
        popup = await Promise.race([popupPromise, new Promise((_, reject) => setTimeout(() => reject(new Error(`full screen click opened no browser page: ${href}`)), 15_000))]);
      } finally {
        if (targetHandler) browserInstance.off('targetcreated', targetHandler);
      }
      if (!popup) throw new Error(`full screen click did not create a browser page: ${href}`);
      await waitGame(popup);
      const openedUrl = popup.url();
      if (new URL(openedUrl).searchParams.get('session') !== fixture.id || new URL(openedUrl).hash !== embeddedUrl.hash) throw new Error('opened full screen page did not preserve embedded session/fragment');
      await popup.close();
      passed('workshop-iframe-fullscreen-session-fragment', '本地iframe宿主中从真实策略定位链接点全屏；新页保留同一session与hash。iframe嵌入行为已验，实际Workshop宿主未接入本仓运行环境');
      return { fixtureId: fixture.id, iframeUrl: detailUrl, embeddedSession: fixture.id, embeddedHash: embeddedUrl.hash,
        fullscreenHref: href, openedUrl, viewport: { width: 1120, height: 800 }, detailClosedBeforeClick: initialHit.dialog,
        clickCenterHitVerified: true, battleReplayed: false };
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
    await capture(workshop, '05-workshop-card.png', 'Workshop画布中的正式玩法卡');
    const locateEmbeddedGame = () => workshop.frames().find((candidate) => {
      try {
        const url = new URL(candidate.url()); let parent = candidate.parentFrame(), nestedInHost = false;
        while (parent) { if (parent === hostFrame) { nestedInHost = true; break; } parent = parent.parentFrame(); }
        return nestedInHost && matchesExpectedEmbeddedGame(url.href, expectedEmbeddedURL);
      } catch { return false; }
    }) || null;
    let activate = await card.$('button[aria-label="游玩"]');
    let activationLabel = '游玩';
    if (!activate || !(await visible(activate))) {
      activate = await findTextHandle(card, 'button', '全屏查看', false);
      activationLabel = '全屏查看';
    }
    if (!activate || !(await visible(activate))) {
      await card.hover().catch(() => {});
      await card.click().catch(() => {});
      await hostFrame.waitForFunction((id) => {
        const node = [...document.querySelectorAll('.react-flow__node')].find((entry) => entry.getAttribute('data-id') === id);
        if (!node) return false;
        const controls = [...node.querySelectorAll('button,a,[role="button"]')];
        return controls.some((control) => {
          const rect = control.getBoundingClientRect(), style = getComputedStyle(control);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        });
      }, { timeout: 2_000 }, focusCardId).catch(() => {});
      activate = await card.$('button[aria-label="游玩"]');
      activationLabel = '游玩';
      if (!activate || !(await visible(activate))) {
        activate = await findTextHandle(card, 'button', '全屏查看', false);
        activationLabel = '全屏查看';
      }
    }
    let embeddedFrame = locateEmbeddedGame();
    if (!embeddedFrame && (!activate || !(await visible(activate)))) {
      await card.click({ clickCount: 2 }).catch(() => {});
      for (let attempt = 0; attempt < 30 && !embeddedFrame; attempt++) {
        embeddedFrame = locateEmbeddedGame();
        if (!embeddedFrame) await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!embeddedFrame && (!activate || !(await visible(activate)))) {
      await card.click({ button: 'right' }).catch(() => {});
      const menuOptions = await hostFrame.$$eval('button,[role="menuitem"],a', (elements) => elements.map((el) => {
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
        return { text: (el.innerText || '').trim(), aria: el.getAttribute('aria-label'), visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' };
      })).catch(() => []);
      for (const label of ['全屏查看','全屏打开','全屏预览','预览','游玩','打开玩法']) {
        activate = await findTextHandle(hostFrame, 'button,[role="menuitem"]', label, false).catch(() => null);
        if (activate && await visible(activate)) { activationLabel = `右键菜单${label}`; break; }
      }
      if (!activate || !(await visible(activate))) {
        const cardInspection = await card.evaluate((el) => ({
          cardId: el.getAttribute('data-id'), className: typeof el.className === 'string' ? el.className : '',
          rect: (() => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,intersectsViewport:r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight }; })(),
          text: (el.innerText || '').trim().slice(0, 1000), menuOptions,
          controls: [...el.querySelectorAll('button,a,[role="button"]')].map((control) => {
            const rect = control.getBoundingClientRect(), style = getComputedStyle(control), href = control.getAttribute('href');
            return { tag: control.tagName.toLowerCase(), text: (control.innerText || '').trim().slice(0, 120),
              ariaLabel: control.getAttribute('aria-label'), title: control.getAttribute('title'), disabled: !!control.disabled,
              visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
              hrefPath: href ? (() => { try { const url = new URL(href, location.href); return `${url.origin}${url.pathname}${url.hash}`; } catch { return null; } })() : null };
          })
        }));
        await capture(workshop, '07-workshop-card-action-inspection.png', 'Workshop目标卡实际界面');
        throw new Error(`目标卡 ${focusCardId} 在选中/双击/右键后仍无嵌入iframe或可用游玩控件；实际卡UI摘要=${JSON.stringify(cardInspection)}`);
      }
    }
    if (!embeddedFrame && activate && await visible(activate)) {
      await activate.click();
      const activationDeadline = Date.now() + 30_000;
      while (!embeddedFrame && Date.now() < activationDeadline) {
        embeddedFrame = locateEmbeddedGame();
        if (!embeddedFrame) await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    if (!embeddedFrame) {
      const controls = await hostFrame.$$eval('button,a,[role="button"],[role="menuitem"]', (elements) => elements.map((el) => {
        const rect=el.getBoundingClientRect(),style=getComputedStyle(el),href=el.getAttribute('href');
        return { tag:el.tagName.toLowerCase(),text:(el.innerText||'').trim().slice(0,120),aria:el.getAttribute('aria-label'),
          visible:rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden',
          hrefPath:href?(()=>{try{const url=new URL(href,location.href);return `${url.origin}${url.pathname}${url.hash}`}catch{return null}})():null };
      })).catch(()=>[]);
      await capture(workshop,'07-workshop-no-embedded-game.png','Workshop卡片操作后的实时界面');
      throw new Error(`目标卡 ${focusCardId} 经真实${activationLabel}操作仍未出现HD游戏iframe；可见控件=${JSON.stringify(controls)}`);
    }
    if (embeddedFrame) {
      const frameGame = await startViaUi(embeddedFrame);
      const openingRender = await inspectEmbeddedRender(embeddedFrame, frameGame.id);
      await capture(workshop, '05-workshop-embedded.png', 'Workshop画布内的真实对局界面');
      await appendWorkshopProof('production-workshop-opening-render-audit', { productNativeRevision: REMOTE_AUDIT_NATIVE_REVISION,
        sessionId: frameGame.id, screenshot: path.join(SCREENSHOT_DIR, `${REMOTE_ATTEMPT_ID}-05-workshop-embedded.png`), openingRender });
      const rosterButton = await findTextHandle(embeddedFrame, '.rs-game button', '展开全部干员', true);
      if (!rosterButton) throw new Error('Workshop新局没有干员图鉴入口');
      await rosterButton.click();
      const operatorButton = await embeddedFrame.$('.rs-roster article.rs-card button.rs-card__main');
      if (!operatorButton) throw new Error('Workshop新局未显示可定位的干员详情');
      const operatorId = await operatorButton.evaluate((el) => el.closest('article')?.id?.slice('operator-'.length) || '');
      await operatorButton.click(); await embeddedFrame.waitForSelector('.rs-detail', { timeout: 15_000 });
      let fullscreen = await findTextHandle(embeddedFrame, 'a', '全屏打开', false);
      if (!fullscreen) throw new Error('高清嵌入游戏中没有全屏入口');
      const iframeHash = new URL(embeddedFrame.url()).hash;
      const href = new URL(await fullscreen.evaluate((el) => el.href));
      if (href.searchParams.get('session') !== frameGame.id || href.hash !== iframeHash) throw new Error('卡片高清iframe全屏URL未保留当前session/hash');
      const hit = await fullscreen.evaluate((el) => { const r=el.getBoundingClientRect(); const target=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return { hit:target===el,rect:{width:r.width,height:r.height},modal:!!document.querySelector('.rs-detail') }; });
      if (hit.modal) {
        const close=await embeddedFrame.$('button[aria-label="关闭详情"]'); if(!close)throw new Error('高清iframe的干员详情遮挡全屏且无关闭入口');
        await close.click(); await embeddedFrame.waitForSelector('.rs-detail',{hidden:true,timeout:10_000});
        fullscreen=await findTextHandle(embeddedFrame,'a','全屏打开',false);
      }
      await fullscreen.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
      await embeddedFrame.waitForFunction(()=>{const el=[...document.querySelectorAll('a')].find(x=>x.textContent.trim()==='全屏打开');if(!el)return false;const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.width>0&&r.height>0&&el.contains(hit)&&!document.querySelector('.rs-detail')},{timeout:10_000});
      let popupHandler; let popupTimeout;
      const popupPromise=new Promise(resolve=>{popupHandler=popup=>resolve(popup);workshop.once('popup',popupHandler)});
      let popup;
      try { await fullscreen.click(); popup=await Promise.race([popupPromise,new Promise((_,reject)=>{popupTimeout=setTimeout(()=>reject(new Error('卡片高清iframe全屏点击未打开新页（15秒超时）')),15_000)})]); }
      finally { if(popupHandler)workshop.off('popup',popupHandler);if(popupTimeout)clearTimeout(popupTimeout); }
      try {
        await scopePage(popup); await waitGame(popup);
        const popupUrl=new URL(popup.url());
        if(popupUrl.searchParams.get('session')!==frameGame.id||popupUrl.hash!==iframeHash)throw new Error('卡片高清iframe全屏页没有保留session/hash');
        await capture(popup,'09-workshop-fullscreen.png','Workshop卡片内游戏全屏打开');
        const fullscreenEvidence = `Workshop Canvas正式卡片HD iframe通过游戏UI打开全屏popup；实际popup session=${frameGame.id}与嵌入局相同、hash=${iframeHash}与嵌入页相同；全屏图=${path.join(SCREENSHOT_DIR, `${REMOTE_ATTEMPT_ID}-09-workshop-fullscreen.png`)}`;
        remoteStory('production-workshop-embedded-fullscreen', 'passed', fullscreenEvidence);
        await appendWorkshopProof('production-workshop-fullscreen-ui-proof', { sessionId: frameGame.id, iframeUrl: embeddedFrame.url(), popupUrl: popup.url(), hash: iframeHash,
          gameNativeRevision: REMOTE_PRODUCT_NATIVE_REVISION, deliveryAuditRevision: REMOTE_AUDIT_NATIVE_REVISION,
          screenshot: path.join(SCREENSHOT_DIR, `${REMOTE_ATTEMPT_ID}-09-workshop-fullscreen.png`), status: 'passed', rendererAudit: 'pending' });
        const savedSessionId = REMOTE_FOLLOWUP_SESSION_ID;
        const replay = await replayExistingBattleInWorkshopFrame(embeddedFrame, savedSessionId);
        await capture(workshop, '10-workshop-native-battle-replay.png', 'Workshop嵌入的既有战斗客户端回放');
        const battleRender = await inspectEmbeddedRender(embeddedFrame, savedSessionId);
        const audit = { status: 'captured', productNativeRevision: REMOTE_AUDIT_NATIVE_REVISION, unchangedGameNativeRevision: REMOTE_PRODUCT_NATIVE_REVISION,
          screenshot: path.join(SCREENSHOT_DIR, `${REMOTE_ATTEMPT_ID}-10-workshop-native-battle-replay.png`), replay, openingRender, battleRender,
          consoleErrors: errors.filter((item) => item.includes('remote Workshop') || item.includes('production followup')), missingResources };
        await appendWorkshopProof('production-workshop-native-render-audit', audit);
        return `${fullscreenEvidence}；卡片预览入口=${activationLabel}；干员${operatorId}用于定位。既有已结算战斗仅客户端回放，未执行新Battle；Native渲染与资源诊断=${JSON.stringify(audit)}`;
      } finally { await popup.close(); }
    }
  } finally {
    browserInstance.off('targetcreated', targetHandler);
    for (const page of scopedPageList) {
      const scoped = scopedPages.get(page);
      if (scoped) await scoped.then((value) => value.dispose()).catch(() => {});
    }
    await workshop.close();
  }
}
async function appendWorkshopProof(kind, evidence) {
  const receipt = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
  receipt.followupEvidence ??= [];
  receipt.followupEvidence.push({ createdAt: new Date().toISOString(), kind, productNativeRevision: REMOTE_PRODUCT_NATIVE_REVISION,
    auditNativeRevision: REMOTE_AUDIT_NATIVE_REVISION,
    nativeSource: nativeSourceState(), evidence });
  if (kind === 'production-workshop-native-render-audit') receipt.workshopRendererAudit = evidence;
  if (kind === 'production-existing-session-native-render-audit') receipt.directColorcVisualAudit = evidence;
  await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}
async function inspectEmbeddedRender(frame, sessionId) {
  const savedState = await stateOf(frame, sessionId);
  await frame.waitForFunction(() => {
    const view = globalThis.__SP_VIEW__, host = document.querySelector('.rs-field__canvas');
    if (!view || !host || !['engine','fallback'].includes(view.kind)) return false;
    if (view.kind === 'fallback') return true;
    return [...host.querySelectorAll('canvas')].some((canvas) => canvas.width > 0 && canvas.height > 0);
  }, { timeout: 45_000 });
  await frame.waitForFunction(() => {
    const view = globalThis.__SP_VIEW__;
    if (!view || view.kind === 'fallback') return true;
    let stats;
    try { stats = view.raw?.stats?.(); } catch { return true; }
    const spine = stats?.spine;
    return !spine || spine.loading === 0 || spine.ready > 0 || spine.failed > 0;
  }, { timeout: 30_000 }).catch(() => {});
  await frame.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return frame.evaluate(async (state) => {
    const host = document.querySelector('.rs-field__canvas');
    const view = globalThis.__SP_VIEW__;
    let stats = null;
    try { stats = view?.raw?.stats?.() ?? null; } catch (error) { stats = { error: error.message }; }
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
    };
    const canvases = [...(host?.querySelectorAll('canvas') || [])].map((canvas) => ({
      width: canvas.width, height: canvas.height, css: rect(canvas), ready: canvas.width > 0 && canvas.height > 0,
      webgl: (() => { try { return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')); } catch { return false; } })(),
    }));
    const resourceEntries = performance.getEntriesByType('resource').map((entry) => entry.name);
    const moduleUrls = resourceEntries.filter((name) => /(?:\/|^)data\.js(?:[?#]|$)|(?:\/|^)gameComponents\.js(?:[?#]|$)|(?:\/|^)resonance\/app\.js(?:[?#]|$)/i.test(name));
    const resources = resourceEntries
      .filter((name) => /\.(?:png|webp|jpe?g|json|skel|atlas|webm|mp3|ogg)(?:[?#]|$)/i.test(name))
      .slice(-80);
    const spineResources = resourceEntries.filter((name) => /\.(?:skel|atlas)(?:[?#]|$)/i.test(name));
    const app = view?.raw?.app, tiles = app?.tiles;
    let tileSurface = null;
    try { tileSurface = { tileKeys: Object.keys(tiles || {}).slice(0, 40), atlasKeys: Object.keys(tiles?.atlas || {}).slice(0, 30), stageId: state.node?.stageId || state.stageId || null }; }
    catch (error) { tileSurface = { error: error.message }; }
    let dataGraph = null;
    try {
      const appModuleUrl = moduleUrls.find((name) => /\/resonance\/app\.js(?:[?#]|$)/i.test(name));
      const componentsUrl = moduleUrls.find((name) => /\/gameComponents\.js(?:[?#]|$)/i.test(name));
      if (appModuleUrl && componentsUrl) {
        const aUrl = new URL('../data.js', appModuleUrl).href, bUrl = new URL('../data.js', componentsUrl).href;
        const [a, b] = await Promise.all([import(aUrl), import(bUrl)]);
        const stageData = a.data.get('stages');
      const dataFiles = ['assets','local','stages','chess','tokens','enemies'];
        dataGraph = { appDataUrl: aUrl, gameComponentDataUrl: bUrl, sameModuleObject: a.data === b.data,
          appDataStatus: Object.fromEntries(dataFiles.map((name) => [name, a.data.status(name)])),
          gameComponentDataStatus: Object.fromEntries(dataFiles.map((name) => [name, b.data.status(name)])),
          stageEntryCount: Array.isArray(stageData) ? stageData.length : stageData && typeof stageData === 'object' ? Object.keys(stageData).length : 0,
          selectedStageFound: Boolean((Array.isArray(stageData) ? stageData : Object.values(stageData || {})).find((entry) => entry?.id === (state.node?.stageId || state.stageId))) };
      }
    } catch (error) { dataGraph = { error: error.message, moduleUrls }; }
    let webglSample = null;
    try {
      const canvas = host?.querySelector('canvas'), gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
      if (gl && canvas.width && canvas.height) {
        const points = [[.2,.2],[.5,.2],[.8,.2],[.2,.5],[.5,.5],[.8,.5],[.2,.8],[.5,.8],[.8,.8]];
        webglSample = points.map(([x,y]) => { const px=new Uint8Array(4); gl.readPixels(Math.floor(canvas.width*x),Math.floor(canvas.height*y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px); return [...px]; });
      }
    } catch (error) { webglSample = { error: error.message }; }
    return {
      phase: state.phase, round: state.round, node: { id: state.node?.id, kind: state.node?.kind, stageId: state.node?.stageId || state.stageId || null },
      historyBattles: (state.history || []).filter((entry) => entry.type === 'fight-settled').map((entry) => ({ round: entry.round, won: entry.won, hpLoss: entry.hpLoss })),
      rendererKind: view?.kind ?? null, rendererClass: view?.raw?.constructor?.name ?? null,
      fieldHost: rect(host), canvases, stats, pixiVersion: globalThis.PIXI?.VERSION ?? null,
      tileSurface, webglSample, moduleUrls, dataGraph,
      spineResources,
      sceneElements: host ? { children: host.children.length, images: host.querySelectorAll('img').length,
        appKeys: Object.keys(app || {}).slice(0, 60), rendererKeys: Object.keys(view || {}).slice(0, 30),
        spineSummary: stats?.spine ? { ready: stats.spine.ready, loading: stats.spine.loading, failed: stats.spine.failed,
          active: stats.spine.active, queued: stats.spine.queued, originalMissing: stats.originalMissing } : null,
        visibleText: (host.innerText || '').slice(0, 160) } : null,
      resourceTail: resources,
    };
  }, savedState);
}
async function replayExistingBattleInWorkshopFrame(frame, sessionId) {
  assert(sessionId, 'missing existing production session for client-side battle replay');
  const replayUrl = new URL(REMOTE_EMBED_URL || REMOTE_ENTRY_URL);
  replayUrl.searchParams.set('session', sessionId);
  replayUrl.searchParams.set('execution', 'client');
  replayUrl.hash = 'section-battle-report';
  await frame.goto(replayUrl.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitGame(frame, 45_000);
  const state = await stateOf(frame, sessionId);
  const settled = (state.history || []).filter((entry) => entry.type === 'fight-settled');
  assert(settled.length > 0, `existing production session ${sessionId} has no settled battle to replay`);
  const last = settled.at(-1);
  await frame.waitForSelector('#rs-section-battle-report', { timeout: 15_000 });
  const battleButton = await findTextHandle(frame, '#rs-section-battle-report button', `第${last.round}场`, false);
  assert(battleButton, `existing report lacks settled round ${last.round}`);
  await battleButton.click();
  await frame.waitForSelector('.rs-replay', { timeout: 15_000 });
  const renderer = await frame.evaluate(() => ({
    viewKind: globalThis.__SP_VIEW__?.kind ?? null,
    canvasCount: document.querySelectorAll('.rs-field__canvas canvas').length,
    replayLabel: document.querySelector('.rs-replay b')?.textContent?.trim() || null,
  }));
  return { sessionId, round: last.round, won: last.won, hpLoss: last.hpLoss, battleExecuted: false,
    replayVisible: Boolean(renderer.replayLabel), renderer, openedUrl: frame.url() };
}
async function runExistingSessionVisualReplay(sessionId) {
  assert(REMOTE_MODE && REMOTE_ENTRY_URL, 'existing-session visual replay requires a direct production entry URL');
  assert(sessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId),
    'existing-session visual replay requires a persisted session UUID');
  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const { access } = await import('node:fs/promises');
  await access(chromePath); await mkdir(SCREENSHOT_DIR, { recursive: true });
  server = { url: new URL(REMOTE_ENTRY_URL).origin, entryUrl: REMOTE_ENTRY_URL, close: async () => {} };
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: PROFILE_DIR,
    args: ['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist',
      '--no-first-run','--no-default-browser-check','--disable-background-networking','--window-size=1440,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  attachPageDiagnostics(page, 'existing session visual replay');
  const deadline = new Promise((_, reject) => { timeoutHandle = setTimeout(() => {
    void page.close().catch(() => {}); void browser?.close().catch(() => {});
    reject(new Error('existing-session visual replay exceeded 3-minute deadline'));
  }, 3 * 60 * 1000); });
  const work = (async () => {
    const target = new URL(REMOTE_ENTRY_URL);
    target.searchParams.set('session', sessionId); target.searchParams.set('execution', 'client'); target.hash = 'section-battle-report';
    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitGame(page, 60_000);
    const state = await stateOf(page, sessionId);
    const settled = (state.history || []).filter(entry => entry.type === 'fight-settled');
    assert(settled.length, `persisted session ${sessionId} has no completed battle report`);
    const last = settled.at(-1);
    await page.waitForSelector('#rs-section-battle-report', { timeout: 15_000 });
    const button = await findTextHandle(page, '#rs-section-battle-report button', `第${last.round}场`, false);
    assert(button, `battle report has no replay button for settled round ${last.round}`);
    await button.click();
    await page.waitForSelector('.rs-replay', { timeout: 15_000 });
    let replayPaused = false;
    const pauseButton = await findTextHandle(page, '.rs-replay button', '暂停', false).catch(() => null);
    if (pauseButton) {
      await pauseButton.click();
      replayPaused = await page.waitForFunction(() => [...document.querySelectorAll('.rs-replay button')]
        .some(node => /继续|播放/.test(node.textContent || '')), { timeout: 5_000 }).then(() => true).catch(() => false);
    }
    const render = await inspectEmbeddedRender(page, sessionId);
    const replayLabel = await page.$eval('.rs-replay b', node => node.textContent.trim()).catch(() => null);
    await page.evaluate(() => window.getSelection?.()?.removeAllRanges?.());
    const screenshot = path.join(SCREENSHOT_DIR, `${REMOTE_ATTEMPT_ID}-10-existing-session-native-replay.png`);
    await page.screenshot({ path: screenshot, fullPage: true, captureBeyondViewport: true });
    const fieldHost = await page.$('.rs-field__canvas');
    const fieldScreenshot = path.join(SCREENSHOT_DIR, `${REMOTE_ATTEMPT_ID}-10-existing-session-field.png`);
    if (fieldHost) await fieldHost.screenshot({ path: fieldScreenshot });
    await Promise.allSettled([...pendingResponseDiagnostics]);
    const evidence = { sessionId, target: target.href, phase: state.phase, round: state.round,
      settled: { round: last.round, won: last.won, hpLoss: last.hpLoss }, replayLabel,
      battleExecuted: false, replayPaused, screenshot, fieldScreenshot, render, errors: [...errors], missingResources: [...missingResources] };
    await appendWorkshopProof('production-existing-session-native-render-audit', evidence);
    return { status: render.rendererKind === 'engine' && render.dataGraph?.sameModuleObject && render.dataGraph?.selectedStageFound
      && render.canvases.some(canvas => canvas.ready) ? 'passed' : 'incomplete', evidence, receipt: RECEIPT_PATH };
  })();
  try { return await Promise.race([work, deadline]); }
  catch (error) {
    const screenshot = path.join(SCREENSHOT_DIR, `${REMOTE_ATTEMPT_ID}-10-existing-session-native-replay-failure.png`);
    await page.evaluate(() => window.getSelection?.()?.removeAllRanges?.()).catch(() => {});
    await page.screenshot({ path: screenshot, fullPage: true, captureBeyondViewport: true }).catch(() => {});
    const evidence = { sessionId, error: error.stack || String(error), screenshot, pageUrl: page.url(), errors: [...errors], missingResources: [...missingResources] };
    await appendWorkshopProof('production-existing-session-native-render-audit', evidence);
    return { status: 'failed', evidence, receipt: RECEIPT_PATH };
  } finally { clearTimeout(timeoutHandle); await page.close().catch(() => {}); await browser?.close().catch(() => {}); }
}
async function runRemoteProductionFollowups(sessionId) {
  assert(REMOTE_MODE && REMOTE_WORKSHOP_URL, 'production followup requires remote entry and Workshop URLs');
  assert(sessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId), 'production followup requires the existing production session UUID');
  const oldReceipt = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
  assert(oldReceipt.mode === 'remote-production' && oldReceipt.resumedSessionId === sessionId,
    'production followup session does not match the saved same-session attempt');
  assert(oldReceipt.productNativeRevision === REMOTE_PRODUCT_NATIVE_REVISION,
    'product Native revision does not match the previous production attempt');
  const mustRemainPassed = ['production-starts','production-renderers','production-natural-battles-and-supply',
    'production-shop-actions','production-session-reload','production-selection-and-layout','production-section-copy-links'];
  assert(mustRemainPassed.every((name) => oldReceipt.remoteStories?.[name]?.status === 'passed'),
    'followup must preserve the seven previously passed production stories');
  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const { access } = await import('node:fs/promises');
  await access(chromePath); await mkdir(SCREENSHOT_DIR, { recursive: true }); await mkdir(PROFILE_DIR, { recursive: true });
  server = { url: new URL(REMOTE_ENTRY_URL).origin, entryUrl: REMOTE_ENTRY_URL, close: async () => {} };
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: PROFILE_DIR,
    args: ['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist',
      '--no-first-run','--no-default-browser-check','--disable-background-networking','--window-size=1440,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await browser.defaultBrowserContext().overridePermissions(server.url, ['clipboard-read','clipboard-write']);
  attachPageDiagnostics(page, 'production followup');
  const appendCheckpoint = async (kind, evidence) => {
    const receipt = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
    receipt.followupEvidence ??= [];
    receipt.followupEvidence.push({ createdAt: new Date().toISOString(), kind, nativeSource: nativeSourceState(), productNativeRevision: REMOTE_PRODUCT_NATIVE_REVISION, evidence });
    await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    return receipt;
  };
  const kinds = ['operator','pact','item','recipe','strategy','environment','member','inventory','equipped','offer','choice','node','battleNode','session'];
  const latestLinkEvidence = new Map();
  for (const entry of oldReceipt.followupEvidence || []) {
    if (entry.kind === 'production-link-kind-checkpoint' && entry.evidence?.kind) latestLinkEvidence.set(entry.evidence.kind, entry.evidence);
  }
  const linkResults = kinds.map((kind) => latestLinkEvidence.get(kind) || { kind, status: 'unavailable', error: 'not yet checked' });
  const resultByKind = new Map(linkResults.map((entry) => [entry.kind, entry]));
  const candidateSessionIds = [...new Set([sessionId, ...REMOTE_FOLLOWUP_EXISTING_SESSIONS])];
  let primaryState;
  const workshopOnly = process.argv.includes('--workshop-only');
  try {
    for (let sourceIndex = 0; !workshopOnly && sourceIndex < candidateSessionIds.length; sourceIndex++) {
      const sourceSessionId = candidateSessionIds[sourceIndex];
      const unresolved = kinds.filter((kind) => resultByKind.get(kind)?.status !== 'passed');
      if (!unresolved.length) break;
      await page.goto(entryUrl(server, { session: sourceSessionId }), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitGame(page);
      const state = await stateOf(page, sourceSessionId);
      assert(new URL(page.url()).searchParams.get('session') === sourceSessionId, 'production followup did not open the existing persisted session');
      if (sourceIndex === 0) {
        primaryState = state;
        await capture(page, '06-production-deep-link-source.png', '生产对局中的可复制链接');
      }
      await appendCheckpoint('production-existing-session-inspection', { sessionId: sourceSessionId, phase: state.phase, round: state.round,
        revision: state.revision, pendingChoiceCount: state.pendingChoices?.length || 0, inventoryCount: state.inventory?.length || 0,
        equippedCount: (state.pieces || []).reduce((n, piece) => n + (piece.equipment?.length || 0), 0), unresolvedKinds: unresolved });
      process.stdout.write(`${JSON.stringify({ event: 'production-link-source', sourceIndex, sessionId: sourceSessionId, phase: state.phase, round: state.round,
        revision: state.revision, pendingChoiceCount: state.pendingChoices?.length || 0, unresolvedKinds: unresolved, native: nativeSourceState() })}\n`);
      for (const kind of unresolved) {
        const checkpoint = { kind, sessionId: sourceSessionId, phase: state.phase, round: state.round, revision: state.revision, stage: 'copy-live-component' };
        process.stdout.write(`${JSON.stringify({ event: 'production-link-start', kind, sessionId: sourceSessionId, native: nativeSourceState() })}\n`);
        try {
          const copied = await copyLiveLinkForKind(page, server, kind, (detail) => { checkpoint.copyProgress = detail; });
          assert(copied, `no current live ${kind} component on source page; ${JSON.stringify(checkpoint.copyProgress || {})}`);
          checkpoint.url = copied.url; checkpoint.targetId = copied.targetId;
          const targetPage = await browser.newPage();
          try {
            checkpoint.stage = 'open-copied-link';
            await targetPage.goto(copied.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
            await waitGame(targetPage, 25_000);
            const parsed = detailHashParts(new URL(copied.url));
            assert(parsed.kind === kind, `copied ${kind} URL resolved to ${parsed.kind}`);
            if (new Set(['operator','pact','item','recipe','strategy','environment']).has(kind)) await targetPage.waitForSelector('.rs-detail', { timeout: 12_000 });
            else if (kind === 'member') await targetPage.waitForFunction((id) => !!document.getElementById(`member-${encodeURIComponent(id)}`)?.matches(':focus'), { timeout: 12_000 }, parsed.id);
            else if (kind === 'session') {
              assert(new URL(targetPage.url()).searchParams.get('session') === parsed.id, 'session copy lost the session ID');
              const actual = await stateOf(targetPage, parsed.id);
              checkpoint.targetState = { phase: actual.phase, round: actual.round, revision: actual.revision };
            } else await targetPage.waitForSelector(`[id="${copied.targetId.replaceAll('"','\\"')}"]`, { timeout: 12_000 });
            checkpoint.status = 'passed'; checkpoint.openedUrl = targetPage.url(); checkpoint.targetVisible = true;
          } finally { await targetPage.close().catch(() => {}); }
        } catch (error) { checkpoint.status = 'unavailable'; checkpoint.error = error.stack || String(error); }
        resultByKind.set(kind, checkpoint);
        await appendCheckpoint('production-link-kind-checkpoint', checkpoint);
        process.stdout.write(`${JSON.stringify({ event: 'production-link-terminal', kind, status: checkpoint.status, sessionId: sourceSessionId, targetId: checkpoint.targetId || null })}\n`);
      }
    }
    const finalLinkResults = kinds.map((kind) => resultByKind.get(kind));
    const passedLinks = finalLinkResults.filter((entry) => entry.status === 'passed');
    const deepLinksPassed = finalLinkResults.length === kinds.length && passedLinks.length === kinds.length;
    if (!workshopOnly) await appendCheckpoint('production-deep-links-and-copy', { sessionId, inspectedSessions: candidateSessionIds, phase: primaryState?.phase, round: primaryState?.round,
      expectedKinds: kinds, passedKinds: passedLinks.map((entry) => ({ kind: entry.kind, sessionId: entry.sessionId })),
      missing: finalLinkResults.filter((entry) => entry.status !== 'passed'), battleReplayed: false });
    let workshopEvidence = null;
    let workshopFailure = null;
    try {
      workshopEvidence = await verifyRemoteWorkshopEmbed(browser, REMOTE_WORKSHOP_URL);
      await appendCheckpoint('production-workshop-embedded-fullscreen', { sessionId, workshopEvidence, battleReplayed: false });
    } catch (error) {
      workshopFailure = error.stack || String(error);
      errors.push(`production-workshop-embedded-fullscreen: ${workshopFailure}`);
      await appendCheckpoint('production-workshop-embedded-fullscreen', { sessionId, status: 'unavailable', error: workshopFailure, battleReplayed: false });
    }

    const receipt = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
    const { priorAttempts: _previousHistory, ...previousAttempt } = receipt;
    receipt.priorAttempts = [...(Array.isArray(receipt.priorAttempts) ? receipt.priorAttempts : []), previousAttempt];
    if (!workshopOnly) receipt.remoteStories['production-deep-links-and-copy'] = { status: deepLinksPassed ? 'passed' : 'unavailable', evidence: `既有真实SID ${candidateSessionIds.length} 个页面中的当前可复制组件逐一点击、打开并定位：${passedLinks.map((entry) => `${entry.kind}@${entry.sessionId}`).join('、') || '无'}；缺失：${finalLinkResults.filter((entry) => entry.status !== 'passed').map((entry) => entry.kind).join('、') || '无'}；未重放战斗。` };
    const fullscreenProof = remoteStories.get('production-workshop-embedded-fullscreen');
    const priorFullscreenProof = oldReceipt.remoteStories?.['production-workshop-embedded-fullscreen'];
    receipt.remoteStories['production-workshop-embedded-fullscreen'] = workshopFailure && priorFullscreenProof?.status === 'passed'
      && oldReceipt.productNativeRevision === REMOTE_PRODUCT_NATIVE_REVISION
      ? priorFullscreenProof
      : workshopFailure && fullscreenProof?.status !== 'passed'
        ? { status: 'unavailable', evidence: workshopFailure }
        : workshopFailure
          ? { status: 'passed', evidence: `${fullscreenProof.evidence}；其后native渲染回放诊断未完成：${workshopFailure}` }
          : { status: 'passed', evidence: workshopEvidence };
    if (!workshopOnly) receipt.verifiedLinkKinds = [...new Set([...(receipt.verifiedLinkKinds || []), ...passedLinks.map((entry) => entry.kind)])];
    receipt.screenshots = [...(receipt.screenshots || []), ...screenshots];
    receipt.followupNativeSources ??= [];
    receipt.followupNativeSources.push({ before: SOURCE_BEFORE, after: nativeSourceState(), productNativeRevision: REMOTE_PRODUCT_NATIVE_REVISION });
    receipt.errors = [...errors];
    receipt.resolvedHistoricalErrors = [...(receipt.resolvedHistoricalErrors || []), ...(previousAttempt.errors || [])];
    receipt.missingStories = Object.entries(receipt.remoteStories).filter(([, value]) => value.status !== 'passed').map(([name, value]) => ({ name, ...value }));
    receipt.status = receipt.missingStories.length === 0 && receipt.errors.length === 0 ? 'passed' : 'incomplete';
    receipt.completedAt = new Date().toISOString();
    await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    return { status: receipt.status, receipt: RECEIPT_PATH, productNativeRevision: REMOTE_PRODUCT_NATIVE_REVISION,
      runnerNative: receipt.followupNativeSources.at(-1), passedKinds: passedLinks.map((entry) => entry.kind),
      missingKinds: finalLinkResults.filter((entry) => entry.status !== 'passed').map((entry) => entry.kind), remoteStories: receipt.remoteStories,
      screenshots: receipt.screenshots, errors: receipt.errors };
  } finally {
    await page.close().catch(() => {}); await browser?.close().catch(() => {}); await server?.close().catch(() => {});
  }
}
async function progressProductionSessionToStrategyChoice(sessionId, { targetStrategyNode = null } = {}) {
  assert(REMOTE_MODE && REMOTE_WORKSHOP_URL, 'production choice progress requires remote entry and Workshop URLs');
  const receipt = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
  assert(receipt.mode === 'remote-production' && receipt.resumedSessionId === sessionId,
    'choice progress must reuse the same production session already in the receipt');
  assert(receipt.productNativeRevision === REMOTE_PRODUCT_NATIVE_REVISION,
    'choice progress product Native does not match the existing production run');
  await mkdir(SCREENSHOT_DIR, { recursive: true }); await mkdir(PROFILE_DIR, { recursive: true });
  server = { url: new URL(REMOTE_ENTRY_URL).origin, entryUrl: REMOTE_ENTRY_URL, close: async () => {} };
  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  await (await import('node:fs/promises')).access(chromePath);
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: PROFILE_DIR,
    args: ['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist',
      '--no-first-run','--no-default-browser-check','--disable-background-networking','--window-size=1440,1000'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 });
  await browser.defaultBrowserContext().overridePermissions(server.url, ['clipboard-read','clipboard-write']);
  attachPageDiagnostics(page, 'production strategy-choice progress');
  const appendCheckpoint = async (kind, evidence) => {
    const current = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
    current.followupEvidence ??= [];
    current.followupEvidence.push({ createdAt: new Date().toISOString(), kind, productNativeRevision: REMOTE_PRODUCT_NATIVE_REVISION,
      nativeSource: nativeSourceState(), evidence });
    await writeFile(RECEIPT_PATH, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    return current;
  };
  const battleCheckpoints = [];
  const supplyCheckpoints = [];
  const startingRevision = nativeSourceState();
  try {
    await page.goto(entryUrl(server, { session: sessionId }), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitGame(page);
    let state = await stateOf(page, sessionId);
    assert(new URL(page.url()).searchParams.get('session') === sessionId, 'strategy progression lost its original session');
    if (state.phase === 'complete') return { status: 'terminal-before-choice', receipt: RECEIPT_PATH, sessionId,
      difficulty: state.difficulty, round: state.round, terminalReason: state.terminalReason || null, battles: battleCheckpoints };
    targetStrategyNode ??= state.difficulty === 'FUNNY' ? 9 : 3;
    const validEntry = state.difficulty === 'FUNNY' ? state.round === 4 : state.difficulty === 'NORMAL' && state.round === 1;
    assert(validEntry, `expected existing FUNNY node 4 or existing NORMAL node 1; got ${state.difficulty}/node ${state.round}`);
    assert(state.difficulty === 'FUNNY' ? targetStrategyNode === 9 : targetStrategyNode === 3,
      `strategy target ${targetStrategyNode} does not match the existing ${state.difficulty} session path`);
    const previouslySettled = new Set((state.history || []).filter((entry) => entry.type === 'fight-settled').map((entry) => Number(entry.round)));
    await appendCheckpoint('production-choice-progress-start', { sessionId, phase: state.phase, round: state.round, revision: state.revision,
      nodeStarted: state.nodeStarted, terminalReason: state.terminalReason || null, previouslySettledRounds: [...previouslySettled], targetStrategyNode });

    for (let step = 0; step < 10; step++) {
      state = await stateOf(page, sessionId);
      assert(state.phase !== 'complete', `existing session reached terminal before strategy-choice node ${targetStrategyNode}`);
      if (state.round === targetStrategyNode && (state.node?.kind === 'logistics' || !state.nodeStarted)) {
        if (!state.pendingChoices?.length) {
          const before = state;
          const buttonText = state.node?.kind === 'logistics' ? '领取后勤并继续' : '领取本节点补给';
          const button = await findTextHandle(page, 'button', buttonText, false);
          assert(button && await enabled(button), `node ${targetStrategyNode} has no enabled official ${buttonText} control`);
          await button.click();
          state = await waitState(page, sessionId, (next) => next.revision > before.revision && (next.pendingChoices?.length || next.phase !== before.phase));
          const supply = { sessionId, round: state.round, revisionBefore: before.revision, revisionAfter: state.revision,
            phase: state.phase, claimedNodes: state.claimedNodes?.slice(-1) || [], pendingChoices: (state.pendingChoices || []).map((choice) => ({ uid: choice.uid, type: choice.type, source: choice.source, remaining: choice.remaining })) };
          supplyCheckpoints.push(supply);
          await appendCheckpoint('production-choice-progress-supply', supply);
        }
        const strategyChoice = (state.pendingChoices || []).find((choice) => choice.type === 'strategy');
        assert(state.phase === 'choice' && strategyChoice, `strategy node ${targetStrategyNode} did not expose a pending strategy choice; phase=${state.phase}, choices=${JSON.stringify(state.pendingChoices || [])}`);
        await capture(page, '08-production-strategy-choice.png', '真实策略节点的待选项目');
        const copyProgress = {};
        const copied = await copyLiveLinkForKind(page, server, 'choice', (detail) => Object.assign(copyProgress, detail));
        assert(copied, `strategy choice ${strategyChoice.uid} has no live copy button; ${JSON.stringify(copyProgress)}`);
        const copiedUrl = new URL(copied.url);
        assert(detailHashParts(copiedUrl).kind === 'choice' && detailHashParts(copiedUrl).id === strategyChoice.uid
          && copiedUrl.searchParams.get('session') === sessionId, 'real strategy-choice copy did not preserve the pending choice and same session');
        const targetPage = await browser.newPage();
        let openedUrl;
        try {
          await targetPage.goto(copied.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
          await waitGame(targetPage, 25_000);
          await targetPage.waitForFunction((uid) => !!document.getElementById(`choice-${uid}`), { timeout: 12_000 }, strategyChoice.uid);
          const targetState = await stateOf(targetPage, sessionId);
          assert(targetState.phase === 'choice' && targetState.pendingChoices?.some((choice) => choice.uid === strategyChoice.uid),
            'copied link does not reopen the same pending strategy choice');
          openedUrl = targetPage.url();
        } finally { await targetPage.close().catch(() => {}); }
        const proof = { sessionId, kind: 'choice', choiceUid: strategyChoice.uid, source: strategyChoice.source, round: state.round,
          revision: state.revision, type: strategyChoice.type, remaining: strategyChoice.remaining, options: [...strategyChoice.options],
          copiedUrl: copiedUrl.href, openedUrl, targetId: `choice-${strategyChoice.uid}`, samePendingChoice: true,
          status: 'passed', battleRounds: battleCheckpoints.map((entry) => entry.round), supplies: supplyCheckpoints.map((entry) => entry.round),
          choiceClaimed: false, battleReplayed: false };
        await appendCheckpoint('production-choice-link-proof', proof);
        const finalReceipt = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
        const passedKinds = new Set((finalReceipt.followupEvidence || []).filter((entry) => entry.kind === 'production-link-kind-checkpoint' && entry.evidence?.status === 'passed').map((entry) => entry.evidence.kind));
        passedKinds.add('choice');
        finalReceipt.verifiedLinkKinds = [...new Set([...(finalReceipt.verifiedLinkKinds || []), 'choice'])];
        if (['operator','pact','item','recipe','strategy','environment','member','inventory','equipped','offer','choice','node','battleNode','session'].every((kind) => passedKinds.has(kind))) {
          finalReceipt.remoteStories['production-deep-links-and-copy'] = { status: 'passed', evidence: `14类真实复制链接均已从现存玩家会话复制并打开定位；strategy=${passedKinds.has('strategy')}，choice=${sessionId}/node${state.round}待选状态，node/battleNode由各自真实节点验证；未领取本策略、未重放已结算战斗。` };
        }
        finalReceipt.productionChoiceProgress = { status: 'passed', productNativeRevision: REMOTE_PRODUCT_NATIVE_REVISION,
          sourceNative: startingRevision, sessionId, targetStrategyNode, battles: battleCheckpoints, supplies: supplyCheckpoints, proof };
        finalReceipt.screenshots = [...(finalReceipt.screenshots || []), ...screenshots];
        finalReceipt.completedAt = new Date().toISOString();
        finalReceipt.missingStories = Object.entries(finalReceipt.remoteStories).filter(([, value]) => value.status !== 'passed').map(([name, value]) => ({ name, ...value }));
        finalReceipt.status = finalReceipt.missingStories.length === 0 && !(finalReceipt.errors || []).length ? 'passed' : 'incomplete';
        await writeFile(RECEIPT_PATH, `${JSON.stringify(finalReceipt, null, 2)}\n`, 'utf8');
        return { status: 'passed', receipt: RECEIPT_PATH, productNativeRevision: REMOTE_PRODUCT_NATIVE_REVISION,
          sourceNative: startingRevision, sessionId, targetStrategyNode, battles: battleCheckpoints, supplies: supplyCheckpoints,
          pendingChoice: proof, screenshot: screenshots.at(-1)?.path, workshopStillPending: finalReceipt.remoteStories['production-workshop-embedded-fullscreen']?.status !== 'passed' };
      }

      if (state.pendingChoices?.length && state.round < targetStrategyNode) {
        const before = state;
        state = await resolveChoicesViaUi(page, sessionId);
        await appendCheckpoint('production-choice-progress-intermediate-choices', { sessionId, round: before.round, revisionBefore: before.revision,
          revisionAfter: state.revision, resolvedChoiceCount: before.pendingChoices.length, remainingChoices: state.pendingChoices?.length || 0 });
        continue;
      }
      const previousSupplyCount = naturalSupplyClaims.length;
      const prepared = await advancePrepViaUi(page, sessionId);
      state = prepared;
      for (const supply of naturalSupplyClaims.slice(previousSupplyCount)) {
        const record = { sessionId, round: supply.round, nodeKind: supply.nodeKind, revision: supply.revision, source: 'official-UI-advancePrepViaUi' };
        supplyCheckpoints.push(record);
        await appendCheckpoint('production-choice-progress-supply', record);
      }
      if (state.round === targetStrategyNode && (state.node?.kind === 'logistics' || !state.nodeStarted)) continue;
      assert(state.phase !== 'complete', `existing session reached terminal before strategy-choice node ${targetStrategyNode}`);
      if (state.pendingChoices?.length) {
        const before = state;
        state = await resolveChoicesViaUi(page, sessionId);
        await appendCheckpoint('production-choice-progress-intermediate-choices', { sessionId, round: before.round, revisionBefore: before.revision,
          revisionAfter: state.revision, resolvedChoiceCount: before.pendingChoices.length, remainingChoices: state.pendingChoices?.length || 0 });
        continue;
      }
      const existingSettlement = state.history?.find((entry) => entry.type === 'fight-settled' && Number(entry.round) === Number(state.round));
      assert(!previouslySettled.has(Number(state.round)) && !existingSettlement,
        `refusing to replay already settled battle at node ${state.round}`);
      const beforeRevision = state.revision;
      const fight = await performRealFight(page, sessionId);
      assert(fight.ran && Number(fight.battleRound) === Number(state.round),
        `no new natural battle executed at expected node ${state.round}; actual=${fight.battleRound ?? 'none'}`);
      state = fight.state;
      const record = { sessionId, round: fight.battleRound, revisionBefore: beforeRevision, revisionAfter: state.revision,
        won: !!fight.settlement.won, hpLoss: Number(fight.settlement.hpLoss || 0),
        diagnostics: { errorCount: Number(fight.settlement.diagnostics?.errorCount || 0), summonAnchorGaps: fight.settlement.diagnostics?.summonAnchorGaps || [] },
        nextRound: state.round, phase: state.phase, terminalReason: state.terminalReason || null };
      battleCheckpoints.push(record);
      previouslySettled.add(Number(fight.battleRound));
      await appendCheckpoint('production-choice-progress-battle-settled', record);
      process.stdout.write(`${JSON.stringify({ event: 'production-choice-battle-settled', ...record })}\n`);
      if (state.phase === 'complete') return { status: 'terminal-before-choice', receipt: RECEIPT_PATH, sessionId,
        difficulty: state.difficulty, round: state.round, terminalReason: state.terminalReason || null, battles: battleCheckpoints,
        supplies: supplyCheckpoints, lastBattle: record };
    }
    throw new Error(`progression exceeded ten official UI steps before strategy node ${targetStrategyNode}; actual state=${JSON.stringify({ round: state.round, phase: state.phase })}`);
  } finally {
    await page.close().catch(() => {}); await browser?.close().catch(() => {}); await server?.close().catch(() => {});
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
  const serverBase = new URL(workshopUrl).origin + '/bside';
  let writerHeaders;
  try {
    const stdout = execFileSync(process.execPath, [WSH_CLI_PATH, 'whoami', '--json', '--server', serverBase, '--project', 'arknights'], {
      encoding: 'utf8', timeout: 20_000, windowsHide: true,
    });
    const writer = JSON.parse(stdout)?.writer;
    writerHeaders = {
      'x-workshop-machine': writer?.machine,
      'x-workshop-session': writer?.session,
      'x-workshop-runtime': writer?.runtime,
      'x-workshop-software': writer?.software,
    };
    if (Object.values(writerHeaders).some(value => typeof value !== 'string' || !value.trim())) {
      throw new Error('official whoami returned incomplete writer identity');
    }
  } catch (error) {
    throw new Error(`official WSH whoami failed; no browser API request sent: ${error.message}`);
  }
  const bearer = `Bearer ${token}`;
  await page.setRequestInterception(true);
  const onRequest = (request) => {
    const headers = { ...request.headers() };
    if (isScopedWorkshopBearerUrl(request.url(), workshopUrl)) {
      headers.authorization = bearer;
      Object.assign(headers, writerHeaders);
    } else {
      if (headers.authorization === bearer) delete headers.authorization;
      for (const key of Object.keys(writerHeaders)) delete headers[key];
    }
    void request.continue({ headers }).catch(() => {});
  };
  page.on('request', onRequest);
  return {
    enabled: true,
    dispose: async () => { page.off('request', onRequest); await page.setRequestInterception(false).catch(() => {}); },
  };
}
async function chooseNativeFieldAction(page, currentState) {
  const fieldHost = await page.$('.rs-field__canvas');
  assert(fieldHost, 'native field canvas host is missing');
  await fieldHost.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  await page.waitForFunction(() => {
    const el = document.querySelector('.rs-field__canvas');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }, { timeout: 10_000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 15_000 }).catch(() => {});
  await page.waitForFunction(() => {
    const v = globalThis.__SP_VIEW__;
    return v?.kind === 'fallback' || v?.raw?.stats?.()?.mode === 'prep';
  }, { timeout: 15_000 }).catch(() => {});
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
    const sessionId = new URL(page.url()).searchParams.get('session');
    const beforeDragRevision = currentState.revision;
    let tile = (piece.legalTiles[1] || piece.legalTiles[0]).split(',').map(Number);
    const pickedUid = Number(String(piece.uid).replace(/^\D+/, ''));
    await page.waitForFunction(({ uid, row, col }) => {
      const view = globalThis.__SP_VIEW__, rect = view?.pieceScreenRect(uid), dest = view?.tileScreen(row, col);
      if (!view || !rect || !dest) { window.__resonanceStableDeployGeometry = null; return false; }
      const sources = [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, { x: rect.x + rect.width / 2, y: rect.bottom - 2 }];
      const source = sources.find((point) => view.pieceAtClient?.(point.x, point.y)?.uid === uid);
      const target = document.elementFromPoint(dest.x, dest.y);
      if (!source || !target || target.tagName !== 'CANVAS'
        || source.x < 0 || source.x >= innerWidth || source.y < 0 || source.y >= innerHeight
        || dest.x < 0 || dest.x >= innerWidth || dest.y < 0 || dest.y >= innerHeight) {
        window.__resonanceStableDeployGeometry = null; return false;
      }
      const current = [Math.round(source.x), Math.round(source.y), Math.round(dest.x), Math.round(dest.y), Math.round(innerWidth), Math.round(innerHeight)];
      const previous = window.__resonanceStableDeployGeometry;
      const count = previous && previous.value.every((value, index) => value === current[index]) ? previous.count + 1 : 1;
      window.__resonanceStableDeployGeometry = { value: current, count };
      return count >= 3;
    }, { polling: 'raf', timeout: 10_000 }, { uid: pickedUid, row: tile[0], col: tile[1] });
    const geometry = await page.evaluate(({ uid, row, col }) => {
      const view = globalThis.__SP_VIEW__;
      const viewUid = Number(String(uid).replace(/^\D+/, ''));
      const rect = view.pieceScreenRect(viewUid);
      const dest = view.tileScreen(row, col);
      const points = rect ? [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, { x: rect.x + rect.width / 2, y: rect.bottom - 2 }] : [];
      // Include the full board and hand/temp rows. A bench piece can sit past column 12, so scanning only
      // the battle-field half silently misses the renderer's authoritative tile-based hit target.
      if (view.pieceAtClient) for (let r = 0; r <= 18; r++) for (let c = 0; c <= 20; c++) {
        const tile = view.tileScreen(r, c);
        if (tile) points.push({ x: tile.x, y: tile.y });
      }
      const picked = points.map(point => ({ point, piece: view.pieceAtClient?.(point.x, point.y) })).find(entry => entry.piece?.uid === viewUid) || null;
      const describe = (point) => {
        const element = point && document.elementFromPoint(point.x, point.y);
        if (!element) return null;
        const style = getComputedStyle(element);
        return { tag: element.tagName, id: element.id, className: String(element.className?.baseVal ?? element.className ?? ''), pointerEvents: style.pointerEvents, zIndex: style.zIndex };
      };
      return { rect, dest, source: picked?.point || (rect && { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }), sourcePick: picked?.piece || null,
        sourceHit: rect && describe(picked?.point || { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }), destHit: describe(dest),
        canvases: [...document.querySelectorAll('canvas')].map(canvas => { const r = canvas.getBoundingClientRect(), s = getComputedStyle(canvas); return { className: canvas.className, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, pointerEvents: s.pointerEvents, zIndex: s.zIndex }; }) };
    }, { uid: piece.uid, row: tile[0], col: tile[1] });
    if (geometry?.rect && geometry?.dest) {
      await page.evaluate(() => {
        globalThis.__resonanceDragEvents = [];
        const v = globalThis.__SP_VIEW__;
        for (const name of ['pieceDragStart', 'pieceDrop', 'pieceDragEnd']) v?.on?.(name, event => {
          globalThis.__resonanceDragEvents.push({ name, uid: event?.uid, from: event?.from, target: event?.target, dropped: event?.dropped });
        });
      });
      await page.mouse.move(geometry.source.x, geometry.source.y);
      await page.mouse.down(); await page.mouse.move(geometry.dest.x, geometry.dest.y, { steps: 8 }); await page.mouse.up();
      const wheel = await page.waitForSelector('.fwheel[role="dialog"]', { timeout: 8_000 }).catch(() => null);
      let wheelOpened = !!wheel, deployMethod = wheel ? 'facing-wheel' : 'pointer-drop';
      let facingGeometry = null, dragEvents = await page.evaluate(() => globalThis.__resonanceDragEvents || []);
      if (wheel) {
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.querySelector('.fwheel[role="dialog"]')?.classList.contains('is-right'), { timeout: 5_000 });
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !document.querySelector('.fwheel[role="dialog"]'), { timeout: 10_000 });
      }
      let authoritative = await stateOf(page, sessionId);
      if (wheelOpened) {
        try {
          authoritative = await waitState(page, sessionId, (next) => {
            const candidate = next.pieces.find((entry) => entry.uid === piece.uid);
            return next.revision > beforeDragRevision && candidate?.row === tile[0] && candidate?.col === tile[1] && candidate?.dir === 'RIGHT';
          }, 10_000);
        } catch (error) {
          authoritative = await stateOf(page, sessionId);
          const current = authoritative.pieces.find((candidate) => candidate.uid === piece.uid);
          if (current?.row == null || current.row !== tile[0] || current.col !== tile[1] || current.dir !== 'RIGHT') {
            return { fieldKind, rendererVisible, view, deployed: false, directions: [], failure: `wheel closed but deploy was not confirmed by session: ${error.message}`,
              target: tile, beforeRevision: beforeDragRevision, authoritative: { revision: authoritative.revision, piece: current }, dragGeometry: geometry, dragEvents };
          }
        }
      }
      let placed = authoritative.pieces.find((candidate) => candidate.uid === piece.uid);
      if (!wheelOpened || !placed || placed.row == null) return { fieldKind, rendererVisible, view, deployed: false, directions: [],
        failure: !wheelOpened ? 'pointer drag did not open the FacingWheel' : 'wheel commit did not update authoritative row/col',
        target: tile, beforeRevision: beforeDragRevision, authoritative: { revision: authoritative.revision, piece: placed }, dragGeometry: geometry, dragEvents };
      const directions = [];
      const openWheelOnFreeTile = async () => {
        const viewUid = Number(String(piece.uid).replace(/^\D+/, ''));
        const liveState = await stateOf(page, sessionId);
        const current = liveState.pieces.find((candidate) => candidate.uid === piece.uid);
        const occupied = new Set(liveState.pieces.filter((candidate) => candidate.uid !== piece.uid && candidate.row != null)
          .map((candidate) => `${candidate.row},${candidate.col}`));
        const targetKey = (current?.legalTiles || []).find((key) => key !== `${current.row},${current.col}` && !occupied.has(key));
        assert(targetKey, `no second legal empty tile is available to verify facing for ${piece.uid}`);
        const [targetRow, targetCol] = targetKey.split(',').map(Number);
        await page.waitForFunction(({ row, col, targetRow, targetCol, uid }) => {
          const view = globalThis.__SP_VIEW__, source = view?.tileScreen(row, col), dest = view?.tileScreen(targetRow, targetCol);
          const hit = source && view?.pieceAtClient?.(source.x, source.y);
          if (!source || !dest || hit?.uid !== uid || hit?.area !== 'board'
            || source.x < 0 || source.x >= innerWidth || source.y < 0 || source.y >= innerHeight
            || dest.x < 0 || dest.x >= innerWidth || dest.y < 0 || dest.y >= innerHeight) {
            window.__resonanceStableWheelGeometry = null; return false;
          }
          const target = document.elementFromPoint(dest.x, dest.y);
          if (!target || target.tagName !== 'CANVAS') { window.__resonanceStableWheelGeometry = null; return false; }
          const current = [Math.round(source.x), Math.round(source.y), Math.round(dest.x), Math.round(dest.y), Math.round(innerWidth), Math.round(innerHeight)];
          const previous = window.__resonanceStableWheelGeometry;
          const count = previous && previous.value.every((value, index) => value === current[index]) ? previous.count + 1 : 1;
          window.__resonanceStableWheelGeometry = { value: current, count };
          return count >= 3;
        }, { polling: 'raf', timeout: 10_000 }, { row: current.row, col: current.col, targetRow, targetCol, uid: viewUid });
        const geometry = await page.evaluate(({ row, col, targetRow, targetCol }) => {
          const view = globalThis.__SP_VIEW__;
          const source = view?.tileScreen(row, col), dest = view?.tileScreen(targetRow, targetCol);
          return { source, dest, picked: source && view?.pieceAtClient?.(source.x, source.y), targetPick: dest && view?.pieceAtClient?.(dest.x, dest.y),
            hit: dest && (() => { const el = document.elementFromPoint(dest.x, dest.y); return el ? { tag: el.tagName, cls: String(el.className?.baseVal ?? el.className ?? ''), pointerEvents: getComputedStyle(el).pointerEvents } : null; })() };
        }, { row: current.row, col: current.col, targetRow, targetCol });
        assert(geometry.source && geometry.dest && geometry.picked?.uid === viewUid && geometry.picked?.area === 'board'
          && (!geometry.targetPick || geometry.targetPick.uid !== viewUid), `exact field hit geometry is not ready for ${piece.uid}: ${JSON.stringify(geometry)}`);
        const priorEvents = await page.evaluate(({ x, y }) => {
          const view = globalThis.__SP_VIEW__;
          globalThis.__resonanceWheelEvents ||= [];
          for (const name of ['pieceDragStart', 'pieceDrop', 'pieceDragEnd']) view?.on?.(name, event => {
            globalThis.__resonanceWheelEvents.push({ name, uid: event?.uid, from: event?.from, target: event?.target, dropped: event?.dropped });
          });
          return { eventCount: globalThis.__resonanceWheelEvents.length };
        }, { x: geometry.source.x, y: geometry.source.y });
        await page.mouse.move(geometry.source.x, geometry.source.y); await page.mouse.down();
        await page.mouse.move(geometry.dest.x, geometry.dest.y, { steps: 8 }); await page.mouse.up();
        const nextWheel = await page.waitForSelector('.fwheel[role="dialog"]', { timeout: 5_000 }).catch(() => null);
        const observed = await page.evaluate((start) => (globalThis.__resonanceWheelEvents || []).slice(start), priorEvents.eventCount);
        assert(nextWheel && observed.some((event) => event.name === 'pieceDrop' && event.uid === viewUid && event.target?.row === targetRow && event.target?.col === targetCol),
          `dragging ${piece.uid} to a free legal tile did not open FacingWheel: ${JSON.stringify({ geometry, targetRow, targetCol, events: observed })}`);
        return { row: targetRow, col: targetCol };
      };
      for (const dir of ['UP', 'RIGHT', 'DOWN', 'LEFT']) {
        if (placed?.dir !== dir) {
          const target = await openWheelOnFreeTile();
          await page.keyboard.press(`Arrow${dir[0]}${dir.slice(1).toLowerCase()}`);
          await page.waitForFunction((d) => document.querySelector('.fwheel[role="dialog"]')?.classList.contains(`is-${d.toLowerCase()}`), { timeout: 5_000 }, dir);
          const priorRevision = authoritative.revision, priorRow = target.row, priorCol = target.col;
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => !document.querySelector('.fwheel[role="dialog"]'), { timeout: 10_000 });
          authoritative = await waitState(page, sessionId, next => {
            const candidate = next.pieces.find(entry => entry.uid === piece.uid);
            return next.revision > priorRevision && candidate?.row === priorRow && candidate?.col === priorCol && candidate?.dir === dir;
          }, 10_000);
          placed = authoritative.pieces.find(candidate => candidate.uid === piece.uid);
          directions.push(dir);
        }
      }
      return { fieldKind, rendererVisible, view, deployed: placed?.row != null && placed?.legalTiles?.includes(`${placed.row},${placed.col}`),
        initialTile: tile, row: placed?.row, col: placed?.col, dir: placed?.dir, directions,
        deployMethod, wheelOpened, dragGeometry: geometry, facingGeometry, dragEvents };
    }
  }
  if (view?.kind === 'engine') return { fieldKind, rendererVisible, view, deployed: false, directions: [],
    failure: 'native view supplied no exact UID hit point for pointer drag; do not substitute card-click deployment' };
  if (usableUnits.length) {
    // The explicit unit card is part of the real UI; its first legal cell deploys it.
    const piece = usableUnits[0];
    const sessionId = new URL(page.url()).searchParams.get('session');
    const beforeDeploy = await stateOf(page, sessionId), beforeRevision = beforeDeploy.revision;
    const cardButton = await page.$(`#member-${encodeURIComponent(piece.uid)} > button`);
    if (!cardButton) return { fieldKind, rendererVisible, view, deployed: false, directions: [], failure: 'selected member card has no deploy control' };
    await cardButton.click();
    let deployed = await waitState(page, sessionId, next => {
      const candidate = next.pieces.find(entry => entry.uid === piece.uid);
      return next.revision > beforeRevision && candidate?.row != null && candidate?.col != null;
    }, 10_000).catch(() => stateOf(page, sessionId));
    let placed = deployed.pieces.find((candidate) => candidate.uid === piece.uid);
    if (placed?.row == null) return { fieldKind, rendererVisible, view, deployed: false, directions: [], failure: 'deploy click did not change authoritative row/col' };
    const directions = [];
    const card = await page.$(`#member-${encodeURIComponent(piece.uid)}`);
    const facing = (await card?.$$('select') || []).at(-1);
    const commitDirection = async (dir, count = true) => {
      if (!facing || placed?.dir === dir) return;
      const priorRevision = deployed.revision, priorRow = placed.row, priorCol = placed.col;
      await selectOption(facing, dir);
      deployed = await waitState(page, sessionId, next => {
        const current = next.pieces.find(candidate => candidate.uid === piece.uid);
        return next.revision > priorRevision && current?.row === priorRow && current?.col === priorCol && current?.dir === dir;
      }, 10_000).catch(() => stateOf(page, sessionId));
      placed = deployed.pieces.find(candidate => candidate.uid === piece.uid);
      if (count && deployed.revision > priorRevision && placed?.row === priorRow && placed?.col === priorCol && placed?.dir === dir) directions.push(dir);
    };
    await commitDirection(placed.dir === 'LEFT' ? 'RIGHT' : 'LEFT', false);
    for (const dir of ['UP', 'RIGHT', 'DOWN', 'LEFT']) {
      if (facing && await facing.$(`option[value="${dir}"]`)) await commitDirection(dir);
    }
    return { fieldKind, rendererVisible, view, deployed: placed?.row != null, row: placed?.row, col: placed?.col, dir: placed?.dir, directions };
  }
  return { fieldKind, rendererVisible, view, deployed: false, directions: [] };
}

async function runUiInteractionCheck(sessionId, { fresh = false } = {}) {
  assert(fresh || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId || ''), '--check-ui-interactions requires an existing session UUID');
  const canonicalData = loadData(path.join(CANONICAL_ROOT, 'data'), { log: { warn() {}, error() {} } });
  server = await startChromeSafeLocalServer({ host: '127.0.0.1', quiet: true, installDir: CANONICAL_ROOT,
    dataDir: path.join(CANONICAL_ROOT, 'data'), independentDirectory: path.join(VERIFY_ROOT, 'independent-sessions'),
    resonanceDirectory: SESSION_DIR, recordingDirectory: path.join(VERIFY_ROOT, 'recordings') });
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, dumpio: process.env.RESONANCE_CHROME_DUMPIO === '1', userDataDir: PROFILE_DIR, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--window-size=1440,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await browser.defaultBrowserContext().overridePermissions(server.url, ['clipboard-read', 'clipboard-write']);
  const url = entryUrl(server, { session: sessionId });
  const evidence = { sessionId, url, actions: [] };
  try {
    if (fresh) {
      await page.goto(entryUrl(server), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('.rs-start__setup', { timeout: 30_000 });
      const created = await startViaUi(page, { difficulty: 'NORMAL' });
      sessionId = created.id; evidence.sessionId = sessionId; evidence.url = entryUrl(server, { session: sessionId });
    } else await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitGame(page);
    for (const sectionId of ['field', 'shop', 'equipment']) {
      evidence.actions.push({ kind: 'section-deep-link', ...await verifySectionDeepLink(page, sectionId, sessionId) });
    }
    evidence.actions.push({ kind: 'section-deep-link', ...await verifySectionDeepLink(page, 'field', sessionId), finalBeforeDrag: true });
    let initial = await stateOf(page, sessionId);
    if (!initial.pieces.some(piece => piece.row == null)) {
      const piece = initial.pieces.find(candidate => candidate.row != null);
      const card = await page.$(`#member-${encodeURIComponent(piece.uid)}`);
      const buttons = await card?.$$('button') || [];
      let withdraw = null;
      for (const button of buttons) if ((await textOf(button)).includes('撤回')) { withdraw = button; break; }
      assert(withdraw, 'no authoritative UI withdraw control to prepare a deployment check');
      const priorRevision = initial.revision;
      await withdraw.click();
      initial = await waitState(page, sessionId, next => next.revision > priorRevision && next.pieces.find(candidate => candidate.uid === piece.uid)?.row == null);
      evidence.actions.push({ kind: 'prepare-bench', pieceUid: piece.uid, revision: initial.revision });
    }
    const field = await chooseNativeFieldAction(page, initial);
    const afterField = await stateOf(page, sessionId);
    evidence.actions.push({ kind: 'deploy-and-turns', fieldKind: field.fieldKind, reported: field,
      deployedCount: afterField.deployedCount, revision: afterField.revision,
      changedPiece: field.row == null ? null : afterField.pieces.find(piece => piece.row === field.row && piece.col === field.col) });
    assert(field.deployed && field.directions.join(',') === 'UP,RIGHT,DOWN,LEFT', 'deploy/facing UI did not produce all four authoritative direction commits');
    await capture(page, fresh ? 'fresh-ui-field-wheelfour.png' : 'ui-interaction-field-wheelfour.png', '真实拖放部署和四向朝向提交');

    const fallback = await browser.newPage();
    await fallback.setViewport({ width: 1000, height: 700, deviceScaleFactor: 1 });
    try {
      await fallback.goto(entryUrl(server, { render: 'fallback', session: sessionId }), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitGame(fallback);
      let fallbackState = await stateOf(fallback, sessionId);
      const deployed = fallbackState.pieces.find(piece => piece.row != null);
      assert(deployed, 'fallback view has no deployed piece to turn');
      const dir = deployed.dir === 'UP' ? 'RIGHT' : 'UP';
      const card = await fallback.$(`#member-${encodeURIComponent(deployed.uid)}`);
      const facing = (await card?.$$('select') || []).at(-1);
      assert(facing && await facing.$(`option[value="${dir}"]`), 'fallback facing selector missing');
      const revision = fallbackState.revision;
      await selectOption(facing, dir);
      fallbackState = await waitState(fallback, sessionId, next => {
        const current = next.pieces.find(piece => piece.uid === deployed.uid);
        return next.revision > revision && current?.dir === dir && current?.row === deployed.row && current?.col === deployed.col;
      });
      evidence.actions.push({ kind: 'fallback-turn', pieceUid: deployed.uid, dir, row: fallbackState.pieces.find(piece => piece.uid === deployed.uid).row,
        col: fallbackState.pieces.find(piece => piece.uid === deployed.uid).col, revision: fallbackState.revision });
    } finally { await fallback.close(); }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitGame(page);
    evidence.actions.push({ kind: 'section-deep-link', ...await verifySectionDeepLink(page, 'shop', sessionId), beforeShopActions: true });
    const beforeLock = await stateOf(page, sessionId);
    assert(await clickEnabled(page, '#rs-section-shop button', '锁定'), 'shop lock button is not clickable');
    const locked = await waitState(page, sessionId, next => next.shop.locked && next.revision > beforeLock.revision);
    evidence.actions.push({ kind: 'shop-lock', locked: locked.shop.locked, revision: locked.revision,
      beforeRevision: beforeLock.revision, buttonText: '锁定' });
    await clickText(page, '#rs-section-shop button', '解锁');
    const unlocked = await waitState(page, sessionId, next => !next.shop.locked && next.revision > locked.revision);
    evidence.actions.push({ kind: 'shop-unlock', locked: unlocked.shop.locked, revision: unlocked.revision });
    assert(field.wheelOpened === true && field.deployMethod === 'facing-wheel',
      'pointer drag did not open the FacingWheel; card-button deployment is not evidence for the wheel path');
    return { status: 'passed', ...evidence };
  } catch (error) {
    await page.evaluate(() => window.getSelection?.()?.removeAllRanges?.()).catch(() => {});
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    const screenshot = path.join(SCREENSHOT_DIR, fresh ? 'fresh-ui-interaction-failure.png' : 'ui-interaction-failure.png');
    await page.screenshot({ path: screenshot, fullPage: true, captureBeyondViewport: true }).catch(() => {});
    return { status: 'failed', ...evidence, error: error.stack || error.message, screenshot };
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }
}

async function runLateShopCheck(sessionId) {
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId || ''), '--check-late-shop requires an existing session UUID');
  server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, installDir: CANONICAL_ROOT,
    dataDir: path.join(CANONICAL_ROOT, 'data'), independentDirectory: path.join(VERIFY_ROOT, 'independent-sessions'),
    resonanceDirectory: SESSION_DIR, recordingDirectory: path.join(VERIFY_ROOT, 'recordings') });
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, userDataDir: PROFILE_DIR, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--window-size=1440,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await browser.defaultBrowserContext().overridePermissions(server.url, ['clipboard-read', 'clipboard-write']);
  const url = entryUrl(server, { session: sessionId });
  const evidence = { sessionId, url, actions: [] };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitGame(page);
    let before = await stateOf(page, sessionId);
    assert(before.phase === 'prep' && before.gold >= (before.actionCosts?.refreshGold ?? 2),
      `existing SID is not at an affordable prep shop: ${JSON.stringify({ phase: before.phase, gold: before.gold, revision: before.revision })}`);
    evidence.actions.push({ kind: 'initial-authority', phase: before.phase, round: before.round, gold: before.gold, revision: before.revision,
      resultPanelVisible: !!await page.$('.rs-result') });
    evidence.actions.push({ kind: 'shop-deep-link', ...await verifySectionDeepLink(page, 'shop', sessionId) });
    await page.waitForFunction(() => {
      const shop = document.querySelector('#rs-section-shop');
      const refresh = [...(shop?.querySelectorAll('button') || [])].find(button => (button.innerText || '').includes('刷新'));
      if (!shop || !refresh) return false;
      const r = refresh.getBoundingClientRect(), s = getComputedStyle(refresh);
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    }, { timeout: 10_000 });
    before = await stateOf(page, sessionId);
    const buttonEvidence = await page.$eval('#rs-section-shop button', (first) => {
      const shop = document.querySelector('#rs-section-shop');
      const button = [...(shop?.querySelectorAll('button') || [])].find(el => (el.innerText || '').includes('刷新'));
      if (!button) return null;
      const r = button.getBoundingClientRect(), top = document.elementFromPoint(Math.max(0, r.left + r.width / 2), Math.max(0, r.top + r.height / 2));
      return { text: button.innerText.trim(), disabled: button.disabled, viewport: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, hitTarget: top?.tagName || null };
    });
    assert(buttonEvidence, 'shop section has no current refresh button after deep link');
    const clicked = await clickEnabled(page, '#rs-section-shop button', '刷新');
    assert(clicked, `refresh button was not currently clickable: ${JSON.stringify(buttonEvidence)}`);
    const after = await waitState(page, sessionId, next => next.revision > before.revision && next.gold < before.gold);
    evidence.actions.push({ kind: 'official-refresh', before: { gold: before.gold, revision: before.revision }, after: { gold: after.gold, revision: after.revision,
      offerCount: after.shop.offers.length }, buttonEvidence });
    return { status: 'passed', ...evidence };
  } catch (error) {
    await page.evaluate(() => window.getSelection?.()?.removeAllRanges?.()).catch(() => {});
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    const screenshot = path.join(SCREENSHOT_DIR, 'late-shop-failure.png');
    await page.screenshot({ path: screenshot, fullPage: true, captureBeyondViewport: true }).catch(() => {});
    return { status: 'failed', ...evidence, error: error.stack || error.message, screenshot };
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }
}

function priorBrowserReceipt() {
  return JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
}
async function appendFollowupEvidence(kind, evidence) {
  const receipt = priorBrowserReceipt();
  receipt.followupEvidence ??= [];
  receipt.followupEvidence.push({ createdAt: new Date().toISOString(), kind, nativeSource: nativeSourceState(), evidence });
  await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return RECEIPT_PATH;
}
const CHROME_BLOCKED_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 138, 139, 143, 161, 179, 389, 427, 465, 512, 513,
  514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
async function startChromeSafeLocalServer(options) {
  let instance = await startServer({ ...options, port: 0 });
  let candidate = Number(new URL(instance.url).port);
  for (let attempt = 0; CHROME_BLOCKED_PORTS.has(candidate) && attempt < 24; attempt++) {
    await instance.close().catch(() => {});
    candidate++;
    try { instance = await startServer({ ...options, port: candidate }); }
    catch (error) {
      if (!/EADDRINUSE|address already in use/i.test(error.message || '')) throw error;
      candidate++;
      instance = await startServer({ ...options, port: candidate });
    }
  }
  if (CHROME_BLOCKED_PORTS.has(Number(new URL(instance.url).port))) {
    await instance.close().catch(() => {});
    throw new Error(`could not allocate a Chrome-allowed local port after ${candidate}`);
  }
  return instance;
}
async function startNarrowBrowser({ fixture = false } = {}) {
  const canonicalData = loadData(path.join(CANONICAL_ROOT, 'data'), { log: { warn() {}, error() {} } });
  server = await startChromeSafeLocalServer({ host: '127.0.0.1', quiet: true, installDir: CANONICAL_ROOT,
    dataDir: path.join(CANONICAL_ROOT, 'data'), independentDirectory: path.join(VERIFY_ROOT, 'independent-sessions'),
    resonanceDirectory: SESSION_DIR, recordingDirectory: path.join(VERIFY_ROOT, 'recordings') });
  if (fixture) fixtureServer = await startChromeSafeLocalServer({ host: '127.0.0.1', quiet: true, installDir: CANONICAL_ROOT,
    dataDir: path.join(CANONICAL_ROOT, 'data'), independentDirectory: path.join(VERIFY_ROOT, 'fixture-independent-sessions'),
    resonanceDirectory: FIXTURE_SESSION_DIR, recordingDirectory: FIXTURE_RECORDING_DIR });
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, userDataDir: PROFILE_DIR, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--window-size=1440,1000'] });
  await browser.defaultBrowserContext().overridePermissions(server.url, ['clipboard-read', 'clipboard-write']);
  if (fixtureServer) await browser.defaultBrowserContext().overridePermissions(fixtureServer.url, ['clipboard-read', 'clipboard-write']);
  return { data: canonicalData, server, fixtureServer, browser };
}
async function runFixtureFollowupChecks({ componentOnly = false, pairOnly = false } = {}) {
  const old = priorBrowserReceipt();
  const fixtures = old.fixtureSessions || [];
  const interactive = fixtures.find((fixture) => fixture.label === 'copy/equipment/summon');
  const pairFixture = fixtures.find((fixture) => fixture.label === 'adjacent-pair-strategy');
  assert(interactive && pairFixture && interactive.id !== pairFixture.id, 'existing receipt lacks the two isolated fixture sessions');
  const { data } = await startNarrowBrowser({ fixture: true });
  const evidence = { componentLinks: [], pairStrategy: null };
  try {
    const hardDeadline = new Promise((_, reject) => { timeoutHandle = setTimeout(() => {
      void browser?.close().catch(() => {}); void server?.close().catch(() => {});
      reject(new Error('fixture followup check exceeded 5-minute deadline'));
    }, 5 * 60 * 1000); });
    const work = (async () => {
      if (!pairOnly) {
      const page = await openSessionPage(browser, fixtureServer, interactive.id);
      try {
        let initial = await stateOf(page, interactive.id);
        let item = initial.inventory.find((candidate) => candidate.itemId)
          || initial.pieces.flatMap((piece) => piece.equipment || []).find((candidate) => candidate.itemId);
        assert(item, 'existing copy/equipment fixture has no live equipment component');
        const verifyItemLink = async (kind, uid) => {
          const targetId = `${kind}-${uid}`;
          const source = await page.$(`#${targetId}`);
          assert(source, `current session does not render live ${kind} target ${uid}`);
          await source.evaluate((el) => el.scrollIntoView({ block: 'center' }));
          const copy = await source.$('.rs-copy');
          assert(copy, `live ${kind} target ${uid} has no copy-link control`);
          await copy.click();
          const copied = await page.evaluate(() => navigator.clipboard.readText());
          const url = new URL(copied), parsed = detailHashParts(url);
          assert(url.searchParams.get('session') === interactive.id && parsed.kind === kind && parsed.id === uid,
            `copy control for ${targetId} returned a stale/different target: ${url.href}`);
          await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await waitGame(page);
          await page.waitForFunction((id) => Boolean(document.getElementById(id)), { timeout: 15_000 }, targetId);
          const resolved = await stateOf(page, interactive.id);
          assert(kind === 'inventory' ? resolved.inventory.some((entry) => entry.uid === uid)
            : resolved.pieces.some((piece) => piece.equipment?.some((entry) => entry.uid === uid)),
          `link resolved to a DOM target without the corresponding live authoritative ${kind} item ${uid}`);
          evidence.componentLinks.push({ kind, uid, sessionId: interactive.id, href: url.href, resolvedFromCurrentLiveComponent: true });
        };
        if (initial.inventory.some((candidate) => candidate.uid === item.uid)) {
          await verifyItemLink('inventory', item.uid);
        } else {
          await verifyItemLink('equipped', item.uid);
          const card = await page.$(`#equipped-${item.uid}`);
          let unequipButton = null;
          for (const button of await (card?.$$('button') || [])) if ((await textOf(button)).includes('卸下')) { unequipButton = button; break; }
          assert(card && unequipButton, `equipped item ${item.uid} has no real unequip control`);
          await unequipButton.click();
          initial = await waitState(page, interactive.id, (next) => next.inventory.some((candidate) => candidate.uid === item.uid));
          assert(initial.pieces.every((piece) => !piece.equipment.some((entry) => entry.uid === item.uid)), 'official unequip duplicated the item instead of moving it to inventory');
          await page.goto(entryUrl(fixtureServer, { session: interactive.id }), { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await waitGame(page);
          await verifyItemLink('inventory', item.uid);
        }
        await page.goto(entryUrl(fixtureServer, { session: interactive.id }), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await waitGame(page);
        const owner = (await stateOf(page, interactive.id)).pieces[0];
        const equipSelect = await page.$(`#inventory-${item.uid} select[aria-label="装备给谁"]`);
        assert(equipSelect && owner, 'fixture has no real equipment owner selector');
        await selectOption(equipSelect, owner.uid);
        await waitState(page, interactive.id, (next) => next.pieces.find((piece) => piece.uid === owner.uid)?.equipment.some((entry) => entry.uid === item.uid));
        await page.goto(entryUrl(fixtureServer, { session: interactive.id }), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await waitGame(page);
        await verifyItemLink('equipped', item.uid);
      } finally { await page.close(); }
      }

      if (!componentOnly) {
       const pairPage = await openSessionPage(browser, fixtureServer, pairFixture.id);
       try {
        const pairActionResponses = [];
        pairPage.on('response', async (response) => {
          if (!/\/resonance\/api\/sessions\/[^/]+\/actions(?:\?|$)/.test(response.url())) return;
          let body = null;
          try { body = await response.json(); } catch {}
          pairActionResponses.push({ status: response.status(), body });
        });
        const state = await stateOf(pairPage, pairFixture.id);
        const choice = state.pendingChoices?.find((entry) => entry.type === 'strategy');
        const strategyId = pairFixture.strategyId || choice?.options?.find((id) => {
          const candidate = getResonanceCatalog(data, { environmentId: pairFixture.environmentId, seed: pairFixture.seed }).strategies[id];
          return candidate?.condition?.kind === 'choose_adjacent_pair';
        });
        assert(choice && strategyId && choice.options.includes(strategyId), 'existing pair fixture does not expose the chosen strategy identity');
        const catalog = getResonanceCatalog(data, { environmentId: pairFixture.environmentId, seed: pairFixture.seed });
        const definition = catalog.strategies[strategyId];
        assert(definition?.condition?.kind === 'choose_adjacent_pair' && definition.description, `pair strategy profile missing: ${strategyId}`);
        const section = await pairPage.$(`#choice-${choice.uid}`);
        const description = (await textOf(await section?.$('.rs-choice__option p'))).trim();
        assert(description.includes(definition.description) && description.includes('条件：') && description.includes('时点：'),
          `pair strategy description/condition/timing not rendered: ${strategyId}/${description}`);
        const select = await section.$('select');
        assert(select && (await select.$$('option')).length > 1, 'pair strategy fixture has no legal adjacent pair choice');
        const selected = await select.$eval('option:nth-child(2)', (option) => ({ value: option.value, text: option.innerText }));
        const revision = state.revision;
        await selectOption(select, selected.value);
        await pairPage.waitForFunction(({ choiceUid, value }) => {
          const current = document.querySelector(`#choice-${CSS.escape(choiceUid)}`);
          const currentSelect = current?.querySelector('.rs-choice__option select');
          const currentButton = current?.querySelector('.rs-choice__option > button');
          return currentSelect?.value === value && currentButton && !currentButton.disabled;
        }, { timeout: 10_000 }, { choiceUid: choice.uid, value: selected.value });
        const currentSection = await pairPage.$(`#choice-${choice.uid}`);
        const submit = await currentSection?.$('.rs-choice__option > button');
        assert(submit && await enabled(submit), 'pair strategy official submit remained disabled after selected target rendered');
        const clickDetails = await submit.evaluate((el) => {
          const rect = el.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, hit = document.elementFromPoint(x, y);
          return { text: el.innerText, disabled: el.disabled, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            hitTag: hit?.tagName, hitText: hit?.innerText?.slice(0, 120), selectValue: el.closest('.rs-choice__option')?.querySelector('select')?.value || null };
        });
        const pairRequests = [];
        pairPage.on('request', (request) => { if (request.method() === 'POST') pairRequests.push({ url: request.url(), method: request.method() }); });
        const clicked = await clickEnabled(pairPage, `#choice-${choice.uid} .rs-choice__option > button`, definition.name);
        if (!clicked) {
          await capture(pairPage, 'pair-strategy-click-failure.png', '双人策略提交按钮未能通过中心点击');
          throw new Error(`normal center click was not possible: ${JSON.stringify(clickDetails)}`);
        }
        let after;
        try {
          after = await waitState(pairPage, pairFixture.id, (next) => next.revision > revision
            && next.strategies?.some((entry) => (typeof entry === 'string' ? entry : entry.id) === strategyId));
        } catch (error) {
          const latest = await stateOf(pairPage, pairFixture.id).catch(() => null);
          throw new Error(`${error.message}; clickDetails=${JSON.stringify(clickDetails)}; pairRequests=${JSON.stringify(pairRequests)}; pairActionResponses=${JSON.stringify(pairActionResponses)}; latest=${JSON.stringify(latest && {
            revision: latest.revision, phase: latest.phase, pendingChoices: latest.pendingChoices, strategies: latest.strategies,
            strategyState: latest.strategyState, pieces: latest.pieces.map((piece) => ({ uid: piece.uid, row: piece.row, col: piece.col }))
          })}`);
        }
        evidence.pairStrategy = { sessionId: pairFixture.id, strategyId, description: definition.description,
          selectedPair: selected.text, revisionBefore: revision, revisionAfter: after.revision, officialActionApplied: true, battleReplayed: false };
       } finally { await pairPage.close(); }
      }
    })();
    await Promise.race([work, hardDeadline]);
  } finally {
    clearTimeout(timeoutHandle);
    await browser?.close().catch(() => {}); await server?.close().catch(() => {}); await fixtureServer?.close().catch(() => {});
  }
  const kind = pairOnly ? 'adjacent-pair-strategy-choice' : componentOnly ? 'live-inventory-equipped-links' : 'fixture-copy-strategy';
  const fixtureIds = componentOnly ? [interactive.id] : pairOnly ? [pairFixture.id] : [interactive.id, pairFixture.id];
  const receipt = await appendFollowupEvidence(kind, { fixtureIds, stories: evidence });
  return { status: pairOnly ? evidence.pairStrategy?.officialActionApplied ? 'passed' : 'failed'
    : evidence.componentLinks.length === 2 && (componentOnly || evidence.pairStrategy?.officialActionApplied) ? 'passed' : 'failed', receipt, fixtureIds, stories: evidence };
}
async function runInteractiveFixtureCheck(sessionOverride = null) {
  const old = priorBrowserReceipt();
  const fixtureRow = (old.fixtureSessions || []).find((fixture) => fixture.label === 'copy/equipment/summon');
  assert(fixtureRow?.id, 'existing receipt lacks the copy/equipment/summon fixture');
  const fixtureId = sessionOverride || fixtureRow.id;
  const runtimeState = JSON.parse(readFileSync(path.join(FIXTURE_SESSION_DIR, `${fixtureId}.json`), 'utf8'));
  assert(runtimeState.phase === 'prep' && runtimeState.round === 1, `interactive fixture is not an unfinished round-1 prep state: ${fixtureId}/${runtimeState.phase}/${runtimeState.round}`);
  const data = loadData(path.join(CANONICAL_ROOT, 'data'), { log: { warn() {}, error() {} } });
  const catalog = getResonanceCatalog(data, { environmentId: runtimeState.environmentId, seed: runtimeState.seed });
  const fixture = { ...fixtureRow, id: fixtureId, environmentId: runtimeState.environmentId, seed: runtimeState.seed, catalog };
  await startNarrowBrowser({ fixture: true });
  const deadline = new Promise((_, reject) => { timeoutHandle = setTimeout(() => {
    void browser?.close().catch(() => {}); void server?.close().catch(() => {}); void fixtureServer?.close().catch(() => {});
    reject(new Error('interactive fixture followup exceeded 5-minute deadline'));
  }, 5 * 60 * 1000); });
  try {
    await Promise.race([exerciseFixtureInteractions(browser, fixtureServer, fixture), deadline]);
    const page = await openSessionPage(browser, fixtureServer, fixture.id);
    let finalState;
    try { finalState = await stateOf(page, fixture.id); } finally { await page.close(); }
    const storyNames = ['equip-unequip-combine-recycle', 'copy-selector', 'summon-order-and-clear', 'fixture-copy-summon-real-battle'];
    const storyEvidence = storyNames.map((name) => ({ name, ...results.get(name) }));
    assert(finalState.phase === 'complete' && finalState.terminalReason, 'interactive fixture did not persist an authoritative terminal state');
    const evidence = { fixtureId: fixture.id, revision: finalState.revision, phase: finalState.phase, round: finalState.round,
      terminalReason: finalState.terminalReason, pieces: finalState.pieces.map((piece) => ({ uid: piece.uid, operatorId: piece.operatorId,
        star: piece.star, row: piece.row, col: piece.col, equipment: piece.equipment.map((entry) => entry.itemId) })),
      inventoryCount: finalState.inventory.length, remainingConsumables: finalState.consumables.map((entry) => entry.kind), stories: storyEvidence,
      battleReplayed: true, fixtureOnly: true };
    const receipt = await appendFollowupEvidence('equipment-copy-summon-real-battle', evidence);
    return { status: storyEvidence.every((entry) => entry.status === 'passed') ? 'passed' : 'failed', receipt, evidence };
  } finally {
    clearTimeout(timeoutHandle);
    await browser?.close().catch(() => {}); await server?.close().catch(() => {}); await fixtureServer?.close().catch(() => {});
  }
}
async function runSummonFixtureCheck(sessionId) {
  assert(sessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId), 'summon fixture check requires an existing session UUID');
  const runtimeState = JSON.parse(readFileSync(path.join(FIXTURE_SESSION_DIR, `${sessionId}.json`), 'utf8'));
  assert(runtimeState.phase === 'prep' && runtimeState.round > 1
    && !(runtimeState.history || []).some((event) => event.type === 'fight-settled' && event.round === runtimeState.round),
  `summon fixture must be at a new, unfinished prep node after preserved prior attempts: ${sessionId}/${runtimeState.phase}/${runtimeState.round}`);
  const old = priorBrowserReceipt();
  const metadata = (old.fixtureSessions || []).find((fixture) => fixture.label === 'copy/equipment/summon');
  assert(metadata?.summonOwnerId && metadata?.summonTokenId, 'receipt lacks native summon fixture identity');
  let page = null;
  const attemptEvidence = { fixtureId: sessionId, priorRound: runtimeState.round, stage: 'launch', actionResponses: [], battleExecutedOnce: false };
  const deadline = new Promise((_, reject) => { timeoutHandle = setTimeout(() => {
    void page?.close().catch(() => {}); void browser?.close().catch(() => {});
    void server?.close().catch(() => {}); void fixtureServer?.close().catch(() => {});
    reject(new Error('summon fixture check exceeded 5-minute deadline'));
  }, 5 * 60 * 1000); });
  try {
    const work = (async () => {
      await startNarrowBrowser({ fixture: true });
      page = await openSessionPage(browser, fixtureServer, sessionId);
      const actionResponses = [];
      attemptEvidence.stage = 'opened-session';
      attemptEvidence.actionResponses = actionResponses;
      page.on('response', async (response) => {
        if (!/\/resonance\/api\/sessions\/[^/]+\/actions(?:\?|$)/.test(response.url())) return;
        let body = null;
        try { body = await response.json(); } catch {}
        actionResponses.push({ status: response.status(), url: response.url(), body });
      });
      let state = await stateOf(page, sessionId);
      const owner = state.pieces.find((piece) => piece.operatorId === metadata.summonOwnerId && piece.row != null);
      assert(owner, 'official session DTO has no deployed summon owner');
      const ownerToken = owner.operator?.summons?.find((entry) => entry.id === metadata.summonTokenId);
      assert(ownerToken?.name, `official DTO has no native summon name for ${metadata.summonTokenId}`);
      const dtoCells = owner.summonLegalTiles?.[metadata.summonTokenId] || [];
      assert(dtoCells.length > 0, `official DTO exposes no legal summon cells for ${metadata.summonTokenId}: ${JSON.stringify({
        owner: { uid: owner.uid, row: owner.row, col: owner.col, dir: owner.dir }, allLegalTiles: owner.legalTiles,
        summonLegalTiles: owner.summonLegalTiles, deployed: state.pieces.filter((piece) => piece.row != null).map((piece) => ({ uid: piece.uid, row: piece.row, col: piece.col, dir: piece.dir }))
      })}`);
      const selector = await page.$(`#member-${owner.uid} .rs-summons select`);
      assert(selector, `UI omitted summon selector despite official DTO legal cells: ${JSON.stringify(dtoCells)}`);
      await page.waitForFunction(({ ownerUid, expected }) => {
        const select = document.querySelector(`#member-${CSS.escape(ownerUid)} .rs-summons select`);
        return !!select && expected.every((value) => [...select.options].some((option) => option.value === value));
      }, { timeout: 15_000 }, { ownerUid: owner.uid, expected: dtoCells });
      const choice = dtoCells[0];
      const [row, col] = choice.split(',').map(Number);
      const selectedAt = (piece, token, cellRow, cellCol) => piece?.summonOrders?.some((entry) =>
        (entry.tokenId === token.id || entry.name === token.name) && entry.row === cellRow && entry.col === cellCol);
      const selectedAny = (piece, token) => piece?.summonOrders?.some((entry) => entry.tokenId === token.id || entry.name === token.name);
      const applyUiSelection = async (value, expected, label) => {
        const control = await page.$(`#member-${owner.uid} .rs-summons select`);
        assert(control, `summon selector disappeared before ${label}`);
        await selectOption(control, value);
        await page.waitForFunction(({ ownerUid }) => {
          const select = document.querySelector(`#member-${CSS.escape(ownerUid)} .rs-summons select`);
          return !!select && !select.disabled;
        }, { timeout: 15_000 }, { ownerUid: owner.uid }).catch(() => {});
        try {
          return await waitState(page, sessionId, expected);
        } catch (error) {
          const actual = await stateOf(page, sessionId).catch(() => null);
          const controlValue = await page.$eval(`#member-${owner.uid} .rs-summons select`, (node) => ({ value: node.value, disabled: node.disabled })).catch(() => null);
          throw new Error(`${label} did not reach authoritative state: ${error.message}; control=${JSON.stringify(controlValue)}; latestState=${JSON.stringify({
            revision: actual?.revision, summonOrders: actual?.pieces.find((piece) => piece.uid === owner.uid)?.summonOrders
          })}; actionResponses=${JSON.stringify(actionResponses.slice(-4))}; pageErrors=${JSON.stringify(errors.slice(-8))}`);
        }
      };
      const beforeRevision = state.revision;
      const battleRound = state.round;
      attemptEvidence.ownerUid = owner.uid;
      attemptEvidence.tokenId = metadata.summonTokenId;
      attemptEvidence.legalCellsFromOfficialDto = dtoCells;
      attemptEvidence.battleRound = battleRound;
      state = await applyUiSelection(choice, (next) => next.revision > beforeRevision
        && selectedAt(next.pieces.find((piece) => piece.uid === owner.uid), ownerToken, row, col), 'summon set');
      const afterSet = state.revision;
      state = await applyUiSelection('', (next) => next.revision > afterSet
        && !selectedAny(next.pieces.find((piece) => piece.uid === owner.uid), ownerToken), 'summon clear');
      const afterClear = state.revision;
      state = await applyUiSelection(choice, (next) => next.revision > afterClear
        && selectedAt(next.pieces.find((piece) => piece.uid === owner.uid), ownerToken, row, col), 'summon final set');
      const finalOrderRevision = state.revision;
      attemptEvidence.stage = 'official-set-clear-set-complete';
      attemptEvidence.revisions = { before: beforeRevision, set: afterSet, clear: afterClear, finalSet: finalOrderRevision };
      attemptEvidence.selectedCell = choice;
      passed('summon-order-and-clear', `真实UI选中官方合法格${choice}、清除、再指定；revision ${beforeRevision}→${afterSet}→${afterClear}→${finalOrderRevision}`);
      const battle = await performRealFight(page, sessionId);
      attemptEvidence.battleExecutedOnce = !!battle.ran;
      attemptEvidence.stage = 'battle-settled';
      attemptEvidence.battleDiagnostics = battle.settlement?.diagnostics;
      if (!battle.ran || Number(battle.settlement.diagnostics?.errorCount ?? 0) !== 0) {
        throw new Error(`summon fixture Battle did not complete cleanly: ${JSON.stringify({ ran: battle.ran, diagnostics: battle.settlement?.diagnostics })}`);
      }
      assert(battle.battleRound === battleRound, `summon fixture advanced the unexpected battle round ${battle.battleRound}; expected ${battleRound}`);
      state = await stateOf(page, sessionId);
      const settled = [...(state.history || [])].reverse().find((entry) => entry.type === 'fight-settled' && entry.round === battle.battleRound);
      assert(settled && state.round > battle.battleRound, 'summon fixture has no authoritative settled fight after Battle');
      const anchor = battle.settlement.diagnostics?.summonAnchors?.find((entry) => entry.ownerUid === owner.uid && entry.tokenId === metadata.summonTokenId);
      assert(anchor && anchor.row === row && anchor.col === col, `Battle did not use the final authoritative summon order ${choice}: ${JSON.stringify(battle.settlement.diagnostics?.summonAnchors)}`);
      const spawnedUid = `resonance-summon-${owner.uid}-${metadata.summonTokenId}`;
      const player = Object.values(battle.settlement.result?.perPlayer || {})[0] || {};
      const summonedUnit = player.unitStats?.find((entry) => entry.uid === spawnedUid && entry.kind === 'token');
      assert(summonedUnit, `Battle result has no spawned token unit ${spawnedUid}: ${JSON.stringify(player.unitStats?.filter((entry) => entry.kind === 'token'))}`);
      passed('fixture-copy-summon-real-battle', `隔离夹具真实召唤路径后运行Battle，诊断错误0且结果含指定token；copy action另由${metadata.id}证明`);
      return { fixtureId: sessionId, ownerUid: owner.uid, tokenId: metadata.summonTokenId, legalCellsFromOfficialDto: dtoCells,
        selectedCell: choice, revisionBefore: beforeRevision, revisionAfterFirstSet: afterSet, revisionAfterClear: afterClear,
        revisionAfterFinalSet: finalOrderRevision, battleSummonAnchor: anchor, spawnedUnit: summonedUnit, battleRound: battle.battleRound,
        settled: { round: settled.round, won: settled.won, hpLoss: settled.hpLoss }, nextRound: state.round,
        diagnostics: battle.settlement.diagnostics, actionResponses, battleExecutedOnce: true, priorBattleReplayed: false,
        priorSettledRounds: (runtimeState.history || []).filter((entry) => entry.type === 'fight-settled').map((entry) => entry.round),
        splitFixtureEvidence: { copySessionId: metadata.id, copyActionPreviouslyRecorded: true } };
    })();
    const evidence = await Promise.race([work, deadline]);
    attemptEvidence.status = 'passed';
    attemptEvidence.completed = evidence;
    const receipt = await appendFollowupEvidence('summon-order-clear-and-real-battle', evidence);
    return { status: 'passed', receipt, evidence };
  } catch (error) {
    attemptEvidence.status = 'failed';
    attemptEvidence.error = error.stack || String(error);
    const receipt = await appendFollowupEvidence('summon-order-clear-and-real-battle', attemptEvidence);
    return { status: 'failed', receipt, evidence: attemptEvidence };
  } finally {
    clearTimeout(timeoutHandle);
    await page?.close().catch(() => {}); await browser?.close().catch(() => {});
    await server?.close().catch(() => {}); await fixtureServer?.close().catch(() => {});
  }
}
async function runRobertaR3DefenseCheck(sessionId) {
  assert(sessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId),
    'Roberta R3 check requires the existing fixture session UUID');
  const runtimeState = JSON.parse(readFileSync(path.join(FIXTURE_SESSION_DIR, `${sessionId}.json`), 'utf8'));
  const settledRounds = (runtimeState.history || []).filter((event) => event.type === 'fight-settled').map((event) => event.round);
  const battleRound = Number(runtimeState.round);
  const r3AlreadySettled = settledRounds.includes(3);
  assert(runtimeState.phase === 'prep' && [3,4].includes(battleRound)
    && (battleRound === 3 ? !r3AlreadySettled : r3AlreadySettled && !settledRounds.includes(battleRound)),
    `Roberta check requires unsettled R3, or the immediate R4 follow-up after R3 was already settled: ${sessionId}/${runtimeState.phase}/${battleRound}/${settledRounds}`);
  if (battleRound === 4) {
    const r3Events=(runtimeState.history||[]).filter(event=>event.round===3);
    assert(r3Events.some(event=>event.type==='piece-moved'&&event.uid==='p12'&&event.row===9&&event.col===6)
      && r3Events.some(event=>event.type==='summon-order-set'&&event.pieceUid==='p11'&&event.row===9&&event.col===5)
      && r3Events.some(event=>event.type==='summon-order-cleared'&&event.pieceUid==='p11'),
    'R3 is settled but its recorded UI move/set-clear-set sequence is incomplete; do not replay R3');
  }
  const old = priorBrowserReceipt();
  const fixture = (old.fixtureSessions || []).find((entry) => entry.id === sessionId);
  assert(fixture?.summonOwnerId === 'chess_native_char_484_robrta_a' && fixture?.summonTokenId === 'token_10018_robrta_mach',
    'receipt does not identify the canonical Roberta machine owner/token');
  const attempt = { fixtureId: sessionId, round: battleRound, priorSettledRounds: settledRounds, battleExecutedOnce: false,
    nativeAtLaunch: nativeSourceState(), stage: 'validated-existing-r3-prep', actions: [] };
  let page = null;
  const deadline = new Promise((_, reject) => { timeoutHandle = setTimeout(() => {
    void page?.close().catch(() => {}); void browser?.close().catch(() => {});
    void server?.close().catch(() => {}); void fixtureServer?.close().catch(() => {});
    reject(new Error('Roberta R3 defense check exceeded 5-minute deadline'));
  }, 5 * 60 * 1000); });
  try {
    const work = (async () => {
      const { data } = await startNarrowBrowser({ fixture: true });
      page = await openSessionPage(browser, fixtureServer, sessionId);
      page.on('response', async (response) => {
        if (!/\/resonance\/api\/sessions\/[^/]+\/actions(?:\?|$)/.test(response.url())) return;
        let body = null; try { body = await response.json(); } catch {}
        const state = body?.state;
        attempt.actions.push({ status: response.status(), revision: state?.revision, phase: state?.phase,
          events: (state?.events || []).map((event) => ({ type: event.type, round: event.round, uid: event.uid, pieceUid: event.pieceUid,
            tokenId: event.tokenId, row: event.row, col: event.col, message: event.message })) });
      });
      let state = await stateOf(page, sessionId);
      state = await advancePrepViaUi(page, sessionId);
      assert(state.phase === 'prep' && state.round === battleRound && state.nodeStarted,
        `official UI did not prepare the existing R${battleRound} node: ${state.phase}/${state.round}/${state.nodeStarted}`);
      const owner = state.pieces.find((piece) => piece.operatorId === fixture.summonOwnerId && piece.row != null);
      const frontline = state.pieces.find((piece) => piece.uid === 'p12');
      assert(owner && frontline?.row != null,
        `R3 session lacks deployed Roberta or expected deployed MELEE p12: ${JSON.stringify(state.pieces.map(p=>({uid:p.uid,operatorId:p.operatorId,role:p.operator?.role,position:p.operator?.position,row:p.row,col:p.col})))}`);
      const catalog = getResonanceCatalog(data, { environmentId: state.environmentId, seed: state.seed });
      const canonicalFront = catalog.operators?.[frontline.operatorId];
      assert(canonicalFront?.position === 'MELEE', `canonical catalog does not identify p12 as MELEE: ${JSON.stringify({operatorId:frontline.operatorId,position:canonicalFront?.position})}`);
      const tokenRecord = owner.operator?.summons?.find((token) => token.id === fixture.summonTokenId);
      assert(tokenRecord, 'official owner DTO omitted the Roberta machine summon');
      const field = getResonanceField(state, { data, catalog });
      const tokenDef = field.resolveToken(fixture.summonTokenId, owner.operatorId, catalog.operators[owner.operatorId]?.fixedSkillIndex);
      assert(tokenDef?.rangeGrid?.length, 'native field resolver omitted the machine range definition');
      const summonCells = owner.summonLegalTiles?.[fixture.summonTokenId] || [];
      assert(summonCells.length, 'official DTO exposes no legal Roberta machine summon cells');
      const occupied = new Set(state.pieces.filter((piece) => piece.uid !== frontline.uid && piece.row != null)
        .map((piece) => `${piece.row},${piece.col}`));
      const candidate = { anchorKey:'9,5', targetKey:'9,6', anchor:[9,5], target:[9,6] };
      const rangeKeys = ownerRangeKeys(tokenDef.rangeGrid, ...candidate.anchor, owner.dir || 'RIGHT');
      const candidateChecks = { summonAnchorLegal:summonCells.includes(candidate.anchorKey),
        targetInNativeFacingRange:rangeKeys.has(candidate.targetKey), targetLegal:frontline.legalTiles?.includes(candidate.targetKey),
        targetMelee:canonicalFront.position === 'MELEE', targetUnoccupied:!occupied.has(candidate.targetKey),
        occupantAtTarget:state.pieces.filter((piece)=>piece.row===9&&piece.col===6).map((piece)=>piece.uid) };
      assert(Object.entries(candidateChecks).filter(([key])=>key!=='occupantAtTarget').every(([,value])=>value),
        `official UI state does not validate planned Roberta anchor/target: ${JSON.stringify({candidateChecks,summonCells,frontLegal:frontline.legalTiles,ownerDir:owner.dir,range:tokenDef.rangeGrid})}`);
      attempt.ownerUid = owner.uid;
      attempt.frontlineUid = frontline.uid;
      attempt.frontlineIdentity = { operatorId:frontline.operatorId, role:frontline.operator.role, position:frontline.operator.position };
      attempt.targetPlan = { anchor: candidate.anchor, frontlineTarget: candidate.target, tokenRangeGrid: tokenDef.rangeGrid, direction: owner.dir || 'RIGHT' };
      const moveToTarget = async () => {
        const live = await stateOf(page, sessionId);
        const current = live.pieces.find((piece) => piece.uid === frontline.uid);
        assert(current?.row != null && current.legalTiles?.includes(candidate.targetKey),
          `official DTO no longer permits the selected melee target tile: ${candidate.targetKey}`);
        if (current.row === candidate.target[0] && current.col === candidate.target[1]) return live;
        const canvas = await page.$('.rs-field__canvas');
        assert(canvas, 'native field canvas is missing for R3 placement');
        await canvas.evaluate((el) => el.scrollIntoView({ block:'center', inline:'center', behavior:'instant' }));
        const numericUid = Number(String(frontline.uid).replace(/^\D+/, ''));
        await page.waitForFunction(({ uid, sourceRow, sourceCol, row, col }) => {
          const view=globalThis.__SP_VIEW__, source=view?.tileScreen(sourceRow,sourceCol), dest=view?.tileScreen(row,col);
          const picked=source&&view?.pieceAtClient?.(source.x,source.y);
          const hit=dest&&document.elementFromPoint(dest.x,dest.y);
          if(!source||picked?.uid!==uid||picked?.area!=='board'||!hit||hit.tagName!=='CANVAS'
            ||[source.x,source.y,dest.x,dest.y].some(v=>v<0)||source.x>=innerWidth||source.y>=innerHeight||dest.x>=innerWidth||dest.y>=innerHeight){window.__robertaR3Geometry=null;return false;}
          const value=[source.x,source.y,dest.x,dest.y,innerWidth,innerHeight].map(Math.round),old=window.__robertaR3Geometry;
          const count=old&&old.value.every((v,i)=>v===value[i])?old.count+1:1;window.__robertaR3Geometry={value,count};return count>=3;
        }, { polling:'raf', timeout:10_000 }, { uid:numericUid,sourceRow:frontline.row,sourceCol:frontline.col,row:candidate.target[0],col:candidate.target[1] });
        const geometry=await page.evaluate(({uid,sourceRow,sourceCol,row,col})=>{const v=globalThis.__SP_VIEW__,n=Number(String(uid).replace(/^\D+/,'')),source=v.tileScreen(sourceRow,sourceCol),dest=v.tileScreen(row,col);return {source,dest,sourceHit:source&&v.pieceAtClient(source.x,source.y),targetHit:dest&&document.elementFromPoint(dest.x,dest.y)?.tagName};},{uid:frontline.uid,sourceRow:frontline.row,sourceCol:frontline.col,row:candidate.target[0],col:candidate.target[1]});
        assert(geometry.source && geometry.sourceHit?.uid === numericUid && geometry.targetHit === 'CANVAS',
          `R3 pointer geometry is not authoritative: ${JSON.stringify(geometry)}`);
        await page.evaluate(()=>{globalThis.__robertaR3Events=[];const v=globalThis.__SP_VIEW__;for(const name of ['pieceDragStart','pieceDrop','pieceDragEnd'])v?.on?.(name,e=>globalThis.__robertaR3Events.push({name,uid:e?.uid,target:e?.target,dropped:e?.dropped}));});
        await page.mouse.move(geometry.source.x,geometry.source.y);await page.mouse.down();await page.mouse.move(geometry.dest.x,geometry.dest.y,{steps:8});await page.mouse.up();
        await page.waitForSelector('.fwheel[role="dialog"]',{timeout:8_000});
        const dragEvents=await page.evaluate(()=>globalThis.__robertaR3Events||[]);
        assert(dragEvents.some(event=>event.name==='pieceDrop'&&event.uid===numericUid&&event.target?.row===candidate.target[0]&&event.target?.col===candidate.target[1]),
          `real UI drag did not drop the selected frontline on ${candidate.targetKey}: ${JSON.stringify(dragEvents)}`);
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(()=>document.querySelector('.fwheel[role="dialog"]')?.classList.contains('is-right'),{timeout:5_000});
        const priorRevision=live.revision;
        await page.keyboard.press('Enter');
        await page.waitForFunction(()=>!document.querySelector('.fwheel[role="dialog"]'),{timeout:10_000});
        return waitState(page,sessionId,next=>{const p=next.pieces.find(piece=>piece.uid===frontline.uid);return next.revision>priorRevision&&p?.row===candidate.target[0]&&p?.col===candidate.target[1]&&p?.dir==='RIGHT';},15_000);
      };
      state = await moveToTarget();
      const afterMoveRevision = state.revision;
      const placed = state.pieces.find((piece) => piece.uid === frontline.uid);
      assert(placed?.uid === 'p12' && canonicalFront.position === 'MELEE'
        && placed.row === candidate.target[0] && placed.col === candidate.target[1],
      `official session did not place p12, the MELEE frontline, in machine range: ${JSON.stringify({uid:placed?.uid,row:placed?.row,col:placed?.col,role:placed?.operator?.role,position:placed?.operator?.position})}`);
      const currentOwner = state.pieces.find((piece) => piece.uid === owner.uid);
      const currentToken = currentOwner.operator?.summons?.find((token) => token.id === fixture.summonTokenId);
      assert(currentToken, 'current session DTO lost the canonical Roberta machine summon');
      const choices = currentOwner.summonLegalTiles?.[fixture.summonTokenId] || [];
      assert(choices.includes(candidate.anchorKey), `official summon options no longer include planned anchor ${candidate.anchorKey}`);
      const controlSelector = `#member-${currentOwner.uid} .rs-summons select`;
      const applyOrder = async (value, predicate, label) => {
        const control=await page.$(controlSelector);assert(control,`R3 summon selector missing during ${label}`);
        await selectOption(control,value);
        return waitState(page,sessionId,predicate,15_000).catch(async error=>{
          const latest=await stateOf(page,sessionId);throw new Error(`${label} failed: ${error.message}; current=${JSON.stringify(latest.pieces.find(p=>p.uid===currentOwner.uid)?.summonOrders)}`);
        });
      };
      const preSet=state.revision, anchor=candidate.anchor;
      const alternate=choices.find(key=>key!==candidate.anchorKey);
      assert(alternate, 'R3 official DTO has no alternate legal anchor for set-clear-set verification');
      const [alternateRow,alternateCol]=alternate.split(',').map(Number);
      const existingOrder=currentOwner.summonOrders?.find(o=>Number.isInteger(o.row)&&Number.isInteger(o.col));
      if(existingOrder&&existingOrder.row===alternateRow&&existingOrder.col===alternateCol) state=await stateOf(page,sessionId);
      else state=await applyOrder(alternate,next=>next.revision>preSet&&next.pieces.find(p=>p.uid===currentOwner.uid)?.summonOrders?.some(o=>o.row===alternateRow&&o.col===alternateCol),'set summon order');
      const firstSet=state.revision;
      state=await applyOrder('',next=>next.revision>firstSet&&!(next.pieces.find(p=>p.uid===currentOwner.uid)?.summonOrders||[]).some(o=>Number.isInteger(o.row)&&Number.isInteger(o.col)),'clear summon order');
      const cleared=state.revision;
      state=await applyOrder(`${anchor[0]},${anchor[1]}`,next=>next.revision>cleared&&next.pieces.find(p=>p.uid===currentOwner.uid)?.summonOrders?.some(o=>o.row===anchor[0]&&o.col===anchor[1]),'set summon order again');
      attempt.revisions={afterMove:afterMoveRevision,firstSet,afterClear:cleared,finalSet:state.revision};
      attempt.stage='official-placement-and-set-clear-set-complete';
      const fight=await performRealFight(page,sessionId);
      const player=Object.values(fight.settlement?.result?.perPlayer||{})[0]||{};
      const tokenUid=`resonance-summon-${owner.uid}-${currentToken.id}`;
      const machine=player.unitStats?.find(unit=>unit.uid===tokenUid&&unit.kind==='token');
      const settled=[...(fight.state?.history||[])].reverse().find(event=>event.type==='fight-settled'&&event.round===battleRound);
      const rawBattleEvidence={fixtureId:sessionId,requestedRound:battleRound,actualBattleRound:fight.battleRound??null,
        authoritativeSettled:{round:settled?.round??null,won:settled?.won??null,hpLoss:settled?.hpLoss??null},
        ownerUid:owner.uid,targetUid:frontline.uid,summonAnchor:{tokenId:currentToken.id,row:anchor[0],col:anchor[1]},
        diagnostics:fight.settlement?.diagnostics??null,
        machineUnitStats:player.unitStats?.filter(unit=>unit.uid===tokenUid||unit.defId===currentToken.id)??[],
        resultAvailable:!!fight.settlement?.result,nativeAtLaunch:attempt.nativeAtLaunch,battleExecutedOnce:!!fight.ran};
      attempt.battleExecutedOnce=!!fight.ran;attempt.stage=`R${battleRound}-battle-response-captured`;
      const rawReceipt=await appendFollowupEvidence(`roberta-machine-r${battleRound}-raw-battle-response`,rawBattleEvidence);
      assert(fight.ran&&fight.battleRound===battleRound,`fixture did not execute exactly the unsettled R${battleRound} Battle`);
      attempt.battleExecutedOnce=true;attempt.stage=`R${battleRound}-battle-settled`;
      const diagnostics=fight.settlement?.diagnostics||{};
      const ownerDiag=(diagnostics.summonAnchors||[]).find(entry=>entry.ownerUid===owner.uid&&entry.tokenId===currentToken.id);
      assert(ownerDiag&&ownerDiag.row===anchor[0]&&ownerDiag.col===anchor[1],`R${battleRound} summon anchor mismatch: ${JSON.stringify(diagnostics.summonAnchors)}`);
      assert(machine&&machine.defId===currentToken.id,`R${battleRound} Battle result omitted Roberta machine ${tokenUid}/${currentToken.id}`);
      const support=(diagnostics.robertaMachines||[]).filter(event=>event.kind==='support'&&event.ownerUid===owner.uid&&event.tokenUid===tokenUid);
      assert(support.length>0,'R3 diagnostics recorded no actual Roberta machine support trigger');
      assert(support.some(event=>event.targetUid===frontline.uid&&event.defPct===0.2&&event.duration===25&&event.shieldHits===1),
        `R3 support event did not show the expected MELEE target/20% DEF/one shield/25s: ${JSON.stringify(support)}`);
      assert(machine.attacks===0,`Roberta machine must not attack in the current Native; attacks=${machine.attacks}`);
      assert(Number(diagnostics.errorCount||0)===0,'Roberta Battle diagnostics contain errors');
      assert((diagnostics.summonAnchorGaps||[]).length===0,'Roberta Battle has summon anchor gaps');
      const after=await stateOf(page,sessionId);
      const settledAfter=[...(after.history||[])].reverse().find(event=>event.type==='fight-settled'&&event.round===battleRound);
      assert(settledAfter&&after.round>battleRound,`R${battleRound} authoritative fight-settled record is missing`);
      const evidence={fixtureId:sessionId,round:battleRound,ownerUid:owner.uid,frontlineUid:frontline.uid,
        frontlineIdentity:attempt.frontlineIdentity,frontlineTile:candidate.target,summonAnchor:{tokenId:currentToken.id,row:anchor[0],col:anchor[1]},
        revisions:attempt.revisions,settled:{won:settledAfter.won,hpLoss:settledAfter.hpLoss},supportEvents:support,
        machine:{uid:machine.uid,attacks:machine.attacks},diagnostics:{errorCount:diagnostics.errorCount,summonAnchorGaps:diagnostics.summonAnchorGaps||[],robertaMachines:diagnostics.robertaMachines},
        rawResponseReceipt:rawReceipt,priorSettledRounds:settledRounds,battleExecutedOnce:true,priorBattleReplayed:false,nativeAtLaunch:attempt.nativeAtLaunch};
      const receipt=await appendFollowupEvidence(`roberta-machine-r${battleRound}-defense`,evidence);
      passed('summon-order-and-clear',`R${battleRound}真实UI订单与造型仪近战防御效果通过；support=${support.length},DEF+20%,shield=1,duration=25s,token attacks=0,diagnostics=0`);
      return {status:'passed',receipt,evidence};
    })();
    return await Promise.race([work,deadline]);
  } catch(error) {
    attempt.status='failed';attempt.error=error.stack||String(error);
    const receipt=await appendFollowupEvidence('roberta-machine-r3-defense',attempt);
    return {status:'failed',receipt,evidence:attempt};
  } finally {
    clearTimeout(timeoutHandle);
    await page?.close().catch(()=>{});await browser?.close().catch(()=>{});
    await server?.close().catch(()=>{});await fixtureServer?.close().catch(()=>{});
  }
}
async function runTerminalAndCssFollowup({ cssOnly = false } = {}) {
  const old = priorBrowserReceipt(), fixtures = old.fixtureSessions || [];
  const labels = ['terminal-normal', 'terminal-funny', 'terminal-hard', 'terminal-hp-depleted', 'terminal-round-limit-loss', 'abyss-28-to-30'];
  const terminalFixtures = labels.map((label) => fixtures.find((fixture) => fixture.label === label));
  assert(terminalFixtures.every(Boolean), 'existing receipt lacks one or more completed terminal fixtures');
  await startNarrowBrowser({ fixture: true });
  const terminalEvidence = [];
  const cssEvidence = {};
  try {
    const hardDeadline = new Promise((_, reject) => { timeoutHandle = setTimeout(() => {
      void browser?.close().catch(() => {}); void server?.close().catch(() => {});
      reject(new Error('terminal/CSS followup check exceeded 5-minute deadline'));
    }, 5 * 60 * 1000); });
    const work = (async () => {
      if (!cssOnly) for (const fixture of terminalFixtures) {
        const page = await openSessionPage(browser, fixtureServer, fixture.id);
        try {
          const state = await stateOf(page, fixture.id);
          await page.waitForSelector('.rs-final', { timeout: 15_000 });
          await page.waitForSelector('.rs-result', { timeout: 15_000 });
          const settled = [...(state.history || [])].reverse().find((entry) => entry.type === 'fight-settled');
          assert(state.phase === 'complete' && state.terminalReason && settled, `completed fixture lacks authoritative terminal state/history: ${fixture.label}`);
          const expected = fixture.label === 'terminal-hp-depleted' ? ['hp-depleted']
            : fixture.label === 'terminal-round-limit-loss' ? ['round-limit-loss']
              : fixture.label === 'abyss-28-to-30' ? ['victory', 'round-limit-loss', 'hp-depleted'] : ['victory'];
          assert(expected.includes(state.terminalReason), `${fixture.label} terminal reason changed: ${state.terminalReason}/${expected.join('|')}`);
          const heading = (await textOf(await page.$('.rs-final h2'))).trim();
          const row = `第${settled.round}场 · ${settled.won ? '胜利' : '失守'}`;
          const body = await page.$eval('.rs-game', (node) => node.innerText);
          assert(heading.includes(state.terminalReason === 'victory' ? '防线守住了' : '本局结束') && body.includes(row) && body.includes('本局战报'),
            `completed session final panel/report does not match its stored result: ${fixture.label}/${heading}/${row}`);
          terminalEvidence.push({ fixture: fixture.label, sessionId: fixture.id, terminalReason: state.terminalReason,
            round: settled.round, won: settled.won, heading, reportRow: row, revision: state.revision, battleReplayed: false });
        } finally { await page.close(); }
      }
      if (!cssOnly) await appendFollowupEvidence('completed-terminal-ui-reopened', { terminals: terminalEvidence, battleReplayed: false });
      const opening = await browser.newPage();
      try {
        await opening.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
        const openingCdp = await opening.target().createCDPSession();
        await openingCdp.send('Network.enable'); await openingCdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await opening.goto(entryUrl(server), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await opening.waitForSelector('.rs-start__setup', { timeout: 30_000 }).catch(async (error) => {
          const body = await opening.evaluate(() => document.body.innerText.slice(0, 1200)).catch(() => '');
          throw new Error(`opening setup never became ready: ${error.message}; URL=${opening.url()}; body=${body}`);
        });
        await opening.waitForFunction(() => document.querySelector('.rs-fullscreen') || [...document.querySelectorAll('a')].some((el) => (el.innerText || '').includes('全屏打开')), { timeout: 10_000 }).catch(() => {});
        await capture(opening, 'opening-css-refresh.png', '全屏打开按钮紧凑尺寸与开局环境选择');
        const openingDOM = await opening.evaluate(() => ({ url: location.href, mainClass: document.querySelector('main')?.className || null,
          anchors: [...document.querySelectorAll('a')].map((el) => ({ text: (el.innerText || '').trim(), className: el.className, href: el.href }))
            .filter((entry) => entry.text.includes('全屏') || entry.className.includes('fullscreen')), bodyStart: document.body.innerText.slice(0, 400) }));
        const fullscreen = await opening.$('.rs-fullscreen') || await findTextHandle(opening, 'a', '全屏打开');
        assert(fullscreen, `opening view omitted fullscreen link: ${JSON.stringify(openingDOM)}`);
        const openingStyle = await fullscreen.evaluate((el) => ({ className: el.className, fontSize: getComputedStyle(el).fontSize, padding: getComputedStyle(el).padding,
          rect: (() => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; })() }));
        assert(openingStyle.className.split(/\s+/).includes('rs-fullscreen') && openingStyle.fontSize === '14px',
          `fullscreen link is not the styled compact 14px control: ${JSON.stringify({ openingStyle, openingDOM })}`);
        const environmentStyle = await opening.$eval('.rs-env-choice', (el) => {
          const button = el.querySelector(':scope > button'), copy = el.querySelector(':scope > .rs-copy');
          const br = button?.getBoundingClientRect(), cr = copy?.getBoundingClientRect(), text = button?.querySelector('span');
          const tr = text?.getBoundingClientRect();
          return { display: getComputedStyle(el).display, buttonWidth: br?.width, buttonHeight: br?.height,
            descriptionWidth: tr?.width ?? 0, copyWidth: cr?.width ?? 0, copyVisible: !!copy && cr.width > 0,
            description: (text?.innerText || '').trim() };
        });
        assert(environmentStyle.buttonWidth > 100 && environmentStyle.descriptionWidth > 100 && environmentStyle.copyVisible && environmentStyle.description,
          `environment choice text/copy layout is not usable: ${JSON.stringify(environmentStyle)}`);
        cssEvidence.opening = openingStyle;
        cssEvidence.environmentChoice = environmentStyle;
      } finally { await opening.close(); }
      const prepFixture = old.sessions?.find((entry) => entry.purpose === 'NORMAL/谢拉格')
        || old.sessions?.find((entry) => entry.purpose === 'NORMAL/拉特兰') || old.sessions?.find((entry) => entry.purpose === 'NORMAL');
      assert(prepFixture?.id, 'prior receipt has no reusable natural session for CSS prep layout');
      const prep = await browser.newPage();
      try {
        await prep.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
        await prep.goto(entryUrl(server, { session: prepFixture.id }), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await waitGame(prep);
        const state = await stateOf(prep, prepFixture.id);
        const prepStyle = await prep.$eval('.rs-field__canvas', (canvas) => ({
          canvasWidth: canvas.getBoundingClientRect().width, canvasHeight: canvas.getBoundingClientRect().height,
          boardVisible: !!document.querySelector('.rs-field__board'), copyControls: document.querySelectorAll('.rs-copy').length,
          phase: document.querySelector('.rs-game')?.dataset?.phase || null
        }));
        assert(state.phase === 'prep' && prepStyle.canvasWidth > 300 && prepStyle.canvasHeight > 200 && prepStyle.boardVisible && prepStyle.copyControls > 0,
          `natural prep field layout is not visible: ${JSON.stringify({ statePhase: state.phase, prepStyle })}`);
        await capture(prep, 'natural-prep-css-refresh.png', '自然备战界面环境文字和复制链接排版');
        await prep.setViewport({ width: 1000, height: 700, deviceScaleFactor: 1 });
        await prep.waitForFunction(() => {
          const canvas = document.querySelector('.rs-field__canvas'), root = document.querySelector('.rs-game');
          if (!canvas || !root) return false;
          const cr = canvas.getBoundingClientRect(), rr = root.getBoundingClientRect();
          const current = [innerWidth, innerHeight, scrollX, scrollY, Math.round(cr.width), Math.round(cr.height), Math.round(rr.width)];
          const previous = window.__resonanceStableViewport;
          const count = previous && previous.value.every((value, index) => value === current[index]) ? previous.count + 1 : 1;
          window.__resonanceStableViewport = { value: current, count };
          return count >= 3;
        }, { polling: 'raf', timeout: 10_000 });
        await capture(prep, 'landscape-css-refresh.png', '横屏布局与紧凑全屏入口');
        cssEvidence.prep = { sessionId: prepFixture.id, phase: state.phase, round: state.round, environmentId: state.environmentId, layout: prepStyle };
        cssEvidence.landscape = await prep.evaluate(() => {
          const root = document.querySelector('.rs-game'), canvas = document.querySelector('.rs-field__canvas'), link = [...document.querySelectorAll('a')].find((el) => (el.innerText || '').includes('全屏打开'));
          const rr = root.getBoundingClientRect(), cr = canvas.getBoundingClientRect(), lr = link?.getBoundingClientRect();
          return { viewport: { width: innerWidth, height: innerHeight }, rootWidth: rr.width, documentWidth: document.documentElement.scrollWidth,
            noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 2, canvasWidth: cr.width, canvasHeight: cr.height,
            fullscreenLinkVisible: !!link && lr.width > 0 && lr.height > 0, fullscreenLinkFontSize: link ? getComputedStyle(link).fontSize : null };
        });
        assert(cssEvidence.landscape.noHorizontalOverflow && cssEvidence.landscape.canvasWidth > 250 && cssEvidence.landscape.fullscreenLinkVisible,
          `landscape prep view overflows or loses the fullscreen action: ${JSON.stringify(cssEvidence.landscape)}`);
      } finally { await prep.close(); }
    })();
    await Promise.race([work, hardDeadline]);
  } finally {
    clearTimeout(timeoutHandle);
    await browser?.close().catch(() => {}); await server?.close().catch(() => {}); await fixtureServer?.close().catch(() => {});
  }
  const receipt = await appendFollowupEvidence(cssOnly ? 'opening-prep-css-refresh' : 'completed-terminal-ui-and-css',
    { terminals: terminalEvidence, css: cssEvidence, screenshots: screenshots.slice(-3), battleReplayed: false });
  return { status: (cssOnly || terminalEvidence.length === 6) && cssEvidence.opening?.fontSize === '14px'
    && cssEvidence.environmentChoice?.copyVisible && cssEvidence.prep?.layout?.boardVisible ? 'passed' : 'failed', receipt, terminals: terminalEvidence, css: cssEvidence, screenshots: screenshots.slice(-3) };
}
async function runVictoryPanelCapture() {
  const fixture = (priorBrowserReceipt().fixtureSessions || []).find((entry) => entry.label === 'terminal-normal');
  assert(fixture, 'existing receipt lacks the completed NORMAL victory fixture');
  await startNarrowBrowser({ fixture: true });
  let page;
  try {
    page = await openSessionPage(browser, fixtureServer, fixture.id);
    const state = await stateOf(page, fixture.id);
    assert(state.phase === 'complete' && state.terminalReason === 'victory', 'existing NORMAL fixture is not already a completed victory');
    await page.waitForSelector('.rs-final', { timeout: 15_000 });
    await page.waitForSelector('.rs-result', { timeout: 15_000 });
    const latest = [...(state.history || [])].reverse().find((entry) => entry.type === 'fight-settled');
    assert(latest?.won && latest.round === 28, 'stored NORMAL terminal history is not the completed R28 victory');
    const heading = (await textOf(await page.$('.rs-final h2'))).trim();
    const report = await page.$eval('.rs-game', (node) => node.innerText);
    assert(heading.includes('防线守住了') && report.includes(`第${latest.round}场 · 胜利`) && report.includes('本局战报'), 'existing final UI does not match authoritative stored result');
    await capture(page, 'normal-victory-final-panel.png', '已完成标准难度战斗的最终阵容与战报');
    const evidence = { fixtureId: fixture.id, terminalReason: state.terminalReason, round: latest.round, won: latest.won,
      heading, reportVisible: true, screenshot: path.join(SCREENSHOT_DIR, 'normal-victory-final-panel.png'), battleReplayed: false };
    const receipt = await appendFollowupEvidence('normal-victory-final-panel-capture', evidence);
    return { status: 'passed', evidence, receipt };
  } finally {
    await page?.close().catch(() => {}); await browser?.close().catch(() => {});
    await server?.close().catch(() => {}); await fixtureServer?.close().catch(() => {});
  }
}
async function runIframeOnlyCheck() {
  const fixture = (priorBrowserReceipt().fixtureSessions || []).find((entry) => entry.label === 'adjacent-pair-strategy');
  assert(fixture, 'existing receipt lacks the selected adjacent-pair strategy fixture');
  let timeout = null;
  try {
    const work = (async () => {
      await startNarrowBrowser({ fixture: true });
      return verifyIframeFullscreen(browser, fixtureServer, fixture);
    })();
    const deadline = new Promise((_, reject) => { timeout = setTimeout(() => {
      void browser?.close().catch(() => {}); void server?.close().catch(() => {}); void fixtureServer?.close().catch(() => {});
      reject(new Error('local iframe followup exceeded 4-minute deadline'));
    }, 4 * 60 * 1000); });
    const result = await Promise.race([work, deadline]);
    const evidence = { fixtureId: fixture.id, ...result, battleReplayed: false };
    const receipt = await appendFollowupEvidence('local-iframe-fullscreen-session-fragment', evidence);
    return { status: 'passed', evidence, receipt };
  } catch (error) {
    const evidence = { fixtureId: fixture.id, status: 'failed', error: error.stack || String(error), battleReplayed: false };
    const receipt = await appendFollowupEvidence('local-iframe-fullscreen-session-fragment', evidence);
    return { status: 'failed', evidence, receipt };
  } finally {
    clearTimeout(timeout);
    await browser?.close().catch(() => {}); await server?.close().catch(() => {}); await fixtureServer?.close().catch(() => {});
  }
}
async function runLinkKindsOnlyCheck() {
  const prior = priorBrowserReceipt();
  const fixtures = prior.fixtureSessions || [];
  const pair = fixtures.find((entry) => entry.label === 'adjacent-pair-strategy');
  const interactive = fixtures.find((entry) => entry.label === 'copy/equipment/summon');
  const terminal = fixtures.find((entry) => entry.label === 'terminal-normal');
  assert(pair && interactive && terminal, 'receipt lacks existing pair, prep-inventory, or terminal-equipment fixtures');
  let timeout = null;
  const pages = new Map();
  const attempts = [];
  const expected = ['operator','pact','item','recipe','strategy','environment','member','inventory','offer','choice','node','battleNode','session'];
  const sourceFor = (kind) => kind === 'choice' ? pair : ['inventory','offer','node','battleNode','member','session'].includes(kind) ? interactive : pair;
  const fixtureById = new Map([pair, interactive, terminal].map((entry) => [entry.id, entry]));
  const passedKinds = new Set(prior.followupEvidence.filter((entry) => entry.kind === 'link-kind-checkpoint'
    && entry.evidence?.status === 'passed').map((entry) => entry.evidence.kind));
  const equippedProof = [...prior.followupEvidence].reverse().find((entry) => entry.kind === 'live-inventory-equipped-links')
    ?.evidence?.stories?.componentLinks?.find((entry) => entry.kind === 'equipped');
  try {
    await startNarrowBrowser({ fixture: true });
    for (const kind of [...expected, 'equipped']) {
      if (passedKinds.has(kind)) continue;
      process.stdout.write(`${JSON.stringify({ event: 'link-kind-start', kind, sourceSessionId: sourceFor(kind).id, native: nativeSourceState() })}\n`);
      if (kind === 'equipped') {
        const evidence = equippedProof ? { kind, status: 'passed', source: 'prior-live-inventory-equipped-links',
          sourceEvidence: equippedProof, sourceSessionId: interactive.id, nativeRequired: true, battleReplayed: false }
          : { kind, status: 'failed', reason: 'no prior actual equipped-link proof; no live equipped target found in remaining fixtures' };
        attempts.push(evidence);
        await appendFollowupEvidence('link-kind-checkpoint', evidence);
        process.stdout.write(`${JSON.stringify({ event: 'link-kind-terminal', kind, status: evidence.status, source: evidence.source || null })}\n`);
        if (evidence.status !== 'passed') break;
        continue;
      }
      const fixture = sourceFor(kind);
      let sourcePage = pages.get(fixture.id);
      const step = { kind, sourceSessionId: fixture.id, stage: 'source-load', openedUrl: null, targetId: null };
      try {
        const stepWork = (async () => {
          if (!sourcePage) {
            step.stage = 'load-source-session';
            sourcePage = await openSessionPage(browser, fixtureServer, fixture.id);
            pages.set(fixture.id, sourcePage);
          }
          step.stage = 'copy-from-live-component';
          const copied = await copyLiveLinkForKind(sourcePage, fixtureServer, kind, (detail) => { step.copyProgress = detail; });
          if (!copied) step.domDiagnostics = await sourcePage.evaluate((targetKind) => ({
            url: location.href, main: document.querySelector('main')?.className || null,
            catalogOpen: [...document.querySelectorAll('details')].map(node => ({ open: node.open, label: node.querySelector('summary')?.innerText || '' })),
            selectors: { roster: document.querySelectorAll('.rs-card--operator .rs-copy').length,
              pact: document.querySelectorAll('.rs-pact .rs-copy').length, inventory: document.querySelectorAll('#rs-section-equipment [id^="inventory-"] .rs-copy').length,
              equipped: document.querySelectorAll('#rs-section-equipment [id^="equipped-"] .rs-copy').length,
              offer: document.querySelectorAll('#rs-section-shop .rs-offer .rs-copy').length,
              choice: document.querySelectorAll('[id^="choice-"] .rs-copy').length,
              node: document.querySelectorAll('#rs-section-economy-rules .rs-node .rs-copy').length,
              battleNode: document.querySelectorAll('.rs-next .rs-copy').length,
              environment: document.querySelectorAll('#rs-section-environment-catalog .rs-card .rs-copy').length,
              strategy: document.querySelectorAll('#rs-section-strategy-catalog .rs-card .rs-copy,[id^="choice-"] .rs-choice__option .rs-copy').length,
              requested: targetKind }
          }), kind);
          assert(copied, `no live ${kind} copy control on source session ${fixture.id}; source URL=${sourcePage.url()}`);
          step.openedUrl = copied.url;
          step.targetId = copied.targetId;
          const targetPage = await browser.newPage();
          try {
            step.stage = 'open-copied-url';
            await targetPage.goto(copied.url, { waitUntil: 'domcontentloaded', timeout: 12_000 });
            await waitGame(targetPage, 18_000);
            const parsed = detailHashParts(new URL(copied.url));
            if (new Set(['operator','pact','item','recipe','strategy','environment']).has(kind)) {
              await targetPage.waitForSelector('.rs-detail', { timeout: 8_000 });
            } else if (kind === 'member') {
              await targetPage.waitForFunction((id) => !!document.getElementById(`member-${encodeURIComponent(id)}`)?.matches(':focus'), { timeout: 8_000 }, parsed.id);
            } else if (kind === 'session') {
              assert(new URL(targetPage.url()).searchParams.get('session') === parsed.id, 'session link did not preserve the session id');
              const state = await stateOf(targetPage, parsed.id);
              step.authoritativeState = { phase: state.phase, round: state.round, revision: state.revision };
            } else {
              await targetPage.waitForSelector(`[id="${step.targetId.replaceAll('"', '\\"')}"]`, { timeout: 8_000 });
            }
            return { kind, status: 'passed', sourceSessionId: fixture.id, url: copied.url, targetId: step.targetId,
              openedUrl: targetPage.url(), targetVisible: true, native: nativeSourceState(), battleReplayed: false };
          } finally { await targetPage.close().catch(() => {}); }
        })();
        const deadline = new Promise((_, reject) => { timeout = setTimeout(() => {
          void browser?.close().catch(() => {});
          reject(new Error(`link kind ${kind} exceeded 45 seconds at ${step.stage}/${JSON.stringify(step.copyProgress || {})}`));
        }, 45_000); });
        const checkpoint = await Promise.race([stepWork, deadline]);
        clearTimeout(timeout); timeout = null;
        attempts.push(checkpoint);
        await appendFollowupEvidence('link-kind-checkpoint', checkpoint);
        passedKinds.add(kind);
        process.stdout.write(`${JSON.stringify({ event: 'link-kind-terminal', kind, status: checkpoint.status, url: checkpoint.url, targetId: checkpoint.targetId })}\n`);
      } catch (error) {
        clearTimeout(timeout); timeout = null;
        const failed = { ...step, status: 'failed', error: error.stack || String(error), native: nativeSourceState(), battleReplayed: false };
        attempts.push(failed);
        await appendFollowupEvidence('link-kind-checkpoint', failed);
        process.stdout.write(`${JSON.stringify({ event: 'link-kind-terminal', kind, status: 'failed', stage: failed.stage, error: failed.error })}\n`);
        break;
      }
    }
    const missing = [...expected, 'equipped'].filter((kind) => !passedKinds.has(kind)
      && !attempts.some((entry) => entry.kind === kind && entry.status === 'passed'));
    const evidence = { expectedKinds: [...expected, 'equipped'], reusedPassedKinds: [...passedKinds], attempts,
      completed: attempts.filter((entry) => entry.status === 'passed').map((entry) => entry.kind), missing,
      battleReplayed: false };
    const receipt = await appendFollowupEvidence('fourteen-link-kinds-index', evidence);
    return { status: missing.length ? 'incomplete' : 'passed', receipt, evidence };
  } catch (error) {
    const evidence = { status: 'failed', attempts, error: error.stack || String(error), battleReplayed: false };
    const receipt = await appendFollowupEvidence('fourteen-link-kinds-index', evidence);
    return { status: 'failed', evidence, receipt };
  } finally {
    clearTimeout(timeout);
    for (const page of pages.values()) await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {}); await fixtureServer?.close().catch(() => {});
  }
}
async function runSessionLoadDiagnostic(sessionId) {
  assert(sessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId), 'load diagnostic requires an existing session UUID');
  const fixture = (priorBrowserReceipt().fixtureSessions || []).find((entry) => entry.id === sessionId);
  assert(fixture, 'load diagnostic only accepts a fixture already listed in the receipt');
  let page = null, timeout = null;
  const network = [];
  try {
    const work = (async () => {
      await startNarrowBrowser({ fixture: true });
      page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      page.on('response', response => network.push({ status: response.status(), url: response.url(), type: response.request().resourceType() }));
      page.on('requestfailed', request => network.push({ failed: request.failure()?.errorText || 'request failed', url: request.url(), type: request.resourceType() }));
      const errorsSeen = [];
      page.on('pageerror', error => errorsSeen.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errorsSeen.push(message.text()); });
      const target = entryUrl(fixtureServer, { session: sessionId });
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForFunction(() => document.querySelector('.rs-game') || document.querySelector('.rs-start__setup') || document.querySelector('.rs-start .rs-panel'), { timeout: 20_000 });
      const dom = await page.evaluate(async id => {
        let api;
        try {
          const response = await fetch(new URL(`resonance/api/sessions/${encodeURIComponent(id)}?catalog=0`, location.href));
          const body = await response.json();
          api = { status: response.status, ok: body?.ok, state: body?.state ? { phase: body.state.phase, round: body.state.round, revision: body.state.revision } : null, error: body?.error || null };
        } catch (error) { api = { error: error.message }; }
        return { href: location.href, mainClass: document.querySelector('main')?.className || null,
          setupVisible: !!document.querySelector('.rs-start__setup'), gameVisible: !!document.querySelector('.rs-game'),
          failureText: document.querySelector('.rs-start .rs-panel')?.innerText || null, api };
      }, sessionId);
      await page.evaluate(() => window.getSelection?.()?.removeAllRanges?.());
      await mkdir(SCREENSHOT_DIR, { recursive: true });
      const screenshot = path.join(SCREENSHOT_DIR, `session-load-diagnostic-${sessionId}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, captureBeyondViewport: true });
      return { fixtureId: sessionId, target, dom, network, pageErrors: errorsSeen, screenshot, stateMutated: false };
    })();
    const deadline = new Promise((_, reject) => { timeout = setTimeout(() => {
      void page?.close().catch(() => {}); void browser?.close().catch(() => {});
      void server?.close().catch(() => {}); void fixtureServer?.close().catch(() => {});
      reject(new Error('session load diagnostic exceeded 45 seconds'));
    }, 45_000); });
    const evidence = await Promise.race([work, deadline]);
    const receipt = await appendFollowupEvidence('session-load-readonly-diagnostic', evidence);
    return { status: 'completed', evidence, receipt };
  } catch (error) {
    const evidence = { fixtureId: sessionId, status: 'failed', error: error.stack || String(error), network, stateMutated: false };
    const receipt = await appendFollowupEvidence('session-load-readonly-diagnostic', evidence);
    return { status: 'failed', evidence, receipt };
  } finally {
    clearTimeout(timeout);
    await page?.close().catch(() => {}); await browser?.close().catch(() => {});
    await server?.close().catch(() => {}); await fixtureServer?.close().catch(() => {});
  }
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
  let resumedPrimary = null;
  if (REMOTE_RESUME_SESSION_ID) {
    assert(REMOTE_MODE, '--resume-production-session 仅用于远端生产验证');
    await clickButton(page, '继续上一局');
    await waitGame(page);
    const resumedId = new URL(page.url()).searchParams.get('session');
    assert(resumedId === REMOTE_RESUME_SESSION_ID, `继续上一局恢复了意外会话 ${resumedId || '(missing)'}`);
    const resumedState = await stateOf(page, resumedId);
    assert(resumedState.difficulty === 'FUNNY' && resumedState.roundLimit === expectedRoundLimit.FUNNY,
      `恢复会话并非预期FUNNY/28：${resumedState.difficulty}/${resumedState.roundLimit}`);
    sessions.push({ id: resumedId, purpose: 'FUNNY：前次真实开局创建的会话，经继续上一局恢复' });
    difficultyEvidence.push(`轻松:${resumedState.difficulty}/${resumedState.roundLimit}(已恢复)`);
    resumedPrimary = { id: resumedId, state: resumedState };
    await capture(page, '02-production-resumed-session.png', '恢复的真实生产会话');
    await leaveToOpening(page);
  }
  for (const [id, label] of difficulties.filter(([id]) => !resumedPrimary || id !== 'FUNNY')) {
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

  let mainId, initial;
  if (resumedPrimary) {
    mainId = resumedPrimary.id;
    await page.goto(entryUrl(server, { session: mainId }), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitGame(page);
    const recoveredState = await stateOf(page, mainId);
    assert(recoveredState.revision === resumedPrimary.state.revision, '恢复的主会话revision在后续开局验证中意外变化');
    initial = recoveredState;
  } else {
    const created = await startViaUi(page, { difficulty: 'NORMAL' });
    mainId = created.id; initial = created.state;
  }
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
  const fallbackBefore = await stateOf(fallbackPage, mainId);
  const fallbackUnit = fallbackBefore.pieces.find((piece) => piece.row != null);
  const fallbackSelect = fallbackUnit && await fallbackPage.$(`#member-${encodeURIComponent(fallbackUnit.uid)} select:last-of-type`);
  let fallbackVerified = false;
  if (fallbackUnit && fallbackSelect) {
    const dir = fallbackUnit.dir === 'UP' ? 'RIGHT' : 'UP';
    assert(await fallbackSelect.$(`option[value="${dir}"]`), 'fallback has no legal alternate facing');
    await selectOption(fallbackSelect, dir);
    const updated = await waitState(fallbackPage, mainId, next => {
      const piece = next.pieces.find(candidate => candidate.uid === fallbackUnit.uid);
      return next.revision > fallbackBefore.revision && piece?.row === fallbackUnit.row && piece?.col === fallbackUnit.col && piece?.dir === dir;
    });
    fallbackVerified = updated.revision > fallbackBefore.revision;
  }
  if (fallbackVerified) passed('renderer-dom-fallback', 'render=fallback下DOM棋子/朝向控件与正式session API成功交互');
  else unavailable('renderer-dom-fallback', 'fallback已挂载但没有完成真实session朝向交互');
  if (REMOTE_MODE) {
    const nativeOk = results.get('renderer-native').status === 'passed';
    remoteStory('production-renderers', nativeOk && fallbackVerified ? 'passed' : 'unavailable', `native=${results.get('renderer-native').status}；fallback=${fallbackVerified ? 'passed' : 'unavailable'}；fallback朝向动作已写入真实session`);
  }
  await fallbackPage.close();
  // The fallback tab committed the same session. Reload to use its current revision before the next UI action.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitGame(page);
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
  const lateShopBefore = await stateOf(page, mainId);
  const lateShopActions = [];
  if (latePrep.phase === 'prep' && lateShopBefore.phase === 'prep'
    && lateShopBefore.gold >= (lateShopBefore.actionCosts?.refreshGold ?? 2)) {
    const refreshClicked = await clickEnabled(page, '#rs-section-shop button', '刷新');
    if (refreshClicked) {
    const refreshed = await waitState(page, mainId, (next) => next.revision > lateShopBefore.revision && next.gold < lateShopBefore.gold);
    if (refreshed.shop.offers.length === 5) lateShopActions.push('刷新');
    }
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
  await page.evaluate(() => window.getSelection?.()?.removeAllRanges?.());
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
  if (pendingResponseDiagnostics.size) await Promise.allSettled([...pendingResponseDiagnostics]);
  if (error) errors.push(`${timedOut ? 'timeout' : 'runner'}: ${error.stack || error.message || error}`);
  for (const name of STORIES) if (results.get(name).status === 'unavailable' && results.get(name).evidence === '尚未执行') {
    results.set(name, { status: 'unavailable', evidence: timedOut ? '整体25分钟截止' : '脚本在该故事前异常终止' });
  }
  const judgedStories = REMOTE_MODE ? [...remoteStories.values()] : [...results.values()];
  const receipt = {
    schemaVersion: 1, createdAt: new Date().toISOString(), mode: REMOTE_MODE ? 'remote-production' : 'isolated-local',
    ...(REMOTE_MODE && REMOTE_PRIOR_ATTEMPTS.length ? { priorAttempts: REMOTE_PRIOR_ATTEMPTS } : {}),
    ...(REMOTE_MODE ? { productNativeRevision: REMOTE_PRODUCT_NATIVE_REVISION, resumedSessionId: REMOTE_RESUME_SESSION_ID } : {}),
    nativeSource: { before: SOURCE_BEFORE, after: nativeSourceState() },
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
  if(process.argv.includes('--check-fixtures')){
    const canonicalData=loadData(path.join(CANONICAL_ROOT,'data'),{log:{warn(){},error(){},info(){}}});
    const prepared=await prepareFixtures(canonicalData,{dryRun:true});
    const validation=prepared.fixtureValidation;
    assert(validation?.dryRun===true&&validation.fixtureSessionsWritten===0,'fixture check must not write sessions');
    assert(validation.fixtures.length>=8&&validation.fixtures.every(fixture=>fixture.pieces.length>0&&fixture.pieces.every(piece=>piece.recordAvailable&&piece.position.every(Number.isInteger))),'fixture check found incomplete star records or deployment positions');
    assert(validation.fixtures.every(fixture=>fixture.pieces.length<=10),'fixture exceeds native field roster capacity');
    assert(validation.common.tokenResolution?.placeable===true,'fixture summon owner does not resolve through field.resolveToken');
    const { tokenResolution, ...common } = validation.common;
    process.stdout.write(`${JSON.stringify({status:'fixtures-valid',serverStarted:false,browserStarted:false,sessionsWritten:0,
      common,fixturesValidated:validation.fixtures.length,nativeTokenPlaceable:tokenResolution?.placeable===true,
      fixtures:validation.fixtures.map(f=>({environmentId:f.environmentId,seed:f.seed,pieces:f.pieces.length,sessionWritten:f.sessionWritten}))})}\n`);
  }else if(process.argv.includes('--check-ui-interactions')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const index=process.argv.indexOf('--check-ui-interactions');
    const sessionId=process.argv[index+1]&&!process.argv[index+1].startsWith('--')?process.argv[index+1]:null;
    const result=await runUiInteractionCheck(sessionId);
    process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--check-fresh-ui')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const startedAt=new Date().toISOString();
    const hardDeadline=new Promise((_,reject)=>{timeoutHandle=setTimeout(()=>{void browser?.close().catch(()=>{});void server?.close().catch(()=>{});reject(new Error('fresh UI interaction check exceeded 5-minute deadline'));},5*60*1000)});
    let result;
    try { result=await Promise.race([runUiInteractionCheck(null,{fresh:true}),hardDeadline]); }
    finally { clearTimeout(timeoutHandle); }
    const receipt=await appendFollowupEvidence('fresh-ui-deploy-facing-fallback-shop',{sessionId:result.sessionId,result});
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,receipt,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--check-late-shop')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const index=process.argv.indexOf('--check-late-shop');
    const sessionId=process.argv[index+1]&&!process.argv[index+1].startsWith('--')?process.argv[index+1]:null;
    const result=await runLateShopCheck(sessionId);
    process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--check-component-links')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const startedAt=new Date().toISOString(), result=await runFixtureFollowupChecks({ componentOnly: true });
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--check-followup-fixtures')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const startedAt=new Date().toISOString(), result=await runFixtureFollowupChecks();
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--check-pair-strategy')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const startedAt=new Date().toISOString(), result=await runFixtureFollowupChecks({ pairOnly: true });
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--check-interactive-fixture')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const index=process.argv.indexOf('--check-interactive-fixture');
    const sessionId=process.argv[index+1]&&!process.argv[index+1].startsWith('--')?process.argv[index+1]:null;
    const startedAt=new Date().toISOString(),result=await runInteractiveFixtureCheck(sessionId);
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--check-summon-fixture')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const index=process.argv.indexOf('--check-summon-fixture');
    const sessionId=process.argv[index+1]&&!process.argv[index+1].startsWith('--')?process.argv[index+1]:null;
    const startedAt=new Date().toISOString(),result=await runSummonFixtureCheck(sessionId);
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--check-roberta-r3')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const index=process.argv.indexOf('--check-roberta-r3');
    const sessionId=process.argv[index+1]&&!process.argv[index+1].startsWith('--')?process.argv[index+1]:null;
    const startedAt=new Date().toISOString(),result=await runRobertaR3DefenseCheck(sessionId);
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--capture-normal-victory')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const startedAt=new Date().toISOString(),result=await runVictoryPanelCapture();
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--check-iframe-only')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const startedAt=new Date().toISOString(),result=await runIframeOnlyCheck();
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--check-link-kinds-only')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const startedAt=new Date().toISOString(),result=await runLinkKindsOnlyCheck();
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--diagnose-session-load')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const index=process.argv.indexOf('--diagnose-session-load');
    const sessionId=process.argv[index+1]&&!process.argv[index+1].startsWith('--')?process.argv[index+1]:null;
    const startedAt=new Date().toISOString(),result=await runSessionLoadDiagnostic(sessionId);
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='completed')process.exitCode=1;
  }else if(process.argv.includes('--check-terminal-css')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const startedAt=new Date().toISOString(), result=await runTerminalAndCssFollowup();
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(process.argv.includes('--check-css-only')){
    puppeteer=requireFromCanonical('puppeteer-core');
    const startedAt=new Date().toISOString(), result=await runTerminalAndCssFollowup({ cssOnly: true });
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(existingVisualReplayArg>=0){
    puppeteer=requireFromCanonical('puppeteer-core');
    assert(REMOTE_ENTRY_URL && REMOTE_PRODUCT_NATIVE_REVISION && EXISTING_VISUAL_REPLAY_SESSION_ID,
      '--replay-existing-session requires --url, --product-native and a persisted session ID');
    const startedAt=new Date().toISOString();
    const result=await runExistingSessionVisualReplay(EXISTING_VISUAL_REPLAY_SESSION_ID);
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,productNativeRevision:REMOTE_PRODUCT_NATIVE_REVISION,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(productionFollowupArg>=0 && process.argv.includes('--progress-to-strategy-choice')){
    puppeteer=requireFromCanonical('puppeteer-core');
    assert(REMOTE_ENTRY_URL && REMOTE_WORKSHOP_URL && REMOTE_PRODUCT_NATIVE_REVISION,
      '--progress-to-strategy-choice requires --url, --workshop-url and --product-native');
    const startedAt=new Date().toISOString();
    const hardDeadline=new Promise((_,reject)=>{timeoutHandle=setTimeout(()=>{
      void browser?.close().catch(()=>{}); void server?.close().catch(()=>{});
      reject(new Error('production strategy-choice progression exceeded 10-minute deadline'));
    },10*60*1000)});
    let result;
    try {
      result=await Promise.race([ (async()=>{
        let current=await progressProductionSessionToStrategyChoice(REMOTE_FOLLOWUP_SESSION_ID,{targetStrategyNode:9});
        if(current.status==='terminal-before-choice'){
          const fallbackSessions=REMOTE_FOLLOWUP_EXISTING_SESSIONS.filter((id)=>id!==REMOTE_FOLLOWUP_SESSION_ID);
          for(const fallbackId of fallbackSessions){
            current=await progressProductionSessionToStrategyChoice(fallbackId,{targetStrategyNode:3});
            if(current.status==='passed')break;
            if(current.status!=='terminal-before-choice')throw new Error(`NORMAL fallback choice progression failed for ${fallbackId}: ${JSON.stringify(current)}`);
          }
        }
        return current;
      })(),hardDeadline]);
    } finally { clearTimeout(timeoutHandle); await browser?.close().catch(()=>{}); await server?.close().catch(()=>{}); }
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,productNativeRevision:REMOTE_PRODUCT_NATIVE_REVISION,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else if(productionFollowupArg>=0){
    puppeteer=requireFromCanonical('puppeteer-core');
    assert(REMOTE_ENTRY_URL && REMOTE_WORKSHOP_URL && REMOTE_PRODUCT_NATIVE_REVISION,
      '--check-production-followups requires --url, --workshop-url and --product-native');
    const startedAt=new Date().toISOString();
    const followupTimeoutMs=process.argv.includes('--workshop-only')?5*60*1000:8*60*1000;
    const hardDeadline=new Promise((_,reject)=>{timeoutHandle=setTimeout(()=>{
      void browser?.close().catch(()=>{}); void server?.close().catch(()=>{});
      reject(new Error(`production ${process.argv.includes('--workshop-only')?'Workshop-only':'followups'} exceeded ${Math.round(followupTimeoutMs/60000)}-minute deadline`));
    },followupTimeoutMs)});
    let result;
    try { result=await Promise.race([runRemoteProductionFollowups(REMOTE_FOLLOWUP_SESSION_ID),hardDeadline]); }
    finally { clearTimeout(timeoutHandle); await browser?.close().catch(()=>{}); await server?.close().catch(()=>{}); }
    process.stdout.write(`${JSON.stringify({startedAt,nativeSource:SOURCE_BEFORE,productNativeRevision:REMOTE_PRODUCT_NATIVE_REVISION,...result},null,2)}\n`);
    if(result.status!=='passed')process.exitCode=1;
  }else{
    puppeteer=requireFromCanonical('puppeteer-core');
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
  }
} catch(error){
  process.stderr.write(`${JSON.stringify({status:'fixtures-invalid',error:error.stack??error.message??String(error)})}\n`);
  process.exitCode=1;
}
