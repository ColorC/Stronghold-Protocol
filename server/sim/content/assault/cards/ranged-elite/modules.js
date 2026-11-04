const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function selectedAdvancedModule(body, piece, rank) {
  if (!object(piece)) throw new TypeError(`${body?.charId ?? 'assault'} module piece is invalid`);
  if (piece.moduleChoices != null && !object(piece.moduleChoices)) {
    throw new TypeError(`${body.charId} moduleChoices must be a bodyId-to-moduleId map`);
  }
  const id = piece.moduleId ?? piece.moduleChoices?.[body.charId] ?? null;
  if (id == null) return null;
  if (typeof id !== 'string' || !id) throw new TypeError(`${body.charId} moduleId must be a string`);
  const plan = (body.modulePlans ?? []).find((entry) => entry.id === id);
  if (!plan || plan.type !== 'ADVANCED' || plan.translation?.type !== 'ADVANCED') {
    throw new TypeError(`unknown ADVANCED module ${body.charId}/${id}`);
  }
  if (rank < (plan.translation.unlockStar ?? 3)) {
    throw new TypeError(`module ${body.charId}/${id} is not unlocked at star ${rank}`);
  }
  return Object.freeze({ id, star: rank, fourStar: rank === 4, plan });
}

export function moduleHas(module, id) { return module?.id === id; }

export function moduleLevel(module, rank3, rank4 = rank3) {
  if (!module) return 0;
  return module.fourStar ? rank4 : rank3;
}

export function validateAllAdvancedModules(body) {
  for (const plan of body.modulePlans ?? []) {
    if (plan.type === 'ADVANCED' && plan.translation?.effectHandling == null) {
      throw new TypeError(`advanced module ${body.charId}/${plan.id} has no translated effect handling`);
    }
  }
}
