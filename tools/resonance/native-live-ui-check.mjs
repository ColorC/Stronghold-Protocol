#!/usr/bin/env node
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runNativeFixtureChecks } from './native-live-ui-fixtures.mjs';

const ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data/resonance-native');
const OUT = path.join(ROOT, 'runtime/resonance/ui-verification');
const SESSION_DIR = path.join(OUT, 'native-live-test-sessions');
const PROFILE = path.join(ROOT, '.omni/tmp/resonance/browser-profile');
const RECEIPT = path.join(OUT, 'native-live-ui-receipt.json');
const LOG = path.join(ROOT, '.omni/tmp/resonance/native-live-ui-check.log');
const HOST = '127.0.0.1', PORT = 19003, DEADLINE_MS = 8 * 60_000;
const SHOT_NAMES = ['01-title', '02-difficulty', '03-prep', '04-pacts', '05-shop-detail', '06-equipment', '07-combat', '08-settle', '09-choice-fixture', '10-result-fixture'];
const SHOTS = Object.fromEntries(SHOT_NAMES.map((name) => [name, path.join(OUT, `native-live-${name}.jpg`)]));
const SUPPLEMENTAL_SHOTS = {
  '11-reward-progress': path.join(OUT, 'native-live-11-reward-progress.jpg'),
  '12-reward-tiers': path.join(OUT, 'native-live-12-reward-tiers.jpg'),
  '13-codex': path.join(OUT, 'native-live-13-codex.jpg'),
  '14-combat-controls': path.join(OUT, 'native-live-14-combat-controls.jpg'),
};
export const REQUIRED_CHECKS = [
  'title-to-difficulty', 'native-info-prep', 'three-real-deployments', 'shop-real-purchase', 'details-open-while-shop-usable',
  'native-entrypoints-unique', 'native-codex-session-and-shortcuts', 'native-panels-open-close', 'native-icons-and-type-readable', 'native-recipe-contrast', 'native-pact-rewards-disclosure',
  'native-remaining-controls-live', 'native-visible-text-audit-14px',
  'mobile-shop-panel-safe',
  'equipment-holder-combine', 'inventory-combine', 'whole-card-cost-colors', 'fixed-skill-icons-loaded', 'ground-tier-ring',
  'all-pact-tier-icons-loaded-and-active', 'emissary-exact-count-2-3', 'chem-market-28-effects-readable', 'native-w-deploy-withdraw', 'native-e-sell',
  'xp-interest-graphics', 'refresh-lock', 'combat-ledger-immutable', 'combat-progress-two-seconds',
  'pause-freezes-and-resume-progresses', 'combat-speed-1-2-4-same-battle', 'reload-restores-same-battle', 'one-real-settlement', 'choice-g-resonance-roundtrip',
  'boss-hidden-fixture-result-lineup-gear-chart', 'scrap-temporary-gear-in-combat', 'equipment-detail-unequip',
  'equipment-detail-recycle', 'native-detail-deep-link', 'difficulty-default-copy', 'default-copy-is-product-language',
  'native-fullscreen-open-link',
];

export function parseArgs(args) {
  let execute = false, sourceRoot = SOURCE, receiptTag = '';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--execute') { execute = true; continue; }
    if (arg === '--validate-args' || arg === '--validate') continue;
    if (arg === '--receipt-tag' && args[index + 1]) {
      receiptTag = String(args[++index]);
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(receiptTag)) throw new Error('--receipt-tag must be a short lowercase tag');
      continue;
    }
    if (arg === '--source-root' && args[index + 1]) {
      sourceRoot = path.resolve(args[++index]);
      const allowed = [SOURCE, ROOT].map(value => path.resolve(value).toLowerCase());
      if (!allowed.includes(sourceRoot.toLowerCase())) throw new Error('--source-root must be the canonical root or registered Resonance worktree');
      continue;
    }
    throw new Error('usage: native-live-ui-check.mjs [--validate-args|--execute] [--source-root <canonical-root|registered-worktree>] [--receipt-tag <lowercase-tag>]; no browser or server started');
  }
  return { execute, sourceRoot, receiptTag };
}
export function artifactPaths(receiptTag = '') {
  const suffix = receiptTag ? `-${receiptTag}` : '';
  const shots = Object.fromEntries(SHOT_NAMES.map(name => [name, path.join(OUT, `native-live${suffix}-${name}.jpg`)]));
  const supplementalScreenshots = Object.fromEntries(Object.keys(SUPPLEMENTAL_SHOTS).map(name => [name, path.join(OUT, `native-live${suffix}-${name}.jpg`)]));
  return { receipt: receiptTag ? path.join(OUT, `native-live-ui-receipt-${receiptTag}.json`) : RECEIPT, screenshots: shots, supplementalScreenshots };
}
export function isAllowedHttpRequest(method, pathname) {
  const m = String(method).toUpperCase();
  if (m !== 'POST') return true;
  if (/^\/resonance\/api\/sessions\/?$/.test(pathname)) return true;
  if (pathname === '/resonance/api/admission') return true;
  return false;
}
export function screenshotCount(paths) { return Object.values(paths || {}).filter((value) => typeof value === 'string' && /\.jpe?g$/i.test(value)).length; }
export function missingChecks(checks) { return REQUIRED_CHECKS.filter((key) => checks?.[key]?.status !== 'passed'); }
export function projectNativeResultSummary(message) {
  if (message?.t !== 'm.result' || !Array.isArray(message.players)) return null;
  const player = message.players.find((entry) => entry?.playerId === 'resonance');
  if (!player) return null;
  const numeric = (value) => value != null && Number.isFinite(Number(value)) ? Number(value) : null;
  const stats = player.stats && typeof player.stats === 'object' ? player.stats : {};
  return { victory: typeof message.victory === 'boolean' ? message.victory : null,
    roundsPassed: numeric(player.roundsPassed ?? message.roundsPassed), lastRound: numeric(message.lastRound),
    stats: { dmgDealt: numeric(stats.dmgDealt), kills: numeric(stats.kills), spent: numeric(stats.gold) } };
}
export function screenshotOverwriteOwner(receipt, file) {
  const absolute = path.resolve(file);
  return (receipt?.attempts ?? []).find((attempt) => Object.values(attempt?.screenshots ?? {})
    .some((recorded) => typeof recorded === 'string' && path.resolve(recorded) === absolute)) ?? null;
}
export function runtimeFaults({ browserErrors = [], badResponses = [], forbiddenRequests = [] } = {}) {
  return { browserErrors: [...browserErrors], badResponses: [...badResponses], forbiddenRequests: [...forbiddenRequests] };
}
function parseCssColor(value) {
  const match = String(value || '').match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (!match) return null;
  const alpha = match[4] == null ? 1 : match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
}
export function colorContrastRatio(foreground, background) {
  const fg = parseCssColor(foreground), bg = parseCssColor(background);
  if (!fg || !bg) return 0;
  const under = { r: 255, g: 255, b: 255 };
  const composite = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
  });
  const opaqueBg = composite(bg, under), opaqueFg = composite(fg, opaqueBg);
  const luminance = ({ r, g, b }) => [r, g, b].map(value => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const first = luminance(opaqueFg), second = luminance(opaqueBg);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export function waitForPopup(page, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Native full-screen popup did not open within ${timeoutMs}ms`)), timeoutMs);
    page.once('popup', popup => { clearTimeout(timer); resolve(popup); });
  });
}
export async function createIsolatedNativeFixtures({ directory = SESSION_DIR, seed = 318, sourceRoot = SOURCE } = {}) {
  const [{ loadData }, { getResonanceCatalog }, { createSession, applyAction, validateSession }, { getResonanceField }] = await Promise.all([
    import(pathToFileURL(path.join(sourceRoot, 'server/data.js')).href), import(pathToFileURL(path.join(sourceRoot, 'server/modes/resonance/catalog.js')).href),
    import(pathToFileURL(path.join(sourceRoot, 'server/modes/resonance/session.js')).href), import(pathToFileURL(path.join(sourceRoot, 'server/modes/resonance/battle.js')).href),
  ]);
  const { effectiveDeployCapacity } = await import(pathToFileURL(path.join(sourceRoot, 'server/modes/resonance/session.js')).href);
  await mkdir(directory, { recursive: true });
  const data = loadData(DATA), files = {};
  const writeFixture = async (name, state, catalog) => {
    const validation = validateSession(state, { catalog });
    assert(validation.ok, `${name} fixture is invalid: ${JSON.stringify(validation.errors)}`);
    const id = randomUUID(), target = path.join(directory, `${id}.json`);
    await writeFile(target, JSON.stringify(state), { flag: 'wx' });
    files[name] = { id, path: target, seed: state.seed, round: state.round };
    return id;
  };

  const choiceCatalog = getResonanceCatalog(data, { rulesVersion: 3, seed });
  const choiceCreated = createSession({ seed, difficulty: 'NORMAL', catalog: choiceCatalog });
  assert(choiceCreated.ok, `choice fixture creation failed: ${choiceCreated.error}`);
  const choiceState = choiceCreated.state;
  const marketOption = choiceCatalog.prototypeEconomy?.chemBaron?.marketOptionsByThreshold?.['100']?.find((row) => row.grant?.length);
  assert(marketOption, 'source-backed Chem market option is unavailable');
  choiceState.prototypeMeta.economy.chemBaron.shimmer = 100;
  choiceState.pendingChoices.push({ uid: `c${choiceState.nextUid++}`, type: 'prototype_economy', source: 'risk', economyKind: 'chem_market',
    options: [marketOption.id], remaining: 1,
    metadata: { key: `native-live:${seed}:chem100`, marketIndex: 1, shimmer: 100, threshold: 100,
      optionDetails: [structuredClone(marketOption)] } });
  choiceState.phase = 'choice';
  const choiceId = await writeFixture('choice', choiceState, choiceCatalog);

  const scrapSeed = seed + 3;
  const scrapCatalog = getResonanceCatalog(data, { rulesVersion: 3, seed: scrapSeed });
  const scrapCreated = createSession({ seed: scrapSeed, difficulty: 'NORMAL', catalog: scrapCatalog });
  assert(scrapCreated.ok, `Scrap fixture creation failed: ${scrapCreated.error}`);
  const scrapState = scrapCreated.state;
  const initialScrapPieces = [...scrapState.pieces];
  for (const piece of initialScrapPieces) scrapState.poolRemaining[piece.operatorId] = (scrapState.poolRemaining[piece.operatorId] ?? 0) + 1;
  const scrapMembers = scrapCatalog.pacts?.rhodes?.members?.slice(0, 2) ?? [];
  assert(scrapMembers.length === 2, 'two distinct natural Rhodes/Scrap operators are required');
  const scrapTemplate = structuredClone(initialScrapPieces[0]);
  scrapState.pieces = scrapMembers.map((operatorId, index) => {
    assert((scrapState.poolRemaining[operatorId] ?? 0) > 0, `Scrap member pool is empty: ${operatorId}`);
    scrapState.poolRemaining[operatorId]--;
    return { ...structuredClone(scrapTemplate), uid: `p${scrapState.nextUid++}`, operatorId, star: 1,
      equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT', benchSlot: index };
  });
  const scrapHolder = scrapState.pieces[0];
  const scrapComponent = scrapState.inventory.find((item) => scrapCatalog.equipment?.[item.itemId]?.kind === 'component'
    && scrapCatalog.recipes?.some((recipe) => recipe.parts?.includes(item.itemId)));
  assert(scrapComponent, 'Scrap fixture needs a canonical component with a real recipe');
  const scrapEquip = applyAction(scrapState, { type: 'equip', pieceUid: scrapHolder.uid, itemUid: scrapComponent.uid }, {
    catalog: scrapCatalog, recording: false,
  });
  assert(scrapEquip.ok, `Scrap fixture legal component equip failed: ${scrapEquip.error}`);
  Object.assign(scrapState, scrapEquip.state);
  const scrapField = getResonanceField(scrapState, { data, catalog: scrapCatalog });
  const scrapOccupied = new Set();
  for (const piece of scrapState.pieces) {
    const operator = scrapCatalog.operators[piece.operatorId];
    const candidate = [...scrapField.deployMap].find(([key, tile]) => {
      if (scrapOccupied.has(key)) return false;
      const kind = String(tile?.class ?? tile?.type ?? tile?.position ?? tile?.kind ?? tile).toUpperCase();
      return operator.position === 'RANGED' || kind === 'MELEE' || (kind === 'RANGED' && operator.canDeployHighGround === true);
    });
    assert(candidate, `no legal Scrap fixture deployment tile for ${piece.operatorId}`);
    const [row, col] = candidate[0].split(',').map(Number);
    const deployed = applyAction(scrapState, { type: 'deploy', pieceUid: piece.uid, row, col, dir: 'RIGHT' }, {
      catalog: scrapCatalog, fieldResolver: () => scrapField, recording: false,
    });
    assert(deployed.ok, `Scrap fixture legal deployment failed: ${deployed.error}`);
    Object.assign(scrapState, deployed.state); scrapOccupied.add(candidate[0]);
  }
  const scrapPossibleResults = scrapCatalog.recipes.filter((recipe) => recipe.parts?.includes(scrapComponent.itemId)).map((recipe) => recipe.resultId);
  assert(scrapPossibleResults.length > 0, `Scrap component has no canonical completed-item recipe: ${scrapComponent.itemId}`);
  // Exercise the Resonance carry-over economy with a real positive bank balance.
  // This is an isolated, validated prep fixture, not a combat/result injection.
  scrapState.gold = 1;
  const scrapId = await writeFixture('scrap', scrapState, scrapCatalog);

  const emissaryCatalog = getResonanceCatalog(data, { rulesVersion: 3, seed: seed + 1 });
  const emissaryCreated = createSession({ seed: seed + 1, difficulty: 'NORMAL', catalog: emissaryCatalog });
  assert(emissaryCreated.ok, `Emissary fixture creation failed: ${emissaryCreated.error}`);
  const emissaryState = emissaryCreated.state;
  for (const piece of emissaryState.pieces) emissaryState.poolRemaining[piece.operatorId]++;
  const memberIds = emissaryCatalog.pacts?.emissary?.members?.slice(0, 3) ?? [];
  assert(memberIds.length === 3, 'three distinct natural Emissary operators are required');
  const template = structuredClone(emissaryState.pieces[0]);
  emissaryState.pieces = memberIds.map((operatorId, index) => {
    assert((emissaryState.poolRemaining[operatorId] ?? 0) > 0, `Emissary pool is empty: ${operatorId}`);
    emissaryState.poolRemaining[operatorId]--;
    return { ...structuredClone(template), uid: `p${emissaryState.nextUid++}`, operatorId, star: 1, equipment: [], growth: {},
      row: null, col: null, dir: 'RIGHT', benchSlot: index };
  });
  const field = getResonanceField(emissaryState, { data, catalog: emissaryCatalog });
  const used = new Set();
  for (const piece of emissaryState.pieces) {
    const operator = emissaryCatalog.operators[piece.operatorId];
    const candidate = [...field.deployMap].find(([key, tile]) => {
      if (used.has(key)) return false;
      const kind = String(tile?.class ?? tile?.type ?? tile?.position ?? tile?.kind ?? tile).toUpperCase();
      return operator.position === 'RANGED' || kind === 'MELEE' || (kind === 'RANGED' && operator.canDeployHighGround === true);
    });
    assert(candidate, `no legal Emissary deploy tile for ${piece.operatorId}`);
    const [row, col] = candidate[0].split(',').map(Number);
    const deployed = applyAction(emissaryState, { type: 'deploy', pieceUid: piece.uid, row, col, dir: 'RIGHT' }, {
      catalog: emissaryCatalog, fieldResolver: () => field, recording: false,
    });
    assert(deployed.ok, `legal Emissary fixture deployment failed: ${deployed.error}`);
    Object.assign(emissaryState, deployed.state); used.add(candidate[0]);
  }
  assert(emissaryState.pieces.filter((piece) => piece.row !== null).length === 3, 'all natural Emissary fixture members must be deployed');
  const emissaryId = await writeFixture('emissary3', emissaryState, emissaryCatalog);

  const emissaryFour = emissaryCatalog.pacts?.emissary?.members?.[3];
  assert(emissaryFour, 'fourth natural Emissary operator is required for exact-four activation');
  emissaryState.gold += 20;
  while (effectiveDeployCapacity(emissaryState) < 4) {
    const boughtXp = applyAction(emissaryState, { type: 'buyXp' }, { catalog: emissaryCatalog, recording: false });
    assert(boughtXp.ok, `legal Emissary fixture XP purchase failed: ${boughtXp.error}`);
    Object.assign(emissaryState, boughtXp.state);
  }
  assert((emissaryState.poolRemaining[emissaryFour] ?? 0) > 0, `Emissary pool is empty: ${emissaryFour}`);
  emissaryState.poolRemaining[emissaryFour]--;
  const fourthPiece = { ...structuredClone(template), uid: `p${emissaryState.nextUid++}`, operatorId: emissaryFour, star: 1,
    equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT', benchSlot: 3 };
  emissaryState.pieces.push(fourthPiece);
  const fourthOperator = emissaryCatalog.operators[emissaryFour];
  const fourthCell = [...field.deployMap].find(([key, tile]) => {
    if (used.has(key)) return false;
    const kind = String(tile?.class ?? tile?.type ?? tile?.position ?? tile?.kind ?? tile).toUpperCase();
    return fourthOperator.position === 'RANGED' || kind === 'MELEE' || (kind === 'RANGED' && fourthOperator.canDeployHighGround === true);
  });
  assert(fourthCell, `no legal fourth Emissary tile for ${emissaryFour}`);
  const [fourthRow, fourthCol] = fourthCell[0].split(',').map(Number);
  const fourthDeployed = applyAction(emissaryState, { type: 'deploy', pieceUid: fourthPiece.uid, row: fourthRow, col: fourthCol, dir: 'RIGHT' }, {
    catalog: emissaryCatalog, fieldResolver: () => field, recording: false,
  });
  assert(fourthDeployed.ok, `legal fourth Emissary deployment failed: ${fourthDeployed.error}`);
  Object.assign(emissaryState, fourthDeployed.state);
  const emissaryFourId = await writeFixture('emissary4', emissaryState, emissaryCatalog);

  const report = JSON.parse(await readFile(path.join(ROOT, '.omni/tmp/resonance/native-natural-campaign.json'), 'utf8'));
  const finalFixture = report.nativeFinalFixtures?.at(-1);
  assert(finalFixture?.status === 'captured', 'natural final-boss fixture is unavailable');
  const finalCatalog = getResonanceCatalog(data, { rulesVersion: 3, seed: finalFixture.seed });
  const finalState = structuredClone(finalFixture.preFightSession);
  const validStrategyIds = new Set(Object.keys(finalCatalog.strategies || {}));
  finalState.strategies = (finalState.strategies || []).filter((entry) => validStrategyIds.has(typeof entry === 'string' ? entry : entry?.id));
  finalState.strategyState = Object.fromEntries(Object.entries(finalState.strategyState || {}).filter(([id]) => validStrategyIds.has(id)));
  const finalId = await writeFixture('finalBoss', finalState, finalCatalog);

  const hiddenSeed = seed + 2;
  const hiddenCatalog = getResonanceCatalog(data, { rulesVersion: 3, seed: hiddenSeed });
  const hiddenCreated = createSession({ seed: hiddenSeed, difficulty: 'ABYSS', catalog: hiddenCatalog });
  assert(hiddenCreated.ok, `hidden-core fixture creation failed: ${hiddenCreated.error}`);
  let hiddenState = hiddenCreated.state;
  hiddenState.round = 30; hiddenState.gold = 100;
  while (hiddenState.level < 6) {
    const leveled = applyAction(hiddenState, { type: 'buyXp' }, { catalog: hiddenCatalog, recording: false });
    assert(leveled.ok, `hidden fixture XP setup failed: ${leveled.error}`); hiddenState = leveled.state;
  }
  let refreshes = 0;
  while (hiddenState.pieces.length < 6 && refreshes < 20) {
    const owned = new Set(hiddenState.pieces.map((piece) => piece.operatorId));
    const offer = hiddenState.shop.offers.find((entry) => entry.operatorId && !owned.has(entry.operatorId));
    if (offer) {
      const bought = applyAction(hiddenState, { type: 'buy', offerUid: offer.uid }, { catalog: hiddenCatalog, recording: false });
      assert(bought.ok, `hidden fixture roster buy failed: ${bought.error}`); hiddenState = bought.state;
    } else {
      const refreshed = applyAction(hiddenState, { type: 'refresh' }, { catalog: hiddenCatalog, recording: false });
      assert(refreshed.ok, `hidden fixture shop refresh failed: ${refreshed.error}`); hiddenState = refreshed.state; refreshes++;
    }
  }
  assert(hiddenState.pieces.length >= 6, 'hidden fixture needs six naturally bought operators');
  const hiddenField = getResonanceField(hiddenState, { data, catalog: hiddenCatalog }), hiddenUsed = new Set();
  for (const piece of [...hiddenState.pieces]) {
    const operator = hiddenCatalog.operators[piece.operatorId];
    const candidate = [...hiddenField.deployMap].find(([key, tile]) => {
      if (hiddenUsed.has(key)) return false;
      const kind = String(tile?.class ?? tile?.type ?? tile?.position ?? tile?.kind ?? tile).toUpperCase();
      return operator.position === 'RANGED' || kind === 'MELEE' || (kind === 'RANGED' && operator.canDeployHighGround === true);
    });
    assert(candidate, `hidden fixture has no legal deploy tile for ${piece.operatorId}`);
    const [row, col] = candidate[0].split(',').map(Number);
    const deployed = applyAction(hiddenState, { type: 'deploy', pieceUid: piece.uid, row, col, dir: 'RIGHT' }, {
      catalog: hiddenCatalog, fieldResolver: () => hiddenField, recording: false,
    });
    assert(deployed.ok, `hidden fixture deployment failed: ${deployed.error}`); hiddenState = deployed.state; hiddenUsed.add(candidate[0]);
  }
  const hiddenGear = hiddenState.inventory[0];
  if (hiddenGear && hiddenState.pieces[0]) {
    const equipped = applyAction(hiddenState, { type: 'equip', pieceUid: hiddenState.pieces[0].uid, itemUid: hiddenGear.uid }, { catalog: hiddenCatalog, recording: false });
    assert(equipped.ok, `hidden fixture equipment setup failed: ${equipped.error}`); hiddenState = equipped.state;
  }
  // This is a late-campaign low-health scenario so the native hidden-core
  // overtime can reach a real terminal outcome within the fixture window.
  hiddenState.hp = 20;
  const hiddenId = await writeFixture('hiddenCore', hiddenState, hiddenCatalog);
  files.hiddenCore.scenario = 'late-campaign-low-health';
  files.hiddenCore.startingHp = hiddenState.hp;
  const chemRows = Object.values(choiceCatalog.equipment).filter((item) => item.prototypeEconomyTier);
  const chemMissing = chemRows.filter((item) => !/[0-9]/.test(item.description ?? '') || /undefined|@placeholder/i.test(item.description ?? ''));
  assert(chemRows.length === 28 && chemMissing.length === 0, `Chem numeric descriptions incomplete: ${chemRows.length}/28, ${chemMissing.length} invalid`);
  return { files, ids: { choice: choiceId, scrap: scrapId, emissary3: emissaryId, emissary4: emissaryFourId, finalBoss: finalId, hiddenCore: hiddenId },
    scrap: { file: files.scrap, stageId: scrapState.field?.stageId ?? scrapField.stageId, pieceUid: scrapHolder.uid,
      operatorId: scrapHolder.operatorId, componentUid: scrapComponent.uid, componentId: scrapComponent.itemId, possibleResultIds: scrapPossibleResults,
      sourceMemberIds: [...scrapMembers],
      persistedEquipment: structuredClone(scrapState.pieces.find((piece) => piece.uid === scrapHolder.uid)?.equipment ?? []) },
    finalExpected: finalFixture.expected, chemItems: chemRows.map(({ id, name, description }) => ({ id, name, description })),
    chemItemCount: chemRows.length, hiddenRound: hiddenState.round };
}
export function config(sourceRoot = SOURCE, receiptTag = '') {
  const artifacts = artifactPaths(receiptTag);
  return { source: sourceRoot, canonicalInstallDir: ROOT, dataDir: DATA, sessionDirectory: SESSION_DIR, browserProfile: PROFILE,
    port: PORT, deadlineMs: DEADLINE_MS, receipt: artifacts.receipt, receiptTag, log: LOG, screenshots: artifacts.screenshots, supplementalScreenshots: artifacts.supplementalScreenshots,
    serverMount: { publicDir: path.join(sourceRoot, 'public'), installDirReadOnlyFallback: ROOT }, browserStarted: false };
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function deployThree(page, state, attempt) {
  await page.waitForFunction(() => !document.querySelector('.pbanner--overlay')
    && !!document.querySelector('.gm__field canvas')
    && typeof globalThis.__SP_VIEW__?.pieceScreenRect === 'function'
    && typeof globalThis.__SP_VIEW__?.tileScreen === 'function', { polling: 'raf', timeout: 35_000 });
  await page.evaluate(() => {
    if (window.__spDragCapture || !globalThis.__SP_VIEW__?.on) return;
    window.__spDragCapture = true; window.__spNativeDragEvents = [];
    for (const name of ['pieceDragStart','pieceDrop','pieceDragEnd','tileHover']) globalThis.__SP_VIEW__.on(name, (event) => {
      window.__spNativeDragEvents.push({ name, uid:event?.uid, dropped:event?.dropped, target:event?.target, row:event?.row, col:event?.col });
    });
  });
  const occupied = new Set();
  for (const piece of state.pieces.filter((row) => row.row == null).slice(0, 3)) {
    const numeric = Number(piece.nativeUid);
    assert(Number.isSafeInteger(numeric), `native UID missing for ${piece.uid}`);
    let geometry;
    try { geometry = await page.waitForFunction(({ numeric, tiles }) => {
      const view = globalThis.__SP_VIEW__, canvas = document.querySelector('.gm__field canvas');
      const rect = view?.pieceScreenRect?.(numeric); if (!rect || !canvas) return false;
      let source = null;
      for (let y=rect.top+2;y<rect.bottom-2&&!source;y+=4) for(let x=rect.left+2;x<rect.right-2;x+=4) {
        if(Number(view.pieceAtClient?.(x,y)?.uid)===numeric&&document.elementFromPoint(x,y)?.tagName==='CANVAS'){source={x,y};break;}
      }
      if (!source) return false;
      for (const key of tiles) {
        const [row, col] = key.split(',').map(Number), target = view.tileScreen?.(row, col);
        if (target && document.elementFromPoint(target.x, target.y)?.tagName === 'CANVAS') return { source, target, row, col };
      }
      return false;
    }, { polling: 'raf', timeout: 12_000 }, { numeric, tiles: (piece.legalTiles || []).filter((tile) => !occupied.has(tile)) }).then((handle) => handle.jsonValue()); }
    catch (error) {
      const debug = await page.evaluate(({ numeric, tiles }) => {
        const view = globalThis.__SP_VIEW__, canvas = document.querySelector('.gm__field canvas');
        const rect = view?.pieceScreenRect?.(numeric), tile = tiles.map((key) => { const [r,c]=key.split(',').map(Number);const p=view?.tileScreen?.(r,c);return p?{r,c,x:p.x,y:p.y,hit:document.elementFromPoint(p.x,p.y)?.tagName}:null; }).filter(Boolean);
        const pickPoints=[];if(rect)for(let y=rect.top+2;y<rect.bottom-2;y+=8)for(let x=rect.left+2;x<rect.right-2;x+=8){const hit=view?.pieceAtClient?.(x,y);if(hit)pickPoints.push({x,y,hit});if(pickPoints.length>=8)break;}
        return { numeric, rect, sourceHit:rect?document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.tagName:null,
          picked:rect?view?.pieceAtClient?.(rect.x+rect.width/2,rect.y+rect.height/2):null,pickPoints,
          canvas:canvas?{width:canvas.width,height:canvas.height,rect:canvas.getBoundingClientRect().toJSON()}:null,tile,dragEvents:window.__spNativeDragEvents,ready:document.body.innerText.slice(-400) };
      }, { numeric, tiles:(piece.legalTiles||[]).filter((tile)=>!occupied.has(tile)) });
      throw new Error(`native deploy geometry unavailable for ${piece.uid}; ${JSON.stringify({ nativeUid:numeric, legalTiles:piece.legalTiles, debug })}; ${error.message}`);
    }
    await page.mouse.click(geometry.source.x, geometry.source.y);
    await sleep(120);
    const moveOffset = attempt.ws.sent.length;
    await page.keyboard.press('w');
    await page.waitForFunction(async ({ id, uid }) => {
      const packet=await (await fetch(`/resonance/api/sessions/${id}`)).json();
      return packet.state?.pieces?.some((entry) => entry.uid===uid && entry.row!=null);
    }, { timeout: 12_000 }, { id:new URL(page.url()).searchParams.get('session'), uid:piece.uid });
    const action = attempt.ws.sent.slice(moveOffset).find((message) => message.t==='g.move');
    assert(action, `W deployment did not send g.move for ${piece.uid}`);
    const detailClose = await page.$('.dpanel__close');
    if (detailClose) await detailClose.click();
    occupied.add(`${geometry.row},${geometry.col}`);
    await page.waitForFunction(async ({ id, uid, row, col }) => {
      const packet = await (await fetch(`/resonance/api/sessions/${id}`)).json();
      const found = packet.state?.pieces.find((entry) => entry.uid === uid);
      return found?.row === row && found?.col === col;
    }, { timeout: 12_000 }, { id: new URL(page.url()).searchParams.get('session'), uid: piece.uid, row: geometry.row, col: geometry.col });
  }
  return occupied.size;
}

async function clickRealShopCard(page, beforeRevision, attempt, waitSent) {
  const card = await page.$('.shopbar__cards .scard:not(.scard--sold)'); assert(card, 'no visible unsold shop card');
  const offset = attempt.ws.sent.length;
  await card.click();
  const buy = await waitSent(attempt, 'g.buy', 8_000, offset);
  assert(buy, 'one native shop click did not send g.buy');
  await page.waitForFunction(async (revision) => {
    const id = new URL(location.href).searchParams.get('session'), packet = await (await fetch(`/resonance/api/sessions/${id}`)).json();
    return Number(packet.state?.revision) > revision;
  }, { timeout: 8_000 }, beforeRevision);
  return { buy, clickCount: 1 };
}
async function openPieceDetailAndMeasureShop(page, pieces) {
  const target=pieces.find(piece=>piece.row!=null&&Number.isSafeInteger(Number(piece.nativeUid)));
  assert(target, 'no deployed piece with native UID for detail-panel hit test');
  const point=await page.waitForFunction(({uid})=>{
    const view=globalThis.__SP_VIEW__,canvas=document.querySelector('.gm__field canvas'),rect=view?.pieceScreenRect?.(uid);
    if(!rect||!canvas)return false;
    for(let y=rect.top+2;y<rect.bottom-2;y+=3)for(let x=rect.left+2;x<rect.right-2;x+=3)
      if(document.elementFromPoint(x,y)?.tagName==='CANVAS'&&Number(view.pieceAtClient?.(x,y)?.uid)===uid)return{x,y};
    return false;
  },{polling:'raf',timeout:8_000},{uid:Number(target.nativeUid)}).then(handle=>handle.jsonValue());
  await page.mouse.click(point.x,point.y,{button:'right'});
  await page.waitForSelector('.dpanel:not(.dpanel--right)',{timeout:6_000});
  return page.evaluate(()=>{
    const panel=document.querySelector('.dpanel:not(.dpanel--right)'),shop=document.querySelector('.shopbar');
    const rect=e=>{const r=e?.getBoundingClientRect();return r&&{top:r.top,bottom:r.bottom,left:r.left,right:r.right}};
    const a=rect(panel),b=rect(shop),overlap=!!a&&!!b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    const cards=[...document.querySelectorAll('.shopbar__cards .scard:not(.scard--sold)')];
    const usable=cards.filter(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return hit&&(hit===e||e.contains(hit))}).length;
    const rail=[...document.querySelectorAll('.rs-native-equipment-rail .rs-equipment-dock__item')].filter(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.width>0&&hit&&(hit===e||e.contains(hit))}).length;
    return{detailVisible:!!a&&a.right>a.left,shopVisible:!!b&&b.right>b.left,overlap,usable,cards:cards.length,railReachable:rail};
  });
}
export async function nativePiecePoint(page, uid) {
  return page.waitForFunction(({ uid }) => {
    const view=globalThis.__SP_VIEW__,rect=view?.pieceScreenRect?.(uid);
    if(!rect)return false;
    for(let y=rect.top+2;y<rect.bottom-2;y+=3)for(let x=rect.left+2;x<rect.right-2;x+=3)
      if(document.elementFromPoint(x,y)?.tagName==='CANVAS'&&Number(view.pieceAtClient?.(x,y)?.uid)===uid)return{x,y};
    return false;
  },{polling:'raf',timeout:8_000},{uid:Number(uid)}).then(handle=>handle.jsonValue());
}
async function clickVisibleButtonText(page, pattern) {
  const buttons = await page.$$('button');
  for (const button of buttons) {
    const text = (await button.evaluate(node => node.innerText || '')).trim();
    if (!pattern.test(text) || await button.evaluate(node => node.disabled)) continue;
    const box = await button.boundingBox(); if (!box) continue;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return { text, point: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
  }
  throw new Error(`no visible enabled button matched ${pattern}`);
}
async function clickHandleByMeasuredCenter(page, handle, label) {
  assert(handle, `${label} has no target element`);
  await handle.evaluate(node => new Promise(resolve => {
    node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const box = await handle?.boundingBox();
  assert(box && box.width > 0 && box.height > 0, `${label} has no visible hitbox`);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const hit = await handle.evaluate((target, { x, y }) => {
    const node = document.elementFromPoint(x, y);
    const scrollAncestors = [];
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), canScroll = /(auto|scroll)/.test(`${style.overflowY} ${style.overflowX}`);
      if (canScroll) scrollAncestors.push({ className: typeof parent.className === 'string' ? parent.className : '', scrollTop: parent.scrollTop, clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight });
    }
    return { inside: !!node && (node === target || target.contains(node)), tag: node?.tagName || null,
      text: (node?.innerText || node?.textContent || '').trim().slice(0, 120), className: node?.className || '', scrollAncestors };
  }, point);
  assert(hit.inside, `${label} center is occluded or targets a different control: ${JSON.stringify({ point, hit })}`);
  await page.mouse.click(point.x, point.y);
  return { point, hit };
}
export async function waitSent(attempt, type, timeoutMs = 8_000, fromIndex = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = attempt.ws.sent.slice(fromIndex).find((message) => message.t === type);
    if (found) return found;
    await sleep(80);
  }
  return null;
}
export async function waitSentWhere(attempt, predicate, timeoutMs = 8_000, fromIndex = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = attempt.ws.sent.slice(fromIndex).find(predicate);
    if (found) return found;
    await sleep(50);
  }
  return null;
}
export async function waitReceived(attempt, type, timeoutMs = 8_000, fromIndex = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = attempt.ws.received.slice(fromIndex).find((message) => message.t === type);
    if (found) return found;
    await sleep(50);
  }
  return null;
}
export async function waitReceivedWhere(attempt, predicate, timeoutMs = 8_000, fromIndex = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = attempt.ws.received.slice(fromIndex).find(predicate);
    if (found) return found;
    await sleep(50);
  }
  return null;
}

export async function attachWsCapture(page, attempt, onSent = null) {
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  const append = (direction, event) => {
    try {
      const wireText = event.response?.payloadData ?? event.response?.payload ?? '';
      const message = JSON.parse(wireText);
      const row = { t: message.t, action: message.action?.type || null, at: now(), direction,
        phase: message.phase || message.nativePhase || null, round: message.round ?? null,
        battleId: message.battleId || null, progress: message.progress || null,
        kind: message.kind ?? null, specKind: message.spec?.kind ?? null,
        specStageId: message.spec?.stageId ?? null, specRound: message.spec?.round ?? null,
        error: message.error || message.code || null, detail: message.detail || null, rid: message.rid ?? null,
        ready: message.ready ?? null, paused: typeof message.on === 'boolean' ? message.on : (typeof message.paused === 'boolean' ? message.paused : null),
        speed: [1,2,4,32].includes(Number(message.speed)) ? Number(message.speed) : null, finish: message.finish === true,
        gt: Number.isFinite(message.gt) ? message.gt : null, elapsed: Number.isFinite(message.elapsed) ? message.elapsed : null,
        setupRevision: message.setupRevision ?? null };
      if (direction === 'sent' && message.t === 'b.result') {
        const result = message.result ?? {};
        const perPlayer = Object.values(result.perPlayer ?? {});
        const mode = result.resonance ?? {};
        row.resultFrameBytes = new TextEncoder().encode(wireText).byteLength;
        row.resultStatsCount = perPlayer.reduce((sum, player) => sum + (Array.isArray(player?.unitStats) ? player.unitStats.length : 0), 0);
        row.resultDamageSum = perPlayer.reduce((sum, player) => sum
          + (Array.isArray(player?.unitStats) ? player.unitStats.reduce((subtotal, unit) => subtotal + (Number(unit?.dmg) || 0), 0) : 0), 0);
        row.resultModeQueueCounts = Object.fromEntries(['growth', 'coins', 'forge', 'contributions']
          .map((key) => [key, Array.isArray(mode[key]) ? mode[key].length : 0]));
        row.resultMetricsKeyCount = Object.keys(mode.metrics ?? {}).length;
      }
      if (direction === 'received' && message.t === 'm.result') row.resultSummary = projectNativeResultSummary(message);
      if (direction === 'sent') { attempt.ws.sent.push(row); onSent?.(message); }
      else attempt.ws.received.push(row);
    } catch {}
  };
  cdp.on('Network.webSocketFrameReceived', (event) => append('received', event));
  cdp.on('Network.webSocketFrameSent', (event) => append('sent', event));
  cdp.on('Network.webSocketCreated', (event) => { attempt.ws.connections ??= []; attempt.ws.connections.push(event.url); });
  return cdp;
}

async function dragInventoryItemToPiece(page, itemUid, pieceUid) {
  const geometry = await page.waitForFunction(({ itemUid, pieceUid }) => {
    const sources = [...document.querySelectorAll(`.rs-native-equipment-rail .rs-equipment-dock__item[data-item-uid="${CSS.escape(String(itemUid))}"]`)];
    const source = sources.find(node => { const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.width>0&&r.height>0&&hit&&(hit===node||node.contains(hit)); });
    const view = globalThis.__SP_VIEW__, rect = view?.pieceScreenRect?.(Number(pieceUid));
    const canvas = document.querySelector('.gm__field canvas');
    if (!source || !rect || !canvas) return false;
    const a = source.getBoundingClientRect(); let from=null;
    for(let y=a.top+2;y<a.bottom-2&&!from;y+=2)for(let x=a.left+2;x<a.right-2;x+=2){
      const hit=document.elementFromPoint(x,y);if(hit&&(hit===source||source.contains(hit))){from={x,y};break;}
    }
    if(!from)return false;
    let to = null;
    const top = rect.top ?? rect.y, left = rect.left ?? rect.x, right = rect.right ?? rect.x + rect.width, bottom = rect.bottom ?? rect.y + rect.height;
    for(let y=top+2;y<bottom-2&&!to;y+=4) for(let x=left+2;x<right-2;x+=4) {
      if(document.elementFromPoint(x,y)?.tagName==='CANVAS' && Number(view.pieceAtClient?.(x,y)?.uid)===Number(pieceUid)) { to={x,y}; break; }
    }
    return to ? { from, to, source:{draggable:source.draggable,owner:source.closest('.dpanel')?.className||null,rect:a.toJSON(),hit:document.elementFromPoint(from.x,from.y)?.className||document.elementFromPoint(from.x,from.y)?.tagName||null}, candidates:sources.map(node=>{const r=node.getBoundingClientRect();return{draggable:node.draggable,owner:node.closest('.dpanel')?.className||null,rect:r.toJSON()}}) } : false;
  }, { polling: 'raf', timeout: 12_000 }, { itemUid, pieceUid }).then((handle) => handle.jsonValue());
  await page.mouse.move(geometry.from.x, geometry.from.y); await sleep(100);
  const refreshed=await page.evaluate(({itemUid})=>{
    const source=[...document.querySelectorAll(`.rs-native-equipment-rail .rs-equipment-dock__item[data-item-uid="${CSS.escape(String(itemUid))}"]`)].find(node=>node.draggable&&node.getBoundingClientRect().width>0);
    if(!source)return null;const r=source.getBoundingClientRect();
    for(let y=r.top+2;y<r.bottom-2;y+=2)for(let x=r.left+2;x<r.right-2;x+=2){const hit=document.elementFromPoint(x,y);if(hit&&(hit===source||source.contains(hit)))return{x,y,hit:hit.tagName};}
    return null;
  },{itemUid});
  assert(refreshed,`equipment item lost its hit target after hover: ${JSON.stringify(geometry.source)}`);
  await page.mouse.move(refreshed.x,refreshed.y); await page.mouse.down();
  await page.mouse.move(refreshed.x+3,refreshed.y+3,{steps:2});
  await page.mouse.move(geometry.to.x, geometry.to.y, { steps: 12 }); await page.mouse.up();
  return {...geometry,refreshed};
}
async function dragInventoryItemsToCombine(page, firstUid, secondUid) {
  await page.waitForFunction(() => [...document.querySelectorAll('.rs-native-resonance-panel .rs-equipment-dock__item')].length > 1
    && [...document.querySelectorAll('.rs-native-resonance-panel .rs-equipment-dock__item')].every(node => node.draggable), { timeout: 5_000 });
  const first = await page.$(`.rs-native-resonance-panel .rs-equipment-dock__item[data-item-uid="${firstUid}"]`);
  const second = await page.$(`.rs-native-resonance-panel .rs-equipment-dock__slot[data-item-uid="${secondUid}"]`);
  assert(first && second, `inventory combine items not rendered: ${firstUid}, ${secondUid}`);
  const a = await first.boundingBox(), b = await second.boundingBox(); assert(a && b, 'inventory combine items are not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 }); await page.mouse.up();
}
function recipePair(state, catalog) {
  return (catalog?.recipes || []).map((recipe) => {
    const chosen = [];
    for (const part of recipe.parts || []) {
      const item = (state?.inventory || []).find((entry) => entry.itemId === part && !chosen.some((found) => found.uid === entry.uid));
      if (item) chosen.push(item);
    }
    return recipe.parts?.length === 2 && chosen.length === 2 ? { recipe, chosen } : null;
  }).find(Boolean) || null;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const sourceRoot = options.sourceRoot;
  const artifacts = artifactPaths(options.receiptTag);
  const receiptPath = artifacts.receipt, screenshots = artifacts.screenshots, supplementalScreenshots = artifacts.supplementalScreenshots;
  if (!options.execute) { process.stdout.write(`${JSON.stringify({ valid: true, ...config(sourceRoot, options.receiptTag), mode: 'prepare-only' })}\n`); return; }
  assert(existsSync(path.join(sourceRoot, 'public/resonance.html')), `${sourceRoot} public/resonance.html is missing`);
  assert(existsSync(path.join(ROOT, 'public')), 'canonical shared public fallback is missing');
  assert(existsSync(DATA), 'canonical Resonance data directory is missing');
  await mkdir(OUT, { recursive: true }); await mkdir(SESSION_DIR, { recursive: true }); await mkdir(path.dirname(LOG), { recursive: true });
  // Use the one fixed canonical profile; create this exact path once if absent, never a retry profile.
  await mkdir(PROFILE, { recursive: true });
  const attempt = { startedAt: now(), receiptTag: options.receiptTag || null, source: sourceRoot, sourceRevision: execFileSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true,timeout:10_000}).trim(), installDir: ROOT, sessionDirectory: SESSION_DIR, port: PORT,
    status: 'running', checks: {}, screenshots: {}, ws: { sent: [], received: [] }, failures: [], fixtures: { fifthChoice: 'not-run', bossHidden: 'not-run' } };
  const receipt = existsSync(receiptPath) ? JSON.parse(await readFile(receiptPath, 'utf8')) : { checker: 'native-live-ui-check', receiptTag: options.receiptTag || null, attempts: [] };
  assert(receipt.checker === 'native-live-ui-check' && Array.isArray(receipt.attempts), `existing receipt has incompatible shape: ${receiptPath}`);
  for (const file of [...Object.values(screenshots), ...Object.values(supplementalScreenshots)]) if (existsSync(file)) {
    assert(screenshotOverwriteOwner(receipt, file), `refusing to overwrite screenshot not owned by this checker's receipt: ${file}`);
    const info = await lstat(file);
    assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, `refusing to overwrite non-regular, linked, or reparse screenshot: ${file}`);
  }
  receipt.attempts.push(attempt);
  const log = [`${attempt.startedAt} start native live UI E2E`, `source=${sourceRoot}`, `installDir=${ROOT}`, `publicDir=${path.join(sourceRoot, 'public')}`, `data=${DATA}`, `sessions=${SESSION_DIR}`, `port=${PORT}`];
  let browser, server, deadline, timedOut = false, page;
  const errors = [], badResponses = [], forbiddenRequests = [];
  const save = async () => writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const check = (name, passed, evidence = null) => { attempt.checks[name] = { status: passed ? 'passed' : 'failed', evidence }; if (!passed) throw new Error(`${name}: ${JSON.stringify(evidence)}`); };
  const capture = async (name) => {
    const file = screenshots[name] || supplementalScreenshots[name]; assert(file, `capture slot is unknown: ${name}`);
    if (existsSync(file)) {
      assert(screenshotOverwriteOwner(receipt, file), `screenshot is not recorded by an earlier check attempt: ${file}`);
      const info = await lstat(file);
      assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, `refusing linked screenshot replacement: ${file}`);
    }
    const typography = await page.evaluate(() => {
      const textRows=[];
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      const hidden=node=>{for(let el=node.parentElement;el&&el!==document.body;el=el.parentElement){const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||el.getAttribute('aria-hidden')==='true'||el.closest('svg,script,style,noscript'))return true;}return false;};
      for(let node; (node=walker.nextNode());){const text=(node.nodeValue||'').replace(/\s+/g,' ').trim();if(!text||/^[\p{P}\p{S}\p{Z}]+$/u.test(text)||hidden(node))continue;
        const range=document.createRange();range.selectNodeContents(node);const rect=[...range.getClientRects()].find(r=>r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight);if(!rect)continue;
        const el=node.parentElement,style=getComputedStyle(el),size=parseFloat(style.fontSize);if(!Number.isFinite(size))continue;
        const cls=typeof el.className==='string'?el.className:'';
        textRows.push({text:text.slice(0,90),font:size,className:cls.slice(0,100),path:[el.tagName.toLowerCase(),...Array.from(el.classList||[]).slice(0,3)].join('.'),rect:{x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)},body:/dtext|detail__body|income__explanation|income__summary/i.test(cls)});
      }
      const pseudo=[];
      for(const el of document.querySelectorAll('kbd,[data-badge],.rs-unit-items [data-badge]'))for(const pseudoType of ['::before','::after']){const s=getComputedStyle(el,pseudoType),content=s.content;if(content&&content!=='none'&&content!=='normal'&&s.display!=='none'&&parseFloat(s.fontSize)<14)pseudo.push({text:content,font:parseFloat(s.fontSize),className:String(el.className||''),pseudo:pseudoType});}
      const sheets=[...new Set([...document.styleSheets].map(sheet=>sheet.href).filter(Boolean))];
      return {viewport:{width:innerWidth,height:innerHeight},texts:textRows.slice(0,1000),small:textRows.filter(row=>row.font<14).slice(0,100),smallBody:textRows.filter(row=>row.body&&row.font<16).slice(0,100),smallPseudo:pseudo,sheets};
    });
    attempt.typographySnapshots??={};attempt.typographySnapshots[name]=typography;
    await page.screenshot({ path: file, type: 'jpeg', quality: 88, fullPage: true }); attempt.screenshots[name] = file; await save();
    for (const previous of receipt.attempts) {
      if (previous === attempt) continue;
      if (Object.values(previous.screenshots ?? {}).some((recorded) => typeof recorded === 'string' && path.resolve(recorded) === path.resolve(file))) {
        previous.replacedScreenshots ??= {};
        previous.replacedScreenshots[name] = { byAttempt: attempt.startedAt, path: file };
      }
    }
    await save();
  };
  try {
    process.env.SP_DATA_DIR = DATA; process.env.SP_RESONANCE_DIRECTORY = SESSION_DIR;
    process.env.SP_INDEPENDENT_DIRECTORY = path.join(OUT, 'independent-sessions');
    process.env.SP_RECORDING_DIRECTORY = path.join(OUT, 'recordings');
    process.env.SP_INDEPENDENT_DESIGN_PATH = path.join(DATA, 'independent-design.json');
    process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH = path.join(DATA, 'independent-darkmoon-design-addon.json');
    process.env.SP_INDEPENDENT_GAME_TEXT_PATH = path.join(DATA, 'independent-game-text.json');
    assert(path.resolve(SESSION_DIR) !== path.resolve(ROOT, 'runtime/resonance'), 'test session storage must remain isolated from canonical player sessions');
    const fixtureSetup = await createIsolatedNativeFixtures({ directory: SESSION_DIR, sourceRoot });
    attempt.fixtureSessions = fixtureSetup.files;
    attempt.fixtures = { fifthChoice: 'prepared', emissaryExactCounts: 'prepared', boss: 'prepared', hiddenCore: 'prepared' };
    attempt.chemMarketItemCount = fixtureSetup.chemItemCount;
    const { startServer } = await import(pathToFileURL(path.join(sourceRoot, 'server/index.js')).href);
    server = await startServer({ port: PORT, host: HOST, quiet: true, publicDir: path.join(sourceRoot, 'public'),
      installDir: ROOT, dataDir: DATA, sharedDir: path.join(sourceRoot, 'shared'), resonanceDirectory: SESSION_DIR,
      independentDirectory: path.join(OUT, 'independent-sessions'), recordingDirectory: path.join(OUT, 'recordings') });
    const require = createRequire(path.join(ROOT, 'package.json')), puppeteer = require('puppeteer-core');
    const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    assert(existsSync(chrome), `Chrome executable is missing: ${chrome}`);
    deadline = setTimeout(() => {
      timedOut = true;
      attempt.status = 'failed'; attempt.timedOut = true; attempt.finishedAt = now();
      attempt.failures.push({ at: attempt.finishedAt, error: `hard browser-check deadline exceeded after ${DEADLINE_MS}ms` });
      attempt.missingChecks = missingChecks(attempt.checks);
      void browser?.close().catch(() => {}); void server?.close().catch(() => {});
      void save().then(() => writeFile(LOG, `${attempt.finishedAt} hard timeout; ${attempt.missingChecks.length} required checks remain\n`, { flag: 'a' }))
        .catch(() => {}).finally(() => { process.exitCode = 124; setTimeout(() => process.exit(124), 250); });
    }, DEADLINE_MS);
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: PROFILE, timeout: 30_000,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-dev-shm-usage'] });
    page = await browser.newPage(); await page.setCacheEnabled(false); await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const location = message.location?.() || {};
      if (/favicon\.ico/.test(message.text()) || /favicon\.ico/.test(location.url || '')) return;
      errors.push(`${message.text()}${location.url ? ` @ ${location.url}:${location.lineNumber ?? 0}` : ''}`);
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      attempt.httpRequests ??= []; attempt.httpRequests.push({method:request.method(),url:url.href,status:null});
      if (url.protocol === 'data:' || url.protocol === 'blob:') { void request.continue(); return; }
      if (url.hostname !== HOST || !isAllowedHttpRequest(request.method(), url.pathname)) {
        forbiddenRequests.push({ method: request.method(), url: url.href }); void request.abort('blockedbyclient'); return;
      }
      void request.continue();
    });
    const recordResponse = (request, status) => {
      const record = [...(attempt.httpRequests || [])].reverse().find((row) => row.url === request.url() && row.status == null);
      if (record) record.status = status;
      if (status >= 400 && new URL(request.url()).pathname !== '/favicon.ico' && !badResponses.some((row) => row.url === request.url() && row.status === status))
        badResponses.push({ url: request.url(), status });
    };
    page.on('response', (response) => recordResponse(response.request(), response.status()));
    page.on('requestfinished', (request) => { const response = request.response(); if (response) recordResponse(request, response.status()); });
    page.on('requestfailed', (request) => { attempt.failedRequests ??= []; attempt.failedRequests.push({ url:request.url(),method:request.method(),failure:request.failure()?.errorText }); });
    const primaryCdp = await attachWsCapture(page, attempt);
    primaryCdp.on('Network.responseReceived', (event) => {
      const response = event.response;
      if (response.status >= 400 && new URL(response.url).pathname !== '/favicon.ico')
        badResponses.push({ url: response.url, status: response.status, resourceType: event.type });
    });
    await page.setRequestInterception(true);
    // Seed 1 is a deterministic ordinary session whose starter inventory is checked below against its real catalog.
    await page.goto(`http://${HOST}:${PORT}/resonance.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.rs-title-fullscreen', { timeout: 20_000 }); await capture('01-title');
    await clickVisibleButtonText(page, /开始整备/);
    await page.waitForFunction(() => document.body.innerText.includes('选择难度'), { timeout: 12_000 }); await capture('02-difficulty');
    attempt.difficultyView = await page.evaluate(() => {
      const button=[...document.querySelectorAll('button')].find((row)=>/开始备战/.test(row.innerText));
      return {button:button?{text:button.innerText,disabled:button.disabled,ariaDisabled:button.getAttribute('aria-disabled'),className:button.className}:null,
        body:document.body.innerText.slice(-1000),url:location.href};
    });
    check('difficulty-default-copy', !/常规敌人：生命\d+%|领袖：生命\d+%|共\d+个节点|第\d+节点/.test(attempt.difficultyView.body), attempt.difficultyView);
    await page.click('.rs-difficulty-feature__next');
    await sleep(800);
    attempt.startActionDebug = await page.evaluate(() => ({
      url:location.href,
      button:(()=>{const node=document.querySelector('.rs-difficulty-feature__next');return node?{disabled:node.disabled,classes:node.className,text:node.innerText}:null})(),
      body:document.body.innerText.slice(-1200),
    }));
    await page.waitForFunction(() => new URL(location.href).searchParams.has('session')
      || document.body.innerText.includes('暂时无法进入共鸣'), { timeout: 20_000 });
    if (!new URL(page.url()).searchParams.has('session')) throw new Error(`session create failed: ${JSON.stringify(attempt.startActionDebug)}`);
    attempt.sessionId = new URL(page.url()).searchParams.get('session');
    await page.waitForFunction(() => [...document.querySelectorAll('.brief__foot button')]
      .some((button) => /准备就绪/.test(button.innerText) && !button.disabled), { timeout: 12_000 });
    const briefingButtons = await page.$$('footer.brief__foot button');
    let infoReadyButton = null;
    for (const button of briefingButtons) {
      const state = await button.evaluate((node) => ({ text:node.innerText,disabled:node.disabled }));
      if (/准备就绪/.test(state.text) && !state.disabled) { infoReadyButton = button; attempt.infoButton = state; break; }
    }
    assert(infoReadyButton, 'expected one enabled briefing ready button');
    const infoReadyOffset = attempt.ws.sent.length;
    attempt.infoReadyClick = await clickHandleByMeasuredCenter(page, infoReadyButton, 'INFO_CHECK ready button');
    attempt.infoReadySent = await waitSent(attempt, 'g.infoReady', 8_000, infoReadyOffset);
    await page.waitForFunction(() => document.querySelector('.shopbar__remain')
      || document.querySelector('.screen.draft') || document.body.innerText.includes('发生错误'), { timeout: 20_000 }).catch(() => {});
    const infoReadyFailure = attempt.ws.received.find((message) => message.t === 'error' && message.at >= attempt.infoReadySent?.at);
    if (infoReadyFailure) throw new Error(`g.infoReady rejected: ${JSON.stringify(infoReadyFailure)}`);
    attempt.afterInfoReady = await page.evaluate(() => ({ url:location.href, body:document.body.innerText.slice(-1000) }));
    await page.waitForSelector('.rs-native-match .shopbar__remain', { timeout: 40_000 });
    await page.waitForFunction(() => !document.querySelector('.pbanner--overlay'), { timeout: 12_000 }).catch(() => {});
    check('title-to-difficulty', true, { url: page.url() });
    check('native-info-prep', true, { native: !!(await page.$('.rs-native-match')), shop: !!(await page.$('.shopbar__remain')) });
    await capture('03-prep');
    const readPacket = () => page.evaluate(async () => { const sid = new URL(location.href).searchParams.get('session'); return await (await fetch(`/resonance/api/sessions/${sid}`)).json(); });
    const readState = async () => (await readPacket()).state;
    const readUiState = () => page.evaluate(async () => { const { store } = await import('./js/store.js'); return store.get().match.private?.resonance?.state || null; });
    let prep = await readUiState(); assert(prep, 'native private session state did not arrive over WebSocket');
    const deployedCount = await deployThree(page, prep, attempt); prep = await readUiState();
    check('three-real-deployments', deployedCount === 3 && prep.pieces?.filter((piece) => piece.row != null).length >= 3,
      { deployedCount, pieces: prep.pieces?.map((piece) => ({ uid: piece.uid, row: piece.row, col: piece.col })) });
    const initialPacket = await readPacket(), holderRecipe = recipePair(prep, initialPacket.catalog);
    assert(holderRecipe, `seeded session has no starter recipe pair: ${JSON.stringify(prep.inventory?.map(({ uid, itemId }) => ({ uid, itemId })))}`);
    const holder = prep.pieces.find((piece) => piece.row != null);
    await page.evaluate(() => {
      globalThis.__holderDragTrace = [];
      for (const type of ['pointerdown','pointerup','mousedown','mouseup','dragstart','dragenter','dragover','drop','dragend','click']) addEventListener(type, event => {
        const node=event.target;
        globalThis.__holderDragTrace.push({type,target:node?.tagName||null,className:node?.className||'',itemUid:node?.closest?.('[data-item-uid]')?.getAttribute('data-item-uid')||null,
          pieceUid:node?.closest?.('[data-uid]')?.getAttribute('data-uid')||null,draggable:node?.closest?.('button[data-item-uid]')?.draggable??null,
          types:[...(event.dataTransfer?.types||[])],x:event.clientX,y:event.clientY,defaultPrevented:event.defaultPrevented});
      }, true);
    });
    await page.click('.rs-native-equipment-rail button[aria-label="打开装备与配方"]'); await page.waitForSelector('.rs-equipment-dock__item');
    for (const [index, material] of holderRecipe.chosen.entries()) {
      const currentDisplay = await readUiState();
      const nativeItem = currentDisplay?.inventory?.find((item) => item.uid === material.uid)?.nativeUid;
      assert(Number.isSafeInteger(nativeItem), `inventory native UID missing for ${material.uid}: ${JSON.stringify(currentDisplay?.inventory?.map(({uid,nativeUid,itemId})=>({uid,nativeUid,itemId})))}`);
      const geometry = await dragInventoryItemToPiece(page, nativeItem, holder.nativeUid);
      attempt.holderDragGeometry = geometry;
      try {
        await page.waitForFunction(async ({ id, holderUid, itemId, resultId, last }) => {
          const packet = await (await fetch(`/resonance/api/sessions/${id}`)).json();
          const piece = packet.state?.pieces.find((entry) => entry.uid === holderUid);
          return last ? piece?.equipment?.some((item) => item.itemId === resultId)
            : piece?.equipment?.some((item) => item.itemId === itemId);
        }, { timeout: 12_000 }, { id: attempt.sessionId, holderUid: holder.uid, itemId: material.itemId, resultId: holderRecipe.recipe.resultId, last: index === holderRecipe.chosen.length - 1 });
      } catch (error) {
        attempt.holderDragFailure = await page.evaluate(async () => {
          const { store } = await import('./js/store.js'), state = store.get().match.private?.resonance?.state;
          return {trace:globalThis.__holderDragTrace||[],inventory:state?.inventory?.map(({uid,nativeUid,itemId})=>({uid,nativeUid,itemId})),
            pieces:state?.pieces?.map(({uid,nativeUid,equipment})=>({uid,nativeUid,equipment})),panels:[...document.querySelectorAll('.dpanel')].map(node=>({className:node.className,z:getComputedStyle(node).zIndex,rect:node.getBoundingClientRect().toJSON()}))};
        });
        throw new Error(`${error.message}; holderDrag=${JSON.stringify(attempt.holderDragFailure)}`);
      }
      prep = await readState();
    }
    const equipped = prep.pieces.find((piece) => piece.uid === holder.uid)?.equipment || [];
    check('equipment-holder-combine', equipped.some((item) => item.itemId === holderRecipe.recipe.resultId)
      && attempt.ws.sent.filter((message) => message.t === 'g.equip').length >= 2
      && !holderRecipe.chosen.some((component) => prep.inventory.some((item) => item.itemId === component.itemId)),
      { recipe: holderRecipe.recipe.resultId, holder: holder.uid, equipped: equipped.map((item) => item.itemId), sentEquip: attempt.ws.sent.filter((message) => message.t === 'g.equip') });
    try { await page.waitForSelector('.rs-unit-items__item', { timeout: 8_000 }); }
    catch (error) {
      attempt.unitItemsDebug = await page.evaluate(async () => {
        const {store}=await import('./js/store.js'), live=store.get().match.private?.resonance?.state;
        return { phase:live?.phase, pieces:live?.pieces?.map(piece=>({uid:piece.uid,nativeUid:piece.nativeUid,equipment:piece.equipment})),
          overlay:document.querySelector('.rs-unit-items')?.outerHTML||null, overlayDataset:{...document.querySelector('.rs-unit-items')?.dataset}, equipmentPanel:document.querySelector('.rs-native-resonance-panel')?.innerText||null,
          selected:document.querySelector('.dpanel')?.innerText?.slice(0,120)||null };
      });
      throw new Error(`unit equipment overlay did not render: ${JSON.stringify(attempt.unitItemsDebug)}; ${error.message}`);
    }
    const holderIcon = await page.$(`.rs-unit-items__item`);
    assert(holderIcon, 'native unit equipment overlay did not render the equipped result'); await holderIcon.click();
    await page.waitForSelector('.rs-detail-panel button');
    const detailButtons = await page.$$('.dpanel button');
    const unequipButton = [];
    for (const button of detailButtons) if ((await button.evaluate(node => node.textContent.trim())) === '卸下') unequipButton.push(button);
    assert(unequipButton.length, 'detail panel did not expose an active unequip action');
    const unequipOffset = attempt.ws.sent.length;
    await unequipButton[0].click();
    const unequipSent = await waitSent(attempt, 'g.resonance', 8_000, unequipOffset);
    await page.waitForFunction(async ({ id, holderUid, itemId }) => {
      const packet = await (await fetch(`/resonance/api/sessions/${id}`)).json();
      return !packet.state?.pieces.find((entry) => entry.uid === holderUid)?.equipment?.some((item) => item.itemId === itemId)
        && packet.state?.inventory?.some((item) => item.itemId === itemId);
    }, { timeout: 8_000 }, { id: attempt.sessionId, holderUid: holder.uid, itemId: holderRecipe.recipe.resultId });
    check('equipment-detail-unequip', !!unequipSent && unequipSent.action === 'unequip',
      { holder: holder.uid, itemId: holderRecipe.recipe.resultId });
    await page.evaluate((id) => { location.hash = `#item-${encodeURIComponent(id)}`; }, holderRecipe.recipe.resultId);
    await page.waitForFunction(() => !!document.querySelector('.rs-detail-panel') && getComputedStyle(document.querySelector('.rs-detail-panel')).display !== 'none', { timeout: 8_000 });
    const detailRailEvidence = await page.evaluate(() => {
      const panel=document.querySelector('.rs-detail-panel'),shop=document.querySelector('.shopbar');
      const rect=node=>{const r=node?.getBoundingClientRect();return r&&{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
      const a=rect(panel),b=rect(shop),overlap=!!a&&!!b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
      const cards=[...document.querySelectorAll('.shopbar__cards .scard:not(.scard--sold)')];
      const usable=cards.filter(node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(hit===node||node.contains(hit))}).length;
      const railItems=[...document.querySelectorAll('.rs-native-equipment-rail .rs-equipment-dock__item')];
      const railHits=railItems.map(node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{uid:node.dataset.itemUid,visible:r.width>0&&r.height>0,hit:!!hit&&(hit===node||node.contains(hit)),draggable:node.draggable}});
      return{detailVisible:!!a&&a.right>a.left,shopVisible:!!b&&b.right>b.left,overlap,cards:cards.length,usable,railHits};
    });
    check('details-open-while-shop-usable', detailRailEvidence.detailVisible && detailRailEvidence.shopVisible && !detailRailEvidence.overlap
      && detailRailEvidence.cards===5 && detailRailEvidence.usable===5 && detailRailEvidence.railHits.length>0
      && detailRailEvidence.railHits.every(item=>item.visible&&item.hit&&item.draggable),detailRailEvidence);
    const pactDeepLink = Object.keys(initialPacket.catalog?.pacts || {})[0], memberHashChecks = [];
    for (const [kind, id, selector] of [
      ['operator', holder.operatorId, '.rs-detail-panel'], ['member', holder.nativeUid, '.rs-detail-panel'],
      ['pact', pactDeepLink, '.rs-detail-panel'], ['item', holderRecipe.recipe.resultId, '.rs-detail-panel'],
      ['section', 'pacts', '.rs-native-pact-matrix'],
    ]) {
      await page.evaluate(({ kind, id }) => { location.hash = `#${encodeURIComponent(kind)}-${encodeURIComponent(id)}`; }, { kind, id });
      await page.waitForSelector(selector, { timeout: 6_000 });
      memberHashChecks.push({ kind, id, visible: true });
    }
    check('native-detail-deep-link', memberHashChecks.length === 5, memberHashChecks);
    await page.evaluate((id) => { location.hash = `#item-${encodeURIComponent(id)}`; }, holderRecipe.recipe.resultId);
    const gearName = initialPacket.catalog?.equipment?.[holderRecipe.recipe.resultId]?.name;
    await page.waitForFunction((name) => !!name && document.querySelector('.rs-detail-panel')?.innerText.includes(name), { timeout: 8_000 }, gearName);
    const recycleBefore = attempt.ws.sent.length;
    const recycleCandidates = await page.$$('.rs-detail-panel button');
    let recycleButton = null;
    for (const button of recycleCandidates) if ((await button.evaluate(node => node.textContent.trim())) === '回收') { recycleButton = button; break; }
    assert(recycleButton, 'inventory item detail did not expose a usable recycle action');
    const recycleBox = await recycleButton.boundingBox(); assert(recycleBox, 'recycle action is not in the viewport');
    const recycleHit = await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.closest('button')?.textContent?.trim(), {x:recycleBox.x+recycleBox.width/2,y:recycleBox.y+recycleBox.height/2});
    assert(recycleHit === '回收', `recycle action is covered at its visible center: ${recycleHit}`);
    await recycleButton.evaluate(node => { window.__rsRecycleClickCount=0; node.addEventListener('click',()=>window.__rsRecycleClickCount++,{capture:true}); });
    await page.mouse.click(recycleBox.x+recycleBox.width/2,recycleBox.y+recycleBox.height/2);
    let recycleSent = await waitSent(attempt, 'g.resonance', 1_200, recycleBefore);
    if (recycleSent?.action !== 'recycleEquipment') {
      attempt.recycleDebug = await page.evaluate(async () => { const {store}=await import('./js/store.js'), s=store.get(); const node=[...document.querySelectorAll('.rs-detail-panel button')].find(button=>button.textContent.trim()==='回收'); return {disabled:node?.disabled, panel:node?.closest('.rs-detail-panel')?.innerText,eventCount:window.__rsRecycleClickCount,lastAction:window.__rsLastResonanceAction,phase:s.match.private?.resonance?.state?.phase,pubPhase:s.match.public?.phase,ready:s.match.private?.ready,privateKeys:Object.keys(s.match.private||{})}; });
      throw new Error(`recycle click did not submit the native action: ${JSON.stringify({ recycleSent, debug:attempt.recycleDebug })}`);
    }
    await page.waitForFunction(async ({ id, itemId }) => {
      const packet = await (await fetch(`/resonance/api/sessions/${id}`)).json();
      return !packet.state?.inventory?.some((item) => item.itemId === itemId);
    }, { timeout: 8_000 }, { id: attempt.sessionId, itemId: holderRecipe.recipe.resultId });
    check('equipment-detail-recycle', true,
      { itemId: holderRecipe.recipe.resultId });
    const combinePage = await browser.newPage(), combineSocket = [];
    await combinePage.setCacheEnabled(false);
    await combinePage.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const combineAttempt = { ws: { sent: [], received: [] } };
    await attachWsCapture(combinePage, combineAttempt, (message) => { if (message.t === 'g.resonance') combineSocket.push(message.action?.type); });
    combinePage.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'data:' || url.protocol === 'blob:') { void request.continue(); return; }
      if (url.hostname !== HOST || !isAllowedHttpRequest(request.method(), url.pathname)) {
        forbiddenRequests.push({ method: request.method(), url: url.href }); void request.abort('blockedbyclient'); return;
      }
      void request.continue();
    });
    await combinePage.setRequestInterception(true);
    await combinePage.goto(`http://${HOST}:${PORT}/resonance.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await combinePage.waitForSelector('.rs-title-fullscreen', { timeout: 20_000 });
    await clickVisibleButtonText(combinePage, /开始整备/);
    await combinePage.waitForFunction(() => document.body.innerText.includes('选择难度'), { timeout: 12_000 });
    const secondaryStart = await combinePage.$('.rs-difficulty-feature__next');
    combineAttempt.difficultyClick = await clickHandleByMeasuredCenter(combinePage, secondaryStart, 'secondary difficulty start');
    await combinePage.waitForFunction(() => new URL(location.href).searchParams.has('session'), { timeout: 20_000 });
    await combinePage.waitForFunction(() => [...document.querySelectorAll('.brief__foot button')].some(button=>/准备就绪/.test(button.innerText)&&!button.disabled), { timeout: 12_000 });
    const combineBriefingButtons = await combinePage.$$('footer.brief__foot button');
    let combineInfoReady = null;
    for (const button of combineBriefingButtons) {
      const state = await button.evaluate((node) => ({ text:node.innerText,disabled:node.disabled }));
      if (/准备就绪/.test(state.text) && !state.disabled && await button.boundingBox()) { combineInfoReady = button; combineAttempt.infoButton = state; break; }
    }
    assert(combineInfoReady, `secondary session briefing has no visible ready action: ${JSON.stringify(await combinePage.evaluate(() => ({url:location.href,body:document.body.innerText.slice(-1000),buttons:[...document.querySelectorAll('.brief__foot button')].map((node)=>({text:node.innerText,disabled:node.disabled,display:getComputedStyle(node).display,rect:node.getBoundingClientRect().toJSON()}))})))}`);
    const combineInfoOffset = combineAttempt.ws.sent.length;
    combineAttempt.infoReadyClick = await clickHandleByMeasuredCenter(combinePage, combineInfoReady, 'secondary INFO_CHECK ready button');
    assert(await waitSent(combineAttempt,'g.infoReady',8_000,combineInfoOffset), 'secondary session did not complete INFO_CHECK over WebSocket');
    await combinePage.waitForSelector('.rs-native-match .shopbar__remain', { timeout: 60_000 });
    const combineId = new URL(combinePage.url()).searchParams.get('session');
    await combinePage.waitForFunction(async () => { const {store}=await import('./js/store.js');return !!store.get().match.private?.resonance?.state; }, { timeout:12_000 });
    const combinePacket = await combinePage.evaluate(async (id) => { const packet=await(await fetch(`/resonance/api/sessions/${id}`)).json();const {store}=await import('./js/store.js');return {state:store.get().match.private?.resonance?.state,catalog:packet.catalog}; }, combineId);
    const inventoryRecipe = recipePair(combinePacket.state, combinePacket.catalog);
    assert(inventoryRecipe, `seeded inventory fixture has no recipe pair: ${JSON.stringify(combinePacket.state.inventory?.map(({ itemId }) => itemId))}`);
    await combinePage.evaluate(() => {
      globalThis.__inventoryDragTrace = [];
      for (const type of ['dragstart','dragenter','dragover','drop','dragend','click']) addEventListener(type, (event) => {
        const node=event.target;
        globalThis.__inventoryDragTrace.push({type,target:node?.tagName||null,className:node?.className||'',itemUid:node?.closest?.('[data-item-uid]')?.getAttribute('data-item-uid')||null,
          draggable:node?.closest?.('button[data-item-uid]')?.draggable??null,types:[...(event.dataTransfer?.types||[])],x:event.clientX,y:event.clientY,defaultPrevented:event.defaultPrevented});
      }, true);
    });
    const equipmentPanelButton = await combinePage.$('.rs-native-equipment-rail button[aria-label="打开装备与配方"]');
    assert(equipmentPanelButton, 'native equipment panel button is missing');
    combineAttempt.equipmentPanelClick = await clickHandleByMeasuredCenter(combinePage, equipmentPanelButton, 'equipment panel button');
    await combinePage.waitForSelector('.rs-native-resonance-panel .rs-equipment-dock__item');
    await combinePage.waitForFunction(() => !document.querySelector('.dpanel:not(.rs-native-resonance-panel)'), { timeout: 4_000 }).catch(async () => {
      combineAttempt.panelStack = await combinePage.evaluate(() => [...document.querySelectorAll('.dpanel')].map((node) => ({className:node.className,ariaLabel:node.getAttribute('aria-label'),rect:node.getBoundingClientRect().toJSON(),head:node.querySelector('.dhead__name')?.innerText||null,z:getComputedStyle(node).zIndex})));
    });
    const recipeItem = await combinePage.$(`.rs-native-resonance-panel .rs-equipment-dock__item[data-item-uid="${inventoryRecipe.chosen[0].nativeUid}"]`);
    assert(recipeItem, 'seeded recipe source item is not visible in the equipment drawer');
    await clickHandleByMeasuredCenter(combinePage,recipeItem,'recipe item detail');
    await combinePage.waitForSelector('.rs-detail-panel .rs-detail__recipe-grid .rs-detail__recipe button',{visible:true,timeout:4_000});
    const recipeCards=await combinePage.$$('.rs-detail__recipe-grid .rs-detail__recipe');
    assert(recipeCards.length>0,'recipe cards are required before measuring icon geometry');
    const lazyImageLoads=[];
    for(let index=0;index<recipeCards.length;index++){
      const card=recipeCards[index];
      await card.evaluate(node=>new Promise(resolve=>{
        node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        requestAnimationFrame(()=>requestAnimationFrame(resolve));
      }));
      const loaded=await combinePage.waitForFunction(node=>{
        const images=[...node.querySelectorAll('.rs-item-icon img')];
        return images.length>0&&images.every(image=>image.complete&&image.naturalWidth>0&&image.naturalHeight>0);
      },{timeout:4_000},card).then(handle=>handle.jsonValue()).catch(()=>false);
      const evidence=await card.evaluate(node=>({name:node.querySelector('.rs-detail__recipe-name')?.innerText?.trim()||node.querySelector('button')?.innerText?.trim()||'',
        images:[...node.querySelectorAll('.rs-item-icon img')].map(image=>({src:image.currentSrc||image.src,complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight}))}));
      lazyImageLoads.push({index,loaded,evidence});
      assert(loaded,`recipe card ${index+1} lazy images did not finish loading within 4s: ${JSON.stringify(evidence)}`);
    }
    await recipeCards[0].evaluate(node=>new Promise(resolve=>{
      node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      requestAnimationFrame(()=>requestAnimationFrame(resolve));
    }));
    const recipeContrast=await combinePage.evaluate(()=>{
      const parse=value=>{const m=String(value||'').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);return m?{r:+m[1],g:+m[2],b:+m[3],a:m[4]==null?1:+m[4]}:null;};
      const lum=c=>{const x=[c.r,c.g,c.b].map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return x[0]*.2126+x[1]*.7152+x[2]*.0722;};
      return [...document.querySelectorAll('.rs-detail-panel .rs-detail__recipe button')].map(node=>{
        const fg=parse(getComputedStyle(node).color);let bg=null,parent=node;
        while(parent&&!bg){const c=parse(getComputedStyle(parent).backgroundColor);if(c&&c.a>.98)bg=c;parent=parent.parentElement;}
        if(!fg||!bg)return{text:(node.innerText||'').trim(),ratio:0,foreground:getComputedStyle(node).color,background:bg};
        const a=lum({r:fg.r*fg.a+bg.r*(1-fg.a),g:fg.g*fg.a+bg.g*(1-fg.a),b:fg.b*fg.a+bg.b*(1-fg.a)}),b=lum(bg);
        return{text:(node.innerText||'').trim(),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),foreground:getComputedStyle(node).color,background:bg};
      });
    });
    const recipeGeometry=await combinePage.evaluate(()=>{
      const rect=node=>{const r=node.getBoundingClientRect();return{width:r.width,height:r.height}};
      const icons=[...document.querySelectorAll('.rs-detail__recipe-flow .rs-item-icon')].map(rect);
      const images=[...document.querySelectorAll('.rs-detail__recipe-flow .rs-item-icon img')].map(img=>{
        const r=img.getBoundingClientRect();
        return{width:r.width,height:r.height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,complete:img.complete,src:img.currentSrc||img.src};
      });
      const flows=[...document.querySelectorAll('.rs-detail__recipe-grid .rs-detail__recipe-flow')].map(rect);
      const cards=[...document.querySelectorAll('.rs-detail__recipe-grid .rs-detail__recipe')].map(rect);
      return{icons,images,flows,cards,maxIconWidth:Math.max(0,...icons.map(row=>row.width)),maxIconHeight:Math.max(0,...icons.map(row=>row.height)),
        minImageWidth:images.length?Math.min(...images.map(row=>row.width)):0,minImageHeight:images.length?Math.min(...images.map(row=>row.height)):0,
        maxImageWidth:Math.max(0,...images.map(row=>row.width)),maxImageHeight:Math.max(0,...images.map(row=>row.height)),
        maxFlowHeight:Math.max(0,...flows.map(row=>row.height)),maxCardHeight:Math.max(0,...cards.map(row=>row.height))};
    });
    check('native-recipe-contrast',recipeContrast.length>0&&recipeContrast.every(row=>row.text&&row.ratio>=4.5)
      &&recipeGeometry.icons.length>0&&recipeGeometry.icons.every(icon=>icon.width>=31&&icon.width<=34&&icon.height>=31&&icon.height<=34)
      &&recipeGeometry.images.length>0&&recipeGeometry.images.every(image=>image.complete&&image.naturalWidth>0&&image.naturalHeight>0&&image.width>=31&&image.width<=34&&image.height>=31&&image.height<=34)
      &&recipeGeometry.maxFlowHeight<=160&&recipeGeometry.maxCardHeight<=190,{contrast:recipeContrast,geometry:recipeGeometry,lazyImageLoads});
    const recipeDetailClose=await combinePage.$('.rs-detail-panel button[aria-label="关闭详情"]');
    if(recipeDetailClose)await clickHandleByMeasuredCenter(combinePage,recipeDetailClose,'recipe detail close');
    const overlappingDetailClose = await combinePage.$('.rs-detail-panel .dpanel__close');
    if (overlappingDetailClose && await overlappingDetailClose.boundingBox()) {
      combineAttempt.detailDismissClick = await clickHandleByMeasuredCenter(combinePage, overlappingDetailClose, 'overlapping item detail close');
      await combinePage.waitForFunction(() => !document.querySelector('.rs-detail-panel'), { timeout: 4_000 });
    }
    if (!(await combinePage.$('.rs-native-resonance-panel--equipment'))) {
      await combinePage.click('.rs-native-equipment-rail button[aria-label="打开装备与配方"]');
      await combinePage.waitForSelector('.rs-native-resonance-panel--equipment .rs-equipment-dock__item', {visible:true,timeout:4_000});
    }
    await dragInventoryItemsToCombine(combinePage, inventoryRecipe.chosen[0].nativeUid, inventoryRecipe.chosen[1].nativeUid);
    const inventoryResult = await combinePage.waitForFunction(async ({ id, resultId }) => {
      const packet = await (await fetch(`/resonance/api/sessions/${id}`)).json();
      return packet.state?.inventory?.some((item) => item.itemId === resultId);
    }, { timeout: 5_000 }, { id: combineId, resultId: inventoryRecipe.recipe.resultId }).then(() => true).catch(() => false);
    combineAttempt.inventoryCombine = await combinePage.evaluate(async ({ id, itemUids }) => {
      const { store } = await import('./js/store.js');
      const packet = await (await fetch(`/resonance/api/sessions/${id}`)).json();
      return { url:location.href,phase:store.get().match.private?.resonance?.state?.phase,
        dragTrace:globalThis.__inventoryDragTrace||[],
        selected:store.get().match.private?.resonance?.state?.inventory?.map(({uid,nativeUid,itemId})=>({uid,nativeUid,itemId})),
        buttons:[...document.querySelectorAll('.rs-equipment-dock__item')].map(node=>({uid:node.getAttribute('data-item-uid'),draggable:node.draggable,owner:node.closest('.dpanel')?.className,rect:node.getBoundingClientRect().toJSON()})),
        slots:itemUids.map(uid=>{const node=document.querySelector(`.rs-native-resonance-panel .rs-equipment-dock__slot[data-item-uid="${CSS.escape(String(uid))}"]`);const r=node?.getBoundingClientRect();const hit=r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {uid,found:!!node,draggable:node?.querySelector('button')?.draggable,hit:hit?.className||hit?.tagName||null,hitOwner:hit?.closest('.dpanel')?.className||null,hitText:hit?.closest('.dpanel')?.innerText?.slice(0,180)||null,slotOwner:node?.closest('.dpanel')?.className||null,slotAncestors:node?[node.parentElement?.className,node.parentElement?.parentElement?.className,node.parentElement?.parentElement?.parentElement?.className]:null,rect:r?.toJSON()}}),
        panels:[...document.querySelectorAll('.dpanel')].map(node=>({className:node.className,ariaLabel:node.getAttribute('aria-label'),rect:node.getBoundingClientRect().toJSON(),head:node.querySelector('.dhead__name')?.innerText||null,z:getComputedStyle(node).zIndex,display:getComputedStyle(node).display})),
        inventory:packet.state?.inventory?.map(({uid,itemId})=>({uid,itemId}))};
    }, { id:combineId,itemUids:inventoryRecipe.chosen.map(item=>item.nativeUid) });
    combineAttempt.inventoryCombine.sent = combineAttempt.ws.sent.map((message)=>({t:message.t,action:message.action,content:message.content}));
    attempt.inventoryCombineEvidence = { session:combineId, recipe:inventoryRecipe.recipe.resultId, url:combinePage.url(), equipmentPanelClick:combineAttempt.equipmentPanelClick || null,
      detailDismissClick:combineAttempt.detailDismissClick || null, panelStack:combineAttempt.panelStack || null, ...combineAttempt.inventoryCombine };
    assert(inventoryResult || combineAttempt.ws.sent.some((message)=>message.t==='g.resonance'&&message.action?.type==='combine'), `inventory drag did not combine: ${JSON.stringify(combineAttempt.inventoryCombine)}`);
    if (!inventoryResult) await combinePage.waitForFunction(async ({ id, resultId }) => {
      const packet = await (await fetch(`/resonance/api/sessions/${id}`)).json();
      return packet.state?.inventory?.some((item) => item.itemId === resultId);
    }, { timeout: 8_000 }, { id: combineId, resultId: inventoryRecipe.recipe.resultId });
    check('inventory-combine', combineSocket.includes('combine'), { session: combineId, recipe: inventoryRecipe.recipe.resultId, sent: combineSocket });
    await combinePage.close();
    const defaultCopy = await page.evaluate(() => document.body.innerText);
    check('default-copy-is-product-language', !/制作过程|按标准|真实素材|(?<!经)验收|fixture/i.test(defaultCopy), { title: await page.title() });
    await capture('03-prep');
    const entrypointEvidence = await page.evaluate(() => {
      const visible = node => { const r=node?.getBoundingClientRect(); return !!r&&r.width>0&&r.height>0&&getComputedStyle(node).visibility!=='hidden'; };
      const count = selector => [...document.querySelectorAll(selector)].filter(visible).length;
      return {
        corner: [...document.querySelectorAll('.gm__corner > *')].filter(visible).map(node=>({tag:node.tagName,cls:node.className,label:node.getAttribute('aria-label')})),
        legacyActions: count('.rs-native-actions'), legacyGuide: count('.gm__corner .gm__help,.gm__corner [aria-label="玩法说明"]'),
        settings: count('.gm__corner button[aria-label="设置"]'), fullscreen: count('.gm__corner a.rs-fullscreen-small[aria-label="全屏打开"]'),
        codex: count('.rs-native-match button.rs-native-codex-button[aria-label="战术图鉴"]'),
        pact: count('.gm__bonds .rs-native-pact-open[aria-label="盟约与效果"]'),
        income: count('.rs-funds .funds__hex[aria-label="金币与收入"]'),
        info: count('[data-testid="check-player"]'),
        equipment: count('.rs-native-equipment-rail button[aria-label="打开装备与配方"]'),
        equipmentDuplicates: count('button[aria-label="装备库存"],button[aria-label="打开装备与配方"]'),
      };
    });
    const expectedCorner = entrypointEvidence.corner.map(row=>row.label).sort();
    check('native-entrypoints-unique', entrypointEvidence.legacyActions===0 && entrypointEvidence.legacyGuide===0
      && entrypointEvidence.settings===1 && entrypointEvidence.fullscreen===1 && entrypointEvidence.codex===1 && entrypointEvidence.pact===1
      && entrypointEvidence.income===1 && entrypointEvidence.info===1 && entrypointEvidence.equipment===1
      && entrypointEvidence.equipmentDuplicates===1
      && JSON.stringify(expectedCorner)===JSON.stringify(['全屏打开','设置'].sort()), entrypointEvidence);
    const codexButton = await page.$('.rs-native-match button.rs-native-codex-button[aria-label="战术图鉴"]');
    assert(codexButton, 'the single in-match tactical codex entry is missing');
    const codexBase = await page.evaluate(async () => {
      const {store}=await import('./js/store.js'), snapshot=store.get(), state=snapshot.match.private?.resonance?.state;
      return { url:location.href, session:new URL(location.href).searchParams.get('session'), round:state?.round, gold:state?.gold,
        pieces:(state?.pieces||[]).map(({uid,row,col,star})=>({uid,row,col,star})), offers:(state?.shop?.offers||[]).map(row=>row.uid),
        revision:state?.revision, phase:snapshot.match.public?.phase };
    });
    codexBase.wsConnections=attempt.ws.connections?.length||0;
    await clickHandleByMeasuredCenter(page,codexButton,'in-match tactical codex');
    await page.waitForSelector('.rs-native-codex-overlay[role="dialog"] .lo-card.rs-codex__operator-card',{visible:true,timeout:8_000});
    const codexCards=await page.$$('.rs-native-codex-overlay .lo-card.rs-codex__operator-card');
    assert(codexCards.length>0,'Native codex opened without operator entries');
    await clickHandleByMeasuredCenter(page,codexCards[0],'codex operator detail');
    await page.waitForSelector('.rs-native-codex-overlay .rs-detail-panel',{visible:true,timeout:5_000});
    const codexDetailEvidence=await page.$eval('.rs-native-codex-overlay .rs-detail-panel',node=>({open:true,title:node.querySelector('.dtitle')?.innerText||node.innerText.slice(0,80)}));
    const shortcutOffset=attempt.ws.sent.length;
    for(const key of ['d','f','Space']) await page.keyboard.press(key);
    await sleep(250);
    const penetratedFrames=attempt.ws.sent.slice(shortcutOffset).filter(row=>['g.refresh','g.levelUp','g.ready','g.move','g.sell'].includes(row.t));
    const codexStateAfterKeys=await page.evaluate(async()=>{const {store}=await import('./js/store.js'),snapshot=store.get(),state=snapshot.match.private?.resonance?.state;return{phase:snapshot.match.public?.phase,revision:state?.revision};});
    assert(penetratedFrames.length===0,'D/F/Space penetrated the tactical codex detail overlay');
    await capture('13-codex');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.rs-native-codex-overlay .rs-detail-panel')&&!!document.querySelector('.rs-native-codex-overlay'),{timeout:4_000});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.rs-native-codex-overlay'),{timeout:4_000});
    const codexAfter=await page.evaluate(async()=>{const {store}=await import('./js/store.js'),snapshot=store.get(),state=snapshot.match.private?.resonance?.state;return{url:location.href,
      session:new URL(location.href).searchParams.get('session'),round:state?.round,gold:state?.gold,pieces:(state?.pieces||[]).map(({uid,row,col,star})=>({uid,row,col,star})),
      offers:(state?.shop?.offers||[]).map(row=>row.uid),revision:state?.revision,phase:snapshot.match.public?.phase,ws:!!snapshot.match.private?.resonance};});
    codexAfter.wsConnections=attempt.ws.connections?.length||0;
    const codexSameState=codexBase.session===codexAfter.session&&codexBase.round===codexAfter.round&&codexBase.gold===codexAfter.gold
      &&JSON.stringify(codexBase.pieces)===JSON.stringify(codexAfter.pieces)&&JSON.stringify(codexBase.offers)===JSON.stringify(codexAfter.offers)
      &&codexBase.revision===codexAfter.revision&&codexAfter.ws&&codexBase.wsConnections===codexAfter.wsConnections&&codexBase.url===codexAfter.url;
    check('native-codex-session-and-shortcuts',entrypointEvidence.codex===1&&codexDetailEvidence.open&&codexSameState
      &&codexStateAfterKeys.revision===codexBase.revision&&penetratedFrames.length===0,
      {entrypoints:entrypointEvidence.codex,codexDetailEvidence,codexSameState,codexBase,codexStateAfterKeys,codexAfter,penetratedFrames});
    const openedPanels = [];
    const remainingControls = {};
    const openAndClose = async (button, panel, label) => {
      const handle = await page.$(button); assert(handle, `missing ${label} entry`);
      await clickHandleByMeasuredCenter(page, handle, `${label} entry`);
      await page.waitForSelector(panel, { visible: true, timeout: 5_000 });
      const aria = await page.$eval(panel, node=>node.getAttribute('aria-label'));
      assert(aria === label, `${label} entry opened a different window: ${aria}`);
      if (label === '本局信息') {
        const help = await page.$eval('.rs-native-controls-help', node=>({open:node.open,summary:node.querySelector('summary')?.innerText||''}));
        if (help.summary) {
          await page.click('.rs-native-controls-help > summary');
          await page.waitForFunction(()=>document.querySelector('.rs-native-controls-help')?.open===true,{timeout:3_000});
          await page.click('.rs-native-controls-help > summary');
          await page.waitForFunction(()=>document.querySelector('.rs-native-controls-help')?.open===false,{timeout:3_000});
          openedPanels.push({label:'操作说明',opened:true,closed:true});
        }
        const unavailableSettlement = await page.$eval('button[aria-label="本场结算"]',node=>({disabled:node.disabled,title:node.title}));
        assert(unavailableSettlement.disabled && /完成首场战斗后可查看/.test(unavailableSettlement.title), 'settlement should explain that it unlocks after the first real fight');
        remainingControls.settlementBeforeFirstFight = unavailableSettlement;
      }
      await page.click(`${panel} button[aria-label="关闭面板"]`);
      await page.waitForFunction(selector=>!document.querySelector(selector),{timeout:4_000},panel);
      openedPanels.push({label,opened:true,closed:true});
    };
    await openAndClose('.rs-native-pact-open','.rs-native-resonance-panel--pacts','本局盟约');
    await openAndClose('.rs-funds .funds__hex','.rs-native-resonance-panel--income','金币与收入');
    await openAndClose('[data-testid="check-player"]','.rs-native-resonance-panel--match-info','本局信息');
    await openAndClose('.rs-native-equipment-rail .rs-equipment-dock__open','.rs-native-resonance-panel--equipment','装备库存');
    const settingsButton = await page.$('.gm__corner button[aria-label="设置"]'); assert(settingsButton, 'Native settings entry is missing');
    await clickHandleByMeasuredCenter(page, settingsButton, 'settings entry');
    await page.waitForSelector('.modal__box[role="dialog"]',{visible:true,timeout:4_000});
    const settingsTitle = await page.$eval('.modal__box[role="dialog"] .modal__title',node=>node.innerText);
    assert(settingsTitle==='设置',`settings entry opened the wrong window: ${settingsTitle}`);
    const settingsDone=await page.$('.modal__actions button:not(.set-guide)');
    assert(settingsDone&&await settingsDone.evaluate(node=>node.innerText.trim())==='完成','settings modal has no explicit 完成 close action');
    await clickHandleByMeasuredCenter(page,settingsDone,'settings modal 完成');
    await page.waitForFunction(()=>!document.querySelector('.modal__box[role="dialog"]'),{timeout:3_000});
    openedPanels.push({label:'设置',opened:true,closed:true});
    const collapseShop = await page.$('.rs-funds .funds__collapse');
    assert(collapseShop, 'native shop has no collapse control');
    await clickHandleByMeasuredCenter(page, collapseShop, 'collapse native shop');
    await page.waitForSelector('.shopbar-tab__btn', { visible: true, timeout: 3_000 });
    const collapsedShop = await page.evaluate(() => ({ collapsed: document.querySelector('.gm')?.classList.contains('is-collapsed'), tab: document.querySelector('.shopbar-tab__btn')?.innerText.trim() || '' }));
    assert(collapsedShop.collapsed && /展开商店/.test(collapsedShop.tab), `shop did not collapse to its reopen tab: ${JSON.stringify(collapsedShop)}`);
    const expandShop = await page.$('.shopbar-tab__btn');
    await clickHandleByMeasuredCenter(page, expandShop, 'expand native shop');
    await page.waitForSelector('.rs-funds .funds__collapse', { visible: true, timeout: 3_000 });
    remainingControls.shop = { collapsed: collapsedShop, expanded: true };
    await page.waitForFunction(async () => {
      const root=document.querySelector('.gm'),canvas=root?.querySelector('.gm__field canvas');
      const {store}=await import('./js/store.js'),pub=store.get().match.public,privateState=store.get().match.private?.resonance?.state;
      return !!canvas&&canvas.getBoundingClientRect().width>100&&canvas.getBoundingClientRect().height>100
        &&pub?.phase==='PREP'&&privateState?.phase==='prep'&&!root.classList.contains('is-pen');
    }, { timeout: 8_000 });
    const scoutWindowState = await page.evaluate(() => {
      const visible=node=>{const r=node?.getBoundingClientRect();return !!r&&r.width>0&&r.height>0&&getComputedStyle(node).display!=='none'};
      return {openPanels:[...document.querySelectorAll('.rs-native-resonance-panel,.rs-detail-panel,.modal__box[role="dialog"],.bpop')].filter(visible).map(node=>node.className),
        camera:document.querySelector('.gm')?.dataset.camera,pen:document.querySelector('.gm')?.classList.contains('is-pen')};
    });
    attempt.enemyScoutEvidence = { beforeClick: scoutWindowState };
    assert(scoutWindowState.openPanels.length===0, `close the current Native window before opening enemy scouting: ${JSON.stringify(scoutWindowState)}`);
    const enemyButton = await page.$('.rs-native-match [data-testid="check-enemy"]');
    assert(enemyButton, 'native enemy scouting control is missing from the Native top bar');
    const enemyButtonState = await enemyButton.evaluate(node => {
      const rect=node.getBoundingClientRect();
      return {disabled:node.disabled,ariaDisabled:node.getAttribute('aria-disabled'),label:node.getAttribute('aria-label'),
        rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},phase:node.closest('.gm')?.dataset.camera,
        nativePhase:node.closest('.gm')?.getAttribute('data-camera')};
    });
    assert(!enemyButtonState.disabled&&enemyButtonState.ariaDisabled!=='true'&&enemyButtonState.rect.width>0&&enemyButtonState.rect.height>0,
      `enemy scouting must be actionable in prep: ${JSON.stringify({enemyButtonState,scoutWindowState})}`);
    attempt.enemyScoutEvidence.button = enemyButtonState;
    const cameraBeforeScout = await page.$eval('.gm', node => node.dataset.camera);
    const enemyBox=await enemyButton.boundingBox();
    const enemyHit=await page.evaluate(({x,y})=>{const hit=document.elementFromPoint(x,y),button=hit?.closest('button');return{testid:button?.dataset.testid||null,label:button?.getAttribute('aria-label')||null,tag:hit?.tagName||null,className:hit?.className||''};},
      {x:enemyBox.x+enemyBox.width/2,y:enemyBox.y+enemyBox.height/2});
    assert(enemyHit.testid==='check-enemy', `enemy scouting mouse target is occluded: ${JSON.stringify({enemyButtonState,enemyHit})}`);
    attempt.enemyScoutEvidence.hit = enemyHit;
    await page.mouse.click(enemyBox.x+enemyBox.width/2,enemyBox.y+enemyBox.height/2);
    try {
      await page.waitForFunction(() => document.querySelector('.gm')?.classList.contains('is-pen') && document.querySelector('.gm')?.dataset.camera === 'pen', { timeout: 5_000 });
    } catch (error) {
      const afterClick=await page.evaluate(async()=>{const {store}=await import('./js/store.js'),s=store.get();return{screen:document.querySelector('.gm')?.className,camera:document.querySelector('.gm')?.dataset.camera,
        publicPhase:s.match.public?.phase,privatePhase:s.match.private?.resonance?.state?.phase,button:document.querySelector('.gm [data-testid="check-enemy"]')?.outerHTML,
        overlays:[...document.querySelectorAll('.rs-native-resonance-panel,.rs-detail-panel,.modal__box[role="dialog"],.bpop')].map(node=>node.className)};});
      attempt.enemyScoutEvidence.afterClick = afterClick;
      throw new Error(`Native enemy scouting click did not enter the pen: ${JSON.stringify({scoutWindowState,enemyButtonState,enemyHit,afterClick,error:String(error)})}`);
    }
    attempt.enemyScoutEvidence.entered = { camera: await page.$eval('.gm', node=>node.dataset.camera), pen: true };
    const returnScout = await page.$('.rs-native-match [data-testid="check-enemy"]');
    assert(returnScout && /返回/.test(await returnScout.evaluate(node => node.getAttribute('aria-label') || node.innerText)), 'Native scouting control did not become the return action');
    const returnBox=await returnScout.boundingBox();
    const returnHit=await page.evaluate(({x,y})=>{const hit=document.elementFromPoint(x,y),button=hit?.closest('button');return{testid:button?.dataset.testid||null,label:button?.getAttribute('aria-label')||null};},
      {x:returnBox.x+returnBox.width/2,y:returnBox.y+returnBox.height/2});
    assert(returnHit.testid==='check-enemy'&&/返回/.test(returnHit.label||''),`Native return action is not the actual mouse target: ${JSON.stringify(returnHit)}`);
    await page.mouse.click(returnBox.x+returnBox.width/2,returnBox.y+returnBox.height/2);
    await page.waitForFunction((camera) => !document.querySelector('.gm')?.classList.contains('is-pen') && document.querySelector('.gm')?.dataset.camera === camera, { timeout: 5_000 }, cameraBeforeScout);
    remainingControls.scouting = { initialCamera: cameraBeforeScout, entered: 'pen', returnedTo: cameraBeforeScout, enemyButtonState, enemyHit, returnHit };
    const settingsForGuide = await page.$('.gm__corner button[aria-label="设置"]');
    await clickHandleByMeasuredCenter(page, settingsForGuide, 'settings guide entry');
    await page.waitForSelector('.modal__box[role="dialog"] .set-guide', { visible: true, timeout: 3_000 });
    const guideButton = await page.$('.modal__box[role="dialog"] .set-guide');
    assert(guideButton && /操作说明/.test(await guideButton.evaluate(node => node.innerText)), 'settings guide action is not labelled 操作说明');
    await clickHandleByMeasuredCenter(page, guideButton, 'open Native 操作说明');
    await page.waitForFunction(() => !document.querySelector('.modal__box[role="dialog"]') && !!document.querySelector('.rs-native-resonance-panel--match-info'), { timeout: 4_000 });
    const guideDetails = await page.$eval('.rs-native-controls-help', node => ({ open: node.open, summary: node.querySelector(':scope > summary')?.innerText.trim() || '' }));
    assert(guideDetails.open && /操作说明/.test(guideDetails.summary), `settings guide did not open the Native instructions: ${JSON.stringify(guideDetails)}`);
    await page.click('.rs-native-controls-help > summary');
    await page.waitForFunction(() => document.querySelector('.rs-native-controls-help')?.open === false, { timeout: 3_000 });
    const guideClose = await page.$('.rs-native-resonance-panel--match-info button[aria-label="关闭面板"]');
    assert(guideClose, 'Native instructions have no close action');
    await clickHandleByMeasuredCenter(page, guideClose, 'close Native 操作说明 panel');
    await page.waitForFunction(() => !document.querySelector('.rs-native-resonance-panel--match-info'), { timeout: 3_000 });
    remainingControls.settingsGuide = { button: '操作说明', opened: guideDetails, closed: true };
    check('native-panels-open-close', openedPanels.filter(row=>row.opened&&row.closed).length>=6, openedPanels);
    await page.click('.rs-native-pact-open[aria-label="盟约与效果"]'); await page.waitForSelector('.rs-native-resonance-panel--pacts .rs-native-pact-matrix');
    const presentation = await page.evaluate(() => {
      const visible = node => {const r=node?.getBoundingClientRect();return !!r&&r.width>0&&r.height>0&&getComputedStyle(node).visibility!=='hidden'};
      const icons=[...document.querySelectorAll('.gm__corner button,.gm__corner a,.rs-native-pact-open,.rs-funds .funds__hex,.rs-native-pact-matrix__name')].filter(visible).map(node=>({label:node.getAttribute('aria-label')||node.innerText?.trim().slice(0,35),svg:!!node.querySelector('svg path,svg circle,svg polygon,svg rect,svg use'),img:[...node.querySelectorAll('img')].some(img=>img.complete&&img.naturalWidth>0),mask:[...node.querySelectorAll('[style*="mask"]')].some(mask=>(getComputedStyle(mask).maskImage||getComputedStyle(mask).webkitMaskImage||'').startsWith('url('))}));
      const liveLabels=[...document.querySelectorAll('.gm__corner button,.gm__corner a,.rs-native-pact-open,.rs-funds .funds__hex,.rs-native-pact-matrix__name')].filter(visible).map(node=>({text:(node.innerText||node.getAttribute('aria-label')||'').trim().slice(0,60),font:parseFloat(getComputedStyle(node).fontSize)})).filter(row=>row.text);
      const parse = value => {const m=String(value||'').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);return m?{r:+m[1],g:+m[2],b:+m[3],a:m[4]==null?1:+m[4]}:null;};
      const lum = c => {const v=[c.r,c.g,c.b].map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
      const contrasts=[...document.querySelectorAll('.rs-native-pact-matrix__name .bond__icon-mask')].map(node=>{
        const core=node.closest('.bond__core'),fg=parse(getComputedStyle(node).backgroundColor)||parse(getComputedStyle(node).color);let bg=null;
        for(let surface=core;surface&&!bg;surface=surface.parentElement){const candidate=parse(getComputedStyle(surface).backgroundColor);if(candidate&&candidate.a>.95)bg=candidate;}
        if(!fg||!bg)return{contrast:0,bgLuminance:null};
        const a=lum({r:fg.r*fg.a+bg.r*(1-fg.a),g:fg.g*fg.a+bg.g*(1-fg.a),b:fg.b*fg.a+bg.b*(1-fg.a)}),b=lum(bg);
        return{contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),bgLuminance:b};
      });
      return {icons,liveLabels,contrasts};
    });
    const tiers = await page.$$eval('.rs-native-pact-matrix__tier', (nodes) => nodes.map((node) => ({ text: node.innerText, label: node.getAttribute('aria-label'), reached: node.classList.contains('is-reached') })));
    const tierCheck = await page.evaluate(async () => {
      const sid = new URL(location.href).searchParams.get('session'), packet = await (await fetch(`/resonance/api/sessions/${sid}`)).json();
      const pactEntries = Object.entries(packet.catalog?.pacts || {});
      const expected = pactEntries.reduce((sum, [, pact]) => sum + (pact.levels || []).length, 0);
      const iconNodes = [...document.querySelectorAll('.rs-native-pact-matrix__name .bond__icon-mask')];
      const icons = await Promise.all(iconNodes.map(async node => {
        const style = getComputedStyle(node), mask = style.maskImage || style.webkitMaskImage || '';
        const src = mask.match(/^url\(["']?(.*?)["']?\)$/)?.[1] || '';
        if (!src) return { src, loaded: false };
        return await new Promise(resolve => { const image = new Image(); image.onload = () => resolve({ src, loaded: image.naturalWidth > 0 }); image.onerror = () => resolve({ src, loaded: false }); image.src = new URL(src, location.href).href; });
      }));
      const levelNodes = [...document.querySelectorAll('.rs-native-pact-matrix__tier')];
      const status = await import('./js/resonance/pactTierState.js');
      const mismatches = [];
      for (const node of levelNodes) {
        const id = node.dataset.pactId, index = Number(node.dataset.levelIndex), pact = packet.catalog?.pacts?.[id], level = pact?.levels?.[index];
        const count = Number(packet.state?.pacts?.[id]?.count) || 0;
        const expectedReached = !!level && status.pactTierStatus(level, count) === 'reached';
        const actualReached = node.classList.contains('is-reached');
        if (!level || expectedReached !== actualReached) mismatches.push({ id, index, count, expectedReached, actualReached, min: level?.minUnits ?? level?.threshold, exact: level?.exactCounts ?? level?.exactUnits ?? level?.exact });
      }
      const active = levelNodes.filter(node => node.classList.contains('is-reached')).length;
      return { expected, actual: levelNodes.length, expectedPacts: pactEntries.length, actualPacts: document.querySelectorAll('.rs-native-pact-matrix__row').length,
        icons, reached: active, mismatches: mismatches.slice(0, 12) };
    });
    check('all-pact-tier-icons-loaded-and-active', tiers.length === tierCheck.expected && tierCheck.actualPacts === tierCheck.expectedPacts && tiers.every((tier) => tier.label && !/@placeholder|undefined/.test(tier.label)) && tierCheck.icons.length === tierCheck.expectedPacts && tierCheck.icons.every((icon) => icon.loaded) && tierCheck.mismatches.length === 0, { tierCount: tiers.length, ...tierCheck });
    const pactDetailEntry = await page.$('.rs-native-pact-matrix__row[data-pact-id="conqueror"] .rs-native-pact-matrix__name');
    assert(pactDetailEntry, 'Conqueror row is required for the source-backed reward schedule inspection');
    attempt.conquerorDetailClick = await clickHandleByMeasuredCenter(page,pactDetailEntry,'Conqueror pact detail');
    await page.waitForSelector('.rs-detail-panel[role="dialog"]',{visible:true,timeout:4_000});
    const rewardSchedule = await page.evaluate(() => {
      const schedule=document.querySelector('details.rs-detail__reward-schedule'), summary=schedule?.querySelector(':scope > summary');
      const rows=schedule?[...schedule.querySelectorAll('[data-reward-tier]')].map(node=>({tier:node.getAttribute('data-reward-tier'),visible:node.getClientRects().length>0&&getComputedStyle(node).display!=='none',text:(node.innerText||'').trim().slice(0,100)})):[];
      return {present:!!schedule,open:!!schedule?.open,summary:summary?.innerText?.trim()||'',rows};
    });
    const conquerorThresholds = [10,35,65,100,150,200,330,440,550,660,750,850,1000,1200,1500];
    assert(rewardSchedule.present && !rewardSchedule.open && /查看奖励档位/.test(rewardSchedule.summary)
      && JSON.stringify(rewardSchedule.rows.map(row=>Number(row.tier)))===JSON.stringify(conquerorThresholds)
      && rewardSchedule.rows.every(row=>!row.visible), `Conqueror's 15 source-backed thresholds must be collapsed by default: ${JSON.stringify(rewardSchedule)}`);
    const progressNode=await page.$('.rs-detail__reward-progress');
    assert(progressNode,'Conqueror reward progress indicator is required while reward tiers are collapsed');
    await progressNode.evaluate(node=>new Promise(resolve=>{
      node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      requestAnimationFrame(()=>requestAnimationFrame(resolve));
    }));
    const collapsedProgress=await page.evaluate(()=>{
      const progress=document.querySelector('.rs-detail__reward-progress'),schedule=document.querySelector('details.rs-detail__reward-schedule');
      const rect=progress?.getBoundingClientRect();
      return{scheduleClosed:!!schedule&&!schedule.open,progressText:progress?.innerText?.trim()||'',progressVisible:!!rect&&rect.width>0&&rect.height>0&&rect.top>=0&&rect.bottom<=innerHeight,
        panelVisible:!!progress?.closest('.rs-detail-panel')?.getClientRects().length};
    });
    assert(collapsedProgress.scheduleClosed&&collapsedProgress.progressVisible&&collapsedProgress.progressText,
      `reward progress must be visible while tiers remain collapsed: ${JSON.stringify(collapsedProgress)}`);
    await capture('11-reward-progress');
    const rewardSummary=await page.$('.rs-detail__reward-schedule > summary');
    attempt.conquerorRewardDisclosureClick = await clickHandleByMeasuredCenter(page,rewardSummary,'expand Conqueror reward schedule');
    await page.waitForFunction(()=>document.querySelector('details.rs-detail__reward-schedule')?.open===true,{timeout:3_000});
    const expandedSchedule = await page.evaluate(() => {
      const schedule=document.querySelector('details.rs-detail__reward-schedule');
      const rows=[...schedule.querySelectorAll('[data-reward-tier]')].map(node=>({tier:node.getAttribute('data-reward-tier'),text:(node.innerText||'').trim()}));
      const progress=document.querySelector('.rs-detail__reward-progress');
      return {open:!!schedule.open,rows,progress:progress?.innerText?.trim()||'',progressVisible:!!progress&&progress.getClientRects().length>0};
    });
    const rewardIds=expandedSchedule.rows.map(row=>row.tier);
    check('native-pact-rewards-disclosure',expandedSchedule.open&&JSON.stringify(rewardIds.map(Number))===JSON.stringify(conquerorThresholds)
      &&expandedSchedule.rows.every(row=>row.text&&row.text.includes(row.tier))
      &&new Set(rewardIds).size===rewardIds.length&&expandedSchedule.progressVisible,{collapsed:rewardSchedule,expanded:expandedSchedule});
    await capture('12-reward-tiers');
    const detailTypography=await page.evaluate(()=>{
      const visible=node=>{const r=node?.getBoundingClientRect();return!!r&&r.width>0&&r.height>0&&getComputedStyle(node).visibility!=='hidden'};
      const body=[...document.querySelectorAll('.rs-detail-panel .dtext,.rs-detail-panel .rs-detail__reward-progress,.rs-detail-panel .rs-detail__reward-schedule [data-reward-tier]')].filter(visible).map(node=>({text:(node.innerText||'').trim().slice(0,100),font:parseFloat(getComputedStyle(node).fontSize)})).filter(row=>row.text&&/[\u3400-\u9fff]/.test(row.text));
      const labels=[...document.querySelectorAll('.rs-detail-panel .dsec__title,.rs-detail-panel .rs-detail__reward-schedule summary,.rs-detail-panel button')].filter(visible).map(node=>({text:(node.innerText||'').trim().slice(0,50),font:parseFloat(getComputedStyle(node).fontSize)})).filter(row=>row.text);
      return{body,labels};
    });
    check('native-icons-and-type-readable',presentation.icons.length>=5&&presentation.icons.every(icon=>icon.svg||icon.img||icon.mask)
      &&presentation.liveLabels.length>0&&presentation.liveLabels.every(row=>row.font>=14)
      &&presentation.contrasts.length===tierCheck.expectedPacts&&presentation.contrasts.every(row=>row.contrast>=3&&row.bgLuminance<.55)
      &&detailTypography.body.length>0&&detailTypography.body.every(row=>row.font>=16)
      &&detailTypography.labels.length>0&&detailTypography.labels.every(row=>row.font>=14),{presentation,detailTypography});
    const rewardClose=await page.$('.rs-detail-panel button[aria-label="关闭详情"]');
    if(rewardClose)await clickHandleByMeasuredCenter(page,rewardClose,'reward detail close');
    await page.click('.rs-native-pact-open[aria-label="盟约与效果"]');
    await page.waitForSelector('.rs-native-resonance-panel--pacts .rs-native-pact-matrix',{visible:true,timeout:4_000});
    await capture('04-pacts');
    const layout = await page.evaluate(() => {
      const visible = (e) => !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none';
      const shop = document.querySelector('.shopbar'), panel = document.querySelector('.rs-native-resonance-panel');
      const rect = (e) => { const r=e?.getBoundingClientRect(); return r && {top:r.top,bottom:r.bottom,left:r.left,right:r.right}; };
      const overlap = (a,b) => !!a&&!!b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
      const cards=[...document.querySelectorAll('.shopbar__cards .scard:not(.scard--sold)')];
      const usable=cards.filter(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return hit&&(hit===e||e.contains(hit))});
      return {shopVisible:visible(shop),panelVisible:visible(panel),overlap:overlap(rect(shop),rect(panel)),cards:cards.length,usable:usable.length};
    });
    check('pact-panel-shop-usable', layout.shopVisible && layout.panelVisible && !layout.overlap && layout.cards === 5 && layout.usable === layout.cards, layout);
    const viewportSamples = [];
    for (const viewport of [{width:1440,height:1000},{width:1000,height:700},{width:1366,height:768},{width:844,height:390}]) {
      await page.setViewport({ ...viewport, deviceScaleFactor: 1 }); await sleep(180);
      viewportSamples.push(await page.evaluate(() => {
        const cards=[...document.querySelectorAll('.shopbar__cards .scard:not(.scard--sold)')];
        const usable=cards.filter(node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.width>0&&r.height>0&&hit&&(hit===node||node.contains(hit))}).length;
        const controls=['.shopbar__tools .toolbtn--ice','.shopbar__tools .toolbtn--amber','.lvcard','.readybtn'];
        const hits=controls.map(selector=>{const node=document.querySelector(selector),r=node?.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{selector,visible:!!r&&r.width>0&&r.height>0,hit:!!hit&&(hit===node||node.contains(hit))}});
        const remaining=document.querySelector('.gtop__remain,.gtop__deploy-count,[data-testid="deployment-remaining"]'),ready=document.querySelector('.readybtn');
        const rect=node=>{const r=node?.getBoundingClientRect();return r&&{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
        const a=rect(remaining),b=rect(ready),remainingReadyOverlap=!!a&&!!b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
        return{viewport:{width:innerWidth,height:innerHeight},cardCount:cards.length,usable,hits,remaining:remaining?.innerText?.trim()||null,remainingRect:a,readyRect:b,remainingReadyOverlap};
      }));
    }
    await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
    check('mobile-shop-panel-safe', viewportSamples.every(sample=>sample.cardCount===5&&sample.usable===5&&sample.hits.every(hit=>hit.visible&&hit.hit)
      &&(!sample.remainingRect||!sample.readyRect||!sample.remainingReadyOverlap)),viewportSamples);
    const costSurface = await page.$$eval('.shopbar__cards .scard:not(.scard--sold)', (nodes) => nodes.map((node) => {
      const r=node.getBoundingClientRect(), bg=node.querySelector('.scard__bg'), b=bg?.getBoundingClientRect(), tier=node.querySelector('.tier--color');
      return { cls: node.className, color: getComputedStyle(node).backgroundColor, bg: getComputedStyle(bg || node).backgroundImage,
        bgInset: bg ? getComputedStyle(bg).inset : null,
        covers: !!b && Math.abs(b.width-r.width)<=2.5 && Math.abs(b.height-r.height)<=2.5,
        tierVisible: !!tier && getComputedStyle(tier).visibility!=='hidden' && getComputedStyle(tier).display!=='none', roman: tier?.innerText?.trim()||'' };
    }));
    check('whole-card-cost-colors', costSurface.length > 0 && costSurface.every((card) => /scard--t[1-5]/.test(card.cls) && card.color !== 'rgba(0, 0, 0, 0)' && card.bg !== 'none' && card.covers && !card.tierVisible && !/^[IVXLCDM]+$/.test(card.roman)), costSurface);
    const skillIcons = await page.evaluate(async () => {
      const { resolveOperatorSkillIcon } = await import('./js/resonance/operatorSkillIcon.js');
      const response=await fetch('/resonance/api/catalog?seed=1'), packet=await response.json();
      const { data } = await import('./js/data.js');
      const active=packet.activeOperatorIds||[];
      const rows=active.map(id=>{
        const native=data.list('chess').find(record=>record.sourceChessId===id&&record.resonanceStar===1);
        const skill=native&&resolveOperatorSkillIcon(native);
        const expected=native?.skill?.skillId, expectedIcon=native?.assets?.skillIcon||native?.skill?.iconId;
        return{id,expected:expected||null,expectedIcon:expectedIcon||null,actual:skill?.skillId||null,actualIcon:skill?.iconId||null,
          skill:skill?.url||null,match:!!expected&&!!expectedIcon&&skill?.skillId===expected&&skill?.iconId===expectedIcon};
      });
      const loaded=await Promise.all(rows.map(row=>new Promise(resolve=>{if(!row.skill){resolve({...row,loaded:false});return}const img=new Image();img.onload=()=>resolve({...row,loaded:img.naturalWidth>0});img.onerror=()=>resolve({...row,loaded:false});img.src=new URL(row.skill,location.href).href})));
      return {expected:active.length,loaded:loaded.filter(row=>row.loaded&&row.match).length,missing:loaded.filter(row=>!row.loaded||!row.match)};
    });
    check('fixed-skill-icons-loaded', skillIcons.expected > 0 && skillIcons.expected === skillIcons.loaded, skillIcons);
    await capture('05-shop-detail');
    const beforeBuy = await readState(); await page.click('button[aria-label="关闭面板"]');
    const detailEvidence = await clickRealShopCard(page, beforeBuy.revision, attempt, waitSent); const afterBuy = await readState();
    check('shop-real-purchase', detailEvidence.clickCount === 1 && attempt.ws.sent.slice(-1)[0]?.t === 'g.buy' && afterBuy.revision > beforeBuy.revision && afterBuy.history?.length >= beforeBuy.history?.length,
      { sent: attempt.ws.sent.filter((message) => message.t === 'g.buy'), before: beforeBuy.revision, after: afterBuy.revision, clickCount: detailEvidence.clickCount });
    let liveUi = await readUiState();
    const movable = liveUi.pieces.find(piece => piece.row != null && Number.isSafeInteger(Number(piece.nativeUid)));
    assert(movable, 'no deployed member available for W retreat/deploy keyboard check');
    let point = await nativePiecePoint(page, movable.nativeUid); await page.mouse.click(point.x,point.y);
    let moveOffset = attempt.ws.sent.length; await page.keyboard.press('w');
    const withdrawn = await waitSent(attempt,'g.move',8_000,moveOffset);
    assert(withdrawn, 'W did not send a native retreat action');
    await page.waitForFunction(async ({id,uid})=>{const p=await(await fetch(`/resonance/api/sessions/${id}`)).json();return p.state?.pieces?.some(x=>x.uid===uid&&x.row==null)}, {timeout:10_000}, {id:attempt.sessionId,uid:movable.uid});
    liveUi = await readUiState(); const withdrawnPiece = liveUi.pieces.find(piece=>piece.uid===movable.uid);
    assert(withdrawnPiece?.row == null, 'W retreat did not put the selected member into the hand');
    // The native keyboard keeps the same piece selected after a retreat; pressing W again is the real
    // deploy-from-hand action. Clicking the same figure would toggle selection off before the shortcut.
    moveOffset = attempt.ws.sent.length; await page.keyboard.press('w');
    const redeployed = await waitSent(attempt,'g.move',8_000,moveOffset);
    await page.waitForFunction(async ({id,uid})=>{const p=await(await fetch(`/resonance/api/sessions/${id}`)).json();return p.state?.pieces?.some(x=>x.uid===uid&&x.row!=null)}, {timeout:10_000}, {id:attempt.sessionId,uid:movable.uid});
    const finalPlacement = (await readState()).pieces.find(piece=>piece.uid===movable.uid);
    check('native-w-deploy-withdraw', !!withdrawn && !!redeployed && finalPlacement?.row!=null&&finalPlacement?.col!=null,
      {withdrawn,redeployed,pieceUid:movable.uid,finalPosition:{row:finalPlacement?.row,col:finalPlacement?.col}});
    const purchased = liveUi.pieces.find(piece=>!beforeBuy.pieces.some(old=>old.uid===piece.uid)&&piece.row==null);
    assert(purchased&&Number.isSafeInteger(Number(purchased.nativeUid)),'purchased bench unit lacks a stable native UID for the E-sale check');
    const goldBeforeSale = afterBuy.gold;
    point = await nativePiecePoint(page,purchased.nativeUid);
    await page.mouse.move(point.x,point.y); await page.mouse.click(point.x,point.y);
    // A native piece tap opens its detail card while selecting it. Close that card without clearing the selection
    // before using the mode shortcut; dialogs own keyboard input while open.
    await new Promise(resolve => setTimeout(resolve, 120));
    const saleUi = await page.evaluate(() => ({
      detailOpen: !!document.querySelector('.dpanel'),
      saleButtons: [...document.querySelectorAll('.uframe__btn--sell')].filter(node => {
        const box=node.getBoundingClientRect(); return box.width>0&&box.height>0;
      }).length,
      modalOpen: !!document.querySelector('.modal,.guide'),
      activeTag: document.activeElement?.tagName || null,
      activeClass: typeof document.activeElement?.className === 'string' ? document.activeElement.className : null,
      dialogs: [...document.querySelectorAll('.modal,.guide,[role="dialog"]')].map(node => ({
        className: typeof node.className === 'string' ? node.className : '',
        visible: node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
      })),
    }));
    if (saleUi.detailOpen) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.dpanel'), { timeout: 3_000 });
    }
    await new Promise(resolve => setTimeout(resolve, 120));
    const sellOffset = attempt.ws.sent.length; await page.keyboard.press('e');
    const sold = await waitSent(attempt,'g.sell',4_000,sellOffset);
    const saleApplied = await page.waitForFunction(async ({id,uid,gold})=>{const p=await(await fetch(`/resonance/api/sessions/${id}`)).json();return !p.state?.pieces?.some(x=>x.uid===uid)&&p.state?.gold>gold}, {timeout:4_000}, {id:attempt.sessionId,uid:purchased.uid,gold:goldBeforeSale}).then(()=>true,()=>false);
    const soldState = await readState();
    check('native-e-sell',!!sold&&!soldState.pieces.some(piece=>piece.uid===purchased.uid)&&soldState.gold>goldBeforeSale,
      {sold,saleApplied,saleUi,pieceUid:purchased.uid,goldBeforeSale,goldAfter:soldState.gold,pieceStillOwned:soldState.pieces.some(piece=>piece.uid===purchased.uid)});
    const groundRing = await page.evaluate(async () => {
      const { tierChipLook } = await import('./js/render/textures.js');
      const state=(await (await import('./js/store.js')).store.get?.()) || null;
      const pieces=state?.match?.private?.resonance?.state?.pieces?.filter(piece=>piece.row!=null)||[];
      const view=globalThis.__SP_VIEW__;
      return {look:tierChipLook(),renderedPieces:pieces.filter(piece=>Number.isSafeInteger(piece.nativeUid)&&!!view?.pieceScreenRect?.(piece.nativeUid)).length,expectedPieces:pieces.length};
    });
    check('ground-tier-ring', groundRing.look === 'base' && groundRing.expectedPieces >= 3 && groundRing.renderedPieces >= 3, groundRing);
    await page.click('button[aria-label="金币与收入"]'); await page.waitForSelector('.rs-native-resonance-panel .rs-income__interest');
    const income = await page.$eval('.rs-native-resonance-panel--income .rs-income__interest', (node) => ({ text: node.innerText, steps: node.querySelectorAll('.rs-income__coin-step').length, font:parseFloat(getComputedStyle(node).fontSize) }));
    check('xp-interest-graphics', income.steps > 0 && /利息/.test(income.text) && income.font>=16, income);
    await page.click('button[aria-label="关闭面板"]');
    // Sell one additional deployed member through the E shortcut so the ordinary shop refresh and real XP price
    // remain affordable without fixture-only gold. Two deployed members remain for combat.
    const fundingPiece = (await readUiState()).pieces.find(piece => piece.row != null);
    assert(fundingPiece, 'no deployed member available for the legal refresh/XP budget');
    point = await nativePiecePoint(page, fundingPiece.nativeUid);
    await page.mouse.move(point.x,point.y); await page.mouse.click(point.x,point.y);
    await new Promise(resolve => setTimeout(resolve, 120));
    if (await page.$('.dpanel')) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.dpanel'), { timeout: 3_000 });
    }
    const fundingSellOffset = attempt.ws.sent.length; await page.keyboard.press('e');
    const fundingSell = await waitSent(attempt,'g.sell',4_000,fundingSellOffset);
    await page.waitForFunction(async ({id,uid})=>{const p=await(await fetch(`/resonance/api/sessions/${id}`)).json();return !p.state?.pieces?.some(x=>x.uid===uid)}, {timeout:5_000}, {id:attempt.sessionId,uid:fundingPiece.uid});
    const fundingState = await readState();
    check('native-e-sell-funds-controls', !!fundingSell && !fundingState.pieces.some(piece=>piece.uid===fundingPiece.uid)
      && fundingState.pieces.filter(piece=>piece.row!=null).length>=2, {
      fundingSell,pieceUid:fundingPiece.uid,remainingDeployed:fundingState.pieces.filter(piece=>piece.row!=null).length,gold:fundingState.gold,
    });
    const sentBeforeEconomy = attempt.ws.sent.length;
    let wsOffset = attempt.ws.sent.length; await page.click('.shopbar__tools .toolbtn--ice'); const froze = await waitSent(attempt, 'g.freeze', 8_000, wsOffset);
    wsOffset = attempt.ws.sent.length; await page.click('.shopbar__tools .toolbtn--ice'); const unfroze = await waitSent(attempt, 'g.freeze', 3_000, wsOffset);
    const beforeRefresh = await readState();
    assert(beforeRefresh.gold >= Number(beforeRefresh.shop?.refreshPrice ?? 1), `mainline refresh is not affordable: ${JSON.stringify({gold:beforeRefresh.gold,price:beforeRefresh.shop?.refreshPrice})}`);
    wsOffset = attempt.ws.sent.length; await page.keyboard.press('d'); const refreshed = await waitSent(attempt, 'g.refresh', 8_000, wsOffset);
    check('refresh-lock', !!froze && !!unfroze && !!refreshed && attempt.ws.sent.length > sentBeforeEconomy, { froze, unfroze, refreshed,goldBeforeRefresh:beforeRefresh.gold });
    const beforeXp = await readState();
    const levelCard = await page.$('.shopbar__row .lvcard'); assert(levelCard, 'native XP level card is missing');
    const xpPrice = await levelCard.$eval('.lvcard__price', node => Number((node.innerText || '').match(/\d+/)?.[0]));
    assert(Number.isFinite(xpPrice) && beforeXp.gold >= xpPrice, `mainline XP upgrade is not affordable: ${JSON.stringify({gold:beforeXp.gold,xpPrice})}`);
    const xpOffset = attempt.ws.sent.length; await page.keyboard.press('f');
    const xpSent = await waitSent(attempt, 'g.levelUp', 6_000, xpOffset);
    await page.waitForFunction(async ({ id, revision }) => {
      const packet = await (await fetch(`/resonance/api/sessions/${id}`)).json();
      return packet.state?.revision > revision;
    }, { timeout: 8_000 }, { id: attempt.sessionId, revision: beforeXp.revision });
    const afterXp = await readState(); check('xp-interest-graphics', !!xpSent && (afterXp.xp !== beforeXp.xp || afterXp.level > beforeXp.level), { xpSent, beforeXp: { xp: beforeXp.xp, level: beforeXp.level }, afterXp: { xp: afterXp.xp, level: afterXp.level }, income });
    await capture('06-equipment');
    const ready = await page.$('.readybtn:not(:disabled)'); assert(ready, 'native ready control is not enabled after deployment');
    const ledger = await readState(); attempt.ledgerBeforeCombat = { history: ledger.history?.length, gold: ledger.gold, hp: ledger.hp, round: ledger.round };
    const battleStartOffset = attempt.ws.received.length;
    await ready.click();
    const battleStart = await waitReceived(attempt, 'b.start', 20_000, battleStartOffset);
    assert(battleStart?.battleId, 'native WS did not deliver a real b.start after ready');
    attempt.battleId = battleStart.battleId;
    const progressOffset = attempt.ws.sent.length;
    const progressOne = await waitSent(attempt, 'b.progress', 6_000, progressOffset);
    const progressOneIndex = progressOne ? attempt.ws.sent.findIndex(message => message === progressOne) : -1;
    const progressTwo = progressOneIndex >= 0 ? await waitSent(attempt, 'b.progress', 6_000, progressOneIndex + 1) : null;
    const progressTwoIndex = progressTwo ? attempt.ws.sent.findIndex(message => message === progressTwo) : -1;
    const progressThree = progressTwoIndex >= 0 ? await waitSent(attempt, 'b.progress', 6_000, progressTwoIndex + 1) : null;
    const progressSeconds = progressOne && progressThree && progressOne.battleId === attempt.battleId && progressThree.battleId === attempt.battleId
      ? (Date.parse(progressThree.at) - Date.parse(progressOne.at)) / 1000 : 0;
    check('combat-progress-two-seconds', !!attempt.battleId && !!progressOne && !!progressThree && progressSeconds >= 2,
      { battleId: attempt.battleId, progressOne, progressThree, progressSeconds });
    const speedChanges=[];
    for(const expectedSpeed of [4,1,2]) {
      const control=await page.$('[data-testid="battle-speed"]'); assert(control,'native combat speed control is missing');
      const receivedOffset=attempt.ws.received.length, sentOffset=attempt.ws.sent.length;
      await clickHandleByMeasuredCenter(page,control,`set native combat speed ${expectedSpeed}`);
      const start=await waitReceivedWhere(attempt,row=>row.t==='b.start'&&row.battleId===attempt.battleId&&row.speed===expectedSpeed,5_000,receivedOffset);
      const request=attempt.ws.sent.slice(sentOffset).find(row=>row.t==='g.resonanceCombat'&&row.speed===expectedSpeed);
      speedChanges.push({expectedSpeed,start,request});
      assert(start&&request,`native speed ${expectedSpeed} did not update the same live battle: ${JSON.stringify(speedChanges.at(-1))}`);
    }
    check('combat-speed-1-2-4-same-battle',speedChanges.length===3&&speedChanges.every(row=>row.start.battleId===attempt.battleId)
      &&new Set(speedChanges.map(row=>row.start.speed)).size===3,{battleId:attempt.battleId,speeds:[...speedChanges.map(row=>row.start.speed)],speedChanges});
    await capture('14-combat-controls');
    await capture('07-combat');
    const beforePauseFrame = attempt.ws.sent.filter(message=>message.t==='b.progress'&&message.battleId===attempt.battleId).at(-1);
    let pauseOffset = attempt.ws.sent.length, publicOffset = attempt.ws.received.length;
    await page.keyboard.press('Space'); const pause = await waitSent(attempt, 'g.pause', 8_000, pauseOffset);
    const pausedPublic = await waitReceivedWhere(attempt,message=>message.t==='m.public'&&message.paused===true,5_000,publicOffset);
    const fastFinishPausedDisabled=await page.$eval('[data-testid="battle-fast-finish"]',node=>node.disabled);
    await sleep(2_100);
    const pausedFrames = attempt.ws.sent.filter(message=>message.t==='b.progress'&&message.battleId===attempt.battleId&&message.at>pausedPublic?.at);
    const pausedGt = attempt.ws.sent.filter(message=>message.t==='b.progress'&&message.battleId===attempt.battleId&&message.at<=pausedPublic?.at).at(-1)?.gt ?? beforePauseFrame?.gt ?? null;
    publicOffset = attempt.ws.received.length; pauseOffset = attempt.ws.sent.length;
    await page.keyboard.press('Space'); const resume = await waitSent(attempt, 'g.pause', 3_000, pauseOffset);
    const resumedPublic = await waitReceivedWhere(attempt,message=>message.t==='m.public'&&message.paused===false,5_000,publicOffset);
    const resumedFrame = await waitSentWhere(attempt,message=>message.t==='b.progress'&&message.battleId===attempt.battleId
      && Number.isFinite(message.gt)&&message.gt>Number(pausedGt),6_000,attempt.ws.sent.length);
    check('pause-freezes-and-resume-progresses', !!pause && pause.paused === true && !!pausedPublic
      && fastFinishPausedDisabled && pausedFrames.length===0 && !!resume && resume.paused === false && !!resumedPublic && !!resumedFrame,
      { pause, pausedPublic, fastFinishPausedDisabled, beforePauseFrame, pausedFrames, pausedGt, resume, resumedPublic, resumedFrame });
    const fastFinishButton=await page.$('[data-testid="battle-fast-finish"]');
    assert(fastFinishButton&&await fastFinishButton.evaluate(node=>!node.disabled),'fast-finish must be available after combat resumes');
    const fastFinishOffset=attempt.ws.sent.length, fastStartOffset=attempt.ws.received.length;
    await clickHandleByMeasuredCenter(page,fastFinishButton,'native fast finish');
    const fastRequest=await waitSentWhere(attempt,row=>row.t==='g.resonanceCombat'&&row.finish===true,5_000,fastFinishOffset);
    const finishingStart=await waitReceivedWhere(attempt,row=>row.t==='b.start'&&row.battleId===attempt.battleId&&row.speed===32,5_000,fastStartOffset);
    assert(fastRequest&&finishingStart,'fast-finish did not accelerate the current native battle');
    const during = await readState();
    check('combat-ledger-immutable', during.history?.length === attempt.ledgerBeforeCombat.history && during.gold === attempt.ledgerBeforeCombat.gold && during.hp === attempt.ledgerBeforeCombat.hp && during.round === attempt.ledgerBeforeCombat.round,
      { before: attempt.ledgerBeforeCombat, during: { history: during.history?.length, gold: during.gold, hp: during.hp, round: during.round } });
    const priorBattleIds = new Set(attempt.ws.received.filter((message) => message.t === 'b.start').map((message) => message.battleId));
    const progressBeforeReload = attempt.ws.sent.filter(message=>message.t==='b.progress'&&message.battleId===attempt.battleId).at(-1);
    const reloadOffset = attempt.ws.received.length, reloadProgressOffset = attempt.ws.sent.length;
    const combatUrl = page.url(); await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.rs-native-match', { timeout: 40_000 });
    const restoredStart = await waitReceived(attempt,'b.start',20_000,reloadOffset);
    const restoredPublic = await waitReceivedWhere(attempt,message=>message.t==='m.public'&&message.phase==='COMBAT',5_000,reloadOffset);
    const restoredElapsedDelta = Number(restoredStart?.elapsed)-Number(progressBeforeReload?.gt);
    check('reload-restores-same-battle', !!restoredStart && restoredStart.battleId===attempt.battleId
      && page.url()===combatUrl && priorBattleIds.size===1 && attempt.ws.connections?.length>=2
      && Number.isFinite(restoredStart.elapsed) && restoredElapsedDelta>0 && !!restoredPublic,
      { url:page.url(),battleIds:[...priorBattleIds],restoredStart,restoredPublic,progressBeforeReload,restoredElapsedDelta,
        progressAfterReload:attempt.ws.sent.slice(reloadProgressOffset).filter(message=>message.t==='b.progress'&&message.battleId===attempt.battleId),connections:attempt.ws.connections });
    const settleAt = Date.now() + Math.max(10_000, DEADLINE_MS - (Date.now() - Date.parse(attempt.startedAt)) - 5_000);
    await page.waitForFunction(async () => {
      const sid = new URL(location.href).searchParams.get('session'), packet = await (await fetch(`/resonance/api/sessions/${sid}`)).json();
      return (packet.state?.history || []).filter((row) => row.type === 'fight-settled').length >= 1;
    }, { timeout: Math.max(1_000, settleAt - Date.now()) });
    const settled = await readState(), fights = settled.history?.filter((row) => row.type === 'fight-settled') || [];
    const results=attempt.ws.sent.filter(message=>message.t==='b.result'&&message.battleId===attempt.battleId);
    check('one-real-settlement', fights.length === 1 && results.length===1 && attempt.ws.sent.filter((message) => message.t === 'g.ready').length === 1,
      { fights: fights.length, results:results.length, fastRequest, finishingStart, history: fights.at(-1) });
    await clickHandleByMeasuredCenter(page,await page.$('[data-testid="check-player"]'),'settled player information');
    await page.waitForSelector('.rs-native-resonance-panel--match-info button[aria-label="本场结算"]:not(:disabled)',{visible:true,timeout:5_000});
    await clickHandleByMeasuredCenter(page,await page.$('.rs-native-resonance-panel--match-info button[aria-label="本场结算"]'),'settlement entry');
    await page.waitForSelector('.rs-native-resonance-panel--settlement[role="dialog"]',{visible:true,timeout:4_000});
    const settlementText=await page.$eval('.rs-native-resonance-panel--settlement .rs-native-resonance-panel__body',node=>node.innerText);
    const settlementClose=await page.$('.rs-native-resonance-panel--settlement button[aria-label="关闭面板"]');
    assert(settlementClose&&settlementText.trim(),'settlement entry opened an empty or unclosable window');
    await clickHandleByMeasuredCenter(page,settlementClose,'settlement panel close');
    await page.waitForFunction(()=>!document.querySelector('.rs-native-resonance-panel--settlement'),{timeout:4_000});
    openedPanels.push({label:'本场结算',opened:true,closed:true});
    check('native-panels-open-close',openedPanels.filter(row=>row.opened&&row.closed).length>=7,openedPanels);
    const fullLink = await page.$('a.rs-fullscreen-small'); assert(fullLink, 'Native screen is missing its independent full-screen link');
    const fullHref = await fullLink.evaluate((node) => ({ href: node.href, target: node.target, rel: node.rel }));
    assert(fullHref.href === page.url() && fullHref.target === '_blank' && fullHref.rel.split(/\s+/).includes('noopener'),
      `full-screen link must preserve the current session URL and open safely: ${JSON.stringify({ fullHref, pageUrl: page.url() })}`);
    const popupPromise = waitForPopup(page);
    const linkRect = await fullLink.boundingBox(); assert(linkRect && linkRect.width > 0 && linkRect.height > 0, 'full-screen link is not visibly clickable');
    await page.mouse.click(linkRect.x + linkRect.width / 2, linkRect.y + linkRect.height / 2);
    const popupPage = await popupPromise;
    await popupPage.waitForSelector('.rs-native-match', { timeout: 30_000 });
    const popupEvidence = await popupPage.evaluate(() => ({ href: location.href,
      session: new URL(location.href).searchParams.get('session'), hash: location.hash,
      root: !!document.querySelector('.rs-native-match') }));
    check('native-fullscreen-open-link', popupEvidence.root && popupEvidence.href === fullHref.href
      && popupEvidence.session === new URL(fullHref.href).searchParams.get('session') && popupEvidence.hash === new URL(fullHref.href).hash,
      { link: fullHref, popup: popupEvidence });
    await popupPage.close();
    await capture('08-settle');
    const fixtureResults = await runNativeFixtureChecks({ page, baseUrl: `http://${HOST}:${PORT}/resonance.html`, fixtureSetup,
      attempt, check, capture, waitSent, waitReceived, clickVisibleButtonText, nativePiecePoint });
    attempt.fixtureResults = fixtureResults;
    attempt.fixtures = { fifthChoice: 'passed', emissaryExactCounts: 'passed', boss: fixtureResults.final?.terminalReason || 'passed', hiddenCore: fixtureResults.hidden?.terminalReason || 'passed' };
    const savedSessionUrl = `http://${HOST}:${PORT}/resonance.html?session=${encodeURIComponent(attempt.sessionId)}`;
    await page.goto(savedSessionUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForSelector('.rs-native-match .gtop__exit', { visible: true, timeout: 30_000 });
    await page.waitForFunction(async () => {
      const { store } = await import('./js/store.js');
      const publicPhase = store.get().match.public?.phase;
      const privatePhase = store.get().match.private?.resonance?.state?.phase;
      return !!privatePhase && publicPhase !== 'COMBAT' && !/combat/i.test(String(privatePhase));
    }, { timeout: 20_000 });
    const exitBefore = await page.evaluate(async id => {
      const { store } = await import('./js/store.js');
      const packet = await (await fetch(`/resonance/api/sessions/${id}`)).json();
      return { sessionId: id, url: location.href, entry: !!document.querySelector('.rs-native-match'),
        publicPhase: store.get().match.public?.phase, privatePhase: store.get().match.private?.resonance?.state?.phase,
        round: packet.state?.round, gold: packet.state?.gold, hp: packet.state?.hp, historyCount: packet.state?.history?.length,
        revision: packet.state?.revision };
    }, attempt.sessionId);
    assert(exitBefore.entry && exitBefore.publicPhase !== 'COMBAT' && !/combat/i.test(String(exitBefore.privatePhase)),
      `exit check must begin from the original saved session outside combat: ${JSON.stringify(exitBefore)}`);
    const exitOffset = attempt.ws.sent.length;
    const openExit = async () => {
      const button = await page.$('.rs-native-match .gtop__exit');
      assert(button, 'Native exit control is missing');
      await clickHandleByMeasuredCenter(page, button, 'Native exit control');
      await page.waitForSelector('.modal__box[role="dialog"]', { visible: true, timeout: 4_000 });
      const title = await page.$eval('.modal__box[role="dialog"] .modal__title', node => node.innerText.trim());
      assert(title === '返回首页', `Native exit opened the wrong modal: ${title}`);
      return title;
    };
    const cancelTitle = await openExit();
    const cancelExit = await page.$('.modal__box[role="dialog"] .modal__actions button');
    assert(cancelExit && await cancelExit.evaluate(node => node.innerText.trim()) === '取消', 'Native exit modal has no cancel action');
    await clickHandleByMeasuredCenter(page, cancelExit, 'cancel Native exit');
    await page.waitForFunction(() => !document.querySelector('.modal__box[role="dialog"]') && !!document.querySelector('.rs-native-match'), { timeout: 4_000 });
    const reopenedTitle = await openExit();
    const actionButtons = await page.$$('.modal__box[role="dialog"] .modal__actions button');
    let saveButton = null;
    for (const button of actionButtons) if ((await button.evaluate(node => node.innerText.trim())) === '保存并返回') { saveButton = button; break; }
    assert(saveButton && await saveButton.evaluate(node => node.innerText.trim()) === '保存并返回', 'Native exit modal has no save-and-return action');
    await clickHandleByMeasuredCenter(page, saveButton, 'save session and return to title');
    await page.waitForSelector('.rs-entry', { visible: true, timeout: 12_000 });
    const exitAfter = await page.evaluate(async id => {
      const packet = await (await fetch(`/resonance/api/sessions/${id}`)).json();
      return { url: location.href, entry: !!document.querySelector('.rs-entry'), nativeMatch: !!document.querySelector('.rs-native-match'),
        hasSessionQuery: new URL(location.href).searchParams.has('session'), savedSessionExists: !!packet.state,
        round: packet.state?.round, gold: packet.state?.gold, hp: packet.state?.hp, historyCount: packet.state?.history?.length,
        revision: packet.state?.revision };
    }, attempt.sessionId);
    const exitMessages = attempt.ws.sent.slice(exitOffset).map(message => message.t);
    const forbiddenExitMessages = exitMessages.filter(type => ['g.leave', 'room.leave', 'g.autoplay'].includes(type));
    check('native-remaining-controls-live', !!remainingControls.shop?.collapsed?.collapsed && remainingControls.shop.expanded
      && remainingControls.scouting?.entered === 'pen' && remainingControls.scouting.returnedTo === remainingControls.scouting.initialCamera
      && remainingControls.settingsGuide?.opened?.open && remainingControls.settingsGuide.closed
      && remainingControls.settlementBeforeFirstFight?.disabled && /完成首场战斗后可查看/.test(remainingControls.settlementBeforeFirstFight.title)
      && cancelTitle === '返回首页' && reopenedTitle === '返回首页' && exitAfter.entry && !exitAfter.nativeMatch && !exitAfter.hasSessionQuery
      && exitAfter.savedSessionExists && exitAfter.round === exitBefore.round && exitAfter.gold === exitBefore.gold
      && exitAfter.hp === exitBefore.hp && exitAfter.historyCount === exitBefore.historyCount && forbiddenExitMessages.length === 0,
      { controls: remainingControls, exitBefore, cancelTitle, reopenedTitle, exitAfter, exitMessages, forbiddenExitMessages });
    const allTypography=Object.values(attempt.typographySnapshots||{});
    const visibleTextRows=allTypography.flatMap(row=>row.texts||[]), smallText=allTypography.flatMap(row=>row.small||[]), smallBody=allTypography.flatMap(row=>row.smallBody||[]), smallPseudo=allTypography.flatMap(row=>row.smallPseudo||[]);
    const textAudit={captures:Object.keys(attempt.typographySnapshots||{}),viewports:[...new Map(allTypography.map(row=>[`${row.viewport.width}x${row.viewport.height}`,row.viewport])).values()],
      stylesheetHrefs:[...new Set(allTypography.flatMap(row=>row.sheets||[]))],visibleTextCount:visibleTextRows.length,smallText:smallText.slice(0,80),smallBody:smallBody.slice(0,80),smallPseudo:smallPseudo.slice(0,80)};
    check('native-visible-text-audit-14px',allTypography.length>=10&&visibleTextRows.length>0&&smallText.length===0&&smallBody.length===0&&smallPseudo.length===0,textAudit);
  } catch (error) {
    attempt.status = 'failed'; attempt.failures.push({ at: now(), error: error.stack || String(error) }); log.push(`FAILED ${error.stack || error}`);
    if (page && !page.isClosed()) attempt.failurePage = await page.evaluate(() => ({ url:location.href, body:document.body.innerText.slice(-1200) })).catch(() => null);
  } finally {
    clearTimeout(deadline);
    if (browser) {
      const browserProcess = browser.process?.();
      await Promise.race([browser.close().catch(() => {}), sleep(2_000)]);
      if (browserProcess && browserProcess.exitCode == null) browserProcess.kill('SIGKILL');
    }
    if (server) await Promise.race([server.close().catch(() => {}), sleep(2_000)]);
    attempt.finishedAt = now(); attempt.timedOut = timedOut; attempt.browserErrors = errors; attempt.badResponses = badResponses;
    attempt.forbiddenRequests = forbiddenRequests; attempt.missingChecks = missingChecks(attempt.checks);
    const faults = runtimeFaults(attempt);
    if (faults.browserErrors.length || faults.badResponses.length || faults.forbiddenRequests.length) {
      attempt.status = 'failed';
      attempt.failures.push({ at: now(), error: 'browser or network faults present', runtimeFaults: faults });
    }
    if (attempt.status === 'running') attempt.status = attempt.missingChecks.length ? 'incomplete' : 'passed';
    if (screenshotCount(attempt.screenshots) > 14) { attempt.status = 'failed'; attempt.failures.push({ at: now(), error: 'screenshot limit exceeded' }); }
    receipt.finishedAt = attempt.finishedAt;
    log.push(`status=${attempt.status}`, `session=${attempt.sessionId || 'none'}`, `missingChecks=${attempt.missingChecks.join(',')}`);
    await save(); await writeFile(LOG, `${log.join('\n')}\n`, { flag: 'a' });
    process.stdout.write(`${JSON.stringify({ status: attempt.status, receipt: receiptPath, log: LOG, sessionId: attempt.sessionId || null, screenshots: attempt.screenshots })}\n`);
  }
  if (attempt.status !== 'passed') process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) run().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
