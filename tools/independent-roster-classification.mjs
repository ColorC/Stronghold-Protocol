/**
 * Classify an active card by its authored executable source-effect delivery.
 * The label is only a table grouping; it does not rewrite or simplify effects.
 */
const KIND_GROUP = new Map([
  ['badgeGrowth', '成长'],
  ['badgeGrowthAndGear', '成长'],
  ['shopGrowth', '成长'],
  ['gold', '经济'],
  ['freeRefresh', '经济'],
  ['upgradeDiscount', '经济'],
  ['shopOffer', '生成'],
  ['recruitOffer', '生成'],
  ['supportRecruitOffer', '生成'],
  ['supportSummon', '生成'],
  ['transform', '生成'],
  ['magneticAttachment', '交接'],
  ['triggerMultiplier', '辅助'],
  ['sourceSpecificCombat', '战斗'],
  ['keywordGear', '战斗'],
]);

export function classifyRosterKind(operator) {
  const effects = operator.effectDelivery?.normal || [];
  const groups = effects.map((effect) => KIND_GROUP.get(effect.kind)).filter(Boolean);
  // Permanent roster growth is the card's main engine when it accompanies a
  // starting gear grant. A combat summon/copy that also enters the hand is a
  // generation engine; a combat-only summon remains a battle effect.
  if (groups.includes('成长')) return '成长';
  if (groups.includes('交接')) return '交接';
  if (groups.includes('经济')) return '经济';
  if (groups.includes('辅助')) return '辅助';
  if (groups.includes('生成')) return '生成';
  if (effects.some((effect) => effect.kind === 'sourceSpecificCombat' &&
      (/召唤|加入整备区|加入手牌|加入酒馆|加入商店|发现|招募/.test(effect.text || '') ||
       /hand|shop|Offer/i.test(String(effect.recipient || ''))))) return '生成';
  if (groups.includes('战斗')) return '战斗';
  throw new Error(`UNCLASSIFIED_ACTIVE_OPERATOR:${operator.name}:${operator.chessId}`);
}
