import { codedError, pickWeighted } from './rng.js';

export function collectibleById(ctx, relicId) {
  const item = ctx.design.collectibles.items.find((entry) => entry.id === relicId);
  if (!item) throw codedError('UNKNOWN_RELIC', `Unknown collectible: ${relicId}`);
  return item;
}

function sourceAllows(item, source) {
  return item.acquisition?.some((entry) => entry.type === source.type && (source.value === undefined || entry.source === source.value || entry.pool === source.value));
}

/** @param {{ track?: string, rarity?: string, count?: number, source?: { type: string, value?: string } }} [options={}] */
export function relicCandidates(state, ctx, options = {}) {
  const { track, rarity, count = 3, source = { type: 'reward', value: 'battle' } } = options;
  let pool = ctx.design.collectibles.items.filter((item) => !state.relicIds.includes(item.id)
    && item.rarity !== 'starter'
    && item.unlockDay <= state.day
    && sourceAllows(item, source)
    && (!track || item.track === track)
    && (!rarity || item.rarity === rarity));
  const rarityWeights = state.day <= 2
    ? { common: 60, rare: 30, epic: 0 }
    : state.day <= 4
      ? { common: 60, rare: 35, epic: 5 }
      : { common: 60, rare: 30, epic: 10 };
  const candidates = [];
  let rngState = state.rngState >>> 0;
  while (candidates.length < count && pool.length) {
    const rarities = [...new Set(pool.map((item) => item.rarity))].map((value) => ({ value, weight: rarityWeights[value] ?? 0 }));
    const selectedRarity = pickWeighted(rarities, rngState);
    rngState = selectedRarity.state;
    if (!selectedRarity.value) break;
    const rarityPool = pool.filter((item) => item.rarity === selectedRarity.value.value);
    const selectedItem = pickWeighted(rarityPool.map((item) => ({ item, weight: 1 })), rngState);
    rngState = selectedItem.state;
    if (!selectedItem.value) break;
    candidates.push(selectedItem.value.item);
    pool = pool.filter((item) => item.id !== selectedItem.value.item.id);
  }
  return { candidates, rngState };
}

export function applyRelicAcquisition(state, ctx, relicId) {
  const item = collectibleById(ctx, relicId);
  if (state.relicIds.includes(relicId)) throw codedError('RELIC_OWNED', `Collectible already owned: ${relicId}`);
  if (item.rarity === 'starter') throw codedError('STARTER_RELIC_ONLY', 'Starter collectibles are exclusive to their director');
  state.relicIds.push(relicId);
  const effects = [];
  for (let index = 0; index < (item.effects ?? []).length; index += 1) {
    const effect = item.effects[index];
    if (effect.trigger !== 'purchase') continue;
    // Purchase effects may describe recurring actions (for example, each shop
    // refresh). Only an explicit acquisition condition belongs to this hook.
    if (effect.condition?.acquisition !== true) continue;
    if (effect.condition?.oncePerRun !== true) throw codedError('UNSUPPORTED_RELIC_ACQUISITION', `Acquisition effect is not once-per-run: ${relicId}`);
    if (state.claimed.includes(`relic:${relicId}:${index}`)) continue;
    const amount = effect.params?.amount;
    const currency = effect.params?.currency;
    if (!Number.isFinite(amount) || !['gold', 'hp'].includes(currency)) throw codedError('UNSUPPORTED_RELIC_ACQUISITION', `Unsupported purchase effect for ${relicId}`);
    if (currency === 'gold') state.gold += amount;
    else state.life = Math.min(state.maxLife, state.life + amount);
    state.claimed.push(`relic:${relicId}:${index}`);
    effects.push({ action: effect.action, currency, amount });
  }
  return { relicId, effects };
}

export function queueBattleRelicChoice(state, ctx) {
  const result = relicCandidates(state, ctx, { count: 3, source: { type: 'reward', value: 'battle' } });
  state.rngState = result.rngState >>> 0;
  if (!result.candidates.length) {
    state.gold += 4;
    return { choices: [], fallbackGold: 4 };
  }
  state.rewardQueue = { kind: 'relic', choices: result.candidates.map((item) => item.id), source: 'battle' };
  state.phase = 'rewards';
  return { choices: state.rewardQueue.choices, fallbackGold: 0 };
}

export function chooseRewardRelic(state, ctx, relicId) {
  if (!state.rewardQueue || !state.rewardQueue.choices.includes(relicId)) throw codedError('INVALID_REWARD_CHOICE', `Relic is not in the current choice: ${relicId}`);
  const acquired = applyRelicAcquisition(state, ctx, relicId);
  state.rewardQueue = null;
  return acquired;
}

export function auditRelicPool(state, ctx) {
  const available = ctx.design.collectibles.items.filter((item) => !state.relicIds.includes(item.id) && item.rarity !== 'starter' && item.unlockDay <= state.day);
  return { available: available.length, uniqueOwned: new Set(state.relicIds).size };
}
