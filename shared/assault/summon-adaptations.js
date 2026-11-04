import { authoredCard as card, pct } from './core-adaptations.js';

const manual=(tokenId,max,scope)=>[{tokenId,max,...(scope?{scope}:{})}];
export const SUMMON_ADAPTATIONS=Object.freeze({
  char_451_robin:card(1,'A','fast',12,1,v=>[
    `补充1个夹子；踩中者受到${pct(v.scale)}%物伤并较大力推动。`,
    `其他友方装置每累计触发${v.every}次，补充1个夹子。`,
  ],{values:{scale:3.8,force:2,stock:10,initial:8,field:10,every:3},sourceTalent:0,
    manualSummons:manual('token_10013_robin_mine',10),tags:['原生陷阱费用3、再部署5秒']}),
  char_4048_doroth:card(2,'E','fast',12,99,v=>[
    `补充1个装置；十字爆炸${pct(v.scale)}%法伤、停顿${v.slow}秒。`,
    `其他友方装置触发后，自身本场攻击+${pct(v.growth)}%，最多${v.cap}层。`,
  ],{values:{scale:3.5,slow:5,chain:2,stock:10,initial:8,field:10,growth:.02,cap:10},sourceTalent:1,nativeDeploy:true,
    manualSummons:manual('token_10025_doroth_recttp',10),tags:['原十字延迟2秒连锁','部署时在已指定位置补2个装置']}),
  char_4016_kazema:card(1,'E','medium',20,1,v=>[
    `流失${pct(v.loss)}%当前生命，双影各连击${v.hits}次，自身${pct(v.scale)}%物伤。`,
    `替身出现时周围${pct(v.origami)}%法伤；其他召唤物出现时减半。`,
  ],{values:{loss:.5,hits:6,scale:2.2,origami:2.7,stock:1,field:1,seconds:20},sourceTalent:0,
    manualSummons:manual('token_10022_kazema_shadow',1,'adjacent8'),tags:['纸影存在20秒','保留致命伤害后的替身切换']}),
  char_344_beewax:card(1,'E','medium',20,99,v=>[
    `尖碑周围${pct(v.scale)}%法伤、晕眩${v.stun}秒；缺失时补1座。`,
    `尖碑每累计阻挡${v.every}名敌人，为周围术师充能${v.charge}。`,
  ],{values:{scale:3,stun:3,stock:1,field:1,every:3,charge:4,regen:.04,seconds:20},sourceTalent:0,
    manualSummons:manual('token_10011_beewax_oblisk',1,'ownerRange'),tags:['尖碑阻挡3、存在20秒','非施放期间每秒再生4%生命']}),
  char_254_vodfox:card(1,'E','medium',24,99,v=>[
    `获得1个诅咒娃娃：周围攻击、防御−${pct(v.down)}%，${v.seconds}秒。`,
    `原攻击范围内生命低于${pct(v.threshold)}%的敌人获得${pct(v.fragile)}%脆弱。`,
  ],{values:{down:.5,seconds:15,threshold:.4,fragile:.3,stock:1,field:1},sourceTalent:0,
    manualSummons:manual('token_10006_vodfox_doll',1),tags:['娃娃按原作15秒后销毁','最多库存1个']}),
  char_4162_cathy:card(1,'E','medium',24,99,v=>[
    `本场生命+${pct(v.hp)}%、防御+${pct(v.def)}%，停攻；补1装置。`,
    `朝向目标每秒补${pct(v.refill)}%自身生命的屏障，上限${pct(v.cap)}%。`,
    `装置屏障破裂时，为持有者充能${v.charge}。`,
  ],{values:{hp:.7,def:.3,refill:.06,cap:.2,idle:5,stock:3,field:2,charge:4},sourceTalent:0,
    manualSummons:manual('token_10041_cathy_catsld',2),tags:['首次施放前保留5秒未受击才补屏障','装置效果不叠加']}),
  char_393_toledo:card(1,'E','medium',24,99,v=>[
    `征服者传说周围敌人战栗${v.tremble}秒；缺失时补1个。`,
    `原范围被阻挡敌人脆弱${pct(v.fragile)}%，施放后${v.seconds}秒翻倍。`,
  ],{values:{tremble:7,fragile:.16,stock:1,field:1,seconds:20},sourceTalent:0,
    manualSummons:manual('token_10067_toledo_tldptm',1,'ownerRange'),tags:['征服者传说阻挡3、存在20秒']}),
  char_1014_nearl2:card(2,'E','slow',35,1,v=>[
    `耀阳周围${pct(v.sun)}%真伤、晕眩${v.stun}秒；自身连斩${v.hits}次。`,
    `部署时周围${pct(v.deploy)}%真伤；前一位为卡西米尔则追加1次。`,
  ],{values:{sun:1.1,stun:3,hits:6,scale:2.4,def:1,uses:4,deploy:.8,ignore:.2,stock:1,field:1,seconds:25},sourceTalent:0,nativeDeploy:true,
    manualSummons:manual('token_10019_nearl2_sword',1,'adjacent4'),
    tags:['耀阳阻挡2、存在25秒','对自身或耀阳阻挡者改为真伤','积存4次防御+100%的受击']}),
});
export const SUMMON_CARD_ROLES=Object.freeze({
  char_451_robin:{line:'workshop',produces:['summon','displacement'],consumes:['summon'],roles:['direct','control']},
  char_4048_doroth:{line:'workshop',produces:['summon','deployment'],consumes:['summon'],roles:['direct','selfGrowth','deploy']},
  char_4016_kazema:{line:'workshop',produces:['summon'],consumes:['summon'],roles:['direct']},
  char_344_beewax:{line:'workshop',produces:['summon','control'],consumes:['block'],roles:['direct','feed','control']},
  char_254_vodfox:{line:'workshop',produces:['summon'],consumes:[],roles:['aura']},
  char_4162_cathy:{line:'workshop',produces:['summon','sustain'],consumes:['sustain'],roles:['feed']},
  char_393_toledo:{line:'workshop',produces:['summon','control'],consumes:['block'],roles:['control','aura']},
  char_1014_nearl2:{line:'redeploy',produces:['summon','control','deployment'],consumes:['deployment','block'],roles:['direct','deploy']},
});
const pair=(a,av,at,b,bv,bt)=>[{key:a,value:av,text:at,sourceKind:'skill'},{key:b,value:bv,text:bt,sourceKind:'talent'}];
export const SUMMON_MODULES=Object.freeze({
  char_451_robin:pair('scale',4.6,'夹子伤害提升至460%。','every',2,'其他装置每累计触发2次，补充夹子。'),
  char_4048_doroth:pair('scale',4.3,'共振十字伤害提升至430%。','growth',.03,'梦想家每层攻击提升至3%。'),
  char_4016_kazema:pair('hits',8,'双影连击提升至8次。','origami',3.3,'折纸生花伤害提升至330%。'),
  char_344_beewax:pair('scale',3.8,'尖碑伤害提升至380%。','charge',6,'阻挡连线充能提升至6。'),
  char_254_vodfox:pair('down',.6,'诅咒娃娃攻防削弱提升至60%。','fragile',.4,'溃败暗示脆弱提升至40%。'),
  char_4162_cathy:pair('refill',.08,'战火淬炼每秒补充屏障提升至8%。','charge',6,'屏障破裂充能提升至6。'),
  char_393_toledo:pair('tremble',9,'传说战栗提升至9秒。','fragile',.22,'贵族血统基础脆弱提升至22%。'),
  char_1014_nearl2:pair('hits',8,'耀阳颔首提升至8次连斩。','deploy',1.1,'不畏苦暗部署伤害提升至110%。'),
});
export const SUMMON_INNATES=Object.freeze({
  char_451_robin:['夹子只放在整备指定位置，首个地面敌人踩中时触发，原3费用和5秒再部署保留；初始携带8个、库存上限10个。'],
  char_4048_doroth:['共振保留半径2格十字范围、5秒停顿与2秒延迟连锁；自己的装置同样保留梦想家2%攻击、最多10层。'],
  char_4016_kazema:['本体保留流失当前生命与220%攻击，手动纸影使用自身原属性；致命伤害后的20秒替身、替身出现270%法术爆炸保留。'],
  char_344_beewax:['尖碑只在攻击范围内指定地面格出现，阻挡3，附近300%法伤与3秒晕眩；非施放期间每秒恢复4%最大生命。'],
  char_254_vodfox:['娃娃保留周围八格含自身格攻防削弱和原15秒寿命，不随机挪动位置；溃败暗示保留原范围及低生命条件。'],
  char_4162_cathy:['装置按整备朝向连接前方干员，初始屏障上限为凯瑟琳生命20%；首次淬炼后本场每秒补6%，重复施放只补装置及一次屏障。'],
  char_393_toledo:['征服者传说只在原攻击范围内手动指定位置出现，阻挡3、存在20秒；原范围被阻挡敌人脆弱16%，施放后20秒翻倍。'],
  char_1014_nearl2:['耀阳只在四邻手动位置出现、阻挡2且不攻击，落地110%真伤与3秒晕眩；自身保留无视20%防御和对双方阻挡敌人的真伤。'],
});
