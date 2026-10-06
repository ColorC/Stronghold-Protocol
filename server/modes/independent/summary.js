// Icon summary of an operator's own trait (自有特质) for shop cards and unit plates: when it fires, what it gives and
// the conditions worth a glance. It is an index into the full text the detail card shows, never a replacement: every
// rule of the structured catalog effect (catalog.js nativeTrait.effect) yields one entry, unknown behaviors included.

/** Trigger → the player-facing moment. */
export const TRAIT_WHEN = Object.freeze({
  gain: '获得时', roundStart: '休整开始', prepEnd: '休整结束', sold: '出售时', refresh: '刷新后', merge: '三连',
  passive: '常驻', battleStart: '战斗开始', deploy: '部署时', kill: '击杀', hit: '命中', skillStart: '技能开启',
  death: '倒下', statusApplied: '施加状态', ammoUsed: '消耗弹药', nativeProduction: '产出时', dollSwap: '替身切换',
  aura: '在场时', selling: '出售时', battleProduction: '战斗产出',
});

const FORGE_SINGLE = new Set(['grantEquipmentByTier', 'forgePerGainedChess', 'forgeAdjacent', 'forgeFactionTierCount', 'forgeRowCount',
  'forgeDominantFactionTierCount', 'forgeBenchPairs', 'forgeBenchCount', 'forgePerFundsSpent']);
const RECRUIT = new Set(['recruitOffer', 'conditionalRecruit', 'randomChessOffer', 'dominantFactionRecruit']);

const counts = (p) => ({ normal: Number(p.normal ?? p.quantity ?? 1), elite: Number(p.elite ?? p.normal ?? p.quantity ?? 1) });
const caps = (p) => (p.capNormal != null ? { normal: Number(p.capNormal), elite: Number(p.capElite ?? p.capNormal) } : undefined);

/**
 * One summary entry per rule: { when, kind, items?, amount?, cap?, perBattle?, bench?, faction?, condition?, stats? }.
 * The normal and the elite form are separate catalog entries, and some rules keep the elite numbers only in the
 * elite entry (eventProduction): read a form's count from its own entry — normal entry `.normal`, elite entry `.elite`.
 * kind ∈ forge | funds | refresh | recruit | shopBadge | random | stat | damage | copy | merge | other.
 * `items` = [{ id, normal, elite }] (id null = decided in play, e.g. the dominant faction's recipe).
 */
export function traitSummary(effect) {
  const rules = [...(effect?.prep || []), ...(effect?.combat || [])];
  return rules.map((rule) => {
    const p = rule.params || {};
    const entry = { when: rule.trigger, kind: 'other' };
    const b = rule.behavior;
    if (b === 'grantEquipment' || b === 'conditionalGrant') {
      entry.kind = 'forge'; entry.items = (p.outputs || []).map((o) => ({ id: o.id, normal: Number(o.normal ?? 1), elite: Number(o.elite ?? o.normal ?? 1) }));
      if (p.alsoAt) entry.alsoAt = p.alsoAt;
    } else if (b === 'eventProduction') {
      // copyOutputFromEvent (魔王): the item is whatever the copied production made
      entry.kind = p.copyOutputFromEvent ? 'copy' : 'forge';
      entry.items = (p.outputs || []).map((o) => ({ id: o.idFromEvent ? null : (o.id ?? null), normal: Number(o.quantity ?? o.normal ?? 1), elite: Number(o.eliteQuantity ?? o.elite ?? o.quantity ?? 1) }));
      if (p.counterEvery > 1) entry.every = Number(p.counterEvery);
      if (p.maxPerBattle) entry.perBattle = Number(p.maxPerBattle);
      entry.afterBattle = true;
    } else if (FORGE_SINGLE.has(b)) {
      entry.kind = 'forge'; entry.items = [{ id: p.id ?? null, ...counts(p) }];
      if (b === 'grantEquipmentByTier') entry.items = [{ id: p.id, normal: null, elite: null }];
      entry.cap = caps(p);
    } else if (b === 'forgeFactionTierPair') {
      entry.kind = 'forge'; entry.items = (p.ids || []).map((id) => ({ id, ...counts(p) })); entry.cap = caps(p);
    } else if (b === 'forgeDominantFaction') {
      entry.kind = 'forge'; entry.items = [{ id: null, ...counts(p) }];
    } else if (b === 'deferredFunds' || b === 'deferredFundsIf') {
      entry.kind = 'funds'; entry.amount = counts(p);
    } else if (b === 'freeRefresh' || b === 'freeRefreshOnce') {
      entry.kind = 'refresh'; entry.amount = counts(p);
    } else if (RECRUIT.has(b)) {
      entry.kind = 'recruit';
    } else if (b === 'attachShopBadgeFirstRefresh' || b === 'attachShopByRefreshCount') {
      entry.kind = 'shopBadge'; entry.items = [{ id: p.id, ...counts(p) }]; entry.cap = caps(p);
    } else if (b === 'randomEquipment' || b === 'randomUnlockedEquipment' || b === 'randomSupply') {
      entry.kind = 'random'; entry.amount = counts(p);
    } else if (b === 'staticStats' || b === 'badgeThresholdStat' || b === 'startDerivedStats' || b === 'deployWindowStats') {
      entry.kind = 'stat';
      if (p.badgeIds?.length && p.badgeIds.length < 4) entry.items = p.badgeIds.map((id) => ({ id }));
      if (p.every) entry.every = Number(p.every);
    } else if (b === 'conditionalDamage' || b === 'weakDamage') {
      entry.kind = 'damage';
    } else if (b === 'triggerMultiplier' || b === 'productionMultiplier') {
      // a doubler: which moment runs how many times (productionMultiplier: the battle's yield)
      entry.kind = 'double'; entry.hook = b === 'productionMultiplier' ? 'battleProduction' : p.hook;
      const extra = p.extra && typeof p.extra === 'object' ? p.extra : { normal: p.extra, elite: p.extra };
      entry.amount = { normal: 1 + Number(extra.normal ?? 1), elite: 1 + Number(extra.elite ?? extra.normal ?? 1) };
    } else if (b === 'badgeAmplifier') {
      entry.kind = 'stat'; entry.items = (p.badgeIds || []).map((id) => ({ id })); entry.times = Number(p.multiplier);
    } else if (b === 'grantByTotal') {
      entry.kind = 'forge'; entry.items = (p.outputs || []).map((o) => ({ id: o.id, normal: Number(o.normal ?? 1), elite: Number(o.elite ?? o.normal ?? 1) }));
      entry.total = { counter: p.counter, per: Number(p.per) };
    } else if (b === 'shopCarry') {
      entry.kind = 'shopBadge'; entry.items = [{ id: p.id, ...counts(p) }]; entry.lasting = true;
    } else if (b === 'badgeBoost') {
      entry.kind = 'boost'; entry.items = (p.badgeIds || []).map((id) => ({ id }));
      entry.amount = { normal: Number(p.percent?.normal ?? p.percent), elite: Number(p.percent?.elite ?? p.percent?.normal ?? p.percent) };
    } else if (b === 'sellTransfer') {
      entry.kind = 'transfer';
    } else if (b === 'devourShop') {
      entry.kind = 'devour'; entry.items = [{ id: p.id, ...counts(p) }];
    } else if (b === 'doubleWorn') {
      entry.kind = 'doubleWorn';
    } else if (b === 'escalatingGrant' || b === 'comebackGrant' || b === 'streakGrant' || b === 'diversityGrant') {
      const n = b === 'escalatingGrant' ? p.start : b === 'comebackGrant' ? p.perLp : b === 'streakGrant' ? p.base : { normal: p.normal, elite: p.elite };
      entry.kind = 'forge'; entry.items = [{ id: p.id, normal: Number(n?.normal ?? n), elite: Number(n?.elite ?? n?.normal ?? n) }];
      entry.condition = { escalatingGrant: 'escalate', comebackGrant: 'comeback', streakGrant: 'streak', diversityGrant: p.by === 'faction' ? 'factions' : 'professions' }[b];
    } else if (b === 'replayAdjacentNative') {
      entry.kind = 'copy';
    } else if (b === 'twoCopyElite') {
      entry.kind = 'merge';
    }
    if (p.requiresFactionOnField) entry.faction = p.requiresFactionOnField;
    else if (p.faction) entry.faction = p.faction;
    if (p.worksFromBench) entry.bench = true;
    if (p.growth) entry.grows = true;
    if (p.totalBonus) entry.total = { counter: p.totalBonus.counter, per: Number(p.totalBonus.per) };
    if (typeof p.condition === 'string' && !p.condition.includes('Tag')) entry.condition = p.condition;
    for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
    return entry;
  });
}
