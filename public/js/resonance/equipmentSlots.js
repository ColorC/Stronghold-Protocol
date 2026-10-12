// 共鸣 equipment slots (server: server/modes/resonance/session.js equipmentPlacement): an operator carries three items;
// a component dropped on an operator holding a matching component combines in that slot even when all three are used.

/** Equipment slots per operator. */
export const RESONANCE_EQUIP_SLOTS = 3;

/** The recipe that combines `first` and `second` (either order), or null. */
export const recipeFor = (recipes, first, second) => (recipes || []).find(recipe => recipe.parts?.length === 2 &&
  ((recipe.parts[0] === first && recipe.parts[1] === second) || (recipe.parts[1] === first && recipe.parts[0] === second))) || null;

/** Whether `itemId` hands its carrier a 盟约 (徽记, a transferred pact) — worthless on an operator that belongs to none (正义骑士号). */
export const carriesPact = (catalog, itemId) => {
  const item = catalog?.equipment?.[itemId];
  return item?.kind === 'emblem' || (item?.effects || []).some(effect => ['pact_transfer', 'transfer_pact', 'choose_identity_transfer'].includes(effect.kind));
};
/** True when `target` belongs to no 盟约 and `itemId` would give it one: the session refuses (PACT_NOT_COUNTED). */
export const pactRefusal = (catalog, target, itemId) => !!target && catalog?.operators?.[target.operatorId]?.ignoresDeployLimit === true && carriesPact(catalog, itemId);

/**
 * Why dropping item `itemId` on operator piece `target` is refused, or null when the session accepts it: a full
 * operator (3/3) without a matching component, or a second copy of a one-per-operator item. The item then stays in the
 * inventory — nothing is replaced or lost.
 */
export function equipRefusal(catalog, target, itemId, operatorName = '该干员') {
  const gear = target?.equipment || [];
  const recipe = gear.map(item => recipeFor(catalog?.recipes, itemId, item.itemId)).find(Boolean);
  const resultId = recipe?.resultId ?? itemId;
  if (pactRefusal(catalog, target, resultId)) return `「${operatorName}」不计入盟约，无法佩戴徽记`;
  if (catalog?.equipment?.[resultId]?.unique && gear.some(item => item.itemId === resultId)) return `「${operatorName}」已携带${catalog.equipment[resultId].name || '同名装备'}，每名干员限1件`;
  if (!recipe && gear.length >= RESONANCE_EQUIP_SLOTS) return `「${operatorName}」的装备栏已满（${gear.length}/${RESONANCE_EQUIP_SLOTS}），可先合成或卸下装备`;
  return null;
}
