import { addBodyToInventory, clonePlain, pieceFor } from './inventory.js';
import { codedError, pickWeighted } from './rng.js';
import { relicCandidates } from './rewards.js';
import { N_ } from '../i18n.js';
import { eventEnchantmentCandidates } from './upgrades.js';

const SELECTABLE_TEAM_REQUIREMENT = N_('队伍中至少有一名可换防的干员');
const NON_BATTLE_REQUIREMENT = N_('本时段未安排战斗');

function eventById(ctx, id) {
  const event = ctx.design.events.events.find((entry) => entry.id === id);
  if (!event) throw codedError('UNKNOWN_EVENT', `Unknown event: ${id}`);
  return event;
}

function currencyValue(state, currency) {
  if (currency === 'gold') return state.gold;
  if (currency === 'hp') return state.life;
  if (currency === 'xp') return state.xp;
  throw codedError('UNKNOWN_CURRENCY', `Unknown event currency: ${currency}`);
}

function recruitPool(state, ctx, choice, filterTag) {
  const targeting = choice.targeting;
  if (!['profession', 'faction', 'random'].includes(targeting.selection)) throw codedError('UNKNOWN_RECRUIT_SELECTION', `Unknown recruit selection: ${targeting.selection}`);
  const profession = targeting.selection === 'profession' ? filterTag : null;
  const faction = targeting.selection === 'faction' ? filterTag : null;
  if (targeting.selection !== 'random' && !profession && !faction) return [];
  return Object.entries(ctx.catalog.operators).filter(([charId, operator]) => {
    const body = ctx.catalog.bodies[charId];
    const tags = operator.tags ?? body?.tags ?? [];
    const matches = targeting.selection === 'random'
      ? true
      : profession
        ? operator.profession === profession
        : (operator.nationId ?? body?.nationId ?? operator.faction) === faction || tags.includes(faction);
    if (!matches) return false;
    if (targeting.priceTier && !targeting.priceTier.includes(operator.price)) return false;
    const owned = state.pieces.filter((piece) => piece.purchaseCharId === charId).reduce((sum, piece) => sum + piece.sourceCopies, 0);
    return owned < ctx.design.system.run.sourceCapPerBody;
  });
}

function fittingRecruitIds(state, ctx, pool) {
  const fitting = [];
  for (const [charId] of pool) {
    const draft = { ...state, pieces: clonePlain(state.pieces), nextPieceId: state.nextPieceId };
    try {
      addBodyToInventory(draft, ctx, charId, 1, { row: null, col: null });
      fitting.push(charId);
    } catch (error) {
      if (!['BENCH_FULL', 'SOURCE_CAP'].includes(error.code)) throw error;
    }
  }
  return fitting;
}

function publicEffect(effect) {
  const hidden = new Set(['description', 'lifecycle', 'stacking', 'limits', 'trigger']);
  return Object.fromEntries(Object.entries(effect).filter(([key]) => !hidden.has(key)));
}

function candidateTargets(state, ctx, choice) {
  const targeting = choice.targeting ?? { mode: 'none' };
  const enchantEffect = choice.outcomes.flatMap((outcome) => outcome.effects).find((effect) => effect.kind === 'randomEnchant');
  if (enchantEffect) {
    const { target } = eventEnchantmentCandidates(state, ctx, enchantEffect);
    return target ? [{ targetUid: target.uid, name: ctx.catalog.operators[target.purchaseCharId]?.name ?? target.charId, enchantmentId: target.enchantmentId ?? null }] : [];
  }
  if (targeting.mode === 'selectTeam' || choice.outcomes.some((outcome) => outcome.effects.some((effect) => effect.kind === 'tag' || effect.kind === 'redeploy'))) return state.pieces.map((piece) => ({ targetUid: piece.uid, name: ctx.catalog.operators[piece.purchaseCharId]?.name ?? piece.charId, charId: piece.charId }));
  if (targeting.mode !== 'recruit' && !choice.outcomes.some((outcome) => outcome.effects.some((effect) => effect.kind === 'recruit' && effect.selection === 'random'))) return [];
  if (targeting.mode === 'none') {
    return choice.outcomes.flatMap((outcome) => outcome.effects.filter((effect) => effect.kind === 'recruit' && effect.selection === 'random')
      .flatMap((effect) => recruitPool(state, ctx, { targeting: { selection: 'random', priceTier: effect.priceTier } }, null)
        .map(([charId, operator]) => ({ targetUid: charId, name: operator.name, profession: operator.profession, price: operator.price, selection: 'random' }))));
  }
  const options = targeting.selection === 'profession'
    ? [...new Set(Object.values(ctx.catalog.operators).map((operator) => operator.profession))]
    : targeting.selection === 'faction'
      ? [...new Set(Object.values(ctx.catalog.operators).map((operator) => operator.nationId ?? operator.faction).filter(Boolean))]
      : null;
  if (!options) throw codedError('UNKNOWN_RECRUIT_SELECTION', `Unknown recruit selection: ${targeting.selection}`);
  return options.flatMap((filterTag) => recruitPool(state, ctx, { targeting }, filterTag).map(([charId, operator]) => ({
    targetUid: charId,
    filterTag,
    name: operator.name,
    profession: operator.profession,
    price: operator.price,
  })));
}

function eligibleChoice(state, ctx, choice, action = {}) {
  const conditions = choice.conditions ?? {};
  const knownConditions = new Set(['requires', 'minCurrency']);
  for (const key of Object.keys(conditions)) if (!knownConditions.has(key)) throw codedError('UNKNOWN_EVENT_CONDITION', `Unknown event condition: ${key}`);
  for (const requirement of conditions.requires ?? []) {
    if (requirement !== SELECTABLE_TEAM_REQUIREMENT) throw codedError('UNSUPPORTED_EVENT_CONDITION', `Unresolved event choice requirement: ${requirement}`);
    if (!state.pieces.length) return { ok: false, reason: 'NO_TEAM_TARGET' };
  }
  for (const [currency, amount] of Object.entries(conditions.minCurrency ?? {})) {
    if (currencyValue(state, currency) < amount) return { ok: false, reason: 'INSUFFICIENT_CURRENCY' };
  }
  for (const cost of choice.costs ?? []) if (currencyValue(state, cost.currency) < cost.amount) return { ok: false, reason: 'INSUFFICIENT_CURRENCY' };
  for (const outcome of choice.outcomes ?? []) for (const effect of outcome.effects ?? []) if (effect.kind === 'randomEnchant') {
    const { target, candidates } = eventEnchantmentCandidates(state, ctx, effect);
    if (!target) return { ok: false, reason: 'NO_ENCHANTMENT_TARGET' };
    if (!candidates.length) return { ok: false, reason: 'NO_ENCHANTMENT_CANDIDATE' };
  }
  const mode = choice.targeting?.mode ?? 'none';
  if (mode === 'recruit') {
    const pool = recruitPool(state, ctx, choice, action.filterTag);
    if (!action.filterTag && choice.targeting?.selection !== 'random') return { ok: false, reason: 'TARGET_REQUIRED' };
    if (!pool.length) return { ok: false, reason: 'NO_RECRUIT_TARGET' };
    if (action.targetUid && !pool.some(([charId]) => charId === action.targetUid)) return { ok: false, reason: 'INVALID_RECRUIT_TARGET' };
    if (!action.targetUid && pool.length > 0) return { ok: false, reason: 'TARGET_REQUIRED' };
  } else if (mode === 'selectTeam') {
    if (!state.pieces.length) return { ok: false, reason: 'NO_TEAM_TARGET' };
    if (!action.targetUid) return { ok: false, reason: 'TARGET_REQUIRED' };
    if (!state.pieces.some((piece) => piece.uid === action.targetUid)) return { ok: false, reason: 'INVALID_TEAM_TARGET' };
  } else if (mode !== 'none') {
    throw codedError('UNKNOWN_EVENT_TARGETING', `Unknown event targeting mode: ${mode}`);
  }
  for (const outcome of choice.outcomes ?? []) for (const effect of outcome.effects ?? []) if (effect.kind === 'recruit') {
    if (effect.selection !== 'random' && (!action.filterTag || !action.targetUid)) return { ok: false, reason: 'TARGET_REQUIRED' };
    const recruitChoice = { targeting: { mode: 'recruit', selection: effect.selection, priceTier: effect.priceTier } };
    const pool = recruitPool(state, ctx, recruitChoice, action.filterTag);
    const fitting = fittingRecruitIds(state, ctx, pool);
    if (effect.selection === 'random') {
      if (!fitting.length) return { ok: false, reason: 'BENCH_FULL' };
      continue;
    }
    if (!fitting.includes(action.targetUid)) return { ok: false, reason: action.targetUid ? 'INVALID_RECRUIT_TARGET' : 'TARGET_REQUIRED' };
  }
  if (choice.outcomes.some((outcome) => outcome.effects.some((effect) => effect.kind === 'tag' || effect.kind === 'redeploy'))) {
    if (!action.targetUid) return { ok: false, reason: 'TARGET_REQUIRED' };
    if (!state.pieces.some((piece) => piece.uid === action.targetUid)) return { ok: false, reason: 'INVALID_TEAM_TARGET' };
  }
  for (const outcome of choice.outcomes ?? []) for (const effect of outcome.effects ?? []) {
    if (effect.kind === 'relicChoice') {
      const pool = relicCandidates(state, ctx, { track: effect.track, rarity: effect.rarity, count: effect.count, source: { type: 'event', value: 'nonBattleEvent' } });
      if (!pool.candidates.length) return { ok: false, reason: 'NO_RELIC_TARGET' };
    } else if (!['gold', 'xp', 'hp', 'recruit', 'repair', 'enhance', 'redeploy', 'tag', 'shopDiscount', 'randomEnchant'].includes(effect.kind)) {
      throw codedError('UNKNOWN_EVENT_EFFECT', `Unknown event effect: ${effect.kind}`);
    }
  }
  return { ok: true };
}

export function eventForNode(state, ctx, eventId) {
  const event = eventById(ctx, eventId);
  const publicEvent = ctx.catalog.publicText?.events?.[event.id] ?? null;
  const conditions = event.conditions ?? {};
  if (event.unlockDay > state.day || state.day < (conditions.minDay ?? 1) || state.day > (conditions.maxDay ?? 10)) throw codedError('EVENT_LOCKED', `Event ${eventId} is unavailable on day ${state.day}`);
  for (const requirement of conditions.requires ?? []) {
    if (requirement === NON_BATTLE_REQUIREMENT) continue;
    if (requirement.startsWith('本局尚未进入过')) continue;
    throw codedError('UNSUPPORTED_EVENT_CONDITION', `Unresolved event requirement: ${requirement}`);
  }
  if (!event.repeatable && state.visitedEvents.includes(eventId)) throw codedError('EVENT_ALREADY_VISITED', `Event already visited: ${eventId}`);
  return {
    id: event.id,
    name: publicEvent?.name ?? event.name,
    story: publicEvent?.story ?? '',
    choices: event.choices.map((choice) => {
      const eligible = eligibleChoice(state, ctx, choice);
      const pendingTarget = ['TARGET_REQUIRED', 'NO_RECRUIT_TARGET'].includes(eligible.reason);
      return {
        id: choice.id,
        label: publicEvent?.choices?.[choice.id]?.label ?? choice.label,
        description: publicEvent?.choices?.[choice.id]?.description ?? choice.description,
        costs: choice.costs ?? [],
        targeting: choice.targeting,
        targets: candidateTargets(state, ctx, choice),
        recruitFilters: choice.targeting?.mode === 'recruit' && choice.targeting.selection !== 'random'
          ? [...new Set(Object.values(ctx.catalog.operators).map((operator) => choice.targeting.selection === 'profession' ? operator.profession : (operator.nationId ?? operator.faction)).filter(Boolean))]
          : [],
        outcomes: choice.outcomes.map((outcome) => ({ probability: outcome.probability, effects: outcome.effects.map(publicEffect) })),
        enchantmentOffer: (() => {
          const effect = choice.outcomes.flatMap((outcome) => outcome.effects).find((entry) => entry.kind === 'randomEnchant');
          if (!effect) return null;
          const { target, candidates } = eventEnchantmentCandidates(state, ctx, effect);
          return target ? {
            poolId: effect.poolId,
            targetRule: effect.targetRule,
            targetUid: target.uid,
            charId: target.charId,
            star: target.star,
            currentEnchantmentId: target.enchantmentId ?? null,
            options: candidates.map((entry) => ({ enchantmentId: entry.enchantmentId, name: entry.definition.name, weight: entry.weight })),
          } : null;
        })(),
        enabled: eligible.ok || pendingTarget,
        disabledReason: pendingTarget ? null : eligible.reason ?? null,
      };
    }),
  };
}

function applyEffect(state, ctx, effect, action) {
  const amount = effect.amount ?? 0;
  if (effect.kind === 'gold') state.gold += amount;
  else if (effect.kind === 'xp') state.xp += amount;
  else if (effect.kind === 'hp') state.life = Math.min(state.maxLife, Math.max(0, state.life + amount));
  else if (effect.kind === 'relicChoice') {
    const result = relicCandidates(state, ctx, { track: effect.track, rarity: effect.rarity, count: effect.count, source: { type: 'event', value: 'nonBattleEvent' } });
    state.rngState = result.rngState >>> 0;
    state.rewardQueue = { kind: 'relic', choices: result.candidates.map((item) => item.id), source: 'event' };
    if (!result.candidates.length) throw codedError('NO_RELIC_TARGET', 'No eligible collectible for this event choice');
  } else if (effect.kind === 'recruit') {
    const pool = recruitPool(state, ctx, { targeting: { selection: effect.selection, priceTier: effect.priceTier } }, action.filterTag);
    const chosen = effect.selection === 'random'
      ? pickWeighted(fittingRecruitIds(state, ctx, pool).map((charId) => ({ charId, weight: 1 })), state.rngState)
      : { value: { charId: action.targetUid }, state: state.rngState };
    if (effect.selection === 'random') state.rngState = chosen.state >>> 0;
    const charId = chosen.value?.charId;
    if (!charId || !pool.some(([candidate]) => candidate === charId)) throw codedError('INVALID_RECRUIT_TARGET', 'Recruit target is not eligible');
    addBodyToInventory(state, ctx, charId, 1, { row: null, col: null });
  } else if (effect.kind === 'repair') {
    state.nextBattleEffects.push({ kind: 'openingShield', amount: effect.amount, mode: effect.mode, target: effect.target, durationSec: effect.durationSec, sourceEventId: state.currentEvent.id });
  } else if (effect.kind === 'enhance') {
    state.nextBattleEffects.push({ kind: 'enhance', stat: effect.stat, amount: effect.amount, mode: effect.mode, scope: effect.scope, sourceEventId: state.currentEvent.id });
  } else if (effect.kind === 'redeploy') {
    pieceFor(state, action.targetUid);
    state.nextBattleEffects.push({ kind: 'firstNaturalEntryCostWaiver', uid: action.targetUid, countsAsSkillRedeploy: false, sourceEventId: state.currentEvent.id });
  } else if (effect.kind === 'tag') {
    const target = pieceFor(state, action.targetUid);
    target.tagEdits.add = [...new Set([...target.tagEdits.add, effect.tag])];
  } else if (effect.kind === 'shopDiscount') state.nextShopDiscount += amount;
  else if (effect.kind === 'randomEnchant') {
    const { target, candidates } = eventEnchantmentCandidates(state, ctx, effect);
    if (!target) throw codedError('NO_ENCHANTMENT_TARGET', 'No eligible piece for this enchantment event');
    if (!candidates.length) throw codedError('NO_ENCHANTMENT_CANDIDATE', 'No eligible enchantment remains for this event');
    const selected = pickWeighted(candidates, state.rngState);
    if (!selected.value) throw codedError('NO_ENCHANTMENT_CANDIDATE', 'No eligible enchantment remains for this event');
    const oldEnchantmentId = target.enchantmentId ?? null;
    target.enchantmentId = selected.value.enchantmentId;
    state.rngState = selected.state >>> 0;
    state.history.push({
      kind: 'eventEnchantment',
      eventId: state.currentEvent.id,
      targetUid: target.uid,
      oldEnchantmentId,
      newEnchantmentId: target.enchantmentId,
      poolId: effect.poolId,
    });
  }
  else throw codedError('UNKNOWN_EVENT_EFFECT', `Unknown event effect: ${effect.kind}`);
}

export function confirmEventChoice(state, ctx, action) {
  if (state.phase !== 'event' || !state.currentEvent) throw codedError('NO_EVENT', 'No event is open');
  const event = eventById(ctx, state.currentEvent.id);
  const choice = event.choices.find((entry) => entry.id === action.choiceId);
  if (!choice) throw codedError('UNKNOWN_EVENT_CHOICE', `Unknown event choice: ${action.choiceId}`);
  const eligibility = eligibleChoice(state, ctx, choice, action);
  if (!eligibility.ok) throw codedError(eligibility.reason, `Event choice is unavailable: ${eligibility.reason}`);
  const probabilityTotal = choice.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
  if (Math.abs(probabilityTotal - 1) > 1e-9) throw codedError('INVALID_EVENT_PROBABILITIES', `Outcome probabilities total ${probabilityTotal}`);
  for (const cost of choice.costs ?? []) if (currencyValue(state, cost.currency) < cost.amount) throw codedError('INSUFFICIENT_CURRENCY', `Not enough ${cost.currency}`);
  for (const cost of choice.costs ?? []) {
    if (cost.currency === 'gold') state.gold -= cost.amount;
    else if (cost.currency === 'hp') state.life = Math.max(0, state.life - cost.amount);
    else if (cost.currency === 'xp') state.xp -= cost.amount;
    else throw codedError('UNKNOWN_CURRENCY', `Unknown event currency: ${cost.currency}`);
  }
  if (state.life <= 0) {
    state.visitedEvents = [...new Set([...state.visitedEvents, event.id])];
    state.currentEvent = null;
    state.phase = 'ended';
    state.pendingAdvance = false;
    return { eventId: event.id, choiceId: choice.id, ended: true };
  }
  const outcome = pickWeighted(choice.outcomes.map((entry) => ({ ...entry, weight: entry.probability })), state.rngState);
  state.rngState = outcome.state >>> 0;
  for (const effect of outcome.value.effects) applyEffect(state, ctx, effect, action);
  state.visitedEvents = [...new Set([...state.visitedEvents, event.id])];
  state.currentEvent = null;
  state.pendingAdvance = true;
  if (state.life <= 0) state.phase = 'ended';
  else if (state.rewardQueue) state.phase = 'rewards';
  else state.phase = 'event-resolved';
  return { eventId: event.id, choiceId: choice.id, outcome: outcome.value, advanced: state.phase === 'ended' };
}

export function leaveEvent(state, ctx) {
  if (state.phase !== 'event' || !state.currentEvent) throw codedError('NO_EVENT', 'No event is open');
  const event = eventById(ctx, state.currentEvent.id);
  const leave = event.choices.find((choice) => choice.id === 'free_leave_choice_id' || choice.id.endsWith('_leave'));
  if (leave) return confirmEventChoice(state, ctx, { choiceId: leave.id });
  state.currentEvent = null;
  state.pendingAdvance = true;
  state.phase = 'event-resolved';
  return { eventId: event.id, left: true, advanced: true };
}

export function validateEventDesign(design) {
  if (!Array.isArray(design.events?.events) || design.events.events.length !== 26) throw codedError('INVALID_EVENT_DESIGN', 'Expected 26 events');
  for (const event of design.events.events) {
    const eventConditions = event.conditions ?? {};
    for (const key of Object.keys(eventConditions)) if (!['minDay', 'maxDay', 'oncePerRun', 'requires'].includes(key)) throw codedError('UNKNOWN_EVENT_CONDITION', `Unknown event condition: ${key}`);
    if (eventConditions.requires && (!Array.isArray(eventConditions.requires) || eventConditions.requires.some((item) => typeof item !== 'string' || (item !== NON_BATTLE_REQUIREMENT && !item.startsWith('本局尚未进入过'))))) throw codedError('INVALID_EVENT_CONDITION', `Malformed event requirements: ${event.id}`);
    if (!['rogue_1', 'rogue_2', 'rogue_3', 'rogue_4', 'rogue_5', 'rogue_6', 'bazaar'].includes(event.topicId)) throw codedError('INVALID_EVENT_TOPIC', `Unsupported event topic: ${event.topicId}`);
    for (const choice of event.choices) {
    if (!choice.id || !Array.isArray(choice.outcomes) || !Array.isArray(choice.costs ?? [])) throw codedError('INVALID_EVENT_DESIGN', `Malformed event choice in ${event.id}`);
    const conditions = choice.conditions ?? {};
    for (const key of Object.keys(conditions)) if (!['requires', 'minCurrency'].includes(key)) throw codedError('UNKNOWN_EVENT_CONDITION', `Unknown event choice condition: ${key}`);
    if (conditions.requires && (!Array.isArray(conditions.requires) || conditions.requires.some((item) => item !== SELECTABLE_TEAM_REQUIREMENT))) throw codedError('UNSUPPORTED_EVENT_CONDITION', `Unresolved event choice requirement: ${event.id}/${choice.id}`);
    for (const outcome of choice.outcomes) for (const effect of outcome.effects ?? []) {
      if (!['gold', 'xp', 'relicChoice', 'hp', 'recruit', 'repair', 'enhance', 'redeploy', 'tag', 'shopDiscount', 'randomEnchant'].includes(effect.kind)) throw codedError('UNKNOWN_EVENT_EFFECT', `Unknown event effect: ${effect.kind}`);
      if (effect.kind === 'randomEnchant' && (!effect.poolId || !['oldestUnenchanted', 'oldestToxic'].includes(effect.targetRule))) throw codedError('INVALID_EVENT_EFFECT', `Malformed random enchant effect: ${event.id}/${choice.id}`);
    }
    }
  }
  return true;
}
