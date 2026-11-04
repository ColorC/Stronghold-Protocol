import { codedError } from './rng.js';
import { clonePlain, defaultModuleFor } from './inventory.js';
import { effectiveEnchantmentId } from './temporary-enchantments.js';

export function skillDefinitions(ctx) {
  const values = ctx?.design?.system?.strategySkills ?? [];
  if (!Array.isArray(values)) throw codedError('INVALID_STRATEGY_SKILLS', 'strategySkills must be an array');
  return values;
}

export function enchantmentDefinitions(ctx) {
  const values = ctx?.design?.system?.enchantments ?? [];
  if (!Array.isArray(values)) throw codedError('INVALID_ENCHANTMENTS', 'enchantments must be an array');
  return values;
}

export function enchantmentPoolDefinitions(ctx) {
  const values = ctx?.design?.system?.enchantmentPools ?? [];
  if (!Array.isArray(values)) throw codedError('INVALID_ENCHANTMENT_POOLS', 'enchantmentPools must be an array');
  return values;
}

/**
 * @param {any} state
 * @param {any} ctx
 * @param {{poolId?: string, targetRule?: string}} [options]
 */
export function eventEnchantmentCandidates(state, ctx, { poolId, targetRule } = {}) {
  const pool = enchantmentPoolDefinitions(ctx).find((entry) => entry.id === poolId);
  if (!pool) throw codedError('UNKNOWN_ENCHANTMENT_POOL', `Unknown enchantment pool: ${poolId}`);
  if (!['oldestUnenchanted', 'oldestToxic'].includes(targetRule)) throw codedError('UNKNOWN_ENCHANTMENT_TARGET_RULE', `Unknown enchantment target rule: ${targetRule}`);
  const numericUid = (piece) => {
    const match = String(piece.uid).match(/\d+/);
    return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
  };
  const ordered = [...(state?.pieces ?? [])].sort((a, b) => numericUid(a) - numericUid(b) || String(a.uid).localeCompare(String(b.uid)));
  const target = ordered.find((piece) => targetRule === 'oldestUnenchanted'
    ? !effectiveEnchantmentId(piece, state)
    : effectiveEnchantmentId(piece, state) === 'enchant_toxic') ?? null;
  if (!target) return { target: null, candidates: [] };
  const definitions = enchantmentDefinitions(ctx);
  const candidates = (pool.entries ?? []).flatMap((entry) => {
    if (entry.enchantmentId === 'enchant_golden' || entry.enchantmentId === target.enchantmentId
      || !Number.isFinite(entry.weight) || entry.weight <= 0) return [];
    const definition = definitions.find((item) => item.id === entry.enchantmentId);
    if (!definition || !isPieceEligibleForEnchantment(target, ctx, definition)) return [];
    return [{ ...entry, definition }];
  });
  return { target, candidates };
}

export function strategySkillFor(ctx, id) {
  return skillDefinitions(ctx).find((entry) => entry.id === id) ?? null;
}

export function enchantmentFor(ctx, id) {
  return enchantmentDefinitions(ctx).find((entry) => entry.id === id) ?? null;
}

export function isPieceEligibleForEnchantment(piece, ctx, enchantmentOrId) {
  const definition = typeof enchantmentOrId === 'string' ? enchantmentFor(ctx, enchantmentOrId) : enchantmentOrId;
  if (!piece || !definition || !['any', 'instant'].includes(definition.eligibility)) return false;
  if (definition.eligibility === 'instant') return ctx?.catalog?.bodies?.[piece.charId]?.fixedSkill?.kind === 'instant';
  return true;
}

export function eligibleEnchantmentDefinitions(piece, ctx) {
  return enchantmentDefinitions(ctx).filter((entry) => isPieceEligibleForEnchantment(piece, ctx, entry));
}

export function eligibleStrategySkillDefinitions(state, ctx) {
  return skillDefinitions(ctx).filter((entry) => (state?.skillRanks?.[entry.id] ?? 0) < 4);
}

export function validateSkillRank(rank) {
  if (!Number.isInteger(rank) || rank < 1 || rank > 4) throw codedError('INVALID_SKILL_RANK', 'Skill rank must be an integer from 1 to 4');
  return rank;
}

export function skillRewardRank(currentRank, offerStar) {
  validateSkillRank(offerStar);
  if (!Number.isInteger(currentRank) || currentRank < 0 || currentRank > 4 || currentRank > offerStar) {
    throw codedError('INVALID_SKILL_RANK', 'Current skill rank is incompatible with this reward');
  }
  return currentRank === 0 ? offerStar : currentRank === offerStar ? Math.min(4, currentRank + 1) : offerStar;
}

export function operatorUpgradeRewardDefinitions(ctx) {
  const values = ctx?.design?.system?.operatorUpgradeRewards ?? [];
  if (!Array.isArray(values)) throw codedError('INVALID_OPERATOR_UPGRADE_REWARDS', 'operatorUpgradeRewards must be an array');
  return values;
}

export function eligibleOperatorUpgradePieces(state, maxStar) {
  if (!Number.isInteger(maxStar) || maxStar < 1 || maxStar > 3) {
    throw codedError('INVALID_OPERATOR_UPGRADE_REWARD', 'maxStar must be an integer from 1 to 3');
  }
  return (state?.pieces ?? []).filter((piece) => Number.isInteger(piece.star) && piece.star >= 1
    && piece.star <= maxStar && piece.star < 4 && typeof piece.uid === 'string');
}

export function operatorUpgradeResultStar(currentStar, maxStar) {
  if (!Number.isInteger(maxStar) || maxStar < 1 || maxStar > 3
    || !Number.isInteger(currentStar) || currentStar < 1 || currentStar > maxStar || currentStar >= 4) {
    throw codedError('INVALID_OPERATOR_UPGRADE_TARGET', 'Piece is not eligible for this operator upgrade reward');
  }
  return currentStar + 1;
}

export function operatorUpgradeProjection(piece, ctx, maxStar) {
  const star = operatorUpgradeResultStar(piece?.star, maxStar);
  const projected = clonePlain(piece);
  projected.star = star;
  projected.moduleChoices ??= {};
  for (const formId of projected.forms ?? [projected.charId]) {
    projected.moduleChoices[formId] ??= defaultModuleFor(ctx, formId, star);
  }
  return projected;
}
