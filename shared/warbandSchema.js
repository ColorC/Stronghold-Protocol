const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
const keys = (x, allowed) => object(x) && Object.keys(x).every(k => allowed.includes(k));
const text = x => typeof x === 'string' && !!x.trim() && !['__proto__','constructor','prototype'].includes(x);
const integer = x => Number.isInteger(x) && x > 0;
const positive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const stats = x => keys(x, ['attackPercent','baseAttackPercent','maxHpPercent','attackSpeedFlat','damageDealtPercent']) && Object.keys(x).length > 0 && Object.values(x).every(positive);
const fail = behavior => { throw new Error(`BAD_WARBAND_RULE:${behavior}`); };
export const WARBAND_BEHAVIORS = Object.freeze(['factionReaction','retiringEffect','deathrattleEcho','retirementMultiplier','warbandEvent']);

// These fields belonged to retired Workshop-authored caps. They are ignored only
// while reading persisted authored rules; native durations and game limits remain
// part of their own schemas and are deliberately not listed here.
export const OBSOLETE_WORKSHOP_LIMIT_FIELDS = Object.freeze([
  'maxCount', 'maxStacks', 'maxPerBattle', 'perBattle', 'firstOnly', 'firstN',
  'capPerOutput', 'cooldownSeconds', 'retaliationCooldownSeconds', 'maxEventsPerPrep',
]);
const obsoleteWorkshopLimitFields = new Set(OBSOLETE_WORKSHOP_LIMIT_FIELDS);
export function withoutObsoleteWorkshopLimits(value) {
  if (Array.isArray(value)) return value.map(withoutObsoleteWorkshopLimits);
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !obsoleteWorkshopLimitFields.has(key))
    .map(([key, child]) => [key, withoutObsoleteWorkshopLimits(child)]));
}

export function validateWarbandRule(rule) {
  const normalized = withoutObsoleteWorkshopLimits(rule);
  const b = normalized?.behavior, p = normalized?.params;
  if (!keys(normalized, ['trigger','behavior','params']) || !object(p)) return fail(b);
  if (b === 'factionReaction') {
    if (!keys(p, ['faction','targetFaction','targetAnyFaction','anyGainFaction','mode','targets','excludeSelf','count','outputs','perTier','requireGainTrait'])
        || !['allyGain','bought','gain','sold'].includes(normalized.trigger) || !['badge','shop','refund','discount','funds'].includes(p.mode)
        || !['self','all','front','leastEquipment'].includes(p.targets) || !integer(p.count)
        || ['excludeSelf','perTier','requireGainTrait','targetAnyFaction','anyGainFaction'].some(k => p[k] !== undefined && typeof p[k] !== 'boolean')
        || (p.targetFaction !== undefined && !text(p.targetFaction))
        || (!['discount','funds'].includes(p.mode) && !text(p.faction))
        || (p.faction !== undefined && !text(p.faction))
        || (['badge','shop'].includes(p.mode) && (!Array.isArray(p.outputs) || !p.outputs.length || !p.outputs.every(o => keys(o,['id','quantity']) && text(o.id) && integer(o.quantity))))
        || (p.outputs !== undefined && !Array.isArray(p.outputs))
        || (p.mode === 'refund' && normalized.trigger !== 'bought') || (p.mode === 'discount' && normalized.trigger !== 'gain') || (p.mode === 'funds' && normalized.trigger !== 'sold')) return fail(b);
  } else if (b === 'retiringEffect') {
    if (normalized.trigger !== 'death' || !keys(p,['buff','shield','summon','returnFallen']) || !['buff','shield','summon','returnFallen'].some(k => p[k])) return fail(b);
    if (p.buff && (!keys(p.buff,['faction','stats','duration']) || !text(p.buff.faction) || !stats(p.buff.stats) || p.buff.duration !== 'battle')) return fail(b);
    if (p.shield && (!keys(p.shield,['faction','layers']) || !text(p.shield.faction) || !integer(p.shield.layers))) return fail(b);
    if (p.summon && (!keys(p.summon,['count','statRatio','tokenId']) || !integer(p.summon.count) || !positive(p.summon.statRatio) || (p.summon.tokenId !== undefined && !text(p.summon.tokenId)))) return fail(b);
    if (p.returnFallen && (!keys(p.returnFallen,['faction','count','statRatio']) || !text(p.returnFallen.faction) || !integer(p.returnFallen.count) || !positive(p.returnFallen.statRatio))) return fail(b);
  } else if (b === 'deathrattleEcho') {
    if (normalized.trigger !== 'attack' || !keys(p,['every','faction']) || !integer(p.every) || !text(p.faction)) return fail(b);
  } else if (b === 'retirementMultiplier') {
    if (normalized.trigger !== 'passive' || !keys(p,['extra']) || ![1,2].includes(p.extra)) return fail(b);
  } else if (b === 'warbandEvent') {
    if (!keys(p,['event','faction','targets','targetFaction','selfOnly','stats','shieldLayers'])
        || !['death','summon','shieldLayersBroken','attack','damaged','kill'].includes(p.event) || normalized.trigger !== (p.event === 'summon' ? 'deploy' : p.event)
        || !text(p.faction) || !['self','actor','all'].includes(p.targets) || (p.targetFaction !== undefined && !text(p.targetFaction))
        || (p.selfOnly !== undefined && typeof p.selfOnly !== 'boolean')
        || (p.stats !== undefined && !stats(p.stats)) || (p.shieldLayers !== undefined && !integer(p.shieldLayers)) || (!p.stats && !p.shieldLayers)) return fail(b);
  } else return fail(b);
  return true;
}
