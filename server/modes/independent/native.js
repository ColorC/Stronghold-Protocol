// Independent mode uses authored, structured native effects. The original game text is metadata only.
const BADGE = Object.freeze({ precision: 'precision', agility: 'agility', vitality: 'vitality', defense: 'defense', assault: 'assault', recovery: 'recovery' });
const rule = (trigger, behavior, params) => ({ trigger, behavior, params });

// Ordinary/elite quantities are intentionally explicit. This registry is keyed by operator name from
// the approved design input; no description or bb string is interpreted at runtime.
const PREP = Object.freeze({
  角峰: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.vitality, normal: 1, elite: 2 }] })],
  惊蛰: [rule('gain', 'grantEquipmentByTier', { id: BADGE.precision, normalDivisor: 2, eliteDivisor: 1, rounding: 'ceil' })],
  刺玫: [rule('prepEnd', 'conditionalGrant', { outputs: [{ id: BADGE.vitality, normal: 1, elite: 2 }], requiresFactionOnField: '维多利亚' })],
  普罗旺斯: [rule('gain', 'freeRefresh', { normal: 1, elite: 2 })],
  德克萨斯: [rule('sold', 'freeRefresh', { normal: 1, elite: 2 })],
  艾丝黛尔: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.precision, normal: 1, elite: 2 }] })],
  波登可: [rule('prepEnd', 'forgeDominantFaction', { normal: 1, elite: 2, fallback: 'professionRecipe' })],
  格雷伊: [rule('sold', 'deferredFunds', { normal: 1, elite: 2 })],
  深靛: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.assault, normal: 1, elite: 2 }] })],
  野鬃: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.agility, normal: 1, elite: 2 }] })],
  雷蛇: [rule('prepEnd', 'grantEquipment', { outputs: [{ id: BADGE.defense, normal: 1, elite: 2 }] })],
  赫默: [rule('roundStart', 'grantEquipment', { outputs: [{ id: BADGE.vitality, normal: 1, elite: 2 }] })],
  小满: [rule('prepEnd', 'forgePerGainedChess', { id: BADGE.precision, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  洛洛: [rule('gain', 'randomEquipment', { poolId: 'pool_equip_rockr', normal: 1, elite: 2 })],
  蒂比: [rule('roundStart', 'grantEquipment', { outputs: [{ id: BADGE.agility, normal: 1, elite: 2 }] })],
  调香师: [rule('prepEnd', 'forgeDominantFaction', { normal: 2, elite: 4, fallback: 'professionRecipe' })],
  拉普兰德: [rule('refresh', 'attachShopBadgeFirstRefresh', { id: BADGE.assault, normal: 1, elite: 2, firstOnly: true })],
  折桠: [rule('prepEnd', 'grantEquipment', { outputs: [{ id: BADGE.defense, normal: 2, elite: 4 }] })],
  灰毫: [rule('gain', 'forgeDominantFaction', { normal: 1, elite: 2 })],
  能天使: [rule('gain', 'deferredFunds', { normal: 1, elite: 2 })],
  断崖: [rule('prepEnd', 'forgeAdjacent', { id: BADGE.recovery, normal: 1, elite: 2, direction: 'behind', targets: ['self', 'ally'], capNormal: 2, capElite: 4 })],
  诗怀雅: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_1_03_e_a', normal: 1, elite: 2 }] })],
  琳琅诗怀雅: [rule('prepEnd', 'deferredFundsIf', { normal: 1, elite: 2, requiresFactionOnField: '炎' })],
  薄绿: [rule('prepEnd', 'forgeFactionTierCount', { faction: '维多利亚', id: BADGE.precision, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  松果: [rule('sold', 'recruitOffer', { normalTier: 1, eliteTier: 5 })],
  雪猎: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.agility, normal: 2, elite: 4 }] })],
  至简: [rule('buy', 'freeRefreshOnce', { normal: 2, elite: 2, paidOnly: true, expires: 'prepEnd' })],
  蛇屠箱: [rule('prepEnd', 'forgeRowCount', { id: BADGE.defense, normal: 1, elite: 2, capNormal: 4, capElite: 8 })],
  忍冬: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.precision, normal: 2, elite: 4 }, { id: BADGE.agility, normal: 1, elite: 2 }] })],
  耶拉: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_3_02_e_a', normal: 1, elite: 2 }] })],
  空弦: [rule('roundStart', 'forgeAdjacent', { id: BADGE.agility, normal: 1, elite: 2, direction: 'front', targets: ['self', 'ally'], capNormal: 2, capElite: 4 })],
  伊内丝: [rule('prepEnd', 'grantEquipment', { outputs: [{ id: BADGE.precision, normal: 2, elite: 4 }] })],
  阿罗玛: [rule('prepEnd', 'attachShopByRefreshCount', { id: BADGE.assault, normal: 1, elite: 2, capNormal: 3, capElite: 6 })],
  凯瑟琳: [rule('roundStart', 'randomUnlockedEquipment', { normal: 1, elite: 2, oddRoundsOnly: true })],
  歌蕾蒂娅: [rule('roundStart', 'conditionalRecruit', { condition: 'sameRowCount>=3', choices: ['chess_char_5_04_a', 'chess_char_2_07_a', 'chess_char_1_04_a'], normal: 1, elite: 2 })],
  灵知: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.assault, normal: 2, elite: 4 }] })],
  莱恩哈特: [rule('prepEnd', 'grantEquipment', { outputs: [{ id: BADGE.precision, normal: 2, elite: 4 }] })],
  缄默德克萨斯: [rule('roundStart', 'freeRefresh', { normal: 1, elite: 2 })],
  星熊: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.defense, normal: 3, elite: 6 }] })],
  泥岩: [rule('sold', 'deferredFunds', { normal: 2, elite: 4 })],
  焰尾: [rule('gain', 'randomChessOffer', { normal: 1, elite: 2, poolId: 'pool_char_pinus' })],
  白面鸮: [rule('roundStart', 'replayAdjacentNative', { sourceTrigger: 'gain', allow: ['grantEquipment', 'grantEquipmentByTier', 'forgeDominantFaction', 'randomEquipment'], neverReenter: true })],
  卡涅利安: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_4_02_e_a', normal: 1, elite: 2 }] })],
  烛煌: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.precision, normal: 2, elite: 4 }, { id: BADGE.vitality, normal: 2, elite: 4 }] })],
  号角: [rule('prepEnd', 'forgeDominantFactionTierCount', { id: BADGE.defense, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  铃兰: [rule('roundStart', 'replayAdjacentNative', { sourceTrigger: 'gain', allow: ['grantEquipment', 'grantEquipmentByTier', 'randomEquipment'], neverReenter: true, normalRange: 1, eliteRange: 2 })],
  塞雷娅: [rule('prepEnd', 'replayAdjacentNative', { sourceTrigger: 'prepEnd', allow: ['grantEquipment', 'forgePerGainedChess', 'forgeDominantFaction', 'forgeAdjacent', 'forgeRowCount'], neverReenter: true })],
  夕: [rule('prepEnd', 'forgePerGainedChess', { id: BADGE.assault, normal: 1, elite: 2, capNormal: 8, capElite: 16 })],
  引星棘刺: [rule('prepEnd', 'forgeAdjacent', { id: BADGE.precision, normal: 2, elite: 4, direction: 'front', targets: ['self', 'ally'], capNormal: 4, capElite: 8 })],
  山: [rule('prepEnd', 'forgePerGainedChess', { id: BADGE.vitality, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  安洁莉娜: [rule('prepEnd', 'attachShopByRefreshCount', { id: BADGE.assault, normal: 2, elite: 4, capNormal: 6, capElite: 12 })],
  寒檀: [rule('roundStart', 'grantEquipment', { outputs: [{ id: BADGE.recovery, normal: 2, elite: 4 }], alsoAt: 'prepEnd' })],
  妮芙: [rule('prepEnd', 'forgeBenchPairs', { id: BADGE.agility, normal: 1, elite: 2, pairSize: 2, capNormal: 4, capElite: 8 })],
  录武官: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.precision, normal: 3, elite: 6 }, { id: BADGE.vitality, normal: 1, elite: 2 }] })],
  余: [rule('roundStart', 'dominantFactionRecruit', { normalRequires: 'sameRowCount>=3', eliteRequires: null })],
  佩佩: [rule('roundStart', 'randomSupply', { normal: 1, elite: 2, poolId: 'pool_equip_pepe' })],
  维娜·维多利亚: [rule('prepEnd', 'forgeFactionTierPair', { faction: '维多利亚', ids: [BADGE.precision, BADGE.vitality], normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  缪尔赛思: [rule('gain', 'grantEquipment', { outputs: [{ id: 'chess_item_identity_gear', normal: 1, elite: 2 }] })],
  新约能天使: [rule('gain', 'deferredFunds', { normal: 2, elite: 4 })],
  流明: [rule('prepEnd', 'forgeBenchCount', { id: BADGE.vitality, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  溯光星源: [rule('prepEnd', 'forgePerFundsSpent', { id: BADGE.recovery, spendPer: 3, normal: 1, elite: 2, capNormal: 6, capElite: 12 })],
  锏: [rule('gain', 'grantEquipment', { outputs: [{ id: BADGE.agility, normal: 3, elite: 6 }] })],
  风丸: [rule('merge', 'twoCopyElite', { copiesRequired: 2, retainsNativeTrait: true })],
});

const combatBadge = (ids, every, stats, extra = {}) => rule('passive', 'badgeThresholdStat', { badgeIds: ids, every, stats, ...extra });
const combatStatic = (stats) => rule('passive', 'staticStats', { stats });
const combatEvent = (trigger, id, quantity, cap, filter = { actor: 'self' }, every = 1, extra = {}) => rule(trigger, 'eventProduction', {
  counterEvent: trigger, counterEvery: every, outputs: [{ id, quantity }], maxPerBattle: cap, filter, ...extra,
});
function combatRules(name, elite) {
  const q = (n, e) => elite ? e : n;
  const flat = (...r) => r;
  const badgeScale = (ids, every, stats) => combatBadge(ids, every, Object.fromEntries(Object.entries(stats).map(([k, [n, e]]) => [k, q(n, e)])));
  const staticScale = (stats) => combatStatic(Object.fromEntries(Object.entries(stats).map(([k, [n, e]]) => [k, q(n, e)])));
  const eventScale = (trigger, id, normalQ, eliteQ, normalCap, eliteCap, filter, every = 1, extra = {}) => combatEvent(trigger, id, q(normalQ, eliteQ), q(normalCap, eliteCap), filter, every, extra);
  switch (name) {
    case '隐现': case '焰影苇草': return [badgeScale(['agility'],5,{attackSpeedFlat:[1,2]})];
    case '哈洛德': case '迷迭香': return [staticScale({attackPercent:[0.2,0.4],maxHpPercent:[0.2,0.4]}),badgeScale(['precision','agility','vitality','defense','assault','recovery','arcane','foresight','miracle','investor','unyielding','harmony','coordination','solitary','mastery'],5,{attackPercent:[0.01,0.02],maxHpPercent:[0.01,0.02]})];
    case '泡泡': case '信仰搅拌机': return [badgeScale(['vitality','defense'],5,{defensePercent:[0.02,0.04]})];
    case '水月': return [badgeScale(['precision','assault'],5,{attackPercent:[0.01,0.02]})];
    case '乌尔比安': return [badgeScale(['precision','assault'],4,{attackPercent:[0.01,0.02]})];
    case '隐德来希': return [badgeScale(Object.values(BADGE),5,{attackPercent:[0.01,0.02],maxHpPercent:[0.01,0.02]})];
    case '圣聆初雪': return [badgeScale(['precision','assault','recovery'],5,{attackPercent:[0.01,0.02]})];
    case '浊心斯卡蒂': return [badgeScale(Object.values(BADGE),10,{hpRecoveryPerSecond:[50,100],spRecoveryPerSecond:[0.15,0.3]})];
    case '异客': return [badgeScale(['precision','assault','agility'],5,{attackPercent:[0.02,0.04]})];
    case '深巡': return [rule('attack','conditionalDamage',{targetTag:'seaMonster',multiplier:q(1.5,2),condition:'targetHasTag'})];
    case '跃跃': return [rule('attack','conditionalDamage',{targetTag:'drone',multiplier:q(1.5,2),condition:'targetHasTag'})];
    case '仇白': return [rule('attack','conditionalDamage',{targetTag:null,multiplier:1,condition:'boundOrSluggish',badgeIds:['precision','assault'],every:5,bonusPercent:q(0.01,0.02)})];
    case '宴': case '流星': return [rule('attack','weakDamage',{enabled:true})];
    case '古米': return [staticScale({spRecoveryPerSecond:[0.15,0.3]})];
    case '锡人': return [staticScale({attackPercent:[0.2,0.4],maxHpPercent:[0.2,0.4]}),rule('passive','staticStats',{factions:['炎','萨尔贡','维多利亚','谢拉格','拉特兰','阿戈尔','叙拉古','卡西米尔'],excludeNativeInheritance:true})];
    case '送葬人': return [eventScale('kill','agility',1,2,1,1,{actor:'self',targetSide:'enemy'},1,{firstOnly:true})];
    case '莎草': return [eventScale('skillStart','recovery',1,2,1,1,{actor:'self'},1,{firstOnly:true})];
    case '幽灵鲨': return [eventScale('death','vitality',1,2,1,1,{actor:'self'},1,{firstOnly:true})];
    case '休谟斯': return [eventScale('kill','precision',1,2,4,8,{actor:'self',targetSide:'enemy'},2)];
    case '砾': return [eventScale('deploy','defense',1,2,3,6,{actor:'self'}),eventScale('death','vitality',1,2,1,1,{actor:'self'},1,{firstOnly:true})];
    case '斯卡蒂': return [eventScale('kill','vitality',1,2,4,8,{actor:'self',targetSide:'enemy'},2)];
    case '菲莱': return [eventScale('skillStart','recovery',1,2,3,6,{actor:'self'})];
    case '海霓': return [eventScale('kill','assault',1,2,1,1,{actor:'self',targetSide:'any'},1,{firstOnly:true})];
    case '瑕光': return [eventScale('deploy','vitality',1,2,3,6,{actor:'self'})];
    case '初雪': case '银灰': return [eventScale('statusApplied','assault',1,2,4,8,{actor:'self',targetSide:'enemy',status:'frozen',entered:true,range:'attacker'},1,{probability:0.5})];
    case '伺夜': return [eventScale('kill','assault',1,2,3,6,{actor:'self',targetSide:'enemy'},1,{firstN:3})];
    case '莫斯提马': return [eventScale('ammoUsed','recovery',1,2,6,12,{actor:'adjacentAllies',ammoOnly:true},6)];
    case '寒芒克洛丝': return [eventScale('skillStart','precision',1,2,4,8,{actor:'adjacentAllies',excludeSelf:true,direction:'front'})];
    case '风笛': return [eventScale('kill','agility',1,2,3,6,{actor:'self',targetSide:'enemy'},1,{firstN:3})];
    case '史尔特尔': return [eventScale('deploy','precision',2,4,6,12,{actor:'self'})];
    case '远牙': return [eventScale('deploy','agility',1,2,6,12,{actor:'sameRowRightmost'})];
    case '百炼嘉维尔': return [eventScale('skillStart','vitality',2,4,6,12,{actor:'self'})];
    case '华法琳': return [eventScale('skillStart','vitality',1,2,4,8,{actor:'adjacentAllies',direction:'front'})];
    case '圣约送葬人': return [rule('ammoUsed','eventProduction',{counterEvent:'ammoUsed',counterEvery:7,outputs:[{id:'agility',quantity:q(1,2)},{id:'recovery',quantity:q(1,2)}],maxPerBattle:q(7,14),filter:{actor:'self',ammoOnly:true},capPerOutput:q(7,14)})];
    case '缇缇': return [eventScale('statusApplied','recovery',1,2,6,12,{actor:'self',targetSide:'any',status:['sleep','stun'],entered:true,range:'attacker'})];
    case '归溟幽灵鲨': return [eventScale('death','vitality',1,2,4,8,{actor:'self'},1,{firstOnly:true})];
    case '凛御银灰': return [eventScale('statusApplied','assault',1,2,6,12,{actor:'adjacentAllies',direction:'front',tag:'谢拉格',targetSide:'enemy',status:'frozen',entered:true,range:'attacker'},1,{probability:0.6})];
    case '魔王': return [rule('nativeProduction','eventProduction',{counterEvent:'nativeProduction',counterEvery:1,outputs:[],copyOutputFromEvent:true,quantity:q(1,2),maxPerBattle:q(4,8),filter:{actor:'adjacentAllies',direction:'front',nativeTraitProduction:true,baseBadgeOnly:true,excludeCopy:true},requiresPlayerChoice:true})];
    case '蕾缪安': return [eventScale('ammoUsed','precision',2,4,8,16,{actor:'self',ammoOnly:true,sameRowCount:3},10)];
    case '塑心': return [eventScale('skillStart','agility',1,2,6,12,{actor:'sameRowAllies',includeSelf:true})];
    case '荒芜拉普兰德': return [eventScale('kill','assault',1,1,6,12,{actor:elite?'team':'self',targetSide:'enemy',tag:elite?'叙拉古':undefined},1,{perEnemyOnce:elite})];
    case '纯烬艾雅法拉': return [eventScale('skillStart','vitality',1,2,4,8,{actor:'self'})];
    case '锏': return [eventScale('deploy','agility',2,4,6,12,{actor:'self'})];
    case '玛恩纳': return [rule('deploy','deployWindowStats',{badgeIds:Object.values(BADGE),every:5,stats:{attackFlat:q(10,20),maxHpFlat:q(50,100)},durationSeconds:100})];
    case '耀骑士临光': return [rule('battleStart','startDerivedStats',{badgeIds:['agility'],every:5,actors:['self','frontAlly'],attackSpeedFlat:q(1,2),redeployTimeReduction:elite?0.03:0.015,maxRedeployTimeReduction:0.3})];
    default: return [];
  }
}

export function nativeEffectFor(_chessId, source, isElite = false) {
  const rules = PREP[source?.name] || [];
  const prep = rules.map((r) => ({ trigger: r.trigger, behavior: r.behavior, params: structuredClone(r.params) }));
  for (const r of prep) {
    for (const key of ['normal', 'elite']) if (Object.hasOwn(r.params, key)) {
      r.params.quantity = r.params[isElite ? 'elite' : 'normal'];
      break;
    }
  }
  return { prep, combat: combatRules(source?.name, isElite), unsupported: [] };
}

export function nativeTraitFor(chessId, catalog) {
  const op = catalog?.operators?.[chessId];
  return op?.nativeTrait || null;
}

function suppressed(event) {
  return event?.origin === 'native' || event?.origin === 'equipment' || event?.origin === 'attachment' || event?.replay === true;
}
function countBy(items, field) {
  const result = new Map();
  for (const item of items || []) result.set(item?.[field], (result.get(item?.[field]) || 0) + (item?.quantity || 1));
  return result;
}
function roster(state) { return [...(state?.pieces || [])]; }
function chessIdOf(piece) { return piece?.chessId || piece?.id; }
function isPresent(piece) { return piece && piece.row != null && piece.col != null; }
function output(services, state, id, quantity, piece, extra = {}) {
  const n = Math.max(0, Math.floor(Number(quantity) || 0));
  if (!n || !id) return;
  services.grantEquipment(state, id, n, { origin: 'native', sourceUid: piece?.uid, ...extra });
}
function value(p, isElite) { return Number(p[isElite ? 'elite' : 'normal'] ?? 0); }
function traitFor(piece, services) { return nativeTraitFor(chessIdOf(piece), services.catalog); }
function fire(state, hook, piece, event, services, replay = false, selectedRule = null) {
  const trait = traitFor(piece, services);
  const effect = trait?.effect?.prep || [];
  for (const r of effect) {
    if (selectedRule && r !== selectedRule) continue;
    if (r.trigger !== hook || (replay && r.behavior === 'replayAdjacentNative')) continue;
    const p = r.params || {}, elite = Boolean(piece.elite || /_b$/.test(chessIdOf(piece)));
    const memo = (piece.nativeState ||= {});
    const ruleKey = `${hook}:${r.behavior}:${JSON.stringify(p)}`;
    const mark = () => (memo[ruleKey] ||= {});
    if (['roundStart', 'prepEnd'].includes(hook) && mark().lastRound === state.round) continue;
    if (['roundStart', 'prepEnd'].includes(hook)) mark().lastRound = state.round;
    switch (r.behavior) {
      case 'grantEquipment':
        for (const x of p.outputs || []) output(services, state, x.id, value(x, elite), piece);
        break;
      case 'twoCopyElite':
        if (hook === 'merge' && (event.copiesConsumed || 2) >= p.copiesRequired) event.mergeRequirement = p.copiesRequired;
        break;
      case 'grantEquipmentByTier':
        output(services, state, p.id, Math.ceil((state.shop?.level || 1) / (elite ? p.eliteDivisor : p.normalDivisor)), piece);
        break;
      case 'conditionalGrant':
        if (roster(state).some((x) => isPresent(x) && hasFaction(x, p.requiresFactionOnField, services))) for (const x of p.outputs || []) output(services, state, x.id, value(x, elite), piece);
        break;
      case 'freeRefresh':
        state.shop.freeRefreshes = (state.shop.freeRefreshes || 0) + value(p, elite); break;
      case 'freeRefreshOnce':
        if (!p.paidOnly || event.paid === true) {
          piece.nativeState ||= {}; if (!piece.nativeState.freeRefreshGranted) { piece.nativeState.freeRefreshGranted = true; state.shop.freeRefreshes = (state.shop.freeRefreshes || 0) + value(p, elite); }
        }
        break;
      case 'deferredFunds': state.pendingFunds = (state.pendingFunds || 0) + value(p, elite); break;
      case 'deferredFundsIf':
        if (roster(state).some((x) => isPresent(x) && hasFaction(x, p.requiresFactionOnField, services))) state.pendingFunds = (state.pendingFunds || 0) + value(p, elite); break;
      case 'forgePerGainedChess': {
        const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, (state.counters?.gained || 0) * value(p, elite)); output(services, state, p.id, amount, piece); break;
      }
      case 'forgePerFundsSpent': {
        const spent = state.counters?.spent || 0; const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, Math.floor(spent / p.spendPer) * value(p, elite)); output(services, state, p.id, amount, piece); break;
      }
      case 'forgeBenchCount': {
        const n = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, (state.pieces || []).filter((x) => !isPresent(x)).length * value(p, elite)); output(services, state, p.id, n, piece); break;
      }
      case 'forgeBenchPairs': {
        const n = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, Math.floor((state.pieces || []).filter((x) => !isPresent(x)).length / p.pairSize) * value(p, elite)); output(services, state, p.id, n, piece); break;
      }
      case 'forgeDominantFaction':
        for (const [id, quantity] of dominantRecipe(state, piece, services, p, elite)) output(services, state, id, quantity, piece);
        break;
      case 'forgeFactionTierCount':
      case 'forgeDominantFactionTierCount':
      case 'forgeFactionTierPair': {
        const ranks = roster(state).filter((x) => isPresent(x) && (r.behavior === 'forgeFactionTierCount' ? hasFaction(x, p.faction, services) : true)).map((x) => services.catalog.operators[chessIdOf(x)]?.tier || 0);
        const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, new Set(ranks).size * value(p, elite));
        if (r.behavior === 'forgeFactionTierPair') for (const id of p.ids) output(services, state, id, amount, piece);
        else output(services, state, p.id, amount, piece);
        break;
      }
      case 'forgeAdjacent': {
        const targets = adjacent(state, piece, p.direction).filter((x) => x === piece || isPresent(x));
        const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, targets.length * value(p, elite));
        output(services, state, p.id, amount, piece); break;
      }
      case 'forgeRowCount': {
        const n = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, roster(state).filter((x) => isPresent(x) && x.row === piece.row).length * value(p, elite));
        output(services, state, p.id, n, piece); break;
      }
      case 'attachShopBadgeFirstRefresh':
        if ((state.counters?.paidRefreshes || state.counters?.refreshes || 0) > 0 && !mark().done) { mark().done = true; attachShopEquipment(state, p.id, value(p, elite), piece); }
        break;
      case 'attachShopByRefreshCount': {
        const amount = Math.min(p[elite ? 'capElite' : 'capNormal'] ?? Infinity, (state.counters?.paidRefreshes || 0) * value(p, elite));
        attachShopEquipment(state, p.id, amount, piece); break;
      }
      case 'randomEquipment': {
        const pool = p.poolId ? services.catalog.pools?.[p.poolId] : null;
        for (let i = 0; i < value(p, elite); i++) output(services, state, pool ? choosePool(pool, services, elite) : choose(p.ids, services), 1, piece); break;
      }
      case 'randomUnlockedEquipment': {
        const pool = Object.values(services.catalog.equipment).filter((x) => x.available && x.kind !== 'prizeGear' && (x.shopTier || x.oldTier || x.level || 1) <= (state.shop?.level || 1)).map((x) => x.id);
        for (let i = 0; i < value(p, elite); i++) output(services, state, choose(pool, services), 1, piece); break;
      }
      case 'recruitOffer':
        {
          const tier = elite ? p.eliteTier || p.normalTier : p.normalTier;
          addRecruitOffer(state, services, { tiers: Number.isInteger(tier) ? [tier] : undefined, tierMax: tier === 'currentShopLevel' ? state.shop?.level : undefined, choices: p.choices || 3, sourceUid: piece.uid, hook });
          break;
        }
      case 'conditionalRecruit':
        if (p.condition !== 'sameRowCount>=3' || roster(state).filter((x) => isPresent(x) && x.row === piece.row).length >= 3) services.grantChess(state, choose(p.choices, services), { origin: 'native', sourceUid: piece.uid });
        break;
      case 'randomChessOffer': {
        const pool = services.catalog.pools?.[p.poolId];
        for (let i = 0; i < value(p, elite); i++) services.grantChess(state, choosePool(pool, services, elite), { origin: 'native', sourceUid: piece.uid }); break;
      }
      case 'randomSupply': {
        const pool = services.catalog.pools?.[p.poolId];
        for (let i = 0; i < value(p, elite); i++) output(services, state, choosePool(pool, services, elite), 1, piece); break;
      }
      case 'dominantFactionRecruit': {
        const needsRow = elite ? p.eliteRequires : p.normalRequires;
        if (!needsRow || roster(state).filter((x) => isPresent(x) && x.row === piece.row).length >= 3) addRecruitOffer(state, services, { tierMax: state.shop?.level || 1, choices: 3, faction: dominantFaction(state, services), sourceUid: piece.uid, hook }); break;
      }
      case 'replayAdjacentNative': {
        const limit = elite ? p.normalRange || 1 : 1;
        const candidates = adjacent(state, piece, 'front').filter((x) => x !== piece).slice(0, limit);
        const source = candidates.find((x) => (traitFor(x, services)?.effect?.prep || []).some((other) => other.trigger === p.sourceTrigger && p.allow.includes(other.behavior)));
        if (source && !event.replay) {
          const target = (traitFor(source, services).effect.prep).find((other) => other.trigger === p.sourceTrigger && p.allow.includes(other.behavior));
          // Execute exactly one allowlisted neighboring rule; copied rules cannot replay again.
          fire(state, p.sourceTrigger, source, { ...event, replay: true, replayTarget: piece }, services, true, target);
        }
        break;
      }
      break;
      default: throw new Error(`Unregistered native behavior: ${r.behavior}`);
    }
    services.record?.(state, { type: 'nativeHook', hook, sourceUid: piece?.uid, chessId: chessIdOf(piece), behavior: r.behavior });
  }
}

function hasFaction(piece, faction, services) {
  const op = services.catalog?.operators?.[chessIdOf(piece)];
  const data = services.data?.chess?.[chessIdOf(piece)] || op?.source?.normalChess;
  return (data?.bonds || []).some((id) => services.data?.bonds?.[id]?.name === faction || services.data?.bonds?.[id]?.faction === faction);
}

function roll(services) {
  const rng = services.rng;
  if (typeof rng === 'function') return rng();
  if (typeof rng?.next === 'function') return rng.next();
  if (typeof rng?.float === 'function') return rng.float();
  throw new TypeError('Random native effects require services.rng');
}
function choose(items, services) {
  if (!items?.length) return null;
  return items[Math.min(items.length - 1, Math.floor(roll(services) * items.length))];
}
function choosePool(pool, services, elite = false) {
  if (!pool) throw new Error('Missing upstream SharedPool definition for native effect');
  let entries = pool.weighted;
  if (entries && elite && Array.isArray(pool.goldenWeights)) entries = entries.map(([id], i) => [id, pool.goldenWeights[i]]);
  if (!entries) return choose(pool.items, services);
  const total = entries.reduce((n, pair) => n + Number(pair[1] || 0), 0);
  if (total <= 0) throw new Error('SharedPool has no positive weights');
  let pick = roll(services) * total;
  for (const [id, weight] of entries) { pick -= Number(weight || 0); if (pick < 0) return id; }
  return entries.at(-1)[0];
}
function dominantFaction(state, services) {
  const counts = new Map();
  for (const p of roster(state).filter(isPresent)) {
    const chess = services.data?.chess?.[chessIdOf(p)] || services.catalog?.operators?.[chessIdOf(p)]?.source?.normalChess;
    for (const bond of chess?.bonds || []) counts.set(services.data?.bonds?.[bond]?.name || bond, (counts.get(services.data?.bonds?.[bond]?.name || bond) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
function dominantRecipe(state, piece, services, params, elite) {
  const faction = dominantFaction(state, services);
  const recipe = services.catalog.config.badgeRecipes?.[faction] || services.catalog.config.factionRecipes?.[faction] || services.catalog.config.badgeRecipes?.default;
  if (Array.isArray(recipe) && recipe.length) {
    piece.nativeState ||= {}; const stateKey = `recipe:${faction}`; const cursor = piece.nativeState[stateKey] || 0;
    const produced = Array.from({ length: value(params, elite) }, (_, i) => recipe[(cursor + i) % recipe.length]);
    piece.nativeState[stateKey] = cursor + produced.length;
    return produced.map((id) => [id, 1]);
  }
  if (recipe && !Array.isArray(recipe)) return Object.entries(recipe).map(([id, n]) => [id, n * value(params, elite)]);
  const profession = services.data?.chess?.[chessIdOf(piece)]?.profession || services.catalog.operators[chessIdOf(piece)]?.source?.normalChess?.profession;
  const fallback = services.catalog.config.professionRecipes?.[profession];
  return Object.entries(fallback || {}).map(([id, n]) => [id, n * value(params, elite)]);
}
function adjacent(state, piece, direction) {
  if (!piece || piece.row == null || piece.col == null) return [piece];
  const sign = piece.dir === 'LEFT' ? -1 : 1;
  const delta = direction === 'behind' ? -sign : sign;
  const col = piece.col + delta;
  return [piece, ...roster(state).filter((x) => x.row === piece.row && x.col === col)];
}
function attachShopEquipment(state, id, quantity, sourcePiece) {
  let left = quantity;
  for (const slot of state.shop?.slots || []) {
    if (!left || slot.kind !== 'chess' || slot.sold || slot.frozen) continue;
    slot.equipment ||= [];
    slot.equipment.push({ id, quantity: left, origin: 'native', sourceUid: sourcePiece?.uid });
    left = 0;
  }
}
function addRecruitOffer(state, services, opts) {
  const all = Object.values(services.data?.chess || {}).filter((x) => x.chessId?.endsWith('_a') && x.visible !== false && x.tier != null && (!opts.tiers || opts.tiers.includes(x.tier)) && (!opts.tierMax || x.tier <= opts.tierMax) && (!opts.faction || (x.bonds || []).some((b) => (services.data?.bonds?.[b]?.name || b) === opts.faction)));
  const choices = [];
  const pool = [...all];
  for (let i = 0; i < (opts.choices || 3) && pool.length; i++) { const selected = choose(pool, services); choices.push(selected.chessId); pool.splice(pool.indexOf(selected), 1); }
  services.addOffer(state, { id: `native:${opts.sourceUid}:${state.round}:${state.nextUid++}`, type: 'recruit', choices, source: 'native', sourceUid: opts.sourceUid });
}

export function runNativeHook(state, hook, event = {}, services = {}) {
  if (!state || !services.catalog) throw new TypeError('runNativeHook requires state and services.catalog');
  if (suppressed(event)) return state;
  if (!['gain', 'sold', 'roundStart', 'prepEnd', 'refresh', 'spend', 'merge'].includes(hook)) throw new TypeError(`Unknown native hook: ${hook}`);
  const piece = event.piece || (event.uid && roster(state).find((x) => x.uid === event.uid));
  if (['gain', 'sold', 'merge'].includes(hook)) {
    if (piece) fire(state, hook === 'merge' ? 'gain' : hook, piece, event, services, Boolean(event.replay));
  } else {
    for (const p of roster(state)) fire(state, hook, p, event, services);
  }
  return state;
}
