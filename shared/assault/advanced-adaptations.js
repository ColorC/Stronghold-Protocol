import { authoredCard as card, pct } from './core-adaptations.js';
export const ADVANCED_ADAPTATIONS=Object.freeze({
  char_1039_thorn2:card(2,'A','slow',35,4,v=>[
    `向最低阻挡4名干员投掷单元，${v.seconds}秒内法伤与削弱渐强。`,
    `全体友军攻速+${v.aspd}、敌人−${v.aspd}，连续6格直路翻倍。`,
  ],{values:{seconds:23,scale:2.1,maxScale:3.9,aspd:5,extend:3,atk:.1},sourceTalent:1,
    tags:['攻击范围原生扩大','15秒达到390%每秒法伤','攻击削弱15%→30%、防御法抗35%→50%','削弱取最强，单元伤害独立']}),
  char_4231_clemnt:card(2,'D','slow',30,3,v=>[
    `射击3名敌人${pct(v.scale)}%物伤，并造成物伤${pct(v.erosion)}%侵蚀。`,
    `全场侵蚀爆发时耗1发，落点十字3轮物理及元素轰击。`,
    `友军每累计造成${v.every}次侵蚀损伤，下次物伤必定暴击。`,
  ],{values:{scale:2.35,erosion:.2,bomb:3,element:2.5,every:3,crit:1.35,normal:.25,low:.5,protect:.3,seaProtect:.5},sourceTalent:0,ammo:10,
    tags:['弹药10','轰击每轮300%物伤、250%元素伤害','保留前方减伤与防御降低时暴击概率提升']}),
  char_4037_demetr:card(2,'E','slow',30,1,v=>[
    `移动至原搜索区敌人，连击${v.hits}次后返回；${pct(v.chance)}%暴击。`,
    `攻击叠加${pct(v.def)}%减防、最多5层；目标生命越低增伤越高。`,
  ],{values:{hits:6,atk:1.7,chance:.5,crit:1.85,def:.07,lowBonus:.28,seconds:10},sourceTalent:0,nativeDeploy:true,
    tags:['家族手段原生减防与最高128%伤害','部署闪避80%，20秒衰减至40%','移动与返回均保留原生部署事件']}),
  char_4145_ulpia:card(2,'E','slow',30,99,v=>[
    `原路线投锚晕眩6秒，移动后${v.hits}击，再返回原位。`,
    `击杀后本场生命+${v.hpGrowth}、攻击+${v.atkGrowth}，最多9层；深海队友半效。`,
  ],{values:{hits:6,atk:2.6,anchor:1.6,hp:.8,uses:4,hpGrowth:120,atkGrowth:30},sourceTalent:1,
    tags:['投锚周围原1.8格群体物伤','积存4次生命+80%的受击','保留受伤100/160生命回复','位移标记固定保留原出发点']}),
  char_1019_siege2:card(2,'E','slow',35,4,v=>[
    `黄金盟誓协战${v.hits}轮真伤，自身每轮至多4名${pct(v.scale)}%。`,
    `周围友方单位首次命中各敌人时，使其战栗${v.tremble}秒。`,
  ],{values:{hits:6,scale:2.9,tremble:4,protect:.2,allyATK:.05,stock:8,field:8,seconds:25},sourceTalent:1,
    manualSummons:[{tokenId:'token_10040_siege2_vlion',max:8,scope:'adjacent8'}],
    tags:['诸王的叹息：周围物伤−20%、每名友军自身攻击+5%','可攻击周围友军阻挡的敌人','首次补足已指定的黄金盟誓，此后缺失时补1个']}),
  char_4010_etlchi:card(2,'E','slow',30,3,v=>[
    `原范围最高生命3敌映出心烛，连斩${v.hits}轮${pct(v.scale)}%物伤。`,
    `友军每累计触发${v.every}次元素爆发，回复自身${pct(v.heal)}%生命。`,
  ],{values:{hits:6,scale:2.35,every:3,heal:.5,steal:75,cap:1350},sourceTalent:1,
    tags:['心烛继承60%当前生命并向本体传递生命流失','心烛仅受自身攻击影响，每击至少35%攻击','保留萃血与原生重盈']}),
});
export const ADVANCED_CARD_ROLES=Object.freeze({
  char_1039_thorn2:{line:'workshop',produces:[],consumes:[],roles:['direct','control','aura']},
  char_4231_clemnt:{line:'ammo',produces:['ammunition','element'],consumes:['element'],roles:['direct']},
  char_4037_demetr:{line:'redeploy',produces:['deployment'],consumes:[],roles:['direct','deploy']},
  char_4145_ulpia:{line:'redeploy',produces:['deployment','control','sustain'],consumes:['kill'],roles:['direct','selfGrowth','buffOthers']},
  char_1019_siege2:{line:'workshop',produces:['summon','control'],consumes:[],roles:['direct','aura']},
  char_4010_etlchi:{line:'workshop',produces:['sustain'],consumes:['element'],roles:['direct','selfGrowth']},
});
const pair=(a,av,at,b,bv,bt)=>[{key:a,value:av,text:at,sourceKind:'skill'},{key:b,value:bv,text:bt,sourceKind:'talent'}];
export const ADVANCED_MODULES=Object.freeze({
  char_1039_thorn2:pair('maxScale',4.5,'我的海疆最高每轮法伤提升至450%。','aspd',8,'视界基础攻速增减提升至8。'),
  char_4231_clemnt:pair('bomb',3.6,'侵蚀爆发轰击物伤提升至360%。','every',2,'每累计2次友军侵蚀获得必定暴击。'),
  char_4037_demetr:pair('hits',8,'清算提升至8次连击。','def',.08,'家族手段每层减防提升至8%。'),
  char_4145_ulpia:pair('hits',8,'开辟通路提升至8次攻击。','hpGrowth',160,'血脉每层生命提升至160，深海队友半效。'),
  char_1019_siege2:pair('hits',8,'黄金盟誓协战提升至8轮。','tremble',6,'无拘的锋芒战栗提升至6秒。'),
  char_4010_etlchi:pair('hits',8,'心烛连斩提升至8轮。','heal',.7,'元素爆发连线回复提升至70%生命。'),
});
export const ADVANCED_INNATES=Object.freeze({
  char_1039_thorn2:['我的海疆保留最低阻挡4名友军、跟随区域、独立伤害、逐秒15级爬升及削弱取最高；心相攻击+10%、附近有其他干员延长3秒，以及视界直路条件均保留。'],
  char_4231_clemnt:['与海为敌保留3目标原范围、物伤转20%侵蚀、全场侵蚀爆发时原十字三轮物理及元素伤害；普通施放与爆发轰击共享本场10发弹药。'],
  char_4037_demetr:['清算在原x-2搜索区移动，逐次使用原攻击、减防、低生命增伤与50%暴击；击倒精英时可重新选目标，结束按原牵绊规则返回与清空技力。'],
  char_4145_ulpia:['船锚按原前方路线遇敌或障碍停止、1.8格群体物伤及6秒晕眩，保留原移动与返回；出发点标记来自手动干员位置，不能另设无关坐标。'],
  char_1019_siege2:['黄金盟誓使用整备指定八邻格；俱以我之名保留原4目标真伤、周围友军阻挡目标可攻击、20%物伤减免与每名周围友军5%自身攻击。'],
  char_4010_etlchi:['心烛按原规则映射原范围最高当前生命的3个地面敌人，不能另改落点；继承60%当前生命及原防御法抗，最小35%攻击伤害与等量本体生命流失保留。'],
});
