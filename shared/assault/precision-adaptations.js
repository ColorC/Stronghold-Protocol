import { authoredCard as card, pct } from './core-adaptations.js';
export const PRECISION_ADAPTATIONS=Object.freeze({
  char_341_sntlla:card(1,'B','medium',20,99,v=>[
    `原范围左右中三路轮换，落下${v.hits}枚${pct(v.scale)}%法伤冰凌。`,
    `友军每累计施加${v.every}次寒冷，为相邻干员赋予抵抗${v.resist}秒。`,
  ],{values:{hits:12,scale:.9,cold:1,every:3,resist:6,delay:20,atk:.15},sourceTalent:0,
    tags:['冰凌原半径1.5格','保留在场20秒后的攻击+15%及抵抗']}),
  char_430_fartth:card(2,'B','slow',30,1,v=>[
    `向前无限直线射出${v.hits}箭${pct(v.scale)}%物伤，原范围外伤害×${v.far}。`,
    `其他狙击每累计施放${v.every}次技能，为自身充能${v.charge}。`,
  ],{values:{hits:6,scale:2.4,far:1.4,quiet:10,focus:.15,every:3,charge:4},sourceTalent:0,nativeRange:'forwardLine',
    tags:['自身凝神与屏息保留','技能攻击无视物理闪避']}),
  char_4146_nymph:card(2,'B','slow',35,2,v=>[
    `原扩大范围2目标连击${v.hits}次${pct(v.scale)}%法伤，凋亡爆发中转元素。`,
    `范围内凋亡爆发时，本场攻击+${pct(v.growth)}%，最多${v.cap}层。`,
  ],{values:{hits:8,scale:3.2,growth:.02,cap:10,soul:.4},sourceTalent:1,
    tags:['失魂：爆发中目标每秒40%攻击力元素伤害','原生凋亡爆发实例可并存，按各自剩余时长']}),
  char_1047_halo2:card(2,'B','slow',30,2,v=>[
    `锁定2名敌人连击${v.hits}轮${pct(v.scale)}%法伤，彼此传导${pct(v.share)}%法伤。`,
    `施加停顿时，本场攻速+${v.aspd}，最多${v.cap}层。`,
  ],{values:{hits:8,scale:1.7,share:.25,aspd:1,cap:18,fragile:.1,stay:7,extra:.04},sourceTalent:0,
    tags:['保留能源解析：范围内10%脆弱，停留7秒升至14%','锁定目标倒下时重新选择']}),
});
export const PRECISION_CARD_ROLES=Object.freeze({
  char_341_sntlla:{line:'redeploy',produces:['cold'],consumes:['cold'],roles:['direct','control','buffOthers']},
  char_430_fartth:{line:'ammo',produces:[],consumes:['skill'],roles:['direct']},
  char_4146_nymph:{line:'workshop',produces:['element'],consumes:['element'],roles:['direct','selfGrowth']},
  char_1047_halo2:{line:'workshop',produces:[],consumes:['control'],roles:['direct','selfGrowth','aura']},
});
const pair=(a,av,at,b,bv,bt)=>[{key:a,value:av,text:at,sourceKind:'skill'},{key:b,value:bv,text:bt,sourceKind:'talent'}];
export const PRECISION_MODULES=Object.freeze({
  char_341_sntlla:pair('hits',15,'冰凌提升至15枚。','resist',9,'寒冷连线抵抗延长至9秒。'),
  char_430_fartth:pair('hits',8,'光羽箭提升至8发。','focus',.22,'凝神攻击加成提升至22%。'),
  char_4146_nymph:pair('hits',10,'心防溃决提升至10轮。','growth',.03,'窥心钥每层攻击提升至3%。'),
  char_1047_halo2:pair('hits',10,'并流连锁提升至10轮。','aspd',2,'数据建模每层攻速提升至2。'),
});
export const PRECISION_INNATES=Object.freeze({
  char_341_sntlla:['女巫之泪保留原3-3范围、左／右／中行轮换随机格、半径1.5溅射与1秒寒冷；重复施放完整落下新一组冰凌。'],
  char_430_fartth:['光羽箭保留面前无限长直线、原范围外140%伤害与无视物理闪避；凝神按最近10秒未受伤害判定，生命流失不打断。'],
  char_4146_nymph:['心防溃决保留2目标、原3-3范围及凋亡爆发中转为元素伤害；失魂持续到实际凋亡爆发结束，窥心钥最多10层本场攻击。'],
  char_1047_halo2:['并流连锁保留原y-4、2目标持续锁定与25%法伤传导；停顿建模最多18层，能源解析保留7秒停留条件。'],
});
