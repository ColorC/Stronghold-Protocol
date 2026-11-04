import { authoredCard as card, pct } from './core-adaptations.js';
export const LATE_ADAPTATIONS=Object.freeze({
  char_1046_sbell2:card(2,'B','slow',35,99,v=>[
    `原范围诱导${v.attract}秒、补${v.snow}层雪，连击${v.hits}次${pct(v.scale)}%法伤。`,
    `其他干员每累计冻结${v.every}名敌人，积存1次圣山祝福。`,
  ],{values:{attract:10,snow:3,hits:6,scale:5.2,ignore:10,every:3,cold:1.5},sourceTalent:1,
    tags:['原积雪最多5层、敌人离格消耗','保留受伤寒冷及圣山祝福满生命复苏、周围冻结8秒']}),
  char_1038_whitw2:card(2,'B','slow',35,1,v=>[
    `浮游单元散开全场追猎，立即结算${v.seconds}秒攻击。`,
    '头狼每在场20秒依次强化浮游上限、沉默、数量。',
  ],{values:{seconds:12,atk:.8,area:1.2,fear:3,slow:.5,stage:20},sourceTalent:0,
    tags:['巡游攻击立即结算','保留3秒恐惧及0.9格范围效果','保留叙拉古队伍初始技力+5']}),
  char_1040_blaze2:card(2,'D','medium',20,1,v=>[
    `连射${v.hits}次${pct(v.scale)}%群体法伤，灼燃爆发者额外${pct(v.extra)}%元素伤害。`,
    `全场灼燃爆发时，造成${pct(v.melt)}%元素伤害、回复12%生命并装填。`,
  ],{values:{hits:3,scale:2.15,extra:.8,melt:3.5,loss:.03,radius:1.7},sourceTalent:0,ammo:8,
    tags:['弹药8','施放流失3%最大生命','保留6000屏障倒地再生与原5秒复苏晕眩']}),
  char_4194_rmixer:card(2,'D','medium',20,3,v=>[
    `积存${v.uses}次3目标${pct(v.scale)}%反击，为其他拉特兰干员装填。`,
    `造成伤害时防御+${v.def}、攻速+${v.aspd}，持续10秒、最多3层。`,
  ],{values:{uses:5,scale:3.2,hp:.8,guard:.8,def:30,aspd:3},sourceTalent:0,ammo:6,
    tags:['弹药6','积存期间生命与防御+80%，停止主动攻击','保留8秒未主动攻击获得15%生命屏障']}),
});
export const LATE_CARD_ROLES=Object.freeze({
  char_1046_sbell2:{line:'redeploy',produces:['cold','control','sustain'],consumes:['cold'],roles:['direct','control']},
  char_1038_whitw2:{line:'workshop',produces:['control'],consumes:['deployment'],roles:['direct','control','selfGrowth','feed']},
  char_1040_blaze2:{line:'ammo',produces:['ammunition','element','sustain'],consumes:['element'],roles:['direct']},
  char_4194_rmixer:{line:'ammo',produces:['ammunition','sustain'],consumes:[],roles:['direct','feed']},
});
const pair=(a,av,at,b,bv,bt)=>[{key:a,value:av,text:at,sourceKind:'skill'},{key:b,value:bv,text:bt,sourceKind:'talent'}];
export const LATE_MODULES=Object.freeze({
  char_1046_sbell2:pair('hits',8,'群山俯首提升至8轮攻击。','every',2,'每累计2名其他干员冻结积存祝福。'),
  char_1038_whitw2:pair('seconds',16,'终幕巡游结算提升至16秒攻击。','stage',15,'头狼每阶段所需在场时间缩短至15秒。'),
  char_1040_blaze2:pair('hits',4,'众恶的焚场提升至4轮。','melt',4.5,'熔点引爆伤害提升至450%。'),
  char_4194_rmixer:pair('uses',7,'退休前布道积存反击提升至7次。','def',40,'扫射迎宾每层防御提升至40。'),
});
export const LATE_INNATES=Object.freeze({
  char_1046_sbell2:['群山俯首保留原x-2、10秒诱导、10点法抗穿透与原260%攻击倍率和攻击+100%；积雪按原进出格、5层上限和5.5秒自然生成。'],
  char_1038_whitw2:['终幕保留原散开、全场最近目标追逐、独立浮游蓄力、0.9格不重复范围伤害、锁定3秒恐惧和目标倒下重新索敌；巡游过程压缩为即时结算。'],
  char_1040_blaze2:['众恶的焚场保留原1.7格群体攻击和爆发目标额外元素伤害；全场灼燃爆发触发350%元素伤害、12%生命回复并按进击装填规则回满弹药。'],
  char_4194_rmixer:['退休前布道按原3-13反击至多3目标；每次施放积存5次反击、生命及防御强化不重复叠数值，原8秒空闲屏障与10秒3层迎宾保留。'],
});
