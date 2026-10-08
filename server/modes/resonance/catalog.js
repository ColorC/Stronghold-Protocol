import { getData } from '../../data.js';
import { resonanceContent, buildRecruitmentPool, resonanceSourceSkillGaps } from '../../../shared/resonance/catalog.js';

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
export function getResonanceCatalog(data = getData(), { environmentId = 'origin_laterano', seed = 1 } = {}) {
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
  const resolvedEnvironmentId = catalog.environments[environmentId]
    ? environmentId
    : catalog.environments[`origin_${environmentId}`]
      ? `origin_${environmentId}`
      : null;
  if (!resolvedEnvironmentId) throw new Error(`RESONANCE_UNKNOWN_ENVIRONMENT:${environmentId}`);
  const activeOperatorIds = buildRecruitmentPool(catalog, { environmentId: resolvedEnvironmentId, seed });
  const starterIds = chooseStarterIds(activeOperatorIds, operators);
  catalog.config = { environmentId: resolvedEnvironmentId, seed, activeOperatorIds, starterIds };
  catalog.diagnostics = { sourceSkillGaps: clone(resonanceSourceSkillGaps) };
  return catalog;
}

export { buildRecruitmentPool, resonanceContent, resonanceSourceSkillGaps };
