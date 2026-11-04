#!/usr/bin/env node
// tools/assault/check-route-design.mjs — deterministic validator for the 进击 (Assault) event and
// encounter design tables.
//
// Usage:
//   node tools/assault/check-route-design.mjs [--events] [--encounters] [--all] [--partial] [--help]
//
//   --events       validate data/assault-design/events.json (assault-events-design/v1)
//   --encounters   validate data/assault-design/encounters.json (assault-encounters-design/v1)
//   --all          both (default when neither is given)
//   --partial      tolerate an incomplete table (fewer than the 24 events / 36 encounters) but still
//                  require every present record to be complete and its source references to resolve
//
// Exit 0 when every checked record passes; exit 1 with a FAIL line per problem otherwise. The tool
// reads (never writes) the canonical source tables; no network, no browser, no git.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeployMap, FIELD } from '../../server/match/board.js';
import { GEO } from '../../shared/constants.js';
import { Grid } from '../../server/sim/grid.js';
import { normalizeStage } from '../../server/sim/simdata.js';
import { readDatabase, readPointer } from './bazaar-native.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const EVENTS_PATH = path.join(ROOT, 'data', 'assault-design', 'events.json');
const encounterArg = process.argv.indexOf('--encounters-file');
if (encounterArg >= 0 && !process.argv[encounterArg + 1]) throw new Error('--encounters-file requires an explicit path');
const ENCOUNTERS_PATH = encounterArg >= 0 ? path.resolve(process.argv[encounterArg + 1]) : path.join(ROOT, 'data', 'assault-design', 'encounters.json');
const EVENTS_MD_PATH = path.join(ROOT, 'docs', 'assault-mode', 'events.md');
const PATHS = {
  stages: path.join(ROOT, 'data', 'stages.json'),
  waves: path.join(ROOT, 'data', 'waves.json'),
  enemies: path.join(ROOT, 'data', 'enemies.json'),
  bosses: path.join(ROOT, 'data', 'bosses.json'),
};

// Canonical absolute source (read-only). The rogue topic table holds the six 肉鸽 themes.
const CANON_SOURCE = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights';
const ROGUE_TABLE = `${CANON_SOURCE}/excel/roguelike_topic_table.json`;
const BAZAAR_DB = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/bazaar/official-GameData.db';
const KNOWN_EVENT_SOURCES = new Set([ROGUE_TABLE]);

const TOPICS = ['rogue_1', 'rogue_2', 'rogue_3', 'rogue_4', 'rogue_5', 'rogue_6'];
const EVENT_TOPICS = [...TOPICS, 'bazaar'];
const CURRENCIES = ['gold', 'hp', 'xp'];
const PROFESSIONS = ['PIONEER', 'WARRIOR', 'TANK', 'SNIPER', 'CASTER', 'MEDIC', 'SUPPORT', 'SPECIAL'];
const TRACKS = ['cold', 'redeploy', 'ammo', 'element', 'summon', 'healShield', 'blockCounter', 'pierceCrit', 'skillCycle', 'economyGrowth', 'cross', 'leader'];
const RARITIES = ['common', 'rare', 'epic', 'starter'];
const LIFECYCLES = ['instant', 'battle', 'nextBattle', 'run'];
const CHOICE_MODES = ['none', 'selectTeam', 'selectBench', 'recruit'];
const EFFECT_KINDS = ['gold', 'xp', 'hp', 'relicChoice', 'recruit', 'enhance', 'redeploy', 'repair', 'tag', 'shopDiscount', 'randomEnchant'];
const ENCOUNTER_KINDS = ['normal', 'risk', 'final'];
const BAND_IDS = ['band1', 'band2', 'band3', 'band4', 'band5'];
const PLAYER_ROWS = [FIELD.r0, FIELD.r1];
const PLAYER_COLS = [FIELD.c0, FIELD.c1];

// ------------------------------------------------------------------------------------------------
// small helpers

const norm = (p) => String(p == null ? '' : p).replace(/\\/g, '/');
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const eqArr = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

function resolvePointer(root, pointer) {
  if (!isStr(pointer) || !pointer.startsWith('/')) return undefined;
  const parts = pointer.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ------------------------------------------------------------------------------------------------
// effect schema

function validateEffect(eff, where, errors) {
  const at = `${where} effect`;
  if (!isObj(eff)) { errors.push(`${at}: not an object`); return; }
  if (!EFFECT_KINDS.includes(eff.kind)) { errors.push(`${at}: unknown kind ${JSON.stringify(eff.kind)}`); return; }
  if (!LIFECYCLES.includes(eff.lifecycle)) errors.push(`${at} (${eff.kind}): lifecycle must be one of ${LIFECYCLES.join('/')}`);
  switch (eff.kind) {
    case 'gold':
      if (!isInt(eff.amount) || eff.amount === 0) errors.push(`${at} gold: amount must be a non-zero integer`);
      break;
    case 'xp':
      if (!isInt(eff.amount) || eff.amount <= 0) errors.push(`${at} xp: amount must be a positive integer`);
      break;
    case 'hp':
      if (!isInt(eff.amount) || eff.amount === 0) errors.push(`${at} hp: amount must be a non-zero integer`);
      break;
    case 'relicChoice':
      if (!TRACKS.includes(eff.track)) errors.push(`${at} relicChoice: track must be one of ${TRACKS.join('/')}`);
      if (!RARITIES.includes(eff.rarity)) errors.push(`${at} relicChoice: rarity must be one of ${RARITIES.join('/')}`);
      if (!isInt(eff.count) || eff.count <= 0) errors.push(`${at} relicChoice: count must be a positive integer`);
      if (eff.lifecycle !== 'run') errors.push(`${at} relicChoice: lifecycle must be run`);
      break;
    case 'recruit':
      if (!['profession', 'faction', 'random'].includes(eff.selection)) errors.push(`${at} recruit: selection must be profession/faction/random`);
      if (eff.selection !== 'random' && !isStr(eff.tag)) errors.push(`${at} recruit: tag is required for a directed selection`);
      if (!isInt(eff.count) || eff.count <= 0) errors.push(`${at} recruit: count must be a positive integer`);
      break;
    case 'enhance':
      if (!['atk', 'def', 'hp', 'aspd', 'spGain', 'blockCnt'].includes(eff.stat)) errors.push(`${at} enhance: invalid stat`);
      if (!isNum(eff.amount) || eff.amount <= 0) errors.push(`${at} enhance: amount must be a positive number`);
      if (!['flat', 'percent'].includes(eff.mode)) errors.push(`${at} enhance: mode must be flat/percent`);
      if (!['team', 'profession', 'tag', 'selected'].includes(eff.scope)) errors.push(`${at} enhance: invalid scope`);
      if (!['battle', 'nextBattle', 'run'].includes(eff.duration)) errors.push(`${at} enhance: invalid duration`);
      break;
    case 'redeploy':
      if (!['selected', 'lowestHp', 'random'].includes(eff.target)) errors.push(`${at} redeploy: invalid target`);
      if (typeof eff.free !== 'boolean') errors.push(`${at} redeploy: free must be boolean`);
      break;
    case 'repair':
      if (!['all', 'selected', 'bench'].includes(eff.target)) errors.push(`${at} repair: invalid target`);
      if (!['full', 'percent', 'flat'].includes(eff.mode)) errors.push(`${at} repair: invalid mode`);
      if (eff.mode !== 'full' && (!isNum(eff.amount) || eff.amount <= 0)) errors.push(`${at} repair: amount required for ${eff.mode}`);
      break;
    case 'tag':
      if (!isStr(eff.tag)) errors.push(`${at} tag: tag name required`);
      if (!['battle', 'nextBattle', 'run'].includes(eff.duration)) errors.push(`${at} tag: invalid duration`);
      break;
    case 'shopDiscount':
      if (!isInt(eff.amount) || eff.amount <= 0) errors.push(`${at} shopDiscount: amount must be a positive integer`);
      if (!['next', 'run'].includes(eff.scope)) errors.push(`${at} shopDiscount: invalid scope`);
      break;
    case 'randomEnchant':
      if (!isStr(eff.poolId)) errors.push(`${at} randomEnchant: poolId is required`);
      if (!['oldestUnenchanted', 'oldestToxic'].includes(eff.targetRule)) errors.push(`${at} randomEnchant: invalid targetRule`);
      if (eff.lifecycle !== 'run') errors.push(`${at} randomEnchant: lifecycle must be run`);
      break;
  }
}

function validateCost(cost, where, errors) {
  const at = `${where} cost`;
  if (!isObj(cost)) { errors.push(`${at}: not an object`); return null; }
  if (!CURRENCIES.includes(cost.currency)) { errors.push(`${at}: currency must be one of ${CURRENCIES.join('/')}`); return null; }
  if (!isInt(cost.amount) || cost.amount <= 0) { errors.push(`${at} (${cost.currency}): amount must be a positive integer`); return null; }
  return cost;
}

const OUTCOME_SUM_EPS = 1e-6;

function validateChoice(choice, where, errors, bazaar = false) {
  const at = `${where} choice`;
  if (!isObj(choice)) { errors.push(`${at}: not an object`); return; }
  if (!isStr(choice.id) || !/^[a-z0-9_]+$/.test(choice.id)) errors.push(`${at}: id must be lowercase ASCII`);
  if (!isStr(choice.label)) errors.push(`${at} (${choice.id}): label required`);
  if (!isStr(choice.description)) errors.push(`${at} (${choice.id}): description required`);
  if (!isObj(choice.conditions)) errors.push(`${at} (${choice.id}): conditions object required`);

  if (!Array.isArray(choice.costs)) errors.push(`${at} (${choice.id}): costs must be an array`);
  const costs = Array.isArray(choice.costs) ? choice.costs : [];
  const minCurrency = isObj(choice.conditions) && isObj(choice.conditions.minCurrency) ? choice.conditions.minCurrency : {};
  for (const c of costs) {
    const parsed = validateCost(c, at, errors);
    if (!parsed) continue;
    const min = minCurrency[parsed.currency];
    if (!(isInt(min) && min >= parsed.amount)) errors.push(`${at} (${choice.id}): conditions.minCurrency.${parsed.currency} must be >= cost ${parsed.amount} (insufficient-balance guard)`);
  }

  if (!Array.isArray(choice.outcomes) || choice.outcomes.length === 0) { errors.push(`${at} (${choice.id}): outcomes must be a non-empty array`); return; }
  let sum = 0;
  let effectCount = 0;
  for (let i = 0; i < choice.outcomes.length; i++) {
    const o = choice.outcomes[i];
    const ow = `${at} (${choice.id}) outcome[${i}]`;
    if (!isObj(o)) { errors.push(`${ow}: not an object`); continue; }
    if (!isNum(o.probability) || o.probability <= 0 || o.probability > 1) errors.push(`${ow}: probability must be in (0,1]`);
    else sum += o.probability;
    if (!Array.isArray(o.effects)) { errors.push(`${ow}: effects must be an array`); continue; }
    effectCount += o.effects.length;
    for (const e of o.effects) validateEffect(e, ow, errors);
  }
  if (Math.abs(sum - 1) > OUTCOME_SUM_EPS) errors.push(`${at} (${choice.id}): probabilities sum to ${sum}, expected 1`);

  const isLeave = costs.length === 0 && effectCount === 0;
  if (!isLeave && effectCount === 0) errors.push(`${at} (${choice.id}): a non-leave choice must have at least one effect`);

  if (!isObj(choice.targeting) || !CHOICE_MODES.includes(choice.targeting.mode)) errors.push(`${at} (${choice.id}): targeting.mode must be one of ${CHOICE_MODES.join('/')}`);
  return { isLeave, id: choice.id };
}

function validateBazaarReference(ref, where, bazaarRows, errors) {
  if (!isObj(ref) || norm(ref.database) !== norm(BAZAAR_DB) || ref.table !== 'cards' || !isStr(ref.rowId) || !isStr(ref.pointer)) {
    errors.push(`${where}: Bazaar sourceRef must identify the official cards database row and pointer`);
    return;
  }
  const raw = bazaarRows?.get(String(ref.rowId));
  if (!raw) { errors.push(`${where}: Bazaar source row ${ref.rowId} does not exist`); return; }
  let data;
  try { data = JSON.parse(raw); } catch { errors.push(`${where}: Bazaar source row ${ref.rowId} has invalid JSON`); return; }
  if (!readPointer(data, ref.pointer).found) errors.push(`${where}: Bazaar pointer does not resolve: ${ref.pointer}`);
}

function validateEvent(ev, index, rogueTable, bazaarRows, seenIds, errors) {
  const at = `events[${index}]`;
  if (!isObj(ev)) { errors.push(`${at}: not an object`); return null; }
  const id = isStr(ev.id) ? ev.id : `${at}`;
  const E = (m) => errors.push(`${at} (${id}): ${m}`);
  if (!isStr(ev.id) || !/^[a-z0-9_]+$/.test(ev.id)) E('id must be lowercase ASCII');
  else if (seenIds.has(ev.id)) E('duplicate id');
  else seenIds.add(ev.id);
  if (!isStr(ev.name)) E('name required');
  if (!EVENT_TOPICS.includes(ev.topicId)) E(`topicId must be one of ${EVENT_TOPICS.join('/')}`);
  if (!isStr(ev.story) || ev.story.length < 20) E('story required');
  if (!isInt(ev.unlockDay) || ev.unlockDay < 1 || ev.unlockDay > 10) E('unlockDay must be an integer 1..10');
  if (typeof ev.repeatable !== 'boolean') E('repeatable must be boolean');
  if (!isObj(ev.conditions)) E('conditions object required');
  if (!isStr(ev.implementationPlan) || ev.implementationPlan.length < 20) E('implementationPlan required');
  if (!Array.isArray(ev.causalChecks) || ev.causalChecks.length < 2 || ev.causalChecks.some((c) => !isStr(c))) E('causalChecks must be an array of >=2 strings');

  // ---- source reference: absolute file + JSON pointer, verified against the real table
  const sref = ev.sourceRef;
  if (ev.topicId === 'bazaar') {
    if (!isStr(ev.conversion) || ev.conversion.length < 20) E('Bazaar conversion note is required');
    validateBazaarReference(sref, `${at} (${id}) sourceRef`, bazaarRows, errors);
    if (!Array.isArray(ev.sourceChain) || !ev.sourceChain.length) E('sourceChain must preserve the official encounter chain');
    for (const [chainIndex, ref] of (ev.sourceChain ?? []).entries()) validateBazaarReference(ref, `${at} (${id}) sourceChain[${chainIndex}]`, bazaarRows, errors);
    const expectedSources = ev.id === 'evt_bazaar_hat'
      ? {
        source: ['c88b633c-cc5e-46af-b1ef-5da974223ee5', '/Abilities/0/Action/SpawnContext/Groups/0/Filters/0/Ids/0'],
        chain: [
          ['c22b85e7-3860-48b4-b639-8d55ac423b74', '/SelectionContext/SpawnContext/Groups/0/Filters/0/Ids/0'],
          ['77c2a88f-7347-4b44-b204-6b94bb1d3dcc', '/Abilities/0/Action/SpawnContext/Groups/2'],
        ],
      }
      : {
        source: ['0e7ff8fa-5464-4f45-a281-18b7f3e02f41', '/Abilities/0/Action'],
        chain: [['4751d02e-876e-47e3-bb23-d7675e4ee5c6', '/SelectionContext/SpawnContext/Groups/3/Filters/0/Ids/0']],
      };
    if (sref?.rowId !== expectedSources.source[0] || sref?.pointer !== expectedSources.source[1]) E('sourceRef does not match the audited native event source');
    if (ev.sourceChain?.length !== expectedSources.chain.length || expectedSources.chain.some(([rowId, pointer], chainIndex) => ev.sourceChain?.[chainIndex]?.rowId !== rowId || ev.sourceChain?.[chainIndex]?.pointer !== pointer)) E('sourceChain does not match the audited native encounter chain');
  } else if (!isObj(sref) || !isStr(sref.file) || !isStr(sref.pointer)) E('sourceRef {file,pointer} required');
  else {
    const file = norm(sref.file);
    if (!KNOWN_EVENT_SOURCES.has(file)) E(`sourceRef.file must be the canonical rogue table (${ROGUE_TABLE})`);
    else if (!fs.existsSync(file)) E(`sourceRef.file does not exist: ${file}`);
    const sceneId = isStr(sref.sceneId) ? sref.sceneId : sref.pointer.split('/').pop();
    const expectedPointer = `/details/${ev.topicId}/choiceScenes/${sceneId}`;
    if (norm(sref.pointer) !== expectedPointer) E(`sourceRef.pointer must be ${expectedPointer}`);
    const node = resolvePointer(rogueTable, sref.pointer);
    if (!isObj(node)) E(`sourceRef.pointer does not resolve to a scene: ${sref.pointer}`);
    else {
      if (node.id !== sceneId) E(`source scene id ${node.id} != sceneId ${sceneId}`);
      if (ev.name !== node.title) E(`event name ${JSON.stringify(ev.name)} != source title ${JSON.stringify(node.title)}`);
      if (ev.backgroundId !== node.background) E(`backgroundId ${JSON.stringify(ev.backgroundId)} != source background ${JSON.stringify(node.background)}`);
    }
  }

  // ---- choices
  const minChoices = ev.topicId === 'bazaar' ? 2 : 3;
  if (!Array.isArray(ev.choices) || ev.choices.length < minChoices) { E(`choices must be an array of >=${minChoices}`); return null; }
  const seenChoice = new Set();
  let leaves = 0;
  let viable = 0;
  ev.choices.forEach((c, i) => {
    if (isObj(c) && isStr(c.id)) {
      if (seenChoice.has(c.id)) errors.push(`${at} (${id}) choice[${i}]: duplicate choice id ${c.id}`);
      seenChoice.add(c.id);
    }
    const r = validateChoice(c, `${at} (${id})`, errors, ev.topicId === 'bazaar');
    if (r) { if (r.isLeave) leaves++; else viable++; }
  });
  if (leaves < 1) E('at least one no-cost leave choice is required');
  if (viable < (ev.topicId === 'bazaar' ? 1 : 2)) E(`at least ${ev.topicId === 'bazaar' ? 1 : 2} viable choice(s) are required`);
  if (ev.topicId === 'bazaar') {
    if (!['evt_bazaar_hat', 'evt_bazaar_botul'].includes(ev.id)) E('unknown Bazaar event id');
    if (ev.unlockDay !== 6 || ev.conditions?.minDay !== 6 || ev.conditions?.maxDay !== 9 || ev.conditions?.oncePerRun !== true || ev.repeatable !== false) E('Bazaar events must be one-time events on days 6..9');
    if (ev.choices.length !== 2 || ev.choices.some((choice) => choice.targeting?.mode !== 'none')) E('Bazaar events require exactly two non-targeting choices');
    const effect = ev.choices.flatMap((choice) => choice.outcomes.flatMap((outcome) => outcome.effects)).find((entry) => entry.kind === 'randomEnchant');
    const expectedRule = ev.id === 'evt_bazaar_hat' ? 'oldestUnenchanted' : 'oldestToxic';
    if (!effect || effect.poolId !== 'pool_bazaar_random' || effect.targetRule !== expectedRule) E('random enchant pool or target rule does not match the event');
    if (ev.id === 'evt_bazaar_botul') {
      const paid = ev.choices.find((choice) => choice.id === 'botul_recast');
      if (!paid || paid.costs?.length !== 1 || paid.costs[0].currency !== 'gold' || paid.costs[0].amount !== 20
        || paid.conditions?.minCurrency?.gold < 20) E('Botul choice must be guarded and cost 20 gold');
    }
  }
  return ev;
}

function validateEventsFile(eventsFile, partial, errors, summary) {
  if (!fs.existsSync(EVENTS_PATH)) { errors.push(`events file missing: ${norm(EVENTS_PATH)}`); summary.events = 0; return; }
  let doc;
  try { doc = readJson(EVENTS_PATH); } catch (e) { errors.push(`events file is not valid JSON: ${e.message}`); return; }
  if (doc.schema !== 'assault-events-design/v1') errors.push(`events.schema must be 'assault-events-design/v1', got ${JSON.stringify(doc.schema)}`);
  if (!Array.isArray(doc.events)) { errors.push('events.events must be an array'); return; }
  summary.events = doc.events.length;
  summary.eventTopics = {};
  const perTopic = {};
  let rogueTable = null;
  if (fs.existsSync(ROGUE_TABLE)) {
    try { rogueTable = readJson(ROGUE_TABLE); } catch (e) { errors.push(`cannot read canonical rogue table: ${e.message}`); }
  } else errors.push(`canonical rogue table missing: ${ROGUE_TABLE}`);
  let bazaarRows = new Map();
  if (doc.events.some((event) => event?.topicId === 'bazaar')) {
    if (!fs.existsSync(BAZAAR_DB)) errors.push(`official Bazaar database missing: ${BAZAAR_DB}`);
    else {
      try {
        bazaarRows = new Map(readDatabase(BAZAAR_DB, ['cards']).cards.map((row) => [String(row.rowId), row.dataText]));
      } catch (e) { errors.push(`cannot read official Bazaar cards: ${e.message}`); }
    }
  }

  const seenIds = new Set();
  doc.events.forEach((ev, i) => {
    validateEvent(ev, i, rogueTable, bazaarRows, seenIds, errors);
    if (isObj(ev) && EVENT_TOPICS.includes(ev.topicId)) perTopic[ev.topicId] = (perTopic[ev.topicId] || 0) + 1;
  });
  summary.eventTopics = perTopic;

  if (!partial) {
    if (doc.events.length !== 26) errors.push(`complete events table must hold 26 events, got ${doc.events.length}`);
    for (const t of TOPICS) if ((perTopic[t] || 0) !== 4) errors.push(`topic ${t} must hold exactly 4 events, got ${perTopic[t] || 0}`);
    if ((perTopic.bazaar || 0) !== 2) errors.push(`topic bazaar must hold exactly 2 events, got ${perTopic.bazaar || 0}`);
  }
}

// ------------------------------------------------------------------------------------------------
// encounters (full/--encounters mode)

function routeWalkable(stage, route, errors, at, field) {
  if (!isObj(route)) { errors.push(`${at}: route not an object`); return; }
  if (!['WALK', 'FLY'].includes(route.motion)) errors.push(`${at}: motion must be WALK/FLY`);
  const size = Array.isArray(stage.size) ? stage.size : null;
  const inBounds = (p) => Array.isArray(p) && p.length >= 2 && isInt(p[0]) && isInt(p[1]) && (!size || (p[0] >= 0 && p[0] < size[0] && p[1] >= 0 && p[1] < size[1]));
  if (!inBounds(route.start)) errors.push(`${at}: start out of bounds`);
  if (!inBounds(route.end)) errors.push(`${at}: end out of bounds`);
  if (!Array.isArray(route.checkpoints)) { errors.push(`${at}: checkpoints must be an array`); return; }
  for (const p of route.checkpoints) if (!inBounds(p)) errors.push(`${at}: checkpoint out of bounds`);
  // A route inside the full stage can still be outside the solo simulation field.
  // Native normal battles must not clamp a multiplayer entrance to an off-grid half tile.
  const rect = field === 'bossL' ? GEO.BOSS_RECT : GEO.NORMAL_RECT;
  const grid = new Grid(normalizeStage(stage.id, stage), rect);
  const nodesInField = [route.start, ...route.checkpoints, route.end];
  for (const point of nodesInField) if (Array.isArray(point) && !grid.inRect(point[0], point[1])) {
    errors.push(`${at}: route node ${point} is outside ${field} simulation field`);
  }
  if (route.motion === 'WALK' && nodesInField.every((p) => Array.isArray(p) && grid.inRect(p[0], p[1]))) {
    for (let i = 1; i < nodesInField.length; i++) {
      const [a, b] = [nodesInField[i - 1], nodesInField[i]];
      if (!grid.findPath(a[0], a[1], b[0], b[1])) errors.push(`${at}: no ground path inside ${field} from ${a} to ${b}`);
    }
  }
  const key = `${route.start[0]},${route.start[1]}->${route.end[0]},${route.end[1]}`;
  const gp = stage.groundPaths && typeof stage.groundPaths === 'object' ? stage.groundPaths : {};
  const gpd = stage.groundPathsWithDevices && typeof stage.groundPathsWithDevices === 'object' ? stage.groundPathsWithDevices : {};
  if (route.motion === 'WALK' && (Array.isArray(gp[key]) || Array.isArray(gpd[key]))) return; // native ground path
  // otherwise walk the node list on the stage tile legend
  const nodes = [route.start, ...route.checkpoints, route.end];
  const legend = stage.tiles && typeof stage.tiles === 'object' ? stage.tiles : {};
  const rows = Array.isArray(stage.rows) ? stage.rows : [];
  const tileAt = (r, c) => { const line = rows[r]; const g = line ? line[c] : null; return g != null && Object.prototype.hasOwnProperty.call(legend, g) ? legend[g] : null; };
  for (let i = 0; i < nodes.length; i++) {
    const [r, c] = nodes[i];
    const t = tileAt(r, c);
    if (!t) { errors.push(`${at}: node ${r},${c} has no tile`); continue; }
    const passable = route.motion === 'FLY' ? t.flyPassable !== false : t.groundPassable !== false;
    if (!passable) errors.push(`${at}: ${route.motion} node ${r},${c} is not passable`);
    if (i > 0 && route.motion === 'WALK') {
      const [pr, pc] = nodes[i - 1];
      if (Math.abs(pr - r) + Math.abs(pc - c) !== 1) errors.push(`${at}: node ${r},${c} is not adjacent to ${pr},${pc}`);
    }
  }
}

function validateEncounter(enc, index, data, seenIds, errors) {
  const at = `encounters[${index}]`;
  if (!isObj(enc)) { errors.push(`${at}: not an object`); return; }
  const id = isStr(enc.id) ? enc.id : at;
  const E = (m) => errors.push(`${at} (${id}): ${m}`);
  if (!isStr(enc.id) || !/^[a-z0-9_]+$/.test(enc.id)) E('id must be lowercase ASCII');
  else if (seenIds.has(enc.id)) E('duplicate id');
  else seenIds.add(enc.id);
  if (!isStr(enc.name)) E('name required');
  if (!ENCOUNTER_KINDS.includes(enc.kind)) E('kind must be normal/risk/final');
  if (!Array.isArray(enc.dayRange) || enc.dayRange.length !== 2 || !enc.dayRange.every(isInt)) E('dayRange must be two integers');
  if (!isStr(enc.description)) E('description required');
  if (!isStr(enc.riskExplanation)) E('riskExplanation required');
  if (!isObj(enc.rewards) || !isInt(enc.rewards.gold) || !isInt(enc.rewards.xp) || typeof enc.rewards.relicChoice !== 'boolean') E('rewards {gold:int,xp:int,relicChoice:boolean} required');
  if (enc.maxPlayTime !== 120) E('maxPlayTime must be 120');
  if (!isObj(enc.boardRegion)) E('boardRegion required');
  else {
    if (!eqArr(enc.boardRegion.playerRows, PLAYER_ROWS) || !eqArr(enc.boardRegion.playerCols, PLAYER_COLS)) E(`boardRegion player area must be rows ${PLAYER_ROWS} cols ${PLAYER_COLS}`);
    if (!['normal', 'bossL'].includes(enc.boardRegion.deployField)) E('boardRegion.deployField must be normal/bossL');
  }

  const stage = data.stages[enc.stageId];
  if (!stage) E(`stageId ${JSON.stringify(enc.stageId)} not in data/stages.json`);
  else {
    const field = isObj(enc.boardRegion) && ['normal', 'bossL'].includes(enc.boardRegion.deployField) ? enc.boardRegion.deployField : 'normal';
    const map = buildDeployMap(stage, { field });
    if (map.size === 0) E(`no deployable tiles for stage ${enc.stageId} field ${field}`);
    summaryAdd(data.__summary, 'deployTiles', map.size);
  }

  const wave = enc.wave;
  if (!isObj(wave)) { E('wave required'); return; }
  const dp = wave.dp;
  if (!isObj(dp) || dp.init !== 80 || dp.perSec !== 2 || dp.max !== 160) E('wave.dp must be {init:80,perSec:2,max:160}');
  if (!Array.isArray(wave.routes) || wave.routes.length === 0) E('wave.routes must be a non-empty array');
  else wave.routes.forEach((r, i) => { if (stage) routeWalkable(stage, r, errors, `${at} (${id}) route[${i}]`, enc.boardRegion?.deployField || 'normal'); });
  if (!Array.isArray(wave.spawns) || wave.spawns.length === 0) E('wave.spawns must be a non-empty array');
  else {
    const keys = new Set();
    wave.spawns.forEach((s, i) => {
      const sw = `${at} (${id}) spawn[${i}]`;
      if (!isObj(s)) { errors.push(`${sw}: not an object`); return; }
      const known = data.enemies[s.key] || data.bosses[s.key];
      if (!known) errors.push(`${sw}: key ${JSON.stringify(s.key)} not in enemies.json/bosses.json`);
      keys.add(s.key);
      if (!isNum(s.time) || s.time < 0 || s.time > 100) errors.push(`${sw}: time must be 0..100`);
      if (!isInt(s.count) || s.count < 1 || s.count > 50) errors.push(`${sw}: count must be 1..50`);
      if (!isNum(s.interval) || s.interval < 0 || s.interval > 30) errors.push(`${sw}: interval must be 0..30`);
      if (!isInt(s.routeIndex) || s.routeIndex < 0 || s.routeIndex >= (wave.routes || []).length) errors.push(`${sw}: routeIndex out of range`);
    });
    if (keys.size < 3) E('at least three distinct enemy keys required');
    if (enc.kind === 'final') {
      if (!isStr(wave.bossId) || !data.bosses[wave.bossId]) E('final wave.bossId must reference bosses.json');
      const escorts = [...keys].filter((k) => k !== wave.bossId && data.enemies[k]);
      if (escorts.length < 2) E('final needs the boss plus at least two escort enemy types');
    }
  }
  if (!isObj(wave.overrides)) E('wave.overrides object required');
  if (!Array.isArray(wave.specialRules)) E('wave.specialRules must be an array');
  if (!isStr(enc.implementationPlan)) E('implementationPlan required');
  if (!Array.isArray(enc.causalChecks) || enc.causalChecks.length < 2) E('causalChecks must be an array of >=2');
}

let __summary;
const summaryAdd = (s, k, v) => { if (s) s[k] = (s[k] || 0) + v; };

function validateEncountersFile(partial, errors, summary) {
  if (!fs.existsSync(ENCOUNTERS_PATH)) {
    if (partial) { summary.encounters = 0; return; }
    errors.push(`encounters file missing: ${norm(ENCOUNTERS_PATH)}`);
    summary.encounters = 0;
    return;
  }
  let doc;
  try { doc = readJson(ENCOUNTERS_PATH); } catch (e) { errors.push(`encounters file is not valid JSON: ${e.message}`); return; }
  if (doc.schema !== 'assault-encounters-design/v1') errors.push(`encounters.schema must be 'assault-encounters-design/v1', got ${JSON.stringify(doc.schema)}`);
  if (!Array.isArray(doc.encounters)) { errors.push('encounters.encounters must be an array'); return; }
  summary.encounters = doc.encounters.length;
  const data = { stages: readJson(PATHS.stages), enemies: readJson(PATHS.enemies), bosses: readJson(PATHS.bosses), __summary: summary };
  const seen = new Set();
  doc.encounters.forEach((e, i) => validateEncounter(e, i, data, seen, errors));
  if (!partial) {
    if (doc.encounters.length !== 36) errors.push(`complete encounters table must hold 36, got ${doc.encounters.length}`);
    const bands = doc.encounters.filter((e) => e.kind === 'normal' || e.kind === 'risk');
    const finals = doc.encounters.filter((e) => e.kind === 'final');
    if (finals.length !== 6) errors.push(`final encounters must be 6, got ${finals.length}`);
    if (bands.length !== 30) errors.push(`normal+risk encounters must be 30, got ${bands.length}`);
  }
}

// ------------------------------------------------------------------------------------------------
// deterministic markdown rendering (docs/assault-mode/events.md)

function effectBrief(e) {
  switch (e.kind) {
    case 'gold': return `gold${e.amount >= 0 ? '+' : ''}${e.amount}`;
    case 'xp': return `xp+${e.amount}`;
    case 'hp': return `hp${e.amount >= 0 ? '+' : ''}${e.amount}`;
    case 'relicChoice': return `relic[${e.track}/${e.rarity}]x${e.count}`;
    case 'recruit': return `recruit[${e.selection}${e.tag ? ':' + e.tag : ''}]x${e.count}`;
    case 'enhance': return `enhance[${e.stat} ${e.mode === 'percent' ? Math.round(e.amount * 100) + '%' : e.amount} ${e.scope}/${e.duration}]`;
    case 'redeploy': return `redeploy[${e.target}${e.free ? ' free' : ''}]`;
    case 'repair': return `repair[${e.target} ${e.mode}${e.amount != null ? ' ' + e.amount : ''}]`;
    case 'tag': return `tag[${e.tag}/${e.duration}]`;
    case 'shopDiscount': return `shop-${e.amount}[${e.scope}]`;
    case 'randomEnchant': return `randomEnchant[${e.poolId}/${e.targetRule}]`;
    default: return e.kind;
  }
}

function renderEventsMarkdown(doc) {
  const lines = [];
  lines.push('# 进击事件表');
  lines.push('');
  lines.push(`由 \`data/assault-design/events.json\` 确定性生成，勿手改。schema: \`assault-events-design/v1\`；本表当前条目数：${doc.events.length}。`);
  lines.push('');
  for (const ev of doc.events) {
    lines.push(`## ${ev.id} · ${ev.name}`);
    lines.push('');
    lines.push(`- topic: \`${ev.topicId}\`  unlockDay: ${ev.unlockDay}  repeatable: ${ev.repeatable}`);
    lines.push(`- source: \`${ev.sourceRef.file ?? `${ev.sourceRef.database}#${ev.sourceRef.table}/${ev.sourceRef.rowId}`}#${ev.sourceRef.pointer}\``);
    lines.push(`- background: \`${ev.backgroundId}\``);
    lines.push('');
    lines.push('| choice | label | costs | outcomes | targeting |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const c of ev.choices) {
      const costs = c.costs.length ? c.costs.map((x) => `${x.currency}${x.amount}`).join(' + ') : 'free';
      const outs = c.outcomes.map((o) => `${(o.probability * 100).toFixed(0)}%:${o.effects.length ? o.effects.map(effectBrief).join(', ') : 'leave'}`).join('; ');
      lines.push(`| \`${c.id}\` | ${c.label} | ${costs} | ${outs} | ${c.targeting.mode} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------
// main

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('usage: node tools/assault/check-route-design.mjs [--events] [--encounters] [--all] [--partial] [--print-events-md]');
    process.exit(0);
  }
  if (args.includes('--print-events-md')) {
    const doc = readJson(EVENTS_PATH);
    process.stdout.write(renderEventsMarkdown(doc) + '\n');
    process.exit(0);
  }
  if (args.includes('--check-events-md')) {
    const doc = readJson(EVENTS_PATH);
    const want = renderEventsMarkdown(doc) + '\n';
    const got = fs.existsSync(EVENTS_MD_PATH) ? fs.readFileSync(EVENTS_MD_PATH, 'utf8') : null;
    if (got !== want) {
      console.log('FAIL docs/assault-mode/events.md differs from the deterministic render (run --print-events-md)');
      process.exit(1);
    }
    console.log('OK docs/assault-mode/events.md matches the deterministic render');
    process.exit(0);
  }
  const partial = args.includes('--partial');
  const flag = (n) => args.includes(n);
  let wantEvents = flag('--events') || flag('--all');
  let wantEncounters = flag('--encounters') || flag('--all');
  if (!wantEvents && !wantEncounters) { wantEvents = true; wantEncounters = true; }

  const errors = [];
  const summary = { events: 0, eventTopics: {}, encounters: 0 };
  __summary = summary;

  if (wantEvents) validateEventsFile(EVENTS_PATH, partial, errors, summary);
  if (wantEncounters) validateEncountersFile(partial, errors, summary);

  for (const e of errors) console.log(`FAIL ${e}`);
  if (errors.length === 0) {
    const topicStr = Object.entries(summary.eventTopics).map(([t, n]) => `${t}:${n}`).join(' ');
    console.log(`OK check-route-design: events=${summary.events}${topicStr ? ` [${topicStr}]` : ''} encounters=${summary.encounters}${partial ? ' (partial)' : ''}`);
    process.exit(0);
  }
  console.log(`FAILED check-route-design: ${errors.length} problem(s); events=${summary.events} encounters=${summary.encounters}${partial ? ' (partial)' : ''}`);
  process.exit(1);
}

main();
