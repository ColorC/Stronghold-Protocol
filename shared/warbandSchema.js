const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
const keys = (x, allowed) => object(x) && Object.keys(x).every(k => allowed.includes(k));
const text = x => typeof x === 'string' && !!x.trim() && !['__proto__','constructor','prototype'].includes(x);
const integer = x => Number.isInteger(x) && x > 0;
const positive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const stats = x => keys(x, ['attackPercent','baseAttackPercent','maxHpPercent','attackSpeedFlat','damageDealtPercent']) && Object.keys(x).length > 0 && Object.values(x).every(positive);
const fail = behavior => { throw new Error(`BAD_WARBAND_RULE:${behavior}`); };
export const WARBAND_BEHAVIORS = Object.freeze(['factionReaction','retiringEffect','deathrattleEcho','retirementMultiplier','warbandEvent']);
export function validateWarbandRule(rule) {
  const b = rule?.behavior, p = rule?.params;
  if (!keys(rule, ['trigger','behavior','params']) || !object(p)) return fail(b);
  if (b === 'factionReaction') {
    if (!keys(p, ['faction','mode','targets','excludeSelf','count','outputs','perTier','requireGainTrait','maxEventsPerPrep'])
        || !['allyGain','bought','gain','sold'].includes(rule.trigger) || !['badge','shop','refund','discount','funds'].includes(p.mode)
        || !['self','all','front','leastEquipment'].includes(p.targets) || !integer(p.count) || !integer(p.maxEventsPerPrep)
        || ['excludeSelf','perTier','requireGainTrait'].some(k => p[k] !== undefined && typeof p[k] !== 'boolean')
        || (!['discount','funds'].includes(p.mode) && !text(p.faction))
        || (p.faction !== undefined && !text(p.faction))
        || (['badge','shop'].includes(p.mode) && (!Array.isArray(p.outputs) || !p.outputs.length || !p.outputs.every(o => keys(o,['id','quantity']) && text(o.id) && integer(o.quantity))))
        || (p.outputs !== undefined && !Array.isArray(p.outputs))
        || (p.mode === 'refund' && rule.trigger !== 'bought') || (p.mode === 'discount' && rule.trigger !== 'gain') || (p.mode === 'funds' && rule.trigger !== 'sold')) return fail(b);
  } else if (b === 'retiringEffect') {
    if (rule.trigger !== 'death' || !keys(p,['perBattle','buff','shield','summon','returnFallen']) || !integer(p.perBattle) || !['buff','shield','summon','returnFallen'].some(k => p[k])) return fail(b);
    if (p.buff && (!keys(p.buff,['faction','stats','duration']) || !text(p.buff.faction) || !stats(p.buff.stats) || p.buff.duration !== 'battle')) return fail(b);
    if (p.shield && (!keys(p.shield,['faction','layers']) || !text(p.shield.faction) || !integer(p.shield.layers))) return fail(b);
    if (p.summon && (!keys(p.summon,['count','statRatio','durationSeconds','tokenId']) || !integer(p.summon.count) || !positive(p.summon.statRatio) || !positive(p.summon.durationSeconds) || (p.summon.tokenId !== undefined && !text(p.summon.tokenId)))) return fail(b);
    if (p.returnFallen && (!keys(p.returnFallen,['faction','count','duration','statRatio']) || !text(p.returnFallen.faction) || !integer(p.returnFallen.count) || !positive(p.returnFallen.duration) || !positive(p.returnFallen.statRatio))) return fail(b);
  } else if (b === 'deathrattleEcho') {
    if (rule.trigger !== 'attack' || !keys(p,['every','faction','perBattle']) || !integer(p.every) || !text(p.faction) || !integer(p.perBattle)) return fail(b);
  } else if (b === 'retirementMultiplier') {
    if (rule.trigger !== 'passive' || !keys(p,['extra']) || ![1,2].includes(p.extra)) return fail(b);
  } else if (b === 'warbandEvent') {
    if (!keys(p,['event','faction','targets','targetFaction','stats','shieldLayers','cooldownSeconds','maxStacks'])
        || !['death','summon','shieldLayersBroken','attack','damaged','kill'].includes(p.event) || rule.trigger !== (p.event === 'summon' ? 'deploy' : p.event)
        || !text(p.faction) || !['self','actor','all'].includes(p.targets) || (p.targetFaction !== undefined && !text(p.targetFaction))
        || !integer(p.maxStacks) || !positive(p.cooldownSeconds) || p.cooldownSeconds < 1
        || (p.stats !== undefined && !stats(p.stats)) || (p.shieldLayers !== undefined && !integer(p.shieldLayers)) || (!p.stats && !p.shieldLayers)) return fail(b);
  } else return fail(b);
  return true;
}
