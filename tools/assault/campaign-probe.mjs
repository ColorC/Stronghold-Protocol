#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';
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

const ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const WT = `${ROOT}/.worktrees/assault/stronghold-protocol`;
const OUT = `${ROOT}/runtime/assault/strategy-enchantment-campaign.json`;
const LOG = `${ROOT}/runtime/assault/strategy-enchantment-campaign.log`;
const startedAt = new Date().toISOString();
const startedMs = Date.now();
const pid = process.pid;
const toolDeadlineMs = startedMs + 10 * 60 * 1000;
const browserPlannerMode = process.argv.includes('--browser-planner') || process.argv.includes('--browser-planner-fixture-only');
const sourceCommit = execFileSync('git', ['-C', WT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const scopedStatus = execFileSync('git', ['-C', WT, 'status', '--short', '--', 'shared/assault', 'server/modes/assault', 'server/sim/content/assault', 'data/assault-design/system.json', 'tools/assault/campaign-probe.mjs'], { encoding: 'utf8' }).trim();
if (!browserPlannerMode && (!fs.existsSync(OUT) || !fs.existsSync(LOG))) throw new Error('existing campaign failure receipt/log missing; refusing to start without history');
const ctx = createAssaultContext();
const actualSettleBattle = ctx.settleBattle;
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
    stats: compactSettledStats(outcome.stats),
    reason: outcome.reason ?? null, durationSec: outcome.durationSec ?? null,
    events: (outcome.events ?? []).slice(0, 8),
    permanentEffects: (outcome.permanentEffects ?? []).slice(0, 12),
  });
  return outcome;
};
const directorIds = ctx.design.system.directors.map((entry) => entry.id);
const seeds = [20261011, 20261012, 20261013];
const campaigns = [];
const commandRows = [];
const reportByRun = new Map();
const plannedEvents = new Map();
const nativeProfileCache = new Map();
const routeSampleCache = new Map();
let captureBrowserAction = false;
const previousReceipt = browserPlannerMode ? null : JSON.parse(fs.readFileSync(OUT, 'utf8'));
const previousLog = browserPlannerMode ? null : fs.readFileSync(LOG, 'utf8');
const priorAttempts = browserPlannerMode ? [] : previousReceipt.attempts ?? [{ attempt: 1, result: 'failed', ...previousReceipt }];

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
  return body?.profession === 'MEDIC' || (body?.fixedSkill?.effects ?? []).some((effect) => effect.action === 'heal' && /(友方|友军)/.test(String(effect.target ?? '')));
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
  const gridKey = `${encounter.id}|${native.stageId ?? stageId}|${grid.version ?? 0}|${obstacles.join(',')}`;
  const cached = routeSampleCache.get(gridKey);
  if (cached) return cached;
  const spawnByRoute = new Map();
  const inspectedSpawns = new Set();
  for (const spawn of encounter.wave.spawns ?? []) {
    const routeIndex = spawn.routeIndex ?? 0;
    const spawnKey = `${routeIndex}|${spawn.key}`;
    if (inspectedSpawns.has(spawnKey)) continue;
    inspectedSpawns.add(spawnKey);
    const enemy = native.spawnEnemy(spawn.key, { routeIndex });
    if (!enemy) throw new Error(`native spawn inspection failed for ${spawn.key} route=${routeIndex}`);
    const entry = { key: spawn.key, routeIndex, motion: enemy.motion ?? null,
      unblockable: enemy.s?.flags?.unblockable === true, profile: enemy.profile ? { ...enemy.profile } : null };
    if (!spawnByRoute.has(routeIndex)) spawnByRoute.set(routeIndex, []);
    spawnByRoute.get(routeIndex).push(entry);
  }
  if (native.errorCount !== 0) throw new Error(`native spawn inspection error ${native.errorCount} for ${encounter.id}`);
  const field = ctx.fieldFor(source).field;
  const samples = [];
  const walkSegments = [];
  const routeThreats = [];
  for (let routeIndex = 0; routeIndex < (native.routes ?? []).length; routeIndex += 1) {
    const route = native.routes[routeIndex];
    const spawns = (encounter.wave.spawns ?? []).filter((spawn) => (spawn.routeIndex ?? 0) === routeIndex);
    const nativeSpawns = spawnByRoute.get(routeIndex) ?? [];
    const pressure = Math.max(1, spawns.reduce((sum, spawn) => sum + (spawn.count ?? 1)
      * Number(ctx.nativeData.enemies[spawn.key]?.stats?.lpr ?? 1), 0));
    const flight = route.motion === 'FLY' || nativeSpawns.some((spawn) => spawn.motion === 'FLY');
    const unblockable = nativeSpawns.some((spawn) => spawn.unblockable);
    routeThreats.push({ routeIndex, flight, unblockable, enemies: nativeSpawns });
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
  const value = { samples, walkSegments, routeThreats, gridKey, grid };
  routeSampleCache.set(gridKey, value);
  return value;
}

function chooseNode(state) {
  const nodes = previewNodes(state);
  const report = reportByRun.get(state.runId);
  const firstStrategyBought = report?.purchases.some((entry) => entry.action === 'buySkill') ?? false;
  const firstEnchantBought = report?.purchases.some((entry) => entry.action === 'enchantPiece') ?? false;
  const fixed = state.day === 1 && state.hour === 2 && !firstStrategyBought ? 'shop_strategy'
    : state.hour === 4 && state.day >= 2 && !firstEnchantBought ? 'shop_enchant' : null;
  if (fixed) {
    const target = nodes.find((node) => node.kind === 'shop' && node.shopId === fixed);
    if (target) return target;
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
    return selected.node;
  }
  if (visibleShop) return visibleShop;
  const battleNodes = nodes.filter((node) => node.kind === 'battle');
  if (battleNodes.length) return battleNodes.find((node) => node.battleKind === 'normal') ?? battleNodes[0];
  const event = nodes.find((node) => node.kind === 'event');
  if (event) return event;
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
  return bought !== opened;
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
    const affordable = state.shop.slots.filter((slot) => slot.price <= state.gold && state.gold - slot.price >= reserve);
    affordable.sort((a, b) => (preferred.indexOf(a.skillId) < 0 ? 99 : preferred.indexOf(a.skillId))
      - (preferred.indexOf(b.skillId) < 0 ? 99 : preferred.indexOf(b.skillId)) || a.price - b.price);
    if (affordable[0]) {
      record({ slotId: affordable[0].slotId, reason: 'strategy-purchase-with-reserve', reserve });
      state = perform('buySkill', { slotId: affordable[0].slotId });
    } else record({ reason: 'no-strategy-with-required-reserve', reserve });
  } else if (state.shop.kind === 'enchantment' && !state.pieces.some((piece) => piece.enchantmentId)
    && state.day >= 2 && state.hour === 4) {
    const candidates = state.shop.slots.filter((slot) => slot.price <= state.gold)
      .sort((a, b) => (a.enchantmentId === 'enchant_toxic' ? -1 : 0) - (b.enchantmentId === 'enchant_toxic' ? -1 : 0));
    for (const slot of candidates) {
      const piece = state.pieces.find((candidate) => eligibleEnchantmentDefinitions(candidate, ctx).some((entry) => entry.id === slot.enchantmentId));
      if (piece) {
        record({ slotId: slot.slotId, reason: 'first-enchantment-at-fixed-hour', targetUid: piece.uid });
        state = perform('enchantPiece', { slotId: slot.slotId, uid: piece.uid }); break;
      }
    }
  } else if (!state.pieces.some((piece) => piece.enchantmentId) && state.day >= 2 && state.hour >= 4) {
    throw new Error('enchantment schedule reached without legal affordable enchantment transaction');
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
    const value = dps + healing;
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
  if (state.shop.kind && state.shop.kind !== 'operator') return state;
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
  else {
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
  candidates.sort((a, b) => b.priority - a.priority || b.gain - a.gain || a.uid.localeCompare(b.uid));
  reportByRun.get(state.runId)?.upgradeObservations?.push({ day: state.day, hour: state.hour, rewardId: reward.id,
    maxStar: reward.maxStar, candidates, chosenUid: candidates[0].uid });
  return act(state, 'chooseUpgrade', { uid: candidates[0].uid });
}

function transition(state, type, payload = {}, tag = 'preview') {
  const action = { type, ...payload, opId: `${tag}:${state.revision}:${type}:${payload.uid ?? ''}`, expectedRevision: state.revision };
  return applyAction(state, action, ctx).state;
}

function chooseLineup(state, encounter, variant) {
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
        return dps / Math.max(1, Number(entry.body.baseStats.cost ?? 99))
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

function candidatePlacements(source, encounter, lineup, variant) {
  if (source.pieces.length - lineup.length > ctx.design.system.run.benchSize) return null;
  const state = structuredClone(source);
  for (const piece of state.pieces) { piece.row = null; piece.col = null; }
  const samples = [];
  samples.push(...routeSamplesFor(state, encounter).samples);
  const ordered = lineup.map((entry) => state.pieces.find((piece) => piece.uid === entry.uid)).sort((a, b) => Number(isBlocker(b)) - Number(isBlocker(a))
    || Number(isHealer(a)) - Number(isHealer(b)) || a.uid.localeCompare(b.uid));
  const placements = []; const used = new Set(); const covered = new Set();
  for (const piece of ordered) {
    const body = ctx.runtime.bodies[piece.charId]; const roles = roleSet(piece, state, encounter); let best = null;
    for (const key of ctx.fieldFor(state).normalizedDeployMap.keys()) {
      const [row, col] = key.split(',').map(Number); const tileKey = `${row},${col}`;
      if (used.has(tileKey) || !ctx.canPlace(state, piece, row, col)) continue;
      for (const dir of ['E', 'N', 'W', 'S']) {
        const range = ownerRangeKeys(body.range ?? body.simChess?.rangeGrid, row, col, assaultNativeDirection(dir));
        const attack = Boolean(roles.profile && !roles.profile.noAttack && roles.profile.dmgType !== 'heal');
        let score = 0;
        for (const sample of samples) if (attack && (!sample.flight || roles.antiAir) && range.has(`${sample.row},${sample.col}`)) {
          const coverageKey = `${sample.routeIndex}:${sample.row},${sample.col}`;
          const weight = sample.pressure * (sample.flight ? (variant === 2 ? 7 : 4) : 1) * (sample.unblockable && variant === 1 ? 10 : 1);
          score += weight / (covered.has(coverageKey) ? (variant === 3 ? 2.2 : 1.4) : 1);
        }
        if (roles.blocker) score += samples.filter((sample) => !sample.flight && !sample.unblockable && sample.row === row && sample.col === col).reduce((sum, sample) => sum + sample.pressure * (variant === 3 ? 7 : 4), 0);
        if (isHealer(piece)) score = state.pieces.filter((other) => other.uid !== piece.uid && other.row !== null
          && range.has(`${other.row},${other.col}`) && roleSet(other, state, encounter).profile?.dmgType !== 'heal').length * 40;
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
  const legalState = deployLegalReorder(source, placements, `layout${variant}`);
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
  for (let variant = 0; variant < 4; variant += 1) {
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
  return deployLegalReorder(state, plan.selected.placements, 'battleDeploy', (current, type, payload) => act(current, type, payload));
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

function runCampaign(directorId, seed) {
  const runId = `strategy-enchant-${directorId}-${seed}`;
  const report = { directorId, seed, runId, startedAt: new Date().toISOString(), battles: [], purchases: [], lifecycle: [], shopObservations: [], upgradeObservations: [], eventObservations: [] };
  reportByRun.set(runId, report);
  let state = createRun({ runId, seed, directorId }, ctx);
  report.lastState = compactRunState(state);
  const startGold = state.gold;
  let actions = 0;
  while (state.phase !== 'ended') {
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
        snapshot: { skillRanks: input.skillRanks, teamGrowth: input.teamGrowth, enchantedPieces: input.pieces.filter((piece) => piece.enchantmentId).map((piece) => ({ uid: piece.uid, enchantmentId: piece.enchantmentId })) },
        previewCount: plan.previews.length, previews: plan.previews.map((entry) => ({ variant: entry.variant, flightThreat: entry.flightThreat,
          unblockableThreat: entry.unblockableThreat, routeCoverage: entry.routeCoverage,
          placements: entry.placements.map(({ uid, row, col, dir }) => [uid, row, col, dir]), result: entry.result })),
        layoutRejections: plan.rejections, currentLayoutFallback: plan.fallbackUsed,
        selectedVariant: plan.selected.variant,
        deployed: input.pieces.filter((piece) => piece.row !== null && piece.col !== null).map((piece) => ({ uid: piece.uid, charId: piece.charId, star: piece.star, row: piece.row, col: piece.col, dir: piece.dir })) };
      state = act(state, 'settleBattle', { battleId: state.currentBattle.battleId });
      const settled = settledBattles.get(receipt.battleId) ?? {};
      receipt.durationMs = Date.now() - started;
      receipt.outcome = { victory: settled.victory === true, leakedLife: settled.leakedLife ?? null, nativeErrorCount: settled.nativeErrorCount ?? null,
        lifeAfter: state.life, phase: state.phase, bossHpLeft: state.currentBattle?.bossHpLeft ?? null,
        reason: settled.reason, durationSec: settled.durationSec };
      receipt.nativeUpgradeObserved = Boolean(receipt.snapshot.enchantedPieces.length || Object.values(receipt.snapshot.teamGrowth ?? {}).some((value) => value !== 0) || Object.keys(receipt.snapshot.skillRanks ?? {}).length);
      receipt.battleStats = settled.stats ?? null;
      receipt.permanentEffects = (settled.permanentEffects ?? []).map((effect) => ({ uid: effect.uid, stat: effect.stat, amount: effect.amount, mode: effect.mode }));
      if (receipt.durationMs > 120000) throw new Error(`battle wall-clock cap exceeded (${receipt.durationMs}ms) ${receipt.encounterId}`);
      report.battles.push(receipt);
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
  return report;
}

function verifyWalkRouteFixture() {
  const directorId = directorIds[0];
  const state = createRun({ runId: `route-fixture-${directorId}`, seed: 811, directorId }, ctx);
  const node = state.nodes.find((entry) => entry.kind === 'battle');
  if (!node) throw new Error('route fixture has no visible battle encounter');
  const encounter = ctx.design.encounters.encounters.find((entry) => entry.id === node.encounterId);
  state.currentNode = node;
  state.phase = 'battlePrep';
  const routes = routeSamplesFor(state, encounter);
  if (!routes.walkSegments.length) throw new Error(`route fixture has no native WALK segments: ${encounter.id}`);
  for (const segment of routes.walkSegments) {
    const enginePath = routes.grid.findPath(segment.from[0], segment.from[1], segment.to[0], segment.to[1]);
    if (!enginePath || JSON.stringify(enginePath) !== JSON.stringify(segment.tiles))
      throw new Error(`route fixture diverged from native Grid.findPath: ${encounter.id} route=${segment.routeIndex}`);
    if (segment.tiles.some(([row, col]) => !routes.grid.walkable(row, col)))
      throw new Error(`route fixture contains a non-walkable tile: ${encounter.id} route=${segment.routeIndex}`);
  }
  return { encounterId: encounter.id, stageId: encounter.stageId, gridKey: routes.gridKey,
    walkSegments: routes.walkSegments.length, walkSamples: routes.walkSegments.reduce((sum, segment) => sum + segment.tiles.length, 0),
    nativeErrorCount: 0, allWalkable: true, matchesNativeFindPath: true };
}

function verifyUnblockableRouteFixture() {
  const directorId = directorIds[0];
  const state = createRun({ runId: `unblockable-fixture-${directorId}`, seed: 811, directorId }, ctx);
  const node = state.nodes.find((entry) => entry.kind === 'battle');
  if (!node) throw new Error('unblockable fixture has no visible battle encounter');
  const encounter = ctx.design.encounters.encounters.find((entry) => entry.id === node.encounterId);
  state.currentNode = node;
  state.phase = 'battlePrep';
  reportByRun.set(state.runId, { directorId });
  const routeData = routeSamplesFor(state, encounter);
  const threatRoutes = routeData.routeThreats.filter((route) => route.unblockable);
  if (!threatRoutes.length) throw new Error(`fixture encounter has no native unblockable enemy: ${encounter.id}`);
  const twoUnitLayout = candidatePlacements(state, encounter, state.pieces.slice(0, 2), 0);
  assertLegalDeployment(twoUnitLayout.state, twoUnitLayout.placements);
  const previews = [];
  for (const variant of [0, 1]) {
    const plan = chooseLineup(state, encounter, variant);
    const candidate = candidatePlacements(state, encounter, plan.lineup, variant);
    const readyState = transition(candidate.state, 'readyBattle', {}, `unblockable-fixture${variant}`);
    const outcome = ctx.settleBattle(structuredClone(readyState), structuredClone(readyState.currentBattle));
    const result = previewUtility(outcome, state.life);
    if (result.errorCount !== 0) throw new Error(`native unblockable preview errors=${result.errorCount} variant=${variant}`);
    previews.push({ variant, placements: candidate.placements.map(({ uid, row, col, dir }) => ({ uid, row, col, dir })),
      routeCoverage: candidate.routeCoverage, result });
  }
  const signature = (preview) => preview.placements.map((entry) => `${entry.uid}:${entry.row},${entry.col},${entry.dir}`).join('|');
  if (signature(previews[0]) === signature(previews[1])) throw new Error('variant 1 did not produce a distinct legal layout');
  const attackCount = (preview) => preview.routeCoverage.filter((route) => route.unblockable)
    .reduce((sum, route) => sum + route.attackTileCount, 0);
  if (attackCount(previews[1]) < attackCount(previews[0])) throw new Error(`variant 1 reduced attack-tile coverage on unblockable routes: ${JSON.stringify(previews.map((preview) => ({ variant: preview.variant, placements: preview.placements, routeCoverage: preview.routeCoverage })))}`);
  return { encounterId: encounter.id, stageId: encounter.stageId,
    unblockableEnemies: threatRoutes.flatMap((route) => route.enemies.filter((enemy) => enemy.unblockable)
      .map((enemy) => ({ routeIndex: route.routeIndex, key: enemy.key, motion: enemy.motion, unblockable: enemy.unblockable, profile: enemy.profile }))),
    twoUnitLayoutSelected: twoUnitLayout.placements.length, twoUnitLayoutBench: twoUnitLayout.state.pieces.filter((piece) => piece.row === null || piece.col === null).length,
    previews, changedLegalLayout: true, variantOneAttackCoverageAtLeastBaseline: true };
}

function verifyBenchReorderFixture() {
  const directorId = directorIds[0];
  let state = createRun({ runId: `bench-reorder-fixture-${directorId}`, seed: 812, directorId }, ctx);
  const node = state.nodes.find((entry) => entry.kind === 'battle');
  if (!node) throw new Error('bench reorder fixture has no visible battle encounter');
  state.currentNode = node;
  state.prepEncounterId = node.encounterId;
  state.phase = 'battlePrep';
  state = transition(state, 'sell', { uid: state.pieces[2].uid }, 'bench-fixture');
  assertLegalDeployment(state);
  const available = [...new Map(Object.values(ctx.runtime.operators)
    .filter((operator) => operator.purchaseCharId === operator.charId)
    .map((operator) => [operator.purchaseCharId, operator])).values()]
    .filter((operator) => !state.pieces.some((piece) => piece.purchaseCharId === operator.purchaseCharId));
  for (let index = 0; index < ctx.design.system.run.benchSize; index += 1) {
    const operator = available.shift();
    if (!operator) throw new Error('bench fixture lacks enough unique operator identities');
    addBodyToInventory(state, ctx, operator.charId, 1);
    assertLegalDeployment(state);
  }
  assertLegalDeployment(state);
  const deployed = state.pieces.filter((piece) => piece.row !== null && piece.col !== null);
  const benchPiece = state.pieces.find((piece) => piece.row === null || piece.col === null);
  if (deployed.length !== 2 || state.pieces.filter((piece) => piece.row === null || piece.col === null).length !== ctx.design.system.run.benchSize)
    throw new Error('bench fixture did not reach 12 bench plus two deployed pieces');
  const used = new Set(deployed.map((piece) => `${piece.row},${piece.col}`));
  const benchTarget = [...ctx.fieldFor(state).normalizedDeployMap.keys()].find((key) => {
    if (used.has(key)) return false;
    const [row, col] = key.split(',').map(Number);
    return ctx.canPlace(state, benchPiece, row, col);
  });
  if (!benchTarget) throw new Error('bench fixture has no legal target for selected bench piece');
  const [benchRow, benchCol] = benchTarget.split(',').map(Number);
  const placements = [{ uid: deployed[0].uid, row: deployed[0].row, col: deployed[0].col, dir: deployed[0].dir },
    { uid: benchPiece.uid, row: benchRow, col: benchCol, dir: 'E' }];
  const reordered = deployLegalReorder(state, placements, 'bench-reorder-fixture');
  assertLegalDeployment(reordered, placements);
  if (reordered.pieces.filter((piece) => piece.row === null || piece.col === null).length !== ctx.design.system.run.benchSize)
    throw new Error('bench reorder fixture did not preserve final bench capacity');
  return { pieces: reordered.pieces.length, selected: placements.length, finalBench: ctx.design.system.run.benchSize,
    deployedBefore: deployed.length, nonSelectedPreviouslyDeployedBenched: reordered.pieces.find((piece) => piece.uid === deployed[1].uid)?.row === null,
    selectedBenchUidPlaced: reordered.pieces.find((piece) => piece.uid === benchPiece.uid)?.row === benchRow,
    everyTransitionAsserted: true, finalTargetsMatch: true };
}

function verifyFullCapacityFallbackFixture() {
  const directorId = directorIds[0];
  let state = createRun({ runId: `full-capacity-fallback-${directorId}`, seed: 813, directorId }, ctx);
  const node = state.nodes.find((entry) => entry.kind === 'battle');
  if (!node) throw new Error('full-capacity fixture has no visible battle encounter');
  state.currentNode = node;
  state.prepEncounterId = node.encounterId;
  state.phase = 'battlePrep';
  const available = [...new Map(Object.values(ctx.runtime.operators)
    .filter((operator) => operator.purchaseCharId === operator.charId)
    .map((operator) => [operator.purchaseCharId, operator])).values()]
    .filter((operator) => !state.pieces.some((piece) => piece.purchaseCharId === operator.purchaseCharId));
  for (let index = 0; index < ctx.design.system.run.benchSize; index += 1) {
    const operator = available.shift();
    if (!operator) throw new Error('full-capacity fixture lacks enough unique identities');
    addBodyToInventory(state, ctx, operator.charId, 1);
    assertLegalDeployment(state);
  }
  const deployed = state.pieces.filter((piece) => piece.row !== null && piece.col !== null);
  const benchPiece = state.pieces.find((piece) => piece.row === null || piece.col === null);
  const pop = deployed.reduce((sum, piece) => sum + piecePopulationCost(piece, ctx), 0);
  if (deployed.length < 2 || pop !== activePieceLimit(state, ctx)
    || state.pieces.filter((piece) => piece.row === null || piece.col === null).length !== ctx.design.system.run.benchSize)
    throw new Error('full-capacity fixture did not fill both population and bench limits');
  const forcedLineup = [deployed[0], deployed[1], benchPiece];
  const plan = planBattle(state, () => ({ lineup: forcedLineup, flightThreat: false, unblockableThreat: false,
    dpLimit: 0, popLimit: activePieceLimit(state, ctx) }));
  if (!plan.fallbackUsed || !plan.rejections.some((entry) => entry.code === 'POPULATION_FULL'))
    throw new Error(`full-capacity candidate did not reject and fall back: ${JSON.stringify(plan.rejections)}`);
  const preserved = deployed.map((piece) => piece.uid).sort();
  const selected = plan.selected.placements.map((piece) => piece.uid).sort();
  if (JSON.stringify(preserved) !== JSON.stringify(selected)) throw new Error('current-layout fallback changed the deployed lineup');
  const finalState = deployForBattle(state, plan);
  assertLegalDeployment(finalState, plan.selected.placements);
  return { pieces: state.pieces.length, bench: ctx.design.system.run.benchSize, deployed: deployed.length,
    population: pop, rejectedVariants: plan.rejections.length, rejectionCode: plan.rejections[0]?.code,
    currentLayoutFallback: plan.fallbackUsed, selectedLineupPreserved: true, fallbackPreviewErrorCount: plan.selected.result.errorCount,
    finalStateLegal: true };
}

function verifyBuyerStrategyFixture() {
  const director = ctx.design.system.directors[0];
  const makeState = (label) => {
    const state = createRun({ runId: `buyer-fixture-${label}`, seed: 813, directorId: director.id }, ctx);
    reportByRun.set(state.runId, { directorId: director.id, purchases: [], shopObservations: [], upgradeObservations: [] });
    state.day = 2; state.hour = 5; state.phase = 'shop'; state.gold = 100;
    return state;
  };
  const offer = (piece, index) => ({ slotId: `buyer-fixture:${index}`, purchaseCharId: piece.purchaseCharId,
    charId: piece.charId, star: piece.star ?? 1, requiredCopies: 2 ** ((piece.star ?? 1) - 1),
    price: ctx.catalog.operators[piece.purchaseCharId].price * 2 ** ((piece.star ?? 1) - 1) });
  const putShop = (state, slots, kind = 'operator') => {
    state.shop = { id: kind === 'skill' ? 'shop_strategy' : 'shop_base', kind, slots,
      refreshCost: 1, refreshCount: 0, supplyVersion: 2 };
  };

  const two = makeState('two-buys');
  const twoHeld = two.pieces.filter((piece) => piece.row !== null && piece.col !== null);
  assert.ok(twoHeld.length >= 2, 'fixture needs two real deployed starter identities');
  putShop(two, twoHeld.slice(0, 2).map(offer));
  const twoResult = playShop(two);
  assert.equal(reportByRun.get(two.runId).purchases.filter((entry) => entry.action === 'buy').length, 2);
  for (const piece of twoHeld.slice(0, 2)) assert.equal(twoResult.pieces.find((next) => next.uid === piece.uid).star, piece.star + 1);
  assert.equal(reportByRun.get(two.runId).shopObservations[0].slots.length, 2);

  const held = makeState('held-priority');
  const leader = held.pieces.find((piece) => piece.purchaseCharId === director.leaderCharId);
  const outsider = Object.values(ctx.catalog.operators).filter((entry) => !held.pieces.some((piece) => piece.purchaseCharId === entry.purchaseCharId))
    .sort((a, b) => b.starStats[0].stats.atk / b.starStats[0].stats.bat - a.starStats[0].stats.atk / a.starStats[0].stats.bat)[0];
  assert.ok(outsider);
  putShop(held, [offer({ ...outsider, star: 1 }, 0), offer(leader, 1)]);
  reportByRun.get(held.runId).shopObservations.push({ shopId: held.shop.id, day: held.day, hour: held.hour, decisions: [] });
  const heldResult = buyOperator(held);
  assert.equal(reportByRun.get(held.runId).purchases[0].slot.purchaseCharId, leader.purchaseCharId);
  assert.equal(heldResult.pieces.find((piece) => piece.uid === leader.uid).star, leader.star + 1);
  assert.equal(reportByRun.get(held.runId).shopObservations[0].decisions.at(-1).reason, 'held-star-upgrade');

  const full = makeState('bench-full');
  const remaining = Object.values(ctx.catalog.operators).filter((entry) => !full.pieces.some((piece) => piece.purchaseCharId === entry.purchaseCharId));
  while (full.pieces.filter((piece) => piece.row === null || piece.col === null).length < ctx.design.system.run.benchSize) {
    const body = remaining.shift(); assert.ok(body); addBodyToInventory(full, ctx, body.charId, 1);
  }
  const unavailable = remaining.shift(); assert.ok(unavailable);
  putShop(full, [offer({ ...unavailable, star: 1 }, 0)]);
  const unchanged = structuredClone(full);
  assert.throws(() => applyAction(structuredClone(full), { type: 'buy', slotId: full.shop.slots[0].slotId,
    opId: 'buyer-fixture-native-bench', expectedRevision: full.revision }, ctx), { code: 'BENCH_FULL' });
  assert.strictEqual(buyOperator(full), full);
  assert.deepEqual(full, unchanged, 'failed native previews must preserve economy, bench and source pieces');

  const reserve = makeState('skill-reserve');
  const skill = ctx.design.system.strategySkills.find((entry) => entry.startingStar === 1 && entry.prices[0] === 5);
  assert.ok(skill);
  reserve.day = 1; reserve.hour = 2; reserve.gold = 13;
  const skillSlot = () => ({ slotId: 'buyer-fixture:skill', kind: 'skill', skillId: skill.id, star: 1, price: skill.prices[0] });
  putShop(reserve, [skillSlot()], 'skill');
  const first = buyUpgrade(reserve);
  assert.equal(first.gold, 8); assert.equal(first.skillRanks[skill.id], 1);
  putShop(first, [skillSlot()], 'skill');
  assert.strictEqual(buyUpgrade(first), first, 'owned strategy cannot consume the eight-gold operator reserve');
  const rich = structuredClone(first); rich.gold = 13;
  const allowed = buyUpgrade(rich);
  assert.equal(allowed.gold, 8); assert.equal(allowed.skillRanks[skill.id], 2);
  const firstOnly = makeState('first-five-gold');
  firstOnly.day = 1; firstOnly.hour = 2; firstOnly.gold = 5;
  putShop(firstOnly, [skillSlot()], 'skill');
  const firstOnlyResult = buyUpgrade(firstOnly);
  assert.equal(firstOnlyResult.gold, 0); assert.equal(firstOnlyResult.skillRanks[skill.id], 1);

  for (const hour of [4, 5]) {
    const laterDayOne = makeState(`day-one-${hour}`);
    laterDayOne.day = 1; laterDayOne.hour = hour;
    const actualLeader = laterDayOne.pieces.find((piece) => piece.purchaseCharId === director.leaderCharId);
    const definition = ctx.design.system.shopDefinitions.find((entry) => entry.unlockDay === 1
      && (entry.kind ?? 'operator') === 'operator' && entry.filter.type === 'none');
    assert.ok(definition);
    laterDayOne.shop = buildShopState(laterDayOne, ctx, definition.id, {
      excludePurchaseCharIds: Object.keys(ctx.catalog.operators).filter((id) => id !== actualLeader.purchaseCharId),
    });
    assert.equal(laterDayOne.shop.slots[0].purchaseCharId, actualLeader.purchaseCharId);
    playShop(laterDayOne);
    assert.equal(reportByRun.get(laterDayOne.runId).purchases.filter((entry) => entry.action === 'buy').length, 1,
      `a legal day-one hour-${hour} offer must be evaluated and bought`);
  }

  let freeUpgrade = makeState('free-operator-upgrade');
  const rewardDefinition = ctx.design.system.operatorUpgradeRewards?.[0];
  assert.ok(rewardDefinition, 'core must provide a real upgrade reward definition');
  const upgradeLeader = freeUpgrade.pieces.find((piece) => piece.purchaseCharId === director.leaderCharId);
  const golden = ctx.design.system.enchantments.find((entry) => entry.id === 'enchant_golden');
  assert.ok(golden);
  putShop(freeUpgrade, [{ slotId: 'buyer-fixture:golden', kind: 'enchantment', enchantmentId: golden.id,
    star: 1, price: golden.price }], 'enchantment');
  freeUpgrade = act(freeUpgrade, 'enchantPiece', { slotId: 'buyer-fixture:golden', uid: upgradeLeader.uid });
  freeUpgrade.xp = ctx.design.system.run.xpThresholds[rewardDefinition.tech - 1] - ctx.design.system.run.xpPerHour;
  putShop(freeUpgrade, []);
  freeUpgrade = act(freeUpgrade, 'finishShop');
  while (freeUpgrade.phase === 'skillChoice') {
    freeUpgrade = act(freeUpgrade, 'chooseSkill', { skillId: viewRun(freeUpgrade, ctx).skillRewards.choices[0] });
  }
  assert.equal(freeUpgrade.phase, 'upgradeChoice');
  const realChoices = viewRun(freeUpgrade, ctx).upgradeRewards.choices;
  assert.ok(realChoices.includes(upgradeLeader.uid));
  const beforeFreeUpgrade = structuredClone(freeUpgrade);
  const preserved = freeUpgrade.pieces.find((piece) => piece.uid === upgradeLeader.uid);
  const sharedProjection = operatorUpgradeProjection(preserved, ctx, rewardDefinition.maxStar);
  const freeResult = chooseOperatorUpgrade(freeUpgrade);
  const actualUpgraded = freeResult.pieces.find((piece) => piece.uid === preserved.uid);
  assert.equal(actualUpgraded.star, sharedProjection.star);
  for (const field of ['uid', 'charId', 'purchaseCharId', 'sourceCopies', 'enchantmentId', 'row', 'col', 'dir'])
    assert.deepEqual(actualUpgraded[field], preserved[field], `free upgrade preserves ${field}`);
  assert.equal(freeResult.gold, freeUpgrade.gold);
  assert.equal(freeResult.pieces.length, freeUpgrade.pieces.length);
  assert.deepEqual(freeUpgrade, beforeFreeUpgrade, 'upgrade previews must not mutate the real input');
  const upgradeObservation = reportByRun.get(freeUpgrade.runId).upgradeObservations.at(-1);
  assert.equal(upgradeObservation.chosenUid, preserved.uid, 'real eligible leader upgrade has priority');
  assert.ok(upgradeObservation.candidates.find((candidate) => candidate.uid === preserved.uid).gain > 0,
    'the selected native upgrade must improve a legal lineup, not only the bench');

  let marginal = makeState('upgrade-marginal-value');
  const marginalLeader = marginal.pieces.find((piece) => piece.purchaseCharId === director.leaderCharId);
  putShop(marginal, [offer(marginalLeader, 0)]);
  marginal = act(marginal, 'buy', { slotId: marginal.shop.slots[0].slotId });
  marginal.xp = ctx.design.system.run.xpThresholds[rewardDefinition.tech - 1] - ctx.design.system.run.xpPerHour;
  for (const piece of marginal.pieces.filter((entry) => entry.row === null || entry.col === null)) {
    const point = [...ctx.fieldFor(marginal).normalizedDeployMap.keys()].map((key) => key.split(',').map(Number))
      .find(([row, col]) => !marginal.pieces.some((entry) => entry.row === row && entry.col === col) && ctx.canPlace(marginal, piece, row, col));
    assert.ok(point);
    marginal = transition(marginal, 'place', { uid: piece.uid, row: point[0], col: point[1], dir: 'E' }, 'upgrade-fixture-native-place');
  }
  putShop(marginal, []);
  marginal = act(marginal, 'finishShop');
  while (marginal.phase === 'skillChoice') marginal = act(marginal, 'chooseSkill', { skillId: viewRun(marginal, ctx).skillRewards.choices[0] });
  assert.equal(marginal.phase, 'upgradeChoice');
  assert.ok(!viewRun(marginal, ctx).upgradeRewards.choices.includes(marginalLeader.uid), 'shared eligibility excludes the paid-upgraded leader');
  chooseOperatorUpgrade(marginal);
  const marginalObservation = reportByRun.get(marginal.runId).upgradeObservations.at(-1);
  assert.ok(marginalObservation.candidates.length >= 2);
  assert.ok(marginalObservation.candidates.every((candidate) => candidate.priority === 1));
  const selectedMarginal = marginalObservation.candidates.find((candidate) => candidate.uid === marginalObservation.chosenUid);
  assert.equal(selectedMarginal.gain, Math.max(...marginalObservation.candidates.map((candidate) => candidate.gain)),
    'equally deployed real reward candidates choose the highest native legal-lineup gain');
  const noChoices = structuredClone(beforeFreeUpgrade);
  noChoices.pendingUpgradeRewards[0].choices = [];
  const skipped = chooseOperatorUpgrade(noChoices);
  assert.ok(skipped.history.some((entry) => entry.kind === 'operatorUpgradeRewardSkipped'));
  assert.deepEqual(skipped.pieces, noChoices.pieces, 'empty-choice fixture does not invent an upgrade candidate');

  const telemetry = compactSettledStats({ units: Array.from({ length: 23 }, (_, index) => ({ uid: `fixture-${index}`,
    defId: 'fixture-body', dmg: 10, heal: 2, taken: 3, kills: 1, attacks: 4 })), leaks: [{ enemyKey: 'fixture-enemy', lpr: 2 }] });
  assert.equal(telemetry.unitCount, 23); assert.equal(telemetry.units.length, 22);
  assert.deepEqual(telemetry.units[0], ['fixture-0', 'fixture-body', 10, 2, 3, 1, 4]);
  assert.equal(telemetry.damageDealt, 230, 'aggregate damage retains all units beyond the compact detail limit');
  assert.deepEqual(telemetry.leaks, [['fixture-enemy', 2]]);
  assert.equal(compactSettledStats({}).leakIdentityKnown, false);

  // Reproduce attempt 8's native scene difference without running or settling a battle.
  const actualEncounter = ctx.design.encounters.encounters.find((entry) => entry.id === 'enc_band2_normal_a1m05');
  const initialEncounter = ctx.design.encounters.encounters.find((entry) => entry.kind === 'normal');
  assert.ok(actualEncounter && initialEncounter && actualEncounter.id !== initialEncounter.id);
  let mapped = makeState('different-native-map');
  mapped.phase = 'nodeChoice';
  mapped.nodeChoices = [{ id: 'buyer-map-fixture', kind: 'battle', encounterId: actualEncounter.id }];
  mapped = transition(mapped, 'selectNode', { nodeId: 'buyer-map-fixture' }, 'buyer-map-native-select');
  const mappedLeader = mapped.pieces.find((piece) => piece.purchaseCharId === director.leaderCharId);
  const oldMap = { ...structuredClone(mapped), currentNode: { kind: 'battle', encounterId: initialEncounter.id } };
  assert.ok(ctx.canPlace(mapped, mappedLeader, 9, 5));
  assert.equal(ctx.canPlace(oldMap, mappedLeader, 9, 5), false, 'the failure-shaped tile is illegal on first normal');
  const occupant = mapped.pieces.find((piece) => piece.uid !== mappedLeader.uid && piece.row === 9 && piece.col === 5);
  if (occupant) mapped = transition(mapped, 'bench', { uid: occupant.uid }, 'buyer-map-native-bench');
  mapped = transition(mapped, 'place', { uid: mappedLeader.uid, row: 9, col: 5, dir: 'E' }, 'buyer-map-native-place');
  mapped.phase = 'shop'; mapped.currentNode = { kind: 'shop', shopId: 'shop_base' };
  putShop(mapped, [offer(mapped.pieces.find((piece) => piece.uid === mappedLeader.uid), 0)]);
  assertLegalDeployment(mapped);
  const immutableMapped = structuredClone(mapped);
  assert.equal(buyerEncounterFor(mapped).id, actualEncounter.id);
  const mapValue = buyerLineupValue(mapped, buyerEncounterFor(mapped));
  assert.ok(mapValue.value > 0 && mapValue.selected.length > 0);
  assert.deepEqual(mapped, immutableMapped, 'evaluation keeps the source scene and coordinates unchanged');
  const wrongMap = { ...structuredClone(mapped), currentNode: { kind: 'battle', encounterId: initialEncounter.id } };
  assert.throws(() => assertLegalDeployment(wrongMap), /illegal placement/, 'an illegal source scene remains an error');
  const mappedPurchase = buyOperator(mapped);
  assert.notStrictEqual(mappedPurchase, mapped);
  assert.deepEqual(mapped, immutableMapped, 'native purchase evaluation does not mutate the input');
  assert.equal(mappedPurchase.prepEncounterId, actualEncounter.id);
  assert.deepEqual(mappedPurchase.currentNode, mapped.currentNode);
  const preservedLeader = mappedPurchase.pieces.find((piece) => piece.uid === mappedLeader.uid);
  assert.equal(preservedLeader.row, 9); assert.equal(preservedLeader.col, 5);
  return { sameShopLegalBuys: 2, mergedHeldPieces: 2, heldUpgradeFirst: true, nativeBenchFullRejected: true,
    failedPreviewsImmutable: true, firstStrategyPrice: 5, subsequentStrategyReserve: 8,
    firstStrategyWithOnlyFiveGold: true, shopObservationRecorded: true, differentNativeMap: {
      preparationEncounter: actualEncounter.id, firstNormalEncounter: initialEncounter.id, row: 9, col: 5,
      legalOnlyOnPreparationMap: true, immutableEvaluation: true, sourceCoordinatesPreserved: true },
    dayOneLaterShopsEvaluated: [4, 5], dayOneLaterShopsUseNativeSupply: true, realUpgradeRewardSelected: true,
    highestMarginalNativeUpgradeChosen: true, upgradePreservesSourceEnchantmentCoordinatesCopies: true,
    upgradeHasPositiveNativeLineupGain: true, emptyUpgradeChoiceSkipped: true, compactUnitDetailsLimit: 22,
    unitDamageAggregateUntruncated: true, unavailableLeakIdentityUnknown: true,
    fixturesOnly: true, realCampaignExecuted: false };
}

function verifyEventAcquisitionFixture() {
  const director = ctx.design.system.directors[0];
  const register = (state) => {
    reportByRun.set(state.runId, { directorId: director.id, purchases: [], shopObservations: [], eventObservations: [] });
    return state;
  };
  const naturallyOffered = (eventId, day) => {
    // Independent fixture seeds only; live acquisition never retries a node or outcome.
    for (let seed = 1; seed <= 256; seed += 1) {
      let state = createRun({ runId: `event-fixture-${eventId}-${seed}`, seed, directorId: director.id }, ctx);
      state.day = day; state.hour = 4; state.phase = 'shop'; state.xp = 0;
      state.shop = buildShopState(state, ctx, 'shop_strategy');
      state = previewAction(state, 'finishShop').state;
      if (previewNodes(state).some((node) => node.eventId === eventId)) return register(state);
    }
    throw new Error(`native fixture generation did not offer ${eventId}`);
  };
  const hat = naturallyOffered('evt_bazaar_hat', 6);
  const beforeHat = structuredClone(hat), commandsBefore = commandRows.length;
  const hiddenA = structuredClone(hat), hiddenB = structuredClone(hat);
  hiddenA.runId = 'event-fixture-hat-hidden-a'; hiddenB.runId = 'event-fixture-hat-hidden-b';
  hiddenB.rngState = (hiddenB.rngState ^ 0xa5a5a5a5) >>> 0;
  const hiddenDecisionA = chooseNode(hiddenA), hiddenDecisionB = chooseNode(hiddenB);
  assert.equal(hiddenDecisionA.id, hiddenDecisionB.id, 'identical public nodes choose identically across hidden RNG states');
  assert.equal(plannedEvents.get(hiddenA.runId)?.choiceId, plannedEvents.get(hiddenB.runId)?.choiceId,
    'event option choice cannot depend on hidden RNG');
  assert.equal(hiddenDecisionA.eventId, 'evt_bazaar_hat');
  plannedEvents.delete(hiddenA.runId); plannedEvents.delete(hiddenB.runId);
  const selectedHat = chooseNode(hat);
  assert.equal(selectedHat.eventId, 'evt_bazaar_hat');
  assert.deepEqual(hat, beforeHat); assert.equal(commandRows.length, commandsBefore);
  const openedHat = act(hat, 'selectNode', { nodeId: selectedHat.id });
  const publicHatView = viewRun(openedHat, ctx);
  const hatChoice = publicHatView.choices.find((choice) => choice.id === 'hat_enchant');
  const hiddenOpenedHat = structuredClone(openedHat);
  hiddenOpenedHat.rngState = (hiddenOpenedHat.rngState ^ 0x5a5a5a5a) >>> 0;
  assert.deepEqual(viewRun(hiddenOpenedHat, ctx).choices, publicHatView.choices,
    'fixture variants expose the same public event DTO');
  const hatEvaluation = evaluateEvent(openedHat), hiddenHatEvaluation = evaluateEvent(hiddenOpenedHat);
  assert.equal(hatEvaluation.best.choice.id, hiddenHatEvaluation.best.choice.id);
  assert.equal(hatEvaluation.best.value, hiddenHatEvaluation.best.value);
  const legalWeight = hatChoice.enchantmentOffer.options.reduce((sum, option) => sum + option.weight, 0);
  assert.ok(legalWeight > 0);
  assert.deepEqual(hatEvaluation.best.enchantmentOdds, hatChoice.enchantmentOffer.options.map((option) => ({
    enchantmentId: option.enchantmentId, probability: option.weight / legalWeight,
  })), 'expected benefit records only normalized public legal-option weights');
  assert.equal(hatEvaluation.best.expectedEnchantmentValue, 1000);
  const targetUid = hatChoice.enchantmentOffer.targetUid;
  const beforePiece = openedHat.pieces.find((piece) => piece.uid === targetUid);
  const afterHat = playEvent(openedHat);
  const afterPiece = afterHat.pieces.find((piece) => piece.uid === targetUid);
  assert.ok(afterPiece.enchantmentId);
  for (const field of ['uid', 'charId', 'purchaseCharId', 'star', 'sourceCopies', 'row', 'col', 'dir'])
    assert.deepEqual(afterPiece[field], beforePiece[field], `Hat preserves ${field}`);
  assert.equal(reportByRun.get(hat.runId).purchases.length, 0);
  const hatObservation = reportByRun.get(hat.runId).eventObservations.at(-1);
  assert.equal(hatObservation.status, 'confirmed'); assert.equal(hatObservation.cost.length, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(hatObservation)) <= 1024);
  const disabled = structuredClone(openedHat);
  for (const piece of disabled.pieces) piece.enchantmentId = 'enchant_golden';
  const beforeDisabled = structuredClone(disabled);
  assert.equal(evaluateEvent(disabled).best, null);
  assert.throws(() => previewAction(disabled, 'confirmEvent', { choiceId: 'hat_enchant' }), { code: 'NO_ENCHANTMENT_TARGET' });
  assert.deepEqual(disabled, beforeDisabled);

  let gold = naturallyOffered('evt_rogue6_unmanned', 8);
  gold.gold = 0;
  const goldNode = chooseNode(gold);
  assert.equal(goldNode.eventId, 'evt_rogue6_unmanned');
  const goldOpened = act(gold, 'selectNode', { nodeId: goldNode.id });
  const goldResult = playEvent(goldOpened);
  const goldObservation = reportByRun.get(gold.runId).eventObservations.at(-1);
  assert.ok(goldObservation.outcome.gold > 0); assert.ok(goldResult.gold > 0);
  const boundary = structuredClone(goldOpened); boundary.hour = ctx.design.system.run.hoursPerDay;
  const boundaryApplied = previewAction(boundary, 'confirmEvent', { choiceId: goldObservation.choiceId });
  const boundarySummary = eventOutcomeSummary(boundary, boundaryApplied);
  assert.equal(boundarySummary.gold, boundaryApplied.result.outcome.effects.filter((effect) => effect.kind === 'gold')
    .reduce((sum, effect) => sum + effect.amount, 0));
  assert.ok(boundaryApplied.state.gold - boundary.gold > boundarySummary.gold,
    'next-day native income is excluded from the event benefit');
  const shopNode = previewNodes(gold).find((node) => node.kind === 'shop');
  const beforeShopPreview = structuredClone(gold), beforeShopCommands = commandRows.length;
  assert.equal(shopHasLegalPurchase(gold, shopNode), false);
  assert.deepEqual(gold, beforeShopPreview); assert.equal(commandRows.length, beforeShopCommands);
  let heal = naturallyOffered('evt_rogue6_pixelcat', 8);
  heal.gold = 0; heal.life = 4;
  const healNode = chooseNode(heal);
  assert.equal(healNode.eventId, 'evt_rogue6_pixelcat');
  playEvent(act(heal, 'selectNode', { nodeId: healNode.id }));
  assert.ok(reportByRun.get(heal.runId).eventObservations.at(-1).outcome.hp > 0);

  const fixed = createRun({ runId: 'event-fixture-preserve-firsts', seed: 87, directorId: director.id }, ctx);
  register(fixed);
  fixed.phase = 'shop'; fixed.shop = buildShopState(fixed, ctx, 'shop_strategy');
  let firstStrategy = previewAction(fixed, 'finishShop').state;
  assert.equal(chooseNode(firstStrategy).shopId, 'shop_strategy');
  firstStrategy.day = 2; firstStrategy.hour = 3; firstStrategy.phase = 'shop'; firstStrategy.xp = 0;
  firstStrategy.shop = buildShopState(firstStrategy, ctx, 'shop_strategy');
  const firstEnchant = previewAction(firstStrategy, 'finishShop').state;
  assert.equal(chooseNode(firstEnchant).shopId, 'shop_enchant');

  let paid = naturallyOffered('evt_bazaar_botul', 6);
  paid.gold = 100; paid.pieces[0].enchantmentId = 'enchant_toxic';
  const paidNode = previewNodes(paid).find((node) => node.eventId === 'evt_bazaar_botul');
  const paidOpened = previewAction(paid, 'selectNode', { nodeId: paidNode.id }).state;
  const paidEvaluation = evaluateEvent(paidOpened);
  assert.equal(paidEvaluation.best, null);
  assert.ok(paidEvaluation.notEvaluated.some((choice) => choice.reason === 'paid-not-evaluated'));
  const targetEvent = ctx.design.events.events.find((event) => event.choices.some((choice) => choice.targeting?.mode === 'selectTeam'));
  const targetNode = naturallyOffered(targetEvent.id, Math.max(8, targetEvent.unlockDay));
  const targetOpened = previewAction(targetNode, 'selectNode', { nodeId: targetEvent.id }).state;
  assert.ok(evaluateEvent(targetOpened).notEvaluated.some((choice) => choice.reason === 'target-dependent'));
  const observations = [...reportByRun.values()].flatMap((report) => report.eventObservations ?? []);
  for (const observation of observations) assert.ok(Buffer.byteLength(JSON.stringify(observation)) <= 1024);
  for (const command of commandRows.filter((entry) => entry.type === 'confirmEvent'))
    assert.ok(Buffer.byteLength(JSON.stringify(command.result)) <= 1024);
  return { nativeGeneratedHatSelected: true, immutablePreviewWithoutRecordedPurchase: true,
    hiddenRngCannotChangePublicEventOrOptionDecision: true, hatUsesNormalizedPublicOptionWeights: true,
    nativeHatConfirmedPreservingIdentityStarCopiesCoordinates: true, unavailableHatFailsAtomically: true,
    freeGoldAndHealBeatUnaffordableShop: true, firstStrategyAndEnchantRoutesPreserved: true,
    paidBotulNotBlindlyBought: true, targetDependentChoicesRecorded: true, nextDayIncomeExcluded: true,
    shopPreviewImmutableWithoutRecordedPurchase: true, everyEventObservationAtMostOneKiB: true,
    eventObservationBytes: Buffer.byteLength(JSON.stringify(hatObservation)), fixturesOnly: true, realCampaignExecuted: false };
}

function verifyBrowserPlannerFixture() {
  const director = ctx.design.system.directors[0];
  const initial = createRun({ runId: 'browser-planner-fixture', seed: 991, directorId: director.id }, ctx);
  const visible = { runId: initial.runId, state: viewRun(initial, ctx) };
  const altered = structuredClone(visible);
  altered.state.rngState = (altered.state.rngState ^ 0xa5a5a5a5) >>> 0;
  altered.state.seed = (altered.state.seed ^ 0x5a5a5a5a) >>> 0;
  altered.state.history = [{ kind: 'futureHiddenOutcome', result: 'must-not-affect-planning' }];
  const first = browserPlannerReply({ requestId: 'a', view: visible }, new Map());
  const second = browserPlannerReply({ requestId: 'b', view: altered }, new Map());
  const stripRequest = ({ requestId, ...reply }) => reply;
  assert.deepEqual(stripRequest(first), stripRequest(second), 'hidden RNG/history changes cannot change a recommendation for the same public view');
  assert.equal(first.kind, 'click-node');
  assert.doesNotMatch(JSON.stringify(first), /rngState|seed|futureHiddenOutcome|outcome|result/i);
  assert.equal(browserPlannerReply({ requestId: 'bad', view: { runId: 'bad', state: {} } }, new Map()).code, 'INVALID_VIEW');

  const prepSource = createRun({ runId: 'browser-planner-layout-fixture', seed: 992, directorId: director.id }, ctx);
  const battleNode = prepSource.nodeChoices.find((entry) => entry.kind === 'battle');
  assert.ok(battleNode, 'fixture exposes a visible battle node');
  const prep = applyAction(prepSource, { type: 'selectNode', nodeId: battleNode.id,
    opId: 'browser-planner-fixture:select', expectedRevision: prepSource.revision }, ctx).state;
  assert.equal(prep.phase, 'battlePrep');
  const layoutReply = browserPlannerReply({ requestId: 'layout', view: { runId: prep.runId, state: viewRun(prep, ctx) } }, new Map());
  assert.equal(layoutReply.kind, 'place-sequence');
  assert.ok(layoutReply.previewCount > 0 && Array.isArray(layoutReply.operations));
  let replay = structuredClone(prep);
  for (let index = 0; index < layoutReply.operations.length; index += 1) {
    const operation = layoutReply.operations[index];
    replay = applyAction(replay, { ...operation, opId: `browser-planner-fixture:replay:${index}`,
      expectedRevision: replay.revision }, ctx).state;
    assertLegalDeployment(replay);
  }
  for (const placement of layoutReply.placements) {
    const piece = replay.pieces.find((entry) => entry.uid === placement.uid);
    assert.deepEqual(piece && { uid: piece.uid, row: piece.row, col: piece.col, dir: piece.dir }, placement);
  }
  return { hiddenRngInvariant: true, invalidViewVisible: true, plannerDoesNotExposeRng: true,
    battlePrepPreviewCount: layoutReply.previewCount, browserOperations: layoutReply.operations.length,
    legalFinalPlacements: layoutReply.placements.length, doesNotCreateOrSettleRun: true };
}

if (process.argv.includes('--browser-planner-fixture-only')) {
  try { process.stdout.write(JSON.stringify({ startedAt, endedAt: new Date().toISOString(), pid, fixture: verifyBrowserPlannerFixture() }) + '\n'); }
  catch (error) { process.stderr.write(`${error?.stack ?? error}\n`); process.exitCode = 1; }
  process.exit(process.exitCode ?? 0);
}

if (process.argv.includes('--browser-planner')) {
  try { await runBrowserPlanner(); }
  catch (error) { process.stderr.write(`${error?.stack ?? error}\n`); process.exitCode = 1; }
  process.exit(process.exitCode ?? 0);
}

if (process.argv.includes('--event-acquisition-fixture-only')) {
  try { process.stdout.write(JSON.stringify({ startedAt, endedAt: new Date().toISOString(), pid, fixture: verifyEventAcquisitionFixture() }) + '\n'); }
  catch (error) { process.stderr.write(`${error?.stack ?? error}\n`); process.exitCode = 1; }
  process.exit(process.exitCode ?? 0);
}

if (process.argv.includes('--buyer-fixture-only')) {
  try { process.stdout.write(JSON.stringify({ startedAt, endedAt: new Date().toISOString(), pid, fixture: verifyBuyerStrategyFixture() }) + '\n'); }
  catch (error) { process.stderr.write(`${error?.stack ?? error}\n`); process.exitCode = 1; }
  process.exit(process.exitCode ?? 0);
}

if (process.argv.includes('--route-fixture-only')) {
  try {
    process.stdout.write(JSON.stringify({ startedAt, endedAt: new Date().toISOString(), pid, fixture: verifyWalkRouteFixture() }) + '\n');
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
  if (process.exitCode) process.exit(process.exitCode);
  process.exit(0);
}

if (process.argv.includes('--unblockable-fixture-only')) {
  try {
    process.stdout.write(JSON.stringify({ startedAt, endedAt: new Date().toISOString(), pid, fixture: verifyUnblockableRouteFixture() }) + '\n');
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
  if (process.exitCode) process.exit(process.exitCode);
  process.exit(0);
}

if (process.argv.includes('--bench-reorder-fixture-only')) {
  try {
    process.stdout.write(JSON.stringify({ startedAt, endedAt: new Date().toISOString(), pid, fixture: verifyBenchReorderFixture() }) + '\n');
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
  if (process.exitCode) process.exit(process.exitCode);
  process.exit(0);
}

if (process.argv.includes('--full-capacity-fallback-fixture-only')) {
  try {
    process.stdout.write(JSON.stringify({ startedAt, endedAt: new Date().toISOString(), pid, fixture: verifyFullCapacityFallbackFixture() }) + '\n');
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
  if (process.exitCode) process.exit(process.exitCode);
  process.exit(0);
}

try {
  for (let index = 0; index < directorIds.length; index += 1) {
    const runId = `strategy-enchant-${directorIds[index]}-${seeds[index]}`;
    try { campaigns.push(runCampaign(directorIds[index], seeds[index])); }
    catch (error) {
      const partial = reportByRun.get(runId);
      if (partial && !campaigns.some((entry) => entry.runId === runId)) {
        partial.failure = { message: String(error?.message ?? error), code: error?.code ?? null,
          shortStack: String(error?.stack ?? '').split('\n').slice(0, 5).join('\n').slice(0, 1600) };
        partial.lastState = partial.lastState ?? null;
        partial.endedAt = new Date().toISOString();
        campaigns.push(partial);
      }
      throw error;
    }
    if (Date.now() > toolDeadlineMs) break;
  }
  if (!campaigns.some((run) => run.dayOneHourTwoStrategyPurchase) || !campaigns.some((run) => run.dayTwoPlusHourFourEnchantmentPurchase)) {
    throw new Error('required strategy day1/hour2 and enchant day>=2/hour4 purchase paths were not both observed');
  }
} catch (error) {
  campaigns.push({ failure: String(error?.message ?? error), failedAt: new Date().toISOString() });
  process.exitCode = 1;
}
const endedAt = new Date().toISOString();
  const attemptPass = campaigns.length === 3 && campaigns.every((run) => run.completed === true && run.hoursObserved >= 60 && run.nativeErrorCount === 0
  && run.dayOneHourTwoStrategyPurchase && run.dayTwoPlusHourFourEnchantmentPurchase && run.battles.every((battle) => battle.previewCount > 0 && battle.outcome.nativeErrorCount === 0));
const currentAttempt = { attempt: priorAttempts.length + 1, result: attemptPass ? 'PASS' : 'FAILED', startedAt, endedAt, pid,
  deadlineAt: new Date(toolDeadlineMs).toISOString(), sourceCommit, scopedStatus, campaigns, commandCount: commandRows.length,
  commands: commandRows.filter((row) => ['selectNode', 'buy', 'buySkill', 'chooseSkill', 'skipSkillReward', 'chooseUpgrade', 'skipUpgradeReward', 'enchantPiece', 'finishShop', 'readyBattle', 'settleBattle', 'chooseRelic', 'confirmEvent', 'leaveEvent'].includes(row.type))
    .slice(-240).map((row) => ({ runId: row.runId, day: row.day, hour: row.hour, phase: row.phase, shopId: row.shopId, type: row.type, result: row.result })) };
const result = { schema: 'assault-strategy-enchantment-campaign/v1', result: attemptPass ? 'PASS' : 'FAILED', latestAttempt: currentAttempt.attempt,
  sourceCommit, dataCounts: { shops: ctx.design.system.shopDefinitions.length, skills: ctx.design.system.strategySkills?.length ?? 0, enchantments: ctx.design.system.enchantments?.length ?? 0 },
  attempts: [...priorAttempts, currentAttempt] };
let json;
currentAttempt.receiptBytes = 0;
for (;;) {
  json = JSON.stringify(result) + '\n';
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes === currentAttempt.receiptBytes) break;
  currentAttempt.receiptBytes = bytes;
}
fs.writeFileSync(OUT, json);
fs.appendFileSync(LOG, ['\n', `attempt=${currentAttempt.attempt} result=${currentAttempt.result}`, `startedAt=${startedAt}`, `endedAt=${endedAt}`, `pid=${pid}`, `deadlineAt=${currentAttempt.deadlineAt}`, `sourceCommit=${sourceCommit}`, `scopedStatus=${scopedStatus || '(empty)'}`,
  `previewLayouts=${campaigns.reduce((sum, run) => sum + (run.battles ?? []).reduce((n, battle) => n + Number(battle.previewCount ?? 0), 0), 0)}`,
  ...campaigns.map((run) => run.failure ? `failure=${run.failure}` : `${run.directorId} completed=${run.completed} hours=${run.hoursObserved} day=${run.final.day} hour=${run.final.hour} life=${run.final.life} gold=${run.final.gold} battles=${run.battles.length} skillRanks=${JSON.stringify(run.skillRanks)} teamGrowth=${JSON.stringify(run.teamGrowth)} lifecycle=${run.lifecycleHistoryCount} nativeErrors=${run.nativeErrorCount}`),
  `receiptBytes=${currentAttempt.receiptBytes}`, `receipt=${OUT}`, `log=${LOG}`].join('\n') + '\n');
if (!attemptPass) process.exitCode = 1;
process.stdout.write(JSON.stringify({ startedAt, endedAt, pid, result: currentAttempt.result, sourceCommit, receiptBytes: currentAttempt.receiptBytes,
  reports: campaigns.map((run) => run.failure ? { failure: run.failure } : { directorId: run.directorId, completed: run.completed, hours: run.hoursObserved, day: run.final.day, hour: run.final.hour, life: run.final.life, battles: run.battles.length, previews: run.battles.reduce((n, battle) => n + battle.previewCount, 0), skillRanks: run.skillRanks, teamGrowth: run.teamGrowth, nativeErrors: run.nativeErrorCount, dayOneHourTwoStrategyPurchase: run.dayOneHourTwoStrategyPurchase, dayTwoPlusHourFourEnchantmentPurchase: run.dayTwoPlusHourFourEnchantmentPurchase }), receipt: OUT, log: LOG }) + '\n');
