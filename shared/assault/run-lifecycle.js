import { applyPermanentEffect, ensurePercentSources } from './inventory.js';
import { RUN_CARD_GROWTH, runGrowthSteps } from './growth-policy.js';
import { codedError, nextUint32 } from './rng.js';
import { applyTemporaryEnhancement, isTemporaryStat, TEMPORARY_DURATION_TYPES, temporaryExpiry } from './temporary-enhancements.js';
import { applyTemporaryMaxLife } from './temporary-player-enhancements.js';

const EVENTS = new Set(['buy', 'sell', 'upgrade', 'battleEnd', 'nodeEntered', 'dayStarted', 'hourStarted', 'shopEntered', 'skillBought', 'skillUpgraded', 'shopCardsDealt']);
const OWNER_KINDS = new Set(['operator', 'skill', 'enchantment']);
const EFFECT_TARGETS = new Set(['self', 'transaction', 'team', 'leftmost']);

function invalid(message) {
  throw codedError('INVALID_RUN_LIFECYCLE_RULE', message);
}

function validateRuleList(rules) {
  if (rules === undefined) return [];
  if (!Array.isArray(rules)) invalid('runLifecycleRules must be an array');
  const ids = new Set();
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)
      || typeof rule.id !== 'string' || !rule.id.trim() || ids.has(rule.id)) invalid('Run lifecycle rules require unique non-empty ids');
    ids.add(rule.id);
    if (!rule.owner || !OWNER_KINDS.has(rule.owner.kind) || typeof rule.owner.id !== 'string' || !rule.owner.id.trim()) {
      invalid(`Invalid owner in run lifecycle rule ${rule.id}`);
    }
    if (!EVENTS.has(rule.event)) invalid(`Invalid event in run lifecycle rule ${rule.id}`);
    if (rule.nodeKinds !== undefined && (!Array.isArray(rule.nodeKinds) || !rule.nodeKinds.length
      || rule.nodeKinds.some(kind => !['shop', 'event', 'battle', 'reward'].includes(kind)))) invalid(`Invalid node filter in run lifecycle rule ${rule.id}`);
    if (rule.selfOnly !== undefined && typeof rule.selfOnly !== 'boolean') invalid(`Invalid selfOnly in run lifecycle rule ${rule.id}`);
    if (rule.otherOnly !== undefined && typeof rule.otherOnly !== 'boolean') invalid(`Invalid otherOnly in run lifecycle rule ${rule.id}`);
    if (rule.selfOnly === true && rule.otherOnly === true) invalid(`Conflicting owner filters in run lifecycle rule ${rule.id}`);
    if (rule.minDay !== undefined && (!Number.isInteger(rule.minDay) || rule.minDay < 1)) invalid(`Invalid minDay in run lifecycle rule ${rule.id}`);
    if (rule.transactionFilter !== undefined) {
      const filter = rule.transactionFilter;
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)
        || (filter.professions !== undefined && (!Array.isArray(filter.professions) || filter.professions.some((value) => typeof value !== 'string' || !value)))
        || (filter.maxSourceCopies !== undefined && (!Number.isInteger(filter.maxSourceCopies) || filter.maxSourceCopies < 1))) invalid(`Invalid transactionFilter in run lifecycle rule ${rule.id}`);
    }
    if (!Array.isArray(rule.effects) || rule.effects.length === 0) invalid(`Run lifecycle rule ${rule.id} requires effects`);
    for (const effect of rule.effects) {
      if (!effect || typeof effect !== 'object' || Array.isArray(effect)) invalid(`Invalid effect in run lifecycle rule ${rule.id}`);
      if (!Array.isArray(effect.amountByStar) || effect.amountByStar.length !== 4
        || effect.amountByStar.some((amount) => !Number.isFinite(amount))) invalid(`Invalid amountByStar in run lifecycle rule ${rule.id}`);
      if (effect.kind === 'playerEnhance') {
        if (effect.stat !== 'maxLife' || effect.target !== undefined || !['flat', 'percent'].includes(effect.mode)
          || !TEMPORARY_DURATION_TYPES.has(effect.durationType) || effect.amountByStar.some((amount) => amount < 0)) invalid(`Invalid playerEnhance effect in run lifecycle rule ${rule.id}`);
      } else if (effect.kind === 'enhance') {
        if (!EFFECT_TARGETS.has(effect.target) || typeof effect.stat !== 'string' || !effect.stat.trim()
          || !['flat', 'percent'].includes(effect.mode)
          || (effect.durationType !== undefined && (!TEMPORARY_DURATION_TYPES.has(effect.durationType) || !isTemporaryStat(effect.stat)))) invalid(`Invalid enhance effect in run lifecycle rule ${rule.id}`);
      } else if (effect.kind === 'currency') {
        if (!['gold', 'xp', 'life'].includes(effect.currency)) invalid(`Invalid currency effect in run lifecycle rule ${rule.id}`);
      } else if (effect.kind === 'shopDiscount') {
        if (effect.amountByStar.some((amount) => amount < 0) || (effect.target !== undefined && !['randomOne', 'all'].includes(effect.target))) invalid(`Invalid shop discount in run lifecycle rule ${rule.id}`);
      } else if (effect.kind === 'teamGrowth') {
        if (typeof effect.stat !== 'string' || !effect.stat.trim()) invalid(`Invalid team growth in run lifecycle rule ${rule.id}`);
      } else invalid(`Unknown effect in run lifecycle rule ${rule.id}`);
    }
  }
  return rules;
}

function pieceStar(piece, rule) {
  if (!Number.isInteger(piece?.star) || piece.star < 1 || piece.star > 4) invalid(`Invalid star for lifecycle owner ${rule.owner.id}`);
  return piece.star;
}

function resolveOwners(state, rule, transaction) {
  const pieces = [...(state.pieces ?? [])];
  if (transaction?.uid && !pieces.some((piece) => piece.uid === transaction.uid)) pieces.push(transaction);
  if (rule.owner.kind === 'operator') {
    return pieces.filter((piece) => piece.purchaseCharId === rule.owner.id || piece.charId === rule.owner.id)
      .map((piece) => ({ key: piece.uid, piece, star: pieceStar(piece, rule) }));
  }
  if (rule.owner.kind === 'enchantment') {
    return pieces.filter((piece) => piece.enchantmentId === rule.owner.id)
      .map((piece) => ({ key: piece.uid, piece, star: pieceStar(piece, rule) }));
  }
  const ranks = state.skillRanks;
  if (ranks !== undefined && (!ranks || typeof ranks !== 'object' || Array.isArray(ranks))) invalid('skillRanks must be an object');
  if (!Object.hasOwn(ranks ?? {}, rule.owner.id)) return [];
  const rank = ranks[rule.owner.id];
  if (!Number.isInteger(rank) || rank < 1 || rank > 4) invalid(`Invalid skill rank for ${rule.owner.id}`);
  return [{ key: rule.owner.id, piece: null, star: rank }];
}

function targetsFor(state, effect, owner, transaction) {
  if (effect.target === 'self') return owner.piece ? [owner.piece] : [];
  if (effect.target === 'transaction') return transaction ? [transaction] : [];
  const surviving = (state.pieces ?? []).filter((piece) => piece && typeof piece.uid === 'string');
  if (effect.target === 'team') return surviving;
  const deployed = surviving.filter((piece) => piece.row !== null && piece.col !== null)
    .sort((a, b) => a.col - b.col || a.row - b.row || a.uid.localeCompare(b.uid));
  const bench = surviving.filter((piece) => piece.row === null || piece.col === null);
  const leftmost = deployed[0] ?? bench[0];
  return leftmost ? [leftmost] : [];
}

function matchesTransactionFilter(transaction, filter, ctx) {
  if (!filter) return true;
  if (!transaction) return false;
  const operator = transaction.purchaseCharId ? ctx?.catalog?.operators?.[transaction.purchaseCharId] : null;
  const profession = transaction.profession ?? operator?.profession;
  if (filter.professions && !filter.professions.includes(profession)) return false;
  if (filter.maxSourceCopies !== undefined && (!Number.isInteger(transaction.sourceCopies) || transaction.sourceCopies > filter.maxSourceCopies)) return false;
  return true;
}

function claimKey(eventKey, rule, owner, effectIndex, targetKey) {
  return `run-lifecycle:${eventKey}:${rule.id}:${rule.owner.kind}:${rule.owner.id}:${owner.key}:${effectIndex}:${targetKey}`;
}

function applyCurrency(state, effect, amount) {
  const field = effect.currency === 'life' ? 'life' : effect.currency;
  const current = Number(state[field] ?? 0);
  const maximum = field === 'life' ? Number(state.maxLife ?? Infinity) : Infinity;
  const next = Math.min(maximum, Math.max(0, current + amount));
  if (!Number.isFinite(next) || next === current) return false;
  state[field] = next;
  return true;
}

function applyEffect(state, rule, owner, effect, effectIndex, eventKey, transaction, ctx) {
  const amount = effect.amountByStar[owner.star - 1];
  if (amount === 0) return;
  if (effect.kind === 'playerEnhance') {
    const key = claimKey(eventKey, rule, owner, effectIndex, 'player');
    if (state.claimed?.includes(key)) return;
    const base = state.maxLifeBase ?? state.maxLife;
    const grantedAmount = Math.round(effect.mode === 'percent' ? base * amount : amount);
    if (!Number.isSafeInteger(grantedAmount) || grantedAmount < 0) invalid(`Invalid rounded max-life grant in ${rule.id}`);
    if (grantedAmount === 0) return;
    const expiresAtHour = temporaryExpiry(state, effect.durationType);
    applyTemporaryMaxLife(state, { id: claimKey(eventKey, rule, owner, effectIndex, 'grant'), amount: grantedAmount, expiresAtHour });
    state.claimed ??= [];
    state.claimed.push(key);
    state.history.push({ kind: 'runLifecycleTriggered', event: rule.event, eventKey, ruleId: rule.id, ownerUid: owner.piece?.uid ?? null, target: 'player', stat: 'maxLife', amount: grantedAmount, mode: effect.mode, expiresAtHour });
    return;
  }
  if (effect.kind === 'currency') {
    const key = claimKey(eventKey, rule, owner, effectIndex, 'run');
    if (state.claimed?.includes(key) || !applyCurrency(state, effect, amount)) return;
    state.claimed ??= [];
    state.claimed.push(key);
    state.history.push({ kind: 'runLifecycleTriggered', event: rule.event, eventKey, ruleId: rule.id, ownerUid: owner.piece?.uid ?? null, target: effect.currency, amount });
    return;
  }
  if (effect.kind === 'shopDiscount') {
    if (!state.shop || !Array.isArray(state.shop.slots)) return;
    const changed = state.shop.slots.filter((slot) => slot.price > 1);
    if (!changed.length) return;
    const key = claimKey(eventKey, rule, owner, effectIndex, 'shop');
    if (state.claimed?.includes(key)) return;
    let targets = changed;
    if (effect.target === 'randomOne') {
      const next = nextUint32(state.rngState >>> 0);
      state.rngState = next.state >>> 0;
      targets = [changed[next.value % changed.length]];
    }
    for (const slot of targets) slot.price = Math.max(1, slot.price - amount);
    state.claimed ??= [];
    state.claimed.push(key);
    state.history.push({ kind: 'runLifecycleTriggered', event: rule.event, eventKey, ruleId: rule.id, ownerUid: owner.piece?.uid ?? null, target: effect.target === 'randomOne' ? targets[0].slotId : 'shop', amount });
    return;
  }
  if (effect.kind === 'teamGrowth') {
    const key = claimKey(eventKey, rule, owner, effectIndex, 'teamGrowth');
    if (state.claimed?.includes(key)) return;
    state.teamGrowth ??= {};
    const previous = Number(state.teamGrowth[effect.stat] ?? 0);
    const next = previous + amount;
    if (!Number.isFinite(next)) invalid(`Invalid accumulated team growth for ${effect.stat}`);
    state.teamGrowth[effect.stat] = next;
    state.claimed ??= [];
    state.claimed.push(key);
    state.history.push({ kind: 'runLifecycleTriggered', event: rule.event, eventKey, ruleId: rule.id, ownerUid: owner.piece?.uid ?? null, target: 'teamGrowth', stat: effect.stat, amount });
    return;
  }
  for (const target of targetsFor(state, effect, owner, transaction)) {
    if (!target || typeof target.uid !== 'string') continue;
    const survivor = (state.pieces ?? []).find((piece) => piece.uid === target.uid);
    if (!survivor) continue;
    const key = claimKey(eventKey, rule, owner, effectIndex, survivor.uid);
    if (state.claimed?.includes(key)) continue;
    if (effect.durationType !== undefined) {
      applyTemporaryEnhancement(survivor, { id: claimKey(eventKey, rule, owner, effectIndex, 'grant'), stat: effect.stat, amount, mode: effect.mode,
        expiresAtHour: temporaryExpiry(state, effect.durationType) }, state, ctx.catalog.bodies[survivor.charId]);
    } else applyPermanentEffect(survivor, {
      stat: effect.stat, amount, mode: effect.mode,
      sourceKey: `run-lifecycle:${rule.id}:${rule.owner.kind}:${rule.owner.id}:${owner.key}:${effectIndex}`,
    });
    state.claimed ??= [];
    state.claimed.push(key);
    state.history.push({ kind: 'runLifecycleTriggered', event: rule.event, eventKey, ruleId: rule.id, ownerUid: owner.piece?.uid ?? null, targetUid: survivor.uid, stat: effect.stat, amount, mode: effect.mode });
  }
}

/** @param {{eventKey?: string, transaction?: any, nodeKind?: string}} [options={}] */
export function applyRunLifecycleEvent(state, ctx, event, options = {}) {
  const { eventKey, transaction = null } = options;
  if (!state || typeof state !== 'object') throw new TypeError('run lifecycle state is required');
  if (!EVENTS.has(event)) throw codedError('INVALID_RUN_LIFECYCLE_EVENT', `Unknown run lifecycle event: ${event}`);
  if (typeof eventKey !== 'string' || !eventKey) throw new TypeError('run lifecycle eventKey is required');
  const rules = validateRuleList(ctx?.design?.system?.runLifecycleRules);
  applyCardRunGrowth(state,ctx,event,options);
  for (const rule of rules) {
    if (rule.event !== event || state.day < (rule.minDay ?? 1)) continue;
    if (rule.nodeKinds && !rule.nodeKinds.includes(options.nodeKind)) continue;
    if (!matchesTransactionFilter(transaction, rule.transactionFilter, ctx)) continue;
    const owners = resolveOwners(state, rule, transaction);
    for (const owner of owners) {
      if (rule.selfOnly || rule.otherOnly) {
        if (!transaction) continue;
        const same = owner.piece ? transaction.uid === owner.piece.uid
          : rule.owner.kind === 'skill' && transaction.skillId === rule.owner.id;
        if ((rule.selfOnly && !same) || (rule.otherOnly && same)) continue;
      }
      rule.effects.forEach((effect, index) => applyEffect(state, rule, owner, effect, index, eventKey, transaction, ctx));
    }
  }
}

function applyCardRunGrowth(state,ctx,event,{eventKey,transaction,heldUids}={}){
  if(!['battleEnd','buy','dayStarted'].includes(event))return;
  state.cardGrowthSeen??=[];
  const key=`${event}:${eventKey}`;
  if(state.cardGrowthSeen.includes(key))return;
  state.cardGrowthSeen.push(key); // Remember even events before ownership.
  if(event==='buy'){
    const body=transaction?.kind==='operator'?ctx.catalog.bodies[transaction.charId]:null;
    if(body?.adaptation?.line!=='workshop'||!body.adaptation.produces?.includes('summon'))return;
  }
  for(const piece of state.pieces??[]){
    const rule=RUN_CARD_GROWTH[piece.charId];
    if(!rule||rule.event!==event||event==='buy'&&!heldUids?.includes(piece.uid))continue;
    const before=runGrowthSteps(piece);if(before===rule.steps)continue;
    const after=before+1;piece.runGrowth??={};piece.runGrowth[piece.charId]=after;
    if(rule.stat==='atk'){
      const sources=ensurePercentSources(piece);
      sources[`card-growth:${piece.charId}`]={atk:after*rule.points/100};ensurePercentSources(piece);
    }
    const change={uid:piece.uid,charId:piece.charId,stat:rule.stat,event,eventKey,before:before*rule.points,after:after*rule.points};
    state.pendingCardGrowth??=[];state.pendingCardGrowth.push(change);
    state.history.push({kind:'cardGrowth',day:state.day,hour:state.hour,...change});
  }
}
