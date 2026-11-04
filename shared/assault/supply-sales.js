import { codedError, pickWeighted } from './rng.js';
import { supplyFor } from './supplies.js';
import { absoluteRunHour, applyTemporaryEnhancement, temporaryExpiry, temporaryRecords } from './temporary-enhancements.js';
import { applyTemporaryMaxLife } from './temporary-player-enhancements.js';
import { applyTemporaryEnchantment, effectiveEnchantmentId } from './temporary-enchantments.js';
import { isPieceEligibleForEnchantment } from './upgrades.js';
import { applyTemporaryAbilityEnhancement } from './temporary-abilities.js';

const invalid = message => { throw codedError('INVALID_SUPPLY_SALE', message); };

function amountAt(values, star) {
  if (!Array.isArray(values) || values.length !== 4 || values.some(v => !Number.isFinite(v) || v < 0)) invalid('Supply effect requires four nonnegative values');
  return values[star - 1];
}

function giveAbility(state, piece, ability, amount, key, expiresAtHour) {
  if (amount > 0) applyTemporaryAbilityEnhancement(piece, { id: `${key}:${ability}`, ability, amount, expiresAtHour }, state);
}

function reduceCooldown(state, ctx, piece, percent, key, expiresAtHour) {
  const body = ctx.catalog.bodies[piece.charId], stats = body?.starStats?.[piece.star - 1]?.stats;
  if (!stats || !(stats.bat > 0)) return;
  const now = absoluteRunHour(state);
  const previous = temporaryRecords(piece).filter(record => record.id.startsWith('supply-cdr:') && record.stat === 'bat'
    && record.mode === 'percent' && record.expiresAtHour > now).reduce((sum, record) => sum - record.amount, 0);
  const next = Math.min(0.8, previous + percent / 100), delta = next - previous;
  if (!(delta > 0)) return;
  const candidate = { ...piece, temporaryEnhancements: [...temporaryRecords(piece)] };
  applyTemporaryEnhancement(candidate, { id: `supply-cdr:${key}:bat`, stat: 'bat', mode: 'percent', amount: -delta, expiresAtHour }, state, body);
  if (body.fixedSkill?.kind === 'instant' && ['time', 'INCREASE_WITH_TIME'].includes(body.fixedSkill.spType) && stats.spRecovery > 0) {
    applyTemporaryEnhancement(candidate, { id: `supply-cdr:${key}:sp`, stat: 'spRecovery', mode: 'percent',
      amount: 1 / (1 - next) - 1 / (1 - previous), expiresAtHour }, state, body);
  }
  piece.temporaryEnhancements = candidate.temporaryEnhancements;
}

function leftmostUnenchanted(state) {
  const eligible = state.pieces.filter(piece => !effectiveEnchantmentId(piece, state));
  const placed = eligible.filter(piece => piece.row !== null && piece.col !== null)
    .sort((a, b) => a.col - b.col || a.row - b.row || a.uid.localeCompare(b.uid));
  return placed[0] ?? eligible.find(piece => piece.row === null && piece.col === null) ?? null;
}

/** Called by the real sale transaction after its item is removed. No gold is invented here. */
export function applySupplySale(state, ctx, sold, eventKey) {
  const item = supplyFor(ctx, sold?.itemId);
  if (!item || !item.allowedStars.includes(sold.star) || typeof sold.uid !== 'string'
    || typeof eventKey !== 'string' || !eventKey) invalid('Unknown supply sale');
  const effect = item.saleEffect;
  if (!effect) return { effect: null };
  const claim = `supply-sale:${eventKey}:${sold.uid}`;
  if (state.claimed.includes(claim)) return { replay: true };
  const amount = amountAt(effect.values, sold.star), expiresAtHour = temporaryExpiry(state, 'UntilEndOfDay');
  let targetUid = null, enchantmentId = null;
  if (effect.kind === 'maxLife') {
    const base = state.maxLifeBase ?? state.maxLife, gain = Math.round(base * amount / 100);
    if (gain > 0) applyTemporaryMaxLife(state, { id: claim, amount: gain, expiresAtHour });
  } else if (effect.kind === 'randomEnchant') {
    const target = leftmostUnenchanted(state);
    if (target) {
      if (!Array.isArray(effect.enchantments)) invalid('Missing random enchantments');
      const definitions = ctx.design.system.enchantments ?? [];
      const choices = effect.enchantments.flatMap(entry => {
        if (!entry || !Number.isFinite(entry.weight) || entry.weight <= 0) invalid('Invalid enchantment weight');
        const definition = definitions.find(candidate => candidate.id === entry.id);
        if (!definition) invalid('Unknown supply enchantment');
        return isPieceEligibleForEnchantment(target, ctx, definition) ? [{ id: entry.id, weight: entry.weight }] : [];
      });
      if (choices.length) {
        const picked = pickWeighted(choices, state.rngState);
        applyTemporaryEnchantment(target, { id: claim, enchantmentId: picked.value.id, expiresAtHour }, state, ctx);
        state.rngState = picked.state >>> 0; targetUid = target.uid; enchantmentId = picked.value.id;
      }
    }
  } else if (effect.kind === 'cooldown') {
    for (const piece of state.pieces) reduceCooldown(state, ctx, piece, amount, claim, expiresAtHour);
  } else if (effect.kind === 'smoothie') {
    const regen = amountAt(effect.secondaryValues, sold.star);
    for (const piece of state.pieces) {
      giveAbility(state, piece, 'heal', amount, claim, expiresAtHour);
      giveAbility(state, piece, 'regen', regen, claim, expiresAtHour);
    }
  } else if (['damage', 'poison', 'burn', 'shield'].includes(effect.kind)) {
    for (const piece of state.pieces) giveAbility(state, piece, effect.kind, amount, claim, expiresAtHour);
  } else invalid('Unsupported supply sale effect');
  state.claimed.push(claim);
  state.history.push({ kind: 'supplySaleEffect', eventKey, sourceUid: sold.uid, itemId: sold.itemId,
    ability: effect.kind, amount, expiresAtHour, ...(targetUid ? { targetUid, enchantmentId } : {}) });
  return { effect: effect.kind, amount, expiresAtHour, targetUid, enchantmentId };
}
