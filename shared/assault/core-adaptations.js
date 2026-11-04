// Authored first tranche of §8. Native grids, charges and source names are
// resolved by the compiler from the pinned official tables, never retyped here.
const card = (index, type, tier, cost, targetCount, lines, extra = {}) => ({
  index, type, tier, cost, targetCount, lines: typeof lines === 'function' ? lines(extra.values) : lines, ...extra,
});
const pct = value => Math.round(value * 1000000) / 10000;
export { card as authoredCard, pct };
export const CORE_ADAPTATIONS = Object.freeze({
  char_1045_svash2: card(1, 'A', 'medium', 17, 6, v => [
    `造成${v.scale * 100}%物伤，至多6名；寒冷${v.cold}秒。`,
    '队友获得1次锋锐，部署后释放，最多存2次。',
    `其他干员再部署时，为自身充能${v.charge}。`,
  ], { values: { scale: 3.8, cold: 6, charge: 4, echoes: 2, costReduce: 11 }, tags: ['可储存2次', '揭隐', '谢拉格免疫冻结', '风雪之眼减费'], sourceTalent: 0 }),
  char_172_svrash: card(2, 'B', 'slow', 35, 6, v => [
    `原范围至多6名敌人受到${v.scale * 100}%物伤。`,
    `施放时，其他干员当前再部署时间−${v.cut}秒。`,
  ], { values: { scale: 8.5, cut: 12 }, tags: ['揭隐'], sourceTalent: 0 }),
  // 自然震慑 (original S2) held for N seconds at 40 SP; 20 SP here keeps its ~62% uptime (25 s x 20/40 = 12.5 -> 12).
  char_174_slbell: card(1, 'B', 'medium', 20, 99, v => [
    `攻击范围内敌人防御−${pct(v.def)}%、法抗−${pct(v.res)}%，持续${v.awe}秒。`,
    `攻击范围内生命低于${pct(v.threshold)}%的敌人脆弱${pct(v.fragile)}%。`,
  ], { values: { def: .6, res: .3, awe: 12, threshold: .4, fragile: .3 }, tags: ['双目标普攻'], sourceTalent: 0 }),
  char_206_gnosis: card(1, 'A', 'fast', 10, 99, v => [
    `范围内敌人受到${pct(v.scale)}%法伤，寒冷${v.cold}秒。`,
    `范围内寒冷敌人脆弱${pct(v.fragile)}%，冻结时翻倍。`,
  ], { values: { scale: 2, cold: 4, fragile: .27 }, tags: ['可储存2次', '普攻寒冷1秒', '谢拉格抵抗'], sourceTalent: 0 }),
  char_4116_blkkgt: card(1, 'A', 'fast', 12, 6, v => [
    `前方至多6名敌人受到2次${pct(v.scale)}%物伤。`,
    `阻挡目标多打1次；命中敌人战栗${v.tremble}秒。`,
    `友军攻击战栗敌人时无视${pct(v.ignore)}%防御。`,
  ], { values: { scale: 3.1, tremble: 5, ignore: .3 }, tags: ['可储存2次', '天生的武者'], sourceTalent: 1 }),
  char_112_siege: card(1, 'A', 'fast', 10, 99, v => [
    `周围敌人受到${pct(v.scale)}%物伤，获得${v.dp}费用。`,
    `周围四格敌人倒下时，为自身充能${v.charge}。`,
  ], { values: { scale: 3.4, dp: 3, charge: 2, aura: .1 }, tags: ['可储存3次', '先锋攻击与防御+10%'], sourceTalent: 1 }),
  char_103_angel: card(2, 'B', 'medium', 20, 1, v => [
    `向当前目标连射${v.hits}发，每发${pct(v.scale)}%物伤。`,
    `部署时，随机友军本场攻击+${pct(v.atk)}%、生命+${pct(v.hp)}%。`,
  ], { values: { scale: 1.1, hits: 12, atk: .08, hp: .13 }, tags: ['快速弹匣'], nativeDeploy: true, sourceTalent: 1 }),
  char_1041_angel2: card(2, 'D', 'medium', 16, 1, v => [
    `连射${v.hits}次${pct(v.scale)}%物伤，投送1名近战并充能${v.charge}。`,
    `友军耗弹时回复${pct(v.heal)}%生命，${pct(v.chance)}%概率轰炸${pct(v.bombard)}%。`,
    `弹药友军攻击+${pct(v.aura)}%，拉特兰效果翻倍。`,
  ], { values: { scale: 1.6, hits: 5, heal: .06, chance: .25, bombard: 1.65, aura: .13, charge: 6 }, tags: ['弹药4', '手动投递坐标'], ammo: 4, sourceTalent: 0 }),
  char_4072_ironmn: card(1, 'E', 'medium', 20, 99, v => [
    `补1个装置；各耗${pct(v.deviceCastLoss)}%生命，为前方1名干员充能${v.charge}。`,
    `附近自身装置损毁时，${pct(v.recycle)}%概率回收1个。`,
    `本场攻击、防御+${pct(v.selfBonus)}%，攻击所有阻挡敌人。`,
  ], { values: { stock: 3, field: 2, charge: 4, interval: 4, deviceCharge: 2, recycle: .8, deviceHpDrain: .004, deviceCastLoss:.24, selfBonus: .6 },
    tags: ['装置3／同时2', '每4秒充能2', '手动摆放'], sourceTalent: 1 }),
  char_202_demkni: card(1, 'A', 'fast', 10, 99, v => [
    `治疗原范围内所有友军${pct(v.scale)}%攻击力的生命。`,
    `每次治疗时，为被治疗干员充能${v.charge}。`,
  ], { values: { scale: 1.4, charge: 1 }, tags: ['莱茵充能护服'], sourceTalent: 1 }),
  char_350_surtr: card(2, 'C', 'slow', 30, 4, v => [
    `回满生命，本场攻击+${pct(v.atk)}%、范围+${v.range}、目标+${v.targets}。`,
    `生命+${v.hp}并逐渐流失；再次施放回满生命。`,
    `致命伤后生命不低于1，${v.ember}秒后原地再部署。`,
  ], { values: { atk: 3.3, hp: 5000, range: 2, targets: 3, ember: 9 }, tags: ['无视20法抗'], sourceTalent: 1 }),
  char_2023_ling: card(1, 'E', 'fast', 12, 2, v => [
    `自身与召唤物各攻击2名敌人${pct(v.scale)}%法伤，束缚${v.bind}秒。`,
    `回收或损毁：充能${v.charge}，本场攻击+${pct(v.growth)}%，至多${v.maxStacks}层。`,
  ], { values: { scale: 4.5, bind: 3, charge: 4, growth: .03, maxStacks: 5, stock: 5, field: 3 }, tags: ['可储存2次', '召唤物5／同时3', '手动摆放'], sourceTalent: 1 }),
  char_263_skadi: card(1, 'C', null, 0, 1, v => [
    `部署时，攻击力+${pct(v.atk)}%，持续${v.duration}秒。`,
    `自身再部署时间−${v.redeploy}秒。`,
  ], { values: { atk: 1.7, duration: 30, redeploy: 10, aura: .14 }, tags: ['部署被动', '深海猎人攻击+14%'], passive: true, nativeDeploy: true, sourceTalent: 1 }),
  char_332_archet: card(1, 'A', 'fast', 10, 5, v => [
    `首目标${v.hits}连射${pct(v.scale)}%物伤，弹射时每跳少1发。`,
    `其他狙击每累计施放${v.every}次，为相邻弹药干员装填。`,
  ], { values: { scale: 1.68, hits: 5, every: 3, bounce: 1.5 }, tags: ['可储存3次', '部署护盾'], nativeDeploy: true, sourceTalent: 0 }),
  char_279_excu: card(1, 'B', 'medium', 20, 99, v => [
    `向原范围所有敌人各射击${v.hits}次，造成${pct(v.scale)}%物伤。`,
    `其他弹药干员每累计施放${v.every}次技能，自身追加1轮散射。`,
  ], { values: { scale: 1, hits: 6, ignore: 160, frontScale: 1.5, every:3 }, tags: ['散射近距离增伤','自身攻击无视160防御'], sourceTalent: 0 }),
  char_1032_excu2: card(2, 'D', 'medium', 20, 99, v => [
    `横扫原范围${pct(v.scale)}%物伤；末发追加${pct(v.finish)}%。`,
    `每耗弹本场伤害+${pct(v.growth)}%攻击力，最多${v.maxStacks}次。`,
    `友军每耗弹${v.every}次，下次技能额外斩击1次。`,
  ], { values: { scale: 2.8, finish: 2.5, growth: .06, maxStacks: 30, every: 3, traitRatio: 3 },
    ammo: 4, tags: ['弹药4', '拉特兰扩容', '技能特性治疗×3'], sourceTalent: 0 }),
  char_498_inside: card(1, 'D', 'fast', 12, 1, v => [
    `优先射击远程敌人，造成${pct(v.scale)}%物伤。`,
    `每场首次装填，为相邻拉特兰弹药上限+${v.allyAmmo}。`,
  ], { values: { scale: 2.3, selfAmmo: 3, allyAmmo: 1, at: 20 }, ammo: 4, tags: ['弹药4', '火力支援', '不易受攻击'], sourceTalent: 0 }),
  char_4193_lemuen: card(2, 'D', 'medium', 20, 1, v => [
    `轰炸${pct(v.splash)}%物伤，中心提升至${pct(v.center)}%。`,
    `拉特兰范围内精英停留${v.wantedAt}秒后被通缉。`,
    `通缉目标受拉特兰伤害+${pct(v.fragile)}%，自身可全场狙击。`,
  ], { values: { splash: 3, center: 4.5, radius: 1.5, centerRadius: .8, wantedAt: 8, fragile: .15, growthAt: 20, atk: .1 },
    ammo: 5, tags: ['弹药5', '逃犯引渡'], sourceTalent: 0 }),
  char_128_plosis: card(1, 'B', 'slow', 35, 3, v => [
    `治疗原范围${v.targets}名友军${pct(v.scale)}%攻击力的生命。`,
    `友军装填时，加速相邻干员${v.haste}秒。`,
  ], { values: { scale: 6, targets: 3, haste: 4 }, tags: ['技力光环+0.3／秒'], sourceTalent: 0 }),
  char_1021_kroos2: card(1, 'B', 'medium', 20, 1, v => [
    `向当前目标射出2发，随后射出2轮4连击。`,
    `每场前${v.first}次友军晕眩，为相邻弹药干员充能${v.charge}。`,
  ], { values: { hits: 10, scale: 1, chance: .2, crit: 1.5, stun: .2, first: 3, charge: 4 }, tags: ['中的：暴击晕眩'], sourceTalent: 0 }),
  char_126_shotst: card(1, 'A', 'fast', 12, 5, v => [
    `射击${v.targets}名敌人${pct(v.scale)}%物伤，防御−${pct(v.defDown)}%，${v.seconds}秒。`,
    `其他狙击每累计施放${v.every}次，自身追加1次范围内对空射击。`,
  ], { values: { scale: 2, targets: 5, defDown: .4, seconds: 5, airBonus: .35, every:3 }, tags: ['优先对空','自身对空伤害+35%'], sourceTalent: 0 }),
  char_107_liskam: card(1, 'B', 'medium', 20, 4, v => [
    `原范围4名敌人各受${v.hits}次${pct(v.scale)}%法伤。`,
    `命中${pct(v.chance)}%晕眩${v.stun}秒，施放后自身晕眩${v.selfStun}秒。`,
    `每累计${v.every}次受击，自身与相邻1名干员充能${v.charge}。`,
  ], { values: { scale: 3, hits: 3, chance: .25, stun: 1, selfStun: 5, every: 3, charge: 4 }, tags: ['雷抗+10'], sourceTalent: 0 }),
  char_108_silent: card(1, 'E', 'medium', 20, 99, v => [
    `补1架无人机，治疗其周围友军${pct(v.heal)}%攻击力生命。`,
    `无人机治疗后，使目标本场攻击速度+${v.aspd}。`,
  ], { values: { stock: 1, field: 1, heal: 3, aspd: 12,seconds:10 }, tags: ['手动无人机','无人机10秒后销毁'], sourceTalent: 0 }),
  char_484_robrta: card(1, 'E', 'medium', 20, 1, v => [
    `补1个造型仪；本场防御+${pct(v.selfDef)}%、阻挡+1。`,
    `造型仪为原范围近战干员加${v.shields}层护盾、防御+${pct(v.def)}%。`,
    `每场前${v.first}次友军护盾破裂，造型仪再提供${v.shields}层护盾。`,
  ], { values: { stock: 3, field: 3, shields: 2, selfDef: .8, def: .3, first: 3,seconds:25 }, tags: ['手动造型仪','造型仪存在25秒'], sourceTalent: 0 }),
  char_242_otter: card(1, 'E', 'medium', 20, 99, v => [
    `水獭引爆后回收，原范围${pct(v.scale)}%法伤、晕眩${v.stun}秒。`,
    `每累计${v.every}次友方召唤物回收，相邻干员充能${v.charge}。`,
  ], { values: { stock: 5, field: 5, scale: 6, stun: 2, every: 2, charge: 4, slow: 25 }, tags: ['水獭阻挡减攻速', '手动水獭'], sourceTalent: 0 }),
  char_249_mlyss: card(2, 'E', 'medium', 20, 1, v => [
    `获得${v.dp}费用，本场自身与流形攻击+${pct(v.atk)}%。`,
    `流形攻击；近战拖拽晕眩${v.stun}秒，远程束缚${v.bind}秒。`,
    `其他莱茵干员再部署时，流形重新复制并回满生命。`,
  ], { values: { stock: 1, field: 1, dp: 15, atk: .5, stun: 2, bind: 1.5, factor: .9, refresh: 25, costReduce: 2 },
    tags: ['远程施放回满生命', '手动流形'], sourceTalent: 0 }),
  char_427_vigil: card(2, 'E', 'medium', 20, 1, v => [
    `获得${v.dp}费用，自身立即${v.hits}连击；狼群同时攻击。`,
    `对狼群阻挡的目标，追加自身${pct(v.arts)}%攻击力法伤。`,
    `友军攻击狼群阻挡的敌人时无视${v.ignore}防御。`,
  ], { values: { stock: 1, field: 1, dp: 12, hits: 3, arts: .5, heads: 2, maxHeads: 3, refresh: 25, ignore: 175 },
    tags: ['狼影2／最多3', '手动狼群'], sourceTalent: 1 }),
  char_1028_texas2: card(2, 'B', null, 0, 4, v => [
    `部署时，周围敌人受2次${pct(v.appear)}%法伤、晕眩${v.stun}秒。`,
    `再向原范围4名敌人各释放${v.waves}次${pct(v.scale)}%剑雨。`,
    `每场前${v.first}次友军击倒，回满生命并再释放剑雨。`,
  ], { values: { appear: 1.65, scale: 1.3, stun: 2, rainStun: .2, waves: 3, first: 2, atk: .2 },
    tags: ['部署被动', '剑术庇护'], passive: true, nativeDeploy: true, sourceTalent: 0 }),
  char_4087_ines: card(2, 'B', null, 0, 6, v => [
    `回收手动影哨，沿线6名敌人受${pct(v.scale)}%物伤并回费。`,
    `本场攻击+${pct(v.atk)}%；首次入场免费并立即再部署。`,
    `友军首次命中每名敌人，束缚${v.bind}秒并偷取${v.steal}攻击。`,
  ], { values: { scale: 2, atk: 1.6, width: 1.4, dp: 1, bind: 5, steal: 90, slow: .3 },
    marker: { id: 'ines-sentry', name: '影哨', position: 'ALL', assaultPlacementClass: 'all', sourceTalent: 1 },
    tags: ['部署被动', '影哨揭隐减速'], passive: true, nativeDeploy: true, sourceTalent: 0 }),
  char_337_utage: card(1, 'B', null, 0, 1, v => [
    `部署时流失${pct(v.cost)}%当前生命，斩击${v.hits}次${pct(v.scale)}%法伤。`,
    `队友每累计受伤${v.every}次，自身追加1次${pct(v.scale)}%法术斩击。`,
  ], { values: { cost: .5, scale: 2.1, hits: 4, aspd: 100, lostForMax: .7, every:6 },
    tags: ['部署被动', '未结算斩击留待接敌', '自身认真模式最高100攻速'], passive: true, nativeDeploy: true, sourceTalent: 0 }),
});

// Coverage is authored from the actual signature and talent link. Quota checks
// use these declarations; causal tests prove the corresponding engine paths.
export const CORE_CARD_ROLES = Object.freeze({
  char_1045_svash2: { line: 'redeploy', produces: ['cold'], consumes: ['deployment'], roles:['direct','control','aura'] },
  char_172_svrash: { line: 'redeploy', produces: ['deployment'], consumes:[], roles:['direct','aura'] },
  char_174_slbell: { line: 'redeploy', produces: [], consumes: [], roles:['control','aura'] },
  char_206_gnosis: { line: 'redeploy', produces: ['cold'], consumes: ['cold'], roles:['direct','control','aura'] },
  char_4116_blkkgt: { line: 'redeploy', produces: ['control'], consumes: ['control', 'block'], roles:['direct','control','aura'] },
  char_112_siege: { line: 'redeploy', produces: ['economy'], consumes: ['kill'], roles:['direct','aura'] },
  char_103_angel: { line: 'ammo', produces: [], consumes: ['deployment'], roles:['direct','buffOthers','deploy'] },
  char_1041_angel2: { line: 'ammo', produces: ['ammunition', 'deployment', 'sustain'], consumes: ['ammunition'], roles:['direct','feed','aura'] },
  char_4072_ironmn: { line: 'workshop', produces: ['summon'], consumes: ['summon'], roles:['feed'] },
  char_202_demkni: { line: 'workshop', produces: ['sustain'], consumes: ['sustain'], roles:['direct','feed','selfGrowth'] },
  char_350_surtr: { line: 'workshop', produces: ['deployment'], consumes: [], roles:['direct'] },
  char_2023_ling: { line: 'workshop', produces: ['summon', 'control'], consumes: ['summon'], roles:['direct','control','selfGrowth'] },
  char_263_skadi: { line: 'redeploy', produces: ['deployment'], consumes: ['deployment'], roles:['aura','deploy'] },
  char_332_archet: { line: 'ammo', produces: ['sustain', 'ammunition'], consumes: ['skill'], roles:['direct','feed','deploy'] },
  char_279_excu: { line: 'ammo', produces: [], consumes: ['skill'], roles:['direct'] },
  char_1032_excu2: { line: 'ammo', produces: ['ammunition', 'sustain'], consumes: ['ammunition'], roles:['direct','selfGrowth'] },
  char_498_inside: { line: 'ammo', produces: ['ammunition'], consumes: ['ammunition'], roles:['direct','buffOthers','selfGrowth'] },
  char_4193_lemuen: { line: 'ammo', produces: ['ammunition'], consumes: [], roles:['direct','selfGrowth'] },
  char_128_plosis: { line: 'ammo', produces: ['sustain'], consumes: ['ammunition'], roles:['direct','feed','aura'] },
  char_1021_kroos2: { line: 'ammo', produces: ['control'], consumes: ['control'], roles:['direct','feed'] },
  char_126_shotst: { line: 'ammo', produces: [], consumes: ['skill'], roles:['direct'] },
  char_107_liskam: { line: 'workshop', produces: ['control'], consumes: [], roles:['direct','feed'] },
  char_108_silent: { line: 'workshop', produces: ['summon', 'sustain'], consumes: ['sustain'], roles:['direct','buffOthers'] },
  char_484_robrta: { line: 'workshop', produces: ['summon', 'sustain'], consumes: ['sustain'], roles:['buffOthers'] },
  char_242_otter: { line: 'workshop', produces: ['summon', 'control'], consumes: ['summon', 'block'], roles:['direct','control','feed'] },
  char_249_mlyss: { line: 'workshop', produces: ['summon', 'control', 'displacement', 'economy'], consumes: ['deployment'], roles:['direct','control'] },
  char_427_vigil: { line: 'workshop', produces: ['summon', 'economy'], consumes: ['block'], roles:['direct','aura','selfGrowth'] },
  char_1028_texas2: { line: 'redeploy', produces: ['control'], consumes: ['kill', 'deployment'], roles:['direct','control','deploy'] },
  char_4087_ines: { line: 'redeploy', produces: ['control', 'deployment', 'economy'], consumes: ['deployment'], roles:['direct','control','buffOthers','deploy'] },
  char_337_utage: { line: 'redeploy', produces: [], consumes:['deployment','sustain'], roles:['direct','deploy'] },
});

// Each option changes exactly one existing numeric field. The compiler attaches
// its actual skill/talent pointer and retains old selections as explicit aliases.
const pair = (skillKey, skillValue, skillText, linkKey, linkValue, linkText) => [
  { name: '原技强化', sourceKind: 'skill', key: skillKey, value: skillValue, text: skillText },
  { name: '天赋强化', sourceKind: 'talent', key: linkKey, value: linkValue, text: linkText },
];
export const CORE_MODULES = Object.freeze({
  char_1045_svash2: pair('scale', 4.5, '锋锐伤害提升至450%。', 'charge', 6, '再部署连线充能提升至6。'),
  char_172_svrash: pair('scale', 10, '真银斩伤害提升至1000%。', 'cut', 16, '当前再部署时间减少16秒。'),
  char_174_slbell: pair('awe', 15, '自然震慑持续15秒。', 'fragile', .4, '虚弱化脆弱提升至40%。'),
  char_206_gnosis: pair('scale', 2.4, '技能伤害提升至240%。', 'fragile', .32, '寒冷脆弱提升至32%，冻结时翻倍。'),
  char_4116_blkkgt: pair('scale', 3.7, '每次斩击伤害提升至370%。', 'ignore', .4, '友军无视战栗敌人40%防御。'),
  char_112_siege: pair('scale', 4, '跃空锤伤害提升至400%。', 'charge', 3, '周围敌人倒下时充能提升至3。'),
  char_103_angel: pair('scale', 1.3, '每发伤害提升至130%。', 'atk', .12, '天使祝福攻击加成提升至12%。'),
  char_1041_angel2: pair('scale', 1.9, '每发伤害提升至190%。', 'heal', .09, '耗弹连线回复生命提升至9%。'),
  char_4072_ironmn: pair('selfBonus', .8, '自身本场攻击、防御提升至+80%。', 'recycle', 1, '附近自身装置损毁时必定回收。'),
  char_202_demkni: pair('scale', 1.7, '药物配置治疗提升至170%。', 'charge', 2, '治疗连线充能提升至2。'),
  char_350_surtr: pair('atk', 3.6, '黄昏攻击加成提升至+360%。', 'ember', 11, '余烬保命延长至11秒。'),
  char_2023_ling: pair('scale', 5.4, '笑鸣瑟伤害提升至540%。', 'charge', 6, '回收与损毁连线充能提升至6。'),
  char_263_skadi: pair('atk', 2, '跃浪击攻击加成提升至+200%。', 'redeploy', 14, '自身再部署时间减少14秒。'),
  char_332_archet: pair('scale', 1.7, '每次弹射伤害提升至170%。', 'every', 2, '其他狙击每累计施放2次触发装填。'),
  char_279_excu: pair('scale', 1.2, '每发散射伤害提升至120%。', 'ignore', 200, '自身攻击时无视200防御。'),
  char_1032_excu2: pair('scale', 3.3, '基础横扫伤害提升至330%。', 'every', 2, '友军每耗弹2次积存1次额外斩击。'),
  char_498_inside: pair('scale', 2.8, '射击伤害提升至280%。', 'allyAmmo', 2, '首次装填为相邻拉特兰弹药上限+2。'),
  char_4193_lemuen: pair('center', 5.4, '轰炸中心伤害提升至540%。', 'fragile', .2, '通缉目标受拉特兰伤害+20%。'),
  char_128_plosis: pair('scale', 7.2, '技能治疗提升至720%。', 'haste', 6, '装填连线加速延长至6秒。'),
  char_1021_kroos2: pair('scale', 1.2, '技能每发伤害提升至120%。', 'charge', 6, '晕眩连线充能提升至6。'),
  char_126_shotst: pair('scale', 2.4, '碎甲弹伤害提升至240%。', 'airBonus', .45, '自身对空伤害提升至+45%。'),
  char_107_liskam: pair('scale', 3.6, '每次反击伤害提升至360%。', 'charge', 6, '战术防御充能提升至6。'),
  char_108_silent: pair('heal', 3.6, '无人机治疗提升至360%。', 'aspd', 18, '治疗连线攻击速度提升至+18。'),
  char_484_robrta: pair('selfDef', 1, '自身本场防御加成提升至+100%。', 'first', 4, '每场前4次友军护盾破裂触发造型仪。'),
  char_242_otter: pair('scale', 7.2, '水獭爆破伤害提升至720%。', 'charge', 6, '回收连线充能提升至6。'),
  char_249_mlyss: pair('atk', .7, '本场自身与流形攻击加成提升至+70%。', 'factor', 1, '流形复制属性比例提升至100%。'),
  char_427_vigil: pair('hits', 4, '自身技能改为立即4连击。', 'ignore', 225, '友军无视狼群阻挡目标225防御。'),
  char_1028_texas2: pair('scale', 1.6, '剑雨每次伤害提升至160%。', 'first', 3, '每场前3次友军击倒触发剑雨。'),
  char_4087_ines: pair('scale', 2.4, '影哨回收伤害提升至240%。', 'steal', 120, '影织偷取攻击提升至120。'),
  char_337_utage: pair('scale', 2.5, '落地斩击伤害提升至250%。', 'aspd', 120, '认真模式攻击速度上限提升至+120。'),
});

export const CORE_INNATES = Object.freeze({
  char_1045_svash2: ['谢拉格干员防御+60、每秒回复1.5%生命，部署15秒后翻倍；免疫冻结。', '风雪之眼为最近的干员部署费用−11，优先右侧近卫、术师或狙击。'],
  char_172_svrash: ['自身攻击+10%，攻击范围内敌人隐匿失效。'],
  char_174_slbell: ['普通攻击同时攻击2名敌人。'],
  char_206_gnosis: ['普通攻击使目标寒冷1秒；部署10秒后，谢拉格干员获得抵抗。'],
  char_4116_blkkgt: ['攻击有10%概率造成160%伤害，并使目标战栗5秒。'],
  char_112_siege: ['先锋干员攻击、防御+10%。'],
  char_103_angel: ['自身也获得天使祝福，攻击速度+12。'],
  char_1041_angel2: ['手动选择投递坐标；优先投送当前再部署时间最长的近战干员。'],
  char_4072_ironmn: ['每个装置每4秒为周围1名干员充能2；装置每秒流失0.4%生命。'],
  char_202_demkni: ['每在场20秒，攻击+5%、防御+4%，本场最多5层。'],
  char_350_surtr: ['无视目标20法术抗性；生命逐渐流失，60秒时达到每秒20%。'],
  char_2023_ling: ['召唤物可持有5个，同时在场3个；须在备战时指定位置。','施放时回收半血以下的召唤物。'],
  char_263_skadi: ['深海猎人干员攻击+14%。'],
  char_332_archet: ['部署时获得1层护盾；护盾破裂后自身充能7。'],
  char_279_excu: ['攻击前方一排敌人时，伤害提升50%。'],
  char_1032_excu2: ['每名拉特兰干员使自身弹药上限+1，最多+4；技能伤害的特性治疗提升至3倍。'],
  char_498_inside: ['不易受敌人攻击；在场20秒后，弹药上限+3。'],
  char_4193_lemuen: ['在场20秒后，攻击+10%、弹药上限+1。'],
  char_128_plosis: ['全体干员自然技力回复每秒+0.3，同类光环取最高值。'],
  char_1021_kroos2: ['每次命中有20%概率造成150%伤害，并晕眩目标0.2秒。'],
  char_126_shotst: ['自身攻击空中敌人时伤害+35%。'],
  char_107_liskam: ['自身法术抗性+10。'],
  char_108_silent: ['无人机须手动摆放；每次施放治疗周围八格及自身地块。'],
  char_484_robrta: ['造型仪须手动摆放，最多同时3个；重复提供的护盾层数可叠加。'],
  char_242_otter: ['水獭须手动摆放，最多同时5个；被水獭阻挡的敌人攻击速度−25。'],
  char_249_mlyss: ['流形须手动摆放；损毁25秒后补充。莱茵生命干员部署费用−2。'],
  char_427_vigil: ['一支狼群初始2个狼影，最多3个；每25秒回复1个，受到致命伤时消耗1个狼影并回满生命。'],
  char_1028_texas2: ['自身攻击+20%；每次部署后首次亲自击倒敌人前，攻击速度+8、受到伤害−25%。'],
  char_4087_ines: ['影哨范围内敌人隐匿失效、移动速度−30%；偷取的攻击在敌人倒下或伊内丝离场时失效。'],
  char_337_utage: ['不成为其他角色的治疗目标；每次造成伤害后按武者特性回复自身生命。', '部署时没有原范围内目标，未结算斩击保留至接敌；重复部署按次数积存，不额外扣血或施放。'],
});
