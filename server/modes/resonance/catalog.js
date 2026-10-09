import { getData } from '../../data.js';
import { resonanceContent, buildRecruitmentPool, resonanceSourceSkillGaps } from '../../../shared/resonance/catalog.js';
import { selectResonanceOpening, resonanceRulesVersion } from '../../../shared/resonance/openings.js';
import { resonanceSeason, resonanceSeasonTraitOverrides, validateResonanceSeasonRoster } from '../../../shared/resonance/season-roster.js';
import { applyCurrentStrategies } from '../../../shared/resonance/current-strategies.js';
import { applyCurrentPacts } from '../../../shared/resonance/current-pacts.js';
import { applyCurrentOperators } from '../../../shared/resonance/current-operators.js';
import { applyCurrentEquipment } from '../../../shared/resonance/current-equipment.js';

const clone = (value) => structuredClone(value);
const operatorCache = new WeakMap();

function skillFor(data, sourceChess, skillId, fallback) {
  if (!skillId) return null;
  return (sourceChess.skills ?? []).find((skill) => skill.skillId === skillId)
    ?? (sourceChess.skill?.skillId === skillId ? sourceChess.skill : null)
    ?? fallback
    ?? null;
}

function chooseStarterIds(activeOperatorIds, operators) {
  const active = activeOperatorIds.map((id) => operators[id]);
  const frontline = active.filter((op) => op.cost === 1 && op.role === 'frontline');
  const ranged = active.filter((op) => op.cost === 1 && op.position === 'RANGED');
  const starters = [...frontline.slice(0, 2).map((op) => op.id)];
  const range = ranged.find((op) => !starters.includes(op.id)) ?? ranged[0];
  if (range) starters.push(range.id);
  if (starters.length !== 3) throw new Error('RESONANCE_STARTERS_UNAVAILABLE');
  return starters;
}

/**
 * Merge the published, deterministic resonance configuration with canonical native chess data.
 * The environment pool contains 65 IDs; the operator map always retains all 154 entries.
 */
export function getResonanceCatalog(data = getData(), options = {}) {
  const { environmentId = 'origin_laterano', seed = 1 } = options;
  // Explicit environment-only calls are the legacy configuration API. New entry points always request v2.
  const rulesVersion = options.rulesVersion ?? (Object.hasOwn(options, 'environmentId') ? 1 : 2);
  resonanceRulesVersion({ rulesVersion });
  const nativeChess = data?.chess;
  if (!nativeChess || typeof nativeChess !== 'object') throw new Error('RESONANCE_NATIVE_CHESS_UNAVAILABLE');
  let operators=operatorCache.get(nativeChess);
  if (!operators) {
   operators = {};
   for (const [sourceChessId, configured] of Object.entries(resonanceContent.operators)) {
    const normalChess = nativeChess[sourceChessId];
    if (!normalChess) throw new Error(`RESONANCE_SOURCE_CHESS_MISSING:${sourceChessId}`);
    const selectedSkill = configured.fixedSkillIndex === null
      ? null
      : skillFor(data, normalChess, configured.fixedSkillId, configured.stars[1].record.skill);
    const normalChessView = clone(normalChess);
    if (selectedSkill) normalChessView.skill = { ...clone(selectedSkill), skillId: configured.fixedSkillId, index: configured.fixedSkillIndex ?? 0 };
    const stars = {};
    for (const star of [1, 2, 3]) {
      const spec = configured.stars[star];
      const record = clone(normalChess);
      record.tier = configured.cost;
      record.resonanceStar = star;
      record.stats = { ...normalChess.stats, ...spec.stats };
      record.skill = selectedSkill ? { ...clone(selectedSkill), ...spec.skillOverrides, skillId: configured.fixedSkillId, index: configured.fixedSkillIndex ?? 0 } : null;
      record.skills = record.skill
        ? (normalChess.skills ?? []).map((skill) => skill.skillId === record.skill.skillId ? record.skill : clone(skill))
        : [];
      if (Array.isArray(normalChess.talents)) record.talents = normalChess.talents.map((talent, index) => ({
        ...clone(talent), bb: { ...(talent.bb ?? {}), ...(spec.talentOverrides[index]?.bb ?? {}) },
      }));
      stars[star] = { ...clone(spec), record, normalized: { ...spec.stats } };
    }
    operators[sourceChessId] = {
      ...configured,
      source: { ...configured.source, normalChess: normalChessView },
      stars,
    };
   }
   operatorCache.set(nativeChess,operators);
  }
  const catalog = { ...resonanceContent, operators };
  if (rulesVersion === 2) {
    const seasonOperators = { ...operators };
    for (const [id, additions] of Object.entries(resonanceSeasonTraitOverrides)) {
      if (!Object.hasOwn(operators, id)) throw new Error(`RESONANCE_UNKNOWN_SEASON_OPERATOR:${id}`);
      seasonOperators[id] = { ...operators[id], pacts: [...new Set([...operators[id].pacts, ...additions])] };
    }
    catalog.operators = seasonOperators;
    const activeOperatorIds = validateResonanceSeasonRoster(seasonOperators);
    const currentCatalog = applyCurrentOperators(applyCurrentPacts(applyCurrentStrategies(applyCurrentEquipment(catalog))));
    const campaign = clone(currentCatalog.campaign);
    campaign.strategyNodes = [5, 13, 20];
    delete campaign.supply.acceleratedStrategy;
    campaign.supply.transfers = campaign.supply.transfers.map((entry) => ({ ...entry, selection: 'viable-pact' }));
    campaign.poolByCost = Object.fromEntries([1,2,3,4,5].map((cost) => [cost, activeOperatorIds.filter((id) => operators[id].cost === cost).length]));
    currentCatalog.campaign = campaign;
    currentCatalog.season = resonanceSeason;
    currentCatalog.config = { rulesVersion, seasonId: resonanceSeason.id, environmentId: null, openingId: selectResonanceOpening(seed), seed, activeOperatorIds, starterIds: chooseStarterIds(activeOperatorIds, seasonOperators) };
    currentCatalog.diagnostics = { sourceSkillGaps: clone(resonanceSourceSkillGaps) };
    return currentCatalog;
  }
  const resolvedEnvironmentId = catalog.environments[environmentId]
    ? environmentId
    : catalog.environments[`origin_${environmentId}`]
      ? `origin_${environmentId}`
      : null;
  if (!resolvedEnvironmentId) throw new Error(`RESONANCE_UNKNOWN_ENVIRONMENT:${environmentId}`);
  const activeOperatorIds = buildRecruitmentPool(catalog, { environmentId: resolvedEnvironmentId, seed });
  const starterIds = chooseStarterIds(activeOperatorIds, operators);
  catalog.config = { rulesVersion: 1, environmentId: resolvedEnvironmentId, seed, activeOperatorIds, starterIds };
  catalog.diagnostics = { sourceSkillGaps: clone(resonanceSourceSkillGaps) };
  return catalog;
}

export function getLegacyResonanceCatalog(data = getData(), { environmentId = 'origin_laterano', seed = 1 } = {}) {
  return getResonanceCatalog(data, { rulesVersion: 1, environmentId, seed });
}

export function getResonanceCatalogForState(data, state) {
  const rulesVersion = resonanceRulesVersion(state);
  return rulesVersion === 1 ? getLegacyResonanceCatalog(data, state) : getResonanceCatalog(data, { rulesVersion, seed: state.seed });
}

export { buildRecruitmentPool, resonanceContent, resonanceSourceSkillGaps };
