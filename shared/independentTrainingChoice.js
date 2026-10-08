import { attachmentAccepted } from './independentRules.js';

const onField = (piece) => piece && piece.row != null && piece.col != null && !piece.deleted && !piece.removed;
const equipmentCount = (piece) => (piece?.equipment || []).reduce((sum, item) => {
  const raw = Number(item.quantity);
  return sum + Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 1));
}, 0);
const uniqueKey = (item) => item?.uniqueKey || item?.canonicalId || item?.id;
const equipmentFor = (catalog, id) => catalog?.equipment?.[id] || catalog?.gear?.[id] || null;

function unlocked(def, level) {
  const unlock = Number(def?.shopTier ?? def?.shopLevel ?? def?.tier ?? def?.level ?? 1);
  return Number.isFinite(unlock) && unlock <= Number(level || 1);
}

/**
 * The currently legal, permanent training choices for one deployed operator.
 * Entries are existing attachment/equipment IDs so the session can retain the
 * established attachment-offer transaction and resolve definitions by kind.
 */
export function trainingChoiceOptions(state, catalog, piece) {
  if (!onField(piece) || !catalog?.operators?.[piece.chessId]) return [];
  const level = Number(state?.shop?.level || 1);
  const attachments = Object.values(catalog.attachments || {}).filter((def) => def?.id && def.unique !== false
    && def.available !== false && unlocked(def, level)
    && !(piece.attachments || []).some((item) => item.id === def.id)
    && attachmentAccepted(def, piece, catalog)).map((def) => def.id);

  const trainingGearIds = catalog.config?.trainingGearIds || catalog.rules?.trainingGearIds || [];
  const wornUnique = new Set((piece.equipment || []).map((item) => equipmentFor(catalog, item.id)).filter((def) => def?.unique).map(uniqueKey));
  const gear = [...new Set(trainingGearIds)].filter((id) => {
    const def = equipmentFor(catalog, id);
    return !!def && def.available !== false && !def.retired && !def.unassigned
      && def.mechanism !== 'disabled' && !['permit', 'prizeGear', '停用'].includes(def.kind)
      && unlocked(def, level) && equipmentCount(piece) < Number(catalog.config?.equipmentCapacity || 999)
      && (!def.unique || !wornUnique.has(uniqueKey(def)));
  });
  return [...new Set([...attachments, ...gear])];
}

/** Deployed operators that can legally receive at least one training choice. */
export function trainingChoiceTargets(state, catalog) {
  return (state?.pieces || []).filter((piece) => onField(piece) && trainingChoiceOptions(state, catalog, piece).length > 0);
}

/** Deterministic uniform shuffle/sample driven by the session's persisted RNG state. */
export function drawTrainingChoices(options, rngState, limit = 3) {
  const list = [...new Set(Array.isArray(options) ? options.filter((id) => typeof id === 'string') : [])];
  let state = (Number(rngState) >>> 0) || 1;
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return { choices: list.slice(0, Math.max(0, Math.min(list.length, Math.floor(limit)))), rngState: state };
}
