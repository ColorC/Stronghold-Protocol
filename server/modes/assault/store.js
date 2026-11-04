import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertInventory } from '../../../shared/assault/inventory.js';
import { validateTemporaryPiece } from '../../../shared/assault/temporary-enhancements.js';
import { validateTemporaryMaxLife } from '../../../shared/assault/temporary-player-enhancements.js';
import { temporaryEnchantmentRecords } from '../../../shared/assault/temporary-enchantments.js';
import { validateSupplies, supplyFor } from '../../../shared/assault/supplies.js';
import { validateTemporaryAbilityRun } from '../../../shared/assault/temporary-abilities.js';
import { auditRun, reconcileRunDeployments, reconcileSupplyPreview } from '../../../shared/assault/run.js';
import { repairLegacyShopSupply, repriceOperatorShop, SHOP_SUPPLY_VERSION } from '../../../shared/assault/shops.js';

export const ASSAULT_RUN_SCHEMA = 'assault-run/v1';
export const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Automatic deployment and shop-supply migrations may each add one legacy receipt.
const MAX_HISTORY = 4099;
const MAX_JOURNAL = 4099;
const MAX_NESTING = 64;
const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400];
const DIRECTIONS = new Set(['N', 'E', 'S', 'W']);
const PHASES = new Set(['nodeChoice', 'skillChoice', 'upgradeChoice', 'shop', 'event', 'event-resolved', 'battlePrep', 'battle', 'rewards', 'ended']);
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'sourcePath', 'directory', 'root', 'eval']);

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value) => Number.isInteger(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }); };

function plain(value, depth = 0) {
  if (depth > MAX_NESTING) fail('INVALID_RUN');
  if (Array.isArray(value)) { value.forEach((item) => plain(item, depth + 1)); return; }
  if (!object(value)) return;
  if (Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_RUN');
  for (const [key, item] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) fail('INVALID_RUN');
    plain(item, depth + 1);
  }
}

function stringList(value, label, { unique = true, max = 1024 } = {}) {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string' || !item || item.length > 256)) fail('INVALID_RUN', label);
  if (unique && new Set(value).size !== value.length) fail('INVALID_RUN', label);
}

function finiteMap(value, label) {
  if (!object(value)) fail('INVALID_RUN', label);
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 100 || !finite(item)) fail('INVALID_RUN', label);
  }
}

function moduleIsLegal(body, moduleId, star) {
  if (moduleId == null) return;
  if (typeof moduleId !== 'string') fail('INVALID_RUN', 'moduleChoices');
  const resolved = body.adaptation?.moduleAliases?.[moduleId] ?? moduleId;
  const plan = body.modulePlans?.find((entry) => entry?.id === resolved);
  if (!plan) fail('INVALID_RUN', 'moduleChoices');
  const unlock = plan.translation?.unlockStar ?? plan.unlockStar ?? (plan.type === 'ADVANCED' ? 3 : 0);
  if (star < unlock || plan.mode === 'disabled') fail('INVALID_RUN', 'moduleChoices');
}

function validatePiece(piece, ctx, seen) {
  if (!object(piece) || typeof piece.uid !== 'string' || !piece.uid || seen.has(piece.uid)) fail('INVALID_RUN', 'pieces');
  seen.add(piece.uid);
  const operator = ctx.catalog.operators?.[piece.purchaseCharId];
  const body = ctx.catalog.bodies?.[piece.charId];
  if (!operator || !body || body.purchaseCharId !== piece.purchaseCharId) fail('INVALID_RUN', 'pieces');
  if (!integer(piece.star) || piece.star < 1 || piece.star > 4 || !integer(piece.sourceCopies)
    || piece.sourceCopies < 1 || piece.sourceCopies > 2 ** (piece.star - 1)) fail('INVALID_RUN', 'pieces');
  stringList(piece.forms, 'forms', { max: 32 });
  if (!piece.forms.includes(piece.charId)) fail('INVALID_RUN', 'forms');
  for (const formId of piece.forms) {
    const form = ctx.catalog.bodies?.[formId];
    if (!form || form.purchaseCharId !== piece.purchaseCharId) fail('INVALID_RUN', 'forms');
  }
  if (!object(piece.moduleChoices)) fail('INVALID_RUN', 'moduleChoices');
  for (const formId of piece.forms) {
    if (!Object.hasOwn(piece.moduleChoices, formId)) fail('INVALID_RUN', 'moduleChoices');
    moduleIsLegal(ctx.catalog.bodies[formId], piece.moduleChoices[formId], piece.star);
  }
  finiteMap(piece.permanentFlat, 'permanentFlat');
  finiteMap(piece.permanentPercent, 'permanentPercent');
  // 卡内本局永久成长 (synergy runCounter): absent on older saves (counts 0); when present, key → { label, suffix, amount }
  if (piece.permanentCounters !== undefined) {
    if (!object(piece.permanentCounters) || Object.keys(piece.permanentCounters).length > 128) fail('INVALID_RUN', 'permanentCounters');
    for (const [key, entry] of Object.entries(piece.permanentCounters)) {
      if (!key || key.length > 100 || !object(entry) || Object.keys(entry).some((k) => !['label', 'suffix', 'amount'].includes(k))
        || typeof entry.label !== 'string' || !entry.label || entry.label.length > 100
        || (entry.suffix !== undefined && (typeof entry.suffix !== 'string' || entry.suffix.length > 8)) || !finite(entry.amount)) fail('INVALID_RUN', 'permanentCounters');
    }
  }
  if (piece.permanentPercentSources !== undefined) {
    if (!object(piece.permanentPercentSources) || Object.keys(piece.permanentPercentSources).length > 512) fail('INVALID_RUN', 'permanentPercentSources');
    const projection = {};
    for (const [source, values] of Object.entries(piece.permanentPercentSources)) {
      if (!source || source.length > 256) fail('INVALID_RUN', 'permanentPercentSources');
      finiteMap(values, 'permanentPercentSources');
      for (const [stat, value] of Object.entries(values)) projection[stat] = (projection[stat] ?? 0) + value;
    }
    // Empty sources are a legacy save until the shared inventory migrates it.
    if (Object.keys(piece.permanentPercentSources).length) {
      for (const stat of new Set([...Object.keys(projection), ...Object.keys(piece.permanentPercent)])) {
        if (!finite(projection[stat] ?? 0) || Math.abs((projection[stat] ?? 0) - (piece.permanentPercent[stat] ?? 0)) > 1e-9) fail('INVALID_RUN', 'permanentPercentSources');
      }
    }
  }
  if (!object(piece.tagEdits) || !Array.isArray(piece.tagEdits.add) || !Array.isArray(piece.tagEdits.remove)) fail('INVALID_RUN', 'tagEdits');
  stringList(piece.tagEdits.add, 'tagEdits', { max: 128 });
  stringList(piece.tagEdits.remove, 'tagEdits', { max: 128 });
  stringList(piece.claimed, 'claimed', { max: 512 });
  if (!Array.isArray(piece.summonPresets) || piece.summonPresets.length > 12) fail('INVALID_RUN', 'summonPresets');
  for (const preset of piece.summonPresets) {
    if (preset === null) continue;
    if (!object(preset)) fail('INVALID_RUN', 'summonPresets');
    if (preset.tokenId !== undefined && (typeof preset.tokenId !== 'string'
      || !ctx.catalog.summons?.[preset.tokenId] && body.adaptation?.marker?.id !== preset.tokenId)) fail('INVALID_RUN', 'summonPresets');
    if (preset.row !== undefined || preset.col !== undefined) {
      if (!integer(preset.row) || !integer(preset.col) || preset.row < 9 || preset.row > 12 || preset.col < 2 || preset.col > 10) fail('INVALID_RUN', 'summonPresets');
    }
    if (preset.dir !== undefined && !DIRECTIONS.has(preset.dir)) fail('INVALID_RUN', 'summonPresets');
  }
  if (typeof piece.starter !== 'boolean') fail('INVALID_RUN', 'pieces');
  const bench = piece.row == null && piece.col == null;
  if (!bench && (!integer(piece.row) || !integer(piece.col) || piece.row < 9 || piece.row > 12 || piece.col < 2 || piece.col > 10)) fail('INVALID_RUN', 'pieces');
  if ((piece.row == null) !== (piece.col == null) || !DIRECTIONS.has(piece.dir)) fail('INVALID_RUN', 'pieces');
}

function validateRunState(state, ctx) {
  plain(state);
  if (!object(state) || state.schema !== ASSAULT_RUN_SCHEMA || !RUN_ID.test(state.runId)) fail('INVALID_RUN');
  if (!ctx?.catalog || !ctx?.design?.system?.run) fail('INVALID_CONTEXT');
  if (!ctx.design.system.directors.some((director) => director.id === state.directorId)) fail('INVALID_RUN');
  if (![state.seed, state.rngState].every((value) => integer(value) && value >= 0 && value <= 0xffffffff)) fail('INVALID_RUN');
  if (!integer(state.revision) || state.revision < 0 || !integer(state.day) || state.day < 1 || state.day > 10 || !integer(state.hour) || state.hour < 1 || state.hour > 6 || !PHASES.has(state.phase)) fail('INVALID_RUN');
  for (const key of ['gold', 'xp', 'tech', 'life', 'maxLife', 'nextShopDiscount']) if (!finite(state[key]) || state[key] < 0 || !integer(state[key])) fail('INVALID_RUN');
  if (state.life > state.maxLife || !integer(state.nextPieceId) || state.nextPieceId < 1) fail('INVALID_RUN');
  validateTemporaryMaxLife(state);
  validateSupplies(state, ctx);
  validateTemporaryAbilityRun(state);
  for (const key of ['pieces', 'relicIds', 'claimed', 'visitedEvents', 'nextBattleEffects', 'nodes', 'nodeChoices', 'history', 'opJournal']) if (!Array.isArray(state[key])) fail('INVALID_RUN');
  if (state.history.length > MAX_HISTORY || state.opJournal.length > MAX_JOURNAL) fail('INVALID_RUN');
  stringList(state.relicIds, 'relicIds', { max: 256 });
  stringList(state.claimed, 'claimed', { max: 2048 });
  stringList(state.visitedEvents, 'visitedEvents', { max: 256 });
  const relics = new Set(ctx.design.collectibles.items.map((item) => item.id));
  if (state.relicIds.some((id) => !relics.has(id))) fail('INVALID_RUN', 'relicIds');
  if (state.relicCounters !== undefined) {
    if (!object(state.relicCounters)) fail('INVALID_RUN', 'relicCounters');
    for (const [id, value] of Object.entries(state.relicCounters)) {
      if (!relics.has(id) || !integer(value) || value < 0 || (id === 'pierce-altar' && value > 10)) fail('INVALID_RUN', 'relicCounters');
    }
  }
  const seen = new Set();
  state.pieces.forEach((piece) => {
    validatePiece(piece, ctx, seen);
    validateTemporaryPiece(piece, state, ctx.catalog.bodies[piece.charId]);
    temporaryEnchantmentRecords(piece, state, ctx);
  });
  const enchantmentIds = new Set((ctx.design.system.enchantments ?? []).map((entry) => entry.id));
  for (const piece of state.pieces) if (piece.enchantmentId !== undefined
    && (typeof piece.enchantmentId !== 'string' || !enchantmentIds.has(piece.enchantmentId))) fail('INVALID_RUN', 'pieces.enchantmentId');
  if (state.skillRanks !== undefined) {
    if (!object(state.skillRanks)) fail('INVALID_RUN', 'skillRanks');
    const skillIds = new Set((ctx.design.system.strategySkills ?? []).map((entry) => entry.id));
    for (const [id, rank] of Object.entries(state.skillRanks)) if (!skillIds.has(id) || !integer(rank) || rank < 1 || rank > 4) fail('INVALID_RUN', 'skillRanks');
  }
  if (state.teamGrowth !== undefined) {
    if (!object(state.teamGrowth)) fail('INVALID_RUN', 'teamGrowth');
    for (const [stat, amount] of Object.entries(state.teamGrowth)) if (!stat || !finite(amount)) fail('INVALID_RUN', 'teamGrowth');
  }
  if (state.pendingSkillRewards !== undefined) {
    if (!Array.isArray(state.pendingSkillRewards) || state.pendingSkillRewards.length > 8) fail('INVALID_RUN', 'pendingSkillRewards');
    const configured = new Map((ctx.design.system.skillLevelRewards ?? []).map((entry) => [entry.id, entry]));
    const seenRewards = new Set();
    for (const [index, reward] of state.pendingSkillRewards.entries()) {
      const rule = configured.get(reward?.id);
      if (!object(reward) || !rule || seenRewards.has(reward.id) || reward.star !== rule.star || reward.count !== rule.count
        || (reward.tech !== undefined && reward.tech !== rule.tech)
        || !state.claimed.includes(`skill-level-reward:${reward.id}`)) fail('INVALID_RUN', 'pendingSkillRewards');
      seenRewards.add(reward.id);
      if (reward.choices !== undefined) {
        const skills = new Map((ctx.design.system.strategySkills ?? []).map((entry) => [entry.id, entry]));
        if (index !== 0 || !Array.isArray(reward.choices) || reward.choices.length < 1 || reward.choices.length > reward.count
          || new Set(reward.choices).size !== reward.choices.length
          || reward.choices.some((id) => !skills.has(id) || skills.get(id).startingStar > reward.star
            || (state.skillRanks?.[id] ?? 0) > reward.star || (state.skillRanks?.[id] ?? 0) >= 4)) fail('INVALID_RUN', 'pendingSkillRewards.choices');
      }
    }
    for (let i = 1; i < state.pendingSkillRewards.length; i += 1) {
      const previousTech = state.pendingSkillRewards[i - 1].tech ?? configured.get(state.pendingSkillRewards[i - 1].id)?.tech;
      const nextTech = state.pendingSkillRewards[i].tech ?? configured.get(state.pendingSkillRewards[i].id)?.tech;
      if (previousTech > nextTech) fail('INVALID_RUN', 'pendingSkillRewards.order');
    }
    if (state.pendingSkillRewards[0]?.choices && state.phase !== 'skillChoice') fail('INVALID_RUN', 'pendingSkillRewards.phase');
    if (state.phase === 'skillChoice' && !state.pendingSkillRewards[0]?.choices) fail('INVALID_RUN', 'pendingSkillRewards.phase');
  } else if (state.phase === 'skillChoice') fail('INVALID_RUN', 'pendingSkillRewards');
  if (state.phase === 'skillChoice' && (state.life <= 0 || state.completed || state.pendingAdvance || state.currentNode !== null
    || state.shop !== null || state.currentEvent !== null || state.currentBattle !== null || state.rewardQueue !== null)) fail('INVALID_RUN', 'pendingSkillRewards.phase');
  if (state.pendingUpgradeRewards !== undefined) {
    if (!Array.isArray(state.pendingUpgradeRewards) || state.pendingUpgradeRewards.length > 8) fail('INVALID_RUN', 'pendingUpgradeRewards');
    const configured = new Map((ctx.design.system.operatorUpgradeRewards ?? []).map((entry) => [entry.id, entry]));
    const seenRewards = new Set();
    const configuredTech = new Map((ctx.design.system.operatorUpgradeRewards ?? []).map((entry) => [entry.id, entry.tech]));
    for (const [index, reward] of state.pendingUpgradeRewards.entries()) {
      const rule = configured.get(reward?.id);
      if (!object(reward) || !rule || seenRewards.has(reward.id)
        || reward.maxStar !== rule.maxStar || reward.count !== rule.count
        || (reward.tech !== undefined && reward.tech !== rule.tech)
        || !state.claimed.includes(`operator-upgrade-reward:${reward.id}`)) fail('INVALID_RUN', 'pendingUpgradeRewards');
      seenRewards.add(reward.id);
      if (reward.choices !== undefined) {
        if (index !== 0 || !Array.isArray(reward.choices) || reward.choices.length < 1 || reward.choices.length > reward.count
          || new Set(reward.choices).size !== reward.choices.length
          || reward.choices.some((uid) => typeof uid !== 'string' || !state.pieces.some((piece) => piece.uid === uid
            && piece.star >= 1 && piece.star <= reward.maxStar && piece.star < 4))) fail('INVALID_RUN', 'pendingUpgradeRewards.choices');
      }
    }
    for (let i = 1; i < state.pendingUpgradeRewards.length; i += 1) {
      const previousTech = state.pendingUpgradeRewards[i - 1].tech ?? configuredTech.get(state.pendingUpgradeRewards[i - 1].id);
      const nextTech = state.pendingUpgradeRewards[i].tech ?? configuredTech.get(state.pendingUpgradeRewards[i].id);
      if (previousTech > nextTech) fail('INVALID_RUN', 'pendingUpgradeRewards.order');
    }
    if (state.pendingUpgradeRewards[0]?.choices && state.phase !== 'upgradeChoice') fail('INVALID_RUN', 'pendingUpgradeRewards.phase');
    if (state.phase === 'upgradeChoice' && !state.pendingUpgradeRewards[0]?.choices) fail('INVALID_RUN', 'pendingUpgradeRewards.phase');
  } else if (state.phase === 'upgradeChoice') fail('INVALID_RUN', 'pendingUpgradeRewards');
  if (state.phase === 'upgradeChoice' && (state.life <= 0 || state.completed || state.pendingAdvance || state.currentNode !== null
    || state.shop !== null || state.currentEvent !== null || state.currentBattle !== null || state.rewardQueue !== null
    || !!state.pendingSkillRewards?.[0]?.choices)) fail('INVALID_RUN', 'pendingUpgradeRewards.phase');
  const rewardTech = (reward, definitions) => reward?.tech ?? definitions.find((entry) => entry.id === reward?.id)?.tech ?? Number.MAX_SAFE_INTEGER;
  const skillDefinitions = ctx.design.system.skillLevelRewards ?? [];
  const upgradeDefinitions = ctx.design.system.operatorUpgradeRewards ?? [];
  const earnedTech = ctx.design.system.run.xpThresholds.reduce((value, threshold, index) => state.xp >= threshold ? index + 1 : value, 1);
  if (state.phase === 'skillChoice' && state.pendingUpgradeRewards?.length
    && rewardTech(state.pendingSkillRewards?.[0], skillDefinitions) > rewardTech(state.pendingUpgradeRewards[0], upgradeDefinitions)) fail('INVALID_RUN', 'pendingSkillRewards.order');
  if (state.phase === 'upgradeChoice' && state.pendingSkillRewards?.length
    && rewardTech(state.pendingUpgradeRewards?.[0], upgradeDefinitions) > rewardTech(state.pendingSkillRewards[0], skillDefinitions)) fail('INVALID_RUN', 'pendingUpgradeRewards.order');
  for (const reward of [...(state.pendingSkillRewards ?? []), ...(state.pendingUpgradeRewards ?? [])]) {
    const definitions = state.pendingSkillRewards?.includes(reward) ? skillDefinitions : upgradeDefinitions;
    if (rewardTech(reward, definitions) > earnedTech) fail('INVALID_RUN', 'pendingRewards.tech');
  }
  const active = state.pieces.filter((piece) => piece.row !== null && piece.col !== null);
  if (new Set(active.map((piece) => `${piece.row}:${piece.col}`)).size !== active.length) fail('INVALID_RUN', 'pieces');
  assertInventory(state.pieces, ctx, state.xp);
  if (!object(state.tagEdits ?? {})) fail('INVALID_RUN');
  if (state.currentNode !== null && !object(state.currentNode)) fail('INVALID_RUN');
  const encounters = ctx.design.encounters.encounters;
  if(state.mapEncounterId!=null&&!encounters.some(entry=>entry.id===state.mapEncounterId&&entry.kind!=='final'))fail('INVALID_RUN','mapEncounterId');
  if (state.prepEncounterId !== undefined && state.prepEncounterId !== null
    && (typeof state.prepEncounterId !== 'string' || !encounters.some((entry) => entry.id === state.prepEncounterId))) fail('INVALID_RUN', 'prepEncounterId');
  if (state.prepDeploymentVersion !== undefined && ![0, 1].includes(state.prepDeploymentVersion)) fail('INVALID_RUN', 'prepDeploymentVersion');
  if (state.deploymentMigrationPending !== undefined && typeof state.deploymentMigrationPending !== 'boolean') fail('INVALID_RUN', 'deploymentMigrationPending');
  if (state.shop !== null && !object(state.shop)) fail('INVALID_RUN');
  if (state.shop) {
    const definition = ctx.design.system.shopDefinitions.find((entry) => entry.id === state.shop.id);
    const kind = state.shop.kind ?? definition?.kind ?? 'operator';
    if (typeof state.shop.id !== 'string' || !definition
      || !Array.isArray(state.shop.slots) || !integer(state.shop.refreshCost) || state.shop.refreshCost < 0 || !integer(state.shop.refreshCount) || state.shop.refreshCount < 0) fail('INVALID_RUN', 'shop');
    if (state.shop.supplyVersion !== undefined && ![1, SHOP_SUPPLY_VERSION].includes(state.shop.supplyVersion)) fail('INVALID_RUN', 'shop.supplyVersion');
    for (const slot of state.shop.slots) {
      if (!object(slot) || typeof slot.slotId !== 'string' || !integer(slot.star) || slot.star < 1 || slot.star > 4 || !integer(slot.price) || slot.price < 0) fail('INVALID_RUN', 'shop');
      if (kind !== 'operator' && slot.kind === 'operator') {
        // the current leader's cores are also offered in skill / enchantment / supply shops (shared/assault/shops.js coreShopCandidates)
        if (typeof slot.purchaseCharId !== 'string' || !integer(slot.requiredCopies) || slot.requiredCopies !== 2 ** (slot.star - 1)
          || !ctx.catalog.operators[slot.purchaseCharId] || !ctx.catalog.bodies[slot.charId ?? slot.purchaseCharId]) fail('INVALID_RUN', 'shop.operatorSlot');
      } else if (kind === 'skill') {
        if (slot.kind !== 'skill' || !(ctx.design.system.strategySkills ?? []).some((entry) => entry.id === slot.skillId)) fail('INVALID_RUN', 'shop.skill');
      } else if (kind === 'enchantment') {
        if (slot.kind !== 'enchantment' || !enchantmentIds.has(slot.enchantmentId)) fail('INVALID_RUN', 'shop.enchantment');
      } else if (kind === 'supply') {
        const item = supplyFor(ctx, slot.itemId);
        if (slot.kind !== 'supply' || !item || !item.allowedStars.includes(slot.star)) fail('INVALID_RUN', 'shop.supply');
      } else {
        if (slot.kind !== undefined && slot.kind !== 'operator') fail('INVALID_RUN', 'shop.kind');
        if (typeof slot.purchaseCharId !== 'string' || !integer(slot.requiredCopies) || slot.requiredCopies !== 2 ** (slot.star - 1)
          || !ctx.catalog.operators[slot.purchaseCharId] || !ctx.catalog.bodies[slot.charId ?? slot.purchaseCharId]) fail('INVALID_RUN', 'shop');
      }
    }
  }
  if (state.currentEvent !== null && !object(state.currentEvent)) fail('INVALID_RUN');
  if (state.rewardQueue !== null && !object(state.rewardQueue)) fail('INVALID_RUN');
  if (state.currentBattle !== null && !object(state.currentBattle)) fail('INVALID_RUN');
  if (state.currentBattle) {
    if (typeof state.currentBattle.battleId !== 'string' || typeof state.currentBattle.encounterId !== 'string') fail('INVALID_RUN', 'currentBattle');
    if (state.phase === 'battle' && (!object(state.currentBattle.input) || !object(state.currentBattle.encounter) || !object(state.currentBattle.field) || !object(state.currentBattle.config)
      || Object.hasOwn(state.currentBattle, 'victory') || Object.hasOwn(state.currentBattle, 'won') || Object.hasOwn(state.currentBattle, 'leakedLife') || Object.hasOwn(state.currentBattle, 'result'))) fail('INVALID_RUN', 'currentBattle');
  }
  if (typeof state.completed !== 'boolean' || typeof state.pendingAdvance !== 'boolean') fail('INVALID_RUN');
  const journalIds = new Set();
  for (const entry of state.opJournal) {
    if (!object(entry) || typeof entry.opId !== 'string' || journalIds.has(entry.opId) || !object(entry.action) || entry.action.opId !== entry.opId || !integer(entry.action.expectedRevision) || !object(entry.result)) fail('INVALID_RUN', 'opJournal');
    journalIds.add(entry.opId);
  }
  if (state.opJournal.length !== state.revision) fail('INVALID_RUN', 'revision');
  auditRun(state, ctx);
  return true;
}

async function assertDirectoryTree(directory) {
  const absolute = path.resolve(directory);
  const pieces = path.parse(absolute).root ? absolute.slice(path.parse(absolute).root.length).split(path.sep).filter(Boolean) : [];
  let cursor = path.parse(absolute).root;
  for (const part of pieces) {
    cursor = path.join(cursor, part);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || info.isBlockDevice() || info.isCharacterDevice()) fail('INVALID_RUN_ROOT');
      if (!info.isDirectory()) fail('INVALID_RUN_ROOT');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      break;
    }
  }
}

function pathFor(root, runId) {
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) fail('INVALID_RUN_ID');
  return path.join(root, `${runId}.json`);
}

export function createAssaultStore({ root, context, renameFile = rename }) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('INVALID_RUN_ROOT');
  if (typeof renameFile !== 'function') fail('INVALID_STORE');
  const directory = path.resolve(root);
  const locks = new Map();
  const ensure = async () => {
    await assertDirectoryTree(directory);
    await mkdir(directory, { recursive: true });
    await assertDirectoryTree(directory);
  };
  const read = async (runId) => {
    const file = pathFor(directory, runId);
    let source;
    try { source = await readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') fail('NOT_FOUND'); throw error; }
    let state;
    try { state = JSON.parse(source); } catch { fail('INVALID_RUN'); }
    return state;
  };
  const writeAtomic = async (state) => {
    validateRunState(state, context);
    await ensure();
    const target = pathFor(directory, state.runId);
    const pending = path.join(directory, `${state.runId}.${randomUUID()}.tmp`);
    const serialized = JSON.stringify(state);
    await writeFile(pending, serialized, { encoding: 'utf8', flag: 'wx' });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await renameFile(pending, target);
        break;
      } catch (error) {
        const delay = RENAME_RETRY_DELAYS_MS[attempt];
        if (!['EPERM', 'EBUSY'].includes(error?.code) || delay === undefined) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    return state;
  };
  const inferPrepEncounter = (state) => {
    const ids = [state.currentNode?.kind === 'battle' ? state.currentNode.encounterId : null,
      state.currentBattle?.encounterId,
      ...[...(state.history ?? [])].reverse().filter((entry) => entry?.kind === 'battleSettled').map((entry) => entry.encounterId),
      state.prepEncounterId];
    const encounters = context.design.encounters.encounters;
    return ids.find((id) => encounters.some((encounter) => encounter.id === id))
      ?? encounters.find((encounter) => encounter.kind === 'normal')?.id;
  };
  const migrateDeployment = (state) => {
    if (!object(state)) return false;
    // A live battle must remain byte-for-byte stable until its settlement is saved.
    // Ended runs are archival records and are never rewritten.
    if (state.phase === 'battle' || state.phase === 'ended') return false;
    const versionReady = state.prepDeploymentVersion === 1
      && context.design.encounters.encounters.some((entry) => entry.id === state.prepEncounterId);
    if (versionReady) return false;
    if (!Array.isArray(state.pieces) || !state.pieces.every((piece) => object(piece) && context.catalog.bodies?.[piece.charId]
      && (piece.summonPresets === undefined || Array.isArray(piece.summonPresets)))
      || !Array.isArray(state.history) || !Array.isArray(state.opJournal)) return false;
    const encounterId = inferPrepEncounter(state);
    if (!encounterId) return false;
    const oldCurrentNode = state.currentNode;
    state.prepEncounterId = encounterId;
    let changes = [];
    state.currentNode = { kind: 'battle', encounterId };
    try { changes = reconcileRunDeployments(state, context); }
    finally { state.currentNode = oldCurrentNode; }
    // Old builds could save coordinates outside the deployment schema. Keep
    // their exact instruction in the migration history, never invent a tile.
    // Valid-schema but unavailable manual placements remain untouched.
    for(const piece of state.pieces)for(const[index,preset]of (piece.summonPresets??[]).entries()){
      if(!preset||!integer(preset.row)||!integer(preset.col)
        ||preset.row>=9&&preset.row<=12&&preset.col>=2&&preset.col<=10)continue;
      changes.push({kind:'summonPreset',uid:piece.uid,index,from:clone(preset),to:null,reason:'legacy-outside-deployment-area'});
      piece.summonPresets[index]=null;
    }
    state.prepDeploymentVersion = 1;
    state.deploymentMigrationPending = false;
    const expectedRevision = state.revision;
    const opIds = new Set(state.opJournal.map((entry) => entry.opId));
    let opId = `deployment-migration-v1:${expectedRevision}`;
    for (let suffix = 1; opIds.has(opId); suffix += 1) opId = `deployment-migration-v1:${expectedRevision}:${suffix}`;
    state.revision += 1;
    state.opJournal.push({ opId, action: { type: 'deploymentMigration', opId, expectedRevision },
      result: { encounterId, changed: changes.length } });
    state.history.push({ kind: 'deploymentMigrated', revision: state.revision, encounterId, changes });
    return true;
  };
  const migrateLegacyShopSupply = (state) => {
    const legacy = repairLegacyShopSupply(state, context);
    const repair = repriceOperatorShop(legacy?{...state,shop:legacy.shop,rngState:legacy.rngState}:state, context) ?? legacy;
    if (!repair) return false;
    const expectedRevision = state.revision;
    const opIds = new Set(state.opJournal.map((entry) => entry.opId));
    let opId = `shop-supply-migration-v2:${expectedRevision}`;
    for (let suffix = 1; opIds.has(opId); suffix += 1) opId = `shop-supply-migration-v2:${expectedRevision}:${suffix}`;
    state.shop = repair.shop;
    state.rngState = repair.rngState;
    state.revision += 1;
    state.opJournal.push({ opId, action: { type: 'shopSupplyMigration', opId, expectedRevision },
      result: { shopId: state.shop.id, slotCount: state.shop.slots.length } });
    state.history.push({ kind: 'shopSupplyMigrated', revision: state.revision, shopId: state.shop.id, slotCount: state.shop.slots.length });
    return true;
  };
  const save = async (state) => {
    migrateDeployment(state);
    return writeAtomic(state);
  };
  const loadUnlocked = async (runId) => {
    const state = await read(runId);
    const deploymentMigrated = migrateDeployment(state);
    let mapMigrated=false;
    if(!state.mapEncounterId&&state.phase!=='battle'&&state.phase!=='ended'&&state.prepEncounterId) {
      state.mapEncounterId=context.design.encounters.encounters.find(entry=>entry.id===state.prepEncounterId&&entry.kind!=='final')?.id
        ?? context.design.encounters.encounters.find(entry=>entry.kind==='normal').id;
      const expectedRevision=state.revision,opId=`fixed-map-v1:${expectedRevision}`;
      state.revision++;
      state.opJournal.push({opId,action:{type:'mapMigration',opId,expectedRevision},result:{encounterId:state.mapEncounterId}});
      state.history.push({kind:'mapPinned',encounterId:state.mapEncounterId});mapMigrated=true;
    }
    const shopSupplyMigrated = migrateLegacyShopSupply(state);
    const previewMigrated=reconcileSupplyPreview(state,context);
    if(previewMigrated) {
      const expectedRevision=state.revision;
      const opId=`supply-preview-v1:${expectedRevision}`;
      state.revision++;
      state.opJournal.push({opId,action:{type:'supplyPreviewMigration',opId,expectedRevision},result:{hour:state.hour}});
      state.history.push({kind:'supplyPreviewMigrated',revision:state.revision,day:state.day,hour:state.hour});
    }
    validateRunState(state, context);
    if (deploymentMigrated || shopSupplyMigrated || previewMigrated || mapMigrated) await writeAtomic(state);
    return state;
  };
  const create = async (state) => {
    validateRunState(state, context);
    await ensure();
    const target = pathFor(directory, state.runId);
    const handle = await open(target, 'wx');
    try { await handle.writeFile(JSON.stringify(state), 'utf8'); }
    finally { await handle.close(); }
    return state;
  };
  const withLock = async (runId, task) => {
    const previous = locks.get(runId) ?? Promise.resolve();
    const job = previous.catch(() => {}).then(task);
    locks.set(runId, job);
    try { return await job; }
    finally { if (locks.get(runId) === job) locks.delete(runId); }
  };
  const load = (runId) => withLock(runId, () => loadUnlocked(runId));
  const withRun = (runId, task) => withLock(runId, async () => task(await loadUnlocked(runId)));
  return {
    root: directory,
    pathFor: (runId) => pathFor(directory, runId),
    validate: (state) => validateRunState(state, context),
    load,
    save,
    create,
    withRun,
    async importRun(state, runId) {
      const restored = clone(state);
      restored.runId = runId;
      validateRunState(restored, context);
      return create(restored);
    },
  };
}
