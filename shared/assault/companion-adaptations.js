import { authoredCard as card, pct } from './core-adaptations.js';
const manual=(tokenId,max,scope='ownerRange')=>[{tokenId,max,scope}];
export const COMPANION_ADAPTATIONS=Object.freeze({
  char_391_rosmon:card(2,'E','slow',35,2,v=>[
    `部署2件指定战术装备，对阻挡目标${v.hits}轮${pct(v.scale)}%群体物伤。`,
    `部署后随机一名术师与自身攻击+${pct(v.linkAtk)}%。`,
  ],{values:{hits:6,scale:1.75,pierce:160,linkAtk:.08,stock:2,field:2},sourceTalent:1,nativeDeploy:true,
    manualSummons:manual('token_10012_rosmon_shield',2),tags:['原0.9格溅射、50%余震','战术装备阻挡2、登场晕眩3秒、阻挡目标防御−160','装备原25秒寿命']}),
  char_1035_wisdel:card(2,'D','slow',35,1,v=>[
    `1轮${pct(v.scale)}%爆裂物伤与余震；补2个指定魂灵之影。`,
    '部署后补1影；影周围获迷彩，影按原技力施法并附残影。',
  ],{values:{scale:2.2,atk:1.8,radius:2.5,main:1.15,bomb:1.5,stun:1,stock:3,field:3,firstSP:3},ammo:6,sourceTalent:1,nativeDeploy:true,canHitFly:true,
    manualSummons:manual('token_10035_wisdel_wward',3),tags:['原好礼：残影受余震必爆，1.1格爆炸可对空','普通攻击残影15%爆炸','保留魂灵之影在本体退场后存活']}),
  char_4117_ray:card(2,'B','slow',35,1,v=>[
    `装满猎手弹匣，${v.hits}连射${pct(v.scale)}%物伤、束缚${v.bind}秒。`,
    `沙地兽延伸范围并优先攻击，区域物伤+${pct(v.area)}%。`,
  ],{values:{hits:6,scale:3.3,bind:2,area:.15,trance:.08,stock:1,field:1,refund:10},sourceTalent:0,
    manualSummons:manual('token_10034_ray_sndbst',1),tags:['猎手120%倍率与8发普通弹匣保留','命中同一目标攻击+8%，最多3层，换目标清零','本次击倒敌人返10技力','沙地兽原25秒侦察、3费用、30秒再部署']}),
  char_2015_dusk:card(2,'E','slow',35,1,v=>[
    `原扩大范围${v.hits}轮${pct(v.scale)}%群体法伤，召唤／刷新指定小自在。`,
    `自身与小自在击倒敌人，本场攻击+${pct(v.growth)}%，最多${v.cap}层。`,
  ],{values:{hits:6,scale:2.2,radius:1.7,growth:.02,cap:15,seconds:25,stock:1,field:1},sourceTalent:0,
    manualSummons:manual('token_10015_dusk_drgn',1,'skillRange'),tags:['优先未阻挡目标','首次普通攻击同样在手动指定位置点睛','小自在阻挡2、原25秒寿命']}),
  char_1012_skadi2:card(2,'B','slow',35,99,v=>[
    `自身与海嗣各${v.pulses}轮${pct(v.scale)}%真伤，友军积存${v.uses}次鼓舞。`,
    `覆盖友军时自身攻击+${pct(v.ally)}%，有深海猎人改为+${pct(v.abyssal)}%。`,
  ],{values:{pulses:6,scale:.7,uses:6,inspire:1.1,loss:.05,ally:.06,abyssal:.15,stock:1,field:1},sourceTalent:1,
    manualSummons:manual('token_10017_skadi2_dedant',1),tags:['110%自身攻击鼓舞，同属性取最高','重叠范围真伤分别结算，鼓舞不叠数值','每轮流失5%生命，最低保留1','海嗣原25秒、5费用、30秒再部署']}),
  char_4179_monstr:card(2,'B','slow',35,3,v=>[
    `移动至指定重构体，${v.hits}轮${pct(1+v.atk)}%真伤并连锁自疗后返回。`,
    `治疗时，目标及自身积存${v.uses}次攻击速度+${v.aspd}的攻击。`,
  ],{values:{hits:6,atk:3.3,hp:5000,block:2,heal:.5,uses:2,aspd:20,aura:.15,stock:1,field:1},sourceTalent:1,
    manualSummons:manual('token_10050_monstr_prosts',1),tags:['本次阻挡+2、生命+5000、每轮流失80生命','原3目标连锁、75%跳跃衰减、自身与重构体免费跳跃','返回清空技力，1秒不死','重构体原80生命／秒流失、15秒再部署、3费用']}),
  char_1034_jesca2:card(2,'D','slow',35,1,v=>[
    `原延伸范围${pct(1+v.atk)}%物伤，有盾时发射原榴弹。`,
    `盾牌每累计受伤${v.every}次，为自身充能${v.charge}。`,
  ],{values:{atk:3.1,def:.8,shieldDef:1.7,uses:4,every:2,charge:4,stock:1,field:1},ammo:20,sourceTalent:1,
    manualSummons:manual('token_10032_jesca2_jckshd',1,'adjacent4'),tags:['积存4次自身防御+80%、盾牌防御+170%的受击','盾牌转向与身后15%防御保留','原250%榴弹、1.7格爆炸、6秒晕眩与真实飞行','盾牌原50秒寿命、5费用、30秒再部署']}),
});
export const COMPANION_CARD_ROLES=Object.freeze({
  char_391_rosmon:{line:'workshop',produces:['summon','control','deployment'],consumes:['block'],roles:['direct','buffOthers','deploy']},
  char_1035_wisdel:{line:'ammo',produces:['summon','ammunition','control','deployment'],consumes:['summon'],roles:['direct','deploy']},
  char_4117_ray:{line:'workshop',produces:['summon','control','ammunition'],consumes:['summon','kill'],roles:['direct','selfGrowth']},
  char_2015_dusk:{line:'workshop',produces:['summon'],consumes:['kill'],roles:['direct','selfGrowth']},
  char_1012_skadi2:{line:'workshop',produces:['summon','sustain'],consumes:['summon'],roles:['direct','buffOthers','aura']},
  char_4179_monstr:{line:'workshop',produces:['summon','sustain'],consumes:['sustain'],roles:['direct','buffOthers','aura']},
  char_1034_jesca2:{line:'ammo',produces:['summon','control','ammunition'],consumes:['sustain'],roles:['direct','feed','aura']},
});
const pair=(a,av,at,b,bv,bt)=>[{key:a,value:av,text:at,sourceKind:'skill'},{key:b,value:bv,text:bt,sourceKind:'talent'}];
export const COMPANION_MODULES=Object.freeze({
  char_391_rosmon:pair('hits',8,'如你所愿提升至8轮。','linkAtk',.12,'感知稳定共享攻击提升至12%。'),
  char_1035_wisdel:pair('scale',2.7,'爆裂黎明攻击倍率提升至270%。','firstSP',5,'本次第一名新魂灵之影获得5初始技力。'),
  char_4117_ray:pair('hits',8,'得见光芒提升至8次射击。','area',.22,'巡哨区域物伤提升至22%。'),
  char_2015_dusk:pair('hits',8,'写意胜形提升至8轮。','growth',.03,'化境每层攻击提升至3%。'),
  char_1012_skadi2:pair('uses',8,'潮涌鼓舞积存提升至8次攻击。','abyssal',.22,'深海捕食习性攻击提升至22%。'),
  char_4179_monstr:pair('hits',8,'策略熔毁提升至8轮。','uses',3,'每次治疗双方积存3次协同攻击。'),
  char_1034_jesca2:pair('uses',6,'饱和迸射防御积存提升至6次。','every',1,'盾牌每次受伤均为自身充能4。'),
});
export const COMPANION_INNATES=Object.freeze({
  char_391_rosmon:['保留原攻击范围、2个被阻挡目标、0.9格主溅射与50%余震、160防御穿透；战术装备只在手动指定地面出现，阻挡2、25秒寿命、登场晕眩及阻挡者防御削弱。'],
  char_1035_wisdel:['原6发技能弹药转换为本场6次施放；每次一轮220%攻击、原180%攻击强化、2.5格可对空主爆与50%仅地面余震，残影必爆；原115%主目标倍率与普通15%残影爆炸保留。魂灵之影原5技力、随机返0至2技力、停顿与迷彩保留，只在指定坐标出现，本体退场不强制销毁。'],
  char_4117_ray:['保留原3-8范围及沙地兽范围并集、优先目标、15%物伤、120%猎手倍率与8发普通子弹；原0.4秒快速装填过程压缩为立即装满再射击，正常装填仍用原基础攻击间隔、每次1发。'],
  char_2015_dusk:['写意胜形保留3-15范围、未阻挡优先、220%群体法伤和1.7格溅射；点睛及技能召唤均使用玩家指定坐标，同一只小自在刷新原25秒寿命，不移去敌人脚下。'],
  char_1012_skadi2:['潮涌保留自身与海嗣重叠真伤分别结算、110%最终附加攻击鼓舞、每轮5%生命流失及不低于1；鼓舞改为攻击次数积存且同属性不叠数值；非施放期自身与海嗣范围保留原特性再生、捕食习性和海嗣原寿命与费用。'],
  char_4179_monstr:['策略熔毁仅在重构体实际在场时发动；原移动、撤退重构体、生命5000、阻挡2、攻击330%加成、真伤、50%攻击链式自疗、每轮流失80、原位返回清技力及1秒不死保留；战术协同改为可积存的攻击次数，重构体原免费治疗跳跃与仅可被本人治疗保留。'],
  char_1034_jesca2:['饱和迸射原20发转换为本场20次施放；每次原410%物伤，防御改为可积存受击次数，盾牌在场时实际发射原250%榴弹；盾牌原四邻转向、身后防御、50秒寿命及30秒再部署保留。'],
});
