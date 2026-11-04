import { codedError, nextUint32, normalizeSeed, pickWeighted, sampleWithoutReplacement, structurallyEqual } from './rng.js';
import { activePieceLimit, addBodyToInventory, applyPermanentEffect, assertInventory, bodyFor, clonePlain, defaultModuleFor, operatorFor, pieceFor, piecePopulationCost } from './inventory.js';
import { buildShopState, calculateSellPrice, refreshShopState, shopContext } from './shops.js';
import { chooseRewardRelic, collectibleById, queueBattleRelicChoice } from './rewards.js';
import { confirmEventChoice, eventForNode, leaveEvent, validateEventDesign } from './events.js';
import { applyRelicChoiceBonus, applyRelicRunEvent, relicEffectParams } from './relic-rules.js';
import { applyRunLifecycleEvent } from './run-lifecycle.js';
import { expireTemporaryEnhancements, validateTemporaryRun } from './temporary-enhancements.js';
import { expireTemporaryMaxLife, validateTemporaryMaxLife } from './temporary-player-enhancements.js';
import { effectiveEnchantmentId, expireTemporaryEnchantments, temporaryEnchantmentRecords } from './temporary-enchantments.js';
import { addSupply, generateHourlySupplies, supplyFor, validateSupplies } from './supplies.js';
import { applySupplySale } from './supply-sales.js';
import { expireTemporaryAbilityEnhancements, validateTemporaryAbilityRun } from './temporary-abilities.js';
import { eligibleOperatorUpgradePieces, enchantmentFor, isPieceEligibleForEnchantment, operatorUpgradeProjection, operatorUpgradeRewardDefinitions, skillRewardRank, strategySkillFor, validateSkillRank } from './upgrades.js';

const isInteger = (value) => Number.isInteger(value);
function requireContext(ctx) {
  if (!ctx?.catalog?.operators || !ctx?.catalog?.bodies || !ctx?.design?.system?.run || !ctx?.design?.events?.events || !ctx?.design?.collectibles?.items || !ctx?.design?.encounters?.encounters) {
    throw codedError('INVALID_CONTEXT', 'Assault rules require injected catalog and design plain objects');
  }
  validateEventDesign(ctx.design);
}

function validateRelicCounters(state) {
  const counters = state.relicCounters ?? {};
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) throw codedError('INVALID_RELIC_COUNTERS', 'relicCounters must be an object');
  for (const [key, value] of Object.entries(counters)) {
    if (!Number.isInteger(value) || value < 0 || (key === 'pierce-altar' && value > 10)) {
      throw codedError('INVALID_RELIC_COUNTERS', `Invalid relic counter ${key}`);
    }
  }
  state.relicCounters = { ...counters };
  return state.relicCounters;
}

function directorFor(ctx, directorId) {
  const director = ctx.design.system.directors.find((entry) => entry.id === directorId);
  if (!director) throw codedError('UNKNOWN_DIRECTOR', `Unknown director: ${directorId}`);
  return director;
}

function shopDefinitionFor(state, ctx, { exclude = [], general = false } = {}) {
  let available = ctx.design.system.shopDefinitions.filter((entry) => entry.unlockDay <= state.day && !exclude.includes(entry.id));
  const broad = entry => (!entry.kind || entry.kind === 'operator') && entry.filter?.type === 'none';
  if (general) available = available.filter(broad);
  if (!available.length) return null;
  const groups = entry => broad(entry) ? 'general' : !entry.kind || entry.kind === 'operator' ? 'specialist' : 'utility';
  const weights = ctx.design.system.shopSelectionWeights ?? { general: 60, specialist: 30, utility: 10 };
  const totals = {};
  for (const entry of available) totals[groups(entry)] = (totals[groups(entry)] ?? 0) + 1;
  const selected = pickWeighted(available.map((entry) => ({ entry, weight: (weights[groups(entry)] ?? 1) / totals[groups(entry)] })), state.rngState);
  state.rngState = selected.state >>> 0;
  return selected.value.entry;
}

function eventCandidate(state, ctx) {
  const available = ctx.design.events.events.filter((event) => {
    const conditions = event.conditions ?? {};
    return event.choices.some(choice => !(choice.costs?.length) && choice.outcomes.some(outcome => outcome.effects.length > 0))
      && event.unlockDay <= state.day
      && state.day >= (conditions.minDay ?? 1)
      && state.day <= (conditions.maxDay ?? 10)
      && (!(conditions.oncePerRun || !event.repeatable) || !state.visitedEvents.includes(event.id));
  });
  if (!available.length) return null;
  const selected = pickWeighted(available.map((entry) => ({ entry, weight: 1 })), state.rngState);
  state.rngState = selected.state >>> 0;
  return selected.value?.entry ?? null;
}

function supplyReward(state) {
  const pool=[{kind:'gold',amount:4,name:'整备资金'},{kind:'xp',amount:2,name:'作战心得'}];
  if(state.life<state.maxLife)pool.push({kind:'hp',amount:3,name:'医疗补给'});
  const picked=sampleWithoutReplacement(pool,1,state.rngState);state.rngState=picked.state>>>0;
  return {id:`reward:${state.day}:${state.hour}:${picked.values[0].kind}`,kind:'reward',name:picked.values[0].name,reward:picked.values[0]};
}

function makeEncounterNode(encounter) {
  return {
    id: encounter.id,
    kind: 'battle',
    encounterId: encounter.id,
    battleKind: encounter.kind,
    name: encounter.name,
    rewards: { gold: encounter.rewards.gold, xp: encounter.rewards.xp },
    boardRegion: encounter.boardRegion,
    stageId: encounter.stageId,
  };
}

function generateNodes(state, ctx, previous = []) {
  const run = ctx.design.system.run;
  const old = new Set(previous.map(node => node.id));
  if (state.day === 10 && state.hour === run.finalHour) {
    let finals = ctx.design.encounters.encounters.filter((entry) => entry.kind === 'final');
    if (finals.filter(entry => !old.has(entry.id)).length >= run.finalCandidates) finals=finals.filter(entry=>!old.has(entry.id));
    const picked = sampleWithoutReplacement(finals, run.finalCandidates, state.rngState);
    state.rngState = picked.state >>> 0;
    if (picked.values.length !== run.finalCandidates) throw codedError('INSUFFICIENT_FINALS', 'Not enough final encounters');
    return picked.values.map(makeEncounterNode);
  }
  if (run.mandatoryHours.includes(state.hour)) {
    let band = ctx.design.encounters.encounters.filter((entry) => entry.kind === 'normal' || entry.kind === 'risk')
      .filter((entry) => state.day >= entry.dayRange[0] && state.day <= entry.dayRange[1]);
    const fresh=band.filter(entry=>!old.has(entry.id));
    if(fresh.length>=run.previewChoicesPerHour&&['normal','risk'].every(kind=>fresh.some(e=>e.kind===kind)))band=fresh;
    const choices = [];
    let rngState = state.rngState;
    for (const kind of run.mandatoryChoiceKinds ?? ['normal', 'risk']) {
      const picked = sampleWithoutReplacement(band.filter((entry) => entry.kind === kind && !choices.includes(entry)), 1, rngState);
      if (picked.values.length !== 1) throw codedError('INSUFFICIENT_ENCOUNTERS', `Day ${state.day} has no ${kind} encounter choice`);
      choices.push(picked.values[0]);
      rngState = picked.state;
    }
    const extra = sampleWithoutReplacement(band.filter((entry) => !choices.includes(entry)), run.previewChoicesPerHour - choices.length, rngState);
    choices.push(...extra.values);
    state.rngState = extra.state >>> 0;
    if (choices.length !== run.previewChoicesPerHour) throw codedError('INSUFFICIENT_ENCOUNTERS', `Day ${state.day} does not have three encounter choices`);
    return choices.map(makeEncounterNode);
  }
  const fixedShopId = state.hour === 2 ? 'shop_strategy'
    : state.hour === 4 && state.day >= 2 ? 'shop_enchant' : null;
  const fixedShop = !previous.length && fixedShopId && ctx.design.system.shopDefinitions.find((entry) => entry.id === fixedShopId && entry.unlockDay <= state.day);
  const oldShops=previous.map(node=>node.shopId).filter(Boolean);
  const shop = fixedShop || shopDefinitionFor(state, ctx,{exclude:oldShops}) || shopDefinitionFor(state,ctx);
  const event = eventCandidate(state, ctx);
  if(!event)throw codedError('INVALID_CONTEXT','Supply requires a free event, including the repeatable rest stop');
  return [
    { id: `shop:${shop.id}:${state.day}:${state.hour}`, kind: 'shop', shopId: shop.id, name: shop.name },
    { id: event.id, kind: 'event', eventId: event.id, name: event.name },
    supplyReward(state),
  ];
}

function updateTech(state, ctx) {
  const previousTech = Number.isInteger(state.tech) ? state.tech : 1;
  let tech = 1;
  ctx.design.system.run.xpThresholds.forEach((threshold, index) => { if (state.xp >= threshold) tech = index + 1; });
  state.tech = tech;
  if (tech <= previousTech) return;
  state.pendingSkillRewards ??= [];
  state.pendingUpgradeRewards ??= [];
  state.claimed ??= [];
  const crossed = [
    ...(ctx.design.system.skillLevelRewards ?? []).map((reward) => ({ kind: 'skill', reward })),
    ...operatorUpgradeRewardDefinitions(ctx).map((reward) => ({ kind: 'operatorUpgrade', reward })),
  ].filter(({ reward }) => Number.isInteger(reward.tech) && reward.tech > previousTech && reward.tech <= tech)
    .sort((a, b) => a.reward.tech - b.reward.tech
      || (a.kind === b.kind ? a.reward.id.localeCompare(b.reward.id) : a.kind === 'skill' ? -1 : 1));
  for (const { kind, reward } of crossed) {
    const claim = `${kind === 'skill' ? 'skill-level-reward' : 'operator-upgrade-reward'}:${reward.id}`;
    if (state.claimed.includes(claim)) continue;
    state.claimed.push(claim);
    if (kind === 'skill') state.pendingSkillRewards.push({ id: reward.id, tech: reward.tech, star: reward.star, count: reward.count });
    else state.pendingUpgradeRewards.push({ id: reward.id, tech: reward.tech, maxStar: reward.maxStar, count: reward.count });
  }
}

function pendingRewardTech(reward, definitions) {
  if (Number.isInteger(reward?.tech)) return reward.tech;
  return definitions.find((entry) => entry.id === reward?.id)?.tech ?? Number.MAX_SAFE_INTEGER;
}

function activateGrowthReward(state, ctx) {
  if (state.phase !== 'nodeChoice' || state.completed || state.life <= 0) return;
  state.pendingSkillRewards ??= [];
  state.pendingUpgradeRewards ??= [];
  const skills = ctx.design.system.skillLevelRewards ?? [];
  const upgrades = operatorUpgradeRewardDefinitions(ctx);
  while (state.pendingSkillRewards.length || state.pendingUpgradeRewards.length) {
    const skillReward = state.pendingSkillRewards[0] ?? null;
    const upgradeReward = state.pendingUpgradeRewards[0] ?? null;
    const chooseSkill = skillReward && (!upgradeReward
      || pendingRewardTech(skillReward, skills) <= pendingRewardTech(upgradeReward, upgrades));
    if (chooseSkill) {
      const reward = skillReward;
      if (!Array.isArray(reward.choices)) {
        const candidates = (ctx.design.system.strategySkills ?? []).filter((skill) => {
          const rank = state.skillRanks?.[skill.id] ?? 0;
          return skill.startingStar <= reward.star && rank <= reward.star && rank < 4;
        });
        if (!candidates.length) {
          state.pendingSkillRewards.shift();
          state.gold += 4;
          state.history.push({ kind: 'skillRewardCompensated', id: reward.id, gold: 4, day: state.day, hour: state.hour });
          continue;
        }
        const picked = sampleWithoutReplacement(candidates, Math.min(reward.count, candidates.length), state.rngState);
        state.rngState = picked.state >>> 0;
        reward.choices = picked.values.map((skill) => skill.id);
      }
      state.phase = 'skillChoice';
      return;
    }
    const reward = upgradeReward;
    if (!Array.isArray(reward.choices)) {
      const candidates = eligibleOperatorUpgradePieces(state, reward.maxStar);
      if (!candidates.length) {
        state.pendingUpgradeRewards.shift();
        state.history.push({ kind: 'operatorUpgradeRewardEmpty', id: reward.id, day: state.day, hour: state.hour });
        continue;
      }
      const picked = sampleWithoutReplacement(candidates, Math.min(reward.count, candidates.length), state.rngState);
      state.rngState = picked.state >>> 0;
      reward.choices = picked.values.map((piece) => piece.uid);
    }
    state.phase = 'upgradeChoice';
    return;
  }
}

function nextHour(state, ctx, grantHourlyXp = true) {
  const { days, hoursPerDay, xpPerHour } = ctx.design.system.run;
  if (state.day === days && state.hour === hoursPerDay) {
    state.phase = 'ended';
    state.completed = false;
    state.pendingAdvance = false;
    return;
  }
  if (grantHourlyXp) state.xp += xpPerHour;
  state.hour += 1;
  if (state.hour > hoursPerDay) {
    state.day += 1;
    state.hour = 1;
    state.gold += ctx.design.system.run.dailyIncome;
  }
  state.currentNode = null;
  state.shop = null;
  state.currentEvent = null;
  state.currentBattle = null;
  state.rewardQueue = null;
  state.phase = 'nodeChoice';
  state.nodeRerollCount = 0;
  state.pendingAdvance = false;
  expireTemporaryEnhancements(state);
  expireTemporaryMaxLife(state);
  expireTemporaryEnchantments(state);
  expireTemporaryAbilityEnhancements(state);
  if (state.hour === 1) applyRunLifecycleEvent(state, ctx, 'dayStarted', { eventKey: `day:${state.day}:started` });
  applyRunLifecycleEvent(state, ctx, 'hourStarted', { eventKey: `hour:${state.day}:${state.hour}:started` });
  generateHourlySupplies(state, ctx, `hour:${state.day}:${state.hour}:started`);
  state.history.push({ kind: 'hourStarted', day: state.day, hour: state.hour, gold: state.gold, xp: state.xp });
  state.nodes = generateNodes(state, ctx);
  state.nodeChoices = state.nodes;
  applyRelicRunEvent(state, ctx, 'hourStarted', { day: state.day, hour: state.hour, gold: state.gold });
  updateTech(state, ctx);
  activateGrowthReward(state, ctx);
}

function settlementAdvance(state, ctx, outcome) {
  if (state.life <= 0) {
    state.life = 0;
    state.phase = 'ended';
    state.completed = false;
    return;
  }
  if (state.currentNode?.battleKind === 'final') {
    state.phase = 'ended';
    state.completed = outcome.victory === true && state.life > 0;
    return;
  }
  nextHour(state, ctx, false);
}

function requirePhase(state, phases) {
  if (!phases.includes(state.phase)) throw codedError('INVALID_PHASE', `Action is unavailable during phase ${state.phase}`);
}

function validateCoordinates(row, col) {
  if (!isInteger(row) || !isInteger(col) || row < 9 || row > 12 || col < 2 || col > 10) throw codedError('INVALID_TILE', 'Deployment coordinates must be within rows 9..12 and columns 2..10');
}

function callCanPlace(ctx, state, piece, row, col) {
  validateCoordinates(row, col);
  if (typeof ctx.canPlace === 'function' && !ctx.canPlace(state, piece, row, col)) {
    throw codedError('INVALID_TILE', 'Tile is not deployable on the current preparation map');
  }
  if (typeof ctx.canPlace !== 'function' && state.prepEncounterId) throw codedError('NOT_AVAILABLE', 'Encounter map placement callback is required');
  const occupied = state.pieces.some((entry) => entry.uid !== piece.uid && entry.row === row && entry.col === col);
  if (occupied) throw codedError('TILE_OCCUPIED', 'Another operator occupies this tile');
}

// Keep saved prep coordinates on the selected native field. The context callback
// is the authority for stage and class legality; this routine only finds a free
// coordinate within the run's deployment region.
export function reconcileRunDeployments(state, ctx) {
  if (state.currentNode?.kind !== 'battle' || typeof ctx.canPlace !== 'function') return [];
  const candidates = [];
  const changes = [];
  for (let row = 9; row <= 12; row += 1) for (let col = 2; col <= 10; col += 1) candidates.push([row, col]);
  const taken = new Set();
  const preserved = new Set();
  const keyOf = (row, col) => `${row},${col}`;
  const legalBody = (piece, row, col) => isInteger(row) && isInteger(col)
    && !taken.has(keyOf(row, col)) && ctx.canPlace(state, piece, row, col);
  // Reserve placements that remain legal first, so later pieces never displace them.
  const wasDeployed = new Set(state.pieces.filter((piece) => piece.row != null || piece.col != null).map((piece) => piece.uid));
  for (const piece of state.pieces) {
    if (!wasDeployed.has(piece.uid)) continue;
    if (piece.row == null || piece.col == null || !legalBody(piece, piece.row, piece.col)) continue;
    taken.add(keyOf(piece.row, piece.col));
    preserved.add(piece.uid);
  }
  for (const piece of state.pieces) {
    if (!wasDeployed.has(piece.uid)) continue;
    if (preserved.has(piece.uid)) continue;
    const oldRow = piece.row, oldCol = piece.col;
    piece.row = null;
    piece.col = null;
    const spot = candidates.find(([row, col]) => legalBody(piece, row, col));
    if (spot) {
      [piece.row, piece.col] = spot;
      taken.add(keyOf(piece.row, piece.col));
    }
    if (oldRow !== piece.row || oldCol !== piece.col) changes.push({ kind: 'piece', uid: piece.uid, from: { row: oldRow, col: oldCol }, to: { row: piece.row, col: piece.col } });
  }
  for (const piece of state.pieces) for (let index = 0; index < (piece.summonPresets ?? []).length; index += 1) {
    const preset = piece.summonPresets[index];
    if (!preset) continue;
    const occupies=ctx.summonOccupiesTile?.(state,piece,preset)??true;
    const legalSummon = (row, col) => isInteger(row) && isInteger(col) && (!occupies||!taken.has(keyOf(row, col)))
      && typeof ctx.canPlaceSummon === 'function'
      && ctx.canPlaceSummon(state, piece, row, col, preset);
    if (legalSummon(preset.row, preset.col)) {
      if(occupies)taken.add(keyOf(preset.row, preset.col));
      continue;
    }
    // A manual coordinate is an instruction. Keep it even when the new field
    // makes it unavailable; the preparation view shows it invalid until edited.
  }
  return changes;
}

function useAction(state, action, ctx) {
  if (action.type === 'rerollNodes') {
    requirePhase(state, ['nodeChoice']);
    const rules = ctx.design.system.nodeReroll ?? { cost: 2, maxPerHour: 1 };
    const count = state.nodeRerollCount ?? 0;
    if (count >= rules.maxPerHour) throw codedError('NODE_REROLL_LIMIT', 'No node rerolls left this hour');
    if (state.gold < rules.cost) throw codedError('INSUFFICIENT_GOLD', 'Not enough gold to reroll nodes');
    state.gold -= rules.cost;
    state.nodeRerollCount = count + 1;
    state.nodes = generateNodes(state, ctx, state.nodes);
    state.nodeChoices = state.nodes;
    state.history.push({ kind: 'nodesRerolled', day: state.day, hour: state.hour, cost: rules.cost });
    return { rerolled: true, cost: rules.cost };
  }
  if (action.type === 'selectNode') {
    requirePhase(state, ['nodeChoice']);
    const node = state.nodeChoices.find((entry) => entry.id === action.nodeId);
    if (!node) throw codedError('UNKNOWN_NODE', `Node is not in current preview: ${action.nodeId}`);
    state.currentNode = clonePlain(node);
    applyRunLifecycleEvent(state, ctx, 'nodeEntered', { eventKey: `action:${action.opId}:nodeEntered`, nodeKind: node.kind });
    if (node.kind === 'battle') state.prepEncounterId = node.encounterId;
    reconcileRunDeployments(state, ctx);
    if (node.kind === 'shop') {
      state.shop = buildShopState(state, ctx, node.shopId);
      state.phase = 'shop';
      applyRunLifecycleEvent(state, ctx, 'shopEntered', { eventKey: `action:${action.opId}:shopEntered` });
      applyRunLifecycleEvent(state, ctx, 'shopCardsDealt', { eventKey: `action:${action.opId}:cards` });
    } else if (node.kind === 'event') {
      state.currentEvent = eventForNode(state, ctx, node.eventId);
      state.phase = 'event';
    } else if (node.kind === 'battle') state.phase = 'battlePrep';
    else if(node.kind==='reward') {
      const reward=node.reward;
      if(reward.kind==='gold')state.gold+=reward.amount;
      else if(reward.kind==='xp')state.xp+=reward.amount;
      else if(reward.kind==='hp')state.life=Math.min(state.maxLife,state.life+reward.amount);
      else throw codedError('UNKNOWN_NODE_KIND',`Unknown supply reward: ${reward.kind}`);
      state.history.push({kind:'supplyRewardClaimed',day:state.day,hour:state.hour,reward:clonePlain(reward)});
      nextHour(state,ctx);
      return {selected:node.id,reward:clonePlain(reward),phase:state.phase};
    }
    else throw codedError('UNKNOWN_NODE_KIND', `Unknown node kind: ${node.kind}`);
    return { selected: node.id, phase: state.phase };
  }
  if (action.type === 'buySupply') {
    requirePhase(state, ['shop']);
    if (state.shop.kind !== 'supply') throw codedError('WRONG_SHOP_KIND', 'Supply purchases require a supply merchant');
    const offer = state.shop.slots.find(slot => slot.slotId === action.slotId && slot.kind === 'supply');
    if (!offer) throw codedError('UNKNOWN_SHOP_SLOT', 'Unknown supply offer');
    if (state.gold < offer.price) throw codedError('INSUFFICIENT_GOLD', 'Not enough gold');
    const bought = addSupply(state, ctx, offer.itemId, offer.star);
    state.gold -= offer.price;
    state.shop.slots = state.shop.slots.filter(slot => slot.slotId !== offer.slotId);
    applyRunLifecycleEvent(state, ctx, 'buy', { eventKey: `action:${action.opId}:buy`, transaction: { ...bought, kind: 'supply', sourceCopies: 1 } });
    return { uid: bought.uid, itemId: bought.itemId, star: bought.star, price: offer.price };
  }
  if (action.type === 'sellSupply') {
    requirePhase(state, ['shop', 'event', 'battlePrep', 'nodeChoice']);
    const sold = state.supplies?.find(item => item.uid === action.uid);
    if (!sold) throw codedError('UNKNOWN_SUPPLY', 'Unknown owned supply');
    const item = supplyFor(ctx, sold.itemId), price = item?.sellPrices?.[sold.star - 1];
    if (!Number.isSafeInteger(price) || price < 0) throw codedError('INVALID_SUPPLY_PRICE', 'Invalid supply sale price');
    state.supplies = state.supplies.filter(item => item.uid !== sold.uid);
    state.gold += price;
    const effect = applySupplySale(state, ctx, sold, `action:${action.opId}:sell`);
    applyRunLifecycleEvent(state, ctx, 'sell', { eventKey: `action:${action.opId}:sell`, transaction: { ...sold, kind: 'supply', sourceCopies: 1 } });
    return { uid: sold.uid, itemId: sold.itemId, price, ...effect };
  }
  if (action.type === 'buy') {
    requirePhase(state, ['shop']);
    const offer = state.shop.slots.find((slot) => slot.slotId === action.slotId);
    if (!offer) throw codedError('UNKNOWN_SHOP_SLOT', `Unknown shop slot: ${action.slotId}`);
    if (state.shop.kind && state.shop.kind !== 'operator' && offer.kind!=='operator') throw codedError('WRONG_SHOP_KIND', 'This shop slot is not an operator');
    if (state.gold < offer.price) throw codedError('INSUFFICIENT_GOLD', 'Not enough gold to buy this operator');
    const owned = state.pieces.filter((piece) => piece.purchaseCharId === offer.purchaseCharId).reduce((sum, piece) => sum + piece.sourceCopies, 0);
    if (owned + offer.requiredCopies > ctx.design.system.run.sourceCapPerBody) throw codedError('SOURCE_CAP', 'Purchase would exceed the eight-copy cap');
    const heldUids=state.pieces.map(piece=>piece.uid);
    const targetState = { ...state, pieces: clonePlain(state.pieces), nextPieceId: state.nextPieceId };
    const receiver = addBodyToInventory(targetState, ctx, offer.charId, offer.requiredCopies, { star: offer.star, row: null, col: null });
    state.gold -= offer.price;
    state.pieces = targetState.pieces;
    state.nextPieceId = targetState.nextPieceId;
    state.shop.slots = state.shop.slots.filter((slot) => slot.slotId !== offer.slotId);
    const transaction = { ...receiver, kind:'operator', profession: operatorFor(ctx, receiver.purchaseCharId).profession };
    applyRunLifecycleEvent(state, ctx, 'buy', { eventKey: `action:${action.opId}:buy`, transaction, heldUids });
    if (receiver.star > offer.star) {
      applyRunLifecycleEvent(state, ctx, 'upgrade', { eventKey: `action:${action.opId}:upgrade`, transaction: receiver });
    }
    return { purchaseCharId: offer.purchaseCharId, charId: offer.charId, star: offer.star, price: offer.price };
  }
  if (action.type === 'refreshShop') {
    requirePhase(state, ['shop']);
    const refreshed = refreshShopState(state, ctx);
    Object.assign(state, refreshed);
    applyRunLifecycleEvent(state, ctx, 'shopCardsDealt', { eventKey: `action:${action.opId}:cards` });
    return { refreshed: true, refreshCost: state.shop.refreshCost, refreshCount: state.shop.refreshCount };
  }
  if (action.type === 'buySkill') {
    requirePhase(state, ['shop']);
    if (state.shop.kind !== 'skill') throw codedError('WRONG_SHOP_KIND', 'Strategy skills can only be purchased from their shop');
    const slot = state.shop.slots.find((entry) => entry.slotId === action.slotId && entry.kind === 'skill');
    if (!slot) throw codedError('UNKNOWN_SHOP_SLOT', `Unknown skill slot: ${action.slotId}`);
    const skill = strategySkillFor(ctx, slot.skillId);
    if (!skill) throw codedError('UNKNOWN_STRATEGY_SKILL', `Unknown strategy skill: ${slot.skillId}`);
    if (state.gold < slot.price) throw codedError('INSUFFICIENT_GOLD', 'Not enough gold to buy this skill');
    const current = state.skillRanks?.[slot.skillId] ?? 0;
    validateSkillRank(slot.star);
    if (current === 0) {
      if (slot.star < skill.startingStar) throw codedError('SKILL_BELOW_STARTING_RANK', 'Offered rank is below this skill’s starting rank');
      state.skillRanks ??= {};
      state.skillRanks[slot.skillId] = slot.star;
    } else {
      validateSkillRank(current);
      if (current >= 4 || slot.star !== current) throw codedError('SKILL_RANK_MISMATCH', 'Skill offer must match its current rank');
      state.skillRanks[slot.skillId] = current + 1;
    }
    state.gold -= slot.price;
    state.shop.slots = state.shop.slots.filter((entry) => entry.slotId !== slot.slotId);
    const transaction = { skillId: slot.skillId, star: state.skillRanks[slot.skillId] };
    applyRunLifecycleEvent(state, ctx, 'skillBought', { eventKey: `action:${action.opId}:skillBought`, transaction });
    if (current > 0) applyRunLifecycleEvent(state, ctx, 'skillUpgraded', { eventKey: `action:${action.opId}:skillUpgraded`, transaction });
    return { skillId: slot.skillId, previousRank: current || null, rank: state.skillRanks[slot.skillId], price: slot.price };
  }
  if (action.type === 'enchantPiece') {
    requirePhase(state, ['shop']);
    if (state.shop.kind !== 'enchantment') throw codedError('WRONG_SHOP_KIND', 'Enchantments can only be purchased from their shop');
    const slot = state.shop.slots.find((entry) => entry.slotId === action.slotId && entry.kind === 'enchantment');
    if (!slot) throw codedError('UNKNOWN_SHOP_SLOT', `Unknown enchantment slot: ${action.slotId}`);
    const piece = pieceFor(state, action.uid);
    const enchantment = enchantmentFor(ctx, slot.enchantmentId);
    if (!enchantment || !isPieceEligibleForEnchantment(piece, ctx, enchantment)) throw codedError('ENCHANTMENT_INELIGIBLE', 'This piece is not eligible for the enchantment');
    if (piece.enchantmentId === enchantment.id) throw codedError('ENCHANTMENT_ALREADY_APPLIED', 'This piece already has that enchantment');
    if (state.gold < slot.price) throw codedError('INSUFFICIENT_GOLD', 'Not enough gold to buy this enchantment');
    state.gold -= slot.price;
    piece.enchantmentId = enchantment.id;
    state.shop.slots = state.shop.slots.filter((entry) => entry.slotId !== slot.slotId);
    applyRunLifecycleEvent(state, ctx, 'buy', { eventKey: `action:${action.opId}:enchant`, transaction: piece });
    return { uid: piece.uid, enchantmentId: enchantment.id, price: slot.price };
  }
  if (action.type === 'finishShop') {
    requirePhase(state, ['shop']);
    state.history.push({ kind: 'shopFinished', day: state.day, hour: state.hour, shopId: state.shop.id });
    nextHour(state, ctx);
    return { finished: true, day: state.day, hour: state.hour, phase: state.phase };
  }
  if (action.type === 'sell') {
    requirePhase(state, ['shop', 'event', 'battlePrep', 'nodeChoice']);
    const piece = pieceFor(state, action.uid);
    const sold = clonePlain(piece);
    const price = calculateSellPrice(piece, ctx, state);
    state.gold += price;
    state.pieces = state.pieces.filter((entry) => entry.uid !== piece.uid);
    applyRunLifecycleEvent(state, ctx, 'sell', { eventKey: `action:${action.opId}:sell`, transaction: sold });
    return { uid: piece.uid, price, sourceCopies: piece.sourceCopies };
  }
  if (action.type === 'place' || action.type === 'bench' || action.type === 'changeDir') {
    requirePhase(state, ['nodeChoice', 'shop', 'event', 'battlePrep']);
    const piece = pieceFor(state, action.uid);
    if (action.type === 'place') {
      if (!['N', 'E', 'S', 'W'].includes(action.dir)) throw codedError('INVALID_DIRECTION', `Unknown direction: ${action.dir}`);
      callCanPlace(ctx, state, piece, action.row, action.col);
      piece.row = action.row;
      piece.col = action.col;
      piece.dir = action.dir;
    } else if (action.type === 'bench') {
      piece.row = null;
      piece.col = null;
    } else {
      if (!['N', 'E', 'S', 'W'].includes(action.dir)) throw codedError('INVALID_DIRECTION', `Unknown direction: ${action.dir}`);
      piece.dir = action.dir;
    }
    assertInventory(state.pieces, ctx, state.xp);
    return { uid: piece.uid, row: piece.row, col: piece.col, dir: piece.dir };
  }
  if (action.type === 'changeForm') {
    requirePhase(state, ['nodeChoice', 'shop', 'event', 'battlePrep']);
    const piece = pieceFor(state, action.uid);
    const operator = operatorFor(ctx, piece.purchaseCharId);
    const validForms = new Set([piece.purchaseCharId, ...(operator.extraForms ?? [])]);
    if (!validForms.has(action.charId)) throw codedError('FORM_NOT_OWNED', `Form is not owned by this identity: ${action.charId}`);
    const target = bodyFor(ctx, action.charId);
    if (piece.enchantmentId && !isPieceEligibleForEnchantment({ ...piece, charId: action.charId }, ctx, piece.enchantmentId))
      throw codedError('FORM_INVALIDATES_ENCHANTMENT', 'This form is incompatible with the piece’s enchantment');
    let row = piece.row;
    let col = piece.col;
    if (row !== null && col !== null) {
      const wantedRow = action.row ?? row;
      const wantedCol = action.col ?? col;
      try { callCanPlace(ctx, state, { ...piece, charId: action.charId }, wantedRow, wantedCol); }
      catch (error) {
        if (error.code === 'INVALID_TILE' && action.row === undefined && action.col === undefined) throw codedError('FORM_REQUIRES_REPOSITION', 'New form cannot occupy this tile; specify a legal tile or bench the piece first');
        throw error;
      }
      row = wantedRow;
      col = wantedCol;
    } else if (action.row !== undefined || action.col !== undefined) {
      callCanPlace(ctx, state, piece, action.row, action.col);
      row = action.row;
      col = action.col;
    }
    piece.forms = [...new Set([...(piece.forms ?? []), action.charId])];
    piece.charId = target.charId;
    piece.row = row;
    piece.col = col;
    piece.moduleChoices[action.charId] ??= defaultModuleFor(ctx, action.charId, piece.star);
    assertInventory(state.pieces, ctx, state.xp);
    return { uid: piece.uid, charId: piece.charId, row, col };
  }
  if (action.type === 'chooseModule') {
    requirePhase(state, ['nodeChoice', 'shop', 'event', 'battlePrep']);
    const piece = pieceFor(state, action.uid);
    const body = bodyFor(ctx, piece.charId);
    const plan = body.modulePlans?.find((module) => module.id === action.moduleId && (module.type === 'ADVANCED' || module.unlockStar));
    if (!plan || piece.star < (plan.translation?.unlockStar ?? plan.unlockStar ?? 3)) throw codedError('MODULE_LOCKED', `Advanced module is unavailable: ${action.moduleId}`);
    piece.moduleChoices[piece.charId] = action.moduleId;
    // a module can change the piece's population cost (a cost-0 module back to the default costs 1): never leave the board over the cap
    assertInventory(state.pieces, ctx, state.xp);
    return { uid: piece.uid, charId: piece.charId, moduleId: action.moduleId };
  }
  if (action.type === 'setSummonPreset') {
    requirePhase(state, ['nodeChoice', 'shop', 'event', 'battlePrep']);
    const piece = pieceFor(state, action.uid);
    piece.summonPresets??=[];
    const allowedFields = new Set(['type', 'uid', 'opId', 'expectedRevision', 'index', 'summonId', 'tokenId', 'row', 'col', 'dir', 'slot', 'remove']);
    for (const key of Object.keys(action)) if (!allowedFields.has(key)) throw codedError('UNKNOWN_SUMMON_PRESET_FIELD', `Unknown summon preset field: ${key}`);
    if(action.remove===true) {
      if(!Number.isInteger(action.index)||action.index<0||action.index>=12)throw codedError('INVALID_SUMMON_PRESET','Invalid summon preset index');
      piece.summonPresets[action.index]=null;
      return {uid:piece.uid,index:action.index,preset:null};
    }
    if (action.row !== undefined || action.col !== undefined) {
      validateCoordinates(action.row, action.col);
      if (typeof ctx.canPlaceSummon === 'function' && !ctx.canPlaceSummon(state, piece, action.row, action.col, action)) throw codedError('INVALID_TILE', 'Summon preset tile is not deployable');
      if (typeof ctx.canPlaceSummon !== 'function' && state.currentNode?.kind === 'battle') throw codedError('NOT_AVAILABLE', 'Encounter summon placement callback is required');
    }
    const preset = { ...action };
    delete preset.type;
    delete preset.opId;
    delete preset.expectedRevision;
    const index = Number.isInteger(action.index) ? action.index : 0;
    if (index < 0 || index >= 12) throw codedError('INVALID_SUMMON_PRESET', 'Summon preset index must be from 0 to 11');
    piece.summonPresets[index] = preset;
    return { uid: piece.uid, index, preset };
  }
  if (action.type === 'confirmEvent') {
    requirePhase(state, ['event']);
    const result = confirmEventChoice(state, ctx, action);
    if (state.pendingAdvance && state.phase === 'event-resolved') nextHour(state, ctx);
    return result;
  }
  if (action.type === 'leaveEvent') {
    requirePhase(state, ['event']);
    const result = action.free_leave_choice_id
      ? confirmEventChoice(state, ctx, { choiceId: action.free_leave_choice_id })
      : leaveEvent(state, ctx);
    if (state.pendingAdvance && state.phase === 'event-resolved') nextHour(state, ctx);
    return result;
  }
  if (action.type === 'chooseRelic') {
    requirePhase(state, ['rewards']);
    const acquired = chooseRewardRelic(state, ctx, action.relicId);
    applyRelicRunEvent(state, ctx, 'purchase', { acquisition: true, relicId: action.relicId, source: 'relicAcquisition' });
    if (state.pendingAdvance) nextHour(state, ctx, false);
    else state.phase = 'battlePrep';
    return acquired;
  }
  if (action.type === 'chooseSkill') {
    requirePhase(state, ['skillChoice']);
    const reward = state.pendingSkillRewards?.[0];
    if (!reward || !reward.choices?.includes(action.skillId)) throw codedError('UNKNOWN_SKILL_REWARD_CHOICE', 'Skill is not in the active reward choices');
    const skill = strategySkillFor(ctx, action.skillId);
    if (!skill || skill.startingStar > reward.star) throw codedError('INVALID_SKILL_REWARD', 'Skill is not eligible for this reward');
    const current = state.skillRanks?.[skill.id] ?? 0;
    const rank = skillRewardRank(current, reward.star);
    state.skillRanks ??= {};
    state.skillRanks[skill.id] = rank;
    if (current > 0 && rank > current) {
      applyRunLifecycleEvent(state, ctx, 'skillUpgraded', {
        eventKey: `action:${action.opId}:skillUpgraded`, transaction: { skillId: skill.id, star: rank },
      });
    }
    state.pendingSkillRewards.shift();
    state.history.push({ kind: 'skillRewardChosen', id: reward.id, skillId: skill.id, previousRank: current || null, rank, day: state.day, hour: state.hour });
    state.phase = 'nodeChoice';
    activateGrowthReward(state, ctx);
    return { skillId: skill.id, previousRank: current || null, rank, free: true };
  }
  if (action.type === 'skipSkillReward') {
    requirePhase(state, ['skillChoice']);
    const reward = state.pendingSkillRewards?.shift();
    if (!reward) throw codedError('NO_SKILL_REWARD', 'There is no active skill reward');
    state.history.push({ kind: 'skillRewardSkipped', id: reward.id, day: state.day, hour: state.hour });
    state.phase = 'nodeChoice';
    activateGrowthReward(state, ctx);
    return { skipped: reward.id };
  }
  if (action.type === 'chooseUpgrade') {
    requirePhase(state, ['upgradeChoice']);
    const reward = state.pendingUpgradeRewards?.[0];
    if (!reward || !Array.isArray(reward.choices) || !reward.choices.includes(action.uid)) {
      throw codedError('UNKNOWN_UPGRADE_REWARD_CHOICE', 'Piece is not in the active upgrade reward choices');
    }
    const piece = pieceFor(state, action.uid);
    const fromStar = piece.star;
    const projected = operatorUpgradeProjection(piece, ctx, reward.maxStar);
    const toStar = projected.star;
    Object.assign(piece, projected);
    assertInventory(state.pieces, ctx, state.xp);
    applyRunLifecycleEvent(state, ctx, 'upgrade', {
      eventKey: `action:${action.opId}:operatorUpgradeReward`, transaction: piece,
    });
    state.pendingUpgradeRewards.shift();
    state.history.push({ kind: 'operatorUpgradeRewardChosen', id: reward.id, uid: piece.uid, fromStar, star: toStar, day: state.day, hour: state.hour });
    state.phase = 'nodeChoice';
    activateGrowthReward(state, ctx);
    return { uid: piece.uid, fromStar, star: toStar, free: true };
  }
  if (action.type === 'skipUpgradeReward') {
    requirePhase(state, ['upgradeChoice']);
    const reward = state.pendingUpgradeRewards?.shift();
    if (!reward) throw codedError('NO_UPGRADE_REWARD', 'There is no active operator upgrade reward');
    state.history.push({ kind: 'operatorUpgradeRewardSkipped', id: reward.id, day: state.day, hour: state.hour });
    state.phase = 'nodeChoice';
    activateGrowthReward(state, ctx);
    return { skipped: reward.id };
  }
  if (action.type === 'readyBattle') {
    requirePhase(state, ['battlePrep']);
    validateRelicCounters(state);
    if (state.currentNode?.kind !== 'battle') throw codedError('NO_BATTLE_NODE', 'Current node is not a battle');
    if (typeof ctx.prepareBattle !== 'function') throw codedError('NOT_AVAILABLE', 'ctx.prepareBattle is required to prepare a trusted battle');
    const encounter = ctx.design.encounters.encounters.find((entry) => entry.id === state.currentNode.encounterId);
    if (!encounter) throw codedError('UNKNOWN_ENCOUNTER', `Unknown encounter: ${state.currentNode.encounterId}`);
    // the battle only ever starts with a team inside the deployment cap (the same rule every placement is checked against)
    assertInventory(state.pieces, ctx, state.xp);
    for (const piece of state.pieces.filter((entry) => entry.row !== null && entry.col !== null)) {
      if (typeof ctx.canPlace !== 'function') throw codedError('NOT_AVAILABLE', 'ctx.canPlace is required before battle preparation');
      if (!ctx.canPlace(state, piece, piece.row, piece.col)) throw codedError('INVALID_TILE', `Piece ${piece.uid} is on an illegal tile`);
    }
    const battleSeed = state.rngState >>> 0;
    const roll = nextUint32(state.rngState);
    const battleState = clonePlain({ ...state, skillRanks: state.skillRanks ?? {}, teamGrowth: state.teamGrowth ?? {} });
    const prepared = ctx.prepareBattle(battleState, encounter);
    if (!prepared || typeof prepared.battleId !== 'string' || !prepared.battleId) throw codedError('INVALID_BATTLE_PREPARATION', 'prepareBattle must return a battleId');
    const chivalryParams = state.relicIds.includes('cross-chivalry') ? relicEffectParams(ctx,'cross-chivalry','hourStarted') : null;
    const chivalry = chivalryParams ? Math.min(Number(chivalryParams.maxStacks), Math.floor(Math.min(Number(chivalryParams.maxGoldCounted),state.gold) / 5)) : 0;
    state.currentBattle = {
      ...clonePlain(prepared),
      battleId: prepared.battleId,
      seed: battleSeed,
      encounterId: encounter.id,
      derivedBuffInputs: chivalry ? [{ relicId: 'cross-chivalry', attackSpeedStacks: chivalry, goldAtPreparation: state.gold }] : [],
      consumedEffects: clonePlain(state.nextBattleEffects),
    };
    state.rngState = roll.state >>> 0;
    state.nextBattleEffects = [];
    state.phase = 'battle';
    return { battleId: state.currentBattle.battleId, seed: state.currentBattle.seed, encounterId: encounter.id };
  }
  if (action.type === 'settleBattle') {
    requirePhase(state, ['battle']);
    if (!state.currentBattle || state.currentBattle.battleId !== action.battleId) throw codedError('BATTLE_ID_MISMATCH', 'Battle id does not match the prepared battle');
    if (typeof ctx.settleBattle !== 'function') throw codedError('NOT_AVAILABLE', 'ctx.settleBattle is required to settle a trusted battle');
    const outcome = ctx.settleBattle(clonePlain(state), clonePlain(state.currentBattle));
    const victory = outcome?.victory ?? outcome?.won ?? (outcome?.status === 'won' ? true : outcome?.status === 'lost' ? false : undefined);
    if (!outcome || typeof victory !== 'boolean') throw codedError('INVALID_BATTLE_RESULT', 'settleBattle must return boolean victory/won or status won/lost');
    if (outcome.battleId !== undefined && outcome.battleId !== state.currentBattle.battleId) throw codedError('BATTLE_ID_MISMATCH', 'Settlement callback returned another battle id');
    const leakedLife = outcome.leakedLife ?? outcome.leakLife ?? 0;
    if (!Number.isFinite(leakedLife) || leakedLife < 0) throw codedError('INVALID_BATTLE_RESULT', 'leakedLife must be a non-negative number');
    for (const effect of outcome.permanentEffects ?? []) {
      if (!effect || typeof effect.uid !== 'string' || (typeof effect.effectKey !== 'string' && typeof effect.sourceKey !== 'string') || typeof effect.stat !== 'string'
        || !Number.isFinite(effect.amount) || !['flat', 'percent', 'counter'].includes(effect.mode ?? 'flat')
        || (effect.mode === 'counter' && (typeof effect.counterKey !== 'string' || !effect.counterKey || typeof effect.label !== 'string' || !effect.label))) {
        throw codedError('INVALID_PERMANENT_EFFECT', 'Permanent effects require uid, effectKey/sourceKey, stat, finite amount, and flat/percent mode (a card counter: counterKey and label)');
      }
      const stableEffectKey = effect.effectKey ?? effect.sourceKey;
      const key = effect.claimKey || effect.oncePerRun === true
        ? `permanent:claim:${effect.uid}:${effect.claimKey ?? stableEffectKey}`
        : `permanent:battle:${state.currentBattle.battleId}:${effect.uid}:${stableEffectKey}`;
      if (state.claimed.includes(key)) continue;
      const target = pieceFor(state, effect.uid);
      applyPermanentEffect(target, effect);
      state.claimed.push(key);
      target.claimed = [...new Set([...(target.claimed ?? []), stableEffectKey])];
    }
    state.life = Math.max(0, state.life - leakedLife);
    const lifeZeroed = state.life <= 0;
    const isFinal = state.currentNode.battleKind === 'final';
    const bonus = victory && !isFinal ? ctx.design.system.run[outcomeRisk(state) ? 'riskReward' : 'normalReward'] : null;
    const relicEarned = applyRelicRunEvent(state, ctx, 'battleEnd', {
      battleId: state.currentBattle.battleId, victory, isFinal,
      battleGoldDrop: bonus?.gold ?? 0, battleXp: bonus?.xp ?? 0,
    });
    const earned = { gold: relicEarned.gold ?? 0, xp: relicEarned.xp ?? 0, hourlyXp: ctx.design.system.run.xpPerHour };
    state.xp += earned.hourlyXp;
    updateTech(state, ctx);
    if (!lifeZeroed && state.relicIds.includes('cross-artinstall')) state.life = Math.min(state.maxLife, state.life + 1);
    const ledger = outcome.ledger ? clonePlain(outcome.ledger) : null;
    if (victory) applyRunLifecycleEvent(state, ctx, 'battleEnd', { eventKey: `battle:${state.currentBattle.battleId}:won` });
    if(ledger){
      const changes=new Map();
      for(const change of state.pendingCardGrowth??[]){
        const key=`${change.uid}:${change.charId}`,prior=changes.get(key);
        changes.set(key,prior?{...change,before:prior.before}:clonePlain(change));
      }
      ledger.growth=[...changes.values()];
    }
    state.pendingCardGrowth=[];
    state.history.push({ kind: 'battleSettled', day: state.day, hour: state.hour, encounterId: state.currentBattle.encounterId, victory, leakedLife, gold: earned.gold, xp: earned.xp + earned.hourlyXp, ledger });
    const shouldChoice = victory && !isFinal && (state.hour === 6 || outcomeRisk(state));
    state.currentBattle = { battleId: state.currentBattle.battleId, encounterId: state.currentBattle.encounterId, summary: outcome.summary ?? null, ledger, victory };
    if (shouldChoice && state.life > 0) {
      const reward = queueBattleRelicChoice(state, ctx);
      if (state.rewardQueue?.kind === 'relic' && state.rewardQueue.source === 'battle') {
        applyRelicChoiceBonus(state, ctx);
        reward.choices = [...(state.rewardQueue.choices ?? [])];
      }
      state.pendingAdvance = true;
      if (!reward.choices.length) nextHour(state, ctx, false);
      return { victory, leakedLife, reward, phase: state.phase, gold: state.gold, xp: state.xp };
    }
    settlementAdvance(state, ctx, { ...outcome, victory });
    return { victory, leakedLife, reward: null, phase: state.phase, gold: state.gold, xp: state.xp, completed: state.completed };
  }
  throw codedError('UNKNOWN_ACTION', `Unknown assault action: ${action.type}`);
}

function outcomeRisk(state) {
  return state.currentNode?.battleKind === 'risk';
}

export function createRun({ runId, seed, directorId }, ctx) {
  requireContext(ctx);
  if (typeof runId !== 'string' || !runId) throw codedError('INVALID_RUN_ID', 'runId must be a non-empty string');
  const director = directorFor(ctx, directorId);
  const seedValue = normalizeSeed(seed);
  const rngState = seedValue || 0x6d2b79f5;
  const run = ctx.design.system.run;
  const state = {
    schema: 'assault-run/v1', runId, seed: seedValue >>> 0, rngState: rngState >>> 0, revision: 0,
    directorId, day: 1, hour: 1, phase: 'nodeChoice', gold: run.startGold, xp: 0, tech: 1,
    life: run.life, maxLife: run.life, nextPieceId: 1, pieces: [], relicIds: [], claimed: [], visitedEvents: [],
    nextBattleEffects: [], nextShopDiscount: 0, relicCounters: {}, skillRanks: {}, teamGrowth: {}, nodes: [], nodeChoices: [], currentNode: null, prepEncounterId: null,
    prepDeploymentVersion: 1, deploymentMigrationPending: false, shop: null,
    currentEvent: null, rewardQueue: null, pendingSkillRewards: [], pendingUpgradeRewards: [], currentBattle: null, history: [], completed: false, pendingAdvance: false,
    opJournal: [],
  };
  for (let index = 0; index < director.startTeam.length; index += 1) {
    const charId = director.startTeam[index];
    const locations = [[9, 10], [10, 10], [11, 10]];
    addBodyToInventory(state, ctx, charId, 1, { row: locations[index]?.[0] ?? null, col: locations[index]?.[1] ?? null, dir: 'E', starter: true });
  }
  const starter = collectibleById(ctx, director.starterRelicId);
  if (starter.rarity !== 'starter' || starter.track !== 'leader') throw codedError('INVALID_STARTER_RELIC', 'Director starter collectible must be leader-exclusive');
  state.relicIds.push(starter.id);
  applyRunLifecycleEvent(state, ctx, 'dayStarted', { eventKey: `day:${state.day}:started` });
  state.nodes = generateNodes(state, ctx);
  state.nodeChoices = state.nodes;
  const initialEncounter = ctx.design.encounters.encounters.find((entry) => entry.kind === 'normal');
  if (initialEncounter) {
    state.currentNode = { kind: 'battle', encounterId: initialEncounter.id };
    state.prepEncounterId = initialEncounter.id;
    state.mapEncounterId = initialEncounter.id;
  }
  reconcileRunDeployments(state, ctx);
  state.currentNode = null;
  validateRelicCounters(state);
  updateTech(state, ctx);
  return state;
}

export function applyAction(state, action, ctx) {
  requireContext(ctx);
  if (!state || state.schema !== 'assault-run/v1') throw codedError('INVALID_RUN', 'Unsupported assault run state');
  if (!action || typeof action !== 'object' || typeof action.opId !== 'string' || !action.opId.trim()) throw codedError('INVALID_OP_ID', 'Every action requires a non-empty opId');
  if (!isInteger(action.expectedRevision)) throw codedError('INVALID_REVISION', 'Every action requires an integer expectedRevision');
  validateTemporaryRun(state, ctx);
  validateTemporaryMaxLife(state);
  validateSupplies(state, ctx);
  validateTemporaryAbilityRun(state);
  for (const piece of state.pieces) temporaryEnchantmentRecords(piece, state, ctx);
  const previous = state.opJournal.find((entry) => entry.opId === action.opId);
  if (previous) {
    if (!structurallyEqual(previous.action, action)) throw codedError('OP_ID_CONFLICT', `opId was already used with different parameters: ${action.opId}`);
    return { state, result: clonePlain(previous.result) };
  }
  if (action.expectedRevision !== state.revision) throw codedError('REVISION_CONFLICT', `Expected revision ${state.revision}, got ${action.expectedRevision}`);
  const draft = clonePlain(state);
  const result = useAction(draft, clonePlain(action), ctx);
  validateTemporaryRun(draft, ctx);
  validateTemporaryMaxLife(draft);
  validateSupplies(draft, ctx);
  validateTemporaryAbilityRun(draft);
  for (const piece of draft.pieces) temporaryEnchantmentRecords(piece, draft, ctx);
  draft.revision = state.revision + 1;
  draft.rngState >>>= 0;
  draft.opJournal.push({ opId: action.opId, action: clonePlain(action), result: clonePlain(result) });
  return { state: draft, result };
}

export function previewNodes(state) {
  return clonePlain(state.nodes);
}

/** Upgrade only an unselected legacy supply preview; keep its RNG and economy. */
export function reconcileSupplyPreview(state,ctx) {
  if(state.phase!=='nodeChoice'||ctx.design.system.run.mandatoryHours.includes(state.hour)
    ||state.nodes?.length===3&&['shop','event','reward'].every(kind=>state.nodes.filter(node=>node.kind===kind).length===1))return false;
  const rng=state.rngState;
  try{state.nodes=generateNodes(state,ctx);}finally{state.rngState=rng;}
  state.nodeChoices=clonePlain(state.nodes);
  return true;
}

export function viewRun(state, ctx) {
  const publicState = { ...state };
  delete publicState.opJournal;
  const hasDynamicEnchantmentEvent = state.currentEvent?.choices?.some((choice) =>
    choice.outcomes?.some((outcome) => outcome.effects?.some((effect) => effect.kind === 'randomEnchant')));
  const projectedEvent = state.phase === 'event' && hasDynamicEnchantmentEvent
    ? eventForNode(state, ctx, state.currentEvent.id)
    : state.currentEvent;
  const pieces = state.pieces.map((piece) => {
    const body = ctx.catalog.bodies[piece.charId];
    const operator = ctx.catalog.operators[piece.purchaseCharId];
    return { ...clonePlain(piece), effectiveEnchantmentId: effectiveEnchantmentId(piece, state), populationCost: piecePopulationCost(piece, ctx), name: operator?.name ?? body?.name ?? piece.charId, profession: body?.profession ?? operator?.profession ?? null, maxHp: body?.starStats?.[piece.star - 1]?.stats?.maxHp ?? body?.baseStats?.maxHp ?? null };
  });
  return {
    ...clonePlain(publicState),
    pieces,
    currentEvent: clonePlain(projectedEvent),
    relics: state.relicIds.map((id) => {
      const item = ctx.design.collectibles.items.find((entry) => entry.id === id);
      return { id, name: item?.name ?? id, track: item?.track ?? null };
    }),
    choices: state.phase === 'nodeChoice' ? clonePlain(state.nodeChoices) : state.phase === 'event' ? clonePlain(projectedEvent?.choices ?? []) : [],
    nodeReroll: { ...(ctx.design.system.nodeReroll ?? { cost: 2, maxPerHour: 1 }), count: state.nodeRerollCount ?? 0 },
    shop: state.shop ? { id: state.shop.id, kind: state.shop.kind ?? 'operator', slots: clonePlain(state.shop.slots), refreshCost: state.shop.refreshCost, refreshCount: state.shop.refreshCount, availableDefinitions: shopContext(state, ctx).definitions } : null,
    target: projectedEvent ? {
      eventId: projectedEvent.id,
      name: projectedEvent.name,
      options: projectedEvent.choices.map((choice) => ({ choiceId: choice.id, targets: clonePlain(choice.targets) })),
    } : null,
    rewards: clonePlain(state.rewardQueue),
    skillRewards: state.phase === 'skillChoice' && state.pendingSkillRewards?.[0] ? clonePlain({ ...state.pendingSkillRewards[0], skippable: true }) : null,
    upgradeRewards: state.phase === 'upgradeChoice' && state.pendingUpgradeRewards?.[0] ? clonePlain({ ...state.pendingUpgradeRewards[0], skippable: true }) : null,
    battleControls: state.phase === 'battle' ? ['pause', 'speed'] : [],
    currentBattle: state.currentBattle ? {
      battleId: state.currentBattle.battleId,
      encounterId: state.currentBattle.encounterId,
      summary: state.currentBattle.summary ?? null,
      victory: state.currentBattle.victory ?? null,
    } : null,
    currentNode: clonePlain(state.currentNode),
  };
}

export function auditRun(state, ctx) {
  validateTemporaryMaxLife(state);
  validateSupplies(state, ctx);
  validateTemporaryAbilityRun(state);
  for (const piece of state.pieces) temporaryEnchantmentRecords(piece, state, ctx);
  return {
    nodeChoiceCount: state.nodes.length,
    shopDefinitions: ctx.design.system.shopDefinitions.length,
    events: ctx.design.events.events.length,
    relics: ctx.design.collectibles.items.length,
    techPopulation: activePieceLimit(state, ctx),
  };
}
