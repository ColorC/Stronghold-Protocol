import { authoredCard as card, pct } from './core-adaptations.js';

// Each pool entry is reviewed against the same pinned skill/talent records as
// the first thirty. An unlisted operator remains a draft, never a generic kit.
export const POOL_ADAPTATIONS = Object.freeze({
  char_155_tiger: card(1, 'B', 'medium', 20, 1, v => [
    `斩击${v.hits}次${pct(v.scale)}%法伤，回复伤害${pct(v.drain)}%的生命。`,
    `友军每累计闪避${v.every}次，相邻近卫积存1次双倍攻击。`,
  ], { values: { hits: 8, scale: 2.2, drain: .25, every: 3, dodge: .3 }, sourceTalent: 0, tags: ['虎拳迅击'] }),
  char_140_whitew: card(1, 'B', 'medium', 20, 2, v => [
    `对2名敌人各斩击${v.hits}次${pct(v.scale)}%法伤，沉默${v.silence}秒。`,
    `友军每累计沉默${v.every}次，为相邻近卫充能${v.charge}。`,
  ], { values: { hits: 11, scale: 2.2, silence: 5, every: 8, charge: 4 }, sourceTalent: 0, tags: ['精神摧毁'] }),
  char_356_broca: card(1, 'B', 'medium', 20, 3, v => [
    `前方3名敌人各受${v.hits}次${pct(v.scale)}%法伤，停顿${v.slow}秒。`,
    `施放后晕眩${v.selfStun}秒；友军每阻挡${v.every}次，自身充能${v.charge}。`,
  ], { values: { hits: 5, scale: 2.9, slow: 1, selfStun: 5, every: 3, charge: 4, guard: .12 }, sourceTalent: 0, tags: ['钻头强化'] }),
  char_173_slchan: card(1, 'A', 'fast', 12, 3, v => [
    `拉近前方3名敌人，造成${pct(v.scale)}%真伤、晕眩${v.stun}秒。`,
    `友军每累计拉动${v.every}次，使目标晕眩${v.linkStun}秒。`,
  ], { values: { scale: 2, force: 2, stun: 3, linkStun: 2, every: 2, guard: .12 }, sourceTalent: 0, tags: ['雪境猎手'] }),
  char_4036_forcer: card(1, 'A', 'medium', 16, 99, v => [
    `推开原范围敌人并晕眩${v.stun}秒，撞高台时${v.wallStun}秒。`,
    `友军推动重型敌人后，6秒内攻击无视${v.ignore}防御。`,
  ], { values: { force: 3, stun: 2.5, wallStun: 4, brushStun: 2.5, ignore: 180, weight: 3, exposed: 6 }, sourceTalent: 0, tags: ['技巧射击', '碰撞晕眩'] }),
  char_188_helage: card(2, 'B', 'medium', 20, 3, v => [
    `原范围3名敌人各受${v.hits}次${pct(v.scale)}%物伤。`,
    `友军每累计击倒${v.every}名敌人，自身回复${pct(v.heal)}%生命。`,
  ], { values: { hits: 7, scale: 2, every: 3, heal: .2, regen: 60, aspd: 100, lostForMax: .7 }, sourceTalent: 1, tags: ['月盈星亏', '运筹帷幄'] }),
  char_204_platnm: card(1, 'C', 'slow', 30, 1, v => [
    `本场攻击+${pct(v.atk)}%、攻速${v.aspd}，攻击范围扩大。`,
    `友军每累计控制${v.every}次，积存1次满蓄力攻击。`,
  ], { values: { atk: 1, aspd: -20, every: 3, chargeScale: 1.8, minGap: 1, maxGap: 2.5 }, sourceTalent: 0, tags: ['本场仅需施放一次', '蓄力攻击'] }),
  char_373_lionhd: card(1, 'A', 'fast', 10, 99, v => [
    `原范围敌人受${pct(v.scale)}%法伤，法抗−${pct(v.resDown)}%，${v.seconds}秒。`,
    `其他术师施放时，若范围内至少3名敌人，自身充能${v.charge}。`,
  ], { values: { scale: 2.3, resDown: .15, seconds: 6, charge: 4, atk: .04, maxStacks: 5 }, sourceTalent: 0, tags: ['可储存3次', '破片杀伤'] }),
  char_4031_liesel: card(1, 'A', 'fast', 12, 3, v => [
    `攻击3名敌人${pct(v.scale)}%法伤，附加每秒${pct(v.dot)}%法伤${v.seconds}秒。`,
    `友军每累计${v.every}次群攻命中3名敌人，自身充能${v.charge}。`,
  ], { values: { scale: 1.8, dot: .35, seconds: 6, every: 3, charge: 4, bonus: .2, radius: 1.5 }, sourceTalent: 0, tags: ['溅射扩大', '执棒素养'] }),
  char_4054_malist: card(1, 'A', 'fast', 8, 1, v => [
    `连续攻击2次，每次${pct(v.scale)}%法伤。`,
    `其他术师每累计施放${v.every}次，下次技能必定暴击。`,
  ], { values: { scale: 2, hits: 2, every: 3, crit: 1.5, chance: .25 }, sourceTalent: 0, tags: ['可储存3次', '忽有所悟'] }),
  char_4211_snhunt: card(1, 'A', 'fast', 10, 1, v => [
    `连射2次${pct(v.scale)}%物伤，静止目标提升至${pct(v.stationary)}%。`,
    `友军每累计寒冷${v.every}次，裂云兽攻击${pct(v.beast)}%并寒冷${v.cold}秒。`,
  ], { values: { scale: 2.2, stationary: 2.6, every: 3, beast: 1.8, cold: 3 }, sourceTalent: 0, tags: ['可储存2次', '施放时裂云一击'] }),
  char_102_texas: card(1, 'A', 'medium', 20, 99, v => [
    `获得${v.dp}费用；周围敌人受2次${pct(v.scale)}%法伤，晕眩${v.stun}秒。`,
    `每累计获得${v.every}费用，为相邻先锋充能${v.charge}。`,
  ], { values: { scale: 1.7, dp: 12, stun: 3, every: 8, charge: 4, initialDP: 2 }, sourceTalent: 0, tags: ['战术快递：初始费用+2'] }),
  char_349_chiave: card(1, 'A', 'medium', 20, 99, v => [
    `获得${v.dp}费用；周围敌人受${pct(v.scale)}%法伤，法抗−20%，${v.seconds}秒。`,
    `友军每累计召唤${v.every}次，缩短召唤者当前再部署${v.cut}秒。`,
  ], { values: { scale: 3.5, dp: 13, resDown: .2, seconds: 8, every: 2, cut: 12, machineTime: .25, bonus: .11 }, sourceTalent: 0, tags: ['支援机械再部署−75%', '技工专长'] }),
});

export const POOL_CARD_ROLES = Object.freeze({
  char_155_tiger: { line: 'redeploy', produces: ['sustain'], consumes: [], roles:['direct','buffOthers'] },
  char_140_whitew: { line: 'redeploy', produces: [], consumes: [], roles:['direct','feed'] },
  char_356_broca: { line: 'redeploy', produces: [], consumes: ['block'], roles:['direct'] },
  char_173_slchan: { line: 'redeploy', produces: ['control', 'displacement'], consumes: ['displacement'], roles:['direct','control'] },
  char_4036_forcer: { line: 'redeploy', produces: ['control', 'displacement'], consumes: ['displacement'], roles:['control'] },
  char_188_helage: { line: 'workshop', produces: ['sustain'], consumes: ['kill'], roles:['direct'] },
  char_204_platnm: { line: 'ammo', produces: [], consumes: ['control'], roles:[] },
  char_373_lionhd: { line: 'workshop', produces: [], consumes: ['skill'], roles:['direct'] },
  char_4031_liesel: { line: 'workshop', produces: [], consumes: ['skill'], roles:['direct'] },
  char_4054_malist: { line: 'workshop', produces: [], consumes: ['skill'], roles:['direct'] },
  char_4211_snhunt: { line: 'redeploy', produces: ['cold'], consumes: ['cold'], roles:['direct'] },
  char_102_texas: { line: 'redeploy', produces: ['control', 'economy'], consumes: ['economy'], roles:['direct','control','feed'] },
  char_349_chiave: { line: 'redeploy', produces: ['economy', 'deployment'], consumes: ['summon'], roles:['direct','aura'] },
});

const pair = (key, value, text, linkKey, linkValue, linkText) => [
  { sourceKind: 'skill', key, value, text }, { sourceKind: 'talent', key: linkKey, value: linkValue, text: linkText },
];
export const POOL_MODULES = Object.freeze({
  char_155_tiger: pair('scale', 2.6, '每次裂魂伤害提升至260%。', 'every', 2, '友军每累计闪避2次积存双倍攻击。'),
  char_140_whitew: pair('scale', 2.6, '每次狼魂伤害提升至260%。', 'charge', 6, '沉默连线充能提升至6。'),
  char_356_broca: pair('scale', 3.5, '每次高压电流伤害提升至350%。', 'charge', 6, '阻挡连线充能提升至6。'),
  char_173_slchan: pair('scale', 2.4, '束缚链伤害提升至240%。', 'linkStun', 3, '拖拽连线晕眩延长至3秒。'),
  char_4036_forcer: pair('stun', 3, '直接命中的晕眩延长至3秒。', 'ignore', 250, '技巧射击无视防御提升至250。'),
  char_188_helage: pair('hits', 9, '满月每名目标受到9次斩击。', 'heal', .3, '运筹帷幄连线回复30%生命。'),
  char_204_platnm: pair('atk', 1.2, '天马视域攻击提升至+120%。', 'chargeScale', 2.1, '满蓄力攻击的倍率提升至210%。'),
  char_373_lionhd: pair('scale', 2.8, '解构与爆破伤害提升至280%。', 'charge', 6, '破片杀伤连线充能提升至6。'),
  char_4031_liesel: pair('scale', 2.2, '直到终曲首击伤害提升至220%。', 'charge', 6, '群攻连线充能提升至6。'),
  char_4054_malist: pair('scale', 2.4, '神工意匠每次伤害提升至240%。', 'every', 2, '其他术师每累计施放2次触发暴击。'),
  char_4211_snhunt: pair('scale', 2.6, '特殊子弹基础倍率提升至260%。', 'cold', 4, '裂云兽寒冷延长至4秒。'),
  char_102_texas: pair('scale', 2, '剑雨每次伤害提升至200%。', 'charge', 6, '战术快递连线充能提升至6。'),
  char_349_chiave: pair('scale', 4.2, '火焰剥离伤害提升至420%。', 'cut', 16, '召唤连线减少当前再部署16秒。'),
});

export const POOL_INNATES = Object.freeze({
  char_155_tiger: ['有30%概率闪避近战物理攻击；自身闪避后积存1次双倍普通攻击。'],
  char_140_whitew: ['普通攻击使敌人沉默5秒；狼魂的远程攻击不降低伤害。'],
  char_356_broca: ['阻挡至少2名敌人时，攻击、防御+12%。'],
  char_173_slchan: ['未阻挡敌人时，攻击、防御+12%。'],
  char_4036_forcer: ['自身攻击重量至少3的敌人时，也无视180防御；推撞其他敌人时使其晕眩2.5秒。'],
  char_188_helage: ['未阻挡时每秒回复60生命；生命越低攻击速度越高，损失70%生命时达到+100。'],
  char_204_platnm: ['距离上次攻击越久，普通攻击越强；间隔2.5秒时达到180%倍率。'],
  char_373_lionhd: ['原技能范围内每名敌人使攻击+4%，最多5层，随敌人离开而移除。'],
  char_4031_liesel: ['群攻覆盖至少3名敌人时，伤害提升20%；持续伤害各自结算。'],
  char_4054_malist: ['自身普通攻击有25%概率造成150%伤害。'],
  char_4211_snhunt: ['每次施放时，裂云兽立即攻击当前目标，造成180%物伤并使其寒冷3秒。'],
  char_102_texas: ['编入作战队伍时，初始部署费用+2。'],
  char_349_chiave: ['支援机械再部署时间−75%；每名在场支援机械使自身攻击、防御+11%。'],
});
