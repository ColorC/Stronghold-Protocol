// Out-of-battle collectible rules.  The caller owns the draft transaction;
// this function only mutates that draft synchronously and returns it.

import { relicCandidates } from './rewards.js';

const has = (state, id) => Array.isArray(state?.relicIds) && state.relicIds.includes(id);
const finite = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError(`assault relic ${label} must be finite`);
  return n;
};
const cap = (value, min, max) => Math.min(max, Math.max(min, value));

/** Read the same authored effect used by battle installation; no parallel balance constants. */
export function relicEffectParams(ctx, id, trigger, predicate = () => true) {
  const item = ctx?.design?.collectibles?.items?.find(item => item.id === id);
  const effect = item?.effects?.find(effect => effect.trigger === trigger && predicate(effect));
  if (!effect?.params) throw new TypeError(`assault relic ${id}/${trigger} requires its design effect`);
  return effect.params;
}

function claimOnce(state, key) {
  state.relicClaims ??= [];
  if (state.relicClaims.includes(key)) return false;
  state.relicClaims.push(key);
  return true;
}

function addCurrency(state, field, amount, maximum = Infinity) {
  const value = finite(state[field] ?? 0, field) + finite(amount, `${field} delta`);
  state[field] = cap(value, 0, maximum);
}

function battleReward(state, ctx, payload) {
  const victory = payload?.success !== false && payload?.victory === true;
  const battleId = payload?.battleId ?? state.currentBattle?.battleId ?? 'unknown';
  // A prepared battle identity is authoritative, but a legacy/test driver may
  // reuse an encounter label.  The run position keeps distinct real battles
  // distinct while preserving idempotence for a repeated settlement.
  const battleClaimId = `${state.day ?? ''}:${state.hour ?? ''}:${battleId}`;
  const result = { gold: 0, xp: 0, altarStack: Number(state.relicCounters?.['pierce-altar'] ?? 0) };
  if (victory && has(state, 'pierce-altar') && claimOnce(state, `pierce-altar:battle:${battleClaimId}`)) {
    state.relicCounters ??= {};
    const current = Number(state.relicCounters['pierce-altar'] ?? 0);
    const maximum = finite(relicEffectParams(ctx, 'pierce-altar', 'battleEnd').maxStacks, 'altar stack cap');
    state.relicCounters['pierce-altar'] = Math.min(maximum, Math.max(0, Math.floor(current)) + 1);
    result.altarStack = state.relicCounters['pierce-altar'];
  }
  if (!victory || payload?.isFinal === true || !claimOnce(state, `battle-reward:${battleClaimId}`)) return result;
  const baseGold = finite(payload?.battleGoldDrop ?? payload?.goldDrop ?? payload?.earned?.gold ?? 0, 'battle gold drop');
  const baseXp = finite(payload?.battleXp ?? payload?.xpDrop ?? payload?.earned?.xp ?? 0, 'battle xp drop');
  const percentage = id => has(state, id) ? finite(relicEffectParams(ctx,id,'battleEnd').value,id+' multiplier') - 1 : 0;
  const goldPercent = percentage('econ-friendship') + percentage('econ-rings');
  const xpPercent = percentage('econ-scrapmedal') + percentage('econ-leithmedal');
  const gold = Math.floor(baseGold * (1 + goldPercent)) + (has(state, 'cross-lancepro') ? finite(relicEffectParams(ctx,'cross-lancepro','battleEnd').amount,'flat victory gold') : 0);
  const xp = Math.floor(baseXp * (1 + xpPercent));
  addCurrency(state, 'gold', gold);
  addCurrency(state, 'xp', xp);
  result.gold = gold;
  result.xp = xp;
  return result;
}

function purchase(state, ctx, payload) {
  if (payload?.success === false) return;
  const action = payload?.shopAction ?? payload?.action;
  if (has(state, 'cross-lancepro') && action === 'refresh') {
    if (state.shop && Number.isFinite(state.shop.refreshCost)) state.shop.refreshCost = Math.max(1, state.shop.refreshCost - 1);
    else state.relicRefreshDiscount = Math.max(0, Number(state.relicRefreshDiscount ?? 0) + 1);
  }
  const acquisition = payload?.acquisition === true
    && typeof payload?.relicId === 'string'
    && (payload?.source === 'relicAcquisition' || payload?.kind === 'relicAcquisition');
  if (!acquisition) return;
  const id = payload.relicId;
  if (!has(state,id) || !['econ-oldcoins','econ-flawlessjade','cross-artinstall'].includes(id)) return;
  const effect = relicEffectParams(ctx,id,'purchase');
  const amount = finite(effect.amount,'acquisition amount');
  const claim = `relic:${id}:0`;
  if (state.claimed?.includes(claim) || !claimOnce(state, `${id}:acquisition`)) return;
  if (has(state, id)) {
    addCurrency(state,effect.currency === 'hp' ? 'life' : 'gold',amount,effect.currency === 'hp' ? state.maxLife ?? Infinity : Infinity);
    state.claimed ??= []; state.claimed.push(claim);
  }
}

/**
 * Add cloverfossil's extra option to the real pending reward queue.  The queue
 * must already exist: a counter that is never consumed is not a reward.
 */
export function applyRelicChoiceBonus(state, ctx) {
  if (!has(state, 'cross-cloverfossil') || state.rewardQueue?.kind !== 'relic') return false;
  if (state.rewardQueue.cloverfossilApplied === true) return false;
  const existing = [...(state.rewardQueue.choices ?? [])];
  if (!existing.length) return false;
  const shadow = { ...state, relicIds: [...(state.relicIds ?? []), ...existing] };
  if (!ctx?.design?.collectibles?.items) throw new TypeError('applyRelicChoiceBonus requires the assault design context');
  const result = relicCandidates(shadow, ctx, { count: 1, source: { type: 'reward', value: 'battle' } });
  if (!result?.candidates?.length) return false;
  state.rewardQueue.choices = [...existing, result.candidates[0].id];
  state.rewardQueue.cloverfossilApplied = true;
  state.rngState = result.rngState >>> 0;
  return true;
}

function hourStarted(state, ctx, payload) {
  if (payload?.success === false) return;
  state.relicHourSnapshots ??= {};
  if (has(state, 'cross-chivalry')) {
    const gold = finite(payload?.gold ?? state.gold ?? 0, 'hour gold');
    const snapshotKey = payload?.day != null || payload?.hour != null
      ? `${payload?.day ?? state.day}:${payload?.hour ?? state.hour}` : `${state.day}:${state.hour}`;
    const params = relicEffectParams(ctx,'cross-chivalry','hourStarted');
    state.relicHourSnapshots[snapshotKey] = {
      relicId: 'cross-chivalry', goldAtPreparation: gold, attackSpeedStacks: Math.min(finite(params.maxStacks,'chivalry stack cap'), Math.floor(Math.min(finite(params.maxGoldCounted,'chivalry gold cap'), gold) / 5)),
    };
  }
}

export function applyRelicRunEvent(state, ctx, type, payload = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('assault relic run state is required');
  if (!['purchase', 'hourStarted', 'battleEnd', 'battleStart', 'settlement'].includes(type)) throw new TypeError(`unknown assault relic run event ${type}`);
  if (type === 'purchase') purchase(state, ctx, payload);
  else if (type === 'hourStarted') hourStarted(state, ctx, payload);
  else if (type === 'battleEnd' || type === 'settlement') return battleReward(state, ctx, payload);
  return state;
}
