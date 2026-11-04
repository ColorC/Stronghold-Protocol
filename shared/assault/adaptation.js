// Contract of docs/assault-mode/bazaar-adaptation.md. Used by the compiler,
// battle and quota checks; no second set of costs or lifecycle defaults.
export const ADAPTATION_VERSION = 'bazaar-adaptation/v1';
export const SP_TIERS = Object.freeze({
  fast: Object.freeze({ min: 8, max: 12 }),
  medium: Object.freeze({ min: 16, max: 24 }),
  slow: Object.freeze({ min: 30, max: 40 }),
});
export const SKILL_ADAPTATION_TYPES = Object.freeze(['A', 'B', 'C', 'D', 'E']);
export const SOURCE_DEDUP_SECONDS = 0.1;

// A family can expose several event types, e.g. an accumulation and a burst.
// The same family list drives authoring validation and coverage quotas.
export const EVENT_FAMILIES = Object.freeze({
  skill: Object.freeze(['skillStart', 'skillResolved']),
  cold: Object.freeze(['statusApplied:cold', 'statusApplied:freeze']),
  control: Object.freeze(['statusApplied:stun', 'statusApplied:tremble', 'statusApplied:bind', 'statusApplied:sleep']),
  displacement: Object.freeze(['statusApplied:push', 'statusApplied:pull', 'statusApplied:levitate', 'statusApplied:weightless']),
  element: Object.freeze(['elementDamage', 'elementalDamage', 'elementBurst']),
  sustain: Object.freeze(['heal', 'shieldGained', 'shieldBroken', 'hpRegen']),
  deployment: Object.freeze(['deployed', 'redeploy']),
  ammunition: Object.freeze(['ammoUsed', 'reloaded']),
  summon: Object.freeze(['summonEntered', 'summonDestroyed', 'summonReturned', 'deviceTrigger']),
  block: Object.freeze(['blocked']),
  kill: Object.freeze(['kill']),
  economy: Object.freeze(['dpReceived', 'dpGranted', 'dpSpent']),
});
export const RUN_GROWTH_EVENTS = Object.freeze(['buy', 'sell', 'upgrade', 'battleEnd', 'dayStarted', 'nodeEntered']);

export function eventFamily(type, payload) {
  const status = payload?.status === 'frozen' ? 'freeze' : payload?.status;
  const name = type === 'statusApplied' ? `${type}:${status}` : type;
  return Object.keys(EVENT_FAMILIES).find(key => EVENT_FAMILIES[key].includes(name)) ?? null;
}

export function skillTempo(tier, cost) {
  const range = SP_TIERS[tier];
  if (!range || !Number.isFinite(cost) || cost < range.min || cost > range.max)
    throw new TypeError(`adaptation skill tempo ${tier}/${cost} is outside its declared band`);
  return { tier, cost, spCosts: [cost, cost, cost, cost] };
}

// B-type conversion is authored with a role weight; all other operands are
// recorded native values. It never changes the original range or target cap.
export function compressedAttackScale({ duration, attackInterval, attackScale = 1, hits = 1, nativeCost, assaultCost, roleWeight }) {
  if (![duration, attackInterval, attackScale, hits, nativeCost, assaultCost].every(n => Number.isFinite(n) && n > 0)
    || !Number.isFinite(roleWeight) || roleWeight < .6 || roleWeight > 1) throw new TypeError('invalid native burst conversion');
  return duration / attackInterval * attackScale * hits * assaultCost / nativeCost * roleWeight;
}

export function validateAdaptation(plan) {
  if (!plan || plan.version !== ADAPTATION_VERSION || !SKILL_ADAPTATION_TYPES.includes(plan.type))
    throw new TypeError('adaptation requires a versioned A/B/C/D/E skill plan');
  const nativePassive = plan.passive === true && plan.sourceSkillId == null && typeof plan.sourceTraitId === 'string' && plan.sourceTraitId.length > 0;
  if (!nativePassive && (typeof plan.sourceSkillId !== 'string' || !plan.sourceSkillId))
    throw new TypeError('adaptation requires its exact original skill');
  if (plan.passive !== true) skillTempo(plan.tempo?.tier, plan.tempo?.cost);
  if (!Array.isArray(plan.rangeGrid) || plan.rangeGrid.some(cell => !Array.isArray(cell) || cell.length !== 2 || cell.some(n => !Number.isInteger(n))))
    throw new TypeError('adaptation requires the original skill range grid');
  if (!Number.isInteger(plan.targetCount) || plan.targetCount < 1)
    throw new TypeError('adaptation requires its original target count');
  if (plan.type === 'D' && (!Number.isInteger(plan.ammo) || plan.ammo < 1))
    throw new TypeError('ammunition is the number of casts in this battle');
  return plan;
}
