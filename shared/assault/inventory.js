import { codedError } from './rng.js';
import { mergeTemporaryEnhancements } from './temporary-enhancements.js';
import { mergeTemporaryEnchantments } from './temporary-enchantments.js';
import { mergeTemporaryAbilityEnhancements } from './temporary-abilities.js';
import { RUN_CARD_GROWTH, runGrowthSteps } from './growth-policy.js';

export const clonePlain = (value) => {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, item] of Object.entries(value)) copy[key] = clonePlain(item);
    return copy;
  }
  return value;
};

export function bodyFor(ctx, charId) {
  const body = ctx.catalog?.bodies?.[charId];
  if (!body) throw codedError('UNKNOWN_BODY', `Unknown assault body: ${charId}`);
  return body;
}

export function operatorFor(ctx, purchaseCharId) {
  const operator = ctx.catalog?.operators?.[purchaseCharId];
  if (!operator) throw codedError('UNKNOWN_OPERATOR', `Unknown assault purchase identity: ${purchaseCharId}`);
  return operator;
}

export function pieceFor(state, uid) {
  const piece = state.pieces.find((entry) => entry.uid === uid);
  if (!piece) throw codedError('UNKNOWN_PIECE', `Unknown piece: ${uid}`);
  return piece;
}

export function defaultModuleFor(ctx, charId, star) {
  const body = bodyFor(ctx, charId);
  if (!body.defaultModuleId) return null;
  const plan = body.modulePlans?.find((entry) => entry.id === body.defaultModuleId);
  if (!plan) throw codedError('MISSING_MODULE_PLAN', `Missing default module plan for ${charId}`);
  if (plan.type === 'INITIAL' || plan.mode === 'disabled') return null;
  if (plan.type !== 'ADVANCED') throw codedError('UNKNOWN_MODULE_TYPE', `Unknown module type for ${charId}: ${plan.type}`);
  const unlockStar = plan.translation?.unlockStar ?? plan.unlockStar ?? (plan.type === 'ADVANCED' ? 3 : 99);
  return star >= unlockStar ? plan.id : null;
}

export function populationLimit(xp, ctx) {
  const thresholds = ctx.design.system.run.xpThresholds;
  let tech = 1;
  for (let i = 0; i < thresholds.length; i += 1) if (xp >= thresholds[i]) tech = i + 1;
  return Math.min(10, tech + 2);
}

export function activePieceLimit(state, ctx) {
  return populationLimit(state.xp, ctx);
}

export function activePieces(state) {
  return state.pieces.filter((piece) => piece.row !== null && piece.col !== null);
}

export function piecePopulationCost(piece, ctx) {
  const body = bodyFor(ctx, piece.charId);
  const selected = Object.hasOwn(piece.moduleChoices ?? {}, piece.charId)
    ? piece.moduleChoices[piece.charId] : (piece.moduleId ?? defaultModuleFor(ctx, piece.charId, piece.star));
  const moduleId = body.adaptation?.moduleAliases?.[selected] ?? selected;
  const module = body.modulePlans?.find((entry) => entry.id === moduleId);
  if (!module || module.type !== 'ADVANCED' || module.mode === 'disabled'
    || piece.star < (module.translation?.unlockStar ?? module.unlockStar ?? 3)) return 1;
  const cost = module.translation?.parameters?.populationCost ?? module.parameters?.populationCost ?? 1;
  if (!Number.isInteger(cost) || cost < 0 || cost > 1) throw codedError('INVALID_POPULATION_COST', 'Invalid module population cost');
  return cost;
}

export function benchPieces(state) {
  return state.pieces.filter((piece) => piece.row === null || piece.col === null);
}

export function pieceFromBody(state, ctx, charId, sourceCopies = 1, options = {}) {
  const body = bodyFor(ctx, charId);
  const operator = operatorFor(ctx, body.purchaseCharId ?? charId);
  const star = options.star ?? 1;
  const moduleChoices = {};
  for (const id of new Set([charId, ...(operator.extraForms ?? [])])) moduleChoices[id] = defaultModuleFor(ctx, id, star);
  return {
    uid: `p${state.nextPieceId++}`,
    purchaseCharId: body.purchaseCharId ?? charId,
    charId,
    forms: [...new Set([charId, ...(operator.extraForms ?? [])])],
    star,
    sourceCopies,
    temporaryEnhancements: [],
    permanentFlat: {},
    permanentPercentSources: {},
    permanentPercent: {},
    tagEdits: { add: [], remove: [] },
    claimed: [],
    moduleChoices,
    row: options.row ?? null,
    col: options.col ?? null,
    dir: options.dir ?? 'E',
    summonPresets: [],
    starter: options.starter === true,
  };
}

export function ensurePercentSources(piece) {
  const sources = piece.permanentPercentSources && typeof piece.permanentPercentSources === 'object'
    ? piece.permanentPercentSources : {};
  if (!Object.keys(sources).length && Object.keys(piece.permanentPercent ?? {}).length) {
    // Legacy saves had only the projection. Preserve every value under a stable
    // UID source instead of silently dropping it during the first merge.
    sources[`legacy:${piece.uid}`] = { ...piece.permanentPercent };
  }
  piece.permanentPercentSources = sources;
  const projection = {};
  for (const source of Object.values(sources)) for (const [stat, value] of Object.entries(source ?? {})) {
    if (!Number.isFinite(value)) throw codedError('INVALID_PERMANENT_PERCENT', `Non-finite permanent percent for ${piece.uid}:${stat}`);
    projection[stat] = (projection[stat] ?? 0) + value;
  }
  piece.permanentPercent = projection;
  return sources;
}

export function applyPermanentEffect(piece, effect) {
  if (!piece || typeof piece !== 'object') throw codedError('UNKNOWN_PIECE', 'Permanent effect target is required');
  if (!effect || typeof effect.stat !== 'string' || !Number.isFinite(effect.amount)) {
    throw codedError('INVALID_PERMANENT_EFFECT', 'Permanent effect requires a stat and finite amount');
  }
  const mode = effect.mode ?? 'flat';
  if (mode === 'counter') {
    // a card's own 本局永久 number (synergy runCounter): { label, suffix, amount } by its key
    piece.permanentCounters ??= {};
    const entry = piece.permanentCounters[effect.counterKey] ??= { label: effect.label, suffix: effect.suffix ?? '', amount: 0 };
    entry.amount += effect.amount;
    return piece;
  }
  if (mode === 'percent') {
    const sources = ensurePercentSources(piece);
    const sourceKey = String(effect.sourceKey ?? effect.sourceId ?? effect.effectKey ?? 'legacy');
    const source = sources[sourceKey] ?? (sources[sourceKey] = {});
    source[effect.stat] = (source[effect.stat] ?? 0) + effect.amount;
    ensurePercentSources(piece);
  } else if (mode === 'flat') {
    piece.permanentFlat ??= {};
    piece.permanentFlat[effect.stat] = (piece.permanentFlat[effect.stat] ?? 0) + effect.amount;
  } else {
    throw codedError('INVALID_PERMANENT_EFFECT', `Unknown permanent effect mode: ${mode}`);
  }
  return piece;
}

function mergePair(primary, secondary, ctx) {
  if (primary.purchaseCharId !== secondary.purchaseCharId || primary.star !== secondary.star || primary.star >= 4) return false;
  const operator = operatorFor(ctx, primary.purchaseCharId);
  const allForms = new Set([...(operator.extraForms ?? []), primary.charId, secondary.charId]);
  if (!allForms.has(primary.charId) || !allForms.has(secondary.charId)) return false;
  const temporary = mergeTemporaryEnhancements(primary, secondary);
  const enchantments = mergeTemporaryEnchantments(primary, secondary);
  const abilities = mergeTemporaryAbilityEnhancements(primary, secondary);
  const primarySources = ensurePercentSources(primary);
  const secondarySources = ensurePercentSources(secondary);
  primary.temporaryEnhancements = temporary;
  if (primary.temporaryEnchantments !== undefined || secondary.temporaryEnchantments !== undefined) primary.temporaryEnchantments = enchantments;
  if (primary.temporaryAbilityEnhancements !== undefined || secondary.temporaryAbilityEnhancements !== undefined) primary.temporaryAbilityEnhancements = abilities;
  primary.star += 1;
  primary.sourceCopies += secondary.sourceCopies;
  for(const id of Object.keys(RUN_CARD_GROWTH)){
    const steps=Math.max(runGrowthSteps(primary,id),runGrowthSteps(secondary,id));
    if(steps){primary.runGrowth??={};primary.runGrowth[id]=steps;}
  }
  for (const [key, value] of Object.entries(secondary.permanentFlat)) primary.permanentFlat[key] = (primary.permanentFlat[key] ?? 0) + value;
  // card counters of both copies add up (a save without them counts 0)
  for (const [key, entry] of Object.entries(secondary.permanentCounters ?? {})) {
    if (!Number.isFinite(entry?.amount)) continue;
    primary.permanentCounters ??= {};
    const own = primary.permanentCounters[key] ??= { label: entry.label, suffix: entry.suffix ?? '', amount: 0 };
    own.amount += entry.amount;
  }
  for (const [sourceKey, source] of Object.entries(secondarySources)) {
    const destination = primarySources[sourceKey] ?? (primarySources[sourceKey] = {});
    for (const [stat, value] of Object.entries(source ?? {})) destination[stat] = Math.max(destination[stat] ?? -Infinity, value);
  }
  ensurePercentSources(primary);
  for (const [key, value] of Object.entries(secondary.tagEdits)) primary.tagEdits[key] = [...new Set([...(primary.tagEdits[key] ?? []), ...value])];
  primary.claimed = [...new Set([...primary.claimed, ...secondary.claimed])];
  if (!primary.enchantmentId && secondary.enchantmentId) primary.enchantmentId = secondary.enchantmentId;
  primary.forms = [...new Set([...primary.forms, ...secondary.forms])];
  primary.moduleChoices = { ...secondary.moduleChoices, ...primary.moduleChoices };
  for (const formId of primary.forms) primary.moduleChoices[formId] ??= defaultModuleFor(ctx, formId, primary.star);
  return true;
}

export function mergeInventory(pieces, ctx, onMerge = null) {
  const merged = clonePlain(pieces);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        const primaryIndex = merged[i].row !== null && merged[i].col !== null ? i
          : merged[j].row !== null && merged[j].col !== null ? j : i;
        const secondaryIndex = primaryIndex === i ? j : i;
        if (mergePair(merged[primaryIndex], merged[secondaryIndex], ctx)) {
          onMerge?.(merged[primaryIndex].uid, merged[secondaryIndex].uid);
          merged.splice(secondaryIndex, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return merged;
}

export function assertInventory(pieces, ctx, xp) {
  const run = ctx.design.system.run;
  const benchCount = pieces.filter((piece) => piece.row === null || piece.col === null).length;
  if (benchCount > run.benchSize) throw codedError('BENCH_FULL', 'Bench capacity exceeded');
  const limit = populationLimit(xp, ctx);
  if (pieces.filter((piece) => piece.row !== null && piece.col !== null)
    .reduce((sum, piece) => sum + piecePopulationCost(piece, ctx), 0) > limit) {
    throw codedError('POPULATION_FULL', 'Deployment population exceeded');
  }
  const sourceTotals = new Map();
  for (const piece of pieces) {
    if (piece.sourceCopies > run.sourceCapPerBody) throw codedError('SOURCE_CAP', 'A body cannot exceed eight source copies');
    sourceTotals.set(piece.purchaseCharId, (sourceTotals.get(piece.purchaseCharId) ?? 0) + piece.sourceCopies);
  }
  for (const copies of sourceTotals.values()) if (copies > run.sourceCapPerBody) throw codedError('SOURCE_CAP', 'A purchase identity cannot exceed eight source copies');
}

export function addBodyToInventory(state, ctx, charId, copies = 1, options = {}) {
  const incoming = pieceFromBody(state, ctx, charId, copies, options);
  let receiverUid = incoming.uid;
  const merged = mergeInventory([...state.pieces, incoming], ctx, (primaryUid, secondaryUid) => {
    if (receiverUid === secondaryUid) receiverUid = primaryUid;
  });
  assertInventory(merged, ctx, state.xp);
  state.pieces = merged;
  const receiver = state.pieces.find((piece) => piece.uid === receiverUid);
  if (!receiver) throw codedError('INVENTORY_RECEIVER_MISSING', `Could not find merged inventory receiver ${receiverUid}`);
  return receiver;
}
