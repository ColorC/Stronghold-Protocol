import test from 'node:test';
import assert from 'node:assert/strict';
import { resonanceContent } from '../../shared/resonance/catalog.js';
import { applyAction, createSession, viewSession } from '../../server/modes/resonance/session.js';

const canonical = resonanceContent;
const byCost = (id) => Number(canonical.operators[id]?.cost);
const field = { deployMap: new Map(Array.from({ length: 12 }, (_, row) =>
  Array.from({ length: 12 }, (_, col) => [`${row},${col}`, col % 2 ? 'ranged' : 'melee'])).flat()) };
const fieldResolver = () => field;

function storyCatalog(strategyIds, { battleNode = false } = {}) {
  const strategies = Object.fromEntries(strategyIds.map((id) => [id, canonical.strategies[id]]));
  return {
    ...canonical,
    strategies,
    campaign: { ...canonical.campaign, strategyNodes: battleNode ? [3] : [3] },
  };
}

function fresh(catalog, seed = 217) {
  const created = createSession({ seed, difficulty: 'NORMAL', catalog });
  assert.equal(created.ok, true, created.error);
  const state = created.state;
  state.round = 3;
  state.nodeStarted = false;
  state.claimedNodes = [1, 2];
  return state;
}

function deploy(state, catalog, piece = state.pieces.find((entry) => entry.row === null)) {
  assert.ok(piece, 'fixture must have an undeployed piece');
  const position = canonical.operators[piece.operatorId].position === 'MELEE' ? 'melee' : 'ranged';
  const cell = [...field.deployMap].find(([key, value]) => value === position
    && !state.pieces.some((entry) => entry.row === Number(key.split(',')[0]) && entry.col === Number(key.split(',')[1])));
  assert.ok(cell, `fixture must have a legal ${position} cell`);
  const [row, col] = cell[0].split(',').map(Number);
  const result = applyAction(state, { type: 'deploy', pieceUid: piece.uid, row, col, dir: 'RIGHT' }, { catalog, fieldResolver });
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function holdOne(state, operatorId, uid) {
  assert.ok(state.poolRemaining[operatorId] > 0, `${operatorId} remains in the common pool`);
  state.poolRemaining[operatorId]--;
  state.pieces.push({ uid, operatorId, star: 1, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT' });
}

function offerAndChoose(state, catalog, strategyId, options = {}) {
  const supplied = applyAction(state, { type: 'advanceSupply' }, { catalog });
  assert.equal(supplied.ok, true, supplied.error);
  const choice = supplied.state.pendingChoices.find((entry) => entry.type === 'strategy');
  assert.ok(choice, `${strategyId} should be offered from the canonical strategy node`);
  assert.ok(choice.options.includes(strategyId), `${strategyId} must be the actual offered canonical choice`);
  const selected = applyAction(supplied.state, {
    type: 'chooseStrategy', choiceUid: choice.uid, strategyId, ...options,
  }, { catalog });
  assert.equal(selected.ok, true, selected.error);
  assert.equal(selected.events.find((event) => event.type === 'strategy-chosen')?.eligible, true,
    `${strategyId} must take its configured effect, not its fallback`);
  return selected.state;
}

function claimRoutineComponentSupply(state, catalog) {
  while (true) {
    const choice = state.pendingChoices.find((entry) => entry.type === 'components');
    if (!choice) return state;
    const result = applyAction(state, {
      type: 'claimReward', choiceUid: choice.uid, optionIds: choice.options.slice(0, choice.remaining),
    }, { catalog });
    assert.equal(result.ok, true, result.error);
    state = result.state;
  }
}

test('canonical non-battle strategies enter through supply and apply their configured state/reward path', () => {
  const ids = Object.values(canonical.strategies).filter((entry) => entry.group !== 'battle').map((entry) => entry.id);
  assert.equal(ids.length, 30, 'the canonical catalog has 30 strategies outside the six real Battle strategies');

  for (const strategyId of ids) {
    const catalog = storyCatalog([strategyId]);
    let state = fresh(catalog);
    const effect = canonical.strategies[strategyId].effects[0];

    if (effect.kind === 'target_copy') state = deploy(state, catalog);
    if (effect.kind === 'disassemble_recipe_item' || effect.kind === 'free_disassemble_and_recipe') {
      state.inventory = [{ uid: 'story-completed-item', itemId: 'giantSlayer' }];
    }
    if (effect.kind === 'late_game') state.gold = Math.max(state.gold, Math.abs(effect.params.startGold));
    const beforeGold = state.gold;
    const beforeXp = state.xp;
    state = offerAndChoose(state, catalog, strategyId);

    assert.ok(state.strategies.some((entry) => entry.id === strategyId), `${strategyId}: selected policy is saved`);
    const entry = state.strategyState[strategyId];
    switch (effect.kind) {
      case 'gold': assert.equal(state.gold, beforeGold + effect.params.amount, strategyId); break;
      case 'xp': assert.ok(state.xp > beforeXp || state.level > 3, strategyId); break;
      case 'choose_components': assert.equal(state.pendingChoices.find((choice) => choice.source === strategyId)?.type, 'components', strategyId); break;
      case 'choose_pool_operators': assert.equal(state.pendingChoices.find((choice) => choice.source === strategyId)?.type, 'operators', strategyId); break;
      case 'disassemble_recipe_item': assert.equal(state.pendingChoices.find((choice) => choice.source === strategyId)?.type, 'disassemble', strategyId); break;
      case 'target_copy': assert.equal(state.pendingChoices.find((choice) => choice.source === strategyId)?.type, 'target_piece', strategyId); break;
      case 'delayed_operator': assert.equal(state.pendingChoices.find((choice) => choice.source === strategyId)?.type, 'target_operator', strategyId); break;
      case 'choose_transfer': assert.equal(state.pendingChoices.find((choice) => choice.source === strategyId)?.type, 'transfer', strategyId); break;
      case 'dual_pact': assert.equal(state.pendingChoices.find((choice) => choice.source === strategyId)?.type, 'dual_pact', strategyId); break;
      case 'sell_bonus': assert.equal(entry.uses, effect.params.uses, strategyId); break;
      case 'interest_cap': assert.equal(entry.amount, effect.params.amount, strategyId); break;
      case 'xp_discount': assert.equal(entry.uses, effect.params.uses, strategyId); break;
      case 'refresh_discount': assert.equal(entry.paidRefreshEvery, effect.params.paidRefreshEvery, strategyId); break;
      case 'pact_set_reward': assert.equal(entry.rewardedPact, undefined, strategyId); break;
      case 'metric_reward': assert.equal(entry.progress, 0, strategyId); break;
      case 'risk_exchange': assert.equal(state.hp, 100 - effect.params.hpCost, strategyId); assert.equal(state.gold, beforeGold + effect.params.gold, strategyId); break;
      case 'bench_capacity_and_gold': assert.equal(entry.capacity, effect.params.capacity, strategyId); break;
      case 'shop_rule': assert.equal(entry.lockDisabled, true, strategyId); break;
      case 'unique_nation_core': assert.equal(entry.attack, effect.params.attack, strategyId); break;
      case 'delayed_income': assert.equal(entry.held, 0, strategyId); break;
      case 'victory_tradeoff': assert.equal(entry.hpCost, effect.params.hpCost, strategyId); break;
      case 'low_cost_specialist': assert.equal(entry.hp, effect.params.hp, strategyId); break;
      case 'late_game': assert.equal(state.gold, beforeGold + effect.params.startGold, strategyId); break;
      case 'flexible_core': assert.equal(entry.lockBattles, effect.params.lockBattles, strategyId); break;
      case 'free_disassemble_and_recipe': assert.equal(entry.everyNodes, effect.params.everyNodes, strategyId); break;
      default: assert.fail(`No story assertion for canonical non-battle strategy ${strategyId} (${effect.kind})`);
    }

    if (effect.kind === 'choose_components') {
      const choice = state.pendingChoices.find((candidate) => candidate.source === strategyId);
      const beforeCount = state.inventory.length;
      const claimed = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: choice.options.slice(0, choice.remaining) }, { catalog });
      assert.equal(claimed.ok, true, claimed.error);
      assert.equal(claimed.state.inventory.length, beforeCount + effect.params.count);
      state = claimed.state;
    }
    if (effect.kind === 'choose_pool_operators') {
      const choice = state.pendingChoices.find((candidate) => candidate.source === strategyId);
      const beforeCount = state.pieces.length;
      const claimed = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: choice.options.slice(0, choice.remaining) }, { catalog });
      assert.equal(claimed.ok, true, claimed.error);
      assert.equal(claimed.state.pieces.length, beforeCount + effect.params.count);
      state = claimed.state;
    }
    if (effect.kind === 'sell_bonus') {
      const candidate = Object.values(canonical.operators).find((operator) => operator.cost >= effect.params.costMin
        && operator.cost <= Number(effect.params.costMax ?? Infinity) && state.poolRemaining[operator.id] >= 3
        && !state.pieces.some((piece) => piece.operatorId === operator.id));
      assert.ok(candidate && state.poolRemaining[candidate.id] >= 3);
      state.poolRemaining[candidate.id] -= 3;
      const sale = { uid: 'star-two-sale', operatorId: candidate.id, star: 2, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT' };
      state.pieces.push(sale);
      const sold = applyAction(state, { type: 'sell', pieceUid: sale.uid }, { catalog });
      assert.equal(sold.ok, true, sold.error);
      assert.equal(sold.events.find((event) => event.type === 'operator-sold').bonus, effect.params.amount);
      assert.equal(sold.state.strategyState[strategyId].uses, effect.params.uses - 1);
      state = sold.state;
    }
    if (effect.kind === 'xp_discount') {
      const boughtXp = applyAction(state, { type: 'buyXp' }, { catalog });
      assert.equal(boughtXp.ok, true, boughtXp.error);
      assert.equal(boughtXp.events.find((event) => event.type === 'xp-purchased').gold,
        canonical.campaign.economy.xpPurchase.gold - effect.params.amount);
      assert.equal(boughtXp.state.strategyState[strategyId].uses, effect.params.uses - 1);
      state = boughtXp.state;
    }
    if (effect.kind === 'refresh_discount') {
      const costs = [];
      for (let refreshIndex = 0; refreshIndex < effect.params.paidRefreshEvery; refreshIndex++) {
        const refreshed = applyAction(state, { type: 'refresh' }, { catalog });
        assert.equal(refreshed.ok, true, refreshed.error);
        costs.push(refreshed.events.find((event) => event.type === 'shop-refreshed').cost);
        state = refreshed.state;
      }
      assert.deepEqual(costs, [2, 2, 0]);
    }
    if (effect.kind === 'interest_cap') {
      assert.equal(viewSession(state, { catalog }).actionCosts.interestCap,
        canonical.campaign.economy.interest.cap + effect.params.amount);
    }
    if (effect.kind === 'choose_transfer') {
      const choice = state.pendingChoices.find((candidate) => candidate.source === strategyId);
      const itemId = choice.options[0];
      const claimed = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: [itemId] }, { catalog });
      assert.equal(claimed.ok, true, claimed.error);
      assert.ok(claimed.state.inventory.some((item) => item.itemId === itemId));
      state = claimed.state;
    }

    if (effect.kind === 'disassemble_recipe_item') {
      const choice = state.pendingChoices.find((candidate) => candidate.type === 'disassemble' && candidate.source === strategyId);
      const disassembled = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: [choice.options[0]] }, { catalog });
      assert.equal(disassembled.ok, true, disassembled.error);
      assert.deepEqual(disassembled.state.inventory.map((item) => item.itemId), ['blade', 'blade']);
      state = disassembled.state;
    }

    if (effect.kind === 'target_copy') {
      const choice = state.pendingChoices.find((candidate) => candidate.type === 'target_piece');
      const targetUid = choice.options[0];
      const bad = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: ['not-a-piece'] }, { catalog });
      assert.equal(bad.error, 'INVALID_REWARD_OPTION', `${strategyId}: rejects an unoffered target without mutating state`);
      assert.deepEqual(bad.state, state);
      const claimed = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: [targetUid] }, { catalog });
      assert.equal(claimed.ok, true, claimed.error);
      assert.equal(claimed.state.strategyState[strategyId].targetUid, targetUid);
      assert.equal(claimed.state.strategyState[strategyId].targetWins, effect.params.wins);
      assert.equal(claimed.state.strategyState[strategyId].observedWins, 0);
      state = claimed.state;
      const runner = () => ({ won: true, hpLoss: 0, diagnostics: { errorCount: 0 }, metrics: {} });
      for (let win = 0; win < effect.params.wins; win++) {
        const fought = applyAction(state, { type: 'fight' }, { catalog, fieldResolver, battleRunner: runner });
        assert.equal(fought.ok, true, fought.error);
        state = fought.state;
        assert.equal(state.strategyState[strategyId].observedWins, win + 1);
        if (win + 1 < effect.params.wins) {
          const supply = applyAction(state, { type: 'advanceSupply' }, { catalog });
          assert.equal(supply.ok, true, supply.error);
          state = claimRoutineComponentSupply(supply.state, catalog);
        }
      }
      const reward = state.pendingChoices.find((candidate) => candidate.source === strategyId && candidate.type === 'operators');
      assert.ok(reward, 'three wins deliver a pool-aware copy choice');
      assert.deepEqual(reward.options, [state.strategyState[strategyId].targetOperatorId]);
      const stockBeforeCopy = state.poolRemaining[reward.options[0]];
      const claimedCopy = applyAction(state, { type: 'claimReward', choiceUid: reward.uid, optionIds: reward.options }, { catalog });
      assert.equal(claimedCopy.ok, true, claimedCopy.error);
      assert.equal(claimedCopy.state.poolRemaining[reward.options[0]], stockBeforeCopy - 1,
        'the selected copy comes from the finite shared operator pool');
      state = claimedCopy.state;
      const nextSupply = applyAction(state, { type: 'advanceSupply' }, { catalog });
      assert.equal(nextSupply.ok, true, nextSupply.error);
      state = claimRoutineComponentSupply(nextSupply.state, catalog);
      const extraWin = applyAction(state, { type: 'fight' }, { catalog, fieldResolver, battleRunner: runner });
      assert.equal(extraWin.ok, true, extraWin.error);
      assert.equal(extraWin.state.strategyState[strategyId].observedWins, effect.params.wins + 1);
      assert.equal(extraWin.state.strategyState[strategyId].copyDelivered, true);
      assert.equal(extraWin.state.pendingChoices.some((candidate) => candidate.source === strategyId && candidate.type === 'operators'), false,
        'the target copy is paid only once');
    }

    if (effect.kind === 'dual_pact') {
      let choice = state.pendingChoices.find((candidate) => candidate.type === 'dual_pact');
      const ownerUid = choice.options[0];
      let claimed = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: [ownerUid] }, { catalog });
      assert.equal(claimed.ok, true, claimed.error);
      state = claimed.state;
      choice = state.pendingChoices.find((candidate) => candidate.type === 'pact_tag');
      assert.ok(choice?.options.length, 'dual pact must produce a valid pact-tag choice for its selected owner');
      const pactId = choice.options.find((id) => !(canonical.operators[state.pieces.find((piece) => piece.uid === ownerUid).operatorId].pacts ?? []).includes(id));
      assert.ok(pactId);
      claimed = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: [pactId] }, { catalog });
      assert.equal(claimed.ok, true, claimed.error);
      assert.ok(claimed.state.pieces.find((piece) => piece.uid === ownerUid).extraPacts.includes(pactId));
    }
  }
});

test('canonical equipment furnace disassembles and completes a recipe through the node-gated action', () => {
  const strategyId = 'strategy_30';
  const catalog = storyCatalog([strategyId]);
  let state = fresh(catalog);
  state = deploy(state, catalog);
  state.inventory = [{ uid: 'furnace-input', itemId: 'giantSlayer' }];
  state = offerAndChoose(state, catalog, strategyId);
  let result = applyAction(state, { type: 'fight' }, {
    catalog, fieldResolver,
    battleRunner: () => ({ won: true, hpLoss: 0, diagnostics: { errorCount: 0 }, metrics: {} }),
  });
  assert.equal(result.ok, true, result.error);
  state = result.state;
  result = applyAction(state, { type: 'advanceSupply' }, { catalog });
  assert.equal(result.ok, true, result.error);
  state = claimRoutineComponentSupply(result.state, catalog);
  const completed = state.inventory.find((item) => item.itemId === 'giantSlayer');
  assert.ok(completed, 'the completed input persists until the scheduled free dismantle');
  result = applyAction(state, { type: 'disassemble', itemUid: completed.uid }, { catalog });
  assert.equal(result.ok, true, result.error);
  state = result.state;
  const recipe = state.pendingChoices.find((choice) => choice.type === 'recipe' && choice.source === strategyId);
  assert.ok(recipe?.options.includes('giantSlayer'));
  result = applyAction(state, { type: 'claimReward', choiceUid: recipe.uid, optionIds: ['giantSlayer'] }, { catalog });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.inventory.filter((item) => item.itemId === 'giantSlayer').length, 1);
  assert.equal(result.state.strategyState[strategyId].lastUsedNode, 4);
  assert.equal(applyAction(result.state, { type: 'disassemble', itemUid: result.state.inventory.find((item) => item.itemId === 'giantSlayer').uid }, { catalog }).error,
    'DISASSEMBLE_NOT_AVAILABLE');
});

test('target-copy counters ignore losses and wins without the selected operator deployed', () => {
  const strategyId = 'strategy_11';
  const catalog = storyCatalog([strategyId]);
  let state = deploy(fresh(catalog), catalog);
  state = offerAndChoose(state, catalog, strategyId);
  const choice = state.pendingChoices.find((entry) => entry.type === 'target_piece');
  const targetUid = choice.options[0];
  let result = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: [targetUid] }, { catalog });
  assert.equal(result.ok, true, result.error);
  state = result.state;
  result = applyAction(state, { type: 'fight' }, {
    catalog, fieldResolver,
    battleRunner: () => ({ won: false, hpLoss: 1, diagnostics: { errorCount: 0 }, metrics: {} }),
  });
  assert.equal(result.ok, true, result.error);
  state = result.state;
  assert.equal(state.strategyState[strategyId].observedWins, 0, 'a lost battle does not advance the target-copy counter');
  const supply = applyAction(state, { type: 'advanceSupply' }, { catalog });
  assert.equal(supply.ok, true, supply.error);
  state = claimRoutineComponentSupply(supply.state, catalog);
  const target = state.pieces.find((piece) => piece.uid === targetUid);
  result = applyAction(state, { type: 'bench', pieceUid: targetUid }, { catalog });
  assert.equal(result.ok, true, result.error);
  state = result.state;
  const other = state.pieces.find((piece) => piece.uid !== targetUid && piece.row === null);
  state = deploy(state, catalog, other);
  result = applyAction(state, { type: 'fight' }, {
    catalog, fieldResolver,
    battleRunner: () => ({ won: true, hpLoss: 0, diagnostics: { errorCount: 0 }, metrics: {} }),
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.strategyState[strategyId].observedWins, 0,
    'a win while the explicitly selected target is benched does not advance its counter');
  assert.equal(result.state.pieces.find((piece) => piece.uid === target.uid).row, null);
});

test('all 19 canonical environments initialize their identity and authoritative component-supply rules', () => {
  const environments = Object.values(canonical.environments);
  assert.equal(environments.length, 19);
  for (const environment of environments) {
    const created = createSession({ seed: 407, difficulty: 'NORMAL', environmentId: environment.id, catalog: canonical });
    assert.equal(created.ok, true, `${environment.id}: ${created.error}`);
    let state = created.state;
    assert.equal(state.environmentId, environment.id);
    state.round = environment.rule.kind === 'environment_component_supply' ? 8 : 4;
    state.nodeStarted = false;
    state.claimedNodes = Array.from({ length: state.round - 1 }, (_, index) => index + 1);
    const result = applyAction(state, { type: 'advanceSupply' }, { catalog: canonical });
    assert.equal(result.ok, true, `${environment.id}: ${result.error}`);
    state = result.state;
    const componentChoices = state.pendingChoices.filter((choice) => choice.type === 'components');
    assert.equal(componentChoices.length, environment.rule.kind === 'environment_component_supply' ? 2 : 1, environment.id);
    const baseCount = environment.rule.kind === 'environment_component_choice' ? 4 : 3;
    assert.equal(componentChoices[0].options.length, baseCount, `${environment.id}: normal/environment-adjusted option count`);
    if (environment.rule.kind === 'environment_component_supply') {
      assert.equal(componentChoices[1].source, environment.id);
      assert.equal(componentChoices[1].remaining, environment.rule.params.count);
    }
  }
});

test('canonical double crest recipe keeps identity transfer pending until the chosen emblem is installed', () => {
  let state = fresh(canonical);
  state.inventory = [
    { uid: 'story-crest-a', itemId: 'crest' },
    { uid: 'story-crest-b', itemId: 'crest' },
  ];
  let result = applyAction(state, { type: 'combine', itemUids: ['story-crest-a', 'story-crest-b'] }, { catalog: canonical });
  assert.equal(result.ok, true, result.error);
  state = result.state;
  const pending = state.pendingChoices.find((choice) => choice.type === 'identity_transfer');
  assert.ok(pending);
  assert.ok(pending.options.includes('aegir'));
  const bad = applyAction(state, { type: 'claimReward', choiceUid: pending.uid, optionIds: ['not-an-identity'] }, { catalog: canonical });
  assert.equal(bad.error, 'INVALID_REWARD_OPTION');
  assert.deepEqual(bad.state, state);
  result = applyAction(state, { type: 'claimReward', choiceUid: pending.uid, optionIds: ['aegir'] }, { catalog: canonical });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.inventory[0].itemId, 'transfer_aegir');
  assert.equal(result.state.pendingChoices.some((choice) => choice.type === 'identity_transfer'), false);
});

test('canonical pact-transfer strategy honors full-inventory capacity atomically', () => {
  const strategyId = 'strategy_25';
  const catalog = storyCatalog([strategyId]);
  let state = fresh(catalog);
  state.inventory = Array.from({ length: 20 }, (_, index) => ({ uid: `capacity-${index}`, itemId: 'blade' }));
  state = offerAndChoose(state, catalog, strategyId);
  const choice = state.pendingChoices.find((entry) => entry.type === 'transfer');
  assert.ok(choice?.options.includes('aegirTransfer'));
  const rejected = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: ['aegirTransfer'] }, { catalog });
  assert.equal(rejected.error, 'INVENTORY_CAPACITY');
  assert.deepEqual(rejected.state, state);
});

test('delayed operator waits four node transitions, then delivers the selected canonical four-cost unit', () => {
  const strategyId = 'strategy_12';
  const catalog = storyCatalog([strategyId]);
  let state = deploy(fresh(catalog), catalog);
  state = offerAndChoose(state, catalog, strategyId);
  let choice = state.pendingChoices.find((entry) => entry.type === 'target_operator');
  const selectedOperatorId = choice.options[0];
  let result = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: [selectedOperatorId] }, { catalog });
  assert.equal(result.ok, true, result.error);
  state = result.state;
  assert.equal(state.strategyState[strategyId].dueRound, 7);
  assert.equal(byCost(selectedOperatorId), canonical.strategies[strategyId].effects[0].params.cost);

  const runner = () => ({ won: true, hpLoss: 0, diagnostics: { errorCount: 0 }, metrics: {} });
  for (let node = 3; node < 7; node++) {
    result = applyAction(state, { type: 'fight' }, { catalog, fieldResolver, battleRunner: runner });
    assert.equal(result.ok, true, result.error);
    state = result.state;
    result = applyAction(state, { type: 'advanceSupply' }, { catalog });
    assert.equal(result.ok, true, result.error);
    state = claimRoutineComponentSupply(result.state, catalog);
    const delivered = state.pendingChoices.find((entry) => entry.source === strategyId && entry.type === 'operators');
    if (node + 1 < 7) assert.equal(!!delivered, false, `node ${node + 1}: selected unit is not due yet`);
  }
  choice = state.pendingChoices.find((entry) => entry.source === strategyId && entry.type === 'operators');
  assert.ok(choice, 'node 7 opens the deferred operator reward');
  assert.deepEqual(choice.options, [selectedOperatorId]);
  const fullBench = structuredClone(state);
  const heldIds = new Set(fullBench.pieces.map((piece) => piece.operatorId));
  const additions = Object.values(canonical.operators)
    .filter((operator) => !heldIds.has(operator.id) && operator.id !== selectedOperatorId).slice(0, 7);
  assert.equal(additions.length, 7);
  for (const [index, operator] of additions.entries()) holdOne(fullBench, operator.id, `delayed-full-${index}`);
  assert.equal(fullBench.pieces.filter((piece) => piece.row === null).length, 9);
  const capacity = applyAction(fullBench, { type: 'claimReward', choiceUid: choice.uid, optionIds: [selectedOperatorId] }, { catalog });
  assert.equal(capacity.error, 'BENCH_FULL');
  assert.deepEqual(capacity.state, fullBench, 'a full bench retains the deferred unit selection without consuming pool copies');
  result = applyAction(state, { type: 'claimReward', choiceUid: choice.uid, optionIds: [selectedOperatorId] }, { catalog });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.pieces.filter((piece) => piece.operatorId === selectedOperatorId).length, 1);
});

test('canonical task strategies settle battle metrics into their configured rewards and once-only state', () => {
  const cases = [
    ['strategy_13', { controlTriggers: 20 }, (state) => assert.ok(state.consumables.some((item) => item.kind === 'smallCopy'))],
    ['strategy_14', { ammoSpent: 60 }, (state) => assert.equal(state.pendingChoices.at(-1)?.type, 'components')],
    ['strategy_15', { constructAttacks: 80 }, (state) => assert.ok(state.consumables.some((item) => item.kind === 'universalCopy'))],
    ['strategy_16', { effectiveHealing: 20000 }, (state, catalog) => assert.ok(state.pendingChoices.at(-1)?.options.some((id) => id.includes('symbiosis')))],
    ['strategy_18', { eliteKills: 3 }, (state) => assert.ok(state.xp > 2 || state.level > 3)],
  ];
  for (const [strategyId, metrics, assertReward] of cases) {
    const catalog = storyCatalog([strategyId]);
    let state = fresh(catalog);
    state = deploy(state, catalog);
    state = offerAndChoose(state, catalog, strategyId);
    const result = applyAction(state, { type: 'fight' }, {
      catalog, fieldResolver,
      battleRunner: () => ({ won: true, hpLoss: 0, diagnostics: { errorCount: 0 }, metrics }),
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.state.strategyState[strategyId].rewarded, true, `${strategyId} completes from the fight result`);
    assertReward(result.state, catalog);
  }

  const streakId = 'strategy_17';
  const catalog = storyCatalog([streakId]);
  let state = deploy(fresh(catalog), catalog);
  state = offerAndChoose(state, catalog, streakId);
  const goldBefore = state.gold;
  for (let round = 0; round < 2; round++) {
    const fight = applyAction(state, { type: 'fight' }, {
      catalog, fieldResolver,
      battleRunner: () => ({ won: true, hpLoss: 0, diagnostics: { errorCount: 0 }, metrics: { leaked: 0 } }),
    });
    assert.equal(fight.ok, true, fight.error);
    state = fight.state;
    if (round === 0) {
      const supply = applyAction(state, { type: 'advanceSupply' }, { catalog });
      assert.equal(supply.ok, true, supply.error);
      state = claimRoutineComponentSupply(supply.state, catalog);
    }
    if (round === 0) assert.notEqual(state.strategyState[streakId].rewarded, true);
  }
  assert.equal(state.strategyState[streakId].rewarded, true);
  assert.ok(state.gold >= goldBefore + canonical.strategies[streakId].effects[0].params.amount,
    'the configured streak reward is paid in addition to ordinary node income');
});

test('canonical compact logistics and delayed-wage rules affect the actual prep and income actions', () => {
  const compactId = 'strategy_20';
  const compactCatalog = storyCatalog([compactId]);
  let compact = deploy(fresh(compactCatalog), compactCatalog);
  compact = offerAndChoose(compact, compactCatalog, compactId);
  const alreadyOwned = new Set(compact.pieces.map((piece) => piece.operatorId));
  for (const operator of Object.values(canonical.operators).filter((entry) => !alreadyOwned.has(entry.id)).slice(0, 5)) {
    assert.ok(compact.poolRemaining[operator.id] > 0);
    compact.poolRemaining[operator.id]--;
    compact.pieces.push({ uid: `compact-${operator.id}`, operatorId: operator.id, star: 1, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT' });
  }
  assert.equal(compact.pieces.filter((piece) => piece.row === null).length, 7);
  compact.consumables.push({ uid: 'compact-copy', kind: 'smallCopy', source: 'story' });
  const blocked = applyAction(compact, {
    type: 'useCopy', consumableUid: 'compact-copy', pieceUid: compact.pieces.find((piece) => piece.row !== null).uid,
  }, { catalog: compactCatalog });
  assert.equal(blocked.error, 'BENCH_FULL', 'the configured seven-piece bench is enforced by the public copy action');
  const fought = applyAction(compact, { type: 'fight' }, {
    catalog: compactCatalog, fieldResolver,
    battleRunner: () => ({ won: true, hpLoss: 0, diagnostics: { errorCount: 0 }, metrics: {} }),
  });
  assert.equal(fought.ok, true, fought.error);
  assert.equal(fought.events.find((event) => event.type === 'fight-settled').strategyGold,
    canonical.strategies[compactId].effects[0].params.postBattleGold);

  const shopId = 'strategy_21';
  const shopCatalog = storyCatalog([shopId]);
  let shop = offerAndChoose(fresh(shopCatalog), shopCatalog, shopId);
  const refresh = applyAction(shop, { type: 'refresh' }, { catalog: shopCatalog });
  assert.equal(refresh.ok, true, refresh.error);
  assert.equal(refresh.events.find((event) => event.type === 'shop-refreshed').cost,
    canonical.strategies[shopId].effects[0].params.refreshCost);
  assert.equal(applyAction(shop, { type: 'lockShop', locked: true }, { catalog: shopCatalog }).error, 'SHOP_LOCK_DISABLED');

  const wageId = 'strategy_23';
  const wageCatalog = storyCatalog([wageId]);
  let wages = deploy(fresh(wageCatalog), wageCatalog);
  wages = offerAndChoose(wages, wageCatalog, wageId);
  const incomeEvents = [];
  for (let node = 0; node < canonical.strategies[wageId].effects[0].params.releaseNode; node++) {
    const result = applyAction(wages, { type: 'fight' }, {
      catalog: wageCatalog, fieldResolver,
      battleRunner: () => ({ won: true, hpLoss: 0, diagnostics: { errorCount: 0 }, metrics: {} }),
    });
    assert.equal(result.ok, true, result.error);
    wages = result.state;
    incomeEvents.push(result.events.find((event) => event.type === 'fight-settled'));
    if (node + 1 < canonical.strategies[wageId].effects[0].params.releaseNode) {
      const supply = applyAction(wages, { type: 'advanceSupply' }, { catalog: wageCatalog });
      assert.equal(supply.ok, true, supply.error);
      wages = claimRoutineComponentSupply(supply.state, wageCatalog);
    }
  }
  assert.deepEqual(incomeEvents.slice(0, 2).map((event) => event.income), [0, 0]);
  assert.equal(incomeEvents[2].delayedBonus,
    canonical.strategies[wageId].effects[0].params.holdNodes * canonical.campaign.economy.laterBaseGold
      + canonical.strategies[wageId].effects[0].params.bonus);
  assert.equal(wages.strategyState[wageId].released, true);

  const scarId = 'strategy_24';
  const scarCatalog = storyCatalog([scarId]);
  let scar = deploy(fresh(scarCatalog), scarCatalog);
  scar = offerAndChoose(scar, scarCatalog, scarId);
  const healedRun = applyAction(scar, { type: 'fight' }, {
    catalog: scarCatalog, fieldResolver,
    battleRunner: () => ({ won: true, hpLoss: 0, diagnostics: { errorCount: 0 }, metrics: {} }),
  });
  assert.equal(healedRun.ok, true, healedRun.error);
  assert.equal(healedRun.state.hp, 100 - canonical.strategies[scarId].effects[0].params.hpCost,
    'victory pays the authored HP tradeoff after battle settlement');
});

test('canonical set-pact, unique-core, low-cost and flexible-core rules change their matching public action paths', () => {
  const pactId = 'strategy_10';
  const pactCatalog = storyCatalog([pactId]);
  let pact = fresh(pactCatalog);
  for (const piece of pact.pieces) pact.poolRemaining[piece.operatorId]++;
  pact.pieces = [];
  pact.level = 4;
  const laterano = Object.values(canonical.operators).filter((operator) => operator.pacts?.includes('laterano')).slice(0, 4);
  assert.equal(laterano.length, canonical.strategies[pactId].effects[0].params.threshold);
  for (const [index, operator] of laterano.entries()) holdOne(pact, operator.id, `laterano-${index}`);
  for (let index = 0; index < laterano.length - 1; index++) pact = deploy(pact, pactCatalog, pact.pieces[index]);
  pact = offerAndChoose(pact, pactCatalog, pactId);
  const beforePactReward = pact.gold;
  pact = deploy(pact, pactCatalog, pact.pieces.find((piece) => piece.row === null));
  assert.equal(pact.strategyState[pactId].rewardedPact, true);
  assert.equal(pact.gold, beforePactReward + canonical.strategies[pactId].effects[0].params.gold);

  const uniqueId = 'strategy_22';
  const uniqueCatalog = storyCatalog([uniqueId]);
  let unique = fresh(uniqueCatalog);
  const source = unique.pieces[0];
  holdOne(unique, source.operatorId, 'duplicate-core');
  unique = deploy(unique, uniqueCatalog, source);
  unique = offerAndChoose(unique, uniqueCatalog, uniqueId);
  const duplicate = applyAction(unique, {
    type: 'deploy', pieceUid: 'duplicate-core', row: 0, col: 1, dir: 'RIGHT',
  }, { catalog: uniqueCatalog, fieldResolver });
  assert.equal(duplicate.error, 'DUPLICATE_CORE_IDENTITY');
  assert.deepEqual(duplicate.state, unique);

  const lowCostId = 'strategy_27';
  const lowCostCatalog = storyCatalog([lowCostId]);
  let lowCost = fresh(lowCostCatalog);
  const fiveCostId = Object.values(canonical.operators).find((operator) => operator.cost === 5).id;
  const offer = lowCost.shop.offers[0];
  if (offer.operatorId) lowCost.poolRemaining[offer.operatorId]++;
  assert.ok(lowCost.poolRemaining[fiveCostId] > 0);
  lowCost.poolRemaining[fiveCostId]--;
  offer.operatorId = fiveCostId;
  offer.cost = 5;
  const fiveCostOfferUid = offer.uid;
  lowCost = offerAndChoose(lowCost, lowCostCatalog, lowCostId);
  assert.equal(lowCost.shop.offers.some((entry) => entry.uid === fiveCostOfferUid), false,
    'selecting the canonical specialist rule immediately replaces any five-cost offer');
  assert.equal(lowCost.shop.offers.some((entry) => entry.cost === 5), false);
  const rerolled = applyAction(lowCost, { type: 'refresh' }, { catalog: lowCostCatalog });
  assert.equal(rerolled.ok, true, rerolled.error);
  assert.equal(rerolled.state.shop.offers.some((entry) => entry.cost === 5), false,
    'future public shop refreshes continue to exclude the forbidden tier');

  const flexibleId = 'strategy_29';
  const flexibleCatalog = storyCatalog([flexibleId]);
  let flexible = fresh(flexibleCatalog);
  const anchor = flexible.pieces[0];
  flexible = deploy(flexible, flexibleCatalog, anchor);
  const firstBattle = () => applyAction(flexible, { type: 'fight' }, {
    catalog: flexibleCatalog, fieldResolver,
    battleRunner: () => ({ won: true, hpLoss: 0, diagnostics: { errorCount: 0 }, metrics: {} }),
  });
  flexible = offerAndChoose(flexible, flexibleCatalog, flexibleId);
  for (let battle = 0; battle < 3; battle++) {
    const settled = firstBattle();
    assert.equal(settled.ok, true, settled.error);
    flexible = settled.state;
    if (battle < 2) {
      const supply = applyAction(flexible, { type: 'advanceSupply' }, { catalog: flexibleCatalog });
      assert.equal(supply.ok, true, supply.error);
      flexible = claimRoutineComponentSupply(supply.state, flexibleCatalog);
    }
  }
  const newCoreId = Object.values(canonical.operators).find((operator) => operator.cost === 5).id;
  holdOne(flexible, newCoreId, 'flexible-new-core');
  const nextNode = applyAction(flexible, { type: 'advanceSupply' }, { catalog: flexibleCatalog });
  assert.equal(nextNode.ok, true, nextNode.error);
  flexible = claimRoutineComponentSupply(nextNode.state, flexibleCatalog);
  flexible = deploy(flexible, flexibleCatalog, flexible.pieces.find((piece) => piece.uid === 'flexible-new-core'));
  const rotated = firstBattle();
  assert.equal(rotated.ok, true, rotated.error);
  assert.equal(rotated.state.strategyState[flexibleId].coreUid, 'flexible-new-core');
  assert.equal(rotated.state.strategyState[flexibleId].rewardedNode, flexible.round);
});

test('the six canonical Battle strategies are offered and their selected records reach the runner unchanged', () => {
  for (const strategyId of ['strategy_31', 'strategy_32', 'strategy_33', 'strategy_34', 'strategy_35', 'strategy_36']) {
    const catalog = storyCatalog([strategyId]);
    let state = fresh(catalog);
    const selectedUnits = strategyId === 'strategy_31'
      ? [
          ...Object.values(canonical.operators).filter((operator) => operator.position === 'MELEE').slice(0, 2),
          ...Object.values(canonical.operators).filter((operator) => operator.position === 'RANGED').slice(0, 2),
        ]
      : [
          Object.values(canonical.operators).find((operator) => operator.position === 'MELEE'),
          Object.values(canonical.operators).find((operator) => operator.position === 'RANGED'),
        ];
    for (const piece of state.pieces) state.poolRemaining[piece.operatorId]++;
    state.pieces = [];
    state.level = Math.max(4, selectedUnits.length);
    for (const [index, operator] of selectedUnits.entries()) holdOne(state, operator.id, `battle-story-${index}`);
    if (strategyId === 'strategy_32') {
      for (let index = 0; index < state.pieces.length; index++) {
        const row = 0, col = index;
        const result = applyAction(state, { type: 'deploy', pieceUid: state.pieces[index].uid, row, col, dir: 'RIGHT' }, { catalog, fieldResolver });
        assert.equal(result.ok, true, result.error);
        state = result.state;
      }
    } else {
      for (const piece of [...state.pieces]) state = deploy(state, catalog, state.pieces.find((entry) => entry.uid === piece.uid));
    }
    const chosen = applyAction(state, { type: 'advanceSupply' }, { catalog });
    assert.equal(chosen.ok, true, chosen.error);
    const choice = chosen.state.pendingChoices.find((entry) => entry.type === 'strategy');
    assert.ok(choice?.options.includes(strategyId), `${strategyId} is offered by its canonical strategy definition`);
    let result = applyAction(chosen.state, { type: 'chooseStrategy', choiceUid: choice.uid, strategyId }, { catalog });
    assert.equal(result.ok, true, result.error);
    state = result.state;
    if (strategyId === 'strategy_32') {
      const pair = state.pendingChoices.find((entry) => entry.type === 'pair');
      assert.ok(pair);
      result = applyAction(state, { type: 'claimReward', choiceUid: pair.uid, optionIds: pair.options.slice(0, 2) }, { catalog });
      assert.equal(result.ok, true, result.error);
      state = result.state;
    }
    let battleInput;
    result = applyAction(state, { type: 'fight' }, {
      catalog, fieldResolver,
      battleRunner: (input) => {
        battleInput = input;
        return { won: true, hpLoss: 0, diagnostics: { errorCount: 0 }, metrics: {} };
      },
    });
    assert.equal(result.ok, true, result.error);
    const selected = battleInput.strategies.find((entry) => (typeof entry === 'string' ? entry : entry.id) === strategyId);
    assert.ok(selected, `${strategyId} reaches the actual BattleRunner input`);
    assert.equal(battleInput.strategyState[strategyId].fallbackApplied, undefined);
    if (strategyId === 'strategy_32') assert.equal(selected.targets.pieceUids.length, 2);
    else assert.deepEqual(battleInput.strategyState[strategyId], {
      ...canonical.strategies[strategyId].effects[0].params, selectedRound: 3, progress: 0,
    });
  }
});

test('strategy choice rejects stale/duplicate selections and a selected conditional policy falls back once if invalidated', () => {
  const strategyId = 'strategy_19';
  const catalog = storyCatalog([strategyId]);
  let state = fresh(catalog);
  const supply = applyAction(state, { type: 'advanceSupply' }, { catalog });
  assert.equal(supply.ok, true, supply.error);
  const choice = supply.state.pendingChoices.find((entry) => entry.type === 'strategy');
  const absent = applyAction(supply.state, { type: 'chooseStrategy', choiceUid: 'expired-choice', strategyId }, { catalog });
  assert.equal(absent.error, 'STRATEGY_CHOICE_NOT_FOUND');
  assert.deepEqual(absent.state, supply.state);

  state = supply.state;
  state.hp = 20;
  const gold = state.gold;
  const selected = applyAction(state, { type: 'chooseStrategy', choiceUid: choice.uid, strategyId }, { catalog });
  assert.equal(selected.ok, true, selected.error);
  assert.equal(selected.events.find((event) => event.type === 'strategy-chosen').eligible, false);
  assert.equal(selected.state.hp, 20);
  assert.equal(selected.state.gold, gold + canonical.strategies[strategyId].invalidFallback.params.amount);
  assert.equal(selected.state.strategyState[strategyId].fallbackApplied, true);

  const duplicateState = structuredClone(selected.state);
  duplicateState.pendingChoices.push({ uid: 'fresh-second-offer', type: 'strategy', source: 'story-test', options: [strategyId], remaining: 1 });
  duplicateState.phase = 'choice';
  const duplicate = applyAction(duplicateState, { type: 'chooseStrategy', choiceUid: 'fresh-second-offer', strategyId }, { catalog });
  assert.equal(duplicate.error, 'STRATEGY_ALREADY_CHOSEN');
  assert.deepEqual(duplicate.state, duplicateState);
});
