import {bodyKeys} from '../../server/sim/body.js';
import {summonTemplateOptions} from '../../public/js/assault/model.js';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isLineMember,lineFor,chooseLineupV3,buyOperatorV3,chooseUpgradeV3,moduleForLine,placementBonus,manualSummonScore,ownThemeShopScore} from './line-builder.mjs';
import {installCampaignEvidence} from './campaign-evidence.mjs';
import {RUN_CARD_GROWTH,runGrowthPoints} from '../../shared/assault/growth-policy.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { createRun, applyAction, previewNodes, viewRun } from '../../shared/assault/run.js';
import { activePieceLimit, addBodyToInventory, assertInventory, piecePopulationCost } from '../../shared/assault/inventory.js';
import { eligibleEnchantmentDefinitions, operatorUpgradeProjection } from '../../shared/assault/upgrades.js';
import { createAssaultBattle } from '../../server/modes/assault/battle.js';
import { ownerRangeKeys, boardTileOf } from '../../server/match/board.js';
import { assaultNativeDirection, makeChessRecords } from '../../shared/assault/battle-input.js';
import { buildShopState } from '../../shared/assault/shops.js';
import { eventForNode } from '../../shared/assault/events.js';

const WT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ROOT=path.resolve(WT,'../../..');

const startedAt = new Date().toISOString();
const startedMs = Date.now();
const pid = process.pid;
let toolDeadlineMs=Infinity;
let currentPolicy='public-signatures-native-boss-geometry-and-unlocked-modules/v2';
const v3=()=>currentPolicy==='line-builder/v3';
const browserPlannerMode = process.argv.includes('--browser-planner') || process.argv.includes('--browser-planner-fixture-only');
const sourceCommit = execFileSync('git', ['-C', WT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const scopedStatus = execFileSync('git', ['-C', WT, 'status', '--short', '--', 'shared/assault', 'server/modes/assault', 'server/sim/content/assault', 'data/assault-design/system.json', 'tools/assault/campaign-probe.mjs'], { encoding: 'utf8' }).trim();

export const ctx = createAssaultContext();
const normalInstall=ctx.install;
ctx.install=(battle,prepared)=>{installCampaignEvidence(battle,{detailed:process.env.ASSAULT_CAPTURE_DETAILS==='1'});normalInstall(battle,prepared);};
const nativeSettle=ctx.settleBattle;
const actualSettleBattle=(state,prepared)=>{const result=nativeSettle(state,prepared),evidence=evidenceById.get(prepared.battleId)??null;evidenceById.delete(prepared.battleId);return {...result,battleEvidence:evidence};};
const evidenceById=new Map();
const evidenceInstall=ctx.install;ctx.install=(battle,prepared)=>{evidenceInstall(battle,prepared);battle.on('battleEnd',()=>evidenceById.set(prepared.battleId,battle.campaignEvidence()));};
const settledBattles = new Map();
function compactSettledStats(stats) {
  const units = Array.isArray(stats?.units) ? stats.units : null;
  const leaks = Array.isArray(stats?.leaks) ? stats.leaks : null;
  return { killed: stats?.killed ?? null, total: stats?.total ?? null, leaked: stats?.leaked ?? null,
    damage: stats?.damage ?? null, bossDamage: stats?.damage ?? null,
    damageDealt: units ? units.reduce((sum, unit) => sum + Number(unit.dmg ?? 0), 0) : null,
    unitColumns: ['uid', 'defId', 'dmg', 'heal', 'taken', 'kills', 'attacks'], unitCount: units?.length ?? null,
    units: units?.slice(0, 22).map((unit) => [unit.uid ?? unit.id ?? null, unit.defId ?? null,
      unit.dmg ?? null, unit.heal ?? null, unit.taken ?? null, unit.kills ?? null, unit.attacks ?? null]) ?? null,
    leakColumns: ['enemyKey', 'lpr'], leaks: leaks?.map((leak) => [leak.enemyKey ?? null, leak.lpr ?? null]) ?? null,
    leakIdentityKnown: leaks ? leaks.every((leak) => typeof leak.enemyKey === 'string') : false,
    allyDeaths: null };
}
ctx.settleBattle = (state, prepared) => {
  const outcome = actualSettleBattle(state, prepared);
  settledBattles.set(outcome.battleId, {
    victory: outcome.victory === true,
    leakedLife: outcome.leakedLife ?? null,
    bossHpLeft: outcome.bossHpLeft ?? null,
    nativeErrorCount: outcome.diagnostics?.errorCount ?? null,
    stats: compactSettledStats(outcome.stats), ledger: structuredClone(outcome.ledger), evidence: outcome.battleEvidence??null,
    reason: outcome.reason ?? null, durationSec: outcome.durationSec ?? null,
    events: (outcome.events ?? []).slice(0, 8),
    permanentEffects: (outcome.permanentEffects ?? []).slice(0, 12),
  });
  return outcome;
};
const directorIds = ctx.design.system.directors.flatMap((entry) => [entry.id,entry.id,entry.id]);
const seeds = [20261026,20261027,20261028,20261026,20261027,20261028,20261026,20261027,20261028];
const campaigns = [];
const commandRows = [];
const reportByRun = new Map();
const plannedEvents = new Map();
const nativeProfileCache = new Map();
const routeSampleCache = new Map();
let captureBrowserAction = false;

function compactRunState(state) {
  const deployed = state.pieces.filter((piece) => piece.row !== null && piece.col !== null);
  return { day: state.day, hour: state.hour, phase: state.phase, revision: state.revision, life: state.life, gold: state.gold,
    bench: state.pieces.length - deployed.length, pieceCount: state.pieces.length,
    population: deployed.reduce((sum, piece) => sum + piecePopulationCost(piece, ctx), 0) };
}

function act(state, type, payload = {}) {
  if (captureBrowserAction) throw Object.assign(new Error('browser planner captured next visible action'), {
    code: 'BROWSER_PLANNER_CAPTURE', action: { type, ...payload },
  });
  const action = { type, ...payload, opId: `campaign:${state.runId}:${state.revision}:${type}`, expectedRevision: state.revision };
  const at = { day: state.day, hour: state.hour, phase: state.phase, shopId: state.shop?.id ?? null };
  const slot = state.shop?.slots?.find((entry) => entry.slotId === payload.slotId) ?? null;
  const applied = applyAction(state, action, ctx);
  const runReport = reportByRun.get(state.runId);
  if (runReport) runReport.lastState = compactRunState(applied.state);
  const recordedResult = type === 'confirmEvent' ? { eventId: applied.result.eventId, choiceId: applied.result.choiceId,
    advanced: applied.result.advanced, ended: applied.result.ended,
    outcome: applied.result.outcome ? { probability: applied.result.outcome.probability,
      effects: applied.result.outcome.effects.map((effect) => Object.fromEntries(Object.entries(effect)
        .filter(([key]) => ['kind', 'amount', 'stat', 'mode', 'scope', 'target', 'durationSec', 'lifecycle', 'poolId', 'targetRule'].includes(key)))) } : null }
    : applied.result;
  commandRows.push({ runId: state.runId, ...at, opId: action.opId, type, result: recordedResult });
  if (['buySkill', 'enchantPiece', 'buy'].includes(type)) {
    reportByRun.get(state.runId)?.purchases.push({ action: type, ...at, slot: slot ? { slotId: slot.slotId, skillId: slot.skillId ?? null, enchantmentId: slot.enchantmentId ?? null, purchaseCharId: slot.purchaseCharId ?? null, star: slot.star, price: slot.price } : null,
      uid: payload.uid ?? null, goldAfter: applied.state.gold, result: applied.result });
  }
  return applied.state;
}

function nativeProfileFor(piece, state, encounter) {
  const key = `${encounter?.id ?? ''}|${piece.charId}|${piece.star}|${JSON.stringify(piece.moduleChoices ?? {})}`;
  if (nativeProfileCache.has(key)) return nativeProfileCache.get(key);
  const probe = structuredClone(state);
  probe.phase = 'battlePrep';
  probe.currentNode = { kind: 'battle', encounterId: encounter.id };
  for (const item of probe.pieces) { item.row = null; item.col = null; item.dir ??= 'E'; }
  const candidate = probe.pieces.find((item) => item.uid === piece.uid);
  const spot = [...ctx.fieldFor(probe).normalizedDeployMap.keys()].map((k) => k.split(',').map(Number))
    .find(([row, col]) => ctx.canPlace(probe, candidate, row, col));
  if (!spot) { nativeProfileCache.set(key, null); return null; }
  [candidate.row, candidate.col] = spot;
  candidate.dir = 'E';
  const battle = createAssaultBattle(ctx.prepareBattle(probe, encounter), ctx);
  battle.start();
  if (battle.errorCount) throw new Error(`native profile preview error ${battle.errorCount} for ${piece.charId}`);
  const unit = battle.allyUnits.find((entry) => entry.uid === piece.uid);
  const p = unit?.profile;
  const profile = p ? { canHitFly: p.canHitFly === true, groundOnly: p.groundOnly === true, noAttack: p.noAttack === true,
    attack: p.attack, dmgType: p.dmgType } : null;
  nativeProfileCache.set(key, profile);
  return profile;
}

const canHitAir = (profile) => Boolean(profile?.canHitFly && !profile.groundOnly && !profile.noAttack
  && profile.attack !== 'none' && ['phys', 'arts', 'true'].includes(profile.dmgType));
const isHealer = (piece) => {
  const body = ctx.runtime.bodies[piece.charId];
  return body?.profession === 'MEDIC' || ['guardian','bard'].includes(body?.subProfessionId) || (body?.fixedSkill?.effects ?? []).some((effect) => effect.action === 'heal' && /(友方|友军)/.test(String(effect.target ?? '')));
};
const isBlocker = (piece) => {
  const body = ctx.runtime.bodies[piece.charId];
  return body?.position === 'MELEE' && Number(body.baseStats?.blockCnt ?? 0) > 0;
};
function roleSet(piece, state, encounter) {
  const body = ctx.runtime.bodies[piece.charId];
  const profile = nativeProfileFor(piece, state, encounter);
  return { healer: isHealer(piece), blocker: isBlocker(piece), tank: body?.profession === 'TANK',
    ranged: body?.position === 'RANGED', antiAir: canHitAir(profile), arts: profile?.dmgType === 'arts',
    attack: Boolean(profile && !profile.noAttack && profile.dmgType !== 'heal'), profile };
}

function clampToRect(point, rect) {
  if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(Number.isFinite)) return null;
  return [Math.max(rect.r0, Math.min(rect.r1, Math.round(point[0]))),
    Math.max(rect.c0, Math.min(rect.c1, Math.round(point[1])))];
}

function straightTiles(start, end) {
  const distance = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]));
  return Array.from({ length: distance + 1 }, (_, index) => {
    const ratio = distance ? index / distance : 0;
    return [Math.round(start[0] + (end[0] - start[0]) * ratio), Math.round(start[1] + (end[1] - start[1]) * ratio)];
  });
}

function routeSamplesFor(source, encounter) {
  const stageId = encounter.stageId;
  const probe = structuredClone(source);
  probe.phase = 'battlePrep';
  probe.currentNode = { kind: 'battle', encounterId: encounter.id };
  const native = createAssaultBattle(ctx.prepareBattle(probe, encounter), ctx);
  native.start();
  if (native.errorCount !== 0) throw new Error(`native route preview error ${native.errorCount} for ${encounter.id}`);
  const grid = native.grid;
  const obstacles = Array.from(grid.obstacle ?? []);
  const gridKey = `${v3()?'line-builder/v3|':''}${encounter.id}|${native.stageId ?? stageId}|${grid.version ?? 0}|${obstacles.join(',')}`;
  const cached = routeSampleCache.get(gridKey);
  if (cached) return cached;
  // The actual battle maps source route indices onto this field's routes.
  // Inspect that built schedule; raw encounter indices can exceed its length.
  const plannedSpawns=v3()?native.opts.spawns.map(spawn=>({...spawn,key:spawn.enemyKey})):encounter.wave.spawns;
  const spawnByRoute = new Map();
  const inspectedSpawns = new Set();
  for (const spawn of plannedSpawns ?? []) {
    const routeIndex = spawn.routeIndex ?? 0;
    const spawnKey = `${routeIndex}|${spawn.key}`;
    if (inspectedSpawns.has(spawnKey)) continue;
    inspectedSpawns.add(spawnKey);
    const enemy = native.spawnEnemy(spawn.key, { routeIndex });
    if (!enemy) throw new Error(`native spawn inspection failed for ${spawn.key} route=${routeIndex}`);
    const entry = { key: spawn.key, routeIndex, bossTiles:(v3()?spawn.tag==='boss':spawn.key===encounter.wave.bossId)?bodyKeys(enemy):[], motion: enemy.motion ?? null,
      unblockable: enemy.s?.flags?.unblockable === true, profile: enemy.profile ? { ...enemy.profile } : null };
    if (!spawnByRoute.has(routeIndex)) spawnByRoute.set(routeIndex, []);
    spawnByRoute.get(routeIndex).push(entry);
  }
  if (native.errorCount !== 0) throw new Error(`native spawn inspection error ${native.errorCount} for ${encounter.id}`);
  const field = ctx.fieldFor(source).field;
  const samples = [];
  if(encounter.kind==='final')for(const entries of spawnByRoute.values())for(const entry of entries)for(const key of entry.bossTiles){
    const[row,col]=boardTileOf(field,Math.floor(key/21),key%21);samples.push({row,col,flight:false,unblockable:true,pressure:100,routeIndex:entry.routeIndex,boss:true});
  }
  const walkSegments = [];
  const routeThreats = [];
  for (let routeIndex = 0; routeIndex < (native.routes ?? []).length; routeIndex += 1) {
    const route = native.routes[routeIndex];
    const spawns = (plannedSpawns ?? []).filter((spawn) => (spawn.routeIndex ?? 0) === routeIndex);
    if(v3()&&!spawns.length)continue;
    const nativeSpawns = spawnByRoute.get(routeIndex) ?? [];
    const pressure = Math.max(1, spawns.reduce((sum, spawn) => sum + (spawn.count ?? 1)
      * Number(ctx.nativeData.enemies[spawn.key]?.stats?.lpr ?? 1), 0));
    const flight = route.motion === 'FLY' || nativeSpawns.some((spawn) => spawn.motion === 'FLY');
    const unblockable = nativeSpawns.some((spawn) => spawn.unblockable);
    routeThreats.push({ routeIndex, flight, unblockable, enemies: nativeSpawns,
      ...(v3()?{spawnCount:spawns.reduce((n,spawn)=>n+(spawn.count??1),0)}:null) });
    let prior = clampToRect(route.start, native.rect);
    if (!prior) throw new Error(`route ${routeIndex} has no usable start ${encounter.id}`);
    const append = (tiles) => {
      for (const tile of tiles) {
        const point = clampToRect(tile, native.rect);
        if (!point) throw new Error(`route ${routeIndex} contains invalid tile ${encounter.id}`);
        if (!flight && !grid.walkable(point[0], point[1]))
          throw new Error(`native walk path crossed non-walkable tile ${encounter.id} route=${routeIndex} tile=${point}`);
        const [row, col] = boardTileOf(field, point[0], point[1]);
        samples.push({ row, col, flight, unblockable, pressure, routeIndex });
      }
    };
    append([prior]);
    const checkpoints = (route.checkpoints ?? []).map((checkpoint) => Array.isArray(checkpoint)
      ? { type: 'MOVE', pos: checkpoint } : checkpoint)
      .filter((checkpoint) => ['MOVE', 'APPEAR'].includes(String(checkpoint?.type ?? '').toUpperCase()));
    const goals = [...checkpoints, { type: 'MOVE', pos: route.end }];
    for (const checkpoint of goals) {
      const type = String(checkpoint.type ?? 'MOVE').toUpperCase();
      const target = clampToRect(checkpoint.pos, native.rect);
      if (!target) throw new Error(`route ${routeIndex} has invalid ${type} checkpoint ${encounter.id}`);
      if (type === 'APPEAR') {
        append([target]);
        prior = target;
        continue;
      }
      let segment;
      if (flight) segment = straightTiles(prior, target);
      else {
        segment = grid.findPath(prior[0], prior[1], target[0], target[1]);
        if (!segment) throw new Error(`native grid has no WALK path ${encounter.id} route=${routeIndex} from=${prior} to=${target}`);
        walkSegments.push({ routeIndex, from: prior, to: target, tiles: segment.map((tile) => [...tile]) });
      }
      append(segment);
      prior = target;
    }
  }
  if(v3())for(const route of routeThreats){
    const points=samples.filter(p=>p.routeIndex===route.routeIndex&&!p.boss);
    for(let index=0;index<points.length;index++){
      const progress=points.length>1?index/(points.length-1):0;
      points[index].pressure*=4-3*progress;
      points[index].routeProgress=progress;
    }
  }
  const value = { samples, walkSegments, routeThreats, gridKey, grid };
  routeSampleCache.set(gridKey, value);
  return value;
}

function chooseNode(state) {
  const nodes = previewNodes(state);
  const report = reportByRun.get(state.runId);
  const select=(node,reason)=>{
    if(report){report.nodeObservations??=[];report.nodeObservations.push({day:state.day,hour:state.hour,
      directorId:state.directorId,policy:currentPolicy,selectedId:node.id,selectedShopId:node.shopId??null,reason,
      candidates:nodes.map(candidate=>({id:candidate.id,kind:candidate.kind,shopId:candidate.shopId??null,
        ownTheme:ownThemeShopScore(state,candidate,ctx)>0,priorityScore:v3()?ownThemeShopScore(state,candidate,ctx):0}))});}
    return node;
  };
  const ownTheme=v3()?nodes.find(node=>ownThemeShopScore(state,node,ctx)>0):null;
  if(ownTheme)return select(ownTheme,'own-theme-priority-100');
  const firstStrategyBought = report?.purchases.some((entry) => entry.action === 'buySkill') ?? false;
  const firstEnchantBought = report?.purchases.some((entry) => entry.action === 'enchantPiece') ?? false;
  const fixed = state.day === 1 && state.hour === 2 && !firstStrategyBought ? 'shop_strategy'
    : state.hour === 4 && state.day >= 2 && !firstEnchantBought ? 'shop_enchant' : null;
  if (fixed) {
    const target = nodes.find((node) => node.kind === 'shop' && node.shopId === fixed);
    if (target) return select(target,'first-strategy-or-enchantment');
  }
  const visibleShop = nodes.find((node) => node.kind === 'shop');
  const events = nodes.filter((node) => node.kind === 'event').map((node) => {
    const opened = previewAction(state, 'selectNode', { nodeId: node.id }).state;
    const evaluation = evaluateEvent(opened);
    const observation = { day: state.day, hour: state.hour, eventId: node.eventId,
      choiceId: evaluation.best?.choice.id ?? null, cost: evaluation.best?.choice.costs ?? [],
      status: 'not-selected', notEvaluated: evaluation.notEvaluated, outcome: null };
    report?.eventObservations?.push(observation);
    return { node, evaluation, observation };
  }).filter((entry) => entry.evaluation.best);
  events.sort((a, b) => b.evaluation.best.value - a.evaluation.best.value || a.node.id.localeCompare(b.node.id));
  if (events[0] && (events[0].evaluation.best.freeEnchantment || !visibleShop || !shopHasLegalPurchase(state, visibleShop))) {
    const selected = events[0];
    selected.observation.status = 'selected';
    plannedEvents.set(state.runId, { eventId: selected.node.eventId, choiceId: selected.evaluation.best.choice.id,
      observation: selected.observation });
    return select(selected.node,selected.evaluation.best.freeEnchantment?'free-enchantment-event':!visibleShop?'no-visible-shop':'no-legal-shop-purchase');
  }
  if (visibleShop) return select(visibleShop,'visible-shop');
  const battleNodes = nodes.filter((node) => node.kind === 'battle');
  if (battleNodes.length) return select(battleNodes.find((node) => node.battleKind === 'normal') ?? battleNodes[0],'mandatory-battle');
  const event = nodes.find((node) => node.kind === 'event');
  if (event) return select(event,'event-fallback');
  throw new Error(`no actionable visible node at day ${state.day} hour ${state.hour}`);
}

function previewAction(state, type, payload = {}) {
  return applyAction(structuredClone(state), { type, ...payload,
    opId: `acquisition-preview:${state.revision}:${type}:${payload.nodeId ?? payload.choiceId ?? payload.slotId ?? ''}`,
    expectedRevision: state.revision }, ctx);
}

function shopHasLegalPurchase(state, node) {
  const opened = previewAction(state, 'selectNode', { nodeId: node.id }).state;
  const bought = opened.shop.kind === 'skill' || opened.shop.kind === 'enchantment'
    ? buyUpgrade(opened, true) : buyOperator(opened, true);
  // Never finish the preview shop: next-day income is not a purchase benefit.
  return bought !== opened || buyOperator(opened,true)!==opened;
}

function eventOutcomeSummary(state, applied) {
  const effects = applied.result.outcome?.effects ?? [];
  const amount = (kind) => effects.filter((effect) => effect.kind === kind).reduce((sum, effect) => sum + Number(effect.amount ?? 0), 0);
  const enchantments = applied.state.history.slice(state.history.length).filter((entry) => entry.kind === 'eventEnchantment')
    .map(({ targetUid, oldEnchantmentId, newEnchantmentId }) => ({ targetUid, oldEnchantmentId, newEnchantmentId }));
  return { gold: amount('gold'), hp: Math.min(state.maxLife, Math.max(0, state.life + amount('hp'))) - state.life,
    xp: amount('xp'), enchantments, growth: effects.filter((effect) => ['enhance', 'repair'].includes(effect.kind))
      .map(({ kind, stat, amount, mode, scope, target, lifecycle }) => ({ kind, stat, amount, mode, scope, target, lifecycle })) };
}

function evaluateEvent(state, eventViewOverride = null) {
  const candidates = [], notEvaluated = [];
  const eventView = eventViewOverride ?? viewRun(state, ctx);
  for (const choice of eventView.choices) {
    const effects = choice.outcomes.flatMap((outcome) => outcome.effects);
    const targetRequired = (choice.targeting?.mode ?? 'none') !== 'none'
      || effects.some((effect) => ['tag', 'redeploy'].includes(effect.kind)
        || (effect.kind === 'recruit' && effect.selection !== 'random'));
    const hasUnavailableEnchant = effects.some((effect) => effect.kind === 'randomEnchant')
      && (!choice.enchantmentOffer || !Array.isArray(choice.enchantmentOffer.options)
        || !choice.enchantmentOffer.options.some((option) => Number.isFinite(option.weight) && option.weight > 0));
    const reason = !choice.enabled ? choice.disabledReason ?? 'disabled' : targetRequired ? 'target-dependent'
      : hasUnavailableEnchant ? 'no-public-enchantment-offer'
      : choice.costs.some((cost) => cost.amount > 0) ? 'paid-not-evaluated'
        : effects.some((effect) => !['gold', 'hp', 'xp', 'randomEnchant', 'enhance', 'repair'].includes(effect.kind)) ? 'unsupported-benefit' : null;
    if (reason) { notEvaluated.push({ choiceId: choice.id, reason }); continue; }
    const rawOdds = choice.enchantmentOffer?.options
      ?.filter((option) => typeof option.enchantmentId === 'string' && Number.isFinite(option.weight) && option.weight > 0)
      .map((option) => ({ enchantmentId: option.enchantmentId, weight: option.weight })) ?? [];
    const totalWeight = rawOdds.reduce((sum, option) => sum + option.weight, 0);
    const enchantmentOdds = totalWeight > 0
      ? rawOdds.map(({ enchantmentId, weight }) => ({ enchantmentId, probability: weight / totalWeight })) : [];
    let expectedGold = 0, expectedXp = 0, expectedHp = 0, expectedEnchantments = 0, expectedGrowth = 0;
    let unsupported = false;
    const probabilityTotal = choice.outcomes.reduce((sum, outcome) => sum + Math.max(0, Number(outcome.probability ?? 1)), 0);
    if (!(probabilityTotal > 0)) { notEvaluated.push({ choiceId: choice.id, reason: 'invalid-public-outcome-probability' }); continue; }
    for (const outcome of choice.outcomes) {
      const probability = Math.max(0, Number(outcome.probability ?? 1)) / probabilityTotal;
      let outcomeGold = 0, outcomeXp = 0, outcomeHp = 0;
      for (const effect of outcome.effects) {
        const amount = Number(effect.amount ?? 0);
        if (['gold', 'xp', 'hp', 'enhance', 'repair'].includes(effect.kind) && !Number.isFinite(amount)) { unsupported = true; break; }
        if (effect.kind === 'gold') outcomeGold += amount;
        else if (effect.kind === 'xp') outcomeXp += amount;
        else if (effect.kind === 'hp') outcomeHp += amount;
        else if (effect.kind === 'randomEnchant') expectedEnchantments += probability * 1000;
        else if (effect.kind === 'enhance' || effect.kind === 'repair') expectedGrowth += probability * Math.max(0, amount);
      }
      if (unsupported) break;
      expectedGold += probability * outcomeGold;
      expectedXp += probability * outcomeXp;
      expectedHp += probability * (Math.min(eventView.maxLife, Math.max(0, eventView.life + outcomeHp)) - eventView.life);
    }
    if (unsupported) { notEvaluated.push({ choiceId: choice.id, reason: 'unsupported-public-value' }); continue; }
    const value = Math.max(0, expectedEnchantments) + Math.max(0, expectedHp) * 100
      + Math.max(0, expectedGold) * 10 + Math.max(0, expectedXp) + expectedGrowth;
    if (value > 0 && expectedGold >= 0 && expectedHp >= 0 && expectedXp >= 0) candidates.push({ choice, value,
      freeEnchantment: expectedEnchantments > 0 && !choice.enchantmentOffer?.currentEnchantmentId,
      expectedEnchantmentValue: expectedEnchantments, enchantmentOdds });
  }
  candidates.sort((a, b) => b.value - a.value || a.choice.id.localeCompare(b.choice.id));
  return { best: candidates[0] ?? null, notEvaluated };
}

function playEvent(state) {
  const eventId = state.currentEvent.id;
  const planned = plannedEvents.get(state.runId);
  const evaluation = planned?.eventId === eventId ? null : evaluateEvent(state);
  const choiceId = planned?.eventId === eventId ? planned.choiceId : evaluation.best?.choice.id;
  const observation = planned?.eventId === eventId ? planned.observation : { day: state.day, hour: state.hour,
    eventId, choiceId: choiceId ?? null, status: 'selected', notEvaluated: evaluation.notEvaluated, outcome: null };
  if (!planned || planned.eventId !== eventId) reportByRun.get(state.runId)?.eventObservations?.push(observation);
  plannedEvents.delete(state.runId);
  if (!choiceId) { observation.status = 'left-no-known-benefit'; observation.cost = []; return act(state, 'leaveEvent'); }
  const choice = viewRun(state, ctx).choices.find((entry) => entry.id === choiceId);
  observation.cost = choice.costs;
  const next = act(state, 'confirmEvent', { choiceId });
  const result = commandRows.at(-1).result;
  observation.outcome = eventOutcomeSummary(state, { state: next, result });
  observation.targetUid = observation.outcome.enchantments[0]?.targetUid ?? null;
  observation.status = 'confirmed';
  return next;
}

function buyUpgrade(state, previewOnly = false) {
  const record = (decision) => { if (!previewOnly) recordBuyerDecision(state, decision); };
  const perform = (type, payload) => previewOnly ? previewAction(state, type, payload).state : act(state, type, payload);
  if (state.shop.kind === 'skill') {
    const preferred = ['strategy_catalytic', 'strategy_arms', 'strategy_merchant', 'strategy_backroom', 'strategy_supply'];
    const reserve = Object.values(state.skillRanks ?? {}).some((rank) => rank > 0)
      || (!state.pieces.some((piece) => piece.enchantmentId) && state.day >= 2 && state.hour < 4) ? 8 : 0;
    const affordable = state.shop.slots.filter((slot) => slot.skillId && slot.price <= state.gold && state.gold - slot.price >= reserve);
    affordable.sort((a, b) => (preferred.indexOf(a.skillId) < 0 ? 99 : preferred.indexOf(a.skillId))
      - (preferred.indexOf(b.skillId) < 0 ? 99 : preferred.indexOf(b.skillId)) || a.price - b.price);
    if (affordable[0]) {
      record({ slotId: affordable[0].slotId, reason: 'strategy-purchase-with-reserve', reserve });
      state = perform('buySkill', { slotId: affordable[0].slotId });
    } else record({ reason: 'no-strategy-with-required-reserve', reserve });
  } else if (state.shop.kind === 'enchantment' && !state.pieces.some((piece) => piece.enchantmentId)
    && state.day >= 2 && state.hour === 4) {
    const candidates = state.shop.slots.filter((slot) => slot.enchantmentId && slot.price <= state.gold)
      .sort((a, b) => (a.enchantmentId === 'enchant_toxic' ? -1 : 0) - (b.enchantmentId === 'enchant_toxic' ? -1 : 0));
    for (const slot of candidates) {
      const piece = state.pieces.find((candidate) => eligibleEnchantmentDefinitions(candidate, ctx).some((entry) => entry.id === slot.enchantmentId));
      if (piece) {
        record({ slotId: slot.slotId, reason: 'first-enchantment-at-fixed-hour', targetUid: piece.uid });
        state = perform('enchantPiece', { slotId: slot.slotId, uid: piece.uid }); break;
      }
    }
  } else if (!v3() && !state.pieces.some((piece) => piece.enchantmentId) && state.day >= 2 && state.hour >= 4) {
    record({reason:'no-affordable-enchantment-offer'});
  }
  return state;
}

function recordBuyerDecision(state, decision) {
  const report = reportByRun.get(state.runId);
  const observation = report?.shopObservations?.at(-1);
  if (observation?.shopId === state.shop?.id && observation.day === state.day && observation.hour === state.hour)
    observation.decisions.push({ ...decision, gold: state.gold });
}

// Compare only native-legal lineups proposed by the existing selector;
// unselected bench additions contribute no projected value.

function signaturePower(piece,stats){
 const b=ctx.runtime.bodies[piece.charId],p=b.adaptation,v=p?.values??{};if(!p||p.type==='C')return 0;
 const hits=Math.max(1,v.hits??0,v.rounds??0,v.pulses??0,v.heals??0,v.waves??0),count=Math.min(3,Math.max(1,p.targetCount));
 const period=p.passive?Math.max(8,b.baseStats.respawnTime??70):p.tempo.cost;
 const cycles=p.type==='D'?Math.max(period,120/p.ammo):period;
 const scale=Math.min(8,v.scale??v.heal??1),atk=stats?.atk??b.starStats[piece.star-1].stats.atk;
 return p.roles.includes('direct')?atk*hits*scale*count/cycles:0;
}
function cardPower(piece,state,stats){
 const b=ctx.runtime.bodies[piece.charId],p=b.adaptation,v=p?.values??{};if(!p)return 0;
 const friends=state.pieces.filter(x=>x.uid!==piece.uid),rate=(stats?.atk??b.starStats[piece.star-1].stats.atk)/Math.max(.3,stats?.bat??b.baseStats.bat??1.5);
 let pairs=0;for(const friend of friends){const other=ctx.runtime.bodies[friend.charId].adaptation;
  pairs+=(p.consumes??[]).filter(f=>(other.produces??[]).includes(f)).length;
  pairs+=(p.produces??[]).filter(f=>(other.consumes??[]).includes(f)).length;
 }
 const stateDamage=p.type==='C'&&p.roles.includes('direct')?rate*Math.max(0,Math.min(3,v.atk??0)):0;
 const supportedSP=piece.charId==='char_4072_ironmn'?v.field*(v.deviceCharge/v.interval+v.charge/p.tempo.cost):0;
 const bestSP=Math.max(0,...friends.map(x=>signaturePower(x)));
 return signaturePower(piece,stats)*.6+stateDamage+rate*.08*Math.min(5,pairs)+supportedSP*bestSP*.08;
}

function buyerLineupValue(state, encounter) {
  let best = null;
  for (let variant = 0; variant < 4; variant += 1) {
    const selected = chooseLineup(state, encounter, variant).lineup;
    const deploymentPreview = structuredClone(state);
    deploymentPreview.phase = 'battlePrep';
    deploymentPreview.currentNode = { kind: 'battle', encounterId: encounter.id };
    try { candidatePlacements(deploymentPreview, encounter, selected, variant); }
    catch (error) { if (isLayoutRejection(error)) continue; throw error; }
    const nativeRecords = makeChessRecords(ctx.runtime, selected,
      (state.nextBattleEffects ?? []).filter((effect) => effect.kind === 'enhance'), state.teamGrowth ?? {}).chess;
    const covered = { healer: false, antiAir: false, blocker: false };
    let dps = 0, healing = 0;
    for (const piece of selected) {
      const roles = roleSet(piece, state, encounter);
      const stats = nativeRecords[`assault:${piece.uid}`].stats;
      const rate = Number(stats.atk) / Math.max(0.3, Number(stats.bat)) * Number(stats.aspd ?? 100) / 100;
      if (roles.attack) dps += rate;
      if (roles.healer) healing += rate;
      for (const key of Object.keys(covered)) covered[key] ||= roles[key];
    }
    const value = dps + healing + selected.reduce((sum,piece)=>sum+cardPower(piece,state,nativeRecords[`assault:${piece.uid}`].stats),0);
    if (!best || value > best.value) best = { value, dps, healing, covered, selected: selected.map((piece) => piece.uid) };
  }
  return best ?? { value: 0, dps: 0, healing: 0, covered: { healer: false, antiAir: false, blocker: false }, selected: [] };
}

function buyerEncounterFor(state) {
  const encounterId = state.currentNode?.kind === 'battle' ? state.currentNode.encounterId : state.prepEncounterId;
  const encounter = encounterId ? ctx.design.encounters.encounters.find((entry) => entry.id === encounterId)
    : ctx.design.encounters.encounters.find((entry) => entry.kind === 'normal');
  if (!encounter) throw new Error(`buyer has no actual preparation encounter: ${encounterId ?? 'initial fallback'}`);
  return encounter;
}

function buyOperator(state, previewOnly = false) {
  if(v3())return buyOperatorV3(state,previewOnly,{ctx,act,previewAction,reportByRun,recordBuyerDecision});
  if (state.shop.kind && state.shop.kind !== 'operator' && !state.shop.slots.some(slot=>slot.purchaseCharId)) return state;
  const record = (decision) => { if (!previewOnly) recordBuyerDecision(state, decision); };
  const encounter = buyerEncounterFor(state);
  const flightThreat = (encounter?.wave?.routes ?? []).some((route) => route.motion === 'FLY')
    || (encounter?.wave?.spawns ?? []).some((spawn) => ctx.nativeData.enemies[spawn.key]?.stats?.motion === 'FLY');
  const reserve = state.day === 1 && state.hour === 1 ? 5
    : !state.pieces.some((piece) => piece.enchantmentId) && state.day >= 2 && state.hour < 4 ? 8 : 0;
  const candidates = [];
  let before = null;
  const director = ctx.design.system.directors.find((entry) => entry.id === reportByRun.get(state.runId)?.directorId);
  for (const slot of state.shop.slots) {
    if(!slot.purchaseCharId)continue;
    const owned = state.pieces.filter((piece) => piece.purchaseCharId === slot.purchaseCharId).reduce((sum, piece) => sum + piece.sourceCopies, 0);
    if (slot.price > state.gold - reserve || owned + slot.requiredCopies > ctx.design.system.run.sourceCapPerBody) {
      record({ slotId: slot.slotId, reason: slot.price > state.gold - reserve ? 'gold-reserve' : 'source-cap', reserve });
      continue;
    }
    let preview;
    try { preview = applyAction(structuredClone(state), { type: 'buy', slotId: slot.slotId, opId: `role-eval:${slot.slotId}:${state.revision}`, expectedRevision: state.revision }, ctx).state; }
    catch (error) {
      if (['BENCH_FULL', 'POPULATION_FULL', 'SOURCE_CAP'].includes(error.code)) {
        record({ slotId: slot.slotId, reason: 'native-rejection', code: error.code }); continue;
      }
      throw error;
    }
    before ??= buyerLineupValue(state, encounter);
    const after = buyerLineupValue(preview, encounter);
    const upgrades = state.pieces.filter((piece) => piece.purchaseCharId === slot.purchaseCharId
      && (piece.purchaseCharId === director?.leaderCharId || (piece.row !== null && piece.col !== null)))
      .flatMap((piece) => { const next = preview.pieces.find((entry) => entry.uid === piece.uid);
        return next && next.star > piece.star ? [{ uid: piece.uid, from: piece.star, to: next.star }] : []; });
    const roleGain = (!before.covered.healer && after.covered.healer ? 4 : 0)
      + (flightThreat && !before.covered.antiAir && after.covered.antiAir ? 2 : 0)
      + (!before.covered.blocker && after.covered.blocker ? 1 : 0);
    const gain = after.value - before.value;
    if (!upgrades.length && !roleGain && gain <= 0.000001) {
      record({ slotId: slot.slotId, reason: 'no-lineup-gain', gain }); continue;
    }
    candidates.push({ slot, upgrades, roleGain, gain, beforeDps: before.dps, afterDps: after.dps,
      priority: upgrades.length ? 3 : roleGain ? 2 : 1, score: gain / Math.max(1, slot.price) });
  }
  candidates.sort((a, b) => b.priority - a.priority || b.roleGain - a.roleGain || b.score - a.score || a.slot.price - b.slot.price);
  if (candidates[0]) {
    const chosen = candidates[0];
    record({ slotId: chosen.slot.slotId, reason: chosen.upgrades.length ? 'held-star-upgrade'
      : chosen.roleGain ? 'missing-lineup-role' : 'positive-lineup-gain', upgrades: chosen.upgrades,
      gain: chosen.gain, beforeDps: chosen.beforeDps, afterDps: chosen.afterDps, reserve });
    return previewOnly ? previewAction(state, 'buy', { slotId: chosen.slot.slotId }).state : act(state, 'buy', { slotId: chosen.slot.slotId });
  }
  return state;
}

function playShop(state) {
  reportByRun.get(state.runId)?.shopObservations?.push({ day: state.day, hour: state.hour, shopId: state.shop.id,
    kind: state.shop.kind ?? 'operator', gold: state.gold, slots: state.shop.slots.map((slot) => ({ slotId: slot.slotId,
      purchaseCharId: slot.purchaseCharId ?? null, skillId: slot.skillId ?? null, enchantmentId: slot.enchantmentId ?? null,
      star: slot.star, price: slot.price })), decisions: [] });
  if (state.shop.kind === 'skill' || state.shop.kind === 'enchantment') state = buyUpgrade(state);
  {
    while (state.shop.slots.length) {
      const next = buyOperator(state);
      if (next === state) break;
      state = next;
    }
  }
  state = act(state, 'finishShop');
  return state;
}

function chooseOperatorUpgrade(state) {
  if(v3())return chooseUpgradeV3(state,{ctx,act,viewRun,reportByRun});
  const reward = viewRun(state, ctx).upgradeRewards;
  const choices = reward?.choices ?? [];
  if (!choices.length) return act(state, 'skipUpgradeReward');
  const encounter = buyerEncounterFor(state), before = buyerLineupValue(state, encounter);
  const director = ctx.design.system.directors.find((entry) => entry.id === reportByRun.get(state.runId)?.directorId);
  const candidates = choices.map((uid) => {
    const piece = state.pieces.find((entry) => entry.uid === uid);
    const projected = operatorUpgradeProjection(piece, ctx, reward.maxStar);
    const preview = applyAction(structuredClone(state), { type: 'chooseUpgrade', uid,
      opId: `upgrade-eval:${state.revision}:${uid}`, expectedRevision: state.revision }, ctx).state;
    const upgraded = preview.pieces.find((entry) => entry.uid === uid);
    if (upgraded?.star !== projected.star) throw new Error(`native upgrade differs from shared projection: ${uid}`);
    const after = buyerLineupValue(preview, encounter);
    return { uid, fromStar: piece.star, star: upgraded.star, gain: after.value - before.value,
      priority: piece.purchaseCharId === director?.leaderCharId ? 2 : piece.row !== null && piece.col !== null ? 1 : 0 };
  });
  candidates.sort((a, b) => b.gain - a.gain || b.priority - a.priority || a.uid.localeCompare(b.uid));
  reportByRun.get(state.runId)?.upgradeObservations?.push({ day: state.day, hour: state.hour, rewardId: reward.id,
    maxStar: reward.maxStar, candidates, chosenUid: candidates[0].uid });
  return act(state, 'chooseUpgrade', { uid: candidates[0].uid });
}

function transition(state, type, payload = {}, tag = 'preview') {
  const action = { type, ...payload, opId: `${tag}:${state.revision}:${type}:${payload.uid ?? ''}`, expectedRevision: state.revision };
  return applyAction(state, action, ctx).state;
}

function chooseLineup(state, encounter, variant) {
  if(v3())return chooseLineupV3(state,encounter,{ctx,roleSet,routeSamplesFor,reportByRun});
  const wave = encounter.wave;
  const unblockableThreat = routeSamplesFor(state, encounter).routeThreats.some((route) => route.unblockable);
  const dpLimit = Number(wave.dp?.init ?? 50) + Number(wave.dp?.perSec ?? 1) * 120;
  const popLimit = activePieceLimit(state, ctx);
  const director = ctx.design.system.directors.find((entry) => entry.id === reportByRun.get(state.runId)?.directorId);
  const leader = state.pieces.find((piece) => piece.purchaseCharId === director?.leaderCharId || piece.charId === director?.leaderCharId);
  const flightThreat = (wave.routes ?? []).some((route) => route.motion === 'FLY')
    || wave.spawns.some((spawn) => ctx.nativeData.enemies[spawn.key]?.stats?.motion === 'FLY');
  const candidates = state.pieces.map((piece) => ({ piece, role: roleSet(piece, state, encounter), body: ctx.runtime.bodies[piece.charId] }));
  const lineup = [];
  let dp = 0; let pop = 0;
  const add = (entry) => { lineup.push(entry); dp += Number(entry.body.baseStats.cost); pop += piecePopulationCost(entry.piece, ctx); };
  const leaderEntry = candidates.find((entry) => entry.piece.uid === leader?.uid);
  if (leaderEntry && Number(leaderEntry.body.baseStats.cost) <= dpLimit && piecePopulationCost(leaderEntry.piece, ctx) <= popLimit) add(leaderEntry);
  const covered = { healer: lineup.some((x) => x.role.healer), blocker: lineup.some((x) => x.role.blocker), antiAir: lineup.some((x) => x.role.antiAir), tank: lineup.some((x) => x.role.tank), unblockableAttack: lineup.some((x) => x.role.attack) };
  while (lineup.length < popLimit) {
    const available = candidates.filter((entry) => !lineup.some((chosen) => chosen.piece.uid === entry.piece.uid)
      && dp + Number(entry.body.baseStats.cost ?? Infinity) <= dpLimit
      && pop + piecePopulationCost(entry.piece, ctx) <= popLimit);
    if (!available.length) break;
    available.sort((a, b) => {
      const value = (entry) => {
        const stats = entry.body.starStats[entry.piece.star - 1]?.stats ?? {};
        const dps = Number(stats.atk ?? 0) / Math.max(0.3, Number(stats.bat ?? entry.body.baseAttackTime ?? 1.5));
        return (dps+cardPower(entry.piece,state,stats)) / Math.max(1, Number(entry.body.baseStats.cost ?? 99))
          + (flightThreat && !covered.antiAir && entry.role.antiAir ? (variant === 2 ? 160 : 70) : 0)
          + (unblockableThreat && !covered.unblockableAttack && entry.role.attack ? (variant === 1 ? 220 : 0) : 0)
          + (!covered.healer && entry.role.healer ? (variant === 1 ? 130 : 65) : 0)
          + (!covered.blocker && entry.role.blocker ? (variant === 3 ? 100 : 45) : 0)
          + (!covered.tank && entry.role.tank ? 18 : 0);
      };
      return value(b) - value(a);
    });
    const chosen = available[0]; add(chosen);
    for (const role of Object.keys(covered)) if (role !== 'unblockableAttack') covered[role] ||= chosen.role[role];
    covered.unblockableAttack ||= chosen.role.attack;
  }
  return { lineup: lineup.map((entry) => entry.piece), flightThreat, unblockableThreat, dpLimit, popLimit };
}

function summarizeRouteCoverage(state, placements, samples) {
  const routes = new Map();
  for (const sample of samples) {
    if (!routes.has(sample.routeIndex)) routes.set(sample.routeIndex, { routeIndex: sample.routeIndex,
      flight: sample.flight, unblockable: sample.unblockable, pathTiles: new Set(), attackUnits: new Set(), blockerUnits: new Set(), attackTiles: new Set() });
    routes.get(sample.routeIndex).pathTiles.add(`${sample.row},${sample.col}`);
  }
  for (const placement of placements) {
    const piece = state.pieces.find((entry) => entry.uid === placement.uid);
    const body = ctx.runtime.bodies[piece?.charId];
    if (!piece || !body) continue;
    const range = ownerRangeKeys(body.range ?? body.simChess?.rangeGrid, placement.row, placement.col, assaultNativeDirection(placement.dir));
    for (const route of routes.values()) {
      const routeSamples = samples.filter((sample) => sample.routeIndex === route.routeIndex);
      if (placement.roles.attack) {
        const covered = routeSamples.filter((sample) => (!sample.flight || placement.roles.antiAir)
          && range.has(`${sample.row},${sample.col}`));
        if (covered.length) route.attackUnits.add(piece.uid);
        for (const sample of covered) route.attackTiles.add(`${sample.row},${sample.col}`);
      }
      if (placement.roles.blocker && !route.unblockable && routeSamples.some((sample) => !sample.flight
        && sample.row === placement.row && sample.col === placement.col)) route.blockerUnits.add(piece.uid);
    }
  }
  return [...routes.values()].map(({ pathTiles, attackTiles, attackUnits, blockerUnits, ...route }) => ({ ...route,
    attackUnits: [...attackUnits], blockerUnits: [...blockerUnits], pathTileCount: pathTiles.size,
    attackTileCount: attackTiles.size, attackTiles: [...attackTiles] }));
}

function assertLegalDeployment(state, placements = null) {
  assertInventory(state.pieces, ctx, state.xp);
  const bench = state.pieces.filter((piece) => piece.row === null || piece.col === null).length;
  if (bench > ctx.design.system.run.benchSize) throw new Error(`layout bench overflow ${bench}`);
  const deployed = state.pieces.filter((piece) => piece.row !== null && piece.col !== null);
  const occupied = new Set();
  for (const piece of deployed) {
    const key = `${piece.row},${piece.col}`;
    if (occupied.has(key)) throw new Error(`layout duplicate occupancy at ${key}`);
    occupied.add(key);
    if (!ctx.canPlace(state, piece, piece.row, piece.col)) throw new Error(`layout has illegal placement ${piece.uid} at ${key}`);
  }
  const population = deployed.reduce((sum, piece) => sum + piecePopulationCost(piece, ctx), 0);
  if (population > activePieceLimit(state, ctx)) throw new Error(`layout population overflow ${population}`);
  for (const placement of placements ?? []) {
    const piece = state.pieces.find((entry) => entry.uid === placement.uid);
    if (!piece || piece.row !== placement.row || piece.col !== placement.col || piece.dir !== placement.dir)
      throw new Error(`layout target mismatch for ${placement.uid}`);
  }
  return state;
}

function layoutRejection(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function deployLegalReorder(source, placements, tag, dispatch = transition, operationLog = null) {
  const selected = new Set(placements.map((entry) => entry.uid));
  const finalBench = source.pieces.length - selected.size;
  if (finalBench > ctx.design.system.run.benchSize) throw new Error(`layout requires ${finalBench} bench slots`);
  let state = assertLegalDeployment(structuredClone(source));
  const targets = new Map(placements.map((entry) => [entry.uid, { row: entry.row, col: entry.col, dir: entry.dir }]));
  const targetKeys = new Set([...targets.values()].map(({ row, col }) => `${row},${col}`));
  const occupancy = () => new Map(state.pieces.filter((piece) => piece.row !== null && piece.col !== null)
    .map((piece) => [`${piece.row},${piece.col}`, piece]));
  const run = (type, payload) => {
    operationLog?.push({ type, ...payload });
    state = dispatch(state, type, payload, tag);
    assertLegalDeployment(state);
  };
  const emptyLegalTile = (piece, preferNonTarget = true) => {
    const occupied = occupancy();
    const keys = [...ctx.fieldFor(state).normalizedDeployMap.keys()];
    const legal = (key) => {
      const [row, col] = key.split(',').map(Number);
      return !occupied.has(key) && ctx.canPlace(state, piece, row, col);
    };
    return keys.find((key) => (!preferNonTarget || !targetKeys.has(key)) && legal(key))
      ?? (preferNonTarget ? keys.find(legal) : null);
  };

  // Selected bench pieces leave the bench first; use their target when free, otherwise a legal temporary tile.
  for (const placement of placements) {
    let piece = state.pieces.find((entry) => entry.uid === placement.uid);
    if (piece.row !== null && piece.col !== null) continue;
    if(v3()){
      // A player releases population before bringing in a replacement. The v2
      // baseline retains its original fallback; only the new strategy changes.
      while(state.pieces.filter(p=>p.row!==null&&p.col!==null).reduce((n,p)=>n+piecePopulationCost(p,ctx),0)
        +piecePopulationCost(piece,ctx)>activePieceLimit(state,ctx)){
        const buffer=state.pieces.find(p=>!selected.has(p.uid)&&p.row!==null&&p.col!==null);
        if(!buffer||state.pieces.filter(p=>p.row===null||p.col===null).length>=ctx.design.system.run.benchSize)
          throw layoutRejection('LAYOUT_REORDER_BLOCKED','no legal bench room to release population');
        run('bench',{uid:buffer.uid});piece=state.pieces.find(p=>p.uid===placement.uid);
      }
    }
    const targetKey = `${placement.row},${placement.col}`;
    let destination = occupancy().has(targetKey) ? null : targetKey;
    if (!destination) destination = emptyLegalTile(piece);
    if (!destination) {
      const buffer = state.pieces.find((entry) => !selected.has(entry.uid) && entry.row !== null && entry.col !== null
        && targetKeys.has(`${entry.row},${entry.col}`));
      const benchCount = state.pieces.filter((entry) => entry.row === null || entry.col === null).length;
      if (buffer && benchCount < ctx.design.system.run.benchSize) {
        run('bench', { uid: buffer.uid });
        destination = occupancy().has(targetKey) ? null : targetKey;
      }
    }
    if (!destination) throw layoutRejection('LAYOUT_REORDER_BLOCKED', `cannot make legal room for selected bench piece ${placement.uid}`);
    const [row, col] = destination.split(',').map(Number);
    run('place', { uid: placement.uid, row, col, dir: placement.dir });
  }

  for (const piece of [...state.pieces]) {
    if (selected.has(piece.uid) || piece.row === null || piece.col === null) continue;
    run('bench', { uid: piece.uid });
  }

  let guard = 0;
  while (placements.some((placement) => {
    const piece = state.pieces.find((entry) => entry.uid === placement.uid);
    return piece.row !== placement.row || piece.col !== placement.col || piece.dir !== placement.dir;
  })) {
    if (++guard > placements.length * 4 + 8) throw layoutRejection('LAYOUT_REORDER_FAILED', 'layout reorder did not converge');
    const occupied = occupancy();
    const directionOnly = placements.find((placement) => {
      const piece = state.pieces.find((entry) => entry.uid === placement.uid);
      return piece.row === placement.row && piece.col === placement.col && piece.dir !== placement.dir;
    });
    if (directionOnly) {
      run('changeDir', { uid: directionOnly.uid, dir: directionOnly.dir });
      continue;
    }
    const direct = placements.find((placement) => {
      const piece = state.pieces.find((entry) => entry.uid === placement.uid);
      return (piece.row !== placement.row || piece.col !== placement.col || piece.dir !== placement.dir)
        && !occupied.has(`${placement.row},${placement.col}`);
    });
    if (direct) {
      run('place', { uid: direct.uid, row: direct.row, col: direct.col, dir: direct.dir });
      continue;
    }
    const cycle = placements.find((placement) => {
      const piece = state.pieces.find((entry) => entry.uid === placement.uid);
      return piece.row !== placement.row || piece.col !== placement.col;
    });
    if (!cycle) throw layoutRejection('LAYOUT_REORDER_BLOCKED', 'layout direction-only move could not resolve occupancy');
    const piece = state.pieces.find((entry) => entry.uid === cycle.uid);
    const temporary = emptyLegalTile(piece);
    if (temporary) {
      const [row, col] = temporary.split(',').map(Number);
      run('place', { uid: piece.uid, row, col, dir: piece.dir });
      continue;
    }
    const benchCount = state.pieces.filter((entry) => entry.row === null || entry.col === null).length;
    if (benchCount < ctx.design.system.run.benchSize) {
      run('bench', { uid: piece.uid });
      continue;
    }
    throw layoutRejection('LAYOUT_REORDER_BLOCKED', `layout cycle has no legal temporary tile or bench buffer for ${piece.uid}`);
  }
  return assertLegalDeployment(state, placements);
}


function configureManualSummons(state,perform=(s,t,p)=>transition(s,t,p,'manual-summons')){
 const reserved=new Set(state.pieces.filter(p=>p.row!==null).map(p=>p.row+','+p.col));
 const encounter=ctx.design.encounters.encounters.find(e=>e.id===state.currentNode.encounterId);
 const samples=routeSamplesFor(state,encounter).samples;
 for(const original of state.pieces.filter(p=>p.row!==null)){
  let index=0;
  for(const option of summonTemplateOptions({runtime:ctx.runtime},original)){
   for(let count=0;count<(option.max??1)&&index<12;count++){
    const piece=state.pieces.find(p=>p.uid===original.uid);
    const tiles=[...ctx.fieldFor(state).normalizedDeployMap.keys()].map(k=>k.split(',').map(Number))
     .filter(([row,col])=>!reserved.has(row+','+col)&&ctx.canPlaceSummon(state,piece,row,col,{tokenId:option.tokenId,index}));
    const iron=option.tokenId==='token_10027_ironmn_pile2';
    const recipients=([r,c])=>state.pieces.filter(p=>p.row!==null&&Math.abs(p.row-r)+Math.abs(p.col-c)===1&&ctx.runtime.bodies[p.charId].fixedSkill.kind!=='passive')
      .sort((a,b)=>{
        const carry=p=>{const body=ctx.runtime.bodies[p.charId];return body.adaptation.roles.includes('direct')&&isLineMember(body,lineFor(state,ctx,reportByRun));};
        return(v3()?Number(carry(b))-Number(carry(a)):0)||Number(b.uid!==piece.uid)-Number(a.uid!==piece.uid)||(ctx.runtime.bodies[b.charId].fixedSkill.spCosts?.[0]??0)-(ctx.runtime.bodies[a.charId].fixedSkill.spCosts?.[0]??0)||a.uid.localeCompare(b.uid);
      });
    const score=([r,c])=>samples.reduce((s,p)=>s+p.pressure/(1+Math.abs(p.row-r)+Math.abs(p.col-c)),0)-.01*(Math.abs(piece.row-r)+Math.abs(piece.col-c))
      -(iron?1000000*Math.max(0,Math.max(Math.abs(piece.row-r),Math.abs(piece.col-c))-1):0)+(iron&&recipients([r,c]).length?100000:0);
    tiles.sort((a,b)=>(v3()?manualSummonScore(state,piece,option,b,samples,ctx)-manualSummonScore(state,piece,option,a,samples,ctx):0)||score(b)-score(a)||a[0]-b[0]||a[1]-b[1]);const tile=tiles[0];if(!tile)break;
    const recipient=iron?recipients(tile)[0]:null;
    const dir=recipient?(recipient.row<tile[0]?'S':recipient.row>tile[0]?'N':recipient.col<tile[1]?'W':'E'):piece.dir;
    state=perform(state,'setSummonPreset',{uid:piece.uid,index:index++,tokenId:option.tokenId,row:tile[0],col:tile[1],dir});reserved.add(tile.join(','));
   }
  }
 }
 return state;
}

function candidatePlacements(source, encounter, lineup, variant) {
  const paired=v3()&&variant>=4;variant%=4;
  if (source.pieces.length - lineup.length > ctx.design.system.run.benchSize) return null;
  const state = structuredClone(source);
  for (const piece of state.pieces) { piece.row = null; piece.col = null; }
  const samples = [];
  samples.push(...routeSamplesFor(state, encounter).samples);
  const ordered = lineup.map((entry) => state.pieces.find((piece) => piece.uid === entry.uid)).sort((a,b)=>(v3()?lineFor(state,ctx,reportByRun).core.indexOf(a.charId)+1||999:0)-(v3()?lineFor(state,ctx,reportByRun).core.indexOf(b.charId)+1||999:0)||Number(isBlocker(b)) - Number(isBlocker(a))
    || Number(isHealer(a)) - Number(isHealer(b)) || a.uid.localeCompare(b.uid));
  const placements = []; const used = new Set(); const covered = new Set();
  for (const piece of ordered) {
    const body = ctx.runtime.bodies[piece.charId]; const roles = roleSet(piece, state, encounter); let best = null;
    for (const key of ctx.fieldFor(state).normalizedDeployMap.keys()) {
      const [row, col] = key.split(',').map(Number); const tileKey = `${row},${col}`;
      if (used.has(tileKey) || !ctx.canPlace(state, piece, row, col)) continue;
      for (const dir of ['E', 'N', 'W', 'S']) {
        const range = ownerRangeKeys(v3()?(body.adaptation.rangeGrid??body.range):(body.range??body.simChess?.rangeGrid), row, col, assaultNativeDirection(dir));
        const attack = Boolean(roles.profile && !roles.profile.noAttack && roles.profile.dmgType !== 'heal');
        let score = 0;
        for (const sample of samples) if (attack && !sample.boss && (!sample.flight || roles.antiAir) && range.has(`${sample.row},${sample.col}`)) {
          const coverageKey = `${sample.routeIndex}:${sample.row},${sample.col}`;
          const weight = sample.pressure * (sample.flight ? (variant === 2 ? 7 : 4) : 1) * (sample.unblockable && variant === 1 ? 10 : 1);
          score += weight / (covered.has(coverageKey) ? (variant === 3 ? 2.2 : 1.4) : 1);
        }
        if(attack&&samples.some(sample=>sample.boss&&range.has(`${sample.row},${sample.col}`)))score+=[0,400,1000,200][variant];
        if (roles.blocker) score += samples.filter((sample) => !sample.flight && !sample.unblockable && sample.row === row && sample.col === col).reduce((sum, sample) => sum + sample.pressure * (variant === 3 ? 7 : 4), 0);
        if (isHealer(piece)) score = state.pieces.filter((other) => other.uid !== piece.uid && other.row !== null
          && range.has(`${other.row},${other.col}`) && roleSet(other, state, encounter).profile?.dmgType !== 'heal').length * 40;
        if(v3())score+=placementBonus(state,piece,{row,col,dir,range,placements,ctx,paired});
        score += variant * 0.2 * ((row * 17 + col * 11 + ['E', 'N', 'W', 'S'].indexOf(dir) * 5) % 17);
        if (!best || score > best.score) best = { row, col, dir, score, range };
      }
    }
    if (!best) continue;
    piece.row = best.row; piece.col = best.col; piece.dir = best.dir;
    used.add(`${best.row},${best.col}`); placements.push({ uid: piece.uid, charId: piece.charId, row: best.row, col: best.col, dir: best.dir, roles });
    for (const sample of samples) if (best.range.has(`${sample.row},${sample.col}`)) covered.add(`${sample.routeIndex}:${sample.row},${sample.col}`);
  }
  if (placements.length !== lineup.length) throw layoutRejection('LAYOUT_NO_GEOMETRY', `layout variant ${variant} placed ${placements.length}/${lineup.length} selected units`);
  const legalState = configureManualSummons(deployLegalReorder(source, placements, `layout${variant}`));
  return { state: legalState, placements, routeCoverage: summarizeRouteCoverage(legalState, placements, samples), samples };
}

function previewUtility(result, life) {
  const leaked = Number(result.leakedLife ?? 0);
  return { victory: result.victory === true, leaked, fatal: leaked >= life, lifeAfter: Math.max(0, life - leaked),
    killed: Number(result.stats?.killed ?? 0), damage: (result.stats?.units ?? []).reduce((sum, unit) => sum + Number(unit.dmg ?? 0), 0),
    bossHpLeft: result.bossHpLeft ?? null, errorCount: Number(result.diagnostics?.errorCount ?? 0) };
}

function currentLayoutCandidate(state, encounter) {
  const placements = state.pieces.filter((piece) => piece.row !== null && piece.col !== null).map((piece) => ({
    uid: piece.uid, charId: piece.charId, row: piece.row, col: piece.col, dir: piece.dir, roles: roleSet(piece, state, encounter),
  }));
  if (!placements.length) return null;
  assertLegalDeployment(state, placements);
  const samples = routeSamplesFor(state, encounter).samples;
  return { state: structuredClone(state), placements, samples, routeCoverage: summarizeRouteCoverage(state, placements, samples) };
}

function isLayoutRejection(error) {
  return ['POPULATION_FULL', 'BENCH_FULL', 'INVALID_TILE', 'TILE_OCCUPIED', 'LAYOUT_BENCH_LIMIT',
    'LAYOUT_REORDER_BLOCKED', 'LAYOUT_REORDER_FAILED', 'LAYOUT_NO_GEOMETRY'].includes(error?.code);
}

function planBattle(state, lineupSelector = chooseLineup) {
  const encounter = ctx.design.encounters.encounters.find((entry) => entry.id === state.currentNode.encounterId);
  const candidates = []; const seen = new Set(); const rejections = [];
  for (let variant = 0; variant < (v3()?8:4); variant += 1) {
    const { lineup, flightThreat, unblockableThreat, dpLimit, popLimit } = lineupSelector(state, encounter, variant);
    let candidate;
    try { candidate = candidatePlacements(state, encounter, lineup, variant); }
    catch (error) {
      if (!isLayoutRejection(error)) throw error;
      rejections.push({ variant, code: error.code, reason: error.message });
      continue;
    }
    if (!candidate) {
      rejections.push({ variant, code: 'LAYOUT_BENCH_LIMIT', reason: 'selected lineup would exceed bench capacity' });
      continue;
    }
    const key = candidate.placements.map((entry) => `${entry.uid}:${entry.row},${entry.col},${entry.dir}`).join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const readyState = transition(candidate.state, 'readyBattle', {}, `preview${variant}`);
    const result = ctx.settleBattle(structuredClone(readyState), structuredClone(readyState.currentBattle));
    const utility = previewUtility(result, state.life);
    if (utility.errorCount !== 0) throw new Error(`native preview errors=${utility.errorCount} encounter=${encounter.id}`);
    candidates.push({ variant, flightThreat, unblockableThreat, dpLimit, popLimit, placements: candidate.placements,
      routeCoverage: candidate.routeCoverage, result: utility });
  }
  let fallbackUsed = false;
  if (!candidates.length) {
    const candidate = currentLayoutCandidate(state, encounter);
    if (!candidate) throw new Error(`no legal preview layouts or current-layout fallback for ${encounter.id}`);
    const readyState = transition(candidate.state, 'readyBattle', {}, 'preview-current-layout-fallback');
    const result = ctx.settleBattle(structuredClone(readyState), structuredClone(readyState.currentBattle));
    const utility = previewUtility(result, state.life);
    if (utility.errorCount !== 0) throw new Error(`native fallback preview errors=${utility.errorCount} encounter=${encounter.id}`);
    candidates.push({ variant: 'current-layout-fallback', flightThreat: false, unblockableThreat: false,
      dpLimit: null, popLimit: activePieceLimit(state, ctx), placements: candidate.placements,
      routeCoverage: candidate.routeCoverage, result: utility });
    fallbackUsed = true;
  }
  candidates.sort((a, b) => Number(b.result.victory) - Number(a.result.victory)
    || Number(a.result.fatal) - Number(b.result.fatal) || a.result.leaked - b.result.leaked
    || Number(a.result.bossHpLeft ?? 0) - Number(b.result.bossHpLeft ?? 0) || b.result.killed - a.result.killed || b.result.damage - a.result.damage);
  return { encounter, previews: candidates, selected: candidates[0], rejections, fallbackUsed };
}

function deployForBattle(state, plan) {
  return configureManualSummons(deployLegalReorder(state, plan.selected.placements, 'battleDeploy', (current, type, payload) => act(current, type, payload)),act);
}

function browserPlannerSeed(state) {
  const key = `${state.runId}:${state.revision}:${state.day}:${state.hour}:${state.phase}:${state.currentNode?.encounterId ?? ''}`;
  let value = 2166136261;
  for (let index = 0; index < key.length; index += 1) value = Math.imul(value ^ key.charCodeAt(index), 16777619);
  return (value >>> 0) || 0x6d2b79f5;
}

function browserPlannerState(view) {
  const state = structuredClone(view?.state && typeof view.state === 'object' ? view.state : view);
  const runId = view?.runId ?? state?.runId;
  if (!state || typeof runId !== 'string' || typeof state.phase !== 'string'
    || !Number.isInteger(state.revision) || !Array.isArray(state.pieces)) {
    throw Object.assign(new Error('Expected a public Assault viewRun state with runId, phase, revision and pieces'), { code: 'INVALID_VIEW' });
  }
  state.runId = runId;
  // Counterfactuals get a stable synthetic stream from visible identity/phase, never the run's hidden RNG.
  const seed = browserPlannerSeed(state);
  state.seed = seed;
  state.rngState = seed;
  state.history = [];
  state.opJournal = [];
  return state;
}

function chooseVisibleNode(state) {
  const nodes = Array.isArray(state.choices) ? state.choices : state.nodeChoices;
  if (!Array.isArray(nodes) || !nodes.length) throw Object.assign(new Error('No visible node choices'), { code: 'NO_VISIBLE_NODE' });
  const ownTheme=v3()?nodes.find(node=>ownThemeShopScore(state,node,ctx)>0):null;
  if(ownTheme)return ownTheme;
  const hasStrategy = Object.values(state.skillRanks ?? {}).some((rank) => Number(rank) > 0);
  const hasEnchant = state.pieces.some((piece) => typeof piece.enchantmentId === 'string');
  const fixedShop = state.day === 1 && state.hour === 2 && !hasStrategy ? 'shop_strategy'
    : state.hour === 4 && state.day >= 2 && !hasEnchant ? 'shop_enchant' : null;
  if (fixedShop) {
    const node = nodes.find((entry) => entry.kind === 'shop' && entry.shopId === fixedShop);
    if (node) return node;
  }
  const visibleShop = nodes.find((entry) => entry.kind === 'shop');
  const events = nodes.filter((entry) => entry.kind === 'event' && typeof entry.eventId === 'string').map((node) => {
    try {
      const publicEvent = { ...eventForNode(state, ctx, node.eventId), life: state.life, maxLife: state.maxLife };
      return { node, evaluation: evaluateEvent(state, publicEvent) };
    } catch {
      return { node, evaluation: { best: null, notEvaluated: [{ reason: 'public-event-unavailable' }] } };
    }
  }).filter((entry) => entry.evaluation.best);
  events.sort((a, b) => b.evaluation.best.value - a.evaluation.best.value || a.node.id.localeCompare(b.node.id));
  if (events[0]?.evaluation.best.freeEnchantment || (!visibleShop && events[0])) return events[0].node;
  if (visibleShop) return visibleShop;
  const battle = nodes.filter((entry) => entry.kind === 'battle');
  if (battle.length) return battle.find((entry) => entry.battleKind === 'normal') ?? battle[0];
  if (events.length) return events[0].node;
  throw Object.assign(new Error('No visible node can be recommended'), { code: 'NO_VISIBLE_NODE' });
}

function captureNextVisibleAction(state, decide) {
  const runId = state.runId;
  const previousReport = reportByRun.get(runId);
  reportByRun.set(runId, { directorId: state.directorId, purchases: [], shopObservations: [], upgradeObservations: [], eventObservations: [] });
  let action = null;
  captureBrowserAction = true;
  try { decide(state); }
  catch (error) {
    if (error?.code === 'BROWSER_PLANNER_CAPTURE' && error.action) action = error.action;
    else throw error;
  } finally {
    captureBrowserAction = false;
    if (previousReport) reportByRun.set(runId, previousReport);
    else reportByRun.delete(runId);
    plannedEvents.delete(runId);
  }
  if (!action) throw Object.assign(new Error('Decision helper produced no visible action'), { code: 'NO_VISIBLE_ACTION' });
  return action;
}

function planBrowserView(view) {
  const state = browserPlannerState(view);
  const base = { runId: state.runId, phase: state.phase, revision: state.revision };
  if (state.phase === 'nodeChoice') {
    const node = chooseVisibleNode(state);
    return { ...base, kind: 'click-node', nodeId: node.id, nodeKind: node.kind, shopId: node.shopId ?? null };
  }
  if (state.phase === 'skillChoice') {
    const choices = state.skillRewards?.choices ?? [];
    const preferred = ['strategy_catalytic', 'strategy_arms', 'strategy_supply', 'strategy_backroom', 'strategy_merchant'];
    const skillId = [...choices].sort((a, b) => (preferred.indexOf(a) < 0 ? 99 : preferred.indexOf(a))
      - (preferred.indexOf(b) < 0 ? 99 : preferred.indexOf(b)) || a.localeCompare(b))[0];
    return skillId ? { ...base, kind: 'select-visible-choice', actionType: 'chooseSkill', skillId }
      : { ...base, kind: 'select-visible-choice', actionType: 'skipSkillReward' };
  }
  if (state.phase === 'upgradeChoice') {
    const action = captureNextVisibleAction(state, chooseOperatorUpgrade);
    return { ...base, kind: 'select-visible-choice', actionType: action.type, uid: action.uid ?? null };
  }
  if (state.phase === 'shop') {
    const action = captureNextVisibleAction(state, playShop);
    return { ...base, kind: 'shop-action', actionType: action.type, slotId: action.slotId ?? null, uid: action.uid ?? null };
  }
  if (state.phase === 'event') {
    const action = captureNextVisibleAction(state, playEvent);
    return { ...base, kind: 'event-action', actionType: action.type, choiceId: action.choiceId ?? null,
      targetUid: action.targetUid ?? null, filterTag: action.filterTag ?? null };
  }
  if (state.phase === 'rewards') {
    const relicId = state.rewards?.choices?.[0];
    return relicId ? { ...base, kind: 'select-visible-choice', actionType: 'chooseRelic', relicId }
      : { ...base, kind: 'select-visible-choice', actionType: 'NO_VISIBLE_RELIC' };
  }
  if (state.phase === 'battlePrep') {
    const runId = state.runId;
    const prior = reportByRun.get(runId);
    reportByRun.set(runId, { directorId: state.directorId, purchases: [], shopObservations: [], upgradeObservations: [], eventObservations: [] });
    try {
      const plan = planBattle(state);
      const operations = [];
      deployLegalReorder(state, plan.selected.placements, `browser-layout:${state.runId}:${state.revision}`,
        transition, operations);
      return { ...base, kind: 'place-sequence', variant: plan.selected.variant, previewCount: plan.previews.length,
        fallbackUsed: plan.fallbackUsed, rejections: plan.rejections.map(({ variant, code }) => ({ variant, code })),
        operations, placements: plan.selected.placements.map(({ uid, row, col, dir }) => ({ uid, row, col, dir })) };
    } finally {
      if (prior) reportByRun.set(runId, prior); else reportByRun.delete(runId);
    }
  }
  if (state.phase === 'battle') return { ...base, kind: 'wait-for-browser' };
  if (state.phase === 'ended') return { ...base, kind: 'terminal', completed: state.completed === true, life: state.life,
    day: state.day, hour: state.hour };
  throw Object.assign(new Error(`Unsupported visible phase: ${state.phase}`), { code: 'UNSUPPORTED_PHASE' });
}

function browserPlannerReply(message, cache) {
  const requestId = typeof message?.requestId === 'string' ? message.requestId : null;
  try {
    const view = message?.view;
    const state = browserPlannerState(view);
    const cacheState = { ...state };
    for (const key of ['rngState', 'seed', 'history', 'opJournal']) delete cacheState[key];
    const key = JSON.stringify(cacheState);
    let recommendation = cache.get(key);
    if (!recommendation) {
      recommendation = planBrowserView(view);
      cache.set(key, recommendation);
      while (cache.size > 48) cache.delete(cache.keys().next().value);
    }
    return { type: 'recommendation', requestId, ...recommendation };
  } catch (error) {
    return { type: 'error', requestId, code: error?.code ?? 'PLANNER_ERROR', message: String(error?.message ?? error).slice(0, 500) };
  }
}

async function runBrowserPlanner() {
  const cache = new Map();
  process.stdout.write(`${JSON.stringify({ type: 'ready', protocol: 'assault-browser-planner/v1', sourceCommit })}\n`);
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > 4 * 1024 * 1024) {
      process.stdout.write(`${JSON.stringify({ type: 'error', requestId: null, code: 'INPUT_TOO_LARGE', message: 'Planner input exceeded 4 MiB' })}\n`);
      continue;
    }
    let message;
    try { message = JSON.parse(line); }
    catch { process.stdout.write(`${JSON.stringify({ type: 'error', requestId: null, code: 'INVALID_JSON', message: 'Expected one JSON object per line' })}\n`); continue; }
    process.stdout.write(`${JSON.stringify(browserPlannerReply(message, cache))}\n`);
  }
}

function equipNativeModules(state){
 if(!['nodeChoice','shop','event','battlePrep'].includes(state.phase))return state;
 for(const piece of state.pieces){if(piece.star<3||piece.moduleChoices?.[piece.charId])continue;
  const module=v3()?moduleForLine(state,piece,ctx,reportByRun):ctx.runtime.bodies[piece.charId].modulePlans[0];state=act(state,'chooseModule',{uid:piece.uid,moduleId:module.id});
 }return state;
}
function runNativeCampaign(directorId, seed) {
  const runId = `strategy-enchant-${directorId}-${seed}`;
  const report = { directorId, seed, runId, startedAt: new Date().toISOString(), battles: [], purchases: [], lifecycle: [], shopObservations: [], upgradeObservations: [], eventObservations: [] };
  reportByRun.set(runId, report);
  let state = createRun({ runId, seed, directorId }, ctx);
  report.lastState = compactRunState(state);
  const startGold = state.gold;
  let actions = 0;
  while (state.phase !== 'ended') {
    state=equipNativeModules(state);
    report.lastState = compactRunState(state);
    if (Date.now() > toolDeadlineMs) throw new Error('campaign tool 10-minute deadline reached');
    if (Date.now() - Date.parse(report.startedAt) > 4 * 60 * 1000) throw new Error(`run wall-clock cap reached: ${runId}`);
    if (++actions > 500) throw new Error(`action cap exceeded for ${runId}`);
    if (state.phase === 'nodeChoice') state = act(state, 'selectNode', { nodeId: chooseNode(state).id });
    else if (state.phase === 'upgradeChoice') state = chooseOperatorUpgrade(state);
    else if (state.phase === 'skillChoice') {
      const choices = state.pendingSkillRewards?.[0]?.choices ?? [];
      if (!choices.length) state = act(state, 'skipSkillReward');
      else {
        const preferred = ['strategy_catalytic', 'strategy_arms', 'strategy_supply', 'strategy_backroom', 'strategy_merchant'];
        const skillId = [...choices].sort((a, b) => (preferred.indexOf(a) < 0 ? 99 : preferred.indexOf(a))
          - (preferred.indexOf(b) < 0 ? 99 : preferred.indexOf(b)) || a.localeCompare(b))[0];
        state = act(state, 'chooseSkill', { skillId });
      }
    }
    else if (state.phase === 'shop') {
      const before = state.pieces.reduce((n, piece) => n + Number(piece.enchantmentId != null), 0);
      state = playShop(state);
      if (state.pieces.some((piece) => piece.enchantmentId) && before === 0) report.purchases.push({ kind: 'enchantmentApplied', day: state.day, hour: state.hour, pieces: state.pieces.filter((piece) => piece.enchantmentId).map((piece) => ({ uid: piece.uid, enchantmentId: piece.enchantmentId })) });
      for (const entry of state.history.slice(-4)) if (entry.kind === 'runLifecycleTriggered') report.lifecycle.push({ day: state.day, hour: state.hour, event: entry.event, ruleId: entry.ruleId, stat: entry.stat, targetUid: entry.targetUid ?? null, amount: entry.amount });
    } else if (state.phase === 'event') state = playEvent(state);
    else if (state.phase === 'battlePrep') {
      const plan = planBattle(state);
      state = deployForBattle(state, plan);
      const started = Date.now();
      state = act(state, 'readyBattle');
      const input = state.currentBattle.input;
      const receipt = { day: state.day, hour: state.hour, encounterId: state.currentBattle.encounterId, battleId: state.currentBattle.battleId,
        ...(process.env.ASSAULT_CAPTURE_PREPARED==='1'?{prepared:structuredClone(state.currentBattle)}:null),
        snapshot: { skillRanks: input.skillRanks, teamGrowth: input.teamGrowth,
          runGrowth:input.pieces.filter(piece=>RUN_CARD_GROWTH[piece.charId]).map(piece=>({uid:piece.uid,charId:piece.charId,points:runGrowthPoints(piece),deployed:piece.row!==null&&piece.col!==null})),
          enchantedPieces: input.pieces.filter((piece) => piece.enchantmentId).map((piece) => ({ uid: piece.uid, enchantmentId: piece.enchantmentId })) },
        previewCount: plan.previews.length, previews: plan.previews.map((entry) => ({ variant: entry.variant, flightThreat: entry.flightThreat,
          unblockableThreat: entry.unblockableThreat, routeCoverage: entry.routeCoverage,
          placements: entry.placements.map(({ uid, row, col, dir }) => [uid, row, col, dir]), result: entry.result })),
        layoutRejections: plan.rejections, currentLayoutFallback: plan.fallbackUsed,
        selectedVariant: plan.selected.variant,
        deployed: input.pieces.filter((piece) => piece.row !== null && piece.col !== null).map((piece) => ({ uid: piece.uid, charId: piece.charId, star: piece.star, row: piece.row, col: piece.col, dir: piece.dir,moduleChoices:piece.moduleChoices,summonPresets:piece.summonPresets })) };
      state = act(state, 'settleBattle', { battleId: state.currentBattle.battleId });
      const settled = settledBattles.get(receipt.battleId) ?? {};
      receipt.durationMs = Date.now() - started;
      receipt.outcome = { victory: settled.victory === true, leakedLife: settled.leakedLife ?? null, nativeErrorCount: settled.nativeErrorCount ?? null,
        lifeAfter: state.life, phase: state.phase, bossHpLeft: settled.bossHpLeft ?? null,
        reason: settled.reason, durationSec: settled.durationSec };
      receipt.nativeUpgradeObserved = Boolean(receipt.snapshot.enchantedPieces.length || Object.values(receipt.snapshot.teamGrowth ?? {}).some((value) => value !== 0) || Object.keys(receipt.snapshot.skillRanks ?? {}).length);
      receipt.battleStats = settled.stats ?? null; receipt.ledger=settled.ledger??null;receipt.evidence=settled.evidence??null;
      receipt.permanentEffects = (settled.permanentEffects ?? []).map((effect) => ({ uid: effect.uid, stat: effect.stat, amount: effect.amount, mode: effect.mode }));
      if (receipt.durationMs > 120000) throw new Error(`battle wall-clock cap exceeded (${receipt.durationMs}ms) ${receipt.encounterId}`);
      report.battles.push(receipt);process.stdout.write(JSON.stringify({progress:true,directorId,seed,day:state.day,hour:state.hour,life:state.life,casts:receipt.ledger?.operators.map(u=>[u.uid,u.casts,u.triggers])})+'\n');
      if (state.phase === 'ended' && state.life <= 0) break;
    } else if (state.phase === 'battle') state = act(state, 'settleBattle', { battleId: state.currentBattle.battleId });
    else if (state.phase === 'rewards') state = act(state, 'chooseRelic', { relicId: state.rewardQueue.choices[0] });
    else throw new Error(`unexpected phase ${state.phase}`);
  }
  report.completed = state.completed;
  report.final = { phase: state.phase, day: state.day, hour: state.hour, life: state.life, gold: state.gold, goldNet: state.gold - startGold, xp: state.xp, actions, revision: state.revision };
  report.hoursObserved = state.history.filter((entry) => entry.kind === 'hourStarted').length + 1;
  report.skillRanks = { ...(state.skillRanks ?? {}) };
  report.teamGrowth = { ...(state.teamGrowth ?? {}) };
  report.lifecycleHistoryCount = state.history.filter((entry) => entry.kind === 'runLifecycleTriggered').length;
  report.dayOneHourTwoStrategyPurchase = report.purchases.some((entry) => entry.action === 'buySkill' && entry.day === 1 && entry.hour === 2 && entry.shopId === 'shop_strategy');
  report.dayTwoPlusHourFourEnchantmentPurchase = report.purchases.some((entry) => entry.action === 'enchantPiece' && entry.day >= 2 && entry.hour === 4 && entry.shopId === 'shop_enchant');
  report.nativeErrorCount = report.battles.reduce((sum, battle) => sum + Number(battle.outcome.nativeErrorCount ?? 0), 0);
  report.startedAt = report.startedAt;
  report.endedAt = new Date().toISOString();
  report.policy=currentPolicy;report.finalRoster=state.pieces;
  report.growthChanges=state.history.filter(entry=>entry.kind==='cardGrowth');
  return report;
}


export {sourceCommit,chooseLineup,candidatePlacements,configureManualSummons,deployForBattle,planBattle,reportByRun,deployLegalReorder,routeSamplesFor,roleSet};
export function configureCampaign({policy='line-builder/v3',deadlineMs=Infinity}={}){currentPolicy=policy;toolDeadlineMs=deadlineMs;}
export function runCampaign(directorId,seed,{policy,deadlineMs=Infinity}={}){currentPolicy=policy??'public-signatures-native-boss-geometry-and-unlocked-modules/v2';toolDeadlineMs=deadlineMs;return runNativeCampaign(directorId,seed);}
