import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRun, applyAction, viewRun } from '../../shared/assault/run.js';
import { eventForNode, validateEventDesign } from '../../shared/assault/events.js';

const json = (name) => JSON.parse(readFileSync(new URL(`../../data/assault-design/${name}.json`, import.meta.url), 'utf8'));
const system = json('system');
const events = json('events');
const collectibles = json('collectibles');
const encounters = json('encounters');
const forms = json('forms');
const roster = ['support', 'assault', 'ranged'].flatMap((group) => json(`roster-${group}`).operators);
const operators = Object.fromEntries(roster.map((entry, index) => [entry.charId, {
  ...structuredClone(entry),
  nationId: ['kjerag', 'victoria', 'laterano'][index % 3],
}]));
operators.char_002_amiya.extraForms = forms.forms.map((entry) => entry.charId);
const bodies = Object.fromEntries(roster.map((entry) => [entry.charId, {
  charId: entry.charId, purchaseCharId: entry.charId, name: entry.name, profession: entry.profession,
  price: entry.price, defaultModuleId: entry.defaultModuleId ?? null, modulePlans: entry.modulePlans,
  baseStats: { maxHp: 1000 }, starStats: Array.from({ length: 4 }, (_, i) => ({ star: i + 1, stats: { maxHp: 1000 * (i + 1) } })),
}]));
for (const entry of forms.forms) bodies[entry.charId] = {
  charId: entry.charId, purchaseCharId: forms.family.charId, name: entry.name, profession: entry.profession,
  price: entry.price, defaultModuleId: entry.defaultModuleId ?? null, modulePlans: entry.modulePlans,
  baseStats: { maxHp: 1000 }, starStats: Array.from({ length: 4 }, (_, i) => ({ star: i + 1, stats: { maxHp: 1000 * (i + 1) } })),
};
const ctx = { catalog: { operators, bodies }, design: { system, events, collectibles, encounters } };

function targetFor(state, choice) {
  const targeting = choice.targeting ?? { mode: 'none' };
  if (targeting.mode === 'selectTeam' || choice.outcomes.some((outcome) => outcome.effects.some((effect) => effect.kind === 'tag' || effect.kind === 'redeploy'))) return { targetUid: state.pieces[0].uid };
  if (targeting.mode !== 'recruit') return {};
  const tags = targeting.selection === 'profession' ? [...new Set(Object.values(operators).map((entry) => entry.profession))] : [...new Set(Object.values(operators).map((entry) => entry.nationId))];
  for (const filterTag of tags) {
    const target = Object.values(operators).find((operator) => {
      const matches = targeting.selection === 'profession' ? operator.profession === filterTag : operator.nationId === filterTag;
      return matches && (!targeting.priceTier || targeting.priceTier.includes(operator.price));
    });
    if (target) return { filterTag, targetUid: target.charId };
  }
  assert.fail(`no mock candidate for recruit selection ${targeting.selection}`);
}

function eventState(event, targetChoiceId = null) {
  const firstDay = Math.max(event.unlockDay, event.conditions?.minDay ?? 1);
  const lastDay = event.conditions?.maxDay ?? 10;
  let latest;
  for (let day = firstDay; day <= lastDay; day += 1) {
    const state = createRun({ runId: `event-${event.id}-${day}`, seed: 123, directorId: system.directors[0].id }, ctx);
    state.day = day;
    state.gold = 1000;
    state.life = 20;
    state.xp = 90;
    state.phase = 'event';
    state.currentEvent = eventForNode(state, ctx, event.id);
    latest = state;
    if (!targetChoiceId || state.currentEvent.choices.find((choice) => choice.id === targetChoiceId)?.enabled) return state;
  }
  return latest;
}

test('all 26 events and all actual choice records exercise costs, targets and effects', () => {
  assert.equal(events.events.length, 26);
  validateEventDesign({ events });
  const seenChoices = new Set();
  const effects = new Set();
  let outcomesCovered = 0;
  for (const event of events.events) {
    for (const choice of event.choices) {
      const state = eventState(event, choice.id);
      const viewChoice = state.currentEvent.choices.find((entry) => entry.id === choice.id);
      if (!viewChoice.enabled) {
        assert.ok(['NO_RELIC_TARGET', 'NO_ENCHANTMENT_TARGET'].includes(viewChoice.disabledReason));
        seenChoices.add(`${event.id}/${choice.id}`);
        for (const outcome of choice.outcomes) {
          outcomesCovered += 1;
          for (const effect of outcome.effects) effects.add(effect.kind);
        }
        continue;
      }
      const params = targetFor(state, choice);
      const action = { type: 'confirmEvent', choiceId: choice.id, ...params, opId: `choose:${event.id}:${choice.id}`, expectedRevision: state.revision };
      const next = applyAction(state, action, ctx).state;
      seenChoices.add(`${event.id}/${choice.id}`);
      for (const outcome of choice.outcomes) {
        outcomesCovered += 1;
        for (const effect of outcome.effects) effects.add(effect.kind);
      }
      if (next.phase === 'rewards') {
        assert.ok(next.rewardQueue.choices.length > 0);
        assert.ok(next.rewardQueue.choices.every((id) => !state.relicIds.includes(id)));
      }
      assert.equal(next.visitedEvents.includes(event.id), true);
      const costGold = (choice.costs ?? []).filter((cost) => cost.currency === 'gold').reduce((sum, cost) => sum + cost.amount, 0);
      const costHp = (choice.costs ?? []).filter((cost) => cost.currency === 'hp').reduce((sum, cost) => sum + cost.amount, 0);
      assert.ok(next.gold <= 1000 + 100);
      assert.ok(next.life <= 20);
      assert.ok(costGold === 0 || next.gold <= 1100 - costGold || choice.outcomes.some((outcome) => outcome.effects.some((effect) => effect.kind === 'gold' && effect.amount > 0)));
      assert.ok(costHp === 0 || next.life <= 20 - costHp || choice.outcomes.some((outcome) => outcome.effects.some((effect) => effect.kind === 'hp' && effect.amount > 0)));
    }
  }
  assert.equal(seenChoices.size, events.events.reduce((sum, event) => sum + event.choices.length, 0));
  assert.deepEqual([...effects].sort(), ['enhance', 'gold', 'hp', 'randomEnchant', 'recruit', 'redeploy', 'repair', 'relicChoice', 'shopDiscount', 'tag', 'xp'].sort());
  assert.ok(outcomesCovered >= seenChoices.size);
});

test('Bazaar hat and Botul use eligible weighted subsets, preserve atomicity and are idempotent', () => {
  const hatEvent = events.events.find((entry) => entry.id === 'evt_bazaar_hat');
  const hatChoice = hatEvent.choices.find((entry) => entry.id === 'hat_enchant');
  const hat = eventState(hatEvent, hatChoice.id);
  const ordered = [...hat.pieces].sort((a, b) => Number(a.uid.slice(1)) - Number(b.uid.slice(1)));
  for (const piece of ordered) piece.enchantmentId = null;
  const firstFixedSkill = bodies[ordered[0].charId].fixedSkill;
  bodies[ordered[0].charId].fixedSkill = { kind: 'passive' };
  const beforeHatRng = hat.rngState;
  const hatStar = ordered[0].star;
  hat.pieces.reverse();
  hat.currentEvent = eventForNode(hat, ctx, hatEvent.id);
  const hatView = hat.currentEvent.choices.find((entry) => entry.id === hatChoice.id);
  assert.equal(hatView.enabled, true);
  assert.equal(hatView.enchantmentOffer.targetUid, ordered[0].uid);
  assert.equal(hatView.enchantmentOffer.options.some((entry) => entry.enchantmentId === 'enchant_golden'), false);
  assert.equal(hatView.enchantmentOffer.options.some((entry) => entry.enchantmentId === 'enchant_shiny'), false);
  const hatAction = { type: 'confirmEvent', choiceId: hatChoice.id, opId: 'bazaar-hat', expectedRevision: hat.revision };
  const hatResult = applyAction(hat, hatAction, ctx);
  const hatNext = hatResult.state;
  assert.ok(hatNext.day > hat.day || hatNext.hour !== hat.hour);
  const hatHistory = hatNext.history.find((entry) => entry.kind === 'eventEnchantment');
  assert.equal(hatHistory.targetUid, ordered[0].uid);
  assert.equal(hatHistory.poolId, 'pool_bazaar_random');
  assert.notEqual(hatNext.pieces.find((piece) => piece.uid === ordered[0].uid).enchantmentId, null);
  assert.equal(hatNext.pieces.find((piece) => piece.uid === ordered[0].uid).star, hatStar);
  assert.ok(hatNext.rngState !== beforeHatRng || hatView.enchantmentOffer.options.length === 1);
  const replay = applyAction(hatNext, { ...hatAction, expectedRevision: hat.revision }, ctx);
  assert.equal(replay.state.revision, hatNext.revision);
  assert.equal(replay.state.history.filter((entry) => entry.kind === 'eventEnchantment').length, 1);

  const noTargetHat = eventState(hatEvent, hatChoice.id);
  noTargetHat.pieces.forEach((piece) => { piece.enchantmentId = 'enchant_golden'; });
  noTargetHat.currentEvent = eventForNode(noTargetHat, ctx, hatEvent.id);
  const disabledHat = noTargetHat.currentEvent.choices.find((entry) => entry.id === hatChoice.id);
  assert.equal(disabledHat.enabled, false);
  assert.equal(disabledHat.disabledReason, 'NO_ENCHANTMENT_TARGET');
  const noTargetSnapshot = structuredClone(noTargetHat);
  assert.throws(() => applyAction(noTargetHat, { type: 'confirmEvent', choiceId: hatChoice.id, opId: 'hat-no-target', expectedRevision: noTargetHat.revision }, ctx), { code: 'NO_ENCHANTMENT_TARGET' });
  assert.deepEqual(noTargetHat, noTargetSnapshot);

  const botulEvent = events.events.find((entry) => entry.id === 'evt_bazaar_botul');
  const botulChoice = botulEvent.choices.find((entry) => entry.id === 'botul_recast');
  const botul = eventState(botulEvent, botulChoice.id);
  botul.gold = 50;
  const toxicTarget = [...botul.pieces].sort((a, b) => Number(a.uid.slice(1)) - Number(b.uid.slice(1)))[0];
  toxicTarget.enchantmentId = 'enchant_toxic';
  const toxicFixedSkill = bodies[toxicTarget.charId].fixedSkill;
  bodies[toxicTarget.charId].fixedSkill = { kind: 'instant' };
  botul.pieces.reverse();
  botul.currentEvent = eventForNode(botul, ctx, botulEvent.id);
  const botulView = botul.currentEvent.choices.find((entry) => entry.id === botulChoice.id);
  assert.equal(botulView.enabled, true);
  assert.equal(botulView.enchantmentOffer.targetUid, toxicTarget.uid);
  assert.equal(botulView.enchantmentOffer.options.some((entry) => entry.enchantmentId === 'enchant_toxic' || entry.enchantmentId === 'enchant_golden'), false);
  assert.equal(botulView.enchantmentOffer.options.some((entry) => entry.enchantmentId === 'enchant_shiny'), true);
  const beforeBotulGold = botul.gold;
  const botulStar = toxicTarget.star;
  const botulAction = { type: 'confirmEvent', choiceId: botulChoice.id, opId: 'bazaar-botul', expectedRevision: botul.revision };
  const botulNext = applyAction(botul, botulAction, ctx).state;
  assert.ok(botulNext.day > botul.day || botulNext.hour !== botul.hour);
  assert.equal(botulNext.gold, beforeBotulGold - 20);
  const botulHistory = botulNext.history.find((entry) => entry.kind === 'eventEnchantment');
  assert.equal(botulHistory.targetUid, toxicTarget.uid);
  assert.equal(botulHistory.oldEnchantmentId, 'enchant_toxic');
  assert.notEqual(botulHistory.newEnchantmentId, 'enchant_toxic');
  assert.equal(botulHistory.poolId, 'pool_bazaar_random');
  assert.equal(botulNext.pieces.find((piece) => piece.uid === toxicTarget.uid).star, botulStar);

  const noTargetBotul = eventState(botulEvent, botulChoice.id);
  noTargetBotul.gold = 50;
  noTargetBotul.pieces.forEach((piece) => { piece.enchantmentId = null; });
  noTargetBotul.currentEvent = eventForNode(noTargetBotul, ctx, botulEvent.id);
  const disabledBotul = noTargetBotul.currentEvent.choices.find((entry) => entry.id === botulChoice.id);
  assert.equal(disabledBotul.enabled, false);
  assert.equal(disabledBotul.disabledReason, 'NO_ENCHANTMENT_TARGET');
  const noTargetBotulSnapshot = structuredClone(noTargetBotul);
  assert.throws(() => applyAction(noTargetBotul, { type: 'confirmEvent', choiceId: botulChoice.id, opId: 'botul-no-target', expectedRevision: noTargetBotul.revision }, ctx), { code: 'NO_ENCHANTMENT_TARGET' });
  assert.deepEqual(noTargetBotul, noTargetBotulSnapshot);

  const poorBotul = eventState(botulEvent, botulChoice.id);
  poorBotul.gold = 19;
  poorBotul.pieces[0].enchantmentId = 'enchant_toxic';
  poorBotul.currentEvent = eventForNode(poorBotul, ctx, botulEvent.id);
  const poorSnapshot = structuredClone(poorBotul);
  assert.throws(() => applyAction(poorBotul, { type: 'confirmEvent', choiceId: botulChoice.id, opId: 'botul-poor', expectedRevision: poorBotul.revision }, ctx), { code: 'INSUFFICIENT_CURRENCY' });
  assert.deepEqual(poorBotul, poorSnapshot);
  bodies[ordered[0].charId].fixedSkill = firstFixedSkill;
  bodies[toxicTarget.charId].fixedSkill = toxicFixedSkill;
});

test('viewRun refreshes random-enchant offers after an event-phase sale without mutating state', () => {
  const event = events.events.find((entry) => entry.id === 'evt_bazaar_hat');
  const choiceId = 'hat_enchant';
  const state = eventState(event, choiceId);
  state.pieces.forEach((piece) => { piece.enchantmentId = null; });
  const firstUid = [...state.pieces].sort((a, b) => Number(a.uid.slice(1)) - Number(b.uid.slice(1)))[0].uid;
  const nextUid = [...state.pieces].sort((a, b) => Number(a.uid.slice(1)) - Number(b.uid.slice(1)))[1].uid;
  state.currentEvent = eventForNode(state, ctx, event.id);
  assert.equal(state.currentEvent.choices.find((choice) => choice.id === choiceId).enchantmentOffer.targetUid, firstUid);

  const sold = applyAction(state, { type: 'sell', uid: firstUid, opId: 'offer-sale', expectedRevision: state.revision }, ctx).state;
  assert.equal(sold.currentEvent.choices.find((choice) => choice.id === choiceId).enchantmentOffer.targetUid, firstUid);
  const rngBeforeView = sold.rngState;
  const goldBeforeView = sold.gold;
  const snapshotBeforeView = structuredClone(sold);
  const view1 = viewRun(sold, ctx);
  const view2 = viewRun(sold, ctx);
  const refreshedChoice = view1.choices.find((choice) => choice.id === choiceId);
  assert.equal(refreshedChoice.enchantmentOffer.targetUid, nextUid);
  assert.equal(refreshedChoice.targets[0].targetUid, nextUid);
  assert.equal(view1.currentEvent.choices.find((choice) => choice.id === choiceId).enchantmentOffer.targetUid, nextUid);
  assert.equal(view2.choices.find((choice) => choice.id === choiceId).enchantmentOffer.targetUid, nextUid);
  assert.equal(view1.choices.find((choice) => choice.id === choiceId).enabled, true);
  assert.deepEqual(sold, snapshotBeforeView);
  assert.equal(sold.rngState, rngBeforeView);
  assert.equal(sold.gold, goldBeforeView);

  const confirmed = applyAction(sold, { type: 'confirmEvent', choiceId, opId: 'offer-confirm', expectedRevision: sold.revision }, ctx).state;
  assert.equal(confirmed.history.find((entry) => entry.kind === 'eventEnchantment').targetUid, nextUid);
  assert.equal(confirmed.gold, goldBeforeView);
  assert.notEqual(confirmed.rngState, rngBeforeView);

  const empty = eventState(event, choiceId);
  const emptyFirst = [...empty.pieces].sort((a, b) => Number(a.uid.slice(1)) - Number(b.uid.slice(1)))[0];
  empty.pieces.forEach((piece) => { piece.enchantmentId = 'enchant_golden'; });
  emptyFirst.enchantmentId = null;
  empty.currentEvent = eventForNode(empty, ctx, event.id);
  const emptied = applyAction(empty, { type: 'sell', uid: emptyFirst.uid, opId: 'empty-offer-sale', expectedRevision: empty.revision }, ctx).state;
  const emptySnapshot = structuredClone(emptied);
  const disabledView = viewRun(emptied, ctx);
  const disabledChoice = disabledView.choices.find((choice) => choice.id === choiceId);
  assert.equal(disabledChoice.enabled, false);
  assert.equal(disabledChoice.disabledReason, 'NO_ENCHANTMENT_TARGET');
  assert.equal(disabledChoice.enchantmentOffer, null);
  assert.deepEqual(emptied, emptySnapshot);
  assert.throws(() => applyAction(emptied, { type: 'confirmEvent', choiceId, opId: 'empty-offer-confirm', expectedRevision: emptied.revision }, ctx), { code: 'NO_ENCHANTMENT_TARGET' });
  assert.deepEqual(emptied, emptySnapshot);
});

test('leave is free, action preflight is atomic, and unknown event kinds fail closed', () => {
  const event = events.events.find((entry) => entry.choices.some((choice) => choice.id.endsWith('_leave')));
  const leave = event.choices.find((choice) => choice.id.endsWith('_leave'));
  const state = eventState(event, leave.id);
  const beforeGold = state.gold;
  const afterLeave = applyAction(state, { type: 'leaveEvent', free_leave_choice_id: leave.id, opId: 'leave', expectedRevision: 0 }, ctx).state;
  assert.equal(afterLeave.gold, beforeGold);
  assert.ok(afterLeave.visitedEvents.includes(event.id));

  const costlyEvent = events.events.find((entry) => entry.choices.some((choice) => choice.costs?.some((cost) => cost.currency === 'gold')));
  const costlyChoice = costlyEvent.choices.find((choice) => choice.costs?.some((cost) => cost.currency === 'gold'));
  const poor = eventState(costlyEvent, costlyChoice.id);
  poor.gold = 0;
  poor.currentEvent = eventForNode(poor, ctx, costlyEvent.id);
  const snapshot = structuredClone(poor);
  assert.throws(() => applyAction(poor, { type: 'confirmEvent', choiceId: costlyChoice.id, ...targetFor(poor, costlyChoice), opId: 'poor', expectedRevision: 0 }, ctx), { code: 'INSUFFICIENT_CURRENCY' });
  assert.deepEqual(poor, snapshot);

  const recruitEvent = events.events.find((entry) => entry.choices.some((choice) => choice.targeting?.mode === 'recruit'));
  const recruitChoice = recruitEvent.choices.find((choice) => choice.targeting?.mode === 'recruit');
  const noTarget = eventState(recruitEvent, recruitChoice.id);
  const noTargetBefore = structuredClone(noTarget);
  assert.throws(() => applyAction(noTarget, { type: 'confirmEvent', choiceId: recruitChoice.id, opId: 'no-target', expectedRevision: 0 }, ctx), { code: 'TARGET_REQUIRED' });
  assert.deepEqual(noTarget, noTargetBefore);

  const invalidDesign = structuredClone(events);
  invalidDesign.events[0].choices[0].outcomes[0].effects.push({ kind: 'not-supported' });
  assert.throws(() => validateEventDesign({ events: invalidDesign }), { code: 'UNKNOWN_EVENT_EFFECT' });
});

test('recruit preview exposes every selectable profession or faction before a target is chosen', () => {
  const event = events.events.find((entry) => entry.choices.some((choice) => choice.targeting?.mode === 'recruit' && choice.targeting.selection !== 'random'));
  const source = event.choices.find((choice) => choice.targeting?.mode === 'recruit' && choice.targeting.selection !== 'random');
  const state = eventState(event, source.id);
  const choice = state.currentEvent.choices.find((entry) => entry.id === source.id);
  const expectedFilters = [...new Set(Object.values(operators).map((operator) => source.targeting.selection === 'profession' ? operator.profession : operator.nationId).filter(Boolean))];
  assert.deepEqual(choice.recruitFilters, expectedFilters);
  assert.ok(choice.targets.length > 0);
  assert.equal(choice.enabled, true);
  assert.equal(choice.disabledReason, null);
  assert.throws(() => applyAction(state, { type: 'confirmEvent', choiceId: source.id, opId: 'recruit-needs-target', expectedRevision: state.revision }, ctx), { code: 'TARGET_REQUIRED' });
});
